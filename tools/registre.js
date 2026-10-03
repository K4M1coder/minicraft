#!/usr/bin/env node
/* tools/registre.js — registre OFFICIEL, VERSIONNÉ dans git, de l'historique
   par test (SPEC-BANC-028/029/030/031). Distinct des cahiers locaux de
   tests/resultats/ (gitignorés, rotation normale, voir tools/resultats-tests.js
   et tools/cahier.js) : ceux-ci restent inchangés, produits à CHAQUE campagne.
   Le registre, lui, ne retient que ce qui doit faire foi pour comparer
   visuellement un même test au fil du temps — utile pour retrouver, en
   remontant l'historique à la main, quel merge a introduit une dérive.

   Disposition sur disque (tests/registre/, versionné — voir .gitignore qui
   n'exclut QUE tests/resultats/, jamais ce dossier-ci) :
     entrees/<date-compacte>_<commit-court>_<preset>.jsonl — UN FICHIER PAR
       INSCRIPTION (pas un entrees.json unique : deux branches qui inscrivent
       chacune la leur provoqueraient un conflit de fusion à chaque fois sur
       un même gros tableau JSON). Format JSONL, une ligne par enregistrement :
       la 1re ligne est les MÉTA de l'entrée ({ commit (sha plein), branche,
       date, preset, origine, statut }), les suivantes un test chacune
       ({ id, nom, etat, duree_ms, captures: [{ libelle, hash, ext }] }) —
       lisible ligne à ligne, diffs git minimaux (une inscription = un
       fichier ajouté, jamais une ligne modifiée dans un fichier existant).
     images/<sha1>.<ext> — les captures elles-mêmes, adressées par CONTENU :
       deux entrées dont une capture est OCTET POUR OCTET identique au témoin
       courant partagent le même fichier, jamais recopié.
     temoins.json — { [testId]: { commit, hash } } — épinglage manuel, un
       seul petit fichier (un épinglage est un geste rare et délibéré, pas
       une écriture automatique à chaque campagne comme entrees/).

   Poids dans git : ces captures sont volontairement des JPEG compressés
   (qualité ~80 quand la source le permet) et RESTENT à la résolution reçue —
   voir la limite documentée plus bas (aucune bibliothèque de traitement
   d'image dans ce dépôt : redimensionner un JPEG arbitraire en pur Node,
   sans dépendance, sortirait largement du budget de ce lot ; suivi comme
   limite connue, pas comme un oubli).

   Origine avant/pendant push (SPEC-BANC-028) :
   - `tools/hooks/pre-push.js` inscrit AUTOMATIQUEMENT chaque cahier qu'il
     vient d'écrire (préréglages `pr` et `e2e-fumee`), avec `origine:
     'pre-push'` et `statut: 'en_attente'` — le commit qu'il cite (HEAD au
     moment du push) existe déjà, mais pre-push tourne APRÈS ce commit : son
     écriture dans tests/registre/ ne peut pas entrer DANS le commit testé.
   - `tools/hooks/pre-commit.js`, au commit SUIVANT, détecte les entrées
     `en_attente`, les repasse à `ok` et les ajoute (`git add`) au commit en
     cours — l'entrée reste exacte (elle cite le hash qu'elle a testé), seul
     le commit qui la PORTE diffère de celui qu'elle DÉCRIT.
   - Une inscription manuelle (`--inscrire`, CLI) porte `origine: 'manuel'`,
     `statut: 'ok'` immédiatement (pas de délai commit/push à combler), et
     n'entre PAS dans l'historique par défaut (voir historiqueTest()). */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { envGitPour } = require('./git-propre.js'); // jamais les GIT_* d'un crochet sur un autre dépôt

const RACINE = path.join(__dirname, '..');
const DOSSIER_REGISTRE = path.join(RACINE, 'tests', 'registre');
const DOSSIER_REGISTRE_REL = 'tests/registre';
const DOSSIER_IMAGES = path.join(DOSSIER_REGISTRE, 'images');
const DOSSIER_ENTREES_REL = 'entrees';
const CHEMIN_TEMOINS_REL = 'temoins.json';

function lireJSON(p, defaut) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return defaut; }
}
function ecrireJSON(p, valeur) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(valeur, null, 2) + '\n');
}
function lireTemoins(dossierRegistre) { return lireJSON(path.join(dossierRegistre || DOSSIER_REGISTRE, CHEMIN_TEMOINS_REL), {}); }
function ecrireTemoins(temoins, dossierRegistre) { ecrireJSON(path.join(dossierRegistre || DOSSIER_REGISTRE, CHEMIN_TEMOINS_REL), temoins); }

function sha1(buffer) { return crypto.createHash('sha1').update(buffer).digest('hex'); }
function extensionDe(fichier) { const m = /\.(\w+)$/.exec(fichier || ''); return m ? m[1].toLowerCase() : 'jpg'; }
const MIME_PAR_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function pad2(n) { return String(n).padStart(2, '0'); }
function slugSimple(txt) {
  return String(txt === undefined || txt === null ? '' : txt).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'sans-nom';
}
/* Nom de fichier d'une entrée : <date-compacte>_<commit-court>_<preset>.jsonl
   — trié alphabétiquement, il retombe dans l'ordre chronologique local (pas
   forcément l'ordre de commit, voir historiqueTest()). */
function nomFichierEntree(entree) {
  const d = new Date(entree.date || Date.now());
  const compact = d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + '-' +
    pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + pad2(d.getUTCSeconds());
  const commitCourt = (entree.commit || 'inconnu').slice(0, 10);
  return compact + '_' + commitCourt + '_' + slugSimple(entree.preset) + '.jsonl';
}
function dossierEntreesDe(dossierRegistre) { return path.join(dossierRegistre || DOSSIER_REGISTRE, DOSSIER_ENTREES_REL); }

/* Écrit UNE entrée dans SON PROPRE fichier JSONL (1re ligne = méta de
   l'entrée, une ligne par test ensuite) — voir l'en-tête du module : jamais
   d'ajout à un fichier partagé, pour que deux inscriptions concurrentes
   (deux branches, deux agents) ne se gênent jamais en un conflit de fusion.
   Un doublon de nom (même seconde, même commit, même préréglage — surtout en
   test) reçoit un suffixe -2, -3… plutôt que d'écraser l'existant. */
