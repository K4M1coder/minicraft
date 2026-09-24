/* run.js — exécute les tests de logique pure sous Node.
   Usage : node tests/run.js [filtre] [--delai N] [--silencieux]

   - filtre : ne garde que les groupes (describe) — ou, à défaut, les tests —
     dont le nom le contient ;
   - la progression s'écrit sur stderr pendant l'exécution, sans tampon : une
     ligne au début et à la fin de chaque groupe, et chaque test de plus de
     SEUIL_LENT secondes est signalé ; --silencieux la coupe ;
   - --delai N : exécute la suite dans un processus enfant et l'arrête au bout
     de N secondes, en nommant le test en cours (les tests sont synchrones : un
     minuteur interne ne pourrait pas les interrompre).

   Les sources sont des scripts classiques qui s'accrochent au global : on les
   évalue donc dans le contexte courant plutôt que de les `require`. C'est ce
   qui permet aux mêmes fichiers de tourner en `file://` dans le navigateur. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const option = (nom) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : null; };
const silencieux = args.includes('--silencieux');
const SEUIL_LENT = 20;

// ── --delai N : un processus parent surveille l'enfant qui exécute la suite ──
if (option('--delai') && !process.env.MC_RUN_ENFANT) {
  const { spawn } = require('child_process');
  const os = require('os');
  const etat = path.join(os.tmpdir(), 'mc-run-etat-' + process.pid + '.txt');
  const reste = args.filter((a, i) => a !== '--delai' && args[i - 1] !== '--delai');
  const enfant = spawn(process.execPath, [__filename, ...reste],
    { stdio: 'inherit', env: Object.assign({}, process.env, { MC_RUN_ENFANT: '1', MC_RUN_ETAT: etat }) });
  const limite = setTimeout(() => {
    let enCours = '(inconnu)';
    try { enCours = fs.readFileSync(etat, 'utf8'); } catch (e) { /* rien */ }
    enfant.kill();
    fs.writeSync(2, '\n✗ délai de ' + option('--delai') + ' s dépassé pendant : ' + enCours + '\n');
    try { fs.unlinkSync(etat); } catch (e) { /* rien */ }
    process.exit(3);
  }, parseFloat(option('--delai')) * 1000);
  enfant.on('exit', (code) => { clearTimeout(limite); try { fs.unlinkSync(etat); } catch (e) { /* rien */ } process.exit(code === null ? 3 : code); });
  return;
}
const SRC = ['core', 'formes', 'noise', 'biomes', 'densite', 'zones', 'volcanisme', 'souterrain', 'recifs', 'caravanes', 'donjons', 'habitats', 'routes', 'histoire', 'recits', 'carte', 'eau', 'feu', 'meteo', 'lointain', 'world', 'circuits', 'lumiere', 'ombres', 'succes', 'mesher', 'physics', 'faune', 'factions', 'inventory', 'vehicules',
             'entities', 'player', 'synchro', 'daycycle', 'save', 'saves', 'modes', 'chat', 'commandes', 'options', 'apparence', 'split', 'hud', 'gamepad', 'net-protocol', 'parametres', 'admin', 'politique', 'guildes', 'livre', 'livres', 'ambiance', 'audio'];
const TESTS = ['unit', 'functional', 'spec-modes', 'spec-saves', 'spec-audit', 'spec-armes', 'spec-chat', 'spec-split', 'spec-net', 'spec-ia-coll', 'spec-livre', 'spec-monde', 'spec-mer', 'spec-vehicules', 'spec-horizon', 'spec-climat', 'spec-habitats', 'spec-routes', 'spec-histoire', 'spec-succes', 'spec-ombres', 'spec-population', 'spec-hud', 'spec-couverture', 'spec-recits', 'spec-commandes', 'spec-portes', 'spec-eau', 'spec-vent', 'spec-loin', 'spec-donjons', 'spec-audio', 'spec-options', 'spec-souterrain', 'spec-apparence', 'spec-saisons', 'spec-parametres', 'spec-admin', 'spec-densite', 'spec-volcans', 'spec-caravanes', 'spec-zones', 'spec-blocs16', 'spec-politique', 'spec-guildes', 'spec-materiaux', 'spec-circuits', 'spec-objets', 'spec-formes', 'spec-recifs', 'spec-interieur', 'spec-batiments'];

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

const filter = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--')) || null;
const ecrire = (t) => { if (!silencieux) fs.writeSync(2, t + '\n'); };
const fichierEtat = process.env.MC_RUN_ETAT || null;
const debut = Date.now();
const secondes = (ms) => (ms / 1000).toFixed(1) + ' s';
const res = ctx.T.run(filter, {
  debutGroupe: (nom, n) => ecrire('▶ ' + nom + ' (' + n + ' test' + (n > 1 ? 's' : '') + ')'),
  debutTest: (groupe, nom) => { if (fichierEtat) try { fs.writeFileSync(fichierEtat, groupe + ' › ' + nom); } catch (e) { /* rien */ } },
  finTest: (groupe, nom, ok, ms) => { if (ms > SEUIL_LENT * 1000) ecrire('  ⚠ lent (' + secondes(ms) + ') : ' + nom); },
  finGroupe: (nom, p, f, ms) => ecrire((f ? '  ✗ ' : '  ✓ ') + p + '/' + (p + f) + ' en ' + secondes(ms) +
                                        ' — total écoulé ' + secondes(Date.now() - debut)),
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
if (res.failed) {
  console.log(`${C.r}${res.failed} échec(s)${C.x} sur ${total} tests\n`);
  process.exit(1);
} else {
  console.log(`${C.g}${res.passed}/${total} tests passent${C.x}\n`);
}
