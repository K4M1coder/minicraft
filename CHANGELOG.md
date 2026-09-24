# Journal des modifications

Toutes les évolutions notables de MiniCraft sont consignées ici.

Le format suit [Tenez un Changelog](https://keepachangelog.com/fr/1.1.0/) et
le projet adopte le [versionnage sémantique](https://semver.org/lang/fr/) :
`X.Y.Z`, chaque nombre ayant de 1 à 5 chiffres (jusqu'à `99999.99999.99999`).
Chaque tâche terminée (une spec ou un lot livré) fait monter au moins `Z` d'un cran (`node tools/version.js`) ; les commits intermédiaires consignent leurs changements sous « Non publié » sans monter la version ;
`Y` monte pour une fonctionnalité notable qui reste compatible, `X` pour ce
qui rompt la compatibilité (sauvegardes, protocole réseau). La version du jeu
(`MC.Core.VERSION_JEU`) est toujours celle de la dernière entrée publiée ; la
porte G10 le vérifie.

## [Non publié]
### Ajouté

- Factions PNJ autonomes (`src/politique.js`, `MC.Politique`) : royaumes des villes/mégapoles, guildes marchandes, ordres, bandits en zone vierge et cultes près des volcans naissent du monde de façon déterministe (graine + site), avec siège, territoire, ressources, caractère et objectifs ; simulation à gros grain par jour de jeu, rattrapable d'un bloc de façon déterministe (mêmes jours, même ordre = même état, en direct comme après rechargement) ; relations (alliance/neutralité/rivalité/guerre) qui évoluent et s'annoncent ; actions autonomes (caravanes, patrouilles, raids, avant-postes) qui déplacent les territoires ; quêtes simples selon les objectifs ; réputation du joueur (et de sa faction) envers chaque faction PNJ (FACTION-006, FACTION-007, FACTION-008).
- Factions de joueurs (`src/guildes.js`, `MC.Guildes`) : création (nom unique, couleur, emblème, devise), rangs (chef, officier, membre, recrue), nominations/promotion/rétrogradation/exclusion/transmission, dissolution automatique ; candidature, acceptation/refus, invitation, départ ; une faction principale et des secondaires multiples, changement de principale ; diplomatie (alliée/neutre/ennemie) envers d'autres factions de joueurs ou PNJ ; `peutBlesser(etat, a, b)` interdit les dégâts entre membres d'une même faction ; persistance aller-retour ; renommage/dissolution par un administrateur ou un modérateur via `MC.Admin` (FACTION-009 à FACTION-013).
- Commandes `/faction creer|postuler|accepter|refuser|inviter|rejoindre|quitter|nommer|promouvoir|retrograder|exclure|transmettre|dissoudre|principale|relation|dire|info` (`src/commandes.js`), et panneau Factions (touche J) enrichi des royaumes/factions du monde et de la faction du joueur (`src/ui.js`).
- Le serveur fait foi sur les deux systèmes : découverte des royaumes/guildes marchandes au fil des villes explorées, simulation politique avancée d'un jour de jeu à la fois avec annonces dans le chat, et persistance dans le fichier `--monde` comme dans la sauvegarde locale (`server.js`, `src/save.js`).

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
[0.0.86]: #
[0.0.85]: #
[0.0.84]: #
[0.0.83]: #
[0.0.82]: #
[0.0.81]: #
[0.0.80]: #
