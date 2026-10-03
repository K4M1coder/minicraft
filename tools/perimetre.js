#!/usr/bin/env node
/* tools/perimetre.js — PÉRIMÈTRE D'EXÉCUTION des tests (SPEC-BANC-067 à 076,
   docs/banc/historique-global.md §3.6).

   Deux produits :
   1. la CARTE D'IMPACT, versionnée (tests/registre/impact.json), construite
      après chaque run COMPLET inscrit (pre-push, merge) à partir des
      fonctions observées par tests/run.js (SPEC-BANC-062) :
        fonction qualifiée → [tests qui l'appellent]
        fichier src/x.js   → [fonctions qu'il définit] (en chargeant les modules)
        + le commit sur lequel elle a été construite ;
   2. le CALCUL DU PÉRIMÈTRE d'un ensemble de fichiers modifiés (fichiers
      indexés, ou depuis une référence), dans l'ordre :
        1) fichier de test modifié → tous ses tests ;
        2) fichier src/*.js modifié → fonctions touchées (plages du diff
           croisées avec les bornes des fonctions, découpage syntaxique
           léger ci-dessous) → tests qui les appellent selon la carte ;
        3) tests sans données d'impact (nouveaux, e2e, intégration) →
           retenus s'ils partagent un domaine ou une fonction déclarée avec
           les fichiers touchés ;
        4) toujours : l'ensemble « fumée » (préréglage e2e-fumee) et les
           tests étiquetés `toujours` ;
      et REPLI sur la suite complète dès que le moteur ne peut pas conclure.

   SÛRETÉ D'ABORD : dans le doute, le moteur ÉLARGIT, jamais il ne réduit.
   Concrètement, en plus de l'ordre ci-dessus :
   - l'observation de SPEC-BANC-062 ne voit que les appels qui passent par
     l'espace `MC.X.f` ; un appel INTERNE au module (`tileOrigin(t)` depuis
     `buildChunk`) est invisible. Le moteur propage donc chaque fonction
     touchée à toutes les fonctions du même fichier qui la nomment
     (fermeture transitive), puis aux fonctions exportées qui les contiennent ;
   - une fonction capturée par un autre module au chargement
     (`var idx = C.idx`, ou passée sans être appelée) rend ce module
     entièrement touché (ses appels ne seraient pas observés) ;
   - du code modifié hors de toute fonction nommée (constantes, tables,
     instruction exécutée au chargement), ou une fonction touchée utilisée au
     chargement du module → TOUT le fichier ;
   - un test qui NOMME une fonction touchée (dans son corps, ou dans le code
     commun de son fichier — fabriques partagées construites hors du test,
     donc jamais observées) est retenu (`mention:`) ; un fichier de test qui
     lit le fichier source touché comme du texte (audits statiques) voit tous
     ses tests retenus (`lecture:`) ;
   - un changement de COMMENTAIRE seul (des deux côtés du diff) ne touche
     rien.
   Le repli (suite complète) couvre : fichier hors src/ et hors fichiers de
   test (outillage, serveur, pages, crochets…), fichier src/ supprimé ou
   absent de la carte, module qui ne se charge pas, carte absente,
   illisible, construite sur un commit hors de l'historique ou trop ancien
   (plus de 50 commits, réglable), erreur git.

   Les documents (*.md, docs/, .gitignore, .gitattributes) ne changent pas le
   code : ils ne retiennent que les tests dont le fichier les nomme (lecture
   du texte, comme SPECS.md par les contrôles de couverture). Les données du
   registre (tests/registre/) sont neutres.

   Ligne de commande (le calcul a besoin du catalogue et du corps des tests :
   il est fait par tests/run.js, qui les a déjà chargés) :
     node tools/perimetre.js [--depuis <ref>] [--lister] [--json]
                             [--fichiers a,b] [--ecart-max N] [--preset P]
     node tools/perimetre.js carte [dossier-de-cahier]   reconstruit la carte */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync, spawnSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const CHEMIN_CARTE = path.join(RACINE, 'tests', 'registre', 'impact.json');
const ECART_MAX_DEFAUT = 50;
const VERSION_CARTE = 1;

// ══════════════════════════════════════════════════════════════════════════
// 1. Découpage syntaxique léger
// ══════════════════════════════════════════════════════════════════════════
/* Jetons JavaScript, sans espaces : { type: 'id'|'num'|'str'|'tpl'|'re'|
   'ponct'|'com', v, s, e } (s/e : décalages dans le texte). Suffisant pour
   trouver les fonctions et les identifiants hors chaînes et commentaires ;
   une construction qu'il ne comprend pas fait échouer l'appariement des
   accolades, ce qui fait retomber l'appelant sur « tout le fichier ». */
const PONCTS = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.',
  '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];
const MOTS_AVANT_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const MOTS_CLES = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'with', 'return', 'typeof', 'new', 'do', 'else', 'try', 'finally', 'var', 'let', 'const']);

function estDebutIdent(c) { return /[A-Za-z_$]/.test(c) || c > '\u007f'; }
function estSuiteIdent(c) { return /[\w$]/.test(c) || c > '\u007f'; }

