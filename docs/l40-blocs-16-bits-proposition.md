> **État au 2026-10-05 — document conservé comme trace de conception.** Cette étude a été écrite
> AVANT l'implémentation de la consolidation de L40 (L40-bis). Elle est livrée dans `master` :
> SPEC-SAVE-017 à 028 sont ✅ (migrations complètes des ids d'objet, registre figé des ids et
> plages, `etatMaxDe`, refus des ids non blocs et bornage de l'état côté serveur, état 0 appliqué
> côté client, format d'ids annoncé à la connexion, monde refusé renommé, ids inconnus conservés,
> maillage sans états vides). Les fiches effectivement écrites sont celles de `SPECS.md` (SAVE-018
> à 028, numérotation différente des « 018 à 031 » proposées plus bas). Écarts connus : l'ancienne
> proposition prévoyait un registre chargé par `core.js` (il est livré comme donnée de test,
> `tests/donnees/ids.json`) ; D6 (ids auto-incrémentés) n'est couvert que par ce registre de test ;
> la fiche SAVE-021 dit « état 0 » pour les portes et trappes alors que la borne réelle est 1 (bit
> du dernier signal, SPEC-MECA-006). Non traités : Q3 (séparer les minerais mutualisés, refusé),
> Q10 (atlas, inchangé).

# L40 — blocs sur 16 bits : état des lieux, défauts, lots et fiches proposées

> **Statut : proposition, en attente de l'approbation de l'utilisateur.** Rien
> de ce document n'est encore dans `SPECS.md` ni dans `PLAN.md`. Audit fait le
> 2026-10-03 sur `master` à `219353c`, par lecture du code et par des mesures
> sous Node (scripts jetables, non commités).

## 0. Constat principal : le cœur de L40 est déjà livré

`PLAN.md` (l. 122) et `docs/feuille-de-route.md` (ligne 2.1, et les « Principes »
l. 34-36) présentent L40 comme **à faire**, avec « les 128 identifiants de bloc
sont épuisés ». **C'est périmé** :

- le commit `9f92f99` du 2026-09-24, `feat(SPEC-SAVE-017): blocs sur 16 bits et
  état par bloc (L40)`, a fait le travail : chunks en `Uint16Array`, objets
  déplacés de 128 à `FIRST_ITEM = 4096`, un état d'un octet par bloc
  (`world.getEtat/setEtat`, tampon partagé tant qu'il est vide), migration
  des sauvegardes v1/v2 vers v3 et du monde serveur v1 vers v2, protocole qui
  accepte des ids jusqu'à 65535. **SPEC-SAVE-017 est ✅** (`SPECS.md` l. 686),
  couverte par `tests/spec-blocs16.js` (9 tests) ;
- les lots qui devaient attendre L40 ont avancé depuis : **toutes** les fiches
  de L24 (CONSTR-001 à 007, INTERIEUR-001 à 003), L25 (OBJET-001 à 005), L29
  (MECA-001 à 008), MER-010/011, SOUTERRAIN-001 à 003, LUMIERE-007 et
  MINERAI-001/002 sont ✅ dans `SPECS.md`. Il y a aujourd'hui **255 blocs
  définis, dont 128 au-delà de 127** (ids jusqu'à 960).

L'audit a pourtant trouvé **des défauts réels** : trois pertes de données dans
la migration (reproduites), des trous de validation côté serveur, une
désynchronisation d'état client/serveur, un écrasement possible d'un fichier
de monde refusé, et des identifiants qui ne sont pas figés. **La proposition
porte donc sur un lot de consolidation (« L40-bis », sous-lots A à E du § 4),
pas sur un nouveau format.** Le format actuel est le bon (§ 2).

---

## 1. État des lieux chiffré

### 1.1 Espace d'identifiants (mesuré en chargeant `src/core.js` sous Node)

| Plage | Contenu | Définis | Source |
|---|---|---|---|
| 0 | air | — | `core.js:28` |
| 1-127 | blocs d'origine (terrain, végétation, mer, minerais, portes 109-118…) | 127 / 127 | `core.js:27-80` |
| 128-199 | **libre** (ancienne plage des objets) | 0 | — |
| 200-399 | formes L24 : 16 escaliers, 10 dalles, clôture, muret, vitre, rambarde (200-229) | 30 | `core.js:557-566` (ids auto-incrémentés, voir D6) |
| 400-599 | matériaux L24 : verres teintés, bétons, laines, terres cuites, poutres, feu… (400-438) | 39 | `core.js:101-116` |
| 600-649 | coffres piégé et surprise L25 (600, 601) | 2 | `core.js:1014-1015` |
| 650-849 | mécanismes L29 (650-685) | 36 | `core.js:81-99` |
| 850-899 | flore marine L35 (850-859) | 10 | `core.js:395-398` |
| 900-4095 | mobilier L24 (950-960, plage réservée 950-1099) ; le reste **libre** | 11 | `core.js:1172-1178` |
| 4096-65535 | objets (4096-4669 utilisés) | 177 | `core.js:117-180`, `:1034` |

- **Blocs** : 255 définis, id max 960, **3 840 ids libres** sous `FIRST_ITEM`
  (72 dans 128-199, 633 dans les trous des plages réservées, 3 135 au-delà de 960).
- **Objets** : 177 définis, 4096-4669 ; 60 866 ids libres jusqu'à 65535.
- Aucun doublon de valeur dans `B` ni dans `I`, aucun `B.*` sans définition.
- **Tuiles d'atlas** (le vrai plafond suivant) : 1024 (`atlas.js:7`,
  `mesher.js:11`, 16 × 64 tuiles de 16 px) ; 437 indices référencés, le plus
  haut est 918 ; **105 libres après le dernier**, 587 trous en tout. Agrandir à
  16 × 128 (texture 256 × 2048) ne coûte qu'une constante dans deux fichiers.

### 1.2 Où vit un identifiant de bloc, et sous quelle forme

| Lieu | Forme | Fichier:ligne | État |
|---|---|---|---|
| Chunk (client, serveur, worker) | `Uint16Array(16×128×16)` = 64 Kio | `world.js:351` | 16 bits ✅ |
| État de bloc | `Uint8Array` 32 Kio, **partagé vide** (copy-on-write) jusqu'à la 1re écriture | `world.js:19`, `:359`, `:502`, `:542`, `:845` | 8 bits |
| Modifications du joueur | `Map` « x,y,z » → id, et `etatsOverrides` « x,y,z » → état | `world.js:27`, `:33` | sans limite |
| Génération et maillage hors thread | tampons transférés ; voisins copiés par `slice()` | `taches-chunks.js:20`, `:110-122` | 16 bits ✅ (voir D8) |
| Mailleur | lit `blocks[idx]` et `C.BLOCKS[b]` ; l'état seulement pour `MC.Formes.boitesBloc` | `mesher.js:281-297`, `:326` | ✅ |
| Lumière | tables `EMISSION`, `OPAQUE`, `FILTRE` indexées par id, taille `FIRST_ITEM` | `lumiere.js:24-36` | ✅ |
| GPU / shaders | **aucun id** : le mailleur traduit en coordonnées d'atlas | `mesher.js:45-46`, `:121-122` | sans objet |
| Sauvegarde locale (`MC.Save`) | JSON v3 : `overrides [x,y,z,id]`, `etats [x,y,z,état]` | `save.js:11`, `:16-41` | ✅ |
| Fichier de monde serveur | JSON v2 : mêmes listes + conteneurs, registre des joueurs | `server.js:322-393`, `:460-472` | ✅ |
| Import de parties (`localStorage` → disque) | `MC.PartiesFichier.migrerSauvegarde`, s'appuie sur `migrerV1/V2` | `parties-fichier.js:111-181` | défauts D1-D3 |
| Réseau | JSON texte ; `BLOC.id` ≤ 65535, `BLOC.etat` ≤ 255 ; overrides `[x,y,z,id,état]` | `net-protocol.js:367`, `:372` ; `server.js:2225` | ✅ (voir D4, D5, D7) |
| Piles d'inventaire, conteneurs, soutes | `ID_MAX: 65535` | `contrats-vague2.js:64`, `contrats-archi.js:250`, `vehicules.js:418` | ✅ |
| Livre des recettes | boucle `1..FIRST_ITEM` | `livre.js:131` | ✅ |

### 1.3 Relevé exhaustif des « 127 / 128 / 7 bits / Uint8 / 255 »

Recherche sur `src/`, `server.js` et `tests/` (motifs `127`, `128`, `255`,
`256`, `4095`, `4096`, `65535`, `0x7f`, `0xff`, `Uint8Array`, `Uint16Array`,
`Int8Array`, « 7 bits », « 8 bits », « un octet », `FIRST_ITEM`).

**a) Code qui porte réellement une limite d'identifiant ou d'état**

