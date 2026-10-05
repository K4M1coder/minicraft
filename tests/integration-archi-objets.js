/* integration-archi-objets.js — présentoirs, socles et coffres suspects tenus par
   le SERVEUR (lot reporté de B-INV : SPEC-SYNC-027, SPEC-ARCHI-043, SPEC-ARCHI-044),
   sur de vrais processus server.js, sans MC_TEST_POSE_LIBRE : ici, poser et exposer
   se paient réellement sur l'inventaire du serveur.

   - 027/043 : un objet exposé par un client A apparaît chez un client B à portée sans
     action de B, et chez un client qui rejoint ensuite ; le retirer le fait disparaître
     chez tous ; remplacer rend l'ancien objet ; la casse du présentoir lâche l'objet ;
     le contenu survit à l'arrêt et à la relance du serveur ; les demandes illégitimes
     (hors portée, mauvais bloc, case vide) sont refusées sans toucher l'inventaire ;
   - 044 : coffres piégés et dorés — piège, désamorçage et butin tirés par le serveur
     (hasard imposé par MC_TEST_ALEA), jamais par le client ;
   - audit statique de src/game.js.

   Chaque scénario lance ET arrête ses serveurs (port 0). Usage :
   node tests/integration-archi-objets.js */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre, RACINE } = A;
const R = A.creerRapport('Intégration ARCHI — présentoirs, socles et coffres suspects côté serveur (SPEC-SYNC-027, SPEC-ARCHI-043/044)');
const { ok, eq } = R;

const C = A.chargerModules().Core;
const B = C.B, I = C.I;
const SANS_POSE_LIBRE = { MC_TEST_POSE_LIBRE: '' };
const serveurs = [];
async function demarrer(args, env) {
  const s = await lancer(['--port', '0'].concat(args || []), Object.assign({}, SANS_POSE_LIBRE, env || {}));
  serveurs.push(s);
  return s;
}
const pile = (c) => (c && c !== 0) ? { id: c[0], n: c[1], data: c[3] } : null;
const compte = (inv, id) => inv.reduce((n, c) => { const p = pile(c); return n + (p && p.id === id ? p.n : 0); }, 0);
const indexDe = (inv, id) => inv.findIndex(c => { const p = pile(c); return p && p.id === id; });
const seed = (liste) => ({ MC_TEST_INV: JSON.stringify(liste) });
const inventaireInitial = async (cl) => (await cl.attendre('inv_maj', 4000)).inv;
const position = (bienvenue, dx, dz) => {
  const p = bienvenue.toi[0];
  return { x: Math.floor(p.x) + (dx || 0), y: Math.floor(p.y) + 3, z: Math.floor(p.z) + (dz || 0) };
};
async function poser(cl, pos, id, caseInv) {
  cl.envoyer({ t: 'bloc', x: pos.x, y: pos.y, z: pos.z, id, j: 0, i: caseInv });
  return cl.attendre('bloc', 3000, m => m.x === pos.x && m.y === pos.y && m.z === pos.z && m.id === id);
}
// la dernière entrée connue de la case dans les messages EXPOSITIONS reçus depuis `depuis`
const vue = (liste, pos) => {
  let v = null;
  liste.forEach(m => (m.l || []).forEach(e => { if (e[0] === pos.x && e[1] === pos.y && e[2] === pos.z) v = e[3]; }));
  return v;
};
async function attendreExposition(cl, pos, id, ms) {
  return cl.attendre('expositions', ms || 3000, m => (m.l || []).some(e => e[0] === pos.x && e[1] === pos.y && e[2] === pos.z && e[3] === id));
}
function fichierMonde(dossier, graine) {
  const f = path.join(dossier, 'monde.json');
  fs.writeFileSync(f, JSON.stringify({ v: 2, graine: graine || 20260921, heure: 60, overrides: [], etats: [], crops: [] }));
  return f;
}

