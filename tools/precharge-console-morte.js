/* precharge-console-morte.js — rend la sortie standard du processus INVALIDE
   en cours de route, comme celle d'un serveur relancé par une bascule de
   partie (stdio hérité) dont la console a disparu : lanceur sans console,
   exécutable empaqueté lancé par double-clic, terminal fermé.

   Chargé par `node -r tools/precharge-console-morte.js server.js …` (ou par
   NODE_OPTIONS, que la relance d'une bascule de partie hérite), sans rien
   changer au serveur : il reproduit aussi le défaut sur une ancienne version.

   La sortie standard doit être un FICHIER (le lanceur passe un descripteur de
   fichier en stdio : Node en fait un SyncWriteStream). Elle reste valide
   jusqu'à ce que le serveur y ait écrit sa ligne MC_PORT= (comme un lanceur
   qui l'a lue puis a disparu), puis MC_CONSOLE_MORTE_MS millisecondes encore
   (défaut 500) ; alors son
   descripteur est fermé. Sous POSIX, `fs.closeSync(1)` suffit ; sous Windows,
   libuv ne ferme jamais les descripteurs 0 à 2 (l'appel ne fait rien) : le
   flux est pointé sur un descripteur qui n'existe pas (un numéro qu'aucune
   ouverture de fichier ne réattribuera — un descripteur fermé de petit numéro
   serait réutilisé par la prochaine sauvegarde, qui recevrait la console).
   Dans les deux cas l'écriture suivante passe par le MÊME chemin que dans la
   réalité : SyncWriteStream._write → fs.writeSync → « EBADF: bad file
   descriptor, write ».

   Réservé aux tests (tests/integration-console-morte.js) et au banc
   tools/mesure-recul.js --console-morte ; jamais en exploitation. */
'use strict';
const fs = require('fs');

const delai = parseInt(process.env.MC_CONSOLE_MORTE_MS, 10) >= 0 ? parseInt(process.env.MC_CONSOLE_MORTE_MS, 10) : 500;
const DESCRIPTEUR_INEXISTANT = 65000;

function estFichier(flux) { return !!flux && typeof flux.fd === 'number' && !flux.isTTY; }

function tuer(flux, numero) {
  if (!estFichier(flux)) return;          // tube ou terminal : rien à reproduire ici
  if (process.platform !== 'win32') {
    try { fs.closeSync(numero); return; } catch (e) { /* on retombe sur le descripteur inexistant */ }
  }
  flux.fd = DESCRIPTEUR_INEXISTANT;
}

/* MC_CONSOLE_MORTE_RELANCE=1 : seul le processus relancé par une bascule de
   partie (MC_RELANCE=1) perd sa console — le parent garde la sienne. */
const actif = process.env.MC_CONSOLE_MORTE_RELANCE !== '1' || process.env.MC_RELANCE === '1';

/* Le serveur a-t-il écrit sa ligne MC_PORT= (son lanceur l'a lue, il tourne) ?
   Lisible si le lanceur a ouvert le fichier en lecture-écriture ; sinon, il
   suffit que le fichier ait reçu quelque chose. */
function pret() {
  if (!estFichier(process.stdout)) return false;
  let st = null;
  try { st = fs.fstatSync(process.stdout.fd); } catch (e) { return false; }
  if (!st.isFile()) return true;      // périphérique nul (stdio 'ignore') : rien à attendre
  const taille = st.size;
  if (taille === 0) return false;
  try {
    const n = Math.min(taille, 1 << 20), tampon = Buffer.alloc(n);
    fs.readSync(process.stdout.fd, tampon, 0, n, 0);
    return tampon.toString('utf8').indexOf('MC_PORT=') >= 0;
  } catch (e) { return true; }      // ouvert en écriture seule : la taille suffit
}

/* MC_CONSOLE_MORTE_TEMOIN : fichier écrit à l'instant où la sortie meurt (un
   lanceur de test l'attend avant de connecter ses clients). Sondage borné à
   60 s : faute de ligne, on coupe quand même. */
const debut = Date.now();
const sonde = actif && setInterval(() => {
  if (pret() || Date.now() - debut > 60000) {
    clearInterval(sonde);
    setTimeout(() => {
      tuer(process.stdout, 1); tuer(process.stderr, 2);
      if (process.env.MC_CONSOLE_MORTE_TEMOIN) { try { fs.writeFileSync(process.env.MC_CONSOLE_MORTE_TEMOIN, String(process.pid)); } catch (e) { /* tant pis */ } }
    }, delai).unref();
  }
}, 20);
if (sonde) sonde.unref();
