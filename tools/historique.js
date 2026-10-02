#!/usr/bin/env node
/* tools/historique.js — logique PURE du tableau « Historique global »
   (docs/banc/historique-global.md §1 à §3.1, SPEC-BANC-033 à 040). Module
   Node autonome, testable sans serveur HTTP (tests/spec-historique.js) :
   aplatit les runs unifiés de tools/registre.js (runsUnifies()) en lignes
   test×run, puis fournit tri, filtre, pagination et agrégation. AUCUN accès
   disque ici sauf dans creerIndex() (mtime, listage de dossiers) — le
   calcul des lignes lui-même (construireLignes/filtrerLignes/trierLignes/
   paginer/effectifs/serieAgregee/imagesDeTest) est pur, sans effet de bord,
   pour rester testable sur des jeux de données construits à la main.

   Volume attendu (§2 du document de conception) : environ 1 250 lignes par
   run complet — au bout de cent runs, plus de 100 000 lignes. D'où :
     - la pagination et le filtrage se font ICI, côté serveur, jamais dans
       le navigateur sur la liste complète ;
     - l'index en mémoire (creerIndex()) ne reconstruit runsUnifies() (qui
       relit tout le disque) que si le dossier source a changé (signature
       de mtime + nombre d'entrées), jamais à chaque requête. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const REG = require('./registre.js');

const RACINE = path.join(__dirname, '..');

// ══════════════════════════════════════════════════════════════════════════
// Colonnes : nom → type, pour savoir COMMENT filtrer/trier chaque propriété
// (docs/banc/historique-global.md §1 et §3.1, SPEC-BANC-034/036).
// ══════════════════════════════════════════════════════════════════════════
const TYPES_COLONNES = {
  run: 'texte', debut_run: 'horodatage',
  commit: 'texte', commit_court: 'texte', sujet_commit: 'texte', rang_commit: 'commit',
  branche: 'enum', preset: 'enum', origine: 'enum', inscrit: 'enum',
  test: 'texte', cle: 'exact', nom: 'texte',
  type: 'enum', groupe: 'enum',
  domaines: 'liste', specs: 'liste', fonctions: 'liste', etiquettes: 'liste',
  debut_test: 'horodatage', duree_ms: 'nombre', etat: 'enum', erreur: 'texte', raison: 'texte',
  nb_captures: 'nombre',
  motif: 'texte', arbre_modifie: 'enum', interrompu: 'enum',
};
// Colonnes-liste comptées « à part » (SPEC-BANC-063) et énumérations avec
// effectifs (SPEC-BANC-034/036) — dérivées de TYPES_COLONNES pour ne pas
// dupliquer la liste à la main.
/* une colonne CONNUE, jamais une propriété héritée (« constructor », « __proto__ »… — SPEC-BANC-122) */
function estColonne(c) { return typeof c === 'string' && Object.prototype.hasOwnProperty.call(TYPES_COLONNES, c); }
const COLONNES_ENUM = Object.keys(TYPES_COLONNES).filter(c => TYPES_COLONNES[c] === 'enum');
const COLONNES_LISTE = Object.keys(TYPES_COLONNES).filter(c => TYPES_COLONNES[c] === 'liste');

// ══════════════════════════════════════════════════════════════════════════
// construireLignes : runsUnifies() → une ligne par test×run
// ══════════════════════════════════════════════════════════════════════════
/* `infoCommit` (facultatif) : { [sha]: { rang, court, sujet } } — précalculé
   par l'appelant (creerIndex(), un seul appel git par reconstruction) pour
   que cette fonction reste pure et rapide sur un grand nombre de lignes.
   Sans lui : `rang_commit` vaut -1, `commit_court` est dérivé du sha (10
   premiers caractères), `sujet_commit` est `null` — utile pour les tests. */
/* Données venues du disque (registre versionné, cahiers locaux écrits par
   n'importe quelle version du banc) : JAMAIS supposées bien formées
   (SPEC-BANC-120). Un run ou un test qui n'est pas un objet est ignoré, une
   liste qui n'est pas un tableau devient [], un texte devient une chaîne
   sans séquences d'échappement ANSI (messages de terminal recopiés tels
   quels) — une seule donnée inattendue faisait sinon lever TOUTE la
   reconstruction de l'index, donc toutes les requêtes de l'historique. */
