/* gates.js — portes de qualité. Toute porte rouge bloque le commit.
   Usage : node tests/gates.js [--quiet]

   L'intérêt d'automatiser ces portes plutôt que de s'en remettre à la
   discipline : une spec oubliée, un identifiant fantôme ou une référence au
   DOM glissée dans la logique pure ne se voient pas à la relecture, mais
   font basculer une porte au rouge immédiatement. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const quiet = process.argv.includes('--quiet');

/* `node tests/run.js` écrit sa progression (dont « cahier de test : … »)
   sur STDERR (voir `ecrire()` dans ce fichier), jamais sur stdout —
   `execFileSync` ne rend que stdout ; les portes qui doivent relire cette
   ligne (G14) utilisent donc ce petit relais, stdout+stderr combinés, avec
   un délai BORNÉ (5 min : cette vérification lance une vraie campagne Node
   complète) pour ne jamais accrocher `node tests/gates.js` indéfiniment. */
function execFileSyncCombine(args, opts) {
  const o = Object.assign({ encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 128 * 1024 * 1024 }, opts || {});
  const r = spawnSync(process.execPath, args, o);
  if (r.error) return { out: '', error: r.error.message };
  if (r.signal) return { out: (r.stdout || '') + (r.stderr || ''), error: 'signal ' + r.signal + ' (délai dépassé ?)' };
  return { out: (r.stdout || '') + (r.stderr || ''), error: null, status: r.status };
}

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

/* Modules de logique pure : ils doivent tourner sous Node, donc ne jamais
   toucher au navigateur. C'est la porte qui protège toute la stratégie de test. */
const PURS = ['core', 'formes', 'noise', 'biomes', 'densite', 'zones', 'volcanisme', 'souterrain', 'recifs', 'caravanes', 'donjons', 'habitats', 'routes', 'histoire', 'recits', 'carte', 'eau', 'feu', 'meteo', 'lointain', 'world', 'circuits', 'lumiere', 'ombres', 'succes', 'mesher', 'physics', 'file-chunks', 'taches-chunks', 'faune', 'factions', 'inventory', 'conteneurs', 'vehicules', 'metiers', 'economie',
              'entities', 'player', 'synchro', 'daycycle', 'save', 'saves', 'modes',
              'chat', 'commandes', 'options', 'apparence', 'split', 'hud', 'gamepad', 'contrats-vague2', 'net-protocol', 'parametres', 'admin', 'politique', 'guildes', 'pvp-enjeux', 'livre', 'livres', 'ambiance'];
const NAVIGATEUR = ['audio', 'atlas', 'render', 'ui', 'input', 'game', 'net', 'workers', 'worker-monde', 'worker-maillage'];

function lire(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }
function existe(p) { return fs.existsSync(path.join(root, p)); }

const resultats = [];
function porte(id, titre, fn) {
  let ok = false, detail = '';
  try {
    const r = fn();
    ok = r === true || (r && r.ok);
    detail = (r && r.detail) || '';
  } catch (e) {
    ok = false;
    detail = e.message;
  }
  resultats.push({ id, titre, ok, detail });
  return ok;
}

// ── collecte des identifiants de spec ───────────────────────────────────────
const RE_SPEC = /\bSPEC-[A-Z]+-\d{3}\b/g;

const planifiees = new Set();
const doublons = new Set();

function specsDeclarees() {
  if (!existe('SPECS.md')) return new Set();
  const txt = lire('SPECS.md');
  const set = new Set();
  planifiees.clear();
  doublons.clear();
  const vues = new Set();
  // une spec est DÉCLARÉE quand son identifiant ouvre une ligne de tableau
  txt.split('\n').forEach(l => {
    const m = l.match(/^\s*\|\s*(SPEC-[A-Z]+-\d{3})\s*\|/);
    if (!m) return;
    // un identifiant déclaré deux fois rend ambiguë toute citation dans un test
    if (vues.has(m[1])) doublons.add(m[1]);
    vues.add(m[1]);
    /* ⏳ = spec écrite mais pas encore implémentée : G1 ne l'exige pas encore.
       C'est ce qui permet de spécifier tout le périmètre d'avance sans bloquer
       chaque commit intermédiaire, tout en gardant la porte utile. Une spec
       passe à ✅ dans le commit qui l'implémente. */
    if (l.indexOf('⏳') >= 0) { planifiees.add(m[1]); return; }
    set.add(m[1]);
  });
  return set;
}

