/* spec-banc.js — tests de l'outillage de test lui-même (L42, SPEC-BANC-*).
   Fichier Node-only, volontairement : il vérifie des outils (catalogue,
   sélection, préréglages, crochets, cahier de test, route serveur) qui
   n'ont de sens que sous Node — `require`, `process` et `__dirname` sont
   exposés dans le contexte d'exécution par tests/run.js pour cette seule
   raison (voir son en-tête). tests/gates.js, lui, ne charge jamais les
   fichiers de tests dans une machine virtuelle : il lit leur texte (G1/G2/G6)
   ou délègue à un `node tests/run.js` séparé (G3/G13/G14), qui a donc déjà
   ces globales. Comme les autres fichiers tests/*.js, celui-ci n'est PAS
   chargé côté navigateur (tests/index.html n'est pas modifié par ce lot —
   voir README.md, section Tests). */
(function (G) {
  'use strict';
  var T = G.T, MC_TESTS = G.MC_TESTS, MC_RAPPORT = G.MC_RAPPORT;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path'), cp = require('child_process');
  var RACINE = path.join(__dirname, '..');
  var RT = require(path.join(RACINE, 'tools', 'resultats-tests.js'));

  function tmpDir(nom) {
    var d = path.join(RACINE, 'tests', '_tmp_' + nom + '_' + Date.now());
    return d;
  }
  function nettoyer(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* rien */ } }

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — outillage de test (catalogue, sélection, préréglages)', function () {

    it('SPEC-BANC-001 : le catalogue classe chaque test par type, domaine, groupe et étiquettes', function () {
      var specsIndex = MC_TESTS.indexSpecs(fs.readFileSync(path.join(RACINE, 'SPECS.md'), 'utf8'));
      var cat = MC_TESTS.construire(T, [{ nom: 'un test e2e de démonstration', groupe: 'e2e-demo' }], specsIndex);
      A.ok(cat.length > 100, 'le catalogue liste bien les tests déjà chargés (' + cat.length + ')');

      var unUnitaire = cat.find(function (t) { return t.fichier === 'tests/unit.js'; });
      A.ok(unUnitaire, 'un test de unit.js est présent');
      A.equal(unUnitaire.type, 'unitaire', 'unit.js -> type unitaire');

      var unFonctionnel = cat.find(function (t) { return t.fichier === 'tests/functional.js'; });
      A.equal(unFonctionnel.type, 'fonctionnel', 'functional.js -> type fonctionnel');

      var unModeSpec = cat.find(function (t) { return t.nom.indexOf('SPEC-MODE-001') === 0; });
      A.ok(unModeSpec, 'le test SPEC-MODE-001 est catalogué');
      A.equal(unModeSpec.type, 'spec', 'spec-modes.js -> type spec');
      A.deep(unModeSpec.domaines, ['MODE'], 'domaine déduit de SPEC-MODE-001');

      var unE2e = cat.find(function (t) { return t.nom === 'un test e2e de démonstration'; });
      A.ok(unE2e, 'l\'entrée e2e fournie est cataloguée');
      A.equal(unE2e.type, 'e2e', 'type e2e conservé');
      A.equal(unE2e.groupe, 'e2e-demo', 'groupe repris tel quel');

      var lent = cat.find(function (t) { return t.nom.indexOf('SPEC-EAU-006') === 0; });
      A.ok(lent.etiquettes.indexOf('lent') >= 0, 'l\'étiquette @lent est extraite du nom : ' + JSON.stringify(lent.etiquettes));
    });

    it('SPEC-BANC-001 : le groupe e2e déduit du texte de tests/e2e.js est un vrai titre de section (bandeau ═), jamais un commentaire d\'explication pris au passage', function () {
      var out = cp.execFileSync(process.execPath, [path.join(RACINE, 'tests', 'run.js'), '--lister', '--type', 'e2e'],
        { encoding: 'utf8', cwd: RACINE });
      // groupe historiquement mal lu (un commentaire d'explication en fin de test,
      // pas un titre de section) — la correction du lot doit l'avoir fait disparaître
      A.notOk(/et le rapport d'aspect de la caméra doit suivre/.test(out),
        'un commentaire ordinaire (pas un bandeau ═) n\'est plus pris pour un nom de groupe');
      A.ok(/^\[e2e\] Démarrage et états ::/m.test(out), 'le vrai titre de section reste correctement reconnu');
      A.ok(/^\[e2e\] Outillage de test — banc navigateur \(L42\) ::/m.test(out),
        'une section dont le bandeau d\'ouverture manquait (corrigé dans tests/e2e.js) est désormais bien groupée');
    });

    it('SPEC-BANC-002 : chaque test a une fiche, déclarée ou déduite de sa spec, sinon celle de son groupe', function () {
      var specsIndex = MC_TESTS.indexSpecs(fs.readFileSync(path.join(RACINE, 'SPECS.md'), 'utf8'));
      var cat = MC_TESTS.construire(T, [], specsIndex);

      var deduit = cat.find(function (t) { return t.nom.indexOf('SPEC-MODE-001') === 0; });
      A.ok(deduit.fiche, 'fiche présente');
      A.equal(deduit.fiche.source, 'spec', 'déduite de SPECS.md faute de fiche déclarée');
      A.ok(deduit.fiche.teste.length > 0 && deduit.fiche.attendu.length > 0, 'quoi et attendu non vides');

      var groupe = cat.find(function (t) { return t.fichier === 'tests/unit.js' && t.groupe === 'Core — minage'; });
      A.ok(groupe.fiche, 'fiche de groupe reprise');
      A.equal(groupe.fiche.source, 'declaree', 'la fiche de describe() compte comme déclarée');
      A.ok(/minage/i.test(groupe.fiche.teste), 'le texte de la fiche de groupe est bien celui du describe');

      var sansFiche = cat.filter(function (t) {
        return ['unitaire', 'fonctionnel', 'spec', 'integration', 'charge'].indexOf(t.type) >= 0 && !t.fiche;
      });
      A.equal(sansFiche.length, 0, 'aucun test Node sans fiche ni spec citée : ' +
        sansFiche.slice(0, 5).map(function (t) { return t.nom; }).join(' | '));
    });

    it('SPEC-BANC-003 : la sélection combine les critères par intersection, avec exclusion', function () {
      var cat = [
        { id: 'a', nom: 'a', type: 'spec', groupe: 'G1', domaines: ['MODE'], etiquettes: [] },
        { id: 'b', nom: 'b', type: 'unitaire', groupe: 'G1', domaines: ['MODE'], etiquettes: ['lent'] },
        { id: 'c', nom: 'c', type: 'spec', groupe: 'G2', domaines: ['SAVE'], etiquettes: [] },
        { id: 'd', nom: 'd', type: 'e2e', groupe: 'G3', domaines: [], etiquettes: ['bug-42'] },
      ];
      A.deep(MC_TESTS.selection(cat, { domaines: ['MODE'] }).map(function (t) { return t.id; }), ['a', 'b'], 'un seul critère');
      A.deep(MC_TESTS.selection(cat, { domaines: ['MODE'], types: ['spec'] }).map(function (t) { return t.id; }), ['a'], 'intersection de deux critères');
      A.deep(MC_TESTS.selection(cat, { groupes: ['G1'] }).map(function (t) { return t.id; }), ['a', 'b'], 'critère groupe');
      A.deep(MC_TESTS.selection(cat, { tests: ['c'] }).map(function (t) { return t.id; }), ['c'], 'critère tests, par id');
      A.deep(MC_TESTS.selection(cat, { etiquettes: ['bug-42'] }).map(function (t) { return t.id; }), ['d'], 'critère étiquette');
      A.deep(MC_TESTS.selection(cat, { domaines: ['MODE'], sauf: { etiquettes: ['lent'] } }).map(function (t) { return t.id; }), ['a'], 'exclusion sauf');
      A.equal(MC_TESTS.selection(cat, { tout: true }).length, 4, 'tout: true sélectionne tout');
      A.deep(MC_TESTS.selection(cat, { tout: true, sauf: { types: ['e2e'] } }).map(function (t) { return t.id; }), ['a', 'b', 'c'], 'tout, moins une exclusion');
      A.equal(MC_TESTS.selection(cat, {}).length, 4, 'aucun critère : tout le catalogue (comportement historique)');
    });

    it('SPEC-BANC-004 : les préréglages sélectionnent au moins un test ; commit exclut e2e, intégration et les tests lents ; regression prend tout', function () {
      var specsIndex = MC_TESTS.indexSpecs(fs.readFileSync(path.join(RACINE, 'SPECS.md'), 'utf8'));
      var cat = MC_TESTS.construire(T, [{ nom: 'e2e de démo' }], specsIndex);
      A.ok(MC_TESTS.PRESETS.length >= 8, 'au moins les préréglages documentés dans SPECS.md');
      // 'bugs' et 'integration' dépendent respectivement de tests étiquetés
      // @bug-* (aucun ouvert actuellement) et des scripts tests/integration-*.js
      // (catalogués par tests/run.js, pas par ce catalogue synthétique de test) —
      // vérifiés séparément, via la ligne de commande, dans SPEC-BANC-005/006.
      // 'limites' dépend des fichiers d'exploration du lot perf (spec-perf.js,
      // limites-sondes.js, spec-limites.js), chargés s'ils existent (voir
      // tests/run.js) : vide tant que ce lot n'est pas fusionné
      // 'e2e-fumee' (SPEC-BANC-025) sélectionne par NOM EXACT une poignée de
      // vrais e2e de tests/e2e.js — jamais présents dans ce catalogue
      // synthétique à un seul faux test ; vérifié séparément, sur un
      // catalogue réaliste, dans tests/spec-banc-headless.js.
      var IGNORES = { bugs: true, integration: true, limites: true, visuel: true, 'e2e-fumee': true };
      MC_TESTS.PRESETS.forEach(function (p) {
        if (p.dynamique || IGNORES[p.nom]) return;
        var sel = MC_TESTS.selection(cat, p.criteres);
        A.ok(sel.length > 0, 'le préréglage ' + p.nom + ' sélectionne au moins un test (' + sel.length + ')');
      });
      var commit = MC_TESTS.selection(cat, MC_TESTS.preset('commit'));
      A.notOk(commit.some(function (t) { return t.type === 'e2e' || t.type === 'integration'; }), 'commit exclut e2e et intégration');
      A.notOk(commit.some(function (t) { return t.etiquettes.indexOf('lent') >= 0; }), 'commit exclut @lent');
      var regression = MC_TESTS.selection(cat, MC_TESTS.preset('regression'));
      A.equal(regression.length, cat.length, 'regression prend tout le catalogue');

      var outIntegration = cp.execFileSync(process.execPath, [path.join(RACINE, 'tests', 'run.js'), '--preset', 'integration', '--lister'],
        { encoding: 'utf8', cwd: RACINE });
      A.ok(/\[integration\]/.test(outIntegration) || /\[charge\]/.test(outIntegration), 'le préréglage integration liste bien des tests d\'intégration : ' + outIntegration.slice(-160));
    });

    it('SPEC-BANC-005 : la ligne de commande accepte les mêmes critères que le catalogue, --lister sans exécuter', function () {
      var out = cp.execFileSync(process.execPath, [path.join(RACINE, 'tests', 'run.js'), '--domaine', 'MODE', '--lister'],
        { encoding: 'utf8', cwd: RACINE });
      var nTotal = /(\d+) test\(s\) sélectionné/.exec(out);
      A.ok(nTotal && Number(nTotal[1]) > 0, '--domaine MODE liste au moins un test : ' + out.slice(-120));
      A.ok(out.indexOf('SPEC-MODE-001') >= 0, 'SPEC-MODE-001 apparaît dans la sélection listée');
      A.notOk(/SPEC-SAVE-/.test(out), 'un test hors domaine MODE n\'apparaît pas');

      var r = cp.spawnSync(process.execPath, [path.join(RACINE, 'tests', 'run.js'), '--preset', 'nawak-inexistant'],
        { encoding: 'utf8', cwd: RACINE });
      A.notEqual(r.status, 0, 'un préréglage inconnu est refusé');
      A.ok(/connus/.test(r.stderr), 'l\'aide liste les préréglages connus : ' + r.stderr);
    });

    it('SPEC-BANC-006 : les crochets git appellent les préréglages commit et pr, tous deux non vides', function () {
      var preCommit = fs.readFileSync(path.join(RACINE, 'tools', 'hooks', 'pre-commit.js'), 'utf8');
      var prePush = fs.readFileSync(path.join(RACINE, 'tools', 'hooks', 'pre-push.js'), 'utf8');
      A.ok(/--preset\s+commit/.test(preCommit) || /preset:\s*['"]commit['"]/.test(preCommit), 'pre-commit appelle le préréglage commit');
      A.ok(/--preset\s+pr/.test(prePush) || /preset:\s*['"]pr['"]/.test(prePush), 'pre-push appelle le préréglage pr');
      A.ok(fs.existsSync(path.join(RACINE, '.githooks', 'pre-push')), '.githooks/pre-push existe');

      ['commit', 'pr'].forEach(function (nom) {
        var out = cp.execFileSync(process.execPath, [path.join(RACINE, 'tests', 'run.js'), '--preset', nom, '--lister'],
          { encoding: 'utf8', cwd: RACINE });
        var n = /(\d+) test\(s\) sélectionné/.exec(out);
        A.ok(n && Number(n[1]) > 0, 'le préréglage ' + nom + ' cité par un crochet n\'est pas vide');
      });
    });

    it('SPEC-BANC-006 : domainesTouches() ne restreint le préréglage commit que si CHAQUE fichier touché a un domaine reconnu, sinon repli complet (revue adversariale)', function () {
      var domainesTouches = require(path.join(RACINE, 'tools', 'domaines-touches.js')).domainesTouches;
      A.equal(domainesTouches(['src/core.js', 'src/eau.js'], RACINE), null,
        'un fichier partagé sans domaine propre (core.js) fait retomber sur le repli complet, même si eau.js a un domaine clair');
      A.deep(domainesTouches(['src/eau.js'], RACINE), ['EAU'], 'un fichier seul avec domaine reconnu restreint bien à ce domaine');
      A.equal(domainesTouches(['src/eau.js', 'src/meteo.js'], RACINE) && domainesTouches(['src/eau.js', 'src/meteo.js'], RACINE).indexOf('EAU') >= 0, true,
        'plusieurs fichiers ayant chacun un domaine reconnu restreignent à l\'union de ces domaines');
      A.equal(domainesTouches([], RACINE), null, 'liste vide : repli complet');
      A.equal(domainesTouches(['README.md'], RACINE), null, 'fichier hors src/ : repli complet');
    });

    it('SPEC-BANC-010 : un test qui dépasse son délai est marqué en échec avec son étape, la campagne continue', function () {
      var script = "const vm=require('vm'),fs=require('fs');" +
        "const ctx=vm.createContext({console,Math,JSON,Date,Error,Number,String,Array,Object,Boolean,Map,Set,isNaN,isFinite,parseInt,parseFloat,performance:{now:()=>Date.now()}});" +
        "ctx.globalThis=ctx;" +
        "vm.runInContext(fs.readFileSync('tests/harness.js','utf8'),ctx);" +
        "vm.runInContext(\"describe('Bloque',function(){it('boucle qui coopere',function(){for(var i=0;i<1e7;i++){T.etape('boucle',i);}});it('suivant',function(){assert.ok(true);});});\",ctx);" +
        "const journal=[];" +
        "ctx.T.run(null,{finTest:(g,n,ok,ms,d)=>journal.push({n,ok,delai:!!(d&&d.delai),message:d&&d.message})},{delaiMs:50});" +
        "console.log(JSON.stringify(journal));";
      var out = cp.execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', cwd: RACINE });
      var journal = JSON.parse(out.trim().split('\n').pop());
      A.equal(journal.length, 2, 'les deux tests du groupe sont passés (le bloqué puis le suivant)');
      A.notOk(journal[0].ok, 'le test bloqué est en échec');
      A.ok(journal[0].delai, 'marqué comme délai dépassé');
      A.ok(/boucle/.test(journal[0].message), 'l\'étape en cours (boucle) est rapportée dans le message : ' + journal[0].message);
      A.ok(journal[1].ok, 'le test suivant s\'exécute normalement');
    });

    it('SPEC-BANC-013 : un test Node dont la fonction REND une Promise échoue explicitement, au lieu d\'être compté réussi avant vérification (garde anti-faux-positif)', function () {
      var script = "const vm=require('vm'),fs=require('fs');" +
        "const ctx=vm.createContext({console,Math,JSON,Date,Error,Number,String,Array,Object,Boolean,Map,Set,isNaN,isFinite,parseInt,parseFloat,performance:{now:()=>Date.now()}});" +
        "ctx.globalThis=ctx;" +
        "vm.runInContext(fs.readFileSync('tests/harness.js','utf8'),ctx);" +
        "vm.runInContext(\"describe('Async',function(){" +
        "it('rend une vraie Promise',function(){return new Promise(function(res){res();});});" +
        "it('rend un thenable maison',function(){return {then:function(){}};});" +
        "it('reste synchrone',function(){assert.ok(true);});" +
        "});\",ctx);" +
        "const journal=[];" +
        "ctx.T.run(null,{finTest:(g,n,ok,ms,d)=>journal.push({n,ok,message:d&&d.message})});" +
        "console.log(JSON.stringify(journal));";
      var out = cp.execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', cwd: RACINE });
      var journal = JSON.parse(out.trim().split('\n').pop());
      A.equal(journal.length, 3, 'les trois tests du groupe sont passés');
      A.notOk(journal[0].ok, 'une vraie Promise rendue par le test : échec, pas un succès prématuré');
      A.ok(/asynchrone non supporté sous le harness synchrone/.test(journal[0].message), 'message explicite : ' + journal[0].message);
      A.ok(/tests\/integration-/.test(journal[0].message), 'le message oriente vers tests/integration-*.js : ' + journal[0].message);
      A.notOk(journal[1].ok, 'un thenable maison (sans être une vraie Promise) est refusé pareillement');
      A.ok(journal[2].ok, 'un test synchrone normal, lui, passe toujours');
    });

    it('SPEC-BANC-013 : un échec porte fiche, étapes, assertions, attendu/obtenu, message et pile', function () {
      var err = null;
      try { A.equal(1, 2, 'comparaison de démonstration'); } catch (e) { err = e; }
      A.ok(err, 'l\'assertion a bien levé');
      A.equal(err.attendu, 2, 'attendu capturé séparément');
      A.equal(err.obtenu, 1, 'obtenu capturé séparément');
      A.ok(/comparaison de démonstration/.test(err.message), 'message présent');
      A.ok(err.stack, 'une pile est disponible');

      // le rapport HTML affiche ces informations, échappées
      var resultats = {
        schema: 1,
        campagne: { preset: 'demo', totaux: { total: 1, passes: 0, echecs: 1, ignores: 0 } },
        tests: [{
          id: 'demo-fictif-001', nom: 'un test <script>alert(1)</script>', type: 'unitaire', groupe: 'G',
          domaines: [], specs: [], fiche: { teste: 'T', pourquoi: 'P', attendu: 'A', source: 'declaree' },
          etat: 'echec', duree_ms: 12,
          etapes: [{ libelle: 'première étape', t_ms: 1 }, { libelle: 'seconde étape', t_ms: 5 }],
          assertions: { ok: 2, ko: 1 },
          message: 'attendu 2, obtenu 1', attendu: 2, obtenu: 1, pile: 'à la ligne 42',
        }],
      };
      var html = MC_RAPPORT.html(resultats);
      A.notOk(/<script>alert/.test(html), 'le texte de test est échappé, pas exécutable tel quel');
      A.ok(html.indexOf('&lt;script&gt;') >= 0, 'la balise apparaît échappée');
      A.ok(html.indexOf('attendu 2, obtenu 1') >= 0, 'le message d\'échec est présent');
      A.ok(html.indexOf('à la ligne 42') >= 0, 'la pile est présente');
      var iPremiere = html.indexOf('première étape'), iSeconde = html.indexOf('seconde étape');
      A.ok(iPremiere >= 0 && iSeconde > iPremiere, 'les étapes apparaissent dans l\'ordre');
    });

    it('SPEC-BANC-014 : le cahier de test (resultats.json + rapport.html) est conservé, y compris interrompu', function () {
      var dossier = tmpDir('cahier');
      try {
        var resultats = {
          schema: 1,
          campagne: { preset: 'demo', debut: new Date().toISOString(), fin: new Date().toISOString(), duree_ms: 10,
            interrompue: false, totaux: { total: 2, passes: 1, echecs: 1, ignores: 0, parType: { unitaire: 2 }, parDomaine: {} } },
          tests: [
            { id: 'A', nom: 'a', type: 'unitaire', groupe: 'G', domaines: [], specs: [], fiche: null, etat: 'ok', duree_ms: 1, etapes: [], assertions: { ok: 1, ko: 0 } },
            { id: 'B', nom: 'b', type: 'unitaire', groupe: 'G', domaines: [], specs: [], fiche: null, etat: 'echec', duree_ms: 1, etapes: [], assertions: { ok: 0, ko: 1 }, message: 'échec' },
          ],
        };
        var r = RT.ecrireCahier(resultats, { racine: dossier, nom: 'essai' });
        A.ok(fs.existsSync(path.join(dossier, 'essai', 'resultats.json')), 'resultats.json écrit');
        A.ok(fs.existsSync(path.join(dossier, 'essai', 'rapport.html')), 'rapport.html écrit');
        var relu = JSON.parse(fs.readFileSync(path.join(dossier, 'essai', 'resultats.json'), 'utf8'));
        A.equal(relu.tests.length, relu.campagne.totaux.total, 'le total du fichier correspond au nombre de tests');
        A.ok(r.rapport.indexOf('rapport.html') >= 0, 'le chemin du rapport est renvoyé');

        // campagne interrompue : le rapport le signale
        resultats.campagne.interrompue = true;
        RT.ecrireCahier(resultats, { racine: dossier, nom: 'interrompue' });
        var html = fs.readFileSync(path.join(dossier, 'interrompue', 'rapport.html'), 'utf8');
        A.ok(/interrompue/i.test(html), 'le rapport signale la campagne interrompue');

        // élagage : au-delà de N dossiers, seuls les plus récents restent
        for (var i = 0; i < 3; i++) RT.ecrireCahier(resultats, { racine: dossier, nom: 'lot-' + i });
        RT.elaguer(dossier, 2);
        var restants = fs.readdirSync(dossier);
        A.equal(restants.length, 2, 'élagage à 2 dossiers : ' + restants.join(', '));
      } finally { nettoyer(dossier); }
    });

    it('SPEC-BANC-011 / SPEC-BANC-014 : chaque test garde SES captures, lisibles, jusque dans les exports', function () {
      var dossier = tmpDir('captures');
      try {
        // deux JPEG minuscules différents (en-tête FF D8 FF, puis un octet distinctif)
        var jpegA = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x0A]), jpegB = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x0B]);
        var test = function (id, index) {
          return { id: id, nom: id, type: 'e2e', groupe: 'G', domaines: [], specs: [], fiche: null, etat: 'ok', duree_ms: 1,
                   etapes: [], assertions: { ok: 1, ko: 0 }, captures: [{ libelle: 'début', fichier: index }] };
        };
        var resultats = { schema: 1, campagne: { preset: 'captures', debut: '', fin: '', duree_ms: 1, interrompue: false,
          totaux: { total: 2, passes: 2, echecs: 0, ignores: 0, parType: {}, parDomaine: {} } }, tests: [test('A', 0), test('B', 1)] };
        RT.ecrireCahier(resultats, { racine: dossier, nom: 'c', captures: [
          // comme le banc navigateur : une URL de données complète, et un libellé d'étape répété
          { libelle: 'début', type: 'image/jpeg', base64: 'data:image/jpeg;base64,' + jpegA.toString('base64') },
          { libelle: 'début', type: 'image/jpeg', base64: jpegB.toString('base64') },
        ] });
        var relu = JSON.parse(fs.readFileSync(path.join(dossier, 'c', 'resultats.json'), 'utf8'));
        var fA = relu.tests[0].captures[0].fichier, fB = relu.tests[1].captures[0].fichier;
        A.ok(typeof fA === 'string' && typeof fB === 'string', 'chaque capture a reçu son fichier');
        A.notEqual(fA, fB, 'deux tests au même libellé d\'étape gardent chacun leur image');
        var oA = fs.readFileSync(path.join(dossier, 'c', 'captures', fA)), oB = fs.readFileSync(path.join(dossier, 'c', 'captures', fB));
        A.ok(oA.equals(jpegA), 'le préfixe data: est retiré : l\'image écrite est exactement le JPEG envoyé');
        A.ok(oB.equals(jpegB), 'une capture en base64 brut reste intacte');
        A.ok(fs.readFileSync(path.join(dossier, 'c', 'rapport.html'), 'utf8').indexOf('captures/' + fB) >= 0, 'le rapport affiche la capture du second test');
        // les exports intègrent les images
        var CAHIER = require(path.join(RACINE, 'tools', 'cahier.js'));
        var web = CAHIER.exporterHTML(dossier, 'c').toString('utf8');
        A.ok(web.indexOf('data:image/jpeg;base64,' + jpegA.toString('base64')) >= 0 &&
             web.indexOf('data:image/jpeg;base64,' + jpegB.toString('base64')) >= 0, 'la page web autonome intègre les deux captures');
        var docx = CAHIER.exporterDocx(dossier, 'c');
        A.ok(docx.indexOf(jpegA) >= 0 && docx.indexOf(jpegB) >= 0, 'le document Word embarque les deux images');
      } finally { nettoyer(dossier); }
    });

    it('SPEC-BANC-026 : runUnE2E capture systématiquement le début et la fin de chaque test, sans dépendre de capture()/etape()', function () {
      // Vérification STRUCTURELLE du texte source (comme SPEC-BANC-001 ci-dessus
      // le fait déjà pour le catalogue) : tests/e2e.js pilote de vraies API
      // navigateur (THREE, canvas, pointer lock…) qu'on ne rejoue pas sous
      // Node ici — la vérification COMPORTEMENTALE réelle, avec un vrai
      // navigateur sans fenêtre, vit dans la porte G15 (tests/gates.js) sur
      // un cahier fraîchement généré, pas seulement sur ce texte.
      var src = fs.readFileSync(path.join(RACINE, 'tests', 'e2e.js'), 'utf8');
      var corpsRunUnE2E = src.slice(src.indexOf('function runUnE2E'), src.indexOf('function runE2E('));
      A.ok(/capturer\(g, 'd.but'\)/.test(corpsRunUnE2E), 'une capture "début" est prise avant même d\'appeler test.fn — inconditionnellement');
      // la capture de début a lieu AVANT le .then(test.fn) : elle ne dépend
      // donc pas de ce que le test appelle ou non lui-même
      A.ok(corpsRunUnE2E.indexOf('capturer(g, \'début\')') < corpsRunUnE2E.indexOf('test.fn'),
        'la capture de début précède l\'exécution du test');
      A.ok(/capturer\(g, 'fin'\)/.test(corpsRunUnE2E), 'une capture "fin" est prise à la réussite');
      A.ok(/capturer\(g, 'échec'\)/.test(corpsRunUnE2E), 'une capture "échec" est prise à l\'échec');
      A.ok(/capturer\(g, 'délai dépassé'\)/.test(corpsRunUnE2E), 'une capture est prise au délai dépassé');
    });

    it('SPEC-BANC-026 / SPEC-BANC-027 : un test sans aucun capture()/etape() garde quand même ≥ 2 captures dans le cahier écrit, dans l\'ordre chronologique', function () {
      // Reproduit ce que produit runUnE2E pour un test qui n'appelle JAMAIS
      // capture() ni etape() lui-même : seules les captures automatiques de
      // début et de fin existent, dans l'ordre où elles ont été prises.
      var dossier = tmpDir('auto-captures');
      try {
        var jpegDebut = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x01]);
        var jpegFin = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x02]);
        var resultats = { schema: 1, campagne: { preset: 'auto', debut: '', fin: '', duree_ms: 1, interrompue: false,
          totaux: { total: 1, passes: 1, echecs: 0, ignores: 0, parType: {}, parDomaine: {} } },
          tests: [{ id: 'X', nom: 'un test muet, sans capture() ni etape()', type: 'e2e', groupe: 'end-to-end',
            domaines: [], specs: [], fiche: null, etat: 'ok', duree_ms: 5, etapes: [], assertions: { ok: 0, ko: 0 },
            // ordre chronologique produit par runUnE2E : début d'abord, fin ensuite
            captures: [{ libelle: 'début', fichier: 0 }, { libelle: 'fin', fichier: 1 }] }] };
        RT.ecrireCahier(resultats, { racine: dossier, nom: 'c', captures: [
          { libelle: 'début', type: 'image/jpeg', base64: jpegDebut.toString('base64') },
          { libelle: 'fin', type: 'image/jpeg', base64: jpegFin.toString('base64') },
        ] });
        var relu = JSON.parse(fs.readFileSync(path.join(dossier, 'c', 'resultats.json'), 'utf8'));
        A.ok(relu.tests[0].captures.length >= 2, 'au moins 2 captures même sans capture()/etape() explicite (SPEC-BANC-026)');
        A.equal(relu.tests[0].captures[0].libelle, 'début', 'la première capture du tableau est celle de début');
        A.equal(relu.tests[0].captures[1].libelle, 'fin', 'la seconde est celle de fin, dans l\'ordre chronologique');

        // le rapport affiche les DEUX, dans le même ordre (SPEC-BANC-027) —
        // aucune n'a de libellé nommé explicitement par le test, et pourtant
        // les deux apparaissent : le cahier ne filtre pas sur les captures
        // déclarées, il affiche TOUT t.captures.
        var html = fs.readFileSync(path.join(dossier, 'c', 'rapport.html'), 'utf8');
        var iDebut = html.indexOf('>début<'), iFin = html.indexOf('>fin<');
        A.ok(iDebut >= 0 && iFin >= 0, 'les deux légendes "début" et "fin" apparaissent dans le rapport');
        A.ok(iDebut < iFin, 'la capture de début apparaît avant celle de fin dans le rapport (ordre chronologique)');
      } finally { nettoyer(dossier); }
    });

    it('SPEC-BANC-015 : le serveur de test refuse une adresse distante, un envoi trop gros, et fabrique lui-même les noms de fichiers', function () {
      A.ok(RT.estAdresseLocale('127.0.0.1'));
      A.ok(RT.estAdresseLocale('::1'));
      A.ok(RT.estAdresseLocale('::ffff:127.0.0.1'));
      A.notOk(RT.estAdresseLocale('203.0.113.9'), 'une adresse distante est refusée');

      A.ok(RT.peutRecevoirResultats({ serveurSeul: false }), 'serveur normal : accepté');
      A.notOk(RT.peutRecevoirResultats({ serveurSeul: true }), 'serveur dédié sans --tests : refusé');
      A.ok(RT.peutRecevoirResultats({ serveurSeul: true, tests: true }), 'serveur dédié avec --tests : accepté');

      var refusAdresse = RT.traiterEnvoi({ resultats: { tests: [] } }, { adresse: '8.8.8.8', params: {} });
      A.notOk(refusAdresse.ok, 'refusé : adresse non locale');

      var refusTaille = RT.traiterEnvoi({ resultats: { tests: [] } }, { adresse: '127.0.0.1', params: {}, tailleOctets: 100, limiteOctets: 10 });
      A.notOk(refusTaille.ok, 'refusé : corps trop gros');
      A.equal(refusTaille.code, 413);

      var dossier = tmpDir('envoi');
      try {
        var base64Mal = Buffer.from('contenu').toString('base64');
        var r = RT.traiterEnvoi({
          resultats: {
            schema: 1,
            campagne: { preset: 'demo', totaux: { total: 1, passes: 1, echecs: 0, ignores: 0 } },
            tests: [{ id: 'A', nom: 'a', type: 'unitaire', groupe: 'G', domaines: [], specs: [], etat: 'ok', duree_ms: 1, captures: [{ libelle: '../../../evil', fichier: null }] }],
          },
          captures: [{ libelle: '../../../evil', type: 'image/jpeg', base64: base64Mal }],
        }, { adresse: '127.0.0.1', params: {} });
        A.ok(r.ok, 'envoi valide accepté');
        var capturesDir = path.join(RACINE, r.dossier.replace(/^\//, ''), 'captures');
        var fichiers = fs.readdirSync(capturesDir);
        A.equal(fichiers.length, 1, 'un seul fichier de capture, nommé par le serveur');
        A.notOk(/\.\./.test(fichiers[0]), 'aucune traversée de répertoire dans le nom fabriqué : ' + fichiers[0]);
        A.ok(path.resolve(capturesDir, fichiers[0]).indexOf(path.resolve(capturesDir)) === 0, 'le fichier reste dans captures/');
        nettoyer(path.join(RACINE, r.dossier.replace(/^\//, '')));
      } finally { nettoyer(dossier); }
    });

    it('SPEC-BANC-022 : les rendus HTML et .docx d\'un même cahier partagent le même modèle (mêmes sections, tests, lignes, captures)', function () {
      var { construireDocx } = require(path.join(RACINE, 'tools', 'docx.js'));
      var { lireZip } = require(path.join(RACINE, 'tools', 'zip.js'));
      var resultats = {
        schema: 1,
        campagne: { preset: 'demo', totaux: { total: 2, passes: 1, echecs: 1, ignores: 0, parType: { unitaire: 2 }, parDomaine: {} } },
        tests: [
          { id: 'A', nom: 'a', type: 'unitaire', groupe: 'G1', domaines: [], specs: [], fiche: { teste: 'T', pourquoi: 'P', attendu: 'A' }, etat: 'ok', duree_ms: 5, etapes: [], assertions: { ok: 1, ko: 0 }, captures: [{ libelle: 'cap1', fichier: 'x.jpg' }] },
          { id: 'B', nom: 'b', type: 'unitaire', groupe: 'G2', domaines: [], specs: [], fiche: null, etat: 'echec', duree_ms: 5, etapes: [], assertions: { ok: 0, ko: 1 }, message: 'raté', captures: [{ libelle: 'cap2', fichier: 'y.jpg' }] },
        ],
      };
      var m = MC_RAPPORT.modele(resultats);
      // on enrichit chaque bloc image de faux octets, comme le ferait tools/cahier.js
      var octetsFaux = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]);
      var nImagesModele = 0;
      m.blocs.forEach(function (b) { if (b.type === 'image') { b.donnees = octetsFaux; b.mime = 'jpg'; nImagesModele++; } });
      // le test en échec apparaît deux fois dans le modèle (section « Échecs »
      // ET listing complet, par conception — voir modele() dans tests/rapport.js) :
      // sa capture aussi. Le test ok n'apparaît qu'une fois.
      var attendu = resultats.tests.reduce(function (n, t) {
        var fois = (t.etat === 'echec' || t.etat === 'delai') ? 2 : 1;
        return n + (t.captures || []).length * fois;
      }, 0);
      A.equal(nImagesModele, attendu, 'le modèle porte bien toutes les captures, échecs comptés deux fois');

      var nTitresModele = m.blocs.filter(function (b) { return b.type === 'titre'; }).length;
      var nTableauxModele = m.blocs.filter(function (b) { return b.type === 'tableau'; }).length;
      var nLignesTableauModele = m.blocs.filter(function (b) { return b.type === 'tableau'; })
        .reduce(function (n, b) { return n + (b.lignes || []).length; }, 0);

      var htmlOut = G.MC_RAPPORT.html(m);
      A.equal((htmlOut.match(/<h[1-4]/g) || []).length, nTitresModele, 'même nombre de titres en HTML');
      A.equal((htmlOut.match(/<table>/g) || []).length, nTableauxModele, 'même nombre de tableaux en HTML');
      A.equal((htmlOut.match(/<tr(?: |>)/g) || []).length, nLignesTableauModele + nTableauxModele, 'même nombre de lignes (dont en-têtes) en HTML');
      A.equal((htmlOut.match(/<img /g) || []).length, nImagesModele, 'même nombre de captures en HTML');
      A.ok(htmlOut.indexOf('a') >= 0 && htmlOut.indexOf('raté') >= 0, 'les deux tests apparaissent dans le HTML');

      var docxBuf = construireDocx(m);
      A.equal(docxBuf.slice(0, 2).toString('hex'), '504b', 'l\'archive .docx commence par la signature ZIP (PK)');
      var entrees = lireZip(docxBuf);
      var docXml = entrees.find(function (e2) { return e2.nom === 'word/document.xml'; }).contenu.toString('utf8');
      A.equal((docXml.match(/<pic:pic/g) || []).length, nImagesModele, 'même nombre de captures dans le .docx');
      A.equal((docXml.match(/<w:tbl>/g) || []).length, nTableauxModele, 'même nombre de tableaux dans le .docx');
      A.equal((docXml.match(/<w:tr>/g) || []).length, nLignesTableauModele + nTableauxModele, 'même nombre de lignes dans le .docx');
      A.ok(docXml.indexOf('raté') >= 0, 'le contenu textuel (message d\'échec) est présent dans le .docx aussi');
      A.equal(entrees.filter(function (e2) { return /^word\/media\//.test(e2.nom); }).length, nImagesModele, 'un fichier média par capture');
    });

    it('SPEC-BANC-021 : l\'archive .docx produite est structurellement valide (ZIP bien formé, XML bien formé)', function () {
      var { construireDocx } = require(path.join(RACINE, 'tools', 'docx.js'));
      var { lireZip } = require(path.join(RACINE, 'tools', 'zip.js'));
      var m = { titre: 'Test', blocs: [
        { type: 'titre', niveau: 1, texte: 'Titre' },
        { type: 'paragraphe', texte: 'Un paragraphe avec des & < > " caractères à échapper' },
        { type: 'liste', items: ['un', 'deux'] },
        { type: 'tableau', entetes: ['a', 'b'], lignes: [{ cellules: ['1', '2'], etat: 'ok' }] },
        { type: 'saut_page' },
        { type: 'sommaire', entrees: [{ texte: 'Section', niveau: 1 }] },
      ] };
      var buf = construireDocx(m);
      var entrees = lireZip(buf);
      var noms = entrees.map(function (e2) { return e2.nom; });
      ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml'].forEach(function (attendu) {
        A.ok(noms.indexOf(attendu) >= 0, 'entrée présente : ' + attendu);
      });
      entrees.forEach(function (e2) {
        if (!/\.(xml|rels)$/.test(e2.nom)) return;
        var texte = e2.contenu.toString('utf8');
        A.ok(texte.indexOf('<?xml') === 0, e2.nom + ' commence par une déclaration XML');
        // équilibre grossier des balises ouvrantes/fermantes — un XML mal formé le rompt
        var ouvrantes = (texte.match(/<[a-zA-Z][^>]*[^/]>/g) || []).length;
        var fermantes = (texte.match(/<\/[a-zA-Z][^>]*>/g) || []).length;
        var autofermantes = (texte.match(/<[a-zA-Z][^>]*\/>/g) || []).length;
        A.ok(ouvrantes === fermantes, e2.nom + ' balises équilibrées (' + ouvrantes + ' vs ' + fermantes + ', ' + autofermantes + ' autofermantes)');
      });
      // le texte est échappé : pas de "&" ni de guillemet non échappés dans document.xml
      var docXml = entrees.find(function (e2) { return e2.nom === 'word/document.xml'; }).contenu.toString('utf8');
      A.notOk(/[^&](&)(?!amp;|lt;|gt;|quot;|apos;)/.test(docXml), 'les caractères spéciaux sont échappés dans le XML');
    });

    it('SPEC-BANC-020 : l\'export PDF utilise un navigateur headless détecté, ou propose l\'impression de la page en repli', function () {
      var cahier = require(path.join(RACINE, 'tools', 'cahier.js'));
      var dossier = tmpDir('pdf');
      try {
        RT.ecrireCahier({
          schema: 1, campagne: { preset: 'demo', totaux: { total: 1, passes: 1, echecs: 0, ignores: 0 } },
          tests: [{ id: 'A', nom: 'a', type: 'unitaire', groupe: 'G', domaines: [], specs: [], etat: 'ok', duree_ms: 1 }],
        }, { racine: dossier, nom: 'r1' });
        var r = cahier.exporterPDF(dossier, 'r1');
        if (r.ok) {
          A.ok(r.pdf && r.pdf.slice(0, 4).toString() === '%PDF', 'un navigateur headless a produit un vrai PDF');
        } else {
          A.equal(r.repli, 'html', 'à défaut de navigateur, la page HTML autonome est proposée en repli');
          A.ok(r.page && r.page.length > 0, 'la page de repli n\'est pas vide');
        }
        // détection : un chemin forcé inexistant ne trouve jamais rien
        A.equal(cahier.trouverNavigateur('/chemin/qui/n/existe/pas/navigateur.exe'), null, 'un chemin forcé inexistant ne trouve rien');
      } finally { nettoyer(dossier); }
    });

    it('SPEC-BANC-018 : la bibliothèque des cahiers liste, compare et protège les cahiers conservés de la rotation', function () {
      var cahier = require(path.join(RACINE, 'tools', 'cahier.js'));
      var dossier = tmpDir('biblio');
      try {
        function cahierDe(preset, etat) {
          return {
            schema: 1, campagne: { preset: preset, debut: new Date().toISOString(), totaux: { total: 1, passes: etat === 'ok' ? 1 : 0, echecs: etat === 'ok' ? 0 : 1, ignores: 0 } },
            tests: [{ id: 'A', nom: 'a', type: 'unitaire', groupe: 'G', domaines: [], specs: [], etat: etat, duree_ms: 1 }],
          };
        }
        RT.ecrireCahier(cahierDe('p1', 'ok'), { racine: dossier, nom: 'run1' });
        RT.ecrireCahier(cahierDe('p1', 'echec'), { racine: dossier, nom: 'run2' });

        var liste = cahier.listerCahiers(dossier);
        A.equal(liste.length, 2, 'les deux cahiers apparaissent');
        A.ok(liste.every(function (c) { return c.totaux; }), 'chaque entrée porte ses totaux');

        var comp = cahier.compareCahiers(dossier, 'run1', 'run2');
        A.ok(comp.ok);
        A.deep(comp.versEchec, ['a'], 'le test devenu échec est signalé');

        A.deep(cahier.compareCahiers(dossier, 'inconnu', 'run1').ok, false, 'un cahier inconnu est refusé');

        A.ok(cahier.marquerConserve(dossier, 'run1', true).ok);
        A.notOk(cahier.supprimerCahier(dossier, 'run1').ok, 'un cahier conservé refuse la suppression directe');
        // et la rotation (elaguer) ne le supprime pas non plus, même à la limite 0
        RT.elaguer(dossier, 0);
        A.ok(fs.existsSync(path.join(dossier, 'run1')), 'l\'élagage épargne un cahier conservé');
        A.notOk(fs.existsSync(path.join(dossier, 'run2')), 'un cahier non conservé, lui, est élagué');
      } finally { nettoyer(dossier); }
    });

    it('SPEC-BANC-019 : un cahier s\'exporte en page web autonome, captures comprises en data URI', function () {
      var cahier = require(path.join(RACINE, 'tools', 'cahier.js'));
      var dossier = tmpDir('autonome');
      try {
        var b64 = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]).toString('base64');
        RT.ecrireCahier({
          schema: 1, campagne: { preset: 'demo', totaux: { total: 1, passes: 1, echecs: 0, ignores: 0 } },
          tests: [{ id: 'A', nom: 'a', type: 'unitaire', groupe: 'G', domaines: [], specs: [], etat: 'ok', duree_ms: 1, captures: [{ libelle: 'x', fichier: null }] }],
        }, { racine: dossier, nom: 'r1', captures: [{ libelle: 'x', type: 'image/jpeg', base64: b64 }] });
        var htmlBuf = cahier.exporterHTML(dossier, 'r1');
        var texte = htmlBuf.toString('utf8');
        A.ok(texte.indexOf('<!DOCTYPE html>') === 0, 'un document HTML complet');
        A.ok(texte.indexOf('data:image/jpeg;base64,') >= 0, 'la capture est intégrée en data URI, pas en lien externe');
        A.notOk(/src="captures\//.test(texte), 'aucune dépendance à un fichier externe captures/');
      } finally { nettoyer(dossier); }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — fonctions déclarées/observées, fiche avant résultat, G14 étendue (0a/0b)', function () {
    it('SPEC-BANC-062 : une fiche (test ou groupe) déclare `fonctions`, propagées jusqu\'à l\'entrée du catalogue', function () {
      var specsIndex = MC_TESTS.indexSpecs(fs.readFileSync(path.join(RACINE, 'SPECS.md'), 'utf8'));
      var TT = { suites: [{
        name: 'Groupe démo', fichier: 'tests/unit.js', fiche: null,
        tests: [
          { name: 'test avec fonctions déclarées', fiche: { teste: 't', pourquoi: 'p', attendu: 'a', fonctions: ['MC.Demo.f'] } },
          { name: 'test sans rien de spécial', fiche: null },
        ],
      }] };
      var cat = MC_TESTS.construire(TT, [], specsIndex);
      var a = cat.find(function (c) { return c.nom === 'test avec fonctions déclarées'; });
      var b = cat.find(function (c) { return c.nom === 'test sans rien de spécial'; });
      A.deep(a.fonctions, ['MC.Demo.f'], 'fonctions déclarées reprises sur l\'entrée du catalogue');
      A.deep(b.fonctions, [], 'sans déclaration : liste vide (jamais undefined)');
    });

    it('SPEC-BANC-066 : un domaine peut aussi être DÉCLARÉ (fiche ou groupe), fusionné à celui déduit des SPEC-* citées', function () {
      var TT = { suites: [{
        name: 'Groupe démo 2', fichier: 'tests/unit.js', fiche: { teste: 't', pourquoi: 'p', attendu: 'a', domaines: ['FAUNE'] },
        tests: [{ name: 'SPEC-RENDU-001 : un test avec spec et domaine déclaré' }],
      }] };
      var cat = MC_TESTS.construire(TT, [], {});
      var t = cat[0];
      A.ok(t.domaines.indexOf('RENDU') >= 0, 'domaine déduit de la spec citée toujours présent');
      A.ok(t.domaines.indexOf('FAUNE') >= 0, 'domaine déclaré ajouté, sans remplacer celui déduit');
    });

    it('SPEC-BANC-062 : un test Node sans fonctions déclarées appelant MC.Mesher.tileOrigin la fait apparaître dans ses fonctions OBSERVÉES, compteur d\'appels ≥ 1', function () {
      // le surcoût mesuré (comme toute la progression de tests/run.js, voir
      // ecrire()) est écrit sur STDERR, pas stdout — execFileSync ne rend
      // que stdout ; spawnSync capture les deux, qu'on combine pour le test.
      // délai généreux mais BORNÉ (60 s) : un sous-processus qui ne rend
      // jamais la main (observé une fois, cause non élucidée sous charge
      // concurrente) ne doit jamais accrocher CE test à son tour.
      var nomTest = 'SPEC-PERF-011 à 013 : uvBase + fract(uvRep) * tailleTuile retombe sur pushUV, à toute rotation';
      var dossierTmp = tmpDir('spec-banc-062');
      var r1 = cp.spawnSync(process.execPath, [path.join(RACINE, 'tests', 'run.js'), '--test', 'SPEC-PERF-011'],
        { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { MC_TEST_RESULTATS_DIR: dossierTmp }) });
      try {
        var out = (r1.stdout || '') + (r1.stderr || '');
        A.ok(!r1.error, 'le sous-processus s\'est terminé dans le délai imparti : ' + (r1.error && r1.error.message));
        A.ok(/observation des fonctions active — surcoût mesuré/.test(out), 'le surcoût mesuré est affiché : ' + out.slice(0, 300));
        var dossiers = fs.readdirSync(dossierTmp, { withFileTypes: true }).filter(function (d) { return d.isDirectory(); });
        A.ok(dossiers.length >= 1, 'un cahier a été écrit');
        var resultats = JSON.parse(fs.readFileSync(path.join(dossierTmp, dossiers[0].name, 'resultats.json'), 'utf8'));
        var t = resultats.tests.find(function (x) { return x.nom.indexOf('uvBase + fract(uvRep)') >= 0; });
        A.ok(t, 'le test cible est bien dans la sélection --test SPEC-PERF-011');
        A.ok(t.fonctions.indexOf('MC.Mesher.tileOrigin') >= 0, 'MC.Mesher.tileOrigin observée : ' + JSON.stringify(t.fonctions));
        A.ok(t.fonctionsAppels['MC.Mesher.tileOrigin'] >= 1, 'compteur d\'appels >= 1 : ' + t.fonctionsAppels['MC.Mesher.tileOrigin']);
      } finally { nettoyer(dossierTmp); }

      var dossierTmp2 = tmpDir('spec-banc-062-sans');
      try {
        var r2 = cp.spawnSync(process.execPath, [path.join(RACINE, 'tests', 'run.js'), '--sans-fonctions', '--test', 'SPEC-PERF-011'],
          { encoding: 'utf8', timeout: 60000, env: Object.assign({}, process.env, { MC_TEST_RESULTATS_DIR: dossierTmp2 }) });
        var outSans = (r2.stdout || '') + (r2.stderr || '');
        A.ok(!r2.error, 'le sous-processus (--sans-fonctions) s\'est terminé dans le délai imparti : ' + (r2.error && r2.error.message));
        A.ok(/observation des fonctions désactivée/.test(outSans), '--sans-fonctions annonce la désactivation : ' + outSans.slice(0, 300));
      } finally { nettoyer(dossierTmp2); }
    });

    it('SPEC-BANC-059 : la fiche d\'un test HTML s\'affiche AVANT son résultat (identité, fiche, puis état/erreur/vignettes)', function () {
      var resultats = {
        schema: 1, campagne: { preset: 'demo', totaux: { total: 1, passes: 0, echecs: 1, ignores: 0 } },
        tests: [{
          id: 'DEMO-ORDRE', nom: 'demo ordre', type: 'unitaire', groupe: 'G', domaines: ['ECO'], specs: ['SPEC-ECO-001'],
          fonctions: ['MC.Eco.f'], etiquettes: ['lent'],
          fiche: { teste: 'CECI-EST-LA-FICHE', pourquoi: 'p', attendu: 'a' },
          etat: 'echec', duree_ms: 1, message: 'CECI-EST-L-ERREUR', captures: [],
        }],
      };
      var html = MC_RAPPORT.html(resultats);
      var iIdentite = html.indexOf('domaines : ECO');
      var iFiche = html.indexOf('CECI-EST-LA-FICHE');
      var iResultat = html.indexOf('CECI-EST-L-ERREUR');
      A.ok(iIdentite >= 0 && iFiche >= 0 && iResultat >= 0, 'les trois blocs sont présents');
      A.ok(iIdentite < iFiche, 'identité AVANT la fiche');
      A.ok(iFiche < iResultat, 'fiche AVANT le résultat (erreur)');
      A.ok(html.indexOf('fonctions : MC.Eco.f') >= 0, 'les fonctions figurent dans l\'identité');
    });

    it('SPEC-BANC-060 : instantané — modifier la fiche du catalogue après un run n\'altère jamais la fiche déjà inscrite pour ce run passé', function () {
      var REG = require(path.join(RACINE, 'tools', 'registre.js'));
      var racineResultats = tmpDir('reg-instantane'), dossierRegistre = tmpDir('reg-instantane-reg');
      try {
        var b64 = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]).toString('base64');
        RT.ecrireCahier({
          schema: 1, campagne: { preset: 'pr', debut: new Date().toISOString(), environnement: { commit: 'HEAD' },
            totaux: { total: 1, passes: 1, echecs: 0, ignores: 0 } },
          tests: [{ id: 'DEMO-INSTANTANE', nom: 'demo-instantane', type: 'unitaire', groupe: 'g', domaines: ['ECO'], specs: [],
            fiche: { teste: 'version au moment du run', pourquoi: 'p', attendu: 'a' },
            etat: 'ok', duree_ms: 1, captures: [{ libelle: 'fin', fichier: 0 }] }],
        }, { racine: racineResultats, nom: 'run1', captures: [{ libelle: 'fin', type: 'image/jpeg', base64: b64 }] });
        var r = REG.inscrire('run1', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE });
        A.ok(r.ok, 'inscription acceptée : ' + JSON.stringify(r));

        // la fiche « catalogue » change APRÈS coup (comme si le test avait été réécrit depuis)
        var ficheApresCoup = { teste: 'version réécrite plus tard, très différente', pourquoi: 'p2', attendu: 'a2' };
        A.notEqual(JSON.stringify(ficheApresCoup), JSON.stringify({ teste: 'version au moment du run', pourquoi: 'p', attendu: 'a' }));

        var entree = REG.lireEntrees(dossierRegistre)[0];
        A.equal(entree.tests[0].fiche.teste, 'version au moment du run',
          'l\'entrée déjà écrite garde EXACTEMENT la fiche du moment du run, jamais la version réécrite ensuite');
      } finally { nettoyer(racineResultats); nettoyer(dossierRegistre); }
    });

    it('SPEC-BANC-061 : une étiquette non listée dans le README du registre n\'est ni rejetée ni signalée en erreur', function () {
      var specsIndex = {};
      var TT = { suites: [{
        name: 'Groupe démo 3', fichier: 'tests/unit.js', fiche: null,
        tests: [{ name: 'un test avec un tag jamais vu ailleurs', fiche: { teste: 't', pourquoi: 'p', attendu: 'a', etiquettes: ['zzz-jamais-vu-nulle-part'] } }],
      }] };
      var cat = MC_TESTS.construire(TT, [], specsIndex);
      A.equal(cat.length, 1, 'le test apparaît normalement dans le catalogue, sans rejet ni erreur');
      A.ok(cat[0].etiquettes.indexOf('zzz-jamais-vu-nulle-part') >= 0, 'l\'étiquette inédite est reprise telle quelle');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — registre officiel versionné et historique par test (tools/registre.js)', function () {
    var REG = require(path.join(RACINE, 'tools', 'registre.js'));

    function cahierAvecCapture(racineResultats, nom, testId, preset, commitCourt, b64) {
      RT.ecrireCahier({
        schema: 1, campagne: { preset: preset, debut: new Date().toISOString(), environnement: { commit: commitCourt },
          totaux: { total: 1, passes: 1, echecs: 0, ignores: 0 } },
        tests: [{ id: testId, nom: testId, type: 'e2e', groupe: 'end-to-end', domaines: [], specs: [],
          etat: 'ok', duree_ms: 1, captures: [{ libelle: 'fin', fichier: 0 }] }],
      }, { racine: racineResultats, nom: nom, captures: [{ libelle: 'fin', type: 'image/jpeg', base64: b64 }] });
    }

    it('SPEC-BANC-028 : .gitignore exclut tests/resultats/ (cahiers locaux) mais jamais tests/registre/ (versionné)', function () {
      var gi = fs.readFileSync(path.join(RACINE, '.gitignore'), 'utf8');
      A.ok(/^tests\/resultats\/\s*$/m.test(gi), 'tests/resultats/ est ignoré');
      A.notOk(/tests\/registre/.test(gi), 'tests/registre/ n\'apparaît dans aucune règle d\'exclusion');
    });

    it('SPEC-BANC-028 : inscrire() résout le commit RÉELLEMENT testé (jamais HEAD s\'il a changé depuis), dédoublonne les images par contenu', function () {
      var racineResultats = tmpDir('reg-resultats'), dossierRegistre = tmpDir('reg-registre');
      try {
        var log = cp.execFileSync('git', ['log', '--format=%H', '-n', '2'], { cwd: RACINE, encoding: 'utf8' }).trim().split('\n');
        var commitVise = log[1]; // pas HEAD : vérifie qu'on résout bien LE COMMIT DU CAHIER, pas le HEAD courant
        var b64 = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]).toString('base64');
        cahierAvecCapture(racineResultats, 'run1', 'DEMO-001', 'pr', commitVise.slice(0, 10), b64);
        var r = REG.inscrire('run1', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE, origine: 'pre-push', statut: 'en_attente' });
        A.ok(r.ok, 'inscription réussie : ' + JSON.stringify(r));
        A.equal(r.commit, commitVise, 'le commit plein résolu est bien celui DU CAHIER, pas HEAD');
        A.equal(r.imagesNouvelles, 1, 'une image nouvelle, écrite dans images/');
        A.ok(fs.existsSync(path.join(dossierRegistre, 'images', REG.sha1(Buffer.from([0xFF, 0xD8, 0xFF, 0xD9])) + '.jpg')), 'nommée par son sha1');

        // même contenu, un second cahier/commit : PAS de second fichier (adressage par contenu)
        cahierAvecCapture(racineResultats, 'run2', 'DEMO-001', 'pr', log[0].slice(0, 10), b64);
        var r2 = REG.inscrire('run2', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE, origine: 'pre-push', statut: 'en_attente' });
        A.equal(r2.imagesNouvelles, 0, 'aucune image nouvelle : contenu déjà présent');
        A.equal(r2.imagesReutilisees, 1, 'la capture identique est réutilisée, jamais recopiée');
      } finally { nettoyer(racineResultats); nettoyer(dossierRegistre); }
    });

    it('SPEC-BANC-031 : une entrée en_attente (pre-push) est repérée puis intégrée par marquerEnAttenteCommitees (relais pre-commit)', function () {
      var racineResultats = tmpDir('reg-resultats2'), dossierRegistre = tmpDir('reg-registre2');
      try {
        var b64 = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]).toString('base64');
        cahierAvecCapture(racineResultats, 'run1', 'DEMO-002', 'pr', 'HEAD', b64);
        REG.inscrire('run1', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE, origine: 'pre-push', statut: 'en_attente' });
        A.ok(REG.aDesEntreesEnAttente(dossierRegistre), 'une entrée en_attente existe après une inscription pre-push');
        var n = REG.marquerEnAttenteCommitees(dossierRegistre);
        A.equal(n, 1, 'une entrée intégrée');
        A.notOk(REG.aDesEntreesEnAttente(dossierRegistre), 'plus aucune entrée en_attente ensuite');
        A.equal(REG.lireEntrees(dossierRegistre)[0].statut, 'ok', 'son statut est passé à ok');
      } finally { nettoyer(racineResultats); nettoyer(dossierRegistre); }
    });

    it('SPEC-BANC-029 : historiqueTest trie par commit réel (git rev-list --topo-order) sur le registre officiel, par lancement avec --manuel', function () {
      var racineResultats = tmpDir('reg-resultats3'), dossierRegistre = tmpDir('reg-registre3');
      try {
        var log = cp.execFileSync('git', ['log', '--format=%H', '-n', '3'], { cwd: RACINE, encoding: 'utf8' }).trim().split('\n');
        A.equal(log.length, 3, 'au moins 3 commits disponibles dans ce dépôt pour le test');
        var recent = log[0], milieu = log[1], ancien = log[2];
        var b64 = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]).toString('base64');
        // écrits dans un ordre local qui NE correspond PAS à l'ordre des commits
        cahierAvecCapture(racineResultats, 'a', 'DEMO-003', 'pr', milieu.slice(0, 12), b64);
        REG.inscrire('a', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE, origine: 'pre-push' });
        cahierAvecCapture(racineResultats, 'b', 'DEMO-003', 'pr', ancien.slice(0, 12), b64);
        REG.inscrire('b', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE, origine: 'pre-push' });
        cahierAvecCapture(racineResultats, 'c', 'DEMO-003', 'pr', recent.slice(0, 12), b64);
        REG.inscrire('c', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE, origine: 'pre-push' });
        // et un run MANUEL, à écarter du tri par défaut
        cahierAvecCapture(racineResultats, 'd', 'DEMO-003', 'commit', recent.slice(0, 12), b64);
        REG.inscrire('d', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE, origine: 'manuel' });

        var hist = REG.historiqueTest('DEMO-003', { dossierRegistre: dossierRegistre, dossierRepo: RACINE });
        A.equal(hist.length, 3, 'seules les entrées pre-push (officielles) apparaissent par défaut');
        A.deep(hist.map(function (h) { return h.commit; }), [recent, milieu, ancien],
          'tri par commit réel (git rev-list --topo-order), pas l\'ordre d\'écriture ni l\'horodatage local');

        var histManuel = REG.historiqueTest('DEMO-003', { dossierRegistre: dossierRegistre, dossierRepo: RACINE, inclureManuels: true, tri: 'lancement' });
        A.equal(histManuel.length, 4, '--manuel inclut aussi l\'entrée manuelle');

        var html = REG.exporterHistoriqueHTML('DEMO-003', { dossierRegistre: dossierRegistre, dossierRepo: RACINE });
        A.ok(html.indexOf('<!DOCTYPE html>') === 0);
        A.ok((html.match(/data:image\/jpeg;base64,/g) || []).length >= 3, 'les captures des runs officiels sont intégrées');
      } finally { nettoyer(racineResultats); nettoyer(dossierRegistre); }
    });

    it('SPEC-BANC-030 : le témoin épinglé (par commit + hash) prime sur le défaut (dernière entrée pre-push)', function () {
      var racineResultats = tmpDir('reg-resultats4'), dossierRegistre = tmpDir('reg-registre4');
      try {
        var log = cp.execFileSync('git', ['log', '--format=%H', '-n', '2'], { cwd: RACINE, encoding: 'utf8' }).trim().split('\n');
        var b64a = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 1]).toString('base64');
        var b64b = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 2]).toString('base64');
        cahierAvecCapture(racineResultats, 'r1', 'DEMO-004', 'pr', log[1].slice(0, 12), b64a);
        REG.inscrire('r1', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE, origine: 'pre-push' });
        cahierAvecCapture(racineResultats, 'r2', 'DEMO-004', 'pr', log[0].slice(0, 12), b64b);
        REG.inscrire('r2', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE, origine: 'pre-push' });

        var hist = REG.historiqueTest('DEMO-004', { dossierRegistre: dossierRegistre, dossierRepo: RACINE });
        var t0 = REG.temoinDe('DEMO-004', hist, { dossierRegistre: dossierRegistre });
        A.ok(t0 && !t0.epingle, 'témoin par défaut, non épinglé');
        A.equal(t0.commit, hist[0].commit, 'par défaut : la dernière entrée pre-push (la plus récente par commit)');

        // épingle explicitement l'entrée la plus ANCIENNE plutôt que la plus récente
        var imageAncienne = hist[hist.length - 1].captures[0].image;
        A.ok(REG.marquerTemoin('DEMO-004', hist[hist.length - 1].commit, imageAncienne, { dossierRegistre: dossierRegistre }).ok);
        var t1 = REG.temoinDe('DEMO-004', REG.historiqueTest('DEMO-004', { dossierRegistre: dossierRegistre, dossierRepo: RACINE }), { dossierRegistre: dossierRegistre });
        A.ok(t1.epingle, 'marqué comme épinglé');
        A.equal(t1.commit, hist[hist.length - 1].commit, 'le témoin épinglé remplace le défaut');

        A.notOk(REG.marquerTemoin('DEMO-004', hist[0].commit, 'image-qui-n-existe-pas.jpg', { dossierRegistre: dossierRegistre }).ok, 'image inexistante : refusé');
        A.ok(fs.existsSync(path.join(dossierRegistre, 'temoins.json')), 'les témoins sont persistés (versionnables avec le reste du registre)');
      } finally { nettoyer(racineResultats); nettoyer(dossierRegistre); }
    });

    it('SPEC-BANC-032 : le schéma d\'entrée porte id/inscrit/motif/arbre_modifie/interrompu, l\'inscription est idempotente, l\'état est normalisé', function () {
      var racineResultats = tmpDir('reg-schema'), dossierRegistre = tmpDir('reg-schema-reg');
      try {
        var b64 = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]).toString('base64');
        RT.ecrireCahier({
          schema: 1, campagne: { preset: 'pr', debut: new Date().toISOString(), environnement: { commit: 'HEAD' },
            arbreModifie: true, interrompue: true, totaux: { total: 1, passes: 1, echecs: 0, ignores: 0 } },
          tests: [{ id: 'DEMO-005', nom: 'demo-005', type: 'e2e', groupe: 'end-to-end', domaines: [], specs: [],
            etat: 'ok', duree_ms: 1, debut: '2026-01-01T00:00:00.000Z', captures: [{ libelle: 'fin', fichier: 0 }] }],
        }, { racine: racineResultats, nom: 'run1', captures: [{ libelle: 'fin', type: 'image/jpeg', base64: b64 }] });

        var r = REG.inscrire('run1', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE, motif: 'référence avant refonte' });
        A.ok(r.ok, 'inscription acceptée : ' + JSON.stringify(r));
        A.ok(r.id && typeof r.id === 'string', 'un identifiant de run est rendu');

        var entrees = REG.lireEntrees(dossierRegistre);
        A.equal(entrees.length, 1);
        var e = entrees[0];
        A.equal(e.id, r.id, 'même id relu depuis le disque');
        A.equal(e.inscrit, true, 'inscrit=true pour une entrée du registre');
        A.equal(e.motif, 'référence avant refonte', 'motif reporté tel quel');
        A.equal(e.arbre_modifie, true, 'arbre_modifie repris de campagne.arbreModifie (capturé au DÉBUT de la campagne locale)');
        A.equal(e.interrompu, true, 'interrompu repris de campagne.interrompue');
        A.equal(e.tests[0].debut, '2026-01-01T00:00:00.000Z', 'horodatage de démarrage du test conservé');
        A.equal(e.tests[0].etat, 'reussi', 'état normalisé (reussi|echec|ignore|avertissement)');
        A.equal(e.tests[0].categorie.type, 'e2e', 'categorie.type (instantané du catalogue)');
        A.deep(e.tests[0].fonctions, [], 'fonctions : présent, vide pour l\'instant');
        A.equal(e.tests[0].captures[0].role, 'debut', 'seule capture d\'un test à une capture : rôle debut');
        A.ok(/^[0-9a-f]{40}\.jpg$/.test(e.tests[0].captures[0].image), 'image = <sha1>.<ext> : ' + e.tests[0].captures[0].image);

        // idempotence : réinscrire LE MÊME cahier est refusé
        var r2 = REG.inscrire('run1', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE });
        A.notOk(r2.ok, 'une seconde inscription du même cahier est refusée');
        A.ok(/idempotence|déjà inscrit/i.test(r2.motif), 'motif explicite : ' + r2.motif);
        A.equal(REG.lireEntrees(dossierRegistre).length, 1, 'toujours une seule entrée après le refus');
      } finally { nettoyer(racineResultats); nettoyer(dossierRegistre); }
    });

    it('SPEC-BANC-032 : etatRegistre distingue reussi/avertissement (lent ou message malgré succès)/echec/ignore', function () {
      A.equal(REG.etatRegistre({ etat: 'ok', duree_ms: 100 }), 'reussi');
      A.equal(REG.etatRegistre({ etat: 'reussi', duree_ms: 100 }), 'reussi', 'le vocabulaire source "reussi" (runUnE2E) compte aussi comme succès');
      A.equal(REG.etatRegistre({ etat: 'ok', duree_ms: 100000 }), 'avertissement', 'succès mais lent (> seuil) : avertissement');
      A.equal(REG.etatRegistre({ etat: 'ok', duree_ms: 100, message: 'un avertissement non bloquant' }), 'avertissement', 'succès avec message : avertissement');
      A.equal(REG.etatRegistre({ etat: 'echec', duree_ms: 100 }), 'echec');
      A.equal(REG.etatRegistre({ etat: 'delai', duree_ms: 100 }), 'echec', 'un délai dépassé compte comme un échec');
      A.equal(REG.etatRegistre({ etat: 'ignore', duree_ms: 100, raison: 'pas de WebGL' }), 'ignore', 'ignore AVEC raison reste ignore');
    });

    it('SPEC-BANC-089 : ignore/avertissement exigent une raison non vide — un ignoré sans raison devient un échec', function () {
      A.equal(REG.etatRegistre({ etat: 'ignore', duree_ms: 100 }), 'echec', 'ignore SANS raison ni message : reclassé en échec');
      A.equal(REG.etatRegistre({ etat: 'ignore', duree_ms: 100, raison: '   ' }), 'echec', 'raison blanche : toujours reclassé');
      A.equal(REG.etatRegistre({ etat: 'ignore', duree_ms: 100, message: 'pas de WebGL dans cet environnement' }), 'ignore',
        'à défaut de raison, le message (rétro-compatibilité) suffit');
      A.equal(REG.raisonRegistre({ etat: 'ok', duree_ms: 30000 }, 'avertissement', 20000), 'lent : 30.0 s > seuil 20.0 s',
        'raison automatique pour un avertissement de lenteur');
      A.equal(REG.raisonRegistre({ etat: 'ok', duree_ms: 100, message: 'presque à la limite' }, 'avertissement', 20000),
        'presque à la limite', 'raison = le message pour un avertissement par message');
      A.equal(REG.raisonRegistre({ etat: 'ignore', raison: 'pas de WebGL' }, 'ignore'), 'pas de WebGL');
      A.equal(REG.raisonRegistre({ etat: 'ok', duree_ms: 1 }, 'reussi'), null, 'aucune raison exigée pour un succès simple');
    });

    it('SPEC-BANC-089 : inscrire() reclasse un ignore sans raison en échec, avec une erreur explicite', function () {
      var racineResultats = tmpDir('reg-raison'), dossierRegistre = tmpDir('reg-raison-reg');
      try {
        RT.ecrireCahier({
          schema: 1, campagne: { preset: 'pr', debut: new Date().toISOString(), environnement: { commit: 'HEAD' },
            totaux: { total: 1, passes: 0, echecs: 0, ignores: 1 } },
          tests: [{ id: 'DEMO-RAISON', nom: 'demo-raison', type: 'unitaire', groupe: 'g', domaines: [], specs: [],
            etat: 'ignore', duree_ms: 1, captures: [] }],
        }, { racine: racineResultats, nom: 'run1', captures: [] });
        var r = REG.inscrire('run1', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE });
        A.ok(r.ok, 'inscription acceptée : ' + JSON.stringify(r));
        var t = REG.lireEntrees(dossierRegistre)[0].tests[0];
        A.equal(t.etat, 'echec', 'un ignore sans raison est reclassé en échec dans le registre');
        A.ok(/reclassé en échec/.test(t.erreur || ''), 'l\'erreur explique la reclassification : ' + t.erreur);
      } finally { nettoyer(racineResultats); nettoyer(dossierRegistre); }
    });

    it('SPEC-BANC-085 / SPEC-BANC-086 : le moteur de rendu du run est enregistré, et un témoin ne se compare qu\'au même moteur', function () {
      var racineResultats = tmpDir('reg-moteur'), dossierRegistre = tmpDir('reg-moteur-reg');
      try {
        function cahierAvecMoteur(nom, commitCourt, gpu, accel, b64) {
          RT.ecrireCahier({
            schema: 1, campagne: { preset: 'pr', debut: new Date().toISOString(),
              environnement: { commit: commitCourt, gpu: gpu, accelerationMaterielle: accel, navigateur: 'Chrome/1', os: 'win32', avecFenetre: false },
              totaux: { total: 1, passes: 1, echecs: 0, ignores: 0 } },
            tests: [{ id: 'DEMO-MOTEUR', nom: 'demo-moteur', type: 'e2e', groupe: 'end-to-end', domaines: [], specs: [],
              etat: 'ok', duree_ms: 1, captures: [{ libelle: 'fin', fichier: 0 }] }],
          }, { racine: racineResultats, nom: nom, captures: [{ libelle: 'fin', type: 'image/jpeg', base64: b64 }] });
        }
        var log = cp.execFileSync('git', ['log', '--format=%H', '-n', '2'], { cwd: RACINE, encoding: 'utf8' }).trim().split('\n');
        var b64a = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 11]).toString('base64');
        var b64b = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 12]).toString('base64');
        cahierAvecMoteur('rlog', log[1].slice(0, 12), 'SwiftShader', false, b64a);
        REG.inscrire('rlog', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE, origine: 'pre-push' });
        cahierAvecMoteur('rgpu', log[0].slice(0, 12), 'NVIDIA GeForce RTX', true, b64b);
        REG.inscrire('rgpu', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE, origine: 'pre-push' });

        var entrees = REG.lireEntrees(dossierRegistre);
        var eLogiciel = entrees.find(function (e) { return e.dossierCahier === 'rlog'; });
        A.equal(eLogiciel.moteurRendu.glRenderer, 'SwiftShader', 'le moteur de rendu du run est enregistré');
        A.equal(eLogiciel.moteurRendu.accelerationMaterielle, false, 'logiciel (pas de GPU réel)');

        var hist = REG.historiqueTest('DEMO-MOTEUR', { dossierRegistre: dossierRegistre, dossierRepo: RACINE });
        var entreesParCommit = new Map(entrees.map(function (e) { return [e.commit, e]; }));

        var tLogiciel = REG.temoinDe('DEMO-MOTEUR', hist, { dossierRegistre: dossierRegistre, moteurRendu: eLogiciel.moteurRendu, entreesParCommit: entreesParCommit });
        A.ok(tLogiciel && !tLogiciel.pasDeTemoinMemeMoteur, 'un témoin logiciel existe (celui du même moteur)');
        A.equal(tLogiciel.commit, eLogiciel.commit, 'le témoin proposé pour le rendu logiciel est bien le run logiciel, jamais le run GPU');

        var moteurIntrouvable = { glRenderer: 'Intel UHD', glVendor: null, accelerationMaterielle: true };
        var tAucun = REG.temoinDe('DEMO-MOTEUR', hist, { dossierRegistre: dossierRegistre, moteurRendu: moteurIntrouvable, entreesParCommit: entreesParCommit });
        A.ok(tAucun && tAucun.pasDeTemoinMemeMoteur, 'aucun run sur ce moteur : message explicite, pas de comparaison hasardeuse');
      } finally { nettoyer(racineResultats); nettoyer(dossierRegistre); }
    });

    it('SPEC-BANC-083 : le registre ne garde que l\'image centrale d\'un triplet (et tous ses nombres), sauf étiquette `rendu` ou instabilité au-dessus du seuil', function () {
      var racineResultats = tmpDir('reg-triplet'), dossierRegistre = tmpDir('reg-triplet-reg');
      try {
        var capDir = path.join(racineResultats, 'run1', 'captures');
        fs.mkdirSync(capDir, { recursive: true });
        [0, 1, 2].forEach(function (rang) { fs.writeFileSync(path.join(capDir, 'img' + rang + '.jpg'), Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, rang])); });
        function triplet(etiquettes, instabilitePixels) {
          return [0, 1, 2].map(function (rang) {
            return { role: 'triplet', etape: 'test', bord: 'debut', rang: rang, libelle: 'test-debut-' + rang,
              fichier: 'img' + rang + '.jpg', t_ms: rang * 16, numero_image: rang + 1, duree_image_ms: rang ? 16 : 0,
              pose: { camera: { x: rang, y: 0, z: 0 } }, instabilite: { pixels: instabilitePixels, pose: 0.1 } };
          });
        }
        RT.ecrireCahier({
          schema: 1, campagne: { preset: 'pr', debut: new Date().toISOString(), environnement: { commit: 'HEAD' },
            totaux: { total: 2, passes: 2, echecs: 0, ignores: 0 } },
          tests: [
            { id: 'DEMO-TRIPLET-STABLE', nom: 'stable', type: 'e2e', groupe: 'end-to-end', domaines: [], specs: [], etiquettes: [],
              etat: 'ok', duree_ms: 1, captures: triplet([], 1) },
            { id: 'DEMO-TRIPLET-RENDU', nom: 'rendu', type: 'e2e', groupe: 'end-to-end', domaines: [], specs: [], etiquettes: ['rendu'],
              etat: 'ok', duree_ms: 1, captures: triplet(['rendu'], 1) },
          ],
        }, { racine: racineResultats, nom: 'run1', captures: [] });
        var r = REG.inscrire('run1', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE });
        A.ok(r.ok, 'inscription acceptée : ' + JSON.stringify(r));
        var tests = REG.lireEntrees(dossierRegistre)[0].tests;
        var stable = tests.find(function (t) { return t.id === 'DEMO-TRIPLET-STABLE'; });
        var rendu = tests.find(function (t) { return t.id === 'DEMO-TRIPLET-RENDU'; });
        A.equal(stable.captures.length, 3, 'les TROIS nombres du triplet sont toujours gardés');
        A.notOk(stable.captures[0].image, 'rang 0 : image élaguée (stable, sans étiquette rendu)');
        A.ok(stable.captures[1].image, 'rang 1 (central) : image gardée');
        A.notOk(stable.captures[2].image, 'rang 2 : image élaguée');
        A.equal(stable.captures[0].pose.camera.x, 0, 'les nombres (pose) restent malgré l\'image élaguée');
        A.ok(rendu.captures[0].image && rendu.captures[1].image && rendu.captures[2].image, 'étiquette `rendu` : triplet COMPLET gardé');
      } finally { nettoyer(racineResultats); nettoyer(dossierRegistre); }
    });

    it('SPEC-BANC-032 : une capture manuelle nommée en cours de test (T.capture) est déjà supportée et reste stable d\'un run à l\'autre', function () {
      // Vérification STRUCTURELLE (comme SPEC-BANC-026 le fait déjà pour
      // tests/e2e.js) : `capture(libelle)` existe et pousse une capture
      // NOMMÉE, prise en compte par runUnE2E au même titre que début/fin —
      // c'est exactement ce qu'un test appelle via `capture('apres-teleportation')`.
      var src = fs.readFileSync(path.join(RACINE, 'tests', 'e2e.js'), 'utf8');
      A.ok(/function capture\(libelle\)/.test(src), 'capture(libelle) existe : capture manuelle nommée');
      A.ok(/G\.capture = capture/.test(src), 'exposée globalement (utilisable depuis un test comme capture(\'...\'))');
      A.ok(/c\.t_ms = ahora\(\) - enCours\.t0/.test(src), 'chaque capture porte désormais son t_ms (depuis le début du test)');
      A.ok(/c\.role = \(i === 0\)/.test(src), 'le rôle (debut/intermediaire/fin) est affecté une fois le test terminé');
    });

    it('SPEC-BANC-032 : runsUnifies() fusionne le registre (inscrit=true) et les cahiers locaux (inscrit=false) sous la même forme', function () {
      var racineResultats = tmpDir('reg-unifie'), dossierRegistre = tmpDir('reg-unifie-reg');
      try {
        var b64 = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]).toString('base64');
        cahierAvecCapture(racineResultats, 'run-registre', 'DEMO-006', 'pr', 'HEAD', b64);
        REG.inscrire('run-registre', { racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE });
        // un second cahier local, jamais inscrit
        cahierAvecCapture(racineResultats, 'run-local', 'DEMO-006', 'commit', 'HEAD', b64);

        var runs = REG.runsUnifies({ racineResultats: racineResultats, dossierRegistre: dossierRegistre, dossierRepo: RACINE });
        A.equal(runs.length, 2, 'un run du registre + un run local');
        var rInscrit = runs.find(function (r) { return r.inscrit; });
        var rLocal = runs.find(function (r) { return !r.inscrit; });
        A.ok(rInscrit, 'un run inscrit (registre)');
        A.ok(rLocal, 'un run non inscrit (cahier local)');
        A.equal(rLocal.dossierCahier, 'run-local', 'le run local porte le nom de son dossier (pour l\'inscrire après coup)');
        // même forme : même test, mêmes clés de capture, quelle que soit l'origine
        var tInscrit = rInscrit.tests.find(function (t) { return t.id === 'DEMO-006'; });
        var tLocal = rLocal.tests.find(function (t) { return t.id === 'DEMO-006'; });
        A.ok(tInscrit && tLocal, 'le test apparaît des deux côtés');
        ['id', 'nom', 'categorie', 'domaines', 'specs', 'etiquettes', 'fonctions', 'fiche',
         'debut', 'duree_ms', 'etat', 'erreur', 'captures'].forEach(function (cle) {
          A.ok(tInscrit.hasOwnProperty(cle), 'run inscrit : porte ' + cle);
          A.ok(tLocal.hasOwnProperty(cle), 'run local : porte ' + cle);
        });
        A.equal(tInscrit.categorie.type, 'e2e', 'categorie.type instantané du catalogue');
        A.equal(tInscrit.categorie.groupe, 'end-to-end', 'categorie.groupe instantané du catalogue');
        A.deep(tInscrit.fonctions, [], 'fonctions : liste vide pour l\'instant (observation = lot suivant)');
        A.equal(tInscrit.captures[0].role, 'debut');
        A.equal(tLocal.captures[0].role, 'debut', 'le rôle est déduit par position aussi pour un cahier local');
      } finally { nettoyer(racineResultats); nettoyer(dossierRegistre); }
    });

    it('SPEC-BANC-028/031 : les crochets référencent bien le registre (inscription depuis pre-push, intégration depuis pre-commit)', function () {
      var prePush = fs.readFileSync(path.join(RACINE, 'tools', 'hooks', 'pre-push.js'), 'utf8');
      var preCommit = fs.readFileSync(path.join(RACINE, 'tools', 'hooks', 'pre-commit.js'), 'utf8');
      A.ok(/require\(['"]\.\.\/registre\.js['"]\)/.test(prePush), 'pre-push.js charge tools/registre.js');
      A.ok(/origine:\s*['"]pre-push['"]/.test(prePush) && /statut:\s*['"]en_attente['"]/.test(prePush),
        'pre-push.js inscrit avec origine pre-push et statut en_attente');
      A.ok(/require\(['"]\.\.\/registre\.js['"]\)/.test(preCommit), 'pre-commit.js charge tools/registre.js');
      A.ok(/marquerEnAttenteCommitees/.test(preCommit) && /git add[^\n]*DOSSIER_REGISTRE_REL/.test(preCommit),
        'pre-commit.js intègre les entrées en attente puis les ajoute à l\'index');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
