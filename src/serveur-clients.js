/* serveur-clients.js — les clients connectés
   Registre des clients, pause du poste, diffusion, envoi, fermeture,
   blocs du monde diffusés par tic.

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
    const { Buffer, clearTimeout, process, require, setImmediate, setInterval, setTimeout } = S.hote;
    const {
      fs, NP, J, CA, admin, monde, chat, guildes, joueursRegistre, recitsRegistre,
      enregistrementJoueur, sauvegarderMondeAsync, journal,
    } = S;
    const EP = S.EP;   // état partagé modifiable, à forme fixe (créé par server.js)
    Object.assign(S, {
      definirPause, armerAbsence, marquerPoste, diffuser, noterBlocMonde,
      diffuserBlocsMonde, guildeResume, envoyer, fermer, traceReseauActive, tracerMessage,
    });

    // ── clients ──────────────────────────────────────────────────────────────────
    EP.prochainId = 1;
    const clients = new Map();          // id -> {id, nom, socket, pos, yaw, pitch, locaux, vivant}
    S.clients = clients;

    // ── pause, terminaison et un seul poste (SPEC-ARCHI-007 à 011) ───────────────
    /* La pause concerne le POSTE (une connexion applicative, n joueurs locaux) et
       n'existe qu'en réseau FERMÉ : en mode ouvert d'autres joueurs partagent le
       monde, aucune pause ne peut l'arrêter. Elle gèle TOUT ce qui avance avec le
       temps (la boucle ne fait plus de pas et rebase `dernier` : la reprise ne
       rattrape rien, SPEC-ARCHI-010/011). */
    EP.enPause = false;
    EP.pauseRev = 0;
    EP.pauseParAbsence = false;           // pause posée par le serveur quand le dernier client est parti
    EP.minuteurAbsence = null;
    EP.arretEnCours = false;
    const GRACE_ARRET_MS = parseInt(process.env.MC_GRACE_ARRET_MS, 10) || CA.BORNES.GRACE_ARRET_S * 1000;
    S.GRACE_ARRET_MS = GRACE_ARRET_MS;
    function messagePause() { return { t: NP.MSG.PAUSE_ETAT, actif: EP.enPause, rev: EP.pauseRev }; }
    function definirPause(actif, parAbsence) {
      actif = !!actif;
      if (actif === EP.enPause) return;
      EP.enPause = actif; EP.pauseRev++; EP.pauseParAbsence = actif && !!parAbsence;
      EP.dernier = S.performance.now();                     // rebasage : le premier dt de la reprise ne contient pas la pause
      if (actif) sauvegarderMondeAsync('pause', true);
      diffuser(messagePause());
      journal(actif ? 'monde en pause' : 'reprise du monde');
    }
    function armerAbsence(delaiMs) {
      if (EP.minuteurAbsence) return;
      const delai = delaiMs || GRACE_ARRET_MS;
      journal(`plus aucun client — arrêt dans ${delai / 1000} s sans reconnexion`);
      EP.minuteurAbsence = setTimeout(() => {
        EP.minuteurAbsence = null;
        if (clientsActifs() === 0 && !EP.reseauOuvert) S.arreter('absence de client');
      }, delai);
    }
    /* Un client se (re)connecte : le délai de grâce est annulé, et une pause posée
       par l'absence (pas par le joueur) est levée — l'actualisation de la page
       reprend la partie. Une pause demandée par le joueur, elle, persiste. */
    /* Un client est « actif » s'il a rejoint la partie OU s'il parle au poste (PAUSE,
       RESEAU, ARRET depuis la boucle locale : c'est la liaison de statut du menu). Une
       WebSocket qui s'ouvre sans jamais rien faire ne compte pas : elle ne retarde
       ni n'annule l'arrêt du serveur orphelin. */
    function clientsActifs() {
      let n = 0;
      clients.forEach(x => { if (x.poste) n++; });
      return n;
    }
    function marquerPoste(c) {
      if (c.poste) return;
      c.poste = true;
      clientPresent();
    }
    function clientPresent() {
      if (EP.minuteurAbsence) { clearTimeout(EP.minuteurAbsence); EP.minuteurAbsence = null; }
      if (EP.pauseParAbsence) definirPause(false);
    }

    /* SPEC-BANC-103 : trace des messages échangés, côté serveur. Avec `--journal RESEAU:trace`,
       chaque message reçu ou envoyé laisse une ligne `recu|envoi <type> seq=<seq|-> taille=<octets>
       joueur=#<id>` dans le journal (console ET fichier du serveur) : un test réseau en échec joint
       ces lignes, avec le journal du serveur pendant le test (tools/diagnostics.js). Sans cette
       option, rien n'est construit : un test sur un message ne coûte rien en exploitation. */
    function traceReseauActive() { return !!S.logReseau && J.niveau('RESEAU') === 'trace'; }
    function tracerMessage(sens, msg, taille, c) {
      const seq = msg && msg.seq !== undefined ? msg.seq : (msg && msg.s !== undefined ? msg.s : null);
      S.logReseau.trace(sens + ' ' + (msg ? msg.t : '?') + ' seq=' + (typeof seq === 'number' ? seq : '-') + ' taille=' + taille + ' joueur=#' + (c ? c.id : '*'));
    }
    function diffuser(msg, saufId) {
      const texte = JSON.stringify(msg);
      const trame = NP.encoder(texte, NP.OP.TEXTE, Buffer.alloc);
      const trace = traceReseauActive();
      clients.forEach(c => {
        if (c.id === saufId || !c.vivant) return;
        if (trace) tracerMessage('envoi', msg, texte.length, c);
        try { c.socket.write(trame); } catch (e) { fermer(c, 'ecriture impossible'); }
      });
    }
    /* SPEC-SYNC-018/019 : les changements de blocs que le MONDE décide (croissance
       des cultures, étapes du feu) ne vont qu'aux clients dont un joueur est à
       moins de PORTEE_BLOCS_MONDE blocs, en UNE écriture par client et par tic
       (les trames sont concaténées), plafonnée à BLOCS_MONDE_MAX_PAR_TIC blocs par
       client : au-delà, le surplus est abandonné pour ce client (il retrouve l'état
       exact par les overrides quand il recharge le chunk). */
    const PORTEE_BLOCS_MONDE = parseInt(process.env.MC_TEST_PORTEE_BLOCS, 10) || 96, BLOCS_MONDE_MAX_PAR_TIC = 128;
    if (process.env.MC_TEST_PORTEE_BLOCS) setImmediate(() => journal('ATTENTION : MC_TEST_PORTEE_BLOCS actif — portée de diffusion des blocs du monde réduite à ' + PORTEE_BLOCS_MONDE + ' blocs (réglage de test, jamais en exploitation)'));
    let blocsMondeEnAttente = [];
    function noterBlocMonde(x, y, z, id, etat) { blocsMondeEnAttente.push({ x, y, z, id, etat: etat || 0 }); }
    function diffuserBlocsMonde() {
      const liste = blocsMondeEnAttente;
      if (!liste.length) return;
      blocsMondeEnAttente = [];
      const trames = liste.map(b => NP.encoder(JSON.stringify({ t: NP.MSG.BLOC, x: b.x, y: b.y, z: b.z, id: b.id, etat: b.etat }), NP.OP.TEXTE, Buffer.alloc));
      clients.forEach(c => {
        if (!c.vivant || !c.rejoint || !c.joueurs) return;
        const pos = c.joueurs.map(x => x.joueur.state.pos);
        const choisies = [];
        for (let i = 0; i < liste.length && choisies.length < BLOCS_MONDE_MAX_PAR_TIC; i++) {
          const b = liste[i];
          if (pos.some(p => Math.hypot(p.x - b.x, p.z - b.z) < PORTEE_BLOCS_MONDE)) choisies.push(trames[i]);
        }
        if (!choisies.length) return;
        try { c.socket.write(Buffer.concat(choisies)); } catch (e) { fermer(c, 'ecriture impossible'); }
      });
    }
    /* Résumé de la faction principale d'un joueur (SPEC-ARCHI-029) : { id, nom, rang }
       ou null. Court (jamais l'état complet des guildes), donc sans coût de diffusion. */
    function guildeResume(nom) {
      const p = MC.Guildes.factionsDe(guildes, nom).principale;
      const f = p && guildes.factions.get(p);
      return f ? { id: f.id, nom: f.nom, rang: MC.Guildes.rangDe(guildes, f.id, nom) } : null;
    }
    function envoyer(c, msg) {
      if (!c || !c.vivant) return;
      try {
        const texte = JSON.stringify(msg);
        if (traceReseauActive()) tracerMessage('envoi', msg, texte.length, c);
        c.socket.write(NP.encoder(texte, NP.OP.TEXTE, Buffer.alloc));
      } catch (e) { fermer(c, 'ecriture impossible'); }
    }

    function fermer(c, raison) {
      if (!c || !c.vivant) return;
      c.vivant = false;
      clients.delete(c.id);
      // B1 : range l'inventaire/équipement de chaque joueur local dans le
      // registre nommé (la banque, elle, reste un conteneur vivant dans `banques`).
      if (c.joueurs) {
        c.joueurs.forEach(js => {
          // un conducteur qui part met pied à terre : l'engin reste là, libre, et le siège n'est pas gardé
          const stV = js.joueur && js.joueur.state;
          if (stV && stV.monture) MC.Vehicules.descendre(stV, monde, MC.PlayerConst.PW, MC.PlayerConst.PH);
          if (!js.cleReg) return;
          joueursRegistre.set(js.cleReg, enregistrementJoueur(js));
          if (js.recit) recitsRegistre.set(js.cleReg, S.RS.exporter(js.recit, js.recitFin));
        });
      }
      if (c.sessionId) MC.Admin.fermerSession(admin, c.sessionId, EP.heure);
      try { c.socket.destroy(); } catch (e) {}
      const m = chat.systeme(c.nom + ' a quitté la partie');
      diffuser({ t: NP.MSG.QUITTE, id: c.id, nom: c.nom });
      if (m) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
      journal(`- ${c.nom} (#${c.id}) parti — ${raison || 'deconnexion'} · ${clients.size} en ligne`);
      /* SPEC-ARCHI-008 (b) : en mode FERMÉ, le départ du dernier client (onglet
         fermé brutalement compris) sauvegarde tout de suite, met le monde en
         pause et arme l'arrêt après le délai de grâce. En mode OUVERT, jamais de
         terminaison sur départ du dernier joueur (c). */
      if (EP.reseauOuvert && c.rejoint && !EP.arretEnCours) sauvegarderAuDepart();
      if (c.poste && !EP.reseauOuvert && clientsActifs() === 0 && !EP.arretEnCours) {
        sauvegarderMondeAsync('dernier client', true);
        definirPause(true, true);
        armerAbsence();
      }
    }

    /* Mode OUVERT : le départ d'un joueur sauvegarde aussi (un crash ne coûte pas jusqu'à
       toute la cadence de 2 minutes), avec un débounce : au plus une sauvegarde de départ
       toutes les 10 s, jamais un travail par départ à 100 joueurs. */
    let departSauveT = null, departSauveDernier = 0;
    function sauvegarderAuDepart() {
      if (departSauveT) return;
      const delai = Math.max(1500, departSauveDernier + 10000 - Date.now());
      departSauveT = setTimeout(() => {
        departSauveT = null; departSauveDernier = Date.now();
        if (!EP.arretEnCours) sauvegarderMondeAsync('départ d\'un joueur', true);
      }, delai);
    }

    /* MC_TEST_PROFIL_TICS=<fichier> : profil des tics du serveur, réservé aux bancs et aux
       suites d'intégration (tools/mesure-tics.js, tests/integration-archi-tics.js), jamais
       en exploitation. Relève la durée de chaque tic et de ses sections (génération de
       chunks, entretien du monde, entités, ETAT…), toute autre tâche longue de la boucle
       d'évènements (traitement d'un message, sérialisation d'une sauvegarde) et le retard
       de la boucle (perf_hooks.monitorEventLoopDelay), puis l'écrit toutes les 500 ms
       dans le fichier (JSON). Désactivé : aucun coût (un `if` par section). */
    const profilTics = (function () {
      const fichier = process.env.MC_TEST_PROFIL_TICS;
      if (!fichier) return null;
      setImmediate(() => journal('ATTENTION : MC_TEST_PROFIL_TICS actif — durée de chaque tic relevée dans ' + fichier + ' (réglage de test, jamais en exploitation)'));
      const { performance: perf, monitorEventLoopDelay } = require('perf_hooks');
      const h = monitorEventLoopDelay({ resolution: 5 });
      h.enable();
      const p = { tics: [], longs: [], taches: [], sections: null, t0: 0, marque: 0, chunks: 0 };
      p.debutTic = () => { p.sections = {}; p.t0 = p.marque = perf.now(); };
      // ferme la section en cours (depuis la marque précédente) sous ce nom
      p.section = (nom) => { const n = perf.now(); p.sections[nom] = (p.sections[nom] || 0) + (n - p.marque); p.marque = n; };
      p.finTic = (ecartMs) => {
        const ms = perf.now() - p.t0;
        if (p.tics.length < 200000) p.tics.push([Date.now(), +ms.toFixed(2), +ecartMs.toFixed(1)]);
        if (ms > 10 && p.longs.length < 20000) {
          const s = {};
          Object.keys(p.sections).forEach(k => { if (p.sections[k] >= 0.5) s[k] = +p.sections[k].toFixed(1); });
          p.longs.push({ t: Date.now(), ms: +ms.toFixed(1), sections: s });
        }
      };
      // une tâche hors tic (message, sauvegarde…) : gardée si elle dure plus de 5 ms
      p.tache = (nom, ms) => { if (ms > 5 && p.taches.length < 5000) p.taches.push({ t: Date.now(), nom, ms: +ms.toFixed(1) }); };
      p.maintenant = () => perf.now();
      const getChunkOrig = monde.getChunk;
      monde.getChunk = function (cx, cz, create) { if (create && !monde.chunkDe(cx, cz)) p.chunks++; return getChunkOrig.apply(this, arguments); };
      const ecrire = () => {
        const boucle = { p50: h.percentile(50) / 1e6, p99: h.percentile(99) / 1e6, max: h.max / 1e6 };
        // atomique (temporaire puis renommage) : le banc ne lit jamais un fichier à moitié écrit
        try {
          fs.writeFileSync(fichier + '.tmp', JSON.stringify({ pid: process.pid, tics: p.tics, longs: p.longs, taches: p.taches, boucle, chunksGeneres: p.chunks }));
          fs.renameSync(fichier + '.tmp', fichier);
        } catch (e) { /* lecture concurrente (Windows) : la prochaine écriture passera */ }
      };
      const t = setInterval(ecrire, 500);
      if (t.unref) t.unref();
      process.on('exit', ecrire);
      return p;
    })();
    S.profilTics = profilTics;
    // SPEC-BANC-106 : filtre des erreurs remontées par les clients, partagé par toutes les connexions
    const filtreRemontees = J.filtreRemontee();
    S.filtreRemontees = filtreRemontees;
  }

  MC.ServeurClients = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
