/* mesher.js — construit la géométrie d'un chunk sous forme de tableaux bruts.
   Volontairement sans THREE : c'est ce qui rend le maillage testable sous Node.
   La couche rendu emballe ensuite ces tableaux en BufferGeometry. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var CX = C.CHUNK_X, CZ = C.CHUNK_Z, WH = C.WORLD_H, idx = C.idx;

  // doit suivre atlas.js : 16 colonnes depuis l'arrivée des variantes
  var ATLAS_COLS = 16, ATLAS_ROWS = 24;

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

  /* Coordonnées de texture d'un sommet. Deux précautions :
     - on rentre d'un demi-texel dans la tuile : échantillonnée pile sur sa
       frontière, une tuile laisse déborder un pixel de sa voisine dans l'atlas,
       et chaque arête de bloc se soulignait d'un trait sombre ;
     - `rot` fait tourner la tuile d'autant de quarts de tour, pour que le sol
       ne répète pas le même motif à l'identique. */
  var MARGE_UV = 0.5 / 16;
  function pushUV(uvs, tile, u, v, rot) {
    var a = u, b = v;
    if (rot === 1) { a = v; b = 1 - u; }
    else if (rot === 2) { a = 1 - u; b = 1 - v; }
    else if (rot === 3) { a = 1 - v; b = u; }
    a = MARGE_UV + a * (1 - 2 * MARGE_UV);
    b = MARGE_UV + b * (1 - 2 * MARGE_UV);
    var tx = tile % ATLAS_COLS, ty = (tile / ATLAS_COLS) | 0;
    uvs.push((tx + a) / ATLAS_COLS, 1 - (ty + 1 - b) / ATLAS_ROWS);
  }

  // hachage entier d'une position, pour choisir une variante stable
  function hachePos(x, y, z, k) {
    var h = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791) ^ Math.imul(k | 0, 2654435761);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
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
  /* `lumiere` (facultatif) : { niveau(lx, ly, lz) } — la lumière des blocs
     propagée par MC.Lumiere, en coordonnées locales. Elle sort dans `lums`,
     un nombre par sommet de 0 (noir) à 1 (plein éclat d'une source). */
  function buildChunk(chunk, wantPass, sample, lumiere) {
    if (wantPass === false) wantPass = 'opaque';
    else if (wantPass === true) wantPass = 'blend';
    var positions = [], normals = [], uvs = [], colors = [], indices = [], lums = [], ciels = [];
    /* ondes : [nature, sens x, sens z, profondeur] par sommet d'eau (MC.Eau) ;
       immerge : hauteur d'eau au-dessus d'une face noyée (caustiques, pénombre bleue) */
    var ondes = [], immerges = [];
    var niv = lumiere ? lumiere.niveau : null;
    // le ciel : sans calcul de lumière, tout est à ciel ouvert
    var nivC = lumiere && lumiere.ciel ? lumiere.ciel : null;
    function cielEn(x, y, z) { return nivC ? nivC(x, y, z) / 15 : 1; }
    // lumière d'une case, ramenée à [0, 1]
    function profondeurEau(x, y, z) {
      if (!C.isWater(blockAt(x, y, z))) return 0;
      var n = 0;
      while (n < 16 && C.isWater(blockAt(x, y + n, z))) n++;
      return n;
    }
    function lumEn(x, y, z) { return niv ? niv(x, y, z) / 15 : 0; }
    /* Lumière lissée d'un coin de face : moyenne des cases non opaques parmi
       les quatre qui touchent ce coin côté air (même voisinage que l'AO). */
    function lumCoin(bx, by, bz, dir, U, V, su, sv, f) {
      var fn = f || niv;
      if (!fn) return 0;
      var nx = bx + dir[0], ny = by + dir[1], nz = bz + dir[2];
      var s = fn(nx, ny, nz), n = 1;
      var ax = nx + U[0] * su, ay = ny + U[1] * su, az = nz + U[2] * su;
      var bx2 = nx + V[0] * sv, by2 = ny + V[1] * sv, bz2 = nz + V[2] * sv;
      var o1 = occupied(ax, ay, az), o2 = occupied(bx2, by2, bz2);
      if (!o1) { s += fn(ax, ay, az); n++; }
      if (!o2) { s += fn(bx2, by2, bz2); n++; }
      if (!(o1 && o2)) {
        var cx2 = nx + U[0] * su + V[0] * sv, cy2 = ny + U[1] * su + V[1] * sv, cz2 = nz + U[2] * su + V[2] * sv;
        if (!occupied(cx2, cy2, cz2)) { s += fn(cx2, cy2, cz2); n++; }
      }
      return s / n / 15;
    }
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
          ondes.push(0, 0, 0, 0); immerges.push(0);
          lums.push(lumEn(x, y, z));
          ciels.push(cielEn(x, y + 1, z));
        });
        indices.push(s0, s0 + 2, s0 + 1, s0 + 1, s0 + 2, s0 + 3);
        continue;
      }
      if (d.panneau) {
        /* Porte ou trappe : un panneau fin, boîte quelconque dans le cube
           unité (voir core.js `panneau`). On redessine les 6 faces d'un
           cube, comme la boucle générale plus bas, mais mises à l'échelle de
           cette boîte au lieu du cube plein — et sans occlusion ni AO : le
           panneau ne couvre jamais toute la face du bloc voisin. */
        var bx2 = d.panneau;
        for (var pf = 0; pf < 6; pf++) {
          var pface = FACES[pf];
          var ps = positions.length / 3;
          for (var pc = 0; pc < 4; pc++) {
            var pq = pface.corners[pc];
            var ppx = pq[0] === 0 ? bx2.x0 : bx2.x1;
            var ppy = pq[1] === 0 ? bx2.y0 : bx2.y1;
            var ppz = pq[2] === 0 ? bx2.z0 : bx2.z1;
            positions.push(x + ppx, y + ppy, z + ppz);
            normals.push(pface.dir[0], pface.dir[1], pface.dir[2]);
            pushUV(uvs, d.tiles[0], pq[3], pq[4]);
            var pc2 = pface.shade;
            colors.push(pc2, pc2, pc2);
            ondes.push(0, 0, 0, 0);
            immerges.push(0);
            lums.push(niv ? lumEn(x + pface.dir[0], y + pface.dir[1], z + pface.dir[2]) : 0);
            ciels.push(nivC ? cielEn(x + pface.dir[0], y + pface.dir[1], z + pface.dir[2]) : 1);
          }
          indices.push(ps + 1, ps + 3, ps, ps, ps + 3, ps + 2);
        }
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
            ondes.push(0, 0, 0, 0); immerges.push(profondeurEau(x, y + 1, z));
            lums.push(Math.max(lumEn(x, y, z), d.light ? d.light / 15 : 0));
            ciels.push(cielEn(x, y, z));
          }
          indices.push(start0, start0 + 1, start0 + 2, start0 + 2, start0 + 1, start0 + 3);
        }
        continue;
      }

      // l'eau de ce bloc : hauteur de surface, nature, sens, profondeur
      var estEau = !!d.liquid && C.isWater(b), ondeT = 0, ondeFx = 0, ondeFz = 0, ondeP = 0, dropEau = 0.12;
      if (estEau) {
        var niv8 = MC.Eau ? MC.Eau.niveauDe(b) : 8;
        dropEau = C.isWater(blockAt(x, y + 1, z)) ? 0 : (niv8 >= 8 ? 0.12 : 1 - niv8 / 8 * 0.88);
        var colE = z * CX + x, ce = chunk.eau;
        if (MC.Eau && MC.Eau.estCourante(b)) {
          ondeT = MC.Eau.TYPES.ecoulement; ondeP = 1;
          var fc = MC.Eau.fluxCourant(blockAt, x, y, z); ondeFx = fc.x; ondeFz = fc.z;
        } else if (ce && ce.nature[colE]) {
          ondeT = ce.nature[colE]; ondeP = ce.prof[colE];
          ondeFx = ce.flux[colE * 2] / 127; ondeFz = ce.flux[colE * 2 + 1] / 127;
        } else { ondeT = MC.Eau ? MC.Eau.TYPES.lac : 1; ondeP = 3; }
      }
      for (var fi = 0; fi < 6; fi++) {
        var f = FACES[fi];
        var nx = x + f.dir[0], ny = y + f.dir[1], nz = z + f.dir[2];
        var nb = (nx < 0 || nx >= CX || nz < 0 || nz >= CZ || ny < 0 || ny >= WH)
          ? sample(baseX + nx, ny, baseZ + nz)
          : blocks[idx(nx, ny, nz)];
        if (C.occludes(b, nb)) continue;
        if (d.liquid && f.dir[1] === -1) continue;

        // variante et rotation : stables pour ce bloc et cette face
        var dessus = f.dir[1] !== 0;
        var vt = C.tuileVariante(d.tiles[f.t], hachePos(baseX + x, y, baseZ + z, fi), dessus);
        var tile = vt.tile;
        var s = f.shade, start = positions.length / 3;
        var drop = d.liquid ? (estEau ? dropEau : 0.12) : 0;
        // une paroi d'eau qui donne sur le vide : c'est une chute (cascade, filet qui tombe)
        var ondeFace = ondeT;
        if (estEau && f.dir[1] === 0 && !C.isWater(nb) && MC.Eau &&
            (ondeT === MC.Eau.TYPES.ecoulement || ondeT === MC.Eau.TYPES.riviere)) ondeFace = MC.Eau.TYPES.chute;
        var immFace = d.liquid ? 0 : profondeurEau(nx, ny, nz);
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
          pushUV(uvs, tile, q2[3], q2[4], vt.rot);
          var c = s * ao[k];
          colors.push(c, c, c);
          if (estEau) ondes.push(ondeFace, ondeFace === 6 ? f.dir[0] : ondeFx, ondeFace === 6 ? f.dir[2] : ondeFz, ondeP);
          else ondes.push(0, 0, 0, 0);
          immerges.push(immFace);
          if (niv) {
            var suL = (q2[0] * U[0] + q2[1] * U[1] + q2[2] * U[2]) === 1 ? 1 : -1;
            var svL = (q2[0] * V[0] + q2[1] * V[1] + q2[2] * V[2]) === 1 ? 1 : -1;
            lums.push(withAO ? lumCoin(x, y, z, f.dir, U, V, suL, svL) : lumEn(nx, ny, nz));
          } else lums.push(0);
          if (nivC) {
            var suC = (q2[0] * U[0] + q2[1] * U[1] + q2[2] * U[2]) === 1 ? 1 : -1;
            var svC = (q2[0] * V[0] + q2[1] * V[1] + q2[2] * V[2]) === 1 ? 1 : -1;
            ciels.push(withAO ? lumCoin(x, y, z, f.dir, U, V, suC, svC, nivC) : cielEn(nx, ny, nz));
          } else ciels.push(1);
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
             colors: colors, indices: indices, lums: lums, ciels: ciels, ondes: ondes, immerges: immerges };
  }

  MC.Mesher = { buildChunk: buildChunk, FACES: FACES, pushUV: pushUV, hachePos: hachePos, MARGE_UV: MARGE_UV,
                ATLAS_COLS: ATLAS_COLS, ATLAS_ROWS: ATLAS_ROWS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
