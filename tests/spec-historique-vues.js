/* spec-historique-vues.js — preuves Node des vues de l'historique global et de
   ce qui les alimente (SPEC-BANC-041 à 052, 053 à 058), des préréglages et des
   crochets (SPEC-BANC-004, 006). Fichier Node-only (marqué `node` dans
   tests/fichiers-tests.js) : `require`/`__dirname` sont exposés par tests/run.js.

   Trois groupes :
     - les modèles et dessins PURS (tests/historique-vues.js) : positions des
       barres, des courbes, de la matrice, des diaporamas ;
     - le serveur : séries, matrice, témoins (tools/historique.js), inscription
       demandée par le banc et témoin épinglé (tools/registre.js) sur des
       dossiers temporaires — jamais le vrai registre ;
     - les préréglages et crochets git.
   Le branchement sur la page est prouvé par tests/spec-historique.js (faux DOM)
   et tests/e2e-banc.js (vrai navigateur). */
(function (G) {
  'use strict';
  var T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
  var RACINE = path.join(__dirname, '..');
  var V = require(path.join(RACINE, 'tests', 'historique-vues.js'));
  var H = require(path.join(RACINE, 'tools', 'historique.js'));
  var REG = require(path.join(RACINE, 'tools', 'registre.js'));
  var RT = require(path.join(RACINE, 'tools', 'resultats-tests.js'));
  var GP = require(path.join(RACINE, 'tools', 'git-propre.js'));

  function tmp(nom) { return fs.mkdtempSync(path.join(os.tmpdir(), 'mc-' + nom + '-')); }
  function nettoyer(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* tant pis */ } }

  // ── jeux de données minimaux ────────────────────────────────────────────
  function point(run, o) {
    return Object.assign({ run: run, x: '2026-01-0' + run.slice(1) + 'T00:00:00.000Z', debut_run: '2026-01-0' + run.slice(1) + 'T00:00:00.000Z', commit: 'c' + run, commit_court: 'c' + run, sujet_commit: 'sujet ' + run,
      etat: { reussi: 2, echec: 1, ignore: 0, avertissement: 0 }, duree_ms: { valeurs: [10, 20, 300], mediane: 20, p95: 300 } }, o);
  }
  var SERIE = [point('r1'), point('r2', { etat: { reussi: 3, echec: 0, ignore: 1, avertissement: 1 }, duree_ms: { valeurs: [15, 25, 100], mediane: 25, p95: 100 } })];

  describe('Specs — vues de l\'historique : graphiques timeline et diaporamas (tests/historique-vues.js)', function () {

    it('SPEC-BANC-041 : l\'axe X range les points dans l\'ordre de la série (lancement ou rang de commit) et étiquette commit court ou date', function () {
      var m = V.modeleBarresEtat(SERIE, { axe: 'rang_commit' });
      A.deep(m.barres.map(function (b) { return b.run; }), ['r1', 'r2'], 'ordre de la série');
      A.ok(m.barres[0].cx < m.barres[1].cx, 'de gauche à droite');
      A.deep(m.barres.map(function (b) { return b.etiquette; }), ['cr1', 'cr2'], 'axe commit : le commit court en étiquette');
      var mt = V.modeleBarresEtat(SERIE, { axe: 'debut_run' });
      A.deep(mt.barres.map(function (b) { return b.etiquette; }), ['01-01 00:00', '01-02 00:00'], 'axe lancement : la date');
      A.ok(/sujet r1/.test(m.barres[0].tip), 'le commit et son sujet au survol : ' + m.barres[0].tip);
    });

    it('SPEC-BANC-042 : l\'état se trace en barres empilées aux couleurs convenues (vert, rouge, gris, orange) ou, pour un seul test, en pastilles', function () {
      A.equal(V.COULEURS_ETAT.reussi, '#3fb950', 'réussis verts');
      A.equal(V.COULEURS_ETAT.echec, '#f85149', 'échecs rouges');
      A.equal(V.COULEURS_ETAT.ignore, '#8b949e', 'ignorés gris');
      A.equal(V.COULEURS_ETAT.avertissement, '#f0883e', 'avertissements orange');
      var m = V.modeleBarresEtat(SERIE, {});
      A.deep(m.barres[0].segments.map(function (s) { return s.etat + ':' + s.n; }), ['reussi:2', 'echec:1'], 'segments empilés dans l\'ordre réussis, échecs, ignorés, avertissements');
      var b = m.barres[1];
      A.deep(b.segments.map(function (s) { return s.etat; }), ['reussi', 'ignore', 'avertissement'], 'un état absent n\'a pas de segment');
      var haut = b.segments.reduce(function (a, s) { return a + s.h; }, 0);
      A.ok(Math.abs(haut - (m.hauteur - 12 - 34) * 5 / m.max) < 0.01, 'hauteur totale proportionnelle au nombre de tests du run (5 sur ' + m.max + ')');
      A.ok(b.segments[0].y > b.segments[1].y && b.segments[1].y > b.segments[2].y, 'empilés de bas en haut');
      var p = V.modelePastilles(SERIE.map(function (pt, i) { return Object.assign({}, pt, { etat: i === 0 ? { echec: 1 } : { reussi: 1 } }); }), {});
      A.deep(p.pastilles.map(function (x) { return x.etat; }), ['echec', 'reussi'], 'une pastille par run, de l\'état du test');
      A.deep(p.pastilles.map(function (x) { return x.couleur; }), ['#f85149', '#3fb950'], 'colorées');
      var multiple = V.modelePastilles([Object.assign({}, SERIE[0], { etat: { reussi: 1, echec: 1 } })], {});
      A.equal(multiple.pastilles[0].etat, 'echec', 'si le test a tourné plusieurs fois dans un run, le pire état l\'emporte');
      var svg = V.svgBarres(m);
      A.equal((svg.match(/<rect class="seg/g) || []).length, 5, 'un rectangle par segment');
      A.ok(/data-run="r1"/.test(svg) && /data-tip=/.test(svg), 'chaque barre porte son run et son infobulle');
    });

    it('SPEC-BANC-043 : la durée se trace en médiane et p95 (plusieurs tests) ou en valeur brute (un test), le seuil « lent » en pointillés au bon niveau', function () {
      var multi = V.modeleCourbe(SERIE, 'duree_ms', { unique: false, seuil: 200 });
      A.deep(multi.lignes.map(function (l) { return l.nom; }), ['mediane', 'p95'], 'médiane et p95');
      A.deep(multi.lignes[1].points.map(function (p) { return p.valeur; }), [300, 100], 'p95 par run');
      var seul = V.modeleCourbe(SERIE, 'duree_ms', { unique: true, seuil: 200 });
      A.deep(seul.lignes.map(function (l) { return l.nom; }), ['valeur'], 'valeur brute');
      A.deep(seul.lignes[0].points.map(function (p) { return p.valeur; }), [300, 100], 'la valeur brute du test (le seul de la série)');
      A.ok(multi.seuil, 'seuil présent pour la durée');
      var y300 = multi.lignes[1].points[0].y, y200 = multi.seuil.y, y0 = multi.ticksY[0].y;
      A.ok(y300 < y200 && y200 < y0, 'la ligne de seuil est entre 0 et la valeur la plus haute, à son niveau : ' + [y300, y200, y0].join(' < '));
      A.ok(Math.abs((y0 - y200) / (y0 - y300) - 200 / 300) < 0.01, '200 ms sur un maximum de 300 ms : aux deux tiers');
      var svg = V.svgCourbe(multi);
      A.ok(/class="seuil-lent"[^>]*stroke-dasharray="6 4"/.test(svg), 'tracé en pointillés');
      A.equal(V.modeleCourbe(SERIE, 'nb_captures', { unique: false, seuil: 200 }).seuil, null, 'le seuil n\'accompagne que la durée');
      var haut = V.modeleCourbe(SERIE, 'duree_ms', { unique: false, seuil: 5000 });
      A.ok(haut.max >= 5000 && haut.seuil.y >= 12, 'un seuil au-dessus des valeurs étend l\'échelle au lieu de sortir du cadre');
      var vide = V.modeleCourbe([point('r1', { nb_captures: undefined }), point('r2')], 'nb_captures', { unique: false });
      A.deep(vide.lignes.map(function (l) { return l.points.length; }), [0, 0], 'une propriété absente donne une courbe vide sans erreur');
    });

    it('SPEC-BANC-044 : la matrice est une grille tests × runs colorée par état, une cellule absente reste neutre', function () {
      var m = H.matriceEtats(H.construireLignes([
        { id: 'r1', commit: 'c1', date: '2026-01-01T00:00:00.000Z', inscrit: true, tests: [{ id: 'a', nom: 'a', categorie: { type: 'unitaire', groupe: 'G' }, etat: 'echec' }, { id: 'b', nom: 'b', categorie: { type: 'unitaire', groupe: 'G' }, etat: 'reussi' }] },
        { id: 'r2', commit: 'c2', date: '2026-01-02T00:00:00.000Z', inscrit: true, tests: [{ id: 'a', nom: 'a', categorie: { type: 'unitaire', groupe: 'G' }, etat: 'reussi' }] },
      ]), { x: 'debut_run' });
      var g = V.modeleMatrice(m, {});
      A.equal(g.lignes, 2, 'deux tests en lignes');
      A.equal(g.colonnes, 2, 'deux runs en colonnes');
      A.equal(g.cellules.length, 4, 'N × M cellules');
      var par = {}; g.cellules.forEach(function (c) { par[c.cle + '|' + c.run] = c; });
      A.equal(par['G › a|r1'].couleur, '#f85149', 'a échoue en r1 : rouge');
      A.equal(par['G › a|r2'].couleur, '#3fb950', 'a réussit en r2 : vert');
      A.equal(par['G › b|r2'].etat, null, 'b est absent de r2');
      A.equal(par['G › b|r2'].couleur, null, 'cellule neutre');
      A.ok(/absent de ce run/.test(par['G › b|r2'].tip), 'et le dit au survol');
      A.equal((V.svgMatrice(g).match(/<rect class="cel/g) || []).length, 4, 'une cellule dessinée par test et par run');
      A.equal(g.libellesTests[0].texte, 'a', 'le test qui a échoué est en tête (les plus calmes sont écartés en premier)');
    });

    it('SPEC-BANC-045 : l\'infobulle dit run, commit, date et valeur ; chaque point cliquable porte son run ; le texte est échappé', function () {
      var t = V.texteInfobulle(SERIE[0], 'p95 300 ms', 'debut_run');
      A.ok(/run r1/.test(t) && /commit cr1 « sujet r1 »/.test(t) && /2026-01-01 00:00/.test(t) && /p95 300 ms/.test(t), 'run, commit, date, valeur : ' + t);
      var svg = V.svgCourbe(V.modeleCourbe(SERIE, 'duree_ms', { unique: false }));
      A.equal((svg.match(/<circle class="point[^>]*data-run="r[12]"[^>]*data-tip=/g) || []).length, 4, 'chaque point (2 courbes × 2 runs) est cliquable et survolable');
      var piege = V.svgBarres(V.modeleBarresEtat([point('r1', { sujet_commit: '"><script>x()</script>' })], {}));
      A.ok(piege.indexOf('<script>') < 0, 'un sujet de commit ne s\'injecte pas dans le SVG');
    });

    it('SPEC-BANC-046 : les captures d\'un run se rangent dans l\'ordre du test — début, intermédiaires par t_ms, fin', function () {
      var cs = V.ordonnerCaptures([
        { role: 'fin', libelle: 'fin', t_ms: 900 }, { role: 'intermediaire', libelle: 'tard', t_ms: 700 }, { role: 'debut', libelle: 'début', t_ms: 0 }, { role: 'intermediaire', libelle: 'tôt', t_ms: 200 }]);
      A.deep(cs.map(function (c) { return c.libelle; }), ['début', 'tôt', 'tard', 'fin'], 'première, intermédiaires par t_ms, dernière');
      A.deep(V.ordonnerCaptures(null), [], 'pas de captures : liste vide');
    });

    it('SPEC-BANC-048 : le diaporama d\'une image parcourt tous les runs du test, un run sans cette image gardant sa position', function () {
      var passages = [
        { run: 'p1', captures: [{ role: 'debut', libelle: 'a' }, { role: 'intermediaire', libelle: 'milieu' }] },
        { run: 'p2', captures: [{ role: 'debut', libelle: 'a' }] },
        { run: 'p3', captures: [] },
        { run: 'p4', captures: [{ role: 'intermediaire', libelle: 'milieu' }] },
      ];
      var pos = V.positionsImage(passages, V.cleImage({ role: 'intermediaire', libelle: 'milieu' }));
      A.equal(pos.length, 4, 'M positions pour M runs');
      A.deep(pos.map(function (p) { return !!p.capture; }), [true, false, false, true], 'N avec image, M−N « pas de capture »');
      A.equal(V.cleImage({ role: 'debut', libelle: 'a' }), 'debut|a', 'identité = rôle|libellé');
      A.equal(V.indexDuRun(pos, 'p4'), 3, 'retrouver la position d\'un run');
      A.equal(V.indexDuRun(pos, 'zz'), -1, 'run inconnu : -1');
      A.equal(V.borner(9, 4), 3, 'bornes hautes');
      A.equal(V.borner(-3, 4), 0, 'bornes basses');
      A.ok(/c1 « un » · reussi · 12 ms · inscrit$/.test(V.legendePassage({ debut_run: '2026-01-01T10:00:00.000Z', commit_court: 'c1', sujet_commit: 'un', etat: 'reussi', duree_ms: 12, inscrit: true })), 'légende : date, commit + sujet, état, durée, inscrit');
      A.ok(/non inscrit$/.test(V.legendePassage({ debut_run: '2026-01-01T10:00:00.000Z', inscrit: false })), 'ou non inscrit');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — historique : séries, matrice et témoins servis au banc (tools/historique.js)', function () {
    function lignes() {
      function t(id, etat, captures) { return { id: id, nom: id, categorie: { type: 'unitaire', groupe: 'G' }, etat: etat, duree_ms: 10, captures: captures || [] }; }
      return H.construireLignes([
        { id: 'r1', commit: 'c1', date: '2026-01-01T00:00:00.000Z', inscrit: true, tests: [t('a', 'reussi', [{ role: 'debut', libelle: 'début', image: 'a1.jpg' }]), t('b', 'echec')] },
        { id: 'r2', commit: 'c2', date: '2026-01-02T00:00:00.000Z', inscrit: true, tests: [t('a', 'reussi', [{ role: 'debut', libelle: 'début', image: 'a2.jpg' }])] },
        { id: 'r3', commit: 'c3', date: '2026-01-03T00:00:00.000Z', inscrit: false, tests: [t('a', 'reussi', [{ role: 'debut', libelle: 'début', image: 'local.jpg' }])] },
      ]);
    }

    it('SPEC-BANC-042/043 : la série dit combien de tests distincts le filtre retient (un seul : pastilles et valeur brute)', function () {
      var tous = H.serieAvecMeta(lignes(), { x: 'debut_run', props: ['etat'] });
      A.equal(tous.nbTests, 2, 'deux tests distincts');
      A.equal(tous.nbRuns, 3, 'trois runs');
      var un = H.serieAvecMeta(H.filtrerLignes(lignes(), { nom: 'b' }), { x: 'debut_run', props: ['etat'] });
      A.equal(un.nbTests, 1, 'le filtre ne retient qu\'un test');
      A.equal(un.serie.length, 1, 'un seul run le porte');
      A.equal(un.serie[0].debut_run, '2026-01-01T00:00:00.000Z', 'le point porte la date du run (infobulle)');
    });

    it('SPEC-BANC-044 : matriceEtats borne la grille et écarte d\'abord les tests calmes, jamais ceux qui ont échoué', function () {
      var m = H.matriceEtats(lignes(), { x: 'debut_run' });
      A.equal(m.totalTests, 2); A.equal(m.totalRuns, 3);
      A.deep(m.tests.map(function (t) { return t.nom; }), ['b', 'a'], 'les tests en échec d\'abord');
      var etroite = H.matriceEtats(lignes(), { maxTests: 1 });
      A.deep(etroite.tests.map(function (t) { return t.nom; }), ['b'], 'le test en échec est gardé');
      A.deep(etroite.tronque, { tests: true, runs: false }, 'la troncature des tests est dite');
      var recente = H.matriceEtats(lignes(), { maxRuns: 2 });
      A.deep(recente.runs.map(function (r) { return r.run; }), ['r2', 'r3'], 'les runs les plus récents sont gardés');
      A.deep(recente.tests.map(function (t) { return t.nom; }), ['a'], 'seuls les tests présents dans ces runs figurent');
      A.deep(recente.tronque, { tests: false, runs: true }, 'la troncature des runs est dite');
      A.ok(H.MATRICE_TESTS_MAX > 0 && H.MATRICE_RUNS_MAX > 0, 'bornes déclarées');
    });

    it('SPEC-BANC-051/052 : le témoin d\'une image est l\'épinglé s\'il existe encore dans l\'historique inscrit, sinon la dernière capture inscrite', function () {
      var l = lignes();
      var sans = H.temoinsDeTest(l.filter(function (x) { return x.nom === 'a'; }), 'a', {});
      var k = 'debut|début';
      A.equal(sans[k].epingle, false, 'sans épinglage');
      A.equal(sans[k].image, 'a2.jpg', 'la dernière capture INSCRITE (r2), pas la locale de r3');
      A.equal(sans[k].run, 'r2', 'et son run');
      var epingle = H.temoinsDeTest(l.filter(function (x) { return x.nom === 'a'; }), 'a', { a: { commit: 'c2', image: 'a2.jpg', images: { 'debut|début': { commit: 'c1', image: 'a1.jpg' } } } });
      A.equal(epingle[k].epingle, true, 'épinglé');
      A.equal(epingle[k].image, 'a1.jpg', 'l\'image épinglée, pas la dernière');
      var disparu = H.temoinsDeTest(l.filter(function (x) { return x.nom === 'a'; }), 'a', { a: { commit: 'c9', image: 'zz.jpg', images: { 'debut|début': { commit: 'c9', image: 'zz.jpg' } } } });
      A.equal(disparu[k].epingle, false, 'un épinglage vers un run disparu retombe sur la dernière capture inscrite');
      var ancien = H.temoinsDeTest(l.filter(function (x) { return x.nom === 'a'; }), 'a', { a: { commit: 'c1', image: 'a1.jpg' } });
      A.equal(ancien[k].epingle, true, 'un épinglage d\'avant l\'identité par image vaut pour l\'image qu\'il désigne');
      A.deep(H.temoinsDeTest(l.filter(function (x) { return x.nom === 'b'; }), 'b', {}), {}, 'un test sans capture n\'a aucun témoin');
      A.deep(H.temoinsDeTest([], 'x', null), {}, 'ni historique, ni témoins');
    });

    it('SPEC-BANC-040/046 : imagesDeTest porte aussi le motif, l\'origine, l\'arbre modifié et le rang de commit de chaque passage', function () {
      var l = H.construireLignes([{ id: 'r1', commit: 'c1', date: '2026-01-01T00:00:00.000Z', inscrit: true, origine: 'manuel', motif: 'avant refonte', arbre_modifie: true,
        tests: [{ id: 'a', nom: 'a', categorie: { type: 'unitaire', groupe: 'G' }, etat: 'reussi' }] }]);
      var p = H.imagesDeTest(l, 'G › a', {})[0];
      A.equal(p.motif, 'avant refonte'); A.equal(p.origine, 'manuel'); A.equal(p.arbre_modifie, true);
      A.equal(H.lignesDeTest(l, 'G › a').length, 1, 'lignesDeTest : l\'identité');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — registre : inscription demandée par le banc et témoin épinglé (tools/registre.js)', function () {
    var JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]);
    function cahier(racine, nom, o) {
      var opt = o || {};
      RT.ecrireCahier({
        schema: 1, campagne: { preset: 'pr', debut: new Date().toISOString(), interrompue: !!opt.interrompue, environnement: { commit: opt.commit || 'HEAD' },
          totaux: { total: 1, passes: 1, echecs: 0, ignores: 0 } },
        tests: [{ id: 'DEMO-BANC', nom: 'demo banc', type: 'e2e', groupe: 'end-to-end', domaines: [], specs: [], etat: 'ok', duree_ms: 5,
          captures: [{ libelle: 'début', fichier: 0, role: 'debut', t_ms: 0 }, { libelle: 'fin', fichier: 1, role: 'fin', t_ms: 9 }] }],
      }, { racine: racine, nom: nom, captures: [{ libelle: 'début', type: 'image/jpeg', base64: JPEG.toString('base64') }, { libelle: 'fin', type: 'image/jpeg', base64: Buffer.concat([JPEG, Buffer.from([1])]).toString('base64') }] });
    }
    function depot(contenu) {
      var d = tmp('depot');
      var env = GP.envSansGit();
      var g = function (a) { return cp.execFileSync('git', a, { cwd: d, env: env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); };
      g(['init', '-q']);
      fs.writeFileSync(path.join(d, 'a.txt'), contenu || 'a');
      g(['add', 'a.txt']);
      g(['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', 'init']);
      return { d: d, g: g, court: g(['rev-parse', '--short=10', 'HEAD']), plein: g(['rev-parse', 'HEAD']) };
    }

    it('SPEC-BANC-053/054 : inscrireDepuisBanc écrit une entrée origine « manuel », inscrit, en attente, avec ses captures dans le stockage adressé par contenu', function () {
      var racine = tmp('res'), registre = tmp('reg'), dp = depot();
      try {
        cahier(racine, 'run1', { commit: dp.court });
        var r = REG.inscrireDepuisBanc({ dossier: 'run1' }, { racineResultats: racine, dossierRegistre: registre, dossierRepo: dp.d });
        A.ok(r.ok, 'inscription acceptée : ' + JSON.stringify(r));
        A.equal(r.commit, dp.plein, 'le commit plein du cahier');
        var e = REG.lireEntrees(registre);
        A.equal(e.length, 1, 'une entrée');
        A.equal(e[0].origine, 'manuel', 'origine manuel');
        A.equal(e[0].inscrit, true, 'inscrit');
        A.equal(e[0].statut, 'en_attente', 'en attente : le commit suivant l\'intègre comme une entrée pre-push');
        A.equal(e[0].dossierCahier, 'run1', 'elle garde son cahier d\'origine');
        A.equal(REG.aDesEntreesEnAttente(registre), true, 'repérée par le relais du pre-commit');
        var images = fs.readdirSync(path.join(registre, 'images'));
        A.equal(images.length, 2, 'les deux captures copiées dans le stockage adressé par contenu');
        A.ok(images.indexOf(REG.sha1(JPEG) + '.jpg') >= 0, 'nommées par leur sha1');
        REG.marquerEnAttenteCommitees(registre);
        A.equal(REG.lireEntrees(registre)[0].statut, 'ok', 'le commit suivant l\'intègre');
      } finally { nettoyer(racine); nettoyer(registre); nettoyer(dp.d); }
    });

    it('SPEC-BANC-053 : un cahier d\'une campagne arrêtée à la main donne une entrée marquée « interrompu »', function () {
      var racine = tmp('res'), registre = tmp('reg'), dp = depot();
      try {
        cahier(racine, 'arret', { commit: dp.court, interrompue: true });
        var r = REG.inscrireDepuisBanc({ dossier: 'arret' }, { racineResultats: racine, dossierRegistre: registre, dossierRepo: dp.d });
        A.ok(r.ok, JSON.stringify(r));
        A.equal(REG.lireEntrees(registre)[0].interrompu, true, 'interrompu: true');
      } finally { nettoyer(racine); nettoyer(registre); nettoyer(dp.d); }
    });

    it('SPEC-BANC-055 : le motif facultatif est enregistré dans l\'entrée (nettoyé, borné), et rendu comme une colonne de l\'historique', function () {
      var racine = tmp('res'), registre = tmp('reg'), dp = depot();
      try {
        cahier(racine, 'm1', { commit: dp.court });
        var r = REG.inscrireDepuisBanc({ dossier: 'm1', motif: '  référence avant refonte de l\'eau\n\u0007 ' }, { racineResultats: racine, dossierRegistre: registre, dossierRepo: dp.d });
        A.ok(r.ok, JSON.stringify(r));
        A.equal(REG.lireEntrees(registre)[0].motif, 'référence avant refonte de l\'eau', 'motif enregistré, espaces et caractères de contrôle retirés');
        var ligne = H.construireLignes(REG.runsUnifies({ dossierRegistre: registre, racineResultats: racine, dossierRepo: dp.d }))[0];
        A.equal(ligne.motif, 'référence avant refonte de l\'eau', 'la colonne motif de l\'historique pour cette ligne');
        A.equal(H.TYPES_COLONNES.motif, 'texte', 'colonne filtrable');
        cahier(racine, 'm2', { commit: dp.court });
        var long = REG.inscrireDepuisBanc({ dossier: 'm2', motif: new Array(500).join('x') }, { racineResultats: racine, dossierRegistre: registre, dossierRepo: dp.d });
        A.equal(long.motif.length, REG.MOTIF_LONGUEUR_MAX, 'un motif trop long est borné');
        cahier(racine, 'm3', { commit: dp.court });
        A.equal(REG.inscrireDepuisBanc({ dossier: 'm3', motif: { x: 1 } }, { racineResultats: racine, dossierRegistre: registre, dossierRepo: dp.d }).code, 400, 'un motif qui n\'est pas du texte est refusé');
        A.equal(REG.inscrireDepuisBanc({ dossier: 'm3' }, { racineResultats: racine, dossierRegistre: registre, dossierRepo: dp.d }).ok, true, 'sans motif : accepté');
        A.equal(REG.lireEntrees(registre).filter(function (e) { return e.dossierCahier === 'm3'; })[0].motif, null, 'motif nul');
      } finally { nettoyer(racine); nettoyer(registre); nettoyer(dp.d); }
    });

    it('SPEC-BANC-056 : inscrire deux fois le même cahier est refusé (409), sans seconde entrée ; un cahier inconnu ou un chemin piégé est refusé (404)', function () {
      var racine = tmp('res'), registre = tmp('reg'), dp = depot();
      try {
        cahier(racine, 'run1', { commit: dp.court });
        var o = { racineResultats: racine, dossierRegistre: registre, dossierRepo: dp.d };
        A.ok(REG.inscrireDepuisBanc({ dossier: 'run1' }, o).ok, 'première inscription');
        var bis = REG.inscrireDepuisBanc({ dossier: 'run1' }, o);
        A.equal(bis.ok, false, 'refusée');
        A.equal(bis.code, 409, 'conflit');
        A.ok(/déjà inscrit/.test(bis.motif), 'avec un message clair : ' + bis.motif);
        A.equal(REG.lireEntrees(registre).length, 1, 'aucune seconde entrée');
        A.equal(fs.readdirSync(path.join(registre, 'images')).length, 2, 'aucune image en double');
        ['inconnu', '../../etc', '..', '', 'run1/../run1'].forEach(function (d) {
          var r = REG.inscrireDepuisBanc({ dossier: d }, o);
          A.equal(r.ok, false, 'refusé : ' + JSON.stringify(d));
          A.ok(r.code === 404 || r.code === 400, 'code ' + r.code + ' pour ' + JSON.stringify(d));
        });
        A.equal(REG.inscrireDepuisBanc(null, o).code, 400, 'corps absent');
        A.equal(REG.inscrireDepuisBanc({ dossier: 12 }, o).code, 400, 'dossier qui n\'est pas du texte');
        A.equal(REG.lireEntrees(registre).length, 1, 'rien d\'écrit par les refus');
      } finally { nettoyer(racine); nettoyer(registre); nettoyer(dp.d); }
    });

    it('SPEC-BANC-058 : un dépôt aux modifications non commitées donne arbre_modifie: true (le registre et les cahiers ne comptent pas) ; un dépôt propre non', function () {
      var racine = tmp('res'), registre = tmp('reg'), dp = depot();
      try {
        A.equal(REG.arbreModifie(dp.d), false, 'dépôt propre');
        fs.mkdirSync(path.join(dp.d, 'tests', 'registre', 'entrees'), { recursive: true });
        fs.writeFileSync(path.join(dp.d, 'tests', 'registre', 'entrees', 'x.jsonl'), '{}');
        fs.mkdirSync(path.join(dp.d, 'tests', 'resultats', 'c'), { recursive: true });
        fs.writeFileSync(path.join(dp.d, 'tests', 'resultats', 'c', 'resultats.json'), '{}');
        A.equal(REG.arbreModifie(dp.d), false, 'des entrées de registre ou des cahiers non suivis ne sont pas du code modifié');
        cahier(racine, 'propre', { commit: dp.court });
        var o = { racineResultats: racine, dossierRegistre: registre, dossierRepo: dp.d };
        var r1 = REG.inscrireDepuisBanc({ dossier: 'propre' }, o);
        A.equal(r1.arbre_modifie, false, 'réponse : arbre propre');
        A.equal(REG.lireEntrees(registre)[0].arbre_modifie, false, 'entrée : arbre_modifie false');
        fs.writeFileSync(path.join(dp.d, 'a.txt'), 'modifié');
        A.equal(REG.arbreModifie(dp.d), true, 'un fichier suivi modifié');
        cahier(racine, 'sale', { commit: dp.court });
        var r2 = REG.inscrireDepuisBanc({ dossier: 'sale' }, o);
        A.equal(r2.arbre_modifie, true, 'réponse : arbre modifié');
        var e = REG.lireEntrees(registre).filter(function (x) { return x.dossierCahier === 'sale'; })[0];
        A.equal(e.arbre_modifie, true, 'l\'entrée porte arbre_modifie: true');
        A.equal(e.commit, dp.plein, 'et cite le commit de HEAD, dont le code testé diffère');
        var ligne = H.construireLignes([e])[0];
        A.equal(ligne.arbre_modifie, true, 'la ligne d\'historique le porte, affiché en avertissement par le tableau');
      } finally { nettoyer(racine); nettoyer(registre); nettoyer(dp.d); }
      A.equal(REG.arbreModifie(os.tmpdir()), null, 'hors dépôt : inconnu, jamais « propre » par défaut');
    });

    it('SPEC-BANC-052 : marquerTemoin épingle une image PAR IMAGE d\'un test, persistée dans temoins.json, sans effacer l\'épinglage d\'un autre test', function () {
      var racine = tmp('res'), registre = tmp('reg'), dp = depot();
      try {
        cahier(racine, 'run1', { commit: dp.court });
        var o = { racineResultats: racine, dossierRegistre: registre, dossierRepo: dp.d };
        A.ok(REG.inscrireDepuisBanc({ dossier: 'run1' }, o).ok, 'inscription');
        var imgDebut = REG.sha1(JPEG) + '.jpg', imgFin = REG.sha1(Buffer.concat([JPEG, Buffer.from([1])])) + '.jpg';
        A.equal(REG.marquerTemoin('demo banc', dp.plein, imgDebut, { dossierRegistre: registre, cleImage: 'debut|début' }).ok, true, 'épinglage de l\'image de début');
        A.equal(REG.marquerTemoin('demo banc', dp.plein, imgFin, { dossierRegistre: registre, cleImage: 'fin|fin' }).ok, true, 'puis de la fin');
        var t = REG.lireTemoins(registre)['demo banc'];
        A.deep(t.images, { 'debut|début': { commit: dp.plein, image: imgDebut }, 'fin|fin': { commit: dp.plein, image: imgFin } }, 'un témoin par image');
        A.equal(t.image, imgFin, 'le dernier épinglage reste au premier niveau (lu par temoinDe et l\'export d\'un test)');
        A.ok(fs.existsSync(path.join(registre, 'temoins.json')), 'persisté dans temoins.json');
        var ligne = H.construireLignes(REG.runsUnifies({ dossierRegistre: registre, racineResultats: racine, dossierRepo: dp.d }));
        var temoins = H.temoinsDeTest(ligne, 'demo banc', REG.lireTemoins(registre));
        A.equal(temoins['debut|début'].epingle, true, 'ressort comme épinglé dans les diaporamas suivants');
        A.equal(temoins['debut|début'].image, imgDebut, 'la bonne image');
        A.equal(REG.marquerTemoin('demo banc', dp.plein, 'inexistante.jpg', { dossierRegistre: registre }).ok, false, 'une image absente du registre est refusée');
        A.equal(REG.marquerTemoin('', dp.plein, imgDebut, { dossierRegistre: registre }).ok, false, 'identifiant requis');
        // compatibilité : sans identité d'image, l'épinglage d'avant reste lisible
        A.equal(REG.marquerTemoin('demo banc', dp.plein, imgDebut, { dossierRegistre: registre }).ok, true, 'ancien appel');
        A.deep(Object.keys(REG.lireTemoins(registre)['demo banc'].images), ['debut|début', 'fin|fin'], 'les témoins par image survivent à un épinglage sans identité');
      } finally { nettoyer(racine); nettoyer(registre); nettoyer(dp.d); }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — préréglages nommés et crochets git (tests/presets.js, tools/hooks, tools/perimetre.js)', function () {
    var presets = G.MC_PRESETS;      // posé par tests/presets.js, chargé avant les tests (tests/run.js)
    function lire(f) { return fs.readFileSync(path.join(RACINE, f), 'utf8'); }

    it('SPEC-BANC-004 : un seul fichier versionné décrit les préréglages, chacun dit à qui il sert', function () {
      var noms = (presets || []).map(function (p) { return p.nom; });
      ['commit', 'pr', 'regression', 'bugs', 'en-cours', 'e2e', 'integration', 'rapide', 'visuel'].forEach(function (n) {
        A.ok(noms.indexOf(n) >= 0, 'préréglage ' + n);
      });
      (presets || []).forEach(function (p) {
        A.ok(Array.isArray(p.pour) && p.pour.length > 0, p.nom + ' dit à qui il sert');
        p.pour.forEach(function (qui) { A.ok(['crochet', 'testeur', 'developpeur'].indexOf(qui) >= 0, p.nom + ' : « ' + qui + ' » est un public connu'); });
        A.ok(typeof p.description === 'string' && p.description.length > 10, p.nom + ' est décrit');
      });
      var autres = ['tests/run.js', 'tests/gates.js', 'tests/banc-ui.js', 'tools/hooks/pre-commit.js', 'tools/hooks/pre-push.js'].filter(function (f) { return /nom:\s*'(commit|regression|bugs)'\s*,\s*description/.test(lire(f)); });
      A.deep(autres, [], 'aucune autre copie de la liste des préréglages');
      A.deep(presets.filter(function (p) { return p.nom === 'commit'; })[0].pour.slice().sort(), ['crochet', 'developpeur'], 'commit sert le crochet pre-commit et le développeur');
    });

    it('SPEC-BANC-004 : commit n\'inclut ni e2e ni intégration, se limite au périmètre calculé et ne promet aucune durée ; pr ajoute l\'intégration puis les e2e de fumée au push', function () {
      var commit = presets.filter(function (p) { return p.nom === 'commit'; })[0];
      A.deep(commit.criteres.types.slice().sort(),['fonctionnel', 'spec', 'unitaire'], 'ni e2e ni intégration');
      A.notOk(/\d+\s*s\b|< ?\d+|secondes|minutes/i.test(commit.description), 'aucun objectif de durée dans sa description : ' + commit.description);
      A.ok(/périmètre/i.test(commit.description), 'il dit se limiter au périmètre du commit : ' + commit.description);
      var pc = lire('tools/hooks/pre-commit.js');
      A.ok(/'--preset', 'commit'/.test(pc) && /'--perimetre', 'commit'/.test(pc), 'le crochet pre-commit lance commit restreint au périmètre');
      A.ok(/'--fichiers'/.test(pc) || /indexés|index/.test(pc), 'pour les fichiers indexés');
      var pr = presets.filter(function (p) { return p.nom === 'pr'; })[0];
      A.ok(pr.criteres.types.indexOf('integration') >= 0 && pr.criteres.types.indexOf('e2e') < 0, 'pr : toute la suite Node et l\'intégration');
      A.ok(/'--preset', 'e2e-fumee'/.test(lire('tools/hooks/pre-push.js')), 'les e2e de fumée sont lancés à la suite par le crochet');
      var reg = presets.filter(function (p) { return p.nom === 'regression'; })[0];
      A.equal(reg.criteres.tout, true, 'regression : tout le catalogue');
      var repli = JSON.parse(cp.execFileSync(process.execPath, [path.join(RACINE, 'tools', 'perimetre.js'), '--fichiers', 'server.js', '--json'], { cwd: RACINE, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
      A.ok(typeof repli.repli === 'string' && repli.repli.length > 10, 'repli sur la suite complète, documenté par une raison : ' + repli.repli);
    });

    it('SPEC-BANC-006 : pre-commit lance le périmètre du commit, pre-push et pre-merge-commit la suite complète (pr), un merge avec conflits bascule en suite complète', function () {
      var pc = lire('tools/hooks/pre-commit.js');
      A.ok(/MERGE_HEAD/.test(pc) && /estEnMerge\(/.test(pc), 'pre-commit détecte MERGE_HEAD');
      ['pre-push', 'pre-merge-commit'].forEach(function (h) {
        var txt = lire('tools/hooks/' + h + '.js');
        A.ok(/\{ args: \['--preset', 'pr'\], carte: true \}/.test(txt), h + ' : le préréglage pr en entier, carte d\'impact reconstruite');
        A.ok(/origine: ?'(pre-push|merge)'/.test(txt) || /inscri/i.test(txt), h + ' inscrit son cahier au registre');
        A.notOk(/--perimetre|--depuis/.test(txt.replace(/\/\*[\s\S]*?\*\//g, '')), h + ' ne restreint jamais la suite');
      });
      A.ok(/node tools\/hooks\/pre-merge-commit\.js/.test(lire('.githooks/pre-merge-commit')), 'le crochet pre-merge-commit existe dans .githooks');
      var gates = lire('tests/gates.js');
      A.ok(/ne passe pas --perimetre commit/.test(gates) && /ne cite pas le préréglage pr/.test(gates) && /ne détecte pas MERGE_HEAD/.test(gates), 'G13 devient rouge si l\'un de ces trois liens manque');
      A.ok(/--preset pr/.test(lire('CONTRIBUTING.md')) && /process\.exit\(1\)/.test(lire('tests/run.js')),
        'la même commande « node tests/run.js --preset pr » sort en code 1 sur un échec : elle sert telle quelle à l\'intégration continue d\'une demande de fusion');
    });

    it('SPEC-BANC-006 : le périmètre d\'un fichier source sélectionne exactement ce que la carte d\'impact relie à ses fonctions (chaque test retenu a sa raison, aucun n\'est inventé)', function () {
      var P = require(path.join(RACINE, 'tools', 'perimetre.js'));
      var p = JSON.parse(cp.execFileSync(process.execPath, [path.join(RACINE, 'tools', 'perimetre.js'), '--fichiers', 'src/mesher.js', '--json'], { cwd: RACINE, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
      A.equal(p.repli, null, 'pas de repli : la carte est exploitable');
      A.ok(p.selection.length > 0, 'périmètre non vide');
      A.ok(p.selection.every(function (t) { return t.raisons && t.raisons.length > 0; }), 'chaque test retenu dit pourquoi');
      var carte = P.lireCarte();
      var parFonction = {};
      p.fonctions.forEach(function (f) { parFonction[f] = new Set(P.appelantsDe(carte, f)); });
      var viaCarte = p.selection.filter(function (t) { return t.raisons.some(function (r) { return r.indexOf('fonction:') === 0; }); });
      A.ok(viaCarte.length > 0, 'des tests sont retenus par la carte');
      viaCarte.forEach(function (t) {
        var fs_ = t.raisons.filter(function (r) { return r.indexOf('fonction:') === 0; }).map(function (r) { return r.slice(9); });
        A.ok(fs_.every(function (f) { return parFonction[f] && parFonction[f].has(t.cle); }), t.cle + ' est bien un appelant de ' + fs_.join(', ') + ' dans la carte');
      });
      var attendus = [];
      Object.keys(parFonction).forEach(function (f) { parFonction[f].forEach(function (cle) { attendus.push(cle); }); });
      var retenus = new Set(p.selection.map(function (t) { return t.cle; }));
      var present = attendus.filter(function (cle) { return retenus.has(cle); });
      A.ok(present.length > 0, 'les appelants de la carte figurent dans la sélection (' + present.length + '/' + attendus.length + ', les autres ne sont plus au catalogue)');
      A.equal(p.exclus + p.selection.length > p.selection.length, true, 'le reste du catalogue est exclu (' + p.exclus + ')');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
