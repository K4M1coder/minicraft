# MiniCraft

Prototype de jeu voxel façon Minecraft : trois modes de jeu — dont un **mode histoire**
à quêtes, choix et fins multiples —, quatre difficultés,
parties multiples avec graine choisie, armes, chat, **écran partagé jusqu'à quatre
joueurs locaux** et **multijoueur client/serveur**.

Aucune dépendance npm, aucun build, aucun asset : les textures sont peintes au
runtime sur un `<canvas>`, les bruitages synthétisés en WebAudio, et le serveur
implémente WebSocket à la main. Seul Three.js est chargé depuis un CDN.

Version courante : voir [CHANGELOG.md](CHANGELOG.md) (versionnage sémantique,
format *Tenez un Changelog* ; `node tools/version.js` monte la version à chaque
commit, la porte G10 vérifie l'accord entre le jeu et le journal).

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
node server.js
# http://localhost:8080  ·  les autres joueurs : http://<votre-ip>:8080
```

Lancé **sans aucun paramètre**, le serveur ouvre automatiquement le jeu dans le
navigateur (SPEC-PACK-001) ; dès qu'un paramètre est donné (même juste
`--port`), l'ouverture automatique n'a plus lieu — pratique pour les scripts.

Options de la ligne de commande (SPEC-PACK-002) — `--aide` les liste aussi :

| Paramètre | Rôle | Défaut |
| --- | --- | --- |
| `--serveur` | serveur seul, sans partie locale | désactivé |
| `--port <n>` | port d'écoute | `8080` |
| `--graine <n>` | graine de génération du monde | aléatoire |
| `--monde <fichier>` | fichier de sauvegarde du monde (persistance, SPEC-SERVEUR-001) | aucune |
| `--max-joueurs <n>` | nombre maximal de joueurs simultanés | `8` |
| `--pvp <on\|off>` | joueur contre joueur | `off` |
| `--liste-blanche` | seuls les joueurs inscrits entrent | désactivée |
| `--admin <secret>` | mot de passe/jeton d'administration | généré et affiché une fois si absent |
| `--aide` | affiche la liste et s'arrête | — |

```bash
node server.js --port 8080 --graine 4242 --monde parties/survie.json --max-joueurs 12 --liste-blanche --admin "un-secret-long"
```

Un paramètre inconnu ou une valeur invalide arrête le programme avec un
message clair (code de sortie non nul) ; `--aide` affiche la liste et
s'arrête proprement (code 0).

L'ancien usage positionnel `node server.js 8080` reste accepté, par
compatibilité.

Options historiques par variable d'environnement (graine/mode/difficulté de
la partie, indépendantes des paramètres ci-dessus) : `MC_GRAINE`, `MC_MODE`,
`MC_DIFFICULTE`.

> L'ouverture directe par double-clic (`file://`) devrait fonctionner en solo — ni
> module ES, ni `fetch` — mais cela **n'a pas pu être vérifié** ici, l'outil de test
> bloquant le protocole `file:`.

### Serveur seul persistant (SPEC-SERVEUR-001)

```bash
node server.js --serveur --monde parties/mon-monde.json --admin "un-secret-long"
```

Le monde vit sans joueur local : il se sauvegarde automatiquement toutes les
deux minutes et à l'arrêt (Ctrl+C ou signal d'arrêt d'un gestionnaire de
services), et reprend exactement où il en était au lancement suivant, tant
que `--monde` pointe vers le même fichier.

### Administration (SPEC-ADMIN-001 à 008)

