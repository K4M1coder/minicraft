# Plan de développement — MiniCraft

Méthode : **Spec-Driven Development + TDD**. Rien n'est implémenté avant d'être
spécifié, et rien n'est spécifié sans être vérifiable.

---

## 1. Boucle de travail

Pour chaque comportement attendu, le cycle est strictement le suivant :

| Étape | Action | Preuve produite |
|---|---|---|
| **S1** | Écrire la spec dans `SPECS.md` avec un identifiant `SPEC-<DOMAINE>-<NNN>` | une ligne de spec vérifiable |
| **S2** | Valider la spec : sans ambiguïté, observable, falsifiable | relecture (agent ou soi) |
| **S3** | Écrire le test qui cite l'identifiant — **il doit échouer** | test rouge |
| **S4** | Implémenter le minimum pour faire passer le test | test vert |
| **S5** | Relire et refactoriser à tests verts | diff propre |
| **S6** | Passer les portes de qualité | `node tests/gates.js` vert |
| **S7** | Commit la tache | entrée dans l'historique |

Une spec non couverte par un test est un échec de la porte G1 : le projet
refuse d'être déclaré vert.

### Ce qui compte comme « spec vérifiable »

- ✅ « Un zombie à moins de 1,3 bloc inflige ses dégâts au plus une fois par 1,1 s »
- ❌ « Le combat doit être agréable » (non falsifiable)
- ❌ « Le zombie attaque » (non observable : quelle portée, quelle cadence ?)

---

## 2. Portes de qualité

Exécutées par `node tests/gates.js`. Toute porte rouge bloque le commit.

| Porte | Règle | Automatisée |
|---|---|---|
| **G1** | Toute spec de `SPECS.md` est citée par au moins un test | oui |
| **G2** | Tout test cite une spec existante (pas d'identifiant fantôme) | oui |
| **G3** | 100 % des tests Node passent | oui |
| **G4** | Tous les fichiers de `src/` sont syntaxiquement valides | oui |
| **G5** | Aucun module de logique pure ne référence `THREE`, `document`, `window` | oui |
| **G6** | Toute fonction exportée d'un module pur est citée par un test | oui |
| **G7** | 100 % des tests end-to-end passent dans le navigateur | manuelle (page de tests) |
| **G8** | Aucune erreur console au chargement du jeu | manuelle (navigateur) |
| **G9** | 55 images/s au minimum en jeu, écran partagé compris | manuelle (mesure e2e) |
| **G10** | La version suit le versionnage sémantique et CHANGELOG.md la publie | oui (et crochet pre-commit) |
| **G11** | Les crochets git sont branchés et la règle du cran est juste | oui |
| **G12** | Budget de performance de la génération (lot perf, `tests/bench-generation.js`) | oui |
| **G13** | Les crochets git citent un préréglage du catalogue de tests, existant et non vide (SPEC-BANC-006) ; étendue par le lot BANC (historique global, §3.6) : `pre-commit` calcule un périmètre non vide, `pre-push` et `pre-merge-commit` citent la suite complète (SPEC-BANC-075) | oui |
| **G14** | 100 % des tests, y compris les end-to-end, ont une fiche déclarée ou déduite d'une spec citée (SPEC-BANC-002) ; étendue par le lot BANC : 100 % des tests ont aussi au moins un domaine et une fonction, déclarée ou observée (SPEC-BANC-066) | oui |
| **G15** | Chaque test e2e du cahier produit au moins deux captures réelles, début et fin (SPEC-BANC-026/027) | oui |
| **G16** | *(prévue, lot BANC — historique global, §3.14)* Aucun `console.*` direct dans `src/` ou `server.js` hors de `src/journal.js` : tout passe par `MC.Journal` (SPEC-BANC-110) | prévue |

### Commits et versions

Les bonnes pratiques retenues, et ce qui les fait respecter :

- **Commits conventionnels** : `type(portée)!: résumé`, types `feat` `fix` `perf`
  `refactor` `docs` `test` `chore` `build` `ci` `style` `revert` `specs` ; `!` ou un
  pied `BREAKING CHANGE:` signale une rupture. *Crochet commit-msg.*
- **Journal** : tout `feat`, `fix` ou `perf` qui touche au code ajoute sa ligne sous
  « Non publié » dans CHANGELOG.md (format Tenez un Changelog), dans le même commit.
  *Crochet commit-msg.*
- **Version** : `X.Y.Z`, de 1 à 5 chiffres chacun ; elle ne bouge **que** dans un
  commit de publication `chore(release): vX.Y.Z`, à la fin d'une tâche, produit par
  `node tools/version.js --publier`, qui calcule le cran d'après les commits depuis la
  dernière étiquette — rupture → X (Y tant que X vaut 0), `feat` → Y, `fix`/`perf` → Z,
  le reste ne publie rien — date la section du journal, commite et pose l'étiquette
  `vX.Y.Z`. `--prevoir` montre ce qu'il ferait. *Crochet commit-msg (refus d'une
  version changée hors publication) ; G10 et crochet pre-commit (accord jeu ↔ journal).*
