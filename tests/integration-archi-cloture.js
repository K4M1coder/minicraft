/* integration-archi-cloture.js — clôture du chantier « solo = serveur
   toujours présent » (L50), sur de vrais processus server.js :
   - SPEC-ARCHI-020 : écran partagé en mode fermé — la pause porte sur le
     POSTE (déclenchée par le joueur 2, j=1), les deux joueurs et l'heure sont
     gelés, la reprise rend les deux joueurs actifs ; le compteur de dormeurs
     traverse la pause (un couché avant, l'autre après : la nuit passe) ; un
     joueur mort juste avant la pause (rien ne peut tuer pendant la pause, le monde est gelé)
     reste mort pendant la pause et renaît normalement après.
   - SPEC-SYNC-020 : un joueur qui se déconnecte puis revient sous le même nom,
     sur le même serveur sans redémarrage, retrouve dans BIENVENUE (et
     l'INV_MAJ qui la suit) l'état exact laissé : position, regard, vie, faim,
     air, inventaire, équipement, point de réapparition.
   - SPEC-SYNC-024 : l'état complet des relations de faction (PNJ entre elles,
     factions de joueurs envers les PNJ) part juste après BIENVENUE (message
     POLITIQUE) : un client qui rejoint après plusieurs jours de simulation
     politique reçoit les mêmes relations qu'un client déjà connecté, sans
     rien attendre du chat.
   - SPEC-MECA-006 (bogue ancien) : une porte ouverte à la main n'est plus
     refermée par le tic de circuits suivant ; un levier actionné ouvre
     toujours une porte (témoin : les circuits tournent bien).
   Chaque scénario lance ET arrête son serveur ; attentes bornées par sondage,
   jamais de délai fixe. Usage : node tests/integration-archi-cloture.js */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre, requete, attendreClients } = A;
const R = A.creerRapport('Intégration ARCHI — clôture L50 : écran partagé, reconnexion, factions au join, portes');
const { ok, eq } = R;

const MC = A.chargerModules();
const B = MC.Core.B, I = MC.Core.I;
const DL = MC.DayCycle.DAY_LENGTH;
const NUIT = DL * 0.75;
const SLOTS = MC.ContratsV2.BORNES.SLOTS_INV;
const GRAINE = 20260921;
const serveurs = [];
async function demarrer(args, env) {
  const s = await lancer(['--port', '0'].concat(args || []), env);
  serveurs.push(s);
  return s;
}

// ── outils ───────────────────────────────────────────────────────────────────
/* Sondage borné : rend la première valeur non fausse de `lire()`, ou null. */
async function jusqua(lire, ms, pas) {
  const fin = Date.now() + (ms || 5000);
  for (;;) {
    const v = lire();
    if (v) return v;
    if (Date.now() > fin) return null;
    await dodo(pas || 40);
  }
}
/* Sondage borné d'une fonction asynchrone. */
async function jusquaAsync(lire, ms, pas) {
  const fin = Date.now() + (ms || 5000);
  for (;;) {
    const v = await lire();
    if (v) return v;
    if (Date.now() > fin) return null;
    await dodo(pas || 60);
  }
}
/* Observation bornée d'un invariant pendant `ms` : vrai s'il tient tout du long. */
async function observer(ms, invariant) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (!(await invariant())) return false; await dodo(40); }
  return true;
}
const etatToi = (cl, j) => { const e = cl.dernier('etat'); return e && e.toi && e.toi[j || 0]; };
const heureJeu = (cl) => { const e = cl.dernier('etat'); return e ? e.heure : null; };
/* Attend `secs` secondes de TEMPS DE JEU (l'heure des ETAT avance). */
async function attendreJeu(cl, secs, ms) {
  const h0 = await jusqua(() => heureJeu(cl), 3000);
  if (h0 === null) return false;
  return !!(await jusqua(() => heureJeu(cl) - h0 >= secs, ms || 20000, 20));
}
async function etatMonde(port) {
  const r = await requete(port, '/api/parties');
  return r.json && r.json.monde;
}
/* Les joueurs locaux ne bougent plus : deux ETAT successifs (≥ 250 ms d'écart) aux mêmes positions. */
async function attendreImmobiles(cl, n, ms) {
  return !!(await jusquaAsync(async () => {
    const a = cl.dernier('etat');
    if (!a) return false;
    await dodo(250);
    const b = cl.dernier('etat');
    if (!b || b === a) return false;
    for (let j = 0; j < n; j++) {
      if (!a.toi[j] || !b.toi[j] || Math.abs(a.toi[j].x - b.toi[j].x) > 1e-6 || Math.abs(a.toi[j].y - b.toi[j].y) > 1e-6 || Math.abs(a.toi[j].z - b.toi[j].z) > 1e-6) return false;
    }
    return true;
  }, ms || 12000, 10));
}
function casesInv(piles) {
  const cases = new Array(SLOTS).fill(0);
  (piles || []).forEach((p, i) => { cases[i] = p; });
  return cases;
}
function fichierMonde(dossier, extra) {
  const f = path.join(dossier, 'monde.json');
  fs.writeFileSync(f, JSON.stringify(Object.assign({ v: 2, graine: GRAINE, heure: 60, overrides: [], etats: [], crops: [] }, extra || {})));
  return f;
}
const args = (f, d, plus) => ['--monde', f, '--dossier-parties', d].concat(plus || []);
function compte(inv, id) { return (inv || []).reduce((n, c) => n + (c && c[0] === id ? c[1] : 0), 0); }
const memesNombres = (a, b, tol) => Math.abs(a - b) <= tol;

