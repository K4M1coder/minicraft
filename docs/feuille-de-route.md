# Feuille de route — ordre optimal des lots restants

Écrite le 2026-10-02, après la v0.5.0 (chantier « solo = serveur » L50 livré
sauf quelques fiches). Elle fixe **l'ordre** des lots à faire et **pourquoi**,
pour pouvoir interrompre et reprendre le travail à tout moment. Les lots eux-mêmes
restent décrits dans `PLAN.md` (§3) et leurs fiches dans `SPECS.md` ; ce fichier
ne les remplace pas, il les ordonne.

## Reprendre le travail (protocole, 2 minutes)

1. `git status`, `git log --oneline -15`, `git worktree list` : y a-t-il une
   branche d'agent non fusionnée (`worktree-agent-*`, `fix/*`) ? La terminer ou
   la fusionner avant tout nouveau lot.
2. Lire la **table d'avancement** ci-dessous : la première ligne qui n'est pas
   « fait » est la suite. Une ligne « en cours » se reprend à sa dernière case
   cochée.
3. `grep -n "⏳" SPECS.md` donne les fiches écrites mais non implémentées ;
   `node tests/run.js --preset commit` et `node tests/gates.js` doivent être
   verts avant de commencer.
4. Cycle d'un lot (mémoire projet « Sous-agents Sonnet ») : audit → fiches →
   revue des fiches → conception → code (Sonnet en worktree isolé, Opus pour le
   complexe) → **revue adversariale** → corrections → fusion dans `master` →
   commit régulier, `CHANGELOG.md` (« Non publié »), `tools/version.js
   --publier` à la fin d'un ensemble cohérent (paquet zip par version).
5. Après chaque lot : cocher la ligne ici, mettre l'état dans la table de
   `PLAN.md`, committer. **Un lot interrompu laisse une note** dans la colonne
   « Reprise » (branche, dernier commit, ce qui reste).

Conseil machine : les crochets pre-commit/pre-push durent 15 à 50 minutes ;
committer et pousser en détaché (`nohup`), surveiller avec un moniteur.

## Principes de l'ordre

- **Débloquer d'abord ce qui bloque** : le format 16 bits de L40 est livré
  (9f92f99, 3 840 identifiants de bloc libres) ; reste sa consolidation (2.1),
  qui corrige des pertes de données à la migration avant d'ajouter des blocs.
- **Réduire le coût de chaque lot suivant** : le périmètre d'exécution des tests
  (BANC-067 à 076) ramène des crochets de 15-50 min à quelques minutes sur un
  commit local ; il rentabilise tout ce qui suit.
- **Fiabiliser le serveur avant d'y ajouter du contenu** : il porte désormais
  tout le jeu (L50) ; son découpage et sa sécurité (L44) précèdent les lots qui
  ajoutent des messages et des états.
- **Le temps avant les saisons-dépendants** : la saison modifie températures,
  cultures, neige, feuillages ; L23 précède les lots qui en dépendent
  (cultures et élevage, économie saisonnière).
- **Les dépendances de contenu** : factions (L39) avant économie/transport
  (L45) et interconnexions (L46) ; densité (L38) avant factions de territoire.
- **Le visuel/confort en dernier** parmi les indépendants (son, options,
  diagnostics fins du banc, diaporamas).

## Table d'avancement

Légende : ☐ à faire · ◐ en cours · ☑ fait. Les numéros renvoient à `PLAN.md`.

Vérification du 2026-10-04 : les lots marqués « à faire » de la phase 2 à 6
avaient en réalité presque toutes leurs fiches ✅. Une relecture du code et des
tests a remis 29 de ces fiches à ⏳ (voir `PLAN.md`, § 3). Une ligne ◐ ci-dessous
signifie « en grande partie livré, il reste les fiches ⏳ citées ».