- **Contrôles rapides à chaque commit** : syntaxe des .js indexés, marqueurs de
  conflit oubliés, accord de version. *Crochet pre-commit.* La suite complète reste
  `node tests/gates.js`, avant chaque publication.
- Les crochets vivent dans `.githooks/` (versionnés) ; `node tools/version.js --installer`
  les branche (`core.hooksPath`) et G11 vérifie qu'ils le sont. Les agents, dans leurs
  worktrees, partagent la configuration du dépôt : ils y sont soumis aussi.

G5 mérite un mot : c'est cette porte qui garantit que la logique reste
exécutable sous Node. Sans elle, une seule référence à `window` glissée dans
`world.js` ferait s'effondrer toute la stratégie de test.

---

## 3. Lots de travail

Chaque lot suit le cycle S1→S7 et se termine par un commit.

| Lot | Contenu | Domaine de spec | État |
|---|---|---|---|
| **L0** | Outillage : `SPECS.md`, `gates.js`, dépôt git | — | fait |
| **L1** | Correctifs issus de l'audit de code | `AUDIT` | fait |
| **L2** | Modes créatif / survie | `MODE` | fait |
| **L3** | Quatre difficultés, dont cauchemar (effacement à la mort) | `DIFF` | fait |
| **L4** | Parties multiples, menu, choix de la graine | `SAVE` | fait |
| **L5** | Armes : ficelle, arc, flèches, projectiles | `ARME` | fait |
| **L6** | Chat | `CHAT` | fait |
| **L7** | Écran partagé 2 à 4 joueurs locaux | `SPLIT` | fait |
| **L8** | Multijoueur client/serveur | `NET` | fait |
| **L9** | Menus (parties, création, multijoueur), documentation | `MENU` | fait |
| **L10** | Corps solides, nage, grille 3×3, livre des recettes et des objets | `IA` `COLL` `NAGE` `GRILLE` `LIVRE` | fait |
| **L11** | Biomes, mer, faune, donjons à gardiens, véhicules | `BIOME` `MER` `FAUNE` `DONJON` `VEHIC` | fait |
| **L12** | Ciel, textures, relief, carte, factions, serveur autoritaire | `CIEL` `TEXTURE` `RELIEF` `CARTE` `FACTION` `SYNC` | fait |
| **L13** | Vue lointaine, lumière des blocs, météo, villes et villages, mode histoire | `VUE` `LUMIERE` `METEO` `NUAGE` `HABITAT` `HISTOIRE` | fait |
| **L14** | Correctifs : lumière du ciel, ombres (soleil, nuages, près et loin), habitants tués qui le restent, reproduction | `LUMIERE` `OMBRE` `POP` | fait |
| **L15** | Eau : rivières, cascades, écoulement, six ondulations, sens courant + vent | `EAU` | fait |
| **L16** | Vent : par altitude, végétation qui ondule, buissons et prairies, brume | `VENT` | fait |
| **L17** | Relief : transitions progressives, paysages vastes, volcans cohérents (sommets, chaînes, éteints, types) | `BIOME` `RELIEF` | fait |
| **L18** | Peuplement et routes : habitabilité, échelles réalistes, routes de commerce et de tourisme, ponts, bâtiments sur le relief | `HABITAT` `ROUTE` | fait |
| **L19** | Identités : variantes procédurales des bâtiments, donjons à salles et niveaux, créatures détaillées et animées | `HABITAT` `DONJON` `MOB` | fait |
| **L20** | Rendu lointain : imposteurs, silhouettes des villes, perspective atmosphérique, option réaliste | `VUE` | fait |
| **L21** | Trois archétypes d'histoires procédurales : épopée, enquête, colonie | `HISTOIRE` | fait |
| **L22** | Couverture : portes, trappes, échelles, lianes, combat (PvE, PvP), physique, véhicules, recettes, butins, succès, options, commandes | `PORTE` `COMBAT` `PHYS` `RECETTE` `DROP` `SUCCES` `OPTION` `CMD` | fait |
| **L35** | Profondeurs : flore et récifs sous-marins, biomes souterrains (créatures, donjons, ruines, mines), bioluminescence, tous les minerais | `MER` `SOUTERRAIN` `LUMIERE` `MINERAI` | à faire |
| **L36** | Ambiance sonore complète et spatialisée : environnement, créatures, actions, interactions, événements (absorbe la proposition L30) | `AUDIO` | à faire |
| **L23** | Saisons (validé) : journée de 20 minutes, année de 3 heures en quatre saisons, durée du jour, températures, neige, feuillages, gel des lacs, cultures en saison | `SAISON` | à faire |
| **L38** | Carte de densité (vierge, rurale, urbaine, hyperurbaine) combinée aux biomes et à l'environnement, mégapoles, hiérarchie des routes et rivières navigables, zones de jeu PvP/PvE/PvP seul/PvE seul/sûres ; prolonge L18 (en cours) et complète COMBAT-002, HABITAT-010/011, ROUTE-006 | `DENSITE` `HABITAT` `ROUTE` `ZONE` | à faire |
| **L39** | Factions PNJ autonomes (objectifs, actions, territoires, relations, quêtes) et factions de joueurs (création, rangs, candidatures, départ, une principale et des secondaires, canal, diplomatie, persistance) | `FACTION` | à faire |
| **L40** | Technique (préalable à L24, L29, MER-010/011) : blocs sur 16 bits avec états (orientation, moitié, angles, connexions, énergie) et migration des sauvegardes — les 128 identifiants de bloc sont épuisés | `SAVE` | à faire |
| **L41** | Options d'affichage : choix du GPU, résolutions (800×600 à 4K, native), plein écran, choix de l'écran, affichage étendu sur deux ou trois écrans horizontaux ou verticaux | `OPTION` | à faire |
| **L42** | Outillage de test : catalogue classé (type, domaine, groupe, étiquettes) et fiche de chaque test (quoi, pourquoi, attendu), sélection combinable, préréglages partagés par le banc, la ligne de commande et les crochets (commit, pr, régression, bugs, en cours), progression en temps réel, banc navigateur en quadrants avec résumé fixe, captures clés, métriques et cahier de test conservé | `BANC` | à faire |
| **BANC** | Historique global, périmètre, diagnostics, journal (docs/banc/historique-global.md, prolonge L42) : zone « Historique » du banc (tableau, tri multi-clés, filtres par type, colonnes choisies, pagination serveur, export), graphiques timeline, diaporama par image ouvert au clic, témoin et comparaison, inscription manuelle depuis le banc, fiche avant résultats et répartitions, périmètre d'exécution (carte d'impact, `tools/perimetre.js`, crochets, trous de périmètre, G13 étendue), étapes et triplets d'images, rendu reproductible et moteur de rendu, métriques de performance, score d'instabilité, raison obligatoire, rétention, diagnostics d'échec/lenteur (CPU, GPU en couches), journal `MC.Journal` (G16), campagnes sur l'historique des merges/PR/releases — voir découpage détaillé ci-dessous | `BANC` | à faire |
| **L24** | Construction fine et intérieurs (validé) : escaliers, dalles, toitures à angles automatiques, raccords, verre, colorants, matériaux, feu et fumée, intérieurs meublés, mobilier à fabriquer, livres et notes — après L40 | `CONSTR` `INTERIEUR` | à faire |
| **L25** | Objets (validé) : tissu et armures, armes, gemmes et bijoux, nourriture et cuisine, coffres piégés et surprises | `OBJET` | à faire |
| **L29** | Mécanismes et électricité (validé) : distributeurs, pistons, générateurs éolien/hydro/thermique, câbles, batteries, portes logiques, détecteurs, appareils, blocs de commande — après L40 | `MECA` | à faire |
| **L37** | Version empaquetée (exécutables et archive portable), paramètres de lancement, serveur dédié persistant, console web d'administration (joueurs, positions, inventaires, actions, IP, sessions), listes blanche et noire (noms, e-mails), liens d'invitation, modérateurs (sanctions sans accès aux données personnelles), panneau admin côté client | `PACK` `SERVEUR` `ADMIN` | à faire |
| **L43** | Synchronisation permanente : inventaire, équipement, craft et conteneurs autoritaires côté serveur, véhicules simulés en ligne, persistance du joueur (déconnexion/relance), commerce PNJ (`TROC`), politique et guildes envoyées au join, objets au sol répliqués | `SYNC` | à faire |
| **L44** | Sécurité et fiabilité du serveur : rattrapage des exceptions, tampon et anti-flood bornés, portée vérifiée avant génération, jetons admin cryptographiques, en-têtes HTTP, sauvegarde atomique et asynchrone, purge des structures d'administration, découpage de `server.js` en modules, diffusion sans délai d'une redéfinition de zone | `SECU` `SERVEUR` | à faire |
| **L45** | Économie vivante, progression des métiers et transport : prix dynamique borné, puits de monnaie, caravanes marchandes avec cargaison réelle, carburant et réparation des véhicules, risque d'attaque, péages de faction | `ECO` `METIER` `TRANSPORT` | à faire |
| **L46** | Factions, quêtes, PvP et environnement interconnectés : territoire agissant sur les zones de jeu, embargo commercial en guerre, quêtes nées d'un besoin réel, enjeux et sanctions PvP, catastrophes qui endommagent bâtiments/routes/population, donjons rattachés au territoire | `FACTION` `QUETE` `PVP` `ENV` `DONJON` | à faire |
| **L47** | Performance de génération et de maillage : bruit interpolé en cache, greedy meshing, génération et maillage en Web Workers, métriques et panneau F3 | `PERF` | fait |
| **L48** | Rendu fiable et adaptatif : contexte WebGL perdu/restauré, réfraction et antialias/DPR pilotés par le FPS, mobs instanciés, détection d'un rendu logiciel, culling de chunks | `RENDU` | à faire |
| **L50** | Architecture serveur unique (Node requis, même en solo) : un processus serveur de jeu démarre toujours ; il n'écoute le réseau que si explicitement ouvert (boucle locale, contrôle d'origine, ouverture à chaud) ; pause exacte et sauvegarde immédiate en local fermé au réseau ; parties sur disque, import des parties existantes ; élimination des 49 branches `net.enLigne()` de `game.js` ; portage serveur de l'histoire, des succès et des véhicules | `ARCHI` | à faire |

