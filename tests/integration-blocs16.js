/* integration-blocs16.js — sous-lot L40-bis C « serveur et réseau »
   (SPEC-SAVE-022, 023, 025) sur de vrais processus server.js, lancés puis
   arrêtés par la suite elle-même :
     - SPEC-SAVE-022 : un BLOC dont l'id n'est pas un bloc défini (objet ≥
       FIRST_ITEM, ou id libre entre le dernier bloc et FIRST_ITEM) est refusé
       en créatif comme en survie avec MC_TEST_POSE_LIBRE : la case reste
       inchangée, l'émetteur reçoit le bloc réel, le fichier de monde n'a pas
       l'id ;
     - SPEC-SAVE-023 : l'état reçu d'un client est borné par l'etatMaxDe du bloc
       posé (pierre + état 200 → 0, diffusé et sauvegardé ; escalier + état
       valide → conservé) ;
     - SPEC-SAVE-025 : REJOINDRE annonce version et format d'identifiants ;
       sans format, ou avec un autre format, le client est refusé (motif qui
       donne les deux formats, connexion fermée, monde inchangé) ; une autre
       version de jeu au même format est admise, et BIENVENUE porte version et
       formatIds du serveur.

   Usage : node tests/integration-blocs16.js [scénario] */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, connecter, rejoindre } = A;
const R = A.creerRapport('Intégration L40-bis C — ids non-blocs refusés, état borné, format d\'identifiants (SPEC-SAVE-022, 023, 025)');
const { ok, eq } = R;

const MC = A.chargerModules();
const C = MC.Core, B = C.B;
const GRAINE = 20260921;
const serveurs = [];

