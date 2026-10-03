/* spec-perimetre.js — périmètre d'exécution des tests (SPEC-BANC-067 à 076,
   docs/banc/historique-global.md §3.6) : carte d'impact, calcul du
   périmètre, REPLI sur la suite complète, crochets, banc, trous de
   périmètre. Fichier Node-only (comme spec-banc.js / spec-crochets.js) : il
   lit l'outillage sur disque et lance tests/run.js en sous-processus —
   `require`, `process` et `__dirname` sont exposés à cette fin par
   tests/run.js.

   SÛRETÉ D'ABORD : la moitié de ces tests prouve que le moteur ÉLARGIT (ou
   se replie sur la suite complète) dès qu'il ne peut pas conclure — jamais
   l'inverse. */
(function (G) {
  'use strict';
  var T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), vm = require('vm');
  var RACINE = path.join(__dirname, '..');
  var P = require(path.join(RACINE, 'tools', 'perimetre.js'));

  function tmp(nom) { return fs.mkdtempSync(path.join(os.tmpdir(), 'mc-perim-' + nom + '-')); }
  function nettoyer(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* rien */ } }
  function git(args) { return cp.execFileSync('git', args, { cwd: RACINE, encoding: 'utf8' }).trim(); }
  /* lance tools/perimetre.js --json (sous-processus borné) et rend l'objet */
  function perimetreJSON(args) {
    var r = cp.spawnSync(process.execPath, [path.join(RACINE, 'tools', 'perimetre.js'), '--json'].concat(args),
      { cwd: RACINE, encoding: 'utf8', timeout: 120000, maxBuffer: 256 * 1024 * 1024 });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error('tools/perimetre.js en échec : ' + (r.stderr || '').slice(0, 500));
    return JSON.parse(r.stdout);
  }

  // ── module de démonstration (fixture) ────────────────────────────────────
  var FIXTURE = [
    '/* module de démonstration */',          // 1
    '(function (G) {',                        // 2
    '  var MC = G.MC = G.MC || {};',          // 3
    '  var BASE = 10;',                       // 4
    '  // une feuille : appelée par personne d\'autre ici', // 5
    '  function feuille(a) {',                // 6
    '    return a + 1;',                      // 7
    '  }',                                    // 8
    '  function aide(x) {',                   // 9
    '    return x * 2;',                      // 10
    '  }',                                    // 11
    '  function utilisatrice(b) {',           // 12
    '    return aide(b) + BASE;',             // 13
    '  }',                                    // 14
    '  function autre(c) {',                  // 15
    '    return c - 1;',                      // 16
    '  }',                                    // 17
    '  MC.Fixture = { feuille: feuille, utilisatrice: utilisatrice, autre: autre };', // 18
    '})(this);',                              // 19
  ].join('\n');
  function exportsDe(texte) {
    var r = P.chargerModules(function () { return texte; }, ['fixture']);
    return r.parFichier['src/fixture.js'];
  }
  function remplacerLigne(texte, n, ligne) { var l = texte.split('\n'); l[n - 1] = ligne; return l.join('\n'); }
  function analyser(nouveau, lignes) {
    return P.analyserFichierSource({ nouveau: nouveau, ancien: FIXTURE, lignesNouvelles: lignes, lignesAnciennes: lignes, exports: exportsDe(nouveau) });
  }
  /* catalogue + carte de démonstration : t-feuille appelle feuille,
     t-util utilisatrice, t-autre autre ; t-fumee est dans l'ensemble fumée,
     t-toujours étiqueté @toujours ; deux tests partagent tests/spec-demo.js */
  function demo() {
    var catalogue = [
      { cle: 'G › t-feuille', nom: 't-feuille', type: 'spec', fichier: 'tests/spec-a.js', domaines: [], fonctions: [], etiquettes: [] },
      { cle: 'G › t-util', nom: 't-util', type: 'spec', fichier: 'tests/spec-a.js', domaines: [], fonctions: [], etiquettes: [] },
      { cle: 'G › t-autre', nom: 't-autre', type: 'spec', fichier: 'tests/spec-b.js', domaines: [], fonctions: [], etiquettes: [] },
      { cle: 'e2e › t-fumee', nom: 't-fumee', type: 'e2e', fichier: 'tests/e2e.js', domaines: [], fonctions: [], etiquettes: [] },
      { cle: 'G › t-toujours', nom: 't-toujours', type: 'spec', fichier: 'tests/spec-b.js', domaines: [], fonctions: [], etiquettes: ['toujours'] },
      { cle: 'D › t-demo-1', nom: 't-demo-1', type: 'spec', fichier: 'tests/spec-demo.js', domaines: [], fonctions: [], etiquettes: [] },
      { cle: 'D › t-demo-2', nom: 't-demo-2', type: 'spec', fichier: 'tests/spec-demo.js', domaines: [], fonctions: [], etiquettes: [] },
    ];
    var carte = {
      version: 1, commit: 'c0ffee', fichiers: { 'src/fixture.js': ['MC.Fixture.autre', 'MC.Fixture.feuille', 'MC.Fixture.utilisatrice'] },
      tests: ['G › t-feuille', 'G › t-util', 'G › t-autre', 'G › t-toujours', 'D › t-demo-1', 'D › t-demo-2'],
      fonctions: { 'MC.Fixture.feuille': [0], 'MC.Fixture.utilisatrice': [1], 'MC.Fixture.autre': [2] },
    };
    return { catalogue: catalogue, carte: carte };
  }
  function calculer(d, extra) {
    return P.calculerPerimetre(Object.assign({
      catalogue: d.catalogue, carte: d.carte, ecart: 0, ecartMax: 50, fichiers: [], analyses: {},
      exportsParFichier: { 'src/fixture.js': ['MC.Fixture.feuille', 'MC.Fixture.utilisatrice', 'MC.Fixture.autre'] },
      fumee: ['t-fumee'], domainesConnus: [],
    }, extra || {}));
  }

  describe('Specs — périmètre d\'exécution des tests (carte d\'impact, calcul, repli)', function () {

    // ── SPEC-BANC-067 : carte d'impact ──────────────────────────────────────
    it('SPEC-BANC-067 : la carte relie chaque fonction observée aux tests qui l\'appellent, chaque fichier source à ses fonctions, et cite son commit', function () {
      var resultats = { campagne: { preset: 'pr', observationFonctions: { surcout_pct: 1 } }, tests: [
        { type: 'spec', groupe: 'G', nom: 'a', etat: 'ok', fonctions: ['MC.Mesher.tileOrigin'], fonctionsAppels: { 'MC.Mesher.tileOrigin': 3 } },
        { type: 'unitaire', groupe: 'G', nom: 'b', etat: 'ok', fonctions: [], fonctionsAppels: { 'MC.Mesher.tileOrigin': 1, 'MC.Core.idx': 9 } },
        { type: 'spec', groupe: 'G', nom: 'c-echoue', etat: 'echec', fonctions: [], fonctionsAppels: { 'MC.Mesher.tileOrigin': 1 } },
        { type: 'integration', groupe: 'x.js', nom: 'x.js (intégration)', etat: 'ok', fonctions: [] },
      ] };
      var carte = P.construireCarte(resultats, { 'src/mesher.js': [{ qual: 'MC.Mesher.tileOrigin', texte: '' }] }, 'abc123');
      var appelants = carte.fonctions['MC.Mesher.tileOrigin'].map(function (i) { return carte.tests[i]; });
      A.deep(appelants.sort(), ['G › a', 'G › b'], 'les deux tests réussis qui appellent tileOrigin (un test en échec n\'est pas une observation fiable)');
      A.deep(carte.fichiers['src/mesher.js'], ['MC.Mesher.tileOrigin'], 'fichier → fonctions qu\'il définit');
      A.equal(carte.commit, 'abc123', 'commit de construction');
      A.ok(carte.tests.indexOf('x.js (intégration) ') < 0 && carte.tests.every(function (c) { return c.indexOf('intégration') < 0; }), 'un script d\'intégration (non observé) n\'est pas dans la carte');
      var leve = false;
      try { P.construireCarte({ campagne: { preset: 'pr' }, tests: [] }, {}, 'x'); } catch (e) { leve = true; }
      A.ok(leve, 'un run sans observation des fonctions (--sans-fonctions) ne fait pas de carte');
      var relue = JSON.parse(P.serialiserCarte(carte));
      A.deep(relue.fonctions, carte.fonctions, 'la carte sérialisée (une fonction par ligne) se relit à l\'identique');
    });

    it('SPEC-BANC-067 : en chargeant les modules, chaque MC.X.f est rattachée au fichier src/x.js qui la définit', function () {
      var r = P.chargerModules(function (c) { return fs.readFileSync(path.join(RACINE, c), 'utf8'); });
      A.deep(Object.keys(r.erreurs), [], 'tous les modules Node se chargent : ' + JSON.stringify(r.erreurs));
      var mesher = r.parFichier['src/mesher.js'].map(function (e) { return e.qual; });
      A.ok(mesher.indexOf('MC.Mesher.tileOrigin') >= 0, 'src/mesher.js définit MC.Mesher.tileOrigin : ' + mesher.join(', '));
      A.ok(r.parFichier['src/world.js'].some(function (e) { return e.qual === 'MC.createWorld'; }), 'une fabrique directe (MC.createWorld) est rattachée à src/world.js');
      A.ok(r.parFichier['src/core.js'].every(function (e) { return e.qual.indexOf('MC.Mesher') < 0; }), 'rien de Mesher n\'est attribué à core.js');
    });

    it('SPEC-BANC-067 : la carte versionnée tests/registre/impact.json cite tileOrigin, src/mesher.js et son commit de construction', function () {
      var carte = P.lireCarte(path.join(RACINE, 'tests', 'registre', 'impact.json'));
      A.ok(carte, 'tests/registre/impact.json existe et se lit');
      A.ok(/^[0-9a-f]{40}$/.test(carte.commit), 'commit de construction en plein : ' + carte.commit);
      A.ok((carte.fonctions['MC.Mesher.tileOrigin'] || []).length >= 1, 'au moins un test appelle MC.Mesher.tileOrigin');
      A.ok((carte.fichiers['src/mesher.js'] || []).indexOf('MC.Mesher.tileOrigin') >= 0, 'src/mesher.js liste tileOrigin');
    });

    it('SPEC-BANC-067/070 : reconstruireCarte part d\'un run COMPLET ; un run restreint (périmètre) ou interrompu n\'alimente jamais la carte', function () {
      var d = tmp('carte');
      try {
        var court = git(['rev-parse', '--short', 'HEAD']);
        function cahier(nom, campagne) {
          fs.mkdirSync(path.join(d, nom), { recursive: true });
          fs.writeFileSync(path.join(d, nom, 'resultats.json'), JSON.stringify({ campagne: Object.assign({ preset: 'pr', observationFonctions: { surcout_pct: 1 }, environnement: { commit: court } }, campagne),
            tests: [{ type: 'spec', groupe: 'G', nom: 'a', etat: 'ok', fonctions: ['MC.Mesher.tileOrigin'], fonctionsAppels: {} }] }));
        }
        cahier('complet', { perimetre: 'complet' });
        cahier('restreint', { perimetre: 'commit' });
        cahier('coupe', { perimetre: 'complet', interrompue: true });
        var chemin = path.join(d, 'impact.json');
        A.equal(P.reconstruireCarte('restreint', { racineResultats: d, chemin: chemin }).ok, false, 'run restreint refusé');
        A.equal(P.reconstruireCarte('coupe', { racineResultats: d, chemin: chemin }).ok, false, 'run interrompu refusé');
        A.ok(!fs.existsSync(chemin), 'aucune carte écrite par un run refusé');
        var r = P.reconstruireCarte('complet', { racineResultats: d, chemin: chemin });
        A.ok(r.ok, 'run complet accepté : ' + JSON.stringify(r));
        var carte = P.lireCarte(chemin);
        A.equal(carte.commit, git(['rev-parse', 'HEAD']), 'commit du cahier résolu en plein');
        A.ok(carte.fichiers['src/mesher.js'].indexOf('MC.Mesher.tileOrigin') >= 0, 'fichiers déduits en chargeant les modules');
      } finally { nettoyer(d); }
    });

    // ── SPEC-BANC-068 : calcul ──────────────────────────────────────────────
    it('SPEC-BANC-068 : modifier une seule fonction (plage de lignes connue) retient exactement ses appelants selon la carte, plus la fumée et les tests étiquetés toujours', function () {
      var nouveau = remplacerLigne(FIXTURE, 7, '    return a + 2;');
      var a = analyser(nouveau, [7]);
      A.equal(a.toutLeFichier, false, 'pas besoin de tout le fichier : ' + a.raison);
      A.deep(a.quals, ['MC.Fixture.feuille'], 'seule la feuille est touchée');
      var d = demo();
      var p = calculer(d, { fichiers: [{ chemin: 'src/fixture.js', statut: 'M' }], analyses: { 'src/fixture.js': a } });
      A.equal(p.repli, null, 'pas de repli');
      A.deep(Object.keys(p.tests).sort(), ['G › t-feuille', 'G › t-toujours', 'e2e › t-fumee'], 'exactement : l\'appelant, la fumée, @toujours');
      A.deep(p.tests['G › t-feuille'], ['fonction:MC.Fixture.feuille'], 'raison de sélection : la fonction');
      A.deep(p.tests['e2e › t-fumee'], ['fumee'], 'raison : fumée');
      A.deep(p.tests['G › t-toujours'], ['toujours'], 'raison : toujours');
    });

    it('SPEC-BANC-068 : un fichier de test modifié seul retient tous les tests de ce fichier (et rien d\'autre que fumée et tests étiquetés toujours)', function () {
      var d = demo();
      var p = calculer(d, { fichiers: [{ chemin: 'tests/spec-demo.js', statut: 'M' }] });
      A.equal(p.repli, null, 'pas de repli');
      A.deep(Object.keys(p.tests).sort(), ['D › t-demo-1', 'D › t-demo-2', 'G › t-toujours', 'e2e › t-fumee'], 'les deux tests du fichier, plus fumée et @toujours');
      A.deep(p.tests['D › t-demo-1'], ['fichier-de-test'], 'raison : fichier-de-test');
    });

    it('SPEC-BANC-068 : sur le vrai dépôt, tools/perimetre.js --fichiers tests/spec-crochets.js retient tous ses tests sans repli', function () {
      var p = perimetreJSON(['--fichiers', 'tests/spec-crochets.js']);
      A.equal(p.repli, null, 'pas de repli : ' + p.repli);
      var duFichier = p.selection.filter(function (t) { return t.fichier === 'tests/spec-crochets.js'; });
      A.ok(duFichier.length >= 1 && duFichier.every(function (t) { return t.raisons.indexOf('fichier-de-test') >= 0; }), 'tous les tests du fichier, raison fichier-de-test');
      A.ok(p.selection.every(function (t) { return t.fichier === 'tests/spec-crochets.js' || t.raisons.indexOf('fumee') >= 0 || t.raisons.indexOf('toujours') >= 0; }),
        'rien d\'autre que la fumée et @toujours');
      A.ok(p.exclus > 100, 'la plupart du catalogue est exclue : ' + p.exclus);
    });

    it('SPEC-BANC-068 : tests sans données d\'impact (nouveaux, e2e, intégration) retenus par domaine ou fonction déclarée en commun', function () {
      var d = demo();
      d.catalogue.push({ cle: 'e2e › rendu', nom: 'rendu', type: 'e2e', fichier: 'tests/e2e.js', domaines: ['FIXTURE'], fonctions: [], etiquettes: [] });
      d.catalogue.push({ cle: 'N › nouveau', nom: 'nouveau', type: 'spec', fichier: 'tests/spec-n.js', domaines: [], fonctions: ['MC.Fixture.feuille'], etiquettes: [] });
      d.catalogue.push({ cle: 'N › sans-rapport', nom: 'sans-rapport', type: 'spec', fichier: 'tests/spec-n.js', domaines: ['AUTRE'], fonctions: [], etiquettes: [] });
      var a = analyser(remplacerLigne(FIXTURE, 7, '    return a + 2;'), [7]);
      var p = calculer(d, { fichiers: [{ chemin: 'src/fixture.js', statut: 'M' }], analyses: { 'src/fixture.js': a }, domainesConnus: ['FIXTURE', 'AUTRE'] });
      A.deep(p.tests['e2e › rendu'], ['domaine:FIXTURE'], 'e2e du domaine du fichier touché');
      A.deep(p.tests['N › nouveau'], ['fonction-declaree:MC.Fixture.feuille'], 'nouveau test qui déclare la fonction touchée');
      A.ok(!p.tests['N › sans-rapport'], 'un test d\'un autre domaine n\'est pas retenu');
    });

    // ── élargissements de sûreté (propagation, chargement, mentions) ────────
    it('SPEC-BANC-068 : une fonction interne touchée se propage à la fonction exportée qui l\'appelle (appel interne jamais observé)', function () {
      var a = analyser(remplacerLigne(FIXTURE, 10, '    return x * 3;'), [10]);
      A.equal(a.toutLeFichier, false, 'propagation plutôt que tout le fichier');
      A.deep(a.quals, ['MC.Fixture.utilisatrice'], 'utilisatrice (qui appelle aide) est touchée');
    });

    it('SPEC-BANC-068 : un changement de commentaire seul ne touche aucune fonction', function () {
      var a = analyser(remplacerLigne(FIXTURE, 5, '  // un autre commentaire'), [5]);
      A.equal(a.toutLeFichier, false, 'pas tout le fichier');
      A.deep(a.quals, [], 'aucune fonction');
      A.ok(a.commentaires, 'reconnu comme commentaires seulement');
    });

    it('SPEC-BANC-069 : du code modifié hors de toute fonction (constante du module) fait retenir TOUT le fichier', function () {
      var a = analyser(remplacerLigne(FIXTURE, 4, '  var BASE = 11;'), [4]);
      A.equal(a.toutLeFichier, true, 'tout le fichier');
      A.ok(/hors de toute fonction/.test(a.raison), a.raison);
      A.deep(a.quals.sort(), ['MC.Fixture.autre', 'MC.Fixture.feuille', 'MC.Fixture.utilisatrice'], 'toutes les fonctions du fichier');
    });

    it('SPEC-BANC-069 : une fonction touchée exécutée au chargement du module fait retenir TOUT le fichier', function () {
      var source = FIXTURE.replace('  var BASE = 10;', '  var BASE = aide(5);');
      var nouveau = remplacerLigne(source, 10, '    return x * 3;');
      var a = P.analyserFichierSource({ nouveau: nouveau, ancien: source, lignesNouvelles: [10], lignesAnciennes: [10], exports: exportsDe(nouveau) });
      A.equal(a.toutLeFichier, true, 'aide() sert au chargement : ' + a.raison);
    });

    it('SPEC-BANC-069 : un fichier que le découpage ne comprend pas fait retenir TOUT le fichier', function () {
      var a = P.analyserFichierSource({ nouveau: 'function f() { if (x) { ', ancien: '', lignesNouvelles: [1], lignesAnciennes: [], exports: [{ qual: 'MC.X.f', texte: '' }] });
      A.equal(a.toutLeFichier, true, 'découpage impossible → tout le fichier');
    });

    it('SPEC-BANC-068 : une fonction touchée capturée sans être appelée par un autre module rend cet autre module entier', function () {
      var d = demo();
      d.carte.fichiers['src/autre.js'] = ['MC.Autre.g'];
      d.carte.fonctions['MC.Autre.g'] = [2];
      var a = analyser(remplacerLigne(FIXTURE, 7, '    return a + 2;'), [7]);
      var p = calculer(d, {
        fichiers: [{ chemin: 'src/fixture.js', statut: 'M' }], analyses: { 'src/fixture.js': a },
        exportsParFichier: { 'src/fixture.js': ['MC.Fixture.feuille', 'MC.Fixture.utilisatrice', 'MC.Fixture.autre'], 'src/autre.js': ['MC.Autre.g'] },
        captures: function (prop) { return prop === 'feuille' ? ['src/autre.js'] : []; },
      });
      A.ok(p.fonctions.indexOf('MC.Autre.g') >= 0, 'les fonctions du module qui capture sont touchées : ' + p.fonctions.join(', '));
      A.deep(p.tests['G › t-autre'], ['fonction:MC.Autre.g'], 'et leurs appelants retenus');
    });

    it('SPEC-BANC-068 : un test qui NOMME une fonction touchée (fabrique partagée hors du test) ou lit le fichier source est retenu', function () {
      var d = demo();
      var a = analyser(remplacerLigne(FIXTURE, 7, '    return a + 2;'), [7]);
      var mentions = {}; d.catalogue.forEach(function (t) { mentions[t.cle] = new Set(); });
      mentions['G › t-autre'] = new Set(['Fixture', 'feuille']);
      var p = calculer(d, {
        fichiers: [{ chemin: 'src/fixture.js', statut: 'M' }], analyses: { 'src/fixture.js': a },
        mentions: mentions, idsFichierTest: { 'tests/spec-b.js': new Set(['Fixture', 'feuille']) },
        texteFichierTest: { 'tests/spec-demo.js': 'var src = read("src/fixture.js");' },
      });
      A.deep(p.tests['G › t-autre'], ['mention:MC.Fixture.feuille'], 'mention de la fonction touchée');
      A.deep(p.tests['D › t-demo-1'], ['lecture:src/fixture.js'], 'lecture du fichier source touché');
    });

    // ── SPEC-BANC-069 : repli sur la suite complète ─────────────────────────
    it('SPEC-BANC-069 : repli sur la suite complète — outillage/serveur, carte absente, carte trop ancienne ou hors historique, module absent ou supprimé', function () {
      var d = demo();
      var a = analyser(remplacerLigne(FIXTURE, 7, '    return a + 2;'), [7]);
      var src = [{ chemin: 'src/fixture.js', statut: 'M' }];
      var analyses = { 'src/fixture.js': a };
      ['server.js', 'tools/registre.js', 'tests/harness.js', 'tests/run.js', 'tests/gates.js', 'index.html', '.githooks/pre-commit', 'src/ui.css'].forEach(function (f) {
        var p = calculer(d, { fichiers: [{ chemin: f, statut: 'M' }] });
        A.ok(p.repli && p.repli.indexOf(f) >= 0, f + ' → repli : ' + p.repli);
      });
      A.ok(/carte d'impact absente/.test(calculer(d, { carte: null, fichiers: src, analyses: analyses }).repli), 'carte absente → repli');
      A.ok(/trop ancienne : 51 commits/.test(calculer(d, { ecart: 51, fichiers: src, analyses: analyses }).repli), 'carte à 51 commits → repli');
      A.equal(calculer(d, { ecart: 50, fichiers: src, analyses: analyses }).repli, null, 'carte à 50 commits : encore utilisable');
      A.equal(calculer(d, { ecart: 51, ecartMax: 100, fichiers: src, analyses: analyses }).repli, null, 'seuil réglable');
      A.ok(/hors de l'historique/.test(calculer(d, { ecart: null, fichiers: src, analyses: analyses }).repli), 'carte d\'un commit hors historique → repli');
      A.ok(/absent de la carte/.test(calculer(d, { fichiers: [{ chemin: 'src/nouveau.js', statut: 'A' }], analyses: { 'src/nouveau.js': a } }).repli), 'nouveau module → repli');
      A.ok(/supprimé/.test(calculer(d, { fichiers: [{ chemin: 'src/fixture.js', statut: 'D' }] }).repli), 'module supprimé → repli');
      A.ok(/illisible/.test(calculer(d, { fichiers: src, analyses: analyses, erreursChargement: { 'src/fixture.js': 'SyntaxError' } }).repli), 'module qui ne se charge pas → repli');
      A.equal(calculer(d, { fichiers: [{ chemin: 'docs/banc/x.md', statut: 'M' }, { chemin: 'tests/registre/impact.json', statut: 'M' }] }).repli, null,
        'un document ou les données du registre ne font pas replier');
    });

    it('SPEC-BANC-069 : sur le vrai dépôt, server.js seul, une carte absente ou construite à plus de 50 commits font replier, avec la raison', function () {
      var p1 = perimetreJSON(['--fichiers', 'server.js']);
      A.ok(p1.repli && p1.repli.indexOf('server.js') >= 0, 'server.js → repli : ' + p1.repli);
      var d = tmp('vieille');
      try {
        var p2 = perimetreJSON(['--fichiers', 'src/mesher.js', '--carte', path.join(d, 'inexistante.json')]);
        A.ok(/carte d'impact absente/.test(p2.repli || ''), 'carte absente → repli : ' + p2.repli);
        var carte = P.lireCarte(path.join(RACINE, 'tests', 'registre', 'impact.json'));
        carte.commit = git(['rev-parse', 'HEAD~51']);
        var chemin = path.join(d, 'vieille.json');
        P.ecrireCarte(carte, chemin);
        // HEAD~51 est à 51 commits au moins (plus si des merges y ramènent des branches)
        var n = parseInt(git(['rev-list', '--count', carte.commit + '..HEAD']), 10);
        A.ok(n >= 51, 'écart réel : ' + n);
        var p3 = perimetreJSON(['--fichiers', 'src/mesher.js', '--carte', chemin]);
        A.ok(new RegExp('trop ancienne : ' + n + ' commits').test(p3.repli || ''), 'carte à ' + n + ' commits → repli : ' + p3.repli);
        var p4 = perimetreJSON(['--fichiers', 'src/mesher.js', '--carte', chemin, '--ecart-max', String(n)]);
        A.equal(p4.repli, null, 'avec --ecart-max ' + n + ', la même carte sert');
      } finally { nettoyer(d); }
    });

    // ── SPEC-BANC-070 : journal du périmètre ────────────────────────────────
    it('SPEC-BANC-070 : un run restreint écrit dans son cahier les fichiers, fonctions, exclus et la raison de chaque test ; l\'historique porte perimetre et raison_selection', function () {
      var d = tmp('cahier');
      try {
        var r = cp.spawnSync(process.execPath, [path.join(RACINE, 'tests', 'run.js'), '--type', 'spec', '--perimetre', 'commit', '--fichiers', 'tests/spec-crochets.js'],
          { cwd: RACINE, encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { MC_TEST_RESULTATS_DIR: d }) });
        A.ok(!r.error && r.status === 0, 'run restreint réussi : ' + (r.error && r.error.message) + ' ' + (r.stderr || '').slice(-300));
        var dossier = fs.readdirSync(d).filter(function (x) { return fs.statSync(path.join(d, x)).isDirectory(); })[0];
        var res = JSON.parse(fs.readFileSync(path.join(d, dossier, 'resultats.json'), 'utf8'));
        A.equal(res.campagne.perimetre, 'commit', 'nature du run : commit');
        A.deep(res.campagne.perimetreDetail.fichiers, ['tests/spec-crochets.js'], 'fichiers touchés');
        A.ok(Array.isArray(res.campagne.perimetreDetail.fonctions), 'fonctions touchées présentes');
        A.ok(res.campagne.perimetreDetail.exclus > 100, 'nombre de tests exclus : ' + res.campagne.perimetreDetail.exclus);
        A.ok(res.tests.length >= 1 && res.tests.every(function (t) { return t.raison_selection && t.raison_selection.indexOf('fichier-de-test') >= 0; }), 'une raison par test retenu');
        var html = fs.readFileSync(path.join(d, dossier, 'rapport.html'), 'utf8');
        A.ok(html.indexOf('Périmètre d&#39;exécution') >= 0 || html.indexOf('Périmètre d\'exécution') >= 0, 'le rapport a sa section périmètre');
        A.ok(html.indexOf('raison de sélection : fichier-de-test') >= 0, 'le rapport montre la raison de sélection');
        var H = require(path.join(RACINE, 'tools', 'historique.js'));
        var REG = require(path.join(RACINE, 'tools', 'registre.js'));
        var lignes = H.construireLignes(REG.runsUnifies({ racineResultats: d, dossierRegistre: path.join(d, 'registre-vide') }));
        A.ok(lignes.length >= 1 && lignes.every(function (l) { return l.perimetre === 'commit' && l.raison_selection.indexOf('fichier-de-test') >= 0; }), 'historique : colonnes perimetre et raison_selection');
        A.equal(P.reconstruireCarte(dossier, { racineResultats: d, chemin: path.join(d, 'impact.json') }).ok, false, 'ce run restreint n\'alimente pas la carte');
      } finally { nettoyer(d); }
    });

    // ── SPEC-BANC-071 à 073 : crochets ──────────────────────────────────────
    it('SPEC-BANC-071 : pre-commit lance --preset commit restreint au périmètre du commit, avec le filet commun', function () {
      var txt = fs.readFileSync(path.join(RACINE, 'tools', 'hooks', 'pre-commit.js'), 'utf8');
      A.ok(/'--preset', 'commit', '--perimetre', 'commit', '--delai', String\(DELAI_FILET_S\)/.test(txt), 'arguments du préréglage commit au périmètre');
      A.ok(!/domainesTouches\(/.test(txt), 'l\'ancien repli par domaines est remplacé (il devient l\'étape 3 du périmètre)');
      var P2 = fs.readFileSync(path.join(RACINE, 'tools', 'perimetre.js'), 'utf8');
      A.ok(/require\('\.\/domaines-touches\.js'\)/.test(P2), 'tools/perimetre.js s\'appuie sur tools/domaines-touches.js (étape 3)');
      A.deep(require(path.join(RACINE, 'tools', 'domaines-touches.js')).domainesDuFichier('src/eau.js', ['EAU', 'MECA']), ['EAU'], 'domaines d\'un fichier');
    });

    it('SPEC-BANC-072 : la suite complète inscrit son cahier au registre (pre-push, en_attente) et reconstruit la carte avec le commit courant', function () {
      var d = tmp('suite');
      try {
        var court = git(['rev-parse', '--short', 'HEAD']);
        fs.mkdirSync(path.join(d, 'tests'), { recursive: true });
        // un faux tests/run.js : écrit un cahier complet et réussit (ou échoue si MC_FAUX_ECHEC)
        fs.writeFileSync(path.join(d, 'tests', 'run.js'), [
          "var fs = require('fs'), path = require('path');",
          "var dos = path.join(__dirname, 'resultats', '2099-01-01_00-00-0' + (process.env.MC_FAUX_N || '0') + '_pr');",
          "fs.mkdirSync(dos, { recursive: true });",
          "fs.writeFileSync(path.join(dos, 'resultats.json'), JSON.stringify({ campagne: { preset: 'pr', perimetre: 'complet', observationFonctions: { surcout_pct: 1 }, environnement: { commit: '" + court + "' } },",
          "  tests: [{ type: 'spec', groupe: 'G', nom: 'a', etat: 'ok', fonctions: ['MC.Mesher.tileOrigin'], fonctionsAppels: {} }] }));",
          "process.exit(process.env.MC_FAUX_ECHEC ? 1 : 0);",
        ].join('\n'));
        var S = require(path.join(RACINE, 'tools', 'hooks', 'suite-complete.js'));
        var r = S.lancerSuiteComplete({ racine: d, dossierRepo: RACINE, origine: 'pre-push', silencieux: true, etapes: [{ args: ['--preset', 'pr'], carte: true }] });
        A.ok(r.ok, 'suite réussie');
        var REG = require(path.join(RACINE, 'tools', 'registre.js'));
        var entrees = REG.lireEntrees(path.join(d, 'tests', 'registre'));
        A.equal(entrees.length, 1, 'une entrée inscrite');
        A.equal(entrees[0].origine, 'pre-push', 'origine pre-push');
        A.equal(entrees[0].statut, 'en_attente', 'statut en_attente (intégrée au commit suivant)');
        var carte = P.lireCarte(path.join(d, 'tests', 'registre', 'impact.json'));
        A.ok(carte && carte.commit === git(['rev-parse', 'HEAD']), 'carte reconstruite sur le commit courant');
        process.env.MC_FAUX_ECHEC = '1'; process.env.MC_FAUX_N = '1';
        fs.unlinkSync(path.join(d, 'tests', 'registre', 'impact.json'));
        var r2 = S.lancerSuiteComplete({ racine: d, dossierRepo: RACINE, origine: 'pre-push', silencieux: true, etapes: [{ args: ['--preset', 'pr'], carte: true }] });
        A.equal(r2.ok, false, 'un préréglage en échec fait échouer la suite');
        A.ok(!fs.existsSync(path.join(d, 'tests', 'registre', 'impact.json')), 'pas de carte reconstruite sur un échec');
      } finally { delete process.env.MC_FAUX_ECHEC; delete process.env.MC_FAUX_N; nettoyer(d); }
      var pp = fs.readFileSync(path.join(RACINE, 'tools', 'hooks', 'pre-push.js'), 'utf8');
      A.ok(/origine: 'pre-push'/.test(pp) && /\{ args: \['--preset', 'pr'\], carte: true \}/.test(pp), 'pre-push.js : pr en entier, carte reconstruite, origine pre-push');
    });

    it('SPEC-BANC-073 : un merge déclenche la suite complète — pre-merge-commit (sans conflit), MERGE_HEAD détecté par pre-commit (conflits résolus)', function () {
      var crochet = path.join(RACINE, '.githooks', 'pre-merge-commit');
      A.ok(fs.existsSync(crochet) && /node tools\/hooks\/pre-merge-commit\.js/.test(fs.readFileSync(crochet, 'utf8')), '.githooks/pre-merge-commit lance tools/hooks/pre-merge-commit.js');
      var pm = fs.readFileSync(path.join(RACINE, 'tools', 'hooks', 'pre-merge-commit.js'), 'utf8');
      A.ok(/\{ args: \['--preset', 'pr'\], carte: true \}/.test(pm) && /lancerSuiteComplete/.test(pm), 'pre-merge-commit.js : suite complète, pr en entier');
      var pc = fs.readFileSync(path.join(RACINE, 'tools', 'hooks', 'pre-commit.js'), 'utf8');
      A.ok(/estEnMerge\(/.test(pc) && /if \(enMerge\)[\s\S]*\{ args: \['--preset', 'pr'\], carte: true \}[\s\S]*\} else \{[\s\S]*'--perimetre', 'commit'/.test(pc),
        'pre-commit.js : MERGE_HEAD → suite complète, sinon périmètre');
      // estEnMerge sur un vrai dépôt jetable : faux sans MERGE_HEAD, vrai avec
      var d = tmp('merge');
      try {
        /* Environnement SANS les variables GIT_* : lancé depuis un crochet
           (pre-commit), git y a posé GIT_DIR/GIT_INDEX_FILE du VRAI dépôt —
           sans ce nettoyage, `git init`/`git commit` ci-dessous agiraient sur
           lui (constaté : un commit « init » dans la branche, core.bare=true). */
        var envPropre = {};
        Object.keys(process.env).forEach(function (k) { if (!/^GIT_/i.test(k)) envPropre[k] = process.env[k]; });
        var g = function (args) { return cp.execFileSync('git', args, { cwd: d, env: envPropre, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); };
        g(['init', '-q']);
        fs.writeFileSync(path.join(d, 'a.txt'), 'a');
        g(['add', 'a.txt']);
        g(['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'init']);
        var S = require(path.join(RACINE, 'tools', 'hooks', 'suite-complete.js'));
        A.equal(S.estEnMerge(d, envPropre), false, 'pas de merge en cours');
        fs.writeFileSync(path.join(d, '.git', 'MERGE_HEAD'), g(['rev-parse', 'HEAD']) + '\n');
        A.equal(S.estEnMerge(d, envPropre), true, 'MERGE_HEAD présent : merge en cours');
      } finally { nettoyer(d); }
    });

    // ── SPEC-BANC-074 : banc web ────────────────────────────────────────────
    it('SPEC-BANC-074 : le banc propose Périmètre du commit / depuis… / Tout avec un aperçu des tests et raisons, sans rien lancer', function () {
      var html = fs.readFileSync(path.join(RACINE, 'tests', 'index.html'), 'utf8');
      ['value="commit">Périmètre du commit', 'value="depuis">Périmètre depuis…', 'value="tout">Tout', 'id="perimetre-ref"', 'id="perimetre-apercu"'].forEach(function (m) {
        A.ok(html.indexOf(m) >= 0, 'index.html contient ' + m);
      });
      var ui = fs.readFileSync(path.join(RACINE, 'tests', 'banc-ui.js'), 'utf8');
      var bloc = ui.slice(ui.indexOf('// ── périmètre d\'exécution (SPEC-BANC-074)'), ui.indexOf('refs.btnTout.addEventListener'));
      A.ok(bloc.length > 200, 'bloc périmètre présent dans banc-ui.js');
      A.ok(/fetch\(url\)/.test(bloc) && /'\/tests\/perimetre'/.test(bloc), 'aperçu demandé au serveur');
      A.ok(/raisons/.test(bloc), 'la raison de chaque test est affichée');
      A.ok(!/lancer\(\)/.test(bloc), 'aucun lancement depuis l\'aperçu : seul « Lancer » exécute');
      var srv = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
      var route = srv.slice(srv.indexOf('function traiterPerimetre'), srv.indexOf('let exportHistoriqueEnCours'));
      A.ok(/refuserHorsBancLocal/.test(route) && /tools', 'perimetre\.js'/.test(route) && /'--json'/.test(route), 'route GET /tests/perimetre : banc local, tools/perimetre.js --json');
      A.ok(/référence invalide/.test(route), 'la référence est validée avant usage');
      A.ok(!/tests', 'run\.js'\)[^\n]*--preset/.test(route), 'la route ne lance aucune campagne');
    });

    // ── SPEC-BANC-075 : G13 étendue ─────────────────────────────────────────
    it('SPEC-BANC-075 : le périmètre se calcule, non vide, pour un cas connu (src/mesher.js), comme le vérifie G13', function () {
      var r = cp.spawnSync(process.execPath, [path.join(RACINE, 'tests', 'run.js'), '--preset', 'commit', '--perimetre', 'commit', '--fichiers', 'src/mesher.js', '--perimetre-json'],
        { cwd: RACINE, encoding: 'utf8', timeout: 120000, maxBuffer: 256 * 1024 * 1024 });
      A.ok(!r.error && r.status === 0, 'calcul réussi');
      var p = JSON.parse(r.stdout);
      A.ok(p.selection.length > 0, 'périmètre non vide : ' + p.selection.length);
      A.ok(p.selection.every(function (t) { return ['spec', 'unitaire', 'fonctionnel'].indexOf(t.type) >= 0; }), 'restreint au préréglage commit');
      var gates = fs.readFileSync(path.join(RACINE, 'tests', 'gates.js'), 'utf8');
      A.ok(/SPEC-BANC-075/.test(gates) && /pre-merge-commit/.test(gates) && /--perimetre-json/.test(gates), 'G13 vérifie pre-commit au périmètre, pre-push/pre-merge-commit complets');
    });

    // ── SPEC-BANC-076 : trous de périmètre ──────────────────────────────────
    it('SPEC-BANC-076 : un échec que le périmètre n\'aurait pas retenu est un « trou de périmètre », visible dans le rapport et l\'historique', function () {
      var echecs = [
        { type: 'spec', groupe: 'G', nom: 'retenu', etat: 'echec' },
        { type: 'spec', groupe: 'G', nom: 'rate', etat: 'echec' },
        { type: 'spec', groupe: 'G', nom: 'ok', etat: 'ok' },
      ];
      var perim = { repli: null, tests: { 'G › retenu': ['fonction:MC.X.f'] }, fichiers: ['src/x.js'] };
      var c = P.controlerTrous(echecs, { commit: 'abc' }, function (ref) { A.equal(ref, 'abc', 'périmètre depuis le commit de la carte'); return perim; });
      A.deep(c.trous, [{ cle: 'G › rate', nom: 'rate' }], 'seul l\'échec non retenu est un trou');
      A.deep(P.trousDePerimetre(echecs, { repli: 'x', tests: {} }), [], 'un repli (tout aurait tourné) ne laisse aucun trou');
      A.equal(P.controlerTrous(echecs, null, function () { throw new Error('jamais'); }).verifie, false, 'sans carte : non vérifié, dit pourquoi');
      var resultats = { campagne: { preset: 'pr', perimetre: 'complet', totaux: { total: 2, passes: 0, echecs: 2, ignores: 0 }, trousPerimetre: c },
        tests: [{ nom: 'rate', type: 'spec', groupe: 'G', etat: 'echec', trou_perimetre: true, domaines: [], captures: [] }] };
      var R = G.MC_RAPPORT;
      var html = R.html(resultats);
      A.ok(html.indexOf('Trous de périmètre (1)') >= 0, 'le rapport a sa section d\'avertissement');
      A.ok(html.indexOf('trou de périmètre : échec que le périmètre du commit') >= 0, 'le test porte l\'avertissement');
      var H = require(path.join(RACINE, 'tools', 'historique.js'));
      var lignes = H.construireLignes([{ id: 'r', commit: 'abc', preset: 'pr', origine: 'pre-push', perimetre: 'complet', tests: [
        { nom: 'rate', categorie: { type: 'spec', groupe: 'G' }, etat: 'echec', trou_perimetre: true, raison_selection: ['complet'] }] }]);
      A.equal(lignes[0].trou_perimetre, true, 'historique : colonne trou_perimetre');
      A.equal(H.TYPES_COLONNES.trou_perimetre, 'enum', 'colonne filtrable');
      var ui = fs.readFileSync(path.join(RACINE, 'tests', 'historique.js'), 'utf8');
      A.ok(/trou de périmètre/.test(ui), 'la vue historique affiche l\'avertissement sur l\'état');
    });

    it('SPEC-BANC-076 : tests/run.js contrôle les trous sur un run complet (pr, regression) et les inscrit au cahier', function () {
      var txt = fs.readFileSync(path.join(RACINE, 'tests', 'run.js'), 'utf8');
      A.ok(/nomPreset === 'pr' \|\| nomPreset === 'regression'/.test(txt) && /P\.controlerTrous\(/.test(txt) && /trousPerimetre,/.test(txt), 'contrôle branché sur les runs complets');
      var REG = fs.readFileSync(path.join(RACINE, 'tools', 'registre.js'), 'utf8');
      A.ok(/trou_perimetre: !!t\.trou_perimetre/.test(REG) && /trous_perimetre: campagne\.trousPerimetre/.test(REG), 'le registre garde trou_perimetre et le bilan du run');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
