/* spec-jouabilite.js — partie Node du lot « jouabilité / synchro client-serveur »
   (SPEC-JOUABLE-004, 006, 007, 009). Les comportements eux-mêmes sont prouvés
   de bout en bout par tests/e2e-jouabilite.js (vraie page, vrai serveur) ; ici :
     - l'analyse pure qui explique leurs échecs (tests/jouabilite-analyse.js),
       sur des séries synthétiques dont on connaît la réponse ;
     - le lancer d'un objet jeté (MC.createEntities().lancerObjet) sur sol plat ;
     - l'audit de src/game.js pour les deux bogues révélés par ces e2e (un clic
       droit qui utilisait deux fois, DONNE qui ajoutait un objet fantôme).
   Fichier Node-only (comme spec-archi-env.js) : `require` et `__dirname` sont
   exposés par tests/run.js. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path');
  var J = require('./jouabilite-analyse.js');
  var RACINE = path.join(__dirname, '..');
  var C = MC.Core, B = C.B;
  var flatWorld = G.flatWorld, seededRand = G.seededRand;

  function serie(n, f) { var out = []; for (var i = 0; i < n; i++) out.push(f(i)); return out; }

  describe('Specs — jouabilité : analyse des relevés (SPEC-JOUABLE-009)', function () {

    it('SPEC-JOUABLE-009 : un joueur immobile (bruit < 1e-4) ne produit aucun déplacement erroné', function () {
      var a = J.analyserPositions(serie(480, function (i) { return { t: i * 16.7, x: 10.5, y: 64 + (i % 2) * 5e-5, z: -3.5, etats: 1 }; }));
      A.ok(a.ok, 'immobile');
      A.equal(a.deplacements.length, 0, 'aucun déplacement');
      A.equal(a.echantillons, 480);
      A.ok(a.duree_ms > 7900, 'durée mesurée (' + a.duree_ms + ' ms)');
    });

    it('SPEC-JOUABLE-009 : chaque déplacement erroné porte vecteur, décalage cumulé, intervalle et source probable', function () {
      // trois recalages du client vers le bas, toutes les 30 images ; le 3e vient du serveur qui a bougé
      var y = 64, ech = [];
      for (var i = 0; i <= 100; i++) {
        var e = { t: i * 10, x: 1, y: y, z: 2, etats: 0, deltaServeur: 0 };
        if (i === 30 || i === 60) { y -= 0.02; e.y = y; e.etats = 1; e.ecart = 0.02; }
        if (i === 90) { y -= 0.05; e.y = y; e.etats = 1; e.deltaServeur = 0.05; }
        ech.push(e);
      }
      var a = J.analyserPositions(ech);
      A.notOk(a.ok, 'au-delà de 0,001 bloc : échec');
      A.equal(a.deplacements.length, 3, 'trois déplacements');
      var d0 = a.deplacements[0], d1 = a.deplacements[1], d2 = a.deplacements[2];
      A.equal(d0.t_ms, 300, 'instant du premier');
      A.close(d0.vecteur.dy, -0.02, 1e-9, 'vecteur du premier');
      A.equal(d0.intervalle_ms, null, 'pas d\'intervalle pour le premier');
      A.equal(d1.intervalle_ms, 300, 'intervalle entre deux déplacements erronés');
      A.close(d1.cumul.dy, -0.04, 1e-9, 'décalage cumulé');
      A.ok(/^correction serveur/.test(d0.source), 'recalage sans mouvement du serveur : ' + d0.source);
      A.ok(/^serveur/.test(d2.source), 'le serveur a bougé : ' + d2.source);
      A.close(a.final.dy, -0.09, 1e-9, 'décalage final');
      var msg = J.messagePositions('client', a);
      A.ok(/3 déplacement\(s\) erroné\(s\)/.test(msg) && /t=300 ms/.test(msg) && /intervalle=300 ms/.test(msg) && /cumul=\(\+0\.0000, -0\.0400, \+0\.0000\)/.test(msg),
        'le message cite la série : ' + msg);
      A.ok(/correction serveur ×2/.test(msg) && /serveur ×1/.test(msg), 'et le compte par source');
    });

    it('SPEC-JOUABLE-009 : une dérive lente (chaque pas sous le seuil) est datée, avec son allure et une série échantillonnée', function () {
      // 0,00005 bloc par image vers le bas pendant 480 images (8 s) : 0,024 bloc au total
      var a = J.analyserPositions(serie(481, function (i) { return { t: i * 16.67, x: 0, y: -i * 5e-5, z: 0, etats: 1 }; }));
      A.notOk(a.ok, 'la tolérance est franchie');
      A.equal(a.deplacements.length, 0, 'aucun pas au-dessus du seuil');
      A.ok(a.franchissement && a.franchissement.t_ms >= 300 && a.franchissement.t_ms <= 360, 'franchissement daté (' + JSON.stringify(a.franchissement) + ')');
      A.close(a.allure_bps, 0.003, 2e-4, 'allure en bloc/s');
      A.ok(a.serie.length >= 8, 'série échantillonnée (' + a.serie.length + ' points)');
      var msg = J.messagePositions('client', a);
      A.ok(/tolérance franchie à t=\d+ ms/.test(msg) && /allure 0\.00\d+ bloc\/s sur 8\.0 s/.test(msg) && /dérive lente/.test(msg) && /série échantillonnée/.test(msg) && /\(\+\d+ ms\)/.test(msg), msg);
    });

    it('SPEC-JOUABLE-009 : un pas sans aucun ETAT reçu est attribué au client', function () {
      var a = J.analyserPositions([{ t: 0, x: 0, y: 0, z: 0 }, { t: 16, x: 0.01, y: 0, z: 0, etats: 0 }]);
      A.ok(/^client/.test(a.deplacements[0].source), a.deplacements[0].source);
    });

    it('SPEC-JOUABLE-009 : la stabilité d\'une valeur date le retour arrière et liste les changements', function () {
      var ech = serie(10, function (i) { return { t: 1000 + i * 100, v: i >= 4 && i < 7 ? 3 : 0 }; });
      var s = J.analyserStabilite(ech, 0);
      A.notOk(s.ok);
      A.equal(s.premierEcart.t_ms, 400, 'retour arrière à 400 ms');
      A.equal(s.premierEcart.v, 3, 'valeur revenue');
      A.equal(s.changements.length, 2, 'deux changements (aller, retour)');
      A.equal(s.duree_ms, 900);
      A.ok(J.analyserStabilite(serie(5, function (i) { return { t: i, v: 'x' }; }), 'x').ok, 'stable : ok');
      var depuisAction = J.analyserStabilite(ech, 0, 800);
      A.equal(depuisAction.premierEcart.t_ms, 600, 'compté depuis l\'action quand elle est donnée');
      A.equal(depuisAction.duree_ms, 1100, 'durée depuis l\'action');
    });

    it('SPEC-JOUABLE-009 : inventaires comparés case à case, messages du serveur résumés', function () {
      var c = J.comparerInventaires([[7, 7], 0, [8, 5]], [[7, 8], 0, [8, 5]]);
      A.notOk(c.ok);
      A.equal(c.differences.length, 1);
      A.equal(c.differences[0].i, 0);
      A.ok(/case 0 client \[7,7\] \/ serveur \[7,8\]/.test(J.messageInventaires('x', c)), J.messageInventaires('x', c));
      A.equal(J.resumerInventaire([[7, 7], 0, [8, 5]]), '0:7×7 2:8×5');
      var r = J.resumerMessages([{ t: 1500, m: { t: 'inv_maj', rev: 3, ack: 1, gain: { id: 7, n: 1 }, inv: [[7, 8]] } }, { t: 1600, m: { t: 'chat' } }],
        function (m) { return m.t === 'inv_maj'; }, 1000);
      A.ok(/t=500 ms/.test(r) && /"rev":3/.test(r) && /"ack":1/.test(r) && /0:7×8/.test(r) && !/chat/.test(r), r);
    });
  });

  describe('Specs — jouabilité : jeter et ramasser (SPEC-JOUABLE-006, 007)', function () {

    it('SPEC-JOUABLE-006 : un objet jeté part devant le lanceur, retombe hors de portée et n\'est pas rendu au lanceur immobile', function () {
      var w = flatWorld(10);
      var ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents, MC.Modes.regles('survie', 'facile'));
      pl.state.pos = { x: 0.5, y: 11, z: 0.5 };
      pl.state.onGround = true;
      pl.state.yaw = 0; pl.state.pitch = 0;               // regard vers -z
      var e = ents.lancerObjet(pl.eyePos(), pl.lookDir(), B.COBBLE, 1);
      A.equal(e.type, 'item');
      A.equal(e.n, 1);
      A.ok(e.pickup >= 2, 'personne ne le ramasse avant 2 s (' + e.pickup + ')');
      var pris = 0;
      for (var i = 0; i < 300; i++) {
        var ev = ents.update(1 / 60, pl.state, { joueurs: [pl.state] });
        pris += ev.picked.length;
      }
      A.equal(pris, 0, 'le lanceur immobile ne le ramasse pas en 5 s');
      A.ok(!e.dead, 'il est toujours au sol');
      A.ok(e.pos.z < 0.5 - 2.5, 'retombé devant le lanceur, à plus de 2,5 blocs (' + (0.5 - e.pos.z).toFixed(2) + ')');
      A.close(e.pos.x, 0.5, 0.05, 'dans l\'axe du regard');
      A.between(e.pos.y, 10.9, 11.1, 'posé au sol');
    });

    it('SPEC-JOUABLE-007 : marcher sur un objet jeté le ramasse (une fois le délai passé)', function () {
      var w = flatWorld(10);
      var ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents, MC.Modes.regles('survie', 'facile'));
      pl.state.pos = { x: 0.5, y: 11, z: 0.5 };
      pl.state.onGround = true;
      var e = ents.lancerObjet(pl.eyePos(), pl.lookDir(), B.COBBLE, 1);
      for (var i = 0; i < 180; i++) ents.update(1 / 60, pl.state, { joueurs: [pl.state] });
      pl.state.pos = { x: e.pos.x, y: 11, z: e.pos.z + 0.5 };
      var pris = [];
      for (var k = 0; k < 60 && !pris.length; k++) pris = pris.concat(ents.update(1 / 60, pl.state, { joueurs: [pl.state] }).picked);
      A.equal(pris.length, 1, 'ramassé');
      A.equal(pris[0].id, B.COBBLE);
    });

    it('SPEC-JOUABLE-006 : un objet jeté ne fusionne pas avec un objet identique déjà ramassable (son délai de 2 s tient)', function () {
      var w = flatWorld(10);
      var ents = MC.createEntities(w);
      var pret = ents.dropItem(0.5, 11, 0.5, B.COBBLE, 1, seededRand(1));
      pret.vel.x = pret.vel.y = pret.vel.z = 0; pret.pickup = 0;          // déjà ramassable
      var jete = ents.lancerObjet({ x: 0.5, y: 11.2, z: 0.5 }, { x: 0, y: 0, z: 0 }, B.COBBLE, 1);
      jete.vel.x = jete.vel.y = jete.vel.z = 0;
      A.equal(ents.mergeItems(), 0, 'pas de fusion : délais différents');
      A.ok(jete.pickup >= 2 && !jete.dead, 'l\'objet jeté garde son délai');
      // deux objets au délai écoulé fusionnent ; le délai le plus long l'emporte
      var autre = ents.dropItem(0.5, 11, 0.5, B.COBBLE, 1, seededRand(2));
      autre.vel.x = autre.vel.y = autre.vel.z = 0; autre.pickup = -0.5;
      A.equal(ents.mergeItems(), 1, 'deux objets ramassables fusionnent');
      A.equal(pret.n, 2);
      // jamais deux données différentes (livre écrit, batterie…)
      var d1 = ents.dropItem(5.5, 11, 5.5, B.COBBLE, 1, seededRand(3)), d2 = ents.dropItem(5.5, 11, 5.5, B.COBBLE, 1, seededRand(4));
      d1.vel.x = d1.vel.z = d2.vel.x = d2.vel.z = 0; d1.pos.x = d2.pos.x; d1.pos.z = d2.pos.z;
      d1.data = { titre: 'A' }; d2.data = { titre: 'B' };
      A.equal(ents.mergeItems(), 0, 'données différentes : pas de fusion');
      d2.data = { titre: 'A' };
      A.equal(ents.mergeItems(), 1, 'données identiques et même délai : fusion');
    });

    it('SPEC-JOUABLE-006 : un objet jeté garde sa donnée (lâcher → lancer → ramasser)', function () {
      var joueur = { inv: MC.Inventory.create(36), grille: MC.Inventory.create(9), equip: {} };
      joueur.inv.addStack(B.COBBLE, 1, { note: 'x' });
      var r = MC.Conteneurs.appliquer({ joueur: joueur, conteneur: function () { return null; }, regles: MC.Modes.regles('survie', 'facile') },
        { k: 'lacher', i: 0, n: 1 });
      A.ok(r.ok, 'lâcher accepté');
      A.equal(JSON.stringify(r.effets.lache.data), '{"note":"x"}', 'la donnée part avec l\'objet lâché');
      var w = flatWorld(10), ents = MC.createEntities(w);
      var e = ents.lancerObjet({ x: 0.5, y: 12, z: 0.5 }, { x: 0, y: 0, z: -1 }, B.COBBLE, 1, r.effets.lache.data);
      var pl = { pos: { x: 0.5, y: 11, z: 0.5 } };
      for (var i = 0; i < 200; i++) ents.update(1 / 60, { pos: { x: 99, y: 11, z: 99 } });
      pl.pos = { x: e.pos.x, y: 11, z: e.pos.z };
      var pris = [];
      for (var k = 0; k < 60 && !pris.length; k++) pris = ents.update(1 / 60, pl).picked;
      A.equal(pris.length, 1, 'ramassé');
      A.equal(JSON.stringify(pris[0].data), '{"note":"x"}', 'la donnée revient au ramassage');
      var src = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
      A.ok(/lancerObjet\(js\.joueur\.eyePos\(\), js\.joueur\.lookDir\(\), pile\.id, pile\.n, pile\.data, pile\.dmg\)/.test(src), 'le serveur transmet la donnée et l\'usure au jet');
    });

    it('SPEC-JOUABLE-006 : un outil usé jeté puis ramassé garde exactement son usure (lâcher → lancer → ramasser → inventaire)', function () {
      var I = C.I, OUTIL = I.BRONZE_PIOCHE;
      var joueur = { inv: MC.Inventory.create(36), grille: MC.Inventory.create(9), equip: {} };
      joueur.inv.slots[0] = { id: OUTIL, n: 1, dmg: 7 };
      var r = MC.Conteneurs.appliquer({ joueur: joueur, conteneur: function () { return null; }, regles: MC.Modes.regles('survie', 'facile') },
        { k: 'lacher', i: 0, n: 1 });
      A.ok(r.ok, 'lâcher accepté');
      A.equal(r.effets.lache.dmg, 7, 'l\'usure part avec l\'outil lâché');
      var w = flatWorld(10), ents = MC.createEntities(w);
      var e = ents.lancerObjet({ x: 0.5, y: 12, z: 0.5 }, { x: 0, y: 0, z: -1 }, OUTIL, 1, r.effets.lache.data, r.effets.lache.dmg);
      A.equal(e.dmg, 7, 'l\'objet au sol porte l\'usure');
      for (var i = 0; i < 200; i++) ents.update(1 / 60, { pos: { x: 99, y: 11, z: 99 } });
      var pl = { pos: { x: e.pos.x, y: 11, z: e.pos.z } };
      var pris = [];
      for (var k = 0; k < 60 && !pris.length; k++) pris = ents.update(1 / 60, pl).picked;
      A.equal(pris.length, 1, 'ramassé');
      A.equal(pris[0].dmg, 7, 'le ramassage rapporte l\'usure');
      var inv2 = MC.Inventory.create(36);
      A.equal(inv2.addStack(pris[0].id, pris[0].n, pris[0].data, pris[0].dmg), 0, 'rangé');
      A.equal(inv2.slots[0].dmg, 7, 'revient dans l\'inventaire avec la même usure (pas neuf)');
      // la même chose par le joueur (pickUp) et par dropSelected
      var g = MC.createPlayer(flatWorld(10), MC.createEntities(flatWorld(10)), MC.Modes.regles('survie', 'facile'));
      g.state.inv.slots[0] = { id: OUTIL, n: 1, dmg: 5 }; g.state.selected = 0;
      var d = g.dropSelected(1, seededRand(1));
      A.equal(d.entity.dmg, 5, 'dropSelected transmet l\'usure');
      A.equal(g.pickUp(OUTIL, 1, undefined, 5), 0);
      A.equal(g.state.inv.slots[0].dmg, 5, 'pickUp range l\'usure');
    });

    it('SPEC-JOUABLE-006 : mergeItems ne fusionne pas deux objets d\'usure différente, et fusionne ceux d\'usure égale', function () {
      var ents = MC.createEntities(flatWorld(10));
      var a = ents.dropItem(5.5, 11, 5.5, B.COBBLE, 1, seededRand(3), undefined, 3), b = ents.dropItem(5.5, 11, 5.5, B.COBBLE, 1, seededRand(4), undefined, 9);
      a.vel.x = a.vel.z = b.vel.x = b.vel.z = 0; a.pos.x = b.pos.x; a.pos.z = b.pos.z;
      A.equal(ents.mergeItems(), 0, 'usures différentes : pas de fusion');
      b.dmg = 3;
      A.equal(ents.mergeItems(), 1, 'usures égales : fusion');
    });

    it('SPEC-JOUABLE-006 : le butin PvP, les coffres cassés et les véhicules détruits gardent l\'usure ; le serveur la transmet partout', function () {
      var I = C.I, PV = MC.PvpEnjeux;
      var perdant = MC.Inventory.create(36), gagnant = MC.Inventory.create(36);
      perdant.slots[0] = { id: I.BRONZE_PIOCHE, n: 1, dmg: 11 };
      var r = PV.resoudreButin(perdant, gagnant, 'graine-usure');
      A.equal(r.perte[0].dmg, 11, 'la perte porte l\'usure');
      A.equal(gagnant.slots[0].dmg, 11, 'le gagnant reçoit l\'outil avec son usure');
      var plein = MC.Inventory.create(36);
      for (var i = 0; i < 36; i++) plein.slots[i] = { id: B.COBBLE, n: 64 };
      var p2 = MC.Inventory.create(36); p2.slots[0] = { id: I.BRONZE_PIOCHE, n: 1, dmg: 11 };
      var r2 = PV.resoudreButin(p2, plein, 'graine-usure');
      A.equal(r2.reste.length, 1, 'inventaire plein : reliquat');
      A.equal(r2.reste[0].dmg, 11, 'le reliquat (lâché au sol) porte l\'usure');
      // coffre cassé, soute détruite, conteneur tronqué, distributeur, trop-plein, reliquat : tous passent par dropStack
      var ents = MC.createEntities(flatWorld(10));
      var e1 = ents.dropStack(0.5, 11, 0.5, { id: I.BRONZE_PIOCHE, n: 1, dmg: 4, data: { note: 'q' } }, seededRand(1));
      A.equal(e1.dmg, 4, 'dropStack : usure portée par l\'objet au sol');
      A.equal(JSON.stringify(e1.data), '{"note":"q"}', 'dropStack : donnée portée aussi');
      var e2 = ents.dropStack(9.5, 11, 9.5, { id: B.COBBLE, n: 3 }, seededRand(2));
      A.equal(e2.dmg, 0, 'une pile sans usure reste sans usure');
      e1.pickup = e2.pickup = 0; e1.pos = { x: 0.5, y: 11, z: 0.5 }; e1.vel = { x: 0, y: 0, z: 0 };
      var pris = ents.update(1 / 60, { pos: { x: 0.5, y: 11, z: 0.5 } }).picked.filter(function (p) { return p.id === I.BRONZE_PIOCHE; });
      A.equal(pris.length, 1, 'ramassé');
      A.equal(pris[0].dmg, 4, 'rapporte l\'usure');
    });

    it('SPEC-JOUABLE-006 : fermer la grille et déclarer un distributeur rendent l\'outil avec son usure (jamais neuf), reliquat compris', function () {
      var I = C.I, OUTIL = I.BRONZE_PIOCHE, Cx = MC.Conteneurs;
      function joueurAvecOutil(dmg) {
        var j = { inv: MC.Inventory.create(36), grille: MC.Inventory.create(9), equip: {} };
        j.inv.slots[0] = { id: OUTIL, n: 1, dmg: dmg };
        return j;
      }
      var regles = MC.Modes.regles('survie', 'facile');
      var j = joueurAvecOutil(7), cx = { joueur: j, conteneur: function () { return null; }, regles: regles };
      A.ok(Cx.appliquer(cx, { k: 'transfert', de: { z: 'inv', i: 0 }, vers: { z: 'grille', i: 0 }, n: 1 }).ok);
      A.equal(j.grille.slots[0].dmg, 7, 'déposé dans la grille avec son usure');
      var r = Cx.appliquer(cx, { k: 'rendreGrille' });
      A.ok(r.ok);
      A.equal(j.inv.slots.filter(Boolean).length, 1, 'rendu à l\'inventaire');
      A.equal(j.inv.slots.filter(Boolean)[0].dmg, 7, 'grille rendue : usure conservée');
      var j2 = joueurAvecOutil(0);
      for (var i = 0; i < 36; i++) j2.inv.slots[i] = { id: B.COBBLE, n: 64 };
      j2.grille.slots[0] = { id: OUTIL, n: 1, dmg: 6, data: { k: 1 } };
      var r2 = Cx.appliquer({ joueur: j2, conteneur: function () { return null; }, regles: regles }, { k: 'rendreGrille' });
      A.equal(r2.effets.reste.length, 1, 'reliquat');
      A.equal(r2.effets.reste[0].dmg, 6, 'le reliquat porte l\'usure');
      A.equal(JSON.stringify(r2.effets.reste[0].data), '{"k":1}', 'et la donnée');
      // distributeur : l'état vient de ce que le joueur possède, déclaré avec ou sans usure
      [[[OUTIL, 1, 9]], [[OUTIL, 1]]].forEach(function (decl) {
        var j3 = joueurAvecOutil(9);
        var cont = { type: 'distributeur', taille: 9, slots: new Array(9).fill(null), rev: 0 };
        var r3 = Cx.appliquer({ joueur: j3, conteneur: function () { return cont; }, regles: regles }, { k: 'declarer', cle: 'x', slots: decl });
        A.ok(r3.ok);
        A.equal(cont.slots[0] && cont.slots[0].dmg, 9, 'distributeur : l\'outil entre avec son usure (' + JSON.stringify(decl) + ')');
        A.equal(j3.inv.slots.filter(Boolean).length, 0, 'et quitte l\'inventaire');
        var r4 = Cx.appliquer({ joueur: j3, conteneur: function () { return cont; }, regles: regles }, { k: 'declarer', cle: 'x', slots: [] });
        A.ok(r4.ok);
        A.equal(cont.slots[0], null, 'distributeur vidé');
        A.equal(j3.inv.slots.filter(Boolean)[0].dmg, 9, 'retrait : l\'usure revient dans l\'inventaire');
      });
      // une usure déclarée qu'on ne possède pas ne prélève rien : l'outil neuf reste neuf
      var j5 = { inv: MC.Inventory.create(36), grille: MC.Inventory.create(9), equip: {} };
      j5.inv.slots[0] = { id: OUTIL, n: 1 };
      var cont5 = { type: 'distributeur', taille: 9, slots: new Array(9).fill(null), rev: 0 };
      Cx.appliquer({ joueur: j5, conteneur: function () { return cont5; }, regles: regles }, { k: 'declarer', cle: 'x', slots: [[OUTIL, 1, 3]] });
      A.equal(cont5.slots[0], null, 'rien de prélevé');
      A.ok(j5.inv.slots[0] && !j5.inv.slots[0].dmg, 'l\'outil neuf reste dans l\'inventaire, neuf');
    });

    it('SPEC-JOUABLE-006 : tout lâcher du serveur passe par dropStack (comptage exact) ; aucune pile à état ne retombe sur dropItem(id, n) nu', function () {
      var src = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
      A.equal((src.match(/entites\.dropStack\(/g) || []).length, 6, 'coffre cassé, conteneur tronqué, soute, distributeur, trop-plein aux pieds, reliquat de ramassage');
      A.equal((src.match(/entites\.dropItem\(/g) || []).length, 1, 'un seul dropItem nu : le butin d\'un bloc cassé (aucun état)');
      A.equal((src.match(/lancerObjet\(js\.joueur\.eyePos\(\), js\.joueur\.lookDir\(\), pile\.id, pile\.n, pile\.data, pile\.dmg\)/g) || []).length, 1, 'jet : usure transmise');
      A.equal((src.match(/pickUp\(p\.id, p\.n, p\.data, p\.dmg\)/g) || []).length, 1, 'ramassage : usure transmise');
      A.equal((src.match(/r\.effets\.reste\.forEach\(p => lacherAuxPieds\(js, p\)\)/g) || []).length, 1, 'reliquat de la grille lâché aux pieds');
    });

    it('SPEC-JOUABLE-001 : un blocage de 5 s du serveur à l\'arrivée du joueur (génération du terrain) est rattrapé aussitôt, sans retard permanent ni entrée perdue', function () {
      // cas mesuré par les e2e sous charge : boucle bloquée 1,5 à 9 s juste après la connexion
      // (spec-horizon couvre des blocages répétés de 0,9 s ; ici, un seul blocage long)
      var SY = MC.Synchro, w = flatWorld(10), ents = MC.createEntities(w);
      function joueur() { var p = MC.createPlayer(w, ents, MC.Modes.regles('survie', 'facile')); p.state.pos = { x: 0.5, y: 11, z: 0.5 }; p.state.onGround = true; return p; }
      var client = joueur(), serveur = joueur(), pred = SY.creerPrediction(), file = [], budget = SY.creerBudget(), dernier = 0;
      function envoyer(n) {
        for (var k = 0; k < n; k++) {
          var e = pred.enregistrer(1 / 60, { forward: k % 120 < 60 ? 1 : 0 }, 0.3, 0, false);
          SY.rejouer(client, [e]);
          SY.empilerEntree(file, JSON.parse(JSON.stringify(e)));
        }
      }
      envoyer(300);                                                           // 5 s d'entrées pendant le blocage
      dernier = SY.avancerEntrees(serveur, file, budget, 5, dernier).dernier;  // un seul tic, 5 s après
      for (var t = 0; t < 30; t++) { envoyer(1); dernier = SY.avancerEntrees(serveur, file, budget, 1 / 60, dernier).dernier; }
      A.ok(pred.suivant - 1 - dernier <= 1, 'le serveur a rattrapé le client (' + (pred.suivant - 1 - dernier) + ' entrée(s) d\'écart, celle de l\'image en cours)');
      dernier = SY.avancerEntrees(serveur, file, budget, 1 / 60, dernier).dernier;
      A.equal(dernier, pred.suivant - 1, 'toutes les entrées sont acquittées');
      var a = client.state.pos, b = serveur.state.pos;
      A.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-9, 'aucune entrée perdue : serveur et client au même endroit (' + Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) + ')');
    });

    it('SPEC-JOUABLE-001 : le serveur de jeu de test n\'hérite d\'aucun réglage MC_*, valide l\'inventaire de départ et n\'écoute que la boucle locale', function () {
      var src = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
      var i = src.indexOf('function traiterServeurJeuTest(');
      var corps = src.slice(i, src.indexOf('function servir(', i));
      A.ok(/if \(!\/\^MC_\/\.test\(k\)\) env\[k\] = process\.env\[k\]/.test(corps), 'aucun MC_* hérité du banc');
      A.ok(/MC_TEST_BOUCLE_LOCALE: '1'/.test(corps) && corps.indexOf('MC_TEST_POSE_LIBRE') < 0, 'boucle locale, jamais de pose libre');
      A.ok(/!!C\.def\(p\[0\]\)/.test(corps) && /p\[1\] <= C\.maxStack\(p\[0\]\)/.test(corps), 'objets définis, quantités bornées');
      A.ok(/if \(reseauOuvert && !BOUCLE_LOCALE_TEST\)/.test(src), 'ouvert, mais écoute locale en mode test');
    });

    it('SPEC-JOUABLE-006 : le serveur lance l\'objet d\'un INV_LACHER devant le joueur (lancerDevant), un trop-plein tombe toujours aux pieds', function () {
      var src = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
      A.ok(/op\.k === 'lacher' \? lancerDevant : lacherAuxPieds/.test(src), 'traiterOp choisit lancerDevant pour un lâcher');
      A.ok(/function lancerDevant\(js, pile\)[\s\S]{0,200}entites\.lancerObjet\(js\.joueur\.eyePos\(\), js\.joueur\.lookDir\(\)/.test(src), 'depuis l\'œil, dans le regard du joueur');
    });

    it('SPEC-JOUABLE-007 : DONNE n\'ajoute rien à l\'inventaire du client (le gain arrive par INV_MAJ)', function () {
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      var i = jeu.indexOf('onDonne: function');
      A.ok(i >= 0, 'onDonne existe');
      var j = jeu.indexOf('onStatut:', i);
      A.ok(j > i, 'onStatut suit onDonne');
      var corps = jeu.slice(i, j);
      A.equal(corps.indexOf('pickUp'), -1, 'onDonne ne fait plus pickUp (objet fantôme)');
    });
  });

  describe('Specs — jouabilité : un coffre ouvert en ligne accepte les transferts (SPEC-JOUABLE-008)', function () {
    it('SPEC-JOUABLE-008 : un transfert vers et depuis le miroir client d\'un coffre (forme de CONTENEUR_ETAT) est accepté', function () {
      var Inv = MC.Inventory;
      var joueur = { inv: Inv.create(36), grille: Inv.create(9), equip: {} };
      joueur.inv.add(B.COBBLE, 10);
      // le miroir tel que l'écrivait onConteneurEtat : sans `taille`
      var miroir = { cle: '1,2,3', type: 'chest', rev: 0, slots: new Array(27).fill(null) };
      var ctx = { joueur: joueur, conteneur: function (cle) { return cle === miroir.cle ? miroir : null; }, regles: MC.Modes.regles('survie', 'facile') };
      var r = MC.Conteneurs.appliquer(ctx, { k: 'transfert', de: { z: 'inv', i: 0 }, vers: { z: 'cont', cle: miroir.cle, i: 0 }, n: 10 });
      A.ok(r.ok, 'dépôt accepté (' + r.motif + ')');
      A.equal(miroir.slots[0] && miroir.slots[0].n, 10, 'la pierre est dans le coffre');
      var r2 = MC.Conteneurs.appliquer(ctx, { k: 'transfert', de: { z: 'cont', cle: miroir.cle, i: 0 }, vers: { z: 'inv', i: 5 }, n: 5 });
      A.ok(r2.ok, 'retrait accepté (' + r2.motif + ')');
      A.equal(joueur.inv.slots[5] && joueur.inv.slots[5].n, 5, 'cinq pierres reviennent');
      // la borne de la revue tient toujours : au-delà de la taille du TYPE, refusé
      var r3 = MC.Conteneurs.appliquer(ctx, { k: 'transfert', de: { z: 'inv', i: 5 }, vers: { z: 'cont', cle: miroir.cle, i: 27 }, n: 1 });
      A.notOk(r3.ok, 'indice hors du coffre refusé');
      A.equal(miroir.slots.length, 27, 'le tableau n\'a pas grandi');
    });
    it('SPEC-JOUABLE-008 : un delta du serveur s\'applique à l\'état CONFIRMÉ du coffre, l\'affiché est reconstruit (confirmé + rejeu)', function () {
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      var i = jeu.indexOf('function appliquerDeltaConteneur(');
      var corps = jeu.slice(i, jeu.indexOf('function reconstruirePredit(', i));
      A.ok(/var c = conteneurOuvert\.confirme;/.test(corps) && corps.indexOf('.mirror') < 0, 'le delta ne touche jamais le miroir affiché');
      var k = jeu.indexOf('function reconstruirePredit(');
      var rc = jeu.slice(k, k + 1800);
      A.ok(/m\.slots\[i\] = copiePile\(c\.slots\[i\]\)/.test(rc), 'le miroir repart de l\'état confirmé');
      A.ok(rc.indexOf('st.inv.load(v.inv)') >= 0 && rc.indexOf('j.predInv.rejouer(st, conteneurs') > rc.indexOf('st.inv.load(v.inv)'), 'puis l\'inventaire confirmé, puis le rejeu');
      var o = jeu.indexOf('onInvMaj: function');
      var inv = jeu.slice(o, jeu.indexOf('onConteneurEtat: function', o));
      A.ok(inv.indexOf('forEach(appliquerDeltaConteneur)') < inv.indexOf('reconstruirePredit(j)'), 'onInvMaj : deltas au confirmé AVANT la reconstruction');
    });
    it('SPEC-JOUABLE-008 : le miroir client d\'un conteneur porte sa taille', function () {
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      var i = jeu.indexOf('onConteneurEtat: function');
      A.ok(/var mirror = \{ cle: v\.cle, type: v\.type, rev: v\.rev, taille: v\.slots\.length/.test(jeu.slice(i, i + 800)), 'taille dans le miroir');
    });
  });

  describe('Specs — jouabilité : un clic droit, une utilisation (SPEC-JOUABLE-004)', function () {
    it('SPEC-JOUABLE-004 : l\'appui (onUse) arme le délai de répétition de la boucle', function () {
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      var i = jeu.indexOf('function onUse()');
      A.ok(i >= 0, 'onUse existe');
      var debut = jeu.slice(i, i + 900);
      A.ok(/equipe\[0\]\.useCd = 0\.22/.test(debut), 'onUse pose useCd avant toute utilisation');
      A.ok(/if \(j\.useCd <= 0\) \{ j\.useCd = 0\.22; utiliserPour\(j\); \}/.test(jeu), 'la boucle ne répète qu\'une fois le délai écoulé');
    });
    it('SPEC-JOUABLE-004 : la réconciliation garde le regard courant du joueur (un coup de souris entre deux images n\'est pas effacé)', function () {
      var SY = MC.Synchro;
      var w = flatWorld(10), ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents, MC.Modes.regles('survie', 'facile'));
      pl.state.pos = { x: 0.5, y: 11, z: 0.5 }; pl.state.onGround = true;
      var pred = SY.creerPrediction();
      pl.state.yaw = 0; pl.state.pitch = 0;
      // deux images jouées avec le regard de l'époque, pas encore acquittées
      for (var i = 0; i < 2; i++) { var e = pred.enregistrer(1 / 60, SY.decoderTouches(0), pl.state.yaw, pl.state.pitch, false); SY.rejouer(pl, [e]); }
      // la souris tourne le regard, PUIS un ETAT arrive avant l'image suivante
      pl.state.yaw = 1.2; pl.state.pitch = -0.7;
      SY.reconcilier(pl, SY.etatJoueur(pl, 0), pred, null);
      A.close(pl.state.yaw, 1.2, 1e-9, 'le regard courant survit au rejeu (yaw)');
      A.close(pl.state.pitch, -0.7, 1e-9, 'et l\'inclinaison');
    });

    it('SPEC-JOUABLE-004 : une équipe recomposée en ligne (serveur dans un autre mode) garde sa prédiction d\'inventaire', function () {
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      var i = jeu.indexOf('function composerEquipe(');
      var corps = jeu.slice(i, i + 2500);
      A.ok(/var etaitEnLigne = !!net && \(net\.etat === 'en ligne' \|\| net\.etat === 'connexion'\)/.test(corps), 'composerEquipe sait si l\'équipe jouait en ligne');
      A.ok(/if \(etaitEnLigne\) preparerEnLigne\(j\);/.test(corps), 'et prépare la nouvelle équipe pour le réseau (predInv, revInv, journalInv)');
      var p = jeu.indexOf('function preparerEnLigne(');
      A.ok(/j\.predInv = MC\.Conteneurs\.creerPrediction\(\);/.test(jeu.slice(p, p + 600)), 'preparerEnLigne crée la prédiction d\'inventaire');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
