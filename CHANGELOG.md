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

### Corrigé
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
