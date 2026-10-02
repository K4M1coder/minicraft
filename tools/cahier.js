#!/usr/bin/env node
/* tools/cahier.js — bibliothèque des cahiers de test enregistrés
   (SPEC-BANC-018 à 022) : lister, comparer, conserver, supprimer, exporter
   (HTML autonome, PDF, Word). Module Node (CommonJS) réutilisé par server.js
   (routes /tests/cahiers*) ET par cette même CLI :

     node tools/cahier.js --lister
     node tools/cahier.js --comparer <dossierA> <dossierB>
     node tools/cahier.js --exporter <dossier> --format html|pdf|docx [--sortie fichier]
     node tools/cahier.js --conserver <dossier> [--non]
     node tools/cahier.js --supprimer <dossier>

   Sécurité (même règle que SPEC-BANC-015) : tout `dossier` fourni est
   comparé à la liste RÉELLE des cahiers (listerCahiers()) — jamais un chemin
   construit directement à partir de l'entrée, ce qui élimine la traversée
   de répertoire par construction. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const RT = require('./resultats-tests.js');
const { construireDocx } = require('./docx.js');

const RACINE = path.join(__dirname, '..');

// ── chargement de tests/rapport.js (module UMD, pas CommonJS) ──────────────
let _rapportCache = null;
function chargerRapport() {
  if (!_rapportCache) {
    const vm = require('vm');
    const ctx = vm.createContext({ console, Math, JSON, Date, Error, Number, String, Array, Object, Boolean });
    ctx.globalThis = ctx;
    vm.runInContext(fs.readFileSync(path.join(RACINE, 'tests', 'rapport.js'), 'utf8'), ctx, { filename: 'rapport.js' });
    _rapportCache = ctx.MC_RAPPORT;
  }
  return _rapportCache;
}

// ── lecture d'un cahier ──────────────────────────────────────────────────
function cheminResultats(racine, dossier) { return path.join(racine, dossier, 'resultats.json'); }

function lireResultats(racine, dossier) {
  return JSON.parse(fs.readFileSync(cheminResultats(racine, dossier), 'utf8'));
}

/* Un cahier est « conservé » quand campagne.conserve === true : la rotation
   des N derniers (tools/resultats-tests.js, elaguer()) ne le supprime
   jamais — voir sa mise à jour dans ce même lot. */
function listerCahiers(racine) {
  const r = racine || RT.DOSSIER_RESULTATS;
  if (!fs.existsSync(r)) return [];
  return fs.readdirSync(r, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map((d) => {
      const p = cheminResultats(r, d.name);
      if (!fs.existsSync(p)) return null;
      let j;
      try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
      // « null » ou un nombre est du JSON valide mais pas un cahier : il
      // faisait lever TOUTE la liste (page des cahiers vide) — SPEC-BANC-120
      if (!j || typeof j !== 'object') return null;
      const c = (j.campagne && typeof j.campagne === 'object') ? j.campagne : {};
      return {
        dossier: d.name, preset: c.preset || null,
        source: (c.environnement && c.environnement.source) || 'node',
        totaux: c.totaux || null, duree_ms: c.duree_ms || null,
        versionJeu: (c.environnement && c.environnement.versionJeu) || null,
        commit: (c.environnement && c.environnement.commit) || null,
        interrompue: !!c.interrompue, conserve: !!c.conserve,
        debut: c.debut || null, fin: c.fin || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.debut).localeCompare(String(a.debut)));
}

function estCahierValide(racine, dossier) {
  // jamais de chemin construit sur la foi de l'entrée : on vérifie contre la VRAIE liste
  return listerCahiers(racine).some(c => c.dossier === dossier);
}

// ── comparaison de deux cahiers (SPEC-BANC-018) ─────────────────────────
function compareCahiers(racine, dossierA, dossierB) {
  if (!estCahierValide(racine, dossierA) || !estCahierValide(racine, dossierB)) {
    return { ok: false, motif: 'cahier introuvable' };
  }
  const a = lireResultats(racine, dossierA), b = lireResultats(racine, dossierB);
  const parIdA = new Map((a.tests || []).map(t => [t.id || t.nom, t]));
  const parIdB = new Map((b.tests || []).map(t => [t.id || t.nom, t]));
  const apparus = [], disparus = [], versEchec = [], versOk = [], ecartsDuree = [];
  parIdB.forEach((t, id) => { if (!parIdA.has(id)) apparus.push(t.nom); });
  parIdA.forEach((t, id) => { if (!parIdB.has(id)) disparus.push(t.nom); });
  parIdA.forEach((tA, id) => {
    const tB = parIdB.get(id);
    if (!tB) return;
    const okA = tA.etat === 'ok', okB = tB.etat === 'ok';
    if (okA && !okB) versEchec.push(tB.nom);
    if (!okA && okB) versOk.push(tB.nom);
    const delta = (tB.duree_ms || 0) - (tA.duree_ms || 0);
    if (Math.abs(delta) > 200) ecartsDuree.push({ nom: tA.nom, avant: tA.duree_ms, apres: tB.duree_ms, delta });
  });
  return {
    ok: true, dossierA, dossierB, apparus, disparus, versEchec, versOk,
    ecartsDuree: ecartsDuree.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)),
  };
}

