/* integration-archi-inv.js — lot B-INV du chantier « solo = serveur toujours
   présent » : SPEC-ARCHI-030 à 033 et les prérequis SPEC-SYNC-026 et 028, sur
   de vrais processus server.js (serveur FERMÉ au réseau, comme le solo), sans
   le réglage MC_TEST_POSE_LIBRE des autres suites : ici, poser et tirer se
   paient réellement sur l'inventaire du serveur.

   - 030 : coffre, fourneau et banque s'ouvrent par CONTENEUR_ETAT ; un fourneau
     dont la fenêtre est fermée cuit quand même (rien n'est envoyé), et son
     résultat est là à la réouverture ;
   - 031 : manger un aliment absent est refusé ; un objet lâché apparaît dans
     l'ETAT reçu ; une pose jamais possédée est refusée, une pose possédée est
     débitée UNE seule fois malgré le journal INV_CONSOMMER du client ; un tir
     sans munition ne crée aucun projectile ;
   - 032 : un marchand se consulte et se négocie par TROC en serveur fermé ;
   - 033 : bloc de commande — hôte local en créatif accepté, en survie refusé,
     client distant refusé même en créatif ;
   - audit statique de src/game.js.

   Usage : node tests/integration-archi-inv.js */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre, adressesNonLocales, RACINE, NP } = A;
const R = A.creerRapport('Intégration ARCHI — B-INV : conteneurs, inventaire, commerce, bloc de commande');
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
const pile = (c) => (c && c !== 0) ? { id: c[0], n: c[1] } : null;
const compte = (inv, id) => inv.reduce((n, c) => { const p = pile(c); return n + (p && p.id === id ? p.n : 0); }, 0);
const indexDe = (inv, id) => inv.findIndex(c => { const p = pile(c); return p && p.id === id; });
const seed = (liste) => ({ MC_TEST_INV: JSON.stringify(liste) });

async function inventaireInitial(client) { return (await client.attendre('inv_maj', 4000)).inv; }
function positionBloc(bienvenue, dx) {
  const p = bienvenue.toi[0];
  return { x: Math.floor(p.x) + (dx || 0), y: Math.floor(p.y) + 3, z: Math.floor(p.z) };
}
async function poser(client, pos, id, caseInv) {
  client.envoyer({ t: 'bloc', x: pos.x, y: pos.y, z: pos.z, id, j: 0, i: caseInv });
  return client.attendre('bloc', 3000, m => m.x === pos.x && m.y === pos.y && m.z === pos.z);
}

