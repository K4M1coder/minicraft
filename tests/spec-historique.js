/* spec-historique.js — tests de tools/historique.js (logique pure du
   tableau « Historique global », SPEC-BANC-033 à 040, docs/banc/
   historique-global.md §1 à §3.1). Fichier Node-only, comme spec-banc.js
   (voir son en-tête) : `require`/`process`/`__dirname` sont exposés par
   tests/run.js pour cette seule raison. Pas chargé côté navigateur (absent
   de la liste `fichiersTests` de tests/index.html), et Node-only dans la
   liste TESTS de tests/run.js. */
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
})(typeof globalThis !== 'undefined' ? globalThis : this);
