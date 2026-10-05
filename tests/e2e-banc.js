/* e2e-banc.js — le banc se teste lui-même, dans un VRAI navigateur
  (SPEC-BANC-029, 034, 039, 041 à 058, 064, 065 ; docs/banc/historique-global.md §4).

   Ces tests vérifient la page du banc (tests/index.html, tests/historique.js,
   tests/historique-vues.js) : vrais éléments, vrais évènements, vraie mise en
   page. Les RÉPONSES du serveur sont remplacées, le temps du test, par des
   données fabriquées (`avecFetchFactice`) : le résultat ne dépend ni de l'état
   du registre de la machine, ni d'une écriture dans le vrai registre. Les
   routes elles-mêmes (séries, matrice, témoin, inscription) sont prouvées sur
   un vrai serveur par tests/integration-cahiers.js et sous Node par
   tests/spec-historique-vues.js ; le branchement DOM par tests/spec-historique.js.

   Les attentes sont des sondages bornés (jamais un délai fixe pour « laisser
   le temps »). Chaque test rend la page du banc comme il l'a trouvée. */
(function (G) {
  'use strict';
  var API = G.E2E_API;
  if (!API) return;
  var e2e = API.enregistreur('tests/e2e-banc.js');
  var A = API.A, capture = API.capture, wait = API.wait;

  function maintenant() { return performance.now(); }
  /* sondage borné : rend la première valeur vraie de `fn`, échoue au bout de `ms` */
  function attendre(fn, ms, quoi) {
    var t0 = maintenant();
    return new Promise(function (ok, ko) {
      (function boucle() {
        var v = false;
        try { v = fn(); } catch (e) { v = false; }
        if (v) { ok(v); return; }
        if (maintenant() - t0 > (ms || 6000)) { ko(new Error('condition non atteinte à temps' + (quoi ? ' : ' + quoi : ''))); return; }
        setTimeout(boucle, 30);
      })();
    });
  }
  function egal(a, b, m) { A.equal(JSON.stringify(a), JSON.stringify(b), m); }
  /* « il ne se passe rien » : observe `fn` pendant `ms` et échoue AU PREMIER instant où elle devient vraie */
  function observerAbsence(fn, ms, quoi) {
    var t0 = maintenant();
    return new Promise(function (ok, ko) {
      (function boucle() {
        if (fn()) { ko(new Error('survenu alors qu\'il ne devait rien se passer : ' + (quoi || ''))); return; }
        if (maintenant() - t0 >= ms) { ok(true); return; }
        setTimeout(boucle, 30);
      })();
    });
  }

  /* Remplace fetch le temps de `fn` : `routes(url, init)` rend le corps JSON
     (ou { __statut, __corps }) d'une route fabriquée, `undefined` pour laisser
     passer la vraie requête. */
  function avecFetchFactice(routes, fn) {
    var orig = G.fetch;
    var appels = [];
    G.fetch = function (url, init) {
      var u = String(url);
      appels.push({ url: u, init: init || null });
      var rep = routes(u, init || {});
      if (rep === undefined) return orig.apply(G, arguments);
      var statut = rep && rep.__statut ? rep.__statut : 200;
      var corps = rep && rep.__statut ? rep.__corps : rep;
      return Promise.resolve(new Response(JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json' } }));
    };
    return Promise.resolve().then(function () { return fn(appels); }).then(
      function (r) { G.fetch = orig; return r; },
      function (e) { G.fetch = orig; throw e; });
  }
  function dernier(appels, morceau) { return appels.filter(function (a) { return a.url.indexOf(morceau) >= 0; }).pop(); }
  function filtreDe(url) { return JSON.parse(new URLSearchParams(url.split('?')[1]).get('filtre') || '{}'); }
  function visible(n) { if (!n) return false; var r = n.getBoundingClientRect(); var s = getComputedStyle(n); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; }
  function cliquer(n) { n.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }
  function evenement(n, type, extra) { n.dispatchEvent(new MouseEvent(type, Object.assign({ bubbles: true, cancelable: true }, extra || {}))); }
  function touche(n, key) { n.dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true })); }
  function saisir(champ, valeur, type) { champ.value = valeur; champ.dispatchEvent(new Event(type || 'input', { bubbles: true })); }
  function tous(sel, racine) { return Array.prototype.slice.call((racine || document).querySelectorAll(sel)); }
  function zone() { return document.getElementById('zone-historique'); }
  function remiseAZero() {
    if (G.MC_HISTORIQUE && G.MC_HISTORIQUE.reinitialiser) G.MC_HISTORIQUE.reinitialiser();
    tous('.overlay-vignette').forEach(function (n) { n.remove(); });
  }

  // ── données fabriquées ────────────────────────────────────────────────────
  var SHA_FAUX = new Array(41).join('f');
  function ligne(o) {
    return Object.assign({
      run: 'r1', debut_run: '2026-01-01T00:00:00.000Z', commit: new Array(41).join('a'), commit_court: 'aaaaaaaaaa', sujet_commit: 'un sujet', rang_commit: 1,
      branche: 'master', preset: 'pr', origine: 'pre-push', inscrit: true, test: 'N-9', cle: 'e2e › banc factice', nom: 'banc factice', type: 'e2e', groupe: 'e2e',
      domaines: ['BANC'], specs: [], fonctions: [], etiquettes: [], debut_test: '2026-01-01T00:00:01.000Z', duree_ms: 123, etat: 'reussi', erreur: null,
      nb_captures: 0, captures: [], dossierCahier: 'cahier-' + (o && o.run || 'r1'), motif: null, arbre_modifie: false, interrompu: false,
    }, o);
  }
  function serie(n, o) {
    var out = [];
    for (var i = 1; i <= n; i++) {
      out.push(Object.assign({
        run: 'r' + i, x: '2026-01-0' + i + 'T00:00:00.000Z', debut_run: '2026-01-0' + i + 'T00:00:00.000Z', commit: String(i).repeat(40), commit_court: 'cc' + i, sujet_commit: 'sujet ' + i,
        etat: { reussi: 3 + i, echec: i % 2, ignore: 0, avertissement: i === 2 ? 1 : 0 },
        duree_ms: { valeurs: [10 * i, 50 * i, 400], mediane: 50 * i, p95: 400 },
        nb_captures: { valeurs: [2, 2, 3], mediane: 2, p95: 3 },
      }, o));
    }
    return out;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Tableau : bouton, colonnes mémorisées, clic sur une ligne, inscription d'un cahier local
  // ══════════════════════════════════════════════════════════════════════════
  e2e('SPEC-BANC-029/034/039/057/058 : le bouton Historique ouvre la zone, les colonnes se choisissent et se mémorisent, un clic de ligne ouvre le panneau sur CE run, un cahier local se promeut',
    { teste: 'la zone Historique du banc dans un vrai navigateur : ouverture par le bouton de l\'en-tête, sélecteur de colonnes mémorisé, clic sur une ligne, bouton Inscrire sur une ligne locale, avertissement d\'arbre modifié',
      pourquoi: 'les fiches 029, 034, 039, 057 et 058 décrivent ce que voit et fait le testeur ; seuls un vrai DOM, une vraie mise en page et le vrai stockage du navigateur le prouvent',
      attendu: 'le bouton ouvre une zone visible ; décocher la colonne Durée la retire de l\'en-tête et du stockage ; cliquer la seconde ligne ouvre le panneau avec CE run en avant ; la ligne locale porte « Inscrire au registre », la ligne inscrite non ; l\'arbre modifié est signalé' },
    async function () {
      var H = G.MC_HISTORIQUE;
      A.ok(H && H.reinitialiser, 'window.MC_HISTORIQUE présent');
      var lignes = [
        ligne({ run: 'r2', debut_run: '2026-01-02T00:00:00.000Z', etat: 'echec', erreur: 'boum', inscrit: false, dossierCahier: 'cahier-local-r2', arbre_modifie: true, motif: 'essai avant refonte' }),
        ligne({ run: 'r1', debut_run: '2026-01-01T00:00:00.000Z' }),
      ];
      var passages = [
        { run: 'r1', debut_run: lignes[1].debut_run, etat: 'reussi', duree_ms: 10, inscrit: true, preset: 'pr', commit: lignes[1].commit, commit_court: 'aaaaaaaaaa', cle: lignes[0].cle, nom: lignes[0].nom, captures: [] },
        { run: 'r2', debut_run: lignes[0].debut_run, etat: 'echec', duree_ms: 20, inscrit: false, preset: 'commit', commit: lignes[0].commit, commit_court: 'aaaaaaaaaa', cle: lignes[0].cle, nom: lignes[0].nom, captures: [], dossierCahier: 'cahier-local-r2', arbre_modifie: true, erreur: 'boum' },
      ];
      var stockageAvant = null;
      try { stockageAvant = localStorage.getItem('mc-historique-colonnes'); } catch (e) { /* pas de stockage : la mémorisation n'est alors pas vérifiable ici */ }
      try {
        await avecFetchFactice(function (u) {
          if (u.indexOf('/tests/historique/lignes?') === 0) return { lignes: lignes, total: 2, page: 1, taille: 50, effectifs: {} };
          if (u.indexOf('/tests/historique/images?') === 0) return { images: passages, temoins: {} };
          if (u.indexOf('/tests/historique/series?') === 0) return { serie: [], nbTests: 0, nbRuns: 0 };
        }, async function () {
          A.equal(zone().hidden, true, 'la zone est fermée tant qu\'on ne la demande pas');
          var bouton = document.getElementById('btn-historique');
          A.ok(bouton && /Historique/.test(bouton.textContent), 'bouton « Historique » dans l\'en-tête du banc');
          cliquer(bouton);
          await attendre(function () { return visible(zone()) && tous('#hist-table tbody tr').length === 2; }, 6000, 'zone et deux lignes');
          capture('zone Historique ouverte');
          var entetes = function () { return tous('#hist-table thead tr:first-child th').map(function (t) { return t.textContent; }); };
          A.ok(entetes().some(function (t) { return /^Durée/.test(t); }), 'colonne Durée affichée par défaut : ' + entetes().join(' | '));

          // ── 034 : sélecteur de colonnes ──
          cliquer(document.getElementById('hist-colonnes-btn'));
          var menu = document.getElementById('hist-colonnes-menu');
          A.ok(visible(menu), 'le menu « Colonnes » s\'ouvre');
          var caseDe = function (libelle) { return tous('label', menu).filter(function (l) { return l.textContent.trim() === libelle; })[0].querySelector('input'); };
          var cases = tous('input[type=checkbox]', menu);
          A.equal(cases.length, H.colonnes.length, 'une case par propriété de la ligne (' + cases.length + ')');
          ['Run', 'Commit (sha)', 'Fiche', 'Images (libellés)', 'Motif'].forEach(function (l) { A.ok(caseDe(l), 'case « ' + l + ' »'); });
          var durée = caseDe('Durée (ms)');
          durée.checked = false; durée.dispatchEvent(new Event('change', { bubbles: true }));
          await attendre(function () { return !entetes().some(function (t) { return /^Durée/.test(t); }); }, 4000, 'colonne retirée');
          var stocke = null; try { stocke = JSON.parse(localStorage.getItem('mc-historique-colonnes')); } catch (e) { /* stockage indisponible */ }
          if (stocke) A.ok(stocke.indexOf('duree_ms') < 0 && stocke.indexOf('nom') >= 0, 'le choix est mémorisé dans localStorage : ' + JSON.stringify(stocke).slice(0, 80));
          var motifCase = caseDe('Motif'); A.equal(motifCase.checked, true, 'le motif est une colonne affichée');
          durée.checked = true; durée.dispatchEvent(new Event('change', { bubbles: true }));
          await attendre(function () { return entetes().some(function (t) { return /^Durée/.test(t); }); }, 4000, 'colonne rétablie');
          cliquer(document.getElementById('hist-colonnes-btn'));

          // ── 057/058 : lignes ──
          var rangs = tous('#hist-table tbody tr');
          A.ok(rangs[0].querySelector('.hist-inscrire-btn'), 'la ligne du cahier local porte « Inscrire au registre »');
          A.notOk(rangs[1].querySelector('.hist-inscrire-btn'), 'la ligne déjà inscrite ne le porte pas');
          A.ok(/⚠ arbre modifié/.test(rangs[0].textContent), 'l\'arbre modifié est signalé par un avertissement visible : ' + rangs[0].textContent.slice(0, 160));
          A.ok(/essai avant refonte/.test(rangs[0].textContent), 'le motif apparaît dans sa colonne');

          // ── 039 : clic sur la seconde ligne (r1, pas le dernier run) ──
          cliquer(rangs[1].children[1]);
          var panneau = document.getElementById('hist-panneau-test');
          await attendre(function () { return visible(panneau) && panneau.querySelector('.hist-pt-courant'); }, 6000, 'panneau du test');
          A.equal(panneau.querySelector('.hist-pt-courant').getAttribute('data-run'), 'r1', 'le panneau s\'ouvre positionné sur le run cliqué');
          A.equal(tous('.hist-pt-passages > li', panneau).length, 2, 'avec les deux passages du test');
          A.ok(panneau.querySelector('.hist-pt-avertissement'), 'le passage d\'un arbre modifié est signalé aussi dans le panneau');
          capture('panneau du test sur le run cliqué');
        });
      } finally {
        remiseAZero();
        try { if (stockageAvant === null) localStorage.removeItem('mc-historique-colonnes'); else localStorage.setItem('mc-historique-colonnes', stockageAvant); } catch (e) { /* rien */ }
      }
    });

  // ══════════════════════════════════════════════════════════════════════════
  // Graphiques timeline
  // ══════════════════════════════════════════════════════════════════════════
  e2e('SPEC-BANC-041/042/043/044/045 : les graphiques suivent les filtres — propriétés et axe au choix, barres ou pastilles, courbes avec seuil lent, matrice, infobulle et clic sur un point',
    { teste: 'les graphiques timeline de la zone Historique : cases des propriétés, axe X, état en barres ou en pastilles, durée en courbes avec le seuil lent en pointillés, vue matrice, infobulle au survol, clic filtrant le tableau',
      pourquoi: 'un graphique ne se prouve que par ce que le navigateur dessine réellement (éléments SVG, tailles, couleurs, évènements) ; les modèles purs sont prouvés sous Node mais pas leur insertion dans la page',
      attendu: 'cocher la durée fait apparaître sa courbe et son seuil en pointillés ; un seul test donne des pastilles, plusieurs des barres empilées ; la matrice est une grille N×M colorée ; le survol affiche run, commit, date et valeur ; un clic sur un point filtre le tableau sur ce run sans réduire le graphique' },
    async function () {
      var H = G.MC_HISTORIQUE;
      var nbTests = 3;
      try {
        await avecFetchFactice(function (u) {
          if (u.indexOf('/tests/historique/lignes?') === 0) return { lignes: [], total: 0, page: 1, taille: 50, effectifs: {} };
          if (u.indexOf('/tests/historique/series?') === 0) return { serie: serie(3), nbTests: nbTests, nbRuns: 3 };
          if (u.indexOf('/tests/historique/matrice?') === 0) {
            return { runs: serie(3), tests: [{ cle: 'e2e › a', nom: 'a', echecs: 1 }, { cle: 'e2e › b', nom: 'b', echecs: 0 }],
              cellules: { 'e2e › a': { r1: 'echec', r2: 'reussi', r3: 'reussi' }, 'e2e › b': { r1: 'reussi', r2: 'reussi' } }, tronque: { tests: false, runs: false }, totalTests: 2, totalRuns: 3 };
          }
        }, async function (appels) {
          cliquer(document.getElementById('btn-historique'));
          var graphes = document.getElementById('hist-graphes');
          A.equal(graphes.hidden, true, 'les graphiques ne s\'ouvrent pas tout seuls');
          cliquer(document.getElementById('hist-graphes-btn'));
          await attendre(function () { return visible(graphes) && graphes.querySelector('svg[data-graphe="etat-barres"]'); }, 6000, 'barres d\'état');
          // 042 : plusieurs tests → barres empilées, couleurs de l'état
          var segs = tous('svg[data-graphe="etat-barres"] rect.seg');
          A.ok(segs.length >= 6, 'des segments empilés : ' + segs.length);
          A.ok(segs.every(function (s) { return s.getBoundingClientRect().height > 0; }), 'chaque segment a une hauteur visible');
          var couleurs = {}; segs.forEach(function (s) { couleurs[s.getAttribute('data-etat')] = s.getAttribute('fill'); });
          A.equal(couleurs.reussi, '#3fb950', 'réussis verts');
          A.equal(couleurs.echec, '#f85149', 'échecs rouges');
          A.equal(couleurs.avertissement, '#f0883e', 'avertissements orange');
          capture('état en barres empilées');

          // 041 : cocher la durée → sa courbe ; 043 : médiane, p95, seuil en pointillés
          var caseDuree = graphes.querySelector('input[data-prop="duree_ms"]');
          caseDuree.checked = true; caseDuree.dispatchEvent(new Event('change', { bubbles: true }));
          await attendre(function () { return graphes.querySelector('svg[data-graphe="courbe-duree_ms"]'); }, 6000, 'courbe de durée');
          var courbe = graphes.querySelector('svg[data-graphe="courbe-duree_ms"]');
          A.ok(courbe.querySelector('.courbe-mediane') && courbe.querySelector('.courbe-p95'), 'plusieurs tests : médiane et p95');
          var seuil = courbe.querySelector('line.seuil-lent');
          A.ok(seuil && seuil.getAttribute('stroke-dasharray') === '6 4', 'seuil « lent » en pointillés');
          A.ok(/props=etat%2Cduree_ms/.test(dernier(appels, '/series?').url), 'la durée a été demandée au serveur');
          var yp95 = parseFloat(courbe.querySelector('.point-p95').getAttribute('cy')), ySeuil = parseFloat(seuil.getAttribute('y1'));
          A.ok(ySeuil < yp95, 'le seuil (8 s) est tracé plus haut que le p95 (400 ms) — y croît vers le bas : ' + ySeuil + ' < ' + yp95);
          capture('courbe de durée avec seuil lent');

          // 042 : un seul test → pastilles
          nbTests = 1;
          var radioCommit = graphes.querySelector('input[data-axe="rang_commit"]');
          radioCommit.checked = true; radioCommit.dispatchEvent(new Event('change', { bubbles: true }));
          await attendre(function () { return graphes.querySelector('svg[data-graphe="etat-pastilles"]'); }, 6000, 'pastilles');
          A.equal(tous('svg[data-graphe="etat-pastilles"] circle').length, 3, 'une pastille par run filtré');
          A.ok(/x=rang_commit/.test(dernier(appels, '/series?').url), '041 : l\'axe commit est demandé');
          A.ok(graphes.querySelector('svg[data-graphe="courbe-duree_ms"] .courbe-valeur') && !graphes.querySelector('svg[data-graphe="courbe-duree_ms"] .courbe-p95'), 'un seul test : valeur brute de la durée');
          var etiquettes = tous('svg[data-graphe="etat-pastilles"] text.hist-axe-x').map(function (t) { return t.textContent; });
          A.ok(etiquettes.indexOf('cc1') >= 0, 'axe commit : étiquettes en commit court : ' + etiquettes.join(','));
          nbTests = 3;
          var radioLancement = graphes.querySelector('input[data-axe="debut_run"]');
          radioLancement.checked = true; radioLancement.dispatchEvent(new Event('change', { bubbles: true }));
          await attendre(function () { return graphes.querySelector('svg[data-graphe="etat-barres"]'); }, 6000, 'barres de retour');

          // 045 : infobulle
          var cible = graphes.querySelector('svg[data-graphe="courbe-duree_ms"] .point-p95');
          var r = cible.getBoundingClientRect();
          evenement(cible, 'mouseover', { clientX: r.left + 2, clientY: r.top + 2 });
          var tip = document.getElementById('hist-infobulle');
          await attendre(function () { return visible(tip); }, 3000, 'infobulle');
          A.ok(/run r\d/.test(tip.textContent) && /commit cc\d/.test(tip.textContent) && /2026-01-0\d/.test(tip.textContent) && /400/.test(tip.textContent), 'infobulle : run, commit, date, valeur — ' + tip.textContent);
          var bt = tip.getBoundingClientRect();
          A.ok(bt.right <= G.innerWidth + 1 && bt.bottom <= G.innerHeight + 1, 'l\'infobulle reste dans la fenêtre');
          capture('infobulle d\'un point');
          evenement(cible, 'mouseleave');
          evenement(graphes.querySelector('.hist-gr-corps'), 'mouseleave');
          // 045 : clic sur un point → tableau filtré sur ce run, graphique inchangé
          var nSeries = appels.filter(function (a) { return a.url.indexOf('/series?') >= 0; }).length;
          cliquer(cible);
          var run = cible.getAttribute('data-run');
          await attendre(function () { return dernier(appels, '/tests/historique/lignes?') && filtreDe(dernier(appels, '/tests/historique/lignes?').url).run === run; }, 6000, 'tableau filtré');
          A.equal(H.etat.filtresColonnes.run, run, 'le tableau est filtré sur le run du point cliqué : ' + run);
          await attendre(function () { return appels.filter(function (a) { return a.url.indexOf('/series?') >= 0; }).length > nSeries; }, 4000, 'graphique redemandé');
          A.equal(filtreDe(dernier(appels, '/series?').url).run, undefined, 'le graphique ne se réduit pas à ce run');
          await attendre(function () { return tous('#hist-table thead tr:first-child th').some(function (t) { return t.textContent === 'Run'; }); }, 4000, 'colonne Run');
          A.ok(true, 'la colonne du filtre est visible');

          // 044 : matrice
          var casem = document.getElementById('hist-gr-matrice');
          casem.checked = true; casem.dispatchEvent(new Event('change', { bubbles: true }));
          await attendre(function () { return graphes.querySelector('svg[data-graphe="matrice"]'); }, 6000, 'matrice');
          var cellules = tous('svg[data-graphe="matrice"] rect.cel');
          A.equal(cellules.length, 6, 'grille 2 tests × 3 runs');
          A.ok(cellules.some(function (c) { return c.getAttribute('data-etat') === 'echec' && c.getAttribute('fill') === '#f85149'; }), 'cellule en échec rouge');
          A.ok(cellules.some(function (c) { return c.getAttribute('data-etat') === ''; }), 'une cellule absente reste neutre');
          capture('vue matrice');
          casem.checked = false; casem.dispatchEvent(new Event('change', { bubbles: true }));
          await attendre(function () { return graphes.querySelector('svg[data-graphe="etat-barres"]'); }, 6000, 'retour aux barres');
        });
      } finally { remiseAZero(); }
    });

  // ══════════════════════════════════════════════════════════════════════════
  // Diaporamas par image
  // ══════════════════════════════════════════════════════════════════════════
  /* Images RÉELLES du registre (celles que le serveur sert déjà) : le banc les
     affiche dans ses vignettes ; sans elles une vignette serait remplacée par
     « image introuvable ». */
  async function imagesDuRegistre() {
    var rep = await fetch('/tests/historique/lignes?rapide=inscrits&taille=500&filtre=' + encodeURIComponent(JSON.stringify({ nb_captures: { min: 1 } })));
    var j = await rep.json();
    var vues = [];
    (j.lignes || []).forEach(function (l) {
      (l.captures || []).forEach(function (c) { if (c.image && /^[0-9a-f]{40}\.jpg$/.test(c.image) && vues.indexOf(c.image) < 0) vues.push(c.image); });
    });
    return vues;
  }
  e2e('SPEC-BANC-046/047/048/049/050/051/052 : vignettes fixes, aucun diaporama sans clic, un diaporama par image, navigation, lecture explicite, synchronisation, témoin, comparaison et épinglage',
    { teste: 'le panneau d\'un test : vignettes fixes, diaporama de l\'image cliquée seulement, runs sans image, plusieurs diaporamas indépendants ou synchronisés, flèches, curseur, lecture automatique, témoin, comparaison rideau et clignotement, épinglage',
      pourquoi: 'c\'est la partie la plus interactive du banc (évènements clavier, curseur, minuteries, superposition d\'images, mise en page à largeur variable) : rien de cela ne se prouve sans un vrai navigateur',
      attendu: 'ouvrir un panneau ne fait apparaître aucun diaporama ; un clic de vignette n\'ouvre que celui de cette image, sur le run cliqué, avec une case « pas de capture » pour un run sans cette image ; flèche droite avance d\'un run, le curseur saute, la lecture ne part que sur son bouton ; synchroniser aligne ; le rideau et le clignotement superposent le témoin ; épingler envoie la bonne requête' },
    async function () {
      var H = G.MC_HISTORIQUE;
      var images = await imagesDuRegistre();
      A.gt(images.length, 0, 'le registre de cette machine a au moins une capture inscrite à afficher');
      var iA = images[0], iB = images[1 % images.length], iC = images[2 % images.length];
      var cle = 'e2e › banc diaporama';
      function passage(run, jour, extra) {
        return Object.assign({ run: run, debut_run: '2026-01-0' + jour + 'T00:00:00.000Z', etat: 'reussi', duree_ms: 10 * jour, inscrit: true, preset: 'pr', commit: String(jour).repeat(40), commit_court: 'cc' + jour,
          sujet_commit: 'sujet ' + jour, cle: cle, nom: 'banc diaporama', test: 'N-10', type: 'e2e', dossierCahier: 'k' + jour, captures: [] }, extra);
      }
      var passages = [
        passage('p1', 1, { captures: [{ role: 'debut', libelle: 'début', image: iA, t_ms: 0 }, { role: 'intermediaire', libelle: 'milieu', image: iB, t_ms: 300 }, { role: 'fin', libelle: 'fin', image: iC, t_ms: 900 }] }),
        passage('p2', 2, { etat: 'echec', captures: [{ role: 'debut', libelle: 'début', image: iB, t_ms: 0 }, { role: 'fin', libelle: 'fin', image: iA, t_ms: 900 }] }),
        passage('p3', 3, { captures: [{ role: 'fin', libelle: 'fin', image: iC, t_ms: 900 }, { role: 'debut', libelle: 'début', image: iC, t_ms: 0 }, { role: 'intermediaire', libelle: 'milieu', image: iA, t_ms: 300 }] }),
      ];
      var temoins = { 'debut|début': { epingle: false, run: 'p1', commit: passages[0].commit, commit_court: 'cc1', image: iC } };
      try {
        await avecFetchFactice(function (u, init) {
          if (u.indexOf('/tests/historique/lignes?') === 0) return { lignes: [], total: 0, page: 1, taille: 50, effectifs: {} };
          if (u.indexOf('/tests/historique/images?') === 0) return { images: passages, temoins: temoins };
          if (u.indexOf('/tests/registre/temoin') === 0) return { ok: true };
        }, async function (appels) {
          H.ouvrirTest({ cle: cle, nom: 'banc diaporama', run: 'p3' });
          var panneau = document.getElementById('hist-panneau-test');
          await attendre(function () { return visible(panneau) && tous('img.vignette', panneau).length >= 8; }, 8000, 'vignettes');
          // 046/047 : vignettes fixes, dans l'ordre du test, aucun diaporama
          var li3 = panneau.querySelector('li[data-run="p3"]');
          egal(tous('img.vignette', li3).map(function (i) { return i.getAttribute('data-image'); }), ['debut|début', 'intermediaire|milieu', 'fin|fin'], 'ordre du test : début, intermédiaire, fin');
          A.equal(tous('.hist-diapo', panneau).length, 0, 'aucun diaporama à l\'ouverture');
          A.notOk(visible(document.getElementById('hist-diapos')), 'la zone des diaporamas n\'est pas affichée');
          await observerAbsence(function () { return tous('.hist-diapo', panneau).length > 0 || visible(document.getElementById('hist-diapos')); }, 900, 'un diaporama s\'est ouvert tout seul');
          capture('panneau du test : vignettes fixes');

          // 047/048 : un clic = un diaporama, celui de cette image, sur ce run
          cliquer(li3.querySelector('img.vignette[data-image="intermediaire|milieu"]'));
          await attendre(function () { return tous('.hist-diapo', panneau).length === 1; }, 4000, 'diaporama du milieu');
          var milieu = panneau.querySelector('.hist-diapo[data-image="intermediaire|milieu"]');
          A.ok(visible(milieu), 'le diaporama est visible');
          A.equal(milieu.getAttribute('data-run'), 'p3', 'positionné sur le run cliqué');
          A.equal(tous('img.vignette', li3).length, 3, 'les vignettes restent fixes');
          A.ok(/1\/3|3\/3/.test(milieu.querySelector('.hist-diapo-compteur').textContent), 'compteur de position : ' + milieu.querySelector('.hist-diapo-compteur').textContent);
          touche(milieu, 'ArrowLeft');                              // p2 n'a pas cette image
          A.equal(milieu.getAttribute('data-run'), 'p2', '049/050 : flèche gauche, un run en arrière');
          A.ok(visible(milieu.querySelector('.hist-diapo-vide')) && /pas de capture/.test(milieu.querySelector('.hist-diapo-vide').textContent), 'un run sans cette image : case « pas de capture »');
          A.notOk(visible(milieu.querySelector('.hist-diapo-image')), 'sans image affichée');
          touche(milieu, 'ArrowRight');
          A.equal(milieu.getAttribute('data-run'), 'p3', 'flèche droite : un run en avant');
          A.ok(/inscrit/.test(milieu.querySelector('.hist-diapo-legende').textContent) && /cc3/.test(milieu.querySelector('.hist-diapo-legende').textContent), 'légende : commit, état, durée, inscrit : ' + milieu.querySelector('.hist-diapo-legende').textContent);
          capture('diaporama du milieu');

          // 049 : un deuxième diaporama, indépendant
          cliquer(li3.querySelector('img.vignette[data-image="debut|début"]'));
          await attendre(function () { return tous('.hist-diapo', panneau).length === 2; }, 4000, 'second diaporama');
          var debut = panneau.querySelector('.hist-diapo[data-image="debut|début"]');
          A.equal(debut.getAttribute('data-run'), 'p3', 'le second est sur le run cliqué');
          A.equal(milieu.getAttribute('data-run'), 'p3', 'le premier n\'a pas bougé');
          cliquer(li3.querySelector('img.vignette[data-image="debut|début"]'));
          A.equal(tous('.hist-diapo', panneau).length, 2, 'recliquer la même image ne multiplie pas les diaporamas');
          var zoneD = document.getElementById('hist-diapos-liste');
          A.ok(getComputedStyle(zoneD).flexWrap === 'wrap', 'les diaporamas passent à la ligne selon la largeur');
          var bm = milieu.getBoundingClientRect(), bd = debut.getBoundingClientRect();
          A.ok(bm.right <= bd.left + 2 || bd.right <= bm.left + 2 || bd.top >= bm.bottom - 2 || bm.top >= bd.bottom - 2, 'côte à côte (ou à la ligne), sans se recouvrir');
          touche(debut, 'ArrowLeft');
          A.equal(debut.getAttribute('data-run'), 'p2', 'avancer l\'un…');
          A.equal(milieu.getAttribute('data-run'), 'p3', '…ne déplace pas l\'autre');
          // 050 : curseur
          var curseur = debut.querySelector('.hist-diapo-curseur');
          saisir(curseur, '0', 'input');
          A.equal(debut.getAttribute('data-run'), 'p1', 'le curseur déplacé va directement à ce run');
          // 049 : synchroniser
          cliquer(document.getElementById('hist-diapos-sync'));
          A.equal(debut.getAttribute('data-run'), milieu.getAttribute('data-run'), 'synchroniser aligne les deux diaporamas sur le même run');
          touche(debut, 'ArrowRight');
          A.equal(debut.getAttribute('data-run'), milieu.getAttribute('data-run'), 'ensuite ils avancent ensemble');
          cliquer(document.getElementById('hist-diapos-sync'));

          // 050 : lecture automatique seulement sur le bouton
          A.equal(debut.getAttribute('data-lecture'), '0', 'la lecture ne démarre pas à l\'ouverture');
          saisir(curseur, '0', 'input');
          var vit = debut.querySelector('.hist-diapo-vitesse');
          saisir(vit, '2', 'change');
          cliquer(debut.querySelector('.hist-diapo-lecture'));
          A.equal(debut.getAttribute('data-lecture'), '1', 'le bouton lance la lecture');
          await attendre(function () { return debut.getAttribute('data-run') !== 'p1'; }, 3000, 'la lecture avance');
          await attendre(function () { return debut.getAttribute('data-lecture') === '0'; }, 4000, 'la lecture s\'arrête au dernier run');
          A.equal(debut.getAttribute('data-run'), 'p3', 'arrêtée sur le dernier run');

          // 051 : témoin en vignette fixe, comparaison
          A.equal(debut.getAttribute('data-temoin'), 'derniere', 'sans épinglage : la dernière capture inscrite');
          await attendre(function () { return visible(debut.querySelector('.hist-temoin-img')); }, 4000, 'vignette du témoin');
          A.ok(visible(debut.querySelector('.hist-temoin-img')), 'le témoin reste affiché en vignette fixe');
          cliquer(debut.querySelector('.hist-diapo-comparer'));
          var sup = debut.querySelector('.hist-diapo-superpose');
          await attendre(function () { return visible(debut.querySelector('.hist-diapo-image')) && sup.getAttribute('src'); }, 4000, 'témoin superposé');
          A.ok(/inset\(0(px)? 50%/.test(getComputedStyle(sup).clipPath) || /inset\(0px 50% 0px 0px\)/.test(getComputedStyle(sup).clipPath), 'rideau à moitié : ' + getComputedStyle(sup).clipPath);
          saisir(debut.querySelector('.hist-diapo-rideau'), '90', 'input');
          A.ok(/10%/.test(getComputedStyle(sup).clipPath), 'glisser le rideau révèle plus du témoin : ' + getComputedStyle(sup).clipPath);
          capture('comparaison au rideau');
          saisir(debut.querySelector('.hist-diapo-mode'), 'clignotement', 'change');
          var vus = {};
          await attendre(function () { vus[sup.style.visibility] = true; return vus.hidden && vus.visible; }, 4000, 'clignotement');
          A.ok(vus.hidden && vus.visible, 'le témoin clignote');
          cliquer(debut.querySelector('.hist-diapo-comparer'));
          A.notOk(visible(sup), 'quitter la comparaison retire la superposition');

          // 052 : épingler
          touche(debut, 'ArrowLeft');                                // p2 : début = iB, inscrit
          var epingler = debut.querySelector('.hist-diapo-epingler');
          A.equal(epingler.disabled, false, 'une capture inscrite peut être épinglée');
          cliquer(epingler);
          await attendre(function () { return dernier(appels, '/tests/registre/temoin'); }, 4000, 'requête d\'épinglage');
          var post = dernier(appels, '/tests/registre/temoin');
          A.equal(post.init.method, 'POST', 'en POST');
          var corps = JSON.parse(post.init.body);
          A.equal(corps.test, 'e2e › banc diaporama', 'ce test, identifié par sa clé complète');
          A.equal(corps.image, iB, 'cette image');
          A.equal(corps.commit, passages[1].commit, 'de ce run');
          A.equal(corps.cle_image, 'debut|début', 'pour cette image-là');
          await attendre(function () { return debut.getAttribute('data-temoin') === 'epingle'; }, 4000, 'témoin marqué épinglé');

          // fermeture
          cliquer(debut.querySelector('.hist-diapo-fermer'));
          A.equal(tous('.hist-diapo', panneau).length, 1, 'chaque diaporama se ferme seul');
          cliquer(milieu.querySelector('.hist-diapo-fermer'));
          await attendre(function () { return !visible(document.getElementById('hist-diapos')); }, 3000, 'zone refermée');
        });
      } finally { remiseAZero(); }
    });

  // ══════════════════════════════════════════════════════════════════════════
  // Inscription au registre
  // ══════════════════════════════════════════════════════════════════════════
  e2e('SPEC-BANC-053/054/055/056 : le résumé de fin de campagne propose « Inscrire au registre » ; le clic inscrit avec le motif, le bouton devient « Inscrit ✓ » et le second clic est refusé',
    { teste: 'le bouton « Inscrire au registre » du résumé de fin de campagne : présence à côté du lien du cahier, requête POST avec le cahier et le motif, retour visible, lien vers l\'historique filtré, refus d\'une seconde inscription',
      pourquoi: 'c\'est le geste par lequel un testeur promeut un run manuel dans le registre versionné ; sans l\'éprouver dans la vraie page, un câblage cassé laisserait le bouton muet',
      attendu: 'le résumé affiche le bouton après le lien du cahier ; le clic envoie { dossier, motif } à POST /tests/registre/inscrire ; le libellé devient « Inscrit ✓ » avec un lien vers l\'historique filtré sur ce run ; un second clic affiche le refus du serveur et ne change rien' },
    async function () {
      var B = G.MC_BANC, H = G.MC_HISTORIQUE;
      A.ok(B && B.afficherLienRapport, 'le banc expose l\'affichage du lien du rapport');
      var essais = 0;
      var dossier = '2026-01-01_00-00-00_e2e-banc-factice';
      var hote = document.createElement('div');
      hote.id = 'hote-e2e-inscription';
      document.body.appendChild(hote);
      try {
        await avecFetchFactice(function (u, init) {
          if (u.indexOf('/tests/registre/inscrire') === 0) {
            essais++;
            return essais === 1 ? { ok: true, code: 200, run: 'run-inscrit-1', commit: new Array(41).join('c'), arbre_modifie: false, motif: 'référence avant refonte de l\'eau' }
              : { __statut: 409, __corps: { ok: false, motif: 'ce cahier est déjà inscrit au registre — une seule inscription par cahier' } };
          }
          if (u.indexOf('/tests/historique/lignes?') === 0) return { lignes: [ligne({ run: 'run-inscrit-1', origine: 'manuel', motif: 'référence avant refonte de l\'eau' })], total: 1, page: 1, taille: 50, effectifs: {} };
        }, async function (appels) {
          B.afficherLienRapport('/tests/resultats/' + dossier + '/rapport.html');
          // le résumé de la campagne en cours se réécrit toutes les 500 ms : on met notre bloc à l'abri
          var bloc = Array.prototype.slice.call(B.refs.resume.children).filter(function (n) { return n.querySelector && n.querySelector('.hist-inscrire'); }).pop();
          A.ok(bloc, 'le résumé contient le bloc du cahier avec le bouton d\'inscription');
          hote.appendChild(bloc);
          var lien = bloc.querySelector('a[href$="rapport.html"]');
          var btn = bloc.querySelector('.hist-inscrire-btn');
          A.ok(lien && btn, 'lien du cahier et bouton dans le même bloc');
          A.ok(lien.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING, 'le bouton suit le lien du cahier');
          A.equal(btn.textContent, 'Inscrire au registre', 'libellé');
          A.equal(appels.filter(function (a) { return a.url.indexOf('/tests/registre/inscrire') === 0; }).length, 0, 'rien n\'est envoyé avant le clic');
          // 055 : motif
          saisir(bloc.querySelector('.hist-inscrire-motif'), 'référence avant refonte de l\'eau');
          cliquer(btn);
          await attendre(function () { return btn.textContent === 'Inscrit ✓'; }, 4000, 'bouton « Inscrit ✓ »');
          var post = dernier(appels, '/tests/registre/inscrire');
          A.equal(post.init.method, 'POST', '054 : en POST');
          egal(JSON.parse(post.init.body), { dossier: dossier, motif: 'référence avant refonte de l\'eau' }, '054/055 : le cahier et le motif');
          var voir = bloc.querySelector('.hist-inscrire-lien');
          A.ok(voir, '056 : un lien vers l\'historique apparaît');
          capture('bouton devenu Inscrit');
          cliquer(voir);
          await attendre(function () { return visible(zone()) && /référence avant refonte/.test(zone().querySelector('#hist-table tbody').textContent); }, 6000, 'historique filtré sur le run');
          A.equal(H.etat.filtresColonnes.run, 'run-inscrit-1', 'filtré sur le run inscrit');
          A.ok(/référence avant refonte de l'eau/.test(zone().querySelector('#hist-table tbody').textContent), '055 : le motif est dans la colonne motif de cette ligne');
          // 056 : seconde inscription refusée
          H.fermer();
          cliquer(btn);
          await attendre(function () { return /déjà inscrit/.test(bloc.querySelector('.hist-inscrire-msg').textContent); }, 4000, 'refus affiché');
          A.equal(btn.textContent, 'Inscrit ✓', 'le bouton reste « Inscrit ✓ »');
          A.equal(bloc.querySelectorAll('.hist-inscrire-lien').length, 1, 'sans second lien');
          A.equal(essais, 2, 'le serveur a été interrogé deux fois, la seconde fut refusée');
        });
      } finally { hote.remove(); remiseAZero(); }
    });
  function ahora() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
  function attendreBanc(fn, delaiMs, quoi) {
    var t0 = ahora();
    function boucle() {
      var v = fn();
      if (v) return Promise.resolve(v);
      if (ahora() - t0 > (delaiMs || 8000)) return Promise.reject(new Error('condition non atteinte à temps : ' + (quoi || '')));
      return wait(60).then(boucle);
    }
    return boucle();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Historique global : répartition et sélection regroupée (SPEC-BANC-064/065)
  // ══════════════════════════════════════════════════════════════════════════
  e2e('SPEC-BANC-064 : le panneau Répartition de l\'historique affiche tableau et barres par dimension et un clic sur une barre filtre le tableau',
    { teste: 'le panneau « Répartition » de la zone Historique, dans la vraie page du banc, contre la vraie route /tests/historique/repartition',
      pourquoi: 'les tests Node vérifient le calcul (tools/repartition.js) et le câblage sur un faux DOM ; seule la vraie page prouve que le bouton, la route du serveur et le clic sur une barre fonctionnent ensemble',
      attendu: 'le bouton Répartition ouvre le panneau ; chaque dimension affiche un tableau (tests, réussis, échecs, ignorés, avertissements, durée cumulée) et des barres ; cliquer la barre d\'une valeur filtre le tableau principal sur cette valeur' },
    async function () {
      var H = G.MC_HISTORIQUE;
      A.ok(H, 'window.MC_HISTORIQUE présent');
      var zone = document.getElementById('zone-historique');
      var panneau = document.getElementById('hist-repartition');
      A.ok(panneau && panneau.hidden, 'le panneau Répartition existe et est fermé par défaut');
      document.getElementById('btn-historique').click();
      zone.querySelector('[data-rapide="tous"]').click();
      await attendreBanc(function () { return /ligne\(s\)/.test(zone.querySelector('#hist-page-info').textContent) && H.etat.total > 0; }, 10000, 'lignes de l\'historique');
      try {
        document.getElementById('hist-repartition-btn').click();
        A.equal(panneau.hidden, false, 'le bouton Répartition ouvre le panneau');
        await attendreBanc(function () { return panneau.querySelector('table.hist-rep-table tbody tr'); }, 10000, 'tableau de répartition');
        var sel = document.getElementById('hist-rep-dimension');
        var dims = Array.prototype.map.call(sel.options, function (o) { return o.value; });
        A.equal(dims.join(','), 'categorie,domaine,spec,fonction,etiquette,raison', 'les six dimensions sont proposées');
        var entetes = Array.prototype.map.call(panneau.querySelectorAll('thead th'), function (t) { return t.textContent; }).join('|');
        A.ok(/Tests/.test(entetes) && /Réussis/.test(entetes) && /Échecs/.test(entetes) && /Ignorés/.test(entetes) && /Avertissements/.test(entetes) && /Durée cumulée/.test(entetes), 'colonnes du tableau : ' + entetes);
        // dimension « catégorie » : plusieurs barres, les comptes sont cohérents avec la vue
        sel.value = 'categorie';
        sel.dispatchEvent(new Event('change'));
        await attendreBanc(function () { return /unitaire|spec|e2e|integration|fonctionnel/.test(panneau.textContent) && panneau.querySelector('button.hist-rep-barre'); }, 10000, 'répartition par catégorie');
        var lignesTab = Array.prototype.slice.call(panneau.querySelectorAll('tbody tr'));
        var somme = 0;
        lignesTab.forEach(function (tr) {
          var c = tr.children;
          var nb = parseInt(c[1].textContent, 10);
          var parts = parseInt(c[2].textContent, 10) + parseInt(c[3].textContent, 10) + parseInt(c[4].textContent, 10) + parseInt(c[5].textContent, 10);
          A.equal(parts, nb, 'réussis + échecs + ignorés + avertissements = nombre de tests (' + c[0].textContent + ')');
          somme += nb;
        });
        A.equal(somme, H.etat.total, 'la catégorie est mono-valeur : la somme des groupes égale le nombre de lignes de la vue');
        // clic sur la première barre : le tableau principal est filtré sur cette catégorie
        var barre = panneau.querySelector('button.hist-rep-barre');
        var valeur = barre.getAttribute('data-valeur');
        A.ok(valeur, 'la barre porte sa valeur');
        var nbBarre = parseInt(barre.closest('tr').children[1].textContent, 10);
        barre.click();
        await attendreBanc(function () { return H.etat.total === nbBarre; }, 10000, 'tableau filtré sur ' + valeur);
        egal(H.etat.filtresColonnes.type, [valeur], 'le filtre de la colonne type est posé sur ' + valeur);
        var lignesVue = Array.prototype.slice.call(zone.querySelectorAll('#hist-table tbody tr'));
        A.gt(lignesVue.length, 0, 'le tableau principal montre des lignes');
        // la répartition suit la vue filtrée : une seule catégorie reste
        await attendreBanc(function () { return panneau.querySelectorAll('tbody tr').length === 1; }, 10000, 'répartition suivant la vue filtrée');
      } finally {
        H.etat.filtresColonnes = {};
        H.etat.cleFiltres = null;
        H.repartition(false);
        document.getElementById('hist-rapide-inscrits').checked = true;
        document.getElementById('hist-rapide-inscrits').dispatchEvent(new Event('change'));
        document.getElementById('hist-fermer').click();
      }
      A.equal(zone.hidden, true, 'zone refermée');
    });

  e2e('SPEC-BANC-065 : la sélection du banc se regroupe par fonction et cocher une fonction sélectionne les tests qui la déclarent ou l\'ont observée',
    { teste: 'le regroupement de la zone de sélection (catégorie, domaine, spec, fonction, étiquette) dans la vraie page',
      pourquoi: 'lancer « tous les tests qui touchent MC.Mesher.tileOrigin » suppose que le groupe de fonction reflète la déclaration ET la carte d\'impact servie par le banc, ce que seule la page réelle contre le vrai serveur prouve',
      attendu: 'regrouper par fonction puis cocher MC.Mesher.tileOrigin coche exactement les tests qui la déclarent ou figurent dans la carte d\'impact pour elle' },
    async function () {
      var B = G.MC_BANC;
      if (!B) return;      // hors du banc
      var etat = B.etat;
      var avant = etat.cochees;
      var ancienRegroupement = etat.regroupement;
      etat.cochees = Object.create(null);
      try {
        var selecteur = document.getElementById('regrouper');
        A.ok(selecteur, 'sélecteur « Regrouper par » présent');
        var options = Array.prototype.map.call(selecteur.options, function (o) { return o.value; });
        A.equal(options.join(','), ',categorie,domaine,spec,fonction,etiquette', 'les cinq regroupements, plus la vue par défaut');
        B.refs.panneauSel.hidden = false;
        await B.completer();
        // les fonctions observées viennent de la carte d'impact, servie par le banc
        var carte = await (await fetch('/tests/historique/fonctions')).json();
        A.ok(carte.ok && carte.fonctions, 'la route des fonctions observées répond');
        var observees = carte.fonctions['MC.Mesher.tileOrigin'] || [];
        A.gt(observees.length, 0, 'la carte d\'impact connaît des tests qui observent MC.Mesher.tileOrigin');
        selecteur.value = 'fonction';
        selecteur.dispatchEvent(new Event('change'));
        var groupe = await attendreBanc(function () {
          return B.refs.arbre.querySelector('details[data-groupe="MC.Mesher.tileOrigin"]');
        }, 10000, 'groupe MC.Mesher.tileOrigin');
        var titre = groupe.querySelector('summary label').textContent;
        A.ok(/MC\.Mesher\.tileOrigin \(\d+\)/.test(titre), 'le groupe affiche son effectif : ' + titre);
        // attendu, calculé indépendamment du groupe : déclarés ∪ observés, parmi les tests lançables ici
        var attendu = {};
        etat.catalogue.forEach(function (t) {
          if (t.horsNavigateur) return;
          if ((t.fonctions || []).indexOf('MC.Mesher.tileOrigin') >= 0 || observees.indexOf(t.cle) >= 0) attendu[t.cle] = true;
        });
        A.gt(Object.keys(attendu).length, 0, 'au moins un test lançable la touche');
        groupe.querySelector('summary input').click();
        var coches = Object.keys(etat.cochees).sort();
        egal(coches, Object.keys(attendu).sort(), 'exactement les tests qui déclarent ou ont observé la fonction');
        A.ok(/\(\d+\)/.test(titre) && parseInt(/\((\d+)\)/.exec(titre)[1], 10) >= coches.length, 'l\'effectif du groupe couvre ces tests');
        // un test présent sous plusieurs fonctions y reste synchronisé
        var cases = B.refs.arbre.querySelectorAll('input[data-cle]');
        Array.prototype.forEach.call(cases, function (c) {
          if (attendu[c.getAttribute('data-cle')]) A.ok(c.checked, 'case cochée : ' + c.getAttribute('data-cle'));
        });
        // les autres regroupements se construisent aussi
        ['categorie', 'domaine', 'spec', 'etiquette'].forEach(function (dim) {
          selecteur.value = dim;
          selecteur.dispatchEvent(new Event('change'));
          A.gt(B.refs.arbre.querySelectorAll('details[data-groupe]').length, 0, 'groupes par ' + dim);
        });
      } finally {
        etat.cochees = avant;
        document.getElementById('regrouper').value = ancienRegroupement || '';
        await B.changerRegroupement(ancienRegroupement || '');
        B.refermerSelection();
      }
    });
  // ══════════════════════════════════════════════════════════════════════════
  // Rendu reproductible et mouvements scriptés (SPEC-BANC-082/084)
  // ══════════════════════════════════════════════════════════════════════════
  var R = G.MC_REPRO;
  var frames = API.frames;
  function outilsScene() { return { frames: frames, resolution: G.MC_BANC && G.MC_BANC.reglerResolution }; }
  /* Les pixels du canvas de rendu, tels que le jeu les a dessinés (pleine résolution). */
  function lirePixels(g) {
    g.render.render();
    var cv = g.render.renderer.domElement;
    var c = document.createElement('canvas');
    c.width = cv.width; c.height = cv.height;
    var x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(cv, 0, 0);
    return x.getImageData(0, 0, c.width, c.height).data;
  }
  /* Une « exécution » complète du même test visuel : scène fixée, N images, capture, scène libérée. */
  async function executionVisuelle(g, scene, nbImages) {
    var etat = await R.fixer(g, scene || {}, outilsScene());
    try {
      await etat.images(nbImages || 20);
      return { pixels: lirePixels(g), decrit: etat.decrit, instant: g.time };
    } finally { etat.restaurer(); }
  }

  e2e('SPEC-BANC-084 : un test étiqueté rendu démarre sur une scène fixée (graine, heure, météo, caméra, résolution, horloge déterministe)',
    { teste: 'les paramètres que le moteur fixe avant le corps d\'un test visuel (étiqueté rendu)',
      pourquoi: 'sans graine, heure, météo, caméra, résolution et horloge fixes, deux captures du même test ne sont pas comparables : on ne saurait pas si un écart vient du code ou de la scène',
      attendu: 'le monde a la graine fixée, l\'instant est celui d\'un ciel clair à midi, la caméra est à la pose demandée, la surface est d\'au moins 800×600 et performance.now suit une horloge virtuelle qui avance de 1/60 s par image',
      etiquettes: ['rendu'] },
    async function (g) {
      var sc = R.SCENE_DEFAUT;
      A.equal(g.world.seed, sc.graine, 'graine fixée');
      var DC = MC.DayCycle;
      var heure = ((g.time % DC.DAY_LENGTH) / DC.DAY_LENGTH) * 24;
      A.close(heure, sc.heure, 0.5, 'heure du jeu fixée à midi (obtenu ' + heure.toFixed(3) + ' h)');
      A.equal(g.world.meteo.etat(g.time).type, sc.meteo, 'météo fixée : ' + sc.meteo);
      var cv = g.render.renderer.domElement;
      A.ok(cv.width >= 800 && cv.height >= 600, 'résolution jamais sous 800×600 : ' + cv.width + '×' + cv.height);
      A.close(g.player.state.yaw, sc.yaw, 1e-9, 'orientation (lacet) fixée');
      A.close(g.player.state.pitch, sc.pitch, 1e-9, 'orientation (tangage) fixée');
      // l'horloge est virtuelle : un multiple exact de la durée d'une image, qui avance d'une image à la fois
      var t0 = performance.now();
      var n0 = (t0 - R.ORIGINE_HORLOGE_MS) / R.DT_MS;
      A.close(n0, Math.round(n0), 1e-6, 'performance.now est une horloge virtuelle (origine + n × ' + R.DT_MS.toFixed(3) + ' ms)');
      await R.attendreImages(5);
      var n1 = (performance.now() - t0) / R.DT_MS;
      A.ok(Math.abs(n1 - Math.round(n1)) < 1e-6 && Math.round(n1) >= 5, 'cinq images du jeu avancent l\'horloge d\'au moins cinq images virtuelles (' + n1.toFixed(3) + ')');
    });

  e2e('SPEC-BANC-084 : deux exécutions successives du même test visuel produisent des captures pixel-identiques',
    { teste: 'la reproductibilité du rendu : la même scène fixée, rejouée deux fois sur la même machine',
      pourquoi: 'une comparaison de captures n\'a de sens que si deux exécutions identiques donnent la même image ; sinon tout écart serait du bruit de scène (eau, nuages, particules, charge de la machine)',
      attendu: 'deux exécutions complètes (scène fixée, 20 images, capture) donnent des images de 800×600 au moins, identiques pixel pour pixel, ou dans la tolérance négligeable documentée' },
    async function (g) {
      var scene = { yaw: 0.6, pitch: -0.1 };
      var a = await executionVisuelle(g, scene);
      var b = await executionVisuelle(g, scene);
      A.equal(a.decrit.graine, b.decrit.graine, 'même graine');
      A.equal(a.instant, b.instant, 'même instant du monde');
      A.equal(a.pixels.length, b.pixels.length, 'même taille d\'image');
      A.ok(a.decrit.resolution[0] >= 800 && a.decrit.resolution[1] >= 600, 'résolution ' + a.decrit.resolution.join('×'));
      var cmp = R.comparer(a.pixels, b.pixels);
      A.ok(R.negligeable(cmp), 'captures identiques : ' + cmp.pixelsDifferents + ' pixel(s) différent(s) sur ' + cmp.pixels + ', écart moyen ' + cmp.moyen.toFixed(4) + ', maximal ' + cmp.max.toFixed(1));
      // ce que la comparaison peut voir : la scène fixée n'est pas une image vide, et une autre caméra donne une autre image
      var autre = await executionVisuelle(g, { yaw: 2.4, pitch: 0.3 });
      var cmp2 = R.comparer(a.pixels, autre.pixels);
      A.gt(cmp2.pixelsDifferents, 100, 'une autre orientation de caméra donne bien une autre image (' + cmp2.pixelsDifferents + ' pixels)');
    });

  e2e('SPEC-BANC-082 : une étape en mouvement tourne ou déplace la caméra à une vitesse fixe, documentée et reproductible',
    { teste: 'les mouvements scriptés d\'une étape (T.etape avec mouvement) : rotation à 30 degrés par seconde et déplacement à 4 blocs par seconde',
      pourquoi: 'un tremblement en mouvement ne se juge que si la caméra bouge de la même façon à chaque run ; une caméra immobile, elle, ne montre que scintillements et artefacts',
      attendu: 'le triplet d\'une étape en rotation avance le lacet de 0,5 degré par image, celui d\'un déplacement de 1/15 de bloc par image, les vitesses sont consignées avec leur unité, et deux exécutions donnent mêmes poses et mêmes images' },
    async function (g) {
      async function seance(mouvement) {
        var etat = await R.fixer(g, {}, outilsScene());
        try { return await API.capturerTriplet(g, 'mouvement', 'debut', mouvement); } finally { etat.restaurer(); }
      }
      function angle(p, q) {
        var d = Math.abs(p.qx * q.qx + p.qy * q.qy + p.qz * q.qz + p.qw * q.qw);
        return 2 * Math.acos(Math.min(1, d));
      }
      // ── rotation : 30 deg/s à 60 images/s virtuelles = 0,5 degré par image
      var r1 = await seance({ type: 'rotation' });
      A.equal(r1.captures.length, 3, 'un triplet : trois images consécutives');
      egal(r1.mouvement, { type: 'rotation', vitesse: 30, unite: 'deg/s', dt_ms: R.DT_MS }, 'vitesse et unité consignées');
      for (var i = 1; i < 3; i++) {
        var pas = angle(r1.captures[i - 1].pose.camera, r1.captures[i].pose.camera) * 180 / Math.PI;
        A.close(pas, 0.5, 0.01, 'rotation de la caméra entre les images ' + (i - 1) + ' et ' + i + ' : ' + pas.toFixed(4) + ' degré');
      }
      // reproductible : les mêmes poses et les mêmes images d'un run à l'autre
      var r2 = await seance({ type: 'rotation' });
      for (var k = 0; k < 3; k++) {
        egal(r1.captures[k].pose.camera, r2.captures[k].pose.camera, 'pose de la caméra identique, image ' + k);
        A.ok(r1.captures[k].base64 === r2.captures[k].base64, 'image ' + k + ' identique d\'un run à l\'autre');
      }
      // ── déplacement : 4 blocs/s = 1/15 de bloc par image
      var d1 = await seance({ type: 'deplacement' });
      for (var j = 1; j < 3; j++) {
        var a = d1.captures[j - 1].pose.camera, b = d1.captures[j].pose.camera;
        var dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        A.close(dist, 4 / 60, 0.002, 'déplacement entre les images ' + (j - 1) + ' et ' + j + ' : ' + dist.toFixed(4) + ' bloc');
      }
      egal(d1.mouvement.unite, 'blocs/s', 'unité du déplacement');
      var d2 = await seance({ type: 'deplacement' });
      egal(d1.captures[2].pose.camera, d2.captures[2].pose.camera, 'déplacement reproductible');
      // une vitesse choisie est consignée telle quelle ; un mouvement inconnu est refusé
      var vite = await seance({ type: 'rotation', vitesse: 60 });
      A.equal(vite.mouvement.vitesse, 60, 'vitesse choisie consignée');
      var refuse = false;
      try { R.pasMouvement({ type: 'secousse' }, 0); } catch (e) { refuse = true; }
      A.ok(refuse, 'un mouvement inconnu est refusé');
      // sans mouvement, la caméra reste immobile : les écarts de pose du triplet sont nuls
      var etat = await R.fixer(g, {}, outilsScene());
      try {
        var fixe = await API.capturerTriplet(g, 'immobile', 'debut', null);
        A.equal(fixe.instabilite.pose, 0, 'caméra immobile : aucun écart de pose');
        A.equal(fixe.mouvement, null, 'pas de mouvement consigné');
      } finally { etat.restaurer(); }
    });
  // ══════════════════════════════════════════════════════════════════════════
  // Triplets en boucle dans l'historique (SPEC-BANC-080)
  // ══════════════════════════════════════════════════════════════════════════
  e2e('SPEC-BANC-080 : la vignette d\'un triplet d\'étape lit ses trois images en boucle (clignotement) dans la vraie page',
    { teste: 'la lecture en boucle d\'un triplet (étape, début ou fin, rangs 0 à 2) par la vignette de l\'historique, avec de vrais minuteurs',
      pourquoi: 'le clignotement image par image est le mode le plus sensible à l\'œil pour un scintillement ; les tests Node vérifient la logique avec des minuteurs simulés, seule la page prouve que la boucle tourne',
      attendu: 'la vignette passe successivement par les images de rang 0, 1, 2 puis revient au rang 0, sans intervention, et s\'arrête quand on la libère' },
    async function () {
      var H = G.MC_HISTORIQUE;
      A.ok(H && H.clignotement, 'MC_HISTORIQUE.clignotement exposé');
      function couleur(c) {
        var cv = document.createElement('canvas'); cv.width = 4; cv.height = 4;
        var x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 4, 4);
        return cv.toDataURL('image/png');
      }
      var sources = [couleur('#ff0000'), couleur('#00ff00'), couleur('#0000ff')];
      var groupes = H.grouperTriplets([
        { role: 'triplet', etape: 'marche', bord: 'debut', rang: 2 }, { role: 'triplet', etape: 'marche', bord: 'debut', rang: 0 },
        { role: 'triplet', etape: 'marche', bord: 'debut', rang: 1 }, { role: 'fin', libelle: 'fin' },
      ]);
      A.equal(groupes.triplets.length, 1, 'un triplet par (étape, bord)');
      egal(groupes.triplets[0].images.map(function (c) { return c.rang; }), [0, 1, 2], 'images rangées par rang');
      var img = H.clignotement(sources, 'triplet marche (début)');
      document.body.appendChild(img);
      try {
        A.equal(img.getAttribute('data-boucle'), '3', 'trois images en boucle');
        A.equal(img.getAttribute('src'), sources[0], 'commence au rang 0');
        // on observe le rang affiché jusqu'à avoir vu un tour complet, plus le retour au rang 0
        var vus = [Number(img.getAttribute('data-rang'))];
        await attendre(function () {
          var r = Number(img.getAttribute('data-rang'));
          if (r !== vus[vus.length - 1]) vus.push(r);
          return vus.length >= 5;
        }, 8000, 'un tour complet de la boucle');
        egal(vus.slice(0, 5), [0, 1, 2, 0, 1], 'rang 0, 1, 2, puis retour au rang 0 : image par image, en boucle');
        A.equal(img.getAttribute('src'), sources[Number(img.getAttribute('data-rang'))], 'l\'image affichée est celle du rang courant');
      } finally {
        H.arreterBoucles();
        img.remove();
      }
      // arrêtée : le rang ne bouge plus
      var fige = img.getAttribute('data-rang');
      await wait(3 * H.CADENCE_CLIGNOTEMENT_MS);
      A.equal(img.getAttribute('data-rang'), fige, 'plus aucun changement une fois les boucles arrêtées');
    });
})(typeof globalThis !== 'undefined' ? globalThis : this);
