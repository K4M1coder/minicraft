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
| test, nom | texte | test (`test` = id catalogue, PARTAGÉ par tous les tests d'une même SPEC) |
| cle | texte | identité du test, unique et stable : `groupe › nom` (`e2e › nom` pour un e2e), recalculée à la lecture (SPEC-BANC-119) |
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

**Identité d'un test et renommage (SPEC-BANC-119).** L'historique d'un test,
c'est l'ensemble des lignes de même `cle` = `groupe › nom` (le titre du
`describe()` et celui du `it()` ; pour un e2e, son seul nom). Aucun identifiant
caché ne survit à un renommage : **renommer un test, ou le `describe()` qui le
contient, ou déplacer le test dans un autre `describe()`, lui donne une
NOUVELLE identité** — son historique repart de zéro sous le nouveau nom, et
l'ancien reste consultable sous l'ancien nom (le banc le montre « hors de ce
banc », puisqu'il n'est plus au catalogue courant). C'est un choix : `id`
(1re SPEC citée) ne peut pas servir d'identité (partagé par tous les tests
d'une spec), et un rang `N-<index>` bouge dès qu'un test est ajouté avant lui.
Pour garder la continuité, ne renommer un test que si ce qu'il vérifie change ;
pour une simple correction de libellé, accepter la coupure (l'ancien
historique reste lisible) — un futur alias `ancienNom` dans la fiche pourra
recoller les deux si le besoin se confirme.

## 2. Serveur (`server.js`, section banc)

- `GET /tests/historique/lignes?tri=<prop>&ordre=asc|desc&filtre=<json>&page=&taille=` : filtrage, tri et pagination **côté serveur**. Environ 1 250 lignes par run complet : au bout de cent runs, on dépasse 100 000 lignes, trop pour tout envoyer au navigateur. Il renvoie aussi `total` et, pour chaque énumération, les valeurs distinctes avec leur effectif (pour remplir les filtres).
- `GET /tests/historique/series?x=debut_run|rang_commit&props=etat,duree_ms&filtre=<json>` : données agrégées pour les graphiques.
- `GET /tests/historique/images?test=<id>&filtre=<json>&tri=<x>` : pour un test, la suite ordonnée des runs avec leurs captures, groupées par rôle.
- `GET /tests/registre/images/<sha1>.<ext>` : sert les images, adressées par contenu, avec un cache long (immuables).
- `GET /tests/historique/tests` : un test connu par identité (`cle`), avec son nombre de passages et son dernier état (SPEC-BANC-118).
- `GET /tests/historique/export?format=csv|html&colonnes=…` : export de la vue filtrée, produit par le serveur, écrit par paquets, un seul à la fois (429 sinon), au plus 100 000 lignes (413 au-delà : filtrer) — SPEC-BANC-120/122.
- `GET /tests/catalogue` : le catalogue Node complet (`node tests/run.js --catalogue-json`, processus à part, mis en cache), pour montrer dans le banc les tests qu'il ne peut pas charger (SPEC-BANC-118).
- Toutes ces routes, comme `/tests/cahiers*`, n'acceptent que le banc lui-même (`refusRequeteLocale` : ni mandataire, ni `Origin`/`Host` étrangers, ni requête intersites — SPEC-BANC-122).
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

### 3.6 Périmètre d'exécution : tests du commit, suite complète pour PR et merges

Précisé par l'utilisateur : le moteur doit permettre de ne lancer que les tests du périmètre d'un commit, et le crochet de commit doit restreindre la liste des tests. Seuls les PR et les merges déclenchent la suite complète, comme porte.

**Carte d'impact.** `tests/registre/impact.json`, versionnée, construite à chaque run complet inscrit (PR/merge) à partir des fonctions observées (§3.5) :

- `fonction qualifiée → [tests]` (par ex. `MC.Mesher.tileOrigin → [N-812, N-813, E-44]`) ;
- `fichier source → [fonctions qu'il définit]`, déduit en chargeant les modules : chaque `MC.X` est rattaché à son fichier `src/x.js` ;
- le commit sur lequel la carte a été construite.

**Calcul du périmètre** (`node tools/perimetre.js [--depuis <ref>]`, par défaut les fichiers indexés), dans l'ordre :

1. Fichier de test modifié ou ajouté → tous les tests de ce fichier.
2. Fichier `src/*.js` modifié → fonctions touchées par le diff (plages de lignes du `git diff -U0` croisées avec les bornes de chaque fonction du fichier, via un découpage syntaxique léger) → tests qui appellent ces fonctions selon la carte. Si les bornes ne peuvent pas être déterminées : toutes les fonctions du fichier.
3. Tests sans données d'impact (nouveaux, ou jamais observés, par ex. e2e non instrumentés) → sélectionnés s'ils partagent un domaine ou une fonction déclarée avec les fichiers touchés.
4. Toujours ajoutés : le petit ensemble « fumée » (préréglage existant) et les tests étiquetés `toujours`.
5. **Repli sur la suite complète** si le moteur ne peut pas conclure avec confiance : fichier touché hors `src/` et hors fichiers de test (harness, catalogue, run.js, gates.js, server.js, tools/, index.html…), carte absente, ou carte construite sur un commit trop éloigné (plus de 50 commits, réglable), ou fichier `src/` absent de la carte (nouveau module).

**Rapport de périmètre.** Chaque run restreint enregistre dans son cahier : fichiers touchés, fonctions touchées, raison de sélection de chaque test (`fichier-de-test`, `fonction:MC.X.f`, `domaine:RENDU`, `fumee`, `toujours`), tests exclus (nombre), et la raison d'un éventuel repli. L'historique a une colonne `perimetre` (`complet` | `commit` | `manuel`) et une colonne `raison_selection`. Seuls les runs complets alimentent la carte d'impact et servent de témoins par défaut.

**Crochets et portes :**

- `pre-commit` : `--perimetre commit` à la place du repli actuel par domaines (`tools/domaines-touches.js` devient l'étape 3 ci-dessus). Pas de délai qui coupe les tests (filet anti-deadlock seulement, voir SPEC-BANC-010 révisée) : l'actuel `--delai 240` passe au filet commun.
- `pre-push` (= validation de PR) : suite complète, portes comprises, inscription automatique au registre, reconstruction de la carte d'impact.
- **Merges** : un commit de merge déclenche la suite complète. Merge sans conflit : crochet `pre-merge-commit`, à ajouter dans `.githooks`. Merge avec conflits résolus : le `pre-commit` détecte `MERGE_HEAD` et passe en suite complète.
- Banc web : la zone de sélection propose « Périmètre du commit » (fichiers indexés), « Périmètre depuis… » (une ref, par ex. `master`) et « Tout », avec l'aperçu des tests retenus et leur raison **avant** de lancer.
- G13 vérifie : pre-commit → périmètre, pre-push et pre-merge-commit → complet.

**Contrôle de fiabilité de la carte.** À chaque run complet, pour chaque test qui échoue, on vérifie si le dernier `pre-commit` l'aurait sélectionné pour les fichiers changés depuis le run complet précédent. Un échec que le périmètre aurait raté est signalé en avertissement (« trou de périmètre ») dans le rapport et l'historique : c'est ce signal qui dit si la carte est digne de confiance.

### 3.7 Étapes et triplets d'images

Précisé par l'utilisateur : trois images successives au début et à la fin de chaque étape, pour détecter le tremblement (jitter), les erreurs de position, les artefacts et les scintillements.

- **Étapes déclarées.** API e2e `T.etape('nom')` : ouvre une étape, ferme la précédente. Un test sans étape déclarée a une étape implicite `test` (début et fin du test).
- **Triplet = 3 images réellement consécutives**, lues dans la boucle de rendu juste après `renderer.render()` (lecture du tampon d'image sur les images N, N+1, N+2), la compression JPEG étant différée hors de la boucle. Une capture d'écran CDP ou un `toDataURL` hors boucle sauterait des images et perturberait le rendu qu'on mesure.
- **Chaque image du triplet porte ses nombres** : horodatage, durée de l'image, position et orientation de la caméra, position du joueur, numéro d'image. Un tremblement se lit dans les positions avant de se voir, et un écart de temps irrégulier révèle une saccade.
- **Identité** : (test, étape, `debut`|`fin`, rang 0-2). Dans l'historique, chaque triplet est une image au sens des diaporamas (§3.3). Sa vignette et son diaporama la montrent en boucle image par image (clignotement), le mode le plus sensible à l'œil pour un scintillement.
- **Score d'instabilité temporelle** par triplet : écart moyen de pixels entre images consécutives et écart de pose de la caméra. C'est une colonne numérique, tracée dans la timeline, qui signale sans jamais décider.
- **Mouvements scriptés.** Pour juger un tremblement en mouvement, l'étape doit faire un mouvement reproductible (déplacement ou rotation à vitesse fixe). Caméra immobile : on juge scintillements et artefacts.
- **Volume** (environ 143 e2e × 4 étapes × 6 images, soit environ 3 400 images et 70 Mo par run) : tous les triplets vont dans les résultats locaux. Le registre garde l'image centrale de chaque triplet et tous les nombres. Il ne garde le triplet complet que pour les tests étiquetés `rendu`, ou quand le score d'instabilité dépasse un seuil. Le stockage adressé par contenu rend gratuite une scène reproductible qui ne change pas.

### 3.8 Rendu reproductible et moteur de rendu

- Chaque test visuel fixe la graine, l'heure du jeu, la météo, la position et l'orientation de la caméra et la résolution (1280×800, jamais sous 800×600). Les animations non liées au test sont gelées ou réglées sur une horloge déterministe.
- Chaque run enregistre son **moteur de rendu** : `GL_RENDERER` et `GL_VENDOR` (via `WEBGL_debug_renderer_info` quand disponible), logiciel ou GPU, navigateur et version, OS, et la présence ou non d'une fenêtre. C'est une colonne de l'historique.
- **Un témoin ne se compare qu'à un run du même moteur de rendu.** Le témoin par défaut est le dernier inscrit sur le même moteur. S'il n'y en a pas, le panneau le dit au lieu de comparer des pommes et des oranges.

### 3.9 Métriques de performance par test

Colonnes numériques par test (et par étape pour les e2e) : images par seconde, temps d'image p50 et p95, appels de dessin (`renderer.info.render.calls`), triangles, géométries et textures en mémoire (`renderer.info.memory`), tas JS quand le navigateur l'expose. Elles sont tracées dans la timeline, et elles repèrent l'alourdissement du code avant que les tests ralentissent (G9 et G12 s'y appuient).

### 3.10 Score d'instabilité des tests

À partir de l'historique : un test qui alterne entre réussite et échec alors qu'aucune des fonctions qu'il touche (carte d'impact, §3.6) n'a changé entre les runs est étiqueté automatiquement `instable`, avec un score (nombre d'alternances sur les N derniers runs). Il est affiché dans le rapport et filtrable. Il ne fait pas échouer la porte à lui seul, mais son échec reste un échec : c'est un signal à traiter, pas une excuse.

