/* bench-maillage.js — banc de non-régression du maillage (SPEC-PERF-017,
   partie maillage, sous-lot A3 « greedy meshing », docs/design-lots.md §L47).
   Usage : node tests/bench-maillage.js [N]

   Génère N chunks (40 par défaut) sur la même spirale que
   tests/bench-generation.js, avec une graine fixe, maille chacun sur les
   trois passes (opaque/cutout/blend) en mode fusionné ET en mode naïf (7e
   argument de MC.Mesher.buildChunk, référence sans greedy meshing), et
   mesure :
   - le temps de maillage fusionné (celui utilisé en jeu) ;
   - la réduction du nombre de quads (fusionné vs naïf), en moyenne sur
     l'échantillon et sur une zone plate synthétique (un plan 16×16 d'un seul
     bloc sans variante, le scénario de SPEC-PERF-011).

   Échoue (code 1) si un budget de tests/budget-perf.json (clé "maillage")
   est dépassé — lu par la même porte G12 que bench-generation.js
   (tests/gates.js), pour qu'une régression de fusion ou de vitesse bloque le
   commit comme n'importe quelle autre porte.

   Seuils volontairement en retrait de la mesure locale (comme
   bench-generation.js) : une machine plus lente ne doit pas faire clignoter
   cette porte, et une réduction légèrement plus faible selon la graine du
   monde ne doit pas faire échouer une session sans rapport avec le maillage
   — seule une vraie régression (fusion cassée, ou redevenue plus lente que
   le mode naïf) doit la déclencher. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const N = parseInt(process.argv[2] || '40', 10);
const budget = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'budget-perf.json'), 'utf8')).maillage;

const SRC = ['core', 'formes', 'noise', 'biomes', 'densite', 'zones', 'volcanisme', 'souterrain', 'recifs',
  'caravanes', 'donjons', 'habitats', 'routes', 'histoire', 'recits', 'carte', 'eau', 'feu', 'meteo', 'lointain',
  'world', 'circuits', 'lumiere', 'ombres', 'succes', 'mesher'];

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

const MC = ctx.MC, C = MC.Core;
const w = MC.createWorld(budget.seed);

// même spirale que bench-generation.js — échantillon représentatif d'un
// joueur qui s'éloigne du spawn (surface, grottes, structures mélangées).
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

const PASSES = ['opaque', 'cutout', 'blend'];
const coords = spirale(N);
const tMaillageMs = [];
let quadsFusion = 0, quadsNaif = 0;

for (const [cx, cz] of coords) {
  const c = w.getChunk(cx, cz, true);
  const t0 = performance.now();
  for (const pass of PASSES) {
    const g = MC.Mesher.buildChunk(c, pass, w.getBlock, null, null, false, true);
    if (g) quadsFusion += g.indices.length / 6;
  }
  tMaillageMs.push(performance.now() - t0);
  for (const pass of PASSES) {
    const n = MC.Mesher.buildChunk(c, pass, w.getBlock);
    if (n) quadsNaif += n.indices.length / 6;
  }
}

// zone plate synthétique : le scénario exact de SPEC-PERF-011 (bloc sans
// variante de tuile, une seule couche pleine, aucune occlusion voisine).
function blocSansVariante() {
  const ids = Object.keys(C.BLOCKS).map(Number);
  for (const id of ids) {
    const d = C.BLOCKS[id];
    if (d && d.tiles && !d.plant && !d.plat && !d.panneau && !d.forme && !d.liquid && !C.INDEX_VARIANTES[d.tiles[0]])
      return id;
  }
  throw new Error('aucun bloc sans variante trouvé');
}
const CX = C.CHUNK_X, CZ = C.CHUNK_Z, WH = C.WORLD_H;
const planChunk = { cx: 0, cz: 0, blocks: new Uint16Array(CX * WH * CZ) };
const blocPlat = blocSansVariante();
for (let x = 0; x < CX; x++) for (let z = 0; z < CZ; z++) planChunk.blocks[C.idx(x, 4, z)] = blocPlat;
const air = () => 0;
const planFusion = MC.Mesher.buildChunk(planChunk, 'opaque', air, null, null, false, true);
const planNaif = MC.Mesher.buildChunk(planChunk, 'opaque', air);
const reductionPlan = (planNaif.indices.length / 6) / (planFusion.indices.length / 6);

function stats(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  const p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
  return { min: s[0], max: s[s.length - 1], avg: sum / s.length, p95 };
}

const t = stats(tMaillageMs);
const reductionMoyenne = 1 - quadsFusion / quadsNaif;

console.log(`Maillage (MC.Mesher.buildChunk, 3 passes/chunk), N=${N} chunks, graine ${budget.seed} :`);
console.log(`  moyenne = ${t.avg.toFixed(2)} ms/chunk (budget ${budget.avgMsMax} ms)`);
console.log(`  p95     = ${t.p95.toFixed(2)} ms/chunk (budget ${budget.p95MsMax} ms)`);
console.log(`  min/max = ${t.min.toFixed(2)} / ${t.max.toFixed(2)} ms`);
console.log(`  quads fusionné/naïf : ${quadsFusion}/${quadsNaif} — réduction moyenne ${(reductionMoyenne * 100).toFixed(1)} % (budget ≥ ${(budget.reductionMoyenneMin * 100).toFixed(0)} %)`);
console.log(`  zone plate 16×16 (SPEC-PERF-011) : réduction ${reductionPlan.toFixed(1)}× (budget ≥ ${budget.reductionPlanMin}×)`);

let ok = true;
if (t.avg > budget.avgMsMax) { console.log(`✗ moyenne ${t.avg.toFixed(2)} ms > budget ${budget.avgMsMax} ms`); ok = false; }
if (t.p95 > budget.p95MsMax) { console.log(`✗ p95 ${t.p95.toFixed(2)} ms > budget ${budget.p95MsMax} ms`); ok = false; }
if (reductionMoyenne < budget.reductionMoyenneMin) { console.log(`✗ réduction moyenne ${(reductionMoyenne * 100).toFixed(1)} % < budget ${(budget.reductionMoyenneMin * 100).toFixed(0)} %`); ok = false; }
if (reductionPlan < budget.reductionPlanMin) { console.log(`✗ réduction zone plate ${reductionPlan.toFixed(1)}× < budget ${budget.reductionPlanMin}×`); ok = false; }

if (!ok) { console.log('\n✗ budget de performance dépassé (tests/budget-perf.json)'); process.exit(1); }
console.log('\n✓ budget de performance respecté');