function fichiersTests() {
  return fs.readdirSync(path.join(root, 'tests'))
    .filter(f => /\.js$/.test(f) && !['run.js', 'gates.js', 'harness.js'].includes(f))
    .map(f => 'tests/' + f);
}

function specsCitees() {
  const map = new Map();          // id -> [fichiers]
  fichiersTests().forEach(f => {
    const txt = lire(f);
    (txt.match(RE_SPEC) || []).forEach(id => {
      if (!map.has(id)) map.set(id, new Set());
      map.get(id).add(f);
    });
  });
  return map;
}

// ── G1 : toute spec est couverte ────────────────────────────────────────────
porte('G1', 'Toute spec déclarée est citée par au moins un test', () => {
  const dec = specsDeclarees();
  if (!dec.size) return { ok: false, detail: 'SPECS.md absent ou sans spec déclarée' };
  const cit = specsCitees();
  const orphelines = [...dec].filter(id => !cit.has(id));
  return orphelines.length
    ? { ok: false, detail: `${orphelines.length} spec(s) sans test : ${orphelines.slice(0, 8).join(', ')}${orphelines.length > 8 ? '…' : ''}` }
    : { ok: true, detail: `${dec.size} specs couvertes, ${planifiees.size} planifiées` };
});

// ── G2 : pas d'identifiant fantôme ──────────────────────────────────────────
porte('G2', 'Tout identifiant cité par un test existe dans SPECS.md', () => {
  const dec = specsDeclarees();   // remplit aussi `planifiees`
  const cit = specsCitees();
  // un identifiant planifie (⏳) n'est pas un fantôme : il est declare, pas encore exige
  const fantomes = [...cit.keys()].filter(id => !dec.has(id) && !planifiees.has(id));
  if (doublons.size) return { ok: false, detail: `identifiants déclarés deux fois : ${[...doublons].slice(0, 8).join(', ')}` };
  return fantomes.length
    ? { ok: false, detail: `identifiants inconnus : ${fantomes.slice(0, 8).join(', ')}` }
    : { ok: true, detail: `${cit.size} identifiants valides` };
});

// ── G3 : tests Node ─────────────────────────────────────────────────────────
porte('G3', '100 % des tests Node passent', () => {
  try {
    const out = execFileSync(process.execPath, [path.join(root, 'tests', 'run.js')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const m = out.match(/(\d+)\/(\d+) tests passent/);
    return { ok: true, detail: m ? `${m[1]}/${m[2]}` : 'tests verts' };
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '');
    const m = out.match(/(\d+) échec/);
    return { ok: false, detail: m ? `${m[1]} échec(s)` : 'exécution en erreur' };
  }
});

// ── G4 : syntaxe ────────────────────────────────────────────────────────────
porte('G4', 'Tous les fichiers de src/ sont syntaxiquement valides', () => {
  const fichiers = fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js'));
  const casses = [];
  fichiers.forEach(f => {
    try { new vm.Script(lire('src/' + f), { filename: f }); }
    catch (e) { casses.push(`${f} (${e.message})`); }
  });
  // le serveur compte aussi
  if (existe('server.js')) {
    try { new vm.Script(lire('server.js'), { filename: 'server.js' }); }
    catch (e) { casses.push('server.js (' + e.message + ')'); }
  }
  return casses.length
    ? { ok: false, detail: casses.join(' · ') }
    : { ok: true, detail: `${fichiers.length} fichiers` };
});

// ── G5 : pureté des modules de logique ──────────────────────────────────────
porte('G5', 'Aucun module pur ne référence THREE, document ou window', () => {
  const interdits = [/\bTHREE\b/, /\bdocument\b/, /\bwindow\b/, /\blocalStorage\b/,
                     /\bnavigator\b/, /\brequestAnimationFrame\b/];
  const fautes = [];
  /* On retire d'abord les commentaires de bloc sur l'ENSEMBLE du texte — les
     traiter ligne par ligne rate les blocs multi-lignes, et les en-têtes de
     fichier mentionnent légitimement THREE. On remplace par des sauts de ligne
     pour que la numérotation reste juste. */
  function sansCommentaires(txt) {
    return txt
      .replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' '))
      .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  }
  PURS.forEach(m => {
    if (!existe('src/' + m + '.js')) return;
    const lignes = sansCommentaires(lire('src/' + m + '.js')).split('\n');
    lignes.forEach((code, i) => {
      interdits.forEach(re => {
        if (re.test(code)) fautes.push(`${m}.js:${i + 1} → ${re.source}`);
      });
    });
  });
  return fautes.length
    ? { ok: false, detail: fautes.slice(0, 6).join(' · ') }
    : { ok: true, detail: `${PURS.filter(m => existe('src/' + m + '.js')).length} modules purs vérifiés` };
});

