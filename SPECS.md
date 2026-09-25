# Spécifications — MiniCraft

Chaque ligne de tableau déclare **une** spec vérifiable, identifiée
`SPEC-<DOMAINE>-<NNN>`. La colonne « Vérification » dit ce qu'un test doit
observer : si on ne peut pas l'écrire, la spec est mal formulée.

Un test cite son identifiant dans son nom ou dans un commentaire adjacent.
`node tests/gates.js` vérifie que la couverture est totale dans les deux sens :
aucune spec orpheline (G1), aucun identifiant fantôme (G2).

**Colonne État** : ✅ la spec est implémentée et la porte G1 exige qu'un test la
cite ; ⏳ la spec est écrite mais pas encore implémentée, G1 l'ignore. Une spec
passe de ⏳ à ✅ dans le même commit que son implémentation — jamais avant.

---

## MODE — modes de jeu

| ID | Spec | Vérification  | État |
|---|---|---|---|
| SPEC-MODE-001 | Trois modes existent : `survie`, `creatif` et `histoire` | `Modes.MODES` contient exactement ces trois clés | ✅ |
| SPEC-MODE-002 | Un identifiant de mode inconnu retombe sur `survie` | `Modes.mode('nawak').id === 'survie'` | ✅ |
| SPEC-MODE-003 | En créatif le joueur vole, est invulnérable, et n'a pas faim | `regles('creatif',*)` : `vole`, `invulnerable` vrais, `faim` faux | ✅ |
| SPEC-MODE-004 | En créatif tout bloc cède instantanément, quel que soit l'outil | temps de minage nul y compris à main nue sur la pierre | ✅ |
| SPEC-MODE-005 | En créatif poser un bloc ne consomme pas la pile | la quantité en inventaire est inchangée après la pose | ✅ |
| SPEC-MODE-006 | En créatif les outils ne s'usent pas | `dmg` reste nul après minage et frappe | ✅ |
| SPEC-MODE-007 | En créatif le joueur ne subit aucun dégât | chute, noyade, famine et coups de mob laissent les PV au maximum | ✅ |
| SPEC-MODE-008 | En créatif aucun monstre n'apparaît, quelle que soit la difficulté | `regles('creatif','cauchemar').monstres` faux | ✅ |
| SPEC-MODE-009 | En survie toutes les contraintes restent actives | `regles('survie','facile')` : faim vraie, invulnérable faux | ✅ |
| SPEC-MODE-010 | Le mode est persisté et restitué au rechargement | aller-retour de sauvegarde conserve le mode | ✅ |

## DIFF — difficultés

| ID | Spec | Vérification  | État |
|---|---|---|---|
| SPEC-DIFF-001 | Quatre difficultés existent, ordonnées paisible < facile < difficile < cauchemar | `ORDRE_DIFFICULTES` et le champ `ordre` concordent | ✅ |
| SPEC-DIFF-002 | Un identifiant de difficulté inconnu retombe sur `facile` | `difficulte('nawak').id === 'facile'` | ✅ |
| SPEC-DIFF-003 | En paisible aucun monstre n'apparaît | `plafondsEntites` donne 0 zombie | ✅ |
| SPEC-DIFF-004 | En paisible les animaux et villageois apparaissent quand même | plafonds mouton et villageois non nuls | ✅ |
| SPEC-DIFF-005 | En paisible la famine ne retire jamais de PV | `degatsFamine` faux | ✅ |
| SPEC-DIFF-006 | Les dégâts de mob croissent strictement avec la difficulté | facile < difficile < cauchemar | ✅ |
| SPEC-DIFF-007 | Le plafond de monstres croît strictement avec la difficulté | facile < difficile < cauchemar | ✅ |
| SPEC-DIFF-008 | Seul le cauchemar active la mort définitive | `permadeath` vrai pour lui seul | ✅ |
| SPEC-DIFF-009 | Le créatif annule la mort définitive même en cauchemar | `regles('creatif','cauchemar').permadeath` faux | ✅ |
| SPEC-DIFF-010 | La régénération est plus rapide en paisible qu'en cauchemar | comparaison des multiplicateurs | ✅ |
| SPEC-DIFF-011 | La difficulté est persistée et restituée | aller-retour de sauvegarde | ✅ |
| SPEC-DIFF-012 | À la mort en cauchemar, la partie et sa carte sont supprimées du stockage | l'emplacement et sa clé de monde disparaissent | ✅ |
| SPEC-DIFF-013 | À la mort hors cauchemar, la partie est conservée | l'emplacement existe toujours | ✅ |

## SAVE — parties multiples et graine

| ID | Spec | Vérification  | État |
|---|---|---|---|
| SPEC-SAVE-001 | Plusieurs parties coexistent, chacune avec son identifiant | créer trois parties, les trois sont listées | ✅ |
| SPEC-SAVE-002 | La liste est triée par date de dernière utilisation décroissante | la partie modifiée en dernier arrive en tête | ✅ |
| SPEC-SAVE-003 | Chaque partie mémorise nom, mode, difficulté et graine | les métadonnées survivent à la relecture | ✅ |
| SPEC-SAVE-004 | Supprimer une partie retire ses métadonnées ET sa carte | les deux clés de stockage disparaissent | ✅ |
| SPEC-SAVE-005 | Supprimer une partie n'affecte pas les autres | les autres restent chargeables | ✅ |
| SPEC-SAVE-006 | Charger une partie jamais sauvegardée est signalé sans erreur | retour `vierge` vrai | ✅ |
| SPEC-SAVE-007 | Charger un identifiant inconnu renvoie `null` | pas d'exception | ✅ |
| SPEC-SAVE-008 | Une sauvegarde d'une autre version est rejetée | retour `null`, stockage intact | ✅ |
| SPEC-SAVE-009 | Une graine numérique saisie est conservée telle quelle | `graineDepuisTexte('42') === 42` | ✅ |
| SPEC-SAVE-010 | Une graine textuelle donne toujours le même entier | même texte → même entier, deux appels | ✅ |
| SPEC-SAVE-011 | Deux textes différents donnent des graines différentes | échantillon de mots, collisions nulles | ✅ |
| SPEC-SAVE-012 | Une graine vide déclenche un tirage aléatoire | `graineDepuisTexte('')` vaut `null`, la création tire une graine | ✅ |
| SPEC-SAVE-013 | Deux mondes de même graine produisent des chunks identiques | comparaison bloc à bloc | ✅ |
| SPEC-SAVE-014 | Deux mondes de graines différentes produisent des chunks différents | au moins un bloc diffère | ✅ |
| SPEC-SAVE-015 | Renommer une partie ne touche pas à sa carte | la carte reste identique après renommage | ✅ |
| SPEC-SAVE-016 | L'index reste léger : il ne contient aucune donnée de monde | taille de l'index bornée malgré une grande carte | ✅ |

## ARME — armes et projectiles

| ID | Spec | Vérification  | État |
|---|---|---|---|
| SPEC-ARME-001 | La laine se transforme en ficelle | recette informe reconnue, 4 ficelles | ✅ |
| SPEC-ARME-002 | L'arc se fabrique avec bâtons et ficelle | recette façonnée reconnue | ✅ |
| SPEC-ARME-003 | Les flèches se fabriquent par quatre | recette reconnue, quantité 4 | ✅ |
| SPEC-ARME-004 | Tirer consomme exactement une flèche | l'inventaire perd une unité | ✅ |
| SPEC-ARME-005 | Tirer sans flèche ne produit aucun projectile | aucune entité créée | ✅ |
| SPEC-ARME-006 | Le projectile part dans la direction du regard | direction alignée à moins de 1° | ✅ |
| SPEC-ARME-007 | Le projectile subit la gravité | sa trajectoire s'infléchit vers le bas | ✅ |
| SPEC-ARME-008 | Le projectile disparaît en touchant un bloc solide | l'entité est retirée à l'impact | ✅ |
| SPEC-ARME-009 | Le projectile blesse le premier mob touché | les PV du mob baissent, l'entité disparaît | ✅ |
| SPEC-ARME-010 | Le projectile ne blesse pas son tireur | traverser le tireur n'inflige rien | ✅ |
| SPEC-ARME-011 | Un projectile blesse davantage qu'un coup à main nue | comparaison de dégâts | ✅ |
| SPEC-ARME-012 | L'arc s'use à chaque tir et finit par se briser | après `durability` tirs, l'arc disparaît | ✅ |
| SPEC-ARME-013 | Un projectile expire après un temps borné | l'entité disparaît sans impact | ✅ |
| SPEC-ARME-014 | L'épée en fer blesse plus que l'épée en bois | comparaison de dégâts | ✅ |

## CHAT — messagerie

| ID | Spec | Vérification  | État |
|---|---|---|---|
| SPEC-CHAT-001 | Un message envoyé apparaît dans l'historique | l'historique contient le texte | ✅ |
| SPEC-CHAT-002 | L'historique est borné : les plus anciens sont oubliés | au-delà de la limite, la taille reste constante | ✅ |
| SPEC-CHAT-003 | Un message vide ou d'espaces est refusé | l'historique ne bouge pas | ✅ |
| SPEC-CHAT-004 | Un message trop long est tronqué, pas rejeté | longueur ramenée à la limite | ✅ |
| SPEC-CHAT-005 | Chaque message porte auteur et horodatage | champs présents | ✅ |
| SPEC-CHAT-006 | Les messages système sont distingués des messages de joueur | champ `type` différent | ✅ |
| SPEC-CHAT-007 | Le texte est neutralisé à l'affichage | `<script>` ressort échappé | ✅ |
| SPEC-CHAT-008 | Les messages récents sont consultables séparément | `recents(n)` renvoie les n derniers | ✅ |
| SPEC-CHAT-009 | Une commande `/` est reconnue comme telle | `estCommande` vrai, nom extrait | ✅ |
| SPEC-CHAT-010 | Ouvrir le chat suspend les entrées de déplacement | en saisie, les touches ne déplacent plus | ✅ |

## SPLIT — écran partagé

| ID | Spec | Vérification  | État |
|---|---|---|---|
| SPEC-SPLIT-001 | De 1 à 4 joueurs locaux sont acceptés | création valide pour 1, 2, 3 et 4 | ✅ |
| SPEC-SPLIT-002 | Au-delà de 4, la demande est bornée | 5 demandés → 4 créés | ✅ |
| SPEC-SPLIT-003 | À un joueur, la vue occupe tout l'écran | rectangle plein cadre | ✅ |
| SPEC-SPLIT-004 | À deux joueurs, deux bandes horizontales de hauteur égale | rectangles calculés | ✅ |
| SPEC-SPLIT-005 | À trois ou quatre joueurs, quatre quadrants | rectangles calculés, la 4e case reste vide à trois | ✅ |
| SPEC-SPLIT-006 | Les vues ne se chevauchent pas et couvrent tout le cadre | somme des aires égale l'aire totale | ✅ |
| SPEC-SPLIT-007 | Chaque joueur a son propre état, son inventaire et sa vie | modifier l'un ne change pas l'autre | ✅ |
| SPEC-SPLIT-008 | Chaque joueur a son propre HUD | autant de HUD que de joueurs | ✅ |
| SPEC-SPLIT-009 | Le joueur 1 utilise clavier et souris | source d'entrée `clavier` | ✅ |
| SPEC-SPLIT-010 | Les joueurs 2 à 4 utilisent une manette | source d'entrée `manette`, index croissant | ✅ |
| SPEC-SPLIT-011 | Le stick gauche déplace, le stick droit oriente | conversion en actions et en rotation | ✅ |
| SPEC-SPLIT-012 | La zone morte des sticks est appliquée | une poussée faible ne produit aucun mouvement | ✅ |
| SPEC-SPLIT-013 | Une manette débranchée met son joueur au repos | aucune action émise | ✅ |
| SPEC-SPLIT-014 | Les joueurs apparaissent au même endroit, sans se chevaucher | positions distinctes, aucune collision initiale | ✅ |
| SPEC-SPLIT-015 | La mort d'un joueur n'interrompt pas les autres | les autres continuent de se déplacer | ✅ |
| SPEC-SPLIT-016 | En cauchemar, la mort d'un seul joueur détruit la partie | l'emplacement disparaît | ✅ |

## NET — multijoueur client/serveur

| ID | Spec | Vérification  | État |
|---|---|---|---|
| SPEC-NET-001 | La poignée de main WebSocket calcule la clé d'acceptation | vecteur de test RFC 6455 | ✅ |
| SPEC-NET-002 | Une trame texte courte est encodée puis décodée à l'identique | aller-retour | ✅ |
| SPEC-NET-003 | Une trame de taille moyenne (126–65535) est gérée | aller-retour sur 1000 octets | ✅ |
| SPEC-NET-004 | Une trame client masquée est démasquée correctement | décodage avec clé de masque | ✅ |
| SPEC-NET-005 | Une trame de fermeture est reconnue | opcode 0x8 détecté | ✅ |
| SPEC-NET-006 | Un `ping` reçoit un `pong` | opcode 0x9 → 0xA | ✅ |
| SPEC-NET-007 | Les messages du protocole sont typés et validés | un message sans `t` est rejeté | ✅ |
| SPEC-NET-008 | Un message inconnu est ignoré sans planter | pas d'exception | ✅ |
| SPEC-NET-009 | À la connexion, le serveur transmet graine, mode, difficulté et heure | message `bienvenue` complet | ✅ |
| SPEC-NET-010 | Le serveur attribue un identifiant unique par joueur | deux connexions, deux identifiants | ✅ |
| SPEC-NET-011 | Une pose de bloc est appliquée puis diffusée à tous | l'état serveur change, les autres reçoivent | ✅ |
| SPEC-NET-012 | Le serveur fait autorité sur les blocs : un client désynchronisé est corrigé | l'état du serveur l'emporte | ✅ |
| SPEC-NET-013 | La position d'un joueur est relayée aux autres, pas à lui-même | l'émetteur ne se reçoit pas | ✅ |
| SPEC-NET-014 | Un message de chat est diffusé à tous, émetteur compris | tous reçoivent | ✅ |
| SPEC-NET-015 | La déconnexion retire le joueur de la liste et prévient les autres | message `quitte` | ✅ |
| SPEC-NET-016 | Le serveur simule les mobs et diffuse leurs positions | les clients reçoivent des positions | ✅ |
| SPEC-NET-017 | Le serveur fait autorité sur l'heure du monde | l'heure client suit celle du serveur | ✅ |
| SPEC-NET-018 | Un client qui rejoint reçoit l'état déjà modifié du monde | les blocs posés avant sa venue lui parviennent | ✅ |
| SPEC-NET-019 | Le serveur sert aussi les fichiers statiques | une requête HTTP sur index.html répond 200 | ✅ |
| SPEC-NET-020 | Le serveur refuse une requête hors de son répertoire | tentative de remontée de chemin rejetée | ✅ |
| SPEC-NET-021 | Les joueurs distants sont affichés avec leur nom | une entité par joueur distant | ✅ |
| SPEC-NET-026 | Le serveur fait autorité sur la position : une position imposée par le client est ignorée | le joueur ne se téléporte pas | ✅ |
| SPEC-NET-027 | Un bloc hors de portée est refusé, et le client reçoit le vrai contenu de la case | correction renvoyée à l'émetteur | ✅ |
| SPEC-NET-028 | Le serveur donne à chaque client la position et les statistiques qui font foi | position, vie et faim reçues | ✅ |
| SPEC-NET-029 | L'état est rafraîchi au moins 45 fois par seconde | comptage sur une seconde | ✅ |
| SPEC-NET-022 | Écran partagé et réseau se combinent | plusieurs joueurs locaux annoncés au serveur | ✅ |
| SPEC-NET-023 | La perte de connexion bascule en solo sans planter | le jeu continue, un message le signale | ✅ |
| SPEC-NET-030 | Se reconnecter aussitôt après une déconnexion fonctionne : la fermeture tardive de l'ancienne socket n'emporte pas la nouvelle | connexion, déconnexion, reconnexion immédiate, pose confirmée | ✅ |

## IA — orientation et déplacement des créatures

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-IA-001 | Une créature qui poursuit regarde vers sa cible | l'avant du maillage pointe vers le joueur, écart < 1° | ✅ |
| SPEC-IA-002 | Une créature qui erre regarde vers où elle avance | l'avant du maillage est aligné sur sa vitesse, écart < 1° | ✅ |
| SPEC-IA-003 | Une créature à l'arrêt conserve sa dernière orientation | le cap ne change pas quand la vitesse est nulle | ✅ |
| SPEC-IA-004 | Le cap suit le déplacement réel, pas l'intention | après avoir buté sur un mur, le cap correspond au mouvement effectif | ✅ |

## COLL — collisions entre créatures et joueurs

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-COLL-001 | Un joueur ne traverse pas une créature | avancer dans un mob laisse une distance minimale | ✅ |
| SPEC-COLL-002 | Une créature ne traverse pas un joueur | un zombie qui charge s'arrête au contact | ✅ |
| SPEC-COLL-003 | Deux créatures ne se superposent pas | deux mobs au même point se séparent | ✅ |
| SPEC-COLL-004 | La séparation est horizontale : on peut se tenir sur une créature | un mob sous un autre ne le repousse pas latéralement | ✅ |
| SPEC-COLL-005 | Les objets au sol et les projectiles ne repoussent personne | un objet au sol n'écarte pas le joueur | ✅ |
| SPEC-COLL-006 | La poussée est bornée : aucune projection violente | le déplacement induit par image reste sous une limite | ✅ |
| SPEC-COLL-007 | Un joueur mort ne bloque plus le passage | on traverse un joueur mort | ✅ |
| SPEC-COLL-008 | Une créature ne peut pas pousser un joueur à travers un mur | le joueur reste du bon côté du bloc | ✅ |

## NAGE — comportement dans l'eau

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-NAGE-001 | Une créature dans l'eau remonte vers la surface | son altitude augmente jusqu'à flotter | ✅ |
| SPEC-NAGE-002 | Une créature flotte à la surface sans osciller | après stabilisation, l'altitude varie peu | ✅ |
| SPEC-NAGE-003 | Une créature ne coule pas indéfiniment | la vitesse de descente est plafonnée | ✅ |
| SPEC-NAGE-004 | Une créature nage plus lentement qu'elle ne marche | distance parcourue moindre à durée égale | ✅ |
| SPEC-NAGE-005 | Une créature hostile poursuit encore en nageant | elle se rapproche du joueur dans l'eau | ✅ |
| SPEC-NAGE-006 | Un objet au sol coule au lieu de flotter | son altitude diminue dans l'eau | ✅ |
| SPEC-NAGE-007 | Une créature sortie de l'eau retrouve sa vitesse normale | la vitesse redevient celle de la marche | ✅ |
| SPEC-NAGE-008 | On se hisse hors de l'eau sur une berge jusqu'à deux blocs ; un mur plus haut ne se franchit pas | sortie réussie sur des berges de 0, 1 et 2 blocs | ✅ |

## GRILLE — table de craft

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-GRILLE-001 | La grille de craft de l'inventaire est 3×3 | neuf cases dans l'écran d'inventaire | ✅ |
| SPEC-GRILLE-002 | Toutes les recettes 3×3 sont réalisables depuis l'inventaire | une pioche se fabrique sans établi | ✅ |
| SPEC-GRILLE-003 | Le coffre est fabricable depuis l'inventaire | la recette du coffre est reconnue en 3×3 | ✅ |
| SPEC-GRILLE-004 | Fermer l'inventaire rend le contenu de la grille 3×3 | rien n'est perdu | ✅ |

## LIVRE — livre des recettes et des objets

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-LIVRE-001 | Le livre liste toutes les recettes du jeu | autant d'entrées que de recettes | ✅ |
| SPEC-LIVRE-002 | Chaque entrée indique les ingrédients et leur quantité | la liste des besoins est exacte | ✅ |
| SPEC-LIVRE-003 | Une recette réalisable avec l'inventaire est signalée | le drapeau de faisabilité est vrai | ✅ |
| SPEC-LIVRE-004 | Une recette non réalisable indique ce qui manque | la liste des manques est exacte | ✅ |
| SPEC-LIVRE-005 | Les recettes réalisables sont présentées en premier | tri stable, faisables en tête | ✅ |
| SPEC-LIVRE-006 | Le livre se filtre par nom d'objet | la recherche restreint la liste | ✅ |
| SPEC-LIVRE-007 | Choisir une recette remplit la grille de craft | la grille reflète le motif de la recette | ✅ |
| SPEC-LIVRE-008 | Le remplissage prélève les ingrédients de l'inventaire | les quantités baissent d'autant | ✅ |
| SPEC-LIVRE-009 | Une recette non réalisable ne remplit rien | l'inventaire reste intact | ✅ |
| SPEC-LIVRE-010 | En créatif, le livre donne tout objet du jeu directement | l'objet demandé arrive en inventaire | ✅ |
| SPEC-LIVRE-011 | En créatif, le livre liste blocs et objets séparément | deux catégories distinctes | ✅ |
| SPEC-LIVRE-012 | En survie, le livre des objets n'est pas accessible | seule la variante recettes s'ouvre | ✅ |

## MENU — interface de lancement

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-MENU-001 | Le menu liste les parties existantes avec nom, mode, difficulté et graine | une partie créée apparaît avec ses métadonnées | ✅ |
| SPEC-MENU-002 | Créer une partie permet de choisir nom, mode, difficulté, graine et nombre de joueurs | les cinq champs existent et sont pris en compte | ✅ |
| SPEC-MENU-003 | Une graine laissée vide est tirée au hasard | deux créations vides donnent deux graines différentes | ✅ |
| SPEC-MENU-004 | Une graine textuelle est convertie et affichée | le même mot donne la même graine affichée | ✅ |
| SPEC-MENU-005 | Charger une partie restitue son mode et sa difficulté | les règles appliquées correspondent aux métadonnées | ✅ |
| SPEC-MENU-006 | Supprimer une partie demande confirmation puis la retire de la liste | la partie disparaît de la liste | ✅ |
| SPEC-MENU-007 | Le nombre de joueurs locaux choisi est appliqué | l'équipe a la taille demandée | ✅ |
| SPEC-MENU-008 | L'écran multijoueur permet de saisir une adresse et un pseudo | les deux champs existent | ✅ |
| SPEC-MENU-009 | Le menu pause permet de sauvegarder et de revenir au menu | les deux actions sont offertes en cours de partie | ✅ |
| SPEC-MENU-010 | La graine de la partie en cours est consultable | elle est affichée dans le menu pause | ✅ |

## AUDIT — correctifs issus de la relecture

| ID | Spec | Vérification  | État |
|---|---|---|---|
| SPEC-AUDIT-001 | Démarrer une nouvelle partie vide le registre des sources de lumière | aucune torche fantôme dans le nouveau monde | ✅ |
| SPEC-AUDIT-002 | Retirer une entité libère sa géométrie **et** ses matériaux | compteur de matériaux non libérés à zéro | ✅ |
| SPEC-AUDIT-003 | Démarrer une nouvelle partie libère les ressources des entités vivantes | aucune ressource abandonnée | ✅ |
| SPEC-AUDIT-004 | Les blocs modifiés survivent au déchargement puis au rechargement d'un chunk | la construction est intacte après un aller-retour | ✅ |

## TERRAIN — streaming, maillage et collisions en déplacement

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-TERRAIN-001 | Générer un chunk invalide ses 8 voisins, diagonales comprises : l'occlusion ambiante des coins ne périme plus | le chunk central redevient sale quand sa diagonale arrive ; son maillage ne change plus ensuite | ✅ |
| SPEC-TERRAIN-002 | Un chunk n'est maillé qu'une fois ses 8 voisins chargés | `voisinsCharges` faux avec 4 voisins, vrai avec 8 | ✅ |
| SPEC-TERRAIN-003 | Modifier un bloc de coin invalide aussi le chunk en diagonale | la diagonale concernée est sale, l'opposée non | ✅ |
| SPEC-TERRAIN-004 | Le streaming suit chaque joueur local : aucun sol n'est déchargé sous un joueur | chunks voulus autour des deux centres ; `unloadLoin` épargne le chunk du joueur 2 | ✅ |
| SPEC-TERRAIN-005 | Une entité hors des chunks chargés est gelée au lieu de tomber dans le vide | position inchangée et entité conservée après 4 s de simulation | ✅ |
| SPEC-TERRAIN-006 | Les lumières d'un chunk déchargé quittent le registre et reviennent avec lui | torche absente après décharge, présente après recharge | ✅ |
| SPEC-TERRAIN-008 | Le joueur ne pousse jamais une créature dans un bloc | un mouton serré contre un mur ne le traverse pas | ✅ |
| SPEC-TERRAIN-007 | Créer ou charger une partie ne laisse aucun maillage de l'ancien monde dans la scène (blocs fantômes sans collision) | aucun maillage de terrain hors des chunks du monde courant | ✅ |

## BIOME — climat et relief

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-BIOME-001 | Dix-huit biomes existent — treize terrestres (plaines, forêt, désert, taïga, marais, montagnes, jungle, savane, badlands, pics glacés, île aux champignons, volcan, glacier) et cinq marins — et apparaissent tous | un échantillon de 6 km couvre les dix-huit | ✅ |
| SPEC-BIOME-002 | Biome et relief ne dépendent que de la graine | même graine, mêmes valeurs ; autre graine, autre carte | ✅ |
| SPEC-BIOME-003 | Hors des reliefs voulus (falaises, mesas, volcans, lacs), le relief reste continu aux frontières de biomes | pente entre colonnes voisines ≤ 5 blocs | ✅ |
| SPEC-BIOME-004 | Chaque biome a sa surface : grès sous le désert, neige en taïga, eau gelée dans le froid | comptage de blocs dans un chunk de chaque biome | ✅ |

## VEGE — végétation

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-VEGE-001 | Chaque biome porte ses essences : bouleau en forêt, sapin en taïga, cactus au désert | l'essence est présente dans des chunks du biome | ✅ |
| SPEC-VEGE-002 | La végétation basse se traverse, casse d'un coup et tombe quand on retire son sol | ni solide ni résistante ; une fleur tombe même adossée à un mur | ✅ |
| SPEC-VEGE-003 | Une plante ne pousse que sur un sol adapté | aucun buisson mort hors du sable | ✅ |
| SPEC-VEGE-004 | Toutes les essences donnent des planches ; trois sables donnent du grès | recettes vérifiées par le moteur de craft | ✅ |
| SPEC-VEGE-005 | Le cactus pique au contact, par petites touches | PV en baisse, bornée, sans chevaucher le bloc | ✅ |

## MOB — nouvelles créatures

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-MOB-001 | Squelette, araignée, momie, slime, loup, cochon et les quatre gardiens ont un gabarit cohérent | dimensions, vie et vitesse positives | ✅ |
| SPEC-MOB-002 | Le squelette tire des flèches balistiques quand il voit sa cible, jamais à travers un mur | tirs observés à découvert, aucun derrière un mur ; visée relevée | ✅ |
| SPEC-MOB-003 | L'araignée bondit sur sa proie à courte distance | impulsion verticale et horizontale vers la cible | ✅ |
| SPEC-MOB-004 | Le slime n'avance qu'en sautant | immobile entre deux sauts, puis bond vers la cible | ✅ |
| SPEC-MOB-005 | Le loup est neutre jusqu'à ce qu'on le frappe | aucune morsure avant, morsure après | ✅ |
| SPEC-MOB-006 | Le cochon donne du porc cru, que le four cuit | butin et recette de cuisson | ✅ |
| SPEC-MOB-007 | Les apparitions dépendent du biome | momies au désert la nuit, pas de zombie ; forêt pacifique le jour | ✅ |
| SPEC-MOB-008 | Un plafond global borne les monstres, tous types confondus | ≤ plafond après 3000 tentatives d'apparition | ✅ |
| SPEC-MOB-009 | Au jour, les morts-vivants brûlent, sauf à l'abri d'un donjon | squelette et momie disparaissent, le zombie du donjon et le loup restent | ✅ |

