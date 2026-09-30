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
/* Un flux d'entrées au rythme du jeu : 20 par seconde, dt 0,05. */
function fluxEntrees(cl, opts) {
  opts = opts || {};
  let s = 0;
  const t = setInterval(() => {
    cl.envoyer({ t: A.NP.MSG.ENTREE, s: ++s, j: 0, dt: 0.05, k: opts.k || 0, yaw: opts.yaw || 0, pitch: 0, v: 0 });
  }, 50);
  return { arreter() { clearInterval(t); }, envoyees: () => s };
}
function monde(hp, faim, inv) {
  const SLOTS = MC.ContratsV2.BORNES.SLOTS_INV;
  const cases = new Array(SLOTS).fill(0);
  (inv || []).forEach((p, i) => { cases[i] = p; });
  return {
    v: 2, graine: 20260921, heure: 60, overrides: [], etats: [], crops: [],
    soloJoueur: { v: 1, inv: cases, equip: {}, etat: { hp, hunger: faim, air: 10 } },
  };
}
async function poserBloc(cl, pos, id) {
  cl.envoyer({ t: 'bloc', x: pos.x, y: pos.y, z: pos.z, id, j: 0, i: 0 });
  return cl.attendre('bloc', 3000, m => m.x === pos.x && m.y === pos.y && m.z === pos.z);
}

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

    // sans aucune entrée, rien ne change (le client ne calcule rien : le serveur seul fait vivre le corps)
    await cl.attendre('etat', 3000);
    const flux = fluxEntrees(cl);
    // la régénération soigne (PV) puis épuise (faim) : les deux viennent de l'état reçu
    const soigne = await jusqua(() => { const e = etatToi(cl); return e && e.pv > 4 ? e : null; }, 20000);
    ok(!!soigne, 'SPEC-ARCHI-026 : la vie remonte par l\'état du serveur (régénération)');
    const affame = await jusqua(() => { const e = etatToi(cl); return e && e.faim < 20 ? e : null; }, 30000);
    ok(!!affame, 'SPEC-ARCHI-026 : la faim baisse par l\'état du serveur (épuisement)');
    flux.arreter();

    // gel : entrées coupées, valeurs lues, PAUSE, entrées reprises 3 s, reprise
    await dodo(300);
    const avant = etatToi(cl);
    cl.envoyer({ t: 'pause', actif: true });
    await cl.attendre('pause_etat', 3000, m => m.actif === true);
    const fluxPause = fluxEntrees(cl);
    await dodo(3000);
    fluxPause.arreter();
    cl.envoyer({ t: 'pause', actif: false });
    await cl.attendre('pause_etat', 3000, m => m.actif === false);
    const nEtat = cl.messages.length;
    const apres = await cl.attendre('etat', 3000, m => cl.messages.indexOf(m) >= nEtat);
    ok(apres.toi[0].pv === avant.pv && apres.toi[0].faim === avant.faim,
       'SPEC-ARCHI-026 : PV et faim n\'ont pas bougé pendant la pause (même en recevant des entrées)',
       `avant ${avant.pv}/${avant.faim}, après ${apres.toi[0].pv}/${apres.toi[0].faim}`);
    // témoin : la reprise refait vivre le corps
    const flux2 = fluxEntrees(cl);
    const repart = await jusqua(() => { const e = etatToi(cl); return e && (e.pv !== avant.pv || e.faim !== avant.faim) ? e : null; }, 20000);
    flux2.arreter();
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
    fs.writeFileSync(f, JSON.stringify(monde(1, 0)));
    const s = await demarrer(['--monde', f, '--dossier-parties', d], { MC_DIFFICULTE: 'normal' });
    const { client: cl, bienvenue } = await rejoindre(s.port, 'Bob', 1);
    const dep = bienvenue.toi[0];
    let bed = null;
    if (avecLit) {
      bed = { x: Math.floor(dep.x), y: Math.floor(dep.y) + 3, z: Math.floor(dep.z) };
      const rep = await poserBloc(cl, bed, B.LIT);
      eq(rep.id, B.LIT, 'préparation : le lit est posé');
      cl.envoyer({ t: 'dormir', j: 0, actif: true });
      if (litDetruit) {
        cl.envoyer({ t: 'bloc', x: bed.x, y: bed.y, z: bed.z, id: 0, j: 0 });
        await cl.attendre('bloc', 3000, m => m.x === bed.x && m.y === bed.y && m.z === bed.z && m.id === 0);
      }
    }
    // la famine (faim 0, difficulté normale) achève le dernier PV au bout de 4 s de jeu
    const flux = fluxEntrees(cl);
    const mort = await jusqua(() => { const e = etatToi(cl); return e && e.mort === 1 ? e : null; }, 20000);
    flux.arreter();
    ok(!!mort, 'préparation : le joueur meurt de faim sur le serveur');

    // le monde est figé : le mort renaît quand même
    cl.envoyer({ t: 'pause', actif: true });
    await cl.attendre('pause_etat', 3000, m => m.actif === true);
    cl.envoyer({ t: 'renaitre', j: 0 });
    await dodo(300);
    cl.envoyer({ t: 'pause', actif: false });
    await cl.attendre('pause_etat', 3000, m => m.actif === false);
    const vivant = await jusqua(() => { const e = etatToi(cl); return e && e.mort === 0 ? e : null; }, 6000);
    ok(!!vivant, 'SPEC-ARCHI-026 : RENAITRE envoyé PENDANT la pause est traité (le mort renaît)');
    if (vivant) {
      ok(vivant.pv === 20 && vivant.faim === 20 && vivant.air === 10, 'SPEC-ARCHI-026 : vie, faim et air remis par le serveur', JSON.stringify(vivant));
      if (avecLit && !litDetruit) {
        ok(Math.abs(vivant.x - (bed.x + 0.5)) < 0.01 && Math.abs(vivant.z - (bed.z + 0.5)) < 0.01 && Math.abs(vivant.y - (bed.y + 1.05)) < 0.01,
           'SPEC-ARCHI-026 : le lieu de renaissance est le lit, décidé par le serveur', JSON.stringify([vivant.x, vivant.y, vivant.z, bed]));
      } else {
        ok(Math.abs(vivant.x - dep.x) < 0.01 && Math.abs(vivant.y - dep.y) < 0.01 && Math.abs(vivant.z - dep.z) < 0.01,
           litDetruit ? 'SPEC-ARCHI-026 : le lit a été détruit, retour au point d\'apparition' : 'SPEC-ARCHI-026 : sans lit, renaissance au point d\'apparition du serveur',
           JSON.stringify([vivant.x, vivant.y, vivant.z, dep.x, dep.y, dep.z]));
      }
    }
    // un vivant qui envoie RENAITRE n'est pas téléporté
    const avantRen = etatToi(cl);
    cl.envoyer({ t: 'renaitre', j: 0 });
    const n = cl.messages.length;
    const e2 = await cl.attendre('etat', 3000, m => cl.messages.indexOf(m) >= n);
    ok(e2.toi[0].x === avantRen.x && e2.toi[0].z === avantRen.z && e2.toi[0].pv === avantRen.pv, 'SPEC-ARCHI-026 : RENAITRE d\'un joueur vivant est sans effet');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── SPEC-ARCHI-027 : coups validés, butin par DONNE ──────────────────────────