const RE_ANSI = /\u001b\[[0-9;?]*[ -\/]*[@-~]/g;
function liste(v) {
  return Array.isArray(v) ? v.filter(x => x !== null && x !== undefined).map(x => (typeof x === 'object' ? JSON.stringify(x) : x)) : [];
}
function texte(v) {
  if (v === undefined || v === null) return null;
  const s = typeof v === 'string' ? v : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  return s.replace(RE_ANSI, '');
}
function nombre(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
function estObjet(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
/* Identité d'un test dans l'historique (SPEC-BANC-119) : même calcul que
   tests/catalogue.js cleTest() — groupe + nom, unique et stable, là où `id`
   est partagé par tous les tests d'une même SPEC (SPEC-NET-007 : 6 tests)
   ou dépend d'un rang qui bouge d'une campagne à l'autre. */
function cleTest(type, groupe, nom) {
  // e2e : le groupe n'est PAS stable (section de tests/e2e.js côté Node,
  // « end-to-end » côté banc navigateur) — le nom y est unique à lui seul
  const g = type === 'e2e' ? 'e2e' : groupe;
  return String(g === undefined || g === null ? '' : g) + ' › ' + String(nom === undefined || nom === null ? '' : nom);
}
function construireLignes(runs, opts) {
  const o = opts || {};
  const infoCommit = o.infoCommit || {};
  const lignes = [];
  (Array.isArray(runs) ? runs : []).forEach((run) => {
    if (!estObjet(run)) return;
    const info = (run.commit && infoCommit[run.commit]) || null;
    (Array.isArray(run.tests) ? run.tests : []).forEach((t) => {
      if (!estObjet(t)) return;
      const cat = estObjet(t.categorie) ? t.categorie : {};
      const nomTest = texte(t.nom) || texte(t.id) || '(sans nom)';
      const captures = (Array.isArray(t.captures) ? t.captures : []).filter(estObjet);
      lignes.push({
        run: run.id, debut_run: run.date || null,
        commit: run.commit || null,
        commit_court: (info && info.court) || (run.commit ? String(run.commit).slice(0, 10) : null),
        sujet_commit: (info && info.sujet) || null,
        rang_commit: info ? info.rang : -1,
        branche: run.branche || null, preset: run.preset || null, origine: run.origine || null,
        inscrit: !!run.inscrit, statut: run.statut || null,
        motif: run.motif || null, arbre_modifie: !!run.arbre_modifie, interrompu: !!run.interrompu,
        moteurRendu: run.moteurRendu || null,
        dossierCahier: run.dossierCahier || null,
        test: texte(t.id) || nomTest, cle: cleTest(texte(cat.type), texte(cat.groupe), nomTest), nom: nomTest,
        type: texte(cat.type), groupe: texte(cat.groupe),
        domaines: liste(t.domaines), specs: liste(t.specs), fonctions: liste(t.fonctions), etiquettes: liste(t.etiquettes),
        fiche: estObjet(t.fiche) ? t.fiche : null,
        debut_test: texte(t.debut), duree_ms: nombre(t.duree_ms),
        etat: texte(t.etat), erreur: texte(t.erreur), raison: texte(t.raison),
        nb_captures: captures.length,
        captures: captures,
      });
    });
  });
  return lignes;
}

// ══════════════════════════════════════════════════════════════════════════
// Filtrage (SPEC-BANC-036/037) — filtre = { [champ]: spec } où la FORME de
// `spec` dépend du type de la colonne (TYPES_COLONNES) :
//   texte     → chaîne : « contient », insensible à la casse
//   enum      → tableau de valeurs acceptées (comparaison stricte, ou
//               intersection non vide pour une colonne-liste)
//   nombre    → { min?, max? }
//   horodatage→ { de?, a? } (chaînes comparables lexicalement, ISO 8601)
//   commit    → { de?, a? } bornes de rang_commit (nombres)
// Un champ absent de `filtre` n'est pas filtré. Un champ inconnu est ignoré
// (jamais une erreur : un filtre passé par l'URL peut porter une colonne que
// cette version du serveur ne connaît pas encore).
// ══════════════════════════════════════════════════════════════════════════
function valeurCorrespond(ligne, champ, type, spec) {
  const v = ligne[champ];
  if (type === 'texte') {
    if (!spec) return true;
    return String(v === undefined || v === null ? '' : v).toLowerCase().indexOf(String(spec).toLowerCase()) >= 0;
  }
  if (type === 'exact') {
    // égalité stricte sur une valeur ou une liste de valeurs (identité d'un
    // test, SPEC-BANC-119) — jamais « contient » : « G › a » ne doit pas
    // ramener « G › a (variante) ».
    if (spec === undefined || spec === null || spec === '' || (Array.isArray(spec) && !spec.length)) return true;
    return Array.isArray(spec) ? spec.indexOf(v) >= 0 : v === spec;
  }
  if (type === 'enum') {
    if (!Array.isArray(spec) || !spec.length) return true;
    return spec.indexOf(v) >= 0 || spec.indexOf(String(v)) >= 0;
  }
  if (type === 'liste') {
    if (!Array.isArray(spec) || !spec.length) return true;
    const vals = Array.isArray(v) ? v : [];
    return vals.some(x => spec.indexOf(x) >= 0);
  }
  if (type === 'nombre') {
    if (!spec || (spec.min === undefined && spec.max === undefined)) return true;
    if (v === null || v === undefined) return false;
    if (spec.min !== undefined && v < spec.min) return false;
    if (spec.max !== undefined && v > spec.max) return false;
    return true;
  }
  if (type === 'horodatage') {
    if (!spec || (!spec.de && !spec.a)) return true;
    if (!v) return false;
    if (spec.de && String(v) < String(spec.de)) return false;
    if (spec.a && String(v) > String(spec.a)) return false;
    return true;
  }
  if (type === 'commit') {
    if (!spec || (spec.de === undefined && spec.a === undefined)) return true;
    if (v === undefined || v === null || v < 0) return false;
    if (spec.de !== undefined && v < spec.de) return false;
    if (spec.a !== undefined && v > spec.a) return false;
    return true;
  }
  return true;
}
function filtrerLignes(lignes, filtre) {
  const f = filtre || {};
  const champs = Object.keys(f).filter(estColonne);
  if (!champs.length) return lignes.slice();
  return lignes.filter(l => champs.every(c => valeurCorrespond(l, c, TYPES_COLONNES[c], f[c])));
}

// Filtres rapides (SPEC-BANC-037), traduits en filtre standard — combinables
// avec un filtre explicite (l'appelant fusionne avant d'appeler filtrerLignes).
function filtreRapide(nom) {
  if (nom === 'inscrits') return { inscrit: [true] };
  if (nom === 'tous') return {};
  if (nom === 'echecs') return { etat: ['echec'] };
  if (nom === 'lents') return { etat: ['avertissement'] };
  return {};
}

// ══════════════════════════════════════════════════════════════════════════
// Tri multi-clés (SPEC-BANC-035) : tris = [{ champ, ordre: 'asc'|'desc' }, …]
// (accepte aussi un objet unique { champ, ordre } pour un tri simple).
// ══════════════════════════════════════════════════════════════════════════
function comparerValeurs(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}
function trierLignes(lignes, tris) {
  // champ inconnu (ou hérité : « constructor »…) ignoré, jamais trié (SPEC-BANC-122)
  const liste = (Array.isArray(tris) ? tris : (tris ? [tris] : [])).filter(t => t && estColonne(t.champ));
  if (!liste.length) return lignes.slice();
  const copie = lignes.slice();
  copie.sort((a, b) => {
    for (let i = 0; i < liste.length; i++) {
      const { champ, ordre } = liste[i];
      const sens = ordre === 'desc' ? -1 : 1;
      const c = comparerValeurs(a[champ], b[champ]) * sens;
      if (c !== 0) return c;
    }
    return 0;
  });
  return copie;
}

// ══════════════════════════════════════════════════════════════════════════
// Pagination serveur (SPEC-BANC-038)
// ══════════════════════════════════════════════════════════════════════════
/* Taille de page BORNÉE (SPEC-BANC-120) : l'export du navigateur demandait
   une page de 1 000 000 lignes et recevait tout l'historique en un seul JSON
   (64 Mo pour 45 runs, captures et fiches comprises — davantage à chaque
   run). L'export complet passe désormais par /tests/historique/export
   (colonnes demandées seulement), jamais par cette route. */
const TAILLE_PAGE_MAX = 500;
function paginer(lignes, page, taille) {
  const t = Math.min(TAILLE_PAGE_MAX, Math.max(1, parseInt(taille, 10) || 50));
  const p = Math.max(1, parseInt(page, 10) || 1);
  const total = lignes.length;
  // une page au-delà de la dernière (filtre resserré alors qu'on était page
  // 40, par exemple) ramène à la dernière page plutôt qu'à une page vide
  const pp = Math.min(p, Math.max(1, Math.ceil(total / t)));
  const debut = (pp - 1) * t;
  return { lignes: lignes.slice(debut, debut + t), total: total, page: pp, taille: t };
}

// ══════════════════════════════════════════════════════════════════════════
// Effectifs par valeur, pour remplir les filtres énumération (SPEC-BANC-034/
// 036/063) : une colonne-liste compte un test dans CHACUNE de ses valeurs.
// ══════════════════════════════════════════════════════════════════════════
function effectifsEnum(lignes, champ) {
  const compte = new Map();
  const liste = COLONNES_LISTE.indexOf(champ) >= 0;
  lignes.forEach((l) => {
    const vals = liste ? (Array.isArray(l[champ]) ? l[champ] : []) : [l[champ]];
    vals.forEach((v) => {
      const cle = v === undefined ? null : v;
      compte.set(cle, (compte.get(cle) || 0) + 1);
    });
  });
  return Array.from(compte.entries()).map(([valeur, effectif]) => ({ valeur, effectif }))
    .sort((a, b) => b.effectif - a.effectif || comparerValeurs(a.valeur, b.valeur));
}
/* Effectifs de toutes les colonnes énumération + colonnes-liste connues, pour
   remplir en un seul appel les filtres du tableau (SPEC-BANC-040 : « pour
   chaque énumération, les valeurs distinctes avec leur effectif »). */
function effectifsToutesEnum(lignes) {
  const out = {};
  COLONNES_ENUM.concat(COLONNES_LISTE).forEach((c) => { out[c] = effectifsEnum(lignes, c); });
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// Agrégation pour les graphiques (§3.2, SPEC-BANC-041 à 045) — cette étape
// ne fait que PRÉPARER les points ; le rendu (Chart.js/SVG) est un lot
// ultérieur (docs/banc/historique-global.md §5, étape 3).
// ══════════════════════════════════════════════════════════════════════════
function mediane(valeurs) {
  if (!valeurs.length) return null;
  const v = valeurs.slice().sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function p95(valeurs) {
  if (!valeurs.length) return null;
  const v = valeurs.slice().sort((a, b) => a - b);
  const i = Math.min(v.length - 1, Math.ceil(0.95 * v.length) - 1);
  return v[Math.max(0, i)];
}
function serieAgregee(lignes, opts) {
  const o = opts || {};
  const x = o.x === 'rang_commit' ? 'rang_commit' : 'debut_run';
  const props = o.props || [];
  const parRun = new Map();
  lignes.forEach((l) => {
    if (!parRun.has(l.run)) {
      parRun.set(l.run, { run: l.run, x: l[x], commit: l.commit, commit_court: l.commit_court, sujet_commit: l.sujet_commit, tests: [] });
    }
    parRun.get(l.run).tests.push(l);
  });
  const points = Array.from(parRun.values()).map((r) => {
    const point = { run: r.run, x: r.x, commit: r.commit, commit_court: r.commit_court, sujet_commit: r.sujet_commit };
    props.forEach((prop) => {
      if (prop === 'etat') {
        const c = { reussi: 0, echec: 0, ignore: 0, avertissement: 0 };
        r.tests.forEach((t) => { if (c[t.etat] !== undefined) c[t.etat]++; });
        point.etat = c;
        return;
      }
      const valeurs = r.tests.map(t => t[prop]).filter(v => typeof v === 'number');
      point[prop] = { valeurs: valeurs, mediane: mediane(valeurs), p95: p95(valeurs) };
    });
    return point;
  });
  points.sort((a, b) => comparerValeurs(a.x, b.x));
  return points;
}

// ══════════════════════════════════════════════════════════════════════════
// Images d'un test, dans l'ordre (§3.3, préparation pour un lot ultérieur —
// la suite ORDONNÉE des runs avec leurs captures groupées par rôle,
// SPEC-BANC-040) — un run sans capture pour ce test apparaît quand même
// (« pas de capture », §3.3), pour ne pas désynchroniser un futur diaporama.
// ══════════════════════════════════════════════════════════════════════════
function imagesDeTest(lignes, testId, opts) {
  const o = opts || {};
  // `testId` : l'identité (cle, SPEC-BANC-119) ; à défaut l'ancien `test`
  // (id catalogue) des appelants d'avant — SEULEMENT si aucune clé ne
  // correspond, pour ne jamais mêler les tests d'une même SPEC.
  let retenues = lignes.filter(l => l.cle === testId);
  if (!retenues.length) retenues = lignes.filter(l => l.test === testId);
  const deTest = filtrerLignes(retenues, o.filtre);
  const tri = o.tri === 'commit' ? { champ: 'rang_commit', ordre: 'asc' } : { champ: 'debut_run', ordre: 'asc' };
  const triees = trierLignes(deTest, tri);
  return triees.map(l => ({
    run: l.run, commit: l.commit, commit_court: l.commit_court, sujet_commit: l.sujet_commit,
    debut_run: l.debut_run, etat: l.etat, duree_ms: l.duree_ms, inscrit: l.inscrit,
    preset: l.preset, dossierCahier: l.dossierCahier, erreur: l.erreur, raison: l.raison,
    cle: l.cle, test: l.test, nom: l.nom, type: l.type, groupe: l.groupe, fiche: l.fiche,
    captures: l.captures && l.captures.length ? l.captures : [],
  }));
}

// ══════════════════════════════════════════════════════════════════════════
// Tests connus de l'historique (SPEC-BANC-118) : UNE entrée par identité
// (cle), avec son dernier passage — c'est ce qui permet au banc navigateur de
// montrer, et d'ouvrir dans l'historique, les tests qu'il ne peut pas
// charger lui-même (intégration, fichiers Node seulement, tests disparus du
// catalogue courant), au lieu de les rendre introuvables.
// ══════════════════════════════════════════════════════════════════════════
function ficheCourte(f) { return f ? { teste: f.teste || null, attendu: f.attendu || null } : null; }
function testsConnus(lignes) {
  const parCle = new Map();
  (lignes || []).forEach((l) => {
    let e = parCle.get(l.cle);
    if (!e) {
      e = { cle: l.cle, test: l.test, nom: l.nom, type: l.type, groupe: l.groupe, domaines: l.domaines, specs: l.specs,
            fiche: ficheCourte(l.fiche), runs: 0, echecs: 0, dernier: null };
      parCle.set(l.cle, e);
    }
    e.runs++;
    if (l.etat === 'echec') e.echecs++;
    if (!e.dernier || comparerValeurs(l.debut_run, e.dernier.debut_run) > 0) {
      e.dernier = { run: l.run, debut_run: l.debut_run, etat: l.etat, duree_ms: l.duree_ms, preset: l.preset };
      // l'identité la plus récente fait foi (type/domaines/fiche ont pu évoluer)
      e.test = l.test; e.type = l.type; e.domaines = l.domaines; e.specs = l.specs; e.fiche = ficheCourte(l.fiche);
    }
  });
  return Array.from(parCle.values()).sort((a, b) => comparerValeurs(a.cle, b.cle));
}

// ══════════════════════════════════════════════════════════════════════════
// Export de la vue filtrée (SPEC-BANC-038, révisé par SPEC-BANC-120) —
// calculé ICI, colonnes demandées seulement : le navigateur ne reçoit plus
// l'historique complet en JSON pour le remettre en forme lui-même.
// ══════════════════════════════════════════════════════════════════════════
function valeurExport(ligne, champ) {
  const v = ligne[champ];
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  return v === undefined || v === null ? '' : String(v);
}
/* Neutralisation des formules (SPEC-BANC-122) : un tableur ouvrant le CSV
   exécuterait une cellule commençant par = + - @ (ou tabulation / retour
   chariot) — un message d'erreur de test est un texte libre, il peut en
   contenir. Préfixée d'une apostrophe, elle reste lisible et inerte ; un
   nombre (« -12.5 ») n'est jamais touché. */
function celluleCsv(v) {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) s = "'" + s;
  return /[",\n\r;']/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function echapperHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// libellés d'en-tête : les MÊMES que ceux affichés par tests/historique.js
const LIBELLES_COLONNES = {
  run: 'Run', debut_run: 'Début run', commit: 'Commit (sha)', commit_court: 'Commit', sujet_commit: 'Sujet du commit',
  rang_commit: 'Rang commit', branche: 'Branche', preset: 'Préréglage', origine: 'Origine', inscrit: 'Inscrit',
  test: 'Id test', cle: 'Identité', nom: 'Nom du test', type: 'Type', groupe: 'Groupe', domaines: 'Domaines',
  specs: 'Specs', fonctions: 'Fonctions', etiquettes: 'Étiquettes', debut_test: 'Début test', duree_ms: 'Durée (ms)',
  etat: 'État', erreur: 'Erreur', raison: 'Raison', nb_captures: 'Captures', motif: 'Motif',
  arbre_modifie: 'Arbre modifié', interrompu: 'Interrompu',
};
function libelle(c) { return Object.prototype.hasOwnProperty.call(LIBELLES_COLONNES, c) ? LIBELLES_COLONNES[c] : String(c); }
function colonnesExport(colonnes) {
  const c = (Array.isArray(colonnes) ? colonnes : []).filter(estColonne);
  return c.length ? c : ['debut_run', 'commit_court', 'preset', 'nom', 'type', 'duree_ms', 'etat', 'erreur'];
}
/* Export en MORCEAUX (SPEC-BANC-122) : en-tête, une fonction par ligne, pied —
   server.js les écrit par paquets en rendant la main à la boucle
   d'évènements, au lieu de construire d'un bloc une chaîne de dizaines de Mo. */
const EXPORT_LIGNES_MAX = 100000;
function morceauxExport(colonnes, format, total) {
  const cols = colonnesExport(colonnes);
  if (format === 'html') {
    return {
      entete: '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Historique global</title>' +
        '<style>body{font:13px ui-monospace,Menlo,Consolas,monospace;background:#0b0e13;color:#e8eaed;padding:16px;}' +
        'table{border-collapse:collapse;width:100%;} th,td{border:1px solid #333;padding:4px 8px;text-align:left;vertical-align:top;}</style>' +
        '</head><body><h1>Historique global — ' + (total | 0) + ' ligne(s)</h1><table><thead><tr>' +
        cols.map(c => '<th>' + echapperHtml(libelle(c)) + '</th>').join('') + '</tr></thead><tbody>',
      ligne: l => '<tr>' + cols.map(c => '<td>' + echapperHtml(valeurExport(l, c)) + '</td>').join('') + '</tr>',
      pied: '</tbody></table></body></html>',
    };
  }
  return {
    entete: '﻿' + cols.map(c => celluleCsv(libelle(c))).join(',') + '\n',
    ligne: l => cols.map(c => celluleCsv(valeurExport(l, c))).join(',') + '\n',
    pied: '',
  };
}
function exporter(lignes, colonnes, format) {
  const m = morceauxExport(colonnes, format, lignes.length);
  return m.entete + lignes.map(m.ligne).join('') + m.pied;
}
function exporterCSV(lignes, colonnes) { return exporter(lignes, colonnes, 'csv'); }
function exporterHTMLVue(lignes, colonnes) { return exporter(lignes, colonnes, 'html'); }

// ══════════════════════════════════════════════════════════════════════════
// Index en mémoire (SPEC-BANC-040) : reconstruit runsUnifies() + les lignes
// SEULEMENT quand le dossier source a changé (signature de mtime), jamais à
// chaque requête — le registre peut grossir (§2 : ~1250 lignes/run, >100 000
// lignes au bout de cent runs), une lecture complète du disque à chaque
// appel serait trop lente.
// ══════════════════════════════════════════════════════════════════════════
function signatureDossier(d) {
  try {
    const st = fs.statSync(d);
    const n = fs.readdirSync(d).length;
    return st.mtimeMs + ':' + n;
  } catch (e) { return 'absent'; }
}
/* Un seul appel git par reconstruction (jamais par ligne) : rang topologique
   (déjà exposé par tools/registre.js) et, en plus, le sujet/commit court de
   chaque commit du registre (SPEC-BANC-034 : colonne `sujet_commit`) — lu en
   un seul `git log`, mis en cache dans le résultat de la reconstruction. */
function calculerInfoCommit(dossierRepo, commitsPresents) {
  const commits = REG.ordreCommits(dossierRepo) || [];
  const rangParCommit = {};
  commits.forEach((c, i) => { rangParCommit[c] = i; });
  const info = {};
  const aResoudre = Array.from(new Set(commitsPresents.filter(Boolean)));
  if (aResoudre.length) {
    let brut = null;
    try {
      brut = execFileSync('git', ['show', '-s', '--format=%H%x1f%h%x1f%s', '--no-patch', ...aResoudre],
        { cwd: dossierRepo || RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) { brut = null; }
    (brut || '').split('\n').filter(Boolean).forEach((ligne) => {
      const [sha, court, sujet] = ligne.split('\x1f');
      if (sha) info[sha] = { court: court || sha.slice(0, 10), sujet: sujet || '' };
    });
  }
  aResoudre.forEach((sha) => {
    const base = info[sha] || { court: sha.slice(0, 10), sujet: null };
    info[sha] = Object.assign({ rang: rangParCommit.hasOwnProperty(sha) ? rangParCommit[sha] : -1 }, base);
  });
  return info;
}
function creerIndex(opts) {
  const o = opts || {};
  const dossierRegistre = o.dossierRegistre || REG.DOSSIER_REGISTRE;
  const racineResultats = o.racineResultats || path.join(RACINE, 'tests', 'resultats');
  const dossierRepo = o.dossierRepo || RACINE;
  let cache = null; // { signature, lignes }
  let reconstructions = 0;

  function signature() {
    return signatureDossier(path.join(dossierRegistre, REG.DOSSIER_ENTREES_REL)) + '|' + signatureDossier(racineResultats);
  }
  function construire() {
    const runs = REG.runsUnifies({ dossierRegistre, racineResultats, dossierRepo });
    const infoCommit = calculerInfoCommit(dossierRepo, runs.map(r => r.commit));
    const lignes = construireLignes(runs, { infoCommit });
    cache = { signature: signature(), lignes };
    reconstructions++;
  }
  function lignes() {
    const sig = signature();
    if (!cache || cache.signature !== sig) construire();
    return cache.lignes;
  }
  return {
    lignes,
    get reconstructions() { return reconstructions; },
  };
}

module.exports = {
  TYPES_COLONNES, COLONNES_ENUM, COLONNES_LISTE,
  construireLignes, filtrerLignes, filtreRapide, trierLignes, paginer, TAILLE_PAGE_MAX,
  effectifsEnum, effectifsToutesEnum, serieAgregee, imagesDeTest,
  testsConnus, exporterCSV, exporterHTMLVue, morceauxExport, EXPORT_LIGNES_MAX, celluleCsv, estColonne, cleTest,
  creerIndex, calculerInfoCommit,
};