// ── SPEC-SYNC-027 / SPEC-ARCHI-043 : présentoirs et socles ───────────────────
async function scenarioExposition() {
  const s = await demarrer(['--ouvert'], seed([[B.PRESENTOIR, 1], [B.SOCLE, 1], [I.DIAMOND, 3], [I.EMERALD, 2], [B.STONE, 4]]));
  const a = await rejoindre(s.port, 'Alice', 1);
  const b = await rejoindre(s.port, 'Bob', 1);
  const invA = await inventaireInitial(a.client);
  await inventaireInitial(b.client);
  const A_ = a.client, B_ = b.client;
  const pp = position(a.bienvenue, 0, 0), ps = position(a.bienvenue, 2, 0), pierre = position(a.bienvenue, 0, 2);
  eq((await poser(A_, pp, B.PRESENTOIR, indexDe(invA, B.PRESENTOIR))).id, B.PRESENTOIR, 'préparation : le présentoir est posé');
  eq((await poser(A_, ps, B.SOCLE, indexDe(invA, B.SOCLE))).id, B.SOCLE, 'préparation : le socle est posé');
  await poser(A_, pierre, B.STONE, indexDe(invA, B.STONE));

  // A expose un diamant : B le voit sans rien demander
  const iDia = indexDe(invA, I.DIAMOND);
  A_.envoyer({ t: 'exposer', j: 0, x: pp.x, y: pp.y, z: pp.z, i: iDia });
  const maj = await A_.attendre('inv_maj', 3000, m => compte(m.inv, I.DIAMOND) === 2);
  ok(!!maj, 'SPEC-ARCHI-043 : exposer retire UN exemplaire de l\'inventaire du serveur (3 → 2 diamants)');
  const chezB = await attendreExposition(B_, pp, I.DIAMOND).catch(() => null);
  ok(!!chezB, 'SPEC-SYNC-027 : l\'objet exposé par A apparaît chez B à portée, sans action de B');
  const chezA = await attendreExposition(A_, pp, I.DIAMOND).catch(() => null);
  ok(!!chezA, 'SPEC-SYNC-027 : et chez A lui-même (état qui fait foi)');

  // un client qui rejoint ensuite le voit aussi
  const c = await rejoindre(s.port, 'Chloe', 1);
  const chezC = await attendreExposition(c.client, pp, I.DIAMOND, 4000).catch(() => null);
  ok(!!chezC, 'SPEC-SYNC-027 : un client qui rejoint ensuite voit l\'objet exposé (envoi à l\'arrivée)');

  // remplacer : l'ancien objet revient dans l'inventaire, le nouveau est exposé
  const invA2 = maj.inv;
  A_.envoyer({ t: 'exposer', j: 0, x: pp.x, y: pp.y, z: pp.z, i: indexDe(invA2, I.EMERALD) });
  const maj2 = await A_.attendre('inv_maj', 3000, m => compte(m.inv, I.EMERALD) === 1 && compte(m.inv, I.DIAMOND) === 3);
  ok(!!maj2, 'SPEC-ARCHI-043 : exposer un autre objet rend l\'ancien (diamant 3, émeraude 1)');
  ok(!!(await attendreExposition(B_, pp, I.EMERALD).catch(() => null)), 'SPEC-SYNC-027 : le remplacement se voit chez B');

  // le socle, lui aussi
  A_.envoyer({ t: 'exposer', j: 0, x: ps.x, y: ps.y, z: ps.z, i: indexDe(maj2.inv, I.DIAMOND) });
  ok(!!(await attendreExposition(B_, ps, I.DIAMOND).catch(() => null)), 'SPEC-SYNC-027 : un socle expose comme un présentoir');

  // refus : la pierre n\'est pas un présentoir ; le client doit retrouver l\'état qui fait foi
  await dodo(1100);   // budget anti-flood d'EXPOSER : 5 par seconde et par joueur local
  const invRef = A_.dernier('inv_maj').inv;
  const nbDiamants = compte(invRef, I.DIAMOND);
  const vuRefus = A_.depuis();
  A_.envoyer({ t: 'exposer', j: 0, x: pierre.x, y: pierre.y, z: pierre.z, i: indexDe(invRef, I.DIAMOND) });
  await A_.attendre('expositions', 3000, m => m.l.some(e => e[0] === pierre.x && e[3] === 0)).catch(() => null);
  await dodo(300);
  ok(vuRefus('expositions').some(m => m.l.some(e => e[0] === pierre.x && e[3] === 0)) && vuRefus('inv_maj').length > 0 && vuRefus('inv_maj').every(m => compte(m.inv, I.DIAMOND) === nbDiamants),
     'SPEC-ARCHI-043 : exposer sur un bloc qui n\'est pas un présentoir est refusé, l\'inventaire ne bouge pas et le client retrouve l\'état du serveur');
  await dodo(1100);
  // refus : hors de portée
  const loin = { x: pp.x + 40, y: pp.y, z: pp.z };
  const vuLoin = A_.depuis();
  A_.envoyer({ t: 'exposer', j: 0, x: loin.x, y: loin.y, z: loin.z, i: indexDe(invRef, I.DIAMOND) });
  await dodo(500);
  ok(!vuLoin('inv_maj').some(m => compte(m.inv, I.DIAMOND) !== nbDiamants), 'SPEC-ARCHI-043 : exposer hors de portée est refusé, rien ne bouge');
  await dodo(1100);
  // refus : case vide / forgée
  A_.envoyer({ t: 'exposer', j: 0, x: pp.x, y: pp.y, z: pp.z, i: 35 });
  await dodo(400);
  eq(vue(A_.messages.filter(m => m.t === 'expositions'), pp), I.EMERALD, 'SPEC-ARCHI-043 : une case vide ne vide pas le présentoir (il garde l\'émeraude)');

  // retirer : B reprend l'émeraude, A et C voient le présentoir vide
  const invB = (B_.dernier('inv_maj')).inv;
  B_.envoyer({ t: 'expo_retirer', j: 0, x: pp.x, y: pp.y, z: pp.z });
  const majB = await B_.attendre('inv_maj', 3000, m => compte(m.inv, I.EMERALD) === compte(invB, I.EMERALD) + 1);
  ok(!!majB, 'SPEC-ARCHI-043 : reprendre l\'objet exposé le remet dans l\'inventaire de celui qui le prend');
  ok(!!(await attendreExposition(A_, pp, 0).catch(() => null)) && !!(await attendreExposition(c.client, pp, 0).catch(() => null)),
     'SPEC-SYNC-027 : le présentoir vidé se voit chez tous les clients à portée');
  // retirer une seconde fois : rien à reprendre, aucune duplication
  const vuDouble = B_.depuis();
  B_.envoyer({ t: 'expo_retirer', j: 0, x: pp.x, y: pp.y, z: pp.z });
  await dodo(500);
  ok(!vuDouble('inv_maj').some(m => compte(m.inv, I.EMERALD) !== compte(majB.inv, I.EMERALD)), 'SPEC-ARCHI-043 : reprendre deux fois ne duplique rien');

  // casser le socle : l\'objet exposé tombe sur place
  const vuCasse = A_.depuis();
  A_.envoyer({ t: 'bloc', x: ps.x, y: ps.y, z: ps.z, id: 0, outil: 0, j: 0 });
  const tombe = await A_.attendre('etat', 6000, m => (m.mobs || []).some(e => e.t === 'item')).then(() => true).catch(() => false);
  ok(tombe, 'SPEC-ARCHI-043 : casser le socle lâche l\'objet exposé au sol');
  ok(!!(await attendreExposition(B_, ps, 0).catch(() => null)) || vue(vuCasse('expositions'), ps) === 0, 'SPEC-SYNC-027 : et le socle cassé n\'expose plus rien chez les autres');
  A_.fermer(); B_.fermer(); c.client.fermer();
  await s.arreter();
}

