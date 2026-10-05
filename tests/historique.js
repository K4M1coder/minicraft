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
    { id: 'run', label: 'Run', type: 'texte', defaut: false },
    { id: 'debut_run', label: 'Début run', type: 'horodatage', defaut: true },
    { id: 'commit', label: 'Commit (sha)', type: 'texte', defaut: false },
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
    { id: 'raison', label: 'Raison', type: 'texte', defaut: false },     // états ignore et avertissement (SPEC-BANC-089)
    { id: 'nb_captures', label: 'Captures', type: 'nombre', defaut: false },
    { id: 'captures', label: 'Images (libellés)', type: 'texte', defaut: false },
    { id: 'fiche', label: 'Fiche', type: 'texte', defaut: false },
    { id: 'motif', label: 'Motif', type: 'texte', defaut: true },
    { id: 'arbre_modifie', label: 'Arbre modifié', type: 'enum', defaut: false },
    { id: 'interrompu', label: 'Interrompu', type: 'enum', defaut: false },
    // périmètre d'exécution (SPEC-BANC-070/076)
    { id: 'perimetre', label: 'Périmètre', type: 'enum', defaut: true },
    { id: 'raison_selection', label: 'Raison de sélection', type: 'liste', defaut: false },
    { id: 'trou_perimetre', label: 'Trou de périmètre', type: 'enum', defaut: false },
    // score d'instabilité (SPEC-BANC-088) : alternances réussite/échec sans changement de ce que le test touche
    { id: 'instabilite', label: 'Instabilité', type: 'nombre', defaut: false },
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
    corps.appendChild(el('tr', { class: classe || '' }, [el('td', { colspan: String(etat.colonnes.length + 1) }, [texte])]));
  }

  function rafraichir() {
    var t = racine();
    if (!t || t.hidden) return;
    var monSeq = ++etat.seq;
    t.querySelector('#hist-page-info').textContent = 'chargement…';
    rafraichirGraphes();
    var panneauTest = document.getElementById('hist-panneau-test');
    if (panneau.o && panneauTest && !panneauTest.hidden) chargerPanneau();
    fetch(urlLignes()).then(lireJSON).then(function (data) {
      if (monSeq !== etat.seq) return; // réponse périmée : une requête plus récente est partie
      etat.effectifs = data.effectifs || {};
      etat.total = data.total || 0;
      etat.page = data.page || etat.page;
      if (data.taille) etat.taille = data.taille;
      rendreTable(Array.isArray(data.lignes) ? data.lignes : []);
      rendrePagination();
      rafraichirRepartition();
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
    if (col.id === 'trou_perimetre') return v ? 'oui ⚠' : 'non';
    if (col.id === 'fiche') return v && typeof v === 'object' ? [v.teste, v.attendu].filter(Boolean).join(' — ') : '';
    if (col.id === 'captures') return (Array.isArray(v) ? v : []).map(function (c) { return (c.role || '') + (c.libelle ? ':' + c.libelle : ''); }).join(', ');
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
    lTitres.appendChild(el('th', { class: 'hist-th-action', title: 'actions sur la ligne' }, ['Action']));
    var cle = etat.colonnes.join(',');
    var lFiltresExistante = thead.querySelector('tr.hist-filtres');
    if (etat.cleFiltres !== cle || !lFiltresExistante) {
      thead.innerHTML = '';
      thead.appendChild(lTitres);
      var lFiltres = el('tr', { class: 'hist-filtres' });
      etat.colonnes.forEach(function (id) { var col = PAR_ID[id]; if (col) lFiltres.appendChild(celluleFiltre(col)); });
      lFiltres.appendChild(el('th'));
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
      corps.appendChild(el('tr', {}, [el('td', { colspan: String(etat.colonnes.length + 1) }, ['(aucune ligne)'])]));
      return;
    }
    lignes.forEach(function (ligne) {
      if (!ligne || typeof ligne !== 'object') return;
      var tr = el('tr', { class: 'etat-' + (ligne.etat || '') });
      etat.colonnes.forEach(function (id) {
        var col = PAR_ID[id]; if (!col) return;
        var texte = formaterValeur(col, ligne);
        // SPEC-BANC-058 : le code testé n'est pas exactement ce commit — avertissement visible
        if (id === 'commit_court' && ligne.arbre_modifie) texte += ' ⚠ arbre modifié';
        if (id === 'branche' && ligne.arbre_modifie) texte += ' ⚠';
        // SPEC-BANC-076 : un échec que le périmètre du commit n'aurait pas retenu
        if (id === 'etat' && ligne.trou_perimetre) texte += ' ⚠ trou de périmètre';
        tr.appendChild(el('td', { title: texte }, [texte]));
      });
      if (ligne.arbre_modifie) tr.className += ' arbre-modifie';
      // SPEC-BANC-057 : promouvoir après coup un run encore présent dans les cahiers locaux
      var celluleAction = el('td', { class: 'hist-td-action' });
      if (!ligne.inscrit && ligne.dossierCahier) celluleAction.appendChild(creerInscription(ligne.dossierCahier, { apres: rafraichir }));
      celluleAction.addEventListener('click', function (ev) { ev.stopPropagation(); });
      tr.appendChild(celluleAction);
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
  // Répartition (SPEC-BANC-064) : pour la vue filtrée courante et la dimension
  // choisie (catégorie, domaine, spec, fonction, étiquette — ou raison, qui
  // compte les ignorés et avertissements par motif), un tableau et un graphique
  // en barres : nombre de tests, réussis, échecs, ignorés, avertissements,
  // durée cumulée. Calculé par le serveur (tools/repartition.js) sur les mêmes
  // filtres que le tableau ; un clic sur une barre filtre le tableau principal
  // sur cette valeur. Le panneau suit en permanence la vue filtrée.
  // ══════════════════════════════════════════════════════════════════════
  var DIMENSIONS_REPARTITION = [
    ['categorie', 'Catégorie'], ['domaine', 'Domaine'], ['spec', 'Spec'],
    ['fonction', 'Fonction'], ['etiquette', 'Étiquette'], ['raison', 'Raison'],
  ];
  etat.repartition = { ouvert: false, dimension: 'domaine', seq: 0 };
  function panneauRepartition() { return document.getElementById('hist-repartition'); }
  function dureeLisible(ms) {
    if (typeof ms !== 'number') return '—';
    return ms >= 1000 ? (ms / 1000).toFixed(1).replace('.', ',') + ' s' : Math.round(ms) + ' ms';
  }
  function urlRepartition() {
    var p = parametresVue();
    p.set('dimension', etat.repartition.dimension);
    return '/tests/historique/repartition?' + p.toString();
  }
  function basculerRepartition(ouvert) {
    etat.repartition.ouvert = ouvert === undefined ? !etat.repartition.ouvert : !!ouvert;
    var p = panneauRepartition();
    if (p) p.hidden = !etat.repartition.ouvert;
    if (etat.repartition.ouvert) rafraichirRepartition();
  }
  function choisirDimension(dim) {
    etat.repartition.dimension = dim;
    rafraichirRepartition();
  }
  function rafraichirRepartition() {
    var p = panneauRepartition();
    if (!p || !etat.repartition.ouvert) return;
    var moi = ++etat.repartition.seq;
    fetch(urlRepartition()).then(lireJSON).then(function (data) {
      if (moi !== etat.repartition.seq) return;     // réponse périmée
      rendreRepartition(data);
    }).catch(function (e) {
      if (moi !== etat.repartition.seq) return;
      p.innerHTML = '';
      p.appendChild(el('p', { class: 'hist-erreur' }, ['Répartition impossible : ' + ((e && e.message) || e)]));
    });
  }
  // un clic sur une barre : le tableau principal est filtré sur cette valeur
  function filtrerSurValeur(champ, valeur) {
    var col = PAR_ID[champ];
    if (!col || valeur === null || valeur === undefined) return;
    etat.filtresColonnes[champ] = col.type === 'texte' || col.type === 'exact' ? String(valeur) : [String(valeur)];
    if (etat.colonnes.indexOf(champ) < 0) etat.colonnes = etat.colonnes.concat([champ]);   // le filtre reste visible
    etat.cleFiltres = null;      // la ligne de filtres reflète le nouveau filtre
    etat.page = 1;
    rafraichir();
  }
  function rendreRepartition(data) {
    var p = panneauRepartition();
    p.innerHTML = '';
    var sel = el('select', { id: 'hist-rep-dimension', 'aria-label': 'dimension de la répartition' });
    DIMENSIONS_REPARTITION.forEach(function (d) {
      var o = el('option', { value: d[0] }, [d[1]]);
      o.selected = d[0] === etat.repartition.dimension;
      sel.appendChild(o);
    });
    sel.addEventListener('change', function () { choisirDimension(sel.value); });
    p.appendChild(el('div', { class: 'hist-rep-barre-titre' }, [
      el('strong', {}, ['Répartition par ']), sel,
      el('span', { class: 'hist-spacer' }),
      el('span', {}, [(data.total || 0) + ' ligne(s) dans la vue filtrée']),
      el('button', { type: 'button', id: 'hist-rep-fermer', onclick: function () { basculerRepartition(false); } }, ['Fermer ✕']),
    ]));
    var groupes = Array.isArray(data.groupes) ? data.groupes : [];
    if (!groupes.length) { p.appendChild(el('p', {}, ['(aucune ligne dans la vue filtrée)'])); return; }
    var max = groupes.reduce(function (m, g) { return Math.max(m, g.nb || 0); }, 1);
    var tab = el('table', { class: 'hist-rep-table' });
    tab.appendChild(el('thead', {}, [el('tr', {}, ['Valeur', 'Tests', 'Réussis', 'Échecs', 'Ignorés', 'Avertissements', 'Durée cumulée', 'Répartition']
      .map(function (t) { return el('th', {}, [t]); }))]));
    var corps = el('tbody');
    groupes.forEach(function (g) {
      var libelle = g.valeur === null ? '(aucune)' : String(g.valeur);
      var barre = el('button', { type: 'button', class: 'hist-rep-barre', 'data-valeur': g.valeur === null ? '' : String(g.valeur),
        title: libelle + ' — cliquer pour filtrer le tableau', style: 'width:' + Math.max(2, Math.round(100 * g.nb / max)) + '%',
        onclick: function () { filtrerSurValeur(data.champ, g.valeur); } });
      [['reussi', 'hist-rep-reussi'], ['echec', 'hist-rep-echec'], ['ignore', 'hist-rep-ignore'], ['avertissement', 'hist-rep-avertissement']].forEach(function (c) {
        if (g[c[0]]) barre.appendChild(el('span', { class: c[1], style: 'flex-grow:' + g[c[0]], title: c[0] + ' : ' + g[c[0]] }));
      });
      var tr = el('tr', {}, [
        el('td', {}, [libelle]), el('td', {}, [String(g.nb)]), el('td', {}, [String(g.reussi)]), el('td', {}, [String(g.echec)]),
        el('td', {}, [String(g.ignore)]), el('td', {}, [String(g.avertissement)]), el('td', {}, [dureeLisible(g.duree_ms)]),
        el('td', { class: 'hist-rep-cellule-barre' }, [barre]),
      ]);
      corps.appendChild(tr);
    });
    tab.appendChild(corps);
    p.appendChild(tab);
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
  // ══════════════════════════════════════════════════════════════════════
  // Triplets d'images (SPEC-BANC-077 à 083) : à chaque bord d'une étape, trois
  // images consécutives. L'identité d'un triplet est (test, étape, debut|fin) ;
  // chacune de ses images a un rang 0-2 (SPEC-BANC-080). Dans l'historique, un
  // triplet est UNE image au sens des diaporamas (SPEC-BANC-048) et sa vignette
  // le montre EN BOUCLE, image par image : le clignotement est le mode le plus
  // sensible à l'œil pour un scintillement ou un tremblement.
  // ══════════════════════════════════════════════════════════════════════
  var CADENCE_CLIGNOTEMENT_MS = 120;     // environ 8 images par seconde
  var boucles = [];                       // minuteurs de clignotement en cours (arrêtés à la fermeture)
  function arreterBoucles() {
    boucles.forEach(function (b) { if (typeof clearInterval === 'function') clearInterval(b); });
    boucles = [];
  }
  /* Sépare les captures d'un passage : les images ordinaires d'un côté, les
     triplets de l'autre — un par (étape, bord), leurs images par rang. */
  function grouperTriplets(captures) {
    var autres = [], parCle = {}, triplets = [];
    (Array.isArray(captures) ? captures : []).forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      if (c.role !== 'triplet') { autres.push(c); return; }
      var k = String(c.etape) + '\u0000' + String(c.bord);
      if (!parCle[k]) { parCle[k] = { etape: c.etape, bord: c.bord, images: [] }; triplets.push(parCle[k]); }
      parCle[k].images.push(c);
    });
    triplets.forEach(function (t) { t.images.sort(function (a, b) { return (a.rang === null || a.rang === undefined ? 9 : a.rang) - (b.rang === null || b.rang === undefined ? 9 : b.rang); }); });
    return { autres: autres, triplets: triplets };
  }
  /* Une image qui parcourt `sources` en boucle (rang 0, 1, 2, 0, 1, 2…). Avec
     moins de deux images, elle reste fixe : le registre ne garde pas toujours le
     triplet complet. Le minuteur est repris par `arreterBoucles`. */
  function clignotement(sources, legende, cadenceMs) {
    var liste = (sources || []).filter(function (s) { return !!s; });
    var img = el('img', { src: liste[0] || '', title: legende || '', class: 'vignette hist-triplet', 'data-boucle': String(liste.length) });
    if (liste.length > 1 && typeof setInterval === 'function') {
      var i = 0;
      boucles.push(setInterval(function () { i = (i + 1) % liste.length; img.setAttribute('src', liste[i]); img.setAttribute('data-rang', String(i)); }, cadenceMs || CADENCE_CLIGNOTEMENT_MS));
    }
    img.setAttribute('data-rang', '0');
    return img;
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
  // ── état du panneau « test » et de ses diaporamas ────────────────────────
  /* SPEC-BANC-046 à 052 (docs/banc/historique-global.md §3.3) : le panneau
     montre les images de chaque run en VIGNETTES FIXES ; aucun diaporama
     n'existe tant qu'on n'a pas cliqué une vignette, et chaque clic n'ouvre
     que le diaporama de CETTE image, sur le run cliqué. Les modèles (positions,
     légendes, ordre des captures) sont purs : tests/historique-vues.js. */
  var panneau = { o: null, passages: [], temoins: {}, tri: 'lancement', diapos: [], sync: false, derniere: null, liste: null, seq: 0 };
  var VITESSES = [['lente', 1500], ['normale', 800], ['rapide', 300]];
  function vues() { return G.MC_HIST_VUES; }

  function arreterDiapo(d) {
    if (d.timerLecture) { clearInterval(d.timerLecture); d.timerLecture = null; }
    if (d.timerClignote) { clearInterval(d.timerClignote); d.timerClignote = null; }
  }
  function fermerDiapos() {
    panneau.diapos.forEach(arreterDiapo);
    panneau.diapos = []; panneau.sync = false; panneau.derniere = null; panneau.liste = null;
    var z = document.getElementById('hist-diapos');
    if (z) { z.innerHTML = ''; z.hidden = true; }
    var pt = document.getElementById('hist-panneau-test');
    if (pt) pt.className = '';
  }
  function fermerPanneauTest() {
    ++panneau.seq;
    arreterBoucles();
    fermerDiapos();
    var p = document.getElementById('hist-panneau-test');
    if (p) p.hidden = true;
  }

  function imageRegistre(image) { return typeof image === 'string' && /^[0-9a-f]{40}\.(jpg|jpeg|png|webp)$/.test(image); }

  function afficherTemoin(d) {
    var t = panneau.temoins[d.cle] || null;
    d.zoneTemoin.innerHTML = '';
    d.racine.setAttribute('data-temoin', t ? (t.epingle ? 'epingle' : 'derniere') : 'aucun');
    if (!t || !imageRegistre(t.image)) {
      d.zoneTemoin.appendChild(el('span', { class: 'hist-sans-temoin' }, ['Témoin : aucune capture inscrite de cette image']));
      return;
    }
    var src = '/tests/registre/images/' + t.image;
    var img = el('img', { src: src, class: 'vignette hist-temoin-img', title: 'témoin' });
    img.addEventListener('click', function () { agrandir(src, 'témoin · ' + (t.commit_court || '')); });
    d.zoneTemoin.appendChild(img);
    d.zoneTemoin.appendChild(el('span', { class: 'hist-temoin-legende' },
      ['Témoin ' + (t.epingle ? '(épinglé)' : '(dernière capture inscrite)') + ' · ' + (t.commit_court || '—')]));
  }

  /* Scène du diaporama : l'image courante ; en comparaison, le témoin
     superposé — rideau (le curseur révèle l'un ou l'autre) ou clignotement.
     Aucun diff automatique : un humain juge l'écart (SPEC-BANC-051). */
  function majScene(d) {
    var pos = d.positions[d.index];
    var pa = pos && pos.passage, cap = pos && pos.capture;
    var src = pa && cap ? urlImage(pa, cap) : null;
    var t = panneau.temoins[d.cle];
    var srcT = t && imageRegistre(t.image) ? '/tests/registre/images/' + t.image : null;
    if (d.timerClignote) { clearInterval(d.timerClignote); d.timerClignote = null; }
    if (src) { d.image.setAttribute('src', src); d.image.hidden = false; d.vide.hidden = true; }
    else { d.image.hidden = true; d.vide.hidden = false; d.vide.textContent = 'pas de capture'; }
    var comparaison = !!(d.comparer && src && srcT);
    d.racine.setAttribute('data-comparer', d.comparer ? d.mode : '');
    d.commandesComparer.hidden = !d.comparer;
    d.rideau.hidden = !(d.comparer && d.mode === 'rideau');
    if (d.comparer && !comparaison) {
      d.imageTemoin.hidden = true;
      d.message.textContent = !src ? 'comparaison impossible : pas de capture à ce run' : 'comparaison impossible : pas de témoin';
      return;
    }
    d.message.textContent = '';
    if (!comparaison) { d.imageTemoin.hidden = true; return; }
    d.imageTemoin.setAttribute('src', srcT);
    d.imageTemoin.hidden = false;
    if (d.mode === 'rideau') {
      d.imageTemoin.style.clipPath = 'inset(0 ' + (100 - parseInt(d.rideau.value, 10)) + '% 0 0)';
      d.imageTemoin.style.visibility = 'visible';
    } else {
      d.imageTemoin.style.clipPath = 'none';
      var visible = true;
      d.imageTemoin.style.visibility = 'visible';
      d.timerClignote = setInterval(function () { visible = !visible; d.imageTemoin.style.visibility = visible ? 'visible' : 'hidden'; }, 500);
    }
  }

  function afficherDiapo(d) {
    var V = vues();
    var pos = d.positions[d.index];
    var pa = pos && pos.passage, cap = pos && pos.capture;
    d.racine.setAttribute('data-run', pa ? pa.run : '');
    d.racine.setAttribute('data-index', String(d.index));
    d.racine.setAttribute('data-presente', cap ? '1' : '0');
    d.compteur.textContent = (d.index + 1) + '/' + d.positions.length;
    d.curseur.setAttribute('max', String(Math.max(0, d.positions.length - 1)));
    d.curseur.value = String(d.index);
    d.legende.textContent = pa ? V.legendePassage(pa) + (cap ? '' : ' · pas de capture') : '';
    d.legende.className = 'hist-diapo-legende etat-' + ((pa && pa.etat) || '');
    var epinglable = !!(pa && pa.inscrit && cap && imageRegistre(cap.image));
    d.btnEpingler.disabled = !epinglable;
    d.btnEpingler.title = epinglable ? 'épingler cette image comme témoin de ce test' : 'seule une capture inscrite au registre peut devenir témoin';
    majScene(d);
  }
  function allerA(d, i, deSync) {
    var V = vues();
    d.index = V.borner(i, d.positions.length);
    afficherDiapo(d);
    panneau.derniere = d;
    if (panneau.sync && !deSync) {
      var run = d.positions[d.index] && d.positions[d.index].passage.run;
      panneau.diapos.forEach(function (autre) {
        if (autre === d) return;
        var j = V.indexDuRun(autre.positions, run);
        if (j >= 0) { autre.index = j; afficherDiapo(autre); }
      });
    }
  }
  function synchroniser(actif) {
    panneau.sync = actif;
    var b = document.getElementById('hist-diapos-sync');
    if (b) { b.setAttribute('aria-pressed', actif ? 'true' : 'false'); b.textContent = actif ? 'Synchronisés ✓' : 'Synchroniser'; }
    if (actif && panneau.diapos.length) {
      var ref = panneau.derniere || panneau.diapos[0];
      allerA(ref, ref.index);
    }
  }
  function lecture(d, actif) {
    if (d.timerLecture) { clearInterval(d.timerLecture); d.timerLecture = null; }
    d.racine.setAttribute('data-lecture', actif ? '1' : '0');
    d.btnLecture.textContent = actif ? '⏸ Pause' : '▶ Lecture';
    if (!actif) return;
    var ms = VITESSES[parseInt(d.vitesse.value, 10)] ? VITESSES[parseInt(d.vitesse.value, 10)][1] : 800;
    d.timerLecture = setInterval(function () {
      if (d.index >= d.positions.length - 1) { lecture(d, false); return; }
      allerA(d, d.index + 1);
    }, ms);
  }
  function epinglerTemoin(d) {
    var pos = d.positions[d.index];
    var pa = pos && pos.passage, cap = pos && pos.capture;
    if (!pa || !cap) return;
    var monSeq = panneau.seq;
    d.message.textContent = 'épinglage…';
    fetch('/tests/registre/temoin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: pa.cle, commit: pa.commit, image: cap.image, cle_image: d.cle }),
    }).then(lireJSON).then(function () {
      if (monSeq !== panneau.seq) return;
      panneau.temoins[d.cle] = { epingle: true, run: pa.run, commit: pa.commit, commit_court: pa.commit_court, image: cap.image };
      panneau.diapos.forEach(function (autre) { if (autre.cle === d.cle) { afficherTemoin(autre); majScene(autre); } });
      d.message.textContent = 'témoin épinglé';
    }).catch(function (e) { d.message.textContent = 'épinglage impossible : ' + ((e && e.message) || e); });
  }

  function preparerZoneDiapos() {
    var zone = document.getElementById('hist-diapos');
    if (!zone) return null;
    zone.hidden = false;
    var pt = document.getElementById('hist-panneau-test');
    if (pt) pt.className = 'avec-diapos';   // le panneau gagne de la hauteur tant qu'un diaporama est ouvert
    if (!panneau.liste) {
      zone.innerHTML = '';
      var sync = el('button', { type: 'button', id: 'hist-diapos-sync', 'aria-pressed': 'false', title: 'aligner tous les diaporamas ouverts sur le même run', onclick: function () { synchroniser(!panneau.sync); } }, ['Synchroniser']);
      zone.appendChild(el('div', { class: 'hist-diapos-outils' }, [el('span', {}, ['Diaporamas ouverts']), sync]));
      panneau.liste = el('div', { id: 'hist-diapos-liste', class: 'hist-diapos-liste' });
      zone.appendChild(panneau.liste);
    }
    return panneau.liste;
  }
  function fermerUnDiapo(d) {
    arreterDiapo(d);
    panneau.diapos = panneau.diapos.filter(function (x) { return x !== d; });
    if (d.racine.parent && d.racine.parent.removeChild) d.racine.parent.removeChild(d.racine);
    else if (d.racine.remove) d.racine.remove();
    if (!panneau.diapos.length) fermerDiapos();
  }
  /* Ouvre le diaporama de l'image `cleImg` (rôle|libellé), sur le run `run`.
     Déjà ouvert : on le replace sur ce run, on n'en ouvre pas un second. */
  function ouvrirDiaporama(cleImg, run, capture) {
    var V = vues();
    var liste = preparerZoneDiapos();
    if (!liste) return null;
    var existant = panneau.diapos.filter(function (x) { return x.cle === cleImg; })[0];
    if (existant) { var k = V.indexDuRun(existant.positions, run); allerA(existant, k >= 0 ? k : existant.index); return existant; }
    var positions = V.positionsImage(panneau.passages, cleImg);
    var d = {
      cle: cleImg, role: capture ? capture.role : '', libelle: capture ? capture.libelle : '', positions: positions,
      index: Math.max(0, V.indexDuRun(positions, run)), timerLecture: null, timerClignote: null, comparer: false, mode: 'rideau',
    };
    d.compteur = el('span', { class: 'hist-diapo-compteur' });
    d.curseur = el('input', { type: 'range', min: '0', max: '0', value: '0', step: '1', class: 'hist-diapo-curseur', 'aria-label': 'position dans l\'historique de cette image' });
    d.curseur.addEventListener('input', function () { allerA(d, parseInt(d.curseur.value, 10) || 0); });
    d.image = el('img', { class: 'hist-diapo-image' });
    d.image.addEventListener('click', function () { if (d.image.getAttribute('src')) agrandir(d.image.getAttribute('src'), d.legende.textContent); });
    d.imageTemoin = el('img', { class: 'hist-diapo-image hist-diapo-superpose' });
    d.imageTemoin.hidden = true;
    d.vide = el('div', { class: 'hist-diapo-vide' }, ['pas de capture']);
    d.vide.hidden = true;
    d.scene = el('div', { class: 'hist-diapo-scene' }, [d.image, d.imageTemoin, d.vide]);
    d.legende = el('div', { class: 'hist-diapo-legende' });
    d.message = el('div', { class: 'hist-diapo-message', role: 'status' });
    d.zoneTemoin = el('div', { class: 'hist-diapo-temoin' });
    d.btnPrec = el('button', { type: 'button', class: 'hist-diapo-prec', title: 'run précédent (flèche gauche)', onclick: function () { allerA(d, d.index - 1); } }, ['◀']);
    d.btnSuiv = el('button', { type: 'button', class: 'hist-diapo-suiv', title: 'run suivant (flèche droite)', onclick: function () { allerA(d, d.index + 1); } }, ['▶']);
    d.btnLecture = el('button', { type: 'button', class: 'hist-diapo-lecture', onclick: function () { lecture(d, !d.timerLecture); } }, ['▶ Lecture']);
    d.vitesse = el('select', { class: 'hist-diapo-vitesse', title: 'vitesse de la lecture automatique', onchange: function () { if (d.timerLecture) lecture(d, true); } },
      VITESSES.map(function (v, i) { var o = el('option', { value: String(i) }, [v[0]]); if (i === 1) o.selected = true; return o; }));
    d.vitesse.value = '1';
    d.rideau = el('input', { type: 'range', min: '0', max: '100', value: '50', class: 'hist-diapo-rideau', 'aria-label': 'rideau : témoin à gauche, image courante à droite' });
    d.rideau.value = '50';
    d.rideau.addEventListener('input', function () { majScene(d); });
    d.rideau.hidden = true;
    d.selMode = el('select', { class: 'hist-diapo-mode', onchange: function () { d.mode = d.selMode.value; majScene(d); } }, [
      el('option', { value: 'rideau' }, ['rideau']), el('option', { value: 'clignotement' }, ['clignotement'])]);
    d.selMode.value = 'rideau';
    d.commandesComparer = el('span', { class: 'hist-diapo-comparer-cmd' }, [d.selMode, d.rideau]);
    d.commandesComparer.hidden = true;
    d.btnComparer = el('button', { type: 'button', class: 'hist-diapo-comparer', 'aria-pressed': 'false', title: 'superposer le témoin et l\'image courante', onclick: function () {
      d.comparer = !d.comparer;
      d.btnComparer.setAttribute('aria-pressed', d.comparer ? 'true' : 'false');
      majScene(d);
    } }, ['Comparer']);
    d.btnEpingler = el('button', { type: 'button', class: 'hist-diapo-epingler', onclick: function () { epinglerTemoin(d); } }, ['Épingler comme témoin']);
    var btnFermer = el('button', { type: 'button', class: 'hist-diapo-fermer', title: 'fermer ce diaporama', onclick: function () { fermerUnDiapo(d); } }, ['✕']);
    d.racine = el('div', { class: 'hist-diapo', tabindex: '0', 'data-image': cleImg, 'data-lecture': '0' }, [
      el('div', { class: 'hist-diapo-tete' }, [el('strong', {}, [(d.role || 'image') + (d.libelle ? ' — ' + d.libelle : '')]), el('span', { class: 'hist-spacer' }), btnFermer]),
      d.zoneTemoin, d.scene, d.legende,
      el('div', { class: 'hist-diapo-nav' }, [d.btnPrec, d.curseur, d.btnSuiv, d.compteur]),
      el('div', { class: 'hist-diapo-outils' }, [d.btnLecture, d.vitesse, d.btnComparer, d.commandesComparer, d.btnEpingler]),
      d.message,
    ]);
    d.racine.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowRight') { if (ev.preventDefault) ev.preventDefault(); allerA(d, d.index + 1); }
      else if (ev.key === 'ArrowLeft') { if (ev.preventDefault) ev.preventDefault(); allerA(d, d.index - 1); }
    });
    panneau.diapos.push(d);
    liste.appendChild(d.racine);
    afficherTemoin(d);
    afficherDiapo(d);
    panneau.derniere = d;
    if (panneau.sync) allerA(d, d.index);
    return d;
  }

  function vignettesDuPassage(pa, captures) {
    var V = vues();
    var vign = el('div', { class: 'vignettes' });
    var tripletsNonGardes = 0;
    var groupes = grouperTriplets(captures);
    groupes.triplets.forEach(function (t) {
      var srcs = t.images.map(function (c) { return urlImage(pa, c); });
      tripletsNonGardes += srcs.filter(function (s) { return !s; }).length;
      var presentes = srcs.filter(function (s) { return !!s; });
      if (!presentes.length) return;
      var leg = 'triplet ' + (t.etape || '?') + ' (' + (t.bord || '?') + ') — ' + presentes.length + ' image(s)' + (presentes.length > 1 ? ' en boucle' : ' : la centrale seule');
      var vt = clignotement(presentes, leg);
      vt.addEventListener('click', function () { agrandir(presentes[Number(vt.getAttribute('data-rang')) || 0] || presentes[0], leg); });
      vign.appendChild(vt);
    });
    V.ordonnerCaptures(groupes.autres).forEach(function (c) {
      var src = urlImage(pa, c);
      var leg = (c.role || '') + (c.libelle ? ' — ' + c.libelle : '');
      if (!src) { vign.appendChild(el('span', { class: 'hist-pt-sans-image' }, ['(' + leg + ' : image absente)'])); return; }
      // vignette FIXE (SPEC-BANC-046) ; un clic ouvre le diaporama de CETTE image (SPEC-BANC-047)
      var img = el('img', { src: src, title: leg + ' — cliquer pour ouvrir son historique', class: 'vignette', loading: 'lazy', 'data-image': V.cleImage(c), 'data-run': pa.run });
      img.addEventListener('click', function () { ouvrirDiaporama(V.cleImage(c), pa.run, c); });
      img.addEventListener('error', function () { img.replaceWith(el('span', { class: 'hist-pt-sans-image' }, ['(' + leg + ' : image introuvable — cahier local effacé ?)'])); });
      vign.appendChild(img);
    });
    if (tripletsNonGardes) vign.appendChild(el('span', { class: 'hist-pt-sans-image' }, ['(' + tripletsNonGardes + ' image(s) de triplet non conservée(s) au registre)']));
    return vign;
  }

  /* Filtres du tableau qui valent pour les diaporamas (SPEC-BANC-048) : les
     filtres de colonne posés par l'utilisateur, et le filtre rapide quand il
     restreint vraiment (échecs, lents). Ni l'identité du test ni le run
     cliqué (c'est ce qu'on parcourt), ni « inscrits seulement » : le panneau
     montre tous les passages du test (SPEC-BANC-121). */
  function parametresPanneau(o) {
    var q = new URLSearchParams();
    q.set('test', o.cle || o.test);
    q.set('tri', panneau.tri);
    var f = {};
    Object.keys(etat.filtresColonnes).forEach(function (k) { if (k !== 'cle' && k !== 'test' && k !== 'run') f[k] = etat.filtresColonnes[k]; });
    if (Object.keys(f).length) q.set('filtre', JSON.stringify(f));
    if (etat.rapide === 'echecs' || etat.rapide === 'lents') q.set('rapide', etat.rapide);
    return q;
  }
  function chargerPanneau() {
    var o = panneau.o;
    var corps = document.getElementById('hist-pt-corps');
    if (!o || !corps) return;
    var monSeq = ++panneau.seq;
    fetch('/tests/historique/images?' + parametresPanneau(o).toString()).then(lireJSON).then(function (data) {
      if (monSeq !== panneau.seq) return;
      var anciens = panneau.diapos.map(function (d) { return { cle: d.cle, role: d.role, libelle: d.libelle, run: d.positions[d.index] && d.positions[d.index].passage.run }; });
      arreterBoucles();
      fermerDiapos();
      panneau.passages = Array.isArray(data.images) ? data.images : [];
      panneau.temoins = data.temoins && typeof data.temoins === 'object' ? data.temoins : {};
      var passages = panneau.passages.slice().reverse();
      corps.innerHTML = '';
      if (!passages.length) { corps.appendChild(el('p', {}, ['Aucun passage de ce test dans l\'historique (registre et cahiers locaux).'])); return; }
      var dernier = passages[0];
      var f = dernier.fiche || {};
      corps.appendChild(el('div', { class: 'hist-pt-identite' }, [
        el('div', {}, ['Identité : ' + (dernier.cle || '') + ' · id ' + (dernier.test || '—') + ' · type ' + (dernier.type || '—')]),
        f.teste ? el('div', {}, ['Teste : ' + f.teste]) : null,
        f.attendu ? el('div', {}, ['Attendu : ' + f.attendu]) : null,
        el('div', {}, [passages.length + ' passage(s) — ' + passages.filter(function (x) { return x.etat === 'echec'; }).length + ' en échec']),
      ]));
      var liste = el('ol', { class: 'hist-pt-passages' });
      var cible = null;
      passages.forEach(function (pa) {
        var captures = Array.isArray(pa.captures) ? pa.captures : [];
        var li = el('li', { class: 'etat-' + (pa.etat || '') + (pa.run === o.run ? ' hist-pt-courant' : ''), 'data-run': pa.run }, [
          el('div', { class: 'hist-pt-tete' }, [
            String(pa.debut_run || '').replace('T', ' ').replace(/\.\d+Z$/, '') + ' · ' + (pa.preset || '—') +
            ' · ' + (pa.commit_court || '—') + (pa.sujet_commit ? ' « ' + pa.sujet_commit + ' »' : '') +
            ' · ' + (pa.etat || '?') + ' · ' + (typeof pa.duree_ms === 'number' ? Math.round(pa.duree_ms) + ' ms' : '—') +
            (pa.inscrit ? ' · inscrit' : ' · local'),
            pa.dossierCahier ? el('a', { href: '/tests/resultats/' + encodeURIComponent(pa.dossierCahier) + '/rapport.html', target: '_blank', class: 'hist-pt-lien' }, ['cahier']) : null,
          ]),
          pa.arbre_modifie ? el('div', { class: 'hist-pt-avertissement' }, ['⚠ arbre modifié : le code testé n\'est pas exactement ce commit']) : null,
          pa.motif ? el('div', { class: 'hist-pt-raison' }, ['Motif : ' + pa.motif]) : null,
          pa.erreur ? blocMessage(pa.erreur) : null,
          pa.raison ? el('div', { class: 'hist-pt-raison' }, ['Raison : ' + pa.raison]) : null,
          (!pa.inscrit && pa.dossierCahier) ? creerInscription(pa.dossierCahier, { apres: chargerPanneau }) : null,
        ]);
        if (captures.length) li.appendChild(vignettesDuPassage(pa, captures));
        if (pa.run === o.run) cible = li;
        liste.appendChild(li);
      });
      corps.appendChild(liste);
      if (cible && cible.scrollIntoView) cible.scrollIntoView({ block: 'nearest' });
      // un changement d'ordre ou de filtre garde ouverts les diaporamas déjà ouverts
      anciens.forEach(function (a) { ouvrirDiaporama(a.cle, a.run, { role: a.role, libelle: a.libelle }); });
    }).catch(function (e) {
      if (monSeq !== panneau.seq) return;
      arreterBoucles();
      corps.innerHTML = '';
      corps.appendChild(el('p', { class: 'hist-erreur' }, ['Erreur : ' + ((e && e.message) || e)]));
    });
  }
  function ouvrirPanneauTest(o) {
    var p = document.getElementById('hist-panneau-test');
    if (!p || !o || (!o.cle && !o.test)) return;
    var zone = racine();
    if (zone && zone.hidden) ouvrir();
    arreterBoucles();
    fermerDiapos();
    p.hidden = false;
    p.innerHTML = '';
    panneau.o = o; panneau.passages = []; panneau.temoins = {};
    var selTri = el('select', { id: 'hist-pt-tri', title: 'ordre des runs dans les diaporamas', onchange: function () { panneau.tri = selTri.value; chargerPanneau(); } }, [
      el('option', { value: 'lancement' }, ['ordre de lancement']), el('option', { value: 'commit' }, ['ordre des commits'])]);
    selTri.value = panneau.tri;
    p.appendChild(el('div', { class: 'hist-pt-barre' }, [
      el('strong', {}, [o.nom || o.cle || o.test]),
      el('span', { class: 'hist-spacer' }),
      el('label', {}, [selTri]),
      el('button', { type: 'button', onclick: function () { filtrerSurTest(o); } }, ['Filtrer le tableau sur ce test']),
      el('button', { type: 'button', id: 'hist-pt-fermer', onclick: fermerPanneauTest }, ['Fermer ✕']),
    ]));
    // la zone des diaporamas existe dès l'ouverture mais reste CACHÉE : aucun diaporama sans clic (SPEC-BANC-047)
    var zoneDiapos = el('div', { id: 'hist-diapos', class: 'hist-diapos' });
    zoneDiapos.hidden = true;
    p.appendChild(zoneDiapos);
    p.appendChild(el('div', { id: 'hist-pt-corps', class: 'hist-pt-corps' }, ['chargement de l\'historique du test…']));
    chargerPanneau();
  }
  function filtrerSurTest(o) {
    etat.filtresColonnes = {};
    if (o.cle) {
      etat.filtresColonnes.cle = o.cle;
      // la colonne du filtre est TOUJOURS visible (SPEC-BANC-122, revue) :
      // un filtre invisible bloquait la vue sur un seul test sans moyen de
      // le voir ni de l'effacer
      if (etat.colonnes.indexOf('cle') < 0) etat.colonnes = ['cle'].concat(etat.colonnes);
      if (etat.colonnes.indexOf('nom') < 0) etat.colonnes = ['nom'].concat(etat.colonnes);
    } else if (o.test) {
      etat.filtresColonnes.test = o.test;
      if (etat.colonnes.indexOf('test') < 0) etat.colonnes = ['test'].concat(etat.colonnes);
    }
    etat.rapide = 'tous';
    etat.page = 1;
    etat.filtreTest = true;  // vue « un test » : levée par « Tous les runs » ou une réouverture simple
    etat.cleFiltres = null; // la ligne de filtres doit refléter le nouveau filtre
    var cb = document.getElementById('hist-rapide-inscrits');
    if (cb) cb.checked = false;
    rafraichir();
  }

  // ══════════════════════════════════════════════════════════════════════
  // Inscrire au registre (SPEC-BANC-053 à 058, docs/banc/historique-global.md
  // §3.4) — un SEUL composant, partagé par le résumé de fin de campagne
  // (tests/banc-ui.js, via MC_INSCRIRE), les lignes du tableau et les
  // passages du panneau « test » : motif facultatif, bouton, retour visible.
  // La route (POST /tests/registre/inscrire) appelle la même fonction que
  // `node tools/registre.js inscrire` ; elle refuse une seconde inscription
  // du même cahier (409), message affiché tel quel.
  // ══════════════════════════════════════════════════════════════════════
  function creerInscription(dossier, opts) {
    var o = opts || {};
    var motif = el('input', { type: 'text', class: 'hist-inscrire-motif', maxlength: '200', placeholder: 'motif (facultatif)', 'aria-label': 'motif de l\'inscription au registre' });
    var msg = el('span', { class: 'hist-inscrire-msg', role: 'status' });
    var btn = el('button', { type: 'button', class: 'hist-inscrire-btn', 'data-dossier': dossier, 'data-inscrit': '0', title: 'promouvoir ce cahier local dans le registre versionné' }, ['Inscrire au registre']);
    var racineI = el('span', { class: 'hist-inscrire', 'data-dossier': dossier }, [motif, btn, msg]);
    var lien = null;
    btn.addEventListener('click', function (ev) {
      if (ev && ev.stopPropagation) ev.stopPropagation();
      btn.disabled = true;
      msg.className = 'hist-inscrire-msg';
      msg.textContent = 'inscription…';
      fetch('/tests/registre/inscrire', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dossier: dossier, motif: motif.value || undefined }),
      }).then(lireJSON).then(function (r) {
        btn.disabled = false;
        btn.textContent = 'Inscrit ✓';
        btn.setAttribute('data-inscrit', '1');
        motif.disabled = true;
        // SPEC-BANC-058 : le dépôt avait des modifications non commitées au moment de l'inscription
        if (r.arbre_modifie) { msg.className = 'hist-inscrire-msg hist-avertissement'; msg.textContent = ' ⚠ arbre modifié : le code testé n\'est pas exactement le commit ' + String(r.commit || '').slice(0, 10); }
        else msg.textContent = '';
        racineI.setAttribute('data-run', r.run || '');
        if (!lien) {
          lien = el('a', { href: '#', class: 'hist-inscrire-lien' }, ['voir dans l\'historique']);
          lien.addEventListener('click', function (ev2) { if (ev2.preventDefault) ev2.preventDefault(); ouvrir({ run: r.run }); });
          racineI.appendChild(lien);
        }
        if (o.apres) o.apres(r);
      }).catch(function (e) {
        btn.disabled = false;
        msg.className = 'hist-inscrire-msg hist-erreur';
        msg.textContent = ' ' + ((e && e.message) || String(e));
      });
    });
    return racineI;
  }
  G.MC_INSCRIRE = { creer: creerInscription };

  /* Filtre le tableau sur UN run (clic d'un point de graphique, lien « voir
     dans l'historique » après une inscription). Les autres filtres restent ;
     la colonne du filtre est TOUJOURS visible (comme pour un test, SPEC-BANC-122). */
  function filtrerSurRun(run, opts) {
    var o = opts || {};
    etat.filtresColonnes.run = String(run);
    if (etat.colonnes.indexOf('run') < 0) etat.colonnes = ['run'].concat(etat.colonnes);
    if (o.tous) {
      // vue ouverte après une inscription : le motif saisi doit se voir dans sa colonne (SPEC-BANC-055)
      if (etat.colonnes.indexOf('motif') < 0) etat.colonnes = etat.colonnes.concat(['motif']);
      etat.rapide = 'tous';
      var cb = document.getElementById('hist-rapide-inscrits');
      if (cb) cb.checked = false;
      etat.filtreTest = true;   // vue « un run » levée par « Tous les runs » ou une réouverture simple
    }
    etat.page = 1;
    etat.cleFiltres = null;
    rafraichir();
  }

  // ══════════════════════════════════════════════════════════════════════
  // Graphiques timeline (SPEC-BANC-041 à 045, §3.2) — SVG écrit à la main
  // (tests/historique-vues.js, pur et prouvé sous Node) ; les données sont
  // agrégées par le serveur (/tests/historique/series et /matrice) sur les
  // MÊMES filtres que le tableau, et redemandées à chaque changement de filtre.
  // ══════════════════════════════════════════════════════════════════════
  var graphes = { ouvert: false, props: ['etat'], axe: 'debut_run', matrice: false, seq: 0 };
  var PROPS_NUM = COLONNES.filter(function (c) { return c.type === 'nombre'; }).map(function (c) { return c.id; });

  function seuilLentMs() {
    var champ = document.getElementById('seuil-lent');
    var s = champ ? parseFloat(champ.value) : NaN;
    return isFinite(s) && s > 0 ? s * 1000 : 8000;
  }
  function cacherInfobulle() { var t = document.getElementById('hist-infobulle'); if (t) t.hidden = true; }
  function montrerInfobulle(texte, ev) {
    var t = document.getElementById('hist-infobulle');
    if (!t) return;
    t.textContent = texte;
    t.hidden = false;
    t.style.left = Math.min((ev.clientX || 0) + 14, (G.innerWidth || 1200) - 280) + 'px';
    t.style.top = ((ev.clientY || 0) + 14) + 'px';
  }
  function construireGraphes() {
    var z = document.getElementById('hist-graphes');
    if (!z) return;
    z.innerHTML = '';
    var barre = el('div', { class: 'hist-gr-barre' }, [el('strong', {}, ['Tracer'])]);
    [['etat', 'État']].concat(PROPS_NUM.map(function (id) { return [id, PAR_ID[id].label]; })).forEach(function (p) {
      var cb = el('input', { type: 'checkbox', 'data-prop': p[0], class: 'hist-gr-prop' });
      cb.checked = graphes.props.indexOf(p[0]) >= 0;
      cb.addEventListener('change', function () {
        graphes.props = graphes.props.filter(function (x) { return x !== p[0]; });
        if (cb.checked) graphes.props.push(p[0]);
        rafraichirGraphes();
      });
      barre.appendChild(el('label', {}, [cb, ' ' + p[1]]));
    });
    barre.appendChild(el('strong', { class: 'hist-gr-sep' }, ['Axe X']));
    [['debut_run', 'lancement'], ['rang_commit', 'commit']].forEach(function (a) {
      var r = el('input', { type: 'radio', name: 'hist-gr-axe', value: a[0], 'data-axe': a[0], class: 'hist-gr-axe' });
      r.checked = graphes.axe === a[0];
      r.addEventListener('change', function () { if (r.checked) { graphes.axe = a[0]; rafraichirGraphes(); } });
      barre.appendChild(el('label', {}, [r, ' ' + a[1]]));
    });
    var m = el('input', { type: 'checkbox', id: 'hist-gr-matrice', class: 'hist-gr-matrice' });
    m.checked = graphes.matrice;
    m.addEventListener('change', function () { graphes.matrice = m.checked; rafraichirGraphes(); });
    barre.appendChild(el('label', { class: 'hist-gr-sep' }, [m, ' vue matrice']));
    z.appendChild(barre);
    var corps = el('div', { id: 'hist-gr-corps', class: 'hist-gr-corps' });
    z.appendChild(corps);
    z.appendChild(el('div', { id: 'hist-infobulle', class: 'hist-infobulle', role: 'tooltip' }));
    var tip = document.getElementById('hist-infobulle'); if (tip) tip.hidden = true;
    // survol et clic délégués : chaque point porte data-tip / data-run (tests/historique-vues.js)
    function cible(ev, attr) {
      var n = ev.target;
      while (n && n.getAttribute && n !== corps) { if (n.getAttribute(attr) !== null) return n; n = n.parentNode; }
      return null;
    }
    corps.addEventListener('mouseover', function (ev) { var n = cible(ev, 'data-tip'); if (n) montrerInfobulle(n.getAttribute('data-tip'), ev); else cacherInfobulle(); });
    corps.addEventListener('mousemove', function (ev) { var n = cible(ev, 'data-tip'); if (n) montrerInfobulle(n.getAttribute('data-tip'), ev); });
    corps.addEventListener('mouseleave', cacherInfobulle);
    corps.addEventListener('click', function (ev) {
      var n = cible(ev, 'data-run');
      if (n) { cacherInfobulle(); filtrerSurRun(n.getAttribute('data-run')); }
    });
  }
  function figure(titre, svg, prop) {
    var f = el('figure', { class: 'hist-fig', 'data-prop': prop }, [el('figcaption', {}, [titre])]);
    var box = el('div', { class: 'hist-fig-svg' });
    box.innerHTML = svg;
    f.appendChild(box);
    return f;
  }
  function rafraichirGraphes() {
    var z = document.getElementById('hist-graphes');
    if (!z || !graphes.ouvert || z.hidden) return;
    var corps = document.getElementById('hist-gr-corps');
    var V = vues();
    if (!corps || !V) return;
    var monSeq = ++graphes.seq;
    var p = parametresVue();
    p.delete('tri'); p.delete('ordre');
    // le filtre « un run » (clic d'un point) ne rétrécit pas le graphique à ce seul run : les
    // graphiques suivent les AUTRES filtres du tableau (SPEC-BANC-045)
    var fg = JSON.parse(p.get('filtre') || '{}'); delete fg.run; p.set('filtre', JSON.stringify(fg));
    p.set('x', graphes.axe);
    function echec(e) {
      if (monSeq !== graphes.seq) return;
      corps.innerHTML = '';
      corps.appendChild(el('p', { class: 'hist-erreur' }, ['Erreur : ' + ((e && e.message) || e)]));
    }
    if (graphes.matrice) {
      fetch('/tests/historique/matrice?' + p.toString()).then(lireJSON).then(function (m) {
        if (monSeq !== graphes.seq) return;
        corps.innerHTML = '';
        if (!m.tests || !m.tests.length) { corps.appendChild(el('p', {}, ['(aucun test pour ces filtres)'])); return; }
        var note = m.tronque && (m.tronque.tests || m.tronque.runs)
          ? ' — tronquée : ' + m.tests.length + '/' + m.totalTests + ' tests, ' + m.runs.length + '/' + m.totalRuns + ' runs (affinez les filtres)' : '';
        corps.appendChild(figure('Matrice tests × runs : ' + m.tests.length + ' × ' + m.runs.length + note, V.svgMatrice(V.modeleMatrice(m, { axe: graphes.axe })), 'matrice'));
      }).catch(echec);
      return;
    }
    if (!graphes.props.length) { corps.innerHTML = ''; corps.appendChild(el('p', {}, ['Cochez une propriété à tracer.'])); return; }
    var ordre = ['etat'].concat(PROPS_NUM).filter(function (id) { return graphes.props.indexOf(id) >= 0; });
    p.set('props', ordre.join(','));
    fetch('/tests/historique/series?' + p.toString()).then(lireJSON).then(function (data) {
      if (monSeq !== graphes.seq) return;
      corps.innerHTML = '';
      var serie = Array.isArray(data.serie) ? data.serie : [];
      if (!serie.length) { corps.appendChild(el('p', {}, ['(aucun run pour ces filtres)'])); return; }
      var unique = data.nbTests === 1;
      ordre.forEach(function (prop) {
        if (prop === 'etat') {
          var svg = unique ? V.svgPastilles(V.modelePastilles(serie, { axe: graphes.axe })) : V.svgBarres(V.modeleBarresEtat(serie, { axe: graphes.axe }));
          corps.appendChild(figure('État par run' + (unique ? ' (un test : une pastille par run)' : ' (' + data.nbTests + ' tests)'), svg, 'etat'));
        } else {
          var titre = PAR_ID[prop].label + (unique ? ' — valeur brute' : ' — médiane et p95 par run') + (prop === 'duree_ms' ? ' · seuil lent en pointillés' : '');
          corps.appendChild(figure(titre, V.svgCourbe(V.modeleCourbe(serie, prop, { unique: unique, seuil: seuilLentMs(), axe: graphes.axe })), prop));
        }
      });
    }).catch(echec);
  }
  function basculerGraphes() {
    var z = document.getElementById('hist-graphes');
    if (!z) return;
    graphes.ouvert = z.hidden;   // hidden avant bascule : ouvert après
    z.hidden = !graphes.ouvert;
    var b = document.getElementById('hist-graphes-btn');
    if (b) b.setAttribute('aria-pressed', graphes.ouvert ? 'true' : 'false');
    if (graphes.ouvert) rafraichirGraphes(); else cacherInfobulle();
  }

  // ══════════════════════════════════════════════════════════════════════
  // Ouverture / fermeture (SPEC-BANC-033) — un clic sur « historique » d'un
  // test dans la sélection (tests/banc-ui.js) appelle `ouvrir({ cle })` :
  // tableau filtré sur ce test (identité exacte, jamais « contient ») et
  // panneau du test ouvert. `ouvrir({ test: id })` reste accepté (filtre
  // « contient » sur l'id catalogue, partagé par les tests d'une même SPEC).
  // ══════════════════════════════════════════════════════════════════════
  // lève la vue « un test » posée par filtrerSurTest (filtre cle/test seul)
  function leverFiltreTest() {
    if (!etat.filtreTest) return;
    delete etat.filtresColonnes.cle;
    delete etat.filtresColonnes.test;
    delete etat.filtresColonnes.run;
    etat.filtreTest = false;
    etat.cleFiltres = null;
  }
  function ouvrir(opts) {
    var o = opts || {};
    racine().hidden = false;
    if (!(o.cle || o.test || o.run)) leverFiltreTest();
    if (o.cle || o.test) filtrerSurTest(o);
    else if (o.run) { leverFiltreTest(); filtrerSurRun(o.run, { tous: true }); }
    document.getElementById('hist-rapide-inscrits').checked = etat.rapide === 'inscrits';
    rendreMenuColonnes();
    if (!(o.cle || o.test || o.run)) rafraichir();
    if (o.cle) ouvrirPanneauTest({ cle: o.cle, nom: o.nom, run: o.run });
  }
  function fermer() { racine().hidden = true; fermerPanneauTest(); }
  /* Remet la vue à son état d'ouverture (filtres, tris, graphiques, panneau) : les tests e2e du banc
     (tests/e2e-banc.js) rendent la page comme ils l'ont trouvée. Les colonnes choisies sont conservées. */
  function reinitialiser() {
    fermerPanneauTest();
    etat.filtresColonnes = {}; etat.tris = []; etat.rapide = 'inscrits'; etat.page = 1; etat.cleFiltres = null; etat.filtreTest = false;
    var cb = document.getElementById('hist-rapide-inscrits');
    if (cb) cb.checked = true;
    graphes.props = ['etat']; graphes.axe = 'debut_run'; graphes.matrice = false; graphes.ouvert = false;
    var z = document.getElementById('hist-graphes');
    if (z) z.hidden = true;
    var bg = document.getElementById('hist-graphes-btn');
    if (bg) bg.setAttribute('aria-pressed', 'false');
    cacherInfobulle();
    construireGraphes();
    fermer();
  }

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
        if (etat.rapide === 'tous') leverFiltreTest();
        document.getElementById('hist-rapide-inscrits').checked = etat.rapide === 'inscrits';
        etat.page = 1; rafraichir();
      });
    });
    document.getElementById('hist-colonnes-btn').addEventListener('click', function () {
      var menu = document.getElementById('hist-colonnes-menu');
      menu.hidden = !menu.hidden;
    });
    var bg = document.getElementById('hist-graphes-btn');
    if (bg) bg.addEventListener('click', basculerGraphes);
    construireGraphes();
    var bRep = document.getElementById('hist-repartition-btn');
    if (bRep) bRep.addEventListener('click', function () { basculerRepartition(); });
    document.getElementById('hist-export-csv').addEventListener('click', function () { exporterVue('csv'); });
    document.getElementById('hist-export-html').addEventListener('click', function () { exporterVue('html'); });
    rendreMenuColonnes();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialiser);
  else initialiser();

  G.MC_HISTORIQUE = {
    ouvrir: ouvrir, fermer: fermer, ouvrirTest: ouvrirPanneauTest, etat: etat, _urlImage: urlImage,
    graphes: graphes, panneau: panneau, ouvrirDiaporama: ouvrirDiaporama, colonnes: COLONNES, reinitialiser: reinitialiser,
    repartition: basculerRepartition, filtrerSurValeur: filtrerSurValeur,
    grouperTriplets: grouperTriplets, clignotement: clignotement, arreterBoucles: arreterBoucles, CADENCE_CLIGNOTEMENT_MS: CADENCE_CLIGNOTEMENT_MS,
  };
})(typeof window !== 'undefined' ? window : this);