/* Un décalage (dx, dz) de 1,5 bloc depuis le point d'apparition dont le chemin
   (3 blocs, à hauteur des pieds et de la tête) est libre : le butin doit pouvoir
   être atteint à pied. Calculé sur le MÊME monde que le serveur (même graine). */
function directionLibre() {
  const w = MC.createWorld(20260921);
  const col = w.findSpawnColumn();
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(Math.floor(col[0] / 16) + cx, Math.floor(col[1] / 16) + cz, true);
  const y0 = Math.floor(w.groundAt(col[0], col[1], true) + 1.2);
  const solide = (x, y, z) => MC.Core.isSolid(w.getBlock(x, y, z));
  for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let libre = true;
    for (let k = 1; k <= 3 && libre; k++) {
      for (let dy = 0; dy <= 1; dy++) if (solide(col[0] + ux * k, y0 + dy, col[1] + uz * k)) libre = false;
    }
    if (libre) return { dx: ux * 1.5, dz: uz * 1.5, ux, uz };
  }
  return null;
}
async function scenarioCombat() {
  const dir = directionLibre();
  if (!dir) { R.saut('combat et butin', 'aucune direction dégagée autour du point de départ'); return; }
  const s = await demarrer([], Object.assign({}, SANS_POSE_LIBRE, seed([[I.WOOD_SWORD, 1]]),
    { MC_TEST_MOBS: JSON.stringify([['sheep', dir.dx, dir.dz], ['sheep', 24 * dir.ux + 24 * (dir.uz ? 1 : 0), 24 * dir.uz]]) }));
  const { client: cl } = await rejoindre(s.port, 'Chloe', 1);
  await cl.attendre('inv_maj', 4000);
  const moutons = () => { const e = cl.dernier('etat'); return e ? e.mobs.filter(m => m.t === 'sheep') : []; };
  const toi = () => etatToi(cl);
  const proche = await jusqua(() => { const t = toi(); return t && moutons().find(m => Math.hypot(m.x - t.x, m.z - t.z) < 5); }, 5000);
  const loin = await jusqua(() => { const t = toi(); return t && moutons().find(m => Math.hypot(m.x - t.x, m.z - t.z) > 12); }, 3000);
  ok(!!proche, 'préparation : un mouton près du joueur');
  if (!proche) return;
  const vivant = (m) => !!moutons().find(x => x.e === m.e);
  const apresProchainEtat = async () => { const n = cl.messages.length; await cl.attendre('etat', 3000, m => cl.messages.indexOf(m) >= n); };
  const frapper = (m, degats) => cl.envoyer({ t: 'attaque', eid: m.e, degats: degats === undefined ? 12 : degats, j: 0 });

  // portée : un mouton lointain n'est jamais touché
  if (loin) {
    frapper(loin);
    await dodo(500);
    frapper(loin);
    await apresProchainEtat();
    ok(vivant(loin), 'SPEC-ARCHI-027 : un coup sur une créature hors de portée est ignoré');
  } else R.saut('coup hors de portée', 'aucun mouton lointain dans l\'état reçu');

  // dégâts : le client annonce 12, le serveur applique ceux du bois (3) sur 8 PV
  frapper(proche);
  await apresProchainEtat();
  ok(vivant(proche), 'SPEC-ARCHI-027 : « 12 dégâts » annoncés avec une épée de bois ne tuent pas un mouton de 8 PV (plafond serveur)');
  // cadence : une rafale de six coups immédiats ne compte pour rien de plus (3 + 0 = 3 < 8 : la créature vit)
  for (let k = 0; k < 6; k++) frapper(proche);
  await dodo(100);
  await apresProchainEtat();
  ok(vivant(proche), 'SPEC-ARCHI-027 : une rafale de coups est limitée par la cadence serveur (un cheat à 60 coups/s ne tue pas)');
  // des coups espacés (cadence respectée) finissent par tuer : 3 + 3 + 3 = 9 >= 8
  const donnes = [];
  cl.surMessage = (m) => { if (m.t === 'donne') donnes.push(m); };
  let mort = false;
  for (let k = 0; k < 8 && !mort; k++) {
    await dodo(650);
    frapper(proche);
    mort = !!(await jusqua(() => !vivant(proche), 150));
  }
  ok(mort, 'SPEC-ARCHI-027 : des coups espacés tuent la créature');

  // le butin tombe au sol ; on marche vers lui jusqu'à ce que le serveur l'annonce (DONNE)
  const inventaire0 = await jusqua(() => cl.dernier('inv_maj'), 1000);
  const flux = { s: 0 };
  const fin = Date.now() + 12000;
  while (Date.now() < fin && !donnes.length) {
    const t = toi(), e = cl.dernier('etat');
    const it = e && e.mobs.filter(m => m.t === 'item').sort((a, b) => Math.hypot(a.x - t.x, a.z - t.z) - Math.hypot(b.x - t.x, b.z - t.z))[0];
    if (it && Math.hypot(it.x - t.x, it.z - t.z) > 0.5) {
      const yaw = Math.atan2(-(it.x - t.x), -(it.z - t.z));
      cl.envoyer({ t: A.NP.MSG.ENTREE, s: ++flux.s, j: 0, dt: 0.05, k: 1, yaw, pitch: 0, v: 0 });
    } else cl.envoyer({ t: A.NP.MSG.ENTREE, s: ++flux.s, j: 0, dt: 0.05, k: 0, yaw: 0, pitch: 0, v: 0 });
    await dodo(50);
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