// ── SPEC-ARCHI-030 : conteneurs posés et fourneaux ───────────────────────────
async function scenarioConteneurs() {
  const s = await demarrer([], seed([[B.CHEST, 1], [B.FURNACE, 1], [B.COFFRE_FORT, 1], [I.COAL, 4], [B.IRON_ORE, 2]]));
  const { client: cl, bienvenue } = await rejoindre(s.port, 'Alice', 1);
  const inv0 = await inventaireInitial(cl);
  let seq = 0;

  const pc = positionBloc(bienvenue, 0);
  const rep = await poser(cl, pc, B.CHEST, indexDe(inv0, B.CHEST));
  eq(rep.id, B.CHEST, 'SPEC-ARCHI-030 : le coffre posé est accepté (le joueur en possède un)');
  const cle = `${pc.x},${pc.y},${pc.z}`;
  cl.envoyer({ t: 'cont_ouvrir', j: 0, x: pc.x, y: pc.y, z: pc.z });
  const etatCoffre = await cl.attendre('cont_etat', 3000, m => m.cle === cle);
  eq(etatCoffre.type, 'chest', 'SPEC-ARCHI-030 : ouvrir un coffre en solo fermé donne le contenu de CONTENEUR_ETAT');
  cl.envoyer({ t: 'cont_fermer', j: 0, cle });

  // la banque : un bloc coffre-fort ouvre la banque du joueur, côté serveur
  const pb = positionBloc(bienvenue, 2);
  await poser(cl, pb, B.COFFRE_FORT, indexDe(inv0, B.COFFRE_FORT));
  cl.envoyer({ t: 'cont_ouvrir', j: 0, x: pb.x, y: pb.y, z: pb.z });
  const etatBanque = await cl.attendre('cont_etat', 3000, m => m.type === 'banque');
  eq(etatBanque.cle, 'banque', 'SPEC-ARCHI-030 : la banque (coffre-fort) s\'ouvre par CONTENEUR_ETAT');
  cl.envoyer({ t: 'cont_fermer', j: 0, cle: 'banque' });

  // le fourneau : minerai + combustible, puis fenêtre fermée
  const pf = positionBloc(bienvenue, -2);
  await poser(cl, pf, B.FURNACE, indexDe(inv0, B.FURNACE));
  const cleF = `${pf.x},${pf.y},${pf.z}`;
  cl.envoyer({ t: 'cont_ouvrir', j: 0, x: pf.x, y: pf.y, z: pf.z });
  const etatF = await cl.attendre('cont_etat', 3000, m => m.cle === cleF);
  eq(etatF.type, 'furnace', 'SPEC-ARCHI-030 : ouvrir un fourneau donne son contenu par CONTENEUR_ETAT');
  const iMinerai = indexDe(inv0, B.IRON_ORE), iCharbon = indexDe(inv0, I.COAL);
  cl.envoyer({ t: 'cont_transfert', j: 0, seq: ++seq, de: { z: 'inv', i: iMinerai }, vers: { z: 'cont', cle: cleF, i: 0 }, n: 1 });
  await cl.attendre('inv_maj', 3000, m => m.ack === seq);
  cl.envoyer({ t: 'cont_transfert', j: 0, seq: ++seq, de: { z: 'inv', i: iCharbon }, vers: { z: 'cont', cle: cleF, i: 1 }, n: 1 });
  await cl.attendre('inv_maj', 3000, m => m.ack === seq);
  cl.envoyer({ t: 'cont_fermer', j: 0, cle: cleF });
  await dodo(300);
  const depuis = cl.depuis();
  await dodo(2500);                     // fenêtre fermée : rien ne doit être envoyé sur ce contenu
  eq(depuis('cont_maj').length, 0, 'SPEC-ARCHI-030 (SPEC-SYNC-016) : un fourneau fermé qui cuit n\'envoie aucun CONTENEUR_MAJ');
  // la cuisson dure SMELT_TIME (6 s) : on rouvre par sondage borné jusqu'au lingot
  let sortie = null;
  const fin = Date.now() + 40000;
  while (Date.now() < fin && !sortie) {
    cl.messages.length = 0;
    cl.envoyer({ t: 'cont_ouvrir', j: 0, x: pf.x, y: pf.y, z: pf.z });
    const e = await cl.attendre('cont_etat', 3000, m => m.cle === cleF).catch(() => null);
    if (e) {
      const sl = (e.slots || []).map(pile);
      if (sl[2] && sl[2].id === I.IRON_INGOT) sortie = sl[2];
      cl.envoyer({ t: 'cont_fermer', j: 0, cle: cleF });
    }
    if (!sortie) await dodo(1000);
  }
  ok(!!sortie, 'SPEC-ARCHI-030 : le fourneau a cuit fenêtre fermée (lingot de fer présent à la réouverture)', JSON.stringify(sortie));
  cl.fermer();
  await s.arreter();
}