function ecrireEntreeFichier(dossierRegistre, entree) {
  const dEntrees = dossierEntreesDe(dossierRegistre);
  fs.mkdirSync(dEntrees, { recursive: true });
  // TOUT sauf `tests` (qui suit, une ligne chacun) : voir historiqueTest()/
  // runsUnifies() qui relisent ces champs sur l'objet reconstruit.
  const meta = Object.assign({}, entree, { tests: undefined });
  delete meta.tests;
  const lignes = [JSON.stringify(meta)].concat((entree.tests || []).map(t => JSON.stringify(t)));
  const base = nomFichierEntree(entree);
  let nom = base, n = 1;
  while (fs.existsSync(path.join(dEntrees, nom))) { n++; nom = base.replace(/\.jsonl$/, '') + '-' + n + '.jsonl'; }
  fs.writeFileSync(path.join(dEntrees, nom), lignes.join('\n') + '\n');
  return nom;
}
function lireEntreeFichier(cheminFichier) {
  let brut;
  try { brut = fs.readFileSync(cheminFichier, 'utf8'); } catch (e) { return null; }
  const lignes = brut.split('\n').filter(Boolean);
  if (!lignes.length) return null;
  let meta;
  try { meta = JSON.parse(lignes[0]); } catch (e) { return null; }
  const tests = lignes.slice(1).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  return Object.assign({}, meta, { tests: tests, _fichier: path.basename(cheminFichier) });
}
function listerFichiersEntrees(dossierRegistre) {
  const d = dossierEntreesDe(dossierRegistre);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter(f => f.endsWith('.jsonl')).sort().map(f => path.join(d, f));
}
/* Relit TOUTES les entrées (une par fichier de entrees/) — même forme
   qu'avant l'éclatement en un fichier par inscription : les consommateurs
   (historiqueTest, aDesEntreesEnAttente…) n'ont rien à connaître du
   découpage sur disque. */
function lireEntrees(dossierRegistre) { return listerFichiersEntrees(dossierRegistre).map(lireEntreeFichier).filter(Boolean); }

// ── accès git (best-effort : hors dépôt, ou dépôt superficiel, rend null) ──
function git(dossierRepo, args) {
  try { return execFileSync('git', args, { cwd: dossierRepo || RACINE, encoding: 'utf8', env: envGitPour(dossierRepo || RACINE) }).trim(); }
  catch (e) { return null; }
}
function commitPlein(dossierRepo, refOuCourt) { return git(dossierRepo, ['rev-parse', refOuCourt || 'HEAD']); }
function brancheCourante(dossierRepo) { return git(dossierRepo, ['rev-parse', '--abbrev-ref', 'HEAD']); }
/* `git rev-list --topo-order <branche>` : du commit le plus RÉCENT au plus
   ancien, en respectant l'ordre topologique du graphe (parent toujours après
   ses enfants) — c'est l'ordre « officiel » de la branche, indépendant de
   quand un test a été relancé après coup. `null` hors dépôt (ou branche
   inconnue) : l'appelant retombe alors sur le tri par lancement. */
function ordreCommits(dossierRepo, branche) {
  const out = git(dossierRepo, ['rev-list', '--topo-order', branche || 'HEAD']);
  return out === null ? null : out.split('\n').filter(Boolean);
}
function rangCommit(commits, sha) {
  if (!commits || !sha) return -1;
  return commits.indexOf(sha);
}

// ── vocabulaire d'état du registre (SPEC-BANC-032) ──────────────────────
/* `etatRegistre` normalise vers 'reussi'|'echec'|'ignore'|'avertissement' —
   voir tests/registre/README.md pour la règle documentée pour un humain.
   Deux vocabulaires source coexistent AVANT normalisation (pré-existant,
   pas introduit ici) : le volet Node et la campagne headless écrivent
   `etat: 'ok'`, tandis que `runUnE2E` (tests/e2e.js, banc navigateur)
   écrit `etat: 'reussi'` pour le même sens — RIEN dans ce lot ne change
   cette incohérence amont (hors périmètre), `etatRegistre` se contente de
   traiter les deux comme un succès. 'delai' (délai dépassé) compte comme
   un échec : un test qui n'a jamais fini n'a rien prouvé.
   RÈGLE EXACTE « avertissement » : un test qui a RÉUSSI (ok/reussi) mais
   soit a dépassé `seuilLentMs` (20 000 ms par défaut, aligné sur
   SEUIL_LENT de tests/run.js), soit porte un `message` non vide malgré la
   réussite (rare : un avertissement non bloquant remonté par le test
   lui-même) — jamais un motif d'échec, juste un signal à regarder. */
const SEUIL_LENT_DEFAUT_MS = 20000;
/* SPEC-BANC-089 : `ignore` et `avertissement` exigent une RAISON non vide —
   un test ignoré sans raison n'a rien prouvé de son ignorance, il devient
   donc un échec (jamais un simple silence). La raison d'un test source est
   cherchée dans `t.raison` (nouveau champ, prioritaire) puis `t.message`
   (rétro-compatible : c'est déjà là qu'un test ignoré remontait son motif
   avant ce lot). `raisonRegistre`, plus bas, calcule la raison à STOCKER
   dans l'entrée, cohérente avec l'état ici résolu — les deux fonctions
   restent séparées pour ne pas changer la signature de celle-ci. */
function raisonSource(t) {
  const r = (t && (t.raison || t.message)) || '';
  return String(r).trim();
}
function etatRegistre(t, seuilLentMs) {
  const src = (t && t.etat) || '';
  if (src === 'echec' || src === 'delai') return 'echec';
  if (src === 'ignore') return raisonSource(t) ? 'ignore' : 'echec';
  const lent = (t && t.duree_ms || 0) > (seuilLentMs === undefined ? SEUIL_LENT_DEFAUT_MS : seuilLentMs);
  if (lent || (t && t.message)) return 'avertissement';
  return 'reussi';
}
/* Raison à STOCKER pour ce test (SPEC-BANC-089), cohérente avec l'état que
   `etatRegistre` vient de rendre :
   - `ignore` : la raison source (jamais vide ici, sinon `etatRegistre`
     aurait déjà reclassé en `echec` avant qu'on y arrive) ;
   - `avertissement` par lenteur : raison AUTOMATIQUE (« lent : 14.0 s >
     seuil 20.0 s »), même si le test portait aussi un message ;
   - `avertissement` par message (succès malgré tout) : la raison EST ce
     message ;
   - tout autre état (`reussi`/`echec`) : pas de raison exigée, `null`. */