| Fichier:ligne | Ce qu'il fait | Verdict |
|---|---|---|
| `core.js:169` `ANCIEN_FIRST_ITEM = 128` | pivot de migration v2 → v3 | voulu |
| `core.js:173` `DECALAGE_OBJETS_V1 = 64` | pivot de migration v1 → v2 | voulu |
| `core.js:176` `FIRST_ITEM = 4096` ; `:181-182` `isBlock`/`isItem` | frontière blocs/objets | voulu |
| `core.js:1039` `DEC = FIRST_ITEM - ANCIEN_FIRST_ITEM` | objets L25 déclarés dans l'ancien espace puis décalés | voulu, fragile (D6) |
| `save.js:136`, `:151-152` | migrations `id >= 64`, `id >= 128` | **incomplètes (D1-D3)** |
| `world.js:842` `Math.min(255, etat)` | état borné à un octet | voulu |
| `net-protocol.js:367` `msg.id > 65535` | id réseau borné à 16 bits | voulu, mais n'exige pas un bloc défini (D4) |
| `net-protocol.js:372` `msg.etat <= 255` | état réseau borné | voulu, mais pas par famille (D5) |
| `circuits.js:354-356` `(etat >> 1) & 0x7f` | compteur sur 7 bits + sortie sur 1 bit : **l'octet est plein** | voir § 2.3 |
| `circuits.js:362-364` `etat & 15`, bit 4 | comparateur : 5 bits | ok |
| `circuits.js:419-434` `etat & 7`, bit 3 | piston : orientation 3 bits + sorti 1 bit | ok |
| `circuits.js:297`, `:337-340` bit 0 | dernier signal vu (portes, trappes, appareils) | ok |
| `formes.js:50-53` | escalier : orientation 2 bits, inversion 1, forme d'angle 3 = **6 bits** | ok |
| `formes.js:197-198` | meuble : orientation 2 bits, variante 1 | ok |
| `lumiere.js:24`, `:35` | tables de taille `FIRST_ITEM` | ok |
| `contrats-vague2.js:64`, `contrats-archi.js:250`, `vehicules.js:418` | piles 1..65535 | ok |