Les lots L14 à L22 sont désormais **fait** : toutes leurs fiches SPEC sont à
l'état ✅ dans `SPECS.md`, chacune citée par au moins un test (`tests/spec-eau.js`,
`tests/spec-vent.js`, `tests/spec-ombres.js`, `tests/spec-population.js`,
`tests/spec-climat.js`, `tests/spec-recits.js`, `tests/spec-batiments.js`, etc.)
et par le code source correspondant (`src/eau.js`, `src/meteo.js`, `src/ombres.js`,
`src/routes.js`, `src/habitats.js`, `src/donjons.js`, `src/volcanisme.js`,
`src/lointain.js`, `src/histoire.js`, `src/recits.js`…), vérifié le 2026-09-25
par lecture du code (pas seulement des ✅ déclaratifs) — voir `src/recits.js`
pour les trois archétypes d'histoire (`ARCHETYPES = { epopee, enquete, colonie }`,
chacun avec ses propres mécaniques). Deux fiches ponctuelles restent ⏳, classées
dans L46 (pas un manque de L14-L22) : SPEC-DONJON-017 (régénération d'un coffre
pillé) et SPEC-DONJON-018 (donjon rattaché au territoire d'une faction). L14 est
passé en premier parce qu'il corrigeait des défauts visibles (grottes éclairées,
absence d'ombres, habitants ressuscités) ; L15 à L17 touchent le monde généré,
sur lequel L18 et L19 bâtissent ; L20 s'appuie sur ce qui est généré ; L21 sur
les lieux ; L22 couvre l'ensemble.

### Dépendances entre lots

```
L1 ──┬── L2 ── L3 ──┬── L4
     │              │
     ├── L5         ├── L7 ──┐
     │              │        ├── L8
     └── L6 ────────┘────────┘
```

L7 (écran partagé) doit précéder L8 (réseau) : le passage à N joueurs locaux
impose la refonte qui rend ensuite les joueurs distants triviaux à ajouter.
L'inverse obligerait à refaire le travail deux fois.

### Vagues d'implémentation — L43 à L48

Le détail par lot (fichiers possédés, messages `NP.MSG.*`, structures de
données) est dans `docs/design-lots.md`. Ces six lots touchent en grande
partie `server.js` (L43, L44, une partie de L46) : au plus 4 sous-lots
tournent en parallèle, et le découpage de `server.js` en modules
(SPEC-SERVEUR-008, fin de L44) passe **après** tous les lots qui modifient ce
fichier, pas seulement ceux de son propre lot.

- **Vague 1** (4 en parallèle, fichiers disjoints) : fiabilité transport
  (L44, `server.js` bas niveau + `net-protocol.js`), bruit et génération
  (L47), greedy meshing (L47), fiabilité/adaptatif du rendu (L48).
- **Vague 2** (4 en parallèle, dépend de la vague 1) : inventaire et
  conteneurs serveur (L43, `server.js` routage applicatif), économie et
  métiers (L45), Workers génération+maillage (L47), PvP enjeux et sanctions
  (L46, `server.js` zone combat).
- **Vague 3** (3 en parallèle, dépend de la vague 2) : persistance joueur et
  véhicules (L43/L44, `server.js` zone persistance), transport et fret (L45),
  factions/environnement/donjons/quêtes (L46).
- **Vague 4** (dernière) : sécurité périphérique — jetons, en-têtes HTTP,
  `Origin`, diffusion de zone (L44) — puis, une fois toutes les vagues
  précédentes fusionnées dans `server.js`, le découpage en modules purs
  (SPEC-SERVEUR-008).

#### Vague 2 — plan d'exécution

Détail exécutable dans `docs/vague-2/` : [README](docs/vague-2/README.md)
(dépendances réelles, ordre, zones de `server.js` par lot avec leurs lignes,
stratégie de fusion, critères de fin, risques) et un fichier par sous-lot —
[B1](docs/vague-2/B1.md) inventaire et conteneurs serveur,
[B2](docs/vague-2/B2.md) économie et métiers (commerce par `TROC`),
[B3](docs/vague-2/B3.md) génération et maillage en Web Workers,
[B4](docs/vague-2/B4.md) PvP enjeux et sanctions. Les interfaces communes
sont figées en code dans `src/contrats-vague2.js` (`MC.ContratsV2`, testé par
`tests/spec-contrats-vague2.js`) : les quatre agents codent contre lui sans
le modifier. En bref :

- **Prérequis** : fusionner le greedy meshing (A3, pas encore dans master)
  avant de lancer B3.
- **Parallélisme** : les quatre sous-lots démarrent ensemble. B2 et B4 ne
  dépendent de B1 que pour leur branchement en ligne (inventaire serveur
  réel) : ils codent leurs modules purs et leurs handlers contre le contrat
  et les fonctions serveur que B1 s'engage à exposer, puis se rebasent.
- **Fusion** : B3 dès qu'il est prêt ; puis B1 → B2 → B4, portes vertes et
  revue adversariale avant chaque fusion ; publication en fin de vague.
- **État au 2026-09-25** :
  - B2 (économie, métiers, `TROC` en ligne) fusionné, fiches ECO, METIER et SYNC-023 ✅ ;
  - B3 (Web Workers de génération et de maillage) fusionné, fiches PERF-004 à 010 et 014 ✅ ;
  - B1 (inventaire autoritaire et conteneurs serveur) fusionné, relectures adversariales comprises, fiches SYNC-007 à 017 ✅ et SYNC-021 pour sa partie inventaire et conteneurs ;
  - B4 (PvP : enjeux et sanctions) en cours ;
  - en avance sur les vagues 3 et 4, des fiches courtes à fichiers isolés sont traitées en parallèle (SECU-009 à 011, SERVEUR-005 et 007, FACTION-016 et 017, QUETE-001 et 002, ENV-003, TRANSPORT-001), sans toucher aux zones de `server.js` des lots en cours ; le découpage de `server.js` (SERVEUR-008) reste en dernier.
- **Specs corrigées** par la revue de cette vague (SYNC-007 à 015, 017, 023 ;
  ECO-001, 003 à 006 ; PVP-001 à 006 ; PERF-004 à 010, 014) et deux trous
  ajoutés pour la vague 3 : SPEC-SYNC-027 (présentoirs visibles de tous) et
  SPEC-SYNC-028 (pose et tir validés contre l'inventaire serveur).

#### Vague ARCHI — plan d'exécution (L50)

Décidé par l'utilisateur : le solo n'est plus un chemin de code séparé, c'est
« toujours un serveur, ouvert ou non au réseau ». **Node devient requis pour
jouer, même seul.** Détail exécutable dans
[docs/archi-solo-serveur/README.md](docs/archi-solo-serveur/README.md)
(49 occurrences de `net.enLigne()` ligne par ligne, zones de `game.js` par lot,
évaluation chiffrée de la sauvegarde, contrat gelé, fusion, critères de fin).
Fiches : SPEC-ARCHI-001 à 042. Lots, dans l'ordre :

| Lot | Contenu | Fiches | Dépend de |
|---|---|---|---|
| **A0-pré** | bouton « Exporter mes parties » dans le client actuel (les parties `localStorage` ne se partagent pas entre origines) | 015 (b) | — |
| **A0** | fondation, un seul agent, phases commitées : `src/contrats-archi.js` + `tests/spec-contrats-archi.js` (messages `PAUSE`, `PAUSE_ETAT`, `RESEAU`, `RESEAU_ETAT`, `ARRET`, `DORMIR`, `HISTOIRE_ETAT`, `SUCCES_DEBLOQUE`, `ETAT_RESEAU`) → serveur local (loopback, Origin, port stable, réseau à chaud, arrêt sans orphelin, un poste en fermé) → pause exacte et sauvegardes → parties sur disque, parité de persistance, import → lancement, page d'erreur, `tools/paquet.js`, README → écran d'attente, budgets de démarrage et de latence → aiguillage de `game.js` (`frame()` et `appliquerActionCommande` découpées par thème, sans changement de comportement) | 001 à 020, 039 (l. 653) | A0-pré |
| **B-ENV** | tornades et foudre par le serveur, suppression des bombes volcaniques, peuplement, heure et sommeil serveur (`DORMIR`), simulation du monde et cultures (SYNC-018), fabrication et cultures | 022, 023, 024, 025, 034, 035 | A0 |
| **B-VIE** | survie, combat et butin, duel | 026, 027, 028 | A0 |
| **B-INV** | conteneurs et fourneaux, inventaire (dont SYNC-026 objets au sol et SYNC-028 pose/tir validés), économie, bloc de commande | 030, 031, 032, 033 | A0 |
| **B-RESEAU** | factions (SYNC-024/025), retrait de `doSave`, prédiction, overrides de chunks, affichage `ETAT_RESEAU`, interpolation | 029, 036, 037, 038, 039 (2629, 2642), 040 | A0 |
| **P-VEH** | portage serveur des véhicules (SYNC-022, SERVEUR-006) | 021 | A0 |
| **P-HIST** | portage serveur du mode histoire | 041 | A0, B-VIE |
| **P-SUCC** | portage serveur des succès | 042 | A0 |

- **Parallélisme** : A0-pré puis A0 seuls ; ensuite au plus 4 agents à la fois
  (règle des 4 Sonnet) : les quatre B ensemble, puis les trois P dès qu'un
  agent se libère (P-SUCC et P-VEH peuvent démarrer dès qu'A0 est fusionné).
- **Fusion** : A0 d'abord (contrat gelé et aiguillage ; sans lui les B se
  marchent dessus sur `frame()`), puis chaque B / P au fil de l'eau, portes
  vertes et revue adversariale avant chaque fusion, conflits résolus en
  gardant les deux côtés. `SPEC-SERVEUR-008` (découpage de `server.js`) passe
  après toute la vague.
- **Publication** : la vague ne se publie PAS tant que P-HIST et P-SUCC ne
  sont pas fusionnés (le mode histoire et les succès, fonctionnels en solo
  aujourd'hui, seraient perdus). Une publication sans P-VEH est permise à
  condition d'être **marquée régressive** (`feat!`, CHANGELOG « Supprimé » :
  véhicules, README « Limites connues » à jour). Les bombes et coulées
  volcaniques sont supprimées dans tous les cas (ARCHI-023, « Supprimé »).
- **Sauvegarde** : évaluation chiffrée et décision (pause et sortie immédiates,
  cadence 45 s en fermé, sauvegarde du dernier client et sur signal ; sauvegarde
  continue rejetée) au § 6 du document de conception.

### Découpage du lot BANC — historique global, périmètre, diagnostics, journal

Conception validée dans `docs/banc/historique-global.md`, découpage repris
tel quel de son §5 ; chaque étape cite ses fiches SPEC-BANC (SPECS.md, L42).
Dépendances : l'étape 0a (format de données) conditionne tout le reste et
passe en premier ; le journal (étape 8) ne dépend d'aucune autre étape et
démarre en parallèle dès le début ; les campagnes sur l'historique des
merges/PR/releases (étape 10) passent en dernier, une fois le moteur
stabilisé par toutes les étapes précédentes.

| Étape | Contenu | Fiches SPEC-BANC | Dépend de |
|---|---|---|---|
| **0a** | Format de données complet : instantané fiche+tags, étapes et triplets d'images, moteur de rendu, métriques, raison obligatoire | 059, 060, 077 à 087, 089 | — (en premier) |
| **0b** | Catalogue : champ `fonctions` déclaré, observation Node, instantané fiche+tags dans cahiers/registre, fiche affichée avant résultats, G14 étendue | 059, 061, 062, 066 | 0a |
| **1** | Routes serveur et index en mémoire, avec tests Node | 040 | 0a, 0b |
| **2** | Tableau : colonnes, tri, filtres, pagination, export | 033 à 039, 063 à 065 | 1 |
| **3** | Graphiques timeline | 041 à 045 | 1, 2 |
| **4** | Panneau test : un diaporama par image, témoin, comparaison | 046 à 052 | 1, 2 |
| **5** | Intégration dans le banc (bouton, clic depuis la sélection), inscription manuelle en fin de campagne, test e2e | 033, 053 à 058 | 2, 3, 4 |
| **6** | Périmètre d'exécution : carte d'impact, `tools/perimetre.js`, crochets pre-commit/pre-push/pre-merge-commit, sélection dans le banc, contrôle des trous de périmètre, G13 étendue | 004 (révisée), 006 (révisée), 010 (révisée), 067 à 076 | 0b (fonctions observées) |
| **7** | Rétention (branchée sur `tools/version.js --publier`) et score d'instabilité des tests | 088, 090, 091 | 6 (carte d'impact pour l'instabilité), 5 (registre) |
| **8** | Journal `MC.Journal` et migration des `console.*`, G16 | 104 à 110 | — (démarre en parallèle dès le début, aucune dépendance) |
| **9** | Diagnostics d'échec et de lenteur, profil CPU et GPU, sur le journal | 092 à 103 | 8 |
| **10** | En dernier, moteur stabilisé : campagnes sur l'historique des merges, PR et releases | 111 à 116 | 1 à 9 (toutes les étapes précédentes) |

---

## 4. Risques identifiés et parades

| Risque | Parade |
|---|---|
| La refonte multi-joueurs casse le solo | Le solo devient « une partie à un joueur local » : même chemin de code, donc testé en permanence |
| Le serveur WebSocket sans dépendance est long à fiabiliser | Le protocole RFC 6455 est implémenté et testé isolément, avant tout usage jeu |
| Le cauchemar efface des données par erreur | L'effacement est une fonction pure testée, appelée à un seul endroit |
| Les manettes sont intestables automatiquement | `navigator.getGamepads` est injecté, donc simulable dans les tests |
| Divergence de simulation entre clients | Autorité serveur explicite, documentée par domaine |

---

## 5. Définition de « terminé »

Une fonctionnalité est terminée quand :

1. ses specs sont écrites et citées par des tests ;
2. tous les tests passent, sous Node **et** dans le navigateur ;
3. les neuf portes sont vertes ;
4. le comportement a été observé manuellement dans le jeu (capture à l'appui) ;
5. le README reflète l'état réel, limites comprises ;
6. c'est commité.

---

## 6. Suite proposée (à valider)

Ces lots ne sont **pas encore spécifiés** : une fois validés, chacun devient une
série de specs ⏳ dans `SPECS.md`, puis suit le cycle S1→S7.

| Lot | Proposition | Specs pressenties |
|---|---|---|
| **L23** | *(validé, voir la table des lots)* **Saisons** : printemps, été, automne, hiver sur une année de jeu — feuillages qui roussissent puis tombent, neige saisonnière, lacs gelés l'hiver, durée du jour qui varie, cultures qui ne poussent qu'en saison | `SAISON` |
| **L24** | *(validé, voir la table des lots)* **Construction fine** : escaliers, dalles, clôtures et portillons, vitres, lits (dormir fait passer la nuit et fixe le point de réapparition), panneaux où l'on écrit | `BLOC` `LIT` |
| **L25** | *(validé, voir la table des lots)* **Armures et équipement** : casque, plastron, jambières, bottes en cuir, fer, diamant ; réduction des dégâts, usure, visibles sur l'avatar | `ARMURE` |
| **L26** | **Agriculture et élevage** : plusieurs cultures (carottes, pommes de terre, citrouilles, canne), arrosage par proximité de l'eau, nourrir les animaux pour les faire se reproduire, enclos | `CULTURE` `ELEVAGE` |
| **L27** | **Économie vivante** : prix des habitants qui varient avec l'offre et la demande, spécialités régionales, commerce entre villes par les caravanes des routes, monnaie | `ECO` |
| **L28** | **Faune sociale** : troupeaux et meutes, migrations d'oiseaux, chaîne alimentaire (loups et moutons), pêche à la canne | `FAUNE` `PECHE` |
| **L29** | *(validé, voir la table des lots)* **Mécanismes** : leviers, boutons, plaques de pression, portes et trappes automatiques, rails alimentés | `MECA` |
| **L30** | *(repris par L36)* **Son spatial** : sons positionnés en 3D, ambiances par biome et par lieu (forêt, ville, grotte, mer), musique procédurale selon le moment et l'histoire | `AUDIO` |
| **L31** | **Accessibilité** : sous-titres des sons, modes daltoniens, taille du texte et du HUD, commandes tactiles | `ACCES` |
| **L32** | **Serveur persistant** : le monde du serveur sauvegardé entre deux démarrages, profils de joueurs, chat de proximité, histoires jouées en coopération | `NET` `HISTOIRE` |
| **L33** | **Performances** : génération et maillage dans des Web Workers, maillage glouton (greedy meshing), pour allonger encore la distance de vue | `PERF` |
| **L34** | **Commandes pures** : les commandes du chat extraites de `game.js` dans un module pur testable (préalable à `SPEC-CMD-001`), et commandes d'administration du serveur | `CMD` |