function jetons(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  const pileTpl = []; // profondeur d'accolades ouvertes dans chaque ${ … } en cours
  let precedent = null; // dernier jeton significatif (pas un commentaire)
  function pousser(j) { out.push(j); if (j.type !== 'com') precedent = j; }
  function regexPermise() {
    if (!precedent) return true;
    if (precedent.type === 'id') return MOTS_AVANT_REGEX.has(precedent.v);
    if (precedent.type !== 'ponct') return false;
    return !(precedent.v === ')' || precedent.v === ']' || precedent.v === '++' || precedent.v === '--');
  }
  function lireGabarit(debut) { // depuis juste après ` ou après la } qui ferme un ${
    let k = debut;
    while (k < n) {
      const c = src[k];
      if (c === '\\') { k += 2; continue; }
      if (c === '`') return { fin: k + 1, ouvre: false };
      if (c === '$' && src[k + 1] === '{') return { fin: k + 2, ouvre: true };
      k++;
    }
    throw new Error('gabarit non terminé');
  }
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === '﻿' || c === ' ') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      let k = i; while (k < n && src[k] !== '\n') k++;
      pousser({ type: 'com', s: i, e: k }); i = k; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const k = src.indexOf('*/', i + 2);
      if (k < 0) throw new Error('commentaire non terminé');
      pousser({ type: 'com', s: i, e: k + 2 }); i = k + 2; continue;
    }
    if (c === '"' || c === "'") {
      let k = i + 1;
      while (k < n && src[k] !== c) { if (src[k] === '\\') k++; else if (src[k] === '\n') throw new Error('chaîne non terminée'); k++; }
      if (k >= n) throw new Error('chaîne non terminée');
      pousser({ type: 'str', v: src.slice(i + 1, k), s: i, e: k + 1 }); i = k + 1; continue;
    }
    if (c === '`') {
      const g = lireGabarit(i + 1);
      pousser({ type: 'tpl', s: i, e: g.fin });
      if (g.ouvre) pileTpl.push(0);
      i = g.fin; continue;
    }
    if (estDebutIdent(c)) {
      let k = i + 1; while (k < n && estSuiteIdent(src[k])) k++;
      pousser({ type: 'id', v: src.slice(i, k), s: i, e: k }); i = k; continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let k = i + 1;
      while (k < n && (/[\w.]/.test(src[k]) || ((src[k] === '+' || src[k] === '-') && /[eE]/.test(src[k - 1]) && !/^0[xX]/.test(src.slice(i, k))))) k++;
      pousser({ type: 'num', s: i, e: k }); i = k; continue;
    }
    if (c === '/' && regexPermise()) {
      let k = i + 1, classe = false, ok = false;
      while (k < n) {
        const d = src[k];
        if (d === '\\') { k += 2; continue; }
        if (d === '\n') break;
        if (classe) { if (d === ']') classe = false; }
        else if (d === '[') classe = true;
        else if (d === '/') { ok = true; break; }
        k++;
      }
      if (ok) {
        k++; while (k < n && /[a-z]/i.test(src[k])) k++;
        pousser({ type: 're', s: i, e: k }); i = k; continue;
      }
      // pas une expression régulière lisible : une simple division
    }
    if (c === '}' && pileTpl.length && pileTpl[pileTpl.length - 1] === 0) {
      pileTpl.pop();
      const g = lireGabarit(i + 1);
      pousser({ type: 'tpl', s: i, e: g.fin });
      if (g.ouvre) pileTpl.push(0);
      i = g.fin; continue;
    }
    let p = null;
    for (const cand of PONCTS) if (src.startsWith(cand, i)) { p = cand; break; }
    if (!p) p = c;
    if (pileTpl.length) {
      if (p === '{') pileTpl[pileTpl.length - 1]++;
      else if (p === '}') pileTpl[pileTpl.length - 1]--;
    }
    pousser({ type: 'ponct', v: p, s: i, e: i + p.length }); i += p.length;
  }
  if (pileTpl.length) throw new Error('gabarit non terminé');
  return out;
}

/* Fonctions d'un texte source : [{ nom, debut, declDebut, fin }] — `debut`
   est l'endroit où commence le texte que rend `fn.toString()` (mot-clé
   `function`, nom d'une méthode abrégée, paramètres d'une flèche) ;
   `declDebut` inclut le nom quand il précède (`nom = function`, `nom:
   function`) ; `nom` est null pour une fonction anonyme. Rend aussi, pour
   chaque fonction nommée, l'ensemble des identifiants qu'elle contient, et
   les identifiants « au niveau du module » (hors de toute fonction nommée,
   hors des instructions d'export `MC.X = …` sauf leurs appels). */
function decouper(texte) {
  let tous;
  try { tous = jetons(texte); } catch (e) { return { ok: false, erreur: e.message }; }
  const sig = tous.filter(t => t.type !== 'com');
  const assoc = new Array(sig.length).fill(-1);
  const pile = [];
  const PAIRE = { ')': '(', ']': '[', '}': '{' };
  for (let k = 0; k < sig.length; k++) {
    const t = sig[k];
    if (t.type !== 'ponct') continue;
    if (t.v === '(' || t.v === '[' || t.v === '{') pile.push(k);
    else if (PAIRE[t.v]) {
      const o = pile.pop();
      if (o === undefined || sig[o].v !== PAIRE[t.v]) return { ok: false, erreur: 'parenthèses ou accolades mal appariées vers le décalage ' + t.s };
      assoc[o] = k; assoc[k] = o;
    }
  }
  if (pile.length) return { ok: false, erreur: 'accolade ou parenthèse non fermée' };
  const estP = (k, v) => k >= 0 && k < sig.length && sig[k].type === 'ponct' && sig[k].v === v;
  const estId = (k) => k >= 0 && k < sig.length && sig[k].type === 'id';
  // nom par contexte : `nom = function`, `nom: function`, `'nom': function`, `a.b.nom = function`
  function nomAvant(k) {
    let j = k - 1;
    if (estId(j) && sig[j].v === 'async') j--;
    if (estP(j, '=') || estP(j, ':')) {
      const m = j - 1;
      if (estId(m)) return { nom: sig[m].v, declDebut: sig[m].s };
      if (m >= 0 && sig[m].type === 'str') return { nom: sig[m].v, declDebut: sig[m].s };
    }
    return { nom: null, declDebut: null };
  }
  function finExpression(k) { // première virgule/point-virgule au même niveau, ou fermeture du niveau
    let j = k;
    while (j < sig.length) {
      const t = sig[j];
      if (t.type === 'ponct') {
        if (t.v === ',' || t.v === ';') return sig[j - 1].e;
        if (t.v === ')' || t.v === ']' || t.v === '}') return sig[j - 1].e;
        if ((t.v === '(' || t.v === '[' || t.v === '{') && assoc[j] > j) { j = assoc[j] + 1; continue; }
      }
      j++;
    }
    return sig[sig.length - 1].e;
  }
  const regions = [];
  for (let k = 0; k < sig.length; k++) {
    const t = sig[k];
    if (t.type === 'id' && t.v === 'function' && !estP(k - 1, '.')) {
      let j = k + 1;
      if (estP(j, '*')) j++;
      let nom = null, declDebut = t.s;
      if (estId(j)) { nom = sig[j].v; j++; }
      if (!estP(j, '(') || !estP(assoc[j] + 1, '{')) continue;
      const corps = assoc[j] + 1;
      if (!nom) { const a = nomAvant(k); nom = a.nom; if (a.declDebut !== null) declDebut = a.declDebut; }
      regions.push({ nom, debut: t.s, declDebut, fin: sig[assoc[corps]].e });
    } else if (t.type === 'ponct' && t.v === '=>') {
      let debutK;
      if (estP(k - 1, ')')) debutK = assoc[k - 1];
      else if (estId(k - 1)) debutK = k - 1;
      else continue;
      if (estId(debutK - 1) && sig[debutK - 1].v === 'async') debutK--;
      const fin = estP(k + 1, '{') ? sig[assoc[k + 1]].e : finExpression(k + 1);
      const a = nomAvant(debutK);
      regions.push({ nom: a.nom, debut: sig[debutK].s, declDebut: a.declDebut === null ? sig[debutK].s : a.declDebut, fin });
    } else if (t.type === 'id' && !MOTS_CLES.has(t.v) && estP(k + 1, '(') && estP(assoc[k + 1] + 1, '{') && !estP(k - 1, '.')) {
      // méthode abrégée `nom(…) { … }` dans un littéral d'objet ou une classe
      let j = k - 1;
      if (estId(j) && /^(get|set|static|async)$/.test(sig[j].v)) j--;
      if (!(j < 0 || estP(j, '{') || estP(j, ',') || estP(j, '}') || estP(j, ';'))) continue;
      const corps = assoc[k + 1] + 1;
      regions.push({ nom: t.v, debut: t.s, declDebut: t.s, fin: sig[assoc[corps]].e });
    }
  }
  regions.sort((a, b) => a.declDebut - b.declDebut || b.fin - a.fin);
  const nommees = regions.filter(r => r.nom);
  const ids = sig.filter(t => t.type === 'id');
  // instructions d'export `MC.X(.y)* = …;` au niveau du module : leurs
  // identifiants (simples références) ne comptent pas comme usage au chargement
  const exportsPlages = [];
  for (let k = 0; k < sig.length; k++) {
    if (!(estId(k) && sig[k].v === 'MC' && estP(k + 1, '.'))) continue;
    if (!(k === 0 || estP(k - 1, ';') || estP(k - 1, '{') || estP(k - 1, '}'))) continue;
    let j = k + 1;
    while (estP(j, '.') && estId(j + 1)) j += 2;
    if (!estP(j, '=')) continue;
    let m = j + 1;
    while (m < sig.length && !estP(m, ';')) {
      if (sig[m].type === 'ponct' && (sig[m].v === '(' || sig[m].v === '[' || sig[m].v === '{') && assoc[m] > m) { m = assoc[m] + 1; continue; }
      if (sig[m].type === 'ponct' && (sig[m].v === ')' || sig[m].v === ']' || sig[m].v === '}')) break;
      m++;
    }
    exportsPlages.push({ s: sig[k].s, e: m < sig.length ? sig[m].e : texte.length });
  }
  const dansNommee = (pos) => nommees.some(r => pos >= r.declDebut && pos < r.fin);
  const dansExport = (pos) => exportsPlages.some(p => pos >= p.s && pos < p.e);
  const idsModule = new Set();
  const posId = new Map(); // décalage → index dans sig (pour regarder le jeton suivant)
  sig.forEach((t, k) => { if (t.type === 'id') posId.set(t.s, k); });
  ids.forEach((t) => {
    if (dansNommee(t.s)) return;
    if (dansExport(t.s)) {
      const k = posId.get(t.s);
      if (!estP(k + 1, '(')) return; // simple référence exportée, pas un appel au chargement
    }
    idsModule.add(t.v);
  });
  nommees.forEach((r) => { r.ids = new Set(ids.filter(t => t.s >= r.declDebut && t.s < r.fin).map(t => t.v)); });
  return { ok: true, tous, sig, regions, nommees, idsModule, exportsPlages };
}

