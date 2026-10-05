/* integration-banc-historiser.js — `historiser` pour de VRAI (SPEC-BANC-111,
   112, 113, 115) : une vraie campagne du lanceur ACTUEL (tests/run.js) sur le
   code et les tests d'un VRAI vieux commit du dépôt (la release v0.8.0), dans un
   vrai worktree temporaire, inscrite dans un registre jetable.

   La campagne est réduite à deux tests Node rapides (le coût réel d'un commit
   complet est de 5 à 10 minutes) : ce qu'on vérifie ici, c'est la plomberie —
   worktree sur le bon commit, moteur actuel qui lit le jeu et les tests de ce
   commit, entrée de registre complète, worktree supprimé, reprise sans rejouer.
   tests/spec-banc-historiser.js couvre le reste avec de petits dépôts jetables.

   IGNORÉ (code 0) si le dépôt n'a pas l'étiquette v0.8.0 (clone sans étiquettes).

   Usage : node tests/integration-banc-historiser.js */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const A = require('./aide-integration-archi.js');
const RACINE = A.RACINE;
const HIST = require(path.join(RACINE, 'tools', 'historiser.js'));
const REG = require(path.join(RACINE, 'tools', 'registre.js'));
const MT = require(path.join(RACINE, 'tools', 'moteur-test.js'));
const { envGitPour } = require(path.join(RACINE, 'tools', 'git-propre.js'));

const R = A.creerRapport('historiser sur un vrai vieux commit (SPEC-BANC-111, 112, 113, 115)');
function git(args) { return execFileSync('git', args, { cwd: RACINE, encoding: 'utf8', env: envGitPour(RACINE), stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }

(async () => {
  let release = null;
  try { release = git(['rev-parse', 'v0.8.0^{commit}']); } catch (e) { /* pas d'étiquette */ }
  if (!release) {
    R.saut('campagne réelle sur v0.8.0', 'étiquette v0.8.0 absente de ce dépôt');
    process.exit(R.fin());
  }
  const registre = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-hist-reel-'));
  const traces = [];
  try {
    const avant = Date.now();
    const worktreesAvant = git(['worktree', 'list', '--porcelain']).split('\n').filter(l => /^worktree /.test(l)).length;
    let wtVu = null;
    const r = HIST.historiser({
      dossierRepo: RACINE, dossierRegistre: registre, depuis: 'v0.7.0', preset: 'pr',
      argsCampagne: ['--test', 'SPEC-BANC-117,SPEC-BANC-119', '--sans-fonctions'],
      ecrire: (t) => traces.push(t),
      lancerCampagne: (arg) => { wtVu = arg.worktree; R.ok(git(['-C', arg.worktree, 'rev-parse', 'HEAD']) === release, 'SPEC-BANC-112 : le worktree temporaire est sur le commit de la release v0.8.0'); return HIST.campagneReelle(arg); },
    });
    const apres = Date.now();
    R.ok(r.ok && r.faits.length === 1 && r.faits[0] === release, 'SPEC-BANC-111 : la release v0.8.0 est le seul commit de merge, de PR ou de release depuis v0.7.0, et sa campagne est faite', JSON.stringify(r.echecs) + ' ' + traces.join(' | '));
    const entrees = REG.lireEntrees(registre);
    R.eq(entrees.length, 1, 'SPEC-BANC-111 : une entrée de registre');
    const e = entrees[0];
    R.ok(e && e.commit === release && e.origine === 'pre-push' && e.preset && e.tests.length >= 2, 'SPEC-BANC-111 : une vraie entrée, comme celle d\'un push (origine pre-push, tests réels)', JSON.stringify(e && { c: e.commit, o: e.origine, p: e.preset, n: e.tests.length }));
    R.ok(e.tests.every(t => t.etat === 'reussi'), 'SPEC-BANC-112 : les tests de CE commit ont tourné et passent (' + e.tests.map(t => t.etat).join(',') + ')');
    R.ok(e.tests.some(t => /SPEC-BANC-117/.test(t.nom)), 'SPEC-BANC-112 : ce sont les tests définis par le commit rejoué');
    const moteur = MT.moteurTestActuel(RACINE);
    R.ok(e.moteurTest && e.moteurTest.commit === moteur.commit && e.moteurTest.commit !== release, 'SPEC-BANC-112 : le moteur enregistré est celui du dépôt courant, pas celui de v0.8.0', JSON.stringify(e.moteurTest));
    R.eq(e.meta_commit.version_jeu, '0.8.0', 'SPEC-BANC-113 : VERSION_JEU de ce commit');
    R.eq(e.meta_commit.etiquette_release, 'v0.8.0', 'SPEC-BANC-113 : étiquette de release');
    R.ok(/release/.test(e.meta_commit.natures.join()) && e.meta_commit.parents.length >= 1 && e.meta_commit.fichiers_modifies.length > 0 && /v0\.8\.0/.test(e.meta_commit.message), 'SPEC-BANC-113 : message, parents et fichiers modifiés tirés de git');
    R.ok(Date.parse(e.date) >= avant - 1000 && Date.parse(e.date) <= apres, 'SPEC-BANC-113 : debut_run est l\'heure réelle de la campagne (' + e.date + '), pas celle du commit (' + e.meta_commit.date_commit + ')');
    R.ok(wtVu && !fs.existsSync(wtVu), 'SPEC-BANC-112 : le worktree temporaire est supprimé');
    R.eq(git(['worktree', 'list', '--porcelain']).split('\n').filter(l => /^worktree /.test(l)).length, worktreesAvant, 'SPEC-BANC-112 : aucun worktree ne reste dans le dépôt');
    // reprise : le commit est inscrit, la seconde passe ne lance rien
    let lances = 0;
    const r2 = HIST.historiser({ dossierRepo: RACINE, dossierRegistre: registre, depuis: 'v0.7.0', lancerCampagne: () => { lances++; return { ok: false, motif: 'ne devrait pas être appelée' }; } });
    R.ok(lances === 0 && r2.sautes.length === 1 && r2.faits.length === 0, 'SPEC-BANC-115 : relancer ne rejoue pas le commit déjà inscrit');
  } catch (e) {
    R.ok(false, 'historiser sur un vrai commit', e.stack || String(e));
  }
  try { fs.rmSync(registre, { recursive: true, force: true }); } catch (e) { /* verrouillé */ }
  process.exit(R.fin());
})();
