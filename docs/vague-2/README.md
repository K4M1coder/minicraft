# Vague 2 — plan d'exécution

Quatre sous-lots en parallèle (règle : 4 agents Sonnet au plus), décrits dans
`docs/design-lots.md` (tableau « Vague 2 ») et détaillés ici, un fichier par
lot : [B1](B1.md) inventaire et conteneurs serveur (L43), [B2](B2.md)
économie et métiers (L45), [B3](B3.md) génération et maillage en Web Workers
(L47), [B4](B4.md) PvP enjeux et sanctions (L46). Ce plan a été établi contre
le code de `master` au commit `b4c434a` (2026-09-24) ; tous les numéros de
ligne cités s'y rapportent — ils bougeront, les noms de fonctions restent la
référence.

Les interfaces qui traversent une frontière entre lots sont **figées en
code** dans `src/contrats-vague2.js` (`MC.ContratsV2`), testées par
`tests/spec-contrats-vague2.js`. Chaque lot code contre ce module ; aucun ne
le modifie (voir « Contrats » plus bas).

---

## 1. État de départ (vérifié)

| Élément | État sur master | Conséquence |
|---|---|---|
| A1 fiabilité transport (SPEC-SECU-001 à 008, SERVEUR-003/004) | fusionné | B1 peut toucher `server.js` sans conflit de zone avec A1 ; B1 étend `FLOOD_TYPES_PAR_JOUEUR` (l. 693-700) |
| A2 bruit interpolé (SPEC-PERF-001 à 003, 017, 018) | fusionné (`446a702`) | B3 déporte un `world.js` déjà rapide ; chaque worker de génération aura SES caches de coins (≤ 600 000 coins, SPEC-PERF-002) |
| A3 greedy meshing (SPEC-PERF-011 à 013) | **NON fusionné** : branche `worktree-agent-a0751c8bcd44f5a69` (`1efeee0`, `ad86232`), forkée avant A4 | **prérequis de B3** : fusionner A3 d'abord ; conflit attendu dans `src/render.js` (`syncChunk`, `toGeometry` : A3 ajoute `uvBase`/`uvRep` et `customDepthMaterial`, A4 a introduit `disposerGeom`/`tagGen`) — garder les deux |
| A4 rendu fiable (SPEC-RENDU-*, PERF-015/016) | fusionné | `g.perf.msGeneration`/`msMaillage` existent (game.js l. 1246-1266) ; B3 les alimente avec les mesures worker. SPEC-RENDU-014 a été laissée « à faire avec le lot d'orchestration des chunks » : hors périmètre B3 (bonus facultatif) |
| Inventaire serveur | `state.inv`/`state.equip` existent (player.js l. 30-34) mais **rien ne les alimente** : le ramassage part au client (`DONNE`, server.js l. 1366-1369), `MANGER` ne vérifie rien (l. 891-899), l'armure est ignorée en ligne (`armureReduction` lit un `equip` vide) | B1 est la condition de B2 et B4 **en ligne** |
| Équipement en solo | **non sauvegardé** : `save.js` n'écrit pas `player.equip` | bogue corrigé par B1 (champ optionnel, pas de changement de version) |
| Banque | conteneur de 27 cases **client seulement** (`world.banque`, world.js l. 106) ; le serveur n'en a aucune (contrairement à ce que dit design-lots, « serveur déjà autorité pour la banque ») | B1 crée la banque serveur par joueur ; B2 y applique le frais de garde |
| Sauvegarde automatique | `doSave` (game.js l. 2103) tourne aussi en ligne, toutes les 60 s, dans l'emplacement solo | avec B1 elle écraserait l'inventaire solo par l'inventaire serveur : B1 la neutralise en ligne |
| PvP par projectile | `entities.js` `stepArrow` (l. 308-325) ne connaît que `pvpOk(posA, posB)` : ni `peutBlesser`, ni l'auteur du coup | SPEC-PVP-002 corrigée ; B4 attribue les coups de flèche |
| Économie | aucun prix dynamique, aucun trésor PNJ, caravanes purement scénographiques (`caravanes.js`, déterministes par l'heure) | B2 part de zéro, en modules purs |

## 2. Dépendances réelles

```
            A3 (greedy, à fusionner) ──► B3 ─────────────────────────┐
                                                                     │  fusion
contrats-vague2.js ──► B1 ──(state.inv, INV_MAJ, helpers serveur)──► B2 ──► B4
            │           ▲                                             ▲
            └──────────►┴─── B2 et B4 démarrent en même temps que B1 ┘
```

- **B1** ne dépend de rien d'autre que du contrat.
- **B2 ne dépend pas vraiment de B1** pour son cœur : ECO-001 à 007 et
  METIER-001 à 005 sont vérifiables en Node pur (prix, stocks, trésors,
  simulation de 100 jours, caravanes). Seuls le branchement en ligne de `TROC`
  (SPEC-SYNC-023) et son test d'intégration exigent un inventaire serveur
  réel. B2 **démarre en même temps que B1** sur le contrat figé (forme de
  `TROC`, `offreId`, `messageInvMaj`, motifs de refus) et sur les
  *helpers serveur* que B1 s'engage à fournir sous ces noms exacts (B1.md,
  § « API serveur exposée aux autres lots ») ; il écrit son `case
  NP.MSG.TROC` contre eux, et ne lance son intégration qu'après s'être rebasé
  sur B1 fusionné.
