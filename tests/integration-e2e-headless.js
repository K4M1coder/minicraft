/* integration-e2e-headless.js — test d'intégration RÉEL de l'outillage e2e
   sans fenêtre (SPEC-BANC-023/024/025) : lance une VRAIE petite sélection
   d'e2e (deux tests, choisis parmi ceux d'e2e-fumee) dans un VRAI Edge/Chrome
   installé, sans fenêtre, via tools/e2e-headless.js::executerCampagne.

   Vérifie : la campagne se termine ok, les deux tests passent, un cahier de
   test réel est écrit (tools/resultats-tests.js) avec des captures LISIBLES
   (en-tête JPEG valide, référencées par INDEX — voir le correctif 2174e8c),
   l'environnement du cahier porte la résolution et l'accélération matérielle
   (SPEC-BANC-024), puis qu'AUCUN processus (navigateur, serveur de test) ne
   reste après la fin — le PID du navigateur ne doit plus répondre à
   `tasklist`/`ps` une fois `executerCampagne` revenu.

   Comme les autres scripts tests/integration-*.js, il ne passe pas par
   describe/it. IGNORÉ (code de sortie 0, avertissement) sans aucun
   Edge/Chrome installé — c'est aussi ce qui permet à ce script d'être
   inclus dans le préréglage `pr` (type 'integration', auto-découvert par
   tests/run.js) sans jamais faire échouer un poste ou un agent CI sans
   navigateur.

   Usage : node tests/integration-e2e-headless.js */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const NAV = require(path.join(RACINE, 'tools', 'navigateur.js'));
const E2EH = require(path.join(RACINE, 'tools', 'e2e-headless.js'));
const RT = require(path.join(RACINE, 'tools', 'resultats-tests.js'));

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
let passes = 0, echecs = 0;
const details = [];
function ok(cond, nom, info) {
  if (cond) { passes++; details.push(`  ${C.g}·${C.x} ${C.d}${nom}${C.x}`); }
  else { echecs++; details.push(`  ${C.r}✗ ${nom}${C.x}${info ? '\n    ' + C.r + info + C.x : ''}`); }
}

/* Vrai sur cette plateforme si le PID donné correspond encore à un
   processus vivant. Windows : `tasklist /FI "PID eq <pid>"` (pas de kill(0)
   fiable sous Windows pour un processus qu'on ne possède pas nécessairement
   encore) ; POSIX : `kill -0`. */
function processusVivant(pid) {
  if (!pid) return false;
  try {
    if (process.platform === 'win32') {
      const sortie = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
      return sortie.indexOf(String(pid)) >= 0;
    }
    process.kill(pid, 0);
    return true;
  } catch (e) { return false; }
}

