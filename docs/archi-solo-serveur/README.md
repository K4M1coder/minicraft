# Architecture solo = serveur — plan d'exécution (L50, domaine ARCHI)

Décision de l'utilisateur, non négociable : « aucune différence entre solo et
serveur, en fait c'est toujours avec un serveur, mais il est ouvert ou pas au
réseau ». Ce document détaille l'audit derrière `SPECS.md` § L50
(SPEC-ARCHI-001 à 042) et le découpage exécutable en lots, sur le modèle de
`docs/vague-2/README.md`. Établi contre `master` au commit `03c742b`
(2026-09-29), revu après revue adversariale le 2026-09-30 ; les numéros de
ligne cités s'y rapportent — ils bougeront, les noms de fonctions restent la
référence. Le décompte (49) et les lignes ont été revérifiés par
`grep -n "net\.enLigne()" src/game.js`.

---

## 1. État de départ (vérifié)

### 1.1 Comment le jeu démarre aujourd'hui

- **Solo** : `index.html` servi par un serveur de fichiers (`python -m
  http.server`) ou ouvert en `file://`. Aucun `server.js`. `src/game.js`
  simule tout dans le navigateur ; rien ne passe par `net-protocol.js` tant
  que le joueur ne choisit pas « Rejoindre ». Les parties vivent dans
  `localStorage` (`MC.Saves`, `MC.Save.serialize`, `src/save.js`), avec
  sauvegarde automatique toutes les 60 s et au `beforeunload`.