function raisonRegistre(t, etat, seuilLentMs) {
  if (etat === 'ignore') return raisonSource(t) || null;
  if (etat === 'avertissement') {
    const seuil = seuilLentMs === undefined ? SEUIL_LENT_DEFAUT_MS : seuilLentMs;
    const lent = (t && t.duree_ms || 0) > seuil;
    if (lent) return 'lent : ' + (t.duree_ms / 1000).toFixed(1) + ' s > seuil ' + (seuil / 1000).toFixed(1) + ' s';
    return raisonSource(t) || null;
  }
  return null;
}

/* SPEC-BANC-083 : seuil d'instabilité (écart moyen de pixels entre deux
   images consécutives d'un triplet) au-delà duquel le registre OFFICIEL
   garde le triplet COMPLET plutôt que sa seule image centrale — constante
   documentée, réglable par l'appelant (`opts.seuilInstabilite` de
   `inscrire()`) pour un test qui aurait besoin d'un seuil différent sans
   toucher au code. Valeur par défaut choisie empiriquement : un écart
   moyen (0-255 par canal) de 6 dépasse largement le bruit de compression
   JPEG d'une scène immobile, mais reste sous ce que produit une vraie
   saccade ou un scintillement d'une image à l'autre. */
const SEUIL_INSTABILITE_PIXELS_DEFAUT = 6;

/* Convertit les captures BRUTES d'un test (resultats.json, avec `fichier`
   pointant dans un dossier captures/ local) en enregistrements du registre
   ({ role, libelle, image, t_ms }), en écrivant chaque image (déduplication
   par contenu) dans `dossierImages`. Rôle : celui déjà posé par le harnais
   qui a produit la capture (tests/e2e.js `assignerRoles()`) s'il existe,
   sinon déduit PAR POSITION ici (1re = debut, dernière = fin, le reste =
   intermediaire) — filet de sécurité pour une source plus ancienne/externe
   qui ne le poserait pas.

   SPEC-BANC-083 : une capture de rôle `triplet` (trois par étape×bord,
   `rang` 0-2, voir tests/e2e.js) est un cas à part — TOUS ses NOMBRES
   (pose, instabilité, numéro d'image, durée d'image) sont TOUJOURS gardés,
   mais l'IMAGE elle-même (`image`) n'est écrite dans `dossierImages` QUE
   pour le rang central (1) — sauf si le test porte l'étiquette `rendu` ou
   si l'instabilité du triplet dépasse le seuil, auquel cas les trois
   images sont conservées. Les rangs élagués gardent `image: null` : le
   diaporama d'un triplet peut donc afficher « pas de capture » pour un rang
   sans perdre les nombres qui l'accompagnent (§3.7 du document de
   conception). */
function construireCaptures(capturesBrutes, capturesDir, dossierImages, opts) {
  const o = opts || {};
  const etiquettes = o.etiquettes || [];
  const seuil = o.seuilInstabilite === undefined ? SEUIL_INSTABILITE_PIXELS_DEFAUT : o.seuilInstabilite;
  const gardeTripletComplet = etiquettes.indexOf('rendu') >= 0;
  const brut = capturesBrutes || [];
  const n = brut.length;
  let imagesNouvelles = 0, imagesReutilisees = 0;
  function ecrireImage(fichier) {
    const p = path.join(capturesDir, fichier);
    let donnees;
    try { donnees = fs.readFileSync(p); } catch (e) { return null; }
    const h = sha1(donnees);
    const ext = extensionDe(fichier);
    const dest = path.join(dossierImages, h + '.' + ext);
    if (fs.existsSync(dest)) imagesReutilisees++;
    else { fs.mkdirSync(dossierImages, { recursive: true }); fs.writeFileSync(dest, donnees); imagesNouvelles++; }
    return h + '.' + ext;
  }
  const captures = brut.map((c, i) => {
    if (c.role !== 'triplet') {
      if (!c.fichier) return null;
      const image = ecrireImage(c.fichier);
      if (!image) return null;
      const role = c.role || (i === 0 ? 'debut' : (i === n - 1 ? 'fin' : 'intermediaire'));
      return { role: role, libelle: c.libelle, image: image, t_ms: c.t_ms === undefined ? null : c.t_ms };
    }
    // triplet (SPEC-BANC-077 à 083) : les nombres survivent toujours, l'image
    // dépend du rang et du seuil/de l'étiquette (voir l'en-tête ci-dessus)
    const instable = c.instabilite && c.instabilite.pixels > seuil;
    const garder = c.rang === 1 || gardeTripletComplet || instable;
    const image = (garder && c.fichier) ? ecrireImage(c.fichier) : null;
    return {
      role: 'triplet', etape: c.etape || null, bord: c.bord || null, rang: c.rang === undefined ? null : c.rang,
      libelle: c.libelle, image: image, t_ms: c.t_ms === undefined ? null : c.t_ms,
      numero_image: c.numero_image === undefined ? null : c.numero_image,
      duree_image_ms: c.duree_image_ms === undefined ? null : c.duree_image_ms,
      pose: c.pose || null, instabilite: c.instabilite || null,
    };
  }).filter(Boolean);
  return { captures, imagesNouvelles, imagesReutilisees };
}

/* SPEC-BANC-085 : signature MINIMALE d'un moteur de rendu — assez pour dire
   « même moteur » sans confondre deux runs de GPU différents, mais sans
   sur-spécifier (deux résolutions différentes sur le MÊME GPU restent
   comparables). `null` si l'environnement du run ne porte aucune info de
   rendu (run purement Node, aucun e2e). */
