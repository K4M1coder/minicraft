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

  /* Tables par identifiant de bloc, calculées une fois. Dimensionnées sur
     FIRST_ITEM (SPEC-SAVE-017, 16 bits) plutôt que sur 256 : un bloc défini
     au-delà de l'ancienne limite d'un octet doit lui aussi porter sa lumière
     et son opacité sans qu'on y repense. */
  var EMISSION = new Uint8Array(C.FIRST_ITEM), OPAQUE = new Uint8Array(C.FIRST_ITEM);
  for (var id = 1; id < C.FIRST_ITEM; id++) {
    // defRendu : un id sans définition (bloc inconnu, SPEC-SAVE-028) est un cube opaque
    var d = C.defRendu ? C.defRendu(id) : C.BLOCKS[id];
    if (!d) continue;
    EMISSION[id] = Math.min(MAX, d.light || 0);
    // opaque : un bloc plein qui n'est ni plante, ni liquide, ni ajouré (verre, feuillage)
    OPAQUE[id] = (!d.plant && !d.liquid && !d.transparent && !d.plat &&
                  (d.pass || 'opaque') !== 'cutout' && (d.pass || 'opaque') !== 'blend') ? 1 : 0;
  }
  /* Ce qui laisse passer le ciel en l'affaiblissant : l'eau et le feuillage
     retiennent un peu de jour à chaque bloc — le fond de la mer s'assombrit. */
  var FILTRE = new Uint8Array(C.FIRST_ITEM);
  for (var id2 = 1; id2 < C.FIRST_ITEM; id2++) {
    var d2 = C.BLOCKS[id2];
    if (!d2 || OPAQUE[id2]) continue;
    if (d2.liquid) FILTRE[id2] = 2;
    else if (C.isLeaves && C.isLeaves(id2)) FILTRE[id2] = 1;
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
  var niveaux = null, file = null, cielN = null, hauts = null, fileC = null;
  function wi(x, y, z) { return (y * WZ + z) * W + x; }

  /* Lumière du chunk (cx, cz). `chunkDe(cx, cz)` rend un chunk chargé ou null.
     Renvoie une fonction niveau(lx, ly, lz) en coordonnées locales au chunk,
     valable de -16 à 31 (le voisinage immédiat compris), et le nombre de
     sources prises en compte. */
  function eclairer(chunkDe, cx, cz) {
    if (!niveaux) {
      niveaux = new Uint8Array(TAILLE); file = new Int32Array(TAILLE);
      cielN = new Uint8Array(TAILLE); hauts = new Int16Array(W * WZ); fileC = new Int32Array(TAILLE);
    }
    niveaux.fill(0);
    cielN.fill(0);
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
    lumiereDuCiel(blocs, PLAN);
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
    var M = 1, LX = CX + 2 * M, LZ = CZ + 2 * M, copie = new Uint8Array(LX * LZ * WH), copieC = new Uint8Array(LX * LZ * WH);
    for (var yy = 0; yy < WH; yy++) for (var zz = 0; zz < LZ; zz++) {
      var src = wi(CX - M, yy, CZ - M + zz), dst = (yy * LZ + zz) * LX;
      copie.set(niveaux.subarray(src, src + LX), dst);
      copieC.set(cielN.subarray(src, src + LX), dst);
    }
    function niveau(lx, ly, lz) {
      if (ly < 0 || ly >= WH || lx < -M || lx >= CX + M || lz < -M || lz >= CZ + M) return 0;
      return copie[(ly * LZ + lz + M) * LX + lx + M];
    }
    // au-dessus du monde, c'est le plein ciel ; hors de la fenêtre, on ne sait pas : plein ciel aussi
    function ciel(lx, ly, lz) {
      if (ly >= WH) return MAX;
      if (ly < 0) return 0;
      if (lx < -M || lx >= CX + M || lz < -M || lz >= CZ + M) return MAX;
      return copieC[(ly * LZ + lz + M) * LX + lx + M];
    }
    // fenêtre plate (SPEC-PERF-008) : ce que `depuisTableaux` reconstruit
    // à l'identique de l'autre côté d'un worker, sans refaire la propagation
    return { niveau: niveau, ciel: ciel, sources: sources, niveauxPlat: copie, cielPlat: copieC };
  }

  /* Reconstruit le même objet qu'`eclairer()` ({ niveau, ciel, sources }) à
     partir de la fenêtre plate déjà calculée ailleurs (worker de maillage) —
     SPEC-PERF-008 : le thread principal ne refait jamais la propagation,
     seulement les fermetures de lecture. Mêmes formules que `niveau`/`ciel`
     ci-dessus (M=1, marge d'un chunk). */
  function depuisTableaux(niveaux, ciel, sources) {
    var M = 1, LX = CX + 2 * M, LZ = CZ + 2 * M;
    function niveau(lx, ly, lz) {
      if (ly < 0 || ly >= WH || lx < -M || lx >= CX + M || lz < -M || lz >= CZ + M) return 0;
      return niveaux[(ly * LZ + lz + M) * LX + lx + M];
    }
    function cielF(lx, ly, lz) {
      if (ly >= WH) return MAX;
      if (ly < 0) return 0;
      if (lx < -M || lx >= CX + M || lz < -M || lz >= CZ + M) return MAX;
      return ciel[(ly * LZ + lz + M) * LX + lx + M];
    }
    return { niveau: niveau, ciel: cielF, sources: sources };
  }

  /* ─── lumière du ciel ────────────────────────────────────────────────────
     1. Chaque colonne reçoit le plein jour (15) du haut du monde jusqu'au
        premier bloc opaque ; l'eau et le feuillage l'affaiblissent au passage.
     2. Le jour déborde ensuite de proche en proche sous les surplombs et dans
        les entrées de grottes, un cran par bloc. On ne lance cette diffusion
        que depuis le flanc des colonnes plus hautes que leurs voisines : partir
        de toutes les cases éclairées coûterait cent fois plus. */
  function lumiereDuCiel(blocs, PLAN) {
    var x, z, y;
    function blocEn(x2, y2, z2) {
      var b = blocs[((z2 / CZ) | 0) * 3 + ((x2 / CX) | 0)];
      return b ? b[idx(x2 % CX, y2, z2 % CZ)] : -1;
    }
    for (z = 0; z < WZ; z++) for (x = 0; x < W; x++) {
      var L = MAX, h = -1;
      if (!blocs[((z / CZ) | 0) * 3 + ((x / CX) | 0)]) { hauts[z * W + x] = WH; continue; }
      for (y = WH - 1; y >= 0; y--) {
        var id = blocEn(x, y, z);
        if (OPAQUE[id]) { h = y; break; }
        L = Math.max(0, L - FILTRE[id]);
        cielN[wi(x, y, z)] = L;
        if (!L) { h = y; break; }
      }
      hauts[z * W + x] = h;
    }
    var tete = 0, queue = 0;
    for (z = 0; z < WZ; z++) for (x = 0; x < W; x++) {
      var hc = hauts[z * W + x];
      if (hc >= WH) continue;
      var hv = hc;
      if (x > 0) hv = Math.max(hv, hauts[z * W + x - 1]);
      if (x < W - 1) hv = Math.max(hv, hauts[z * W + x + 1]);
      if (z > 0) hv = Math.max(hv, hauts[(z - 1) * W + x]);
      if (z < WZ - 1) hv = Math.max(hv, hauts[(z + 1) * W + x]);
      if (hv >= WH) hv = WH - 1;
      for (y = hc + 1; y <= hv; y++) {
        var j = wi(x, y, z);
        if (cielN[j] > 1) fileC[queue++] = j;
      }
    }
    function passe(x2, y2, z2) { var id = blocEn(x2, y2, z2); return id >= 0 && !OPAQUE[id]; }
    while (tete < queue) {
      var p = fileC[tete++], n = cielN[p];
      if (n <= 1) continue;
      var px = p % W, pz = ((p / W) | 0) % WZ, py = (p / PLAN) | 0, m = n - 1;
      if (px > 0 && cielN[p - 1] < m && passe(px - 1, py, pz)) { cielN[p - 1] = m; fileC[queue++] = p - 1; }
      if (px < W - 1 && cielN[p + 1] < m && passe(px + 1, py, pz)) { cielN[p + 1] = m; fileC[queue++] = p + 1; }
      if (pz > 0 && cielN[p - W] < m && passe(px, py, pz - 1)) { cielN[p - W] = m; fileC[queue++] = p - W; }
      if (pz < WZ - 1 && cielN[p + W] < m && passe(px, py, pz + 1)) { cielN[p + W] = m; fileC[queue++] = p + W; }
      if (py > 0 && cielN[p - PLAN] < m && passe(px, py - 1, pz)) { cielN[p - PLAN] = m; fileC[queue++] = p - PLAN; }
      if (py < WH - 1 && cielN[p + PLAN] < m && passe(px, py + 1, pz)) { cielN[p + PLAN] = m; fileC[queue++] = p + PLAN; }
      if (queue >= TAILLE - 6) break;
    }
  }

  /* Lumière d'une case pour un objet qui s'y tient : { ciel, bloc } de 0 à 1,
     lue dans l'éclairage calculé au maillage du chunk (`chunk.lumiere`). */
  function lumiereEn(chunkDe, wx, wy, wz) {
    var cx = Math.floor(wx / CX), cz = Math.floor(wz / CZ), c = chunkDe(cx, cz);
    if (!c || !c.lumiere) return { ciel: 1, bloc: 0 };
    var lx = Math.floor(wx) - cx * CX, ly = Math.floor(wy), lz = Math.floor(wz) - cz * CZ;
    return { ciel: c.lumiere.ciel(lx, ly, lz) / MAX, bloc: c.lumiere.niveau(lx, ly, lz) / MAX };
  }
  /* Éclat d'une surface : le ciel pèse selon le jour (plancher nocturne pour
     garder le relief lisible), les sources s'ajoutent. C'est la même règle que
     le shader des chunks, pour que créatures et terrain s'accordent. */
  function eclat(ciel, bloc, jour) {
    var c = Math.pow(ciel, 1.3) * (0.32 + 0.68 * jour);
    return Math.min(1.25, Math.max(0.03, c) + Math.pow(bloc, 2.2) * (0.95 - 0.6 * jour));
  }

  /* Un bloc modifié en (wx, wy, wz) : quels chunks doivent recalculer leur
     lumière ? Ceux à moins de 15 blocs, si une source est en jeu — posée,
     retirée, ou assez proche pour que l'ouverture ou la fermeture d'un passage
     change son rayonnement. */
  function chunksTouches(chunkDe, wx, wy, wz, avant, apres) {
    var cx = Math.floor(wx / CX), cz = Math.floor(wz / CZ), out = [];
    var enJeu = EMISSION[avant] > 0 || EMISSION[apres] > 0;
    if (!enJeu && OPAQUE[avant] === OPAQUE[apres] && FILTRE[avant] === FILTRE[apres]) return out;
    // le ciel : ouvrir ou fermer une colonne change l'ombre alentour, sur quinze blocs
    if (!enJeu) enJeu = true;
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
                 eclairer: eclairer, depuisTableaux: depuisTableaux,
                 chunksTouches: chunksTouches, lumiereEn: lumiereEn, eclat: eclat };
})(typeof globalThis !== 'undefined' ? globalThis : this);
