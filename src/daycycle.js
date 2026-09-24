/* daycycle.js — cycle jour/nuit et calendrier des saisons. Fonctions pures de
   l'heure du monde.

   SPEC-SAISON-001 : une journée dure 1200 s (20 min réelles) ; une année
   compte 9 journées (10800 s, 3 h réelles), en quatre saisons égales de 2,25
   journées — printemps, été, automne, hiver.
   SPEC-SAISON-002 : la part de la journée qui est éclairée (et la hauteur de
   l'arc du soleil) varie en continu avec la position dans l'année — plus
   longue et plus haute l'été, plus courte et plus basse l'hiver — sans jamais
   sauter d'un jour à l'autre : tout dépend d'une fonction continue de `t`. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var DAY_LENGTH = 1200;          // secondes pour un cycle jour/nuit complet
  var DAYS_PER_YEAR = 9;          // journées dans une année
  var YEAR_LENGTH = DAY_LENGTH * DAYS_PER_YEAR;   // 10800 s = 3 h réelles

  function phase(t) { var p = (t % DAY_LENGTH) / DAY_LENGTH; return p < 0 ? p + 1 : p; }

  /* Position continue dans l'année, 0..1 : 0 au tout début du printemps,
     0.25 au début de l'été, 0.5 à l'automne, 0.75 à l'hiver. */
  function fracAnnee(t) { var p = (t % YEAR_LENGTH) / YEAR_LENGTH; return p < 0 ? p + 1 : p; }

  var NOMS_SAISONS = ['printemps', 'ete', 'automne', 'hiver'];
  /* Calendrier : saison, jour de l'année (1..9), année (à partir de 1) et
     position dans la saison (0..1) — tout déduit de `t`, donc partagé par
     tous les postes et sauvegardé avec l'heure du monde. */
  function saison(t) {
    var fa = fracAnnee(t);
    var index = Math.min(3, Math.floor(fa * 4));
    var jourAnnee = Math.min(DAYS_PER_YEAR - 1, Math.floor(fa * DAYS_PER_YEAR));
    var annee = Math.floor(t / YEAR_LENGTH) + 1;
    return {
      nom: NOMS_SAISONS[index], index: index,
      fraction: fa * 4 - index,
      jour: jourAnnee + 1,
      annee: annee,
    };
  }

  /* Facteur saisonnier continu : 1 au cœur de l'été, -1 au cœur de l'hiver,
     0 aux équinoxes — réutilisé pour la hauteur du soleil, la durée du jour,
     la température et les teintes du feuillage. */
  function facteurSaison(t) { return Math.cos(2 * Math.PI * (fracAnnee(t) - 0.375)); }

  // largeurs (fixes) du crépuscule et de l'aube ; seule la part de jour varie
  var DUSK_W = 0.07, DAWN_W = 0.08;
  var JOUR_BASE = 0.48, JOUR_AMPL = 0.05;
  /* Part de la journée (0..1) qui est éclairée, avant le crépuscule — plus
     grande l'été, plus petite l'hiver, continue dans le temps. */
  function jourFrac(t) { return JOUR_BASE + JOUR_AMPL * facteurSaison(t); }

  // 0.00–jourFrac jour · +DUSK_W crépuscule · nuit · 1-DAWN_W–1 aube
  function isNight(t) { var p = phase(t), jf = jourFrac(t); return p >= jf + DUSK_W && p < 1 - DAWN_W; }
  function isDusk(t) { var p = phase(t), jf = jourFrac(t); return p >= jf && p < jf + DUSK_W; }
  function isDawn(t) { return phase(t) >= 1 - DAWN_W; }

  /* Intensité du soleil, 0 la nuit à 1 en plein jour, avec des transitions
     continues pour éviter un basculement brutal au crépuscule. */
  function sunIntensity(t) {
    var p = phase(t), jf = jourFrac(t);
    if (p < jf) return 1;
    if (p < jf + DUSK_W) return 1 - (p - jf) / DUSK_W;
    if (p < 1 - DAWN_W) return 0;
    return (p - (1 - DAWN_W)) / DAWN_W;
  }

  function lerp(a, b, k) { return a + (b - a) * k; }

  /* Couleur du ciel en [r,g,b] 0..1 : bleu de jour, orangé au crépuscule,
     bleu nuit très sombre. Les frontières suivent la même part de jour que
     isNight/isDusk (à JOUR_AMPL=0, on retrouve exactement les seuils d'origine). */
  var DAY = [0.529, 0.718, 0.910];
  var DUSK = [0.94, 0.52, 0.30];
  // bleu nuit assez clair pour que l'horizon reste lisible sans tuer le contraste
  var NIGHT = [0.07, 0.09, 0.17];
  function skyColor(t) {
    var p = phase(t), jf = jourFrac(t), a, b, k;
    var d1 = jf - 0.04, d2 = jf + 0.02, d3 = jf + 0.10;
    var a1 = (1 - DAWN_W) - 0.02, a2 = (1 - DAWN_W) + 0.04;
    if (p < d1) { return DAY.slice(); }
    if (p < d2) { a = DAY; b = DUSK; k = (p - d1) / (d2 - d1); }
    else if (p < d3) { a = DUSK; b = NIGHT; k = (p - d2) / (d3 - d2); }
    else if (p < a1) { return NIGHT.slice(); }
    else if (p < a2) { a = NIGHT; b = DUSK; k = (p - a1) / (a2 - a1); }
    else { a = DUSK; b = DAY; k = (p - a2) / (1 - a2); }
    return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  }

  /* Position du soleil sur un arc, pour orienter la lumière directionnelle.
     SPEC-SAISON-002 : sa hauteur (z) s'élève l'été, s'abaisse l'hiver. */
  function sunDir(t) {
    var ang = phase(t) * Math.PI * 2 - Math.PI / 2;
    var haut = 0.35 + 0.15 * facteurSaison(t);
    return { x: Math.cos(ang) * 0.6, y: Math.max(0.05, -Math.sin(ang)), z: haut };
  }

  /* Course des astres, cohérente avec les phases du jour : le soleil se lève
     à l'aube (0,94), culmine en milieu de journée et se couche au crépuscule
     (0,515) ; la nuit il passe sous l'horizon et la lune, à l'opposé, monte.
     Renvoie des directions unitaires, la lune à l'opposé du soleil, sa phase
     (0 nouvelle … 4 pleine … 7) et la visibilité des étoiles. */
  var LEVER = 0.94, COUCHER = 0.515;
  var DUREE_JOUR = (COUCHER + 1 - LEVER) % 1;
  /* SPEC-SAISON-002 : l'arc garde son lever et son coucher (LEVER/COUCHER,
     des repères fixes, à l'équinoxe) mais s'élève l'été et s'abaisse l'hiver —
     seule sa hauteur (sz) varie avec la saison, en continu. */
  function astres(t) {
    var p = phase(t);
    var depuisLever = (p - LEVER + 1) % 1;
    var theta = depuisLever < DUREE_JOUR
      ? Math.PI * depuisLever / DUREE_JOUR                              // au-dessus de l'horizon
      : Math.PI + Math.PI * (depuisLever - DUREE_JOUR) / (1 - DUREE_JOUR); // en dessous
    var sx = Math.cos(theta), sy = Math.sin(theta), sz = 0.28 + 0.14 * facteurSaison(t);
    var n = Math.hypot(sx, sy, sz);
    var soleil = { x: sx / n, y: sy / n, z: sz / n };
    var jour = Math.floor(t / DAY_LENGTH);
    return {
      soleil: soleil,
      lune: { x: -soleil.x, y: -soleil.y, z: -soleil.z },
      phaseLune: ((jour % 8) + 8) % 8,
      etoiles: Math.max(0, Math.min(1, 1 - sunIntensity(t) * 1.4)),
    };
  }

  function clockString(t) {
    var p = phase(t);
    var mins = Math.floor(p * 24 * 60);
    var hh = Math.floor(mins / 60), mm = mins % 60;
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }

  /* SPEC-SAISON-004 : teintes saisonnières des feuillages caducs, des
     conifères et de l'herbe, plus la densité (0..1) du feuillage caduc — il
     se clairsème l'hiver. Pure fonction de `t`, réutilisable par le rendu
     (un uniform par image) sans reconstruire les chunks à chaque saison.
     Quatre couleurs d'ancrage au cœur de chaque saison (0.125/0.375/0.625/0.875
     de l'année), mélangées en douceur (smoothstep) tout au long du cycle — la
     bascule vert → roux commence donc en fin d'été, comme demandé. */
  function melangeCycle(fa, vals) {
    var pts = [0.125, 0.375, 0.625, 0.875];
    for (var i = 0; i < 4; i++) {
      var a = pts[i], b = pts[(i + 1) % 4];
      var bb = b > a ? b : b + 1;
      var f = fa < a ? fa + 1 : fa;
      if (f >= a && f <= bb) {
        var k = (f - a) / (bb - a);
        k = k * k * (3 - 2 * k);
        return lerp(vals[i], vals[(i + 1) % 4], k);
      }
    }
    return vals[0];
  }
  function melangeRGB(fa, cols) {
    return {
      r: melangeCycle(fa, cols.map(function (c) { return c[0]; })),
      g: melangeCycle(fa, cols.map(function (c) { return c[1]; })),
      b: melangeCycle(fa, cols.map(function (c) { return c[2]; })),
    };
  }
  // ordre des ancres : printemps, été, automne, hiver
  var TEINTES_CADUC = [[0.55, 0.85, 0.45], [0.42, 0.72, 0.30], [0.80, 0.50, 0.14], [0.45, 0.36, 0.28]];
  var TEINTES_CONIFERE = [[0.24, 0.50, 0.28], [0.22, 0.46, 0.26], [0.22, 0.44, 0.27], [0.20, 0.40, 0.26]];
  var TEINTES_HERBE = [[0.48, 0.75, 0.34], [0.46, 0.70, 0.30], [0.78, 0.66, 0.24], [0.66, 0.58, 0.38]];
  var DENSITE_CADUC = [1, 1, 0.75, 0.18];
  function teinteSaison(t) {
    var fa = fracAnnee(t);
    return {
      caduc: melangeRGB(fa, TEINTES_CADUC),
      conifere: melangeRGB(fa, TEINTES_CONIFERE),
      herbe: melangeRGB(fa, TEINTES_HERBE),
      densiteCaduc: melangeCycle(fa, DENSITE_CADUC),
    };
  }

  /* SPEC-INTERIEUR-002 : dormir dans un lit fait passer la nuit — on avance
     l'horloge jusqu'au tout début de la journée suivante (phase 0), sans
     toucher au décompte des jours/saisons (juste +1 jour, comme un réveil
     normal). Fonction pure : c'est game.js qui décide QUAND l'appeler
     (joueur endormi, nuit tombée, tout le monde dort…). */
  function avancerJourApresDormir(t) { return (Math.floor(t / DAY_LENGTH) + 1) * DAY_LENGTH; }

  MC.DayCycle = {
    DAY_LENGTH: DAY_LENGTH, DAYS_PER_YEAR: DAYS_PER_YEAR, YEAR_LENGTH: YEAR_LENGTH,
    phase: phase, isNight: isNight, isDusk: isDusk, isDawn: isDawn,
    sunIntensity: sunIntensity, skyColor: skyColor, sunDir: sunDir, clockString: clockString,
    astres: astres, LEVER: LEVER, COUCHER: COUCHER,
    saison: saison, facteurSaison: facteurSaison, teinteSaison: teinteSaison,
    avancerJourApresDormir: avancerJourApresDormir,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