(async function () {
  const chemin = NAV.trouverNavigateur();
  if (!chemin) {
    console.log(`${C.y}(aucun navigateur Edge/Chrome installé — integration-e2e-headless.js ignoré, sans échec : voir tools/navigateur.js)${C.x}\n`);
    process.exit(0);
  }

  // sélection : deux e2e rapides, tirées de la même liste que le préréglage
  // e2e-fumee (SPEC-BANC-025) — pas besoin de reparser tests/e2e.js ici,
  // executerUnTest isole par NOM EXACT via le filtre substring de runE2E
  const selection = [
    { id: 'INT-E2E-1', nom: 'le jeu démarre sur le menu principal, monde déjà généré', type: 'e2e', groupe: 'e2e', domaines: [], specs: [], fiche: null },
    { id: 'INT-E2E-2', nom: 'avancer déplace le joueur dans la direction du regard', type: 'e2e', groupe: 'e2e', domaines: [], specs: [], fiche: null },
  ];

  let pidNavigateur = null;
  const resultat = await E2EH.executerCampagne(selection, {
    delaiDemarrageMs: 25000,
    delaiTestMs: 20000,
    delaiGlobalMs: 90000,
    ecrire: (t) => process.stderr.write(t + '\n'),
    surHandles: (h) => { if (h && h.navigateurHandle) pidNavigateur = h.navigateurHandle.processus.pid; },
  });

  ok(resultat.ok, 'SPEC-BANC-023 : la campagne se déroule (infrastructure disponible)', resultat.motif);
  if (!resultat.ok) {
    console.log(`\n${C.b}Integration e2e sans fenêtre${C.x}\n${details.join('\n')}\n`);
    console.log(`${C.r}1 échec(s)${C.x} — infrastructure e2e sans fenêtre indisponible (${resultat.motif})\n`);
    process.exit(1);
  }

  ok(resultat.tests.length === selection.length, 'les deux tests demandés sont bien rapportés', String(resultat.tests.length));
  ok(resultat.tests.every((t) => t.etat === 'ok'), 'les deux e2e passent réellement dans le navigateur sans fenêtre',
     JSON.stringify(resultat.tests.filter((t) => t.etat !== 'ok').map((t) => ({ nom: t.nom, etat: t.etat, message: t.message }))));

  ok(!!resultat.environnement, 'SPEC-BANC-024 : un environnement est rapporté');
  if (resultat.environnement) {
    const [l, h] = String(resultat.environnement.resolution || '').split('x').map(Number);
    ok(l >= NAV.LARGEUR_MIN && h >= NAV.HAUTEUR_MIN, 'SPEC-BANC-024 : la résolution est ≥ 1280×800', resultat.environnement.resolution);
    ok(resultat.environnement.accelerationMaterielle === true || resultat.environnement.accelerationMaterielle === false || resultat.environnement.accelerationMaterielle === null,
       'SPEC-BANC-024 : accelerationMaterielle est un booléen déduit du renderer (ou null si indéterminable)', String(resultat.environnement.accelerationMaterielle));
  }

  ok(resultat.captures.length >= selection.length * 2, 'au moins une capture début+fin par test', String(resultat.captures.length));
  ok(resultat.captures.every((c) => Buffer.from(c.base64, 'base64').slice(0, 2).toString('hex') === 'ffd8'),
     'SPEC-BANC-023 : chaque capture est un JPEG valide (en-tête FFD8), base64 PUR (pas de préfixe data:)');

  // écrit un vrai cahier (comme tests/run.js) dans un dossier temporaire
  // pour vérifier la chaîne complète jusqu'aux fichiers sur disque, sans
  // polluer tests/resultats/
  const dossierTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-integration-e2e-headless-'));
  let rapportEcrit = null;
  try {
    const resultatsFinaux = {
      schema: 1,
      campagne: {
        preset: 'integration-e2e-headless', debut: new Date().toISOString(), fin: new Date().toISOString(),
        duree_ms: resultat.duree_campagne_ms, interrompue: false, environnement: resultat.environnement,
        totaux: {
          total: resultat.tests.length,
          passes: resultat.tests.filter((t) => t.etat === 'ok').length,
          echecs: resultat.tests.filter((t) => t.etat !== 'ok').length,
          ignores: 0, parType: { e2e: resultat.tests.length }, parDomaine: {},
        },
        lents: [],
      },
      tests: resultat.tests,
    };
    rapportEcrit = RT.ecrireCahier(resultatsFinaux, { racine: dossierTmp, nom: 'campagne', captures: resultat.captures });
    ok(fs.existsSync(rapportEcrit.rapport), 'un cahier (rapport.html) est bien écrit sur disque', rapportEcrit.rapport);

    const jsonEcrit = JSON.parse(fs.readFileSync(path.join(dossierTmp, 'campagne', 'resultats.json'), 'utf8'));
    const capturesReferencees = [];
    (jsonEcrit.tests || []).forEach((t) => (t.captures || []).forEach((c) => capturesReferencees.push(c)));
    ok(capturesReferencees.length === resultat.captures.length, 'toutes les captures sont référencées dans le JSON écrit', String(capturesReferencees.length));
    ok(capturesReferencees.every((c) => typeof c.fichier === 'string' && c.fichier.length > 0),
       'SPEC-BANC-023 : chaque capture référencée a un fichier résolu par INDEX (correctif 2174e8c) — pas de lien cassé',
       JSON.stringify(capturesReferencees.filter((c) => !c.fichier)));

    // chaque fichier référencé existe et est un JPEG lisible sur disque
    const dossierCaptures = path.join(dossierTmp, 'campagne', 'captures');
    const fichiersUniques = Array.from(new Set(capturesReferencees.map((c) => c.fichier)));
    const tousLisibles = fichiersUniques.every((f) => {
      try {
        const buf = fs.readFileSync(path.join(dossierCaptures, f));
        return buf.length > 100 && buf.slice(0, 2).toString('hex') === 'ffd8';
      } catch (e) { return false; }
    });
    ok(tousLisibles, 'chaque fichier de capture référencé existe sur disque et est un JPEG lisible', fichiersUniques.join(', '));

    // deux captures différentes (début d'un test A, début d'un test B) ne
    // doivent PAS pointer vers le même fichier alors que leurs libellés
    // d'étape se répètent ("· début") — exactement le bug corrigé par
    // l'appariement par index plutôt que par libellé seul
    const fichierDebut1 = (jsonEcrit.tests[0].captures || []).find((c) => /début$/.test(c.libelle));
    const fichierDebut2 = (jsonEcrit.tests[1].captures || []).find((c) => /début$/.test(c.libelle));
    ok(!!fichierDebut1 && !!fichierDebut2 && fichierDebut1.fichier !== fichierDebut2.fichier,
       'deux captures « … · début » de tests différents pointent vers des fichiers distincts (pas d\'écrasement par libellé)',
       JSON.stringify({ fichierDebut1, fichierDebut2 }));
  } finally {
    try { fs.rmSync(dossierTmp, { recursive: true, force: true }); } catch (e) { /* rien */ }
  }

  // ── aucun processus restant (SPEC-BANC-023) ─────────────────────────────
  // `executerCampagne` a déjà nettoyé (finally interne) avant de nous
  // rendre la main ci-dessus ; on vérifie ici que le PID observé pendant la
  // campagne (via opts.surHandles) ne répond plus du tout.
  ok(!!pidNavigateur, 'le PID du navigateur a bien été observé pendant la campagne');
  if (pidNavigateur) {
    // laisse un instant à taskkill/le système pour finir de nettoyer l'arbre
    await new Promise((r) => setTimeout(r, 300));
    ok(!processusVivant(pidNavigateur), 'SPEC-BANC-023 : le processus navigateur (PID ' + pidNavigateur + ') n\'est plus vivant après la campagne');
  }

  console.log(`\n${C.b}Integration e2e sans fenêtre${C.x}\n${details.join('\n')}\n`);
  const total = passes + echecs;
  if (echecs) { console.log(`${C.r}${echecs} échec(s)${C.x} sur ${total} tests\n`); process.exit(1); }
  console.log(`${C.g}${passes}/${total} tests d intégration passent${C.x} — campagne complète en ${resultat.duree_campagne_ms} ms\n`);
})().catch((e) => {
  console.error('\n' + C.r + 'erreur inattendue : ' + (e && e.stack || e) + C.x + '\n');
  process.exit(1);
});
