# MiniCraft

Prototype de jeu voxel façon Minecraft : terrain infini, grottes, minage progressif,
inventaire, craft, fourneau, coffres, torches, agriculture, mobs, PNJ, survie,
cycle jour/nuit, sons synthétisés et sauvegarde locale.

Pas de build, pas de dépendance à installer, aucun asset — ni image, ni son :
les textures sont peintes au runtime sur un `<canvas>` et les bruitages sont
synthétisés en WebAudio. Seul Three.js est chargé depuis un CDN.

---

## Lancer

```bash
cd minicraft
python -m http.server 8777
# http://127.0.0.1:8777/index.html
```

Cliquer **Jouer** pour capturer la souris. `Échap` met en pause.

> L'ouverture directe par double-clic (`file://`) devrait fonctionner — il n'y a ni
> module ES, ni `fetch`, ni XHR, et la sauvegarde dégrade proprement si
> `localStorage` est refusé. Cela n'a toutefois **pas pu être vérifié** ici, l'outil
> de test utilisé bloquant le protocole `file:`. Servir le dossier reste la méthode
> vérifiée.

## Tests

```bash
node tests/run.js          # 238 tests unitaires et fonctionnels (logique pure)
node tests/run.js Craft    # filtre par nom de suite
```

`tests/index.html` exécute **les mêmes** tests dans le navigateur, plus 54 tests
end-to-end qui pilotent une vraie partie affichée dans un cadre : capture souris,
pause, inventaire, craft au clic, minage, combat, échange, torches, coffres,
sauvegarde et rechargement.

**292 tests au total.**

---

## Commandes

