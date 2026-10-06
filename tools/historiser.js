/* tools/historiser.js — campagnes sur l'HISTORIQUE des merges, des PR et des
   releases (SPEC-BANC-111 à 116, docs/banc/historique-global.md §3.15) :

    node tools/registre.js historiser [--depuis <ref>] [--preset regression] [--lister] [--max N]

   Pour chaque commit de merge, de PR ou de release de l'historique, du plus
   ancien au plus récent, UNE VRAIE campagne complète sur ce commit — pas un run
   à part, pas de marqueur spécial : l'entrée du registre est celle que ferait
   `pre-push` (même fonction d'inscription, même préréglage), seules s'y ajoutent
   les métadonnées du commit (`meta_commit`).

   Comment un vieux commit est rejoué (SPEC-BANC-112) :
     - un WORKTREE TEMPORAIRE, détaché, sur ce commit : le code du jeu (src/), les
       fichiers de tests, SPECS.md, les scripts d'intégration et le serveur de
       test viennent de ce commit ;
     - le MOTEUR — tests/run.js, le harnais, le catalogue, l'orchestration CDP,
       les diagnostics, l'écriture du cahier et du registre — est celui du dépôt
       COURANT : le lanceur actuel est lancé avec MC_RACINE_JEU=<worktree>. Chaque
       entrée enregistre la version du moteur qui l'a produite (`moteurTest`), qui
       est donc celle du dépôt courant, jamais celle du vieux commit ;
     - un test que ce moteur ne peut pas faire tourner sur ce commit (le commit
       n'a pas encore le module qu'il appelle…) est `ignore` avec une raison
       explicite, jamais réussi (SPEC-BANC-114, `classerIncompatibilite`).

   Reprise (SPEC-BANC-115) : les commits déjà inscrits au registre (entrée non
   interrompue) sont sautés ; un historique se rejoue donc par morceaux, et
   chaque commit coûte de l'ordre de 5 à 10 minutes (la suite complète, e2e
   compris). Rétention (SPEC-BANC-116) : ces entrées sont des entrées comme les
   autres — la compaction à la publication (tools/registre.js compacter) garde le
   détail de la release et résume le reste.

   Aucune dépendance npm. L'exécution de la campagne est injectable
   (`opts.lancerCampagne`) : les tests de ce module la remplacent par une
   campagne simulée ; par défaut, c'est le vrai lanceur. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { envGitPour } = require('./git-propre.js');
const REG = require('./registre.js');
const MT = require('./moteur-test.js');

const RACINE = path.join(__dirname, '..');
const PRESET_DEFAUT = 'regression';
const RE_RELEASE = /^chore\(release\)\s*(?:!)?:\s*v\d/;
const RE_PR = /(?:\(#\d+\)\s*$|^Merge pull request #\d+)/;
const RE_TAG_VERSION = /^v\d+\.\d+\.\d+$/;

function git(rd, args) {
  try { return execFileSync('git', args, { cwd: rd, encoding: 'utf8', env: envGitPour(rd), stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim(); }
  catch (e) { return null; }
}

// ══════════════════════════════════════════════════════════════════════════
// 1. Quels commits (SPEC-BANC-111)
// ══════════════════════════════════════════════════════════════════════════
/* Un commit « historique » : un merge (deux parents ou plus), un commit de PR
   (squash : « titre (#N) », ou « Merge pull request #N »), ou un commit de
   release (« chore(release): vX.Y.Z », ou porteur d'une étiquette de version).
   Pure : décide d'après les données d'un commit. */
function natureDuCommit(c) {
  const naturess = [];
  if ((c.parents || []).length > 1) naturess.push('merge');
  if (RE_PR.test(c.sujet || '')) naturess.push('pr');
  if (RE_RELEASE.test(c.sujet || '') || (c.etiquettes || []).some(t => RE_TAG_VERSION.test(t))) naturess.push('release');
  return naturess;
}
/* Les commits à historiser depuis `depuis` (exclu ; tout l'historique sans),
   jusqu'à HEAD, sur la ligne principale (--first-parent : un merge compte pour
   LE merge, pas pour les commits de la branche qu'il ramène), du plus ancien au
   plus récent. Rend [{ sha, court, sujet, parents, natures, etiquettes }]. */
