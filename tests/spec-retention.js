/* spec-retention.js — rétention du registre (SPEC-BANC-090, 091) et score
   d'instabilité (SPEC-BANC-088). Fichier Node-only (comme spec-perimetre.js) :
   il crée des dépôts git et des registres JETABLES sous le dossier temporaire
   du système — jamais le vrai tests/registre/ — et lance un `version.js
   --publier` réel, mais dans une copie jetable de l'outillage. */
(function (G) {
  'use strict';
  var T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
  var RACINE = path.join(__dirname, '..');
  var REG = require(path.join(RACINE, 'tools', 'registre.js'));
  var P = require(path.join(RACINE, 'tools', 'perimetre.js'));
  var GP = require(path.join(RACINE, 'tools', 'git-propre.js'));

  var ENV = GP.envSansGit();
  function git(dossier, args) {
    return cp.execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'].concat(args),
      { cwd: dossier, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  }
  function tmp(nom) { return fs.mkdtempSync(path.join(os.tmpdir(), 'mc-' + nom + '-')); }
  function nettoyer(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* rien */ } }
  function commiter(d, fichier, contenu, msg) {
    fs.mkdirSync(path.dirname(path.join(d, fichier)), { recursive: true });
    fs.writeFileSync(path.join(d, fichier), contenu);
    git(d, ['add', '-A']); git(d, ['commit', '-q', '-m', msg]);
    return git(d, ['rev-parse', 'HEAD']);
  }
  function depot() { var d = tmp('depot'); git(d, ['init', '-q']); return d; }

  function testEntree(nom, etat, image) {
    return {
      id: 'N-' + nom, nom: nom, categorie: { type: 'unitaire', groupe: 'G' }, domaines: ['D'], specs: ['spec-bidon'], etiquettes: [],
      fonctions: ['MC.A.f'], fiche: { teste: 'une très longue fiche '.repeat(20), pourquoi: 'p', attendu: 'a' },
      debut: '2026-01-01T00:00:01.000Z', duree_ms: 12, etat: etat || 'reussi', raison: null, erreur: null,
      captures: image ? [{ role: 'fin', libelle: 'fin', image: image, t_ms: 5 }] : [],
    };
  }
  /* écrit une entrée comme le fait tools/registre.js (une méta, une ligne par test) */
  function ecrireEntree(reg, o) {
    var meta = { id: o.id, commit: o.commit, branche: 'master', date: o.date, preset: o.preset || 'pr', origine: o.origine || 'pre-push', inscrit: true, statut: o.statut || 'ok', motif: null };
    var nom = o.date.replace(/[-:]/g, '').slice(0, 15).replace('T', '-') + '_' + o.commit.slice(0, 10) + '_' + meta.preset + '-' + o.id + '.jsonl';
    fs.mkdirSync(path.join(reg, 'entrees'), { recursive: true });
    fs.writeFileSync(path.join(reg, 'entrees', nom), [JSON.stringify(meta)].concat(o.tests.map(function (t) { return JSON.stringify(t); })).join('\n') + '\n');
    return nom;
  }
  function ecrireImage(reg, nom, octets) {
    fs.mkdirSync(path.join(reg, 'images'), { recursive: true });
    fs.writeFileSync(path.join(reg, 'images', nom), Buffer.alloc(octets || 100, 7));
  }
  function entreeDe(reg, id) { return REG.lireEntrees(reg).filter(function (e) { return e.id === id; })[0]; }
  function existeImage(reg, nom) { return fs.existsSync(path.join(reg, 'images', nom)); }

  /* Un dépôt à 4 commits : c1, c2 (étiqueté v0.1.0), c3, c4 (après la release),
     et un registre avec des runs sur chacun. */
  function scenario() {
    var d = depot();
    var c1 = commiter(d, 'a.txt', '1', 'feat: un');
    var c2 = commiter(d, 'a.txt', '2', 'feat: deux');
    git(d, ['tag', '-a', 'v0.1.0', '-m', 'v0.1.0']);
    var c3 = commiter(d, 'a.txt', '3', 'feat: trois');
    var c4 = commiter(d, 'a.txt', '4', 'feat: quatre');
    var reg = path.join(d, 'tests', 'registre');
    ecrireImage(reg, 'aaa.jpg'); ecrireImage(reg, 'bbb.jpg'); ecrireImage(reg, 'ccc.jpg'); ecrireImage(reg, 'ddd.jpg'); ecrireImage(reg, 'orph.jpg');
    // cycle qui se termine (c1, c2) : deux runs de c1, un de c2 (validation du commit étiqueté), un manuel de c1
    ecrireEntree(reg, { id: 'r1', commit: c1, date: '2026-01-01T10:00:00.000Z', tests: [testEntree('t', 'reussi', 'aaa.jpg')] });
    ecrireEntree(reg, { id: 'r1m', commit: c1, date: '2026-01-01T11:00:00.000Z', origine: 'manuel', tests: [testEntree('t', 'reussi', 'bbb.jpg')] });
    ecrireEntree(reg, { id: 'r2', commit: c2, date: '2026-01-02T10:00:00.000Z', tests: [testEntree('t', 'reussi', 'ccc.jpg')] });
    ecrireEntree(reg, { id: 'r2f', commit: c2, date: '2026-01-02T10:01:00.000Z', preset: 'e2e-fumee', tests: [testEntree('t', 'reussi', 'ccc.jpg')] });
    // cycle suivant (c3, c4) : doit rester détaillé
    ecrireEntree(reg, { id: 'r4', commit: c4, date: '2026-01-04T10:00:00.000Z', tests: [testEntree('t', 'reussi', 'ddd.jpg')] });
    return { d: d, reg: reg, c1: c1, c2: c2, c3: c3, c4: c4 };
  }

  describe('Specs — rétention du registre (tools/registre.js compacter)', function () {

    it('SPEC-BANC-090 : le run du commit étiqueté est gardé en détail pour toujours, les autres runs du cycle sont compactés', function () {
      var s = scenario();
      try {
        var r = REG.compacter({ dossierRegistre: s.reg, dossierRepo: s.d, jusquA: 'v0.1.0', version: 'v0.1.0' });
        A.ok(r.ok, 'compaction réussie : ' + JSON.stringify(r));
        var r2 = entreeDe(s.reg, 'r2');
        A.ok(!r2.compacte, 'le run de validation du commit étiqueté reste détaillé');
        A.equal(r2.release, 'v0.1.0', 'il est marqué comme le run de la release');
        A.ok(r2.tests[0].fiche && r2.tests[0].fiche.teste, 'sa fiche est conservée intégralement');
        A.equal(r2.tests[0].captures[0].image, 'ccc.jpg', 'ses images sont conservées');
        ['r1', 'r1m'].forEach(function (id) {
          var e = entreeDe(s.reg, id);
          A.ok(e.compacte === true, id + ' est compacté');
          A.ok(!e.tests[0].fiche, id + ' : la fiche (instantané de catalogue) est retirée');
          A.equal(e.tests[0].etat, 'reussi', id + ' : l\'état est gardé');
          A.equal(e.tests[0].duree_ms, 12, id + ' : la durée est gardée');
          A.equal(e.commit.length, 40, id + ' : le commit est gardé');
        });
        A.ok(!entreeDe(s.reg, 'r2f').compacte && entreeDe(s.reg, 'r2f').release === 'v0.1.0', 'la validation du commit étiqueté comprend aussi son run e2e-fumee (les images témoins) : gardé');
        A.ok(!entreeDe(s.reg, 'r4').compacte, 'un run d\'un commit APRÈS l\'étiquette n\'est pas touché (cycle suivant)');
        A.ok(entreeDe(s.reg, 'r4').tests[0].fiche, 'et garde sa fiche');
      } finally { nettoyer(s.d); }
    });

    it('SPEC-BANC-091 : un run compacté perd ses images (sauf témoin épinglé), les images non référencées disparaissent du stockage', function () {
      var s = scenario();
      try {
        REG.marquerTemoin('N-t', s.c1, 'aaa.jpg', { dossierRegistre: s.reg });
        var r = REG.compacter({ dossierRegistre: s.reg, dossierRepo: s.d, jusquA: 'v0.1.0', version: 'v0.1.0' });
        A.ok(r.ok, JSON.stringify(r));
        A.equal(entreeDe(s.reg, 'r1').tests[0].captures[0].image, 'aaa.jpg', 'la capture témoin épinglée survit dans un run compacté');
        A.equal(entreeDe(s.reg, 'r1m').tests[0].captures[0].image, null, 'une autre capture perd son image mais garde son libellé');
        A.equal(entreeDe(s.reg, 'r1m').tests[0].captures[0].libelle, 'fin', 'le libellé reste');
        A.ok(existeImage(s.reg, 'aaa.jpg'), 'image épinglée présente');
        A.ok(!existeImage(s.reg, 'bbb.jpg'), 'image du run compacté, non épinglée : supprimée');
        A.ok(existeImage(s.reg, 'ccc.jpg'), 'image du run de release : conservée');
        A.ok(existeImage(s.reg, 'ddd.jpg'), 'image d\'un run détaillé du cycle suivant : conservée');
        A.ok(!existeImage(s.reg, 'orph.jpg'), 'image qu\'aucune entrée ne référence : supprimée');
        A.ok(r.imagesSupprimees >= 2, 'le compte rendu dit combien d\'images sont retirées');
      } finally { nettoyer(s.d); }
    });

    it('SPEC-BANC-091 : --a-blanc annonce le plan et les tailles sans rien écrire ni supprimer', function () {
      var s = scenario();
      try {
        var avant = fs.readdirSync(path.join(s.reg, 'entrees')).map(function (f) { return fs.readFileSync(path.join(s.reg, 'entrees', f), 'utf8'); });
        var r = REG.compacter({ dossierRegistre: s.reg, dossierRepo: s.d, jusquA: 'v0.1.0', version: 'v0.1.0', aBlanc: true });
        A.ok(r.ok && r.aBlanc, 'plan rendu');
        A.equal(r.entreesCompactees, 2, 'deux entrées seraient compactées');
        A.equal(r.entreesRelease, 2, 'la validation du commit étiqueté (pr + e2e-fumee) garde son détail');
        A.ok(r.octetsEntreesApres < r.octetsEntreesAvant, 'les entrées pèseraient moins');
        var apres = fs.readdirSync(path.join(s.reg, 'entrees')).map(function (f) { return fs.readFileSync(path.join(s.reg, 'entrees', f), 'utf8'); });
        A.deep(apres, avant, 'aucun fichier d\'entrée modifié');
        ['aaa.jpg', 'bbb.jpg', 'orph.jpg'].forEach(function (i) { A.ok(existeImage(s.reg, i), i + ' toujours là'); });
      } finally { nettoyer(s.d); }
    });

    it('SPEC-BANC-090 : la compaction est idempotente et ne touche jamais un run de release déjà marqué', function () {
      var s = scenario();
      try {
        REG.compacter({ dossierRegistre: s.reg, dossierRepo: s.d, jusquA: 'v0.1.0', version: 'v0.1.0' });
        var f1 = fs.readdirSync(path.join(s.reg, 'entrees')).map(function (f) { return fs.readFileSync(path.join(s.reg, 'entrees', f), 'utf8'); });
        // une release suivante, dont le cycle contient r4 : r2 (release v0.1.0) ne doit pas bouger
        git(s.d, ['tag', '-a', 'v0.2.0', '-m', 'v0.2.0']);
        var r = REG.compacter({ dossierRegistre: s.reg, dossierRepo: s.d, jusquA: 'v0.2.0', version: 'v0.2.0' });
        A.ok(r.ok, JSON.stringify(r));
        A.equal(entreeDe(s.reg, 'r2').release, 'v0.1.0', 'la release précédente garde son marquage');
        A.ok(entreeDe(s.reg, 'r2').tests[0].fiche, 'et son détail');
        A.equal(entreeDe(s.reg, 'r4').release, 'v0.2.0', 'la nouvelle release garde son run');
        var r3 = REG.compacter({ dossierRegistre: s.reg, dossierRepo: s.d, jusquA: 'v0.2.0', version: 'v0.2.0' });
        A.equal(r3.entreesCompactees, 0, 'rejouée, la compaction ne trouve plus rien à faire');
        A.equal(r3.imagesSupprimees, 0, 'ni image à retirer');
        A.ok(f1.length > 0, 'registre non vide');
      } finally { nettoyer(s.d); }
    });

    it('SPEC-BANC-090 : sûreté — référence inconnue ou dépôt illisible : rien n\'est modifié', function () {
      var s = scenario();
      try {
        var avant = JSON.stringify(REG.lireEntrees(s.reg));
        var r = REG.compacter({ dossierRegistre: s.reg, dossierRepo: s.d, jusquA: 'v9.9.9', version: 'v9.9.9' });
        A.ok(!r.ok, 'refus explicite');
        A.ok(r.motif, 'avec un motif');
        A.equal(JSON.stringify(REG.lireEntrees(s.reg)), avant, 'registre intact');
        ['aaa.jpg', 'bbb.jpg', 'orph.jpg'].forEach(function (i) { A.ok(existeImage(s.reg, i), i + ' toujours là'); });
      } finally { nettoyer(s.d); }
    });

    it('SPEC-BANC-091 : sûreté — un fichier d\'entrée illisible empêche toute suppression d\'image', function () {
      var s = scenario();
      try {
        fs.writeFileSync(path.join(s.reg, 'entrees', '20260105-000000_zzzzzzzzzz_pr.jsonl'), '{pas du json\n');
        var r = REG.compacter({ dossierRegistre: s.reg, dossierRepo: s.d, jusquA: 'v0.1.0', version: 'v0.1.0' });
        A.equal(r.imagesSupprimees, 0, 'aucune image supprimée : une entrée illisible pourrait en référencer');
        A.ok(existeImage(s.reg, 'orph.jpg'), 'même l\'orpheline reste (prudence)');
        A.ok(r.avertissements && r.avertissements.length, 'et le dit');
      } finally { nettoyer(s.d); }
    });

    it('SPEC-BANC-090 : un run en attente (pont pre-push → pre-commit) n\'est jamais compacté', function () {
      var s = scenario();
      try {
        ecrireEntree(s.reg, { id: 'att', commit: s.c1, date: '2026-01-01T12:00:00.000Z', statut: 'en_attente', tests: [testEntree('t', 'reussi', 'bbb.jpg')] });
        REG.compacter({ dossierRegistre: s.reg, dossierRepo: s.d, jusquA: 'v0.1.0', version: 'v0.1.0' });
        A.ok(!entreeDe(s.reg, 'att').compacte, 'entrée en attente intacte');
        A.ok(existeImage(s.reg, 'bbb.jpg'), 'et son image reste référencée');
      } finally { nettoyer(s.d); }
    });

    it('SPEC-BANC-091 : tools/version.js --publier compacte le registre du cycle qui se termine, dans le commit de release', function () {
      var d = depot();
      try {
        // copie jetable de l'outillage : version.js travaille sur SA racine
        fs.mkdirSync(path.join(d, 'tools'), { recursive: true });
        fs.readdirSync(path.join(RACINE, 'tools')).filter(function (f) { return /\.js$/.test(f); }).forEach(function (f) {
          fs.copyFileSync(path.join(RACINE, 'tools', f), path.join(d, 'tools', f));
        });
        fs.mkdirSync(path.join(d, 'src'), { recursive: true });
        fs.writeFileSync(path.join(d, 'src', 'core.js'), "var VERSION_JEU = '0.1.0';\n");
        fs.writeFileSync(path.join(d, 'CHANGELOG.md'), '# Journal\n\n## [Non publié]\n\n## [0.1.0] - 2026-01-01\n\n[Non publié]: #\n[0.1.0]: #\n');
        commiter(d, 'README.md', 'x', 'chore: base');
        git(d, ['tag', '-a', 'v0.1.0', '-m', 'v0.1.0']);
        var c1 = commiter(d, 'f.txt', '1', 'feat: une fonction');
        var c2 = commiter(d, 'f.txt', '2', 'fix: un correctif');
        var reg = path.join(d, 'tests', 'registre');
        ecrireImage(reg, 'aaa.jpg'); ecrireImage(reg, 'ccc.jpg');
        ecrireEntree(reg, { id: 'r1', commit: c1, date: '2026-01-01T10:00:00.000Z', tests: [testEntree('t', 'reussi', 'aaa.jpg')] });
        ecrireEntree(reg, { id: 'r2', commit: c2, date: '2026-01-02T10:00:00.000Z', tests: [testEntree('t', 'reussi', 'ccc.jpg')] });
        git(d, ['add', '-A']); git(d, ['commit', '-q', '-m', 'test(registre): runs']);
        var sortie = cp.execFileSync(process.execPath, [path.join(d, 'tools', 'version.js'), '--publier'], { cwd: d, encoding: 'utf8', env: ENV });
        A.ok(/0\.1\.0 → 0\.2\.0/.test(sortie), 'publication faite : ' + sortie);
        A.ok(/registre/i.test(sortie), 'la sortie parle du registre : ' + sortie);
        A.ok(entreeDe(reg, 'r1').compacte === true, 'le run du cycle est compacté');
        A.equal(entreeDe(reg, 'r2').release, 'v0.2.0', 'le dernier run validé porte la release');
        A.ok(entreeDe(reg, 'r2').tests[0].fiche, 'et reste détaillé');
        A.ok(!existeImage(reg, 'aaa.jpg') && existeImage(reg, 'ccc.jpg'), 'image du run compacté retirée, celle de la release gardée');
        A.equal(git(d, ['status', '--porcelain', '--', 'tests', 'src', 'CHANGELOG.md']), '', 'tout est dans le commit de release : rien ne reste à committer');
        A.equal(git(d, ['log', '-1', '--format=%s']), 'chore(release): v0.2.0', 'le dernier commit est celui de la release');
        A.ok(git(d, ['show', '--stat', '--format=', 'HEAD']).indexOf('tests/registre') >= 0, 'le commit de release porte la compaction');
      } finally { nettoyer(d); }
    });

    it('SPEC-BANC-091 : la ligne de commande compacter existe, avec --a-blanc, et le mode d\'emploi la cite', function () {
      var src = fs.readFileSync(path.join(RACINE, 'tools', 'registre.js'), 'utf8');
      A.ok(/sous === 'compacter'/.test(src), 'sous-commande compacter');
      A.ok(/--a-blanc/.test(src), 'option --a-blanc');
      var vsrc = fs.readFileSync(path.join(RACINE, 'tools', 'version.js'), 'utf8');
      A.ok(/compacter/.test(vsrc), 'version.js --publier appelle la compaction');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  describe('Specs — score d\'instabilité (tools/registre.js calculerInstabilites)', function () {
    function carte(fonctionsDuTest) {
      var cle = 'G › t';
      var id = P.idTestCarte(cle);
      return {
        version: 2, commit: 'x'.repeat(40), preset: 'pr',
        fichiers: { 'src/a.js': ['MC.A.f'], 'src/b.js': ['MC.B.g'] },
        tests: (function () { var o = {}; o[id] = cle; return o; })(),
        fonctions: fonctionsDuTest || { 'MC.A.f': [id] },
      };
    }
    /* un dépôt avec src/a.js, src/b.js et une suite de runs : etats[i] à commits[i] */
    function runs(etats, modifs) {
      var d = depot();
      var reg = path.join(d, 'tests', 'registre');
      var commits = [];
      etats.forEach(function (etat, i) {
        var m = (modifs && modifs[i]) || { 'src/b.js': 'v' + i };   // par défaut : un fichier SANS rapport avec le test
        Object.keys(m).forEach(function (f) { fs.mkdirSync(path.join(d, 'src'), { recursive: true }); fs.writeFileSync(path.join(d, f), m[f]); });
        git(d, ['add', '-A']); git(d, ['commit', '-q', '-m', 'c' + i]);
        var c = git(d, ['rev-parse', 'HEAD']);
        commits.push(c);
        ecrireEntree(reg, { id: 'i' + i, commit: c, date: '2026-02-0' + (i + 1) + 'T10:00:00.000Z', tests: [testEntree('t', etat)] });
      });
      return { d: d, reg: reg };
    }
    function score(r, c, opts) {
      return REG.calculerInstabilites(Object.assign({ dossierRegistre: r.reg, dossierRepo: r.d, carte: c }, opts || {}));
    }

    it('SPEC-BANC-088 : échec, réussite, échec sur trois runs sans que ses fonctions changent : étiqueté instable, score 2', function () {
      var r = runs(['echec', 'reussi', 'echec']);
      try {
        var res = score(r, carte())['G › t'];
        A.ok(res, 'le test est évalué');
        A.equal(res.score, 2, 'deux alternances');
        A.ok(res.instable === true, 'étiqueté instable');
      } finally { nettoyer(r.d); }
    });

    it('SPEC-BANC-088 : si le fichier qui définit une fonction du test change entre les runs, l\'alternance n\'est pas comptée', function () {
      var r = runs(['echec', 'reussi', 'echec'], [{ 'src/a.js': 'a0' }, { 'src/a.js': 'a1' }, { 'src/a.js': 'a2' }]);
      try {
        var res = score(r, carte())['G › t'];
        A.equal(res.score, 0, 'chaque bascule suit un changement de ses fonctions : régression ou correction, pas instabilité');
        A.ok(!res.instable, 'pas instable');
      } finally { nettoyer(r.d); }
    });

    it('SPEC-BANC-088 : une seule alternance, ou aucune, n\'est pas de l\'instabilité', function () {
      var r = runs(['echec', 'echec', 'reussi']);
      try {
        var res = score(r, carte())['G › t'];
        A.equal(res.score, 1, 'une alternance');
        A.ok(!res.instable, 'sous le seuil de deux');
      } finally { nettoyer(r.d); }
    });

    it('SPEC-BANC-088 : un test absent de la carte d\'impact n\'est jamais étiqueté (on ne sait pas ce qu\'il touche)', function () {
      var r = runs(['echec', 'reussi', 'echec']);
      try {
        var res = score(r, { version: 2, commit: 'x'.repeat(40), preset: 'pr', fichiers: {}, tests: {}, fonctions: {} });
        A.ok(!res['G › t'] || !res['G › t'].instable, 'non étiqueté sans données d\'impact');
      } finally { nettoyer(r.d); }
    });

    it('SPEC-BANC-088 : le score ne porte que sur les N derniers runs', function () {
      var r = runs(['echec', 'reussi', 'echec', 'reussi', 'reussi', 'reussi']);
      try {
        A.equal(score(r, carte(), { fenetre: 3 })['G › t'].score, 0, 'les 3 derniers runs sont stables');
        A.equal(score(r, carte(), { fenetre: 6 })['G › t'].score, 3, 'sur les 6 : trois alternances');
      } finally { nettoyer(r.d); }
    });

    it('SPEC-BANC-088 : un commit illisible par git compte comme un changement (prudence : jamais d\'étiquette à tort)', function () {
      var r = runs(['echec', 'reussi', 'echec']);
      try {
        var e = REG.lireEntrees(r.reg).filter(function (x) { return x.id === 'i1'; })[0];
        var f = path.join(r.reg, 'entrees', e._fichier);
        fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(e.commit, '0'.repeat(40)));
        var res = score(r, carte())['G › t'];
        A.ok(!res.instable, 'non étiqueté');
      } finally { nettoyer(r.d); }
    });

    it('SPEC-BANC-088 : l\'étiquette instable est portée par les lignes du tableau d\'historique, donc filtrable', function () {
      var H = require(path.join(RACINE, 'tools', 'historique.js'));
      var run = { id: 'r', commit: 'c1', date: '2026-01-01T00:00:00.000Z', preset: 'pr', origine: 'pre-push', inscrit: true,
        tests: [{ id: 'N-1', nom: 't', categorie: { type: 'unitaire', groupe: 'G' }, etat: 'echec', etiquettes: [], captures: [] },
          { id: 'N-2', nom: 'autre', categorie: { type: 'unitaire', groupe: 'G' }, etat: 'reussi', etiquettes: [], captures: [] }] };
      var lignes = H.construireLignes([run], { instabilites: { 'G › t': { score: 2, instable: true } } });
      var l = lignes.filter(function (x) { return x.nom === 't'; })[0];
      A.ok(l.etiquettes.indexOf('instable') >= 0, 'étiquette instable ajoutée');
      A.equal(l.instabilite, 2, 'score exposé');
      var filtrees = H.filtrerLignes(lignes, { etiquettes: ['instable'] });
      A.equal(filtrees.length, 1, 'filtrable par étiquette');
      var autre = lignes.filter(function (x) { return x.nom === 'autre'; })[0];
      A.ok(autre.etiquettes.indexOf('instable') < 0, 'un test stable n\'est pas étiqueté');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