// ── conserver / supprimer ────────────────────────────────────────────────
function marquerConserve(racine, dossier, valeur) {
  if (!estCahierValide(racine, dossier)) return { ok: false, motif: 'cahier introuvable' };
  const p = cheminResultats(racine, dossier);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.campagne = j.campagne || {};
  j.campagne.conserve = !!valeur;
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
  return { ok: true };
}

function supprimerCahier(racine, dossier) {
  if (!estCahierValide(racine, dossier)) return { ok: false, motif: 'cahier introuvable' };
  const j = lireResultats(racine, dossier);
  if (j.campagne && j.campagne.conserve) return { ok: false, motif: 'cahier conservé : à libérer avant suppression' };
  fs.rmSync(path.join(racine, dossier), { recursive: true, force: true });
  return { ok: true };
}

// ── export HTML autonome / .docx : enrichit le modèle avec les octets ─────
function extensionDe(fichier) { const m = /\.(\w+)$/.exec(fichier || ''); return m ? m[1].toLowerCase() : 'jpg'; }
const MIME_PAR_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function construireModeleEnrichi(racine, dossier, { pourDocx } = {}) {
  const resultats = lireResultats(racine, dossier);
  const MC_RAPPORT = chargerRapport();
  const modele = MC_RAPPORT.modele(resultats);
  const capturesDir = path.join(racine, dossier, 'captures');
  modele.blocs.forEach((b) => {
    if (b.type !== 'image' || !b.fichier) return;
    const p = path.join(capturesDir, b.fichier);
    if (!fs.existsSync(p)) return;
    const donnees = fs.readFileSync(p);
    const ext = extensionDe(b.fichier);
    b.mime = ext;
    if (pourDocx) b.donnees = donnees;
    else b.src = 'data:' + (MIME_PAR_EXT[ext] || 'image/jpeg') + ';base64,' + donnees.toString('base64');
  });
  return { modele, MC_RAPPORT };
}

function exporterHTML(racine, dossier) {
  const { modele, MC_RAPPORT } = construireModeleEnrichi(racine, dossier, { pourDocx: false });
  return Buffer.from(MC_RAPPORT.html(modele), 'utf8');
}

function exporterDocx(racine, dossier) {
  const { modele } = construireModeleEnrichi(racine, dossier, { pourDocx: true });
  return construireDocx(modele);
}

// ── PDF : navigateur headless détecté automatiquement, sinon repli ────────
const CHEMINS_NAVIGATEUR = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];
const COMMANDES_NAVIGATEUR = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];

function trouverNavigateur(cheminForce) {
  if (cheminForce) return fs.existsSync(cheminForce) ? cheminForce : null;
  for (const p of CHEMINS_NAVIGATEUR) if (fs.existsSync(p)) return p;
  const chercheur = process.platform === 'win32' ? 'where' : 'which';
  for (const cmd of COMMANDES_NAVIGATEUR) {
    try { const out = execFileSync(chercheur, [cmd], { encoding: 'utf8' }).split('\n')[0].trim(); if (out) return out; }
    catch (e) { /* pas trouvé, suivant */ }
  }
  return null;
}