Une console web dédiée, `http://<serveur>/admin.html`, protégée par le secret
`--admin` : joueurs connectés (nom, position, IP, heure de connexion),
inventaires, journal des actions horodatées (blocs, combats, messages…),
historique des sessions (y compris les joueurs partis), listes blanche et
noire (noms et e-mails), et liens d'invitation (jeton, expiration, usages,
révocation) — un lien valide fait entrer même en liste blanche activée. Le
secret ne circule **jamais** dans l'URL : uniquement dans l'en-tête HTTP
`Authorization: Bearer <secret>`, saisi une fois dans la console et gardé
dans `sessionStorage` (effacé à la fermeture de l'onglet).

Un joueur authentifié comme administrateur retrouve les mêmes fonctions **en
jeu**, via le chat : `/admin auth <secret>` puis `/admin joueurs`,
`/admin sessions [nom]`, `/admin listes`, `/admin journal`,
`/admin liste ajouter|retirer <blanche|noire> <nom|email> <valeur>`,
`/admin invitation <usagesMax> <expireMin> [email]`,
`/admin invitation revoquer <jeton>`, `/admin role <nom> [retirer]`,
`/admin sanction <nom> <avertir|sourdine|expulser|bannir|liste_noire> [dureeMin]`.
Le serveur ne fait jamais confiance à un rôle affiché côté client : seule
l'authentification qu'il a lui-même vérifiée décide.

Un **modérateur** (nommé par un administrateur, `/admin role <nom>`) a des
droits restreints : il voit les joueurs et journaux mais jamais les IP ni les
e-mails, ne crée pas d'invitations, ne change pas les listes ni les réglages,
et ne peut sanctionner ni un administrateur ni un autre modérateur.

## Empaquetage (SPEC-PACK-001)

```bash
node tools/paquet.js dist          # archive portable (+ tentative d'exécutable SEA)
node tools/paquet.js dist --sans-sea
```

Produit toujours une **archive portable** : `dist/` contenant `index.html`,
`admin.html`, `server.js`, `src/*`, et un lanceur par système —
`start.cmd` (Windows) et `start.sh` (macOS/Linux), tous deux équivalents à
`node server.js` sans paramètre (sert le jeu, ouvre le navigateur).

Tente en plus de préparer un **exécutable autonome** pour l'OS courant via
Node SEA (`node --experimental-sea-config`, disponible nativement depuis
Node 20 — aucune dépendance ajoutée). La dernière étape officielle de SEA
(injecter le blob dans le binaire `node`) demande l'outil `postject`, un
paquet npm **jamais installé ici** (aucun téléchargement externe) : le script
prépare tout ce qu'il peut sans lui (config, blob, copie du binaire `node`
sous `dist/minicraft(.exe)`) et affiche la commande exacte à lancer pour
finir, propre à chaque système :

```bash
# Windows
npx postject dist\minicraft.exe NODE_SEA_BLOB dist\sea\prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
# macOS
npx postject dist/minicraft NODE_SEA_BLOB dist/sea/prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 --macho-segment-name NODE_SEA
# Linux
npx postject dist/minicraft NODE_SEA_BLOB dist/sea/prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
```

## Tests