function moteurRenduDe(env) {
  if (!env) return null;
  const gpu = env.gpu || null, vendor = env.vendorGpu || null;
  if (!gpu && !env.navigateur) return null;
  return {
    glRenderer: gpu, glVendor: vendor,
    accelerationMaterielle: env.accelerationMaterielle === undefined ? null : env.accelerationMaterielle,
    navigateur: env.navigateur || null, os: env.os || null,
    avecFenetre: !!env.avecFenetre, resolution: env.resolution || null,
  };
}
/* Deux moteurs « pareils » pour comparer un témoin (SPEC-BANC-086) : même
   renderer/vendor WebGL ET même statut logiciel/GPU — la résolution ou le
   navigateur exact ne font PAS partie de la comparaison (une même carte
   graphique rendue à une résolution différente reste un témoin valable). */
function memeMoteur(a, b) {
  if (!a || !b) return false;
  return a.glRenderer === b.glRenderer && a.accelerationMaterielle === b.accelerationMaterielle;
}

/* Un identifiant de run STABLE (ne dépend pas du nom de fichier, ni de
   l'ordre d'inscription) : dérivé du commit, du préréglage et de l'instant
   d'inscription — suffit à distinguer deux runs du même commit/préréglage
   inscrits à des instants différents, sans dépendre du système de fichiers. */
function idDeRun(commit, preset, date) { return sha1(Buffer.from(commit + '|' + preset + '|' + date, 'utf8')).slice(0, 16); }

/* Instantané de catalogue d'un test (docs/banc/historique-global.md §1/§3.5) :
   copié dans l'entrée du run tel quel — une fiche modifiée plus tard NE
   réécrit PAS l'historique, on voit ce que le test prétendait vérifier au
   moment où il a tourné. `fonctions` (SPEC-BANC-062) : fusion, déjà faite
   par l'appelant (tests/run.js, côté Node ; tests/e2e.js côté e2e), des
   fonctions DÉCLARÉES dans la fiche et des fonctions OBSERVÉES en
   exécution — ce module se contente de LIRE `t.fonctions` tel quel, sans
   jamais recalculer l'observation lui-même (hors de portée d'un module qui
   ne s'exécute qu'après coup, sur un cahier déjà écrit). */
function identiteTest(t) {
  return {
    id: t.id || null, nom: t.nom,
    categorie: { type: t.type || null, groupe: t.groupe || null },
    domaines: t.domaines || [], specs: t.specs || [], etiquettes: t.etiquettes || [],
    fonctions: t.fonctions || [],
    fiche: t.fiche || null,
  };
}

// ── inscription (SPEC-BANC-028) ─────────────────────────────────────────
/* Inscrit un cahier LOCAL (tests/resultats/<dossier>, tel qu'écrit par
   tools/resultats-tests.js) au registre versionné. `opts.racineResultats`
   (tests) redirige la lecture du cahier source ; `opts.dossierRepo` (tests)
   redirige la résolution git ; `opts.origine` : 'pre-push' (défaut) ou
   'manuel' ; `opts.statut` : 'ok' (défaut) ou 'en_attente' (pre-push, voir
   l'en-tête de ce fichier) ; `opts.dossierRegistre` (tests) redirige TOUTE
   l'écriture du registre lui-même, pour ne jamais toucher le vrai
   tests/registre/ pendant les tests de ce module. */
/* Idempotence (docs/banc/historique-global.md §3.4) : chaque entrée garde
   le nom du cahier LOCAL qui l'a produite (`dossierCahier`, jamais exposé
   ailleurs qu'ici) — inscrire deux fois le même dossier est refusé avec un
   motif clair, plutôt que de dupliquer silencieusement le run dans
   l'historique (un double clic sur « Inscrire au registre », par exemple). */
function dejaInscrit(dossierRegistre, dossierCahier) {
  return lireEntrees(dossierRegistre).some(e => e.dossierCahier === dossierCahier);
}

/* Inscrit un cahier LOCAL (tests/resultats/<dossierCahier>) au registre.
   Appelable depuis la ligne de commande (voir CLI plus bas) OU depuis une
   route serveur future (docs/banc/historique-global.md §3.4 : le clic sur
   « Inscrire au registre » appellera CETTE MÊME fonction) — rien ici ne
   suppose un contexte CLI. `opts.motif` (facultatif, texte court) : une
   raison humaine de promouvoir CE run précis (ex. « référence avant refonte
   de l'eau »), reportée telle quelle. `opts.racineResultats`/`dossierRepo`/
   `dossierRegistre` (tests) redirigent lecture/résolution/écriture pour ne
   jamais toucher les vrais dossiers pendant les tests de ce module. */
