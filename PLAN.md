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
| **L23** | **Saisons** : printemps, été, automne, hiver sur une année de jeu — feuillages qui roussissent puis tombent, neige saisonnière, lacs gelés l'hiver, durée du jour qui varie, cultures qui ne poussent qu'en saison | `SAISON` |
| **L24** | **Construction fine** : escaliers, dalles, clôtures et portillons, vitres, lits (dormir fait passer la nuit et fixe le point de réapparition), panneaux où l'on écrit | `BLOC` `LIT` |
| **L25** | **Armures et équipement** : casque, plastron, jambières, bottes en cuir, fer, diamant ; réduction des dégâts, usure, visibles sur l'avatar | `ARMURE` |
| **L26** | **Agriculture et élevage** : plusieurs cultures (carottes, pommes de terre, citrouilles, canne), arrosage par proximité de l'eau, nourrir les animaux pour les faire se reproduire, enclos | `CULTURE` `ELEVAGE` |
| **L27** | **Économie vivante** : prix des habitants qui varient avec l'offre et la demande, spécialités régionales, commerce entre villes par les caravanes des routes, monnaie | `ECO` |
| **L28** | **Faune sociale** : troupeaux et meutes, migrations d'oiseaux, chaîne alimentaire (loups et moutons), pêche à la canne | `FAUNE` `PECHE` |
| **L29** | **Mécanismes** : leviers, boutons, plaques de pression, portes et trappes automatiques, rails alimentés | `MECA` |
| **L30** | **Son spatial** : sons positionnés en 3D, ambiances par biome et par lieu (forêt, ville, grotte, mer), musique procédurale selon le moment et l'histoire | `AUDIO` |
| **L31** | **Accessibilité** : sous-titres des sons, modes daltoniens, taille du texte et du HUD, commandes tactiles | `ACCES` |
| **L32** | **Serveur persistant** : le monde du serveur sauvegardé entre deux démarrages, profils de joueurs, chat de proximité, histoires jouées en coopération | `NET` `HISTOIRE` |
| **L33** | **Performances** : génération et maillage dans des Web Workers, maillage glouton (greedy meshing), pour allonger encore la distance de vue | `PERF` |
| **L34** | **Commandes pures** : les commandes du chat extraites de `game.js` dans un module pur testable (préalable à `SPEC-CMD-001`), et commandes d'administration du serveur | `CMD` |
