/* spec-monde.js — tests des specs SPEC-TERRAIN-*, SPEC-BIOME-*, SPEC-VEGE-*,
   SPEC-MOB-* et SPEC-DONJON-*.
   Streaming et maillage, biomes, végétation, nouvelles créatures, donjons.
   La génération coûte cher sous le bac à sable de Node : chaque test se
   contente de quelques chunks, choisis par prospection pure (heightAt,
   biomeAt) plutôt qu'en générant large. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, P = MC.Physics, M = MC.Modes, Inv = MC.Inventory;
  var B = C.B, I = C.I, SEA = C.SEA_LEVEL;
  var flatWorld = G.flatWorld, seededRand = G.seededRand;

  var GRAINE = 20260921;
  var mondes = {};
  function monde(g) {
    g = g === undefined ? GRAINE : g;
    if (!mondes[g]) mondes[g] = MC.createWorld(g);
    return mondes[g];
  }

  /* Premier chunk, sur une spirale de chunks, entièrement dans le biome voulu
     (ses quatre coins et son centre) et hors de l'eau. */
  function chunkDuBiome(w, id) {
    for (var r = 0; r < 400; r++) {
      for (var k = 0; k < 8 * Math.max(1, r); k++) {
        var a = (k / (8 * Math.max(1, r))) * Math.PI * 2;
        var cx = Math.round(Math.cos(a) * r * 3), cz = Math.round(Math.sin(a) * r * 3);
        var ok = [[1, 1], [14, 1], [1, 14], [14, 14], [8, 8]].every(function (p) {
          var x = cx * 16 + p[0], z = cz * 16 + p[1];
          return w.biomeAt(x, z).id === id && w.heightAt(x, z) > SEA + 2;
        });
        if (ok) return [cx, cz];
      }
    }
    return null;
  }

  function compter(c, pred) {
    var n = 0;
    for (var i = 0; i < c.blocks.length; i++) if (pred(c.blocks[i])) n++;
    return n;
  }

  function signature(w, c) {
    return ['opaque', 'cutout', 'blend'].map(function (p) {
      var r = MC.Mesher.buildChunk(c, p, w.getBlock);
      if (!r) return '0';
      var s = 0;
      for (var i = 0; i < r.colors.length; i++) s += r.colors[i] * ((i % 97) + 1);
      return r.positions.length + ':' + s.toFixed(3);
    }).join('|');
  }

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — streaming et maillage du terrain', function () {

    it('SPEC-TERRAIN-001 : generer un chunk invalide ses 8 voisins, diagonales comprises', function () {
      var w = MC.createWorld(77);
      for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) {
        if (dx && dz) continue;                       // la croix d'abord
        w.getChunk(dx, dz, true);
      }
      var centre = w.chunks.get(w.key(0, 0));
      centre.dirty = false;                            // « maillé » avec 4 voisins
      w.getChunk(1, 1, true);
      w.marquerVoisins(1, 1);
      A.ok(centre.dirty, 'le chunk central doit être remaillé quand sa diagonale arrive');
    });

    it('SPEC-TERRAIN-002 : un chunk n est maillable qu une fois ses 8 voisins charges', function () {
      var w = MC.createWorld(78);
      [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (p) { w.getChunk(p[0], p[1], true); });
      A.notOk(w.voisinsCharges(0, 0), 'les 4 voisins directs ne suffisent pas');
      [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (p) { w.getChunk(p[0], p[1], true); });
      A.ok(w.voisinsCharges(0, 0), 'avec les 8 voisins, oui');
    });

    it('SPEC-TERRAIN-001 : un maillage fait avec ses 8 voisins ne perime plus', function () {
      var w = MC.createWorld(79);
      for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) w.getChunk(dx, dz, true);
      var c = w.chunks.get(w.key(0, 0));
      var avant = signature(w, c);
      // un second anneau n'influence pas le maillage du centre
      for (var ex = -2; ex <= 2; ex++) { w.getChunk(ex, 2, true); w.getChunk(ex, -2, true); }
      A.equal(signature(w, c), avant, 'maillage identique après le chargement de chunks plus lointains');
    });

    it('SPEC-TERRAIN-003 : modifier un bloc de coin invalide le chunk en diagonale', function () {
      var w = MC.createWorld(80);
      for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) w.getChunk(dx, dz, true);
      w.chunks.forEach(function (c) { c.dirty = false; });
      w.setBlock(15, 50, 15, B.STONE);                 // coin (+x, +z) du chunk (0, 0)
      A.ok(w.chunks.get(w.key(1, 1)).dirty, 'la diagonale (1, 1) est remaillée');
      A.ok(w.chunks.get(w.key(1, 0)).dirty, 'le voisin +x aussi');
      A.ok(w.chunks.get(w.key(0, 1)).dirty, 'le voisin +z aussi');
      A.notOk(w.chunks.get(w.key(-1, -1)).dirty, 'la diagonale opposée, non');
    });

    it('SPEC-TERRAIN-004 : le streaming suit chaque joueur local', function () {
      var w = MC.createWorld(81);
      var voulus = w.chunksVoulus([[0, 0], [40, 0]], 2);
      var cles = voulus.map(function (v) { return w.key(v[1], v[2]); });
      A.ok(cles.indexOf(w.key(0, 0)) >= 0, 'autour du joueur 1');
      A.ok(cles.indexOf(w.key(40, 0)) >= 0, 'autour du joueur 2');
      A.equal(cles.length, new Set(cles).size, 'aucun doublon');
      for (var i = 1; i < voulus.length; i++) A.ok(voulus[i][0] >= voulus[i - 1][0], 'du plus proche au plus loin');
    });

    it('SPEC-TERRAIN-004 : on ne decharge pas le sol sous un joueur eloigne du premier', function () {
      var w = MC.createWorld(82);
      w.getChunk(0, 0, true); w.getChunk(30, 0, true); w.getChunk(60, 0, true);
      var n = w.unloadLoin([[0, 0], [30, 0]], 3);
      A.equal(n, 1, 'seul le chunk loin des deux joueurs part');
      A.ok(w.chunks.has(w.key(30, 0)), 'le sol du joueur 2 reste');
      A.ok(w.estCharge(30 * 16 + 3, 5), 'estCharge le confirme');
      A.notOk(w.estCharge(60 * 16, 0), 'et le chunk lointain est bien parti');
      A.equal(w.unloadFar(0, 0, 3), 1, 'unloadFar reste un cas particulier à un centre');
    });

    it('SPEC-TERRAIN-005 : une entite hors des chunks charges est gelee, pas precipitee', function () {
      var w = MC.createWorld(83);
      w.getChunk(0, 0, true);
      var ents = MC.createEntities(w);
      var loin = ents.spawn('sheep', 200.5, 40, 200.5);
      var objet = ents.dropItem(210.5, 40, 210.5, B.STONE, 1, seededRand(3));
      var y0 = loin.pos.y, y1 = objet.pos.y;
      for (var i = 0; i < 120; i++) ents.update(1 / 30, { pos: { x: 8, y: 60, z: 8 } }, { rand: seededRand(i) });
      A.notOk(ents.zoneChargee(loin), 'hors zone');
      A.equal(loin.pos.y, y0, 'le mouton ne tombe pas dans le vide');
      A.equal(objet.pos.y, y1, 'le butin non plus');
      A.ok(ents.list.indexOf(loin) >= 0 && ents.list.indexOf(objet) >= 0, 'et ni l un ni l autre ne disparaît');
    });

    it('SPEC-TERRAIN-008 : le joueur ne pousse pas une creature dans un mur', function () {
      var w = flatWorld(10, B.STONE);
      for (var y = 11; y <= 13; y++) for (var z = -2; z <= 2; z++) w.setBlock(1, y, z, B.STONE);
      var ents = MC.createEntities(w);
      // un mouton collé au mur, le joueur qui le serre de l'autre côté
      var m = ents.spawn('sheep', 0.64, 11, 0.5);
      var joueur = { pos: { x: 0.3, y: 11, z: 0.5 }, dead: false };
      for (var i = 0; i < 60; i++) {
        ents.update(1 / 30, joueur, { rand: seededRand(i) });
        A.notOk(P.collides(w, m.pos.x, m.pos.y, m.pos.z, m.w, m.h), 'jamais dans la roche (image ' + i + ')');
      }
    });

    it('SPEC-TERRAIN-006 : les lumieres suivent le chargement des chunks', function () {
      var w = MC.createWorld(84);
      w.getChunk(0, 0, true); w.getChunk(9, 0, true);
      w.setBlock(4, 60, 4, B.TORCH);
      w.setBlock(9 * 16 + 4, 60, 4, B.TORCH);
      A.equal(w.lights.size >= 2, true, 'deux torches enregistrées');
      w.unloadLoin([[0, 0]], 2);
      var restantes = 0;
      w.lights.forEach(function (l) { if (l.x >= 9 * 16) restantes++; });
      A.equal(restantes, 0, 'la torche du chunk déchargé quitte le registre');
      w.getChunk(9, 0, true);
      A.ok(w.lights.has(w.key3(9 * 16 + 4, 60, 4)), 'et revient avec lui (réappliquée depuis les modifications)');
      A.ok(w.rebuildRegistries() >= 2, 'la reconstruction retrouve les deux');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — biomes', function () {

    it('SPEC-BIOME-001 : dix-huit biomes existent et apparaissent tous', function () {
      var w = monde();
      A.equal(MC.Biomes.TERRESTRES.length, 13, 'treize biomes terrestres');
      A.equal(MC.Biomes.MARINS.length, 5, 'cinq biomes marins');
      A.equal(MC.Biomes.ORDRE.length, 18);
      var vus = {};
      for (var x = -3000; x <= 3000; x += 37) for (var z = -3000; z <= 3000; z += 41) {
        vus[w.biomeAt(x, z).id] = true;
      }
      MC.Biomes.ORDRE.forEach(function (id) {
        A.ok(vus[id], 'le biome ' + id + ' apparaît');
        A.ok(MC.Biomes.LISTE[id].nom, 'et porte un nom');
      });
    });

    it('SPEC-BIOME-002 : biome et relief ne dependent que de la graine', function () {
      var a = MC.Biomes.creer(MC.makeNoise(99)), b = MC.Biomes.creer(MC.makeNoise(99));
      var c = MC.Biomes.creer(MC.makeNoise(100));
      var diff = 0;
      for (var i = 0; i < 400; i++) {
        var x = i * 53 - 9000, z = i * 71 - 4000;
        A.equal(a.hauteur(x, z), b.hauteur(x, z), 'même graine, même relief');
        A.equal(a.biomeAt(x, z).id, b.biomeAt(x, z).id, 'même graine, même biome');
        A.equal(a.classer(a.colonne(x, z).climat, a.hauteur(x, z)), a.biomeAt(x, z).id, 'classer(climat, hauteur) = biomeAt');
        var e = a.echantillon(x, z);
        A.equal(e.h, a.hauteur(x, z), 'echantillon donne la même hauteur');
        A.equal(e.biome.id, a.biomeAt(x, z).id, 'et le même biome');
        if (a.biomeAt(x, z).id !== c.biomeAt(x, z).id) diff++;
      }
      A.ok(diff > 0, 'une autre graine donne une autre carte');
    });

    it('SPEC-BIOME-003 : le relief reste continu aux frontieres de biomes', function () {
      var w = monde(), pire = 0;
      var Bi = MC.Biomes.creer(w.noise);
      // falaises, mesas, volcans et lacs sont des ruptures VOULUES : on les écarte
      function relief(x, z) {
        var c = Bi.colonne(x, z).climat;
        return c.falaise > 0 || c.escarpement > 0 || c.badlands > 0 || c.volcan || c.lac ||
               Bi.volcanProche(x, z) || Bi.lacProche(x, z);
      }
      for (var x = -2500; x <= 2500; x += 13) for (var z = -2500; z <= 2500; z += 197) {
        if (relief(x, z) || relief(x + 1, z) || relief(x, z + 1)) continue;
        var h = w.heightAt(x, z);
        pire = Math.max(pire, Math.abs(w.heightAt(x + 1, z) - h), Math.abs(w.heightAt(x, z + 1) - h));
      }
      A.ok(pire <= 5, 'pente maximale entre deux colonnes voisines, hors reliefs particuliers : ' + pire);
      // les poids sont des fonctions lisses et bornées
      A.equal(MC.Biomes.smoothstep(0.2, 0.8, 0.1), 0);
      A.equal(MC.Biomes.smoothstep(0.2, 0.8, 0.9), 1);
      A.ok(Math.abs(MC.Biomes.smoothstep(0.2, 0.8, 0.5) - 0.5) < 1e-9);
      A.equal(MC.Biomes.etaler(0.5), 0.5, 'etaler conserve le centre');
      A.equal(MC.Biomes.etaler(0.95), 1, 'et borne à [0,1]');
    });

    it('SPEC-BIOME-004 : chaque biome a sa surface propre', function () {
      var w = monde();
      var d = chunkDuBiome(w, 'desert');
      A.ok(d, 'un chunk de désert existe');
      var cd = w.getChunk(d[0], d[1], true);
      A.ok(compter(cd, function (b) { return b === B.SANDSTONE; }) > 100, 'du grès sous le sable du désert');
      A.equal(compter(cd, function (b) { return b === B.GRASS; }), 0, 'pas d herbe au désert');

      var t = chunkDuBiome(w, 'taiga');
      A.ok(t, 'un chunk de taïga existe');
      var ct = w.getChunk(t[0], t[1], true);
      A.ok(compter(ct, function (b) { return b === B.SNOW; }) > 100, 'la taïga est enneigée');
    });

    it('SPEC-BIOME-004 : dans le froid, la surface de l eau gele', function () {
      var w = monde(), trouve = null, essais = 0;
      // on cherche une eau froide qui ne soit pas un iceberg (glace compacte jusqu'au fond)
      for (var x = -3000; x <= 3000 && !trouve && essais < 12; x += 7) {
        for (var z = -3000; z <= 3000 && !trouve && essais < 12; z += 97) {
          if (!w.biomeAt(x, z).gel || w.heightAt(x, z) >= SEA - 1) continue;
          essais++;
          w.getChunk(Math.floor(x / 16), Math.floor(z / 16), true);
          if (w.getBlock(x, SEA, z) === B.ICE) trouve = [x, z];
        }
      }
      A.ok(trouve, 'une eau gelée existe');
      A.equal(w.getBlock(trouve[0], SEA - 1, trouve[1]), B.WATER, 'eau liquide sous la glace');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — vegetation', function () {

    it('SPEC-VEGE-001 : chaque biome porte ses essences', function () {
      var w = monde();
      var attendus = [['foret', B.BIRCH_LOG], ['taiga', B.SPRUCE_LOG], ['desert', B.CACTUS]];
      attendus.forEach(function (a) {
        var p = chunkDuBiome(w, a[0]), n = 0;
        // quelques chunks du biome : une essence clairsemée peut manquer à l'un d'eux
        for (var k = 0; k < 4 && n === 0; k++) {
          var c = w.getChunk(p[0] + k, p[1], true);
          n += compter(c, function (b) { return b === a[1]; });
        }
        A.ok(n > 0, C.nameOf(a[1]) + ' présent en ' + a[0]);
      });
      A.ok(C.isLog(B.BIRCH_LOG) && C.isLog(B.SPRUCE_LOG) && C.isLog(B.LOG), 'trois troncs');
      A.ok(C.isLeaves(B.BIRCH_LEAVES) && C.isLeaves(B.SPRUCE_LEAVES) && C.isLeaves(B.LEAVES), 'trois feuillages');
      A.notOk(C.isLog(B.STONE) || C.isLeaves(B.STONE), 'la pierre n est ni l un ni l autre');
    });

    it('SPEC-VEGE-002 : la vegetation basse ne bloque pas et tombe sans sol', function () {
      [B.TALL_GRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.DEAD_BUSH, B.MUSHROOM].forEach(function (id) {
        A.notOk(C.isSolid(id), C.nameOf(id) + ' se traverse');
        A.ok(C.isReplaceable(id), C.nameOf(id) + ' se remplace en posant un bloc');
        A.equal(C.breakTime(id, 0).seconds, 0, C.nameOf(id) + ' casse d un coup');
      });
      var w = flatWorld(10, B.GRASS);
      w.setBlock(0, 11, 0, B.FLOWER_RED);
      w.setBlock(1, 11, 0, B.STONE);                   // un mur à côté ne la retient pas
      w.setBlock(0, 10, 0, 0);
      var t = w.dropUnsupported(0, 10, 0);
      A.equal(t.length, 1, 'la fleur tombe avec son sol');
      A.equal(w.getBlock(0, 11, 0), 0);
    });

    it('SPEC-VEGE-003 : une plante ne pousse que sur un sol adapte', function () {
      var w = monde();
      var p = chunkDuBiome(w, 'desert'), c = w.getChunk(p[0], p[1], true);
      var mal = 0, bien = 0;
      for (var x = 0; x < 16; x++) for (var z = 0; z < 16; z++) for (var y = 1; y < C.WORLD_H; y++) {
        var b = c.blocks[C.idx(x, y, z)];
        if (b !== B.DEAD_BUSH) continue;
        if (c.blocks[C.idx(x, y - 1, z)] === B.SAND) bien++; else mal++;
      }
      A.equal(mal, 0, 'aucun buisson mort hors du sable');
    });

    it('SPEC-VEGE-004 : toutes les essences donnent des planches', function () {
      [B.LOG, B.BIRCH_LOG, B.SPRUCE_LOG].forEach(function (log) {
        var r = Inv.matchRecipe([log], 1, 1);
        A.ok(r && r.id === B.PLANKS && r.n === 4, C.nameOf(log) + ' → 4 planches');
      });
      var g = Inv.matchRecipe([B.SAND, B.SAND, B.SAND, 0], 2, 2);
      A.ok(g && g.id === B.SANDSTONE, 'trois sables donnent du grès');
      var v = Inv.matchRecipe([B.SAND, B.SAND, B.SAND, B.SAND], 2, 2);
      A.ok(v && v.id === B.GLASS, 'quatre en carré restent du verre');
    });

    it('SPEC-VEGE-005 : le cactus pique au contact', function () {
      var w = flatWorld(10, B.SAND);
      var ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents, M.regles('survie', 'facile'));
      w.setBlock(1, 11, 0, B.CACTUS);
      pl.state.pos = { x: 0.68, y: 11, z: 0.5 };        // collé au cactus, sans le chevaucher
      A.notOk(P.collides(w, pl.state.pos.x, pl.state.pos.y, pl.state.pos.z, pl.PW, pl.PH), 'pas dedans');
      A.equal(P.contact(w, 0.68, 11, 0.5, pl.PW, pl.PH, 0.06, function (id) { return id === B.CACTUS; }),
              B.CACTUS, 'mais au contact');
      var hp = pl.state.hp;
      for (var i = 0; i < 40; i++) pl.updateSurvival(1 / 20);
      A.ok(pl.state.hp < hp, 'le joueur a été piqué');
      A.ok(pl.state.hp >= hp - 4, 'par petites touches, pas d un coup (' + (hp - pl.state.hp) + ' PV)');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — nouvelles creatures', function () {

    function scene() {
      var w = flatWorld(10, B.STONE);
      return { w: w, ents: MC.createEntities(w) };
    }
    function cible(x, z) { return { pos: { x: x, y: 11, z: z }, dead: false }; }

    it('SPEC-MOB-001 : chaque creature a un gabarit coherent', function () {
      ['skeleton', 'spider', 'mummy', 'slime', 'wolf', 'pig'].concat(MC.Donjons.BOSS).forEach(function (t) {
        var s = MC.EntitySpecs[t];
        A.ok(s, t + ' défini');
        A.ok(s.w > 0 && s.h > 0 && s.hp > 0 && s.speed > 0, t + ' : dimensions, vie, vitesse');
      });
    });

    it('SPEC-MOB-002 : le squelette tire quand il voit sa cible', function () {
      var s = scene();
      var sq = s.ents.spawn('skeleton', 0.5, 11, 0.5);
      sq.onGround = true;
      var tirs = 0;
      for (var i = 0; i < 90; i++) {
        var ev = s.ents.update(1 / 30, cible(10.5, 0.5), { rand: seededRand(i) });
        tirs += ev.tirs || 0;
      }
      A.ok(tirs >= 1, 'au moins une flèche en 3 s (' + tirs + ')');
      A.ok(s.ents.voitCible(sq, cible(10.5, 0.5)), 'ligne de vue dégagée');
    });

    it('SPEC-MOB-002 : le squelette ne tire pas a travers un mur', function () {
      var s = scene();
      // assez large pour qu'en tournant autour de sa cible il n'en sorte pas en 3 s
      for (var y = 11; y <= 14; y++) for (var z = -12; z <= 12; z++) s.w.setBlock(4, y, z, B.STONE);
      var sq = s.ents.spawn('skeleton', 0.5, 11, 0.5);
      A.notOk(s.ents.voitCible(sq, cible(10.5, 0.5)), 'le mur cache la cible');
      var tirs = 0;
      for (var i = 0; i < 90; i++) tirs += s.ents.update(1 / 30, cible(10.5, 0.5), { rand: seededRand(i) }).tirs || 0;
      A.equal(tirs, 0, 'aucune flèche gaspillée');
    });

    it('SPEC-MOB-002 : la visee compense la chute de la fleche', function () {
      var s = scene();
      var sq = s.ents.spawn('skeleton', 0.5, 11, 0.5);
      var v = s.ents.viser(sq, cible(14.5, 0.5), { n: 1, degats: 3 });
      A.equal(v.directions.length, 1);
      A.ok(v.directions[0].y > 0, 'à portée égale de hauteur, on vise au-dessus');
      var r = s.ents.viser(sq, cible(14.5, 0.5), { n: 3, degats: 3 });
      A.equal(r.directions.length, 3, 'une rafale de trois');
      A.ok(Math.abs(r.directions[0].z - r.directions[2].z) > 0.05, 'ouverte en éventail');
    });

    it('SPEC-MOB-003 : l araignee bondit sur sa proie', function () {
      var s = scene();
      var ar = s.ents.spawn('spider', 0.5, 11, 0.5);
      ar.onGround = true;
      var bond = false;
      for (var i = 0; i < 30 && !bond; i++) {
        s.ents.stepAI(ar, 1 / 30, cible(4.5, 0.5), seededRand(i));
        if (ar.vel.y > 5 && ar.vel.x > 6) bond = true;
      }
      A.ok(bond, 'un bond vers la cible à 4 blocs');
    });

    it('SPEC-MOB-004 : le slime n avance qu en sautant', function () {
      var s = scene();
      var sl = s.ents.spawn('slime', 0.5, 11, 0.5);
      sl.onGround = true; sl.sautCd = 0.5;
      s.ents.stepAI(sl, 1 / 30, cible(6.5, 0.5), seededRand(1));
      A.ok(Math.abs(sl.vel.x) < 0.5, 'au sol entre deux sauts, il reste posé');
      sl.sautCd = 0;
      s.ents.stepAI(sl, 1 / 30, cible(6.5, 0.5), seededRand(2));
      A.ok(sl.vel.y > 5 && sl.vel.x > 1, 'puis bondit vers la cible');
    });

    it('SPEC-MOB-005 : le loup est neutre jusqu a ce qu on le frappe', function () {
      var s = scene();
      var lo = s.ents.spawn('wolf', 0.5, 11, 0.5);
      lo.onGround = true;
      var a = s.ents.stepAI(lo, 1 / 30, cible(1.2, 0.5), seededRand(1));
      A.notOk(a && a.attack, 'il ne mord pas un passant');
      s.ents.damage(lo, 1, { x: 1.2, y: 11, z: 0.5 });
      A.ok(lo.enrage, 'frappé, il s énerve');
      lo.attackCd = 0; lo.pos.x = 0.5; lo.pos.z = 0.5;
      a = s.ents.stepAI(lo, 1 / 30, cible(1.2, 0.5), seededRand(2));
      A.ok(a && a.attack > 0, 'et mord');
    });

    it('SPEC-MOB-006 : le cochon donne du porc, qui cuit au four', function () {
      var s = scene();
      var co = s.ents.spawn('pig', 0.5, 11, 0.5);
      s.ents.damage(co, 99);
      var porc = s.ents.list.filter(function (e) { return e.type === 'item' && e.item === I.RAW_PORK; });
      A.equal(porc.length, 1, 'un butin de porc cru');
      A.equal(Inv.smeltResult(I.RAW_PORK), I.COOKED_PORK, 'le four le cuit');
      A.ok(C.ITEMS[I.COOKED_PORK].food > C.ITEMS[I.RAW_PORK].food, 'cuit, il nourrit mieux');
    });

    it('SPEC-MOB-007 : les apparitions dependent du biome', function () {
      var r = seededRand(5), tires = {};
      for (var i = 0; i < 400; i++) tires[MC.Biomes.tirerMob(MC.Biomes.LISTE.desert.mobsNuit, r())] = true;
      A.ok(tires.mummy, 'la momie hante le désert la nuit');
      A.notOk(tires.zombie, 'pas de zombie ordinaire au désert');
      A.equal(MC.Biomes.tirerMob({}, 0.5), null, 'table vide : personne');
      var jour = MC.Biomes.LISTE.foret.mobsJour;
      Object.keys(jour).forEach(function (t) { A.notOk(MC.EntitySpecs[t].hostile, t + ' est pacifique le jour'); });
    });

    it('SPEC-MOB-008 : le plafond global des monstres tient pour tous les types', function () {
      var w = monde();
      var col = w.findSpawnColumn();
      var cx = Math.floor(col[0] / 16), cz = Math.floor(col[1] / 16);
      for (var a = -2; a <= 2; a++) for (var b = -2; b <= 2; b++) w.getChunk(cx + a, cz + b, true);
      var ents = MC.createEntities(w);
      var joueur = { pos: { x: col[0] + 0.5, y: w.groundAt(col[0], col[1], true) + 1, z: col[1] + 0.5 } };
      var r = seededRand(17);
      var lim = M.plafondsEntites(M.regles('survie', 'facile'));
      lim.monstres = 5;
      for (var i = 0; i < 3000; i++) ents.trySpawn(joueur, true, r, lim);
      var hostiles = ents.list.filter(function (e) { return MC.EntitySpecs[e.type].hostile; }).length;
      A.ok(hostiles <= 5, 'au plus 5 hostiles, tous types confondus (' + hostiles + ')');
      A.ok(ents.sousPlafond('pig', MC.EntitySpecs.pig, { animaux: 99 }), 'sous le plafond animal');
      A.equal(M.plafondsEntites(M.regles('survie', 'paisible')).monstres, 0, 'paisible : aucun monstre');
    });

    it('SPEC-MOB-009 : au jour les morts-vivants brulent, sauf a l abri d un donjon', function () {
      var s = scene();
      s.ents.spawn('skeleton', 0.5, 11, 0.5);
      s.ents.spawn('mummy', 2.5, 11, 0.5);
      s.ents.spawn('zombie', 4.5, 11, 0.5, { donjon: '0,0' });
      s.ents.spawn('wolf', 6.5, 11, 0.5);
      A.equal(s.ents.burnUndead(false), 2, 'squelette et momie brûlent');
      A.equal(s.ents.countOf('zombie'), 1, 'le zombie du donjon reste');
      A.equal(s.ents.countOf('wolf'), 1, 'le loup aussi');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — donjons et gardiens', function () {

    // la crypte d'origine sert de référence : les tests de géométrie la visent
    function premierDonjon(w, type) {
      var l = w.donjons.dansZone(-1500, -1500, 1500, 1500).filter(function (d) {
        return d.entree && d.type === (type || 'crypte');
      });
      return l[0];
    }
    function chargerAutour(w, p, r) {
      var cx = Math.floor(p.x / 16), cz = Math.floor(p.z / 16);
      for (var a = -r; a <= r; a++) for (var b = -r; b <= r; b++) w.getChunk(cx + a, cz + b, true);
    }

    it('SPEC-DONJON-001 : les donjons sont nombreux et ne dependent que de la graine', function () {
      var a = monde().donjons.dansZone(-1000, -1000, 1000, 1000);
      var b = MC.createWorld(GRAINE).donjons.dansZone(-1000, -1000, 1000, 1000);
      A.ok(a.length >= 20, 'au moins 20 donjons sur 2 km² (' + a.length + ')');
      A.deep(a.map(function (d) { return d.id + '@' + d.x + ',' + d.y + ',' + d.z + ':' + d.boss; }),
             b.map(function (d) { return d.id + '@' + d.x + ',' + d.y + ',' + d.z + ':' + d.boss; }),
             'même graine, mêmes donjons');
      var r = monde().donjons.deRegion(3, -2);
      A.equal(monde().donjons.deRegion(3, -2), r, 'une région est calculée une seule fois');
    });

    it('SPEC-DONJON-002 : un donjon terrestre sur la terre ferme, un donjon marin au fond de l eau', function () {
      var w = monde(), marins = 0, terrestres = 0;
      w.donjons.dansZone(-2000, -2000, 2000, 2000).forEach(function (d) {
        if (MC.Donjons.TYPES[d.type].marin) {
          marins++;
          A.ok(d.surface <= SEA - 4, d.nom + ' ' + d.id + ' : sous au moins quatre blocs d eau');
        } else {
          terrestres++;
          A.ok(d.surface >= SEA + 2, d.nom + ' ' + d.id + ' : sur la terre ferme');
        }
        A.ok(d.y >= 4, 'au-dessus du socle');
      });
      A.ok(marins > 0 && terrestres > 0, 'les deux familles existent (' + marins + ' / ' + terrestres + ')');
    });

    it('SPEC-DONJON-011 : le type de donjon depend du biome, de l altitude et de la profondeur', function () {
      var L = MC.Biomes.LISTE, T = MC.Donjons.typePour;
      A.equal(T(L.desert, 40, 0.5), 'pyramide');
      A.equal(T(L.taiga, 40, 0.5), 'forteresse_glace');
      A.equal(T(L.pics_glaces, 40, 0.5), 'forteresse_glace');
      A.equal(T(L.jungle, 40, 0.5), 'temple');
      A.equal(T(L.marais, SEA + 2, 0.5), 'hutte');
      A.equal(T(L.montagnes, 50, 0.5), 'citadelle', 'au sommet : la citadelle');
      A.equal(T(L.montagnes, 38, 0.5), 'mine', 'à mi-pente : une mine');
      A.equal(T(L.ocean, SEA - 12, 0.5), 'monument', 'grands fonds');
      A.equal(T(L.ocean, SEA - 5, 0.5), 'epave', 'hauts-fonds');
      A.equal(T(L.ocean, SEA - 2, 0.5), null, 'trop peu d eau : rien');
      A.equal(T(L.plaines, 40, 0.1), 'crypte');
      A.equal(T(L.plaines, 40, 0.9), 'mine');
      var vus = {};
      monde().donjons.dansZone(-3000, -3000, 3000, 3000).forEach(function (d) { vus[d.type] = true; });
      Object.keys(MC.Donjons.TYPES).forEach(function (t) { A.ok(vus[t], 'le type ' + t + ' existe dans le monde'); });
    });

    it('SPEC-DONJON-012 : chaque type de donjon est jouable — coffre, salle, gardien libre de ses mouvements', function () {
      var vus = {};
      monde().donjons.dansZone(-3000, -3000, 3000, 3000).forEach(function (d) {
        if (vus[d.type]) return;
        vus[d.type] = true;
        // le plan seul suffit : on indexe ses blocs, le dernier posé l'emporte
        var plan = new Map();
        d.blocs.forEach(function (b) { plan.set(b[0] + ',' + b[1] + ',' + b[2], b[3]); });
        A.equal(plan.get(d.coffre.x + ',' + d.coffre.y + ',' + d.coffre.z), B.CHEST, d.type + ' : un coffre');
        A.equal(MC.Donjons.TYPES[d.type].boss.indexOf(d.boss) >= 0, true, d.type + ' : son propre gardien');
        A.ok(d.salle && d.spawn && d.entree, d.type + ' : salle, éveil, entrée');
        var sp = MC.EntitySpecs[d.boss], r = sp.w / 2, gene = 0;
        for (var x = Math.floor(d.spawn.x - r); x <= Math.floor(d.spawn.x + r); x++)
        for (var y = Math.floor(d.spawn.y); y <= Math.floor(d.spawn.y + sp.h - 1e-6); y++)
        for (var z = Math.floor(d.spawn.z - r); z <= Math.floor(d.spawn.z + r); z++) {
          var id = plan.get(x + ',' + y + ',' + z);
          if (id && C.isSolid(id)) gene++;
        }
        A.equal(gene, 0, d.type + ' : le gardien (' + sp.w + '×' + sp.h + ') n apparaît pas dans un mur');
      });
    });

    it('SPEC-DONJON-003 : la salle est close, eclairee, et un escalier mene a la surface', function () {
      var w = monde(), d = premierDonjon(w);
      chargerAutour(w, d, 1);
      chargerAutour(w, d.entree, 1);
      var s = d.salle, vides = 0, total = 0;
      for (var x = s.x0; x <= s.x1; x++) for (var z = s.z0; z <= s.z1; z++) {
        total++;
        if (!C.isSolid(w.getBlock(x, s.y0 + 1, z))) vides++;
        A.ok(C.isSolid(w.getBlock(x, s.y0 - 1, z)), 'sol plein');
      }
      A.ok(vides >= total - 5, 'intérieur creux, piliers mis à part');
      A.equal(w.getBlock(d.coffre.x, d.coffre.y, d.coffre.z), B.CHEST, 'un coffre');
      var torches = 0;
      w.lights.forEach(function (l) { if (Math.abs(l.x - d.x) <= 6 && Math.abs(l.z - d.z) <= 6) torches++; });
      A.equal(torches, 4, 'quatre torches générées, enregistrées comme lumières');
      // l'entrée débouche à l'air libre, juste au-dessus du sol naturel
      var e = d.entree;
      A.ok(e.y > w.heightAt(e.x, e.z), 'l entrée est à la surface');
      A.notOk(C.isSolid(w.getBlock(e.x, e.y, e.z)) || C.isSolid(w.getBlock(e.x, e.y + 1, e.z)),
              'et l on y tient debout');
      var mousse = w.getChunk(Math.floor(e.x / 16), Math.floor(e.z / 16), true);
      A.ok(mousse, 'les ruines de l entrée sont posées');
    });

    it('SPEC-DONJON-003 : la salle se reconnait, le couloir non', function () {
      var w = monde(), d = premierDonjon(w);
      A.equal(w.salleDonjon(d.x + 0.5, d.y + 1.2, d.z + 0.5), d, 'au centre de la salle');
      A.equal(w.donjons.salleA(d.x + 0.5, d.y + 1.2, d.z + 0.5), d);
      A.equal(w.salleDonjon(d.entree.x, d.entree.y, d.entree.z), null, 'à l entrée, non');
      A.equal(w.salleDonjon(d.x + 0.5, d.y + 30, d.z + 0.5), null, 'au-dessus, non plus');
    });

    it('SPEC-DONJON-004 : le gardien ne s eveille qu une fois', function () {
      var w = monde(), d = premierDonjon(w);
      var ents = MC.createEntities(w);
      var b = ents.invoquerGardien(d);
      A.ok(b && MC.EntitySpecs[b.type].boss, 'un gardien apparaît');
      A.equal(b.type, d.boss, 'celui du donjon');
      A.equal(b.donjon, d.id, 'rattaché à son donjon');
      A.equal(ents.invoquerGardien(d), null, 'le rappeler tant qu il vit ne fait rien');
    });

    it('SPEC-DONJON-005 : onze gardiens, chacun sa capacite', function () {
      var S = MC.EntitySpecs;
      A.equal(MC.Donjons.BOSS.length, 11);
      A.ok(S.boss_zombie.invoque, 'le gardien putride appelle des zombies');
      A.ok(S.boss_araignee.bond && S.boss_araignee.invoque, 'la reine bondit et pond');
      A.ok(S.boss_squelette.tir && S.boss_squelette.tir.n === 3, 'le roi tire en rafale');
      A.ok(S.boss_slime.division, 'le slime colossal se divise');
      A.ok(S.boss_pharaon.invoque && S.boss_pharaon.invoque.type === 'mummy', 'le pharaon lève ses momies');
      A.ok(S.boss_yeti.tir && S.boss_yeti.tir.genre === 'neige', 'le yéti lance des boules de neige');
      A.ok(S.boss_serpent.bond && S.boss_serpent.speed >= 4, 'le serpent frappe vite');
      A.ok(S.boss_sorciere.tir.genre === 'sortilege' && S.boss_sorciere.invoque, 'la sorcière jette des sorts');
      A.ok(S.boss_wyverne.volant && S.boss_wyverne.tir.genre === 'feu', 'la wyverne vole et crache le feu');
      A.ok(S.boss_gardien_ancien.nageur && S.boss_gardien_ancien.tir.genre === 'laser', 'le gardien ancien nage');
      A.ok(S.boss_capitaine.lest && S.boss_capitaine.invoque.type === 'drowned', 'le capitaine commande ses noyés');
      var tresors = {};
      MC.Donjons.BOSS.forEach(function (t) { tresors[S[t].drops[0].id] = (tresors[S[t].drops[0].id] || 0) + 1; });
      A.ok(Object.keys(tresors).length >= 8, 'des trésors variés (' + Object.keys(tresors).length + ')');
      MC.Donjons.BOSS.forEach(function (t) {
        A.ok(S[t].nom && S[t].hp >= 60, t + ' : nommé, robuste');
      });
    });

    it('SPEC-DONJON-005 : le gardien putride invoque des renforts, dans une limite', function () {
      var s = { w: flatWorld(10, B.STONE) };
      s.ents = MC.createEntities(s.w);
      var g = s.ents.spawn('boss_zombie', 0.5, 11, 0.5, { donjon: 'x' });
      g.onGround = true;
      for (var i = 0; i < 60 * 30; i++) s.ents.update(1 / 30, { pos: { x: 12.5, y: 11, z: 0.5 } }, { rand: seededRand(i) });
      var n = s.ents.sbires(g);
      A.ok(n >= 2, 'des zombies sont apparus (' + n + ')');
      A.ok(n <= MC.EntitySpecs.boss_zombie.invoque.max, 'sans dépasser le maximum');
      A.ok(s.ents.list.every(function (e) { return e.type !== 'zombie' || e.donjon === 'x'; }),
           'les renforts appartiennent au donjon');
    });

    it('SPEC-DONJON-006 : vaincre un gardien donne l epee runique et le signale', function () {
      var s = { w: flatWorld(10, B.STONE) };
      s.ents = MC.createEntities(s.w);
      var g = s.ents.spawn('boss_squelette', 0.5, 11, 0.5, { donjon: '4,4' });
      A.ok(s.ents.damage(g, 999, { x: 0, y: 11, z: 0 }), 'le coup est fatal');
      var epee = s.ents.list.some(function (e) { return e.type === 'item' && e.item === I.EPEE_RUNIQUE; });
      A.ok(epee, 'l épée runique tombe');
      var ev = s.ents.evenements().filter(function (x) { return x.type === 'boss_vaincu'; });
      A.equal(ev.length, 1, 'un événement de victoire');
      A.equal(ev[0].type, 'boss_vaincu');
      A.equal(ev[0].donjon, '4,4', 'qui désigne le donjon');
      A.equal(s.ents.evenements().length, 0, 'et n est rendu qu une fois');
      A.ok(C.ITEMS[I.EPEE_RUNIQUE].damage > C.ITEMS[I.IRON_SWORD].damage, 'plus forte qu une épée en fer');
    });

    it('SPEC-DONJON-006 : un gardien encaisse sans etre projete', function () {
      var s = { w: flatWorld(10, B.STONE) };
      s.ents = MC.createEntities(s.w);
      var g = s.ents.spawn('boss_zombie', 0.5, 11, 0.5);
      var z = s.ents.spawn('zombie', 5.5, 11, 0.5);
      s.ents.damage(g, 1, { x: -1, y: 11, z: 0.5 });
      s.ents.damage(z, 1, { x: 4, y: 11, z: 0.5 });
      A.ok(g.vel.x < z.vel.x * 0.5, 'recul du gardien bien moindre');
    });

    it('SPEC-DONJON-007 : le slime colossal se divise en mourant', function () {
      var s = { w: flatWorld(10, B.STONE) };
      s.ents = MC.createEntities(s.w);
      var g = s.ents.spawn('boss_slime', 0.5, 11, 0.5, { donjon: 'd' });
      s.ents.damage(g, 999);
      A.equal(s.ents.countOf('slime'), MC.EntitySpecs.boss_slime.division.n, 'quatre petits slimes');
    });

    it('SPEC-DONJON-008 : chaque type de donjon a ses richesses propres', function () {
      var w = monde();
      var p = premierDonjon(w, 'pyramide'), m = premierDonjon(w, 'monument');
      A.ok(p && m, 'une pyramide et un monument existent');
      A.ok(w.donjons.butin(p).some(function (x) { return x.id === I.GOLD_INGOT; }), 'la pyramide recèle de l or');
      A.ok(w.donjons.butin(m).some(function (x) { return x.id === I.PRISMARINE_SHARD; }), 'le monument, de la prismarine');
    });

    it('SPEC-DONJON-008 : le coffre du donjon a un butin fixe par graine', function () {
      var w = monde(), d = premierDonjon(w);
      var b1 = w.butinCoffre(d.coffre.x, d.coffre.y, d.coffre.z);
      var b2 = MC.createWorld(GRAINE).butinCoffre(d.coffre.x, d.coffre.y, d.coffre.z);
      A.ok(b1 && b1.length >= 4, 'au moins quatre piles');
      A.deep(b1, b2, 'même graine, même butin');
      A.deep(w.donjons.butin(d), b1);
      A.equal(w.donjons.coffreA(d.coffre.x, d.coffre.y, d.coffre.z), d);
      A.equal(w.butinCoffre(d.coffre.x + 1, d.coffre.y, d.coffre.z), null, 'un coffre ordinaire : rien');
    });

    it('SPEC-DONJON-009 : gardiens vaincus et coffres pilles survivent a la sauvegarde', function () {
      var e = G.etatMinimal(GRAINE);
      e.world.donjonsVaincus.add('3,-2');
      e.world.coffresPilles.add('10,20,30');
      var data = JSON.parse(JSON.stringify(MC.Save.serialize(e)));
      var f = G.etatMinimal(GRAINE);
      A.ok(MC.Save.apply(data, f), 'chargement');
      A.ok(f.world.donjonsVaincus.has('3,-2'), 'le gardien reste vaincu');
      A.ok(f.world.coffresPilles.has('10,20,30'), 'le coffre reste pillé');
      f.world.reset();
      A.equal(f.world.donjonsVaincus.size + f.world.coffresPilles.size, 0, 'une nouvelle partie repart de zéro');
    });

    it('SPEC-DONJON-010 : chaque chunk pose sa part du donjon, dans n importe quel ordre', function () {
      var d = premierDonjon(monde());
      var cx = Math.floor(d.x / 16), cz = Math.floor(d.z / 16);
      var a = MC.createWorld(GRAINE), b = MC.createWorld(GRAINE);
      var ordre = [];
      for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) ordre.push([cx + i, cz + j]);
      ordre.forEach(function (p) { a.getChunk(p[0], p[1], true); });
      ordre.slice().reverse().forEach(function (p) { b.getChunk(p[0], p[1], true); });
      var diff = 0;
      ordre.forEach(function (p) {
        var ca = a.chunks.get(a.key(p[0], p[1])).blocks, cb = b.chunks.get(b.key(p[0], p[1])).blocks;
        for (var k = 0; k < ca.length; k++) if (ca[k] !== cb[k]) diff++;
      });
      A.equal(diff, 0, 'ordre de génération sans effet');
      var n = 0;
      a.donjons.appliquer(cx, cz, 16, 16, function () { n++; });
      A.ok(n > 100, 'le chunk central reçoit une grande part de la salle (' + n + ' blocs)');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
