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
// attente par sondage borné (jamais par délai fixe) ; renvoie la valeur vraie, ou null au bout de `ms`
async function jusqua(f, ms) {
  const fin = Date.now() + (ms || 3000);
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > fin) return null;
    await new Promise(r => setTimeout(r, 25));
  }
}
/* Barrière : le serveur traite les messages d'un client dans l'ordre et répond au ping de trame après
   eux. Quand le pong revient, tout ce qui précédait est traité et ses réponses sont déjà reçues : on peut
   alors affirmer qu'il n'y a PAS eu de réponse, sans rien attendre au hasard. */
async function barriere(cl) {
  const n = cl.pongs;
  cl.ping();
  return !!(await jusqua(() => cl.pongs > n, 4000));
}
/* Envoie `msg`, puis le renvoie à intervalle tant que `predicat` n'est pas vrai (borné) : un message au-delà
   du budget anti-flood est ignoré sans réponse, il n'y a donc rien à attendre d'autre que le budget qui se
   vide ; le renvoi est sans effet de bord pour les refus et pour les actions dont on attend le résultat. */
async function insister(cl, msg, predicat, ms) {
  const fin = Date.now() + (ms || 6000);
  for (;;) {
    cl.envoyer(msg);
    const v = await jusqua(predicat, 400);
    if (v) return v;
    if (Date.now() > fin) return null;
  }
}
const pvDe = (cl) => { const e = cl.dernier('etat'); return e && e.toi && e.toi[0] ? e.toi[0].pv : null; };
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
  // (le budget anti-flood d'EXPOSER est de 5 par seconde et par joueur local : `insister` renvoie tant que rien n'est revenu)
  // l'exposition sur le socle a retiré un diamant : on attend l'inventaire qui en rend compte (2 restants)
  ok(!!(await jusqua(() => compte(A_.dernier('inv_maj').inv, I.DIAMOND) === 2)), 'SPEC-ARCHI-043 : exposer sur le socle retire aussi UN diamant (3 → 2)');
  const invRef = A_.dernier('inv_maj').inv;
  const nbDiamants = compte(invRef, I.DIAMOND);
  const vuRefus = A_.depuis();
  const refusPierre = await insister(A_, { t: 'exposer', j: 0, x: pierre.x, y: pierre.y, z: pierre.z, i: indexDe(invRef, I.DIAMOND) },
    () => vuRefus('expositions').some(m => m.l.some(e => e[0] === pierre.x && e[3] === 0)) && vuRefus('inv_maj').length > 0);
  ok(!!refusPierre && vuRefus('inv_maj').every(m => compte(m.inv, I.DIAMOND) === nbDiamants),
     'SPEC-ARCHI-043 : exposer sur un bloc qui n\'est pas un présentoir est refusé, l\'inventaire ne bouge pas et le client retrouve l\'état du serveur');
  // refus : loin de tout support (la portée d'un VRAI présentoir lointain est éprouvée dans scenarioRefus)
  const loin = { x: pp.x + 40, y: pp.y, z: pp.z };
  const vuLoin = A_.depuis();
  const refusLoin = await insister(A_, { t: 'exposer', j: 0, x: loin.x, y: loin.y, z: loin.z, i: indexDe(invRef, I.DIAMOND) },
    () => vuLoin('expositions').some(m => m.l.some(e => e[0] === loin.x && e[3] === 0)));
  ok(!!refusLoin && !vuLoin('inv_maj').some(m => compte(m.inv, I.DIAMOND) !== nbDiamants), 'SPEC-ARCHI-043 : exposer sur une case sans support est refusé, rien ne bouge');
  // refus : case vide / forgée
  const vuVide = A_.depuis();
  const refusVide = await insister(A_, { t: 'exposer', j: 0, x: pp.x, y: pp.y, z: pp.z, i: 35 },
    () => vuVide('expositions').some(m => m.l.some(e => e[0] === pp.x && e[1] === pp.y && e[2] === pp.z)));
  ok(!!refusVide && vue(vuVide('expositions'), pp) === I.EMERALD, 'SPEC-ARCHI-043 : une case vide ne vide pas le présentoir (il garde l\'émeraude)');

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
  ok(await barriere(B_) && vuDouble('inv_maj').length > 0 && !vuDouble('inv_maj').some(m => compte(m.inv, I.EMERALD) !== compte(majB.inv, I.EMERALD)),
     'SPEC-ARCHI-043 : reprendre deux fois ne duplique rien (refus, et le client retrouve l\'état du serveur)');

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
  ok(await barriere(cl) && vuOrdinaire('chat').length === 0 && vuOrdinaire('bloc').length === 0 && vuOrdinaire('cont_etat').length === 0, 'SPEC-ARCHI-044 : COFFRE_SUSPECT sur un coffre ordinaire est ignoré');
  // hors de portée : ignoré
  const vuLoin = cl.depuis();
  cl.envoyer({ t: 'coffre_suspect', j: 0, x: p1.x + 30, y: p1.y, z: p1.z });
  ok(await barriere(cl) && vuLoin('chat').length === 0, 'SPEC-ARCHI-044 : COFFRE_SUSPECT sur une case sans coffre suspect est ignoré (la portée d\'un vrai coffre lointain est éprouvée dans scenarioRefus)');

  // sans kit : le piège se déclenche (flèches), le coffre redevient un coffre normal, ouvert devant le joueur
  cl.envoyer({ t: 'coffre_suspect', j: 0, x: p1.x, y: p1.y, z: p1.z });
  ok(!!(await messageChat(cl, /tire dessus/).catch(() => null)), 'SPEC-ARCHI-044 : sans kit, le piège (flèches) se déclenche, tiré par le serveur');
  ok(!!(await jusqua(() => pvDe(cl) !== null && pvDe(cl) <= 14)), 'SPEC-ARCHI-044 : les flèches font 6 points de dégâts au joueur, appliqués par le serveur (20 → 14) ' + pvDe(cl));
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
  // le budget anti-flood de COFFRE_SUSPECT est de 4 par seconde et par joueur local : on renvoie tant que le coffre ne s'est pas ouvert
  const cle2 = p2.x + ',' + p2.y + ',' + p2.z;
  const rare = await insister(cl, { t: 'coffre_suspect', j: 0, x: p2.x, y: p2.y, z: p2.z }, () => cl.messages.find(m => m.t === 'cont_etat' && m.cle === cle2));
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
  ok(!!(await jusqua(() => pvDe(cl) !== null && pvDe(cl) < 20, 9000)), 'SPEC-ARCHI-044 : le gaz toxique rend malade : de petites brûlures s\'ensuivent, appliquées par le serveur ' + pvDe(cl));
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

