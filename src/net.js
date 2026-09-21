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
      onStatut: opts.onStatut || function () {},
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

    function connecter(hote, nom, locaux) {
      if (ws) deconnecter();
      statut('connexion');
      try {
        ws = new WebSocket(url(hote));
      } catch (e) {
        statut('erreur', e.message);
        return false;
      }

      ws.onopen = function () {
        envoyer({ t: NP.MSG.REJOINDRE, nom: nom || 'Joueur', locaux: locaux || 1 });
      };

      ws.onmessage = function (ev) {
        var m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        recevoir(m);
      };

      /* Une coupure ne doit pas emporter la partie : on repasse en solo et on
         le dit. Sans cela, le joueur se retrouve devant un monde fige sans
         comprendre pourquoi. */
      ws.onclose = function () {
        ws = null;
        distants.clear();
        mobsDistants.clear();
        if (etat !== 'erreur') statut('hors ligne', 'connexion perdue');
      };
      ws.onerror = function () { statut('erreur', 'connexion impossible'); };
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
          break;

        case NP.MSG.BLOC:
          hooks.onBloc(m.x, m.y, m.z, m.id);
          break;

        case NP.MSG.CHAT:
          hooks.onChat({ auteur: m.auteur, texte: m.texte, type: m.type, t: m.ts });
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

        case NP.MSG.ETAT:
          (m.joueurs || []).forEach(function (j) {
            if (j.id === monId) return;                 // on ne se suit pas soi-meme
            var d = distants.get(j.id);
            if (!d) {
              d = { id: j.id, nom: 'Joueur ' + j.id, pos: { x: j.x, y: j.y, z: j.z },
                    cible: { x: j.x, y: j.y, z: j.z }, yaw: j.yaw || 0 };
              distants.set(j.id, d);
            } else {
              // on vise la nouvelle position, l'interpolation lissera
              d.cible.x = j.x; d.cible.y = j.y; d.cible.z = j.z;
              d.yaw = j.yaw || 0;
            }
          });
          (m.mobs || []).forEach(function (e) {
            var d = mobsDistants.get(e.e);
            if (!d) mobsDistants.set(e.e, { eid: e.e, type: e.t,
                                            pos: { x: e.x, y: e.y, z: e.z },
                                            cible: { x: e.x, y: e.y, z: e.z }, yaw: e.yaw });
            else { d.cible.x = e.x; d.cible.y = e.y; d.cible.z = e.z; d.yaw = e.yaw; }
          });
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

    /* Position envoyée à cadence réduite : 60 envois par seconde saturent
       inutilement, 10 suffisent puisque les autres interpolent. */
    function pousserPosition(dt, st) {
      if (!enLigne()) return false;
      envoiT += dt;
      if (envoiT < 0.1) return false;
      envoiT = 0;
      return envoyer({ t: NP.MSG.BOUGE, x: +st.pos.x.toFixed(2), y: +st.pos.y.toFixed(2),
                       z: +st.pos.z.toFixed(2), yaw: +st.yaw.toFixed(2),
                       pitch: +st.pitch.toFixed(2) });
    }

    function poserBloc(x, y, z, id) {
      return envoyer({ t: NP.MSG.BLOC, x: x, y: y, z: z, id: id });
    }
    function envoyerChat(texte) {
      return envoyer({ t: NP.MSG.CHAT, texte: texte });
    }

    return {
      connecter: connecter, deconnecter: deconnecter, enLigne: enLigne,
      envoyer: envoyer, poserBloc: poserBloc, envoyerChat: envoyerChat,
      pousserPosition: pousserPosition, interpoler: interpoler,
      distants: distants, mobsDistants: mobsDistants,
      get etat() { return etat; },
      get monId() { return monId; },
      get erreur() { return derniereErreur; },
    };
  }

  MC.createNetClient = creerClient;
})(typeof globalThis !== 'undefined' ? globalThis : this);