### 3.11 Raison obligatoire

Les états `ignore` et `avertissement` exigent un champ `raison` non vide (par ex. « pas de WebGL dans cet environnement », « lent : 14 s > seuil 8 s »). Un test ignoré sans raison devient un échec. La raison est une colonne filtrable, et la répartition (§3.5) peut compter par raison.

### 3.12 Rétention du registre

Décidé par l'utilisateur. Le registre ne conserve en détail que :

- les runs des **commits de merge et de PR depuis la dernière release** ;
- **un run par release** (le run de validation du commit étiqueté par `tools/version.js --publier`), gardé en détail pour toujours.

À chaque publication (`tools/version.js --publier` appelle `node tools/registre.js compacter`), les runs de merge et de PR du cycle qui se termine sont **compactés** : on garde leur résumé (états, durées, métriques, raisons, commit), mais on retire leurs images, sauf les images témoins encore épinglées. Les images qui ne sont plus référencées par aucune entrée sont supprimées du stockage. Les runs manuels inscrits suivent la même règle que les runs de merge et de PR. Les cahiers locaux, non versionnés, gardent leur propre limite des N derniers.

### 3.13 Diagnostics joints aux échecs et aux lenteurs

Validé par l'utilisateur. Tout est joint au rapport du test **seulement s'il échoue ou s'il est lent** (sauf les métriques du §3.9, toujours présentes).

