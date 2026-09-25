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
  test: 'texte', nom: 'texte',
  type: 'enum', groupe: 'enum',
  domaines: 'liste', specs: 'liste', fonctions: 'liste', etiquettes: 'liste',
  debut_test: 'horodatage', duree_ms: 'nombre', etat: 'enum', erreur: 'texte', raison: 'texte',
  nb_captures: 'nombre',
  motif: 'texte', arbre_modifie: 'enum', interrompu: 'enum',
};
// Colonnes-liste comptées « à part » (SPEC-BANC-063) et énumérations avec
// effectifs (SPEC-BANC-034/036) — dérivées de TYPES_COLONNES pour ne pas
// dupliquer la liste à la main.
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
function construireLignes(runs, opts) {
  const o = opts || {};
  const infoCommit = o.infoCommit || {};
  const lignes = [];
  (runs || []).forEach((run) => {
    const info = (run.commit && infoCommit[run.commit]) || null;
    (run.tests || []).forEach((t) => {
      const cat = t.categorie || {};
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
        test: t.id || t.nom, nom: t.nom || null,
        type: cat.type || null, groupe: cat.groupe || null,
        domaines: t.domaines || [], specs: t.specs || [], fonctions: t.fonctions || [], etiquettes: t.etiquettes || [],
        fiche: t.fiche || null,
        debut_test: t.debut || null, duree_ms: t.duree_ms === undefined ? null : t.duree_ms,
        etat: t.etat || null, erreur: t.erreur || null, raison: t.raison || null,
        nb_captures: (t.captures || []).length,
        captures: t.captures || [],
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
  const champs = Object.keys(f).filter(c => TYPES_COLONNES[c]);
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
  const liste = Array.isArray(tris) ? tris.filter(Boolean) : (tris ? [tris] : []);
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
function paginer(lignes, page, taille) {
  const t = Math.max(1, parseInt(taille, 10) || 50);
  const p = Math.max(1, parseInt(page, 10) || 1);
  const total = lignes.length;
  const debut = (p - 1) * t;
  return { lignes: lignes.slice(debut, debut + t), total: total, page: p, taille: t };
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
  const deTest = filtrerLignes(lignes.filter(l => l.test === testId), o.filtre);
  const tri = o.tri === 'commit' ? { champ: 'rang_commit', ordre: 'asc' } : { champ: 'debut_run', ordre: 'asc' };
  const triees = trierLignes(deTest, tri);
  return triees.map(l => ({
    run: l.run, commit: l.commit, commit_court: l.commit_court, sujet_commit: l.sujet_commit,
    debut_run: l.debut_run, etat: l.etat, duree_ms: l.duree_ms, inscrit: l.inscrit,
    captures: l.captures && l.captures.length ? l.captures : [],
  }));
}

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
  construireLignes, filtrerLignes, filtreRapide, trierLignes, paginer,
  effectifsEnum, effectifsToutesEnum, serieAgregee, imagesDeTest,
  creerIndex, calculerInfoCommit,
};