| Touche | Action |
|---|---|
| `ZQSD` / `WASD` | se déplacer |
| souris | regarder |
| clic gauche | miner (maintenir) · frapper un mob |
| clic droit | poser · utiliser · interagir (établi, fourneau, coffre, villageois) |
| `Espace` | sauter · nager vers la surface · double-appui = vol |
| `Maj` | courir · descendre (vol et nage) |
| `E` | inventaire + craft 2×2 |
| `G` | jeter l'objet tenu |
| `M` | couper ou remettre le son |
| `1` – `9`, molette | choisir un objet |
| `F5` | sauvegarder |
| `Échap` | pause (ferme d'abord l'inventaire s'il est ouvert) |

Dans les écrans d'inventaire : **clic gauche** prend ou pose toute la pile,
**clic droit** prend la moitié ou pose une unité.

---

## Contenu

**Monde.** Chunks 16×16×80 générés, maillés et déchargés à la volée. Terrain issu
d'un value noise fractal (continentalité × collines × rugosité) : océans, plages,
plaines, montagnes. **Grottes** creusées par intersection de deux champs de bruit 3D,
avec une marge sous la surface et sous le niveau de la mer pour ne jamais percer
l'océan. Arbres, charbon partout sous la surface, fer seulement en profondeur.

**Minage.** Dureté par bloc, vitesse selon l'outil et son matériau, barre de
progression. Certains blocs ne donnent rien sans le bon outil (la pierre à main nue
casse mais ne lâche rien ; le fer exige au moins une pioche en pierre).
Les outils **s'usent** et finissent par se briser ; la jauge est visible dans la
barre d'action.

**Objets.** 36 cases, piles de 64, outils non empilables. Blocs cassés et mobs tués
laissent des entités au sol qui tombent, fusionnent et se ramassent. `G` permet de
jeter — sans quoi un inventaire plein condamnerait à perdre tout nouveau butin.

**Craft.** Grille 2×2 dans l'inventaire, 3×3 sur l'établi. Recettes façonnées
(position significative) et informes. Cinq familles d'outils en trois matériaux,
plus torches, coffres, fourneau, briques, verre et pain.

**Fourneau.** Combustible + entrée : minerai de fer → lingot, mouton cru → cuit,
sable → verre, pavé → pierre.

**Coffres.** 27 cases de stockage par coffre. Casser un coffre (ou un fourneau)
rend son contenu au sol.

**Torches.** Posables au sol ou contre une paroi, elles tombent si leur support
disparaît. Le rendu leur affecte un pool borné de lumières ponctuelles, réassigné
chaque image aux plus proches.

**Agriculture.** Houe → terre labourée, graines (issues de l'herbe cassée) →
4 stades de croissance → récolte de blé et de graines → pain.

**Créatures.** Zombies (apparition nocturne, poursuite, dégâts au contact,
disparition à l'aube), moutons (errance, viande et laine), villageois (cinq offres
d'échange : blé et laine contre émeraudes, émeraudes contre pain, fer, pioche).

**Survie.** Vie et faim, dégâts de chute, noyade avec jauge d'air, régénération liée
à la satiété, mort et réapparition. Cycle jour/nuit de 7 minutes pilotant lumière,
couleur du ciel et apparition des monstres.

**Sauvegarde.** Automatique toutes les minutes et à la fermeture, dans
`localStorage`. Seul le **delta** est stocké (blocs modifiés, inventaire avec usure,
coffres, fourneaux, cultures, position, heure) : le terrain se régénère depuis la
graine, donc une partie tient en quelques kilo-octets.

---

## Architecture

La contrainte structurante : **la logique de jeu ne connaît ni THREE ni le DOM**.
Le mailleur renvoie des tableaux bruts que la couche rendu emballe ; la physique
manipule des `{x, y, z}` nus. C'est ce qui permet d'exécuter génération, collisions,
inventaire, craft, IA, agriculture et sauvegarde sous Node, sans WebGL.

```
src/
  core.js       blocs, objets, dureté, drops, passes de rendu, durabilité   ─┐
  noise.js      bruit déterministe 2D et 3D                                  │
  world.js      chunks, génération, grottes, cultures, lumières              │ logique
  mesher.js     géométrie d'un chunk + occlusion ambiante (tableaux bruts)   │ pure,
  physics.js    collisions AABB, orientation, raycast DDA                    │ testable
  inventory.js  piles, recettes, fourneau, échanges, usure                   │ sous
  entities.js   objets au sol, mobs, IA, visée rayon/boîte                   │ Node
  player.js     déplacement, survie, miner/poser/utiliser/frapper/jeter      │
  daycycle.js   cycle jour/nuit                                              │
  save.js       sérialisation (stockage injecté)                             │
  audio.js      bruitages synthétisés (dégrade en silence)                  ─┘
  atlas.js      textures peintes au runtime          ─┐
  render.js     scène THREE, maillages, ambiance,     │ navigateur
                lumières de torches                   │
  ui.js         HUD et écrans                         │
  input.js      clavier, souris, verrou du pointeur   │
  game.js       boucle et câblage                    ─┘
  ui.css        styles partagés jeu / page de tests

tests/
  harness.js    micro-framework (Node et navigateur)
  unit.js       tests unitaires…
  functional.js …et fonctionnels
  e2e.js        54 tests end-to-end sur une vraie partie
  run.js        exécution Node
  index.html    exécution navigateur
```

### Quatre points qui méritent une explication

**Orientation des déplacements.** Three.js oriente la caméra vers `-Z`. Après une
rotation `yaw` autour de `Y`, le vecteur avant vaut `(-sin, 0, -cos)` et le vecteur
droite `(cos, 0, -sin)` : **les deux composantes Z sont négatives**. Les oublier
miroite le déplacement par rapport à l'axe X — correct en regardant vers ±X, inversé
vers ±Z. D'où `Physics.wishDirection`, isolée et couverte par un test qui compare la
direction obtenue au vecteur avant de la caméra sur 72 orientations.

**Capture de la souris.** Le verrou du pointeur est une *conséquence* de l'état du
jeu (`menu` / `playing` / `paused` / `ui` / `dead`), jamais une variable
indépendante. Perdre le verrou (Échap, alt-tab, clic hors fenêtre) met en **pause**
au lieu de laisser tourner une partie sans entrées. Chrome refuse une nouvelle
capture pendant ~1,25 s après une sortie par Échap : la demande est retentée au lieu
d'échouer en silence. Les deltas aberrants émis à l'acquisition sont filtrés.

**Trois régimes de transparence.** `opaque` (profondeur écrite, aucun tri), `cutout`
(`alphaTest`, profondeur écrite, pas de tri — feuillage, cultures, torches) et
`blend` (fondu réel, `depthWrite:false` — eau et verre). Confondre découpe et fondu
donne un feuillage délavé et des artefacts de tri.

**Occlusion ambiante.** Pour chaque coin de face, on échantillonne les trois voisins
situés **devant** la face — jamais ceux du plan de la face, sinon un mur plat
s'assombrirait uniformément. Quand les deux arêtes sont pleines le coin est enfermé,
et la diagonale ne doit pas l'éclaircir. Le quad est découpé selon la diagonale la
plus homogène en occlusion, faute de quoi un pli lumineux apparaît en escalier.

---

## Limites connues

- Pas de biomes distincts, ni de génération de villages ou de structures.
- Pas de propagation de lumière : les torches sont des lumières ponctuelles du
  moteur, bornées à dix simultanées. L'obscurité n'influence pas l'apparition
  des monstres, qui dépend seulement de l'heure.
- L'eau ne s'écoule pas : casser un bloc sous la mer laisse une poche d'air
  permanente. Les grottes évitent donc soigneusement le fond océanique.
- Les mobs ne franchissent pas les obstacles de plus d'un bloc et ne s'évitent pas
  entre eux.
- Pas de greedy meshing : un chunk produit une face par facette visible.
- Tout tourne sur le thread principal ; entrer dans une zone neuve peut provoquer un
  bref à-coup malgré le budget de génération par image.
- La sauvegarde est locale au navigateur ; vider les données du site l'efface.
