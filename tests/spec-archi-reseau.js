/* spec-archi-reseau.js — lot B-RESEAU du chantier « solo = serveur toujours
   présent » : la logique PURE derrière SPEC-ARCHI-037 (prédiction et
   réconciliation) et SPEC-ARCHI-040 (interpolation des distants). Le
   comportement de bout en bout (vrai serveur, vraie page, fermeture brutale
   d'un onglet) est prouvé par tests/integration-archi-reseau.js. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path');
  var RACINE = path.join(__dirname, '..');

  function joueur() {
    var w = MC.createWorld(4242);
    var col = w.findSpawnColumn();
    w.getChunk(Math.floor(col[0] / 16), Math.floor(col[1] / 16), true);
    var ents = MC.createEntities(w);
    var pl = MC.createPlayer(w, ents, MC.Modes.regles('survie', 'facile'));
    pl.state.pos.x = col[0] + 0.5; pl.state.pos.z = col[1] + 0.5;
    pl.state.pos.y = w.groundAt(col[0], col[1], true) + 1.2;
    return pl;
  }

  describe('B-RESEAU — prédiction, réconciliation et interpolation', {
    teste: 'MC.Synchro (prédiction/réconciliation) et net.interpoler sur des tables vides.',
    pourquoi: 'Solo fermé, écran partagé et réseau suivent le même chemin : la prédiction doit se corriger seule sur l\'état du serveur, et l\'interpolation ne doit rien faire quand personne d\'autre n\'est là.',
    attendu: 'une position prédite fausse est ramenée EXACTEMENT à celle du serveur (entrées confirmées oubliées) ; interpoler sur des tables vides ne lève rien et ne crée rien.',
  }, function () {

    it('SPEC-ARCHI-037 : une position imposée par le serveur corrige la prédiction (écart mesuré, entrées confirmées oubliées)', function () {
      var pl = joueur(), st = pl.state;
      var pred = MC.Synchro.creerPrediction();
      var x0 = st.pos.x, z0 = st.pos.z;
      var touches = { forward: 1, back: 0, left: 0, right: 0, jump: 0, sprint: 0 };
      for (var i = 0; i < 5; i++) MC.Synchro.rejouer(pl, [pred.enregistrer(0.016, touches, 0, 0, false)]);
      st.pos.x += 30;                                       // la prédiction a dérapé
      var serveur = { x: x0, y: st.pos.y, z: z0, vx: 0, vy: 0, vz: 0, sol: true, s: 5 };
      var ecart = MC.Synchro.reconcilier(pl, serveur, pred);
      A.gt(ecart, 25, 'l\'écart de prédiction est mesuré');
      A.equal(st.pos.x, x0, 'la position est celle du serveur');
      A.equal(st.pos.z, z0, 'z aussi');
      A.equal(pred.enAttente.length, 0, 'les entrées confirmées par le serveur sont oubliées');
    });

    it('SPEC-ARCHI-037 : les entrées non confirmées sont rejouées par-dessus la position du serveur', function () {
      var pl = joueur(), st = pl.state;
      var pred = MC.Synchro.creerPrediction();
      var touches = { forward: 1, back: 0, left: 0, right: 0, jump: 0, sprint: 0 };
      var e1 = pred.enregistrer(0.016, touches, 0, 0, false), e2 = pred.enregistrer(0.016, touches, 0, 0, false);
      MC.Synchro.rejouer(pl, [e1, e2]);
      var serveur = { x: st.pos.x - 10, y: st.pos.y, z: st.pos.z, vx: 0, vy: 0, vz: 0, sol: true, s: e1.s };
      MC.Synchro.reconcilier(pl, serveur, pred);
      A.equal(pred.enAttente.length, 1, 'seule l\'entrée 2 reste en attente');
      A.ok(st.pos.z !== serveur.z || st.pos.x !== serveur.x, 'l\'entrée non confirmée est rejouée (la position avance depuis celle du serveur)');
    });

    it('SPEC-ARCHI-040 : interpoler(dt) sur un client aux tables vides ne lève rien et ne modifie rien', function () {
      if (!MC.createNetClient) G.Function(fs.readFileSync(path.join(RACINE, 'src', 'net.js'), 'utf8'))();
      var net = MC.createNetClient({});
      A.equal(net.distants.size, 0); A.equal(net.mobsDistants.size, 0);
      net.interpoler(0.016);
      net.interpoler(0);
      A.equal(net.distants.size, 0, 'aucun joueur distant créé');
      A.equal(net.mobsDistants.size, 0, 'aucune créature distante créée');
      A.equal(net.etat, 'hors ligne', 'l\'état de la liaison n\'a pas bougé');
    });

    /* SPEC-ARCHI-042 : les succès sont arbitrés par le serveur ; le client ne fait
       qu'afficher ce qu'un message VALIDE lui annonce. */
    function clientAvecFauxSocket(hooks) {
      if (!MC.createNetClient) G.Function(fs.readFileSync(path.join(RACINE, 'src', 'net.js'), 'utf8'))();
      var ancien = G.WebSocket, socket = null;
      G.WebSocket = function () { socket = this; this.readyState = 1; this.send = function () {}; this.close = function () {}; };
      try {
        var net = MC.createNetClient(hooks);
        net.connecter('ws://faux', 'Test', 1);
      } finally { G.WebSocket = ancien; }
      return function recevoir(m) { socket.onmessage({ data: JSON.stringify(m) }); };
    }

    it('SPEC-ARCHI-042 : SUCCES_DEBLOQUE, SUCCES_ETAT et FOUDROYE valides atteignent leurs hooks, normalisés ; les invalides sont ignorés', function () {
      var vus = { debloque: [], etat: [], foudre: [] };
      var recevoir = clientAvecFauxSocket({
        onSuccesDebloque: function (m) { vus.debloque.push(m); },
        onSuccesEtat: function (m) { vus.etat.push(m); },
        onFoudroye: function (m) { vus.foudre.push(m); },
      });
      recevoir({ t: 'succes_debloque', j: 1, id: 'premier_bloc', parasite: 1 });
      recevoir({ t: 'succes_etat', j: 0, etat: { compte: { premier_bloc: 1 }, debloques: ['premier_bloc'] } });
      recevoir({ t: 'foudroye', j: 0 });
      A.deep(vus.debloque, [{ t: 'succes_debloque', j: 1, id: 'premier_bloc' }], 'déblocage normalisé (champ parasite écarté)');
      A.deep(vus.etat[0].etat, { compte: { premier_bloc: 1 }, debloques: ['premier_bloc'] });
      A.deep(vus.foudre, [{ t: 'foudroye', j: 0 }]);
      recevoir({ t: 'succes_debloque', j: 9, id: 'x' });
      recevoir({ t: 'succes_debloque', j: 0, id: '' });
      recevoir({ t: 'succes_etat', j: 0, etat: { compte: { x: -3 } } });
      recevoir({ t: 'succes_etat', j: 0 });
      recevoir({ t: 'foudroye', j: 7 });
      A.equal(vus.debloque.length, 1, 'déblocage invalide ignoré');
      A.equal(vus.etat.length, 1, 'état invalide ignoré');
      A.equal(vus.foudre.length, 1, 'foudre invalide ignorée');
    });

    it('SPEC-ARCHI-042 : audit statique — le client n\'attribue plus aucun succès, le serveur le fait', function () {
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      var serveur = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
      A.ok(!/signalerSucces\s*\(/.test(jeu), 'game.js n\'appelle plus signalerSucces');
      A.ok(!/tickerSucces/.test(jeu), 'game.js n\'échantillonne plus altitude, distance et nuit');
      A.ok(!/\.succes\.signaler\s*\(/.test(jeu), 'game.js n\'appelle jamais le suivi directement');
      A.ok(/onSuccesDebloque/.test(jeu) && /onSuccesEtat/.test(jeu) && /onFoudroye/.test(jeu), 'game.js câble les trois hooks d\'affichage');
      ['casser', 'fabriquer', 'manger', 'echange', 'banque', 'pvp_victoire', 'foudre', 'tuer', 'boss', 'lieu'].forEach(function (type) {
        A.ok(new RegExp("type: '" + type + "'").test(serveur), 'server.js signale l\'événement « ' + type + ' »');
      });
      A.ok(/'daycycle', 'succes'/.test(serveur), 'server.js charge le module des succès');
    });

    it('SPEC-ARCHI-040 : avec un joueur distant, interpoler rapproche sa position de sa cible', function () {
      if (!MC.createNetClient) G.Function(fs.readFileSync(path.join(RACINE, 'src', 'net.js'), 'utf8'))();
      var net = MC.createNetClient({});
      net.distants.set(1, { id: 1, nom: 'Bob', pos: { x: 0, y: 0, z: 0 }, cible: { x: 10, y: 0, z: 0 }, yaw: 0 });
      net.interpoler(0.016);
      var x = net.distants.get(1).pos.x;
      A.ok(x > 0 && x < 10, 'la position avance vers la cible sans la dépasser (' + x + ')');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
