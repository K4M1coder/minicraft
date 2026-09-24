/* banc-ui.js — interface du banc de test (SPEC-BANC-007 à 017), au-dessus
   du noyau de test (tests/harness.js, tests/catalogue.js, tests/presets.js,
   tests/rapport.js, tests/e2e.js). `MC_TESTS` (tests/catalogue.js) fournit
   le catalogue et la sélection, `G.T` (tests/harness.js) exécute les tests
   unitaires/fonctionnels/spec, `G.E2E_LISTE`/`G.runCampagneE2E` (tests/e2e.js)
   les end-to-end — voir plus bas `executerUnitaires`/`executerE2E`. */
(function (G) {
  'use strict';

  function dernierEchecs() {
    try {
      var b = JSON.parse(localStorage.getItem('mc-banc-derniers-echecs') || '[]');
      return Array.isArray(b) ? b : [];
    } catch (e) { return []; }
  }
  function memoriserEchecs(idsEchecs) {
    try { localStorage.setItem('mc-banc-derniers-echecs', JSON.stringify(idsEchecs)); } catch (e) { /* rien */ }
  }
  // `MC_TESTS.selection` (tests/catalogue.js) ne sait rien de « échecs » de
  // la dernière campagne du navigateur (mémorisés côté client, localStorage) :
  // on le résout ici et on le passe en `tests`/`liste` explicite.
  G.MC_TESTS.memoriserEchecs = memoriserEchecs;
  G.MC_TESTS.dernierEchecs = dernierEchecs;

  // ══════════════════════════════════════════════════════════════════════
  // Utilitaires
  // ══════════════════════════════════════════════════════════════════════
  function el(tag, attrs, enfants) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (enfants || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function duree(ms) {
    if (ms < 1000) return Math.round(ms) + ' ms';
    var s = ms / 1000;
    if (s < 60) return s.toFixed(1) + ' s';
    return Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s';
  }
  function echappe(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function attendre0() { return new Promise(function (r) { setTimeout(r, 0); }); }

  // ══════════════════════════════════════════════════════════════════════
  // Adresse ↔ sélection (SPEC-BANC-007)
  // ══════════════════════════════════════════════════════════════════════
  function critereDepuisURL() {
    var p = new URLSearchParams(location.search);
    var c = {};
    if (p.has('preset')) c.preset = p.get('preset');
    ['domaine', 'type', 'groupe', 'test'].forEach(function (cle) {
      if (p.has(cle)) c[cle] = p.get(cle).split(',').filter(Boolean);
    });
    return c;
  }
  function urlDepuisCriteres(c) {
    var p = new URLSearchParams();
    if (c.preset) p.set('preset', c.preset);
    if (c.domaines && c.domaines.length) p.set('domaine', c.domaines.join(','));
    if (c.types && c.types.length) p.set('type', c.types.join(','));
    if (c.groupes && c.groupes.length) p.set('groupe', c.groupes.join(','));
    if (c.tests && c.tests.length) p.set('test', c.tests.join(','));
    var q = p.toString();
    history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
  }

  // ══════════════════════════════════════════════════════════════════════
  // Application
  // ══════════════════════════════════════════════════════════════════════
  function demarrer() {
    var host = document.getElementById('host');

    // ── surface virtuelle (SPEC-BANC-017) ───────────────────────────────────
    /* Le jeu intégré tourne à une résolution FIXE et réaliste (jamais celle,
       minuscule, du quart qui l'affiche) : `host` (donc le rendu ET l'échelle
       d'interface, via `g.tailleVue()`) lit la taille de `#surface-virtuelle`,
       posée ici en pixels ; seule sa présentation est réduite, par
       `transform: scale()`, pour tenir dans son conteneur. Posée AVANT
       `MC.createGame` : le renderer doit lire une taille non nulle dès sa
       création, pas seulement au premier redimensionnement. */
    var surface = document.getElementById('surface-virtuelle');
    var quartBas = document.getElementById('quart-bas');
    var surfaceAgrandie = document.getElementById('surface-agrandie');
    var refRes = { l: 1280, h: 800 };
    var estAgrandi = false;
    function ajusterSurface() {
      var conteneur = estAgrandi ? surfaceAgrandie : quartBas;
      surface.style.width = refRes.l + 'px';
      surface.style.height = refRes.h + 'px';
      var cw = conteneur.clientWidth || refRes.l, ch = conteneur.clientHeight || refRes.h;
      var echelle = Math.max(0.05, Math.min(cw / refRes.l, ch / refRes.h));
      surface.style.transform = 'scale(' + echelle + ')';
      surface.style.left = Math.round((cw - refRes.l * echelle) / 2) + 'px';
      surface.style.top = Math.round((ch - refRes.h * echelle) / 2) + 'px';
    }
    function reglerResolutionVue(l, h) {
      // 800×600 : plus bas, menus et HUD ne sont plus lisibles (règle du jeu).
      refRes = { l: Math.max(800, l), h: Math.max(600, h) };
      ajusterSurface();
      // la résolution de référence change vraiment (contrairement au simple
      // agrandissement) : le rendu et l'échelle d'interface doivent suivre.
      window.dispatchEvent(new Event('resize'));
    }
    function basculerAgrandirSurface() {
      estAgrandi = !estAgrandi;
      if (estAgrandi) { surfaceAgrandie.hidden = false; surfaceAgrandie.appendChild(surface); }
      else { surfaceAgrandie.hidden = true; quartBas.insertBefore(surface, quartBas.firstChild); }
      ajusterSurface();
      return estAgrandi;
    }
    ajusterSurface();
    window.addEventListener('resize', ajusterSurface);

    var game = MC.createGame(host);
    window.GAME = game;
    var debug = MC.Debug.creer(game);
    window.MC_DEBUG = debug;

    var refs = {
      liste: document.getElementById('liste-tests'),
      resume: document.getElementById('resume'),
      lents: document.querySelector('#lents .items'),
      erreurs: document.querySelector('#erreurs .items'),
      seuilLent: document.getElementById('seuil-lent'),
      arbre: document.getElementById('arbre'),
      recherche: document.getElementById('recherche'),
      presets: document.getElementById('presets'),
      compteur: document.getElementById('compteur'),
      btnLancer: document.getElementById('btn-lancer'),
      btnEchecs: document.getElementById('btn-echecs'),
      btnTout: document.getElementById('btn-tout'),
      btnArreter: document.getElementById('btn-arreter'),
      btnMenu: document.getElementById('btn-menu'),
      panneauSel: document.getElementById('panneau-selection'),
      panneauDebug: document.getElementById('panneau-debug'),
    };

    var etat = {
      catalogue: [],
      cochees: Object.create(null),   // id -> true
      lignesParId: Object.create(null),
      resultats: [],                   // résultats accumulés de la campagne en cours
      enCours: false,
      arretDemande: false,
      debutCampagne: 0,
      seuilLentMs: 8000,
      suit: true,                      // le défilement suit le dernier test
      campagneMeta: null,
    };

    // ── panneau MC_DEBUG (manuel) ──────────────────────────────────────────
    function construirePanneauDebug() {
      refs.panneauDebug.innerHTML = '';
      var replie = true;
      var corps = el('div', { class: 'debug-corps', style: 'display:none' });
      var entete = el('div', { class: 'debug-entete', onclick: function () {
        replie = !replie;
        corps.style.display = replie ? 'none' : 'block';
        refs.panneauDebug.classList.toggle('ouvert', !replie);
      } }, ['MC_DEBUG ▾']);
      function champ(label, placeholder, onValider) {
        var input = el('input', { placeholder: placeholder });
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') onValider(input.value); });
        var bouton = el('button', { onclick: function () { onValider(input.value); } }, ['OK']);
        return el('div', { class: 'debug-ligne' }, [el('span', {}, [label]), input, bouton]);
      }
      corps.appendChild(champ('Téléporter x,y,z', 'ex: 10,64,-3', function (v) {
        var n = v.split(',').map(Number);
        if (n.length >= 2) debug.teleporter(n[0], n[1], n[2]);
      }));
      corps.appendChild(champ('Heure (0-24)', 'ex: 18', function (v) { debug.heure(Number(v)); }));
      corps.appendChild(champ('Saison', 'printemps/ete/automne/hiver', function (v) { debug.saison(v); }));
      corps.appendChild(champ('Météo', 'nom du temps', function (v) { debug.meteo(v); }));
      corps.appendChild(champ('Distance de vue', 'en chunks', function (v) { debug.distanceVue(Number(v)); }));
      var selRes = el('select', {});
      // 800×600 est la taille minimale lisible (menus et HUD) : jamais plus bas.
      [[800, 600], [1280, 800], [1600, 900], [1920, 1080]].forEach(function (r) {
        selRes.appendChild(el('option', { value: r[0] + 'x' + r[1] }, [r[0] + '×' + r[1]]));
      });
      selRes.value = refRes.l + 'x' + refRes.h;
      selRes.addEventListener('change', function () {
        var p = selRes.value.split('x').map(Number);
        reglerResolutionVue(p[0], p[1]);
      });
      corps.appendChild(el('div', { class: 'debug-ligne' }, [el('span', {}, ['Résolution du jeu']), selRes]));
      var ligneBoutons = el('div', { class: 'debug-ligne' }, [
        // agrandit la SURFACE virtuelle en plein panneau droit, toujours à
        // l'échelle, toujours à la même résolution de référence (SPEC-BANC-017)
        el('button', { onclick: function () { basculerAgrandirSurface(); } }, ['Agrandir / réduire']),
        el('button', { onclick: function () {
          var img = debug.capture();
          var a = document.createElement('a');
          a.href = img; a.download = 'capture-' + Date.now() + '.jpg'; a.click();
        } }, ['Capturer']),
      ]);
      corps.appendChild(ligneBoutons);
      refs.panneauDebug.appendChild(entete);
      refs.panneauDebug.appendChild(corps);
    }
    construirePanneauDebug();

    // ── catalogue et menu de sélection (SPEC-BANC-007) ─────────────────────
    function construireArbre() {
      var parType = Object.create(null);
      etat.catalogue.forEach(function (t) {
        parType[t.type] = parType[t.type] || Object.create(null);
        var domaines = t.domaines.length ? t.domaines : ['—'];
        domaines.forEach(function (d) {
          parType[t.type][d] = parType[t.type][d] || Object.create(null);
          parType[t.type][d][t.groupe] = parType[t.type][d][t.groupe] || [];
          parType[t.type][d][t.groupe].push(t);
        });
      });
      refs.arbre.innerHTML = '';
      Object.keys(parType).sort().forEach(function (type) {
        var casesType = [];
        var ulType = el('ul', { class: 'niveau-domaine' });
        var detailsType = el('details', {}, [
          el('summary', {}, [caseACocher(function (v) { basculerGroupe(casesType, v); }, casesType, type + ' (' + compteType(parType[type]) + ')')]),
          ulType,
        ]);
        Object.keys(parType[type]).sort().forEach(function (dom) {
          var casesDom = [];
          var ulDom = el('ul', { class: 'niveau-groupe' });
          var liDom = el('li', {}, [
            el('details', {}, [
              el('summary', {}, [caseACocher(function (v) { basculerGroupe(casesDom, v); }, casesDom, dom)]),
              ulDom,
            ]),
          ]);
          Object.keys(parType[type][dom]).sort().forEach(function (groupe) {
            var tests = parType[type][dom][groupe];
            var casesGroupe = [];
            var ulTests = el('ul', { class: 'niveau-test' });
            tests.forEach(function (t) {
              var cb = el('input', { type: 'checkbox' });
              cb.checked = !!etat.cochees[t.id];
              cb.addEventListener('change', function () { basculerTest(t, cb.checked); });
              casesGroupe.push(cb); casesDom.push(cb); casesType.push(cb);
              var li = el('li', { class: 't-feuille', title: (t.fiche && t.fiche.teste) || '' },
                [cb, el('span', {}, [' ' + t.nom])]);
              ulTests.appendChild(li);
            });
            var liGroupe = el('li', {}, [
              el('details', {}, [
                el('summary', {}, [caseACocher(function (v) { basculerGroupe(casesGroupe, v); }, casesGroupe, groupe + ' (' + tests.length + ')')]),
                ulTests,
              ]),
            ]);
            ulDom.appendChild(liGroupe);
          });
          ulType.appendChild(liDom);
        });
        refs.arbre.appendChild(detailsType);
      });
      function compteType(dom) {
        var n = 0;
        Object.keys(dom).forEach(function (d) { Object.keys(dom[d]).forEach(function (g) { n += dom[d][g].length; }); });
        return n;
      }
    }
    function caseACocher(onChange, casesLiees, libelle) {
      var cb = el('input', { type: 'checkbox' });
      cb.addEventListener('change', function () { onChange(cb.checked); });
      return el('label', { class: 'noeud' }, [cb, ' ' + libelle]);
    }
    function basculerGroupe(cases, coche) {
      cases.forEach(function (cb) { if (cb.checked !== coche) { cb.checked = coche; cb.dispatchEvent(new Event('change')); } });
    }
    function basculerTest(t, coche) {
      if (coche) etat.cochees[t.id] = true; else delete etat.cochees[t.id];
      majCompteur();
    }
    /* L'adresse reflète le préréglage ou le critère choisi (SPEC-BANC-007),
       pas chaque case cochée à la main — décocher un test individuel dans un
       domaine sélectionné ne doit pas effacer `?domaine=...` de l'adresse. */
    function majCompteur() {
      refs.compteur.textContent = Object.keys(etat.cochees).length + ' test(s) retenu(s)';
    }

    function cocherSelon(criteres) {
      etat.cochees = Object.create(null);
      (G.MC_TESTS.selection(etat.catalogue, criteres) || []).forEach(function (t) { etat.cochees[t.id] = true; });
      construireArbre();
      majCompteur();
    }

    function appliquerRecherche() {
      var q = (refs.recherche.value || '').toLowerCase().trim();
      refs.arbre.querySelectorAll('.t-feuille').forEach(function (li) {
        var texte = li.textContent.toLowerCase() + ' ' + (li.getAttribute('title') || '').toLowerCase();
        li.style.display = (!q || texte.indexOf(q) >= 0) ? '' : 'none';
      });
    }
    refs.recherche.addEventListener('input', appliquerRecherche);

    /* Le menu de sélection est en surimpression, mais on le referme quand
       même après une action de lancement ou d'affichage (retour testeur) :
       la liste des tests garde ainsi toute sa hauteur sans qu'il faille
       cliquer ailleurs. Il ne se rouvre que par le bouton « Sélection ». */
    function refermerSelection() { refs.panneauSel.hidden = true; }

    refs.btnMenu.addEventListener('click', function () {
      refs.panneauSel.hidden = !refs.panneauSel.hidden;
    });

    G.MC_TESTS.PRESETS.forEach(function (p) {
      refs.presets.appendChild(el('option', { value: p.nom }, [p.nom + ' — ' + p.description]));
    });
    refs.presets.addEventListener('change', function () {
      if (!refs.presets.value) return;
      var preset = G.MC_TESTS.PRESETS.filter(function (p) { return p.nom === refs.presets.value; })[0];
      if (preset) { cocherSelon(preset.criteres); urlDepuisCriteres({ preset: preset.nom }); }
    });
    refs.btnTout.addEventListener('click', function () { cocherSelon({ tout: true }); urlDepuisCriteres({}); refermerSelection(); });
    refs.btnEchecs.addEventListener('click', function () {
      // `MC_TESTS.selection` attend, pour la clé `echecs`, la LISTE des ids/noms
      // en échec (comme `tests`/`liste`), pas un simple drapeau — c'est ici,
      // côté navigateur, qu'on la résout depuis la mémorisation locale.
      cocherSelon({ echecs: G.MC_TESTS.dernierEchecs() });
      urlDepuisCriteres({}); refermerSelection();
    });
    refs.btnLancer.addEventListener('click', function () { refermerSelection(); lancer(); });
    refs.btnArreter.addEventListener('click', function () { etat.arretDemande = true; });
    refs.seuilLent.addEventListener('change', function () {
      var v = parseFloat(refs.seuilLent.value);
      if (v > 0) etat.seuilLentMs = v * 1000;
    });

    // ── liste des tests exécutés + résumé (SPEC-BANC-008/009) ──────────────
    function ligneVide(t) {
      var li = el('li', { class: 'ligne-test', id: 'ligne-' + cssId(t.id) });
      var tete = el('div', { class: 'tete' }, [
        el('span', { class: 'etat etat-attente' }, ['…']),
        el('span', { class: 'nom' }, [t.nom]),
        el('span', { class: 'meta' }, ['']),
      ]);
      var corps = el('div', { class: 'corps', style: 'display:none' });
      tete.addEventListener('click', function () {
        corps.style.display = corps.style.display === 'none' ? 'block' : 'none';
        refermerSelection();
      });
      li.appendChild(tete); li.appendChild(corps);
      li._tete = tete; li._corps = corps;
      return li;
    }
    function cssId(id) { return String(id).replace(/[^a-zA-Z0-9_-]/g, '_'); }

    function afficherEnCours(t, libelleEtape) {
      var li = etat.lignesParId[t.id];
      if (!li) { li = ligneVide(t); etat.lignesParId[t.id] = li; refs.liste.appendChild(li); suivreScroll(); }
      li._tete.querySelector('.etat').className = 'etat etat-cours';
      li._tete.querySelector('.etat').textContent = '▶';
      li._tete.querySelector('.meta').textContent = libelleEtape ? ('— ' + libelleEtape) : '— en cours…';
    }
    function marqueEtat(etatTest) {
      if (etatTest === 'reussi') return { c: 'etat-ok', s: '✓' };
      if (etatTest === 'delai') return { c: 'etat-delai', s: '⏱' };
      return { c: 'etat-ko', s: '✗' };
    }
    function afficherFini(t, r) {
      var li = etat.lignesParId[t.id] || (etat.lignesParId[t.id] = ligneVide(t), refs.liste.appendChild(etat.lignesParId[t.id]), etat.lignesParId[t.id]);
      var m = marqueEtat(r.etat);
      li._tete.querySelector('.etat').className = 'etat ' + m.c;
      li._tete.querySelector('.etat').textContent = m.s;
      li._tete.querySelector('.meta').textContent = '— ' + duree(r.duree_ms);
      li._corps.innerHTML = '';
      li._corps.appendChild(detailTest(t, r));
      if (r.duree_ms > etat.seuilLentMs) ajouterLent(t, r);
      if (r.etat !== 'reussi') ajouterErreur(t, r, li);
      suivreScroll();
    }
    /* SPEC-BANC-013 : le retour textuel d'un test déplié — fiche
       (quoi/pourquoi/attendu), étapes dans l'ordre, assertions réussies et
       échouées, message et pile d'appel à l'échec. */
    function detailTest(t, r) {
      var f = t.fiche || {};
      var d = el('div', { class: 'fiche' }, [
        f.teste ? el('div', {}, ['Teste : ' + f.teste]) : null,
        f.pourquoi ? el('div', {}, ['Pourquoi : ' + f.pourquoi]) : null,
        f.attendu ? el('div', {}, ['Attendu : ' + f.attendu]) : null,
      ]);
      var bloc = el('div', {}, [d]);
      if (r.etapes && r.etapes.length) {
        var ul = el('ul', { class: 'etapes' });
        r.etapes.forEach(function (e) { ul.appendChild(el('li', {}, [e.libelle + ' — ' + duree(e.t_ms) + (e.total ? ' (' + e.n + '/' + e.total + ')' : '')])); });
        bloc.appendChild(el('div', {}, ['Étapes :', ul]));
      }
      if (r.assertions) bloc.appendChild(el('div', {}, ['Assertions : ' + r.assertions.ok + ' réussies, ' + r.assertions.ko + ' en échec']));
      if (r.message) bloc.appendChild(el('div', { class: 'message' }, ['Message : ' + r.message]));
      if (r.pile) bloc.appendChild(el('pre', { class: 'pile' }, [r.pile]));
      if (r.metriques) {
        var mx = r.metriques;
        bloc.appendChild(el('div', { class: 'metriques' }, [
          'images ' + (mx.images || 0) + ' · fps moy ' + (mx.fps_moyen ? mx.fps_moyen.toFixed(1) : '—') +
          ' · min ' + (mx.fps_min ? mx.fps_min.toFixed(1) : '—') + ' · p95 ' + (mx.fps_p95 ? mx.fps_p95.toFixed(1) : '—') +
          (mx.appels_dessin != null ? ' · dessins ' + mx.appels_dessin : '') +
          (mx.triangles != null ? ' · triangles ' + mx.triangles : '') +
          (mx.memoire_js != null ? ' · mémoire ' + Math.round(mx.memoire_js / 1048576) + ' Mo' : ''),
        ]));
      }
      if (r.captures && r.captures.length) {
        var vign = el('div', { class: 'vignettes' });
        r.captures.forEach(function (c) {
          if (!c || !c.base64) return;
          var img = el('img', { src: c.base64, title: c.libelle, class: 'vignette' });
          img.addEventListener('click', function () { agrandirVignette(c); });
          vign.appendChild(img);
        });
        bloc.appendChild(vign);
      }
      return bloc;
    }
    function agrandirVignette(c) {
      refermerSelection();
      var overlay = el('div', { class: 'overlay-vignette', onclick: function () { overlay.remove(); } },
        [el('img', { src: c.base64 }), el('div', { class: 'legende' }, [c.libelle || ''])]);
      document.body.appendChild(overlay);
    }
    function suivreScroll() {
      if (!etat.suit) return;
      refs.liste.scrollTop = refs.liste.scrollHeight;
    }
    refs.liste.addEventListener('scroll', function () {
      var enBas = refs.liste.scrollHeight - refs.liste.scrollTop - refs.liste.clientHeight < 24;
      etat.suit = enBas;
    });

    function ajouterLent(t, r) {
      var li = el('li', { onclick: function () { allerA(t.id); } }, [t.nom + ' — ' + duree(r.duree_ms)]);
      refs.lents.appendChild(li);
    }
    function ajouterErreur(t, r) {
      var li = el('li', { onclick: function () { allerA(t.id); } }, [t.nom + ' — ' + (r.message || r.etat)]);
      refs.erreurs.appendChild(li);
    }
    function allerA(id) {
      refermerSelection();
      var li = etat.lignesParId[id];
      if (!li) return;
      li.scrollIntoView({ block: 'center' });
      li._corps.style.display = 'block';
    }
    function signalerLentEnDirect(t) {
      var deja = refs.lents.querySelector('[data-encours="' + cssId(t.id) + '"]');
      if (deja) return;
      var li = el('li', { 'data-encours': cssId(t.id) }, [t.nom + ' — en cours (dépasse le seuil)']);
      refs.lents.appendChild(li);
    }

    // ── résumé fixe (SPEC-BANC-008/009) ────────────────────────────────────
    function majResume(enCoursTexte) {
      var total = Object.keys(etat.cochees).length;
      var faits = etat.resultats.length;
      var passes = etat.resultats.filter(function (r) { return r.etat === 'reussi'; }).length;
      var echoues = faits - passes;
      var restants = Math.max(0, total - faits);
      var ecoule = etat.debutCampagne ? (performance.now() - etat.debutCampagne) : 0;
      var estimFin = '';
      if (faits > 0 && restants > 0) {
        var parTest = ecoule / faits;
        estimFin = ' · fin estimée dans ' + duree(parTest * restants);
      }
      var tout = etat.enCours ? false : (total > 0 && faits >= total);
      refs.resume.innerHTML = '';
      refs.resume.className = 'resume ' + (echoues ? 'ko' : (tout ? 'ok' : ''));
      refs.resume.appendChild(el('div', {}, [
        passes + ' passé(s) · ' + echoues + ' échoué(s) · ' + restants + ' restant(s) · ' + duree(ecoule) + estimFin,
      ]));
      if (enCoursTexte) refs.resume.appendChild(el('div', { class: 'en-cours' }, [enCoursTexte]));
      if (tout && total > 0) refs.resume.appendChild(el('div', { class: 'fin' }, ['Campagne terminée.']));
    }

    // ── exécution des unitaires par lots, avec progression (SPEC-BANC-009) ──
    // `G.T.run` (tests/harness.js) exécute un lot de tests SYNCHRONE : on
    // l'appelle un test à la fois (filtre = [nom]) pour garder la main entre
    // deux, comme avant — `debutTest`/`finTest` retrouvent l'entrée du
    // catalogue par groupe+nom (un même nom de test peut exister dans deux
    // groupes différents, d'où la clé composée).
    var DELAI_UNITAIRE_MS = 30000; // même défaut que tests/run.js (DELAI_TEST_MS_DEFAUT)
    async function executerUnitaires(liste) {
      if (!liste.length) return;
      var parClef = Object.create(null);
      liste.forEach(function (t) { parClef[t.groupe + '\u0000' + t.nom] = t; });
      var suivi = {
        debutTest: function (groupe, nom) {
          var t = parClef[groupe + '\u0000' + nom];
          if (t) { afficherEnCours(t); majResume(t.nom + ' — en cours'); }
        },
        finTest: function (groupe, nom, ok, ms, detail) {
          var t = parClef[groupe + '\u0000' + nom];
          if (!t) return;
          var r = { etat: ok ? 'reussi' : 'echec', duree_ms: ms, etapes: (detail && detail.etapes) || [],
                    assertions: (detail && detail.assertions) || { ok: 0, ko: 0 },
                    message: (detail && detail.message) || null, pile: (detail && detail.pile) || null, captures: [] };
          etat.resultats.push(Object.assign({ id: t.id, nom: t.nom, type: t.type, groupe: t.groupe,
                                               domaines: t.domaines, specs: t.specs, fiche: t.fiche }, r));
          afficherFini(t, r);
          majResume();
        },
      };
      for (var i = 0; i < liste.length; i++) {
        if (etat.arretDemande) break;
        G.T.run([liste[i].nom], suivi, { delaiMs: DELAI_UNITAIRE_MS });
        if ((i + 1) % 12 === 0) await attendre0();  // laisse le DOM se rafraîchir
      }
      await attendre0();
    }

    // ── exécution de la campagne e2e ────────────────────────────────────────
    async function executerE2E(liste) {
      if (!liste.length) return;
      // le catalogue (tests/catalogue.js) ne porte pas la fonction du test —
      // seul G.E2E_LISTE (tests/e2e.js) l'a : on la retrouve par nom.
      var parNom = Object.create(null);
      (G.E2E_LISTE || []).forEach(function (e) { parNom[e.name] = e; });
      var tests = liste.map(function (t) {
        var e = parNom[t.nom];
        if (!e) return null;
        return Object.assign({}, e, { id: t.id, nom: t.nom, domaines: t.domaines, specs: t.specs, fiche: t.fiche });
      }).filter(function (t) { return t; });
      var testActif = null, t0Actif = 0, minuteurLent = null;
      await G.runCampagneE2E(game, tests, {
        debutTest: function (t) {
          afficherEnCours(t); majResume(t.nom + ' — en cours');
          testActif = t; t0Actif = performance.now();
          // SPEC-BANC-010 : signalé dans la zone des lents PENDANT qu'il tourne,
          // pas seulement une fois fini — un test en cours qui dépasse déjà le
          // seuil doit y apparaître avant même son résultat.
          minuteurLent = setInterval(function () {
            if (performance.now() - t0Actif > etat.seuilLentMs) signalerLentEnDirect(testActif);
          }, 500);
        },
        finTest: function (t, r) {
          clearInterval(minuteurLent);
          var marque = refs.lents.querySelector('[data-encours="' + cssId(t.id) + '"]');
          if (marque) marque.remove();
          testActif = null;
          etat.resultats.push(r);
          afficherFini(t, r);
          majResume();
        },
      }, {
        delaiDefaut: 60,
        arretee: function () { return etat.arretDemande; },
      });
    }

    // ── lancement complet ───────────────────────────────────────────────────
    async function lancer() {
      if (etat.enCours) return;
      var choisis = etat.catalogue.filter(function (t) { return etat.cochees[t.id]; });
      if (!choisis.length) { alert('Aucun test sélectionné.'); return; }
      etat.resultats = [];
      etat.lignesParId = Object.create(null);
      refs.liste.innerHTML = '';
      refs.lents.innerHTML = '';
      refs.erreurs.innerHTML = '';
      etat.enCours = true; etat.arretDemande = false;
      etat.debutCampagne = performance.now();
      refs.btnLancer.disabled = true;
      refs.btnArreter.disabled = false;
      // le menu de sélection est en surimpression (absolu) : il ne pousse
      // jamais la liste, mais on le referme quand même pendant la campagne
      // pour qu'il ne la recouvre pas (retour testeur).
      refs.panneauSel.hidden = true;
      var debutISO = new Date().toISOString();

      var minuteurResume = setInterval(function () { if (etat.enCours) majResume(); }, 500);

      var unitaires = choisis.filter(function (t) { return t.type === 'unitaire'; });
      var e2eTests = choisis.filter(function (t) { return t.type === 'e2e'; });
      await executerUnitaires(unitaires);
      if (!etat.arretDemande) await executerE2E(e2eTests);

      clearInterval(minuteurResume);
      etat.enCours = false;
      refs.btnLancer.disabled = false;
      refs.btnArreter.disabled = true;
      majResume();

      var echecsIds = etat.resultats.filter(function (r) { return r.etat !== 'reussi'; }).map(function (r) { return r.id; });
      G.MC_TESTS.memoriserEchecs(echecsIds);

      await envoyerCahier({
        preset: refs.presets.value || null, debutISO: debutISO,
        interrompue: etat.arretDemande, criteresTotal: choisis.length,
      });
    }

    // ── envoi du cahier de test (SPEC-BANC-014) ─────────────────────────────
    function totauxPar(resultats, cle) {
      var out = Object.create(null);
      resultats.forEach(function (r) {
        var valeurs = cle === 'parDomaine' ? (r.domaines && r.domaines.length ? r.domaines : ['—']) : [r.type];
        valeurs.forEach(function (v) { out[v] = (out[v] || 0) + 1; });
      });
      return out;
    }
    async function envoyerCahier(meta) {
      var fin = new Date();
      var passes = etat.resultats.filter(function (r) { return r.etat === 'reussi'; }).length;
      var echecs = etat.resultats.filter(function (r) { return r.etat !== 'reussi'; }).length;
      var lents = etat.resultats.filter(function (r) { return r.duree_ms > etat.seuilLentMs; })
        .sort(function (a, b) { return b.duree_ms - a.duree_ms; }).slice(0, 10)
        .map(function (r) { return { nom: r.nom, duree_ms: r.duree_ms }; });
      var fpsValeurs = etat.resultats.filter(function (r) { return r.metriques && r.metriques.fps_moyen; }).map(function (r) { return r.metriques.fps_moyen; });
      var fpsMoyen = fpsValeurs.length ? fpsValeurs.reduce(function (a, b) { return a + b; }, 0) / fpsValeurs.length : null;

      var gpu = null;
      try {
        var gl = game.render.renderer.getContext();
        var dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) gpu = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
      } catch (e) { /* rien */ }

      var captures = [];
      var resultatsPourEnvoi = etat.resultats.map(function (r) {
        var refsCaptures = (r.captures || []).map(function (c) {
          captures.push({ libelle: c.libelle, type: c.type, base64: c.base64 });
          return { libelle: c.libelle, fichier: captures.length - 1 };
        });
        var copie = Object.assign({}, r);
        copie.captures = refsCaptures;
        return copie;
      });

      var cahier = {
        schema: 1,
        campagne: {
          preset: meta.preset, criteres: critereDepuisURL(), debut: meta.debutISO, fin: fin.toISOString(),
          duree_ms: performance.now() - etat.debutCampagne, interrompue: meta.interrompue,
          environnement: {
            source: 'navigateur', navigateur: navigator.userAgent, gpu: gpu,
            resolution: window.innerWidth + 'x' + window.innerHeight,
            versionJeu: MC.Core.VERSION_JEU, graine: game.world && game.world.seed,
          },
          totaux: { total: etat.resultats.length, passes: passes, echecs: echecs, ignores: 0,
                    parType: totauxPar(etat.resultats, 'parType'), parDomaine: totauxPar(etat.resultats, 'parDomaine') },
          lents: lents, fps_moyen: fpsMoyen,
        },
        tests: resultatsPourEnvoi,
      };

      try {
        var rep = await fetch('/tests/resultats', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resultats: cahier, captures: captures }),
        });
        if (rep.ok) {
          var j = await rep.json();
          afficherLienRapport(j && j.rapport);
          return;
        }
      } catch (e) { /* pas de serveur de résultats : repli local */ }
      replisLocal(cahier);
    }
    function afficherLienRapport(url) {
      if (!url) return;
      var a = el('a', { href: url, target: '_blank' }, ['Cahier de test : ' + url]);
      var conteneur = el('div', {}, [a]);
      refs.resume.appendChild(conteneur);
      // le dossier du cahier (bibliothèque tests/resultats/<dossier>/, côté
      // noyau) se lit dans le lien du rapport : /tests/resultats/<dossier>/…
      var m = url.match(/\/tests\/resultats\/([^/]+)\//);
      if (m) ajouterExports(conteneur, m[1]);
    }
    /* Boutons d'export du cahier (web/PDF/Word), servis par la bibliothèque
       des cahiers du noyau (GET /tests/cahiers/<dossier>/export?format=…) ;
       masqués si cette route n'existe pas encore sur le serveur (404). */
    async function ajouterExports(conteneur, dossier) {
      var formats = [['html', 'Web'], ['pdf', 'PDF'], ['docx', 'Word']];
      for (var i = 0; i < formats.length; i++) {
        var lien = '/tests/cahiers/' + encodeURIComponent(dossier) + '/export?format=' + formats[i][0];
        var disponible = true;
        try {
          var rep = await fetch(lien, { method: 'HEAD' });
          if (rep.status === 404) disponible = false;
        } catch (e) { disponible = false; }
        if (!disponible) continue;
        conteneur.appendChild(document.createTextNode(' — '));
        conteneur.appendChild(el('a', { href: lien, target: '_blank' }, [formats[i][1]]));
      }
    }
    function replisLocal(cahier) {
      var blob = new Blob([JSON.stringify(cahier, null, 2)], { type: 'application/json' });
      var a = el('a', { href: URL.createObjectURL(blob), download: 'resultats.json' }, ['Télécharger resultats.json']);
      var conteneur = el('div', {}, ['Serveur de résultats indisponible — ', a]);
      if (G.MC_RAPPORT && G.MC_RAPPORT.html) {
        try {
          var html = G.MC_RAPPORT.html(cahier);
          var blobH = new Blob([html], { type: 'text/html' });
          var aH = el('a', { href: URL.createObjectURL(blobH), download: 'rapport.html' }, ['rapport.html']);
          conteneur.appendChild(document.createTextNode(' — '));
          conteneur.appendChild(aH);
        } catch (e) { /* rien */ }
      }
      refs.resume.appendChild(conteneur);
    }
    window.addEventListener('beforeunload', function () {
      if (etat.enCours) {
        etat.arretDemande = true;
        // best effort : navigator.sendBeacon ne peut pas attendre de réponse,
        // mais transmet ce qui a déjà été accumulé avant la fermeture.
        try {
          var corps = JSON.stringify({ resultats: { schema: 1, campagne: { interrompue: true,
            totaux: { total: etat.resultats.length } }, tests: etat.resultats }, captures: [] });
          navigator.sendBeacon('/tests/resultats', new Blob([corps], { type: 'application/json' }));
        } catch (e) { /* rien */ }
      }
    });

    // ── initialisation du catalogue ──────────────────────────────────────────
    async function init() {
      var specsIndex = {};
      try {
        var rep = await fetch('/SPECS.md');
        if (rep.ok) specsIndex = G.MC_TESTS.indexSpecs(await rep.text());
      } catch (e) { /* SPECS.md indisponible : fiches par défaut minimales */ }
      // laisse la suite T se peupler (tous les fichiers spec-*.js/unit.js/functional.js sont déjà chargés)
      etat.catalogue = G.MC_TESTS.construire(T, G.E2E_LISTE, specsIndex);
      construireArbre();

      var depuisURL = critereDepuisURL();
      if (depuisURL.preset) {
        refs.presets.value = depuisURL.preset;
        var preset = G.MC_TESTS.PRESETS.filter(function (p) { return p.nom === depuisURL.preset; })[0];
        cocherSelon(preset ? preset.criteres : { tout: true });
      } else if (depuisURL.domaine || depuisURL.type || depuisURL.groupe || depuisURL.test) {
        cocherSelon({ domaines: depuisURL.domaine, types: depuisURL.type, groupes: depuisURL.groupe, liste: depuisURL.test });
      } else {
        cocherSelon({ tout: true });
      }
      majResume();
    }
    init();

    /* Poignée exposée pour un test de page (tests/e2e.js, SPEC-BANC-007) :
       le menu de sélection doit se refermer dès qu'on clique « Lancer », pas
       seulement à l'ouverture d'un test — vérifiable sans dépendre de la
       structure interne au-delà de ces quelques références. */
    window.MC_BANC = { refs: refs, etat: etat, refermerSelection: refermerSelection, cocherSelon: cocherSelon };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();
})(typeof window !== 'undefined' ? window : this);
