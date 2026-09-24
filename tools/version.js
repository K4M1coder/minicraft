#!/usr/bin/env node
/* tools/version.js — monte la version et publie l'entrée « Non publié » du
   journal (CHANGELOG.md, format Tenez un Changelog).

   node tools/version.js            Z + 1  (chaque tâche terminée, au minimum)
   node tools/version.js y          Y + 1, Z = 0 (fonctionnalité notable)
   node tools/version.js x          X + 1, Y = Z = 0 (rupture de compatibilité)
   node tools/version.js --verifier contrôle seulement (porte G10)

   Chaque nombre a de 1 à 5 chiffres. La version vit dans src/core.js
   (VERSION_JEU) ; le journal reçoit une section datée avec ce qui était
   sous « Non publié ». */
'use strict';
const fs = require('fs');
const path = require('path');
const RACINE = path.join(__dirname, '..');
const CORE = path.join(RACINE, 'src', 'core.js');
const JOURNAL = path.join(RACINE, 'CHANGELOG.md');
const FORMAT = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;

function lireVersion() {
  const m = fs.readFileSync(CORE, 'utf8').match(/var VERSION_JEU = '([^']+)'/);
  if (!m) throw new Error('VERSION_JEU introuvable dans src/core.js');
  return m[1];
}
function derniereDuJournal(texte) {
  const m = texte.match(/^## \[(\d+\.\d+\.\d+)\]/m);
  return m ? m[1] : null;
}
function monter(v, cran) {
  const [x, y, z] = v.split('.').map(Number);
  const n = cran === 'x' ? [x + 1, 0, 0] : cran === 'y' ? [x, y + 1, 0] : [x, y, z + 1];
  if (n.some(k => k > 99999)) throw new Error('un nombre dépasserait 5 chiffres : ' + n.join('.'));
  return n.join('.');
}
/* Contrôle : format, accord jeu ↔ journal, section « Non publié » présente. */
function verifier() {
  const v = lireVersion(), j = fs.readFileSync(JOURNAL, 'utf8');
  const erreurs = [];
  if (!FORMAT.test(v)) erreurs.push('version ' + v + ' hors format X.Y.Z (1 à 5 chiffres chacun)');
  const d = derniereDuJournal(j);
  if (d !== v) erreurs.push('le journal publie ' + d + ' mais le jeu annonce ' + v);
  if (!/^## \[Non publié\]/m.test(j)) erreurs.push('section « Non publié » absente du journal');
  return { version: v, erreurs: erreurs };
}

if (require.main === module) {
  const arg = (process.argv[2] || 'z').toLowerCase();
  if (arg === '--verifier') {
    const r = verifier();
    if (r.erreurs.length) { console.error(r.erreurs.join('\n')); process.exit(1); }
    console.log('version ' + r.version + ' : conforme');
    process.exit(0);
  }
  const avant = lireVersion(), apres = monter(avant, arg);
  const core = fs.readFileSync(CORE, 'utf8').replace("var VERSION_JEU = '" + avant + "'", "var VERSION_JEU = '" + apres + "'");
  fs.writeFileSync(CORE, core);
  const date = new Date().toISOString().slice(0, 10);
  let j = fs.readFileSync(JOURNAL, 'utf8');
  j = j.replace(/^## \[Non publié\]\s*\n/m, '## [Non publié]\n\n## [' + apres + '] - ' + date + '\n');
  if (!new RegExp('^\\[' + apres.replace(/\./g, '\\.') + '\\]:', 'm').test(j)) j = j.replace(/^\[Non publié\]: #$/m, '[Non publié]: #\n[' + apres + ']: #');
  fs.writeFileSync(JOURNAL, j);
  console.log(avant + ' → ' + apres);
}

module.exports = { verifier, monter, FORMAT };
