# Journal des modifications

Toutes les évolutions notables de MiniCraft sont consignées ici.

Le format suit [Tenez un Changelog](https://keepachangelog.com/fr/1.1.0/) et
le projet adopte le [versionnage sémantique](https://semver.org/lang/fr/) :
`X.Y.Z`, chaque nombre ayant de 1 à 5 chiffres (jusqu'à `99999.99999.99999`).
Les commits suivent les *Commits conventionnels* ; la version ne monte que dans
un commit de publication `chore(release): vX.Y.Z`, à la fin d'une tâche, calculé
par `node tools/version.js --publier` d'après les commits depuis la dernière
étiquette (rupture → X, ou Y tant que X vaut 0 ; `feat` → Y ; `fix`/`perf` → Z).
La version du jeu (`MC.Core.VERSION_JEU`) est toujours celle de la dernière
entrée publiée. Des crochets git (`.githooks/`) et les portes G10–G11 le font
respecter (voir PLAN.md, « Commits et versions »).

## [Non publié]
### Ajouté
- SPEC-JOUABLE-001 à 009 — **tests de jouabilité / synchro client-serveur** (`tests/e2e-jouabilite.js`, `node tests/run.js --preset jouabilite`, ≈ 4 min) : dans la vraie page du jeu, contre un vrai serveur de jeu lancé pour chaque test par le banc (`POST /tests/serveur-jeu`, survie paisible ou créatif aux vraies règles), un joueur immobile au sol ou en vol statique ne bouge pas de 0,001 bloc en 8 s (client à chaque image, serveur à chaque `ETAT`) ; un bloc cassé reste cassé et un bloc posé reste posé 4 s après (créatif et survie, relus par une seconde connexion) ; glisser-déposer, demi-pile, jeter, ramasser et dépôt/retrait dans un coffre ne s'annulent pas, et l'inventaire et le coffre du serveur sont identiques à ceux du client (et à la réouverture). Un échec dit la nature du problème : chaque déplacement erroné avec vecteur, décalage cumulé, intervalle et source probable (serveur, correction `ETAT`, client), ou l'instant du retour arrière et les messages du serveur (`BLOC`, `INV_MAJ` rev/ack/refus, `cont_etat`/`cont_maj`).

### Corrigé
- SPEC-MECA-002 — une éolienne dans un chunk chargé levait `MC.Meteo.ventEn is not a function` à chaque tic de circuits (la fonction de vent est une méthode de la météo du monde, pas du module, et le serveur ne fournissait aucun vent). Le monde fournit désormais au tic de circuits le vent déterministe de son climat à l'altitude de l'éolienne (SPEC-VENT-001), et `circuits.js` se replie sur un vent nul, sans jamais lever d'exception, si aucun vent n'est disponible.
- SPEC-JOUABLE-006 — jeter un objet (G) n'avait aucun effet : lâché aux pieds et ramassable au bout de 0,4 s, il revenait aussitôt dans l'inventaire du joueur immobile. Il est désormais lancé devant le joueur, dans la direction du regard (≈ 5 blocs sur sol plat), et personne ne peut le ramasser avant 2 s. Deux objets au sol ne fusionnent plus que s'ils ont le même délai de ramassage et la même donnée (un objet jeté près d'un objet identique héritait de son délai écoulé et revenait aussitôt) ; la donnée d'une pile jetée (livre écrit, batterie…) n'est plus perdue.
- SPEC-JOUABLE-006 — l'usure (`dmg`) d'un outil jeté n'était pas transmise : un outil usé jeté (G), lâché aux pieds en trop-plein, perdu en butin PvP, tombé d'un coffre cassé ou d'une soute détruite, revenait neuf au ramassage (réparation gratuite en survie). L'usure suit désormais la pile jusqu'au sol et au retour dans l'inventaire (`lacher`, `lancerObjet`, `dropItem`, `pickUp`, `addStack`), et deux objets d'usure différente ne fusionnent pas. Les données (`data`) du butin PvP, des coffres cassés et des soutes suivent aussi. Même correction pour le distributeur (éjection et dépôt/retrait déclaré : l'état vient de ce que le joueur possède, jamais de sa déclaration) et pour la fermeture de la grille de fabrication (une pioche usée y déposée revenait neuve) ; le reliquat de la grille, perdu quand l'inventaire était plein, tombe désormais aux pieds du joueur.
- SPEC-JOUABLE-007 — un objet ramassé apparaissait deux fois côté client (9 planches affichées pour 8 sur le serveur) jusqu'à la mise à jour d'inventaire suivante : `DONNE` l'ajoutait de nouveau après l'`INV_MAJ` qui le portait déjà. Ce n'est plus qu'une annonce.
- SPEC-JOUABLE-008 — les coffres en ligne étaient inutilisables : le miroir client d'un conteneur ouvert n'avait pas de taille, et tout dépôt ou retrait était refusé en silence par la prédiction. Et un dépôt suivi d'un retrait affichait un coffre faux (vidé, une planche devenue deux) : la mise à jour du serveur s'appliquait au coffre déjà prédit, puis le rejeu rajoutait les mêmes opérations. Le client tient maintenant l'état confirmé du conteneur à part (affiché = confirmé + rejeu, comme l'inventaire).
- SPEC-JOUABLE-004 — un clic droit utilisait deux fois (l'appui, puis la boucle à l'image suivante) : deux blocs posés, ou un coffre posé puis aussitôt ouvert. Et rejoindre un serveur dans un autre mode que la page (ex. un serveur créatif) laissait l'inventaire vide à jamais : l'équipe recomposée perdait sa prédiction d'inventaire et ignorait chaque `INV_MAJ`.

### Ajouté
- SPEC-BANC-090 et 091 — **rétention du registre** : `node tools/registre.js compacter [--a-blanc] [--jusqu-a ref] [--version vX.Y.Z]`. Le registre ne garde en détail que les runs depuis la dernière release et, pour chaque release, la validation de son commit (le run de chaque préréglage sur ce commit, marqués `release: vX.Y.Z`) ; les autres runs du cycle (merge, PR, manuels) sont compactés (`compacte: true` : méta, et par test identité, état, durée, raison, erreur, libellés de capture ; plus de fiche, de fonctions observées ni d'images, sauf témoin épinglé), puis les images qu'aucune entrée ne référence sont supprimées. `tools/version.js --publier` l'appelle avant le commit de release (la compaction entre dans ce commit). Sûreté : un run de release ou en attente n'est jamais compacté, rien n'est touché sans résolution git fiable, un fichier d'entrée illisible interdit toute suppression d'image, réécriture atomique, `--a-blanc` ne modifie rien. Mesuré sur le registre réel (43,1 Mo d'entrées, 210 images) : à blanc, 43,1 Mo → 16,0 Mo d'entrées et 210 → 21 images pour une publication couvrant tout l'historique actuel.
- SPEC-BANC-088 — **score d'instabilité** : un test qui alterne réussite/échec sur les 10 derniers runs officiels sans que le fichier définissant l'une de ses fonctions (carte d'impact) ait changé entre les deux runs reçoit un score (nombre d'alternances) ; deux alternances ou plus : étiquette `instable`, portée par les lignes du tableau d'historique (donc filtrable) et colonne `instabilite`. `node tools/registre.js instables` les liste. Ne fait pas échouer une porte.
- SPEC-BANC-104 à 110 — **journal `MC.Journal`** (`src/journal.js`), module pur chargé en premier dans le jeu, le banc, les workers, les tests Node et `server.js` : `MC.Journal('RENDU').trace/debug/info/warn/error/fatal(message, données, erreur, { joueur, code })`, une entrée par appel (horodatage, domaine, niveau, message, données, pile, contexte joueur/mode/test en cours). Sorties à seuils : console (`warn` en jeu, `info` avec `?dev`, muette en test), tampon circulaire de 2 000 entrées tous niveaux, rapport de test (entrées `warn` et plus jointes au résultat de chaque test, champ `journal` du cahier), fichier du serveur `logs/serveur-<date>.log` (un par jour, 14 gardés, dossier réglable par `MC_JOURNAL_DOSSIER`), et remontée au serveur des erreurs `error`/`fatal` d'un client en ligne (message `journal_client`, 5 par 10 s des deux côtés, une seule ligne). Les messages d'erreur au joueur passent par une seule voie (`{ joueur }` → toast) : sauvegarde illisible, refusée ou serveur injoignable. Codes d'erreur stables `E-SAVE-001` à `005` et `E-SERV-001` à `003`, recensés dans `docs/erreurs.md`. Réglage à chaud : `?journal=SYNC:trace,RENDU:debug`, `MC_DEBUG.journal.niveau('SYNC', 'trace')`, option serveur `--journal`. Porte **G16** (`tests/gates.js`, `tools/console-directe.js`) : aucun `console.*` direct dans `src/` ni `server.js` hors de `src/journal.js` — les cinq `console.log` du serveur y passent désormais, sortie standard inchangée (`[HH:MM:SS] …`, `MC_PORT=` brut).

### Corrigé
- SPEC-BANC-090/091 (revue adversariale de la rétention) — pertes de données possibles : (1) une ligne de test illisible était écartée en silence puis le fichier réécrit sans elle et son image supprimée : un fichier à ligne rejetée n'est plus jamais réécrit et interdit toute suppression d'image (avertissement) ; (2) écritures non atomiques : entrées et pont pre-push → pre-commit passent par un fichier temporaire puis renommage (réessais bornés EPERM/EBUSY), temporaires `*.tmp-PID` orphelins nettoyés, verrou `.compaction.lock` (PID + péremption), relecture fraîche des références avant suppression et jamais d'image plus récente que le début de la compaction (une inscription concurrente n'est pas touchée) ; (3) le run de release pouvait être interrompu, restreint ou lancé sur un arbre modifié : seul un run fiable est retenu, sinon le cycle n'est ni marqué ni compacté (avertissement) ; (4) un `--publier` qui échouait après la compaction laissait un registre compacté sans étiquette et des fichiers non suivis perdus : la publication est transactionnelle (sauvegarde des fichiers touchés, restauration complète de la version, du journal et du registre si le commit ou l'étiquette échoue ; un marqueur de release provisoire — étiquette absente — ne compte pas comme « déjà fait ») ; (5) `git add -A -- tests/registre` embarquait impact.json, notes locales et temporaires : seuls les fichiers réellement touchés par la compaction sont ajoutés ; (6) la fiche du DERNIER passage de chaque test survit à la compaction sous forme réduite ; (7) le crochet n'énumère plus des centaines de fichiers (10 puis « … N autres »). Limite à soumettre : le code garde le run de CHAQUE préréglage `pr` et `e2e-fumee` du commit validé (les images vivent dans le run e2e), la fiche 090 dit « un run par release ».
- SPEC-BANC-088 (revue adversariale) — les runs interrompus et sur arbre modifié ne comptent plus ; un changement du fichier de test du test compte comme un changement ; un test hors carte d'impact (intégration, e2e) est évalué par un repli prudent (même commit ou rien de changé côté src/, server.js, fichier de test) qui détecte les integration-archi-* instables ; la colonne `instabilite` est filtrable côté client et le rapport affiche la ligne d'instabilité (« ⚠ instable — N alternances »).
- SPEC-BANC-104 à 110 (revue adversariale du journal) — (1) le jeton d'administration généré au démarrage était écrit en clair dans `logs/serveur-<date>.log` (gardé 14 jours) : il passe par un domaine `SECRET` que la sortie fichier ignore, la ligne de la console est inchangée ; (2) les erreurs remontées par les clients n'étaient bornées que par connexion (une reconnexion remettait le compteur à zéro) et acceptées avant `rejoindre` : seul un joueur admis est entendu, au plus 5 par 10 s par adresse et 30 par minute en tout, et le fichier du jour est plafonné (50 Mo, `MC_JOURNAL_MAX_OCTETS` ; au-delà une seule ligne `E-SERV-005`) ; (3) un nom de joueur ou un message de chat contenant un saut de ligne écrivait une ligne à lui dans la sortie du serveur (un faux `MC_PORT=`) : `NP.valider` retire les caractères de contrôle du nom et les remplace par une espace dans le chat, et toute ligne du journal indente ses suites et perd ses caractères de contrôle. Aussi : pile d'un client nettoyée (ESC, OSC, C1), vrai tampon circulaire, un appel au journal ne lève plus jamais, niveaux et modes à l'abri de `constructor`/`__proto__`, `?journal=%` ne bloque plus le chargement, `--aide` ne crée plus `logs/`, une panne de la sortie fichier est signalée une fois (`E-SERV-004`), `--journal LANCEUR:warn` est refusé (MC_PORT= toujours lisible), porte G16 durcie (alias, `?.`, `call`/`apply`/`bind`, déstructuration, `process.stdout.write`, sans faux positif dans les chaînes, gabarits et expressions régulières), serveurs des tests journalisés dans un dossier temporaire (`tests/journal-temp.js`), statiques de `MC.Journal` observées par `tests/run.js` sans compter les appels du harnais.
- SPEC-SAVE-017 — **perte d'objets au chargement d'une ancienne sauvegarde** (v1 ou v2, d'avant les blocs sur 16 bits) : la migration ne renumérotait que l'inventaire, les coffres et les fours. La **banque**, les **soutes des véhicules** et les **indices d'objet d'une enquête** gardaient leurs anciens ids : les objets devenaient des ids indéfinis (« ?129 » pour le charbon) ou **d'autres blocs** (l'ancienne carte, id 200, devenait un escalier ; les anciens seau, porte, lingots de cuivre… des escaliers et des dalles), et un indice d'enquête ne pouvait plus être résolu. L'import d'une partie (SPEC-ARCHI-015) héritait du défaut (joueur importé avec une banque fausse, soutes et indices aussi). Une seule fonction, `MC.Save.migrerIdsObjets`, convertit désormais tous les champs porteurs d'ids d'objet (inventaire, équipement, coffres, distributeurs, fours, banque, soutes, présentoirs, indices d'enquête, stocks de l'économie), pour v1 → v2 comme pour v2 → v3 ; chaque champ de la sauvegarde est classé dans `MC.Save.CHAMPS_IDS` (porteur d'ids d'objet, ou sans id et pourquoi), et un test échoue si un champ nouveau n'y est pas classé. `migrerV1`/`migrerV2` sont sans effet sur une sauvegarde d'une autre version et ne convertissent que l'ancien espace d'objets (64..127, 128..255) : migrer deux fois ne décale plus deux fois. Un champ porteur mal formé (pas un tableau) ne fait plus rejeter la partie à l'import. La donnée de l'appelant n'est plus modifiée par la migration. Tests : `tests/spec-blocs16.js`, dont une vraie sauvegarde v2 écrite par le client d'avant les 16 bits. **Attention** : une partie v1 ou v2 déjà chargée par une version antérieure à ce correctif a été réécrite en v3 avec ses anciens ids dans la banque, les soutes et les indices d'enquête ; ce correctif ne la répare pas. Une partie importée avant ce correctif dont le joueur n'a pas encore été adopté garde ces anciens ids tels quels dans son fichier de monde : une réparation y reste envisageable, mais les ids 200 à 229 (aujourd'hui des escaliers, dalles et clôtures) y sont ambigus. Les sauvegardes v1 ou v2 jamais ouvertes depuis le 2026-09-24 se migrent désormais sans perte.

## [0.6.0] - 2026-10-03
### Ajouté
- SPEC-SYNC-024 — un joueur qui rejoint reçoit, aussitôt après `BIENVENUE`, l'état complet des relations de faction dans un nouveau message `POLITIQUE` (s→c) : factions PNJ et leurs relations (jour politique compris), factions de joueurs avec leurs membres et leurs relations (ni candidatures ni invitations). Le serveur le rediffuse à tous dès que cet état change (jour simulé, faction découverte, commande `/faction`) : un client déjà connecté et un nouveau venu ont exactement le même état, sans rien déduire du chat. Le panneau des factions (J) affiche désormais les royaumes et factions du monde et la faction du joueur, tels que le serveur les tient.
- SPEC-SYNC-020 — un joueur qui se déconnecte puis revient sous le même nom (même serveur, sans redémarrage) retrouve aussi son regard et son point de réapparition : `BIENVENUE.toi[]` porte `yaw`, `pitch` et `spawn`, que le client reprend. Position, vie, faim, air, inventaire et équipement étaient déjà rendus ; le tout est vérifié de bout en bout.
- SPEC-ARCHI-001 et SPEC-ARCHI-020 (clôture du chantier « solo = serveur », L50) — audit statique final de `src/game.js` (plus aucune simulation du monde : eau, circuits, feu, cultures, créatures, apparitions, politique, éjection de distributeur ; la boucle d'images ne décide plus sur `net.enLigne()`), et vérification sur vrai serveur de l'écran partagé en mode fermé : pause demandée par le joueur 2 qui gèle tout le poste, joueur mort qui renaît après la reprise, compteur de dormeurs qui traverse la pause. La fonction morte `ejecterDistributeur` (éjection locale, jamais appelée) est retirée. Tests : `tests/spec-archi-env.js`, `tests/spec-archi-reseau.js`, `tests/integration-archi-cloture.js`.
- SPEC-BANC-067 à 076 — **périmètre d'exécution des tests** : le crochet `pre-commit` ne lance plus que les tests touchés par le commit (`node tests/run.js --preset commit --perimetre commit`), au lieu de tout le préréglage `commit`. Mesuré (crochet complet, juste après un push) : une fonction de `src/mesher.js` 190 s → 57 s (119 tests sur 1 338), une fonction de `src/eau.js` 26 s, un fichier de test 8 s ; une fonction interne de `src/world.js` reste large (176 s, 501 tests). Les commits suivants, jusqu'au push qui reconstruit la carte, retiennent aussi ce qui a changé depuis elle. Le moteur (`tools/perimetre.js`, `node tools/perimetre.js [--depuis <ref>] [--lister]`) part d'une **carte d'impact** versionnée (`tests/registre/impact.json` : fonction → tests qui l'appellent, fichier source → fonctions qu'il définit, commit de construction), reconstruite après chaque suite complète réussie ; il retient les tests d'un fichier de test modifié, les appelants des fonctions touchées (bornes des fonctions croisées avec le diff, propagation aux fonctions qui les appellent dans le module, modules qui les capturent, tests qui les nomment ou lisent le fichier), les tests sans données d'impact du même domaine, la fumée et `@toujours`. **Dans le doute il élargit** : du code hors fonction → tout le fichier ; outillage, serveur, page, module absent de la carte, carte absente ou à plus de 50 commits → repli sur tout le préréglage, motif affiché. Le cahier et l'historique portent la nature du run (`perimetre` : complet/commit/manuel), la raison de sélection de chaque test et, pour un run complet, les **trous de périmètre** (échecs que le périmètre n'aurait pas retenus). `pre-push` et le nouveau crochet `pre-merge-commit` (et `pre-commit` d'un merge avec conflits, `MERGE_HEAD`) lancent la suite complète `pr` + `e2e-fumee`, l'inscrivent au registre (origine `merge` pour un merge) et reconstruisent la carte. Banc web : « Périmètre du commit », « Périmètre depuis… », « Tout », avec l'aperçu des tests retenus et leur raison avant tout lancement (`GET /tests/perimetre`). G13 étendue.

### Corrigé
- SPEC-SYNC-024 (revue) — le message `POLITIQUE` était renvoyé ENTIER à chaque changement et l'état était sérialisé en JSON chaque seconde pour détecter un changement : à 300 lieux (287 factions, 41 041 paires), 1,6 Mo par envoi et 6,6 ms de JSON par seconde. Il part désormais complet une seule fois au join (factions dans leur ordre de naissance, relations PNJ↔PNJ en une chaîne dense d'un caractère par paire : 61 Ko, 5 ms), puis par différences (factions nées et relations changées, en indices : 16 Ko pour une journée simulée) ; la détection ne sérialise plus rien (Maps instrumentées, `MC.Politique.suivreReseau` : coût constant quand rien ne change). Il n'est plus envoyé aux sockets qui n'ont pas rejoint ; le panneau des factions (J) montre les relations de chaque faction et celles de la faction du joueur, ne casse plus sur un type de faction inconnu, et identifie le joueur par le nom que le serveur lui connaît (`moi`), pas par le pseudo local.
- SPEC-SYNC-020 (revue) — le point de réapparition relu du fichier de monde ou reçu dans `BIENVENUE` n'est accepté que fini et dans les bornes du monde (`MC.Synchro.spawnValide`, serveur et client) ; chaque joueur local de l'écran partagé reprend son regard.
- SPEC-MECA-006 (revue) — l'état d'une porte ou d'une trappe posée n'est plus repris du client (un « signal déjà vu » annoncé l'empêchait de s'ouvrir contre un levier actionné) ; un bloc remplacé par un autre perd son état résiduel (seule la bascule d'une porte ou d'une trappe le garde).
- SPEC-ARCHI-001 (revue) — `game.js` ne décide plus jamais sur `net.enLigne()` (le minage envoie toujours sa casse au serveur), ne tire plus le butin d'un coffre de donjon (`coffreDe`), ne fait plus tomber le contenu d'un coffre cassé (`spillContainer`) ni les restes de la grille (`dropLeftovers` ne fait plus que prévenir : le serveur les lâche). L'audit statique analyse le code sans commentaires ni chaînes, suit les alias et les accès par crochets, et couvre aussi `MC.Feu`, `MC.Economie`, `MC.Caravanes` (hors figurants affichés), `MC.Circuits`, `MC.Guildes` et la famille `avancer*`.
- SPEC-FACTION-017 — sur le serveur, `/faction relation <faction> <faction PNJ> …` était toujours refusé (« faction cible introuvable ») : l'état politique n'était pas transmis à `MC.Guildes.appliquerAction`. Une faction de joueurs peut de nouveau se déclarer alliée, neutre ou ennemie d'une faction PNJ, relation posée aussi côté PNJ.
- SPEC-MECA-006 — une porte ou une trappe ouverte à la main se refermait au tic de circuits suivant (0,2 s plus tard) : le serveur imposait à chaque tic l'état du signal voisin à toute porte du registre des mécanismes, et sans signal la refermait. Le signal ne commande plus la porte qu'à ses fronts (il monte : elle s'ouvre ; il retombe : elle se ferme), le dernier signal vu étant mémorisé dans l'état du bloc ; entre deux fronts, la main du joueur (ou d'un habitant) fait foi. Tests : `tests/spec-circuits.js`, `tests/integration-archi-cloture.js`.
- SPEC-BANC-067 à 076 (revue adversariale du périmètre d'exécution) — le périmètre du commit pouvait laisser passer des régressions : (1) la carte d'impact n'étant reconstruite qu'au push, un appel ajouté dans un commit précédent lui était inconnu — le diff part désormais du commit de la carte jusqu'à l'index (le repli reste décidé sur le seul commit) ; (2) modifier une fixture partagée d'un fichier de tests (`G.flatWorld`, `MC_LIMITES`…) ne relançait que ce fichier — tout fichier de tests qui la nomme est retenu (seulement entre fichiers chargés dans le contexte commun : un script d'intégration, lancé dans son propre processus, n'exporte rien) ; (3) `tests/registre/impact.json` et le README du registre étaient neutres — seules les entrées et images le sont, une carte invalide est refusée ; (4) une fonction appelée au chargement d'un autre module (`MC.Vehicules.gabarits()` dans `entities.js`) était ignorée — ce module est retenu en entier ; une donnée d'un module touché en entier lue par un autre retient les fonctions qui la lisent. Un test qui crée un dépôt git depuis un crochet agissait sur le vrai dépôt (variables `GIT_*` héritées : commit parasite, `core.bare=true`) — `tools/git-propre.js`. La carte référence les tests par identifiant stable, sans horodatage, et n'est réécrite que si elle change ; seul un run `pr` complet et réussi la nourrit ; un contrôle de trous replié est « non vérifiable » ; `--sauf` compte comme sélection manuelle. Preuve de bout en bout : `node tools/mutation-perimetre.js` (mutation → périmètre → tous les tests qui échouent réellement sont retenus).
- Tests d'intégration ARCHI : le refus des adresses réseau est sondé sur un serveur en `--port 0` (un serveur ouvert déjà présent sur 8080 donnait un faux échec) ; la fermeture brutale du dernier client est attendue jusqu'à 5 s au lieu de 1 s (la détection d'une socket détruite dépend de l'OS et de la charge).
- SPEC-BANC-122 — les routes du banc (historique, cahiers, images du registre) ne vérifiaient que l'adresse locale : n'importe quelle page web ouverte sur la machine pouvait les appeler (requête « no-cors »), et un export HTML de 34 Mo construit d'un bloc bloquait le serveur 0,85 s (cinq en parallèle, près de 5 s). Mêmes contrôles que l'API des parties (mandataire, Origin, Host, requête intersites) ; export écrit par paquets, un seul à la fois, borné à 100 000 lignes. Colonnes d'export « constructor »/« __proto__ » ignorées, formules de tableur (= + - @) neutralisées dans le CSV. Après « historique (N) », le tableau restait filtré sur ce test (filtre invisible) : la colonne Identité s'affiche, « Tous les runs » et une réouverture simple lèvent le filtre. Les noms de cahiers ne sont plus insérés bruts dans les attributs de `/tests/cahiers`.
- SPEC-BANC-118 — les tests des fichiers Node seulement et d'intégration n'apparaissaient dans le banc qu'après un passage dans l'historique : le catalogue Node complet est publié (`node tests/run.js --catalogue-json`, `GET /tests/catalogue`), chargé à la première ouverture de la sélection. Une liste de fichiers de tests absente s'affiche en erreur au lieu d'un catalogue vide.
- SPEC-BANC-117 — le banc navigateur (`tests/index.html`) ne montrait que les 150 tests e2e : `tests/e2e.js` remplaçait le harnais `G.T` par son propre objet, et les 1 212 tests unitaires, fonctionnels et spec chargés avant lui disparaissaient du catalogue, introuvables pour les lancer comme pour ouvrir leur historique. Les deux listes de fichiers de tests (run.js, page) avaient en outre divergé (spec-transport, spec-environnement, spec-archi-vehicules absents de la page ; spec-crochets, Node seulement, y levait « require is not defined ») : une seule liste, `tests/fichiers-tests.js`. « Lancer » n'exécutait que le type « unitaire » : les tests fonctionnels et spec cochés ne tournaient jamais.
- SPEC-BANC-118 — les tests d'intégration et ceux des fichiers Node seulement étaient absents du banc : ils y apparaissent (« hors de ce banc »), avec, comme chaque test de l'arbre, un lien vers leur historique (`GET /tests/historique/tests`).
- SPEC-BANC-119 — un test n'avait pas d'identité propre : son `id` (1re SPEC citée) est partagé par tous les tests d'une même spec — 1 334 tests pour 863 `id` dans la dernière campagne — et le rang des `id` générés bouge d'une campagne à l'autre (47 tests à l'historique coupé en morceaux). Cocher un test en cochait d'autres, leurs résultats s'écrasaient dans une seule ligne, et l'historique d'un test mêlait ceux de ses voisins. Identité `cle` (groupe › nom), recalculée sans migration depuis le registre.
- SPEC-BANC-120 — une donnée inattendue d'un cahier local (`null`, liste qui n'en est pas…) faisait lever toute la reconstruction de l'historique et la liste des cahiers : la requête restait sans réponse et la page attendait indéfiniment. Données normalisées, routes protégées (erreur lisible), page de taille bornée à 500 lignes, export produit par le serveur (l'ancien téléchargeait 64 Mo de JSON pour 45 runs), réponses périmées ignorées, texte d'un filtre conservé pendant la saisie (il s'effaçait à chaque réponse), filtre de date « jusqu'au » inclusif, `/tests/` sert la page du banc (404).
- SPEC-BANC-121 — un clic sur une ligne de l'historique n'ouvrait rien : il ouvre le panneau du test (tous ses passages, message complet, captures, lien vers le cahier).
- SPEC-ARCHI-047 — immobile, le joueur était régulièrement recalé dès qu'une créature le serrait (groupe de créatures, villageois ou monstre collé à lui, créature coincée contre un mur) : le serveur le poussait hors d'elle à chaque tic, ce que le client, qui prédit son propre corps, ignorait — chaque `ETAT` le recalait. Le serveur ne déplace plus jamais le corps d'un joueur pour cela : la créature cède (`entites.cederAuxJoueurs`, face à tous les joueurs, en glissant le long d'un mur) ; acculée, elle reste contre lui. Le vent des tornades reste une force appliquée par le serveur (recalages possibles près d'une tornade active). Tests : `tests/integration-archi-sync.js` (créatures serrées, `MC_TEST_MOBS`), `tests/integration-archi-reseau.js` (`MC_TEST_MOB` posé du côté dégagé).
- SPEC-ARCHI-045 — en « vol statique », le joueur descendait, et c'était l'une des causes du recalage d'un joueur immobile (l'autre : SPEC-ARCHI-047) : hors créatif le client volait (double appui sur Espace jamais refusé) alors que le serveur, qui fait foi, ignorait le vol et le faisait tomber — chaque `ETAT` le ramenait plus bas. La bascule passe désormais par `MC.Synchro.basculerVol`, sans effet hors créatif, et la réconciliation reprend l'état de vol du serveur. En créatif, reprendre le vol en pleine chute recalait aussi le joueur vers le bas (le serveur gardait l'élan de la chute) : la vitesse verticale repart de zéro chez le serveur au même point, `ETAT.toi[].vol` donne son état de vol à la réconciliation, et le client adopte le mode du serveur à la connexion. Les statistiques du serveur (dont la faim, qui ralentit la marche) s'appliquent désormais avant le rejeu des entrées.
- SPEC-ARCHI-046 — l'heure du monde avançait puis reculait sans fin : chaque `ETAT` (jusqu'à 60 par seconde) écrasait `g.time`, que le client avançait aussi de son côté, avec une heure arrondie au dixième et parfois en retard (tic serveur plafonné à 0,25 s). Un seul écrivain désormais, `MC.Synchro.creerHorloge`, qui rattrape l'écart sans reculer (saut adopté au-delà de 2 s), et l'heure part au millième. Elle avance aussi mort, inventaire ouvert ou menu pause en réseau ouvert (elle ne s'arrête que quand le serveur est réellement en pause), et une heure non finie (`debug.heure()` sans argument) ne bloque plus l'horloge. Tests : `tests/spec-archi-reseau.js`, `tests/integration-archi-sync.js`.
- `integration-archi-vehicules` : Bob s'éloigne à plus de 10 m avant le test « portee » (le serveur mesure en 3D moins la demi-largeur, le test à 6,x m horizontaux était au seuil).

## [0.5.0] - 2026-10-01
### Ajouté
- SPEC-ARCHI-021, SPEC-SYNC-022 et SPEC-SERVEUR-006 (lot P-VEH, chantier « solo = serveur toujours présent », L50) — les véhicules sont simulés par le SERVEUR, pour tous les joueurs (solo fermé, écran partagé, réseau) : le refus « Les véhicules ne sont pas disponibles en ligne » et la conduite locale de `game.js` disparaissent.
  - **Messages** (`src/contrats-archi.js`) : `VEHICULE_POSER { j, nom, i, x, y, z, nx, ny, nz }`, `VEHICULE_MONTER { j, eid }`, `VEHICULE_DESCENDRE { j }`, `VEHICULE_REPARER { j, eid }` (c→s, budgets anti-flood, gelés en pause) et `VEHICULE_EVT { j, evt, nom?, motif? }` (s→c : `pose`, `monte`, `descend`, `repare`, ou `refus` avec un motif de liste fermée : `portee`, `occupe`, `deja_a_bord`, `inconnu`, `place`, `inventaire`, `mort`).
  - **Poser, monter, descendre** : le serveur valide la portée, la place libre (jamais dans le décor, 256 véhicules au plus), l'occupation et — en survie — retire l'objet de l'inventaire SERVEUR (`INV_MAJ`), sans crédit de débit : le client ne prédit plus cette consommation. Un conducteur qui se déconnecte, meurt ou dont l'engin est détruit met pied à terre côté serveur.
  - **Conduite** (SYNC-022) : les touches de `ENTREE` deviennent les commandes de l'engin dans `player.updateMovement` (même code chez le serveur, qui fait foi, et chez le client, qui prédit) ; la vitesse, la position et le carburant se simulent sous le budget de temps du joueur — un client qui réclame 20 s en 1,3 s n'avance pas plus vite. `ETAT.toi[].veh` rend l'état exact de l'engin conduit (`MC.Synchro.ajusterMonture` embarque la réplique de `net.mobsDistants`, la réconcilie, la quitte quand le serveur fait descendre) ; un conducteur muet voit son engin ralentir et retomber (VEHIC-009).
  - **Diffusion** : les véhicules sont diffusés avec les créatures (`ETAT.mobs`, champs `ve`, `vi`, `co`, `ca`, `av`) avec leur propre plafond `MAX_VEHICULES_DIFFUSES` (32 par client, à portée) et une description calculée une fois par relevé, pas une fois par client (100 joueurs : aucune amplification).
  - **Soute** : un conteneur serveur de clé `v<eid>` (types `soute9` et `soute27` ajoutés à `TYPES_CONTENEUR`, clé lue par `lireCle`), ouverte par `CONTENEUR_OUVRIR { eid }` avec les mêmes transferts, deltas et abonnés qu'un coffre ; un véhicule détruit rend sa soute au sol et ferme l'écran de ceux qui l'avaient ouverte.
  - **Sauvegarde** (SERVEUR-006) : `etatMonde()` écrit `vehicules` (format de `MC.Vehicules.serialiser` : position, cap, soute, carburant, avarie) ; `appliquerEtatMonde()` les restaure, y compris ceux d'une partie solo importée (`extras.vehicules`, repris une fois puis retirés des extras).
  - **Réparation** (TRANSPORT-002) : `VEHICULE_REPARER` — le véhicule conduit se répare chez un forgeron à portée et se paie en émeraudes sur l'inventaire serveur (`MC.Habitats.servir`), plus sur la réplique locale. **Cabine étanche** : `updateSurvival` ne noie plus un joueur à bord d'un sous-marin.
  - **Succès « premier véhicule »** : l'embarquement appelle `signalerSucces(js, { type: 'vehicule', vehicule })` côté serveur (suivi P-SUCC) ; le joueur, y compris en écran partagé (`j` > 0), reçoit `SUCCES_DEBLOQUE`. Le client ne signale plus rien.
  - **Après revue** : quota de 12 véhicules libres par joueur (en plus du plafond global de 256) ; un véhicule au repos n'est plus intégré à chaque tic (appui revérifié deux fois par seconde) ; une entrée de sauvegarde de véhicule est validée (modèle, coordonnées, soute de la bonne taille et piles plausibles, carburant borné au plein, gravité d'avarie 0..3) ; `descendre` cherche deux couronnes puis un toit libre, jamais dans un bloc ; la sélection des véhicules diffusés a une hystérésis (`selectionnerAvecHysteresis`) ; une ancienne sauvegarde du navigateur ne fait plus apparaître de véhicules fantômes côté client (`sansVehiculesLocaux`) ; le réglage de test `MC_TEST_MOBS` accepte un métier en 4e élément. Un véhicule n'a pas de propriétaire (limite assumée, fiche 021).
  - Tests : `tests/integration-archi-vehicules.js` (vrais processus `server.js` sur une dalle plate : pose payée, refus motivés, conduite, triche sur la durée, deux clients, soute partagée, véhicule détruit, sauvegarde/relance, import solo, audit de `game.js`), `tests/spec-archi-vehicules.js` (Node pur : prédiction exacte, réconciliation, cabine étanche, soute), `tests/spec-contrats-archi.js` (validateurs). README « Limites connues » corrigé.
