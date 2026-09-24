/* run.js — exécute les tests de logique pure sous Node.
   Usage : node tests/run.js [filtre]

   Les sources sont des scripts classiques qui s'accrochent au global : on les
   évalue donc dans le contexte courant plutôt que de les `require`. C'est ce
   qui permet aux mêmes fichiers de tourner en `file://` dans le navigateur. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const SRC = ['core', 'formes', 'noise', 'biomes', 'densite', 'zones', 'volcanisme', 'souterrain', 'recifs', 'caravanes', 'donjons', 'habitats', 'routes', 'histoire', 'recits', 'carte', 'eau', 'meteo', 'lointain', 'world', 'circuits', 'lumiere', 'ombres', 'succes', 'mesher', 'physics', 'faune', 'factions', 'inventory', 'vehicules',
             'entities', 'player', 'synchro', 'daycycle', 'save', 'saves', 'modes', 'chat', 'commandes', 'options', 'apparence', 'split', 'hud', 'gamepad', 'net-protocol', 'parametres', 'admin', 'politique', 'guildes', 'livre', 'ambiance', 'audio'];
const TESTS = ['unit', 'functional', 'spec-modes', 'spec-saves', 'spec-audit', 'spec-armes', 'spec-chat', 'spec-split', 'spec-net', 'spec-ia-coll', 'spec-livre', 'spec-monde', 'spec-mer', 'spec-vehicules', 'spec-horizon', 'spec-climat', 'spec-habitats', 'spec-routes', 'spec-histoire', 'spec-succes', 'spec-ombres', 'spec-population', 'spec-hud', 'spec-couverture', 'spec-recits', 'spec-commandes', 'spec-portes', 'spec-eau', 'spec-vent', 'spec-loin', 'spec-donjons', 'spec-audio', 'spec-options', 'spec-souterrain', 'spec-apparence', 'spec-saisons', 'spec-parametres', 'spec-admin', 'spec-densite', 'spec-volcans', 'spec-caravanes', 'spec-zones', 'spec-blocs16', 'spec-politique', 'spec-guildes', 'spec-circuits', 'spec-objets', 'spec-formes', 'spec-recifs'];

const ctx = vm.createContext(Object.assign(Object.create(null), {
  console, Math, JSON, Date, Error, Number, String, Array, Object, Boolean,
  Map, Set, Uint8Array, Float32Array, isNaN, isFinite, parseInt, parseFloat,
  performance: { now: () => Date.now() },
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
TESTS.forEach(f => loadInto(`tests/${f}.js`));

const filter = process.argv[2] || null;
const res = ctx.T.run(filter);

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
if (res.failed) {
  console.log(`${C.r}${res.failed} échec(s)${C.x} sur ${total} tests\n`);
  process.exit(1);
} else {
  console.log(`${C.g}${res.passed}/${total} tests passent${C.x}\n`);
}
