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
  };

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
  function defauts() {
    var o = {};
    Object.keys(REGLAGES).forEach(function (k) { o[k] = REGLAGES[k].defaut; });
    o.touches = touchesParDefaut();
    return o;
  }

  /* Une valeur ramenée dans ses bornes, ou le défaut si elle est invalide. */
  function valeur(cle, v) {
    var r = REGLAGES[cle];
    if (!r) return undefined;
    if (typeof r.defaut === 'boolean') return typeof v === 'boolean' ? v : r.defaut;
    v = Number(v);
    if (!isFinite(v)) return r.defaut;
    v = Math.max(r.min, Math.min(r.max, v));
    // au pas du réglage, sans les résidus des flottants (0.30000000000000004)
    return Math.round(Math.round(v / r.pas) * r.pas * 1000) / 1000;
  }
  /* Nouvelle table de réglages avec `cle` = `v` (bornée). */
  function regler(opts, cle, v) {
    var o = copier(opts);
    if (REGLAGES[cle]) o[cle] = valeur(cle, v);
    return o;
  }
  function copier(opts) {
    var o = {};
    Object.keys(opts).forEach(function (k) { o[k] = opts[k]; });
    o.touches = {};
    Object.keys(opts.touches || {}).forEach(function (k) { o.touches[k] = opts.touches[k].slice(); });
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
      Object.keys(REGLAGES).forEach(function (k) { if (k in lu) o[k] = valeur(k, lu[k]); });
      if (lu.touches) ACTIONS.forEach(function (a) {
        var l = lu.touches[a.id];
        if (Array.isArray(l) && l.length && l.every(function (c) { return typeof c === 'string' && !RESERVEES[c]; })) o.touches[a.id] = l.slice();
      });
    } catch (e) { /* défauts */ }
    return o;
  }
  function sauver(stockage, opts) {
    try { if (stockage) stockage.setItem(CLE, JSON.stringify(opts)); return true; } catch (e) { return false; }
  }

  MC.Options = { REGLAGES: REGLAGES, ACTIONS: ACTIONS, RESERVEES: RESERVEES, defauts: defauts, valeur: valeur,
                 regler: regler, actionDe: actionDe, lier: lier, nomTouche: nomTouche, aide: aide,
                 charger: charger, sauver: sauver, CLE: CLE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
