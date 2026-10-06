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
    var meta = Object.assign({ id: o.id, commit: o.commit, branche: 'master', date: o.date, preset: o.preset || 'pr', origine: o.origine || 'pre-push', inscrit: true, statut: o.statut || 'ok', motif: null }, o.meta || {});
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
    /* opts : metas[i] (méta du run i), memeCommit (tous les runs sur un seul commit),
       test(etat) (le test du run, 'G › t' unitaire par défaut) */
    function runs(etats, modifs, opts) {
      var o = opts || {};
      var d = depot();
      var reg = path.join(d, 'tests', 'registre');
      var c = null;
      etats.forEach(function (etat, i) {
        if (!c || !o.memeCommit) {
          // fichier de test qui définit le groupe 'G' (retrouvé par git à partir du groupe)
          var m = (modifs && modifs[i]) || { 'src/b.js': 'v' + i };   // par défaut : un fichier SANS rapport avec le test
          m = Object.assign({ 'tests/spec-g.js': "describe('G', function () {});\n" }, m);
          Object.keys(m).forEach(function (f) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), m[f]); });
          git(d, ['add', '-A']); git(d, ['commit', '-q', '-m', 'c' + i]);
          c = git(d, ['rev-parse', 'HEAD']);
        }
        ecrireEntree(reg, { id: 'i' + i, commit: c, date: '2026-02-0' + (i + 1) + 'T10:00:00.000Z', meta: (o.metas || [])[i], tests: [o.test ? o.test(etat) : testEntree('t', etat)] });
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

  // ══════════════════════════════════════════════════════════════════════
  describe('Specs — rétention (revue adversariale) : pertes de données et reprise', function () {
    function compacter(s, extra) { return REG.compacter(Object.assign({ dossierRegistre: s.reg, dossierRepo: s.d, jusquA: 'v0.1.0', version: 'v0.1.0' }, extra || {})); }
    function octets(reg) {
      var out = {};
      ['entrees', 'images'].forEach(function (sd) { fs.readdirSync(path.join(reg, sd)).forEach(function (f) { out[sd + '/' + f] = fs.readFileSync(path.join(reg, sd, f)).toString('base64'); }); });
      return JSON.stringify(out);
    }

    it('SPEC-BANC-091 : une ligne de test illisible → le fichier n\'est PAS réécrit, aucune image supprimée, avertissement explicite', function () {
      var s = scenario();
      try {
        var f = path.join(s.reg, 'entrees', REG.lireEntrees(s.reg).filter(function (e) { return e.id === 'r1m'; })[0]._fichier);
        fs.appendFileSync(f, '{"id":"N-cassé","nom":"x","captures":[{"image":"bbb.jpg"\n');
        var avant = fs.readFileSync(f, 'utf8');
        var r = compacter(s);
        A.equal(fs.readFileSync(f, 'utf8'), avant, 'le fichier à ligne rejetée est intact');
        A.equal(r.imagesSupprimees, 0, 'aucune image supprimée');
        A.ok(existeImage(s.reg, 'bbb.jpg') && existeImage(s.reg, 'orph.jpg'), 'images toujours là');
        A.ok(r.avertissements.some(function (a) { return /lignes de test illisibles/.test(a); }), 'avertissement explicite : ' + JSON.stringify(r.avertissements));
      } finally { nettoyer(s.d); }
    });

    it('SPEC-BANC-091 : une inscription concurrente n\'est jamais touchée (image récente, entrée apparue en cours de route)', function () {
      var s = scenario();
      try {
        var r = compacter(s, { apresReecriture: function () {
          ecrireImage(s.reg, 'neuve.jpg');                                               // image écrite pendant la compaction, pas encore référencée
          ecrireEntree(s.reg, { id: 'tard', commit: s.c4, date: '2026-01-05T10:00:00.000Z', tests: [testEntree('t', 'reussi', 'orph.jpg')] }); // une entrée qui adopte une « orpheline »
        } });
        A.ok(r.ok, JSON.stringify(r));
        A.ok(existeImage(s.reg, 'neuve.jpg'), 'image plus récente que le début de la compaction : conservée');
        A.ok(existeImage(s.reg, 'orph.jpg'), 'image référencée par une entrée apparue entre-temps : conservée');
        A.ok(!existeImage(s.reg, 'bbb.jpg'), 'le reste est supprimé normalement');
      } finally { nettoyer(s.d); }
    });

    it('SPEC-BANC-091 : verrou de compaction (PID + péremption) et nettoyage des fichiers temporaires orphelins', function () {
      var s = scenario();
      try {
        fs.writeFileSync(path.join(s.reg, '.compaction.lock'), JSON.stringify({ pid: process.ppid, debut: Date.now() }));
        var refus = compacter(s);
        A.ok(!refus.ok && /déjà en cours/.test(refus.motif), 'verrou tenu par un processus vivant : refus ' + JSON.stringify(refus));
        fs.writeFileSync(path.join(s.reg, '.compaction.lock'), JSON.stringify({ pid: process.ppid, debut: Date.now() - 3600 * 1000 }));
        fs.writeFileSync(path.join(s.reg, 'entrees', 'x.jsonl.tmp-999999'), 'reste d\'un processus mort');
        var r = compacter(s);
        A.ok(r.ok, 'verrou périmé : repris ' + JSON.stringify(r));
        A.ok(!fs.existsSync(path.join(s.reg, '.compaction.lock')), 'verrou libéré à la fin');
        A.ok(!fs.existsSync(path.join(s.reg, 'entrees', 'x.jsonl.tmp-999999')), 'temporaire orphelin retiré');
        A.equal(fs.readdirSync(path.join(s.reg, 'entrees')).filter(function (n) { return /\.tmp-/.test(n); }).length, 0, 'aucun temporaire laissé');
      } finally { nettoyer(s.d); }
    });

    it('SPEC-BANC-090 : un run interrompu, restreint ou lancé sur un arbre modifié n\'est jamais choisi comme run de release', function () {
      var s = scenario();
      try {
        // r2 (commit étiqueté) devient interrompu, r2f restreint : le choix retombe sur r1 (commit précédent, propre)
        var r2 = REG.lireEntrees(s.reg).filter(function (e) { return e.id === 'r2'; })[0];
        var f2 = path.join(s.reg, 'entrees', r2._fichier);
        var l = fs.readFileSync(f2, 'utf8').split('\n'); var m = JSON.parse(l[0]); m.interrompu = true; l[0] = JSON.stringify(m); fs.writeFileSync(f2, l.join('\n'));
        var r2f = REG.lireEntrees(s.reg).filter(function (e) { return e.id === 'r2f'; })[0];
        var ff = path.join(s.reg, 'entrees', r2f._fichier);
        l = fs.readFileSync(ff, 'utf8').split('\n'); m = JSON.parse(l[0]); m.perimetre = 'commit'; l[0] = JSON.stringify(m); fs.writeFileSync(ff, l.join('\n'));
        var r = compacter(s);
        A.ok(r.ok, JSON.stringify(r));
        A.equal(entreeDe(s.reg, 'r1').release, 'v0.1.0', 'le run propre du commit précédent porte la release');
        A.ok(!entreeDe(s.reg, 'r2').release && !entreeDe(s.reg, 'r2f').release, 'ni l\'interrompu ni le restreint');
      } finally { nettoyer(s.d); }
    });

    it('SPEC-BANC-090 : un cycle sans aucun run fiable n\'est ni marqué ni compacté (avertissement)', function () {
      var s = scenario();
      try {
        ['r1', 'r1m', 'r2', 'r2f'].forEach(function (id) {
          var e = entreeDe(s.reg, id); var f = path.join(s.reg, 'entrees', e._fichier);
          var l = fs.readFileSync(f, 'utf8').split('\n'); var m = JSON.parse(l[0]); m.arbre_modifie = true; l[0] = JSON.stringify(m); fs.writeFileSync(f, l.join('\n'));
        });
        var avant = octets(s.reg);
        var r = compacter(s);
        A.ok(r.ok, JSON.stringify(r));
        A.equal(octets(s.reg), avant, 'rien n\'a changé : le détail des runs du cycle est conservé');
        A.ok(r.avertissements.some(function (a) { return /aucun run de référence fiable/.test(a); }), 'avertissement : ' + JSON.stringify(r.avertissements));
      } finally { nettoyer(s.d); }
    });

    it('SPEC-BANC-090 : pr, e2e-fumee et regression complète entrent dans le run de release, pas commit', function () {
      var s = scenario();
      try {
        ecrireEntree(s.reg, { id: 'r2x', commit: s.c2, date: '2026-01-02T10:02:00.000Z', preset: 'regression', tests: [testEntree('t', 'reussi', 'ccc.jpg')] });
        ecrireEntree(s.reg, { id: 'r2z', commit: s.c2, date: '2026-01-02T10:03:00.000Z', preset: 'commit', tests: [testEntree('t', 'reussi', 'ccc.jpg')] });
        compacter(s);
        A.equal(entreeDe(s.reg, 'r2x').release, 'v0.1.0', 'la campagne complète reste une preuve de release');
        A.ok(entreeDe(s.reg, 'r2z').compacte, 'le préréglage réduit reste compacté');
        A.equal(entreeDe(s.reg, 'r2').release, 'v0.1.0');
        A.equal(entreeDe(s.reg, 'r2f').release, 'v0.1.0');
      } finally { nettoyer(s.d); }
    });

    it('SPEC-BANC-091 : un run compacté garde, par test, la fiche réduite de son DERNIER passage (testsConnus, panneau)', function () {
      var s = scenario();
      try {
        // un test qui n'existe que dans r1 (commit ancien) : sa fiche doit survivre
        var e = entreeDe(s.reg, 'r1'); var f = path.join(s.reg, 'entrees', e._fichier);
        var seul = testEntree('disparu', 'reussi'); seul.fiche = { teste: 'x'.repeat(2000), pourquoi: 'p', attendu: 'a', source: 'declaree' };
        fs.appendFileSync(f, JSON.stringify(seul) + '\n');
        compacter(s);
        var apres = entreeDe(s.reg, 'r1');
        var t = apres.tests.filter(function (x) { return x.nom === 'disparu'; })[0];
        var commun = apres.tests.filter(function (x) { return x.nom === 't'; })[0];
        A.ok(t.fiche && t.fiche.teste.length <= 400 && t.fiche.pourquoi === 'p', 'fiche réduite conservée pour le test disparu');
        A.ok(!commun.fiche, 'un test encore présent dans un run plus récent n\'a plus de fiche dans le run compacté');
      } finally { nettoyer(s.d); }
    });

    it('SPEC-BANC-091 : une compaction sauvegardée se restaure octet pour octet (restaurerCompaction)', function () {
      var s = scenario(); var sauv = tmp('sauv');
      try {
        var avant = octets(s.reg);
        var r = compacter(s, { sauvegarde: sauv });
        A.ok(r.ok && r.fichiersTouches.length > 2, 'des fichiers touchés listés : ' + JSON.stringify(r.fichiersTouches));
        A.ok(octets(s.reg) !== avant, 'le registre a bien changé');
        var rr = REG.restaurerCompaction(s.reg, sauv);
        A.ok(rr.ok, JSON.stringify(rr));
        A.equal(octets(s.reg), avant, 'registre restauré à l\'identique');
      } finally { nettoyer(s.d); nettoyer(sauv); }
    });

    function depotVersion() {
      var d = depot();
      fs.mkdirSync(path.join(d, 'tools'), { recursive: true });
      fs.readdirSync(path.join(RACINE, 'tools')).filter(function (f) { return /\.js$/.test(f); }).forEach(function (f) { fs.copyFileSync(path.join(RACINE, 'tools', f), path.join(d, 'tools', f)); });
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
      return { d: d, reg: reg };
    }

    it('SPEC-BANC-091 : --publier qui échoue au commit restaure le registre à l\'identique (fichiers non suivis compris), sans marqueur de release', function () {
      var v = depotVersion();
      try {
        fs.mkdirSync(path.join(v.d, 'hooks-ko'), { recursive: true });
        fs.writeFileSync(path.join(v.d, 'hooks-ko', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 493 });
        git(v.d, ['config', 'core.hooksPath', path.join(v.d, 'hooks-ko').replace(/\\/g, '/')]);
        ecrireImage(v.reg, 'locale.jpg');                                       // image non suivie, référencée par rien : serait supprimée
        ecrireEntree(v.reg, { id: 'loc', commit: git(v.d, ['rev-parse', 'HEAD~1']), date: '2026-01-01T09:00:00.000Z', tests: [testEntree('t', 'reussi', 'locale.jpg')] }); // entrée non suivie
        var avant = octets(v.reg);
        var echec = null;
        try { cp.execFileSync(process.execPath, [path.join(v.d, 'tools', 'version.js'), '--publier'], { cwd: v.d, encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch (e) { echec = e; }
        A.ok(echec, 'la publication échoue (crochet refusant)');
        A.equal(octets(v.reg), avant, 'registre (suivi ET non suivi) restauré à l\'identique');
        A.ok(!REG.lireEntrees(v.reg).some(function (e) { return e.release || e.compacte; }), 'aucun marqueur de release ni compactage résiduel');
        A.equal(git(v.d, ['tag', '--list', 'v0.2.0']), '', 'pas d\'étiquette');
        A.ok(/0\.1\.0/.test(fs.readFileSync(path.join(v.d, 'src', 'core.js'), 'utf8')), 'la version du jeu n\'a pas bougé');
      } finally { nettoyer(v.d); }
    });

    it('SPEC-BANC-091 : --publier n\'ajoute au commit de release que les fichiers du registre réellement touchés (pas impact.json ni les notes locales)', function () {
      var v = depotVersion();
      try {
        fs.writeFileSync(path.join(v.reg, 'impact.json'), '{}\n');
        git(v.d, ['add', '-A']); git(v.d, ['commit', '-q', '-m', 'test(registre): carte']);
        fs.writeFileSync(path.join(v.reg, 'impact.json'), '{"modif":"locale"}\n');            // modif locale non commitée
        fs.writeFileSync(path.join(v.reg, 'notes.txt'), 'notes locales');                      // non suivi
        cp.execFileSync(process.execPath, [path.join(v.d, 'tools', 'version.js'), '--publier'], { cwd: v.d, encoding: 'utf8', env: ENV });
        var fichiers = git(v.d, ['show', '--name-only', '--format=', 'HEAD']).split('\n');
        A.ok(fichiers.indexOf('tests/registre/impact.json') < 0, 'impact.json local hors du commit : ' + fichiers.join(','));
        A.ok(fichiers.indexOf('tests/registre/notes.txt') < 0, 'notes locales hors du commit');
        A.ok(fichiers.some(function (f) { return /entrees\/.*r1/.test(f); }), 'mais les entrées compactées y sont');
        A.ok(/impact\.json/.test(git(v.d, ['status', '--porcelain'])), 'la modif locale reste dans l\'arbre');
      } finally { nettoyer(v.d); }
    });

    it('SPEC-BANC-091 : le crochet n\'énumère pas des centaines de fichiers (resumerFichiers : 10 puis « … N autres »)', function () {
      var liste = []; for (var i = 0; i < 340; i++) liste.push('tests/registre/entrees/f' + i);
      var txt = P.resumerFichiers(liste);
      A.equal(txt.split(', ').length, 11, 'dix noms puis un reste');
      A.ok(/… 330 autres$/.test(txt), 'le reste est compté : ' + txt.slice(-30));
      A.equal(P.resumerFichiers(['a', 'b']), 'a, b', 'une liste courte est intacte');
      A.equal(P.resumerFichiers([]), 'aucun', 'liste vide');
      var run = fs.readFileSync(path.join(RACINE, 'tests', 'run.js'), 'utf8');
      A.ok(/resumerFichiers\(perimetreCalcule\.fichiers\)/.test(run), 'tests/run.js l\'utilise pour la ligne de périmètre');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  describe('Specs — instabilité (revue adversariale) : runs fiables et tests hors carte', function () {
    function carte() {
      var cle = 'G › t', id = P.idTestCarte(cle), o = {}; o[id] = cle;
      var fn = {}; fn['MC.A.f'] = [id];
      return { version: 2, commit: 'x'.repeat(40), preset: 'pr', fichiers: { 'src/a.js': ['MC.A.f'] }, tests: o, fonctions: fn };
    }
    function runsI(etats, modifs, opts) {
      var o = opts || {}; var d = depot(); var reg = path.join(d, 'tests', 'registre'); var c = null;
      etats.forEach(function (etat, i) {
        if (!c || !o.memeCommit) {
          var m = (modifs && modifs[i]) || { 'src/b.js': 'v' + i };
          m = Object.assign({ 'tests/spec-g.js': "describe('G', function () {});\n", 'tests/integration-x.js': '// i\n' }, m);
          Object.keys(m).forEach(function (f) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), m[f]); });
          git(d, ['add', '-A']); git(d, ['commit', '-q', '-m', 'c' + i]); c = git(d, ['rev-parse', 'HEAD']);
        }
        ecrireEntree(reg, { id: 'i' + i, commit: c, date: '2026-02-0' + (i + 1) + 'T10:00:00.000Z', meta: (o.metas || [])[i], tests: [o.test ? o.test(etat) : testEntree('t', etat)] });
      });
      return { d: d, reg: reg };
    }
    function sc(r, c, opts) { return REG.calculerInstabilites(Object.assign({ dossierRegistre: r.reg, dossierRepo: r.d, carte: c }, opts || {})); }
    function integ(etat) { var t = testEntree('integration-x.js (intégration)', etat); t.categorie = { type: 'integration', groupe: 'integration-x.js' }; return t; }

    it('SPEC-BANC-088 : les runs interrompus et ceux lancés sur un arbre modifié ne comptent pas', function () {
      var r = runsI(['echec', 'reussi', 'echec'], null, { metas: [null, { arbre_modifie: true }, null] });
      try { A.ok(!sc(r, carte())['G › t'] || !sc(r, carte())['G › t'].instable, 'le run du milieu (arbre modifié) est écarté : plus d\'alternance'); } finally { nettoyer(r.d); }
      var r2 = runsI(['echec', 'reussi', 'echec'], null, { metas: [null, { interrompu: true }, null] });
      try { A.ok(!sc(r2, carte())['G › t'] || !sc(r2, carte())['G › t'].instable, 'idem pour un run interrompu'); } finally { nettoyer(r2.d); }
    });

    it('SPEC-BANC-088 : un changement du fichier de test du test compte comme un changement', function () {
      var r = runsI(['echec', 'reussi', 'echec'], [{}, { 'tests/spec-g.js': "describe('G', function () { /* corrigé */ });\n" }, { 'tests/spec-g.js': "describe('G', function () { /* encore */ });\n" }]);
      try {
        var res = sc(r, carte())['G › t'];
        A.equal(res.score, 0, 'chaque bascule suit une modification du fichier de test');
        A.ok(!res.instable, 'pas instable');
      } finally { nettoyer(r.d); }
    });

    it('SPEC-BANC-088 : repli pour un test hors carte (intégration) : alternances sur un même commit détectées, instable, marqué horsCarte', function () {
      var r = runsI(['echec', 'reussi', 'echec'], null, { memeCommit: true, test: integ });
      try {
        var res = sc(r, carte())['integration-x.js › integration-x.js (intégration)'];
        A.ok(res, 'évalué malgré son absence de la carte');
        A.equal(res.score, 2, 'deux alternances sans rien changer');
        A.ok(res.instable && res.horsCarte, 'instable, repli signalé');
      } finally { nettoyer(r.d); }
    });

    it('SPEC-BANC-088 : repli hors carte prudent : un src/ ou le fichier du test modifié entre deux commits annule l\'alternance (faux négatif documenté)', function () {
      var r = runsI(['echec', 'reussi', 'echec'], [{ 'src/a.js': '1' }, { 'src/a.js': '2' }, { 'src/a.js': '3' }], { test: integ });
      try { A.ok(!sc(r, carte())['integration-x.js › integration-x.js (intégration)'].instable, 'src/ change à chaque commit : pas d\'étiquette'); } finally { nettoyer(r.d); }
      var r2 = runsI(['echec', 'reussi', 'echec'], [{}, { 'tests/integration-x.js': '// 2\n' }, { 'tests/integration-x.js': '// 3\n' }], { test: integ });
      try { A.ok(!sc(r2, carte())['integration-x.js › integration-x.js (intégration)'].instable, 'son fichier de test change : pas d\'étiquette'); } finally { nettoyer(r2.d); }
      var src = fs.readFileSync(path.join(RACINE, 'tools', 'registre.js'), 'utf8');
      A.ok(/Faux négatif connu/.test(src), 'le faux négatif est documenté dans le code');
    });

    it('SPEC-BANC-088 : la colonne instabilite existe côté client (tests/historique.js), filtrable, et le rapport affiche la ligne d\'instabilité', function () {
      var cli = fs.readFileSync(path.join(RACINE, 'tests', 'historique.js'), 'utf8');
      A.ok(/id: 'instabilite', label: [^,]+, type: 'nombre'/.test(cli), 'colonne client de type nombre (donc filtrable)');
      var H = require(path.join(RACINE, 'tools', 'historique.js'));
      A.equal(H.TYPES_COLONNES.instabilite, 'nombre', 'même type côté serveur');
      var html = G.MC_RAPPORT.html({ campagne: { preset: 'x', debut: '2026-01-01T00:00:00Z', totaux: {} }, tests: [{ nom: 'n', etat: 'ok', duree_ms: 1, type: 'unitaire', groupe: 'G', instabilite: { score: 2, instable: true, runs: 5 } }] });
      A.ok(/instabilité : 2 alternance/.test(html), 'ligne d\'instabilité dans le rapport');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
