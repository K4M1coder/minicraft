#!/usr/bin/env node
/* Crochet pre-commit — contrôles rapides (quelques secondes) avant chaque
   commit ; la suite complète reste `node tests/gates.js`.
   - syntaxe de chaque fichier .js indexé ;
   - accord entre VERSION_JEU et CHANGELOG.md, section « Non publié » présente
     (tools/version.js --verifier, la même règle que la porte G10) ;
   - aucun marqueur de conflit de fusion oublié dans les fichiers indexés. */
'use strict';
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');

const erreurs = [];
let indexes = [];
try {
  indexes = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' }).split('\n').filter(Boolean);
} catch (e) { process.exit(0); }

indexes.filter(f => f.endsWith('.js') && fs.existsSync(f)).forEach(f => {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) erreurs.push('syntaxe invalide : ' + f + '\n' + (r.stderr || '').split('\n').slice(0, 4).join('\n'));
});
indexes.filter(f => /\.(js|html|md|css|json)$/.test(f) && fs.existsSync(f)).forEach(f => {
  if (/^(<{7}|>{7}) /m.test(fs.readFileSync(f, 'utf8'))) erreurs.push('marqueur de conflit oublié : ' + f);
});
try {
  const v = require('../version.js').verifier();
  v.erreurs.forEach(e => erreurs.push('version : ' + e));
} catch (e) { erreurs.push('version : ' + e.message); }

if (erreurs.length) {
  console.error('\n✗ commit refusé (tools/hooks/pre-commit.js) :');
  erreurs.forEach(e => console.error('  - ' + e));
  console.error('');
  process.exit(1);
}
