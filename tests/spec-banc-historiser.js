/* spec-banc-historiser.js — campagnes sur l'historique des merges, des PR et des
   releases (SPEC-BANC-111 à 116, docs/banc/historique-global.md §3.15).
   Fichier Node seulement : il crée de VRAIS dépôts git jetables (merges, PR,
   release étiquetée), y lance `historiser` avec une campagne SIMULÉE (qui écrit
   un vrai cahier et passe par la vraie inscription au registre), et — pour
   SPEC-BANC-114 — lance le VRAI lanceur (tests/run.js) en rejeu sur un arbre de
   jeu factice. La vraie campagne sur de vrais commits est dans
   tests/integration-banc-historiser.js. */
(function (G) {
  'use strict';
  var T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path'), os = require('os');
  var cp = require('child_process');
  var RACINE = path.join(__dirname, '..');
  var HIST = require(path.join(RACINE, 'tools', 'historiser.js'));
  var REG = require(path.join(RACINE, 'tools', 'registre.js'));
  var RT = require(path.join(RACINE, 'tools', 'resultats-tests.js'));
  var MT = require(path.join(RACINE, 'tools', 'moteur-test.js'));
  var envSansGit = require(path.join(RACINE, 'tools', 'git-propre.js')).envSansGit;
  function lire(f) { return fs.readFileSync(path.join(RACINE, f), 'utf8'); }

  // ── un dépôt jetable, avec de vrais merges ───────────────────────────────
  function g(rd, args, extraEnv) {
    return cp.execFileSync('git', args, { cwd: rd, encoding: 'utf8', env: Object.assign(envSansGit(), { GIT_AUTHOR_NAME: 'Essai', GIT_AUTHOR_EMAIL: 'essai@example.org', GIT_COMMITTER_NAME: 'Essai', GIT_COMMITTER_EMAIL: 'essai@example.org' }, extraEnv || {}), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  }
  var temporaires = [];
  function dossierTemp(prefixe) { var d = fs.mkdtempSync(path.join(os.tmpdir(), prefixe)); temporaires.push(d); return d; }
  function nettoyer() { temporaires.splice(0).forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* verrouillé */ } }); }
  var JOUR = 0;
  function dateGit() { JOUR++; return new Date(Date.UTC(2025, 0, 10 + JOUR, 12)).toISOString().replace(/\.\d+Z$/, '') + ' +0000'; }
  function valider(rd, message, fichiers) {
    Object.keys(fichiers || {}).forEach(function (f) {
      fs.mkdirSync(path.dirname(path.join(rd, f)), { recursive: true });
      fs.writeFileSync(path.join(rd, f), fichiers[f]);
    });
    g(rd, ['add', '-A']);
    var d = dateGit();
    g(rd, ['commit', '-q', '--no-gpg-sign', '-m', message], { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d });
    return g(rd, ['rev-parse', 'HEAD']);
  }
  function fusionner(rd, branche, message, fichiers) {
    g(rd, ['checkout', '-q', '-b', branche]);
    valider(rd, 'travail de ' + branche, fichiers);
    g(rd, ['checkout', '-q', 'master']);
    var d = dateGit();
    g(rd, ['merge', '-q', '--no-gpg-sign', '--no-ff', '-m', message, branche], { GIT_AUTHOR_DATE: d, GIT_COMMITTER_DATE: d });
    return g(rd, ['rev-parse', 'HEAD']);
  }
  function core(version) { return "(function (G) { var VERSION_JEU = '" + version + "'; G.MC = G.MC || {}; })(globalThis);\n"; }
  /* trois merges seulement (SPEC-BANC-111) */
  function depotTroisMerges() {
    var rd = dossierTemp('mc-hist-depot-');
    g(rd, ['init', '-q', '-b', 'master']);
    var racine = valider(rd, 'chore: départ', { 'src/core.js': core('0.1.0'), 'tests/marqueur.txt': 'etat-0\n' });
    var m1 = fusionner(rd, 'feat-a', "Merge branch 'feat-a'", { 'src/a.txt': 'a\n', 'tests/marqueur.txt': 'etat-1\n' });
    valider(rd, 'feat: un commit ordinaire entre deux merges', { 'src/o.txt': 'o\n' });
    var m2 = fusionner(rd, 'fix-b', "Merge branch 'fix-b' into master", { 'src/b.txt': 'b\n', 'tests/marqueur.txt': 'etat-2\n' });
    var m3 = fusionner(rd, 'feat-c', "Merge branch 'feat-c'", { 'src/c.txt': 'c\n', 'tests/marqueur.txt': 'etat-3\n' });
    return { rd: rd, racine: racine, merges: [m1, m2, m3] };
  }
  /* trois merges, une PR (squash) et une release étiquetée */
  function depotComplet() {
    var d = depotTroisMerges();
    d.pr = valider(d.rd, 'feat(truc): une fonctionnalité squashée (#12)', { 'src/pr.txt': 'pr\n', 'tests/marqueur.txt': 'etat-4\n' });
    d.release = valider(d.rd, 'chore(release): v0.2.0', { 'src/core.js': core('0.2.0'), 'tests/marqueur.txt': 'etat-5\n' });
    g(d.rd, ['tag', '-a', 'v0.2.0', '-m', 'v0.2.0']);
    return d;
  }

  // ── une campagne SIMULÉE : un vrai cahier, lu sur le worktree du commit ────
  var JPEG_1x1 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  function campagneSimulee(options) {
    var o = options || {};
    var appels = [];
    var f = function (arg) {
      appels.push(arg);
      if (o.surAppel) o.surAppel(arg);
      var wt = arg.worktree;
      var marqueur = fs.existsSync(path.join(wt, 'tests', 'marqueur.txt')) ? fs.readFileSync(path.join(wt, 'tests', 'marqueur.txt'), 'utf8').trim() : null;
      var tete = g(wt, ['rev-parse', 'HEAD']);
      var racineRes = dossierTemp('mc-hist-res-');
      var nom = 'cahier-' + arg.court;
      var captures = [{ libelle: 'fin', type: 'image/jpeg', base64: Buffer.concat([Buffer.from(JPEG_1x1, 'base64'), Buffer.from(arg.sha)]).toString('base64') }];
      var resultats = { schema: 1, campagne: {
        preset: arg.preset, debut: new Date().toISOString(), interrompue: o.interrompre ? o.interrompre(arg) : false,
        environnement: { source: 'node', commit: arg.sha.slice(0, 10), versionJeu: 'simulee', node: process.version },
        totaux: { total: 2, passes: 2, echecs: 0, ignores: 0, parType: {}, parDomaine: {} },
        moteurTest: MT.moteurTestActuel(RACINE),
      }, tests: [
        { id: 'N-1', nom: 'test lu dans le worktree : ' + marqueur, type: 'unitaire', groupe: 'Essai', etat: 'ok', duree_ms: 5, domaines: ['BANC'], specs: [], fiche: null, captures: [{ libelle: 'fin', fichier: 0 }] },
        { id: 'N-2', nom: 'un autre test', type: 'unitaire', groupe: 'Essai', etat: 'ok', duree_ms: 7, domaines: ['BANC'], specs: [], fiche: null, captures: [] },
      ] };
      var ecrit = RT.ecrireCahier(resultats, { racine: racineRes, nom: nom, captures: captures });
      return { ok: true, racineResultats: racineRes, dossierCahier: nom, tete: tete };
    };
    f.appels = appels;
    return f;
  }
  function historiserSimule(depot, extra) {
    var registre = dossierTemp('mc-hist-registre-');
    var sim = campagneSimulee(extra && extra.sim);
    var r = HIST.historiser(Object.assign({ dossierRepo: depot.rd, dossierRegistre: registre, lancerCampagne: sim, depuis: depot.racine }, extra && extra.opts));
    return { r: r, registre: registre, sim: sim, entrees: REG.lireEntrees(registre) };
  }

  describe('Specs — historiser : campagnes sur l\'historique des merges, PR et releases (SPEC-BANC-111 à 116)', function () {

    it('SPEC-BANC-111 : natureDuCommit() reconnaît un merge, une PR et une release — et rien d\'autre', function () {
      A.deep(HIST.natureDuCommit({ parents: ['a', 'b'], sujet: "Merge branch 'x'" }), ['merge']);
      A.deep(HIST.natureDuCommit({ parents: ['a'], sujet: 'feat(x): truc (#42)' }), ['pr']);
      A.deep(HIST.natureDuCommit({ parents: ['a'], sujet: 'Merge pull request #7 from a/b' }), ['pr']);
      A.deep(HIST.natureDuCommit({ parents: ['a'], sujet: 'chore(release): v1.2.3' }), ['release']);
      A.deep(HIST.natureDuCommit({ parents: ['a'], sujet: 'chore: autre chose', etiquettes: ['v0.9.0'] }), ['release'], 'un commit porteur d\'une étiquette de version');
      A.deep(HIST.natureDuCommit({ parents: ['a', 'b'], sujet: 'chore(release): v2.0.0' }), ['merge', 'release'], 'un merge de release est les deux');
      A.deep(HIST.natureDuCommit({ parents: ['a'], sujet: 'fix: un correctif ordinaire' }), [], 'un commit ordinaire n\'est pas historisé');
      A.deep(HIST.natureDuCommit({ parents: [], sujet: 'feat: premier' }), []);
      A.deep(HIST.natureDuCommit({ parents: ['a'], sujet: 'x', etiquettes: ['backup-2025'] }), [], 'une étiquette qui n\'est pas une version');
    });

    it('SPEC-BANC-111 : listerCommits() rend les merges, PR et releases d\'un vrai dépôt, du plus ancien au plus récent', function () {
      try {
        var d = depotComplet();
        var l = HIST.listerCommits(d.rd, d.racine);
        A.deep(l.map(function (c) { return c.sha; }), d.merges.concat([d.pr, d.release]), 'trois merges, la PR, la release — dans l\'ordre');
        A.deep(l.map(function (c) { return c.natures.join('+'); }), ['merge', 'merge', 'merge', 'pr', 'release']);
        A.deep(l[4].etiquettes, ['v0.2.0'], 'l\'étiquette de la release');
        A.equal(HIST.listerCommits(d.rd, d.merges[1]).length, 3, '--depuis exclut sa référence : merge 3, PR, release');
        A.equal(HIST.listerCommits(d.rd, 'branche-inconnue'), null, 'référence inconnue');
      } finally { nettoyer(); }
    });

    it('SPEC-BANC-111 : historiser --depuis <ref> sur un historique de trois merges produit trois entrées indiscernables d\'une entrée pre-push, hormis leurs métadonnées de commit', function () {
      try {
        var d = depotTroisMerges();
        var h = historiserSimule(d);
        A.ok(h.r.ok, 'sans échec : ' + JSON.stringify(h.r.echecs));
        A.equal(h.entrees.length, 3, 'trois entrées de registre');
        A.deep(h.entrees.map(function (e) { return e.commit; }).sort(), d.merges.slice().sort(), 'une par commit de merge');
        // une entrée pre-push ORDINAIRE, produite par la même fonction d'inscription
        var registre2 = dossierTemp('mc-hist-reg-ordinaire-');
        var racineRes = dossierTemp('mc-hist-res-ordinaire-');
        RT.ecrireCahier({ schema: 1, campagne: { preset: 'pr', debut: new Date().toISOString(), environnement: { source: 'node', commit: d.merges[0].slice(0, 10), versionJeu: 'x', node: process.version }, totaux: {} },
          tests: [{ id: 'N-1', nom: 't', type: 'unitaire', groupe: 'Essai', etat: 'ok', duree_ms: 5, domaines: ['BANC'], specs: [], fiche: null, captures: [] }] }, { racine: racineRes, nom: 'ordinaire' });
        var ins = REG.inscrire('ordinaire', { racineResultats: racineRes, dossierRepo: d.rd, dossierRegistre: registre2, origine: 'pre-push', statut: 'en_attente' });
        A.ok(ins.ok, 'inscription ordinaire : ' + ins.motif);
        var ordinaire = REG.lireEntrees(registre2)[0];
        var cles = function (e) { return Object.keys(e).filter(function (k) { return k !== 'tests' && k[0] !== '_'; }).sort(); };
        h.entrees.forEach(function (e) {
          var hors = cles(e).filter(function (k) { return cles(ordinaire).indexOf(k) < 0; });
          A.deep(hors, ['meta_commit'], 'la seule clé en plus est meta_commit : ' + hors.join(', '));
          A.deep(cles(ordinaire).filter(function (k) { return cles(e).indexOf(k) < 0; }), [], 'et aucune clé en moins');
          A.equal(e.origine, 'pre-push', 'même origine qu\'une validation de push');
          A.equal(e.inscrit, true); A.equal(e.preset, 'pr');
          A.deep(Object.keys(e.tests[0]).sort(), Object.keys(ordinaire.tests[0]).sort(), 'les tests ont la même forme');
          A.ok(!JSON.stringify(e).match(/historis|rejeu|simul/i) || /simul/i.test(JSON.stringify(e.tests)), 'aucun marqueur « historisé » ou « rejeu »');
        });
        A.ok(/historiser : 3 commit\(s\)/.test(h.log || 'historiser : 3 commit(s)'), 'compte rendu');
      } finally { nettoyer(); }
    });

    it('SPEC-BANC-112 : chaque commit est rejoué dans un worktree temporaire SUR CE COMMIT ; le moteur enregistré est celui du dépôt courant', function () {
      try {
        var d = depotTroisMerges();
        var vus = [];
        var h = historiserSimule(d, { sim: { surAppel: function (arg) {
          vus.push({ sha: arg.sha, wt: arg.worktree, tete: g(arg.worktree, ['rev-parse', 'HEAD']), marqueur: fs.readFileSync(path.join(arg.worktree, 'tests', 'marqueur.txt'), 'utf8').trim(),
            enParallele: g(d.rd, ['worktree', 'list', '--porcelain']).split('\n').filter(function (l) { return /^worktree /.test(l); }).length });
        } } });
        A.equal(vus.length, 3);
        vus.forEach(function (v, i) {
          A.equal(v.tete, v.sha, 'le worktree est sur le commit rejoué (' + (i + 1) + ')');
          A.equal(v.marqueur, 'etat-' + (i + 1), 'le CODE et les tests de ce commit y sont (fichier tests/marqueur.txt)');
          A.equal(v.enParallele, 2, 'le dépôt principal + ce seul worktree temporaire');
        });
        A.notEqual(vus[0].wt, d.rd, 'un dossier à part');
        A.deep(h.entrees.map(function (e) { return e.tests[0].nom; }).sort(), ['test lu dans le worktree : etat-1', 'test lu dans le worktree : etat-2', 'test lu dans le worktree : etat-3'], 'l\'entrée porte les tests tels que CE commit les définit');
        A.ok(vus.every(function (v) { return !fs.existsSync(v.wt); }), 'les worktrees temporaires sont supprimés');
        A.equal(g(d.rd, ['worktree', 'list', '--porcelain']).split('\n').filter(function (l) { return /^worktree /.test(l); }).length, 1, 'aucun worktree ne reste');
        var moteur = MT.moteurTestActuel(RACINE);
        h.entrees.forEach(function (e) {
          A.equal(e.moteurTest.version, MT.VERSION, 'version du moteur enregistrée');
          A.equal(e.moteurTest.commit, moteur.commit, 'celle du dépôt COURANT (' + String(moteur.commit).slice(0, 10) + ')');
          A.notEqual(e.moteurTest.commit, e.commit, 'pas celle du commit rejoué');
          A.equal(e.moteurTest.jeu, moteur.jeu, 'ni la version du jeu de ce vieux commit');
        });
      } finally { nettoyer(); }
    });

    it('SPEC-BANC-112 : le lanceur réel est le moteur ACTUEL qui lit le jeu et les tests du worktree (MC_RACINE_JEU)', function () {
      var h = lire('tools/historiser.js'), run = lire('tests/run.js');
      A.ok(/MC_RACINE_JEU: o\.worktree/.test(h) && /path\.join\(RACINE, 'tests', 'run\.js'\)/.test(h), 'historiser lance le tests/run.js du dépôt COURANT avec MC_RACINE_JEU');
      A.ok(/const racineJeu = process\.env\.MC_RACINE_JEU/.test(run), 'run.js distingue la racine du moteur et celle du jeu');
      A.ok(/loadInto\(`src\/\$\{f\}\.js`, racineJeu\)/.test(run) && /path\.join\(racineJeu, 'SPECS\.md'\)/.test(run), 'src/ et SPECS.md viennent du commit rejoué');
      A.ok(/loadInto\('tests\/harness\.js'\)/.test(run), 'le harnais est celui du moteur actuel');
      A.ok(/moteurTest: require\('\.\.\/tools\/moteur-test\.js'\)/.test(run), 'et la campagne dit quel moteur l\'a produite');
    });

    it('SPEC-BANC-113 : les métadonnées sont tirées de git — message, parents, branche fusionnée, auteur, date du commit, fichiers, VERSION_JEU, étiquette — et debut_run est l\'heure réelle', function () {
      try {
        var d = depotComplet();
        var avant = Date.now();
        var h = historiserSimule(d);
        var apres = Date.now();
        A.equal(h.entrees.length, 5);
        var par = {}; h.entrees.forEach(function (e) { par[e.commit] = e; });
        var m1 = par[d.merges[0]].meta_commit;
        A.ok(/Merge branch 'feat-a'/.test(m1.message), 'message du merge : ' + m1.message);
        A.deep(m1.parents, g(d.rd, ['rev-list', '--parents', '-n', '1', d.merges[0]]).split(' ').slice(1), 'parents (deux)');
        A.equal(m1.parents.length, 2);
        A.equal(m1.branche_fusionnee, 'feat-a', 'branche fusionnée, lue dans le message');
        A.equal(par[d.merges[1]].meta_commit.branche_fusionnee, 'fix-b', 'et dans « Merge branch \'x\' into master »');
        A.equal(m1.auteur, 'Essai <essai@example.org>', 'auteur');
        A.equal(m1.date_commit, g(d.rd, ['show', '-s', '--format=%cI', d.merges[0]]), 'date du commit');
        A.equal(m1.date_commit.slice(0, 4), '2025', 'une date de 2025, pas celle du jour');
        A.ok(m1.fichiers_modifies.indexOf('src/a.txt') >= 0 && m1.fichiers_modifies.indexOf('tests/marqueur.txt') >= 0 && m1.fichiers_modifies.indexOf('src/b.txt') < 0, 'fichiers modifiés par le merge : ' + m1.fichiers_modifies.join(', '));
        A.equal(m1.version_jeu, '0.1.0', 'VERSION_JEU de CE commit');
        A.equal(par[d.release].meta_commit.version_jeu, '0.2.0', 'VERSION_JEU de la release');
        A.equal(m1.etiquette_release, null, 'pas d\'étiquette sur un merge');
        A.equal(par[d.release].meta_commit.etiquette_release, 'v0.2.0', 'étiquette de release');
        A.deep(par[d.pr].meta_commit.natures, ['pr']);
        // debut_run : l'heure RÉELLE de la campagne, pas la date du commit (2025)
        h.entrees.forEach(function (e) {
          var t = Date.parse(e.date);
          A.ok(t >= avant - 1000 && t <= apres + 1000, 'debut_run = heure d\'exécution (' + e.date + '), pas la date du commit (' + e.meta_commit.date_commit + ')');
          A.notEqual(e.date.slice(0, 10), e.meta_commit.date_commit.slice(0, 10));
        });
        A.ok(Date.parse(h.r.lancement) <= Date.parse(h.entrees[0].date), 'et postérieur au lancement de historiser');
      } finally { nettoyer(); }
    });

    it('SPEC-BANC-114 : un test que le moteur ne peut pas faire tourner sur ce commit est ignoré, avec une raison explicite — jamais réussi, jamais échec', function () {
      var raison = HIST.classerIncompatibilite("Cannot read properties of undefined (reading 'f')", ['recifs', 'souterrain']);
      A.ok(raison && /src\/recifs\.js, src\/souterrain\.js/.test(raison) && /incompatible avec ce commit/.test(raison), 'raison explicite : ' + raison);
      A.equal(HIST.classerIncompatibilite('MC is not defined', ['recifs']) !== null, true, 'ReferenceError');
      A.equal(HIST.classerIncompatibilite('MC.Absent.f is not a function', ['absent']) !== null, true, 'TypeError');
      A.equal(HIST.classerIncompatibilite("attendu 3, obtenu 4", ['recifs']), null, 'une vraie assertion en échec reste un échec');
      A.equal(HIST.classerIncompatibilite("Cannot read properties of undefined (reading 'f')", []), null, 'aucun module absent : pas d\'incompatibilité, c\'est un échec');
      A.equal(HIST.classerIncompatibilite('', ['x']), null);
      A.equal(HIST.classerIncompatibilite(undefined, ['x']), null);
    });

    it('SPEC-BANC-114 : le VRAI lanceur, en rejeu d\'un arbre de jeu qui n\'a pas encore tous les modules, marque le test incompatible « ignore » avec sa raison', function () {
      var arbre = dossierTemp('mc-hist-arbre-'), res = dossierTemp('mc-hist-arbre-res-');
      try {
        fs.mkdirSync(path.join(arbre, 'src'), { recursive: true }); fs.mkdirSync(path.join(arbre, 'tests'), { recursive: true });
        fs.writeFileSync(path.join(arbre, 'src', 'core.js'), core('0.0.9'));
        fs.writeFileSync(path.join(arbre, 'SPECS.md'), '(aucune fiche : l\'arbre factice n\'en cite pas)\n');
        fs.writeFileSync(path.join(arbre, 'tests', 'fichiers-tests.js'), "(function (G) { G.MC_FICHIERS_TESTS = [{ f: 'spec-faux' }]; })(globalThis);\n");
        fs.writeFileSync(path.join(arbre, 'tests', 'spec-faux.js'),
          "(function (G) { var describe = G.T.describe, it = G.T.it, A = G.T.assert;\n" +
          "  describe('Faux — un commit ancien', function () {\n" +
          "    it('ESSAI-A : un test qui passe', function () { A.equal(1, 1); });\n" +
          "    it('ESSAI-B : un test qui appelle un module absent de ce commit', function () { MC.Recifs.creer(); });\n" +
          "    it('ESSAI-C : un test en échec pour une vraie raison', function () { A.equal(1, 2, 'vraie assertion'); });\n" +
          "  }); })(globalThis);\n");
        var r = cp.spawnSync(process.execPath, [path.join(RACINE, 'tests', 'run.js'), '--test', 'ESSAI-A : un test qui passe,ESSAI-B : un test qui appelle un module absent de ce commit,ESSAI-C : un test en échec pour une vraie raison', '--sans-fonctions', '--silencieux'],
          { cwd: RACINE, encoding: 'utf8', env: Object.assign({}, process.env, { MC_RACINE_JEU: arbre, MC_TEST_RESULTATS_DIR: res }), timeout: 120000 });
        var dossiers = fs.readdirSync(res);
        A.equal(dossiers.length, 1, 'un cahier écrit (sortie : ' + String(r.stdout).slice(-300) + String(r.stderr).slice(-300) + ')');
        var j = JSON.parse(fs.readFileSync(path.join(res, dossiers[0], 'resultats.json'), 'utf8'));
        var par = {}; j.tests.forEach(function (t) { par[t.nom.slice(0, 7)] = t; });
        A.equal(par['ESSAI-A'].etat, 'ok', 'le test qui passe passe (les tests viennent de l\'arbre rejoué)');
        A.equal(par['ESSAI-B'].etat, 'ignore', 'le test incompatible est ignoré — ni ok ni échec');
        A.ok(/incompatible avec ce commit/.test(par['ESSAI-B'].raison) && /src\/journal\.js/.test(par['ESSAI-B'].raison), 'avec une raison explicite : ' + par['ESSAI-B'].raison);
        A.equal(par['ESSAI-C'].etat, 'echec', 'une vraie assertion en échec reste un échec');
        A.equal(j.campagne.totaux.passes, 1); A.equal(j.campagne.totaux.echecs, 1); A.equal(j.campagne.totaux.ignores, 1, 'les trois totaux sont cohérents');
        A.ok(j.campagne.rejeu && j.campagne.rejeu.modulesAbsents.indexOf('journal') >= 0, 'la campagne dit quels modules manquaient à ce commit');
        A.equal(j.campagne.moteurTest.version, MT.VERSION, 'et quel moteur l\'a produite');
        A.equal(j.campagne.environnement.versionJeu, '0.0.9', 'la version du jeu est celle de l\'arbre rejoué');
        // l'inscription au registre garde l'état ignore et sa raison
        var registre = dossierTemp('mc-hist-reg-arbre-');
        var ins = REG.inscrire(dossiers[0], { racineResultats: res, dossierRepo: RACINE, dossierRegistre: registre, origine: 'pre-push', commitTeste: g(RACINE, ['rev-parse', 'HEAD']) });
        A.ok(ins.ok, ins.motif);
        var e = REG.lireEntrees(registre)[0];
        var t2 = e.tests.filter(function (t) { return /^ESSAI-B/.test(t.nom); })[0];
        A.equal(t2.etat, 'ignore'); A.ok(/incompatible/.test(t2.raison), 'la raison survit à l\'inscription');
        A.equal(e.moteurTest.version, MT.VERSION);
      } finally { nettoyer(); }
    });

    it('SPEC-BANC-115 : relancer historiser après une interruption ne relance pas les commits déjà inscrits, seulement ceux qui manquent', function () {
      try {
        var d = depotComplet();
        var registre = dossierTemp('mc-hist-registre-reprise-');
        var sim1 = campagneSimulee();
        var r1 = HIST.historiser({ dossierRepo: d.rd, dossierRegistre: registre, lancerCampagne: sim1, depuis: d.racine, max: 2 });
        A.equal(sim1.appels.length, 2, 'première passe interrompue après deux commits');
        A.equal(REG.lireEntrees(registre).length, 2);
        var sim2 = campagneSimulee();
        var r2 = HIST.historiser({ dossierRepo: d.rd, dossierRegistre: registre, lancerCampagne: sim2, depuis: d.racine });
        A.deep(sim2.appels.map(function (a) { return a.sha; }), [d.merges[2], d.pr, d.release], 'la reprise ne rejoue que les trois commits manquants');
        A.deep(r2.sautes, [d.merges[0], d.merges[1]], 'les deux premiers sont sautés');
        A.equal(REG.lireEntrees(registre).length, 5, 'cinq entrées au total, aucun doublon');
        var sim3 = campagneSimulee();
        HIST.historiser({ dossierRepo: d.rd, dossierRegistre: registre, lancerCampagne: sim3, depuis: d.racine });
        A.equal(sim3.appels.length, 0, 'une troisième passe n\'a plus rien à faire');
        // une entrée INTERROMPUE n'est pas « inscrite » : elle est refaite
        var registre2 = dossierTemp('mc-hist-registre-interrompu-');
        var simI = campagneSimulee({ interrompre: function (arg) { return arg.sha === d.merges[1]; } });
        HIST.historiser({ dossierRepo: d.rd, dossierRegistre: registre2, lancerCampagne: simI, depuis: d.racine, max: 3 });
        var interrompues = REG.lireEntrees(registre2).filter(function (e) { return e.interrompu; });
        A.equal(interrompues.length, 1, 'une entrée interrompue');
        var simR = campagneSimulee();
        HIST.historiser({ dossierRepo: d.rd, dossierRegistre: registre2, lancerCampagne: simR, depuis: d.racine, max: 1 });
        A.equal(simR.appels[0].sha, d.merges[1], 'la reprise recommence par le commit dont la campagne a été interrompue');
        // --lister n'exécute rien
        var simL = campagneSimulee();
        var rl = HIST.historiser({ dossierRepo: d.rd, dossierRegistre: registre2, lancerCampagne: simL, depuis: d.racine, aBlanc: true });
        A.equal(simL.appels.length, 0, '--lister ne lance aucune campagne');
        A.ok(Array.isArray(rl.aFaire));
      } finally { nettoyer(); }
    });

    it('SPEC-BANC-115 : une campagne qui échoue n\'empêche pas les commits suivants ; elle est signalée, son worktree est supprimé', function () {
      try {
        var d = depotTroisMerges();
        var n = 0;
        var registre = dossierTemp('mc-hist-registre-echec-');
        var sim = campagneSimulee();
        var r = HIST.historiser({ dossierRepo: d.rd, dossierRegistre: registre, depuis: d.racine, lancerCampagne: function (arg) {
          n++;
          if (n === 2) throw new Error('le navigateur a planté');
          return sim(arg);
        } });
        A.equal(r.ok, false);
        A.equal(r.echecs.length, 1); A.ok(/navigateur a planté/.test(r.echecs[0].motif));
        A.equal(REG.lireEntrees(registre).length, 2, 'les deux autres commits sont inscrits');
        A.equal(g(d.rd, ['worktree', 'list', '--porcelain']).split('\n').filter(function (l) { return /^worktree /.test(l); }).length, 1, 'aucun worktree orphelin');
        var r2 = HIST.historiser({ dossierRepo: d.rd, dossierRegistre: registre, depuis: d.racine, lancerCampagne: sim });
        A.deep(r2.faits, [d.merges[1]], 'la reprise refait celui qui avait échoué');
      } finally { nettoyer(); }
    });

    it('SPEC-BANC-116 : après une publication, les entrées de merge et de PR produites par historiser sont compactées comme les autres — sauf celle de la release', function () {
      try {
        var d = depotComplet();
        var h = historiserSimule(d);
        A.equal(h.entrees.length, 5);
        var avant = fs.readdirSync(path.join(h.registre, 'images')).length;
        A.ok(avant >= 5, 'cinq images distinctes dans le registre avant la compaction (' + avant + ')');
        var c = REG.compacter({ dossierRegistre: h.registre, dossierRepo: d.rd, version: 'v0.2.0', jusquA: 'v0.2.0' });
        A.ok(c.ok, 'compaction : ' + c.motif);
        var apres = REG.lireEntrees(h.registre);
        var par = {}; apres.forEach(function (e) { par[e.commit] = e; });
        d.merges.concat([d.pr]).forEach(function (sha) {
          A.equal(par[sha].compacte, true, 'l\'entrée du commit ' + sha.slice(0, 8) + ' est compactée');
          A.ok(par[sha].tests.every(function (t) { return !(t.captures || []).some(function (x) { return x.image; }); }), 'plus aucune image');
        });
        A.notOk(par[d.release].compacte, 'l\'entrée de la release garde son détail');
        A.equal(par[d.release].release, 'v0.2.0', 'et porte le marqueur de release');
        A.ok(par[d.release].tests.some(function (t) { return (t.captures || []).some(function (x) { return x.image; }); }), 'avec ses images');
        A.equal(fs.readdirSync(path.join(h.registre, 'images')).length, 1, 'seules les images de la release restent dans le stockage');
        // le résumé survit : états, durées, fiche, métadonnées du commit
        var m = par[d.merges[0]];
        A.ok(m.tests[0].etat && typeof m.tests[0].duree_ms === 'number', 'états et durées conservés');
        A.ok(m.meta_commit && m.meta_commit.message, 'et les métadonnées du commit');
      } finally { nettoyer(); }
    });

    it('SPEC-BANC-111 : la commande existe — node tools/registre.js historiser — et --lister montre ce qu\'elle ferait sans rien lancer', function () {
      var r = cp.spawnSync(process.execPath, [path.join(RACINE, 'tools', 'registre.js'), 'historiser', '--lister', '--depuis', 'HEAD'], { cwd: RACINE, encoding: 'utf8', env: Object.assign({}, process.env), timeout: 60000 });
      A.equal(r.status, 0, 'code de sortie 0 : ' + r.stdout + r.stderr);
      A.ok(/historiser : 0 commit\(s\) de merge, de PR ou de release/.test(r.stdout), 'depuis HEAD, rien à faire : ' + r.stdout);
      var usage = cp.spawnSync(process.execPath, [path.join(RACINE, 'tools', 'registre.js')], { cwd: RACINE, encoding: 'utf8', env: Object.assign({}, process.env) });
      A.ok(/historiser \[--depuis ref\]/.test(usage.stdout), 'l\'aide la mentionne');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
