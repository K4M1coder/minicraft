/* harness.js — micro-framework de test, sans dépendance, utilisable sous Node
   comme dans le navigateur. Volontairement minimal : des assertions explicites
   qui disent ce qui était attendu et ce qui a été obtenu. */
(function (G) {
  'use strict';
  var T = G.T = {
    suites: [], current: null, passed: 0, failed: 0, failures: [], only: null,
  };

  function describe(name, fn) {
    var suite = { name: name, tests: [] };
    T.suites.push(suite);
    var prev = T.current;
    T.current = suite;
    fn();
    T.current = prev;
  }

  function it(name, fn) {
    if (!T.current) throw new Error('it() hors de describe(): ' + name);
    T.current.tests.push({ name: name, fn: fn });
  }

  function fail(msg) { var e = new Error(msg); e.isAssertion = true; throw e; }

  function fmt(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(4);
    if (Array.isArray(v)) return '[' + v.map(fmt).join(', ') + ']';
    if (v && typeof v === 'object') {
      try { return JSON.stringify(v); } catch (e) { return String(v); }
    }
    return String(v);
  }

  var assert = {
    ok: function (v, msg) { if (!v) fail((msg || 'attendu vrai') + ' — obtenu ' + fmt(v)); },
    notOk: function (v, msg) { if (v) fail((msg || 'attendu faux') + ' — obtenu ' + fmt(v)); },
    equal: function (a, b, msg) {
      if (a !== b) fail((msg || 'égalité') + ' — attendu ' + fmt(b) + ', obtenu ' + fmt(a));
    },
    notEqual: function (a, b, msg) {
      if (a === b) fail((msg || 'différence') + ' — les deux valent ' + fmt(a));
    },
    close: function (a, b, eps, msg) {
      var e = eps === undefined ? 1e-6 : eps;
      if (!(Math.abs(a - b) <= e))
        fail((msg || 'proximité') + ' — attendu ' + fmt(b) + ' ±' + e + ', obtenu ' + fmt(a));
    },
    deep: function (a, b, msg) {
      var sa = JSON.stringify(a), sb = JSON.stringify(b);
      if (sa !== sb) fail((msg || 'structures égales') + ' — attendu ' + sb + ', obtenu ' + sa);
    },
    /* gt/lt existent aussi dans le harnais end-to-end : sans eux ici, une
       assertion écrite par réflexe lève une TypeError qui se lit comme un
       échec de test et fait chercher un bug là où il n'y en a pas. */
    gt: function (a, b, msg) {
      if (!(a > b)) fail((msg || 'supérieur') + ' — ' + fmt(a) + ' <= ' + fmt(b));
    },
    lt: function (a, b, msg) {
      if (!(a < b)) fail((msg || 'inférieur') + ' — ' + fmt(a) + ' >= ' + fmt(b));
    },
    between: function (v, lo, hi, msg) {
      if (!(v >= lo && v <= hi))
        fail((msg || 'dans l\'intervalle') + ' — attendu [' + lo + ', ' + hi + '], obtenu ' + fmt(v));
    },
    throws: function (fn, msg) {
      var threw = false;
      try { fn(); } catch (e) { threw = true; }
      if (!threw) fail((msg || 'devait lever une erreur') + ' — rien levé');
    },
  };

  function run(filter) {
    T.passed = 0; T.failed = 0; T.failures = [];
    var out = [];
    for (var i = 0; i < T.suites.length; i++) {
      var s = T.suites[i];
      if (filter && s.name.indexOf(filter) < 0) continue;
      var sp = 0, sf = 0, lines = [];
      for (var j = 0; j < s.tests.length; j++) {
        var t = s.tests[j];
        try {
          t.fn();
          T.passed++; sp++;
          lines.push({ ok: true, name: t.name });
        } catch (e) {
          T.failed++; sf++;
          var msg = e && e.message ? e.message : String(e);
          if (!e.isAssertion && e.stack) msg += '\n      ' + e.stack.split('\n')[1].trim();
          T.failures.push({ suite: s.name, test: t.name, message: msg });
          lines.push({ ok: false, name: t.name, message: msg });
        }
      }
      out.push({ name: s.name, passed: sp, failed: sf, lines: lines });
    }
    return { suites: out, passed: T.passed, failed: T.failed, failures: T.failures };
  }

  T.describe = describe; T.it = it; T.assert = assert; T.run = run; T.fmt = fmt;
  G.describe = describe; G.it = it; G.assert = assert;
})(typeof globalThis !== 'undefined' ? globalThis : this);