**b) Commentaires périmés (faux aujourd'hui)**

| Fichier:ligne | Affirmation | Réalité |
|---|---|---|
| `core.js:22-24` | « la marge entre les derniers blocs définis (127) et FIRST_ITEM » | id max 960 |
| `core.js:60-61`, `:216-226` | portes : « pas de métadonnées par bloc », « l'état SONT l'identifiant » | les états existent ; les portes gardent 10 ids par choix (question Q4) |
| `core.js:65-69` | « le dernier bloc libre est 127 (128 = premier objet). Neuf identifiants pour dix matières » | 3 840 ids libres |
| `core.js:447-451` | « Faute d'identifiants de bloc libres (127 au plus) » | idem (question Q3) |
| `world.js:13-18` | « aujourd'hui, aucun contenu ne pose encore d'état (voir L24/L29) » | escaliers, dalles, meubles, circuits en posent ; la génération aussi (mesuré § 1.4) |
| `world.js:349-350` | « la génération elle-même ne pose encore que des ids < 128 » | mesuré : jusqu'à 958, 1 648 à 6 999 cases > 127 pour 169 chunks |
| `server.js:334-336` | « aucun objet d'inventaire ici » (fichier de monde) | le fichier porte `conteneurs` et `joueurs` depuis B1 (sans conséquence : toujours écrits dans le nouvel espace) |
| `tests/spec-blocs16.js:11-13` | « marge laissée libre entre les derniers blocs définis (127) » ; `GROS_ID = 300` | 300 est dans la plage réservée aux formes (200-399) : libre aujourd'hui, à déplacer dans une plage libre déclarée |
| `PLAN.md:122`, `feuille-de-route.md:34-36`, `:77`, `:86`, `:94-95` | L40 à faire, L24/L29/L35 « après L40 » | voir § 0 |

**c) Sans rapport avec les identifiants (vérifiés, à ne pas toucher)**

