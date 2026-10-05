/* spec-banc-diagnostics.js — diagnostics joints aux échecs et aux lenteurs
   (SPEC-BANC-092 à 103, docs/banc/historique-global.md §3.13). Fichier Node
   seulement : il charge le harnais dans un contexte isolé, écrit des cahiers
   dans des dossiers temporaires et lit le disque. La part qui exige un VRAI
   navigateur ou un VRAI serveur est dans tests/integration-banc-diagnostics.js
   (CDP, workers, réseau, profils) et tests/e2e-banc.js (la page du banc). */
(function (G) {
  'use strict';
  var T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
  var RACINE = path.join(__dirname, '..');
  var DIAG = require(path.join(RACINE, 'tools', 'diagnostics.js'));
  var RT = require(path.join(RACINE, 'tools', 'resultats-tests.js'));
  function lire(f) { return fs.readFileSync(path.join(RACINE, f), 'utf8'); }

  /* Le harnais et le journal dans un contexte isolé : on y décrit des tests
     et on les fait tourner, comme le fait tests/run.js. La console y est un
     espion (en mode test, le journal ne doit rien lui écrire). */
  function banc(corps, options) {
    var consoleVue = [];
    var ctx = vm.createContext({
      console: { log: function (x) { consoleVue.push(x); }, warn: function (x) { consoleVue.push(x); }, error: function (x) { consoleVue.push(x); }, info: function (x) { consoleVue.push(x); }, debug: function (x) { consoleVue.push(x); } },
      Math: Math, JSON: JSON, Date: Date, Error: Error, Object: Object, Array: Array, String: String, Number: Number, Promise: Promise,
      performance: { now: function () { return Date.now(); } },
    });
    ctx.globalThis = ctx;
    vm.runInContext(lire('tests/harness.js'), ctx, { filename: 'harness.js' });
    vm.runInContext(lire('src/journal.js'), ctx, { filename: 'journal.js' });
    ctx.__corps = corps;
    vm.runInContext('__corps(globalThis);', ctx);
    var details = {};
    ctx.__suivi = { finTest: function (g, n, ok, ms, d) { details[n] = { ok: ok, ms: ms, d: d }; } };
    ctx.__opts = options || {};
    vm.runInContext('T.run(null, __suivi, __opts);', ctx);
    return { details: details, consoleVue: consoleVue, ctx: ctx };
  }
  function attendre(ms) { var t = Date.now(); while (Date.now() - t < ms) { /* test volontairement lent */ } }

  describe('Specs — diagnostics : joints seulement à l\'échec ou à la lenteur (SPEC-BANC-092)', function () {
    function testComplet(o) {
      return Object.assign({
        id: 'N-1', nom: 'un test', type: 'e2e', etat: 'ok', duree_ms: 100,
        metriques: { images: 120, fps_moy: 58, ms_image: 17 },
        journal: ['12:00:00.000 WARN JEU un avertissement'], vol: ['12:00:00.000 TRACE JEU détail'], volPerdues: 0,
        instantane: { graine: 1 }, erreursCachees: [{ source: 'navigateur', type: 'exception', message: 'x' }],
        longtasks: [{ debut_ms: 5, duree_ms: 80 }], histogrammeImages: { '16': 10 },
        profilCPU: { fichier: 'profils/a.cpuprofile' }, profilGPU: { couches: {} }, trace: { fichier: 'profils/t.json' },
        reseau: { messages: [] }, serveur: { journal: ['ligne'] },
      }, o || {});
    }

    it('SPEC-BANC-092 : un test réussi sans être lent ne porte ni journal, ni vol, ni instantané, ni profil — seulement ses métriques', function () {
      var t = testComplet();
      var retires = DIAG.appliquerPolitique(t, 20000);
      DIAG.CLES_DIAGNOSTICS.forEach(function (k) { A.equal(t[k], undefined, 'retiré : ' + k); });
      A.ok(retires.indexOf('vol') >= 0 && retires.indexOf('instantane') >= 0 && retires.indexOf('profilCPU') >= 0, 'les retraits sont rendus');
      A.deep(t.metriques, { images: 120, fps_moy: 58, ms_image: 17 }, 'les métriques restent');
      A.equal(t.diagnostic_pour, undefined, 'rien n\'a déclenché');
    });

    it('SPEC-BANC-092 : un test en échec ou lent garde ses diagnostics et dit ce qui les a déclenchés', function () {
      var echec = testComplet({ etat: 'echec' });
      DIAG.appliquerPolitique(echec, 20000);
      A.ok(echec.vol && echec.instantane && echec.profilCPU && echec.reseau && echec.serveur, 'échec : tout est gardé');
      A.equal(echec.diagnostic_pour, 'echec');
      var delai = testComplet({ etat: 'delai' });
      DIAG.appliquerPolitique(delai, 20000);
      A.equal(delai.diagnostic_pour, 'echec', 'un délai dépassé est un échec');
      var lent = testComplet({ duree_ms: 25000 });
      DIAG.appliquerPolitique(lent, 20000);
      A.ok(lent.vol && lent.profilCPU, 'lent : gardé');
      A.equal(lent.diagnostic_pour, 'lent');
      var les2 = testComplet({ etat: 'echec', duree_ms: 25000 });
      DIAG.appliquerPolitique(les2, 20000);
      A.equal(les2.diagnostic_pour, 'echec+lent');
      var ignore = testComplet({ etat: 'ignore' });
      DIAG.appliquerPolitique(ignore, 20000);
      A.equal(ignore.vol, undefined, 'un test ignoré n\'est ni en échec ni lent');
      A.equal(DIAG.declencheur(testComplet({ duree_ms: 20000 }), 20000), null, 'exactement le seuil n\'est pas lent');
      A.equal(DIAG.declencheur(testComplet({ duree_ms: 30000 }), 0), null, 'sans seuil, jamais lent');
    });

    it('SPEC-BANC-092 : le cahier écrit applique la règle à tous les tests, quel que soit le chemin qui les a produits', function () {
      var base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-diag-cahier-'));
      try {
        var resultats = { schema: 1, campagne: { preset: 'essai', seuilLentMs: 5000, totaux: { total: 3, passes: 2, echecs: 1 } }, tests: [
          testComplet({ nom: 'réussi rapide', duree_ms: 100 }),
          testComplet({ nom: 'en échec', etat: 'echec', duree_ms: 100 }),
          testComplet({ nom: 'réussi mais lent', duree_ms: 9000 }),
        ] };
        var r = RT.ecrireCahier(resultats, { racine: base });
        var j = JSON.parse(fs.readFileSync(path.join(r.dossierAbsolu, 'resultats.json'), 'utf8'));
        var par = {}; j.tests.forEach(function (t) { par[t.nom] = t; });
        A.equal(par['réussi rapide'].vol, undefined, 'réussi rapide : aucun vol');
        A.equal(par['réussi rapide'].instantane, undefined, 'réussi rapide : aucun instantané');
        A.equal(par['réussi rapide'].profilCPU, undefined, 'réussi rapide : aucun profil');
        A.equal(par['réussi rapide'].metriques.images, 120, 'réussi rapide : ses métriques');
        A.ok(par['en échec'].vol && par['en échec'].instantane, 'en échec : diagnostics joints');
        A.ok(par['réussi mais lent'].vol && par['réussi mais lent'].diagnostic_pour === 'lent', 'lent : diagnostics joints');
        var html = fs.readFileSync(path.join(r.dossierAbsolu, 'rapport.html'), 'utf8');
        A.ok(/enregistreur de vol/.test(html) && /instantané de l&#39;état du jeu/.test(html), 'le rapport HTML les montre pour le test qui les porte');
        var avantEchec = html.indexOf('en échec'), apresReussi = html.indexOf('réussi rapide');
        A.ok(avantEchec >= 0 && apresReussi >= 0, 'les deux tests sont dans le rapport');
        // le test réussi rapide n'a pas de bloc de diagnostics (l'échec figure aussi dans la section « Échecs »)
        var debut = html.indexOf('réussi rapide'), fin = html.indexOf('<h4', debut + 10);
        A.notOk(/diagnostics joints/.test(html.slice(debut, fin < 0 ? html.length : fin)), 'aucun diagnostic pour le test réussi rapide');
        A.equal((html.match(/diagnostics joints/g) || []).length, 3, 'l\'échec (listé deux fois) et le lent affichent leurs diagnostics');
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    });

    it('SPEC-BANC-092 : un envoi HTTP ne peut jamais faire copier un fichier du poste (pièces refusées hors du dossier de diagnostics)', function () {
      var base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-diag-pieces-'));
      var secret = path.join(base, 'secret.txt');
      fs.writeFileSync(secret, 'mot de passe');
      try {
        var resultats = { schema: 1, campagne: { preset: 'essai' }, tests: [testComplet({ etat: 'echec', profilCPU: { source: secret, echantillons: 3 } })] };
        var r = RT.ecrireCahier(resultats, { racine: base, sansPieces: true });
        var j = JSON.parse(fs.readFileSync(path.join(r.dossierAbsolu, 'resultats.json'), 'utf8'));
        A.equal(j.tests[0].profilCPU.source, undefined, 'le chemin n\'est pas conservé');
        A.equal(j.tests[0].profilCPU.fichier, undefined, 'aucun fichier copié');
        A.notOk(fs.existsSync(path.join(r.dossierAbsolu, 'profils')), 'pas de dossier de profils');
        // même avec les pièces autorisées, un fichier hors du dossier de diagnostics est refusé
        var r2 = RT.ecrireCahier(resultats, { racine: base });
        var j2 = JSON.parse(fs.readFileSync(path.join(r2.dossierAbsolu, 'resultats.json'), 'utf8'));
        A.equal(j2.tests[0].profilCPU.fichier, undefined, 'hors du dossier de diagnostics : refusé');
        A.ok(fs.existsSync(secret), 'et le fichier d\'origine est intact');
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    });

    it('SPEC-BANC-092 : le harnais ne joint le journal du test qu\'à un échec ou à une lenteur', function () {
      var b = banc(function (g) {
        g.describe('G', function () {
          g.it('SPEC-BANC-092 : réussi, avec un avertissement', function () { g.MC.Journal('JEU').warn('avertissement discret'); });
          g.it('SPEC-BANC-092 : en échec, avec un avertissement', function () { g.MC.Journal('JEU').warn('avertissement avant la panne'); g.assert.equal(1, 2, 'panne'); });
        });
      }, { seuilLentMs: 5000 });
      A.equal(b.details['SPEC-BANC-092 : réussi, avec un avertissement'].d.journal, null, 'réussi : pas de journal joint');
      var echec = b.details['SPEC-BANC-092 : en échec, avec un avertissement'].d;
      A.ok(echec.journal && echec.journal.length === 1 && /avertissement avant la panne/.test(echec.journal[0]), 'échec : le journal est joint');
    });
  });

  describe('Specs — diagnostics : l\'enregistreur de vol (SPEC-BANC-093)', function () {
    it('SPEC-BANC-093 : sortieAnneau() est un tampon circulaire borné — il garde la FIN, et compte ce qu\'il a perdu', function () {
      var ctx = vm.createContext({ console: { log: function () {}, warn: function () {}, error: function () {}, info: function () {}, debug: function () {} }, Math: Math, JSON: JSON, Date: Date, Error: Error, Object: Object, Array: Array, String: String });
      ctx.globalThis = ctx;
      vm.runInContext(lire('src/journal.js'), ctx, { filename: 'journal.js' });
      var J = ctx.MC.Journal.creer({ mode: 'test' });
      var vol = J.sortieAnneau('vol', 'trace', 3);
      J.ajouterSortie(vol);
      A.equal(vol.capacite, 3);
      for (var i = 1; i <= 5; i++) J('RENDU').trace('entrée ' + i);
      A.deep(vol.entrees.map(function (e) { return e.message; }), ['entrée 3', 'entrée 4', 'entrée 5'], 'les trois dernières, dans l\'ordre');
      A.equal(vol.perdues, 2, 'deux plus anciennes perdues');
      A.equal(vol.lignes().length, 3);
      A.ok(/TRACE RENDU entrée 5/.test(vol.lignes()[2]), 'lignes formatées comme le reste du journal');
      vol.vider();
      A.equal(vol.entrees.length, 0);
      A.equal(vol.perdues, 0);
      var tout = J.sortieAnneau('autre', 'warn', 10);
      J.ajouterSortie(tout);
      J('X').trace('ignoré'); J('X').error('retenu');
      A.deep(tout.entrees.map(function (e) { return e.message; }), ['retenu'], 'le seuil de la sortie s\'applique');
      A.equal(J.sortieAnneau('v', 'inconnu', 0).capacite, 1, 'capacité minimale de 1');
    });

    it('SPEC-BANC-093 : un test qui échoue joint le contenu du tampon, y compris trace et debug jamais écrits à la console ; un test qui réussit ne le joint pas', function () {
      var b = banc(function (g) {
        g.describe('G', function () {
          g.it('réussi', function () { g.MC.Journal('RENDU').trace('trace d\'un test réussi'); g.assert.ok(true); });
          g.it('échoue', function () {
            g.MC.Journal('RENDU').trace('étape 1 : trace invisible');
            g.MC.Journal('SYNC').debug('étape 2 : debug invisible', { n: 2 });
            g.MC.Journal('SYNC').info('étape 3 : info');
            g.assert.equal(1, 2, 'la panne');
          });
        });
      }, { seuilLentMs: 5000 });
      var ok = b.details['réussi'].d, ko = b.details['échoue'].d;
      A.equal(ok.vol, null, 'réussi non lent : le tampon est jeté');
      A.ok(ko.vol && ko.vol.length === 3, 'échec : trois entrées dans le vol (' + (ko.vol && ko.vol.length) + ')');
      A.ok(/TRACE RENDU étape 1/.test(ko.vol[0]) && /DEBUG SYNC étape 2/.test(ko.vol[1]) && /INFO SYNC étape 3/.test(ko.vol[2]), 'niveaux trace et debug compris, dans l\'ordre');
      A.deep(b.consoleVue, [], 'rien de tout cela n\'est jamais apparu à la console');
      A.equal(ko.volPerdues, 0);
    });

    it('SPEC-BANC-093 : un test lent joint aussi son vol ; le tampon est borné et chaque test a le sien', function () {
      var b = banc(function (g) {
        g.describe('G', function () {
          g.it('lent', function () { g.MC.Journal('JEU').trace('dans le test lent'); });
          g.it('déborde', function () { for (var i = 0; i < 1200; i++) g.MC.Journal('JEU').trace('ligne ' + i); g.assert.equal(1, 2, 'panne'); });
          g.it('suivant', function () { g.assert.equal(1, 2, 'panne du suivant'); });
        });
      }, { seuilLentMs: 1 });
      // le premier est lent à coup sûr : on le rejoue avec une attente réelle
      var lent = banc(function (g) {
        g.describe('G', function () {
          g.it('lent', function () { g.MC.Journal('JEU').trace('dans le test lent'); var t = Date.now(); while (Date.now() - t < 12) { /* attente */ } });
          g.it('rapide', function () { g.MC.Journal('JEU').trace('dans le rapide'); });
        });
      }, { seuilLentMs: 6 });
      A.ok(lent.details['lent'].d.lent && lent.details['lent'].d.vol && /dans le test lent/.test(lent.details['lent'].d.vol[0]), 'lent : vol joint');
      A.equal(lent.details['rapide'].d.vol, null, 'rapide : pas de vol');
      var d = b.details['déborde'].d;
      A.equal(d.vol.length, 500, 'borné à la capacité du tampon');
      A.equal(d.volPerdues, 700, 'les 700 plus anciennes sont perdues');
      A.ok(/ligne 1199/.test(d.vol[499]), 'la fin du test est gardée');
      var s = b.details['suivant'].d;
      A.equal(s.vol, null, 'le test suivant n\'a rien journalisé : son tampon est vide, pas celui du précédent');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