Un seul **catalogue** de tests (`tests/catalogue.js`) sert la ligne de commande,
les crochets git et (à terme) le banc navigateur : chaque test y est classé —
type (unitaire, fonctionnel, spec, e2e, intégration, charge), domaine (d'après
les `SPEC-XXX` qu'il cite), groupe, étiquettes (`@lent`, `@bug-NNN`…) — et porte
une **fiche** (quoi, pourquoi, attendu), déclarée ou déduite de la spec citée
dans `SPECS.md`. Des **préréglages** nommés (`tests/presets.js`) figent des
sélections partagées par tout : `commit`, `pr`, `regression`, `bugs`, `en-cours`,
`e2e`, `integration`, `rapide`, `visuel`, `limites`.

```bash
node tests/run.js                       # SANS argument : unitaire + fonctionnel + spec seulement (~1100 tests) — PAS l'intégration
node tests/run.js climat                # filtre positionnel historique : nom du groupe ou du test
node tests/run.js --preset commit       # rapide (< 60 s), sans navigateur ni intégration, sans @lent
node tests/run.js --preset pr           # tout le Node (unitaire/fonctionnel/spec) + les scripts tests/integration-*.js ; sert aussi de CI de merge request
node tests/run.js --domaine SYNC,NET --type spec   # critères combinables (intersection)
node tests/run.js --sauf etiquettes=lent           # exclusion
node tests/run.js --echecs              # relance les échecs de la dernière campagne Node
node tests/run.js --lister --preset pr  # affiche la sélection et les fiches, sans exécuter
node tests/run.js --delai 900           # arrêt au bout de 900 s, en nommant le test en cours
node tests/gates.js                     # les portes de qualité automatiques (G1–G6, G10, G11, G13, G14)
node tests/integration-net.js           # tests d'intégration réseau (vraies sockets) — aussi via --preset integration/pr
node tests/integration-admin.js         # tests d'intégration de l'administration et de la persistance
node tests/integration-paquet.js        # tests d'intégration de l'empaquetage
node tests/integration-pvp.js           # PvP, zones et factions sur un vrai serveur
node tests/integration-charge.js        # banc de charge, à petite échelle (vérifie qu'il fonctionne)
node tests/charge.js                    # banc de charge complet (1 à 100 joueurs) — voir docs/charge.md
node tests/integration-cdp-fake.js      # client CDP (tools/cdp.js) contre un faux serveur WebSocket, sans navigateur
node tests/integration-e2e-headless.js  # une vraie petite campagne e2e sans fenêtre (voir plus bas)
node tests/run.js --preset e2e-fumee    # quelques e2e représentatifs (< 2 min), sans fenêtre — greffé sur pre-push
```

`tests/index.html` rejoue les mêmes tests dans le navigateur **plus** ~117 tests
end-to-end qui pilotent une vraie partie ; `window.runE2E(ensureGame(), null, 'SPEC-XXX')`
n'en lance qu'une partie, filtrée par nom.

**e2e sans fenêtre, en ligne de commande** (SPEC-BANC-023/024/025) : `node
tests/run.js --type e2e` (et tout préréglage qui en contient, dont `e2e` et
`e2e-fumee`) exécute les e2e sans navigateur visible — un Edge ou Chrome
installé, détecté automatiquement (`tools/navigateur.js`, mêmes chemins que
l'export PDF), lancé en `--headless=new` avec un profil et un port de
débogage distant TEMPORAIRES et DÉDIÉS à la campagne (deux campagnes
lancées en même temps ne se gênent jamais), piloté de l'extérieur par CDP
(`tools/cdp.js`, client minimal sans dépendance npm, réutilise l'encodage
WebSocket de `src/net-protocol.js`) — voir `tools/e2e-headless.js`. Le
rendu utilise l'accélération matérielle quand elle existe (sinon
`accelerationMaterielle: false` dans le cahier), sur une surface d'au
moins 1280×800. Navigateur et serveur de test sont TOUJOURS fermés à la
fin, y compris sur un échec ou une interruption (Ctrl+C). Sans aucun
Edge/Chrome installé, les e2e sont ignorés avec un avertissement plutôt
que de faire échouer la campagne — c'est ce qui permet au préréglage
`e2e-fumee` (quelques e2e rapides et représentatifs, < 2 min, ajouté à
`pr` donc au crochet pre-push) de ne jamais bloquer un poste ou un agent
CI sans navigateur.

Chaque campagne — navigateur ou ligne de commande, même interrompue par
`--delai` — écrit son **cahier de test** dans `tests/resultats/<date>_<préréglage>/`
(`resultats.json`, `rapport.html`, `captures/`) ; non versionné, seuls les 20
derniers dossiers sont gardés. Le serveur peut aussi recevoir un cahier du banc
navigateur : `POST /tests/resultats`, réservé à la machine locale (voir
`node server.js --aide`, option `--tests` pour l'autoriser même en `--serveur`
dédié).

Plus de 1100 tests au total (unitaires/fonctionnels + end-to-end + intégration),
toutes les specs non-⏳ de SPECS.md couvertes (`node tests/gates.js`, porte G1).

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
| `C` | carte (avec une carte en main) : clic pose un repère, clic droit l'enlève |
| `J` | factions et réputation |
| `K` | succès et progression |
| `H` | journal de l'histoire (mode histoire) |
| clic droit sur un véhicule | monter · `Maj` + clic : soute du camion |
| `T` | chat (`/` ouvre sur une commande) |
| `M` | couper le son |
| `1` – `9`, molette | choisir un objet |
| `F5` | sauvegarder |
| `F1` | afficher ou masquer tout le HUD |
| `Échap` | pause |

Toutes ces touches se **remappent** dans *Options* (accueil ou pause) ; un
conflit est signalé, et l'aide affiche toujours les touches en vigueur.

**Manettes** (joueurs 2 à 4) : stick gauche déplacer, stick droit regarder,
A sauter, L3 courir, LT miner, RT utiliser, LB/RB changer d'objet, Y inventaire.

**Commandes du chat** : `/aide` `/heure` `/jour` `/nuit` `/ou` `/graine` `/vider`
`/meteo` `/succes` `/rendu [realiste|simple]` `/rejoindre [adresse]` `/quitter` `/qui`,
et `/admin …` pour un administrateur ou un modérateur connecté.

**Options.** Sensibilité, volume, champ de vision, distance de vue maximale,
rendu réaliste lointain, ombres ; GPU (préférence haute performance ou
économie, appliquée au prochain lancement), résolution (native, 800×600,
1024×768, 1080p, 1440p, 4K — seules celles que l'écran affiche), plein écran,
écran d'affichage, vue étendue sur deux ou trois écrans côte à côte ou empilés.
Tout s'applique aussitôt et se conserve. *Affichage* masque chaque composant
du HUD séparément.

---

## Contenu

**Le monde.** 128 blocs de haut, biomes qui se fondent les uns dans les autres
à l'échelle du kilomètre, montagnes et volcans (en chaînes, actifs ou éteints,
de plusieurs types), rivières et lacs, mer et océan. Sous terre, des biomes
propres à ce qui les surmonte (géodes, chambres magmatiques, grottes
luxuriantes ou englouties, abîme), leurs créatures, leurs cités anciennes,
tous les minerais et des organismes bioluminescents. Une **carte de densité**
(vierge, rurale, urbaine, hyperurbaine) place fermes, hameaux, villages,
villes et **mégapoles**, reliés par une hiérarchie de routes (grands axes,
commerce, chemins ruraux, tourisme), des ponts et des fleuves navigables.

**Le temps.** Une journée dure 20 minutes, une année 3 heures, en quatre
saisons : durée du jour, températures, neige, feuillages qui roussissent,
lacs qui gèlent, cultures en saison. Météo déterministe (la même pour tous) :
cinq couches de nuages qui dérivent avec le vent de leur altitude, pluie,
neige, orages, cyclones et tornades, brume des creux au petit matin.

**Les êtres.** Créatures, habitants et avatars ont des membres articulés et
animés (marche, course, nage, coups, regard vers leur cible), une variante
propre à chaque individu, des vêtements et accessoires selon le métier, et une
silhouette simplifiée au loin. Les habitants tués restent morts ; la
population se renouvelle et les animaux se reproduisent. Ambiance sonore
spatialisée : lieux, créatures, matières, interactions, événements.

**Les sociétés.** Des factions autonomes (royaumes, guildes marchandes,
ordres, bandits, cultes) naissent du monde, poursuivent leurs objectifs,
nouent alliances et guerres et confient des quêtes. Les joueurs fondent leurs
propres factions (`/faction …` : rangs, candidatures, invitations, une
faction principale et des secondaires, canal de discussion, diplomatie).
Caravanes, voyageurs et bateaux circulent sur les routes et les fleuves.
Le monde est découpé en **zones de jeu** — PvP et PvE, PvP seul, PvE seul,
sûre — qui suivent la densité ; le point d'apparition est toujours sûr.

**Construire et fabriquer.** Escaliers et dalles orientés à angles
automatiques, clôtures, murets, vitres et rambardes qui se raccordent ; verre
teinté, colorants, béton, marbre, ardoise, chaume, poutres ; le feu se propage,
s'éteint sous la pluie et fume au vent. Armures (tissu à diamant) visibles sur
l'avatar, armes variées, gemmes et bijoux à effets, cuisine et maladie du cru,
coffres piégés et surprises. Mécanismes : portes logiques, répéteurs,
bascules, compteurs, détecteurs, générateurs éolien, hydraulique et
thermique, câbles, batteries, lampes, pistons, blocs de commande.

**Les profondeurs.** Flore sous-marine selon la profondeur, la température
et la lumière ; récifs frangeants, barrières, atolls et lagons ; volcans
actifs qui fument, grondent, crachent des bombes et laissent des coulées
figées en basalte.

**Modes.** *Survie* : faim, dégâts, usure des outils, blocs consommés.
*Créatif* : vol, invulnérabilité, casse instantanée, blocs illimités.
*Histoire* : une aventure guidée plutôt qu'un bac à sable (voir plus bas).

**Mode histoire — « La Couronne des Saisons ».** Les quatre Gemmes des Saisons ont
été volées, et le temps se dérègle. Le héros s'éveille sur la place de son village ;
le récit se lie aux lieux réels du monde généré — ce village, la ville la plus
proche, la maison d'un ermite, trois donjons de plus en plus lointains.
- *Quête principale* : jusqu'à huit chapitres et plus de vingt étapes (parler aux
  bons habitants, rejoindre un lieu, rassembler, livrer, vaincre un gardien,
  repousser des vagues, survivre à une nuit, choisir) ;