- **Réseau** : `node server.js` (`serveur.listen(PORT)`, **toutes les
  interfaces**) charge ses modules dans un contexte `vm` et simule le monde à
  60 Hz ; le client bascule via `net.enLigne()`. La persistance est un fichier
  `--monde` (`etatMonde()`), sauvegardé toutes les 120 s
  (`MC_SAUVEGARDE_MS`), à l'arrêt (SIGINT/SIGTERM) et de façon atomique
  (SPEC-SERVEUR-003), écriture asynchrone (SPEC-SERVEUR-004 : c'est
  l'écriture qui est asynchrone, pas la cadence).
- Il n'existe **aucun serveur local fermé au réseau**, aucun mécanisme de pause
  côté serveur (la boucle fait `heure += dt`, `dt = min(écoulé, 0,25)`), aucune
  gestion de parties côté serveur.

### 1.2 Les 49 occurrences de `net.enLigne()` dans `src/game.js`

Par thème, avec la fiche et le lot (la table ligne par ligne est au § 4) :

| Thème | Lignes | Hors ligne aujourd'hui | En ligne aujourd'hui | Fiche | Lot |
|---|---|---|---|---|---|
| Véhicules | 2057 | conduite simulée dans `game.js` | refusée (« pas disponibles en ligne ») ; **depuis P-VEH : simulés par le serveur pour tous (SYNC-022)** | 021 | P-VEH |
| Tornades, foudre | 1044, 1087 | poussée et dégâts calculés côté client | simulés par le serveur (`avancerCatastrophes`) | 022 | B-ENV |
| Bombes et coulées volcaniques | 923, 934 | projectiles et lave posés côté client | aucun équivalent serveur | 023 | B-ENV |
| Peuplement des lieux | 1211 | `peuplerLieux` client | le serveur les fait vivre | 024 | B-ENV |
| Heure et sommeil | 1126, 1955, 2648 | `g.time` modifié, `dormeurs` client | heure serveur (NET-017), sommeil attend les autres joueurs | 025 | B-ENV |
| Vie et survie | 1605, 2783, 2795 | `respawn`, `updateSurvival`, `subirClimat` client | serveur autoritaire (NET-028) | 026 | B-VIE |
| Combat et butin | 2226, 2244, 2256, 2821, 2833, 2990 | `entities.update` local | serveur autoritaire (NET-016) | 027 | B-VIE |
| Duel | 2663 | commande refusée | envoyée au serveur | 028 | B-VIE |
| Factions | 2655 | `g.guildes` local | serveur (SYNC-024/025 ⏳ pour le join) | 029 | B-RESEAU |
| Conteneurs et fourneaux | 1133, 2280, 2575, 2581, 2926, 3039, 3059 | `furnaces`, `world.banque` locaux | SYNC-012 à 017 ✅ | 030 | B-INV |
| Inventaire | 2268, 2359, 2462, 2528, 2986 | `player.state.inv` direct | SYNC-007 à 011 ✅ ; 026, 028 ⏳ | 031 | B-INV |
| Économie | 1172, 3011 | `MC.Economie` client | `TROC` (SYNC-023 ✅) | 032 | B-INV |
| Bloc de commande | 2903, 2912 | direct en créatif | `ADMIN` | 033 | B-INV |
| Simulation du monde | 1870, 3023, 3026, 3057 | `world.tick` (eau, circuits), apparitions client | serveur | 034 | B-ENV |
| Sauvegarde | 2723 | `doSave` dans `localStorage` | désactivée, serveur sauvegarde | 036 | B-RESEAU |
| Prédiction du mouvement | 2761 | mouvement direct | prédiction + réconciliation (NET-026) | 037 | B-RESEAU |
| Overrides de chunks | 1704 | génération locale | `OVERRIDES_DEMANDE` (SERVEUR-009) | 038 | B-RESEAU |
| Affichage réseau | 653, 2629, 2642 | texte « hors ligne » | texte « en ligne » | 039 | A0 (653), B-RESEAU |
| Interpolation | 3067 | non appelée | `net.interpoler` | 040 | B-RESEAU |
| Mode histoire | 1426 | état du récit client | aucun équivalent serveur | 041 | P-HIST |
| Succès | 2141 | suivi client | aucun équivalent serveur | 042 | P-SUCC |

Total : 1+2+2+1+3+3+6+1+1+7+5+2+2+4+1+1+1+3+1+1+1 = **49**. La fiche 035
(fabrication et cultures) n'a pas de ligne propre : elle documente ce qui
découle de 031 et 034.

### 1.3 Ce qui n'existe pas côté serveur (à porter, pas à contourner)

Quatre systèmes n'existent aujourd'hui QUE côté client hors ligne : véhicules
(SYNC-022 ⏳, mais `vehicules` est déjà chargé par `server.js`), succès, mode
histoire, bombes volcaniques. Ils ne sont **pas relégués** à un « après » :
- véhicules, histoire et succès ont chacun un lot de portage planifié
  (P-VEH, P-HIST, P-SUCC, § 2 et § 3) et une fiche dont le test peut passer
  (ARCHI-021, 041, 042) ;
- les bombes et coulées volcaniques sont **supprimées** (ARCHI-023),
  régression documentée (« Supprimé » du CHANGELOG).

Autres prérequis ⏳ que les lots livrent : SYNC-018 (cultures), 020
(persistance du joueur, indispensable à la parité de sauvegarde ARCHI-014), 024
et 025 (état politique et guildes au join), 026 (objets au sol), 028 (pose et
tir validés), SERVEUR-006 (conteneurs et véhicules dans `etatMonde`). Les
SYNC-007 à 017, 021 (inventaire) et 023 sont ✅.

---

## 2. Lots et dépendances

```
 A0-pré (export des parties du client actuel, SPEC-ARCHI-015 b)
      │
      ▼
     A0  fondation : serveur local, loopback + Origin, réseau à chaud,
      │  arrêt propre, pause, sauvegarde, parties sur disque, import,
      │  lancement/paquet, démarrage, latence, contrat gelé, aiguillage de frame
      │
      ├── B-ENV     ARCHI-022 023 024 025 034 035
      ├── B-VIE     ARCHI-026 027 028
      ├── B-INV     ARCHI-030 031 032 033
      └── B-RESEAU  ARCHI-029 036 037 038 039(2629,2642) 040
                │
                ▼  (quatre lots B ensemble, puis)
      ┌── P-VEH   ARCHI-021  (SYNC-022, SERVEUR-006)
      ├── P-HIST  ARCHI-041
      └── P-SUCC  ARCHI-042
                │
                ▼
        publication (§ 8)
```

- **A0-pré** : petit lot livré et fusionné AVANT la bascule : un bouton
  « Exporter mes parties » dans le menu du client actuel (télécharge
  `minicraft-parties.json`). Sans lui les parties d'un joueur sont perdues
  (le `localStorage` ne se partage pas entre origines, § SPEC-ARCHI-015).
- **A0** est le seul lot qui fixe l'existence du serveur local et le contrat
  gelé ; il fusionne avant tout le reste. Il livre aussi un **aiguillage** sans
  changement de comportement : `frame()` et `appliquerActionCommande` de
  `game.js` sont découpés en sous-fonctions nommées par thème (simulation du
  monde, conteneurs, entités, réseau) pour que les lots B ne modifient pas les
  mêmes lignes (§ 4, 7).
- **B-*** : 4 agents en parallèle, dépendent d'A0 fusionné (contrat, serveur
  local). B-ENV et B-INV modifient aussi `server.js` (sommeil, cultures ;
  objets au sol, pose/tir) dans leurs zones (§ 5).