/* Rend le cahier en PDF via un navigateur headless. Si aucun n'est trouvé,
   renvoie { ok:false, repli:'html', page } : c'est à l'appelant (route ou
   CLI) de proposer l'impression de cette page (SPEC-BANC-020, « à défaut »). */
function exporterPDF(racine, dossier, options) {
  const opts = options || {};
  const navigateur = trouverNavigateur(opts.navigateur);
  const pageHTML = exporterHTML(racine, dossier);
  if (!navigateur) return { ok: false, repli: 'html', page: pageHTML };

  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cahier-'));
  const fichierHTML = path.join(tmp, 'cahier.html');
  const fichierPDF = path.join(tmp, 'cahier.pdf');
  fs.writeFileSync(fichierHTML, pageHTML);
  const r = spawnSync(navigateur, [
    '--headless', '--disable-gpu', '--no-sandbox',
    '--print-to-pdf=' + fichierPDF, '--print-to-pdf-no-header',
    'file:///' + fichierHTML.replace(/\\/g, '/'),
  ], { timeout: 30000 });
  let pdf = null;
  try { pdf = fs.readFileSync(fichierPDF); } catch (e) { /* le navigateur a échoué */ }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* rien */ }
  if (!pdf || !pdf.length) return { ok: false, repli: 'html', page: pageHTML, motif: (r.stderr || '').toString().slice(0, 300) };
  return { ok: true, pdf };
}

// ── CLI ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const option = (nom) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : null; };
  const drapeau = (nom) => args.includes(nom);
  const racine = RT.DOSSIER_RESULTATS;

  if (drapeau('--lister')) {
    listerCahiers(racine).forEach((c) => {
      console.log(c.dossier + '  ' + (c.preset || '?') + '  ' + (c.source || '?') +
        '  ' + (c.totaux ? c.totaux.passes + '/' + c.totaux.total : '?') +
        (c.interrompue ? '  [interrompue]' : '') + (c.conserve ? '  [conservé]' : ''));
    });
    process.exit(0);
  }
  if (drapeau('--comparer')) {
    const i = args.indexOf('--comparer');
    const r = compareCahiers(racine, args[i + 1], args[i + 2]);
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  if (drapeau('--conserver')) {
    const dossier = option('--conserver');
    const r = marquerConserve(racine, dossier, !drapeau('--non'));
    console.log(JSON.stringify(r));
    process.exit(r.ok ? 0 : 1);
  }
  if (drapeau('--supprimer')) {
    const r = supprimerCahier(racine, option('--supprimer'));
    console.log(JSON.stringify(r));
    process.exit(r.ok ? 0 : 1);
  }
  if (drapeau('--exporter')) {
    const dossier = option('--exporter');
    const format = option('--format') || 'html';
    if (!estCahierValide(racine, dossier)) { console.error('cahier introuvable : ' + dossier); process.exit(1); }
    let contenu, ext;
    if (format === 'html') { contenu = exporterHTML(racine, dossier); ext = 'html'; }
    else if (format === 'docx') { contenu = exporterDocx(racine, dossier); ext = 'docx'; }
    else if (format === 'pdf') {
      const r = exporterPDF(racine, dossier);
      if (!r.ok) { console.error('aucun navigateur trouvé pour le PDF — export HTML autonome à la place (imprimez-le, Ctrl+P)'); contenu = r.page; ext = 'html'; }
      else { contenu = r.pdf; ext = 'pdf'; }
    } else { console.error('format inconnu : ' + format); process.exit(1); }
    const sortie = option('--sortie') || (dossier + '.' + ext);
    fs.writeFileSync(sortie, contenu);
    console.log('écrit : ' + sortie);
    process.exit(0);
  }
  console.log('Usage : node tools/cahier.js --lister | --comparer A B | --exporter D --format html|pdf|docx [--sortie f] | --conserver D [--non] | --supprimer D');
}

module.exports = {
  listerCahiers, estCahierValide, compareCahiers, marquerConserve, supprimerCahier,
  exporterHTML, exporterDocx, exporterPDF, trouverNavigateur, construireModeleEnrichi,
};
