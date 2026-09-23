✅ |✅ |✅ |# Spécifications — MiniCraft

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
| SPEC-EAU-001 | L'eau se classe en écoulement, chute, rivière, lac, mer et océan, selon sa génération et sa situation | classement de colonnes connues | ⏳ |
| SPEC-EAU-002 | Chaque type ondule à sa façon (amplitude, longueur d'onde, vitesse, écume) : clapot du lac, houle de l'océan, courant de la rivière, rideau de la chute | paramètres distincts par type, attributs par sommet | ⏳ |
| SPEC-EAU-003 | Le sens des ondulations mêle le sens de l'écoulement et le vent : pur courant dans une chute, surtout le vent sur un lac, un mélange sur une rivière | direction résultante selon le type | ⏳ |
| SPEC-EAU-004 | Des rivières naissent en altitude et descendent jusqu'à la mer ou un lac en creusant leur lit ; là où elles décrochent, une cascade | tracé descendant, lit creusé, cascades | ⏳ |
| SPEC-EAU-005 | L'eau posée ou libérée s'écoule : elle descend, s'étale sur sept blocs au plus en s'amenuisant, et se retire quand sa source disparaît | simulation d'écoulement | ⏳ |
| SPEC-EAU-006 | Près des rivages, les vagues se dressent en approchant de la côte (amplitude qui croît quand le fond remonte), déferlent en écume sur la ligne du rivage et courent vers la plage | profondeur et direction du rivage par colonne, amplitude et écume selon la profondeur | ⏳ |
| SPEC-EAU-007 | Sous l'eau, la lumière est dynamique : des caustiques animées dansent sur le fond et les parois immergées, la lumière du soleil s'atténue et bleuit avec la profondeur | attribut d'immersion par sommet, atténuation selon la profondeur | ⏳ |
| SPEC-EAU-008 | La surface de l'eau déforme ce qu'on voit à travers elle : vu du dessus, le fond ondule par réfraction ; vu de dessous, le monde au-dessus et tout le champ de vision ondulent | passe de réfraction et déformation sous l'eau | ⏳ |

## L16 — vent

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-VENT-001 | Le vent varie avec l'altitude : sa direction tourne et sa force croît en montant, avec des rafales ; chaque couche de nuages, la brume, la pluie et la neige suivent le vent de leur altitude ; le vent est le même pour tous les postes | vent à plusieurs altitudes, rafales, dérive par couche, déterminisme | ⏳ |
| SPEC-VENT-002 | Herbes, fleurs, cultures, buissons et feuillages ondulent au vent : sommet mobile, pied fixe, selon le vent au sol ; les blocs pleins ne bougent pas | souplesse par sommet | ⏳ |
| SPEC-VENT-003 | Des bancs de brume se forment dans les vallées et au-dessus de l'eau le matin et par temps humide, et dérivent avec le vent de surface | densité de brume selon l'heure, l'humidité, le relief ; dérive | ⏳ |
| SPEC-VENT-004 | Buissons et prairies fleuries couvrent plaines, savanes et forêts claires | buissons et fleurs générés | ⏳ |
| SPEC-NUAGE-003 | Des cyclones naissent sur les mers chaudes et humides quand le vent s'y prête : une vaste spirale de nuages autour d'un œil calme, qui tourne, se déplace avec le vent dominant, apporte vents violents et pluies, et s'affaiblit en touchant terre ou des eaux froides ; comme la météo, ils sont les mêmes pour tous les postes (fonction de la graine et de l'heure) | naissance selon température, humidité et vent ; spirale, œil, trajectoire, affaiblissement ; déterminisme | ⏳ |
| SPEC-NUAGE-004 | Des tornades se forment sous les orages quand la chaleur, l'humidité et le cisaillement du vent (entre le sol et les nuages) sont réunis : un entonnoir qui descend du nuage, se déplace, soulève et projette créatures, joueurs et objets au sol, arrache feuillage et plantes, puis se dissipe ; mêmes tornades pour tous les postes, dégâts appliqués par le serveur en ligne | conditions de formation, trajectoire, poussée, dégâts, durée de vie, déterminisme | ⏳ |

## L17 — relief

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-BIOME-005 | Aux frontières, surfaces, végétation et climat se mêlent sur une large bande : on passe d'un biome à l'autre progressivement, sans ligne nette | mélange des surfaces dans la bande de transition | ⏳ |
| SPEC-BIOME-006 | Le paysage est vaste : continents, chaînes de montagnes et bassins s'étendent sur plusieurs kilomètres | tailles des structures du relief | ⏳ |
| SPEC-BIOME-007 | Les climats forment de grandes régions cohérentes, sur des milliers de blocs : on ne passe pas d'un désert à une banquise en cent mètres ; froid et chaud, sec et humide s'ordonnent en gradients | distances entre biomes incompatibles | ⏳ |
| SPEC-RELIEF-007 | Un volcan se dresse sur une montagne ou une chaîne, jamais au milieu d'une plaine | position des volcans | ⏳ |
| SPEC-RELIEF-008 | Des volcans s'alignent parfois en chaîne le long d'une crête | chaînes de volcans | ⏳ |
| SPEC-RELIEF-009 | Des volcans sont éteints : sans lave, leur cratère porte un lac ou de l'herbe | volcans éteints | ⏳ |
| SPEC-RELIEF-010 | Plusieurs types de volcans : stratovolcan élancé, volcan bouclier large et plat, caldeira effondrée | profils distincts | ⏳ |
| SPEC-RELIEF-011 | Un volcan actif fume ; de temps à autre il gronde et crache des projectiles incandescents, la lave déborde de son cratère puis se fige en basalte | panache, éruptions, coulées qui se figent | ⏳ |

