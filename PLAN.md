# Plan de développement — MiniCraft

Méthode : **Spec-Driven Development + TDD**. Rien n'est implémenté avant d'être
spécifié, et rien n'est spécifié sans être vérifiable.

---

## 1. Boucle de travail

Pour chaque comportement attendu, le cycle est strictement le suivant :

| Étape | Action | Preuve produite |
|---|---|---|
| **S1** | Écrire la spec dans `SPECS.md` avec un identifiant `SPEC-<DOMAINE>-<NNN>` | une ligne de spec vérifiable |
| **S2** | Valider la spec : sans ambiguïté, observable, falsifiable | relecture (agent ou soi) |
| **S3** | Écrire le test qui cite l'identifiant — **il doit échouer** | test rouge |
| **S4** | Implémenter le minimum pour faire passer le test | test vert |
| **S5** | Relire et refactoriser à tests verts | diff propre |
| **S6** | Passer les portes de qualité | `node tests/gates.js` vert |
| **S7** | Commit | entrée dans l'historique |

Une spec non couverte par un test est un échec de la porte G1 : le projet
refuse d'être déclaré vert.

### Ce qui compte comme « spec vérifiable »

- ✅ « Un zombie à moins de 1,3 bloc inflige ses dégâts au plus une fois par 1,1 s »
- ❌ « Le combat doit être agréable » (non falsifiable)
- ❌ « Le zombie attaque » (non observable : quelle portée, quelle cadence ?)

---

## 2. Portes de qualité

Exécutées par `node tests/gates.js`. Toute porte rouge bloque le commit.

| Porte | Règle | Automatisée |
|---|---|---|
| **G1** | Toute spec de `SPECS.md` est citée par au moins un test | oui |
| **G2** | Tout test cite une spec existante (pas d'identifiant fantôme) | oui |
| **G3** | 100 % des tests Node passent | oui |
| **G4** | Tous les fichiers de `src/` sont syntaxiquement valides | oui |
| **G5** | Aucun module de logique pure ne référence `THREE`, `document`, `window` | oui |
| **G6** | Toute fonction exportée d'un module pur est citée par un test | oui |
| **G7** | 100 % des tests end-to-end passent dans le navigateur | manuelle (page de tests) |
| **G8** | Aucune erreur console au chargement du jeu | manuelle (navigateur) |
| **G9** | 55 images/s au minimum en jeu, écran partagé compris | manuelle (mesure e2e) |

G5 mérite un mot : c'est cette porte qui garantit que la logique reste
exécutable sous Node. Sans elle, une seule référence à `window` glissée dans
`world.js` ferait s'effondrer toute la stratégie de test.

---

## 3. Lots de travail

Chaque lot suit le cycle S1→S7 et se termine par un commit.

| Lot | Contenu | Domaine de spec | État |
|---|---|---|---|
| **L0** | Outillage : `SPECS.md`, `gates.js`, dépôt git | — | fait |
| **L1** | Correctifs issus de l'audit de code | `AUDIT` | |
| **L2** | Modes créatif / survie | `MODE` | |
| **L3** | Quatre difficultés, dont cauchemar (effacement à la mort) | `DIFF` | |
| **L4** | Parties multiples, menu, choix de la graine | `SAVE` | |
| **L5** | Armes : ficelle, arc, flèches, projectiles | `ARME` | |
| **L6** | Chat | `CHAT` | |
| **L7** | Écran partagé 2 à 4 joueurs locaux | `SPLIT` | |
| **L8** | Multijoueur client/serveur | `NET` | |
| **L9** | Revue finale, documentation, portes complètes | — | |

### Dépendances entre lots

```
L1 ──┬── L2 ── L3 ──┬── L4
     │              │
     ├── L5         ├── L7 ──┐
     │              │        ├── L8
     └── L6 ────────┘────────┘
```

L7 (écran partagé) doit précéder L8 (réseau) : le passage à N joueurs locaux
impose la refonte qui rend ensuite les joueurs distants triviaux à ajouter.
L'inverse obligerait à refaire le travail deux fois.

---

## 4. Risques identifiés et parades

| Risque | Parade |
|---|---|
| La refonte multi-joueurs casse le solo | Le solo devient « une partie à un joueur local » : même chemin de code, donc testé en permanence |
| Le serveur WebSocket sans dépendance est long à fiabiliser | Le protocole RFC 6455 est implémenté et testé isolément, avant tout usage jeu |
| Le cauchemar efface des données par erreur | L'effacement est une fonction pure testée, appelée à un seul endroit |
| Les manettes sont intestables automatiquement | `navigator.getGamepads` est injecté, donc simulable dans les tests |
| Divergence de simulation entre clients | Autorité serveur explicite, documentée par domaine |

---

## 5. Définition de « terminé »

Une fonctionnalité est terminée quand :

1. ses specs sont écrites et citées par des tests ;
2. tous les tests passent, sous Node **et** dans le navigateur ;
3. les neuf portes sont vertes ;
4. le comportement a été observé manuellement dans le jeu (capture à l'appui) ;
5. le README reflète l'état réel, limites comprises ;
6. c'est commité.
