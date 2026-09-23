/* mesher.js — construit la géométrie d'un chunk sous forme de tableaux bruts.
   Volontairement sans THREE : c'est ce qui rend le maillage testable sous Node.
   La couche rendu emballe ensuite ces tableaux en BufferGeometry. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var CX = C.CHUNK_X, CZ = C.CHUNK_Z, WH = C.WORLD_H, idx = C.idx;

  var ATLAS_COLS = 8, ATLAS_ROWS = 24;

  // -x, +x, -y, +y, -z, +z.  t = index dans tiles[] (0 dessus, 1 côté, 2 dessous).
  // shade = éclairage directionnel bon marché, encodé en couleur par sommet.
  // corners = [x, y, z, u, v] des 4 sommets.
  var FACES = [
    { dir: [-1, 0, 0], t: 1, shade: 0.72, corners: [[0,1,0,0,1],[0,0,0,0,0],[0,1,1,1,1],[0,0,1,1,0]] },
    { dir: [ 1, 0, 0], t: 1, shade: 0.72, corners: [[1,1,1,0,1],[1,0,1,0,0],[1,1,0,1,1],[1,0,0,1,0]] },
    { dir: [0, -1, 0], t: 2, shade: 0.50, corners: [[1,0,1,1,0],[0,0,1,0,0],[1,0,0,1,1],[0,0,0,0,1]] },
    { dir: [0,  1, 0], t: 0, shade: 1.00, corners: [[0,1,1,1,1],[1,1,1,0,1],[0,1,0,1,0],[1,1,0,0,0]] },
    { dir: [0, 0, -1], t: 1, shade: 0.86, corners: [[1,0,0,0,0],[0,0,0,1,0],[1,1,0,0,1],[0,1,0,1,1]] },
    { dir: [0, 0,  1], t: 1, shade: 0.86, corners: [[0,0,1,0,0],[1,0,1,1,0],[0,1,1,0,1],[1,1,1,1,1]] },
  ];

  // deux quads croisés, pour les plantes (blé)
  var CROSS = [
    [[0.15,0,0.15,0,0],[0.85,0,0.85,1,0],[0.15,1,0.15,0,1],[0.85,1,0.85,1,1]],
    [[0.85,0,0.15,0,0],[0.15,0,0.85,1,0],[0.85,1,0.15,0,1],[0.15,1,0.85,1,1]],
  ];

  function pushUV(uvs, tile, u, v) {
    var tx = tile % ATLAS_COLS, ty = (tile / ATLAS_COLS) | 0;
    uvs.push((tx + u) / ATLAS_COLS, 1 - (ty + 1 - v) / ATLAS_ROWS);
  }

  /* ── Occlusion ambiante par sommet ────────────────────────────────────────
     Pour chaque coin d'une face, on regarde les trois voisins situés DEVANT la
     face (côté air) : les deux arêtes et le coin diagonal. Plus ils sont
     occupés, plus le sommet s'assombrit. C'est ce qui donne du relief aux
     angles rentrants sans aucun calcul d'éclairage.
     Cas particulier : si les deux arêtes sont pleines, le coin est
     complètement enfermé — on force la valeur la plus sombre, sinon une
     diagonale vide l'éclaircirait à tort. */
  // 0.44 combine a l'ombrage d'une face laterale (0.72) donnait 0.32 : des
  // angles rentrants quasi noirs. 0.54 garde le relief sans ecraser la texture.
  var AO_LEVELS = [0.54, 0.70, 0.86, 1.0];

  // axes perpendiculaires à chaque direction, calculés une fois
  function tangents(dir) {
    if (dir[0] !== 0) return [[0, 1, 0], [0, 0, 1]];
    if (dir[1] !== 0) return [[1, 0, 0], [0, 0, 1]];
    return [[1, 0, 0], [0, 1, 0]];
  }

  function cornerAO(occupied, bx, by, bz, dir, U, V, su, sv) {
    var nx = bx + dir[0], ny = by + dir[1], nz = bz + dir[2];
    var s1 = occupied(nx + U[0] * su, ny + U[1] * su, nz + U[2] * su) ? 1 : 0;
    var s2 = occupied(nx + V[0] * sv, ny + V[1] * sv, nz + V[2] * sv) ? 1 : 0;
    if (s1 && s2) return AO_LEVELS[0];
    var c = occupied(nx + U[0] * su + V[0] * sv,
                     ny + U[1] * su + V[1] * sv,
                     nz + U[2] * su + V[2] * sv) ? 1 : 0;
    return AO_LEVELS[3 - (s1 + s2 + c)];
  }

  /* Construit UNE passe de rendu d'un chunk : 'opaque', 'cutout' ou 'blend'.
     `sample(wx, wy, wz)` lit le monde, y compris hors du chunk : c'est ce qui
     supprime les coutures aux frontières.
     (Un booléen est accepté pour compatibilité : false = opaque, true = blend.) */
  function buildChunk(chunk, wantPass, sample) {
    if (wantPass === false) wantPass = 'opaque';
    else if (wantPass === true) wantPass = 'blend';
    var positions = [], normals = [], uvs = [], colors = [], indices = [];
    var baseX = chunk.cx * CX, baseZ = chunk.cz * CZ;
    var blocks = chunk.blocks;

    // lecture d'un bloc en coordonnées LOCALES au chunk, avec repli sur le monde
    function blockAt(x, y, z) {
      if (y < 0 || y >= WH) return 0;
      if (x < 0 || x >= CX || z < 0 || z >= CZ) return sample(baseX + x, y, baseZ + z);
      return blocks[idx(x, y, z)];
    }
    // un voisin « occupe » le coin s'il est opaque : ni air, ni plante, ni liquide,
    // ni transparent (le verre ne doit pas projeter d'ombre de contact)
    function occupied(x, y, z) {
      var b = blockAt(x, y, z);
      if (b === 0) return false;
      var dd = C.BLOCKS[b];
      return !!dd && !dd.plant && !dd.liquid && !dd.transparent;
    }

    for (var y = 0; y < WH; y++)
    for (var z = 0; z < CZ; z++)
    for (var x = 0; x < CX; x++) {
      var b = blocks[idx(x, y, z)];
      if (b === 0) continue;
      var d = C.BLOCKS[b];
      if (!d) continue;
      if (C.passOf(b) !== wantPass) continue;

      if (d.plat) {
        // posé à plat (rails) : un seul quad, un cheveu au-dessus du sol
        var s0 = positions.length / 3;
        [[0, 0, 0, 0], [1, 0, 1, 0], [0, 1, 0, 1], [1, 1, 1, 1]].forEach(function (p) {
          positions.push(x + p[0], y + 0.02, z + p[1]);
          normals.push(0, 1, 0);
          pushUV(uvs, d.tiles[0], p[2], p[3]);
          colors.push(1, 1, 1);
        });
        indices.push(s0, s0 + 2, s0 + 1, s0 + 1, s0 + 2, s0 + 3);
        continue;
      }
      if (d.plant) {
        // plante : deux quads croisés, visibles des deux côtés
        for (var q = 0; q < 2; q++) {
          var start0 = positions.length / 3;
          for (var ci = 0; ci < 4; ci++) {
            var p = CROSS[q][ci];
            positions.push(x + p[0], y + p[1], z + p[2]);
            normals.push(0, 1, 0);
            pushUV(uvs, d.tiles[0], p[3], p[4]);
            colors.push(1, 1, 1);
          }
          indices.push(start0, start0 + 1, start0 + 2, start0 + 2, start0 + 1, start0 + 3);
        }
        continue;
      }

      for (var fi = 0; fi < 6; fi++) {
        var f = FACES[fi];
        var nx = x + f.dir[0], ny = y + f.dir[1], nz = z + f.dir[2];
        var nb = (nx < 0 || nx >= CX || nz < 0 || nz >= CZ || ny < 0 || ny >= WH)
          ? sample(baseX + nx, ny, baseZ + nz)
          : blocks[idx(nx, ny, nz)];
        if (C.occludes(b, nb)) continue;
        if (d.liquid && f.dir[1] === -1) continue;

        var tile = d.tiles[f.t];
        var s = f.shade, start = positions.length / 3;
        var drop = d.liquid ? 0.12 : 0;
        var tg = tangents(f.dir), U = tg[0], V = tg[1];
        // l'occlusion ne s'applique pas aux surfaces liquides : elle y produit
        // des taches sombres alors que l'eau n'a pas d'angles rentrants nets
        var withAO = !d.liquid;
        var ao = [1, 1, 1, 1];

        for (var k = 0; k < 4; k++) {
          var q2 = f.corners[k];
          if (withAO) {
            // signe du coin sur chaque axe tangent : +1 si la coordonnée vaut 1
            var su = (q2[0] * U[0] + q2[1] * U[1] + q2[2] * U[2]) === 1 ? 1 : -1;
            var sv = (q2[0] * V[0] + q2[1] * V[1] + q2[2] * V[2]) === 1 ? 1 : -1;
            ao[k] = cornerAO(occupied, x, y, z, f.dir, U, V, su, sv);
          }
          positions.push(x + q2[0], y + q2[1] - (q2[1] === 1 ? drop : 0), z + q2[2]);
          normals.push(f.dir[0], f.dir[1], f.dir[2]);
          pushUV(uvs, tile, q2[3], q2[4]);
          var c = s * ao[k];
          colors.push(c, c, c);
        }

        /* Le quad se découpe en deux triangles ; choisir la mauvaise diagonale
           fait apparaître un pli lumineux en escalier sur les angles. On coupe
           selon la diagonale dont les extrémités sont les plus proches en AO. */
        if (ao[0] + ao[3] > ao[1] + ao[2]) {
          indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
        } else {
          indices.push(start + 1, start + 3, start, start, start + 3, start + 2);
        }
      }
    }

    if (!indices.length) return null;
    return { positions: positions, normals: normals, uvs: uvs,
             colors: colors, indices: indices };
  }

  MC.Mesher = { buildChunk: buildChunk, FACES: FACES,
                ATLAS_COLS: ATLAS_COLS, ATLAS_ROWS: ATLAS_ROWS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
