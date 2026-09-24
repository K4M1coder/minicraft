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
     entrees.json — [{ commit (sha plein), branche, date, preset, origine,
                        statut, tests: [{ id, nom, etat, duree_ms,
                        captures: [{ libelle, hash, ext }] }] }, ...]
     images/<sha1>.<ext> — les captures elles-mêmes, adressées par CONTENU :
       deux entrées dont une capture est OCTET POUR OCTET identique au témoin
       courant partagent le même fichier, jamais recopié.
     temoins.json — { [testId]: { commit, hash } } — épinglage manuel.

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

const RACINE = path.join(__dirname, '..');
const DOSSIER_REGISTRE = path.join(RACINE, 'tests', 'registre');
const DOSSIER_REGISTRE_REL = 'tests/registre';
const DOSSIER_IMAGES = path.join(DOSSIER_REGISTRE, 'images');
const CHEMIN_ENTREES = path.join(DOSSIER_REGISTRE, 'entrees.json');
const CHEMIN_TEMOINS = path.join(DOSSIER_REGISTRE, 'temoins.json');

function lireJSON(p, defaut) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return defaut; }
}
function ecrireJSON(p, valeur) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(valeur, null, 2) + '\n');
}
function lireEntrees(dossierRegistre) { return lireJSON(path.join(dossierRegistre || DOSSIER_REGISTRE, 'entrees.json'), []); }
function ecrireEntrees(entrees, dossierRegistre) { ecrireJSON(path.join(dossierRegistre || DOSSIER_REGISTRE, 'entrees.json'), entrees); }
function lireTemoins(dossierRegistre) { return lireJSON(path.join(dossierRegistre || DOSSIER_REGISTRE, 'temoins.json'), {}); }
function ecrireTemoins(temoins, dossierRegistre) { ecrireJSON(path.join(dossierRegistre || DOSSIER_REGISTRE, 'temoins.json'), temoins); }

function sha1(buffer) { return crypto.createHash('sha1').update(buffer).digest('hex'); }
function extensionDe(fichier) { const m = /\.(\w+)$/.exec(fichier || ''); return m ? m[1].toLowerCase() : 'jpg'; }
const MIME_PAR_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

