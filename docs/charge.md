# Banc de charge du serveur (SPEC-SERVEUR-002)

## Ce que c'est

`tests/charge.js` simule, sans aucun rendu, de 1 à 100 clients qui parlent le
**vrai** protocole réseau (`src/net-protocol.js`, le même que le client) : ils
rejoignent la partie, avancent, minent, posent des blocs, attaquent et
discutent — comme `tests/integration-net.js`, mais à l'échelle et par paliers.
`tests/integration-charge.js` vérifie à petite échelle (paliers 1 et 5, une
seconde) que le banc fonctionne, sans ralentir `node tests/run.js`.

```bash
node tests/charge.js --paliers 1,5,10,25,50,100 --duree 20 --calage 10 \
                      --scenario tous --rapport rapport.json
```

Deux scénarios :
- **groupé** — tous les clients errent en rond (marche normale) à quelques
  blocs du point d'apparition, comme une ville surpeuplée.
- **réparti** — chaque client court (sprint, ~7,4 blocs/s) pendant une phase
  de « calage » (`--calage`, 10 s par défaut) vers l'une de 8 directions
  fixes avant que la mesure ne commence, puis erre en rond autour de son
  point d'arrivée.

Pour chaque palier × scénario, il mesure : durée des tics serveur (moyenne,
95e centile — instrumentation serveur activée par `MC_MESURES=1`, exposée en
lecture par la console d'administration, action `mesures`), mémoire du
processus serveur, débit reçu par client (octets/s), latence d'une pose de
bloc (aller-retour réel jusqu'à l'écho du serveur), et le taux de pertes
(délais d'attente dépassés). Il compare chaque mesure à un seuil et sort en
code 1 si un seuil est dépassé.

## Limite assumée : pas de téléportation

Le protocole réel n'offre ni téléportation ni triche de vitesse — le serveur
cadence les entrées sur le temps réel écoulé (`Synchro.creerBudget`). Le
scénario réparti ne peut donc séparer ses zones que par du déplacement réel
pendant la phase de calage : à 7,4 blocs/s (course) sur 10-12 s, les zones
finissent à quelques centaines de blocs les unes des autres, pas à plusieurs
kilomètres. C'est assez pour sortir du rayon de chunks systématiquement
chargés autour du spawn (3 chunks ≈ 48 blocs) et forcer une génération
distincte — le but réel du scénario — mais pas assez, avec 8 zones et cette
durée de calage, pour placer TOUS les clients hors de la portée de visibilité
(96 blocs) les uns des autres : la mitigation décrite plus bas n'en profite donc que partiellement dans ce
banc, moins qu'elle ne le ferait avec des zones vraiment séparées.

## Résultats mesurés (cette machine, 24/09/2026, Node v24.14.0, 16 cœurs)

Seuils calibrés par défaut (resserrés en dessous de 25 joueurs, desserrés
au-delà — voir `seuils()` dans `tests/charge.js`, réglables par variable
d'environnement `MC_SEUIL_*`) :

| Palier | tic moyen | tic p95 | latence p95 |
|---|---|---|---|
| ≤ 25 | 50 ms | 90 ms | 500 ms |
| ≤ 50 | 90 ms | 160 ms | 800 ms |
| ≤ 100 | 180 ms | 300 ms | 1200 ms |

### Avant correctif (liste des joueurs non filtrée dans la diffusion d'état)

| scénario | joueurs | tic moy/p95 (ms) | latence p95 | Ko/s/client | pertes |
|---|---|---|---|---|---|
| groupé | 1 | 3,4 / 0,7 | 146 ms | 16,2 | 0 % |
| groupé | 5 | 3,5 / 1,1 | 97 ms | 32,2 | 0 % |
| groupé | 10 | 1,5 / 1,8 | 132 ms | 61,0 | 0 % |
| groupé | 25 | 2,8 / 4,0 | 111 ms | 123,9 | 0 % |
| groupé | 50 | 5,7 / 8,5 | **830 ms** ✗ | 218,0 | 0 % |
| groupé | 100 | 13,1 / 23,7 | **57 486 ms** ✗ | 445,6 | **65 %** ✗ |
| réparti | 1–50 | 1,0 à 5,7 / 0,7 à 9,0 | 1 à 744 ms | 39,7 à 254,4 | 0 % |
| réparti | 100 | *(non atteint — voir ci-dessous)* | | | |

### Après correctif (liste des joueurs bornée à 96 blocs, comme les mobs)

| scénario | joueurs | tic moy/p95 (ms) | latence p95 | Ko/s/client | pertes |
|---|---|---|---|---|---|
| groupé | 50 | 6,2 / 9,9 | 9 182 ms ✗ | 1029,0 | 2,7 % ✗ |
| groupé | 100 | 16,5 / 28,3 | 17 348 ms ✗ | 932,8 | 50,5 % ✗ |
| réparti | 50 | 5,5 / 9,2 | 1 049 ms ✗ | 237,2 | 0 % |
| réparti | 100 | 14,9 / 22,4 | 111 755 ms ✗ | 664,2 | 87,0 % ✗ |

(Les paliers 1 à 25 ne sont pas rejoués après correctif : le filtre y est un
changement de quelques microsecondes par tic, sans effet mesurable, et les
deux scénarios y étaient déjà largement sous les seuils.)

## Analyse : deux goulots différents, un seul corrigé

**1. La durée des tics serveur n'est jamais le problème.** Même à 100
joueurs regroupés, le tic serveur reste sous 30 ms (moyenne 13-16 ms, p95
23-28 ms) — la simulation elle-même (physique, mobs, météo, chunks) tient la
charge. Ce n'est donc **pas** là qu'il faut optimiser en premier.

**2. Goulot identifié et corrigé : la diffusion d'état grandissait en
O(joueurs²).** Dans la boucle de simulation (`server.js`, diffusion `etat`),
la liste des « autres joueurs » envoyée à chaque client était la liste
COMPLÈTE de tous les joueurs connectés, sans aucun filtre — contrairement
aux créatures, déjà bornées à 96 blocs et 80 entités. À 60 Hz, chaque tic
d'état envoyait donc du O(N) par client × N clients = O(N²) enregistrements
de position. Le correctif (une ligne, `commun.joueurs = js.filter(...)`,
même rayon que les mobs) transforme ce coût en O(N × voisins proches). C'est
une correction sûre et généralement utile : elle ne change aucun
comportement observable (un joueur à 200 blocs n'était de toute façon pas
rendu visible par le client), et les 37+23 tests d'intégration réseau et
d'administration restent verts.

Son effet mesuré est cependant plus nuancé que prévu :
- en **réparti** à 50 joueurs, le débit descend legèrement (254 → 237 Ko/s) ;
  l'effet réel serait bien plus net avec des zones vraiment éloignées (voir
  la limite ci-dessus : à 50-100 blocs d'écart entre zones voisines, beaucoup
  de paires de joueurs restent sous le rayon de 96 blocs) ;
- en **groupé**, le filtre ne retire presque personne par construction : si
  100 joueurs sont réellement les uns sur les autres, ils sont mutuellement
  visibles, et leur informations doivent forcément être échangées. Ce n'est
  pas un bug du correctif, c'est la limite physique du problème — un
  attroupement dense coûte O(N²) quel que soit le filtrage par distance.

**3. Goulot non corrigé, identifié en cours de mesure : au-delà d'une
cinquantaine de clients simulés dans un seul processus, c'est le BANC DE
CHARGE LUI-MÊME qui sature, pas nécessairement le serveur.** Preuve : à 100
joueurs, le scénario **réparti** (état par client bien plus petit après
correctif, puisque les autres joueurs sont loin) est mesuré **pire** que
groupé (111 s de latence p95 contre 17 s) — incohérent si le réseau du
serveur était la seule limite. Un relevé direct des compteurs CPU pendant un
run à 100 joueurs confirme : le processus `tests/charge.js` tourne à environ
110 % d'un cœur (event loop Node saturé — 100 sockets réelles + jusqu'à 400
minuteurs + tout le JSON entrant à traiter dans un seul thread), pendant que
`server.js` tourne à ~80 % d'un cœur. Le banc, écrit comme un simple script
Node à fil unique (cohérent avec « aucune dépendance npm », comme le reste du
projet), devient donc lui-même le facteur limitant avant que le serveur
n'atteigne sa propre limite à ce palier. La machine de développement utilisée
est en outre partagée avec d'autres processus Node concurrents (autres
sessions de travail), ce qui ajoute du bruit d'une exécution à l'autre (le
palier groupé/50 varie par exemple de 218 à 1029 Ko/s/client selon le run) :
les chiffres ci-dessus sont donc à lire comme des ordres de grandeur sur
cette machine partagée, pas comme un étalon reproductible au pourcent près.

## Recommandations (non implémentées ici, hors du périmètre « petit
changement localisé »)

- **Pour fiabiliser la mesure au-delà de ~50 clients simulés** : répartir les
  clients simulés sur plusieurs processus (ou `worker_threads`) plutôt qu'un
  seul, pour que le banc ne devienne pas lui-même le goulot avant le serveur.
- **Pour la vraie densité (« groupé » à 100+ joueurs au même endroit)** :
  envisager de plafonner aussi la liste des joueurs visibles (comme les 80
  mobs les plus proches) plutôt que de tout envoyer sans limite au-delà d'un
  certain nombre de voisins, et/ou réduire dynamiquement `etatHz` quand le
  nombre de joueurs dans un même rayon dépasse un seuil.
- Élargir `--calage` (ou le nombre de zones) donnerait une séparation plus
  nette au scénario réparti et démontrerait plus clairement le gain du
  filtre déjà en place.

## Correctif appliqué à `server.js`

Une ligne, dans la diffusion d'état périodique (recherche `commun.joueurs`) :
la liste des autres joueurs envoyée à un client est maintenant bornée au même
rayon de 96 blocs que les créatures, au lieu d'être la liste complète et non
filtrée de tous les joueurs connectés.
