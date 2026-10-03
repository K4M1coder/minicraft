/* harness.js — micro-framework de test, sans dépendance, utilisable sous Node
   comme dans le navigateur. Volontairement minimal : des assertions explicites
   qui disent ce qui était attendu et ce qui a été obtenu.

   Étendu pour l'outillage de test (L42, SPEC-BANC-*) :
   - `it(nom, fn)` reste valable ; `it(nom, fiche, fn)` déclare en plus une
     fiche `{ teste, pourquoi, attendu, etiquettes? }` (SPEC-BANC-002) ;
   - `describe(nom, fn)` reste valable ; `describe(nom, fiche, fn)` déclare une
     fiche de GROUPE, reprise par chaque test du groupe qui n'a pas la sienne —
     c'est ce qui couvre les ~950 tests existants sans les réécrire un à un ;
   - `T.fichierCourant` (à poser par le chargeur, Node ou navigateur, avant
     d'évaluer chaque fichier de tests) est mémorisé sur chaque suite : c'est
     ce qui permet à tests/catalogue.js de déduire le TYPE d'un test de son
     fichier, sans avoir à le lui redire ;
   - dans un test, `T.etape(libellé, n?, total?)` signale une étape en cours :
     transmise en direct à `suivi.etape(groupe, nom, libellé, n, total)`, et
     sert aussi de point de coopération pour le délai par test (SPEC-BANC-010,
     volet Node) — voir plus bas ;
   - chaque test compte ses assertions (réussies/échouées) dans `assertions`,
     et un échec porte, en plus du message, `attendu`/`obtenu` séparément :
     resultats.json (SPEC-BANC-013, SPEC-BANC-014) s'en sert tel quel ;
   - `T.run(filtre, suivi, options)` : `filtre` reste un texte (sous-chaîne du
     nom de groupe ou de test), mais accepte aussi une fonction
     `(test, groupe) => bool` ou un tableau de noms/identifiants exacts —
     c'est ce dont tests/run.js a besoin pour exécuter une SÉLECTION construite
     par tests/catalogue.js plutôt qu'un simple filtre textuel. */