function listerCommits(dossierRepo, depuis) {
  const rd = dossierRepo || RACINE;
  const plage = depuis ? depuis + '..HEAD' : 'HEAD';
  const sortie = git(rd, ['log', '--first-parent', '--reverse', '--format=%H%x1f%P%x1f%s%x1e', plage]);
  if (sortie === null) return null;
  const etiquettesParCommit = new Map();
  (git(rd, ['tag', '--list', 'v[0-9]*', '--format=%(refname:short) %(objectname) %(*objectname)']) || '').split('\n').filter(Boolean).forEach((l) => {
    const [nom, o1, o2] = l.split(' ');
    [o1, o2].filter(Boolean).forEach((sha) => { (etiquettesParCommit.get(sha) || etiquettesParCommit.set(sha, []).get(sha)).push(nom); });
  });
  const out = [];
  sortie.split('\x1e').map(s => s.replace(/^\n/, '')).filter(Boolean).forEach((bloc) => {
    const [sha, parents, sujet] = bloc.split('\x1f');
    if (!sha) return;
    const c = { sha: sha.trim(), court: sha.trim().slice(0, 10), sujet: sujet || '', parents: (parents || '').split(' ').filter(Boolean), etiquettes: etiquettesParCommit.get(sha.trim()) || [] };
    c.natures = natureDuCommit(c);
    if (c.natures.length) out.push(c);
  });
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// 2. Métadonnées tirées de git (SPEC-BANC-113)
// ══════════════════════════════════════════════════════════════════════════
/* La branche qu'un merge a ramenée : son message quand il la nomme (« Merge
   branch 'x' », « Merge pull request #N from a/x »), sinon la branche locale
   dont le sommet est (ou descend de) son second parent. */
function brancheFusionnee(dossierRepo, c) {
  const m = /Merge (?:remote-tracking )?branch '([^']+)'/.exec(c.sujet || '') || /Merge pull request #\d+ from \S*?\/(\S+)/.exec(c.sujet || '');
  if (m) return m[1];
  if ((c.parents || []).length < 2) return null;
  const nom = git(dossierRepo, ['name-rev', '--name-only', '--no-undefined', '--refs=refs/heads/*', c.parents[1]]);
  return nom ? nom.replace(/[~^]\d*$/, '').replace(/^heads\//, '') : null;
}
function versionJeuDe(dossierRepo, sha) {
  const src = git(dossierRepo, ['show', sha + ':src/core.js']);
  const m = src && /VERSION_JEU\s*=\s*'([^']+)'/.exec(src);
  return m ? m[1] : null;
}
/* message, parents, branche fusionnée, auteur, date du commit, fichiers modifiés
   (par rapport au premier parent), VERSION_JEU de ce commit, étiquette de release. */
function metadonneesCommit(dossierRepo, c) {
  const rd = dossierRepo || RACINE;
  const info = git(rd, ['show', '-s', '--format=%an%x1f%ae%x1f%cI%x1f%B', c.sha]);
  const [auteur, email, dateCommit, message] = (info || '').split('\x1f');
  const base = (c.parents && c.parents[0]) || null;
  const fichiers = base
    ? git(rd, ['diff', '--name-only', '--no-renames', base, c.sha])
    : git(rd, ['show', '--name-only', '--format=', c.sha]);
  const tags = (git(rd, ['tag', '--points-at', c.sha, '--list', 'v[0-9]*']) || '').split('\n').filter(Boolean);
  return {
    message: (message || c.sujet || '').trim(),
    parents: c.parents || [],
    branche_fusionnee: brancheFusionnee(rd, c),
    auteur: auteur ? (auteur + (email ? ' <' + email + '>' : '')) : null,
    date_commit: dateCommit || null,
    fichiers_modifies: (fichiers || '').split('\n').filter(Boolean),
    version_jeu: versionJeuDe(rd, c.sha),
    etiquette_release: tags.find(t => RE_TAG_VERSION.test(t)) || null,
    natures: c.natures || [],
  };
}

// ══════════════════════════════════════════════════════════════════════════
// 3. Reprise : quels commits sont déjà inscrits (SPEC-BANC-115)
// ══════════════════════════════════════════════════════════════════════════
/* Les commits (SHA pleins) qui ont déjà une entrée au registre menée à son
   terme : une entrée interrompue ne compte pas, elle sera refaite. */
