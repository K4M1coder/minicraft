# Design des lots L43 à L48

Conception technique des lots ajoutés à `SPECS.md` (synchronisation, sécurité,
systèmes interconnectés, performance, rendu). Un chapitre par lot : fichiers
possédés, nouveaux messages réseau (`NP.MSG.*`), structures de données,
dépendances et vagues de parallélisation. Référencé depuis `PLAN.md` §3.

Deux décisions transverses, issues de la revue adversariale des specs :

- **Un seul message de commerce serveur-autoritaire** : `TROC` (SPEC-SYNC-023,
  L43) est l'unique message qui arbitre un échange, y compris les achats/ventes
  à prix dynamique de l'économie (L45, ECO). Le brouillon initial du lot ECO
  proposait un second message `NP.MSG.TRANSACTION` pour le même besoin ; il est
  abandonné pour éviter deux handlers serveur concurrents sur le même besoin
  dans `server.js`.
- **Seuils de performance temps réel relatifs, jamais absolus en CI headless**
  (L47 PERF, L48 RENDU) : tout seuil en millisecondes réelles ou en FPS mesuré
  est soit comparé à une mesure de référence prise au démarrage de la même
  session (calibrage), soit conditionné à la détection d'un rendu matériel
  (`WEBGL_debug_renderer_info`, SPEC-RENDU-010) — un pipeline CI headless
  (SwiftShader/llvmpipe) ne doit jamais faire échouer ces tests pour des
  raisons de matériel plutôt que de régression.

---

## L43 — synchronisation permanente

**Fichiers possédés** : `src/net-protocol.js` (nouveaux `MSG.*` et validation
`valider()`), `server.js` (handlers `traiter()`, `etatMonde()`/
`appliquerEtatMonde()`, boucle de tic — zone routage applicatif, distincte de
la zone bas niveau de L44), `src/inventory.js` (craft/équipement purs, déjà
partagés client/serveur, arbitrés par le serveur plutôt que prédits seuls),
`src/player.js` (structure `state.inv`/`state.equip` déjà présente, à
alimenter), nouveaux modules purs `src/serveur-conteneurs.js` (coffres,
fourneaux, présentoirs, banque), `src/serveur-vehicules.js`,
`src/serveur-troc.js`, `src/net-client.js` (réception des nouveaux messages,
réconciliation optimiste sur le modèle de `synchro.js:75-85`).

**Nouveaux messages `NP.MSG.*`** : `INV_MAJ`, `CRAFT`, `EQUIP`, `EQUIP_VU`,
`CONTENEUR_OUVRIR`, `CONTENEUR_FERMER`, `CONTENEUR_ETAT`,
`CONTENEUR_TRANSFERT`, `CONTENEUR_MAJ`, `VEHICULE_CREER`, `VEHICULE_ENTREE`,
`VEHICULE_SORTIE`, `VEHICULE_COMMANDE`, `VEHICULE_ETAT`, `BANQUE_OPERATION`,
`BANQUE_ETAT`, `TROC` (seul message de commerce serveur-autoritaire, réutilisé
par L45/ECO).

**Structures de données** : `Map` position→conteneur côté serveur
(`{ type, slots, abonnes: Set<clientId> }`), `Map` id→véhicule
(`{ pos, vel, occupant, soute }`), registre par joueur nommé
(`Map` canon(nom)→`{ inv, equip, pos, stats, spawn }`) distinct du registre de
connexion `clients` déjà existant.

**Dépendances internes** : 1) SPEC-SYNC-018/019 (retour de tick diffusé,
isolé) ; 2) SPEC-SYNC-007/008/009 (inventaire serveur + `INV_MAJ`, condition de
tout le reste) ; 3) SPEC-SYNC-010/011 (craft/équip) ; 4) SPEC-SYNC-012 à 017
(conteneurs + distributeur) ; 5) SPEC-SYNC-020/021 (persistance joueur) ;
6) SPEC-SYNC-022 (véhicules, indépendant) ; 7) SPEC-SYNC-023 (troc) ;
8) SPEC-SYNC-024/025 (politique/guildes au join, indépendant) ;
9) SPEC-SYNC-026 (objets au sol, indépendant — corrige le trou de couverture
relevé par la revue entre `audit-limites.md` LIM-16 et `audit-synchro.md`).

