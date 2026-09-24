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
| test, nom | texte | test |
| categorie | énumération : `type` du catalogue (unitaire, fonctionnel, spec, e2e, perf…) et `groupe` | catalogue |
| domaines | liste (SYNC, RENDU, ECO…) | catalogue (`domainesDe`) |
| specs | liste d'ids SPEC-* | catalogue |
| fonctions | liste de fonctions testées (`MC.Mesher.tileOrigin`…) | fiche déclarée, sinon observée (§3.5) |
| etiquettes | liste de tags libres | catalogue |
| fiche | {teste, pourquoi, attendu, source} | **instantané** du catalogue au moment du run |
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

Un test produit plusieurs images : la première (role `debut`), une par image clé intermédiaire (role `intermediaire`, identifiée par son libellé stable, par ex. `apres-teleportation`), et la dernière (role `fin`). Chaque image a **son propre diaporama**, qui parcourt **l'historique de cette image-là** à travers les runs (précisé par l'utilisateur : autant de diaporamas que d'images).

**Déclenchement au clic uniquement** (précisé par l'utilisateur) : aucun diaporama n'est affiché ni ne défile par défaut. Le tableau (colonne « images ») et le panneau d'un run montrent les images de ce run en **vignettes fixes**, dans l'ordre du test (première, intermédiaires par `t_ms`, dernière). Un clic sur une vignette ouvre le diaporama de CETTE image, positionné sur le run cliqué. Les autres images ne s'ouvrent que si on clique dessus à leur tour.

Le diaporama parcourt les runs de ce test pour cette image, dans l'ordre du tri choisi (lancement ou commit) et avec les filtres actifs. Sous l'image : date, commit court + sujet, état, durée, inscrit ou non. L'identité d'une image est (test, rôle, libellé) : une image clé ajoutée ou retirée à un moment de l'histoire du test garde son diaporama, et les runs qui ne l'ont pas affichent « pas de capture ».

- Plusieurs diaporamas peuvent être ouverts en même temps (un par vignette cliquée), côte à côte dans une zone qui passe à la ligne selon la largeur, chacun avec son bouton de fermeture.
- Navigation : flèches et curseur de position ; la lecture automatique ne démarre que sur action explicite (bouton lecture), vitesse réglable. Les diaporamas ouverts sont **indépendants** par défaut ; un bouton « synchroniser » les aligne sur le même run pour voir le déroulé complet du test dans ce run.
- **Témoin** : l'image témoin (épinglée, sinon la dernière capture inscrite) reste affichée en vignette fixe au-dessus de chaque diaporama. Bascule « comparer » : superposition témoin/courante avec un curseur de rideau (glisser pour révéler l'une ou l'autre) ou en clignotement. C'est un humain qui juge l'écart, aucun diff automatique ne décide.
- Bouton « épingler comme témoin » sur l'image affichée (appelle `node tools/registre.js temoin` via une route POST).
- Un run sans cette image affiche une case « pas de capture » au lieu de sauter le run, pour ne pas désynchroniser les diaporamas.

### 3.4 Inscrire un run manuel au registre depuis le banc

Précisé par l'utilisateur : à la fin d'une exécution manuelle lancée depuis l'interface web du serveur de tests, on doit pouvoir enregistrer le rapport dans le registre.

- Dès que la campagne est terminée (y compris après un arrêt manuel, auquel cas l'entrée est marquée `interrompu`), le résumé de fin (`#resume`) affiche un bouton **« Inscrire au registre »**, à côté du lien vers le cahier.
- Le clic appelle `POST /tests/registre/inscrire` avec l'identifiant du cahier. Le serveur appelle la même fonction que `node tools/registre.js inscrire` : copie des captures dans le stockage adressé par contenu, création de l'entrée avec `origine: 'manuel'`, `inscrit: true`, `statut: 'en_attente'`. Le commit suivant l'intègre, comme une entrée pre-push.
- Un champ facultatif « motif » (texte court, par ex. « référence avant refonte de l'eau ») est enregistré dans l'entrée et apparaît comme une colonne de l'historique.
- Retour visible : le bouton devient « Inscrit ✓ » et affiche un lien vers la vue historique filtrée sur ce run. Inscrire deux fois le même cahier est refusé avec un message clair (idempotence).
- Le même bouton existe dans l'historique global sur toute ligne ou tout run `inscrit: false` encore présent dans les cahiers locaux, pour promouvoir un run après coup.
- Cas où le dépôt contient des modifications non commitées : l'entrée cite le commit HEAD et porte `arbre_modifie: true`, affiché en avertissement dans l'historique, puisque le code testé n'est pas exactement ce commit.

### 3.5 Fiche avant résultats, tags, catégories, domaines, specs, fonctions

Précisé par l'utilisateur : pour chaque test, le rapport doit indiquer les données de la fiche AVANT les résultats, et les tests doivent pouvoir être tagués, filtrés, triés et comptés par catégorie, par domaine, par spec et par fonction.

- **Fiche d'abord.** Dans le rapport de campagne (`tools/rapport.js`), le cahier et ses exports (`tools/cahier.js` : html, pdf, docx), le panneau d'un run dans l'historique et la vue par test, chaque test s'affiche dans cet ordre :
  1. identité (id, nom, catégorie, domaines, specs, fonctions, étiquettes) ;
  2. fiche : ce qui est testé, pourquoi, résultat attendu, source (déclarée / déduite de la spec) ;
  3. résultat : état, durée, erreur, puis les vignettes des captures.
- **Instantané.** La fiche et les tags sont copiés dans l'entrée du run. Une fiche modifiée plus tard ne réécrit pas l'historique : on voit ce que le test prétendait vérifier au moment où il a tourné.
- **Tags.** `etiquettes` (existant dans le catalogue) est la liste de tags libres, déclarés dans la fiche du test ou de son groupe. Liste de tags recommandés dans le README du registre (`rendu`, `reseau`, `lent`, `instable`, `regression:<date>`…), mais pas d'interdiction de tags nouveaux.
- **Fonctions.** Deux sources, fusionnées et distinguées à l'affichage :
  - `fonctions` déclarées dans la fiche : la cible du test ;
  - fonctions **observées** : en exécution Node (tests/run.js, vm), les fonctions exportées par les modules `MC.*` sont enveloppées pendant chaque test, et celles appelées sont enregistrées (nom qualifié, nombre d'appels). C'est la valeur par défaut pour un test qui n'a rien déclaré, comme la fiche déduite de la spec. Enveloppe désactivable (`--sans-fonctions`) si elle pèse trop sur la durée ; son surcoût est mesuré et affiché, et G12 (budget perf) se mesure sans elle. Pour les e2e, observation facultative (même enveloppe injectée dans la page), sinon fonctions déclarées seulement.
- **Filtrer, trier, compter.** Catégorie, domaines, specs, fonctions et étiquettes sont des colonnes du tableau (§3.1), avec filtre multi-sélection et effectifs. Pour les colonnes-listes, un test compte dans chacune de ses valeurs. Un panneau **« Répartition »** affiche, pour la vue filtrée courante et la dimension choisie (catégorie, domaine, spec, fonction ou étiquette), un tableau et un graphique en barres : nombre de tests, réussis, échecs, ignorés, avertissements, durée cumulée. Clic sur une barre : filtre sur cette valeur.
- **Zone de sélection du banc.** Les mêmes dimensions servent à choisir les tests à lancer : l'arbre de sélection se regroupe au choix par catégorie, domaine, spec, fonction ou étiquette, avec les effectifs. On peut ainsi lancer « tous les tests qui touchent `MC.Mesher.tileOrigin` ».
- **Porte.** G14 est étendue : 100 % des tests ont au moins un domaine et au moins une fonction (déclarée ou observée).

## 4. Tests (le banc se teste lui-même)

- Node, `tests/spec-banc.js` : filtrage, tri multi-clés, pagination, agrégation des séries, fusion registre + locaux, ordre topologique, ligne sans capture.
- e2e : ouvrir la zone Historique, trier, filtrer, cocher une propriété et vérifier qu'un graphique apparaît, vérifier qu’aucun diaporama n’est ouvert par défaut, puis cliquer une vignette et vérifier que seul le diaporama de cette image s’ouvre sur le run cliqué et parcourt son historique ; lancer une petite campagne, cliquer « Inscrire au registre » et vérifier que l’entrée apparaît dans l’historique avec origine manuel. Captures début, intermédiaire et fin comme tout e2e.
- Fiches SPEC-BANC à créer dans SPECS.md (L42) avant le code, une par exigence ci-dessus.

## 5. Découpage conseillé

0. Catalogue : champ `fonctions` déclaré, observation des fonctions en Node, instantané fiche+tags dans les cahiers et le registre, fiche affichée avant les résultats dans rapport et cahier (§3.5), G14 étendue.
1. Routes serveur et index en mémoire, avec tests Node.
2. Tableau : colonnes, tri, filtres, pagination, export.
3. Graphiques timeline.
4. Panneau test : un diaporama par image, témoin, comparaison.
5. Intégration dans le banc (bouton, clic depuis la sélection), inscription manuelle en fin de campagne (§3.4) et test e2e.
