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
      var IGNORES = { bugs: true, integration: true, limites: true, visuel: true };
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
})(typeof globalThis !== 'undefined' ? globalThis : this);
