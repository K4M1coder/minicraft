/* run.js — exécute les tests de logique pure sous Node, à partir du catalogue
   unique du lot L42 (tests/catalogue.js, tests/presets.js). Écrit à la fin de
   chaque campagne le cahier de test (SPEC-BANC-014) dans tests/resultats/.

   Sélection (SPEC-BANC-003/005), au choix, combinable (intersection) :
     node tests/run.js [filtre]           filtre positionnel historique (sous-chaîne du nom)
     node tests/run.js --preset commit    préréglage nommé (tests/presets.js)
     node tests/run.js --domaine A,B      un ou plusieurs domaines (SPEC-A-*, SPEC-B-*)
     node tests/run.js --type spec,unitaire
     node tests/run.js --groupe "Core — minage"
     node tests/run.js --test SPEC-MODE-001,"un nom exact"
     node tests/run.js --liste fichier.txt      un nom ou id par ligne
     node tests/run.js --echecs                 les échecs de la dernière campagne Node
     node tests/run.js --sauf etiquettes=lent    exclusion (répétable)
     node tests/run.js --lister                  affiche la sélection et les fiches, n'exécute rien
   Options d'exécution, conservées : --delai N, --silencieux.

   Les tests de type e2e sont LISTÉS (ils comptent dans le catalogue) mais
   jamais exécutés ici : ils exigent un navigateur (SPEC-BANC-005). run.js le
   signale plutôt que de les ignorer en silence.

   Préréglage `en-cours` (voir l'en-tête de tests/presets.js) : ses critères
   de base sont vides ; c'est CE fichier, seul à avoir accès à git et à
   SPECS.md par le disque, qui calcule les domaines à lui ajouter (specs ⏳
   plus domaines des fichiers src/ modifiés depuis la dernière étiquette,
   par correspondance de nom best-effort) avant l'appel à MC_TESTS.selection. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const option = (nom) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : null; };
const optionsToutes = (nom) => { const out = []; for (let i = 0; i < args.length; i++) if (args[i] === nom) out.push(args[i + 1]); return out; };
const drapeau = (nom) => args.includes(nom);
const silencieux = drapeau('--silencieux');
const SEUIL_LENT = 20;
const DELAI_TEST_MS_DEFAUT = 30000; // délai coopératif par test (SPEC-BANC-010, volet Node) — voir tests/harness.js T.etape()

// ── --delai N : un processus parent surveille l'enfant qui exécute la suite ──
if (option('--delai') && !process.env.MC_RUN_ENFANT) {
  const { spawn } = require('child_process');
  const os = require('os');
  const etat = path.join(os.tmpdir(), 'mc-run-etat-' + process.pid + '.txt');
  const partiel = path.join(os.tmpdir(), 'mc-run-partiel-' + process.pid + '.json');
  const reste = args.filter((a, i) => a !== '--delai' && args[i - 1] !== '--delai');
  const enfant = spawn(process.execPath, [__filename, ...reste],
    { stdio: 'inherit', env: Object.assign({}, process.env, { MC_RUN_ENFANT: '1', MC_RUN_ETAT: etat, MC_RUN_PARTIEL: partiel }) });
  const limite = setTimeout(() => {
    let enCours = '(inconnu)';
    try { enCours = fs.readFileSync(etat, 'utf8'); } catch (e) { /* rien */ }
    enfant.kill();
    fs.writeSync(2, '\n✗ délai de ' + option('--delai') + ' s dépassé pendant : ' + enCours + '\n');
    // même interrompue, la campagne garde son cahier de test (SPEC-BANC-014) —
    // à partir du dernier instantané que l'enfant a écrit entre deux groupes
    try {
      const snap = JSON.parse(fs.readFileSync(partiel, 'utf8'));
      const RT = require('../tools/resultats-tests.js');
      snap.campagne.interrompue = true;
      snap.campagne.fin = new Date().toISOString();
      snap.campagne.duree_ms = Date.now() - Date.parse(snap.campagne.debut);
      const r = RT.ecrireCahier(snap);
      fs.writeSync(2, '  cahier (interrompu) : ' + r.rapport + '\n');
    } catch (e) { fs.writeSync(2, '  (pas d\'instantané exploitable pour le cahier interrompu : ' + e.message + ')\n'); }
    try { fs.unlinkSync(etat); } catch (e) { /* rien */ }
    try { fs.unlinkSync(partiel); } catch (e) { /* rien */ }
    process.exit(3);
  }, parseFloat(option('--delai')) * 1000);
  enfant.on('exit', (code) => {
    clearTimeout(limite);
    try { fs.unlinkSync(etat); } catch (e) { /* rien */ }
    try { fs.unlinkSync(partiel); } catch (e) { /* rien */ }
    process.exit(code === null ? 3 : code);
  });
  return;
}

