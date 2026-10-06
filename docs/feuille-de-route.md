# Feuille de route — ordre optimal des lots restants

Écrite le 2026-10-02, vérifiée et mise à jour le 2026-10-05 (voir « Ce qui a changé » ci-dessous), après la v0.5.0 (chantier « solo = serveur » L50 livré
sauf quelques fiches). Elle fixe **l'ordre** des lots à faire et **pourquoi**,
pour pouvoir interrompre et reprendre le travail à tout moment. Les lots eux-mêmes
restent décrits dans `PLAN.md` (§3) et leurs fiches dans `SPECS.md` ; ce fichier
ne les remplace pas, il les ordonne.

## Vérification du 2026-10-05 (état réel après la v0.8.0)

Chaque ligne a été confrontée aux fiches de `SPECS.md` (✅/⏳ réels par domaine),
à `git log v0.7.0..master` et au `CHANGELOG.md` (section 0.8.0). Ce qui a changé :

- **Passent à ☑** : 0.0 JOUABLE (fusionné, 6e406d6), 1.3 BANC rétention (fusionné,
  a014174), 1.4 L44 (SERVEUR-008 et SECU-012 ✅), 2.1b à 2.1d (SAVE-019 à 028 ✅),
  2.2 L48 (RENDU-001 à 015 ✅), 3.1 L23, 3.3 L38, 4.3 L29, 5.1 L39, 6.1 L36.
- **Restes réduits** : 1.2 (journal BANC-104 à 110 fusionné, a10d2c4), 2.1a (seule
  SAVE-017 reste ⏳), 3.2 (SOUTERRAIN-003 est repassée à ⏳ par décision du
  propriétaire, LUMIERE-007 ✅), 4.1 (OBJET-001 ✅), 4.2 (CONSTR-001/003 et
  INTERIEUR-001 ✅, INTERIEUR-003 reste ⏳), 6.2 (SERVEUR ✅), 6.3 (seule SYNC-027 reste).
- **Décisions du propriétaire** : FACTION-007 reste ✅ malgré un p99 du tic serveur
  de 63,7 ms (> 50 ms) à 16 joueurs (cause déjà sur master : génération de chunks,
  préparation des lieux, caravanes) ; INTERIEUR-003 reste ⏳ (attend SYNC-027 et
  ARCHI-043, lot 0.3) ; SOUTERRAIN-003 repasse à ⏳ (le donjon souterrain actuel,
  coffre et deux gardes sans boss ni regarnissage, est insuffisant).
- **Nouveau** : la phase 7, « Tâches ouvertes après v0.8.0 », et la ligne 0.5
  (v0.8.0 publiée).
