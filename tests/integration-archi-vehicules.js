/* integration-archi-vehicules.js — lot P-VEH du chantier « solo = serveur toujours
   présent » : SPEC-ARCHI-021 (le refus « véhicules non disponibles en ligne »
   disparaît : poser, monter, conduire, ouvrir la soute passent par le serveur local),
   SPEC-SYNC-022 (véhicule simulé par le serveur, répliqué aux clients à portée,
   même position et même soute pour tous) et SPEC-SERVEUR-006 (les véhicules
   survivent à un cycle sauvegarde/relance), sur de vrais processus server.js.

   Le monde de test est une dalle de pierre posée très haut (overrides du fichier
   de monde) : un terrain plat et dégagé, identique à chaque exécution.

   Usage : node tests/integration-archi-vehicules.js */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre, RACINE, NP } = A;
const R = A.creerRapport('Intégration ARCHI — P-VEH : véhicules simulés par le serveur');
const { ok, eq } = R;

const MC = A.chargerModules();
const I = MC.Core.I, B = MC.Core.B;
const V = MC.Vehicules;
const serveurs = [];
async function demarrer(args, env) {
  const s = await lancer(['--port', '0', '--graine', '20260921'].concat(args || []), env);
  serveurs.push(s);
  return s;
}
const SANS_POSE_LIBRE = { MC_TEST_POSE_LIBRE: '' };
const seed = (liste) => ({ MC_TEST_INV: JSON.stringify(liste) });

// ── monde de test : une dalle plate à y = 110, 61 × 61 blocs, ciel dégagé ─────
const Y_DALLE = 110;
function monde(extra) {
  const overrides = [];
  for (let x = -30; x <= 30; x++) for (let z = -30; z <= 30; z++) {
    overrides.push([x, Y_DALLE, z, B.STONE]);
    for (let y = Y_DALLE + 1; y <= Y_DALLE + 5; y++) overrides.push([x, y, z, 0]);
  }
  return Object.assign({ v: 2, graine: 20260921, heure: 60, overrides, etats: [], crops: [] }, extra || {});
}
const ENV_DALLE = { MC_TEST_SPAWN: '0.5,' + (Y_DALLE + 1) + ',0.5' };
const env = (plus) => Object.assign({}, ENV_DALLE, plus || {});

// ── outils ───────────────────────────────────────────────────────────────────
async function jusqua(lire, ms, pas) {
  const fin = Date.now() + (ms || 5000);
  for (;;) {
    const v = lire();
    if (v) return v;
    if (Date.now() > fin) return null;
    await dodo(pas || 30);
  }
}
const etat = (cl) => cl.dernier('etat');
const toi = (cl) => { const e = etat(cl); return e && e.toi && e.toi[0]; };
const mobVeh = (cl, eid) => { const e = etat(cl); return e && (e.mobs || []).find(m => m.e === eid && m.ve) || null; };
/* Attend un message de ce type reçu APRÈS l'appel (jamais un ancien de même nature). */
function prochain(cl, type, ms, pred) {
  const n = cl.messages.length;
  return cl.attendre(type, ms || 15000, m => cl.messages.indexOf(m) >= n && (!pred || pred(m))).catch(() => null);
}
const evt = (cl, nom, ms) => prochain(cl, 'vehicule_evt', ms, m => m.evt === nom);
const refus = (cl, motif, ms) => prochain(cl, 'vehicule_evt', ms, m => m.evt === 'refus' && (!motif || m.motif === motif));
/* La dalle sous les pieds de `cl` : cible d'une pose (bloc visé + normale vers le haut). */
function sousLesPieds(bienvenue, dx, dz) {
  const p = bienvenue.toi[0];
  return { x: Math.floor(p.x) + (dx || 0), y: Y_DALLE, z: Math.floor(p.z) + (dz || 0), nx: 0, ny: 1, nz: 0 };
}
function poser(cl, nom, cible, i) {
  cl.envoyer(Object.assign({ t: 'vehicule_poser', j: 0, nom, i: i === undefined ? -1 : i }, cible));
}
/* Pose un véhicule et rend son eid (lu dans ETAT.mobs), ou null. */
async function poserEtLire(cl, bienvenue, nom, dx, dz) {
  const avant = new Set(((etat(cl) && etat(cl).mobs) || []).filter(m => m.ve).map(m => m.e));
  const ev = prochain(cl, 'vehicule_evt', 4000, m => m.evt === 'pose' || m.evt === 'refus');
  poser(cl, nom, sousLesPieds(bienvenue, dx, dz));
  const r = await ev;
  if (!r || r.evt !== 'pose') return { eid: null, reponse: r };
  const m = await jusqua(() => ((etat(cl) && etat(cl).mobs) || []).find(x => x.ve === nom && !avant.has(x.e)), 3000);
  return { eid: m ? m.e : null, mob: m, reponse: r };
}
const TOUCHE = { avant: 1, arriere: 2, gauche: 4, droite: 8, saut: 16, course: 32 };
/* Un client honnête : une entrée de 50 ms toutes les 50 ms pendant `secondes`. */
async function conduire(cl, secondes, k, yaw) {
  cl.seqE = cl.seqE || 0;
  const n = Math.round(secondes / 0.05);
  for (let i = 0; i < n; i++) {
    cl.envoyer({ t: NP.MSG.ENTREE, s: ++cl.seqE, j: 0, dt: 0.05, k, yaw: yaw || 0, pitch: 0, v: 0 });
    await dodo(50);
  }
}
/* Le véhicule conduit s'est arrêté : deux relevés consécutifs identiques. */
async function attendreArret(cl, ms) {
  let prec = null;
  return jusqua(() => {
    const t = toi(cl); const e = etat(cl);
    if (!t || !t.veh) return null;
    const k = e.heure + '|' + t.veh.x + '|' + t.veh.z;
    const stable = prec && prec.heure !== e.heure && prec.x === t.veh.x && prec.z === t.veh.z && Math.abs(t.veh.vit) < 0.01;
    if (!prec || prec.k !== k) prec = { k, heure: e.heure, x: t.veh.x, z: t.veh.z };
    return stable ? t.veh : null;
  }, ms || 8000, 50);
}
const compte = (cases, id) => cases.reduce((n, c) => n + (c && c[0] === id ? c[1] : 0), 0);

