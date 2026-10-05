/* presets.js — préréglages nommés du catalogue de tests (SPEC-BANC-004).
   Module PUR (comme catalogue.js) : il ne fait que déclarer des données.
   Chargé AVANT tests/catalogue.js (Node : tests/run.js et tests/gates.js ;
   navigateur : tests/index.html), il pose `globalThis.MC_PRESETS`, que
   `MC_TESTS.PRESETS` relit (voir tests/catalogue.js).

   Chaque préréglage : { nom, description, pour: ['crochet'|'testeur'|'developpeur'],
   criteres }, où `criteres` est la forme attendue par MC_TESTS.selection().

   Cas particulier — `en-cours` : sa sélection dépend de l'état du dépôt git
   (fichiers modifiés depuis la dernière étiquette) et des specs ⏳ de
   SPECS.md, deux choses que ce module PUR ne peut pas lire lui-même (pas de
   `fs`, pas de `child_process` — sinon il ne serait plus utilisable dans le
   navigateur). Son entrée ici porte donc des critères de base (vide) et un
   drapeau `dynamique: 'en-cours'` ; c'est tests/run.js (Node, seul appelant
   qui a un usage réel de ce préréglage aujourd'hui — un crochet ou un CI)
   qui, en le voyant, calcule les domaines à ajouter et les fusionne avant
   d'appeler MC_TESTS.selection(). Documenté ici ET dans tests/run.js. */
(function (G) {
  'use strict';

  G.MC_PRESETS = [
    {
      nom: 'commit',
      description: 'Specs, unitaires et fonctionnels, sans navigateur ni intégration ni tests lents (@lent) ; au crochet pre-commit, restreint au périmètre du commit (tools/perimetre.js), repli sur la suite complète en cas de doute',
      pour: ['crochet', 'developpeur'],
      criteres: { types: ['spec', 'unitaire', 'fonctionnel'], sauf: { etiquettes: ['lent'] } },
    },
    {
      nom: 'pr',
      description: 'Toute la suite Node (unitaire, fonctionnel, spec) plus l\'intégration ; pas le navigateur',
      pour: ['crochet', 'developpeur'],
      criteres: { types: ['spec', 'unitaire', 'fonctionnel', 'integration'] },
    },
    {
      nom: 'regression',
      description: 'Tout le catalogue, sans exception',
      pour: ['testeur'],
      criteres: { tout: true },
    },
    {
      nom: 'bugs',
      description: 'Tests étiquetés @bug-*, quel que soit leur type ou domaine',
      pour: ['testeur', 'developpeur'],
      criteres: { etiquettes: ['bug'] },
    },
    {
      nom: 'en-cours',
      description: 'Specs ⏳ et domaines des fichiers src modifiés depuis la dernière étiquette git (calculé par tests/run.js, voir en-tête de ce fichier)',
      pour: ['developpeur'],
      dynamique: 'en-cours',
      criteres: { domaines: [] },
    },
    {
      nom: 'e2e',
      description: 'Tests end-to-end seulement (navigateur)',
      pour: ['testeur'],
      criteres: { types: ['e2e'] },
    },
    {
      /* SPEC-BANC-025 : une poignée d'e2e rapides et représentatifs
         (démarrage, transition menu → partie, déplacement, inventaire,
         minage), choisis par NOM EXACT pour rester < 2 min même exécutés
         un par un dans le navigateur sans fenêtre (tools/e2e-headless.js
         relance runE2E une fois par nom — voir son en-tête). Sélection par
         `tests` plutôt que par étiquette : tests/e2e.js n'est pas modifié
         par ce lot, donc aucun test n'y porte encore d'étiquette @fumee. */
      nom: 'e2e-fumee',
      description: 'Quelques e2e rapides et représentatifs (< 2 min), sans fenêtre — greffé sur pre-push via le préréglage pr',
      pour: ['crochet'],
      criteres: {
        tests: [
          'le jeu démarre sur le menu principal, monde déjà généré',
          'passer en partie masque le menu',
          'avancer déplace le joueur dans la direction du regard',
          'E ouvre l\'inventaire et libère la souris',
          'maintenir le clic gauche mine le bloc visé',
        ],
      },
    },
    {
      /* Lot « jouabilité / synchro client-serveur » (SPEC-JOUABLE-001 à 009) :
         les e2e de tests/e2e-jouabilite.js (vrai navigateur sans fenêtre, vrai
         serveur de jeu) et leur analyse pure (tests/spec-jouabilite.js). */
      nom: 'jouabilite',
      description: 'Jouabilité : le joueur ne bouge pas tout seul, rien ne s\'annule (blocs, inventaire, coffres) — e2e sur un vrai serveur, plus leur analyse',
      pour: ['testeur', 'developpeur'],
      criteres: { domaines: ['JOUABLE'] },
    },
    {
      nom: 'integration',
      description: 'Tests d\'intégration seulement (vrais sockets, vrai serveur)',
      pour: ['testeur', 'crochet'],
      criteres: { types: ['integration'] },
    },
    {
      nom: 'rapide',
      description: 'Unitaires et fonctionnels seulement, sans les tests lents (@lent)',
      pour: ['developpeur'],
      criteres: { types: ['unitaire', 'fonctionnel'], sauf: { etiquettes: ['lent'] } },
    },
    {
      nom: 'visuel',
      description: 'Tests étiquetés @visuel (comparaison d\'images, rendu)',
      pour: ['testeur'],
      criteres: { etiquettes: ['visuel'] },
    },
    {
      // sondes d'exploration (lot perf) : non bloquantes par nature — elles
      // restent dans commit/pr/regression comme les autres, ce préréglage
      // sert juste à les isoler pour les regarder à part
      nom: 'limites',
      description: 'Sondes d\'exploration (@exploration) : limites et bancs non bloquants',
      pour: ['developpeur', 'testeur'],
      criteres: { etiquettes: ['exploration'] },
    },
  ];
})(typeof globalThis !== 'undefined' ? globalThis : this);
