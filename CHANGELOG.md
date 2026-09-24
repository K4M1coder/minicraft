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

### Corrigé
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