// ── refus et robustesse côté serveur : portée réelle, état d'un chunk, support disparu, joueur mort, dégâts ──
/* Le monde est fabriqué : le joueur reste à (0,5 ; 40 ; 0,5) (MC_TEST_SPAWN), les blocs sont posés par le fichier de monde.
   Portée de pose : 7 blocs. Près : présentoir N (3,41,3), pierre (1,41,3), trois coffres piégés (dont un en -4,41,3)
   (-2,41,3) et (-3,41,3). Loin (14 blocs) : présentoir F (14,41,3) exposant un diamant, coffre piégé G (14,41,6).
   Sans support : une exposition sur (5,41,5), où il n'y a que de l'air (explosion, feu : le support a disparu). */
async function scenarioRefus() {
  const d = A.dossierTemp('mc-objets-ref-');
  try {
    const N = { x: 3, y: 41, z: 3 }, PIERRE = { x: 1, y: 41, z: 3 }, T3 = { x: -4, y: 41, z: 3 };
    const T1 = { x: -2, y: 41, z: 3 }, T2 = { x: -3, y: 41, z: 3 };
    const F = { x: 14, y: 41, z: 3 }, G = { x: 14, y: 41, z: 6 }, VIDE = { x: 5, y: 41, z: 5 };
    const f = path.join(d, 'monde.json');
    const blocs = [[N, B.PRESENTOIR], [PIERRE, B.STONE], [T3, B.COFFRE_PIEGE], [T1, B.COFFRE_PIEGE], [T2, B.COFFRE_PIEGE], [F, B.PRESENTOIR], [G, B.COFFRE_PIEGE]];
    fs.writeFileSync(f, JSON.stringify({ v: 2, graine: 20260921, heure: 60, overrides: blocs.map(b => [b[0].x, b[0].y, b[0].z, b[1]]), etats: [], crops: [],
      extras: { expositions: [[F.x + ',' + F.y + ',' + F.z, I.DIAMOND, 1, null], [VIDE.x + ',' + VIDE.y + ',' + VIDE.z, I.EMERALD, 1, null]], explores: [] } }));
    const s = await demarrer(['--monde', f, '--dossier-parties', d], Object.assign(seed([[I.DIAMOND, 3], [I.EMERALD, 2]]), { MC_TEST_SPAWN: '0.5,40,0.5', MC_TEST_ALEA: '0.3' }));
    const { client: cl } = await rejoindre(s.port, 'Refus', 1);
    const inv0 = await inventaireInitial(cl);
    const iDia = indexDe(inv0, I.DIAMOND), iEme = indexDe(inv0, I.EMERALD);
    ok(iDia >= 0 && iEme >= 0, 'préparation : le joueur porte des diamants et des émeraudes');

    // SPEC-SYNC-027 : l'état complet d'un chunk part quand le client le demande (sa branche serveur)
    cl.envoyer({ t: 'overrides_demande', cx: 0, cz: 0 });
    const chunk = await cl.attendre('expositions', 3000, m => m.cx === 0 && m.cz === 0).catch(() => null);
    ok(!!chunk && chunk.l.some(e => e[0] === F.x && e[1] === F.y && e[2] === F.z && e[3] === I.DIAMOND),
       'SPEC-SYNC-027 : le chunk que le client charge reçoit l\'état complet de ses présentoirs (cx, cz, objets exposés)');

    // le support a disparu (explosion, feu) : l'objet n'est pas annoncé, il tombe sur place
    ok(!cl.messages.some(m => m.t === 'expositions' && m.l.some(e => e[0] === VIDE.x && e[1] === VIDE.y && e[2] === VIDE.z && e[3] !== 0)),
       'SPEC-SYNC-027 : une exposition dont le support a disparu n\'est jamais annoncée aux clients');
    const tombe = await cl.attendre('etat', 5000, m => (m.mobs || []).some(e => e.t === 'item')).catch(() => null);
    ok(!!tombe, 'SPEC-ARCHI-043 : l\'objet dont le support a disparu tombe sur place (lâché par le serveur)');

    // portée : un VRAI présentoir, garni, à 14 blocs (portée 7). EXPOSER et EXPOSITION_RETIRER sont refusés
    const vuF = cl.depuis();
    const refusExposer = await insister(cl, { t: 'exposer', j: 0, x: F.x, y: F.y, z: F.z, i: iEme },
      () => vuF('expositions').some(m => m.l.some(e => e[0] === F.x && e[1] === F.y && e[2] === F.z)));
    ok(!!refusExposer && vue(vuF('expositions'), F) === I.DIAMOND && vuF('inv_maj').every(m => compte(m.inv, I.EMERALD) === 2 && compte(m.inv, I.DIAMOND) === 3),
       'SPEC-ARCHI-043 : exposer sur un présentoir réel hors de portée est refusé (l\'objet exposé reste, l\'inventaire ne bouge pas)');
    const vuR = cl.depuis();
    const refusRetirer = await insister(cl, { t: 'expo_retirer', j: 0, x: F.x, y: F.y, z: F.z },
      () => vuR('expositions').some(m => m.l.some(e => e[0] === F.x && e[1] === F.y && e[2] === F.z)));
    ok(!!refusRetirer && vue(vuR('expositions'), F) === I.DIAMOND && vuR('inv_maj').every(m => compte(m.inv, I.DIAMOND) === 3),
       'SPEC-ARCHI-043 : reprendre l\'objet d\'un présentoir hors de portée est refusé (rien ne passe dans l\'inventaire)');
    // portée : un VRAI coffre piégé à 14 blocs ne se déclenche pas
    const vuG = cl.depuis();
    cl.envoyer({ t: 'coffre_suspect', j: 0, x: G.x, y: G.y, z: G.z });
    ok(await barriere(cl) && vuG('chat').length === 0 && vuG('bloc').length === 0 && vuG('cont_etat').length === 0,
       'SPEC-ARCHI-044 : COFFRE_SUSPECT sur un vrai coffre piégé hors de portée est ignoré (aucun piège, aucun changement de bloc)');

    // dégâts : l'explosion fait 10 points, appliqués par le serveur ; deux explosions tuent
    cl.envoyer({ t: 'coffre_suspect', j: 0, x: T1.x, y: T1.y, z: T1.z });
    ok(!!(await messageChat(cl, /explose/).catch(() => null)), 'SPEC-ARCHI-044 : le piège « explosion » se déclenche');
    ok(!!(await jusqua(() => pvDe(cl) !== null && pvDe(cl) <= 10)), 'SPEC-ARCHI-044 : l\'explosion fait 10 points de dégâts au joueur (20 → 10) ' + pvDe(cl));
    cl.envoyer({ t: 'coffre_suspect', j: 0, x: T2.x, y: T2.y, z: T2.z });
    const mort = await jusqua(() => { const e = cl.dernier('etat'); return e && e.toi && e.toi[0] && e.toi[0].mort === 1; });
    ok(!!mort, 'préparation : une seconde explosion tue le joueur (état du serveur) ' + pvDe(cl));

    // joueur mort : EXPOSER et COFFRE_SUSPECT n'ont aucun effet (même à portée, sur un support valide)
    const vuMort = cl.depuis();
    cl.envoyer({ t: 'exposer', j: 0, x: N.x, y: N.y, z: N.z, i: iDia });
    cl.envoyer({ t: 'coffre_suspect', j: 0, x: T3.x, y: T3.y, z: T3.z });
    ok(await barriere(cl) && vuMort('expositions').length === 0 && vuMort('inv_maj').length === 0 && vuMort('chat').length === 0 && vuMort('bloc').length === 0,
       'SPEC-ARCHI-043 : un joueur mort n\'expose rien et n\'ouvre aucun coffre piégé (ni message, ni bloc, ni inventaire modifié)');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── inventaire plein : l'objet repris tombe aux pieds, jamais perdu (SPEC-ARCHI-043) ──
async function scenarioInventairePlein() {
  const fillers = Object.keys(C.I).map(k => C.I[k]).filter(id => id !== I.DIAMOND_SWORD).slice(0, 34);
  const plein = fillers.map(id => [id, 1]).concat([[B.PRESENTOIR, 1], [I.DIAMOND_SWORD, 1]]);
  const s = await demarrer(['--ouvert'], seed(plein));
  const a = await rejoindre(s.port, 'Alice', 1);
  const b = await rejoindre(s.port, 'Bob', 1);
  const invA = await inventaireInitial(a.client);
  const invB = await inventaireInitial(b.client);
  eq(invB.filter(c => c && c !== 0).length, 36, 'préparation : l\'inventaire de Bob est plein (36 cases)');
  const pp = position(a.bienvenue, 0, 0);
  await poser(a.client, pp, B.PRESENTOIR, indexDe(invA, B.PRESENTOIR));
  a.client.envoyer({ t: 'exposer', j: 0, x: pp.x, y: pp.y, z: pp.z, i: indexDe(invA, I.DIAMOND_SWORD) });
  ok(!!(await attendreExposition(b.client, pp, I.DIAMOND_SWORD).catch(() => null)), 'préparation : Alice expose l\'épée, Bob la voit');
  const sol0 = b.client.messages.filter(m => m.t === 'etat' && (m.mobs || []).some(e => e.t === 'item')).length;
  b.client.envoyer({ t: 'expo_retirer', j: 0, x: pp.x, y: pp.y, z: pp.z });
  ok(!!(await attendreExposition(b.client, pp, 0).catch(() => null)), 'SPEC-ARCHI-043 : Bob reprend l\'objet exposé');
  const tombe = await b.client.attendre('etat', 5000, m => (m.mobs || []).some(e => e.t === 'item')).catch(() => null);
  ok(!!tombe && sol0 === 0, 'SPEC-ARCHI-043 : inventaire plein, l\'objet repris tombe aux pieds (rien n\'est perdu)');
  await barriere(b.client);
  ok(compte(b.client.dernier('inv_maj').inv, I.DIAMOND_SWORD) === 1, 'SPEC-ARCHI-043 : et l\'inventaire plein de Bob ne gagne pas de second exemplaire');
  a.client.fermer(); b.client.fermer();
  await s.arreter();
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
    await scenarioRefus();
    await scenarioInventairePlein();
    scenarioAudit();
  } catch (e) {
    ok(false, 'le scénario ne doit pas lever d\'exception', e && e.stack);
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