// ── accès git (best-effort : hors dépôt, ou dépôt superficiel, rend null) ──
function git(dossierRepo, args) {
  try { return execFileSync('git', args, { cwd: dossierRepo || RACINE, encoding: 'utf8' }).trim(); }
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

// ── inscription (SPEC-BANC-028) ─────────────────────────────────────────
/* Inscrit un cahier LOCAL (tests/resultats/<dossier>, tel qu'écrit par
   tools/resultats-tests.js) au registre versionné. `opts.racineResultats`
   (tests) redirige la lecture du cahier source ; `opts.dossierRepo` (tests)
   redirige la résolution git ; `opts.origine` : 'pre-push' (défaut) ou
   'manuel' ; `opts.statut` : 'ok' (défaut) ou 'en_attente' (pre-push, voir
   l'en-tête de ce fichier) ; `opts.dossierRegistre` (tests) redirige TOUTE
   l'écriture du registre lui-même, pour ne jamais toucher le vrai
   tests/registre/ pendant les tests de ce module. */
function inscrire(dossierCahier, opts) {
  const o = opts || {};
  const racineResultats = o.racineResultats || path.join(RACINE, 'tests', 'resultats');
  const dossierRegistre = o.dossierRegistre || DOSSIER_REGISTRE;
  const cheminEntrees = path.join(dossierRegistre, 'entrees.json');
  const dossierImages = path.join(dossierRegistre, 'images');

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

  let imagesNouvelles = 0, imagesReutilisees = 0;
  const capturesDir = path.join(racineResultats, dossierCahier, 'captures');
  const tests = (resultats.tests || []).map((t) => {
    const captures = (t.captures || []).filter(c => c.fichier).map((c) => {
      const p = path.join(capturesDir, c.fichier);
      let donnees;
      try { donnees = fs.readFileSync(p); } catch (e) { return null; }
      const h = sha1(donnees);
      const ext = extensionDe(c.fichier);
      const dest = path.join(dossierImages, h + '.' + ext);
      if (fs.existsSync(dest)) imagesReutilisees++;
      else { fs.mkdirSync(dossierImages, { recursive: true }); fs.writeFileSync(dest, donnees); imagesNouvelles++; }
      return { libelle: c.libelle, hash: h, ext: ext };
    }).filter(Boolean);
    return { id: t.id || null, nom: t.nom, etat: t.etat, duree_ms: t.duree_ms, captures: captures };
  });

  const entree = {
    commit: commit,
    branche: brancheCourante(dossierRepo) || null,
    date: new Date().toISOString(),
    preset: campagne.preset || null,
    origine: o.origine || 'pre-push',
    statut: o.statut || 'ok',
    tests: tests,
  };
  const entrees = lireJSON(cheminEntrees, []);
  entrees.push(entree);
  ecrireJSON(cheminEntrees, entrees);
  return { ok: true, commit: commit, tests: tests.length, imagesNouvelles: imagesNouvelles, imagesReutilisees: imagesReutilisees };
}

// ── entrées en attente (pont pre-push → pre-commit, SPEC-BANC-028) ──────
function aDesEntreesEnAttente(dossierRegistre) {
  return lireJSON(path.join(dossierRegistre || DOSSIER_REGISTRE, 'entrees.json'), [])
    .some(e => e.statut === 'en_attente');
}
/* Repasse toute entrée en_attente à ok — appelé par pre-commit.js juste
   avant de `git add tests/registre`, pour que l'entrée entre au commit en
   cours (elle continue de citer le commit qu'elle a RÉELLEMENT testé, pas
   celui-ci). Rend le nombre d'entrées ainsi intégrées. */
function marquerEnAttenteCommitees(dossierRegistre) {
  const p = path.join(dossierRegistre || DOSSIER_REGISTRE, 'entrees.json');
  const entrees = lireJSON(p, []);
  let n = 0;
  entrees.forEach((e) => { if (e.statut === 'en_attente') { e.statut = 'ok'; n++; } });
  if (n) ecrireJSON(p, entrees);
  return n;
}

// ── historique d'un test (SPEC-BANC-029) ────────────────────────────────
/* `opts.inclureManuels` (faux par défaut) : sans lui, ne retient QUE les
   entrées `origine: 'pre-push'` (l'historique « officiel », avant chaque
   push) ; avec lui, aussi les inscriptions manuelles. `opts.tri` : 'commit'
   (défaut sans inclureManuels — ordre topologique git réel) ou 'lancement'
   (défaut avec inclureManuels — `date`, un ordre de commit n'ayant pas de
   sens dès que plusieurs runs manuels partagent un commit). */
function historiqueTest(testId, opts) {
  const o = opts || {};
  const dossierRegistre = o.dossierRegistre || DOSSIER_REGISTRE;
  const inclureManuels = !!o.inclureManuels;
  const tri = o.tri || (inclureManuels ? 'lancement' : 'commit');
  const entrees = lireJSON(path.join(dossierRegistre, 'entrees.json'), [])
    .filter(e => inclureManuels || e.origine === 'pre-push');

  const resultat = [];
  entrees.forEach((e) => {
    const t = (e.tests || []).find(t => (t.id && t.id === testId) || t.nom === testId);
    if (!t) return;
    resultat.push({
      commit: e.commit, branche: e.branche, date: e.date, preset: e.preset, origine: e.origine, statut: e.statut,
      etat: t.etat, duree_ms: t.duree_ms, captures: t.captures || [],
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

// ── témoins (SPEC-BANC-030) ──────────────────────────────────────────────
function marquerTemoin(testId, commit, hash, opts) {
  const o = opts || {};
  const dossierRegistre = o.dossierRegistre || DOSSIER_REGISTRE;
  if (!testId || !commit || !hash) return { ok: false, motif: 'identifiant de test, commit et hash requis' };
  const entrees = lireJSON(path.join(dossierRegistre, 'entrees.json'), []);
  const existe = entrees.some(e => e.commit === commit &&
    (e.tests || []).some(t => (t.id === testId || t.nom === testId) && (t.captures || []).some(c => c.hash === hash)));
  if (!existe) return { ok: false, motif: 'aucune capture de ce test, à ce commit, avec ce hash, dans le registre' };
  const p = path.join(dossierRegistre, 'temoins.json');
  const temoins = lireJSON(p, {});
  temoins[testId] = { commit: commit, hash: hash };
  ecrireJSON(p, temoins);
  return { ok: true };
}
/* Témoin par défaut (SPEC-BANC-030) : celui épinglé à la main s'il pointe
   encore sur une entrée de CET historique, sinon la dernière capture de la
   dernière entrée `origine: 'pre-push'` — le dernier état officiellement
   validé avant un push. */
function temoinDe(testId, historique, opts) {
  const o = opts || {};
  const dossierRegistre = o.dossierRegistre || DOSSIER_REGISTRE;
  const epingle = lireJSON(path.join(dossierRegistre, 'temoins.json'), {})[testId];
  if (epingle && historique.some(e => e.commit === epingle.commit && (e.captures || []).some(c => c.hash === epingle.hash))) {
    return Object.assign({ epingle: true }, epingle);
  }
  const dernier = historique.find(e => e.origine === 'pre-push' && (e.captures || []).length);
  if (dernier) return { epingle: false, commit: dernier.commit, hash: dernier.captures[dernier.captures.length - 1].hash };
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
      const p = path.join(dossierRegistre, 'images', c.hash + '.' + c.ext);
      let src = '';
      try { src = 'data:' + (MIME_PAR_EXT[c.ext] || 'image/jpeg') + ';base64,' + fs.readFileSync(p).toString('base64'); }
      catch (err) { /* image absente du registre : légende sans image */ }
      const estTemoin = !!(temoin && temoin.commit === entree.commit && temoin.hash === c.hash);
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
    execFileSync('git', ['commit', '-m', 'test(registre): mise à jour de l\'historique visuel par test'], { cwd: rd, encoding: 'utf8' });
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
    const r = inscrire(dossier, { origine: option('--origine') || 'manuel', statut: option('--statut') || 'ok' });
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
    console.log('Usage : node tools/registre.js inscrire [cahier] [--origine pre-push|manuel] [--statut ok|en_attente]\n' +
      '                        | commit\n' +
      '                        | historique <testId> [--manuel] [--tri lancement|commit] [--exporter [--sortie f]]\n' +
      '                        | temoin <testId> <commit> <hash>');
    process.exit(sous ? 1 : 0);
  }
}

module.exports = {
  DOSSIER_REGISTRE, DOSSIER_REGISTRE_REL, DOSSIER_IMAGES, CHEMIN_ENTREES, CHEMIN_TEMOINS,
  lireEntrees, ecrireEntrees, lireTemoins, ecrireTemoins, sha1,
  commitPlein, brancheCourante, ordreCommits, rangCommit,
  inscrire, aDesEntreesEnAttente, marquerEnAttenteCommitees,
  historiqueTest, marquerTemoin, temoinDe, exporterHistoriqueHTML, commiterRegistre,
};
