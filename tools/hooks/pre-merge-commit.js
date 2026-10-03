#!/usr/bin/env node
/* Crochet pre-merge-commit (SPEC-BANC-073) — un merge SANS conflit (git
   n'appelle pas pre-commit dans ce cas) déclenche la SUITE COMPLÈTE, comme
   un pre-push : `node tests/run.js --preset pr` en entier, puis
   `node tests/run.js --preset e2e-fumee`, inscription automatique au registre
   (origine 'merge', statut 'en_attente') et reconstruction de la carte
   d'impact après un `pr` réussi. Le merge AVEC conflits résolus passe, lui,
   par pre-commit, qui détecte MERGE_HEAD et lance la même suite.
   Filet commun de 15 min (SPEC-BANC-010) — tools/hooks/suite-complete.js. */
'use strict';
const { lancerSuiteComplete } = require('./suite-complete.js');

const r = lancerSuiteComplete({
  origine: 'merge',
  etapes: [
    { args: ['--preset', 'pr'], carte: true },
    { args: ['--preset', 'e2e-fumee'] },
  ],
});
if (!r.ok) {
  console.error('\n✗ merge refusé (tools/hooks/pre-merge-commit.js) : ' + r.etape + ' échoue.\n');
  process.exit(r.code);
}
