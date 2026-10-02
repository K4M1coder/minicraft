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

- **Débloquer d'abord ce qui bloque** : les identifiants de bloc sont épuisés
  (128) — rien de neuf en blocs (construction, mécanismes, minerais, récifs)
  ne peut être fait avant L40.
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

### Phase 0 — Clore l'existant (immédiat)

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 0.1 | Banc : tout consulter | correctif banc/historique/cahiers + corrections de revue | BANC-117 à 121 | ◐ | branche `worktree-agent-a20a065f32fd6f1ec`, revue faite, corrections en cours ; fusionner puis pousser |
| 0.2 | L50 : fiches restantes | audits ARCHI-001 et 020 ; SYNC-020 (état du joueur après reconnexion, vérifier), SYNC-024 (factions au join) ; bug des circuits qui referment les portes ouvertes à la main | ARCHI-001, 020 ; SYNC-020, 024 | ☐ | |
| 0.3 | L50 : lot reporté | SYNC-027 (présentoirs/socles tenus par le serveur) → ARCHI-043 ; coffres piégés côté serveur → ARCHI-044 (suit L25 « coffres piégés ») | SYNC-027, ARCHI-043, 044 | ☐ | 044 attend L25 |
| 0.4 | Release | `v0.5.1` : vol/horloge/créatures + banc ; zip de release | — | ☐ | `node tools/version.js --publier` |

### Phase 1 — Vitesse et sûreté de travail

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 1.1 | BANC périmètre | carte d'impact, `tools/perimetre.js`, crochets au périmètre, repli sur la suite complète, G13 étendue | BANC-067 à 076 | ☐ | priorité : gain de temps sur tout le reste |
| 1.2 | BANC journal | `MC.Journal` (G16 existe), sorties, erreurs joueur, enregistreur de vol | BANC-092 à 107 | ☐ | seulement le journal d'abord (104 à 107) |
| 1.3 | BANC rétention | compaction du registre à la publication | BANC-090, 091 | ☐ | le registre pèse déjà 41 Mo |
| 1.4 | L44 | découpage de `server.js` en modules purs, rattrapage d'exceptions, tampons bornés, jetons admin, sauvegarde atomique asynchrone, SECU-012 | SERVEUR-008, SECU-0xx | ☐ | découper AVANT d'ajouter des messages (lots suivants) |

### Phase 2 — Fondation technique des contenus

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 2.1 | L40 | blocs 16 bits avec états + migration des sauvegardes | (SAVE, voir PLAN L40) | ☐ | débloque L24, L29, L35, MER-010/011 |
| 2.2 | L48 | rendu fiable (contexte WebGL perdu, adaptatif, instanciation, culling) | RENDU | ☐ | à faire avant d'alourdir le rendu (L24, L35) |
| 2.3 | L41 | options d'affichage (GPU, résolutions, plein écran, multi-écrans) | OPTION | ☐ | indépendant, peut s'intercaler |

### Phase 3 — Monde et temps

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 3.1 | L23 | saisons (journée 20 min, année 3 h, températures, neige, gel, cultures en saison) | SAISON | ☐ | le serveur porte l'heure unique (SPEC-ARCHI-046) |
| 3.2 | L35 | profondeurs : flore et récifs, biomes souterrains, bioluminescence, minerais | MER, SOUTERRAIN, MINERAI | ☐ | après L40 (identifiants) |
| 3.3 | L38 | carte de densité, mégapoles, hiérarchie des routes, rivières navigables, zones de jeu | DENSITE, ZONE | ☐ | |

### Phase 4 — Objets, construction, mécanismes

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 4.1 | L25 | tissu et armures, armes, gemmes, cuisine, coffres piégés et surprises | OBJET | ☐ | clôt ARCHI-044 |
| 4.2 | L24 | construction fine, intérieurs, mobilier | CONSTR, INTERIEUR | ☐ | après L40 ; clôt SYNC-027/ARCHI-043 si les présentoirs en font partie |
| 4.3 | L29 | mécanismes et électricité | MECA | ☐ | après L40 ; corrige le bug des circuits en premier |

### Phase 5 — Société et économie

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 5.1 | L39 | factions PNJ autonomes + factions de joueurs | FACTION | ☐ | |
| 5.2 | L45 | économie vivante, métiers, transport | ECO, METIER, TRANSPORT | ☐ | après L39 |
| 5.3 | L46 | factions/quêtes/PvP/environnement interconnectés | FACTION, QUETE, PVP, ENV, DONJON | ☐ | après L39 et L38 ; inclut DONJON-017/018, ENV-005 |

### Phase 6 — Parachèvement

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 6.1 | L36 | ambiance sonore spatialisée | AUDIO | ☐ | |
| 6.2 | L37 | version empaquetée complète, serveur dédié, console d'administration, listes blanche/noire, modérateurs | PACK, SERVEUR, ADMIN | ☐ | l'archive zip par release existe déjà (PACK-004) |
| 6.3 | L43 | restes de la synchro permanente (vérifier ce que L50 a déjà livré avant de planifier) | SYNC | ☐ | faire un audit d'abord : beaucoup est probablement déjà ✅ |
| 6.4 | BANC fin | graphiques, diaporamas d'images, inscription depuis l'interface, diagnostics CPU/GPU, rendu reproductible | BANC-0xx restants | ☐ | à la demande |

## Règles pour modifier cette feuille

- On peut réordonner, **avec la raison** dans « Principes » ou la colonne
  « Reprise ».
- Un lot qui se révèle plus gros se découpe en sous-lignes (2.1a, 2.1b…).
- Ne jamais cocher ☑ sans que les fiches du lot soient ✅ dans `SPECS.md` et la
  revue adversariale appliquée.