### Phase 0 — Clore l'existant (immédiat)

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 0.1 | Banc : tout consulter | correctif banc/historique/cahiers + corrections de revue | BANC-117 à 121 | ☑ | fusionné (8996df2) et poussé (1d1e728), revue adversariale appliquée |
| 0.2 | L50 : fiches restantes | audits ARCHI-001 et 020 ; SYNC-020 (état du joueur après reconnexion, vérifier), SYNC-024 (factions au join) ; bug des circuits qui referment les portes ouvertes à la main | ARCHI-001, 020 ; SYNC-020, 024 | ☑ | fusionné (86b5545) : ARCHI-001, 020, SYNC-020, 024 ✅ ; bug des circuits corrigé (09c3cfe) |
| 0.3 | L50 : lot reporté | SYNC-027 (présentoirs/socles tenus par le serveur) → ARCHI-043 ; coffres piégés côté serveur → ARCHI-044 (suit L25 « coffres piégés ») | SYNC-027, ARCHI-043, 044 | ☐ | 044 attend L25 |
| 0.4 | Release | `v0.5.1` : vol/horloge/créatures + banc ; zip de release | — | ☑ | publiée en `v0.6.0` (d65b0d1) au lieu de 0.5.1 |

### Phase 1 — Vitesse et sûreté de travail

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 1.1 | BANC périmètre | carte d'impact, `tools/perimetre.js`, crochets au périmètre, repli sur la suite complète, G13 étendue | BANC-067 à 076 | ☑ | fusionné (219353c), BANC-067 à 076 ✅, publié en v0.6.0 |
| 1.2 | BANC journal | `MC.Journal` (G16 existe), sorties, erreurs joueur, enregistreur de vol | BANC-092 à 107 | ◐ | journal BANC-104 à 110 fait sur une autre branche, pas encore fusionné : vérifier puis fusionner avant de cocher ; 092 à 103 restent à faire |
| 1.3 | BANC rétention | compaction du registre à la publication | BANC-090, 091 | ◐ | BANC-090 et 091 faits sur une autre branche, pas encore fusionnés : vérifier puis fusionner avant de cocher |
| 1.4 | L44 | découpage de `server.js` en modules purs, rattrapage d'exceptions, tampons bornés, jetons admin, sauvegarde atomique asynchrone, SECU-012 | SERVEUR-008, SECU-0xx | ☐ | découper AVANT d'ajouter des messages (lots suivants) |