// ── SPEC-ARCHI-031 / SYNC-026 / SYNC-028 : inventaire ────────────────────────
async function scenarioInventaire() {
  const s = await demarrer([], seed([[B.LOG, 3], [B.COBBLE, 1], [I.ARC, 1]]));
  const { client: cl, bienvenue } = await rejoindre(s.port, 'Bob', 1);
  const inv0 = await inventaireInitial(cl);
  let seq = 0;

  // manger un aliment absent de l'inventaire serveur : refusé (SYNC-009)
  cl.envoyer({ t: 'manger', j: 0, seq: ++seq, id: I.GOLDEN_APPLE });
  const refus = await cl.attendre('inv_maj', 3000, m => m.refus && m.refus.some(r => r.seq === seq));
  ok(refus.refus.some(r => r.motif === 'absent'), 'SPEC-ARCHI-031 : manger un aliment absent de l\'inventaire serveur est refusé (absent)');

  // un objet jeté apparaît dans l'ETAT reçu (SYNC-026)
  cl.envoyer({ t: 'inv_lacher', j: 0, seq: ++seq, i: indexDe(inv0, B.LOG), n: 1 });
  await cl.attendre('inv_maj', 3000, m => m.ack === seq);
  const vu = await cl.attendre('etat', 4000, m => (m.mobs || []).some(e => e.t === 'item' && e.i && (e.i.id === B.LOG || e.i === B.LOG)))
    .then(() => true).catch(() => false);
  ok(vu, 'SPEC-ARCHI-031 (SYNC-026) : un objet jeté apparaît, avec son type, dans l\'ETAT reçu');

  // pose d'un bloc jamais possédé : refusée, le bloc autoritaire est rappelé (SYNC-028)
  const p1 = positionBloc(bienvenue, 0);
  const refusPose = await poser(cl, p1, B.DIAMOND_ORE || B.GOLD_ORE || B.IRON_ORE, undefined);
  eq(refusPose.id, 0, 'SPEC-ARCHI-031 (SYNC-028) : une pose de bloc jamais possédé est refusée (le serveur rappelle l\'air)');

  // pose possédée : acceptée, et débitée UNE seule fois même si le client envoie son journal
  const iCobble = indexDe(inv0, B.COBBLE);
  const p2 = positionBloc(bienvenue, 1);
  const okPose = await poser(cl, p2, B.COBBLE, iCobble);
  eq(okPose.id, B.COBBLE, 'SPEC-ARCHI-031 (SYNC-028) : la pose d\'un bloc possédé est acceptée');
  cl.envoyer({ t: 'inv_consommer', j: 0, seq: ++seq, ops: [{ i: iCobble, id: B.COBBLE, n: 1 }] });
  const majPose = await cl.attendre('inv_maj', 3000, m => m.ack === seq);
  eq(compte(majPose.inv, B.COBBLE), 0, 'SPEC-ARCHI-031 (SYNC-028) : le bloc posé est retiré côté serveur, une seule fois');
  ok(!majPose.refus || !majPose.refus.length, 'SPEC-ARCHI-031 : le journal du client, déjà couvert par le débit serveur, n\'est pas un refus');
  const p3 = positionBloc(bienvenue, 2);
  eq((await poser(cl, p3, B.COBBLE, iCobble)).id, 0, 'SPEC-ARCHI-031 (SYNC-028) : plus d\'exemplaire, plus de pose (aucun bloc gratuit)');

  // tir sans munition : aucun projectile (SYNC-028)
  const avantTir = cl.depuis();
  cl.envoyer({ t: 'tir', j: 0, dx: 0, dy: 1, dz: 0, vitesse: 34, degats: 5, genre: 'fleche' });
  await dodo(800);
  const flechesSansMun = cl.messages.filter(m => m.t === 'etat').slice(-3).some(m => (m.mobs || []).some(e => e.t === 'arrow'));
  ok(!flechesSansMun && avantTir('etat').length > 0, 'SPEC-ARCHI-031 (SYNC-028) : un tir sans flèche ne crée aucun projectile');
  cl.fermer();
  await s.arreter();

  // tir avec munition : projectile, et une flèche débitée une seule fois
  const s2 = await demarrer([], seed([[I.ARC, 1], [I.FLECHE, 3]]));
  const c2 = await rejoindre(s2.port, 'Carole', 1);
  const invC = await inventaireInitial(c2.client);
  c2.client.envoyer({ t: 'tir', j: 0, dx: 0, dy: 1, dz: 0, vitesse: 34, degats: 5, genre: 'fleche' });
  const fleche = await c2.client.attendre('etat', 3000, m => (m.mobs || []).some(e => e.t === 'arrow')).then(() => true).catch(() => false);
  ok(fleche, 'SPEC-ARCHI-031 (SYNC-028) : un tir avec munition crée un projectile');
  const iFl = indexDe(invC, I.FLECHE);
  c2.client.envoyer({ t: 'inv_consommer', j: 0, seq: 1, ops: [{ i: iFl, id: I.FLECHE, n: 1 }] });
  const majTir = await c2.client.attendre('inv_maj', 3000, m => m.ack === 1);
  eq(compte(majTir.inv, I.FLECHE), 2, 'SPEC-ARCHI-031 (SYNC-028) : la flèche tirée est débitée une seule fois (3 → 2)');
  c2.client.fermer();
  await s2.arreter();
}

