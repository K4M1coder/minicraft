/* atlas.js — toutes les textures sont peintes au runtime sur un canvas.
   Aucun asset externe : le jeu reste un dossier de fichiers texte. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  // 8 × 24 tuiles : terrain d origine, puis biomes, mer, structures, objets et véhicules
  var TILE = 16, COLS = 16, ROWS = 64;          // 1024 tuiles : de la place pour L24, L25, L29

  function buildAtlas() {
    var cv = document.createElement('canvas');
    cv.width = TILE * COLS; cv.height = TILE * ROWS;
    // lecture fréquente : taches tuilables et variantes relisent les pixels de l'atlas
    var g = cv.getContext('2d', { willReadFrequently: true });

    // bruit déterministe : mêmes textures à chaque lancement
    var seed = 1337;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

    function origin(i) { return [(i % COLS) * TILE, ((i / COLS) | 0) * TILE]; }
    function clamp(v) { return Math.max(0, Math.min(255, v | 0)); }

    // fond granuleux
    function grain(i, base, jitter) {
      var o = origin(i), ox = o[0], oy = o[1];
      for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
        var n = (rnd() - 0.5) * jitter;
        g.fillStyle = 'rgb(' + clamp(base[0] + n) + ',' + clamp(base[1] + n) + ',' + clamp(base[2] + n) + ')';
        g.fillRect(ox + x, oy + y, 1, 1);
      }
      return [ox, oy];
    }
    function clear(i) { var o = origin(i); g.clearRect(o[0], o[1], TILE, TILE); return o; }
    function px(ox, oy, x, y, color) { g.fillStyle = color; g.fillRect(ox + x, oy + y, 1, 1); }

    // ─── blocs ───────────────────────────────────────────────────────────────
    grain(0, [94, 158, 64], 34);                                        // herbe dessus
    (function () {
      var o = grain(1, [134, 96, 58], 26);                              // herbe côté
      for (var x = 0; x < TILE; x++) {
        var h = 3 + ((rnd() * 3) | 0);
        g.fillStyle = 'rgb(' + ((86 + rnd() * 40) | 0) + ',' + ((150 + rnd() * 30) | 0) + ',60)';
        g.fillRect(o[0] + x, o[1], 1, h);
      }
    })();
    grain(2, [134, 96, 58], 26);                                        // terre
    grain(3, [128, 128, 133], 30);                                      // pierre
    grain(4, [219, 205, 152], 22);                                      // sable
    (function () {
      var o = grain(5, [104, 78, 47], 20);                              // tronc côté
      g.fillStyle = 'rgba(60,42,24,.45)';
      for (var i = 0; i < 4; i++) g.fillRect(o[0] + 1 + i * 4 + ((rnd() * 2) | 0), o[1], 1, TILE);
    })();
    (function () {
      var o = grain(6, [156, 122, 76], 22);                             // tronc dessus
      g.strokeStyle = 'rgba(90,66,38,.8)';
      for (var r = 2; r < 8; r += 2) g.strokeRect(o[0] + 8 - r, o[1] + 8 - r, r * 2, r * 2);
    })();
    (function () {
      var o = clear(7);                                                 // feuillage (ajouré)
      for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
        if (rnd() < 0.12) continue;                                     // trous
        var n = (rnd() - 0.5) * 46;
        px(o[0], o[1], x, y, 'rgb(' + clamp(58 + n) + ',' + clamp(124 + n) + ',' + clamp(48 + n) + ')');
      }
    })();
    (function () {
      var o = grain(8, [186, 147, 92], 18);                             // planche
      g.fillStyle = 'rgba(120,88,50,.55)';
      for (var y = 3; y < TILE; y += 4) g.fillRect(o[0], o[1] + y, TILE, 1);
    })();
    (function () {
      var o = grain(9, [116, 116, 120], 24);                            // pavé
      g.strokeStyle = 'rgba(70,70,74,.5)';
      for (var i = 0; i < 22; i++) {
        var s = 2 + ((rnd() * 3) | 0);
        g.strokeRect(o[0] + ((rnd() * (TILE - s)) | 0) + 0.5, o[1] + ((rnd() * (TILE - s)) | 0) + 0.5, s, s);
      }
    })();
    (function () {
      var o = grain(10, [150, 74, 62], 14);                             // brique
      g.fillStyle = '#c8c0b4';
      for (var y = 0; y < TILE; y += 4) {
        g.fillRect(o[0], o[1] + y, TILE, 1);
        for (var x = (y % 8 ? 0 : 4); x < TILE; x += 8) g.fillRect(o[0] + x, o[1] + y, 1, 4);
      }
    })();
    (function () {
      var o = grain(11, [176, 214, 228], 8);                            // verre
      g.clearRect(o[0] + 1, o[1] + 1, TILE - 2, TILE - 2);
      g.fillStyle = 'rgba(226,244,252,.30)';
      g.fillRect(o[0] + 1, o[1] + 1, TILE - 2, TILE - 2);
      g.fillStyle = 'rgba(255,255,255,.75)';
      g.fillRect(o[0] + 3, o[1] + 3, 5, 1); g.fillRect(o[0] + 3, o[1] + 3, 1, 5);
    })();
    grain(12, [52, 108, 196], 16);                                      // eau
    (function () {
      var o = grain(13, [186, 147, 92], 16);                            // établi dessus
      g.fillStyle = 'rgba(90,66,38,.8)';
      g.fillRect(o[0], o[1] + 5, TILE, 1); g.fillRect(o[0], o[1] + 10, TILE, 1);
      g.fillRect(o[0] + 5, o[1], 1, TILE); g.fillRect(o[0] + 10, o[1], 1, TILE);
    })();
    (function () {
      var o = grain(14, [150, 116, 72], 16);                            // établi côté
      g.fillStyle = 'rgba(70,50,28,.75)';
      g.fillRect(o[0], o[1] + 4, TILE, 2);
      g.fillStyle = 'rgba(200,170,120,.5)';
      for (var i = 0; i < 4; i++) g.fillRect(o[0] + 2 + i * 4, o[1] + 8, 2, 6);
    })();
    (function () {
      var o = grain(15, [112, 112, 116], 18);                           // fourneau face
      g.fillStyle = '#2a2a2e'; g.fillRect(o[0] + 3, o[1] + 7, 10, 7);
      g.fillStyle = '#d8762a'; g.fillRect(o[0] + 4, o[1] + 11, 8, 2);
      g.fillStyle = '#f5c04a'; g.fillRect(o[0] + 6, o[1] + 12, 4, 1);
      g.fillStyle = 'rgba(60,60,64,.7)'; g.fillRect(o[0], o[1] + 5, TILE, 1);
    })();
    grain(16, [112, 112, 116], 22);                                     // fourneau côté
    (function () {
      var o = grain(17, [96, 66, 40], 18);                              // terre labourée
      g.fillStyle = 'rgba(60,40,22,.65)';
      for (var y = 2; y < TILE; y += 4) g.fillRect(o[0], o[1] + y, TILE, 2);
    })();
    // blé : 4 stades, de plus en plus haut et doré
    for (var s = 0; s < 4; s++) {
      (function (stage) {
        var o = clear(18 + stage);
        var h = 4 + stage * 4;
        var col = ['#5b8f3a', '#71a33e', '#a8b23c', '#d8bd42'][stage];
        for (var x = 1; x < TILE; x += 4) {
          for (var y = TILE - h; y < TILE; y++) px(o[0], o[1], x, y, col);
          if (stage >= 2) {
            px(o[0], o[1], x - 1, TILE - h, col);
            px(o[0], o[1], x + 1, TILE - h, col);
          }
          if (stage === 3) {
            px(o[0], o[1], x - 1, TILE - h + 1, '#e8cf62');
            px(o[0], o[1], x + 1, TILE - h + 1, '#e8cf62');
            px(o[0], o[1], x, TILE - h - 1, '#e8cf62');
          }
        }
      })(s);
    }
    (function () {
      var o = grain(22, [128, 128, 133], 26);                           // minerai de charbon
      for (var i = 0; i < 7; i++) {
        var cx = 2 + ((rnd() * 11) | 0), cy = 2 + ((rnd() * 11) | 0);
        g.fillStyle = '#23232a'; g.fillRect(o[0] + cx, o[1] + cy, 2 + ((rnd() * 2) | 0), 2);
      }
    })();
    (function () {
      var o = grain(23, [128, 128, 133], 26);                           // minerai de fer
      for (var i = 0; i < 7; i++) {
        var cx = 2 + ((rnd() * 11) | 0), cy = 2 + ((rnd() * 11) | 0);
        g.fillStyle = '#c99a6e'; g.fillRect(o[0] + cx, o[1] + cy, 2 + ((rnd() * 2) | 0), 2);
      }
    })();
    grain(24, [236, 236, 238], 12);                                     // laine
    grain(25, [56, 56, 60], 40);                                        // socle

    // ─── objets ──────────────────────────────────────────────────────────────
    (function () {                                                      // bâton
      var o = clear(26);
      for (var i = 0; i < 10; i++) px(o[0], o[1], 5 + ((i / 3) | 0), 13 - i, '#8a6a3c');
    })();
    (function () {                                                      // charbon
      var o = clear(27);
      g.fillStyle = '#26262c';
      g.beginPath(); g.arc(o[0] + 8, o[1] + 8, 5, 0, 7); g.fill();
      g.fillStyle = '#45454e'; g.fillRect(o[0] + 6, o[1] + 6, 2, 2);
    })();
    (function () {                                                      // lingot de fer
      var o = clear(28);
      g.fillStyle = '#d8d8dc'; g.fillRect(o[0] + 3, o[1] + 7, 10, 5);
      g.fillStyle = '#f2f2f5'; g.fillRect(o[0] + 4, o[1] + 7, 8, 2);
      g.fillStyle = '#a8a8b0'; g.fillRect(o[0] + 3, o[1] + 11, 10, 1);
    })();
    (function () {                                                      // blé (objet)
      var o = clear(29);
      for (var i = 0; i < 3; i++) {
        var x = 4 + i * 4;
        for (var y = 4; y < 14; y++) px(o[0], o[1], x, y, '#c9a63a');
        px(o[0], o[1], x - 1, 5, '#e8cf62'); px(o[0], o[1], x + 1, 5, '#e8cf62');
        px(o[0], o[1], x - 1, 8, '#e8cf62'); px(o[0], o[1], x + 1, 8, '#e8cf62');
      }
    })();
    (function () {                                                      // graines
      var o = clear(30);
      g.fillStyle = '#9ab04a';
      [[5, 6], [9, 5], [7, 9], [10, 10], [4, 10]].forEach(function (p) {
        g.fillRect(o[0] + p[0], o[1] + p[1], 2, 3);
      });
    })();
    (function () {                                                      // pain
      var o = clear(31);
      g.fillStyle = '#b8823e';
      g.beginPath(); g.ellipse(o[0] + 8, o[1] + 8, 6, 4, 0, 0, 7); g.fill();
      g.fillStyle = '#d8a45e';
      g.beginPath(); g.ellipse(o[0] + 8, o[1] + 7, 5, 3, 0, 0, 7); g.fill();
      g.fillStyle = '#8a5e2a';
      for (var i = 0; i < 3; i++) g.fillRect(o[0] + 5 + i * 3, o[1] + 6, 1, 3);
    })();
    (function () {                                                      // mouton cru
      var o = clear(32);
      g.fillStyle = '#d4605e';
      g.beginPath(); g.ellipse(o[0] + 8, o[1] + 8, 6, 4, 0, 0, 7); g.fill();
      g.fillStyle = '#eb8d8a'; g.fillRect(o[0] + 5, o[1] + 6, 4, 2);
    })();
    (function () {                                                      // mouton cuit
      var o = clear(33);
      g.fillStyle = '#9a5c2c';
      g.beginPath(); g.ellipse(o[0] + 8, o[1] + 8, 6, 4, 0, 0, 7); g.fill();
      g.fillStyle = '#c2803e'; g.fillRect(o[0] + 5, o[1] + 6, 5, 2);
    })();
    (function () {                                                      // chair putréfiée
      var o = clear(34);
      g.fillStyle = '#6f7a48';
      g.beginPath(); g.ellipse(o[0] + 8, o[1] + 8, 6, 4, 0, 0, 7); g.fill();
      g.fillStyle = '#4a5230'; g.fillRect(o[0] + 6, o[1] + 7, 2, 2);
      g.fillRect(o[0] + 9, o[1] + 9, 2, 1);
    })();
    (function () {                                                      // émeraude
      var o = clear(35);
      g.fillStyle = '#2fbf6a';
      g.beginPath(); g.moveTo(o[0] + 8, o[1] + 2); g.lineTo(o[0] + 13, o[1] + 8);
      g.lineTo(o[0] + 8, o[1] + 14); g.lineTo(o[0] + 3, o[1] + 8); g.closePath(); g.fill();
      g.fillStyle = '#7ff0ac'; g.fillRect(o[0] + 7, o[1] + 5, 2, 3);
    })();

    // outils : manche en bois + tête colorée selon le matériau
    var MATC = ['#b08040', '#9a9aa2', '#e0e0e6', '#5ae8e0', '#f0c840', '#b8e8ff', '#e04828'];
    // bois, pierre, fer, diamant, or, givre, flamme
    function tool(i, kind, mat) {
      var o = clear(i), ox = o[0], oy = o[1];
      // manche
      g.fillStyle = '#8a6a3c';
      for (var k = 0; k < 9; k++) g.fillRect(ox + 5 + ((k / 3) | 0), oy + 13 - k, 2, 2);
      g.fillStyle = MATC[mat];
      if (kind === 'pickaxe') {
        g.fillRect(ox + 3, oy + 4, 10, 2);
        g.fillRect(ox + 3, oy + 3, 3, 2); g.fillRect(ox + 10, oy + 3, 3, 2);
      } else if (kind === 'axe') {
        g.fillRect(ox + 7, oy + 2, 5, 6); g.fillRect(ox + 6, oy + 3, 1, 4);
      } else if (kind === 'shovel') {
        g.fillRect(ox + 6, oy + 2, 5, 5); g.fillRect(ox + 7, oy + 7, 3, 1);
      } else if (kind === 'sword') {
        g.fillRect(ox + 7, oy + 1, 3, 9);
        g.fillStyle = '#8a6a3c'; g.fillRect(ox + 5, oy + 10, 7, 2);
      } else if (kind === 'hoe') {
        g.fillRect(ox + 7, oy + 3, 6, 2); g.fillRect(ox + 11, oy + 5, 2, 2);
      }
    }
    ['pickaxe', 'axe', 'shovel', 'sword'].forEach(function (kind, ki) {
      for (var m = 0; m < 3; m++) tool(36 + ki * 3 + m, kind, m);
    });
    tool(48, 'hoe', 0); tool(49, 'hoe', 1);

    (function () {                                                    // 50 torche
      var o = clear(50), ox = o[0], oy = o[1];
      g.fillStyle = '#8a6a3c';
      g.fillRect(ox + 7, oy + 6, 2, 10);                              // manche
      g.fillStyle = '#5f4726';
      g.fillRect(ox + 7, oy + 11, 1, 5);
      g.fillStyle = '#d8762a';                                        // braise
      g.fillRect(ox + 6, oy + 3, 4, 4);
      g.fillStyle = '#f5c04a';
      g.fillRect(ox + 7, oy + 2, 2, 3);
      g.fillStyle = '#fff0b8';
      g.fillRect(ox + 7, oy + 2, 1, 1);
    })();
    (function () {                                                    // 51 coffre côté
      var o = grain(51, [150, 110, 58], 16), ox = o[0], oy = o[1];
      g.fillStyle = 'rgba(70,48,20,.8)';
      g.fillRect(ox, oy + 5, TILE, 1);
      g.strokeStyle = 'rgba(70,48,20,.8)';
      g.strokeRect(ox + .5, oy + .5, TILE - 1, TILE - 1);
      g.fillStyle = '#c8b06a';                                        // ferrure
      g.fillRect(ox + 6, oy + 5, 4, 4);
      g.fillStyle = '#3a2c14';
      g.fillRect(ox + 7, oy + 6, 2, 2);
    })();
    (function () {                                                    // 52 coffre dessus
      var o = grain(52, [162, 120, 64], 16), ox = o[0], oy = o[1];
      g.strokeStyle = 'rgba(70,48,20,.8)';
      g.strokeRect(ox + .5, oy + .5, TILE - 1, TILE - 1);
      g.fillStyle = 'rgba(70,48,20,.55)';
      g.fillRect(ox + 3, oy, 1, TILE); g.fillRect(ox + 12, oy, 1, TILE);
    })();

    (function () {                                                    // 53 ficelle
      var o = clear(53), ox = o[0], oy = o[1];
      g.strokeStyle = '#e8e4d8'; g.lineWidth = 1;
      g.beginPath();
      for (var i = 0; i < 14; i++) {
        var yy = oy + 3 + i;
        g.lineTo(ox + 8 + Math.sin(i * 0.9) * 4, yy);
      }
      g.stroke();
    })();
    (function () {                                                    // 54 arc
      var o = clear(54), ox = o[0], oy = o[1];
      g.strokeStyle = '#8a6a3c'; g.lineWidth = 2;
      g.beginPath(); g.arc(ox + 5, oy + 8, 6, -Math.PI / 2.2, Math.PI / 2.2); g.stroke();
      g.strokeStyle = '#e8e4d8'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(ox + 7, oy + 2); g.lineTo(ox + 7, oy + 14); g.stroke();
    })();
    (function () {                                                    // 55 fleche
      var o = clear(55), ox = o[0], oy = o[1];
      g.strokeStyle = '#8a6a3c'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(ox + 3, oy + 13); g.lineTo(ox + 12, oy + 4); g.stroke();
      g.fillStyle = '#c8c8d0';                                        // pointe
      g.beginPath(); g.moveTo(ox + 13, oy + 3); g.lineTo(ox + 13, oy + 7);
      g.lineTo(ox + 9, oy + 3); g.closePath(); g.fill();
      g.fillStyle = '#e8e4d8';                                        // empennage
      g.fillRect(ox + 2, oy + 12, 3, 1); g.fillRect(ox + 3, oy + 13, 1, 2);
    })();

    // ─── biomes ──────────────────────────────────────────────────────────────
    grain(56, [238, 242, 248], 10);                                   // 56 neige dessus
    (function () {                                                    // 57 neige côté
      var o = grain(57, [134, 96, 58], 26);
      for (var x = 0; x < TILE; x++) {
        var h = 3 + ((rnd() * 3) | 0);
        g.fillStyle = 'rgb(' + ((228 + rnd() * 20) | 0) + ',' + ((234 + rnd() * 16) | 0) + ',246)';
        g.fillRect(o[0] + x, o[1], 1, h);
      }
    })();
    (function () {                                                    // 58 glace
      var o = grain(58, [150, 190, 236], 14);
      g.fillStyle = 'rgba(235,248,255,.55)';
      g.fillRect(o[0] + 2, o[1] + 3, 6, 1); g.fillRect(o[0] + 9, o[1] + 10, 5, 1);
      g.fillRect(o[0] + 4, o[1] + 12, 3, 1);
    })();
    grain(59, [222, 208, 160], 12);                                   // 59 grès dessus
    (function () {                                                    // 60 grès côté
      var o = grain(60, [214, 198, 148], 14);
      g.fillStyle = 'rgba(170,146,96,.6)';
      g.fillRect(o[0], o[1] + 4, TILE, 1); g.fillRect(o[0], o[1] + 11, TILE, 1);
    })();
    (function () {                                                    // 61 cactus dessus
      var o = grain(61, [86, 140, 58], 18);
      g.strokeStyle = 'rgba(40,80,30,.8)';
      g.strokeRect(o[0] + 1.5, o[1] + 1.5, TILE - 3, TILE - 3);
    })();
    (function () {                                                    // 62 cactus côté
      var o = grain(62, [70, 128, 50], 16);
      g.fillStyle = 'rgba(40,80,30,.7)';
      for (var x = 2; x < TILE; x += 5) g.fillRect(o[0] + x, o[1], 1, TILE);
      g.fillStyle = '#e8e4c0';                                        // épines
      for (var i = 0; i < 9; i++) px(o[0], o[1], (rnd() * TILE) | 0, (rnd() * TILE) | 0, '#e8e4c0');
    })();
    (function () {                                                    // 63 bouleau côté
      var o = grain(63, [226, 224, 214], 12);
      g.fillStyle = '#3a3630';
      for (var i = 0; i < 7; i++) {
        g.fillRect(o[0] + ((rnd() * 12) | 0), o[1] + ((rnd() * TILE) | 0), 2 + ((rnd() * 3) | 0), 1);
      }
    })();
    function feuillage(i, base, trous) {
      var o = clear(i);
      for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
        if (rnd() < trous) continue;
        var n = (rnd() - 0.5) * 40;
        px(o[0], o[1], x, y, 'rgb(' + clamp(base[0] + n) + ',' + clamp(base[1] + n) + ',' + clamp(base[2] + n) + ')');
      }
    }
    feuillage(64, [110, 160, 70], 0.14);                              // 64 bouleau
    (function () {                                                    // 65 sapin côté
      var o = grain(65, [72, 52, 32], 16);
      g.fillStyle = 'rgba(40,28,16,.5)';
      for (var i = 0; i < 5; i++) g.fillRect(o[0] + i * 3 + ((rnd() * 2) | 0), o[1], 1, TILE);
    })();
    feuillage(66, [44, 86, 56], 0.10);                                // 66 sapin
    (function () {                                                    // 67 hautes herbes
      var o = clear(67);
      for (var x = 1; x < TILE; x += 2) {
        var h = 6 + ((rnd() * 9) | 0);
        var col = 'rgb(' + ((70 + rnd() * 40) | 0) + ',' + ((140 + rnd() * 40) | 0) + ',52)';
        for (var y = TILE - h; y < TILE; y++) px(o[0], o[1], x + (y < TILE - h + 2 ? 1 : 0), y, col);
      }
    })();
    function fleur(i, petale, coeur) {
      var o = clear(i);
      for (var y = 7; y < TILE; y++) px(o[0], o[1], 8, y, '#3f8a34');
      px(o[0], o[1], 9, 11, '#3f8a34'); px(o[0], o[1], 10, 10, '#3f8a34');
      g.fillStyle = petale;
      g.fillRect(o[0] + 6, o[1] + 3, 5, 4); g.fillRect(o[0] + 7, o[1] + 2, 3, 6);
      px(o[0], o[1], 8, 4, coeur); px(o[0], o[1], 8, 5, coeur);
    }
    fleur(68, '#d8322e', '#2a1a10');                                  // 68 coquelicot
    fleur(69, '#f0cc30', '#c88a18');                                  // 69 pissenlit
    (function () {                                                    // 70 buisson mort
      var o = clear(70);
      g.strokeStyle = '#8a6438'; g.lineWidth = 1;
      [[8, 15, 3, 4], [8, 15, 13, 5], [8, 15, 8, 3], [8, 12, 11, 8], [8, 12, 5, 9]].forEach(function (l) {
        g.beginPath(); g.moveTo(o[0] + l[0] + 0.5, o[1] + l[1]); g.lineTo(o[0] + l[2] + 0.5, o[1] + l[3]);
        g.stroke();
      });
    })();
    (function () {                                                    // 71 champignon
      var o = clear(71);
      g.fillStyle = '#e8dcc8'; g.fillRect(o[0] + 7, o[1] + 9, 3, 7);
      g.fillStyle = '#c0302a'; g.fillRect(o[0] + 4, o[1] + 5, 9, 4); g.fillRect(o[0] + 5, o[1] + 4, 7, 1);
      g.fillStyle = '#f4f0e8';
      px(o[0], o[1], 6, 6, '#f4f0e8'); px(o[0], o[1], 10, 5, '#f4f0e8'); px(o[0], o[1], 9, 7, '#f4f0e8');
    })();
    // ─── donjons ─────────────────────────────────────────────────────────────
    (function () {                                                    // 72 pierre moussue
      var o = grain(72, [112, 114, 116], 24);
      for (var i = 0; i < 40; i++) {
        var n = (rnd() - 0.5) * 30;
        g.fillStyle = 'rgb(' + clamp(70 + n) + ',' + clamp(120 + n) + ',' + clamp(62 + n) + ')';
        g.fillRect(o[0] + ((rnd() * TILE) | 0), o[1] + ((rnd() * TILE) | 0), 2, 1 + ((rnd() * 2) | 0));
      }
    })();
    (function () {                                                    // 73 brique de pierre
      var o = grain(73, [122, 122, 128], 14);
      g.fillStyle = 'rgba(60,60,66,.75)';
      g.fillRect(o[0], o[1] + 7, TILE, 1); g.fillRect(o[0], o[1] + 15, TILE, 1);
      g.fillRect(o[0] + 7, o[1], 1, 7); g.fillRect(o[0] + 15, o[1], 1, 7);
      g.fillRect(o[0] + 3, o[1] + 8, 1, 7); g.fillRect(o[0] + 11, o[1] + 8, 1, 7);
    })();
    // ─── objets (suite) ──────────────────────────────────────────────────────
    (function () {                                                    // 74 porc cru
      var o = clear(74);
      g.fillStyle = '#e88a8a';
      g.beginPath(); g.ellipse(o[0] + 8, o[1] + 8, 6, 4, 0, 0, 7); g.fill();
      g.fillStyle = '#f6c0b8'; g.fillRect(o[0] + 5, o[1] + 6, 5, 2);
    })();
    (function () {                                                    // 75 porc cuit
      var o = clear(75);
      g.fillStyle = '#b06a38';
      g.beginPath(); g.ellipse(o[0] + 8, o[1] + 8, 6, 4, 0, 0, 7); g.fill();
      g.fillStyle = '#d8945a'; g.fillRect(o[0] + 5, o[1] + 6, 5, 2);
    })();
    (function () {                                                    // 76 épée runique
      var o = clear(76), ox = o[0], oy = o[1];
      g.fillStyle = '#6a4fd8'; g.fillRect(ox + 7, oy + 1, 3, 9);
      g.fillStyle = '#b8a8ff'; g.fillRect(ox + 8, oy + 2, 1, 7);
      g.fillStyle = '#f0d060'; g.fillRect(ox + 5, oy + 10, 7, 2);
      g.fillStyle = '#5a3c22'; g.fillRect(ox + 8, oy + 12, 1, 3);
    })();

    // ─── biomes exotiques (77-94) ────────────────────────────────────────────
    function ecorce(i, base, raie) {
      var o = grain(i, base, 18);
      g.fillStyle = raie;
      for (var k = 0; k < 5; k++) g.fillRect(o[0] + k * 3 + ((rnd() * 2) | 0), o[1], 1, TILE);
      return o;
    }
    function taches(i, base, jit, couleur, n, t) {
      var o = grain(i, base, jit);
      for (var k = 0; k < n; k++) {
        g.fillStyle = couleur;
        g.fillRect(o[0] + ((rnd() * (TILE - t)) | 0), o[1] + ((rnd() * (TILE - t)) | 0), t, t);
      }
      return o;
    }
    function bandes(i, couleurs) {
      var o = origin(i);
      for (var y = 0; y < TILE; y++) {
        var c = couleurs[((y / 4) | 0) % couleurs.length];
        for (var x = 0; x < TILE; x++) {
          var n = (rnd() - 0.5) * 14;
          g.fillStyle = 'rgb(' + clamp(c[0] + n) + ',' + clamp(c[1] + n) + ',' + clamp(c[2] + n) + ')';
          g.fillRect(o[0] + x, o[1] + y, 1, 1);
        }
      }
      return o;
    }
    ecorce(77, [96, 74, 40], 'rgba(60,70,30,.5)');                    // 77 tronc tropical
    feuillage(78, [52, 138, 42], 0.08);                                // 78 feuilles tropicales
    ecorce(79, [120, 108, 96], 'rgba(80,70,60,.5)');                   // 79 acacia
    feuillage(80, [118, 150, 50], 0.16);                               // 80 feuilles d'acacia
    (function () {                                                    // 81 lianes
      var o = clear(81);
      for (var x = 1; x < TILE; x += 3) {
        var h = 8 + ((rnd() * 8) | 0);
        for (var y = 0; y < h; y++) px(o[0], o[1], x + (y % 4 === 0 ? 1 : 0), y, y % 5 ? '#3f8a2c' : '#5aa83c');
      }
    })();
    grain(82, [190, 102, 44], 20);                                    // 82 sable rouge
    grain(83, [160, 90, 60], 12);                                     // 83 terre cuite
    grain(84, [142, 60, 46], 12);                                     // 84 terre cuite rouge
    grain(85, [196, 150, 64], 12);                                    // 85 terre cuite ocre
    taches(86, [140, 180, 230], 10, 'rgba(230,245,255,.5)', 6, 2);    // 86 glace compacte
    taches(87, [118, 98, 118], 20, 'rgba(160,140,160,.6)', 16, 1);    // 87 mycélium dessus
    (function () {                                                    // 88 mycélium côté
      var o = grain(88, [134, 96, 58], 26);
      for (var x = 0; x < TILE; x++) { g.fillStyle = '#76627a'; g.fillRect(o[0] + x, o[1], 1, 2 + ((rnd() * 3) | 0)); }
    })();
    taches(89, [190, 40, 36], 16, '#f0ece0', 6, 2);                   // 89 chapeau de champignon
    grain(90, [220, 212, 190], 10);                                   // 90 pied de champignon
    (function () {                                                    // 91 pastèque dessus
      var o = grain(91, [90, 140, 40], 16);
      g.strokeStyle = 'rgba(40,80,20,.7)'; g.strokeRect(o[0] + 2.5, o[1] + 2.5, 11, 11);
    })();
    (function () {                                                    // 92 pastèque côté
      var o = grain(92, [100, 150, 44], 14);
      g.fillStyle = 'rgba(40,90,20,.8)';
      for (var x = 1; x < TILE; x += 4) g.fillRect(o[0] + x, o[1], 2, TILE);
    })();
    taches(93, [128, 124, 122], 30, 'rgba(80,76,74,.8)', 18, 2);      // 93 gravier
    grain(94, [160, 164, 176], 10);                                   // 94 argile

    // ─── mer (95-107) ────────────────────────────────────────────────────────
    (function () {                                                    // 95 varech
      var o = clear(95);
      for (var y = 0; y < TILE; y++) {
        var x = 7 + Math.round(Math.sin(y * 0.8) * 2);
        px(o[0], o[1], x, y, '#4a7a2a'); px(o[0], o[1], x + 1, y, '#5a8e34');
        if (y % 4 === 1) { px(o[0], o[1], x + 2, y, '#6aa040'); px(o[0], o[1], x + 3, y - 1, '#6aa040'); }
      }
    })();
    (function () {                                                    // 96 herbier
      var o = clear(96);
      for (var x = 1; x < TILE; x += 2) {
        var h = 5 + ((rnd() * 9) | 0);
        for (var y = TILE - h; y < TILE; y++) px(o[0], o[1], x, y, y % 3 ? '#2e8a4a' : '#3aa05a');
      }
    })();
    taches(97, [200, 60, 70], 20, 'rgba(255,140,150,.6)', 12, 2);     // 97 corail rouge
    taches(98, [220, 190, 50], 20, 'rgba(255,240,140,.6)', 12, 2);    // 98 corail jaune
    taches(99, [60, 90, 210], 20, 'rgba(140,180,255,.6)', 12, 2);     // 99 corail bleu
    function eventail(i, c) {
      var o = clear(i);
      for (var a = -3; a <= 3; a++) {
        for (var r = 2; r < 8; r++) {
          px(o[0], o[1], 8 + Math.round(a * r / 4), 15 - r - Math.abs(a) % 2, c);
        }
      }
      for (var y = 12; y < TILE; y++) px(o[0], o[1], 8, y, c);
    }
    eventail(100, '#e0485a'); eventail(101, '#f0d040'); eventail(102, '#4a70e8');
    taches(103, [210, 196, 70], 14, 'rgba(120,100,20,.7)', 14, 2);    // 103 éponge
    taches(104, [90, 160, 150], 18, 'rgba(60,110,120,.6)', 10, 3);    // 104 prismarine
    (function () {                                                    // 105 briques de prismarine
      var o = grain(105, [80, 150, 136], 12);
      g.fillStyle = 'rgba(40,90,90,.8)';
      g.fillRect(o[0], o[1] + 7, TILE, 1); g.fillRect(o[0], o[1] + 15, TILE, 1);
      g.fillRect(o[0] + 7, o[1], 1, 7); g.fillRect(o[0] + 3, o[1] + 8, 1, 7); g.fillRect(o[0] + 12, o[1] + 8, 1, 7);
    })();
    (function () {                                                    // 106 lanterne marine
      var o = grain(106, [210, 236, 230], 12);
      g.fillStyle = '#ffffff'; g.fillRect(o[0] + 5, o[1] + 5, 6, 6);
      g.strokeStyle = 'rgba(80,150,140,.9)'; g.strokeRect(o[0] + .5, o[1] + .5, 15, 15);
    })();
    (function () {                                                    // 107 cornichon de mer
      var o = clear(107);
      [[5, 9], [9, 7], [7, 11]].forEach(function (p) {
        g.fillStyle = '#6a9a3a'; g.fillRect(o[0] + p[0], o[1] + p[1], 3, 16 - p[1]);
        g.fillStyle = '#d8ff9a'; g.fillRect(o[0] + p[0] + 1, o[1] + p[1] - 1, 1, 1);
      });
    })();

    // ─── minerais et structures (108-124) ────────────────────────────────────
    function minerai(i, c) {
      var o = grain(i, [128, 128, 133], 26);
      for (var k = 0; k < 7; k++) {
        g.fillStyle = c;
        g.fillRect(o[0] + 2 + ((rnd() * 11) | 0), o[1] + 2 + ((rnd() * 11) | 0), 2 + ((rnd() * 2) | 0), 2);
      }
    }
    minerai(108, '#f0c840'); minerai(109, '#5ae8e0');
    taches(110, [236, 196, 60], 12, 'rgba(255,240,160,.7)', 6, 2);   // 110 bloc d'or
    (function () {                                                    // 111 lanterne
      var o = clear(111);
      g.fillStyle = '#3a3a40'; g.fillRect(o[0] + 5, o[1] + 3, 6, 11); g.fillRect(o[0] + 7, o[1] + 1, 2, 2);
      g.fillStyle = '#ffc860'; g.fillRect(o[0] + 6, o[1] + 5, 4, 7);
      g.fillStyle = '#fff0b0'; g.fillRect(o[0] + 7, o[1] + 7, 2, 3);
    })();
    (function () {                                                    // 112 bibliothèque
      var o = grain(112, [150, 110, 64], 12);
      var cols = ['#8a2a2a', '#2a4a8a', '#2a7a3a', '#8a6a2a', '#5a2a6a'];
      [1, 9].forEach(function (y) {
        for (var x = 1; x < 15; x += 2) { g.fillStyle = cols[(rnd() * cols.length) | 0]; g.fillRect(o[0] + x, o[1] + y, 2, 6); }
      });
    })();
    (function () {                                                    // 113 grès taillé
      var o = grain(113, [214, 196, 140], 10);
      g.strokeStyle = 'rgba(150,120,70,.8)'; g.strokeRect(o[0] + 1.5, o[1] + 1.5, 13, 13);
      g.fillStyle = 'rgba(150,120,70,.8)'; g.fillRect(o[0] + 6, o[1] + 6, 4, 4);
    })();
    (function () {                                                    // 114 briques de glace
      var o = grain(114, [170, 206, 240], 10);
      g.fillStyle = 'rgba(110,150,200,.8)';
      g.fillRect(o[0], o[1] + 7, TILE, 1); g.fillRect(o[0], o[1] + 15, TILE, 1);
      g.fillRect(o[0] + 7, o[1], 1, 7); g.fillRect(o[0] + 3, o[1] + 8, 1, 7); g.fillRect(o[0] + 12, o[1] + 8, 1, 7);
    })();
    taches(115, [26, 18, 40], 14, 'rgba(90,60,130,.6)', 8, 2);        // 115 obsidienne
    (function () {                                                    // 116 toile
      var o = clear(116);
      g.strokeStyle = 'rgba(240,240,240,.85)'; g.lineWidth = 1;
      g.beginPath();
      g.moveTo(o[0], o[1]); g.lineTo(o[0] + 16, o[1] + 16); g.moveTo(o[0] + 16, o[1]); g.lineTo(o[0], o[1] + 16);
      g.moveTo(o[0] + 8, o[1]); g.lineTo(o[0] + 8, o[1] + 16); g.moveTo(o[0], o[1] + 8); g.lineTo(o[0] + 16, o[1] + 8);
      g.stroke();
      [3, 6].forEach(function (r) { g.strokeRect(o[0] + 8 - r + .5, o[1] + 8 - r + .5, r * 2, r * 2); });
    })();
    (function () {                                                    // 117 rail
      var o = clear(117);
      g.fillStyle = '#6a4a2a'; for (var y = 1; y < TILE; y += 4) g.fillRect(o[0] + 1, o[1] + y, 14, 2);
      g.fillStyle = '#a8a8b0'; g.fillRect(o[0] + 3, o[1], 2, TILE); g.fillRect(o[0] + 11, o[1], 2, TILE);
    })();
    taches(118, [200, 170, 60], 16, 'rgba(150,110,30,.7)', 10, 1);    // 118 foin dessus
    (function () {                                                    // 119 foin côté
      var o = grain(119, [206, 176, 64], 14);
      g.fillStyle = 'rgba(120,80,30,.8)'; g.fillRect(o[0], o[1] + 3, TILE, 2); g.fillRect(o[0], o[1] + 11, TILE, 2);
    })();
    grain(120, [190, 44, 40], 12); grain(121, [50, 70, 180], 12);     // 120-123 laines teintes
    grain(122, [230, 200, 40], 12); grain(123, [70, 140, 50], 12);
    (function () {                                                    // 124 échelle
      var o = clear(124);
      g.fillStyle = '#8a6438'; g.fillRect(o[0] + 2, o[1], 2, TILE); g.fillRect(o[0] + 12, o[1], 2, TILE);
      for (var y = 2; y < TILE; y += 4) g.fillRect(o[0] + 2, o[1] + y, 12, 2);
    })();

    // ─── objets (125-165) ────────────────────────────────────────────────────
    function lingot(i, c, clair) {
      var o = clear(i);
      g.fillStyle = c; g.fillRect(o[0] + 3, o[1] + 7, 10, 5);
      g.fillStyle = clair; g.fillRect(o[0] + 4, o[1] + 7, 8, 2);
    }
    lingot(125, '#e0b030', '#fff0a0');
    (function () {                                                    // 126 diamant
      var o = clear(126);
      g.fillStyle = '#5ae8e0';
      g.beginPath(); g.moveTo(o[0] + 8, o[1] + 2); g.lineTo(o[0] + 14, o[1] + 7);
      g.lineTo(o[0] + 8, o[1] + 14); g.lineTo(o[0] + 2, o[1] + 7); g.closePath(); g.fill();
      g.fillStyle = '#d8ffff'; g.fillRect(o[0] + 6, o[1] + 5, 3, 2);
    })();
    (function () {                                                    // 127 plume
      var o = clear(127);
      for (var k = 0; k < 11; k++) {
        px(o[0], o[1], 4 + k, 13 - k, '#8a8a8a');
        px(o[0], o[1], 3 + k, 12 - k, '#f0f0f0'); px(o[0], o[1], 5 + k, 12 - k, '#e0e0e0');
      }
    })();
    (function () {                                                    // 128 os
      var o = clear(128);
      for (var k = 0; k < 9; k++) g.fillStyle = '#ece8dc', g.fillRect(o[0] + 3 + k, o[1] + 11 - k, 2, 2);
      g.fillRect(o[0] + 2, o[1] + 11, 3, 3); g.fillRect(o[0] + 11, o[1] + 2, 3, 3);
    })();
    (function () {                                                    // 129 poudre d'os
      var o = clear(129);
      g.fillStyle = '#f4f0e6';
      g.beginPath(); g.arc(o[0] + 8, o[1] + 10, 5, Math.PI, 0); g.fill(); g.fillRect(o[0] + 3, o[1] + 10, 10, 3);
    })();
    (function () {                                                    // 130 éclat de prismarine
      var o = clear(130);
      g.fillStyle = '#6ab8a8';
      g.beginPath(); g.moveTo(o[0] + 4, o[1] + 13); g.lineTo(o[0] + 8, o[1] + 2); g.lineTo(o[0] + 12, o[1] + 12);
      g.closePath(); g.fill();
    })();
    (function () {                                                    // 131 poche d'encre
      var o = clear(131);
      g.fillStyle = '#1a1a26'; g.beginPath(); g.arc(o[0] + 8, o[1] + 9, 5, 0, 7); g.fill();
      g.fillStyle = '#3a3a50'; g.fillRect(o[0] + 6, o[1] + 6, 2, 2);
    })();
    function fiole(i, c) {
      var o = clear(i);
      g.fillStyle = '#d0d8e0'; g.fillRect(o[0] + 7, o[1] + 2, 2, 3);
      g.fillStyle = c; g.beginPath(); g.arc(o[0] + 8, o[1] + 10, 5, 0, 7); g.fill();
    }
    fiole(132, '#d0302a'); fiole(133, '#f0cc30'); fiole(134, '#3050d0'); fiole(135, '#40a030');
    function pomme(i, c) {
      var o = clear(i);
      g.fillStyle = c; g.beginPath(); g.arc(o[0] + 8, o[1] + 9, 5, 0, 7); g.fill();
      g.fillStyle = '#5a3a1a'; g.fillRect(o[0] + 8, o[1] + 2, 1, 3);
      g.fillStyle = '#4a9a30'; g.fillRect(o[0] + 9, o[1] + 3, 3, 2);
    }
    pomme(136, '#d0302a'); pomme(137, '#f0c030');
    function poisson(i, c, v) {
      var o = clear(i);
      g.fillStyle = c; g.beginPath(); g.ellipse(o[0] + 7, o[1] + 8, 5, 3, 0, 0, 7); g.fill();
      g.beginPath(); g.moveTo(o[0] + 11, o[1] + 8); g.lineTo(o[0] + 15, o[1] + 4); g.lineTo(o[0] + 15, o[1] + 12);
      g.closePath(); g.fill();
      g.fillStyle = v; g.fillRect(o[0] + 4, o[1] + 7, 1, 1);
    }
    poisson(138, '#8aa8c0', '#10141a'); poisson(139, '#b0784a', '#2a1a10');
    (function () {                                                    // 140 bol
      var o = clear(140);
      g.fillStyle = '#9a6a3a'; g.beginPath(); g.arc(o[0] + 8, o[1] + 8, 6, 0, Math.PI); g.fill();
      g.fillStyle = '#6a4424'; g.fillRect(o[0] + 2, o[1] + 8, 12, 1);
    })();
    (function () {                                                    // 141 soupe
      var o = clear(141);
      g.fillStyle = '#9a6a3a'; g.beginPath(); g.arc(o[0] + 8, o[1] + 8, 6, 0, Math.PI); g.fill();
      g.fillStyle = '#b89060'; g.fillRect(o[0] + 3, o[1] + 7, 10, 2);
      g.fillStyle = '#c0302a'; g.fillRect(o[0] + 6, o[1] + 6, 2, 1);
    })();
    (function () {                                                    // 142 tranche de pastèque
      var o = clear(142);
      g.fillStyle = '#4a8a2a'; g.beginPath(); g.arc(o[0] + 8, o[1] + 5, 7, 0, Math.PI); g.fill();
      g.fillStyle = '#e04a4a'; g.beginPath(); g.arc(o[0] + 8, o[1] + 5, 5.5, 0, Math.PI); g.fill();
      g.fillStyle = '#1a1a1a'; [[6, 7], [9, 8], [8, 6]].forEach(function (p) { g.fillRect(o[0] + p[0], o[1] + p[1], 1, 1); });
    })();
    (function () {                                                    // 143-144 volaille
      [[143, '#f0c8b0'], [144, '#c07838']].forEach(function (v) {
        var o = clear(v[0]);
        g.fillStyle = v[1]; g.beginPath(); g.ellipse(o[0] + 7, o[1] + 8, 5, 4, 0.4, 0, 7); g.fill();
        g.fillStyle = '#f0ece0'; g.fillRect(o[0] + 11, o[1] + 11, 3, 2);
      });
    })();
    ['pickaxe', 'axe', 'shovel', 'sword'].forEach(function (kind, ki) { tool(145 + ki, kind, 3); });
    (function () {                                                    // 149 arbalète
      var o = clear(149);
      g.fillStyle = '#6a4a28'; g.fillRect(o[0] + 7, o[1] + 3, 2, 12);
      g.strokeStyle = '#8a8a90'; g.lineWidth = 2;
      g.beginPath(); g.arc(o[0] + 8, o[1] + 9, 6, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
      g.strokeStyle = '#e8e4d8'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(o[0] + 3, o[1] + 6); g.lineTo(o[0] + 13, o[1] + 6); g.stroke();
    })();
    tool(150, 'sword', 4);                                             // 150 khépesh (or)
    tool(151, 'axe', 5);                                               // 151 hache de givre
    (function () {                                                    // 152 arc de la jungle
      var o = clear(152), ox = o[0], oy = o[1];
      g.strokeStyle = '#3a8a2a'; g.lineWidth = 2;
      g.beginPath(); g.arc(ox + 5, oy + 8, 6, -Math.PI / 2.2, Math.PI / 2.2); g.stroke();
      g.strokeStyle = '#f0e0a0'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(ox + 7, oy + 2); g.lineTo(ox + 7, oy + 14); g.stroke();
    })();
    (function () {                                                    // 153 bâton de la sorcière
      var o = clear(153);
      for (var k = 0; k < 10; k++) px(o[0], o[1], 4 + k, 14 - k, '#5a3a22');
      g.fillStyle = '#b040e0'; g.beginPath(); g.arc(o[0] + 13, o[1] + 3, 3, 0, 7); g.fill();
      px(o[0], o[1], 12, 2, '#f0c0ff');
    })();
    (function () {                                                    // 154 lance des cimes
      var o = clear(154);
      for (var k = 0; k < 12; k++) px(o[0], o[1], 2 + k, 14 - k, '#6a4a28');
      g.fillStyle = '#c8d8ff';
      g.beginPath(); g.moveTo(o[0] + 15, o[1]); g.lineTo(o[0] + 11, o[1] + 2); g.lineTo(o[0] + 13, o[1] + 4); g.closePath(); g.fill();
    })();
    (function () {                                                    // 155 trident
      var o = clear(155);
      for (var k = 0; k < 11; k++) px(o[0], o[1], 2 + k, 14 - k, '#3a8a8a');
      g.fillStyle = '#6ae0d0';
      g.fillRect(o[0] + 11, o[1] + 1, 1, 5); g.fillRect(o[0] + 13, o[1], 1, 4); g.fillRect(o[0] + 14, o[1] + 3, 1, 3);
    })();
    tool(156, 'sword', 2);                                             // 156 sabre
    (function () {                                                    // 157 roue
      var o = clear(157);
      g.fillStyle = '#222226'; g.beginPath(); g.arc(o[0] + 8, o[1] + 8, 7, 0, 7); g.fill();
      g.fillStyle = '#9a9aa2'; g.beginPath(); g.arc(o[0] + 8, o[1] + 8, 3, 0, 7); g.fill();
    })();
    (function () {                                                    // 158 moteur
      var o = clear(158);
      g.fillStyle = '#5a5a62'; g.fillRect(o[0] + 2, o[1] + 5, 12, 9);
      g.fillStyle = '#8a8a92'; for (var x = 3; x < 14; x += 3) g.fillRect(o[0] + x, o[1] + 2, 2, 3);
      g.fillStyle = '#d8762a'; g.fillRect(o[0] + 5, o[1] + 8, 6, 2);
    })();
    (function () {                                                    // 159 hélice
      var o = clear(159);
      g.fillStyle = '#b0b0b8';
      g.beginPath(); g.ellipse(o[0] + 8, o[1] + 4, 2, 4, 0, 0, 7); g.fill();
      g.beginPath(); g.ellipse(o[0] + 8, o[1] + 12, 2, 4, 0, 0, 7); g.fill();
      g.fillStyle = '#505058'; g.fillRect(o[0] + 7, o[1] + 7, 2, 2);
    })();
    // 160-165 véhicules : une silhouette de profil par engin
    function vehicule(i, c, dessin) { var o = clear(i); g.fillStyle = c; dessin(o[0], o[1]); }
    function roue(x, y) { g.fillStyle = '#18181c'; g.beginPath(); g.arc(x, y, 2, 0, 7); g.fill(); }
    vehicule(160, '#9a6a3a', function (x, y) {                         // bateau
      g.beginPath(); g.moveTo(x + 1, y + 8); g.lineTo(x + 15, y + 8); g.lineTo(x + 12, y + 13); g.lineTo(x + 4, y + 13);
      g.closePath(); g.fill();
    });
    vehicule(161, '#c02a2a', function (x, y) {                         // moto
      g.fillRect(x + 4, y + 7, 8, 3); roue(x + 3, y + 12); roue(x + 13, y + 12);
    });
    vehicule(162, '#2a6ac0', function (x, y) {                         // voiture
      g.fillRect(x + 1, y + 7, 14, 4); g.fillRect(x + 4, y + 4, 8, 3);
      g.fillStyle = '#b8e0ff'; g.fillRect(x + 5, y + 5, 6, 2); roue(x + 4, y + 12); roue(x + 12, y + 12);
    });
    vehicule(163, '#d88a2a', function (x, y) {                         // camion
      g.fillRect(x + 1, y + 4, 9, 7); g.fillStyle = '#5a5a62'; g.fillRect(x + 10, y + 6, 5, 5);
      roue(x + 3, y + 12); roue(x + 8, y + 12); roue(x + 13, y + 12);
    });
    vehicule(164, '#d8d8e0', function (x, y) {                         // avion
      g.fillRect(x + 1, y + 7, 14, 3); g.fillRect(x + 6, y + 3, 3, 11); g.fillRect(x + 1, y + 5, 2, 3);
    });
    vehicule(165, '#e0c030', function (x, y) {                         // sous-marin
      g.beginPath(); g.ellipse(x + 8, y + 10, 7, 3.5, 0, 0, 7); g.fill(); g.fillRect(x + 6, y + 4, 4, 4);
      g.fillStyle = '#6ab8ff'; g.fillRect(x + 4, y + 9, 2, 2); g.fillRect(x + 8, y + 9, 2, 2);
    });

    // ─── volcans, glaciers, exploration (166-172) ─────────────────────────────
    (function () {                                                    // 166 lave
      var o = grain(166, [220, 96, 20], 30);
      for (var k = 0; k < 18; k++) {
        g.fillStyle = rnd() < 0.5 ? '#ffd040' : '#ff9a20';
        g.fillRect(o[0] + ((rnd() * 14) | 0), o[1] + ((rnd() * 14) | 0), 1 + ((rnd() * 3) | 0), 1 + ((rnd() * 2) | 0));
      }
      g.fillStyle = 'rgba(120,30,10,.55)';
      for (var j = 0; j < 6; j++) g.fillRect(o[0] + ((rnd() * 14) | 0), o[1] + ((rnd() * 14) | 0), 2, 1);
    })();
    taches(167, [58, 56, 62], 18, 'rgba(90,88,96,.7)', 10, 2);         // 167 basalte dessus
    (function () {                                                    // 168 basalte côté
      var o = grain(168, [54, 52, 58], 16);
      g.fillStyle = 'rgba(30,28,34,.8)';
      for (var x = 2; x < TILE; x += 4) g.fillRect(o[0] + x, o[1], 1, TILE);
    })();
    (function () {                                                    // 169 magma
      var o = grain(169, [96, 30, 16], 20);
      g.strokeStyle = '#ff8a20'; g.lineWidth = 1;
      for (var k = 0; k < 5; k++) {
        g.beginPath(); var x0 = rnd() * 16, y0 = rnd() * 16;
        g.moveTo(o[0] + x0, o[1] + y0); g.lineTo(o[0] + x0 + (rnd() - 0.5) * 10, o[1] + y0 + (rnd() - 0.5) * 10);
        g.stroke();
      }
    })();
    taches(170, [90, 150, 230], 12, 'rgba(200,230,255,.55)', 8, 2);   // 170 glace bleue
    (function () {                                                    // 171 wagonnet
      var o = clear(171);
      g.fillStyle = '#6a6a72'; g.fillRect(o[0] + 2, o[1] + 5, 12, 6); g.fillRect(o[0] + 2, o[1] + 3, 2, 3); g.fillRect(o[0] + 12, o[1] + 3, 2, 3);
      g.fillStyle = '#18181c'; g.fillRect(o[0] + 3, o[1] + 11, 3, 3); g.fillRect(o[0] + 10, o[1] + 11, 3, 3);
    })();
    (function () {                                                    // 172 carte
      var o = clear(172);
      g.fillStyle = '#e8d8a8'; g.fillRect(o[0] + 2, o[1] + 2, 12, 12);
      g.fillStyle = '#5a9a40'; g.fillRect(o[0] + 3, o[1] + 3, 5, 4); g.fillRect(o[0] + 8, o[1] + 8, 5, 4);
      g.fillStyle = '#4a7ad8'; g.fillRect(o[0] + 9, o[1] + 3, 4, 4); g.fillRect(o[0] + 3, o[1] + 9, 4, 4);
      g.fillStyle = '#c02a2a'; g.fillRect(o[0] + 7, o[1] + 7, 2, 2);
      g.strokeStyle = '#8a6a3a'; g.strokeRect(o[0] + 1.5, o[1] + 1.5, 13, 13);
    })();

    // ─── habitations (173-187) ───────────────────────────────────────────────
    function planches(i, base, veine) {
      var o = grain(i, base, 16);
      g.fillStyle = veine;
      for (var y = 3; y < TILE; y += 4) g.fillRect(o[0], o[1] + y, TILE, 1);
      for (var r = 0; r < 4; r++) g.fillRect(o[0] + ((rnd() * 14) | 0), o[1] + r * 4, 1, 3);
      return o;
    }
    planches(173, [110, 80, 48], 'rgba(60,40,22,.6)');                // 173 planches de sapin
    planches(174, [206, 190, 138], 'rgba(150,130,84,.55)');            // 174 planches de bouleau
    planches(175, [178, 96, 52], 'rgba(110,52,24,.55)');               // 175 planches d'acacia
    planches(176, [168, 118, 80], 'rgba(100,66,40,.55)');              // 176 planches de jungle
    (function () {                                                    // 177 tuiles
      var o = grain(177, [172, 70, 50], 14);
      for (var y = 0; y < TILE; y += 4) {
        g.fillStyle = 'rgba(90,30,20,.7)'; g.fillRect(o[0], o[1] + y + 3, TILE, 1);
        for (var x = (y % 8 ? 2 : 6); x < TILE; x += 8) {
          g.fillStyle = 'rgba(210,110,80,.5)'; g.fillRect(o[0] + x, o[1] + y, 3, 2);
        }
      }
    })();
    (function () {                                                    // 178 ardoise
      var o = grain(178, [70, 74, 86], 12);
      g.fillStyle = 'rgba(30,32,40,.7)';
      for (var y = 0; y < TILE; y += 4) {
        g.fillRect(o[0], o[1] + y + 3, TILE, 1);
        for (var x = (y % 8 ? 0 : 4); x < TILE; x += 8) g.fillRect(o[0] + x, o[1] + y, 1, 4);
      }
    })();
    taches(179, [232, 228, 214], 8, 'rgba(200,194,176,.6)', 10, 2);   // 179 enduit à la chaux
    (function () {                                                    // 180 pavé de rue
      var o = grain(180, [104, 104, 110], 18);
      g.strokeStyle = 'rgba(50,50,56,.75)';
      for (var y = 0; y < 4; y++) for (var x = 0; x < 4; x++) {
        g.strokeRect(o[0] + x * 4 + (y % 2 ? 2 : 0) + 0.5, o[1] + y * 4 + 0.5, 4, 4);
      }
    })();
    (function () {                                                    // 181 comptoir dessus
      var o = grain(181, [150, 104, 60], 12);
      g.fillStyle = 'rgba(80,50,26,.7)'; g.fillRect(o[0], o[1], TILE, 1); g.fillRect(o[0], o[1] + 15, TILE, 1);
    })();
    (function () {                                                    // 182 comptoir côté
      var o = grain(182, [130, 88, 50], 12);
      g.fillStyle = 'rgba(70,44,22,.75)';
      g.fillRect(o[0], o[1] + 2, TILE, 2);
      for (var x = 1; x < TILE; x += 5) g.fillRect(o[0] + x, o[1] + 4, 1, 12);
    })();
    (function () {                                                    // 183 coffre-fort
      var o = grain(183, [96, 98, 104], 8);
      g.fillStyle = '#4a4c54'; g.fillRect(o[0] + 2, o[1] + 2, 12, 12);
      g.fillStyle = '#b8bcc6'; g.fillRect(o[0] + 3, o[1] + 3, 10, 10);
      g.fillStyle = '#e0b030'; g.fillRect(o[0] + 7, o[1] + 6, 3, 3);
      g.fillStyle = '#6a6c74'; g.fillRect(o[0] + 8, o[1] + 9, 1, 3);
    })();
    (function () {                                                    // 184 tonneau dessus
      var o = grain(184, [140, 98, 56], 12);
      g.strokeStyle = 'rgba(70,50,30,.85)'; g.strokeRect(o[0] + 1.5, o[1] + 1.5, 13, 13);
      g.fillStyle = 'rgba(70,50,30,.6)'; g.fillRect(o[0] + 7, o[1] + 2, 1, 12);
    })();
    (function () {                                                    // 185 tonneau côté
      var o = grain(185, [134, 92, 52], 12);
      g.fillStyle = 'rgba(80,58,34,.6)';
      for (var x = 2; x < TILE; x += 4) g.fillRect(o[0] + x, o[1], 1, TILE);
      g.fillStyle = '#5a5a60'; g.fillRect(o[0], o[1] + 3, TILE, 2); g.fillRect(o[0], o[1] + 11, TILE, 2);
    })();
    (function () {                                                    // 186 enclume
      var o = grain(186, [70, 70, 76], 10);
      g.fillStyle = '#2e2e34';
      g.fillRect(o[0] + 1, o[1] + 2, 14, 4); g.fillRect(o[0] + 5, o[1] + 6, 6, 5); g.fillRect(o[0] + 3, o[1] + 11, 10, 3);
      g.fillStyle = 'rgba(200,200,210,.35)'; g.fillRect(o[0] + 1, o[1] + 2, 14, 1);
    })();
    (function () {                                                    // 187 panneau d'information
      var o = grain(187, [176, 136, 84], 10);
      g.fillStyle = '#f2ead0'; g.fillRect(o[0] + 2, o[1] + 2, 12, 12);
      g.fillStyle = '#2a64c8'; g.fillRect(o[0] + 7, o[1] + 3, 2, 2); g.fillRect(o[0] + 7, o[1] + 6, 2, 6);
      g.strokeStyle = '#6a4a28'; g.strokeRect(o[0] + 1.5, o[1] + 1.5, 13, 13);
    })();

    // ─── minerais (227-231, SPEC-MINERAI-001) et bioluminescence (232-235, SPEC-LUMIERE-007) ──
    minerai(227, '#d68a4a');                                          // cuivre + étain, tacheté roux
    minerai(228, '#c9c9d8');                                          // argent + lapis, tacheté clair
    minerai(229, '#e04a78');                                          // gemmes, tacheté rose vif
    minerai(230, '#e8e8c0');                                          // quartz + soufre, tacheté pâle
    (function () {                                                    // 231 sel : cristaux blancs
      var o = grain(231, [224, 222, 214], 14);
      g.fillStyle = '#ffffff';
      for (var k = 0; k < 9; k++) g.fillRect(o[0] + 1 + ((rnd() * 13) | 0), o[1] + 1 + ((rnd() * 13) | 0), 2, 2);
    })();
    (function () {                                                    // 232 champignon lumineux
      var o = clear(232);
      g.fillStyle = '#3a6a52'; g.fillRect(o[0] + 7, o[1] + 8, 2, 6);
      g.fillStyle = '#7ef0c0';
      g.beginPath(); g.ellipse(o[0] + 8, o[1] + 7, 5, 3, 0, 0, 7); g.fill();
      g.fillStyle = '#c8fff0'; g.fillRect(o[0] + 6, o[1] + 6, 1, 1); g.fillRect(o[0] + 10, o[1] + 6, 1, 1);
    })();
    taches(233, [120, 200, 230], 16, 'rgba(220,255,255,.85)', 6, 3);  // 233 cristal lumineux
    (function () {                                                    // 234 algue luminescente
      var o = clear(234);
      g.fillStyle = '#2a9a7a';
      for (var i = 0; i < 3; i++) px(o[0], o[1], 5 + i * 3, 3, '#2a9a7a');
      for (var y = 3; y < 15; y++) for (var i2 = 0; i2 < 3; i2++) px(o[0], o[1], 5 + i2 * 3, y, y % 3 ? '#2a9a7a' : '#8affe0');
    })();
    (function () {                                                    // 235 plancton luminescent
      var o = clear(235);
      for (var k = 0; k < 10; k++) {
        g.fillStyle = k % 2 ? '#bfffef' : '#4adfc0';
        g.fillRect(o[0] + 1 + ((rnd() * 14) | 0), o[1] + 1 + ((rnd() * 14) | 0), 1, 1);
      }
    })();

    // ─── matières des minerais, objets (236-252, SPEC-MINERAI-002) ───────────
    function lingot(i, clair, fonce) {
      var o = clear(i);
      g.fillStyle = fonce; g.fillRect(o[0] + 3, o[1] + 7, 10, 5);
      g.fillStyle = clair; g.fillRect(o[0] + 4, o[1] + 7, 8, 2);
    }
    function pepite(i, c1, c2) {
      var o = clear(i);
      g.fillStyle = c1;
      g.beginPath(); g.ellipse(o[0] + 8, o[1] + 8, 5, 4, 0.3, 0, 7); g.fill();
      g.fillStyle = c2; g.fillRect(o[0] + 6, o[1] + 6, 3, 2);
    }
    function gemme(i, c1, c2) {
      var o = clear(i);
      g.fillStyle = c1;
      g.beginPath(); g.moveTo(o[0] + 8, o[1] + 2); g.lineTo(o[0] + 13, o[1] + 8);
      g.lineTo(o[0] + 8, o[1] + 14); g.lineTo(o[0] + 3, o[1] + 8); g.closePath(); g.fill();
      g.fillStyle = c2; g.fillRect(o[0] + 7, o[1] + 5, 3, 3);
    }
    pepite(236, '#c87a4a', '#e8a878');                                // cuivre brut
    lingot(237, '#f0a878', '#c8703c');                                // lingot de cuivre
    pepite(238, '#b8c0c8', '#e0e6ea');                                // étain brut
    lingot(239, '#e8ecef', '#b0b8bf');                                // lingot d'étain
    pepite(240, '#c8ccd2', '#eef0f4');                                // argent brut
    lingot(241, '#f2f4f8', '#c0c4cc');                                // lingot d'argent
    gemme(242, '#2a5adf', '#7aa0ff');                                 // lapis-lazuli
    gemme(243, '#d81030', '#ff6a86');                                 // rubis
    gemme(244, '#1560d8', '#7ec0ff');                                 // saphir
    gemme(245, '#e8d8c8', '#fff6ea');                                 // quartz
    (function () {                                                    // soufre : poudre jaune
      var o = clear(246);
      g.fillStyle = '#e8d030';
      for (var k = 0; k < 14; k++) g.fillRect(o[0] + 1 + ((rnd() * 14) | 0), o[1] + 1 + ((rnd() * 14) | 0), 1, 1);
    })();
    lingot(247, '#e0a860', '#a86830');                                // lingot de bronze
    function outilBronze(i, forme) {
      var o = clear(i);
      g.fillStyle = '#8a6a3c'; g.fillRect(o[0] + 7, o[1] + 8, 2, 7);   // manche
      g.fillStyle = '#c88a4a';
      if (forme === 'pioche') { g.fillRect(o[0] + 3, o[1] + 4, 10, 3); }
      else if (forme === 'hache') { g.fillRect(o[0] + 8, o[1] + 3, 6, 6); }
      else if (forme === 'pelle') { g.fillRect(o[0] + 6, o[1] + 3, 4, 5); }
      else { g.fillRect(o[0] + 7, o[1] + 2, 3, 7); }
    }
    outilBronze(248, 'pioche'); outilBronze(249, 'hache'); outilBronze(250, 'pelle'); outilBronze(251, 'epee');
    (function () {                                                    // bijou
      var o = clear(252);
      g.fillStyle = '#e8c860'; g.beginPath(); g.arc(o[0] + 8, o[1] + 9, 5, 0, 7); g.fill();
      g.fillStyle = '#902050';
      g.beginPath(); g.moveTo(o[0] + 8, o[1] + 3); g.lineTo(o[0] + 11, o[1] + 8);
      g.lineTo(o[0] + 8, o[1] + 13); g.lineTo(o[0] + 5, o[1] + 8); g.closePath(); g.fill();
    })();

    // ─── seau (188-189) ─────────────────────────────────────────────────────
    function seau(i, plein) {
      var o = clear(i);
      g.fillStyle = '#8a8c94'; g.fillRect(o[0] + 3, o[1] + 5, 10, 9);
      g.fillStyle = '#b4b6be'; g.fillRect(o[0] + 3, o[1] + 5, 10, 2);
      g.fillStyle = '#5a5c64'; g.fillRect(o[0] + 4, o[1] + 13, 8, 1);
      g.strokeStyle = '#6a6c74'; g.beginPath(); g.arc(o[0] + 8, o[1] + 6, 5, Math.PI, 0); g.stroke();
      if (plein) { g.fillStyle = '#3a78d8'; g.fillRect(o[0] + 4, o[1] + 6, 8, 2); }
    }
    seau(188, false);
    seau(189, true);

    // ─── porte et trappe (190-191) ─────────────────────────────────────────
    (function () {                                                    // 190 porte
      var o = grain(190, [150, 108, 62], 16);
      g.fillStyle = 'rgba(90,62,32,.7)';
      g.strokeRect(o[0] + 1.5, o[1] + 1.5, 13, 13);
      // deux panneaux, comme une porte à cadre
      g.strokeRect(o[0] + 3, o[1] + 2, 4.5, 5.5);
      g.strokeRect(o[0] + 8.5, o[1] + 2, 4.5, 5.5);
      g.strokeRect(o[0] + 3, o[1] + 8.5, 4.5, 5.5);
      g.strokeRect(o[0] + 8.5, o[1] + 8.5, 4.5, 5.5);
      // poignée
      g.fillStyle = '#e0c060'; g.fillRect(o[0] + 11, o[1] + 8, 2, 2);
    })();
    (function () {                                                    // 191 trappe
      var o = grain(191, [150, 108, 62], 16);
      g.fillStyle = 'rgba(90,62,32,.75)';
      for (var y = 2; y < TILE; y += 4) g.fillRect(o[0] + 1, o[1] + y, TILE - 2, 1);
      g.strokeStyle = 'rgba(70,48,26,.8)'; g.strokeRect(o[0] + 1.5, o[1] + 1.5, 13, 13);
      // charnières
      g.fillStyle = '#8a8c94'; g.fillRect(o[0] + 2, o[1] + 1, 2, 2); g.fillRect(o[0] + 12, o[1] + 1, 2, 2);
    })();

    // ─── textures raccordables et variantes ──────────────────────────────────
    /* Taches douces TUILABLES : un réseau de 4 × 4 valeurs aléatoires,
       interpolé en bouclant sur les bords. Le motif se raccorde donc avec
       lui-même : posées côte à côte, deux tuiles ne laissent voir aucune
       couture, là où le grain pixel à pixel seul paraissait plat. */
    function tachesTuilables(i, amp) {
      var o = origin(i);
      var img = g.getImageData(o[0], o[1], TILE, TILE), px = img.data;
      var L = [], N = 4;
      for (var a = 0; a < N * N; a++) L.push(rnd() - 0.5);
      function lis(t) { return t * t * (3 - 2 * t); }
      for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
        var fx = x / TILE * N, fy = y / TILE * N;
        var x0 = Math.floor(fx), y0 = Math.floor(fy), tx = lis(fx - x0), ty = lis(fy - y0);
        var x1 = (x0 + 1) % N, y1 = (y0 + 1) % N;
        var v = (L[y0 * N + x0] * (1 - tx) + L[y0 * N + x1] * tx) * (1 - ty) +
                (L[y1 * N + x0] * (1 - tx) + L[y1 * N + x1] * tx) * ty;
        var k = (y * TILE + x) * 4;
        if (px[k + 3] === 0) continue;                // trou d'un feuillage : on n'y touche pas
        px[k] = clamp(px[k] + v * amp); px[k + 1] = clamp(px[k + 1] + v * amp); px[k + 2] = clamp(px[k + 2] + v * amp);
      }
      g.putImageData(img, o[0], o[1]);
    }
    var TACHES = { 0: 26, 2: 22, 3: 24, 4: 18, 9: 14, 12: 14, 56: 10, 57: 0, 59: 12, 82: 18,
                   86: 12, 87: 16, 93: 16, 94: 12, 83: 14, 7: 20, 78: 20, 64: 18, 66: 18 };
    Object.keys(TACHES).forEach(function (t) { if (TACHES[t]) tachesTuilables(+t, TACHES[t]); });

    /* Variantes : la tuile de base, décalée d'un roulement circulaire (qui
       reste raccordable), puis re-tachetée. Une tuile de côté ne roule
       qu'horizontalement : la frange d'herbe doit rester en haut. */
    var CV = MC.Core;
    Object.keys(CV.INDEX_VARIANTES).forEach(function (t) {
      var base = +t, liste = CV.INDEX_VARIANTES[t], cote = CV.TUILES_VARIABLES[t].cote;
      var ob = origin(base);
      var src = g.getImageData(ob[0], ob[1], TILE, TILE);
      for (var k = 1; k < liste.length; k++) {
        var dx = 3 + ((rnd() * 10) | 0), dy = cote ? 0 : 3 + ((rnd() * 10) | 0);
        var out = g.createImageData(TILE, TILE);
        for (var y = 0; y < TILE; y++) for (var x = 0; x < TILE; x++) {
          var s = (((y + dy) % TILE) * TILE + ((x + dx) % TILE)) * 4, d = (y * TILE + x) * 4;
          for (var c = 0; c < 4; c++) out.data[d + c] = src.data[s + c];
        }
        var ov = origin(liste[k]);
        g.putImageData(out, ov[0], ov[1]);
        tachesTuilables(liste[k], (TACHES[base] || 12) * 0.8);
      }
    });

    var tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;      // pas de mipmap : évite le bleed entre tuiles
    tex.generateMipmaps = false;

    return { texture: tex, canvas: cv, dataURL: cv.toDataURL(),
             TILE: TILE, COLS: COLS, ROWS: ROWS };
  }

  MC.buildAtlas = buildAtlas;
})(typeof globalThis !== 'undefined' ? globalThis : this);
