/* delai-filet.js — le filet anti-blocage commun aux crochets git (SPEC-BANC-010
   révisée) : un seul délai, partout, identique à celui que la ligne de
   commande applique déjà par défaut (15 min) — pour qu'un crochet qui finit
   par réussir ne soit jamais coupé plus tôt qu'un lancement manuel du même
   préréglage. Constante partagée pour que pre-commit.js et pre-push.js
   restent forcément d'accord entre eux. */
'use strict';
module.exports = { DELAI_FILET_S: 900 };