const SRC = ['core', 'formes', 'noise', 'biomes', 'densite', 'zones', 'volcanisme', 'souterrain', 'recifs', 'caravanes', 'donjons', 'habitats', 'routes', 'histoire', 'recits', 'carte', 'eau', 'feu', 'meteo', 'lointain', 'world', 'circuits', 'lumiere', 'ombres', 'succes', 'mesher', 'physics', 'faune', 'factions', 'inventory', 'vehicules',
             'entities', 'player', 'synchro', 'daycycle', 'save', 'saves', 'modes', 'chat', 'commandes', 'options', 'apparence', 'split', 'hud', 'gamepad', 'net-protocol', 'parametres', 'admin', 'politique', 'guildes', 'livre', 'livres', 'ambiance', 'audio'];
const TESTS = ['unit', 'functional', 'spec-modes', 'spec-saves', 'spec-audit', 'spec-armes', 'spec-chat', 'spec-split', 'spec-net', 'spec-secu', 'spec-ia-coll', 'spec-livre', 'spec-monde', 'spec-mer', 'spec-vehicules', 'spec-horizon', 'spec-climat', 'spec-habitats', 'spec-routes', 'spec-histoire', 'spec-succes', 'spec-ombres', 'spec-population', 'spec-hud', 'spec-couverture', 'spec-recits', 'spec-commandes', 'spec-portes', 'spec-eau', 'spec-vent', 'spec-loin', 'spec-donjons', 'spec-audio', 'spec-options', 'spec-souterrain', 'spec-apparence', 'spec-saisons', 'spec-parametres', 'spec-admin', 'spec-densite', 'spec-volcans', 'spec-caravanes', 'spec-zones', 'spec-blocs16', 'spec-politique', 'spec-guildes', 'spec-materiaux', 'spec-circuits', 'spec-objets', 'spec-formes', 'spec-recifs', 'spec-interieur', 'spec-batiments', 'spec-banc',
             // exploration (lot perf) : sondes non bloquantes, @exploration — voir tests/catalogue.js
             'spec-perf', 'limites-sondes', 'spec-limites'];

/* `require`, `process`, `__dirname` : exposés UNIQUEMENT pour que
   tests/spec-banc.js (Node-only, voir son en-tête) puisse vérifier
   l'outillage lui-même — crochets, cahier de test, route serveur. Les
   modules de logique pure (src/*.js) n'en ont pas besoin et la porte G5 le
   leur interdirait de toute façon si un jour l'un d'eux s'en servait. */
const ctx = vm.createContext(Object.assign(Object.create(null), {
  console, Math, JSON, Date, Error, Number, String, Array, Object, Boolean,
  Map, Set, Uint8Array, Float32Array, isNaN, isFinite, parseInt, parseFloat,
  performance: { now: () => Date.now() },
  require, process, __dirname: path.join(root, 'tests'), Buffer,
}));
ctx.globalThis = ctx;

function loadInto(file) {
  const p = path.join(root, file);
  const code = fs.readFileSync(p, 'utf8');
  try {
    vm.runInContext(code, ctx, { filename: file });
  } catch (e) {
    console.error(`\n  Échec du chargement de ${file}\n  ${e.message}\n`);
    process.exit(2);
  }
}