- **P-*** : lots de portage serveur, plus lourds (nouvelles simulations et
  messages), dépendent d'A0 et de la persistance joueur (SYNC-020, livrée par
  A0 pour ARCHI-014). P-HIST dépend en outre de B-VIE (évènements de combat
  arbitrés par le serveur). Au plus 4 agents à la fois : les lots P démarrent
  quand les B libèrent leurs agents ; P-SUCC et P-VEH peuvent démarrer dès
  qu'A0 est fusionné si un agent est libre.
- `SPEC-SERVEUR-008` (découpage de `server.js` en modules) passe **après** toute
  la vague ARCHI : elle modifie `server.js` en profondeur.

## 3. Ordre et parallélisme

| Étape | Qui | Quand |
|---|---|---|
| 0 | A0-pré : bouton d'export dans le client actuel | avant tout, fusion + publication d'un patch |
| 1 | A0 (un agent, phases commitées : contrat et test → serveur local et sécurité → pause et sauvegarde → parties, import, lancement → démarrage et latence → aiguillage de `game.js`) | après 0 |
| 2 | fusion d'A0, portes vertes, budgets de latence et de démarrage consignés | après 1 |
| 3 | B-ENV, B-VIE, B-INV, B-RESEAU en parallèle, un worktree chacun | après 2 |
| 4 | P-VEH, P-HIST, P-SUCC (au plus 4 agents au total en cours) | dès qu'un agent est libre ; P-HIST après la fusion de B-VIE |
| 5 | publication (§ 8) | après 4, portes vertes |

Chaque lot : revue adversariale (agent distinct, Opus en recours) avant sa
fusion, puis `node tests/gates.js` sur master.

## 4. Zones de `src/game.js` par lot (générée depuis la table ligne → fiche → lot)

Table produite par un script de contrôle (`grep` des 49 lignes, puis
affectation ; aucune ligne manquante ni en trop) :

| Lot | Nb | Lignes (fiche) |
|---|---|---|
| A0 | 1 | 653 (39) |
| B-ENV | 12 | 923 (23), 934 (23), 1044 (22), 1087 (22), 1126 (25), 1211 (24), 1870 (34), 1955 (25), 2648 (25), 3023 (34), 3026 (34), 3057 (34) |
| B-VIE | 10 | 1605 (26), 2226 (27), 2244 (27), 2256 (27), 2663 (28), 2783 (26), 2795 (26), 2821 (27), 2833 (27), 2990 (27) |
| B-INV | 16 | 1133 (30), 1172 (32), 2268 (31), 2280 (30), 2359 (31), 2462 (31), 2528 (31), 2575 (30), 2581 (30), 2903 (33), 2912 (33), 2926 (30), 2986 (31), 3011 (32), 3039 (30), 3059 (30) |
| B-RESEAU | 7 | 1704 (38), 2629 (39), 2642 (39), 2655 (29), 2723 (36), 2761 (37), 3067 (40) |
| P-VEH | 1 | 2057 (21) |
| P-HIST | 1 | 1426 (41) |
| P-SUCC | 1 | 2141 (42) |

Total 1+12+10+16+7+1+1+1 = 49.