### Phase 2 — Fondation technique des contenus

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 2.1 | L40 | blocs 16 bits avec états + migration des sauvegardes | (SAVE, voir PLAN L40) | ◐ | format livré (9f92f99) mais SPEC-SAVE-017 ⏳ (migration v1/v2 qui perd banque, soutes, indices d'enquête) ; découpé en 2.1a à 2.1e ci-dessous ; débloque déjà L24, L29, L35 |
| 2.1a | L40-bis A | migrations complètes : banque, soutes, indices d'enquête, import ; registre des champs `CHAMPS_IDS` ; CHANGELOG « Corrigé » qui avertit que les parties v2 déjà chargées ont perdu ces données (Q9) | SAVE-017, SAVE-018 | ☐ | parallèle à B et D |
| 2.1b | L40-bis B | identifiants figés, plages déclarées, `etatMax` (état 8 bits, Q2 ; portes et trappes inchangées, Q4) | SAVE-019, 020, 021 | ☐ | parallèle à A et D |
| 2.1c | L40-bis C | serveur et réseau : id non-bloc refusé, état borné, état 0 appliqué chez le client, format d'ids annoncé (seul un format différent est refusé, Q5), monde refusé renommé puis carte neuve (Q6), ids de bloc inconnus conservés (Q7) | SAVE-022 à 026, 028 | ☐ | après 2.1b (`etatMax`) ; touche `server.js` (voir 1.4) |
| 2.1d | L40-bis D | maillage hors thread sans copie d'états vides | SAVE-027 | ☐ | indépendant |
| 2.1e | L40-bis E | documents : PLAN.md et cette feuille à l'état réel | — | ☑ | vérification du 2026-10-04 ; atlas inchangé (Q10), minerais mutualisés gardés (Q3) |
| 2.2 | L48 | rendu fiable (contexte WebGL perdu, adaptatif, instanciation, culling) | RENDU | ◐ | restent RENDU-006 (antialias dans les options), 012 (mipmaps par défaut), 015 (vrai test de la fenêtre commune) |
| 2.3 | L41 | options d'affichage (GPU, résolutions, plein écran, multi-écrans) | OPTION | ◐ | OPTION-004 à 008 ✅ vérifiées ; plein écran sans test, liste des GPU liée à PACK-001 ⏳ ; revue adversariale non attestée |

### Phase 3 — Monde et temps

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 3.1 | L23 | saisons (journée 20 min, année 3 h, températures, neige, gel, cultures en saison) | SAISON | ◐ | reste SAISON-005 (rivières calmes gelées) ; affichage de la saison seulement en F3 |
| 3.2 | L35 | profondeurs : flore et récifs, biomes souterrains, bioluminescence, minerais | MER, SOUTERRAIN, MINERAI | ◐ | restent SOUTERRAIN-003 (structures par biome souterrain) et LUMIERE-007 (plancton généré) ; minerais mutualisés gardés (Q3) |
| 3.3 | L38 | carte de densité, mégapoles, hiérarchie des routes, rivières navigables, zones de jeu | DENSITE, ZONE | ◐ | reste DENSITE-001 (volcans dans la densité) ; tests ROUTE-007 et ZONE-003 à renforcer |

### Phase 4 — Objets, construction, mécanismes

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 4.1 | L25 | tissu et armures, armes, gemmes, cuisine, coffres piégés et surprises | OBJET | ◐ | reste OBJET-001 (jambières et bottes visibles) ; OBJET-005 attend ARCHI-044 (0.3) |
| 4.2 | L24 | construction fine, intérieurs, mobilier | CONSTR, INTERIEUR | ◐ | restent CONSTR-001, 003, INTERIEUR-001, 003 ; présentoirs attendent SYNC-027/ARCHI-043 (0.3) ; briquet à faire passer par le serveur |
| 4.3 | L29 | mécanismes et électricité | MECA | ◐ | bug des circuits corrigé (09c3cfe) ; restent MECA-002, 003, 005, 006, 008 et des recettes pour les mécanismes |

### Phase 5 — Société et économie

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 5.1 | L39 | factions PNJ autonomes + factions de joueurs | FACTION | ◐ | restent FACTION-006, 007, 012, 013 |
| 5.2 | L45 | économie vivante, métiers, transport | ECO, METIER, TRANSPORT | ☐ | fiches ECO, METIER, TRANSPORT toutes ✅ dans SPECS.md : audit par lecture du code à faire avant de cocher |
| 5.3 | L46 | factions/quêtes/PvP/environnement interconnectés | FACTION, QUETE, PVP, ENV, DONJON | ☐ | reste ENV-005 ⏳ ; autres fiches ✅ (DONJON-017/018 compris) à auditer |

### Phase 6 — Parachèvement

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 6.1 | L36 | ambiance sonore spatialisée | AUDIO | ◐ | AUDIO-001 à 006 ⏳ : le code pur existe, presque rien n'est branché dans le jeu |
| 6.2 | L37 | version empaquetée complète, serveur dédié, console d'administration, listes blanche/noire, modérateurs | PACK, SERVEUR, ADMIN | ◐ | reste PACK-001 (exécutable par système) ; zip par release fait (PACK-004) |
| 6.3 | L43 | restes de la synchro permanente (vérifier ce que L50 a déjà livré avant de planifier) | SYNC | ☐ | faire un audit d'abord : beaucoup est probablement déjà ✅ |
| 6.4 | BANC fin | graphiques, diaporamas d'images, inscription depuis l'interface, diagnostics CPU/GPU, rendu reproductible | BANC-0xx restants | ☐ | à la demande |

## Règles pour modifier cette feuille

- On peut réordonner, **avec la raison** dans « Principes » ou la colonne
  « Reprise ».
- Un lot qui se révèle plus gros se découpe en sous-lignes (2.1a, 2.1b…).
- Ne jamais cocher ☑ sans que les fiches du lot soient ✅ dans `SPECS.md` et la
  revue adversariale appliquée.
