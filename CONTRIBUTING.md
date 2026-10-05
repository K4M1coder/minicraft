# Contribuer à MiniCraft

Merci de l'intérêt que vous portez à MiniCraft. Ce guide explique comment signaler un problème, proposer une idée ou envoyer du code, et comment le travail est relu puis fusionné ici. Quand une règle est imposée par l'outillage (crochets git, portes de qualité), c'est dit ; quand c'est une simple convention, c'est dit aussi.

## Démarrage rapide

```
git clone https://github.com/K4M1coder/minicraft.git
cd minicraft
node tools/version.js --installer     # branche les crochets git
node server.js                        # lance le jeu
node tests/run.js                     # tests rapides
node tests/gates.js                   # portes de qualité
```

Puis créez une branche (`git switch -c feat/mon-lot`), travaillez selon le [flux de travail](#flux-de-travail-pas-à-pas) et proposez-la au mainteneur (voir [Proposer sa branche](#proposer-sa-branche)).

## Table des matières

1. [Esprit du projet](#esprit-du-projet)
2. [Façons de contribuer](#façons-de-contribuer)
3. [Prérequis et installation](#prérequis-et-installation)
4. [Lancer le jeu](#lancer-le-jeu)
5. [Lancer les tests et les portes de qualité](#lancer-les-tests-et-les-portes-de-qualité)
6. [Organisation du dépôt](#organisation-du-dépôt)
7. [Méthode de travail : spécification puis tests](#méthode-de-travail--spécification-puis-tests)
8. [Flux de travail pas à pas](#flux-de-travail-pas-à-pas)
9. [Conventions](#conventions)
10. [Ce que les crochets git imposent](#ce-que-les-crochets-git-imposent)
11. [Revue et fusion](#revue-et-fusion)
12. [Publication des versions](#publication-des-versions)
13. [Sécurité](#sécurité)
14. [Licence et droits](#licence-et-droits)
15. [Obtenir de l'aide](#obtenir-de-laide)

## Esprit du projet

MiniCraft est un jeu de type bac à sable en 3D, écrit en JavaScript sans dépendance npm et sans étape de compilation. Trois principes guident les décisions :

- **Les comportements sont écrits avant d'être codés.** Chaque comportement a une fiche de spécification vérifiable, et un test qui la cite.
- **Le serveur fait autorité.** Même en solo, le jeu passe par un serveur Node local, ouvert ou non au réseau. Il n'existe pas de mode « sans serveur ».
- **Tout est en français** : commentaires, messages au joueur, journal, documentation, messages de commit et fiches. Les noms de fichiers sont en français sans accents.

Les contributions de toute taille sont les bienvenues, y compris la correction d'une coquille ou d'une fiche ambiguë. Il n'existe ni code de conduite ni modèle de ticket : restez courtois et précis.

## Façons de contribuer

### Signaler un bug

Ouvrez un ticket (issue) sur le dépôt GitHub `K4M1coder/minicraft` en indiquant :

- ce que vous avez fait, ce que vous attendiez, ce qui s'est passé ;
- la graine du monde (`--graine`) si le problème dépend du terrain ;
- votre système, la version de Node (`node -v`) et le navigateur ;
- si possible, la fin du journal du serveur (dossier `logs/`, fichier `serveur-<date>.log`) et les codes d'erreur du type `E-SERV-001` ou `E-SAVE-002` : ils sont expliqués dans `docs/erreurs.md`.

Si le bug a un effet de sécurité, ne le publiez pas : voir [Sécurité](#sécurité).

### Proposer une amélioration

Décrivez d'abord le besoin et le comportement observable attendu dans un ticket, avant d'écrire du code. Une bonne proposition peut se traduire en fiche `SPEC-<DOMAINE>-<NNN>` : sans ambiguïté, observable, falsifiable. Exemple vérifiable : « un zombie à moins de 1,3 bloc inflige ses dégâts au plus une fois par 1,1 s ». Contre-exemples : « le combat doit être agréable », « le zombie attaque ».

Les lots de travail sont ordonnés dans `docs/feuille-de-route.md` ; consultez-la avant de proposer.

### Contribuer au code ou à la documentation

Lisez la suite de ce guide, puis suivez le [flux de travail](#flux-de-travail-pas-à-pas). Les corrections de documentation suivent le même chemin, avec un commit de type `docs`.

## Prérequis et installation

- **Node.js.** Le projet n'a ni `package.json` ni dépendance npm, et aucune version minimale n'est déclarée. Le développement courant se fait avec Node 24. Les tests e2e pilotent le navigateur via `tools/cdp.js`, qui exige Node 22 ou plus (WebSocket global) ; l'empaquetage autonome (SEA, `tools/paquet.js`) suppose Node 20 ou plus. En cas de doute, utilisez Node 24.
- **Git.** Sous Windows, installez Git for Windows : son shell exécute les crochets de `.githooks/`.
- **Edge ou Chrome**, seulement pour les tests de bout en bout (e2e). Sans l'un des deux, ces tests sont ignorés avec un avertissement et un résultat vert ne prouve alors rien sur la partie navigateur.
- Un accès réseau côté navigateur : la bibliothèque Three.js est chargée depuis un CDN.

Installation :

```
git clone https://github.com/K4M1coder/minicraft.git
cd minicraft
node tools/version.js --installer
```

La dernière commande branche les crochets git (`core.hooksPath` pointe vers le dossier `.githooks/` du dépôt principal). **Ne sautez pas cette étape** : sans elle, rien ne vérifie vos commits en local, et la porte G11 échoue. Depuis un worktree, la commande règle le chemin du dépôt principal ; la configuration est commune à tous les worktrees.

## Lancer le jeu

```
node server.js
```

Sans paramètre, le serveur démarre et ouvre le navigateur sur `http://localhost:8080`. Node est nécessaire même pour jouer seul : ouvrir `index.html` directement depuis le disque ne lance plus de partie.

Dès qu'un paramètre est donné (même `--port`), le navigateur n'est pas ouvert automatiquement. Options principales (la liste complète vient de `node server.js --aide`, qui détaille aussi `--partie`, `--pvp`, `--zone`, `--liste-blanche` et `--origines`) :

| Option | Effet |
|---|---|
| `--serveur` | serveur seul, sans partie locale |
| `--port <n>` | port d'écoute (défaut 8080, repli jusqu'à 8099 ; `0` = port éphémère, affiché sur la ligne `MC_PORT=<n>`) |
| `--ouvert` | ouvre le serveur au réseau (par défaut : boucle locale seulement) |
| `--dossier-parties <dossier>` | dossier des parties (défaut `parties`) |
| `--monde <fichier>` | fichier de monde unique |
| `--graine <n>` | graine de génération |
| `--max-joueurs <n>` | nombre de joueurs, de 1 à 100 (défaut 8) |
| `--admin <secret>` | secret de la console d'administration |
| `--tests` | active le banc de tests web sous `/tests/` (machine locale seulement) |
| `--journal <niveaux>` | niveaux de journal, par exemple `SYNC:trace,SERVEUR:debug` |

Un serveur dédié persistant :

```
node server.js --serveur --monde parties/mon-monde.json --admin "un-secret-long"
```

Par défaut le serveur n'écoute que la boucle locale (`127.0.0.1` et `::1`) et refuse les pages tierces. N'ouvrez au réseau (`--ouvert`) que ce que vous voulez vraiment exposer.

Les scripts `start.cmd` et `start.sh` n'existent pas à la racine : ils sont produits dans `dist/` par `node tools/paquet.js` (dossier de sortie par défaut : `dist/`). Depuis les sources, la commande est `node server.js`.

## Lancer les tests et les portes de qualité

```
node tests/run.js                      # unitaire + fonctionnel + spec (sans intégration ni e2e)
node tests/run.js --preset commit      # préréglage des commits
node tests/run.js --preset pr          # suite Node complète, intégration comprise
node tests/run.js --preset e2e-fumee   # cinq e2e rapides dans un navigateur sans fenêtre
node tests/run.js --preset e2e         # tous les e2e
node tests/run.js --preset jouabilite  # jouabilité sur vrai serveur
node tests/gates.js                    # portes de qualité
```

Cibler un test ou un sous-ensemble :

```
node tests/run.js --test SPEC-MODE-001           # par identifiant de fiche
node tests/run.js --test "nom exact du test"
node tests/run.js --groupe "Core — minage"
node tests/run.js --domaine SYNC,NET --type spec
node tests/run.js climat                         # par sous-chaîne
node tests/run.js --echecs                       # rejoue les échecs de la dernière campagne Node
node tests/run.js --preset pr --lister           # affiche la sélection sans rien exécuter
node tests/integration-net.js                    # un script d'intégration seul
```

`--delai N` est un filet anti-blocage : il ne coupe que si rien n'avance depuis N secondes. Ce n'est pas une limite de durée totale, et un test lent va jusqu'au bout. Les crochets l'utilisent avec `--delai 900` (15 minutes d'inactivité).

Banc dans le navigateur : `node server.js --tests`, puis ouvrez `/tests/`. Sans `--tests`, ces routes répondent 404.

Chaque campagne écrit un cahier (rapport HTML et captures) dans un sous-dossier de `tests/resultats/`, nommé d'après la date et la campagne. Ce dossier est ignoré par git ; seuls les 20 derniers sont gardés.

### Les portes de qualité

`node tests/gates.js` exécute les portes automatiques :

| Porte | Contrôle |
|---|---|
| G1 | toute fiche non ⏳ de `SPECS.md` est citée par au moins un test |
| G2 | tout identifiant `SPEC-…` cité par un test existe dans `SPECS.md` (ni fantôme, ni doublon) |
| G3 | tous les tests Node passent |
| G4 | tous les fichiers de `src/` et `server.js` sont syntaxiquement valides (la sortie ne cite que `src/`, mais `server.js` est contrôlé aussi) |
| G5 | aucun module pur ne référence `THREE`, `document`, `window`, `localStorage`, `navigator`, `requestAnimationFrame` |
| G6 | toute fonction exportée d'un module pur est citée par un test |
| G10 | version sémantique et `CHANGELOG.md` d'accord |
| G11 | `core.hooksPath` pointe vers `.githooks`, `commit-msg` et `pre-commit` existent, et la règle du cran de `tools/version.js` donne les résultats attendus |
| G12 | budget de performance de génération et de maillage (`tests/budget-perf.json`) |
| G13 | cohérence entre crochets et préréglages |
| G14 | chaque test a une fiche et au moins un domaine ou une fonction |
| G15 | chaque test e2e produit au moins deux captures réelles |
| G16 | aucun `console.*` direct dans `src/` et `server.js` hors de `src/journal.js` |

G7, G8 et G9 (e2e dans le navigateur, console propre au chargement, au moins 55 images par seconde) sont des contrôles manuels : la commande les rappelle sans les bloquer.

`node tests/gates.js` relance de vraies campagnes (tests et captures e2e dans un navigateur sans fenêtre) : comptez plusieurs minutes et évitez de le lancer en parallèle d'une autre campagne.

## Organisation du dépôt

| Emplacement | Contenu |
|---|---|
| `server.js` | assemblage du serveur uniquement |
| `src/` | modules du jeu, partagés entre client et serveur, et modules serveur `src/serveur-*.js` |
| `tests/` | lanceur `run.js`, `gates.js`, `presets.js`, tests `spec-*.js`, `integration-*.js`, `e2e*.js`, `donnees/ids.json`, `registre/` |
| `tools/` | `version.js`, `paquet.js`, `registre.js`, `perimetre.js`, `mesure-tics.js`, et `hooks/` (implémentation des crochets) |
| `.githooks/` | petits scripts shell qui appellent `tools/hooks/*.js` |
| `docs/` | `feuille-de-route.md`, `erreurs.md`, `charge.md`, `archi-solo-serveur/`, `vague-2/`, `banc/`, etc. |
| `PLAN.md` | la méthode, les portes, la table des lots et leur état |
| `SPECS.md` | les fiches `SPEC-<DOMAINE>-<NNN>` |
| `CHANGELOG.md` | le journal des modifications |

Rôle des trois documents de pilotage :

- **`SPECS.md`** dit *ce que* le jeu doit faire (une ligne de tableau par fiche : identifiant, spec, vérification, état).
- **`PLAN.md`** dit *comment* on travaille et suit l'état des lots.
- **`docs/feuille-de-route.md`** fixe *l'ordre* des lots restants, sans remplacer les deux autres.

Légende des états : ✅ = implémentée (un test doit la citer) ; ⏳ = écrite mais pas encore implémentée (ignorée par G1).

## Méthode de travail : spécification puis tests

Pour chaque comportement, le cycle est le suivant (`PLAN.md`, §1) :

1. **S1** : écrire la fiche dans `SPECS.md` avec un identifiant `SPEC-<DOMAINE>-<NNN>`.
2. **S2** : la valider (sans ambiguïté, observable, falsifiable).
3. **S3** : écrire le test qui cite l'identifiant ; il **doit échouer** (rouge).
4. **S4** : implémenter le minimum pour qu'il passe (vert).
5. **S5** : relire et refactoriser, tests toujours verts.
6. **S6** : passer les portes : `node tests/gates.js` doit être vert.
7. **S7** : commiter.

S6 n'est pas automatisé : aucun crochet ne lance `node tests/gates.js` (le `pre-commit` n'exécute que G1 et G2 en version rapide et G10). C'est à l'auteur de le lancer avant de commiter, et obligatoirement avant une publication.

Règles associées :

- Une fiche passe de ⏳ à ✅ **dans le même commit** que son implémentation et sa preuve, jamais avant.
- Le test cite l'identifiant dans son nom ou dans un commentaire adjacent. Un test de comportement est attendu, pas seulement un test de contrat.
- **Les fiches et le plan ne changent pas sans l'accord du propriétaire du dépôt.** Ajouter, reformuler ou supprimer une fiche, réordonner les lots ou modifier `PLAN.md` se *propose* d'abord (dans un ticket ou dans la description de la branche) ; une fois la proposition acceptée, vous l'inscrivez. Seul le passage de ⏳ à ✅ d'une fiche déjà approuvée, quand vous l'avez implémentée et prouvée, relève de l'auteur du lot.
- Seul G1 contrôle le lien entre ✅ et un test ; le reste est une convention.

### Ajouter des tests

- **Test `describe`/`it`** : créez `tests/spec-<sujet>.js`, ajoutez son nom (sans `.js`) **à la fin** du tableau `NOMS` de `tests/fichiers-tests.js` (l'ordre détermine des identifiants générés : ne rien décaler). Si le fichier utilise `require`, `process` ou `__dirname` dès son chargement, ajoutez-le aussi à `NODE_SEUL` dans le même fichier. Citez au moins une fiche déclarée dans `SPECS.md`.
- **Script d'intégration** : tout `tests/integration-*.js` est découvert automatiquement. Ajoutez une entrée dans l'objet `FICHE_INTEGRATION` de `tests/run.js` (`teste`, `pourquoi`, `attendu`, `domaines`, et `etiquettes: ['lent']` si besoin), sinon G14 échoue. Le script lance son propre serveur avec `--port 0`, l'arrête à la fin et sort avec le code 0 en cas de succès.
- **Test e2e** : `e2e(nom, fiche, async function (g) {...})` dans `tests/e2e.js` (ou `tests/e2e-jouabilite.js`), avec une fiche en littéral JSON. Les captures de début et de fin sont automatiques ; `capture('libellé')` ajoute des captures intermédiaires. Attention : le préréglage `e2e-fumee` est défini par noms exacts de tests dans `tests/presets.js`, donc renommer l'un d'eux le vide silencieusement.

Règles de robustesse : attendez par sondage borné, jamais par délai fixe ; le rendu se teste à 800×600 au minimum, jamais en dessous ; aucun serveur ni navigateur ne doit rester lancé à la fin d'un test.

## Flux de travail pas à pas

Convention : **un lot de travail = une branche**. Si vous menez plusieurs lots de front, utilisez un worktree par lot (copie de travail isolée du même dépôt) ; sinon `git switch -c` suffit.

1. **Faire le point.** Avant tout nouveau lot :
   ```
   git status
   git log --oneline -15
   git worktree list
   ```
   Cherchez une branche non fusionnée à terminer avant de commencer autre chose. Vérifiez aussi que `node tests/run.js --preset commit` et `node tests/gates.js` sont verts sur la base de départ.
2. **Créer la branche** à partir de `master`, soit simplement :
   ```
   git switch -c feat/mon-lot master
   ```
   soit avec un worktree (le nom de dossier est libre) :
   ```
   git worktree add ../minicraft-mon-lot -b feat/mon-lot master
   cd ../minicraft-mon-lot
   ```
   Les crochets de la configuration commune s'appliquent aussi dans un worktree.
3. **Configurer votre identité** (voir [Identité git](#identité-git)).
4. **Écrire la fiche** (S1, S2), puis **le test rouge** (S3).
5. **Implémenter** le minimum (S4), puis refactoriser (S5).
6. **Ajouter la ligne de journal** dans `CHANGELOG.md` sous `## [Non publié]` si votre commit est de type `feat`, `fix` ou `perf` et touche au code.
7. **Passer les portes** : `node tests/gates.js` (S6).
8. **Vérifier ce qui est indexé** : `git status`, puis `git add <fichiers>` plutôt que `git add -A` (`parties/` n'est pas ignoré par git ; ne commitez jamais de parties sauvegardées).
9. **Commiter** (S7). Faites un commit par lot d'étapes testé, régulièrement, pas un seul gros commit en fin de travail. Les crochets s'exécutent : laissez-les finir.
10. **Demander une revue** (voir [Revue et fusion](#revue-et-fusion)) et appliquer les corrections dans de nouveaux commits.
11. **Rebaser sur `master`** puis relancer les tests si la base a bougé :
    ```
    git fetch origin
    git rebase origin/master
    ```
12. **Proposer la branche** (voir [Proposer sa branche](#proposer-sa-branche)).
13. **Mettre à jour le suivi** si vous êtes mainteneur du lot : cocher la ligne de `docs/feuille-de-route.md`, mettre l'état dans la table de `PLAN.md`, committer. Un lot interrompu laisse une note « Reprise » (branche, dernier commit, reste à faire).

### Proposer sa branche

Aucun modèle de demande de fusion n'existe dans le dépôt (pas de dossier `.github/`) et le flux n'est pas formalisé. En pratique :

- avec un droit d'écriture sur `origin`, poussez la branche : `git push -u origin feat/mon-lot` ;
- sans droit d'écriture, forkez `K4M1coder/minicraft`, poussez la branche sur votre fork et ouvrez une demande de fusion vers `master` en listant les fiches touchées ; à défaut, proposez un patch au propriétaire.

Le `pre-push` rejoue la suite complète avant tout push, ce qui reste long (de l'ordre de dizaines de minutes selon la machine). La fusion est ensuite faite par le mainteneur, localement ; une demande de fusion peut donc être fermée comme « fusionnée » sans passer par le bouton de GitHub.

Conseils pratiques :

- Évitez `git stash` : la pile de remisage est partagée entre les worktrees. Faites plutôt un commit de travail en cours.
- Après un push, des fichiers `tests/registre/entrees/*.jsonl` et `tests/registre/images/*.jpg` apparaissent comme non suivis. Ce n'est pas du travail perdu : le prochain `pre-commit` les intègre.
- Le `pre-commit`, restreint au périmètre de vos fichiers, prend de quelques secondes à plusieurs minutes. Pour un push long, lancez-le de façon détachée si votre environnement le permet.

### Identité git

GitHub rattache un commit à un compte d'après l'adresse e-mail de l'auteur. Pour que vos contributions soient reliées à *votre* compte, configurez dans le dépôt l'adresse e-mail **vérifiée de votre compte GitHub** (ou l'adresse « noreply » proposée dans les réglages de votre compte) :

```
git config --local user.name "Votre nom"
git config --local user.email "adresse-verifiee-de-votre-compte-github"
```

N'utilisez pas une adresse non rattachée à votre compte, sinon vos commits apparaîtront comme anonymes.

## Conventions

### Messages de commit

Format du titre : `type(portée facultative)!: résumé`.

Types autorisés : `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `chore`, `build`, `ci`, `style`, `revert`, `specs`.

- Un `!` après le type ou un pied `BREAKING CHANGE:` signale une rupture.
- Titre et corps sont écrits **en français** (convention : le crochet ne vérifie pas la langue).
- Le crochet n'impose aucune longueur maximale de titre ; restez simple et précis.
- Les titres commençant par `Merge `, `Revert "`, `fixup! `, `squash! ` et `amend! ` sont acceptés tels quels.
- Citez les fiches concernées dans le titre ou le corps (`SPEC-MECA-003`, etc.).
- **Pas de ligne `Co-Authored-By`.** C'est une règle de convention du projet, valable pour les personnes comme pour les outils automatisés : un commit a un seul auteur, celui dont le compte GitHub est relié à l'adresse e-mail du commit. Aucun crochet ne la vérifie, et l'historique ancien contient des commits qui en portent encore.

Exemples :

```
feat(meca): levier et bouton au clic droit (SPEC-MECA-003)
fix(sauvegarde): le niveau de batterie survit au rechargement
docs: guide de contribution
chore(release): v0.8.0
```

### Branches

Nommez la branche d'après son objet : `feat/…`, `fix/…`, `docs/…`. Aucun outil n'impose ces noms : c'est une convention. Les branches fusionnées ne sont pas supprimées automatiquement.

### Journal des modifications

`CHANGELOG.md` suit le format « Tenez un Changelog » (en français) et le versionnage sémantique. Chaque `feat`, `fix` ou `perf` qui touche au code ajoute **une ligne** sous `## [Non publié]`, dans le même commit, sous un sous-titre comme `### Ajouté` ou `### Corrigé`, en français, en citant les fiches `SPEC-XXX-NNN` et les tests. Une seule ligne par changement. Les commits `docs`, `test`, `chore` et `specs` n'en ont pas besoin. Le crochet vérifie seulement la présence de `CHANGELOG.md` dans le commit, pas son contenu : la ligne elle-même relève de la convention.

### Style de code

- **Suivez le style du fichier que vous modifiez.** Il n'est pas uniforme.
- Les modules de `src/` sont des IIFE `(function (G) { 'use strict'; … })` en JavaScript ES5 avec `var`. Les fonctions `installer(S)` des modules `src/serveur-*.js` utilisent en revanche `const` et la déstructuration. `server.js`, `tests/` et `tools/` sont en JavaScript moderne.
- Chaque fichier commence par un commentaire d'en-tête qui explique le *pourquoi* : `/* nom.js — rôle (SPEC-…) */`.
- Les **modules purs** ne touchent ni au DOM ni à Three.js (porte G5) : c'est ce qui permet au serveur de les réutiliser et de tout tester sous Node.
- Pas de `console.*` direct dans `src/` ni dans `server.js` : passez par `MC.Journal` (porte G16).
- Le contexte `vm` des modules serveur n'a ni `process`, ni `require`, ni minuteries, ni `Buffer` : tout ce qui vient de Node passe par `S.hote`. Un nouveau module serveur doit aussi être ajouté à la liste `MODULES` de `server.js`.
- Fins de ligne LF partout (`.gitattributes`).
- La génération du monde, la météo et le vent sont des fonctions pures de la graine : même graine, même résultat. Ne cassez pas ce déterminisme.

### Règles à ne pas enfreindre

- **Identifiants de blocs et d'objets figés.** `tests/donnees/ids.json` (fiche SPEC-SAVE-019) fige chaque identifiant. Ajouter un bloc ou un objet = une ligne de plus ; en retirer un = le déplacer dans `retires`. Ne renumérotez jamais, et ne permutez pas les entrées des listes de formes dans `src/core.js`.
- **Sauvegardes.** Toute évolution de format passe par `src/save.js`, avec migration.
- **Messages réseau.** Tout nouveau message du client vers le serveur est validé côté serveur. Les contrats `src/contrats-archi.js` et `src/contrats-vague2.js` sont figés : un besoin nouveau passe par un commit d'amendement dédié qui ne touche que ce fichier et `tests/spec-contrats-archi.js`.
- **Codes d'erreur.** Format `E-<DOMAINE>-<NNN>`, catalogués dans `docs/erreurs.md`. Un code ne change jamais de sens et n'est jamais réutilisé ; tout code écrit dans `src/` ou `server.js` doit avoir sa ligne dans ce fichier. Le texte montré au joueur ne contient pas le code.
- **Performance du serveur.** Le tic serveur se mesure avec `node tools/mesure-tics.js` ; le banc de charge est `node tests/charge.js` (voir `docs/charge.md`).

## Ce que les crochets git imposent

Ces contrôles sont **automatiques** si vous avez lancé `node tools/version.js --installer`.

**`commit-msg`** refuse :

- un titre qui ne respecte pas le format ci-dessus ;
- un `feat`, `fix` ou `perf` qui indexe du code (`src/`, `server.js`, `index.html`, `admin.html`, `tools/`) sans `CHANGELOG.md` dans le même commit ;
- une modification de la ligne `var VERSION_JEU = ` (dans `src/core.js`) hors d'un commit dont le titre a la forme `chore(release): vX.Y.Z` (le `v` est toléré absent ; chaque nombre a 1 à 5 chiffres) ;
- un commit `chore(release)` qui ne modifie pas `VERSION_JEU`.

**`pre-commit`** :

- intègre d'abord au commit les inscriptions du registre de tests (`tests/registre/`) restées « en attente » après un push précédent ;
- vérifie la syntaxe (`node --check`) de chaque `.js` indexé ;
- cherche les marqueurs de conflit oubliés (`<<<<<<< ` et `>>>>>>> `) dans les fichiers `.js .html .md .css .json` indexés ;
- exécute les versions rapides de G1 et G2 ;
- vérifie l'accord entre `VERSION_JEU` et `CHANGELOG.md`, qui doit contenir la section `## [Non publié]` ;
- puis, en l'absence d'erreur, lance `node tests/run.js --preset commit --perimetre commit --delai 900`.

Le périmètre limite l'exécution aux tests touchés par vos fichiers, d'après la carte d'impact `tests/registre/impact.json` : quelques secondes pour une fonction. Dès que l'outillage, le serveur ou la page sont touchés, ou si le périmètre ne peut pas conclure, il se replie sur le préréglage `commit` entier, qui prend plusieurs minutes. Pour voir ce qui serait lancé : `node tools/perimetre.js --lister`.

**`pre-push`** rejoue toujours la suite complète, jamais un périmètre : `node tests/run.js --preset pr` puis `node tests/run.js --preset e2e-fumee`. Un poste sans Edge ni Chrome ne voit pas son push refusé pour l'e2e. Le message de refus est « push refusé ».

**`pre-merge-commit`** lance la même suite complète quand git crée un commit de fusion sans conflit ; en cas de conflit résolu à la main, c'est `pre-commit` (qui détecte la fusion en cours via `MERGE_HEAD`) qui s'en charge. Une avance de branche (fast-forward) ne crée pas de commit de fusion et ne déclenche donc ni l'un ni l'autre : seul le `pre-push` s'applique alors.

Le filet de 900 secondes d'inactivité commun aux crochets est un filet de sécurité, pas une limite de durée.

## Revue et fusion

### Revue adversariale (convention)

Avant toute fusion, chaque lot passe par une **revue adversariale** : un relecteur distinct de l'auteur cherche activement à casser le lot. Il examine les bugs, les failles (notamment tout nouveau message client vers serveur), les régressions, les désynchronisations client/serveur, les pertes de performance et la conformité aux fiches. Il vérifie aussi que les nouveaux tests échouent bien sans le correctif (en réintroduisant le défaut dans une copie jetable). Les corrections sont ensuite appliquées, généralement dans un commit « corrections de la revue adversariale ».

C'est une **convention** : aucun crochet ni aucune porte ne la vérifie. Elle est cependant exigée : on ne coche pas un lot comme terminé dans la feuille de route sans fiches ✅ **et** revue appliquée.

### Critères d'un lot prêt à fusionner

- les fiches du lot sont passées à ✅ dans le commit qui les livre, chacune citée par un test de comportement ;
- `node tests/run.js --delai 900` et `node tests/gates.js` sont verts ;
- les suites d'intégration du lot sont vertes ;
- les e2e du lot sont verts, à 800×600 au minimum ;
- aucun serveur ni navigateur n'est laissé en marche ;
- chaque `feat` et `fix` a sa ligne dans `CHANGELOG.md` ;
- la revue adversariale est faite et appliquée.

Une fonctionnalité est « terminée » (`PLAN.md`, §5) quand ses fiches sont écrites et citées, que les tests passent sous Node et dans le navigateur, que le comportement a été observé dans le jeu (capture à l'appui), que le `README.md` reflète l'état réel, limites comprises, et que tout est commité.

### Comment on fusionne

Il n'y a pas de bouton de fusion automatisé : le mainteneur (ou l'orchestrateur du lot) fusionne en local, puis pousse. La pratique actuelle est de garder un **historique linéaire** :

1. rebaser la branche du lot sur `master` (`git rebase master`), avant la revue puis de nouveau juste avant de fusionner ;
2. une fois la revue appliquée, avancer `master` sur la branche :
   ```
   git switch master
   git merge --ff-only feat/mon-lot
   ```
3. relancer `node tests/gates.js` ;
4. pousser `master` (le `pre-push` rejoue alors la suite complète). Un push long se lance de façon détachée.

Pourquoi l'avance de branche plutôt qu'un commit de fusion : chaque commit de fusion déclenche la suite complète du crochet (voir plus haut), qui dure plusieurs minutes à plusieurs dizaines de minutes ; l'avance de branche ne la déclenche pas, et la suite complète tourne une seule fois, au push. L'historique plus ancien contient de vrais commits de fusion (par exemple `feat(banc): fusion de …`) ; aucun outil n'impose l'une ou l'autre forme, c'est une convention qui peut évoluer.

Si deux lots touchent la même zone, fusionnez-les l'un après l'autre : le second se rebase sur le résultat du premier, puis est vérifié avant fusion.

En cas de conflit au rebase, appliquez l'**union, dans l'ordre d'arrivée**, pour les listes de chargement qui s'additionnent : `tests/run.js`, `tests/gates.js`, `MODULES` de `server.js`, `SRC` de `index.html`, `tests/index.html`, `tests/fichiers-tests.js`. Pour `CHANGELOG.md` sous « Non publié », gardez toutes les lignes, sans doublon. Vérifiez ensuite qu'aucun marqueur de conflit ne reste. Pour limiter les collisions, les fichiers du registre `tests/registre/entrees/` sont des fichiers séparés par inscription.

## Publication des versions

La version `X.Y.Z` (1 à 5 chiffres chacun) est la valeur de `VERSION_JEU` dans `src/core.js` et la dernière entrée publiée de `CHANGELOG.md`. **Ne la modifiez jamais à la main** : le crochet `commit-msg` refuse tout changement de `VERSION_JEU` hors d'un commit `chore(release): vX.Y.Z`. Les contributeurs n'incrémentent donc jamais la version ; c'est un mainteneur qui publie, à la fin d'un ensemble cohérent de lots.

```
node tools/version.js --prevoir     # montre ce qui serait fait, sans rien écrire
node tools/version.js --publier     # calcule le cran, date le journal, commite et étiquette
node tools/version.js --publier y   # force le cran (x, y ou z)
node tools/version.js --verifier    # contrôle seul (porte G10)
```

Le cran est calculé d'après les commits (hors commits de fusion) depuis la dernière étiquette `v*` : une rupture monte X (ou Y tant que X vaut 0), un `feat` monte Y, un `fix` ou un `perf` monte Z. Les commits `docs`, `test`, `chore`, `specs` ne déclenchent aucune publication (« Rien à publier »). La commande date la section « Non publié » du journal, compacte le registre de tests, crée le commit `chore(release): vX.Y.Z` et pose l'étiquette annotée `vX.Y.Z`, puis construit l'archive `dist/releases/minicraft-vX.Y.Z.zip`. La publication est annulée proprement (version, journal et registre remis comme avant) si le commit ou l'étiquette échoue ; l'échec de construction du zip n'annule pas la publication. Le dossier `dist/` est ignoré par git. Lancez `node tests/gates.js` avant toute publication, puis poussez `master` et l'étiquette (`git push origin master`, `git push origin vX.Y.Z`).

## Sécurité

Le serveur traite des données venant de clients et peut être ouvert au réseau ; la sécurité y est prise au sérieux (fiches `SECU-*` dans `SPECS.md`).

**Ne publiez pas de vulnérabilité** dans un ticket public, une demande de fusion ou un forum : cela exposerait les utilisateurs avant qu'un correctif existe. Il n'existe pas encore de fichier `SECURITY.md` ni de procédure formelle. Le canal prévu est le signalement privé de vulnérabilité de GitHub (onglet Security, « Report a vulnerability »), **à confirmer par K4M1coder** : il doit être activé par le propriétaire. Tant que ce n'est pas confirmé, ouvrez un ticket **sans détail technique** en demandant un canal privé, puis décrivez le problème, sa reproduction et son impact uniquement par ce canal.

Pour le code que vous écrivez :

- validez tout nouveau message du client vers le serveur (forme, taille, caractères de contrôle) ;
- ne faites jamais confiance au client pour une valeur que le serveur doit décider, comme une signature ou un résultat ;
- ne transmettez jamais le secret d'administration dans une URL (il passe par l'en-tête `Authorization: Bearer`) ;
- ne servez pas de nouveau fichier sans l'ajouter à la liste blanche prévue.

## Licence et droits

Le dépôt ne contient actuellement aucun fichier `LICENSE`. Aucune licence n'est donc déclarée ici et ce guide n'en suppose aucune. Le dépôt appartient à K4M1coder : pour toute question sur les droits d'utilisation, de redistribution ou sur ceux de vos contributions, adressez-vous à lui avant de contribuer.

## Obtenir de l'aide

- **Prise en main du jeu et des commandes** : `README.md`.
- **Méthode, portes et lots** : `PLAN.md` et `docs/feuille-de-route.md`.
- **Comportements attendus** : `SPECS.md`.
- **Erreurs et codes `E-…`** : `docs/erreurs.md`.
- **Architecture solo/serveur et organisation des vagues** : `docs/archi-solo-serveur/README.md`, `docs/vague-2/README.md`.
- **Tests et historique** : `tests/registre/README.md`, `docs/banc/historique-global.md`.
- **Question ou doute sur un lot** : ouvrez un ticket sur le dépôt GitHub `K4M1coder/minicraft` en citant l'identifiant de fiche concerné.

Merci de contribuer.
