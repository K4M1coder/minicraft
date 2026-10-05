/* options.js — réglages du joueur et touches (SPEC-OPTION-001, 003).
   Logique pure : valeurs par défaut, bornes, conservation dans un stockage
   injecté (localStorage dans le navigateur), remappage des touches avec
   détection des conflits, et table d'aide des touches en vigueur. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var CLE = 'minicraft.options';

  /* Chaque réglage : défaut et bornes (ou liste de valeurs). */
  var REGLAGES = {
    sensibilite: { defaut: 1, min: 0.2, max: 3, pas: 0.1, nom: 'Sensibilité de la souris' },
    volume:      { defaut: 0.8, min: 0, max: 1, pas: 0.05, nom: 'Volume du son' },
    champ:       { defaut: 72, min: 50, max: 110, pas: 1, nom: 'Champ de vision' },
    vueMax:      { defaut: 18, min: 4, max: 18, pas: 1, nom: 'Distance de vue maximale (chunks)' },
    realiste:    { defaut: true, nom: 'Rendu réaliste lointain' },
    ombres:      { defaut: true, nom: 'Ombres' },
    // affichage (SPEC-OPTION-004 à 006)
    gpu:         { defaut: 'auto', valeurs: ['auto', 'haute-performance', 'economie'], nom: 'GPU de calcul', relance: true },
    resolution:  { defaut: 'native', valeurs: ['native', '800x600', '1024x768', '1080p', '1440p', '4k'], nom: 'Résolution' },
    pleinEcran:  { defaut: false, nom: 'Plein écran' },
    ecran:       { defaut: 0, min: 0, max: 7, pas: 1, nom: 'Écran d’affichage' },
    nombreEcrans: { defaut: 1, min: 1, max: 3, pas: 1, nom: 'Nombre d’écrans' },
    orientation: { defaut: 'horizontal', valeurs: ['horizontal', 'vertical'], nom: 'Écrans côte à côte ou empilés' },
    // SPEC-OPTION-007 : menus et fenêtres à l'échelle de l'écran
    tailleInterface: { defaut: 'auto', valeurs: ['auto', '60', '75', '90', '100', '110', '125', '150'], nom: 'Taille de l’interface' },
    // SPEC-RENDU-012 : mipmaps de l'atlas de textures, activés par défaut.
    // Sûrs pour un atlas : générés tuile par tuile (MC.Qualite.mipmapsAtlas)
    // et lus par le shader à un niveau plafonné à celui où une tuile fait
    // encore un texel (render.js, avecAtlasRepete) — aucune tuile ne déborde
    // sur sa voisine. Coupés : moins de mémoire GPU, moiré possible au loin.
    mipmaps: { defaut: true, nom: 'Mipmaps des textures' },
    // SPEC-RENDU-006 : lissage (antialias, passe FXAA légère). « auto » le
    // laisse au FPS mesuré (coupé sous un FPS bas prolongé) ; « oui » le
    // réactive manuellement, « non » le coupe.
    antialias: { defaut: 'auto', valeurs: ['auto', 'oui', 'non'], nom: 'Lissage des contours (antialias)' },
  };

  /* SPEC-OPTION-007 : facteur d'échelle des menus pour une fenêtre de
     `largeur` × `hauteur` pixels CSS. « auto » réduit l'interface quand la
     fenêtre est plus petite que la maquette (1280 × 800), jamais sous 60 %,
     et ne l'agrandit pas ; sinon le pourcentage choisi. */
  var MAQUETTE = { l: 1280, h: 800 };
  function echelleInterface(taille, largeur, hauteur) {
    if (taille && taille !== 'auto') {
      var p = parseFloat(taille);
      return isFinite(p) ? Math.max(0.5, Math.min(2, p / 100)) : 1;
    }
    var e = Math.min((largeur || MAQUETTE.l) / MAQUETTE.l, (hauteur || MAQUETTE.h) / MAQUETTE.h);
    return Math.round(Math.max(0.6, Math.min(1, e)) * 100) / 100;
  }

  /* ── Affichage ───────────────────────────────────────────────────────── */
  var RESOLUTIONS = {
    native: null, '800x600': { l: 800, h: 600 }, '1024x768': { l: 1024, h: 768 },
    '1080p': { l: 1920, h: 1080 }, '1440p': { l: 2560, h: 1440 }, '4k': { l: 3840, h: 2160 },
  };
  /* Les résolutions qu'un écran (ou une rangée d'écrans) peut afficher. */
  function resolutionsPour(ecran) {
    return REGLAGES.resolution.valeurs.filter(function (id) {
      var r = RESOLUTIONS[id];
      return !r || !ecran || (r.l <= ecran.largeur && r.h <= ecran.hauteur);
    });
  }
  /* Disposition sur un, deux ou trois écrans. `ecrans` : [{ largeur, hauteur,
     principal }] ; s'il en manque, on revient à un seul écran (`repli`).
     Rend la taille totale et, pour chaque écran, sa part de la vue (0..1). */
  function disposition(ecrans, choix) {
    ecrans = ecrans && ecrans.length ? ecrans : [{ largeur: 1920, hauteur: 1080, principal: true }];
    var n = Math.max(1, Math.min(3, choix.nombreEcrans | 0 || 1)), vert = choix.orientation === 'vertical';
    var premier = Math.max(0, Math.min(ecrans.length - 1, choix.ecran | 0));
    var repli = false;
    if (premier + n > ecrans.length) {
      if (ecrans.length >= n) premier = ecrans.length - n;
      else { n = 1; repli = true; }
    }
    var choisis = ecrans.slice(premier, premier + n), segments = [];
    var largeur = 0, hauteur = 0;
    choisis.forEach(function (e, i) {
      segments.push(vert ? { x: 0, y: i / n, l: 1, h: 1 / n } : { x: i / n, y: 0, l: 1 / n, h: 1 });
      if (vert) { hauteur += e.hauteur; largeur = Math.max(largeur, e.largeur); }
      else { largeur += e.largeur; hauteur = Math.max(hauteur, e.hauteur); }
    });
    // le HUD va sur l'écran principal s'il fait partie des choisis, sinon au premier
    var p = choisis.findIndex(function (e) { return e.principal; });
    return { nombre: n, orientation: vert ? 'vertical' : 'horizontal', premier: premier, largeur: largeur, hauteur: hauteur,
             segments: segments, principal: p < 0 ? 0 : p, repli: repli };
  }
  /* Champ de vision vertical d'une vue étendue : côte à côte, l'aspect
     élargit déjà la vue ; empilés, le champ vertical s'ouvre d'autant. */
  function champEtendu(fov, nombre, orientation) {
    if (orientation !== 'vertical' || nombre <= 1) return fov;
    var t = Math.tan(fov * Math.PI / 360) * nombre;
    return Math.min(150, Math.atan(t) * 360 / Math.PI);
  }
  /* Rapport pixels/CSS pour rendre à la résolution voulue dans un hôte de
     `taille` (la résolution native suit l'écran, bornée à 2). */
  function rapportPixels(resolution, taille, dpr) {
    var r = RESOLUTIONS[resolution];
    if (!r) return Math.min(dpr || 1, 2);
    return Math.max(0.25, Math.min(4, Math.min(r.l / Math.max(1, taille.l), r.h / Math.max(1, taille.h))));
  }
  /* Préférence WebGL du GPU (le navigateur ne laisse choisir que celle-ci ;
     la version empaquetée peut désigner l'adaptateur). */
  function preferenceGpu(gpu) {
    return gpu === 'haute-performance' ? 'high-performance' : gpu === 'economie' ? 'low-power' : 'default';
  }

  /* Actions remappables et leurs touches par défaut (AZERTY et QWERTY pour
     les déplacements). L'ordre est celui de l'aide. */
  var ACTIONS = [
    { id: 'avancer',     nom: 'avancer',                        touches: ['KeyW', 'KeyZ', 'ArrowUp'] },
    { id: 'reculer',     nom: 'reculer',                        touches: ['KeyS', 'ArrowDown'] },
    { id: 'gauche',      nom: 'aller à gauche',                 touches: ['KeyA', 'KeyQ', 'ArrowLeft'] },
    { id: 'droite',      nom: 'aller à droite',                 touches: ['KeyD', 'ArrowRight'] },
    { id: 'sauter',      nom: 'sauter · nager · 2× = vol',      touches: ['Space'] },
    { id: 'courir',      nom: 'courir · descendre',             touches: ['ShiftLeft', 'ShiftRight'] },
    { id: 'inventaire',  nom: 'inventaire et craft 2×2',        touches: ['KeyE'] },
    { id: 'livre',       nom: 'livre des recettes',             touches: ['KeyL'] },
    { id: 'jeter',       nom: 'jeter un objet',                 touches: ['KeyG'] },
    { id: 'descendre',   nom: 'descendre du véhicule',          touches: ['KeyF'] },
    { id: 'carte',       nom: 'carte et points de repère',      touches: ['KeyC'] },
    { id: 'factions',    nom: 'factions et réputation',         touches: ['KeyJ'] },
    { id: 'succes',      nom: 'succès et progression',          touches: ['KeyK'] },
    { id: 'journal',     nom: 'journal de l\'histoire',         touches: ['KeyH'] },
    { id: 'son',         nom: 'couper ou remettre le son',      touches: ['KeyM'] },
    { id: 'chat',        nom: 'ouvrir le chat',                 touches: ['KeyT'] },
    { id: 'sauvegarder', nom: 'sauvegarder',                    touches: ['F5'] },
    { id: 'hud',         nom: 'afficher ou masquer tout le HUD', touches: ['F1'] },
  ];
  // réservées : jamais attribuables (pause, emplacements, commande)
  var RESERVEES = { Escape: 'pause', Slash: 'commande' };
  for (var d = 1; d <= 9; d++) RESERVEES['Digit' + d] = 'emplacement ' + d;

  function touchesParDefaut() {
    var t = {};
    ACTIONS.forEach(function (a) { t[a.id] = a.touches.slice(); });
    return t;
  }
  /* Format conservé : 2 depuis l'ajout de `modifies`. Jusqu'à la v0.7.0
     (pas de `schema`), `sauver` écrivait la table entière : impossible d'y
     distinguer un choix du joueur d'un défaut d'alors. `modifies` liste les
     réglages que le joueur a réellement réglés (via `regler`) ; au
     chargement, un réglage absent de cette liste prend le défaut COURANT —
     un défaut qui change (mipmaps, SPEC-RENDU-012) atteint donc aussi les
     anciens joueurs qui n'y avaient jamais touché. */
  var SCHEMA = 2;
  /* Réglages dont le défaut a changé depuis un stockage sans schéma
     (≤ v0.7.0) : relus comme jamais modifiés. Tous les autres réglages d'un
     tel stockage sont relus tels quels (aucune valeur ne bouge). */
  var DEFAUTS_CHANGES_V1 = ['mipmaps'];
  function defauts() {
    var o = {};
    Object.keys(REGLAGES).forEach(function (k) { o[k] = REGLAGES[k].defaut; });
    o.touches = touchesParDefaut();
    o.schema = SCHEMA;
    o.modifies = [];
    return o;
  }

  /* Une valeur ramenée dans ses bornes, ou le défaut si elle est invalide. */
  function valeur(cle, v) {
    var r = REGLAGES[cle];
    if (!r) return undefined;
    if (typeof r.defaut === 'boolean') return typeof v === 'boolean' ? v : r.defaut;
    if (r.valeurs) return r.valeurs.indexOf(v) >= 0 ? v : r.defaut;
    v = Number(v);
    if (!isFinite(v)) return r.defaut;
    v = Math.max(r.min, Math.min(r.max, v));
    // au pas du réglage, sans les résidus des flottants (0.30000000000000004)
    return Math.round(Math.round(v / r.pas) * r.pas * 1000) / 1000;
  }
  /* Nouvelle table de réglages avec `cle` = `v` (bornée). */
  function regler(opts, cle, v) {
    var o = copier(opts);
    if (REGLAGES[cle]) {
      o[cle] = valeur(cle, v);
      if (o.modifies.indexOf(cle) < 0) o.modifies.push(cle);
    }
    return o;
  }
  function copier(opts) {
    var o = {};
    Object.keys(opts).forEach(function (k) { o[k] = opts[k]; });
    o.touches = {};
    Object.keys(opts.touches || {}).forEach(function (k) { o.touches[k] = opts.touches[k].slice(); });
    o.schema = SCHEMA;
    o.modifies = Array.isArray(opts.modifies) ? opts.modifies.slice() : [];
    return o;
  }

  /* L'action d'une touche, ou null. */
  function actionDe(touches, code) {
    for (var i = 0; i < ACTIONS.length; i++) {
      var l = touches[ACTIONS[i].id];
      if (l && l.indexOf(code) >= 0) return ACTIONS[i].id;
    }
    return null;
  }
  /* Attribue `code` à `action` (il remplace ses touches). Un conflit — la
     touche sert déjà une autre action, ou est réservée — est signalé et rien
     ne change : { touches, conflit: null | nom de l'action en conflit }. */
  function lier(touches, action, code) {
    if (RESERVEES[code]) return { touches: touches, conflit: RESERVEES[code] };
    var autre = actionDe(touches, code);
    if (autre && autre !== action) return { touches: touches, conflit: autre };
    var t = {};
    Object.keys(touches).forEach(function (k) { t[k] = touches[k].slice(); });
    t[action] = [code];
    return { touches: t, conflit: null };
  }

  /* Nom lisible d'une touche. */
  var NOMS = { Space: 'espace', ShiftLeft: 'maj', ShiftRight: 'maj droite', ArrowUp: '↑', ArrowDown: '↓',
               ArrowLeft: '←', ArrowRight: '→', ControlLeft: 'ctrl', ControlRight: 'ctrl droite',
               AltLeft: 'alt', Tab: 'tab', Enter: 'entrée', Backspace: 'retour', CapsLock: 'verr. maj' };
  function nomTouche(code) {
    if (NOMS[code]) return NOMS[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad/.test(code)) return 'pavé ' + code.slice(6);
    return code;
  }
  /* L'aide : une ligne par action, avec ses touches en vigueur. */
  function aide(touches) {
    return ACTIONS.map(function (a) {
      var l = touches[a.id] || [];
      // les doublons AZERTY/QWERTY se lisent « Z / W »
      var noms = [];
      l.forEach(function (c) { var n = nomTouche(c); if (noms.indexOf(n) < 0) noms.push(n); });
      return { action: a.id, touches: noms.join(' / '), nom: a.nom };
    });
  }

  /* Conservation. Un stockage absent ou corrompu donne les défauts. */
  function charger(stockage) {
    var o = defauts();
    try {
      var brut = stockage && stockage.getItem(CLE);
      if (!brut) return o;
      var lu = JSON.parse(brut);
      var modifies = lu.schema >= 2 && Array.isArray(lu.modifies)
        ? lu.modifies.filter(function (k) { return REGLAGES.hasOwnProperty(k); })
        : Object.keys(REGLAGES).filter(function (k) { return k in lu && DEFAUTS_CHANGES_V1.indexOf(k) < 0; });
      modifies = modifies.filter(function (k, i) { return modifies.indexOf(k) === i; });
      modifies.forEach(function (k) { if (k in lu) o[k] = valeur(k, lu[k]); });
      o.modifies = modifies;
      if (lu.touches) ACTIONS.forEach(function (a) {
        var l = lu.touches[a.id];
        if (Array.isArray(l) && l.length && l.every(function (c) { return typeof c === 'string' && !RESERVEES[c]; })) o.touches[a.id] = l.slice();
      });
    } catch (e) { /* défauts */ }
    return o;
  }
  function sauver(stockage, opts) {
    try { if (stockage) stockage.setItem(CLE, JSON.stringify(copier(opts))); return true; } catch (e) { return false; }
  }

  MC.Options = { echelleInterface: echelleInterface, MAQUETTE: MAQUETTE, REGLAGES: REGLAGES, ACTIONS: ACTIONS, RESERVEES: RESERVEES, defauts: defauts, valeur: valeur,
                 regler: regler, actionDe: actionDe, lier: lier, nomTouche: nomTouche, aide: aide,
                 charger: charger, sauver: sauver, CLE: CLE, SCHEMA: SCHEMA,
                 RESOLUTIONS: RESOLUTIONS, resolutionsPour: resolutionsPour, disposition: disposition,
                 champEtendu: champEtendu, rapportPixels: rapportPixels, preferenceGpu: preferenceGpu };
})(typeof globalThis !== 'undefined' ? globalThis : this);
