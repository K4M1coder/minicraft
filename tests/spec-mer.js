/* spec-mer.js — tests des specs SPEC-MER-*, SPEC-FAUNE-* et SPEC-EQUIP-*.
   Océans et leur flore, faune marine, oiseaux, créatures armées. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, P = MC.Physics, M = MC.Modes, F = MC.Faune;
  var B = C.B, I = C.I, SEA = C.SEA_LEVEL;
  var seededRand = G.seededRand;

  /* Monde factice : roche jusqu'à `fond`, eau jusqu'à `surface`, air au-dessus.
     Une Map permet d'y poser des blocs (murs, plantes). */
  function mondeAquatique(fond, surface) {
    var m = new Map();
    fond = fond === undefined ? 5 : fond;
    surface = surface === undefined ? 20 : surface;
    return {
      map: m,
      getBlock: function (x, y, z) {
        x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
        if (y < 0 || y >= C.WORLD_H) return 0;
        var k = x + ',' + y + ',' + z;
        if (m.has(k)) return m.get(k);
        if (y <= fond) return B.STONE;
        return y <= surface ? B.WATER : 0;
      },
      setBlock: function (x, y, z, b) { m.set(Math.floor(x) + ',' + Math.floor(y) + ',' + Math.floor(z), b); return true; },
      groundAt: function () { return fond; },
    };
  }
  function mondeSec(sol) { return mondeAquatique(sol === undefined ? 10 : sol, -1); }

  var mondes = {};
  function monde(g) { g = g || 20260921; if (!mondes[g]) mondes[g] = MC.createWorld(g); return mondes[g]; }

  // première colonne (sur une grille) satisfaisant `pred(x, z, echantillon)`
  function chercher(w, pred) {
    var Bi = MC.Biomes.creer(w.noise);
    for (var r = 0; r < 3000; r += 23) for (var a = 0; a < 24; a++) {
      var x = Math.round(Math.cos(a / 24 * 6.283) * r), z = Math.round(Math.sin(a / 24 * 6.283) * r);
      if (pred(x, z, Bi.echantillon(x, z))) return [x, z];
    }
    return null;
  }
  function compter(c, pred) { var n = 0; for (var i = 0; i < c.blocks.length; i++) if (pred(c.blocks[i])) n++; return n; }

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — mer et flore marine', function () {

    it('SPEC-MER-001 : le varech pousse en colonne, sans jamais crever la surface', function () {
      var w = monde();
      var p = chercher(w, function (x, z, e) { return e.biome.id === 'foret_varech' && e.h < SEA - 5; });
      A.ok(p, 'une forêt de varech existe');
      var c = w.getChunk(Math.floor(p[0] / 16), Math.floor(p[1] / 16), true);
      var n = 0, mal = 0;
      for (var x = 0; x < 16; x++) for (var z = 0; z < 16; z++) for (var y = 1; y < C.WORLD_H; y++) {
        if (c.blocks[C.idx(x, y, z)] !== B.KELP) continue;
        n++;
        if (y >= SEA) mal++;
      }
      A.ok(n > 10, 'du varech en quantité (' + n + ')');
      A.equal(mal, 0, 'toujours sous la surface');
    });

    it('SPEC-MER-002 : le recif corallien se couvre de coraux et de gorgones', function () {
      var w = monde();
      var p = chercher(w, function (x, z, e) { return e.biome.id === 'ocean_chaud' && e.h < SEA - 3; });
      A.ok(p, 'un récif existe');
      var coraux = 0;
      for (var k = 0; k < 4 && coraux === 0; k++) {
        var c = w.getChunk(Math.floor(p[0] / 16) + k, Math.floor(p[1] / 16), true);
        coraux += compter(c, function (b) {
          return b === B.CORAL_RED || b === B.CORAL_YELLOW || b === B.CORAL_BLUE;
        });
      }
      A.ok(coraux > 0, 'des massifs de corail (' + coraux + ')');
      [B.CORAL_FAN_RED, B.CORAL_FAN_YELLOW, B.CORAL_FAN_BLUE, B.SEAGRASS, B.SEA_PICKLE].forEach(function (id) {
        A.ok(C.BLOCKS[id].aquatique, C.nameOf(id) + ' est une plante marine');
      });
      A.ok(C.lightOf(B.SEA_PICKLE) > 0, 'le cornichon de mer éclaire');
    });

    it('SPEC-MER-003 : une plante marine compte comme de l eau', function () {
      A.ok(C.isWater(B.WATER) && C.isWater(B.KELP) && C.isWater(B.SEAGRASS), 'eau et plantes marines');
      A.notOk(C.isWater(B.STONE) || C.isWater(0), 'ni la pierre ni l air');
      A.ok(C.occludes(B.WATER, B.KELP), 'pas de surface d eau dessinée contre le varech');
      var w = mondeSec(10);
      w.setBlock(0, 12, 0, B.KELP);
      A.ok(P.inWater(w, { x: 0.5, y: 11, z: 0.5 }, 1.8), 'on nage dans le varech');
      A.ok(P.headInWater(w, { x: 0.5, y: 11, z: 0.5 }, 1.0), 'et l on s y noie');
    });

    it('SPEC-MER-004 : l ocean gele a ses icebergs', function () {
      var w = monde(), trouve = 0;
      var p = chercher(w, function (x, z, e) {
        return e.biome.icebergs && w.noise.fbm((x + 77) / 14, (z - 31) / 14, 2, 2, 0.5) > 0.7;
      });
      A.ok(p, 'un iceberg est prévu quelque part');
      w.getChunk(Math.floor(p[0] / 16), Math.floor(p[1] / 16), true);
      for (var y = SEA + 1; y < SEA + 9; y++) if (w.getBlock(p[0], y, p[1]) === B.PACKED_ICE) trouve++;
      A.ok(trouve > 0, 'de la glace compacte émerge de l eau');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — faune marine', function () {

    it('SPEC-MER-005 : un poisson reste dans l eau', function () {
      var w = mondeAquatique(5, 20), ents = MC.createEntities(w);
      var f = ents.spawn('fish', 0.5, 12, 0.5);
      var dehors = 0;
      for (var i = 0; i < 600; i++) {
        ents.update(1 / 30, { pos: { x: 50, y: 30, z: 50 } }, { rand: seededRand(i) });
        if (!C.isWater(w.getBlock(f.pos.x, f.pos.y + f.h / 2, f.pos.z))) dehors++;
      }
      A.equal(dehors, 0, '20 s dans l eau, sans en sortir');
      A.ok(Math.hypot(f.pos.x - 0.5, f.pos.z - 0.5) > 1, 'et il a nagé');
    });

    it('SPEC-MER-005 : hors de l eau, il s asphyxie', function () {
      var w = mondeSec(10), ents = MC.createEntities(w);
      var f = ents.spawn('fish', 0.5, 11, 0.5);
      var hp = f.hp;
      for (var i = 0; i < 30 * (F.ASPHYXIE_DELAI + 3); i++) ents.update(1 / 30, { pos: { x: 50, y: 11, z: 50 } });
      A.ok(f.dead || f.hp < hp, 'il perd de la vie');
    });

    it('SPEC-MER-006 : le requin ne chasse que dans l eau', function () {
      var w = mondeAquatique(5, 20), ents = MC.createEntities(w);
      var r = ents.spawn('shark', 0.5, 12, 0.5);
      var nageur = { pos: { x: 10.5, y: 11, z: 0.5 }, dead: false };
      var d0 = Math.hypot(nageur.pos.x - r.pos.x, nageur.pos.y - r.pos.y);
      for (var i = 0; i < 45; i++) ents.update(1 / 30, nageur, { rand: seededRand(i) });
      A.ok(Math.hypot(nageur.pos.x - r.pos.x, nageur.pos.y - r.pos.y) < d0 - 2, 'il fonce sur le nageur');
      // même scène, cible au sec sur un ponton hors de l'eau
      var w2 = mondeAquatique(5, 20), e2 = MC.createEntities(w2);
      for (var x = 8; x <= 12; x++) for (var z = -2; z <= 2; z++) w2.setBlock(x, 21, z, B.PLANKS);
      var r2 = e2.spawn('shark', 0.5, 12, 0.5);
      var r2x = r2.pos.x;
      var aSec = { pos: { x: 10.5, y: 22, z: 0.5 }, dead: false };
      for (var j = 0; j < 45; j++) e2.update(1 / 30, aSec, { rand: seededRand(j) });
      A.ok(Math.abs(r2.pos.x - r2x) < 4, 'pas de poursuite de qui reste au sec');
    });

    it('SPEC-MER-007 : la meduse pique qui la frole', function () {
      var w = mondeAquatique(5, 20), ents = MC.createEntities(w);
      ents.spawn('jellyfish', 0.5, 12, 0.5);
      var ev = ents.update(1 / 30, { pos: { x: 0.5, y: 11.5, z: 0.5 }, dead: false }, { rand: seededRand(1) });
      A.ok(ev.damage >= MC.EntitySpecs.jellyfish.pique, 'une piqûre');
    });

    it('SPEC-MER-008 : le noye coule, marche au fond, et remonte vers sa proie', function () {
      var w = mondeAquatique(5, 20), ents = MC.createEntities(w);
      var n = ents.spawn('drowned', 0.5, 15, 0.5);
      for (var i = 0; i < 150; i++) ents.update(1 / 30, { pos: { x: 60, y: 30, z: 60 }, dead: false });
      A.ok(n.pos.y < 7, 'il a coulé jusqu au fond (y = ' + n.pos.y.toFixed(1) + ')');
      var ctx = { world: w, cible: { pos: { x: 3, y: 15, z: 0.5 }, dead: false }, agressif: true };
      F.lester(n, MC.EntitySpecs.drowned, 0.2, ctx);
      A.ok(n.vel.y > 0, 'une proie au-dessus : il remonte');
    });

    it('SPEC-MER-009 : cinq biomes marins, et une colonne immergee est marine', function () {
      A.equal(MC.Biomes.MARINS.length, 5);
      MC.Biomes.MARINS.forEach(function (id) {
        var b = MC.Biomes.LISTE[id];
        A.ok(b.marin && b.fond && Object.keys(b.mobsEau).length > 0, id + ' : fond et faune');
      });
      var Bi = MC.Biomes.creer(MC.makeNoise(42));
      var c = Bi.climat(100, 100);
      A.ok(MC.Biomes.LISTE[Bi.classer(c, SEA - 12)].marin, 'profond : marin');
      A.notOk(MC.Biomes.LISTE[Bi.classer(c, SEA + 5)].marin, 'émergé : terrestre');
      A.equal(MC.Biomes.PROF_MARINE, 2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — oiseaux et apparitions par milieu', function () {

    it('SPEC-FAUNE-001 : un oiseau vole au-dessus du relief, sans le toucher', function () {
      var w = mondeSec(10), ents = MC.createEntities(w);
      var o = ents.spawn('bird', 0.5, 16, 0.5);
      var bas = 99, haut = 0, bloque = 0;
      for (var i = 0; i < 900; i++) {
        ents.update(1 / 30, { pos: { x: 90, y: 11, z: 90 } }, { rand: seededRand(i) });
        bas = Math.min(bas, o.pos.y); haut = Math.max(haut, o.pos.y);
        if (P.collides(w, o.pos.x, o.pos.y, o.pos.z, o.w, o.h)) bloque++;
      }
      A.ok(bas > 11.5, 'jamais posé au sol (plus bas : ' + bas.toFixed(1) + ')');
      A.ok(haut < 40, 'ni perdu dans les nuages');
      A.equal(bloque, 0, 'aucune collision');
      A.ok(Math.hypot(o.pos.x, o.pos.z) > 5, 'il s est déplacé');
    });

    it('SPEC-FAUNE-002 : devant un mur, l oiseau prend de la hauteur', function () {
      var w = mondeSec(10);
      for (var y = 11; y <= 22; y++) for (var z = -6; z <= 6; z++) w.setBlock(2, y, z, B.STONE);
      var o = { pos: { x: 0.5, y: 14, z: 0.5 }, vel: { x: 0, y: 0, z: 0 }, w: 0.35, h: 0.35, cap: 0, capCd: 99, age: 0 };
      F.volerVers(o, MC.EntitySpecs.bird, 1 / 30, { world: w, rand: seededRand(3) });
      A.ok(o.vel.y > 0, 'il monte');
      F.nouveauCap(o, seededRand(5), 0);
      A.ok(o.capCd >= 2, 'un nouveau cap tiré, pour quelques secondes');
    });

    it('SPEC-FAUNE-003 : chaque creature nait dans son milieu @lent', function () {
      var w = monde(42);
      var p = chercher(w, function (x, z, e) {
        return e.h > SEA + 3 && !e.biome.marin && w.biomeAt(x + 26, z).marin && w.heightAt(x + 26, z) < SEA - 6;
      });
      A.ok(p, 'une côte');
      var cx = Math.floor(p[0] / 16), cz = Math.floor(p[1] / 16);
      for (var a = -3; a <= 3; a++) for (var b = -3; b <= 3; b++) w.getChunk(cx + a, cz + b, true);
      var ents = MC.createEntities(w);
      var joueur = { pos: { x: p[0] + 0.5, y: w.groundAt(p[0], p[1], true) + 1, z: p[1] + 0.5 } };
      var lim = M.plafondsEntites(M.regles('survie', 'facile'));
      var r = seededRand(9);
      for (var i = 0; i < 1500; i++) ents.trySpawn(joueur, i % 2 === 0, r, lim);
      var marins = 0, oiseaux = 0;
      ents.list.forEach(function (e) {
        var s = MC.EntitySpecs[e.type];
        if (s.nageur) {
          marins++;
          A.ok(C.isWater(w.getBlock(e.pos.x, e.pos.y + e.h / 2, e.pos.z)), e.type + ' né dans l eau');
        }
        if (s.volant) {
          oiseaux++;
          A.ok(e.pos.y > w.groundAt(Math.floor(e.pos.x), Math.floor(e.pos.z)) + 2, e.type + ' né en l air');
        }
      });
      A.ok(marins > 0, 'la mer se peuple (' + marins + ')');
      A.ok(oiseaux > 0, 'le ciel aussi (' + oiseaux + ')');
    });

    it('SPEC-FAUNE-004 : poissons et oiseaux ont leurs propres plafonds', function () {
      var w = mondeAquatique(5, 20), ents = MC.createEntities(w);
      var lim = { marins: 3, oiseaux: 2 };
      for (var i = 0; i < 3; i++) ents.spawn('fish', i + 0.5, 12, 0.5);
      A.notOk(ents.sousPlafond('squid', MC.EntitySpecs.squid, lim), 'la mer est pleine');
      A.ok(ents.sousPlafond('bird', MC.EntitySpecs.bird, lim), 'mais pas le ciel');
      A.ok(ents.sousPlafond('pig', MC.EntitySpecs.pig, lim), 'ni la terre ferme');
    });

    it('SPEC-FAUNE-005 : la wyverne tourne au-dessus de sa proie puis pique', function () {
      var w = mondeSec(10);
      var s = MC.EntitySpecs.boss_wyverne;
      var wy = { pos: { x: 0.5, y: 25, z: 0.5 }, vel: { x: 0, y: 0, z: 0 }, w: s.w, h: s.h, age: 0, eid: 1 };
      var cible = { pos: { x: 3, y: 11, z: 0.5 }, dead: false };
      wy.piqueCd = -0.1;                                // en plein piqué
      F.volerVers(wy, s, 0.5, { world: w, cible: cible, agressif: true, rand: seededRand(2) });
      A.ok(wy.vel.y < -1, 'elle plonge sur sa proie');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — creatures armees', function () {
    var E = function () { return MC.createEntities(G.flatWorld(10, B.STONE)); };

    it('SPEC-EQUIP-001 : certaines creatures naissent armees', function () {
      var ents = E();
      A.equal(ents.tirerArme('zombie', function () { return 0; }), I.STONE_SWORD, 'tirage bas : une épée');
      A.equal(ents.tirerArme('zombie', function () { return 0.99; }), 0, 'tirage haut : mains nues');
      A.equal(ents.tirerArme('pillager', Math.random), I.ARBALETE, 'le pillard a toujours son arbalète');
      A.equal(ents.spawn('vindicator', 0.5, 11, 0.5).arme, I.IRON_AXE, 'le vindicateur, sa hache');
    });

    it('SPEC-EQUIP-002 : une arme augmente les degats', function () {
      var ents = E(), z = MC.EntitySpecs.zombie;
      A.ok(ents.degatsAvecArme(z, I.IRON_SWORD) > z.damage, 'l épée ajoute des dégâts');
      A.equal(ents.degatsAvecArme(z, 0), z.damage, 'mains nues : dégâts de base');
      var s = E();
      var zo = s.spawn('zombie', 0.5, 11, 0.5, { arme: I.IRON_SWORD });
      zo.onGround = true;
      var a = s.stepAI(zo, 1 / 30, { pos: { x: 1.2, y: 11, z: 0.5 }, dead: false }, seededRand(1));
      A.ok(a && a.attack === s.degatsAvecArme(z, I.IRON_SWORD), 'et le coup porte ces dégâts');
    });

    it('SPEC-EQUIP-003 : un squelette arme d une epee renonce a son arc', function () {
      var ents = E(), sk = MC.EntitySpecs.skeleton;
      A.ok(ents.tirDe({ arme: 0 }, sk), 'sans épée : il tire');
      A.equal(ents.tirDe({ arme: I.IRON_SWORD }, sk), null, 'avec : corps à corps');
      A.ok(ents.tirDe({ arme: I.ARBALETE }, MC.EntitySpecs.pillager), 'l arbalète reste une arme de tir');
    });

    it('SPEC-EQUIP-004 : le pillard tire a l arbalete', function () {
      var s = E();
      var p = s.spawn('pillager', 0.5, 11, 0.5);
      p.onGround = true;
      var tirs = 0;
      for (var i = 0; i < 120; i++) tirs += s.update(1 / 30, { pos: { x: 12.5, y: 11, z: 0.5 }, dead: false },
                                                    { rand: seededRand(i) }).tirs || 0;
      A.ok(tirs >= 1, 'au moins un carreau (' + tirs + ')');
    });

    it('SPEC-EQUIP-005 : une creature armee lache parfois son arme', function () {
      var s = E(), lachees = 0;
      for (var i = 0; i < 300; i++) {
        var z = s.spawn('zombie', 0.5, 11, 0.5, { arme: I.IRON_SWORD });
        s.damage(z, 999);
      }
      s.list.forEach(function (e) { if (e.type === 'item' && e.item === I.IRON_SWORD) lachees++; });
      A.ok(lachees > 5 && lachees < 100, 'environ une fois sur dix (' + lachees + ' / 300)');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
