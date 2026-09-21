/* atlas.js — toutes les textures sont peintes au runtime sur un canvas.
   Aucun asset externe : le jeu reste un dossier de fichiers texte. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var TILE = 16, COLS = 8, ROWS = 8;

  function buildAtlas() {
    var cv = document.createElement('canvas');
    cv.width = TILE * COLS; cv.height = TILE * ROWS;
    var g = cv.getContext('2d');

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
    var MATC = ['#b08040', '#9a9aa2', '#e0e0e6'];     // bois, pierre, fer
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

    var tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;      // pas de mipmap : évite le bleed entre tuiles
    tex.generateMipmaps = false;

    return { texture: tex, canvas: cv, dataURL: cv.toDataURL(),
             TILE: TILE, COLS: COLS, ROWS: ROWS };
  }

  MC.buildAtlas = buildAtlas;
})(typeof globalThis !== 'undefined' ? globalThis : this);