**Partage entre lots** : les nouveaux modules purs et leurs handlers dans
`server.js` se développent en parallèle une fois `INV_MAJ`/`state.inv` serveur
en place, à condition que chaque sous-lot ajoute son propre bloc
`case NP.MSG.X:` en fin de switch dans `traiter()`.

---

## L44 — sécurité et fiabilité du serveur

**Fichiers possédés** : `server.js` (try/catch dans `traiter()`,
`process.on('uncaughtException'/'unhandledRejection')`, limite de `tampon`,
compteur de messages/s par client, vérification `Origin` dans le handler
`upgrade`, sauvegarde atomique, extraction en modules, diffusion de
redéfinition de zone), `src/net-protocol.js` (`valider()` étendu pour borner
les coordonnées, détection de trame non masquée dans `decoder()`), `src/admin.js`
(générateur de jeton injecté, purge bornée de `sessions`/`invitations`/
`sanctions`), nouveaux modules purs `src/serveur-monde.js`,
`src/serveur-messages.js`, `src/serveur-reseau.js` (découpage final),
`src/serveur-http.js` (en-têtes de sécurité, éventuel module séparé si le
service de fichiers statiques grossit).

**Nouveaux messages `NP.MSG.*`** : `CHUNK_OVERRIDES_DEMANDE` (client → serveur,
position de chunk), `CHUNK_OVERRIDES_REP` (serveur → client, overrides de ce
chunk uniquement), un message de mise à jour de zone diffusé sans délai aux
clients dont la position tombe dans la région modifiée par un admin
(SPEC-SECU-012).

**Structures de données** : compteur `{ n, fenetreDebut }` par client pour
l'anti-flood (messages et chat séparément), constantes `TAMPON_MAX` et
`COORD_MAX` en tête de `server.js`/`net-protocol.js`, index des overrides par
clé de chunk (`Map` chunkKey→liste d'overrides).

**Dépendances internes** : indépendant de L43 dans sa majorité.
1) SPEC-SECU-001/002 (try/catch + uncaughtException, le plus critique et le
plus isolé) ; 2) SPEC-SECU-003/004 (tampon borné, trame non masquée) ;
3) SPEC-SECU-005/006 (anti-flood) ; 4) SPEC-SECU-007/008 (portée avant
génération, bornes coordonnées) ; 5) SPEC-SECU-009 (jetons admin, indépendant) ;
6) SPEC-SECU-010/011 (en-têtes HTTP, Origin, indépendants) ; 7) SPEC-SECU-012
(diffusion de zone, indépendant) ; 8) SPEC-SERVEUR-003/004 (sauvegarde
atomique + asynchrone, indépendant, le plus urgent selon l'audit perf) ;
9) SPEC-SERVEUR-005 (purge admin, indépendant) ; 10) SPEC-SERVEUR-006 (dépend
des conteneurs/véhicules définis en L43 — après SPEC-SYNC-012/022) ;
11) SPEC-SERVEUR-007 (cadence adaptative, indépendant) ; 12) SPEC-SERVEUR-009
(BIENVENUE incrémental, indépendant) ; 13) SPEC-SERVEUR-008 (découpage en
modules, **en tout dernier** — voir vague 4 ci-dessous).

**Partage entre lots** : SPEC-SECU-001 à 008 touchent toutes `server.js`
autour de la boucle `socket.on('data', ...)` et `traiter()` — à regrouper dans
un seul sous-lot pour éviter les conflits de fusion sur cette zone dense.
SPEC-SECU-009 (`admin.js`) et SPEC-SECU-010/011 (service HTTP statique) sont
des fichiers/zones séparés, faisables en parallèle. SPEC-SERVEUR-008
(découpage) touche potentiellement tout `server.js` et doit attendre la fusion
de **tous** les lots qui modifient `server.js`, y compris ceux de L43, L45 et
L46 (pas seulement les siens) — voir le plan de vagues ci-dessous.