// ── SPEC-ARCHI-020 : pause du POSTE et compteur de dormeurs à deux joueurs locaux ─
async function scenarioEcranPartageSommeil() {
  const d = A.dossierTemp('mc-clot-ep-');
  try {
    const f = fichierMonde(d, { heure: NUIT });
    const s = await demarrer(args(f, d), { MC_MODE: 'survie' });
    const { client: cl, bienvenue } = await rejoindre(s.port, 'Duo', 2);
    eq((bienvenue.toi || []).length, 2, 'préparation : un seul poste, deux joueurs locaux');
    ok(await attendreImmobiles(cl, 2), 'préparation : les deux joueurs locaux sont posés au sol');

    // le joueur 1 se couche : un dormeur sur deux, la nuit ne passe pas
    const depuisCoucher = cl.depuis();
    cl.envoyer({ t: 'dormir', j: 0, actif: true });
    const attente = await cl.attendre('chat', 4000, m => /\(1\/2\)/.test(m.texte || '')).catch(() => null);
    ok(!!attente, 'SPEC-ARCHI-020 : le joueur 1 couché, le serveur compte 1 dormeur sur 2 joueurs locaux', attente && attente.texte);
    ok(await attendreJeu(cl, 1.5), 'préparation : le temps de jeu avance (vérification du sommeil à 1 Hz)');
    ok(heureJeu(cl) < DL && !depuisCoucher('chat').some(m => /jour se lève/i.test(m.texte || '')),
       'SPEC-ARCHI-020 : un seul couché sur deux joueurs locaux, la nuit ne passe pas', String(heureJeu(cl)));

    // la pause est déclenchée par le JOUEUR 2 (j=1) : c'est tout le poste qui s'arrête
    const avant = cl.dernier('etat');
    const toiAvant = avant.toi.map(t => ({ x: t.x, y: t.y, z: t.z, s: t.s }));
    cl.envoyer({ t: 'pause', actif: true, j: 1 });
    const p1 = await cl.attendre('pause_etat', 3000, m => m.actif === true).catch(() => null);
    ok(!!p1, 'SPEC-ARCHI-020 : PAUSE envoyée par le joueur 2 (j=1) → le poste entier est en pause');
    const m0 = await etatMonde(s.port);
    ok(m0 && m0.pause === true, 'SPEC-ARCHI-020 : le serveur est en pause (pause du POSTE, pas d\'un joueur)');
    const pendant = cl.depuis();
    // les deux joueurs essaient d'avancer pendant la pause : sans effet
    for (let i = 1; i <= 40; i++) for (let j = 0; j < 2; j++) cl.envoyer({ t: 'e', s: 5000 + i, j, dt: 0.016, k: 1, yaw: 0, pitch: 0, v: 0 });
    const gele = await observer(2000, async () => { const m = await etatMonde(s.port); return m && Math.abs(m.heure - m0.heure) < 0.02; });
    ok(gele, 'SPEC-ARCHI-020 : l\'heure du monde ne bouge pas pendant 2 s de pause');
    ok(pendant('etat').length <= 1, 'SPEC-ARCHI-020 : aucun ETAT diffusé pendant la pause', 'ETAT ' + pendant('etat').length);

    // reprise (toujours par le joueur 2) : positions et heure intactes, puis les deux joueurs rejouent
    cl.envoyer({ t: 'pause', actif: false, j: 1 });
    const p2 = await cl.attendre('pause_etat', 3000, m => m.actif === false).catch(() => null);
    ok(!!p2, 'SPEC-ARCHI-020 : la reprise demandée par le joueur 2 reprend le poste');
    const reprise = p2 && await cl.attendre('etat', 3000, m => cl.messages.indexOf(m) > cl.messages.indexOf(p2)).catch(() => null);
    ok(!!reprise, 'préparation : un ETAT suit la reprise');
    if (reprise) {
      ok(reprise.toi.every((t, j) => Math.hypot(t.x - toiAvant[j].x, t.z - toiAvant[j].z) < 0.05 && Math.abs(t.y - toiAvant[j].y) < 0.05),
         'SPEC-ARCHI-020 : les positions des DEUX joueurs locaux sont inchangées après la pause',
         JSON.stringify(reprise.toi.map(t => [t.x, t.y, t.z])) + ' vs ' + JSON.stringify(toiAvant));
      ok(reprise.toi.every(t => t.s < 5000), 'SPEC-ARCHI-020 : aucune entrée envoyée pendant la pause n\'a été jouée (j=0 et j=1)', JSON.stringify(reprise.toi.map(t => t.s)));
      const dh = reprise.heure - avant.heure;
      ok(dh >= -0.1 && dh < 0.5, 'SPEC-ARCHI-020 : l\'heure n\'a pas avancé pendant la pause (pas de rattrapage)', 'écart ' + dh.toFixed(3) + ' s');
    }
    // les deux joueurs locaux redeviennent actifs (entrées immobiles : le dormeur ne se lève pas)
    let seq = 9000;
    for (let i = 0; i < 20; i++) { for (let j = 0; j < 2; j++) cl.envoyer({ t: 'e', s: ++seq, j, dt: 0.016, k: 0, yaw: 0, pitch: 0, v: 0 }); await dodo(16); }
    const actifs = await jusqua(() => { const e = cl.dernier('etat'); return e && e.toi.every(t => t.s > 9000) ? e : null; }, 4000);
    ok(!!actifs, 'SPEC-ARCHI-020 : après la reprise, les deux joueurs locaux (j=0 et j=1) sont de nouveau joués par le serveur', JSON.stringify((cl.dernier('etat') || { toi: [] }).toi.map(t => t.s)));

    // le dormeur couché AVANT la pause compte toujours : le joueur 2 se couche APRÈS la reprise → la nuit passe
    const depuisJ2 = cl.depuis();
    cl.envoyer({ t: 'dormir', j: 1, actif: true });
    const leve = await cl.attendre('chat', 5000, m => /jour se lève/i.test(m.texte || '') && depuisJ2('chat').indexOf(m) >= 0).catch(() => null);
    ok(!!leve, 'SPEC-ARCHI-020 : un couché avant la pause, l\'autre après la reprise → 2/2 dormeurs, la nuit passe');
    ok(!!(await jusqua(() => heureJeu(cl) >= DL, 5000)), 'SPEC-ARCHI-020 : l\'heure saute à l\'aube du jour suivant', String(heureJeu(cl)));
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── SPEC-ARCHI-020 : un joueur local mort JUSTE AVANT la pause (la pause gèle tout, on n'y meurt pas) reste mort pendant la pause et renaît après la reprise ─
async function scenarioEcranPartageMort() {
  const d = A.dossierTemp('mc-clot-em-');
  try {
    // le joueur 2 (duo#1) commence à 1 PV et affamé : la famine l'achève en difficulté normale
    const rec2 = { v: 1, inv: casesInv(), equip: {}, etat: { hp: 1, hunger: 0, air: 10 } };
    const f = fichierMonde(d, { joueurs: [[MC.ContratsV2.cleRegistre('Duo', 1), rec2]] });
    const s = await demarrer(args(f, d), { MC_MODE: 'survie', MC_DIFFICULTE: 'normal' });
    const { client: cl, bienvenue } = await rejoindre(s.port, 'Duo', 2);
    ok(bienvenue.toi[1].pv === 1 && bienvenue.toi[0].pv === 20, 'préparation : joueur 2 à 1 PV (registre), joueur 1 en pleine santé', JSON.stringify(bienvenue.toi.map(t => t.pv)));
    const mort = await jusqua(() => { const e = etatToi(cl, 1); return e && e.mort === 1 ? e : null; }, 25000);
    ok(!!mort, 'préparation : le joueur 2 meurt de faim sur le serveur');
    const vivant1 = etatToi(cl, 0);

    cl.envoyer({ t: 'pause', actif: true, j: 1 });
    await cl.attendre('pause_etat', 3000, m => m.actif === true);
    const m0 = await etatMonde(s.port);
    const gele = await observer(1500, async () => { const m = await etatMonde(s.port); return m && m.pause === true && Math.abs(m.heure - m0.heure) < 0.02; });
    ok(gele, 'SPEC-ARCHI-020 : le poste reste gelé avec un joueur local mort juste avant la pause');
    cl.envoyer({ t: 'pause', actif: false, j: 1 });
    const p2 = await cl.attendre('pause_etat', 3000, m => m.actif === false);
    const apres = await cl.attendre('etat', 3000, m => cl.messages.indexOf(m) > cl.messages.indexOf(p2)).catch(() => null);
    ok(apres && apres.toi[1].mort === 1, 'SPEC-ARCHI-020 : après la reprise, le joueur 2 est toujours mort (rien n\'a été rejoué pendant la pause)');
    ok(apres && apres.toi[0].mort === 0 && Math.hypot(apres.toi[0].x - vivant1.x, apres.toi[0].z - vivant1.z) < 0.05,
       'SPEC-ARCHI-020 : le joueur 1 n\'est affecté ni par la mort du joueur 2 ni par la pause');
    // la renaissance de chaque joueur local (equipe.forEach(net.renaitre)) n'est pas modifiée par la pause
    cl.envoyer({ t: 'renaitre', j: 1 });
    const rene = await jusqua(() => { const e = etatToi(cl, 1); return e && e.mort === 0 ? e : null; }, 6000);
    ok(!!rene, 'SPEC-ARCHI-020 : le joueur mort renaît normalement après la reprise');
    ok(rene && rene.pv === 20 && rene.faim === 20, 'SPEC-ARCHI-020 : il renaît avec vie et faim pleines, remises par le serveur', rene && JSON.stringify([rene.pv, rene.faim]));
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── SPEC-SYNC-020 : l'état du joueur survit à une déconnexion/reconnexion ─────
async function scenarioReconnexion() {
  const d = A.dossierTemp('mc-clot-rc-');
  try {
    // une partie solo importée : son joueur (vie 13, faim 9, un casque et du bois) est adopté par « Reco »
    const solo = { v: 1, inv: casesInv([[B.LOG, 5], [I.CUIR_CASQUE, 1]]), equip: {}, etat: { hp: 13, hunger: 9, air: 10 } };
    const f = fichierMonde(d, { heure: NUIT, soloJoueur: solo });
    const s = await demarrer(args(f, d), { MC_MODE: 'survie', MC_DIFFICULTE: 'paisible' });
    const pid0 = (await etatMonde(s.port)).pid;
    const a = await rejoindre(s.port, 'Reco', 1);
    const inv0 = await a.client.attendre('inv_maj', 3000);
    eq(compte(inv0.inv, I.CUIR_CASQUE), 1, 'préparation : le casque est dans l\'inventaire');
    ok(await attendreImmobiles(a.client, 1), 'préparation : le joueur est posé au sol');
    const dep = etatToi(a.client, 0);

    // un lit à portée, puis on dort : le point de réapparition est fixé sur ce lit (par le serveur)
    const lit = { x: Math.floor(dep.x) + 1, y: Math.floor(dep.y) + 2, z: Math.floor(dep.z) };
    a.client.envoyer({ t: 'bloc', x: lit.x, y: lit.y, z: lit.z, id: B.LIT, j: 0, i: 0 });
    const pose = await a.client.attendre('bloc', 3000, m => m.x === lit.x && m.y === lit.y && m.z === lit.z).catch(() => null);
    ok(pose && pose.id === B.LIT, 'préparation : le lit est posé');
    a.client.envoyer({ t: 'dormir', j: 0, actif: true });
    ok(!!(await a.client.attendre('chat', 5000, m => /jour se lève/i.test(m.texte || '')).catch(() => null)), 'préparation : la nuit passe, la réapparition est fixée au lit');
    const spawnAttendu = { x: lit.x + 0.5, y: lit.y + 1.05, z: lit.z + 0.5 };

    // équiper le casque (l'inventaire et l'équipement changent)
    const iCasque = inv0.inv.findIndex(c => c && c[0] === I.CUIR_CASQUE);
    a.client.envoyer({ t: 'equip', j: 0, seq: 1, slot: 'casque', i: iCasque });
    const eqMaj = await a.client.attendre('inv_maj', 3000, m => m.ack === 1).catch(() => null);
    ok(eqMaj && eqMaj.equip.casque && eqMaj.equip.casque[0] === I.CUIR_CASQUE, 'préparation : le casque est équipé');

    // marcher puis s'arrêter, le regard tourné : la position et le regard changent
    const YAW = 1.234, PITCH = -0.456;
    let seq = 0;
    for (let i = 0; i < 40; i++) { a.client.envoyer({ t: 'e', s: ++seq, j: 0, dt: 0.016, k: 1, yaw: YAW, pitch: PITCH, v: 0 }); await dodo(16); }
    for (let i = 0; i < 10; i++) { a.client.envoyer({ t: 'e', s: ++seq, j: 0, dt: 0.016, k: 0, yaw: YAW, pitch: PITCH, v: 0 }); await dodo(16); }
    ok(!!(await jusqua(() => { const e = etatToi(a.client, 0); return e && e.s === seq; }, 4000)), 'préparation : le serveur a joué toutes les entrées');
    ok(await attendreImmobiles(a.client, 1), 'préparation : le joueur s\'est arrêté');
    // la partie est mise en pause avant le départ : l'état laissé est exactement celui du dernier ETAT
    a.client.envoyer({ t: 'pause', actif: true });
    await a.client.attendre('pause_etat', 3000, m => m.actif === true);
    const laisse = etatToi(a.client, 0);
    ok(Math.hypot(laisse.x - dep.x, laisse.z - dep.z) > 0.5, 'préparation : le joueur a bougé avant de partir', JSON.stringify([dep.x, dep.z, laisse.x, laisse.z]));
    ok(laisse.pv === 13 && laisse.faim === 9, 'préparation : vie et faim de la partie importée (13, 9)', JSON.stringify([laisse.pv, laisse.faim]));
    a.client.fermer();
    ok(await attendreClients(s.port, 0), 'préparation : le serveur a constaté le départ');

    // retour sous le même nom, sur le même serveur (aucun redémarrage)
    const b = await rejoindre(s.port, 'Reco', 1);
    eq((await etatMonde(s.port)).pid, pid0, 'SPEC-SYNC-020 : même processus serveur (aucun redémarrage)');
    const t = b.bienvenue.toi[0];
    ok(memesNombres(t.x, laisse.x, 0.01) && memesNombres(t.y, laisse.y, 0.01) && memesNombres(t.z, laisse.z, 0.01),
       'SPEC-SYNC-020 : BIENVENUE rend la position laissée à la déconnexion', JSON.stringify([t.x, t.y, t.z, laisse.x, laisse.y, laisse.z]));
    ok(memesNombres(t.yaw, YAW, 0.001) && memesNombres(t.pitch, PITCH, 0.001),
       'SPEC-SYNC-020 : BIENVENUE rend le regard (yaw/pitch) laissé', JSON.stringify([t.yaw, t.pitch]));
    ok(t.pv === laisse.pv && t.faim === laisse.faim && t.air === laisse.air,
       'SPEC-SYNC-020 : BIENVENUE rend la vie, la faim et l\'air laissés', JSON.stringify([t.pv, t.faim, t.air, laisse.pv, laisse.faim, laisse.air]));
    ok(t.spawn && memesNombres(t.spawn.x, spawnAttendu.x, 0.01) && memesNombres(t.spawn.y, spawnAttendu.y, 0.01) && memesNombres(t.spawn.z, spawnAttendu.z, 0.01),
       'SPEC-SYNC-020 : BIENVENUE rend le point de réapparition (le lit)', JSON.stringify([t.spawn, spawnAttendu]));
    const inv1 = await b.client.attendre('inv_maj', 3000);
    ok(inv1.equip.casque && inv1.equip.casque[0] === I.CUIR_CASQUE && compte(inv1.inv, I.CUIR_CASQUE) === 0,
       'SPEC-SYNC-020 : l\'équipement est retrouvé (casque porté, plus dans l\'inventaire)');
    eq(compte(inv1.inv, B.LOG), 5, 'SPEC-SYNC-020 : l\'inventaire est retrouvé');
    b.client.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── SPEC-SYNC-024 : les relations de faction partent au join ─────────────────
/* L'état qu'un client rebâtit de TOUS les POLITIQUE reçus (complet au join,
   différences ensuite), comme game.js : MC.Politique.appliquerReseau. */
function etatPolitique(cl) {
  let etat = null, guildes = null, moi = null;
  cl.messages.filter(m => m.t === 'politique').forEach(m => {
    if (m.pol) etat = MC.Politique.appliquerReseau(etat, m.pol);
    if (m.guildes) guildes = m.guildes;
    if (m.moi) moi = m.moi;
  });
  return etat && { etat, guildes, moi };
}
function signature(e) {
  if (!e) return null;
  const rel = [];
  e.etat.relations.forEach((r, k) => rel.push(k + '=' + r));
  return JSON.stringify([e.etat.jour, Array.from(e.etat.factions.keys()), rel.sort(), e.guildes]);
}
async function scenarioFactions() {
  const d = A.dossierTemp('mc-clot-fa-');
  try {
    // des factions PNJ nées de quelques lieux, jamais simulées (jour 0) ; le monde est au 4e jour, de nuit
    const P = MC.Politique, pol = P.creer(GRAINE);
    P.decouvrir(pol, [{ id: 'v1', kind: 'ville', x: 0, z: 0, nom: 'Alpha' }, { id: 'v2', kind: 'megapole', x: 400, z: 0, nom: 'Beta' },
      { id: 'v3', kind: 'ville', x: -400, z: 100, nom: 'Gamma' }, { id: 'k1', kind: 'volcan', x: 900, z: 0, nom: 'Feu' }]);
    const f = fichierMonde(d, { heure: 4 * DL + NUIT, politique: P.serialiser(pol) });
    const s = await demarrer(args(f, d, ['--ouvert']), { MC_MODE: 'survie' });
    const a = await rejoindre(s.port, 'Ana', 1);
    const iBienvenueA = a.client.messages.indexOf(a.bienvenue);
    const polA0 = await a.client.attendre('politique', 3000).catch(() => null);
    ok(!!polA0 && a.client.messages.indexOf(polA0) > iBienvenueA && polA0.pol && polA0.pol.complet === 1 && polA0.moi === 'Ana',
       'SPEC-SYNC-024 : POLITIQUE complet suit BIENVENUE à la connexion, avec le nom que le serveur connaît');
    // une socket qui n'a pas rejoint ne reçoit rien de la politique
    const espion = await A.connecter(s.port);
    // (le rattrapage est borné à un jour par entretien du monde : SPEC-FACTION-007, d'où des bornes d'attente larges)
    // plusieurs jours de simulation politique : le serveur rattrape les jours 0 → 4, puis la nuit passe (jour 5)
    ok(!!(await jusqua(() => { const e = etatPolitique(a.client); return e && e.etat.jour === 4; }, 20000)),
       'SPEC-SYNC-024 : le client connecté apprend les jours de simulation rattrapés (jour 4)');
    a.client.envoyer({ t: 'dormir', j: 0, actif: true });
    ok(!!(await jusqua(() => { const e = etatPolitique(a.client); return e && e.etat.jour === 5; }, 20000)),
       'SPEC-SYNC-024 : la journée simulée suivante est diffusée au client déjà connecté (jour 5)');
    const apresJour = a.client.messages.filter(m => m.t === 'politique').slice(1);
    ok(apresJour.length >= 1 && apresJour.every(m => !m.pol || !m.pol.complet), 'SPEC-SYNC-024 : après le join, seules des différences sont diffusées');
    // une faction de joueurs se déclare ennemie d'une faction PNJ
    const cible = 'royaume:v1';
    a.client.envoyer({ t: 'chat', texte: '/faction creer Lions' });
    await a.client.attendre('chat', 3000, m => /Lions/.test(m.texte || ''));
    a.client.envoyer({ t: 'chat', texte: '/faction relation Lions ' + cible + ' ennemie' });
    const rep = await a.client.attendre('chat', 3000, m => /ennemie|Faction :/.test(m.texte || '')).catch(() => null);
    ok(rep && /se déclare ennemie/.test(rep.texte), 'préparation : la faction de joueurs se déclare ennemie d\'un royaume PNJ (arbitré par le serveur)', rep && rep.texte);
    const avecLions = (e) => e && e.guildes && e.guildes.factions.some(([, g]) => g.nom === 'Lions' && g.relations.some(([c, r]) => c === cible && r === 'ennemie'));
    ok(!!(await jusqua(() => avecLions(etatPolitique(a.client)), 4000)), 'SPEC-SYNC-024 : la relation de la faction de joueurs est diffusée au client déjà connecté');
    ok(!espion.messages.some(m => m.t === 'politique'), 'SPEC-SYNC-024 : une socket qui n\'a pas rejoint ne reçoit pas POLITIQUE');
    espion.fermer();

    // un second joueur rejoint : il reçoit TOUT l'état, sans rien attendre du chat
    const b = await rejoindre(s.port, 'Bea', 1);
    const iBienvenueB = b.client.messages.indexOf(b.bienvenue);
    const polB = await b.client.attendre('politique', 3000).catch(() => null);
    ok(!!polB && polB.pol && polB.pol.complet === 1, 'SPEC-SYNC-024 : le nouveau venu reçoit POLITIQUE complet');
    if (polB) {
      const entre = b.client.messages.slice(iBienvenueB + 1, b.client.messages.indexOf(polB)).map(m => m.t);
      ok(entre.indexOf('etat') < 0 && entre.indexOf('chat') < 0, 'SPEC-SYNC-024 : POLITIQUE part aussitôt après BIENVENUE (avant tout ETAT ou CHAT)', JSON.stringify(entre));
      const eb = etatPolitique(b.client);
      eq(eb.etat.jour, 5, 'SPEC-SYNC-024 : le nouveau venu connaît le jour politique courant');
      ok(eb.etat.factions.size >= 4 && eb.etat.relations.size >= 3, 'SPEC-SYNC-024 : toutes les factions PNJ et leurs relations', eb.etat.factions.size + ' factions, ' + eb.etat.relations.size + ' relations non neutres');
      ok(avecLions(eb), 'SPEC-SYNC-024 : la relation de la faction de joueurs envers le PNJ est reçue au join');
      const lions = eb.guildes.factions.find(([, g]) => g.nom === 'Lions');
      ok(!!lions && P.relationEntre(eb.etat, lions[0], cible) === 'guerre',
         'SPEC-SYNC-024 : et la relation est aussi posée côté PNJ (guerre), sur la même échelle que les relations PNJ↔PNJ');
      // même état que le client déjà connecté (une diffusion arrivée entre-temps est attendue chez les deux)
      const pareil = await jusqua(() => {
        const sa = signature(etatPolitique(a.client)), sb = signature(etatPolitique(b.client));
        return sa && sa === sb;
      }, 4000);
      ok(!!pareil, 'SPEC-SYNC-024 : le nouveau venu a exactement les mêmes relations que le client déjà connecté');
    }
    a.client.fermer(); b.client.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── SPEC-MECA-006 : une porte ouverte à la main n'est pas refermée par les circuits ─
async function scenarioPortes() {
  const d = A.dossierTemp('mc-clot-po-');
  try {
    const f = fichierMonde(d, {});
    const s = await demarrer(args(f, d), { MC_MODE: 'survie' });
    const { client: cl } = await rejoindre(s.port, 'Portier', 1);
    ok(await attendreImmobiles(cl, 1), 'préparation : le joueur est posé au sol');
    const p = etatToi(cl, 0);
    const bx = Math.floor(p.x), by = Math.floor(p.y) + 3, bz = Math.floor(p.z);
    async function poser(x, y, z, id, etat) {
      cl.envoyer({ t: 'bloc', x, y, z, id, j: 0, i: 0, etat: etat || 0 });
      return cl.attendre('bloc', 3000, m => m.x === x && m.y === y && m.z === z && m.id === id).catch(() => null);
    }
    // témoin : un levier ACTIONNÉ à côté d'une porte fermée l'ouvre (les circuits du serveur tournent)
    ok(!!(await poser(bx + 2, by, bz, B.PORTE_FERMEE_N)), 'préparation : porte témoin posée');
    const vu = cl.depuis();
    // un levier se pose relâché (l'état est celui du serveur, SPEC-MECA-008) puis s'actionne (ACTIONNER, SPEC-MECA-005)
    ok(!!(await poser(bx + 3, by, bz, B.LEVIER_CIRCUIT)), 'préparation : levier posé à côté');
    cl.envoyer({ t: 'actionner', j: 0, x: bx + 3, y: by, z: bz });
    ok(!!(await jusqua(() => vu('bloc').find(m => m.x === bx + 3 && m.y === by && m.z === bz && m.etat === 1), 3000)), 'préparation : levier actionné');
    const ouverte = await jusqua(() => vu('bloc').find(m => m.x === bx + 2 && m.y === by && m.z === bz && m.id === B.PORTE_OUVERTE_N), 3000);
    ok(!!ouverte, 'SPEC-MECA-006 : témoin — le signal d\'un levier actionné ouvre la porte voisine (circuits du serveur actifs)');
    // l'état d'une porte posée n'est jamais celui du client : un « signal déjà vu » annoncé (etat 1) est ignoré
    const vu2 = cl.depuis();
    cl.envoyer({ t: 'bloc', x: bx + 4, y: by, z: bz, id: B.PORTE_FERMEE_N, j: 0, i: 0, etat: 1 });
    const echo = await cl.attendre('bloc', 3000, m => m.x === bx + 4 && m.y === by && m.z === bz && m.id === B.PORTE_FERMEE_N).catch(() => null);
    ok(echo && echo.etat === 0, 'SPEC-MECA-006 : le serveur pose la porte avec SON état (0), pas celui annoncé par le client', echo && JSON.stringify(echo));
    const ouverte2 = await jusqua(() => vu2('bloc').find(m => m.x === bx + 4 && m.y === by && m.z === bz && m.id === B.PORTE_OUVERTE_N), 3000);
    ok(!!ouverte2, 'SPEC-MECA-006 : posée contre un levier déjà actionné, la porte s\'ouvre au tic suivant (l\'état annoncé ne masque pas le signal)');

    // la porte ouverte à la main, loin de tout signal
    const px = bx - 2;
    ok(!!(await poser(px, by, bz, B.PORTE_FERMEE_N)), 'préparation : porte posée, fermée');
    const apres = cl.depuis();
    cl.envoyer({ t: 'bloc', x: px, y: by, z: bz, id: B.PORTE_OUVERTE_N, j: 0 });
    const ouv = await cl.attendre('bloc', 3000, m => m.x === px && m.y === by && m.z === bz && m.id === B.PORTE_OUVERTE_N).catch(() => null);
    ok(!!ouv, 'préparation : la porte est ouverte à la main (bascule acceptée par le serveur)');
    ok(await attendreJeu(cl, 1.5), 'préparation : 1,5 s de temps de jeu (au moins 7 tics de circuits)');
    ok(!apres('bloc').some(m => m.x === px && m.y === by && m.z === bz && m.id === B.PORTE_FERMEE_N),
       'SPEC-MECA-006 : aucun tic de circuits ne referme la porte ouverte à la main');
    cl.envoyer({ t: 'overrides_demande', cx: Math.floor(px / 16), cz: Math.floor(bz / 16) });
    const ov = await cl.attendre('overrides_chunk', 3000, m => m.cx === Math.floor(px / 16) && m.cz === Math.floor(bz / 16)).catch(() => null);
    const bloc = ov && ov.blocs.find(b2 => b2[0] === px && b2[1] === by && b2[2] === bz);
    ok(bloc && bloc[3] === B.PORTE_OUVERTE_N, 'SPEC-MECA-006 : pour le serveur, la porte est toujours ouverte', JSON.stringify(bloc));
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

(async () => {
  const filtre = process.argv[2];
  const scenarios = { portes: scenarioPortes, reconnexion: scenarioReconnexion, factions: scenarioFactions,
                      sommeil: scenarioEcranPartageSommeil, mort: scenarioEcranPartageMort };
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
