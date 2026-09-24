/* noise.js — bruit déterministe. Fonction pure de (x, z) : aucune dépendance au
   monde chargé, ce qui permet de prospecter le terrain avant de générer un chunk. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  function makeNoise(seed) {
    function hash2(x, z) {
      var h = Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263) + seed;
      h = (h ^ (h >>> 13)) >>> 0;
      h = Math.imul(h, 1274126177) >>> 0;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    function hash3(x, y, z) {
      var h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 1103515245)
            + Math.imul(z | 0, 668265263) + seed;
      h = (h ^ (h >>> 13)) >>> 0;
      h = Math.imul(h, 1274126177) >>> 0;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    function smooth(t) { return t * t * (3 - 2 * t); }

    function value2(x, z) {
      var xi = Math.floor(x), zi = Math.floor(z);
      var xf = smooth(x - xi), zf = smooth(z - zi);
      var a = hash2(xi, zi), b = hash2(xi + 1, zi);
      var c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
      return (a + (b - a) * xf) * (1 - zf) + (c + (d - c) * xf) * zf;
    }
    /* Value noise 3D : sert à creuser les grottes. Interpolation trilinéaire
       des 8 sommets du cube entier englobant. Les 8 appels à hash3 sont
       écrits à plat plutôt que via une fermeture `at(dx,dy,dz)` : cette
       fermeture était réallouée à chaque appel de value3 (profilé au
       2026-09-24 avec node --cpu-prof — value3 et sa fermeture pesaient
       ensemble près de 10 % du CPU de génération), pour un calcul identique
       au bit près (SPEC-PERF-001). */
    function value3(x, y, z) {
      var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      var xf = smooth(x - xi), yf = smooth(y - yi), zf = smooth(z - zi);
      var v000 = hash3(xi, yi, zi), v100 = hash3(xi + 1, yi, zi);
      var v010 = hash3(xi, yi + 1, zi), v110 = hash3(xi + 1, yi + 1, zi);
      var v001 = hash3(xi, yi, zi + 1), v101 = hash3(xi + 1, yi, zi + 1);
      var v011 = hash3(xi, yi + 1, zi + 1), v111 = hash3(xi + 1, yi + 1, zi + 1);
      var c00 = v000 + (v100 - v000) * xf;
      var c10 = v010 + (v110 - v010) * xf;
      var c01 = v001 + (v101 - v001) * xf;
      var c11 = v011 + (v111 - v011) * xf;
      var c0 = c00 + (c10 - c00) * yf;
      var c1 = c01 + (c11 - c01) * yf;
      return c0 + (c1 - c0) * zf;
    }
    function fbm3(x, y, z, oct, lac, gain) {
      var sum = 0, amp = 1, freq = 1, norm = 0;
      for (var i = 0; i < oct; i++) {
        sum += value3(x * freq, y * freq, z * freq) * amp;
        norm += amp; amp *= gain; freq *= lac;
      }
      return sum / norm;
    }

    function fbm(x, z, oct, lac, gain) {
      var sum = 0, amp = 1, freq = 1, norm = 0;
      for (var i = 0; i < oct; i++) {
        sum += value2(x * freq, z * freq) * amp;
        norm += amp; amp *= gain; freq *= lac;
      }
      return sum / norm;
    }
    // fbm se concentre autour de 0.5 ; recentré en [-1,1] pour obtenir
    // autant de creux que de bosses (sans quoi aucun terrain ne passe sous la mer).
    function signed(v) { return (v - 0.5) * 2; }

    return { hash2: hash2, hash3: hash3, value2: value2, fbm: fbm, signed: signed,
             value3: value3, fbm3: fbm3 };
  }

  MC.makeNoise = makeNoise;
})(typeof globalThis !== 'undefined' ? globalThis : this);
