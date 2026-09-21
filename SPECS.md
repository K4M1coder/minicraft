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
| SPEC-MODE-001 | Deux modes existent : `survie` et `creatif` | `Modes.MODES` contient exactement ces deux clés | ✅ |
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
| SPEC-NET-022 | Écran partagé et réseau se combinent | plusieurs joueurs locaux annoncés au serveur | ✅ |
| SPEC-NET-023 | La perte de connexion bascule en solo sans planter | le jeu continue, un message le signale | ✅ |

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