- **Enregistreur de vol** : le journal (§3.14) écrit TOUT, niveaux trace et debug compris, dans un tampon circulaire par test (taille bornée). Le tampon est vidé dans le rapport en cas d'échec ou de lenteur, et jeté sinon.
- **Instantané de l'état du jeu** à l'échec : graine, position, heure, météo, chunks chargés, en attente et en maillage, files des workers (génération, maillage), versions de chunk, entités, mode réseau. Une fonction `MC_DEBUG.instantane()` le produit, et le banc l'appelle dans le `finally` du test.
- **Erreurs que la console ne montre pas**, et comment on les attrape :
  - *exceptions non rattrapées et promesses rejetées* : `window.addEventListener('error')` et `('unhandledrejection')` installés AVANT les scripts du jeu. Dans le banc, c'est un script en tête de `tests/index.html`. Sans fenêtre, c'est CDP `Page.addScriptToEvaluateOnNewDocument`, doublé de `Runtime.exceptionThrown`, qui voit tout ce qui remonte au niveau global.
  - *messages du navigateur lui-même* (dépréciations, interventions, erreurs de sécurité) : CDP `Log.entryAdded`. Ils ne passent pas par `console`.
  - *workers* : dans chaque worker, `self.addEventListener('error'/'unhandledrejection')` renvoie l'erreur au fil principal par `postMessage({type:'journal', …})`. Côté pool (src/workers.js), `worker.onerror` et `onmessageerror` alimentent le journal. Sans fenêtre, CDP `Target.setAutoAttach` capte aussi la console et les exceptions des workers.
  - *WebGL* : three.js r128 écrit les erreurs de compilation et de liaison des shaders via `console.error` (`renderer.debug.checkShaderErrors`, laissé à true en test), qui est capté par le journal. L'événement `webglcontextlost` et sa restauration sur le canvas sont journalisés. En mode test seulement, `gl.getError()` est interrogé une image sur 60 : c'est une synchronisation coûteuse, donc échantillonnée et jamais active en jeu normal.
  - *ressources introuvables* : CDP `Network.loadingFailed` et `Network.responseReceived` (statut ≥ 400). Dans le banc, un écouteur `error` en phase de capture sur `window` attrape les `<script>` et `<img>` qui ne chargent pas. WebSocket : `onerror` et le code de `onclose` dans src/net.js vont au journal.
  - *serveur* : pour les tests d'intégration, stdout et stderr du processus serveur sont capturés, plus `process.on('uncaughtException'/'unhandledRejection')`.
