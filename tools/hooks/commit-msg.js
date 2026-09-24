#!/usr/bin/env node
/* Crochet commit-msg — encadre les messages et le versionnage.
   1. Le message suit les Commits conventionnels :
        type(portée facultative)!: résumé
      types : feat fix perf refactor docs test chore build ci style revert specs
      (`!` ou un pied « BREAKING CHANGE: » signale une rupture).
   2. Un feat, fix ou perf qui touche au code consigne son changement dans
      CHANGELOG.md (section « Non publié ») — dans le même commit.
   3. La version (VERSION_JEU) ne change que dans un commit de publication
      « chore(release): vX.Y.Z », produit par `node tools/version.js --publier`.
   Les fusions, annulations et fixup/squash automatiques passent. */
'use strict';
const fs = require('fs');
const { execSync } = require('child_process');

const fichier = process.argv[2];
const brut = fs.readFileSync(fichier, 'utf8');
const lignes = brut.split('\n').filter(l => !l.startsWith('#'));
const titre = (lignes[0] || '').trim();
const TYPES = ['feat', 'fix', 'perf', 'refactor', 'docs', 'test', 'chore', 'build', 'ci', 'style', 'revert', 'specs'];
const FORMAT = new RegExp('^(' + TYPES.join('|') + ')(\\([^)]+\\))?(!)?: \\S.*');
const erreurs = [];

function sortir() {
  if (!erreurs.length) process.exit(0);
  console.error('\n✗ commit refusé (tools/hooks/commit-msg.js) :');
  erreurs.forEach(e => console.error('  - ' + e));
  console.error('\n  Règles : voir PLAN.md, « Commits et versions ».\n');
  process.exit(1);
}

if (/^(Merge |Revert "|fixup! |squash! |amend! )/.test(titre)) process.exit(0);
if (!FORMAT.test(titre)) {
  erreurs.push('titre hors format « type(portée): résumé » — types : ' + TYPES.join(', ') + ' ; reçu : « ' + titre + ' »');
  sortir();
}
const type = titre.match(FORMAT)[1];

let indexes = [];
try { indexes = execSync('git diff --cached --name-only', { encoding: 'utf8' }).split('\n').filter(Boolean); } catch (e) { /* hors dépôt */ }
const code = indexes.filter(f => /^(src\/|server\.js$|index\.html$|admin\.html$|tools\/)/.test(f));

// 2. un changement visible se consigne dans le journal
if (['feat', 'fix', 'perf'].indexOf(type) >= 0 && code.length && indexes.indexOf('CHANGELOG.md') < 0) {
  erreurs.push('un ' + type + ' qui touche au code (' + code.slice(0, 3).join(', ') + (code.length > 3 ? '…' : '') +
               ') doit décrire son changement sous « ## [Non publié] » dans CHANGELOG.md');
}

// 3. la version ne bouge que dans une publication
let versionChange = false;
if (indexes.indexOf('src/core.js') >= 0) {
  try {
    const diff = execSync('git diff --cached -U0 -- src/core.js', { encoding: 'utf8' });
    versionChange = /^[+-]\s*var VERSION_JEU = /m.test(diff);
  } catch (e) { /* rien */ }
}
const publication = /^chore\(release\): v?\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(titre);
if (versionChange && !publication) {
  erreurs.push('VERSION_JEU ne change que dans un commit « chore(release): vX.Y.Z » (node tools/version.js --publier)');
}
if (publication && !versionChange) erreurs.push('un commit de publication doit monter VERSION_JEU');
sortir();
