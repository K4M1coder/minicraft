/* bench-generation.js — banc de non-régression de la génération de chunks
   (SPEC-PERF-017/018), dérivé de scratchpad/bench.js (audit du 2026-09-24).
   Usage : node tests/bench-generation.js [N]

   Génère N chunks (80 par défaut) sur une spirale carrée autour de l'origine,
   avec une graine fixe, et mesure le temps de `world.getChunk` par chunk.
   Échoue (code 1) si la moyenne ou le p95 dépasse le budget déclaré dans
   tests/budget-perf.json — le même fichier que lit `node tests/gates.js`
   (SPEC-PERF-018), pour qu'une régression de performance bloque le commit
   comme n'importe quelle autre porte.

   Les seuils sont volontairement généreux (pas la moyenne mesurée en local) :
   une machine plus lente ou chargée ne doit jamais faire clignoter cette
   porte au rouge sans raison — seule une vraie régression algorithmique
   (retour à un bruit non mis en cache, par exemple) doit la déclencher. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const N = parseInt(process.argv[2] || '80', 10);
const budget = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'budget-perf.json'), 'utf8')).generation;

const SRC = ['core', 'formes', 'noise', 'biomes', 'densite', 'zones', 'volcanisme', 'souterrain', 'recifs',
  'caravanes', 'donjons', 'habitats', 'routes', 'histoire', 'recits', 'carte', 'eau', 'feu', 'meteo', 'lointain',
  'world', 'circuits', 'lumiere', 'ombres', 'succes', 'mesher', 'physics', 'faune', 'factions', 'inventory',
  'vehicules', 'entities', 'player', 'synchro', 'daycycle', 'save', 'saves', 'modes', 'chat', 'commandes',
  'options', 'apparence', 'split', 'hud', 'gamepad', 'net-protocol', 'parametres', 'admin', 'politique',
  'guildes', 'livre', 'livres', 'ambiance', 'audio'];

const ctx = vm.createContext(Object.assign(Object.create(null), {
  console, Math, JSON, Date, Error, Number, String, Array, Object, Boolean,
  Map, Set, Uint8Array, Float32Array, isNaN, isFinite, parseInt, parseFloat,
  performance: { now: () => { const [s, ns] = process.hrtime(); return s * 1000 + ns / 1e6; } },
}));
ctx.globalThis = ctx;
function loadInto(file) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
}
SRC.forEach(f => loadInto(`src/${f}.js`));

const MC = ctx.MC;
const w = MC.createWorld(budget.seed);

// chunks sur une spirale carrée autour de l'origine, comme le ferait le
// joueur en s'éloignant du spawn — plus représentatif qu'une ligne droite.
function spirale(n) {
  const pts = [[0, 0]];
  let x = 0, z = 0, dx = 1, dz = 0, steps = 1, stepCount = 0, turns = 0;
  while (pts.length < n) {
    x += dx; z += dz; pts.push([x, z]);
    stepCount++;
    if (stepCount === steps) {
      stepCount = 0;
      const t = dx; dx = -dz; dz = t;
      turns++;
      if (turns % 2 === 0) steps++;
    }
  }
  return pts.slice(0, n);
}

const coords = spirale(N);
const tGen = [];
for (const [cx, cz] of coords) {
  const t0 = performance.now();
  w.getChunk(cx, cz, true);
  tGen.push(performance.now() - t0);
}

function stats(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
  return { min: s[0], max: s[s.length - 1], avg: sum / s.length, p95 };
}

const g = stats(tGen);
const cacheSize = w.perf.caveCacheSize();

console.log(`Génération (world.getChunk), N=${N} chunks, graine ${budget.seed} :`);
console.log(`  moyenne = ${g.avg.toFixed(2)} ms/chunk (budget ${budget.avgMsMax} ms)`);
console.log(`  p95     = ${g.p95.toFixed(2)} ms/chunk (budget ${budget.p95MsMax} ms)`);
console.log(`  min/max = ${g.min.toFixed(2)} / ${g.max.toFixed(2)} ms`);
console.log(`  cache de bruit de grotte : ${cacheSize} coins (borne ${budget.caveCacheMax})`);

let ok = true;
if (g.avg > budget.avgMsMax) { console.log(`✗ moyenne ${g.avg.toFixed(2)} ms > budget ${budget.avgMsMax} ms`); ok = false; }
if (g.p95 > budget.p95MsMax) { console.log(`✗ p95 ${g.p95.toFixed(2)} ms > budget ${budget.p95MsMax} ms`); ok = false; }
if (cacheSize > budget.caveCacheMax) { console.log(`✗ cache de grotte ${cacheSize} > borne ${budget.caveCacheMax}`); ok = false; }

if (!ok) { console.log('\n✗ budget de performance dépassé (tests/budget-perf.json)'); process.exit(1); }
console.log('\n✓ budget de performance respecté');
