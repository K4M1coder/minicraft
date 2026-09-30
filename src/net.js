/* net.js — client réseau. Seule couche qui connaît WebSocket ; tout ce qui
   relève du protocole vit dans net-protocol.js, donc testé sans connexion. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  function creerClient(opts) {
    opts = opts || {};
    var NP = MC.NetProtocol;
    var ws = null;
    var etat = 'hors ligne';     // 'hors ligne' | 'connexion' | 'en ligne' | 'erreur'
    var monId = null;
    var distants = new Map();    // id -> {id, nom, pos, yaw, cible}
    var mobsDistants = new Map();
    var derniereErreur = null;
    var envoiT = 0;

    var hooks = {
      onBienvenue: opts.onBienvenue || function () {},
      onBloc: opts.onBloc || function () {},
      onChat: opts.onChat || function () {},
      onEtat: opts.onEtat || function () {},
      onArrive: opts.onArrive || function () {},
      onQuitte: opts.onQuitte || function () {},
      // B4 (SPEC-PVP-001 à 006) : victoire/défaite, proposition/début/fin de
      // duel, réputation/hors-la-loi — un seul message s→c, `MC.ContratsV2.
      // validerPvp` déjà appliqué (voir `case NP.MSG.PVP` plus bas).
      onPvp: opts.onPvp || function () {},
      onStatut: opts.onStatut || function () {},
      // serveur autoritaire : l'état qui fait foi pour nos joueurs, et le butin reçu
      onToi: opts.onToi || function () {},
      onDonne: opts.onDonne || function () {},
      // connexion refusée (liste noire/blanche, bannissement, e-mail exigé…)
      onRefus: opts.onRefus || function () {},
      // réponse du panneau admin en jeu (SPEC-ADMIN-006)
      onAdminRep: opts.onAdminRep || function () {},
      // L45 : offres d'un PNJ (réponse à 'consulter' ou 'echanger', SPEC-SYNC-023)
      onTroc: opts.onTroc || function () {},
      // B1 (SPEC-SYNC-008) : réconciliation inventaire/équipement/grille —
      // seule source de vérité en ligne (docs/vague-2/B1.md § 6)
      onInvMaj: opts.onInvMaj || function () {},
      // B1 (étape 7-8, SPEC-SYNC-012/013/015) : contenu d'un conteneur posé
      // (coffre, fourneau, armoire, étagère, bibliothèque, distributeur) ou
      // de la banque, ouvert en ligne — état complet à l'ouverture, deltas
      // ensuite (aux AUTRES abonnés seulement, voir INV_MAJ.conteneurs pour
      // l'auteur d'un transfert).
      onConteneurEtat: opts.onConteneurEtat || function () {},
      onConteneurMaj: opts.onConteneurMaj || function () {},
      // Revue adversariale (item 3) : CONTENEUR_FERMER, jusqu'ici seulement
      // c→s, sert AUSSI de notification s→c quand le serveur force la
      // fermeture (conteneur cassé, éventuellement remplacé par un autre —
      // jamais de resubscription fantôme sur la nouvelle clé).
      onConteneurFerme: opts.onConteneurFerme || function () {},
      // SPEC-SERVEUR-009 : réponse à demanderOverrides — les seuls overrides
      // du chunk (cx, cz) demandé, jamais le monde entier.
      onOverridesChunk: opts.onOverridesChunk || function () {},
    };

    function statut(e, info) {
      etat = e;
      derniereErreur = info || null;
      hooks.onStatut(e, info);
    }

    function url(hote) {
      if (hote) return hote;
      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return proto + '//' + location.host;
    }

    function connecter(hote, nom, locaux, opts2) {
      opts2 = opts2 || {};
      if (ws) deconnecter();
      statut('connexion');
      var socket;
      try {
        socket = ws = new WebSocket(url(hote));
      } catch (e) {
        statut('erreur', e.message);
        return false;
      }
      /* Chaque gestionnaire vérifie qu'il appartient à la socket COURANTE : la
         fermeture d'une ancienne connexion arrive après coup, et remettait
         `ws` à null sous les pieds de la nouvelle — qui perdait alors son
         message d'arrivée ou sa pose de bloc. */
      function courante() { return ws === socket; }

      socket.onopen = function () {
        if (!courante()) return;
        envoyer({ t: NP.MSG.REJOINDRE, nom: nom || 'Joueur', locaux: locaux || 1,
                  email: opts2.email || null, invitation: opts2.invitation || null });
      };

      socket.onmessage = function (ev) {
        if (!courante()) return;
        var m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        recevoir(m);
      };

      /* Une coupure ne doit pas emporter la partie : on repasse en solo et on
         le dit. Sans cela, le joueur se retrouve devant un monde fige sans
         comprendre pourquoi. */
      socket.onclose = function () {
        if (!courante()) return;
        ws = null;
        distants.clear();
        mobsDistants.clear();
        if (etat !== 'erreur') statut('hors ligne', 'connexion perdue');
      };
      socket.onerror = function () { if (courante()) statut('erreur', 'connexion impossible'); };
      return true;
    }

    function deconnecter() {
      if (ws) { try { ws.close(); } catch (e) {} }
      ws = null;
      distants.clear();
      mobsDistants.clear();
      statut('hors ligne');
    }

    function enLigne() { return etat === 'en ligne'; }

    function envoyer(msg) {
      if (!ws || ws.readyState !== 1) return false;
      try { ws.send(JSON.stringify(msg)); return true; } catch (e) { return false; }
    }

    function recevoir(m) {
      if (!m || typeof m.t !== 'string') return;
      switch (m.t) {
        case NP.MSG.BIENVENUE:
          monId = m.id;
          statut('en ligne');
          (m.joueurs || []).forEach(function (j) {
            distants.set(j.id, { id: j.id, nom: j.nom,
                                 pos: { x: j.x, y: j.y, z: j.z },
                                 cible: { x: j.x, y: j.y, z: j.z }, yaw: j.yaw || 0 });
          });
          hooks.onBienvenue(m);
          if (m.toi) hooks.onToi(m.toi);
          break;

        case NP.MSG.DONNE:
          hooks.onDonne(m);
          break;

        // B1 (SPEC-SYNC-008) : réconciliation inventaire/équipement/grille
        case NP.MSG.INV_MAJ:
          hooks.onInvMaj(m);
          break;

        // B1 (étape 7-8) : contenu (complet, ou delta) d'un conteneur posé/banque
        case NP.MSG.CONTENEUR_ETAT:
          hooks.onConteneurEtat(m);
          break;
        case NP.MSG.CONTENEUR_MAJ:
          hooks.onConteneurMaj(m);
          break;
        // Revue adversariale (item 3) : le serveur force une fermeture
        // (conteneur cassé pendant qu'on l'avait ouvert) — jamais envoyé
        // par ce client (CONTENEUR_FERMER c→s reste inchangé, voir envoyer()).
        case NP.MSG.CONTENEUR_FERMER:
          hooks.onConteneurFerme(m);
          break;

        case NP.MSG.REFUS:
          statut('erreur', m.motif);
          hooks.onRefus(m.motif);
          break;

        case NP.MSG.ADMIN_REP:
          hooks.onAdminRep(m);
          break;

        case NP.MSG.BLOC:
          hooks.onBloc(m.x, m.y, m.z, m.id, m.etat || 0);
          break;

        // SPEC-SERVEUR-009 : overrides d'un chunk demandé (demanderOverrides)
        case NP.MSG.OVERRIDES_CHUNK:
          hooks.onOverridesChunk(m.cx, m.cz, m.blocs || []);
          break;

        case NP.MSG.CHAT:
          hooks.onChat({ auteur: m.auteur, texte: m.texte, type: m.type, t: m.ts });
          break;

        // L45, SPEC-SYNC-023 : réponse du serveur à 'consulter'/'echanger'
        case NP.MSG.TROC:
          hooks.onTroc(m);
          break;

        case NP.MSG.ARRIVE:
          distants.set(m.id, { id: m.id, nom: m.nom, pos: { x: 0, y: -100, z: 0 },
                               cible: { x: 0, y: -100, z: 0 }, yaw: 0 });
          hooks.onArrive(m);
          break;

        case NP.MSG.QUITTE:
          distants.delete(m.id);
          hooks.onQuitte(m);
          break;

        // B4 (SPEC-PVP-001 à 006) : évènements PvP destinés à CE joueur.
        case NP.MSG.PVP: {
          var vp = MC.ContratsV2.validerPvp(m);
          if (vp) hooks.onPvp(vp);
          break;
        }

        case NP.MSG.ETAT:
          var presents = {};
          (m.joueurs || []).forEach(function (j) {
            if (j.id === monId) return;                 // nos joueurs sont prédits, pas suivis
            // un poste peut porter plusieurs joueurs (écran partagé) : clé id/j
            var cle = j.j ? j.id + '/' + j.j : j.id;
            presents[cle] = 1;
            var d = distants.get(cle);
            if (!d) {
              d = { id: cle, nom: (j.nom || 'Joueur ' + j.id) + (j.j ? ' (' + (j.j + 1) + ')' : ''),
                    pos: { x: j.x, y: j.y, z: j.z }, cible: { x: j.x, y: j.y, z: j.z }, yaw: j.yaw || 0 };
              distants.set(cle, d);
            } else {
              // on vise la nouvelle position, l'interpolation lissera
              d.cible.x = j.x; d.cible.y = j.y; d.cible.z = j.z;
              d.yaw = j.yaw || 0;
            }
          });
          // les joueurs d'écran partagé absents du relevé sont partis
          distants.forEach(function (d, cle) {
            if (typeof cle === 'string' && !presents[cle]) distants.delete(cle);
          });
          (m.mobs || []).forEach(function (e) {
            var d = mobsDistants.get(e.e);
            if (!d) mobsDistants.set(e.e, { eid: e.e, type: e.t, item: e.i, genre: e.g, arme: e.a,
                                            variante: e.v, role: e.r, nom: e.n, w: 0.6, h: 1.8,
                                            pos: { x: e.x, y: e.y, z: e.z },
                                            cible: { x: e.x, y: e.y, z: e.z }, yaw: e.yaw });
            else { d.cible.x = e.x; d.cible.y = e.y; d.cible.z = e.z; d.yaw = e.yaw; }
          });
          if (m.toi) hooks.onToi(m.toi);
          // les mobs absents du relevé ont disparu côté serveur
          var vus = {};
          (m.mobs || []).forEach(function (e) { vus[e.e] = 1; });
          mobsDistants.forEach(function (d, id) { if (!vus[id]) mobsDistants.delete(id); });
          hooks.onEtat(m);
          break;
      }
    }

    /* Interpolation : le serveur n'envoie qu'à 10 Hz, l'affichage tourne à 60.
       Sans lissage, les autres joueurs avanceraient par saccades. */
    function interpoler(dt) {
      var k = 1 - Math.exp(-12 * dt);
      distants.forEach(function (d) {
        d.pos.x += (d.cible.x - d.pos.x) * k;
        d.pos.y += (d.cible.y - d.pos.y) * k;
        d.pos.z += (d.cible.z - d.pos.z) * k;
      });
      mobsDistants.forEach(function (d) {
        d.pos.x += (d.cible.x - d.pos.x) * k;
        d.pos.y += (d.cible.y - d.pos.y) * k;
        d.pos.z += (d.cible.z - d.pos.z) * k;
      });
    }

    /* Le serveur fait autorité : on ne lui envoie plus sa position, mais nos
       entrées, une par image. Il les rejoue et nous renvoie la position qui
       fait foi (voir synchro.js). pousserPosition ne sert plus qu'à rester
       compatible avec un appelant d'autrefois. */
    function pousserPosition() { return false; }
    function envoyerEntree(e, j) {
      return envoyer({ t: NP.MSG.ENTREE, s: e.s, j: j || 0, dt: +e.dt.toFixed(4), k: e.k,
                       yaw: +e.yaw.toFixed(4), pitch: +e.pitch.toFixed(4), v: e.v });
    }
    function attaquer(eid, degats, j) { return envoyer({ t: NP.MSG.ATTAQUE, eid: eid, degats: degats, j: j || 0 }); }
    /* SPEC-COMBAT-002 : attaque un autre JOUEUR — `cible` est la clé sous
       laquelle il figure dans `distants` (son id seul, ou "id/j" en écran
       partagé) ; le serveur seul décide si le coup porte (PvP autorisé et
       zones compatibles). */
    function attaquerJoueur(cible, degats, j) {
      return envoyer({ t: NP.MSG.ATTAQUE, joueurCible: cible, degats: degats, j: j || 0 });
    }
    function tirer(dir, vitesse, degats, genre, j) {
      return envoyer({ t: NP.MSG.TIR, dx: dir.x, dy: dir.y, dz: dir.z, vitesse: vitesse, degats: degats,
                       genre: genre || 'fleche', j: j || 0 });
    }
    function manger(id, j, caseInv) {
      var m = { t: NP.MSG.MANGER, id: id, j: j || 0 };
      if (caseInv !== undefined && caseInv !== null) m.i = caseInv;
      return envoyer(m);
    }
    function renaitre(j) { return envoyer({ t: NP.MSG.RENAITRE, j: j || 0 }); }

    /* `caseInv` (facultatif) : la case d'inventaire d'où vient le bloc posé —
       le serveur y retire l'objet (SPEC-SYNC-028). */
    function poserBloc(x, y, z, id, outil, j, etat, caseInv) {
      var m = { t: NP.MSG.BLOC, x: x, y: y, z: z, id: id, outil: outil || 0, j: j || 0, etat: etat || 0 };
      if (caseInv !== undefined && caseInv !== null) m.i = caseInv;
      return envoyer(m);
    }
    /* SPEC-SERVEUR-009 : demande les overrides d'UN chunk (coordonnées de
       chunk, pas de bloc) — appelé par game.js streamChunks au fur et à
       mesure qu'il décide de charger un nouveau chunk, jamais en bloc à la
       connexion (BIENVENUE ne porte plus qu'un voisinage borné). */
    function demanderOverrides(cx, cz) {
      return envoyer({ t: NP.MSG.OVERRIDES_DEMANDE, cx: cx, cz: cz });
    }
    function envoyerChat(texte) {
      return envoyer({ t: NP.MSG.CHAT, texte: texte });
    }
    /* SPEC-MECA-001 : le contenu d'un distributeur, envoyé quand on ferme son
       interface — le serveur en a besoin pour savoir quoi éjecter sur signal.
       Conservé pour un appelant solo/historique ; le client en ligne à jour
       préfère `ouvrirConteneur`/`fermerConteneur` + transferts (B1, étape 8). */
    function distribuerMaj(x, y, z, slots) {
      return envoyer({ t: NP.MSG.DISTRIB, x: x, y: y, z: z,
                        slots: (slots || []).map(function (s) { return s ? { id: s.id, n: s.n } : null; }) });
    }
    /* B1 (étape 7-8, SPEC-SYNC-012/013) : s'abonner à un conteneur posé, par
       position (coffre, fourneau, armoire, étagère, bibliothèque,
       distributeur, ou le bloc coffre-fort d'une banque) ou par `eid`
       (banquier, banque sans coffre-fort) — réponse `CONTENEUR_ETAT`
       (`hooks.onConteneurEtat`) si acceptée, refus silencieux sinon. */
    function ouvrirConteneur(cible, j) {
      var m = { t: NP.MSG.CONTENEUR_OUVRIR, j: j || 0 };
      if (cible && cible.eid !== undefined) m.eid = cible.eid;
      else { m.x = cible.x; m.y = cible.y; m.z = cible.z; }
      return envoyer(m);
    }
    /* `seq` requis seulement pour `cle:'grille'` (rend son contenu). */
    function fermerConteneur(cle, j, seq) {
      var m = { t: NP.MSG.CONTENEUR_FERMER, j: j || 0, cle: cle };
      if (seq !== undefined) m.seq = seq;
      return envoyer(m);
    }
    /* Panneau admin en jeu (SPEC-ADMIN-006) : une seule voie d'accès, l'action
       porte le détail. Le serveur revérifie toujours le rôle qu'il a
       lui-même attribué à la connexion — jamais un rôle affiché ici. */
    function admin(action, args) {
      return envoyer({ t: NP.MSG.ADMIN, action: action, args: args || {} });
    }
    /* L45, SPEC-SYNC-023 : consulter (pas de seq) ou echanger (seq requis,
       fourni par l'appelant — synchro.js tient déjà le compteur par joueur
       local) les offres d'un PNJ. */
    function troc(action, eid, opts) {
      opts = opts || {};
      var msg = { t: NP.MSG.TROC, action: action, eid: eid, j: opts.j || 0 };
      if (action === 'echanger') { msg.seq = opts.seq; msg.offre = opts.offre; msg.fois = opts.fois || 1; }
      return envoyer(msg);
    }

    return {
      connecter: connecter, deconnecter: deconnecter, enLigne: enLigne,
      envoyer: envoyer, poserBloc: poserBloc, envoyerChat: envoyerChat, admin: admin, distribuerMaj: distribuerMaj, troc: troc,
      demanderOverrides: demanderOverrides,
      ouvrirConteneur: ouvrirConteneur, fermerConteneur: fermerConteneur,
      pousserPosition: pousserPosition, interpoler: interpoler,
      envoyerEntree: envoyerEntree, attaquer: attaquer, attaquerJoueur: attaquerJoueur, tirer: tirer, manger: manger, renaitre: renaitre,
      distants: distants, mobsDistants: mobsDistants,
      get etat() { return etat; },
      get monId() { return monId; },
      get erreur() { return derniereErreur; },
    };
  }

  MC.createNetClient = creerClient;
})(typeof globalThis !== 'undefined' ? globalThis : this);