`net-protocol.js:71` (`WORLD_H = 128`, hauteur du monde, doublon de
`core.js:15`) ; `net-protocol.js:223-251` (longueurs de trame WebSocket 126/127) ;
`world.js:362-364`, `:411-484`, `mesher.js:215`, `taches-chunks.js:82`,
`render.js:541` (sens du courant ×127 en `Int8Array`, profondeur d'eau ≤ 255) ;
`circuits.js:377` (altitude max 128) ; `server.js:1149` (128 blocs par tic) ;
`habitats.js:188` (plafond 4096 lieux) ; `atlas.js:630-638` (tuiles 127 « plume »
et 128 « os » : indices de tuile, pas d'id) ; couleurs RGB 255 de `atlas.js`,
`carte.js`, `lointain.js`, `render.js`, `ui.js` ; `mesher.js:566` (`visite` du
maillage glouton) ; `lointain.js:19`, `game.js:1144-1148`, `ombres.js:97` (grilles
de 256).

### 1.4 Mesures (Node, graines 20260921 / 42 / 7, rayon 6 = 169 chunks)

| Mesure | 20260921 | 42 | 7 |
|---|---|---|---|
| Génération des 169 chunks (thread unique) | 805 ms | 1 098 ms | 283 ms |
| Chunks dont l'état a été alloué | **0** | **3** | **0** |
| Cases portant un état non nul | 0 | 76 | 0 |
| Cases dont l'id > 127 | 6 999 | 1 648 | 4 814 |
| Plus grand id généré | 856 | 958 | 857 |
| Maillage opaque de 121 chunks | 1 019 ms | 1 248 ms | 844 ms |

Le partage du tampon d'état vide paie : moins de 2 % des chunks en allouent un.
Le commit `9f92f99` avait mesuré +17 % de mémoire résidente (doublement du
tampon de blocs) et des temps de génération/maillage inchangés à ± 3 %.

Mémoire des blocs d'un chunk (32 768 cases) : 32 Kio en 8 bits, **64 Kio en
16 bits**, + 32 Kio d'état si alloué. Au rayon par défaut (6, 169 chunks) :
10,6 Mio de blocs ; au rayon maximal des options (18, jusqu'à 1 369 chunks si
tous chargés pleins) : 85,6 Mio, + 42,8 Mio d'états dans le pire cas (tous
alloués).

### 1.5 Défauts trouvés

| # | Défaut | Preuve | Gravité |
|---|---|---|---|
| **D1** | `migrerV1`/`migrerV2` ne renumérotent pas la **banque** (`banque`, 27 cases, présente en v1/v2). Un objet 128..255 reste 128..255 : soit un id indéfini (perte : « ?129 » pour le charbon), soit **un autre bloc** — les anciens objets 200-221 (carte, seau, porte, cuivre…) deviennent des **escaliers et dalles** (200-221). L'import ARCHI-015 hérite du défaut (`parties-fichier.js:151-157` copie la banque telle quelle dans `soloJoueur.banque`) | reproduit : v2 `banque [[129,5],[137,3]]` → inchangée après `migrerV2` ; `nameOf(129) = '?129'` | **haute** (perte silencieuse) |
| **D2** | Idem pour les **soutes de véhicules** (`vehicules[k][5]`, présentes depuis L11) — en solo et dans `extras.vehicules` à l'import | reproduit : soute `[[130,2]]` (lingots de fer) inchangée | haute |
| **D3** | Idem pour les **indices d'objet d'une enquête** (`histoire.enquete.indices[].objet`, L21, ids pris dans `[EMERALD, GOLD_INGOT, BONE, DIAMOND, CARTE]`) : l'indice demande un id qui n'existe plus (ou un escalier pour la carte, 200) → enquête bloquée. L'épopée (clés de chapitres) et la colonie (ids de blocs < 128) ne sont pas touchées | reproduit : indice `objet: 137` inchangé ; `recits.js:183` compare cet id à l'inventaire | moyenne |
| **D4** | Le serveur accepte un `BLOC` dont l'id n'est **pas un bloc défini** (id d'objet ≥ 4096, ou 961..4095) en créatif et avec `MC_TEST_POSE_LIBRE` : `blocAutorise` (`server.js:3848-3870`) ne vérifie pas `C.BLOCKS[m.id]`, et `debiterPose` est sauté (`server.js:2900`). L'id entre dans `overrides`, dans le fichier de monde, et part chez tous les clients | lecture du code | moyenne (créatif, tests de charge) |
| **D5** | L'état envoyé par un client est accepté pour **n'importe quel bloc** (0..255), sauf portes et trappes (`server.js:2876`) : un compteur, une batterie ou une pierre peuvent recevoir un état arbitraire, conservé à vie dans `etatsOverrides` | lecture du code | basse |
| **D6** | Les ids des formes L24 sont **auto-incrémentés** dans l'ordre des listes (`PROCHAIN_ID_FORME++`, `core.js:565-566`) : insérer un escalier en milieu de liste décale toutes les dalles, clôtures et murets suivants **et corrompt toutes les sauvegardes** sans qu'aucun test ne rougisse. Aucun registre ne fige les ids | lecture du code ; aucun test ne compare les ids à une référence | **haute** (latente) |
| **D7** | Ni `REJOINDRE` ni `BIENVENUE` ne portent de version : un client d'une autre version (paquet L37, onglet resté ouvert pendant une mise à jour) parle un autre espace d'ids sans que personne ne le sache | `net-protocol.js:356-360`, `server.js:2624-2625` | moyenne |
| **D8** | `instantaneVoisins` copie l'état de chaque voisin même vide (`c.etats.slice()` sur le tampon partagé, `taches-chunks.js:117`) : **9 × 32 Kio = 288 Kio** copiés et transférés pour rien à chaque maillage hors thread (sur 864 Kio en tout) | lecture du code ; `world.js:567` montre que `null` est déjà accepté au retour | basse (perf) |
| **D9** | Le client **ignore un état ramené à 0** : `onBloc`, `BIENVENUE` et `onOverridesChunk` font `if (etat) world.setEtat(...)` (`game.js:262`, `:293`, `:301`). Or les circuits diffusent un changement d'état à id constant (`server.js:4504-4508`) : batterie vidée, répéteur éteint, compteur remis à 0, piston orienté nord qui rentre (`orient 0 | rentré 0 = 0`), bit de signal d'une porte effacé → **le client garde l'ancien état** | lecture du code | moyenne (désynchronisation visible) |
| **D10** | Un fichier de monde **refusé** (JSON illisible, `v` inconnu) fait démarrer une nouvelle carte (`server.js:681-684`) que la sauvegarde périodique **écrit par-dessus** : le monde refusé est perdu (retour à une version antérieure du jeu, fichier abîmé) | lecture du code | haute (rare) |
| **D11** | Commentaires et documents périmés (§ 1.3 b) | relevé | basse |

---

## 2. Format cible

### 2.1 Alternatives chiffrées

Chunk de 32 768 cases ; « mémoire » = blocs + états d'un chunk ; « 169 » = rayon 6.

| Option | Id max | Bits d'état | Mémoire / chunk | 169 chunks | Coût de réécriture | Verdict |
|---|---|---|---|---|---|---|
| **A — actuel** : id 16 bits + état 8 bits à part, partagé tant que vide | 4 095 (blocs) | 8 | 64 Kio (+32 si états) | 10,6 Mio (+0,1 mesuré) | nul | **recommandé** |
| A' : id 16 bits + état **16 bits** à part, partagé | 4 095 | 16 | 64 Kio (+64 si états) | 10,6 Mio (+0,2 mesuré) | faible : `Uint8Array` → `Uint16Array` (`world.js` ×5), bornes 255 → 65535 (`world.js:842`, `net-protocol.js:372`), état v4 | réserve si un bloc dépasse 8 bits |
| B : un mot 16 bits = 12 bits d'id + 4 d'état | 4 095 | 4 | 64 Kio | 10,6 Mio | élevé (37 accès `blocks[...]`, toutes les lectures masquées) | **rejeté** : l'escalier veut 6 bits, le compteur 8 |
| B' : 10 bits d'id + 6 d'état | 1 023 | 6 | 64 Kio | 10,6 Mio | élevé | **rejeté** : 960 est déjà pris (94 % du plafond) |
| C : un mot 32 bits = 16 + 16 | 65 535 | 16 | 128 Kio toujours | 21,1 Mio | élevé, et un `Uint32Array` à transférer partout | **rejeté** : double la mémoire de 98 % des chunks qui n'ont aucun état |
| D : palette par section (style Minecraft, 4-8 bits indexés) | illimité | au choix | ~16-32 Kio | 2,6-5,3 Mio | très élevé : indirection dans les boucles chaudes du mailleur, de la lumière, de la physique et des workers | **rejeté pour l'instant** : gain mémoire réel, mais aucun besoin mesuré |
| E : états dans une `Map` creuse par chunk | 4 095 | illimité | 64 Kio + ~60 o par état | ~10,6 Mio | moyen : le mailleur fait une recherche de `Map` par case à forme | rejeté : plus lent au maillage que A pour un gain nul (les états sont déjà creux grâce au partage) |

**Bande passante réseau** : le protocole est en JSON texte ; un override
`[x,y,z,id,état]` pèse ~22 octets, un id à 4 chiffres en coûte 1 de plus qu'à 3.
Aucune des options ne change ce chiffre : le format en mémoire et le format
sur le fil sont indépendants. **Workers** : les tampons sont transférés (sans
copie) au retour ; à l'aller, 9 voisins copiés = 576 Kio de blocs + 288 Kio
d'états vides (D8) → 576 Kio après correction.

### 2.2 Recommandation

**Garder l'option A**, qui est en production depuis le 24 septembre, et la
rendre sûre : figer les ids (D6), déclarer les plages et la disposition des
bits d'état, corriger la migration (D1-D3), valider côté serveur (D4, D5),
appliquer l'état 0 chez le client (D9), annoncer la version (D7), ne jamais
écraser un monde refusé (D10), ne plus copier d'états vides (D8).

### 2.3 Largeur de l'état : 8 bits suffisent-ils ?

Disposition actuelle, famille par famille : escalier 6 bits, dalle 1, meuble 3,
piston 4, comparateur 5, bascule 2, batterie 4 (0..15), générateurs 4,
compteur **8** (1 de sortie + 7 de compte, `circuits.js:354-356`). Les
connexions des clôtures, murets et vitres (CONSTR-004) et les angles
automatiques des escaliers sont **recalculés depuis les voisins**, pas stockés.
L'octet suffit donc aujourd'hui, mais le compteur le remplit : le premier bloc
qui voudrait « connexions (6 bits) + niveau d'énergie (4 bits) » stockés
ensemble dépasserait. La fiche SPEC-SAVE-025 rend ce dépassement **visible
dans un test** au lieu d'une troncature silencieuse ; le passage à A' reste une
décision à prendre ce jour-là (question Q2).

---

## 3. Migration des sauvegardes et compatibilité réseau

### 3.1 Formats en présence

| Format | Où | Versions lues | Versions écrites |
|---|---|---|---|
| Sauvegarde solo `MC.Save` | `localStorage` (avant L50), export `minicraft-parties.json` | v1 (objets dès 64), v2 (objets dès 128), v3 (16 bits + états) | v3 |
| Enveloppe `MC.Saves` | même | `slotV` 2 | 2 |
| Fichier de monde serveur | `parties/<id>.json`, `--monde` | v1 (sans états), v2 | v2 |
| Import d'une partie | `MC.PartiesFichier` | sauvegardes v1, v2, v3 → fichier de monde v2 | — |

Les ids de **blocs** n'ont jamais bougé (1..127 identiques dans les trois
versions) : seuls les ids d'**objets** sont à renuméroter. Il faut donc
recenser **tous** les champs qui portent un id d'objet. Inventaire de
`MC.Save.serialize` (v2, juste avant `9f92f99`) :

| Champ | Porte des ids d'objet ? | Migré aujourd'hui ? |
|---|---|---|
| `player.inv` | oui | oui |
| `chests[k][1]` | oui | oui |
| `furnaces[k][1..3]` | oui | oui |
| `banque` | **oui** | **non (D1)** |
| `vehicules[k][5]` (soute) | **oui** | **non (D2)** |
| `histoire` → `enquete.indices[].objet` | **oui** | **non (D3)** |
| `histoire` → épopée (clés), colonie (ids de blocs < 128) | non | — |
| `overrides`, `crops` | ids de blocs, inchangés | — |
| `succes`, `reperes`, `explores`, `reputation`, `donjons`, `pilles`, `pnjsMorts`, `zones`, `politique`, `guildes` | non | — |
| `player.equip`, `expositions`, `distributeurs`, `economie`, `commandes` | n'existaient pas en v2 | — |

Le fichier de monde serveur v1 ne portait aucun objet (le registre des joueurs
et les conteneurs sont arrivés avec B1, après le passage à 16 bits) : pas de
renumérotation à y faire.

### 3.2 Règles proposées

1. **Une seule fonction par saut de version**, appliquée une fois (`v` monte
   à chaque étape) ; une sauvegarde déjà v3 n'est jamais retouchée (idempotence).
2. **Un registre des champs** (`CHAMPS_IDS` dans `save.js`) classe chaque champ
   de `serialize` : « porte des ids d'objet » (avec la fonction qui le
   migre) ou « sans id ». Un champ ajouté sans classement fait échouer un test
   (SPEC-SAVE-021) : c'est ce qui aurait évité D1-D3.
