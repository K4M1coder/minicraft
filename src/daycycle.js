/* daycycle.js — cycle jour/nuit. Fonctions pures de l'heure du monde. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var DAY_LENGTH = 420;           // secondes pour un cycle complet

  function phase(t) { var p = (t % DAY_LENGTH) / DAY_LENGTH; return p < 0 ? p + 1 : p; }

  // 0.00–0.48 jour · 0.48–0.55 crépuscule · 0.55–0.92 nuit · 0.92–1 aube
  function isNight(t) { var p = phase(t); return p >= 0.55 && p < 0.92; }
  function isDusk(t) { var p = phase(t); return p >= 0.48 && p < 0.55; }
  function isDawn(t) { return phase(t) >= 0.92; }

  /* Intensité du soleil, 0 la nuit à 1 en plein jour, avec des transitions
     continues pour éviter un basculement brutal au crépuscule. */
  function sunIntensity(t) {
    var p = phase(t);
    if (p < 0.48) return 1;
    if (p < 0.55) return 1 - (p - 0.48) / 0.07;
    if (p < 0.92) return 0;
    return (p - 0.92) / 0.08;
  }

  function lerp(a, b, k) { return a + (b - a) * k; }

  /* Couleur du ciel en [r,g,b] 0..1 : bleu de jour, orangé au crépuscule,
     bleu nuit très sombre. */
  var DAY = [0.529, 0.718, 0.910];
  var DUSK = [0.94, 0.52, 0.30];
  // bleu nuit assez clair pour que l'horizon reste lisible sans tuer le contraste
  var NIGHT = [0.07, 0.09, 0.17];
  function skyColor(t) {
    var p = phase(t), a, b, k;
    if (p < 0.44) { return DAY.slice(); }
    if (p < 0.50) { a = DAY; b = DUSK; k = (p - 0.44) / 0.06; }
    else if (p < 0.58) { a = DUSK; b = NIGHT; k = (p - 0.50) / 0.08; }
    else if (p < 0.90) { return NIGHT.slice(); }
    else if (p < 0.96) { a = NIGHT; b = DUSK; k = (p - 0.90) / 0.06; }
    else { a = DUSK; b = DAY; k = (p - 0.96) / 0.04; }
    return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  }

  /* Position du soleil sur un arc, pour orienter la lumière directionnelle. */
  function sunDir(t) {
    var ang = phase(t) * Math.PI * 2 - Math.PI / 2;
    return { x: Math.cos(ang) * 0.6, y: Math.max(0.05, -Math.sin(ang)), z: 0.35 };
  }

  function clockString(t) {
    var p = phase(t);
    var mins = Math.floor(p * 24 * 60);
    var hh = Math.floor(mins / 60), mm = mins % 60;
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  MC.DayCycle = {
    DAY_LENGTH: DAY_LENGTH, phase: phase, isNight: isNight, isDusk: isDusk, isDawn: isDawn,
    sunIntensity: sunIntensity, skyColor: skyColor, sunDir: sunDir, clockString: clockString,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
