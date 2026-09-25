# Registre officiel de tests

Ce dossier est **versionné dans git**, contrairement à `tests/resultats/`
(gitignoré, cahiers locaux de campagne, rotation aux N derniers). Il ne
retient que ce qui doit faire foi pour l'historique visuel par test — de
quoi retrouver, en remontant l'historique à la main, quel merge a introduit
une dérive (visuelle ou autre). Voir aussi `docs/banc/historique-global.md`
(conception de l'historique global, futur lot d'interface).

Module : `tools/registre.js`. SPEC-BANC-028 à 032 (`SPECS.md`).

## Disposition sur disque

```
tests/registre/
  entrees/
    <date-compacte>_<commit-court>_<preset>.jsonl   — UN FICHIER PAR INSCRIPTION
  images/
    <sha1>.<ext>                                     — captures, adressées par contenu
  temoins.json                                        — { testId: { commit, image } }
```

**Un fichier par inscription**, jamais un `entrees.json` unique : deux
branches (ou deux agents) qui inscrivent chacune la leur ne se gênent
jamais en un conflit de fusion — chaque inscription ajoute un fichier, n'en
modifie jamais un existant.

Format JSONL de chaque fichier `entrees/*.jsonl` : la 1re ligne est les
MÉTA du run, les suivantes un test chacune (une ligne = un enregistrement,
diffs git minimaux, lisible ligne à ligne).

## Schéma d'un run (1re ligne)

| Champ | Type | Notes |
|---|---|---|
| `id` | texte | dérivé de commit+preset+date (stable, indépendant du nom de fichier) |
| `dossierCahier` | texte | nom du cahier local source (`tests/resultats/<nom>`) — sert à l'idempotence |
| `commit` | texte | sha PLEIN (jamais abrégé) du commit réellement testé |
| `branche` | texte ou `null` | |
| `date` | horodatage ISO | démarrage du run |
| `preset` | texte | préréglage lancé (`pr`, `e2e-fumee`, …) |
| `origine` | `pre-push` \| `manuel` | comment le run a été inscrit (`pre-commit` n'inscrit jamais lui-même, il ne fait qu'intégrer une entrée déjà écrite par pre-push — voir plus bas) |
| `inscrit` | booléen | toujours `true` pour une entrée du registre (voir `runsUnifies()`) |
| `statut` | `en_attente` \| `ok` | mécanique interne pre-push → pre-commit, sans rapport avec `inscrit` |
| `motif` | texte ou `null` | raison humaine facultative d'avoir promu CE run précis |
| `arbre_modifie` | booléen | capturé au DÉBUT de la campagne locale (`tests/run.js`), jamais recalculé après coup |
| `interrompu` | booléen | la campagne locale a été arrêtée manuellement |

## Schéma d'un test (lignes suivantes)

| Champ | Type | Notes |
|---|---|---|
| `id`, `nom` | texte | identifiant catalogue (ou `null`), nom affiché |
| `categorie` | `{ type, groupe }` | instantané du catalogue au moment du run |
| `domaines`, `specs`, `etiquettes` | liste de texte | idem |
| `fonctions` | liste | **vide pour l'instant** — l'observation automatique des fonctions réellement appelées est un lot séparé (voir `docs/banc/historique-global.md` §3.5) ; le champ existe déjà pour que ce format n'ait pas besoin de migration |
| `fiche` | `{ teste, pourquoi, attendu, source }` ou `null` | instantané — une fiche modifiée plus tard ne réécrit pas l'historique |
| `debut` | horodatage ISO ou `null` | démarrage DE CE TEST |
| `duree_ms` | nombre | |
| `etat` | `reussi` \| `echec` \| `ignore` \| `avertissement` | voir la règle exacte plus bas |
| `erreur` | texte ou `null` | message d'échec, ou avertissement non bloquant |
| `captures` | liste de `{ role, libelle, image, t_ms }` | voir plus bas |

### Règle exacte de l'état