3. L'import (`migrerSauvegarde`) **n'a pas de chemin à lui** : il passe par
   `MC.Save.migrerV1/V2`, qui deviennent complètes.
4. **Ne jamais écraser ce qu'on ne sait pas lire** (D10).
5. Pas de nouvelle version de format pour ces correctifs : `v` reste 3 (solo)
   et 2 (monde) ; on corrige seulement les fonctions de migration. Une partie
   v2 **déjà migrée** par la version actuelle a perdu sa banque au premier
   chargement : on ne peut pas la réparer après coup (l'ancien id a été
   réécrit en v3) — à dire dans le CHANGELOG.

### 3.3 Compatibilité réseau

Le protocole n'a **pas de numéro de version** (D7). Le client est servi par le
serveur lui-même avec `Cache-Control: no-cache` (`server.js:1974`), donc un
client périmé est rare en local ; il devient courant avec un serveur dédié et
des paquets installés (L37). Proposition (SPEC-SAVE-029) : `REJOINDRE` porte
`version` (`MC.Core.VERSION_JEU`) et `formatIds` (`MC.Core.FIRST_ITEM`) ;
`BIENVENUE` renvoie ceux du serveur ; un écart de `formatIds` est toujours
refusé, la règle sur `version` est la question Q5.

---

## 4. Découpage en lots exécutables

