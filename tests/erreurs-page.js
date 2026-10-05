/* erreurs-page.js — les erreurs que la console ne montre pas, captées par la
   PAGE avant que le moindre script du jeu ne s'exécute (SPEC-BANC-095, 098, 099,
   docs/banc/historique-global.md §3.13).

   Premier script de tests/index.html, avant three.js et les modules du jeu :
   une exception levée au chargement d'un module est déjà dans la file. Sans
   fenêtre, le même fichier est aussi installé par CDP
   (Page.addScriptToEvaluateOnNewDocument, tools/e2e-headless.js), doublé de
   Runtime.exceptionThrown côté Node (tools/diagnostics.js) : on ne dépend pas
   d'une seule voie.

   Ce qui est capté :
     - 'error' (phase de CAPTURE sur window, donc aussi les ressources qui ne
       chargent pas : <script>, <img>, <link>) ;
     - 'unhandledrejection' (promesses rejetées sans gestionnaire) ;
     - 'securitypolicyviolation' (CSP) ;
     - console.error et console.warn — c'est par là que three.js écrit les
       erreurs de compilation et de liaison des shaders (SPEC-BANC-098) ; les
       appels sont transmis tels quels à la vraie console.
   Chaque évènement entre dans une file bornée (MC_ERREURS_PAGE.depuis) et, dès
   que MC.Journal existe (`brancher`), dans le journal (domaine PAGE) : il y
   rejoint l'enregistreur de vol du test en cours. La perte et la restauration
   du contexte WebGL sont journalisées par le rendu lui-même (src/render.js). */
(function (G) {
  'use strict';
  if (G.MC_ERREURS_PAGE) return;
  var MAX = 500;
  var file = [], pont = null, dansPont = false;

  function court(x, n) { return String(x === undefined || x === null ? '' : x).slice(0, n || 2000); }
  function versJournal(e) {
    if (!pont || e.journalise) return;
    e.journalise = true;
    dansPont = true;                        // le journal peut écrire à la console : pas de boucle
    try {
      var log = pont('PAGE');
      (e.niveau === 'warn' ? log.warn : log.error)(e.message, { type: e.type, url: e.url || null, ligne: e.ligne || null }, e.pile || null);
    } catch (x) { /* un journal en panne ne doit jamais empêcher de capter */ } finally { dansPont = false; }
  }
  function enregistrer(e) {
    e.t = Date.now();
    file.push(e);
    if (file.length > MAX) file.shift();
    versJournal(e);
  }
  function propre(e) {
    var o = {};
    Object.keys(e).forEach(function (k) { if (k !== 'journalise') o[k] = e[k]; });
    return o;
  }

  // phase de CAPTURE : les erreurs de chargement de ressource ne remontent pas, elles ne se voient qu'ainsi
  G.addEventListener('error', function (ev) {
    var cible = ev.target;
    if (cible && cible !== G && cible.tagName) {
      var url = cible.src || cible.href || cible.currentSrc || '';
      enregistrer({ source: 'page', type: 'ressource', niveau: 'error', message: 'ressource non chargée : <' + String(cible.tagName).toLowerCase() + '> ' + court(url, 500), url: court(url, 500) });
      return;
    }
    enregistrer({
      source: 'page', type: 'exception_page', niveau: 'error',
      message: court(ev.message || (ev.error && ev.error.message) || 'erreur sans message', 1000),
      url: court(ev.filename, 500), ligne: ev.lineno || null, colonne: ev.colno || null,
      pile: ev.error && ev.error.stack ? court(ev.error.stack, 4000) : null,
    });
  }, true);

  G.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason;
    enregistrer({
      source: 'page', type: 'promesse_rejetee', niveau: 'error',
      message: court(r && r.message ? r.message : (typeof r === 'string' ? r : 'promesse rejetée'), 1000),
      pile: r && r.stack ? court(r.stack, 4000) : null,
    });
  }, true);

  G.addEventListener('securitypolicyviolation', function (ev) {
    enregistrer({ source: 'page', type: 'csp', niveau: 'warn', message: 'politique de sécurité : ' + court(ev.violatedDirective, 200) + ' a bloqué ' + court(ev.blockedURI, 300), url: court(ev.blockedURI, 300) });
  }, true);

  // console.error / console.warn : transmis à la vraie console, et notés
  ['error', 'warn'].forEach(function (m) {
    var c = G.console;
    if (!c || typeof c[m] !== 'function') return;
    var origine = c[m];
    c[m] = function () {
      if (!dansPont) {
        try {
          enregistrer({ source: 'console', type: 'console.' + m, niveau: m === 'warn' ? 'warn' : 'error',
            message: court(Array.prototype.map.call(arguments, function (a) { return a && a.message ? a.message : (typeof a === 'object' ? '[objet]' : String(a)); }).join(' '), 2000) });
        } catch (x) { /* rien */ }
      }
      return origine.apply(c, arguments);
    };
  });

  G.MC_ERREURS_PAGE = {
    MAX: MAX,
    /* Les évènements arrivés depuis `ms` (horodatage Date.now()), copies sans état interne. */
    depuis: function (ms) { return file.filter(function (e) { return e.t >= (ms || 0); }).map(propre); },
    toutes: function () { return file.map(propre); },
    vider: function () { file.length = 0; },
    /* Dès que MC.Journal est chargé : ce qui a été capté avant lui y est versé,
       la suite y va directement. */
    brancher: function (journal) {
      if (typeof journal !== 'function') return false;
      pont = journal;
      file.forEach(versJournal);
      return true;
    },
    get branche() { return !!pont; },
  };
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this));
