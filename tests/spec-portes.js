/* spec-portes.js — tests des specs SPEC-PORTE-001 (portes) et SPEC-PORTE-002
   (trappes) : recettes, pose sur deux blocs et orientation, bascule d'un clic
   droit, collisions selon l'état, créatures et habitants, casse, bâtiments
   générés. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, P = MC.Physics, Inv = MC.Inventory;
  var B = C.B, I = C.I;
  var flatWorld = G.flatWorld;
  var SPECS = MC.EntitySpecs;

  /* Une partie minimale : monde plat (sol jusqu'à y = 9), entités, joueur posé
     juste au-dessus. Même schéma que tests/functional.js. */
  function partie() {
    var w = flatWorld(9, B.STONE);
    var ents = MC.createEntities(w);
    var pl = MC.createPlayer(w, ents);
    pl.state.pos = { x: 3.5, y: 10, z: 3.5 };
    pl.state.onGround = true;
    return { w: w, ents: ents, pl: pl, s: pl.state };
  }

  describe('Specs — portes et trappes', function () {
    // ── recettes ──────────────────────────────────────────────────────────
    it('SPEC-PORTE-001 : une porte se fabrique avec 6 planches, en 2 colonnes de 3', function () {
      var grid = [B.PLANKS, B.PLANKS, B.PLANKS, B.PLANKS, B.PLANKS, B.PLANKS];
      var r = Inv.matchRecipe(grid, 2, 3);
      A.ok(r && r.id === I.PORTE, 'la grille 2×3 de planches rend une porte');
    });
    it('SPEC-PORTE-002 : une trappe se fabrique avec 6 planches, en 2 rangées de 3', function () {
      var grid = [B.PLANKS, B.PLANKS, B.PLANKS, B.PLANKS, B.PLANKS, B.PLANKS];
      var r = Inv.matchRecipe(grid, 3, 2);
      A.ok(r && r.id === I.TRAPPE, 'la grille 3×2 de planches rend une trappe');
    });

    // ── pose et orientation ──────────────────────────────────────────────
    it('SPEC-PORTE-001 : poser une porte occupe deux blocs, orientée selon le regard', function () {
      var g = partie();
      g.s.inv.add(I.PORTE, 1); g.s.selected = 0;
      // le joueur regarde vers -z (nord) : yaw = 0, comme lookDir() le définit
      g.s.yaw = 0;
      var t = { x: 5, y: 9, z: 5, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), 'place', 'la porte se pose');
      var bas = g.w.getBlock(5, 10, 5), haut = g.w.getBlock(5, 11, 5);
      A.equal(bas, haut, 'les deux moitiés partagent le même id');
      A.ok(C.estPorte(bas), 'c\'est bien une porte');
      A.equal(C.BLOCKS[bas].porte.wall, C.orientDeRegard(g.pl.lookDir()), 'orientée face au regard');
      A.notOk(C.BLOCKS[bas].porte.ouverte, 'posée fermée');
      A.equal(g.s.inv.count(I.PORTE), 0, 'la porte posée est consommée');
    });
    it('SPEC-PORTE-001 : l\'orientation suit le regard, dans les quatre directions', function () {
      var vus = {};
      [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2].forEach(function (yaw) {
        var g = partie();
        g.s.inv.add(I.PORTE, 1); g.s.selected = 0;
        g.s.yaw = yaw;
        var t = { x: 5, y: 9, z: 5, block: B.STONE, nx: 0, ny: 1, nz: 0 };
        g.pl.useOn(t);
        var id = g.w.getBlock(5, 10, 5);
        vus[C.BLOCKS[id].porte.wall] = 1;
      });
      A.equal(Object.keys(vus).length, 4, 'les quatre murs sont atteints selon le regard');
    });
    it('SPEC-PORTE-002 : poser une trappe occupe un seul bloc, toujours fermée', function () {
      var g = partie();
      g.s.inv.add(I.TRAPPE, 1); g.s.selected = 0;
      var t = { x: 5, y: 9, z: 5, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), 'place');
      var id = g.w.getBlock(5, 10, 5);
      A.ok(C.estTrappe(id), 'c\'est une trappe');
      A.notOk(C.BLOCKS[id].trappe.ouverte, 'posée fermée');
      A.equal(g.w.getBlock(5, 11, 5), 0, 'un seul bloc occupé');
    });

    // ── bascule d'un clic droit ───────────────────────────────────────────
    it('SPEC-PORTE-001 : un clic droit bascule une porte, les deux moitiés ensemble', function () {
      var g = partie();
      g.w.setBlock(5, 10, 5, B.PORTE_FERMEE_N);
      g.w.setBlock(5, 11, 5, B.PORTE_FERMEE_N);
      var t = { x: 5, y: 10, z: 5, block: B.PORTE_FERMEE_N, nx: 0, ny: 0, nz: -1 };
      A.equal(g.pl.useOn(t), 'bascule');
      A.equal(g.w.getBlock(5, 10, 5), B.PORTE_OUVERTE_N, 'la moitié visée s\'ouvre');
      A.equal(g.w.getBlock(5, 11, 5), B.PORTE_OUVERTE_N, 'l\'autre moitié suit');
      // un second clic la referme
      A.equal(g.pl.useOn(t), 'bascule');
      A.equal(g.w.getBlock(5, 10, 5), B.PORTE_FERMEE_N);
      A.equal(g.w.getBlock(5, 11, 5), B.PORTE_FERMEE_N);
    });
    it('SPEC-PORTE-002 : un clic droit bascule une trappe', function () {
      var g = partie();
      g.w.setBlock(5, 10, 5, B.TRAPPE_FERMEE);
      var t = { x: 5, y: 10, z: 5, block: B.TRAPPE_FERMEE, nx: 0, ny: 0, nz: -1 };
      A.equal(g.pl.useOn(t), 'bascule');
      A.equal(g.w.getBlock(5, 10, 5), B.TRAPPE_OUVERTE);
      A.equal(g.pl.useOn(t), 'bascule');
      A.equal(g.w.getBlock(5, 10, 5), B.TRAPPE_FERMEE);
    });

    // ── boîte de collision partielle (fonction pure de core.js) ──────────
    it('SPEC-PORTE-001 : boiteDe renvoie la boîte du panneau pour une porte, rien pour les autres blocs', function () {
      var boites = C.boiteDe(B.PORTE_FERMEE_N);
      A.ok(boites && boites.length === 1, 'une boîte pour une porte fermée');
      A.equal(boites[0].z1, C.EPAIS_PANNEAU, 'fine sur l\'épaisseur du panneau');
      A.equal(boites[0].x1, 1, 'pleine largeur');
      A.equal(C.boiteDe(B.STONE), null, 'un bloc plein ordinaire n\'a pas de boîte partielle (isSolid suffit)');
      A.equal(C.boiteDe(B.AIR), null, 'l\'air non plus');
    });

    // ── collisions selon l'état ───────────────────────────────────────────
    it('SPEC-PORTE-001 : une porte fermée arrête, ouverte laisse passer', function () {
      var w = flatWorld(9, B.STONE);
      w.setBlock(5, 10, 5, B.PORTE_FERMEE_N);
      w.setBlock(5, 11, 5, B.PORTE_FERMEE_N);
      // au ras du panneau (mur nord, tranche z ∈ [5, 5.1875])
      A.ok(P.collides(w, 5.5, 10, 5.05, 0.6, 1.8), 'porte fermée : on ne passe pas');
      w.setBlock(5, 10, 5, B.PORTE_OUVERTE_N);
      w.setBlock(5, 11, 5, B.PORTE_OUVERTE_N);
      A.notOk(P.collides(w, 5.5, 10, 5.05, 0.6, 1.8), 'porte ouverte : on passe');
    });
    it('SPEC-PORTE-002 : une trappe fermée porte, ouverte laisse tomber', function () {
      var w = flatWorld(9, B.STONE);
      w.setBlock(5, 10, 5, B.TRAPPE_FERMEE);
      A.ok(P.collides(w, 5.5, 10, 5.5, 0.6, 1.8), 'trappe fermée : on marche dessus');
      w.setBlock(5, 10, 5, B.TRAPPE_OUVERTE);
      A.notOk(P.collides(w, 5.5, 10, 5.5, 0.6, 1.8), 'trappe ouverte : on passe à travers');
    });
    it('SPEC-PORTE-002 : une échelle sous une trappe ouverte se grimpe jusqu\'à elle', function () {
      var w = flatWorld(9, B.STONE);
      w.setBlock(5, 10, 5, B.LADDER);
      w.setBlock(5, 11, 5, B.TRAPPE_OUVERTE);
      var occ = P.occupeAvec(w, 5.5, 10, 5.5, 0.6, 1.8, 'grimpable');
      A.ok(occ, 'l\'échelle se saisit sous la trappe');
      A.notOk(P.collides(w, 5.5, 11, 5.5, 0.6, 1.8), 'la trappe ouverte au-dessus ne bloque pas la montée');
    });

    // ── créatures et habitants ────────────────────────────────────────────
    it('SPEC-PORTE-001 : un zombie ne franchit pas une porte fermée', function () {
      var w = flatWorld(9, B.STONE);
      w.setBlock(5, 10, 5, B.PORTE_FERMEE_N);
      w.setBlock(5, 11, 5, B.PORTE_FERMEE_N);
      var ents = MC.createEntities(w);
      var z = ents.spawn('zombie', 5.5, 10, 6.3, { wanderDir: -Math.PI / 2, wanderCd: 999, onGround: true });
      var loin = { pos: { x: 9999, y: 10, z: 9999 }, dead: false };
      for (var i = 0; i < 90; i++) ents.update(1 / 30, loin, {});
      A.equal(w.getBlock(5, 10, 5), B.PORTE_FERMEE_N, 'un zombie n\'ouvre jamais la porte');
      A.ok(z.pos.z > 5 + C.EPAIS_PANNEAU, 'et reste coincé du mauvais côté (z=' + z.pos.z.toFixed(2) + ')');
    });
    it('SPEC-PORTE-001 : un habitant qui bute contre une porte fermée l\'ouvre, puis elle se referme seule', function () {
      var w = flatWorld(9, B.STONE);
      w.setBlock(5, 10, 5, B.PORTE_FERMEE_N);
      w.setBlock(5, 11, 5, B.PORTE_FERMEE_N);
      var ents = MC.createEntities(w);
      var v = ents.spawn('villager', 5.5, 10, 6.3, { wanderDir: -Math.PI / 2, wanderCd: 999, onGround: true });
      var loin = { pos: { x: 9999, y: 10, z: 9999 }, dead: false };
      ents.stepAI(v, 0.05, loin, Math.random);
      A.equal(w.getBlock(5, 10, 5), B.PORTE_OUVERTE_N, 'l\'habitant a ouvert la porte');
      A.equal(w.getBlock(5, 11, 5), B.PORTE_OUVERTE_N, 'les deux moitiés');
      // on retire l'habitant pour isoler la fermeture automatique du minuteur
      ents.remove(v);
      ents.update(10, loin, {});
      A.equal(w.getBlock(5, 10, 5), B.PORTE_FERMEE_N, 'elle s\'est refermée seule, quelques secondes après');
      A.equal(w.getBlock(5, 11, 5), B.PORTE_FERMEE_N);
    });

    // ── casse ─────────────────────────────────────────────────────────────
    it('SPEC-PORTE-001 : casser une moitié de porte casse l\'autre et rend une porte', function () {
      var g = partie();
      g.w.setBlock(5, 10, 5, B.PORTE_FERMEE_S);
      g.w.setBlock(5, 11, 5, B.PORTE_FERMEE_S);
      var target = { x: 5, y: 10, z: 5, block: B.PORTE_FERMEE_S };
      var res;
      for (var i = 0; i < 200 && !res; i++) res = g.pl.mineTick(0.1, target, function () { return 0.99; });
      A.ok(res && res.broken, 'la porte cède');
      A.equal(g.w.getBlock(5, 10, 5), 0, 'la moitié visée disparaît');
      A.equal(g.w.getBlock(5, 11, 5), 0, 'l\'autre moitié aussi');
      A.equal(res.drops.length, 1, 'une seule porte rendue');
      A.equal(res.drops[0].id, I.PORTE);
      A.equal(res.drops[0].n, 1);
    });
    it('SPEC-PORTE-002 : casser une trappe la fait disparaître et rend une trappe', function () {
      var g = partie();
      g.w.setBlock(5, 10, 5, B.TRAPPE_FERMEE);
      var target = { x: 5, y: 10, z: 5, block: B.TRAPPE_FERMEE };
      var res;
      for (var i = 0; i < 200 && !res; i++) res = g.pl.mineTick(0.1, target, function () { return 0.99; });
      A.ok(res && res.broken);
      A.equal(g.w.getBlock(5, 10, 5), 0);
      A.equal(res.drops.length, 1);
      A.equal(res.drops[0].id, I.TRAPPE);
    });

    // ── bâtiments générés ─────────────────────────────────────────────────
    it('SPEC-PORTE-001 : les bâtiments d\'un village généré ont leur porte, fermée', function () {
      var w = MC.createWorld(20260924);
      var H = MC.Habitats, R = H.LIEUX.village.region;
      var v = null;
      for (var rx = -3; rx < 3 && !v; rx++) for (var rz = -3; rz < 3 && !v; rz++) {
        v = w.habitats.lieuDeRegion('village', rx, rz);
      }
      A.ok(v, 'un village existe près de l\'origine');
      for (var cx = Math.floor((v.x - v.demi) / 16); cx <= Math.floor((v.x + v.demi) / 16); cx++)
        for (var cz = Math.floor((v.z - v.demi) / 16); cz <= Math.floor((v.z + v.demi) / 16); cz++) w.getChunk(cx, cz, true);
      var trouvees = 0;
      v.batiments.forEach(function (bat) {
        if (!bat.porte) return;
        var id = w.getBlock(bat.porte.x, bat.y0, bat.porte.z);
        if (C.PORTE_FERMEE_LIST.indexOf(id) < 0) return;
        trouvees++;
        A.equal(w.getBlock(bat.porte.x, bat.y0 + 1, bat.porte.z), id, 'la porte du ' + bat.type + ' a ses deux moitiés');
      });
      A.gt(trouvees, 0, 'au moins un bâtiment a bien une porte fermée posée');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
