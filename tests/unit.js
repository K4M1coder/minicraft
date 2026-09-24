/* unit.js — tests unitaires de la logique pure.
   Chaque test vise UNE propriété, avec un oracle explicite. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, P = MC.Physics, Inv = MC.Inventory, DC = MC.DayCycle;
  var B = C.B, I = C.I;

  /* Monde factice : une Map de blocs, sans génération. Isole la physique
     de la génération de terrain. */
  function flatWorld(groundY, id) {
    var m = new Map();
    var etats = new Map();
    var gy = groundY === undefined ? 10 : groundY;
    return {
      map: m,
      getBlock: function (x, y, z) {
        x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
        if (y < 0 || y >= C.WORLD_H) return 0;
        var k = x + ',' + y + ',' + z;
        if (m.has(k)) return m.get(k);
        return y <= gy ? (id === undefined ? B.STONE : id) : 0;
      },
      setBlock: function (x, y, z, b) {
        m.set(Math.floor(x) + ',' + Math.floor(y) + ',' + Math.floor(z), b); return true;
      },
      /* État par bloc (SPEC-SAVE-017, L24) : même contrat que le vrai monde —
         sans lui, poser un escalier ou une dalle lèverait une exception au
         lieu d'exercer vraiment le code testé. */
      getEtat: function (x, y, z) {
        return etats.get(Math.floor(x) + ',' + Math.floor(y) + ',' + Math.floor(z)) || 0;
      },
      setEtat: function (x, y, z, e) {
        etats.set(Math.floor(x) + ',' + Math.floor(y) + ',' + Math.floor(z), e | 0); return true;
      },
      groundAt: function (x, z, natural) {
        for (var y = C.WORLD_H - 1; y > 0; y--) {
          var b = this.getBlock(x, y, z);
          if (!C.isSolid(b)) continue;
          if (natural && (C.isLog(b) || C.isLeaves(b))) continue;
          return y;
        }
        return 0;
      },
      /* Le monde factice doit exposer la MEME interface que le vrai : sans
         hasSupport, le garde-fou des torches est silencieusement contourne et
         le test passe pour une mauvaise raison. */
      hasSupport: function (x, y, z, mode) {
        if (C.isSolid(this.getBlock(x, y - 1, z))) return true;
        if (mode === 'sol') return false;
        var lat = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var i = 0; i < lat.length; i++)
          if (C.isSolid(this.getBlock(x + lat[i][0], y, z + lat[i][1]))) return true;
        return false;
      },
      dropUnsupported: function (x, y, z) {
        var self = this, tombees = [];
        [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].forEach(function (v) {
          var bx = x + v[0], by = y + v[1], bz = z + v[2];
          var b = self.getBlock(bx, by, bz);
          var d = C.BLOCKS[b];
          if (!d || !d.needsSupport) return;
          if (!self.hasSupport(bx, by, bz, d.needsSupport)) { self.setBlock(bx, by, bz, 0); tombees.push([bx, by, bz, b]); }
        });
        return tombees;
      },
      lights: new Map(),
      overrides: new Map(), crops: new Map(), chunks: new Map(), seed: 1,
    };
  }
  G.flatWorld = flatWorld;

  // générateur pseudo-aléatoire déterministe pour les tests
  function seededRand(s) {
    var x = s || 42;
    return function () { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  }
  G.seededRand = seededRand;

  /* Stockage factice : meme contrat que localStorage, mais inspectable et
     isole entre tests. */
  function mockStorage() {
    var m = {};
    return {
      getItem: function (k) { return k in m ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
      removeItem: function (k) { delete m[k]; },
      cles: function () { return Object.keys(m); },
      _dump: m,
    };
  }
  G.mockStorage = mockStorage;

  /* Etat de partie minimal, tel que l'attendent Save et Saves. */
  function etatMinimal(graine, modeId, diffId) {
    var w = MC.createWorld(graine === undefined ? 1234 : graine);
    w.getChunk(0, 0, true);
    var ents = MC.createEntities(w);
    var regles = MC.Modes.regles(modeId || 'survie', diffId || 'facile');
    var pl = MC.createPlayer(w, ents, regles);
    return { world: w, player: pl, entities: ents, time: 0,
             furnaces: {}, chests: {}, regles: regles, duree: 0 };
  }
  G.etatMinimal = etatMinimal;

  // ══════════════════════════════════════════════════════════════════════════
  describe('Core — définitions de blocs et d\'objets', function () {
    it('l\'espace d\'ids sépare bien blocs et objets', function () {
      A.ok(C.isBlock(B.STONE), 'la pierre est un bloc');
      A.notOk(C.isItem(B.STONE), 'la pierre n\'est pas un objet');
      A.ok(C.isItem(I.STICK), 'le bâton est un objet');
      A.notOk(C.isBlock(I.STICK), 'le bâton n\'est pas un bloc');
      A.notOk(C.isBlock(0), 'l\'air n\'est pas un bloc posable');
    });

    it('tout bloc défini a un nom et 3 tuiles', function () {
      for (var id = 1; id < C.FIRST_ITEM; id++) {
        var d = C.BLOCKS[id];
        if (!d) continue;
        A.ok(!!d.name, 'bloc ' + id + ' a un nom');
        A.equal(d.tiles.length, 3, 'bloc ' + d.name + ' a 3 tuiles');
      }
    });

    it('tout objet défini a un nom et une tuile', function () {
      for (var id = C.FIRST_ITEM; id < 100; id++) {
        var d = C.ITEMS[id];
        if (!d) continue;
        A.ok(!!d.name, 'objet ' + id + ' a un nom');
        A.ok(typeof d.tile === 'number', 'objet ' + d.name + ' a une tuile');
      }
    });

    it('la solidité distingue liquides et plantes', function () {
      A.ok(C.isSolid(B.STONE), 'pierre solide');
      A.notOk(C.isSolid(B.WATER), 'eau non solide');
      A.notOk(C.isSolid(B.WHEAT3), 'blé non solide');
      A.notOk(C.isSolid(0), 'air non solide');
    });

    it('un bloc remplaçable est l\'air, un liquide ou une plante', function () {
      A.ok(C.isReplaceable(0));
      A.ok(C.isReplaceable(B.WATER));
      A.ok(C.isReplaceable(B.WHEAT0));
      A.notOk(C.isReplaceable(B.STONE));
    });

    it('l\'occlusion cache les faces opaques mais pas celles des plantes', function () {
      A.ok(C.occludes(B.STONE, B.DIRT), 'terre opaque cache la pierre');
      A.notOk(C.occludes(B.STONE, 0), 'l\'air ne cache rien');
      A.notOk(C.occludes(B.STONE, B.WATER), 'l\'eau ne cache pas un bloc opaque');
      A.ok(C.occludes(B.GLASS, B.GLASS), 'verre contre verre : face interne cachée');
      A.notOk(C.occludes(B.GLASS, B.WATER), 'verre contre eau : face visible');
      A.notOk(C.occludes(B.STONE, B.WHEAT0), 'une plante ne cache pas');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Core — minage', function () {
    it('le bon outil accélère, le mauvais non', function () {
      var main = C.breakTime(B.STONE, 0).seconds;
      var bois = C.breakTime(B.STONE, I.WOOD_PICKAXE).seconds;
      var pierre = C.breakTime(B.STONE, I.STONE_PICKAXE).seconds;
      var fer = C.breakTime(B.STONE, I.IRON_PICKAXE).seconds;
      A.ok(bois < main, 'pioche bois plus rapide que la main');
      A.ok(pierre < bois, 'pioche pierre plus rapide que bois');
      A.ok(fer < pierre, 'pioche fer plus rapide que pierre');
      var pelle = C.breakTime(B.STONE, I.IRON_SHOVEL).seconds;
      A.equal(pelle, main, 'une pelle ne sert à rien sur la pierre');
    });

    it('la pierre à main nue casse mais ne donne rien', function () {
      A.notOk(C.breakTime(B.STONE, 0).harvests, 'sans pioche : aucun drop');
      A.ok(C.breakTime(B.STONE, I.WOOD_PICKAXE).harvests, 'avec pioche : drop');
    });

    it('le minerai de fer exige au moins une pioche en pierre', function () {
      A.notOk(C.breakTime(B.IRON_ORE, I.WOOD_PICKAXE).harvests, 'bois insuffisant');
      A.ok(C.breakTime(B.IRON_ORE, I.STONE_PICKAXE).harvests, 'pierre suffit');
      A.ok(C.breakTime(B.IRON_ORE, I.IRON_PICKAXE).harvests, 'fer suffit');
    });

    it('le socle et l\'eau sont incassables', function () {
      A.equal(C.breakTime(B.BEDROCK, I.IRON_PICKAXE).seconds, Infinity, 'socle');
      A.equal(C.breakTime(B.WATER, I.IRON_PICKAXE).seconds, Infinity, 'eau');
    });

    it('les plantes cassent instantanément', function () {
      A.equal(C.breakTime(B.WHEAT3, 0).seconds, 0);
    });

    it('la pierre lâche du pavé, pas de la pierre', function () {
      var d = C.dropsOf(B.STONE, true, function () { return 0; });
      A.equal(d.length, 1);
      A.equal(d[0].id, B.COBBLE, 'drop = pavé');
    });

    it('les drops aléatoires respectent leur probabilité', function () {
      // rand=0 => tout passe ; rand=0.99 => seuls les drops certains passent
      var tout = C.dropsOf(B.GRASS, true, function () { return 0; });
      var certain = C.dropsOf(B.GRASS, true, function () { return 0.99; });
      A.equal(tout.length, 2, 'terre + graines');
      A.equal(certain.length, 1, 'terre seulement');
      A.equal(certain[0].id, B.DIRT);
    });

    it('le blé mûr donne blé et graines, le blé jeune que des graines', function () {
      var mur = C.dropsOf(B.WHEAT3, true, function () { return 0; });
      var jeune = C.dropsOf(B.WHEAT0, true, function () { return 0; });
      A.ok(mur.some(function (d) { return d.id === I.WHEAT; }), 'blé mûr donne du blé');
      A.ok(jeune.every(function (d) { return d.id === I.SEEDS; }), 'blé jeune : graines seules');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Bruit — déterminisme', function () {
    it('deux instances de même graine donnent la même valeur', function () {
      var a = MC.makeNoise(1234), b = MC.makeNoise(1234);
      for (var i = 0; i < 20; i++) {
        var x = i * 13.7, z = i * -7.3;
        A.equal(a.fbm(x, z, 4, 2, 0.5), b.fbm(x, z, 4, 2, 0.5), 'fbm reproductible');
      }
    });
    it('des graines différentes donnent des valeurs différentes', function () {
      var a = MC.makeNoise(1), b = MC.makeNoise(2);
      var diff = 0;
      for (var i = 0; i < 50; i++) if (a.hash2(i, i) !== b.hash2(i, i)) diff++;
      A.ok(diff > 45, 'les graines divergent (' + diff + '/50)');
    });
    it('le bruit reste dans [0,1]', function () {
      var n = MC.makeNoise(7);
      for (var i = 0; i < 500; i++) {
        var v = n.fbm(i * 0.37, i * -0.19, 4, 2, 0.5);
        A.between(v, 0, 1, 'fbm borné');
      }
    });
    it('signed() recentre bien en [-1,1]', function () {
      A.close(MC.makeNoise(1).signed(0.5), 0, 1e-9);
      A.close(MC.makeNoise(1).signed(1), 1, 1e-9);
      A.close(MC.makeNoise(1).signed(0), -1, 1e-9);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Monde — génération', function () {
    var w = MC.createWorld(20260921);

    it('le relief traverse le niveau de la mer', function () {
      var min = 1e9, max = -1e9, sous = 0, n = 0;
      for (var x = -400; x <= 400; x += 11) for (var z = -400; z <= 400; z += 11) {
        var h = w.heightAt(x, z); n++;
        if (h < min) min = h; if (h > max) max = h;
        if (h < C.SEA_LEVEL) sous++;
      }
      A.ok(min < C.SEA_LEVEL, 'des creux sous la mer (min=' + min + ')');
      A.ok(max > C.SEA_LEVEL + 10, 'des reliefs (max=' + max + ')');
      var pct = 100 * sous / n;
      A.between(pct, 5, 70, 'proportion immergée plausible (' + pct.toFixed(1) + '%)');
    });

    it('heightAt est pure : aucun chunk requis', function () {
      var vierge = MC.createWorld(55);
      A.equal(vierge.chunks.size, 0, 'aucun chunk chargé');
      var h = vierge.heightAt(1234, -987);
      A.ok(isFinite(h), 'hauteur calculable sans chunk');
    });

    it('un chunk généré a un socle en y=0 et de l\'air en haut', function () {
      var c = w.getChunk(0, 0, true);
      A.equal(c.blocks[C.idx(0, 0, 0)], B.BEDROCK, 'socle en y=0');
      A.equal(c.blocks[C.idx(0, C.WORLD_H - 1, 0)], 0, 'air tout en haut');
    });

    it('la colonne est cohérente : surface, sous-sol, pierre', function () {
      w.getChunk(0, 0, true);
      var h = w.groundAt(8, 8, true);
      var surf = w.getBlock(8, h, 8);
      // selon le biome : herbe, sable, neige, gravier du fond marin, mycélium…
      A.ok(C.isSolid(surf) && surf !== B.BEDROCK && !C.isLog(surf) && !C.isLeaves(surf),
           'surface naturelle pleine, obtenu ' + C.nameOf(surf));
      A.equal(w.getBlock(8, 0, 8), B.BEDROCK, 'socle');
      // juste sous la surface c'est forcement plein : les grottes gardent une
      // marge sous le sol pour ne pas ouvrir de trou beant au milieu du paysage
      A.ok(C.isSolid(w.getBlock(8, h - 1, 8)), 'juste sous la surface : plein');
      A.ok(C.isSolid(w.getBlock(8, h - 2, 8)), 'deux blocs sous la surface : plein');
    });

    it('de l\'eau est générée jusqu\'au niveau de la mer', function () {
      var w2 = MC.createWorld(20260921);
      var trouve = false;
      for (var cx = -3; cx <= 3 && !trouve; cx++) for (var cz = -3; cz <= 3; cz++) {
        var c = w2.getChunk(cx, cz, true);
        for (var i = 0; i < c.blocks.length; i++) if (c.blocks[i] === B.WATER) { trouve = true; break; }
        if (trouve) break;
      }
      A.ok(trouve, 'de l\'eau existe dans le voisinage');
    });

    it('des minerais sont générés dans la pierre', function () {
      var w3 = MC.createWorld(20260921);
      var charbon = 0, fer = 0;
      for (var cx = -2; cx <= 2; cx++) for (var cz = -2; cz <= 2; cz++) {
        var c = w3.getChunk(cx, cz, true);
        for (var i = 0; i < c.blocks.length; i++) {
          if (c.blocks[i] === B.COAL_ORE) charbon++;
          else if (c.blocks[i] === B.IRON_ORE) fer++;
        }
      }
      A.ok(charbon > 0, 'du charbon (' + charbon + ')');
      A.ok(fer > 0, 'du fer (' + fer + ')');
      A.ok(charbon > fer, 'le charbon est plus courant que le fer');
    });

    it('des arbres sont générés et reposent sur le sol', function () {
      var w4 = MC.createWorld(20260921);
      var troncs = 0;
      // les régions climatiques étant désormais vastes (SPEC-BIOME-006/007), les environs
      // immédiats de l'origine peuvent tomber en mer : un rayon plus large reste nécessaire
      // pour croiser à coup sûr une forêt ou une plaine.
      for (var cx = -6; cx <= 6; cx++) for (var cz = -6; cz <= 6; cz++) {
        var c = w4.getChunk(cx, cz, true);
        for (var i = 0; i < c.blocks.length; i++) if (c.blocks[i] === B.LOG) troncs++;
      }
      A.ok(troncs > 0, 'au moins un tronc (' + troncs + ')');
    });

    it('des grottes sont creusees en profondeur', function () {
      var w5 = MC.createWorld(20260921);
      var vides = 0, total = 0;
      for (var cx = -2; cx <= 2; cx++) for (var cz = -2; cz <= 2; cz++) {
        var c = w5.getChunk(cx, cz, true);
        for (var x = 0; x < C.CHUNK_X; x++) for (var z = 0; z < C.CHUNK_Z; z++) {
          var h = w5.heightAt(cx * C.CHUNK_X + x, cz * C.CHUNK_Z + z);
          for (var y = 3; y < Math.min(h - 6, 24); y++) {
            total++;
            if (c.blocks[C.idx(x, y, z)] === 0) vides++;
          }
        }
      }
      A.ok(total > 0, 'des colonnes profondes existent');
      var pct = 100 * vides / total;
      A.between(pct, 1, 40, 'proportion creusee plausible (' + pct.toFixed(1) + '%)');
    });

    it('aucune grotte ne perce le fond de l ocean', function () {
      var w6 = MC.createWorld(20260921);
      for (var x = -120; x <= 120; x += 3) for (var z = -120; z <= 120; z += 3) {
        var h = w6.heightAt(x, z);
        for (var y = C.SEA_LEVEL - 2; y <= C.SEA_LEVEL + 2; y++) {
          A.notOk(w6.isCave(x, y, z, h),
            'pas de grotte au niveau de la mer en ' + x + ',' + y + ',' + z);
        }
      }
    });

    it('les grottes ne touchent pas la surface', function () {
      var w7 = MC.createWorld(777);
      for (var x = -80; x <= 80; x += 7) for (var z = -80; z <= 80; z += 7) {
        var h = w7.heightAt(x, z);
        for (var d = 0; d < 5; d++) {
          A.notOk(w7.isCave(x, h - d, z, h), 'marge sous la surface respectee');
        }
      }
    });

    it('le socle en y=0 n est jamais creuse', function () {
      var w8 = MC.createWorld(20260921);
      for (var cx = -2; cx <= 2; cx++) for (var cz = -2; cz <= 2; cz++) {
        var c = w8.getChunk(cx, cz, true);
        for (var x = 0; x < C.CHUNK_X; x++) for (var z = 0; z < C.CHUNK_Z; z++) {
          A.equal(c.blocks[C.idx(x, 0, z)], B.BEDROCK, 'socle intact');
        }
      }
    });

    it('le fer est plus profond que le charbon', function () {
      var w9 = MC.createWorld(20260921);
      var sommeFer = 0, nFer = 0, sommeCharbon = 0, nCharbon = 0;
      for (var cx = -2; cx <= 2; cx++) for (var cz = -2; cz <= 2; cz++) {
        var c = w9.getChunk(cx, cz, true);
        for (var y = 0; y < C.WORLD_H; y++)
        for (var z = 0; z < C.CHUNK_Z; z++)
        for (var x = 0; x < C.CHUNK_X; x++) {
          var b = c.blocks[C.idx(x, y, z)];
          if (b === B.IRON_ORE) { sommeFer += y; nFer++; }
          else if (b === B.COAL_ORE) { sommeCharbon += y; nCharbon++; }
        }
      }
      A.ok(nFer > 0 && nCharbon > 0, 'les deux minerais existent');
      A.ok(sommeFer / nFer < sommeCharbon / nCharbon,
        'fer en moyenne plus bas (' + (sommeFer/nFer).toFixed(1) + ' vs ' +
        (sommeCharbon/nCharbon).toFixed(1) + ')');
    });

    it('le spawn choisi est au sec', function () {
      var col = w.findSpawnColumn();
      A.ok(w.heightAt(col[0], col[1]) >= C.SEA_LEVEL + 3,
        'colonne de spawn au-dessus de la mer');
    });

    it('la même graine régénère exactement le même chunk', function () {
      var a = MC.createWorld(999).getChunk(2, -3, true);
      var b = MC.createWorld(999).getChunk(2, -3, true);
      var diff = 0;
      for (var i = 0; i < a.blocks.length; i++) if (a.blocks[i] !== b.blocks[i]) diff++;
      A.equal(diff, 0, 'chunks identiques');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Monde — lecture et écriture', function () {
    it('setBlock puis getBlock rendent la même valeur', function () {
      var w = MC.createWorld(5);
      w.getChunk(0, 0, true);
      A.ok(w.setBlock(3, 40, 4, B.BRICK), 'écriture acceptée');
      A.equal(w.getBlock(3, 40, 4), B.BRICK);
    });

    it('les coordonnées négatives tombent dans le bon chunk', function () {
      var w = MC.createWorld(5);
      w.getChunk(-1, -1, true);
      w.setBlock(-1, 40, -1, B.BRICK);
      A.equal(w.getBlock(-1, 40, -1), B.BRICK, 'écriture en négatif');
      // -1 doit être la dernière case du chunk -1
      var c = w.chunks.get('-1,-1');
      A.equal(c.blocks[C.idx(15, 40, 15)], B.BRICK, 'index local correct');
    });

    it('écrire hors des bornes verticales est refusé', function () {
      var w = MC.createWorld(5);
      w.getChunk(0, 0, true);
      A.notOk(w.setBlock(1, -1, 1, B.BRICK), 'sous le monde');
      A.notOk(w.setBlock(1, C.WORLD_H, 1, B.BRICK), 'au-dessus du monde');
    });

    it('toucher une bordure marque le chunk voisin à remailler', function () {
      var w = MC.createWorld(5);
      w.getChunk(0, 0, true);
      var n = w.getChunk(-1, 0, true);
      n.dirty = false;
      w.setBlock(0, 40, 5, B.BRICK);        // x local 0 => bordure ouest
      A.ok(n.dirty, 'le voisin ouest est marqué');
    });

    it('une modification survit au déchargement du chunk', function () {
      var w = MC.createWorld(5);
      w.getChunk(0, 0, true);
      w.setBlock(5, 45, 5, B.BRICK);
      w.chunks.delete('0,0');                // simule un déchargement
      w.getChunk(0, 0, true);                // régénération
      A.equal(w.getBlock(5, 45, 5), B.BRICK, 'la modification est réappliquée');
    });

    it('groundAt(natural) ignore troncs et feuilles', function () {
      var w = MC.createWorld(5);
      w.getChunk(0, 0, true);
      var g = w.groundAt(8, 8, true);
      w.setBlock(8, g + 1, 8, B.LOG);
      w.setBlock(8, g + 2, 8, B.LEAVES);
      A.equal(w.groundAt(8, 8, true), g, 'le sol naturel est inchangé');
      A.equal(w.groundAt(8, 8, false), g + 2, 'le sol brut inclut l\'arbre');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Monde — croissance des cultures', function () {
    function champ() {
      var w = MC.createWorld(5);
      w.getChunk(0, 0, true);
      var g = w.groundAt(8, 8, true);
      w.setBlock(8, g, 8, B.FARMLAND);
      w.setBlock(8, g + 1, 8, B.WHEAT0);
      return { w: w, x: 8, y: g + 1, z: 8 };
    }

    it('planter enregistre la culture', function () {
      var f = champ();
      A.equal(f.w.crops.size, 1, 'une culture suivie');
    });

    it('la culture progresse d\'un stade par palier', function () {
      var f = champ();
      f.w.tick(20, 14, function () { return 0; });   // rand=0 => pousse
      A.equal(f.w.getBlock(f.x, f.y, f.z), B.WHEAT1, 'stade 1');
      f.w.tick(20, 14, function () { return 0; });
      A.equal(f.w.getBlock(f.x, f.y, f.z), B.WHEAT2, 'stade 2');
      f.w.tick(20, 14, function () { return 0; });
      A.equal(f.w.getBlock(f.x, f.y, f.z), B.WHEAT3, 'stade 3 : mûr');
    });

    it('le blé mûr ne pousse plus', function () {
      var f = champ();
      for (var i = 0; i < 10; i++) f.w.tick(20, 14, function () { return 0; });
      A.equal(f.w.getBlock(f.x, f.y, f.z), B.WHEAT3, 'reste mûr');
      A.equal(f.w.crops.size, 0, 'retiré du registre une fois mûr');
    });

    it('sans terre labourée dessous, rien ne pousse', function () {
      var f = champ();
      f.w.setBlock(f.x, f.y - 1, f.z, B.DIRT);       // plus de terre labourée
      for (var i = 0; i < 6; i++) f.w.tick(20, 14, function () { return 0; });
      A.equal(f.w.getBlock(f.x, f.y, f.z), B.WHEAT0, 'toujours au stade 0');
    });

    it('avant le palier de temps, rien ne bouge', function () {
      var f = champ();
      f.w.tick(5, 14, function () { return 0; });
      A.equal(f.w.getBlock(f.x, f.y, f.z), B.WHEAT0, 'pas encore');
    });

    it('casser la culture la retire du registre', function () {
      var f = champ();
      f.w.setBlock(f.x, f.y, f.z, 0);
      A.equal(f.w.crops.size, 0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Physique — orientation des déplacements (régression)', function () {
    /* Le vecteur avant de la caméra, par définition de la convention Three.js :
       la caméra regarde -Z, tourné de `yaw` autour de Y. */
    function camForward(yaw) { return { x: -Math.sin(yaw), z: -Math.cos(yaw) }; }
    function angleBetween(a, b) {
      var d = a.x * b.x + a.z * b.z;
      return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
    }

    it('avancer suit exactement le regard, à toutes les orientations', function () {
      for (var deg = 0; deg < 360; deg += 5) {
        var yaw = deg * Math.PI / 180;
        var w = P.wishDirection(yaw, 1, 0);
        A.close(angleBetween(w, camForward(yaw)), 0, 1e-6,
          'yaw ' + deg + '° : avancer aligné sur le regard');
      }
    });

    it('reculer est exactement à l\'opposé du regard', function () {
      for (var deg = 0; deg < 360; deg += 15) {
        var yaw = deg * Math.PI / 180;
        var f = camForward(yaw);
        var w = P.wishDirection(yaw, -1, 0);
        A.close(angleBetween(w, { x: -f.x, z: -f.z }), 0, 1e-6, 'yaw ' + deg + '°');
      }
    });

    it('le pas de côté droit est à 90° horaire du regard', function () {
      for (var deg = 0; deg < 360; deg += 15) {
        var yaw = deg * Math.PI / 180;
        var f = camForward(yaw);
        var droite = { x: -f.z, z: f.x };
        A.close(angleBetween(P.wishDirection(yaw, 0, 1), droite), 0, 1e-6, 'yaw ' + deg + '°');
      }
    });

    it('le pas de côté gauche est l\'opposé du droit', function () {
      for (var deg = 0; deg < 360; deg += 30) {
        var yaw = deg * Math.PI / 180;
        var d = P.wishDirection(yaw, 0, 1), g = P.wishDirection(yaw, 0, -1);
        A.close(d.x + g.x, 0, 1e-9, 'x opposés');
        A.close(d.z + g.z, 0, 1e-9, 'z opposés');
      }
    });

    it('à yaw=0 on avance vers -Z (et surtout pas +Z)', function () {
      var w = P.wishDirection(0, 1, 0);
      A.close(w.x, 0, 1e-9, 'pas de dérive en X');
      A.close(w.z, -1, 1e-9, 'vers -Z : c\'est le sens du regard');
    });

    it('à yaw=90° on avance vers -X', function () {
      var w = P.wishDirection(Math.PI / 2, 1, 0);
      A.close(w.x, -1, 1e-9);
      A.close(w.z, 0, 1e-9);
    });

    it('la diagonale n\'est pas plus rapide', function () {
      for (var deg = 0; deg < 360; deg += 30) {
        var yaw = deg * Math.PI / 180;
        var d = P.wishDirection(yaw, 1, 1);
        A.close(Math.hypot(d.x, d.z), 1, 1e-9, 'norme unitaire à ' + deg + '°');
      }
    });

    it('sans touche, la direction est nulle', function () {
      var w = P.wishDirection(1.234, 0, 0);
      A.equal(w.x, 0); A.equal(w.z, 0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Physique — collisions', function () {
    it('un corps dans la pierre collisionne, dans l\'air non', function () {
      var w = flatWorld(10);
      A.ok(P.collides(w, 0.5, 5, 0.5, 0.6, 1.8), 'enfoui');
      A.notOk(P.collides(w, 0.5, 11, 0.5, 0.6, 1.8), 'au-dessus du sol');
    });

    it('l\'eau et les plantes ne bloquent pas', function () {
      var w = flatWorld(10, B.WATER);
      A.notOk(P.collides(w, 0.5, 5, 0.5, 0.6, 1.8), 'l\'eau ne bloque pas');
      var w2 = flatWorld(10, B.WHEAT3);
      A.notOk(P.collides(w2, 0.5, 5, 0.5, 0.6, 1.8), 'le blé ne bloque pas');
    });

    it('un axe bloqué n\'empêche pas de glisser sur l\'autre', function () {
      var w = flatWorld(10);
      w.setBlock(2, 11, 0, B.STONE);            // mur à l'est
      var body = { pos: { x: 1.5, y: 11, z: 0.5 }, vel: { x: 5, z: 5, y: 0 } };
      P.moveAxis(w, body, 'x', 1.0, 0.6, 1.8);  // doit buter
      A.close(body.pos.x, 1.5, 1e-9, 'X bloqué');
      A.equal(body.vel.x, 0, 'vitesse X annulée');
      P.moveAxis(w, body, 'z', 1.0, 0.6, 1.8);  // doit passer
      A.close(body.pos.z, 1.5, 1e-9, 'Z libre : on glisse le long du mur');
      A.equal(body.vel.z, 5, 'vitesse Z intacte');
    });

    it('un corps qui tombe atterrit exactement sur le sol', function () {
      var w = flatWorld(10);
      var body = { pos: { x: 0.5, y: 20, z: 0.5 }, vel: { x: 0, y: 0, z: 0 } };
      for (var i = 0; i < 600; i++) {
        body.vel.y -= 30 / 60;
        P.move(w, body, 1 / 60, 0.6, 1.8);
      }
      A.close(body.pos.y, 11, 0.02, 'repose sur le bloc y=10');
      A.equal(body.vel.y, 0, 'vitesse verticale annulée');
    });

    it('move() signale l\'atterrissage et le coup de tête', function () {
      var w = flatWorld(10);
      var body = { pos: { x: 0.5, y: 11.5, z: 0.5 }, vel: { x: 0, y: -10, z: 0 } };
      var r = P.move(w, body, 0.1, 0.6, 1.8);
      A.ok(r.landed, 'atterrissage détecté');

      w.setBlock(0, 14, 0, B.STONE);
      var b2 = { pos: { x: 0.5, y: 11, z: 0.5 }, vel: { x: 0, y: 10, z: 0 } };
      var r2 = P.move(w, b2, 0.2, 0.6, 1.8);
      A.ok(r2.bumpedHead, 'plafond détecté');
    });

    it('inWater teste le torse, pas les pieds', function () {
      var w = flatWorld(-1, 0);                    // tout air
      w.setBlock(0, 10, 0, B.WATER);               // une seule couche d'eau
      var pos = { x: 0.5, y: 10, z: 0.5 };
      A.notOk(P.inWater(w, pos, 1.8), 'pieds dans une flaque : on ne nage pas');
      w.setBlock(0, 11, 0, B.WATER);
      A.ok(P.inWater(w, pos, 1.8), 'torse immergé : on nage');
    });

    it('approach() est indépendant du framerate', function () {
      var a = 0, b = 0;
      for (var i = 0; i < 120; i++) a = P.approach(a, 10, 5, 1 / 120);
      for (var j = 0; j < 30; j++) b = P.approach(b, 10, 5, 1 / 30);
      A.close(a, b, 1e-6, 'même résultat à 120 et 30 fps');
    });

    it('boxOverlap détecte le chevauchement', function () {
      A.ok(P.boxOverlap(0, 0, 0, 1, 1, 0.4, 0.4, 0.4, 1, 1), 'boîtes superposées');
      A.notOk(P.boxOverlap(0, 0, 0, 1, 1, 3, 0, 0, 1, 1), 'boîtes éloignées');
      A.notOk(P.boxOverlap(0, 0, 0, 1, 1, 0, 5, 0, 1, 1), 'décalées en hauteur');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Physique — raycast DDA', function () {
    it('vise le bloc sous soi en regardant vers le bas', function () {
      var w = flatWorld(10);
      var hit = P.raycast(w, { x: 0.5, y: 12, z: 0.5 }, { x: 0, y: -1, z: 0 }, 6);
      A.ok(hit, 'touche quelque chose');
      A.equal(hit.y, 10, 'le bloc le plus haut');
      A.deep([hit.nx, hit.ny, hit.nz], [0, 1, 0], 'normale vers le haut');
    });

    it('renvoie null au-delà de la portée', function () {
      var w = flatWorld(0, 0);
      w.setBlock(0, 0, 0, B.STONE);
      var hit = P.raycast(w, { x: 0.5, y: 50, z: 0.5 }, { x: 0, y: -1, z: 0 }, 6);
      A.equal(hit, null, 'trop loin');
    });

    it('la normale pointe vers la face touchée', function () {
      var w = flatWorld(-1, 0);
      w.setBlock(5, 10, 0, B.STONE);
      var hit = P.raycast(w, { x: 0.5, y: 10.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 10);
      A.ok(hit, 'touché');
      A.equal(hit.x, 5);
      A.deep([hit.nx, hit.ny, hit.nz], [-1, 0, 0], 'face ouest');
    });

    it('traverse l\'eau et s\'arrête sur le solide', function () {
      var w = flatWorld(-1, 0);
      for (var y = 5; y < 12; y++) w.setBlock(0, y, 0, B.WATER);
      w.setBlock(0, 4, 0, B.STONE);
      var hit = P.raycast(w, { x: 0.5, y: 14, z: 0.5 }, { x: 0, y: -1, z: 0 }, 20,
        function (id) { return id !== 0 && !C.BLOCKS[id].liquid; });
      A.ok(hit, 'touché');
      A.equal(hit.y, 4, 'traverse l\'eau, s\'arrête sur la pierre');
    });

    it('un rayon en diagonale touche le bon voxel', function () {
      var w = flatWorld(-1, 0);
      w.setBlock(3, 3, 3, B.STONE);
      var d = { x: 1, y: 1, z: 1 };
      var n = Math.hypot(d.x, d.y, d.z);
      d.x /= n; d.y /= n; d.z /= n;
      var hit = P.raycast(w, { x: 0.5, y: 0.5, z: 0.5 }, d, 20);
      A.ok(hit, 'touché');
      A.deep([hit.x, hit.y, hit.z], [3, 3, 3], 'le bon voxel');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Inventaire — piles', function () {
    it('ajouter remplit une case vide', function () {
      var inv = Inv.create(9);
      A.equal(inv.add(B.STONE, 10), 0, 'aucun reliquat');
      A.equal(inv.slots[0].id, B.STONE);
      A.equal(inv.slots[0].n, 10);
    });

    it('ajouter complète une pile existante avant d\'en ouvrir une autre', function () {
      var inv = Inv.create(9);
      inv.add(B.STONE, 30);
      inv.add(B.STONE, 20);
      A.equal(inv.slots[0].n, 50, 'tout dans la même pile');
      A.equal(inv.slots[1], null, 'pas de deuxième pile');
    });

    it('une pile déborde à 64 sur la case suivante', function () {
      var inv = Inv.create(9);
      inv.add(B.STONE, 100);
      A.equal(inv.slots[0].n, 64);
      A.equal(inv.slots[1].n, 36);
      A.equal(inv.count(B.STONE), 100, 'total conservé');
    });

    it('un inventaire plein renvoie le reliquat', function () {
      var inv = Inv.create(2);
      var reste = inv.add(B.STONE, 200);
      A.equal(reste, 200 - 128, 'reliquat = ce qui ne rentre pas');
      A.equal(inv.count(B.STONE), 128);
    });

    it('les outils ne s\'empilent pas', function () {
      var inv = Inv.create(9);
      inv.add(I.WOOD_PICKAXE, 3);
      A.equal(inv.slots[0].n, 1, 'une pioche par case');
      A.equal(inv.slots[1].n, 1);
      A.equal(inv.slots[2].n, 1);
    });

    it('retirer traverse plusieurs piles', function () {
      var inv = Inv.create(9);
      inv.add(B.STONE, 100);
      A.equal(inv.remove(B.STONE, 80), 80, '80 retirés');
      A.equal(inv.count(B.STONE), 20);
    });

    it('retirer plus que disponible retire tout et le signale', function () {
      var inv = Inv.create(9);
      inv.add(B.STONE, 5);
      A.equal(inv.remove(B.STONE, 50), 5, 'seulement 5 disponibles');
      A.equal(inv.count(B.STONE), 0);
      A.ok(inv.isEmpty(), 'inventaire vidé');
    });

    it('consumeAt vide la case quand la pile tombe à zéro', function () {
      var inv = Inv.create(9);
      inv.add(I.BREAD, 1);
      inv.consumeAt(0, 1);
      A.equal(inv.slots[0], null, 'case libérée');
    });

    it('sérialiser puis recharger conserve l\'inventaire', function () {
      var inv = Inv.create(9);
      inv.add(B.STONE, 30); inv.add(I.WOOD_PICKAXE, 1); inv.add(I.BREAD, 4);
      var data = inv.serialize();
      var inv2 = Inv.create(9);
      inv2.load(data);
      A.deep(inv2.serialize(), data, 'aller-retour fidèle');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Craft — reconnaissance des recettes', function () {
    function grid3(cells) { var g = new Array(9).fill(0); cells.forEach(function (c) { g[c[0]] = c[1]; }); return g; }

    it('recette informe : 1 tronc -> 4 planches', function () {
      var r = Inv.matchRecipe(grid3([[4, B.LOG]]), 3, 3);
      A.ok(r, 'reconnue');
      A.equal(r.id, B.PLANKS); A.equal(r.n, 4);
    });

    it('une recette informe ignore la position', function () {
      var a = Inv.matchRecipe(grid3([[0, B.LOG]]), 3, 3);
      var b = Inv.matchRecipe(grid3([[8, B.LOG]]), 3, 3);
      A.deep(a, b, 'même résultat où qu\'on place le tronc');
    });

    it('recette façonnée : 2 planches verticales -> 4 bâtons', function () {
      var r = Inv.matchRecipe(grid3([[0, B.PLANKS], [3, B.PLANKS]]), 3, 3);
      A.ok(r, 'reconnue'); A.equal(r.id, I.STICK); A.equal(r.n, 4);
    });

    it('une recette façonnée est reconnue où qu\'elle soit dans la grille', function () {
      var hautGauche = Inv.matchRecipe(grid3([[0, B.PLANKS], [3, B.PLANKS]]), 3, 3);
      var basDroite = Inv.matchRecipe(grid3([[5, B.PLANKS], [8, B.PLANKS]]), 3, 3);
      A.deep(basDroite, hautGauche, 'le recadrage rend la position indifférente');
    });

    it('une forme horizontale n\'est pas une forme verticale', function () {
      // 2 planches côte à côte : ce n'est pas la recette des bâtons
      var r = Inv.matchRecipe(grid3([[0, B.PLANKS], [1, B.PLANKS]]), 3, 3);
      A.equal(r, null, 'orientation respectée');
    });

    it('établi : 2x2 planches', function () {
      var r = Inv.matchRecipe(grid3([[0, B.PLANKS], [1, B.PLANKS], [3, B.PLANKS], [4, B.PLANKS]]), 3, 3);
      A.ok(r); A.equal(r.id, B.CRAFTING_TABLE);
    });

    it('fourneau : 8 pavés en anneau', function () {
      var g = new Array(9).fill(B.COBBLE); g[4] = 0;
      var r = Inv.matchRecipe(g, 3, 3);
      A.ok(r, 'reconnue'); A.equal(r.id, B.FURNACE);
    });

    it('le fourneau ne rentre pas dans une grille 2x2', function () {
      var g = new Array(4).fill(B.COBBLE);
      var r = Inv.matchRecipe(g, 2, 2);
      A.notEqual(r && r.id, B.FURNACE, 'trop grand pour 2x2');
    });

    it('pioche en bois : 3 planches + 2 bâtons', function () {
      var g = grid3([[0, B.PLANKS], [1, B.PLANKS], [2, B.PLANKS], [4, I.STICK], [7, I.STICK]]);
      var r = Inv.matchRecipe(g, 3, 3);
      A.ok(r, 'reconnue'); A.equal(r.id, I.WOOD_PICKAXE);
    });

    it('les trois matériaux donnent les trois paliers de pioche', function () {
      [[B.PLANKS, I.WOOD_PICKAXE], [B.COBBLE, I.STONE_PICKAXE], [I.IRON_INGOT, I.IRON_PICKAXE]]
        .forEach(function (p) {
          var g = grid3([[0, p[0]], [1, p[0]], [2, p[0]], [4, I.STICK], [7, I.STICK]]);
          var r = Inv.matchRecipe(g, 3, 3);
          A.ok(r, 'recette ' + C.nameOf(p[1]));
          A.equal(r.id, p[1], C.nameOf(p[1]));
        });
    });

    it('épée : 2 matériaux + 1 bâton en colonne', function () {
      var g = grid3([[0, B.COBBLE], [3, B.COBBLE], [6, I.STICK]]);
      var r = Inv.matchRecipe(g, 3, 3);
      A.ok(r); A.equal(r.id, I.STONE_SWORD);
    });

    it('pain : 3 blés', function () {
      var r = Inv.matchRecipe(grid3([[0, I.WHEAT], [1, I.WHEAT], [2, I.WHEAT]]), 3, 3);
      A.ok(r); A.equal(r.id, I.BREAD);
    });

    it('une grille vide ne donne rien', function () {
      A.equal(Inv.matchRecipe(new Array(9).fill(0), 3, 3), null);
    });

    it('des ingrédients au hasard ne donnent rien', function () {
      var r = Inv.matchRecipe(grid3([[0, B.SAND], [4, I.COAL], [8, B.LEAVES]]), 3, 3);
      A.equal(r, null);
    });

    it('trimGrid recadre sur la boîte non vide', function () {
      var g = new Array(9).fill(0); g[4] = B.LOG; g[5] = B.LOG;
      var t = Inv.trimGrid(g, 3, 3);
      A.equal(t.w, 2); A.equal(t.h, 1);
      A.deep(t.cells, [B.LOG, B.LOG]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Fourneau', function () {
    it('sans combustible, rien ne cuit', function () {
      var f = Inv.newFurnace();
      f.input = { id: B.IRON_ORE, n: 1 };
      Inv.tickFurnace(f, 10);
      A.equal(f.output, null, 'aucune sortie');
    });

    it('avec du charbon, le minerai devient un lingot', function () {
      var f = Inv.newFurnace();
      f.input = { id: B.IRON_ORE, n: 1 };
      f.fuel = { id: I.COAL, n: 1 };
      for (var i = 0; i < 100; i++) Inv.tickFurnace(f, 0.1);
      A.ok(f.output, 'une sortie existe');
      A.equal(f.output.id, I.IRON_INGOT, 'lingot de fer');
      A.equal(f.input, null, 'entrée consommée');
    });

    it('le combustible est consommé', function () {
      var f = Inv.newFurnace();
      f.input = { id: B.IRON_ORE, n: 1 };
      f.fuel = { id: I.COAL, n: 2 };
      Inv.tickFurnace(f, 0.1);
      A.equal(f.fuel.n, 1, 'un charbon brûlé');
    });

    it('le mouton cru devient cuit', function () {
      var f = Inv.newFurnace();
      f.input = { id: I.RAW_MUTTON, n: 1 };
      f.fuel = { id: I.COAL, n: 1 };
      for (var i = 0; i < 100; i++) Inv.tickFurnace(f, 0.1);
      A.equal(f.output.id, I.COOKED_MUTTON);
    });

    it('un objet non cuisinable ne consomme pas de combustible', function () {
      var f = Inv.newFurnace();
      f.input = { id: B.DIRT, n: 1 };
      f.fuel = { id: I.COAL, n: 1 };
      Inv.tickFurnace(f, 1);
      A.equal(f.fuel.n, 1, 'charbon intact');
      A.equal(f.burn, 0, 'rien ne brûle');
    });

    it('plusieurs entrées cuisent successivement', function () {
      var f = Inv.newFurnace();
      f.input = { id: B.IRON_ORE, n: 3 };
      f.fuel = { id: I.COAL, n: 3 };
      for (var i = 0; i < 400; i++) Inv.tickFurnace(f, 0.1);
      A.equal(f.output.n, 3, 'trois lingots');
      A.equal(f.input, null, 'entrée vidée');
    });

    it('le bois est un combustible, la terre non', function () {
      A.ok(Inv.fuelValue(B.PLANKS) > 0, 'planche combustible');
      A.ok(Inv.fuelValue(I.COAL) > Inv.fuelValue(B.PLANKS), 'charbon meilleur');
      A.equal(Inv.fuelValue(B.DIRT), 0, 'terre non combustible');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Echanges avec les villageois', function () {
    it('toutes les offres sont bien formees', function () {
      Inv.TRADES.forEach(function (t, i) {
        A.ok(t.give && t.give.length > 0, 'offre ' + i + ' a une contrepartie');
        A.ok(t.get && t.get.id && t.get.n > 0, 'offre ' + i + ' donne quelque chose');
        t.give.forEach(function (gv) { A.ok(C.def(gv.id), 'ingredient connu : ' + gv.id); });
        A.ok(C.def(t.get.id), 'resultat connu : ' + t.get.id);
      });
    });

    it('un echange refuse si le joueur n a pas de quoi payer', function () {
      var inv = Inv.create(36);
      var t = Inv.TRADES[0];
      A.notOk(Inv.canTrade(inv, t), 'inventaire vide : impossible');
      A.equal(Inv.doTrade(inv, t), null, 'aucun effet');
    });

    it('un echange preleve et remet la contrepartie', function () {
      var inv = Inv.create(36);
      var t = Inv.TRADES[0];
      inv.add(t.give[0].id, t.give[0].n + 3);
      A.ok(Inv.canTrade(inv, t), 'payable');
      A.equal(Inv.doTrade(inv, t), 0, 'tout rentre');
      A.equal(inv.count(t.give[0].id), 3, 'le prix a ete preleve');
      A.equal(inv.count(t.get.id), t.get.n, 'la contrepartie est recue');
    });

    /* Regression a eviter : prelever le paiement alors que le resultat ne
       rentre pas ferait disparaitre les objets du joueur. */
    it('un inventaire plein annule l echange sans rien prelever', function () {
      var inv = Inv.create(2);
      var t = Inv.TRADES[0];
      inv.add(t.give[0].id, 64);
      inv.add(C.B.STONE, 64);
      var avant = inv.count(t.give[0].id);
      A.equal(Inv.doTrade(inv, t), null, 'echange annule');
      A.equal(inv.count(t.give[0].id), avant, 'rien preleve');
    });

    it('la chaine ble -> emeraude -> pioche en fer est realisable', function () {
      var inv = Inv.create(36);
      inv.add(I.WHEAT, 24);
      var vente = Inv.TRADES[0];
      for (var i = 0; i < 3; i++) Inv.doTrade(inv, vente);
      A.equal(inv.count(I.EMERALD), 3, '3 emeraudes gagnees');
      var achat = Inv.TRADES.filter(function (t) { return t.get.id === I.IRON_PICKAXE; })[0];
      A.ok(achat, 'une offre vend la pioche en fer');
      A.equal(Inv.doTrade(inv, achat), 0, 'achat conclu');
      A.equal(inv.count(I.IRON_PICKAXE), 1, 'pioche obtenue');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Usure des outils', function () {
    it('un outil s use a chaque bloc casse et finit par se briser', function () {
      var inv = Inv.create(9);
      inv.add(I.WOOD_PICKAXE, 1);
      var max = C.durabilityOf(I.WOOD_PICKAXE);
      A.ok(max > 0, 'la pioche en bois a une durabilite');
      for (var i = 0; i < max - 1; i++) {
        A.equal(inv.wearTool(0), 'used', 'coup ' + i + ' : usure');
      }
      A.equal(inv.wearTool(0), 'broken', 'le dernier coup la brise');
      A.equal(inv.slots[0], null, 'la case est liberee');
    });

    it('le fer dure plus longtemps que le bois', function () {
      A.ok(C.durabilityOf(I.IRON_PICKAXE) > C.durabilityOf(I.STONE_PICKAXE));
      A.ok(C.durabilityOf(I.STONE_PICKAXE) > C.durabilityOf(I.WOOD_PICKAXE));
    });

    it('un bloc ou un objet ordinaire ne s use pas', function () {
      var inv = Inv.create(9);
      inv.add(B.COBBLE, 10);
      A.equal(inv.wearTool(0), null, 'le pave n est pas un outil');
      A.equal(inv.count(B.COBBLE), 10, 'rien perdu');
    });

    it('l usure survit a la sauvegarde', function () {
      var inv = Inv.create(9);
      inv.add(I.IRON_PICKAXE, 1);
      inv.wearTool(0); inv.wearTool(0); inv.wearTool(0);
      var data = inv.serialize();
      var inv2 = Inv.create(9);
      inv2.load(data);
      A.equal(inv2.slots[0].dmg, 3, 'usure restituee');
    });

    it('une sauvegarde sans champ d usure reste lisible', function () {
      var inv = Inv.create(9);
      inv.load([[I.IRON_PICKAXE, 1], 0, 0, 0, 0, 0, 0, 0, 0]);
      A.equal(inv.slots[0].id, I.IRON_PICKAXE);
      A.ok(!inv.slots[0].dmg, 'aucune usure par defaut');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Torches et supports', function () {
    it('la torche emet de la lumiere, pas la pierre', function () {
      A.ok(C.lightOf(B.TORCH) > 0, 'la torche eclaire');
      A.equal(C.lightOf(B.STONE), 0, 'la pierre non');
    });

    it('poser une torche l inscrit au registre des lumieres', function () {
      var w = MC.createWorld(5);
      w.getChunk(0, 0, true);
      var gy = w.groundAt(8, 8, true);
      // le registre peut déjà porter les lumières naturelles des profondeurs
      // (champignons, cristaux — SPEC-LUMIERE-007) : on compare par écart
      var base = w.lights.size;
      w.setBlock(8, gy + 1, 8, B.TORCH);
      A.equal(w.lights.size, base + 1, 'torche enregistree');
      w.setBlock(8, gy + 1, 8, 0);
      A.equal(w.lights.size, base, 'retiree quand on la casse');
    });

    it('une torche exige un support', function () {
      var w = MC.createWorld(5);
      w.getChunk(0, 0, true);
      var gy = w.groundAt(8, 8, true);
      A.ok(w.hasSupport(8, gy + 1, 8), 'sol dessous : support valide');
      A.notOk(w.hasSupport(8, C.WORLD_H - 2, 8), 'en plein ciel : aucun support');
    });

    it('casser le bloc porteur fait tomber la torche', function () {
      var w = MC.createWorld(5);
      w.getChunk(0, 0, true);
      var gy = w.groundAt(8, 8, true);
      var base = w.lights.size;
      // un relief voisin en pente pourrait offrir un appui latéral : on isole
      // la colonne pour ne tester que la perte du support du dessous
      [[7, 8], [9, 8], [8, 7], [8, 9]].forEach(function (p) { w.setBlock(p[0], gy + 1, p[1], 0); });
      w.setBlock(8, gy + 1, 8, B.TORCH);
      w.setBlock(8, gy, 8, 0);                       // on retire le support
      var tombees = w.dropUnsupported(8, gy, 8);
      A.equal(tombees.length, 1, 'une torche est tombee');
      A.equal(w.getBlock(8, gy + 1, 8), 0, 'la case est vide');
      A.equal(w.lights.size, base, 'registre nettoye');
    });

    it('le registre des lumieres se reconstruit apres un chargement', function () {
      var w = MC.createWorld(5);
      w.getChunk(0, 0, true);
      var gy = w.groundAt(8, 8, true);
      var base = w.lights.size;
      w.setBlock(8, gy + 1, 8, B.TORCH);
      w.lights.clear();                              // simule un chargement brut
      A.equal(w.lights.size, 0);
      A.equal(w.rebuildRegistries(), base + 1, 'la torche et les lumières naturelles retrouvées');
    });

    it('la recette de torche donne 4 torches', function () {
      var g = new Array(9).fill(0);
      g[0] = I.COAL; g[3] = I.STICK;
      var r = Inv.matchRecipe(g, 3, 3);
      A.ok(r, 'reconnue'); A.equal(r.id, B.TORCH); A.equal(r.n, 4);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Coffres', function () {
    it('la recette du coffre est un anneau de planches', function () {
      var g = new Array(9).fill(B.PLANKS); g[4] = 0;
      var r = Inv.matchRecipe(g, 3, 3);
      A.ok(r); A.equal(r.id, B.CHEST);
    });

    it('le coffre est un bloc interactif', function () {
      A.equal(C.BLOCKS[B.CHEST].interactive, 'chest');
    });

    it('un coffre stocke et restitue son contenu', function () {
      var coffre = Inv.create(27);
      coffre.add(B.COBBLE, 100);
      coffre.add(I.IRON_PICKAXE, 1);
      var data = coffre.serialize();
      var autre = Inv.create(27);
      autre.load(data);
      A.equal(autre.count(B.COBBLE), 100);
      A.equal(autre.count(I.IRON_PICKAXE), 1);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Cycle jour/nuit', function () {
    var DL = DC.DAY_LENGTH;
    it('la phase reste dans [0,1)', function () {
      [0, 10, DL - 1, DL, DL * 3.7].forEach(function (t) {
        A.between(DC.phase(t), 0, 0.9999999, 't=' + t);
      });
    });
    it('il fait jour au début du cycle et nuit au milieu', function () {
      A.notOk(DC.isNight(0), 'aube = jour');
      A.notOk(DC.isNight(DL * 0.25), 'midi = jour');
      A.ok(DC.isNight(DL * 0.7), 'milieu de nuit');
      A.notOk(DC.isNight(DL * 0.98), 'avant l\'aube, le jour revient');
    });
    it('l\'intensité du soleil est nulle la nuit et pleine le jour', function () {
      A.equal(DC.sunIntensity(DL * 0.2), 1, 'plein jour');
      A.equal(DC.sunIntensity(DL * 0.7), 0, 'nuit noire');
      A.between(DC.sunIntensity(DL * 0.51), 0, 1, 'crépuscule intermédiaire');
    });
    it('la couleur du ciel est continue sur tout le cycle', function () {
      var prev = DC.skyColor(0), maxJump = 0;
      for (var t = 1; t <= DL; t += 1) {
        var c = DC.skyColor(t);
        var jump = Math.max(Math.abs(c[0] - prev[0]), Math.abs(c[1] - prev[1]), Math.abs(c[2] - prev[2]));
        if (jump > maxJump) maxJump = jump;
        prev = c;
      }
      A.ok(maxJump < 0.06, 'aucun saut brutal (max ' + maxJump.toFixed(4) + ')');
    });
    it('le ciel de nuit est plus sombre que celui de jour', function () {
      var j = DC.skyColor(DL * 0.2), n = DC.skyColor(DL * 0.7);
      A.ok(n[0] + n[1] + n[2] < j[0] + j[1] + j[2], 'nuit plus sombre');
    });
    it('l\'horloge est cohérente', function () {
      A.equal(DC.clockString(0), '00:00');
      A.equal(DC.clockString(DL * 0.5), '12:00');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Mailleur', function () {
    function chunkPlein(id) {
      var c = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      for (var y = 0; y < 3; y++) for (var z = 0; z < C.CHUNK_Z; z++) for (var x = 0; x < C.CHUNK_X; x++)
        c.blocks[C.idx(x, y, z)] = id;
      return c;
    }

    it('un bloc isolé produit exactement 6 faces', function () {
      var c = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      c.blocks[C.idx(5, 5, 5)] = B.STONE;
      var g = MC.Mesher.buildChunk(c, false, function () { return 0; });
      A.ok(g, 'géométrie produite');
      A.equal(g.indices.length / 6, 6, '6 faces');
      A.equal(g.positions.length / 3, 24, '24 sommets');
    });

    it('les faces internes d\'un massif sont supprimées', function () {
      var c = chunkPlein(B.STONE);
      var g = MC.Mesher.buildChunk(c, false, function () { return 0; });
      var faces = g.indices.length / 6;
      // dalle 16x3x16 : 2*(16*16) dessus/dessous + 4*(16*3) côtés = 512 + 192
      A.equal(faces, 512 + 192, 'seules les faces exposées (' + faces + ')');
    });

    it('un bloc entièrement entouré ne produit rien', function () {
      var c = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      c.blocks[C.idx(5, 5, 5)] = B.STONE;
      // tout voisin est de la pierre -> aucune face
      var g = MC.Mesher.buildChunk(c, false, function () { return B.STONE; });
      // les 6 voisins sont dans le chunk (air) sauf via sample : on remplit autour
      c.blocks[C.idx(4, 5, 5)] = B.STONE; c.blocks[C.idx(6, 5, 5)] = B.STONE;
      c.blocks[C.idx(5, 4, 5)] = B.STONE; c.blocks[C.idx(5, 6, 5)] = B.STONE;
      c.blocks[C.idx(5, 5, 4)] = B.STONE; c.blocks[C.idx(5, 5, 6)] = B.STONE;
      g = MC.Mesher.buildChunk(c, false, function () { return B.STONE; });
      // le bloc central n'a plus de face, mais ses voisins en ont
      A.ok(g, 'les voisins produisent des faces');
      // on vérifie plutôt qu'aucune face n'est centrée sur (5.5, 5.5, 5.5)
      var centre = 0;
      for (var i = 0; i < g.positions.length; i += 3) {
        if (g.positions[i] > 5 && g.positions[i] < 6 &&
            g.positions[i+1] > 5 && g.positions[i+1] < 6 &&
            g.positions[i+2] > 5 && g.positions[i+2] < 6) centre++;
      }
      A.equal(centre, 0, 'aucun sommet à l\'intérieur du bloc entouré');
    });

    it('un chunk vide ne produit aucune géométrie', function () {
      var c = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      A.equal(MC.Mesher.buildChunk(c, false, function () { return 0; }), null);
    });

    it('les passes opaque et transparente sont disjointes', function () {
      var c = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      c.blocks[C.idx(1, 1, 1)] = B.STONE;
      c.blocks[C.idx(3, 1, 1)] = B.GLASS;
      var op = MC.Mesher.buildChunk(c, 'opaque', function () { return 0; });
      var tr = MC.Mesher.buildChunk(c, 'blend', function () { return 0; });
      A.equal(op.indices.length / 6, 6, 'opaque : la pierre seule');
      A.equal(tr.indices.length / 6, 6, 'fondu : le verre seul');
    });

    /* Regression : confondre decoupe et fondu rend le feuillage delave et
       introduit des artefacts de tri. Chaque bloc doit tomber dans une seule passe. */
    it('chaque bloc appartient a exactement une passe de rendu', function () {
      var attendu = {};
      attendu[B.STONE] = 'opaque'; attendu[B.GRASS] = 'opaque'; attendu[B.PLANKS] = 'opaque';
      attendu[B.LEAVES] = 'cutout'; attendu[B.WHEAT3] = 'cutout'; attendu[B.WHEAT0] = 'cutout';
      attendu[B.WATER] = 'blend'; attendu[B.GLASS] = 'blend';
      Object.keys(attendu).forEach(function (id) {
        A.equal(C.passOf(+id), attendu[id], C.nameOf(+id));
      });
    });

    it('les trois passes sont disjointes et exhaustives', function () {
      var c = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      c.blocks[C.idx(1, 1, 1)] = B.STONE;     // opaque
      c.blocks[C.idx(3, 1, 1)] = B.LEAVES;    // decoupe
      c.blocks[C.idx(5, 1, 1)] = B.WATER;     // fondu
      var air = function () { return 0; };
      var n = {};
      ['opaque', 'cutout', 'blend'].forEach(function (p) {
        var geo = MC.Mesher.buildChunk(c, p, air);
        n[p] = geo ? geo.indices.length / 6 : 0;
      });
      A.equal(n.opaque, 6, 'la pierre seule en opaque');
      A.equal(n.cutout, 6, 'le feuillage seul en decoupe');
      A.equal(n.blend, 5, "eau seule en fondu (dessous omis)");
      A.equal(n.opaque + n.cutout + n.blend, 17, 'aucune face perdue ni dupliquee');
    });

    /* L'occlusion ambiante assombrit les coins selon les voisins situes DEVANT
       la face. Elle est purement geometrique, donc verifiable exactement. */
    it('un bloc isole n a aucune occlusion : tous les sommets a pleine clarte', function () {
      var c = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      c.blocks[C.idx(5, 5, 5)] = B.STONE;
      var g = MC.Mesher.buildChunk(c, 'opaque', function () { return 0; });
      // la couleur combine l'ombrage directionnel de la face et l'AO ;
      // sans voisin, l'AO vaut 1 donc chaque face est uniforme
      for (var f = 0; f < 6; f++) {
        var base = f * 12;
        var r = g.colors[base];
        for (var k = 1; k < 4; k++) {
          A.close(g.colors[base + k * 3], r, 1e-6, 'face ' + f + ' uniforme');
        }
      }
    });

    it('un voisin adjacent assombrit les sommets concernes', function () {
      var c = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      c.blocks[C.idx(5, 5, 5)] = B.STONE;
      c.blocks[C.idx(6, 6, 5)] = B.STONE;     // voisin en diagonale au-dessus
      var g = MC.Mesher.buildChunk(c, 'opaque', function () { return 0; });
      var min = Infinity, max = -Infinity;
      for (var i = 0; i < g.colors.length; i += 3) {
        if (g.colors[i] < min) min = g.colors[i];
        if (g.colors[i] > max) max = g.colors[i];
      }
      A.ok(min < max, 'des sommets sont plus sombres que d autres');
      A.ok(min < 1, 'au moins un sommet est occulte (' + min.toFixed(3) + ')');
    });

    /* Les faces d un bloc isole sortent dans l ordre de FACES
       (-x, +x, -y, +y, -z, +z) : la face du dessus est donc la 4e, soit les
       sommets 12 a 15. On cible cette face precise, car la face du dessous
       (ombrage 0.50) est toujours la plus sombre et masquerait l effet. */
    function couleursFaceDessus(g) {
      var out = [];
      for (var k = 12; k < 16; k++) out.push(g.colors[k * 3]);
      return out;
    }

    it('un coin enferme entre deux arretes prend la valeur la plus sombre', function () {
      var c = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      c.blocks[C.idx(5, 5, 5)] = B.STONE;
      c.blocks[C.idx(6, 6, 5)] = B.STONE;     // arrete +x
      c.blocks[C.idx(5, 6, 6)] = B.STONE;     // arrete +z
      var g = MC.Mesher.buildChunk(c, 'opaque', function () { return 0; });
      var face = couleursFaceDessus(g);
      // face du dessus : ombrage 1.0, donc la couleur egale l AO
      A.close(Math.min.apply(null, face), 0.54, 0.01, 'niveau d occlusion maximal');
      A.close(Math.max.apply(null, face), 1.0, 0.01, 'le coin oppose reste clair');
    });

    it('le verre et les plantes ne projettent pas d ombre de contact', function () {
      function minCouleur(voisin) {
        var c = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
        c.blocks[C.idx(5, 5, 5)] = B.STONE;
        if (voisin) c.blocks[C.idx(6, 6, 5)] = voisin;
        var g = MC.Mesher.buildChunk(c, 'opaque', function () { return 0; });
        var m = Infinity;
        for (var i = 0; i < g.colors.length; i += 3) if (g.colors[i] < m) m = g.colors[i];
        return m;
      }
      var sans = minCouleur(0);
      A.close(minCouleur(B.GLASS), sans, 1e-6, 'le verre n occulte pas');
      A.close(minCouleur(B.WHEAT3), sans, 1e-6, 'une plante n occulte pas');
      A.ok(minCouleur(B.STONE) < sans, 'la pierre, elle, occulte');
    });

    it('l occlusion traverse les frontieres de chunk', function () {
      var c = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      c.blocks[C.idx(15, 5, 5)] = B.STONE;         // contre la bordure est
      // le voisin diagonal est DANS le chunk suivant
      var sample = function (wx, wy, wz) {
        return (wx === 16 && wy === 6 && wz === 5) ? B.STONE : 0;
      };
      var avec = MC.Mesher.buildChunk(c, 'opaque', sample);
      var sans = MC.Mesher.buildChunk(c, 'opaque', function () { return 0; });
      var fAvec = couleursFaceDessus(avec), fSans = couleursFaceDessus(sans);
      A.close(Math.min.apply(null, fSans), 1.0, 1e-6, 'sans voisin : aucune occlusion');
      A.ok(Math.min.apply(null, fAvec) < 0.99,
        'le voisin du chunk adjacent assombrit bien (' +
        Math.min.apply(null, fAvec).toFixed(3) + ')');
    });

    it('la surface de l eau n est pas occultee', function () {
      var c = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      c.blocks[C.idx(5, 5, 5)] = B.WATER;
      c.blocks[C.idx(6, 6, 5)] = B.STONE;
      var g = MC.Mesher.buildChunk(c, 'blend', function () { return 0; });
      var couleurs = {};
      for (var i = 0; i < g.colors.length; i += 3) couleurs[g.colors[i].toFixed(3)] = 1;
      // seules les valeurs d ombrage directionnel doivent apparaitre, pas d AO
      A.ok(Object.keys(couleurs).length <= 3, 'pas de degrade d occlusion sur l eau');
    });

    /* Piege classique de l AO : prendre les voisins DANS le plan de la face au
       lieu de ceux situes DEVANT. Un mur plat serait alors uniformement sombre
       alors qu il n a aucun angle rentrant. */
    it('une paroi plate n est pas occultee', function () {
      var c = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      for (var y = 2; y <= 6; y++) for (var z = 2; z <= 6; z++) c.blocks[C.idx(5, y, z)] = B.STONE;
      var g = MC.Mesher.buildChunk(c, 'opaque', function () { return 0; });
      // faces -x et +x : ombrage 0.72 ; sans occlusion la couleur vaut exactement 0.72
      var trouve = 0;
      for (var i = 0; i < g.colors.length; i += 3) {
        var v = g.colors[i];
        if (Math.abs(v - 0.72) < 1e-6) trouve++;
        else A.ok(Math.abs(v - 0.50) < 1e-6 || Math.abs(v - 1.0) < 1e-6 ||
                  Math.abs(v - 0.86) < 1e-6 || v < 0.72,
                  'valeur inattendue ' + v.toFixed(3));
      }
      A.ok(trouve > 40, 'les grandes faces laterales restent a pleine clarte');
    });

    it('un sol plat n est pas occulte non plus', function () {
      var c = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      for (var x = 2; x <= 8; x++) for (var z = 2; z <= 8; z++) c.blocks[C.idx(x, 4, z)] = B.STONE;
      var g = MC.Mesher.buildChunk(c, 'opaque', function () { return 0; });
      // on isole la face du dessus d un bloc central : elle doit valoir 1.0
      var pleins = 0;
      for (var i = 0; i < g.colors.length; i += 3) if (Math.abs(g.colors[i] - 1.0) < 1e-6) pleins++;
      A.ok(pleins > 40, 'les faces superieures restent a pleine clarte');
    });

    it('les UV restent dans [0,1]', function () {
      var c = chunkPlein(B.GRASS);
      var g = MC.Mesher.buildChunk(c, false, function () { return 0; });
      for (var i = 0; i < g.uvs.length; i++) A.between(g.uvs[i], 0, 1, 'uv[' + i + ']');
    });

    it('chaque face a 4 sommets et 6 indices', function () {
      var c = chunkPlein(B.STONE);
      var g = MC.Mesher.buildChunk(c, false, function () { return 0; });
      A.equal(g.positions.length / 3, g.indices.length / 6 * 4, 'cohérence sommets/faces');
      A.equal(g.normals.length, g.positions.length, 'une normale par sommet');
      A.equal(g.colors.length, g.positions.length, 'une couleur par sommet');
      A.equal(g.uvs.length / 2, g.positions.length / 3, 'un uv par sommet');
    });

    it('une plante produit deux quads croisés', function () {
      var c = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      c.blocks[C.idx(2, 2, 2)] = B.WHEAT3;
      var g = MC.Mesher.buildChunk(c, 'cutout', function () { return 0; });
      A.ok(g, 'géométrie produite');
      A.equal(g.indices.length / 6, 2, '2 quads');
    });

    it('la face du bas de l\'eau n\'est pas maillée', function () {
      var c = { cx: 0, cz: 0, blocks: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      c.blocks[C.idx(2, 2, 2)] = B.WATER;
      var g = MC.Mesher.buildChunk(c, 'blend', function () { return 0; });
      A.equal(g.indices.length / 6, 5, '5 faces : le dessous est omis');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Entités', function () {
    function setup() {
      var w = flatWorld(10);
      var ents = MC.createEntities(w);
      return { w: w, ents: ents };
    }

    it('un objet lâché existe et porte son contenu', function () {
      var s = setup();
      var e = s.ents.dropItem(0.5, 12, 0.5, B.STONE, 5, seededRand(1));
      A.equal(e.type, 'item');
      A.equal(e.item, B.STONE);
      A.equal(e.n, 5);
      A.equal(s.ents.list.length, 1);
    });

    it('un objet tombe et se pose sur le sol', function () {
      var s = setup();
      var e = s.ents.dropItem(0.5, 20, 0.5, B.STONE, 1, seededRand(1));
      e.vel.x = 0; e.vel.z = 0; e.vel.y = 0;
      var player = { pos: { x: 100, y: 100, z: 100 } };
      for (var i = 0; i < 300; i++) s.ents.update(1 / 60, player);
      A.between(e.pos.y, 10.9, 11.1, 'posé sur le sol');
    });

    it('un objet proche est ramassé', function () {
      var s = setup();
      var e = s.ents.dropItem(0.5, 11.2, 0.5, B.STONE, 3, seededRand(1));
      e.pickup = 0;
      var player = { pos: { x: 0.5, y: 11, z: 0.5 } };
      var picked = null;
      for (var i = 0; i < 120 && !picked; i++) {
        var ev = s.ents.update(1 / 60, player);
        if (ev.picked.length) picked = ev.picked[0];
      }
      A.ok(picked, 'ramassé');
      A.equal(picked.id, B.STONE);
      A.equal(picked.n, 3);
      A.equal(s.ents.list.length, 0, 'entité retirée');
    });

    it('un objet trop récent n\'est pas ramassé (délai)', function () {
      var s = setup();
      var e = s.ents.dropItem(0.5, 11, 0.5, B.STONE, 1, seededRand(1));
      e.pickup = 0.4;
      var player = { pos: { x: 0.5, y: 11, z: 0.5 } };
      var ev = s.ents.update(0.05, player);
      A.equal(ev.picked.length, 0, 'pas encore ramassable');
    });

    it('les piles identiques proches fusionnent', function () {
      var s = setup();
      s.ents.dropItem(0.5, 11, 0.5, B.STONE, 10, seededRand(1));
      s.ents.dropItem(0.6, 11, 0.5, B.STONE, 20, seededRand(2));
      // on force la proximité (les impulsions les écartent)
      s.ents.list[1].pos = { x: 0.55, y: 11, z: 0.5 };
      var n = s.ents.mergeItems();
      A.equal(n, 1, 'une fusion');
      A.equal(s.ents.list.length, 1);
      A.equal(s.ents.list[0].n, 30, 'piles additionnées');
    });

    it('des objets différents ne fusionnent pas', function () {
      var s = setup();
      s.ents.dropItem(0.5, 11, 0.5, B.STONE, 1, seededRand(1));
      s.ents.dropItem(0.5, 11, 0.5, B.DIRT, 1, seededRand(2));
      s.ents.list[1].pos = { x: 0.5, y: 11, z: 0.5 };
      A.equal(s.ents.mergeItems(), 0, 'aucune fusion');
    });

    it('une fusion qui dépasserait la pile max est refusée', function () {
      var s = setup();
      s.ents.dropItem(0.5, 11, 0.5, B.STONE, 50, seededRand(1));
      s.ents.dropItem(0.5, 11, 0.5, B.STONE, 50, seededRand(2));
      s.ents.list[1].pos = { x: 0.5, y: 11, z: 0.5 };
      A.equal(s.ents.mergeItems(), 0, '50+50 > 64 : pas de fusion');
    });

    it('un zombie poursuit le joueur', function () {
      var s = setup();
      var z = s.ents.spawn('zombie', 10.5, 11, 0.5);
      var player = { pos: { x: 0.5, y: 11, z: 0.5 } };
      var d0 = Math.abs(z.pos.x - player.pos.x);
      for (var i = 0; i < 120; i++) s.ents.update(1 / 60, player, { rand: seededRand(3) });
      var d1 = Math.abs(z.pos.x - player.pos.x);
      A.ok(d1 < d0, 'le zombie se rapproche (' + d0.toFixed(1) + ' -> ' + d1.toFixed(1) + ')');
    });

    it('un zombie hors de portée ne poursuit pas', function () {
      var s = setup();
      var z = s.ents.spawn('zombie', 60.5, 11, 0.5);
      var player = { pos: { x: 0.5, y: 11, z: 0.5 } };
      var d0 = z.pos.x;
      for (var i = 0; i < 60; i++) s.ents.update(1 / 60, player, { rand: seededRand(3) });
      A.close(z.pos.x, d0, 3, 'reste dans sa zone (errance seulement)');
    });

    it('un zombie au contact inflige des dégâts, avec un temps de recharge', function () {
      var s = setup();
      s.ents.spawn('zombie', 1.0, 11, 0.5);
      var player = { pos: { x: 0.5, y: 11, z: 0.5 } };
      var total = 0;
      for (var i = 0; i < 60; i++) total += s.ents.update(1 / 60, player, { rand: seededRand(3) }).damage;
      A.ok(total > 0, 'des dégâts sont infligés');
      A.ok(total <= 3 * 2, 'la recharge limite la cadence (total ' + total + ')');
    });

    it('un mouton meurt et lâche viande et laine', function () {
      var s = setup();
      var m = s.ents.spawn('sheep', 0.5, 11, 0.5);
      var tue = false;
      for (var i = 0; i < 20 && !tue; i++) { m.hurtCd = 0; tue = s.ents.damage(m, 3); }
      A.ok(tue, 'mouton tué');
      var drops = s.ents.list.filter(function (e) { return e.type === 'item'; })
                             .map(function (e) { return e.item; });
      A.ok(drops.indexOf(I.RAW_MUTTON) >= 0, 'viande lâchée');
      A.ok(drops.indexOf(B.WOOL) >= 0, 'laine lâchée');
    });

    it('un zombie tué lâche de la chair putréfiée', function () {
      var s = setup();
      var z = s.ents.spawn('zombie', 0.5, 11, 0.5);
      for (var i = 0; i < 30; i++) { z.hurtCd = 0; if (s.ents.damage(z, 5)) break; }
      var drops = s.ents.list.filter(function (e) { return e.type === 'item'; })
                             .map(function (e) { return e.item; });
      A.ok(drops.indexOf(I.ROTTEN_FLESH) >= 0, 'chair lâchée');
    });

    it('le temps d\'invulnérabilité empêche les coups en rafale', function () {
      var s = setup();
      var m = s.ents.spawn('sheep', 0.5, 11, 0.5);
      var hp0 = m.hp;
      s.ents.damage(m, 2);
      s.ents.damage(m, 2);          // ignoré : hurtCd actif
      A.equal(m.hp, hp0 - 2, 'un seul coup pris');
    });

    it('aimedAt trouve l\'entité dans l\'axe du regard', function () {
      var s = setup();
      var z = s.ents.spawn('zombie', 0.5, 11, -3.5);
      var e = s.ents.aimedAt({ x: 0.5, y: 12, z: 0.5 }, { x: 0, y: 0, z: -1 }, 6);
      A.equal(e && e.eid, z.eid, 'le zombie devant est visé');
    });

    /* Régression : mesurer la distance du CENTRE du mob à l'axe du regard rendait
       les mobs courts intouchables — le centre d'un mouton (1,2 m) est un mètre
       sous les yeux du joueur (1,62 m). Il faut une intersection rayon/boîte. */
    it('un mob court reste visable alors que son centre est loin de l\'axe', function () {
      var s = setup();
      var m = s.ents.spawn('sheep', 0.5, 11, -2.5);       // mouton au sol
      var oeil = { x: 0.5, y: 11 + 1.62, z: 0.5 };        // yeux du joueur
      var e = s.ents.aimedAt(oeil, { x: 0, y: -0.35, z: -0.94 }, 6);
      A.equal(e && e.eid, m.eid, 'le mouton est visé en regardant légèrement vers le bas');
    });

    it('rayBox rejette ce qui est hors de la boîte', function () {
      var s = setup();
      A.equal(s.ents.rayBox({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 },
                            5, 5, -3, 6, 6, -2), null, 'boîte décalée : aucun contact');
      A.ok(s.ents.rayBox({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 },
                         -1, -1, -3, 1, 1, -2) !== null, 'boîte dans l\'axe : contact');
    });

    it('aimedAt ignore ce qui est de côté ou hors de portée', function () {
      var s = setup();
      s.ents.spawn('zombie', 8.5, 11, 0.5);            // sur le côté
      A.equal(s.ents.aimedAt({ x: 0.5, y: 12, z: 0.5 }, { x: 0, y: 0, z: -1 }, 6), null,
        'pas dans l\'axe');
      s.ents.spawn('zombie', 0.5, 11, -30);            // trop loin
      A.equal(s.ents.aimedAt({ x: 0.5, y: 12, z: 0.5 }, { x: 0, y: 0, z: -1 }, 6), null,
        'hors de portée');
    });

    it('aimedAt ne cible pas les objets au sol', function () {
      var s = setup();
      s.ents.dropItem(0.5, 12, -2, B.STONE, 1, seededRand(1));
      A.equal(s.ents.aimedAt({ x: 0.5, y: 12, z: 0.5 }, { x: 0, y: 0, z: -1 }, 6), null);
    });

    it('les zombies disparaissent au lever du jour', function () {
      var s = setup();
      s.ents.spawn('zombie', 0.5, 11, 0.5);
      s.ents.spawn('sheep', 2.5, 11, 0.5);
      A.equal(s.ents.burnUndead(true), 0, 'la nuit, ils restent');
      A.equal(s.ents.burnUndead(false), 1, 'le jour, ils disparaissent');
      A.equal(s.ents.countOf('sheep'), 1, 'les moutons restent');
    });

    it('l\'apparition respecte les plafonds', function () {
      var w = MC.createWorld(20260921);
      w.getChunk(0, 0, true);
      for (var cx = -3; cx <= 3; cx++) for (var cz = -3; cz <= 3; cz++) w.getChunk(cx, cz, true);
      var ents = MC.createEntities(w);
      var col = w.findSpawnColumn();
      var player = { pos: { x: col[0] + 0.5, y: w.groundAt(col[0], col[1], true) + 1, z: col[1] + 0.5 } };
      var r = seededRand(11);
      for (var i = 0; i < 4000; i++) ents.trySpawn(player, true, r, { zombie: 3, sheep: 2, villager: 1 });
      A.ok(ents.countOf('zombie') <= 3, 'plafond zombies respecté (' + ents.countOf('zombie') + ')');
      A.ok(ents.countOf('sheep') <= 2, 'plafond moutons respecté');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Audio', function () {
    /* WebAudio peut etre absent (Node, navigateur ancien) ou suspendu
       (politique d autoplay). Le contrat est le meme dans les deux cas :
       aucune exception, et une valeur de retour honnete. Le test s adapte a
       son environnement plutot que de supposer l un des deux. */
    var AUDIO_DISPO = (typeof G.AudioContext !== 'undefined') ||
                      (typeof G.webkitAudioContext !== 'undefined');

    it('le contrat de lecture est honnete dans les deux environnements', function () {
      var a = MC.createAudio();
      var joue = a.play('casser');
      if (AUDIO_DISPO) A.ok(joue, 'WebAudio present : le son part');
      else A.notOk(joue, 'WebAudio absent : aucun son, mais aucune erreur');
    });

    it('sans WebAudio, rien ne plante', function () {
      var a = MC.createAudio();
      // on appelle tout, y compris sur un contexte potentiellement absent
      a.resume(); a.play('poser'); a.play('mort'); a.setEnabled(false); a.setEnabled(true);
      A.ok(true, 'aucune exception levee');
    });

    it('un son inconnu est ignore', function () {
      var a = MC.createAudio();
      A.notOk(a.play('nexistepas'));
    });

    it('couper le son empeche toute lecture', function () {
      var a = MC.createAudio();
      A.notOk(a.setEnabled(false), 'coupe');
      A.notOk(a.play('casser'), 'muet meme si WebAudio est disponible');
    });

    it('tous les sons references par le jeu existent', function () {
      ['casser', 'poser', 'ramasser', 'craft', 'frapper', 'blesse', 'mort',
       'manger', 'echange', 'brise', 'sauver'].forEach(function (n) {
        A.ok(typeof MC.createAudio().SONS[n] === 'function', 'son defini : ' + n);
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Sauvegarde', function () {
    function mockStorage() {
      var m = {};
      return {
        getItem: function (k) { return k in m ? m[k] : null; },
        setItem: function (k, v) { m[k] = String(v); },
        removeItem: function (k) { delete m[k]; },
        _dump: m,
      };
    }

    function etat(seed) {
      var w = MC.createWorld(seed || 5);
      w.getChunk(0, 0, true);
      var ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents);
      return { world: w, player: pl, entities: ents, time: 0, furnaces: {} };
    }

    it('une sauvegarde vide se recharge sans erreur', function () {
      var st = mockStorage();
      A.notOk(MC.Save.hasSave(st), 'rien en mémoire');
      A.notOk(MC.Save.load(st, etat()), 'chargement refusé');
    });

    it('les blocs modifiés sont restitués', function () {
      var a = etat(77);
      a.world.setBlock(3, 40, 4, B.BRICK);
      a.world.setBlock(3, 41, 4, B.GLASS);
      var st = mockStorage();
      A.ok(MC.Save.save(st, a), 'sauvegarde écrite');

      var b = etat(77);
      A.ok(MC.Save.load(st, b), 'rechargée');
      b.world.getChunk(0, 0, true);
      A.equal(b.world.getBlock(3, 40, 4), B.BRICK);
      A.equal(b.world.getBlock(3, 41, 4), B.GLASS);
    });

    it('l\'inventaire et la vie sont restitués', function () {
      var a = etat(77);
      a.player.state.inv.add(B.STONE, 42);
      a.player.state.inv.add(I.IRON_PICKAXE, 1);
      a.player.state.hp = 13;
      a.player.state.hunger = 7;
      a.player.state.selected = 3;
      var st = mockStorage();
      MC.Save.save(st, a);

      var b = etat(77);
      MC.Save.load(st, b);
      A.equal(b.player.state.inv.count(B.STONE), 42);
      A.equal(b.player.state.inv.count(I.IRON_PICKAXE), 1);
      A.equal(b.player.state.hp, 13);
      A.equal(b.player.state.hunger, 7);
      A.equal(b.player.state.selected, 3);
    });

    it('la position et l\'heure sont restituées', function () {
      var a = etat(77);
      a.player.state.pos.x = 123.45;
      a.player.state.pos.y = 40.5;
      a.player.state.pos.z = -67.8;
      a.time = 321.5;
      var st = mockStorage();
      MC.Save.save(st, a);
      var b = etat(77);
      MC.Save.load(st, b);
      A.close(b.player.state.pos.x, 123.45, 0.01);
      A.close(b.player.state.pos.z, -67.8, 0.01);
      A.close(b.time, 321.5, 0.1);
    });

    it('les cultures en cours sont restituées', function () {
      var a = etat(77);
      var g = a.world.groundAt(8, 8, true);
      a.world.setBlock(8, g, 8, B.FARMLAND);
      a.world.setBlock(8, g + 1, 8, B.WHEAT1);
      var st = mockStorage();
      MC.Save.save(st, a);
      var b = etat(77);
      MC.Save.load(st, b);
      A.equal(b.world.crops.size, 1, 'la culture est suivie après rechargement');
    });

    it('un fourneau en cours est restitué', function () {
      var a = etat(77);
      a.furnaces['1,2,3'] = { input: { id: B.IRON_ORE, n: 2 }, fuel: { id: I.COAL, n: 1 },
                              output: null, burn: 3.5, cook: 1.25 };
      var st = mockStorage();
      MC.Save.save(st, a);
      var b = etat(77);
      MC.Save.load(st, b);
      var f = b.furnaces['1,2,3'];
      A.ok(f, 'fourneau retrouvé');
      A.equal(f.input.n, 2);
      A.close(f.burn, 3.5, 0.01);
    });

    it('une sauvegarde corrompue est rejetée sans planter', function () {
      var st = mockStorage();
      st.setItem(MC.Save.KEY, '{ pas du json');
      A.notOk(MC.Save.load(st, etat()), 'rejetée proprement');
    });

    it('une version inconnue est rejetée', function () {
      var st = mockStorage();
      st.setItem(MC.Save.KEY, JSON.stringify({ v: 999 }));
      A.notOk(MC.Save.load(st, etat()));
    });

    it('effacer supprime la sauvegarde', function () {
      var st = mockStorage();
      MC.Save.save(st, etat());
      A.ok(MC.Save.hasSave(st));
      MC.Save.clear(st);
      A.notOk(MC.Save.hasSave(st));
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