// ── SPEC-ARCHI-032 : commerce par TROC en serveur fermé ──────────────────────
async function scenarioCommerce() {
  const s = await demarrer(['--graine', '100'], seed([[I.WHEAT, 40], [I.BONE, 40]]));
  const { client: cl, bienvenue } = await rejoindre(s.port, 'Marchande', 1);
  let pnj = null;
  const fin = Date.now() + 10000;
  while (Date.now() < fin && !pnj) {
    const m = cl.messages.filter(x => x.t === 'etat').pop();
    pnj = m && m.mobs && m.mobs.find(x => x.t === 'villager' && x.r);
    if (!pnj) await dodo(200);
  }
  ok(!!pnj, 'SPEC-ARCHI-032 : un PNJ de métier vit dans le serveur fermé');
  if (pnj) {
    let pos = bienvenue.toi[0], sN = 1;
    const fin2 = Date.now() + 10000;
    while (Date.now() < fin2 && Math.hypot(pnj.x - pos.x, pnj.z - pos.z) >= 4) {
      const dx = pnj.x - pos.x, dz = pnj.z - pos.z;
      cl.envoyer({ t: NP.MSG.ENTREE, s: sN++, j: 0, dt: 0.05, k: 1, yaw: Math.atan2(-dx, -dz), pitch: 0, v: 0 });
      await dodo(50);
      const m = cl.messages.filter(x => x.t === 'etat').pop();
      if (m && m.toi && m.toi[0]) pos = m.toi[0];
    }
    cl.envoyer({ t: 'troc', j: 0, action: 'consulter', eid: pnj.e });
    const offres = await cl.attendre('troc', 4000, m => m.action === 'offres' && m.eid === pnj.e).catch(() => null);
    ok(!!offres && Array.isArray(offres.offres) && offres.offres.length > 0, 'SPEC-ARCHI-032 : consulter un marchand passe par TROC (offres au prix courant)');
    const vente = offres && offres.offres.find(o => o.give && o.give.length && o.get && o.get.id === I.EMERALD);
    if (vente) {
      cl.envoyer({ t: 'troc', j: 0, seq: 1, action: 'echanger', eid: pnj.e, offre: vente.i, fois: 1 });
      const maj = await cl.attendre('inv_maj', 4000, m => m.ack >= 1).catch(() => null);
      ok(!!maj && !(maj.refus && maj.refus.length), 'SPEC-ARCHI-032 : échanger avec un marchand passe par TROC (INV_MAJ acquitté)');
    } else R.saut('échange avec le marchand', 'aucune offre de vente d\'émeraude chez ce PNJ');
  }
  cl.fermer();
  await s.arreter();
}

