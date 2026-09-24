/* tools/paquet.js — SPEC-PACK-001 : construit une version empaquetée du jeu.

   Produit TOUJOURS une archive portable (un dossier autonome + un lanceur
   par système : start.cmd pour Windows, start.sh pour macOS/Linux). Lancés
   sans paramètre, ces deux lanceurs font ce que fait `node server.js` sans
   paramètre : servir le jeu ET ouvrir le navigateur (voir server.js).

   Tente EN PLUS, quand Node le permet sur la machine qui construit (Node SEA,
   `--experimental-sea-config`, disponible depuis Node 20), de préparer un
   exécutable autonome pour l'OS courant. La dernière étape officielle de SEA
   (injecter le blob dans le binaire `node`) demande l'outil `postject` — un
   paquet npm, jamais installé ici (« aucun téléchargement externe ») : le
   script prépare tout ce qu'il peut SANS lui (config, blob, copie du binaire
   `node`) et affiche la commande exacte à lancer pour finir, une fois par
   système :

     Windows : npx postject dist\minicraft.exe NODE_SEA_BLOB dist\sea\prep.blob ^
               --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
     macOS   : npx postject dist/minicraft NODE_SEA_BLOB dist/sea/prep.blob \
               --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
               --macho-segment-name NODE_SEA
     Linux   : npx postject dist/minicraft NODE_SEA_BLOB dist/sea/prep.blob \
               --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

   Usage :  node tools/paquet.js [dossier-de-sortie]   (défaut : dist/) */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..');

const FICHIERS_RACINE = ['index.html', 'admin.html', 'server.js', 'README.md'];
/* Le dossier de tests, tools/ et les fichiers de spécification ne servent à
   rien pour JOUER : les embarquer ne ferait que gonfler l'archive. */
function listerSrc() {
  return fs.readdirSync(path.join(RACINE, 'src'))
    .filter(f => /\.(js|css)$/.test(f));
}

function copierArbre(destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  fs.mkdirSync(path.join(destDir, 'src'), { recursive: true });
  const copies = [];
  FICHIERS_RACINE.forEach(f => {
    const src = path.join(RACINE, f);
    if (!fs.existsSync(src)) return;                 // README.md facultatif dans un dossier de test minimal
    fs.copyFileSync(src, path.join(destDir, f));
    copies.push(f);
  });
  listerSrc().forEach(f => {
    fs.copyFileSync(path.join(RACINE, 'src', f), path.join(destDir, 'src', f));
    copies.push('src/' + f);
  });
  return copies;
}

const LANCEUR_CMD =
`@echo off
rem MiniCraft — lanceur Windows. Sans argument : sert le jeu et ouvre le navigateur.
cd /d "%~dp0"
node server.js %*
`;
const LANCEUR_SH =
`#!/bin/sh
# MiniCraft — lanceur macOS/Linux. Sans argument : sert le jeu et ouvre le navigateur.
cd "$(dirname "$0")"
exec node server.js "$@"
`;

function ecrireLanceurs(destDir) {
  fs.writeFileSync(path.join(destDir, 'start.cmd'), LANCEUR_CMD);
  fs.writeFileSync(path.join(destDir, 'start.sh'), LANCEUR_SH);
  try { fs.chmodSync(path.join(destDir, 'start.sh'), 0o755); } catch (e) { /* pas de chmod sous Windows : sans effet */ }
  return ['start.cmd', 'start.sh'];
}

const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function nomExecutable() {
  if (process.platform === 'win32') return 'minicraft.exe';
  return 'minicraft';
}

function commandePostject(destDir, exe) {
  const blob = path.join('sea', 'prep.blob');
  if (process.platform === 'win32') {
    return `npx postject "${path.join(destDir, exe)}" NODE_SEA_BLOB "${path.join(destDir, blob)}" ` +
           `--sentinel-fuse ${FUSE}`;
  }
  const macho = process.platform === 'darwin' ? ' --macho-segment-name NODE_SEA' : '';
  return `npx postject "${path.join(destDir, exe)}" NODE_SEA_BLOB "${path.join(destDir, blob)}" ` +
         `--sentinel-fuse ${FUSE}${macho}`;
}

/* Prépare ce que Node fournit NATIVEMENT (config + blob), copie le binaire
   `node` courant, et rend compte de ce qu'il reste à faire. Ne lève jamais :
   un échec ici n'empêche pas l'archive portable d'être livrée. */
function preparerSEA(destDir) {
  const seaDir = path.join(destDir, 'sea');
  try {
    fs.mkdirSync(seaDir, { recursive: true });
    const entree = path.join(seaDir, 'entree.js');
    // le point d'entrée SEA se contente de démarrer le vrai serveur : la
    // logique ne vit qu'à un seul endroit (server.js), jamais dupliquée.
    fs.writeFileSync(entree,
      "'use strict';\nrequire(" + JSON.stringify(path.relative(seaDir, path.join(destDir, 'server.js')).split(path.sep).join('/')) + ");\n");
    const config = { main: 'entree.js', output: 'prep.blob', disableExperimentalSEAWarning: true };
    fs.writeFileSync(path.join(seaDir, 'sea-config.json'), JSON.stringify(config, null, 2));
    execFileSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'],
      { cwd: seaDir, stdio: 'pipe' });
    const blob = path.join(seaDir, 'prep.blob');
    if (!fs.existsSync(blob)) return { ok: false, motif: 'blob non produit' };

    const exe = nomExecutable();
    fs.copyFileSync(process.execPath, path.join(destDir, exe));
    try { fs.chmodSync(path.join(destDir, exe), 0o755); } catch (e) {}

    return { ok: true, blob: path.relative(destDir, blob), executable: exe,
             commande: commandePostject(destDir, exe) };
  } catch (e) {
    return { ok: false, motif: e.message };
  }
}

/* Construit l'archive dans `destDir`. Toujours l'archive portable ; SEA en
   best-effort (voir preparerSEA). Renvoie un compte rendu, jamais ne lève —
   c'est l'appelant (CLI ou test) qui décide quoi faire d'un échec partiel. */
function construire(destDir, opts) {
  opts = opts || {};
  const copies = copierArbre(destDir);
  const lanceurs = ecrireLanceurs(destDir);
  const sea = opts.sansSEA ? { ok: false, motif: 'désactivé (--sans-sea)' } : preparerSEA(destDir);
  return { dossier: destDir, fichiers: copies, lanceurs: lanceurs, sea: sea };
}

module.exports = { construire, listerSrc, copierArbre, ecrireLanceurs, preparerSEA, commandePostject, nomExecutable };

if (require.main === module) {
  const dest = path.resolve(RACINE, process.argv[2] || 'dist');
  const sansSEA = process.argv.includes('--sans-sea');
  console.log(`Construction de l'archive portable dans ${dest}…`);
  const r = construire(dest, { sansSEA });
  console.log(`  ${r.fichiers.length} fichiers copiés, lanceurs : ${r.lanceurs.join(', ')}`);
  if (r.sea.ok) {
    console.log(`  binaire Node copié : ${r.sea.executable}`);
    console.log('  pour finir l\'exécutable autonome (nécessite le paquet npm "postject", non installé ici) :');
    console.log('    ' + r.sea.commande);
  } else {
    console.log(`  exécutable autonome non préparé : ${r.sea.motif}`);
  }
  console.log('Terminé. Lancer le jeu : ' + (process.platform === 'win32' ? path.join(dest, 'start.cmd') : path.join(dest, 'start.sh')));
}
