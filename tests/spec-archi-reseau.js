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

    /* Un monde politique « à 300 lieux » (≈ 290 factions, ≈ 41 000 paires) :
       l'échelle où l'ancien message complet pesait 1,6 Mo et coûtait 6 ms de
       JSON à chaque seconde. */
    function monde300() {
      var P = MC.Politique, pol = P.creer(20260921), kinds = ['ville', 'megapole', 'ville', 'volcan', 'vierge'], sites = [];
      for (var i = 0; i < 300; i++) sites.push({ id: 'l' + i, kind: kinds[i % 5], x: (i % 20) * 300, z: Math.floor(i / 20) * 300, nom: 'Lieu' + i });
      P.decouvrir(pol, sites);
      P.tourDuMonde(pol, 10);
      return pol;
    }
    function nonNeutres(etat) {
      var out = [];
      etat.relations.forEach(function (r, k) { if (r !== 'neutre') out.push(k + '=' + r); });
      return out.sort();
    }

    it('SPEC-SYNC-024 : à 300 lieux, l\'état complet du join est borné et se relit à l\'identique ; ensuite seules les différences partent', function () {
      var P = MC.Politique, pol = monde300();
      A.gt(pol.relations.size, 30000, 'préparation : des dizaines de milliers de relations');
      var suivi = P.suivreReseau(pol);
      var complet = P.instantaneReseau(pol);
      var taille = JSON.stringify(complet).length;
      A.ok(taille < 120000, 'le message complet tient sous 120 Ko (' + taille + ' octets ; l\'ancien format en pesait 1,6 Mo)');
      var client = P.appliquerReseau(null, JSON.parse(JSON.stringify(complet)));
      A.deep(Array.from(client.factions.keys()), Array.from(pol.factions.keys()), 'mêmes factions, même ordre');
      A.deep(nonNeutres(client), nonNeutres(pol), 'mêmes relations non neutres que le serveur');
      A.equal(client.jour, pol.jour, 'même jour politique');
      A.equal(suivi.prendre(), null, 'rien de neuf : rien à envoyer (et rien de sérialisé)');
      // une journée simulée : seules les relations changées partent, en indices
      P.tourDuMonde(pol, pol.jour + 1);
      var d = suivi.prendre();
      var td = JSON.stringify(d).length;
      A.ok(d && !d.complet && td < 40000, 'la journée suivante part en différence bornée (' + td + ' octets)');
      P.appliquerReseau(client, JSON.parse(JSON.stringify(d)));
      A.deep(nonNeutres(client), nonNeutres(pol), 'la différence appliquée redonne l\'état du serveur');
      A.equal(client.jour, pol.jour);
      // une faction qui naît, une relation externe (faction de joueurs ↔ PNJ)
      P.decouvrir(pol, [{ id: 'neuf', kind: 'megapole', x: 9000, z: 9000, nom: 'Neuve' }]);
      pol.relations.set('f1~royaume:neuf', 'guerre');
      var d2 = suivi.prendre();
      A.ok(d2.f.length >= 1 && d2.ext.length === 1, 'la naissance et la relation externe sont dans la différence');
      P.appliquerReseau(client, JSON.parse(JSON.stringify(d2)));
      A.ok(client.factions.has('royaume:neuf'), 'la nouvelle faction est connue du client');
      A.deep(nonNeutres(client), nonNeutres(pol), 'toujours identique au serveur');
      A.equal(P.appliquerReseau(null, d2), null, 'une différence sans état de départ est ignorée');
      // un rechargement (Maps remplacées) redemande l'envoi complet
      var recharge = P.charger(P.serialiser(pol));
      pol.factions = recharge.factions; pol.relations = recharge.relations;
      A.deep(suivi.prendre(), { complet: 1 }, 'Maps remplacées : l\'appelant renvoie l\'état complet');
      // résumé pour le panneau
      var r = P.resumeRelations(client).get('royaume:neuf');
      A.ok(r && r.guerre.indexOf('f1') >= 0, 'resumeRelations rend les relations non neutres de chaque faction');
    });

    it('SPEC-SYNC-024 : POLITIQUE atteint son hook ; le client ne peut pas l\'envoyer ; game.js l\'applique et le panneau l\'affiche', function () {
      var vus = [];
      var recevoir = clientAvecFauxSocket({ onPolitique: function (m) { vus.push(m); } });
      var pol = MC.Politique.creer(7);
      MC.Politique.decouvrir(pol, [{ id: 'v1', kind: 'megapole', x: 0, z: 0, nom: 'Alpha' }, { id: 'v2', kind: 'megapole', x: 300, z: 0, nom: 'Beta' }]);
      var gu = MC.Guildes.creerEtat();
      MC.Guildes.appliquerAction(gu, 'Ana', { type: 'faction', action: 'creer', args: { nom: 'Lions' } });
      var fid = MC.Guildes.factionsDe(gu, 'Ana').principale;
      var rel = MC.Guildes.appliquerAction(gu, 'Ana', { type: 'faction', action: 'relation', args: { faction: fid, cible: 'royaume:v1', relation: 'ennemie' } }, pol);
      A.ok(rel.ok, 'une faction de joueurs peut se déclarer envers une faction PNJ quand l\'état politique est fourni');
      recevoir({ t: 'politique', pol: MC.Politique.instantaneReseau(pol), guildes: MC.Guildes.serialiser(gu), moi: 'Ana' });
      A.equal(vus.length, 1, 'le message atteint onPolitique');
      var etat = MC.Politique.appliquerReseau(null, vus[0].pol);
      A.equal(MC.Politique.relationEntre(etat, fid, 'royaume:v1'), 'guerre', 'la relation joueurs → PNJ est relue côté PNJ');
      A.equal(MC.Guildes.relationEnvers(MC.Guildes.charger(vus[0].guildes), fid, 'royaume:v1'), 'ennemie', 'la relation de la faction de joueurs est relue');
      A.ok(MC.NetProtocol.valider({ t: 'politique', pol: {}, guildes: {} }) === null, 'un client ne peut pas envoyer POLITIQUE au serveur');
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      A.ok(/MC\.Politique\.appliquerReseau\(ep\.etat, m\.pol\)/.test(jeu), 'game.js applique l\'état reçu (complet ou différence)');
      A.ok(/joueur: ep\.moi \|\|/.test(jeu), 'le joueur est identifié par le nom que le serveur lui connaît');
    });

    it('SPEC-SYNC-020 : le client reprend regard et réapparition de chaque joueur local (exécution de MC.Synchro.reprendreRetour) ; une réapparition invalide est refusée', function () {
      var vus = [];
      var recevoir = clientAvecFauxSocket({ onBienvenue: function (m) { vus.push(m); } });
      recevoir({ t: 'bienvenue', id: 1, graine: 1, heure: 60, toi: [
        { x: 1, y: 2, z: 3, pv: 13, faim: 9, air: 10, yaw: 1.234, pitch: -0.456, spawn: { x: 4.5, y: 33.05, z: 6.5 } },
        { x: 2, y: 2, z: 3, pv: 20, faim: 20, air: 10, yaw: -2, pitch: 9, spawn: { x: 1e9, y: 33, z: 0 } },
      ] });
      A.equal(vus.length, 1, 'BIENVENUE atteint le jeu');
      var j1 = joueur().state, j2 = joueur().state;
      var sp1 = MC.Synchro.reprendreRetour(j1, vus[0].toi[0]);
      var sp2 = MC.Synchro.reprendreRetour(j2, vus[0].toi[1]);
      A.deep([j1.yaw, j1.pitch], [1.234, -0.456], 'joueur 1 : regard repris');
      A.deep(sp1, { x: 4.5, y: 33.05, z: 6.5 }, 'joueur 1 : réapparition reprise');
      A.deep([j2.yaw, j2.pitch], [-2, 1.6], 'joueur 2 de l\'écran partagé : regard repris (inclinaison bornée)');
      A.equal(sp2, null, 'une réapparition hors des bornes du monde est refusée');
      ['x', { x: NaN, y: 1, z: 1 }, { x: 1, y: 1 }, { x: 1, y: 500, z: 1 }, null].forEach(function (sp) {
        A.equal(MC.Synchro.spawnValide(sp), null, 'refusé : ' + JSON.stringify(sp));
      });
      var avant = { yaw: 0.5, pitch: 0.1 };
      MC.Synchro.reprendreRetour(avant, { yaw: 'x', pitch: Infinity });
      A.deep([avant.yaw, avant.pitch], [0.5, 0.1], 'un regard non fini ne remplace rien');
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      A.ok(/MC\.Synchro\.reprendreRetour\(jl\.player\.state, t\)/.test(jeu), 'onBienvenue l\'applique à chaque joueur local');
      var serveur = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
      A.ok(/js\.spawn = SY\.spawnValide\(etat\.spawn\)/.test(serveur), 'le serveur valide aussi la réapparition relue');
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
