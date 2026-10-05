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
    function fauxDom(reponses, options) {
      var opts = options || {};
      var stockage = opts.stockage || {};
      var minuteries = [];
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
        Object.defineProperty(n, 'innerHTML', { set: function (v) { n.children = []; n._texte = undefined; n._html = String(v); }, get: function () { return n._html || ''; } });
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
      var appels = [], ecritures = [];
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
        // minuteries factices : jamais déclenchées d'elles-mêmes, le test les compte et les fait « sonner » (lecture automatique, clignotement)
        setInterval: function (f, ms) { var m = { f: f, ms: ms, actif: true }; minuteries.push(m); return m; },
        clearInterval: function (m) { if (m) m.actif = false; },
        CustomEvent: function (t, o) { this.type = t; this.detail = o && o.detail; },
        // stockage indisponible (navigation privée, données bloquées) : l'accès LÈVE, la page doit rester utilisable
        localStorage: {
          getItem: function (k) { if (opts.stockageErreur) throw new Error('stockage bloqué'); return Object.prototype.hasOwnProperty.call(stockage, k) ? stockage[k] : null; },
          setItem: function (k, v) { if (opts.stockageErreur) throw new Error('stockage bloqué'); stockage[k] = String(v); },
        },
        fetch: function (url, init) {
          appels.push(url);
          if (init) ecritures.push({ url: url, methode: init.method, corps: init.body ? JSON.parse(init.body) : null });
          var rep = reponses(url, init);
          // une réponse peut être { __statut: 409, __corps: {…} } pour simuler un refus du serveur
          var statut = rep && rep.__statut ? rep.__statut : 200;
          var corps = rep && rep.__statut ? rep.__corps : rep;
          return new SyncP(true, { ok: statut < 400, status: statut, text: function () { return new SyncP(true, JSON.stringify(corps)); } });
        },
      });
      ctx.window = ctx;
      vm.runInContext(lire('tests/historique-vues.js'), ctx, { filename: 'historique-vues.js' });
      vm.runInContext(lire('tests/historique.js'), ctx, { filename: 'historique.js' });
      return { H: ctx.MC_HISTORIQUE, ctx: ctx, obtenir: obtenir, appels: appels, ecritures: ecritures, minuteries: minuteries, stockage: stockage, noeud: noeud };
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

    // ══════════════════════════════════════════════════════════════════════
    // Interface du banc, exécutée dans le faux DOM (tests/historique.js tel quel)
    // — le comportement DOM réel est prouvé par tests/e2e-banc.js (navigateur)
    // ══════════════════════════════════════════════════════════════════════
    var SHA = function (c) { return new Array(41).join(c); };      // 40 caractères hexadécimaux
    function ligneDemo(o) {
      return Object.assign({
        run: 'r1', debut_run: '2026-01-01T00:00:00.000Z', commit: SHA('a'), commit_court: 'aaa', sujet_commit: 'sujet', rang_commit: 1,
        branche: 'master', preset: 'pr', origine: 'pre-push', inscrit: true, test: 'N-1', cle: 'G › t', nom: 't', type: 'unitaire', groupe: 'G',
        domaines: [], specs: [], fonctions: [], etiquettes: [], duree_ms: 10, etat: 'reussi', erreur: null, nb_captures: 0, captures: [],
        dossierCahier: 'c1', motif: null, arbre_modifie: false, interrompu: false,
      }, o);
    }
    function reponsesLignes(lignes, extra) {
      return function (url) {
        if (/\/lignes\?/.test(url)) return { lignes: lignes, total: lignes.length, page: 1, taille: 50, effectifs: {} };
        return extra ? extra(url) : {};
      };
    }
    function enfants(n, pred) { return n.tous(pred); }
    function parClasse(n, classe) { return n.tous(function (c) { return (' ' + c.className + ' ').indexOf(' ' + classe + ' ') >= 0; }); }

    it('SPEC-BANC-029 : le bouton « Historique » de l\'en-tête et le lien « historique » d\'un test ouvrent la MÊME zone, pré-filtrée sur le test dans le second cas', function () {
      var page = lire('tests/index.html');
      A.ok(/<button id="btn-historique">Historique<\/button>/.test(page) && /id="zone-historique" hidden/.test(page), 'l\'en-tête du banc porte le bouton, la zone est cachée par défaut');
      A.ok(/G\.MC_HISTORIQUE\.ouvrir\(\{ cle: cleHistorique\(t\)/.test(lire('tests/banc-ui.js')), 'le lien d\'un test de la sélection appelle MC_HISTORIQUE.ouvrir({ cle })');
      var d = fauxDom(reponsesLignes([ligneDemo({})], function () { return { images: [] }; }));
      var zone = d.obtenir('zone-historique');
      d.obtenir('btn-historique').click();
      A.equal(zone.hidden, false, 'le bouton ouvre la zone');
      A.deep(d.H.etat.filtresColonnes, {}, 'sans filtre de test');
      d.H.fermer();
      A.equal(zone.hidden, true, 'fermée');
      d.H.ouvrir({ cle: 'G › t', nom: 't' });
      A.equal(zone.hidden, false, 'le second chemin ouvre la même zone');
      A.equal(d.H.etat.filtresColonnes.cle, 'G › t', 'pré-filtrée sur ce test');
      A.equal(d.obtenir('hist-panneau-test').hidden, false, 'et son panneau est ouvert');
    });

    it('SPEC-BANC-034 : chaque propriété de la ligne a sa colonne, le sélecteur « Colonnes » les affiche ou masque et le choix survit au rechargement', function () {
      var d = fauxDom(reponsesLignes([ligneDemo({})]));
      var ids = d.H.colonnes.map(function (c) { return c.id; });
      ['run', 'debut_run', 'commit', 'commit_court', 'sujet_commit', 'rang_commit', 'branche', 'preset', 'origine', 'inscrit', 'test', 'nom', 'type', 'groupe',
        'domaines', 'specs', 'fonctions', 'etiquettes', 'fiche', 'debut_test', 'duree_ms', 'etat', 'erreur', 'nb_captures', 'captures'].forEach(function (c) {
        A.ok(ids.indexOf(c) >= 0, 'colonne ' + c);
      });
      d.H.ouvrir();
      var menu = d.obtenir('hist-colonnes-menu');
      var cases = menu.tous(function (n) { return n.tagName === 'INPUT'; });
      A.equal(cases.length, ids.length, 'le sélecteur propose une case par colonne');
      var iDuree = ids.indexOf('duree_ms');
      A.ok(d.H.etat.colonnes.indexOf('duree_ms') >= 0, 'durée affichée par défaut');
      cases[iDuree].checked = false; cases[iDuree].declencher('change');
      A.equal(d.H.etat.colonnes.indexOf('duree_ms'), -1, 'décocher une colonne la retire');
      var entetes = d.obtenir('__thead').tous(function (n) { return n.tagName === 'TH'; }).map(function (n) { return n.textContent; });
      A.ok(entetes.indexOf('Durée (ms)') < 0, 'et l\'en-tête du tableau ne la porte plus : ' + entetes.join('|'));
      var iCaptures = ids.indexOf('nb_captures');
      cases[iCaptures].checked = true; cases[iCaptures].declencher('change');
      A.ok(d.H.etat.colonnes.indexOf('nb_captures') >= 0, 'cocher une colonne l\'ajoute');
      // rechargement de la page (stockage disponible) : même jeu de colonnes
      var d2 = fauxDom(reponsesLignes([]), { stockage: d.stockage });
      A.deep(d2.H.etat.colonnes.slice().sort(), d.H.etat.colonnes.slice().sort(), 'le même jeu de colonnes est restitué');
      A.equal(d2.H.etat.colonnes.indexOf('duree_ms'), -1, 'la colonne masquée le reste');
      // stockage indisponible : la page reste utilisable, colonnes par défaut
      var d3 = fauxDom(reponsesLignes([ligneDemo({})]), { stockageErreur: true });
      A.ok(d3.H.etat.colonnes.length > 0, 'colonnes par défaut sans stockage');
      d3.H.ouvrir();
      var c3 = d3.obtenir('hist-colonnes-menu').tous(function (n) { return n.tagName === 'INPUT'; });
      c3[0].checked = !c3[0].checked; c3[0].declencher('change');   // l'écriture lève : aucune exception ne remonte
      A.equal(d3.obtenir('zone-historique').hidden, false, 'la zone reste ouverte et utilisable');
    });

    it('SPEC-BANC-034 : les colonnes « fiche » et « images » du serveur filtrent, trient et s\'exportent comme un texte', function () {
      var runs = [run({ tests: [test({ nom: 'a', fiche: { teste: 'le mailleur', attendu: '6 faces' }, captures: [{ role: 'debut', libelle: 'début', image: 'a.jpg' }, { role: 'fin', libelle: 'fin', image: 'b.jpg' }] }), test({ nom: 'b', fiche: null })] })];
      var lignes = H.construireLignes(runs);
      A.deep(H.filtrerLignes(lignes, { fiche: 'mailleur' }).map(function (l) { return l.nom; }), ['a'], 'filtre sur la fiche');
      A.deep(H.filtrerLignes(lignes, { captures: 'fin' }).map(function (l) { return l.nom; }), ['a'], 'filtre sur les libellés d\'images');
      A.equal(H.valeurColonne(lignes[0], 'captures'), 'debut:début, fin:fin', 'rôle:libellé, dans l\'ordre');
      var csv = H.exporterCSV(lignes, ['nom', 'fiche', 'captures']);
      A.ok(/le mailleur — 6 faces/.test(csv) && /debut:début, fin:fin/.test(csv), 'et exportées');
    });

    it('SPEC-BANC-039 : un clic sur une ligne ouvre le panneau « test » sur ce test, avec CE run déjà sélectionné (pas le dernier)', function () {
      var l1 = ligneDemo({ run: 'r1', debut_run: '2026-01-01T00:00:00.000Z' }), l2 = ligneDemo({ run: 'r2', debut_run: '2026-01-02T00:00:00.000Z' });
      var passages = [
        { run: 'r1', debut_run: l1.debut_run, etat: 'reussi', inscrit: true, preset: 'pr', commit_court: 'aaa', cle: 'G › t', nom: 't', captures: [] },
        { run: 'r2', debut_run: l2.debut_run, etat: 'echec', inscrit: true, preset: 'pr', commit_court: 'bbb', cle: 'G › t', nom: 't', captures: [] },
      ];
      var d = fauxDom(reponsesLignes([l2, l1], function () { return { images: passages, temoins: {} }; }));
      d.H.ouvrir();
      var lignes = d.obtenir('__tbody').children.filter(function (tr) { return tr.tagName === 'TR'; });
      A.equal(lignes.length, 2, 'deux lignes affichées');
      lignes[1].click();      // le run r1, pas le plus récent
      A.equal(d.obtenir('hist-panneau-test').hidden, false, 'le panneau s\'ouvre');
      A.equal(d.H.panneau.o.run, 'r1', 'positionné sur le run cliqué');
      A.ok(d.appels.some(function (u) { return u.indexOf('/tests/historique/images?test=') === 0; }), 'les passages du test sont demandés');
      var courant = parClasse(d.obtenir('hist-panneau-test'), 'hist-pt-courant');
      A.equal(courant.length, 1, 'un seul passage mis en avant');
      A.equal(courant[0].getAttribute('data-run'), 'r1', 'c\'est celui du run cliqué');
    });

    // ── panneau « test », diaporamas, témoin (SPEC-BANC-046 à 052) ──────────
    function panneauDemo(opts) {
      var o = opts || {};
      var passages = [
        { run: 'p1', debut_run: '2026-01-01T00:00:00.000Z', etat: 'reussi', duree_ms: 10, inscrit: true, preset: 'pr', commit: SHA('1'), commit_court: 'c1c1', sujet_commit: 'un', cle: 'G › t', nom: 't', dossierCahier: 'k1',
          captures: [{ role: 'fin', libelle: 'fin', image: SHA('b') + '.jpg', t_ms: 900 }, { role: 'debut', libelle: 'début', image: SHA('a') + '.jpg', t_ms: 0 }, { role: 'intermediaire', libelle: 'milieu', image: SHA('c') + '.jpg', t_ms: 400 }] },
        { run: 'p2', debut_run: '2026-01-02T00:00:00.000Z', etat: 'echec', duree_ms: 20, inscrit: true, preset: 'pr', commit: SHA('2'), commit_court: 'c2c2', sujet_commit: 'deux', cle: 'G › t', nom: 't', dossierCahier: 'k2',
          captures: [{ role: 'debut', libelle: 'début', image: SHA('d') + '.jpg', t_ms: 0 }, { role: 'fin', libelle: 'fin', image: SHA('e') + '.jpg', t_ms: 900 }] },
        { run: 'p3', debut_run: '2026-01-03T00:00:00.000Z', etat: 'reussi', duree_ms: 30, inscrit: false, preset: 'commit', commit: SHA('3'), commit_court: 'c3c3', sujet_commit: 'trois', cle: 'G › t', nom: 't', dossierCahier: 'k3', arbre_modifie: true, motif: 'avant refonte',
          captures: [{ role: 'debut', libelle: 'début', image: '0001-debut.jpg', t_ms: 0 }, { role: 'intermediaire', libelle: 'milieu', image: '0002-milieu.jpg', t_ms: 400 }, { role: 'fin', libelle: 'fin', image: '0003-fin.jpg', t_ms: 900 }] },
      ];
      var temoins = o.temoins === undefined ? { 'debut|début': { epingle: false, run: 'p2', commit: SHA('2'), commit_court: 'c2c2', image: SHA('d') + '.jpg' } } : o.temoins;
      var d = fauxDom(function (url, init) {
        if (/\/images\?/.test(url)) return { images: passages, temoins: temoins };
        if (/\/registre\/temoin$/.test(url)) return { ok: true };
        return { lignes: [], total: 0, effectifs: {} };
      });
      d.passages = passages;
      d.H.ouvrirTest({ cle: 'G › t', nom: 't', run: 'p3' });
      return d;
    }
    function vignette(d, cleImg, run) {
      return d.obtenir('hist-panneau-test').tous(function (n) { return n.tagName === 'IMG' && n.attrs['data-image'] === cleImg && n.attrs['data-run'] === run; })[0];
    }
    function diapos(d) { return parClasse(d.obtenir('hist-panneau-test'), 'hist-diapo'); }
    function dans(n, classe) { return parClasse(n, classe)[0]; }

    it('SPEC-BANC-046/047 : le panneau d\'un run montre ses images en vignettes FIXES dans l\'ordre du test, et AUCUN diaporama ne s\'ouvre ni ne défile sans clic', function () {
      var d = panneauDemo();
      var li3 = parClasse(d.obtenir('hist-panneau-test'), 'hist-pt-courant')[0];
      var imgs = li3.tous(function (n) { return n.tagName === 'IMG'; }).map(function (n) { return n.attrs['data-image']; });
      A.deep(imgs, ['debut|début', 'intermediaire|milieu', 'fin|fin'], 'début, intermédiaire (par t_ms), fin — l\'ordre du test, pas celui du fichier');
      var li1 = d.obtenir('hist-panneau-test').tous(function (n) { return n.tagName === 'LI' && n.attrs['data-run'] === 'p1'; })[0];
      A.deep(li1.tous(function (n) { return n.tagName === 'IMG'; }).map(function (n) { return n.attrs['data-image']; }), ['debut|début', 'intermediaire|milieu', 'fin|fin'], 'même ordre pour un run dont le fichier les rangeait autrement');
      A.equal(d.obtenir('hist-diapos').hidden, true, 'la zone des diaporamas est cachée');
      A.equal(diapos(d).length, 0, 'aucun diaporama ouvert');
      A.equal(d.minuteries.length, 0, 'aucune minuterie : rien ne défile tout seul');
    });

    it('SPEC-BANC-047/048 : cliquer UNE vignette n\'ouvre que le diaporama de CETTE image, sur le run cliqué ; un run sans cette image garde sa position « pas de capture »', function () {
      var d = panneauDemo();
      vignette(d, 'intermediaire|milieu', 'p3').click();
      var liste = diapos(d);
      A.equal(liste.length, 1, 'un seul diaporama');
      A.equal(liste[0].getAttribute('data-image'), 'intermediaire|milieu', 'celui de l\'image cliquée');
      A.equal(d.obtenir('hist-diapos').hidden, false, 'la zone apparaît');
      var dia = d.H.panneau.diapos[0];
      A.equal(dia.positions.length, 3, 'une position par run du test (3 sur 3)');
      A.deep(dia.positions.map(function (p) { return p.capture ? 'image' : 'pas de capture'; }), ['image', 'pas de capture', 'image'], 'N=2 images sur M=3 runs : le run p2 reste, marqué « pas de capture »');
      A.equal(liste[0].getAttribute('data-run'), 'p3', 'positionné sur le run cliqué');
      A.ok(/c3c3 « trois » · reussi · 30 ms · non inscrit/.test(dans(liste[0], 'hist-diapo-legende').textContent), 'sous l\'image : date, commit + sujet, état, durée, inscrit ou non : ' + dans(liste[0], 'hist-diapo-legende').textContent);
      dans(liste[0], 'hist-diapo-prec').click();
      A.equal(liste[0].getAttribute('data-run'), 'p2', 'reculer : le run sans cette image');
      A.equal(dans(liste[0], 'hist-diapo-vide').hidden, false, 'la case « pas de capture » est visible');
      A.equal(dans(liste[0], 'hist-diapo-image').hidden, true, 'et l\'image masquée');
      // ordre du tri choisi : le serveur reçoit le tri, les diaporamas ouverts sont rechargés dans cet ordre
      var tri = d.obtenir('hist-panneau-test').tous(function (n) { return n.tagName === 'SELECT' && n.attrs.id === 'hist-pt-tri'; })[0];
      tri.value = 'commit'; tri.declencher('change');
      A.ok(/tri=commit/.test(d.appels[d.appels.length - 1]), 'le tri « commit » est demandé : ' + d.appels[d.appels.length - 1]);
      A.equal(d.H.panneau.diapos.length, 1, 'le diaporama ouvert reste ouvert après le changement d\'ordre');
    });

    it('SPEC-BANC-049 et SPEC-BANC-050 : plusieurs diaporamas coexistent, indépendants (flèches, curseur), « synchroniser » les aligne ; la lecture ne démarre que sur le bouton', function () {
      var d = panneauDemo();
      vignette(d, 'debut|début', 'p3').click();
      vignette(d, 'fin|fin', 'p3').click();
      vignette(d, 'debut|début', 'p3').click();   // déjà ouvert : pas de doublon
      var liste = diapos(d);
      A.equal(liste.length, 2, 'deux diaporamas, un par image cliquée');
      var a = liste[0], b = liste[1];
      A.equal(d.minuteries.length, 0, 'la lecture automatique ne démarre pas à l\'ouverture');
      a.declencher('keydown', { key: 'ArrowLeft', preventDefault: function () {} });
      A.equal(a.getAttribute('data-run'), 'p2', 'flèche gauche : un run en arrière');
      A.equal(b.getAttribute('data-run'), 'p3', 'l\'autre diaporama n\'a pas bougé (indépendants)');
      a.declencher('keydown', { key: 'ArrowRight', preventDefault: function () {} });
      A.equal(a.getAttribute('data-run'), 'p3', 'flèche droite : un run en avant');
      var curs = dans(b, 'hist-diapo-curseur');
      curs.value = '0'; curs.declencher('input');
      A.equal(b.getAttribute('data-run'), 'p1', 'le curseur déplacé va directement à ce run');
      A.equal(a.getAttribute('data-run'), 'p3', 'sans toucher l\'autre');
      d.obtenir('hist-diapos-sync').click();
      A.equal(a.getAttribute('data-run'), b.getAttribute('data-run'), 'synchroniser aligne les deux sur le même run');
      // synchronisés : avancer l'un entraîne l'autre
      dans(a, 'hist-diapo-suiv').click();
      A.equal(b.getAttribute('data-run'), a.getAttribute('data-run'), 'ensuite ils avancent ensemble');
      d.obtenir('hist-diapos-sync').click();
      dans(a, 'hist-diapo-prec').click();
      A.notEqual(a.getAttribute('data-run'), b.getAttribute('data-run'), 'désynchronisés, ils redeviennent indépendants');
      // lecture : sur action explicite seulement, vitesse réglable, s'arrête à la fin
      curs = dans(a, 'hist-diapo-curseur'); curs.value = '0'; curs.declencher('input');
      dans(a, 'hist-diapo-lecture').click();
      A.equal(d.minuteries.length, 1, 'le bouton lecture démarre une minuterie');
      A.equal(a.getAttribute('data-lecture'), '1', 'état de lecture visible');
      var m = d.minuteries[0];
      var avant = a.getAttribute('data-run');
      m.f();
      A.notEqual(a.getAttribute('data-run'), avant, 'chaque tic avance d\'un run');
      var vit = dans(a, 'hist-diapo-vitesse'); vit.value = '2'; vit.declencher('change');
      A.equal(m.actif, false, 'changer la vitesse remplace la minuterie');
      A.equal(d.minuteries[d.minuteries.length - 1].ms, 300, 'vitesse « rapide »');
      d.minuteries[d.minuteries.length - 1].f(); d.minuteries[d.minuteries.length - 1].f();
      A.equal(a.getAttribute('data-lecture'), '0', 'arrivée au dernier run : la lecture s\'arrête');
      // fermeture
      dans(a, 'hist-diapo-fermer').click();
      A.equal(diapos(d).length, 1, 'chaque diaporama a son bouton de fermeture');
      dans(b, 'hist-diapo-fermer').click();
      A.equal(d.obtenir('hist-diapos').hidden, true, 'le dernier fermé cache la zone');
    });

    it('SPEC-BANC-051/052 : un témoin reste en vignette fixe au-dessus de chaque diaporama, « comparer » le superpose (rideau ou clignotement), « épingler » le persiste par POST', function () {
      var d = panneauDemo();
      vignette(d, 'debut|début', 'p3').click();
      var dia = diapos(d)[0];
      A.equal(dia.getAttribute('data-temoin'), 'derniere', 'sans épinglage, le témoin est la dernière capture inscrite');
      var t = dans(dia, 'hist-temoin-img');
      A.equal(t.attrs.src, '/tests/registre/images/' + SHA('d') + '.jpg', 'vignette du témoin');
      A.ok(/dernière capture inscrite/.test(dans(dia, 'hist-temoin-legende').textContent), 'dit d\'où il vient');
      vignette(d, 'fin|fin', 'p3').click();
      var autre = diapos(d)[1];
      A.equal(autre.getAttribute('data-temoin'), 'aucun', 'une image sans capture inscrite n\'a pas de témoin');
      // comparer : rideau
      var sup = dans(dia, 'hist-diapo-superpose');
      A.equal(sup.hidden, true, 'pas de superposition avant « comparer »');
      dans(dia, 'hist-diapo-comparer').click();
      A.equal(dia.getAttribute('data-comparer'), 'rideau', 'mode rideau par défaut');
      A.equal(sup.hidden, false, 'le témoin se superpose à l\'image courante');
      A.equal(sup.style.clipPath, 'inset(0 50% 0 0)', 'le rideau révèle la moitié du témoin');
      var rideau = dans(dia, 'hist-diapo-rideau'); rideau.value = '80'; rideau.declencher('input');
      A.equal(sup.style.clipPath, 'inset(0 20% 0 0)', 'glisser le rideau révèle plus du témoin');
      var mode = dans(dia, 'hist-diapo-mode'); mode.value = 'clignotement'; mode.declencher('change');
      A.equal(dia.getAttribute('data-comparer'), 'clignotement', 'mode clignotement');
      var clignote = d.minuteries[d.minuteries.length - 1];
      A.ok(clignote.actif && clignote.ms === 500, 'une minuterie fait clignoter le témoin');
      clignote.f();
      A.equal(sup.style.visibility, 'hidden', 'le témoin disparaît puis réapparaît');
      dans(dia, 'hist-diapo-comparer').click();
      A.equal(clignote.actif, false, 'quitter la comparaison arrête le clignotement');
      A.equal(sup.hidden, true, 'et retire la superposition');
      // épingler : seule une capture inscrite peut l'être
      var epingler = dans(dia, 'hist-diapo-epingler');
      A.equal(epingler.disabled, true, 'le run p3 (cahier local) ne peut pas être épinglé');
      dans(dia, 'hist-diapo-prec').click();      // p2, inscrit
      A.equal(epingler.disabled, false, 'le run p2 (inscrit) le peut');
      epingler.click();
      var ecr = d.ecritures[d.ecritures.length - 1];
      A.equal(ecr.url, '/tests/registre/temoin', 'route POST du témoin');
      A.equal(ecr.methode, 'POST', 'en POST');
      A.deep(ecr.corps, { test: 't', commit: SHA('2'), image: SHA('d') + '.jpg', cle_image: 'debut|début' }, 'cette image de ce run de ce test');
      A.equal(dia.getAttribute('data-temoin'), 'epingle', 'le témoin est désormais marqué épinglé');
      A.ok(/épinglé/.test(dans(dia, 'hist-temoin-legende').textContent), 'et le dit');
    });

    it('SPEC-BANC-052 : un témoin épinglé ressort comme tel dans les diaporamas suivants (rechargés depuis le serveur)', function () {
      var d = panneauDemo({ temoins: { 'debut|début': { epingle: true, run: 'p1', commit: SHA('1'), commit_court: 'c1c1', image: SHA('a') + '.jpg' } } });
      vignette(d, 'debut|début', 'p2').click();
      var dia = diapos(d)[0];
      A.equal(dia.getAttribute('data-temoin'), 'epingle', 'épinglé');
      A.equal(dans(dia, 'hist-temoin-img').attrs.src, '/tests/registre/images/' + SHA('a') + '.jpg', 'l\'image épinglée, pas la dernière');
    });

    // ── inscription au registre depuis l'interface (SPEC-BANC-053 à 058) ────
    function inscription(d, dossier) {
      var el = d.ctx.MC_INSCRIRE.creer(dossier);
      return { racine: el, motif: dans(el, 'hist-inscrire-motif'), bouton: dans(el, 'hist-inscrire-btn'), msg: dans(el, 'hist-inscrire-msg') };
    }
    it('SPEC-BANC-053/054/055 : le composant propose « Inscrire au registre », appelle POST /tests/registre/inscrire avec l\'identifiant du cahier et le motif facultatif', function () {
      var d = fauxDom(function (url, init) {
        if (/\/registre\/inscrire$/.test(url)) return { ok: true, run: 'abc123', commit: SHA('f'), arbre_modifie: false, motif: 'référence avant refonte de l\'eau' };
        return { lignes: [], total: 0, effectifs: {} };
      });
      var i = inscription(d, '2026-10-05_12-00-00_pr');
      A.equal(i.bouton.textContent, 'Inscrire au registre', 'libellé du bouton');
      A.equal(d.ecritures.length, 0, 'rien n\'est écrit avant le clic');
      i.motif.value = 'référence avant refonte de l\'eau';
      i.bouton.click();
      A.equal(d.ecritures.length, 1, 'un appel');
      A.equal(d.ecritures[0].url, '/tests/registre/inscrire', 'la route d\'inscription');
      A.equal(d.ecritures[0].methode, 'POST', 'en POST');
      A.deep(d.ecritures[0].corps, { dossier: '2026-10-05_12-00-00_pr', motif: 'référence avant refonte de l\'eau' }, 'l\'identifiant du cahier et le motif');
      var sansMotif = inscription(d, 'autre');
      sansMotif.bouton.click();
      A.deep(d.ecritures[1].corps, { dossier: 'autre' }, 'le motif est facultatif : absent du corps quand il est vide');
      A.ok(d.H.colonnes.some(function (c) { return c.id === 'motif' && c.defaut; }), 'le motif est une colonne de l\'historique, affichée par défaut (SPEC-BANC-055)');
    });

    it('SPEC-BANC-056 : après l\'inscription le bouton devient « Inscrit ✓ » avec un lien vers l\'historique filtré sur ce run ; une seconde inscription est refusée avec un message clair', function () {
      var essais = 0;
      var d = fauxDom(function (url, init) {
        if (/\/registre\/inscrire$/.test(url)) {
          essais++;
          return essais === 1 ? { ok: true, run: 'abc123', commit: SHA('f'), arbre_modifie: false }
            : { __statut: 409, __corps: { ok: false, motif: 'ce cahier est déjà inscrit au registre — une seule inscription par cahier' } };
        }
        return { lignes: [], total: 0, effectifs: {} };
      });
      var i = inscription(d, 'cahier-1');
      i.bouton.click();
      A.equal(i.bouton.textContent, 'Inscrit ✓', 'le bouton change de libellé');
      var lien = dans(i.racine, 'hist-inscrire-lien');
      A.ok(lien, 'et propose un lien vers l\'historique');
      lien.click();
      A.equal(d.obtenir('zone-historique').hidden, false, 'le lien ouvre la zone Historique');
      A.equal(d.H.etat.filtresColonnes.run, 'abc123', 'filtrée sur CE run');
      A.ok(d.H.etat.colonnes.indexOf('run') >= 0, 'la colonne du filtre est visible');
      i.bouton.click();
      A.equal(d.ecritures.length, 2, 'le second clic interroge le serveur');
      A.ok(/déjà inscrit/.test(i.msg.textContent), 'refus avec un message explicite : ' + i.msg.textContent);
      A.equal(i.bouton.textContent, 'Inscrit ✓', 'le bouton reste « Inscrit ✓ »');
      A.equal(parClasse(i.racine, 'hist-inscrire-lien').length, 1, 'sans créer un second lien');
    });

    it('SPEC-BANC-057/058 : une ligne d\'un cahier local non inscrit porte le bouton, une ligne inscrite non ; un arbre modifié est signalé par un avertissement visible', function () {
      var locale = ligneDemo({ run: 'rl', inscrit: false, dossierCahier: 'cahier-local' });
      var officielle = ligneDemo({ run: 'ro', inscrit: true, dossierCahier: 'cahier-inscrit' });
      var modifiee = ligneDemo({ run: 'rm', inscrit: true, arbre_modifie: true, dossierCahier: 'k', motif: 'essai' });
      var d = fauxDom(reponsesLignes([locale, officielle, modifiee]));
      d.H.ouvrir();
      var tr = d.obtenir('__tbody').children.filter(function (n) { return n.tagName === 'TR'; });
      A.equal(parClasse(tr[0], 'hist-inscrire').length, 1, 'ligne locale : bouton « Inscrire au registre »');
      A.equal(dans(tr[0], 'hist-inscrire').getAttribute('data-dossier'), 'cahier-local', 'qui vise son cahier');
      A.equal(parClasse(tr[1], 'hist-inscrire').length, 0, 'ligne déjà inscrite : pas de bouton');
      A.ok(/arbre-modifie/.test(tr[2].className), 'la ligne d\'un arbre modifié est marquée');
      A.ok(/⚠ arbre modifié/.test(tr[2].textContent), 'avec un avertissement visible : ' + tr[2].textContent);
      A.ok(/essai/.test(tr[2].textContent), 'le motif est affiché dans sa colonne');
      A.ok(!/arbre modifié/.test(tr[1].textContent), 'une ligne propre ne porte pas l\'avertissement');
      // cliquer le bouton d'une ligne n'ouvre pas le panneau du test
      var ouvertAvant = d.obtenir('hist-panneau-test').hidden;
      var cellule = tr[0].children[tr[0].children.length - 1];
      cellule.declencher('click');
      A.equal(d.obtenir('hist-panneau-test').hidden, ouvertAvant, 'le clic dans la cellule d\'action ne déclenche pas l\'ouverture du panneau');
    });

    it('SPEC-BANC-058 : le panneau « test » avertit d\'un arbre modifié et rappelle le motif d\'un passage', function () {
      var d = panneauDemo();
      var li3 = parClasse(d.obtenir('hist-panneau-test'), 'hist-pt-courant')[0];
      A.ok(/arbre modifié/.test(li3.textContent), 'avertissement dans le passage : ' + li3.textContent.slice(0, 200));
      A.ok(/Motif : avant refonte/.test(li3.textContent), 'motif rappelé');
      A.equal(parClasse(li3, 'hist-inscrire').length, 1, 'un passage local non inscrit porte le bouton d\'inscription');
    });

    it('SPEC-BANC-053 : le résumé de fin de campagne du banc ajoute le bouton « Inscrire au registre » à côté du lien du cahier, y compris après un arrêt', function () {
      var ui = lire('tests/banc-ui.js');
      A.ok(/ajouterExports\(conteneur, m\[1\]\); ajouterInscription\(conteneur, m\[1\]\)/.test(ui), 'afficherLienRapport ajoute l\'inscription au même conteneur que le lien');
      A.ok(/G\.MC_INSCRIRE\.creer\(dossier\)/.test(ui), 'avec le composant partagé');
      var envoi = ui.slice(ui.indexOf('await envoyerCahier({'), ui.indexOf('// ── envoi du cahier de test'));
      A.ok(/interrompue: etat\.arretDemande/.test(envoi), 'le cahier est envoyé aussi après un arrêt manuel, marqué interrompu');
      A.ok(/historique-vues\.js', 'historique\.js'/.test(lire('tests/index.html')), 'tests/index.html charge les vues puis l\'interface');
    });

    // ── graphiques (SPEC-BANC-041 à 045) ───────────────────────────────────
    function serieDemo() {
      return [
        { run: 'r1', x: '2026-01-01T00:00:00.000Z', debut_run: '2026-01-01T00:00:00.000Z', commit: SHA('1'), commit_court: 'c1c1', sujet_commit: 'un', etat: { reussi: 2, echec: 1, ignore: 0, avertissement: 0 }, duree_ms: { valeurs: [10, 20, 300], mediane: 20, p95: 300 }, nb_captures: { valeurs: [2, 2, 3], mediane: 2, p95: 3 } },
        { run: 'r2', x: '2026-01-02T00:00:00.000Z', debut_run: '2026-01-02T00:00:00.000Z', commit: SHA('2'), commit_court: 'c2c2', sujet_commit: 'deux', etat: { reussi: 3, echec: 0, ignore: 0, avertissement: 0 }, duree_ms: { valeurs: [15, 25, 100], mediane: 25, p95: 100 }, nb_captures: { valeurs: [2, 2, 3], mediane: 2, p95: 3 } },
      ];
    }
    function graphesDemo(nbTests) {
      var d = fauxDom(function (url) {
        if (/\/series\?/.test(url)) return { serie: serieDemo(), nbTests: nbTests === undefined ? 3 : nbTests, nbRuns: 2 };
        if (/\/matrice\?/.test(url)) return { runs: [{ run: 'r1', x: 'a', commit_court: 'c1c1' }, { run: 'r2', x: 'b', commit_court: 'c2c2' }], tests: [{ cle: 'G › a', nom: 'a', echecs: 1 }, { cle: 'G › b', nom: 'b', echecs: 0 }], cellules: { 'G › a': { r1: 'echec', r2: 'reussi' }, 'G › b': { r1: 'reussi', r2: 'reussi' } }, tronque: { tests: false, runs: false }, totalTests: 2, totalRuns: 2 };
        return { lignes: [], total: 0, effectifs: {} };
      });
      d.obtenir('hist-graphes').hidden = true;      // comme dans tests/index.html
      d.H.ouvrir();
      d.obtenir('hist-graphes-btn').click();
      return d;
    }
    function dernierAppel(d, morceau) { return d.appels.filter(function (u) { return u.indexOf(morceau) >= 0; }).pop(); }
    function figures(d) { return parClasse(d.obtenir('hist-gr-corps'), 'hist-fig'); }
    function svgDe(fig) { return parClasse(fig, 'hist-fig-svg')[0]._html; }

    it('SPEC-BANC-041 : les cases à cocher choisissent les propriétés tracées, l\'axe X choisit horodatage ou commit', function () {
      var d = graphesDemo();
      A.equal(d.obtenir('hist-graphes').hidden, false, 'le bouton « Graphiques » ouvre la zone');
      var u = dernierAppel(d, '/tests/historique/series?');
      A.ok(/props=etat/.test(u) && /x=debut_run/.test(u), 'par défaut : l\'état, par ordre de lancement : ' + u);
      A.deep(figures(d).map(function (f) { return f.getAttribute('data-prop'); }), ['etat'], 'une figure pour l\'état');
      var cases = d.obtenir('hist-graphes').tous(function (n) { return n.tagName === 'INPUT' && n.attrs.type === 'checkbox' && n.attrs['data-prop']; });
      var duree = cases.filter(function (c) { return c.attrs['data-prop'] === 'duree_ms'; })[0];
      duree.checked = true; duree.declencher('change');
      A.ok(/props=etat%2Cduree_ms/.test(dernierAppel(d, '/series?')), 'cocher la durée la demande : ' + dernierAppel(d, '/series?'));
      A.deep(figures(d).map(function (f) { return f.getAttribute('data-prop'); }), ['etat', 'duree_ms'], 'sa courbe apparaît');
      duree.checked = false; duree.declencher('change');
      A.deep(figures(d).map(function (f) { return f.getAttribute('data-prop'); }), ['etat'], 'la décocher la retire');
      var radios = d.obtenir('hist-graphes').tous(function (n) { return n.tagName === 'INPUT' && n.attrs.type === 'radio'; });
      var commit = radios.filter(function (r) { return r.attrs['data-axe'] === 'rang_commit'; })[0];
      commit.checked = true; commit.declencher('change');
      A.ok(/x=rang_commit/.test(dernierAppel(d, '/series?')), 'l\'axe commit est demandé au serveur (rang topologique) : ' + dernierAppel(d, '/series?'));
    });

    it('SPEC-BANC-042 : plusieurs tests donnent des barres empilées par état, un seul test une bande de pastilles', function () {
      var d = graphesDemo(3);
      A.ok(/data-graphe="etat-barres"/.test(svgDe(figures(d)[0])), 'plusieurs tests : barres empilées');
      var d1 = graphesDemo(1);
      var svg = svgDe(figures(d1)[0]);
      A.ok(/data-graphe="etat-pastilles"/.test(svg), 'un seul test : pastilles');
      A.equal((svg.match(/<circle/g) || []).length, 2, 'une pastille par run filtré');
      A.ok(/fill="#f85149"/.test(svg) && /fill="#3fb950"/.test(svg), 'rouge pour l\'échec, vert pour la réussite');
    });

    it('SPEC-BANC-043 : la durée se trace en médiane et p95 (plusieurs tests) ou valeur brute (un test), avec le seuil « lent » en pointillés', function () {
      function avecDuree(nb) {
        var d = graphesDemo(nb);
        var c = d.obtenir('hist-graphes').tous(function (n) { return n.attrs['data-prop'] === 'duree_ms' && n.tagName === 'INPUT'; })[0];
        c.checked = true; c.declencher('change');
        return svgDe(figures(d).filter(function (f) { return f.getAttribute('data-prop') === 'duree_ms'; })[0]);
      }
      var plusieurs = avecDuree(3);
      A.ok(/courbe-mediane/.test(plusieurs) && /courbe-p95/.test(plusieurs), 'plusieurs tests : médiane et p95');
      var seul = avecDuree(1);
      A.ok(/courbe-valeur/.test(seul) && !/courbe-p95/.test(seul), 'un seul test : valeur brute');
      A.ok(/class="seuil-lent"[^>]*stroke-dasharray="6 4"[^>]*data-valeur="8000"/.test(plusieurs), 'seuil lent (8 s par défaut) en pointillés');
    });

    it('SPEC-BANC-044 : la vue matrice demande tests × runs au serveur et trace une grille colorée', function () {
      var d = graphesDemo();
      var m = d.obtenir('hist-graphes').tous(function (n) { return n.tagName === 'INPUT' && n.attrs.id === 'hist-gr-matrice'; })[0];
      m.checked = true; m.declencher('change');
      A.ok(/\/tests\/historique\/matrice\?/.test(dernierAppel(d, '/matrice?')), 'route matrice');
      var svg = svgDe(figures(d)[0]);
      A.ok(/data-graphe="matrice" data-colonnes="2" data-lignes="2"/.test(svg), 'grille 2 × 2');
      A.equal((svg.match(/<rect class="cel/g) || []).length, 4, 'une cellule par test et par run');
      A.ok(/<rect class="cel etat-echec"[^>]*fill="#f85149"/.test(svg), 'colorée par état');
    });

    it('SPEC-BANC-045 : le survol d\'un point affiche une infobulle, un clic filtre le tableau sur ce run, et les graphiques suivent les filtres du tableau', function () {
      var d = graphesDemo();
      var corps = d.obtenir('hist-gr-corps');
      var point = d.noeud('circle'); point.setAttribute('data-run', 'r2'); point.setAttribute('data-tip', 'run r2 · commit c2c2 « deux » · 2026-01-02 00:00 · 3 réussis');
      corps.declencher('mouseover', { target: point, clientX: 100, clientY: 50 });
      var tip = d.obtenir('hist-infobulle');
      A.equal(tip.hidden, false, 'infobulle visible');
      A.ok(/run r2/.test(tip.textContent) && /c2c2/.test(tip.textContent) && /2026-01-02/.test(tip.textContent), 'run, commit, date, valeur : ' + tip.textContent);
      corps.declencher('mouseleave', {});
      A.equal(tip.hidden, true, 'elle disparaît');
      corps.declencher('click', { target: point });
      A.equal(d.H.etat.filtresColonnes.run, 'r2', 'un clic filtre le tableau sur le run');
      var u = dernierAppel(d, '/tests/historique/lignes?');
      A.equal(filtreDeLUrl(u).run, 'r2', 'la requête du tableau porte le filtre');
      A.equal(filtreDeLUrl(dernierAppel(d, '/series?')).run, undefined, 'le graphique, lui, garde tous les runs (il suit les AUTRES filtres)');
      // un filtre du tableau met à jour les graphiques sans rechargement de page
      var nSeries = d.appels.filter(function (x) { return x.indexOf('/series?') >= 0; }).length;
      d.H.ouvrir({ cle: 'G › t', nom: 't' });
      A.ok(d.appels.filter(function (x) { return x.indexOf('/series?') >= 0; }).length > nSeries, 'changer le filtre redemande la série');
      A.equal(filtreDeLUrl(dernierAppel(d, '/series?')).cle, 'G › t', 'avec le nouveau filtre');
    });

    it('SPEC-BANC-117 : tests/index.html signale une liste de fichiers de tests absente au lieu d\'un catalogue vide', function () {
      var page = lire('tests/index.html');
      A.ok(/if \(!window\.MC_FICHIERS_TESTS\)/.test(page) && /id="erreur-catalogue"/.test(page) && /role="alert"/.test(page), 'bandeau d\'erreur visible prévu');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