function inscrire(dossierCahier, opts) {
  const o = opts || {};
  const racineResultats = o.racineResultats || path.join(RACINE, 'tests', 'resultats');
  const dossierRegistre = o.dossierRegistre || DOSSIER_REGISTRE;
  const dossierImages = path.join(dossierRegistre, 'images');

  if (dejaInscrit(dossierRegistre, dossierCahier)) {
    return { ok: false, motif: 'ce cahier (' + dossierCahier + ') est déjà inscrit au registre — inscription refusée (idempotence)' };
  }

  const cheminResultats = path.join(racineResultats, dossierCahier, 'resultats.json');
  let resultats;
  try { resultats = JSON.parse(fs.readFileSync(cheminResultats, 'utf8')); }
  catch (e) { return { ok: false, motif: 'cahier introuvable ou illisible : ' + cheminResultats }; }

  const campagne = resultats.campagne || {};
  const env = campagne.environnement || {};
  // le commit RÉELLEMENT testé (celui du cahier), résolu en PLEIN — jamais
  // le HEAD courant, qui a pu avancer depuis que la campagne a tourné
  const dossierRepo = o.dossierRepo || RACINE;
  const commitCourt = env.commit || null;
  const commit = (commitCourt && commitPlein(dossierRepo, commitCourt)) || commitPlein(dossierRepo, 'HEAD');
  if (!commit) return { ok: false, motif: 'hors dépôt git : impossible de résoudre le commit testé' };

  const seuilLentMs = o.seuilLentMs;
  let imagesNouvelles = 0, imagesReutilisees = 0;
  const capturesDir = path.join(racineResultats, dossierCahier, 'captures');
  const tests = (resultats.tests || []).map((t) => {
    const r = construireCaptures(t.captures, capturesDir, dossierImages, { etiquettes: t.etiquettes, seuilInstabilite: o.seuilInstabilitePixels });
    imagesNouvelles += r.imagesNouvelles; imagesReutilisees += r.imagesReutilisees;
    const etat = etatRegistre(t, seuilLentMs);
    // SPEC-BANC-089 : un `ignore` sans raison a déjà été reclassé en `echec`
    // par etatRegistre() ci-dessus — `erreur` le dit explicitement plutôt
    // que de laisser un échec muet, sans raison apparente dans l'historique.
    const erreur = (t.etat === 'ignore' && etat === 'echec' && !raisonSource(t))
      ? 'ignoré sans raison — reclassé en échec (SPEC-BANC-089)' : (t.message || null);
    return Object.assign(identiteTest(t), {
      debut: t.debut || null, duree_ms: t.duree_ms,
      etat: etat, raison: raisonRegistre(t, etat, seuilLentMs), erreur: erreur,
      captures: r.captures,
      // SPEC-BANC-070/076 : pourquoi ce test a été retenu, et s'il est un trou de périmètre
      raison_selection: Array.isArray(t.raison_selection) ? t.raison_selection : null,
      trou_perimetre: !!t.trou_perimetre,
    });
  });

  const date = new Date().toISOString();
  const entree = {
    id: idDeRun(commit, campagne.preset || '', date),
    dossierCahier: dossierCahier,
    commit: commit,
    branche: brancheCourante(dossierRepo) || null,
    date: date,
    preset: campagne.preset || null,
    origine: o.origine || 'pre-push',
    inscrit: true,
    statut: o.statut || 'ok',
    motif: o.motif || null,
    // capturés AU DÉBUT de la campagne locale (tests/run.js), jamais
    // recalculés ici : l'arbre a pu changer depuis (voir leur en-tête)
    arbre_modifie: !!campagne.arbreModifie,
    interrompu: !!campagne.interrompue,
    // SPEC-BANC-085 : moteur de rendu du RUN (propriété de la campagne, pas
    // d'un test), tel que tools/e2e-headless.js/tests/run.js l'a observé —
    // absent (null) pour un run purement Node sans e2e (aucun WebGL sollicité).
    moteurRendu: moteurRenduDe(env),
    // SPEC-BANC-070/076 : nature du run (complet | commit | manuel), détail du
    // périmètre d'un run restreint, trous de périmètre d'un run complet
    perimetre: campagne.perimetre || null,
    perimetre_detail: campagne.perimetreDetail || null,
    trous_perimetre: campagne.trousPerimetre || null,
    tests: tests,
  };
  const fichier = ecrireEntreeFichier(dossierRegistre, entree);
  return { ok: true, id: entree.id, commit: commit, fichier: fichier, tests: tests.length, imagesNouvelles: imagesNouvelles, imagesReutilisees: imagesReutilisees };
}

// ── entrées en attente (pont pre-push → pre-commit, SPEC-BANC-028) ──────
function aDesEntreesEnAttente(dossierRegistre) {
  return lireEntrees(dossierRegistre).some(e => e.statut === 'en_attente');
}
/* Repasse toute entrée en_attente à ok — appelé par pre-commit.js juste
   avant de `git add tests/registre`, pour que l'entrée entre au commit en
   cours (elle continue de citer le commit qu'elle a RÉELLEMENT testé, pas
   celui-ci). Réécrit uniquement la 1re ligne (méta) de CHAQUE fichier
   concerné — jamais un fichier partagé. Rend le nombre d'entrées intégrées. */
function marquerEnAttenteCommitees(dossierRegistre) {
  let n = 0;
  listerFichiersEntrees(dossierRegistre).forEach((chemin) => {
    const brut = fs.readFileSync(chemin, 'utf8');
    const lignes = brut.split('\n').filter(Boolean);
    if (!lignes.length) return;
    let meta;
    try { meta = JSON.parse(lignes[0]); } catch (e) { return; }
    if (meta.statut !== 'en_attente') return;
    meta.statut = 'ok';
    lignes[0] = JSON.stringify(meta);
    fs.writeFileSync(chemin, lignes.join('\n') + '\n');
    n++;
  });
  return n;
}

// ── historique d'un test (SPEC-BANC-029) ────────────────────────────────
/* `opts.inclureManuels` (faux par défaut) : sans lui, ne retient QUE les
   entrées `origine: 'pre-push'` (l'historique « officiel », avant chaque
   push) ; avec lui, aussi les inscriptions manuelles. `opts.tri` : 'commit'
   (défaut sans inclureManuels — ordre topologique git réel) ou 'lancement'
   (défaut avec inclureManuels — `date`, un ordre de commit n'ayant pas de
   sens dès que plusieurs runs manuels partagent un commit). */
/* Origines « officielles » (historique par défaut, témoin par défaut) : la
   validation avant push et, depuis SPEC-BANC-073, la suite complète d'un
   merge (pre-merge-commit, ou pre-commit avec MERGE_HEAD). */
