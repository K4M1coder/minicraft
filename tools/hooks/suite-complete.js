/* suite-complete.js — la SUITE COMPLÈTE commune aux crochets qui valident une
   demande de fusion ou un merge (SPEC-BANC-072/073) : pre-push,
   pre-merge-commit, et pre-commit quand il détecte un merge avec conflits
   résolus (MERGE_HEAD, voir estEnMerge). Chaque crochet passe lui-même ses
   préréglages (`--preset pr` en entier, puis `--preset e2e-fumee`), pour que
   son texte dise ce qu'il lance (G13, SPEC-BANC-075).

   Pour chaque étape : lance `node tests/run.js <args> --delai 900` (le filet
   commun, SPEC-BANC-010), inscrit AUTOMATIQUEMENT le cahier produit au
   registre (statut `en_attente` : le commit qui l'intégrera est le suivant,
   voir tools/hooks/pre-commit.js), puis — pour l'étape marquée `carte`, si
   elle a réussi — reconstruit la carte d'impact tests/registre/impact.json
   (SPEC-BANC-067). Une inscription ou une carte qui échoue ne fait JAMAIS
   échouer le crochet : seul l'échec d'un préréglage le fait.

   `o.racine` (tests) : dossier où se trouvent tests/run.js, tests/resultats/
   et tests/registre/ ; `o.dossierRepo` (tests) : dépôt git qui résout le
   commit testé et fournit les sources de la carte (par défaut `o.racine`). */
'use strict';
const { spawnSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DELAI_FILET_S } = require('./delai-filet.js');

const RACINE = path.join(__dirname, '..', '..');

/* Un merge avec conflits résolus se reconnaît à MERGE_HEAD (SPEC-BANC-073). */
function estEnMerge(racine, env) {
  try { execFileSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: racine || RACINE, stdio: 'ignore', env: env || process.env }); return true; }
  catch (e) { return false; }
}

function lancerSuiteComplete(o) {
  const racine = o.racine || RACINE;
  const dossierRepo = o.dossierRepo || racine;
  const dossierResultats = path.join(racine, 'tests', 'resultats');
  const dossierRegistre = path.join(racine, 'tests', 'registre');
  const REG = require('../registre.js');
  const P = require('../perimetre.js');
  const dossiers = () => { try { return new Set(fs.readdirSync(dossierResultats)); } catch (e) { return new Set(); } };
  for (const etape of o.etapes) {
    const avant = dossiers();
    const args = etape.args.concat(['--delai', String(DELAI_FILET_S)]);
    const r = spawnSync(process.execPath, [path.join(racine, 'tests', 'run.js')].concat(args), { stdio: o.silencieux ? 'ignore' : 'inherit', cwd: racine });
    let dossier = null;
    try { const nouveaux = Array.from(dossiers()).filter(d => !avant.has(d)).sort(); dossier = nouveaux[nouveaux.length - 1] || null; } catch (e) { /* rien */ }
    if (dossier) {
      try {
        const ins = REG.inscrire(dossier, { origine: o.origine, statut: 'en_attente', racineResultats: dossierResultats, dossierRegistre, dossierRepo });
        if (!ins.ok) console.error('  (registre : inscription non effectuée — ' + ins.motif + ')');
      } catch (e) { console.error('  (registre : inscription non effectuée — ' + e.message + ')'); }
      if (etape.carte && r.status === 0) {
        try {
          const c = P.reconstruireCarte(dossier, { racine: dossierRepo, racineResultats: dossierResultats, chemin: path.join(dossierRegistre, 'impact.json') });
          console.error(c.ok ? '  carte d\'impact reconstruite : ' + c.fonctions + ' fonctions, ' + c.tests + ' tests (commit ' + String(c.commit).slice(0, 10) + ')'
            : '  (carte d\'impact non reconstruite — ' + c.motif + ')');
        } catch (e) { console.error('  (carte d\'impact non reconstruite — ' + e.message + ')'); }
      }
    }
    if (r.status !== 0) return { ok: false, etape: etape.args.join(' '), code: r.status || 1 };
  }
  return { ok: true };
}

module.exports = { lancerSuiteComplete, estEnMerge };
