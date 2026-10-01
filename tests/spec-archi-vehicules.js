/* spec-archi-vehicules.js — lot P-VEH du chantier « solo = serveur toujours
   présent » : la logique PURE derrière SPEC-ARCHI-021 et SPEC-SYNC-022 (un
   véhicule conduit par prédiction + réconciliation, la soute comme conteneur
   serveur, la cabine étanche du sous-marin au temps serveur). Le comportement de
   bout en bout (vrai serveur : poser, monter, conduire, soute, sauvegarde) est
   prouvé par tests/integration-archi-vehicules.js. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, V = MC.Vehicules, S = MC.Synchro, M = MC.Modes;
  var B = C.B, I = C.I;
  var flatWorld = G.flatWorld;

  var TOUCHES_AVANT = { forward: 1, back: 0, left: 0, right: 0, jump: 0, sprint: 0 };
  var TOUCHES_AVANT_GAUCHE = { forward: 1, back: 0, left: 1, right: 0, jump: 0, sprint: 0 };

  // piste plate en y = 10, dégagée
  function piste() { return flatWorld(10, B.STONE); }
  function joueur(w, ents) {
    var pl = MC.createPlayer(w, ents, M.regles('survie', 'facile'));
    pl.state.pos.x = 0.5; pl.state.pos.y = 11; pl.state.pos.z = 0.5;
    return pl;
  }
  /* Une « réplique » de véhicule telle que net.mobsDistants la tient côté client. */
  function replique(eid, nom) {
    return { eid: eid, type: 'v_' + nom, vehicule: nom, w: 0.6, h: 1.8, pos: { x: 0, y: 0, z: 0 },
             cible: { x: 0, y: 0, z: 0 }, yaw: 0, vel: { x: 0, y: 0, z: 0 } };
  }

  describe('P-VEH — conduite prédite et réconciliée, soute, cabine étanche', {
    teste: 'MC.Synchro (veh dans l\'état du joueur, embarquement de la réplique, réconciliation du véhicule), player.updateMovement à bord, la soute comme conteneur serveur et la cabine étanche.',
    pourquoi: 'Le serveur intègre la conduite ; le client prédit avec le MÊME code sur la réplique du véhicule — si l\'un des deux dérive, la voiture « tire » à chaque état reçu.',
    attendu: 'client et serveur obtiennent exactement la même trajectoire à entrées égales ; une réplique faussée est ramenée à l\'état du serveur ; descendre côté serveur fait quitter l\'engin au client.',
  }, function () {

    it('SPEC-SYNC-022 : à bord, l\'état du joueur porte le véhicule exact (position, cap, vitesse, carburant) ; à pied, rien', function () {
      var w = piste(), ents = MC.createEntities(w), pl = joueur(w, ents);
      A.equal(S.etatJoueur(pl, 0).veh, undefined, 'à pied : pas de veh');
      var car = V.poser(ents, 'voiture', 0.5, 11, 0.5, 0.7);
      A.ok(V.monter(pl.state, car), 'on monte');
      for (var i = 0; i < 30; i++) S.rejouer(pl, [{ s: i + 1, dt: 1 / 30, k: S.encoderTouches(TOUCHES_AVANT), yaw: 0, pitch: 0, v: 0 }]);
      var e = S.etatJoueur(pl, 30);
      A.ok(e.veh, 'à bord : veh présent');
      A.equal(e.veh.eid, car.eid, 'c\'est ce véhicule');
      A.equal(e.veh.x, car.pos.x, 'position exacte'); A.equal(e.veh.z, car.pos.z);
      A.equal(e.veh.yaw, car.yaw, 'cap exact');
      A.ok(e.veh.vit > 5, 'la voiture roule (' + e.veh.vit.toFixed(1) + ' m/s)');
      A.ok(e.veh.carb < V.DEFS.voiture.carburant, 'du carburant a été brûlé');
      A.equal(e.x, car.pos.x, 'le conducteur est sur son siège');
    });

    it('SPEC-SYNC-022 / SPEC-NET-026 : même entrées, même code — la prédiction du client suit EXACTEMENT le serveur, la réconciliation ne corrige rien', function () {
      var wS = piste(), entsS = MC.createEntities(wS), srv = joueur(wS, entsS);
      var wC = piste(), entsC = MC.createEntities(wC), cli = joueur(wC, entsC);
      var voiture = V.poser(entsS, 'voiture', 0.5, 11, 0.5, 0);
      V.monter(srv.state, voiture);
      var pred = S.creerPrediction();
      var rep = replique(voiture.eid, 'voiture');
      var trouver = function (eid) { return eid === rep.eid ? rep : null; };
      // premier état reçu : le client s'embarque sur sa réplique
      S.reconcilier(cli, S.etatJoueur(srv, 0), pred, trouver);
      A.equal(cli.state.monture, rep, 'embarqué sur la réplique');
      A.equal(rep.predit, true, 'la réplique est prédite (plus interpolée)');
      A.equal(rep.conducteur, cli.state, 'et occupée');
      // 90 images : le client prédit tout de suite, le serveur rejoue les mêmes entrées (avec retard)
      var envoyees = [];
      for (var i = 0; i < 90; i++) {
        var e = pred.enregistrer(1 / 60, i < 50 ? TOUCHES_AVANT : TOUCHES_AVANT_GAUCHE, 0, 0, false);
        S.rejouer(cli, [e]);
        envoyees.push(e);
      }
      var posPredite = { x: rep.pos.x, z: rep.pos.z, yaw: rep.yaw };
      A.ok(Math.hypot(posPredite.x, posPredite.z - 0.5) > 3, 'la réplique a avancé (prédiction locale)');
      for (var k = 0; k < 60; k++) S.rejouer(srv, [envoyees[k]]);          // le serveur n'en a traité que 60
      var ecart = S.reconcilier(cli, S.etatJoueur(srv, 60), pred, trouver);
      A.ok(ecart < 1e-9, 'prédiction juste : aucune correction (écart ' + ecart + ')');
      A.equal(pred.enAttente.length, 30, 'les 30 entrées non confirmées sont gardées');
      for (var m = 60; m < 90; m++) S.rejouer(srv, [envoyees[m]]);          // le reste arrive
      A.ok(Math.abs(rep.pos.x - voiture.pos.x) < 1e-9 && Math.abs(rep.pos.z - voiture.pos.z) < 1e-9, 'le client est exactement là où le serveur est arrivé');
      A.ok(Math.abs(rep.yaw - voiture.yaw) < 1e-9, 'même cap');
    });

    it('SPEC-SYNC-022 : une réplique faussée (triche, lag) est ramenée à l\'état du serveur, puis rejoue les entrées en attente', function () {
      var wS = piste(), entsS = MC.createEntities(wS), srv = joueur(wS, entsS);
      var wC = piste(), entsC = MC.createEntities(wC), cli = joueur(wC, entsC);
      var moto = V.poser(entsS, 'moto', 0.5, 11, 0.5, 0);
      V.monter(srv.state, moto);
      var pred = S.creerPrediction(), rep = replique(moto.eid, 'moto');
      var trouver = function () { return rep; };
      S.reconcilier(cli, S.etatJoueur(srv, 0), pred, trouver);
      for (var i = 0; i < 20; i++) {
        var e = pred.enregistrer(1 / 60, TOUCHES_AVANT, 0, 0, false);
        S.rejouer(cli, [e]); S.rejouer(srv, [e]);
      }
      rep.pos.x += 40; rep.vitesse = 999;                                  // le client se croit ailleurs, ultra rapide
      var ecart = S.reconcilier(cli, S.etatJoueur(srv, 20), pred, trouver);
      A.ok(Math.abs(rep.pos.x - moto.pos.x) < 1e-9, 'position ramenée à celle du serveur');
      A.ok(Math.abs(rep.vitesse - moto.vitesse) < 1e-9, 'vitesse ramenée (' + rep.vitesse.toFixed(2) + ')');
      A.ok(rep.vitesse <= V.DEFS.moto.vmax + 1e-9, 'jamais au-delà de la vitesse maximale du modèle');
      A.ok(ecart < 1e-9, 'le joueur (siège) n\'a pas bougé : seule la réplique avait dérivé');
    });

    it('SPEC-SYNC-022 : le serveur fait descendre le joueur (veh absent) — le client quitte l\'engin et la réplique redevient suivie', function () {
      var wS = piste(), entsS = MC.createEntities(wS), srv = joueur(wS, entsS);
      var wC = piste(), entsC = MC.createEntities(wC), cli = joueur(wC, entsC);
      var bateau = V.poser(entsS, 'camion', 0.5, 11, 0.5, 0);
      V.monter(srv.state, bateau);
      var pred = S.creerPrediction(), rep = replique(bateau.eid, 'camion');
      var trouver = function () { return rep; };
      S.reconcilier(cli, S.etatJoueur(srv, 0), pred, trouver);
      A.ok(cli.state.monture, 'à bord');
      V.descendre(srv.state, wS, 0.6, 1.8);
      S.reconcilier(cli, S.etatJoueur(srv, 0), pred, trouver);
      A.notOk(cli.state.monture, 'à pied');
      A.equal(rep.predit, false, 'la réplique n\'est plus prédite');
      A.equal(rep.conducteur, null, 'ni occupée');
      A.ok(Math.abs(rep.cible.x - rep.pos.x) < 1e-9, 'son interpolation repart de là où elle est');
      var apres = S.etatJoueur(cli, 0);
      A.equal(apres.veh, undefined, 'plus de veh');
    });

    it('SPEC-SYNC-022 : à bord côté serveur, réplique inconnue du client : pas de marche fantôme (les entrées sont oubliées sans être rejouées à pied)', function () {
      var wS = piste(), entsS = MC.createEntities(wS), srv = joueur(wS, entsS);
      var wC = piste(), entsC = MC.createEntities(wC), cli = joueur(wC, entsC);
      var car = V.poser(entsS, 'voiture', 0.5, 11, 0.5, 0);
      V.monter(srv.state, car);
      var pred = S.creerPrediction();
      var e = pred.enregistrer(1 / 60, TOUCHES_AVANT, 0, 0, false);
      S.reconcilier(cli, S.etatJoueur(srv, 0), pred, function () { return null; });
      A.notOk(cli.state.monture, 'pas encore embarqué (réplique absente)');
      A.equal(cli.state.pos.x, car.pos.x, 'mais posé sur le siège');
      var avant = { x: cli.state.pos.x, z: cli.state.pos.z };
      S.reconcilier(cli, S.etatJoueur(srv, e.s), pred, function () { return null; });
      A.equal(pred.enAttente.length, 0, 'entrée confirmée oubliée');
      A.ok(Math.abs(cli.state.pos.x - avant.x) < 1e-9 && Math.abs(cli.state.pos.z - avant.z) < 1e-9, 'sans avoir marché');
    });

    it('SPEC-SYNC-022 : la vitesse reste bornée par le modèle quoi que le client envoie (touches seulement, durée par entrée bornée)', function () {
      var w = piste(), ents = MC.createEntities(w), pl = joueur(w, ents);
      var car = V.poser(ents, 'voiture', 0.5, 11, 0.5, 0);
      V.monter(pl.state, car);
      var budget = S.creerBudget(), accepte = 0, refuse = 0;
      for (var i = 0; i < 400; i++) {
        var dt = 0.1;                              // le maximum d'une entrée : tout le reste est refusé
        budget.crediter(1 / 60);
        if (budget.consommer(dt)) { S.rejouer(pl, [{ s: i, dt: dt, k: S.encoderTouches(TOUCHES_AVANT), yaw: 0, pitch: 0, v: 0 }]); accepte++; }
        else refuse++;
      }
      A.ok(refuse > accepte, 'le budget de temps refuse la plupart des entrées trop longues (' + refuse + ' refusées)');
      A.ok(Math.abs(car.vitesse) <= V.DEFS.voiture.vmax + 1e-9, 'vitesse ≤ vmax (' + car.vitesse.toFixed(2) + ')');
      // distance parcourue ≤ vmax × temps réellement simulé (accepte × dt)
      var d = Math.hypot(car.pos.x - 0.5, car.pos.z - 0.5);
      A.ok(d <= V.DEFS.voiture.vmax * accepte * 0.1 + 1e-6, 'distance ≤ vmax × temps crédité (' + d.toFixed(1) + ' m)');
    });

    it('SPEC-VEHIC-005 / SPEC-SYNC-022 : dans un sous-marin, le joueur ne se noie pas au temps serveur (updateSurvival), à pied il se noie', function () {
      var w = piste();
      for (var x = -5; x <= 5; x++) for (var z = -5; z <= 5; z++) for (var y = 11; y <= 30; y++) w.setBlock(x, y, z, B.WATER);
      var ents = MC.createEntities(w), pl = joueur(w, ents);
      pl.state.pos.y = 15;
      var sm = V.poser(ents, 'sous_marin', 0.5, 15, 0.5, 0);
      V.monter(pl.state, sm);
      for (var i = 0; i < 20 * 20; i++) pl.updateSurvival(0.05);           // 20 s sous l'eau
      A.equal(pl.state.air, pl.MAX_AIR, 'air plein dans la cabine étanche');
      A.equal(pl.state.hp, pl.MAX_HP, 'aucun dégât de noyade');
      V.descendre(pl.state, w, 0.6, 1.8);
      pl.state.pos.y = 15;                                                // à la nage, au fond
      for (var j = 0; j < 30 * 20; j++) pl.updateSurvival(0.05);
      A.ok(pl.state.hp < pl.MAX_HP, 'à pied, sous l\'eau : on se noie (témoin)');
    });

    it('SPEC-SYNC-022 : la soute est un conteneur serveur adressable (type, taille, révision) qui survit à la sauvegarde', function () {
      var ents = MC.createEntities(flatWorld(10, B.STONE));
      var camion = V.poser(ents, 'camion', 0.5, 11, 0.5, 0), bateau = V.poser(ents, 'bateau', 5.5, 11, 0.5, 0);
      A.equal(camion.soute.type, 'soute27'); A.equal(camion.soute.taille, 27); A.equal(camion.soute.rev, 0);
      A.equal(bateau.soute.type, 'soute9'); A.equal(bateau.soute.taille, 9);
      A.ok(MC.ContratsV2.TYPES_CONTENEUR.soute27 && MC.ContratsV2.TYPES_CONTENEUR.soute9, 'types déclarés au contrat');
      A.deep(MC.ContratsV2.lireCle('v' + camion.eid), { vehicule: camion.eid }, 'clé « v<eid> » lisible');
      A.equal(MC.ContratsV2.lireCle('v0'), null, 'v0 refusé'); A.equal(MC.ContratsV2.lireCle('v01'), null, 'v01 refusé');
      // transfert inventaire → soute par les opérations serveur (MC.Conteneurs.appliquer)
      var inv = MC.Inventory.create(36), grille = MC.Inventory.create(9);
      inv.add(I.DIAMOND, 7);
      var ctx = { joueur: { inv: inv, equip: {}, grille: grille }, conteneur: function (cle) { return cle === 'v' + camion.eid ? camion.soute : null; }, regles: {} };
      var iDiamant = inv.slots.findIndex(function (s) { return s && s.id === I.DIAMOND; });
      var r = MC.Conteneurs.appliquer(ctx, { k: 'transfert', de: { z: 'inv', i: iDiamant }, vers: { z: 'cont', cle: 'v' + camion.eid, i: 4 }, n: 7 });
      A.ok(r.ok, 'le transfert vers la soute est accepté (' + (r.motif || '') + ')');
      A.equal(camion.soute.slots[4].id, I.DIAMOND); A.equal(camion.soute.slots[4].n, 7);
      A.equal(camion.soute.rev, 1, 'la révision avance (delta de CONTENEUR_MAJ)');
      var ecrit = JSON.parse(JSON.stringify(V.serialiser(ents)));
      var ents2 = MC.createEntities(flatWorld(10, B.STONE));
      V.restaurer(ents2, ecrit);
      var c2 = ents2.list.filter(function (e) { return e.vehicule === 'camion'; })[0];
      A.equal(c2.soute.slots[4].n, 7, 'le chargement revient');
      A.equal(c2.soute.type, 'soute27', 'avec son type');
      A.equal(c2.soute.taille, 27, 'et sa taille');
    });

    it('SPEC-SERVEUR-006 : un fichier de monde forgé ne fait entrer aucun véhicule invalide (modèle, coordonnées, soute, carburant, avarie)', function () {
      var ents = MC.createEntities(flatWorld(10, B.STONE));
      var bonneSoute = new Array(27).fill(0); bonneSoute[2] = [I.DIAMOND, 5];
      var forges = [
        ['zeppelin', 0, 11, 0, 0, 0, 10, 0],                       // modèle inconnu
        ['voiture', NaN, 11, 0, 0, 0, 10, 0],                      // coordonnée non finie
        ['voiture', 1e12, 11, 0, 0, 0, 10, 0],                     // hors du monde
        ['voiture', 0, 11, 0, 0, [[I.DIAMOND, 5]], 10, 0],         // la voiture n'a pas de soute
        ['camion', 0, 11, 0, 0, [[I.DIAMOND, 5]], 10, 0],          // soute de la mauvaise taille
        ['camion', 0, 11, 0, 0, (function () { var l = new Array(27).fill(0); l[0] = [I.DIAMOND, 99999]; return l; })(), 10, 0],   // pile absurde
        ['camion', 0, 11, 0, 0, 0, 'beaucoup', 0],                 // carburant non numérique
        ['camion', 0, 11, 0, 0, 0, 10, 9],                         // gravité d'avarie hors 0..3
        'n\'importe quoi', null, 42
      ];
      A.equal(V.restaurer(ents, forges), 0, 'aucune entrée forgée n\'est acceptée');
      var bonne = ['camion', 3.5, 11, 2.5, 7 * Math.PI, bonneSoute, 1e9, 2];
      A.equal(V.restaurer(ents, [bonne]), 1, 'une entrée valide passe');
      var c = ents.list.filter(function (e) { return e.vehicule; })[0];
      A.equal(c.carburant, V.DEFS.camion.carburant, 'un carburant démesuré est ramené au plein du modèle');
      A.ok(Math.abs(c.yaw) < 2 * Math.PI, 'le cap est ramené dans un tour');
      A.equal(c.soute.slots[2].n, 5, 'la soute valide est reprise');
      A.ok(c.avarie && c.avarieGravite === 2, 'avarie conservée');
    });

    it('SPEC-VEHIC-006 : descendre ne met jamais le joueur dans un bloc, même encerclé (couronnes élargies, puis toit libre)', function () {
      var w = piste(), ents = MC.createEntities(w), pl = joueur(w, ents);
      var car = V.poser(ents, 'voiture', 0.5, 11, 0.5, 0);
      // un anneau de pierre de deux blocs de haut, sur deux couronnes : aucune place au sol
      for (var x = -4; x <= 5; x++) for (var z = -4; z <= 5; z++) {
        var d = Math.max(Math.abs(x - 0.5), Math.abs(z - 0.5));
        if (d >= 1.5 && d <= 3.5) for (var y = 11; y <= 13; y++) w.setBlock(x, y, z, B.STONE);
      }
      V.monter(pl.state, car);
      V.descendre(pl.state, w, 0.6, 1.8);
      A.notOk(MC.Physics.collides(w, pl.state.pos.x, pl.state.pos.y, pl.state.pos.z, 0.6, 1.8), 'le joueur n\'est pas dans un bloc (' + pl.state.pos.x.toFixed(1) + ', ' + pl.state.pos.y.toFixed(1) + ')');
      A.equal(car.conducteur, null, 'le siège est libéré');
      // plafond bas au-dessus du toit : il monte jusqu'à une place libre, jamais dans le bloc
      var w2 = piste(), ents2 = MC.createEntities(w2), pl2 = joueur(w2, ents2);
      var car2 = V.poser(ents2, 'voiture', 0.5, 11, 0.5, 0);
      for (var x2 = -4; x2 <= 5; x2++) for (var z2 = -4; z2 <= 5; z2++) for (var y2 = 11; y2 <= 12; y2++) {
        if (!(Math.abs(x2 - 0.5) < 1.5 && Math.abs(z2 - 0.5) < 1.5)) w2.setBlock(x2, y2, z2, B.STONE);
      }
      V.monter(pl2.state, car2);
      V.descendre(pl2.state, w2, 0.6, 1.8);
      A.notOk(MC.Physics.collides(w2, pl2.state.pos.x, pl2.state.pos.y, pl2.state.pos.z, 0.6, 1.8), 'et le toit lui-même est vérifié');
    });

    it('SPEC-SYNC-022 : un véhicule au repos ne se réintègre pas à chaque tic, mais retombe si on casse le bloc dessous', function () {
      var w = piste(), ents = MC.createEntities(w);
      var car = V.poser(ents, 'voiture', 0.5, 11, 0.5, 0);
      var ref = { pos: { x: 0, y: 11, z: 0 } };
      for (var i = 0; i < 5; i++) ents.update(1 / 20, ref);                 // se pose
      var appels = 0, orig = V.conduire;
      V.conduire = function () { appels++; return orig.apply(V, arguments); };
      try {
        for (var k = 0; k < 40; k++) ents.update(1 / 20, ref);              // 2 s à l'arrêt
      } finally { V.conduire = orig; }
      A.ok(appels <= 5, 'au plus 5 intégrations en 40 tics au repos (' + appels + ')');
      for (var x = -1; x <= 1; x++) for (var z = -1; z <= 1; z++) w.setBlock(x, 10, z, 0);
      w.setBlock(0, 9, 0, 0);
      for (var m = 0; m < 60; m++) ents.update(1 / 20, ref);                // 3 s
      A.ok(car.pos.y < 10.5, 'privée d\'appui, la voiture retombe (y = ' + car.pos.y.toFixed(2) + ')');
    });

    it('SPEC-SYNC-022 : au-delà du plafond, la sélection reste bornée et ne s\'inverse pas d\'un relevé à l\'autre (hystérésis)', function () {
      var NP = MC.NetProtocol, max = NP.MAX_VEHICULES_DIFFUSES;
      A.equal(max, 32);
      var l = [];
      for (var i = 0; i < 50; i++) l.push({ eid: i + 1, pos: { x: 10 + i, z: 0 } });     // 50 véhicules à portée
      var pos = [{ x: 0, z: 0 }];
      var premier = NP.selectionnerAvecHysteresis(l, pos, 96, max, null);
      A.equal(premier.length, max, 'jamais plus que le plafond');
      A.equal(premier[0].eid, 1, 'les plus proches d\'abord');
      var vus = new Set(premier.map(function (e) { return e.eid; }));
      // le 33e et le 32e sont presque à égale distance : l'un puis l'autre devient légèrement plus proche
      var frontiere = l[31], voisin = l[32];
      frontiere.pos.x = 10 + 32.2; voisin.pos.x = 10 + 31.8;                 // sans hystérésis, le 33e prendrait la place
      var sans = NP.selectionnerMobsProches(l, pos, 96, max).map(function (e) { return e.eid; });
      var avec = NP.selectionnerAvecHysteresis(l, pos, 96, max, vus).map(function (e) { return e.eid; });
      A.ok(sans.indexOf(voisin.eid) >= 0 && sans.indexOf(frontiere.eid) < 0, 'témoin : sans hystérésis la frontière bascule');
      A.ok(avec.indexOf(frontiere.eid) >= 0 && avec.indexOf(voisin.eid) < 0, 'avec hystérésis, l\'engin déjà envoyé reste');
      A.equal(avec.length, max, 'et le plafond tient');
      A.equal(NP.selectionnerAvecHysteresis(l, pos, 20, max, null).length, 10, 'la portée borne aussi');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
