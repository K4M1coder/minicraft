/* lumiere.js — propagation de la lumière des blocs. Logique pure.

   Chaque source (torche, lanterne, lave, lanterne marine…) répand sa lumière
   de proche en proche : un niveau de 0 à 15 qui perd un cran par bloc et que
   les blocs opaques arrêtent. Calculée au maillage d'un chunk et inscrite dans
   ses sommets, elle ne coûte plus rien au rendu : il n'y a PLUS de limite au
   nombre de sources visibles à l'écran (le moteur, lui, ne tient qu'une
   poignée de lumières ponctuelles).

   Une source éclaire à 14 blocs au plus : un chunk de 16 ne reçoit donc de
   lumière que de ses huit voisins. On calcule sur une fenêtre de 3 × 3
   chunks, et on ne garde que le chunk du centre. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var CX = C.CHUNK_X, CZ = C.CHUNK_Z, WH = C.WORLD_H, idx = C.idx;
  var MAX = 15;

  // tables par identifiant de bloc, calculées une fois
  var EMISSION = new Uint8Array(256), OPAQUE = new Uint8Array(256);
  for (var id = 1; id < 256; id++) {
    var d = C.BLOCKS[id];
    if (!d) continue;
    EMISSION[id] = Math.min(MAX, d.light || 0);
    // opaque : un bloc plein qui n'est ni plante, ni liquide, ni ajouré (verre, feuillage)
    OPAQUE[id] = (!d.plant && !d.liquid && !d.transparent && !d.plat &&
                  (d.pass || 'opaque') !== 'cutout' && (d.pass || 'opaque') !== 'blend') ? 1 : 0;
  }
  function emission(id) { return EMISSION[id]; }
  function opaque(id) { return OPAQUE[id] === 1; }

  /* Sources d'un chunk, en index locaux, gardées sur le chunk jusqu'à ce qu'un
     bloc y change. Dans un lac de lave, seuls les blocs qui touchent un vide
     éclairent : l'intérieur du lac ne ferait que répéter le même calcul. */
  function emetteurs(chunk) {
    if (chunk.emetteurs) return chunk.emetteurs;
    var l = [], b = chunk.blocks;
    for (var i = 0; i < b.length; i++) {
      var e = EMISSION[b[i]];
      if (!e) continue;
      if (C.isLava && C.isLava(b[i])) {
        var x = i % CX, z = ((i / CX) | 0) % CZ, y = (i / (CX * CZ)) | 0, libre = false;
        var v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
        for (var k = 0; k < 6 && !libre; k++) {
          var nx = x + v[k][0], ny = y + v[k][1], nz = z + v[k][2];
          if (nx < 0 || nx >= CX || nz < 0 || nz >= CZ) { libre = true; break; }   // bord : dans le doute
          if (ny < 0 || ny >= WH) continue;
          var nb = b[idx(nx, ny, nz)];
          if (!OPAQUE[nb] && !(C.isLava(nb))) libre = true;
        }
        if (!libre) continue;
      }
      l.push(i, e);
    }
    chunk.emetteurs = l;
    return l;
  }

  /* Fenêtre de calcul, réutilisée d'un chunk à l'autre : 48 × 48 × WH octets. */
  var W = 3 * CX, WZ = 3 * CZ, TAILLE = W * WZ * WH;
  var niveaux = null, file = null;
  function wi(x, y, z) { return (y * WZ + z) * W + x; }

  /* Lumière du chunk (cx, cz). `chunkDe(cx, cz)` rend un chunk chargé ou null.
     Renvoie une fonction niveau(lx, ly, lz) en coordonnées locales au chunk,
     valable de -16 à 31 (le voisinage immédiat compris), et le nombre de
     sources prises en compte. */
  function eclairer(chunkDe, cx, cz) {
    if (!niveaux) { niveaux = new Uint8Array(TAILLE); file = new Int32Array(TAILLE); }
    niveaux.fill(0);
    var blocs = [], tete = 0, queue = 0, sources = 0;
    for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
      var c = chunkDe(cx + dx, cz + dz);
      blocs.push(c ? c.blocks : null);
      if (!c) continue;
      var em = emetteurs(c);
      for (var k = 0; k < em.length; k += 2) {
        var i = em[k], e = em[k + 1];
        var lx = i % CX, lz = ((i / CX) | 0) % CZ, ly = (i / (CX * CZ)) | 0;
        var fx = (dx + 1) * CX + lx, fz = (dz + 1) * CZ + lz;
        // trop loin du chunk central pour l'atteindre
        var ex = fx < CX ? CX - fx : (fx >= 2 * CX ? fx - 2 * CX + 1 : 0);
        var ez = fz < CZ ? CZ - fz : (fz >= 2 * CZ ? fz - 2 * CZ + 1 : 0);
        if (ex + ez >= e) continue;
        var j = wi(fx, ly, fz);
        if (niveaux[j] < e) { niveaux[j] = e; file[queue++] = j; sources++; }
      }
    }
    function opaqueEn(x, y, z) {
      var b = blocs[((z / CZ) | 0) * 3 + ((x / CX) | 0)];
      if (!b) return true;
      return OPAQUE[b[idx(x % CX, y, z % CZ)]] === 1;
    }
    var PLAN = W * WZ;
    while (tete < queue) {
      var p = file[tete++], n = niveaux[p];
      if (n <= 1) continue;
      var x = p % W, z = ((p / W) | 0) % WZ, y = (p / PLAN) | 0, m = n - 1;
      if (x > 0 && niveaux[p - 1] < m && !opaqueEn(x - 1, y, z)) { niveaux[p - 1] = m; file[queue++] = p - 1; }
      if (x < W - 1 && niveaux[p + 1] < m && !opaqueEn(x + 1, y, z)) { niveaux[p + 1] = m; file[queue++] = p + 1; }
      if (z > 0 && niveaux[p - W] < m && !opaqueEn(x, y, z - 1)) { niveaux[p - W] = m; file[queue++] = p - W; }
      if (z < WZ - 1 && niveaux[p + W] < m && !opaqueEn(x, y, z + 1)) { niveaux[p + W] = m; file[queue++] = p + W; }
      if (y > 0 && niveaux[p - PLAN] < m && !opaqueEn(x, y - 1, z)) { niveaux[p - PLAN] = m; file[queue++] = p - PLAN; }
      if (y < WH - 1 && niveaux[p + PLAN] < m && !opaqueEn(x, y + 1, z)) { niveaux[p + PLAN] = m; file[queue++] = p + PLAN; }
      if (queue >= TAILLE - 6) break;                    // garde-fou : jamais atteint en pratique
    }
    // copie de la zone utile (chunk + une case de marge) : la fenêtre est partagée
    var M = 1, LX = CX + 2 * M, LZ = CZ + 2 * M, copie = new Uint8Array(LX * LZ * WH);
    for (var yy = 0; yy < WH; yy++) for (var zz = 0; zz < LZ; zz++) {
      var src = wi(CX - M, yy, CZ - M + zz), dst = (yy * LZ + zz) * LX;
      copie.set(niveaux.subarray(src, src + LX), dst);
    }
    function niveau(lx, ly, lz) {
      if (ly < 0 || ly >= WH || lx < -M || lx >= CX + M || lz < -M || lz >= CZ + M) return 0;
      return copie[(ly * LZ + lz + M) * LX + lx + M];
    }
    return { niveau: niveau, sources: sources };
  }

  /* Un bloc modifié en (wx, wy, wz) : quels chunks doivent recalculer leur
     lumière ? Ceux à moins de 15 blocs, si une source est en jeu — posée,
     retirée, ou assez proche pour que l'ouverture ou la fermeture d'un passage
     change son rayonnement. */
  function chunksTouches(chunkDe, wx, wy, wz, avant, apres) {
    var cx = Math.floor(wx / CX), cz = Math.floor(wz / CZ), out = [];
    var enJeu = EMISSION[avant] > 0 || EMISSION[apres] > 0;
    if (!enJeu && OPAQUE[avant] === OPAQUE[apres]) return out;
    if (!enJeu) {
      // un passage s'ouvre ou se ferme : seulement si une source est à portée
      for (var dz = -1; dz <= 1 && !enJeu; dz++) for (var dx = -1; dx <= 1 && !enJeu; dx++) {
        var c = chunkDe(cx + dx, cz + dz);
        if (!c) continue;
        var em = emetteurs(c);
        for (var k = 0; k < em.length; k += 2) {
          var i = em[k];
          var ex = (cx + dx) * CX + i % CX, ez = (cz + dz) * CZ + ((i / CX) | 0) % CZ, ey = (i / (CX * CZ)) | 0;
          if (Math.abs(ex - wx) + Math.abs(ey - wy) + Math.abs(ez - wz) < em[k + 1]) { enJeu = true; break; }
        }
      }
      if (!enJeu) return out;
    }
    var lx = wx - cx * CX, lz = wz - cz * CZ;
    for (var bz = -1; bz <= 1; bz++) for (var bx = -1; bx <= 1; bx++) {
      // distance du bloc au chunk voisin, sur chaque axe
      var ax = bx < 0 ? lx + 1 : (bx > 0 ? CX - lx : 0);
      var az = bz < 0 ? lz + 1 : (bz > 0 ? CZ - lz : 0);
      if (ax + az < MAX) out.push([cx + bx, cz + bz]);
    }
    return out;
  }

  MC.Lumiere = { MAX: MAX, emission: emission, opaque: opaque, emetteurs: emetteurs,
                 eclairer: eclairer, chunksTouches: chunksTouches };
})(typeof globalThis !== 'undefined' ? globalThis : this);
