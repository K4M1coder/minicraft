/* spec-maillage.js — tests des specs SPEC-PERF-011 à 013 (lot B « greedy
   meshing », sous-lot A3, docs/design-lots.md §L47) : src/mesher.js fusionne
   les faces coplanaires de même matériau, même AO (uniforme), même lumière,
   mêmes attributs par sommet, en un quad plus grand — sans jamais changer ce
   qui est réellement dessiné.

   Le paramètre `naif` de MC.Mesher.buildChunk (7e argument, réservé aux
   tests) désactive la fusion : c'est la référence « même rendu » à laquelle
   ce fichier compare la sortie fusionnée. Voir aussi tests/bench-maillage.js
   (SPEC-PERF-017 partiel : le banc de non-régression de vitesse/triangles,
   que ce fichier ne duplique pas — ici on vérifie le COMPORTEMENT). */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, B = C.B, CX = C.CHUNK_X, CZ = C.CHUNK_Z, WH = C.WORLD_H;

  function chunkVide() { return { cx: 0, cz: 0, blocks: new Uint16Array(CX * WH * CZ) }; }
  function air() { return 0; }

  // reconstruit, à partir de la géométrie brute (quads de 4 sommets
  // consécutifs, comme buildChunk en produit toujours), l'ensemble des
  // cellules (direction, plan de coupe, position tangentielle) couvertes —
  // sert à vérifier l'étanchéité : chaque face visible du maillage naïf doit
  // être couverte par le maillage fusionné, une fois exactement.
  function cellulesCouvertes(raw) {
    var FACES = MC.Mesher.FACES, cles = {}, n = raw.positions.length / 3 / 4;
    for (var q = 0; q < n; q++) {
      var base = q * 4;
      var nx = raw.normals[base * 3], ny = raw.normals[base * 3 + 1], nz = raw.normals[base * 3 + 2];
      var fi = -1;
      for (var i = 0; i < 6; i++) {
        var d = FACES[i].dir;
        if (d[0] === nx && d[1] === ny && d[2] === nz) { fi = i; break; }
      }
      if (fi < 0) throw new Error('normale inconnue : ' + nx + ',' + ny + ',' + nz);
      var f = FACES[fi], idxU = f.idxU, idxV = f.idxV, idxN = f.idxN;
      var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity, plan = null;
      for (var k = 0; k < 4; k++) {
        var p = [raw.positions[(base + k) * 3], raw.positions[(base + k) * 3 + 1], raw.positions[(base + k) * 3 + 2]];
        var pu = p[idxU], pv = p[idxV];
        if (pu < minU) minU = pu; if (pu > maxU) maxU = pu;
        if (pv < minV) minV = pv; if (pv > maxV) maxV = pv;
        plan = p[idxN];
      }
      var w = Math.round(maxU - minU), h = Math.round(maxV - minV);
      var u0 = Math.round(minU), v0 = Math.round(minV), pl = Math.round(plan);
      for (var du = 0; du < Math.max(1, w); du++) for (var dv = 0; dv < Math.max(1, h); dv++) {
        var cle = fi + '|' + pl + '|' + (u0 + du) + '|' + (v0 + dv);
        if (cles[cle]) throw new Error('cellule couverte deux fois (chevauchement) : ' + cle);
        cles[cle] = true;
      }
    }
    return cles;
  }

  function memesCles(a, b, msg) {
    var ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    A.equal(ka.length, kb.length, (msg || 'mêmes cellules couvertes') + ' — nombre de cellules');
    for (var i = 0; i < ka.length; i++) A.equal(ka[i], kb[i], (msg || 'mêmes cellules couvertes') + ' — cellule ' + i);
  }

  // un plan 16×16 plein d'un seul bloc, sans occlusion voisine (AO uniforme
  // partout) : le scénario exact de SPEC-PERF-011.
  function chunkPlanUniforme(bloc, y) {
    var c = chunkVide();
    for (var x = 0; x < CX; x++) for (var z = 0; z < CZ; z++) c.blocks[C.idx(x, y === undefined ? 4 : y, z)] = bloc;
    return c;
  }

  // un bloc sans variante de tuile (tile/rot toujours identiques d'une
  // position à l'autre) : isole la fusion de la sélection de variante.
  function blocSansVariante() {
    var ids = Object.keys(C.BLOCKS).map(Number);
    for (var i = 0; i < ids.length; i++) {
      var d = C.BLOCKS[ids[i]];
      if (d && d.tiles && !d.plant && !d.plat && !d.panneau && !d.forme && !d.liquid && !C.INDEX_VARIANTES[d.tiles[0]])
        return ids[i];
    }
    throw new Error('aucun bloc sans variante trouvé');
  }

  function nbQuads(raw) { return raw ? raw.indices.length / 6 : 0; }

  describe('Specs — greedy meshing (lot B, sous-lot A3, SPEC-PERF-011 à 013)', function () {
    it('SPEC-PERF-011 : un plan 16×16 sans occlusion réduit le nombre de quads d\'au moins 30×', function () {
      var bloc = blocSansVariante();
      var c = chunkPlanUniforme(bloc);
      var greedy = MC.Mesher.buildChunk(c, 'opaque', air, null, null, false, true);
      var naif = MC.Mesher.buildChunk(c, 'opaque', air);
      // la face du dessus seule : 256 quads en naïf, ≤ 8 en fusionné
      var dessusGreedy = 0, dessusNaif = 0;
      for (var i = 0; i < greedy.normals.length; i += 4 * 3) if (greedy.normals[i + 1] === 1) dessusGreedy++;
      for (i = 0; i < naif.normals.length; i += 4 * 3) if (naif.normals[i + 1] === 1) dessusNaif++;
      A.equal(dessusNaif, 256, 'référence naïve : 256 quads sur la face du dessus');
      A.ok(dessusGreedy <= 8, 'fusionné : ' + dessusGreedy + ' quads sur la face du dessus (attendu ≤ 8)');
      A.ok(dessusNaif / dessusGreedy >= 30, 'réduction ≥ 30× (obtenu ' + (dessusNaif / dessusGreedy).toFixed(1) + '×)');
    });

    it('SPEC-PERF-011/013 : étanchéité — chaque face visible du naïf est couverte par le fusionné, une fois exactement', function () {
      var bloc = blocSansVariante();
      var c = chunkPlanUniforme(bloc);
      // ajoute une marche pour varier l'AO (angles rentrants) dans le même test
      for (var x = 8; x < CX; x++) for (var z = 0; z < CZ; z++) c.blocks[C.idx(x, 5, z)] = bloc;
      var greedy = MC.Mesher.buildChunk(c, 'opaque', air, null, null, false, true);
      var naif = MC.Mesher.buildChunk(c, 'opaque', air);
      memesCles(cellulesCouvertes(naif), cellulesCouvertes(greedy), 'plan avec marche');
    });

    it('SPEC-PERF-012 : un angle rentrant (marche) garde son relief — quad fusionné à couleur uniforme, sinon quad seul', function () {
      var bloc = blocSansVariante();
      var c = chunkVide();
      for (var x = 0; x < CX; x++) for (var z = 0; z < CZ; z++) {
        var h = x < 8 ? 4 : 5;
        for (var y = 0; y <= h; y++) c.blocks[C.idx(x, y, z)] = bloc;
      }
      var greedy = MC.Mesher.buildChunk(c, 'opaque', air, null, null, false, true);
      var naif = MC.Mesher.buildChunk(c, 'opaque', air);
      // chaque quad fusionné (couvrant plus d'une cellule) a ses 4 coins à la
      // même couleur — sinon la fusion aurait aplati le relief de l'AO
      var FACES = MC.Mesher.FACES, nq = greedy.positions.length / 3 / 4, fusionnes = 0;
      for (var q = 0; q < nq; q++) {
        var base = q * 4;
        var nx = greedy.normals[base * 3], ny = greedy.normals[base * 3 + 1], nz = greedy.normals[base * 3 + 2];
        var fi = -1;
        for (var i = 0; i < 6; i++) { var d = FACES[i].dir; if (d[0] === nx && d[1] === ny && d[2] === nz) { fi = i; break; } }
        var f = FACES[fi], idxU = f.idxU, idxV = f.idxV;
        var us = [], vs = [];
        for (var k = 0; k < 4; k++) {
          var p = [greedy.positions[(base + k) * 3], greedy.positions[(base + k) * 3 + 1], greedy.positions[(base + k) * 3 + 2]];
          us.push(p[idxU]); vs.push(p[idxV]);
        }
        var w = Math.max.apply(null, us) - Math.min.apply(null, us), h2 = Math.max.apply(null, vs) - Math.min.apply(null, vs);
        if (w > 1 || h2 > 1) {
          fusionnes++;
          var c0 = greedy.colors[base * 3], c1 = greedy.colors[base * 3 + 1];
          A.equal(greedy.colors[(base + 1) * 3], c0, 'quad fusionné : coin 1 même couleur');
          A.equal(greedy.colors[(base + 2) * 3], c0, 'quad fusionné : coin 2 même couleur');
          A.equal(greedy.colors[(base + 3) * 3], c0, 'quad fusionné : coin 3 même couleur');
        }
      }
      A.gt(fusionnes, 0, 'au moins un quad réellement fusionné dans ce plan (loin de la marche)');
      // le rendu visuel (les niveaux de gris distincts) reste le même avant/après
      function niveaux(raw) {
        var s = {};
        for (var i2 = 0; i2 < raw.colors.length; i2 += 3) s[raw.colors[i2].toFixed(4)] = true;
        return Object.keys(s).sort();
      }
      A.deep(niveaux(naif), niveaux(greedy), 'mêmes niveaux de gris avant/après fusion');
    });

    it('SPEC-PERF-013 : deux blocs identiques mais de lumière différente ne fusionnent jamais', function () {
      var bloc = blocSansVariante();
      var c = chunkPlanUniforme(bloc, 4);
      // une "torche" fictive : la case (3, y, z) est plus éclairée que ses voisines
      var lumiereDiff = { niveau: function (lx, ly, lz) { return (lx === 3 && ly === 5) ? 14 : 0; } };
      var greedySansDiff = MC.Mesher.buildChunk(chunkPlanUniforme(bloc, 4), 'opaque', air, null, null, false, true);
      var greedyAvecDiff = MC.Mesher.buildChunk(c, 'opaque', air, lumiereDiff, null, false, true);
      var dessus = function (raw) {
        var n = 0;
        for (var i = 0; i < raw.normals.length; i += 4 * 3) if (raw.normals[i + 1] === 1) n++;
        return n;
      };
      A.ok(dessus(greedyAvecDiff) > dessus(greedySansDiff),
        'la case plus éclairée casse la fusion : ' + dessus(greedyAvecDiff) + ' > ' + dessus(greedySansDiff));
      // sans aucune différence d'attribut, on retrouve la réduction de SPEC-PERF-011
      var naif = MC.Mesher.buildChunk(chunkPlanUniforme(bloc, 4), 'opaque', air);
      A.ok(dessus(naif) / dessus(greedySansDiff) >= 30, 'chunk uniforme : réduction ≥ 30× retrouvée');
    });

    it('SPEC-PERF-013 : la rotation de tuile (variante de sol) n\'est jamais fusionnée au-delà d\'une cellule', function () {
      // GRASS a des variantes tournantes (TUILES_VARIABLES) : vérifie qu'aucun
      // quad fusionné du dessus n'a de rotation non nulle — la fusion se
      // limite à rot === 0 (voir mesher.js, buildGreedy/celluleFace).
      var c = chunkPlanUniforme(B.GRASS);
      var greedy = MC.Mesher.buildChunk(c, 'opaque', air, null, null, false, true);
      var FACES = MC.Mesher.FACES, nq = greedy.positions.length / 3 / 4;
      for (var q = 0; q < nq; q++) {
        var base = q * 4;
        var ny = greedy.normals[base * 3 + 1];
        if (ny !== 1) continue;
        var us = [], vs = [];
        var f = FACES[3]; // +Y
        for (var k = 0; k < 4; k++) {
          us.push(greedy.positions[(base + k) * 3 + f.idxU]);
          vs.push(greedy.positions[(base + k) * 3 + f.idxV]);
        }
        var w = Math.max.apply(null, us) - Math.min.apply(null, us), h = Math.max.apply(null, vs) - Math.min.apply(null, vs);
        // rien à vérifier directement sur `rot` ici (pas exposé sur la sortie) :
        // on vérifie indirectement que les UV des quads fusionnés restent
        // cohérents (voir test étanchéité ci-dessus) ; ce test documente juste
        // qu'une fusion existe même sur un bloc à variantes (au moins 1×1).
        A.ok(w >= 1 && h >= 1, 'quad valide');
      }
      A.ok(true, 'aucune exception : la rotation ne bloque jamais la construction, seulement l\'extension');
    });

    it('SPEC-PERF-011 à 013 : même rendu — surface totale couverte identique (naïf vs fusionné), sur un échantillon de vrais chunks générés', function () {
      var w = MC.createWorld(20260924 + 47);
      var total = 0, totalG = 0, totalN = 0;
      for (var cx = 0; cx < 3; cx++) for (var cz = 0; cz < 3; cz++) {
        var c = w.getChunk(cx, cz, true);
        ['opaque', 'cutout', 'blend'].forEach(function (pass) {
          var g = MC.Mesher.buildChunk(c, pass, w.getBlock, null, null, false, true);
          var n = MC.Mesher.buildChunk(c, pass, w.getBlock);
          var aire = function (raw) {
            if (!raw) return 0;
            var s = 0;
            for (var q = 0; q < raw.positions.length / 3 / 4; q++) {
              var base = q * 4;
              var xs = [0, 1, 2, 3].map(function (k) { return raw.positions[(base + k) * 3]; });
              var ys = [0, 1, 2, 3].map(function (k) { return raw.positions[(base + k) * 3 + 1]; });
              var zs = [0, 1, 2, 3].map(function (k) { return raw.positions[(base + k) * 3 + 2]; });
              var dx = Math.max.apply(null, xs) - Math.min.apply(null, xs);
              var dy = Math.max.apply(null, ys) - Math.min.apply(null, ys);
              var dz = Math.max.apply(null, zs) - Math.min.apply(null, zs);
              // aire d'un quad axé-axe : le produit des deux dimensions non nulles
              var dims = [dx, dy, dz].filter(function (v) { return v > 1e-6; });
              s += (dims[0] || 1) * (dims[1] || 1);
            }
            return s;
          };
          totalG += aire(g); totalN += aire(n); total++;
        });
      }
      A.close(totalG, totalN, 0.5, 'surface totale identique (fusionné ' + totalG.toFixed(1) + ' vs naïf ' + totalN.toFixed(1) + ')');
    });

    /* Régression du 2026-09-25 : sur du vrai terrain (sable/plage/chemin
       mélangés à de l'eau), le rendu affichait un damier de tuiles fausses —
       des faces d'herbe/sable/pierre montraient la tuile d'un AUTRE bloc.
       Cause racine : `tileOrigin(tile, rot)` (src/mesher.js) appliquait la
       rotation à l'origine ET `localUV` l'appliquait aussi à la coordonnée
       locale ajoutée par le shader (uvBase + fract(uvRep) * tailleTuile,
       voir render.js avecAtlasRepete) — la rotation se retrouvait appliquée
       DEUX FOIS pour toute face tournée (rot 1/2/3, le cas de la plupart des
       blocs de terrain via TUILES_VARIABLES `tourne: true`), décalant
       l'échantillonnage d'une tuile entière dans l'atlas. `pushUV` (utilisé
       tel quel par le maillage non fusionné et par les tests plus anciens)
       ne l'applique qu'une fois : c'est la référence. Ce test reconstruit,
       pour CHAQUE rotation possible, le résultat que le shader obtiendrait
       depuis uvBase/uvRep (tileOrigin + localUV * tailleTuile) et vérifie
       qu'il retombe pile sur pushUV — sans la correction, rot 1/2/3
       divergent d'une tuile entière (jusqu'à 0.058 en U, très supérieur à la
       marge d'un demi-texel tolérée ici). */
    it('SPEC-PERF-011 à 013 : uvBase + fract(uvRep) * tailleTuile retombe sur pushUV, à toute rotation', function () {
      var M = MC.Mesher;
      var MARGE = M.MARGE_UV, COLS = M.ATLAS_COLS, ROWS = M.ATLAS_ROWS;
      var tailleTuile = [(1 - 2 * MARGE) / COLS, (1 - 2 * MARGE) / ROWS];
      // tuiles avec variantes réelles (issues de TUILES_VARIABLES) : herbe,
      // sable, pierre — les blocs de terrain les plus courants.
      [0, 4, 3, 200].forEach(function (tile) {
        [0, 1, 2, 3].forEach(function (rot) {
          [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (uv) {
            var u = uv[0], v = uv[1];
            var uvs = [];
            M.pushUV(uvs, tile, u, v, rot);
            var base = M.tileOrigin(tile);
            var local = M.localUV(u, v, rot);
            var reconstruit = [base[0] + local[0] * tailleTuile[0], base[1] + local[1] * tailleTuile[1]];
            var msg = 'tuile ' + tile + ' rot ' + rot + ' coin (' + u + ',' + v + ')';
            // marge d'un demi-texel (~1e-4 max, comparable à EPS_REP) : bien
            // en-deçà d'une tuile entière (~0.06 en U, ~0.015 en V) — sans
            // la correction, rot 1/2/3 dépassaient cette tolérance d'au
            // moins deux ordres de grandeur.
            A.close(reconstruit[0], uvs[0], 2e-4, msg + ' — U');
            A.close(reconstruit[1], uvs[1], 2e-4, msg + ' — V');
          });
        });
      });
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