// ── SPEC-ARCHI-033 : bloc de commande ───────────────────────────────────────
async function scenarioBlocCommande() {
  // créatif, serveur fermé (solo) : l'hôte local pose et modifie
  const s = await demarrer([], { MC_MODE: 'creatif' });
  const { client: cl, bienvenue } = await rejoindre(s.port, 'Dora', 1);
  const pos = positionBloc(bienvenue, 0);
  const pose = await poser(cl, pos, B.BLOC_COMMANDE);
  eq(pose.id, B.BLOC_COMMANDE, 'SPEC-ARCHI-033 : en solo fermé créatif, le serveur accepte de poser un bloc de commande');
  cl.envoyer({ t: 'admin', action: 'bloc_commande', args: { x: pos.x, y: pos.y, z: pos.z, texte: '/jour' } });
  const rep = await cl.attendre('admin_rep', 3000, m => m.action === 'bloc_commande');
  ok(rep.ok && rep.data && rep.data.texte === '/jour', 'SPEC-ARCHI-033 : en solo fermé créatif, la modification passe par ADMIN et est acceptée par le serveur', JSON.stringify(rep));
  // un bloc qui n'est pas un bloc de commande : refusé même en créatif
  cl.envoyer({ t: 'admin', action: 'bloc_commande', args: { x: pos.x, y: pos.y + 1, z: pos.z, texte: '/jour' } });
  const rep2 = await cl.attendre('admin_rep', 3000, m => m.action === 'bloc_commande' && m !== rep);
  ok(!rep2.ok, 'SPEC-ARCHI-033 : le serveur revérifie qu\'il s\'agit bien d\'un bloc de commande');
  cl.fermer();
  await s.arreter();

  // survie : refusé par le serveur (pose ET modification)
  const s2 = await demarrer([]);
  const c2 = await rejoindre(s2.port, 'Eric', 1);
  const pos2 = positionBloc(c2.bienvenue, 0);
  eq((await poser(c2.client, pos2, B.BLOC_COMMANDE)).id, 0, 'SPEC-ARCHI-033 : en survie, la pose d\'un bloc de commande est refusée par le serveur');
  c2.client.envoyer({ t: 'admin', action: 'bloc_commande', args: { x: pos2.x, y: pos2.y, z: pos2.z, texte: '/jour' } });
  const rep3 = await c2.client.attendre('admin_rep', 3000, m => m.action === 'bloc_commande');
  ok(!rep3.ok, 'SPEC-ARCHI-033 : en survie, la modification est refusée par le serveur (identique au réseau)');
  c2.client.fermer();
  await s2.arreter();

  // ouvert + créatif : l'hôte (boucle locale) oui, un client distant non
  const lan = adressesNonLocales().filter(a => /^\d+\.\d+\.\d+\.\d+$/.test(a))[0];
  if (!lan) { R.saut('client distant refusé en créatif', 'aucune adresse réseau non locale sur cette machine'); return; }
  const s3 = await demarrer(['--ouvert'], { MC_MODE: 'creatif' });
  const loc = await rejoindre(s3.port, 'Hote', 1);
  const distant = await rejoindre(s3.port, 'Visiteur', 1, { hote: lan });
  const posH = positionBloc(loc.bienvenue, 0);
  eq((await poser(loc.client, posH, B.BLOC_COMMANDE)).id, B.BLOC_COMMANDE, 'SPEC-ARCHI-033 : serveur ouvert, créatif : l\'hôte local peut poser');
  const posV = positionBloc(distant.bienvenue, 3);
  eq((await poser(distant.client, posV, B.BLOC_COMMANDE)).id, 0, 'SPEC-ARCHI-033 : serveur ouvert, créatif : un client distant ne peut pas poser (même règle que sur un serveur dédié)');
  distant.client.envoyer({ t: 'admin', action: 'bloc_commande', args: { x: posH.x, y: posH.y, z: posH.z, texte: '/jour' } });
  const repD = await distant.client.attendre('admin_rep', 3000, m => m.action === 'bloc_commande');
  ok(!repD.ok, 'SPEC-ARCHI-033 : un client distant ne modifie pas un bloc de commande');
  loc.client.fermer(); distant.client.fermer();
  await s3.arreter();
}


