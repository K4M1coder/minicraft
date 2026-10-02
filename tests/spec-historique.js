/* spec-historique.js — tests de tools/historique.js (logique pure du
   tableau « Historique global », SPEC-BANC-033 à 040, docs/banc/
   historique-global.md §1 à §3.1). Fichier Node-only, comme spec-banc.js
   (voir son en-tête) : `require`/`process`/`__dirname` sont exposés par
   tests/run.js pour cette seule raison. Marqué `node` dans
   tests/fichiers-tests.js : jamais chargé côté navigateur (ses tests y
   restent visibles via l'historique, SPEC-BANC-118). */
(function (G) {
  'use strict';
  var T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path');
  var RACINE = path.join(__dirname, '..');
  var H = require(path.join(RACINE, 'tools', 'historique.js'));
  var REG = require(path.join(RACINE, 'tools', 'registre.js'));

  // ── jeux de données minimaux, construits à la main (pas de disque) ──────
  function run(o) {
    return Object.assign({
      id: 'run-' + Math.random().toString(36).slice(2),
      commit: 'c1', branche: 'master', date: '2026-01-01T00:00:00.000Z',
      preset: 'pr', origine: 'pre-push', inscrit: true, tests: [],
    }, o);
  }
  function test(o) {
    return Object.assign({
      id: 'N-1', nom: 'un test', categorie: { type: 'unitaire', groupe: 'G' },
      domaines: ['RENDU'], specs: [], fonctions: [], etiquettes: [],
      debut: '2026-01-01T00:00:01.000Z', duree_ms: 100, etat: 'reussi',
      erreur: null, captures: [],
    }, o);
  }

  describe('Specs — historique global : source, tableau, tri, filtres (tools/historique.js)', function () {

    it('SPEC-BANC-033 : construireLignes() aplatit runsUnifies() en une ligne par test×run, registre et cahiers locaux confondus', function () {
      var runs = [
        run({ id: 'r1', inscrit: true, tests: [test({ id: 'N-1', nom: 'a' }), test({ id: 'N-2', nom: 'b' })] }),
        run({ id: 'r2', inscrit: false, origine: 'manuel', tests: [test({ id: 'N-1', nom: 'a' })] }),
      ];
      var lignes = H.construireLignes(runs);
      A.equal(lignes.length, 3, 'trois lignes test×run (2 dans r1, 1 dans r2)');
      A.ok(lignes.some(function (l) { return l.run === 'r1' && l.inscrit === true; }), 'une ligne du registre (inscrit)');
      A.ok(lignes.some(function (l) { return l.run === 'r2' && l.inscrit === false; }), 'une ligne d\'un cahier local (non inscrit)');
    });

    it('SPEC-BANC-034 : chaque propriété du document de conception a sa colonne, avec le bon type', function () {
      var attendu = { run: 'texte', debut_run: 'horodatage', commit: 'texte', rang_commit: 'commit', branche: 'enum', preset: 'enum', origine: 'enum', inscrit: 'enum', test: 'texte', nom: 'texte', domaines: 'liste', specs: 'liste', fonctions: 'liste', etiquettes: 'liste', debut_test: 'horodatage', duree_ms: 'nombre', etat: 'enum', erreur: 'texte', nb_captures: 'nombre' };
      Object.keys(attendu).forEach(function (c) {
        A.equal(H.TYPES_COLONNES[c], attendu[c], 'colonne ' + c);
      });
    });

    it('SPEC-BANC-034 : une ligne sans capture reste présente, avec nb_captures=0 et captures=[]', function () {
      var runs = [run({ tests: [test({ captures: [] })] })];
      var lignes = H.construireLignes(runs);
      A.equal(lignes[0].nb_captures, 0, 'aucune capture');
      A.deep(lignes[0].captures, [], 'liste de captures vide, jamais absente');
    });

    it('SPEC-BANC-035 : le tri simple trie par une colonne, croissant ou décroissant', function () {
      var lignes = [{ duree_ms: 30 }, { duree_ms: 10 }, { duree_ms: 20 }];
      var asc = H.trierLignes(lignes, { champ: 'duree_ms', ordre: 'asc' });
      A.deep(asc.map(function (l) { return l.duree_ms; }), [10, 20, 30], 'tri croissant');
      var desc = H.trierLignes(lignes, { champ: 'duree_ms', ordre: 'desc' });
      A.deep(desc.map(function (l) { return l.duree_ms; }), [30, 20, 10], 'tri décroissant');
      var sansTri = H.trierLignes(lignes, []);
      A.deep(sansTri.map(function (l) { return l.duree_ms; }), [30, 10, 20], 'sans tri : ordre d\'origine conservé');
    });

    it('SPEC-BANC-035 : le tri est multi-clés — tri principal état, secondaire durée (Maj+clic)', function () {
      var lignes = [
        { etat: 'echec', duree_ms: 50 }, { etat: 'reussi', duree_ms: 30 },
        { etat: 'echec', duree_ms: 10 }, { etat: 'reussi', duree_ms: 5 },
      ];
      var tries = H.trierLignes(lignes, [{ champ: 'etat', ordre: 'asc' }, { champ: 'duree_ms', ordre: 'asc' }]);
      A.deep(tries.map(function (l) { return l.etat + ':' + l.duree_ms; }),
        ['echec:10', 'echec:50', 'reussi:5', 'reussi:30'],
        'groupées par état, puis triées par durée à état égal');
    });

    it('SPEC-BANC-036 : filtre texte « contient », insensible à la casse (erreur, sujet de commit…)', function () {
      var lignes = [{ erreur: 'Délai dépassé sur le rendu' }, { erreur: 'assertion échouée' }, { erreur: null }];
      var f = H.filtrerLignes(lignes, { erreur: 'DÉLAI' });
      A.equal(f.length, 1, 'une seule ligne contient "délai" (insensible à la casse)');
    });

    it('SPEC-BANC-036 : filtre énumération — multi-sélection sur état, avec effectifs pour remplir le filtre', function () {
      var lignes = [{ etat: 'reussi' }, { etat: 'reussi' }, { etat: 'echec' }, { etat: 'ignore' }];
      var f = H.filtrerLignes(lignes, { etat: ['reussi'] });
      A.equal(f.length, 2, 'ne garde que les lignes état=reussi');
      var eff = H.effectifsEnum(lignes, 'etat');
      A.deep(eff, [{ valeur: 'reussi', effectif: 2 }, { valeur: 'echec', effectif: 1 }, { valeur: 'ignore', effectif: 1 }],
        'effectif de chaque valeur, trié décroissant');
    });

    it('SPEC-BANC-036/063 : une colonne-liste (domaines) compte un test dans CHACUNE de ses valeurs', function () {
      var lignes = [{ domaines: ['RENDU', 'SYNC'] }, { domaines: ['SYNC'] }];
      var eff = H.effectifsEnum(lignes, 'domaines');
      A.deep(eff.sort(function (a, b) { return a.valeur.localeCompare(b.valeur); }),
        [{ valeur: 'RENDU', effectif: 1 }, { valeur: 'SYNC', effectif: 2 }], 'SYNC compte 2, RENDU compte 1');
      var f = H.filtrerLignes(lignes, { domaines: ['RENDU'] });
      A.equal(f.length, 1, 'seule la ligne qui déclare RENDU dans sa liste est retenue');
    });

    it('SPEC-BANC-036 : filtre nombre (min/max) sur duree_ms et nb_captures', function () {
      var lignes = [{ duree_ms: 5 }, { duree_ms: 50 }, { duree_ms: 500 }];
      A.equal(H.filtrerLignes(lignes, { duree_ms: { min: 10, max: 100 } }).length, 1, 'un seul dans [10,100]');
      A.equal(H.filtrerLignes(lignes, { duree_ms: { min: 10 } }).length, 2, 'min seul');
    });

    it('SPEC-BANC-036 : filtre horodatage de/à (début de run, début de test)', function () {
      var lignes = [{ debut_run: '2026-01-01T00:00:00.000Z' }, { debut_run: '2026-02-01T00:00:00.000Z' }, { debut_run: '2026-03-01T00:00:00.000Z' }];
      var f = H.filtrerLignes(lignes, { debut_run: { de: '2026-01-15', a: '2026-02-15' } });
      A.equal(f.length, 1, 'seule la ligne de février tombe dans l\'intervalle');
    });

    it('SPEC-BANC-036 : filtre commit (plage de rang_commit)', function () {
      var lignes = [{ rang_commit: 0 }, { rang_commit: 5 }, { rang_commit: 12 }];
      var f = H.filtrerLignes(lignes, { rang_commit: { de: 1, a: 10 } });
      A.equal(f.length, 1, 'seule la ligne de rang 5 tombe dans [1,10]');
    });

    it('SPEC-BANC-037 : filtres rapides — inscrits seulement, tous les runs, échecs, lents', function () {
      var lignes = [{ inscrit: true, etat: 'reussi' }, { inscrit: false, etat: 'echec' }, { inscrit: true, etat: 'avertissement' }];
      A.equal(H.filtrerLignes(lignes, H.filtreRapide('inscrits')).length, 2, 'inscrits seulement');
      A.equal(H.filtrerLignes(lignes, H.filtreRapide('tous')).length, 3, 'tous les runs : jeu complet');
      A.equal(H.filtrerLignes(lignes, H.filtreRapide('echecs')).length, 1, 'échecs');
      A.equal(H.filtrerLignes(lignes, H.filtreRapide('lents')).length, 1, 'lents (avertissement)');
    });

    it('SPEC-BANC-038 : la pagination rend la bonne tranche et le total réel (pas seulement la page)', function () {
      var lignes = []; for (var i = 0; i < 205; i++) lignes.push({ i: i });
      var p1 = H.paginer(lignes, 1, 50);
      A.equal(p1.lignes.length, 50, 'première page pleine');
      A.equal(p1.total, 205, 'total = toutes les lignes filtrées, pas la page');
      var p5 = H.paginer(lignes, 5, 50);
      A.equal(p5.lignes.length, 5, 'dernière page partielle (205 - 4*50 = 5)');
    });

    it('SPEC-BANC-040 : une requête lignes (filtre+tri+pagination) renvoie exactement les lignes, le total et les effectifs attendus', function () {
      var runs = [
        run({ id: 'r1', tests: [test({ id: 'N-1', nom: 'a', etat: 'reussi', duree_ms: 10 }), test({ id: 'N-2', nom: 'b', etat: 'echec', duree_ms: 900 })] }),
        run({ id: 'r2', tests: [test({ id: 'N-1', nom: 'a', etat: 'reussi', duree_ms: 20 })] }),
      ];
      var lignes = H.construireLignes(runs);
      var filtrees = H.filtrerLignes(lignes, { etat: ['reussi'] });
      var triees = H.trierLignes(filtrees, { champ: 'duree_ms', ordre: 'desc' });
      var page = H.paginer(triees, 1, 1);
      A.equal(page.total, 2, 'total des lignes réussies (avant pagination)');
      A.equal(page.lignes.length, 1, 'une seule ligne sur cette page');
      A.equal(page.lignes[0].duree_ms, 20, 'la plus grande durée en premier (tri desc)');
      var eff = H.effectifsToutesEnum(lignes);
      A.ok(eff.etat, 'effectifs par état présents');
      A.deep(eff.etat.find(function (e) { return e.valeur === 'reussi'; }), { valeur: 'reussi', effectif: 2 }, 'effectif réussi correct sur le jeu complet (non filtré)');
    });

    it('SPEC-BANC-041/043 : serieAgregee() regroupe par run, avec médiane/p95 pour une propriété numérique et des compteurs pour l\'état', function () {
      var runs = [
        run({ id: 'r1', date: '2026-01-01T00:00:00.000Z', tests: [test({ etat: 'reussi', duree_ms: 100 }), test({ etat: 'echec', duree_ms: 300 })] }),
        run({ id: 'r2', date: '2026-01-02T00:00:00.000Z', tests: [test({ etat: 'reussi', duree_ms: 50 })] }),
      ];
      var lignes = H.construireLignes(runs);
      var serie = H.serieAgregee(lignes, { x: 'debut_run', props: ['etat', 'duree_ms'] });
      A.equal(serie.length, 2, 'un point par run');
      var r1 = serie.find(function (p) { return p.run === 'r1'; });
      A.equal(r1.etat.reussi, 1, 'un test réussi dans r1');
      A.equal(r1.etat.echec, 1, 'un test en échec dans r1');
      A.equal(r1.duree_ms.mediane, 200, 'médiane des durées de r1 : (100+300)/2');
      var r2 = serie.find(function (p) { return p.run === 'r2'; });
      A.equal(r2.duree_ms.mediane, 50, 'un seul test : médiane = valeur brute');
    });

    it('SPEC-BANC-041 : l\'axe X choisi (commit) réordonne selon rang_commit, pas selon debut_run', function () {
      var runs = [
        run({ id: 'r1', commit: 'c-vieux', date: '2026-03-01T00:00:00.000Z', tests: [test({})] }),
        run({ id: 'r2', commit: 'c-recent', date: '2026-01-01T00:00:00.000Z', tests: [test({})] }),
      ];
      var infoCommit = { 'c-vieux': { rang: 5, court: 'c-vieux', sujet: 's' }, 'c-recent': { rang: 1, court: 'c-recent', sujet: 's' } };
      var lignes = H.construireLignes(runs, { infoCommit: infoCommit });
      var serie = H.serieAgregee(lignes, { x: 'rang_commit', props: [] });
      A.deep(serie.map(function (p) { return p.run; }), ['r2', 'r1'], 'ordonné par rang_commit croissant (1 puis 5), pas par date');
    });

    it('SPEC-BANC-040/046 : imagesDeTest() rend la suite ordonnée des runs d\'un test, un run sans capture affichant une liste vide plutôt que d\'être sauté', function () {
      var runs = [
        run({ id: 'r1', date: '2026-01-01T00:00:00.000Z', tests: [test({ id: 'N-1', captures: [{ role: 'debut', libelle: 'debut', image: 'a.jpg', t_ms: 0 }] })] }),
        run({ id: 'r2', date: '2026-01-02T00:00:00.000Z', tests: [test({ id: 'N-1', captures: [] })] }),
      ];
      var lignes = H.construireLignes(runs);
      var imgs = H.imagesDeTest(lignes, 'N-1', { tri: 'lancement' });
      A.equal(imgs.length, 2, 'les deux runs apparaissent, même celui sans capture');
      A.deep(imgs.map(function (r) { return r.run; }), ['r1', 'r2'], 'ordre de lancement');
      A.deep(imgs[1].captures, [], 'run sans capture : liste vide, pas absent');
    });

    it('SPEC-BANC-040 : l\'index en mémoire ne reconstruit PAS à chaque requête, seulement quand le dossier source change', function () {
      var dossierRegistre = path.join(RACINE, 'tests', '_tmp_histoidx_' + Date.now());
      var racineResultats = path.join(dossierRegistre, 'resultats');
      var dossierEntrees = path.join(dossierRegistre, REG.DOSSIER_ENTREES_REL);
      fs.mkdirSync(dossierEntrees, { recursive: true });
      fs.mkdirSync(racineResultats, { recursive: true });
      try {
        var idx = H.creerIndex({ dossierRegistre: dossierRegistre, racineResultats: racineResultats, dossierRepo: RACINE });
        var l1 = idx.lignes();
        A.equal(l1.length, 0, 'registre vide au départ');
        A.equal(idx.reconstructions, 1, 'une première reconstruction');
        idx.lignes(); idx.lignes();
        A.equal(idx.reconstructions, 1, 'deux appels de plus SANS changement disque : aucune reconstruction supplémentaire');

        // on écrit une entrée réelle : le dossier entrees/ change (nouveau fichier -> mtime)
        fs.writeFileSync(path.join(dossierEntrees, 'x.jsonl'),
          JSON.stringify({ commit: 'c1', branche: 'm', date: '2026-01-01T00:00:00.000Z', preset: 'pr', origine: 'pre-push', inscrit: true, statut: 'ok' }) + '\n' +
          JSON.stringify(test({})) + '\n');
        var l2 = idx.lignes();
        A.equal(l2.length, 1, 'la nouvelle entrée est prise en compte');
        A.equal(idx.reconstructions, 2, 'une seconde reconstruction, déclenchée par le changement du dossier');
      } finally {
        fs.rmSync(dossierRegistre, { recursive: true, force: true });
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // SPEC-BANC-117 à 121 : tout le catalogue et tout l'historique restent
  // consultables depuis le banc navigateur, sans plantage
  // ══════════════════════════════════════════════════════════════════════
  describe('Specs — banc : tous les tests consultables sans plantage', function () {
    var vm = require('vm');
    var setTimeout = require('timers').setTimeout, clearTimeout = require('timers').clearTimeout;
    // identifiant de spec FICTIF, assemblé à l'exécution : écrit en clair, la
    // porte G2 le prendrait pour une spec citée absente de SPECS.md
    var SPEC_FICTIVE = 'SPEC-' + 'FICTIF-' + '001';
    var URLSearchParams = require('url').URLSearchParams;
    function lire(rel) { return fs.readFileSync(path.join(RACINE, rel), 'utf8'); }
    function contexteNu() {
      var ctx = vm.createContext({ console: console, Math: Math, JSON: JSON, Date: Date, Promise: Promise, setTimeout: setTimeout, clearTimeout: clearTimeout, performance: { now: function () { return Date.now(); } } });
      ctx.globalThis = ctx;
      return ctx;
    }

    it('SPEC-BANC-117 : tests/e2e.js ne remplace pas le harnais G.T (le banc perdait TOUS ses tests Node)', function () {
      var ctx = contexteNu();
      vm.runInContext(lire('tests/harness.js'), ctx, { filename: 'harness.js' });
      var harnais = ctx.T;
      vm.runInContext('describe("G", function () { it("un test Node", function () {}); });', ctx);
      vm.runInContext(lire('tests/e2e.js'), ctx, { filename: 'e2e.js' });
      A.ok(ctx.T === harnais, 'G.T est toujours le harnais après le chargement de e2e.js');
      A.equal(typeof ctx.T.run, 'function', 'T.run (harnais) toujours là');
      A.equal(ctx.T.suites.length, 1, 'les suites déjà déclarées sont toujours visibles');
      A.equal(typeof ctx.T.etape, 'function', 'T.etape reste appelable (e2e pendant un e2e, harnais sinon)');
    });

    it('SPEC-BANC-117 : une seule liste de fichiers de tests, partagée par run.js et le banc ; complète ; Node-only bien marqués', function () {
      var ctx = contexteNu();
      vm.runInContext(lire('tests/fichiers-tests.js'), ctx, { filename: 'fichiers-tests.js' });
      var liste = ctx.MC_FICHIERS_TESTS;
      A.ok(Array.isArray(liste) && liste.length > 50, 'MC_FICHIERS_TESTS est posé');
      var noms = liste.map(function (e) { return e.f; });
      A.equal(new Set(noms).size, noms.length, 'aucun fichier en double');
      A.ok(/MC_FICHIERS_TESTS/.test(lire('tests/run.js')) && !/const TESTS = \[/.test(lire('tests/run.js')), 'run.js lit la liste partagée (plus de copie à la main)');
      var page = lire('tests/index.html');
      A.ok(/fichiers-tests\.js/.test(page) && /MC_FICHIERS_TESTS/.test(page) && !/var fichiersTests = \['unit'/.test(page), 'tests/index.html lit la liste partagée (plus de copie à la main)');
      // tout fichier describe/it du dossier y figure (une nouvelle copie qui
      // divergerait serait vue ici, pas dans la page)
      fs.readdirSync(path.join(RACINE, 'tests')).filter(function (f) { return /^spec-.*\.js$/.test(f) || f === 'unit.js' || f === 'functional.js' || f === 'limites-sondes.js'; })
        .forEach(function (f) { A.ok(noms.indexOf(f.replace(/\.js$/, '')) >= 0, f + ' est dans tests/fichiers-tests.js'); });
      // un fichier NON marqué « node » se charge sans require/process/__dirname
      liste.forEach(function (e) {
        var code = lire('tests/' + e.f + '.js');
        if (e.node) { A.ok(/\brequire\(|__dirname|\bprocess\./.test(code), e.f + ' : marqué node, il utilise bien Node'); return; }
        var c = contexteNu();
        vm.runInContext(lire('tests/harness.js'), c);
        c.MC = {}; // les modules src/ ne sont pas nécessaires au simple CHARGEMENT des déclarations
        var erreur = null;
        try { vm.runInContext(code, c, { filename: e.f + '.js' }); } catch (x) { erreur = x; }
        A.ok(!erreur || !/\b(require|process|__dirname) is not defined/.test(erreur.message), e.f + ' : chargeable dans le navigateur (sinon marquez-le node) — ' + (erreur && erreur.message));
      });
    });

    it('SPEC-BANC-119 : chaque test du catalogue a une identité `cle` UNIQUE, là où `id` ne l\'est pas', function () {
      var cat = G.MC_TESTS.construire(G.T, [{ nom: SPEC_FICTIVE + ' : e2e un', groupe: 'section A' }, { nom: SPEC_FICTIVE + ' : e2e deux', groupe: 'section B' }], {});
      var cles = cat.map(function (t) { return t.cle; });
      var ids = cat.map(function (t) { return t.id; });
      A.equal(new Set(cles).size, cles.length, 'aucune identité en double sur ' + cles.length + ' tests');
      A.ok(new Set(ids).size < ids.length, 'précondition : des id sont partagés (' + new Set(ids).size + ' id distincts pour ' + ids.length + ' tests)');
      var e2e = cat.filter(function (t) { return t.type === 'e2e'; });
      A.equal(e2e[0].cle, 'e2e › ' + SPEC_FICTIVE + ' : e2e un','e2e : identité indépendante de la section (groupe instable entre Node et navigateur)');
      A.equal(G.MC_TESTS.cleTest('spec', 'G', 'n'), H.cleTest('spec', 'G', 'n'), 'même calcul côté catalogue et côté historique');
    });

    it('SPEC-BANC-119 : l\'historique ne mêle plus deux tests d\'une même SPEC (filtre exact sur cle, images d\'un test)', function () {
      var runs = [run({ id: 'r1', tests: [
        test({ id: 'SPEC-NET-007', nom: 'SPEC-NET-007 : a', categorie: { type: 'spec', groupe: 'G' } }),
        test({ id: 'SPEC-NET-007', nom: 'SPEC-NET-007 : b', categorie: { type: 'spec', groupe: 'G' }, etat: 'echec' }),
        test({ id: 'SPEC-NET-007', nom: 'SPEC-NET-007 : a (variante)', categorie: { type: 'spec', groupe: 'G' } }),
      ] })];
      var lignes = H.construireLignes(runs);
      A.equal(new Set(lignes.map(function (l) { return l.test; })).size, 1, 'précondition : un seul `test` (id) pour les trois');
      A.equal(new Set(lignes.map(function (l) { return l.cle; })).size, 3, 'trois identités distinctes');
      A.equal(H.TYPES_COLONNES.cle, 'exact', 'colonne cle filtrée par égalité');
      A.equal(H.filtrerLignes(lignes, { cle: 'G › SPEC-NET-007 : a' }).length, 1, 'filtre exact : « a » ne ramène pas « a (variante) »');
      var imgs = H.imagesDeTest(lignes, 'G › SPEC-NET-007 : b');
      A.equal(imgs.length, 1, 'images d\'UN test : un passage, pas trois');
      A.equal(imgs[0].etat, 'echec', 'c\'est bien le passage de « b »');
      A.equal(H.imagesDeTest(lignes, 'SPEC-NET-007').length, 3, 'compatibilité : un ancien id reste accepté');
    });

    it('SPEC-BANC-118 : testsConnus() donne une entrée par identité avec son dernier passage', function () {
      var runs = [
        run({ id: 'r1', date: '2026-01-01T00:00:00.000Z', tests: [test({ nom: 'i', categorie: { type: 'integration', groupe: 'integration-x.js' }, etat: 'echec' })] }),
        run({ id: 'r2', date: '2026-01-02T00:00:00.000Z', tests: [test({ nom: 'i', categorie: { type: 'integration', groupe: 'integration-x.js' }, etat: 'reussi' }), test({ nom: 'j' })] }),
      ];
      var connus = H.testsConnus(H.construireLignes(runs));
      A.equal(connus.length, 2, 'deux tests distincts');
      var i = connus.filter(function (c) { return c.nom === 'i'; })[0];
      A.equal(i.runs, 2, 'deux passages');
      A.equal(i.echecs, 1, 'un échec');
      A.equal(i.dernier.run, 'r2', 'dernier passage = le plus récent');
      A.equal(i.dernier.etat, 'reussi', 'son état');
      A.equal(i.type, 'integration', 'type conservé (le banc l\'affiche « hors de ce banc »)');
    });

    it('SPEC-BANC-120 : construireLignes() ne lève jamais sur des données inattendues', function () {
      var lignes = null, erreur = null;
      try {
        lignes = H.construireLignes([null, 3, 'x', { id: 'r', tests: 'pas une liste' }, { id: 'r2', tests: [null, 4, [], {
          nom: 'ok', categorie: 'pas un objet', domaines: 'RENDU', specs: [null, 'S-1', { x: 1 }], captures: [null, 3, { role: 'fin', image: 'a.jpg' }],
          erreur: '\u001b[31mrouge\u001b[0m fin', duree_ms: 'lent', fiche: 'texte', etat: 42,
        }, { /* ni nom ni id */ }] }]);
      } catch (e) { erreur = e; }
      A.ok(!erreur, 'aucune exception — ' + (erreur && erreur.message));
      A.equal(lignes.length, 2, 'seuls les deux tests-objets donnent une ligne');
      var l = lignes[0];
      A.deep(l.domaines, [], 'liste non-tableau → []');
      A.deep(l.specs, ['S-1', '{"x":1}'], 'éléments nuls retirés, objets rendus en texte');
      A.equal(l.nb_captures, 1, 'captures non-objets ignorées');
      A.equal(l.erreur, 'rouge fin', 'séquences ANSI retirées');
      A.equal(l.duree_ms, null, 'durée non numérique → null');
      A.equal(l.fiche, null, 'fiche non-objet → null');
      A.equal(l.etat, '42', 'état rendu en texte');
      A.equal(lignes[1].nom, '(sans nom)', 'un test sans nom ni id reste affichable');
      A.ok(H.effectifsToutesEnum(lignes) && H.trierLignes(lignes, [{ champ: 'duree_ms', ordre: 'asc' }]).length === 2, 'effectifs et tri passent sur ces lignes');
    });

    it('SPEC-BANC-120 : runsUnifies() et listerCahiers() ignorent un cahier local malformé au lieu de tout faire tomber', function () {
      var base = path.join(RACINE, 'tests', '_tmp_malformes_' + Date.now());
      var reg = path.join(base, 'registre'), res = path.join(base, 'resultats');
      fs.mkdirSync(path.join(reg, REG.DOSSIER_ENTREES_REL), { recursive: true });
      function cahier(nom, contenu) { fs.mkdirSync(path.join(res, nom), { recursive: true }); fs.writeFileSync(path.join(res, nom, 'resultats.json'), contenu); }
      try {
        cahier('a_null', 'null');
        cahier('b_nombre', '42');
        cahier('c_tests_objet', JSON.stringify({ campagne: { preset: 'p' }, tests: { pas: 'une liste' } }));
        cahier('d_tests_nuls', JSON.stringify({ campagne: 'x', tests: [null, 3, { nom: 'survivant', captures: [null] }] }));
        cahier('e_invalide', '{ pas du json');
        var runs = null, erreur = null;
        try { runs = REG.runsUnifies({ dossierRegistre: reg, racineResultats: res }); } catch (e) { erreur = e; }
        A.ok(!erreur, 'runsUnifies ne lève pas — ' + (erreur && erreur.message));
        var tests = [].concat.apply([], runs.map(function (r) { return r.tests; }));
        A.deep(tests.map(function (t) { return t.nom; }), ['survivant'], 'seul le test exploitable survit');
        var CAH = require(path.join(RACINE, 'tools', 'cahier.js'));
        var liste = null; erreur = null;
        try { liste = CAH.listerCahiers(res); } catch (e) { erreur = e; }
        A.ok(!erreur, 'listerCahiers ne lève pas — ' + (erreur && erreur.message));
        A.ok(liste.every(function (c) { return c.dossier !== 'a_null' && c.dossier !== 'b_nombre'; }), '« null » et « 42 » ne sont pas des cahiers');
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });

    it('SPEC-BANC-120 : la pagination est bornée et ramène une page hors limites à la dernière', function () {
      var lignes = []; for (var i = 0; i < 1200; i++) lignes.push({ n: i });
      var p = H.paginer(lignes, 1, 1000000);
      A.equal(p.taille, H.TAILLE_PAGE_MAX, 'taille bornée à ' + H.TAILLE_PAGE_MAX);
      A.equal(p.lignes.length, H.TAILLE_PAGE_MAX, 'jamais plus d\'une page bornée');
      var q = H.paginer(lignes, 99, 500);
      A.equal(q.page, 3, 'page 99 de 3 → page 3');
      A.equal(q.lignes.length, 200, 'les 200 dernières lignes');
      A.equal(H.paginer([], 5, 50).page, 1, 'aucune ligne : page 1');
    });

    it('SPEC-BANC-120 : l\'export CSV/HTML est produit côté serveur, colonnes demandées, libellés affichés, valeurs échappées', function () {
      var lignes = H.construireLignes([run({ tests: [test({ nom: 'a, "b"\nc', domaines: ['X', 'Y'], etat: 'echec' })] })]);
      var csv = H.exporterCSV(lignes, ['nom', 'domaines', 'etat', 'inconnue']);
      var l = csv.replace(/^﻿/, '').split('\n');
      A.equal(l[0], 'Nom du test,Domaines,État', 'en-tête : libellés de l\'interface, colonne inconnue ignorée');
      A.ok(csv.indexOf('"a, ""b""\nc"') >= 0, 'virgule, guillemet et saut de ligne échappés');
      A.ok(csv.indexOf('X, Y') >= 0, 'liste jointe');
      var html = H.exporterHTMLVue(H.construireLignes([run({ tests: [test({ nom: '<script>x</script>' })] })]), ['nom']);
      A.ok(html.indexOf('<script>x') < 0 && html.indexOf('&lt;script&gt;x') >= 0, 'HTML échappé');
    });

    it('SPEC-BANC-122 : une colonne demandée qui est une propriété héritée (constructor, __proto__…) est ignorée partout', function () {
      var lignes = H.construireLignes([run({ tests: [test({ nom: 'a' }), test({ nom: 'b' })] })]);
      var csv = H.exporterCSV(lignes, ['__proto__', 'constructor', 'toString', 'hasOwnProperty']);
      A.equal(csv.replace(/^﻿/, '').split('\n')[0], 'Début run,Commit,Préréglage,Nom du test,Type,Durée (ms),État,Erreur', 'colonnes inconnues → colonnes par défaut, jamais une fonction en en-tête');
      A.ok(csv.indexOf('function') < 0, 'aucun code source de fonction exporté');
      A.equal(H.estColonne('constructor'), false, 'constructor n\'est pas une colonne');
      A.equal(H.estColonne('nom'), true, 'nom en est une');
      A.equal(H.filtrerLignes(lignes, JSON.parse('{"constructor":"x","__proto__":{"a":1},"toString":"y"}')).length, 2, 'filtre sur propriétés héritées : ignoré');
      A.deep(H.trierLignes(lignes, [{ champ: 'constructor', ordre: 'desc' }]).map(function (l) { return l.nom; }), ['a', 'b'], 'tri sur propriété héritée : ignoré');
    });

    it('SPEC-BANC-122 : l\'export CSV neutralise les formules de tableur (= + - @), jamais les nombres', function () {
      A.equal(H.celluleCsv('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"', '= préfixé et cellule citée');
      A.equal(H.celluleCsv('+1+1'), '"\'+1+1"', '+ préfixé');
      A.equal(H.celluleCsv('@SUM(A1)'), '"\'@SUM(A1)"', '@ préfixé');
      A.equal(H.celluleCsv('-cmd|calc'), '"\'-cmd|calc"', '- suivi de texte préfixé');
      A.equal(H.celluleCsv('\tx'), '"\'\tx"', 'tabulation de tête préfixée');
      A.equal(H.celluleCsv('-12.5'), '-12.5', 'nombre négatif intact');
      A.equal(H.celluleCsv('12'), '12', 'nombre intact');
      A.equal(H.celluleCsv('texte'), 'texte', 'texte ordinaire intact');
      var m = H.morceauxExport(['nom'], 'csv', 1);
      A.equal(m.ligne({ nom: '=1+1' }), '"\'=1+1"\n', 'les morceaux d\'export (serveur) passent par la même neutralisation');
    });

    // ── faux DOM minimal, SYNCHRONE, pour exécuter tests/historique.js sous Node ──
    function fauxDom(reponses) {
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
      vm.runInContext(lire('tests/historique.js'), ctx, { filename: 'historique.js' });
      return { H: ctx.MC_HISTORIQUE, obtenir: obtenir, appels: appels };
    }
    function filtreDeLUrl(url) { return JSON.parse(new URLSearchParams(url.split('?')[1]).get('filtre') || '{}'); }

    it('SPEC-BANC-122 : après « historique (N) », « Tous les runs » et une réouverture simple lèvent le filtre du test, qui reste visible', function () {
      var d = fauxDom(function () { return { lignes: [], total: 0, page: 1, taille: 50, effectifs: {}, images: [] }; });
      d.H.ouvrir({ cle: 'G › un test', nom: 'un test' });
      A.equal(d.H.etat.filtresColonnes.cle, 'G › un test', 'vue filtrée sur ce test');
      A.ok(d.H.etat.colonnes.indexOf('cle') >= 0, 'la colonne du filtre (Identité) est visible — on voit et on peut effacer ce qui filtre');
      d.obtenir('__rapide-tous').click();
      A.equal(d.H.etat.filtresColonnes.cle, undefined, '« Tous les runs » lève le filtre du test');
      A.deep(filtreDeLUrl(d.appels[d.appels.length - 1]), {}, 'la requête envoyée n\'est plus filtrée');
      d.H.ouvrir({ cle: 'G › un test' });
      d.H.fermer();
      d.H.ouvrir();
      A.equal(d.H.etat.filtresColonnes.cle, undefined, 'rouvrir l\'historique sans test lève aussi le filtre');
      A.deep(filtreDeLUrl(d.appels[d.appels.length - 1]), {}, 'requête de réouverture non filtrée');
    });

    it('SPEC-BANC-121 : le panneau du test montre tous ses passages (récent d\'abord), messages complets et captures du registre ou du cahier', function () {
      var images = [
        { run: 'r1', debut_run: '2026-01-01T00:00:00.000Z', etat: 'reussi', duree_ms: 10, inscrit: true, preset: 'pr', commit_court: 'aaa', dossierCahier: 'c1', cle: 'G › t', nom: 't', captures: [{ role: 'debut', libelle: 'début', image: 'a'.repeat(40) + '.jpg' }] },
        { run: 'r2', debut_run: '2026-01-02T00:00:00.000Z', etat: 'echec', duree_ms: 20, inscrit: false, preset: 'commit', commit_court: 'bbb', dossierCahier: 'c2', erreur: 'x'.repeat(5000), cle: 'G › t', nom: 't', captures: [{ role: 'fin', libelle: 'fin', image: '0002-fin.jpg' }, { role: 'triplet', libelle: 'z', image: null }] },
      ];
      var d = fauxDom(function (url) { return /\/images\?/.test(url) ? { images: images } : { lignes: [], total: 0, effectifs: {} }; });
      d.H.ouvrirTest({ cle: 'G › t', nom: 't', run: 'r1' });
      var p = d.obtenir('hist-panneau-test');
      A.equal(p.hidden, false, 'panneau ouvert');
      A.ok(d.appels.some(function (u) { return u.indexOf('/tests/historique/images?test=G+%E2%80%BA+t') === 0; }), 'demande les passages de CETTE identité : ' + d.appels.join(' | '));
      var passages = p.tous(function (n) { return n.tagName === 'LI'; });
      A.equal(passages.length, 2, 'deux passages');
      A.ok(/2026-01-02/.test(passages[0].textContent) && /echec/.test(passages[0].textContent), 'le plus récent d\'abord');
      A.ok(/hist-pt-courant/.test(passages[1].className), 'le passage cliqué (r1) est mis en avant');
      var imgs = p.tous(function (n) { return n.tagName === 'IMG'; }).map(function (n) { return n.attrs.src; });
      A.deep(imgs, ['/tests/resultats/c2/captures/0002-fin.jpg', '/tests/registre/images/' + 'a'.repeat(40) + '.jpg'], 'capture locale sous le cahier, capture inscrite sous le registre');
      A.ok(/1000 caractères de plus/.test(p.textContent) && p.tous(function (n) { return n.tagName === 'BUTTON' && /tout afficher/.test(n.textContent); }).length === 1, 'long message tronqué avec « tout afficher »');
      A.ok(/1 image\(s\) de triplet non conservée/.test(p.textContent), 'image de triplet absente du registre signalée, pas « manquante »');
      var liens = p.tous(function (n) { return n.tagName === 'A'; }).map(function (n) { return n.attrs.href; });
      A.ok(liens.indexOf('/tests/resultats/c1/rapport.html') >= 0, 'lien vers le cahier du passage');
    });

    it('SPEC-BANC-117 : tests/index.html signale une liste de fichiers de tests absente au lieu d\'un catalogue vide', function () {
      var page = lire('tests/index.html');
      A.ok(/if \(!window\.MC_FICHIERS_TESTS\)/.test(page) && /id="erreur-catalogue"/.test(page) && /role="alert"/.test(page), 'bandeau d\'erreur visible prévu');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
