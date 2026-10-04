#!/usr/bin/env node
/* tools/version.js — versionnage sémantique piloté par les Commits
   conventionnels, et journal au format Tenez un Changelog (CHANGELOG.md).

   node tools/version.js --prevoir     quelle publication donneraient les commits
                                       depuis la dernière étiquette (sans rien écrire)
   node tools/version.js --publier     publie : calcule le cran, monte VERSION_JEU,
                                       date la section « Non publié », compacte le
                                       registre du cycle (SPEC-BANC-091), commite
                                       « chore(release): vX.Y.Z » et pose l'étiquette
   node tools/version.js --publier y   impose le cran (x, y ou z) au lieu de le calculer
   node tools/version.js --verifier    contrôle seulement (porte G10, crochet pre-commit)
   node tools/version.js --installer   branche les crochets git du dépôt (.githooks)

   Règle du cran, d'après les commits depuis la dernière étiquette vX.Y.Z :
   - une rupture (« type!: » ou un pied « BREAKING CHANGE: ») → X
     (tant que X vaut 0, une rupture monte Y : l'API n'est pas encore stable) ;
   - un feat → Y ;
   - un fix ou un perf → Z ;
   - rien de tout cela (docs, test, chore, specs…) → pas de publication.
   Chaque nombre a de 1 à 5 chiffres. On publie à la fin d'une tâche, pas à
   chaque commit ; le crochet commit-msg refuse un changement de version hors
   d'un commit de publication. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, execFileSync } = require('child_process');
const RACINE = path.join(__dirname, '..');
const CORE = path.join(RACINE, 'src', 'core.js');
const JOURNAL = path.join(RACINE, 'CHANGELOG.md');
const FORMAT = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
const git = cmd => execSync('git ' + cmd, { cwd: RACINE, encoding: 'utf8' });

function lireVersion() {
  const m = fs.readFileSync(CORE, 'utf8').match(/var VERSION_JEU = '([^']+)'/);
  if (!m) throw new Error('VERSION_JEU introuvable dans src/core.js');
  return m[1];
}
function derniereDuJournal(texte) {
  const m = texte.match(/^## \[(\d+\.\d+\.\d+)\]/m);
  return m ? m[1] : null;
}
function monter(v, cran) {
  const [x, y, z] = v.split('.').map(Number);
  const n = cran === 'x' ? [x + 1, 0, 0] : cran === 'y' ? [x, y + 1, 0] : [x, y, z + 1];
  if (n.some(k => k > 99999)) throw new Error('un nombre dépasserait 5 chiffres : ' + n.join('.'));
  return n.join('.');
}
/* Le cran qu'appellent des commits (titres et corps) ; null si aucun. */
function cranDes(commits, version) {
  let cran = null;
  const rang = { z: 1, y: 2, x: 3 };
  const pousser = c => { if (!cran || rang[c] > rang[cran]) cran = c; };
  commits.forEach(c => {
    const t = c.titre, m = t.match(/^(\w+)(\([^)]*\))?(!)?: /);
    if (!m) return;
    if (m[3] || /^BREAKING[ -]CHANGE: /m.test(c.corps || '')) pousser(Number(version.split('.')[0]) === 0 ? 'y' : 'x');
    else if (m[1] === 'feat') pousser('y');
    else if (m[1] === 'fix' || m[1] === 'perf') pousser('z');
  });
  return cran;
}
function derniereEtiquette() {
  try { return git('describe --tags --abbrev=0 --match "v[0-9]*"').trim(); } catch (e) { return null; }
}
function commitsDepuis(etiquette) {
  const sep = '\u0001', fin = '\u0002';
  const brut = git('log ' + (etiquette ? etiquette + '..HEAD' : 'HEAD') + ' --no-merges --format=%s' + sep + '%b' + fin);
  return brut.split(fin).map(s => s.trim()).filter(Boolean).map(s => {
    const [titre, corps] = s.split(sep);
    return { titre: titre.trim(), corps: corps || '' };
  });
}
/* Contrôle : format, accord jeu ↔ journal, section « Non publié » présente. */
function verifier() {
  const v = lireVersion(), j = fs.readFileSync(JOURNAL, 'utf8');
  const erreurs = [];
  if (!FORMAT.test(v)) erreurs.push('version ' + v + ' hors format X.Y.Z (1 à 5 chiffres chacun)');
  const d = derniereDuJournal(j);
  if (d !== v) erreurs.push('le journal publie ' + d + ' mais le jeu annonce ' + v);
  if (!/^## \[Non publié\]/m.test(j)) erreurs.push('section « Non publié » absente du journal');
  return { version: v, erreurs: erreurs };
}
/* Écrit la nouvelle version dans le jeu et date la section « Non publié ». */
function ecrire(avant, apres) {
  fs.writeFileSync(CORE, fs.readFileSync(CORE, 'utf8').replace("var VERSION_JEU = '" + avant + "'", "var VERSION_JEU = '" + apres + "'"));
  const date = new Date().toISOString().slice(0, 10);
  let j = fs.readFileSync(JOURNAL, 'utf8');
  j = j.replace(/^## \[Non publié\]\s*\n/m, '## [Non publié]\n\n## [' + apres + '] - ' + date + '\n');
  if (!new RegExp('^\\[' + apres.replace(/\./g, '\\.') + '\\]:', 'm').test(j)) j = j.replace(/^\[Non publié\]: #$/m, '[Non publié]: #\n[' + apres + ']: #');
  fs.writeFileSync(JOURNAL, j);
}
function installer() {
  // chemin absolu : les worktrees (agents) partagent ces crochets même quand leur branche est antérieure
  // …et toujours ceux du dépôt PRINCIPAL, même lancé depuis un worktree (qui disparaîtra)
  const commun = path.resolve(RACINE, git('rev-parse --git-common-dir').trim());
  const principal = path.dirname(commun);
  git('config core.hooksPath "' + path.join(principal, '.githooks').split(path.sep).join('/') + '"');
  return git('config --get core.hooksPath').trim();
}

if (require.main === module) {
  const args = process.argv.slice(2), action = args[0] || '--prevoir';
  if (action === '--verifier') {
    const r = verifier();
    if (r.erreurs.length) { console.error(r.erreurs.join('\n')); process.exit(1); }
    console.log('version ' + r.version + ' : conforme');
    process.exit(0);
  }
  if (action === '--installer') { console.log('crochets git : ' + installer()); process.exit(0); }
  const avant = lireVersion(), etiquette = derniereEtiquette(), commits = commitsDepuis(etiquette);
  const impose = (args[1] || '').toLowerCase();
  const cran = /^[xyz]$/.test(impose) ? impose : cranDes(commits, avant);
  if (action === '--prevoir') {
    console.log((etiquette || '(aucune étiquette)') + ' → ' + commits.length + ' commit(s) : ' +
                (cran ? avant + ' → ' + monter(avant, cran) + ' (cran ' + cran + ')' : 'rien à publier'));
    process.exit(0);
  }
  if (action === '--publier') {
    if (!cran) { console.log('Rien à publier : aucun feat, fix, perf ni rupture depuis ' + (etiquette || 'le début')); process.exit(0); }
    const apres = monter(avant, cran);
    /* Publication TRANSACTIONNELLE : la version, le journal et le registre
       compacté entrent dans UN commit ; si le commit ou l'étiquette échoue, tout
       est remis comme avant (version, journal, registre — y compris ses fichiers
       non suivis, qu'aucun git ne rendrait). */
    const registreJs = path.join(__dirname, 'registre.js');
    const sauvegardeRegistre = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-registre-'));
    const avantCore = fs.readFileSync(CORE, 'utf8'), avantJournal = fs.readFileSync(JOURNAL, 'utf8');
    let commite = false;
    const restaurerRegistre = () => {
      if (!fs.existsSync(path.join(sauvegardeRegistre, 'manifeste.json'))) return true;
      try { execFileSync(process.execPath, [registreJs, 'restaurer', sauvegardeRegistre], { cwd: RACINE, encoding: 'utf8' }); return true; }
      catch (e) { console.error('  ⚠ restauration du registre impossible (' + String(e.message).split('\n')[0] + ') : sauvegarde conservée dans ' + sauvegardeRegistre); return false; }
    };
    const annuler = (e) => {
      if (commite) { try { git('reset -q HEAD~1'); } catch (x) { /* rien */ } }
      const ok = restaurerRegistre();
      fs.writeFileSync(CORE, avantCore); fs.writeFileSync(JOURNAL, avantJournal);
      try { git('reset -q -- src/core.js CHANGELOG.md tests/registre'); } catch (x) { /* rien */ }
      if (ok) fs.rmSync(sauvegardeRegistre, { recursive: true, force: true });
      console.error('Publication annulée, tout est remis comme avant : ' + String(e.stderr || e.message).trim().split('\n')[0]);
      process.exit(1);
    };
    try {
      ecrire(avant, apres);
      git('add src/core.js CHANGELOG.md');
      // SPEC-BANC-091 : rétention du registre. AVANT le commit, pour que la
      // compaction entre dans le commit de release (l'étiquette en porte l'état) ;
      // `--version` : l'étiquette n'existe pas encore, les runs validés de ce cycle
      // sont marqués `release: vX.Y.Z`. Jamais bloquant : un registre qui ne se
      // compacte pas ne remet pas en cause la publication.
      try {
        const sortie = execFileSync(process.execPath, [registreJs, 'compacter', '--jusqu-a', 'HEAD', '--version', 'v' + apres, '--sauvegarde', sauvegardeRegistre, '--json'],
          { cwd: RACINE, encoding: 'utf8' }).trim();
        const r = JSON.parse(sortie.split('\n').pop());
        const mo = n => (n / 1024 / 1024).toFixed(1) + ' Mo';
        console.log('  registre : ' + r.entreesCompactees + ' entrée(s) compactée(s), ' + r.entreesRelease + ' run(s) de release marqué(s) ; entrées ' + mo(r.octetsEntreesAvant) + ' → ' + mo(r.octetsEntreesApres) + ' ; ' + r.imagesSupprimees + ' image(s) retirée(s)');
        (r.avertissements || []).forEach(a => console.log('  ⚠ registre : ' + a));
        // SEULS les fichiers que la compaction a touchés (jamais impact.json, notes locales, *.tmp)
        const suivis = new Set(git('ls-files -- tests/registre').split('\n').filter(Boolean));
        const liste = r.fichiersTouches.map(f => 'tests/registre/' + f).filter(f => suivis.has(f) || fs.existsSync(path.join(RACINE, f)));
        if (liste.length) execFileSync('git', ['add', '-A', '--pathspec-from-file=-'], { cwd: RACINE, input: liste.join('\n') + '\n', encoding: 'utf8' });
      } catch (e) {
        restaurerRegistre();
        console.log('  ⚠ registre non compacté : ' + String(e.stdout || e.message).trim().split('\n')[0] + ' — la publication continue ; à rejouer : node tools/registre.js compacter');
      }
      git('commit -q -m "chore(release): v' + apres + '"');
      commite = true;
      git('tag -a v' + apres + ' -m "v' + apres + '"');
    } catch (e) { annuler(e); }
    fs.rmSync(sauvegardeRegistre, { recursive: true, force: true });
    console.log(avant + ' → ' + apres + ' (cran ' + cran + ', ' + commits.length + ' commit(s)) — étiquette v' + apres);
    // SPEC-PACK-004 : un paquet testable/partageable pour CHAQUE publication,
    // sans étape manuelle — jamais commité (dist/, voir .gitignore), jamais
    // bloquant : un échec de paquet ne doit pas remettre en cause la
    // publication déjà commitée et étiquetée.
    try {
      const paquet = require('./paquet.js');
      const r = paquet.construireZipRelease(apres);
      console.log('  paquet : ' + r.chemin + ' (' + r.fichiers + ' fichiers, ' + (r.octets / 1024).toFixed(0) + ' Ko)');
    } catch (e) {
      console.log('  ⚠ paquet non construit : ' + e.message + ' — la publication reste valide, construisez-le à la main : node tools/paquet.js --zip-release ' + apres);
    }
    process.exit(0);
  }
  console.error('action inconnue : ' + action + ' (--prevoir, --publier [x|y|z], --verifier, --installer)');
  process.exit(1);
}

module.exports = { verifier, monter, cranDes, FORMAT };
