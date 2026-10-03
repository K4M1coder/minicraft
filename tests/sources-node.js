/* sources-node.js — LA liste ordonnée des modules src/*.js chargés sous Node
   (tests/run.js), partagée avec tools/perimetre.js qui doit les charger dans
   le même ordre pour savoir quel fichier définit quelle fonction `MC.*`
   (carte d'impact, SPEC-BANC-067). Module pur : rien que des données.
   L'ORDRE compte : un module lit ceux qui le précèdent au chargement
   (`var C = MC.Core`). */
'use strict';
module.exports = ['core', 'formes', 'noise', 'biomes', 'densite', 'zones', 'volcanisme', 'souterrain', 'recifs', 'caravanes', 'donjons', 'habitats', 'routes', 'histoire', 'recits', 'recit-serveur', 'carte', 'eau', 'feu', 'meteo', 'lointain', 'world', 'circuits', 'lumiere', 'ombres', 'succes', 'mesher', 'physics', 'file-chunks', 'taches-chunks', 'faune', 'factions', 'inventory', 'conteneurs', 'vehicules', 'metiers', 'economie',
  'entities', 'player', 'synchro', 'daycycle', 'save', 'saves', 'parties-fichier', 'poste', 'modes', 'chat', 'commandes', 'options', 'apparence', 'split', 'hud', 'gamepad', 'contrats-vague2', 'contrats-archi', 'net-protocol', 'parametres', 'admin', 'politique', 'guildes', 'pvp-enjeux', 'livre', 'livres', 'ambiance', 'audio', 'qualite'];