- **Tests lents** : tâches longues du fil principal (`PerformanceObserver` sur `longtask`, avec leur attribution), histogramme des temps d'image, et, au-delà du seuil, **profil CPU** (CDP `Profiler.start/stop`, fichier `.cpuprofile` joint et ouvrable dans les DevTools).
- **Profil GPU** (précisé par l'utilisateur), en couches, chacune indiquée « non disponible » plutôt que simulée quand l'environnement ne la fournit pas :
  - *mémoire GPU allouée par le jeu* : `renderer.info.memory` (nombre de géométries et de textures) et une estimation en octets calculée par le jeu (somme des `byteLength` des attributs et des index, plus largeur × hauteur × 4 × 4/3 pour chaque texture mipmappée). Une page web ne peut pas lire la VRAM réelle, mais cette estimation couvre ce que le jeu alloue.
  - *coût de dessin* : appels de dessin, triangles, programmes de shaders (`renderer.info.programs.length`), par passe (ombres, principale, eau, lointain).
  - *temps GPU par image et par passe* : `EXT_disjoint_timer_query_webgl2` quand l'extension est exposée (souvent le cas avec un vrai GPU sous Chrome, rarement en rendu logiciel sans fenêtre), en p50 et p95.
  - *côté processus* : CDP `SystemInfo.getInfo` (GPU, pilote, fonctionnalités accélérées, dans les métadonnées du moteur de rendu, §3.8) et, pour un test lent, une trace Chrome aux catégories `gpu` et `disabled-by-default-gpu.service`, jointe et ouvrable dans le visualiseur de performances.
  - *système, Windows, facultatif* : compteurs `\GPU Process Memory(*)\Dedicated Usage` et `\GPU Engine(*)\Utilization Percentage` lus par le banc via `typeperf` pour le processus GPU du navigateur, soit la VRAM et l'occupation réelles. Seulement en run avec fenêtre sur un vrai GPU.
- **Tests réseau** : les N derniers messages échangés (sens, type, `seq`, taille, horodatage) côté client et côté serveur, plus le journal du serveur pendant le test.

### 3.14 Journal : un vrai logger

Précisé par l'utilisateur : un vrai logger, qui gère aussi les messages d'erreur.

- **Module `MC.Journal`** (src/journal.js), pur, chargé en premier, identique dans le navigateur, les workers, Node (tests vm) et server.js.
- **API** : `var log = MC.Journal('RENDU');` puis `log.trace/debug/info/warn/error/fatal(message, donnees?, erreur?)`. Chaque entrée porte l'horodatage, le domaine, le niveau, le message, des données structurées, la pile de l'erreur, le contexte (joueur local, mode, id du test en cours).
- **Sorties**, chacune avec son seuil :
  - console (par défaut `warn` en jeu, `info` en développement) ;
  - tampon circulaire, tous niveaux (enregistreur de vol, §3.13) ;
  - rapport de test ;
  - fichier du serveur avec rotation (`logs/serveur-<date>.log`) ;
  - en multijoueur, les erreurs `error` et `fatal` du client sont remontées au serveur, avec un débit limité, pour que le journal du serveur rassemble aussi les pannes des clients.
- **Messages d'erreur pour le joueur** : `log.error(message, donnees, erreur, { joueur: 'Impossible de charger la sauvegarde' })`. Une seule voie journalise le détail technique ET affiche au joueur un message lisible (toast ou écran d'erreur). Fini les `alert`, `console.error` et toasts dispersés qui divergent.
- **Codes d'erreur** stables (`E-SAVE-003`…), recensés dans un catalogue (docs/erreurs.md) avec leur cause et la conduite à tenir. On les retrouve avec grep dans les rapports et dans le journal du serveur.
- **Réglage à chaud** : paramètre d'URL `?journal=RENDU:debug,SYNC:trace`, `MC_DEBUG.journal.niveau('SYNC', 'trace')`, option serveur `--journal`.
- **Migration** : les `console.*` de src/ et server.js passent par le journal. Une porte (G16) interdit tout nouveau `console.*` direct hors de src/journal.js.

