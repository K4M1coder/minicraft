/* mesher.js — construit la géométrie d'un chunk sous forme de tableaux bruts.
   Volontairement sans THREE : c'est ce qui rend le maillage testable sous Node.
   La couche rendu emballe ensuite ces tableaux en BufferGeometry. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var CX = C.CHUNK_X, CZ = C.CHUNK_Z, WH = C.WORLD_H, idx = C.idx;

  // doit suivre atlas.js : 16 colonnes depuis l'arrivée des variantes
  var ATLAS_COLS = 16, ATLAS_ROWS = 64;

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

  /* ── Greedy meshing (SPEC-PERF-011 à 013) ────────────────────────────────
     Précalcul, une fois par direction, de deux choses nécessaires pour
     étendre un quad fusionné :
     - idxU/idxV/idxN : quel axe (0=x, 1=y, 2=z) est tangent U, tangent V, ou
       normal à la face — pour reconstruire la position d'un coin étendu.
     - repTu/repTv : la relation affine entre (compU, compV) — la position du
       coin en coordonnées tangentielles pures, 0 ou 1 — et (tu, tv), le
       paramètre de texture réellement utilisé par pushUV pour ce coin
       (l'ordre/l'inversion diffère selon la face, pour garder les textures
       "à l'endroit"). Elle permet d'étendre tu/tv à un quad W×H sans changer
       l'orientation d'un quad non fusionné (W=H=1 restitue exactement tu/tv). */
  (function () {
    for (var i = 0; i < FACES.length; i++) {
      var f = FACES[i], tg = tangents(f.dir), U = tg[0], V = tg[1];
      var idxU = U[0] ? 0 : (U[1] ? 1 : 2);
      var idxV = V[0] ? 0 : (V[1] ? 1 : 2);
      f.idxU = idxU; f.idxV = idxV; f.idxN = 3 - idxU - idxV;
      var c00 = null, c10 = null, c01 = null;
      for (var k = 0; k < 4; k++) {
        var c = f.corners[k];
        if (c[idxU] === 0 && c[idxV] === 0) c00 = c;
        else if (c[idxU] === 1 && c[idxV] === 0) c10 = c;
        else if (c[idxU] === 0 && c[idxV] === 1) c01 = c;
      }
      f.repTu = { base: c00[3], cu: c10[3] - c00[3], cv: c01[3] - c00[3] };
      f.repTv = { base: c00[4], cu: c10[4] - c00[4], cv: c01[4] - c00[4] };
    }
  })();

  /* Origine (coin local 0,0 après rotation) d'une tuile dans l'atlas, avec la
     même marge d'un demi-texel que pushUV. Sert de base à l'échantillonnage
     répété d'un quad fusionné (voir avecLumiereDesBlocs dans render.js : le
     shader ajoute fract(uvRep) * tailleTuile à cette origine). */
  function tileOrigin(tile, rot) {
    var a = 0, b = 0;
    if (rot === 1) { a = 0; b = 1; }
    else if (rot === 2) { a = 1; b = 1; }
    else if (rot === 3) { a = 1; b = 0; }
    a = MARGE_UV + a * (1 - 2 * MARGE_UV);
    b = MARGE_UV + b * (1 - 2 * MARGE_UV);
    var tx = tile % ATLAS_COLS, ty = (tile / ATLAS_COLS) | 0;
    return [(tx + a) / ATLAS_COLS, 1 - (ty + 1 - b) / ATLAS_ROWS];
  }
  // recul infime pour qu'un coin "au bout" (u=W, v=H) retombe juste avant
  // l'entier côté shader (fract(1.0) vaudrait 0, ce qui retomberait sur le
  // mauvais bord de la tuile) — sans effet visible (bien en-deçà du texel).
  var EPS_REP = 1e-4;
  function localUV(u, v, rot) {
    var a = u, b = v;
    if (rot === 1) { a = v; b = 1 - u; }
    else if (rot === 2) { a = 1 - u; b = 1 - v; }
    else if (rot === 3) { a = 1 - v; b = u; }
    if (a > 0) a -= EPS_REP;
    if (b > 0) b -= EPS_REP;
    return [a, b];
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
  /* `eauDe(wx, wz)` (facultatif) : { nature, flux:{x,z}, prof } d'une colonne
     d'un autre chunk — sans lui, les coins au bord du chunk ne se moyennent
     qu'avec les colonnes du chunk. */
  /* `simplifie` : un chunk lointain se passe des petites plantes (herbes,
     fleurs) — autant de faces en moins, invisibles à cette distance. */
  /* `fusion` (facultatif, SPEC-PERF-011 à 013) : active le greedy meshing des
     blocs pleins non liquides. Par défaut (omis/faux), buildChunk reproduit
     à l'identique — même géométrie, même ORDRE de sommets — le maillage
     face-par-bloc d'avant ce lot : plusieurs tests plus anciens (tests/unit.js)
     lisent des sommets à un index fixe en s'appuyant sur cet ordre, et ce
     fichier n'a pas le droit d'y toucher. render.js (rendu réel) passe donc
     explicitement `true` ; l'absence du paramètre reste la référence « même
     rendu » utilisée par tests/spec-maillage.js et tests/bench-maillage.js. */
  function buildChunk(chunk, wantPass, sample, lumiere, eauDe, simplifie, fusion) {
    if (wantPass === false) wantPass = 'opaque';
    else if (wantPass === true) wantPass = 'blend';
    var positions = [], normals = [], uvs = [], colors = [], indices = [], lums = [], ciels = [];
    /* uvBases/uvReps : coordonnées d'atlas « dépliées » pour la répétition de
       texture d'un quad fusionné (voir tileOrigin/localUV ci-dessus) — même
       longueur que positions/3, pour tout type de géométrie (cube, plante,
       panneau…), afin que render.js n'ait qu'un seul format d'attribut à lire. */
    var uvBases = [], uvReps = [];
    function pushUVFull(tile, u, v, rot) {
      pushUV(uvs, tile, u, v, rot || 0);
      var ob = tileOrigin(tile, rot || 0);
      uvBases.push(ob[0], ob[1]);
      var lc = localUV(u, v, rot || 0);
      uvReps.push(lc[0], lc[1]);
    }
    /* ondes  : [amplitude, longueur, vitesse, écume] par sommet d'eau ;
       ondes2 : [sens x, sens z, part du courant, drapeaux (1 surface, 2 chute)] ;
       immerge : hauteur d'eau au-dessus d'une face noyée (caustiques, pénombre bleue).
       Les paramètres sont moyennés par COIN sur les colonnes d'eau voisines :
       deux faces qui partagent un coin l'agitent exactement pareil, sans fissure. */
    var ondes = [], ondes2 = [], immerges = [];
    /* souples : ce que le vent fait bouger, par sommet — 1 au sommet d'une herbe,
       d'une fleur ou d'une culture (pied fixe à 0), 0,2 pour tout le feuillage,
       0 pour le reste (blocs pleins, torches, échelles, toiles…) */
    var souples = [];
    /* feuillage : classe par sommet pour la teinte saisonnière du rendu
       (SPEC-SAISON-004) — 0 rien, 1 feuillage caduc, 2 conifère, 3 dessus
       d'herbe. Un uniform de saison (calculé une fois par image) suffit alors
       à tout teinter, sans reconstruire les chunks à chaque changement. */
    var feuillages = [];
    function plantePliable(d2) { return !!d2.plant && !d2.light && !d2.grimpable && !d2.ralentit && !d2.plat && !d2.needsSupportMur; }
    var cacheEau = {};
    function paramsEau(lx, y, lz) {
      var cle = lx + ',' + y + ',' + lz;
      if (cle in cacheEau) return cacheEau[cle];
      var id = blockAt(lx, y, lz), r = null;
      if (MC.Eau && C.isWater(id) && C.BLOCKS[id] && C.BLOCKS[id].liquid) {
        var nat, fx = 0, fz = 0, prof = 3;
        if (MC.Eau.estCourante(id)) {
          nat = 'ecoulement'; prof = 1;
          var fc = MC.Eau.fluxCourant(blockAt, lx, y, lz); fx = fc.x; fz = fc.z;
        } else {
          var info = null;
          if (lx >= 0 && lx < CX && lz >= 0 && lz < CZ && chunk.eau) {
            var k = lz * CX + lx;
            if (chunk.eau.nature[k]) info = { nature: chunk.eau.nature[k], flux: { x: chunk.eau.flux[k * 2] / 127, z: chunk.eau.flux[k * 2 + 1] / 127 }, prof: chunk.eau.prof[k] };
          } else if (eauDe) info = eauDe(baseX + lx, baseZ + lz);
          nat = info && info.nature ? MC.Eau.NOMS[info.nature] : 'lac';
          if (info) { fx = info.flux.x; fz = info.flux.z; prof = info.prof; }
        }
        var p = MC.Eau.PARAMS[nat];
        var A = p.amplitude, E = p.ecume, K = p.courant;
        // vagues de rivage : plus haut, plus d'écume, tournées vers la plage quand le fond remonte
        if (nat === 'lac' || nat === 'mer' || nat === 'ocean') {
          var rv = 1 - Math.min(1, prof / 8);
          A *= 1 + 2.5 * rv; E = Math.max(E, rv > 0.5 ? (rv - 0.5) / 0.5 * 0.9 : 0); K = Math.max(K, rv);
        }
        r = { A: A, L: p.longueur, V: p.vitesse, E: E, K: K, fx: fx, fz: fz };
      }
      cacheEau[cle] = r;
      return r;
    }
    // moyenne des paramètres des colonnes d'eau autour d'un coin (cx, cz) au niveau y
    function paramsCoin(cx, y, cz, defaut) {
      var n = 0, s = { A: 0, L: 0, V: 0, E: 0, K: 0, fx: 0, fz: 0 };
      for (var a = -1; a <= 0; a++) for (var b = -1; b <= 0; b++) {
        var p = paramsEau(cx + a, y, cz + b);
        if (!p) continue;
        n++; for (var k in s) s[k] += p[k];
      }
      if (!n) return defaut;
      for (var k2 in s) s[k2] /= n;
      return s;
    }
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
          pushUVFull(d.tiles[0], p[2], p[3], 0);
          colors.push(1, 1, 1);
          ondes.push(0, 0, 0, 0); ondes2.push(0, 0, 0, 0); immerges.push(0); souples.push(0);
          feuillages.push(0);
          lums.push(lumEn(x, y, z));
          ciels.push(cielEn(x, y + 1, z));
        });
        indices.push(s0, s0 + 2, s0 + 1, s0 + 1, s0 + 2, s0 + 3);
        continue;
      }
      /* Porte, trappe (`panneau`, une boîte) ou escalier/dalle/clôture/muret/
         vitre/rambarde (`forme`, L24, une ou plusieurs boîtes selon l'état
         et les voisins — voir MC.Formes.boitesBloc). On redessine les 6
         faces de chaque boîte, comme la boucle générale plus bas, mais mises
         à l'échelle de cette boîte au lieu du cube plein — et sans
         occlusion ni AO : aucune de ces boîtes ne couvre jamais toute la
         face du bloc voisin. */
      if (d.panneau || d.forme) {
        var boitesForme = d.panneau ? [d.panneau]
          : MC.Formes.boitesBloc(d, chunk.etats ? chunk.etats[idx(x, y, z)] : 0,
              function (dx, dz) {
                var nid = blockAt(x + dx, y, z + dz);
                if (!nid) return { plein: false, memeType: false };
                var nd = C.BLOCKS[nid];
                return { plein: C.isSolid(nid), memeType: !!(nd && nd.forme === d.forme) };
              });
        for (var bxi = 0; bxi < boitesForme.length; bxi++) {
          var bx2 = boitesForme[bxi];
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
              pushUVFull(d.tiles[pface.t], pq[3], pq[4], 0);
              var pc2 = pface.shade;
              colors.push(pc2, pc2, pc2);
              ondes.push(0, 0, 0, 0); ondes2.push(0, 0, 0, 0);
              immerges.push(0); souples.push(0); feuillages.push(0);
              lums.push(niv ? lumEn(x + pface.dir[0], y + pface.dir[1], z + pface.dir[2]) : 0);
              ciels.push(nivC ? cielEn(x + pface.dir[0], y + pface.dir[1], z + pface.dir[2]) : 1);
            }
            indices.push(ps + 1, ps + 3, ps, ps, ps + 3, ps + 2);
          }
        }
        continue;
      }
      if (d.plant && simplifie && plantePliable(d) && !d.aquatique) continue;
      if (d.plant) {
        // plante : deux quads croisés, visibles des deux côtés
        for (var q = 0; q < 2; q++) {
          var start0 = positions.length / 3;
          for (var ci = 0; ci < 4; ci++) {
            var p = CROSS[q][ci];
            positions.push(x + p[0], y + p[1], z + p[2]);
            normals.push(0, 1, 0);
            pushUVFull(d.tiles[0], p[3], p[4], 0);
            colors.push(1, 1, 1);
            ondes.push(0, 0, 0, 0); ondes2.push(0, 0, 0, 0); immerges.push(profondeurEau(x, y + 1, z));
            souples.push(plantePliable(d) && p[1] > 0.5 ? 1 : 0);
            feuillages.push(0);
            lums.push(Math.max(lumEn(x, y, z), d.light ? d.light / 15 : 0));
            ciels.push(cielEn(x, y, z));
          }
          indices.push(start0, start0 + 1, start0 + 2, start0 + 2, start0 + 1, start0 + 3);
        }
        continue;
      }

      /* En mode fusion (`fusion` vrai), les blocs pleins non liquides ne sont
         PAS dessinés ici : buildGreedy (appelé après cette boucle) s'en
         charge, en glouton. Sans fusion (par défaut), on continue plus bas
         exactement comme avant ce lot — même ordre de sommets.
         L'eau, elle, garde TOUJOURS ce chemin face-par-bloc, fusion ou pas :
         ses vaguelettes (ondes/ondes2) sont propres à chaque sommet, moyennées
         par colonne (SPEC-PERF-013 : « eau si ses ondes dépendent du sommet »). */
      if (fusion && !d.liquid) continue;

      // l'eau de ce bloc : hauteur de surface, nature, sens, profondeur
      var estEau = !!d.liquid && C.isWater(b), dropEau = 0.12, pEau = null, surfaceLibre = false, chuteBloc = false;
      if (estEau) {
        var niv8 = MC.Eau ? MC.Eau.niveauDe(b) : 8;
        surfaceLibre = !C.isWater(blockAt(x, y + 1, z));
        dropEau = surfaceLibre ? (niv8 >= 8 ? 0.12 : 1 - niv8 / 8 * 0.88) : 0;
        pEau = paramsEau(x, y, z);
        var colE = z * CX + x;
        chuteBloc = !!(MC.Eau && (MC.Eau.estCourante(b) || (chunk.eau && chunk.eau.nature[colE] === MC.Eau.TYPES.riviere)));
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
        var chuteFace = estEau && f.dir[1] === 0 && !C.isWater(nb) && chuteBloc;
        var immFace = d.liquid ? 0 : profondeurEau(nx, ny, nz);
        var feuillage = C.isLeaves(b);
        // classe de teinte saisonnière de cette face (SPEC-SAISON-004)
        var classeFeuillage = feuillage ? (C.isConifere(b) ? 2 : 1) : (b === C.B.GRASS && f.dir[1] === 1 ? 3 : 0);
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
          pushUVFull(tile, q2[3], q2[4], vt.rot);
          var c = s * ao[k];
          colors.push(c, c, c);
          if (estEau && pEau) {
            // un sommet de la surface libre s'agite ; ceux du fond ou d'une paroi basse, non
            var auSommet = q2[1] === 1 && surfaceLibre;
            var pc = auSommet ? paramsCoin(x + q2[0], y, z + q2[2], pEau) : pEau;
            if (chuteFace) {
              var pChute = MC.Eau.PARAMS.chute;
              ondes.push(pc.A, pChute.longueur, pChute.vitesse, pChute.ecume);
              ondes2.push(f.dir[0], f.dir[2], 1, (auSommet ? 1 : 0) + 2);
            } else {
              ondes.push(pc.A, pc.L, pc.V, pc.E);
              ondes2.push(pc.fx, pc.fz, pc.K, auSommet ? 1 : 0);
            }
          } else { ondes.push(0, 0, 0, 0); ondes2.push(0, 0, 0, 0); }
          immerges.push(immFace);
          souples.push(feuillage ? 0.2 : 0);
          feuillages.push(classeFeuillage);
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

    /* ── Greedy meshing des blocs pleins non liquides (SPEC-PERF-011/012/013) ──
       Un descripteur par cellule (bloc, face) porte les 4 AO par coin (vraies,
       jamais forcées) et une « clé » de fusion : non nulle seulement si tuile,
       rotation, AO (uniforme aux 4 coins), lumière/ciel (uniformes) et les
       autres attributs par sommet (immersion, souplesse, classe de feuillage)
       coïncident — l'angle rentrant d'une marche, non uniforme, n'a jamais de
       clé et reste donc son propre quad 1×1, comme avant ce lot (préserve le
       relief, SPEC-PERF-012). La rotation de tuile (variantes de sol) n'est
       fusionnée que si elle vaut 0 : au-delà d'une cellule, la formule de
       rotation ne se généralise pas à un repli de texture (voir localUV). */
    function celluleFace(bx, by, bz, f, fi, U, V) {
      var b = blocks[idx(bx, by, bz)];
      if (b === 0) return null;
      var d = C.BLOCKS[b];
      if (!d || C.passOf(b) !== wantPass) return null;
      if (d.plant || d.plat || d.panneau || d.forme || d.liquid) return null;
      var nx = bx + f.dir[0], ny = by + f.dir[1], nz = bz + f.dir[2];
      var nb = (nx < 0 || nx >= CX || nz < 0 || nz >= CZ || ny < 0 || ny >= WH)
        ? sample(baseX + nx, ny, baseZ + nz)
        : blocks[idx(nx, ny, nz)];
      if (C.occludes(b, nb)) return null;
      var dessus = f.dir[1] !== 0;
      var vt = C.tuileVariante(d.tiles[f.t], hachePos(baseX + bx, by, baseZ + bz, fi), dessus);
      var tile = vt.tile, rot = vt.rot;
      var immFace = profondeurEau(nx, ny, nz);
      var feuillage = C.isLeaves(b);
      var classeFeuillage = feuillage ? (C.isConifere(b) ? 2 : 1) : (b === C.B.GRASS && f.dir[1] === 1 ? 3 : 0);
      var souple = feuillage ? 0.2 : 0;
      var ao = [1, 1, 1, 1], lumv = [0, 0, 0, 0], cielv = [1, 1, 1, 1];
      for (var k = 0; k < 4; k++) {
        var q2 = f.corners[k];
        var su = (q2[0] * U[0] + q2[1] * U[1] + q2[2] * U[2]) === 1 ? 1 : -1;
        var sv = (q2[0] * V[0] + q2[1] * V[1] + q2[2] * V[2]) === 1 ? 1 : -1;
        ao[k] = cornerAO(occupied, bx, by, bz, f.dir, U, V, su, sv);
        if (niv) lumv[k] = lumCoin(bx, by, bz, f.dir, U, V, su, sv);
        if (nivC) cielv[k] = lumCoin(bx, by, bz, f.dir, U, V, su, sv, nivC);
      }
      var uniforme = ao[0] === ao[1] && ao[1] === ao[2] && ao[2] === ao[3] &&
        lumv[0] === lumv[1] && lumv[1] === lumv[2] && lumv[2] === lumv[3] &&
        cielv[0] === cielv[1] && cielv[1] === cielv[2] && cielv[2] === cielv[3];
      var cle = (uniforme && rot === 0)
        ? (tile + '|' + ao[0] + '|' + lumv[0] + '|' + cielv[0] + '|' + immFace + '|' + classeFeuillage + '|' + souple)
        : null;
      return { tile: tile, rot: rot, ao: ao, lumv: lumv, cielv: cielv, immFace: immFace,
               classeFeuillage: classeFeuillage, souple: souple, cle: cle };
    }

    function emettreQuad(f, idxU, idxV, idxN, n, u0, v0, w, h, cell) {
      var start = positions.length / 3;
      var ob = tileOrigin(cell.tile, cell.rot);
      for (var k = 0; k < 4; k++) {
        var c = f.corners[k], compU = c[idxU], compV = c[idxV];
        var pos = [0, 0, 0];
        pos[idxN] = n + c[idxN]; pos[idxU] = u0 + compU * w; pos[idxV] = v0 + compV * h;
        positions.push(pos[0], pos[1], pos[2]);
        normals.push(f.dir[0], f.dir[1], f.dir[2]);
        pushUV(uvs, cell.tile, c[3], c[4], cell.rot);
        uvBases.push(ob[0], ob[1]);
        var repTu = f.repTu.base + f.repTu.cu * compU * w + f.repTu.cv * compV * h;
        var repTv = f.repTv.base + f.repTv.cu * compU * w + f.repTv.cv * compV * h;
        var lc = localUV(repTu, repTv, cell.rot);
        uvReps.push(lc[0], lc[1]);
        var col = f.shade * cell.ao[k];
        colors.push(col, col, col);
        ondes.push(0, 0, 0, 0); ondes2.push(0, 0, 0, 0);
        immerges.push(cell.immFace);
        souples.push(cell.souple);
        feuillages.push(cell.classeFeuillage);
        lums.push(cell.lumv[k]);
        ciels.push(cell.cielv[k]);
      }
      var ao = cell.ao;
      if (ao[0] + ao[3] > ao[1] + ao[2]) {
        indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
      } else {
        indices.push(start + 1, start + 3, start, start, start + 3, start + 2);
      }
    }

    // balayage glouton 2D, direction par direction, plan de coupe par plan de coupe
    function buildGreedy(permettreFusion) {
      var dims = [CX, WH, CZ];
      for (var fi = 0; fi < 6; fi++) {
        var f = FACES[fi], idxU = f.idxU, idxV = f.idxV, idxN = f.idxN;
        var dimN = dims[idxN], dimU = dims[idxU], dimV = dims[idxV];
        var tg = tangents(f.dir), U = tg[0], V = tg[1];
        for (var n = 0; n < dimN; n++) {
          var grille = new Array(dimU * dimV);
          var visite = new Uint8Array(dimU * dimV);
          var pos = [0, 0, 0];
          pos[idxN] = n;
          for (var u = 0; u < dimU; u++) {
            pos[idxU] = u;
            for (var v = 0; v < dimV; v++) {
              pos[idxV] = v;
              grille[u * dimV + v] = celluleFace(pos[0], pos[1], pos[2], f, fi, U, V);
            }
          }
          for (var u2 = 0; u2 < dimU; u2++) for (var v2 = 0; v2 < dimV; v2++) {
            var i0 = u2 * dimV + v2;
            if (visite[i0] || !grille[i0]) continue;
            var cell = grille[i0];
            var w = 1;
            if (permettreFusion && cell.cle !== null) {
              while (u2 + w < dimU) {
                var ic = (u2 + w) * dimV + v2, cc = grille[ic];
                if (visite[ic] || !cc || cc.cle !== cell.cle) break;
                w++;
              }
            }
            var h = 1;
            if (permettreFusion && cell.cle !== null) {
              boucleH:
              while (v2 + h < dimV) {
                for (var kk = 0; kk < w; kk++) {
                  var ik = (u2 + kk) * dimV + (v2 + h), ck = grille[ik];
                  if (visite[ik] || !ck || ck.cle !== cell.cle) break boucleH;
                }
                h++;
              }
            }
            for (var du = 0; du < w; du++) for (var dv = 0; dv < h; dv++) visite[(u2 + du) * dimV + (v2 + dv)] = 1;
            emettreQuad(f, idxU, idxV, idxN, n, u2, v2, w, h, cell);
          }
        }
      }
    }
    if (fusion) buildGreedy(true);

    if (!indices.length) return null;
    return { positions: positions, normals: normals, uvs: uvs, uvBases: uvBases, uvReps: uvReps,
             colors: colors, indices: indices, lums: lums, ciels: ciels, ondes: ondes, ondes2: ondes2, immerges: immerges, souples: souples,
             feuillages: feuillages };
  }

  MC.Mesher = { buildChunk: buildChunk, FACES: FACES, pushUV: pushUV, hachePos: hachePos, MARGE_UV: MARGE_UV,
                ATLAS_COLS: ATLAS_COLS, ATLAS_ROWS: ATLAS_ROWS, tileOrigin: tileOrigin, localUV: localUV };
})(typeof globalThis !== 'undefined' ? globalThis : this);
