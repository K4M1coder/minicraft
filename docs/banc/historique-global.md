# Historique global du registre de tests — conception

Demande de l'utilisateur (2026-09-25) : dans le registre, un historique global qui regroupe tous les runs, où l'on peut trier et filtrer les résultats sur chaque propriété, choisir des propriétés à afficher en graphiques pour voir une timeline, et parcourir l’historique de chaque image de rendu dans son propre diaporama.

Cet historique est une **zone du banc** (`tests/index.html`), au même titre que la zone de rendu 3D, le rapport d'exécution, les tests lents, les tests en échec et la sélection. On l'ouvre depuis la zone de sélection : un bouton « Historique » dans l'en-tête ouvre la vue globale, et un clic sur un test ouvre cette même vue déjà filtrée sur ce test.

## 1. Données

Source unique, `tools/registre.js`, qui fusionne :

- le **registre** (`tests/registre/entrees/*.json`, versionné dans git : validations pre-push et inscriptions manuelles) ;
- les **cahiers locaux** (`tests/resultats/`, non versionnés, limités aux N derniers).

Granularité : **une ligne = un test dans un run**.

| Propriété | Type | Origine |
|---|---|---|
| run | id | run |
| debut_run | horodatage | run |
| commit, commit_court, sujet_commit | texte | run (`git log -1 --format=%s`, mis en cache) |
| rang_commit | entier | `git rev-list --topo-order` sur la branche principale (-1 si hors branche ou réécrit) |
| branche, preset, origine | énumérations | run |
| inscrit | booléen | run |
| test, nom, type, fiche | texte / énumération | test |
| debut_test | horodatage | test |
| duree_ms | nombre | test |
| etat | `reussi` \| `echec` \| `ignore` \| `avertissement` | test |
| erreur | texte | test |
| nb_captures | nombre | test |
| captures | liste de {role, libelle, image, t_ms} | test |

## 2. Serveur (`server.js`, section banc)

- `GET /tests/historique/lignes?tri=<prop>&ordre=asc|desc&filtre=<json>&page=&taille=` : filtrage, tri et pagination **côté serveur**. Environ 1 250 lignes par run complet : au bout de cent runs, on dépasse 100 000 lignes, trop pour tout envoyer au navigateur. Il renvoie aussi `total` et, pour chaque énumération, les valeurs distinctes avec leur effectif (pour remplir les filtres).
- `GET /tests/historique/series?x=debut_run|rang_commit&props=etat,duree_ms&filtre=<json>` : données agrégées pour les graphiques.
- `GET /tests/historique/images?test=<id>&filtre=<json>&tri=<x>` : pour un test, la suite ordonnée des runs avec leurs captures, groupées par rôle.
- `GET /tests/registre/images/<sha1>.<ext>` : sert les images, adressées par contenu, avec un cache long (immuables).
- Index en mémoire reconstruit quand le dossier change (mtime), pas à chaque requête.

## 3. Interface

### 3.1 Tableau

- Une colonne par propriété. Un sélecteur « Colonnes » affiche ou masque chacune (choix mémorisé dans localStorage, encadré par try/catch).
- Clic sur l'en-tête : tri croissant, décroissant, puis aucun. Maj+clic : tri secondaire.
- Filtre par colonne, selon le type :
  - texte : « contient » (test, nom, erreur, sujet de commit) ;
  - énumération : multi-sélection avec effectifs (état, type, branche, preset, origine, inscrit) ;
  - nombre : min/max (durée, nombre de captures) ;
  - horodatage : de/à (début du run, début du test) ;
  - commit : plage entre deux commits de la branche principale.
- Filtres rapides : « inscrits seulement » (par défaut en vue officielle), « tous les runs », « échecs », « lents ».
- Pagination serveur, taille réglable. Export CSV et HTML de la vue filtrée.
- Clic sur une ligne : ouvre le panneau « test » (§3.3) sur ce test, avec le run cliqué sélectionné.

### 3.2 Graphiques (timeline)

