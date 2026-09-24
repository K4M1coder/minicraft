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
| **G13** | Les crochets git citent un préréglage du catalogue de tests, existant et non vide (SPEC-BANC-006) | oui |
| **G14** | 100 % des tests, y compris les end-to-end, ont une fiche déclarée ou déduite d'une spec citée (SPEC-BANC-002) | oui |

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
| **L14** | Correctifs : lumière du ciel, ombres (soleil, nuages, près et loin), habitants tués qui le restent, reproduction | `LUMIERE` `OMBRE` `POP` | à faire |
| **L15** | Eau : rivières, cascades, écoulement, six ondulations, sens courant + vent | `EAU` | à faire |
| **L16** | Vent : par altitude, végétation qui ondule, buissons et prairies, brume | `VENT` | à faire |
| **L17** | Relief : transitions progressives, paysages vastes, volcans cohérents (sommets, chaînes, éteints, types) | `BIOME` `RELIEF` | à faire |
| **L18** | Peuplement et routes : habitabilité, échelles réalistes, routes de commerce et de tourisme, ponts, bâtiments sur le relief | `HABITAT` `ROUTE` | à faire |
| **L19** | Identités : variantes procédurales des bâtiments, donjons à salles et niveaux, créatures détaillées et animées | `HABITAT` `DONJON` `MOB` | à faire |
| **L20** | Rendu lointain : imposteurs, silhouettes des villes, perspective atmosphérique, option réaliste | `VUE` | à faire |
| **L21** | Trois archétypes d'histoires procédurales : épopée, enquête, colonie | `HISTOIRE` | à faire |
| **L22** | Couverture : portes, trappes, échelles, lianes, combat (PvE, PvP), physique, véhicules, recettes, butins, succès, options, commandes | `PORTE` `COMBAT` `PHYS` `RECETTE` `DROP` `SUCCES` `OPTION` `CMD` | à faire |
| **L35** | Profondeurs : flore et récifs sous-marins, biomes souterrains (créatures, donjons, ruines, mines), bioluminescence, tous les minerais | `MER` `SOUTERRAIN` `LUMIERE` `MINERAI` | à faire |
| **L36** | Ambiance sonore complète et spatialisée : environnement, créatures, actions, interactions, événements (absorbe la proposition L30) | `AUDIO` | à faire |
| **L23** | Saisons (validé) : journée de 20 minutes, année de 3 heures en quatre saisons, durée du jour, températures, neige, feuillages, gel des lacs, cultures en saison | `SAISON` | à faire |
| **L38** | Carte de densité (vierge, rurale, urbaine, hyperurbaine) combinée aux biomes et à l'environnement, mégapoles, hiérarchie des routes et rivières navigables, zones de jeu PvP/PvE/PvP seul/PvE seul/sûres ; prolonge L18 (en cours) et complète COMBAT-002, HABITAT-010/011, ROUTE-006 | `DENSITE` `HABITAT` `ROUTE` `ZONE` | à faire |
| **L39** | Factions PNJ autonomes (objectifs, actions, territoires, relations, quêtes) et factions de joueurs (création, rangs, candidatures, départ, une principale et des secondaires, canal, diplomatie, persistance) | `FACTION` | à faire |
| **L40** | Technique (préalable à L24, L29, MER-010/011) : blocs sur 16 bits avec états (orientation, moitié, angles, connexions, énergie) et migration des sauvegardes — les 128 identifiants de bloc sont épuisés | `SAVE` | à faire |
| **L41** | Options d'affichage : choix du GPU, résolutions (800×600 à 4K, native), plein écran, choix de l'écran, affichage étendu sur deux ou trois écrans horizontaux ou verticaux | `OPTION` | à faire |
| **L42** | Outillage de test : catalogue classé (type, domaine, groupe, étiquettes) et fiche de chaque test (quoi, pourquoi, attendu), sélection combinable, préréglages partagés par le banc, la ligne de commande et les crochets (commit, pr, régression, bugs, en cours), progression en temps réel, banc navigateur en quadrants avec résumé fixe, captures clés, métriques et cahier de test conservé | `BANC` | à faire |
| **L24** | Construction fine et intérieurs (validé) : escaliers, dalles, toitures à angles automatiques, raccords, verre, colorants, matériaux, feu et fumée, intérieurs meublés, mobilier à fabriquer, livres et notes — après L40 | `CONSTR` `INTERIEUR` | à faire |
| **L25** | Objets (validé) : tissu et armures, armes, gemmes et bijoux, nourriture et cuisine, coffres piégés et surprises | `OBJET` | à faire |
| **L29** | Mécanismes et électricité (validé) : distributeurs, pistons, générateurs éolien/hydro/thermique, câbles, batteries, portes logiques, détecteurs, appareils, blocs de commande — après L40 | `MECA` | à faire |
| **L37** | Version empaquetée (exécutables et archive portable), paramètres de lancement, serveur dédié persistant, console web d'administration (joueurs, positions, inventaires, actions, IP, sessions), listes blanche et noire (noms, e-mails), liens d'invitation, modérateurs (sanctions sans accès aux données personnelles), panneau admin côté client | `PACK` `SERVEUR` `ADMIN` | à faire |
| **L43** | Synchronisation permanente : inventaire, équipement, craft et conteneurs autoritaires côté serveur, véhicules simulés en ligne, persistance du joueur (déconnexion/relance), commerce PNJ (`TROC`), politique et guildes envoyées au join, objets au sol répliqués | `SYNC` | à faire |
| **L44** | Sécurité et fiabilité du serveur : rattrapage des exceptions, tampon et anti-flood bornés, portée vérifiée avant génération, jetons admin cryptographiques, en-têtes HTTP, sauvegarde atomique et asynchrone, purge des structures d'administration, découpage de `server.js` en modules, diffusion sans délai d'une redéfinition de zone | `SECU` `SERVEUR` | à faire |
| **L45** | Économie vivante, progression des métiers et transport : prix dynamique borné, puits de monnaie, caravanes marchandes avec cargaison réelle, carburant et réparation des véhicules, risque d'attaque, péages de faction | `ECO` `METIER` `TRANSPORT` | à faire |
| **L46** | Factions, quêtes, PvP et environnement interconnectés : territoire agissant sur les zones de jeu, embargo commercial en guerre, quêtes nées d'un besoin réel, enjeux et sanctions PvP, catastrophes qui endommagent bâtiments/routes/population, donjons rattachés au territoire | `FACTION` `QUETE` `PVP` `ENV` `DONJON` | à faire |
| **L47** | Performance de génération et de maillage : bruit interpolé en cache, greedy meshing, génération et maillage en Web Workers, métriques et panneau F3 | `PERF` | à faire |
| **L48** | Rendu fiable et adaptatif : contexte WebGL perdu/restauré, réfraction et antialias/DPR pilotés par le FPS, mobs instanciés, détection d'un rendu logiciel, culling de chunks | `RENDU` | à faire |

Les lots L14 à L22 sont **spécifiés d'avance** dans `SPECS.md` (état ⏳) : la
porte G1 ne les exige qu'une fois implémentés. Chaque lot passe ses specs à ✅
dans le commit qui les livre. L14 passe en premier parce qu'il corrige des
défauts visibles (grottes éclairées, absence d'ombres, habitants ressuscités) ;
L15 à L17 touchent le monde généré, sur lequel L18 et L19 bâtissent ; L20
s'appuie sur ce qui est généré ; L21 sur les lieux ; L22 couvre l'ensemble.

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
- **Specs corrigées** par la revue de cette vague (SYNC-007 à 015, 017, 023 ;
  ECO-001, 003 à 006 ; PVP-001 à 006 ; PERF-004 à 010, 014) et deux trous
  ajoutés pour la vague 3 : SPEC-SYNC-027 (présentoirs visibles de tous) et
  SPEC-SYNC-028 (pose et tir validés contre l'inventaire serveur).

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