Ordre conseillé par `docs/feuille-de-route.md` : L44 (découpage de `server.js`)
passe en 1.4, **avant** L40 (2.1). Le sous-lot C touche `server.js` en trois
endroits seulement (`blocAutorise`, `REJOINDRE`, reprise du monde au démarrage) :
s'il passe avant L44, il le fait dans la fonction d'origine ; après, dans le
module extrait. Les sous-lots A, B, D ne touchent pas `server.js`.

| Sous-lot | Contenu | Fiches | Fichiers touchés | Parallèle ? | Taille |
|---|---|---|---|---|---|
| **A — Migrations complètes** | banque, soutes, indices d'enquête ; registre `CHAMPS_IDS` ; import ARCHI-015 vérifié | SAVE-018 à 022 | `src/save.js`, (`src/parties-fichier.js` si un chemin de copie doit changer), nouveau `tests/spec-migration-ids.js`, `tests/fichiers-tests.js`, `tests/catalogue.js`, `CHANGELOG.md` | oui, avec B et D | S-M |
| **B — Identifiants figés et états déclarés** | registre versionné des ids ; plages `PLAGES_IDS` ; `etatMax` par bloc ; commentaires périmés corrigés ; `GROS_ID` déplacé dans une plage libre | SAVE-023 à 025 | `src/core.js`, `src/formes.js` et `src/circuits.js` (lecture de `etatMax`, aucun changement de comportement), nouveau `tests/donnees/ids.json`, nouveau `tests/spec-ids.js`, `tests/spec-blocs16.js`, `src/world.js` (commentaires seulement) | oui, avec A et D | S |
| **C — Serveur et réseau** | refus d'un id non-bloc ; état borné par `etatMax` ; état 0 appliqué chez le client (fonction pure `MC.Synchro.appliquerBloc`) ; version à la connexion ; monde refusé jamais écrasé | SAVE-026 à 030 | `server.js`, `src/net-protocol.js`, `src/net.js`, `src/synchro.js`, `src/game.js` (trois appels remplacés), `src/contrats-archi.js` si un motif de refus s'ajoute, nouveau `tests/integration-blocs16.js`, `tests/spec-net.js`, un nouveau test Node pour `MC.Synchro.appliquerBloc` | **après B** (`etatMax`) ; en parallèle de A et D | M |
| **D — Maillage sans copie d'états vides** | voisins sans état transmis `null` | SAVE-031 | `src/taches-chunks.js`, `src/world.js` (exposer « état vide ? »), `tests/spec-workers.js` | oui | XS |
| **E — Documents** | `PLAN.md` (L40 → « fait, consolidation L40-bis » ; L24/L25/L29/L35 → état réel), `docs/feuille-de-route.md` (2.1 découpée en 2.1a-e, « Principes » l. 34-36) | — | `PLAN.md`, `docs/feuille-de-route.md` | par l'agent principal, après approbation | XS |
| *F — optionnel (Q3)* | un filon par matière (cuivre, étain, argent, lapis, émeraude, rubis, saphir, quartz, soufre) au lieu des 4 filons mutualisés | à écrire si oui | `core.js`, `world.js` (`filon`), `atlas.js`, recettes, migration des overrides 119-122 | après B | M |
| *G — optionnel (Q4)* | portes et trappes : 1 id + état au lieu de 10 ids | à écrire si oui | `core.js`, `circuits.js`, `server.js`, `player.js`, `mesher.js`, migration des overrides 109-118 | après B et C | M-L, **déconseillé** |

**Parallélisme** (règle des 4 Sonnet) : A, B, D ensemble (fichiers disjoints) ;
C dès que B est fusionné ; E en fin. **Fusion** : B → A → D → C, portes vertes et
revue adversariale avant chacune.

**Risques et parades**

| Risque | Parade |
|---|---|
| Une migration appliquée deux fois décale deux fois | test d'idempotence : `apply(apply(v2))` = `apply(v2)` ; les migrations ne s'exécutent que sur `v` strictement inférieur |
| Le registre d'ids figé gêne l'ajout de blocs | il n'interdit que de **changer** un id existant ; ajouter = une ligne |
| Le bornage de l'état casse un bloc qui en posait un « en douce » | `etatMax` est calculé à partir des empaqueteurs existants (balayage exhaustif, SAVE-025) avant d'activer le bornage serveur |
| Refus de version trop strict (un correctif 0.5.1 refuse un client 0.5.0) | question Q5 ; `formatIds` seul suffit pour la sûreté des ids |
| C entre en conflit avec L44 sur `server.js` | trois points d'entrée seulement, nommés ci-dessus |
| Sauvegardes v2 déjà migrées avec perte | irréparable ; note CHANGELOG « Corrigé » explicite |

**Tests** : tous les nouveaux tests citent leur fiche (G1/G2) ; les migrations
utilisent des sauvegardes v1/v2 **forgées à la main** dans le test, avec leurs
valeurs d'origine lisibles (aucune vraie sauvegarde ancienne n'existe dans
`parties/`) ; C a un test d'intégration sur un vrai serveur (lancé puis
arrêté), le reste est pur Node.

---

## 5. Fiches proposées (format de `SPECS.md`, section « L40 — technique »)