- *quêtes secondaires* : huit, confiées par les habitants selon leur métier
  (fermier, forgeron, tisserand, aubergiste, animateur, guide, ermite, banquier) ;
- *événements* : Nuit de sang, pillards marchant sur le village, orage prophétique
  (au vrai temps d'orage de la météo), caravane marchande, voyageur ;
- *six fins* : selon les objectifs atteints (quêtes secondaires, village sauvé ou
  non) et les choix faits (le banquier, le traître, la Couronne).
À la création, on règle le héros, la longueur (courte, normale, longue), le nombre
de quêtes secondaires, les événements, le commerce, le repère automatique, et **ce
avec quoi l'on peut interagir** : un préréglage (restreinte, modérée, libre) ou des
catégories de blocs (végétaux, bois, terre, pierre, construction, lumières, mobilier)
et d'objets (nourriture, armes, outils, véhicules, carte). Le reste ne se casse, ne
se pose ni ne s'utilise. Dialogues à choix, objectif et repère affichés, journal
(`H`), écran de fin ; le récit est sauvegardé avec la partie.

**Difficultés.** *Paisible* (aucun monstre, la faim ne tue pas) · *Facile* ·
*Difficile* · **Cauchemar** : coups doublés, et **à la mort la carte et la
sauvegarde sont détruites**. En écran partagé, la mort d'un seul joueur suffit.

**Parties.** Autant que voulu, chacune avec son nom, son mode, sa difficulté et sa
graine. Une graine textuelle (« vallée perdue ») donne toujours la même carte : deux
joueurs sur deux machines obtiennent le même monde en tapant le même mot.

**Monde.** Chunks 16×16×128 générés à la volée, océans, plages, grottes creusées au
bruit 3D, charbon partout, fer en profondeur. Au cœur des chaînes, des massifs
dépassent les 100 blocs.

**Vue lointaine.** La distance de vue en vrais blocs s'adapte à la fluidité (de 4 à
18 chunks) ; au-delà, un relief simplifié tiré de la génération — couleurs du
terrain, neige, lave, lacs — porte la vue à un kilomètre. Il se calcule par petits
lots, sans figer une image.