---

## L45 — économie, métiers et transport

**Fichiers possédés** : nouveau module pur `src/economie.js` (état
`{ prix: Map<offreId, {base, courant, stock}>, masseSuivie }`, API
`creerEtat`, `prixCourant`, `acheter`, `vendre`, `prixBaseRegional`,
`appliquerFraisBanque`, `serialiser`/`appliquer`), nouveau module pur
`src/metiers.js` (état par lieu `{ stocks, progression, joueurStatuts }`, API
`creerEtat`, `recolter`, `consommerMinerai`, `enregistrerEchange`, `remiseDe`),
`habitats.js` (retouches légères pour exposer des identifiants d'offre
stables), `src/vehicules.js` (étendu : `carburant` dans `DEFS[type]`, champ
`integrite` sur le modèle de `pv`/`degats`), nouveau module pur
`src/risquesTransport.js` (`probabiliteAttaque`, `resoudreAttaque`),
`src/caravanes.js` (étendu : `cargaison`, `garde: bool`).

**Messages réseau** : aucun nouveau — le commerce passe par `TROC`
(SPEC-SYNC-023, L43) ; prix courant et solde banque restent diffusés par les
canaux existants (serveur déjà autorité pour la banque, HABITAT-006).

**Structures de données** : `cargaison` attachée à l'objet caravane
(`{objetId, qte}[]`), sérialisée avec le convoi.

**Dépendances internes** : Lot 1 (ECO-001/002/003/005, METIER-001 à 005)
indépendant de l'existant ; Lot 2 (TRANSPORT) dépend du Lot 1 pour
ECO-004/TRANSPORT-004 (cargaison = inventaire économique) mais démarre en
parallèle sur TRANSPORT-001/002 (carburant, réparation) qui ne dépendent que
du module véhicule.

**Partage entre lots** : `src/vehicules.js` est aussi étendu côté simulation
serveur par L43 (`src/serveur-vehicules.js`) — même domaine des deux côtés, à
coordonner pour ne pas dupliquer la logique de déplacement.

---

## L46 — factions, quêtes, PvP, environnement et donjons interconnectés

**Fichiers possédés** : `src/politique.js` (étendu : `tourUnJour` prélève
`f.ressources.or -= coutRaid`, helper `coutAction(type)`), nouveau module pur
`src/territoireZones.js` (`zonePourTerritoire`, appelé par `zones.js:zoneEn`
en aval de la densité mais en amont d'une région définie par admin),
nouveau module pur `src/catastrophesImpact.js` (`impactBatiments`,
`impactRoute`, `impactPopulation`), nouveau module pur `src/quetes.js`
(`genererQuetesFaction`, `genererQueteCatastrophe`, `accepter`, `progresser`,
`remettre`), `src/donjons.js` (étendu : champ `factionId`, `delaiRegeneration`
déterministe par coffre), nouveau module pur `src/pvpEnjeux.js`
(`resoudreButin`, `enregistrerMeurtre`, `reputationApres`, `proposerDuel`,
`accepterDuel`, `duelActif`), `src/guildes.js` (`peutBlesser`, déjà correct —
SPEC-PVP-002 documente et teste le cas des factions secondaires),
`src/zones.js`/`caravanes.js` (lecture des impacts environnementaux),
`server.js` (zone combat `ATTAQUE`, ~L515-546, appelle `pvpEnjeux.resoudreButin`
avant de notifier le chat).

**Messages réseau** : nouveau `NP.MSG.QUETE` (accepter/progresser/remettre,
arbitrage serveur unique) ; le PvP reste entièrement côté serveur par
construction (COMBAT-002), sans message supplémentaire.

**Structures de données** : événements ENV (impacts, migrations) journalisés
dans une structure commune consommée par `quetes.js:genererQueteCatastrophe`
et par `metiers.js` (offre agricole ENV-003).

**Dépendances internes** : Lot 3-FACTION/QUETE/ENV/DONJON dépend de L45
(ECO-001/007 pour QUETE-003/005 et DONJON-018, METIER-001 pour ENV-003) et de
TRANSPORT-003 (L45) pour le risque de caravane en guerre/éruption, mais
FACTION-014/015/016/017 et ENV-001/002/004/005 démarrent indépendamment sur
l'existant. Lot 4-PVP est indépendant de tout le reste du lot (ne dépend que
de `zones.js`, `guildes.js`, `factions.js` déjà en place).