- **B3** ne dépend que de A3 (fusion préalable) : fichiers disjoints de B1,
  B2 et B4, hors les listes de chargement et deux zones distinctes de
  `game.js`.
- **B4** : son module pur, les duels, la réputation et les succès sont
  indépendants ; SPEC-PVP-001 (butin) exige l'inventaire serveur de B1, et
  SPEC-PVP-006 (embargo) le `TROC` de B2 (une ligne dans son `case`). B4
  démarre avec les autres et fusionne **en dernier**.

## 3. Ordre et parallélisme

| Étape | Qui | Quand |
|---|---|---|
| 0 | orchestrateur : fusionner A3 dans master (conflit render.js à résoudre à la main, portes vertes, `bench-maillage.js` vert) | avant de lancer B3 |
| 1 | lancer **B1, B2, B3, B4 en parallèle** (4 agents), chacun dans son worktree à partir de master | dès l'étape 0 faite (B1, B2, B4 peuvent partir avant) |
| 2 | fusionner **B3** dès qu'il est prêt (aucune dépendance) | à tout moment |
| 3 | fusionner **B1** | premier des trois lots réseau |
| 4 | **B2** se rebase sur master (B1 inclus), lance `integration-troc.js`, corrige, fusionne | après 3 |
| 5 | **B4** se rebase (B1 + B2), ajoute la ligne d'embargo dans le `case TROC`, lance `integration-pvp.js`, fusionne | après 4 |
| 6 | publier : `node tools/version.js --publier` (la vague apporte des `feat`) | après 5, portes vertes |

Chaque lot : revue adversariale (agent Sonnet distinct, Opus en recours)
**avant** sa fusion, puis `node tests/gates.js` sur master après la fusion.

## 4. Zones de `server.js` possédées (lignes de `b4c434a`)