**Lumière.** Chaque source — torche, lanterne, lave, magma, lanterne marine —
répand sa lumière de proche en proche, un cran par bloc, arrêtée par les blocs
pleins. Calculée au maillage et inscrite dans les sommets, elle ne coûte rien au
rendu : **aucune limite au nombre de sources à l'écran**. Une ville en compte des
centaines.

**Météo.** Grand soleil, clair, nuageux, couvert, pluie, orage, tempête
s'enchaînent en fondu, identiques sur tous les postes (fonction de la graine et de
l'heure). Vent qui pousse la pluie et les nuages ; pluie et neige en particules,
arrêtées par les toits ; éclairs, flash et tonnerre retardé par la distance, qui
blessent à découvert ; température selon le climat, l'altitude, l'heure, le temps,
les feux voisins et l'eau — un froid mordant blesse, une fournaise assoiffe (appliqué
par le serveur en ligne) ; sons de pluie et de vent.

**Nuages.** Cinq couches de natures différentes : stratus, cumulus épais et bombés,
altostratus — trois couches que les plus hauts sommets transpercent — puis
cirrocumulus et cirrus étirés, au-dessus de tout relief. Ils se forment, se
déforment, se dissipent et se rassemblent en bancs, dérivent au vent, et ne
traversent pas la roche : ils s'éteignent là où la montagne monte à leur altitude.

