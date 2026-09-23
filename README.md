# MiniCraft

Prototype de jeu voxel façon Minecraft : deux modes de jeu, quatre difficultés,
parties multiples avec graine choisie, armes, chat, **écran partagé jusqu'à quatre
joueurs locaux** et **multijoueur client/serveur**.

Aucune dépendance npm, aucun build, aucun asset : les textures sont peintes au
runtime sur un `<canvas>`, les bruitages synthétisés en WebAudio, et le serveur
implémente WebSocket à la main. Seul Three.js est chargé depuis un CDN.

---

## Lancer

**En solo**, un simple serveur de fichiers suffit :

```bash
cd minicraft
python -m http.server 8777
# http://127.0.0.1:8777/index.html
```

**Avec le multijoueur**, lancez le serveur de jeu — il sert aussi les fichiers :

```bash
node server.js 8080
# http://localhost:8080  ·  les autres joueurs : http://<votre-ip>:8080
```

Options du serveur : `MC_GRAINE`, `MC_MODE`, `MC_DIFFICULTE`.

```bash
MC_GRAINE=4242 MC_DIFFICULTE=difficile node server.js 8080
```

> L'ouverture directe par double-clic (`file://`) devrait fonctionner en solo — ni
> module ES, ni `fetch` — mais cela **n'a pas pu être vérifié** ici, l'outil de test
> bloquant le protocole `file:`.

## Tests

```bash
node tests/run.js              # 491 tests unitaires et fonctionnels
node tests/gates.js            # les 6 portes de qualité automatiques
node tests/integration-net.js  # 30 tests d'intégration réseau (vraies sockets)
```

`tests/index.html` rejoue les mêmes tests dans le navigateur **plus** 96 tests
end-to-end qui pilotent une vraie partie.

**617 tests au total**, 228 specs couvertes.

---

## Jouer

Le menu liste vos parties. **Nouvelle partie** demande un nom, un mode, une
difficulté, une graine et le nombre de joueurs locaux.

| Touche | Action |
|---|---|
| `ZQSD` / `WASD` | se déplacer |
| souris | regarder |
| clic gauche | miner (maintenir) · frapper |
| clic droit | poser · utiliser · tirer à l'arc · interagir |
| `Espace` | sauter · nager · double-appui = vol |
| `Maj` | courir · descendre |
| `E` | inventaire et craft 3×3 |
| `L` | livre des recettes (survie) / des objets (créatif) |
| `G` | jeter un objet |
| `F` | descendre du véhicule |
| clic droit sur un véhicule | monter · `Maj` + clic : soute du camion |
| `T` | chat (`/` ouvre sur une commande) |
| `M` | couper le son |
| `1` – `9`, molette | choisir un objet |
| `F5` | sauvegarder |
| `Échap` | pause |

**Manettes** (joueurs 2 à 4) : stick gauche déplacer, stick droit regarder,
A sauter, L3 courir, LT miner, RT utiliser, LB/RB changer d'objet, Y inventaire.

**Commandes du chat** : `/aide` `/heure` `/jour` `/nuit` `/ou` `/graine` `/vider`
`/rejoindre [adresse]` `/quitter` `/qui`.

---

## Contenu

**Modes.** *Survie* : faim, dégâts, usure des outils, blocs consommés.
*Créatif* : vol, invulnérabilité, casse instantanée, blocs illimités.

**Difficultés.** *Paisible* (aucun monstre, la faim ne tue pas) · *Facile* ·
*Difficile* · **Cauchemar** : coups doublés, et **à la mort la carte et la
sauvegarde sont détruites**. En écran partagé, la mort d'un seul joueur suffit.

**Parties.** Autant que voulu, chacune avec son nom, son mode, sa difficulté et sa
graine. Une graine textuelle (« vallée perdue ») donne toujours la même carte : deux
joueurs sur deux machines obtiennent le même monde en tapant le même mot.

