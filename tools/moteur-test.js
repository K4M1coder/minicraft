/* tools/moteur-test.js — la version du MOTEUR de test (SPEC-BANC-112).

   Le « moteur » est ce qui produit un run : le lanceur (tests/run.js), le
   harnais, le catalogue, l'orchestration des navigateurs (tools/e2e-headless.js,
   CDP), les diagnostics (tools/diagnostics.js), l'écriture du cahier et du
   registre. Chaque entrée du registre enregistre celui qui l'a produite :
   quand `historiser` rejoue un VIEUX commit avec le code de jeu et les tests de
   ce commit, la version enregistrée reste celle du dépôt COURANT — c'est ce qui
   permet de comparer deux runs sans confondre « le jeu a changé » et « la
   façon de le tester a changé ».

   VERSION est le format des cahiers et des entrées que ce moteur écrit : à
   incrémenter quand ce format change d'une façon qu'un lecteur doit connaître.
   `commit` est le HEAD du dépôt qui porte le moteur ; `jeu` la version du jeu
   qui s'y trouve. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VERSION = 1;
const RACINE = path.join(__dirname, '..');

function moteurTestActuel(racine) {
  const r = racine || RACINE;
  let commit = null, jeu = null;
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: r, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim() || null; } catch (e) { /* hors dépôt */ }
  try { jeu = /VERSION_JEU\s*=\s*'([^']+)'/.exec(fs.readFileSync(path.join(r, 'src', 'core.js'), 'utf8'))[1]; } catch (e) { /* rien */ }
  return { version: VERSION, commit, jeu };
}

module.exports = { VERSION, moteurTestActuel };