| Zone | Lignes | Propriétaire | Nature de la modification |
|---|---|---|---|
| liste `MODULES` | 30-32 | tous (voir § 6) | ajouts de noms, union à la fusion |
| `const distributeurs = new Map()` | 100 | B1 | remplacée par le registre des conteneurs |
| `etatMonde()` | 112-136 | B1, B2, B4 | **une ligne chacun** dans l'objet retourné : B1 `conteneurs:` et `joueurs:` après `guildes:`, B2 `economie:` après B1, B4 `pvp:` en dernier |
| `appliquerEtatMonde()` | 138-189 | B1, B2, B4 | **une ligne chacun** avant `return true;`, appel d'une fonction `appliquerEtatX(data.x)` définie dans la section du lot |
| `peuplerLieux` / `avancerPolitique` | 266-313 | — | inchangés ; B2 ajoute SA section « économie » juste après `avancerPolitique` (avant `abriServeur`, l. 315) |
| `fermer(c)` | 357-367 | B1 | ranger l'inventaire dans le registre, désabonner des conteneurs |
| anti-flood (`FLOOD_TYPES_PAR_JOUEUR`, `antiFloodOk`) | 693-742 | B1 | budgets des nouveaux types (`MC.ContratsV2.BUDGETS_FLOOD`) — B2/B4 n'y touchent pas : `troc` y figure déjà |
| début de `traiter()` (branche anti-flood) | 757-766 | B1 | un message d'inventaire ignoré renvoie un `INV_MAJ` de refus `debit` |
| `case REJOINDRE` | 768-817 | B1 | registre, `INV_MAJ` initial, `EQUIP_VU` des présents |
| `case ATTAQUE` (branche `joueurCible`) | 841-871 | **B4** | duel, butin, meurtres, victoires |
| `case MANGER` | 891-899 | B1 | validation contre l'inventaire |
| `case BLOC` (fin : casse d'un distributeur) | 964-971 | B1 | généralisé à tout conteneur cassé |
| `case DISTRIB` | 974-978 | B1 | déclaration validée (SPEC-SYNC-017) |
| `case CHAT` (interception `/faction`) | 980-1007 | **B4** | interception `/duel` insérée AVANT le test `/faction` (l. 984) |
| fin du `switch` de `traiter()` | après `case ADMIN` (1008-1011) | B1 puis B2 | B1 ajoute ses `case` ; B2 ajoute `case NP.MSG.TROC` APRÈS ceux de B1 |
| section « inventaire et conteneurs » (nouvelle) | insérée avant « joueurs simulés » (1122) | B1 | registre, abonnements, helpers exposés |
| `creerJoueurServeur` | 1126-1130 | B1 | grille, `dernierSeq`, `revInv` |
| section « PvP » (nouvelle) | insérée après `joueurParCle` (1174-1178), avant « instrumentation » (1180) | B4 | état PvP, helpers |
| tic : bloc `accChunks >= 1` | 1244-1256 | B2 | une ligne `avancerEconomie();` après `avancerPolitique();` (l. 1253) |
| tic : bloc `accEau >= 0.25` | 1257-1260 | B1 | cuisson des fourneaux serveur (même cadence) |
| tic : `onDistribuer` | 1273-1290 | B1 | lit le registre des conteneurs |
| tic : `ev.degatsPar.forEach` | 1361-1365 | **B4** | coups de flèche PvP attribués (butin, meurtres) |
| tic : `ev.picked.forEach` | 1366-1369 | B1 | ramassage dans `state.inv` serveur |
| B3 | — | — | **aucune** modification de `server.js` |

Règle de rédaction : un lot n'édite une zone d'un autre lot que par les
« lignes d'accroche » listées ci-dessus, et définit tout le reste dans SA
section. Les conflits textuels résiduels se résolvent en gardant les deux
côtés.

## 5. Autres fichiers partagés

| Fichier | B1 | B2 | B3 | B4 |
|---|---|---|---|---|
| `src/net-protocol.js` | **seul** : fusion de `ContratsV2.MSG` dans `MSG`, délégation dans `default:`, `case MANGER` | — | — | — |
| `src/net.js` | hooks + `case` après `DONNE` (l. 121-124) | `case TROC` après `CHAT` (l. 138-141) | — | `case PVP` après `QUITTE` (l. 148-152) |
| `src/game.js` | hooks réseau après `onDonne` (l. 115-119), `rejoindreServeur` 425-433, `ouvrirBanque` 732-737, `coffreDe` 1388-1400, `spillContainer` 1549-1579, branche `open:` de `onUse` 1702-1790, `forceCloseContainer`/`dropLeftovers`/`closeUI` 1969-2000, `doSave` 2103-2112, `ouvrirConteneur` 2302-2320, fourneaux de `frame` 2386-2388 et 2404 | `rendreService`/`parlerA` 738-790, hook `onTroc` après `onAdminRep` (l. 130-133) | création du rendu (l. 16-27), `remplacerMonde` 440-450, `streamChunks`/`remeshDirtyNear` 1230-1298 | hook `onPvp` après `onQuitte` (l. 96) |
| `src/ui.js` | `clickSlot` … `poserRecette` (1373-1470), rendu des conteneurs hors troc, `openContainer`/`closeContainer` (1783-1825) | section `kind === 'trade'` de `renderContainer` (1600-1646) | panneau F3 : une ligne « workers » (facultatif) | — |
| `src/save.js` | `player.equip` (optionnel) | `economie` (optionnel) | — | — |
| `src/player.js`, `src/inventory.js` | **seul** | — | — | — |
| `src/entities.js` | — | — | — | **seul** (`stepArrow` : auteur du coup) |
| `src/world.js`, `src/lumiere.js`, `src/render.js`, `src/mesher.js` | — | — | **seul** | — |
| `src/caravanes.js`, `src/habitats.js` | — | **seul** (`habitats.js` : retouches facultatives de `servir`) | — | — |
| `src/succes.js`, `src/commandes.js` | — | — | — | **seul** |
| `tests/e2e.js` | section « inventaire en ligne » (facultative) | — | section « workers » | — |
| `tests/integration-pvp.js` | — | — | — | **seul** (étendu) |

## 6. Listes de chargement — conflit attendu, résolution par union

Chaque liste tient sur une ou deux lignes : tout lot qui ajoute un module
entre en conflit textuel avec les autres. Résolution mécanique : **garder
l'union, dans l'ordre ci-dessous**, qui est l'état cible après la vague.

- `tests/run.js` `SRC` : `…'inventory', 'conteneurs', 'vehicules'…` (B1) ·
  `…'mesher', 'file-chunks', 'taches-chunks', 'physics'…` (B3) ·
  `…'guildes', 'economie', 'metiers', 'pvp-enjeux', 'livre'…` (B2, B4) ;
  `'contrats-vague2'` est déjà avant `'net-protocol'`.
- `tests/run.js` `TESTS` : après `'spec-contrats-vague2'` —
  `'spec-conteneurs'` (B1), `'spec-economie', 'spec-metiers'` (B2),
  `'spec-workers'` (B3), `'spec-pvp'` (B4) ; `FICHE_INTEGRATION` :
  `'integration-inventaire.js'` (B1), `'integration-troc.js'` (B2) — fiche
  obligatoire, sinon G14 rougit ; B4 met à jour la fiche existante de
  `integration-pvp.js`.
- `tests/gates.js` `PURS` : `'conteneurs'` (B1), `'file-chunks',
  'taches-chunks'` (B3), `'economie', 'metiers'` (B2), `'pvp-enjeux'` (B4) ;
  `NAVIGATEUR` (informatif) : `'workers', 'worker-monde', 'worker-maillage'`
  (B3).
- `server.js` `MODULES` : `'conteneurs'` après `'inventory'` (B1) ;
  `'caravanes'` après `'recifs'` (B2, pour ECO-004 côté serveur) ;
  `'economie', 'metiers', 'pvp-enjeux'` après `'guildes'` (B2, B4).
- `index.html` `SRC` : comme `run.js` + `'workers'` après `'atlas'` (B3).
- `tests/index.html` : mêmes `../src/*.js`, et les `spec-*.js` avant `e2e.js`.

Un module pur ne lit ses dépendances (`MC.Inventory`, `MC.Politique`…)
qu'à l'appel, jamais au chargement, pour que l'ordre ne casse rien.

## 7. Contrats (`src/contrats-vague2.js`)

Ce que le module fige : noms `MSG` et sens (`SENS`) des 14 nouveaux types,
bornes (`BORNES`), emplacements d'équipement, types et tailles de conteneurs,
cases d'un fourneau, zones d'un transfert, motifs de refus (liste fermée),
actions `TROC`, évènements `PVP`, budgets anti-flood, passes et attributs
d'un maillage worker ; formes : pile, case sérialisée (format
`Inv.serialize`), équipement, clé de conteneur (`"x,y,z"`, `banque`,
`grille`), clé de registre joueur (`canon(nom)` + `#j`), identifiant d'offre
(`lieu|role|indice`), conteneur persisté, enregistrement joueur,
transaction de troc, messages worker ; fonctions `valider*` (copie
normalisée ou `null`, jamais d'exception), `messageInvMaj` (fabrique un
`INV_MAJ` depuis un état serveur, pour B1, B2 et B4), `transferablesDe`.

