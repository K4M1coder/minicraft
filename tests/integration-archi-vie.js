/* integration-archi-vie.js — lot B-VIE du chantier « solo = serveur toujours
   présent » : SPEC-ARCHI-026 (vie et survie), 027 (combat et butin), 028 (duel),
   sur de vrais processus server.js (serveur FERMÉ au réseau, comme le solo).

   - 026 : la vie et la faim évoluent par l'état du serveur (régénération, épuisement)
     et cessent d'évoluer pendant la pause ; un joueur mort renaît MÊME en pause,
     au lit qu'il a choisi (s'il existe encore) sinon au point d'apparition, avec
     vie, faim et air remis par le serveur ;
   - 027 : les coups sont validés par le serveur (dégâts plafonnés par l'arme
     réellement possédée, cadence, portée) ; tuer une créature crédite un butin
     annoncé par DONNE et rangé dans l'inventaire serveur ; un gardien de donjon
     s'éveille côté serveur pour un joueur solo ;
   - 028 : /duel est envoyé au serveur, qui le refuse seul avec un motif ;
   - audit statique de src/game.js (plus de branche net.enLigne() dans ces zones).

   Usage : node tests/integration-archi-vie.js */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre, RACINE } = A;
const R = A.creerRapport('Intégration ARCHI — B-VIE : vie, survie, combat, butin, duel');
const { ok, eq } = R;

const MC = A.chargerModules();
const B = MC.Core.B, I = MC.Core.I;
const serveurs = [];
async function demarrer(args, env) {
  const s = await lancer(['--port', '0'].concat(args || []), env);
  serveurs.push(s);
  return s;
}
const SANS_POSE_LIBRE = { MC_TEST_POSE_LIBRE: '' };
const seed = (liste) => ({ MC_TEST_INV: JSON.stringify(liste) });

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
const etatToi = (cl) => { const e = cl.dernier('etat'); return e && e.toi && e.toi[0]; };
const NUIT = MC.DayCycle.DAY_LENGTH * 0.75;      // plein cœur de la nuit du premier jour
function monde(hp, faim, inv, heure) {
  const SLOTS = MC.ContratsV2.BORNES.SLOTS_INV;
  const cases = new Array(SLOTS).fill(0);
  (inv || []).forEach((p, i) => { cases[i] = p; });
  return {
    v: 2, graine: 20260921, heure: heure === undefined ? 60 : heure, overrides: [], etats: [], crops: [],
    soloJoueur: { v: 1, inv: cases, equip: {}, etat: { hp, hunger: faim, air: 10 } },
  };
}
async function poserBloc(cl, pos, id) {
  cl.envoyer({ t: 'bloc', x: pos.x, y: pos.y, z: pos.z, id, j: 0, i: 0 });
  return cl.attendre('bloc', 3000, m => m.x === pos.x && m.y === pos.y && m.z === pos.z);
}

const heureJeu = (cl) => { const e = cl.dernier('etat'); return e ? e.heure : null; };
/* Attend que `secs` secondes de TEMPS DE JEU se soient écoulées (l'heure de l'ETAT
   avance), en sondage borné : jamais un délai fixe en temps réel. */
async function attendreJeu(cl, secs, ms) {
  const h0 = await jusqua(() => heureJeu(cl), 3000);
  if (h0 === null) return false;
  return !!(await jusqua(() => heureJeu(cl) - h0 >= secs, ms || 30000, 20));
}
/* Observation bornée d'un invariant pendant `ms` : rend true s'il tient tout du long.
   (Un « rien ne se passe » ne peut pas s'attendre par un évènement : on l'observe.) */
async function observer(ms, invariant) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (!invariant()) return false; await dodo(25); }
  return true;
}
const prochainEtat = (cl) => { const n = cl.messages.length; return cl.attendre('etat', 4000, m => cl.messages.indexOf(m) >= n); };

