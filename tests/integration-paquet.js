/* integration-paquet.js — SPEC-PACK-001 : construit une archive réelle dans un
   dossier temporaire, puis démarre le serveur DEPUIS cette archive et vérifie
   qu'il sert vraiment le jeu. Complète le rôle de tools/paquet.js : ce n'est
   pas un module pur (fs, child_process), donc testé ici comme les autres
   tests d'intégration, en dehors du bac à sable de tests/run.js.

   Usage : node tests/integration-paquet.js [port] */
'use strict';
require('./journal-temp.js');   // journal des serveurs lancés : dossier temporaire (SPEC-BANC-106)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const RACINE = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8389;

const C = { r: '\x1b[31m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
let passes = 0, echecs = 0;
const details = [];
function ok(cond, nom, info) {
  if (cond) { passes++; details.push(`  ${C.g}·${C.x} ${C.d}${nom}${C.x}`); }
  else { echecs++; details.push(`  ${C.r}✗ ${nom}${C.x}${info ? '\n    ' + C.r + info + C.x : ''}`); }
}

function requete(port, chemin) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: chemin }, (res) => {
      res.resume();
      resolve({ code: res.statusCode });
    }).on('error', () => resolve({ code: 0 }));
  });
}
const dodo = (ms) => new Promise(r => setTimeout(r, ms));
async function attendrePret(port) {
  for (let i = 0; i < 60; i++) {
    await dodo(100);
    const r = await requete(port, '/index.html');
    if (r.code === 200) return true;
  }
  return false;
}

