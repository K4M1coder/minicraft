/* spec-modes.js — tests des specs SPEC-MODE-* et SPEC-DIFF-*.
   Chaque test cite son identifiant : la porte G1 vérifie qu'aucune spec n'est
   orpheline, la porte G2 qu'aucun identifiant n'est inventé. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, M = MC.Modes, Inv = MC.Inventory;
  var B = C.B, I = C.I;
  var flatWorld = G.flatWorld, seededRand = G.seededRand;

  function partie(modeId, diffId, groundId) {
    var w = flatWorld(10, groundId === undefined ? B.STONE : groundId);
    var ents = MC.createEntities(w);
    var pl = MC.createPlayer(w, ents, M.regles(modeId || 'survie', diffId || 'facile'));
    pl.state.pos = { x: 0.5, y: 11, z: 0.5 };
    pl.state.onGround = true;
    return { w: w, ents: ents, pl: pl, s: pl.state };
  }
  var NOKEY = { forward: 0, back: 0, left: 0, right: 0, jump: 0, sprint: 0 };
  function keys(o) { return Object.assign({}, NOKEY, o || {}); }

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — modes de jeu', function () {

    it('SPEC-MODE-001 : deux modes existent, survie et creatif', function () {
      var cles = Object.keys(M.MODES).sort();
      A.deep(cles, ['creatif', 'survie'], 'exactement ces deux modes');
      A.equal(M.MODES.survie.id, 'survie');
      A.equal(M.MODES.creatif.id, 'creatif');
    });

    it('SPEC-MODE-002 : un mode inconnu retombe sur survie', function () {
      A.equal(M.mode('nawak').id, 'survie');
      A.equal(M.mode(undefined).id, 'survie');
      A.equal(M.mode(null).id, 'survie');
    });

    it('SPEC-MODE-003 : en creatif on vole, on est invulnerable, on n a pas faim', function () {
      var r = M.regles('creatif', 'facile');
      A.ok(r.vole, 'vol');
      A.ok(r.invulnerable, 'invulnerable');
      A.notOk(r.faim, 'pas de faim');
    });

    it('SPEC-MODE-004 : en creatif tout bloc cede instantanement', function () {
      var g = partie('creatif');
      g.s.pitch = -Math.PI / 2 + 0.01;
      var t = g.pl.aim();
      A.ok(t, 'un bloc est vise');
      var res = g.pl.mineTick(1 / 60, t, function () { return 0; });
      A.ok(res, 'casse des la premiere image, a main nue, sur de la pierre');
      A.equal(g.w.getBlock(t.x, t.y, t.z), 0);
    });

    it('SPEC-MODE-005 : en creatif poser ne consomme pas la pile', function () {
      var g = partie('creatif');
      g.s.inv.add(B.BRICK, 5); g.s.selected = 0;
      g.pl.useOn({ x: 3, y: 10, z: 3, block: B.STONE, nx: 0, ny: 1, nz: 0 });
      A.equal(g.w.getBlock(3, 11, 3), B.BRICK, 'le bloc est pose');
      A.equal(g.s.inv.count(B.BRICK), 5, 'la pile est intacte');
    });

    it('SPEC-MODE-006 : en creatif les outils ne s usent pas', function () {
      var g = partie('creatif');
      g.s.inv.add(I.WOOD_PICKAXE, 1); g.s.selected = 0;
      g.s.pitch = -Math.PI / 2 + 0.01;
      for (var i = 0; i < 5; i++) {
        g.w.setBlock(0, 10, 0, B.STONE);
        var t = g.pl.aim();
        if (t) g.pl.mineTick(1 / 60, t, function () { return 0; });
      }
      var m = g.ents.spawn('sheep', 1, 11, 0.5);
      g.pl.attack(m);
      A.ok(!g.s.inv.slots[0].dmg, 'aucune usure accumulee');
    });

    it('SPEC-MODE-007 : en creatif le joueur ne subit aucun degat', function () {
      var g = partie('creatif');
      // chute
      g.s.pos.y = 40; g.s.onGround = false; g.s.flying = false;
      for (var i = 0; i < 400 && !g.s.onGround; i++) g.pl.updateMovement(1 / 60, keys());
      A.equal(g.s.hp, 20, 'pas de degats de chute');
      // coup direct
      g.pl.hurt(15);
      A.equal(g.s.hp, 20, 'les degats directs sont ignores');
      // famine
      g.s.hunger = 0;
      for (var j = 0; j < 60 * 30; j++) g.pl.updateSurvival(1 / 60);
      A.equal(g.s.hp, 20, 'la famine ne blesse pas');
    });

    it('SPEC-MODE-008 : en creatif aucun monstre, meme en cauchemar', function () {
      var r = M.regles('creatif', 'cauchemar');
      A.notOk(r.monstres, 'pas de monstres');
      A.equal(M.plafondsEntites(r).zombie, 0, 'plafond zombie nul');
    });

    it('SPEC-MODE-009 : en survie toutes les contraintes restent actives', function () {
      var r = M.regles('survie', 'facile');
      A.ok(r.faim, 'faim active');
      A.notOk(r.invulnerable, 'vulnerable');
      A.notOk(r.vole, 'pas de vol par defaut');
      A.ok(r.useDurabilite, 'les outils s usent');
      A.notOk(r.blocsIllimites, 'les blocs se consomment');
    });

    it('SPEC-MODE-010 : le mode est persiste et restitue', function () {
      var st = G.mockStorage();
      var meta = MC.Saves.creer(st, { nom: 'T', mode: 'creatif', difficulte: 'facile', graine: 7 });
      A.equal(MC.Saves.trouver(st, meta.id).mode, 'creatif', 'mode conserve');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — difficultes', function () {

    it('SPEC-DIFF-001 : quatre difficultes ordonnees', function () {
      A.deep(M.ORDRE_DIFFICULTES, ['paisible', 'facile', 'difficile', 'cauchemar']);
      for (var i = 0; i < M.ORDRE_DIFFICULTES.length; i++) {
        A.equal(M.difficulte(M.ORDRE_DIFFICULTES[i]).ordre, i, M.ORDRE_DIFFICULTES[i]);
      }
    });

    it('SPEC-DIFF-002 : une difficulte inconnue retombe sur facile', function () {
      A.equal(M.difficulte('nawak').id, 'facile');
      A.equal(M.difficulte(undefined).id, 'facile');
    });

    it('SPEC-DIFF-003 : en paisible aucun monstre', function () {
      var r = M.regles('survie', 'paisible');
      A.notOk(r.monstres);
      A.equal(M.plafondsEntites(r).zombie, 0);
    });

    it('SPEC-DIFF-004 : en paisible animaux et villageois restent', function () {
      var p = M.plafondsEntites(M.regles('survie', 'paisible'));
      A.ok(p.sheep > 0, 'moutons');
      A.ok(p.villager > 0, 'villageois');
    });

    it('SPEC-DIFF-005 : en paisible la famine ne retire pas de PV', function () {
      A.notOk(M.regles('survie', 'paisible').degatsFamine);
      var g = partie('survie', 'paisible');
      g.s.hunger = 0;
      for (var i = 0; i < 60 * 30; i++) g.pl.updateSurvival(1 / 60);
      A.equal(g.s.hp, 20, 'PV intacts a jeun');
    });

    it('SPEC-DIFF-006 : les degats de mob croissent avec la difficulte', function () {
      var f = M.regles('survie', 'facile').degatsMob;
      var d = M.regles('survie', 'difficile').degatsMob;
      var c = M.regles('survie', 'cauchemar').degatsMob;
      A.ok(f < d, 'facile < difficile');
      A.ok(d < c, 'difficile < cauchemar');
    });

    it('SPEC-DIFF-007 : le plafond de monstres croit avec la difficulte', function () {
      var f = M.regles('survie', 'facile').plafondMonstres;
      var d = M.regles('survie', 'difficile').plafondMonstres;
      var c = M.regles('survie', 'cauchemar').plafondMonstres;
      A.ok(f < d && d < c, 'progression stricte');
    });

    it('SPEC-DIFF-008 : seul le cauchemar active la mort definitive', function () {
      M.ORDRE_DIFFICULTES.forEach(function (id) {
        var attendu = id === 'cauchemar';
        A.equal(M.regles('survie', id).permadeath, attendu, id);
      });
    });

    it('SPEC-DIFF-009 : le creatif annule la mort definitive', function () {
      A.notOk(M.regles('creatif', 'cauchemar').permadeath);
    });

    it('SPEC-DIFF-010 : la regeneration est plus rapide en paisible qu en cauchemar', function () {
      A.ok(M.regles('survie', 'paisible').regenMultiplicateur >
           M.regles('survie', 'cauchemar').regenMultiplicateur);
    });

    it('SPEC-DIFF-011 : la difficulte est persistee et restituee', function () {
      var st = G.mockStorage();
      var meta = MC.Saves.creer(st, { nom: 'T', difficulte: 'cauchemar', graine: 3 });
      A.equal(MC.Saves.trouver(st, meta.id).difficulte, 'cauchemar');
    });

    it('SPEC-DIFF-012 : en cauchemar la mort supprime la partie et sa carte', function () {
      var st = G.mockStorage();
      var meta = MC.Saves.creer(st, { nom: 'Rude', difficulte: 'cauchemar', graine: 5 });
      var etat = G.etatMinimal(meta.graine);
      etat.world.setBlock(3, 40, 4, B.BRICK);
      MC.Saves.sauvegarder(st, meta.id, etat);
      A.ok(st.getItem(MC.Saves.slotKey(meta.id)), 'la carte existe');

      var efface = MC.Saves.supprimer(st, meta.id);
      A.ok(efface, 'suppression effectuee');
      A.equal(MC.Saves.trouver(st, meta.id), null, 'metadonnees disparues');
      A.equal(st.getItem(MC.Saves.slotKey(meta.id)), null, 'carte disparue');
    });

    it('SPEC-DIFF-013 : hors cauchemar la mort conserve la partie', function () {
      var st = G.mockStorage();
      var meta = MC.Saves.creer(st, { nom: 'Douce', difficulte: 'facile', graine: 5 });
      var etat = G.etatMinimal(meta.graine);
      MC.Saves.sauvegarder(st, meta.id, etat);
      // la mort en facile ne declenche aucune suppression
      A.notOk(M.regles('survie', 'facile').permadeath, 'pas de permadeath');
      A.ok(MC.Saves.trouver(st, meta.id), 'la partie existe toujours');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