- L'utilisateur choisit les propriétés à tracer (cases à cocher) et l'axe X : **horodatage de démarrage** (ordre de lancement) ou **commit de référence** (rang topologique ; étiquette = commit court + sujet au survol).
- Rendu selon le type de propriété :
  - `etat` : barres empilées par run (réussis vert, échecs rouge, ignorés gris, avertissements orange). Quand le filtre ne retient qu'un test : une bande de pastilles colorées, un run par pastille.
  - `duree_ms` : courbe (médiane et p95 par run si plusieurs tests, valeur brute pour un test seul). Seuil « lent » tracé en pointillés.
  - `nb_captures` et toute autre propriété numérique : courbe.
  - vue matrice optionnelle : tests en lignes × runs en colonnes, cellule colorée par état — la vue qui repère le mieux un test instable ou le commit qui a tout cassé.
- Survol : infobulle avec run, commit, date, valeur. Clic sur un point : filtre le tableau sur ce run (ou ce commit).
- Les graphiques suivent les filtres du tableau.
- Bibliothèque : Chart.js depuis cdnjs (même politique que three.js), ou SVG écrit à la main si c'est plus simple. Aucune dépendance npm.

### 3.3 Panneau « test » : un diaporama par image

Un test produit plusieurs images : la première (role `debut`), une par image clé intermédiaire (role `intermediaire`, identifiée par son libellé stable, par ex. `apres-teleportation`), et la dernière (role `fin`). Le panneau affiche **autant de diaporamas qu'il y a d'images dans le test**, dans l'ordre du test (première, intermédiaires par `t_ms`, dernière). Précisé par l'utilisateur : chaque diaporama sert à parcourir **l'historique de cette image-là**.

Chaque diaporama parcourt **les runs** de ce test pour cette image, dans l'ordre du tri choisi (lancement ou commit) et avec les filtres actifs. Sous chaque image : date, commit court + sujet, état, durée, inscrit ou non. La liste des diaporamas est l'union des images vues sur tous les runs filtrés : une image clé ajoutée ou retirée à un moment donné de l'histoire du test a quand même son diaporama.

- Disposition : grille de diaporamas qui passe à la ligne selon la largeur ; une case à cocher par image permet de masquer celles qui n'intéressent pas.
- Navigation : flèches, curseur de position, lecture automatique avec vitesse réglable. Tous les diaporamas sont **synchronisés par défaut** (même run affiché partout, ce qui montre le déroulé complet du test pour ce run) ; un cadenas par diaporama le désynchronise pour comparer deux runs différents.
- **Témoin** : l'image témoin (épinglée, sinon la dernière capture inscrite) reste affichée en vignette fixe au-dessus de chaque diaporama. Bascule « comparer » : superposition témoin/courante avec un curseur de rideau (glisser pour révéler l'une ou l'autre) ou en clignotement. C'est un humain qui juge l'écart, aucun diff automatique ne décide.
- Bouton « épingler comme témoin » sur l'image affichée (appelle `node tools/registre.js temoin` via une route POST).
- Un run sans capture pour un rôle affiche une case « pas de capture » au lieu de sauter le run, pour ne pas désynchroniser les diaporamas.

## 4. Tests (le banc se teste lui-même)

- Node, `tests/spec-banc.js` : filtrage, tri multi-clés, pagination, agrégation des séries, fusion registre + locaux, ordre topologique, ligne sans capture.
- e2e : ouvrir la zone Historique, trier, filtrer, cocher une propriété et vérifier qu'un graphique apparaît, ouvrir un test et vérifier un diaporama par image (première, intermédiaires, dernière), synchronisés. Captures début, intermédiaire et fin comme tout e2e.
- Fiches SPEC-BANC à créer dans SPECS.md (L42) avant le code, une par exigence ci-dessus.

## 5. Découpage conseillé

1. Routes serveur et index en mémoire, avec tests Node.
2. Tableau : colonnes, tri, filtres, pagination, export.
3. Graphiques timeline.
4. Panneau test : un diaporama par image, témoin, comparaison.
5. Intégration dans le banc (bouton, clic depuis la sélection) et test e2e.