- SPEC-ARCHI-041 (lot P-HIST, chantier « solo = serveur toujours présent », L50) — le mode histoire redevient jouable : le SERVEUR tient le récit, en solo fermé, en écran partagé comme à plusieurs
  - **Un récit par joueur** (règle réseau) : chaque joueur nommé a le sien (archétype, chapitre, étape, drapeaux, quêtes, journal), créé à son arrivée, lié aux lieux réels du monde (recherchés UNE fois au démarrage, puis persistés) ; le héros s'éveille sur la place du village de départ. Il est écrit dans `histoire` du fichier de monde ; le récit d'une partie solo importée (`extras.histoire`) est adopté par le joueur du poste à sa première connexion (parité SPEC-ARCHI-014).
  - **Le serveur arbitre** : poser (`BLOC`), tuer, vaincre un gardien, position, inventaire, météo, lieu d'entrée et parole font avancer le récit du joueur concerné ; récompenses et objets repris passent par l'inventaire serveur (`INV_MAJ`), les créatures d'un évènement apparaissent côté serveur ; casser ou poser hors de ce que le mode permet (`Modes.peutCasser`/`peutPoser`) est refusé par le serveur, et `BIENVENUE` porte les règles du récit (un joueur distant les adopte).
  - **Le client affiche et répond** : `HISTOIRE_ETAT` (objectif, repère, journal), `HISTOIRE_NOTIF` (répliques, quêtes proposées, commerce libre) ; il envoie `HISTOIRE_PARLER` (portée jugée par le serveur) et `HISTOIRE_REPONSE` (identifiant et option revérifiés : réponse périmée ou rejouée sans effet). Plus aucune simulation du récit dans `game.js`.
  - **Succès** : l'achèvement du récit signale `histoire_achevee` une seule fois par `signalerSucces(js, ev)` (lot P-SUCC, `succesHistoire` dans server.js) ; le client ne signale plus rien.
  - Tests : `tests/integration-archi-histoire.js` (vrais serveurs), `tests/spec-recit-serveur.js` (logique pure, anti-rejeu) ; les e2e SPEC-HISTOIRE-009/010/014 jouent sur un serveur d'histoire réel, lancé par le serveur de test (`POST /tests/serveur-histoire`, seulement avec `--tests`).
  - **Après revue** : le serveur évalue le récit de chaque joueur deux fois par seconde de temps de jeu (position, lieu, biome, inventaire, heure, météo, habitants de la colonie ; mort en cauchemar) — « rejoindre un lieu » et « rassembler X » avancent ; un récit de partie importée n'est retiré des extras qu'une fois rattaché à un joueur (illisible, il est conservé tel quel) ; l'état n'est reconstruit que si une signature légère change ; en écran partagé chaque joueur répond à ses choix et quêtes (`HISTOIRE_REPONSE` avec son `j`) ; la recherche des lieux de l'épopée (~6 s) a lieu au démarrage d'une partie neuve (l'écran d'attente la couvre) et est persistée aussitôt ; `POST /tests/serveur-histoire` partage la garde des routes locales (adresse, hôte, mandataire, origine) et exige `application/json`.
  - Amendement du contrat `src/contrats-archi.js` : trois messages `HISTOIRE_PARLER` (le joueur parle à un habitant), `HISTOIRE_REPONSE` (réponse à un choix du récit ou à une quête proposée) et `HISTOIRE_NOTIF` (ce que le récit annonce : répliques, quêtes proposées, commerce libre), validateurs bornés et budgets anti-flood, testés dans `tests/spec-contrats-archi.js`.
