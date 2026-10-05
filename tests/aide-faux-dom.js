/* aide-faux-dom.js — faux DOM minimal et SYNCHRONE pour exécuter tests/historique.js
   sous Node (SPEC-BANC-063 à 065, 080 ; même modèle que tests/spec-historique.js,
   dont il reprend le faux DOM tel quel). `reponses(url)` rend le corps JSON de
   chaque requête fetch. Rend { H, obtenir, appels, ctx } ; `avant(ctx)` (facultatif)
   complète le contexte avant l'évaluation du script (ex. setInterval simulé). */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const URLSearchParams = require('url').URLSearchParams;
const RACINE = path.join(__dirname, '..');
function lire(rel) { return fs.readFileSync(path.join(RACINE, rel), 'utf8'); }
function fauxDom(reponses, opts) {
  function SyncP(ok, v) { this.ok = ok; this.v = v; }
  SyncP.prototype.then = function (f, r) {
    try {
      var x = this.ok ? (f ? f(this.v) : this.v) : (r ? r(this.v) : (function (v) { throw v; })(this.v));
      return x instanceof SyncP ? x : new SyncP(true, x);
    } catch (e) { return new SyncP(false, e); }
  };
  SyncP.prototype.catch = function (r) { return this.then(null, r); };
  var parId = {};
  function noeud(tag) {
    var n = { tagName: String(tag).toUpperCase(), children: [], attrs: {}, ecoute: {}, style: {}, hidden: false, className: '', value: '', checked: false, disabled: false, parent: null };
    Object.defineProperty(n, 'textContent', {
      get: function () { return n._texte !== undefined ? n._texte : n.children.map(function (c) { return c.textContent; }).join(' '); },
      set: function (v) { n.children = []; n._texte = String(v); },
    });
    Object.defineProperty(n, 'innerHTML', { set: function () { n.children = []; n._texte = undefined; }, get: function () { return ''; } });
    Object.defineProperty(n, 'firstChild', { get: function () { return n.children[0] || null; } });
    Object.defineProperty(n, 'selectedOptions', { get: function () { return n.children.filter(function (c) { return c.selected; }); } });
    n.appendChild = function (c) { c.parent = n; n._texte = undefined; n.children.push(c); return c; };
    n.removeChild = function (c) { n.children = n.children.filter(function (x) { return x !== c; }); };
    n.replaceChild = function (nv, ancien) { var i = n.children.indexOf(ancien); if (i >= 0) { n.children[i] = nv; nv.parent = n; } };
    n.replaceWith = function (nv) { if (n.parent) n.parent.replaceChild(nv, n); };
    n.setAttribute = function (k, v) { n.attrs[k] = String(v); if (k === 'id') parId[v] = n; };
    n.getAttribute = function (k) { return n.attrs.hasOwnProperty(k) ? n.attrs[k] : null; };
    n.addEventListener = function (t, f) { (n.ecoute[t] = n.ecoute[t] || []).push(f); };
    n.declencher = function (t, ev) { (n.ecoute[t] || []).forEach(function (f) { f(ev || { target: n, preventDefault: function () {}, stopPropagation: function () {} }); }); };
    n.click = function () { n.declencher('click'); };
    n.scrollIntoView = function () {};
    n.tous = function (pred) { var out = []; (function v(x) { x.children.forEach(function (c) { if (c.children) { if (pred(c)) out.push(c); v(c); } }); })(n); return out; };
    n.querySelector = function (sel) { return n.querySelectorAll(sel)[0] || null; };
    n.querySelectorAll = function (sel) {
      if (sel === '#hist-table tbody') return [parId['__tbody']];
      if (sel === '#hist-table thead') return [parId['__thead']];
      if (sel.charAt(0) === '#') return [obtenir(sel.slice(1))];
      if (sel === '[data-rapide]') return ['tous', 'echecs', 'lents'].map(function (r) { return obtenir('__rapide-' + r); });
      if (sel === 'tr.hist-filtres') return n.tous(function (c) { return c.tagName === 'TR' && /hist-filtres/.test(c.className); });
      if (sel === 'select[data-col]') return n.tous(function (c) { return c.tagName === 'SELECT' && c.attrs['data-col']; });
      return [];
    };
    return n;
  }
  function obtenir(id) {
    if (!parId[id]) {
      var n = noeud('div'); parId[id] = n;
      if (id.indexOf('__rapide-') === 0) n.attrs['data-rapide'] = id.slice(9);
    }
    return parId[id];
  }
  obtenir('__thead'); obtenir('__tbody');
  obtenir('zone-historique').hidden = true;
  obtenir('hist-panneau-test').hidden = true;
  var appels = [];
  var document = {
    readyState: 'complete', body: noeud('body'),
    getElementById: obtenir,
    createElement: noeud,
    createTextNode: function (t) { return { textContent: String(t) }; },
    addEventListener: function () {}, dispatchEvent: function () {},
  };
  var ctx = vm.createContext({
    document: document, console: console, JSON: JSON, Math: Math, Date: Date, Object: Object, Array: Array, String: String,
    Number: Number, Error: Error, isFinite: isFinite, parseInt: parseInt, parseFloat: parseFloat, encodeURIComponent: encodeURIComponent,
    URLSearchParams: URLSearchParams, setTimeout: function () { return 0; }, clearTimeout: function () {},
    CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
    localStorage: { getItem: function () { return null; }, setItem: function () {} },
    fetch: function (url) {
      appels.push(url);
      var corps = reponses(url);
      return new SyncP(true, { ok: true, status: 200, text: function () { return new SyncP(true, JSON.stringify(corps)); } });
    },
  });
  ctx.window = ctx;
  if (opts && opts.avant) opts.avant(ctx);
  vm.runInContext(lire('tests/historique.js'), ctx, { filename: 'historique.js' });
  return { H: ctx.MC_HISTORIQUE, obtenir: obtenir, appels: appels, ctx: ctx };
}
module.exports = { fauxDom, lire };
