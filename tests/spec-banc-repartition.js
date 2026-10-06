/* spec-banc-repartition.js — colonnes-listes filtrables, panneau « Répartition »
   et sélection regroupée du banc (SPEC-BANC-063, 064, 065, docs/banc/
   historique-global.md §3.5). Fichier Node seulement, comme spec-historique.js
   (il lit le disque et lance le script de la page dans un faux DOM,
   tests/aide-faux-dom.js) ; la page réelle (vrai DOM, vrai serveur) est
   vérifiée par les e2e de tests/e2e-banc.js. */
(function (G) {
  'use strict';
  var T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path'), vm = require('vm');
  var URLSearchParams = require('url').URLSearchParams;
  var RACINE = path.join(__dirname, '..');
  var H = require(path.join(RACINE, 'tools', 'historique.js'));
  var REP = require(path.join(RACINE, 'tools', 'repartition.js'));
  var DOM = require(path.join(RACINE, 'tests', 'aide-faux-dom.js'));

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
  /* Un petit registre : quatre tests dont un à deux domaines, un ignoré avec
     sa raison et un avertissement. */
  function jeu() {
    return H.construireLignes([run({ id: 'r1', tests: [
      test({ nom: 'a', categorie: { type: 'unitaire', groupe: 'G1' }, domaines: ['RENDU', 'SYNC'], specs: ['SPEC-RENDU-001', 'SPEC-SYNC-001'], fonctions: ['MC.Mesher.tileOrigin'], etiquettes: ['rendu'], duree_ms: 100 }),
      test({ nom: 'b', categorie: { type: 'spec', groupe: 'G2' }, domaines: ['SYNC'], specs: ['SPEC-SYNC-001'], fonctions: ['MC.Synchro.x'], etat: 'echec', duree_ms: 300 }),
      test({ nom: 'c', categorie: { type: 'e2e', groupe: 'e2e' }, domaines: ['RENDU'], etat: 'ignore', raison: 'pas de WebGL dans cet environnement', duree_ms: 50 }),
      test({ nom: 'd', categorie: { type: 'spec', groupe: 'G2' }, domaines: [], etat: 'avertissement', raison: 'lent : 14 s > seuil 8 s', duree_ms: 14000 }),
    ] })]);
  }
  var LIGNES = jeu();

  describe('Specs — banc : colonnes-listes filtrables et répartition (SPEC-BANC-063, 064)', function () {

    it('SPEC-BANC-063 : catégorie, domaines, specs, fonctions et étiquettes sont des colonnes filtrables avec effectifs', function () {
      var eff = H.effectifsToutesEnum(LIGNES);
      ['type', 'groupe', 'domaines', 'specs', 'fonctions', 'etiquettes'].forEach(function (c) {
        A.ok(Array.isArray(eff[c]) && eff[c].length > 0, 'effectifs fournis pour la colonne ' + c);
      });
      A.deep(eff.type.map(function (e) { return e.valeur + ':' + e.effectif; }).sort(), ['e2e:1', 'spec:2', 'unitaire:1'], 'catégorie : un test par valeur');
      // filtrer sur un domaine ne garde que les tests qui le déclarent dans leur liste
      var rendu = H.filtrerLignes(LIGNES, { domaines: ['RENDU'] }).map(function (l) { return l.nom; }).sort();
      A.deep(rendu, ['a', 'c'], 'seuls a et c déclarent RENDU');
      // multi-sélection : union des valeurs choisies
      var deux = H.filtrerLignes(LIGNES, { domaines: ['RENDU', 'SYNC'] }).map(function (l) { return l.nom; }).sort();
      A.deep(deux, ['a', 'b', 'c'], 'RENDU ou SYNC');
      A.deep(H.filtrerLignes(LIGNES, { fonctions: ['MC.Mesher.tileOrigin'] }).map(function (l) { return l.nom; }), ['a'], 'fonction');
      A.deep(H.filtrerLignes(LIGNES, { specs: ['SPEC-SYNC-001'] }).map(function (l) { return l.nom; }).sort(), ['a', 'b'], 'spec');
      A.deep(H.filtrerLignes(LIGNES, { etiquettes: ['rendu'] }).map(function (l) { return l.nom; }), ['a'], 'étiquette');
      A.deep(H.filtrerLignes(LIGNES, { type: ['spec'] }).map(function (l) { return l.nom; }).sort(), ['b', 'd'], 'catégorie');
    });

    it('SPEC-BANC-063 : un test à deux domaines compte dans l\'effectif des deux', function () {
      var eff = {};
      H.effectifsEnum(LIGNES, 'domaines').forEach(function (e) { eff[e.valeur] = e.effectif; });
      A.equal(eff.RENDU, 2, 'a (RENDU, SYNC) et c comptent dans RENDU');
      A.equal(eff.SYNC, 2, 'a et b comptent dans SYNC');
    });

    it('SPEC-BANC-063 : l\'en-tête du tableau offre un multi-sélecteur par colonne-liste, avec les effectifs, et le choix filtre la requête', function () {
      var lignes = LIGNES;
      var d = DOM.fauxDom(function (url) {
        var q = new URLSearchParams(url.split('?')[1] || '');
        var filtree = H.filtrerLignes(lignes, JSON.parse(q.get('filtre') || '{}'));
        return { lignes: filtree, total: filtree.length, page: 1, taille: 50, effectifs: H.effectifsToutesEnum(lignes) };
      });
      d.H.etat.colonnes = ['type', 'groupe', 'domaines', 'specs', 'fonctions', 'etiquettes', 'nom', 'etat'];
      d.H.ouvrir();
      var selects = d.obtenir('__thead').tous(function (n) { return n.tagName === 'SELECT' && n.attrs['data-col']; });
      var cols = selects.map(function (s) { return s.attrs['data-col']; });
      ['type', 'groupe', 'domaines', 'specs', 'fonctions', 'etiquettes'].forEach(function (c) {
        A.ok(cols.indexOf(c) >= 0, 'un sélecteur pour la colonne ' + c + ' (' + cols.join(',') + ')');
      });
      var dom = selects.filter(function (s) { return s.attrs['data-col'] === 'domaines'; })[0];
      A.equal(dom.attrs.multiple, 'multiple', 'multi-sélection');
      var libelles = dom.children.map(function (o) { return o.textContent; }).sort();
      A.deep(libelles, ['RENDU (2)', 'SYNC (2)'], 'valeurs avec leurs effectifs');
      dom.children.forEach(function (o) { o.value = o.attrs.value; o.selected = o.attrs.value === 'SYNC'; });   // le faux DOM ne reflète pas l'attribut sur la propriété
      dom.declencher('change');
      var dernier = JSON.parse(new URLSearchParams(d.appels[d.appels.length - 1].split('?')[1]).get('filtre'));
      A.deep(dernier, { domaines: ['SYNC'] }, 'la requête suivante filtre sur le domaine choisi');
    });

    it('SPEC-BANC-064 : repartition() compte tests, réussis, échecs, ignorés, avertissements et durée cumulée par domaine', function () {
      var r = REP.repartition(LIGNES, 'domaine');
      var par = {};
      r.groupes.forEach(function (g) { par[g.valeur] = g; });
      A.deep(par.RENDU, { valeur: 'RENDU', nb: 2, reussi: 1, echec: 0, ignore: 1, avertissement: 0, duree_ms: 150 }, 'RENDU : a (réussi) et c (ignoré)');
      A.deep(par.SYNC, { valeur: 'SYNC', nb: 2, reussi: 1, echec: 1, ignore: 0, avertissement: 0, duree_ms: 400 }, 'SYNC : a et b (échec)');
      A.deep(par.null, { valeur: null, nb: 1, reussi: 0, echec: 0, ignore: 0, avertissement: 1, duree_ms: 14000 }, 'd n\'a aucun domaine : ligne « (aucune) »');
      A.equal(r.groupes[r.groupes.length - 1].valeur, null, '« (aucune) » en dernier');
      A.equal(r.total, 4, 'total = nombre de lignes de la vue, pas la somme des groupes');
      A.equal(r.champ, 'domaines');
    });

    it('SPEC-BANC-064 : une valeur répétée dans une liste ne compte le test qu’une fois', function () {
      var l = H.construireLignes([run({ id: 'rd', tests: [
        test({ nom: 'dup', domaines: ['RENDU', 'RENDU'], specs: ['SPEC-BANC-064', 'SPEC-BANC-064'], fonctions: ['MC.F.f', 'MC.F.f'], etiquettes: ['t', 't'] }),
      ] })]);
      ['domaine', 'spec', 'fonction', 'etiquette'].forEach(function (dim) {
        var r = REP.repartition(l, dim);
        A.equal(r.groupes.length, 1, dim + ' : un seul groupe');
        A.equal(r.groupes[0].nb, 1, dim + ' : le test n’est compté qu’une fois');
      });
    });

    it('SPEC-BANC-064 : toutes les dimensions (catégorie, spec, fonction, étiquette, raison) ; une dimension inconnue ou héritée est refusée', function () {
      var cat = REP.repartition(LIGNES, 'categorie').groupes.map(function (g) { return g.valeur + ':' + g.nb; }).sort();
      A.deep(cat, ['e2e:1', 'spec:2', 'unitaire:1']);
      var specs = REP.repartition(LIGNES, 'spec').groupes.filter(function (g) { return g.valeur === 'SPEC-SYNC-001'; })[0];
      A.equal(specs.nb, 2, 'une spec citée par deux tests');
      A.equal(REP.repartition(LIGNES, 'fonction').groupes[0].nb, 1);
      A.equal(REP.repartition(LIGNES, 'etiquette').groupes.filter(function (g) { return g.valeur === 'rendu'; })[0].nb, 1);
      // SPEC-BANC-089 : la répartition peut compter par raison
      var raison = REP.repartition(LIGNES, 'raison').groupes;
      A.ok(raison.some(function (g) { return g.valeur === 'pas de WebGL dans cet environnement' && g.ignore === 1; }), 'ignoré compté sous sa raison');
      A.ok(raison.some(function (g) { return g.valeur === 'lent : 14 s > seuil 8 s' && g.avertissement === 1; }), 'avertissement compté sous sa raison');
      A.throws(function () { REP.repartition(LIGNES, 'inconnue'); }, 'dimension inconnue');
      A.throws(function () { REP.repartition(LIGNES, 'constructor'); }, 'propriété héritée');
      A.equal(REP.estDimension('__proto__'), false);
      A.equal(REP.classeEtat('delai'), 'echec', 'un délai dépassé est un échec');
      A.equal(REP.classeEtat('ok'), 'reussi', 'vocabulaire d\'un ancien cahier');
      A.deep(REP.repartition(null, 'domaine').groupes, [], 'entrée absente : répartition vide, sans lever');
    });

    it('SPEC-BANC-064 : le panneau « Répartition » affiche tableau et barres pour la dimension choisie, et un clic sur une barre filtre le tableau', function () {
      var lignes = LIGNES;
      var d = DOM.fauxDom(function (url) {
        var q = new URLSearchParams(url.split('?')[1] || '');
        var filtree = H.filtrerLignes(lignes, JSON.parse(q.get('filtre') || '{}'));
        if (url.indexOf('/tests/historique/repartition') === 0) return Object.assign({ ok: true }, REP.repartition(filtree, q.get('dimension')));
        return { lignes: filtree, total: filtree.length, page: 1, taille: 50, effectifs: H.effectifsToutesEnum(lignes) };
      });
      var panneau = d.obtenir('hist-repartition');
      panneau.hidden = true;           // comme dans tests/index.html
      d.H.ouvrir();
      A.equal(panneau.hidden, true, 'fermé par défaut : rien ne s\'ouvre sans action');
      d.H.repartition(true);
      A.equal(panneau.hidden, false, 'ouvert');
      var req = d.appels.filter(function (u) { return u.indexOf('/tests/historique/repartition') === 0; }).pop();
      A.ok(/dimension=domaine/.test(req), 'dimension par défaut : domaine — ' + req);
      var texte = panneau.textContent;
      ['RENDU', 'SYNC', '(aucune)', 'Réussis', 'Échecs', 'Ignorés', 'Avertissements', 'Durée cumulée'].forEach(function (m) {
        A.ok(texte.indexOf(m) >= 0, 'le tableau montre « ' + m + ' »');
      });
      A.ok(texte.indexOf('14,0 s') >= 0, 'durée cumulée lisible : ' + texte.slice(0, 300));
      var barres = panneau.tous(function (n) { return n.tagName === 'BUTTON' && /hist-rep-barre/.test(n.className) && n.attrs['data-valeur'] !== undefined; });
      A.equal(barres.length, 3, 'une barre par valeur (RENDU, SYNC, aucune)');
      // la dimension se change dans le panneau
      var sel = panneau.tous(function (n) { return n.tagName === 'SELECT'; })[0];
      sel.value = 'categorie';
      sel.declencher('change');
      var req2 = d.appels.filter(function (u) { return u.indexOf('/tests/historique/repartition') === 0; }).pop();
      A.ok(/dimension=categorie/.test(req2), 'nouvelle requête pour la catégorie');
      A.ok(panneau.textContent.indexOf('unitaire') >= 0 && panneau.textContent.indexOf('e2e') >= 0, 'tableau par catégorie');
      // un clic sur la barre « spec » filtre le tableau principal sur cette catégorie
      var barreSpec = panneau.tous(function (n) { return n.tagName === 'BUTTON' && n.attrs['data-valeur'] === 'spec'; })[0];
      barreSpec.click();
      A.deep(d.H.etat.filtresColonnes.type, ['spec'], 'filtre posé sur la colonne type');
      var derniereLignes = d.appels.filter(function (u) { return u.indexOf('/tests/historique/lignes') === 0; }).pop();
      A.deep(JSON.parse(new URLSearchParams(derniereLignes.split('?')[1]).get('filtre')), { type: ['spec'] }, 'le tableau principal est redemandé filtré');
      // et la répartition suit la vue filtrée
      var req3 = d.appels.filter(function (u) { return u.indexOf('/tests/historique/repartition') === 0; }).pop();
      A.deep(JSON.parse(new URLSearchParams(req3.split('?')[1]).get('filtre')), { type: ['spec'] }, 'la répartition suit la vue filtrée');
      // une valeur vide ne se filtre pas
      var avant = JSON.stringify(d.H.etat.filtresColonnes);
      d.H.filtrerSurValeur('domaines', null);
      A.equal(JSON.stringify(d.H.etat.filtresColonnes), avant, '« (aucune) » ne produit pas de filtre');
    });
  });

  describe('Specs — banc : sélection regroupée (SPEC-BANC-065)', function () {
    function catalogueDe() {
      var ctx = vm.createContext({});
      vm.runInContext(fs.readFileSync(path.join(RACINE, 'tests', 'catalogue.js'), 'utf8'), ctx, { filename: 'catalogue.js' });
      return ctx.MC_TESTS;
    }
    var CAT = [
      { cle: 'G › a', nom: 'a', type: 'unitaire', domaines: ['RENDU', 'SYNC'], specs: ['SPEC-RENDU-001'], etiquettes: ['rendu'], fonctions: ['MC.Mesher.tileOrigin'] },
      { cle: 'G › b', nom: 'b', type: 'spec', domaines: ['SYNC'], specs: [], etiquettes: [], fonctions: [] },
      { cle: 'G › c', nom: 'c', type: 'spec', domaines: [], specs: [], etiquettes: ['lent'], fonctions: [] },
    ];

    it('SPEC-BANC-065 : regrouper() par catégorie, domaine, spec, fonction ou étiquette, avec les effectifs', function () {
      var M = catalogueDe();
      var cat = M.regrouper(CAT, 'categorie');
      A.deep(cat.map(function (g) { return g.valeur + ':' + g.effectif; }), ['spec:2', 'unitaire:1']);
      var dom = M.regrouper(CAT, 'domaine');
      A.deep(dom.map(function (g) { return g.valeur + ':' + g.effectif; }), ['SYNC:2', 'RENDU:1', '—:1'], 'un test à deux domaines compte dans les deux ; sans domaine : « — » en dernier');
      A.equal(M.regrouper(CAT, 'spec')[0].valeur, 'SPEC-RENDU-001');
      A.equal(M.regrouper(CAT, 'etiquette').length, 3, 'rendu, lent, et « — » pour le test sans étiquette');
      A.deep(M.regrouper(CAT, 'inconnue'), [], 'dimension inconnue : aucun groupe');
      A.deep(M.regrouper(null, 'domaine'), [], 'catalogue absent');
    });

    it('SPEC-BANC-065 : cocher la fonction MC.Mesher.tileOrigin sélectionne exactement les tests qui la déclarent ou l\'ont observée', function () {
      var M = catalogueDe();
      var observees = { 'MC.Mesher.tileOrigin': ['G › b'], 'MC.Autre.f': ['G › c'] };
      var g = M.regrouper(CAT, 'fonction', observees).filter(function (x) { return x.valeur === 'MC.Mesher.tileOrigin'; })[0];
      A.deep(g.tests.map(function (t) { return t.nom; }).sort(), ['a', 'b'], 'a la déclare, b l\'a observée (carte d\'impact) ; c ne la touche pas');
      A.equal(g.effectif, 2);
      var sans = M.regrouper(CAT, 'fonction').filter(function (x) { return x.valeur === 'MC.Mesher.tileOrigin'; })[0];
      A.deep(sans.tests.map(function (t) { return t.nom; }), ['a'], 'sans carte, seules les fonctions déclarées comptent');
      // jamais deux fois le même test dans un groupe (déclarée ET observée)
      var doublon = M.regrouper(CAT, 'fonction', { 'MC.Mesher.tileOrigin': ['G › a'] }).filter(function (x) { return x.valeur === 'MC.Mesher.tileOrigin'; })[0];
      A.equal(doublon.tests.length, 1, 'déclarée et observée : une seule fois');
    });

    it('SPEC-BANC-065 : la page propose le regroupement et la route des fonctions observées existe côté serveur du banc', function () {
      var page = fs.readFileSync(path.join(RACINE, 'tests', 'index.html'), 'utf8');
      A.ok(/id="regrouper"/.test(page) && /value="fonction"/.test(page), 'sélecteur « Regrouper par » dans la zone de sélection');
      var srv = fs.readFileSync(path.join(RACINE, 'src', 'serveur-banc.js'), 'utf8');
      A.ok(/'\/tests\/historique\/fonctions'/.test(srv), 'route /tests/historique/fonctions');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
