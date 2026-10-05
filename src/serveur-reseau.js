/* serveur-reseau.js — écoute, poignée de main WebSocket et arrêt
   Écouteurs (boucle locale ou réseau ouvert), contrôle d'origine, poignée de
   main et trames WebSocket (MC.NetProtocol), bascule réseau, arrêt propre.

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
    const { Buffer, Promise, clearTimeout, process, require, setImmediate, setTimeout } = S.hote;
    const {
      http, crypto, NP, logReseau, PARAMS, CONF, CA, RELANCE, sauvegarderMondeAsync,
      sauvegarderMondeSync, dodo, SPAWN, clients, definirPause, diffuser, envoyer, fermer,
      journal, profilTics, arreterServeurHistoireTest, arreterServeurJeuTest, servir,
    } = S;
    const EP = S.EP;   // état partagé modifiable, à forme fixe (créé par server.js)
    Object.assign(S, {
      hoteLocal, ouvrirNavigateur, fermerEcouteurs, demarrerEcoute, messageReseau,
      definirReseau, arreter,
    });

    // ── serveur HTTP + bascule WebSocket ─────────────────────────────────────────
    /* Plusieurs écouteurs possibles (SPEC-ARCHI-002) : en mode FERMÉ, deux
       liaisons explicites 127.0.0.1 ET ::1 (jamais 0.0.0.0 ni ::) ; en mode OUVERT,
       un seul écouteur sur toutes les interfaces. Tous partagent les mêmes
       gestionnaires : c'est le MÊME serveur. */
    let ecouteurs = [];
    EP.portActuel = PARAMS.port;
    EP.adressesActives = [];
    function creerEcouteur() {
      const srv = http.createServer(servir);
      srv.on('upgrade', surUpgrade);
      return srv;
    }

    // SPEC-SECU-011 : liste blanche d'Origin, configurable via --origines (voir
    // src/parametres.js). Calculée UNE fois au démarrage — jamais par requête.
    // null = AUCUNE restriction, le choix par DÉFAUT, explicite et documenté
    // (--aide origines) : sans --origines, le jeu servi par ce même serveur
    // continue de fonctionner exactement comme avant (aucun Origin exigé).
    const ORIGINES_AUTORISEES = PARAMS.origines
      ? PARAMS.origines.split(',').map(s => s.trim()).filter(Boolean)
      : null;

    /* SPEC-ARCHI-003 : en mode fermé, l'Origin (s'il est présent) doit être l'une
       des trois origines locales du serveur, et l'en-tête Host un nom local
       (défense contre le rebond DNS) ; sans Origin (client non navigateur en
       boucle locale) la requête passe. En mode ouvert, la liste --origines
       (SPEC-SECU-011) s'applique comme avant. */
    function hoteLocal(req) {
      const h = String(req.headers['host'] || '').replace(/:\d+$/, '').toLowerCase();
      return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
    }
    /* Une connexion est « locale » — donc habilitée à RESEAU, ARRET et PAUSE — si
       TROIS choses concourent : l'adresse distante est de la boucle locale, l'en-tête
       Host est un nom local, et l'Origin est absente (client non navigateur) ou l'une
       des origines locales du serveur. L'adresse seule ne suffit PAS : en mode
       ouvert, une page tierce ouverte dans le navigateur de l'hôte se connecte
       depuis 127.0.0.1 avec `Origin: http://evil.example` ; derrière un
       mandataire inverse local, l'adresse est aussi celle de la boucle locale. */
    function connexionLocale(req, socket) {
      if (!CA.estAdresseLocale(socket.remoteAddress)) return false;
      if (req.headers['x-forwarded-for'] || req.headers['forwarded'] || req.headers['x-real-ip']) return false;   // mandataire
      if (!hoteLocal(req)) return false;
      const origine = req.headers['origin'];
      return !origine || CA.originesLocales(EP.portActuel).indexOf(origine) >= 0;
    }
    function requeteAutorisee(req) {
      if (EP.reseauOuvert) return NP.origineAutorisee(req.headers['origin'], ORIGINES_AUTORISEES);
      if (!hoteLocal(req)) return false;
      const origine = req.headers['origin'];
      return !origine || CA.originesLocales(EP.portActuel).indexOf(origine) >= 0;
    }

    function surUpgrade(req, socket) {
      if (!NP.estRequeteWebSocket(req.headers)) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }
      // SPEC-SECU-011 : décision PURE (src/net-protocol.js, testée sous Node) —
      // ici on ne fait que lire l'en-tête et refuser la poignée de main AVANT
      // toute allocation de client, avec un code d'erreur HTTP explicite.
      if (!requeteAutorisee(req)) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      const cle = req.headers['sec-websocket-key'];
      socket.write(NP.reponseHandshake(cle, (s) =>
        crypto.createHash('sha1').update(s).digest('base64')));
      socket.setNoDelay(true);

      const c = {
        id: EP.prochainId++, nom: 'Joueur', socket, vivant: true, locaux: 1,
        pos: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z }, yaw: 0, pitch: 0,
        rejoint: false, ip: socket.remoteAddress || '?',
        local: connexionLocale(req, socket),         // seule habilitée à RESEAU, ARRET, PAUSE (SPEC-ARCHI-005/008/009)
        role: null, sessionId: null,             // rôle d'administration (SPEC-ADMIN-006/008)
      };
      clients.set(c.id, c);
      // visible avec --journal RESEAU:debug (SPEC-BANC-109) ; toujours dans le tampon
      logReseau.debug(`poignée de main WebSocket acceptée (#${c.id}, ${c.ip})`);

      /* TCP ne respecte aucune frontière de message : une lecture peut contenir
         une demi-trame, ou trois. On accumule et on décode tant qu'une trame
         complète sort. Oublier cela donne des coupures aléatoires sous charge —
         précisément quand on en a le moins besoin. */
      let tampon = Buffer.alloc(0);
      socket.on('data', (bloc) => {
        tampon = Buffer.concat([tampon, bloc]);
        // SPEC-SECU-003 : un client qui annonce une trame énorme sans jamais la
        // compléter ferait grossir ce tampon indéfiniment — on borne AVANT de
        // tenter le moindre décodage.
        if (tampon.length > NP.TAMPON_MAX) { fermer(c, 'tampon de reception trop volumineux'); return; }
        for (;;) {
          const d = NP.decoder(tampon);
          if (!d) break;                                 // trame incomplète : on attend
          tampon = tampon.slice(d.consomme);

          // SPEC-SECU-004 (RFC 6455) : le client DOIT toujours masquer ses
          // trames ; en accepter une non masquée reviendrait à décoder du texte
          // en clair comme s'il avait été masqué — jamais silencieusement.
          if (!d.masque) { fermer(c, 'trame non masquee (RFC 6455)'); return; }

          if (d.opcode === NP.OP.FERME) { fermer(c, 'fermeture demandee'); return; }
          if (d.opcode === NP.OP.PING) {
            socket.write(NP.encoder(Buffer.from(d.charge), NP.OP.PONG, Buffer.alloc));
            continue;
          }
          if (d.opcode !== NP.OP.TEXTE) continue;

          let msg;
          try { msg = JSON.parse(NP.utf8Decoder(d.charge)); } catch (e) { continue; }
          if (S.traceReseauActive()) S.tracerMessage('recu', msg, d.charge.length, c);      // SPEC-BANC-103
          // SPEC-SECU-001 : une exception pendant le traitement NE DOIT fermer
          // QUE cette connexion fautive — jamais arrêter le processus ni couper
          // les autres clients déjà connectés.
          try {
            if (profilTics) { const t0p = profilTics.maintenant(); S.traiter(c, NP.valider(msg)); profilTics.tache('message ' + msg.t, profilTics.maintenant() - t0p); }
            else S.traiter(c, NP.valider(msg));
          } catch (e) {
            journal(`x exception en traitant un message de ${c.nom} (#${c.id}) : ${(e && e.stack) || e}`);
            fermer(c, 'exception de traitement');
            return;
          }
        }
      });

      socket.on('error', () => fermer(c, 'erreur socket'));
      /* http.Server ouvre ses sockets en `allowHalfOpen` : la fermeture propre du
         client (FIN) ne déclenche PAS 'close' tant que le serveur n'a pas fermé
         son côté. Jadis masqué par les écritures d'ETAT à 60 Hz (qui échouaient
         aussitôt), ce silence devient un défaut en pause : sans ETAT diffusé, un
         onglet fermé ne serait jamais constaté (SPEC-ARCHI-008). */
      socket.on('end', () => fermer(c, 'fin de connexion'));
      socket.on('close', () => fermer(c, 'socket fermee'));
    }

    // ── ouverture automatique du navigateur (SPEC-PACK-001) ─────────────────────
    /* « Lancé sans paramètre, il ouvre le jeu dans le navigateur » : uniquement
       quand AUCUN paramètre n'a été donné (pas même --port), pour ne jamais
       surprendre un usage scripté ou les tests, qui passent toujours au moins
       --port. Best-effort : sans environnement graphique, on l'ignore. */
    function ouvrirNavigateur(url) {
      try {
        const { spawn } = require('child_process');
        let cmd, args;
        if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', url]; }
        else if (process.platform === 'darwin') { cmd = 'open'; args = [url]; }
        else { cmd = 'xdg-open'; args = [url]; }
        spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
      } catch (e) { journal('navigateur non ouvert automatiquement : ' + e.message); }
    }

    // ── écoute : fermée par défaut, ouvrable à chaud (SPEC-ARCHI-002/004/005) ─────
    function ecouterUn(srv, port, hote) {
      return new Promise((resolve, reject) => {
        const surErreur = (e) => reject(e);
        srv.once('error', surErreur);
        const fin = () => {
          srv.removeListener('error', surErreur);
          srv.on('error', (e) => journal(`erreur d'écoute : ${e.message}`));
          resolve(srv.address().port);
        };
        if (hote) srv.listen(port, hote, fin); else srv.listen(port, fin);
      });
    }
    function adressesReseau() {
      const out = [];
      try {
        const ifs = require('os').networkInterfaces();
        Object.keys(ifs).forEach(nom => (ifs[nom] || []).forEach(a => {
          if (!a.internal && a.family === 'IPv4' && out.length < CA.BORNES.ADRESSES_MAX) out.push(a.address);
        }));
      } catch (e) { /* aucune interface lisible */ }
      return out.length ? out : ['0.0.0.0'];
    }
    /* MC_TEST_BOUCLE_LOCALE=1 : réservé au serveur de jeu des e2e de jouabilité
       (POST /tests/serveur-jeu, SPEC-JOUABLE-001 à 008). Ils ont besoin des règles
       du mode OUVERT (--serveur : plusieurs postes — la page ET le « Témoin » qui
       relit le serveur — et une page servie par un AUTRE port, que le mode fermé
       refuse par son contrôle d'origine), mais sans jamais exposer ce serveur
       jetable au réseau : il n'écoute alors que la boucle locale. */
    const BOUCLE_LOCALE_TEST = process.env.MC_TEST_BOUCLE_LOCALE === '1';
    S.BOUCLE_LOCALE_TEST = BOUCLE_LOCALE_TEST;
    if (BOUCLE_LOCALE_TEST) setImmediate(() => journal('ATTENTION : MC_TEST_BOUCLE_LOCALE actif — règles du mode ouvert, écoute sur la boucle locale seulement (réglage de test, jamais en exploitation)'));
    /* Ouvre les écouteurs du mode courant sur `port` (0 = éphémère) et renvoie le
       port réel. Lève l'erreur d'écoute (EADDRINUSE…) sans rien laisser ouvert. */
    async function ouvrirEcoute(port) {
      if (EP.reseauOuvert && !BOUCLE_LOCALE_TEST) {
        const srv = creerEcouteur();
        const p = await ecouterUn(srv, port, null);
        ecouteurs = [srv]; EP.adressesActives = adressesReseau();
        return p;
      }
      const s4 = creerEcouteur();
      const p = await ecouterUn(s4, port, '127.0.0.1');
      const liste = [s4], adr = ['127.0.0.1'];
      const s6 = creerEcouteur();
      try { await ecouterUn(s6, p, '::1'); liste.push(s6); adr.push('::1'); }
      catch (e) {
        if (e.code === 'EADDRINUSE') { s4.close(); throw e; }         // port pris sur ::1 : on tente le suivant
        journal(`IPv6 de boucle locale indisponible (${e.code || e.message}) — IPv4 seule`);
      }
      ecouteurs = liste; EP.adressesActives = adr;
      return p;
    }
    function fermerEcouteurs() {
      const l = ecouteurs; ecouteurs = [];
      return Promise.race([Promise.all(l.map(srv => new Promise(r => { try { srv.close(() => r()); } catch (e) { r(); } }))), dodo(500)]);
    }
    async function demarrerEcoute() {
      const candidats = CA.portsCandidats(PARAMS.port, PARAMS.portFixe);
      const essais = RELANCE ? 50 : 1;               // relance interne : le processus parent libère son port
      let derniere = null;
      for (let k = 0; k < essais; k++) {
        for (const port of candidats) {
          try { EP.portActuel = await ouvrirEcoute(port); return; }
          catch (e) { derniere = e; if (e.code !== 'EADDRINUSE') throw e; }
        }
        if (k + 1 < essais) await dodo(200);
      }
      throw derniere;
    }
    function messageReseau() {
      return { t: NP.MSG.RESEAU_ETAT, etat: EP.reseauOuvert ? CA.ETAT_RESEAU.OUVERT : CA.ETAT_RESEAU.FERME, port: EP.portActuel, adresses: EP.adressesActives };
    }
    /* SPEC-ARCHI-005 : ouvrir/fermer au réseau SANS redémarrer et sans couper les
       connexions locales (une socket déjà établie survit à la fermeture de
       l'écouteur). Fermer sauvegarde, puis expulse les connexions non locales. */
    let basculeReseau = Promise.resolve();
    function definirReseau(ouvrir) {
      basculeReseau = basculeReseau.then(() => basculerReseau(!!ouvrir)).catch(e => journal('échec de la bascule réseau : ' + ((e && e.message) || e)));
      return basculeReseau;
    }
    let echecsBasculeSimules = 0;
    /* MC_TEST_ECHEC_BASCULE=N : les N premières ouvertures d'écouteur d'une bascule échouent
       (1 : la nouvelle liaison échoue puis l'ancienne est restaurée ; 2 : les deux échouent) —
       tests de l'échec, jamais en exploitation. */
    async function ouvrirEcouteBascule(port) {
      if (echecsBasculeSimules < (parseInt(process.env.MC_TEST_ECHEC_BASCULE, 10) || 0)) {
        echecsBasculeSimules++;
        throw Object.assign(new Error('échec simulé'), { code: 'ETEST' });
      }
      return ouvrirEcoute(port);
    }
    async function basculerReseau(ouvrir) {
      if (EP.arretEnCours) return;
      if (ouvrir === EP.reseauOuvert) { diffuser(messageReseau()); return; }
      const ancien = EP.reseauOuvert, port = EP.portActuel;
      /* Un écouteur « toutes interfaces » et les deux liaisons de boucle locale se
         disputent le même port : on ferme l'ancien puis on ouvre le nouveau (les
         connexions déjà établies survivent). Rien d'autre ne change tant que la
         nouvelle liaison n'est pas ouverte : ni mode, ni pause, ni délai de grâce,
         ni expulsions — un échec laisse donc le serveur exactement comme avant. */
      EP.reseauOuvert = ouvrir;
      await fermerEcouteurs();
      try {
        await ouvrirEcouteBascule(port);
      } catch (e) {
        journal(`échec de la liaison ${ouvrir ? 'ouverte' : 'fermée'} sur le port ${port} : ${e.message} — retour à l'état précédent`);
        EP.reseauOuvert = ancien;
        try { await ouvrirEcouteBascule(port); }
        catch (e2) {
          journal(`liaison précédente irrécupérable (${e2.message}) — arrêt propre du serveur`);
          await arreter('écoute impossible');
          return;
        }
        diffuser(messageReseau());
        return;
      }
      if (ouvrir) {
        if (EP.minuteurAbsence) { clearTimeout(EP.minuteurAbsence); EP.minuteurAbsence = null; }
        if (EP.enPause) definirPause(false);                // aucune pause dans un monde ouvert
      } else {
        sauvegarderMondeAsync('fermeture réseau', true);
        clients.forEach(c => {
          if (c.local) return;
          envoyer(c, { t: NP.MSG.REFUS, motif: CA.MOTIFS_REFUS.RESEAU_FERME });
          setTimeout(() => fermer(c, 'reseau ferme'), 50);
        });
      }
      journal(EP.reseauOuvert ? `réseau OUVERT sur le port ${EP.portActuel} (${EP.adressesActives.join(', ')})` : `réseau FERMÉ — boucle locale seulement (${EP.adressesActives.join(', ')}:${EP.portActuel})`);
      diffuser(messageReseau());
    }

    /* SIGINT (Ctrl+C) ET SIGTERM (arrêt par un gestionnaire de services) doivent
       tous deux sauvegarder : un serveur seul persistant tourne typiquement sous
       un tel gestionnaire, qui n'envoie jamais SIGINT. À l'arrêt, la sauvegarde
       DOIT être synchrone (SPEC-SERVEUR-003/004) : le processus va se terminer
       juste après, une écriture asynchrone en cours serait perdue.

       Revue adversariale (test-race-save.js) : une sauvegarde PÉRIODIQUE peut
       être en vol au moment du signal. `sauvegardeArretee` empêche toute
       NOUVELLE sauvegarde async de démarrer, et on attend (au plus 1 s) que
       celle déjà en vol se termine avant d'écrire la sauvegarde finale — sans
       quoi son écriture, coupée en plein vol par `process.exit()`, laisserait
       un `.tmp` tronqué au sol (elle a désormais son propre fichier temporaire,
       donc ne peut plus corrompre CELUI de la sauvegarde finale, mais resterait
       quand même orpheline sans cette attente). */
    async function arreter(signal) {
      if (EP.arretEnCours) return;
      EP.arretEnCours = true;
      journal(`arrêt demandé (${signal})`);
      EP.sauvegardeArretee = true;
      arreterServeurHistoireTest();
      arreterServeurJeuTest();
      if (EP.minuteurAbsence) { clearTimeout(EP.minuteurAbsence); EP.minuteurAbsence = null; }
      if (CONF.mondeFichier) {
        if (EP.sauvegardeEnCours && EP.sauvegardeEnCoursAttente) {
          await Promise.race([EP.sauvegardeEnCoursAttente, dodo(1000)]);
        }
        const ok = sauvegarderMondeSync();
        journal(ok ? `monde sauvegardé dans ${CONF.mondeFichier}` : 'sauvegarde finale échouée');
      }
      clients.forEach(c => { try { c.socket.destroy(); } catch (e) {} });
      setTimeout(() => process.exit(0), 500);
      await fermerEcouteurs();
      process.exit(0);
    }
  }

  MC.ServeurReseau = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