async function demarrer(args, env) {
  const s = await lancer(['--port', '0'].concat(args || []), env || {});
  serveurs.push(s);
  return s;
}
function fichierMonde(dossier) {
  const f = path.join(dossier, 'monde.json');
  fs.writeFileSync(f, JSON.stringify({ v: 2, graine: GRAINE, heure: 60, overrides: [], etats: [], crops: [] }));
  return f;
}
const args = (f, d) => ['--monde', f, '--dossier-parties', d];
function lireMonde(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
function caseLibre(bienvenue, dx) {
  const p = bienvenue.toi[0];
  return { x: Math.floor(p.x) + (dx || 0), y: Math.floor(p.y) + 3, z: Math.floor(p.z) };
}
async function poser(cl, pos, id, etat) {
  const n = cl.messages.length;
  cl.envoyer({ t: 'bloc', x: pos.x, y: pos.y, z: pos.z, id, j: 0, i: 0, etat: etat || 0 });
  return cl.attendre('bloc', 3000, m => cl.messages.indexOf(m) >= n && m.x === pos.x && m.y === pos.y && m.z === pos.z).catch(() => null);
}
async function overridesDe(cl, pos) {
  const cx = Math.floor(pos.x / 16), cz = Math.floor(pos.z / 16);
  const n = cl.messages.length;
  cl.envoyer({ t: 'overrides_demande', cx, cz });
  const ov = await cl.attendre('overrides_chunk', 3000, m => cl.messages.indexOf(m) >= n && m.cx === cx && m.cz === cz).catch(() => null);
  return ov ? ov.blocs : null;
}
const en = (liste, pos) => (liste || []).find(b => b[0] === pos.x && b[1] === pos.y && b[2] === pos.z);

// ── SPEC-SAVE-022 : un id qui n'est pas un bloc défini n'est jamais posé ─────
async function scenarioIdsNonBlocs(nom, env) {
  const d = A.dossierTemp('mc-b16-ids-');
  try {
    const f = fichierMonde(d);
    const s = await demarrer(args(f, d), env);
    const { client: cl, bienvenue } = await rejoindre(s.port, 'Poseuse', 1);
    const p1 = caseLibre(bienvenue, 0), p2 = caseLibre(bienvenue, 1), temoin = caseLibre(bienvenue, -1);
    for (const [id, pos, quoi] of [[C.FIRST_ITEM + 1, p1, 'un id d\'objet (4097)'], [3000, p2, 'un id libre (3000)']]) {
      ok(!C.BLOCKS[id], 'préparation : ' + quoi + ' n\'est pas un bloc défini');
      const rep = await poser(cl, pos, id, 0);
      ok(!!rep, `SPEC-SAVE-022 (${nom}) : ${quoi} — le serveur répond à l'émetteur`);
      eq(rep && rep.id, 0, `SPEC-SAVE-022 (${nom}) : ${quoi} — la réponse rappelle le bloc d'origine (air)`);
    }
    // témoin : un vrai bloc se pose dans les mêmes conditions
    const repT = await poser(cl, temoin, B.STONE, 0);
    eq(repT && repT.id, B.STONE, `SPEC-SAVE-022 (${nom}) : témoin — une pierre se pose normalement`);
    const ov = await overridesDe(cl, p1);
    ok(!!ov, `préparation (${nom}) : overrides du chunk reçus`);
    ok(!en(ov, p1) && !en(ov, p2), `SPEC-SAVE-022 (${nom}) : les cases refusées restent inchangées pour le serveur (aucun override)`, JSON.stringify([en(ov, p1), en(ov, p2)]));
    ok(!!en(ov, temoin), `SPEC-SAVE-022 (${nom}) : témoin — la pierre posée est bien un override`);
    cl.fermer();
    await s.arreter();
    const m = lireMonde(f);
    const ids = (m.overrides || []).map(o => o[3]);
    ok(ids.indexOf(C.FIRST_ITEM + 1) < 0 && ids.indexOf(3000) < 0, `SPEC-SAVE-022 (${nom}) : le fichier de monde sauvegardé ne contient aucun de ces ids`, JSON.stringify(ids));
    ok(ids.indexOf(B.STONE) >= 0, `SPEC-SAVE-022 (${nom}) : témoin — la pierre est dans le fichier de monde`);
  } finally { A.supprimerDossier(d); }
}

// ── SPEC-SAVE-023 : l'état reçu est borné par l'etatMax du bloc posé ─────────
async function scenarioEtatBorne() {
  const d = A.dossierTemp('mc-b16-etat-');
  try {
    const f = fichierMonde(d);
    const s = await demarrer(args(f, d).concat(['--ouvert']), { MC_MODE: 'creatif' });   // ouvert : deux postes (l'émetteur et un témoin)
    const { client: cl, bienvenue } = await rejoindre(s.port, 'Macon', 1);
    const autre = await rejoindre(s.port, 'Temoin', 1);
    const pPierre = caseLibre(bienvenue, 0), pEsc = caseLibre(bienvenue, 2), pBat = caseLibre(bienvenue, -2);
    const vuAutre = autre.client.depuis();
    const rep = await poser(cl, pPierre, B.STONE, 200);
    eq(rep && rep.id, B.STONE, 'SPEC-SAVE-023 : la pierre est posée');
    eq(rep && rep.etat, 0, 'SPEC-SAVE-023 : pierre annoncée avec l\'état 200 — l\'état diffusé vaut 0');
    await dodo(200);
    const chezAutre = vuAutre('bloc').find(m => m.x === pPierre.x && m.y === pPierre.y && m.z === pPierre.z);
    eq(chezAutre && chezAutre.etat, 0, 'SPEC-SAVE-023 : les autres joueurs reçoivent aussi l\'état 0');

    const etatEsc = MC.Formes.packEscalier(2, true, MC.Formes.DROIT);
    ok(etatEsc > 0 && etatEsc <= C.etatMaxDe(B.ESCALIER_STONE), 'préparation : état d\'escalier valide et non nul (' + etatEsc + ')');
    const repE = await poser(cl, pEsc, B.ESCALIER_STONE, etatEsc);
    eq(repE && repE.etat, etatEsc, 'SPEC-SAVE-023 : un escalier posé avec un état valide le conserve');
    const pEsc2 = caseLibre(bienvenue, 4);
    const repE2 = await poser(cl, pEsc2, B.ESCALIER_STONE, C.etatMaxDe(B.ESCALIER_STONE) + 1);
    eq(repE2 && repE2.etat, 0, 'SPEC-SAVE-023 : un escalier annoncé au-delà de etatMaxDe (' + (C.etatMaxDe(B.ESCALIER_STONE) + 1) + ') est posé à l\'état 0');
    const repB = await poser(cl, pBat, B.BATTERIE, 200);
    eq(repB && repB.etat, 0, 'SPEC-SAVE-023 : une batterie annoncée au-delà de 15 est ramenée à 0');
    const pBat2 = caseLibre(bienvenue, -4);
    const repB2 = await poser(cl, pBat2, B.BATTERIE, C.etatMaxDe(B.BATTERIE));
    eq(repB2 && repB2.etat, C.etatMaxDe(B.BATTERIE), 'SPEC-SAVE-023 : une batterie à sa borne (' + C.etatMaxDe(B.BATTERIE) + ') la garde');

    const ov = await overridesDe(cl, pPierre);
    const op = en(ov, pPierre);
    eq(op && op[4], 0, 'SPEC-SAVE-023 : pour le serveur, la pierre n\'a aucun état');
    cl.fermer(); autre.client.fermer();
    await s.arreter();
    const m = lireMonde(f);
    const etatsPierre = (m.etats || []).filter(e => e[0] === pPierre.x && e[1] === pPierre.y && e[2] === pPierre.z);
    eq(etatsPierre.length, 0, 'SPEC-SAVE-023 : le fichier de monde ne garde aucun état pour la pierre');
    const etatsEsc = (m.etats || []).find(e => e[0] === pEsc.x && e[1] === pEsc.y && e[2] === pEsc.z);
    eq(etatsEsc && etatsEsc[3], etatEsc, 'SPEC-SAVE-023 : l\'état de l\'escalier est sauvegardé tel quel');
    // aucun état sauvegardé pour un bloc d'etatMax 0
    const ovs = new Map((m.overrides || []).map(o => [o[0] + ',' + o[1] + ',' + o[2], o[3]]));
    const fautifs = (m.etats || []).filter(e => { const id = ovs.get(e[0] + ',' + e[1] + ',' + e[2]); return id !== undefined && C.etatMaxDe(id) === 0; });
    eq(fautifs.length, 0, 'SPEC-SAVE-023 : etatsOverrides ne contient aucun état pour un bloc sans état');
  } finally { A.supprimerDossier(d); }
}

// ── SPEC-SAVE-024 : un rappel de refus porte l'état réel (le client l'applique, 0 compris) ──
async function scenarioRefusAvecEtat() {
  const d = A.dossierTemp('mc-b16-ref-');
  try {
    const f = fichierMonde(d);
    const s = await demarrer(args(f, d), { MC_MODE: 'creatif' });
    const { client: cl, bienvenue } = await rejoindre(s.port, 'Couvreur', 1);
    const p = caseLibre(bienvenue, 0);
    const haute = MC.Formes.packDalle(true);
    const rep = await poser(cl, p, B.DALLE_PLANKS, haute);
    eq(rep && rep.id, B.DALLE_PLANKS, 'préparation : dalle posée');
    eq(rep && rep.etat, haute, 'préparation : dalle haute (état ' + haute + ')');
    // pose refusée sur la dalle (une pierre ne fusionne pas avec elle) : le rappel porte l'état du serveur
    const refus = await poser(cl, p, B.STONE, 0);
    eq(refus && refus.id, B.DALLE_PLANKS, 'SPEC-SAVE-024 : pose refusée — le rappel donne le bloc du serveur');
    eq(refus && refus.etat, haute, 'SPEC-SAVE-024 : … et son état (dalle haute), que le client réapplique');
    // un refus sur une case sans état rappelle explicitement l'état 0
    const p2 = caseLibre(bienvenue, 2);
    await poser(cl, p2, B.STONE, 0);
    const refus2 = await poser(cl, p2, B.PLANKS, 0);
    eq(refus2 && refus2.etat, 0, 'SPEC-SAVE-024 : rappel d\'un bloc sans état : état 0 explicite');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── SPEC-SAVE-025 : version et format d'identifiants à la connexion ──────────
async function scenarioFormatIds() {
  const d = A.dossierTemp('mc-b16-fmt-');
  try {
    const f = fichierMonde(d);
    const s = await demarrer(args(f, d).concat(['--ouvert']), { MC_MODE: 'creatif' });
    const p0 = await rejoindre(s.port, 'Hote', 1);
    const cible = caseLibre(p0.bienvenue, 0);

    async function essai(nomJ, champs) {
      const cl = await connecter(s.port, {});
      cl.envoyer(Object.assign({ t: 'rejoindre', nom: nomJ, locaux: 1 }, champs));
      // un client refusé tente aussitôt de poser : rien ne doit s'appliquer
      cl.envoyer({ t: 'bloc', x: cible.x, y: cible.y, z: cible.z, id: B.STONE, j: 0, etat: 0 });
      const refus = await cl.attendre('refus', 3000).catch(() => null);
      for (let k = 0; k < 40 && !cl.fermee; k++) await dodo(50);
      return { cl, refus };
    }
    const sans = await essai('SansFormat', {});
    ok(!!sans.refus, 'SPEC-SAVE-025 : REJOINDRE sans format d\'identifiants → REFUS');
    const motif = (sans.refus && sans.refus.motif) || '';
    ok(/format/i.test(motif) && motif.indexOf(String(C.FIRST_ITEM)) >= 0, 'SPEC-SAVE-025 : motif lisible qui donne le format du serveur', motif);
    ok(/aucun|absent/i.test(motif), 'SPEC-SAVE-025 : … et dit que le client n\'en annonce aucun', motif);
    ok(sans.cl.fermee, 'SPEC-SAVE-025 : la connexion refusée est fermée');
    ok(!sans.cl.messages.some(m => m.t === 'bienvenue' || m.t === 'bloc'), 'SPEC-SAVE-025 : aucun BIENVENUE, aucun message de jeu pour le client refusé');

    const invalide = await essai('FormatInvalide', { version: C.VERSION_JEU, formatIds: 0 });
    ok(!!invalide.refus, 'SPEC-SAVE-025 : un format d\'identifiants invalide (0) → REFUS');
    const motifI = (invalide.refus && invalide.refus.motif) || '';
    ok(/invalide/i.test(motifI) && !/aucun|antérieure/i.test(motifI) && motifI.indexOf(String(C.FIRST_ITEM)) >= 0,
       'SPEC-SAVE-025 : le motif dit « invalide », pas « aucun », et donne le format du serveur', motifI);
    ok(invalide.cl.fermee, 'SPEC-SAVE-025 : connexion fermée');

    const autreFmt = await essai('AutreFormat', { version: C.VERSION_JEU, formatIds: 128 });
    ok(!!autreFmt.refus, 'SPEC-SAVE-025 : un format d\'identifiants différent (128) → REFUS');
    const motif2 = (autreFmt.refus && autreFmt.refus.motif) || '';
    ok(motif2.indexOf('128') >= 0 && motif2.indexOf(String(C.FIRST_ITEM)) >= 0, 'SPEC-SAVE-025 : le motif donne les deux formats', motif2);
    ok(autreFmt.cl.fermee, 'SPEC-SAVE-025 : connexion fermée');

    const ov = await overridesDe(p0.client, cible);
    ok(!!ov && !en(ov, cible), 'SPEC-SAVE-025 : monde inchangé — aucun message d\'un client refusé n\'a été appliqué', JSON.stringify(en(ov, cible)));

    const cl3 = await connecter(s.port, {});
    cl3.envoyer({ t: 'rejoindre', nom: 'AutreVersion', locaux: 1, version: '0.0.1-autre', formatIds: C.FIRST_ITEM });
    const bv = await cl3.attendre('bienvenue', 8000).catch(() => null);
    ok(!!bv, 'SPEC-SAVE-025 : une autre version de jeu au même format d\'identifiants est admise');
    eq(bv && bv.version, C.VERSION_JEU, 'SPEC-SAVE-025 : BIENVENUE porte la version du serveur');
    eq(bv && bv.formatIds, C.FIRST_ITEM, 'SPEC-SAVE-025 : BIENVENUE porte le format d\'identifiants du serveur');
    eq(p0.bienvenue.formatIds, C.FIRST_ITEM, 'SPEC-SAVE-025 : un client au même format et à la même version est admis');
    cl3.fermer(); p0.client.fermer(); sans.cl.fermer(); autreFmt.cl.fermer(); invalide.cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

(async () => {
  const filtre = process.argv[2];
  const scenarios = {
    'ids-creatif': () => scenarioIdsNonBlocs('créatif', { MC_MODE: 'creatif', MC_TEST_POSE_LIBRE: '' }),
    'ids-pose-libre': () => scenarioIdsNonBlocs('survie, MC_TEST_POSE_LIBRE', { MC_MODE: 'survie', MC_TEST_POSE_LIBRE: '1' }),
    etat: scenarioEtatBorne,
    'refus-etat': scenarioRefusAvecEtat,
    format: scenarioFormatIds,
  };
  try {
    for (const nom of Object.keys(scenarios)) {
      if (filtre && filtre !== nom) continue;
      try { await scenarios[nom](); }
      catch (e) { ok(false, 'scénario ' + nom + ' : exception', e && e.stack); }
    }
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