function commitsDejaInscrits(dossierRegistre, preset) {
  const s = new Set();
  REG.lireEntrees(dossierRegistre).forEach((e) => {
    const couvre = !preset || ((e.preset === preset || (preset === 'pr' && e.preset === 'regression')) && e.perimetre !== 'manuel');
    if (e.commit && !e.interrompu && couvre) s.add(e.commit);
  });
  return s;
}

// ══════════════════════════════════════════════════════════════════════════
// 4. Incompatibilité d'un test avec le commit rejoué (SPEC-BANC-114)
// ══════════════════════════════════════════════════════════════════════════
/* Un test qui ÉCHOUE parce que ce commit n'a pas ce que le moteur (ou le test)
   attend n'est ni réussi ni en échec : il est ignoré, avec la raison. Deux cas,
   volontairement étroits :
  1. un module src/ attendu manque ET l'appel identifié dans la pile lit
    précisément la propriété absente nommée par le message ;
   2. l'API appelée a disparu d'un module PRÉSENT : le message nomme une API du jeu
      (`MC.X.f is not a function`, `MC.X.C is not a constructor`, `MC is not defined`).
   Toute autre panne est un vrai résultat pour ce commit : rendue `null`, le test
   reste en échec. */
const RE_API_DISPARUE = /\bMC(?:\.\w+)+ is not a (?:function|constructor)\b|^MC is not defined\b/;
const RE_ABSENCE = /\bis not defined\b|\bis not a function\b|\bis not a constructor\b|Cannot read propert(?:y|ies) of (?:undefined|null)|\(reading '[^']*'\)|Cannot destructure|undefined is not/;
function classerIncompatibilite(message, modulesAbsents, appel) {
  const absents = (modulesAbsents || []).filter(Boolean);
  if (!message) return null;
  const texte = String(message);
  if (RE_API_DISPARUE.test(texte)) {
    return 'incompatible avec ce commit : API absente de ce commit — le moteur ne peut pas exécuter ce test sur ce commit (' + texte.split('\n')[0].slice(0, 120) + ')';
  }
  if (!RE_ABSENCE.test(texte)) return null;
  const reference = /^MC\.([\w$]+)\.([\w$]+)$/.exec(appel || '');
  const propriete = /\(reading '([^']+)'\)/.exec(texte);
  if (!reference || !propriete || reference[2] !== propriete[1]) return null;
  const concernes = absents.filter(m => m.replace(/[-_]/g, '').toLowerCase() === reference[1].toLowerCase());
  if (!concernes.length) return null;
  return 'incompatible avec ce commit : module(s) ' + concernes.map(m => 'src/' + m + '.js').join(', ') + ' absent(s) — le moteur ne peut pas exécuter ce test sur ce commit (' + texte.split('\n')[0].slice(0, 120) + ')';
}

// ══════════════════════════════════════════════════════════════════════════
// 5. Le worktree temporaire (SPEC-BANC-112)
// ══════════════════════════════════════════════════════════════════════════
const worktreesOuverts = new Set();
function ouvrirWorktree(dossierRepo, sha, dossierBase) {
  const base = dossierBase || fs.mkdtempSync(path.join(os.tmpdir(), 'mc-historiser-'));
  const chemin = path.join(base, 'wt-' + sha.slice(0, 10));
  const r = git(dossierRepo, ['worktree', 'add', '--detach', '--force', chemin, sha]);
  if (r === null || !fs.existsSync(chemin)) throw new Error('worktree impossible sur ' + sha.slice(0, 10));
  worktreesOuverts.add(JSON.stringify([dossierRepo, chemin, base]));
  return { chemin, base };
}
function fermerWorktree(dossierRepo, w) {
  if (!w) return;
  git(dossierRepo, ['worktree', 'remove', '--force', w.chemin]);
  try { fs.rmSync(w.chemin, { recursive: true, force: true }); } catch (e) { /* verrouillé un instant */ }
  git(dossierRepo, ['worktree', 'prune']);
  worktreesOuverts.delete(JSON.stringify([dossierRepo, w.chemin, w.base]));
  try { fs.rmSync(w.base, { recursive: true, force: true }); } catch (e) { /* dossier de base déjà parti */ }
}
function fermerTousLesWorktrees() {
  Array.from(worktreesOuverts).forEach((cle) => {
    const [rd, chemin, base] = JSON.parse(cle);
    fermerWorktree(rd, { chemin, base });
  });
}
let nettoyageInstalle = false;
function installerNettoyage() {
  if (nettoyageInstalle) return;
  nettoyageInstalle = true;
  process.on('exit', fermerTousLesWorktrees);
  process.on('SIGINT', () => { fermerTousLesWorktrees(); process.exit(130); });
  process.on('SIGTERM', () => { fermerTousLesWorktrees(); process.exit(143); });
}