const ORIGINES_OFFICIELLES = new Set(['pre-push', 'merge']);
function historiqueTest(testId, opts) {
  const o = opts || {};
  const dossierRegistre = o.dossierRegistre || DOSSIER_REGISTRE;
  const inclureManuels = !!o.inclureManuels;
  const tri = o.tri || (inclureManuels ? 'lancement' : 'commit');
  const entrees = lireEntrees(dossierRegistre)
    .filter(e => inclureManuels || ORIGINES_OFFICIELLES.has(e.origine));

  const resultat = [];
  entrees.forEach((e) => {
    const t = (e.tests || []).find(t => (t.id && t.id === testId) || t.nom === testId);
    if (!t) return;
    resultat.push({
      commit: e.commit, branche: e.branche, date: e.date, preset: e.preset, origine: e.origine, statut: e.statut,
      inscrit: e.inscrit !== undefined ? e.inscrit : true, arbre_modifie: !!e.arbre_modifie, interrompu: !!e.interrompu, motif: e.motif || null,
      etat: t.etat, erreur: t.erreur || null, duree_ms: t.duree_ms, debut: t.debut || null, captures: t.captures || [],
    });
  });

  if (tri === 'commit') {
    const dossierRepo = o.dossierRepo || RACINE;
    const commits = ordreCommits(dossierRepo, o.branche);
    if (commits) {
      resultat.forEach(e => { e._rang = rangCommit(commits, e.commit); });
      resultat.sort((a, b) => {
        if (a._rang === -1 && b._rang === -1) return String(b.date).localeCompare(String(a.date));
        if (a._rang === -1) return 1;
        if (b._rang === -1) return -1;
        return a._rang - b._rang;
      });
      resultat.forEach(e => { delete e._rang; });
      return resultat;
    }
  }
  return resultat.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// ── vue unifiée : registre + cahiers locaux (docs/banc/historique-global.md §1) ─
/* Convertit les tests BRUTS d'un cahier LOCAL (resultats.json) vers la même
   forme que ceux du registre (inscrire(), ci-dessus) — SANS écrire dans
   images/ ni dédupliquer par contenu (un cahier local n'est pas partagé,
   inutile d'y calculer des sha1) : `captures[*].image` porte alors le nom
   de fichier LOCAL (relatif à captures/ DANS CE CAHIER), pas un sha1 — un
   consommateur distingue les deux cas par `inscrit` sur le run parent
   (false ⇒ résoudre sous tests/resultats/<dossierCahier>/captures/, true
   ⇒ sous tests/registre/images/), voir tests/registre/README.md. */
function construireTestsLocaux(tests, seuilLentMs) {
  // un cahier local peut venir de n'importe quelle version du banc (ou d'un
  // envoi navigateur interrompu, sendBeacon) : un élément qui n'est pas un
  // objet est ignoré plutôt que de faire lever toute la vue unifiée
  // (SPEC-BANC-120)
  const estObjet = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  return (Array.isArray(tests) ? tests : []).filter(estObjet).map((t) => {
    if (!Array.isArray(t.captures)) t = Object.assign({}, t, { captures: [] });
    else if (!t.captures.every(estObjet)) t = Object.assign({}, t, { captures: t.captures.filter(estObjet) });
    const n = (t.captures || []).length;
    const etat = etatRegistre(t, seuilLentMs);
    return Object.assign(identiteTest(t), {
      debut: t.debut || null, duree_ms: t.duree_ms,
      etat: etat, raison: raisonRegistre(t, etat, seuilLentMs), erreur: t.message || null,
      raison_selection: Array.isArray(t.raison_selection) ? t.raison_selection : null,
      trou_perimetre: !!t.trou_perimetre,
      // un cahier LOCAL n'est jamais dédupliqué/élagué (SPEC-BANC-083 ne
      // s'applique qu'au registre versionné) : chaque capture, triplet
      // compris, est reprise TELLE QUELLE, nombres et image ensemble.
      captures: (t.captures || []).map((c, i) => (c.role === 'triplet' ? {
        role: 'triplet', etape: c.etape || null, bord: c.bord || null, rang: c.rang === undefined ? null : c.rang,
        libelle: c.libelle, image: c.fichier || null, t_ms: c.t_ms === undefined ? null : c.t_ms,
        numero_image: c.numero_image === undefined ? null : c.numero_image,
        duree_image_ms: c.duree_image_ms === undefined ? null : c.duree_image_ms,
        pose: c.pose || null, instabilite: c.instabilite || null,
      } : {
        role: c.role || (i === 0 ? 'debut' : (i === n - 1 ? 'fin' : 'intermediaire')),
        libelle: c.libelle, image: c.fichier || null, t_ms: c.t_ms === undefined ? null : c.t_ms,
      })),
    });
  });
}

/* Point d'accroche pour le futur lot d'interface (« historique global »,
   docs/banc/historique-global.md §1) : LA fonction qui fusionne le registre
   versionné (inscrit: true) et les cahiers locaux non versionnés
   (inscrit: false, tests/resultats/, limités à ceux encore présents — la
   rotation normale d'un cahier local en fait disparaître certains, jamais
   de ceux du registre) en UNE SEULE liste de runs de même forme. Chaque
   run : { id, dossierCahier?, commit, branche, date, preset, origine,
   inscrit, statut?, arbre_modifie?, interrompu?, motif?, tests: [...] } —
   `dossierCahier` n'existe QUE pour un run local (utile pour l'inscrire
   après coup, §3.4) ; `statut` (en_attente/ok) n'a de sens QUE pour un run
   du registre (le pont pre-push → pre-commit). N'écrit rien sur disque,
   ne fait aucun appel git par run (le rang de commit, dérivé, reste à la
   charge de l'appelant — voir ordreCommits()/rangCommit() ci-dessus, déjà
   exportées). */
function runsUnifies(opts) {
  const o = opts || {};
  const dossierRegistre = o.dossierRegistre || DOSSIER_REGISTRE;
  const racineResultats = o.racineResultats || path.join(RACINE, 'tests', 'resultats');
  const seuilLentMs = o.seuilLentMs;

  const runsRegistre = lireEntrees(dossierRegistre);
  // un cahier local déjà inscrit est représenté par SON entrée de registre
  // (plus riche : id/images dédupliquées/statut) — jamais compté deux fois
  const dejaInscrits = new Set(runsRegistre.map(e => e.dossierCahier).filter(Boolean));

  const runsLocaux = [];
  if (fs.existsSync(racineResultats)) {
    fs.readdirSync(racineResultats, { withFileTypes: true }).filter(d => d.isDirectory() && !dejaInscrits.has(d.name)).forEach((d) => {
      let resultats;
      try { resultats = JSON.parse(fs.readFileSync(path.join(racineResultats, d.name, 'resultats.json'), 'utf8')); }
      catch (e) { return; }
      if (!resultats || typeof resultats !== 'object') return;   // « null », un nombre… : pas un cahier
      const campagne = (resultats.campagne && typeof resultats.campagne === 'object') ? resultats.campagne : {};
      const env = (campagne.environnement && typeof campagne.environnement === 'object') ? campagne.environnement : {};
      runsLocaux.push({
        id: idDeRun(env.commit || 'inconnu', campagne.preset || '', campagne.debut || d.name),
        dossierCahier: d.name,
        commit: env.commit || null,
        branche: null, // non enregistré dans un cahier local (voir tests/rapport.js)
        date: campagne.debut || null,
        preset: campagne.preset || null,
        origine: (campagne.preset === 'pr' || campagne.preset === 'e2e-fumee') ? 'pre-push' : 'manuel',
        inscrit: false,
        arbre_modifie: !!campagne.arbreModifie,
        interrompu: !!campagne.interrompue,
        moteurRendu: moteurRenduDe(env),
        perimetre: campagne.perimetre || null,
        tests: construireTestsLocaux(resultats.tests, seuilLentMs),
      });
    });
  }
  return runsRegistre.concat(runsLocaux);
}

// ── témoins (SPEC-BANC-030) ──────────────────────────────────────────────
/* `image` : le nom de fichier complet dans images/ (« <sha1>.<ext> », tel
   que porté par `captures[*].image` — pas un sha1 nu), pour retrouver le
   fichier sans reconstruction. */
function marquerTemoin(testId, commit, image, opts) {
  const o = opts || {};
  const dossierRegistre = o.dossierRegistre || DOSSIER_REGISTRE;
  if (!testId || !commit || !image) return { ok: false, motif: 'identifiant de test, commit et image requis' };
  const entrees = lireEntrees(dossierRegistre);
  const existe = entrees.some(e => e.commit === commit &&
    (e.tests || []).some(t => (t.id === testId || t.nom === testId) && (t.captures || []).some(c => c.image === image)));
  if (!existe) return { ok: false, motif: 'aucune capture de ce test, à ce commit, avec cette image, dans le registre' };
  const temoins = lireTemoins(dossierRegistre);
  temoins[testId] = { commit: commit, image: image };
  ecrireTemoins(temoins, dossierRegistre);
  return { ok: true };
}
/* Témoin par défaut (SPEC-BANC-030, restreint par SPEC-BANC-086) : celui
   épinglé à la main s'il pointe encore sur une entrée de CET historique
   (et, si `opts.moteurRendu` est fourni, sur le MÊME moteur de rendu —
   épingler un GPU réel puis comparer en rendu logiciel ne veut rien dire),
   sinon la dernière capture de la dernière entrée `origine: 'pre-push'`
   (elle aussi restreinte au même moteur si `opts.moteurRendu` est fourni).
   Sans `opts.moteurRendu` (compatibilité : aucun appelant existant n'en
   passe encore), le comportement reste celui d'avant ce lot — non restreint.
   `opts.entreesParCommit` (facultatif, Map commit → entrée complète du run,
   pour lire son `moteurRendu`) : `historique` (produit par historiqueTest())
   n'emporte pas ce champ lui-même, propre au RUN et non au test. */
function memeMoteurQue(entree, moteurCible, entreesParCommit) {
  if (!moteurCible) return true;
  const e = (entreesParCommit && entreesParCommit.get(entree.commit)) || entree;
  return memeMoteur(e.moteurRendu, moteurCible);
}
function temoinDe(testId, historique, opts) {
  const o = opts || {};
  const dossierRegistre = o.dossierRegistre || DOSSIER_REGISTRE;
  const moteurCible = o.moteurRendu || null;
  const epingle = lireTemoins(dossierRegistre)[testId];
  if (epingle) {
    const eEpingle = historique.find(e => e.commit === epingle.commit && (e.captures || []).some(c => c.image === epingle.image));
    if (eEpingle && memeMoteurQue(eEpingle, moteurCible, o.entreesParCommit)) {
      return Object.assign({ epingle: true }, epingle);
    }
  }
  const dernier = historique.find(e => ORIGINES_OFFICIELLES.has(e.origine) && (e.captures || []).length && memeMoteurQue(e, moteurCible, o.entreesParCommit));
  if (dernier) return { epingle: false, commit: dernier.commit, image: dernier.captures[dernier.captures.length - 1].image };
  // SPEC-BANC-086 : un moteur ciblé sans AUCUN run correspondant dans
  // l'historique ne doit jamais retomber sur un moteur différent en
  // silence — le dire explicitement plutôt que de comparer des pommes et
  // des oranges.
  if (moteurCible && historique.length) return { pasDeTemoinMemeMoteur: true };
  return null;
}

// ── export web autonome (SPEC-BANC-029) ─────────────────────────────────
function echapper(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function CSS_HISTORIQUE() {
  return '\n:root{--bg:#f6f7f9;--fg:#1a1d23;--muted:#6b7280;--border:#e2e5ea;--accent:#2563eb;--temoin:#a06a00;}' +
    '@media (prefers-color-scheme: dark){:root{--bg:#0b0e13;--fg:#e8eaed;--muted:#9aa1ac;--border:#262d3a;--accent:#7fb2ff;--temoin:#f2c46d;}}' +
    '*{box-sizing:border-box;} body{background:var(--bg);color:var(--fg);font:13px/1.55 ui-monospace,Menlo,Consolas,monospace;margin:0;padding:24px;max-width:1100px;}' +
    'h1{font-size:20px;margin:0 0 4px;} h2{font-size:14px;color:var(--accent);margin:0 0 16px;font-weight:normal;}' +
    'section.run{border-top:1px solid var(--border);padding:10px 0;} h3{font-size:12.5px;margin:0 0 6px;}' +
    'figure{margin:6px 8px 6px 0;display:inline-block;} figure img{width:200px;height:auto;border-radius:4px;border:1px solid var(--border);}' +
    'figure.temoin img{border:2px solid var(--temoin);} figure.temoin figcaption{color:var(--temoin);font-weight:bold;}' +
    'figcaption{font-size:10.5px;color:var(--muted);}' +
    '.etat-echec{color:#c0392b;} .etat-delai{color:var(--temoin);} .etat-ok{color:#1a7f37;}';
}
function exporterHistoriqueHTML(testId, opts) {
  const o = opts || {};
  const dossierRegistre = o.dossierRegistre || DOSSIER_REGISTRE;
  const historique = historiqueTest(testId, opts);
  const temoin = temoinDe(testId, historique, opts);
  const lignes = historique.map((entree) => {
    const caps = (entree.captures || []).map((c) => {
      const p = path.join(dossierRegistre, 'images', c.image);
      let src = '';
      try { src = 'data:' + (MIME_PAR_EXT[extensionDe(c.image)] || 'image/jpeg') + ';base64,' + fs.readFileSync(p).toString('base64'); }
      catch (err) { /* image absente du registre : légende sans image */ }
      const estTemoin = !!(temoin && temoin.commit === entree.commit && temoin.image === c.image);
      return '<figure' + (estTemoin ? ' class="temoin"' : '') + '>' +
        (src ? '<a href="' + src + '" target="_blank"><img src="' + src + '" alt="' + echapper(c.libelle) + '" loading="lazy"></a>' : '<p>(capture absente)</p>') +
        '<figcaption>' + echapper(c.libelle) + (estTemoin ? ' — TÉMOIN' + (temoin.epingle ? ' (épinglé)' : ' (dernier validé)') : '') + '</figcaption></figure>';
    }).join('');
    return '<section class="run"><h3 class="etat-' + echapper(entree.etat) + '">' + echapper((entree.commit || '').slice(0, 10)) +
      ' — ' + echapper(entree.etat) + (entree.preset ? ' — ' + echapper(entree.preset) : '') +
      (entree.origine === 'manuel' ? ' — manuel' : '') + '</h3>' + caps + '</section>';
  }).join('');
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Historique de test — ' + echapper(testId) +
    '</title><style>' + CSS_HISTORIQUE() + '</style></head><body>' +
    '<h1>Historique de test</h1><h2>' + echapper(testId) + ' — ' + historique.length + ' run(s)</h2>' +
    (lignes || '<p>Aucun run trouvé pour ce test.</p>') + '</body></html>';
}

// ── commit du registre (SPEC-BANC-028) ──────────────────────────────────
/* Committe les changements de tests/registre/ SEULS (jamais le reste de
   l'arbre de travail), avec un message dédié, SANS ligne Co-Authored-By
   (le registre est un artefact de test automatique, pas une contribution
   attribuable). Rend { ok:false, motif:'rien à committer' } si le registre
   n'a aucun changement en attente (index ou arbre de travail). */
function commiterRegistre(dossierRepo) {
  const rd = dossierRepo || RACINE;
  marquerEnAttenteCommitees(path.join(rd, DOSSIER_REGISTRE_REL));
  const diff = git(rd, ['status', '--porcelain', '--', DOSSIER_REGISTRE_REL]);
  if (!diff) return { ok: false, motif: 'rien à committer' };
  git(rd, ['add', '--', DOSSIER_REGISTRE_REL]);
  try {
    execFileSync('git', ['commit', '-m', 'test(registre): mise à jour de l\'historique visuel par test'], { cwd: rd, encoding: 'utf8', env: envGitPour(rd) });
  } catch (e) { return { ok: false, motif: 'échec du commit : ' + e.message }; }
  return { ok: true };
}

// ── CLI ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const sous = args[0];
  const option = (nom) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : null; };
  const drapeau = (nom) => args.includes(nom);

  if (sous === 'inscrire') {
    let dossier = args[1] && !args[1].startsWith('--') ? args[1] : null;
    if (!dossier) {
      const racineResultats = path.join(RACINE, 'tests', 'resultats');
      const dossiers = fs.existsSync(racineResultats)
        ? fs.readdirSync(racineResultats, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
          .sort((a, b) => fs.statSync(path.join(racineResultats, b)).mtimeMs - fs.statSync(path.join(racineResultats, a)).mtimeMs)
        : [];
      dossier = dossiers[0];
    }
    if (!dossier) { console.error('aucun cahier trouvé dans tests/resultats/ à inscrire'); process.exit(1); }
    const r = inscrire(dossier, { origine: option('--origine') || 'manuel', statut: option('--statut') || 'ok', motif: option('--motif') });
    console.log(JSON.stringify(r));
    process.exit(r.ok ? 0 : 1);
  } else if (sous === 'commit') {
    const r = commiterRegistre();
    console.log(JSON.stringify(r));
    process.exit(r.ok ? 0 : 1);
  } else if (sous === 'historique') {
    const testId = args[1];
    const opts = { inclureManuels: drapeau('--manuel'), tri: option('--tri') || undefined };
    if (drapeau('--exporter')) {
      const html = exporterHistoriqueHTML(testId, opts);
      const sortie = option('--sortie') || (testId.replace(/[^a-zA-Z0-9-]+/g, '-') + '-historique.html');
      fs.writeFileSync(sortie, html);
      console.log('écrit : ' + sortie);
      process.exit(0);
    }
    console.log(JSON.stringify({ historique: historiqueTest(testId, opts), temoin: temoinDe(testId, historiqueTest(testId, opts), opts) }, null, 2));
    process.exit(0);
  } else if (sous === 'temoin') {
    const r = marquerTemoin(args[1], args[2], args[3]);
    console.log(JSON.stringify(r));
    process.exit(r.ok ? 0 : 1);
  } else {
    console.log('Usage : node tools/registre.js inscrire [cahier] [--origine pre-push|manuel] [--statut ok|en_attente] [--motif texte]\n' +
      '                        | commit\n' +
      '                        | historique <testId> [--manuel] [--tri lancement|commit] [--exporter [--sortie f]]\n' +
      '                        | temoin <testId> <commit> <image>');
    process.exit(sous ? 1 : 0);
  }
}

module.exports = {
  DOSSIER_REGISTRE, DOSSIER_REGISTRE_REL, DOSSIER_IMAGES, DOSSIER_ENTREES_REL, CHEMIN_TEMOINS_REL,
  lireEntrees, lireEntreeFichier, listerFichiersEntrees, lireTemoins, ecrireTemoins, sha1,
  commitPlein, brancheCourante, ordreCommits, rangCommit, etatRegistre, raisonRegistre, SEUIL_LENT_DEFAUT_MS,
  moteurRenduDe, memeMoteur, SEUIL_INSTABILITE_PIXELS_DEFAUT,
  inscrire, dejaInscrit, aDesEntreesEnAttente, marquerEnAttenteCommitees,
  historiqueTest, runsUnifies, marquerTemoin, temoinDe, exporterHistoriqueHTML, commiterRegistre,
};
