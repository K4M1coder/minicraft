/* spec-journal-statique.js — MC.Journal vu depuis le disque (Node seulement,
   voir NODE_SEUL dans tests/fichiers-tests.js) :
   - SPEC-BANC-104 : src/journal.js se charge et se comporte pareil dans des
     globaux de navigateur, de worker, de vm Node et de server.js, et il est
     chargé EN PREMIER partout (jeu, banc, workers, serveur, tests Node) ;
   - SPEC-BANC-108 : chaque code d'erreur utilisé par le code figure dans
     docs/erreurs.md avec sa cause et sa conduite ;
   - SPEC-BANC-110 : la détection de la porte G16 (tools/console-directe.js)
     repère un console.* direct et le dépôt n'en contient aucun. */
(function (G) {
  'use strict';
  var T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path'), vm = require('vm');
  var RACINE = path.join(__dirname, '..');
  function lire(f) { return fs.readFileSync(path.join(RACINE, f), 'utf8'); }
  var CD = require(path.join(RACINE, 'tools', 'console-directe.js'));

  /* Évalue src/journal.js dans un global donné et y joue un même scénario. */
  function scenarioDans(globaux) {
    var appels = [];
    var c = {};
    ['log', 'info', 'warn', 'error', 'debug'].forEach(function (m) { c[m] = function (x) { appels.push(m + ':' + x); }; });
    var ctx = vm.createContext(Object.assign({ console: c, Math: Math, JSON: JSON, Date: Date, Error: Error, Object: Object, Array: Array, String: String }, globaux));
    if (!ctx.globalThis) ctx.globalThis = ctx;
    vm.runInContext(lire('src/journal.js'), ctx, { filename: 'journal.js' });
    var J = ctx.MC.Journal;
    J('RENDU').debug('d'); J('RENDU').warn('w'); J('SAVE').error('E-SAVE-002 e', { id: 1 }, new Error('x'));
    return { console: appels, tampon: J.tampon().map(function (e) { return [e.domaine, e.niveau, e.message, e.code]; }) };
  }
  function listeDe(texte, re) { var m = re.exec(texte); return m ? m[1].replace(/\s/g, '').split(',').map(function (s) { return s.replace(/['"]/g, '').replace(/^\.\.\/src\//, '').replace(/\.js$/, ''); }) : null; }

  describe('SPEC-BANC-104, 108, 110 — journal : environnements, codes d\'erreur, porte G16', {
    teste: 'Le chargement de src/journal.js dans les quatre environnements et en premier partout, le catalogue des codes d\'erreur docs/erreurs.md, et la détection des console.* directs de la porte G16.',
    pourquoi: 'Un module chargé après ceux qui journalisent, un code sans fiche ou un console.log oublié rendent le journal incomplet sans que rien ne rougisse.',
    attendu: 'même sortie observable dans chaque environnement, journal en tête de chaque liste de chargement, chaque code E-XXX-NNN documenté avec cause et conduite, aucun console.* direct hors src/journal.js.',
  }, function () {

    it('SPEC-BANC-104 : même comportement observable dans des globaux de navigateur, de worker, de vm Node et de server.js', function () {
      var nav = scenarioDans({ window: {}, document: {} });
      var worker = scenarioDans({ self: {}, importScripts: function () {} });
      var node = scenarioDans({});
      // server.js : le même contexte que le serveur (objet nu, globalThis posé à la main)
      var serveur = scenarioDans({ Number: Number, Boolean: Boolean, Map: Map, Set: Set, Uint8Array: Uint8Array, Float32Array: Float32Array, isNaN: isNaN, isFinite: isFinite, parseInt: parseInt, parseFloat: parseFloat });
      A.deep(nav.console, ['warn:[RENDU] w', 'error:[SAVE] E-SAVE-002 e'], 'mode jeu : warn et plus à la console');
      A.equal(nav.tampon.length, 3, 'le debug est dans le tampon');
      [worker, node, serveur].forEach(function (r, i) { A.deep(r, nav, 'environnement ' + ['worker', 'vm Node', 'server.js'][i] + ' identique au navigateur'); });
    });

    it('SPEC-BANC-104 : src/journal.js est chargé en premier par le jeu, le banc, les workers, le serveur et les tests Node', function () {
      var listes = {
        'index.html': listeDe(lire('index.html'), /var SRC = \[([\s\S]*?)\];/),
        'tests/index.html': listeDe(lire('tests/index.html'), /document\.write\(\[('\.\.\/src\/[\s\S]*?)\]/),
        'server.js': listeDe(lire('server.js'), /const MODULES = \[([\s\S]*?)\];/),
        'src/worker-monde.js': listeDe(lire('src/worker-monde.js'), /var MODULES = \[([\s\S]*?)\];/),
        'src/worker-maillage.js': listeDe(lire('src/worker-maillage.js'), /var MODULES = \[([\s\S]*?)\];/),
        'tests/sources-node.js': require(path.join(RACINE, 'tests', 'sources-node.js')),
      };
      Object.keys(listes).forEach(function (f) {
        A.ok(listes[f] && listes[f].length > 3, f + ' : liste de modules trouvée');
        A.equal(listes[f][0], 'journal', f + ' : journal en premier');
      });
    });

    it('SPEC-BANC-108 : chaque code d\'erreur utilisé par src/ et server.js figure dans docs/erreurs.md avec sa cause et sa conduite', function () {
      var doc = lire('docs/erreurs.md');
      var fiches = {};
      doc.split('\n').forEach(function (l) {
        var m = /^\|\s*(E-[A-Z]+-\d{3})\s*\|([^|]*)\|([^|]*)\|([^|]*)\|/.exec(l);
        if (m) fiches[m[1]] = { domaine: m[2].trim(), cause: m[3].trim(), conduite: m[4].trim() };
      });
      var utilises = {};
      CD.fichiersSurveilles(RACINE).concat(['src/journal.js']).forEach(function (f) {
        (lire(f).match(/\bE-[A-Z]+-\d{3}\b/g) || []).forEach(function (c) { (utilises[c] = utilises[c] || []).push(f); });
      });
      var codes = Object.keys(utilises);
      A.ok(codes.length >= 5, 'des codes sont utilisés : ' + codes.join(', '));
      codes.forEach(function (c) {
        A.ok(fiches[c], c + ' (utilisé dans ' + utilises[c].join(', ') + ') est recensé dans docs/erreurs.md');
        if (fiches[c]) A.ok(fiches[c].cause.length > 10 && fiches[c].conduite.length > 10, c + ' : cause et conduite renseignées');
      });
    });

    it('SPEC-BANC-110 : la détection G16 repère un console.* direct (pas un commentaire, pas l\'objet passé) ; src/ et server.js n\'en ont aucun', function () {
      A.equal(CD.appelsConsole('var a = 1;\nconsole.log("x");').length, 1, 'console.log');
      A.deep(CD.appelsConsole('  console . warn ( 1 )').map(function (a) { return a.ligne; }), [1], 'espaces');
      A.equal(CD.appelsConsole("console['error']('x')").length, 1, 'accès par crochets');
      A.equal(CD.appelsConsole('// console.log("x")\n/* console.error(1)\n */').length, 0, 'commentaires ignorés');
      A.equal(CD.appelsConsole('vm.createContext({ console, Math });').length, 0, 'objet passé, pas appelé');
      A.equal(CD.appelsConsole('var u = "http://x"; console.info(u);').length, 1, 'une URL ne masque pas la suite');
      A.equal(CD.fichiersSurveilles(RACINE).indexOf('src/journal.js'), -1, 'src/journal.js est le seul autorisé');
      A.ok(CD.fichiersSurveilles(RACINE).indexOf('server.js') >= 0, 'server.js est surveillé');
      A.deep(CD.verifier(RACINE), [], 'aucun console.* direct dans src/ et server.js');
      A.ok(/G16/.test(lire('tests/gates.js')) && /console-directe/.test(lire('tests/gates.js')), 'la porte G16 de tests/gates.js utilise cette détection');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