// ── persistance : le contenu exposé survit à l'arrêt et à la relance ─────────
async function scenarioPersistance() {
  const d = A.dossierTemp('mc-objets-');
  try {
    const f = fichierMonde(d);
    const env = seed([[B.PRESENTOIR, 1], [I.DIAMOND, 1]]);
    const args = ['--monde', f, '--dossier-parties', d];
    let s = await demarrer(args, env);
    let { client: cl, bienvenue } = await rejoindre(s.port, 'Aldric', 1);
    const inv0 = await inventaireInitial(cl);
    const pp = position(bienvenue, 0, 0);
    await poser(cl, pp, B.PRESENTOIR, indexDe(inv0, B.PRESENTOIR));
    cl.envoyer({ t: 'exposer', j: 0, x: pp.x, y: pp.y, z: pp.z, i: indexDe(inv0, I.DIAMOND) });
    await attendreExposition(cl, pp, I.DIAMOND);
    cl.fermer();
    await dodo(300);
    await s.arreter();
    const sauve = JSON.parse(fs.readFileSync(f, 'utf8'));
    ok(Array.isArray(sauve.expositions) && sauve.expositions.some(e => e[0] === pp.x && e[1] === pp.y && e[2] === pp.z && e[3][0] === I.DIAMOND),
       'SPEC-SYNC-027 : le fichier de monde porte le contenu exposé ' + JSON.stringify(sauve.expositions));
    s = await demarrer(args, env);
    ({ client: cl, bienvenue } = await rejoindre(s.port, 'Aldric', 1));
    ok(!!(await attendreExposition(cl, pp, I.DIAMOND, 4000).catch(() => null)), 'SPEC-SYNC-027 : après relance du serveur, l\'objet est toujours exposé et annoncé à l\'arrivée');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── partie solo importée : les expositions de l'ancien client sont reprises une fois, puis réécrites au format du serveur ──
async function scenarioImportSolo() {
  const d = A.dossierTemp('mc-objets-imp-');
  try {
    const f = path.join(d, 'monde.json');
    const px = 3, py = 41, pz = 3;
    fs.writeFileSync(f, JSON.stringify({ v: 2, graine: 20260921, heure: 60, overrides: [[px, py, pz, B.PRESENTOIR]], etats: [], crops: [],
      extras: { expositions: [[px + ',' + py + ',' + pz, I.EMERALD, 1, null], ['pas,une,cle', I.DIAMOND, 1, null], [px + ',' + py + ',' + pz, 'x', 1, null]], explores: [] } }));
    const args = ['--monde', f, '--dossier-parties', d];
    const env = { MC_TEST_SPAWN: '0.5,40,0.5' };
    let s = await demarrer(args, env);
    let { client: cl } = await rejoindre(s.port, 'Import', 1);
    const vu = await attendreExposition(cl, { x: px, y: py, z: pz }, I.EMERALD, 4000).catch(() => null);
    ok(!!vu, 'SPEC-SYNC-027 : une exposition de l\'ancienne partie solo (extras.expositions) est reprise par le serveur, les entrées mal formées écartées');
    cl.fermer();
    await dodo(300);
    await s.arreter();
    const sauve = JSON.parse(fs.readFileSync(f, 'utf8'));
    ok(Array.isArray(sauve.expositions) && sauve.expositions.length === 1 && sauve.expositions[0][3][0] === I.EMERALD,
       'SPEC-SYNC-027 : réécrite au format du serveur (expositions) ' + JSON.stringify(sauve.expositions));
    ok(!sauve.extras || !('expositions' in sauve.extras), 'SPEC-SYNC-027 : et retirée des extras (jamais écrite deux fois)');
  } finally { A.supprimerDossier(d); }
}

// ── SPEC-ARCHI-044 : coffres piégés et surprises ─────────────────────────────
const messageChat = (cl, re, ms) => cl.attendre('chat', ms || 3000, m => re.test(m.texte || ''));
async function poserSuspect(cl, inv, pos, id) { return poser(cl, pos, id, indexDe(inv, id)); }

async function scenarioSuspects() {
  // hasard imposé à 0 : piège « flèches », désamorçage réussi, surprise « butin rare »
  let s = await demarrer([], Object.assign(seed([[B.COFFRE_PIEGE, 2], [B.COFFRE_SURPRISE, 1], [I.KIT_DESAMORCAGE, 1], [B.CHEST, 1]]), { MC_TEST_ALEA: '0' }));
  let { client: cl, bienvenue } = await rejoindre(s.port, 'Piegeur', 1);
  let inv = await inventaireInitial(cl);
  const p1 = position(bienvenue, 0, 0), p2 = position(bienvenue, 2, 0), p3 = position(bienvenue, -2, 0), pc = position(bienvenue, 0, 3);
  await poserSuspect(cl, inv, p1, B.COFFRE_PIEGE);
  await poserSuspect(cl, inv, p3, B.COFFRE_PIEGE);
  await poserSuspect(cl, inv, p2, B.COFFRE_SURPRISE);
  await poser(cl, pc, B.CHEST, indexDe(inv, B.CHEST));
  inv = (cl.dernier('inv_maj')).inv;

  // un coffre ordinaire n\'est pas un coffre suspect
  const vuOrdinaire = cl.depuis();
  cl.envoyer({ t: 'coffre_suspect', j: 0, x: pc.x, y: pc.y, z: pc.z });
  await dodo(500);
  ok(vuOrdinaire('chat').length === 0 && vuOrdinaire('bloc').length === 0, 'SPEC-ARCHI-044 : COFFRE_SUSPECT sur un coffre ordinaire est ignoré');
  // hors de portée : ignoré
  const vuLoin = cl.depuis();
  cl.envoyer({ t: 'coffre_suspect', j: 0, x: p1.x + 30, y: p1.y, z: p1.z });
  await dodo(400);
  ok(vuLoin('chat').length === 0, 'SPEC-ARCHI-044 : COFFRE_SUSPECT hors de portée est ignoré');

  // sans kit : le piège se déclenche (flèches), le coffre redevient un coffre normal, ouvert devant le joueur
  cl.envoyer({ t: 'coffre_suspect', j: 0, x: p1.x, y: p1.y, z: p1.z });
  ok(!!(await messageChat(cl, /tire dessus/).catch(() => null)), 'SPEC-ARCHI-044 : sans kit, le piège (flèches) se déclenche, tiré par le serveur');
  const cle1 = p1.x + ',' + p1.y + ',' + p1.z;
  const ouvert = await cl.attendre('cont_etat', 3000, m => m.cle === cle1).catch(() => null);
  ok(ouvert && ouvert.type === 'chest', 'SPEC-ARCHI-044 : le coffre piégé devenu normal s\'ouvre (CONTENEUR_ETAT)');
  cl.envoyer({ t: 'cont_fermer', j: 0, cle: cle1 });
  eq(cl.dernier('bloc') && cl.messages.filter(m => m.t === 'bloc' && m.x === p1.x && m.y === p1.y && m.z === p1.z).pop().id, B.CHEST, 'SPEC-ARCHI-044 : le bloc est devenu un coffre ordinaire pour tous');

  // avec le kit (case désignée) : désamorcé, le kit est consommé par le serveur
  const iKit = indexDe(inv, I.KIT_DESAMORCAGE);
  cl.envoyer({ t: 'coffre_suspect', j: 0, x: p3.x, y: p3.y, z: p3.z, i: iKit });
  ok(!!(await messageChat(cl, /désamorcé/).catch(() => null)), 'SPEC-ARCHI-044 : avec le kit, le piège est désamorcé (réussite tirée par le serveur)');
  const majKit = await cl.attendre('inv_maj', 3000, m => compte(m.inv, I.KIT_DESAMORCAGE) === 0).catch(() => null);
  ok(!!majKit, 'SPEC-ARCHI-044 : le kit est consommé dans l\'inventaire du serveur');
  eq(cl.messages.filter(m => m.t === 'bloc' && m.x === p3.x && m.y === p3.y && m.z === p3.z).pop().id, B.CHEST, 'SPEC-ARCHI-044 : le coffre désamorcé est un coffre ordinaire');

  // la surprise (butin rare, hasard à 0) : un coffre contenant du butin rare, ouvert devant le joueur
  await dodo(1100);   // le budget anti-flood de COFFRE_SUSPECT est de 4 par seconde et par joueur local
  cl.envoyer({ t: 'coffre_suspect', j: 0, x: p2.x, y: p2.y, z: p2.z });
  const cle2 = p2.x + ',' + p2.y + ',' + p2.z;
  const rare = await cl.attendre('cont_etat', 3000, m => m.cle === cle2).catch(() => null);
  const butin = rare ? rare.slots.map(pile).filter(Boolean) : [];
  ok(butin.length >= 2 && butin.every(p => [I.DIAMOND, I.EMERALD, I.GOLD_INGOT, I.BIJOU].indexOf(p.id) >= 0), 'SPEC-ARCHI-044 : la surprise donne un butin rare tiré par le serveur ' + JSON.stringify(butin));
  // forger : un kit « désigné » qui n\'en est pas un ne désamorce rien
  cl.fermer();
  await s.arreter();

  // hasard à 0,95 : gaz, désamorçage raté, mimic
  s = await demarrer([], Object.assign(seed([[B.COFFRE_PIEGE, 2], [B.COFFRE_SURPRISE, 1], [I.KIT_DESAMORCAGE, 1], [B.STONE, 1]]), { MC_TEST_ALEA: '0.95' }));
  ({ client: cl, bienvenue } = await rejoindre(s.port, 'Piegeur', 1));
  inv = await inventaireInitial(cl);
  const q1 = position(bienvenue, 0, 0), q2 = position(bienvenue, 2, 0), q3 = position(bienvenue, -2, 0);
  await poserSuspect(cl, inv, q1, B.COFFRE_PIEGE);
  await poserSuspect(cl, inv, q3, B.COFFRE_PIEGE);
  await poserSuspect(cl, inv, q2, B.COFFRE_SURPRISE);
  inv = (cl.dernier('inv_maj')).inv;
  // un kit désigné sur une pierre : pas de désamorçage, le piège (gaz) se déclenche
  cl.envoyer({ t: 'coffre_suspect', j: 0, x: q1.x, y: q1.y, z: q1.z, i: indexDe(inv, B.STONE) });
  ok(!!(await messageChat(cl, /gaz toxique/).catch(() => null)), 'SPEC-ARCHI-044 : une case qui n\'est pas un kit ne désamorce rien, le piège (gaz) se déclenche');
  ok(compte((cl.dernier('inv_maj')).inv, B.STONE) === 1, 'SPEC-ARCHI-044 : et la pierre désignée n\'est pas consommée');
  // le kit rate (0,95 ≥ 0,9) : « échoue », puis le piège se déclenche
  cl.envoyer({ t: 'coffre_suspect', j: 0, x: q3.x, y: q3.y, z: q3.z, i: indexDe(inv, I.KIT_DESAMORCAGE) });
  ok(!!(await messageChat(cl, /échoue/).catch(() => null)), 'SPEC-ARCHI-044 : le désamorçage peut échouer (tiré par le serveur)');
  ok(!!(await messageChat(cl, /gaz toxique/).catch(() => null)), 'SPEC-ARCHI-044 : après un échec, le piège se déclenche');
  // la surprise « mimic »
  cl.envoyer({ t: 'coffre_suspect', j: 0, x: q2.x, y: q2.y, z: q2.z });
  ok(!!(await messageChat(cl, /pas un vrai coffre/).catch(() => null)), 'SPEC-ARCHI-044 : la surprise peut être un mimic');
  const mimic = await cl.attendre('etat', 5000, m => (m.mobs || []).some(e => e.t === 'mimic')).catch(() => null);
  ok(!!mimic, 'SPEC-ARCHI-044 : le mimic apparaît dans le monde (créé par le serveur)');
  eq(cl.messages.filter(m => m.t === 'bloc' && m.x === q2.x && m.y === q2.y && m.z === q2.z).pop().id, 0, 'SPEC-ARCHI-044 : le faux coffre disparaît');
  cl.fermer();
  await s.arreter();

  // hasard à 0,3 : explosion ; à 0,6 : alarme
  for (const [alea, re, nom, bloc0] of [['0.3', /explose/, 'explosion', true], ['0.6', /alarme/, 'alarme', false]]) {
    s = await demarrer([], Object.assign(seed([[B.COFFRE_PIEGE, 1]]), { MC_TEST_ALEA: alea }));
    ({ client: cl, bienvenue } = await rejoindre(s.port, 'Piegeur', 1));
    inv = await inventaireInitial(cl);
    const r1 = position(bienvenue, 0, 0);
    await poserSuspect(cl, inv, r1, B.COFFRE_PIEGE);
    cl.envoyer({ t: 'coffre_suspect', j: 0, x: r1.x, y: r1.y, z: r1.z });
    ok(!!(await messageChat(cl, re).catch(() => null)), `SPEC-ARCHI-044 : piège « ${nom} » tiré par le serveur`);
    if (bloc0) eq(cl.messages.filter(m => m.t === 'bloc' && m.x === r1.x && m.y === r1.y && m.z === r1.z).pop().id, 0, 'SPEC-ARCHI-044 : l\'explosion détruit le coffre');
    else ok(!!(await cl.attendre('etat', 5000, m => (m.mobs || []).filter(e => e.t === 'garde').length >= 2).catch(() => null)), 'SPEC-ARCHI-044 : l\'alarme appelle deux gardes (créés par le serveur)');
    cl.fermer();
    await s.arreter();
  }
}

// ── audit statique de src/game.js ───────────────────────────────────────────
function scenarioAudit() {
  const src = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
  const sansCommentaires = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const corps = (nom) => {
    const m = new RegExp('\\n( *)function ' + nom + '\\(').exec(sansCommentaires);
    if (!m) return null;
    const debut = m.index + 1;
    const fin = sansCommentaires.indexOf('\n' + m[1] + '}', debut);
    return sansCommentaires.slice(debut, fin);
  };
  const MUTATIONS = /consumeAt|dropItem|\.add\(|addStack|expositions\[|chests\[|world\.setBlock|entities\.spawn|player\.hurt|tirerPiege|tirerSurprise|tenterDesamorcage|Math\.random/;
  const exp = corps('interagirExposition');
  ok(!!exp && /net\.exposer|net\.retirerExposition/.test(exp) && !MUTATIONS.test(exp),
     'SPEC-ARCHI-043 (audit) : interagirExposition demande au serveur (EXPOSER, EXPOSITION_RETIRER) et ne touche ni l\'inventaire ni des tables locales');
  const sus = corps('ouvrirCoffreSuspect');
  ok(!!sus && /net\.coffreSuspect/.test(sus) && !MUTATIONS.test(sus),
     'SPEC-ARCHI-044 (audit) : ouvrirCoffreSuspect demande au serveur (COFFRE_SUSPECT) ; piège, désamorçage et butin ne sont plus tirés par le client');
  ok(!/function declencherPiege/.test(sansCommentaires), 'SPEC-ARCHI-044 (audit) : plus de declencherPiege local dans game.js');
}

(async () => {
  try {
    await scenarioExposition();
    await scenarioPersistance();
    await scenarioImportSolo();
    await scenarioSuspects();
    scenarioAudit();
  } catch (e) {
    ok(false, 'le scénario ne doit pas lever d\'exception', e && e.stack);
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
