/* tools/git-propre.js — lancer git sur un AUTRE dépôt que celui-ci sans
   hériter des variables GIT_* (revue de SPEC-BANC-073).

   Un crochet git (pre-commit, pre-merge-commit…) exporte GIT_DIR,
   GIT_INDEX_FILE, GIT_WORK_TREE… vers tout ce qu'il lance. Un test (ou un
   outil) qui crée un dépôt jetable puis y lance `git init`/`git commit` agit
   alors sur le VRAI dépôt (constaté : un commit « init » dans la branche et
   core.bare=true écrit dans .git/config). À l'inverse, le crochet LUI-MÊME
   doit garder GIT_INDEX_FILE (c'est l'index du commit en cours, `git commit
   -a` compris) : on ne nettoie que pour un dossier qui n'est pas ce dépôt. */
'use strict';
const path = require('path');

const RACINE = path.resolve(__dirname, '..');

function envSansGit(env) {
  const src = env || process.env;
  const out = {};
  Object.keys(src).forEach((k) => { if (!/^GIT_/i.test(k)) out[k] = src[k]; });
  return out;
}
/* L'environnement à donner à git lancé dans `dossier` : celui hérité pour ce
   dépôt-ci, sans GIT_* pour tout autre dossier. */
function envGitPour(dossier) {
  const d = path.resolve(dossier || RACINE).toLowerCase();
  return d === RACINE.toLowerCase() ? process.env : envSansGit();
}

module.exports = { envSansGit, envGitPour, RACINE };
