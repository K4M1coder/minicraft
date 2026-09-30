/* integration-archi-env.js — lot B-ENV du chantier « solo = serveur toujours
   présent » (SPEC-ARCHI-022, 024, 025, 034, 035), sur de vrais processus
   server.js, arrêtés en fin de test :

   - 022 : une tornade POUSSE le joueur (vitesse modifiée par le serveur, jamais
     par le client) et un éclair proche lui retire des PV, par un état serveur ;
   - 024 : les habitants d'un village proche apparaissent dans les créatures
     reçues (ETAT.mobs) — c'est ce que le client lit dans net.mobsDistants ;
   - 025 : DORMIR — la nuit ne passe que lorsque TOUS les joueurs présents
     dorment (un solo ; deux postes en mode ouvert ; deux joueurs d'un écran
     partagé ; départ du seul éveillé) ; /jour et /nuit (ADMIN « heure ») sont
     refusés hors créatif sauf administrateur, identiquement en solo fermé ;
   - 034 : le serveur fait apparaître des créatures, éveille les gardiens de
     donjon, et fait croître les cultures en les diffusant par BLOC — sans
     croissance pendant la pause, et vues par deux clients (SPEC-SYNC-018) ;
   - SPEC-SYNC-019 : le vieillissement et l'extinction d'un feu, calculés au tic
     du serveur, sont diffusés à tous les clients ;
   - 035 : fabriquer en solo fermé passe par CRAFT (grille et inventaire serveur).

   Usage : node tests/integration-archi-env.js [scenario]
   Scénarios : sommeil, heure, tornade, foudre, habitants, apparitions, cultures, culturesDeux, feu, gardien, craft */
'use strict';
const path = require('path');
const fs = require('fs');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre, chargerModules, dossierTemp, supprimerDossier } = A;
const R = A.creerRapport('Intégration ARCHI — B-ENV : sommeil, heure, tornades, foudre, habitants, apparitions, cultures, gardiens, fabrication');
const { ok, eq } = R;

const MC = chargerModules();
const DL = MC.DayCycle.DAY_LENGTH;
const NUIT = DL * 0.75;              // 900 s : plein cœur de la nuit du premier jour
const JOUR_ETE = DL * 2 + 100;       // été, matin : les cultures poussent à cadence normale

const serveurs = [];
async function demarrer(args, env) { const s = await lancer(args, env); serveurs.push(s); return s; }
async function arreterTout() { for (const s of serveurs.splice(0)) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } } }

/* Sondage borné d'une condition (jamais un délai fixe). */
async function attendreQue(cond, ms, pas) {
  const fin = Date.now() + (ms || 8000);
  for (;;) {
    let v; try { v = cond(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() > fin) return false;
    await dodo(pas || 40);
  }
}
const heureDe = (cl) => { const e = cl.dernier('etat'); return e ? e.heure : null; };
const toi = (cl, j) => { const e = cl.dernier('etat'); return e && e.toi ? e.toi[j || 0] : null; };
const chatContient = (cl, re) => cl.messages.some(m => m.t === 'chat' && re.test(m.texte || ''));

function fichierMonde(dossier, extra) {
  const f = path.join(dossier, 'monde.json');
  fs.writeFileSync(f, JSON.stringify(Object.assign({ v: 2, graine: 20260921, heure: NUIT, overrides: [], etats: [], crops: [] }, extra || {})));
  return f;
}
const args = (f, d, plus) => ['--port', '0', '--monde', f, '--dossier-parties', d].concat(plus || []);

/* Monde local chargé pour trouver un sol (le serveur tourne dans un autre processus, avec la MÊME graine). */
/* Un point de terre ferme (la colonne d'apparition du monde) : { x, y, z } pour MC_TEST_SPAWN. */
function terreFerme(graine) {
  const w = MC.createWorld(graine);
  const col = w.findSpawnColumn();
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) w.getChunk(Math.floor(col[0] / 16) + cx, Math.floor(col[1] / 16) + cz, true);
  return { x: col[0] + 0.5, y: w.groundAt(col[0], col[1], true) + 1.2, z: col[1] + 0.5 };
}

