/* explo-limites.js — exploration PROFONDE des limites techniques de la carte
   (SPEC-LIMITE-001 à 005). Usage : node tests/explo-limites.js [--rapide]

   La suite standard (tests/spec-limites.js) lance déjà les sondes en mode
   rapide et affiche leur tableau, sans jamais bloquer sur ce qu'elles
   mesurent. Ce script-ci les lance sur toutes les distances (jusqu'à 2⁵³),
   ajoute le coût de génération selon la distance, et conserve un cahier
   d'exploration dans tests/resultats/<date>_limites/ : rapport.md (lisible)
   et resultats.json (données). On le lance pour explorer, documenter les
   limites ou comparer deux versions. Les sondes : tests/limites-sondes.js. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const rapide = process.argv.includes('--rapide');
const ecrire = (t) => fs.writeSync(2, t + '\n');

// les modules du jeu, avec la même liste que tests/run.js
const texteRun = fs.readFileSync(path.join(root, 'tests', 'run.js'), 'utf8');
const SRC = JSON.parse(/const SRC = (\[[\s\S]*?\]);/.exec(texteRun)[1].replace(/'/g, '"'));
const ctx = vm.createContext(Object.assign(Object.create(null), {
  console, Math, JSON, Date, Error, Number, String, Array, Object, Boolean,
  Map, Set, Uint8Array, Uint16Array, Int32Array, Float32Array, Float64Array, isNaN, isFinite, parseInt, parseFloat,
  performance: { now: () => Number(process.hrtime.bigint()) / 1e6 },
}));
ctx.globalThis = ctx;
SRC.concat(['../tests/limites-sondes']).forEach((f) => {
  const fichier = path.join(root, 'src', f + '.js');
  vm.runInContext(fs.readFileSync(fichier, 'utf8'), ctx, { filename: path.relative(root, fichier) });
});
const MC = ctx.MC, L = ctx.MC_LIMITES, GRAINE = 20260924;

const debut = Date.now();
const resultat = L.sonder(MC, {
  rapide, graine: GRAINE, maintenant: ctx.performance.now,
  suivi: (id, titre) => ecrire('▶ ' + id + ' — ' + titre + '  (écoulé ' + ((Date.now() - debut) / 1000).toFixed(0) + ' s)'),
});
const bilan = L.tableau(resultat);                    // lève si le tableau ne peut se construire
resultat.sondes.forEach((s) => ecrire('  ' + s.id + ' : ' + s.conclusion + ' (' + (s.duree_ms / 1000).toFixed(1) + ' s)'));

// ── cahier d'exploration ──
const date = new Date(), pad = (n) => String(n).padStart(2, '0');
const nom = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + '_' +
            pad(date.getHours()) + '-' + pad(date.getMinutes()) + '-' + pad(date.getSeconds()) + '_limites';
const dossier = path.join(root, 'tests', 'resultats', nom);
fs.mkdirSync(dossier, { recursive: true });
let commit = '';
try { commit = require('child_process').execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim(); } catch (e) { /* hors git */ }
const env = { versionJeu: MC.Core.VERSION_JEU, commit, node: process.version, plateforme: process.platform + ' ' + process.arch, graine: GRAINE, rapide };
fs.writeFileSync(path.join(dossier, 'resultats.json'),
  JSON.stringify({ schema: 1, type: 'exploration', date: date.toISOString(), environnement: env, bilan: bilan.total, sondes: resultat.sondes }, null, 2));
const entete = ['# Limites techniques de la carte — exploration', '',
  '_Banc d’exploration, non bloquant (SPEC-LIMITE-001 à 005). ' + date.toLocaleString('fr-FR') + ' · version ' + env.versionJeu +
  (commit ? ' · commit ' + commit : '') + ' · Node ' + env.node + ' · ' + env.plateforme + (rapide ? ' · mode rapide' : '') + '_', '',
  '✓ succès interne (attendu atteint) · ✗ échec interne (limite atteinte ou anomalie) · · valeur relevée', '',
  '## Synthèse', '', '| Sonde | Conclusion | Durée |', '|---|---|---|']
  .concat(resultat.sondes.map((s) => '| ' + s.id + ' — ' + s.titre + ' | ' + s.conclusion + ' | ' + (s.duree_ms / 1000).toFixed(1) + ' s |'));
fs.writeFileSync(path.join(dossier, 'rapport.md'), entete.join('\n') + '\n\n' + L.texte(resultat, 'md') + '\n');
ecrire('\nCahier d’exploration : ' + path.relative(root, dossier) + path.sep + 'rapport.md');
