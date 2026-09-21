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
node tests/run.js              # 361 tests unitaires et fonctionnels
node tests/gates.js            # les 6 portes de qualité automatiques
node tests/integration-net.js  # 30 tests d'intégration réseau (vraies sockets)
```

`tests/index.html` rejoue les mêmes tests dans le navigateur **plus** 85 tests
end-to-end qui pilotent une vraie partie.

**476 tests au total**, 116 specs couvertes.

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
| `E` | inventaire et craft 2×2 |
| `G` | jeter un objet |
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

**Monde.** Chunks 16×16×80 générés à la volée, océans, plages, montagnes, grottes
creusées au bruit 3D, charbon partout, fer en profondeur, arbres.

**Jeu.** Minage progressif selon l'outil, 36 cases d'inventaire, craft 2×2 et 3×3,
fourneau, coffres, torches, agriculture (houe, graines, blé, pain), zombies, moutons,
villageois avec cinq offres d'échange, vie, faim, noyade, cycle jour/nuit.

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
  core · noise · world · mesher · physics · inventory · entities       logique pure,
  player · daycycle · save · saves · modes · chat · split · gamepad    testable sous
  net-protocol                                                          Node
  audio · atlas · render · ui · input · net · game                     navigateur
  ui.css                                              partagé jeu / page de tests
server.js                    serveur Node sans dépendance (statique + WebSocket)
tests/  harness · unit · functional · spec-* · e2e · integration-net · gates · run
SPECS.md   116 specs identifiées      PLAN.md   méthode et portes de qualité
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
ceux de son plan : sinon un mur plat s'assombrirait uniformément.

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
- L'eau ne s'écoule pas. Pas de biomes distincts, ni de structures générées.
- Pas de greedy meshing ; tout tourne sur le thread principal.
- Les sauvegardes sont locales au navigateur ; le serveur ne persiste pas son monde
  entre deux démarrages.