### 3.15 Campagnes sur l'historique des merges, PR et releases

Validé par l'utilisateur. Une fois le moteur stable, `node tools/registre.js historiser [--depuis <ref>]` lance, pour chaque commit de merge ou de PR et chaque commit de release de l'historique, dans l'ordre, une **vraie campagne complète** sur ce commit. Ce ne sont pas des runs à part : ce sont des campagnes comme les autres, sans marqueur spécial.

- Worktree temporaire sur le commit. Le code du jeu et les tests viennent de ce commit. L'orchestration, les captures (CDP), les diagnostics et l'écriture du registre viennent du moteur actuel. Comme tout run, l'entrée enregistre la version du moteur de test qui l'a produite.
- Métadonnées tirées de git : message du merge, parents, branche fusionnée, auteur, date du commit, fichiers modifiés, `VERSION_JEU` de ce commit, étiquette de release. `debut_run` reste l'heure réelle d'exécution.
- Un test que le moteur ne peut pas faire tourner sur ce commit est `ignore`, avec une raison explicite. Il ne compte jamais comme réussi.
- Reprise après interruption : les commits déjà inscrits sont sautés. Environ 5 à 10 minutes par commit.
- La rétention (§3.12) s'applique comme pour tout run : un run détaillé par release, le reste compacté en résumé.

## 4. Tests (le banc se teste lui-même)

- Node, `tests/spec-banc.js` : filtrage, tri multi-clés, pagination, agrégation des séries, fusion registre + locaux, ordre topologique, ligne sans capture.
- e2e : ouvrir la zone Historique, trier, filtrer, cocher une propriété et vérifier qu'un graphique apparaît, vérifier qu’aucun diaporama n’est ouvert par défaut, puis cliquer une vignette et vérifier que seul le diaporama de cette image s’ouvre sur le run cliqué et parcourt son historique ; lancer une petite campagne, cliquer « Inscrire au registre » et vérifier que l’entrée apparaît dans l’historique avec origine manuel. Captures début, intermédiaire et fin comme tout e2e.
- Fiches SPEC-BANC à créer dans SPECS.md (L42) avant le code, une par exigence ci-dessus.

## 5. Découpage conseillé

0a. Format de données complet (instantané fiche+tags, étapes et triplets §3.7, moteur de rendu §3.8, métriques §3.9, raison obligatoire §3.11) : il conditionne tout le reste, à faire en premier.
0b. Catalogue : champ `fonctions` déclaré, observation des fonctions en Node, instantané fiche+tags dans les cahiers et le registre, fiche affichée avant les résultats dans rapport et cahier (§3.5), G14 étendue.
1. Routes serveur et index en mémoire, avec tests Node.
2. Tableau : colonnes, tri, filtres, pagination, export.
3. Graphiques timeline.
4. Panneau test : un diaporama par image, témoin, comparaison.
5. Intégration dans le banc (bouton, clic depuis la sélection), inscription manuelle en fin de campagne (§3.4) et test e2e.
6. Périmètre d’exécution (§3.6) : carte d’impact, tools/perimetre.js, crochets pre-commit / pre-push / pre-merge-commit, sélection dans le banc, contrôle des trous de périmètre, G13.
7. Rétention (§3.12, branchée sur `tools/version.js --publier`) et score d'instabilité (§3.10).
8. Journal `MC.Journal` et migration des `console.*`, G16 (§3.14) : peut démarrer tout de suite, en parallèle, car il ne dépend d'aucun autre point.
9. Diagnostics d'échec et de lenteur, profil CPU et GPU (§3.13), sur le journal.
10. En dernier, moteur stabilisé : campagnes sur l'historique des merges, PR et releases (§3.15).