**Partage entre lots** : `server.js` autour de L515-546 (combat) est aussi la
zone PvP de L44/L43 — un seul sous-lot touche cette portion à la fois.

---

## L47 — performance de génération et de maillage

**Fichiers possédés** : `src/mesher.js` (reste pur, gagne un mode « fusion »
optionnel paramétrable pour les tests Node sans Worker), `src/noise.js`
(cache de grille interpolée, pattern `densite.js:111-125`), `src/world.js`
(appelle le bruit interpolé au lieu de `fbm3` direct), nouveaux
`src/worker-monde.js` (génération) et `src/worker-maillage.js` (pool de
maillage, charge `mesher.js` tel quel), `src/game.js` (orchestration de la
file de demandes et du budget par image — coordiner avec L48 sur `game.js`),
`src/ui.js` (panneau F3), `tests/bench-generation.js`,
`tests/bench-maillage.js`, `tests/budget-perf.json` (nouveaux, dérivés de
`scratchpad/bench.js`).

**Messages worker** (pas de réseau, communication thread principal ↔ Worker) :
génération — principal→worker `{type:'genere', cx, cz, graine}` ;
worker→principal `{type:'chunk', cx, cz, blocks (Transferable Uint16Array),
etats (Transferable), eau, version}`. Maillage — principal→worker
`{type:'maille', cx, cz, pass, snapshot des blocs voisins nécessaires,
version}` ; worker→principal `{type:'maillage', cx, cz, pass, version,
positions/normals/uvs/... (Transferable Float32Array/Uint32Array)}`. Le champ
`version` rejette un résultat périmé (SPEC-PERF-009).

**Repli sans Worker/OffscreenCanvas** : détection `typeof Worker ===
'undefined'` au démarrage ; bascule sur génération/maillage synchrones avec le
même budget par image (SPEC-PERF-005/006), en dégradant silencieusement,
comme le fait déjà `MC.Lointain` pour la grille lointaine par petits lots
(`avancer(budget)`).

**Dépendances internes / vagues** : Lot A — bruit et génération
(SPEC-PERF-001 à 003, 017 partiel, 018), aucune dépendance externe. Lot B —
greedy meshing (SPEC-PERF-011 à 013, 017 partiel), indépendant du lot A et du
passage en Worker ; seul risque de collision : les deux lots touchent
`bench.js`/ses dérivés, à coordonner sur les fichiers de banc uniquement.
Lot C — Workers génération+maillage (SPEC-PERF-004 à 010, 014), dépend des
lots A et B pour maximiser le gain, mais peut se développer en parallèle sur
une base de mesher/noise inchangés puis se rebrancher.

---

## L48 — rendu fiable et adaptatif

**Fichiers possédés** : `src/render.js` (contexte perdu/restauré, réfraction
limitée en fréquence/distance, antialias/DPR adaptatifs,
`WEBGL_debug_renderer_info`, `InstancedMesh` pour les mobs, frustum et
occlusion culling de chunks), `src/game.js` (budget de frame unique orchestrant
les dégradations, réutilise `ajusterVue`/`g.fps` — coordiner avec L47 sur
`game.js`, zones distinctes : boucle de qualité vs orchestration de file de
génération), `src/ui.js` (message perte de contexte, avertissement rendu
logiciel, panneau F3 — partagé avec SPEC-PERF-016 de L47), `src/lointain.js`
reste la référence de patron (grille par lots, adaptatif sur `g.fps`) sans
modification de fond.