| Ligne | Fiche | Lot | Objet |
|---|---|---|---|
| 653 | 039 | A0 | menu pause (dans `onStateChange`, réservé à A0 seul) |
| 923, 934 | 023 | B-ENV | bombes, coulées de lave |
| 1044, 1087 | 022 | B-ENV | tornades, foudre |
| 1126 | 025 | B-ENV | service qui avance le temps |
| 1133 | 030 | B-INV | banquier |
| 1172 | 032 | B-INV | marchand |
| 1211 | 024 | B-ENV | `peuplerLieux` |
| 1426 | 041 | P-HIST | `majHistoire` |
| 1605 | 026 | B-VIE | `respawn` |
| 1704 | 038 | B-RESEAU | overrides de chunks |
| 1870 | 034 | B-ENV | apparition de monstres |
| 1955 | 025 | B-ENV | sommeil (`dormir`) |
| 2057 | 021 | P-VEH | véhicules |
| 2141 | 042 | P-SUCC | succès |
| 2226, 2244, 2256 | 027 | B-VIE | attaque, tir, ciblage |
| 2268 | 031 | B-INV | manger |
| 2280 | 030 | B-INV | ouvrir un conteneur posé |
| 2359 | 031 | B-INV | pose de bloc |
| 2462 | 031 | B-INV | prédiction d'inventaire |
| 2528 | 031 | B-INV | jeter |
| 2575, 2581 | 030 | B-INV | fermer un conteneur, un distributeur |
| 2629, 2642 | 039 | B-RESEAU | joueurs connectés, contexte des commandes |
| 2648 | 025 | B-ENV | `/heure` |
| 2655 | 029 | B-RESEAU | `/faction` |
| 2663 | 028 | B-VIE | `/duel` |
| 2723 | 036 | B-RESEAU | `doSave` (et `beforeunload`, ligne 3138) |
| 2761 | 037 | B-RESEAU | prédiction du mouvement |
| 2783, 2795 | 026 | B-VIE | survie, climat |
| 2821, 2833 | 027 | B-VIE | butin, `attaqueEnLigne` |
| 2903, 2912 | 033 | B-INV | bloc de commande |
| 2926 | 030 | B-INV | ouvrir un conteneur (second chemin) |
| 2986 | 031 | B-INV | purge du journal d'inventaire |
| 2990 | 027 | B-VIE | `entities.update` |
| 3011 | 032 | B-INV | économie |
| 3023, 3026, 3057 | 034 | B-ENV | `world.tick`, apparition |
| 3039, 3059 | 030 | B-INV | cuisson des fourneaux |
| 3067 | 040 | B-RESEAU | `net.interpoler` |

**Points chauds (recouvrement réel)** :
- `frame()` (l. 2980-3070) : B-INV ×4 (2986, 3011, 3039, 3059), B-ENV ×3
  (3023, 3026, 3057), B-VIE ×1 (2990), B-RESEAU ×1 (3067) — quatre lots dans
  environ 90 lignes. Parade : l'aiguillage d'A0 découpe `frame()` en
  sous-fonctions par thème AVANT le lancement des lots, chaque lot n'édite
  alors que sa fonction.
- `appliquerActionCommande` et son voisinage (l. 2625-2670) : B-RESEAU (2629,
  2642, 2655), B-ENV (2648), B-VIE (2663), soit trois lots sur un `switch` ;
  `case` disjoints, on garde tous les `case`.
- `onAttack`/`onUse` (l. 2220-2360) : B-VIE (2226, 2244, 2256) et B-INV (2268,
  2280, 2359) entrelacés ; lignes d'accroche disjointes.
- `rendreService` (l. 1116-1215) : B-ENV (1126), B-INV (1133, 1172).
- `onStateChange` (l. 646-659) : A0 seul (653 comprise).

Quatre lots parallèles restent réalistes à ces conditions : 16, 12, 10 et 7
lignes chacun, au plus un tiers en zones partagées, et des tests d'intégration
disjoints (un fichier `tests/integration-archi-<lot>.js` par lot).

## 5. Autres fichiers partagés