// ── poses à deux blocs, bascule, coffre généré, crédit tardif (revue B-INV) ───
async function scenarioMultiBlocs() {
  const d = A.dossierTemp('mc-inv-mb-');
  const f = path.join(d, 'monde.json');
  try {
    const s = await demarrer(['--monde', f, '--dossier-parties', d], seed([[I.PORTE, 1], [B.LIT, 1], [B.COBBLE, 2]]));
    const { client: cl, bienvenue } = await rejoindre(s.port, 'Fanny', 1);
    const inv0 = await inventaireInitial(cl);
    // porte : la case visée ET celle du dessus arrivent au monde serveur
    const pp = positionBloc(bienvenue, 0);
    const idPorte = C.PORTE_FERMEE_LIST[0];
    cl.envoyer({ t: 'bloc', x: pp.x, y: pp.y, z: pp.z, id: idPorte, j: 0, i: indexDe(inv0, I.PORTE) });
    await cl.attendre('bloc', 3000, m => m.y === pp.y + 1 && m.id === idPorte);
    ok(true, 'SPEC-ARCHI-031 : poser une porte pose aussi sa moitié haute côté serveur');
    // lit : la tête suit l'orientation
    const pl = positionBloc(bienvenue, 3);
    cl.envoyer({ t: 'bloc', x: pl.x, y: pl.y, z: pl.z, id: B.LIT, j: 0, etat: 0, i: indexDe(inv0, B.LIT) });
    const tete = await cl.attendre('bloc', 3000, m => m.z === pl.z - 1 && m.x === pl.x && m.id === B.LIT);
    eq(tete.etat & 4, 4, 'SPEC-ARCHI-031 : poser un lit pose sa tête (variante) côté serveur');

    // bascule : ouvrir la porte sans aucun objet, les deux moitiés
    const ouverte = C.bascule(idPorte);
    cl.envoyer({ t: 'bloc', x: pp.x, y: pp.y, z: pp.z, id: ouverte, j: 0 });
    await cl.attendre('bloc', 3000, m => m.y === pp.y && m.id === ouverte);
    cl.envoyer({ t: 'bloc', x: pp.x, y: pp.y + 1, z: pp.z, id: ouverte, j: 0 });
    await cl.attendre('bloc', 3000, m => m.y === pp.y + 1 && m.id === ouverte);
    ok(true, 'SPEC-ARCHI-031 : ouvrir une porte est accepté et diffusé, sans objet');
    // une « bascule » qui n'en est pas une reste refusée
    cl.messages.length = 0;
    cl.envoyer({ t: 'bloc', x: pp.x, y: pp.y, z: pp.z, id: B.COBBLE, j: 0 });
    const rappel = await cl.attendre('bloc', 3000, m => m.y === pp.y);
    eq(rappel.id, ouverte, 'SPEC-ARCHI-031 : remplacer une porte par un autre bloc est refusé (état autoritaire rappelé)');
    // pause : la bascule est gelée
    cl.envoyer({ t: 'pause', actif: true });
    await cl.attendre('pause_etat', 3000, m => m.actif === true);
    cl.messages.length = 0;
    cl.envoyer({ t: 'bloc', x: pp.x, y: pp.y, z: pp.z, id: idPorte, j: 0 });
    await dodo(600);
    eq(cl.messages.filter(m => m.t === 'bloc').length, 0, 'SPEC-ARCHI-031 : la bascule est refusée en pause');
    cl.envoyer({ t: 'pause', actif: false });
    await cl.attendre('pause_etat', 3000, m => m.actif === false);

    // crédit tardif : le journal INV_CONSOMMER arrive plus de 3 s après la pose, sans double débit
    const iCob = indexDe(inv0, B.COBBLE);
    const pc = positionBloc(bienvenue, 6);
    cl.envoyer({ t: 'bloc', x: pc.x, y: pc.y, z: pc.z, id: B.COBBLE, j: 0, i: iCob });
    await cl.attendre('bloc', 3000, m => m.x === pc.x && m.id === B.COBBLE);
    await dodo(3600);
    cl.envoyer({ t: 'inv_consommer', j: 0, seq: 1, ops: [{ i: iCob, id: B.COBBLE, n: 1 }] });
    const maj = await cl.attendre('inv_maj', 3000, m => m.ack === 1);
    eq(compte(maj.inv, B.COBBLE), 1, 'SPEC-SYNC-028 : un journal arrivé plus de 3 s après la pose ne fait pas payer deux fois (2 → 1)');
    cl.fermer();
    await s.arreter();
    // le monde sauvegardé garde les deux moitiés (ouvertes) et le lit entier
    const sauve = JSON.parse(fs.readFileSync(f, 'utf8'));
    const bl = (x, y, z) => { const o = sauve.overrides.find(e => e[0] === x && e[1] === y && e[2] === z); return o ? o[3] : null; };
    // (les circuits ne referment plus une porte ouverte à la main, SPEC-MECA-006 : les DEUX moitiés restent ouvertes)
    eq(bl(pp.x, pp.y, pp.z), ouverte, 'SPEC-ARCHI-031 : la porte (case basse) survit à la sauvegarde, ouverte');
    eq(bl(pp.x, pp.y + 1, pp.z), ouverte, 'SPEC-ARCHI-031 : la porte (case haute) survit à la sauvegarde, ouverte');
    eq(bl(pl.x, pl.y, pl.z - 1), B.LIT, 'SPEC-ARCHI-031 : la tête du lit survit à la sauvegarde');
  } finally { A.supprimerDossier(d); }
}