// ══════════════════════════════════════════════════════════════════════════
// 6. La vraie campagne : le lanceur ACTUEL sur le code et les tests du commit
// ══════════════════════════════════════════════════════════════════════════
/* Rend { ok, racineResultats, dossierCahier, motif? } : le cahier local produit
   par tests/run.js (le MOTEUR actuel), qui lit le jeu et les tests dans
   `worktree`. Le lanceur sort en code 1 quand des tests échouent : ce n'est pas
   une panne de la campagne — seul l'absence de cahier en est une. */
function campagneReelle(o) {
  const racineResultats = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-historiser-res-'));
  // `o.argsCampagne` (tests, usage ciblé) remplace le préréglage : une campagne réduite à quelques tests
  const selection = o.argsCampagne && o.argsCampagne.length ? o.argsCampagne : ['--preset', o.preset];
  const args = [path.join(RACINE, 'tests', 'run.js')].concat(selection, ['--silencieux']);
  const r = spawnSync(process.execPath, args, {
    cwd: RACINE, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true,
    env: Object.assign({}, process.env, { MC_RACINE_JEU: o.worktree, MC_TEST_RESULTATS_DIR: racineResultats }),
  });
  const dossiers = fs.existsSync(racineResultats) ? fs.readdirSync(racineResultats, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort() : [];
  if (!dossiers.length) {
    return { ok: false, racineResultats, motif: 'aucun cahier produit (code ' + r.status + ') : ' + String((r.stderr || r.stdout || '')).split('\n').slice(-6).join(' | ').slice(0, 400) };
  }
  const dossierCahier = dossiers[dossiers.length - 1];
  try {
    const cahier = JSON.parse(fs.readFileSync(path.join(racineResultats, dossierCahier, 'resultats.json'), 'utf8'));
    const panne = (cahier.tests || []).find(t => t.infrastructure);
    if (panne) return { ok: false, racineResultats, dossierCahier, motif: panne.message || 'infrastructure de test indisponible' };
  } catch (e) {
    return { ok: false, racineResultats, dossierCahier, motif: 'cahier illisible : ' + e.message };
  }
  return { ok: true, racineResultats, dossierCahier, code: r.status };
}

// ══════════════════════════════════════════════════════════════════════════
// 7. historiser()
// ══════════════════════════════════════════════════════════════════════════
/* opts : { depuis, preset, dossierRepo, dossierRegistre, lancerCampagne(o),
   ecrire(texte), max, aBlanc, horloge }. Rend { ok, commits, faits, sautes,
   echecs, entrees }. `lancerCampagne({ worktree, sha, court, preset, commit,
   meta })` rend { ok, racineResultats, dossierCahier } ; par défaut la vraie. */
function historiser(opts) {
  const o = opts || {};
  const rd = o.dossierRepo || RACINE;
  const dossierRegistre = o.dossierRegistre || REG.DOSSIER_REGISTRE;
  const preset = o.preset || PRESET_DEFAUT;
  const ecrire = o.ecrire || (() => {});
  const lancer = o.lancerCampagne || campagneReelle;
  const horloge = o.horloge || (() => new Date().toISOString());
  const lancement = horloge();

  const commits = listerCommits(rd, o.depuis);
  if (commits === null) return { ok: false, motif: 'historique git illisible' + (o.depuis ? ' (référence « ' + o.depuis + ' » introuvable ?)' : '') };
  const deja = commitsDejaInscrits(dossierRegistre, o.argsCampagne ? null : preset);
  const resultat = { ok: true, lancement, commits: commits.map(c => c.sha), faits: [], sautes: [], echecs: [], entrees: [] };
  const aFaire = commits.filter((c) => { if (deja.has(c.sha)) { resultat.sautes.push(c.sha); return false; } return true; });
  const limite = o.max > 0 ? aFaire.slice(0, o.max) : aFaire;
  ecrire('historiser : ' + commits.length + ' commit(s) de merge, de PR ou de release, ' + resultat.sautes.length + ' déjà inscrit(s) (sauté(s)), ' + limite.length + ' à faire' + (o.max > 0 && aFaire.length > limite.length ? ' (limité à ' + o.max + ')' : ''));
  if (o.aBlanc) { resultat.aFaire = limite.map(c => c.sha); return resultat; }
  installerNettoyage();

  for (const c of limite) {
    ecrire('▶ ' + c.court + ' [' + c.natures.join('+') + '] ' + c.sujet);
    let w = null;
    try {
      w = ouvrirWorktree(rd, c.sha);
      const meta = metadonneesCommit(rd, c);
      const debutRun = lancement;          // l'heure RÉELLE du lancement de historiser (SPEC-BANC-113), jamais la date du commit
      const camp = lancer({ worktree: w.chemin, sha: c.sha, court: c.court, preset: preset, commit: c, meta: meta, argsCampagne: o.argsCampagne });
      if (!camp || !camp.ok) { resultat.echecs.push({ sha: c.sha, motif: (camp && camp.motif) || 'campagne sans résultat' }); ecrire('  ✗ ' + ((camp && camp.motif) || 'campagne sans résultat')); continue; }
      const ins = REG.inscrire(camp.dossierCahier, {
        racineResultats: camp.racineResultats, dossierRepo: rd, dossierRegistre: dossierRegistre,
        origine: 'pre-push', statut: 'ok', date: debutRun, branche: meta.branche_fusionnee || brancheDe(rd, c), metaCommit: meta, commitTeste: c.sha,
        moteurTest: MT.moteurTestActuel(RACINE),
      });
      if (!ins.ok) { resultat.echecs.push({ sha: c.sha, motif: ins.motif }); ecrire('  ✗ inscription refusée : ' + ins.motif); continue; }
      resultat.faits.push(c.sha); resultat.entrees.push(ins.fichier);
      ecrire('  ✓ inscrit : ' + path.basename(ins.fichier));
    } catch (e) {
      resultat.echecs.push({ sha: c.sha, motif: (e && e.message) || String(e) });
      ecrire('  ✗ ' + ((e && e.message) || e));
    } finally {
      fermerWorktree(rd, w);
    }
  }
  resultat.ok = resultat.echecs.length === 0;
  return resultat;
}
/* La branche à laquelle ce commit appartenait (pour un commit de la ligne principale : la branche courante). */
function brancheDe(rd, c) {
  const nom = git(rd, ['name-rev', '--name-only', '--no-undefined', '--refs=refs/heads/*', c.sha]);
  return nom ? nom.replace(/[~^]\d*$/, '') : (REG.brancheCourante(rd) || null);
}

// ══════════════════════════════════════════════════════════════════════════
// CLI : appelé par `node tools/registre.js historiser …`
// ══════════════════════════════════════════════════════════════════════════
function cli(args) {
  const option = (nom) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : null; };
  const r = historiser({
    depuis: option('--depuis') || undefined, preset: option('--preset') || undefined,
    max: option('--max') ? parseInt(option('--max'), 10) : 0, aBlanc: args.includes('--lister'),
    ecrire: (t) => process.stdout.write(t + '\n'),
  });
  if (!r.ok && r.motif) { process.stdout.write('historiser refusé : ' + r.motif + '\n'); return 1; }
  if (r.aFaire) r.aFaire.forEach(s => process.stdout.write('  à faire : ' + s.slice(0, 10) + '\n'));
  process.stdout.write('historiser : ' + r.faits.length + ' fait(s), ' + r.sautes.length + ' sauté(s), ' + r.echecs.length + ' en échec.' +
    (r.faits.length ? ' Les entrées sont dans tests/registre/entrees/ : `node tools/registre.js commit` les commite.' : '') + '\n');
  return r.echecs.length ? 1 : 0;
}

module.exports = {
  PRESET_DEFAUT, natureDuCommit, listerCommits, metadonneesCommit, brancheFusionnee, commitsDejaInscrits,
  classerIncompatibilite, ouvrirWorktree, fermerWorktree, campagneReelle, historiser, cli,
};