| Fichier | A0 | B-ENV | B-VIE | B-INV | B-RESEAU | P-* |
|---|---|---|---|---|---|---|
| `server.js` | seul pour lancement, écouteurs, `PAUSE`/`RESEAU`/`ARRET`, boucle (gel), sauvegarde, API parties | sommeil (`DORMIR`), croissance des cultures (SYNC-018), diffusion feu (SYNC-019) | — (serveur déjà autoritaire) | objets au sol (SYNC-026), pose/tir (SYNC-028) | état politique et guildes au join (SYNC-024/025) | messages `HISTOIRE_ETAT`, `SUCCES_DEBLOQUE`, véhicules |
| `src/net-protocol.js`, `src/net.js` | fusion de `ContratsArchi.MSG`, hooks `PAUSE_ETAT`/`RESEAU_ETAT` | `DORMIR` (émission) | — | dépôt au sol | — | hooks `onHistoireEtat`, `onSucces` |
| `src/contrats-archi.js` + `tests/spec-contrats-archi.js` | **seul** | — | — | — | — | — |
| `src/saves.js`, `src/save.js` | adaptateur de fichiers, import | — | — | — | retrait de `doSave` | — |
| `src/ui.js` | menu (parties, importer/exporter, écran d'attente, réseau à chaud) | — | — | conteneurs | — | — |
| `index.html`, `tools/paquet.js`, `README.md` | **seul** | — | — | correction des « Limites » (l. 607) | — | — |
| `tests/run.js`, `tests/gates.js`, `tests/index.html`, `server.js` `MODULES` | listes (union à la fusion) | ajouts | ajouts | ajouts | ajouts | ajouts |

## 6. Sauvegarde : évaluation chiffrée et décision (SPEC-ARCHI-012)

**Cadences actuelles.** Solo navigateur : 60 s + `beforeunload`
(`localStorage`) ; serveur : 120 s (`MC_SAUVEGARDE_MS`) + arrêt propre (SIGINT/
SIGTERM). **Perte maximale en cas de crash** : 60 s en solo, 120 s sur serveur ;
une fermeture brutale d'onglet perd, côté serveur, jusqu'à 120 s (rien ne
sauvegarde à la déconnexion aujourd'hui).

**Coût d'une sauvegarde.** `etatMonde()` sérialise en JSON : chaque bloc
modifié est un quadruplet `[x,y,z,id]` d'environ 20 à 25 octets, plus joueurs,
conteneurs, politique, économie (quelques centaines de Ko pour un monde
habité). Estimations à confirmer par le banc `tests/bench-sauvegarde.js` :

| Blocs modifiés | Taille du fichier | `JSON.stringify` (synchrone, ≈ 50-100 Mo/s) | Écriture disque (asynchrone) |
|---|---|---|---|
| 10⁴ | ≈ 0,3 Mo | ≈ 5 ms | négligeable |
| 10⁵ | ≈ 2,5 Mo | ≈ 25-50 ms | ≈ 10-30 ms |
| 10⁶ | ≈ 25 Mo | ≈ 250-500 ms (15 à 30 images perdues) | ≈ 100-300 ms |

`SPEC-SERVEUR-004` rend l'ÉCRITURE asynchrone ; la sérialisation, elle, bloque
la boucle. À 10⁵ modifications une sauvegarde toutes les 45 s coûte moins de
0,1 % du temps de boucle et reste invisible ; à 10⁶ elle cause un à-coup
visible : seuil d'alerte du banc (budget dans `tests/budget-perf.json`,
attendu ≤ 50 ms à 10⁵), et sauvegarde incrémentale par chunks sales comme
piste si le budget est dépassé (hors périmètre de ce chantier).

**Décision.** Sauvegarde **continue** (journal d'écritures à chaque mutation)
rejetée : gain (perte ramenée de 45 s à 0) sans commune mesure avec la
complexité (journal, compaction, reprise après crash à mi-écriture) alors que
les sauvegardes ponctuelles couvrent les vrais risques. Retenu :
1. immédiate à l'entrée en pause / retour au menu / `ARRET` / fermeture
   réseau / départ du dernier client (onglet fermé brutalement) ;
2. cadence 45 s en mode fermé (contre 60 s aujourd'hui en solo, gain net),
   120 s en mode ouvert (inchangé) ;
3. synchrone sur signal d'arrêt (l. 2841 de `server.js`, inchangé) ;
4. omise si rien n'a changé (drapeau « sale »), ce qui rend la pause et
   l'inactivité gratuites.
Perte maximale d'un crash brutal : 45 s de jeu en fermé.

## 7. Stratégie de fusion

- Branches courtes rebasées sur master avant revue ; fusion par
  l'orchestrateur (`git merge --no-ff`), portes vertes sur master après chaque
  fusion.
- Listes de chargement (`tests/run.js`, `tests/gates.js`, `server.js` `MODULES`,
  `index.html` `SRC`, `tests/index.html`) : union, dans l'ordre d'arrivée.
- `CHANGELOG.md` « Non publié » : garder toutes les lignes.
- Conflits textuels résiduels dans `game.js` : garder les deux côtés (les lots
  n'éditent que leurs lignes, après l'aiguillage d'A0).

## 8. Critères de fin et publication

Communs : fiches passées ✅ dans le commit qui les livre, chacune citée par un
test de COMPORTEMENT (jamais seulement un test de contrat) ;
`node tests/run.js --delai 900` et `node tests/gates.js` verts ; suites
d'intégration qui lancent ET arrêtent leur serveur ; e2e à ≥ 800×600 ;
CHANGELOG ; revue adversariale appliquée ; aucun serveur laissé tournant.

| Lot | Fiches ✅ | Preuves supplémentaires |
|---|---|---|
| A0-pré | (bouton d'export) | test Node : l'export d'un `localStorage` simulé se relit |
| A0 | ARCHI-001 à 020, 039 (l. 653) | intégration : loopback seulement, Origin, réseau à chaud, arrêt sans orphelin, pause exacte, sauvegardes, import, écran d'attente ; bancs de latence, de sauvegarde et de démarrage consignés |
| B-ENV | 022, 023, 024, 025, 034, 035 | espion `world.tick` : 0 appel client avec eau/circuits ; sommeil serveur ; CHANGELOG « Supprimé » (bombes) |
| B-VIE | 026, 027, 028 | PV/faim par le serveur, gelés pendant la pause ; butin par `DONNE` |
| B-INV | 030, 031, 032, 033 | conteneurs, inventaire, `TROC`, bloc de commande par le serveur ; SYNC-026 et 028 ✅ ; README « Limites » corrigé |
| B-RESEAU | 029, 036, 037, 038, 039 (2629, 2642), 040 | SYNC-024/025 ✅ ; plus aucune écriture de partie dans `localStorage` |
| P-VEH | 021 | SYNC-022 et SERVEUR-006 ✅ |
| P-HIST | 041 | histoire jouable en solo fermé, sauvegardée et rechargée |
| P-SUCC | 042 | tolérance de distance vérifiée |

**Règle de publication.** La vague ne se publie PAS (`tools/version.js
--publier`) tant que P-HIST et P-SUCC ne sont pas fusionnés : sans eux, le
mode histoire et les succès, aujourd'hui fonctionnels en solo, seraient
perdus. Les véhicules (P-VEH) peuvent, faute de temps, partir après une
publication à condition qu'elle soit **marquée régressive** : commit `feat!`
(rupture), CHANGELOG « Supprimé » listant les véhicules, README « Limites
connues » mis à jour. Les bombes volcaniques sont dans tous les cas listées
dans « Supprimé ». *P-VEH est fait : les véhicules sont simulés par le serveur, la
publication n'a donc plus à être marquée régressive pour eux.*

## 9. Risques et parades

| Risque | Parade |
|---|---|
| Un lot confond `net.enLigne()` (toujours vrai) avec « ouvert au réseau » | `ETAT_RESEAU` figé dans le contrat ; la revue vérifie qu'aucune décision ne repose sur `net.enLigne()` |
| Perte des parties existantes | A0-pré (export), import (ARCHI-015), test d'aller-retour |
| Page tierce qui parle au serveur local | loopback + `Origin` (ARCHI-002, 003) |
| Pause qui dérive l'heure ou rattrape le temps | rebasage de `dernier`, gel des cumulateurs, test à 5 s (ARCHI-010, 011) |
| Régression fonctionnelle du solo (histoire, succès, véhicules) | lots de portage planifiés, règle de publication (§ 8) |
| Parité de sauvegarde incomplète (position, cartes explorées, histoire…) | ARCHI-014, tableau champ par champ |
| Latence ou démarrage perceptiblement plus lents | budgets ARCHI-017 et 018, mesurés avant chaque fusion |
| Conflits de fusion sur `game.js` | aiguillage d'A0, § 4, `frame()` découpée |
| `localStorage` (options, touches) perdu si le port change | port par défaut stable (ARCHI-004) |
| Serveurs orphelins pendant les tests | suites qui lancent et arrêtent leur serveur ; ARCHI-008 |