## L18 — peuplement et routes

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-HABITAT-008 | Les lieux suivent l'habitabilité à des échelles réalistes : villes au bord de l'eau ou en plaine, espacées de plusieurs kilomètres ; villages autour, fermes et hameaux dans les campagnes ; montagnes et déserts presque vides | densités et distances par région | ⏳ |
| SPEC-HABITAT-009 | Les bâtiments s'adaptent au relief — fondations ou pilotis sur la pente — ou l'évitent quand elle est trop forte ; le terrain n'est plus arasé en bloc | fondations, parcelles sur pente | ⏳ |
| SPEC-ROUTE-001 | Des routes de commerce relient chaque ville à ses voisines et aux villages alentour | graphe des routes | ⏳ |
| SPEC-ROUTE-002 | Une route suit le relief sans marche de plus d'un bloc, et contourne ce qui est trop raide | pentes le long des tracés | ⏳ |
| SPEC-ROUTE-003 | Une route franchit l'eau et les ravins par des ponts | ponts générés | ⏳ |
| SPEC-ROUTE-004 | Des routes touristiques mènent des villes aux sites remarquables (volcans, lacs, sommets) | tracés vers les sites | ⏳ |
| SPEC-ROUTE-005 | Aux carrefours, des panneaux indiquent le nom et la distance des lieux ; aux abords des villes, les routes sont éclairées | panneaux, lampadaires | ⏳ |
| SPEC-ROUTE-006 | Des caravanes marchandes et des voyageurs circulent sur les routes de commerce et de tourisme | déplacements le long des tracés | ⏳ |

## L19 — identités procédurales

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-HABITAT-010 | Chaque type de bâtiment a plusieurs plans reconnaissables (trois pour la maison, deux au moins pour les autres), agencés procéduralement : deux bâtiments du même type diffèrent | variantes et signatures | ⏳ |
| SPEC-HABITAT-011 | Chaque variante, dans chaque style compatible et à plusieurs endroits, est habitable : porte dégagée, intérieur libre, lumière, habitant à l'intérieur, rien ne flotte ni ne déborde | vérification de toutes les variantes | ⏳ |
| SPEC-HABITAT-012 | Les villes ont des quartiers cohérents (centre commerçant, quartiers résidentiels, faubourgs agricoles) et leur taille varie de la petite ville à la grande cité | quartiers et tailles | ⏳ |
| SPEC-DONJON-013 | Les donjons moyens et grands comptent plusieurs salles reliées par des couloirs, les grands plusieurs niveaux reliés par des escaliers ; toute salle est atteignable depuis l'entrée, le gardien se tient au plus profond, et des gardes peuplent les autres salles | graphe de salles, niveaux, connexité depuis l'entrée, gardien au plus profond | ⏳ |
| SPEC-DONJON-014 | Chaque type de donjon a son identité (plan, matériaux, décor) et des variantes procédurales : deux donjons du même type diffèrent | signatures par type, variantes | ⏳ |
| SPEC-DONJON-015 | Les donjons ont trois tailles : petits (les donjons actuels, une salle et son accès), moyens (plusieurs salles sur un niveau), grands (plusieurs niveaux et une dizaine de salles ou plus) | taille, nombre de salles et de niveaux par catégorie | ⏳ |
| SPEC-DONJON-016 | La taille dépend du lieu et de la rareté (les grands sont rares et demandent de la place en profondeur ou en surface) ; elle fait croître la difficulté (gardes, sous-gardiens) et le butin | répartition des tailles, gardes et butins selon la taille | ⏳ |
| SPEC-MOB-010 | Chaque créature, chaque habitant et chaque avatar de joueur a plusieurs variantes d'apparence (tailles, couleurs, vêtements selon le métier, accessoires) et un modèle détaillé (tête, corps, membres), animé : marche, course, nage, attaque, regard vers sa cible ; au loin, un modèle simplifié le remplace | variantes, parties, animations, niveau de détail selon la distance | ⏳ |

