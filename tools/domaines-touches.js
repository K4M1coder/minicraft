/* tools/domaines-touches.js — domaines de SPECS.md touchés « avec confiance »
   par une liste de fichiers modifiés (utilisé par tools/hooks/pre-commit.js
   pour restreindre le préréglage `commit` — voir son en-tête). Module à part,
   pur au sens Node (lit seulement SPECS.md, aucun effet de bord), pour être
   testable sans déclencher tout le crochet.

   « Avec confiance » : uniquement si TOUS les fichiers fournis sont dans
   src/ ET que CHACUN d'eux se reconnaît dans AU MOINS un domaine — un seul
   fichier partagé sans domaine propre (core.js, world.js, entities.js,
   mesher.js…) fait retomber sur `null` (repli sur la suite complète), même
   si d'autres fichiers de la liste ont un domaine clair : un changement à
   core.js peut affecter n'importe quel domaine, le restreindre serait une
   fausse économie qui laisserait passer une régression. */
'use strict';
const fs = require('fs');
const path = require('path');

function domainesTouches(fichiers, racine) {
  if (!fichiers || !fichiers.length || fichiers.some((f) => !/^src\//.test(f))) return null;
  let specsTexte;
  try { specsTexte = fs.readFileSync(path.join(racine, 'SPECS.md'), 'utf8'); } catch (e) { return null; }
  const domainesConnus = Array.from(new Set((specsTexte.match(/SPEC-([A-Z0-9]+)-\d+/g) || [])
    .map((id) => id.replace(/^SPEC-/, '').replace(/-\d+$/, ''))));
  const bases = fichiers.map((f) => path.basename(f, '.js').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  const parFichier = bases.map((b) => domainesConnus.filter((d) => b.indexOf(d) >= 0 || d.indexOf(b) >= 0));
  // un seul fichier sans domaine reconnu suffit à retomber sur la suite complète
  if (parFichier.some((l) => l.length === 0)) return null;
  const set = new Set();
  parFichier.forEach((l) => l.forEach((d) => set.add(d)));
  return set.size ? Array.from(set) : null;
}

module.exports = { domainesTouches };