// ── SPEC-ARCHI-025 : sommeil ────────────────────────────────────────────────
async function scenarioSommeil() {
  const d = dossierTemp('mc-env-som-');
  try {
    // (a) solo fermé : un seul joueur, il dort, l'aube arrive PAR LE SERVEUR
    let f = fichierMonde(d);
    let s = await demarrer(args(f, d));
    let a = await rejoindre(s.port, 'Solo', 1);
    await attendreQue(() => heureDe(a.client) !== null, 4000);
    ok(heureDe(a.client) >= NUIT && heureDe(a.client) < NUIT + 30, 'SPEC-ARCHI-025 : le monde démarre en pleine nuit', String(heureDe(a.client)));
    a.client.envoyer({ t: 'dormir', j: 0, actif: true });
    ok(!!(await attendreQue(() => heureDe(a.client) >= DL && heureDe(a.client) < DL + 20, 6000)),
       'SPEC-ARCHI-025 : un solo qui dort la nuit voit l\'heure sauter à l\'aube par un message serveur', String(heureDe(a.client)));
    ok(!!(await attendreQue(() => chatContient(a.client, /jour se lève/i), 3000)), 'SPEC-ARCHI-025 : le serveur annonce « Le jour se lève »');
    a.client.fermer();
    await s.arreter();

    // (b) en plein jour, dormir est refusé par le serveur
    f = fichierMonde(d, { heure: 100 });
    s = await demarrer(args(f, d));
    a = await rejoindre(s.port, 'Solo', 1);
    a.client.envoyer({ t: 'dormir', j: 0, actif: true });
    ok(!!(await attendreQue(() => chatContient(a.client, /que la nuit/i), 4000)), 'SPEC-ARCHI-025 : dormir de jour est refusé (« On ne dort que la nuit »)');
    ok(heureDe(a.client) < DL * 0.5, 'SPEC-ARCHI-025 : et l\'heure n\'a pas sauté', String(heureDe(a.client)));
    a.client.fermer();
    await s.arreter();

    // (c) deux postes en mode ouvert : la nuit ne passe que lorsque les DEUX dorment
    f = fichierMonde(d);
    s = await demarrer(args(f, d, ['--ouvert']));
    const al = await rejoindre(s.port, 'Alice', 1);
    const bo = await rejoindre(s.port, 'Bob', 1);
    al.client.envoyer({ t: 'dormir', j: 0, actif: true });
    ok(!!(await attendreQue(() => chatContient(al.client, /attente.*1\/2/), 4000)), 'SPEC-ARCHI-025 : Alice dort seule — le serveur l\'invite à attendre (1/2)');
    await dodo(600);
    ok(heureDe(al.client) < NUIT + 60, 'SPEC-ARCHI-025 : avec un seul dormeur sur deux, la nuit ne passe pas', String(heureDe(al.client)));
    bo.client.envoyer({ t: 'dormir', j: 0, actif: true });
    ok(!!(await attendreQue(() => heureDe(al.client) >= DL && heureDe(bo.client) >= DL, 6000)),
       'SPEC-ARCHI-025 : dès que Bob dort aussi, la nuit passe pour les deux postes');
    al.client.fermer(); bo.client.fermer();
    await s.arreter();

    // (d) écran partagé : deux joueurs locaux d'un même poste comptent comme deux joueurs
    f = fichierMonde(d);
    s = await demarrer(args(f, d));
    const loc = await rejoindre(s.port, 'Salon', 2);
    loc.client.envoyer({ t: 'dormir', j: 0, actif: true });
    await dodo(700);
    ok(heureDe(loc.client) < NUIT + 60, 'SPEC-ARCHI-025 : à deux joueurs locaux, un seul couché ne fait pas passer la nuit', String(heureDe(loc.client)));
    loc.client.envoyer({ t: 'dormir', j: 1, actif: true });
    ok(!!(await attendreQue(() => heureDe(loc.client) >= DL, 6000)), 'SPEC-ARCHI-025 : le second joueur local se couche — la nuit passe');
    loc.client.fermer();
    await s.arreter();

    // (e) le seul éveillé s'en va : le dormeur restant fait passer la nuit
    f = fichierMonde(d);
    s = await demarrer(args(f, d, ['--ouvert']));
    const d1 = await rejoindre(s.port, 'Dormeuse', 1);
    const d2 = await rejoindre(s.port, 'Veilleur', 1);
    d1.client.envoyer({ t: 'dormir', j: 0, actif: true });
    await dodo(500);
    ok(heureDe(d1.client) < NUIT + 60, 'SPEC-ARCHI-025 : témoin — un dormeur sur deux, la nuit ne passe pas');
    d2.client.fermer();
    ok(!!(await attendreQue(() => heureDe(d1.client) >= DL, 8000)), 'SPEC-ARCHI-025 : quand le seul joueur éveillé part, la nuit passe pour le dormeur');
    d1.client.fermer();
    await s.arreter();

    // (f) majorité : à trois joueurs, deux couchés suffisent — un seul éveillé ne bloque pas la nuit
    f = fichierMonde(d);
    s = await demarrer(args(f, d, ['--ouvert']));
    const t1 = await rejoindre(s.port, 'Un', 1);
    const t2 = await rejoindre(s.port, 'Deux', 1);
    const t3 = await rejoindre(s.port, 'Trois', 1);
    t1.client.envoyer({ t: 'dormir', j: 0, actif: true });
    await dodo(500);
    ok(heureDe(t1.client) < NUIT + 60, 'SPEC-ARCHI-025 : un dormeur sur trois ne suffit pas');
    t2.client.envoyer({ t: 'dormir', j: 0, actif: true });
    ok(!!(await attendreQue(() => heureDe(t3.client) >= DL, 6000)), 'SPEC-ARCHI-025 : deux dormeurs sur trois (majorité) font passer la nuit, le troisième restant éveillé');
    [t1, t2, t3].forEach(x => x.client.fermer());
    await s.arreter();

    // (g) un dormeur qui se lève (il s'éloigne) sort du vote, sans rien envoyer de plus
    f = fichierMonde(d);
    s = await demarrer(args(f, d, ['--ouvert']));
    const m1 = await rejoindre(s.port, 'Marcheur', 1);
    const m2 = await rejoindre(s.port, 'Veilleur', 1);
    await attendreQue(() => toi(m1.client), 4000);
    const p0 = toi(m1.client);
    m1.client.envoyer({ t: 'dormir', j: 0, actif: true });
    await dodo(300);
    let sq = 1;
    for (let i = 0; i < 30; i++) { m1.client.envoyer({ t: A.NP.MSG.ENTREE, s: sq++, j: 0, dt: 0.05, k: 1, yaw: 0, pitch: 0, v: 0 }); await dodo(50); }
    // le serveur consomme les entrées à son rythme (sous charge, l'état retarde) : sondage borné
    await attendreQue(() => { const q = toi(m1.client); return q && Math.hypot(q.x - p0.x, q.z - p0.z) > 2; }, 8000);
    const p1 = toi(m1.client);
    ok(Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2, 'témoin — le dormeur s\'est bien éloigné de son lit', JSON.stringify([p0.x, p0.z, p1.x, p1.z]));
    m2.client.envoyer({ t: 'dormir', j: 0, actif: true });
    await dodo(700);
    ok(heureDe(m2.client) < NUIT + 90, 'SPEC-ARCHI-025 : Marcheur, levé, ne compte plus comme dormeur — un sur deux, la nuit ne passe pas', String(heureDe(m2.client)));
    m1.client.envoyer({ t: 'dormir', j: 0, actif: true });
    ok(!!(await attendreQue(() => heureDe(m2.client) >= DL, 6000)), 'SPEC-ARCHI-025 : recouché à sa nouvelle place, il fait à nouveau passer la nuit');
    m1.client.fermer(); m2.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── SPEC-ARCHI-025 : /jour, /nuit ───────────────────────────────────────────
async function scenarioHeure() {
  const d = dossierTemp('mc-env-heure-');
  try {
    const depart = DL * 2 + DL * 0.5;                 // jour 2, midi
    // survie : refusé, identiquement en solo fermé et en ouvert
    for (const ouvert of [false, true]) {
      const f = fichierMonde(d, { heure: depart });
      const s = await demarrer(args(f, d, ouvert ? ['--ouvert'] : []), { MC_MODE: 'survie' });
      const a = await rejoindre(s.port, 'Joueur', 1);
      const nom = ouvert ? 'ouvert' : 'solo fermé';
      a.client.envoyer({ t: 'admin', action: 'heure', args: { valeur: DL * 0.7 } });
      const rep = await a.client.attendre('admin_rep', 4000, m => m.action === 'heure').catch(() => null);
      ok(rep && rep.ok === false && rep.erreur === 'reserve_creatif_ou_admin', 'SPEC-ARCHI-025 : /nuit en survie (' + nom + ') est refusé', JSON.stringify(rep));
      await dodo(300);
      ok(heureDe(a.client) >= depart && heureDe(a.client) < depart + 60, 'SPEC-ARCHI-025 : et l\'heure n\'a pas bougé (' + nom + ')', String(heureDe(a.client)));
      a.client.fermer();
      await s.arreter();
    }
    // survie mais administrateur authentifié : accepté, DANS le jour courant
    let f = fichierMonde(d, { heure: depart });
    let s = await demarrer(args(f, d, ['--admin', 'secretEnv']), { MC_MODE: 'survie' });
    let a = await rejoindre(s.port, 'Chef', 1);
    a.client.envoyer({ t: 'admin', action: 'auth', args: { secret: 'secretEnv' } });
    await a.client.attendre('admin_rep', 4000, m => m.action === 'auth' && m.ok);
    a.client.envoyer({ t: 'admin', action: 'heure', args: { valeur: DL * 0.7 } });
    const repAdm = await a.client.attendre('admin_rep', 4000, m => m.action === 'heure').catch(() => null);
    ok(repAdm && repAdm.ok === true, 'SPEC-ARCHI-025 : un administrateur authentifié peut régler l\'heure en survie', JSON.stringify(repAdm));
    ok(!!(await attendreQue(() => heureDe(a.client) >= DL * 2 + DL * 0.7 && heureDe(a.client) < DL * 2 + DL * 0.7 + 30, 4000)),
       'SPEC-ARCHI-025 : l\'heure devient 0,7 du jour COURANT (la date ne recule pas)', String(heureDe(a.client)));
    a.client.fermer();
    await s.arreter();
    // créatif : accepté pour tout joueur
    f = fichierMonde(d, { heure: depart });
    s = await demarrer(args(f, d), { MC_MODE: 'creatif' });
    a = await rejoindre(s.port, 'Bac', 1);
    a.client.envoyer({ t: 'admin', action: 'heure', args: { valeur: DL * 0.2 } });
    const repC = await a.client.attendre('admin_rep', 4000, m => m.action === 'heure').catch(() => null);
    ok(repC && repC.ok === true, 'SPEC-ARCHI-025 : /jour en créatif est accepté (solo fermé)', JSON.stringify(repC));
    ok(!!(await attendreQue(() => heureDe(a.client) >= DL * 2 + DL * 0.2 && heureDe(a.client) < DL * 2 + DL * 0.2 + 30, 4000)),
       'SPEC-ARCHI-025 : l\'heure devient 0,2 du jour courant', String(heureDe(a.client)));
    a.client.envoyer({ t: 'admin', action: 'heure', args: { valeur: 'minuit' } });
    const repMauvais = await a.client.attendre('admin_rep', 4000, m => m.action === 'heure' && m.ok === false).catch(() => null);
    ok(repMauvais && repMauvais.erreur === 'valeur_invalide', 'SPEC-ARCHI-025 : une valeur qui n\'est pas un nombre est refusée', JSON.stringify(repMauvais));
    a.client.envoyer({ t: 'admin', action: 'heure', args: { valeur: 10 } });
    a.client.envoyer({ t: 'admin', action: 'heure', args: { valeur: 20 } });
    const rapide = await attendreQue(() => a.client.messages.some(m => m.t === 'admin_rep' && m.action === 'heure' && m.erreur === 'trop_rapide'), 4000);
    ok(!!rapide, 'SPEC-ARCHI-025 : le débit des demandes d\'heure est limité (une par seconde)');
    a.client.fermer();
    await s.arreter();
    // créatif mais serveur OUVERT : l'hôte local règle l'heure, un joueur distant non
    const externes = A.adressesNonLocales().filter(x => x.indexOf(':') < 0);
    f = fichierMonde(d, { heure: depart });
    s = await demarrer(args(f, d, ['--ouvert']), { MC_MODE: 'creatif' });
    const hote = await rejoindre(s.port, 'Hote', 1);
    hote.client.envoyer({ t: 'admin', action: 'heure', args: { valeur: DL * 0.2 } });
    const repH = await hote.client.attendre('admin_rep', 4000, m => m.action === 'heure').catch(() => null);
    ok(repH && repH.ok === true, 'SPEC-ARCHI-025 : l\'hôte local règle l\'heure d\'un serveur ouvert en créatif', JSON.stringify(repH));
    if (!externes.length) R.saut('SPEC-ARCHI-025 : joueur distant refusé', 'aucune adresse réseau non locale sur cette machine');
    else {
      const distant = await rejoindre(s.port, 'Distant', 1, { hote: externes[0] });
      distant.client.envoyer({ t: 'admin', action: 'heure', args: { valeur: DL * 0.7 } });
      const repD = await distant.client.attendre('admin_rep', 4000, m => m.action === 'heure').catch(() => null);
      ok(repD && repD.ok === false && repD.erreur === 'reserve_creatif_ou_admin', 'SPEC-ARCHI-025 : un joueur distant d\'un serveur ouvert en créatif est refusé', JSON.stringify(repD));
      distant.client.fermer();
    }
    hote.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── SPEC-ARCHI-022 : tornade ────────────────────────────────────────────────
async function derive(env, graine) {
  const d = dossierTemp('mc-env-torn-');
  try {
    const t = terreFerme(graine);
    const f = fichierMonde(d, { graine, heure: DL * 0.3 });
    const s = await demarrer(args(f, d, ['--graine', String(graine)]), Object.assign({ MC_TEST_SPAWN: t.x + ',' + t.y + ',' + t.z, MC_MODE: 'survie' }, env));
    const a = await rejoindre(s.port, 'Passant', 1);
    await attendreQue(() => toi(a.client), 4000);
    const p0 = toi(a.client);
    // le joueur reste immobile (aucune touche) : seul le monde peut le déplacer
    let sq = 1;
    const fin = Date.now() + 2500;
    while (Date.now() < fin) { a.client.envoyer({ t: A.NP.MSG.ENTREE, s: sq++, j: 0, dt: 0.05, k: 0, yaw: 0, pitch: 0, v: 0 }); await dodo(50); }
    const p1 = toi(a.client);
    a.client.fermer();
    await s.arreter();
    return { deplacement: Math.hypot(p1.x - p0.x, p1.z - p0.z), montee: p1.y - p0.y, vitesse: Math.hypot(p1.vx, p1.vz) };
  } finally { await arreterTout(); supprimerDossier(d); }
}
async function scenarioTornade() {
  const temoin = await derive({}, 20260921);
  ok(temoin.deplacement < 0.1 && temoin.vitesse < 0.1, 'SPEC-ARCHI-022 : témoin — sans tornade, un joueur immobile ne bouge pas', JSON.stringify(temoin));
  const avec = await derive({ MC_TEST_CATASTROPHE: '1' }, 20260921);
  ok(avec.deplacement > 0.4 && avec.deplacement > temoin.deplacement + 0.3, 'SPEC-ARCHI-022 : une tornade proche pousse le joueur — vitesse modifiée par le SERVEUR', JSON.stringify(avec));
}

// ── SPEC-ARCHI-022 : foudre ─────────────────────────────────────────────────
async function scenarioFoudre() {
  const d = dossierTemp('mc-env-foudre-');
  try {
    const t = terreFerme(20260921);
    const f = fichierMonde(d, { heure: DL * 0.3 });
    // MC_TEST_ECLAIR : un éclair toutes les 2 s de monde, tombant sur le joueur (la portée et l'abri restent ceux du serveur)
    const s = await demarrer(args(f, d), { MC_TEST_SPAWN: t.x + ',' + t.y + ',' + t.z, MC_TEST_ECLAIR: '1', MC_MODE: 'survie' });
    const a = await rejoindre(s.port, 'Foudroye', 1);
    await attendreQue(() => toi(a.client), 4000);
    const pv0 = toi(a.client).pv;
    const vu = await attendreQue(() => toi(a.client).pv < pv0, 8000);
    ok(!!vu, 'SPEC-ARCHI-022 : un éclair proche d\'un joueur à découvert lui retire des PV, par un état serveur', 'pv ' + pv0 + ' → ' + toi(a.client).pv);
    a.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── SPEC-ARCHI-024 : habitants ──────────────────────────────────────────────
async function scenarioHabitants() {
  const d = dossierTemp('mc-env-hab-');
  try {
    const f = fichierMonde(d, { graine: 100, heure: DL * 0.3 });
    const s = await demarrer(args(f, d, ['--graine', '100']));
    const a = await rejoindre(s.port, 'Visiteuse', 1);
    const pnj = await attendreQue(() => { const e = a.client.dernier('etat'); return e && (e.mobs || []).find(m => m.t === 'villager' && m.r); }, 12000);
    ok(!!pnj, 'SPEC-ARCHI-024 : en solo fermé, un habitant de métier d\'un lieu proche apparaît dans les créatures reçues (net.mobsDistants)', JSON.stringify(pnj));
    ok(!!pnj && typeof pnj.n === 'string' && pnj.n.length > 0, 'SPEC-ARCHI-024 : il porte son nom et son métier, décidés par le serveur', JSON.stringify(pnj));
    a.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── SPEC-ARCHI-034 : apparitions ────────────────────────────────────────────
async function scenarioApparitions() {
  const d = dossierTemp('mc-env-app-');
  try {
    const f = fichierMonde(d, { heure: DL * 0.3 });
    const s = await demarrer(args(f, d, ['--graine', '20260921']), { MC_MODE: 'survie' });
    const a = await rejoindre(s.port, 'Chasseur', 1);
    const bete = await attendreQue(() => { const e = a.client.dernier('etat'); return e && (e.mobs || []).find(m => m.t !== 'villager' && m.t !== 'item' && m.t !== 'arrow'); }, 60000, 200);
    ok(!!bete, 'SPEC-ARCHI-034 : des créatures apparaissent autour du joueur — décidé par le serveur, jamais par le client', JSON.stringify(bete));
    a.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── SPEC-ARCHI-034 : cultures ───────────────────────────────────────────────
async function scenarioCultures() {
  const d = dossierTemp('mc-env-cult-');
  try {
    const graine = 20260921;
    const w = MC.createWorld(graine);
    const col = w.findSpawnColumn();
    for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) w.getChunk(Math.floor(col[0] / 16) + cx, Math.floor(col[1] / 16) + cz, true);
    const B = MC.Core.B;
    const overrides = [], crops = [];
    const pos = [];
    for (let i = 0; i < 8; i++) {
      const x = col[0] + 3 + i, z = col[1] + 3;
      const y = w.groundAt(x, z, true);
      overrides.push([x, y, z, B.FARMLAND], [x, y + 1, z, B.WHEAT0]);
      crops.push([x, y + 1, z, 8]);                 // 6 s avant le premier stade (été : 14 s)
      pos.push([x, y + 1, z]);
    }
    const f = fichierMonde(d, { heure: JOUR_ETE, overrides, crops });
    const s = await demarrer(args(f, d));
    const a = await rejoindre(s.port, 'Fermier', 1);
    // en pause, RIEN ne pousse : aucun BLOC de croissance, même après le temps qu'il fallait
    a.client.envoyer({ t: 'pause', actif: true });
    await a.client.attendre('pause_etat', 3000, m => m.actif === true);
    const vusPause = a.client.depuis();
    await dodo(9000);
    const pousses = (t) => vusPause(t).filter(m => pos.some(p => p[0] === m.x && p[1] === m.y && p[2] === m.z && m.id === B.WHEAT1));
    eq(pousses('bloc').length, 0, 'SPEC-ARCHI-034 : pendant la pause, aucune culture ne croît');
    // la reprise : le serveur diffuse le stade suivant par BLOC, sans action d'aucun client
    a.client.envoyer({ t: 'pause', actif: false });
    const bloc = await attendreQue(() => pousses('bloc')[0], 40000, 100);
    ok(!!bloc, 'SPEC-ARCHI-034 : une culture croît en solo fermé par un BLOC du serveur', JSON.stringify(vusPause('bloc').slice(0, 3)));
    a.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── SPEC-SYNC-018 : cultures vues par deux clients à la fois ────────────────
async function scenarioCulturesDeux() {
  const d = dossierTemp('mc-env-cult2-');
  try {
    const graine = 20260921;
    const w = MC.createWorld(graine);
    const col = w.findSpawnColumn();
    for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) w.getChunk(Math.floor(col[0] / 16) + cx, Math.floor(col[1] / 16) + cz, true);
    const B = MC.Core.B;
    const overrides = [], crops = [], pos = [];
    for (let i = 0; i < 8; i++) {
      const x = col[0] + 3 + i, z = col[1] + 3, y = w.groundAt(x, z, true);
      overrides.push([x, y, z, B.FARMLAND], [x, y + 1, z, B.WHEAT0]);
      crops.push([x, y + 1, z, 8]);
      pos.push([x, y + 1, z]);
    }
    const f = fichierMonde(d, { heure: JOUR_ETE, overrides, crops });
    // portée de diffusion réduite à 7 blocs (test) : les cultures à x+3..x+6 sont à portée, celles à x+7..x+10 non
    const s = await demarrer(args(f, d, ['--ouvert']), { MC_TEST_PORTEE_BLOCS: '7' });
    const a = await rejoindre(s.port, 'Alice', 1);
    const b = await rejoindre(s.port, 'Bob', 1);
    const cle = (m) => m.x + ',' + m.y + ',' + m.z;
    const pousse = (cl) => cl.messages.filter(m => m.t === 'bloc' && m.id === B.WHEAT1 && pos.some(p => p.join(',') === cle(m)));
    ok(!!(await attendreQue(() => pousse(a.client).length > 0 && pousse(b.client).length > 0, 40000, 100)),
       'SPEC-SYNC-018 : les deux clients reçoivent un BLOC au même changement de stade, sans action tierce');
    const communes = pousse(a.client).map(cle).filter(k => pousse(b.client).map(cle).indexOf(k) >= 0);
    ok(communes.length > 0, 'SPEC-SYNC-018 : au moins une culture est vue croître par les deux', JSON.stringify(communes));
    await dodo(4000);
    const distance = (p) => Math.hypot(p[0] - col[0] - 0.5, p[2] - col[1] - 0.5);   // comme le serveur (bloc entier, joueur à +0,5)
    const loin = pos.filter(p => distance(p) > 7.5), pres = pos.filter(p => distance(p) < 6.5);
    const cleLoin = new Set(loin.map(p => p.join(',')));
    const tous = a.client.messages.concat(b.client.messages);
    ok(tous.some(m => m.t === 'bloc' && pres.some(p => p.join(',') === cle(m))), 'SPEC-SYNC-018 : les cultures à portée sont diffusées');
    ok(!tous.some(m => m.t === 'bloc' && cleLoin.has(cle(m))),
       'SPEC-SYNC-018 : une culture hors de portée de diffusion n\'est envoyée à aucun client');
    a.client.fermer(); b.client.fermer();
    await s.arreter();
    const sauve = JSON.parse(fs.readFileSync(f, 'utf8'));
    const cultivees = (sauve.overrides || []).filter(o => cleLoin.has(o[0] + ',' + o[1] + ',' + o[2]) && o[3] >= B.WHEAT1 && o[3] <= B.WHEAT3);
    ok(cultivees.length > 0, 'témoin — ces cultures lointaines ont bien poussé côté serveur (elles sont sauvegardées au stade suivant)', String(cultivees.length));
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── SPEC-SYNC-019 : le feu évolue au tic et se diffuse à tous ────────────────
async function scenarioFeu() {
  const d = dossierTemp('mc-env-feu-');
  try {
    const graine = 20260921;
    const t = terreFerme(graine);
    const w = MC.createWorld(graine);
    const col = [Math.floor(t.x), Math.floor(t.z)];
    for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) w.getChunk(Math.floor(col[0] / 16) + cx, Math.floor(col[1] / 16) + cz, true);
    const B = MC.Core.B;
    const sol = w.groundAt(col[0], col[1]);
    // le sol de la colonne foudroyée est une planche : inflammable, la foudre l'enflamme
    const f = fichierMonde(d, { heure: DL * 0.3, overrides: [[col[0], sol, col[1], B.PLANKS]] });
    const s = await demarrer(args(f, d, ['--ouvert']), { MC_TEST_SPAWN: t.x + ',' + t.y + ',' + t.z, MC_TEST_ECLAIR: '1', MC_MODE: 'creatif' });
    const a = await rejoindre(s.port, 'Alice', 1);
    const b = await rejoindre(s.port, 'Bob', 1);
    const surCase = (cl) => cl.messages.filter(m => m.t === 'bloc' && m.x === col[0] && m.y === sol && m.z === col[1]);
    ok(!!(await attendreQue(() => surCase(a.client).some(m => m.id === B.FEU), 15000, 50)), 'témoin — la foudre enflamme la planche (diffusé à Alice)');
    ok(!!(await attendreQue(() => surCase(a.client).some(m => m.id === B.FEU && m.etat >= 1), 8000, 50)),
       'SPEC-SYNC-019 : le vieillissement du feu, calculé au tic serveur, est diffusé (BLOC avec un âge)');
    ok(!!(await attendreQue(() => surCase(a.client).some(m => m.id === 0), 10000, 50)),
       'SPEC-SYNC-019 : l\'extinction du feu est diffusée (BLOC vide)');
    ok(surCase(b.client).some(m => m.id === B.FEU && m.etat >= 1) && surCase(b.client).some(m => m.id === 0),
       'SPEC-SYNC-019 : Bob, à portée, reçoit lui aussi le vieillissement puis l\'extinction, sans action de sa part');
    a.client.fermer(); b.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── SPEC-ARCHI-034 : gardien de donjon ──────────────────────────────────────
async function scenarioGardien() {
  const d = dossierTemp('mc-env-gard-');
  try {
    // graine 344 : la hutte de sorcière (petit donjon) du test SPEC-DONJON-017, gardien = boss_sorciere
    const f = fichierMonde(d, { graine: 344, heure: DL * 0.3 });
    const s = await demarrer(args(f, d, ['--graine', '344']), { MC_TEST_SPAWN: '219.5,37,-64.5', MC_MODE: 'survie' });
    const a = await rejoindre(s.port, 'Aventurier', 1);
    const boss = await attendreQue(() => { const e = a.client.dernier('etat'); return e && (e.mobs || []).find(m => MC.EntitySpecs[m.t] && MC.EntitySpecs[m.t].boss); }, 10000, 100);
    ok(!!boss, 'SPEC-ARCHI-034 : entrer dans un donjon éveille son gardien — par le serveur', JSON.stringify(boss));
    ok(!!(await attendreQue(() => chatContient(a.client, /s'éveille/), 3000)), 'SPEC-ARCHI-034 : le serveur annonce son éveil');
    a.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── SPEC-ARCHI-035 : fabrication ────────────────────────────────────────────
async function scenarioCraft() {
  const d = dossierTemp('mc-env-craft-');
  try {
    const I = MC.Core.I;
    const f = fichierMonde(d, { heure: DL * 0.3 });
    const seed = JSON.stringify([[MC.Core.B.PLANKS, 3], [I.STICK, 2]]);
    const s = await demarrer(args(f, d), { MC_TEST_INV: seed });      // solo fermé : ni --ouvert ni --serveur
    const a = await rejoindre(s.port, 'Artisan', 1);
    const pile = (c) => (c && c !== 0) ? { id: c[0], n: c[1] } : null;
    const compte = (inv, id) => inv.reduce((n, c) => { const p = pile(c); return n + (p && p.id === id ? p.n : 0); }, 0);
    const init = await a.client.attendre('inv_maj', 4000);
    eq(compte(init.inv, MC.Core.B.PLANKS), 3, 'SPEC-ARCHI-035 : l\'inventaire du solo fermé est celui du serveur (3 planches)');
    let seq = 0;
    async function verser(id, n, cases) {
      for (const g of cases) {
        const majI = a.client.messages.filter(m => m.t === 'inv_maj').pop();
        const i = majI.inv.findIndex(c => { const p = pile(c); return p && p.id === id; });
        a.client.envoyer({ t: 'cont_transfert', j: 0, seq: ++seq, de: { z: 'inv', i }, vers: { z: 'grille', i: g }, n: 1 });
        await a.client.attendre('inv_maj', 4000, m => m.ack === seq);
      }
    }
    // pioche en bois : trois planches en haut, deux bâtons au centre
    await verser(MC.Core.B.PLANKS, 3, [0, 1, 2]);
    await verser(I.STICK, 2, [4, 7]);
    a.client.envoyer({ t: 'craft', j: 0, seq: ++seq, fois: 1 });
    const maj = await a.client.attendre('inv_maj', 4000, m => m.ack === seq);
    ok(!maj.refus || !maj.refus.length, 'SPEC-ARCHI-035 : le craft est accepté par le serveur', JSON.stringify(maj.refus));
    eq(compte(maj.inv, I.WOOD_PICKAXE), 1, 'SPEC-ARCHI-035 : la pioche est ajoutée à l\'inventaire par INV_MAJ');
    ok(maj.grille.every(c => !pile(c)), 'SPEC-ARCHI-035 : les ingrédients sont retirés de la grille serveur', JSON.stringify(maj.grille));
    eq(compte(maj.inv, MC.Core.B.PLANKS), 0, 'SPEC-ARCHI-035 : et les planches ne sont plus en double dans le sac');
    a.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

const SCENARIOS = { sommeil: scenarioSommeil, heure: scenarioHeure, tornade: scenarioTornade, foudre: scenarioFoudre,
  habitants: scenarioHabitants, apparitions: scenarioApparitions, cultures: scenarioCultures, culturesDeux: scenarioCulturesDeux, feu: scenarioFeu, gardien: scenarioGardien, craft: scenarioCraft };

(async function () {
  const demande = process.argv[2];
  const liste = demande ? [demande] : Object.keys(SCENARIOS);
  for (const nom of liste) {
    if (!SCENARIOS[nom]) { console.error('scénario inconnu : ' + nom); process.exit(2); }
    try { await SCENARIOS[nom](); }
    catch (e) { ok(false, 'scénario « ' + nom + ' » sans exception', e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)); }
    finally { await arreterTout(); }
  }
  const code = R.fin();
  await arreterTout();
  process.exit(code);
})();