- `echec` : le test a échoué OU son délai a été dépassé (un test qui n'a
  jamais fini n'a rien prouvé — voir SPEC-BANC-010).
- `ignore` : le test a été sciemment ignoré (pas exécuté).
- Sinon (succès) :
  - `avertissement` si la durée dépasse le seuil (**20 000 ms par défaut**,
    aligné sur `SEUIL_LENT` de `tests/run.js`, réglable via
    `opts.seuilLentMs`) **ou** si le test porte un message malgré sa
    réussite (rare : un avertissement non bloquant remonté par le test
    lui-même) ;
  - `reussi` sinon.
- Un `avertissement` n'est **jamais** un motif d'échec de campagne — c'est
  un signal à regarder, pas un échec.

Deux vocabulaires source coexistent avant normalisation (pré-existant,
hors périmètre de ce lot) : le volet Node et la campagne headless écrivent
`etat: 'ok'`, `runUnE2E` (`tests/e2e.js`, banc navigateur) écrit
`etat: 'reussi'` pour le même sens — `etatRegistre()` traite les deux
comme un succès.

### Captures : rôle, image, t_ms

- `role` : `debut` (première capture du test — toujours prise, même sans
  aucun `capture()`/`etape()` explicite, voir SPEC-BANC-026), `fin`
  (dernière — idem), `intermediaire` (toutes les autres, dont chaque
  `capture('libellé')` nommé appelé explicitement PENDANT le test).
- `libelle` : stable d'un run à l'autre pour une même capture nommée
  (ex. `apres-teleportation`) — c'est CE libellé qui identifie « la même
  image » à travers l'historique d'un test, pas sa position.
- `image` : `<sha1>.<ext>` — le nom de fichier dans `images/` pour une
  entrée du registre (`inscrit: true`) ; pour un run LOCAL non inscrit
  (`runsUnifies()`, `inscrit: false`), c'est le nom de fichier ORIGINAL
  dans `tests/resultats/<dossierCahier>/captures/` (pas un sha1 — un
  cahier local n'est pas partagé, inutile d'y calculer un hash).
- `t_ms` : depuis le début DE CE TEST (pas de la campagne).

## Idempotence

`inscrire(dossierCahier, opts)` refuse d'inscrire deux fois le MÊME cahier
local (`dossierCahier` déjà présent dans une entrée existante) — un motif
explicite est rendu (`{ ok: false, motif: '...' }`), rien n'est écrit.

## Vue unifiée : registre + cahiers locaux

`runsUnifies(opts)` — LE point d'accroche pour un futur lot d'interface
(historique global) : fusionne le registre (`inscrit: true`) et les
cahiers locaux encore présents dans `tests/resultats/` (`inscrit: false`)
en UNE SEULE liste de runs de même forme. Un cahier local déjà inscrit
n'est jamais compté deux fois (représenté uniquement par son entrée de
registre, plus riche). Aucune écriture sur disque, aucun appel git par
run — le rang de commit (dérivé, coûteux à calculer par run) reste à la
charge de l'appelant via `ordreCommits()`/`rangCommit()` (déjà exportées).

## Pont pre-push → pre-commit

`tools/hooks/pre-push.js` inscrit automatiquement chaque cahier qu'il
vient d'écrire (`origine: 'pre-push'`, `statut: 'en_attente'`) : ce hook
tourne APRÈS le commit déjà fait, son écriture ne peut donc pas entrer
DANS le commit qu'elle décrit. `tools/hooks/pre-commit.js`, au commit
SUIVANT, détecte les entrées `en_attente` (`aDesEntreesEnAttente()`), les
repasse à `ok` (`marquerEnAttenteCommitees()`) et les ajoute à l'index
(`git add tests/registre`) — l'entrée reste exacte (elle cite le hash
qu'elle a réellement testé), seul le commit qui la PORTE diffère de celui
qu'elle DÉCRIT.

## Fonctions exportées de `tools/registre.js` (points d'accroche)

Pour le futur lot d'interface / route serveur (`docs/banc/historique-global.md`,
**ne créez ni route ni bouton dans CE lot-ci** — seulement le format) :

- `inscrire(dossierCahier, opts)` — appelable telle quelle depuis une
  future route `POST /tests/registre/inscrire` (§3.4 du document de
  conception) : prend l'identifiant d'un cahier local, `opts.motif`
  facultatif, `opts.origine` (`'manuel'` pour un clic depuis le banc).
- `runsUnifies(opts)` — la liste unifiée à indexer/filtrer/trier côté
  serveur (§2 : `GET /tests/historique/lignes`).
- `historiqueTest(testId, opts)`, `temoinDe`, `marquerTemoin`,
  `exporterHistoriqueHTML` — déjà prêts pour la vue par test (§3.3).
- `ordreCommits(dossierRepo, branche)`, `rangCommit(commits, sha)` — pour
  calculer `rang_commit` côté serveur, une fois par requête (pas par run).
- `etatRegistre(t, seuilLentMs)` — la règle d'état ci-dessus, réutilisable
  telle quelle pour toute agrégation (§3.5 « Répartition »).

## Limite connue : pas de redimensionnement d'image

Les captures sont stockées TELLES QUE produites par le banc/la campagne
sans fenêtre (déjà compressées JPEG) — aucune bibliothèque de traitement
d'image dans ce dépôt, donc pas de recompression/redimensionnement
normalisé (JPEG qualité ~80, 800×600 max) au moment de l'inscription.
Accepté pour l'instant (poids observé : quelques dizaines de Ko par
capture) — à revisiter si le poids du registre devient un problème réel.

## Étiquettes recommandées (`etiquettes`, tags libres)

`rendu`, `reseau`, `lent`, `instable`, `regression:<date>` — liste
indicative, pas une liste fermée : un tag nouveau n'est jamais refusé.