## DONJON — donjons et miniboss

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-DONJON-001 | Les donjons sont nombreux et ne dépendent que de la graine | ≥ 20 sur 2 km², identiques d'un monde à l'autre | ✅ |
| SPEC-DONJON-002 | Un donjon terrestre est sur la terre ferme, un donjon marin sous au moins quatre blocs d'eau ; aucun dans le socle | surfaces vérifiées pour chaque famille | ✅ |
| SPEC-DONJON-003 | La salle est close, éclairée de quatre torches, contient un coffre ; un escalier mène à la surface | inspection des blocs ; la salle est reconnue, le couloir non | ✅ |
| SPEC-DONJON-004 | Le gardien s'éveille une seule fois | un second appel ne crée rien tant qu'il vit | ✅ |
| SPEC-DONJON-005 | Onze gardiens, chacun sa capacité (renforts, bond, rafale, division, boules de neige, sortilèges, vol et feu, laser sous l'eau, noyés) et un trésor qui lui est propre ; renforts plafonnés | capacités déclarées ; invocations bornées et rattachées au donjon | ✅ |
| SPEC-DONJON-006 | Vaincre un gardien lâche l'épée runique et publie un événement unique ; il encaisse sans être projeté | butin, événement consommé une fois, recul réduit | ✅ |
| SPEC-DONJON-007 | Le slime colossal se divise en mourant | quatre petits slimes | ✅ |
| SPEC-DONJON-008 | Le coffre d'un donjon a un butin fixé par la graine, enrichi selon son type | même contenu d'un monde à l'autre ; or dans la pyramide, prismarine dans le monument ; rien pour un coffre ordinaire | ✅ |
| SPEC-DONJON-009 | Gardiens vaincus et coffres pillés survivent à la sauvegarde, et repartent de zéro en nouvelle partie | aller-retour de sauvegarde ; `reset` vide les deux | ✅ |
| SPEC-DONJON-011 | Le type de donjon dépend du biome, de l'altitude et de la profondeur : crypte, mine, pyramide, forteresse de glace, temple, hutte, citadelle, monument, épave | table de décision ; les neuf types existent dans le monde | ✅ |
| SPEC-DONJON-012 | Chaque type de donjon est jouable : un coffre, une salle, une entrée, et un gardien qui n'apparaît pas dans un mur | vérification sur le plan de chaque type | ✅ |
| SPEC-DONJON-010 | Chaque chunk pose sa part du donjon, quel que soit l'ordre de génération | blocs identiques pour deux ordres opposés | ✅ |

## MER — océans et flore marine

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-MER-001 | Le varech pousse en colonne dans les forêts de varech, sans crever la surface | présence et hauteur des colonnes | ✅ |
| SPEC-MER-002 | Le récif corallien se couvre de coraux, de gorgones et de cornichons lumineux | coraux dans un chunk de récif | ✅ |
| SPEC-MER-003 | Une plante marine compte comme de l'eau : on y nage, on s'y noie, aucune surface d'eau n'est dessinée contre elle | nage, noyade et occlusion | ✅ |
| SPEC-MER-004 | L'océan gelé a ses icebergs qui émergent | glace compacte au-dessus du niveau de la mer | ✅ |
| SPEC-MER-005 | Un poisson reste dans l'eau et s'asphyxie dehors | 20 s sans sortir ; perte de vie hors de l'eau | ✅ |
| SPEC-MER-006 | Le requin chasse un nageur, jamais qui reste au sec | rapprochement dans l'eau, immobile face au ponton | ✅ |
| SPEC-MER-007 | La méduse pique qui la frôle | dégâts au contact | ✅ |
| SPEC-MER-008 | Le noyé coule, marche au fond et remonte vers sa proie | descente puis vitesse ascendante | ✅ |
| SPEC-MER-009 | Cinq biomes marins, chacun avec son fond et sa faune ; une colonne immergée est marine | classement selon l'altitude | ✅ |

## FAUNE — oiseaux et apparitions par milieu

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-FAUNE-001 | Un oiseau vole au-dessus du relief sans jamais le toucher | 30 s de vol, aucune collision | ✅ |
| SPEC-FAUNE-002 | Devant un mur, un oiseau prend de la hauteur | vitesse verticale positive | ✅ |
| SPEC-FAUNE-003 | Chaque créature naît dans son milieu : faune marine dans l'eau, oiseaux en l'air | apparitions sur une côte | ✅ |
| SPEC-FAUNE-004 | Faune marine et oiseaux ont leurs propres plafonds | la mer pleine ne bloque ni le ciel ni la terre | ✅ |
| SPEC-FAUNE-005 | La wyverne tourne au-dessus de sa proie puis pique sur elle | vitesse verticale négative en piqué | ✅ |

## EQUIP — créatures armées

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-EQUIP-001 | Certaines créatures naissent armées ; pillards et vindicateurs toujours | tirage d'arme selon le type | ✅ |
| SPEC-EQUIP-002 | Une arme augmente les dégâts de son porteur | coup plus fort avec épée | ✅ |
| SPEC-EQUIP-003 | Un squelette armé d'une épée se bat au corps à corps | plus de tir ; l'arbalète reste une arme de tir | ✅ |
| SPEC-EQUIP-004 | Le pillard tire à l'arbalète | carreaux observés | ✅ |
| SPEC-EQUIP-005 | Une créature armée lâche parfois son arme | environ une fois sur dix | ✅ |

## VEHIC — véhicules

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-VEHIC-001 | Sept véhicules — bateau, moto, voiture, camion, avion, sous-marin, wagonnet —, chacun fabricable et posé depuis son objet | recettes, gabarits, pose | ✅ |
| SPEC-VEHIC-002 | La voiture accélère, braque et franchit une marche d'un bloc sans entrer dans le décor | distance, altitude, cap | ✅ |
| SPEC-VEHIC-003 | Le bateau flotte et file sur l'eau, se traîne à terre | ligne de flottaison, vitesses | ✅ |
| SPEC-VEHIC-004 | L'avion ne décolle qu'au-delà de sa vitesse de décollage, et redescend moteur coupé | altitude selon la vitesse | ✅ |
| SPEC-VEHIC-005 | Le sous-marin plonge et remonte sans crever la surface ; on y respire | profondeur ; cabine étanche | ✅ |
| SPEC-VEHIC-006 | On monte, on reste sur le siège, on descend à côté de l'engin | position du conducteur | ✅ |
| SPEC-VEHIC-007 | Le camion a une soute de 27 cases | inventaire embarqué | ✅ |
| SPEC-VEHIC-008 | Les véhicules et leur chargement survivent à la sauvegarde | aller-retour | ✅ |
| SPEC-VEHIC-009 | Un véhicule abandonné ralentit et retombe ; piloté, la boucle des créatures n'y touche pas | vitesse, altitude | ✅ |
| SPEC-VEHIC-011 | Le wagonnet suit les rails, prend les virages, s'arrête au bout de la voie et se traîne hors des rails | parcours d'une voie en L | ✅ |
| SPEC-VEHIC-010 | Détruit, un véhicule rend son objet ; il ne recule pas sous les coups | butin, recul nul | ✅ |

## RECETTE — recettes

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-RECETTE-001 | Au moins 75 recettes, chacune reconnue sans conflit de motif | chaque motif redonne sa sortie | ✅ |
| SPEC-RECETTE-002 | Une gamme d'outils en diamant, plus rapide que le fer ; seule elle récolte l'obsidienne | rang, vitesse, récolte | ✅ |
| SPEC-RECETTE-003 | La soupe rend son bol, la pomme dorée soigne même rassasié | inventaire et PV | ✅ |
| SPEC-RECETTE-004 | La poudre d'os fait mûrir une culture d'un coup | stade final atteint | ✅ |
| SPEC-RECETTE-005 | Le four cuit poisson et volaille, fond l'or, cuit l'argile ; tous les bois brûlent | résultats de cuisson | ✅ |
| SPEC-RECETTE-006 | On teint la laine et la terre cuite | laine bleue, terre cuite ocre | ✅ |

## BLOC — blocs à comportement propre

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-BLOC-001 | On grimpe aux échelles et aux lianes | altitude en avançant contre la paroi | ✅ |
| SPEC-BLOC-002 | Une toile d'araignée englue | distance parcourue réduite | ✅ |
| SPEC-BLOC-003 | Les rails se posent à plat | un quad au ras du sol | ✅ |

## MIGR — compatibilité des sauvegardes

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-MIGR-001 | Une sauvegarde d'avant les biomes se charge : ses objets sont convertis, ses blocs intacts | inventaire, coffre, fourneau convertis | ✅ |

## TEXTURE — textures

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-TEXTURE-001 | Les tuiles de terrain ont plusieurs variantes, choisies par la position du bloc, et les faces supérieures tournent : le sol ne répète pas un motif | variantes distinctes, stables, mélangées | ✅ |
| SPEC-TEXTURE-002 | Les coordonnées de texture restent à l'intérieur de leur tuile : aucune arête ne se souligne d'un pixel de la tuile voisine | marge d'un demi-texel sur toutes les rotations | ✅ |

## CIEL — ciel dynamique

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-CIEL-001 | Le soleil se lève à l'aube, culmine en journée, se couche au crépuscule ; la lune lui est opposée ; les étoiles ne brillent que la nuit | positions des astres selon l'heure | ✅ |
| SPEC-CIEL-002 | La lune passe par huit phases, une par jour | huit phases distinctes, cycle de huit jours | ✅ |

## RELIEF — reliefs remarquables

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-RELIEF-001 | Des volcans de basalte s'élèvent, un cratère plein de lave au sommet | lave au fond du cratère, sommet élevé, biome volcan sur les flancs | ✅ |
| SPEC-RELIEF-002 | Des lacs perchés au-dessus de la mer, à surface unique, gardent leur biome terrestre | niveau commun, eau générée | ✅ |
| SPEC-RELIEF-003 | Des falaises côtières et des escarpements coupent le relief | paroi d'au moins sept blocs | ✅ |
| SPEC-RELIEF-004 | Les hauteurs froides portent des glaciers de glace bleue, gardés par une forteresse ; aucun donjon dans un volcan | glace bleue générée ; type de donjon | ✅ |
| SPEC-RELIEF-005 | Grottes, cavernes et lacs de lave profonds creusent le sous-sol, jamais au ras du socle | vides souterrains, lave au fond | ✅ |
| SPEC-RELIEF-006 | Le monde monte à 128 blocs ; cinq couches de nuages étagées, d'épaisseur propre à leur nature (cumulus épais, cirrus sans épaisseur) : les trois basses sous les plus hauts sommets, qui les percent, les deux hautes au-dessus de tout relief | couches, épaisseurs, sommets rares et montagneux au-dessus de la troisième | ✅ |

## LAVE — lave et magma

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-LAVE-001 | La lave brûle joueur et créatures, englue, et détruit les objets qui y tombent | PV perdus, objet détruit, créature blessée | ✅ |
| SPEC-LAVE-002 | Lave, magma et lanternes marines luisent dans le noir ; le magma brûle au contact | passe lumineuse, source de lumière | ✅ |

## CARTE — carte et points de repère

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-CARTE-001 | On pose, suit et retire des points de repère ; la boussole donne leur cap et leur distance | ajout, recherche, direction, retrait | ✅ |
| SPEC-CARTE-002 | La carte ne montre que les chunks explorés, aux couleurs du terrain vu du ciel | tuiles révélées, couleurs, invalidation | ✅ |
| SPEC-CARTE-003 | Pixels de la carte et coordonnées du monde se correspondent exactement | aller-retour | ✅ |
| SPEC-CARTE-004 | La carte se fabrique, s'ouvre d'un clic droit, et repères comme exploration survivent à la sauvegarde | recette, ouverture, aller-retour | ✅ |

## FACTION — factions et réputation

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-FACTION-001 | Chaque créature appartient à un camp (village, pillards, morts-vivants, bêtes) ; les inimitiés sont réciproques | appartenances et relations | ✅ |
| SPEC-FACTION-002 | La réputation du joueur décide qui l'attaque | morts toujours hostiles, pillards amadouables, gardes pacifiques | ✅ |
| SPEC-FACTION-003 | Tuer un membre fâche son camp et réjouit ses ennemis ; un village hostile ne commerce plus | réputations, statuts, commerce | ✅ |
| SPEC-FACTION-004 | Les camps ennemis se combattent : un garde défend les villageois contre les morts | escarmouche simulée | ✅ |
| SPEC-FACTION-005 | Les réputations survivent à la sauvegarde et repartent de zéro en nouvelle partie | aller-retour, reset | ✅ |

## SYNC — serveur autoritaire et prédiction

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-SYNC-001 | Les touches voyagent sur six bits | encodage réciproque | ✅ |
| SPEC-SYNC-002 | Serveur et client calculent la même trajectoire à partir des mêmes entrées | positions identiques après 120 images passées par JSON | ✅ |
| SPEC-SYNC-003 | La réconciliation ne corrige que ce qui a divergé et garde les entrées non confirmées | écart nul si juste, correction sinon | ✅ |
| SPEC-SYNC-004 | Un client ne peut pas simuler plus de temps qu'il ne s'en écoule | budget de temps | ✅ |
| SPEC-SYNC-005 | Position et statistiques (vie, faim, air, mort) du serveur font foi | état envoyé et appliqué | ✅ |
| SPEC-SYNC-006 | Le protocole valide entrées, attaques, tirs, repas et renaissance, et borne chaque valeur | messages valides, bornés, ou refusés | ✅ |

## NUAGE — nuages dynamiques

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-NUAGE-001 | Les nuages se forment, se déforment, se dissipent et se rassemblent en bancs ; ils dérivent au vent, sans saut quand le vent tourne ; un ciel qui se couvre en porte plus | naissances et disparitions en un point, dérive continue, champ de rassemblement, couverture | ✅ |
| SPEC-NUAGE-002 | Un nuage ne traverse pas la roche : sa densité s'éteint là où le relief atteint son altitude ; un cumulus est bombé, un cirrus étiré | densité nulle contre la montagne, intacte au-dessus des vallées, dôme | ✅ |

## METEO — météo et température

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-METEO-001 | Grand soleil, clair, nuageux, couvert, pluie, orage et tempête s'enchaînent par transitions permises, en fondu, identiques sur tous les postes pour une même graine ; le vent a une direction et une force | chaîne de Markov, déterminisme, couverture continue | ✅ |
| SPEC-METEO-002 | La température dépend du climat, de l'altitude, de l'heure et du temps : sommets et pôles glacés, désert brûlant le jour et froid la nuit ; un ressenti en découle | températures comparées, ressentis | ✅ |
| SPEC-METEO-003 | Il pleut, ou il neige quand il gèle, là où les nuages se sont rassemblés ; jamais au désert ni par beau temps | formes et intensités de précipitation | ✅ |
| SPEC-METEO-004 | Les éclairs ne tombent que par orage ou tempête, aux mêmes instants et aux mêmes lieux pour tous les postes | éclairs pendant les orages, déterministes, lieu partagé | ✅ |
| SPEC-METEO-005 | La température ressentie tient compte des feux voisins (torche, lave) et de l'eau ; un froid mordant blesse peu à peu (jamais en paisible ni en créatif), une chaleur écrasante creuse la faim — le serveur l'applique en ligne | températures comparées, effets sur le corps | ✅ |
| SPEC-METEO-006 | La foudre blesse ce qui se tient à découvert à moins de trois blocs, pas ce qui s'abrite ; en ligne, le serveur en tire les dégâts | portée, abri, dégâts | ✅ |
| SPEC-METEO-007 | La pluie et la neige tombent en particules autour du joueur, poussées par le vent, et s'arrêtent aux toits ; la météo, la température et le vent s'affichent ; pluie, vent et tonnerre s'entendent | aucune goutte sous un toit, affichage, sons | ✅ |
| SPEC-METEO-008 | Un orage fait tomber des éclairs visibles, avec leur flash et leur tonnerre retardé par la distance | éclairs comptés pendant un orage | ✅ |

## VUE — distance de vue

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-VUE-001 | Au-delà des chunks, un relief simplifié (couleurs du terrain, neige, lave, eau) porte la vue à plus d'un kilomètre ; sa grille se remplit sur plusieurs images sans en figer aucune | remplissage progressif, fidélité des hauteurs, étendue, couleurs | ✅ |
| SPEC-VUE-002 | La distance de vue en vrais blocs s'allonge tant que l'image reste fluide et le chargement à jour, et recule dès que la fluidité se dégrade | réglage adaptatif et bornes | ✅ |

## LUMIERE — lumière des blocs

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-LUMIERE-001 | Une source répand sa lumière de proche en proche, un cran par bloc ; les blocs pleins l'arrêtent, le verre, le feuillage et l'eau la laissent passer | niveaux autour d'une torche, mur, verre | ✅ |
| SPEC-LUMIERE-002 | Aucune limite au nombre de sources : toutes éclairent, d'un chunk à l'autre, et le mailleur inscrit la lumière dans chaque sommet | 84 sources, lumière du chunk voisin, attribut par sommet | ✅ |
| SPEC-LUMIERE-003 | Poser ou retirer une source, ou un bloc qui ouvre ou ferme le passage à la lumière (ciel compris), recalcule les chunks à portée et eux seuls ; un lac de lave n'éclaire que par sa surface | chunks touchés, cache des sources | ✅ |

## HABITAT — habitations, villages et villes

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-HABITAT-001 | Des habitations isolées, des villages et des villes jalonnent le monde, au sec, sans se chevaucher, au même endroit pour une même graine | comptages, chevauchements, déterminisme | ✅ |
| SPEC-HABITAT-002 | Chaque biome a son style de construction (colombages, isbas, grès à toits plats, cases, pilotis, adobes, chalets, igloos, maisons-champignons) et les villes leur variante urbaine (rues pavées, brique, enduits) | styles, formes de toit, variante urbaine | ✅ |
| SPEC-HABITAT-003 | Villes et villages comptent point info, salons, magasins, artisans (forgeron, menuisier, tisserand), marché, fermes et loisirs — la banque est affaire de ville ; chaque bâtiment qui sert a son habitant, son métier, ses répliques et ses offres ; une maison isolée abrite un ermite | programmes et métiers | ✅ |
| SPEC-HABITAT-004 | Un lieu se pose dans ses chunks : terrain nivelé et dégagé, rues, bâtiments meublés (coffres-forts de la banque…), lampadaires par centaines ; on sait dans quel lieu et quel bâtiment on se trouve | chunks générés, plateforme, lanternes, lieu et bâtiment | ✅ |
| SPEC-HABITAT-005 | Les métiers rendent service : le guide indique et marque sur la carte les lieux alentour, le banquier ouvre le compte, l'aubergiste loge (et fait dormir jusqu'au matin), le forgeron répare, l'animateur divertit ; les habitants tués ne renaissent pas aussitôt | services, coûts, délais, habitants manquants | ✅ |
| SPEC-HABITAT-006 | Le compte en banque, commun à toutes les banques, survit à la sauvegarde ; de nouveaux blocs de construction (planches d'essences, tuiles, ardoise, enduit, pavé, comptoir, coffre-fort, tonneau, enclume, panneau d'information) se fabriquent | aller-retour de sauvegarde, recettes | ✅ |
| SPEC-HABITAT-007 | En jeu, les habitants d'un lieu apparaissent quand on s'en approche, restent près de leur bâtiment, et parler à l'un d'eux ouvre son dialogue : son métier, sa réplique, ses offres et son service | visite d'un village, dialogue du guide | ✅ |

## HISTOIRE — mode histoire

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-HISTOIRE-001 | Un mode histoire, « La Couronne des Saisons », aux paramètres ajustables : héros, longueur de la quête principale (4, 7 ou 8 chapitres, plus de vingt étapes), nombre de quêtes secondaires, événements, commerce, repère automatique | règles et paramètres | ✅ |
| SPEC-HISTOIRE-002 | On n'interagit qu'avec les blocs et objets que l'histoire permet : préréglages (restreinte, modérée, libre) ou catégories choisies une à une ; le joueur ne casse, ne pose ni n'utilise rien d'autre | permissions, minage et pose refusés | ✅ |
| SPEC-HISTOIRE-003 | L'histoire se lie aux lieux réels du monde : village de départ, ville, ermite, trois donjons distincts, du plus proche au plus lointain | liens d'un monde généré | ✅ |
| SPEC-HISTOIRE-004 | La quête principale se joue du début à la fin, chapitre après chapitre, avec dialogues, récompenses et journal ; une étape impossible (interaction interdite, lieu absent) est sautée sans bloquer le récit | partie simulée complète | ✅ |
| SPEC-HISTOIRE-005 | Les habitants confient des quêtes secondaires selon leur métier, accomplies en rapportant ce qu'ils demandent ou en explorant, et récompensées ; leur nombre suit le paramètre et les interactions permises | proposer, accepter, rendre | ✅ |
| SPEC-HISTOIRE-006 | Des événements ponctuent l'aventure (Nuit de sang, pillards sur le village de départ, orage prophétique au vrai temps d'orage, caravane, voyageur) ; désactivables ; une défense ratée laisse sa trace | événements déclenchés, échec retenu | ✅ |
| SPEC-HISTOIRE-007 | Les objectifs atteints et les choix faits décident de la fin : six épilogues (secrète, aube, cendres, souverain, monde brisé, légende oubliée) | fins obtenues selon les parcours | ✅ |
| SPEC-HISTOIRE-008 | L'avancée du récit (chapitre, étape, choix, quêtes) survit à la sauvegarde | aller-retour | ✅ |
| SPEC-HISTOIRE-009 | En jeu, le récit s'affiche en dialogues, l'objectif et son repère guident, parler aux bons habitants fait avancer l'histoire, et H ouvre le journal | partie histoire pilotée | ✅ |

## L14 — lumière du ciel, ombres, population

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-LUMIERE-004 | La lumière du ciel descend dans chaque colonne jusqu'au premier bloc opaque, puis se répand de proche en proche : une grotte fermée est noire, un surplomb reste dans la pénombre | niveaux de ciel en plein air, sous un surplomb, dans une grotte close | ✅ |
| SPEC-LUMIERE-005 | Lumière du ciel et lumière des blocs se combinent par sommet : le jour le ciel domine dehors, la nuit seules les sources éclairent ; une grotte reste sombre de jour, sauf près de ses torches | attributs par sommet, formule de combinaison | ✅ |
| SPEC-LUMIERE-006 | Créatures et objets prennent la lumière de la case qu'ils occupent (ciel et blocs) | éclairage d'une entité dehors, dans une grotte, près d'une torche | ✅ |
| SPEC-OMBRE-001 | Le soleil, ou la lune la nuit, projette des ombres nettes à courte distance, dans des cadres (cascades) qui suivent la caméra, calés sur les texels et orientés selon l'astre ; au-delà du cadre proche, l'ombrage du relief prend le relais | cadres des cascades selon la direction de l'astre | ✅ |
| SPEC-OMBRE-002 | Au loin, le relief s'ombre lui-même selon la hauteur du soleil : versants à contre-jour et vallées encaissées s'assombrissent au couchant | ombrage du relief lointain selon le soleil | ✅ |
| SPEC-OMBRE-003 | Les nuages projettent au sol leur ombre, décalée selon la direction du soleil, et elle se déplace avec eux | ombre au sol sous un nuage dense, décalage, dérive | ✅ |
| SPEC-POP-001 | Un habitant tué reste mort, hors ligne comme en ligne : la sauvegarde ou le serveur le retient, il ne réapparaît pas au chargement | mort sauvegardée, rechargée ; serveur | ✅ |
| SPEC-POP-002 | Un lieu en sous-effectif accueille avec le temps de nouveaux habitants (naissances, arrivées), jusqu'à sa capacité | repeuplement progressif jusqu'à la capacité | ✅ |
| SPEC-POP-003 | Deux animaux de même espèce proches l'un de l'autre engendrent un petit tant que la population alentour reste sous son plafond ; le petit grandit | naissances, plafond, croissance | ✅ |

## L15 — eau

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-EAU-001 | L'eau se classe en écoulement, chute, rivière, lac, mer et océan, selon sa génération et sa situation | classement de colonnes connues | ✅ |
| SPEC-EAU-002 | Chaque type ondule à sa façon (amplitude, longueur d'onde, vitesse, écume) : clapot du lac, houle de l'océan, courant de la rivière, rideau de la chute | paramètres distincts par type, attributs par sommet | ✅ |
| SPEC-EAU-003 | Le sens des ondulations mêle le sens de l'écoulement et le vent : pur courant dans une chute, surtout le vent sur un lac, un mélange sur une rivière | direction résultante selon le type | ✅ |
| SPEC-EAU-004 | Des rivières naissent en altitude et descendent jusqu'à la mer ou un lac en creusant leur lit ; là où elles décrochent, une cascade | tracé descendant, lit creusé, cascades | ✅ |
| SPEC-EAU-005 | L'eau posée ou libérée s'écoule : elle descend, s'étale sur sept blocs au plus en s'amenuisant, et se retire quand sa source disparaît | simulation d'écoulement | ✅ |
| SPEC-EAU-006 | Près des rivages, les vagues se dressent en approchant de la côte (amplitude qui croît quand le fond remonte), déferlent en écume sur la ligne du rivage et courent vers la plage | profondeur et direction du rivage par colonne, amplitude et écume selon la profondeur | ✅ |
| SPEC-EAU-007 | Sous l'eau, la lumière est dynamique : des caustiques animées dansent sur le fond et les parois immergées, la lumière du soleil s'atténue et bleuit avec la profondeur | attribut d'immersion par sommet, atténuation selon la profondeur | ✅ |
| SPEC-EAU-008 | La surface de l'eau déforme ce qu'on voit à travers elle : vu du dessus, le fond ondule par réfraction ; vu de dessous, le monde au-dessus et tout le champ de vision ondulent | passe de réfraction et déformation sous l'eau | ✅ |

## L16 — vent

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-VENT-001 | Le vent varie avec l'altitude : sa direction tourne et sa force croît en montant, avec des rafales ; chaque couche de nuages, la brume, la pluie et la neige suivent le vent de leur altitude ; le vent est le même pour tous les postes | vent à plusieurs altitudes, rafales, dérive par couche, déterminisme | ✅ |
| SPEC-VENT-002 | Herbes, fleurs, cultures, buissons et feuillages ondulent au vent : sommet mobile, pied fixe, selon le vent au sol ; les blocs pleins ne bougent pas | souplesse par sommet | ✅ |
| SPEC-VENT-003 | Des bancs de brume se forment dans les vallées et au-dessus de l'eau le matin et par temps humide, et dérivent avec le vent de surface | densité de brume selon l'heure, l'humidité, le relief ; dérive | ✅ |
| SPEC-VENT-004 | Buissons et prairies fleuries couvrent plaines, savanes et forêts claires | buissons et fleurs générés | ✅ |
| SPEC-NUAGE-003 | Des cyclones naissent sur les mers chaudes et humides quand le vent s'y prête : une vaste spirale de nuages autour d'un œil calme, qui tourne, se déplace avec le vent dominant, apporte vents violents et pluies, et s'affaiblit en touchant terre ou des eaux froides ; comme la météo, ils sont les mêmes pour tous les postes (fonction de la graine et de l'heure) | naissance selon température, humidité et vent ; spirale, œil, trajectoire, affaiblissement ; déterminisme | ✅ |
| SPEC-NUAGE-004 | Des tornades se forment sous les orages quand la chaleur, l'humidité et le cisaillement du vent (entre le sol et les nuages) sont réunis : un entonnoir qui descend du nuage, se déplace, soulève et projette créatures, joueurs et objets au sol, arrache feuillage et plantes, puis se dissipe ; mêmes tornades pour tous les postes, dégâts appliqués par le serveur en ligne | conditions de formation, trajectoire, poussée, dégâts, durée de vie, déterminisme | ✅ |

## L17 — relief

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-BIOME-005 | Aux frontières, surfaces, végétation et climat se mêlent sur une large bande : on passe d'un biome à l'autre progressivement, sans ligne nette | mélange des surfaces dans la bande de transition | ✅ |
| SPEC-BIOME-006 | Le paysage est vaste : continents, chaînes de montagnes et bassins s'étendent sur plusieurs kilomètres | tailles des structures du relief | ✅ |
| SPEC-BIOME-007 | Les climats forment de grandes régions cohérentes, sur des milliers de blocs : on ne passe pas d'un désert à une banquise en cent mètres ; froid et chaud, sec et humide s'ordonnent en gradients | distances entre biomes incompatibles | ✅ |
| SPEC-RELIEF-007 | Un volcan se dresse sur une montagne ou une chaîne, jamais au milieu d'une plaine | position des volcans | ✅ |
| SPEC-RELIEF-008 | Des volcans s'alignent parfois en chaîne le long d'une crête | chaînes de volcans | ✅ |
| SPEC-RELIEF-009 | Des volcans sont éteints : sans lave, leur cratère porte un lac ou de l'herbe | volcans éteints | ✅ |
| SPEC-RELIEF-010 | Plusieurs types de volcans : stratovolcan élancé, volcan bouclier large et plat, caldeira effondrée | profils distincts | ✅ |
| SPEC-RELIEF-011 | Un volcan actif fume ; de temps à autre il gronde et crache des projectiles incandescents, la lave déborde de son cratère puis se fige en basalte | panache, éruptions, coulées qui se figent | ✅ |

## L18 — peuplement et routes

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-HABITAT-008 | Les lieux suivent l'habitabilité à des échelles réalistes : villes au bord de l'eau ou en plaine, espacées de plusieurs kilomètres ; villages autour, fermes et hameaux dans les campagnes ; montagnes et déserts presque vides | densités et distances par région | ✅ |
| SPEC-HABITAT-009 | Les bâtiments s'adaptent au relief — fondations ou pilotis sur la pente — ou l'évitent quand elle est trop forte ; le terrain n'est plus arasé en bloc | fondations, parcelles sur pente | ✅ |
| SPEC-ROUTE-001 | Des routes de commerce relient chaque ville à ses voisines et aux villages alentour | graphe des routes | ✅ |
| SPEC-ROUTE-002 | Une route suit le relief sans marche de plus d'un bloc, et contourne ce qui est trop raide | pentes le long des tracés | ✅ |
| SPEC-ROUTE-003 | Une route franchit l'eau et les ravins par des ponts | ponts générés | ✅ |
| SPEC-ROUTE-004 | Des routes touristiques mènent des villes aux sites remarquables (volcans, lacs, sommets) | tracés vers les sites | ✅ |
| SPEC-ROUTE-005 | Aux carrefours, des panneaux indiquent le nom et la distance des lieux ; aux abords des villes, les routes sont éclairées | panneaux, lampadaires | ✅ |
| SPEC-ROUTE-006 | Des caravanes marchandes et des voyageurs circulent sur les routes de commerce et de tourisme, et des bateaux sur les rivières navigables et le long des côtes, entre les ports | déplacements le long des tracés et des voies d'eau | ✅ |

