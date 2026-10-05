/* serveur-sauvegarde.js — la sauvegarde du monde
   Sauvegarde atomique, asynchrone en cours de partie et synchrone à l'arrêt
   (SPEC-SERVEUR-003/004), reprise au lancement, cadence.

   Module du serveur (SPEC-SERVEUR-008) : extrait de server.js sans changement
   de comportement. Il ne touche ni socket ni fichier par lui-même : tout ce
   dont il dépend arrive par le contexte S (état partagé, fonctions des autres
   modules) et S.hote (minuteries, process, Buffer… de Node), que server.js
   construit puis passe à `installer(S)`. Installer publie dans S les
   fonctions et valeurs de ce module dont les autres ont besoin. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  function installer(S) {
    const { Promise, SyntaxError, process, setImmediate, setTimeout } = S.hote;
    const {
      fs, path, crypto, logServeur, logLanceur, CONF, CA, stockageParties, admin, monde,
      politique, guildes, economie, pvp, etatMonde, appliquerEtatMonde, journal,
    } = S;
    const EP = S.EP;   // état partagé modifiable, à forme fixe (créé par server.js)
    Object.assign(S, { sauvegarderMondeAsync, sauvegarderMondeSync });

    /* Sauvegarde atomique (SPEC-SERVEUR-003) : on écrit dans un fichier `.tmp`
       PUIS on renomme vers le chemin final — `rename` est atomique au niveau du
       système de fichiers, donc le fichier final est TOUJOURS soit l'ancienne
       version complète, soit la nouvelle version complète, jamais un mélange
       tronqué. Écrire directement dans le fichier final exposerait une lecture
       (ou un arrêt brutal du processus) au milieu de l'écriture.

       Revue adversariale du commit 2365213 (test-race-save.js) : la sauvegarde
       PÉRIODIQUE (asynchrone) et celle de l'ARRÊT/PANNE (synchrone) écrivaient
       toutes deux dans le MÊME fichier `.tmp` — un SIGTERM pendant que l'écriture
       asynchrone est en vol pouvait laisser un `.tmp` tronqué au sol (l'écriture
       du thread libuv et l'écriture synchrone du thread principal se
       chevauchent, puis `process.exit()` coupe tout avant que l'une des deux
       n'ait fini). Deux corrections : chaque mode écrit dans son PROPRE fichier
       temporaire (jamais le même inode manipulé par deux écritures concurrentes),
       et l'arrêt attend (avec un délai borné) qu'une sauvegarde asynchrone déjà
       en vol se termine avant d'en lancer une synchrone par-dessus. */
    const FICHIER_TMP_ASYNC = () => CONF.mondeFichier + '.tmp';
    const FICHIER_TMP_SYNC = () => CONF.mondeFichier + '.tmp.' + process.pid;
    EP.sauvegardeEnCours = false;
    EP.sauvegardeEnCoursAttente = null;       // Promise résolue quand la sauvegarde async en vol se termine
    EP.sauvegardeArretee = false;             // plus aucune sauvegarde async après le début de l'arrêt

    /* Version asynchrone (SPEC-SERVEUR-004) : utilisée par la sauvegarde
       périodique, elle ne bloque JAMAIS la boucle de jeu — `fs.writeFile`/
       `fs.rename` rendent la main immédiatement, le tic et les messages des
       clients continuent d'être traités pendant l'écriture disque. Une seule
       sauvegarde à la fois : si la précédente n'est pas terminée, celle-ci est
       ignorée plutôt que d'écrire deux fichiers `.tmp` en parallèle. */
    /* SPEC-ARCHI-012 : une sauvegarde est OMISE si rien n'a changé depuis la
       précédente. L'empreinte est l'état sérialisé SANS l'heure du monde (qui
       avance à chaque tic hors pause : sans cette exclusion une cadence
       n'omettrait jamais rien) ; une sauvegarde provoquée par un ÉVÈNEMENT (pause,
       retour au menu, fermeture réseau, dernier client, arrêt) n'est omise que si
       l'heure elle-même n'a pas bougé non plus, c'est-à-dire seulement quand le
       monde est réellement resté figé depuis l'écriture précédente. */
    let derniereEmpreinte = null;
    let derniereHeureSauvee = null;
    EP.nbEcritures = 0;                       // écritures réussies depuis le démarrage (« /sauver » compare avant/après)
    let sauvegardeRedemandee = null;       // raison d'une sauvegarde événementielle demandée pendant une écriture en vol
    /* Empreinte de l'état sérialisé SANS l'heure du monde : condensat SHA-1 calculé
       morceau par morceau (jamais une copie du texte entier). L'heure est la
       troisième clé de la tête (`v`, `graine`, `heure`) : seule sa première
       occurrence est neutralisée, comme le faisait le remplacement d'origine. */
    function empreinteMorceaux(morceaux) {
      const h = crypto.createHash('sha1');
      morceaux.forEach((m, i) => h.update(i === 0 ? m.replace(/"heure":[-0-9.eE+]+/, '"heure":0') : m));
      return h.digest('hex');
    }
    function apresSauvegarde(raison, ms, octets, detail) {
      journal('sauvegarde du monde (' + raison + ')' + (ms !== undefined ? ' — sérialisation ' + ms.toFixed(1) + ' ms, ' + Math.round(octets / 1024) + ' Ko' + (detail || '') : ''));
      if (EP.partieActive) MC.Saves.majMeta(stockageParties, EP.partieActive.id, { duree: Math.round(EP.dureeJeu) });
    }
    EP.dureeJeu = 0;                          // secondes de jeu réellement écoulées (hors pause, avec un joueur), pour l'index des parties
    /* Sauvegarde périodique et événementielle (SPEC-SERVEUR-003/004, SPEC-ARCHI-012) :
       écriture atomique (fichier temporaire puis renommage) et ASYNCHRONE, et — depuis
       la mesure des tics (tools/mesure-tics.js) — sérialisation par TRANCHES : la tête
       (joueurs, conteneurs, politique… quelques Ko à quelques centaines de Ko) d'un
       coup, puis les blocs modifiés et leurs états par tranches de
       BUDGETS.TRANCHE_SAUVEGARDE_MS, entre deux tics (setImmediate). Le texte écrit
       est celui de l'état à l'instant où la sauvegarde COMMENCE (instantané : toute
       modification ultérieure d'un bloc est annoncée au sérialiseur avant d'avoir
       lieu, voir crochetModification) et il est identique, octet pour octet, à
       JSON.stringify(etatMonde()) — la sauvegarde synchrone de l'arrêt, inchangée. */
    let serialisationEnCours = null;
    /* Incrémenté par chaque sauvegarde SYNCHRONE (arrêt, exception non rattrapée) : une
       sauvegarde asynchrone commencée avant elle porte un instantané plus ancien et ne
       doit jamais la remplacer — elle s'abandonne (sérialisation ou renommage). */
    let generationSauvegarde = 0;
    function sauvegarderMondeAsync(raison, evenement) {
      if (!CONF.mondeFichier || EP.sauvegardeArretee || EP.ecritureMondeInterdite) return;
      /* La cible est figée ICI : `/api/parties/supprimer` peut mettre CONF.mondeFichier
         à null pendant l'écriture (rename(…, null) levait, et écrivait « null.tmp »). */
      const cible = CONF.mondeFichier;
      const tmp = cible + '.tmp';
      raison = typeof raison === 'string' ? raison : 'cadence';
      if (EP.sauvegardeEnCours) {                            // pas de sauvegarde concurrente
        if (evenement) sauvegardeRedemandee = raison;
        return;
      }
      let ser;
      const t0 = process.hrtime.bigint();
      const ecoule = () => Number(process.hrtime.bigint() - t0) / 1e6;
      try {
        ser = MC.TravauxServeur.creerSerialiseur(etatMonde(true), [
          { nom: 'overrides', map: monde.overrides },
          { nom: 'etats', map: monde.etatsOverrides || new Map() },
        ]);
      } catch (e) { journal('échec de la sauvegarde du monde (sérialisation) : ' + e.message); return; }
      let msMax = ecoule(), msTotal = msMax, tranches = 1;
      const heureEcrite = EP.heure;
      const generation = generationSauvegarde;
      const perimee = () => generation !== generationSauvegarde;
      EP.sauvegardeEnCours = true;
      let finAttente;
      EP.sauvegardeEnCoursAttente = new Promise((resolve) => { finAttente = resolve; });
      let emp = null, octets = 0;
      const fin = (ok) => {
        if (serialisationEnCours === ser) { serialisationEnCours = null; EP.crochetModification = null; }
        EP.sauvegardeEnCours = false; EP.sauvegardeEnCoursAttente = null; finAttente();
        // la partie a été supprimée pendant l'écriture : ne rien laisser derrière
        if (ok && CONF.mondeFichier !== cible) { try { fs.unlinkSync(cible); } catch (e) { /* déjà absent */ } ok = false; }
        if (ok) {
          EP.nbEcritures++; derniereEmpreinte = emp; derniereHeureSauvee = heureEcrite;
          apresSauvegarde(raison, msMax, octets, ' (' + tranches + ' tranche' + (tranches > 1 ? 's' : '') + ', ' + msTotal.toFixed(1) + ' ms au total)');
        }
        if (sauvegardeRedemandee) { const r = sauvegardeRedemandee; sauvegardeRedemandee = null; sauvegarderMondeAsync(r, true); }
      };
      serialisationEnCours = ser;
      /* Instantané : une écriture de bloc (overrides/états) pendant la sérialisation
         annonce d'abord la valeur qu'elle va remplacer ; un vidage complet (chargement
         d'une autre partie) abandonne cette sauvegarde. */
      EP.crochetModification = (nom, k) => {
        if (k === null) { ser.abandonnee = true; return; }
        ser.avantModification(nom, k);
      };
      const ecrire = (morceaux) => {
        try { fs.mkdirSync(path.dirname(cible), { recursive: true }); } catch (e) { /* remonté par l'écriture */ }
        const flux = fs.createWriteStream(tmp);
        let echoue = false;
        flux.on('error', (err) => {
          if (echoue) return;
          echoue = true;
          journal('échec de la sauvegarde du monde (écriture) : ' + err.message); try { fs.unlinkSync(tmp); } catch (e) { /* rien */ } fin(false);
        });
        flux.on('finish', () => {
          if (echoue) return;
          if (perimee()) {
            try { fs.unlinkSync(tmp); } catch (e) { /* rien */ }
            journal('sauvegarde (' + raison + ') abandonnée : une sauvegarde synchrone plus récente a été écrite');
            fin(false); return;
          }
          fs.rename(tmp, cible, (err2) => {
            if (err2) { journal('échec de la sauvegarde du monde (renommage) : ' + err2.message); try { fs.unlinkSync(tmp); } catch (e) { /* rien */ } fin(false); return; }
            fin(true);
          });
        });
        morceaux.forEach(m => flux.write(m));
        flux.end();
      };
      const tranche = () => {
        // arrêt du processus (sauvegarde synchrone finale) ou partie vidée : cette sauvegarde n'écrit rien
        if (EP.sauvegardeArretee || ser.abandonnee || perimee()) { fin(false); return; }
        const t1 = process.hrtime.bigint();
        let fini;
        try { fini = ser.avancer(S.performance.now() + MC.TravauxServeur.BUDGETS.TRANCHE_SAUVEGARDE_MS, horlogeSauvegarde); }
        catch (e) { journal('échec de la sauvegarde du monde (sérialisation) : ' + e.message); fin(false); return; }
        let ms = Number(process.hrtime.bigint() - t1) / 1e6;
        tranches++;
        if (!fini) { msMax = Math.max(msMax, ms); msTotal += ms; setImmediate(tranche); return; }
        // fin de la sérialisation : plus aucune modification à intercepter
        serialisationEnCours = null; EP.crochetModification = null;
        const t2 = process.hrtime.bigint();
        const morceaux = ser.morceaux();
        emp = empreinteMorceaux(morceaux);
        octets = morceaux.reduce((a, m) => a + m.length, 0);
        ms += Number(process.hrtime.bigint() - t2) / 1e6;
        msMax = Math.max(msMax, ms); msTotal += ms;
        if (S.profilTics) S.profilTics.tache('sauvegarde ' + raison + ' (tranche la plus longue)', msMax);
        if (derniereEmpreinte !== null && emp === derniereEmpreinte && (!evenement || heureEcrite === derniereHeureSauvee)) {
          journal('sauvegarde omise (' + raison + ') : rien n a change depuis la précédente');
          const r = sauvegardeRedemandee; sauvegardeRedemandee = null;
          EP.sauvegardeEnCours = false; EP.sauvegardeEnCoursAttente = null; finAttente();
          if (r) sauvegarderMondeAsync(r, true);
          return;
        }
        // MC_TEST_SAUVEGARDE_LENTE_MS : retarde l'écriture disque (tests de course avec /supprimer), jamais en exploitation
        const lente = parseInt(process.env.MC_TEST_SAUVEGARDE_LENTE_MS, 10) || 0;
        if (lente) setTimeout(() => ecrire(morceaux), lente); else ecrire(morceaux);
      };
      setImmediate(tranche);
    }
    const horlogeSauvegarde = () => S.performance.now();

    /* Version synchrone (toujours atomique elle aussi, mêmes tmp+rename, mais
       dans SON PROPRE fichier temporaire — voir plus haut) : réservée à l'arrêt
       du processus et aux gestionnaires de panne, où il n'y a plus de prochain
       tour de boucle d'évènements pour attendre une écriture asynchrone. */
    function sauvegarderMondeSync() {
      if (!CONF.mondeFichier || EP.ecritureMondeInterdite) return false;
      generationSauvegarde++;                 // toute sauvegarde asynchrone en cours devient périmée
      try {
        fs.mkdirSync(path.dirname(CONF.mondeFichier), { recursive: true });
        fs.writeFileSync(FICHIER_TMP_SYNC(), JSON.stringify(etatMonde()));
        fs.renameSync(FICHIER_TMP_SYNC(), CONF.mondeFichier);
        if (EP.partieActive) MC.Saves.majMeta(stockageParties, EP.partieActive.id, { duree: Math.round(EP.dureeJeu) });
        return true;
      } catch (e) { journal('échec de la sauvegarde du monde : ' + e.message); return false; }
    }
    /* SPEC-SAVE-026 : met de côté un fichier de monde refusé au démarrage, sous
       `<fichier>.refuse-<horodatage>` (AAAAMMJJ-HHMMSS, heure locale ; suffixe
       -2, -3… si ce nom existe déjà). Si le renommage échoue, plus AUCUNE
       sauvegarde n'est écrite pendant cette session : la nouvelle carte serait
       perdue à l'arrêt, mais le fichier refusé, lui, ne l'est jamais. */
    EP.ecritureMondeInterdite = false;
    function mettreDeCoteMondeRefuse(fichier, motif) {
      const d = new Date(), z = (n) => String(n).padStart(2, '0');
      const base = `${fichier}.refuse-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
      let dest = base;
      for (let k = 2; fs.existsSync(dest); k++) dest = base + '-' + k;
      try {
        // MC_TEST_ECHEC_RENOMMAGE : simule un renommage impossible (fichier verrouillé), jamais en exploitation
        if (process.env.MC_TEST_ECHEC_RENOMMAGE) { const e = new Error('EBUSY (simulé)'); e.code = 'EBUSY'; throw e; }
        fs.renameSync(fichier, dest);
      } catch (e) {
        EP.ecritureMondeInterdite = true;
        logServeur.error(`E-SAVE-007 fichier de monde refusé (${motif}) : ${fichier} — impossible de le mettre de côté (${e.message}) ; ` +
                         'nouvelle carte NON sauvegardée pendant cette session, pour ne pas l\'écraser', { fichier, motif }, e, { code: 'E-SAVE-007' });
        return null;
      }
      logServeur.warn(`E-SAVE-006 fichier de monde refusé (${motif}) : conservé tel quel sous ${dest} — nouvelle carte, sauvegardée sous ${fichier}`,
                      { fichier, dest, motif }, null, { code: 'E-SAVE-006' });
      return dest;
    }
    /* État du monde AVANT toute reprise (SPEC-SAVE-026) : ce que le démarrage a
       construit, sans rien du fichier. Une reprise qui lève au milieu de
       `appliquerEtatMonde` a déjà écrit une partie du fichier (heure, overrides…) :
       réappliquer cet état vierge remet À ZÉRO tout ce que la reprise touche —
       y compris ce qu'elle ne réinitialise pas quand le champ est absent
       (administration, zones, politique, guildes, économie, PvP). Construit sans
       `clients` (pas encore déclaré à ce stade) : aucun joueur n'est connecté. */
    function etatMondeVierge() {
      return {
        v: 2, graine: CONF.graine, heure: EP.heure,
        overrides: [], etats: [], crops: [], donjons: [], pilles: [], pnjsMorts: [],
        admin: MC.Admin.serialiser(admin),
        zones: monde.zonesEtat ? MC.Zones.serialiser(monde.zonesEtat) : null,
        politique: MC.Politique.serialiser(politique), guildes: MC.Guildes.serialiser(guildes),
        economie: MC.Economie.serialiser(economie), pvp: MC.PvpEnjeux.serialiser(pvp),
        quetes: [], joueurs: [], conteneurs: [], expositions: [], commandes: [], vehicules: [],
        histoire: null, soloJoueur: null, extras: null,
      };
    }
    const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
    S.dodo = dodo;
    if (CONF.mondeFichier) {
      // fichiers temporaires résiduels d'un arrêt brutal précédent (process tué
      // avant la fin d'une écriture) : jamais renommés vers le fichier final,
      // donc jamais lus — mais laissés au sol, ils s'accumuleraient sans fin.
      try {
        const dossier = path.dirname(CONF.mondeFichier);
        const prefixe = path.basename(CONF.mondeFichier) + '.tmp';
        fs.readdirSync(dossier).forEach((f) => {
          if (f.indexOf(prefixe) !== 0) return;
          try { fs.unlinkSync(path.join(dossier, f)); journal(`fichier temporaire résiduel supprimé : ${f}`); }
          catch (e) { /* déjà disparu, ou permission : tant pis, non bloquant */ }
        });
      } catch (e) { /* dossier pas encore créé : rien à nettoyer */ }
      /* SPEC-SAVE-026 : un fichier refusé (JSON illisible, `v` inconnu ou futur,
         reprise qui échoue) n'est JAMAIS écrasé par la nouvelle carte. Il est mis
         de côté tel quel (renommé, donc octet pour octet) avant la première
         sauvegarde, qui écrira la nouvelle carte sous le nom d'origine. */
      if (fs.existsSync(CONF.mondeFichier)) {
        /* Une erreur d'ENTRÉE/SORTIE (dossier à la place du fichier, fichier
           verrouillé, droits) n'est PAS un refus de contenu : on ne renomme rien
           (--monde pointant sur un dossier aurait déplacé le dossier de
           l'utilisateur) et on s'arrête avec un message clair. */
        let texte;
        try { texte = fs.readFileSync(CONF.mondeFichier, 'utf8'); }
        catch (e) {
          logLanceur.error(`impossible de lire le fichier de monde ${CONF.mondeFichier} (${e.code || e.message}) : ` +
                           'vérifiez que --monde désigne un fichier lisible ; rien n\'a été modifié', { fichier: CONF.mondeFichier, code: e.code || null }, e,
                           { brut: true, code: 'E-SERV-006' });
          process.exit(1);
        }
        const vierge = etatMondeVierge();
        let motifRefus = null;
        try {
          const data = JSON.parse(texte);
          if (appliquerEtatMonde(data)) journal(`monde repris depuis ${CONF.mondeFichier} (heure ${EP.heure.toFixed(1)})`);
          else motifRefus = 'version inconnue (v = ' + JSON.stringify(data && typeof data === 'object' ? data.v : data) + ')';
        } catch (e) {
          motifRefus = (e instanceof SyntaxError ? 'JSON illisible : ' : 'reprise impossible : ') + e.message;
          // la reprise a pu écrire une partie du fichier refusé : tout revient à l'état vierge
          try { appliquerEtatMonde(vierge); }
          catch (e2) {
            EP.ecritureMondeInterdite = true;
            logServeur.error('E-SAVE-007 monde vierge impossible à rétablir après une reprise interrompue : aucune sauvegarde pendant cette session',
                             { fichier: CONF.mondeFichier }, e2, { code: 'E-SAVE-007' });
          }
        }
        if (motifRefus) mettreDeCoteMondeRefuse(CONF.mondeFichier, motifRefus);
      } else {
        journal(`aucune sauvegarde à ${CONF.mondeFichier} — nouvelle carte, créée à la première sauvegarde`);
      }
      // sauvegarde régulière : toutes les deux minutes par défaut, comme un
      // compromis entre sécurité (peu de perte en cas d'arrêt brutal) et coût
      // disque négligeable. Réglable (MC_SAUVEGARDE_MS) : les tests d'intégration
      // en ont besoin d'un intervalle court pour vérifier la sauvegarde périodique
      // sans attendre deux minutes.
      planifierSauvegarde();
    }
    /* Cadence (SPEC-ARCHI-012) : 45 s en mode fermé (perte maximale d'un crash
       brutal), 120 s en mode ouvert (inchangé) ; MC_SAUVEGARDE_MS la règle pour
       les tests. Recalculée à chaque tour : l'ouverture/fermeture à chaud du
       réseau change la cadence sans redémarrage. */
    function cadenceSauvegardeMs() {
      return parseInt(process.env.MC_SAUVEGARDE_MS, 10) || (EP.reseauOuvert ? CA.BORNES.SAUVEGARDE_OUVERT_MS : CA.BORNES.SAUVEGARDE_FERME_MS);
    }
    function planifierSauvegarde() {
      setTimeout(() => { sauvegarderMondeAsync('cadence', false); planifierSauvegarde(); }, cadenceSauvegardeMs());
    }
  }

  MC.ServeurSauvegarde = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
