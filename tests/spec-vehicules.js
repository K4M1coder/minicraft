/* spec-vehicules.js — tests des specs SPEC-VEHIC-*, SPEC-RECETTE-*, SPEC-BLOC-*
   et SPEC-MIGR-*. Véhicules, nouvelles recettes, blocs à comportement propre,
   compatibilité des anciennes sauvegardes. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, P = MC.Physics, M = MC.Modes, V = MC.Vehicules, Inv = MC.Inventory;
  var B = C.B, I = C.I;
  var flatWorld = G.flatWorld, seededRand = G.seededRand;

  // piste plate en y = 10, un bassin profond en z < -60
  function circuit() {
    var w = flatWorld(10, B.STONE);
    var base = w.getBlock;
    w.getBlock = function (x, y, z) {
      x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
      var k = x + ',' + y + ',' + z;
      if (w.map.has(k)) return w.map.get(k);
      if (z < -60 && y > 2 && y <= 20) return B.WATER;
      return base.call(w, x, y, z);
    };
    return w;
  }
  function rouler(e, w, cmd, secondes) {
    for (var i = 0; i < secondes * 30; i++) V.conduire(e, 1 / 30, w, typeof cmd === 'function' ? cmd(i) : cmd);
  }

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — vehicules', function () {

    it('SPEC-VEHIC-001 : sept vehicules, chacun fabricable et pose depuis son objet', function () {
      A.equal(V.TYPES.length, 7);
      ['bateau', 'moto', 'voiture', 'camion', 'avion', 'sous_marin', 'wagonnet'].forEach(function (t) {
        var d = V.DEFS[t];
        A.ok(d && d.nom && d.vmax > 0, t + ' défini');
        A.equal(C.ITEMS[d.objet].vehicule, t, t + ' : son objet le désigne');
        A.ok(Inv.RECIPES.some(function (r) { return r.out === d.objet; }), t + ' : une recette');
        A.ok(MC.EntitySpecs[V.typeEntite(t)], t + ' : un gabarit d entité');
      });
      A.ok(V.gabarits()[V.typeEntite('camion')].drops[0].id === I.CAMION, 'détruit, il rend son objet');
      var w = flatWorld(10, B.STONE), ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents, M.regles('survie', 'facile'));
      pl.state.inv.add(I.VOITURE, 1);
      pl.state.selected = pl.state.inv.slots.findIndex(function (s) { return s && s.id === I.VOITURE; });
      A.equal(pl.useOn({ x: 0, y: 10, z: 0, nx: 0, ny: 1, nz: 0 }), 'vehicule:voiture',
              'utiliser l objet demande au jeu de poser la voiture');
    });

    it('SPEC-VEHIC-002 : la voiture accelere, braque et franchit une marche', function () {
      var w = circuit(), ents = MC.createEntities(w);
      for (var x = -4; x <= 4; x++) for (var z = -20; z >= -30; z--) w.setBlock(x, 11, z, B.STONE);
      var e = V.poser(ents, 'voiture', 0.5, 11, 0.5, 0);
      rouler(e, w, { avant: 1 }, 3);
      A.ok(e.pos.z < -20, 'elle a roulé (z = ' + e.pos.z.toFixed(1) + ')');
      A.ok(e.pos.y >= 11.9, 'et elle est montée sur la marche');
      A.ok(V.vitesseKmh(e) > 30, 'à bonne allure (' + V.vitesseKmh(e) + ' km/h)');
      var yaw0 = e.yaw;
      rouler(e, w, { avant: 1, gauche: 1 }, 0.5);
      A.ok(e.yaw > yaw0 + 0.3, 'elle tourne à gauche');
      A.notOk(P.collides(w, e.pos.x, e.pos.y, e.pos.z, e.w, e.h), 'sans jamais entrer dans le décor');
    });

    it('SPEC-VEHIC-003 : le bateau flotte et file sur l eau, se traine a terre', function () {
      var w = circuit(), ents = MC.createEntities(w);
      var b = V.poser(ents, 'bateau', 0.5, 14, -80.5, 0);
      rouler(b, w, { avant: 1 }, 3);
      A.ok(Math.abs(b.pos.y - (21 - 0.3)) < 0.4, 'à la surface (y = ' + b.pos.y.toFixed(2) + ')');
      A.equal(V.milieuDe(w, b, V.DEFS.bateau), 'eau');
      A.ok(V.vitesseKmh(b) > 20, 'rapide sur l eau');
      A.ok(V.surfaceEau(w, b) === 21, 'la surface est bien trouvée');
      var t = V.poser(ents, 'bateau', 0.5, 11, 0.5, 0);
      rouler(t, w, { avant: 1 }, 2);
      A.ok(V.vitesseKmh(t) < 5, 'échoué, il n avance presque plus');
      A.ok(V.vmaxDans(V.DEFS.bateau, 'sol') < V.vmaxDans(V.DEFS.bateau, 'eau') / 4);
    });

    it('SPEC-VEHIC-004 : l avion ne decolle qu au-dela de sa vitesse de decollage', function () {
      var w = circuit(), ents = MC.createEntities(w);
      var a = V.poser(ents, 'avion', 0.5, 11, 0.5, 0);
      rouler(a, w, { avant: 1, monter: 1 }, 1);
      A.ok(a.pos.y < 11.2, 'trop lent : il reste au sol');
      rouler(a, w, { avant: 1, monter: 1 }, 5);
      A.ok(a.pos.y > 20, 'lancé : il vole (y = ' + a.pos.y.toFixed(1) + ')');
      var haut = a.pos.y;
      rouler(a, w, {}, 6);
      A.ok(a.pos.y < haut - 3, 'moteur coupé, il perd de l altitude');
    });

    it('SPEC-VEHIC-005 : le sous-marin plonge, remonte, et l on y respire', function () {
      var w = circuit(), ents = MC.createEntities(w);
      var s = V.poser(ents, 'sous_marin', 0.5, 16, -80.5, 0);
      rouler(s, w, { avant: 1, descendre: 1 }, 2);
      A.ok(s.pos.y < 12, 'il plonge (y = ' + s.pos.y.toFixed(1) + ')');
      var bas = s.pos.y;
      rouler(s, w, { monter: 1 }, 2);
      A.ok(s.pos.y > bas + 3, 'il remonte');
      A.ok(s.pos.y < 21, 'sans crever la surface');
      A.ok(V.DEFS.sous_marin.respire, 'cabine étanche');
    });

    it('SPEC-VEHIC-006 : monter, rester sur son siege, descendre a cote', function () {
      var w = circuit(), ents = MC.createEntities(w);
      var e = V.poser(ents, 'moto', 0.5, 11, 0.5, 0);
      var j = { pos: { x: 3, y: 11, z: 3 }, vel: { x: 0, y: 0, z: 0 } };
      A.ok(V.monter(j, e), 'on monte');
      A.equal(e.conducteur, j);
      A.notOk(V.monter({ pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 } }, e), 'une seule place');
      rouler(e, w, { avant: 1 }, 1);
      V.caler(j);
      var s = V.siege(e);
      A.ok(Math.abs(j.pos.x - s.x) < 1e-9 && Math.abs(j.pos.z - s.z) < 1e-9, 'le conducteur suit l engin');
      A.ok(V.descendre(j, w, 0.6, 1.8), 'on descend');
      A.equal(j.monture, null);
      A.equal(e.conducteur, null, 'la moto est libre');
      A.notOk(P.collides(w, j.pos.x, j.pos.y, j.pos.z, 0.6, 1.8), 'à côté, pas dedans');
      A.ok(Math.hypot(j.pos.x - e.pos.x, j.pos.z - e.pos.z) > 0.5, 'hors de l engin');
    });

    it('SPEC-VEHIC-007 : le camion a une soute', function () {
      var ents = MC.createEntities(flatWorld(10, B.STONE));
      var c = V.poser(ents, 'camion', 0.5, 11, 0.5, 0);
      A.ok(c.soute && c.soute.slots.length === 27, '27 cases');
      A.notOk(V.poser(ents, 'voiture', 0.5, 11, 5.5, 0).soute, 'la voiture n en a pas');
    });

    it('SPEC-VEHIC-008 : les vehicules et leur chargement survivent a la sauvegarde', function () {
      var e = G.etatMinimal(1234);
      var c = V.poser(e.entities, 'camion', 3.5, 40, 2.5, 1.2);
      c.soute.add(I.DIAMOND, 5);
      V.poser(e.entities, 'bateau', -3.5, 40, 2.5, 0);
      var data = JSON.parse(JSON.stringify(MC.Save.serialize(e)));
      A.equal(data.vehicules.length, 2, 'deux véhicules sérialisés');
      var f = G.etatMinimal(1234);
      A.ok(MC.Save.apply(data, f), 'chargement');
      var vs = f.entities.list.filter(function (x) { return x.vehicule; });
      A.equal(vs.length, 2, 'deux véhicules restaurés');
      var cam = vs.filter(function (x) { return x.vehicule === 'camion'; })[0];
      A.ok(Math.abs(cam.yaw - 1.2) < 1e-3, 'avec leur orientation');
      A.equal(cam.soute.count(I.DIAMOND), 5, 'et le chargement du camion');
      A.equal(V.restaurer(f.entities, V.serialiser(f.entities)), 2, 'serialiser / restaurer sont réciproques');
    });

    it('SPEC-VEHIC-009 : un vehicule abandonne ralentit et retombe', function () {
      var w = circuit(), ents = MC.createEntities(w);
      var e = V.poser(ents, 'voiture', 0.5, 14, 0.5, 0);
      e.vitesse = 10;
      for (var i = 0; i < 90; i++) ents.update(1 / 30, { pos: { x: 90, y: 11, z: 90 } });
      A.ok(Math.abs(e.vitesse) < 1, 'il s arrête de lui-même');
      A.ok(e.pos.y < 11.1, 'posé au sol');
      var j = { pos: { x: 0, y: 11, z: 0 }, vel: { x: 0, y: 0, z: 0 } };
      V.monter(j, e);
      var avant = e.pos.x;
      e.vitesse = 5;
      ents.update(1 / 30, { pos: { x: 90, y: 11, z: 90 } });
      A.equal(e.pos.x, avant, 'conduit, c est le jeu qui le pilote, pas la boucle des créatures');
    });

    it('SPEC-VEHIC-010 : detruit, un vehicule rend son objet et ne recule pas sous les coups', function () {
      var ents = MC.createEntities(flatWorld(10, B.STONE));
      var e = V.poser(ents, 'moto', 0.5, 11, 0.5, 0);
      ents.damage(e, 1, { x: -2, y: 11, z: 0.5 });
      A.equal(e.vel.x, 0, 'pas de recul');
      e.hurtCd = 0;
      ents.damage(e, 99);
      A.ok(ents.list.some(function (x) { return x.type === 'item' && x.item === I.MOTO; }), 'la moto redevient objet');
      A.equal(V.defDe(e).nom, 'Moto');
    });

    it('SPEC-TRANSPORT-001 : a sec, un vehicule s arrete et redevient comme abandonne', function () {
      var w = flatWorld(10, B.STONE), ents = MC.createEntities(w);
      var e = V.poser(ents, 'voiture', 0.5, 11, 0.5, 0);
      var plein = V.DEFS.voiture.carburant;
      A.ok(plein > 0, 'jauge de carburant définie pour la voiture');
      A.equal(e.carburant, plein, 'plein au départ');

      rouler(e, w, { avant: 1 }, 1);
      A.ok(e.carburant < plein, 'la jauge descend en roulant (reste ' + e.carburant.toFixed(1) + ')');
      A.ok(e.carburant > 0, 'pas encore a sec');

      // on continue de rouler jusqu'à vider complètement le réservoir
      rouler(e, w, { avant: 1 }, 15);
      A.equal(e.carburant, 0, 'a sec');

      // pied au plancher malgré tout : plus aucun effet sur la vitesse,
      // exactement comme un véhicule abandonné (VEHIC-009)
      rouler(e, w, { avant: 1 }, 3);
      A.ok(Math.abs(e.vitesse) < 1, 'il s arrete de lui-meme (v=' + e.vitesse.toFixed(2) + ')');
      A.ok(e.pos.y < 11.1, 'et reste pose au sol, comme un vehicule abandonne');

      // la même mécanique s'applique à `rouler()` (wagonnet sur rail)
      var w2 = flatWorld(10, B.STONE);
      for (var z = 0; z >= -60; z--) w2.setBlock(0, 11, z, B.RAIL);
      var ents2 = MC.createEntities(w2);
      var wg = V.poser(ents2, 'wagonnet', 0.5, 11, 0.5, 0);
      var pleinWg = V.DEFS.wagonnet.carburant;
      A.equal(wg.carburant, pleinWg, 'le wagonnet part le plein fait');
      for (var i = 0; i < 15 * 30; i++) V.rouler(wg, 1 / 30, w2, { avant: 1 }, V.DEFS.wagonnet);
      A.equal(wg.carburant, 0, 'le wagonnet aussi tombe a sec en roulant');
      A.ok(Math.abs(wg.vitesse) < 1, 'et s arrete, moteur coupe (v=' + wg.vitesse.toFixed(2) + ')');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — recettes', function () {
    function grille(r) {
      if (r.type === 'shapeless') return { g: r.ingredients.concat([0, 0, 0, 0, 0, 0, 0, 0, 0]).slice(0, 9), w: 3, h: 3 };
      var g = [];
      r.pattern.forEach(function (l) { for (var i = 0; i < l.length; i++) g.push(l[i] === ' ' ? 0 : r.keys[l[i]]); });
      return { g: g, w: r.w, h: r.h };
    }

    it('SPEC-RECETTE-001 : chaque recette donne sa propre sortie, sans conflit de motif', function () {
      A.ok(Inv.RECIPES.length >= 75, 'au moins 75 recettes (' + Inv.RECIPES.length + ')');
      Inv.RECIPES.forEach(function (r) {
        var x = grille(r), m = Inv.matchRecipe(x.g, x.w, x.h);
        A.ok(m && m.id === r.out, C.nameOf(r.out) + ' : le motif est reconnu');
      });
    });

    it('SPEC-RECETTE-002 : une gamme complete d outils en diamant', function () {
      [I.DIAMOND_PICKAXE, I.DIAMOND_AXE, I.DIAMOND_SHOVEL, I.DIAMOND_SWORD].forEach(function (id) {
        var d = C.ITEMS[id];
        A.equal(d.tier, 4, d.name + ' : rang 4');
        A.ok(Inv.RECIPES.some(function (r) { return r.out === id; }), d.name + ' : fabricable');
      });
      A.ok(C.breakTime(B.STONE, I.DIAMOND_PICKAXE).seconds < C.breakTime(B.STONE, I.IRON_PICKAXE).seconds,
           'la pioche en diamant va plus vite que celle en fer');
      A.ok(C.breakTime(B.OBSIDIAN, I.DIAMOND_PICKAXE).harvests, 'elle seule récolte l obsidienne');
      A.notOk(C.breakTime(B.OBSIDIAN, I.IRON_PICKAXE).harvests);
    });

    it('SPEC-RECETTE-003 : la soupe rend son bol, la pomme doree soigne', function () {
      var w = flatWorld(10, B.STONE), ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents, M.regles('survie', 'facile'));
      var s = pl.state;
      s.hunger = 10;
      s.inv.slots[0] = { id: I.MUSHROOM_STEW, n: 1 }; s.selected = 0;
      A.equal(pl.useOn({ x: 0, y: 10, z: 0, nx: 0, ny: 1, nz: 0 }), 'eat');
      A.equal(s.inv.count(I.BOWL), 1, 'le bol revient');
      s.hunger = 20; s.hp = 5;
      s.inv.slots[0] = { id: I.GOLDEN_APPLE, n: 1 };
      A.equal(pl.useOn({ x: 0, y: 10, z: 0, nx: 0, ny: 1, nz: 0 }), 'eat', 'rassasié, on la mange quand même');
      A.ok(s.hp >= 15, 'et elle soigne (' + s.hp + ' PV)');
    });

    it('SPEC-RECETTE-004 : la poudre d os fait murir les cultures', function () {
      var w = flatWorld(10, B.FARMLAND), ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents, M.regles('survie', 'facile'));
      w.setBlock(0, 11, 0, B.WHEAT0);
      pl.state.inv.slots[0] = { id: I.BONE_MEAL, n: 2 }; pl.state.selected = 0;
      A.equal(pl.useOn({ x: 0, y: 11, z: 0, nx: 0, ny: 1, nz: 0 }), 'grow');
      A.equal(w.getBlock(0, 11, 0), B.WHEAT3, 'blé mûr d un coup');
      A.equal(pl.state.inv.count(I.BONE_MEAL), 1, 'une dose consommée');
      A.equal(Inv.matchRecipe([I.BONE], 1, 1).id, I.BONE_MEAL, 'les os se broient en poudre');
    });

    it('SPEC-RECETTE-005 : le four cuit poisson et volaille, fond l or', function () {
      A.equal(Inv.smeltResult(I.RAW_FISH), I.COOKED_FISH);
      A.equal(Inv.smeltResult(I.RAW_CHICKEN), I.COOKED_CHICKEN);
      A.equal(Inv.smeltResult(B.GOLD_ORE), I.GOLD_INGOT);
      A.equal(Inv.smeltResult(B.CLAY), B.TERRACOTTA);
      A.equal(Inv.smeltResult(B.CACTUS), I.DYE_GREEN);
      A.ok(Inv.fuelValue(B.JUNGLE_LOG) > 0, 'tous les bois brûlent');
    });

    it('SPEC-RECETTE-006 : on teint la laine et la terre cuite', function () {
      var r = Inv.matchRecipe([B.WOOL, I.DYE_BLUE, 0, 0], 2, 2);
      A.ok(r && r.id === B.WOOL_BLUE, 'laine bleue');
      A.equal(Inv.matchRecipe([B.FLOWER_RED], 1, 1).id, I.DYE_RED, 'le coquelicot donne du rouge');
      var t = Inv.matchRecipe([B.TERRACOTTA, I.DYE_YELLOW, 0, 0], 2, 2);
      A.ok(t && t.id === B.TERRACOTTA_YELLOW, 'terre cuite ocre');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — blocs a comportement propre', function () {
    function joueur(w) {
      var pl = MC.createPlayer(w, MC.createEntities(w), M.regles('survie', 'facile'));
      pl.state.pos = { x: 0.5, y: 11, z: 0.5 };
      pl.state.onGround = true;
      return pl;
    }
    var TOUCHES = { forward: 0, back: 0, left: 0, right: 0, jump: 0, sprint: 0 };

    it('SPEC-BLOC-001 : on grimpe aux echelles et aux lianes', function () {
      [B.LADDER, B.VINES].forEach(function (id) {
        var w = flatWorld(10, B.STONE);
        // adossée à un mur, comme toujours : on avance CONTRE la paroi
        for (var y = 11; y <= 20; y++) { w.setBlock(0, y, 0, id); w.setBlock(0, y, -1, B.STONE); }
        var pl = joueur(w);
        for (var i = 0; i < 30; i++) pl.updateMovement(1 / 30, Object.assign({}, TOUCHES, { forward: 1 }));
        A.ok(pl.state.pos.y > 12.5, C.nameOf(id) + ' : on monte (y = ' + pl.state.pos.y.toFixed(1) + ')');
        A.ok(P.occupeAvec(w, 0.5, 12, 0.5, 0.6, 1.8, 'grimpable'), 'le bloc est grimpable');
      });
    });

    it('SPEC-BLOC-002 : une toile d araignee englue', function () {
      var w1 = flatWorld(10, B.STONE), w2 = flatWorld(10, B.STONE);
      for (var x = -1; x <= 12; x++) { w2.setBlock(x, 11, 0, B.COBWEB); w2.setBlock(x, 12, 0, B.COBWEB); }
      var libre = joueur(w1), pris = joueur(w2);
      libre.state.yaw = pris.state.yaw = -Math.PI / 2;           // vers +x
      for (var i = 0; i < 60; i++) {
        libre.updateMovement(1 / 30, Object.assign({}, TOUCHES, { forward: 1 }));
        pris.updateMovement(1 / 30, Object.assign({}, TOUCHES, { forward: 1 }));
      }
      A.ok(pris.state.pos.x - 0.5 < (libre.state.pos.x - 0.5) * 0.5, 'on avance bien moins vite dans la toile');
      A.equal(P.occupeAvec(w1, 0.5, 11, 0.5, 0.6, 1.8, 'ralentit'), null, 'hors toile : rien');
    });

    it('SPEC-BLOC-003 : les rails se posent a plat', function () {
      var chunk = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      chunk.blocks[C.idx(3, 5, 3)] = B.RAIL;
      var raw = MC.Mesher.buildChunk(chunk, 'cutout', function () { return 0; });
      A.equal(raw.positions.length, 12, 'un seul quad');
      for (var i = 1; i < raw.positions.length; i += 3) A.ok(Math.abs(raw.positions[i] - 5.02) < 1e-6, 'posé au sol');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — compatibilite des sauvegardes', function () {
    it('SPEC-MIGR-001 : une sauvegarde d avant les biomes se charge, objets convertis', function () {
      var dec = C.DECALAGE_OBJETS_V1;
      A.equal(dec, 64);
      // encodage v1 : objets a partir de 64, dans l'espace 8 bits d'alors —
      // il faut donc défaire les DEUX décalages qui séparent ce format de
      // l'id courant (128→FIRST_ITEM, SPEC-SAVE-017, puis 64→128).
      var offAncien = C.FIRST_ITEM - C.ANCIEN_FIRST_ITEM;
      function versV1(id) { return id - offAncien - dec; }
      var v1 = { v: 1, seed: 5, time: 10, overrides: [[0, 20, 0, B.STONE]], crops: [],
                 player: { x: 1, y: 30, z: 1, inv: [[versV1(I.IRON_PICKAXE), 1, 7], [B.PLANKS, 12]] },
                 chests: [['1,2,3', [[versV1(I.EMERALD), 3]]]],
                 furnaces: [['4,5,6', [B.IRON_ORE, 2], [versV1(I.COAL), 4], 0, 0, 0]] };
      var e = G.etatMinimal(5);
      A.ok(MC.Save.apply(v1, e), 'la version 1 est acceptée');
      A.equal(e.player.state.inv.slots[0].id, I.IRON_PICKAXE, 'la pioche retrouve son identité');
      A.equal(e.player.state.inv.slots[0].dmg, 7, 'et son usure');
      A.equal(e.player.state.inv.slots[1].id, B.PLANKS, 'un bloc ne bouge pas');
      A.equal(e.chests['1,2,3'].slots[0].id, I.EMERALD, 'coffre converti');
      A.equal(e.furnaces['4,5,6'].fuel.id, I.COAL, 'fourneau converti');
      A.equal(e.world.overrides.get('0,20,0'), B.STONE, 'les blocs posés restent');
      A.equal(v1.player.inv[0][0], versV1(I.IRON_PICKAXE), 'la donnée d origine n est pas modifiée');
      A.equal(MC.Save.migrerV2(MC.Save.migrerV1(JSON.parse(JSON.stringify(v1)))).v, MC.Save.VERSION);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
