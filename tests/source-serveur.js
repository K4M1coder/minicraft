/* source-serveur.js — le texte source du serveur, pour les audits statiques
   (SPEC-SERVEUR-008). Depuis le découpage de server.js, « ce que fait le
   serveur » vit dans server.js ET dans ses modules src/serveur-*.js : un audit
   qui cherche une règle du serveur lit leur ensemble, jamais server.js seul.
   Ordre : server.js d'abord, puis ses modules dans l'ordre de sa liste
   MODULES (l'ordre de chargement). Module Node pur : rien que de la lecture. */
'use strict';
const fs = require('fs');
const path = require('path');

/* Noms des modules du serveur (« serveur-… »), lus dans la liste MODULES de
   server.js — jamais recopiés ici, pour ne pas diverger. */
function modulesServeur(racine) {
  const src = fs.readFileSync(path.join(racine, 'server.js'), 'utf8');
  const bloc = /const MODULES = \[([\s\S]*?)\];/.exec(src);
  const noms = [];
  if (bloc) bloc[1].replace(/'([^']+)'/g, (_, n) => { if (/^serveur-/.test(n)) noms.push(n); return ''; });
  return noms;
}

function sourceServeur(racine) {
  return [fs.readFileSync(path.join(racine, 'server.js'), 'utf8')]
    .concat(modulesServeur(racine).map(m => fs.readFileSync(path.join(racine, 'src', m + '.js'), 'utf8')))
    .join('\n');
}

module.exports = { sourceServeur, modulesServeur };