**Villes, villages, habitations.** Des maisons isolées (un ermite), des villages
(3 × 3 parcelles) et des villes (5 × 5 parcelles, rues pavées, immeubles à étages)
jalonnent le monde, sur un terrain nivelé. Un style par biome — colombages, chalets
de bouleau, isbas, maisons de grès à toits plats, cases d'acacia, pilotis, adobes,
chalets de pierre, igloos, maisons-champignons — et une variante urbaine. Bâtiments
meublés, chacun avec son habitant : *point info* (le guide marque les environs sur
la carte), *banque* (un compte commun à toutes les banques, sauvegardé), *salons*
(on y dort jusqu'au matin), *magasins*, *artisans* (forge — le forgeron répare —,
menuiserie, tisserand), *marché*, *fermes*, *loisirs* (parc, fontaine, théâtre).
Des centaines de lampadaires éclairent les rues.

**Relief.** *Volcans* de basalte au cratère plein de lave, coulées de magma sur les
flancs ; *glaciers* de glace bleue fendus de crevasses sur les hauteurs froides ;
*lacs* perchés à surface unique ; *falaises* côtières et escarpements ; ravins,
grandes *cavernes* et lacs de lave profonds, jamais au ras du socle. La lave brûle,
englue et détruit les objets ; lave, magma et lanternes marines luisent dans le noir.

**Ciel.** Soleil et lune opposés qui traversent le ciel, lune à huit phases (une par
jour), étoiles la nuit seulement ; le ciel grisaille et le brouillard se resserre
quand le temps se gâte.

**Textures.** Toujours peintes au runtime, mais *tuilables* (les taches bouclent
d'un bord à l'autre) et déclinées en variantes choisies par la position du bloc ;
les faces du dessus tournent en plus. Les coordonnées de texture restent à un
demi-texel du bord de la tuile : plus de liseré sombre sur les arêtes.

**Carte et repères.** La carte (8 bâtons autour d'une laine) révèle les chunks
explorés, vus du ciel. On y pose, suit et retire des repères ; une boussole indique
cap et distance du repère suivi, et une balise lumineuse le signale dans le monde.

**Factions.** Village (villageois, gardes), pillards, morts-vivants, bêtes. Les camps
ennemis se battent entre eux — un garde défend les villageois contre les zombies.
Tuer un membre d'un camp fâche ce camp et réjouit ses ennemis ; un village hostile
refuse de commercer, des pillards amadoués cessent d'attaquer.

**Biomes.** Dix-huit, tirés d'un climat (température, humidité, relief) et de
l'altitude. Treize terrestres : *plaines* fleuries, *forêt* de chênes et de bouleaux,
*désert* de sable sur grès, *taïga enneigée* aux sapins, *marais* au ras de l'eau,
*montagnes* en crêtes enneigées, *jungle* aux arbres géants et à lianes, *savane*
d'acacias, *badlands* en mesas de terre cuite striée, *pics glacés* hérissés
d'aiguilles de glace, *île aux champignons* géants où aucun monstre ne naît,
*volcan*, *glacier*. Cinq
marins : *océan*, *récif corallien*, *océan gelé* à icebergs, *forêt de varech*,
*abysses*. Hors des reliefs voulus (falaises, mesas, volcans, lacs), le relief
varie continûment d'un biome à l'autre.

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
au-delà de sa vitesse de décollage), sous-marin (on y respire), wagonnet (suit les
rails, prend les virages, s'arrête en bout de voie). Fabriqués à
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
la surface), vitesse horizontale réduite dans l'eau, descente plafonnée. En nageant
contre une berge, on se hisse sur la terre ferme jusqu'à deux blocs de haut. Les objets
au sol, eux, coulent.

