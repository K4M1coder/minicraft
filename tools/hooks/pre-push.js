#!/usr/bin/env node
/* Crochet pre-push — lance le préréglage `pr` (SPEC-BANC-006) : toute la
   suite Node (unitaire, fonctionnel, spec) plus l'intégration. La même
   commande sert à l'intégration continue d'une demande de fusion :
   `node tests/run.js --preset pr`. Utilise `--delai` pour ne jamais
   bloquer indéfiniment un push.

   Ensuite, `e2e-fumee` (SPEC-BANC-025) : quelques e2e rapides et
   représentatifs, sans fenêtre (tools/e2e-headless.js). Lancé en second,
   séparément de `pr` : run.js exécute lui-même les e2e sans fenêtre
   maintenant (SPEC-BANC-023), mais un poste ou un agent CI sans Edge/Chrome
   installé ne doit JAMAIS voir son push refusé pour ça — seule une vraie
   régression e2e (navigateur présent, test qui échoue) bloque le push. */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');

const racine = path.join(__dirname, '..', '..');

const rPr = spawnSync(process.execPath, [path.join(racine, 'tests', 'run.js'), '--preset', 'pr', '--delai', '600'],
  { stdio: 'inherit', cwd: racine });

if (rPr.status !== 0) {
  console.error('\n✗ push refusé (tools/hooks/pre-push.js) : le préréglage pr échoue.\n');
  process.exit(rPr.status || 1);
}

const rFumee = spawnSync(process.execPath, [path.join(racine, 'tests', 'run.js'), '--preset', 'e2e-fumee', '--delai', '150'],
  { stdio: 'inherit', cwd: racine });

/* run.js écrit "(aucun navigateur Edge/Chrome installé — end-to-end
   ignoré(s), sans échec…)" sur stderr et sort avec le code 0 dans ce cas
   précis (aucun test n'a pu être comptabilisé en échec) : le poste sans
   navigateur passe donc déjà. Seul un VRAI échec (navigateur présent, test
   qui casse, ou infrastructure indisponible pour une autre raison) fait
   échouer rFumee.status et doit refuser le push. */
if (rFumee.status !== 0) {
  console.error('\n✗ push refusé (tools/hooks/pre-push.js) : le préréglage e2e-fumee échoue.\n');
  process.exit(rFumee.status || 1);
}