function identifiants(texte) {
  try { return new Set(jetons(texte).filter(t => t.type === 'id').map(t => t.v)); }
  catch (e) { return null; }
}

/* Numéros de ligne (1-based) couverts par un jeton */
function indexLignes(texte) {
  const debuts = [0];
  for (let i = 0; i < texte.length; i++) if (texte[i] === '\n') debuts.push(i + 1);
  return function ligneDe(pos) {
    let lo = 0, hi = debuts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (debuts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

/* Fonctions nommées contenant du CODE (pas un commentaire) sur l'une des
   `lignes` du texte : { noms: Set, horsFonction: [ligne…] }. */
function regionsTouchees(decoupe, texte, lignes) {
  const noms = new Set();
  const horsFonction = [];
  if (!lignes || !lignes.length) return { noms, horsFonction };
  const voulues = new Set(lignes);
  const ligneDe = indexLignes(texte);
  decoupe.tous.forEach((t) => {
    if (t.type === 'com') return;
    const l1 = ligneDe(t.s), l2 = ligneDe(Math.max(t.s, t.e - 1));
    let touche = false;
    for (let l = l1; l <= l2 && !touche; l++) if (voulues.has(l)) touche = true;
    if (!touche) return;
    const englobantes = decoupe.nommees.filter(r => t.s >= r.declDebut && t.s < r.fin);
    if (!englobantes.length) { horsFonction.push(l1); return; }
    englobantes.forEach(r => noms.add(r.nom));
  });
  return { noms, horsFonction };
}

function toutesOccurrences(texte, motif) {
  const out = [];
  if (!motif) return out;
  let k = texte.indexOf(motif);
  while (k >= 0) { out.push(k); k = texte.indexOf(motif, k + 1); }
  return out;
}

/* Fonctions EXPORTÉES touchées par un diff d'UN fichier source.
   entree = { nouveau, ancien (null si illisible), lignesNouvelles,
   lignesAnciennes, exports: [{ qual, texte }] (fn.toString()) }.
   Rend { toutLeFichier: bool, raison?, quals: [], noms: [] }. */
function analyserFichierSource(entree) {
  const tout = (raison) => ({ toutLeFichier: true, raison, quals: (entree.exports || []).map(e => e.qual), noms: [] });
  const dn = decouper(entree.nouveau);
  if (!dn.ok) return tout('découpage impossible : ' + dn.erreur);
  const nouv = regionsTouchees(dn, entree.nouveau, entree.lignesNouvelles);
  if (nouv.horsFonction.length) return tout('code modifié hors de toute fonction (ligne ' + nouv.horsFonction[0] + ')');
  const noms = new Set(nouv.noms);
  if (entree.lignesAnciennes && entree.lignesAnciennes.length) {
    if (entree.ancien === null || entree.ancien === undefined) return tout('version précédente illisible');
    const da = decouper(entree.ancien);
    if (!da.ok) return tout('découpage impossible (version précédente) : ' + da.erreur);
    const anc = regionsTouchees(da, entree.ancien, entree.lignesAnciennes);
    if (anc.horsFonction.length) return tout('code retiré hors de toute fonction (ancienne ligne ' + anc.horsFonction[0] + ')');
    anc.noms.forEach(n => noms.add(n));
  }
  if (!noms.size) return { toutLeFichier: false, quals: [], noms: [], commentaires: true };
  // propagation dans le fichier : toute fonction qui nomme une fonction touchée l'est aussi
  const touchees = new Set();
  let change = true;
  while (change) {
    change = false;
    dn.nommees.forEach((r, i) => {
      if (touchees.has(i)) return;
      let t = noms.has(r.nom);
      if (!t) for (const n of noms) if (r.ids.has(n)) { t = true; break; }
      if (t) { touchees.add(i); if (!noms.has(r.nom)) { noms.add(r.nom); } change = true; }
    });
  }
  for (const n of noms) if (dn.idsModule.has(n)) return tout('« ' + n + ' » (touchée) sert au chargement du module');
  const quals = [];
  (entree.exports || []).forEach((e) => {
    const prop = e.qual.split('.').pop();
    if (noms.has(prop)) { quals.push(e.qual); return; }
    const offs = toutesOccurrences(entree.nouveau, e.texte);
    const regs = dn.regions.filter(r => offs.indexOf(r.debut) >= 0);
    if (regs.length) {
      if (regs.some(r => r.nom && dn.nommees.indexOf(r) >= 0 && touchees.has(dn.nommees.indexOf(r)))) quals.push(e.qual);
      return;
    }
    // texte introuvable (fonction liée, fabriquée…) : élargir s'il nomme une fonction touchée
    const idsE = identifiants(e.texte || '');
    if (!idsE || /\[native code\]/.test(e.texte || '')) { quals.push(e.qual); return; }
    for (const n of noms) if (idsE.has(n)) { quals.push(e.qual); return; }
  });
  return { toutLeFichier: false, quals, noms: Array.from(noms) };
}

// ══════════════════════════════════════════════════════════════════════════
// 2. Modules : qui définit quoi (chargement dans un contexte isolé)
// ══════════════════════════════════════════════════════════════════════════
/* Charge les modules src/*.js dans l'ordre de tests/sources-node.js, avec le
   même contexte que tests/run.js, et attribue chaque fonction `MC.X.f` /
   `MC.f` au fichier qui l'a posée (ou remplacée). `lireSource(chemin)` rend
   le texte à charger (fichier indexé, arbre de travail…). Rend
   { parFichier: { 'src/x.js': [{ qual, texte }] }, erreurs: { 'src/x.js': message } }. */
function chargerModules(lireSource, sources) {
  const liste = sources || require('../tests/sources-node.js');
  const ctx = vm.createContext(Object.assign(Object.create(null), {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    Math, JSON, Date, Error, Number, String, Array, Object, Boolean,
    Map, Set, Uint8Array, Float32Array, isNaN, isFinite, parseInt, parseFloat,
    performance: { now: () => Date.now() }, Buffer,
  }));
  ctx.globalThis = ctx;
  const vus = new Map(); // qual → fonction
  const parFichier = {};
  const erreurs = {};
  function instantane() {
    const MC = ctx.MC;
    const out = new Map();
    if (!MC) return out;
    Object.keys(MC).forEach((cle) => {
      let val;
      try { val = MC[cle]; } catch (e) { return; }
      if (typeof val === 'function') { out.set('MC.' + cle, val); return; }
      if (!val || typeof val !== 'object') return;
      Object.keys(val).forEach((f) => {
        let fn;
        try { fn = val[f]; } catch (e) { return; }
        if (typeof fn === 'function') out.set('MC.' + cle + '.' + f, fn);
      });
    });
    return out;
  }
  liste.forEach((nom) => {
    const chemin = 'src/' + nom + '.js';
    let code;
    try { code = lireSource(chemin); } catch (e) { code = null; }
    if (code === null || code === undefined) { erreurs[chemin] = 'source illisible'; return; }
    try { vm.runInContext(code, ctx, { filename: chemin }); }
    catch (e) { erreurs[chemin] = 'chargement impossible : ' + e.message; return; }
    const apres = instantane();
    const definies = [];
    apres.forEach((fn, qual) => {
      if (vus.get(qual) === fn) return;
      let texte = '';
      try { texte = Function.prototype.toString.call(fn); } catch (e) { /* rien */ }
      definies.push({ qual, texte });
    });
    vus.clear(); apres.forEach((fn, q) => vus.set(q, fn));
    parFichier[chemin] = definies;
  });
  return { parFichier, erreurs };
}

// ══════════════════════════════════════════════════════════════════════════
// 3. Carte d'impact (SPEC-BANC-067)
// ══════════════════════════════════════════════════════════════════════════
function cleTest(type, groupe, nom) { // même calcul que tests/catalogue.js
  const g = type === 'e2e' ? 'e2e' : groupe;
  return String(g === undefined || g === null ? '' : g) + ' › ' + String(nom === undefined || nom === null ? '' : nom);
}
const TYPES_OBSERVES = new Set(['unitaire', 'fonctionnel', 'spec']);

/* resultats : resultats.json d'un run COMPLET (préréglage pr, observation des
   fonctions active) ; parFichier : chargerModules(...).parFichier. Seuls les
   tests Node réussis comptent comme « observés » : un test en échec a pu
   s'arrêter avant d'appeler ce qu'il appelle d'habitude. */
function construireCarte(resultats, parFichier, commit, meta) {
  const c = (resultats && resultats.campagne) || {};
  if (!c.observationFonctions) throw new Error('ce run n\'a pas observé les fonctions (--sans-fonctions ?) : pas de carte possible');
  const observes = (resultats.tests || []).filter(t => TYPES_OBSERVES.has(t.type) && (t.etat === 'ok' || t.etat === 'reussi'));
  const tests = Array.from(new Set(observes.map(t => cleTest(t.type, t.groupe, t.nom)))).sort();
  const indice = new Map(tests.map((cle, i) => [cle, i]));
  const fonctions = {};
  observes.forEach((t) => {
    const i = indice.get(cleTest(t.type, t.groupe, t.nom));
    const fns = new Set((t.fonctions || []).concat(Object.keys(t.fonctionsAppels || {})));
    fns.forEach((f) => { (fonctions[f] = fonctions[f] || new Set()).add(i); });
  });
  const fonctionsTriees = {};
  Object.keys(fonctions).sort().forEach((f) => { fonctionsTriees[f] = Array.from(fonctions[f]).sort((a, b) => a - b); });
  const fichiers = {};
  Object.keys(parFichier || {}).sort().forEach((f) => { fichiers[f] = parFichier[f].map(e => e.qual).sort(); });
  return Object.assign({
    version: VERSION_CARTE, commit, construite: new Date().toISOString(),
    preset: c.preset || null, cahier: (meta && meta.cahier) || null,
  }, { fichiers, tests, fonctions: fonctionsTriees });
}

/* Écriture lisible ligne à ligne (diffs git courts) : une fonction ou un
   fichier par ligne. */
function serialiserCarte(carte) {
  const lignes = ['{'];
  ['version', 'commit', 'construite', 'preset', 'cahier'].forEach(k => lignes.push('  ' + JSON.stringify(k) + ': ' + JSON.stringify(carte[k]) + ','));
  const bloc = (nom, obj, dernier) => {
    const cles = Object.keys(obj);
    lignes.push('  ' + JSON.stringify(nom) + ': {');
    cles.forEach((k, i) => lignes.push('    ' + JSON.stringify(k) + ': ' + JSON.stringify(obj[k]) + (i < cles.length - 1 ? ',' : '')));
    lignes.push('  }' + (dernier ? '' : ','));
  };
  bloc('fichiers', carte.fichiers, false);
  lignes.push('  "tests": [');
  carte.tests.forEach((t, i) => lignes.push('    ' + JSON.stringify(t) + (i < carte.tests.length - 1 ? ',' : '')));
  lignes.push('  ],');
  bloc('fonctions', carte.fonctions, true);
  lignes.push('}');
  return lignes.join('\n') + '\n';
}
function ecrireCarte(carte, chemin) {
  const p = chemin || CHEMIN_CARTE;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, serialiserCarte(carte));
  return p;
}
function lireCarte(chemin) {
  try {
    const c = JSON.parse(fs.readFileSync(chemin || CHEMIN_CARTE, 'utf8'));
    if (!c || c.version !== VERSION_CARTE || !c.commit || !c.fonctions || !c.fichiers || !Array.isArray(c.tests)) return null;
    return c;
  } catch (e) { return null; }
}

// ══════════════════════════════════════════════════════════════════════════
// 4. Classement des fichiers touchés
// ══════════════════════════════════════════════════════════════════════════
/* 'neutre' (données du registre) | 'doc' (ne change pas le code : seuls les
   tests qui le lisent) | 'test' (fichier de tests du catalogue) | 'src'
   (module src/*.js) | 'autre' (tout le reste : repli). */
function classerFichier(f, fichiersDeTests) {
  if (/^tests\/registre\//.test(f)) return 'neutre';
  if (fichiersDeTests.has(f)) return 'test';
  if (/\.md$/i.test(f) || /^docs\//.test(f) || f === '.gitignore' || f === '.gitattributes') return 'doc';
  if (/^src\/[^/]+\.js$/.test(f)) return 'src';
  return 'autre';
}

/* Domaines « du fichier » par ressemblance de nom : tools/domaines-touches.js
   devient l'étape 3 du calcul (SPEC-BANC-071) — peut être vide. */
const { domainesDuFichier } = require('./domaines-touches.js');

// ══════════════════════════════════════════════════════════════════════════
// 5. Calcul du périmètre (pur : toutes les entrées sont fournies)
// ══════════════════════════════════════════════════════════════════════════
/* entree = {
     catalogue: [{ cle, nom, type, fichier, domaines, fonctions, etiquettes }],
     carte, ecart (nombre de commits entre la carte et la cible, ou null si
     inconnu), ecartMax,
     fichiers: [{ chemin, statut: 'A'|'M'|'D' }],
     analyses: { 'src/x.js': analyserFichierSource(...) } (fichiers src
       touchés et chargés),
     erreursChargement: { 'src/x.js': message },
     captures: function (prop) → ['src/y.js'…] (fichiers qui citent `.prop`
       sans l'appeler), facultatif,
     exportsParFichier: { 'src/x.js': [qual…] } (version courante),
     mentions: { [cle]: Set(identifiants du test, corps + code commun du
       fichier) }, idsFichierTest: { 'tests/x.js': Set }, texteFichierTest:
       { 'tests/x.js': texte brut },
     fumee: [noms], domainesConnus: [..] }
   Rend { repli: null | motif, tests: { cle: [raisons] }, fichiers,
   fonctions, details }. */
function calculerPerimetre(entree) {
  const e = entree;
  const fichiersDeTests = new Set(e.catalogue.map(t => t.fichier).filter(Boolean));
  const res = { repli: null, tests: {}, fichiers: e.fichiers.map(f => f.chemin), fonctions: [], details: [] };
  const replier = (motif) => { res.repli = motif; return res; };
  const ajouter = (cle, raison) => { const l = res.tests[cle] = res.tests[cle] || []; if (l.indexOf(raison) < 0) l.push(raison); };

  if (!e.fichiers.length) res.details.push('aucun fichier touché');
  const classes = e.fichiers.map(f => ({ f, classe: classerFichier(f.chemin, fichiersDeTests) }));
  const autres = classes.filter(x => x.classe === 'autre');
  if (autres.length) return replier('fichier hors src/ et hors fichiers de test : ' + autres.map(x => x.f.chemin).slice(0, 5).join(', '));
  const srcs = classes.filter(x => x.classe === 'src');
  if (srcs.length) {
    if (!e.carte) return replier('carte d\'impact absente ou illisible (tests/registre/impact.json)');
    if (e.ecart === null || e.ecart === undefined) return replier('carte construite sur un commit hors de l\'historique courant (' + String(e.carte.commit).slice(0, 10) + ')');
    if (e.ecart > e.ecartMax) return replier('carte trop ancienne : ' + e.ecart + ' commits depuis ' + String(e.carte.commit).slice(0, 10) + ' (maximum ' + e.ecartMax + ')');
    for (const x of srcs) {
      if (x.f.statut === 'D') return replier('module supprimé : ' + x.f.chemin);
      if (!e.carte.fichiers[x.f.chemin]) return replier('module absent de la carte (nouveau, ou non chargé sous Node) : ' + x.f.chemin);
      if (e.erreursChargement && e.erreursChargement[x.f.chemin]) return replier('module illisible : ' + x.f.chemin + ' — ' + e.erreursChargement[x.f.chemin]);
      if (!e.analyses[x.f.chemin]) return replier('analyse impossible : ' + x.f.chemin);
    }
  }

  const testsCarte = new Set(e.carte ? e.carte.tests : []);
  const parFichierTest = {};
  e.catalogue.forEach((t) => { (parFichierTest[t.fichier] = parFichierTest[t.fichier] || []).push(t); });

  // 1) fichier de test modifié → tous ses tests
  classes.filter(x => x.classe === 'test').forEach((x) => {
    (parFichierTest[x.f.chemin] || []).forEach(t => ajouter(t.cle, 'fichier-de-test'));
  });

  // 2) fonctions touchées → tests de la carte (+ propagation par captures)
  const quals = new Set();
  const fichiersEntiers = new Set();
  srcs.forEach((x) => {
    const a = e.analyses[x.f.chemin];
    if (a.toutLeFichier) { fichiersEntiers.add(x.f.chemin); res.details.push(x.f.chemin + ' : tout le fichier (' + a.raison + ')'); }
    else res.details.push(x.f.chemin + ' : ' + (a.commentaires ? 'commentaires seulement' : (a.quals.length ? a.quals.length + ' fonction(s) exportée(s) touchée(s)' : 'aucune fonction exportée touchée (fonction interne non appelée)')));
    a.quals.forEach(q => quals.add(q));
  });
  const fonctionsDuFichier = (f) => Array.from(new Set(((e.exportsParFichier || {})[f] || []).concat((e.carte && e.carte.fichiers[f]) || [])));
  fichiersEntiers.forEach(f => fonctionsDuFichier(f).forEach(q => quals.add(q)));
  if (e.captures) {
    // une fonction touchée capturée ailleurs sans être appelée → ce module entier
    let aTraiter = Array.from(quals);
    const dejaVu = new Set();
    while (aTraiter.length) {
      const q = aTraiter.pop();
      if (dejaVu.has(q)) continue;
      dejaVu.add(q);
      e.captures(q.split('.').pop()).forEach((f) => {
        if (fichiersEntiers.has(f)) return;
        fichiersEntiers.add(f);
        res.details.push(f + ' : tout le fichier (capture de ' + q + ')');
        fonctionsDuFichier(f).forEach((q2) => { if (!quals.has(q2)) { quals.add(q2); aTraiter.push(q2); } });
      });
    }
  }
  res.fonctions = Array.from(quals).sort();
  const indexTests = e.carte ? e.carte.tests : [];
  res.fonctions.forEach((q) => {
    ((e.carte && e.carte.fonctions[q]) || []).forEach(i => { if (indexTests[i]) ajouter(indexTests[i], 'fonction:' + q); });
  });
  // mentions : un test qui nomme une fonction touchée (fabriques partagées
  // construites hors du test, jamais observées)
  if (e.mentions && res.fonctions.length) {
    const parQual = res.fonctions.map(q => { const p = q.split('.'); return { q, ns: p.length === 3 ? p[1] : null, f: p[p.length - 1] }; });
    e.catalogue.forEach((t) => {
      const ids = e.mentions[t.cle];
      if (!ids) return;
      const idsFichier = (e.idsFichierTest || {})[t.fichier] || ids;
      for (const m of parQual) {
        if (ids.has(m.f) && (!m.ns || idsFichier.has(m.ns))) { ajouter(t.cle, 'mention:' + m.q); break; }
      }
    });
  }
  // un fichier entier touché : tout test dont le fichier nomme son espace
  fichiersEntiers.forEach((f) => {
    const espaces = new Set(fonctionsDuFichier(f).map(q => q.split('.')).map(p => (p.length === 3 ? p[1] : p[1])));
    e.catalogue.forEach((t) => {
      const idsF = (e.idsFichierTest || {})[t.fichier];
      if (!idsF) return;
      for (const ns of espaces) if (idsF.has(ns)) { ajouter(t.cle, 'mention:MC.' + ns); break; }
    });
  });
  // lecture : un fichier de test qui cite le nom du fichier touché (src ou doc)
  classes.filter(x => x.classe === 'src' || x.classe === 'doc').forEach((x) => {
    const base = path.basename(x.f.chemin);
    const re = new RegExp('(^|[^\\w.-])' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w-])');
    Object.keys(e.texteFichierTest || {}).forEach((ft) => {
      if (!re.test(e.texteFichierTest[ft])) return;
      (parFichierTest[ft] || []).forEach(t => ajouter(t.cle, 'lecture:' + x.f.chemin));
    });
  });

  // 3) tests sans données d'impact : domaine ou fonction déclarée en commun
  if (srcs.length) {
    const domaines = new Set();
    srcs.forEach(x => domainesDuFichier(x.f.chemin, e.domainesConnus || []).forEach(d => domaines.add(d)));
    // domaines des tests retenus par la carte pour ces fonctions (élargissement)
    e.catalogue.forEach((t) => {
      const r = res.tests[t.cle];
      if (r && r.some(x => /^fonction:/.test(x))) (t.domaines || []).forEach(d => domaines.add(d));
    });
    res.domaines = Array.from(domaines).sort();
    e.catalogue.forEach((t) => {
      if (testsCarte.has(t.cle)) return;
      const d = (t.domaines || []).find(x => domaines.has(x));
      if (d) { ajouter(t.cle, 'domaine:' + d); return; }
      const f = (t.fonctions || []).find(x => quals.has(x));
      if (f) ajouter(t.cle, 'fonction-declaree:' + f);
    });
  }

  // 4) toujours : fumée et @toujours
  const fumee = new Set(e.fumee || []);
  e.catalogue.forEach((t) => {
    if (fumee.has(t.nom)) ajouter(t.cle, 'fumee');
    if ((t.etiquettes || []).indexOf('toujours') >= 0) ajouter(t.cle, 'toujours');
  });
  return res;
}

/* SPEC-BANC-076 : échecs d'un run complet que le périmètre n'aurait PAS
   retenus — signal de la fiabilité de la carte. */
function trousDePerimetre(testsResultats, perimetre) {
  if (!perimetre || perimetre.repli) return [];
  return (testsResultats || []).filter(t => t.etat === 'echec' || t.etat === 'delai')
    .map(t => ({ cle: cleTest(t.type, t.groupe, t.nom), nom: t.nom }))
    .filter(t => !perimetre.tests[t.cle]);
}

/* Contrôle complet d'un run (tests/run.js) : `calculer(ref)` rend le
   périmètre « depuis ref » (fichiers changés depuis le commit de la carte).
   Rend { verifie, carte, repli?, fichiers?, trous: [{ cle, nom }], motif? }. */
function controlerTrous(testsResultats, carte, calculer) {
  const echoues = (testsResultats || []).filter(t => t.etat === 'echec' || t.etat === 'delai');
  if (!echoues.length) return { verifie: true, carte: carte ? carte.commit : null, trous: [] };
  if (!carte) return { verifie: false, motif: 'pas de carte d\'impact', trous: [] };
  const perim = calculer(carte.commit);
  return { verifie: true, carte: carte.commit, repli: perim.repli || null, fichiers: perim.fichiers, trous: trousDePerimetre(echoues, perim) };
}

// ══════════════════════════════════════════════════════════════════════════
// 6. Accès git et assemblage (utilisé par tests/run.js)
// ══════════════════════════════════════════════════════════════════════════
function git(racine, args) {
  // chemins jamais entre guillemets (accents) : sinon un fichier serait mal classé
  return execFileSync('git', ['-c', 'core.quotepath=off'].concat(args), { cwd: racine, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}
function gitOuNull(racine, args) { try { return git(racine, args); } catch (e) { return null; } }

/* Lignes touchées par fichier, depuis `git diff -U0` : nouvelles (côté +) et
   anciennes (côté −). */
function plagesDuDiff(sortie) {
  const out = {};
  let courant = null;
  (sortie || '').split('\n').forEach((l) => {
    let m;
    if ((m = /^\+\+\+ b\/(.*)$/.exec(l))) { courant = m[1]; out[courant] = out[courant] || { nouvelles: [], anciennes: [] }; return; }
    if (/^\+\+\+ \/dev\/null/.test(l)) { courant = null; return; }
    if ((m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(l)) && courant) {
      const a = +m[1], b = m[2] === undefined ? 1 : +m[2], c = +m[3], d = m[4] === undefined ? 1 : +m[4];
      for (let k = 0; k < b; k++) out[courant].anciennes.push(a + k);
      for (let k = 0; k < d; k++) out[courant].nouvelles.push(c + k);
    }
  });
  return out;
}

/* Rassemble tout ce dont calculerPerimetre a besoin, depuis git.
   o = { racine, mode: 'commit'|'depuis', depuis, catalogue, suites (T.suites,
   pour le corps des tests), fichiersSimules: [chemins] (touchés EN ENTIER,
   sans git — portes et tests), cheminCarte, ecartMax, fumee, domainesConnus } */
function perimetreDepuisGit(o) {
  const racine = o.racine || RACINE;
  const carte = lireCarte(o.cheminCarte);
  const ecartMax = o.ecartMax === undefined || o.ecartMax === null || isNaN(+o.ecartMax) ? ECART_MAX_DEFAUT : +o.ecartMax;
  const base = { mode: o.mode, depuis: o.depuis || null, carte: carte ? { commit: carte.commit, construite: carte.construite } : null };
  const echec = (motif) => Object.assign({ repli: motif, tests: {}, fichiers: [], fonctions: [], details: [] }, base);
  let fichiers = [], plages = {}, refAncienne = null, lireNouveau, lireAncien;
  try {
    if (o.fichiersSimules && o.fichiersSimules.length) {
      fichiers = o.fichiersSimules.map(c => ({ chemin: c.replace(/\\/g, '/'), statut: 'M' }));
      lireNouveau = (c) => fs.readFileSync(path.join(racine, c), 'utf8');
      lireAncien = () => null;
    } else if (o.mode === 'depuis') {
      if (!o.depuis || !/^[\w./~^@{}-]+$/.test(o.depuis)) return echec('référence invalide : ' + o.depuis);
      const mb = git(racine, ['merge-base', o.depuis, 'HEAD']).trim();
      refAncienne = mb;
      const ns = git(racine, ['diff', '--name-status', '--no-renames', mb]).split('\n').filter(Boolean);
      fichiers = ns.map(l => { const p = l.split('\t'); return { chemin: p[1], statut: p[0][0] }; });
      git(racine, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)
        .forEach(c => fichiers.push({ chemin: c, statut: 'A' }));
      plages = plagesDuDiff(git(racine, ['diff', '-U0', '--no-renames', '--no-color', mb]));
      lireNouveau = (c) => fs.readFileSync(path.join(racine, c), 'utf8');
    } else {
      const ns = git(racine, ['diff', '--cached', '--name-status', '--no-renames']).split('\n').filter(Boolean);
      fichiers = ns.map(l => { const p = l.split('\t'); return { chemin: p[1], statut: p[0][0] }; });
      plages = plagesDuDiff(git(racine, ['diff', '--cached', '-U0', '--no-renames', '--no-color']));
      refAncienne = gitOuNull(racine, ['rev-parse', '--verify', '-q', 'HEAD']) ? 'HEAD' : null;
      const indexes = new Set(fichiers.map(f => f.chemin));
      lireNouveau = (c) => (indexes.has(c) ? git(racine, ['show', ':' + c]) : fs.readFileSync(path.join(racine, c), 'utf8'));
    }
    if (!lireAncien) lireAncien = (c) => (refAncienne ? gitOuNull(racine, ['show', refAncienne + ':' + c]) : null);
  } catch (err) { return echec('git indisponible : ' + String(err.message || err).split('\n')[0]); }

  // écart entre la carte et HEAD
  let ecart = null;
  if (carte) {
    const anc = gitOuNull(racine, ['merge-base', '--is-ancestor', carte.commit, 'HEAD']) !== null;
    if (anc) { const n = gitOuNull(racine, ['rev-list', '--count', carte.commit + '..HEAD']); ecart = n === null ? null : parseInt(n, 10); }
  }

  const srcTouches = fichiers.filter(f => /^src\/[^/]+\.js$/.test(f.chemin) && f.statut !== 'D');
  const analyses = {}, exportsParFichier = {};
  let erreursChargement = {};
  let modules = null;
  if (srcTouches.length) {
    modules = chargerModules((c) => lireNouveau(c));
    erreursChargement = modules.erreurs;
    Object.keys(modules.parFichier).forEach(f => { exportsParFichier[f] = modules.parFichier[f].map(x => x.qual); });
    srcTouches.forEach((f) => {
      if (!modules.parFichier[f.chemin]) return;
      let nouveau;
      try { nouveau = lireNouveau(f.chemin); } catch (err) { return; }
      const p = plages[f.chemin];
      if (o.fichiersSimules && o.fichiersSimules.length) {
        analyses[f.chemin] = { toutLeFichier: true, raison: 'fichier désigné en entier (--fichiers)', quals: modules.parFichier[f.chemin].map(x => x.qual), noms: [] };
        return;
      }
      if (f.statut === 'A' || !p) { analyses[f.chemin] = { toutLeFichier: true, raison: 'fichier nouveau ou sans diff lisible', quals: modules.parFichier[f.chemin].map(x => x.qual), noms: [] }; return; }
      analyses[f.chemin] = analyserFichierSource({
        nouveau, ancien: p.anciennes.length ? lireAncien(f.chemin) : null,
        lignesNouvelles: p.nouvelles, lignesAnciennes: p.anciennes, exports: modules.parFichier[f.chemin],
      });
    });
  }
  // captures : `.prop` cité sans être appelé dans un AUTRE module chargé
  const idsSources = {};
  function captures(prop) {
    if (!modules) return [];
    const out = [];
    Object.keys(modules.parFichier).forEach((f) => {
      if (!idsSources[f]) {
        let toks = null;
        try { toks = jetons(lireNouveau(f)).filter(t => t.type !== 'com'); } catch (err) { toks = null; }
        idsSources[f] = toks;
      }
      const toks = idsSources[f];
      if (!toks) { out.push(f); return; } // illisible : prudence
      for (let k = 1; k < toks.length; k++) {
        if (toks[k].type === 'id' && toks[k].v === prop && toks[k - 1].type === 'ponct' && (toks[k - 1].v === '.' || toks[k - 1].v === '?.')) {
          const suiv = toks[k + 1];
          if (!(suiv && suiv.type === 'ponct' && suiv.v === '(')) { out.push(f); break; }
        }
      }
    });
    return out;
  }
  // mentions : identifiants du corps de chaque test + code commun de son fichier
  const corpsParGroupeNom = new Map();
  (o.suites || []).forEach((s) => (s.tests || []).forEach((t) => {
    let txt = '';
    try { txt = Function.prototype.toString.call(t.fn); } catch (err) { /* rien */ }
    corpsParGroupeNom.set(s.name + '\u0000' + t.name, txt);
  }));
  const texteFichierTest = {}, idsFichierTest = {}, residuel = {};
  const fichiersCat = Array.from(new Set(o.catalogue.map(t => t.fichier).filter(Boolean)));
  fichiersCat.forEach((ft) => {
    try { texteFichierTest[ft] = fs.readFileSync(path.join(racine, ft), 'utf8'); } catch (err) { texteFichierTest[ft] = ''; }
  });
  const mentions = {};
  if (srcTouches.length) {
    fichiersCat.forEach((ft) => { idsFichierTest[ft] = identifiants(texteFichierTest[ft]) || new Set(); });
    const corpsParFichier = {};
    o.catalogue.forEach((t) => {
      const corps = corpsParGroupeNom.get(t.groupe + '\u0000' + t.nom);
      if (corps) (corpsParFichier[t.fichier] = corpsParFichier[t.fichier] || []).push(corps);
    });
    fichiersCat.forEach((ft) => {
      let r = texteFichierTest[ft];
      (corpsParFichier[ft] || []).forEach((c) => { if (c) r = r.split(c).join(''); });
      residuel[ft] = identifiants(r) || idsFichierTest[ft];
    });
    o.catalogue.forEach((t) => {
      const corps = corpsParGroupeNom.get(t.groupe + '\u0000' + t.nom);
      const ids = new Set(residuel[t.fichier] || []);
      const idsCorps = corps ? identifiants(corps) : null;
      if (idsCorps) idsCorps.forEach(x => ids.add(x));
      else if (t.type === 'unitaire' || t.type === 'fonctionnel' || t.type === 'spec') (idsFichierTest[t.fichier] || []).forEach(x => ids.add(x));
      mentions[t.cle] = ids;
    });
  }
  const res = calculerPerimetre({
    catalogue: o.catalogue, carte, ecart, ecartMax, fichiers, analyses, erreursChargement, exportsParFichier,
    captures, mentions, idsFichierTest, texteFichierTest, fumee: o.fumee || [], domainesConnus: o.domainesConnus || [],
  });
  return Object.assign(res, base, { ecart, ecartMax });
}

/* Reconstruit la carte depuis un cahier local (tests/resultats/<dossier>).
   o.racineResultats / o.chemin (tests). Rend { ok, chemin, commit, ... }. */
function reconstruireCarte(dossierCahier, o) {
  const opts = o || {};
  const racine = opts.racine || RACINE;
  const racineResultats = opts.racineResultats || path.join(racine, 'tests', 'resultats');
  let resultats;
  try { resultats = JSON.parse(fs.readFileSync(path.join(racineResultats, dossierCahier, 'resultats.json'), 'utf8')); }
  catch (e) { return { ok: false, motif: 'cahier illisible : ' + dossierCahier }; }
  const c = resultats.campagne || {};
  if (c.interrompue) return { ok: false, motif: 'campagne interrompue : pas de carte' };
  if (c.perimetre && c.perimetre !== 'complet') return { ok: false, motif: 'run restreint (' + c.perimetre + ') : seuls les runs complets alimentent la carte' };
  const env = c.environnement || {};
  const commit = gitOuNull(racine, ['rev-parse', env.commit || 'HEAD']);
  if (!commit) return { ok: false, motif: 'commit du cahier introuvable' };
  const modules = chargerModules(cheminRel => fs.readFileSync(path.join(racine, cheminRel), 'utf8'));
  let carte;
  try { carte = construireCarte(resultats, modules.parFichier, commit.trim(), { cahier: dossierCahier }); }
  catch (e) { return { ok: false, motif: e.message }; }
  const chemin = ecrireCarte(carte, opts.chemin);
  return { ok: true, chemin, commit: carte.commit, tests: carte.tests.length, fonctions: Object.keys(carte.fonctions).length, fichiers: Object.keys(carte.fichiers).length };
}

module.exports = {
  CHEMIN_CARTE, ECART_MAX_DEFAUT, VERSION_CARTE,
  jetons, decouper, identifiants, analyserFichierSource, chargerModules,
  cleTest, construireCarte, serialiserCarte, ecrireCarte, lireCarte, reconstruireCarte,
  classerFichier, domainesDuFichier, calculerPerimetre, trousDePerimetre, controlerTrous, plagesDuDiff, perimetreDepuisGit,
};

// ══════════════════════════════════════════════════════════════════════════
// Ligne de commande
// ══════════════════════════════════════════════════════════════════════════
if (require.main === module) {
  const args = process.argv.slice(2);
  const option = (nom) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : null; };
  const drapeau = (nom) => args.includes(nom);
  if (args[0] === 'carte') {
    let dossier = args[1] && !args[1].startsWith('--') ? args[1] : null;
    if (!dossier) {
      const rr = path.join(RACINE, 'tests', 'resultats');
      const ds = fs.existsSync(rr) ? fs.readdirSync(rr).filter(d => /_pr$/.test(d)).sort() : [];
      dossier = ds[ds.length - 1];
    }
    if (!dossier) { console.error('aucun cahier de préréglage pr dans tests/resultats/'); process.exit(1); }
    const r = reconstruireCarte(dossier);
    console.log(JSON.stringify(r));
    process.exit(r.ok ? 0 : 1);
  }
  const transmis = ['--perimetre-json'];
  if (option('--depuis')) transmis.push('--depuis', option('--depuis')); else transmis.push('--perimetre', 'commit');
  ['--fichiers', '--ecart-max', '--preset', '--carte'].forEach((k) => { if (option(k)) transmis.push(k, option(k)); });
  const r = spawnSync(process.execPath, [path.join(RACINE, 'tests', 'run.js')].concat(transmis), { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) { process.stderr.write(r.stderr || ''); process.stderr.write(r.stdout || ''); process.exit(r.status || 2); }
  if (drapeau('--json')) { process.stdout.write(r.stdout); process.exit(0); }
  let p;
  try { p = JSON.parse(r.stdout); } catch (e) { console.error('sortie illisible de tests/run.js'); process.exit(2); }
  console.log('Périmètre ' + (p.mode === 'depuis' ? 'depuis ' + p.depuis : 'du commit (fichiers indexés)'));
  console.log('fichiers touchés : ' + (p.fichiers.join(', ') || '(aucun)'));
  if (p.repli) console.log('REPLI sur la suite complète : ' + p.repli);
  else {
    console.log('fonctions touchées : ' + (p.fonctions.join(', ') || '(aucune)'));
    (p.details || []).forEach(d => console.log('  · ' + d));
  }
  if (drapeau('--lister') || !p.repli) {
    p.selection.forEach(t => console.log('[' + t.type + '] ' + t.groupe + ' :: ' + t.nom + (t.raisons ? '  ← ' + t.raisons.join(', ') : '')));
  }
  console.log('\n' + p.selection.length + ' test(s) retenu(s), ' + p.exclus + ' exclu(s)' + (p.repli ? ' (repli : suite complète)' : '') + '.');
}