loadInto('tests/harness.js');
SRC.forEach(f => loadInto(`src/${f}.js`));
loadInto('tests/presets.js');
loadInto('tests/catalogue.js');
loadInto('tests/rapport.js');
// certains fichiers de TESTS appartiennent à des lots en cours d'intégration
// (branches pas encore fusionnées) : on les ignore s'ils n'existent pas
// encore, plutôt que d'arrêter toute la suite pour un fichier qui arrive
TESTS.forEach((f) => {
  if (!fs.existsSync(path.join(root, `tests/${f}.js`))) return;
  ctx.T.fichierCourant = `tests/${f}.js`; loadInto(`tests/${f}.js`);
});
ctx.T.fichierCourant = null;

// ── e2e (texte seulement : jamais évalué sous Node) ─────────────────────────
/* On lit tests/e2e.js comme du TEXTE pour en tirer les noms des tests
   e2e(...) et une approximation de leur groupe (le commentaire de section le
   plus proche au-dessus) — sans jamais évaluer le fichier, qui référence
   `window`/`document` dans ses fonctions. C'est délibérément découplé de la
   forme interne de tests/e2e.js (propriété de l'agent qui construit le banc
   navigateur) : seuls les littéraux passés à e2e(nom, fn) comptent. */
function e2eListeDepuisTexte() {
  const fichier = path.join(root, 'tests', 'e2e.js');
  if (!fs.existsSync(fichier)) return [];
  const texte = fs.readFileSync(fichier, 'utf8');
  const lignes = texte.split('\n');
  const out = [];
  let dernierCommentaire = null;
  const reCommentaire = /^\s*\/\/\s*([^─═\s].{2,80})$/;
  const reAppel = /^\s*e2e\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;
  lignes.forEach((ligne) => {
    const mc = reCommentaire.exec(ligne);
    if (mc && !/^[-─═]+$/.test(mc[1])) dernierCommentaire = mc[1].trim();
    const ma = reAppel.exec(ligne);
    if (ma) out.push({ nom: ma[2].replace(/\\(.)/g, '$1'), groupe: dernierCommentaire || 'e2e', fichier: 'tests/e2e.js' });
  });
  return out;
}

/* Les scripts tests/integration-*.js et tests/charge.js ne passent pas par
   describe/it (vrais processus, vraies sockets — voir leur propre en-tête) :
   chacun compte comme UNE entrée du catalogue (type 'integration' ou
   'charge'), exécutable en un lancement. C'est run.js, ici, qui sait les
   lancer (spawnSync) quand ils sont sélectionnés — voir plus bas. */
const FICHE_INTEGRATION = {
  'integration-net.js': { teste: 'Le protocole réseau (WebSocket, autorité serveur) sur de vraies sockets.', pourquoi: 'La logique réseau est testée unitairement ailleurs (src/net-protocol.js) ; ici, un vrai serveur et de vrais clients TCP vérifient qu\'elle fonctionne réellement en bout en bout.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.' },
  'integration-admin.js': { teste: 'L\'administration et la persistance du serveur, sur un vrai processus server.js.', pourquoi: 'Rôles, jetons et sauvegarde du monde ne peuvent se vérifier qu\'avec un vrai serveur qui démarre, tourne et s\'arrête.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.' },
  'integration-paquet.js': { teste: 'Le lancement empaqueté du jeu (paramètres, ouverture du navigateur).', pourquoi: 'L\'empaquetage n\'est vérifiable qu\'en lançant réellement le programme avec différents arguments.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.' },
  'integration-pvp.js': { teste: 'Le PvP, les zones de jeu et les factions, sur un vrai serveur avec plusieurs clients.', pourquoi: 'Les règles de zone et de faction combinent plusieurs joueurs réels ; un test unitaire ne peut pas simuler l\'ensemble.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.' },
  'integration-charge.js': { teste: 'Le banc de charge, à petite échelle, pour vérifier qu\'il fonctionne.', pourquoi: 'Un banc de charge cassé donnerait une fausse confiance sur les performances mesurées ailleurs.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.' },
  'integration-cahiers.js': { teste: 'La bibliothèque des cahiers de test (SPEC-BANC-018 à 022) sur un vrai serveur : enregistrement, liste, comparaison, export HTML/.docx.', pourquoi: 'Les routes /tests/cahiers combinent serveur HTTP, disque et rendu ; seul un vrai processus vérifie qu\'elles fonctionnent ensemble.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.' },
  'charge.js': { teste: 'Le banc de charge complet (1 à 100 joueurs simulés).', pourquoi: 'Mesure la tenue en charge réelle du serveur — voir docs/charge.md.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.' },
};
function integrationListeDepuisFichiers() {
  return fs.readdirSync(path.join(root, 'tests'))
    .filter(f => /^integration-.*\.js$/.test(f) || f === 'charge.js')
    .map(f => ({ nom: f + ' (intégration)', groupe: f, fichier: 'tests/' + f, type: f === 'charge.js' ? 'charge' : 'integration', fiche: FICHE_INTEGRATION[f] }));
}

