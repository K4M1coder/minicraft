/* integration-charge.js — SPEC-SERVEUR-002 : vérifie que le banc de charge
   (tests/charge.js) fonctionne réellement et produit ses mesures — sans le
   faire tourner à pleine échelle (ça, c'est le rôle de tests/charge.js
   lui-même, lancé à la main ou en CI dédiée : voir README.md).

   Deux paliers minuscules (1 et 5), une seconde de mesure, pour rester un
   test COURT qui ne ralentit pas la suite d'intégration.

   Usage : node tests/integration-charge.js */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const C = { r: '\x1b[31m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

const rapport = path.join(RACINE, 'tests', '.tmp-charge-rapport.json');
const r = spawnSync(process.execPath, [
  path.join(RACINE, 'tests', 'charge.js'),
  '--paliers', '1,5', '--duree', '1', '--calage', '1',
  '--scenario', 'tous', '--port-base', '8790', '--rapport', rapport,
], { cwd: RACINE, encoding: 'utf8', timeout: 60000 });

let passes = 0, echecs = 0;
const details = [];
function ok(cond, nom, info) {
  if (cond) { passes++; details.push(`  ${C.g}·${C.x} ${C.d}${nom}${C.x}`); }
  else { echecs++; details.push(`  ${C.r}✗ ${nom}${C.x}${info ? '\n    ' + C.r + info + C.x : ''}`); }
}

ok(r.status === 0, 'SPEC-SERVEUR-002 : le banc de charge s\'exécute sans dépasser ses seuils',
   'code ' + r.status + '\n' + (r.stdout || '') + (r.stderr || ''));
ok(/groupe/.test(r.stdout) && /reparti/.test(r.stdout),
   'SPEC-SERVEUR-002 : les deux scénarios (groupé, réparti) tournent');
ok(/tic .*ms \(moy\/p95\)/.test(r.stdout), 'SPEC-SERVEUR-002 : la durée des tics est mesurée et rapportée');
ok(/latence p95/.test(r.stdout), 'SPEC-SERVEUR-002 : la latence est mesurée et rapportée');
ok(/Ko\/s\/client/.test(r.stdout), 'SPEC-SERVEUR-002 : le débit réseau par client est mesuré et rapporté');

const fs = require('fs');
let donnees = null;
try { donnees = JSON.parse(fs.readFileSync(rapport, 'utf8')); } catch (e) {}
ok(Array.isArray(donnees) && donnees.length === 4,
   'SPEC-SERVEUR-002 : le rapport JSON facultatif liste chaque (scénario, palier)',
   donnees ? JSON.stringify(donnees.length) : 'rapport illisible');
ok(!!donnees && donnees.every(d => d.serveur && typeof d.serveur.tickMoyenMs === 'number'),
   'SPEC-SERVEUR-002 : chaque entrée porte la mesure serveur (tic moyen, p95, mémoire)');
try { fs.unlinkSync(rapport); } catch (e) {}

console.log(`\n${C.b}Intégration — banc de charge${C.x}`);
console.log(details.join('\n'));
const total = passes + echecs;
if (echecs) {
  console.log(`\n${C.r}${echecs} echec(s)${C.x} sur ${total}\n`);
  process.exit(1);
}
console.log(`\n${C.g}${passes}/${total} tests d'intégration passent${C.x}\n`);
process.exit(0);
