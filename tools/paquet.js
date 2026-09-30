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

   Produit AUSSI une archive .zip de la version portable (jamais du dossier
   `sea/` — le binaire `node` copié y pèse des dizaines de Mo pour un
   exécutable de toute façon inachevé sans `postject`, inutile à partager) :
   un fichier unique, nommé par version, prêt à distribuer ou à tester tel
   quel — voir `construireZipRelease`, appelée automatiquement par
   `node tools/version.js --publier` (jamais commitée : voir .gitignore).

   Usage :  node tools/paquet.js [dossier-de-sortie]   (défaut : dist/) */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ZIP = require('./zip.js');

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
  /* SPEC-ARCHI-016 : le mode local fermé range les parties dans `parties/`
     (index + un fichier de monde par partie, SPEC-ARCHI-013) ; le dossier est
     livré vide, avec un mot d'explication, plutôt que créé à la première partie. */
  fs.mkdirSync(path.join(destDir, 'parties'), { recursive: true });
  fs.writeFileSync(path.join(destDir, 'parties', 'LISEZMOI.txt'),
    'Vos parties MiniCraft sont rangées ici : un index (index.json) et un fichier de monde par partie.\n' +
    'Copiez ce dossier pour sauvegarder ou déplacer vos parties ; ne le modifiez pas pendant que le jeu tourne.\n');
  copies.push('parties/LISEZMOI.txt');
  return copies;
}

const LANCEUR_CMD =
`@echo off
rem MiniCraft — lanceur Windows. Sans argument : démarre le serveur de jeu LOCAL (fermé au réseau,
rem boucle locale seulement) et ouvre le navigateur. Le serveur s'arrête quand l'onglet est fermé.
cd /d "%~dp0"
node server.js %*
`;
const LANCEUR_SH =
`#!/bin/sh
# MiniCraft — lanceur macOS/Linux. Sans argument : démarre le serveur de jeu LOCAL (fermé au réseau,
# boucle locale seulement) et ouvre le navigateur. Le serveur s'arrête quand l'onglet est fermé.
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

/* Zippe RÉCURSIVEMENT tout `destDir` (résultat de `construire`), à
   l'exception du sous-dossier `sea/` (voir l'en-tête du fichier). Utilise le
   zippeur maison de `tools/zip.js` (déjà réutilisé par l'export docx),
   jamais de dépendance npm. `entrees` (chemins relatifs) triées pour un zip
   reproductible d'une construction à l'autre sur les mêmes fichiers. */
function listerFichiers(dir, base) {
  base = base || dir;
  let out = [];
  fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    const complet = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (path.relative(base, complet) === 'sea') return;
      out = out.concat(listerFichiers(complet, base));
    } else {
      out.push(complet);
    }
  });
  return out;
}
function construireZip(destDir, cheminZip) {
  const fichiers = listerFichiers(destDir).sort();
  const entrees = fichiers.map((f) => ({
    nom: path.relative(destDir, f).split(path.sep).join('/'),
    contenu: fs.readFileSync(f),
  }));
  fs.mkdirSync(path.dirname(cheminZip), { recursive: true });
  fs.writeFileSync(cheminZip, ZIP.creerZip(entrees));
  return { chemin: cheminZip, fichiers: entrees.length, octets: fs.statSync(cheminZip).size };
}

/* Construit puis zippe une version PORTABLE nommée par version, dans
   `dossierReleases` (défaut `dist/releases/`, jamais commité). Appelée par
   `tools/version.js --publier` juste après avoir posé l'étiquette — un
   fichier prêt à tester ou à partager pour CHAQUE publication, sans étape
   manuelle. Construit dans un dossier temporaire propre (jamais `dist/`
   directement, pour ne pas mélanger plusieurs versions dans le même arbre
   avant zippage) puis le retire. */
function construireZipRelease(version, dossierReleases) {
  dossierReleases = dossierReleases || path.join(RACINE, 'dist', 'releases');
  const tmp = path.join(RACINE, 'dist', '.tmp-release-' + version);
  fs.rmSync(tmp, { recursive: true, force: true });
  construire(tmp, { sansSEA: true });    // SEA best-effort inutile pour un zip partageable (inachevé sans postject)
  const cheminZip = path.join(dossierReleases, `minicraft-v${version}.zip`);
  const r = construireZip(tmp, cheminZip);
  fs.rmSync(tmp, { recursive: true, force: true });
  return r;
}

module.exports = { construire, listerSrc, copierArbre, ecrireLanceurs, preparerSEA, commandePostject, nomExecutable, construireZip, construireZipRelease };

if (require.main === module) {
  const version = process.argv.includes('--zip-release')
    ? process.argv[process.argv.indexOf('--zip-release') + 1] : null;
  if (version) {
    console.log(`Construction de l'archive .zip de la version ${version}…`);
    const r = construireZipRelease(version);
    console.log(`  ${r.fichiers} fichiers, ${(r.octets / 1024).toFixed(0)} Ko → ${r.chemin}`);
  } else {
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
}
