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

### Corrigé

- Diffusion d'état périodique du serveur : la liste des « autres joueurs » envoyée à chaque client était la liste complète et non filtrée de tous les joueurs connectés (coût en O(joueurs²)), alors que les créatures étaient déjà bornées à 96 blocs. Elle l'est désormais aussi — trouvé et mesuré au banc de charge (SERVEUR-002).

### Limites connues

- SPEC-COMBAT-002 ne couvre que le PvP EN LIGNE : l'écran partagé local ne simule pas de combat entre joueurs locaux (le moteur d'entités hors ligne ne cible que le premier joueur de l'équipe), une limite préexistante non reprise dans cette tâche.

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