// ── SPEC-ARCHI-021 / SPEC-SYNC-022 : poser, monter, conduire, plusieurs clients ──
async function scenarioConduite() {
  const d = A.dossierTemp('mc-veh-cd-');
  const f = path.join(d, 'monde.json');
  try {
    fs.writeFileSync(f, JSON.stringify(monde()));
    const s = await demarrer(['--ouvert', '--monde', f, '--dossier-parties', d], env());     // deux postes : le mode fermé n'en admet qu'un
    const a = await rejoindre(s.port, 'Alice', 1);
    const cl = a.client;
    await jusqua(() => toi(cl), 3000);

    // poser : le serveur crée l'entité, elle arrive dans ETAT.mobs avec ses champs de véhicule
    const p = await poserEtLire(cl, a.bienvenue, 'voiture');
    ok(!!p.eid, 'SPEC-ARCHI-021 : poser une voiture passe par le serveur local (évènement « pose » puis entité dans ETAT)', JSON.stringify(p.reponse));
    if (!p.eid) return;
    eq(p.mob.t, 'v_voiture', 'SPEC-SYNC-022 : l\'entité est de type v_voiture');
    ok(p.mob.vi === 0 && !p.mob.co, 'SPEC-SYNC-022 : au repos et libre à la pose');
    ok(Math.abs(p.mob.y - (Y_DALLE + 1)) < 0.2, 'posée sur la dalle (y = ' + p.mob.y + ')');

    // monter
    const monte = evt(cl, 'monte');
    cl.envoyer({ t: 'vehicule_monter', j: 0, eid: p.eid });
    const m = await monte;
    ok(!!m && m.nom === 'voiture', 'SPEC-ARCHI-021 : monter est accepté par le serveur (évènement « monte »)');
    const aBord = await jusqua(() => { const t = toi(cl); return t && t.veh && t.veh.eid === p.eid ? t : null; }, 3000);
    ok(!!aBord, 'SPEC-SYNC-022 : l\'état du joueur porte le véhicule conduit (toi.veh)');
    const occ = await jusqua(() => { const v = mobVeh(cl, p.eid); return v && v.co ? v : null; }, 3000);
    ok(!!occ, 'SPEC-SYNC-022 : le véhicule est annoncé occupé aux clients');

    // un deuxième client voit le même véhicule, et ne peut pas y monter
    const b = await rejoindre(s.port, 'Bob', 1);
    await jusqua(() => etat(b.client), 3000);
    const vuB = await jusqua(() => mobVeh(b.client, p.eid), 3000);
    ok(!!vuB, 'SPEC-SYNC-022 : un second client à portée voit le véhicule');
    const refusB = refus(b.client, 'occupe');
    b.client.envoyer({ t: 'vehicule_monter', j: 0, eid: p.eid });
    ok(!!(await refusB), 'SPEC-ARCHI-021 : un véhicule occupé refuse un second conducteur (motif « occupe »)');

    // conduire : touches « avant » pendant 2 s ; le serveur intègre
    const x0 = aBord.veh.x, z0 = aBord.veh.z;
    await conduire(cl, 1.2, TOUCHE.avant);
    // le serveur a traité toutes les entrées envoyées (toi.s) : on lit la position d'arrivée de la conduite
    const t1 = await jusqua(() => { const t = toi(cl); return t && t.veh && t.s >= cl.seqE ? t : null; }, 3000);
    ok(!!t1 && t1.veh.z < z0 - 3, 'SPEC-ARCHI-021 : conduire (touches envoyées, intégrées par le serveur) fait avancer la voiture');
    if (t1) {
      const dist = Math.hypot(t1.veh.x - x0, t1.veh.z - z0);
      ok(dist > 2 && dist < 0.5 * V.DEFS.voiture.accel * 1.5 * 1.5 + 1, 'distance plausible pour 1,2 s d\'accélération de 7 m/s² (' + dist.toFixed(1) + ' m)');
      ok(Math.abs(t1.veh.vit) <= V.DEFS.voiture.vmax + 1e-6, 'jamais au-delà de la vitesse maximale du modèle (' + t1.veh.vit.toFixed(1) + ' m/s)');
      ok(Math.abs(t1.x - t1.veh.x) < 1e-9 && Math.abs(t1.z - t1.veh.z) < 1e-9, 'le conducteur reste sur le siège (position du joueur = celle du véhicule)');
      ok(t1.veh.carb < V.DEFS.voiture.carburant, 'le carburant se consume à la distance parcourue (' + t1.veh.carb.toFixed(1) + '/' + V.DEFS.voiture.carburant + ')');
    }
    // à l'arrêt : deux clients, MÊME position (à l'arrondi du relevé près)
    await dodo(100);
    const arret = await attendreArret(cl, 10000);
    ok(!!arret, 'sans commande, le véhicule s\'arrête (le serveur l\'immobilise : conducteur muet)');
    if (arret) {
      const vA = await jusqua(() => { const v = mobVeh(cl, p.eid); return v && Math.abs(v.z - arret.z) < 0.01 ? v : null; }, 3000);
      const vB = await jusqua(() => { const v = mobVeh(b.client, p.eid); return v && Math.abs(v.z - arret.z) < 0.01 ? v : null; }, 3000);
      ok(!!vA && !!vB && Math.abs(vA.x - vB.x) < 0.01 && Math.abs(vA.z - vB.z) < 0.01,
         'SPEC-SYNC-022 : conducteur et spectateur voient le véhicule au même endroit (' + (vB ? vB.z : '?') + ' / ' + arret.z.toFixed(2) + ')');
    }

    // descendre : pied à terre ; Bob peut alors monter ; son départ libère le siège
    const desc = evt(cl, 'descend');
    cl.envoyer({ t: 'vehicule_descendre', j: 0 });
    ok(!!(await desc), 'SPEC-ARCHI-021 : descendre est accepté (évènement « descend »)');
    const pied = await jusqua(() => { const t = toi(cl); return t && !t.veh ? t : null; }, 3000);
    ok(!!pied, 'SPEC-SYNC-022 : à pied, l\'état du joueur ne porte plus de véhicule');
    // Bob marche jusqu'à la voiture arrêtée (à plus de six blocs de lui), puis y monte
    const vArret = await jusqua(() => mobVeh(cl, p.eid), 2000);
    let bPos = toi(b.client);
    const vers = Math.atan2(-(vArret.x - bPos.x), -(vArret.z - bPos.z));          // cap vers la voiture
    let distBob = Math.hypot(vArret.x - bPos.x, vArret.z - bPos.z);
    // le serveur mesure en 3D, de l'œil au centre du véhicule, moins sa demi-largeur : une marge franche évite le seuil
    if (distBob < 10) {
      await conduire(b.client, (10.5 - distBob) / 4.8, TOUCHE.arriere, vers);
      await jusqua(() => { const t = toi(b.client); return t && t.s >= b.client.seqE ? t : null; }, 3000);
      bPos = toi(b.client);
      distBob = Math.hypot(vArret.x - bPos.x, vArret.z - bPos.z);
    }
    ok(distBob > 6, 'préparation : la voiture est à ' + distBob.toFixed(1) + ' m de Bob (hors de portée)');
    const horsPortee = refus(b.client, 'portee');
    b.client.envoyer({ t: 'vehicule_monter', j: 0, eid: p.eid });
    ok(!!(await horsPortee), 'SPEC-ARCHI-021 : monter à plus de six blocs est refusé (motif « portee »)');
    await conduire(b.client, Math.max(0.05, (distBob - 2) / 4.8), TOUCHE.avant, vers);
    await jusqua(() => { const t = toi(b.client); return t && t.s >= b.client.seqE ? t : null; }, 3000);
    const monteB = evt(b.client, 'monte');
    b.client.envoyer({ t: 'vehicule_monter', j: 0, eid: p.eid });
    ok(!!(await monteB), 'le siège libéré accepte un autre joueur (arrivé à pied jusqu\'à la voiture)');
    b.client.fermer();
    await A.attendreClients(s.port, 1, 6000);
    const libre = await jusqua(() => { const v = mobVeh(cl, p.eid); return v && !v.co ? v : null; }, 4000);
    ok(!!libre, 'SPEC-SYNC-022 : un conducteur qui se déconnecte libère son siège (le véhicule n\'est plus occupé)');
    const monteA = evt(cl, 'monte');
    cl.envoyer({ t: 'vehicule_monter', j: 0, eid: p.eid });
    ok(!!(await monteA), 'et Alice peut y remonter');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── SPEC-SYNC-022 / sécurité : le serveur arbitre la vitesse, la portée, l'inventaire ──
async function scenarioArbitrage() {
  const d = A.dossierTemp('mc-veh-ar-');
  const f = path.join(d, 'monde.json');
  try {
    fs.writeFileSync(f, JSON.stringify(monde()));
    // survie, sans la tolérance de test : poser exige l'objet dans l'inventaire SERVEUR
    const s = await demarrer(['--monde', f, '--dossier-parties', d], env(Object.assign({}, SANS_POSE_LIBRE, seed([[I.MOTO, 1]]))));
    const a = await rejoindre(s.port, 'Alice', 1);
    const cl = a.client;
    await jusqua(() => toi(cl), 3000);

    let r = refus(cl, 'inventaire');
    poser(cl, 'voiture', sousLesPieds(a.bienvenue));
    ok(!!(await r), 'SPEC-ARCHI-021 : sans l\'objet, la pose d\'une voiture est refusée par le serveur (motif « inventaire »)');
    r = refus(cl, 'portee');
    poser(cl, 'moto', { x: 25, y: Y_DALLE, z: 25, nx: 0, ny: 1, nz: 0 });
    ok(!!(await r), 'SPEC-ARCHI-021 : poser hors de portée est refusé (motif « portee »)');
    r = refus(cl, 'inconnu');
    cl.envoyer({ t: 'vehicule_poser', j: 0, nom: 'zeppelin', i: -1, x: 0, y: Y_DALLE, z: 0, nx: 0, ny: 1, nz: 0 });
    ok(!!(await r), 'un modèle inconnu est refusé');
    r = refus(cl, 'inconnu');
    cl.envoyer({ t: 'vehicule_monter', j: 0, eid: 987654 });
    ok(!!(await r), 'monter dans un véhicule qui n\'existe pas est refusé');

    const p = await poserEtLire(cl, a.bienvenue, 'moto', 0, 0);
    ok(!!p.eid, 'avec l\'objet (une moto), la pose réussit');
    const inv = await jusqua(() => cl.messages.filter(m => m.t === 'inv_maj').pop(), 2000);
    ok(inv && compte(inv.inv, I.MOTO) === 0, 'SPEC-ARCHI-021 : l\'objet est retiré de l\'inventaire du serveur (INV_MAJ), une seule fois');
    r = refus(cl, 'inventaire');
    poser(cl, 'moto', sousLesPieds(a.bienvenue, 1, 0));
    ok(!!(await r), 'plus d\'objet, plus de pose (aucun véhicule gratuit)');

    // réparer exige d'être à bord, d'un véhicule avarié, devant un forgeron : sinon refus motivé
    r = refus(cl, 'inconnu');
    cl.envoyer({ t: 'vehicule_reparer', j: 0, eid: p.eid });
    ok(!!(await r), 'SPEC-TRANSPORT-002 : réparer sans être à bord d\'un véhicule avarié est refusé par le serveur');

    // monter trop loin : on s'éloigne de plus de 6 blocs
    await conduire(cl, 2.5, TOUCHE.avant | TOUCHE.course, 0);
    await jusqua(() => { const t = toi(cl); return t && t.s >= cl.seqE ? t : null; }, 5000);   // le serveur a rejoué toute la course
    r = refus(cl, 'portee');
    cl.envoyer({ t: 'vehicule_monter', j: 0, eid: p.eid });
    ok(!!(await r), 'SPEC-ARCHI-021 : monter à plus de six blocs est refusé (motif « portee »)');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── la vitesse n'est jamais « annoncée » : un client qui triche sur la durée n'est pas plus rapide ──
async function scenarioTriche() {
  const d = A.dossierTemp('mc-veh-tr-');
  const f = path.join(d, 'monde.json');
  try {
    fs.writeFileSync(f, JSON.stringify(monde()));
    const s = await demarrer(['--monde', f, '--dossier-parties', d], env());
    const a = await rejoindre(s.port, 'Triche', 1);
    const cl = a.client;
    await jusqua(() => toi(cl), 3000);
    const p = await poserEtLire(cl, a.bienvenue, 'voiture');
    const m = evt(cl, 'monte');
    cl.envoyer({ t: 'vehicule_monter', j: 0, eid: p.eid });
    await m;
    const dep = await jusqua(() => { const t = toi(cl); return t && t.veh ? t.veh : null; }, 3000);
    // 200 entrées de 100 ms d'un coup = 20 s de conduite « réclamées » en un instant
    const t0 = Date.now();
    for (let i = 0; i < 200; i++) cl.envoyer({ t: NP.MSG.ENTREE, s: i + 1, j: 0, dt: 0.1, k: TOUCHE.avant, yaw: 0, pitch: 0, v: 0 });
    await dodo(1300);
    const fin = toi(cl);
    const reel = (Date.now() - t0) / 1000;
    const dist = Math.hypot(fin.veh.x - dep.x, fin.veh.z - dep.z);
    // temps simulé permis ≤ temps réel + réserve (0,5 s) ; départ arrêté : d ≤ ½·a·t² avec a = 7 m/s², + marge
    const permis = 0.5 * V.DEFS.voiture.accel * Math.pow(reel + 0.6, 2);
    ok(dist <= permis + 1, 'SPEC-SYNC-022 : 20 s de conduite réclamées en 1,3 s réelles ne donnent que ' + dist.toFixed(1) + ' m (≤ ' + permis.toFixed(1) + ' m permis par le budget de temps)');
    ok(dist < 25, 'le client ne parcourt pas, à vitesse maximale, la distance de 20 s (≈ 250 m) qu\'il réclamait');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── SPEC-SYNC-022 : la soute est un conteneur serveur, partagé ; détruite, elle se vide au sol ──
async function scenarioSoute() {
  const d = A.dossierTemp('mc-veh-sou-');
  const f = path.join(d, 'monde.json');
  try {
    fs.writeFileSync(f, JSON.stringify(monde()));
    const s = await demarrer(['--ouvert', '--monde', f, '--dossier-parties', d], env(seed([[I.DIAMOND, 12]])));
    const a = await rejoindre(s.port, 'Alice', 1);
    const cl = a.client;
    await jusqua(() => toi(cl), 3000);
    const p = await poserEtLire(cl, a.bienvenue, 'camion', 0, 0);
    ok(!!p.eid, 'un camion est posé');
    const etatA = prochain(cl, 'cont_etat', 4000);
    cl.envoyer({ t: 'cont_ouvrir', j: 0, eid: p.eid });
    const ca = await etatA;
    ok(!!ca && ca.cle === 'v' + p.eid && ca.type === 'soute27' && ca.slots.length === 27, 'SPEC-SYNC-022 : ouvrir la soute du camion passe par le serveur (CONTENEUR_ETAT « v<eid> », 27 cases)', JSON.stringify(ca && { cle: ca.cle, type: ca.type, n: ca.slots && ca.slots.length }));
    if (!ca) return;

    // y ranger des diamants : transfert validé par le serveur, comme pour un coffre
    const invMsg = bienvenueInv(a.bienvenue, cl);
    const iD = indiceDe(invMsg, I.DIAMOND);
    ok(iD >= 0, 'l\'inventaire de départ porte les diamants');
    const maj = prochain(cl, 'inv_maj', 4000, m => m.ack >= 1);
    cl.envoyer({ t: 'cont_transfert', j: 0, seq: 1, de: { z: 'inv', i: iD }, vers: { z: 'cont', cle: ca.cle, i: 3 }, n: 5 });
    const mj = await maj;
    ok(!!mj && !(mj.refus && mj.refus.length), 'le transfert inventaire → soute est accepté', JSON.stringify(mj && mj.refus));
    const delta = mj && (mj.conteneurs || []).find(c => c.cle === ca.cle);
    ok(!!delta && delta.maj.some(e => e[0] === 3 && e[1] && e[1][0] === I.DIAMOND && e[1][1] === 5), 'SPEC-SYNC-022 : le delta de la soute (case 3 = 5 diamants) revient dans INV_MAJ');

    // un second client ouvre la MÊME soute et lit le même contenu
    const b = await rejoindre(s.port, 'Bob', 1);
    await jusqua(() => etat(b.client), 3000);
    const etatB = prochain(b.client, 'cont_etat', 4000);
    b.client.envoyer({ t: 'cont_ouvrir', j: 0, eid: p.eid });
    const cb = await etatB;
    ok(!!cb && cb.cle === ca.cle, 'SPEC-SYNC-022 : un second client ouvre la même soute (même clé)');
    ok(!!cb && cb.slots[3] && cb.slots[3][0] === I.DIAMOND && cb.slots[3][1] === 5, 'SPEC-SYNC-022 : il y lit le même contenu (5 diamants en case 3)');

    // Alice y remet 2 diamants : Bob, abonné, reçoit le delta
    const majB = prochain(b.client, 'cont_maj', 4000, m => m.cle === ca.cle);
    cl.envoyer({ t: 'cont_transfert', j: 0, seq: 2, de: { z: 'inv', i: iD }, vers: { z: 'cont', cle: ca.cle, i: 3 }, n: 2 });
    const mb = await majB;
    ok(!!mb && mb.maj.some(e => e[0] === 3 && e[1][1] === 7), 'SPEC-SYNC-022 : l\'autre abonné reçoit la mise à jour (CONTENEUR_MAJ, 7 diamants)');

    // trop loin pour ouvrir la soute : Alice s'éloigne de plus de six blocs
    await conduire(cl, 2.5, TOUCHE.avant | TOUCHE.course, 0);
    await jusqua(() => { const t = toi(cl); return t && t.s >= cl.seqE ? t : null; }, 5000);   // le serveur a rejoué toute la course
    const ferme = prochain(cl, 'cont_etat', 1500);
    cl.envoyer({ t: 'cont_fermer', j: 0, cle: ca.cle });
    cl.envoyer({ t: 'cont_ouvrir', j: 0, eid: p.eid });
    ok(!(await ferme), 'à plus de six blocs, la soute ne s\'ouvre pas');

    // détruit, le camion rend sa soute au sol et ferme l'écran de Bob
    const fermeB = prochain(b.client, 'cont_fermer', 30000, m => m.cle === ca.cle);
    const bateau = await poserEtLire(b.client, b.bienvenue, 'bateau', 0, 0);
    ok(!!bateau.eid, 'un bateau (soute de 9 cases) est posé par Bob');
    const etatBat = prochain(b.client, 'cont_etat', 4000);
    b.client.envoyer({ t: 'cont_ouvrir', j: 0, eid: bateau.eid });
    const cbat = await etatBat;
    ok(!!cbat && cbat.type === 'soute9' && cbat.slots.length === 9, 'SPEC-SYNC-022 : la soute du bateau a 9 cases');
    if (cbat) {
      // Bob n'a pas de diamants : il détruit le bateau vide de ses mains, la soute (vide) se ferme
      const fermeBat = prochain(b.client, 'cont_fermer', 30000, m => m.cle === cbat.cle);
      for (let k = 0, fin = Date.now() + 60000; Date.now() < fin; k++) {
        b.client.envoyer({ t: 'attaque', j: 0, eid: bateau.eid, degats: 12, i: 0 });
        await jusqua(() => !mobVeh(b.client, bateau.eid), 550, 30);     // cadence de frappe : sondage borné
        if (!mobVeh(b.client, bateau.eid)) break;
      }
      const gone = await jusqua(() => !mobVeh(b.client, bateau.eid), 3000);
      ok(gone, 'un véhicule détruit disparaît du monde');
      ok(!!(await fermeBat), 'SPEC-SYNC-022 : détruit, le véhicule ferme l\'écran de sa soute chez ceux qui l\'avaient ouverte');
    }
    void fermeB;
    b.client.fermer(); cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}
function bienvenueInv(bienvenue, cl) {
  const m = cl.messages.find(x => x.t === 'inv_maj') || bienvenue;
  return m.inv || (bienvenue && bienvenue.inv) || [];
}
function indiceDe(cases, id) { return cases.findIndex(c => c && c[0] === id); }

// ── SPEC-SERVEUR-006 : les véhicules survivent à un cycle sauvegarde/relance ──
async function scenarioPersistance() {
  const d = A.dossierTemp('mc-veh-ps-');
  const f = path.join(d, 'monde.json');
  try {
    fs.writeFileSync(f, JSON.stringify(monde()));
    const s = await demarrer(['--monde', f, '--dossier-parties', d], env(seed([[I.DIAMOND, 12]])));
    const a = await rejoindre(s.port, 'Alice', 1);
    const cl = a.client;
    await jusqua(() => toi(cl), 3000);
    const p = await poserEtLire(cl, a.bienvenue, 'camion', 0, 0);
    ok(!!p.eid, 'un camion est posé avant l\'arrêt');
    const etatA = prochain(cl, 'cont_etat', 4000);
    cl.envoyer({ t: 'cont_ouvrir', j: 0, eid: p.eid });
    const ca = await etatA;
    const iD = indiceDe(bienvenueInv(a.bienvenue, cl), I.DIAMOND);
    const maj = prochain(cl, 'inv_maj', 4000, m => m.ack >= 1);
    cl.envoyer({ t: 'cont_transfert', j: 0, seq: 1, de: { z: 'inv', i: iD }, vers: { z: 'cont', cle: ca.cle, i: 5 }, n: 9 });
    await maj;
    cl.envoyer({ t: 'cont_fermer', j: 0, cle: ca.cle });
    // un coffre posé, garni de 3 diamants : SPEC-SERVEUR-006 vaut aussi pour les conteneurs
    const cCoffre = { x: Math.floor(a.bienvenue.toi[0].x) + 2, y: Y_DALLE + 1, z: Math.floor(a.bienvenue.toi[0].z) };
    const poseC = prochain(cl, 'bloc', 3000, m => m.x === cCoffre.x && m.y === cCoffre.y && m.z === cCoffre.z);
    cl.envoyer({ t: 'bloc', x: cCoffre.x, y: cCoffre.y, z: cCoffre.z, id: B.CHEST, j: 0, i: 0 });
    ok(!!(await poseC), 'un coffre est posé à côté du camion');
    const etatC = prochain(cl, 'cont_etat', 4000);
    cl.envoyer({ t: 'cont_ouvrir', j: 0, x: cCoffre.x, y: cCoffre.y, z: cCoffre.z });
    const cc = await etatC;
    const majC = prochain(cl, 'inv_maj', 4000, m => m.ack >= 2);
    cl.envoyer({ t: 'cont_transfert', j: 0, seq: 2, de: { z: 'inv', i: iD }, vers: { z: 'cont', cle: cc.cle, i: 2 }, n: 3 });
    await majC;
    cl.envoyer({ t: 'cont_fermer', j: 0, cle: cc.cle });
    // un tour de conduite pour déplacer le camion, brûler du carburant, le tourner
    const monte = evt(cl, 'monte');
    cl.envoyer({ t: 'vehicule_monter', j: 0, eid: p.eid });
    await monte;
    await conduire(cl, 1.5, TOUCHE.avant | TOUCHE.gauche, 0);
    /* La descente n'est pas rangée dans la file des entrées : envoyée aussitôt,
       elle était traitée avant ou après les dernières entrées selon la cadence
       des tics (camion à 2 ou à 9 m). On attend que le serveur ait rejoué tout
       le tour (acquittement) et que le camion soit à l'arrêt, conducteur à bord,
       avant de descendre : la distance parcourue ne dépend plus de la charge. */
    ok(!!(await jusqua(() => { const t = toi(cl); return t && t.s >= cl.seqE ? t : null; }, 10000)), 'le serveur a rejoué tout le tour de conduite');
    ok(!!(await attendreArret(cl, 10000)), 'le camion s\'arrête, conducteur à bord');
    cl.envoyer({ t: 'vehicule_descendre', j: 0 });
    await evt(cl, 'descend');
    const vAvant = await jusqua(() => { const v = mobVeh(cl, p.eid); return v && Math.abs(v.vi) < 0.01 ? v : null; }, 10000);
    ok(!!vAvant, 'le camion est immobile avant l\'arrêt du serveur');
    cl.fermer();
    await s.arreter();

    const sauve = JSON.parse(fs.readFileSync(f, 'utf8'));
    ok(Array.isArray(sauve.vehicules) && sauve.vehicules.length === 1, 'SPEC-SERVEUR-006 : le fichier de monde porte la liste des véhicules (1)', JSON.stringify(sauve.vehicules));
    const v0 = sauve.vehicules[0] || [];
    eq(v0[0], 'camion', 'le modèle est sauvegardé');
    ok(vAvant && Math.abs(v0[1] - vAvant.x) < 0.02 && Math.abs(v0[3] - vAvant.z) < 0.02, 'SPEC-SERVEUR-006 : la position sauvegardée est celle du véhicule à l\'arrêt');
    ok(v0[6] !== undefined && v0[6] < V.DEFS.camion.carburant, 'le carburant restant est sauvegardé (' + v0[6] + '/' + V.DEFS.camion.carburant + ')');
    ok(!sauve.extras || !('vehicules' in sauve.extras), 'pas de doublon dans les extras');

    // relance sur le même fichier : le camion, sa soute et sa position reviennent
    const s2 = await demarrer(['--monde', f, '--dossier-parties', d], env());
    const b = await rejoindre(s2.port, 'Visiteur', 1);
    const cb = b.client;
    await jusqua(() => toi(cb), 15000);
    const revenu = await jusqua(() => ((etat(cb) && etat(cb).mobs) || []).find(m => m.ve === 'camion'), 20000);
    ok(!!revenu, 'SPEC-SERVEUR-006 : après la relance, le camion est de retour dans le monde');
    ok(revenu && vAvant && Math.abs(revenu.x - vAvant.x) < 0.05 && Math.abs(revenu.z - vAvant.z) < 0.05, 'SPEC-SERVEUR-006 : à la même position (' + (revenu && revenu.x) + ',' + (revenu && revenu.z) + ')');
    ok(revenu && revenu.ca !== undefined && Math.abs(revenu.ca - v0[6]) < 0.1, 'avec le même carburant');
    /* Le Visiteur apparaît au point d'apparition, à 2 blocs du coffre posé : il
       l'ouvre d'abord, sur place. Le camion, lui, est là où le tour de conduite
       l'a laissé (environ 9 m) : il marche ensuite jusqu'à lui (portée 6 blocs,
       mesurée depuis sa position réelle) pour ouvrir la soute et y monter. */
    const etatCb = prochain(cb, 'cont_etat', 15000);
    cb.envoyer({ t: 'cont_ouvrir', j: 0, x: cCoffre.x, y: cCoffre.y, z: cCoffre.z });
    const csC = await etatCb;
    ok(!!csC && csC.slots[2] && csC.slots[2][0] === I.DIAMOND && csC.slots[2][1] === 3, 'SPEC-SERVEUR-006 : le coffre posé restitue lui aussi son contenu exact (3 diamants en case 2)');
    cb.envoyer({ t: 'cont_fermer', j: 0, cle: csC && csC.cle });
    if (revenu) {
      const pV = toi(cb), dV = Math.hypot(revenu.x - pV.x, revenu.z - pV.z);
      if (dV > 3) {
        await conduire(cb, (dV - 2.5) / 4.3, TOUCHE.avant, Math.atan2(-(revenu.x - pV.x), -(revenu.z - pV.z)));
        await jusqua(() => { const t = toi(cb); return t && t.s >= cb.seqE ? t : null; }, 5000);
      }
    }
    const etatB = prochain(cb, 'cont_etat', 15000);
    cb.envoyer({ t: 'cont_ouvrir', j: 0, eid: revenu && revenu.e });
    const cs = await etatB;
    ok(!!cs && cs.slots[5] && cs.slots[5][0] === I.DIAMOND && cs.slots[5][1] === 9, 'SPEC-SERVEUR-006 : la soute restitue son contenu exact (9 diamants en case 5)', 'camion ' + JSON.stringify(vAvant && { x: vAvant.x, z: vAvant.z }) + ', visiteur ' + JSON.stringify(toi(cb) && { x: toi(cb).x, z: toi(cb).z }) + ', réponse ' + JSON.stringify(cs && cs.slots && cs.slots[5]));
    cb.envoyer({ t: 'cont_fermer', j: 0, cle: cs && cs.cle });
    // il est de nouveau utilisable : on y monte
    const mt = evt(cb, 'monte', 15000);
    cb.envoyer({ t: 'vehicule_monter', j: 0, eid: revenu && revenu.e });
    ok(!!(await mt), 'et on y monte');
    cb.fermer();
    await s2.arreter();

    // deuxième cycle : toujours un seul camion (pas de duplication à la sauvegarde)
    const sauve2 = JSON.parse(fs.readFileSync(f, 'utf8'));
    ok(Array.isArray(sauve2.vehicules) && sauve2.vehicules.length === 1, 'un second cycle sauvegarde/relance ne duplique rien (1 véhicule)');
  } finally { A.supprimerDossier(d); }
}

// ── SPEC-ARCHI-014 / 021 : un véhicule d'une partie solo importée est repris par le serveur ──
async function scenarioImportSolo() {
  const d = A.dossierTemp('mc-veh-im-');
  const f = path.join(d, 'monde.json');
  try {
    fs.writeFileSync(f, JSON.stringify(monde({
      extras: { vehicules: [['voiture', 3.5, Y_DALLE + 1, 3.5, 1.2, 0, 17.5, 0]], explores: [] },
    })));
    const s = await demarrer(['--monde', f, '--dossier-parties', d], env());
    const a = await rejoindre(s.port, 'Alice', 1);
    await jusqua(() => toi(a.client), 3000);
    const v = await jusqua(() => ((etat(a.client) && etat(a.client).mobs) || []).find(m => m.ve === 'voiture'), 5000);
    ok(!!v, 'SPEC-ARCHI-021 : le véhicule d\'une partie solo importée (extras.vehicules) est repris par le serveur');
    ok(v && Math.abs(v.x - 3.5) < 0.05 && Math.abs(v.z - 3.5) < 0.05 && Math.abs(v.ca - 17.5) < 0.1, 'à sa place, avec son carburant (' + (v && v.ca) + ')');
    a.client.fermer();
    await s.arreter();
    const sauve = JSON.parse(fs.readFileSync(f, 'utf8'));
    ok(sauve.vehicules && sauve.vehicules.length === 1 && sauve.vehicules[0][0] === 'voiture', 'sauvegardé comme véhicule de premier rang');
    ok(sauve.extras && !('vehicules' in sauve.extras) && Array.isArray(sauve.extras.explores), 'et retiré des extras (les autres extras sont conservés)');
  } finally { A.supprimerDossier(d); }
}

// ── messages malformés, quota par joueur, pause ─────────────────────────────────
async function scenarioRobustesse() {
  const d = A.dossierTemp('mc-veh-rb-');
  const f = path.join(d, 'monde.json');
  try {
    fs.writeFileSync(f, JSON.stringify(monde()));
    const s = await demarrer(['--monde', f, '--dossier-parties', d], env());
    const a = await rejoindre(s.port, 'Alice', 1);
    const cl = a.client;
    await jusqua(() => toi(cl), 3000);

    // messages malformés : ignorés sans effet ni réponse, le serveur continue de répondre
    const n0 = cl.messages.length;
    [{ t: 'vehicule_monter', j: 0, eid: 'x' }, { t: 'vehicule_monter', j: 9, eid: 1 }, { t: 'vehicule_monter' },
     { t: 'vehicule_poser', j: 0, nom: 'voiture', x: 1e12, y: 5, z: 0, nx: 0, ny: 1, nz: 0 },
     { t: 'vehicule_poser', j: 0, nom: 12, x: 0, y: 5, z: 0, nx: 0, ny: 1, nz: 0 },
     { t: 'vehicule_poser', j: 0, nom: '../../etc', x: 0, y: 5, z: 0, nx: 0, ny: 1, nz: 0 },
     { t: 'vehicule_descendre', j: 'a' }, { t: 'vehicule_reparer', eid: -3 }, { t: 'vehicule_evt', j: 0, evt: 'monte' }]
      .forEach(m => cl.envoyer(m));
    const apres = await prochain(cl, 'etat', 3000);
    ok(!!apres, 'SPEC-ARCHI-021 : des messages de véhicule malformés ne tuent pas le serveur (il envoie encore ETAT)');
    ok(!cl.messages.slice(n0).some(m => m.t === 'vehicule_evt'), 'et ne provoquent aucune réponse ni aucun effet');
    ok(!((etat(cl).mobs || []).some(m => m.ve)), 'aucun véhicule n\'a été créé par ces messages');
    const diag = refus(cl, 'inconnu');
    cl.envoyer({ t: 'vehicule_poser', j: 0, nom: 'voiture', i: -1, x: 0, y: Y_DALLE, z: 0, nx: 1, ny: 1, nz: 0 });
    ok(!!(await diag), 'une normale en diagonale (bien formée mais absurde) est refusée avec un motif');

    // quota : 12 véhicules libres par joueur, ensuite refus « place »
    let poses = 0, refusPlace = 0;
    for (let i = 0; i < 14; i++) {
      await dodo(230);                                  // cadence humaine : sous le budget anti-flood de 5 poses par seconde
      const r = prochain(cl, 'vehicule_evt', 3000, m => m.evt === 'pose' || m.evt === 'refus');
      poser(cl, 'moto', sousLesPieds(a.bienvenue, i % 3 - 1, 0));
      const rep = await r;
      if (rep && rep.evt === 'pose') poses++;
      else if (rep && rep.motif === 'place') refusPlace++;
    }
    eq(poses, 12, 'SPEC-ARCHI-021 : un joueur ne peut poser que 12 véhicules libres (quota par joueur)');
    eq(refusPlace, 2, 'au-delà, le serveur refuse avec le motif « place »');

    // pause : poser, monter et descendre sont ignorés (monde figé), puis repris
    cl.envoyer({ t: 'pause', actif: true });
    await cl.attendre('pause_etat', 3000, m => m.actif === true);
    const eid = ((etat(cl).mobs || []).find(m => m.ve) || {}).e;
    const muet = prochain(cl, 'vehicule_evt', 700);
    cl.envoyer({ t: 'vehicule_monter', j: 0, eid });
    poser(cl, 'moto', sousLesPieds(a.bienvenue, 0, 1));
    ok(!(await muet), 'SPEC-ARCHI-010/021 : en pause, monter et poser un véhicule sont ignorés');
    cl.envoyer({ t: 'pause', actif: false });
    await cl.attendre('pause_etat', 3000, m => m.actif === false);
    const monte = evt(cl, 'monte');
    cl.envoyer({ t: 'vehicule_monter', j: 0, eid });
    ok(!!(await monte), 'à la reprise, monter est de nouveau accepté');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── réparation chez un forgeron : chemin heureux ──────────────────────────────────
async function scenarioReparation() {
  const d = A.dossierTemp('mc-veh-rp-');
  const f = path.join(d, 'monde.json');
  try {
    fs.writeFileSync(f, JSON.stringify(monde({ vehicules: [['voiture', 3.5, Y_DALLE + 1, 3.5, 0, 0, 30, 2]] })));
    const s = await demarrer(['--monde', f, '--dossier-parties', d],
      env(Object.assign({ MC_TEST_MOBS: JSON.stringify([['villager', 1, 0, 'forgeron']]) }, seed([[I.EMERALD, 12]]))));
    const a = await rejoindre(s.port, 'Alice', 1);
    const cl = a.client;
    await jusqua(() => toi(cl), 3000);
    const veh = await jusqua(() => ((etat(cl).mobs || []).find(m => m.ve === 'voiture')), 4000);
    const forge = await jusqua(() => ((etat(cl).mobs || []).find(m => m.r === 'forgeron')), 4000);
    ok(!!veh && veh.av === 2, 'préparation : une voiture avariée (gravité 2) est dans le monde');
    ok(!!forge, 'préparation : un forgeron est dans le monde');
    if (!veh || !forge) return;
    const monte = evt(cl, 'monte');
    cl.envoyer({ t: 'vehicule_monter', j: 0, eid: veh.e });
    await monte;
    const maj = prochain(cl, 'inv_maj', 4000);
    const rep = evt(cl, 'repare');
    cl.envoyer({ t: 'vehicule_reparer', j: 0, eid: forge.e });
    ok(!!(await rep), 'SPEC-TRANSPORT-002 : le forgeron répare le véhicule conduit (évènement « repare »)');
    const im = await maj;
    ok(!!im && compte(im.inv, I.EMERALD) === 12 - V.COUT_REPARATION[2], 'les émeraudes sont débitées sur l\'inventaire serveur (12 → ' + (12 - V.COUT_REPARATION[2]) + ')');
    const net = await jusqua(() => { const v = mobVeh(cl, veh.e); return v && !v.av ? v : null; }, 3000);
    ok(!!net, 'le véhicule n\'est plus avarié chez aucun client');
    const refus2 = refus(cl, 'inconnu');
    cl.envoyer({ t: 'vehicule_reparer', j: 0, eid: forge.e });
    ok(!!(await refus2), 'un véhicule en bon état ne se répare pas une seconde fois (aucune émeraude perdue)');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── la mort du conducteur le fait descendre ───────────────────────────────────────
async function scenarioMortConducteur() {
  const d = A.dossierTemp('mc-veh-mt-');
  const f = path.join(d, 'monde.json');
  try {
    const cases = new Array(MC.ContratsV2.BORNES.SLOTS_INV).fill(0);
    fs.writeFileSync(f, JSON.stringify(monde({ soloJoueur: { v: 1, inv: cases, equip: {}, etat: { hp: 1, hunger: 0, air: 10 } } })));
    const s = await demarrer(['--monde', f, '--dossier-parties', d], env({ MC_DIFFICULTE: 'normal' }));
    const a = await rejoindre(s.port, 'Alice', 1);
    const cl = a.client;
    await jusqua(() => toi(cl), 3000);
    const p = await poserEtLire(cl, a.bienvenue, 'voiture');
    const monte = evt(cl, 'monte');
    cl.envoyer({ t: 'vehicule_monter', j: 0, eid: p.eid });
    ok(!!(await monte), 'préparation : Alice (1 PV, affamée) est au volant');
    const morte = await jusqua(() => { const t = toi(cl); return t && t.mort ? t : null; }, 25000);
    ok(!!morte, 'la famine la tue');
    const pied = await jusqua(() => { const t = toi(cl); return t && t.mort && !t.veh ? t : null; }, 3000);
    ok(!!pied, 'SPEC-SYNC-022 : morte, elle n\'est plus à bord (toi.veh absent)');
    const libre = await jusqua(() => { const v = mobVeh(cl, p.eid); return v && !v.co ? v : null; }, 3000);
    ok(!!libre, 'et le véhicule est libre pour les autres');
    const r = refus(cl, 'mort');
    cl.envoyer({ t: 'vehicule_monter', j: 0, eid: p.eid });
    ok(!!(await r), 'un joueur mort ne peut pas monter (motif « mort »)');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── un fichier de monde forgé ne fait pas entrer de véhicule invalide ───────────────
async function scenarioFichierForge() {
  const d = A.dossierTemp('mc-veh-fg-');
  const f = path.join(d, 'monde.json');
  try {
    const bonne = new Array(27).fill(0); bonne[1] = [I.DIAMOND, 4];
    fs.writeFileSync(f, JSON.stringify(monde({ vehicules: [
      ['camion', 2.5, Y_DALLE + 1, 2.5, 0, bonne, 1e9, 0],              // valide, carburant démesuré
      ['zeppelin', 0, 200, 0, 0, 0, 5, 0],
      ['voiture', 1e12, 50, 0, 0, 0, 5, 0],
      ['camion', 5.5, Y_DALLE + 1, 5.5, 0, [[I.DIAMOND, 4]], 5, 0],     // soute de la mauvaise taille
      ['voiture', 7.5, Y_DALLE + 1, 7.5, 0, 0, 5, 77],                  // avarie hors borne
      'n\'importe quoi', null,
    ] })));
    const s = await demarrer(['--monde', f, '--dossier-parties', d], env());
    const a = await rejoindre(s.port, 'Alice', 1);
    await jusqua(() => toi(a.client), 3000);
    await dodo(300);
    const vs = (etat(a.client).mobs || []).filter(m => m.ve);
    eq(vs.length, 1, 'SPEC-SERVEUR-006 : seule l\'entrée valide d\'un fichier de monde forgé devient un véhicule');
    ok(vs[0] && vs[0].ve === 'camion' && vs[0].ca <= V.DEFS.camion.carburant, 'son carburant démesuré est ramené au plein du modèle (' + (vs[0] && vs[0].ca) + ')');
    a.client.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── une soute NON vide rend son contenu au sol à la destruction ────────────────────
async function scenarioSouteDetruite() {
  const d = A.dossierTemp('mc-veh-sd-');
  const f = path.join(d, 'monde.json');
  try {
    fs.writeFileSync(f, JSON.stringify(monde()));
    const s = await demarrer(['--monde', f, '--dossier-parties', d], env(seed([[I.DIAMOND, 12]])));
    const a = await rejoindre(s.port, 'Alice', 1);
    const cl = a.client;
    await jusqua(() => toi(cl), 3000);
    const p = await poserEtLire(cl, a.bienvenue, 'bateau', 0, 0);
    const etatA = prochain(cl, 'cont_etat', 4000);
    cl.envoyer({ t: 'cont_ouvrir', j: 0, eid: p.eid });
    const ca = await etatA;
    const iD = indiceDe(bienvenueInv(a.bienvenue, cl), I.DIAMOND);
    const maj = prochain(cl, 'inv_maj', 4000, m => m.ack >= 1);
    cl.envoyer({ t: 'cont_transfert', j: 0, seq: 1, de: { z: 'inv', i: iD }, vers: { z: 'cont', cle: ca.cle, i: 0 }, n: 4 });
    await maj;
    const ferme = prochain(cl, 'cont_fermer', 30000, m => m.cle === ca.cle);
    for (let k = 0; k < 14 && mobVeh(cl, p.eid); k++) {
      cl.envoyer({ t: 'attaque', j: 0, eid: p.eid, degats: 12, i: 0 });
      await jusqua(() => !mobVeh(cl, p.eid), 550, 30);
    }
    ok(!!(await ferme), 'le bateau détruit ferme l\'écran de sa soute');
    const sol = await jusqua(() => {
      const e = etat(cl);
      const n = ((e && e.mobs) || []).filter(m => m.t === 'item' && m.i === I.DIAMOND).length;
      return n ? n : null;
    }, 4000);
    ok(!!sol, 'SPEC-SYNC-022 : les 4 diamants de la soute NON vide sont tombés au sol (objets visibles dans ETAT)');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── succès « premier véhicule » : arbitré par le serveur, pour le bon joueur local ─────
async function scenarioSucces() {
  const d = A.dossierTemp('mc-veh-su-');
  const f = path.join(d, 'monde.json');
  try {
    fs.writeFileSync(f, JSON.stringify(monde()));
    const s = await demarrer(['--monde', f, '--dossier-parties', d], env());
    const a = await rejoindre(s.port, 'Duo', 2);                    // écran partagé : deux joueurs locaux sur une connexion
    const cl = a.client;
    await jusqua(() => { const t = etat(cl) && etat(cl).toi; return t && t.length === 2 ? t : null; }, 4000);
    const p1 = a.bienvenue.toi[1];
    const cible = { x: Math.floor(p1.x), y: Y_DALLE, z: Math.floor(p1.z), nx: 0, ny: 1, nz: 0 };
    const avant = new Set(((etat(cl).mobs) || []).filter(m => m.ve).map(m => m.e));
    const pose = prochain(cl, 'vehicule_evt', 4000, m => m.evt === 'pose' && m.j === 1);
    cl.envoyer(Object.assign({ t: 'vehicule_poser', j: 1, nom: 'moto', i: -1 }, cible));
    ok(!!(await pose), 'préparation : le joueur 2 pose une moto');
    const mob = await jusqua(() => ((etat(cl).mobs) || []).find(m => m.ve === 'moto' && !avant.has(m.e)), 3000);
    if (!mob) return;
    const n0 = cl.messages.length;
    const debloque = prochain(cl, 'succes_debloque', 4000, m => m.id === 'premier_vehicule');
    const monte = prochain(cl, 'vehicule_evt', 4000, m => m.evt === 'monte' && m.j === 1);
    cl.envoyer({ t: 'vehicule_monter', j: 1, eid: mob.e });
    ok(!!(await monte), 'le joueur 2 monte dans la moto');
    const su = await debloque;
    ok(!!su && su.j === 1, 'SPEC-SUCCES-001 : embarquer donne « premier_vehicule » au joueur local 2, annoncé par SUCCES_DEBLOQUE du serveur', JSON.stringify(su));
    ok(!cl.messages.slice(n0).some(m => m.t === 'succes_debloque' && m.id === 'premier_vehicule' && m.j === 0), 'et pas au joueur 1, qui n\'est pas monté');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── audit statique : le refus a disparu, plus aucune conduite simulée côté client ──
function scenarioAudit() {
  const src = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
  const sansCommentaires = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/pas disponibles en ligne/.test(src), 'SPEC-ARCHI-021 (audit) : la chaîne « pas disponibles en ligne » n\'existe plus dans game.js');
  ok(!/V\.(monter|descendre|conduire|caler|poser)\(/.test(sansCommentaires), 'SPEC-ARCHI-021 (audit) : game.js ne simule plus aucun véhicule (monter, descendre, conduire, caler, poser)');
  ok(!/signalerSucces\(\s*\{\s*type:\s*'vehicule'/.test(sansCommentaires), 'SPEC-SUCCES-001 (audit) : game.js ne signale plus le succès véhicule lui-même');
  ok(!/entities\.list\.[^\n]*vehicule/.test(sansCommentaires), 'SPEC-ARCHI-021 (audit) : game.js ne cherche plus de véhicule dans ses entités locales');
  const lisezMoi = fs.readFileSync(path.join(RACINE, 'README.md'), 'utf8');
  ok(!/véhicules ne sont pas disponibles en ligne/i.test(lisezMoi), 'SPEC-ARCHI-021 : le README ne dit plus que les véhicules sont indisponibles en ligne');
  const serveur = require('./source-serveur.js').sourceServeur(RACINE);   // server.js et ses modules (SPEC-SERVEUR-008)
  ok(/vehicules: MC\.Vehicules\.serialiser\(entites\)/.test(serveur), 'SPEC-SERVEUR-006 (audit) : etatMonde() sérialise les véhicules');
}

(async () => {
  try {
    await scenarioConduite();
    await scenarioArbitrage();
    await scenarioTriche();
    await scenarioSoute();
    await scenarioPersistance();
    await scenarioImportSolo();
    await scenarioRobustesse();
    await scenarioReparation();
    await scenarioMortConducteur();
    await scenarioFichierForge();
    await scenarioSouteDetruite();
    await scenarioSucces();
    scenarioAudit();
  } catch (e) {
    ok(false, 'le scénario ne doit pas lever d\'exception', e && e.stack);
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