(async function () {
  const paquet = require(path.join(RACINE, 'tools', 'paquet.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-paquet-'));
  const dest = path.join(tmp, 'dist');

  const r = paquet.construire(dest, { sansSEA: true });   // SEA testé à part : lent, non garanti partout
  ok(fs.existsSync(path.join(dest, 'index.html')), 'SPEC-PACK-001 : index.html est dans l\'archive');
  ok(fs.existsSync(path.join(dest, 'admin.html')), 'SPEC-PACK-001 : admin.html est dans l\'archive');
  ok(fs.existsSync(path.join(dest, 'server.js')), 'SPEC-PACK-001 : server.js est dans l\'archive');
  ok(fs.existsSync(path.join(dest, 'src', 'core.js')), 'SPEC-PACK-001 : les modules src/ sont copiés');
  ok(fs.existsSync(path.join(dest, 'start.cmd')), 'SPEC-PACK-001 : le lanceur Windows est produit');
  ok(fs.existsSync(path.join(dest, 'start.sh')), 'SPEC-PACK-001 : le lanceur macOS/Linux est produit');
  ok(fs.readFileSync(path.join(dest, 'start.cmd'), 'utf8').indexOf('node server.js') >= 0,
     'SPEC-PACK-001 : le lanceur Windows démarre bien le serveur');
  ok(fs.readFileSync(path.join(dest, 'start.sh'), 'utf8').indexOf('node server.js') >= 0,
     'SPEC-PACK-001 : le lanceur macOS/Linux démarre bien le serveur');

  // ── SPEC-ARCHI-016 : le lanceur démarre le mode local fermé par défaut, et l'archive embarque ce dont il a besoin
  ['start.cmd', 'start.sh'].forEach(f => {
    const txt = fs.readFileSync(path.join(dest, f), 'utf8');
    const lignes = txt.split(/\r?\n/).filter(l => /node server\.js/.test(l) && !/^\s*(rem|#)/i.test(l));
    ok(lignes.length === 1 && !/--ouvert|--serveur|--port/.test(lignes[0]),
       'SPEC-ARCHI-016 : ' + f + ' lance le mode par défaut (local fermé au réseau), sans --ouvert ni --serveur', lignes.join(' | '));
  });
  ok(fs.existsSync(path.join(dest, 'parties', 'LISEZMOI.txt')), "SPEC-ARCHI-016 : l'archive embarque le dossier des parties");
  ['contrats-archi.js', 'parties-fichier.js', 'poste.js'].forEach(f => {
    ok(fs.existsSync(path.join(dest, 'src', f)), "SPEC-ARCHI-016 : l'archive embarque src/" + f);
  });
  ok(fs.existsSync(path.join(dest, 'README.md')) && !/python -m http\.server/.test(fs.readFileSync(path.join(dest, 'README.md'), 'utf8')),
     'SPEC-ARCHI-016 : le README embarqué ne présente plus python -m http.server comme moyen de jouer');
  const pageAcc = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
  ok(/node server\.js/.test(pageAcc) && /start\.cmd/.test(pageAcc), "SPEC-ARCHI-016 : la page d'accueil embarquée explique comment lancer le serveur");

  // ── l'archive produite sert vraiment le jeu ──────────────────────────────
  const srv = spawn(process.execPath, [path.join(dest, 'server.js'), '--port', String(PORT)],
    { cwd: dest, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  srv.stdout.on('data', d => logs.push(String(d)));
  srv.stderr.on('data', d => logs.push('ERR ' + String(d)));
  try {
    const pret = await attendrePret(PORT);
    ok(pret, 'SPEC-PACK-001 : le serveur démarré DEPUIS l\'archive répond', logs.join(''));
    if (pret) {
      const idx = await requete(PORT, '/index.html');
      ok(idx.code === 200, 'SPEC-PACK-001 : index.html est servi depuis l\'archive');
      const src = await requete(PORT, '/src/core.js');
      ok(src.code === 200, 'SPEC-PACK-001 : les modules sont servis depuis l\'archive');
      const admin = await requete(PORT, '/admin.html');
      ok(admin.code === 200, 'SPEC-PACK-001 : la console d\'administration est servie depuis l\'archive');
    }
  } finally {
    try { srv.kill(); } catch (e) {}
  }

  // ── SEA : best-effort, ne doit jamais planter le script même sans succès ─
  try {
    const seaR = paquet.preparerSEA(dest);
    ok(typeof seaR.ok === 'boolean', 'SPEC-PACK-001 : la préparation SEA rend un compte rendu, sans lever',
       JSON.stringify(seaR));
    if (seaR.ok) {
      ok(fs.existsSync(path.join(dest, seaR.executable)), 'SPEC-PACK-001 : un binaire node est copié pour l\'OS courant');
      ok(typeof seaR.commande === 'string' && seaR.commande.indexOf('postject') >= 0,
         'SPEC-PACK-001 : la commande manuelle de finition (postject) est documentée');
    }
  } catch (e) {
    echecs++; details.push(`  ${C.r}✗ preparerSEA a levé : ${e.message}${C.x}`);
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}

  // ── SPEC-PACK-004 : un paquet .zip nommé par version, à chaque publication ─
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-release-'));
  try {
    const releases = path.join(tmp2, 'releases');
    const r = paquet.construireZipRelease('9.9.9-test', releases);
    ok(fs.existsSync(r.chemin), 'SPEC-PACK-004 : un fichier .zip nommé par version est produit',
       r.chemin);
    ok(path.basename(r.chemin) === 'minicraft-v9.9.9-test.zip',
       'SPEC-PACK-004 : le nom du fichier porte exactement la version publiée', path.basename(r.chemin));
    const ZIP = require(path.join(RACINE, 'tools', 'zip.js'));
    const entrees = ZIP.lireZip(fs.readFileSync(r.chemin));
    ok(entrees.some(e => e.nom === 'index.html'), 'SPEC-PACK-004 : le zip contient index.html');
    ok(entrees.some(e => e.nom === 'server.js'), 'SPEC-PACK-004 : le zip contient server.js');
    ok(entrees.some(e => e.nom === 'src/core.js'), 'SPEC-PACK-004 : le zip contient les modules src/');
    ok(entrees.some(e => e.nom === 'start.cmd') && entrees.some(e => e.nom === 'start.sh'),
       'SPEC-PACK-004 : le zip contient les deux lanceurs');
    ok(!entrees.some(e => e.nom.indexOf('sea/') === 0),
       'SPEC-PACK-004 : le dossier sea/ (binaire node, inachevé sans postject) n\'est jamais dans le zip partagé',
       entrees.filter(e => e.nom.indexOf('sea') >= 0).map(e => e.nom).join(', '));
    ok(!fs.existsSync(path.join(tmp2, '.tmp-release-9.9.9-test')),
       'SPEC-PACK-004 : le dossier de construction temporaire est nettoyé après zippage');
  } catch (e) {
    echecs++; details.push(`  ${C.r}✗ construireZipRelease a levé : ${e.message}${C.x}\n${e.stack}`);
  } finally {
    try { fs.rmSync(tmp2, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(`\n${C.b}Integration paquet${C.x}\n${details.join('\n')}\n`);
  const total = passes + echecs;
  if (echecs) { console.log(`${C.r}${echecs} échec(s)${C.x} sur ${total} tests\n`); process.exit(1); }
  console.log(`${C.g}${passes}/${total} tests d intégration passent${C.x}\n`);
})();
