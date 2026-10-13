/* precharge-disque-lent.js — rend LENTES les écritures SYNCHRONES d'un dossier,
   comme un dossier synchronisé (OneDrive) : chaque écriture ou renommage
   synchrone d'un fichier de ce dossier bloque le processus MC_DISQUE_LENT_MS
   millisecondes (défaut 150) — le temps d'une écriture que le pilote de
   synchronisation retient, sans consommer de processeur (Atomics.wait).

   Le serveur empaqueté de la v0.9.0 tournait dans un dossier OneDrive : son
   journal montre des sauvegardes refusées (EPERM au renommage) et une boucle
   d'exceptions de quelques tours par seconde seulement, chaque tour réécrivant
   le monde en synchrone. Sur un disque local rapide, la même boucle tourne des
   centaines de fois par seconde et affame moins la génération du terrain.

   Chargé par `node -r tools/precharge-disque-lent.js server.js …` avec
   MC_DISQUE_LENT_DOSSIER=<dossier> (seuls ses fichiers sont ralentis). Réservé
   aux tests (banc : POST /tests/serveur-jeu { conditions: { consoleMorte, disqueLentMs } }) ;
   jamais en exploitation. Ne change rien au serveur : il reproduit aussi le
   défaut sur une ancienne version. */
'use strict';
const fs = require('fs');
const path = require('path');

const dossier = process.env.MC_DISQUE_LENT_DOSSIER ? path.resolve(process.env.MC_DISQUE_LENT_DOSSIER) : null;
const ms = parseInt(process.env.MC_DISQUE_LENT_MS, 10) >= 0 ? parseInt(process.env.MC_DISQUE_LENT_MS, 10) : 150;
const verrou = new Int32Array(new SharedArrayBuffer(4));

function concerne(f) {
  if (!dossier || typeof f !== 'string') return false;
  const p = path.resolve(f);
  return p === dossier || p.indexOf(dossier + path.sep) === 0;
}
function attendre() { if (ms > 0) Atomics.wait(verrou, 0, 0, ms); }

if (dossier) {
  const ecrire = fs.writeFileSync, renommer = fs.renameSync;
  fs.writeFileSync = function (f) { if (concerne(f)) attendre(); return ecrire.apply(fs, arguments); };
  fs.renameSync = function (a, b) { if (concerne(b) || concerne(a)) attendre(); return renommer.apply(fs, arguments); };
}