const specsTexte = fs.readFileSync(path.join(root, 'SPECS.md'), 'utf8');
const specsIndex = ctx.MC_TESTS.indexSpecs(specsTexte);
const e2eListe = e2eListeDepuisTexte().concat(integrationListeDepuisFichiers());
const catalogue = ctx.MC_TESTS.construire(ctx.T, e2eListe, specsIndex);

// ── construction des critères à partir des options de la ligne de commande ──
function virgule(v) { return v ? v.split(',').map(s => s.trim()).filter(Boolean) : []; }
function ajouter(criteres, cle, valeurs) {
  if (!valeurs || !valeurs.length) return;
  criteres[cle] = (criteres[cle] || []).concat(valeurs);
}
function domainesDeFichiersModifies(fichiers, domainesConnus) {
  const bases = fichiers.map(f => path.basename(f, '.js').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  return domainesConnus.filter(d => bases.some(b => b.indexOf(d) >= 0 || d.indexOf(b) >= 0));
}
function calculerEnCours() {
  const domainesConnus = Array.from(new Set(catalogue.reduce((a, t) => a.concat(t.domaines), [])));
  const domaines = new Set();
  Object.keys(specsIndex).forEach((id) => {
    if (specsIndex[id].etat === '⏳') { const m = /^SPEC-([A-Z0-9]+)-/.exec(id); if (m) domaines.add(m[1]); }
  });
  try {
    const etiquette = execSync('git describe --tags --abbrev=0 --match "v[0-9]*"', { cwd: root, encoding: 'utf8' }).trim();
    const fichiers = execSync('git diff --name-only ' + etiquette + '..HEAD -- src/', { cwd: root, encoding: 'utf8' })
      .split('\n').filter(Boolean);
    domainesDeFichiersModifies(fichiers, domainesConnus).forEach(d => domaines.add(d));
  } catch (e) { /* pas d'étiquette, ou hors dépôt git : on se limite aux specs ⏳ */ }
  return Array.from(domaines);
}

function critereDepuisArgs() {
  const c = {};
  ajouter(c, 'domaines', virgule(option('--domaine')));
  ajouter(c, 'types', virgule(option('--type')));
  ajouter(c, 'groupes', virgule(option('--groupe')));
  ajouter(c, 'tests', virgule(option('--test')));
  const fichierListe = option('--liste');
  if (fichierListe) {
    const contenu = fs.readFileSync(fichierListe, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
    ajouter(c, 'liste', contenu);
  }
  if (drapeau('--echecs')) {
    const dernier = dernierResultatsNode();
    ajouter(c, 'echecs', dernier ? dernier.tests.filter(t => t.etat !== 'ok').map(t => t.nom) : []);
    if (!dernier) console.error('(--echecs : aucun résultat Node précédent trouvé dans tests/resultats/)');
  }
  optionsToutes('--sauf').forEach((val) => {
    if (!val || val.indexOf('=') < 0) return;
    const [cle, v] = [val.slice(0, val.indexOf('=')), val.slice(val.indexOf('=') + 1)];
    c.sauf = c.sauf || {};
    ajouter(c.sauf, cle, virgule(v));
  });
  return c;
}
function dernierResultatsNode() {
  const RT = require('../tools/resultats-tests.js');
  const racine = RT.DOSSIER_RESULTATS;
  if (!fs.existsSync(racine)) return null;
  const dossiers = fs.readdirSync(racine, { withFileTypes: true }).filter(d => d.isDirectory())
    .map(d => ({ nom: d.name, t: fs.statSync(path.join(racine, d.name)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const d of dossiers) {
    const p = path.join(racine, d.nom, 'resultats.json');
    if (fs.existsSync(p)) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { /* corrompu, suivant */ } }
  }
  return null;
}

const nomPreset = option('--preset');
let criteres = critereDepuisArgs();
// étiquette de campagne (sert de nom de dossier, SPEC-BANC-014) : le
// préréglage s'il y en a un, sinon la première option de sélection nommée,
// sinon 'tout'
function etiquetteDepuisCriteres(c) {
  const cles = ['domaines', 'types', 'groupes', 'tests', 'liste', 'echecs'];
  for (const k of cles) if (c[k] && c[k].length) return k + '-' + c[k].join('+');
  return null;
}
/* Sans AUCUN critère de sélection (ni préréglage, ni --domaine/--type/…, ni
   filtre positionnel), le comportement historique reste : unitaire +
   fonctionnel + spec seulement. Sans ce repli, un `selection(catalogue, {})`
   vide sélectionnerait TOUT le catalogue — e2e (inexécutable sous Node) ET
   intégration/charge (de vrais processus, dont charge.js qui peut tourner
   plusieurs minutes) — ce qu'aucun appel nu à `node tests/run.js` n'attend. */
const AUCUN_CRITERE_EXPLICITE = !nomPreset && !Object.keys(criteres).some(k => k !== 'sauf' && criteres[k] && criteres[k].length);
if (AUCUN_CRITERE_EXPLICITE) criteres = { types: ['unitaire', 'fonctionnel', 'spec'] };
let etiquetteCampagne = nomPreset || etiquetteDepuisCriteres(criteres) || 'tout';
if (nomPreset) {
  const presetDef = (ctx.MC_TESTS.PRESETS || []).find(p => p.nom === nomPreset);
  if (!presetDef) {
    console.error('préréglage inconnu : ' + nomPreset + ' — connus : ' + (ctx.MC_TESTS.PRESETS || []).map(p => p.nom).join(', '));
    process.exit(2);
  }
  const base = JSON.parse(JSON.stringify(presetDef.criteres || {}));
  if (presetDef.dynamique === 'en-cours') ajouter(base, 'domaines', calculerEnCours());
  Object.keys(criteres).forEach((k) => {
    if (k === 'sauf') { base.sauf = base.sauf || {}; Object.keys(criteres.sauf).forEach(kk => ajouter(base.sauf, kk, criteres.sauf[kk])); }
    else ajouter(base, k, criteres[k]);
  });
  criteres = base;
}
// filtre positionnel historique : traité comme --test/--groupe par SOUS-CHAÎNE
// (compatibilité) — géré séparément, il ne passe pas par MC_TESTS.selection
const filtrePositionnel = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--')) || null;

let selection = ctx.MC_TESTS.selection(catalogue, criteres);
if (filtrePositionnel) {
  selection = selection.filter(t => t.groupe.indexOf(filtrePositionnel) >= 0 || t.nom.indexOf(filtrePositionnel) >= 0);
  if (!nomPreset) etiquetteCampagne = filtrePositionnel;
}

// ── --lister : affiche la sélection et les fiches, n'exécute rien ──────────
if (drapeau('--lister')) {
  selection.forEach((t) => {
    console.log(`[${t.type}] ${t.groupe} :: ${t.nom}`);
    if (t.fiche) console.log(`    teste: ${t.fiche.teste}\n    pourquoi: ${t.fiche.pourquoi}\n    attendu: ${t.fiche.attendu}`);
    else console.log('    (aucune fiche)');
  });
  console.log(`\n${selection.length} test(s) sélectionné(s) sur ${catalogue.length} au catalogue.`);
  process.exit(0);
}

const e2eSelectionnes = selection.filter(t => t.type === 'e2e');
const integrationSelectionnes = selection.filter(t => t.type === 'integration' || t.type === 'charge');
const aExecuter = selection.filter(t => t.type !== 'e2e' && t.type !== 'integration' && t.type !== 'charge');
if (e2eSelectionnes.length && !silencieux) {
  fs.writeSync(2, `(${e2eSelectionnes.length} test(s) end-to-end sélectionné(s) ignoré(s) : ils s'exécutent dans le navigateur, pas sous Node — tests/index.html)\n`);
}

// ── exécution ────────────────────────────────────────────────────────────
const ecrire = (t) => { if (!silencieux) fs.writeSync(2, t + '\n'); };
const fichierEtat = process.env.MC_RUN_ETAT || null;
const fichierPartiel = process.env.MC_RUN_PARTIEL || null;
const debutISO = new Date().toISOString();
const debut = Date.now();
const secondes = (ms) => (ms / 1000).toFixed(1) + ' s';

// entrées resultats.json construites au fil de l'eau (SPEC-BANC-014), pour
// pouvoir écrire un instantané entre deux groupes même si la campagne est
// interrompue par --delai
const testsResultats = [];
const infoDe = (id) => catalogue.find(t => t.id === id) || null;
function ecrireInstantane() {
  if (!fichierPartiel) return;
  try {
    fs.writeFileSync(fichierPartiel, JSON.stringify({
      schema: 1,
      campagne: { preset: etiquetteCampagne, criteres, debut: debutISO, environnement: environnement() },
      tests: testsResultats,
    }));
  } catch (e) { /* au pire, pas d'instantané : le cahier final restera complet si la campagne va au bout */ }
}

function environnement() {
  let commit = null;
  try { commit = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim(); } catch (e) { /* hors dépôt */ }
  let versionJeu = null;
  try { versionJeu = /var VERSION_JEU = '([^']+)'/.exec(fs.readFileSync(path.join(root, 'src', 'core.js'), 'utf8'))[1]; } catch (e) { /* rien */ }
  return { source: 'node', versionJeu, commit, node: process.version };
}

const nomsAExecuter = aExecuter.map(t => t.nom);
const res = ctx.T.run(nomsAExecuter, {
  debutGroupe: (nom, n) => ecrire('▶ ' + nom + ' (' + n + ' test' + (n > 1 ? 's' : '') + ')'),
  debutTest: (groupe, nom) => { if (fichierEtat) try { fs.writeFileSync(fichierEtat, groupe + ' › ' + nom); } catch (e) { /* rien */ } },
  etape: (groupe, nom, libelle, n, total) => ecrire('    ↳ ' + nom + ' — ' + libelle + (n ? ' (' + n + (total ? '/' + total : '') + ')' : '')),
  finTest: (groupe, nom, ok, ms, detail) => {
    if (ms > SEUIL_LENT * 1000) ecrire('  ⚠ lent (' + secondes(ms) + ') : ' + nom);
    const cat = catalogue.find(c => c.groupe === groupe && c.nom === nom);
    testsResultats.push({
      id: cat ? cat.id : nom, nom, type: cat ? cat.type : 'unitaire', groupe,
      domaines: cat ? cat.domaines : [], specs: cat ? cat.specs : [], fiche: cat ? cat.fiche : null,
      etat: ok ? 'ok' : (detail && detail.delai ? 'delai' : 'echec'), duree_ms: Math.round(ms),
      etapes: detail ? detail.etapes : [], assertions: detail ? detail.assertions : { ok: 0, ko: 0 },
      message: detail && detail.message, attendu: detail && detail.attendu, obtenu: detail && detail.obtenu, pile: detail && detail.pile,
    });
  },
  finGroupe: (nom, p, f, ms) => { ecrire((f ? '  ✗ ' : '  ✓ ') + p + '/' + (p + f) + ' en ' + secondes(ms) +
                                        ' — total écoulé ' + secondes(Date.now() - debut)); ecrireInstantane(); },
}, { delaiMs: DELAI_TEST_MS_DEFAUT });

// ── tests/integration-*.js et tests/charge.js : chacun un vrai processus ───
/* Pas de describe/it ici : un lancement, un code de sortie. Le journal du
   script (stdout/stderr) est repris dans `message` pour que le cahier de
   test garde le détail, même s'il n'est pas décomposé assertion par
   assertion comme les tests Node classiques. */
integrationSelectionnes.forEach((t) => {
  ecrire('▶ ' + t.nom);
  const t0 = Date.now();
  const r = require('child_process').spawnSync(process.execPath, [path.join(root, t.fichier)], { encoding: 'utf8', cwd: root });
  const ms = Date.now() - t0;
  const ok = r.status === 0;
  ecrire((ok ? '  ✓ ' : '  ✗ ') + t.nom + ' en ' + secondes(ms));
  if (ok) res.passed++; else res.failed++;
  testsResultats.push({
    id: t.id, nom: t.nom, type: t.type, groupe: t.groupe, domaines: t.domaines, specs: t.specs, fiche: t.fiche,
    etat: ok ? 'ok' : 'echec', duree_ms: ms, etapes: [], assertions: { ok: ok ? 1 : 0, ko: ok ? 0 : 1 },
    message: ok ? undefined : ((r.stdout || '') + (r.stderr || '')).split('\n').slice(-40).join('\n'),
  });
  ecrireInstantane();
});

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m' };
let line = '';
for (const s of res.suites) {
  const mark = s.failed ? `${C.r}✗${C.x}` : `${C.g}✓${C.x}`;
  line += `\n${mark} ${s.name} ${C.d}(${s.passed}/${s.passed + s.failed})${C.x}\n`;
  for (const l of s.lines) {
    if (l.ok) line += `  ${C.g}·${C.x} ${C.d}${l.name}${C.x}\n`;
    else line += `  ${C.r}✗ ${l.name}${C.x}\n    ${C.r}${l.message}${C.x}\n`;
  }
}
console.log(line);
const total = res.passed + res.failed;

// ── SPEC-BANC-014 : cahier de test, même si l'exécution a échoué ───────────
const finISO = new Date().toISOString();
const parType = {}, parDomaine = {};
testsResultats.forEach((t) => {
  parType[t.type] = (parType[t.type] || 0) + 1;
  (t.domaines.length ? t.domaines : ['(sans domaine)']).forEach(d => { parDomaine[d] = (parDomaine[d] || 0) + 1; });
});
const lents = testsResultats.filter(t => t.duree_ms > SEUIL_LENT * 1000).map(t => t.nom);
const resultatsFinaux = {
  schema: 1,
  campagne: {
    preset: etiquetteCampagne, criteres, debut: debutISO, fin: finISO, duree_ms: Date.now() - debut,
    interrompue: false, environnement: environnement(),
    totaux: { total: testsResultats.length, passes: res.passed, echecs: res.failed, ignores: e2eSelectionnes.length, parType, parDomaine },
    lents,
  },
  tests: testsResultats,
};
try {
  const RT = require('../tools/resultats-tests.js');
  const r = RT.ecrireCahier(resultatsFinaux);
  ecrire('cahier de test : ' + r.rapport);
} catch (e) { ecrire('(cahier de test non écrit : ' + e.message + ')'); }

if (res.failed) {
  console.log(`${C.r}${res.failed} échec(s)${C.x} sur ${total} tests\n`);
  process.exit(1);
} else {
  console.log(`${C.g}${res.passed}/${total} tests passent${C.x}\n`);
}