// ── G6 : surface publique testée ────────────────────────────────────────────
porte('G6', 'Toute fonction exportée d\'un module pur est citée par un test', () => {
  const corpusTests = fichiersTests().map(lire).join('\n');
  const manquantes = [];
  PURS.forEach(m => {
    if (!existe('src/' + m + '.js')) return;
    const txt = lire('src/' + m + '.js');
    // on repère les blocs d'export : MC.Xxx = { a: a, b: b, ... }
    const re = /MC\.(\w+)\s*=\s*\{([\s\S]*?)\n\s*\};/g;
    let mm;
    while ((mm = re.exec(txt))) {
      const corps = mm[2];
      const cles = corps.match(/(\w+)\s*:/g) || [];
      cles.map(k => k.replace(/\s*:$/, '')).forEach(nom => {
        if (nom.length < 4) return;                       // ids courts trop ambigus
        if (/^[A-Z_]+$/.test(nom)) return;                // constantes : couvertes indirectement
        if (!corpusTests.includes(nom)) manquantes.push(`${m}.${nom}`);
      });
    }
    // fonctions exportées directement : MC.maFonction = maFonction;
    const re2 = /MC\.(\w{4,})\s*=\s*\w+;/g;
    while ((mm = re2.exec(txt))) {
      if (!corpusTests.includes(mm[1])) manquantes.push(`${m}.${mm[1]}`);
    }
  });
  return manquantes.length
    ? { ok: false, detail: `${manquantes.length} non testée(s) : ${manquantes.slice(0, 6).join(', ')}` }
    : { ok: true, detail: 'surface publique couverte' };
});

// ── G10 : version et journal des modifications ──────────────────────────────
porte('G10', 'La version suit le versionnage sémantique et le journal la publie', () => {
  const r = require('../tools/version.js').verifier();
  return r.erreurs.length ? { ok: false, detail: r.erreurs.join(' ; ') } : { ok: true, detail: 'version ' + r.version + ' (CHANGELOG.md)' };
});