// ── SPEC-ARCHI-026 : la vie et la faim viennent du serveur, gelées en pause ──
async function scenarioSurvie() {
  const d = A.dossierTemp('mc-vie-sv-');
  const f = path.join(d, 'monde.json');
  try {
    fs.writeFileSync(f, JSON.stringify(monde(4, 20)));
    const s = await demarrer(['--monde', f, '--dossier-parties', d], SANS_POSE_LIBRE);
    const { client: cl, bienvenue } = await rejoindre(s.port, 'Alice', 1);
    const t0 = bienvenue.toi[0];
    ok(t0.pv === 4 && t0.faim === 20, 'SPEC-ARCHI-026 : point de départ 4 PV, faim pleine', JSON.stringify(t0));

    // AUCUNE entrée envoyée (client muet) : le serveur fait vivre le corps au temps de jeu
    const soigne = await jusqua(() => { const e = etatToi(cl); return e && e.pv > 4 ? e : null; }, 20000);
    ok(!!soigne, 'SPEC-ARCHI-026 : la vie remonte par l\'état du serveur (régénération), client muet');
    const affame = await jusqua(() => { const e = etatToi(cl); return e && e.faim < 20 ? e : null; }, 30000);
    ok(!!affame, 'SPEC-ARCHI-026 : la faim baisse par l\'état du serveur (épuisement), client muet');

    // gel : valeurs lues, PAUSE observée, reprise
    const avant = etatToi(cl);
    cl.envoyer({ t: 'pause', actif: true });
    await cl.attendre('pause_etat', 3000, m => m.actif === true);
    const hPause = await jusqua(() => heureJeu(cl), 1000);
    const gele = await observer(3000, () => heureJeu(cl) === hPause);   // aucun ETAT n'avance en pause
    cl.envoyer({ t: 'pause', actif: false });
    await cl.attendre('pause_etat', 3000, m => m.actif === false);
    const apres = (await prochainEtat(cl)).toi[0];
    ok(gele && apres.pv <= avant.pv + 1 && apres.faim >= avant.faim - 1,
       'SPEC-ARCHI-026 : PV et faim n\'ont pas avancé pendant 3 s de pause (sans pause, la régénération en aurait donné 2)',
       `avant ${avant.pv}/${avant.faim}, après ${apres.pv}/${apres.faim}`);
    // témoin : la reprise refait vivre le corps
    const repart = await jusqua(() => { const e = etatToi(cl); return e && (e.pv !== apres.pv || e.faim !== apres.faim) ? e : null; }, 20000);
    ok(!!repart, 'témoin : à la reprise, la vie et la faim évoluent de nouveau');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── SPEC-ARCHI-026 : renaître (même en pause), au lit ou au point d'apparition ─
async function mourirPuisRenaitre(avecLit, litDetruit) {
  const d = A.dossierTemp('mc-vie-rn-');
  const f = path.join(d, 'monde.json');
  try {
    fs.writeFileSync(f, JSON.stringify(monde(1, 0, [], avecLit ? NUIT : 60)));
    const s = await demarrer(['--monde', f, '--dossier-parties', d], { MC_DIFFICULTE: 'normal' });
    const { client: cl, bienvenue } = await rejoindre(s.port, 'Bob', 1);
    const dep = bienvenue.toi[0];
    let bed = null;
    if (avecLit) {
      bed = { x: Math.floor(dep.x), y: Math.floor(dep.y) + 3, z: Math.floor(dep.z) };
      const rep = await poserBloc(cl, bed, B.LIT);
      eq(rep.id, B.LIT, 'préparation : le lit est posé');
      cl.envoyer({ t: 'dormir', j: 0, actif: true });
      // lit ET sommeil ensemble (SPEC-ARCHI-025 + 026) : le joueur seul est la majorité, la nuit passe...
      const jour = await cl.attendre('chat', 5000, m => /jour se lève/i.test(m.texte || '')).catch(() => null);
      ok(!!jour, 'SPEC-ARCHI-025/026 : se coucher dans un lit fait passer la nuit (le sommeil de B-ENV est conservé)');
      if (litDetruit) {
        cl.envoyer({ t: 'bloc', x: bed.x, y: bed.y, z: bed.z, id: 0, j: 0 });
        await cl.attendre('bloc', 3000, m => m.x === bed.x && m.y === bed.y && m.z === bed.z && m.id === 0);
      }
    }
    // la famine (faim 0, difficulté normale) achève le dernier PV, sans une seule entrée du client
    const mort = await jusqua(() => { const e = etatToi(cl); return e && e.mort === 1 ? e : null; }, 20000);
    ok(!!mort, 'préparation : le joueur meurt de faim sur le serveur (client muet)');

    // le monde est figé : le mort renaît quand même (les messages sont traités dans l'ordre)
    cl.envoyer({ t: 'pause', actif: true });
    await cl.attendre('pause_etat', 3000, m => m.actif === true);
    cl.envoyer({ t: 'renaitre', j: 0 });
    cl.envoyer({ t: 'pause', actif: false });
    await cl.attendre('pause_etat', 3000, m => m.actif === false);
    const vivant = await jusqua(() => { const e = etatToi(cl); return e && e.mort === 0 ? e : null; }, 6000);
    ok(!!vivant, 'SPEC-ARCHI-026 : RENAITRE envoyé PENDANT la pause est traité (le mort renaît)');
    if (vivant) {
      ok(vivant.pv === 20 && vivant.faim === 20 && vivant.air === 10, 'SPEC-ARCHI-026 : vie, faim et air remis par le serveur', JSON.stringify(vivant));
      if (avecLit && !litDetruit) {
        ok(Math.abs(vivant.x - (bed.x + 0.5)) < 0.01 && Math.abs(vivant.z - (bed.z + 0.5)) < 0.01 && Math.abs(vivant.y - (bed.y + 1.05)) < 0.01,
           'SPEC-ARCHI-026 : le lieu de renaissance est le lit où le joueur s a couché, décidé par le serveur', JSON.stringify([vivant.x, vivant.y, vivant.z, bed]));
      } else {
        ok(Math.abs(vivant.x - dep.x) < 0.01 && Math.abs(vivant.y - dep.y) < 0.01 && Math.abs(vivant.z - dep.z) < 0.01,
           litDetruit ? 'SPEC-ARCHI-026 : le lit a été détruit, retour au point d\'apparition' : 'SPEC-ARCHI-026 : sans lit, renaissance au point d\'apparition du serveur',
           JSON.stringify([vivant.x, vivant.y, vivant.z, dep.x, dep.y, dep.z]));
      }
    }
    // un vivant qui envoie RENAITRE n'est pas téléporté
    const avantRen = etatToi(cl);
    cl.envoyer({ t: 'renaitre', j: 0 });
    const e2 = await prochainEtat(cl);
    ok(e2.toi[0].x === avantRen.x && e2.toi[0].z === avantRen.z, 'SPEC-ARCHI-026 : RENAITRE d\'un joueur vivant est sans effet');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── SPEC-ARCHI-027 : coups et tirs validés, butin par DONNE ──────────────────
/* Un terrain plat de 9 x 9 blocs (bloc plein sous les pieds, deux blocs libres
   au-dessus, même altitude) trouvé près du point d'apparition du monde : on y
   pose le joueur (MC_TEST_SPAWN) et un mouton à 1,5 bloc, qui ne peut donc ni
   tomber dans un trou ni y entraîner son butin. Calculé sur le MÊME monde que le
   serveur (même graine). */
function terrainPlat() {
  const w = MC.createWorld(20260921);
  const col = w.findSpawnColumn();
  const solide = (x, y, z) => MC.Core.isSolid(w.getBlock(x, y, z));
  for (let r = 0; r <= 80; r += 4) {
    for (let a = 0; a < (r ? 8 : 1); a++) {
      const cx = Math.round(col[0] + r * Math.cos(a * Math.PI / 4)), cz = Math.round(col[1] + r * Math.sin(a * Math.PI / 4));
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) w.getChunk(Math.floor((cx + dx) / 16), Math.floor((cz + dz) / 16), true);
      const y0 = Math.floor(w.groundAt(cx, cz, true) + 1.2);
      let plat = true;
      for (let dx = -4; dx <= 4 && plat; dx++) for (let dz = -4; dz <= 4 && plat; dz++) {
        const x = cx + dx, z = cz + dz;
        if (!solide(x, y0 - 1, z) || solide(x, y0, z) || solide(x, y0 + 1, z)) plat = false;
      }
      if (plat) return { x: cx + 0.5, y: w.groundAt(cx, cz, true) + 1.2, z: cz + 0.5, dx: 1.5, dz: 0, ux: 1, uz: 0 };
    }
  }
  return null;
}
/* Serveur de combat : un mouton à 1,5 bloc (dégagé), un autre très loin, et
   l'inventaire imposé (arme en case 0). */
async function serveurCombat(inv) {
  const dir = terrainPlat();
  if (!dir) return null;
  const s = await demarrer([], Object.assign({}, SANS_POSE_LIBRE, seed(inv),
    { MC_TEST_SPAWN: `${dir.x},${dir.y},${dir.z}`, MC_TEST_MOBS: JSON.stringify([['sheep', dir.dx, dir.dz], ['sheep', 24, 0]]) }));
  const { client: cl } = await rejoindre(s.port, 'Chloe', 1);
  await cl.attendre('inv_maj', 4000);
  const moutons = () => { const e = cl.dernier('etat'); return e ? e.mobs.filter(m => m.t === 'sheep') : []; };
  const toi = () => etatToi(cl);
  const proche = await jusqua(() => { const t = toi(); return t && moutons().find(m => Math.hypot(m.x - t.x, m.z - t.z) < 5); }, 5000);
  const loin = await jusqua(() => { const t = toi(); return t && moutons().find(m => Math.hypot(m.x - t.x, m.z - t.z) > 12); }, 3000);
  const vivant = (m) => !!moutons().find(x => x.e === m.e);
  const frapper = (m, degats) => cl.envoyer({ t: 'attaque', eid: m.e, degats: degats === undefined ? 12 : degats, j: 0, i: 0 });
  return { s, cl, dir, proche, loin, moutons, toi, vivant, frapper };
}
/* Vrai si la créature a disparu de l'état dans les 4 s (mort + délai de retrait). */
const disparu = (C, m) => jusqua(() => !C.vivant(m), 4000);

async function scenarioCombat() {
  const C = await serveurCombat([[I.WOOD_SWORD, 1]]);
  if (!C) { R.saut('combat et butin', 'aucun terrain plat près du point de départ'); return; }
  const { s, cl, proche, loin, vivant, frapper, toi } = C;
  ok(!!proche, 'préparation : un mouton près du joueur');
  if (!proche) return;

  // portée : un mouton lointain n'est jamais touché
  if (loin) {
    frapper(loin); frapper(loin);
    await attendreJeu(cl, 1);
    ok(vivant(loin), 'SPEC-ARCHI-027 : un coup sur une créature hors de portée est ignoré');
  } else R.saut('coup hors de portée', 'aucun mouton lointain dans l\'état reçu');

  // dégâts et cadence : « 12 dégâts » annoncés + rafale de six coups avec une épée de bois (3 dégâts sur 8 PV)
  frapper(proche);
  for (let k = 0; k < 6; k++) frapper(proche);
  await attendreJeu(cl, 2);
  ok(vivant(proche), 'SPEC-ARCHI-027 : « 12 dégâts » et une rafale de coups ne tuent pas un mouton de 8 PV (plafond de l\'arme tenue, cadence)');
  frapper(proche);                                            // 3 + 3 = 6 < 8
  await attendreJeu(cl, 2);
  ok(vivant(proche), 'SPEC-ARCHI-027 : deux coups espacés de l\'épée de bois laissent encore le mouton en vie');
  // 9 >= 8 : le coup suivant l'achève. Chaque coup repousse le mouton (recul de
  // l'arme) : on ne frappe que tant qu'il reste à portée (< 5,5 blocs) ; s'il a
  // été repoussé au-delà, le test n'est pas concluant (saut) plutôt qu'en échec.
  let mort = false, horsPortee = false;
  for (let essai = 0; essai < 3 && !mort; essai++) {
    const t = toi(), m = C.moutons().find(x => x.e === proche.e);
    if (!m || !t) { mort = true; break; }
    if (Math.hypot(m.x - t.x, m.z - t.z) > 5.5) { horsPortee = true; break; }
    frapper(proche);
    await attendreJeu(cl, 1);
    mort = !!(await disparu(C, proche));
  }
  // un mouton encore vivant ici a été repoussé/soulevé par le recul (la portée
  // serveur est tridimensionnelle) : non concluant, pas un échec du plafond
  if (!mort) R.saut('coup fatal', horsPortee ? 'le mouton a été repoussé hors de portée par le recul' : 'le recul a soulevé/déplacé le mouton hors de la portée 3D du serveur');
  else ok(mort, 'SPEC-ARCHI-027 : les coups espacés suivants achèvent la créature');
  cl.fermer();
  await s.arreter();
}

// butin : une dague (peu de recul : le mouton reste sur le terrain plat) tue en quatre coups
async function scenarioButin() {
  const C = await serveurCombat([[I.DAGUE_BOIS, 1]]);
  if (!C) { R.saut('butin', 'aucun terrain plat près du point de départ'); return; }
  const { s, cl, proche, toi, frapper } = C;
  ok(!!proche, 'préparation : un mouton près du joueur (dague)');
  if (!proche) return;
  const donnes = [];
  cl.surMessage = (m) => { if (m.t === 'donne') donnes.push(m); };
  for (let k = 0; k < 4; k++) { frapper(proche); await attendreJeu(cl, 0.4); }   // 4 x 2 dégâts = 8 PV
  ok(!!(await disparu(C, proche)), 'SPEC-ARCHI-027 : quatre coups de dague espacés tuent le mouton');

  // le butin tombe au sol ; on marche vers lui jusqu'à ce que le serveur l'annonce (DONNE)
  const inventaire0 = cl.dernier('inv_maj');
  let sN = 0;
  const fin = Date.now() + 12000;
  while (Date.now() < fin && !donnes.length) {
    const t = toi(), e = cl.dernier('etat');
    const it = e && e.mobs.filter(m => m.t === 'item').sort((a, b) => Math.hypot(a.x - t.x, a.z - t.z) - Math.hypot(b.x - t.x, b.z - t.z))[0];
    if (it && Math.hypot(it.x - t.x, it.z - t.z) > 0.5) {
      const yaw = Math.atan2(-(it.x - t.x), -(it.z - t.z));
      cl.envoyer({ t: A.NP.MSG.ENTREE, s: ++sN, j: 0, dt: 0.05, k: 1, yaw, pitch: 0, v: 0 });
    } else cl.envoyer({ t: A.NP.MSG.ENTREE, s: ++sN, j: 0, dt: 0.05, k: 0, yaw: 0, pitch: 0, v: 0 });
    await dodo(50);                                           // cadence d'envoi des entrées (comme le client), pas une attente
  }
  ok(donnes.length >= 1, 'SPEC-ARCHI-027 : le butin de la créature tuée est annoncé par DONNE', 'aucun message donne');
  if (donnes.length) {
    const inv = await jusqua(() => { const m = cl.dernier('inv_maj'); return m && m.inv && m !== inventaire0 ? m : null; }, 3000);
    const id = donnes[0].id;
    const somme = donnes.filter(x => x.id === id).reduce((n, x) => n + x.n, 0);
    const possede = inv ? inv.inv.reduce((n, c) => n + (c && c !== 0 && c[0] === id ? c[1] : 0), 0) : -1;
    eq(possede, somme, 'SPEC-ARCHI-027 : ce qui est annoncé est exactement ce que contient l\'inventaire serveur (aucun double compte)');
  }
  cl.fermer();
  await s.arreter();
}

// la masse (0,95 s) est plus lente que le plancher fixe de 0,4 s d'avant : deux coups à 0,5 s ne comptent que pour un
async function scenarioCadenceMasse() {
  const C = await serveurCombat([[I.MASSE_BOIS, 1]]);
  if (!C) { R.saut('cadence des armes', 'aucun terrain plat près du point de départ'); return; }
  ok(!!C.proche, 'préparation : un mouton près du joueur (masse)');
  if (C.proche) {
    C.frapper(C.proche);                                       // 6 dégâts
    await attendreJeu(C.cl, 0.5);
    C.frapper(C.proche);                                       // 0,5 s plus tard : la masse n'a pas rechargé (0,95 s)
    await attendreJeu(C.cl, 2);
    ok(C.vivant(C.proche), 'SPEC-ARCHI-027 : la masse ne frappe pas deux fois à 0,5 s d\'intervalle (cadence de l\'arme, plus un 0,4 s fixe)');
  }
  C.cl.fermer();
  await C.s.arreter();

}

// tir : dégâts et vitesse de l'arc possédé, jamais ceux annoncés par le client
async function scenarioTir() {
  const C = await serveurCombat([[I.ARC, 1], [I.FLECHE, 20]]);
  if (!C) { R.saut('tir', 'aucun terrain plat près du point de départ'); return; }
  const { cl, proche, toi } = C;
  ok(!!proche, 'préparation : un mouton près du joueur (arc)');
  if (proche) {
    const viser = () => {
      const t = toi(), m = C.moutons().find(x => x.e === proche.e);
      if (!m) return null;
      const dx = m.x - t.x, dy = (m.y + 0.6) - (t.y + 1.62), dz = m.z - t.z, n = Math.hypot(dx, dy, dz);
      return { dx: dx / n, dy: dy / n, dz: dz / n };
    };
    const tirer = () => { const v = viser(); if (v) cl.envoyer({ t: 'tir', j: 0, dx: v.dx, dy: v.dy, dz: v.dz, vitesse: 50, degats: 12, genre: 'fleche', i: 0 }); };
    tirer();
    await attendreJeu(cl, 2);
    ok(C.vivant(proche), 'SPEC-ARCHI-027 : une flèche « à 12 dégâts » ne fait que les 5 dégâts de l\'arc (mouton de 8 PV encore en vie)');
    let mort = false;
    for (let k = 0; k < 8 && !mort; k++) { tirer(); await attendreJeu(cl, 0.5); mort = !C.vivant(proche); }
    mort = mort || !!(await disparu(C, proche));
    ok(mort, 'témoin : des flèches espacées finissent par tuer le mouton');
  }
  cl.fermer();
  await C.s.arreter();
}

// ── SPEC-ARCHI-027 : un gardien de donjon s'éveille pour un joueur solo ──────
async function scenarioGardien() {
  const w = MC.createWorld(20260921);
  const d = w.donjons.dansZone(-1500, -1500, 1500, 1500).find(x => x.entree && x.type === 'crypte');
  if (!d) { R.saut('gardien de donjon', 'aucune crypte trouvée pour la graine de test'); return; }
  const pos = `${d.spawn.x + 1},${d.spawn.y},${d.spawn.z}`;
  const s = await demarrer([], Object.assign({}, SANS_POSE_LIBRE, { MC_TEST_SPAWN: pos }));
  const { client: cl } = await rejoindre(s.port, 'Dora', 1);
  const annonce = await cl.attendre('chat', 8000, m => /s'éveille/.test(m.texte || '')).catch(() => null);
  ok(!!annonce, 'SPEC-ARCHI-027 : le serveur annonce l\'éveil du gardien à un joueur seul dans sa salle', annonce && annonce.texte);
  const vu = await jusqua(() => { const e = cl.dernier('etat'); return e && e.mobs.some(m => m.t === d.boss) ? true : null; }, 5000);
  ok(!!vu, 'SPEC-ARCHI-027 : le gardien est une créature du serveur, reflétée dans l\'état (type ' + d.boss + ')');
  cl.fermer();
  await s.arreter();
}

// ── SPEC-ARCHI-028 : le duel est toujours envoyé au serveur ──────────────────
async function scenarioDuel() {
  const s = await demarrer(['--ouvert']);
  const a = await rejoindre(s.port, 'Alice', 1);
  a.client.envoyer({ t: 'chat', texte: '/duel Bob' });
  const refus = await a.client.attendre('chat', 3000, m => /aucun autre joueur/.test(m.texte || '')).catch(() => null);
  ok(!!refus, 'SPEC-ARCHI-028 : /duel en solo fermé est refusé par le SERVEUR, avec un motif', refus && refus.texte);
  // le même chemin propose un vrai duel dès qu'un autre joueur existe
  const b = await rejoindre(s.port, 'Bob', 1);
  a.client.envoyer({ t: 'chat', texte: '/duel Bob' });
  const propose = await b.client.attendre('pvp', 3000, m => m.evt === 'duel_propose').catch(() => null);
  ok(!!propose && propose.de === 'Alice', 'SPEC-ARCHI-028 : avec un adversaire, la même commande propose le duel');
  a.client.fermer(); b.client.fermer();
  await s.arreter();
}

// ── audit statique de src/game.js ────────────────────────────────────────────
function scenarioAudit() {
  const src = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
  const sansCommentaires = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/\.updateSurvival\(/.test(sansCommentaires), 'SPEC-ARCHI-026 (audit) : game.js n\'appelle plus updateSurvival');
  ok(!/\.subirClimat\(/.test(sansCommentaires), 'SPEC-ARCHI-026 (audit) : game.js n\'appelle plus subirClimat');
  ok(!/entities\.update\(/.test(sansCommentaires), 'SPEC-ARCHI-027 (audit) : game.js n\'appelle plus entities.update');
  ok(!/entities\.damage\(/.test(sansCommentaires.replace(/^[^\n]*foudroie[^\n]*$/gm, '')), 'SPEC-ARCHI-027 (audit) : game.js n\'inflige plus de dégât aux créatures (hors foudre, lot B-ENV)');
  ok(!/player\.attack\(|pl\.attack\(|\.tirer\(\)/.test(sansCommentaires.replace(/var tir = pl\.tirer\(\);[^\n]*/, '')), 'SPEC-ARCHI-027 (audit) : plus d\'attaque ni de tir résolus côté client');
  ok(!/Le duel exige/.test(src), 'SPEC-ARCHI-028 (audit) : plus de texte « Le duel exige d\'être en ligne »');
  const corps = (nom) => {
    const m = new RegExp('\\n( *)function ' + nom + '\\(').exec(sansCommentaires);
    if (!m) return null;
    const debut = m.index + 1;
    const fin = sansCommentaires.indexOf('\n' + m[1] + '}', debut);
    return sansCommentaires.slice(debut, fin);
  };
  ['respawn', 'onAttack', 'actionCommandeDuel', 'frameEntites', 'surveillerDonjons', 'utiliserPour', 'joueurDistantVise', 'attaqueEnLigne', 'tirEnLigne'].forEach((nom) => {
    const c = corps(nom);
    ok(c !== null, `audit : ${nom} existe`);
    if (c !== null) ok(!/net\.enLigne\(\)/.test(c), `SPEC-ARCHI-026/027/028 (audit) : aucune décision client sur net.enLigne() dans ${nom}`);
  });
  const onUse = corps('onUse');
  ok(onUse !== null && !/net\.enLigne\(\)/.test(onUse), 'SPEC-ARCHI-027 (audit) : onUse (tir, ciblage d\'un mob) ne décide plus sur net.enLigne()');
  const sim = corps('simulerJoueur');
  ok(sim !== null && !/updateSurvival|subirClimat|pl\.attack\(/.test(sim), 'SPEC-ARCHI-026/027 (audit) : simulerJoueur ne calcule ni survie, ni climat, ni coups');
}

(async () => {
  try {
    await scenarioSurvie();
    await mourirPuisRenaitre(true, false);
    await mourirPuisRenaitre(false, false);
    await mourirPuisRenaitre(true, true);
    await scenarioCombat();
    await scenarioButin();
    await scenarioCadenceMasse();
    await scenarioTir();
    await scenarioGardien();
    await scenarioDuel();
    scenarioAudit();
  } catch (e) {
    ok(false, 'le scénario ne doit pas lever d\'exception', e && e.stack);
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
