/* historique.js — interface de la zone « Historique global » (SPEC-BANC-033
   à 040, docs/banc/historique-global.md §3.1). Client pur des routes
   `/tests/historique/*` de server.js (toute la logique de tri/filtre/
   pagination vit côté serveur, tools/historique.js — voir son en-tête et
   tests/spec-historique.js) : ce fichier ne fait qu'afficher, construire les
   requêtes et gérer les interactions (SPEC-BANC-035/036/037/038). Chargé
   après banc-ui.js (tests/index.html), même style (IIFE sur `window`/`self`,
   pas de dépendance npm). */
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
      return Array.isArray(l) && l.length ? l.filter(function (id) { return PAR_ID[id]; }) : colonnesParDefaut();
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
  };

  function racine() { return document.getElementById('zone-historique'); }

  // ══════════════════════════════════════════════════════════════════════
  // Requêtes serveur (SPEC-BANC-040)
  // ══════════════════════════════════════════════════════════════════════
  function urlLignes(opts) {
    var o = opts || {};
    var p = new URLSearchParams();
    var champs = etat.tris.map(function (t) { return t.champ; });
    var ordres = etat.tris.map(function (t) { return t.ordre; });
    if (champs.length) { p.set('tri', champs.join(',')); p.set('ordre', ordres.join(',')); }
    p.set('filtre', JSON.stringify(etat.filtresColonnes));
    p.set('rapide', etat.rapide);
    p.set('page', String(o.page || etat.page));
    p.set('taille', String(o.taille || etat.taille));
    return '/tests/historique/lignes?' + p.toString();
  }

  function rafraichir() {
    var t = racine();
    if (!t || t.hidden) return;
    fetch(urlLignes()).then(function (r) { return r.json(); }).then(function (data) {
      etat.effectifs = data.effectifs || {};
      etat.total = data.total || 0;
      etat.page = data.page || etat.page;
      rendreTable(data.lignes || []);
      rendrePagination();
    }).catch(function (e) {
      var corps = t.querySelector('#hist-table tbody');
      if (corps) corps.innerHTML = '<tr><td colspan="99">Erreur : ' + echappe(e.message) + '</td></tr>';
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
  // le type déclaré dans COLONNES (miroir d'affichage de TYPES_COLONNES
  // côté serveur, qui reste la seule source de vérité pour l'application
  // effective du filtre).
  // ══════════════════════════════════════════════════════════════════════
  function majFiltre(id, spec) {
    if (spec === null) delete etat.filtresColonnes[id];
    else etat.filtresColonnes[id] = spec;
    etat.page = 1; rafraichir();
  }
  function celluleFiltre(col) {
    var td = el('td');
    if (col.type === 'texte') {
      var inp = el('input', { type: 'text', placeholder: 'contient…', oninput: function () { majFiltre(col.id, inp.value || null); } });
      td.appendChild(inp);
    } else if (col.type === 'enum' || col.type === 'liste') {
      var sel = el('select', { multiple: 'multiple', size: '1', onchange: function () {
        var vals = Array.from(sel.selectedOptions).map(function (o) { return o.value; });
        majFiltre(col.id, vals.length ? vals : null);
      } });
      (etat.effectifs[col.id] || []).forEach(function (e) {
        sel.appendChild(el('option', { value: String(e.valeur) }, [String(e.valeur) + ' (' + e.effectif + ')']));
      });
      td.appendChild(sel);
    } else if (col.type === 'nombre') {
      var min = el('input', { type: 'number', placeholder: 'min', style: 'width:48%', oninput: appliquer });
      var max = el('input', { type: 'number', placeholder: 'max', style: 'width:48%', oninput: appliquer });
      function appliquer() {
        var spec = {};
        if (min.value !== '') spec.min = parseFloat(min.value);
        if (max.value !== '') spec.max = parseFloat(max.value);
        majFiltre(col.id, Object.keys(spec).length ? spec : null);
      }
      td.appendChild(min); td.appendChild(max);
    } else if (col.type === 'horodatage') {
      var de = el('input', { type: 'date', style: 'width:48%', onchange: appliqueD });
      var a = el('input', { type: 'date', style: 'width:48%', onchange: appliqueD });
      function appliqueD() {
        var spec = {};
        if (de.value) spec.de = de.value;
        if (a.value) spec.a = a.value;
        majFiltre(col.id, Object.keys(spec).length ? spec : null);
      }
      td.appendChild(de); td.appendChild(a);
    } else if (col.type === 'commit') {
      var rde = el('input', { type: 'number', placeholder: 'de', style: 'width:48%', onchange: appliqueC });
      var ra = el('input', { type: 'number', placeholder: 'à', style: 'width:48%', onchange: appliqueC });
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
    if (col.type === 'liste') return (v || []).join(', ');
    if (col.id === 'inscrit' || col.id === 'arbre_modifie' || col.id === 'interrompu') return v ? 'oui' : 'non';
    if (col.id === 'debut_run' || col.id === 'debut_test') return v ? String(v).replace('T', ' ').replace(/\.\d+Z$/, '') : '';
    return v === null || v === undefined ? '' : String(v);
  }
  function rendreEntetes() {
    var thead = racine().querySelector('#hist-table thead');
    thead.innerHTML = '';
    var lTitres = el('tr');
    etat.colonnes.forEach(function (id) {
      var col = PAR_ID[id]; if (!col) return;
      var ordre = ordreDe(id);
      var fleche = ordre === 'asc' ? ' ▲' : (ordre === 'desc' ? ' ▼' : '');
      lTitres.appendChild(el('th', { onclick: function (ev) { clicEntete(id, ev.shiftKey); } }, [col.label + fleche]));
    });
    thead.appendChild(lTitres);
    var lFiltres = el('tr', { class: 'hist-filtres' });
    etat.colonnes.forEach(function (id) { var col = PAR_ID[id]; if (col) lFiltres.appendChild(celluleFiltre(col)); });
    thead.appendChild(lFiltres);
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
      var tr = el('tr', { class: 'etat-' + (ligne.etat || '') });
      etat.colonnes.forEach(function (id) {
        var col = PAR_ID[id]; if (!col) return;
        var texte = formaterValeur(col, ligne);
        if (id === 'branche' && ligne.arbre_modifie) texte += ' ⚠';
        tr.appendChild(el('td', { title: texte }, [texte]));
      });
      tr.addEventListener('click', function () { document.dispatchEvent(new CustomEvent('mc-historique-ligne', { detail: ligne })); });
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
  // Export CSV / HTML de la vue filtrée (SPEC-BANC-038) — mêmes colonnes
  // affichées, mêmes filtres et tri ; une seule requête serveur avec une
  // grande taille de page plutôt que de reconstruire le filtrage côté
  // client (le serveur reste la seule source de vérité sur ce que « la vue
  // filtrée courante » contient réellement).
  // ══════════════════════════════════════════════════════════════════════
  function telecharger(nom, type, contenu) {
    var blob = new Blob([contenu], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nom;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function celluleCsv(v) {
    var s = String(v === undefined || v === null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exporterVue(format) {
    fetch(urlLignes({ page: 1, taille: 1000000 })).then(function (r) { return r.json(); }).then(function (data) {
      var lignes = data.lignes || [];
      var cols = etat.colonnes.map(function (id) { return PAR_ID[id]; }).filter(Boolean);
      if (format === 'csv') {
        var texte = cols.map(function (c) { return celluleCsv(c.label); }).join(',') + '\n' +
          lignes.map(function (l) { return cols.map(function (c) { return celluleCsv(formaterValeur(c, l)); }).join(','); }).join('\n');
        telecharger('historique.csv', 'text/csv;charset=utf-8', texte);
      } else {
        var thead = '<tr>' + cols.map(function (c) { return '<th>' + echappe(c.label) + '</th>'; }).join('') + '</tr>';
        var tbody = lignes.map(function (l) {
          return '<tr>' + cols.map(function (c) { return '<td>' + echappe(formaterValeur(c, l)) + '</td>'; }).join('') + '</tr>';
        }).join('');
        var page = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Historique global</title>' +
          '<style>body{font:13px ui-monospace,Menlo,Consolas,monospace;background:#0b0e13;color:#e8eaed;padding:16px;}' +
          'table{border-collapse:collapse;width:100%;} th,td{border:1px solid #333;padding:4px 8px;text-align:left;}</style>' +
          '</head><body><h1>Historique global — ' + lignes.length + ' ligne(s)</h1><table><thead>' + thead + '</thead><tbody>' + tbody + '</tbody></table></body></html>';
        telecharger('historique.html', 'text/html;charset=utf-8', page);
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Ouverture / fermeture (SPEC-BANC-033) — un clic sur un test dans la
  // sélection appelle `ouvrir({ test: id })`, déjà filtré sur ce test.
  // ══════════════════════════════════════════════════════════════════════
  function ouvrir(opts) {
    var o = opts || {};
    if (o.test) {
      etat.filtresColonnes.test = o.test;
      etat.rapide = 'tous';
      if (etat.colonnes.indexOf('test') < 0) etat.colonnes = ['test'].concat(etat.colonnes);
    }
    racine().hidden = false;
    document.getElementById('hist-rapide-inscrits').checked = etat.rapide === 'inscrits';
    rendreMenuColonnes();
    rafraichir();
  }
  function fermer() { racine().hidden = true; }

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

  G.MC_HISTORIQUE = { ouvrir: ouvrir, fermer: fermer };
})(typeof window !== 'undefined' ? window : this);
