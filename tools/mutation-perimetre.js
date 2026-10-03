#!/usr/bin/env node
/* tools/mutation-perimetre.js — preuve de BOUT EN BOUT du périmètre
   d'exécution (revue adversariale de SPEC-BANC-067 à 076) : on casse
   volontairement le code (mutation), on calcule le périmètre du commit, puis
   on lance TOUT le préréglage `commit` ; chaque test qui échoue réellement
   doit faire partie du périmètre. Un échec hors périmètre est un TROU : le
   moteur a réduit à tort.

   Tout se passe dans un CLONE JETABLE (jamais dans ce dépôt) :
     node tools/mutation-perimetre.js --clone <dossier> [--base <commit>]
          [--mutation <fichier.json>]… [--aleatoires N] [--graine S] [--sans-complet]
   Une mutation (JSON) : { nom, setup?: [[edit…]…] (commits préalables, après
   la carte), edits: [edit…] (indexés, le commit en cours) } ; un edit :
   { file, find, replace } ou { file, write }. `--aleatoires N` : N fonctions
   exportées tirées au hasard (graine fixe, rejouable), chacune cassée par un
   `throw` en tête de corps. Sortie : un JSON par mutation (trous, échecs
   retenus, taille du périmètre), code de sortie 1 s'il y a un trou.

   Durée : une campagne `commit` complète par mutation (quelques minutes) —
   ce n'est pas un test du catalogue ; à lancer avant de toucher au moteur. */
'use strict';
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const { envSansGit } = require('./git-propre.js');

const RACINE = path.join(__dirname, '..');
const args = process.argv.slice(2);
const option = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const toutes = (n) => args.reduce((a, x, i) => (x === n ? a.concat(args[i + 1]) : a), []);
const clone = option('--clone') && path.resolve(option('--clone'));
if (!clone) { console.error('--clone <dossier> requis (un clone jetable, créé s\'il n\'existe pas)'); process.exit(2); }
const env = envSansGit();
const gitIci = (a, cwd) => cp.execFileSync('git', ['-c', 'user.name=mutation', '-c', 'user.email=mutation@local', '-c', 'commit.gpgsign=false',
  '-c', 'core.hooksPath=' + path.join(clone, '.aucun-crochet')].concat(a), { cwd: cwd || clone, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (!fs.existsSync(path.join(clone, '.git'))) gitIci(['clone', '-q', RACINE, clone], path.dirname(clone));
const base = cp.execFileSync('git', ['rev-parse', option('--base') || 'HEAD'], { cwd: RACINE, env: process.env, encoding: 'utf8' }).trim();
// la base doit exister dans le clone : on y rapatrie la branche courante de ce dépôt
gitIci(['fetch', '-q', RACINE, cp.execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: RACINE, env: process.env, encoding: 'utf8' }).trim()]);

function editer(e) {
  const f = path.join(clone, e.file);
  if (e.write !== undefined) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, e.write); return; }
  const t = fs.readFileSync(f, 'utf8');
  if (t.indexOf(e.find) < 0) throw new Error('motif introuvable dans ' + e.file + ' : ' + e.find);
  fs.writeFileSync(f, t.replace(e.find, e.replace));
}
function lancer(a, extra) {
  return cp.spawnSync(process.execPath, [path.join(clone, 'tests', 'run.js')].concat(a),
    { cwd: clone, env: Object.assign({}, env, extra || {}), encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
}
const cle = t => (t.type === 'e2e' ? 'e2e' : t.groupe) + ' › ' + t.nom;

function essayer(M) {
  gitIci(['reset', '-q', '--hard', base]);
  gitIci(['clean', '-qfd', 'src', 'tests', 'docs']);
  (M.setup || []).forEach((lot, i) => { lot.forEach(editer); gitIci(['add', '-A']); gitIci(['commit', '-q', '-m', 'mutation : préalable ' + i]); });
  (M.edits || []).forEach(editer);
  gitIci(['add', '-A']);
  const rp = lancer(['--preset', 'commit', '--perimetre', 'commit', '--perimetre-json']);
  let p;
  try { p = JSON.parse(rp.stdout); } catch (e) { return { nom: M.nom, erreur: 'périmètre illisible : ' + String(rp.stderr).slice(-400) }; }
  const sel = new Set(p.selection.map(t => t.cle));
  const out = { nom: M.nom, repli: p.repli, retenus: p.selection.length, exclus: p.exclus, fonctions: p.fonctions.length };
  if (!args.includes('--sans-complet')) {
    const dir = fs.mkdtempSync(path.join(clone, '..', 'mutation-res-'));
    lancer(['--preset', 'commit', '--sans-fonctions'], { MC_TEST_RESULTATS_DIR: dir });
    const d = fs.readdirSync(dir).filter(x => fs.existsSync(path.join(dir, x, 'resultats.json')))[0];
    const res = JSON.parse(fs.readFileSync(path.join(dir, d, 'resultats.json'), 'utf8'));
    const ech = res.tests.filter(t => t.etat === 'echec' || t.etat === 'delai');
    out.echecs = ech.length;
    out.trous = ech.filter(t => !p.repli && !sel.has(cle(t))).map(cle);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* rien */ }
  }
  return out;
}

/* mutations aléatoires : une fonction exportée par mutation, cassée en tête */
function aleatoires(n, graine) {
  const P = require(path.join(clone, 'tools', 'perimetre.js'));
  let s = graine >>> 0 || 1;
  const hasard = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
  const mods = P.chargerModules(c => fs.readFileSync(path.join(clone, c), 'utf8'));
  const candidats = [];
  Object.keys(mods.parFichier).forEach((f) => {
    const texte = fs.readFileSync(path.join(clone, f), 'utf8');
    const d = P.decouper(texte);
    if (!d.ok) return;
    mods.parFichier[f].forEach((e) => {
      const k = texte.indexOf(e.texte);
      if (k < 0) return;
      const ouvre = e.texte.indexOf('{');
      if (ouvre < 0 || e.texte.split('\n').length < 3) return;
      const avant = texte.slice(0, k + ouvre + 1);
      candidats.push({ file: f, qual: e.qual, find: avant.slice(-120), replace: avant.slice(-120) + ' throw new Error(\'mutation ' + e.qual + '\');' });
    });
  });
  const out = [];
  for (let i = 0; i < n && candidats.length; i++) {
    const c = candidats.splice(Math.floor(hasard() * candidats.length), 1)[0];
    out.push({ nom: 'aléatoire ' + c.qual, edits: [{ file: c.file, find: c.find, replace: c.replace }] });
  }
  return out;
}

const mutations = toutes('--mutation').map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
gitIci(['reset', '-q', '--hard', base]);
if (option('--aleatoires')) aleatoires(+option('--aleatoires'), +(option('--graine') || 42)).forEach(m => mutations.push(m));
let trous = 0;
mutations.forEach((M) => {
  const r = essayer(M);
  if (r.trous && r.trous.length) trous++;
  console.log(JSON.stringify(r));
});
gitIci(['reset', '-q', '--hard', base]);
process.exit(trous ? 1 : 0);
