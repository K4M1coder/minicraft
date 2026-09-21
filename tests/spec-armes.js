/* spec-armes.js — tests des specs SPEC-ARME-* : ficelle, arc, flèches,
   et le comportement des projectiles. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, Inv = MC.Inventory, M = MC.Modes;
  var B = C.B, I = C.I;
  var flatWorld = G.flatWorld, seededRand = G.seededRand;

  function partie(modeId) {
    var w = flatWorld(10, B.STONE);
    var ents = MC.createEntities(w);
    var pl = MC.createPlayer(w, ents, M.regles(modeId || 'survie', 'facile'));
    pl.state.pos = { x: 0.5, y: 11, z: 0.5 };
    pl.state.onGround = true;
    pl.state.yaw = 0; pl.state.pitch = 0;
    return { w: w, ents: ents, pl: pl, s: pl.state };
  }
  function grille(cells) {
    var g = new Array(9).fill(0);
    cells.forEach(function (c) { g[c[0]] = c[1]; });
    return g;
  }

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — fabrication des armes', function () {

    it('SPEC-ARME-001 : la laine donne de la ficelle', function () {
      var r = Inv.matchRecipe(grille([[4, B.WOOL]]), 3, 3);
      A.ok(r, 'recette reconnue');
      A.equal(r.id, I.FICELLE);
      A.equal(r.n, 4, 'quatre ficelles');
    });

    it('SPEC-ARME-002 : l arc se fabrique avec batons et ficelle', function () {
      var r = Inv.matchRecipe(grille([
        [1, I.STICK], [2, I.FICELLE],
        [3, I.STICK], [5, I.FICELLE],
        [7, I.STICK], [8, I.FICELLE],
      ]), 3, 3);
      A.ok(r, 'recette reconnue');
      A.equal(r.id, I.ARC);
      A.equal(r.n, 1);
    });

    it('SPEC-ARME-003 : les fleches se fabriquent par quatre', function () {
      var r = Inv.matchRecipe(grille([[0, I.STICK], [3, I.FICELLE]]), 3, 3);
      A.ok(r, 'recette reconnue');
      A.equal(r.id, I.FLECHE);
      A.equal(r.n, 4);
    });

    it('SPEC-ARME-014 : l epee en fer blesse plus que celle en bois', function () {
      A.ok(C.def(I.IRON_SWORD).damage > C.def(I.STONE_SWORD).damage, 'fer > pierre');
      A.ok(C.def(I.STONE_SWORD).damage > C.def(I.WOOD_SWORD).damage, 'pierre > bois');
      A.ok(C.def(I.WOOD_SWORD).damage > 1, 'meme en bois, mieux que la main nue');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — tir et projectiles', function () {

    it('SPEC-ARME-004 : tirer consomme exactement une fleche', function () {
      var g = partie();
      g.s.inv.add(I.ARC, 1); g.s.selected = 0;
      g.s.inv.add(I.FLECHE, 5);
      var r = g.pl.tirer();
      A.ok(r, 'tir effectue');
      A.equal(g.s.inv.count(I.FLECHE), 4, 'une seule fleche consommee');
    });

    it('SPEC-ARME-005 : sans fleche, aucun projectile', function () {
      var g = partie();
      g.s.inv.add(I.ARC, 1); g.s.selected = 0;
      A.equal(g.pl.tirer(), null, 'tir refuse');
      A.equal(g.ents.list.length, 0, 'aucune entite creee');
    });

    it('SPEC-ARME-005 : sans arc en main, aucun tir', function () {
      var g = partie();
      g.s.inv.add(I.FLECHE, 5); g.s.selected = 0;
      A.equal(g.pl.tirer(), null, 'une fleche seule ne tire pas');
    });

    it('SPEC-ARME-006 : le projectile part dans la direction du regard', function () {
      for (var deg = 0; deg < 360; deg += 45) {
        var g = partie();
        g.s.inv.add(I.ARC, 1); g.s.selected = 0;
        g.s.inv.add(I.FLECHE, 1);
        g.s.yaw = deg * Math.PI / 180;
        g.s.pitch = 0;
        var r = g.pl.tirer();
        A.ok(r, 'tir a ' + deg + '°');
        var v = r.entity.vel;
        var n = Math.hypot(v.x, v.y, v.z);
        var d = g.pl.lookDir();
        var dot = (v.x * d.x + v.y * d.y + v.z * d.z) / n;
        A.close(dot, 1, 2e-4, 'aligne sur le regard a ' + deg + '°');
      }
    });

    it('SPEC-ARME-007 : le projectile subit la gravite', function () {
      var g = partie();
      g.s.inv.add(I.ARC, 1); g.s.selected = 0;
      g.s.inv.add(I.FLECHE, 1);
      g.s.pos.y = 40;                        // en l'air, rien a percuter
      g.s.pitch = 0;
      var r = g.pl.tirer();
      var vy0 = r.entity.vel.y;
      for (var i = 0; i < 30; i++) g.ents.update(1 / 60, g.s, { rand: seededRand(1) });
      A.ok(r.entity.vel.y < vy0, 'la vitesse verticale decroit');
      A.ok(r.entity.vel.y < 0, 'le projectile retombe');
    });

    it('SPEC-ARME-008 : le projectile disparait en touchant un bloc', function () {
      var g = partie();
      g.s.inv.add(I.ARC, 1); g.s.selected = 0;
      g.s.inv.add(I.FLECHE, 1);
      g.w.setBlock(0, 11, -4, B.STONE);
      g.w.setBlock(0, 12, -4, B.STONE);
      g.s.yaw = 0;                            // vers -Z, droit sur le mur
      var r = g.pl.tirer();
      var vivant = true;
      for (var i = 0; i < 300 && vivant; i++) {
        g.ents.update(1 / 60, g.s, { rand: seededRand(1) });
        vivant = g.ents.list.indexOf(r.entity) >= 0;
      }
      A.notOk(vivant, 'le projectile a disparu a l impact');
    });

    it('SPEC-ARME-009 : le projectile blesse le premier mob touche', function () {
      var g = partie();
      g.s.inv.add(I.ARC, 1); g.s.selected = 0;
      g.s.inv.add(I.FLECHE, 1);
      var z = g.ents.spawn('zombie', 0.5, 11, -4);
      var hp0 = z.hp;
      g.s.yaw = 0;
      var dy = (z.pos.y + z.h / 2) - (g.s.pos.y + g.pl.EYE);
      g.s.pitch = Math.atan2(dy, 4);
      var r = g.pl.tirer();
      for (var i = 0; i < 200 && g.ents.list.indexOf(r.entity) >= 0; i++) {
        g.ents.update(1 / 60, g.s, { rand: seededRand(1) });
      }
      A.ok(z.hp < hp0, 'le zombie est blesse (' + hp0 + ' -> ' + z.hp + ')');
      A.equal(g.ents.list.indexOf(r.entity), -1, 'le projectile a disparu');
    });

    it('SPEC-ARME-010 : le projectile ne blesse pas son tireur', function () {
      var g = partie();
      g.s.inv.add(I.ARC, 1); g.s.selected = 0;
      g.s.inv.add(I.FLECHE, 1);
      var r = g.pl.tirer();
      // on ramene le projectile sur le tireur
      r.entity.pos.x = g.s.pos.x; r.entity.pos.y = g.s.pos.y + 1; r.entity.pos.z = g.s.pos.z;
      r.entity.vel.x = r.entity.vel.y = r.entity.vel.z = 0;
      var hp0 = g.s.hp;
      var total = 0;
      for (var i = 0; i < 60; i++) {
        total += g.ents.update(1 / 60, g.s, { rand: seededRand(1) }).damage;
      }
      A.equal(total, 0, 'aucun degat inflige au tireur');
      A.equal(g.s.hp, hp0, 'les PV sont intacts');
    });

    it('SPEC-ARME-011 : un projectile blesse plus qu un coup a main nue', function () {
      A.ok(C.def(I.FLECHE).damage > 1, 'plus que la main nue (1)');
      var a = partie(), b = partie();
      var m1 = a.ents.spawn('sheep', 1, 11, 0.5);
      a.pl.attack(m1);                           // main nue
      var degatsMain = 8 - m1.hp;

      b.s.inv.add(I.ARC, 1); b.s.selected = 0;
      b.s.inv.add(I.FLECHE, 1);
      var m2 = b.ents.spawn('sheep', 0.5, 11, -4);
      b.s.yaw = 0;
      var dy = (m2.pos.y + m2.h / 2) - (b.s.pos.y + b.pl.EYE);
      b.s.pitch = Math.atan2(dy, 4);
      var r = b.pl.tirer();
      for (var i = 0; i < 200 && b.ents.list.indexOf(r.entity) >= 0; i++) {
        b.ents.update(1 / 60, b.s, { rand: seededRand(1) });
      }
      var degatsFleche = 8 - m2.hp;
      A.ok(degatsFleche > degatsMain,
        'fleche ' + degatsFleche + ' > main nue ' + degatsMain);
    });

    it('SPEC-ARME-012 : l arc s use a chaque tir et finit par se briser', function () {
      var g = partie();
      g.s.inv.add(I.ARC, 1); g.s.selected = 0;
      g.s.inv.add(I.FLECHE, 64);
      g.s.inv.add(I.FLECHE, 64);
      var max = C.durabilityOf(I.ARC);
      A.ok(max > 0, 'l arc a une durabilite');
      g.pl.tirer();
      A.equal(g.s.inv.slots[0].dmg, 1, 'une unite d usure au premier tir');
      var brise = false;
      for (var i = 0; i < max + 5 && !brise; i++) {
        g.s.inv.add(I.FLECHE, 1);             // on ne veut pas manquer de munitions
        var r = g.pl.tirer();
        if (!g.s.inv.slots[0] || g.s.inv.slots[0].id !== I.ARC) brise = true;
      }
      A.ok(brise, 'l arc a fini par se briser');
    });

    it('SPEC-ARME-012 : en creatif l arc ne s use pas', function () {
      var g = partie('creatif');
      g.s.inv.add(I.ARC, 1); g.s.selected = 0;
      g.s.inv.add(I.FLECHE, 10);
      for (var i = 0; i < 20; i++) g.pl.tirer();
      A.ok(!g.s.inv.slots[0].dmg, 'aucune usure');
      A.equal(g.s.inv.count(I.FLECHE), 10, 'les munitions non plus ne se consomment pas');
    });

    it('SPEC-ARME-013 : un projectile expire apres un temps borne', function () {
      var g = partie();
      g.s.inv.add(I.ARC, 1); g.s.selected = 0;
      g.s.inv.add(I.FLECHE, 1);
      g.s.pos.y = 300; g.s.pitch = Math.PI / 2 - 0.01;   // tir vers le haut, rien a toucher
      var r = g.pl.tirer();
      var vivant = true;
      for (var i = 0; i < 60 * 40 && vivant; i++) {
        g.ents.update(1 / 60, g.s, { rand: seededRand(1) });
        vivant = g.ents.list.indexOf(r.entity) >= 0;
      }
      A.notOk(vivant, 'le projectile a disparu de lui-meme');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