- **En cours, non fusionnés** (workflow du coordinateur, branches d'agents) :
  « présentoirs » (SYNC-027, ARCHI-043/044, INTERIEUR-003), « divers » (ENV-005,
  SAVE-017, LIMITE-007, PACK-001), « banc A » (BANC-004 à 058) et « banc B »
  (BANC-063 à 116). Leurs lignes sont ◐ sans présumer du résultat.
- **Laissé tel quel faute de preuve** : 5.2 L45 et 5.3 L46 (fiches ✅ jamais
  auditées par lecture du code), 2.3 L41, 0.1, 1.1, 0.2, 0.4.

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

- **La jouabilité avant tout nouveau lot** (demande de l'utilisateur,
  2026-10-04) : le joueur ne doit ni bouger tout seul, ni voir une action
  s'annuler (blocs, inventaire, coffres). Le lot JOUABLE (ligne 0.0) en est la
  garantie ; `node tests/run.js --preset jouabilite` se relance avant de
  livrer tout lot qui touche au réseau, à l'inventaire ou aux conteneurs.
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

## Point de reprise — 2026-10-06 (travail mis en pause à la demande du propriétaire)

**État** :  = v0.8.0 + mise à jour de PLAN/feuille (e8dbaa6), **non poussé** depuis la v0.8.0 (le push de 1427bed est passé ; e8dbaa6 reste local). Le workflow des quatre lots de fiches ⏳ a été arrêté ; plus aucun serveur ni navigateur de test ne tourne (l'Edge headless  appartient à VS Code). Quatre branches attendent dans  (verrouillées, rien n'est perdu) ; toutes sont rebasées sur e8dbaa6, **aucune n'est fusionnée ni poussée**.

| Lot | Branche / worktree | Fiches visées | Où il en est | Reprise |
|---|---|---|---|---|
| presentoirs |  ·  (3 commits + modifications non commitées, copie : ) | SYNC-027, ARCHI-043, ARCHI-044, INTERIEUR-003 (pose d'un livre sur un présentoir) | implémenté, revue adversariale faite (défaut majeur : le texte des fiches ARCHI-043/044 décrit encore le comportement « refusé » supprimé par le lot) ; corrections en cours, non commitées (save.js migration des objets exposés, tests, **reformulation de SPECS.md ARCHI-043/044**) | **le texte des fiches ARCHI-043/044 ne peut être changé qu'avec l'accord du propriétaire** : lui soumettre la reformulation (git diff -- SPECS.md dans le worktree) avant de commiter ; puis terminer les corrections, [1mPortes de qualité[0m
  [32m✓[0m [1mG1[0m Toute spec déclarée est citée par au moins un test
      [2m711 specs couvertes, 59 planifiées[0m
  [32m✓[0m [1mG2[0m Tout identifiant cité par un test existe dans SPECS.md
      [2m727 identifiants valides[0m
  [32m✓[0m [1mG3[0m 100 % des tests Node passent
      [2m1664/1664[0m
  [32m✓[0m [1mG4[0m Tous les fichiers de src/ sont syntaxiquement valides
      [2m98 fichiers[0m
  [32m✓[0m [1mG5[0m Aucun module pur ne référence THREE, document ou window
      [2m86 modules purs vérifiés[0m
  [32m✓[0m [1mG6[0m Toute fonction exportée d'un module pur est citée par un test
      [2msurface publique couverte[0m
  [32m✓[0m [1mG10[0m La version suit le versionnage sémantique et le journal la publie
      [2mversion 0.8.0 (CHANGELOG.md)[0m
  [32m✓[0m [1mG11[0m Les crochets git encadrent commits et versions
      [2mcommit-msg et pre-commit actifs, règle du cran vérifiée[0m
  [32m✓[0m [1mG12[0m La génération et le maillage restent sous le budget de tests/budget-perf.json
      [2mbench-generation.js : moyenne 36.21 ms, p95 35.08 ms ; bench-maillage.js : moyenne 44.48 ms, p95 64.67 ms[0m
  [32m✓[0m [1mG13[0m Les crochets citent un préréglage existant et non vide, pre-commit au périmètre, pre-push et pre-merge-commit en suite complète (SPEC-BANC-006, 075)
      [2mpre-commit→commit au périmètre, pre-push et pre-merge-commit→pr en entier ; périmètre de src/mesher.js : 427 test(s), 1207 exclu(s)[0m
  [32m✓[0m [1mG14[0m 100 % des tests ont une fiche (SPEC-BANC-002) et au moins un domaine ou une fonction, déclarée ou observée (SPEC-BANC-066)
      [2m100 % des tests ont une fiche, un domaine ou une fonction (déclarée ou observée)[0m
  [32m✓[0m [1mG15[0m Chaque test e2e du cahier produit ≥ 2 captures réelles, début et fin (SPEC-BANC-026/027)
      [2m5 test(s) e2e, tous ≥ 2 captures (319 Ko de captures pour ce cahier)[0m
  [32m✓[0m [1mG16[0m Aucun console.* direct dans src/ et server.js hors de src/journal.js (SPEC-BANC-110)
      [2m98 fichiers vérifiés, tout passe par MC.Journal[0m

  [2mportes manuelles (à vérifier dans le navigateur) :[0m
  [33m○[0m [1mG7[0m 100 % des tests end-to-end passent [2m— ouvrir tests/index.html[0m
  [33m○[0m [1mG8[0m Aucune erreur console au chargement [2m— ouvrir index.html[0m
  [33m○[0m [1mG9[0m ≥ 55 images/s, écran partagé compris [2m— mesure dans les tests e2e[0m

[32mToutes les portes automatiques sont vertes[0m + , commit, fusion |
| divers |  ·  (5 commits, propre) | ENV-005, SAVE-017, LIMITE-007, PACK-001 | implémenté, revue faite, corrections commitées (5dcb47f) | vérifier les portes sur la tête, fusion ff, push ; dire clairement ce que PACK-001 ne prouve pas hors Windows |
| banc-a |  ·  (4 commits, propre) | BANC-004, 006, 029, 034, 039, 041 à 058 | implémenté, revue faite, corrections commitées (4953486) ; 058 reste ✅ | portes sur la tête, fusion ff (rebaser sur banc-b au besoin, union des conflits), push |
| banc-b |  ·  (5 commits + modifications non commitées, copie : ) | BANC-063, 064, 065, 080, 082, 084, 092 à 103, 111 à 116 | implémenté, revue faite (défauts : BANC-114 « ignoré avec raison » non tenue mot à mot, BANC-064 règle de répétition non prouvée) ; corrections en cours, non commitées (tests/run.js, tools/historiser.js, 2 tests) | terminer les corrections, portes + , commit, fusion |

**Ordre de reprise** : (1) diviser la machine : un seul agent à la fois sur la suite complète ; (2) divers → banc-a → banc-b → presentoirs, chacun : portes, rebase sur master, fusion , une seule poussée à la fin ; (3)  puis  (v0.9.0 attendue) ; (4) lots de la Phase 7 ci-dessous.

**Décisions du propriétaire déjà prises** : FACTION-007 reste ✅ ; INTERIEUR-003 reste ⏳ jusqu'à la livraison du lot presentoirs ; SOUTERRAIN-003 est ⏳ (boss + coffre regarni, ligne 7.2) ; tâches 7.1 à 7.6 ouvertes ; pas d'état ◐ pour les fiches, pas de porte d'audit « ✅ avec reste » (idée gardée pour plus tard) ; branche  (4 commits probablement dépassés par le découpage livré) conservée en attendant sa décision.

**Pièges connus** : la machine se charge vite (4 agents en parallèle ⇒ tests lents, faux échecs) ;  avant chaque fusion ff ; le catch-up politique est borné à un jour par entretien et la première catastrophe met ≈ 8,6 s à être annoncée (bornes d'attente des tests élargies) ; pas de , aucune ligne Co-Authored-By, e-mail .

## Suivi de la reprise — 2026-10-06

- Reprise autorisée par le propriétaire ; reformulation de SPEC-ARCHI-043 et
  SPEC-ARCHI-044 approuvée avant commit. `decoupage-v1` reste conservée.
- **Restes isolés fusionnés** en avance rapide sur `master` (`540508a`), après
  rebase : portes automatiques vertes (1 669 tests Node, cinq e2e de fumée),
  paquet Windows construit et lancé (49 vérifications), sonde LIMITE-007
  exécutée avec cinq captures et relevés. PACK-001 reste partielle : macOS et
  Linux non vérifiés, fiche toujours ⏳.
- Campagne `pr` du lot : 1 707/1 708, les 39 intégrations passent ; seul le
  seuil préexistant de FACTION-007 dépasse ponctuellement 40 ms (44,9 ms).
  Relance isolée : neuf tests passent, sans changement de seuil ni de fiche.
- **Banc A** : revue complémentaire appliquée (témoins par identité complète,
  réponses périmées, filtres des diaporamas, preuve du périmètre) ; tests ciblés
  13/13, routes sur vrai serveur 103/103, navigateur BANC 11/11. Après rebase,
  la preuve de périmètre a été isolée de l'âge de la carte locale (limite de
  production de 50 commits inchangée) ; portes vertes (1 715 tests Node).
  **Fusionné en avance rapide** sur `master` (`76091a5`), conflits de journal
  résolus par union ; aucun push.
- **Banc B** : corrections reprises dans `wf_47f0b1a2-d1e-4` ; une erreur locale
  n'est plus ignorée à cause d'un module absent sans rapport, les pannes e2e
  restent bloquantes et l'historiseur sélectionne le catalogue complet par
  défaut. Tests ciblés et intégration réels passent.
  Le propriétaire a approuvé `regression` comme preuve de release, avec les
  critères de fiabilité existants inchangés (réussie, non interrompue, non
  restreinte, arbre propre) ; la rétention correspondante passe ses huit tests.
  Rebase terminé et **fusionné en avance rapide** sur `master` (`af8de28`) :
  campagne `pr` 1 837/1 837, navigateur combiné A+B 19/19, portes automatiques
  vertes (1 796 tests Node, cinq e2e de fumée, budgets inchangés).
- **Présentoirs** : revue complémentaire appliquée (support disparu diffusé,
  entretien serveur et retour sous 96 blocs, plus de 256 objets par chunk sans
  troncature, état vide transmis et snapshots mémorisés pour les effacements
  ultérieurs). Un dernier défaut de cache après refus a été prouvé rouge puis
  corrigé ; les annonces de refus sont désormais mémorisées aussi. Les huit
  tests locaux et les sept preuves de migration passent (15/15). Intégration
  objets : 64/64 après ce correctif ; livres : 32/32, dont le livre signé repris
  du présentoir après relance ; jouabilité : 34/34, neuf e2e réels compris.
  Première passe des portes : deux échecs G3 (FACTION-007 à 45,5 ms, seuil
  inchangé ; preuve de migration qui attendait encore le miroir local).
  Migration corrigée et FACTION-007 relancée : 16/16 ciblés passent.
  Nouvelle passe des portes entièrement verte : 1 673/1 673 tests Node,
  budgets inchangés respectés et cinq e2e de fumée capturés. Corrections des neuf
  fichiers commitées avec crochets actifs (`b15ad40`), puis rebasées sur
  `master` : tête `13b602b`, worktree propre. L'API réseau garde les diagnostics
  de banc B et les commandes des présentoirs (6/6 ciblés). Après rebase : objets
  64/64, livres 32/32 et jouabilité 34/34 verts. Première passe combinée :
  1 805/1 805 tests Node et toutes les portes hors G12 verts ; maillage p95
  110,55 ms, puis 111,28 ms en isolé, au-delà du budget inchangé de 110 ms.
  Comparaison : aucun module chargé par ce benchmark ne diffère de `master`,
  dont le p95 isolé est 87,59 ms. Nouvelle passe sans concurrence entièrement
  verte : 1 805/1 805 tests Node, génération 40,37 ms en moyenne, maillage
  56,09 ms en moyenne et 81,40 ms de p95, cinq e2e de fumée capturés.
  **Présentoirs fusionnés en avance rapide** sur `master` (`13b602b`).
- **Publication locale v0.9.0 effectuée** par `tools/version.js --publier`
  (`c1a816e`, étiquette annotée `v0.9.0`), après les portes finales sur
  `master` : 1 805/1 805 tests Node, budgets inchangés respectés, cinq e2e de
  fumée capturés. Archive `dist/releases/minicraft-v0.9.0.zip` relue et vérifiée :
  108 fichiers, 2 708 654 octets, version et lanceurs présents, aucune sauvegarde
  embarquée (seul le texte explicatif du dossier `parties/`). Le registre a
  compacté quatre entrées et retiré 587 images ; aucun nouveau run de release
  n'a été marqué. Les portes manuelles G7/G8/G9 n'ont pas été revérifiées dans
  leur totalité ; les preuves navigateur acquises sont celles des lots, de la
  jouabilité et de la fumée. Poussée finale : `master` et `v0.9.0` ensemble,
  avec le crochet `pre-push` actif.
- Première tentative de push refusée par `pre-push` (3/1 847 échecs), avant
  tout transfert de référence : FACTION-007 à 41,9 ms et deux fixtures du banc
  dépendantes de l'état réel du dépôt. Le rejeu historique utilise désormais
  un clone jetable arrêté sur `v0.8.0` (moteur actuel conservé, 21 vérifications
  vertes) ; la concurrence des exports filtre une fixture de 2 000 lignes,
  indépendante de l'historique qui dépasse 100 000 lignes (104/104 verts).
  FACTION-007 relancée : 9/9, seuil inchangé. Corrections de tests seulement :
  code du jeu, tag et ZIP `v0.9.0` inchangés ; nouvelle tentative avec crochets
  actifs après commit des fixtures.
  Les sauvegardes non suivies dans `parties/` sont conservées hors des commits.

## Table d'avancement

Légende : ☐ à faire · ◐ en cours · ☑ fait. Les numéros renvoient à `PLAN.md`.

Vérification du 2026-10-04 (conservée) : les lots marqués « à faire » de la phase 2 à 6
avaient en réalité presque toutes leurs fiches ✅. Une relecture du code et des
tests a remis 29 de ces fiches à ⏳ (voir `PLAN.md`, § 3). Une ligne ◐ ci-dessous
signifie « en grande partie livré, il reste les fiches ⏳ citées ».

### Phase 0 — Clore l'existant (immédiat)

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 0.0 | **JOUABLE — tests de jouabilité / synchro client-serveur** (priorité haute) | e2e vrai navigateur + vrai serveur de jeu (`tests/e2e-jouabilite.js`) : immobilité 8 s (survie, vol statique créatif), blocs cassés/posés qui le restent 4 s après (créatif et survie, client + serveur + second client), inventaire et coffres jamais annulés (client = serveur, réouverture) ; échecs détaillés (vecteur, décalage, intervalle, source ; instant du retour arrière, messages serveur) ; 6 bogues révélés et corrigés (voir PLAN.md, lot JOUABLE) | JOUABLE-001 à 009 | ☑ | fusionné dans master (6e406d6), SPEC-JOUABLE-001 à 009 ✅ ; relancer `node tests/run.js --preset jouabilite` (≈ 4 min) avant chaque lot réseau/inventaire |
| 0.1 | Banc : tout consulter | correctif banc/historique/cahiers + corrections de revue | BANC-117 à 121 | ☑ | fusionné (8996df2) et poussé (1d1e728), revue adversariale appliquée |
| 0.2 | L50 : fiches restantes | audits ARCHI-001 et 020 ; SYNC-020 (état du joueur après reconnexion, vérifier), SYNC-024 (factions au join) ; bug des circuits qui referment les portes ouvertes à la main | ARCHI-001, 020 ; SYNC-020, 024 | ☑ | fusionné (86b5545) : ARCHI-001, 020, SYNC-020, 024 ✅ ; bug des circuits corrigé (09c3cfe) |
| 0.3 | L50 : lot reporté | SYNC-027 (présentoirs/socles tenus par le serveur) → ARCHI-043 ; coffres piégés côté serveur → ARCHI-044 (suit L25 « coffres piégés ») ; ils débloquent INTERIEUR-003 (rangement des livres) et OBJET-005 en ligne | SYNC-027, ARCHI-043, 044 ; INTERIEUR-003 | ☑ | fusionné (13b602b), fiches visées ✅ ; revue et corrections appliquées, objets 64/64, livres 32/32, jouabilité 34/34 après rebase, portes automatiques vertes |
| 0.4 | Release | `v0.5.1` : vol/horloge/créatures + banc ; zip de release | — | ☑ | publiée en `v0.6.0` (d65b0d1) au lieu de 0.5.1 |
| 0.5 | Release | `v0.8.0` : mécanismes, `/list` et `/help`, monde (gel des lacs, densité, souterrain), bâtiments, factions, tics serveur, découpage de `server.js`, sécurité, ambiance sonore | — | ☑ | publiée (1427bed, étiquette `v0.8.0`) |
| 0.6 | Release | `v0.9.0` : restes isolés, banc A/B, présentoirs, livres et coffres suspects | — | ☑ | publiée localement (c1a816e, étiquette `v0.9.0`), ZIP portable vérifié ; portes automatiques vertes, G7/G8/G9 complets non revérifiés ; poussée finale de master et du tag avec crochets actifs |

### Phase 1 — Vitesse et sûreté de travail

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 1.1 | BANC périmètre | carte d'impact, `tools/perimetre.js`, crochets au périmètre, repli sur la suite complète, G13 étendue | BANC-067 à 076 | ☑ | fusionné (219353c), BANC-067 à 076 ✅, publié en v0.6.0 |
| 1.2 | BANC journal | `MC.Journal` (G16 existe), sorties, erreurs joueur, enregistreur de vol | BANC-092 à 107 | ☑ | journal BANC-104 à 110 fusionné (a10d2c4), diagnostics BANC-092 à 103 fusionnés avec banc B (af8de28) ; portes et intégrations vertes |
| 1.3 | BANC rétention | compaction du registre à la publication | BANC-090, 091 | ☑ | fusionné (a014174), BANC-088, 090, 091 ✅ |
| 1.4 | L44 | découpage de `server.js` en modules purs, rattrapage d'exceptions, tampons bornés, jetons admin, sauvegarde atomique asynchrone, SECU-012 | SERVEUR-008, SECU-0xx | ☑ | SECU-001 à 012 et SERVEUR-001 à 010 ✅ ; `server.js` découpé (123d69a), SECU-012 (d80be99) |

### Phase 2 — Fondation technique des contenus

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 2.1 | L40 | blocs 16 bits avec états + migration des sauvegardes | (SAVE, voir PLAN L40) | ☑ | format livré (9f92f99), consolidation SAVE-017 à 028 ✅ ; migration complète fusionnée avec les restes isolés (540508a), preuves sur vrai serveur |
| 2.1a | L40-bis A | migrations complètes : banque, soutes, indices d'enquête, import ; registre des champs `CHAMPS_IDS` ; CHANGELOG « Corrigé » qui avertit que les parties v2 déjà chargées ont perdu ces données (Q9) | SAVE-017, SAVE-018 | ☑ | SAVE-017 et 018 ✅ ; migration fusionnée (540508a), intégrations vertes |
| 2.1b | L40-bis B | identifiants figés, plages déclarées, `etatMax` (état 8 bits, Q2 ; portes et trappes inchangées, Q4) | SAVE-019, 020, 021 | ☑ | SAVE-019 à 021 ✅ |
| 2.1c | L40-bis C | serveur et réseau : id non-bloc refusé, état borné, état 0 appliqué chez le client, format d'ids annoncé (seul un format différent est refusé, Q5), monde refusé renommé puis carte neuve (Q6), ids de bloc inconnus conservés (Q7) | SAVE-022 à 026, 028 | ☑ | SAVE-022 à 026 et 028 ✅ |
| 2.1d | L40-bis D | maillage hors thread sans copie d'états vides | SAVE-027 | ☑ | SAVE-027 ✅ |
| 2.1e | L40-bis E | documents : PLAN.md et cette feuille à l'état réel | — | ☑ | vérification du 2026-10-04, refaite le 2026-10-05 après la v0.8.0 ; atlas inchangé (Q10), minerais mutualisés gardés (Q3) |
| 2.2 | L48 | rendu fiable (contexte WebGL perdu, adaptatif, instanciation, culling) | RENDU | ☑ | RENDU-001 à 015 ✅ (006, 012, 015 livrées en v0.8.0) ; défaut préexistant ouvert en 7.3 (traits sombres sur la glace de saison) |
| 2.3 | L41 | options d'affichage (GPU, résolutions, plein écran, multi-écrans) | OPTION | ◐ | OPTION-004 à 008 ✅ vérifiées ; plein écran sans test, liste des GPU liée à PACK-001 ⏳ ; revue adversariale non attestée |

### Phase 3 — Monde et temps

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 3.1 | L23 | saisons (journée 20 min, année 3 h, températures, neige, gel, cultures en saison) | SAISON | ☑ | SAISON-001 à 006 ✅ (gel des lacs et rivières calmes : SAISON-005, v0.8.0) ; affichage de la saison seulement en F3 ; effet de l'eau qui coule en 7.4 |
| 3.2 | L35 | profondeurs : flore et récifs, biomes souterrains, bioluminescence, minerais | MER, SOUTERRAIN, MINERAI | ◐ | reste SOUTERRAIN-003 ⏳ (décision du propriétaire : le donjon souterrain actuel est insuffisant, voir 7.2) ; LUMIERE-007 ✅ ; minerais mutualisés gardés (Q3) |
| 3.3 | L38 | carte de densité, mégapoles, hiérarchie des routes, rivières navigables, zones de jeu | DENSITE, ZONE | ☑ | DENSITE-001 et 002, ZONE-001 à 004 ✅ ; réserves de test non revérifiées : ROUTE-007, ZONE-003 |

### Phase 4 — Objets, construction, mécanismes

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 4.1 | L25 | tissu et armures, armes, gemmes, cuisine, coffres piégés et surprises | OBJET | ☑ | OBJET-001 à 005 ✅ ; coffres suspects désormais résolus par le serveur (ARCHI-044, 13b602b), 64 vérifications d'intégration vertes |
| 4.2 | L24 | construction fine, intérieurs, mobilier | CONSTR, INTERIEUR | ☑ | CONSTR-001 à 007 et INTERIEUR-001 à 003 ✅ ; livres sur présentoir livrés (13b602b), repris signés après relance du serveur ; briquet à faire passer par le serveur (hors fiche, non revérifié) |
| 4.3 | L29 | mécanismes et électricité | MECA | ☑ | MECA-001 à 008 ✅ (v0.8.0) ; aucune recette, mécanismes en créatif seulement (non revérifié) |

### Phase 5 — Société et économie

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 5.1 | L39 | factions PNJ autonomes + factions de joueurs | FACTION | ☑ | FACTION-001 à 017 ✅ (revue adversariale appliquée, c96cb51) ; FACTION-007 ✅ malgré p99 63,7 ms à 16 joueurs (décision du propriétaire, suivi en 7.1) |
| 5.2 | L45 | économie vivante, métiers, transport | ECO, METIER, TRANSPORT | ☐ | fiches ECO, METIER, TRANSPORT toutes ✅ dans SPECS.md : audit par lecture du code à faire avant de cocher |
| 5.3 | L46 | factions/quêtes/PvP/environnement interconnectés | FACTION, QUETE, PVP, ENV, DONJON | ☐ | ENV-005 ✅ fusionnée avec les restes isolés (540508a) ; autres fiches ✅ (DONJON-017/018 compris) à auditer ; délai de 8,6 s avant la première catastrophe en 7.1 |

### Phase 6 — Parachèvement

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 6.1 | L36 | ambiance sonore spatialisée | AUDIO | ☑ | AUDIO-001 à 006 ✅ (v0.8.0, preuves : `tests/spec-audio.js`, `tests/integration-audio.js`, e2e AUDIO) |
| 6.2 | L37 | version empaquetée complète, serveur dédié, console d'administration, listes blanche/noire, modérateurs | PACK, SERVEUR, ADMIN | ◐ | PACK-001 toujours ⏳ : exécutable Windows construit et lancé (49 vérifications, 540508a), macOS et Linux non vérifiés ; zip par release fait (PACK-004) |
| 6.3 | L43 | restes de la synchro permanente | SYNC | ☑ | SYNC-001 à 028 ✅ ; SYNC-027 fusionnée (13b602b), revue et preuves serveur appliquées ; autres ✅ non réauditées par lecture du code |
| 6.4 | BANC fin | graphiques, diaporamas d'images, inscription depuis l'interface, diagnostics CPU/GPU, rendu reproductible | BANC-0xx restants | ☑ | banc A fusionné (76091a5), banc B fusionné (af8de28), fiches visées ✅ ; navigateur combiné 19/19, `pr` 1 837/1 837, portes automatiques vertes |

### Phase 7 — Tâches ouvertes après v0.8.0

Ouvertes le 2026-10-05 sur décision du propriétaire. Les lots 7.1 à 7.5 ne sont
pas commencés ; 7.6 est livré avec le lot 0.3. Les
chiffres cités viennent de ses mesures (`node tools/mesure-tics.js --joueurs 16
--duree 40`) et du CHANGELOG. Chaque tâche à comportement nouveau passe d'abord par
une fiche `SPECS.md` (S1) : aucune n'est écrite ici.

| # | Lot | Contenu | Fiches | État | Reprise |
|---|---|---|---|---|---|
| 7.1 | **PERF serveur** | p99 du tic serveur à 16 joueurs dispersés : 63,7 ms mesuré (master : 65,5 ms), objectif < 50 ms. Causes : chunks et préparations de lieux (jusqu'à 1,5 s par tic) et caravanes (52 ms). Y ajouter : le coût de la politique des factions (index des relations, déjà ≈ 25 ms) et le délai d'environ 8,6 s avant la première catastrophe (recherche du voisin à 3000 blocs étalée dans le budget des tics) | à écrire (FACTION-007 reste ✅ par décision) | ☐ | mesurer d'abord avec `tools/mesure-tics.js --joueurs 16 --duree 40` ; viser la génération de chunks et la préparation des lieux, puis les caravanes |
| 7.2 | **SOUTERRAIN-003** | donjon souterrain propre à chaque biome avec un boss par biome, et coffre qui se regarnit après pillage (comme `MC.Donjons`) ; le donjon actuel (coffre et deux gardes, sans boss, coffre non regarni) est insuffisant | SOUTERRAIN-003 ⏳ | ☐ | réutiliser la logique de DONJON-009/017 (coffre pillé et regarnissage) |
| 7.3 | **Rendu : glace de saison** | traits sombres aux bords de chunks sur la glace de saison — défaut de rendu préexistant, reproduit sur la banquise générée d'un lac de taïga | à écrire | ☐ | reproduire sur un lac de taïga gelé, comparer les bords de chunks |
| 7.4 | **Eau qui coule en ligne** | SPEC-EAU-005 est actif sur le serveur depuis la v0.8.0 : risque d'inondations sur de longues parties — mesurer, borner, tester le plafond de 128 blocs par tic de diffusion | EAU-005 ✅ (tests du plafond à écrire) | ☐ | mesurer sur une longue partie avant de borner |
| 7.5 | **Escaliers déjà posés** | ils gardent leur ancienne forme tant qu'un voisin ne change pas (correctif des angles intérieur et extérieur de `formeDepuisVoisins`, CONSTR-001, v0.8.0) : décider d'une réactualisation ou la documenter | CONSTR-001 ✅ | ☐ | décision à prendre : réactualiser au chargement ou documenter dans le README |
| 7.6 | **Présentoirs, coffres piégés** | déjà au lot 0.3 (SYNC-027, ARCHI-043/044, INTERIEUR-003, OBJET-005 en ligne) | voir 0.3 | ☑ | livré avec 0.3 (13b602b) |

## Règles pour modifier cette feuille

- On peut réordonner, **avec la raison** dans « Principes » ou la colonne
  « Reprise ».
- Un lot qui se révèle plus gros se découpe en sous-lignes (2.1a, 2.1b…).
- Ne jamais cocher ☑ sans que les fiches du lot soient ✅ dans `SPECS.md` et la
  revue adversariale appliquée.