**Monde.** Chunks 16×16×80 générés à la volée, océans, plages, grottes creusées au
bruit 3D, charbon partout, fer en profondeur.

**Biomes.** Seize, tirés d'un climat (température, humidité, relief) et de
l'altitude. Onze terrestres : *plaines* fleuries, *forêt* de chênes et de bouleaux,
*désert* de sable sur grès, *taïga enneigée* aux sapins, *marais* au ras de l'eau,
*montagnes* en crêtes enneigées, *jungle* aux arbres géants et à lianes, *savane*
d'acacias, *badlands* en mesas de terre cuite striée, *pics glacés* hérissés
d'aiguilles de glace, *île aux champignons* géants où aucun monstre ne naît. Cinq
marins : *océan*, *récif corallien*, *océan gelé* à icebergs, *forêt de varech*,
*abysses*. Le relief varie continûment d'un biome à l'autre : pas de falaise aux
frontières (sauf les mesas, qui en sont faites).

**Mer.** Varech en colonnes, herbiers, massifs de coraux rouges, jaunes et bleus
coiffés de gorgones, cornichons de mer lumineux, éponges des abysses. Une plante
marine baigne dans l'eau : on y nage, on s'y noie, et elle ne découpe pas de bulle
d'air dans l'océan. Faune : poissons, poissons tropicaux (quatre robes), calmars,
dauphins, tortues, méduses qui piquent, requins (ils ne chassent que dans l'eau),
crabes et noyés qui marchent au fond.

**Oiseaux.** Passereaux, mouettes sur les côtes, perroquets de trois couleurs dans
la jungle, aigles au-dessus des montagnes. Ils volent au-dessus du relief, évitent
les obstacles, et lâchent des plumes.

**Créatures.** Zombies, squelettes (tir à l'arc, visée balistique, jamais à travers
un mur), araignées (bond), momies (désert), slimes (ils avancent en sautant), loups,
chèvres et ours blancs (neutres tant qu'on ne les frappe pas), moutons, cochons,
poules, villageois. **Certaines sont armées** : zombies à l'épée ou à la hache,
squelettes chevaliers qui renoncent à l'arc, noyés au trident, pillards à
l'arbalète, vindicateurs à la hache — une arme ajoute des dégâts et tombe parfois à
la mort de son porteur. Ce qui apparaît dépend du biome, de l'heure et du milieu (eau,
sol, ciel) ; des plafonds séparés bornent monstres, animaux, faune marine et oiseaux.

**Donjons.** Neuf types, choisis par le biome, le climat, l'altitude et la
profondeur, chacun avec son gardien et son trésor unique :

| Donjon | Où | Gardien | Trésor |
|---|---|---|---|
| Crypte | sous les plaines, forêts, savanes | Gardien putride, Roi squelette ou Slime colossal | Épée runique |
| Mine abandonnée | en profondeur, badlands, montagnes | Reine des araignées | Épée runique |
| Pyramide | désert | Pharaon maudit (lève ses momies) | Khépesh |
| Forteresse de glace | taïga, pics glacés | Yéti (boules de neige) | Hache de givre |
| Temple | jungle | Grand serpent (bonds) | Arc de la jungle |
| Hutte sur pilotis | marais | Sorcière (sortilèges, slimes) | Bâton de la sorcière |
| Citadelle des cimes | sommets au-delà de 44 | Wyverne (vol, piqués, feu) | Lance des cimes |
| Monument sous-marin | grands fonds | Gardien ancien (laser, requins) | Trident |
| Épave | hauts-fonds | Capitaine noyé (noyés) | Sabre du capitaine |

Entrer dans la salle éveille le gardien ; barre de vie en haut de l'écran ; vaincu,
il ne se relève pas. Le coffre a un butin fixé par la graine et propre au type (or
de la pyramide, prismarine du monument…).

**Véhicules.** Bateau, moto, voiture, camion (soute de 27 cases), avion (décolle
au-delà de sa vitesse de décollage), sous-marin (on y respire). Fabriqués à
l'établi (roues, moteur, hélice), posés d'un clic droit ; clic droit sur l'engin
pour monter, ZQSD pour conduire, Espace/Maj pour monter/descendre en avion et en
sous-marin, **F** pour descendre, Maj + clic droit pour ouvrir la soute du camion.
Les engins à roues franchissent les marches d'un bloc. Ils sont sauvegardés, avec
leur chargement.

**Recettes.** Plus de 75 : outils en diamant, arbalète, flèches empennées, échelles,
bibliothèques, lanternes, prismarine, grès taillé, briques de glace, laine et terre
cuite teintes, soupe de champignons, pomme dorée, poudre d'os (engrais), bottes de
foin, rails… Le four cuit poisson et volaille, fond l'or, cuit l'argile.

**Jeu.** Minage progressif selon l'outil, 36 cases d'inventaire, craft 3×3 partout
(inventaire compris), fourneau, coffres, torches, agriculture (houe, graines, blé,
pain), villageois avec cinq offres d'échange, vie, faim, noyade, cactus qui
piquent, échelles et lianes où l'on grimpe, toiles d'araignée qui engluent, cycle
jour/nuit.

**Livre.** `L` ouvre le livre, qui change de nature selon le mode. En *survie*
c'est le livre des recettes : toutes les recettes du jeu, les ingrédients de
chacune avec ce qu'il vous en manque, celles que vous pouvez faire tout de suite
mises en avant et présentées en premier, et un clic qui pose la recette dans la
grille. En *créatif* c'est le livre des objets : le catalogue complet, blocs d'un
côté et objets de l'autre, un clic donne une pile sans rien collecter ni fabriquer.
Les deux se cherchent au clavier — en survie, la recherche porte aussi sur les
ingrédients (« ficelle » trouve l'arc).

**Corps.** Joueurs et créatures ne se traversent plus : le chevauchement est résolu
horizontalement, après le déplacement, avec une poussée bornée qui ne peut pas
enfoncer quelqu'un dans un mur. On peut toujours se tenir sur une créature.

**Nage.** Flottaison amortie plutôt que poussée constante (sinon on oscille autour de
la surface), vitesse horizontale réduite dans l'eau, descente plafonnée. Les objets
au sol, eux, coulent.

**Armes.** Épées en trois matériaux, arc et flèches (projectile avec gravité,
dégâts à l'impact, le tireur ne se blesse pas).

**Écran partagé.** 1 à 4 joueurs locaux : plein cadre, deux bandes, ou quadrants.
Chacun a sa caméra, son HUD, son inventaire et sa vie. Joueur 1 au clavier, les
suivants à la manette.

**Multijoueur.** Serveur autoritaire sur les blocs, les mobs, l'heure et le chat.
Les joueurs distants sont affichés avec leur nom. Combinable avec l'écran partagé :
un poste peut rejoindre à quatre. La perte de connexion bascule en solo sans planter.

---

## Architecture

**La logique de jeu ne connaît ni THREE ni le DOM.** Le mailleur renvoie des tableaux
bruts ; la physique manipule des `{x, y, z}` nus. C'est ce qui permet de tout tester
sous Node — et c'est ce qui permet au **serveur de réutiliser exactement les mêmes
modules** que le client, plutôt que de réécrire une simulation qui divergerait.

```
src/
  core · noise · biomes · donjons · world · mesher · physics           logique pure,
  faune · inventory · vehicules · entities
  player · daycycle · save · saves · modes · chat · split · gamepad    testable sous
  net-protocol                                                          Node
  audio · atlas · render · ui · input · net · game                     navigateur
  ui.css                                              partagé jeu / page de tests
server.js                    serveur Node sans dépendance (statique + WebSocket)
tests/  harness · unit · functional · spec-* · e2e · integration-net · gates · run
SPECS.md   228 specs identifiées      PLAN.md   méthode et portes de qualité
```

### Méthode

Spec-driven : chaque comportement est déclaré dans `SPECS.md` avec un identifiant,
puis couvert par un test qui le cite. `node tests/gates.js` vérifie la couverture
**dans les deux sens** — aucune spec orpheline, aucun identifiant inventé — et
refuse de passer au vert si la logique pure référence `THREE`, `document` ou
`window`. C'est cette dernière porte qui protège toute la stratégie de test.

### Points qui méritent une explication

**Orientation des déplacements.** Three.js oriente la caméra vers `-Z` : après une
rotation `yaw`, l'avant vaut `(-sin, 0, -cos)` et la droite `(cos, 0, -sin)` — les
deux composantes Z sont négatives. Les oublier miroite le déplacement par rapport à
l'axe X. D'où `Physics.wishDirection`, isolée et vérifiée sur 72 orientations.

**Capture de la souris.** Le verrou est une *conséquence* de l'état du jeu, jamais
une variable indépendante. Le perdre met en **pause**. Chrome refuse une nouvelle
capture pendant ~1,25 s après Échap : la demande est retentée.

**Trois régimes de transparence.** `opaque`, `cutout` (`alphaTest`, pas de tri —
feuillage, cultures, torches) et `blend` (fondu réel — eau, verre).

**Occlusion ambiante.** On échantillonne les voisins situés *devant* la face, jamais
ceux de son plan : sinon un mur plat s'assombrirait uniformément. Aux coins d'un
chunk, ces voisins appartiennent au chunk *en diagonale* : un chunk n'est donc maillé
qu'une fois ses **huit** voisins chargés, et générer (ou modifier au coin) un chunk
invalide ses huit voisins. Avec quatre seulement, des ombres de contact fausses
restaient figées aux coins.

**Streaming.** Un centre par joueur local : chunks générés, maillés et déchargés
autour de chacun. On génère un anneau de plus que l'on affiche, pour que le bord du
monde reste caché dans le brouillard. Une entité dont le chunk n'est pas chargé est
gelée plutôt que livrée à la gravité sans sol.

**Structures générées.** Un donjon est une fonction pure de la graine et de sa
région : chaque chunk en pose sa part, dans n'importe quel ordre de génération.

**Coalescing TCP.** Une lecture socket peut contenir une demi-trame ou trois. Le
serveur accumule et décode tant qu'une trame complète sort — c'est la source la plus
fréquente de coupures aléatoires dans un serveur WebSocket écrit à la main.

---

## Limites connues

- Pas de propagation de lumière : les torches sont des lumières ponctuelles du
  moteur, bornées à dix simultanées. L'obscurité n'influence pas l'apparition des
  monstres, qui dépend de l'heure seule.
- Le serveur fait confiance aux clients pour leur propre position : suffisant en
  réseau local, insuffisant contre un joueur malveillant.
- Les objets au sol ne sont pas répliqués en réseau ; seuls blocs, mobs et joueurs
  le sont.
- L'écran partagé exige une manette par joueur supplémentaire : on ne peut pas
  partager un clavier et une souris.
- Le livre des objets propose tous les blocs cassables, y compris ceux qu'on ne
  trouve pas en jouant (terre labourée par exemple) ; seuls les stades de croissance
  du blé en sont écartés.
- L'eau ne s'écoule pas.
- Les gardiens de donjon ne s'éveillent qu'en solo et en écran partagé : en ligne,
  les créatures appartiennent au serveur, qui ne les simule pas encore.
- Les véhicules sont locaux : en ligne, les autres joueurs voient le conducteur se
  déplacer, pas l'engin.
- L'avion et le sous-marin se pilotent au clavier ; à la manette, on monte avec
  « utiliser » et l'on descend avec le bouton de vol.
- Les créatures ne poursuivent que le joueur 1 d'un écran partagé.
- Pas de greedy meshing ; tout tourne sur le thread principal.
- Les sauvegardes sont locales au navigateur ; le serveur ne persiste pas son monde
  entre deux démarrages.