## L20 — rendu lointain

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-VUE-003 | Au-delà des chunks, les forêts apparaissent en imposteurs d'arbres selon la densité et l'essence du biome | imposteurs par densité | ⏳ |
| SPEC-VUE-004 | Villes et villages se voient de loin en silhouettes, éclairées la nuit | silhouettes des lieux | ⏳ |
| SPEC-VUE-005 | Une perspective atmosphérique commune bleuit et éclaircit ce qui s'éloigne, sans rupture entre vrais blocs et relief lointain | même fonction de couleur par distance | ⏳ |
| SPEC-VUE-006 | Une option « rendu réaliste lointain » active imposteurs, ombres lointaines et perspective atmosphérique | option et effets | ⏳ |
| SPEC-VUE-007 | Les chunks lointains encore affichés en vrais blocs passent à un maillage simplifié (moins de faces) sans saut visible, pour allonger la distance à fréquence d'images égale | niveaux de détail des chunks | ⏳ |

## L21 — histoires procédurales

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-HISTOIRE-010 | Trois archétypes très différents : épopée (quête des gemmes), enquête (un crime à élucider), colonie (fonder et défendre un établissement), au choix à la création | trois archétypes jouables | ⏳ |
| SPEC-HISTOIRE-011 | Chaque histoire est générée depuis la graine : lieux, personnages, indices, ennemis et rebondissements changent d'une partie à l'autre, et la même graine redonne la même histoire | déterminisme et variété | ✅ |
| SPEC-HISTOIRE-012 | L'enquête : des suspects aux alibis, des indices à trouver, un coupable à désigner ; la fin dépend de l'accusation et des indices réunis | enquête jouée jusqu'à ses fins | ✅ |
| SPEC-HISTOIRE-013 | La colonie : bâtir les bâtiments requis, attirer des habitants, tenir face aux vagues ; la fin dépend de la prospérité atteinte | colonie jouée jusqu'à ses fins | ✅ |

## L22 — couverture des interactions

| ID | Spec | Vérification | État |
|---|---|---|---|
| SPEC-PORTE-001 | Des portes (deux blocs) se fabriquent, s'ouvrent et se ferment d'un clic droit ; fermées elles arrêtent, ouvertes elles laissent passer ; les créatures hostiles ne les ouvrent pas, les habitants si ; les bâtiments générés ont leurs portes | recette, collisions porte ouverte / fermée, créatures, portes des bâtiments | ⏳ |
| SPEC-PORTE-002 | Des trappes se fabriquent, s'ouvrent et se ferment ; fermées on marche dessus, ouvertes on passe à travers, et une échelle dessous se grimpe jusqu'à elles | recette, collisions trappe ouverte / fermée, échelle | ⏳ |
| SPEC-PORTE-003 | On grimpe aux échelles et aux lianes, on s'y tient, on redescend | montée, maintien, descente | ✅ |
| SPEC-COMBAT-001 | Contre les créatures : dégâts selon l'arme, recul, brève invulnérabilité, butin à la mort | combat simulé | ✅ |
| SPEC-COMBAT-002 | Entre joueurs, en ligne : un joueur en blesse un autre si le serveur autorise le PvP (réglage du serveur, désactivé par défaut), avec les mêmes armes, reculs et délais qu'en PvE ; le serveur fait foi et annonce qui a vaincu qui | attaque d'un joueur par un autre, réglage du serveur, annonce | ⏳ |
| SPEC-PHYS-001 | Gravité, dégâts de chute (amortis par l'eau), collisions et marche d'un bloc suivent des règles fixes | chutes, collisions | ✅ |
| SPEC-VEHIC-012 | Chaque véhicule se fabrique, se pose, se monte, se conduit et se quitte | parcours de chaque véhicule | ✅ |
| SPEC-RECETTE-007 | Chaque recette est faisable : ses ingrédients s'obtiennent (butin, fabrication, échange, génération) et son résultat existe | graphe des recettes | ✅ |
| SPEC-DROP-001 | Chaque bloc cassable rend son butin, chaque créature le sien ; aucun butin n'est un identifiant inconnu | butins | ✅ |
| SPEC-SUCCES-001 | Des succès récompensent des étapes (premier bloc, premier outil, premier gardien, première ville…) : annoncés une fois, sauvegardés, listés dans un panneau | déclenchement, unicité, sauvegarde | ⏳ |
| SPEC-OPTION-001 | Un menu d'options règle sensibilité de la souris, volume du son, champ de vision, distance de vue maximale, rendu réaliste lointain et ombres ; chaque réglage s'applique aussitôt et est conservé | options appliquées et conservées | ⏳ |
| SPEC-OPTION-002 | Chaque bouton et chaque option des menus (principal, parties, création, multijoueur, pause, options, affichage, aide) fait ce qu'il annonce | parcours de tous les menus | ⏳ |
| SPEC-OPTION-003 | Les touches se reconfigurent (déplacements, actions, panneaux) ; un conflit est signalé ; le choix est conservé et l'aide affiche les touches en vigueur | remappage, conflit, conservation, aide | ⏳ |
| SPEC-CMD-001 | Chaque commande du chat fait ce qu'elle annonce (/aide, /heure, /jour, /nuit, /ou, /graine, /vider, /qui, /meteo, /succes) | toutes les commandes | ⏳ |

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