// ── G11 : commits encadrés ─────────────────────────────────────────────────
porte('G11', 'Les crochets git encadrent commits et versions', () => {
  const { execSync } = require('child_process');
  let chemin = '';
  try { chemin = execSync('git config --get core.hooksPath', { encoding: 'utf8' }).trim(); } catch (e) { /* absent */ }
  /* Chemins acceptés : relatif (.githooks) DEPUIS le dépôt courant, ou absolu
     vers le .githooks du dépôt PRINCIPAL — c'est ce que pose
     tools/version.js --installer, y compris depuis un worktree (les agents,
     dans leur worktree, partagent les crochets du dépôt principal ; le
     worktree lui-même disparaît, ses propres .githooks ne sont pas la
     référence). `git rev-parse --git-common-dir` donne ce dépôt principal
     depuis N'IMPORTE QUEL worktree, exactement comme le fait l'installeur. */
  let principal = root;
  try { principal = path.dirname(path.resolve(root, execSync('git rev-parse --git-common-dir', { cwd: root, encoding: 'utf8' }).trim())); } catch (e) { /* hors dépôt git */ }
  const acceptes = [path.resolve(root, '.githooks'), path.resolve(principal, '.githooks')];
  if (chemin !== '.githooks' && !acceptes.includes(path.resolve(root, chemin))) {
    return { ok: false, detail: 'crochets non branchés (' + (chemin || 'aucun') + ') : node tools/version.js --installer' };
  }
  const dossierCrochets = path.resolve(principal, '.githooks');
  const manquants = ['commit-msg', 'pre-commit'].filter(h => !fs.existsSync(path.join(dossierCrochets, h)));
  if (manquants.length) return { ok: false, detail: 'crochets absents : ' + manquants.join(', ') };
  // la règle du cran, sur des cas connus
  const V = require('../tools/version.js');
  const cas = [[['feat: a', 'fix: b'], '0.3.4', 'y'], [['fix(x): a'], '1.2.3', 'z'], [['feat!: a'], '1.2.3', 'x'],
               [['feat!: a'], '0.2.3', 'y'], [['docs: a', 'chore: b'], '1.0.0', null]];
  const faux = cas.filter(c => V.cranDes(c[0].map(t => ({ titre: t, corps: '' })), c[1]) !== c[2]);
  return faux.length ? { ok: false, detail: 'règle du cran fausse pour ' + JSON.stringify(faux[0]) } : { ok: true, detail: 'commit-msg et pre-commit actifs, règle du cran vérifiée' };
});