## L19 — identités procédurales

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-HABITAT-010 | Chaque type de bâtiment a plusieurs plans reconnaissables (trois pour la maison, deux au moins pour les autres), agencés procéduralement, et son gabarit suit la densité : fermes et granges en campagne, maisons de ville mitoyennes en ville, immeubles et tours dans les centres des mégapoles ; deux bâtiments du même type diffèrent | variantes, signatures, gabarit selon la densité | ✅ |
| SPEC-HABITAT-011 | Chaque variante, dans chaque style compatible, à chaque densité et à plusieurs endroits, est habitable : porte dégagée, intérieur libre, lumière, habitant à l'intérieur, rien ne flotte ni ne déborde ; les tours ont escaliers ou échelles jusqu'au sommet | vérification de toutes les variantes | ✅ |
| SPEC-HABITAT-012 | Les villes ont des quartiers cohérents (centre commerçant, quartiers résidentiels, faubourgs agricoles) et leur taille varie de la petite ville à la grande cité | quartiers et tailles | ✅ |
| SPEC-DONJON-013 | Les donjons moyens et grands comptent plusieurs salles reliées par des couloirs, les grands plusieurs niveaux reliés par des escaliers ; toute salle est atteignable depuis l'entrée, le gardien se tient au plus profond, et des gardes peuplent les autres salles | graphe de salles, niveaux, connexité depuis l'entrée, gardien au plus profond | ✅ |
| SPEC-DONJON-014 | Chaque type de donjon a son identité (plan, matériaux, décor) et des variantes procédurales : deux donjons du même type diffèrent | signatures par type, variantes | ✅ |
| SPEC-DONJON-015 | Les donjons ont trois tailles : petits (les donjons actuels, une salle et son accès), moyens (plusieurs salles sur un niveau), grands (plusieurs niveaux et une dizaine de salles ou plus) | taille, nombre de salles et de niveaux par catégorie | ✅ |
| SPEC-DONJON-016 | La taille dépend du lieu et de la rareté (les grands sont rares et demandent de la place en profondeur ou en surface) ; elle fait croître la difficulté (gardes, sous-gardiens) et le butin | répartition des tailles, gardes et butins selon la taille | ✅ |
| SPEC-MOB-010 | Chaque créature, chaque habitant et chaque avatar de joueur a plusieurs variantes d'apparence (tailles, couleurs, vêtements selon le métier, accessoires) et un modèle détaillé (tête, corps, membres), animé : marche, course, nage, attaque, regard vers sa cible ; au loin, un modèle simplifié le remplace | variantes, parties, animations, niveau de détail selon la distance | ✅ |

## L20 — rendu lointain

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-VUE-003 | Au-delà des chunks, les forêts apparaissent en imposteurs d'arbres selon la densité et l'essence du biome | imposteurs par densité | ✅ |
| SPEC-VUE-004 | Villes et villages se voient de loin en silhouettes, éclairées la nuit | silhouettes des lieux | ✅ |
| SPEC-VUE-005 | Une perspective atmosphérique commune bleuit et éclaircit ce qui s'éloigne, sans rupture entre vrais blocs et relief lointain | même fonction de couleur par distance | ✅ |
| SPEC-VUE-006 | Une option « rendu réaliste lointain » active imposteurs, ombres lointaines et perspective atmosphérique | option et effets | ✅ |
| SPEC-VUE-007 | Les chunks lointains encore affichés en vrais blocs passent à un maillage simplifié (moins de faces) sans saut visible, pour allonger la distance à fréquence d'images égale | niveaux de détail des chunks | ✅ |

## L21 — histoires procédurales

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-HISTOIRE-010 | Trois archétypes très différents : épopée (quête des gemmes), enquête (un crime à élucider), colonie (fonder et défendre un établissement), au choix à la création | trois archétypes jouables | ✅ |
| SPEC-HISTOIRE-011 | Chaque histoire est générée depuis la graine : lieux, personnages, indices, ennemis et rebondissements changent d'une partie à l'autre, et la même graine redonne la même histoire | déterminisme et variété | ✅ |
| SPEC-HISTOIRE-012 | L'enquête : des suspects aux alibis, des indices à trouver, un coupable à désigner ; la fin dépend de l'accusation et des indices réunis | enquête jouée jusqu'à ses fins | ✅ |
| SPEC-HISTOIRE-013 | La colonie : bâtir les bâtiments requis, attirer des habitants, tenir face aux vagues ; la fin dépend de la prospérité atteinte | colonie jouée jusqu'à ses fins | ✅ |
| SPEC-HISTOIRE-014 | Une réplique du récit libère toujours la souris — même si la capture demandée au lancement arrive après son ouverture — et aucune reprise du jeu ne la recapture tant qu'elle attend ; elle se répond au clic ou au clavier (Entrée/Espace : continuer, 1-9 : choix) | capture tardive relâchée, reprise bloquée, réponses au clavier | ✅ |

## L22 — couverture des interactions

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-PORTE-001 | Des portes (deux blocs) se fabriquent, s'ouvrent et se ferment d'un clic droit ; fermées elles arrêtent, ouvertes elles laissent passer ; les créatures hostiles ne les ouvrent pas, les habitants si ; les bâtiments générés ont leurs portes | recette, collisions porte ouverte / fermée, créatures, portes des bâtiments | ✅ |
| SPEC-PORTE-002 | Des trappes se fabriquent, s'ouvrent et se ferment ; fermées on marche dessus, ouvertes on passe à travers, et une échelle dessous se grimpe jusqu'à elles | recette, collisions trappe ouverte / fermée, échelle | ✅ |
| SPEC-PORTE-003 | On grimpe aux échelles et aux lianes, on s'y tient, on redescend | montée, maintien, descente | ✅ |
| SPEC-COMBAT-001 | Contre les créatures : dégâts selon l'arme, recul, brève invulnérabilité, butin à la mort | combat simulé | ✅ |
| SPEC-COMBAT-002 | Entre joueurs, en ligne : un joueur en blesse un autre si le serveur autorise le PvP (réglage du serveur, désactivé par défaut) ET si la zone où se tiennent les deux joueurs le permet (SPEC-ZONE-001), avec les mêmes armes, reculs et délais qu'en PvE ; le serveur fait foi et annonce qui a vaincu qui | attaque d'un joueur par un autre, réglage du serveur, zones, annonce | ✅ |
| SPEC-PHYS-001 | Gravité, dégâts de chute (amortis par l'eau), collisions et marche d'un bloc suivent des règles fixes | chutes, collisions | ✅ |
| SPEC-VEHIC-012 | Chaque véhicule se fabrique, se pose, se monte, se conduit et se quitte | parcours de chaque véhicule | ✅ |
| SPEC-RECETTE-007 | Chaque recette est faisable : ses ingrédients s'obtiennent (butin, fabrication, échange, génération) et son résultat existe | graphe des recettes | ✅ |
| SPEC-DROP-001 | Chaque bloc cassable rend son butin, chaque créature le sien ; aucun butin n'est un identifiant inconnu | butins | ✅ |
| SPEC-SUCCES-001 | Des succès récompensent des étapes (premier bloc, premier outil, premier gardien, première ville…) : annoncés une fois, sauvegardés, listés dans un panneau | déclenchement, unicité, sauvegarde | ✅ |
| SPEC-OPTION-001 | Un menu d'options règle sensibilité de la souris, volume du son, champ de vision, distance de vue maximale, rendu réaliste lointain et ombres ; chaque réglage s'applique aussitôt et est conservé | options appliquées et conservées | ✅ |
| SPEC-OPTION-002 | Chaque bouton et chaque option des menus (principal, parties, création, multijoueur, pause, options, affichage, aide) fait ce qu'il annonce | parcours de tous les menus | ✅ |
| SPEC-OPTION-003 | Les touches se reconfigurent (déplacements, actions, panneaux) ; un conflit est signalé ; le choix est conservé et l'aide affiche les touches en vigueur | remappage, conflit, conservation, aide | ✅ |
| SPEC-OPTION-004 | Les options d'affichage choisissent le GPU de calcul parmi ceux de la machine (dans la version empaquetée ; dans le navigateur, la préférence haute performance ou économie d'énergie) ; le choix s'applique au prochain lancement s'il ne peut l'être à chaud, et le programme le signale | liste des GPU, choix conservé, repli si le GPU disparaît | ✅ |
| SPEC-OPTION-005 | La résolution se choisit parmi 800×600, 1024×768, 1080p, 1440p et 4K (et la résolution native), en fenêtre ou en plein écran ; l'image s'adapte sans déformation ; une résolution que l'écran ne peut pas afficher n'est pas proposée | résolutions proposées, rendu à la taille choisie, plein écran | ✅ |
| SPEC-OPTION-006 | L'écran d'affichage se choisit parmi ceux connectés, et le jeu peut s'étendre sur deux ou trois écrans, côte à côte (horizontalement) ou empilés (verticalement) : une seule vue continue, champ de vision élargi dans l'axe des écrans et HUD sur l'écran principal ; la disposition est conservée et revient à un seul écran si un écran manque | écrans détectés, vue continue sur 2 ou 3 écrans, orientation, repli | ✅ |
| SPEC-OPTION-007 | Aucun menu n'est rogné, quelle que soit la résolution : un écran plus grand que la fenêtre défile verticalement et horizontalement (haut toujours atteignable), et la taille de l'interface se règle (automatique selon la fenêtre, ou de 60 à 150 %) ; les options se rangent en colonnes quand la place le permet | défilement, échelle automatique et choisie | ✅ |
| SPEC-OPTION-008 | L'espace de rendu du jeu ne descend jamais sous 800×600, quel que soit l'hôte ou la façon de lancer le jeu : dans un hôte plus petit, la surface (rendu, HUD, menus) garde 800×600 et s'affiche réduite à l'échelle, rapport d'aspect conservé ; les clics restent justes | hôte de 640×400 : renderer et interface en 800×600, affichés à l'échelle 0,667 ; un clic sur un bouton de menu l'active | ✅ |
| SPEC-CMD-001 | Chaque commande du chat fait ce qu'elle annonce (/aide, /heure, /jour, /nuit, /ou, /graine, /vider, /qui, /meteo, /succes) | toutes les commandes | ✅ |

## HUD — affichage tête haute

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-HUD-001 | Un registre unique regroupe les composants existants du HUD (voir HUD-003 à HUD-012) : chacun s'affiche ou se masque indépendamment, une bascule générale les masque ou les rétablit tous, et le choix est conservé d'une partie à l'autre ; effets (éclair de dégâts, givre, fournaise) et panneaux ouverts à la demande (inventaire, carte, factions, journal, livre, dialogues) n'en font pas partie | bascule générale, conservation | ✅ |
| SPEC-HUD-003 | Infos (`.debug`) : se masque et se rétablit seul | bascule du composant | ✅ |
| SPEC-HUD-004 | Viseur et anneau de minage (`.crosshair`, `.mining-ring`) : se masquent et se rétablissent ensemble | bascule du groupe | ✅ |
| SPEC-HUD-005 | Barres de vie, de faim et d'air (`.stats`) : se masquent et se rétablissent ensemble | bascule du groupe | ✅ |
| SPEC-HUD-006 | Barre d'objets et nom de l'objet tenu (`.hotbar`, `.held-name`) : se masquent et se rétablissent ensemble | bascule du groupe | ✅ |
| SPEC-HUD-007 | Notifications (`.toasts`) : se masquent et se rétablissent seules | bascule du composant | ✅ |
| SPEC-HUD-008 | Chat (`.chat`) : se masque et se rétablit seul ; masqué, il se rouvre quand on appuie sur T | bascule, saisie | ✅ |
| SPEC-HUD-009 | Boussole des repères (`.boussole`) : se masque et se rétablit seule | bascule du composant | ✅ |
| SPEC-HUD-010 | Barre du gardien (`.barre-boss`) : se masque et se rétablit seule | bascule du composant | ✅ |
| SPEC-HUD-011 | Objectif de l'histoire (`.objectif-histoire`) : se masque et se rétablit seul | bascule du composant | ✅ |
| SPEC-HUD-012 | Étiquettes des joueurs en écran partagé (`.etiquette`) et HUD de chaque vue : les bascules s'appliquent à toutes les vues | bascules en écran partagé | ✅ |
| SPEC-HUD-002 | Les infos donnent la graine, la version de génération d'origine de la carte, la version du jeu en cours et l'orientation du regard (cap en degrés et point cardinal, inclinaison) | contenu du panneau d'infos | ✅ |

