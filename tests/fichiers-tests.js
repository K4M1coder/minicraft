/* fichiers-tests.js — LA liste des fichiers de tests describe/it (unit,
   functional, spec-*), partagée par `node tests/run.js` et par le banc
   navigateur (tests/index.html). Avant ce fichier, chacun tenait sa propre
   copie à la main : elles avaient divergé (spec-transport, spec-environnement,
   spec-archi-vehicules… absents du banc ; spec-crochets, Node-only, chargé
   par le banc où il levait « require is not defined »), si bien qu'une
   partie des tests n'apparaissait jamais dans la page — ni pour la lancer,
   ni pour retrouver son historique (SPEC-BANC-117).

   Module PUR (ni require, ni document) : chargeable sous Node (vm ou
   require) comme dans le navigateur.

   Chaque entrée : { f: 'nom-sans-.js', node: true? }
     - `node: true` : le fichier utilise `require`/`process`/`__dirname` DÈS
       SON CHARGEMENT (outillage lu sur disque) — il ne peut pas être évalué
       dans le navigateur. Ses tests restent visibles dans le banc (comme
       « Node seulement », via l'historique — SPEC-BANC-118), mais ne s'y
       lancent pas.
   L'ORDRE compte : c'est celui du catalogue Node (tests/run.js), donc celui
   des identifiants générés `N-<rang>-…` des tests sans SPEC-* dans leur nom.
   Ajouter un fichier : à la FIN de la liste, pour ne pas décaler les autres. */
(function (G) {
  'use strict';
  var NOMS = ['unit', 'functional', 'spec-modes', 'spec-saves', 'spec-audit', 'spec-armes', 'spec-chat', 'spec-split', 'spec-net', 'spec-secu', 'spec-ia-coll', 'spec-livre', 'spec-monde', 'spec-mer', 'spec-vehicules', 'spec-transport', 'spec-horizon', 'spec-climat', 'spec-habitats', 'spec-routes', 'spec-histoire', 'spec-succes', 'spec-ombres', 'spec-population', 'spec-hud', 'spec-couverture', 'spec-recits', 'spec-recit-serveur', 'spec-commandes', 'spec-portes', 'spec-eau', 'spec-vent', 'spec-loin', 'spec-donjons', 'spec-audio', 'spec-options', 'spec-souterrain', 'spec-apparence', 'spec-saisons', 'spec-parametres', 'spec-admin', 'spec-densite', 'spec-volcans', 'spec-caravanes', 'spec-economie', 'spec-metiers', 'spec-zones', 'spec-blocs16', 'spec-politique', 'spec-environnement', 'spec-guildes', 'spec-materiaux', 'spec-circuits', 'spec-objets', 'spec-formes', 'spec-recifs', 'spec-interieur', 'spec-batiments', 'spec-banc', 'spec-banc-headless',
    // exploration (lot perf) : sondes non bloquantes, @exploration — voir tests/catalogue.js
    'spec-perf', 'limites-sondes', 'spec-limites', 'spec-rendu', 'spec-maillage',
    // vague 2 : contrats figés partagés par B1 à B4 (docs/vague-2/)
    'spec-contrats-vague2', 'spec-contrats-archi', 'spec-archi-vehicules', 'spec-parties-fichier', 'spec-poste', 'spec-archi-env', 'spec-archi-reseau', 'spec-workers',
    // vague 2 : B1 — inventaire et conteneurs serveur (SPEC-SYNC-007 à 017)
    'spec-conteneurs',
    // vague 2 : B4 — PvP, enjeux et sanctions (SPEC-PVP-001 à 006)
    'spec-pvp',
    // SPEC-BANC-010 (filet anti-blocage unifié) : crochets git, hors spec-banc.js
    'spec-crochets',
    // historique global (SPEC-BANC-033 à 040) : logique pure de tools/historique.js
    'spec-historique',
    // périmètre d'exécution des tests (SPEC-BANC-067 à 076) : carte d'impact, calcul, repli, crochets
    'spec-perimetre',
    // rétention du registre et score d'instabilité (SPEC-BANC-088, 090, 091)
    'spec-retention',
    // journal MC.Journal (SPEC-BANC-104 à 110) : module pur, puis vérifications sur disque
    'spec-journal', 'spec-journal-statique',
    // jouabilité / synchro client-serveur (SPEC-JOUABLE-004, 006, 007, 009) : analyse des e2e, jeter, audits
    'spec-jouabilite',
    // L40-bis B : identifiants figés, plages déclarées, état borné (SPEC-SAVE-019 à 021)
    'spec-ids',
    // L40-bis, lot A : registre des champs porteurs d'ids (SPEC-SAVE-018) et ids de bloc inconnus (SPEC-SAVE-028)
    'spec-migration-ids',
    // L40-bis C (SPEC-SAVE-023, 024) : état borné par bloc, état 0 appliqué chez le client, audit de game.js
    'spec-l40-reseau',
    // travaux du serveur sous budget par tic : génération par tranches, lieux, sauvegarde, attente du sol
    'spec-travaux-serveur',
    // SPEC-SERVEUR-008 : server.js découpé en modules (src/serveur-*.js) — audit et tests de chaque module
    'spec-serveur-modules',
    // historique global : vues, séries, inscription depuis le banc, préréglages et crochets (SPEC-BANC-004, 006, 041 à 058)
    'spec-historique-vues',
    // banc de tests, 2e moitié : répartition et sélection regroupée (SPEC-BANC-063 à 065)
    'spec-banc-repartition'];
  // fichiers qui lisent le disque dès leur chargement (voir l'en-tête)
  var NODE_SEUL = { 'spec-banc': true, 'spec-banc-headless': true, 'spec-archi-env': true, 'spec-archi-reseau': true, 'spec-crochets': true, 'spec-historique': true, 'spec-perimetre': true, 'spec-retention': true, 'spec-journal-statique': true, 'spec-jouabilite': true, 'spec-l40-reseau': true, 'spec-serveur-modules': true, 'spec-historique-vues': true, 'spec-banc-repartition': true };

  G.MC_FICHIERS_TESTS = NOMS.map(function (f) { return NODE_SEUL[f] ? { f: f, node: true } : { f: f }; });
})(typeof globalThis !== 'undefined' ? globalThis : this);