// ── G12 : budget de performance de la génération et du maillage ─────────────
porte('G12', 'La génération et le maillage restent sous le budget de tests/budget-perf.json', () => {
  const bancs = ['bench-generation.js', 'bench-maillage.js'];
  const details = [];
  for (const banc of bancs) {
    try {
      const out = execFileSync(process.execPath, [path.join(root, 'tests', banc)],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      const m = out.match(/moyenne = ([\d.]+) ms.*p95\s*= ([\d.]+) ms/s);
      details.push(`${banc} : ${m ? `moyenne ${m[1]} ms, p95 ${m[2]} ms` : 'budget respecté'}`);
    } catch (e) {
      const out = (e.stdout || '') + (e.stderr || '');
      return { ok: false, detail: `${banc} — ` + (out.split('\n').filter(l => l.includes('✗')).join(' ; ') || 'en échec') };
    }
  }
  return { ok: true, detail: details.join(' ; ') };
});

// ── G13 : crochets ↔ préréglages (SPEC-BANC-006) ────────────────────────────
/* Numérotée G13 (et non G12, pris entre-temps par un autre lot pour son
   propre budget de performance) : chaque crochet cite un préréglage du
   catalogue de tests (tests/presets.js), et ce préréglage sélectionne au
   moins un test — un préréglage renommé ou vidé ferait un crochet muet sans
   que rien ne le signale. */
porte('G13', 'Les crochets citent un préréglage existant et non vide (SPEC-BANC-006)', () => {
  const CROCHETS = { 'pre-commit': 'commit', 'pre-push': 'pr' };
  const manquants = [];
  Object.keys(CROCHETS).forEach((h) => {
    const p = path.join(root, 'tools', 'hooks', h + '.js');
    if (!existe('tools/hooks/' + h + '.js')) { manquants.push(h + '.js absent'); return; }
    const txt = lire('tools/hooks/' + h + '.js');
    if (!new RegExp('--preset\\s+' + CROCHETS[h] + '\\b').test(txt)) manquants.push(h + '.js ne cite pas --preset ' + CROCHETS[h]);
  });
  if (manquants.length) return { ok: false, detail: manquants.join(' · ') };
  const vides = [];
  Object.keys(CROCHETS).forEach((h) => {
    const nom = CROCHETS[h];
    try {
      const out = execFileSync(process.execPath, [path.join(root, 'tests', 'run.js'), '--preset', nom, '--lister'], { encoding: 'utf8' });
      const m = /(\d+) test\(s\) sélectionné/.exec(out);
      if (!m || Number(m[1]) === 0) vides.push('préréglage ' + nom + ' vide');
    } catch (e) { vides.push('préréglage ' + nom + ' introuvable ou --lister en erreur : ' + e.message); }
  });
  return vides.length ? { ok: false, detail: vides.join(' · ') } : { ok: true, detail: 'pre-commit→commit, pre-push→pr, tous deux non vides' };
});

// ── G14 : fiches à 100 % (SPEC-BANC-002) ────────────────────────────────────
/* Numérotée G14 (G13 était prise entre-temps, voir G13 ci-dessus). Portée :
   tout le catalogue, y compris les tests end-to-end (tests/e2e.js) — chacun
   porte désormais sa fiche en 2e argument de e2e(nom, fiche, fn), lue en
   texte par tests/run.js (e2eListeDepuisTexte / ficheLitteraleA), sans
   jamais évaluer e2e.js sous Node. */
/* SPEC-BANC-066 (extension de G14) : en plus de la fiche, 100 % des tests
   ont au moins un domaine OU une fonction (déclarée ou observée) — voir la
   fiche : « échoue si un test n'a NI domaine NI fonction ». `--lister` (ci-
   dessous, sans exécution) ne voit que le DÉCLARÉ ; les fonctions OBSERVÉES
   (SPEC-BANC-062) n'existent qu'à l'exécution — pour les tests Node
   (unitaire/fonctionnel/spec, seuls types que tests/run.js peut observer :
   e2e/integration/charge tournent en processus séparés, jamais enveloppés),
   on relance donc une VRAIE campagne (rapide : ~1 minute) et on relit son
   cahier avant de conclure qu'un test n'a rien. */
function testsSansDomaineNiFonctionDeclaree(outListe) {
  const lignes = outListe.split('\n');
  const sansFiche = [];
  const suspects = [];
  let typeCourant = null, nomCourant = null;
  lignes.forEach((l, i) => {
    const mt = /^\[(\w+)\]/.exec(l);
    if (mt) { typeCourant = mt[1]; nomCourant = l.trim(); }
    if (l.trim() === '(aucune fiche)' && typeCourant) sansFiche.push((lignes[i - 1] || '').trim());
    const md = /^\s*domaines:\s*(.*)$/.exec(l);
    if (md && md[1].trim() === '(aucun)') {
      const lf = lignes[i + 1] || '';
      if (/fonctions:\s*\(aucune declaree\)/.test(lf)) suspects.push({ type: typeCourant, ligne: nomCourant });
    }
  });
  return { sansFiche, suspects };
}
porte('G14', '100 % des tests ont une fiche (SPEC-BANC-002) et au moins un domaine ou une fonction, déclarée ou observée (SPEC-BANC-066)', () => {
  let outListe;
  try {
    outListe = execFileSync(process.execPath, [path.join(root, 'tests', 'run.js'), '--preset', 'regression', '--lister'], { encoding: 'utf8' });
  } catch (e) { return { ok: false, detail: '--lister en erreur : ' + e.message }; }
  const { sansFiche, suspects } = testsSansDomaineNiFonctionDeclaree(outListe);
  if (sansFiche.length) {
    return { ok: false, detail: sansFiche.length + ' test(s) sans fiche ni spec citée : ' + sansFiche.slice(0, 5).join(' | ') };
  }
  const suspectsNode = suspects.filter(s => s.type === 'unitaire' || s.type === 'fonctionnel' || s.type === 'spec');
  const suspectsNonNode = suspects.filter(s => s.type !== 'unitaire' && s.type !== 'fonctionnel' && s.type !== 'spec');
  // e2e/integration/charge : jamais observés, la déclaration seule fait foi —
  // un suspect ici est un échec ferme de la porte.
  if (suspectsNonNode.length) {
    return { ok: false, detail: suspectsNonNode.length + ' test(s) e2e/intégration sans domaine NI fonction déclarée : ' + suspectsNonNode.slice(0, 5).map(s => s.ligne).join(' | ') };
  }
  if (!suspectsNode.length) return { ok: true, detail: '100 % des tests ont une fiche, un domaine ou une fonction (déclarée)' };

  // suspects Node : une VRAIE exécution peut leur trouver une fonction
  // OBSERVÉE que --lister, sans rien exécuter, ne pouvait pas voir.
  // `cahier de test : …` (ecrire()) sort sur STDERR, jamais stdout — d'où
  // spawnSync (les deux capturés) plutôt qu'execFileSync (stdout seul).
  const rExec = execFileSyncCombine([path.join(root, 'tests', 'run.js'), '--type', 'unitaire,fonctionnel,spec']);
  if (rExec.error) {
    return { ok: false, detail: 'exécution Node (unitaire/fonctionnel/spec) en échec — impossible de vérifier l\'observation : ' + rExec.error };
  }
  const outExec = rExec.out;
  const mCahier = /cahier de test : (\S+rapport\.html)/.exec(outExec);
  if (!mCahier) return { ok: false, detail: 'aucun cahier produit par l\'exécution de vérification' };
  let resultats;
  try { resultats = JSON.parse(fs.readFileSync(path.join(root, mCahier[1].replace(/rapport\.html$/, 'resultats.json').replace(/^\//, '')), 'utf8')); }
  catch (e) { return { ok: false, detail: 'cahier de vérification illisible : ' + e.message }; }
  const parNom = new Map(resultats.tests.map(t => [t.nom, t]));
  const encoreSansRien = suspectsNode.filter((s) => {
    // `s.ligne` = "[type] groupe :: nom" — seul le nom, après « :: », sert à retrouver le test
    const nom = s.ligne.split(' :: ').slice(1).join(' :: ');
    const t = parNom.get(nom);
    return !t || (!(t.domaines || []).length && !(t.fonctions || []).length);
  });
  return encoreSansRien.length
    ? { ok: false, detail: encoreSansRien.length + ' test(s) sans domaine NI fonction (déclarée OU observée) : ' + encoreSansRien.slice(0, 5).map(s => s.ligne).join(' | ') }
    : { ok: true, detail: '100 % des tests ont une fiche, un domaine ou une fonction (déclarée ou observée)' };
});

// ── G15 : captures systématiques début/fin pour tout test e2e (SPEC-BANC-026/027) ─
/* Une dérive visuelle (ex. damier de texture sur le terrain) ne peut être
   repérée après coup que si CHAQUE test e2e du cahier garde au moins une
   image du début et une de la fin — jamais seulement les tests qui pensent
   à appeler capture() eux-mêmes. Contrairement à G1/G2/G6 (lecture de texte
   source), cette porte vérifie le comportement RÉEL : elle relance une
   petite campagne e2e sans fenêtre (préréglage e2e-fumee, < 2 min, le même
   que pre-push) et inspecte le cahier de test qu'elle vient d'écrire sur le
   disque — resultats.json ET les fichiers de captures/ eux-mêmes, pas
   seulement le code qui est censé les produire. Sans navigateur Edge/Chrome
   installé, la campagne s'ignore avec un avertissement (SPEC-BANC-025) :
   aucun test e2e n'apparaît alors dans le cahier, et la porte ne peut pas
   se prononcer — elle passe sans échec, comme pre-push le fait déjà. */
porte('G15', 'Chaque test e2e du cahier produit ≥ 2 captures réelles, début et fin (SPEC-BANC-026/027)', () => {
  const avant = new Set(fs.existsSync(path.join(root, 'tests', 'resultats'))
    ? fs.readdirSync(path.join(root, 'tests', 'resultats')) : []);
  let out;
  try {
    out = execFileSync(process.execPath, [path.join(root, 'tests', 'run.js'), '--preset', 'e2e-fumee', '--delai', '150'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
  }
  if (/aucun navigateur Edge\/Chrome installé/.test(out)) {
    return { ok: true, detail: 'sans navigateur installé : porte ignorée sans échec (comme pre-push, SPEC-BANC-025)' };
  }
  const dossierResultats = path.join(root, 'tests', 'resultats');
  const apres = fs.existsSync(dossierResultats) ? fs.readdirSync(dossierResultats) : [];
  // le dossier fraîchement écrit par cette campagne : le seul nouveau nom
  // (l'horodatage garantit l'unicité), pas « le plus récent par date de
  // modification » qui pourrait pointer sur un cahier concurrent en cours
  // d'écriture par un autre process au même instant.
  const nouveaux = apres.filter(d => !avant.has(d));
  if (!nouveaux.length) return { ok: false, detail: 'aucun cahier de test écrit par e2e-fumee (sortie : ' + out.slice(-300) + ')' };
  const dossier = nouveaux.sort().slice(-1)[0];
  let resultats;
  try {
    resultats = JSON.parse(fs.readFileSync(path.join(dossierResultats, dossier, 'resultats.json'), 'utf8'));
  } catch (e) {
    return { ok: false, detail: 'resultats.json illisible dans ' + dossier + ' : ' + e.message };
  }
  const testsE2E = (resultats.tests || []).filter(t => t.type === 'e2e');
  if (!testsE2E.length) return { ok: false, detail: 'aucun test e2e dans le cahier ' + dossier + ' — préréglage e2e-fumee vide ou campagne en échec avant tout test' };
  const capturesDir = path.join(dossierResultats, dossier, 'captures');
  const insuffisants = [];
  let octetsCaptures = 0;
  testsE2E.forEach((t) => {
    const caps = t.captures || [];
    const valides = caps.filter((c) => {
      if (!c.fichier) return false;
      const p = path.join(capturesDir, c.fichier);
      try { const st = fs.statSync(p); octetsCaptures += st.size; return st.size > 0; }
      catch (e) { return false; }
    });
    if (valides.length < 2) insuffisants.push(t.nom + ' (' + valides.length + ')');
  });
  if (insuffisants.length) {
    return { ok: false, detail: insuffisants.length + '/' + testsE2E.length + ' test(s) e2e avec moins de 2 captures réelles : ' + insuffisants.slice(0, 5).join(', ') };
  }
  const ko = testsE2E.length ? Math.round(octetsCaptures / 1024) : 0;
  return { ok: true, detail: testsE2E.length + ' test(s) e2e, tous ≥ 2 captures (' + ko + ' Ko de captures pour ce cahier)' };
});

// ── G7/G8/G9 : rappel des portes manuelles ──────────────────────────────────
const MANUELLES = [
  ['G7', '100 % des tests end-to-end passent', 'ouvrir tests/index.html'],
  ['G8', 'Aucune erreur console au chargement', 'ouvrir index.html'],
  ['G9', '≥ 55 images/s, écran partagé compris', 'mesure dans les tests e2e'],
];

// ── rapport ─────────────────────────────────────────────────────────────────
let rouges = 0;
let sortie = '\n' + C.b + 'Portes de qualité' + C.x + '\n';
resultats.forEach(r => {
  if (!r.ok) rouges++;
  const marque = r.ok ? `${C.g}✓${C.x}` : `${C.r}✗${C.x}`;
  sortie += `  ${marque} ${C.b}${r.id}${C.x} ${r.titre}\n`;
  if (r.detail) sortie += `      ${r.ok ? C.d : C.r}${r.detail}${C.x}\n`;
});
sortie += `\n  ${C.d}portes manuelles (à vérifier dans le navigateur) :${C.x}\n`;
MANUELLES.forEach(([id, t, comment]) => {
  sortie += `  ${C.y}○${C.x} ${C.b}${id}${C.x} ${t} ${C.d}— ${comment}${C.x}\n`;
});

if (!quiet) console.log(sortie);
if (rouges) {
  console.log(`${C.r}${rouges} porte(s) au rouge${C.x} — commit bloqué\n`);
  process.exit(1);
}
console.log(`${C.g}Toutes les portes automatiques sont vertes${C.x}\n`);
