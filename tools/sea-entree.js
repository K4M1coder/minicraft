/* tools/sea-entree.js — point d'entrée de l'exécutable autonome (SPEC-PACK-001).

   Dans un exécutable Node SEA, le moteur (Node) est le binaire lui-même et les
   fichiers du jeu voyagent dans le blob (élément `jeu.bin`, voir `assembler`).
   Au lancement, l'exécutable :
     1. déplie les fichiers du jeu à côté de lui (dossier `minicraft-jeu/`), ou à
        défaut dans le dossier personnel de l'utilisateur si l'emplacement est en
        lecture seule ; un fichier `.empreinte` évite de tout redéplier à chaque
        lancement, et un fichier de `parties/` déjà présent n'est JAMAIS écrasé ;
     2. fait croire à `server.js` qu'il est lancé par `node server.js` (même
        `process.argv`) : lancé sans paramètre, il ouvre donc le navigateur
        (SPEC-PACK-001) et se comporte exactement comme depuis les sources ;
     3. charge `server.js` depuis le dossier déplié.
   Ne dépend que de modules intégrés à Node (un script SEA ne peut rien charger
   d'autre). Testé sous Node simple avec un faux module `sea`
   (tests/integration-paquet.js) et, quand `postject` est disponible, en vrai. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

/* Conteneur : 4 octets (taille de l'en-tête), en-tête JSON [{nom, taille}], puis
   les contenus bout à bout. Plus simple qu'un zip à relire sans bibliothèque. */
function assembler(entrees) {
  const entete = Buffer.from(JSON.stringify(entrees.map(e => ({ nom: e.nom, taille: e.contenu.length }))), 'utf8');
  const tete = Buffer.alloc(4);
  tete.writeUInt32LE(entete.length, 0);
  return Buffer.concat([tete, entete].concat(entrees.map(e => e.contenu)));
}

function desassembler(buf) {
  const n = buf.readUInt32LE(0);
  const liste = JSON.parse(buf.slice(4, 4 + n).toString('utf8'));
  let pos = 4 + n;
  return liste.map(e => {
    const contenu = buf.slice(pos, pos + e.taille);
    pos += e.taille;
    return { nom: e.nom, contenu: contenu };
  });
}

function nomSur(nom) {
  const n = String(nom).replace(/\\/g, '/');
  if (/^\//.test(n) || n.split('/').indexOf('..') >= 0 || /^[a-zA-Z]:/.test(n)) throw new Error('nom invalide dans le paquet : ' + nom);
  return n;
}

/* Déplie les fichiers dans `dossier` (jamais un fichier de `parties/` déjà présent). */
function deplier(entrees, dossier) {
  const empreinte = crypto.createHash('sha256');
  entrees.forEach(e => { empreinte.update(e.nom); empreinte.update(e.contenu); });
  const sceau = empreinte.digest('hex');
  const fichierSceau = path.join(dossier, '.empreinte');
  try { if (fs.readFileSync(fichierSceau, 'utf8') === sceau) return { dossier: dossier, deplie: false }; } catch (e) { /* première fois */ }
  fs.mkdirSync(dossier, { recursive: true });
  entrees.forEach(e => {
    const n = nomSur(e.nom);
    const cible = path.join(dossier, n);
    if (n.indexOf('parties/') === 0 && fs.existsSync(cible)) return;
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.writeFileSync(cible, e.contenu);
  });
  fs.writeFileSync(fichierSceau, sceau);
  return { dossier: dossier, deplie: true };
}

function dossierEcriture(exe, entrees) {
  const candidats = [path.join(path.dirname(exe), 'minicraft-jeu'), path.join(os.homedir(), '.minicraft', 'jeu')];
  let derniere = null;
  for (const d of candidats) {
    try { return deplier(entrees, d); } catch (e) { derniere = e; }
  }
  throw derniere;
}

function lancer(sea, exe, argsUtilisateur) {
  const entrees = desassembler(Buffer.from(sea.getRawAsset('jeu.bin')));
  const r = dossierEcriture(exe, entrees);
  const serveur = path.join(r.dossier, 'server.js');
  /* Le serveur se relance lui-même (bascule de partie) avec [server.js, ...args] :
     on retire ce premier argument s'il désigne déjà le serveur déplié. */
  let args = argsUtilisateur.slice();
  if (args[0] && path.resolve(args[0]) === path.resolve(serveur)) args = args.slice(1);
  process.argv = [exe, serveur].concat(args);
  process.chdir(r.dossier);
  /* `require` d'un script SEA ne charge que les modules intégrés : createRequire en charge un vrai. */
  require('module').createRequire(serveur)(serveur);
  return { serveur: serveur, args: args };
}

if (typeof module !== 'undefined') module.exports = { assembler, desassembler, deplier, lancer, nomSur };

(function () {
  let sea = null;
  try { sea = require('node:sea'); } catch (e) { return; }
  if (sea && sea.isSea && sea.isSea()) lancer(sea, process.execPath, process.argv.slice(2));
})();