- SPEC-ARCHI-042 (lot P-SUCC, chantier « solo = serveur toujours présent », L50) — les succès sont suivis et attribués par le SERVEUR pour tous les joueurs (solo fermé, écran partagé, réseau) : en solo fermé ils n'étaient plus comptés du tout depuis que le serveur est toujours présent (`succes:null`), le serveur reprend donc le suivi `MC.Succes` à son compte, sans que le client puisse s'en attribuer un.
  - **Serveur** : un suivi `MC.Succes` par joueur local, persisté dans l'enregistrement du joueur nommé (`joueurs[nom].succes`, relu à la reconnexion : un succès obtenu n'est jamais renvoyé). Événements décidés sur ce que le serveur constate : casse acceptée (`BLOC`), fabrication validée (`CRAFT`, le résultat fabriqué est rendu dans `effets.ids`), repas (`MANGER`), échange (`TROC`), ouverture de la banque (`CONTENEUR_OUVRIR`), victoire PvP (`issuePvp`), foudre survécue, créature hostile tuée et gardien vaincu (les événements `mort` et `boss_vaincu` d'`entities.js` portent l'`auteur` du coup fatal ; le gardien crédite aussi les joueurs à moins de 64 blocs), lieu visité (`habitats.lieuA`). Distance, altitude et nuit survécue viennent de `MC.Succes.creerSuiveur()`, appelé à chaque tic avec la position qui fait foi (distance = intégrale des déplacements, un bond de 20 blocs ou plus ne compte pas, un mort ne cumule rien ; altitude et distance remises une fois par seconde de jeu).
  - **Messages** : `SUCCES_DEBLOQUE` (annonce, une seule fois), `SUCCES_ETAT` (compteurs du panneau : à la connexion, à chaque déblocage, puis au plus toutes les 2 s si un compteur a changé — `revision()`), `FOUDROYE` (toast « Foudroyé ! » et cri, envoyés par le serveur qui blesse). Le client n'a plus de `signalerSucces` ni de `tickerSucces` : `g.succes` n'est que le miroir des compteurs du serveur, et un joueur local autre que le premier reçoit l'annonce dans le chat.
  - **Après revue** : une victoire en duel ne rapporte aucun succès PvP ; « Nuit survécue » exige d'avoir vu la nuit tomber pendant la session, 120 s éveillé au moins, et ne vient jamais du sommeil ; une renaissance proche n'est plus comptée comme distance ; un identifiant inconnu (« constructor »…) n'est jamais un succès ; le panneau ouvert se rafraîchit ; l'e2e SPEC-SUCCES-001 passe par un vrai serveur.
  - **Import** : les `extras.succes` d'une partie solo importée sont repris par le joueur qui adopte la partie, puis retirés des extras (une seule source de vérité).
  - **Limites assumées** : `premier_vehicule` (pas de véhicules côté serveur, lot P-VEH) reste inobtenable en ligne ; `histoire_achevee` passe par `signalerSucces(js, ev)` depuis P-HIST. La pose d'un bloc n'est pas un événement (aucun succès n'en dépend).
  - Tests : `tests/integration-archi-succes.js` (vrais processus `server.js` sur `--port 0`, arrêtés en fin de test), `tests/spec-succes.js` (suiveur de position, révision), `tests/spec-archi-reseau.js` (routage des trois messages, audit statique de `game.js`), `tests/spec-monde.js` (auteur des événements), `tests/spec-conteneurs.js` (résultats fabriqués). Le test e2e « SPEC-SUCCES-001 : casser un bloc » de `tests/e2e.js` s'appuyait sur le suivi local du client : il doit désormais passer par un serveur (non modifié ici).
- SPEC-ARCHI-029, 036, 037, 038, 039 (liste des joueurs et contexte des commandes), 040 et SPEC-SYNC-025 (lot B-RESEAU, chantier « solo = serveur toujours présent », L50) — le client n'a plus aucune branche `net.enLigne()` propre au réseau pour ces sujets : solo fermé, écran partagé et réseau suivent le même chemin :
  - **Sauvegarde** (036) : `doSave`, la sauvegarde automatique de 60 s et le crochet `beforeunload` disparaissent de `game.js` ; le client n'écrit plus aucune partie (ni `localStorage`, ni fichier). « Sauvegarder » (menu pause, touche) est une DEMANDE au serveur : nouvelle route `POST /api/parties/sauver`, réservée à la boucle locale (adresse, Host, Origin, comme le reste de l'API des parties), une demande par seconde au plus (429 ensuite), 409 sans partie active, omise si le monde n'a pas changé. La fermeture brutale d'un onglet reste couverte : le serveur sauvegarde au départ du dernier client (SPEC-ARCHI-008/012), prouvé avec un vrai onglet fermé. Le mode cauchemar efface la partie DU SERVEUR (`poste.supprimerPartie`).
  - **Prédiction** (037) : tout joueur local (le clavier comme chaque manette) a une prédiction dès sa création ; son déplacement n'est appliqué que par `MC.Synchro` (rejouer l'entrée, réconcilier sur l'état du serveur) — plus de `updateMovement` direct hors de la prédiction. Les véhicules restent simulés par le client (P-VEH).
  - **Overrides** (038) : `streamChunks` demande TOUJOURS les overrides de chaque chunk voulu (`OVERRIDES_DEMANDE`), au débit déjà borné (20 par seconde) ; une demande non envoyée faute de connexion n'est pas marquée et repart à la connexion.
  - **Factions** (029, SYNC-025) : `/faction …` part toujours au serveur (qui arbitre déjà, solo fermé compris) ; `g.guildes` et `MC.Guildes.creerEtat()` disparaissent du client ; `BIENVENUE` annonce désormais `guilde` (`{ id, nom, rang }` ou `null`, un résumé court, jamais l'état complet), affichée à la connexion : la reconnexion retrouve la même guilde. SPEC-SYNC-024 (relations complètes des factions PNJ au join) reste ⏳.
  - **Affichage** (039, 040) : `/qui` liste toujours les joueurs connectés et ne répond plus « Hors ligne » ; `net.interpoler(dt)` est appelé sans condition (sans autre joueur, les tables sont vides et l'appel est sans effet).
  - **Après revue** : les créatures repoussent de nouveau le joueur, mais côté SERVEUR (`entites.separer`, une fois par tic et par joueur qui a avancé) ; la prédiction du client ne la connaît pas, la réconciliation absorbe l'écart (la séparation locale du solo hors ligne est perdue, remplacée par celle du serveur). Les overrides sont indexés PAR CHUNK côté serveur (une `OVERRIDES_DEMANDE` coûte le contenu du chunk, plus un balayage du monde entier ; cx/cz entiers et bornés, budget général de 30 messages/s par connexion). `POST /api/parties/sauver` ne répond qu'une fois l'état demandé écrit (y compris quand une écriture périodique était en vol). En réseau ouvert, le départ d'un joueur déclenche une sauvegarde (débounce : au plus une toutes les 10 s). L'API des parties refuse les en-têtes de mandataire (`X-Forwarded-For`, `Forwarded`, `X-Real-Ip`) comme `connexionLocale`. Code mort retiré (`guildes` dans `save.js`, `g.guilde`). Écart connu : la page de test (`tests/index.html`, sans poste ni serveur) garde ses chemins locaux de création/chargement de parties ; la production (`index.html`) passe toujours par le serveur.
  - Tests : `tests/integration-archi-reseau.js` (vrais processus `server.js` et vrai navigateur, onglet fermé brutalement), `tests/spec-archi-reseau.js` (prédiction/réconciliation, interpolation), `tests/spec-poste.js` (demande de sauvegarde). E2E SPEC-NET-021 : attentes par sondage borné au lieu de délais fixes (le test échouait sur une machine chargée).
- SPEC-ARCHI-022, 024, 025, 034 et 035 (lot B-ENV, chantier « solo = serveur toujours présent », L50) — le monde n'est plus simulé par le client : c'est le MÊME serveur, en solo fermé, en écran partagé ou à cent joueurs, qui fait tout (plus aucune branche `net.enLigne()` ne fait diverger solo et réseau pour ces aléas) :
  - **Tornades** (022) : le serveur POUSSE joueurs et créatures (aspiration, rotation, soulèvement de `Meteo.pousseeTornade`, qui accepte désormais la liste de tornades à utiliser) et arrache plantes et feuillages (BLOC diffusé) ; le client ne rend plus que l'entonnoir. **Foudre** : le serveur retirait déjà les PV et allumait les feux ; le client ne fait plus que l'éclair, le tonnerre et le toast, sans jamais toucher à la vie ni aux blocs.
  - **Sommeil** (025) : `DORMIR {j, actif}` (`net.dormir`) ; le serveur tient le vote des dormeurs sur TOUS les joueurs présents et vivants (locaux et distants) et fait passer la nuit dès qu'une MAJORITÉ STRICTE dort (un solo : 1 sur 1 ; deux joueurs : les deux ; à 100 joueurs un seul éveillé ne bloque plus la nuit) ; un dormeur qui s'éloigne de plus de 1,5 bloc, est touché, meurt ou se déconnecte sort du vote de lui-même (côté serveur, sans rien attendre du client), un saut d'heure l'annule ; un écran partagé compte ses joueurs locaux (jusqu'ici seul le joueur 1 pouvait se coucher) ; refus de dormir de jour ; `DORMIR` est gelé en pause. La chambre d'auberge se couche par le même message.
  - **`/jour`, `/nuit`** (025) : une demande `ADMIN { action: 'heure', args: { valeur } }`, refusée (`reserve_creatif_ou_admin`) sauf pour un administrateur authentifié ou pour l'hôte LOCAL d'un monde en mode créatif (jamais « n'importe quel joueur en créatif » d'un serveur ouvert), une demande par seconde et par connexion, journalisée seulement si l'heure change — identique en solo fermé et en réseau (en ligne, ces commandes ne faisaient jusqu'ici RIEN) ; l'heure est réglée DANS le jour courant (la date et la saison ne reculent plus), y compris pour les blocs de commande.
  - **Apparitions et gardiens** (034) : le serveur fait apparaître les créatures autour des joueurs à tour de rôle, au plus 8 joueurs par tic de 3,5 s (jusqu'à 8 joueurs chacun garde le rythme d'un solo ; à 100 joueurs le coût par tic reste borné et chacun est servi toutes les ~44 s), et éveille gardes et gardiens de donjon (`surveillerDonjonsServeur`, annonce dans le chat) — en ligne, aucun gardien n'apparaissait jusqu'ici. **Cultures et feu** : `world.tick` accepte `surBloc` (chaque stade de croissance et chaque étape du feu est diffusé par BLOC, seulement aux clients dont un joueur est à moins de 96 blocs, en une écriture par client et par tic, plafonnée à 128 blocs (le surplus est abandonné pour ce client, qui retrouve l'état exact par les overrides en rechargeant le chunk)) et `cultures: false` ; le serveur ne joue plus l'eau dans le tic (elle est diffusée par sa boucle dédiée, ses changements étaient jusque-là perdus), le client coupe eau, circuits, cultures et feu (`optionsTickClient`).
  - **Habitants** (024) : `peuplerLieux` du client est retiré ; les habitants viennent de `ETAT.mobs` (le serveur les faisait déjà vivre). **Fabrication** (035) : elle passe par `CRAFT` en solo fermé, prouvée de bout en bout ; le README ne prétend plus que l'inventaire, le craft, les fourneaux et les cultures restent côté client.
  - **Limites assumées** : la neige saisonnière reste calculée des deux côtés (déterministe par l'heure) ; les gardes déjà éveillés (`gardesEveilles`) ne sont pas persistés (à un redémarrage du serveur, ils se réveillent de nouveau) ; le toast « Foudroyé ! » et le succès `foudre` restent calculés par le client (présentation seule, même formule pure que le serveur ; à porter avec P-SUCC).
  - Tests : `tests/integration-archi-env.js` (vrais processus `server.js`, arrêtés en fin de test), `tests/spec-archi-env.js` (Node pur : ce que `game.js` ne fait plus, `world.tick`, `net.dormir`, protocole) et, dans `tests/e2e.js`, un espion sur `world.tick` du client réel (0 appel avec eau ou circuits, 0 apparition de créature en 600 images).
- SPEC-ARCHI-026 à 028 (lot B-VIE, chantier « solo = serveur toujours présent », L50) — vie, survie, combat, butin et duel n'ont plus aucune branche `net.enLigne()` dans le client : solo fermé, écran partagé et réseau suivent le MÊME chemin serveur.
  - **Vie et survie** (026) : `game.js` n'appelle plus `updateSurvival` ni `subirClimat` (vie, faim, air et froid/chaleur arrivent de l'état reçu ; le message de froid/chaleur reste affiché d'après la température, `Player.climatDe`) ; `respawn` demande toujours la renaissance au serveur, qui choisit le lieu (le lit sur lequel le joueur s'est couché, `DORMIR`, tant qu'il existe, sinon le point d'apparition) et remet vie, faim et air. `RENAITRE` est désormais traité même en pause (exception à SPEC-ARCHI-010) : un mort ne reste plus bloqué devant un monde figé.
  - **Combat et butin** (027) : une attaque ou un tir est toujours un message `ATTAQUE`/`TIR` ; le client ne blesse plus aucune créature, ne ramasse plus rien et n'appelle plus `entities.update` (butin par `DONNE`/`INV_MAJ`, un seul compte). Le serveur ne croit plus les chiffres annoncés : coups et tirs portent la case d'inventaire tenue (`i`) et le serveur lit dans SON inventaire les dégâts, la portée, le recul et la cadence de l'arme (dague 0,22 s, masse 0,95 s ; tirs : dégâts, vitesse et cadence de l'arc, de l'arbalète, de la fronde ; sans `i`, la meilleure arme possédée). Le plafond reste donc « ce que le joueur possède et tient », la case désignée étant vérifiée contre l'inventaire serveur. Il éveille lui-même gardes et gardiens de donjon pour un joueur solo (une seule boucle serveur, `surveillerDonjonsServeur` de B-ENV : la boucle `eveillerDonjons` de B-VIE, identique, a été supprimée à la fusion ; message système « … s'éveille ! »).
  - **Duel** (028) : `/duel` est toujours envoyé au serveur, qui refuse seul avec un motif quand il n'y a personne à défier.
  - **Survie au temps serveur** (026) : `updateSurvival` est appelé une fois par tic avec le dt réel du serveur (gelé en pause), et non plus à chaque entrée rejouée : un client muet a faim et se soigne comme les autres, sans double compte avec les entrées.
  - Réglages de test `MC_TEST_MOBS` et `MC_TEST_INV` : avertissement visible au démarrage du serveur.
  - Limite de test : la cadence rapide de la dague n'est pas éprouvée en jeu réel, l'invulnérabilité de 0,35 s d'une créature blessée masque l'écart avec l'ancien plancher de 0,4 s ; la cadence lente de la masse l'est.
- Régressions assumées : l'usure des armes de mêlée n'est plus décomptée (le serveur ne l'applique pas encore) ; les cris de créatures et les toasts de butin (`+n objet`) locaux disparaissent avec la simulation client.
  - Tests : `tests/integration-archi-vie.js` (vrais processus `server.js`, réglage de test `MC_TEST_MOBS`), `tests/e2e.js` adapté (ATTAQUE/RENAITRE espionnés, plus de simulation client).
- SPEC-ARCHI-030 à 033, SPEC-SYNC-026 et SPEC-SYNC-028 (lot B-INV, chantier « solo = serveur toujours présent », L50) — plus aucune branche `net.enLigne()` dans le client pour les conteneurs, l'inventaire, le commerce et le bloc de commande : solo fermé, écran partagé et réseau suivent le MÊME chemin serveur.
  - **Conteneurs** (030) : coffre, armoire, étagère, bibliothèque, fourneau, distributeur et banque (coffre-fort ou banquier) s'ouvrent et se ferment par `CONTENEUR_*` ; les tables locales `furnaces` et `world.banque` disparaissent de `src/game.js` (les fourneaux cuisent dans le serveur, fenêtre fermée comprise ; le contenu d'un conteneur cassé est lâché par le serveur).
  - **Inventaire** (031) : manger (`MANGER` avec la case tenue), poser (`BLOC` avec la case d'inventaire), jeter (`INV_LACHER`) et le journal de diminutions (`INV_CONSOMMER`) passent toujours par le serveur ; une pose ou un usage fait par la manette ou par un joueur d'écran partagé est désormais aussi annoncé (`annoncerPose`, avec le bon indice de joueur, jusqu'ici toujours 0).
  - **Serveur, SPEC-SYNC-028** : en survie, une pose de bloc n'est acceptée que si l'inventaire SERVEUR porte un objet qui la permet (bloc, graine, porte, trappe, dalle), un tir que s'il porte une munition compatible (ou une arme sans munition, ou une fronde chargée : `galet` est un genre de tir valide) ; l'objet est retiré côté serveur à cet instant. Le journal `INV_CONSOMMER` que le client envoie ensuite est absorbé par un crédit de 3 s (jamais compté deux fois). Un refus rappelle le bloc autoritaire et renvoie l'inventaire.
  - **Serveur, SPEC-SYNC-026** : les objets au sol ont leur propre plafond de diffusion dans `ETAT` (`NP.MAX_ITEMS_DIFFUSES` = 64), à part des 80 créatures : un objet lâché n'est plus évincé par des créatures plus proches.
  - **Économie** (032) : un marchand se consulte et se négocie par `TROC` ; `game.js` n'appelle plus `MC.Economie` et ne tient plus `g.economie` (frais de garde et trésor n'évoluent que dans `avancerEconomie` du serveur).
  - **Bloc de commande** (033) : la modification passe toujours par `ADMIN` ; le serveur décide seul, par la même règle en solo fermé et en réseau (`MC.Circuits.commandeAutorisee` : administrateur, ou hôte en boucle locale quand la partie est en créatif), revérifie qu'il s'agit d'un bloc de commande, la portée, et refuse en pause.
  - **Correctifs de revue** : la porte (moitié haute) et le lit (tête) sont posés en entier par le serveur, et cassés en entier ; ouvrir/fermer une porte ou une trappe est annoncé au serveur (bascule à portée, sans objet, gelée en pause) ; un coffre généré jamais ouvert lâche son butin à la casse (contenu tiré avant la casse) ; le crédit de débit serveur dure 120 s (128 au plus) au lieu de 3 s ; `MC_TEST_POSE_LIBRE` s'annonce au démarrage ; une munition sans type ne sert plus la fronde ; présentoirs (SPEC-ARCHI-043) et coffres piégés/surprises (SPEC-ARCHI-044) sont refusés avec un message tant que le serveur ne les porte pas (reportés ⏳ : ils dupliquaient ou perdaient des objets).
  - Tests : `tests/integration-archi-inv.js` (vrais processus `server.js` fermés au réseau, sans `MC_TEST_POSE_LIBRE`), `tests/spec-secu.js` et `tests/spec-circuits.js` étendus. Les autres suites d'intégration qui posent des blocs sans s'en donner posent `MC_TEST_POSE_LIBRE=1` (réglage de test du serveur, comme `MC_TEST_PANNE`).
- SPEC-ARCHI-002 à 015 (lot A0, chantier « solo = serveur toujours présent », L50) — le serveur de jeu est désormais FERMÉ au réseau par défaut et se pilote à chaud :
  - **Liaison et sécurité** (002, 003) : sans `--ouvert` ni `--serveur`, `server.js` n'écoute que `127.0.0.1` ET `::1` (jamais `0.0.0.0`) ; l'en-tête `Origin` de la mise à niveau WebSocket et des requêtes `/api/parties` doit être l'une des trois origines locales (`http://localhost:P`, `http://127.0.0.1:P`, `http://[::1]:P`) — sinon 403 — et l'en-tête `Host` un nom local (rebond DNS) ; sans `Origin` (client non navigateur) la requête passe.
  - **Port** (004) : défaut stable 8080 avec repli sur le premier port libre jusqu'à 8099 (annoncé dans le journal) ; `--port <n>` l'impose (occupé → arrêt code 1 avec un message clair) ; `--port 0` prend un port éphémère ; une ligne `MC_PORT=<n>` est imprimée pour les lanceurs.
  - **Réseau à chaud** (005, 006, 007) : `RESEAU {ouvert}` (boucle locale seulement) ouvre/ferme le réseau sans redémarrer ni couper les connexions locales ; `RESEAU_ETAT` diffuse le résultat ; fermer sauvegarde puis expulse les connexions non locales (`REFUS reseau_ferme`). En fermé, un seul poste à la fois (`poste_deja_connecte`) ; `maxJoueurs` compte les joueurs (écran partagé compris) identiquement dans les deux modes ; `BIENVENUE` porte désormais `pause`, `reseau` et `partie`.
  - **Terminaison** (008) : `ARRET` (boucle locale) et les signaux sauvegardent de façon synchrone puis terminent (code 0) ; en fermé, le départ du dernier client (onglet fermé brutalement compris) sauvegarde tout de suite, met le monde en pause et termine 10 s plus tard sans reconnexion (`MC_GRACE_ARRET_MS` pour les tests) ; une actualisation de page reprend la partie ; en mode ouvert rien ne termine le processus. **Correctif au passage** : le serveur ne constatait jamais la fermeture propre d'un client (`http.Server` ouvre ses sockets en `allowHalfOpen`, la FIN ne déclenche pas `close`), masquée jusqu'ici par l'ETAT diffusé à 60 Hz — `end` ferme désormais la connexion.
  - **Pause** (009, 010, 011) : `PAUSE {actif}` / `PAUSE_ETAT {actif, rev}` ; la pause porte sur le POSTE (écran partagé compris) et gèle toute la boucle (heure, monde, créatures, cumulateurs, politique, économie, caravanes, catastrophes, fourneaux…) ; `ENTREE`/`BLOC`/`ATTAQUE`/`TIR` reçus en pause sont ignorés, `ping`, `CHAT`, `PAUSE`, `RESEAU`, `ARRET` continuent ; la reprise rebase l'horloge de boucle (aucun rattrapage) ; en mode ouvert `PAUSE` est ignorée (`PAUSE_ETAT {actif:false}`).
  - **Sauvegarde** (012) : immédiate à l'entrée en pause, au dernier client, à `ARRET` et à la fermeture du réseau ; cadence 45 s en fermé, 120 s en ouvert (`MC_SAUVEGARDE_MS` la règle) ; omise si rien n'a changé (empreinte de l'état hors heure du monde) ; la durée de jeu est consignée dans l'index des parties.
  - **Parties sur disque** (013, 014, 015) : dossier `parties/` (`--dossier-parties`) avec un index léger `index.json` et un fichier de monde `<id>.json` par partie ; API `/api/parties` (lister, créer, `charger`, `renommer`, `supprimer`, `importer`) réservée à la boucle locale et aux origines locales ; charger une autre partie sauvegarde la courante puis relance le même serveur sur la partie choisie (même port, même mode) ; `--partie <id>` la charge au lancement. Nouveau module pur `src/parties-fichier.js` (export `minicraft-parties.json`, relecture stricte partie par partie, conversion d'une sauvegarde solo en fichier de monde, tableau de parité champ par champ de `MC.Save.serialize`). Le fichier de monde porte désormais l'état de personnage de chaque joueur nommé (position, regard, vie, faim, air, case sélectionnée : base de SPEC-SYNC-020), les blocs de commande, et conserve tels quels les champs d'une partie solo importée que le serveur ne joue pas encore (cartes explorées, histoire, succès, véhicules…).
  - Tests : `tests/integration-archi-serveur.js`, `tests/integration-archi-sauvegarde.js`, `tests/integration-archi-parties.js` (vrais processus `server.js`, arrêtés en fin de test) et `tests/spec-parties-fichier.js` (Node pur).
- SPEC-ARCHI-009, 013, 015, 016, 017, 018 et lancement (lot A0, côté navigateur et distribution) :
  - **Le poste** (`src/poste.js`, `MC.Poste`, module pur testé avec des faux) : la liaison du navigateur avec le serveur local. Il détecte le serveur qui sert la page (`GET /api/parties`) et distingue « pas de serveur de jeu » (page ouverte en `file://`, serveur de fichiers quelconque) de « serveur injoignable » ; tient une liaison WebSocket « de statut » (sans REJOINDRE) qui porte `PAUSE`, `RESEAU` et `ARRET`, se rétablit après une coupure (serveur relancé) et rejoue l'état de pause voulu ; enveloppe l'API des parties (créer, charger, renommer, supprimer, importer) ; gère l'export/import des parties du navigateur.
  - **`index.html`** : écran d'attente visible dès le chargement (chargement, serveur de jeu, connexion) ; sans serveur de jeu, un écran explique comment lancer `node server.js` / `start.cmd` / `start.sh` et AUCUNE simulation ne démarre ; serveur bloqué → « Serveur injoignable » au bout de 15 s avec la cause et un bouton *Réessayer*.
  - **Menus** : les parties du menu viennent du serveur ; créer ou charger une partie la charge sur le serveur (qui se relance sur elle), puis le client s'y connecte comme à un serveur distant (écran d'attente à étapes jusqu'aux premiers chunks maillés) ; la pause du serveur suit `paused`/`menu` (jamais l'inventaire) ; le menu pause et le menu principal affichent l'état du réseau lu dans `ETAT_RESEAU` (fermé, ouvert, distant) et permettent d'ouvrir/fermer le réseau à chaud ; « Quitter le jeu » arrête le processus serveur ; « Importer un fichier… » et l'import automatique des parties trouvées dans ce navigateur (même origine). Le bouton « Exporter mes parties » (fichier `minicraft-parties.json`, lot A0-pré) existe aussi dans l'ancien menu sans serveur.
  - **Distribution** : `tools/paquet.js` livre un dossier `parties/` ; les lanceurs `start.cmd` / `start.sh` démarrent le mode local fermé par défaut ; le README est réécrit (« Lancer », « Limites connues ») — Node est requis pour jouer, même seul.
  - **Budgets** (`tests/budget-perf.json`, clés `sauvegarde`, `demarrage`, `latence`) et bancs `tests/bench-sauvegarde.js` (sérialisation d'une sauvegarde à 10⁴, 10⁵, 10⁶ blocs modifiés : ≈ 3, 36 et 300 ms), `tests/bench-demarrage.js` (serveur prêt en ≈ 1,3 s, budget 3 s) et `tests/bench-latence-locale.js` (`@lent` ; ping ≈ 0,1 ms, ENTREE→ETAT ≈ 11 ms en moyenne et 22 ms au p95 pour 1 et 4 joueurs locaux) ; version rapide dans `tests/integration-archi-budgets.js`.
  - **Aiguillage de `src/game.js`** (sans changement de comportement) : `frame()` est découpée en `frameJoueurs`, `frameEntites`, `frameTemps`, `frameMonde`, `frameConteneurs`, `frameFinDePartie`, `frameMondeInterface` et `frameReseau`, et `appliquerActionCommande` devient une table de gestionnaires (`actionCommande*`), pour que les lots B-* d'élimination des branches `net.enLigne()` n'éditent chacun que leur fonction.
  - Tests : `tests/spec-poste.js` (Node pur, dont la prédiction du mouvement appliquée dans la même image), `tests/integration-archi-client.js` (vrai navigateur sans fenêtre à 1280×800 face à un vrai serveur ; s'ignore sans navigateur installé), `tests/integration-archi-budgets.js` ; `tests/integration-paquet.js` complété (lanceurs, dossier des parties, README).
- SPEC-ARCHI-019 (lot A0, chantier « solo = serveur toujours présent », L50) : contrat figé `src/contrats-archi.js` (`MC.ContratsArchi`, module pur chargé avant `net-protocol`, fusionné dans `NP.MSG`) — messages `PAUSE`, `PAUSE_ETAT`, `RESEAU`, `RESEAU_ETAT`, `ARRET`, `DORMIR`, `HISTOIRE_ETAT`, `SUCCES_DEBLOQUE`, énumération `ETAT_RESEAU` (ferme, ouvert, distant), motifs de refus (`poste_deja_connecte`, `reseau_ferme`, `serveur_complet`), bornes, validateurs `valider*` (copie normalisée ou `null`) et aides pures (origines locales, adresse de boucle locale, ports candidats). Test Node `tests/spec-contrats-archi.js`.
- SPEC-PACK-004 : chaque publication (`node tools/version.js --publier`) construit AUSSI, sans étape manuelle, une archive .zip portable nommée par version (`dist/releases/minicraft-vX.Y.Z.zip`, jamais commitée — voir `.gitignore`), prête à tester ou à partager telle quelle. `tools/paquet.js` (`construireZip`, `construireZipRelease`, homegrown `tools/zip.js`, aucune dépendance npm) construit dans un dossier temporaire propre puis le retire ; jamais le dossier `sea/` (binaire node copié pour SEA, inachevé sans `postject`, inutile à partager). Un échec de construction du paquet n'invalide jamais la publication déjà commitée et étiquetée (best-effort, avertissement seulement). Test d'intégration `tests/integration-paquet.js` (nom exact du fichier, contenu attendu, absence de `sea/`, nettoyage du dossier temporaire).
- SPEC-DONJON-017 : un coffre de donjon pillé (DONJON-009) régénère son contenu après un long délai mesuré en jours simulés (déterministe par graine, distinct du délai de repeuplement POP-002) — `src/donjons.js` (`delaiRegenCoffre`, `coffreRegenere`), câblé dans la boucle périodique de `server.js` (`regenererCoffresDonjon`, réglable par `MC_DONJON_JOUR_S` pour les tests). Test Node pur `tests/spec-donjons.js`.
- SPEC-SERVEUR-005 : la purge de `admin.sessions`/`admin.invitations`/`admin.sanctions` (`MC.Admin.purger`, déjà testée seule) est désormais réellement appelée par `server.js`, dans sa boucle périodique (réglable par `MC_ADMIN_PURGE_S`/`MC_ADMIN_PURGE_SESSIONS_MAX`/etc. pour les tests). Test d'intégration `tests/integration-admin.js` sur un vrai serveur.
- SPEC-SERVEUR-009 : à la connexion (`BIENVENUE`), les overrides de blocs sont désormais bornés à un voisinage de chunks autour du joueur, plutôt qu'envoyés en un seul message non borné ; le reste est transmis chunk par chunk, à la demande du client (`OVERRIDES_DEMANDE`/`OVERRIDES_CHUNK`, `src/net-protocol.js`), câblé côté client dans `src/game.js` (`streamChunks`) et `src/net.js` (`demanderOverrides`/`onOverridesChunk`) ; **correctif** : une reconnexion au même monde vide désormais `overridesDemandes` pour forcer une redemande complète des chunks déjà chargés, sinon un bloc modifié par un autre joueur pendant la déconnexion n'était plus jamais reçu. Tests d'intégration `tests/integration-admin.js` (taille bornée face à 4000 overrides épars) et `tests/integration-net.js` (round-trip du chunk demandé, reconnexion).
- L48 (« rendu fiable et adaptatif ») — les trois fiches laissées ⏳ par le sous-lot A4 sont maintenant câblées dans le chemin de rendu réel :
  - SPEC-RENDU-006 (antialias piloté par le FPS) : le contexte WebGL se crée désormais sans MSAA (`src/render.js`, `antialias: false`, le forçage à `true` d'origine ne pouvait pas se basculer sans recréer `renderer.domElement`, hors périmètre) ; le lissage vient d'une passe de post-traitement FXAA légère (`passeAntialias`/`rendreAvecAntialias`), activée/coupée réellement par `render.setAntialias(bool)` sans jamais reconstruire le renderer — `src/game.js` transmet la décision déjà calculée par `MC.Qualite.evaluer` (`decisions.antialias`), même câblage que la réfraction/le DPR déjà en place. **Correctif au passage** : `renderer.info.autoReset` est désactivé et remis à zéro une fois par image complète (`renderViews`/`render`), sinon la passe FXAA (deux `renderer.render()` par image) aurait faussé `renderer.info.render.calls` pour le panneau F3 et l'adaptatif (SPEC-PERF-015/SPEC-RENDU-015) — la dernière passe (le carré plein écran, 1 appel) aurait écrasé le vrai total de l'image.
  - SPEC-RENDU-009 (mobs fusionnés/instanciés par espèce) : au lieu de refactorer `mobMesh` (10-14 `THREE.Mesh` par mob, formes trop diverses pour ce sous-lot, voir la note laissée dans SPECS.md), les mobs d'une même espèce basculent, une fois 5 individus ou plus visibles à la fois (`UMBRAL_INSTANCE_MOB`), en un seul `THREE.InstancedMesh` par espèce (silhouette pleine, mêmes proportions que le LOD « simple » déjà utilisé au loin, SPEC-MOB-010) — `garantirInstanceMob`/`eligibleInstanciationMob` dans `syncEntities` (`src/render.js`). Compromis assumé et documenté en code : un mob instancié perd son articulation, son clignotement de blessure et sa teinte de variante individuelle ; les formes à parties transparentes/émissives (gelées, méduses) et les véhicules restent toujours en maillage complet. Mesuré en e2e réel : passe de ~10-14 appels de dessin par mob à une poignée pour l'espèce entière, quel que soit le nombre d'individus.
  - SPEC-RENDU-014 (culling grossier d'occlusion) : une colonne de chunks entièrement masquée par le relief proche (ex. une pente raide face à la caméra) est retirée du rendu (`.visible = false`) en plus du frustum culling (SPEC-RENDU-013) — `MC.Lointain.occlusionColonne` (`src/lointain.js`, logique pure, test d'horizon par carte de hauteurs) et `cullerOcclusionChunks` (`src/render.js`), appelé à chaque image dans `rendreVue`, réutilisent la grille de relief lointain déjà bâtie pour le terrain au-delà des chunks (`grilleLointaine`) plutôt qu'une donnée dédiée — pas d'orchestration de chunks touchée. Volontairement borné à la vue caméra unique (jamais en écran partagé, où un chunk masqué pour un joueur peut rester nécessaire à l'autre).
  - `tests/spec-rendu.js` : 5 tests Node de `MC.Lointain.occlusionColonne` (mur plein, terrain plat, colonne trop proche, plusieurs colonnes alignées, hauteur inconnue). `tests/e2e.js` : 3 tests navigateur en conditions réelles — bascule effective de la passe FXAA (appels de dessin mesurés avant/après), fusion réelle de 20 moutons en un seul `InstancedMesh` (`renderer.info.render.calls`), et masquage réel de chunks derrière une pente du terrain généré (graine fixe de test, recherche d'une occlusion réelle comme les autres tests de géographie de cette suite).
- L46 (« Factions, quêtes, PvP et environnement interconnectés ») — systèmes émergents reliant météo, volcanisme, factions politiques, donjons et lieux habités, sans dupliquer leur logique :
  - `src/habitats.js` : SPEC-ENV-001 (`endommagerLieu` — tornade/cyclone endommage 5 à 20 % des bâtiments d'un lieu, strictement localisés au tracé, journalisés ; **correctif revue adversariale** : plus de plancher à 1 bloc qui dépassait largement 20 % sur un petit lieu — `Math.floor`, jamais de dégât plutôt qu'un dégât hors bornes), SPEC-ENV-004 (`migrerPopulation` — 10 à 30 % des habitants migrent vers un lieu voisin, proportionnellement à la gravité ; **même correctif revue adversariale** que `endommagerLieu` : plus de plancher à 1 migrant forcé — une habitation isolée d'un ou deux habitants (`LIEUX.maison`, `lots: 1`) ne perd donc plus 33 à 100 % de sa population, `Math.floor` sans minimum) et SPEC-QUETE-003 (`queteCatastrophe`/`queteActive` — quête de reconstruction/secours limitée dans le temps, récompense proportionnée aux dégâts).
  - `src/routes.js` : SPEC-ENV-002 (`routePraticable`/`trajetsAffectesParEruption` — une éruption active rend une route impraticable ; les caravanes sont redirigées vers une alternative ou stoppées) — **câblée réellement** dans `src/game.js:convois` (les convois affichés en jeu, solo comme en ligne, consultent désormais les vraies éruptions proches).
  - `src/politique.js` : SPEC-FACTION-014 (`influenceZone`/`factionCouvrant`), SPEC-FACTION-015 (`commerceFermeAvec`/`offresAutorisees`, extension de FACTION-003), SPEC-QUETE-004 (`accepterQuete`/`remettreQuete`/`quetesActivesDeJoueur`) et SPEC-QUETE-005 (`recompenseReelle`) ; `appliquerGainAvantPoste` extrait de `appliquerAction` pour SPEC-DONJON-018.
  - `src/donjons.js` : SPEC-DONJON-018 (`factionDuTerritoire`/`victoireGardien`, recalculés dynamiquement — jamais figés à la génération du donjon).
  - `src/world.js`/`src/zones.js` : **câblage réel** de SPEC-FACTION-014 — `world.js` expose `definirFactionsPolitiques`/`politiqueFactions`, consulté par `zoneEn`/`reglesZoneEn` à CHAQUE appel (donc par `entities.js` pour apparitionHostile/degatsMob et par le PvP) ; `zones.js:zoneEn`/`reglesEn`/`pvpAutorise` acceptent un état politique optionnel, une redéfinition d'administrateur restant toujours prioritaire.
  - `server.js` : branche `monde.definirFactionsPolitiques(politique)` au démarrage ; tableau de quêtes actives par joueur (`quetesJoueurs`), persisté, arbitré via `/quete lister|accepter|remettre` — **correctif revue adversariale** : la remise vérifie RÉELLEMENT l'objectif avant d'accepter (livraison consommée dans l'inventaire réel + `MC.Politique.livrerQuete`, élimination revalidée par `reussirQueteElimination`, reconstruction par la position du joueur), refuse toute remise prématurée, et crédite RÉELLEMENT la récompense (émeraudes) dans l'inventaire serveur — jamais seulement annoncée en chat ; embargo commercial FACTION-015 branché dans le vrai `case NP.MSG.TROC` (`MC.Politique.factionCouvrant`/`commerceFermeAvec` combinés à `MC.PvpEnjeux.embargo`) ; `avancerCatastrophes` (nouvelle fonction de la boucle de jeu, comme `avancerPolitique`/`avancerEconomie`) détecte les VRAIES tornades/cyclones (`monde.meteo`) et éruptions (`monde.bio`) proches des lieux habités réellement chargés, applique `endommagerLieu`/`migrerPopulation`/`queteCatastrophe` pour de vrai et diffuse une annonce ; l'événement RÉEL `boss_vaincu` (`entites.evenements()`) marque le donjon vaincu (pré-existant : jamais fait par le serveur avant ce correctif) et appelle `MC.Donjons.victoireGardien`.
  - `tests/spec-environnement.js` (nouveau) : SPEC-ENV-001/002/004 et SPEC-QUETE-003, y compris un lieu synthétique minuscule qui prouve l'absence de dépassement de bornes. `tests/spec-politique.js`/`tests/spec-zones.js` : logique pure ET câblage réel (world.js, MC.Economie.executerTroc, un vrai événement `boss_vaincu` d'entites.js). `tests/integration-quetes.js` (nouveau, étendu) : la part réseau de SPEC-QUETE-004/005 sur vraies sockets — remise prématurée refusée, récompense réellement créditée (inventaire mesuré avant/après), ET une vraie catastrophe météo déclenchée par la boucle serveur (`MC_TEST_CATASTROPHE`, même principe que `MC_TEST_INV`/`MC_TEST_QUETE` déjà en usage) qui endommage un lieu et propose réellement une quête.
  - SPEC-ENV-005 (renforts de gardien pendant une éruption) reste ⏳ : son mécanisme d'invocation vit dans `src/entities.js`, hors des zones autorisées pour ce lot — voir le rapport de l'agent.
- L45, transport — risque d'attaque de caravane (SPEC-TRANSPORT-003), et câblage réel de SPEC-ECO-004 :
  - `src/caravanes.js` : SPEC-TRANSPORT-003 (`risqueAttaque`/`subitAttaque`/`aGarde` — probabilité d'attaque déterministe par (trajet, départ), nettement plus élevée en territoire dangereux, réduite par un garde réellement présent dans `composition()` ; `arriveesJusqua`, utilisée par le câblage serveur ci-dessous).
  - `src/economie.js` : `passageCaravane` (SPEC-ECO-004) applique désormais réellement le risque SPEC-TRANSPORT-003 — une cargaison attaquée arrive rognée, jamais l'origine/la destination sans lien avec ce qui a été transporté.
  - `server.js` : **câblage réel** — `avancerCaravanes` (nouvelle fonction de la boucle de jeu, comme `avancerPolitique`/`avancerEconomie`/`avancerCatastrophes`) déclenche pour de vrai `MC.Economie.passageCaravane` à l'arrivée de chaque caravane sur une route de commerce/axe partant d'une ville connue d'un joueur proche — **ceci met enfin en jeu SPEC-ECO-004**, fusionnée avec L45 mais jamais déclenchée jusqu'ici (`game.js:convois` n'en affichait que le rendu visuel) ; le danger du tronçon réutilise `monde.zoneEn` (qui incorpore déjà l'influence d'un territoire en guerre, SPEC-FACTION-014), une attaque relevée est annoncée dans le chat.
  - `tests/spec-transport.js` (nouveau) : SPEC-TRANSPORT-003, taux d'attaque mesuré sur 3000 départs simulés, intégration réelle par `passageCaravane` (jamais un appel isolé à `subitAttaque` en dehors du calcul du taux).
- L45, transport — collision/réparation de véhicule, fret réel en soute, péage de faction (SPEC-TRANSPORT-002/004/005) :
  - `src/vehicules.js` : SPEC-TRANSPORT-002 (`subirCollision`/`coutReparation`/`reparer`, `vmaxDans(d, milieu, e)` — un choc franc contre le décor, détecté dans le VRAI chemin de conduite (`conduire()`, le même que tous les tests de véhicule), avarie le véhicule et lui coûte 30 % de sa vitesse maximale jusqu'à réparation au forgeron ; la gravité du choc borne un coût de 5/10/20 émeraudes) ; SPEC-TRANSPORT-004 : le bateau reçoit lui aussi une soute (9 cases, la fiche le liste comme véhicule de fret) ; `pillerSoute` applique à un inventaire réel de soute la même fraction de perte qu'une attaque de caravane (SPEC-TRANSPORT-003).
  - `src/habitats.js` : le service `reparer` (déjà utilisé par le forgeron pour l'outil en main) répare aussi le véhicule du joueur s'il en conduit un avarié — même point d'entrée, même coût réel prélevé.
  - `src/game.js` : ajout minimal (un champ de contexte) pour que le service de réparation voie le véhicule éventuellement monté — aucune autre touche.
  - `src/politique.js` : SPEC-TRANSPORT-005 (`peageSegment`/`peageDe`/`appliquerPeage` — péage borné 1 à 5 émeraudes sur une route de commerce en territoire de faction, nul hors territoire ou en guerre active, où SPEC-TRANSPORT-003 prévaut).
  - Limite connue, documentée plutôt que masquée : les véhicules restent une fonctionnalité solo (`game.js:interagirVehicule` refuse de monter en ligne) et les factions politiques une simulation serveur-only (`world.js` : « un client solo/multijoueur n'en a jamais ») — ces deux systèmes ne se recoupent donc jamais en jeu aujourd'hui. SPEC-TRANSPORT-005 (péage) est donc vérifiée par des scénarios réalistes appelant les VRAIES fonctions d'intégration (`peageSegment`, `appliquerPeage`), prêtes pour le jour où l'une des deux restrictions tombe — sans appel de test isolé qui les court-circuite.
  - `tests/spec-vehicules.js` : SPEC-TRANSPORT-002, via le vrai chemin de conduite puis le vrai service `MC.Habitats.servir('reparer', …)`. `tests/spec-transport.js` : SPEC-TRANSPORT-004 (chargement/trajet conduit/déchargement/sauvegarde d'une vraie soute de camion et de bateau) et SPEC-TRANSPORT-005 (péage borné, exclusion en guerre, versement réel aux ressources de la faction).
- `PLAN.md` : le lot L47 (performance de génération et de maillage) passe de « à faire » à « fait » — vérifié qu'aucune fiche SPEC-PERF n'est encore ⏳.
- `PLAN.md` : les lots L14 à L22 (correctifs lumière/ombres/population, eau, vent, relief, peuplement et routes, identités procédurales, rendu lointain, archétypes d'histoire, couverture de test) passent de « à faire » à « fait » — vérifié que chaque fiche SPEC citée est bien ✅ et que le code/les tests correspondants existent réellement (pas seulement une lecture des ✅ déclaratifs).
- `tests/spec-pvp.js` : test direct de `MC.PvpEnjeux.factionsProches` (SPEC-PVP-006), jusque-là exercée seulement indirectement via `embargo` — porte G6 (surface publique testée).
- Catalogue de tests : `pvp-enjeux` (src) et `spec-pvp` (tests) rejoignent la liste officielle de `tests/run.js`/`tests/gates.js` (couverts par G1/G2 depuis leur fusion, mais pas encore exécutés par ces commandes) ; `tests/index.html` resynchronisé avec `tests/run.js` (spec-conteneurs, spec-crochets, spec-maillage, spec-pvp, pvp-enjeux, manquants depuis leurs lots respectifs).

- Lot BANC, étapes 0a/0b (docs/banc/historique-global.md, SPEC-BANC-059 à 066,
  083, 089) : format de données complet et catalogue étendu, préalables au
  reste du lot Historique global.
  - **Raison obligatoire** (SPEC-BANC-089) : `tools/registre.js` reclasse en
    échec tout test `ignore` sans `raison` (ou `message`) non vide ; la raison
    d'un avertissement de lenteur est désormais automatique (« lent : X s >
    seuil Y s »), sinon reprise du message du test.
  - **Moteur de rendu et témoin** (SPEC-BANC-085/086) : le run enregistre
    `GL_RENDERER`/`GL_VENDOR`, l'accélération matérielle, le navigateur, l'OS
    et la présence d'une fenêtre (`tools/e2e-headless.js`) ; `tools/registre.js`
    ne propose plus un témoin d'un moteur différent (message explicite sinon).
  - **Étapes et triplets d'images** (SPEC-BANC-077 à 083) : nouvelle API e2e
    `T.etape('nom')` (`tests/e2e.js`) — ouvre une étape et ferme la précédente
    (étape implicite `test` sinon) — avec triplet de 3 images réellement
    consécutives au début et à la fin de chaque étape (pose caméra/joueur,
    numéro et durée d'image, score d'instabilité pixels/pose). Le registre ne
    garde que l'image centrale (et tous les nombres) sauf étiquette `rendu` ou
    instabilité au-dessus du seuil documenté (`SEUIL_INSTABILITE_PIXELS_DEFAUT`).
    `tools/e2e-headless.js` pilote désormais le test instrumenté
    (`runUnE2EParNom`) au lieu du chemin non instrumenté, gagnant étapes,
    triplets et métriques par étape dans la campagne sans fenêtre.
  - **Fiche avant résultat** (SPEC-BANC-059) : `tests/rapport.js` (donc
    `tools/cahier.js` et ses exports html/pdf/docx, qui partagent le même
    modèle) affiche désormais l'identité (id, catégorie, domaines, specs,
    fonctions, étiquettes) avant la fiche, elle-même avant le résultat.
  - **Fonctions déclarées et observées** (SPEC-BANC-062, 066) : champ
    `fonctions` déclarable dans une fiche de test ou de groupe (Node et e2e,
    y compris `domaines` en repli honnête pour un test sans fonction
    observable). Sous Node, `tests/run.js` enveloppe les fonctions exportées
    des modules `MC.*` (un et deux niveaux) pendant chaque test, comptant les
    appels réels ; désactivable par `--sans-fonctions`, avec le surcoût mesuré
    et affiché à chaque campagne. G12 (bancs séparés) n'est jamais concerné.
    Un test dont le budget se mesure en millisecondes (étiquette
    `budget-perf`) échappe à la fenêtre d'observation, pour ne jamais fausser
    son propre seuil. G14 étend sa vérification : 100 % des tests ont
    désormais aussi un domaine ou une fonction (déclarée ou observée).

- Sécurité serveur (SPEC-SECU-010/011, SPEC-SERVEUR-007) : les réponses de
  fichiers statiques (`servir()`) portent désormais `X-Content-Type-Options:
  nosniff` et une `Content-Security-Policy` minimale (calcul pur,
  `NP.entetesSecuriteStatiques()`, src/net-protocol.js) compatible avec
  three.js chargé depuis cdnjs.cloudflare.com et avec le bootstrap inline du
  jeu comme du banc de test (`tests/index.html`, `document.write` compris) ;
  jamais de `X-Powered-By`. La poignée de main WebSocket vérifie désormais
  l'en-tête `Origin` contre une liste blanche configurable par
  `--origines a,b,...` (décision pure `NP.origineAutorisee`) — sans ce
  paramètre (défaut), aucune restriction n'est appliquée, choix explicite et
  documenté qui laisse le jeu servi par ce même serveur fonctionner comme
  avant. Le plafond de `ETAT.mobs` (80) est désormais un invariant nommé et
  testé (`NP.MAX_MOBS_DIFFUSES`, `NP.selectionnerMobsProches`, fonction pure)
  au lieu d'un littéral inline, et la cadence de diffusion de l'état
  (`etatHz`) s'adapte maintenant à la charge — nombre de clients connectés et
  file d'envoi TCP la plus encombrée (`NP.calculerEtatHz`) — plutôt que de
  rester fixe, recalculée à chaque tic.
- Vague 2 (B1, SPEC-SYNC-007/010/011, docs/vague-2/B1.md § 6, fin) :
  `ui.js` route désormais l'inventaire, l'équipement et la grille de
  fabrication du joueur (établi compris — `player.js` gagne `pl.grille`,
  toujours présente, jamais persistée) à travers `game.operer` : `clickSlotRef`
  et `equipClick` ne mutent plus jamais un objet réellement « tenu en main » —
  `heldStack` ne porte qu'une référence à l'emplacement d'origine et un
  nombre soustrait visuellement (`pileEmplacement`) ; poser/fusionner/
  échanger devient une opération `transfert` (ou `equip` dès qu'un
  emplacement d'équipement participe), envoyée à `MC.Conteneurs.appliquer`
  hors ligne comme en ligne (avec `seq` de prédiction). Un clic sur le
  résultat de craft envoie désormais `{k:'craft',fois}` et rentre TOUJOURS
  directement dans l'inventaire (jamais en main, hors ligne compris — la clic
  droit fabrique le maximum possible). Fermer l'écran envoie `CONTENEUR_FERMER
  {cle:'grille'}` (`rendreGrille`) plutôt que de rendre le contenu à la main
  soi-même. `poserRecette` (livre) devient une suite de `transfert` inv →
  grille (`Livre.disposition`, nouveau, calcule la disposition sans prélever).
  Les conteneurs pas encore networkés (coffre, fourneau, distributeur,
  échange — étape 7/8) gardent l'ancien modèle (`clickSlotLegacy`), les deux
  ne pouvant pas se mélanger sans risque de duplication. `server.js` route
  `CONTENEUR_FERMER {cle:'grille'}` vers `rendreGrille`. `tests/e2e.js` mis à
  jour pour le nouveau modèle (pickup visuel avant tout transfert réel, craft
  direct-inventaire).
- Vague 2 (B1, SPEC-SYNC-017, B1.md § 9 étape 9) : `DISTRIB` (`server.js`)
  n'écrase plus aveuglément le contenu déclaré par le client — c'est
  désormais une déclaration passée à `MC.Conteneurs.declarer` contre
  l'inventaire serveur réel du joueur, tronquée à ce qu'il possède, somme
  conservée par objet ; une redéclaration identique ne débite rien de plus.
- Vague 2 (B1, SPEC-SYNC-020/021 partielles, B1.md § 8-9) : le registre des
  joueurs nommés (`joueursRegistre`) et les banques (`banques`) survivent
  désormais à un arrêt puis relance du serveur avec `--monde`
  (`etatMonde`/`appliquerEtatMonde`, champ `joueurs`) — y compris un joueur
  ENCORE connecté à l'instant de la sauvegarde périodique
  (`snapshotRegistreJoueurs`), pas seulement celui déjà écrit par `fermer()`.
  `save.js` (solo, v3 inchangée) persiste maintenant `player.equip`, absent
  d'une ancienne sauvegarde → équipement vide comme avant cette section. Le
  registre des conteneurs POSÉS (coffres, fourneaux…) reste hors périmètre
  (étape 7, pas encore commencée).
- Vague 2 (B1, SPEC-SYNC-007/008 — client, docs/vague-2/B1.md § 6 suite) :
  `game.js` gagne `j.predInv` (une prédiction `MC.Conteneurs.creerPrediction()`
  par joueur local, activée par `rejoindreServeur`), `operer(j, op, msgBase)`
  (applique une opération sur l'état réel puis, en ligne, prévient le serveur
  avec un `seq`) et le hook réseau `onInvMaj` (`net.js` relaie désormais
  `INV_MAJ`) qui réconcilie l'inventaire/l'équipement confirmés par le
  serveur — toujours en place (`inv.load`), jamais par un nouvel objet
  (piège documenté B1.md § 12) — et rejoue les opérations encore en attente.
  Le journal de `player.js` (déjà écrit, jusqu'ici jamais activé) est
  maintenant vidé en fin d'image dans un ou plusieurs `INV_CONSOMMER`
  (`purgerJournalInv`, ≤ 16 opérations chacun). La touche « lâcher » passe
  par `INV_LACHER` en ligne (jamais `entities.dropItem` local, qui aurait
  doublé l'objet avec celui du serveur). `doSave` refuse désormais d'écrire
  en ligne (le serveur fait autorité) et l'inventaire/équipement solo
  d'avant connexion est sérialisé puis restauré tel quel à la déconnexion,
  volontaire ou non. `tests/e2e.js` couvre ce câblage (predInv/journal actifs
  en ligne, `doSave` neutralisée, inventaire solo intact après déconnexion).
  Reste à faire : `CRAFT`/`EQUIP`/`MANGER` ne passent pas encore par
  `operer` (ui.js garde son modèle d'objet réellement tenu en main), le
  registre des conteneurs posés côté serveur (étape 7) et leur UI (étape 8).
- Registre officiel de tests, VERSIONNÉ dans git (`tests/registre/`, distinct
  des cahiers locaux gitignorés de `tests/resultats/`) : `tools/registre.js`
  retient, par commit, les résultats et captures des tests jugés dignes de
  faire foi pour l'historique visuel (SPEC-BANC-028 à 031). Une campagne de
  validation avant push (préréglages `pr`/`e2e-fumee`, `tools/hooks/pre-push.js`)
  y inscrit automatiquement son cahier (`statut: 'en_attente'`, intégré au
  commit SUIVANT par `tools/hooks/pre-commit.js`, qui ne peut pas encore
  l'être dans le commit qu'il vient de tester). Vue « historique du test »
  (`historiqueTest()`/`exporterHistoriqueHTML()`) : agrège résultats et
  captures d'un même test à travers le registre, triée par ordre de commit
  git réel (`git rev-list --topo-order`) ou par ordre de lancement local,
  export HTML autonome. Témoin épinglable par commit + hash de capture
  (`temoin`), à défaut la dernière capture officiellement validée. Stockage
  des captures adressé par contenu (`images/<sha1>.<ext>`) : aucune capture
  identique n'est recopiée. CLI : `node tools/registre.js inscrire|commit|historique|temoin`.
- Registre officiel : révision du format suite relecture (SPEC-BANC-032).
  Stockage éclaté en UN FICHIER JSONL PAR INSCRIPTION (`tests/registre/entrees/*.jsonl`,
  1re ligne = méta du run, une ligne par test) au lieu d'un `entrees.json`
  unique — deux inscriptions concurrentes (branches, agents) ne se gênent
  plus jamais en conflit de fusion. Schéma enrichi pour l'historique global
  à venir (`docs/banc/historique-global.md`) sans migration future : chaque
  run porte `id`, `inscrit`, `motif` (facultatif), `arbre_modifie` (capturé
  au DÉBUT de la campagne locale) et `interrompu` ; chaque test porte une
  IDENTITÉ instantanée du catalogue (`categorie: {type, groupe}`, `domaines`,
  `specs`, `etiquettes`, `fonctions` — vide pour l'instant, observation
  automatique en lot séparé) et `erreur` (renommé depuis `message`) ;
  chaque capture porte un `role` (`debut`/`intermediaire`/`fin`, affecté une
  fois le test terminé) et un `t_ms` (`tests/e2e.js`, `tools/e2e-headless.js`) —
  la capture manuelle nommée en cours de test (`capture('libellé')`) était
  déjà supportée. `inscrire()` devient idempotente (refuse un cahier déjà
  inscrit) et accepte désormais un `motif` ; nouvelle fonction
  `runsUnifies()` fusionnant registre et cahiers locaux sous UNE SEULE
  forme (`inscrit` les distingue), point d'accroche documenté pour le futur
  lot d'interface (routes serveur, tableau, graphiques, diaporamas —
  `tests/registre/README.md`). Rebasé sur le commit qui a corrigé le damier
  de tuiles (rendu) ; le registre versionné repart VIDE (l'entrée de test
  écrite lors du développement, qui citait un commit réécrit par un rebase
  antérieur, a été retirée).
- Vague 2 (B1, SPEC-SYNC-007 à 017) : raccordement de `MC.ContratsV2` à
  `NP.valider` — les nouveaux types de message (`CRAFT`, `EQUIP`,
  `CONTENEUR_*`, `INV_*`, `TROC`, `PVP`) sont désormais reconnus par le
  protocole réseau, et `MANGER` passe par `ContratsV2.validerManger`
  (compatible avec la forme historique).
- Vague 2 (B1, SPEC-SYNC-007 à 017 partielles) : module pur `src/conteneurs.js`
  (`MC.Conteneurs`) — inventaire, équipement, grille de fabrication et
  conteneurs (transfert, craft, equip, consommer, manger, lâcher, créatif,
  rendre la grille, déclarer un distributeur), fourneau (`tickFour`),
  prédiction (`creerPrediction`) et enregistrement joueur persistable
  (`versEnregistrement`/`depuisEnregistrement`) ; même code pour le solo, la
  prédiction client et le serveur (raccordement réseau et serveur à venir).
- Route `GET /tests/version` (`server.js`) : renvoie `{ commit, versionJeu }`,
  utilisée par le banc pour renseigner `campagne.environnement.commit` dans
  les cahiers de test envoyés (`tests/banc-ui.js`, `envoyerCahier()`).
- Les 55 tests end-to-end restants (`tests/e2e.js`) portent désormais leur
  propre fiche (`teste`/`pourquoi`/`attendu`) en 2e argument de `e2e()`,
  sans changement de nom ni de logique — 100 % du catalogue e2e (136 tests)
  est maintenant couvert (SPEC-BANC-002).
- Vague 2 (B1, SPEC-SYNC-007 à 011, 014 — partie serveur) : `server.js` route
  désormais `CRAFT`, `EQUIP`/`EQUIP_VU`, `MANGER` (validé contre l'inventaire
  réel), `CONTENEUR_TRANSFERT` (inv ↔ grille), `INV_CONSOMMER`, `INV_LACHER`
  et `INV_CREATIF` vers `MC.Conteneurs.appliquer`, avec les helpers figés de
  l'API inter-lots (`seqNouveau`, `envoyerInvMaj`, `refuserOp`,
  `lacherAuxPieds`, `etatJoueurServeur`, `banques`) ; le ramassage (`ev.picked`)
  range désormais réellement l'objet dans l'inventaire serveur (`DONNE` ne
  sert plus qu'au retour sonore/visuel) ; registre en mémoire des joueurs
  nommés (inventaire, équipement, banque restaurés à la reconnexion sous le
  même nom, `MC_TEST_INV` pour les tests) ; budgets anti-flood des nouveaux
  messages c→s. `tests/integration-inventaire.js` (nouveau, 29 tests) prouve
  ce comportement sur un vrai serveur. Le registre des conteneurs posés
  (coffres, fourneaux…) et la persistance disque (`--monde`) restent à venir.
- Vague 2 (B1, SPEC-SYNC-007 — amorce étape 6, client) : `src/player.js`
  gagne trois fonctions de journal (`consommerCase`, `userCase`,
  `transformerCase`) qui mutent l'inventaire EXACTEMENT comme avant, et, si
  `pl.journalInv` est un tableau (fourni par `game.js` une fois en ligne — à
  venir), y poussent l'opération déclarée (`{ i, id, n|usure|vers }`) au
  moment même de la consommation. Tous les points d'appel qui diminuaient
  directement l'inventaire (pose de bloc, porte, trappe, mobilier, dalle,
  engrais, houe+graines, minage, coup porté, tir, seau) passent désormais par
  ces fonctions ; le repas (`useOn` → `'eat'`) ne journalise pas, comme prévu
  (c'est le message `MANGER` qui porte l'information). Solo inchangé (aucun
  journal sans `journalInv`). Le raccordement réseau (`game.js` `operer`,
  `onInvMaj`, prédiction/réconciliation, UI) reste à faire (docs/vague-2/B1.md
  § 9, étape 6, suite).
- Génération et maillage de chunks en Web Workers (L47, SPEC-PERF-004 à
  010, 014) : un ordonnateur pur (`src/file-chunks.js`) priorise par
  distance, borne les intégrations par image et rejette les résultats
  périmés (époque de monde ou version de chunk) ; un module de tâches
  partagé (`src/taches-chunks.js`) exécute la génération brute et le
  maillage (greedy meshing compris) à l'IDENTIQUE dans un Worker ou sur le
  thread principal (repli synchrone sans Worker, SPEC-PERF-006 — `file://`,
  CSP, ou erreurs répétées) ; les résultats sont transférés sans copie
  (tableaux typés, SPEC-PERF-008) et les géométries de chunk sont réécrites
  en place plutôt que recréées à chaque remaillage tant que leur capacité
  suffit (SPEC-PERF-014, `render.appliquerMaillage`). Un seul worker de
  génération par défaut (ses propres caches de bruit), jusqu'à 4 workers de
  maillage. `world.genererBrut`/`world.integrerChunk` et
  `MC.Lumiere.depuisTableaux` complètent l'API pour permettre à un chunk
  brut, reçu sans overrides ni lumières, d'être intégré exactement comme un
  chunk généré en place.
- Coquilles de Worker (`src/worker-monde.js`, `src/worker-maillage.js`) et
  pool navigateur (`src/workers.js`, détection de disponibilité + repli) ;
  câblage dans `src/game.js` (streaming des chunks distribué au pool quand
  il existe, repli synchrone complet sinon — le chemin `onBloc` reste
  synchrone en toute circonstance).
- Économie et métiers (L45, SPEC-ECO-001 à 007, SPEC-METIER-001 à 005) :
  `src/economie.js` (`MC.Economie`) — prix dynamiques par lieu et par biome
  bornés à ±60 % autour de la référence, trésors de lieux qui reviennent vers
  une cible (masse monétaire bornée), commerce arbitré en deux phases
  (validation puis mutation atomique, `executerTroc`), frais de garde
  quotidiens de la banque, cours régional, transfert de surplus par
  caravane ; `src/metiers.js` (`MC.Metiers`) — offres bonus au-delà de 15
  échanges avec un PNJ, minerai requis pour les objets forgés, remise de 10 %
  au statut (20 ventes), sans aucun `Math.random` (hachage déterministe comme
  `politique.js`). `src/caravanes.js` : `cargaisonDe`, la cargaison pure et
  déterministe d'un départ de caravane.
- Commerce (SPEC-SYNC-023, L45) : un PNJ de métier commerce désormais via
  `MC.Economie` (`game.js` `parlerA`, `ui.js` — prix/stock affichés, clic
  d'échange conforme au contrat), avec un frais de garde de banque quotidien
  (`game.js` `frame`) ; côté serveur, section « économie » (`server.js`,
  `avancerEconomie`, `offresPour`) et `case NP.MSG.TROC`, sur les helpers de
  B1 (inventaire et conteneurs serveur, L43, fusionné) — `seqNouveau`,
  `envoyerInvMaj`, `refuserOp`, `etatJoueurServeur`, la Map `banques` ;
  sauvegarde solo (`save.js`, champ `economie` optionnel) et serveur
  (`etatMonde`). `tests/integration-troc.js` (vrai serveur, `MC_TEST_INV`,
  `MC_TEST_ARRET_MS` pour un arrêt propre sous Windows où `kill()` n'y
  déclenche aucun signal POSIX) : consulter/échanger, portée, refus, prix et
  stock persistés après arrêt/relance `--monde`.
- Vague 2 (B1, étape 7, SPEC-SYNC-012/013/015/016, docs/vague-2/B1.md § 7) :
  registre serveur des conteneurs POSÉS (`conteneursPoses`, `server.js`) —
  coffre, armoire, étagère, bibliothèque, fourneau, distributeur (le
  distributeur quitte sa Map séparée et rejoint ce registre, ce qui le rend
  aussi persistant). `CONTENEUR_OUVRIR`/`CONTENEUR_FERMER` abonnent/désabonnent
  un joueur local (un seul conteneur ouvert à la fois, comme l'écran) ;
  `resoudreConteneur` REvérifie abonnement ET portée (6 blocs, `PORTEE_CONTENEUR`)
  à CHAQUE opération, pas seulement à l'ouverture — corrige le trou par
  lequel la banque (`ctxJoueur`) et un conteneur posé pouvaient rester
  accessibles à distance. La banque se rouvre via un bloc coffre-fort
  (position revérifiée) ou un banquier (`eid`, entité de rôle `banquier`,
  distance revérifiée). `CONTENEUR_TRANSFERT`/`declarer` diffusent un delta
  (`CONTENEUR_MAJ`) aux AUTRES abonnés, jamais à l'auteur (déjà servi par son
  propre `INV_MAJ.conteneurs`, SYNC-015). Un fourneau posé cuit à chaque tic
  qu'il ait ou non un abonné (SYNC-016) ; les messages de progression sont
  limités à 2 Hz et seulement émis s'il y a un abonné. Casser un conteneur
  posé (n'importe lequel, coffre-fort excepté puisqu'il n'a pas de contenu
  propre) lâche son contenu au sol une seule fois, même si plusieurs joueurs
  l'avaient ouvert : le retirer du registre avant toute autre opération fait
  échouer proprement (motif `ferme`) tout transfert ultérieur. Persisté dans
  `etatMonde`/`appliquerEtatMonde` (`conteneurs`, `MC.ContratsV2.validerConteneurPersiste`),
  donc retrouvé après un arrêt puis une relance `--monde` (SYNC-021, partie
  conteneurs).
- Vague 2 (B1, étape 8, docs/vague-2/B1.md § 6/8) : `ui.js`/`game.js` —
  coffre, armoire, étagère, bibliothèque, fourneau, distributeur et banque
  passent au modèle référencé EN LIGNE (`container.cont`, le miroir réseau
  posé par `game.js` à l'ouverture — `clickSlotRef`, `game.operer`), au lieu
  d'une copie locale (`chests[k]`/`furnaces[k]`/`distributeurs[k]`) que deux
  joueurs sur le même conteneur pouvaient chacun modifier sans jamais se
  synchroniser (risque de duplication documenté). `net.js` gagne
  `ouvrirConteneur`/`fermerConteneur` et les hooks `onConteneurEtat`/
  `onConteneurMaj` ; l'ouverture devient asynchrone (l'écran ne s'affiche
  qu'à la réponse du serveur). `clickSlotLegacy` (`ui.js`) est désormais
  STRICTEMENT réservé au solo (`container.cont` absent) ; les deux modèles ne
  coexistent jamais sur un même écran. Les fourneaux locaux (`furnaces[k]`)
  ne sont plus tic-tés côté client en ligne (double cuisson corrigée, piège
  documenté B1.md § 12) — c'est désormais le serveur seul qui fait autorité.
  Hors périmètre : l'échange avec un PNJ marchand ordinaire (`TROC`, pas un
  conteneur) reste tel quel.
- Vague 2 (B4, SPEC-PVP-001 à 006, docs/vague-2/B4.md) : `src/pvp-enjeux.js`
  (nouveau, `MC.PvpEnjeux`, module pur) — butin borné (10-25 % du nombre
  d'objets du vaincu, équipement exclu, transféré exactement au vainqueur,
  reliquat renvoyé pour tomber au sol), réputation politique dégradée de
  10 points par meurtre non consenti au-delà du 2ᵉ en moins de 10 min de jeu
  (fenêtre glissante) auprès des factions dont le territoire couvre le lieu,
  hors-la-loi (réputation ≤ -50) et embargo recalculé dynamiquement (jamais
  figé), duel consenti (proposition/acceptation/refus, caduque à 30 s, actif
  120 s dans un rayon de 32 blocs autour du point médian à l'acceptation),
  victoires comptées par joueur nommé, persistance (meurtres/victoires/
  réputations ; duels et propositions éphémères, jamais sérialisés).
- Vague 2 (B4, suite) : branchement réseau/serveur. `src/entities.js`
  (`stepArrow`) porte désormais l'auteur du coup (`degatsPar[].par`) et
  consulte `opts.peutBlesser(tireur, cible)` — une flèche entre deux membres
  d'une même faction (SPEC-FACTION-012) n'inflige plus de dégâts (bogue
  corrigé : seul le corps à corps était protégé), et un duel autorise un tir
  même hors zone PvP/sans `--pvp`, jugé à l'IMPACT (pas au tir : un duel qui
  expire pendant le vol d'un projectile protège la cible). `src/succes.js`
  gagne trois succès (`pvp_victoire`, seuils 1/5/25). `src/commandes.js`
  gagne `/duel`. `src/net.js`/`src/game.js` gagnent le hook `onPvp` (message
  `PVP`, toasts/chat, succès sur `victoire`). Zones B4 de `server.js` :
  `case ATTAQUE` (duel OU PvP+faction autorisés), interception `/duel` avant
  `/faction`, `ev.degatsPar` (issue PvP commune corps-à-corps/flèche,
  `regles.degatsMob` n'est plus appliqué à un coup de joueur — bogue
  documenté par le plan, corrigé au passage), embargo dans `case TROC`,
  persistance (`pvp:` dans `etatMonde`). `tests/integration-pvp.js` étendu
  (butin, flèche entre membres de faction, `/duel` de bout en bout, message
  `PVP` de victoire/défaite).
- SPEC-ENV-003 (`src/metiers.js`, `src/economie.js`) : l'offre du fermier
  (blé, seul métier agricole, METIER-001) ne se contente plus de geler en
  hiver (`tickJour`, mult de pousse nul, SAISON-006) — elle diminue à son
  tour, faute de récolte, jusqu'à épuisement, puis se restaure normalement
  dès le retour d'une pousse au printemps (branche déjà existante, inchangée
  pour toute ressource non agricole). Nouveau `Metiers.estRessourceAgricole`
  (pure, dérivée de `METIER_DE_RESSOURCE` sans le dupliquer) distingue cette
  seule ressource des autres stocks de lieu.
- Diplomatie joueurs ↔ PNJ (SPEC-FACTION-017) : `guildes.js:declarerRelation`
  accepte désormais un état politique (`MC.Politique`) optionnel en dernier
  argument ; quand `cibleId` ne désigne pas une autre faction de joueurs, la
  relation n'est acceptée que si cet identifiant correspond à une faction PNJ
  réellement connue de cet état (sinon `{ ok:false, motif:'cible_introuvable' }`,
  rien n'est enregistré), et la relation posée est répercutée côté PNJ, sur
  l'échelle guerre/rivalité/neutre/alliance de `politique.js` (alliée→alliance,
  ennemie→guerre), avec la même clé triée que `cleRelation` afin que
  `MC.Politique.relationEntre` la relise à l'identique. `appliquerAction`
  (commande `/faction relation`) transmet ce même état politique, désormais
  en 4e argument optionnel ; le câblage réel de l'état politique du monde à
  travers `server.js`/`game.js` reste à faire (fichiers hors périmètre de
  cette tâche).
- Factions politiques et quêtes (SPEC-FACTION-016, SPEC-QUETE-001/002,
  `src/politique.js`) : un raid ou un avant-poste (`tourUnJour`) prélève
  désormais un coût fixe (`or`/`nourriture`) sur son auteur qu'il réussisse
  ou non, l'avant-poste gagnant lui aussi un risque d'échec (jet déterministe
  par graine) qui ne coûte que les ressources, sans gain de territoire ;
  raid et quête d'élimination partagent le même effet de succès
  (`appliquerGainElimination`). `questesDe` ne propose plus une quête de
  livraison que si la ressource visée (`or`/`nourriture`) est réellement
  sous le seuil bas (`SEUIL_RESSOURCE_BAS`, 20), sa réussite (`livrerQuete`)
  relevant ce niveau du montant fourni, plafonné au manque réel ; une quête
  d'élimination n'apparaît qu'en relation `guerre` active, ciblant le membre
  désigné par `ciblePourRaid`, et sa réussite (`reussirQueteElimination`)
  applique exactement le gain d'un raid gagné avec la même graine.
- Transport (SPEC-TRANSPORT-001, L45) : chaque véhicule (`src/vehicules.js`)
  a désormais une jauge de carburant (`e.carburant`, capacité propre à
  chaque type dans `DEFS`), consommée proportionnellement à la distance
  parcourue par `conduire()`/`rouler()` ; à sec, les commandes du pilote
  sont ignorées et le véhicule freine/retombe exactement comme un véhicule
  abandonné (SPEC-VEHIC-009). Persistée par `serialiser()`/`restaurer()`
  (anciennes sauvegardes : plein par défaut). Partie pure seulement — jauge
  affichée au HUD et ravitaillement restent à faire côté `game.js`/`ui.js`.

- Lot BANC, étapes 1/2 (docs/banc/historique-global.md §2/§3.1, SPEC-BANC-033
  à 040) : tableau « Historique global » du banc de test.
  - `tools/historique.js` (nouveau, pur, testable sous Node sans serveur
    HTTP) : aplatit `tools/registre.js` `runsUnifies()` en lignes test×run
    (`construireLignes`), tri multi-clés (`trierLignes`), filtre par colonne
    selon son type — texte/énumération/liste/nombre/horodatage/commit
    (`filtrerLignes`), filtres rapides (`filtreRapide`), pagination serveur
    (`paginer`), effectifs par énumération (`effectifsEnum`/
    `effectifsToutesEnum`), agrégation pour les futurs graphiques
    (`serieAgregee`) et suite ordonnée des images d'un test
    (`imagesDeTest`). `creerIndex()` : index en mémoire reconstruit
    seulement quand `tests/registre/entrees/` ou `tests/resultats/` change
    (signature de mtime), jamais à chaque requête.
  - `server.js` : nouvelle section « historique global » — routes `GET
    /tests/historique/lignes` (tri, ordre, filtre JSON, page, taille ;
    renvoie aussi `total` et les effectifs par énumération), `GET
    /tests/historique/series` (agrégats bruts, l'affichage en graphiques
    est un lot ultérieur) et `GET /tests/historique/images`, toutes trois
    réservées à la machine locale ; `GET /tests/registre/images/<sha1>.<ext>`
    sert les images du registre (adressées par contenu) avec un cache long.
  - `tests/index.html`/`tests/historique.js`/`tests/historique.css`
    (nouveaux) : zone « Historique global » ouverte par un bouton dans
    l'en-tête du banc — tableau avec colonnes choisies dynamiquement
    (mémorisées dans `localStorage`, try/catch), tri par en-tête (clic =
    croissant/décroissant/aucun, Maj+clic = tri secondaire), filtre par
    colonne selon son type, filtres rapides (inscrits seulement/tous les
    runs/échecs/lents), pagination et export CSV/HTML de la vue filtrée
    courante — sans bibliothèque externe.
  - Tests : `tests/spec-historique.js` (18 tests Node purs, ajouté à la
    liste `TESTS` de `tests/run.js`) et un test e2e (`tests/e2e.js`,
    SPEC-BANC-033/035/036/037/038) qui ouvre la zone dans le vrai banc,
    trie une colonne, applique un filtre rapide et vérifie l'export CSV.
    Reste hors de ce lot (prochains lots,
    docs/banc/historique-global.md §5) : graphiques timeline (§3.2), panneau
    « test » avec diaporamas par image (§3.3, SPEC-BANC-039/046 et
    suivantes), intégration du clic depuis l'arbre de sélection.

### Modifié
- SPEC-ARCHI-025 (lot B-ENV) : `/jour` et `/nuit` ne s'appliquent plus localement : ils passent par le serveur et exigent le mode créatif ou un administrateur ; l'heure se règle dans le jour courant au lieu de repartir du jour 0.
- **Le mode par défaut de `server.js` est désormais FERMÉ au réseau** (boucle locale seulement, SPEC-ARCHI-001/002) ; `--ouvert` ouvre le réseau dès le lancement, `--serveur` (serveur dédié) reste ouvert. Les suites d'intégration qui lancent un serveur à plusieurs clients passent `--ouvert`. `--port 0` est désormais accepté (port éphémère).
- **Régressions transitoires du chantier « solo = serveur »** (résolues par les lots B-* et P-* avant toute publication, voir PLAN.md « Vague ARCHI ») : depuis `index.html`, une partie passe désormais par le serveur, qui ne simule pas encore tout ce que le solo simulait dans le navigateur — le mode histoire est refusé à la création (lot P-HIST), les succès, les véhicules et les bombes volcaniques ne fonctionnent pas dans ce parcours (lots P-SUCC, P-VEH, B-ENV). La page de test (`tests/index.html`) garde la simulation locale historique tant que les branches `net.enLigne()` de `src/game.js` ne sont pas toutes éliminées.

- Banc de test navigateur (`tests/banc-ui.js`, `tests/index.html`) : retrait
  de l'adaptateur de repli, consommation du vrai catalogue partagé
  (`tests/catalogue.js`, `tests/presets.js`) et exécution réelle des tests
  unitaires/e2e (`G.T.run`, `runCampagneE2E`) ; catalogue navigateur aligné
  sur `node tests/run.js` (`spec-perf.js`/`limites-sondes.js`/`spec-limites.js`
  chargés, auparavant absents de la page par oubli).
- `tests/run.js` (`e2eListeDepuisTexte`) lit désormais aussi la fiche
  déclarée en 2e argument des appels `e2e(nom, fiche, fn)`, par analyse
  textuelle en comptant les accolades puis `JSON.parse` (jamais `eval`,
  toujours sans exécuter `tests/e2e.js` sous Node).
- Porte **G14** (`tests/gates.js`) : couvre désormais tout le catalogue, y
  compris les tests end-to-end, la fiche de chacun étant lisible depuis
  `tests/e2e.js` (voir ci-dessus) ; l'exclusion temporaire des tests `e2e`
  est retirée (PLAN.md mis à jour).
- `tests/harness.js` : un test Node qui retourne une `Promise` échoue
  désormais explicitement (garde anti-faux-positif) plutôt que d'être compté
  vert sans que ses assertions asynchrones aient réellement été attendues.
- Crochets git (SPEC-BANC-010 révisée) : `tools/hooks/pre-commit.js` et
  `tools/hooks/pre-push.js` partagent désormais un seul filet anti-blocage de
  15 min (`--delai 900`, constante `DELAI_FILET_S` dans le nouveau
  `tools/hooks/delai-filet.js`) au lieu de fixer chacun le sien (240 s, puis
  600 s et 150 s) — un crochet qui finit par réussir n'est plus coupé plus tôt
  qu'un lancement manuel du même préréglage. Nouveau test
  `tests/spec-crochets.js` (ajouté à la liste `TESTS` de `tests/run.js`,
  hors `tests/spec-banc.js` qui n'en avait pas encore) qui vérifie qu'aucun
  crochet ne passe un délai différent de 900 — et affirme en plus,
  directement, que la constante partagée `DELAI_FILET_S` vaut 900 (relecture :
  le scan des littéraux dans le texte des crochets réussissait trivialement
  dès lors que ceux-ci passaient une référence symbolique plutôt qu'un
  littéral, sans plus jamais lire `tools/hooks/delai-filet.js`).

### Supprimé
- SPEC-ARCHI-023 (lot B-ENV) : les **bombes volcaniques** (projectiles de lave lancés pendant une éruption) et les **coulées de lave/basalte** posées sur les flancs des volcans sont SUPPRIMÉES — le serveur n'en a pas d'équivalent et le client ne modifie plus le monde de son côté. Les éruptions restent visibles (panache) et audibles (grondement, éruption) ; un éventuel portage serveur est un chantier ultérieur non planifié.

### Corrigé
- `tests/integration-archi-vehicules.js` : la destruction du bateau à mains nues frappe jusqu'à sa disparition (60 s au plus) au lieu de 12 coups : la cadence se mesure en temps de jeu du serveur, qui ralentit sous charge. `tests/run.js` garde désormais en tête du cahier les lignes « ✗ » d'un script d'intégration en échec (elles étaient coupées par la fin du journal).
- `tests/integration-archi-vehicules.js` : attentes par défaut portées de 4 s à 15 s (et de 3-5 s à 15-20 s après la relance du serveur) — reproduit sous charge CPU artificielle, les attentes courtes faisaient échouer à tour de rôle des assertions sans rapport (soute, conduite, refus de portée) ; la borne reste finie.
- Banc de test (`tests/run.js`) : un script `tests/integration-*.js` qui échoue est rejoué UNE fois (visible : « ↻ rejeu unique » puis « ⚠ instable : réussi au 2e essai », et la sortie du premier essai est gardée dans le cahier) — un bureau saturé ralentit l'horloge de jeu des serveurs de test et faisait échouer, à chaque campagne, un script différent qui passait seul ; une vraie régression échoue deux fois. `MC_SANS_REJEU_INTEGRATION=1` désactive le rejeu.
- Triage du run complet des e2e navigateur après le chantier « solo = serveur toujours présent » (5 échecs sur 150) : trois étaient des régressions du chantier, un échec pré-existant est documenté plus bas (« Connu »), un cinquième était un effet d'ordre.
  - **Graine des infos** (SPEC-HUD-002) : `remplacerMonde` met désormais `g.graine` à jour. Une partie chargée avant une connexion au serveur gardait son ancienne graine dans le panneau d'infos alors que le serveur avait imposé la sienne (l'e2e « la graine figure dans les infos » échouait après un test en ligne).
  - **`g.reinitialiserQualite()`** (nouveau, pour les bancs) : remet l'adaptation de qualité (SPEC-RENDU-005) au palier plein. Les e2e SPEC-EAU-008 et SPEC-RENDU-004 l'appellent : l'adaptation coupe la réfraction sous 30 FPS et ne la rend qu'au-dessus de 50 (hystérésis), si bien que la charge des tests en ligne qui les précèdent la laissait coupée (`niveau 1`, `fpsP50 34`) et rendait les deux tests intermittents. Aucune assertion affaiblie.
  - **e2e « la touche G jette l objet tenu »** : réécrit sur un serveur réel (`g.rejoindreServeur`, bloc cassé pour s'équiper, attente d'un inventaire stable) : depuis SPEC-ARCHI-031, l'objet jeté vient du serveur et ne naît plus d'une entité locale, donc la page sans serveur ne pouvait plus rien constater. Le test vérifie l'unité en moins, l'absence d'entité locale et l'objet au sol répliqué par le serveur, puis rend à la suite la graine d'origine.
- Banc de test (`tests/run.js --delai`, filet d'inactivité) : la phase d'intégration (une vingtaine de scripts, plus de 15 min cumulées) n'écrivait jamais le battement de cœur : un préréglage `pr` sain était coupé « sans progrès depuis 900 s ». Chaque script d'intégration écrit maintenant son nom dans le fichier d'état avant de démarrer et rafraîchit le verrou ; le verrou est repris s'il n'a pas été touché depuis 30 min (réutilisation de PID sous Windows).
- SPEC-ARCHI-042 (adoption du solo importé) : un enregistrement de joueur importé portant un `succes` VIDE masquait les succès réels conservés dans `extras.succes` (ils restaient à jamais dans les extras, le joueur démarrait sans rien). L'adoption reprend désormais `extras.succes` dès que le `succes` du joueur est vide. `tests/integration-archi-parties.js` : fixture avec un identifiant de succès réel (`premier_bloc` ; `premier_pas` n'existe pas et est désormais filtré) et lecture dans `joueurs[nom].succes`.
- `tests/integration-archi-vie.js` : la marche vers le butin (annonce DONNE) attend jusqu'à 45 s (au lieu de 12 s) : l'horloge de jeu du serveur ralentit sous charge, la borne reste finie.
- Banc de test : les scripts `tests/integration-*.js` lancent de vrais serveurs sur des ports FIXES ; deux campagnes simultanées (hooks de plusieurs worktrees, agents en parallèle) échouaient au démarrage, par intermittence, sur des scripts sans rapport (pvp, inventaire…). `tests/run.js` sérialise désormais la phase d'intégration par un verrou inter-processus (fichier exclusif dans le dossier temporaire, PID dedans, repris s'il est périmé) ; `integration-inventaire.js` n'a plus le même port par défaut que `integration-pvp.js`.
- Test E2E « E ouvre l'inventaire et libère la souris » (préréglage `e2e-fumee`, pre-push) : échec intermittent « attendu ui, obtenu dead ». Cause : `reset()` téléportait le joueur sans effacer son suivi de chute (`fallFrom`) ; le test « avancer » finit en l'air (vol coupé à y=60), le joueur tombait quelques images, puis la téléportation au sol comptait une chute de ~57 blocs et le tuait. `reset()` remet maintenant `fallFrom` et `onGround` à zéro (assertion inchangée).
- `tests/integration-archi-vie.js` (SPEC-ARCHI-027) : le coup fatal sur un mouton dépend du recul de l'arme (le mouton peut être repoussé ou soulevé hors de la portée 3D du serveur) ; le test ne frappe que tant que le mouton est à portée et note « non concluant » (ignoré) au lieu d'échouer par intermittence. Les assertions non létales du plafond d'arme restent strictes.
- Serveurs `--ouvert` orphelins laissés par les tests : la relance détachée d'une bascule de partie (`/api/parties/charger`) produit un nouveau processus qu'un serveur OUVERT n'arrête jamais de lui-même (comportement voulu en exploitation) ; quand le nettoyage d'un test échouait (relance pas encore à l'écoute, test interrompu par le délai du crochet), ce serveur tournait à 60 Hz indéfiniment et chargeait la machine. Réglage de test `MC_TEST_ARRET_SI_MORT=<pid>` (hérité par la relance, jamais en exploitation) : le serveur s'arrête dès que la suite qui l'a lancé disparaît ; `tests/aide-integration-archi.js` le pose pour tout serveur lancé par `lancer`, et `arreterSurPort` (PID lu dans `/api/parties` → `monde.pid`, repli par `kill`) remplace les copies locales de parties et robustesse. Tests : `integration-archi-parties.js` (scénarios `orphelin`, échouant avant le correctif, et `fermee` : une relance en serveur fermé s'arrête bien après le départ du dernier client).
- Tests d'intégration fragiles sous charge après la fusion de A0, B-INV, B-ENV et B-VIE (aucune régression de code : le serveur consomme les entrées et fait avancer le monde moins vite que l'horloge quand la machine est chargée) : `integration-archi-parties.js` (SPEC-ARCHI-014) et `integration-archi-env.js` (sommeil, dormeur qui s'éloigne) sondent, de façon bornée, que l'état reçu reflète les dernières entrées envoyées au lieu d'un délai fixe ; `integration-admin.js` (SPEC-DONJON-017) attend le démarrage du serveur jusqu'à 30 s et la régénération du coffre (temps de monde) jusqu'à 45 s.
- `tests/integration-archi-parties.js` (SPEC-ARCHI-014) : attend la sauvegarde asynchrone sur pause par sondage borné au lieu d'un délai fixe de 900 ms, qui échouait par intermittence sous charge.
- SPEC-PERF-001 (`tests/spec-perf.js`) mesure désormais la génération dans un processus NEUF (`tests/bench-generation.js`, moyenne seule) au lieu du processus de la campagne : en fin de préréglage (~1060 tests plus tôt) le même code y prenait 106-117 ms contre ~55 ms mesurés hors campagne — pollution du tas/JIT du processus, pas une régression de génération. Le budget de 75 ms est inchangé.
- Banc de test (`tests/run.js --delai`, SPEC-BANC-010) : le filet de 15 min était une durée TOTALE de campagne, dépassée à raison par le préréglage `pr` depuis que la suite grossit (intégrations ARCHI) — le pre-push refusait une suite saine. C'est désormais un filet d'INACTIVITÉ : il se réarme à chaque test commencé (fichier d'état) et ne tranche que si plus rien n'avance pendant 900 s, ce qu'il visait depuis le début (un test qui boucle).
- Chantier ARCHI, client : après une actualisation de page (F5) le serveur peut ne pas avoir encore constaté la fermeture de l'ancienne connexion et refuser `poste_deja_connecte` ; l'écran d'attente de la partie réessaie jusqu'à 4 fois à 300 ms avant d'afficher « Connexion refusée » (`tests/integration-archi-client.js`, scénario `reessai`, dans un vrai navigateur).
- Chantier ARCHI, robustesse du serveur local après revue adversariale (`tests/integration-archi-robustesse.js`) :
  - **Pause complète** (SPEC-ARCHI-010) : en pause, sont aussi ignorés `MANGER`, `RENAITRE` (un joueur mort renaît à la reprise), `DISTRIB`, `CRAFT`, `EQUIP`, `INV_CONSOMMER`, `INV_LACHER`, `INV_CREATIF`, `TROC`, `CONTENEUR_OUVRIR` et `CONTENEUR_TRANSFERT` ; `ADMIN`, `CHAT`, `CONTENEUR_FERMER` restent acceptés. La progression d'un fourneau est vérifiée figée pendant 3 s de pause (l'instantané `/api/parties` expose désormais `monde.fours`).
  - **Bascule réseau à chaud** : le mode, la pause, le délai de grâce et les expulsions ne changent qu'APRÈS l'ouverture de la nouvelle liaison ; un échec restaure la liaison précédente sans effet de bord, et si elle est aussi perdue le serveur sauvegarde et s'arrête proprement.
  - **Sauvegarde en vol** : la cible est figée au lancement de l'écriture ; supprimer la partie active pendant qu'elle s'écrit ne lève plus (`rename(…, null)`), n'écrit plus `null.tmp`, ne recrée pas le fichier supprimé.
  - **Relance de partie** : le processus relancé démarre en pause tant qu'aucun client n'est là et hérite du jeton d'administration du précédent (variable d'environnement de l'enfant).
  - **Présence** : seule compte une connexion qui rejoint la partie ou qui parle au poste (`PAUSE`, `RESEAU`, `ARRET` depuis la boucle locale) ; une WebSocket muette n'annule ni ne retarde plus l'arrêt d'un serveur orphelin.
  - **Import** : le fichier de monde s'écrit avant l'index ; en cas d'échec ni fichier orphelin, ni `.tmp`, ni entrée d'index.
  - `module.exports` n'exporte plus la liste d'écouteurs obsolète.
- Tests sensibles à la charge de la machine : budget de SPEC-PERF-001 relevé de 65 à 75 ms/chunk (`tests/spec-perf.js`, `tests/budget-perf.json`, toujours nettement sous les ~98-112 ms d'avant le cache, décision de l'utilisateur après des dépassements répétés à 70-74 ms sous contention CPU) ; `tests/integration-pvp.js` frappe désormais jusqu'à la défaite (bornée) au lieu de supposer que trois coups passent la cadence serveur de 0,4 s en 500 ms réelles.
- SPEC-PACK-001 (revue, trouvé en écrivant SPEC-PACK-004) : le serveur d'une archive empaquetée ne démarrait jamais — `server.js` exigeait `./tools/historique.js` (route `/tests/historique/*`, développement seulement) de façon INCONDITIONNELLE au chargement, alors que `tools/paquet.js` n'embarque jamais `tools/` dans un paquet joué (« gonflerait l'archive pour rien pour JOUER »). Le require est désormais paresseux, comme pour `tools/resultats-tests.js`/`tools/registre.js` juste à côté. Révélé par `tests/integration-paquet.js`, qui démarre vraiment le serveur DEPUIS l'archive construite.
- SPEC-SERVEUR-010 : `maxJoueurs` comptait les CONNEXIONS, pas les joueurs — une connexion en écran partagé à 4 joueurs locaux n'en décomptait qu'une seule, permettant jusqu'à 4× la capacité annoncée. `placesOccupees()` (`server.js`) somme désormais `c.locaux` des connexions déjà admises ; un `REJOINDRE` qui dépasserait la capacité, même partiellement, est refusé en bloc (jamais une équipe admise à moitié).
- Instrumentation des tests (`tests/run.js`, observation des fonctions, SPEC-BANC-062) : un test étiqueté `budget-perf` (SPEC-PERF-001…) ne coupait que le COMPTAGE (`actif.v`), pas l'indirection d'appel elle-même — une frame de plus + `Function.prototype.apply` par appel MC.*, assez pour faire dépasser un budget de temps serré sur des dizaines de milliers d'appels bon marché (génération de chunk), constaté en échec intermittent alors que le code mesuré n'avait pas changé. Les fonctions enveloppées sont désormais réellement RESTAURÉES (pas seulement le comptage désactivé) pour la durée d'un test `budget-perf`, puis réenveloppées ensuite pour le reste de la campagne.
- SPEC-DONJON-017 (revue) : un joueur qui gardait l'écran d'un coffre de donjon ouvert au moment de sa régénération restait anormalement « abonné » à la clé déjà effacée de `conteneursPoses` — `regenererCoffresDonjon` (`server.js`) appelle désormais `fermerConteneurPourAbonnes` avant de l'effacer, comme le fait déjà la casse d'un conteneur posé. L'algorithme complet est extrait en une fonction pure `MC.Donjons.creer(...).regenererCoffres(...)`, testée sous Node avec de fausses collections (`tests/spec-donjons.js`) et par un test d'intégration sur un vrai donjon généré (`tests/integration-admin.js`, graine 344).
- SPEC-SERVEUR-009 (revue) : un client qui se reconnectait à la même graine ne redemandait jamais les overrides des chunks déjà chargés avant la coupure — un bloc modifié par un autre joueur pendant la déconnexion, dans un chunk déjà en mémoire, ne parvenait plus jamais au client (régression introduite par le passage aux overrides par chunk). `src/game.js` (`onBienvenue`) vide désormais `overridesDemandes` à la reconnexion à même graine, et `streamChunks` ne garde plus `world.chunks.has` comme garde-fou (seul `overridesDemandes` compte). Testé par `tests/integration-net.js`.
- SPEC-TRANSPORT-005 (revue adversariale) : la colonne « vérification » de SPECS.md laissait croire qu'un joueur est réellement prélevé en jeu — précisée : les fonctions d'intégration (`peageSegment`/`appliquerPeage`) sont réelles et testées isolément, mais pas encore câblées (véhicules solo uniquement, factions politiques serveur-only, limitations préexistantes).
- SPEC-RENDU-014 (revue adversariale) : un chunk masqué par le culling d'occlusion en vue unique restait caché indéfiniment aux deux joueurs après passage en écran partagé — la boucle multi-vues n'applique jamais l'occlusion, à raison, mais n'annulait pas non plus l'état hérité. La visibilité de tous les chunks actifs est désormais réinitialisée à l'entrée en multi-vues.
- SPEC-FACTION-017 (relecture) : `declarerRelation` (`guildes.js`) pose la
  relation réciproque côté PNJ dans `etatPolitique.relations`, sous une clé
  mêlant un id de faction de joueurs (ex. `g1`) à celui d'une faction PNJ.
  Or `politique.js:tourUnJour` balayait ensuite TOUTES les clés de
  `etat.relations` sans filtre (contrairement à `ciblePourRaid`, qui filtre
  déjà avec `etat.factions.has`) pour leur appliquer une dérive aléatoire
  journalière et générer des annonces via `nomDe` : une relation déclarée par
  un joueur envers une faction PNJ dérivait donc spontanément au fil des
  jours simulés, et les annonces pouvaient afficher l'id brut de la faction
  de joueurs (`nomDe` retombe sur l'id quand il n'est pas dans
  `etat.factions`) au lieu d'un nom lisible. `tourUnJour` applique désormais
  la même garde que `ciblePourRaid` : une clé de relation dont l'une des deux
  parts n'est pas une faction PNJ connue n'est ni dérivée ni annoncée.
- SPEC-QUETE-002 (`politique.js`) : `reussirQueteElimination` recevait un
  jour et recalculait la cible via `ciblePourRaid(etat, f, jour)`, alors que
  `ciblePourRaid` dépend du jour (candidats indexés par un hachage qui varie
  par jour). Résolue un jour différent de celui de la proposition — le cas
  normal une fois le suivi/l'acceptation des quêtes câblé —, la « réussite »
  pouvait viser une AUTRE faction que celle annoncée au joueur dans la quête,
  dès que 3 factions ou plus étaient candidates (guerre ou rivalité).
  `reussirQueteElimination` reçoit désormais directement `cibleId`, la cible
  réellement promise par `questesDe` à la proposition, et se contente de
  revalider qu'elle est toujours une faction connue en guerre ou en
  rivalité avec l'auteur, plutôt que de la recalculer au jour de résolution.

- Inventaire en ligne : la grille de fabrication est rechargée depuis l'état confirmé du serveur (INV_MAJ) ; un transfert inv→grille refusé ne laisse plus d'objet fantôme dans la grille.
- Vague 2 (B1, revue adversariale, gravité élevée, SPEC-SYNC-012/013/014) :
  `validerEmplacement` (contrats-vague2.js, figé) plafonne génériquement `i`
  à 27 pour toute zone `'cont'`, en comptant sur le serveur pour vérifier la
  taille RÉELLE (fourneau 3, étagère/distributeur 9, bibliothèque 18) — que
  `resolveZone`/`transfert` (conteneurs.js) ne comparaient jamais à
  `cont.taille`. `zd.slots[op.vers.i] = …` pouvait donc agrandir le tableau
  JS au-delà de sa taille, et `validerConteneurPersiste` (qui exige
  `slots.length === taille`) faisait alors disparaître le conteneur ENTIER,
  silencieusement, à la prochaine relance `--monde`. `indiceValide`
  (conteneurs.js) refuse désormais tout indice hors de la taille réelle du
  conteneur ciblé, en lecture comme en écriture, pour `inv`/`grille`/`cont`
  (motif `absent` en source, `incompatible` en destination) — jamais une
  écriture qui l'agrandirait. Défense en profondeur à la persistance
  (`normaliserTailleConteneur`, server.js) : un conteneur déjà mal formé
  n'est plus filtré silencieusement par `etatMonde` — tronqué à sa taille,
  l'excédent lâché au sol (position connue), jamais perdu sans trace, avec
  un avertissement journalisé. Casser (et éventuellement remplacer) un
  conteneur posé pendant qu'un joueur l'a ouvert le désabonne désormais
  EXPLICITEMENT et le notifie (`CONTENEUR_FERMER`, message jusqu'ici
  seulement c→s, réutilisé comme fermeture forcée s→c — `net.js`/`game.js`
  ferment l'écran) : l'ancienne clé ne se résout plus jamais contre un
  conteneur de type différent posé au même endroit (coffre 27 cases →
  fourneau 3, par exemple). `onInvMaj` fournit désormais le miroir du
  conteneur EN LIGNE ouvert au rejeu des opérations en attente (`predInv`)
  — une opération sur la zone `'cont'` encore en attente échouait sinon au
  rejeu ; auparavant, seul son côté inventaire était rejoué.

- Aide de test partagée `reset()` (tests/e2e.js, ~140 tests e2e) : elle
  repositionnait le joueur au point d'apparition puis n'attendait que 3
  images avant de rendre la main, en supposant le chunk d'origine déjà
  chargé — vrai tant que la génération restait synchrone. Devenue
  asynchrone par workers (L47, `feat(workers)`/`fix(workers)`), un test qui
  vient de téléporter loin (un donjon à 900 blocs, par ex.) puis de faire
  `reset()` pouvait repartir AVANT que les chunks d'origine ne soient
  revenus : `groundAt` (qui lit `getBlock`) rendait alors 0 (rien de solide
  dans un chunk absent) au lieu du vrai sol, faisant réapparaître le joueur
  au bedrock, et tout `setBlock` posé ensuite près du départ échouait en
  silence sur les chunks pas encore revenus (`world.setBlock` rend `false`
  sans écrire si le chunk est absent) — cause commune, identifiée par
  `git bisect` ciblé, des échecs de SPEC-EAU-008, SPEC-PERF-012 et d'une
  partie de ceux de SPEC-VEHIC-006 (faussement qualifiés d'intermittents :
  persistants dès qu'un test téléportant au loin précédait l'un de ceux-ci).
  `reset()` force maintenant la génération du chunk d'origine
  (`world.getChunk(..., true)`) avant d'y lire le sol, puis recharge tout
  son voisinage de façon synchrone (`streamChunks(true)`, sans worker,
  SPEC-PERF-006) avant de rendre la main — sans coût notable quand tout est
  déjà chargé (Map.has), comme le faisaient déjà à la main les quelques
  tests qui téléportent eux-mêmes (SPEC-DONJON-004, SPEC-EAU-008).
- Test e2e SPEC-METEO-007 (« la pluie tombe dehors et s'arrête aux toits »),
  vraiment intermittent celui-là (~1 échec sur 4 en local, hors de toute
  autre cause) : il posait un toit puis attendait un nombre FIXE de 40
  images avant de vérifier qu'aucune goutte ne le traverse. Or chaque
  goutte garde son « sol » (hauteur d'abri) en cache tant qu'elle ne change
  pas de colonne (render.js, `animer_`), lui-même dérivé d'un second cache
  (game.js, `abri()`) délibérément vidé une fois par seconde SIMULÉE
  seulement (perf assumée, commentaire d'origine : « un bloc posé ou cassé
  est pris en compte sans balayer chaque image ») — une goutte déjà en
  chute juste au-dessus de la colonne qu'on vient de couvrir continue donc
  de traverser le nouveau toit jusqu'à sa PROCHAINE renaissance naturelle,
  qui n'arrive pas toujours dans les 40 premières images ni avant que le
  cache de la seconde n'ait tourné. Comportement du jeu inchangé (un délai
  jusqu'à ~1 s avant qu'un toit tout juste posé n'arrête vraiment la pluie
  est un compromis de perf assumé, documenté, antérieur à ce lot) : seule
  l'hypothèse du test (40 images toujours suffisantes) était fausse. Le
  test attend maintenant le recalage réel (plus aucune goutte vivante sous
  le toit avec un « sol » caché encore périmé), au moins 40 images, avec un
  garde-fou à 400 — sans rien affaiblir de ce qu'il vérifie.
- Test e2e SPEC-VEHIC-006/002 (« monter en voiture, rouler au clavier »),
  faussement qualifié d'intermittent — échouait en fait de façon persistante :
  le test attendait 120 IMAGES RÉELLES en supposant qu'elles représentent
  toujours ~2 s de temps SIMULÉ. Or poser sa piste (7×44 blocs, plusieurs
  chunks d'un coup) les rend tous `dirty` en même temps ; `remeshDirtyNear()`
  les remaille ensuite en tâche de fond, jusqu'à 3 par image, un maillage
  fusionné coûtant couramment 45-60 ms (mesuré, budget de
  `tests/budget-perf.json`) — largement au-delà du clamp `dt` de 0,05 s/image
  (SPEC-BANC-010, filet anti-explosion). Plusieurs de ces images lentes de
  suite réduisaient le temps réellement simulé bien en-deçà des ~2 s
  attendues, sous le seuil physique nécessaire (0,5·7·t² > 5 blocs ⇒ t >
  1,2 s) pour que la voiture ait mesurément avancé. Le comportement du jeu
  (clamp dt, remaillage synchrone borné) est correct et volontaire ; seule
  l'hypothèse du test était fausse. Corrigé en attendant le temps SIMULÉ
  (`g.duree`) plutôt qu'un nombre fixe d'images, ce qui garde exactement la
  même vérification (accélération réelle sur ~2 s de jeu) sans dépendre du
  nombre d'images qu'il aura fallu pour les obtenir.

- Rendu (mesher.js, régression du lot A3 « greedy meshing », SPEC-PERF-011 à
  013) : `tileOrigin(tile, rot)` appliquait la rotation de variante de tuile
  (herbe/sable/pierre/neige… `tourne: true`) à l'origine ET `localUV`
  l'appliquait à nouveau à la coordonnée locale ajoutée par le shader d'atlas
  (`uvBase + fract(uvRep) * tailleTuile`, `avecAtlasRepete` dans render.js) —
  la rotation se retrouvait appliquée DEUX FOIS pour toute face tournée (rot
  1/2/3, la majorité des blocs de terrain), décalant l'échantillonnage d'une
  tuile entière dans l'atlas : un damier de tuiles fausses (parfois un tout
  autre bloc) recouvrait sable, plage et chemins, signalé en jouant. `tileOrigin`
  reste désormais toujours à l'origine NON tournée de la tuile (seul `localUV`
  porte la rotation), vérifié par reconstruction algébrique face à `pushUV` (la
  référence sans repli greedy) et reproduit/confirmé corrigé en navigateur réel
  (Playwright, seed -1001861235).
- Banc de test (SPEC-BANC-010, révision) : le délai par test e2e/Node
  coupait un test dès qu'il dépassait son délai (60 s côté e2e navigateur,
  45 s côté navigateur sans fenêtre `tools/e2e-headless.js`, 30 s côté Node)
  — un test réel simplement LENT (rendu logiciel, machine chargée) était
  donc marqué « delai » puis compté en échec, avant même d'avoir pu finir de
  s'exécuter. Devient un filet de sécurité contre un test qui ne rend
  VRAIMENT jamais la main (deadlock) : généreux par défaut (15 min sur les
  trois volets), configurable par `fiche.delai`. Le seuil « lent » (signal
  en direct dans la zone des tests lents) reste inchangé et ne fait toujours
  pas échouer un test. Corrige aussi un bug latent de `tests/catalogue.js`
  (`ficheDe()`) : `fiche.delai` ne survivait pas à la déduction de fiche
  depuis la spec citée quand le test ne déclarait QUE `{ delai: N }`.
- Workers de chunk (L47, B3, revue adversariale) : le message `init` était
  envoyé via `pool.envoyer()`, qui ne distribue qu'à UN SEUL worker libre —
  correct pour `genere`/`maille`, faux pour `init` qui doit atteindre CHAQUE
  worker (chacun garde sa propre `epoqueCourante` en portée de module). Sur
  un pool de maillage à plusieurs workers (le cas normal, jusqu'à 4), seul
  celui choisi par `envoyer()` recevait son `init` ; les autres restaient
  bloqués sur une époque périmée et ignoraient silencieusement toute tâche
  reçue par la suite (aucune réponse, donc jamais libérés) — sous charge de
  maillage suffisante pour occuper tous les workers, le nombre de chunks
  maillés se figeait définitivement, certains restant `dirty` pour
  toujours. `src/workers.js` expose désormais `pool.diffuser(msg)` (envoie
  à TOUS les workers du pool, sans jamais marquer un worker occupé),
  utilisée par `src/game.js` pour `init` (démarrage et
  `remplacerMonde`/`newWorld`/`perdrePartie`) à la place d'`envoyer()`.
  Reproduit et vérifié corrigé en conditions réelles (Playwright/Chrome,
  pool de 4 workers de maillage, ~200 chunks demandés d'un coup : tous les
  chunks dont le voisinage est chargé finissent maillés, plus aucun blocage).
- Chunk : `chunk.version` repartait toujours de `1` à chaque régénération
  (déchargement puis rechargement de la même position) — un résultat de
  maillage périmé, envoyé avant un déchargement puis oublié par
  `MC.FileChunks`, pouvait par coïncidence numérique passer pour courant si
  la position redevenait voulue avant l'arrivée de cette réponse tardive
  (cas rare). `world.js` retient désormais, par position de chunk et pour
  toute la durée de vie du monde, le dernier numéro de version employé
  (persistant au-delà d'un déchargement) : deux générations successives à la
  même position ne partagent plus jamais de numéro.
- Catalogue de tests (`tests/catalogue.js`, `ficheDe()`) : `fiche.delai` ne
  survivait pas au passage du test brut à l'entrée du catalogue — un test
  e2e voulant un délai plus court que le défaut tournait donc à son délai
  PAR DÉFAUT (60 s) plutôt que celui déclaré dans sa fiche (SPEC-BANC-010).
- `tests/run.js` (`e2eListeDepuisTexte`) : un simple commentaire `//`
  explicatif au-dessus d'un `e2e(...)` (une phrase se terminant par un point
  ou une virgule) pouvait être pris à tort pour un titre de section, faussant
  le groupe affiché par `--lister` pour les tests qui suivaient.
- Bandeau manquant au-dessus d'un groupe de tests dans `tests/e2e.js`,
  faisant hériter ces tests du groupe précédent dans `--lister`.
- Économie (SPEC-METIER-002, L45) : le minerai du forgeron (`L.minerai`)
  n'était jamais alimenté (créé vide, jamais crédité) — toute offre forgée
  (épée/hache/pioche de fer, pioche de diamant) restait `dispo:false` pour
  toujours. Un lieu naît désormais avec un stock de minerai (« une mine à
  proximité », `MINERAI_REF`), reconstitué chaque jour par `tickJour`
  (indépendamment de la saison, à la différence des récoltes) —
  `tests/spec-metiers.js` épuise et reconstitue ce stock par de vrais
  échanges plutôt que de l'écrire à la main.
- Commerce en ligne (SPEC-FACTION, L45) : le `case NP.MSG.TROC` de
  `server.js` n'appliquait pas le contrôle « village hostile ferme le
  commerce » (`MC.Factions.commerceOuvert`) que `game.js` applique en solo
  avant `executerTroc` — ajouté, comme prévu par docs/vague-2/B2.md § 13.
- Captures des cahiers de test (SPEC-BANC-011/012) : les vignettes affichées
  dans la page utilisent l'URL de données complète (comme avant), et seul
  l'envoi au serveur en retire le préfixe pour transmettre du base64 pur ;
  vérifié de bout en bout par une vraie campagne e2e (Playwright), sans
  erreur console — chaque test garde ses propres captures, distinctes,
  valides, visibles dans le rapport et les exports web/PDF/Word.
- Métriques par test (SPEC-BANC-012) : les champs envoyés par le banc
  navigateur (`fps_moyen`, `appels_dessin`, `memoire_js`) ne correspondaient
  pas au schéma attendu par `tests/rapport.js` (`fps_moy`, `appels`,
  `memoire`) — rapport.html, les exports et la moyenne d'images/s de la
  campagne restaient vides silencieusement. Renommés pour correspondre.
- Boutons d'export du cahier : la sonde `HEAD` censée les masquer si la
  route n'existait pas encore provoquait un 405 (le serveur n'accepte que
  `GET`), journalisé en erreur à chaque campagne ; retirée, la route étant
  désormais stable dans le noyau.
- Test e2e SPEC-RENDU-004 (« la réfraction ne s'active qu'à moins d'une
  distance fixe de la caméra »), intermittent : après l'excursion loin de
  toute eau (téléportations successives, rechargées à chaque fois en
  synchrone via `streamChunks(true)`), le retour près de la mer cible ne
  rappelait PAS `streamChunks(true)` et se contentait d'attendre 20 images
  réelles — en comptant sur le rattrapage progressif et budgété
  (`GEN_BUDGET`/`MESH_BUDGET`, potentiellement via Worker) de la boucle de
  jeu pour régénérer/remailler le chunk d'eau proche, redevenu absent après
  l'excursion. Ce rattrapage dépend du temps réel écoulé (aller-retour
  Worker, charge CPU concurrente) et non du nombre d'images : sous charge,
  20 images ne suffisaient pas toujours, et `eau.distance` continuait de
  désigner l'ancien maillage éloigné (« l'eau est maintenant à portée : 77.35
  >= 40 »). Comportement du jeu inchangé ; le test force maintenant le même
  rechargement synchrone qu'à l'aller avant de vérifier la distance.
- Test e2e SPEC-SUCCES-001 (« casser un bloc débloque « Premier bloc » »),
  intermittent dans le contexte des ~110 tests qui le précèdent (reproduit,
  cause identifiée par instrumentation ciblée) : le bloc réellement visé
  sous le joueur dépend du MONDE hérité de tests antérieurs sans rapport
  (une graine tirée au hasard par SPEC-MENU-003/004, ou le monde « Autre
  carte », graine 777, chargé par SPEC-TERRAIN-007 et jamais restauré
  ensuite) — un sol qui peut être de la pierre, du grès… n'importe quel
  bloc que la pelle en fer tenue par le test ne « harvest » pas (tier 0,
  vitesse ×1 au lieu de ×8), prenant alors jusqu'à ~1,5-2,2 s de minage
  SIMULÉ. Le test attendait déjà le vrai critère (le bloc change) mais le
  bornait à 240 images RÉELLES, une hypothèse implicite d'au moins ~150 fps
  pour ces blocs-là — fausse sous charge partagée (constaté : ~600 ms isolé,
  jusqu'à ~4,2 s dans le contexte, selon la graine tirée par les tests
  précédents). Le test force désormais un bloc CONNU et cassable
  INSTANTANÉMENT à la pelle (terre) sous le joueur avant de miner : le
  résultat reste déterministe et rapide quel que soit le monde hérité, sans
  affaiblir ce qu'il vérifie.

### Connu
- e2e « SPEC-AUDIT-002 : retirer une entite libere ses materiaux » échoue (« cinq maillages crees — attendu 5, obtenu 0 ») ; **pré-existant**, échoue à l'identique sur la base d'avant le chantier (`6d1498f`), isolé comme en suite. Cause : le test fait naître cinq zombies, or `UMBRAL_INSTANCE_MOB = 5` (`src/render.js`, SPEC-RENDU-009) les fusionne en un seul `InstancedMesh` : il n'existe aucun maillage individuel dans `entityMeshes`. Sans rapport avec le chantier ; à corriger en faisant naître moins de mobs que le seuil (ou en vérifiant la libération de l'instance).

### Sécurité
- Chantier ARCHI, durcissement du lot A0 après revue adversariale :
  - Une connexion n'est « locale » (donc habilitée à `RESEAU`, `ARRET`, `PAUSE`) que si son adresse, son `Host` ET son `Origin` (absente ou locale) le sont et qu'aucun en-tête de mandataire (`X-Forwarded-For`, `Forwarded`, `X-Real-IP`) n'est présent. Avant, l'adresse seule suffisait : en `--ouvert`, une page tierce ouverte dans le navigateur de l'hôte pouvait arrêter le serveur.
  - `cheminSur` ne sert plus jamais le dossier des parties (`parties/`, `--dossier-parties`) ni le fichier `--monde` ; en mode fermé toute requête HTTP exige un `Host` local (rebond DNS), et l'API `/api/parties` l'exige dans les deux modes.
  - Un serveur dédié (`--serveur`) ignore `RESEAU {ouvert:false}` : il reste toujours ouvert.
  - Test : `tests/integration-archi-securite.js`.

- Jetons d'administration et d'invitation à entropie cryptographique
  (SPEC-SECU-009) : `src/admin.js` (module pur, sans dépendance Node)
  accepte désormais une source aléatoire INJECTÉE (`generateurAleatoire`,
  posée par `creerEtat()`) pour `nouveauJeton()` — server.js lui passe
  `crypto.randomBytes`, jamais `Math.random`, aussi bien pour le jeton
  d'administration tiré au démarrage sans `--admin` que pour les jetons de
  modérateur et d'invitation. Sans générateur injecté, l'ancien repli
  (horodatage + compteur + hasard, suffisant pour la seule unicité) reste
  disponible pour la rétrocompatibilité.
- `src/admin.js` (module pur) expose désormais `MC.Admin.purger()`
  (SPEC-SERVEUR-005, toujours ⏳) : bornage de `admin.sessions`,
  `admin.invitations` et `admin.sanctions` en taille ET en ancienneté, sans
  jamais retirer une entrée encore active (session ouverte, invitation ni
  révoquée ni expirée ni épuisée, bannissement ou sourdine en cours) — les
  entrées obsolètes les plus vieilles sont retirées d'abord, puis les plus
  anciennes au-delà du seuil de taille si besoin. La fonction est testée en
  isolation (`tests/spec-admin.js`) mais n'est PAS ENCORE invoquée par
  `server.js` : aucune purge n'a lieu sur un serveur qui tourne réellement
  tant qu'elle n'est pas branchée sur la boucle périodique existante
  (tâche de suivi explicitement à part, hors du périmètre autorisé ici).
- L50, nouveau domaine **ARCHI** (SPEC-ARCHI-001 à 042, spécifié seulement —
  aucun code) : décision de l'utilisateur, « aucune différence entre solo et
  serveur, toujours un serveur, ouvert ou non au réseau ». **Node devient requis
  pour jouer**, même seul. ARCHI-001 à 020 (lot A0) : serveur local toujours
  démarré, en mode fermé lié à `127.0.0.1`/`::1` avec contrôle de l'en-tête
  `Origin`, port stable, ouverture et fermeture au réseau à chaud, arrêt sans
  processus orphelin, un seul poste en fermé, pause côté serveur (message
  `PAUSE`, gel complet, reprise sans rattrapage), sauvegarde immédiate à la
  pause et à la sortie puis cadence de 45 s en fermé (évaluation chiffrée,
  sauvegarde continue rejetée), parties sur disque, parité de persistance,
  migration des parties `localStorage` (export puis import), lancement et
  paquet, écran d'attente, budgets de latence locale et de démarrage, contrat
  gelé `src/contrats-archi.js`, écran partagé conservé. ARCHI-021 à 042 :
  élimination des 49 occurrences de `net.enLigne()` de `src/game.js`, une fiche
  par groupe thématique avec ses lignes ; portage serveur planifié de
  l'histoire, des succès et des véhicules ; bombes et coulées volcaniques
  **supprimées** (sans équivalent serveur). `PLAN.md` : lot L50 et « Vague
  ARCHI » (A0-pré, A0, B-ENV, B-VIE, B-INV, B-RESEAU, P-VEH, P-HIST, P-SUCC) ;
  règle de publication : pas de publication sans histoire ni succès, véhicules
  au pire publiés en version marquée régressive. Conception :
  `docs/archi-solo-serveur/README.md`.

## [0.4.0] - 2026-09-24
### Sécurité

- Fiabilité du transport réseau (L44, sous-lot A1 — SPEC-SECU-001 à 008,
  SPEC-SERVEUR-003/004) :
  - une exception pendant le traitement d'un message (`traiter(c, m)`) ne
    ferme plus que la connexion fautive — les autres clients restent en
    ligne et le processus continue ; `uncaughtException`/`unhandledRejection`
    sont désormais journalisés avec une sauvegarde de secours plutôt que de
    laisser le processus s'arrêter silencieusement ;
  - le tampon de réception par connexion est borné (`NP.TAMPON_MAX`, 1 Mo) :
    un en-tête de trame annonçant une longueur énorme, jamais complétée, ne
    peut plus faire grossir la mémoire indéfiniment — la connexion est fermée ;
  - une trame client non masquée (bit MASK à 0) est désormais rejetée et la
    connexion fermée, conformément à la RFC 6455 ;
  - anti-flood PAR JOUEUR LOCAL (`m.j`, un poste peut partager sa connexion
    entre plusieurs joueurs en écran partagé) ET PAR TYPE de message (hors
    `ENTREE`, cadencé par ailleurs) : 90 `BLOC`/s (couvre la casse instantanée
    en créatif, ~60/s à 60 im/s, marge 1,5×), 30/s pour les autres types
    porteurs d'un joueur local, 30/s par connexion pour `REJOINDRE`/`ADMIN`,
    et le chat séparément (5 messages/10 s, par connexion). Un dépassement de
    budget n'ignore QUE le message en trop (un `BLOC` ignoré resynchronise le
    client avec l'état autoritaire, comme un refus de portée) ; seul un débit
    ABERRANT (plus de 10× le budget, hors de portée d'un client honnête)
    déclenche d'abord un avertissement puis, s'il persiste, une expulsion
    journalisée — plus jamais pour un débit simplement soutenu ;
  - la portée d'un joueur est vérifiée AVANT toute génération de chunk lors
    d'un `BLOC` (et non plus seulement avant l'application du bloc) : un
    client ne peut plus forcer le serveur à générer du terrain arbitrairement
    loin ;
  - les coordonnées reçues (`BLOC`, `BOUGE`, `DISTRIB`) sont désormais bornées
    par `NP.valider()` à une plage plausible (±10 000 000, très en-dessous de
    2³¹ où `valeur | 0` tronque) et, pour `y`, à la hauteur réelle du monde ;
  - la sauvegarde du monde (périodique et à l'arrêt) écrit désormais dans un
    fichier `.tmp` puis renomme atomiquement vers le fichier final — jamais de
    fichier tronqué au chemin final — et la sauvegarde périodique est
    asynchrone (elle ne bloque plus le tic ni les clients connectés) ; une
    seule sauvegarde asynchrone à la fois, et son propre fichier temporaire
    (distinct de celui de la sauvegarde d'arrêt) pour qu'aucune écriture
    concurrente ne puisse en corrompre une autre ; un fichier `.tmp` résiduel
    d'un arrêt brutal antérieur est nettoyé (et journalisé) au démarrage
    suivant.

### Ajouté
- Taille de l'interface dans les options : automatique (réduite dans les petites
  fenêtres, jamais sous 60 %) ou de 60 à 150 % ; les options se rangent sur
  deux colonnes quand la place le permet (SPEC-OPTION-007).
- Les répliques du mode histoire se répondent aussi au clavier : Entrée ou
  Espace pour continuer, 1 à 9 pour un choix (SPEC-HISTOIRE-014).
- Tests d'exploration des limites techniques (SPEC-LIMITE-001 à 006) : hauteur
  et profondeur de la carte, relief réellement généré, étendue horizontale,
  précision GPU et physique. Dans la suite standard, ils affichent un tableau
  des succès internes, des échecs internes et des valeurs relevées sans jamais
  bloquer, sauf si ce tableau ne peut se construire ; `node tests/explo-limites.js`
  explore toutes les distances jusqu'à 2⁵³ et conserve un cahier dans
  `tests/resultats/`. Premiers constats : relief de y = 6 à y = 114 sur 128,
  tremblement GPU visible dès 131 072 blocs de l'origine, coordonnées tronquées
  par le protocole réseau au-delà de 2³¹.
- Banc de non-régression `tests/bench-generation.js` et budget déclaratif
  `tests/budget-perf.json`, vérifiés par une nouvelle porte G12
  (SPEC-PERF-017/018).
- Outillage de test (L42, noyau côté Node) : un catalogue unique classe tous
  les tests (type, domaine, groupe, étiquettes) et leur donne une fiche
  (quoi/pourquoi/attendu), déclarée ou déduite de la spec citée
  (SPEC-BANC-001/002) ; sélection combinable par domaine, type, groupe, liste
  ou échecs précédents (SPEC-BANC-003) ; préréglages partagés `commit`, `pr`,
  `regression`, `bugs`, `en-cours`, `e2e`, `integration`, `rapide`, `visuel`,
  `limites` (SPEC-BANC-004) ; `node tests/run.js --preset|--domaine|--type|
  --groupe|--test|--liste|--echecs|--sauf|--lister` (SPEC-BANC-005) ; les
  crochets `pre-commit`/`pre-push` lancent désormais les préréglages
  `commit`/`pr` (SPEC-BANC-006) ; un test qui dépasse un délai coopératif est
  marqué « délai dépassé » avec son étape, la campagne continue
  (SPEC-BANC-010, volet Node) ; chaque échec porte fiche, étapes, assertions,
  attendu/obtenu, message et pile (SPEC-BANC-013, volet Node) ; chaque
  campagne écrit son cahier de test (`resultats.json` + `rapport.html` +
  captures) dans `tests/resultats/`, y compris interrompue, avec élagage aux
  20 derniers dossiers (SPEC-BANC-014) ; le serveur reçoit ce cahier du banc
  navigateur sur `POST /tests/resultats`, réservé à la machine locale, taille
  bornée, noms de fichiers fabriqués côté serveur (SPEC-BANC-015). Portes
  G13 (crochets ↔ préréglages) et G14 (100 % des tests Node ont une fiche).
- Bibliothèque des cahiers de test (SPEC-BANC-018 à 022) : page `/tests/cahiers`
  qui liste, trie, filtre, compare deux cahiers (tests apparus/disparus,
  passés en échec ou redevenus ok, écarts de durée), conserve ou supprime ;
  un cahier s'exporte en page web autonome (captures en data URI), en .docx
  réel (ZIP + WordprocessingML écrits à la main, sans dépendance) et en PDF
  (navigateur headless détecté automatiquement, repli sur l'impression sinon)
  — les quatre rendus (page serveur, HTML autonome, PDF, Word) partagent le
  même modèle de document (`tests/rapport.js`, `MC_RAPPORT.modele()`).
- Campagnes end-to-end sans fenêtre, en ligne de commande (SPEC-BANC-023/024/025) :
  `node tests/run.js --type e2e` (et tout préréglage qui contient des e2e)
  démarre désormais son propre serveur de test et son propre Edge/Chrome
  installé en mode sans interface (`--headless=new`, profil et port de
  débogage temporaires, dédiés à la campagne — deux campagnes lancées en
  même temps ne se gênent jamais), pilote `tests/index.html` de l'extérieur
  par CDP (`tools/cdp.js`, client minimal sans dépendance, réutilise le
  protocole WebSocket de `src/net-protocol.js`), récupère résultats,
  captures et journal de console, écrit le cahier de test comme les autres
  types, puis ferme navigateur et serveur — même en cas d'échec ou
  d'interruption (`tools/navigateur.js`, `tools/e2e-headless.js`). Le rendu
  utilise l'accélération matérielle quand elle existe (sinon signalée dans
  le cahier), sur une surface d'au moins 1280×800. Préréglage `e2e-fumee`
  (quelques e2e représentatifs, < 2 min), ajouté à `pr` donc à pre-push :
  ignoré avec un avertissement, sans échec, sur un poste sans navigateur.

### Corrigé
- Outillage de test (L42) : `tests/cahiers.html` échappe désormais tout
  champ de cahier (préréglage, source, version du jeu, commit) affiché dans
  le tableau — ces valeurs viennent du JSON posté par un client sur
  `/tests/resultats` et pouvaient contenir du HTML actif (XSS stocké) ;
  `tools/resultats-tests.js` assainit aussi ces champs à l'écriture
  (longueur, caractères de contrôle). Les routes d'écriture
  (`POST /tests/resultats`, `POST .../conserver`, `DELETE /tests/cahiers/
  <dossier>`) refusent désormais une requête dont l'`Origin` diffère de
  celle du serveur ou que le navigateur qualifie lui-même de
  `Sec-Fetch-Site: cross-site` (CSRF), et `POST /tests/resultats` exige
  `Content-Type: application/json`.
- `tools/domaines-touches.js` (utilisé par le crochet `pre-commit` pour
  restreindre le préréglage `commit` aux domaines touchés) retombe
  désormais sur la suite complète dès qu'UN SEUL fichier modifié n'a aucun
  domaine reconnu (ex. `src/core.js`), même si d'autres fichiers de la
  liste ont un domaine clair — un fichier partagé sans domaine propre peut
  affecter n'importe quel domaine.
- README.md précise que `node tests/run.js` sans argument n'exécute pas
  l'intégration (unitaire/fonctionnel/spec seulement) ; `--preset pr` pour
  tout le Node, intégration comprise.
- Fusion du lot L42 (outillage de test) avec le lot A1 (fiabilité réseau) :
  `tests/run.js` catalogue désormais aussi `integration-secu.js` (fiche
  déclarée, SPEC-BANC-002/G14) et `tests/spec-secu.js` cite explicitement
  SPEC-NET-002/003 dans le nom de son test de robustesse du décodeur, pour
  que les deux lots passent ensemble la porte G14 (100 % des tests Node ont
  une fiche déclarée ou déduite d'une spec citée).

### Performances
- Greedy meshing du maillage de chunk (lot L47, sous-lot A3 — SPEC-PERF-011 à
  013, partie maillage de SPEC-PERF-017) : les faces coplanaires d'un même
  bloc plein non liquide (même tuile/rotation, même occlusion ambiante aux 4
  coins, même lumière, même ciel, mêmes autres attributs par sommet) se
  fusionnent en un seul quad plus grand (`src/mesher.js`, `buildGreedy`),
  fusion ou pas selon un paramètre explicite (`fusion`, 7e argument de
  `buildChunk` — désactivé par défaut, activé par `src/render.js` pour le
  rendu réel) pour ne changer ni l'ordre ni le contenu de la géométrie quand
  la fusion n'est pas demandée. Mesuré sur 40 chunks générés (3 passes
  chacun, graine 20260924, `tests/bench-maillage.js`) : ~31 % de quads en
  moins en moyenne (134 873 contre 194 482), jusqu'à 96× sur une zone plate
  d'un seul bloc sans variante de texture (256 → 6-8 quads, cible ≥ 30×,
  SPEC-PERF-011), pour un temps de maillage inchangé (~51 ms/chunk, contre
  ~54 ms sans fusion — pas de régression de vitesse de construction).
  L'eau (ondes par sommet moyennées par colonne) et les formes non cubiques
  (plantes, escaliers/dalles/clôtures, panneaux) restent hors fusion, comme
  prévu par la spec. Les tuiles d'atlas qui se répètent sur un grand quad
  fusionné sont rendues par un `fract()` par fragment dans le shader
  (`src/render.js`, `avecAtlasRepete`, nouveaux attributs `uvBase`/`uvRep`)
  plutôt qu'étirées : sans mipmaps et avec `NearestFilter` (voir `atlas.js`),
  étirer aurait zoomé/flouté la texture au lieu de la répéter à l'identique.
- Génération de chunk environ 60 % plus rapide (~98-112 ms/chunk → ~44-45 ms/chunk
  mesurés sur 80 chunks en spirale, même graine) : le bruit 3D des grottes
  (`isCave`, src/world.js), qui pesait à lui seul plus des trois quarts du CPU
  de génération (`hash3` 66 %, `value3` 10 % au profilage), se calcule
  désormais sur une grille grossière (4 blocs en x/z, 8 en y) mise en cache et
  interpolée trilinéairement — même technique que la densité humaine
  (src/densite.js) qui avait déjà rendu les chunks de ville 12× plus rapides.
  Écart mesuré face au bruit exact : ~0,78 % des blocs creusables sur 40
  chunks, sous la tolérance de 2 % (SPEC-PERF-001/002/003). `value3`
  (src/noise.js) perd aussi sa fermeture allouée à chaque appel, pour un
  résultat inchangé au bit près.

### Ajouté (L48 — rendu)
- Le renderer se remet d'une perte de contexte GPU (`webglcontextlost`) :
  message à l'écran, rendu suspendu proprement, puis reconstruction des
  textures/matériaux/render targets et remaillage des chunks visibles à la
  restauration (SPEC-RENDU-001/002).
- Qualité adaptative (`src/qualite.js`, logique pure testable sous Node) :
  réfraction plafonnée en fréquence et limitée à l'eau proche, réfraction/
  antialias(*)/DPR qui cèdent en cascade sous un FPS p50 bas soutenu, DPR qui
  ne dépasse jamais le plafond des options d'affichage ni ne descend sous 1
  (SPEC-RENDU-003 à 008 ; (*) décision exposée mais sans bascule GPU réelle,
  voir SPECS.md). Le plancher 800×600 du tampon de rendu reste porté par le
  dimensionnement de l'hôte (SPEC-OPTION-008, autre lot).
- Détection d'un rendu logiciel (SwiftShader, llvmpipe…) via
  `WEBGL_debug_renderer_info`, palier de qualité bas au démarrage et
  avertissement au joueur, une seule fois (SPEC-RENDU-010/011).
- Mipmaps de l'atlas de textures en option, désactivés par défaut, sans
  reconstruction du renderer pour les activer (SPEC-RENDU-012).
- Panneau F3 (métriques : FPS/p50/p95, appels de dessin, triangles, ms
  génération/maillage, distance de vue) et `g.perf`, calculé en continu
  indépendamment de son affichage (SPEC-PERF-015/016).
### Ajouté (banc de test)
- Banc de test navigateur refondu (`tests/index.html`, `tests/banc-ui.js`,
  `tests/banc.css`) : menu de sélection type → domaine → groupe → test avec
  recherche, préréglages et compteur, sélection reflétée dans l'adresse
  (SPEC-BANC-007) ; disposition en quatre zones qui tient à 1280×800 et
  800×600 sans défilement de page — liste des tests effectués et résumé fixe
  à gauche, tests lents et en erreur en haut à droite, rendu 3D intégré en bas
  à droite (SPEC-BANC-008) ; progression en direct pour les tests unitaires
  (exécutés par lots entre deux `await`) comme pour les end-to-end, étapes et
  avancement affichés avant la fin de chaque test (SPEC-BANC-009) ; délai par
  test (60 s par défaut, surchargeable par fiche), le test dépassé est marqué
  « délai dépassé » avec son étape courante et la campagne continue
  (SPEC-BANC-010) ; captures d'image compressées au début, à chaque étape, à
  la fin et à l'échec de chaque test end-to-end, vignettes agrandissables
  (SPEC-BANC-011) ; métriques par test (images, images/s moyenne/min/p95, ms
  par image, appels de dessin, triangles, mémoire JS, assertions) et fiche
  quoi/pourquoi/attendu dépliable avec étapes, assertions, attendu/obtenu,
  message et pile d'appel (SPEC-BANC-012, SPEC-BANC-013) ; envoi du cahier de
  test à `POST /tests/resultats` en fin de campagne (ou à la fermeture de la
  page), avec repli en téléchargement local si le serveur ne répond pas
  (SPEC-BANC-014) ; nettoyage systématique en fin de test et de campagne —
  dialogues d'histoire, journal et écrans résiduels sont refermés
  (SPEC-BANC-016).
- `MC_DEBUG` (`src/debug.js`) : pilotage manuel ou par les tests du rendu
  intégré — téléporter, régler l'heure, la saison, la météo, la distance de
  vue, agrandir le rendu en plein panneau puis le réduire, capturer une image
  (SPEC-BANC-017) ; un panneau repliable dans le banc l'expose à la main, et
  il est aussi disponible dans le jeu (`window.MC_DEBUG`) à la console.
- `e2e(nom, fiche, fn)` accepte désormais une fiche facultative (quoi,
  pourquoi, attendu, délai), et `etape(libellé, n, total)` /
  `capture(libellé)` sont disponibles dans un test end-to-end pour détailler
  sa progression et illustrer son déroulé.
- Le rendu intégré du banc tourne dans une surface virtuelle à résolution
  fixe (800×600 minimum lisible, 1280×800 par défaut, ou 1600×900/1920×1080
  au choix dans le panneau `MC_DEBUG`), mise à l'échelle par CSS pour tenir
  dans le quart qui l'affiche : le jeu ne se croit plus dans une minuscule
  fenêtre (menus, HUD et échelle d'interface restent lisibles, quelle que
  soit la taille de la page). `g.tailleVue()` (`src/game.js`) donne la taille
  de référence de l'hôte du rendu, utilisée par l'échelle d'interface
  (SPEC-OPTION-007) à la place de la taille de la fenêtre.
- L'espace de rendu du jeu ne descend jamais sous 800×600, quel que soit
  l'hôte ou la façon de lancer le jeu (`index.html`, banc, ancien hôte
  réduit…) : `src/game.js` pose désormais une surface interne (`.mc-surface`)
  qui garde ce plancher et se réduit à l'échelle, centrée, rapport d'aspect
  conservé, si l'hôte est plus petit — rendu, HUD, menus et dialogues en
  profitent tous, puisqu'ils y vivent tous (SPEC-OPTION-008).
- Lien « Cahiers » vers `/tests/cahiers` dans l'en-tête du banc, et boutons
  d'export du cahier de la campagne (web, PDF, Word) à côté du lien du
  rapport en fin de campagne, masqués si la route correspondante n'existe
  pas sur le serveur.
- La page remplit toute la fenêtre quelle que soit sa taille (aucune largeur
  ni hauteur fixe) ; les tests lents sont signalés dans leur zone pendant
  qu'ils tournent, pas seulement une fois terminés ; le menu de sélection se
  referme automatiquement après « Lancer », « Tout », « Relancer les
  échecs » ou l'ouverture d'un test, d'un rapport ou d'une vignette, pour
  rendre toute sa hauteur à la liste des tests.

### Corrigé
- Les cahiers de test n'affichaient pas les captures d'écran du banc
  navigateur, ni dans le rapport ni dans les exports : les images arrivaient
  sous forme d'URL de données (`data:image/jpeg;base64,…`) et le serveur
  décodait le préfixe avec, écrivant des JPEG corrompus ; et chaque capture
  était rattachée à son test par son seul libellé d'étape (« début », « fin »),
  si bien que tous les tests pointaient vers les images du premier. Le préfixe
  est désormais retiré, et l'index envoyé par le banc fait foi (SPEC-BANC-011,
  SPEC-BANC-014) ; les exports web, PDF et Word intègrent ainsi chaque capture.
- Revue adversariale de la qualité adaptative et de la perte de contexte GPU
  (L48) : après une restauration de contexte WebGL (`webglcontextrestored`),
  redimensionner les cibles de réfraction (`setSize`) ou disposer une
  géométrie de chunk/InstancedMesh (arbres, silhouettes lointaines) créée
  AVANT la perte retombait sur l'ancien contexte GL capturé par les
  écouteurs internes de Three.js r128, levant ~200 avertissements console
  (« object does not belong to this context ») au premier remaillage massif.
  Les render targets de réfraction sont désormais recréées plutôt que
  redimensionnées, et chaque géométrie reconstructible porte le numéro de
  génération du contexte GL courant : on ne dispose jamais une géométrie
  d'une génération révolue, on abandonne juste la référence au ramasse-
  miettes (SPEC-RENDU-002). La carte d'ombres du soleil (FBO interne à
  Three.js) est abandonnée sans dispose à la restauration et se reconstruit
  seule au rendu suivant. Le même risque touchait aussi les maillages
  d'entités (mobs, figurants, joueurs distants) et les repères lumineux :
  contrairement aux chunks/arbres/silhouettes (rebâtis à chaque remaillage),
  ils sont créés une seule fois et peuvent survivre à une restauration sans
  jamais être reconstruits ; `libererEntite`/`syncReperes` portent désormais
  la même garde de génération.
- Revue adversariale du transport réseau (L44, sous-lot A1) : un budget
  anti-flood unique par connexion (30 msg/s) pouvait expulser à tort un
  joueur légitime — creuser en créatif avec casse instantanée envoie jusqu'à
  ~60 `BLOC`/s, et jusqu'à 4 joueurs locaux (écran partagé) se répartissaient
  le même budget sur la même connexion. Les budgets sont désormais par joueur
  local et par type de message (voir Sécurité ci-dessus), et un `BLOC` ignoré
  par l'anti-flood n'est plus un bloc fantôme : le client reçoit le rappel de
  l'état autoritaire.
- La sauvegarde synchrone de l'arrêt (`arreter()`) et des gestionnaires de
  panne écrivait dans le MÊME fichier `.tmp` que la sauvegarde périodique
  asynchrone : un arrêt pendant qu'une sauvegarde était en vol pouvait laisser
  un fichier temporaire tronqué au sol. Chaque mode a désormais son propre
  fichier temporaire, l'arrêt attend (avec un délai borné) qu'une sauvegarde
  asynchrone déjà en vol se termine, et tout `.tmp` résiduel d'un arrêt brutal
  est supprimé au démarrage suivant.
- Le popup du mode histoire gardait la souris capturée : la capture demandée au
  lancement arrivait après son ouverture, et il fallait quitter le navigateur
  pour pouvoir cliquer. La capture tardive est relâchée, et aucune reprise du jeu
  ne recapture la souris tant qu'une réplique attend (SPEC-HISTOIRE-014).
- Selon la résolution, les menus (options en tête) étaient rognés en haut et en
  bas, sans moyen de les atteindre : les écrans et l'inventaire défilent
  désormais verticalement et horizontalement, le haut restant toujours
  accessible (SPEC-OPTION-007).
- SPEC-ZONE-003 échouait en campagne e2e complète depuis le nouveau banc
  (mais pas isolément dans l'ancien testeur) : la boucle d'attente de
  l'annonce de zone guettait la sous-chaîne « PvP » n'importe où dans
  `document.body.textContent`, or le panneau de sélection du banc affiche en
  permanence des libellés de spec qui la contiennent déjà (« SPEC-ZONE — zones
  de jeu (PvP/PvE… ) »). La condition était donc déjà vraie avant la première
  image, la boucle n'attendait jamais réellement le tick où l'annonce paraît,
  et l'assertion suivante la ratait. Le test attend désormais le changement
  de l'indicateur de zone lui-même (`.zone-indicateur`), sans ambiguïté avec
  le reste de la page, et vérifie le texte de l'annonce dans son conteneur
  dédié (`.toasts`) plutôt que dans toute la page.
- SPEC-HISTOIRE-014 échouait de façon non déterministe en campagne e2e
  complète (jamais isolément) : `tests/e2e.js` simule le verrou de pointeur
  en redéfinissant `document.pointerLockElement`, mais n'empêchait pas les
  VRAIES API `canvas.requestPointerLock()`/`document.exitPointerLock()`
  appelées par `src/input.js` à chaque changement d'état — sous automatisation
  (Playwright/CDP), un octroi réel peut aboutir sans geste utilisateur,
  contrairement à un navigateur utilisé à la main. Un octroi tardif et
  asynchrone déclenchait alors un VRAI `pointerlockchange`, lu par
  `isLocked()` via le getter truqué (donc désynchronisé du vrai verrou), ce
  qui pouvait remettre le jeu en pause en pleine partie après un test qui
  enchaîne plusieurs changements d'état verrouillés (SPEC-HISTOIRE-009 juste
  avant, dans la campagne complète). Les vraies API sont désormais coupées
  une fois pour toutes dès le premier verrou simulé : seule `fakeLock` pilote
  `pointerLockElement` pendant les tests.
- Revue adversariale du greedy meshing (L47, sous-lot A3) : la passe d'ombre
  (`WebGLShadowMap`, Three r128) ignorait `uvBase`/`uvRep` — elle fabrique un
  `MeshDepthMaterial` générique qui ne copie jamais `onBeforeCompile` et lit
  l'attribut `uv` brut, jamais mis à l'échelle par le greedy meshing. Sur un
  grand quad fusionné (feuillage), l'alphaTest de l'ombre échantillonnait donc
  une seule tuile étirée au lieu du motif répété, faussant la silhouette de
  l'ombre (mesuré : jusqu'à 74 des 285 quads d'un cube 8×8×8 de feuilles
  fusionnés). `src/render.js` assigne désormais un `customDepthMaterial`
  partagé (`matDepthCutout`, `MeshDepthMaterial` + `RGBADepthPacking`) aux
  meshes cutout, avec la même répétition `fract()` (`avecAtlasRepete`) que le
  matériau visible. L'opaque n'a pas d'alphaTest : son ombre reste correcte
  sans matériau dédié.

## [0.3.0] - 2026-09-24
### Corrigé

- Les livres du monde ont de nouveau un titre et des pages : l'identifiant textuel d'un lieu faussait leur tirage.

- Génération des chunks autour des villes douze fois plus rapide (110 s → 9 s pour 49 chunks) : la densité humaine, demandée à chaque nœud de route pour les bornes de zones, est désormais mise en cache sur une grille de 16 blocs et interpolée ; la suite de tests passe de 543 s à 239 s.
### Ajouté

- Mobilier d'intérieur (SPEC-INTERIEUR-002) : lit (on y dort, la nuit passe, la
  réapparition s'y fixe), table, chaise, armoire, étagère, bibliothèque
  (conteneurs), tapis, lampe (source de lumière), vase, présentoir et socle
  (exposent un objet) — recettes, pose orientée selon le regard (comme les
  portes), boîtes de collision/maillage dédiées (`MC.Formes.boitesMeuble`).
- Livres et notes (SPEC-INTERIEUR-003, `src/livres.js`) : écriture (titre,
  pages), signature (auteur, devient définitif), lecture, et une fonction pure
  `livreDuMonde(graine, lieu)` pour générer les livres des bibliothèques de
  lieux. Le contenu d'une pile porte désormais des données arbitraires
  (`stack.data`, comme `dmg`) qui survivent à la sauvegarde et au passage dans
  un coffre/une bibliothèque.
- Distributeurs (SPEC-MECA-001) : branchés jusqu'à l'effet réel — sur front montant du signal, ils éjectent le premier objet de leur contenu (petit conteneur à 9 cases, ouvert d'un clic droit), en projectile pour une munition (flèche, galet…) ou en objet au sol sinon ; hors ligne (`game.js`) comme en ligne, où le serveur fait autorité sur le contenu (`NP.MSG.DISTRIB`) et l'éjection.
- Batteries (SPEC-MECA-003) : une batterie cassée garde son niveau d'énergie sur sa pile d'inventaire (nouveau champ générique `data` sur une pile, `MC.Inventory`) et le retrouve telle quelle une fois reposée ; conservé à la sauvegarde.
- Blocs de commande (SPEC-MECA-007) : stockent une commande (texte, `world.getCommande`/`setCommande`, sauvegardée), éditable via une petite invite — en créatif hors ligne, ou par un administrateur en ligne (panneau admin existant, action `bloc_commande`) — et l'exécutent sur front montant du signal via `MC.Commandes.executer` et le même routage d'actions que le chat (`/heure` seul routé côté serveur pour l'instant, sans joueur qui tape).
- Coffres piégés et surprises (SPEC-OBJET-005) : désormais semés dans les donjons et ruines générés (`src/donjons.js`, y compris la cité ancienne) — les coffres secondaires des donjons moyens/grands ont une chance d'être un coffre piégé ou un coffre surprise plutôt qu'un coffre ordinaire ; le trésor principal du gardien reste toujours garanti.
- Bijoux (SPEC-OBJET-003) : l'émeraude porte vraiment chance au butin (minage `C.dropsOf` et butin des créatures tuées, resserre le tirage aléatoire sans jamais toucher un drop déjà garanti) ; le diamant donne une vraie lumière portée qui suit chaque joueur local qui le porte (lumière ponctuelle dynamique dans `render.js`, moins coûteuse qu'une source posée sur le monde qui exigerait de remailler les chunks en continu).
- Foudre et feu (SPEC-CONSTR-007) : un éclair tombé près d'un joueur allume ce qu'il touche s'il est inflammable (le bloc frappé, sinon celui juste au-dessus), hors ligne et côté serveur — `MC.Feu.allumerParFoudre`.
- En ligne, la fusion de deux dalles en bloc plein (SPEC-CONSTR-002) est synchronisée aux autres joueurs : `player.js/useOn` distingue désormais la fusion (qui modifie la case VISÉE) de la pose ordinaire (case adjacente) par un résultat `'place-ici'`, et le serveur l'autorise explicitement (`blocAutorise`).
- Plusieurs plans reconnaissables par type de bâtiment généré : trois pour la maison (carrée, longère, en L avec une aile), au moins deux pour les autres (point info, banque, salon, magasin, artisan, marché, ferme, place, tour, immeuble), tirés procéduralement ; le gabarit suit la densité — maisons mitoyennes en ville, fermes en campagne, tours et immeubles réservés au cœur des mégapoles (SPEC-HABITAT-010).
- Toitures en pente faites d'escaliers orientés vers le faîtage, avec un faîtage en dalle (ou en bloc plein selon le matériau) qui s'ajuste à la largeur du toit ; les formes plates, dômes et chapeaux restent en blocs pleins là où le style l'exige (SPEC-CONSTR-003, `src/habitats.js` `toit`, cinquième champ d'état dans `l.blocs` rejoué par `world.js`/`setEtat`).

### Corrigé

- Cinq bâtisseurs (maison, point info, banque, salon, magasin) appelaient `corps(..., 'type', rot)` en confondant les paramètres `nom` et `rot` : la porte n'était jamais orientée selon la façade. Les appels passent maintenant `null` pour `nom` et `rot` au bon rang (SPEC-PORTE-001).

### Limites connues

- Coffres piégés/surprises : semés dans les donjons (dont la cité ancienne) ; les camps de bandits n'existent pas encore comme structure générée dans le code (seulement des factions politiques sans bâti propre), donc rien à y semer pour l'instant.
- Le contenu d'un distributeur en ligne (`NP.MSG.DISTRIB`) est envoyé au serveur à la fermeture de son interface, sans confirmation immédiate aux autres joueurs déjà en train de le regarder — même limite que les coffres et fourneaux, dont le contenu n'est pas du tout synchronisé entre joueurs en ligne (hors sujet de ce lot).
- Un bloc de commande en ligne ne routent que l'action `/heure` (avancer l'heure du monde) ; les autres actions du chat (`/faction`, `/rejoindre`…) n'ont pas de sens sans joueur qui tape et sont ignorées plutôt que mal simulées.
- Le plan « en L » de la maison pose l'aile secondaire en gros œuvre seul (pas de porte, pas d'accès intérieur direct depuis le corps principal) : purement une variation de silhouette, pas une pièce habitable de plus.

## [0.2.0] - 2026-09-24
### Ajouté

- Flore sous-marine diversifiée selon la profondeur, la température et la lumière : anémones, algues rouges et brunes, posidonies, gorgones pourpres, éponges, laminaires (MER-010).
- Récifs : frangeants au ras des côtes chaudes, barrières au large, atolls et lagons autour des îles volcaniques éteintes, sur un squelette de corail blanc (MER-011).
- Les commandes /faction s'appliquent : hors ligne à l'état de la partie (sauvegardé), en ligne sur le serveur qui fait foi ; « dire » ne parvient qu'aux membres de la faction principale ; deux membres d'une même faction ne se blessent pas en PvP.
- Escaliers, dalles, clôtures, murets, vitres et rambardes (L24, `src/formes.js`, `MC.Formes`) : un escalier existe pour chaque essence de planche, la pierre, le pavé, la brique, la brique de pierre, le grès et le grès taillé (et pour les matériaux de toiture tuiles/ardoise/chaume/feuilles tropicales/terre cuite ocre) ; posé, il s'oriente selon le regard, s'inverse sous un plafond, et ses angles intérieurs/extérieurs s'ajustent d'eux-mêmes à ses voisins, y compris à la casse (SPEC-CONSTR-001). Une dalle existe pour chaque matériau porteur d'escalier hors toiture ; elle se pose en moitié basse ou haute selon la face et la hauteur visées, et deux dalles complémentaires du même matériau fusionnent en bloc plein (SPEC-CONSTR-002). Clôtures (bois), murets (pavé), vitres (verre) et rambardes (brique de pierre) se raccordent d'eux-mêmes aux blocs pleins et à leur propre sorte, en angle comme en T (SPEC-CONSTR-004). On monte un escalier ou une dalle en marchant, sans sauter (marche franchissable de 0,5 bloc, `MC.Physics.move`).
- Tissu et cuir, sept matières d'armure (tissu, cuir, mailles, bronze, fer, or, diamant) en quatre pièces chacune — casque, plastron, jambières, bottes —, réduisant les dégâts encaissés selon la matière portée, s'usant à chaque coup et se réparant à l'établi ; visibles sur l'avatar (SPEC-OBJET-001).
- Cinq nouvelles armes de mêlée (dague, épée longue, hache de guerre, masse, lance) en quatre matières, plus l'arc long, l'arbalète lourde et la fronde (et ses galets), chacune avec sa portée, sa cadence, ses dégâts et son recul propres (SPEC-OBJET-002).
- Gemmes taillées et bijoux (anneaux, amulettes, diadèmes) portés dans un emplacement dédié, donnant résistance, vitesse, chance au butin ou lumière portée selon la gemme sertie ; recherchés par les marchands (SPEC-OBJET-003).
- Fromage, soupe de légumes, ragoût, tarte aux pommes, gâteau et baies ; la viande et le poisson mangés crus rendent parfois malade, un effet temporaire (SPEC-OBJET-004).
- Coffres piégés (flèches, explosion, alarme qui appelle des gardes, gaz) et coffres surprises (butin rare ou mimic hostile), désamorçables avec un kit dédié (SPEC-OBJET-005).
- L29 mécanismes (SPEC-MECA-002, 004, 005, 006, 008) : `src/circuits.js` (`MC.Circuits`), un moteur de circuits logiques et d'énergie — fils, portes OUI/NON/ET/OU/OU exclusif/NON-ET/NON-OU/NON-OU exclusif, répéteur à délai, bascule, compteur, comparateur, avec propagation par tics déterministe et détection de cycle instable ; générateurs (éolienne selon le vent de son altitude, roue hydraulique selon le courant, générateur thermique selon la lave voisine ou un combustible), câbles avec pertes, batteries bornées ; détecteurs (bouton, levier, plaque, présence, lumière, jour/nuit, météo, horloge, niveau d'eau) ; appareils qui s'arrêtent sans énergie (lampes avec lumière, portes/trappes motorisées, tapis, ascenseurs, alarmes) ; pistons (poussée jusqu'à douze blocs, collant qui tire) testés sur un petit monde réel ; permissions des blocs de commande. Simulation posée sur les blocs `circuit` des chunks chargés (`world.js`), sauvegardée avec leur état (SPEC-SAVE-017), et le serveur en ligne fait autorité (`server.js` diffuse ses changements comme pour l'eau). Pistons, portes/trappes motorisées et blocs de commande posables uniquement par un administrateur en ligne (`server.js`) ou en créatif hors ligne (`player.js`) sont branchés jusqu'au placement réel. Distributeurs (choix de l'objet) et blocs de commande (permissions) sont posés en tant que blocs mais leur effet plein (éjection réelle, exécution d'une commande stockée) et la conservation du niveau d'une batterie ramassée restent à câbler (SPEC-MECA-001, 003, 007 en ⏳ partielle).
- Verre teinté (7 couleurs), béton (poudre + eau, 7 couleurs), laine et terre cuite dans les teintes manquantes, avec les colorants noir (encre de calmar), blanc (poudre d'os) et gris (charbon) — SPEC-CONSTR-005.
- Marbre et poutres de chaque essence de bois, et le chaume : nouveaux matériaux de construction, avec leurs recettes ; marbre et ardoise apparaissent aussi naturellement en sous-sol — SPEC-CONSTR-006.
- Le feu : un bloc B.FEU qui prend aux matériaux inflammables (bois, feuillages, laine, chaume, foin…), se propage à un voisin, s'éteint dans l'eau ou sous la pluie, éclaire et fume ; foyer, cheminée et torches fument aussi, et la fumée dérive avec le vent de son altitude ; un briquet (silex et acier) ou la lave l'allument — SPEC-CONSTR-007.


### Modifié

- L'atlas de textures passe de 16×24 à 16×64 tuiles (1024), de quoi accueillir les blocs de L24, L25 et L29.

### Limites connues

- SPEC-CONSTR-003 (toitures en pente auto-ajustées) reste ⏳ : le mécanisme d'angle des escaliers s'y prêterait, mais les bâtiments générés (`habitats.js`) ne posent pas encore de toit à partir de ces nouvelles formes.
- En ligne, la fusion de deux dalles en bloc plein (SPEC-CONSTR-002) n'est pas encore synchronisée aux autres joueurs : le protocole de pose de bloc ne porte qu'une seule case par message, or la fusion modifie la case VISÉE plutôt que la case adjacente que ce message décrit. Fonctionne en solo et en écran partagé ; en ligne, seul l'auteur de la fusion la voit tant qu'il ne recharge pas le chunk.

## [0.1.0] - 2026-09-24
### Ajouté

- Les blocs se stockent désormais sur 16 bits (Uint16Array) partout où ils vivent — chunks, mailleur, lumière, sauvegardes, réseau, monde serveur — et l'espace d'ids sépare largement blocs (1..4095) et objets (4096+), levant la limite d'un octet (SPEC-SAVE-017).
- Un état par bloc (orientation, moitié haute/basse, forme d'angle, connexions, allumé/éteint, niveau d'énergie), stocké à côté des blocs, 0 par défaut : `world.getEtat`/`setEtat`, sauvegardé et transmis par le réseau (préparation de L24/L29, aucun nouveau bloc n'en tire encore parti).
- Versionnage encadré : Commits conventionnels vérifiés par un crochet commit-msg,
  journal obligatoire pour tout feat/fix/perf touchant au code, version modifiable
  seulement dans un commit de publication ; `tools/version.js --publier` calcule le
  cran d'après les commits depuis la dernière étiquette, date le journal, commite et
  étiquette ; crochet pre-commit (syntaxe, marqueurs de conflit, accord de version) ;
  porte G11.
- Zones de jeu (PvP + PvE, PvP seul, PvE seul, sûre) : carte déterministe qui suit la densité humaine et protège le point d'apparition, quatre politiques serveur (générée, tout PvE, tout sûr, tout PvP) et redéfinition d'une région par un administrateur (ZONE-001, 004).
- Les règles de zone s'appliquent partout, hors ligne comme en ligne : apparitions hostiles et dégâts des monstres refusés là où la zone l'interdit (ZONE-002).
- Zone courante affichée au HUD (masquable), entrée dans une zone annoncée (toast/chat), zones teintées sur la carte, frontières marquées par des bornes sur les routes et rappelées par les panneaux d'information (ZONE-003).
- PvP en ligne : un joueur en blesse un autre si le serveur l'autorise (`--pvp`) ET si la zone des deux le permet, mêmes armes/reculs/délais qu'en PvE ; le serveur fait foi et annonce qui a vaincu qui (COMBAT-002).
- Paramètre de lancement `--zone` (SPEC-ZONE-004) et validation générique des paramètres à choix fermé dans `src/parametres.js`.
- Banc de charge serveur (`tests/charge.js`) : simule sans rendu de 1 à 100 clients réels par paliers (protocole complet — déplacement, minage, pose, combat, chat), groupés ou répartis en zones distinctes, et mesure durée des tics (moyenne, p95), mémoire, débit réseau par client et latence des poses de bloc ; échoue si un seuil est dépassé. Instrumentation serveur légère et désactivable (`MC_MESURES=1`), exposée en lecture par la console d'administration (action `mesures`) (SERVEUR-002). Analyse et chiffres dans `docs/charge.md`.
- `--max-joueurs` accepte désormais jusqu'à 100 (au lieu de 64), pour couvrir le plus grand palier du banc de charge.
- `tests/integration-charge.js` : vérifie que le banc de charge fonctionne (deux paliers minuscules, quelques secondes).
- Factions PNJ autonomes (`src/politique.js`, `MC.Politique`) : royaumes des villes/mégapoles, guildes marchandes, ordres, bandits en zone vierge et cultes près des volcans naissent du monde de façon déterministe (graine + site), avec siège, territoire, ressources, caractère et objectifs ; simulation à gros grain par jour de jeu, rattrapable d'un bloc de façon déterministe (mêmes jours, même ordre = même état, en direct comme après rechargement) ; relations (alliance/neutralité/rivalité/guerre) qui évoluent et s'annoncent ; actions autonomes (caravanes, patrouilles, raids, avant-postes) qui déplacent les territoires ; quêtes simples selon les objectifs ; réputation du joueur (et de sa faction) envers chaque faction PNJ (FACTION-006, FACTION-007, FACTION-008).
- Factions de joueurs (`src/guildes.js`, `MC.Guildes`) : création (nom unique, couleur, emblème, devise), rangs (chef, officier, membre, recrue), nominations/promotion/rétrogradation/exclusion/transmission, dissolution automatique ; candidature, acceptation/refus, invitation, départ ; une faction principale et des secondaires multiples, changement de principale ; diplomatie (alliée/neutre/ennemie) envers d'autres factions de joueurs ou PNJ ; `peutBlesser(etat, a, b)` interdit les dégâts entre membres d'une même faction ; persistance aller-retour ; renommage/dissolution par un administrateur ou un modérateur via `MC.Admin` (FACTION-009 à FACTION-013).
- Commandes `/faction creer|postuler|accepter|refuser|inviter|rejoindre|quitter|nommer|promouvoir|retrograder|exclure|transmettre|dissoudre|principale|relation|dire|info` (`src/commandes.js`), et panneau Factions (touche J) enrichi des royaumes/factions du monde et de la faction du joueur (`src/ui.js`).
- Le serveur fait foi sur les deux systèmes : découverte des royaumes/guildes marchandes au fil des villes explorées, simulation politique avancée d'un jour de jeu à la fois avec annonces dans le chat, et persistance dans le fichier `--monde` comme dans la sauvegarde locale (`server.js`, `src/save.js`).

### Modifié

- Format de sauvegarde v3 (`MC.Save.VERSION`) : les objets d'inventaire d'une sauvegarde 8 bits (v1 ou v2) sont convertis vers le nouvel espace d'ids au chargement, sans perte ; un format inconnu est refusé proprement.
- Format du monde serveur (`--monde`) passé en v2 : une liste `etats` à part des overrides de bloc ; un fichier v1 (blocs seuls) reste lisible.
- Le protocole réseau accepte des ids de bloc jusqu'à 65535 (au lieu de 255) et transmet l'état d'un bloc posé.

### Corrigé

- Diffusion d'état périodique du serveur : la liste des « autres joueurs » envoyée à chaque client était la liste complète et non filtrée de tous les joueurs connectés (coût en O(joueurs²)), alors que les créatures étaient déjà bornées à 96 blocs. Elle l'est désormais aussi — trouvé et mesuré au banc de charge (SERVEUR-002).

### Limites connues

- SPEC-COMBAT-002 ne couvre que le PvP EN LIGNE : l'écran partagé local ne simule pas de combat entre joueurs locaux (le moteur d'entités hors ligne ne cible que le premier joueur de l'équipe), une limite préexistante non reprise dans cette tâche.
- Cultes et bandits ne naissent côté serveur que des sites qu'on lui fournit ; la découverte automatique ne couvre que villes et mégapoles.

## [0.0.86] - 2026-09-24
### Ajouté

- Caravanes marchandes (marchand et bêtes de bât, garde sur les grands axes), voyageurs et leur guide sur les routes de tourisme, bateaux entre les ports que relie l'eau ; leur position se déduit de l'heure, identique sur tous les postes sans rien échanger (ROUTE-006).

## [0.0.85] - 2026-09-24
### Ajouté

- Buissons (une à trois boules de feuillage de l'essence du lieu) et prairies fleuries en nappes de couleur dominante dans les plaines, savanes et forêts claires ; ils ploient au vent comme le reste de la végétation (VENT-004).

## [0.0.84] - 2026-09-24
### Ajouté

- Volcans actifs vivants : panache de fumée qui dérive avec le vent de son altitude, grondements, éruptions déterministes (les mêmes pour tous), bombes incandescentes, coulées de lave qui descendent la plus forte pente puis se figent en basalte (RELIEF-011).

## [0.0.83] - 2026-09-24
### Modifié

- README mis à jour : monde, temps, êtres, options, commandes, architecture, limites connues.

## [0.0.82] - 2026-09-24
### Ajouté

- Carte de densité humaine (vierge, rurale, urbaine, hyperurbaine) combinant bruit et habitabilité (eau, relief, climat, fertilité, volcans) ; les lieux en naissent, avec des transitions progressives (DENSITE-001, 002).
- Mégapoles de plus d'un kilomètre : tours, immeubles, avenues en grille, parcs, port (HABITAT-013).
- Hiérarchie des routes (grands axes, commerce, chemins ruraux, tourisme) et fleuves navigables avec quais et ponts (ROUTE-007, 008).

## [0.0.81] - 2026-09-24
### Ajouté

- Version empaquetée : archive portable avec lanceurs et préparation d'un exécutable Node SEA (tools/paquet.js) ; paramètres de lancement (--serveur, --port, --graine, --monde, --max-joueurs, --pvp, --liste-blanche, --admin) et aide automatique sur demande ou sur erreur, avec suggestion (PACK-001 à 003).
- Serveur dédié persistant : sauvegarde périodique et à l'arrêt, reprise au lancement (SERVEUR-001).
- Administration : console web protégée (joueurs, positions, IP, inventaires, journal des actions, sessions), listes blanche et noire (noms, e-mails), liens d'invitation, panneau admin en jeu (/admin), modérateurs aux droits restreints, confidentialité par rôle et journal d'administration (ADMIN-001 à 008).

### Limites connues

- Le journal des actions ne couvre pas encore coffres et échanges (pas encore arbitrés par le serveur).
- L'exécutable autonome demande l'outil postject pour sa dernière étape (commande affichée par tools/paquet.js).

## [0.0.80] - 2026-09-24

Première version numérotée : `Z` vaut le nombre de commits antérieurs (79)
plus celui-ci. Elle rassemble tout ce qui a été construit jusque-là.

### Ajouté

- Versionnage sémantique, ce journal, le script `tools/version.js` et la
  porte G10 (format de version, accord entre le jeu et le journal).
- Options d'affichage : GPU de calcul, résolutions de 800×600 à 4K, plein
  écran, choix de l'écran, vue étendue sur deux ou trois écrans côte à côte
  ou empilés (L41).
- Menu d'options : sensibilité, volume, champ de vision, distance de vue,
  rendu lointain, ombres ; touches remappables avec détection des conflits ;
  l'aide suit les touches en vigueur (L22).
- Créatures, habitants et avatars détaillés et animés : membres articulés,
  variantes par individu, vêtements et accessoires selon le métier, marche,
  course, nage, coups, regard, silhouette simple au loin (L19).
- Saisons : journée de 20 minutes, année de 3 heures en quatre saisons,
  durée du jour, températures, neige, feuillages, gel des lacs, cultures et
  naissances selon la saison (L23).
- Minerais (cuivre, étain, argent, lapis, émeraude, rubis, saphir, quartz,
  soufre, sel…), bronze et bijoux ; biomes souterrains (géodes, chambres
  magmatiques, grottes luxuriantes et englouties, abîme), leurs créatures,
  cités anciennes ; organismes bioluminescents (L35).
- Ambiance sonore complète et spatialisée : nappes d'environnement,
  créatures, actions selon la matière, interactions, événements (L36).
- Routes de commerce et de tourisme qui suivent le relief, ponts, panneaux
  et lampadaires ; répartition réaliste des lieux, quartiers et tailles des
  villes, fondations sur les pentes (L18).
- Donjons petits, moyens et grands : salles, couloirs, niveaux, gardes,
  sous-gardiens, butin croissant (L19).
- Vent par altitude, dérive des nuages par couche, cyclones et tornades,
  brume des creux (L16).
- Transitions entre biomes, continents et climats à l'échelle kilométrique,
  volcans en chaînes, éteints ou actifs, de plusieurs types (L17).
- Trois archétypes d'histoires procédurales (épopée, enquête, colonie) au
  choix à la création de partie (L21).
- Rendu lointain : imposteurs d'arbres, silhouettes des lieux, perspective
  atmosphérique, chunks lointains allégés, option de rendu réaliste (L20).
- Eau vivante : types d'eau (lac, mer, océan, rivière, écoulement, chute),
  vagues selon le courant et le vent, vagues de rivage, caustiques,
  réfraction, écoulement et seau (L15).
- Portes et trappes, succès, commandes du chat, HUD aux composants
  masquables, couverture de tests des interactions (L22, HUD).
- Lumière des blocs et du ciel propagée, ombres du soleil et des nuages,
  population qui se maintient (morts définitives, remplacements,
  reproduction des animaux) (L14).
- Auparavant : monde voxel de 128 blocs de haut, biomes, grottes, villes et
  villages, donjons et gardiens, faune terrestre, marine et volante,
  factions et réputation, véhicules, météo à cinq couches de nuages, carte
  et repères, mode histoire, écran partagé, multijoueur avec serveur faisant
  autorité, sauvegardes multiples.

### Spécifié (à venir)

- L24 construction fine et intérieurs, L25 objets, L29 mécanismes et
  électricité, L37 version empaquetée, serveur dédié et administration
  (modérateurs compris, banc de charge de 1 à 100 clients simulés), L38 densité, mégapoles et zones de jeu, L39
  factions autonomes et factions de joueurs, L40 blocs sur 16 bits.

[Non publié]: #
[0.6.0]: #
[0.5.0]: #
[0.4.0]: #
[0.3.0]: #
[0.2.0]: #
[0.1.0]: #
[0.0.86]: #
[0.0.85]: #
[0.0.84]: #
[0.0.83]: #
[0.0.82]: #
[0.0.81]: #
[0.0.80]: #