Règles :
1. **Figé pendant la vague.** Un lot qui a besoin d'un changement s'arrête,
   décrit l'amendement dans son rapport ; l'orchestrateur le commite seul sur
   master (`feat(contrats): …`, uniquement `src/contrats-vague2.js` et son
   test), et les lots en cours se rebasent.
2. `tests/spec-contrats-vague2.js` **cite des specs ⏳** (G2 l'accepte) :
   quand un lot passe une spec à ✅, il ne peut pas compter sur ce fichier
   pour la porte G1 — chaque spec livrée doit être citée par un test de
   COMPORTEMENT du lot (c'est un point de la revue adversariale).
3. Le raccordement au protocole est fait par B1, étape 1 (B1.md).

## 8. Stratégie de fusion

- Branches courtes, rebasées sur master avant revue ; fusion par l'orchestrateur
  (`git merge --no-ff`), portes vertes sur master après chaque fusion.
- Conflits prévus et parade :

| Conflit | Où | Parade |
|---|---|---|
| A3 × A4 | `render.js` `syncChunk`/`toGeometry`/matériaux | à la main à l'étape 0 : garder `disposerGeom`/`tagGen` (A4) ET `uvBase`/`uvRep`/`customDepthMaterial` (A3) ; relancer e2e 127/127 |
| listes de chargement | § 6 | union dans l'ordre du § 6 |
| `etatMonde` / `appliquerEtatMonde` | lignes d'accroche § 4 | garder les lignes des deux côtés |
| fin du `switch` de `traiter()` | B1 puis B2 | B2 place `case TROC` après les `case` de B1 |
| hooks du client réseau (`game.js` l. 59-135) | trois points d'accroche distincts (§ 5) | garder tout |
| `net.js` `recevoir` | trois `case` à trois endroits distincts | garder tout |
| `ui.js` | B1 (conteneurs) × B2 (troc) : fonctions différentes | garder tout ; si B1 a changé la signature d'`openContainer`, B2 s'y aligne au rebase |
| `save.js` | B1 (`player.equip`) × B2 (`economie`) | champs distincts, garder tout |
| `CHANGELOG.md` « Non publié » | tous | garder toutes les lignes |

## 9. Critères de fin par lot

Communs : specs du lot passées ✅ **dans le commit qui les livre**, chacune
citée par un test de comportement ; `node tests/run.js --delai 900` et
`node tests/gates.js` verts ; suites d'intégration du lot vertes (elles
lancent ET arrêtent leur serveur) ; e2e du lot verts à ≥ 800×600 ; aucun
serveur laissé tournant ; ligne CHANGELOG pour chaque `feat`/`fix` ;
revue adversariale faite et appliquée ; un commit par lot d'étapes testé.

| Lot | Specs passées ✅ | Preuves supplémentaires |
|---|---|---|
| B1 | SYNC-007 à 017 | `integration-inventaire.js` ; test solo → en ligne → solo sans perte d'inventaire solo ; `integration-net.js`, `integration-pvp.js`, `integration-secu.js` toujours verts |
| B2 | ECO-001 à 007, METIER-001 à 005, SYNC-023 | `MC.Economie.simuler` 100 jours dans les bornes ; `integration-troc.js` (après rebase sur B1) |
| B3 | PERF-004 à 010, 014 | e2e calibrés verts ; repli sans Worker vérifié ; `bench-generation.js`/`bench-maillage.js` inchangés ou meilleurs ; G12 vert |
| B4 | PVP-001 à 006 | `integration-pvp.js` étendu (butin, duel, flèche entre membres d'une même faction) |

## 10. Risques et parades

| Risque | Parade |
|---|---|
| B1 trop gros pour un agent | découpé en phases qui se commitent chacune (B1.md § 9) ; si la phase conteneurs déborde, l'orchestrateur la confie au même agent dans une seconde session (B1a → B1b), jamais à un 5ᵉ agent en parallèle |
| Régression « perte d'inventaire » en ligne (le serveur devient autorité alors qu'il n'avait rien) | B1 inclut un registre par nom en mémoire ET sa persistance `--monde` (partie inventaire de SYNC-020/021, qui restent ⏳ pour C1) |
| Écrasement de la sauvegarde solo par l'état en ligne | B1 : `doSave` refuse en ligne ; l'inventaire solo est mis de côté à la connexion et restauré à la déconnexion |
| Duplication d'objets par un client modifié | seul le serveur augmente un inventaire ; `INV_CONSOMMER` ne sait que diminuer ; transferts atomiques ; `seq` idempotent |
| Divergence visuelle client/serveur (latence) | prédiction + réconciliation par `ack` (même patron que `MC.Synchro`) ; l'auteur reçoit ses deltas de conteneur DANS son `INV_MAJ` |
| B2 fige des prix entiers qui ne bougent pas (lots d'une émeraude) | prix réel + règle d'arrondi du lot (SPEC-ECO-001 corrigée) |
| Masse monétaire non bornée (les PNJ paient sans limite) | trésor par lieu (SPEC-ECO-003 corrigée) |
| B3 : worker indisponible (`file://`, CSP future de SECU-010) | repli synchrone (SPEC-PERF-006) ; note pour D1 : la CSP devra autoriser `worker-src 'self'` |
| B3 : tests de temps réel instables en CI headless | seuils calibrés à la session, `@lent` sous rendu logiciel (déjà dans les specs) |
| B3 : mémoire × nombre de workers (caches de bruit) | un seul worker de génération par défaut, pool de maillage borné à 4 |
| B4 : PvP à distance oublié (flèches) | SPEC-PVP-002 corrigée, test dédié |
| Porte G1 satisfaite par le test de contrat au lieu d'un test de comportement | règle 2 du § 7, vérifiée en revue |
| Orphelins de serveurs pendant les tests | les suites d'intégration démarrent/arrêtent leur serveur ; aucun agent ne lance `node server.js` à la main hors d'une suite |

## 11. Après la vague 2

La vague 3 (C1 persistance joueur et véhicules, C2 transport, C3 factions)
repart de l'état cible : C1 étend l'enregistrement joueur de B1 (position,
statistiques, réapparition — SPEC-SYNC-020/021, champs futurs conservés par
`validerEnregistrementJoueur`), ajoute SPEC-SYNC-027/028 (présentoirs, pose et
tir validés contre l'inventaire) ; C2 s'appuie sur `Economie.passageCaravane`
(B2) ; C3 lit les réputations politiques tenues par B4 et l'embargo.