## L35 — profondeurs : mers, souterrains, minerais

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-MER-010 | La flore sous-marine se diversifie : anémones, algues rouges et brunes, posidonies, gorgones, éponges, laminaires, chacune selon la profondeur, la température et la lumière | espèces et conditions de pousse | ✅ |
| SPEC-MER-011 | Des récifs se forment : barrières de corail le long des côtes chaudes, récifs frangeants, atolls autour des îles, et leurs lagons | structures récifales générées | ✅ |
| SPEC-SOUTERRAIN-001 | Des biomes souterrains dépendent de ce qui les surmonte : géodes et grottes de cristal sous les montagnes, chambres magmatiques sous les volcans, grottes luxuriantes sous les plaines et les forêts, grottes englouties sous les fonds marins, et au plus profond l'abîme | biome souterrain selon la surface et la profondeur | ✅ |
| SPEC-SOUTERRAIN-002 | Chaque biome souterrain a ses créatures (chauves-souris, araignées des cavernes, élémentaires de magma, golems de cristal, rôdeurs de l'abîme, créatures aveugles des grottes englouties…) | tables d'apparition souterraines | ✅ |
| SPEC-SOUTERRAIN-003 | Chaque biome souterrain a ses structures : donjons propres, ruines d'anciennes cités, mines abandonnées avec rails et étais | structures par biome souterrain | ✅ |
| SPEC-LUMIERE-007 | Des plantes et des organismes bioluminescents éclairent les profondeurs selon leurs conditions : champignons et lichens des grottes humides, cristaux des géodes, algues luminescentes des abysses, planctons près des récifs la nuit ; ils sont des sources de lumière | espèces, conditions, lumière émise | ✅ |
| SPEC-MINERAI-001 | Tous les minerais existent, chacun à sa profondeur et dans ses biomes : charbon, cuivre, étain, fer, argent, or, lapis, émeraude, rubis, saphir, diamant, quartz, soufre (volcans), sel (déserts et mers asséchées), obsidienne ; chacun se mine avec l'outil voulu et donne sa matière | répartition, outils requis, butins | ✅ |
| SPEC-MINERAI-002 | Les nouvelles matières servent : lingots et gemmes entrent dans des recettes (outils, blocs, objets), s'échangent auprès des habitants, et apparaissent dans les butins des donjons | recettes, échanges, butins | ✅ |

## L36 — ambiance sonore

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-AUDIO-001 | L'environnement s'entend selon le lieu : vent, pluie, mer et ressac, rivière, cascade, feuillage en forêt, grillons la nuit, résonance des grottes, rumeur des villes, grondement des volcans | nappes selon le lieu et le moment | ✅ |
| SPEC-AUDIO-002 | Chaque créature a ses sons : cris, pas, blessure, mort, attaque | sons par créature | ✅ |
| SPEC-AUDIO-003 | Les actions s'entendent selon la matière : pas (herbe, pierre, sable, bois, neige, eau), minage et casse, pose, nage, chute, combat, tir | sons par action et par matière | ✅ |
| SPEC-AUDIO-004 | Les interactions s'entendent : portes et trappes, coffres, fourneau, établi, échanges, interface | sons d'interaction | ✅ |
| SPEC-AUDIO-005 | Les événements s'entendent : tonnerre, éruption, cyclone et tornade, succès, chapitres et fins d'histoire, réveil d'un gardien | sons d'événement | ✅ |
| SPEC-AUDIO-006 | Les sons sont spatialisés : leur volume et leur panoramique suivent leur position par rapport à l'auditeur, étouffés sous l'eau et derrière la roche ; chaque catégorie a son volume dans les options | spatialisation, étouffement, volumes par catégorie | ✅ |

## L39 — factions autonomes et factions de joueurs

Prolonge SPEC-FACTION-001 à 005 (camps des créatures et réputation).

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-FACTION-006 | Des factions PNJ autonomes naissent du monde de façon déterministe (royaumes des villes, guildes marchandes, ordres, bandits, cultes…) : chacune a un siège, un territoire, des ressources, un caractère et ses propres objectifs (s'étendre, commercer, piller, défendre, explorer, convertir), qui évoluent avec ce qui lui arrive | factions par région, objectifs, évolution | ✅ |
| SPEC-FACTION-007 | Les factions PNJ agissent d'elles-mêmes selon leurs objectifs : caravanes, patrouilles, raids sur leurs ennemis, fondation d'avant-postes ; leurs territoires changent ; la simulation tourne hors ligne comme en ligne (le serveur fait foi) et se poursuit, à gros grain, loin des joueurs | actions, changements de territoire, simulation hors de vue | ✅ |
| SPEC-FACTION-008 | Les factions PNJ entretiennent entre elles des relations (alliance, neutralité, rivalité, guerre) qui évoluent et s'annoncent ; elles jugent les joueurs et les factions de joueurs par leur réputation et leur confient des quêtes selon leurs objectifs | relations, annonces, quêtes de faction | ✅ |
| SPEC-FACTION-009 | Un joueur crée une faction de joueurs (nom unique, couleur, emblème, devise) et en devient le chef ; le chef nomme les membres à des rangs (chef, officier, membre, recrue), les promeut, les rétrograde, les exclut, et peut transmettre la direction ; une faction sans membre disparaît | création, rangs, nominations, transmission, dissolution | ✅ |
| SPEC-FACTION-010 | Un joueur postule à une faction ; le chef ou un officier accepte ou refuse la candidature ; une faction peut aussi inviter un joueur ; un joueur quitte une faction quand il le veut | candidature, acceptation, refus, invitation, départ | ✅ |
| SPEC-FACTION-011 | Un joueur a au plus une faction principale — la sienne s'affiche avec son nom et compte pour la diplomatie — et zéro, une ou plusieurs factions secondaires ; il peut changer de faction principale parmi les siennes | une seule principale, secondaires multiples, changement | ✅ |
| SPEC-FACTION-012 | Une faction de joueurs a son canal de discussion, voit ses membres sur la carte, et déclare ses relations (alliée, neutre, ennemie) envers les autres factions, de joueurs comme PNJ ; les membres d'une même faction ne se blessent pas | canal, carte, diplomatie, pas de dégâts entre membres | ✅ |
| SPEC-FACTION-013 | Les factions de joueurs, leurs membres, rangs, candidatures et relations sont conservés par le serveur (et par la sauvegarde hors ligne pour les joueurs locaux) ; un administrateur ou un modérateur peut renommer ou dissoudre une faction (SPEC-ADMIN-008) | persistance, modération | ✅ |

## L40 — technique

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-SAVE-017 | Les blocs se stockent sur 16 bits et portent un état (orientation, moitié haute ou basse, forme d'angle, connexions, allumé ou éteint, niveau d'énergie) : de nouveaux blocs peuvent s'ajouter sans limite pratique ; les sauvegardes et les mondes serveur antérieurs (8 bits) se migrent sans perte, objets d'inventaire compris | migration d'une sauvegarde 8 bits, nouveaux identifiants, états conservés | ✅ |

## L24 — construction fine et intérieurs

Dépend de SPEC-SAVE-017 (identifiants sur 16 bits et états de bloc).

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-CONSTR-001 | Des escaliers existent pour chaque matériau de construction ; posés, ils s'orientent selon le regard (et s'inversent posés sous un plafond) ; ils forment d'eux-mêmes angles intérieurs et extérieurs selon leurs voisins ; on les monte sans sauter | orientation, angles automatiques, montée | ✅ |
| SPEC-CONSTR-002 | Des demi-blocs (dalles) existent pour les matériaux qui s'y prêtent : moitié basse ou haute selon l'endroit visé, deux dalles font un bloc plein ; on y marche à mi-hauteur | pose haute/basse, fusion, collision | ✅ |
| SPEC-CONSTR-003 | Des toitures : pans en pente, faîtages, arêtiers et noues qui s'ajustent d'eux-mêmes aux voisins (angles automatiques) ; les bâtiments générés en sont couverts selon leur style | formes de toit, raccords, bâtiments couverts | ✅ |
| SPEC-CONSTR-004 | Clôtures, murets, vitres et rambardes se raccordent d'eux-mêmes à leurs voisins (et aux blocs pleins), se referment en angle et en T | connexions selon les voisins | ✅ |
| SPEC-CONSTR-005 | Le verre se fond à partir du sable ; vitres et verre teinté ; des colorants (fleurs, minerais, encre de calmar…) teignent laine, tissu, verre, béton et terre cuite | fonte, recettes de colorants, teintures | ✅ |
| SPEC-CONSTR-006 | Davantage de matériaux de construction : briques, béton, terre cuite, marbre, ardoise, pavés, crépi, bois de chaque essence en planches et poutres, chaume, chacun avec ses recettes et ses variantes (escalier, dalle, muret quand cela s'y prête) | matériaux, recettes, variantes | ✅ |
| SPEC-CONSTR-007 | Le feu : il prend aux matériaux inflammables, se propage, se consume et s'éteint sous la pluie ou dans l'eau ; il éclaire et fume ; foyers, cheminées et torches fument aussi ; la fumée monte et dérive avec le vent | propagation, extinction, lumière, fumée au vent | ✅ |
| SPEC-INTERIEUR-001 | Tout bâtiment généré a un intérieur meublé selon sa fonction et son style (maison : lits, table, chaises, armoire, cheminée ; forge, boutique, bibliothèque, auberge, temple, ferme, tour…) ; aucun bâtiment n'est creux | mobilier par type de bâtiment, aucun intérieur vide | ✅ |
| SPEC-INTERIEUR-002 | Des objets d'intérieur se fabriquent et se posent : lits (on y dort, la nuit passe et le point de réapparition s'y fixe), tables, chaises, armoires, étagères, bibliothèques, tapis, lampes, vases, présentoirs et socles (promontoires) où exposer un objet | recettes, pose, orientation, usages | ✅ |
| SPEC-INTERIEUR-003 | Livres et notes : les bibliothèques des lieux contiennent des livres à lire (histoire du monde, indices des quêtes) ; un joueur écrit ses propres notes et livres, les signe, les pose sur un présentoir ou les range | lecture, écriture, signature, rangement | ✅ |

## L25 — objets : armures, armes, gemmes, nourriture, coffres

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-OBJET-001 | Le tissu se tisse (laine — coton et lin laissés à une culture future) ; armures de tissu, cuir, mailles, bronze, fer, or et diamant — casque, plastron, jambières, bottes — réduisent les dégâts selon leur matière, s'usent, se réparent à l'établi, et se voient sur l'avatar | recettes, réduction des dégâts, usure, réparation, apparence | ✅ |
| SPEC-OBJET-002 | Davantage d'armes : dague, épée longue, hache de guerre, masse, lance, arc long, arbalète lourde, fronde, chacune avec sa portée, sa cadence, ses dégâts et son recul, dans plusieurs matières | caractéristiques, recettes | ✅ |
| SPEC-OBJET-003 | Gemmes taillées et bijoux (anneaux, amulettes, diadèmes) : ils se portent et donnent de petits effets (résistance, vitesse, lumière, chance au butin) ; ils valent cher auprès des marchands | taille, port, effets, valeur | ✅ |
| SPEC-OBJET-004 | Davantage de nourriture et une cuisine : fromage, soupes, ragoûts, tartes, gâteaux, baies, en plus du pain et des viandes/poissons déjà cuisinables ; chaque plat rassasie selon sa recette, certains soignent un peu ; la nourriture crue peut rendre malade | recettes, satiété, effets | ✅ |
| SPEC-OBJET-005 | Coffres piégés (flèches, explosion, alarme qui appelle des gardes, gaz) et coffres surprises (butin rare tiré au hasard, ou un mimic qui attaque) ; un piège se détecte et se désamorce avec le kit voulu — la pose automatique dans les donjons/ruines/camps générés reste à câbler | pièges, surprises, détection, désamorçage | ✅ |

## L29 — mécanismes et électricité

Dépend de SPEC-SAVE-017 (états de bloc : allumé, niveau d'énergie, orientation).

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-MECA-001 | Distributeurs (lâchent ou lancent un objet de leur contenu) et pistons (poussent jusqu'à douze blocs, les pistons collants tirent) s'actionnent sur signal | actionnement, poussée, traction, limites | ✅ |
| SPEC-MECA-002 | Des générateurs électriques produisent selon leur milieu : éolienne (selon le vent de son altitude, SPEC-VENT-001), roue ou turbine hydraulique (selon le courant, SPEC-EAU-002), générateur thermique (lave, combustible) ; des câbles transportent l'énergie avec des pertes | production selon le milieu, transport, pertes | ✅ |
| SPEC-MECA-003 | Des batteries rechargeables stockent l'énergie, se chargent et se déchargent à débit borné, affichent leur niveau et le gardent une fois ramassées | charge, décharge, niveau, conservation | ✅ |
| SPEC-MECA-004 | Des circuits logiques : fils de signal et toutes les portes — OUI, NON, ET, OU, OU exclusif, NON-ET, NON-OU, NON-OU exclusif — plus répéteur à délai, bascule (mémoire), compteur et comparateur ; la propagation se fait par tics, de façon déterministe, sans boucle infinie | table de vérité de chaque porte, délais, mémoire, stabilité | ✅ |
| SPEC-MECA-005 | Des détecteurs et commandes émettent un signal : bouton, levier, plaque de pression, détecteur de présence (joueur, créature), capteur de lumière, de jour et de nuit, de pluie et de vent, horloge, détecteur de niveau d'eau | signal selon le déclencheur | ✅ |
| SPEC-MECA-006 | Des appareils consomment énergie ou signal : lampes, portes et trappes motorisées, tapis roulants, ascenseurs, alarmes ; sans énergie, ils s'arrêtent | fonctionnement selon l'alimentation | ✅ |
| SPEC-MECA-007 | Des blocs de commande exécutent une commande du jeu sur signal ; seuls les administrateurs (ou le mode créatif hors ligne) peuvent les poser ou les modifier | exécution, permissions | ✅ |
| SPEC-MECA-008 | Circuits et machines se simulent dans les chunks chargés, sont sauvegardés avec leur état, et en ligne le serveur fait foi | persistance, autorité du serveur | ✅ |

## L38 — densité, mégapoles et zones de jeu

Les specs HABITAT-008, 009, 012 et ROUTE-001 à 005 (en cours) posent la
répartition des lieux et leurs routes ; celles-ci les prolongent.

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-DENSITE-001 | Une carte de densité humaine, déterministe (graine), combine un bruit à grande échelle avec l'habitabilité tirée des biomes et des données environnementales (eau douce et côtes, relief, climat, fertilité, volcans) ; elle classe chaque région en vierge, rurale, urbaine ou hyperurbaine | classement stable, cohérent avec biomes et relief | ✅ |
| SPEC-DENSITE-002 | Les lieux naissent de cette carte : rien ou presque en zone vierge (grandes étendues sauvages, forêts, montagnes, déserts), fermes, hameaux et villages en zone rurale, villes en zone urbaine, mégapoles en zone hyperurbaine ; les transitions entre classes sont progressives (faubourgs, banlieues, campagne) | lieux par classe, transitions | ✅ |
| SPEC-HABITAT-013 | Des mégapoles s'étendent sur plus d'un kilomètre, au bord de l'eau ou dans une grande plaine : centre de tours, quartiers d'immeubles, avenues en grille, parcs, port quand la côte ou un fleuve s'y prête ; elles sont rares, très éloignées les unes des autres, et se voient de loin en silhouettes | taille, quartiers, avenues, port, espacement, silhouette lointaine | ✅ |
| SPEC-ROUTE-007 | Le réseau suit la hiérarchie des lieux : grands axes entre mégapoles et villes, routes de commerce vers villes et villages, chemins ruraux vers fermes et hameaux, routes de tourisme vers les sites remarquables ; les zones vierges ne sont traversées que par quelques routes | hiérarchie des tracés, rareté en zone vierge | ✅ |
| SPEC-ROUTE-008 | Les rivières font partie du réseau : les grands fleuves sont navigables, avec ports, quais et embarcadères dans les lieux qu'ils traversent, et les routes les franchissent par des ponts ou les longent | voies navigables, ports, franchissements | ✅ |
| SPEC-ZONE-001 | Le monde est découpé en zones de jeu : PvP et PvE, PvP seul (pas de monstres hostiles), PvE seul (les joueurs ne peuvent pas se blesser), sûre (aucun dégât de joueur ni de monstre, aucune apparition hostile) ; leur carte est déterministe (graine) et suit la densité — les lieux habités et les points d'apparition sûrs, les zones vierges plus dangereuses | classement, règles par zone, cohérence avec la densité | ✅ |
| SPEC-ZONE-002 | Les règles d'une zone s'appliquent partout où l'on se trouve, hors ligne comme en ligne (le serveur fait foi) : dégâts entre joueurs, dégâts des monstres, apparitions hostiles | combats et apparitions selon la zone | ✅ |
| SPEC-ZONE-003 | La zone courante s'affiche (HUD, carte avec ses frontières), l'entrée dans une autre zone est annoncée, et des bornes marquent les frontières sur les routes | indicateur, carte, annonce, bornes | ✅ |
| SPEC-ZONE-004 | Le serveur choisit ses règles de zones (carte générée, tout PvE, tout sûr, tout PvP…) et un administrateur peut redéfinir la zone d'une région (SPEC-ADMIN-006) | réglages du serveur, redéfinition par un admin | ✅ |

## L23 — saisons

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-SAISON-001 | Le temps suit un calendrier : une journée dure 20 minutes réelles, une année 3 heures réelles (9 journées), en quatre saisons — printemps, été, automne, hiver — de 2 journées ¼ chacune ; la saison, le jour et l'année s'affichent, et se déduisent de l'heure du monde (les mêmes pour tous les postes, sauvegardées avec elle) | durées, découpage, affichage, déterminisme | ✅ |
| SPEC-SAISON-002 | La durée du jour varie : les journées sont plus longues l'été, plus courtes l'hiver, et la course du soleil s'élève ou s'abaisse avec la saison, sans saut d'un jour à l'autre | fraction de jour et hauteur du soleil selon la saison, continuité | ✅ |
| SPEC-SAISON-003 | La température suit la saison, progressivement : chaude l'été, froide l'hiver ; en hiver il neige là où il pleuvait, et une couche de neige couvre le sol des régions tempérées, puis fond au printemps | écart saisonnier, neige et couverture neigeuse selon la saison | ✅ |
| SPEC-SAISON-004 | Les feuillages suivent les saisons : verts au printemps et l'été, roussis et jaunis à l'automne, clairsemés l'hiver ; les conifères restent verts ; l'herbe jaunit à la fin de l'été ; la transition est progressive | teinte des feuillages et de l'herbe par saison et par essence | ✅ |
| SPEC-SAISON-005 | En hiver, lacs et rivières calmes des régions froides gèlent en surface — on marche sur la glace — et dégèlent au printemps | gel et dégel des eaux dormantes selon la saison et le climat | ✅ |
| SPEC-SAISON-006 | Les cultures ne poussent qu'en saison : vite l'été, lentement au printemps et à l'automne, pas l'hiver ; la reproduction des animaux reprend au printemps | croissance et naissances selon la saison | ✅ |

## L37 — version empaquetée, serveur dédié et administration

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-PACK-001 | Une version empaquetée se télécharge et se lance sans rien installer : un exécutable par système (Windows, macOS, Linux) qui embarque son moteur et les fichiers du jeu, et une archive portable ; lancé sans paramètre, il ouvre le jeu dans le navigateur | construction des paquets, lancement, page servie | ✅ |
| SPEC-PACK-002 | Des paramètres de lancement règlent le mode : `--serveur` (serveur seul, sans partie locale), `--port`, `--graine`, `--monde` (fichier de sauvegarde), `--max-joueurs`, `--pvp`, `--liste-blanche`, `--admin` (mot de passe ou jeton d'administration) ; `--aide` les liste ; un paramètre inconnu ou invalide est signalé et le programme s'arrête proprement | analyse des paramètres, valeurs par défaut, erreurs | ✅ |
| SPEC-PACK-003 | Une aide automatique des paramètres de lancement se déclenche à la demande (--aide, --help, -h, -?, /? ; --aide <paramètre> pour le détail d'un seul) ou d'elle-même quand un paramètre est inconnu (avec la suggestion la plus proche) ou incorrect (avec le détail du paramètre fautif : type, bornes, défaut, exemple) | demandes d'aide, suggestion, détail sur erreur | ✅ |
| SPEC-SERVEUR-001 | En serveur seul, le monde vit sans joueur local : il se sauvegarde régulièrement et à l'arrêt, reprend là où il s'était arrêté, et accueille les clients qui le rejoignent | monde persistant, sauvegarde à l'arrêt, reprise | ✅ |
| SPEC-SERVEUR-002 | Un banc de charge simule, sans rendu, de 1 à 100 clients par paliers (1, 5, 10, 25, 50, 100) qui parlent le vrai protocole : ils se déplacent, minent, posent, ouvrent des coffres, combattent et discutent, soit groupés en un même lieu, soit répartis dans des zones éloignées ; pour chaque palier et chaque scénario il mesure la durée des tics du serveur (moyenne, 95e centile), la mémoire, le débit réseau par client et la latence des réponses, rend un rapport comparatif et échoue si un seuil est dépassé | paliers, scénarios groupé et réparti, mesures, rapport, seuils | ✅ |
| SPEC-ADMIN-001 | Le serveur sert une console web d'administration, protégée par le mot de passe ou le jeton d'administration : elle liste les joueurs connectés avec leur nom, leur position, leur adresse IP de connexion et leur heure de connexion | accès refusé sans authentification, liste à jour | ✅ |
| SPEC-ADMIN-002 | La console montre l'inventaire de chaque joueur et le journal de ses actions (blocs posés et cassés, coffres, échanges, combats, messages, commandes), horodatées | inventaire exact, journal des actions | ✅ |
| SPEC-ADMIN-003 | L'historique des connexions est conservé : pour chaque joueur, ses sessions (adresse IP, heure de connexion et de déconnexion), y compris des joueurs partis | historique persistant des sessions | ✅ |
| SPEC-ADMIN-004 | Listes blanche et noire de noms de joueurs et d'adresses e-mail : en liste blanche activée, seuls les inscrits entrent ; un inscrit en liste noire est refusé ou expulsé aussitôt, avec un message ; le joueur déclare son e-mail à la connexion quand le serveur l'exige | refus, expulsion immédiate, e-mail exigé | ✅ |
| SPEC-ADMIN-005 | L'administrateur crée des liens d'invitation pour rejoindre le serveur : jeton unique, date d'expiration, nombre d'usages, e-mail destinataire facultatif ; un lien valide fait entrer même en liste blanche, un lien révoqué ou expiré est refusé | création, usage, expiration, révocation | ✅ |
| SPEC-ADMIN-006 | En client, un joueur administrateur du serveur retrouve les mêmes fonctions dans un panneau du jeu (joueurs, inventaires, actions, connexions, listes, invitations) ; le serveur refuse ces demandes à tout autre joueur | panneau admin en jeu, refus aux non-admins | ✅ |
| SPEC-ADMIN-007 | Adresses IP, e-mails et journaux de connexion ne sont visibles que des administrateurs (pas des modérateurs) ; chaque action d'administration ou de modération (expulsion, sourdine, bannissement, liste, invitation, changement de rôle) est elle-même journalisée avec son auteur | confidentialité par rôle, journal d'administration | ✅ |
| SPEC-ADMIN-008 | Des modérateurs, nommés et révoqués par un administrateur, modèrent le serveur depuis la console web ou le panneau du jeu : liste des joueurs connectés et de leurs positions, journal du chat, avertissement, sourdine, expulsion, bannissement temporaire, et ajout en liste noire d'un nom ; ils ne voient ni IP ni e-mails, ne créent pas d'invitations, ne changent pas les réglages du serveur et ne peuvent sanctionner ni un administrateur ni un autre modérateur | rôles, droits permis et refusés, sanctions et leur durée | ✅ |


## L42 — outillage de test : sélection, préréglages, banc navigateur, cahier de test

Un seul catalogue de tests et de préréglages sert l'interface du banc, la ligne
de commande (`node tests/run.js`), les crochets git et les portes : ce que l'on
sélectionne dans le navigateur se rejoue à l'identique en ligne de commande.
Chaque test porte sa fiche (quoi, pourquoi, résultat attendu) : le cahier de
test s'en sert pour suivre l'exécution et construire ses rapports.

Les fiches SPEC-BANC-033 et suivantes couvrent l'**historique global**
(docs/banc/historique-global.md, conception validée) : une zone du banc qui
agrège tous les runs du registre et des cahiers locaux, avec tri, filtres,
graphiques, un diaporama par image, un périmètre d'exécution restreint par
commit et un vrai journal (`MC.Journal`). Elles sont regroupées ci-dessous
par sous-thème, dans l'ordre des sections du document de conception.

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-BANC-001 | Chaque test est classé sans saisie manuelle : son **type** (unitaire, fonctionnel, spec, e2e, intégration, banc de charge) d'après son fichier, son **domaine** d'après les `SPEC-XXX` qu'il cite, son **groupe** d'après son `describe` (ou sa section e2e) ; des étiquettes facultatives (`@lent`, `@reseau`, `@bug-NNN`, `@visuel`) s'ajoutent dans son nom ou sa fiche | le catalogue construit sous Node liste tous les tests avec type, domaines, groupe et étiquettes ; un test citant SPEC-SYNC-002 est dans le domaine SYNC | ✅ |
| SPEC-BANC-002 | Chaque test a une **fiche** : ce qu'il teste, pourquoi (la règle ou le risque couvert, la spec citée) et le résultat attendu ; elle se déclare à côté du test (`it(nom, { teste, pourquoi, attendu }, fn)` ou équivalent e2e) et, faute de fiche, se déduit de la spec citée dans SPECS.md (spec → quoi, vérification → attendu) ; une porte (G14) refuse un nouveau test sans fiche ni spec citée | le catalogue donne quoi/pourquoi/attendu pour 100 % des tests ; un test ajouté sans fiche ni SPEC fait échouer G14 | ✅ |
| SPEC-BANC-003 | On lance au choix : un seul test, un ou plusieurs domaines, un ou plusieurs types, un ou plusieurs groupes, une liste explicite (noms ou identifiants, collée ou lue dans un fichier), les échecs de la dernière campagne, ou tous ; les critères se combinent (intersection) et une exclusion est possible | `selection(catalogue, criteres)` rend exactement les tests attendus pour chaque critère seul, combiné et exclu | ✅ |
| SPEC-BANC-004 | Des **préréglages** nommés, décrits dans un seul fichier versionné, figent une sélection : `commit` (sans navigateur ni intégration, restreint au **périmètre du commit** — §3.6 de docs/banc/historique-global.md, `tools/perimetre.js` — avec repli sur la suite complète en cas de doute, ce n'est plus un objectif de durée comme « moins de 60 s »), `pr` (toute la suite Node, l'intégration et des e2e de fumée), `regression` (tout), `bugs` (tests étiquetés `@bug-*`), `en-cours` (specs ⏳ et domaines des fichiers modifiés depuis la dernière étiquette), `e2e`, `integration`, `rapide`, `visuel` ; chaque préréglage dit à qui il sert (crochet, testeur, développeur) | chaque préréglage sélectionne au moins un test ; `commit` n'inclut ni e2e ni intégration et se limite au périmètre calculé par `tools/perimetre.js` pour les fichiers indexés, avec repli documenté sur la suite complète (jamais un délai ou une durée comme critère de restriction) ; `regression` inclut tout le catalogue | ⏳ |
| SPEC-BANC-005 | La ligne de commande accepte les mêmes critères que l'interface : `node tests/run.js --preset NOM`, `--domaine A,B`, `--type T`, `--groupe G`, `--test NOM`, `--liste fichier`, `--echecs`, `--sauf CRITERE`, `--lister` (affiche la sélection et les fiches sans exécuter) ; l'ancien filtre positionnel reste valable | chaque option, lancée avec `--lister`, affiche la sélection attendue ; un critère inconnu est refusé avec l'aide des options | ✅ |
| SPEC-BANC-006 | Les crochets git utilisent les préréglages, avec un **périmètre d'exécution différent selon le crochet** (§3.6 de docs/banc/historique-global.md) : `pre-commit` calcule et lance le **périmètre du commit** (`--preset commit`, restreint aux fichiers indexés par `tools/perimetre.js`, repli sur la suite complète en cas de doute) ; `pre-push` ET `pre-merge-commit` (nouveau crochet, ajouté à `.githooks`, déclenché sur un merge sans conflit) lancent la **suite complète** (`--preset pr`), avec inscription automatique au registre et reconstruction de la carte d'impact ; un merge avec conflits résolus est détecté par `pre-commit` lui-même (présence de `MERGE_HEAD`), qui bascule alors aussi en suite complète ; la même commande `pr` sert à l'intégration continue d'une demande de fusion ; une porte (G13) vérifie que `pre-commit` sait produire un périmètre non vide et que `pre-push`/`pre-merge-commit` citent bien la suite complète | `node tools/perimetre.js --lister` sur un commit qui ne touche qu'un fichier `src/x.js` donné sélectionne exactement les tests attendus par la carte d'impact ; `pre-push` et `pre-merge-commit` lancent le préréglage `pr` en entier ; un merge avec conflits résolus déclenche la suite complète via `pre-commit` (MERGE_HEAD détecté) ; G13 rouge si `pre-commit` n'a pas de calcul de périmètre ou si `pre-push`/`pre-merge-commit` ne citent pas `pr` | ⏳ |
| SPEC-BANC-007 | La page du banc propose un **menu de sélection** : arbre type → domaine → groupe → test avec cases à cocher, recherche plein texte (noms et fiches), choix d'un préréglage, compteur des tests retenus, boutons « lancer », « relancer les échecs », « tout » ; la sélection se reflète dans l'adresse (`tests/index.html?preset=pr&domaine=SYNC`) pour qu'un lien la reproduise | cocher un domaine met le compteur à jour ; l'adresse `?domaine=OPTION` présélectionne exactement les tests du domaine OPTION | ✅ |
| SPEC-BANC-008 | Disposition du banc : la **moitié gauche** est la liste des tests effectués, dans un bloc à défilement vertical qui suit le dernier test tant qu'on ne remonte pas ; le **résumé** (passés, échoués, restants, durée écoulée, estimation de fin, test en cours et sa progression) reste en bas de cette moitié et ne sort jamais de la page ; le **quart haut droit** liste les tests lents et les tests en erreur ; le **quart bas droit** tient le rendu 3D intégré où s'exécutent les tests réels | à 1280×800 et 800×600 : la liste défile, le résumé reste visible une fois 100 tests affichés, les trois zones ne se chevauchent pas et la page elle-même ne défile pas | ✅ |
| SPEC-BANC-009 | La progression se suit **en temps réel**, sans attendre la fin : chaque test en cours affiche sa fiche, l'étape où il en est (`etape('libellé')`, avancement n/N quand il le connaît) et son temps écoulé ; chaque test fini apparaît aussitôt, avec son état et sa durée, pour tous les types (unitaires compris) ; en ligne de commande, les mêmes étapes s'écrivent au fil de l'eau | pendant un test e2e à trois étapes, l'affichage montre successivement les trois libellés avant la fin du test ; le résumé n'affiche jamais « tout passe » avant la fin | ✅ |
| SPEC-BANC-010 | Le délai par test est un **filet de sécurité contre un test qui ne rend JAMAIS la main** (deadlock), jamais un couperet pour un test simplement lent : un test lent continue jusqu'à SON vrai résultat (ok/échec), signalé au passage dans la zone des lents (seuil bien plus bas, un simple avertissement affiché en direct, jamais une cause d'échec) ; le délai lui-même est généreux par défaut (15 min, côté Node comme côté e2e, navigateur et sans fenêtre), réductible par `fiche.delai` pour un test qui a besoin de vérifier le mécanisme ; la campagne continue avec le suivant après un test réellement coupé. **Un seul filet, partout, crochets compris** : `pre-commit`, `pre-push` et `pre-merge-commit` ne fixent plus chacun leur propre `--delai` (actuellement 240 s, 600 s, 150 s) — ils partagent le même filet par défaut de 15 min que la ligne de commande, pour qu'un crochet qui finit par réussir ne soit jamais coupé plus tôt qu'un lancement manuel du même préréglage | un test factice qui ne se termine jamais (deadlock) est coupé à son délai, son étape courante est rapportée, et le suivant s'exécute ; un test réel mais lent (dizaines de secondes, voire plusieurs minutes) qui FINIT par réussir est rapporté « ok », jamais coupé par le délai par défaut ; aucun des fichiers `tools/hooks/pre-commit.js`, `pre-push.js` et `pre-merge-commit.js` ne passe de valeur `--delai` différente de 900 s (ou n'en passe aucune, valeur par défaut) au préréglage qu'il lance | ⏳ |
| SPEC-BANC-011 | Chaque test réel du rendu intégré produit des **captures d'images clés** : au début, à chaque étape déclarée, à la fin, et au moment d'un échec ; compressées (JPEG ou WebP, taille bornée), elles s'affichent en vignettes sous la ligne du test, agrandissables | un test e2e qui déclare deux étapes produit au moins quatre captures non vides ; un échec produit une capture « échec » | ✅ |
| SPEC-BANC-012 | Chaque test a ses **métriques** : durée, images rendues, images/s moyenne, minimale et p95, temps de rendu par image, appels de dessin et triangles, mémoire JS quand le navigateur la donne, nombre d'assertions et de captures ; la campagne a ses métriques globales : totaux par état, par type et par domaine, durée, dix tests les plus lents, images/s moyenne, environnement (navigateur, carte graphique, résolution, version du jeu, commit, graine) | le fichier de résultats contient ces champs pour chaque test e2e et pour la campagne | ✅ |
| SPEC-BANC-013 | Un **retour textuel** accompagne chaque test : sa fiche (quoi, pourquoi, attendu), ses étapes, ses assertions (réussies et échouées) et, en cas d'échec, le résultat obtenu face à l'attendu, le message et la ligne fautive (pile d'appel, e2e compris), visibles en dépliant la ligne | un échec e2e affiche l'attendu, l'obtenu, le fichier et la ligne de l'assertion ; les étapes apparaissent dans l'ordre | ✅ |
| SPEC-BANC-014 | À la fin de chaque campagne — navigateur ou ligne de commande, même interrompue — le **cahier de test** est conservé dans `tests/resultats/<date>_<préréglage>/` : `rapport.html` (complet, structuré, lisible par un humain : résumé, environnement, métriques globales, échecs en premier, tests lents, puis chaque test par type, domaine et groupe avec sa fiche quoi/pourquoi/attendu, son résultat obtenu, ses étapes, ses métriques et ses captures intégrées), `resultats.json` (schéma documenté, lisible par une machine) et `captures/` ; la page affiche le lien du rapport ; les dossiers ne sont pas versionnés et seuls les N derniers sont gardés | après une campagne, le dossier existe avec les trois éléments ; `resultats.json` se relit, son total égale celui du résumé et chaque test y a sa fiche ; une campagne interrompue produit un rapport marqué « interrompu » | ✅ |
| SPEC-BANC-015 | Le serveur de test ne reçoit des résultats que de la machine locale, borne leur taille, n'écrit que dans `tests/resultats/` sous des noms qu'il fabrique lui-même (aucune traversée de répertoire), et refuse hors mode test | un envoi depuis une autre adresse, trop gros ou avec un nom `../x` est refusé ; un envoi valide crée le dossier attendu | ✅ |
| SPEC-BANC-016 | Chaque test part d'un état connu et n'en laisse aucun : la fin d'un test e2e et la fin de campagne referment dialogues, écrans et fenêtres ouverts, et remettent options et parties comme avant | après la campagne, aucun dialogue ni écran de test ne reste visible ; relancer un test seul donne le même résultat que dans la campagne | ✅ |
| SPEC-BANC-017 | Le rendu intégré se pilote aussi à la main et par les tests via une même interface (`MC_DEBUG`) : téléporter, régler l'heure, la saison et la météo, la distance de vue, agrandir le rendu en plein panneau, capturer une image | chaque commande change l'état attendu du jeu ; agrandir puis réduire rétablit la taille et le rapport d'aspect | ✅ |
| SPEC-BANC-018 | Le serveur de test tient la **bibliothèque des cahiers** enregistrés (tests/resultats/*) : une page `/tests/cahiers` les liste (date, préréglage ou filtre, source navigateur/Node/exploration, totaux, durée, version, commit, interrompu ou non), les trie et filtre, ouvre chacun dans le navigateur, en compare deux (tests apparus, disparus, passés d'ok à échec et inversement, écarts de durée et de métriques) et en supprime (la rotation des N derniers ne supprime jamais un cahier marqué « conservé ») | un cahier enregistré apparaît dans la liste avec ses totaux ; la comparaison de deux cahiers liste les tests dont l'état a changé | ✅ |
| SPEC-BANC-019 | Un cahier s'exporte en **page web autonome** : un seul fichier .html, captures intégrées (data URI), styles en ligne, lisible hors ligne et sans serveur | le fichier exporté s'ouvre seul et contient toutes les captures et tous les tests | ✅ |
| SPEC-BANC-020 | Un cahier s'exporte en **PDF** avec le même contenu et la même mise en page que la page web (feuille de style d'impression commune : sauts de page par section, en-têtes de tableau répétés, captures non coupées, sommaire) — côté serveur via un navigateur installé en mode sans interface (Edge ou Chrome `--headless --print-to-pdf`, détecté automatiquement) et, à défaut, via l'impression du navigateur | le PDF produit contient les mêmes sections, tableaux et captures que la page web ; sans navigateur installé, l'export propose l'impression | ✅ |
| SPEC-BANC-021 | Un cahier s'exporte en **Word (.docx)** avec le même contenu et la même mise en page (titres, sommaire, tableaux, couleurs d'état, captures) — fichier .docx réel généré sans dépendance (archive ZIP et WordprocessingML écrits à la main) | le .docx s'ouvre, sa structure (document.xml, images, styles) est valide et il contient les mêmes sections, tests et captures | ✅ |
| SPEC-BANC-022 | Les quatre formes d'un cahier (page du serveur, web autonome, PDF, Word) sont produites à partir d'un **même modèle de document** (sections, tableaux, captures, légendes) : aucune ne peut avoir un contenu que les autres n'ont pas | test : le nombre de sections, de tests, de lignes de tableau et de captures est identique dans les rendus HTML et docx d'un même cahier | ✅ |
| SPEC-BANC-023 | Les e2e s'exécutent **sans fenêtre, en ligne de commande, dans une instance de navigateur isolée par campagne** : `node tests/run.js --type e2e` (et tout préréglage qui contient des e2e) démarre son propre serveur de test sur un port libre, lance Edge ou Chrome installé en mode sans interface (`--headless=new`, `--user-data-dir` temporaire, port de débogage distant libre), ouvre la page du banc, exécute la sélection, récupère résultats, captures et journaux de console, écrit le cahier de test comme les autres types, puis ferme navigateur et serveur même en cas d'échec ou d'interruption | deux campagnes lancées en même temps ne se gênent pas ; aucun processus restant après la fin ; résultats identiques à la page du banc | ✅ |
| SPEC-BANC-024 | Le rendu sans fenêtre utilise l'accélération matérielle quand elle existe (sinon le rendu logiciel est signalé dans le cahier), à une surface d'au moins 1280×800 (jamais sous 800×600) | l'environnement du cahier porte `accelerationMaterielle` (déduite du renderer WebGL) et une résolution ≥ 1280×800 | ✅ |
| SPEC-BANC-025 | Un préréglage `e2e-fumee` (quelques e2e rapides et représentatifs, < 2 min) est ajouté à pre-push via le préréglage pr ; sans navigateur installé, il est ignoré avec un avertissement, sans échec | `node tests/run.js --preset e2e-fumee --lister` sélectionne au moins un test ; sans Edge/Chrome installé, `tools/hooks/pre-push.js` se termine avec le code 0 après avertissement | ✅ |
| SPEC-BANC-026 | La capture de frames clefs n'est plus laissée à la discrétion de l'auteur d'un test e2e (une dérive visuelle — ex. damier de texture sur le terrain — peut ainsi ne jamais être vue) : `runUnE2E` capture systématiquement une image au tout début et une à la toute fin de **chaque** test end-to-end, qu'il appelle ou non `capture()`/`etape()` lui-même, ainsi qu'au moment d'un échec ou d'un délai dépassé ; les captures explicites (`etape()`, `capture()`) s'ajoutent en plus, jamais à la place ; la campagne sans fenêtre (`tools/e2e-headless.js`) fait de même de l'extérieur (CDP `Page.captureScreenshot`), pour la même garantie en ligne de commande | tout test e2e produit au moins 2 captures non vides même s'il n'appelle jamais `capture()` ; un test qui échoue en cours de route produit en plus une capture « échec » ; un test qui dépasse son délai produit une capture « délai dépassé » | ✅ |
| SPEC-BANC-027 | Le cahier de test (page serveur, export HTML autonome, PDF, Word) affiche **toutes** les captures d'un test, dans l'ordre chronologique où elles ont été prises (début, étapes déclarées dans l'ordre, puis fin ou échec) — pas seulement celles nommées explicitement par le test ; la porte G15 le vérifie sur un cahier réellement généré (préréglage `e2e-fumee`, sans fenêtre), pas seulement par lecture du code source | dans `resultats.json` d'une campagne e2e réelle, chaque test porte `captures.length ≥ 2` et le rendu HTML les affiche dans le même ordre que le tableau `captures` ; G15 échoue si un seul test e2e du cahier généré a moins de 2 captures | ✅ |
| SPEC-BANC-028 | Un **registre officiel VERSIONNÉ dans git** (`tests/registre/`, distinct des cahiers locaux de `tests/resultats/` — gitignorés, rotation normale inchangée) retient, par commit, les résultats et captures des tests jugés dignes de faire foi pour l'historique visuel : `tools/registre.js`. Une campagne de **validation avant push** (préréglages `pr` et `e2e-fumee`, `tools/hooks/pre-push.js`) y inscrit **automatiquement** son cahier (`origine: 'pre-push'`) ; une inscription manuelle (`node tools/registre.js inscrire [cahier]`) porte `origine: 'manuel'` et n'entre pas dans l'historique par défaut | `tests/registre/` n'est PAS dans `.gitignore` (seul `tests/resultats/` l'est) ; après une campagne `pr`/`e2e-fumee`, `tests/registre/entrees.json` porte une nouvelle entrée `origine: 'pre-push'` citant le commit réellement testé (résolu en plein, jamais un HEAD qui aurait avancé depuis) | ✅ |
| SPEC-BANC-029 | L'historique par test n'est plus seulement une **commande** (`tools/registre.js`, `historiqueTest()`/`exporterHistoriqueHTML()`) : c'est une **zone du banc** (`tests/index.html`), au même titre que la zone de rendu 3D, le rapport d'exécution, les tests lents et la sélection (docs/banc/historique-global.md) — un bouton « Historique » dans l'en-tête ouvre la vue globale (SPEC-BANC-033 et suivantes), et un clic sur un test l'ouvre déjà filtrée sur ce test. La commande et ses deux tris (par **ordre de commit** git réel, `git rev-list --topo-order`, par défaut sur le registre officiel ; par **ordre de lancement**, `date` de l'entrée, par défaut avec `--manuel`, qui inclut aussi les inscriptions manuelles) restent la base que sert l'API serveur (SPEC-BANC-040) ; l'export en page web autonome (captures en data URI) reste possible en ligne de commande, en plus de l'export CSV/HTML de la vue filtrée (SPEC-BANC-038) | pour un test présent dans N entrées du registre officiel, `historiqueTest()` rend N entrées triées selon `git rev-list --topo-order`, jamais l'ordre d'horodatage local ; `--manuel` fait apparaître aussi les entrées `origine: 'manuel'`, triées par `date` ; `exporterHistoriqueHTML()` produit une page autonome contenant toutes les captures des N runs ; le bouton « Historique » de l'en-tête du banc et le clic sur un test ouvrent la même zone (SPEC-BANC-033), pré-filtrée sur ce test dans le second cas | ⏳ |
| SPEC-BANC-030 | Un **témoin** (image de référence pour un test) est épinglable à la main sur une capture précise d'un commit donné (`node tools/registre.js temoin <testId> <commit> <hash>`, persisté dans `tests/registre/temoins.json`, versionné) et mis en évidence dans la vue historique ; à défaut d'épinglage explicite (ou si l'entrée épinglée a disparu de l'historique demandé), le témoin par défaut est la dernière capture de la dernière entrée `origine: 'pre-push'` — le dernier état officiellement validé avant un push | sans épinglage, le témoin proposé est celui de la dernière entrée `pre-push` contenant ce test ; après `temoin`, c'est la capture épinglée qui ressort, marquée comme telle dans l'export HTML, même si une entrée plus récente existe depuis ; `marquerTemoin` refuse un commit/hash qui ne correspond à aucune capture réelle de ce test dans le registre | ✅ |
| SPEC-BANC-031 | Le registre reste léger dans git par **stockage adressé par contenu** (`tests/registre/images/<sha1>.<ext>` : deux captures identiques octet pour octet, même de commits différents, partagent le même fichier, jamais recopié) et par un **pont automatique** entre `pre-push` (après le commit testé, ne peut pas y entrer) et `pre-commit` (au commit SUIVANT, `tools/hooks/pre-commit.js` détecte les entrées `en_attente`, les repasse à `ok` et les ajoute — `git add tests/registre` — au commit en cours, sans jamais perdre le commit qu'elles décrivent réellement) ; `node tools/registre.js commit` committe à la main les entrées en attente, avec un message `test(registre): …`, sans ligne de coattribution | une capture réinscrite avec le même contenu ne crée pas de second fichier dans `images/` ; une entrée `en_attente` laissée par `pre-push` est absente de `git status` jusqu'au commit suivant, où elle apparaît automatiquement dans l'arbre indexé sans action manuelle | ✅ |
| SPEC-BANC-032 | Le format d'entrée du registre (et des cahiers locaux, mêmes champs) est conçu pour l'historique global à venir (docs/banc/historique-global.md) SANS migration : chaque run porte `id`, `inscrit`, `motif` (facultatif), `arbre_modifie` (capturé au DÉBUT de la campagne locale, jamais recalculé après coup) et `interrompu` ; chaque test porte en plus une IDENTITÉ instantanée du catalogue au moment du run (`categorie: {type, groupe}`, `domaines`, `specs`, `etiquettes`, `fonctions` — vide pour l'instant, l'observation automatique est un lot séparé) et `erreur` (au lieu de `message`) ; `inscrire()` est idempotente (refuse un cahier déjà inscrit) et accepte un `motif` ; `runsUnifies()` fusionne registre et cahiers locaux sous UNE SEULE forme (`inscrit` les distingue, un cahier déjà inscrit ne compte jamais deux fois) ; une capture manuelle nommée en cours de test (`capture('apres-teleportation')`, déjà supportée par tests/e2e.js) porte un rôle (`debut`/`intermediaire`/`fin`) et un `t_ms` stables d'un run à l'autre | une seconde inscription du même cahier est refusée avec un motif explicite ; `runsUnifies()` ne compte jamais un cahier local déjà inscrit deux fois ; un test du registre et son équivalent local partagent exactement les mêmes clés ; `etatRegistre` classe un succès lent (> seuil) ou porteur d'un message en `avertissement`, jamais en échec | ✅ |

### Historique global : source, tableau, tri, filtres (docs/banc/historique-global.md §1 à §3.1)

| SPEC-BANC-033 | Un **historique global** agrège en une seule zone du banc (`tests/index.html`), au même titre que le rendu 3D, le rapport, les tests lents et la sélection, TOUTES les lignes test×run fusionnées par `tools/registre.js` (registre officiel `tests/registre/entrees/*.json`, versionné, et cahiers locaux `tests/resultats/`, non versionnés, limités aux N derniers) : granularité une ligne = un test dans un run. La zone s'ouvre par un bouton « Historique » dans l'en-tête, ou déjà filtrée sur un test par un clic sur ce test dans la sélection | ouvrir la zone Historique depuis l'en-tête affiche des lignes issues à la fois du registre et des cahiers locaux ; cliquer un test dans la sélection ouvre la même zone déjà filtrée sur ce test | ⏳ |
| SPEC-BANC-034 | Chaque propriété de la ligne (run, `debut_run`, commit/commit_court/sujet_commit, `rang_commit`, branche, preset, origine, inscrit, test, nom, categorie, domaines, specs, fonctions, etiquettes, fiche, `debut_test`, `duree_ms`, etat, erreur, `nb_captures`, captures) a sa **colonne** ; un sélecteur « Colonnes » affiche ou masque chacune, choix mémorisé dans `localStorage` (lecture et écriture encadrées par try/catch, la page reste utilisable sans stockage disponible) | décocher une colonne la retire du tableau ; recharger la page (stockage disponible) restitue le même jeu de colonnes affichées | ⏳ |
| SPEC-BANC-035 | Le tri est **multi-clés** : un clic sur un en-tête de colonne trie par ordre croissant, puis décroissant, puis aucun tri ; Maj+clic ajoute un tri secondaire sur cette colonne sans perdre le tri principal | trier par état puis Maj+clic sur durée : les lignes sont groupées par état, et à état égal triées par durée ; un troisième clic sur la première colonne retire tout tri | ⏳ |
| SPEC-BANC-036 | Chaque colonne se filtre selon son **type** : texte → « contient » (test, nom, erreur, sujet de commit) ; énumération → multi-sélection avec effectif de chaque valeur (état, type, branche, preset, origine, inscrit) ; nombre → min/max (durée, nombre de captures) ; horodatage → de/à (début de run, début de test) ; commit → plage entre deux commits de la branche principale (bornée par `rang_commit`) | un filtre texte sur « erreur » ne garde que les lignes dont le message contient la chaîne ; un filtre énumération sur « état » affiche l'effectif de chaque valeur cochable et ne garde que les valeurs cochées ; un filtre commit entre deux rangs ne garde que les lignes de rang_commit dans l'intervalle | ⏳ |
| SPEC-BANC-037 | Des **filtres rapides** combinent des critères courants en un clic : « inscrits seulement » (coché par défaut à l'ouverture de la vue officielle), « tous les runs », « échecs », « lents » | activer « échecs » ne garde que les lignes d'état `echec` ; activer « inscrits seulement » puis « tous les runs » restitue le jeu complet | ⏳ |
| SPEC-BANC-038 | La liste est **paginée côté serveur**, taille de page réglable, avec un **export CSV** et un **export HTML** de la vue filtrée courante (mêmes colonnes affichées, mêmes filtres et tri) | changer la taille de page recharge la même vue avec le nombre de lignes demandé ; l'export CSV d'une vue filtrée sur un domaine ne contient que les lignes de ce domaine, avec les colonnes actuellement affichées | ⏳ |
| SPEC-BANC-039 | Un clic sur une ligne du tableau ouvre le **panneau « test »** (SPEC-BANC-046 et suivantes) sur ce test, avec le run cliqué déjà sélectionné | cliquer une ligne d'un test précis dans un run précis ouvre son panneau positionné sur ce run, pas sur le dernier run du test | ⏳ |
| SPEC-BANC-040 | Le serveur expose `GET /tests/historique/lignes` (tri, ordre, filtre JSON, page, taille — renvoie aussi le total et, pour chaque énumération, les valeurs distinctes avec leur effectif), `GET /tests/historique/series` (agrégats pour les graphiques), `GET /tests/historique/images` (pour un test, la suite ordonnée des runs avec leurs captures groupées par rôle) et `GET /tests/registre/images/<sha1>.<ext>` (images adressées par contenu, cache long car immuables) ; un index en mémoire est reconstruit seulement quand le dossier source change (mtime), pas à chaque requête | une requête `lignes` avec un filtre JSON renvoie exactement les lignes attendues, le `total` correspondant et les effectifs par valeur d'énumération ; deux requêtes successives sans modification du dossier ne reconstruisent pas l'index (compteur de reconstructions inchangé) | ⏳ |

### Graphiques (timeline) (§3.2)

| SPEC-BANC-041 | L'utilisateur choisit par cases à cocher les **propriétés à tracer** et l'**axe X** : horodatage de démarrage (ordre de lancement) ou commit de référence (rang topologique, étiquette commit court + sujet au survol) | cocher `duree_ms` fait apparaître sa courbe ; choisir l'axe commit réordonne les points selon `rang_commit`, pas selon `debut_run` | ⏳ |
| SPEC-BANC-042 | Le rendu suit le **type de la propriété** : `etat` en barres empilées par run (réussis vert, échecs rouge, ignorés gris, avertissements orange), ou en bande de pastilles colorées (un run par pastille) quand le filtre ne retient qu'un seul test | filtrer sur un seul test fait basculer le graphique `etat` de barres empilées à une bande de pastilles, une par run filtré | ⏳ |
| SPEC-BANC-043 | `duree_ms` se trace en courbe (médiane et p95 par run s'il y a plusieurs tests, valeur brute pour un test seul), avec le seuil « lent » tracé en pointillés ; `nb_captures` et toute autre propriété numérique choisie se trace aussi en courbe | filtrer sur plusieurs tests fait tracer médiane et p95 par run ; filtrer sur un seul test fait tracer sa durée brute ; la ligne de seuil « lent » apparaît en pointillés au niveau attendu | ⏳ |
| SPEC-BANC-044 | Une **vue matrice** optionnelle affiche les tests en lignes et les runs en colonnes, chaque cellule colorée par état | activer la vue matrice sur une sélection de N tests et M runs affiche une grille N×M colorée cohérente avec le tableau (SPEC-BANC-036) | ⏳ |
| SPEC-BANC-045 | Le survol d'un point affiche une infobulle (run, commit, date, valeur) ; un clic sur un point filtre le tableau sur ce run (ou ce commit) ; les graphiques suivent en permanence les filtres actifs du tableau (bibliothèque Chart.js depuis cdnjs, ou SVG écrit à la main, sans dépendance npm) | cliquer un point du graphique applique au tableau un filtre sur le run correspondant ; changer un filtre du tableau met à jour les graphiques sans rechargement de page | ⏳ |

### Panneau « test » : un diaporama par image, témoin, comparaison (§3.3)

| SPEC-BANC-046 | Un test produit plusieurs images (rôle `debut`, une par image clé intermédiaire identifiée par son libellé stable, rôle `fin`) ; le panneau d'un run affiche ces images en **vignettes fixes**, dans l'ordre du test (première, intermédiaires par `t_ms`, dernière), sans défilement automatique | le panneau d'un run d'un test à trois images clés affiche trois vignettes fixes, dans l'ordre début/intermédiaire/fin | ⏳ |
| SPEC-BANC-047 | **Aucun diaporama ne s'affiche ni ne défile par défaut** : un clic sur une vignette ouvre le diaporama de CETTE image, positionné sur le run cliqué ; les autres images ne s'ouvrent que si on clique dessus à leur tour | ouvrir le panneau d'un run ne fait apparaître aucun diaporama ; cliquer une seule vignette n'ouvre que le diaporama de cette image, les autres restent en vignette fixe | ⏳ |
| SPEC-BANC-048 | Chaque image a **son propre diaporama**, qui parcourt l'historique de cette image précise (identité = test, rôle, libellé) à travers les runs de ce test, dans l'ordre du tri choisi (lancement ou commit) et avec les filtres actifs ; sous l'image : date, commit court + sujet, état, durée, inscrit ou non ; un run qui n'a pas cette image affiche une case « pas de capture » plutôt que de sauter le run | pour une image clé présente dans N runs sur M, son diaporama présente M positions dont N avec image et (M−N) marquées « pas de capture », dans l'ordre du tri choisi | ⏳ |
| SPEC-BANC-049 | Plusieurs diaporamas peuvent être ouverts en même temps (un par vignette cliquée), côte à côte dans une zone qui passe à la ligne selon la largeur, chacun avec son bouton de fermeture ; ils sont **indépendants** par défaut, un bouton « synchroniser » les aligne sur le même run | ouvrir deux diaporamas et avancer l'un ne déplace pas l'autre ; activer « synchroniser » aligne les deux sur le même run | ⏳ |
| SPEC-BANC-050 | Navigation par flèches et curseur de position dans un diaporama ; la lecture automatique ne démarre que sur action explicite (bouton lecture), vitesse réglable | la flèche droite avance d'un run ; le curseur déplacé directement va à ce run ; la lecture auto ne démarre pas à l'ouverture du diaporama | ⏳ |
| SPEC-BANC-051 | Un **témoin** (image épinglée, sinon la dernière capture inscrite) reste affiché en vignette fixe au-dessus de chaque diaporama ; une bascule « comparer » superpose témoin et image courante avec un curseur de rideau (glisser pour révéler l'une ou l'autre) ou en clignotement ; aucun diff automatique ne décide, c'est un humain qui juge l'écart | sans épinglage, le témoin affiché est la dernière capture inscrite ; activer « comparer » affiche le rideau ou le clignotement entre témoin et image courante du diaporama | ⏳ |
| SPEC-BANC-052 | Un bouton « épingler comme témoin » sur l'image affichée appelle `node tools/registre.js temoin` via une route POST | cliquer « épingler comme témoin » sur une image d'un run précis marque cette capture comme témoin (persistée dans `tests/registre/temoins.json`) et elle ressort comme telle dans les diaporamas suivants | ⏳ |

### Inscrire un run manuel au registre depuis le banc (§3.4)

| SPEC-BANC-053 | Dès qu'une campagne lancée depuis l'interface web se termine (y compris après un arrêt manuel, l'entrée est alors marquée `interrompu`), le résumé de fin (`#resume`) affiche un bouton **« Inscrire au registre »**, à côté du lien vers le cahier | à la fin d'une campagne lancée dans le navigateur, le résumé affiche le bouton, y compris après un arrêt manuel, où l'entrée à venir porte `interrompu: true` | ⏳ |
| SPEC-BANC-054 | Le clic appelle `POST /tests/registre/inscrire` avec l'identifiant du cahier ; le serveur appelle la même fonction que `node tools/registre.js inscrire` : copie des captures dans le stockage adressé par contenu, création de l'entrée avec `origine: 'manuel'`, `inscrit: true`, `statut: 'en_attente'` ; le commit suivant l'intègre, comme une entrée pre-push | cliquer le bouton crée une entrée `origine: 'manuel'`, `statut: 'en_attente'` dans le registre, avec ses captures copiées dans le stockage adressé par contenu ; le commit suivant l'intègre à l'arbre versionné, comme le fait déjà `pre-commit` pour les entrées `pre-push` | ⏳ |
| SPEC-BANC-055 | Un champ facultatif « motif » (texte court) est enregistré dans l'entrée créée par ce bouton et apparaît comme une colonne de l'historique | saisir un motif avant de cliquer « Inscrire au registre » le fait apparaître dans la colonne `motif` de l'historique pour cette ligne | ⏳ |
| SPEC-BANC-056 | Après inscription, le bouton devient « Inscrit ✓ » et affiche un lien vers la vue historique filtrée sur ce run ; inscrire deux fois le même cahier est refusé avec un message clair (idempotence) | après le premier clic, le bouton change de libellé et le lien ouvre l'historique filtré sur ce run ; un second clic sur le même cahier est refusé avec un message explicite, sans créer de seconde entrée | ⏳ |
| SPEC-BANC-057 | Le même bouton existe dans l'historique global sur toute ligne ou tout run `inscrit: false` encore présent dans les cahiers locaux, pour promouvoir un run après coup | une ligne d'historique correspondant à un cahier local non inscrit affiche le bouton « Inscrire au registre » ; une ligne déjà inscrite ne l'affiche pas | ⏳ |
| SPEC-BANC-058 | Si le dépôt contient des modifications non commitées au moment de l'inscription, l'entrée cite le commit HEAD et porte `arbre_modifie: true`, affiché en avertissement dans l'historique puisque le code testé n'est pas exactement ce commit | inscrire un cahier alors que `git status` montre des fichiers modifiés crée une entrée `arbre_modifie: true`, affichée avec un avertissement visible dans l'historique | ⏳ |

### Fiche avant résultats, tags, catégories, domaines, specs, fonctions (§3.5)

| SPEC-BANC-059 | Dans le rapport de campagne, le cahier et ses exports, le panneau d'un run dans l'historique et la vue par test, chaque test s'affiche dans cet ordre : 1) identité (id, nom, catégorie, domaines, specs, fonctions, étiquettes) ; 2) fiche (ce qui est testé, pourquoi, résultat attendu, source déclarée ou déduite de la spec) ; 3) résultat (état, durée, erreur, puis vignettes des captures) | dans le rendu HTML d'un cahier et dans le panneau d'un run de l'historique, l'identité précède toujours la fiche, qui précède toujours le résultat, pour chaque test affiché | ⏳ |
| SPEC-BANC-060 | La fiche et les tags sont copiés dans l'entrée du run au moment où il tourne (**instantané**) : une fiche modifiée plus tard ne réécrit pas l'historique, on voit ce que le test prétendait vérifier au moment où il a tourné | modifier la fiche d'un test dans le catalogue après un run n'altère pas la fiche affichée pour ce run passé dans l'historique | ⏳ |
| SPEC-BANC-061 | `etiquettes` est la liste de tags libres, déclarés dans la fiche du test ou de son groupe ; une liste de tags recommandés figure dans le README du registre (`rendu`, `reseau`, `lent`, `instable`, `regression:<date>`…), sans interdiction d'en créer de nouveaux | un test déclarant une étiquette non listée dans le README n'est ni rejeté ni signalé en erreur ; il apparaît normalement dans le catalogue et l'historique | ⏳ |
| SPEC-BANC-062 | Les **fonctions** viennent de deux sources fusionnées et distinguées à l'affichage : `fonctions` déclarées dans la fiche (la cible du test) et fonctions **observées** en exécution Node (les fonctions exportées des modules `MC.*` sont enveloppées pendant chaque test, celles appelées sont enregistrées avec nom qualifié et nombre d'appels) ; l'observation est la valeur par défaut pour un test sans déclaration, comme la fiche déduite de la spec ; désactivable par `--sans-fonctions` si elle pèse trop sur la durée, avec son surcoût mesuré et affiché, et G12 mesuré sans elle ; pour les e2e, l'observation est facultative (même enveloppe injectée dans la page), sinon seules les fonctions déclarées comptent | un test Node sans `fonctions` déclarées appelant `MC.Mesher.tileOrigin` fait apparaître `MC.Mesher.tileOrigin` dans ses fonctions observées avec un compteur d'appels ≥ 1 ; lancer avec `--sans-fonctions` désactive l'enveloppe et affiche le surcoût mesuré de l'observation | ⏳ |
| SPEC-BANC-063 | Catégorie, domaines, specs, fonctions et étiquettes sont des colonnes filtrables du tableau, avec multi-sélection et effectifs ; pour les colonnes-listes (domaines, specs, fonctions, étiquettes), un test compte dans chacune de ses valeurs | filtrer sur un domaine avec le multi-sélecteur ne garde que les tests qui déclarent ce domaine dans leur liste ; un test à deux domaines compte dans l'effectif des deux | ⏳ |
| SPEC-BANC-064 | Un panneau **« Répartition »** affiche, pour la vue filtrée courante et la dimension choisie (catégorie, domaine, spec, fonction ou étiquette), un tableau et un graphique en barres : nombre de tests, réussis, échecs, ignorés, avertissements, durée cumulée ; un clic sur une barre filtre sur cette valeur | choisir la dimension « domaine » dans le panneau Répartition affiche un tableau et un graphique par domaine avec les cinq compteurs et la durée cumulée ; cliquer la barre d'un domaine filtre le tableau principal sur ce domaine | ⏳ |
| SPEC-BANC-065 | La zone de sélection du banc se regroupe, au choix, par catégorie, domaine, spec, fonction ou étiquette, avec les effectifs, pour permettre par exemple de lancer « tous les tests qui touchent `MC.Mesher.tileOrigin` » | regrouper la sélection par fonction et cocher `MC.Mesher.tileOrigin` sélectionne exactement les tests qui la déclarent ou l'ont observée | ⏳ |
| SPEC-BANC-066 | La porte **G14 est étendue** : 100 % des tests ont au moins un domaine et au moins une fonction (déclarée ou observée) | `node tests/gates.js` (G14) échoue si un test du catalogue n'a ni domaine ni fonction (déclarée ou observée), réussit sinon | ⏳ |

### Périmètre d'exécution : carte d'impact, calcul, repli, crochets, trous de périmètre (§3.6)

| SPEC-BANC-067 | Une **carte d'impact** versionnée (`tests/registre/impact.json`) est construite à chaque run complet inscrit (PR/merge) à partir des fonctions observées (SPEC-BANC-062) : `fonction qualifiée → [tests]`, `fichier source → [fonctions qu'il définit]` (déduit en chargeant les modules, chaque `MC.X` rattaché à son fichier `src/x.js`), et le commit sur lequel la carte a été construite | après un run complet inscrit, `tests/registre/impact.json` contient une entrée pour `MC.Mesher.tileOrigin` listant au moins les tests qui l'appellent, une entrée `src/mesher.js` listant les fonctions qu'il définit, et le commit de construction | ⏳ |
| SPEC-BANC-068 | `node tools/perimetre.js [--depuis <ref>]` calcule le périmètre d'exécution dans l'ordre : 1) fichier de test modifié/ajouté → tous les tests de ce fichier ; 2) fichier `src/*.js` modifié → fonctions touchées par le diff (plages de lignes du `git diff -U0` croisées avec les bornes de chaque fonction, découpage syntaxique léger ; si les bornes ne peuvent pas être déterminées, tout le fichier) → tests qui appellent ces fonctions selon la carte ; 3) tests sans données d'impact (nouveaux ou jamais observés) → sélectionnés s'ils partagent un domaine ou une fonction déclarée avec les fichiers touchés ; 4) toujours ajoutés : l'ensemble « fumée » et les tests étiquetés `toujours` | modifier une seule fonction de `src/mesher.js` (plage de lignes connue) fait sélectionner par `tools/perimetre.js --lister` exactement les tests qui l'appellent selon la carte, plus l'ensemble fumée et les tests `toujours` ; un fichier de test modifié seul sélectionne tous les tests de ce fichier | ⏳ |
| SPEC-BANC-069 | Le calcul se **replie sur la suite complète** si le moteur ne peut pas conclure avec confiance : fichier touché hors `src/` et hors fichiers de test (harness, catalogue, run.js, gates.js, server.js, tools/, index.html…), carte absente, carte construite sur un commit trop éloigné (plus de 50 commits, réglable), ou fichier `src/` absent de la carte (nouveau module) | modifier `server.js` seul fait replier `tools/perimetre.js` sur la suite complète ; une carte absente ou construite à plus de 50 commits du HEAD courant produit le même repli, avec la raison rapportée | ⏳ |
| SPEC-BANC-070 | Chaque run restreint enregistre dans son cahier : fichiers touchés, fonctions touchées, raison de sélection de chaque test (`fichier-de-test`, `fonction:MC.X.f`, `domaine:RENDU`, `fumee`, `toujours`), le nombre de tests exclus, et la raison d'un éventuel repli ; l'historique porte une colonne `perimetre` (`complet` \| `commit` \| `manuel`) et une colonne `raison_selection` ; seuls les runs complets alimentent la carte d'impact et servent de témoins par défaut | le cahier d'un run restreint par périmètre contient la liste des fichiers et fonctions touchés et une raison de sélection par test retenu ; l'historique affiche `perimetre` et `raison_selection` pour ce run ; un run restreint n'alimente pas `tests/registre/impact.json` | ⏳ |
| SPEC-BANC-071 | `pre-commit` lance `--preset commit` restreint au périmètre du commit (`tools/domaines-touches.js` devient l'étape 3 du calcul de périmètre) ; le filet de sécurité anti-deadlock est le filet commun de 15 min (SPEC-BANC-010 révisée), sans délai spécifique au crochet | `pre-commit` sur un commit qui ne touche qu'un fichier `src/x.js` connu de la carte lance uniquement les tests que `tools/perimetre.js` retient pour ce fichier, dans le délai commun de 15 min | ⏳ |
| SPEC-BANC-072 | `pre-push` (= validation de PR) lance la suite complète, portes comprises, inscrit automatiquement au registre et reconstruit la carte d'impact | après un `pre-push` réussi, `tests/registre/impact.json` est reconstruit avec le commit courant et une entrée `origine: 'pre-push'` apparaît dans le registre | ⏳ |
| SPEC-BANC-073 | Un commit de merge déclenche la suite complète : sans conflit, le nouveau crochet `pre-merge-commit` (ajouté dans `.githooks`) ; avec conflits résolus, `pre-commit` détecte `MERGE_HEAD` et passe en suite complète plutôt qu'en périmètre du commit | un merge sans conflit déclenche `pre-merge-commit`, qui lance la suite complète ; un merge avec conflits résolus fait détecter `MERGE_HEAD` par `pre-commit`, qui lance alors la suite complète au lieu du périmètre restreint | ⏳ |
| SPEC-BANC-074 | La zone de sélection du banc web propose « Périmètre du commit » (fichiers indexés), « Périmètre depuis… » (une ref, par ex. `master`) et « Tout », avec l'aperçu des tests retenus et leur raison de sélection **avant** de lancer | choisir « Périmètre du commit » dans le banc affiche la liste des tests retenus et leur raison avant tout lancement, sans exécuter de test tant qu'on n'a pas confirmé | ⏳ |
| SPEC-BANC-075 | La porte **G13 est étendue** : `pre-commit` → périmètre, `pre-push` et `pre-merge-commit` → suite complète | `node tests/gates.js` (G13) vérifie que `pre-commit.js` calcule un périmètre non vide pour un cas connu, et que `pre-push.js`/`pre-merge-commit.js` citent bien le préréglage `pr` en entier | ⏳ |
| SPEC-BANC-076 | À chaque run complet, pour chaque test qui échoue, on vérifie si le dernier `pre-commit` l'aurait sélectionné pour les fichiers changés depuis le run complet précédent ; un échec que le périmètre aurait raté est signalé en avertissement (« trou de périmètre ») dans le rapport et l'historique — ce signal dit si la carte est digne de confiance | un test qui échoue dans un run complet, alors que le dernier calcul de périmètre pour les mêmes fichiers ne l'aurait pas sélectionné, produit un avertissement « trou de périmètre » visible dans le rapport et l'historique | ⏳ |

### Étapes et triplets d'images (§3.7)

| SPEC-BANC-077 | L'API e2e `T.etape('nom')` ouvre une étape et ferme la précédente ; un test sans étape déclarée a une étape implicite `test` (début et fin du test) | un test e2e qui déclare deux étapes produit trois étapes au total dans son historique de captures (implicite, puis les deux déclarées, la dernière fermant l'implicite) ; un test sans étape n'a que l'étape implicite `test` | ⏳ |
| SPEC-BANC-078 | Un **triplet** est trois images réellement consécutives, lues dans la boucle de rendu juste après `renderer.render()` (lecture du tampon d'image sur les images N, N+1, N+2), la compression JPEG étant différée hors de la boucle ; ni capture d'écran CDP ni `toDataURL` hors boucle, qui sauteraient des images et perturberaient le rendu mesuré | au début et à la fin de chaque étape, exactement 3 images consécutives sont capturées, avec des numéros d'image qui se suivent (N, N+1, N+2), pas des images espacées | ⏳ |
| SPEC-BANC-079 | Chaque image du triplet porte : horodatage, durée de l'image, position et orientation de la caméra, position du joueur, numéro d'image | chaque image d'un triplet capturé porte ces six informations, et deux images consécutives du même triplet ont des numéros d'image consécutifs | ⏳ |
| SPEC-BANC-080 | L'identité d'un triplet est (test, étape, `debut`\|`fin`, rang 0-2) ; dans l'historique, chaque triplet est une image au sens des diaporamas (SPEC-BANC-048), et sa vignette/diaporama la montre en boucle image par image (clignotement), le mode le plus sensible à l'œil pour un scintillement | le diaporama d'un triplet d'étape lit ses trois images en boucle rapide (clignotement) plutôt qu'en défilement classique | ⏳ |
| SPEC-BANC-081 | Un **score d'instabilité temporelle** par triplet (écart moyen de pixels entre images consécutives et écart de pose de la caméra) est une colonne numérique, tracée dans la timeline, qui signale sans jamais décider | chaque triplet capturé porte un score d'instabilité numérique, disponible comme n'importe quelle métrique numérique dans les graphiques timeline (SPEC-BANC-043) | ⏳ |
| SPEC-BANC-082 | Pour juger un tremblement en mouvement, l'étape fait un **mouvement scripté reproductible** (déplacement ou rotation à vitesse fixe) ; caméra immobile, on juge scintillements et artefacts | une étape qui teste le tremblement en mouvement déplace ou tourne la caméra à une vitesse fixe et documentée, reproductible d'un run à l'autre | ⏳ |
| SPEC-BANC-083 | Tous les triplets vont dans les résultats locaux (environ 143 e2e × 4 étapes × 6 images, ~3400 images, ~70 Mo par run) ; le registre officiel ne garde que l'image centrale de chaque triplet et tous les nombres, sauf pour les tests étiquetés `rendu` ou quand le score d'instabilité dépasse un seuil, où le triplet complet est conservé (stockage adressé par contenu, gratuit pour une scène reproductible qui ne change pas) | l'inscription au registre d'un test non étiqueté `rendu` et sous le seuil d'instabilité ne conserve que l'image centrale de chaque triplet ; un test étiqueté `rendu` conserve les trois images de chaque triplet | ⏳ |

### Rendu reproductible et moteur de rendu (§3.8)

| SPEC-BANC-084 | Chaque test visuel fixe la graine, l'heure du jeu, la météo, la position et l'orientation de la caméra et la résolution (1280×800, jamais sous 800×600) ; les animations non liées au test sont gelées ou réglées sur une horloge déterministe | deux exécutions successives du même test visuel, sur la même machine, produisent des captures pixel-identiques (ou dans une tolérance négligeable) pour les mêmes paramètres fixés | ⏳ |
| SPEC-BANC-085 | Chaque run enregistre son **moteur de rendu** : `GL_RENDERER` et `GL_VENDOR` (via `WEBGL_debug_renderer_info` quand disponible), logiciel ou GPU, navigateur et version, OS, présence ou non d'une fenêtre ; c'est une colonne de l'historique | l'historique affiche pour chaque run son moteur de rendu (logiciel/GPU, navigateur, OS, avec/sans fenêtre), filtrable comme les autres colonnes | ⏳ |
| SPEC-BANC-086 | Un témoin ne se compare qu'à un run du **même moteur de rendu** ; le témoin par défaut est le dernier inscrit sur ce même moteur ; s'il n'y en a pas, le panneau le dit plutôt que de comparer des pommes et des oranges | comparer une capture rendue en logiciel à un témoin proposé n'affiche jamais un témoin rendu sur GPU réel ; sans témoin sur le même moteur, le panneau affiche un message explicite au lieu d'une comparaison | ⏳ |

### Métriques de performance par test (§3.9)

| SPEC-BANC-087 | Chaque test (et chaque étape pour les e2e) porte des colonnes numériques : images par seconde, temps d'image p50 et p95, appels de dessin (`renderer.info.render.calls`), triangles, géométries et textures en mémoire (`renderer.info.memory`), tas JS quand le navigateur l'expose ; elles sont tracées dans la timeline et repèrent l'alourdissement du code avant que les tests ralentissent (G9 et G12 s'y appuient) | un test e2e produit ces métriques par étape, disponibles comme colonnes du tableau et traçables en timeline (SPEC-BANC-041) ; une régression progressive de `renderer.info.render.calls` sur plusieurs runs successifs se lit dans la courbe correspondante | ⏳ |

### Score d'instabilité des tests (§3.10)

| SPEC-BANC-088 | Un test qui alterne réussite/échec alors qu'aucune des fonctions qu'il touche (carte d'impact, SPEC-BANC-067) n'a changé entre les runs est étiqueté automatiquement `instable`, avec un score (nombre d'alternances sur les N derniers runs) ; affiché dans le rapport et filtrable ; ne fait pas échouer la porte à lui seul, mais son échec reste un échec | un test qui échoue puis réussit puis échoue sur trois runs consécutifs, sans que les fonctions qu'il touche n'aient changé, est étiqueté `instable` avec un score de 2 alternances, visible et filtrable dans le rapport | ⏳ |

### Raison obligatoire (§3.11)

| SPEC-BANC-089 | Les états `ignore` et `avertissement` exigent un champ `raison` non vide (par ex. « pas de WebGL dans cet environnement », « lent : 14 s > seuil 8 s ») ; un test ignoré sans raison devient un échec ; la raison est une colonne filtrable, et la répartition (SPEC-BANC-064) peut compter par raison | un test marqué `ignore` sans `raison` non vide est reclassé en échec par le moteur ; un test `ignore` avec raison garde son état et sa raison apparaît dans la colonne dédiée et dans le panneau Répartition par raison | ⏳ |

### Rétention du registre (§3.12)

| SPEC-BANC-090 | Le registre ne conserve en détail que les runs des commits de merge et de PR depuis la dernière release, et un run par release (le run de validation du commit étiqueté par `tools/version.js --publier`), gardé en détail pour toujours | après une publication, les entrées de merge/PR du cycle qui se termine n'apparaissent plus en détail dans le registre, sauf celle du commit de release, conservée intégralement | ⏳ |
| SPEC-BANC-091 | À chaque publication, `tools/version.js --publier` appelle `node tools/registre.js compacter` : les runs de merge/PR du cycle qui se termine sont compactés (résumé gardé : états, durées, métriques, raisons, commit ; images retirées, sauf témoins encore épinglés) ; les images qui ne sont plus référencées par aucune entrée sont supprimées du stockage ; les runs manuels inscrits suivent la même règle ; les cahiers locaux gardent leur propre limite des N derniers | après `tools/version.js --publier`, une entrée de merge du cycle qui se termine garde son résumé mais n'a plus d'images sauf sa capture témoin épinglée ; une image non référencée par aucune entrée restante disparaît du dossier `tests/registre/images/` | ⏳ |

### Diagnostics joints aux échecs et aux lenteurs (§3.13)

| SPEC-BANC-092 | Tout diagnostic (enregistreur de vol, instantané, erreurs cachées, profils CPU/GPU, réseau) est joint au rapport du test **seulement s'il échoue ou s'il est lent**, sauf les métriques de performance (SPEC-BANC-087), toujours présentes | un test qui réussit sans être lent ne porte dans son rapport aucun tampon de journal, instantané ni profil, seulement ses métriques ; un test en échec ou lent porte les diagnostics applicables | ⏳ |
| SPEC-BANC-093 | Un **enregistreur de vol** : le journal (SPEC-BANC-104) écrit tout, niveaux trace et debug compris, dans un tampon circulaire par test, taille bornée ; vidé dans le rapport en cas d'échec ou de lenteur, jeté sinon | un test qui échoue produit dans son rapport le contenu du tampon circulaire, y compris des entrées de niveau trace/debug qui n'apparaissent jamais à la console ; un test qui réussit et n'est pas lent ne le produit pas | ⏳ |
| SPEC-BANC-094 | Une fonction `MC_DEBUG.instantane()` produit l'**instantané de l'état du jeu** à l'échec (graine, position, heure, météo, chunks chargés/en attente/en maillage, files des workers, versions de chunk, entités, mode réseau) ; le banc l'appelle dans le `finally` du test | un test qui échoue produit un instantané contenant ces champs, même si l'échec survient au milieu du test (appel garanti par le `finally`) | ⏳ |
| SPEC-BANC-095 | Les exceptions non rattrapées et promesses rejetées sont attrapées AVANT les scripts du jeu : `window.addEventListener('error'/'unhandledrejection')` en tête de `tests/index.html` ; sans fenêtre, CDP `Page.addScriptToEvaluateOnNewDocument` doublé de `Runtime.exceptionThrown` | une exception non rattrapée levée par le jeu pendant un test apparaît dans le journal du test, avec sa pile, aussi bien en navigateur qu'en campagne sans fenêtre | ⏳ |
| SPEC-BANC-096 | Les messages du navigateur lui-même (dépréciations, interventions, erreurs de sécurité) sont captés par CDP `Log.entryAdded`, car ils ne passent pas par `console` | une dépréciation émise par le navigateur pendant un test sans fenêtre apparaît dans le journal du test, alors qu'elle n'aurait jamais atteint `console.*` | ⏳ |
| SPEC-BANC-097 | Dans chaque worker, `self.addEventListener('error'/'unhandledrejection')` renvoie l'erreur au fil principal par `postMessage`, capté côté pool (`worker.onerror`/`onmessageerror` dans src/workers.js) ; sans fenêtre, CDP `Target.setAutoAttach` capte aussi la console et les exceptions des workers | une exception levée dans un worker de génération ou de maillage pendant un test apparaît dans le journal de ce test, aussi bien en navigateur qu'en campagne sans fenêtre | ⏳ |
| SPEC-BANC-098 | three.js écrit les erreurs de compilation/liaison des shaders via `console.error` (`renderer.debug.checkShaderErrors` laissé à `true` en test), captées par le journal ; `webglcontextlost`/restauration sont journalisés ; en mode test seulement, `gl.getError()` est interrogé une image sur 60 (synchronisation coûteuse, jamais active en jeu normal) | une erreur de compilation de shader provoquée en test apparaît dans le journal ; une perte de contexte WebGL simulée est journalisée à la perte et à la restauration | ⏳ |
| SPEC-BANC-099 | Les ressources introuvables sont captées par CDP `Network.loadingFailed`/`Network.responseReceived` (statut ≥ 400) ; dans le banc, un écouteur `error` en phase de capture sur `window` attrape les `<script>`/`<img>` qui ne chargent pas ; les erreurs WebSocket (`onerror`, code de `onclose` dans src/net.js) vont au journal | une ressource introuvable provoquée en test (script ou image manquant) apparaît dans le journal, aussi bien en navigateur qu'en campagne sans fenêtre | ⏳ |
| SPEC-BANC-100 | Pour les tests d'intégration, stdout et stderr du processus serveur sont capturés, plus `process.on('uncaughtException'/'unhandledRejection')` | une exception non rattrapée dans le serveur pendant un test d'intégration apparaît dans le journal du test correspondant | ⏳ |
| SPEC-BANC-101 | Les tests lents (tâches longues du fil principal via `PerformanceObserver` sur `longtask` avec leur attribution, histogramme des temps d'image) déclenchent au-delà du seuil un **profil CPU** (CDP `Profiler.start/stop`, fichier `.cpuprofile` joint, ouvrable dans les DevTools) | un test dépassant le seuil de lenteur produit un fichier `.cpuprofile` joint à son rapport, ouvrable sans erreur dans les DevTools Chrome | ⏳ |
| SPEC-BANC-102 | Un **profil GPU en couches** (mémoire GPU allouée par le jeu — `renderer.info.memory` et estimation en octets ; coût de dessin — appels, triangles, programmes par passe ; temps GPU par image/passe via `EXT_disjoint_timer_query_webgl2` en p50/p95 quand disponible ; côté processus — CDP `SystemInfo.getInfo` et trace `gpu`/`disabled-by-default-gpu.service` pour un test lent ; système Windows facultatif — compteurs `typeperf` GPU Process Memory/Engine Utilization, run fenêtré sur vrai GPU seulement), chaque couche indiquant « non disponible » plutôt que simulée quand l'environnement ne la fournit pas | un test lent avec un vrai GPU sous Chrome produit un profil GPU avec au moins les couches mémoire/dessin/processus renseignées ; sans `EXT_disjoint_timer_query_webgl2`, la couche « temps GPU » indique explicitement « non disponible », jamais une valeur inventée | ⏳ |
| SPEC-BANC-103 | Les tests réseau joignent les N derniers messages échangés (sens, type, `seq`, taille, horodatage) côté client et côté serveur, plus le journal du serveur pendant le test | un test réseau en échec joint la liste ordonnée des derniers messages échangés dans les deux sens, avec leur type et horodatage | ⏳ |

### Journal : un vrai logger, `MC.Journal` (§3.14)

| SPEC-BANC-104 | Le module `MC.Journal` (src/journal.js), pur, chargé en premier, est identique dans le navigateur, les workers, Node (tests vm) et server.js | `MC.Journal` se charge et s'exécute sans erreur dans les quatre environnements (navigateur, worker, Node vm, server.js), avec le même comportement observable | ⏳ |
| SPEC-BANC-105 | L'API `var log = MC.Journal('RENDU'); log.trace/debug/info/warn/error/fatal(message, donnees?, erreur?)` produit une entrée portant horodatage, domaine, niveau, message, données structurées, pile de l'erreur, contexte (joueur local, mode, id du test en cours) | appeler `log.error('x', {a:1}, new Error('y'))` produit une entrée avec les sept champs attendus, la pile de l'erreur et le contexte du test en cours | ⏳ |
| SPEC-BANC-106 | Chaque entrée part vers plusieurs **sorties**, chacune avec son seuil : console (par défaut `warn` en jeu, `info` en développement), tampon circulaire (tous niveaux, enregistreur de vol), rapport de test, fichier du serveur avec rotation (`logs/serveur-<date>.log`) ; en multijoueur, les erreurs `error`/`fatal` du client sont remontées au serveur avec un débit limité | en mode jeu, un `log.debug` n'apparaît pas à la console mais apparaît dans le tampon circulaire ; en multijoueur, un `log.error` client apparaît aussi dans le journal du serveur, sans dépasser le débit limité configuré | ⏳ |
| SPEC-BANC-107 | Les messages d'erreur pour le joueur passent par une seule voie : `log.error(message, donnees, erreur, { joueur: 'texte lisible' })` journalise le détail technique ET affiche au joueur un message lisible (toast ou écran d'erreur) — fin des `alert`, `console.error` et toasts dispersés qui divergent | provoquer une erreur de sauvegarde affiche au joueur le message lisible fourni dans `{ joueur }`, tout en journalisant le détail technique complet côté journal | ⏳ |
| SPEC-BANC-108 | Des **codes d'erreur** stables (`E-SAVE-003`…) sont recensés dans un catalogue (docs/erreurs.md) avec leur cause et la conduite à tenir, retrouvables au grep dans les rapports et le journal du serveur | chaque code d'erreur utilisé dans le code apparaît dans docs/erreurs.md avec sa cause et sa conduite ; grep d'un code dans un rapport de test retrouve son usage | ⏳ |
| SPEC-BANC-109 | **Réglage à chaud** du niveau de journal : paramètre d'URL `?journal=RENDU:debug,SYNC:trace`, `MC_DEBUG.journal.niveau('SYNC', 'trace')`, option serveur `--journal` | ouvrir le jeu avec `?journal=SYNC:trace` fait apparaître les entrées `trace` du domaine SYNC dans le tampon, sans redémarrage ; `MC_DEBUG.journal.niveau()` change le seuil d'un domaine en cours de partie | ⏳ |
| SPEC-BANC-110 | Les `console.*` de src/ et server.js passent tous par le journal (migration) ; une porte **G16** interdit tout nouveau `console.*` direct hors de src/journal.js | `node tests/gates.js` (G16) échoue si un fichier de src/ ou server.js (hors src/journal.js) appelle `console.*` directement, réussit sinon | ⏳ |

### Campagnes sur l'historique des merges, PR et releases (§3.15)

| SPEC-BANC-111 | `node tools/registre.js historiser [--depuis <ref>]` lance, pour chaque commit de merge ou de PR et chaque commit de release de l'historique, dans l'ordre, une **vraie campagne complète** sur ce commit — ce ne sont pas des runs à part, ce sont des campagnes comme les autres, sans marqueur spécial | lancer `historiser --depuis <ref>` sur un historique de test contenant trois merges produit trois entrées de registre indiscernables structurellement d'une entrée `pre-push` ordinaire, hormis leurs métadonnées de commit | ⏳ |
| SPEC-BANC-112 | Chaque commit est rejoué dans un **worktree temporaire** sur ce commit (code du jeu et tests venant de ce commit) ; l'orchestration, les captures (CDP), les diagnostics et l'écriture du registre viennent du moteur ACTUEL ; l'entrée enregistre la version du moteur de test qui l'a produite | l'entrée produite pour un vieux commit contient le code de test de ce commit (dans son worktree), mais la version du moteur de test enregistrée est celle du dépôt courant | ⏳ |
| SPEC-BANC-113 | Les métadonnées sont tirées de git : message du merge, parents, branche fusionnée, auteur, date du commit, fichiers modifiés, `VERSION_JEU` de ce commit, étiquette de release ; `debut_run` reste l'heure réelle d'exécution de la campagne historisée, pas la date du commit | l'entrée produite pour un commit de merge porte son message, ses parents, la branche fusionnée, `VERSION_JEU` de ce commit, et un `debut_run` égal à l'heure de lancement de `historiser`, pas à la date du commit | ⏳ |
| SPEC-BANC-114 | Un test que le moteur ne peut pas faire tourner sur un commit donné (ex. API disparue depuis) est marqué `ignore`, avec une raison explicite, et ne compte jamais comme réussi | un test dont l'appel échoue pour incompatibilité avec le commit rejoué est marqué `ignore` avec une raison explicite (pas `echec` ni `reussi`) | ⏳ |
| SPEC-BANC-115 | La reprise après interruption saute les commits déjà inscrits ; environ 5 à 10 minutes par commit | relancer `historiser` après une interruption ne relance pas les commits déjà présents dans le registre, seulement ceux qui manquent encore | ⏳ |
| SPEC-BANC-116 | La rétention (SPEC-BANC-090/091) s'applique comme pour tout run produit par `historiser` : un run détaillé conservé par release, le reste compacté en résumé | après une publication suivant une campagne `historiser`, les entrées de merge/PR qu'elle a produites pour le cycle qui se termine sont compactées comme n'importe quelle autre entrée, sauf celle de la release | ⏳ |


## L43 — synchronisation permanente

Complète SYNC (serveur autoritaire, IDs 001 à 006 déjà en place) pour que
l'inventaire, l'équipement, les conteneurs, les distributeurs, les véhicules,
la persistance des joueurs, le commerce avec un PNJ et l'état politique soient
tous arbitrés par le serveur et répliqués sans délai à tous les clients
concernés — y compris les deux trous relevés par la revue : les objets au sol,
dont deux audits se contredisaient sur la réplication réseau, et (traité en
L44) une redéfinition de zone par un administrateur. Messages, formes et
bornes de SPEC-SYNC-007 à 017 et 023 : `src/contrats-vague2.js`,
docs/vague-2/B1.md et B2.md ; SPEC-SYNC-027/028 ajoutées par la revue de la
vague 2 (trous de couverture : présentoirs, pose et tir sans inventaire).

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-SYNC-007 | L'inventaire, l'équipement et la grille de fabrication d'un joueur (`state.inv` 36 cases, `state.equip` 5 emplacements, `state.grille` 3×3) sont autoritaires côté serveur : tout ce qui les AUGMENTE ou les DÉPLACE (ramassage, craft, équipement, `MANGER` et son bol rendu, `TROC`, transfert de conteneur, lâcher au sol, palette créative) est validé puis appliqué par le serveur ; les DIMINUTIONS que le client prédit seul (pose de bloc, usure d'outil, munition, engrais, seau vidé) lui sont déclarées par `INV_CONSOMMER` et appliquées si la case les porte, jamais converties en gain. Serveur et client appliquent la même fonction pure (`MC.Conteneurs.appliquer`), hors ligne comme en ligne | test Node pur sur `MC.Conteneurs.appliquer` : avec un inventaire connu, une action dont les objets ne sont pas présents est refusée sans aucun effet de bord, une action valide modifie `inv` exactement ; aucune opération `INV_CONSOMMER` ne peut augmenter une quantité ni changer l'objet d'une case hors de la liste blanche des transformations | ✅ |
| SPEC-SYNC-008 | Après toute action serveur qui modifie l'inventaire, l'équipement ou la grille d'un joueur, et après le refus de toute opération portant un `seq`, le serveur renvoie au client concerné un `INV_MAJ` portant l'état complet (`inv`, `equip`, `grille`), un `rev` croissant et l'`ack` (plus grand `seq` traité, accepté ou refusé) ; le client adopte cet état puis rejoue ses opérations de `seq` > `ack` encore en attente (même principe que `MC.Synchro.reconcilier`) | test d'intégration réseau : un client envoie `CRAFT` avec des ingrédients valides dans sa grille, reçoit `INV_MAJ` (ack = seq du `CRAFT`) reflétant le retrait des ingrédients et l'ajout du résultat ; test Node : la réconciliation d'un état prédit portant deux opérations en attente, dont une seule confirmée, redonne exactement l'état attendu | ✅ |
| SPEC-SYNC-009 | `MANGER` est refusé si l'objet n'est pas présent dans l'inventaire serveur du joueur (à la case `i` si le message la donne, sinon dans la première case qui le porte) ; accepté, l'objet est décrémenté d'une unité dans `state.inv` (et son contenant `rend`, le bol, y est ajouté) avant l'effet (soin/faim) | test d'intégration : `MANGER` avec un `id` absent de l'inventaire serveur ne modifie ni vie ni faim (s'il porte un `seq`, l'`INV_MAJ` renvoyé porte le refus et un inventaire inchangé ; sans `seq`, aucun `INV_MAJ`) ; avec un `id` présent, la quantité diminue de 1 et l'effet s'applique | ✅ |
| SPEC-SYNC-010 | `CRAFT` (client → serveur, `{ j, seq, fois }`) fabrique depuis la grille serveur du joueur (`state.grille`, 3×3, alimentée par `CONTENEUR_TRANSFERT`) : la recette est reconnue par `MC.Inventory.matchRecipe`, chaque fabrication retire une unité de chaque case non vide et ajoute le résultat à `state.inv` ; grille sans recette ou inventaire incapable de recevoir le résultat → refus sans effet de bord, journalisé | test Node pur (`MC.Conteneurs.appliquer`, opération `craft`) : grille valide → grille décrémentée et résultat dans l'inventaire ; grille sans recette ou inventaire plein → refus, grille et inventaire inchangés | ✅ |
| SPEC-SYNC-011 | `EQUIP` (client → serveur, `{ j, seq, slot, i }`) échange `state.inv[i]` et `state.equip[slot]` après avoir vérifié que la pile de `inv[i]`, si la case n'est pas vide, a l'`equipSlot` voulu ; le serveur diffuse aux autres joueurs à moins de 96 blocs un `EQUIP_VU` allégé (`id`, `j`, `slot`, `objet` — jamais l'inventaire) et envoie à un joueur qui arrive l'`EQUIP_VU` des emplacements non vides des joueurs déjà présents | test d'intégration : un deuxième client à portée reçoit `EQUIP_VU` après qu'un premier a équipé une armure qu'il possédait réellement ; un `EQUIP` dont la case porte un objet incompatible, ou dont les deux côtés sont vides, est refusé sans diffusion | ✅ |
| SPEC-SYNC-012 | Un conteneur (coffre, fourneau, armoire, étagère, bibliothèque, distributeur) a un contenu unique tenu par le serveur, identifié par sa position (`x,y,z`), distinct de tout état local client ; la banque est un conteneur de 27 cases propre à chaque joueur nommé, commun à toutes les banques (HABITAT-006) ; le butin d'un coffre de donjon est tiré par le serveur à la première ouverture (`monde.butinCoffre`, `coffresPilles`). Présentoirs et socles relèvent de SPEC-SYNC-027 | test Node : deux états joueur simulés qui ouvrent le même conteneur serveur lisent le même contenu après une modification par l'un des deux ; deux joueurs différents ont chacun leur propre banque | ✅ |
| SPEC-SYNC-013 | `CONTENEUR_OUVRIR` (client → serveur, `{ j, x, y, z }`, ou `{ j, eid }` pour la banque d'un banquier) abonne le joueur local à un conteneur dont le centre est à au plus 6 blocs de son œil (PNJ : à 6 blocs) ; le serveur répond par `CONTENEUR_ETAT` (contenu complet, `rev`) ; `CONTENEUR_FERMER` désabonne ; une déconnexion désabonne de tout | test d'intégration : un client hors de portée voit `CONTENEUR_OUVRIR` refusé (aucun `CONTENEUR_ETAT`) ; un client à portée reçoit `CONTENEUR_ETAT` puis n'est plus destinataire des mises à jour après `CONTENEUR_FERMER` | ⏳ |
| SPEC-SYNC-014 | `CONTENEUR_TRANSFERT` (client → serveur, `{ j, seq, de, vers, n }`, emplacements `inv`, `grille` ou `cont`) déplace des objets uniquement côté serveur, atomiquement (tout ou rien) ; il est refusé si la source ne contient pas la quantité demandée, si la destination ne peut pas la recevoir (pleine, autre objet sans échange complet possible, case interdite comme la sortie d'un fourneau), ou si le joueur n'est pas abonné au conteneur visé ou en est sorti de portée ; un `seq` déjà traité est ignoré (idempotence) | test d'intégration : transfert valide modifie les deux côtés de façon cohérente (somme d'objets conservée) ; transfert invalide (quantité, portée, case pleine) rejeté sans aucun effet de bord ; le même message envoyé deux fois n'a d'effet qu'une fois | ✅ |
| SPEC-SYNC-015 | Toute modification d'un conteneur ouvert est répercutée dans le tic suivant à tous ses abonnés, sans qu'aucun ne rouvre l'interface : l'auteur la reçoit dans son `INV_MAJ` (champ `conteneurs`, même message que son inventaire, donc atomiquement), les AUTRES abonnés par un `CONTENEUR_MAJ` (delta : cases changées, `rev` croissant) ; la progression d'un fourneau (`four.burn`, `four.cook`) est envoyée au plus 2 fois par seconde | test d'intégration à deux clients : le second client, abonné, voit son contenu affiché se mettre à jour après un transfert effectué par le premier, sans nouveau `CONTENEUR_OUVRIR`, et le premier ne reçoit aucun `CONTENEUR_MAJ` pour sa propre action | ⏳ |
| SPEC-SYNC-016 | Un conteneur fermé (aucun abonné) ne génère aucun trafic réseau lié à son contenu, même s'il change (ex. cuisson d'un fourneau) | test d'intégration : un fourneau sans abonné dont la cuisson progresse côté serveur ne produit aucun message sortant tant que personne ne l'a ouvert | ⏳ |
| SPEC-SYNC-017 | Le distributeur est un conteneur serveur comme les autres (SPEC-SYNC-012 à 015). Le message historique `DISTRIB` reste accepté mais ne crée plus rien : il vaut déclaration du contenu voulu, dont le serveur ne retient que ce que le joueur possède — objets ajoutés prélevés dans `state.inv` et tronqués à sa possession réelle, objets retirés rendus à `state.inv` — et seulement à portée (6 blocs) | test d'intégration : un client déclare un distributeur avec un objet jamais possédé ; le contenu accepté côté serveur exclut cet objet, et l'inventaire serveur du client n'est débité qu'une fois de ce qui a été accepté | ✅ |
| SPEC-SYNC-018 | La croissance des cultures calculée par `world.tick()` est diffusée à tous les clients à portée dans le tic où elle survient, comme un changement de bloc | test d'intégration à deux clients dans la même zone de culture : les deux reçoivent un `BLOC` (ou message équivalent) au même changement de stade, sans reconnexion ni action tierce | ⏳ |
| SPEC-SYNC-019 | La propagation et l'extinction du feu calculées côté serveur sont diffusées à tous les clients à portée au tic où elles surviennent | test d'intégration : un incendie démarré par un client B est visible chez un client A dans le délai d'un tic circuits/eau (0,2–0,25 s), sans qu'une pose de bloc tierce ne soit nécessaire pour rafraîchir la zone | ⏳ |
| SPEC-SYNC-020 | L'état d'un joueur (position, yaw/pitch, vie, faim, air, inventaire, équipement, point de réapparition) survit à une déconnexion puis reconnexion sous le même nom, sur le même serveur, sans redémarrage | test d'intégration : un client se déconnecte après avoir modifié son inventaire et sa position, se reconnecte sous le même nom, reçoit dans `BIENVENUE` (ou message dédié) l'état exact laissé à la déconnexion | ⏳ |
| SPEC-SYNC-021 | L'état de chaque joueur connu par nom (SPEC-SYNC-020) et le contenu de tous les conteneurs posés dans le monde (SPEC-SYNC-012) survivent à un arrêt puis relance du serveur avec le même `--monde` | test d'intégration : arrêt propre du serveur après modifications, relance sur le même fichier, un client qui se reconnecte sous un nom déjà connu retrouve son inventaire ; un conteneur ouvert avant l'arrêt retrouve son contenu | ⏳ |
| SPEC-SYNC-022 | Un véhicule (position, occupant, cargaison `soute`) est simulé par le serveur — création, entrée/sortie, commande, physique de base — et répliqué aux clients à portée à la même cadence que les créatures | test d'intégration : deux clients connectés au même véhicule serveur voient la même position (± interpolation) et le même contenu de `soute` à l'ouverture de son interface | ⏳ |
| SPEC-SYNC-023 | Le commerce avec un PNJ (`TROC`) est validé et exécuté uniquement côté serveur : `{ action:'consulter', eid }` renvoie les offres du PNJ au prix courant (SPEC-ECO-001) ; `{ action:'echanger', eid, offre, fois, seq }` échoue (refus porté par l'`INV_MAJ`) si le PNJ est à plus de 6 blocs, si l'offre n'existe pas, si l'objet cédé manque dans l'inventaire serveur, si le stock ou le trésor du lieu ne suffit pas, ou si l'inventaire ne peut pas recevoir la contrepartie ; en cas de succès il modifie `state.inv` du joueur et le stock et le trésor du lieu en une seule opération. C'est l'unique message qui arbitre un échange serveur-autoritaire, y compris les achats/ventes à prix dynamique de l'économie (SPEC-ECO-001) : aucun second message n'est créé pour ce besoin | test Node (`MC.Economie.executerTroc`) : un troc avec objet manquant est rejeté sans effet ; un troc valide modifie inventaire, stock et trésor en une seule opération, sans état intermédiaire observable ; test d'intégration : `echanger` renvoie un `INV_MAJ` (ack) puis les offres aux prix mis à jour | ✅ |
| SPEC-SYNC-024 | Un joueur qui rejoint en cours de partie reçoit dans `BIENVENUE` (ou un message envoyé aussitôt après) l'état complet des relations de faction (PNJ et joueurs), pas seulement les annonces récentes du chat | test d'intégration : un client qui rejoint après plusieurs jours de simulation politique reçoit les mêmes scores/relations qu'un client déjà connecté, sans dépendre de l'historique du chat | ⏳ |
| SPEC-SYNC-025 | L'appartenance de guilde côté client (`g.guildes`) est synchronisée avec l'état serveur (`etatMonde().guildes`), jamais un état local par défaut | test d'intégration : après une commande `/faction rejoindre`, le client affiche la guilde confirmée par le serveur, pas un état vide initial | ⏳ |
| SPEC-SYNC-026 | Les objets au sol (drop/ramassage) sont répliqués aux clients en ligne, avec leur type et leur position, au même titre que les blocs et les mobs, indépendamment de la liste `ETAT.mobs` filtrée par distance | test réseau : un objet lâché par un client à portée d'un second client apparaît dans l'`ETAT` reçu par ce second client avec son type et sa position correcte, sans action tierce ni reconnexion | ⏳ |
| SPEC-SYNC-027 | Le contenu exposé d'un présentoir ou d'un socle (SPEC-INTERIEUR-002) est tenu par le serveur et visible de tous les clients à moins de 96 blocs (pas seulement des abonnés d'un conteneur), y compris d'un joueur qui arrive ensuite | test d'intégration : un objet exposé par un client A apparaît chez un client B à portée sans action de B ; un client qui rejoint ensuite le voit aussi | ⏳ |
| SPEC-SYNC-028 | En survie, une pose de bloc (`BLOC`, id non nul) n'est acceptée que si l'inventaire serveur du joueur porte un objet qui pose ce bloc, et un `TIR` que s'il porte une munition compatible (ou une arme qui n'en consomme pas) ; l'objet est retiré côté serveur | test d'intégration : la pose d'un bloc jamais possédé est refusée (rappel du bloc autoritaire) ; un tir sans flèche ne crée aucun projectile | ⏳ |

## L44 — sécurité et fiabilité du serveur

Nouveau domaine SECU (sécurité réseau) et suite de SERVEUR (IDs 001/002 déjà
en place) : le serveur ne s'arrête plus sur une exception d'un seul client,
borne ses tampons et sa fréquence de messages, valide les coordonnées et la
portée avant toute génération, sécurise ses jetons et ses en-têtes HTTP,
sauvegarde le monde sans geler le jeu, purge ses structures d'administration,
et répercute sans délai une redéfinition de zone par un administrateur.

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-SECU-001 | Une exception levée pendant le traitement d'un message d'un client (`traiter(c, m)`) est rattrapée : ce client peut être fermé, tous les autres restent connectés, le processus serveur ne s'arrête pas | test d'intégration : un message provoquant une exception dans un handler ne déconnecte pas un second client déjà connecté et le serveur répond toujours aux messages suivants | ✅ |
| SPEC-SECU-002 | Une exception non rattrapée ailleurs dans le processus (`uncaughtException`, `unhandledRejection`) est journalisée et n'arrête pas le serveur tant que l'état du monde reste cohérent | test Node : déclencher une exception asynchrone hors handler de message, vérifier que le processus reste actif et que l'événement est journalisé | ✅ |
| SPEC-SECU-003 | Le tampon de réception par connexion (`tampon`) est borné à une taille fixe (ex. 1 Mo) ; au-delà, la connexion est fermée proprement avant qu'aucune trame incomplète ne s'accumule indéfiniment | test d'intégration : un client envoie un en-tête de trame annonçant une longueur énorme sans jamais compléter le corps ; la connexion est fermée et la mémoire du processus reste bornée | ✅ |
| SPEC-SECU-004 | Une trame WebSocket entrante non masquée (bit MASK à 0, hors poignée de main) est rejetée et la connexion fermée, conformément à la RFC 6455 côté serveur | test Node pur sur `net-protocol.js` : une trame non masquée envoyée par un « client » est détectée et provoque un rejet explicite, jamais un décodage silencieux | ✅ |
| SPEC-SECU-005 | Chaque JOUEUR LOCAL (`m.j`, 0 à 3 — un poste peut partager sa connexion entre plusieurs joueurs en écran partagé) est limité en nombre de messages traités par seconde, PAR TYPE de message (hors `ENTREE`, cadencé par ailleurs) : 90/s pour `BLOC` (couvre la casse instantanée en créatif, ~60/s à 60 im/s, avec une marge de 1,5×) et 30/s pour les autres types porteurs d'un joueur local (`BOUGE`, `ATTAQUE`, `TIR`, `MANGER`, `RENAITRE`, `DISTRIB`) ; les messages sans joueur local (`REJOINDRE`, `ADMIN`) sont limités à 30/s PAR CONNEXION. Au-delà du budget, les messages excédentaires sont ignorés sans fermer la connexion ni planter le serveur — un `BLOC` ignoré renvoie au client l'état autoritaire du bloc visé (comme un refus de portée), pour ne jamais laisser un bloc fantôme posé en prédiction locale. Un débit ABERRANT (plus de 10× le budget applicable — hors de portée d'un client honnête) déclenche d'abord un avertissement (message `CHAT` système ciblé), puis une expulsion journalisée s'il persiste plusieurs secondes malgré l'avertissement — jamais pour un débit simplement soutenu | test d'intégration : une rafale de messages `BLOC` dépassant le budget ne produit qu'un nombre borné d'actions appliquées, le client reste connecté et reçoit un rappel du bloc autoritaire pour les messages ignorés ; 4 joueurs locaux à ~60 `BLOC`/s chacun ne sont jamais expulsés ; un débit à plus de 10× le budget déclenche un avertissement puis une expulsion s'il persiste | ✅ |
| SPEC-SECU-006 | Le chat applique une limite de fréquence par CONNEXION (le chat n'a pas de joueur local propre) : 5 messages par 10 s, distincte de la troncature de longueur déjà en place | test d'intégration : une rafale de messages `CHAT` au-delà du seuil ne produit que les premiers dans le flux diffusé, sans planter ni bannir automatiquement | ✅ |
| SPEC-SECU-007 | La portée d'un joueur par rapport à une position ciblée est vérifiée AVANT toute génération de chunk déclenchée par un message `BLOC`, pas seulement avant l'application du bloc | test Node : un `BLOC` à une position hors de portée ne déclenche aucune génération de chunk côté serveur, mesurable par l'absence d'appel au générateur | ✅ |
| SPEC-SECU-008 | Les coordonnées reçues dans un message `BLOC`/`BOUGE`/`ENTREE` sont bornées à une plage plausible (ex. ±10 000 000) avant tout traitement, indépendamment de la vérification de portée | test Node : des coordonnées hors plage (ex. `1e15`) sont rejetées par `NP.valider()` sans atteindre la logique de jeu | ✅ |
| SPEC-SECU-009 | Un jeton d'administration ou d'invitation est généré avec `crypto.randomBytes` injecté dans le module d'administration (pas `Math.random`), garantissant une entropie cryptographique testable indépendamment de l'horloge | test Node pur sur `src/admin.js` : deux appels successifs à la génération de jeton produisent des valeurs non prévisibles à partir d'une graine `Math.random` fixée, et le générateur est un paramètre injectable | ⏳ |
| SPEC-SECU-010 | Le serveur HTTP envoie des en-têtes de sécurité de base sur les réponses de fichiers statiques (`X-Content-Type-Options: nosniff`, `Content-Security-Policy` minimale, pas de `X-Powered-By`) | test d'intégration : une requête HTTP sur `index.html` reçoit ces en-têtes dans la réponse | ⏳ |
| SPEC-SECU-011 | La poignée de main WebSocket vérifie l'en-tête `Origin` contre une liste autorisée configurable (ou l'absence de restriction explicitement choisie via un paramètre de lancement) avant d'accepter la connexion | test d'intégration : une requête de handshake avec un `Origin` absent de la liste configurée est refusée avec un code d'erreur HTTP, une requête avec l'origine attendue aboutit | ⏳ |
| SPEC-SECU-012 | Une redéfinition de zone par un administrateur (`zone_definir`/`zone_retirer`) est répercutée sans délai à tous les clients déjà connectés dont la position tombe dans la région modifiée, pas seulement à celui qui se reconnecte ensuite | test d'intégration : un client connecté avant l'action admin reçoit un message de mise à jour de zone dans le tic qui suit l'action, sans devoir se reconnecter | ⏳ |
| SPEC-SERVEUR-003 | La sauvegarde du monde (`sauvegarderMonde`) écrit dans un fichier temporaire puis renomme atomiquement vers le fichier final, sans jamais écrire directement dans le fichier de sauvegarde en place | test d'intégration : interrompre le processus (ou simuler une écriture partielle) pendant une sauvegarde laisse l'ancien fichier valide intact, jamais un fichier tronqué au chemin final | ✅ |
| SPEC-SERVEUR-004 | La sauvegarde du monde s'exécute de façon asynchrone (non bloquante pour la boucle de jeu/le traitement des messages), sans geler les clients connectés pendant l'écriture | test d'intégration : pendant une sauvegarde d'un monde volumineux, un client connecté reçoit toujours des messages `ETAT` à la cadence normale, sans pause mesurable | ✅ |
| SPEC-SERVEUR-005 | `admin.sessions`, `admin.invitations` et `admin.sanctions` sont purgés des entrées obsolètes au-delà d'une taille ou d'une ancienneté bornée, sans perdre les entrées actives | test Node pur sur `src/admin.js` : après ajout de N sessions/invitations expirées au-delà du seuil, une purge réduit la structure sans retirer les entrées encore actives (session ouverte, invitation non expirée, sanction en cours) | ⏳ |
| SPEC-SERVEUR-006 | Le contenu des conteneurs (coffres, fourneaux, présentoirs, distributeurs, banque) et l'état des véhicules font partie de `etatMonde()`/`appliquerEtatMonde()` et survivent à un cycle sauvegarde/relance | test d'intégration : sauvegarder puis relancer le serveur avec `--monde` restitue le contenu exact d'un coffre et la position d'un véhicule posés avant l'arrêt | ⏳ |
| SPEC-SERVEUR-007 | Le nombre de créatures/joueurs/entités diffusés à un client dans `ETAT.mobs` est plafonné (déjà 80, à documenter comme invariant testé) et la cadence de diffusion de l'état (`etatHz`) s'adapte à la charge (nombre de clients connectés, taille de la file d'envoi) plutôt que de rester fixe | test Node : sous un nombre croissant de clients simulés, la cadence d'émission mesurée diminue progressivement plutôt que de dégrader la latence de traitement du serveur | ⏳ |
| SPEC-SERVEUR-008 | `server.js` est découpé en modules purs testables sous Node (ex. `src/serveur-reseau.js` pour trames/handshake déjà `net-protocol.js`, `src/serveur-messages.js` pour le routage `traiter()`, `src/serveur-monde.js` pour `etatMonde`/`appliquerEtatMonde`) : `server.js` ne conserve que le branchement HTTP/WS et l'appel aux modules | audit statique automatisé (test Node) : `server.js` ne dépasse pas un seuil de lignes fixé (ex. 400) après extraction, et chaque module extrait est chargeable et testable indépendamment (comme les autres modules `src/*.js` déjà chargés par `MODULES`) | ⏳ |
| SPEC-SERVEUR-009 | À la connexion (`BIENVENUE`), les overrides de blocs ne sont plus envoyés en un seul message non borné : ils sont transmis par chunk, à la demande du client au fur et à mesure qu'il charge son terrain, comme le fait déjà le maillage local | test d'intégration : sur un monde à grand nombre de modifications, le message `BIENVENUE` reste sous une taille seuil, et les overrides d'un chunk demandé arrivent avant que ce chunk ne soit affiché | ⏳ |

## L45 — économie, métiers et transport

Trois nouveaux domaines interconnectés : ECO (prix dynamique, masse
monétaire), METIER (production et progression des habitants) et TRANSPORT
(carburant, réparation, risque, fret, péage). Le commerce serveur-autoritaire
qu'ECO suppose n'introduit pas de message réseau propre : il réutilise
`TROC` (SPEC-SYNC-023, L43), seul point d'arbitrage des échanges.

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-ECO-001 | Chaque offre de métier (`habitats.js` `o(give,get)`, identifiant stable `lieu\|role\|indice`) a un prix courant réel, en émeraudes par lot, dérivé d'un prix de base et du stock local : acheter fait monter le prix, vendre le fait baisser, avec un plancher et un plafond à ±60 % du prix de base ; l'échange conclu arrondit ce prix en ajustant le nombre d'émeraudes (lot de base d'au moins 4 émeraudes) ou la quantité de marchandise (lot de base de moins de 4 émeraudes), jamais sous une unité de chaque côté | 20 achats consécutifs sur la même offre : prix courant strictement croissant puis plafonné à +60 % ; 20 ventes : décroissant puis plancher à -60 % ; le lot conclu reste cohérent avec le prix courant (écart d'arrondi d'au plus une unité) | ✅ |
| SPEC-ECO-002 | Le prix de base d'une même ressource diffère entre deux villages selon leur biome et leur distance à la source (ex. le poisson coûte moins cher près de la mer, plus cher en désert) | deux lieux générés avec la même graine mais des biomes différents affichent un prix de base distinct pour une même ressource, écart mesuré et reproductible | ✅ |
| SPEC-ECO-003 | La masse monétaire est bornée : les PNJ paient leurs achats sur le trésor de leur lieu (refus à trésor vide) et y encaissent leurs ventes ; un puits de monnaie récurrent existe (frais de garde SPEC-ECO-005, réparation au forgeron) face à une source bornée (trouvailles, butin). Sur une simulation de 100 jours avec transactions aléatoires bornées par graine, la masse totale d'émeraudes (joueurs, banques et trésors des lieux) reste à ±20 % de sa valeur initiale, sans dérive monotone sur la seconde moitié de la simulation | `MC.Economie.simuler` sur 100 jours simulés, masse totale mesurée tous les 10 jours, écart max mesuré ≤ 20 % de la masse initiale, pente de régression sur les 50 derniers jours inférieure en valeur absolue à 0,2 % de la masse initiale par jour | ✅ |
| SPEC-ECO-004 | Une caravane marchande (`caravanes.js`) transporte un inventaire réel constitué à son lieu d'origine (achat des surplus locaux) et le revend à son arrivée, modifiant le stock et donc le prix courant (ECO-001) des deux lieux ; la cargaison est une fonction pure du trajet, de l'indice de départ et des stocks d'origine, et son effet ne s'applique qu'une fois par départ | à la création d'une caravane, `cargaison` non vide et cohérente avec les offres du lieu d'origine ; après son trajet complet, stock/prix du lieu d'origine baissé, stock/prix du lieu d'arrivée monté ; rejouer le même départ ne change plus rien | ✅ |
| SPEC-ECO-005 | Le compte en banque (HABITAT-006 ; en ligne, le conteneur `banque` propre à chaque joueur nommé, SPEC-SYNC-012) prélève à chaque jour de jeu un frais de garde de 1 émeraude par tranche entière de 32 émeraudes déposées, plafonné à 4 par jour, rien sous 32 ; le contenu reste consultable et persistant comme aujourd'hui | émeraudes du compte après N jours simulés inférieures au solde initial du montant exact attendu, plafond respecté ; un compte sous 32 émeraudes n'est jamais débité ; aller-retour de sauvegarde (solo et `--monde`) conserve le nouveau solde | ✅ |
| SPEC-ECO-006 | Le bâtiment `marche` (rôle `marchand_ambulant`) affiche un cours agrégé des ressources les plus échangées de la région (moyenne des prix courants ECO-001 des lieux voisins), consultable par le joueur sans transaction (en ligne : champ `cours` de la réponse `TROC` à `consulter`) | cours affiché correspond à la moyenne mesurée des prix courants des lieux dans un rayon donné, mis à jour après une variation de prix simulée dans ce rayon | ✅ |
| SPEC-ECO-007 | Le trésor d'un donjon vidé (DONJON-008), une fois ses gemmes/lingots revendus au marché local, augmente le stock de cette ressource au lieu de vente et fait donc baisser son prix courant (ECO-001) comme toute autre vente | prix courant de la ressource concernée mesuré en baisse après la vente du butin d'un donjon simulé, proportionnel à la quantité vendue, selon la même règle qu'une vente ordinaire | ✅ |
| SPEC-METIER-001 | Un fermier récolte réellement sa parcelle assignée : son offre de vente de récolte a un stock qui descend à chaque vente et remonte selon le cycle de pousse (SAISON-006), jamais négatif | stock initial > 0, vente refusée/réduite à stock 0, stock remonté après un cycle de pousse simulé | ✅ |
| SPEC-METIER-002 | Un forgeron consomme le minerai qu'il transforme (fer, or…) depuis un stock partagé du village, alimenté par le commerce (ECO-004) ou une mine à proximité ; à sec, il refuse la vente et le signale au joueur | stock de minerai décrémenté à chaque vente d'objet forgé ; vente refusée avec message explicite à stock nul ; reprise après réapprovisionnement simulé | ✅ |
| SPEC-METIER-003 | Un habitant progresse dans son métier avec le nombre d'échanges effectués : à partir de 15 échanges, une offre supplémentaire s'ajoute à son catalogue ; à partir de 40, aucune offre nouvelle ne s'ajoute plus (plafond) | offres à 14 échanges ≠ offres à 15 ; offres à 40 échanges = offres à 100 échanges (compteur déterministe par graine) | ✅ |
| SPEC-METIER-004 | Le joueur peut pratiquer un métier reconnu : au-delà d'un seuil d'échanges effectués à un point de collecte donné (ex. 20 ventes de blé), un statut de métier s'affiche et débloque une remise mesurable auprès des habitants exerçant le même métier | statut absent avant le seuil, présent après ; remise appliquée mesurée sur le prix courant (ECO-001) après obtention du statut | ✅ |
| SPEC-METIER-005 | Un habitant du même métier qu'un lieu voisin en pénurie (stock nul, METIER-001/002) lui vend une partie de son propre surplus via le prochain passage de caravane (ECO-004), réduisant sa propre offre et augmentant celle du lieu en pénurie | stock du lieu en surplus diminué, stock du lieu en pénurie augmenté après le passage d'une caravane simulée entre les deux, seulement si un surplus réel existe au départ | ✅ |
| SPEC-TRANSPORT-001 | Chaque véhicule motorisé (`vehicules.js`) consomme un carburant/une charge proportionnelle à la distance parcourue ; à sec, il s'arrête et redevient poussable/traînable comme un véhicule abandonné (VEHIC-009) | jauge de carburant qui descend avec `conduire()`/`rouler()`, vitesse retombant à l'arrêt à jauge nulle, comportement identique à VEHIC-009 | ✅ |
| SPEC-TRANSPORT-002 | Un véhicule qui encaisse une collision perd 30 % de sa vitesse maximale (`vmaxDans()`) tant qu'il n'est pas réparé au forgeron, réparation qui prélève un coût fixe en émeraudes lié à la gravité des dégâts (lié à METIER-002) | `vmaxDans()` réduit de 30 % après collision simulée, restauré à 100 % après réparation, solde du joueur diminué du coût exact | ⏳ |
| SPEC-TRANSPORT-003 | Une caravane marchande (ECO-004) traversant un territoire de faction en guerre, ou une zone `pvp` (ZONE-001), risque une attaque simulée qui réduit sa cargaison d'une fraction bornée ; un garde dans la composition (`composition()`) réduit cette probabilité | probabilité d'attaque mesurée sur N trajets simulés par graine, plus élevée en guerre/zone pvp qu'en paix/zone sûre, réduite significativement avec un garde présent, cargaison diminuée seulement en cas d'attaque | ⏳ |
| SPEC-TRANSPORT-004 | La soute d'un véhicule de fret (camion 27 cases, bateau) sert effectivement de support de commerce : un joueur ou une caravane peut y charger une cargaison qui survit au trajet et se décharge intacte à l'arrivée | chargement mesuré (quantité, identité des objets), trajet simulé, déchargement : inventaire final identique au chargement initial (moins pertes éventuelles d'un risque TRANSPORT-003 si applicable) | ⏳ |
| SPEC-TRANSPORT-005 | Une route de type commerce (ROUTE-002) traversant le territoire d'une faction politique en paix prélève un péage borné en émeraudes sur le joueur qui l'emprunte en véhicule, versé aux ressources de cette faction (`f.ressources.or`) | solde du joueur diminué du péage exact au passage d'un tronçon taxé, `f.ressources.or` de la faction augmenté d'autant, aucun péage hors territoire de faction ou en guerre (TRANSPORT-003 prévaut alors) | ⏳ |

## L46 — factions, quêtes, PvP, environnement et donjons interconnectés

Cinq domaines qui se répondent : le territoire d'une faction colore la zone
de jeu et ferme son commerce aux ennemis, les quêtes naissent d'un besoin réel
(ressource basse, guerre active, catastrophe), le PvP a des enjeux et des
sanctions, l'environnement endommage bâtiments et routes et fait migrer les
populations, les donjons se rattachent au territoire et regénèrent leur butin.
SPEC-PVP-002 corrige un faux constat de l'audit initial : le handler `ATTAQUE`
de server.js appelle déjà `pvpAutorise` puis `MC.Guildes.peutBlesser` avant
tout dégât de mêlée, et `peutBlesser` couvre déjà les factions secondaires
(`memeFaction`). La spec couvre ce qui manquait réellement : un test, et le
chemin des projectiles (`entities.js` `stepArrow`), qui ignore l'appartenance
(revue de la vague 2, docs/vague-2/B4.md).

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-FACTION-014 | Le territoire d'une faction politique (`politique.js` `f.territoire`) influence la zone de jeu qui le recouvre : guerre active → zone plus dangereuse (`pvp`/`pvp_pve`), paix stable et territoire consolidé → zone plus sûre (`pve`/`sûre`), sans jamais écraser une redéfinition explicite d'administrateur (ZONE-004) | zone recalculée par `zones.js:zoneEn` selon la relation dominante de la faction couvrant la position ; une région redéfinie par un admin (`definirRegion`) reste inchangée malgré le recalcul | ⏳ |
| SPEC-FACTION-015 | Une faction politique en guerre avec une autre ferme le commerce de ses métiers envers les membres de l'ennemie (principe FACTION-003 étendu des camps de créatures aux factions politiques et aux factions de joueurs qui leur sont alliées) | offres refusées à un joueur identifié comme membre d'une faction ennemie pendant la guerre, rouvertes après un changement de relation vers `paix`/`neutre` | ⏳ |
| SPEC-FACTION-016 | Une action de raid ou d'avant-poste (`politique.js:tourUnJour`) prélève réellement les ressources (`or`, `nourriture`) de son auteur, avec un risque d'échec qui les prélève sans gain de territoire | `f.ressources` diminué d'un montant fixe à chaque raid/avant-poste lancé, territoire gagné seulement en cas de succès (déterministe par graine), diminué sans gain en cas d'échec | ⏳ |
| SPEC-FACTION-017 | `guildes.js:declarerRelation` vérifie que `cibleId` désigne une faction PNJ existante (`politique.js`) avant d'enregistrer une relation, et applique la relation réciproque côté PNJ (guerre/alliance perçue dans les deux sens) | relation refusée si `cibleId` ne correspond à aucune faction PNJ connue ; relation acceptée mise à jour des deux côtés (faction de joueurs et faction PNJ) de façon symétrique | ⏳ |
| SPEC-QUETE-001 | Une quête de livraison de faction (`politique.js:questesDe`) ne se propose que si la ressource visée (`nourriture` ou `or`) est effectivement sous un seuil bas défini (ex. < 20) ; sa réussite relève ce niveau d'autant que fourni, plafonné aux besoins réels | aucune quête de livraison générée au-dessus du seuil ; générée en dessous ; `f.ressources` augmenté exactement du montant livré, jamais au-delà du manque réel | ⏳ |
| SPEC-QUETE-002 | Une quête d'élimination se propose uniquement quand la faction est en relation `guerre` active, ciblant le membre réel désigné par `ciblePourRaid` ; sa réussite améliore la relation ou le territoire à l'identique d'un raid réussi (FACTION-016) | quête absente hors guerre, présente en guerre et ciblant la même entité que `ciblePourRaid` retournerait ; effet sur territoire/relation identique à celui d'un raid gagné simulé avec la même graine | ⏳ |
| SPEC-QUETE-003 | Une catastrophe environnementale (tornade NUAGE-004, cyclone NUAGE-003, éruption RELIEF-011) qui endommage un lieu habité (ENV-001) génère une quête de reconstruction ou de secours proposée par ce lieu, limitée dans le temps, avec une récompense proportionnée aux dégâts mesurés | quête absente sans dégât ; apparaît après un événement endommageant simulé par graine ; expire après son délai ; récompense corrélée au nombre de blocs endommagés (ENV-001) | ⏳ |
| SPEC-QUETE-004 | Les quêtes de faction sont acceptables et suivies en jeu, solo comme en ligne, via un tableau de quêtes actives par joueur, persistant à la sauvegarde et arbitré par le serveur en multijoueur | acceptation d'une quête par un joueur, apparition dans son tableau, persistance à la sauvegarde/reconnexion ; en ligne, le serveur reste seul arbitre de la validation (empêche double-remise par deux clients) | ⏳ |
| SPEC-QUETE-005 | La récompense d'une quête de faction (livraison, élimination, reconstruction) est calculée à partir du coût réel de ce qui est demandé (prix courant ECO-001 de la ressource livrée, ou valeur du territoire repris) plutôt qu'un nombre arbitraire | récompense mesurée proportionnelle au prix courant/à la valeur réelle de l'objectif de quête au moment de sa remise, reproductible par graine, jamais la formule arbitraire `5 + hasard*20` d'origine | ⏳ |
| SPEC-PVP-001 | La défaite d'un joueur en combat PvP autorisé (COMBAT-002, `pvpAutorise`), par coup ou par projectile, lui fait perdre une fraction bornée de son inventaire (10 à 25 % du nombre total d'objets, équipement porté exclu) au profit du vainqueur ; jamais en zone sûre/PvE, jamais pendant un duel consenti (SPEC-PVP-005), jamais hors combat PvP explicitement autorisé | perte mesurée dans les bornes définies après une défaite en zone `pvp`/`pvp_pve` ; ce que perd le vaincu arrive exactement au vainqueur (le surplus qu'il ne peut porter tombe au sol) ; inventaire intact après une mort simulée en zone `sûre`/`pve` ou en duel | ⏳ |
| SPEC-PVP-002 | Deux joueurs qui partagent une faction de joueurs, principale OU secondaire (SPEC-FACTION-011), ne peuvent pas se blesser, quel que soit le moyen : corps à corps (`ATTAQUE`, déjà contrôlé par `MC.Guildes.peutBlesser` dans server.js, qui couvre déjà les secondaires via `memeFaction`) ET projectile (flèche, sortilège : `entities.js` `stepArrow` ne consulte aujourd'hui que `pvpOk(posA, posB)` et ignore l'appartenance) | test Node sur `guildes.js:peutBlesser` : deux joueurs sans faction principale commune mais partageant une faction secondaire ne peuvent pas se blesser ; test Node sur `entities.update` : une flèche tirée par un joueur sur un membre d'une faction secondaire commune n'inflige aucun dégât ; test d'intégration : même résultat en ligne | ⏳ |
| SPEC-PVP-003 | Trois meurtres de joueurs non consentis (hors duel PVP-005) commis par un même joueur en moins de 10 minutes de jeu dégradent sa réputation politique auprès des factions proches (celles dont le territoire, `siege` + `territoire`, couvre le lieu du meurtre), de 10 points par meurtre au-delà du deuxième | réputation politique du tueur mesurée en baisse de 10 après le 3e meurtre non consenti en moins de 10 min simulées, de 20 après le 4e ; inchangée pour 2 meurtres, ou pour 3 meurtres espacés de plus de 10 min | ⏳ |
| SPEC-PVP-004 | Un succès dédié récompense la première victoire PvP puis des étapes suivantes (5, 25 victoires), listé et persistant comme les autres succès (SUCCES-001) ; en ligne, le serveur compte les victoires par joueur nommé et les annonce au vainqueur (message `PVP`, évènement `victoire`, champ `n`) | succès « première victoire » déclenché à la 1ʳᵉ victoire, jamais deux fois ; succès à 5 et 25 déclenchés aux bons seuils ; persistance à la sauvegarde | ⏳ |
| SPEC-PVP-005 | Un duel consenti se déclenche par accord mutuel explicite (commande de chat `/duel <nom>`, puis `/duel accepter` ou `/duel refuser` de l'invité, proposition caduque après 30 s), y compris hors zone PvP et sans `--pvp` ; il dure au plus 120 s et ne vaut que dans un rayon de 32 blocs autour du point médian des deux joueurs à l'acceptation ; les coups portés pendant un duel actif ne comptent pas comme meurtre non consenti (PVP-003) et n'entraînent aucun butin (PVP-001) | proposition envoyée par A, refusée par défaut, acceptée explicitement par B avant tout dégât autorisé ; duel expiré après son délai ; combat hors de la zone du duel ou après expiration refusé (hors PvP autorisé par ailleurs) | ⏳ |
| SPEC-PVP-006 | Un joueur « hors-la-loi » auprès d'une faction (réputation politique ≤ -50 envers elle, du fait de PVP-003) subit un embargo commercial (FACTION-015) : les PNJ des lieux couverts par le territoire de cette faction refusent tout `TROC` (motif `embargo`), jusqu'à restauration de sa réputation au-dessus de -50 | offres refusées au joueur hors-la-loi par les métiers des lieux de la faction concernée, acceptées ailleurs ; restaurées après remontée mesurée de sa réputation au-dessus du seuil | ⏳ |
| SPEC-ENV-001 | Une tornade (NUAGE-004) ou un cyclone (NUAGE-003) qui traverse un lieu habité endommage une fraction de ses bâtiments (blocs retirés ou changés), par exemple 5 à 20 % selon l'intensité de l'événement, journalisé pour permettre une reconstruction (QUETE-003) | dégâts mesurés (nombre de blocs affectés) compris entre 5 et 20 % du bâtiment touché selon l'intensité simulée, strictement localisés au tracé réel de l'événement simulé par graine, journal contenant lieu/heure/ampleur | ⏳ |
| SPEC-ENV-002 | Une éruption volcanique active (RELIEF-011) à proximité d'une route (`routes.js`) la rend temporairement impraticable (cendres/lave) ; les caravanes qui l'empruntaient (`caravanes.js:trajetsDe`) se redirigent vers un tracé alternatif ou s'arrêtent | route marquée impraticable pendant la durée de l'éruption simulée ; une caravane dont le trajet initial la traverse est redirigée (si alternative existe) ou stoppée (sinon) ; route de nouveau praticable après la fin de l'éruption | ⏳ |
| SPEC-ENV-003 | En hiver ou lors d'une pénurie saisonnière (SAISON-006), l'offre de nourriture des métiers agricoles (METIER-001) diminue proportionnellement à la réduction de pousse hivernale, puis se restaure au printemps | stock/offre agricole hivernal mesuré inférieur au stock de référence estival pour la même graine, restauré à un cycle de printemps simulé | ⏳ |
| SPEC-ENV-004 | Une éruption volcanique ou une tornade qui détruit des cultures d'un lieu habité (ENV-001) fait migrer 10 à 30 % de ses habitants (proportionnellement à la gravité de l'événement) vers le lieu habité viable le plus proche, réduisant durablement sa population jusqu'à repeuplement (POP-002) | population du lieu sinistré réduite de 10 à 30 % après l'événement simulé (proportionnelle à sa gravité) ; lieu de destination reçoit une population accrue correspondante ; repeuplement progressif ultérieur suit POP-002 sans dépasser sa capacité | ⏳ |
| SPEC-ENV-005 | Une éruption volcanique active à proximité d'un donjon (DONJON-011, type dépendant du biome/profondeur) multiplie par 1,5 à 2 la probabilité de renforts du gardien sur ce donjon tant qu'elle dure, reflétant un terrain plus dangereux | probabilité/nombre de renforts mesuré 1,5 à 2 fois supérieur pendant une éruption active à proximité par rapport à la même exploration simulée hors éruption, plafonnement de renfort existant (audit L141) toujours respecté | ⏳ |
| SPEC-DONJON-017 | Un coffre de donjon pillé (DONJON-009) régénère son contenu après un long délai (mesuré en jours simulés, distinct par graine du délai de repeuplement des habitants POP-002), permettant une boucle de farm/économie de fin de jeu | coffre vide immédiatement après pillage, toujours vide avant le délai, à nouveau garni (composition déterministe par graine) après le délai écoulé | ⏳ |
| SPEC-DONJON-018 | Un donjon situé dans le territoire d'une faction politique lui est rattaché : vaincre son gardien augmente le territoire ou les ressources de cette faction (comme un avant-poste réussi, FACTION-016), et une faction en guerre pour ce territoire peut le revendiquer après sa conquête | donjon rattaché à la faction couvrant sa position au moment de sa génération ; victoire sur le gardien simulée applique le même effet de ressources/territoire qu'un avant-poste réussi de cette faction | ⏳ |

## L47 — performance de génération et de maillage

Trois étapes du même goulot d'étranglement, mesuré par l'audit (~98 ms/chunk,
57 % du CPU de génération dans le bruit) : bruit interpolé en cache, greedy
meshing, puis déport en Web Workers. Les seuils en millisecondes réelles
(SPEC-PERF-004, SPEC-PERF-007) sont relatifs à une mesure de référence prise
au démarrage de la même session, jamais des constantes absolues comparées
telles quelles en CI headless.

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-PERF-001 | Le bruit 3D des grottes (`isCave`, src/world.js — `fbm3` sur les champs tunnels a/b et cavernes) se calcule sur une grille de coins espacés d'un pas fixe (4 blocs en x/z, 8 en y), mis en cache, et s'interpole trilinéairement entre les 8 coins voisins — même technique que `valeurCoin`/`valeurLisse` de src/densite.js | `node tests/bench-generation.js` mesure un temps moyen de génération inférieur à 65 ms/chunk sur 80 chunks en spirale (mesuré ~44-45 ms/chunk le 2026-09-24, contre ~98-112 ms/chunk avant le cache — environ 60 % de réduction, au-delà des 40 % visés) ; `tests/spec-perf.js` (SPEC-PERF-001) répète la mesure avec un seuil généreux | ✅ |
| SPEC-PERF-002 | Les trois caches de coins de bruit de grotte (tunnels a, tunnels b, cavernes) sont bornés en mémoire (comme `coins.size > 200000` de densite.js) : au-delà d'un seuil fixe par champ, l'ensemble du champ est purgé, sans fuite mémoire sur une session longue | `tests/spec-perf.js` (SPEC-PERF-002) sonde 18000 colonnes très écartées sur toute leur hauteur : la taille totale du cache (`world.perf.caveCacheSize()`) ne dépasse jamais 600000 coins (3 × 200000) et au moins une purge est observée sous la charge | ✅ |
| SPEC-PERF-003 | Le relief des grottes interpolé reste quasi indiscernable du calcul exact : l'écart entre `isCave` interpolé et `isCave` calculé directement par `fbm3` (sans cache) reste sous une tolérance fixe sur un large échantillon de blocs | `tests/spec-perf.js` (SPEC-PERF-003) compare les deux versions sur 40 chunks en spirale (plus de 400000 blocs) : écart mesuré ~0.78 % le 2026-09-24, tolérance fixée à 2 % | ✅ |
| SPEC-PERF-004 | La génération de chunk (`world.getChunk`) s'exécute hors du thread principal du client dans un Web Worker dédié ; le thread principal ne fait que demander un chunk et intégrer son résultat transféré (`world.integrerChunk` : réapplication des overrides et des états, enregistrement des lumières), le monde du worker n'ayant ni overrides ni état de partie | test navigateur/e2e mesurant le temps cumulé passé sur le thread principal pendant le chargement de 20 chunks autour du spawn : reste sous un budget relatif à une mesure de référence prise au démarrage de la même session (calibrage), pas à une constante absolue (ex. 4 ms/chunk reçu, hors upload GPU, comme repère de calibrage) ; si `WEBGL_debug_renderer_info` (SPEC-RENDU-010) détecte un rendu logiciel, le test est étiqueté `@lent` et son seuil est multiplié par un facteur documenté plutôt que comparé tel quel | ✅ |
| SPEC-PERF-005 | Le client limite le travail de chunks par image (budget), aujourd'hui en nombre (`GEN_BUDGET` et `MESH_BUDGET`, 2 par image, game.js) : avec les Workers, un ordonnanceur pur (`MC.FileChunks`) borne le nombre de demandes en vol par worker et le nombre de résultats intégrés par image ; une rafale de déplacement ne bloque jamais une image au-delà du budget, le reste est mis en file et traité aux images suivantes | test Node sur `MC.FileChunks` : 50 chunks demandés d'un coup, jamais plus de résultats intégrés par image que le budget déclaré, rattrapage complet en au plus ⌈50 / budget⌉ images une fois les résultats disponibles ; test e2e : aucune étape de la boucle de jeu ne dépasse le budget déclaré | ✅ |
| SPEC-PERF-006 | Si les Web Workers sont indisponibles (globale `Worker` absente, création refusée — page ouverte en `file://`, politique de sécurité — ou worker en erreur), la génération et le maillage se replient sur le thread principal avec le même ordonnanceur et le même budget par image (SPEC-PERF-005), sans erreur ni blocage | test simulant l'absence de `Worker` (suppression de la globale) et vérifiant que le monde se génère et se maille quand même, au prix du budget par image seul ; test simulant un worker qui émet `error` : bascule en repli et chunks en vol redemandés | ✅ |
| SPEC-PERF-007 | `MC.Mesher.buildChunk` (avec le greedy meshing, 7ᵉ paramètre `fusion`) s'exécute dans un pool de Web Workers dimensionné à `min(max(1, navigator.hardwareConcurrency − 1), 4)` plutôt que sur le thread principal ; le thread principal envoie l'instantané des 9 chunks du voisinage (blocs, états, eau) et reçoit les maillages des quatre passes et la lumière du chunk | test navigateur/e2e : pendant le chargement d'une zone (plusieurs chunks maillés d'un coup), le temps cumulé de maillage mesuré sur le thread principal reste sous un budget relatif à une mesure de référence prise au démarrage de la même session (calibrage), pas à une constante absolue (ex. 2 ms/chunk, upload GPU excepté, comme repère de calibrage) ; si `WEBGL_debug_renderer_info` (SPEC-RENDU-010) détecte un rendu logiciel, le test est étiqueté `@lent` et son seuil est multiplié par un facteur documenté plutôt que comparé tel quel | ✅ |
| SPEC-PERF-008 | Le worker de maillage convertit les listes produites par `buildChunk` (tableaux JS : positions, normals, uvs, uvBases, uvReps, colors, indices, lums, ciels, ondes, ondes2, immerges, souples, feuillages) en tableaux typés (`Float32Array`, `Uint32Array` pour les indices) complétés des valeurs par défaut de `toGeometry`, et les transfère au thread principal par `Transferable` (ArrayBuffer), sans copie ; de même pour les blocs, états et eau d'un chunk généré | test navigateur vérifiant qu'après l'envoi du message worker→principal, le buffer d'origine côté worker est détaché (`byteLength === 0`) — preuve d'un transfert et non d'une copie structurée | ✅ |
| SPEC-PERF-009 | Chaque chunk porte un compteur `version`, incrémenté à chaque modification (`setBlock`, `setEtat`, voisin marqué) ; un maillage reçu dont la `version` (ou l'`epoque` du monde) n'est plus la version courante est ignoré à réception plutôt qu'appliqué, et le chunk reste à remailler : jamais de régression visuelle d'un résultat périmé écrasant un état plus récent | test Node sur `MC.FileChunks` : un résultat de version périmée est rejeté et le chunk redemandé ; test e2e : modifier un bloc pendant qu'un maillage du même chunk est en vol, vérifier que le résultat final affiché reflète la modification, pas l'état maillé avant elle | ✅ |
| SPEC-PERF-010 | Le pool de maillage priorise les chunks les plus proches du joueur (en écran partagé, de la caméra active la plus proche — distance au plus proche des centres de streaming), priorités recalculées à chaque image : à charge égale, un chunk à 1 rayon de chargement se maille avant un chunk à 4 rayons | test Node soumettant une file mélangée de distances à `MC.FileChunks` et vérifiant l'ordre de distribution croissant en distance, à nombre de workers fixé, y compris après déplacement d'un centre | ✅ |
| SPEC-PERF-011 | Le maillage des faces opaques coplanaires de même matériau (et même AO, même variante de texture) est fusionné (greedy meshing 2D par plan de coupe), en plus de la fusion face-par-bloc actuelle | test Node : un chunk 16×16 synthétique, une seule couche pleine d'un même bloc, aucune occlusion voisine (AO uniforme) — le nombre de quads produits pour la face du dessus est ≤ 8 (au lieu de 256 sans fusion), soit une réduction ≥ 30× | ✅ |
| SPEC-PERF-012 | Le greedy meshing ne fusionne jamais deux faces dont un sommet aurait une occlusion ambiante différente (`ao[k]` de src/mesher.js:75-84) : la fusion s'arrête à chaque changement de niveau d'AO, préservant le relief des angles rentrants | test Node : un chunk avec une marche (un bloc plus haut créant de l'AO sur les faces voisines) produit un maillage dont chaque quad a une couleur de sommet uniforme (les 4 coins du même quad partagent le même `ao[k]`), et le rendu visuel (nombre de niveaux de gris distincts sur la zone) reste identique avant/après fusion | ✅ |
| SPEC-PERF-013 | Le greedy meshing ne fusionne deux faces que si tous leurs attributs par sommet coïncident (lumière `lums`, ciel `ciels`, `ondes`/`ondes2`/`immerges` d'eau, `souples`, `feuillages`, variante de texture/rotation `tile`/`rot`) : une différence sur un seul attribut interrompt la fusion à cet endroit | test Node : deux blocs identiques mais avec un niveau de lumière de bloc différent (torche à proximité de l'un) ne sont jamais fusionnés en un seul quad ; un chunk sans aucune différence d'attribut atteint la réduction de SPEC-PERF-011 | ✅ |
| SPEC-PERF-014 | Les `BufferGeometry` de chunk sont réutilisées (attributs réécrits dans leurs tampons s'ils sont assez grands, `setDrawRange`, recréation seulement quand la capacité est dépassée, avec marge) plutôt que recréées à chaque remaillage d'un chunk déjà affiché (modification d'un bloc, changement de saison) | test navigateur : remailler 100 fois le même chunk et vérifier que le nombre d'objets `BufferGeometry` créés (compteur d'instrumentation `render.perf().geometriesCreees` ou `renderer.info.memory.geometries`) reste borné, pas 100 | ✅ |
| SPEC-PERF-015 | Les métriques de performance (ms génération dernier chunk, ms maillage dernier chunk, nombre d'appels de dessin, nombre de triangles affichés, FPS courant, p50 et p95 sur les 5 dernières secondes) sont calculées en continu et exposées par une API interne du moteur (`g.perf` ou équivalent), indépendamment de leur affichage | test Node/e2e lisant `g.perf` après quelques secondes de jeu simulé et vérifiant que chaque champ est un nombre fini, cohérent avec `renderer.info.render.calls`/`triangles` | ✅ |
| SPEC-PERF-016 | Un panneau F3, activable/désactivable par une touche dédiée, affiche ces métriques en jeu (ms génération, ms maillage, appels de dessin, triangles, FPS p50/p95, distance de vue courante) | test e2e : appuyer sur la touche F3, vérifier l'apparition du panneau et la présence de chaque métrique à l'écran ; un second appui le masque | ✅ |
| SPEC-PERF-017 | Un banc de non-régression sous Node (`tests/bench-generation.js`, dérivé de scratchpad/bench.js) mesure la génération sur un échantillon fixe de chunks (même spirale) et échoue si un seuil déclaré est dépassé (ms moyen, p95, taille du cache de bruit) | `node tests/bench-generation.js` sort avec un code non nul et un message explicite si un seuil de tests/budget-perf.json est dépassé ; sort 0 sinon | ✅ |
| SPEC-PERF-018 | Un budget de performance CI regroupe les seuils du banc (SPEC-PERF-017) dans un fichier déclaratif (`tests/budget-perf.json`), lu par le banc et par un gate dédié, pour que dépasser un seuil fasse échouer la même étape que `node tests/gates.js` | `node tests/gates.js` échoue (porte G12) si un budget du fichier est dépassé par la dernière mesure du banc, réussit sinon | ✅ |

## L48 — rendu fiable et adaptatif

Le renderer ne perd jamais son contexte GPU sans se reconstruire, adapte
réfraction/antialias/DPR à un budget de frame unique, groupe les mobs en
instances, et détecte un rendu logiciel avant de lui appliquer des seuils
temps réel absolus. Les specs conditionnées au FPS (SPEC-RENDU-003, 005, 006,
007, 008) mesurent un FPS injecté via une fonction substituable (mock de
`g.fps`), jamais le FPS réel de la machine de test, pour rester déterministes.

Sous-lot A4 (vague 1) : implémenté et testé, sauf trois specs laissées ⏳
avec leur justification ci-dessous.
- SPEC-RENDU-006 (antialias piloté par le FPS) : la décision est calculée et
  exposée (`g.qualite.antialias`, cascade testée par SPEC-RENDU-008), mais
  aucune bascule GPU réelle n'y est branchée. Le renderer est créé une seule
  fois avec `antialias: true` (src/render.js) ; désactiver le MSAA en cours
  de partie exige soit de recréer le contexte WebGL (ce qui détruit et
  recrée `renderer.domElement`, orphelinant les écouteurs de pointeur/souris
  posés dessus par `src/input.js`, hors périmètre de ce lot), soit de
  restructurer tout le chemin de rendu vers une cible multi-échantillonnée
  suivie d'une passe de résolution (comme la passe `calque` déjà utilisée
  pour la vue sous l'eau), ce qui touche l'ensemble des passes de render.js
  et dépasse le risque de régression acceptable pour ce sous-lot. À reprendre
  dans un lot qui possède aussi `src/input.js`, ou avec une cible de rendu
  dédiée à l'antialiasing.
- SPEC-RENDU-009 (mobs fusionnés/instanciés par espèce) : `mobMesh`
  (src/render.js) construit chaque créature comme un assemblage procédural
  de 10 à 14 `THREE.Mesh` (corps, tête, membres…) répartis différemment selon
  une douzaine de formes (bipède, quadrupède, araignée, poisson, méduse,
  crabe, tortue, oiseau…), sans séparation déclarative entre parties
  statiques et parties animées. Fusionner les parties statiques en un
  maillage instancié par espèce (la solution de repli documentée dans la
  mission) exige de refactorer cette fonction pour chaque forme afin de
  distinguer explicitement ce qui est ajouté directement (statique) de ce
  qui passe par `membre()` (animé), sans casser l'apparence ni l'animation
  d'aucune des créatures existantes — un travail de plusieurs heures avec
  vérification visuelle par forme, hors du temps disponible pour ce sous-lot
  sans risquer une régression silencieuse sur une géométrie non testée
  visuellement par les e2e existants. Laissé pour un lot dédié qui partirait
  d'une table déclarative des parties par forme.
- SPEC-RENDU-014 (culling grossier d'occlusion) : nécessite une donnée de
  hauteur de relief interrogeable efficacement par colonne pour décider
  qu'une colonne de chunks est entièrement masquée par le relief proche, et
  un point d'intégration dans la boucle de streaming/rendu des chunks — deux
  choses qui touchent l'orchestration des chunks, explicitement réservée à
  un autre lot par cette mission (« un autre lot futur touchera
  l'orchestration des chunks »). Une implémentation isolée dans render.js
  sans cette donnée serait soit un faux-semblant (un test synthétique
  passerait sans culling réel utile en jeu), soit un doublon incohérent avec
  ce que ce futur lot mettra en place. Laissé ⏳, à faire avec ce lot.

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-RENDU-001 | Le renderer écoute `webglcontextlost` sur le canvas, appelle `event.preventDefault()` (empêche la perte définitive) et affiche un message à l'utilisateur (« Contexte graphique perdu, reconnexion… ») pendant que le rendu s'arrête proprement | test navigateur simulant l'événement `webglcontextlost` sur le canvas et vérifiant l'apparition du message et l'arrêt des appels `renderer.render` | ✅ |
| SPEC-RENDU-002 | À `webglcontextrestored`, le moteur reconstruit les ressources GPU perdues (géométries de chunks visibles, textures, matériaux, render targets de réfraction) et reprend le rendu sans redémarrer la partie ni perdre l'état du monde | test navigateur : déclencher perte puis restauration du contexte, vérifier que la scène se réaffiche (au moins un appel `renderer.render` réussi) et que le message disparaît | ✅ |
| SPEC-RENDU-003 | La passe de réfraction (`passeRefraction`, src/render.js:2082-2103) ne se recalcule pas à chaque image : sa fréquence est plafonnée (ex. une image sur deux) quand le FPS mesuré est sous un seuil, pleine fréquence au-dessus | test navigateur/e2e : avec un FPS injecté via une fonction de mesure substituable (mock de `g.fps`), pas mesuré en conditions réelles, compter les appels à `renderer.setRenderTarget(rtRefraction)` sur 60 images et vérifier qu'ils sont inférieurs de moitié au nombre d'images rendues | ✅ |
| SPEC-RENDU-004 | La réfraction ne s'active que si une surface d'eau réfractante est visible à moins d'une distance fixe de la caméra (`eauEnVue` porte aussi une distance, pas seulement un booléen) ; au-delà, l'eau s'affiche sans réfraction en temps réel | test Node/e2e : une nappe d'eau visible mais lointaine (au-delà du seuil) ne déclenche pas `passeRefraction` ; la même nappe rapprochée le déclenche | ✅ |
| SPEC-RENDU-005 | La réfraction se désactive automatiquement (comme `MC.Lointain.ajusterDistance` pilote déjà `render.RENDER_DIST` depuis `g.fps`, game.js:2405-2415) quand le FPS p50 mesuré reste sous un seuil fixe pendant N secondes, et se réactive quand le FPS remonte durablement | test e2e : le FPS est injecté via une fonction de mesure substituable (mock de `g.fps`), pas mesuré en conditions réelles ; imposer un FPS bas simulé pendant N secondes, vérifier que `optionsRendu.refraction` passe à `false`, puis `true` après retour à un FPS haut | ✅ |
| SPEC-RENDU-006 | L'antialias du renderer (actuellement forcé `true`, src/render.js:51) devient une option pilotée par le FPS mesuré : désactivé automatiquement quand le FPS p50 reste sous un seuil pendant N secondes, réactivable manuellement dans les options | test e2e : le FPS est injecté via une fonction de mesure substituable (mock de `g.fps`), pas mesuré en conditions réelles ; un FPS bas simulé prolongé fait passer le renderer en `antialias: false` (recréation du contexte ou passe FXAA basculée off) ; un FPS haut restauré (ou un réglage manuel) le réactive | ⏳ |
| SPEC-RENDU-007 | Le rapport de pixels (`renderer.setPixelRatio`, src/render.js:52/2030) se réduit automatiquement (ex. par paliers 2 → 1,5 → 1) quand le FPS p50 reste sous un seuil prolongé, sans jamais dépasser le plafond des options utilisateur ni descendre sous 1 | test e2e : le FPS est injecté via une fonction de mesure substituable (mock de `g.fps`), pas mesuré en conditions réelles ; un FPS bas prolongé simulé fait baisser `renderer.getPixelRatio()` d'un palier ; un FPS haut restauré la remonte, sans dépasser `MC.Options.rapportPixels` déclaré | ✅ |
| SPEC-RENDU-008 | Une qualité adaptative automatique combine antialias (SPEC-RENDU-006), DPR (SPEC-RENDU-007), réfraction (SPEC-RENDU-005) et distance de vue (mécanisme déjà en place) en cascade selon un budget de frame unique (ex. 16,6 ms pour 60 FPS) : le réglage le moins coûteux visuellement cède en premier | test e2e : le FPS est injecté via une fonction de mesure substituable (mock de `g.fps`), pas mesuré en conditions réelles ; imposer un budget de frame dépassé de façon soutenue et vérifier l'ordre de dégradation déclaré (ex. réfraction avant antialias avant distance de vue) sur des mesures successives | ✅ |
| SPEC-RENDU-009 | Les mobs d'une même espèce visibles dans une même vue sont fusionnés en un seul maillage instancié (`THREE.InstancedMesh`, comme déjà fait pour les arbres, src/render.js:1368) plutôt qu'un `THREE.Mesh` et des matériaux propres par mob | test navigateur : afficher 20 mobs de la même espèce et mesurer `renderer.info.render.calls` avant/après — passe de l'ordre de 10-14 appels par mob à au plus 2-3 appels par espèce affichée, quel que soit le nombre d'individus | ⏳ |
| SPEC-RENDU-010 | Au démarrage du renderer, l'extension `WEBGL_debug_renderer_info` est interrogée pour connaître le rendu matériel réel (`UNMASKED_RENDERER_WEBGL`) ; un rendu logiciel connu (SwiftShader, llvmpipe, Mesa software rasterizer, Microsoft Basic Render Driver) est détecté | test Node/e2e simulant un contexte WebGL dont `UNMASKED_RENDERER_WEBGL` contient « SwiftShader » et vérifiant que la détection le signale (booléen ou événement exposé) | ✅ |
| SPEC-RENDU-011 | Quand un rendu logiciel est détecté (SPEC-RENDU-010), un avertissement visible s'affiche au joueur (accélération matérielle absente, performances dégradées attendues) sans bloquer le jeu ; l'avertissement peut être ignoré et ne réapparaît pas à chaque image | test e2e : simuler un rendu logiciel détecté, vérifier l'apparition d'un message une seule fois et sa disparition après accusé de réception | ✅ |
| SPEC-RENDU-012 | Les mipmaps des textures de l'atlas sont une option (activés par défaut, désactivables) : coupés, la mémoire GPU de texture baisse et la génération de mipmaps au chargement disparaît, au prix d'un moiré possible de loin | test navigateur : basculer l'option, vérifier `texture.generateMipmaps`/`texture.minFilter` avant/après, et l'absence de reconstruction complète du renderer pour appliquer le changement (juste la texture concernée) | ✅ |
| SPEC-RENDU-013 | Les chunks hors du frustum de la caméra active ne sont pas soumis au rendu (frustum culling activé sur les maillages de chunk, à la différence des maillages spéciaux qui le désactivent volontairement — arbres/silhouettes/météo, src/render.js:1225/1376/1419/1516/1563/1600/1642/1758) | test navigateur : orienter la caméra à l'opposé d'un ensemble de chunks chargés et vérifier via `renderer.info.render.calls` (ou un compteur dédié) qu'ils ne contribuent pas au rendu de cette image | ✅ |
| SPEC-RENDU-014 | Un culling grossier d'occlusion écarte du rendu les chunks entièrement masqués par le relief proche (ex. une colonne de chunks sous une falaise pleine face à la caméra), en plus du frustum culling (SPEC-RENDU-013) | test Node/e2e : une scène synthétique avec un mur de relief plein devant plusieurs chunks alignés derrière, vérifie que ces chunks masqués ne sont pas soumis au rendu (compteur de chunks rendus inférieur au nombre de chunks chargés) | ⏳ |
| SPEC-RENDU-015 | Le budget de frame (SPEC-RENDU-008) et les métriques de rendu (SPEC-PERF-015) partagent la même source de mesure du FPS (`g.fps`, moyenne glissante 0,4 s de game.js:2413) : aucune mesure de FPS concurrente ou incohérente entre le panneau F3 et l'adaptatif | test Node/e2e lisant simultanément la valeur affichée au panneau F3 et celle utilisée par la décision d'adaptation, vérifie qu'elles proviennent du même calcul (égalité stricte à l'image près) | ✅ |


## L49 — limites techniques : exploration et banc de mesure

Tests techniques secondaires : ils mesurent les limites de la carte (hauteur,
profondeur, construction, étendue, précision) et servent de banc de mesure et
d'exploration, pas de validation. Dans la suite standard, ils sont toujours
verts sur ce qu'ils mesurent et affichent un tableau des succès internes, des
échecs internes (limites atteintes) et des valeurs relevées ; seul l'échec de
la construction du tableau les fait échouer. L'exploration profonde
(`node tests/explo-limites.js`) couvre toutes les distances et conserve son
cahier dans `tests/resultats/<date>_limites/`.

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-LIMITE-001 | Les bornes verticales sont mesurées et comparées : hauteur totale, niveau de la mer, socle en y = 0, pose possible jusqu'à WORLD_H − 1 et refusée au-delà et sous 0, en local comme à travers le protocole réseau | tableau : chaque borne a sa ligne et son statut (succès ou échec interne) | ✅ |
| SPEC-LIMITE-002 | Le relief réellement généré est mesuré sur un large échantillon : plus haut sommet et marge de construction au-dessus, fond le plus bas, hauteur moyenne, répartition par tranches, points collés au plafond | tableau des hauteurs avec la marge sous le plafond (attendu ≥ 8 blocs) | ✅ |
| SPEC-LIMITE-003 | L'étendue horizontale est explorée à des distances croissantes (de 10³ à 2⁵³ blocs) : chunk valide, pose/lecture, relief varié, répétition du monde 2³² blocs plus loin, coordonnée intacte à travers le protocole réseau ; la première distance défaillante de chaque critère est rapportée | tableau par distance et conclusion donnant les premières distances défaillantes | ✅ |
| SPEC-LIMITE-004 | La précision des positions est mesurée : résolution 32 bits (GPU : shaders et matrices) et 64 bits (physique), erreur d'un pas de marche, et seuils de tremblement visible (≥ 1/64 bloc), de saccades (≥ 1/8), d'entiers non représentables et de physique faussée | tableau par distance et quatre seuils calculés sur les puissances de 2 | ✅ |
| SPEC-LIMITE-005 | L'exploration profonde mesure le coût de génération selon la distance à l'origine (origine, 10⁵, 10⁷, 2·10⁹) | tableau des durées moyenne et médiane, écart maximal rapporté | ✅ |
| SPEC-LIMITE-006 | Les sondes ne bloquent jamais sur ce qu'elles mesurent : seule la construction du tableau (sonde qui plante, ligne mal formée, statut inconnu) fait échouer le test ; l'exploration profonde conserve un cahier (rapport.md lisible et resultats.json) | une sonde plantée ou une ligne au statut inconnu font échouer la construction ; le cahier contient la fiche, l'observé et le tableau de chaque sonde | ✅ |
| SPEC-LIMITE-007 | Une sonde navigateur mesure les limites de rendu loin de l'origine : à 10⁴, 10⁵, 10⁶ et 10⁷ blocs, le jeu téléporte la caméra, capture une image, mesure le tremblement de la géométrie et des animations (eau, vent, nuages) entre deux images fixes, et l'ajoute au tableau du cahier de test | captures et tremblement mesuré par distance dans le cahier du banc navigateur | ⏳ |
