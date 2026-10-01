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

  /* Bogue signalé : immobile, le joueur était régulièrement déplacé ; en « vol
     statique » il descendait ; l'horloge avançait puis reculait sans fin. */
  describe('Vol et horloge du monde — client et serveur d\'accord', {
    teste: 'MC.Synchro.basculerVol, rejouer (vol décidé par les règles, vitesse verticale remise à zéro au même instant des deux côtés) et MC.Synchro.creerHorloge (heure du monde côté client).',
    pourquoi: 'Le client prédit avec le même code que le serveur : s\'il vole quand le serveur le fait tomber, chaque relevé ETAT le ramène plus bas ; et une heure écrasée à chaque relevé, arrondie au dixième, recule des dizaines de fois par seconde.',
    attendu: 'en survie le vol est refusé des deux côtés ; en créatif les deux trajectoires sont identiques à la bascule ; l\'heure client ne recule jamais sur des relevés ordinaires, suit le serveur à moins de 0,15 s et adopte d\'un coup un vrai saut (sommeil, /jour).',
  }, function () {
    function joueurMode(mode) {
      var w = MC.createWorld(4242);
      var col = w.findSpawnColumn();
      w.getChunk(Math.floor(col[0] / 16), Math.floor(col[1] / 16), true);
      var pl = MC.createPlayer(w, MC.createEntities(w), MC.Modes.regles(mode, 'facile'));
      pl.state.pos.x = col[0] + 0.5; pl.state.pos.z = col[1] + 0.5;
      pl.state.pos.y = w.groundAt(col[0], col[1], true) + 12;   // en l'air, loin du sol
      return pl;
    }
    var REPOS = { forward: 0, back: 0, left: 0, right: 0, jump: 0, sprint: 0 };

    it('SPEC-ARCHI-045 : en survie, le double appui ne fait pas voler (le serveur ne le ferait pas)', function () {
      var pl = joueurMode('survie'), st = pl.state;
      A.equal(MC.Synchro.basculerVol(st), false, 'bascule refusée');
      A.equal(st.flying, false, 'toujours à pied');
      // un état local qui volerait quand même (écrit à la main) : le serveur, lui, tombe
      var serveur = joueurMode('survie'), pred = MC.Synchro.creerPrediction(), envoyees = [];
      st.flying = true;
      for (var i = 0; i < 30; i++) { var e = pred.enregistrer(1 / 60, REPOS, 0, 0, st.flying); MC.Synchro.rejouer(pl, [e]); envoyees.push(e); }
      MC.Synchro.rejouer(serveur, envoyees);
      A.equal(serveur.state.flying, false, 'le serveur ignore le vol demandé hors créatif');
      var ecart = MC.Synchro.reconcilier(pl, MC.Synchro.etatJoueur(serveur, envoyees[envoyees.length - 1].s), pred);
      A.equal(st.flying, false, 'la réconciliation reprend l\'état de vol du serveur (ETAT.toi[].vol)');
      A.ok(ecart > 0.5, 'l\'écart venait bien du vol local (' + ecart.toFixed(2) + ' bloc)');
      for (var k = 0; k < 10; k++) { var e2 = pred.enregistrer(1 / 60, REPOS, 0, 0, st.flying); MC.Synchro.rejouer(pl, [e2]); MC.Synchro.rejouer(serveur, [e2]); }
      A.ok(Math.abs(serveur.state.pos.y - st.pos.y) < 1e-9, 'ensuite, plus aucun écart');
    });

    it('SPEC-ARCHI-045 : en créatif, bascule en plein saut — le client et le serveur suivent la même trajectoire', function () {
      var client = joueurMode('creatif'), serveur = joueurMode('creatif');
      [client, serveur].forEach(function (p) { p.state.flying = false; p.state.vel.y = 6; });
      var pred = MC.Synchro.creerPrediction(), entrees = [];
      for (var i = 0; i < 40; i++) {
        if (i === 5) A.equal(MC.Synchro.basculerVol(client.state), true, 'le vol s\'active');
        var e = pred.enregistrer(1 / 60, REPOS, 0, 0, client.state.flying);
        MC.Synchro.rejouer(client, [e]);
        entrees.push(e);
      }
      MC.Synchro.rejouer(serveur, entrees);                // le serveur ne voit que les entrées
      A.equal(serveur.state.flying, true, 'le serveur vole aussi');
      A.ok(Math.abs(serveur.state.pos.y - client.state.pos.y) < 1e-9,
        'même altitude des deux côtés (écart ' + Math.abs(serveur.state.pos.y - client.state.pos.y).toFixed(4) + ')');
      A.ok(Math.abs(serveur.state.vel.y) < 1e-9, 'vol statique : vitesse verticale nulle chez le serveur');
    });

    it('SPEC-ARCHI-045 : une bascule faite entre deux images survit à un ETAT reçu avant l\'entrée suivante', function () {
      var client = joueurMode('creatif'), serveur = joueurMode('creatif');
      [client, serveur].forEach(function (p) { p.state.flying = false; p.state.vel.y = -8; });   // en chute
      var pred = MC.Synchro.creerPrediction(), envoyees = [];
      function image() { var e = pred.enregistrer(1 / 60, REPOS, 0, 0, client.state.flying); MC.Synchro.rejouer(client, [e]); envoyees.push(e); }
      for (var i = 0; i < 6; i++) image();
      MC.Synchro.rejouer(serveur, envoyees.slice(0, 3));    // le serveur n'a traité que 3 entrées
      MC.Synchro.basculerVol(client.state);                // double appui, entre deux images
      MC.Synchro.reconcilier(client, MC.Synchro.etatJoueur(serveur, 3), pred);   // un ETAT arrive avant l'image suivante
      A.equal(client.state.flying, true, 'la bascule n\'est pas effacée par le relevé');
      for (var k = 0; k < 30; k++) image();
      MC.Synchro.rejouer(serveur, envoyees.slice(3));
      var ecart = MC.Synchro.reconcilier(client, MC.Synchro.etatJoueur(serveur, envoyees[envoyees.length - 1].s), pred);
      A.ok(ecart < 1e-9, 'aucune correction une fois tout acquitté (écart ' + ecart.toFixed(4) + ')');
      A.equal(serveur.state.flying, true, 'le serveur vole');
    });

    it('SPEC-ARCHI-046 : l\'heure client ne recule jamais sur des relevés ordinaires et suit le serveur', function () {
      var h = MC.Synchro.creerHorloge();
      h.fixer(60);
      var serveur = 60, t = 60, reculs = 0, ecartMax = 0, precedent = t;
      for (var i = 0; i < 600; i++) {                       // 10 s à 60 images/s
        var dt = 1 / 60;
        serveur += dt;
        if (i === 200) serveur -= 0.4;                      // un tic serveur trop long, plafonné : 0,4 s perdues
        t = h.avancer(dt, t);
        if (i % 2 === 0) t = h.recevoir(+serveur.toFixed(1));   // ETAT à 30 Hz, heure arrondie au dixième
        if (t < precedent - 1e-12) reculs++;
        precedent = t;
        if (i > 300) ecartMax = Math.max(ecartMax, Math.abs(t - serveur));
      }
      A.equal(reculs, 0, 'aucun recul');
      A.ok(ecartMax < 0.15, 'à moins de 0,15 s du serveur une fois rattrapé (' + ecartMax.toFixed(3) + ')');
    });

    it('SPEC-ARCHI-046 : un vrai saut d\'heure (sommeil, /jour, /nuit) et une écriture locale sont adoptés aussitôt', function () {
      var h = MC.Synchro.creerHorloge();
      A.equal(h.fixer(60), 60);
      A.equal(h.recevoir(700), 700, 'saut en avant adopté d\'un coup');
      A.equal(h.recevoir(100), 100, 'saut en arrière (heure du jour réglée) adopté d\'un coup');
      A.equal(h.avancer(0.5, 3000), 3000.5, 'une heure écrite à la main (outil de test, débogage) est reprise');
    });

    it('SPEC-ARCHI-046 : une heure non finie (debug.heure() sans argument) ne bloque jamais l\'horloge', function () {
      var h = MC.Synchro.creerHorloge();
      h.fixer(60);
      A.equal(h.recevoir(61), 60, 'relevé ordinaire : rattrapé en douceur');
      var t = h.avancer(0.1, NaN);                          // g.time = NaN, écrit à la main
      A.ok(isFinite(t) && t > 60, 'NaN écrit dans g.time est ignoré (' + t + ')');
      t = h.recevoir(NaN);
      A.ok(isFinite(t), 'un relevé NaN est ignoré');
      A.equal(h.fixer(NaN), 0, 'fixer(NaN) rend 0');
      A.equal(h.recevoir(500), 500, 'le relevé suivant est adopté (saut)');
      A.ok(Math.abs(h.avancer(0.5, 500) - 500.5) < 1e-9, 'puis l\'horloge avance de nouveau');
      A.equal(h.avancer(Infinity, 500.5), 500.5, 'un pas infini est ignoré');
    });

    it('SPEC-ARCHI-046 : une heure écrite à la main n\'est reprise que jusqu\'au relevé suivant (écart > 2 s ramené au serveur)', function () {
      var h = MC.Synchro.creerHorloge();
      h.fixer(60);
      A.equal(h.avancer(0.1, 3000), 3000.1, 'reprise par l\'horloge');
      A.equal(h.recevoir(60.2), 60.2, 'le relevé du serveur la remplace');
    });

    it('SPEC-ARCHI-045 : les statistiques du serveur s\'appliquent AVANT le rejeu (la faim règle la vitesse)', function () {
      var client = joueur(), serveur = joueur(), pred = MC.Synchro.creerPrediction(), envoyees = [];
      serveur.state.hunger = 0;                             // affamé chez le serveur, qui fait foi
      var MARCHE = { forward: 1, back: 0, left: 0, right: 0, jump: 0, sprint: 0 };
      for (var i = 0; i < 30; i++) { var e = pred.enregistrer(1 / 60, MARCHE, 0, 0, false); MC.Synchro.rejouer(client, [e]); envoyees.push(e); }
      MC.Synchro.rejouer(serveur, envoyees.slice(0, 10));  // le serveur n'a traité que 10 entrées
      var etat = MC.Synchro.etatJoueur(serveur, 10);
      MC.Synchro.appliquerStats(client.state, etat);        // l'ordre de onToi (game.js)
      MC.Synchro.reconcilier(client, etat, pred);
      MC.Synchro.rejouer(serveur, envoyees.slice(10));
      var ecart = MC.Synchro.reconcilier(client, MC.Synchro.etatJoueur(serveur, 30), pred);
      A.ok(ecart < 1e-9, 'le rejeu à la faim du serveur prédit le même pas (écart ' + ecart.toFixed(4) + ')');
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      var onToi = jeu.slice(jeu.indexOf('onToi: function'), jeu.indexOf('onDonne: function'));
      A.ok(onToi.indexOf('appliquerStats(') > 0 && onToi.indexOf('appliquerStats(') < onToi.indexOf('reconcilier('), 'game.js : appliquerStats avant reconcilier dans onToi');
    });

    it('SPEC-ARCHI-046 : audit — hors jeu actif, l\'heure avance sauf si le serveur est en pause', function () {
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      var frame = jeu.slice(jeu.indexOf('function frame(now)'), jeu.indexOf('frameReseau(dt);', jeu.indexOf('function frame(now)')));
      A.ok(/if \(!actif && !serveurEnPause\(\)\) g\.time = horloge\.avancer\(dt, g\.time\)/.test(frame), 'frame : avancer pour tout état non actif (mort, pause en réseau ouvert, inventaire)');
      A.ok(/function serveurEnPause\(\)[\s\S]{0,300}poste\.etat\.pause/.test(jeu), 'la pause qui fait foi vient du poste (PAUSE_ETAT)');
    });

    it('SPEC-ARCHI-045/046 : audit — game.js bascule le vol par MC.Synchro et n\'écrit l\'heure qu\'au travers de l\'horloge', function () {
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      var serveur = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
      A.ok(!/flying\s*=\s*!/.test(jeu), 'aucune bascule directe de flying');
      A.equal((jeu.match(/Synchro\.basculerVol\(/g) || []).length, 2, 'clavier et manette passent par basculerVol');
      A.ok(!/g\.time\s*=\s*m\.heure/.test(jeu), 'aucun relevé n\'écrase g.time directement');
      A.ok(!/g\.time\s*\+=/.test(jeu), 'g.time n\'avance que par l\'horloge');
      A.ok(/heure:\s*\+heure\.toFixed\(3\)/.test(serveur), 'ETAT porte l\'heure au millième');
      A.ok(/m\.mode\s*!==\s*regles\.mode\.id/.test(jeu), 'le client adopte le mode du serveur quand il diffère (règles de vol comprises)');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