Numérotation : la dernière fiche SAVE est SPEC-SAVE-017. Toutes en ⏳.

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-SAVE-018 | La migration d'une sauvegarde v1 ou v2 renumérote aussi les objets de la **banque** (`banque`) : un id d'objet de l'ancien espace devient l'objet de même nom dans l'espace actuel ; après chargement, aucune case de la banque ne porte un id indéfini ni un id de bloc qui n'y était pas | test Node : sauvegarde v2 forgée, banque `[[129,5],[200,1]]` → après `MC.Save.apply`, la banque contient 5 × `I.COAL` et 1 × `I.CARTE` (et pas un `ESCALIER_PLANKS`) ; sauvegarde v1, banque `[[65,5]]` → 5 × `I.COAL` | ⏳ |
| SPEC-SAVE-019 | La migration d'une sauvegarde v1 ou v2 renumérote les piles des **soutes de véhicules** (`vehicules[k][5]`) | test Node : v2 forgée avec un bateau dont la soute contient `[[130,2]]` → après `apply`, `MC.Vehicules.serialiser` donne une soute de 2 × `I.IRON_INGOT` | ⏳ |
| SPEC-SAVE-020 | La migration d'une sauvegarde v1 ou v2 renumérote les ids d'objet du **récit** (indices d'objet d'une enquête, `histoire.enquete.indices[].objet`) ; l'indice reste résoluble | test Node : v2 forgée, enquête dont un indice demande l'objet 137 → après `apply`, l'indice demande `I.EMERALD` et un inventaire contenant une émeraude le résout (`MC.Recits`, évènement `inventaire`) | ⏳ |
| SPEC-SAVE-021 | Chaque champ de `MC.Save.serialize` est classé dans `save.js` (`CHAMPS_IDS`) comme « porte des ids d'objet », avec sa migration, ou « sans id » ; un champ de `serialize` absent du classement fait échouer le test ; une sauvegarde v2 forgée où **chaque** champ porteur contient l'id 129 n'en contient plus aucun après migration ; migrer deux fois donne le même résultat que migrer une fois | test Node : clés de `serialize(état complet)` ⊆ clés classées ; balayage des chemins porteurs après `apply` ; `apply(migré)` idempotent | ⏳ |
| SPEC-SAVE-022 | L'import d'une partie v1 ou v2 (`MC.PartiesFichier.migrerSauvegarde`, SPEC-ARCHI-015) produit un fichier de monde dont l'inventaire, la banque (`soloJoueur`), les conteneurs, les soutes (`extras.vehicules`) et le récit (`extras.histoire`) ne portent que des ids de l'espace actuel | test Node : export forgé contenant une partie v2 aux valeurs de SAVE-018 à 020 → les chemins listés ne contiennent que des ids ≥ 4096 (objets) ou de blocs définis | ⏳ |
| SPEC-SAVE-023 | Les identifiants sont figés : un registre versionné (`tests/donnees/ids.json`) associe chaque id de bloc et d'objet à son nom de clé (`B.*`, `I.*`) ; le test échoue si un id existant change de nom, si un nom change d'id, ou si un id disparaît sans être marqué « retiré » ; ajouter un bloc ou un objet ne demande qu'une ligne de plus | test Node : comparaison complète `B`/`I` ↔ registre ; mutation notée dans le test : permuter deux escaliers dans la liste de `core.js` fait échouer le test | ⏳ |
| SPEC-SAVE-024 | Les plages d'identifiants sont déclarées dans `MC.Core.PLAGES_IDS` (nom, premier, dernier) : elles sont disjointes ; chaque bloc défini tombe dans exactement une plage de blocs et sous `FIRST_ITEM` ; chaque objet est entre `FIRST_ITEM` et 65535 | test Node : balayage de `BLOCKS` et `ITEMS` | ⏳ |
| SPEC-SAVE-025 | Chaque bloc déclare `etatMax` (0 par défaut : bloc sans état) ; tout état produit par le jeu (empaqueteurs de `MC.Formes`, transitions de `MC.Circuits`, génération des bâtiments) est ≤ `etatMax` de son bloc, et `etatMax` ≤ 255 | test Node : balayage exhaustif des entrées de chaque empaqueteur et des sorties des circuits pour chaque bloc concerné ; un bloc sans état a `etatMax` 0 | ⏳ |
| SPEC-SAVE-026 | Le serveur refuse un `BLOC` dont l'id n'est ni 0 ni un bloc défini (`C.BLOCKS[id]` présent, id < `FIRST_ITEM`), en survie comme en créatif et avec `MC_TEST_POSE_LIBRE` : la case reste inchangée, l'émetteur reçoit le bloc réel, rien n'entre dans `overrides` ni dans le fichier de monde | test d'intégration (vrai serveur créatif) : `BLOC` id 4097 puis id 3000 → réponse `BLOC` à l'id d'origine, `getBlock` inchangé, fichier de monde sauvegardé sans ces ids | ⏳ |
| SPEC-SAVE-027 | Le serveur borne l'état reçu d'un client à l'`etatMax` du bloc posé : un état supérieur, ou non nul pour un bloc sans état, est ramené à 0 avant d'être posé et diffusé ; `etatsOverrides` ne contient jamais d'état pour un bloc d'`etatMax` 0 | test d'intégration : pose d'une pierre avec `etat: 200` → l'état diffusé et sauvegardé vaut 0 ; pose d'un escalier avec un état valide → conservé | ⏳ |
| SPEC-SAVE-028 | Le client applique tout état reçu du serveur, **y compris 0** : après un `BLOC` (ou un override de `BIENVENUE` / `OVERRIDES`) de même id et d'état 0, `world.getEtat` vaut 0 chez le client ; cette application est une fonction pure (`MC.Synchro.appliquerBloc`) utilisée par les trois chemins | test Node : monde avec une batterie d'état 9 → `appliquerBloc({ id: B.BATTERIE, etat: 0 })` → `getEtat` = 0 ; audit statique : `src/game.js` ne contient plus `if (etat) world.setEtat` ni `if (b[4]) world.setEtat` | ⏳ |
| SPEC-SAVE-029 | `REJOINDRE` porte la version du jeu (`MC.Core.VERSION_JEU`) et le format d'identifiants (`MC.Core.FIRST_ITEM`) ; `BIENVENUE` porte ceux du serveur ; un client dont le format d'identifiants diffère, ou qui n'en annonce aucun, est refusé avec un motif lisible qui donne les deux versions, et aucun de ses messages n'est appliqué | test d'intégration : `REJOINDRE` sans version → refus avec motif « version », connexion fermée, monde inchangé ; avec la même version → `BIENVENUE` contenant `version` et `formatIds` ; `tests/spec-net.js` : `valider` conserve les deux champs | ⏳ |
| SPEC-SAVE-030 | Un fichier de monde que le serveur refuse (JSON illisible, `v` inconnu ou futur) n'est jamais écrasé : il est conservé octet pour octet (renommé `<fichier>.refuse-<horodatage>`), le journal l'indique, et la nouvelle carte se sauvegarde à côté | test d'intégration : fichier `{ "v": 99 }` → serveur démarré puis sauvegarde forcée → le fichier refusé existe toujours, identique ; le journal cite son nouveau nom | ⏳ |
| SPEC-SAVE-031 | Le maillage hors thread ne transporte pas d'état vide : un chunk voisin sans état particulier est transmis avec `etats: null` ; le maillage obtenu est identique à celui d'avant | test Node : `instantaneVoisins` sur un monde sans état → les 9 `etats` valent `null` ; sur un chunk portant un escalier → seul ce chunk a un tableau ; sommets identiques à ceux de `MC.Mesher.buildChunk` sur le monde réel | ⏳ |

