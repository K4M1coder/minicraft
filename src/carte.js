/* carte.js — la carte du monde exploré et ses points de repère.
   Logique pure : couleurs des colonnes, mémoire de l'exploration, repères.
   Le dessin sur un <canvas> vit dans ui.js ; ici, on ne manipule que des
   tableaux de pixels et des nombres. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var B = C.B, WH = C.WORLD_H, CX = C.CHUNK_X, CZ = C.CHUNK_Z;

  /* Couleur vue du ciel de chaque bloc de surface. Un bloc absent de la
     table prend un gris neutre : la carte reste lisible sans tout énumérer. */
  var COULEURS = {};
  function couleur(id, rgb) { COULEURS[id] = rgb; }
  couleur(B.GRASS, [96, 156, 66]); couleur(B.DIRT, [134, 96, 58]); couleur(B.STONE, [128, 128, 132]);
  couleur(B.SAND, [219, 205, 152]); couleur(B.WATER, [52, 108, 196]); couleur(B.ICE, [160, 200, 240]);
  couleur(B.SNOW, [240, 244, 250]); couleur(B.SANDSTONE, [214, 198, 148]); couleur(B.CACTUS, [70, 128, 50]);
  couleur(B.LEAVES, [58, 124, 48]); couleur(B.BIRCH_LEAVES, [110, 160, 70]); couleur(B.SPRUCE_LEAVES, [44, 86, 56]);
  couleur(B.JUNGLE_LEAVES, [52, 138, 42]); couleur(B.ACACIA_LEAVES, [118, 150, 50]);
  couleur(B.RED_SAND, [190, 102, 44]); couleur(B.TERRACOTTA, [160, 90, 60]); couleur(B.TERRACOTTA_RED, [142, 60, 46]);
  couleur(B.TERRACOTTA_YELLOW, [196, 150, 64]); couleur(B.PACKED_ICE, [140, 180, 230]); couleur(B.BLUE_ICE, [90, 150, 230]);
  couleur(B.MYCELIUM, [118, 98, 118]); couleur(B.MUSHROOM_CAP, [190, 40, 36]); couleur(B.GRAVEL, [128, 124, 122]);
  couleur(B.CLAY, [160, 164, 176]); couleur(B.LAVA, [240, 110, 20]); couleur(B.MAGMA, [150, 50, 20]);
  couleur(B.BASALT, [58, 56, 62]); couleur(B.PLANKS, [186, 147, 92]); couleur(B.COBBLE, [116, 116, 120]);
  couleur(B.STONE_BRICK, [122, 122, 128]); couleur(B.MOSSY_COBBLE, [100, 120, 90]); couleur(B.SANDSTONE_BRICK, [214, 196, 140]);
  couleur(B.ICE_BRICK, [170, 206, 240]); couleur(B.PRISMARINE_BRICK, [80, 150, 136]); couleur(B.OBSIDIAN, [30, 20, 44]);
  couleur(B.CORAL_RED, [200, 60, 70]); couleur(B.CORAL_YELLOW, [220, 190, 50]); couleur(B.CORAL_BLUE, [60, 90, 210]);
  couleur(B.FARMLAND, [96, 66, 40]); couleur(B.GOLD_BLOCK, [236, 196, 60]);
  var GRIS = [120, 120, 120];

  /* Couleur d'une colonne : le premier bloc visible depuis le ciel, ombré
     selon l'altitude (plus clair en hauteur) ; l'eau s'assombrit avec la
     profondeur. `sommet` borne la recherche (chunk partiel). */
  function couleurColonne(world, x, z) {
    var eau = 0;
    for (var y = WH - 1; y > 0; y--) {
      var id = world.getBlock(x, y, z);
      if (!id) continue;
      var d = C.BLOCKS[id];
      if (d && d.plant && !d.aquatique) continue;         // herbes et fleurs : invisibles d'en haut
      if (C.isWater(id)) { eau++; continue; }
      var c = COULEURS[id] || GRIS;
      if (eau) {
        // fond vu à travers l'eau : on mêle au bleu, d'autant plus que c'est profond
        var k = Math.min(0.9, 0.45 + eau * 0.05);
        var w = COULEURS[B.WATER];
        return [c[0] * (1 - k) + w[0] * k, c[1] * (1 - k) + w[1] * k, c[2] * (1 - k) + w[2] * k].map(Math.round);
      }
      var ombre = 0.78 + Math.min(0.32, (y - C.SEA_LEVEL) * 0.012);
      return [c[0] * ombre, c[1] * ombre, c[2] * ombre].map(function (v) { return Math.max(0, Math.min(255, Math.round(v))); });
    }
    return eau ? COULEURS[B.WATER].slice() : GRIS.slice();
  }

  /* Tuile de carte d'un chunk : 16 × 16 pixels RGBA. On la calcule une fois
     quand le chunk est exploré, puis on la garde. */
  function tuileChunk(world, cx, cz) {
    var px = new Uint8ClampedArray(CX * CZ * 4);
    for (var z = 0; z < CZ; z++) for (var x = 0; x < CX; x++) {
      var c = couleurColonne(world, cx * CX + x, cz * CZ + z);
      var k = (z * CX + x) * 4;
      px[k] = c[0]; px[k + 1] = c[1]; px[k + 2] = c[2]; px[k + 3] = 255;
    }
    return px;
  }

  /* ─── exploration ─────────────────────────────────────────────────────────
     Un chunk est exploré quand un joueur l'a vu de près. On garde sa clé
     (pour la sauvegarde) et sa tuile (pour le dessin, recalculée au besoin). */
  var RAYON_EXPLORATION = 3;
  function creerExploration() {
    var cles = new Set();
    var tuiles = new Map();
    function explorer(world, px, pz) {
      var ccx = Math.floor(px / CX), ccz = Math.floor(pz / CZ), n = 0;
      for (var a = -RAYON_EXPLORATION; a <= RAYON_EXPLORATION; a++)
      for (var b = -RAYON_EXPLORATION; b <= RAYON_EXPLORATION; b++) {
        if (a * a + b * b > RAYON_EXPLORATION * RAYON_EXPLORATION) continue;
        var k = (ccx + a) + ',' + (ccz + b);
        if (!world.chunks.has(k)) continue;
        if (!cles.has(k)) { cles.add(k); n++; }
        if (!tuiles.has(k)) tuiles.set(k, tuileChunk(world, ccx + a, ccz + b));
      }
      return n;
    }
    // un bloc modifié change la carte de son chunk : on la recalculera
    function invalider(x, z) { tuiles.delete(Math.floor(x / CX) + ',' + Math.floor(z / CZ)); }
    function tuile(world, cx, cz) {
      var k = cx + ',' + cz;
      if (!cles.has(k)) return null;
      if (!tuiles.has(k) && world.chunks.has(k)) tuiles.set(k, tuileChunk(world, cx, cz));
      return tuiles.get(k) || null;
    }
    return {
      cles: cles, explorer: explorer, invalider: invalider, tuile: tuile,
      estExplore: function (cx, cz) { return cles.has(cx + ',' + cz); },
      serialiser: function () { return Array.from(cles); },
      charger: function (l) { cles.clear(); tuiles.clear(); (l || []).forEach(function (k) { cles.add(k); }); },
    };
  }

  // ─── points de repère ────────────────────────────────────────────────────
  var COULEURS_REPERES = ['#e04040', '#40a0e0', '#40c060', '#f0c030', '#c060e0', '#f08030'];
  function creerReperes() {
    var liste = [];
    var suivant = 1;
    function ajouter(nom, x, z, couleur) {
      var r = { id: suivant++, nom: String(nom || 'Repère ' + suivant).slice(0, 24),
                x: Math.round(x), z: Math.round(z),
                couleur: couleur || COULEURS_REPERES[(suivant - 2) % COULEURS_REPERES.length] };
      liste.push(r);
      return r;
    }
    function retirer(id) {
      for (var i = 0; i < liste.length; i++) if (liste[i].id === id) { liste.splice(i, 1); return true; }
      return false;
    }
    // le repère le plus proche d'un point, dans un rayon (en blocs)
    function proche(x, z, rayon) {
      var best = null, bd = rayon === undefined ? Infinity : rayon;
      liste.forEach(function (r) {
        var d = Math.hypot(r.x - x, r.z - z);
        if (d <= bd) { bd = d; best = r; }
      });
      return best;
    }
    /* Cap et distance vers un repère, vus depuis (x, z) avec le regard `yaw`.
       `angle` : 0 droit devant, positif à droite, en radians. */
    function direction(r, x, z, yaw) {
      var dx = r.x + 0.5 - x, dz = r.z + 0.5 - z;
      var cap = Math.atan2(-dx, -dz);                 // même convention que la caméra
      var a = yaw - cap;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      return { distance: Math.hypot(dx, dz), angle: a };
    }
    return {
      liste: liste, ajouter: ajouter, retirer: retirer, proche: proche, direction: direction,
      serialiser: function () { return liste.map(function (r) { return [r.nom, r.x, r.z, r.couleur]; }); },
      charger: function (data) {
        liste.length = 0; suivant = 1;
        (data || []).forEach(function (r) { ajouter(r[0], r[1], r[2], r[3]); });
      },
    };
  }

  /* Conversion entre pixels de la carte et coordonnées du monde. La carte est
     centrée sur (cx, cz) ; `echelle` = blocs par pixel. */
  function versMonde(px, py, largeur, hauteur, cx, cz, echelle) {
    return { x: cx + (px - largeur / 2) * echelle, z: cz + (py - hauteur / 2) * echelle };
  }
  function versCarte(x, z, largeur, hauteur, cx, cz, echelle) {
    return { px: largeur / 2 + (x - cx) / echelle, py: hauteur / 2 + (z - cz) / echelle };
  }

  MC.Carte = { COULEURS: COULEURS, couleurColonne: couleurColonne, tuileChunk: tuileChunk,
               creerExploration: creerExploration, creerReperes: creerReperes,
               versMonde: versMonde, versCarte: versCarte, RAYON_EXPLORATION: RAYON_EXPLORATION,
               COULEURS_REPERES: COULEURS_REPERES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
