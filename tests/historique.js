/* historique.js — interface de la zone « Historique global » (SPEC-BANC-033
   à 040, docs/banc/historique-global.md §3.1) et de son panneau « test »
   (SPEC-BANC-039, SPEC-BANC-121). Client pur des routes `/tests/historique/*`
   de server.js (toute la logique de tri/filtre/pagination/export vit côté
   serveur, tools/historique.js — voir son en-tête et tests/spec-historique.js) :
   ce fichier ne fait qu'afficher, construire les requêtes et gérer les
   interactions (SPEC-BANC-035/036/037/038). Chargé après banc-ui.js
   (tests/index.html), même style (IIFE sur `window`/`self`, pas de
   dépendance npm).

   Robustesse (SPEC-BANC-120) : chaque requête vérifie le statut HTTP et le
   JSON reçu, affiche une erreur LISIBLE plutôt qu'une page blanche ou figée,
   et ignore une réponse périmée (une saisie rapide dans un filtre lance
   plusieurs requêtes : seule la dernière fait foi). */
(function (G) {
  'use strict';

  function el(tag, attrs, enfants) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (enfants || []).forEach(function (c) { if (c !== null && c !== undefined) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function echappe(s) { return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* Lit une réponse JSON en vérifiant le statut : une erreur serveur (400,
     500…) porte `motif`, rendu tel quel ; un corps illisible (proxy, page
     d'erreur HTML) devient une erreur explicite au lieu d'une exception
     « Unexpected token < » non rattrapée. */
  function lireJSON(r) {
    return r.text().then(function (txt) {
      var j = null;
      try { j = JSON.parse(txt); } catch (e) { throw new Error('réponse illisible du serveur (HTTP ' + r.status + ')'); }
      if (!r.ok) throw new Error((j && j.motif) || ('HTTP ' + r.status));
      return j;
    });
  }
  G.MC_LIRE_JSON = lireJSON;

  // ══════════════════════════════════════════════════════════════════════
  // Colonnes (SPEC-BANC-034) — métadonnées d'AFFICHAGE seulement (le type
  // qui commande le tri/filtre réel vit côté serveur, tools/historique.js
  // TYPES_COLONNES ; ce tableau ne fait que dire au client QUEL formulaire
  // de filtre construire et QUELLES colonnes existent).
  // ══════════════════════════════════════════════════════════════════════
  var COLONNES = [
    { id: 'debut_run', label: 'Début run', type: 'horodatage', defaut: true },
    { id: 'commit_court', label: 'Commit', type: 'texte', defaut: true },
    { id: 'sujet_commit', label: 'Sujet du commit', type: 'texte', defaut: false },
    { id: 'rang_commit', label: 'Rang commit', type: 'commit', defaut: false },
    { id: 'branche', label: 'Branche', type: 'enum', defaut: true },
    { id: 'preset', label: 'Préréglage', type: 'enum', defaut: true },
    { id: 'origine', label: 'Origine', type: 'enum', defaut: true },
    { id: 'inscrit', label: 'Inscrit', type: 'enum', defaut: true },
    { id: 'test', label: 'Id test', type: 'texte', defaut: false },
    { id: 'cle', label: 'Identité', type: 'exact', defaut: false },
    { id: 'nom', label: 'Nom du test', type: 'texte', defaut: true },
    { id: 'type', label: 'Type', type: 'enum', defaut: true },
    { id: 'groupe', label: 'Groupe', type: 'enum', defaut: false },
    { id: 'domaines', label: 'Domaines', type: 'liste', defaut: true },
    { id: 'specs', label: 'Specs', type: 'liste', defaut: false },
    { id: 'fonctions', label: 'Fonctions', type: 'liste', defaut: false },
    { id: 'etiquettes', label: 'Étiquettes', type: 'liste', defaut: false },
    { id: 'debut_test', label: 'Début test', type: 'horodatage', defaut: false },
    { id: 'duree_ms', label: 'Durée (ms)', type: 'nombre', defaut: true },
    { id: 'etat', label: 'État', type: 'enum', defaut: true },
    { id: 'erreur', label: 'Erreur', type: 'texte', defaut: true },
    { id: 'nb_captures', label: 'Captures', type: 'nombre', defaut: false },
    { id: 'motif', label: 'Motif', type: 'texte', defaut: false },
    { id: 'arbre_modifie', label: 'Arbre modifié', type: 'enum', defaut: false },
    { id: 'interrompu', label: 'Interrompu', type: 'enum', defaut: false },
  ];
  var PAR_ID = {}; COLONNES.forEach(function (c) { PAR_ID[c.id] = c; });

  var CLE_COLONNES = 'mc-historique-colonnes';
  function colonnesParDefaut() { return COLONNES.filter(function (c) { return c.defaut; }).map(function (c) { return c.id; }); }
  function chargerColonnes() {
    try {
      var brut = localStorage.getItem(CLE_COLONNES);
      if (!brut) return colonnesParDefaut();
      var l = JSON.parse(brut);
      var connues = Array.isArray(l) ? l.filter(function (id) { return PAR_ID[id]; }) : [];
      return connues.length ? connues : colonnesParDefaut();
    } catch (e) { return colonnesParDefaut(); }
  }
  function sauverColonnes(cols) { try { localStorage.setItem(CLE_COLONNES, JSON.stringify(cols)); } catch (e) { /* stockage indisponible : la page reste utilisable */ } }

  // ══════════════════════════════════════════════════════════════════════
  // État de la vue
  // ══════════════════════════════════════════════════════════════════════
  var etat = {
    colonnes: chargerColonnes(),
    tris: [],                 // [{ champ, ordre }] — SPEC-BANC-035
    filtresColonnes: {},       // { [champ]: spec-serveur } — SPEC-BANC-036
    rapide: 'inscrits',        // SPEC-BANC-037
    page: 1, taille: 50,
    effectifs: {},
    total: 0,
    seq: 0,                    // numéro de la dernière requête de lignes envoyée
    cleFiltres: null,          // colonnes pour lesquelles la ligne de filtres a été construite
  };

  function racine() { return document.getElementById('zone-historique'); }

  // ══════════════════════════════════════════════════════════════════════
  // Requêtes serveur (SPEC-BANC-040)
  // ══════════════════════════════════════════════════════════════════════
  function parametresVue() {
    var p = new URLSearchParams();
    var champs = etat.tris.map(function (t) { return t.champ; });
    var ordres = etat.tris.map(function (t) { return t.ordre; });
    if (champs.length) { p.set('tri', champs.join(',')); p.set('ordre', ordres.join(',')); }
    p.set('filtre', JSON.stringify(etat.filtresColonnes));
    p.set('rapide', etat.rapide);
    return p;
  }
  function urlLignes(opts) {
    var o = opts || {};
    var p = parametresVue();
    p.set('page', String(o.page || etat.page));
    p.set('taille', String(o.taille || etat.taille));
    return '/tests/historique/lignes?' + p.toString();
  }

  function messageCorps(texte, classe) {
    var corps = racine().querySelector('#hist-table tbody');
    if (!corps) return;
    corps.innerHTML = '';
    corps.appendChild(el('tr', { class: classe || '' }, [el('td', { colspan: String(etat.colonnes.length || 1) }, [texte])]));
  }

  function rafraichir() {
    var t = racine();
    if (!t || t.hidden) return;
    var monSeq = ++etat.seq;
    t.querySelector('#hist-page-info').textContent = 'chargement…';
    fetch(urlLignes()).then(lireJSON).then(function (data) {
      if (monSeq !== etat.seq) return; // réponse périmée : une requête plus récente est partie
      etat.effectifs = data.effectifs || {};
      etat.total = data.total || 0;
      etat.page = data.page || etat.page;
      if (data.taille) etat.taille = data.taille;
      rendreTable(Array.isArray(data.lignes) ? data.lignes : []);
      rendrePagination();
    }).catch(function (e) {
      if (monSeq !== etat.seq) return;
      rendreEntetes();
      messageCorps('Erreur : ' + ((e && e.message) || e) + ' — corrigez le filtre ou rouvrez l\'historique.', 'hist-erreur');
      t.querySelector('#hist-page-info').textContent = 'erreur de chargement';
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // En-têtes + tri (SPEC-BANC-035)
  // ══════════════════════════════════════════════════════════════════════
  function clicEntete(id, avecMaj) {
    if (avecMaj) {
      var i = etat.tris.findIndex(function (t) { return t.champ === id; });
      if (i < 0) etat.tris.push({ champ: id, ordre: 'asc' });
      else if (etat.tris[i].ordre === 'asc') etat.tris[i].ordre = 'desc';
      else etat.tris.splice(i, 1);
    } else if (etat.tris.length > 1) {
      // plusieurs tris actifs : un clic simple, où qu'il porte, repart de
      // zéro plutôt que de re-empiler un état ambigu (comportement voulu et
      // vérifié par le test e2e, SPEC-BANC-035)
      etat.tris = [];
    } else if (etat.tris.length === 1 && etat.tris[0].champ === id) {
      if (etat.tris[0].ordre === 'asc') etat.tris[0].ordre = 'desc'; else etat.tris = [];
    } else {
      etat.tris = [{ champ: id, ordre: 'asc' }];
    }
    etat.page = 1; rafraichir();
  }
  function ordreDe(id) { var t = etat.tris.find(function (x) { return x.champ === id; }); return t ? t.ordre : null; }

  // ══════════════════════════════════════════════════════════════════════
  // Filtres par colonne (SPEC-BANC-036) — construction du formulaire selon
  // le type déclaré dans COLONNES. La ligne de filtres n'est construite
  // qu'UNE fois par jeu de colonnes (SPEC-BANC-120) : la reconstruire à
  // chaque réponse effaçait le texte en cours de saisie et faisait perdre
  // le focus après la première lettre. Seules les options des listes
  // (effectifs) sont mises à jour en place, sélection conservée.
  // ══════════════════════════════════════════════════════════════════════
  var minuteurSaisie = null;
  function majFiltre(id, spec, differe) {
    if (spec === null) delete etat.filtresColonnes[id];
    else etat.filtresColonnes[id] = spec;
    etat.page = 1;
    clearTimeout(minuteurSaisie);
    if (differe) minuteurSaisie = setTimeout(rafraichir, 250); else rafraichir();
  }
  function remplirOptions(sel, col) {
    var choisies = etat.filtresColonnes[col.id] || [];
    var vues = {};
    sel.innerHTML = '';
    (etat.effectifs[col.id] || []).forEach(function (e) {
      var v = String(e.valeur);
      vues[v] = true;
      var o = el('option', { value: v }, [v + ' (' + e.effectif + ')']);
      o.selected = choisies.indexOf(v) >= 0;
      sel.appendChild(o);
    });
    // une valeur choisie qui n'a plus aucune ligne reste visible (et décochable)
    choisies.forEach(function (v) {
      if (vues[v]) return;
      var o = el('option', { value: v }, [v + ' (0)']);
      o.selected = true;
      sel.appendChild(o);
    });
  }
  function celluleFiltre(col) {
    var td = el('th');
    var actuel = etat.filtresColonnes[col.id];
    if (col.type === 'texte' || col.type === 'exact') {
      var inp = el('input', { type: 'text', placeholder: col.type === 'exact' ? 'égal à…' : 'contient…',
        oninput: function () { majFiltre(col.id, inp.value || null, true); } });
      inp.value = typeof actuel === 'string' ? actuel : '';
      td.appendChild(inp);
    } else if (col.type === 'enum' || col.type === 'liste') {
      var sel = el('select', { multiple: 'multiple', size: '1', 'data-col': col.id, onchange: function () {
        var vals = Array.from(sel.selectedOptions).map(function (o) { return o.value; });
        majFiltre(col.id, vals.length ? vals : null);
      } });
      remplirOptions(sel, col);
      td.appendChild(sel);
    } else if (col.type === 'nombre') {
      var min = el('input', { type: 'number', placeholder: 'min', style: 'width:48%', oninput: appliquer });
      var max = el('input', { type: 'number', placeholder: 'max', style: 'width:48%', oninput: appliquer });
      if (actuel && actuel.min !== undefined) min.value = actuel.min;
      if (actuel && actuel.max !== undefined) max.value = actuel.max;
      function appliquer() {
        var spec = {};
        if (min.value !== '' && isFinite(parseFloat(min.value))) spec.min = parseFloat(min.value);
        if (max.value !== '' && isFinite(parseFloat(max.value))) spec.max = parseFloat(max.value);
        majFiltre(col.id, Object.keys(spec).length ? spec : null, true);
      }
      td.appendChild(min); td.appendChild(max);
    } else if (col.type === 'horodatage') {
      var de = el('input', { type: 'date', style: 'width:48%', onchange: appliqueD });
      var a = el('input', { type: 'date', style: 'width:48%', onchange: appliqueD });
      if (actuel && actuel.de) de.value = actuel.de;
      if (actuel && actuel.a) a.value = String(actuel.a).slice(0, 10);
      function appliqueD() {
        var spec = {};
        if (de.value) spec.de = de.value;
        // « jusqu'au 1er octobre » inclut toute la journée du 1er (les
        // horodatages sont ISO complets, comparés lexicalement côté serveur)
        if (a.value) spec.a = a.value + 'T23:59:59.999Z';
        majFiltre(col.id, Object.keys(spec).length ? spec : null);
      }
      td.appendChild(de); td.appendChild(a);
    } else if (col.type === 'commit') {
      var rde = el('input', { type: 'number', placeholder: 'de', style: 'width:48%', onchange: appliqueC });
      var ra = el('input', { type: 'number', placeholder: 'à', style: 'width:48%', onchange: appliqueC });
      if (actuel && actuel.de !== undefined) rde.value = actuel.de;
      if (actuel && actuel.a !== undefined) ra.value = actuel.a;
      function appliqueC() {
        var spec = {};
        if (rde.value !== '') spec.de = parseInt(rde.value, 10);
        if (ra.value !== '') spec.a = parseInt(ra.value, 10);
        majFiltre(col.id, Object.keys(spec).length ? spec : null);
      }
      td.appendChild(rde); td.appendChild(ra);
    }
    return td;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Rendu du tableau
  // ══════════════════════════════════════════════════════════════════════
  function formaterValeur(col, ligne) {
    var v = ligne[col.id];
    if (col.type === 'liste') return Array.isArray(v) ? v.join(', ') : (v === null || v === undefined ? '' : String(v));
    if (col.id === 'inscrit' || col.id === 'arbre_modifie' || col.id === 'interrompu') return v ? 'oui' : 'non';
    if (col.id === 'debut_run' || col.id === 'debut_test') return v ? String(v).replace('T', ' ').replace(/\.\d+Z$/, '') : '';
    if (v === null || v === undefined) return '';
    var s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    // une cellule n'affiche qu'un extrait : le message complet est dans le
    // panneau du test (un message de plusieurs Mo figeait le rendu)
    return s.length > 400 ? s.slice(0, 400) + '…' : s;
  }
  function rendreEntetes() {
    var thead = racine().querySelector('#hist-table thead');
    var lTitres = el('tr');
    etat.colonnes.forEach(function (id) {
      var col = PAR_ID[id]; if (!col) return;
      var ordre = ordreDe(id);
      var fleche = ordre === 'asc' ? ' ▲' : (ordre === 'desc' ? ' ▼' : '');
      lTitres.appendChild(el('th', { onclick: function (ev) { clicEntete(id, ev.shiftKey); } }, [col.label + fleche]));
    });
    var cle = etat.colonnes.join(',');
    var lFiltresExistante = thead.querySelector('tr.hist-filtres');
    if (etat.cleFiltres !== cle || !lFiltresExistante) {
      thead.innerHTML = '';
      thead.appendChild(lTitres);
      var lFiltres = el('tr', { class: 'hist-filtres' });
      etat.colonnes.forEach(function (id) { var col = PAR_ID[id]; if (col) lFiltres.appendChild(celluleFiltre(col)); });
      thead.appendChild(lFiltres);
      etat.cleFiltres = cle;
      return;
    }
    thead.replaceChild(lTitres, thead.firstChild);
    Array.prototype.forEach.call(lFiltresExistante.querySelectorAll('select[data-col]'), function (sel) {
      var col = PAR_ID[sel.getAttribute('data-col')];
      if (col) remplirOptions(sel, col);
    });
  }
  function rendreTable(lignes) {
    rendreEntetes();
    var corps = racine().querySelector('#hist-table tbody');
    corps.innerHTML = '';
    if (!lignes.length) {
      corps.appendChild(el('tr', {}, [el('td', { colspan: String(etat.colonnes.length || 1) }, ['(aucune ligne)'])]));
      return;
    }
    lignes.forEach(function (ligne) {
      if (!ligne || typeof ligne !== 'object') return;
      var tr = el('tr', { class: 'etat-' + (ligne.etat || '') });
      etat.colonnes.forEach(function (id) {
        var col = PAR_ID[id]; if (!col) return;
        var texte = formaterValeur(col, ligne);
        if (id === 'branche' && ligne.arbre_modifie) texte += ' ⚠';
        tr.appendChild(el('td', { title: texte }, [texte]));
      });
      // SPEC-BANC-039 : un clic sur une ligne ouvre le panneau du test, ce
      // run déjà sélectionné
      tr.addEventListener('click', function () {
        document.dispatchEvent(new CustomEvent('mc-historique-ligne', { detail: ligne }));
        ouvrirPanneauTest({ cle: ligne.cle, test: ligne.test, nom: ligne.nom, run: ligne.run });
      });
      corps.appendChild(tr);
    });
  }
  function rendrePagination() {
    var t = racine();
    var totalPages = Math.max(1, Math.ceil(etat.total / etat.taille));
    t.querySelector('#hist-page-info').textContent = etat.total + ' ligne(s) — page ' + etat.page + '/' + totalPages;
    t.querySelector('#hist-page-prec').disabled = etat.page <= 1;
    t.querySelector('#hist-page-suiv').disabled = etat.page >= totalPages;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Sélecteur de colonnes (mémorisé dans localStorage, SPEC-BANC-034)
  // ══════════════════════════════════════════════════════════════════════
  function rendreMenuColonnes() {
    var menu = document.getElementById('hist-colonnes-menu');
    menu.innerHTML = '';
    COLONNES.forEach(function (col) {
      var coche = etat.colonnes.indexOf(col.id) >= 0;
      var cb = el('input', { type: 'checkbox', onchange: function () {
        if (cb.checked) { if (etat.colonnes.indexOf(col.id) < 0) etat.colonnes.push(col.id); }
        else etat.colonnes = etat.colonnes.filter(function (id) { return id !== col.id; });
        sauverColonnes(etat.colonnes);
        rafraichir();
      } });
      cb.checked = coche;
      menu.appendChild(el('label', {}, [cb, ' ' + col.label]));
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Export CSV / HTML de la vue filtrée (SPEC-BANC-038) — produit PAR LE
  // SERVEUR (/tests/historique/export), colonnes affichées seulement, mêmes
  // filtres et tri : l'ancienne voie (une « page » d'un million de lignes,
  // captures et fiches comprises, remise en forme ici) téléchargeait plus de
  // 60 Mo de JSON et figeait l'onglet (SPEC-BANC-120).
  // ══════════════════════════════════════════════════════════════════════
  function telecharger(nom, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nom;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function exporterVue(format) {
    var p = parametresVue();
    p.set('format', format);
    p.set('colonnes', etat.colonnes.join(','));
    var info = racine().querySelector('#hist-page-info');
    fetch('/tests/historique/export?' + p.toString()).then(function (r) {
      if (!r.ok) return lireJSON(r);
      return r.blob();
    }).then(function (blob) {
      telecharger('historique.' + (format === 'csv' ? 'csv' : 'html'), blob);
    }).catch(function (e) {
      info.textContent = 'export impossible : ' + ((e && e.message) || e);
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Panneau « test » (SPEC-BANC-039, SPEC-BANC-121) : TOUS les passages d'un
  // test (identité stable, SPEC-BANC-119), du plus récent au plus ancien —
  // état, durée, commit, message complet, captures (registre ou cahier
  // local), lien vers le cahier. Le run cliqué est mis en avant.
  // ══════════════════════════════════════════════════════════════════════
  function urlImage(passage, capture) {
    if (!capture || !capture.image) return null;
    var nom = String(capture.image);
    if (passage.inscrit && /^[0-9a-f]{40}\.(jpg|jpeg|png|webp)$/.test(nom)) return '/tests/registre/images/' + nom;
    if (passage.dossierCahier) return '/tests/resultats/' + encodeURIComponent(passage.dossierCahier) + '/captures/' + encodeURIComponent(nom);
    return null;
  }
  function agrandir(src, legende) {
    var overlay = el('div', { class: 'overlay-vignette', onclick: function () { overlay.remove(); } },
      [el('img', { src: src }), el('div', { class: 'legende' }, [legende || ''])]);
    document.body.appendChild(overlay);
  }
  function blocMessage(texte) {
    var s = String(texte);
    var LIM = 4000;
    var pre = el('pre', { class: 'hist-message' }, [s.length > LIM ? s.slice(0, LIM) + '\n… (' + (s.length - LIM) + ' caractères de plus)' : s]);
    if (s.length > LIM) {
      var b = el('button', { type: 'button', onclick: function () { pre.textContent = s; b.remove(); } }, ['tout afficher']);
      return el('div', {}, [pre, b]);
    }
    return pre;
  }
  function fermerPanneauTest() {
    var p = document.getElementById('hist-panneau-test');
    if (p) p.hidden = true;
  }
  function ouvrirPanneauTest(o) {
    var p = document.getElementById('hist-panneau-test');
    if (!p || !o || (!o.cle && !o.test)) return;
    var zone = racine();
    if (zone && zone.hidden) ouvrir();
    p.hidden = false;
    p.innerHTML = '';
    var corps = el('div', { class: 'hist-pt-corps' }, ['chargement de l\'historique du test…']);
    p.appendChild(el('div', { class: 'hist-pt-barre' }, [
      el('strong', {}, [o.nom || o.cle || o.test]),
      el('span', { class: 'hist-spacer' }),
      el('button', { type: 'button', onclick: function () { filtrerSurTest(o); } }, ['Filtrer le tableau sur ce test']),
      el('button', { type: 'button', id: 'hist-pt-fermer', onclick: fermerPanneauTest }, ['Fermer ✕']),
    ]));
    p.appendChild(corps);
    var q = new URLSearchParams();
    q.set('test', o.cle || o.test);
    fetch('/tests/historique/images?' + q.toString()).then(lireJSON).then(function (data) {
      var passages = (Array.isArray(data.images) ? data.images : []).slice().reverse();
      corps.innerHTML = '';
      if (!passages.length) { corps.appendChild(el('p', {}, ['Aucun passage de ce test dans l\'historique (registre et cahiers locaux).'])); return; }
      var dernier = passages[0];
      var f = dernier.fiche || {};
      var ent = el('div', { class: 'hist-pt-identite' }, [
        el('div', {}, ['Identité : ' + (dernier.cle || '') + ' · id ' + (dernier.test || '—') + ' · type ' + (dernier.type || '—')]),
        f.teste ? el('div', {}, ['Teste : ' + f.teste]) : null,
        f.attendu ? el('div', {}, ['Attendu : ' + f.attendu]) : null,
        el('div', {}, [passages.length + ' passage(s) — ' + passages.filter(function (x) { return x.etat === 'echec'; }).length + ' en échec']),
      ]);
      corps.appendChild(ent);
      var liste = el('ol', { class: 'hist-pt-passages' });
      var cible = null;
      passages.forEach(function (pa) {
        var captures = Array.isArray(pa.captures) ? pa.captures : [];
        var li = el('li', { class: 'etat-' + (pa.etat || '') + (pa.run === o.run ? ' hist-pt-courant' : '') }, [
          el('div', { class: 'hist-pt-tete' }, [
            String(pa.debut_run || '').replace('T', ' ').replace(/\.\d+Z$/, '') + ' · ' + (pa.preset || '—') +
            ' · ' + (pa.commit_court || '—') + (pa.sujet_commit ? ' « ' + pa.sujet_commit + ' »' : '') +
            ' · ' + (pa.etat || '?') + ' · ' + (typeof pa.duree_ms === 'number' ? Math.round(pa.duree_ms) + ' ms' : '—') +
            (pa.inscrit ? ' · inscrit' : ' · local'),
            pa.dossierCahier ? el('a', { href: '/tests/resultats/' + encodeURIComponent(pa.dossierCahier) + '/rapport.html', target: '_blank', class: 'hist-pt-lien' }, ['cahier']) : null,
          ]),
          pa.erreur ? blocMessage(pa.erreur) : null,
          pa.raison ? el('div', { class: 'hist-pt-raison' }, ['Raison : ' + pa.raison]) : null,
        ]);
        if (captures.length) {
          var vign = el('div', { class: 'vignettes' });
          var tripletsNonGardes = 0;
          captures.forEach(function (c) {
            var src = urlImage(pa, c);
            var leg = (c.role || '') + (c.libelle ? ' — ' + c.libelle : '');
            // le registre ne garde que l'image centrale d'un triplet
            // (SPEC-BANC-083) : les autres sont normales, pas « manquantes »
            if (!src && c.role === 'triplet') { tripletsNonGardes++; return; }
            if (!src) { vign.appendChild(el('span', { class: 'hist-pt-sans-image' }, ['(' + leg + ' : image absente)'])); return; }
            var img = el('img', { src: src, title: leg, class: 'vignette', loading: 'lazy' });
            img.addEventListener('click', function () { agrandir(src, leg); });
            img.addEventListener('error', function () { img.replaceWith(el('span', { class: 'hist-pt-sans-image' }, ['(' + leg + ' : image introuvable — cahier local effacé ?)'])); });
            vign.appendChild(img);
          });
          if (tripletsNonGardes) vign.appendChild(el('span', { class: 'hist-pt-sans-image' }, ['(' + tripletsNonGardes + ' image(s) de triplet non conservée(s) au registre)']));
          li.appendChild(vign);
        }
        if (pa.run === o.run) cible = li;
        liste.appendChild(li);
      });
      corps.appendChild(liste);
      if (cible && cible.scrollIntoView) cible.scrollIntoView({ block: 'nearest' });
    }).catch(function (e) {
      corps.innerHTML = '';
      corps.appendChild(el('p', { class: 'hist-erreur' }, ['Erreur : ' + ((e && e.message) || e)]));
    });
  }
  function filtrerSurTest(o) {
    etat.filtresColonnes = {};
    if (o.cle) {
      etat.filtresColonnes.cle = o.cle;
      if (etat.colonnes.indexOf('nom') < 0) etat.colonnes = ['nom'].concat(etat.colonnes);
    } else if (o.test) {
      etat.filtresColonnes.test = o.test;
      if (etat.colonnes.indexOf('test') < 0) etat.colonnes = ['test'].concat(etat.colonnes);
    }
    etat.rapide = 'tous';
    etat.page = 1;
    etat.cleFiltres = null; // la ligne de filtres doit refléter le nouveau filtre
    var cb = document.getElementById('hist-rapide-inscrits');
    if (cb) cb.checked = false;
    rafraichir();
  }

  // ══════════════════════════════════════════════════════════════════════
  // Ouverture / fermeture (SPEC-BANC-033) — un clic sur « historique » d'un
  // test dans la sélection (tests/banc-ui.js) appelle `ouvrir({ cle })` :
  // tableau filtré sur ce test (identité exacte, jamais « contient ») et
  // panneau du test ouvert. `ouvrir({ test: id })` reste accepté (filtre
  // « contient » sur l'id catalogue, partagé par les tests d'une même SPEC).
  // ══════════════════════════════════════════════════════════════════════
  function ouvrir(opts) {
    var o = opts || {};
    racine().hidden = false;
    if (o.cle || o.test) filtrerSurTest(o);
    document.getElementById('hist-rapide-inscrits').checked = etat.rapide === 'inscrits';
    rendreMenuColonnes();
    if (!(o.cle || o.test)) rafraichir();
    if (o.cle) ouvrirPanneauTest({ cle: o.cle, nom: o.nom, run: o.run });
  }
  function fermer() { racine().hidden = true; fermerPanneauTest(); }

  function initialiser() {
    var t = racine();
    if (!t) return; // page sans zone Historique (ne devrait pas arriver, tests/index.html la déclare toujours)
    document.getElementById('btn-historique').addEventListener('click', function () { ouvrir(); });
    document.getElementById('hist-fermer').addEventListener('click', fermer);
    document.getElementById('hist-page-prec').addEventListener('click', function () { if (etat.page > 1) { etat.page--; rafraichir(); } });
    document.getElementById('hist-page-suiv').addEventListener('click', function () { etat.page++; rafraichir(); });
    document.getElementById('hist-taille').addEventListener('change', function (ev) { etat.taille = parseInt(ev.target.value, 10) || 50; etat.page = 1; rafraichir(); });
    document.getElementById('hist-rapide-inscrits').addEventListener('change', function (ev) { etat.rapide = ev.target.checked ? 'inscrits' : 'tous'; etat.page = 1; rafraichir(); });
    Array.prototype.forEach.call(t.querySelectorAll('[data-rapide]'), function (btn) {
      btn.addEventListener('click', function () {
        etat.rapide = btn.getAttribute('data-rapide');
        document.getElementById('hist-rapide-inscrits').checked = etat.rapide === 'inscrits';
        etat.page = 1; rafraichir();
      });
    });
    document.getElementById('hist-colonnes-btn').addEventListener('click', function () {
      var menu = document.getElementById('hist-colonnes-menu');
      menu.hidden = !menu.hidden;
    });
    document.getElementById('hist-export-csv').addEventListener('click', function () { exporterVue('csv'); });
    document.getElementById('hist-export-html').addEventListener('click', function () { exporterVue('html'); });
    rendreMenuColonnes();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialiser);
  else initialiser();

  G.MC_HISTORIQUE = { ouvrir: ouvrir, fermer: fermer, ouvrirTest: ouvrirPanneauTest, etat: etat };
})(typeof window !== 'undefined' ? window : this);