async function scenarioCoffreGenere() {
  // graine 344 : un coffre de donjon réel à (221,37,-67), jamais ouvert ; on le CASSE d'emblée
  const s = await demarrer(['--graine', '344'], Object.assign({ MC_TEST_SPAWN: '219.5,37,-64.5' }, seed([])));
  const { client: cl } = await rejoindre(s.port, 'Gaspard', 1);
  cl.envoyer({ t: 'bloc', x: 221, y: 37, z: -67, id: 0, outil: 0, j: 0 });
  const vu = await cl.attendre('etat', 6000, m => (m.mobs || []).some(e => e.t === 'item')).then(() => true).catch(() => false);
  ok(vu, 'SPEC-ARCHI-030 : casser un coffre généré jamais ouvert lâche son butin (tiré par le serveur avant la casse)');
  cl.fermer();
  await s.arreter();
}

// ── audit statique de src/game.js ───────────────────────────────────────────
function scenarioAudit() {
  const src = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
  const sansCommentaires = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/\bfurnaces\b/.test(sansCommentaires), 'SPEC-ARCHI-030 (audit) : plus de table locale `furnaces` dans game.js');
  ok(!/world\.banque/.test(sansCommentaires), 'SPEC-ARCHI-030 (audit) : plus d\'écriture ni de lecture de `world.banque` dans game.js');
  ok(!/MC\.Economie/.test(sansCommentaires) && !/g\.economie/.test(sansCommentaires), 'SPEC-ARCHI-032 (audit) : game.js n\'appelle plus MC.Economie ni ne tient g.economie');
  const corps = (nom) => {
    const m = new RegExp('\\n( *)function ' + nom + '\\(').exec(sansCommentaires);
    if (!m) return null;
    const debut = m.index + 1;
    const fin = sansCommentaires.indexOf('\n' + m[1] + '}', debut);
    return sansCommentaires.slice(debut, fin);
  };
  ['interagirExposition', 'ouvrirCoffreSuspect'].forEach((nom) => {
    const c = corps(nom);
    ok(!!c && /pas encore/.test(c) && !/consumeAt|dropItem|\.add\(|expositions\[|chests\[/.test(c),
       `SPEC-ARCHI-043/044 (reportées) : ${nom} refuse avec un message et ne touche ni l'inventaire ni des tables locales`);
  });
  ['ouvrirBlocCommande', 'ouvrirConteneur', 'operer', 'purgerJournalInv', 'frameConteneurs', 'forceCloseContainer', 'ouvrirBanque'].forEach((nom) => {
    const c = corps(nom);
    if (c === null) { ok(true, `audit : ${nom} n'existe plus (branche supprimée)`); return; }
    ok(!/net\.enLigne\(\)/.test(c), `SPEC-ARCHI-030/031/033 (audit) : aucune décision client sur net.enLigne() dans ${nom}`);
  });
}

(async () => {
  try {
    await scenarioConteneurs();
    await scenarioInventaire();
    await scenarioCommerce();
    await scenarioBlocCommande();
    await scenarioMultiBlocs();
    await scenarioCoffreGenere();
    scenarioAudit();
  } catch (e) {
    ok(false, 'le scénario ne doit pas lever d\'exception', e && e.stack);
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
