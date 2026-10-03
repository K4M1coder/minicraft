#!/usr/bin/env node
/* Crochet pre-push (= validation d'une demande de fusion, SPEC-BANC-072) —
   la SUITE COMPLÈTE, jamais un périmètre :
   1. `node tests/run.js --preset pr` (SPEC-BANC-006) : toute la suite Node
      (unitaire, fonctionnel, spec) plus l'intégration, portes de tests
      comprises ; la même commande sert à l'intégration continue d'une
      demande de fusion ;
   2. `node tests/run.js --preset e2e-fumee` (SPEC-BANC-025) : quelques e2e
      rapides et représentatifs, sans fenêtre. Lancé en second, séparément :
      un poste sans Edge/Chrome ne doit JAMAIS voir son push refusé pour ça
      (run.js sort alors en 0) — seule une vraie régression e2e bloque.
   Chaque cahier est inscrit AUTOMATIQUEMENT au registre (origine
   'pre-push', statut 'en_attente' : ce crochet tourne APRÈS le commit, le
   suivant l'intégrera — tools/hooks/pre-commit.js), et la carte d'impact
   (tests/registre/impact.json, SPEC-BANC-067) est reconstruite après un `pr`
   réussi. Filet commun de 15 min (SPEC-BANC-010) — tools/hooks/suite-complete.js. */
'use strict';
const { lancerSuiteComplete } = require('./suite-complete.js');

const r = lancerSuiteComplete({
  origine: 'pre-push',
  etapes: [
    { args: ['--preset', 'pr'], carte: true },
    { args: ['--preset', 'e2e-fumee'] },
  ],
});
if (!r.ok) {
  console.error('\n✗ push refusé (tools/hooks/pre-push.js) : ' + r.etape + ' échoue.\n');
  process.exit(r.code);
}
