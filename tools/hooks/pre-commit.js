#!/usr/bin/env node
/* Crochet pre-commit — contrôles rapides avant chaque commit ; la suite
   complète reste `node tests/gates.js`.
   - syntaxe de chaque fichier .js indexé ;
   - accord entre VERSION_JEU et CHANGELOG.md, section « Non publié » présente
     (tools/version.js --verifier, la même règle que la porte G10) ;
   - aucun marqueur de conflit de fusion oublié dans les fichiers indexés ;
   - le préréglage `commit` du catalogue de tests (SPEC-BANC-004/006) :
     specs, unitaires et fonctionnels, sans navigateur ni intégration, sans
     les tests étiquetés @lent — RESTREINT AU PÉRIMÈTRE DU COMMIT
     (SPEC-BANC-071) : `node tests/run.js --preset commit --perimetre commit`.
     Le moteur (tools/perimetre.js) ne garde que les tests touchés par les
     fichiers indexés (fichiers de test modifiés, fonctions touchées selon la
     carte d'impact, domaines, fumée) et retombe sur le préréglage `commit`
     ENTIER dès qu'il ne peut pas conclure (outillage, serveur, page,
     module absent de la carte, carte absente ou trop ancienne…) : dans le
     doute il élargit, jamais il ne réduit. Le préréglage complet dure
     plusieurs minutes ; un commit qui ne touche qu'une fonction, quelques
     secondes.
   - un commit de MERGE avec conflits résolus (MERGE_HEAD présent) lance la
     SUITE COMPLÈTE au lieu du périmètre (SPEC-BANC-073) : `--preset pr` en
     entier puis `--preset e2e-fumee`, inscription au registre et carte
     d'impact (tools/hooks/suite-complete.js), comme pre-merge-commit.
   `--delai 900` (le filet commun de 15 min, SPEC-BANC-010 révisée —
   tools/hooks/delai-filet.js) reste un filet anti-blocage, jamais un couperet. */
'use strict';
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DELAI_FILET_S } = require('./delai-filet.js');

const erreurs = [];

// Registre officiel (SPEC-BANC-028) : une inscription laissée « en_attente »
// par un pre-push précédent (le commit qu'elle cite est déjà fait, mais son
// écriture n'a pas pu y entrer) est intégrée AUTOMATIQUEMENT ICI, au commit
// suivant — flip du statut puis `git add`, avant que le commit ne se fasse.
try {
  const REG = require('../registre.js');
  if (REG.aDesEntreesEnAttente()) {
    REG.marquerEnAttenteCommitees();
    execSync('git add -- ' + REG.DOSSIER_REGISTRE_REL, { cwd: path.join(__dirname, '..', '..') });
  }
} catch (e) { erreurs.push('registre (tests/registre/) : ' + e.message); }
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
// G1/G2 en rapide : toute spec non-⏳ citée par un test, tout identifiant cité existe
try {
  const path = require('path'), racine = path.join(__dirname, '..', '..');
  const specs = fs.readFileSync(path.join(racine, 'SPECS.md'), 'utf8').split('\n')
    .map(l => l.match(/^\| (SPEC-[A-Z0-9]+-\d+) \|.*\| *(⏳|✅) *\|\s*$/)).filter(Boolean);
  const declarees = new Set(specs.map(m => m[1]));
  const cites = new Set();
  fs.readdirSync(path.join(racine, 'tests')).filter(f => f.endsWith('.js')).forEach(f => {
    (fs.readFileSync(path.join(racine, 'tests', f), 'utf8').match(/SPEC-[A-Z0-9]+-\d+/g) || []).forEach(id => cites.add(id));
  });
  const orphelines = specs.filter(m => m[2] === '✅' && !cites.has(m[1])).map(m => m[1]);
  if (orphelines.length) erreurs.push('spec(s) ✅ sans test qui les cite : ' + orphelines.join(', '));
  const fantomes = [...cites].filter(id => !declarees.has(id));
  if (fantomes.length) erreurs.push('identifiant(s) cité(s) par un test mais absent(s) de SPECS.md : ' + fantomes.slice(0, 5).join(', '));
} catch (e) { erreurs.push('couverture des specs : ' + e.message); }
try {
  const v = require('../version.js').verifier();
  v.erreurs.forEach(e => erreurs.push('version : ' + e));
} catch (e) { erreurs.push('version : ' + e.message); }

// SPEC-BANC-073 : merge avec conflits résolus → suite complète, pas de périmètre
const racineDepot = path.join(__dirname, '..', '..');
const enMerge = require('./suite-complete.js').estEnMerge(racineDepot); // MERGE_HEAD présent ?

if (enMerge) {
  if (!erreurs.length) {
    console.error('(pre-commit : MERGE_HEAD présent — merge avec conflits résolus, suite complète : --preset pr puis --preset e2e-fumee)');
    const r = require('./suite-complete.js').lancerSuiteComplete({
      origine: 'merge',
      etapes: [
        { args: ['--preset', 'pr'], carte: true },
        { args: ['--preset', 'e2e-fumee'] },
      ],
    });
    if (!r.ok) erreurs.push('suite complète du merge en échec (' + r.etape + ')');
  }
} else {
  // SPEC-BANC-071 : le préréglage `commit` restreint au périmètre du commit
  try {
    const args = ['--preset', 'commit', '--perimetre', 'commit', '--delai', String(DELAI_FILET_S)];
    const r = spawnSync(process.execPath, [path.join(racineDepot, 'tests', 'run.js'), ...args], { encoding: 'utf8', cwd: racineDepot, maxBuffer: 256 * 1024 * 1024 });
    // la ligne de périmètre (retenus/exclus ou motif du repli) est sur stderr
    const lignePerimetre = (r.stderr || '').split('\n').find(l => /^\(périmètre/.test(l));
    if (lignePerimetre) console.error(lignePerimetre);
    if (r.status !== 0) erreurs.push('préréglage `commit` en échec (node tests/run.js ' + args.join(' ') + ') :\n' + (r.stdout || '').split('\n').slice(-25).join('\n'));
  } catch (e) { erreurs.push('préréglage `commit` : ' + e.message); }
}

if (erreurs.length) {
  console.error('\n✗ commit refusé (tools/hooks/pre-commit.js) :');
  erreurs.forEach(e => console.error('  - ' + e));
  console.error('');
  process.exit(1);
}