Fiche conditionnelle, **à écrire seulement si Q7 = « conserver »** :
SPEC-SAVE-032 — un id de bloc inconnu de cette version (monde écrit par une
version plus récente) est conservé tel quel dans `overrides` et dans le fichier
de monde, et dessiné comme un bloc neutre au lieu d'être perdu.

---

## 6. Questions ouvertes (à trancher par l'utilisateur)

1. **Q1 — Statut de L40.** Acceptez-vous de marquer L40 « fait » (SPEC-SAVE-017 ✅
   depuis le 2026-09-24) et d'ouvrir à sa place **L40-bis — consolidation**
   (2.1a à 2.1e dans la feuille de route), avec les fiches SAVE-018 à 031 ? Et de
   remettre à jour les lignes L24, L25, L29 et L35 de `PLAN.md`, dont toutes les
   fiches sont ✅ (un audit « fiches ✅ mais lot non coché » serait à faire à part) ?
2. **Q2 — Largeur de l'état.** Rester à 8 bits (recommandé : suffisant, mesuré,
   dépassement rendu visible par SAVE-025), ou passer tout de suite à 16 bits
   (option A', +32 Kio par chunk qui porte un état, sauvegarde v4) ?
3. **Q3 — Minerais mutualisés.** Les 4 filons partagés (`MINERAI_METAUX` cuivre +
   étain, `MINERAI_ARGENT` argent + lapis, `MINERAI_GEMMES`, `MINERAI_CRISTAL`)
   n'existent que faute d'ids. Les séparer (sous-lot F) change le jeu (un bloc =
   une matière, de nouvelles textures) et impose de migrer les overrides 119-122
   déjà posés (vers lequel ?). Le faire, ou garder ?
4. **Q4 — Portes et trappes.** Elles encodent orientation et ouverture dans
   10 ids (109-118). Les passer à 1 id + état (sous-lot G) ne libère que 8 ids
   sur 3 840 et touche circuits, serveur et prédiction. Recommandation : ne pas
   le faire. D'accord ?
5. **Q5 — Règle de version réseau.** Refuser seulement un `formatIds` différent
   (minimum sûr), ou aussi une version de jeu différente (égalité stricte, ou
   même `X.Y` en tolérant `Z`) ?
6. **Q6 — Monde refusé au démarrage.** Le renommer en `.refuse-<horodatage>` et
   démarrer une carte neuve (proposé dans SAVE-030), ou refuser de démarrer et
   laisser l'utilisateur décider ?
7. **Q7 — Ids inconnus** (monde écrit par une version plus récente, puis ouvert
   par une plus ancienne). Les conserver et les dessiner neutres (SAVE-032), ou
   refuser le fichier entier comme un format inconnu ?
8. **Q8 — Domaine des fiches.** Garder les quatorze fiches en `SAVE` (un seul
   lot lisible), ou ranger la version réseau en `SPEC-NET-031` et la validation
   serveur en `SPEC-SECU-013` / `014` ?
9. **Q9 — Sauvegardes déjà abîmées.** Une partie v2 chargée une fois depuis le
   2026-09-24 a déjà perdu sa banque et ses soutes : faut-il seulement le
   signaler dans le CHANGELOG, ou tenter une réparation heuristique (impossible
   à rendre sûre : l'ancien id a été écrit tel quel en v3) ?
10. **Q10 — Atlas.** 105 tuiles libres après la dernière utilisée : agrandir
    l'atlas à 16 × 128 dès ce lot (une constante dans `atlas.js` et
    `mesher.js`), ou attendre le premier lot qui en manquera ?