(function (G) {
  'use strict';
  var T = G.T = {
    suites: [], current: null, passed: 0, failed: 0, failures: [], only: null,
    fichierCourant: null,
  };
  /* Journal (SPEC-BANC-105/106) : chargé APRÈS ce fichier, src/journal.js lit
     ce mode — console muette, niveau trace produit (enregistreur de vol). */
  G.MC_JOURNAL_MODE = 'test';
  function journalDuTest() { return G.MC && typeof G.MC.Journal === 'function' ? G.MC.Journal : null; }

  function normaliserFiche(f) {
    if (!f || typeof f !== 'object') return null;
    return {
      teste: f.teste || '', pourquoi: f.pourquoi || '', attendu: f.attendu || '',
      etiquettes: f.etiquettes || [],
      // SPEC-BANC-062 : `fonctions` DÉCLARÉES (la cible du test), fusionnées
      // à l'affichage avec les fonctions OBSERVÉES par tests/run.js — voir
      // son en-tête. Absent de la fiche : liste vide, jamais `undefined`
      // (un consommateur peut toujours faire `.concat()` sans vérifier).
      fonctions: f.fonctions || [],
      // SPEC-BANC-066 : domaine(s) DÉCLARÉ(S), pour un test honnête qui n'a
      // ni fonction observable (données pures, sans accesseur) ni SPEC-*
      // dans son nom — fusionné aux domaines déduits des specs citées
      // (tests/catalogue.js), jamais un remplacement.
      domaines: f.domaines || [],
    };
  }

  function describe(name, ficheOuFn, peutEtreFn) {
    var fiche = typeof ficheOuFn === 'function' ? null : normaliserFiche(ficheOuFn);
    var fn = typeof ficheOuFn === 'function' ? ficheOuFn : peutEtreFn;
    var suite = { name: name, tests: [], fiche: fiche, fichier: T.fichierCourant };
    T.suites.push(suite);
    var prev = T.current;
    T.current = suite;
    fn();
    T.current = prev;
  }

  function it(name, ficheOuFn, peutEtreFn) {
    if (!T.current) throw new Error('it() hors de describe(): ' + name);
    var fiche = typeof ficheOuFn === 'function' ? null : normaliserFiche(ficheOuFn);
    var fn = typeof ficheOuFn === 'function' ? ficheOuFn : peutEtreFn;
    T.current.tests.push({ name: name, fn: fn, fiche: fiche });
  }

  function fail(msg, details) {
    var e = new Error(msg);
    e.isAssertion = true;
    if (details) { e.attendu = details.attendu; e.obtenu = details.obtenu; }
    throw e;
  }

  function fmt(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(4);
    if (Array.isArray(v)) return '[' + v.map(fmt).join(', ') + ']';
    if (v && typeof v === 'object') {
      try { return JSON.stringify(v); } catch (e) { return String(v); }
    }
    return String(v);
  }

  /* État de l'assertion en cours (compte ok/ko du test en train de tourner) :
     `run()` le pose avant chaque test et le lit après. Une pile plutôt qu'une
     simple variable au cas où une assertion en déclenche indirectement une
     autre (aucun cas connu aujourd'hui, mais ça ne coûte rien). */
  var pileAssertions = [];
  function compter(ok) {
    var c = pileAssertions[pileAssertions.length - 1];
    if (!c) return;
    if (ok) c.ok++; else c.ko++;
  }
  /* Enveloppe une assertion : compte le coup, et sur échec attache
     attendu/obtenu à l'erreur en plus du message — c'est ce que
     SPEC-BANC-013 affiche séparément du texte. */
  function verifie(fn, extraireDetails) {
    return function () {
      var args = arguments;
      try {
        fn.apply(null, args);
        compter(true);
      } catch (e) {
        compter(false);
        if (e.isAssertion && extraireDetails && e.attendu === undefined && e.obtenu === undefined) {
          var d = extraireDetails.apply(null, args);
          if (d) { e.attendu = d.attendu; e.obtenu = d.obtenu; }
        }
        throw e;
      }
    };
  }

  var assertBrut = {
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
        fail((msg || 'dans l\'intervalle') + ' — attendu [' + lo + ', ' + hi + ']' + ', obtenu ' + fmt(v));
    },
    throws: function (fn, msg) {
      var threw = false;
      try { fn(); } catch (e) { threw = true; }
      if (!threw) fail((msg || 'devait lever une erreur') + ' — rien levé');
    },
  };

  var EXTRACTEURS = {
    ok: function (v) { return { attendu: true, obtenu: v }; },
    notOk: function (v) { return { attendu: false, obtenu: v }; },
    equal: function (a, b) { return { attendu: b, obtenu: a }; },
    notEqual: function (a) { return { attendu: '(différent de ' + fmt(a) + ')', obtenu: a }; },
    close: function (a, b) { return { attendu: b, obtenu: a }; },
    deep: function (a, b) { return { attendu: b, obtenu: a }; },
    gt: function (a, b) { return { attendu: '> ' + fmt(b), obtenu: a }; },
    lt: function (a, b) { return { attendu: '< ' + fmt(b), obtenu: a }; },
    between: function (v, lo, hi) { return { attendu: '[' + fmt(lo) + ', ' + fmt(hi) + ']', obtenu: v }; },
    throws: function () { return null; },
  };

  var assert = {};
  Object.keys(assertBrut).forEach(function (nom) {
    assert[nom] = verifie(assertBrut[nom], EXTRACTEURS[nom]);
  });

  /* Étape en cours d'un test (SPEC-BANC-009 côté Node, SPEC-BANC-010) :
     `T.etape(libellé, n, total)` l'enregistre, la transmet au suivi en
     temps réel, et sert de point de coopération pour le délai par test —
     les tests sont synchrones (voir tests/run.js) : sans un point où le
     reprendre la main, aucun minuteur ne peut interrompre un test bloqué.
     Un test qui appelle régulièrement etape() PEUT donc être coupé à son
     délai ; un test qui ne l'appelle jamais ne le peut pas — c'est une
     limite assumée et documentée, pas un oubli. */
  var enCours = null;
  function etape(libelle, n, total) {
    if (!enCours) return;
    var t = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    enCours.etapes.push({ libelle: libelle, t_ms: Math.round(t - enCours.debut), n: n, total: total });
    if (enCours.suivi && enCours.suivi.etape) {
      enCours.suivi.etape(enCours.groupe, enCours.nom, libelle, n, total);
    }
    if (enCours.limiteMs && (t - enCours.debut) > enCours.limiteMs) {
      var e = new Error('délai dépassé (' + Math.round(enCours.limiteMs) + ' ms) — à l\'étape : ' + libelle);
      e.isDelai = true; e.etapeCourante = libelle;
      throw e;
    }
  }

  /* `filtre` :
       - texte : sous-chaîne du nom de groupe, ou à défaut du nom de test
         (comportement historique) ;
       - fonction (test, groupeNom) => bool ;
       - tableau : noms ou identifiants (SPEC-xxx-nnn en tête du nom) exacts.
     `suivi` (facultatif) : { debutGroupe(nom, n), debutTest(groupe, nom),
     etape(groupe, nom, libellé, n, total), finTest(groupe, nom, ok, ms, info),
     finGroupe(nom, passes, echecs, ms) }.
     `options.delaiMs` : délai coopératif par test (voir etape() ci-dessus). */
  function idDe(nom) {
    var m = /^(SPEC-[A-Z0-9]+-\d+)/.exec(nom);
    return m ? m[1] : null;
  }
  function construireFiltre(filtre) {
    if (!filtre) return null;
    if (typeof filtre === 'function') return { groupe: null, test: filtre };
    if (Array.isArray(filtre)) {
      var set = new Set(filtre);
      return { groupe: null, test: function (t) { return set.has(t.name) || (idDe(t.name) && set.has(idDe(t.name))); } };
    }
    return { groupe: function (nomGroupe) { return nomGroupe.indexOf(filtre) >= 0; }, test: function (t) { return t.name.indexOf(filtre) >= 0; } };
  }

  function run(filtre, suivi, options) {
    T.passed = 0; T.failed = 0; T.failures = [];
    var opts = options || {};
    var out = [];
    var f = construireFiltre(filtre);
    var maintenant = function () { return typeof performance !== 'undefined' ? performance.now() : Date.now(); };
    for (var i = 0; i < T.suites.length; i++) {
      var s = T.suites[i];
      var groupeRetenu = !f || (f.groupe ? f.groupe(s.name) : false);
      var tests = groupeRetenu ? s.tests : (f ? s.tests.filter(function (t) { return f.test(t, s.name); }) : s.tests);
      if (!tests.length) continue;
      var sp = 0, sf = 0, lines = [], t0g = maintenant();
      if (suivi && suivi.debutGroupe) suivi.debutGroupe(s.name, tests.length);
      for (var j = 0; j < tests.length; j++) {
        var t = tests[j], t0 = maintenant(), debutISO = new Date().toISOString(), ok = true, info = null;
        if (suivi && suivi.debutTest) suivi.debutTest(s.name, t.name);
        var contexte = { groupe: s.name, nom: t.name, debut: t0, etapes: [], suivi: suivi, limiteMs: opts.delaiMs || 0, assertions: { ok: 0, ko: 0 } };
        pileAssertions.push(contexte.assertions);
        enCours = contexte;
        /* SPEC-BANC-105 : le test en cours entre dans le contexte de chaque
           entrée du journal ; SPEC-BANC-106 : sortie « rapport de test » —
           les entrées warn et plus de CE test, jointes à son résultat. */
        var J = journalDuTest(), collecte = null;
        if (J) {
          J.contexte({ test: idDe(t.name) || t.name });
          collecte = J.sortieCollecte('rapport', 'warn');
          J.ajouterSortie(collecte);
        }
        try {
          var retour = t.fn();
          /* Garde anti-faux-positif (SPEC-BANC-013) : `T.run` est SYNCHRONE —
             une fonction de test qui REND une Promise (ou tout thenable) est
             comptée réussie ici avant que quoi que ce soit n'ait été vérifié ;
             une assertion qui échouerait plus tard, dans un .then(), ne
             serait alors JAMAIS rapportée. On refuse explicitement ce cas
             plutôt que de laisser passer un test qui n'a rien prouvé — voir
             tests/integration-*.js pour les tests qui ont réellement besoin
             d'async/await. */
          if (retour && (typeof retour === 'object' || typeof retour === 'function') && typeof retour.then === 'function') {
            fail('test asynchrone non supporté sous le harness synchrone : déplacer dans tests/integration-*.js');
          }
          T.passed++; sp++;
          lines.push({ ok: true, name: t.name, etapes: contexte.etapes, assertions: contexte.assertions });
        } catch (e) {
          T.failed++; sf++;
          var msg = e && e.message ? e.message : String(e);
          if (!e.isAssertion && e.stack) msg += '\n      ' + e.stack.split('\n')[1].trim();
          info = { message: msg, attendu: e && e.attendu, obtenu: e && e.obtenu, pile: e && e.stack, delai: !!(e && e.isDelai) };
          T.failures.push({ suite: s.name, test: t.name, message: msg });
          lines.push({ ok: false, name: t.name, message: msg, etapes: contexte.etapes, assertions: contexte.assertions, info: info });
          ok = false;
        } finally {
          enCours = null;
          pileAssertions.pop();
          if (J) { J.retirerSortie('rapport'); J.contexte({ test: null }); }
        }
        var journalTest = collecte && collecte.entrees.length ? collecte.lignes() : null;
        /* `detail`, toujours fourni (succès compris) : c'est ce dont
           tests/run.js a besoin pour construire une entrée resultats.json
           complète au fil de l'eau (SPEC-BANC-014), sans devoir attendre la
           fin de tout le groupe. */
        if (suivi && suivi.finTest) {
          var detail = { etapes: contexte.etapes, assertions: contexte.assertions,
            message: info && info.message, attendu: info && info.attendu, obtenu: info && info.obtenu,
            pile: info && info.pile, delai: !!(info && info.delai), debut: debutISO, journal: journalTest };
          suivi.finTest(s.name, t.name, ok, maintenant() - t0, detail);
        }
      }
      if (suivi && suivi.finGroupe) suivi.finGroupe(s.name, sp, sf, maintenant() - t0g);
      out.push({ name: s.name, passed: sp, failed: sf, lines: lines });
    }
    return { suites: out, passed: T.passed, failed: T.failed, failures: T.failures };
  }

  T.describe = describe; T.it = it; T.assert = assert; T.run = run; T.fmt = fmt; T.etape = etape;
  G.describe = describe; G.it = it; G.assert = assert;
})(typeof globalThis !== 'undefined' ? globalThis : this);