**Armes.** Épées en trois matériaux, arc et flèches (projectile avec gravité,
dégâts à l'impact, le tireur ne se blesse pas).

**Écran partagé.** 1 à 4 joueurs locaux : plein cadre, deux bandes, ou quadrants.
Chacun a sa caméra, son HUD, son inventaire et sa vie. Joueur 1 au clavier, les
suivants à la manette.

**Multijoueur.** Serveur **autoritaire** à 60 Hz : il simule positions, vie, faim,
air, créatures, blocs (portée vérifiée), l'heure et le chat. Le client envoie ses
touches (six bits), prédit son propre mouvement avec les mêmes modules, puis rejoue
les entrées non confirmées sur chaque état reçu : l'écart est nul quand tout va bien.
Un budget de temps empêche d'accélérer sa simulation. Le rendu reste entièrement
dans le navigateur. Les joueurs distants sont affichés avec leur nom. Combinable avec l'écran partagé :
un poste peut rejoindre à quatre. La perte de connexion bascule en solo sans planter.

---

## Architecture

**La logique de jeu ne connaît ni THREE ni le DOM.** Le mailleur renvoie des tableaux
bruts ; la physique manipule des `{x, y, z}` nus. C'est ce qui permet de tout tester
sous Node — et c'est ce qui permet au **serveur de réutiliser exactement les mêmes
modules** que le client, plutôt que de réécrire une simulation qui divergerait.

```
src/
  core · noise · biomes · densite · souterrain · donjons · habitats     logique pure,
  routes · histoire · recits · carte · eau · meteo · lointain · world
  lumiere · ombres · succes · mesher · physics · faune · factions       testable sous
  inventory · vehicules · entities · player · synchro · daycycle        Node
  save · saves · modes · chat · commandes · options · apparence
  split · hud · gamepad · net-protocol · parametres · admin · livre
  ambiance
  audio · atlas · render · ui · input · net · game                     navigateur
  ui.css                                              partagé jeu / page de tests
server.js                    serveur Node sans dépendance (statique + WebSocket)
admin.html                   console web d'administration
tools/  version.js (version et journal) · paquet.js (empaquetage)
tests/  harness · unit · functional · spec-* · e2e · integration-* · gates · run
SPECS.md   ~450 specs identifiées     PLAN.md   méthode, lots et portes de qualité
CHANGELOG.md   journal des modifications
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

**Boucle serveur à 60 Hz.** `setInterval` ne descend pas de façon fiable sous
~15 ms sous Windows ; le serveur interroge donc toutes les 4 ms et ne lance un tick
que lorsque `performance.now()` a franchi la période, en gardant le reliquat pour
ne pas dériver.

**Coalescing TCP.** Une lecture socket peut contenir une demi-trame ou trois. Le
serveur accumule et décode tant qu'une trame complète sort — c'est la source la plus
fréquente de coupures aléatoires dans un serveur WebSocket écrit à la main.

---

## Limites connues

- L'obscurité n'influence pas l'apparition des monstres en surface, qui dépend
  de l'heure seule.
- Le mode histoire se joue en solo (hors ligne), en trois archétypes (épopée,
  enquête, colonie).
- La météo ne change pas le vol des avions.
- En ligne, inventaire, craft, fourneaux et cultures restent côté client ; le
  serveur valide positions, stats, blocs et combats, pas le contenu des sacs.
- Les objets au sol ne sont pas répliqués en réseau ; seuls blocs, mobs et joueurs
  le sont.
- L'écran partagé exige une manette par joueur supplémentaire : on ne peut pas
  partager un clavier et une souris.
- Le livre des objets propose tous les blocs cassables, y compris ceux qu'on ne
  trouve pas en jouant (terre labourée par exemple) ; seuls les stades de croissance
  du blé en sont écartés.
- Les gardiens de donjon ne s'éveillent qu'en solo et en écran partagé : en ligne,
  les créatures appartiennent au serveur, qui ne les simule pas encore.
- Les véhicules ne sont pas disponibles en ligne (le serveur ne les simule pas).
- L'avion et le sous-marin se pilotent au clavier ; à la manette, on monte avec
  « utiliser » et l'on descend avec le bouton de vol.
- Les créatures ne poursuivent que le joueur 1 d'un écran partagé.
- Pas de greedy meshing ; tout tourne sur le thread principal.
- Les sauvegardes solo sont locales au navigateur ; le serveur persiste son monde
  avec `--monde <fichier>`.
- Le journal d'administration ne couvre pas encore coffres et échanges.
- Le PvP ne s'applique qu'en ligne : en écran partagé, les joueurs locaux ne se
  combattent pas.
