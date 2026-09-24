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
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const quiet = process.argv.includes('--quiet');

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

/* Modules de logique pure : ils doivent tourner sous Node, donc ne jamais
   toucher au navigateur. C'est la porte qui protège toute la stratégie de test. */
const PURS = ['core', 'formes', 'noise', 'biomes', 'densite', 'zones', 'volcanisme', 'souterrain', 'recifs', 'caravanes', 'donjons', 'habitats', 'routes', 'histoire', 'recits', 'carte', 'eau', 'feu', 'meteo', 'lointain', 'world', 'circuits', 'lumiere', 'ombres', 'succes', 'mesher', 'physics', 'faune', 'factions', 'inventory', 'vehicules',
              'entities', 'player', 'synchro', 'daycycle', 'save', 'saves', 'modes',
              'chat', 'commandes', 'options', 'apparence', 'split', 'hud', 'gamepad', 'net-protocol', 'parametres', 'admin', 'politique', 'guildes', 'livre', 'livres', 'ambiance'];
const NAVIGATEUR = ['audio', 'atlas', 'render', 'ui', 'input', 'game', 'net'];

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
  // relatif (.githooks) ou absolu vers les crochets du dépôt principal — l'absolu sert aussi les worktrees
  if (chemin !== '.githooks' && path.resolve(root, chemin) !== path.resolve(root, '.githooks')) return { ok: false, detail: 'crochets non branchés (' + (chemin || 'aucun') + ') : node tools/version.js --installer' };
  const manquants = ['commit-msg', 'pre-commit'].filter(h => !fs.existsSync(path.join(root, '.githooks', h)));
  if (manquants.length) return { ok: false, detail: 'crochets absents : ' + manquants.join(', ') };
  // la règle du cran, sur des cas connus
  const V = require('../tools/version.js');
  const cas = [[['feat: a', 'fix: b'], '0.3.4', 'y'], [['fix(x): a'], '1.2.3', 'z'], [['feat!: a'], '1.2.3', 'x'],
               [['feat!: a'], '0.2.3', 'y'], [['docs: a', 'chore: b'], '1.0.0', null]];
  const faux = cas.filter(c => V.cranDes(c[0].map(t => ({ titre: t, corps: '' })), c[1]) !== c[2]);
  return faux.length ? { ok: false, detail: 'règle du cran fausse pour ' + JSON.stringify(faux[0]) } : { ok: true, detail: 'commit-msg et pre-commit actifs, règle du cran vérifiée' };
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
