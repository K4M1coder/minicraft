#!/usr/bin/env node
/* Crochet pre-push — lance le préréglage `pr` (SPEC-BANC-006) : toute la
   suite Node (unitaire, fonctionnel, spec) plus l'intégration ; pas le
   navigateur (il n'y a pas de navigateur disponible dans un crochet git ni
   en intégration continue). La même commande sert à l'intégration continue
   d'une demande de fusion : `node tests/run.js --preset pr`.
   Utilise `--delai` pour ne jamais bloquer indéfiniment un push. */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const racine = path.join(__dirname, '..', '..');
const r = spawnSync(process.execPath, [path.join(racine, 'tests', 'run.js'), '--preset', 'pr', '--delai', '600'],
  { stdio: 'inherit', cwd: racine });

if (r.status !== 0) {
  console.error('\n✗ push refusé (tools/hooks/pre-push.js) : le préréglage pr échoue.\n');
  process.exit(r.status || 1);
}