**API interne** : `render.qualite.degrader()`/`render.qualite.ameliorer()`,
pilotées par une seule boucle de décision (game.js, à côté d'`ajusterVue`) ;
`render.perf()` retourne `{ calls, triangles, fps, fpsP50, fpsP95, genererMs,
maillerMs }`, alimentant à la fois le panneau F3 (SPEC-PERF-016) et le budget
de frame (SPEC-RENDU-008/015) depuis la même source. Pas de nouveau message
réseau : purement client.

**Plan de repli** : si `WEBGL_debug_renderer_info` est absent, SPEC-RENDU-010/
011 se désactivent silencieusement plutôt que d'échouer. Si `webglcontextlost`
n'est jamais déclenché par l'implémentation (environnement headless de test),
SPEC-RENDU-001/002 se vérifient en déclenchant l'événement synthétiquement
(`canvas.dispatchEvent` via `WEBGL_lose_context` quand disponible, sinon test
ignoré proprement plutôt que faussement vert).

**Dépendances internes** : indépendant de L47 (touche le pipeline de rendu,
pas la génération), entièrement parallélisable en interne.

---

## Vagues de parallélisation (les six lots, fichiers disjoints)

Contrainte : au plus 4 lots en parallèle. `server.js` est le fichier le plus
disputé — touché par L43, L44 et une partie de L46 (combat PvP) — les lots qui
le modifient sont volontairement étalés sur plusieurs vagues plutôt que lancés
tous ensemble, même quand leur logique métier est indépendante, pour limiter
les conflits de fusion textuelle sur un même fichier.

### Vague 1 — indépendants, fichiers disjoints (4 en parallèle)

| Sous-lot | Contenu | Fichiers possédés |
|---|---|---|
| **A1** (L44) — Fiabilité transport | try/catch `traiter()`, `uncaughtException`, tampon borné, anti-flood, bornes coordonnées, trame non masquée (SPEC-SECU-001 à 008) | `server.js` (zone boucle `socket.on('data')`/`traiter()` bas niveau), `src/net-protocol.js` |
| **A2** (L47) — Bruit et génération | cache de coins interpolé pour le bruit de terrain (SPEC-PERF-001 à 003, 017 partiel, 018) | `src/noise.js`, `src/world.js`, `tests/bench-generation.js`, `tests/budget-perf.json` |
| **A3** (L47) — Greedy meshing | fusion des faces coplanaires (SPEC-PERF-011 à 013, 017 partiel) | `src/mesher.js`, `tests/bench-maillage.js` |
| **A4** (L48) — Fiabilité/adaptatif rendu | contexte WebGL perdu/restauré, réfraction/antialias/DPR adaptatifs, InstancedMesh mobs, panneau F3 (SPEC-RENDU-001 à 015, SPEC-PERF-015/016) | `src/render.js`, `src/ui.js`, `src/game.js` (boucle de qualité uniquement) |

### Vague 2 — dépend de la vague 1 (4 en parallèle)

| Sous-lot | Contenu | Fichiers possédés | Dépendance |
|---|---|---|---|---|
| **B1** (L43) — Inventaire et conteneurs serveur | `state.inv`/`state.equip` serveur, `INV_MAJ`, `CRAFT`, `EQUIP`, `CONTENEUR_*`, `DISTRIB` corrigé (SPEC-SYNC-007 à 017) | `src/player.js`, `src/serveur-conteneurs.js`, `server.js` (zone routage applicatif, distincte de A1), `src/net-protocol.js` (nouveaux `MSG.*`) | Fusionner A1 avant de démarrer, pour partager `server.js` sans conflit de zone |
| **B2** (L45) — Économie et métiers | prix dynamique, stocks de métiers (SPEC-ECO-001 à 007, SPEC-METIER-001 à 005) | `src/economie.js`, `src/metiers.js`, `habitats.js` (retouches légères) | B1 (réutilise `TROC`/`CONTENEUR_TRANSFERT` au lieu d'un message propre) |
| **B3** (L47) — Workers génération+maillage | déport du bruit et du mesher en Web Worker (SPEC-PERF-004 à 010, 014) | `src/worker-monde.js`, `src/worker-maillage.js`, `src/game.js` (orchestration file/budget — coordonner avec A4 sur `game.js`) | A2 + A3 (recompose bruit + greedy meshing en Worker) |
| **B4** (L46) — PvP enjeux et sanctions | butin PvP, réputation, duels, succès (SPEC-PVP-001, 002-corrigé, 003 à 006) | `src/pvpEnjeux.js`, `server.js` (zone combat `ATTAQUE`, ~L515-546) | Aucune dépendance réelle ; reporté ici pour respecter la limite de 4 lots simultanés et espacer les lots qui touchent `server.js` |

### Vague 3 — dépend de la vague 2 (3 en parallèle)

| Sous-lot | Contenu | Fichiers possédés | Dépendance |
|---|---|---|---|---|
| **C1** (L43/L44) — Persistance joueur, véhicules, monde diffusé | `etatMonde`/`appliquerEtatMonde` étendus, tick cultures/feu diffusé, registre joueur par nom, sauvegarde atomique/asynchrone, purge admin (SPEC-SYNC-018 à 025, SPEC-SERVEUR-003 à 007, 009) | `server.js` (zone persistance/monde), `src/serveur-vehicules.js`, `src/serveur-troc.js`, `src/admin.js` (purge) | B1 (persistance de l'inventaire) |
| **C2** (L45) — Transport et fret | carburant, réparation, risque de caravane, fret (SPEC-TRANSPORT-001 à 004, SPEC-ECO-004) | `src/vehicules.js` (étendu — coordonner avec `serveur-vehicules.js` de C1, même domaine des deux côtés), `src/risquesTransport.js`, `src/caravanes.js` (étendu) | B2 (ECO-004/cargaison) ; bénéficie de C1 pour la simulation serveur des véhicules |
| **C3** (L46) — Factions, environnement, donjons, quêtes | territoire agissant, catastrophes systémiques, quêtes générées (SPEC-FACTION-014 à 017, SPEC-QUETE-001 à 005, SPEC-ENV-001 à 005, SPEC-DONJON-017/018) | `src/politique.js` (étendu), `src/territoireZones.js`, `src/catastrophesImpact.js`, `src/quetes.js`, `src/donjons.js` (étendu), `src/zones.js`/`src/caravanes.js` (lecture des impacts) | B2 (ECO-001/007, METIER-001) et C2 (TRANSPORT-003 pour le risque de caravane) |

### Vague 4 — dernière, dépend de TOUTES les vagues précédentes qui touchent `server.js`

| Sous-lot | Contenu | Fichiers possédés | Dépendance |
|---|---|---|---|---|
| **D1** (L44) — Sécurité périphérique et découpage | jeton admin `crypto.randomBytes`, en-têtes HTTP, vérification `Origin`, diffusion de zone (SPEC-SECU-009 à 012), découpage de `server.js` en modules purs (SPEC-SERVEUR-008) | `src/admin.js` (jeton), `server.js` (en-têtes HTTP/Origin/diffusion de zone — peuvent démarrer dès la vague 1 sans dépendance ; le découpage en modules, lui, doit attendre) | Le découpage (SPEC-SERVEUR-008) attend la fusion de **B1, B4, C1, C2, C3** dans `server.js` — pas seulement les sous-lots de sécurité qui le précèdent |

Les sous-tâches SECU-009/010/011/012 de D1 sont sans dépendance réelle et
peuvent être avancées dès la vague 1 en parallèle si un cinquième agent est
disponible ; seul le découpage de `server.js` en modules (SPEC-SERVEUR-008)
doit rester en toute dernière étape, après fusion de tous les lots qui
touchent ce fichier (A1, B1, B4, C1, C2 partiellement, C3 partiellement).

Ordre de dépendance conseillé entre les six lots documentaires : L44 (A1) et
L47/L48 (A2-A4) d'abord ; L43 (B1), L45 (B2), le reste de L47 (B3) et L46-PvP
(B4) ensuite ; L43-persistance/L44-fiabilité (C1), le reste de L45 (C2) et le
reste de L46 (C3) après ; le découpage de `server.js` (fin de L44) en tout
dernier.
