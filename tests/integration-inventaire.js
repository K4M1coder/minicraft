/* integration-inventaire.js — B1 : inventaire et conteneurs serveur.
   Partie 1 (docs/vague-2/B1.md § 9 étape 5, SPEC-SYNC-007 à 011, 014) : vrai
   processus server.js, vraies sockets TCP : REJOINDRE (registre, MC_TEST_INV),
   CRAFT, EQUIP/EQUIP_VU, MANGER, INV_CONSOMMER, INV_LACHER, INV_CREATIF,
   idempotence du `seq`, reconnexion sous le même nom.
   Partie 2 (étape 7, SPEC-SYNC-012/013/015/016, anti-duplication) : registre
   des conteneurs posés — deux joueurs sur le même coffre (transferts
   concurrents, conservation), casse pendant que deux joueurs l'ont ouvert,
   déconnexion avec un objet visuellement « en main » (jamais envoyé), portée
   revérifiée à chaque opération (coffre, banque), fourneau qui cuit pendant
   que personne ne regarde.

   Usage : node tests/integration-inventaire.js [port]
   Le serveur est démarré et arrêté par le test lui-même. */
'use strict';
require('./journal-temp.js');   // journal des serveurs lancés : dossier temporaire (SPEC-BANC-106)
process.env.MC_TEST_POSE_LIBRE = '1';   // SPEC-SYNC-028 : cette suite n'éprouve pas l'inventaire (les serveurs qu'elle lance héritent du réglage)
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { spawn } = require('child_process');

const RACINE = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8189;

const ctx = vm.createContext(Object.assign(Object.create(null), {
  console, Math, JSON, Date, Error, Number, String, Array, Object, Boolean,
  Map, Set, Uint8Array, isNaN, isFinite, parseInt, parseFloat,
}));
ctx.globalThis = ctx;
vm.runInContext(fs.readFileSync(path.join(RACINE, 'src/core.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(RACINE, 'src/net-protocol.js'), 'utf8'), ctx);
const NP = ctx.MC.NetProtocol;
const CO = ctx.MC.Core;
const I = CO.I, B = CO.B;

const C = { r: '\x1b[31m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
let passes = 0, echecs = 0;
const details = [];
function ok(cond, nom, info) {
  if (cond) { passes++; details.push(`  ${C.g}·${C.x} ${C.d}${nom}${C.x}`); }
  else { echecs++; details.push(`  ${C.r}✗ ${nom}${C.x}${info ? '\n    ' + C.r + info + C.x : ''}`); }
}
function eq(a, b, nom) { ok(a === b, nom, `attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); }

// ── client WebSocket minimal (repris d'integration-net.js) ─────────────────
function connecter(port) {
  return new Promise((resolve, reject) => {
    const cle = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(
        'GET / HTTP/1.1\r\n' +
        `Host: 127.0.0.1:${port}\r\n` +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Key: ${cle}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    let tampon = Buffer.alloc(0);
    let etabli = false;
    const messages = [];
    const attentes = [];
    const client = {
      socket: sock, messages, ferme: false,
      envoyer(obj) {
        const charge = Buffer.from(JSON.stringify(obj), 'utf8');
        const m = crypto.randomBytes(4);
        const n = charge.length;
        const entete = n < 126 ? 2 : 4;
        const buf = Buffer.alloc(entete + 4 + n);
        buf[0] = 0x81;
        if (n < 126) buf[1] = 0x80 | n;
        else { buf[1] = 0x80 | 126; buf.writeUInt16BE(n, 2); }
        m.copy(buf, entete);
        for (let i = 0; i < n; i++) buf[entete + 4 + i] = charge[i] ^ m[i % 4];
        sock.write(buf);
      },
      attendre(type, ms, predicat) {
        const ok2 = (m2) => m2.t === type && (!predicat || predicat(m2));
        const deja = messages.find(ok2);
        if (deja) return Promise.resolve(deja);
        return new Promise((res, rej) => {
          const t = setTimeout(() => {
            const i = attentes.indexOf(a);
            if (i >= 0) attentes.splice(i, 1);
            rej(new Error('delai depasse pour ' + type));
          }, ms || 3000);
          const a = { test: ok2, res: (m2) => { clearTimeout(t); res(m2); } };
          attentes.push(a);
        });
      },
      fermer() { client.ferme = true; try { sock.destroy(); } catch (e) {} },
    };
    sock.on('data', (bloc) => {
      tampon = Buffer.concat([tampon, bloc]);
      if (!etabli) {
        const i = tampon.indexOf('\r\n\r\n');
        if (i < 0) return;
        const entetes = tampon.slice(0, i).toString();
        const attendu = crypto.createHash('sha1').update(cle + NP.GUID).digest('base64');
        if (!entetes.includes('101') || !entetes.includes(attendu)) { reject(new Error('poignee de main refusee')); return; }
        etabli = true;
        tampon = tampon.slice(i + 4);
        resolve(client);
      }
      for (;;) {
        const d = NP.decoder(tampon);
        if (!d) break;
        tampon = tampon.slice(d.consomme);
        if (d.opcode !== NP.OP.TEXTE) continue;
        let msg;
        try { msg = JSON.parse(NP.utf8Decoder(d.charge)); } catch (e) { continue; }
        messages.push(msg);
        for (let k = attentes.length - 1; k >= 0; k--) {
          if (attentes[k].test(msg)) { attentes[k].res(msg); attentes.splice(k, 1); }
        }
      }
    });
    sock.on('error', reject);
  });
}
function requete(port, chemin) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: chemin }, (res) => {
      let corps = '';
      res.on('data', (d) => { corps += d; });
      res.on('end', () => resolve({ code: res.statusCode, corps }));
    }).on('error', () => resolve({ code: 0, corps: '' }));
  });
}
const dodo = (ms) => new Promise((r) => setTimeout(r, ms));

// ── aides propres au domaine inventaire ─────────────────────────────────────
// case sérialisée (ContratsV2.pileVersCase) → { id, n } | null
function pile(c) { return (c && c !== 0) ? { id: c[0], n: c[1] } : null; }
function trouverIndex(inv, id) {
  for (let i = 0; i < inv.length; i++) { const p = pile(inv[i]); if (p && p.id === id) return i; }
  return -1;
}
function compte(inv, id) {
  let n = 0;
  for (let i = 0; i < inv.length; i++) { const p = pile(inv[i]); if (p && p.id === id) n += p.n; }
  return n;
}
let seqAlice = 0, seqBob = 0;
function prochainSeq(qui) { return qui === 'alice' ? ++seqAlice : ++seqBob; }

// ── scénario ─────────────────────────────────────────────────────────────────
(async function () {
  const seed = JSON.stringify([[B.LOG, 2], [I.GOLDEN_APPLE, 1], [I.CUIR_CASQUE, 1]]);
  const serveur = spawn(process.execPath, [path.join(RACINE, 'server.js'), String(PORT), '--ouvert'], {
    cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { MC_TEST_INV: seed }),
  });
  const logs = [];
  serveur.stdout.on('data', d => logs.push(String(d)));
  serveur.stderr.on('data', d => logs.push('ERR ' + String(d)));
  serveur.on('error', e => logs.push('SPAWN ' + e.message));

  for (let essai = 0; essai < 60; essai++) {
    await dodo(100);
    const sonde = await requete(PORT, '/index.html');
    if (sonde.code === 200) break;
  }

  try {
    // ── SPEC-SYNC-020 (partie B1) / SPEC-SYNC-007 : un joueur SANS
    // enregistrement démarre avec l'inventaire de MC_TEST_INV, appris par un
    // INV_MAJ envoyé juste après la bienvenue.
    const a = await connecter(PORT);
    a.envoyer({ t: 'rejoindre', nom: 'Alice', locaux: 1 });
    const bienvenueA = await a.attendre('bienvenue');
    const majInit = await a.attendre('inv_maj');
    eq(compte(majInit.inv, B.LOG), 2, 'SPEC-SYNC-007 : MC_TEST_INV peuple l\'inventaire (bois)');
    eq(compte(majInit.inv, I.GOLDEN_APPLE), 1, 'SPEC-SYNC-007 : MC_TEST_INV peuple l\'inventaire (pomme dorée)');
    ok(majInit.rev >= 1, 'SPEC-SYNC-008 : le premier INV_MAJ porte une révision');

    // ── SPEC-SYNC-014 : transfert inv → grille (matière première du craft)
    const iLog = trouverIndex(majInit.inv, B.LOG);
    ok(iLog >= 0, 'le bois est bien dans l\'inventaire initial');
    a.envoyer({ t: 'cont_transfert', j: 0, seq: prochainSeq('alice'),
                de: { z: 'inv', i: iLog }, vers: { z: 'grille', i: 0 }, n: 1 });
    const majTransfert = await a.attendre('inv_maj', 3000, m => m.ack === seqAlice);
    eq(pile(majTransfert.grille[0]).id, B.LOG, 'SPEC-SYNC-014 : le bois est passé dans la grille');
    eq(compte(majTransfert.inv, B.LOG), 1, 'SPEC-SYNC-014 : un seul bois reste dans l\'inventaire');

    // ── SPEC-SYNC-010 : CRAFT valide (bois → planches) → INV_MAJ ack
    a.envoyer({ t: 'craft', j: 0, seq: prochainSeq('alice'), fois: 1 });
    const majCraft = await a.attendre('inv_maj', 3000, m => m.ack === seqAlice);
    eq(pile(majCraft.grille[0]), null, 'SPEC-SYNC-010 : la grille est vidée par le craft');
    ok(compte(majCraft.inv, B.PLANKS) === 4, 'SPEC-SYNC-010 : 4 planches obtenues', 'obtenu ' + compte(majCraft.inv, B.PLANKS));
    ok(!majCraft.refus || !majCraft.refus.length, 'SPEC-SYNC-010 : aucun refus sur un craft valide');

    // ── SPEC-SYNC-010 : CRAFT sans recette (grille vide) → refusé
    a.envoyer({ t: 'craft', j: 0, seq: prochainSeq('alice'), fois: 1 });
    const majSansRecette = await a.attendre('inv_maj', 3000, m => m.ack === seqAlice);
    ok(majSansRecette.refus && majSansRecette.refus.some(r => r.motif === 'recette'),
       'SPEC-SYNC-010 : un craft sans recette est refusé (motif recette)');

    // ── SPEC-SYNC-009 : MANGER est désormais validé contre l'inventaire
    // SERVEUR réel — un joueur frais (pleine vie, pleine faim) ne peut manger
    // un objet sans soin utile (même règle que le solo, player.useOn), et ne
    // peut jamais manger un objet qu'il ne possède pas réellement. Les deux
    // sont de vrais refus réseau, chacun sans le moindre effet de bord sur
    // l'inventaire que le serveur seul connaît — la preuve « ça consomme
    // vraiment » est déjà apportée par le module pur (tests/spec-conteneurs.js),
    // ici on prouve que le serveur vérifie réellement contre SON inventaire.
    const b = await connecter(PORT);
    b.envoyer({ t: 'rejoindre', nom: 'Bob', locaux: 1 });
    await b.attendre('bienvenue');
    await b.attendre('inv_maj');   // inventaire initial de Bob (MC_TEST_INV s'applique à tout nouvel enregistrement)

    const iPomme0 = trouverIndex(majSansRecette.inv, I.GOLDEN_APPLE);
    ok(iPomme0 >= 0, 'la pomme dorée est bien dans l\'inventaire d\'Alice');
    a.envoyer({ t: 'manger', j: 0, id: I.GOLDEN_APPLE, i: iPomme0, seq: prochainSeq('alice') });
    const majMangerPlein = await a.attendre('inv_maj', 3000, m => m.ack === seqAlice);
    ok(majMangerPlein.refus && majMangerPlein.refus.some(r => r.motif === 'interdit'),
       'SPEC-SYNC-009 : manger à satiété pleine sans soin utile est refusé');
    eq(compte(majMangerPlein.inv, I.GOLDEN_APPLE), 1, 'SPEC-SYNC-009 : un manger refusé ne consomme rien');

    a.envoyer({ t: 'manger', j: 0, id: I.STICK, seq: prochainSeq('alice') });
    const majMangerAbsent = await a.attendre('inv_maj', 3000, m => m.ack === seqAlice);
    ok(majMangerAbsent.refus && majMangerAbsent.refus.some(r => r.motif === 'absent'),
       'SPEC-SYNC-009 : manger un objet qu\'on ne possède pas est refusé');

    // ── SPEC-SYNC-011 : EQUIP échange inv[i] ↔ equip[slot], EQUIP_VU chez Bob
    const iCasque = trouverIndex(majMangerAbsent.inv, I.CUIR_CASQUE);
    ok(iCasque >= 0, 'le casque est bien dans l\'inventaire d\'Alice');
    const attenteVu = b.attendre('equip_vu', 3000, m => m.slot === 'casque' && m.objet === I.CUIR_CASQUE);
    a.envoyer({ t: 'equip', j: 0, seq: prochainSeq('alice'), slot: 'casque', i: iCasque });
    const majEquip = await a.attendre('inv_maj', 3000, m => m.ack === seqAlice);
    eq(pile(majEquip.equip.casque).id, I.CUIR_CASQUE, 'SPEC-SYNC-011 : le casque est équipé');
    eq(pile(majEquip.inv[iCasque]), null, 'SPEC-SYNC-011 : la case source est vidée');
    const equipVu = await attenteVu;
    eq(equipVu.j, 0, 'SPEC-SYNC-011 : EQUIP_VU porte le bon joueur local');

    // refus : deux côtés vides (case jamais occupée, emplacement jamais équipé)
    const nAvantVu = b.messages.filter(m => m.t === 'equip_vu').length;
    a.envoyer({ t: 'equip', j: 0, seq: prochainSeq('alice'), slot: 'bottes', i: 30 });
    const majEquipRefus = await a.attendre('inv_maj', 3000, m => m.ack === seqAlice);
    ok(majEquipRefus.refus && majEquipRefus.refus.some(r => r.motif === 'absent'),
       'SPEC-SYNC-011 : equip deux côtés vides refusé');
    await dodo(150);
    eq(b.messages.filter(m => m.t === 'equip_vu').length, nAvantVu,
       'SPEC-SYNC-011 : un equip refusé ne diffuse pas EQUIP_VU');

    // ── SPEC-SYNC-007 : INV_CONSOMMER ne fait que diminuer, jamais augmenter
    const iPlanks = trouverIndex(majEquipRefus.inv, B.PLANKS);
    ok(iPlanks >= 0, 'les planches sont bien dans l\'inventaire');
    a.envoyer({ t: 'inv_consommer', j: 0, seq: prochainSeq('alice'),
                ops: [{ i: iPlanks, id: B.PLANKS, n: 2 }] });
    const majConsommer = await a.attendre('inv_maj', 3000, m => m.ack === seqAlice);
    eq(compte(majConsommer.inv, B.PLANKS), 2, 'SPEC-SYNC-007 : 2 planches consommées sur 4');

    // ── SPEC-SYNC-014 : un seq déjà traité est ignoré (aucun nouvel INV_MAJ)
    const seqDejaTraite = seqAlice;
    const nAvant = a.messages.filter(m => m.t === 'inv_maj').length;
    a.envoyer({ t: 'inv_consommer', j: 0, seq: seqDejaTraite, ops: [{ i: iPlanks, id: B.PLANKS, n: 1 }] });
    await dodo(200);
    eq(a.messages.filter(m => m.t === 'inv_maj').length, nAvant,
       'SPEC-SYNC-014 : un seq rejoué n\'a ni effet ni réponse');
    eq(compte(a.messages.filter(m => m.t === 'inv_maj').pop().inv, B.PLANKS), 2,
       'SPEC-SYNC-014 : la quantité n\'a pas bougé après le doublon');

    // ── SPEC-SYNC-007 : INV_LACHER retire réellement l'objet
    a.envoyer({ t: 'inv_lacher', j: 0, seq: prochainSeq('alice'), i: iPlanks, n: 2 });
    const majLacher = await a.attendre('inv_maj', 3000, m => m.ack === seqAlice);
    eq(compte(majLacher.inv, B.PLANKS), 0, 'SPEC-SYNC-007 : les planches lâchées quittent l\'inventaire');

    // ── SPEC-SYNC-007 : INV_CREATIF refusé en survie
    a.envoyer({ t: 'inv_creatif', j: 0, seq: prochainSeq('alice'), i: 20, id: B.PLANKS, n: 10 });
    const majCreatif = await a.attendre('inv_maj', 3000, m => m.ack === seqAlice);
    ok(majCreatif.refus && majCreatif.refus.some(r => r.motif === 'creatif'),
       'SPEC-SYNC-007 : INV_CREATIF refusé hors mode créatif');

    // ── reconnexion sous le même nom : le même inventaire est retrouvé
    const invAvantDeco = majCreatif.inv;
    a.fermer();
    await dodo(300);
    const a2 = await connecter(PORT);
    a2.envoyer({ t: 'rejoindre', nom: 'Alice', locaux: 1 });
    await a2.attendre('bienvenue');
    const majReco = await a2.attendre('inv_maj');
    eq(compte(majReco.inv, I.CUIR_CASQUE), 0, 'reconnexion : le casque équipé n\'est pas dans l\'inventaire');
    eq(pile(majReco.equip.casque).id, I.CUIR_CASQUE, 'reconnexion : l\'équipement est retrouvé');
    eq(compte(majReco.inv, B.LOG), compte(invAvantDeco, B.LOG), 'reconnexion : le reste de l\'inventaire est retrouvé (bois)');

    // ── SPEC-SYNC-017 (B1, étape 9) : DISTRIB est désormais une déclaration
    // (MC.Conteneurs.declarer) plutôt qu'un dépôt aveugle du contenu envoyé
    // par le client — seul ce que le joueur possède réellement est prélevé,
    // tronqué à sa possession, et une redéclaration identique ne débite rien
    // de plus (idempotent par construction : la cible, pas un delta).
    const dana = await connecter(PORT);
    dana.envoyer({ t: 'rejoindre', nom: 'Dana', locaux: 1 });
    const bienvenueDana = await dana.attendre('bienvenue');
    const majDana = await dana.attendre('inv_maj');
    const posDana = bienvenueDana.toi[0];
    const bxD = Math.floor(posDana.x), byD = Math.floor(posDana.y) + 3, bzD = Math.floor(posDana.z);
    dana.envoyer({ t: 'bloc', x: bxD, y: byD, z: bzD, id: B.DISTRIBUTEUR, j: 0 });
    await dana.attendre('bloc', 2000, m => m.x === bxD && m.z === bzD && m.id === B.DISTRIBUTEUR);
    const logAvant = compte(majDana.inv, B.LOG);
    ok(logAvant > 0, 'Dana possède du bois (MC_TEST_INV)');
    eq(compte(majDana.inv, B.COBBLE), 0, 'Dana ne possède aucun caillou');
    dana.envoyer({
      t: 'distrib', j: 0, x: bxD, y: byD, z: bzD,
      slots: [{ id: B.LOG, n: 1 }, { id: B.COBBLE, n: 5 }, null, null, null, null, null, null, null],
    });
    const majDistrib1 = await dana.attendre('inv_maj', 3000, m => m.rev > majDana.rev);
    eq(compte(majDistrib1.inv, B.LOG), logAvant - 1,
       'SPEC-SYNC-017 : un seul bois (réellement possédé) est prélevé pour le distributeur');
    eq(compte(majDistrib1.inv, B.COBBLE), 0,
       'SPEC-SYNC-017 : le caillou jamais possédé n\'est ni prélevé ni fait apparaître de nulle part');
    // la même déclaration une seconde fois : rien de plus à prélever
    dana.envoyer({
      t: 'distrib', j: 0, x: bxD, y: byD, z: bzD,
      slots: [{ id: B.LOG, n: 1 }, { id: B.COBBLE, n: 5 }, null, null, null, null, null, null, null],
    });
    const majDistrib2 = await dana.attendre('inv_maj', 3000, m => m.rev > majDistrib1.rev);
    eq(compte(majDistrib2.inv, B.LOG), logAvant - 1,
       'SPEC-SYNC-017 : une redéclaration identique ne débite pas une seconde fois');
    dana.fermer();
    await dodo(150);

    a2.fermer(); b.fermer();
    await dodo(200);

    // ── SPEC-SYNC-021 (partie B1) : le registre des joueurs nommés (inventaire
    // ET équipement) survit à un arrêt PUIS relance du serveur avec le même
    // `--monde` — pas seulement à une reconnexion sur un serveur qui n'a
    // jamais cessé de tourner (déjà couvert ci-dessus). `snapshotRegistreJoueurs`
    // (server.js) capture même un joueur ENCORE connecté à l'instant de la
    // sauvegarde périodique, sans attendre sa déconnexion.
    const os = require('os');
    const fichierMonde = path.join(os.tmpdir(), `mc-test-monde-${process.pid}-${Date.now()}.json`);
    try { fs.unlinkSync(fichierMonde); } catch (e) {}
    const portMonde = PORT + 1;
    const seedMonde = JSON.stringify([[I.CUIR_CASQUE, 1], [B.LOG, 3]]);
    const serveur1 = spawn(process.execPath,
      [path.join(RACINE, 'server.js'), '--port', String(portMonde), '--serveur', '--monde', fichierMonde],
      { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, { MC_TEST_INV: seedMonde, MC_SAUVEGARDE_MS: '150' }) });
    const logs1 = [];
    serveur1.stdout.on('data', d => logs1.push(String(d)));
    serveur1.stderr.on('data', d => logs1.push('ERR ' + String(d)));
    try {
      for (let essai = 0; essai < 60; essai++) {
        await dodo(100);
        const sonde = await requete(portMonde, '/index.html');
        if (sonde.code === 200) break;
      }
      const zoe = await connecter(portMonde);
      zoe.envoyer({ t: 'rejoindre', nom: 'Zoe', locaux: 1 });
      const bvZoe = await zoe.attendre('bienvenue');
      const majZoe = await zoe.attendre('inv_maj');
      const iCasqueZoe = trouverIndex(majZoe.inv, I.CUIR_CASQUE);
      ok(iCasqueZoe >= 0, 'SPEC-SYNC-021 : le casque de Zoe est bien dans son inventaire initial');
      zoe.envoyer({ t: 'equip', j: 0, seq: 1, slot: 'casque', i: iCasqueZoe });
      const majZoeEquip = await zoe.attendre('inv_maj', 3000, m => m.ack === 1);

      // ── SPEC-SYNC-021 (partie conteneurs) : un coffre POSÉ (pas seulement
      // le joueur) retrouve son contenu après un arrêt puis une relance
      // --monde — le registre `conteneursPoses` (étape 7) passe par
      // `etatMonde`/`appliquerEtatMonde` comme le reste du monde.
      const posZoe = bvZoe.toi[0];
      const bxZ = Math.floor(posZoe.x), byZ = Math.floor(posZoe.y) + 3, bzZ = Math.floor(posZoe.z);
      zoe.envoyer({ t: 'bloc', x: bxZ, y: byZ, z: bzZ, id: B.CHEST, j: 0 });
      await zoe.attendre('bloc', 2000, m => m.x === bxZ && m.z === bzZ && m.id === B.CHEST);
      const cleCoffreZ = `${bxZ},${byZ},${bzZ}`;
      zoe.envoyer({ t: 'cont_ouvrir', j: 0, x: bxZ, y: byZ, z: bzZ });
      await zoe.attendre('cont_etat', 3000, m => m.cle === cleCoffreZ);
      const iLogZoe = trouverIndex(majZoeEquip.inv, B.LOG);
      ok(iLogZoe >= 0, 'Zoe possède du bois pour le coffre persistant');
      zoe.envoyer({ t: 'cont_transfert', j: 0, seq: 2,
                    de: { z: 'inv', i: iLogZoe }, vers: { z: 'cont', cle: cleCoffreZ, i: 0 }, n: 3 });
      await zoe.attendre('inv_maj', 3000, m => m.ack === 2);

      // ── Revue adversariale (item 3) : le coffre de Zoe est cassé PUIS un
      // fourneau est posé au même endroit PENDANT qu'elle l'a encore ouvert —
      // le serveur doit désabonner ET notifier (CONTENEUR_FERMER s→c,
      // message existant réutilisé comme fermeture forcée), jamais laisser
      // sa vieille clé se résoudre en silence contre le nouveau conteneur
      // (un fourneau, 3 cases, vu comme un coffre, 27).
      const fermeAttendue = zoe.attendre('cont_fermer', 3000, m => m.cle === cleCoffreZ);
      zoe.envoyer({ t: 'bloc', x: bxZ, y: byZ, z: bzZ, id: 0, outil: 0, j: 0 });
      await zoe.attendre('bloc', 2000, m => m.x === bxZ && m.z === bzZ && m.id === 0);
      const majFerme = await fermeAttendue;
      eq(majFerme.cle, cleCoffreZ, 'SPEC-SYNC-012 (revue adversariale) : le serveur notifie la fermeture forcée du coffre cassé');
      zoe.envoyer({ t: 'bloc', x: bxZ, y: byZ, z: bzZ, id: B.FURNACE, j: 0 });
      await zoe.attendre('bloc', 2000, m => m.x === bxZ && m.z === bzZ && m.id === B.FURNACE);

      // l'ancienne clé ne se résout plus JAMAIS contre le nouveau conteneur :
      // motif 'ferme' (désabonnée), jamais 'incompatible' (ce qui prouverait
      // une résolution contre le fourneau à un indice qui lui est étranger)
      zoe.envoyer({ t: 'cont_transfert', j: 0, seq: 3,
                    de: { z: 'inv', i: 0 }, vers: { z: 'cont', cle: cleCoffreZ, i: 10 }, n: 1 });
      const majApresRemplacement = await zoe.attendre('inv_maj', 3000, m => m.ack === 3);
      ok(majApresRemplacement.refus && majApresRemplacement.refus.some(r => r.motif === 'ferme'),
         'SPEC-SYNC-012/013 (revue adversariale) : l\'ancien abonnement n\'est jamais réutilisé après remplacement (motif ferme)');

      zoe.envoyer({ t: 'cont_ouvrir', j: 0, x: bxZ, y: byZ, z: bzZ });
      // le filtre porte sur `type` (pas seulement `cle`) : sans lui,
      // `attendre` renverrait le premier `cont_etat` déjà reçu pour cette
      // clé — celui du coffre original, avant remplacement (piège du client
      // de test, pas du serveur).
      const etatFourZoe = await zoe.attendre('cont_etat', 3000, m => m.cle === cleCoffreZ && m.type === 'furnace');
      eq(etatFourZoe.type, 'furnace', 'le nouveau conteneur au même endroit est bien reconnu comme un fourneau');
      eq(etatFourZoe.slots.length, 3, 'taille correcte du fourneau (pas 27, pas agrandie)');

      // au moins une sauvegarde périodique (MC_SAUVEGARDE_MS=150) avant l'arrêt —
      // le joueur reste connecté : c'est bien snapshotRegistreJoueurs qui capture
      // son état, pas seulement `fermer()`.
      await dodo(500);
      serveur1.kill();
      await dodo(300);

      const serveur2 = spawn(process.execPath,
        [path.join(RACINE, 'server.js'), '--port', String(portMonde), '--serveur', '--monde', fichierMonde],
        { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
      const logs2 = [];
      serveur2.stdout.on('data', d => logs2.push(String(d)));
      serveur2.stderr.on('data', d => logs2.push('ERR ' + String(d)));
      try {
        for (let essai = 0; essai < 60; essai++) {
          await dodo(100);
          const sonde = await requete(portMonde, '/index.html');
          if (sonde.code === 200) break;
        }
        const zoe2 = await connecter(portMonde);
        zoe2.envoyer({ t: 'rejoindre', nom: 'Zoe', locaux: 1 });
        await zoe2.attendre('bienvenue');
        const majZoe2 = await zoe2.attendre('inv_maj');
        ok(majZoe2.equip && pile(majZoe2.equip.casque) && pile(majZoe2.equip.casque).id === I.CUIR_CASQUE,
           'SPEC-SYNC-021 : l\'équipement de Zoe survit à un arrêt puis relance --monde',
           'equip.casque = ' + JSON.stringify(majZoe2.equip && majZoe2.equip.casque));
        eq(compte(majZoe2.inv, I.CUIR_CASQUE), 0, 'SPEC-SYNC-021 : le casque équipé n\'est pas aussi dans l\'inventaire retrouvé');
        // le coffre a été remplacé par un fourneau (revue adversariale,
        // item 3, plus haut) : c'est CE conteneur — bien formé, 3 cases —
        // qui doit survivre à --monde, pas un fantôme de 27 cases.
        zoe2.envoyer({ t: 'cont_ouvrir', j: 0, x: bxZ, y: byZ, z: bzZ });
        const etatCoffreZ2 = await zoe2.attendre('cont_etat', 3000, m => m.cle === cleCoffreZ);
        eq(etatCoffreZ2.type, 'furnace',
           'SPEC-SYNC-021 : le conteneur posé (un fourneau après remplacement) retrouve son TYPE après --monde');
        eq(etatCoffreZ2.slots.length, 3,
           'SPEC-SYNC-021 : … et sa taille réelle (3 cases), jamais agrandie ni tronquée à tort');
        zoe2.fermer();
      } finally {
        serveur2.kill();
        await dodo(200);
        try { fs.unlinkSync(fichierMonde); } catch (e) {}
      }
    } finally {
      try { serveur1.kill(); } catch (e) {}
    }

    // ── B1 (étape 7, docs/vague-2/B1.md § 7, SPEC-SYNC-012/013/015/016) :
    // registre des conteneurs posés, sur un serveur DÉDIÉ avec sa propre
    // semence (bois + sable, pour le fourneau) — pour ne pas perturber les
    // comptages ci-dessus (bois, caillou déjà vérifiés absents/présents).
    const portCont = PORT + 2;
    const seedCont = JSON.stringify([[B.LOG, 30], [B.SAND, 4]]);
    const serveurCont = spawn(process.execPath, [path.join(RACINE, 'server.js'), String(portCont), '--ouvert'], {
      cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { MC_TEST_INV: seedCont }),
    });
    const logsCont = [];
    serveurCont.stdout.on('data', d => logsCont.push(String(d)));
    serveurCont.stderr.on('data', d => logsCont.push('ERR ' + String(d)));
    try {
      for (let essai = 0; essai < 60; essai++) {
        await dodo(100);
        const sonde = await requete(portCont, '/index.html');
        if (sonde.code === 200) break;
      }

      /* Marche en ligne droite loin d'un point de départ (portée
         SPEC-SYNC-013) — même patron que integration-troc.js `marcherVers`,
         en sens inverse : le serveur fait foi sur la position (ENTREE), donc
         c'est le seul moyen légitime de s'éloigner d'un conteneur. */
      async function marcherLoin(client, depart, loin, msMax) {
        let s = 1;
        let pos = { x: depart.x, y: depart.y, z: depart.z };
        const fin = Date.now() + msMax;
        while (Date.now() < fin) {
          // cap recalculé à CHAQUE pas d'après la position actuelle (comme
          // marcherVers, en sens inverse) : robuste à un obstacle qui
          // dévierait la marche, contrairement à un cap fixé une fois.
          let ax = pos.x - depart.x, az = pos.z - depart.z;
          const norme = Math.hypot(ax, az);
          if (norme > loin) break;
          if (norme < 0.01) { ax = 0; az = 1; } else { ax /= norme; az /= norme; }
          const yaw = Math.atan2(-ax, -az);
          // avance + saute (bits 0 et 4 de TOUCHES, synchro.js) : un saut
          // continu franchit les dénivelés d'un bloc du terrain généré, que
          // marcherVers (integration-troc.js) n'a pas besoin de faire (elle
          // vise un PNJ souvent en terrain déjà dégagé).
          client.envoyer({ t: NP.MSG.ENTREE, s: s++, j: 0, dt: 0.05, k: 17, yaw: yaw, pitch: 0, v: 0 });
          await dodo(50);
          const m = client.messages.filter(x => x.t === 'etat').pop();
          if (m && m.toi && m.toi[0]) pos = { x: m.toi[0].x, y: m.toi[0].y, z: m.toi[0].z };
        }
        return pos;
      }

      let seqEve = 0, seqFaye = 0;
      const prochainSeqC = (qui) => (qui === 'eve' ? ++seqEve : ++seqFaye);

      // ── SPEC-SYNC-012/014 : deux joueurs sur le MÊME coffre — transferts
      // concurrents (aucun `await` entre les deux envois), conservation de
      // la somme totale (aucun objet dupliqué, aucun perdu).
      const eve = await connecter(portCont);
      eve.envoyer({ t: 'rejoindre', nom: 'Eve', locaux: 1 });
      const bvEve = await eve.attendre('bienvenue');
      const majEve0 = await eve.attendre('inv_maj');
      const posEve = bvEve.toi[0];
      const bx = Math.floor(posEve.x), by = Math.floor(posEve.y) + 3, bz = Math.floor(posEve.z);
      eve.envoyer({ t: 'bloc', x: bx, y: by, z: bz, id: B.CHEST, j: 0 });
      await eve.attendre('bloc', 2000, m => m.x === bx && m.z === bz && m.id === B.CHEST);
      const cleCoffre = `${bx},${by},${bz}`;

      const faye = await connecter(portCont);
      faye.envoyer({ t: 'rejoindre', nom: 'Faye', locaux: 1 });
      const bvFaye = await faye.attendre('bienvenue');
      const majFaye0 = await faye.attendre('inv_maj');

      eve.envoyer({ t: 'cont_ouvrir', j: 0, x: bx, y: by, z: bz });
      const etatEve1 = await eve.attendre('cont_etat', 3000, m => m.cle === cleCoffre);
      eq(compte(etatEve1.slots, B.LOG), 0, 'coffre neuf : vide au départ');
      faye.envoyer({ t: 'cont_ouvrir', j: 0, x: bx, y: by, z: bz });
      await faye.attendre('cont_etat', 3000, m => m.cle === cleCoffre);

      const logAvantEve = compte(majEve0.inv, B.LOG), logAvantFaye = compte(majFaye0.inv, B.LOG);
      const iLogEve = trouverIndex(majEve0.inv, B.LOG), iLogFaye = trouverIndex(majFaye0.inv, B.LOG);
      ok(iLogEve >= 0 && iLogFaye >= 0, 'Eve et Faye possèdent chacune du bois (semence dédiée)');

      const seqE1 = prochainSeqC('eve');
      eve.envoyer({ t: 'cont_transfert', j: 0, seq: seqE1,
                    de: { z: 'inv', i: iLogEve }, vers: { z: 'cont', cle: cleCoffre, i: 0 }, n: 3 });
      const seqF1 = prochainSeqC('faye');
      faye.envoyer({ t: 'cont_transfert', j: 0, seq: seqF1,
                     de: { z: 'inv', i: iLogFaye }, vers: { z: 'cont', cle: cleCoffre, i: 1 }, n: 2 });
      const [majEveDepot, majFayeDepot] = await Promise.all([
        eve.attendre('inv_maj', 3000, m => m.ack === seqE1),
        faye.attendre('inv_maj', 3000, m => m.ack === seqF1),
      ]);
      eq(compte(majEveDepot.inv, B.LOG), logAvantEve - 3, 'Eve : 3 bois quittent son inventaire vers le coffre');
      eq(compte(majFayeDepot.inv, B.LOG), logAvantFaye - 2, 'Faye : 2 bois quittent son inventaire vers le coffre');
      ok(majEveDepot.conteneurs && majEveDepot.conteneurs.some(d => d.cle === cleCoffre),
         'SPEC-SYNC-015 : le delta du coffre voyage DANS l\'INV_MAJ de l\'auteur (Eve), jamais un CONTENEUR_MAJ séparé pour elle');
      ok(faye.messages.some(m => m.t === 'cont_maj' && m.cle === cleCoffre),
         'SPEC-SYNC-015 : Faye (abonnée, pas auteure) reçoit un CONTENEUR_MAJ pour le dépôt d\'Eve');
      ok(eve.messages.some(m => m.t === 'cont_maj' && m.cle === cleCoffre),
         'SPEC-SYNC-015 : Eve (abonnée, pas auteure) reçoit un CONTENEUR_MAJ pour le dépôt de Faye');

      eve.envoyer({ t: 'cont_ouvrir', j: 0, x: bx, y: by, z: bz });
      const etatApresDepots = await eve.attendre('cont_etat', 3000, m => m.cle === cleCoffre && m.rev > etatEve1.rev);
      eq(compte(etatApresDepots.slots, B.LOG), 5,
         'SPEC-SYNC-014 : le coffre contient la somme EXACTE des deux dépôts concurrents (3+2, aucune duplication, aucune perte)');

      // ── SPEC-SYNC-012 : casse d'un conteneur alors que DEUX joueurs
      // l'avaient ouvert — le contenu tombe UNE SEULE fois (la casse est un
      // événement serveur unique), et plus personne ne peut agir dessus.
      eve.envoyer({ t: 'bloc', x: bx, y: by, z: bz, id: 0, outil: 0, j: 0 });
      await eve.attendre('bloc', 2000, m => m.x === bx && m.z === bz && m.id === 0);
      const seqF2 = prochainSeqC('faye');
      faye.envoyer({ t: 'cont_transfert', j: 0, seq: seqF2,
                     de: { z: 'cont', cle: cleCoffre, i: 0 }, vers: { z: 'inv', i: 0 }, n: 1 });
      const majFayeApresCasse = await faye.attendre('inv_maj', 3000, m => m.ack === seqF2);
      ok(majFayeApresCasse.refus && majFayeApresCasse.refus.some(r => r.motif === 'ferme'),
         'SPEC-SYNC-012 : un conteneur cassé refuse tout nouveau transfert (motif ferme) — pas de lâcher en double, pas de fantôme');
      faye.envoyer({ t: 'cont_ouvrir', j: 0, x: bx, y: by, z: bz });
      const etatApresCasse = await faye.attendre('cont_etat', 3000, m => m.cle === cleCoffre && m.rev === 0);
      eq(compte(etatApresCasse.slots, B.LOG), 0,
         'SPEC-SYNC-012 : un coffre reposé au même endroit repart neuf et vide (le contenu est tombé au sol une seule fois)');

      // ── SPEC-SYNC-007/014 : déconnexion avec un objet visuellement « en
      // main » — au niveau du contrat, tenir un objet est PUREMENT local
      // (ui.js `heldStack`, jamais envoyé tant que la case de destination
      // n'a pas reçu le second clic) : rien ne part sur le réseau, donc rien
      // ne peut être dupliqué NI perdu en se déconnectant à cet instant. On
      // le prouve en s'arrêtant volontairement après le SEUL message
      // effectivement transmis (le dépôt) et en vérifiant que le coffre
      // retrouvé après reconnexion contient EXACTEMENT ce qui a été envoyé.
      const bx2 = bx + 4, by2 = by, bz2 = bz;
      const cleCoffre2 = `${bx2},${by2},${bz2}`;
      eve.envoyer({ t: 'bloc', x: bx2, y: by2, z: bz2, id: B.CHEST, j: 0 });
      await eve.attendre('bloc', 2000, m => m.x === bx2 && m.z === bz2 && m.id === B.CHEST);
      eve.envoyer({ t: 'cont_ouvrir', j: 0, x: bx2, y: by2, z: bz2 });
      await eve.attendre('cont_etat', 3000, m => m.cle === cleCoffre2);
      const iLogEve2 = trouverIndex(majEveDepot.inv, B.LOG);
      ok(iLogEve2 >= 0, 'Eve possède encore du bois pour le second coffre');
      const seqE2 = prochainSeqC('eve');
      eve.envoyer({ t: 'cont_transfert', j: 0, seq: seqE2,
                    de: { z: 'inv', i: iLogEve2 }, vers: { z: 'cont', cle: cleCoffre2, i: 0 }, n: 4 });
      await eve.attendre('inv_maj', 3000, m => m.ack === seqE2);
      eve.fermer();
      await dodo(300);
      const eve2 = await connecter(portCont);
      eve2.envoyer({ t: 'rejoindre', nom: 'Eve', locaux: 1 });
      const bvEve2 = await eve2.attendre('bienvenue');
      const majEve2 = await eve2.attendre('inv_maj');
      eve2.envoyer({ t: 'cont_ouvrir', j: 0, x: bx2, y: by2, z: bz2 });
      const etatApresReco = await eve2.attendre('cont_etat', 3000, m => m.cle === cleCoffre2);
      eq(compte(etatApresReco.slots, B.LOG), 4,
         'SPEC-SYNC-014 : déconnexion après un dépôt réel — le coffre garde EXACTEMENT ce qui a été envoyé, ni dupliqué ni perdu');

      // ── SPEC-SYNC-013 : portée revérifiée à CHAQUE opération, pas
      // seulement à l'ouverture — un coffre déjà ouvert refuse un transfert
      // dès que le joueur s'en est éloigné de plus de 6 blocs.
      faye.envoyer({ t: 'cont_ouvrir', j: 0, x: bx2, y: by2, z: bz2 });
      await faye.attendre('cont_etat', 3000, m => m.cle === cleCoffre2 && m.rev >= 0);
      const posFayeDepart = bvFaye.toi[0];
      const posFayeLoin = await marcherLoin(faye, posFayeDepart, 20, 8000);
      ok(Math.hypot(posFayeLoin.x - posFayeDepart.x, posFayeLoin.z - posFayeDepart.z) > 6,
         'Faye s\'est bien éloignée de plus de 6 blocs');
      const seqF3 = prochainSeqC('faye');
      faye.envoyer({ t: 'cont_transfert', j: 0, seq: seqF3,
                     de: { z: 'inv', i: 0 }, vers: { z: 'cont', cle: cleCoffre2, i: 1 }, n: 1 });
      const majFayeTransfertLoin = await faye.attendre('inv_maj', 3000, m => m.ack === seqF3);
      ok(majFayeTransfertLoin.refus && majFayeTransfertLoin.refus.some(r => r.motif === 'ferme'),
         'SPEC-SYNC-013 : transfert refusé (motif ferme) sur un conteneur déjà ouvert mais devenu hors de portée');
      const seqF4 = prochainSeqC('faye');
      faye.envoyer({ t: 'cont_ouvrir', j: 0, seq: seqF4, x: bx2, y: by2, z: bz2 });
      const majFayeOuvrirLoin = await faye.attendre('inv_maj', 3000, m => m.ack === seqF4);
      ok(majFayeOuvrirLoin.refus && majFayeOuvrirLoin.refus.some(r => r.motif === 'portee'),
         'SPEC-SYNC-013 : CONTENEUR_OUVRIR hors portée refusé (motif portee)');

      // ── SPEC-SYNC-013 : la banque exige la proximité d'un bloc coffre-fort
      // — REvérifiée après éloignement, exactement comme un coffre.
      const posEve2 = bvEve2.toi[0];
      const bxB = Math.floor(posEve2.x), byB = Math.floor(posEve2.y) + 3, bzB = Math.floor(posEve2.z);
      eve2.envoyer({ t: 'bloc', x: bxB, y: byB, z: bzB, id: B.COFFRE_FORT, j: 0 });
      await eve2.attendre('bloc', 2000, m => m.x === bxB && m.z === bzB && m.id === B.COFFRE_FORT);
      eve2.envoyer({ t: 'cont_ouvrir', j: 0, x: bxB, y: byB, z: bzB });
      const etatBanque = await eve2.attendre('cont_etat', 3000, m => m.cle === 'banque');
      eq(etatBanque.type, 'banque', 'CONTENEUR_OUVRIR sur un coffre-fort ouvre bien la banque');
      const iLogEve3 = trouverIndex(majEve2.inv, B.LOG);
      ok(iLogEve3 >= 0, 'Eve possède du bois pour la banque');
      const seqE3 = prochainSeqC('eve');
      eve2.envoyer({ t: 'cont_transfert', j: 0, seq: seqE3,
                     de: { z: 'inv', i: iLogEve3 }, vers: { z: 'cont', cle: 'banque', i: 0 }, n: 2 });
      const majDepotBanque = await eve2.attendre('inv_maj', 3000, m => m.ack === seqE3);
      ok(!majDepotBanque.refus || !majDepotBanque.refus.length, 'dépôt en banque accepté à portée du coffre-fort');
      const posEve2Loin = await marcherLoin(eve2, posEve2, 20, 8000);
      ok(Math.hypot(posEve2Loin.x - posEve2.x, posEve2Loin.z - posEve2.z) > 6, 'Eve s\'est bien éloignée du coffre-fort');
      const seqE4 = prochainSeqC('eve');
      eve2.envoyer({ t: 'cont_transfert', j: 0, seq: seqE4,
                     de: { z: 'inv', i: iLogEve3 }, vers: { z: 'cont', cle: 'banque', i: 1 }, n: 1 });
      const majBanqueLoin = await eve2.attendre('inv_maj', 3000, m => m.ack === seqE4);
      ok(majBanqueLoin.refus && majBanqueLoin.refus.some(r => r.motif === 'ferme'),
         'SPEC-SYNC-013 : la banque refuse un transfert dès qu\'on s\'est éloigné du coffre-fort (revérifié à chaque opération)');
      const seqE5 = prochainSeqC('eve');
      eve2.envoyer({ t: 'cont_ouvrir', j: 0, seq: seqE5, x: bxB, y: byB, z: bzB });
      const majOuvrirBanqueLoin = await eve2.attendre('inv_maj', 3000, m => m.ack === seqE5);
      ok(majOuvrirBanqueLoin.refus && majOuvrirBanqueLoin.refus.some(r => r.motif === 'portee'),
         'SPEC-SYNC-013 : ouverture de la banque hors portée refusée (motif portee)');

      // ── SPEC-SYNC-015/016 : un fourneau posé cuit MÊME sans personne
      // d'abonné (la cuisson n'attend pas un spectateur), mais ne diffuse un
      // CONTENEUR_MAJ qu'à qui l'a ouvert — jamais dans le vide.
      const ivan = await connecter(portCont);
      ivan.envoyer({ t: 'rejoindre', nom: 'Ivan', locaux: 1 });
      const bvIvan = await ivan.attendre('bienvenue');
      const majIvan0 = await ivan.attendre('inv_maj');
      const posIvan = bvIvan.toi[0];
      // décalage distinct des autres blocs déjà posés au même point de
      // spawn (bx, bx2, bxB partagent tous le même « x,z » de départ)
      const bxF = Math.floor(posIvan.x) - 4, byF = Math.floor(posIvan.y) + 3, bzF = Math.floor(posIvan.z) - 4;
      ivan.envoyer({ t: 'bloc', x: bxF, y: byF, z: bzF, id: B.FURNACE, j: 0 });
      await ivan.attendre('bloc', 2000, m => m.x === bxF && m.z === bzF && m.id === B.FURNACE);
      const cleFour = `${bxF},${byF},${bzF}`;
      ivan.envoyer({ t: 'cont_ouvrir', j: 0, x: bxF, y: byF, z: bzF });
      const etatFour0 = await ivan.attendre('cont_etat', 3000, m => m.cle === cleFour);
      eq(etatFour0.type, 'furnace', 'le fourneau posé est bien reconnu comme conteneur de type furnace');
      const F_ENTREE = 0, F_COMBUSTIBLE = 1;
      const iSand = trouverIndex(majIvan0.inv, B.SAND), iLogIvan = trouverIndex(majIvan0.inv, B.LOG);
      ok(iSand >= 0 && iLogIvan >= 0, 'Ivan possède du sable et du bois (semence dédiée au fourneau)');
      let seqIvan = 0;
      seqIvan++;
      ivan.envoyer({ t: 'cont_transfert', j: 0, seq: seqIvan,
                     de: { z: 'inv', i: iSand }, vers: { z: 'cont', cle: cleFour, i: F_ENTREE }, n: 1 });
      await ivan.attendre('inv_maj', 3000, m => m.ack === seqIvan);
      seqIvan++;
      ivan.envoyer({ t: 'cont_transfert', j: 0, seq: seqIvan,
                     de: { z: 'inv', i: iLogIvan }, vers: { z: 'cont', cle: cleFour, i: F_COMBUSTIBLE }, n: 3 });
      await ivan.attendre('inv_maj', 3000, m => m.ack === seqIvan);
      await dodo(2000);   // encore abonné : la cadence de message (§ 7) doit avoir déjà parlé
      ok(ivan.messages.some(m => m.t === 'cont_maj' && m.cle === cleFour),
         'SPEC-SYNC-015 : abonné, Ivan voit la progression du fourneau (CONTENEUR_MAJ)');
      ivan.envoyer({ t: 'cont_fermer', j: 0, cle: cleFour });
      await dodo(150);
      const nMajAvantSilence = ivan.messages.filter(m => m.t === 'cont_maj').length;
      await dodo(6500);   // le sable finit de cuire (Inv.SMELT_TIME = 6 s) SANS personne pour le voir
      eq(ivan.messages.filter(m => m.t === 'cont_maj').length, nMajAvantSilence,
         'SPEC-SYNC-016 : aucun CONTENEUR_MAJ n\'est émis tant que personne n\'est abonné');
      ivan.envoyer({ t: 'cont_ouvrir', j: 0, x: bxF, y: byF, z: bzF });
      const etatFourApres = await ivan.attendre('cont_etat', 3000, m => m.cle === cleFour && m.rev > etatFour0.rev);
      ok(compte(etatFourApres.slots, B.GLASS) >= 1,
         'SPEC-SYNC-016 : le fourneau a cuit le sable en verre alors que personne ne regardait');

      // ── Revue adversariale (défaut confirmé, gravité élevée) : le contrat
      // (validerEmplacement) plafonne génériquement `i` à 27 pour TOUTE zone
      // 'cont', bien au-delà de la taille RÉELLE d'un fourneau (3) ou d'une
      // étagère (9) — sans la vérification serveur, `slots[20] = …` aurait
      // agrandi le tableau, et le conteneur ENTIER aurait disparu,
      // silencieusement, à la persistance --monde (validerConteneurPersiste
      // exige slots.length === taille).
      const iLogIvan2 = trouverIndex(majIvan0.inv, B.LOG);
      const seqHorsBornesFour = ++seqIvan;
      ivan.envoyer({ t: 'cont_transfert', j: 0, seq: seqHorsBornesFour,
                     de: { z: 'inv', i: iLogIvan2 }, vers: { z: 'cont', cle: cleFour, i: 20 }, n: 1 });
      const majHorsBornesFour = await ivan.attendre('inv_maj', 3000, m => m.ack === seqHorsBornesFour);
      ok(majHorsBornesFour.refus && majHorsBornesFour.refus.some(r => r.motif === 'incompatible'),
         'SPEC-SYNC-014 (revue adversariale) : un indice hors de la taille réelle du fourneau (i=20, taille 3) est refusé');
      ivan.envoyer({ t: 'cont_ouvrir', j: 0, x: bxF, y: byF, z: bzF });
      const etatFourBorne = await ivan.attendre('cont_etat', 3000, m => m.cle === cleFour && m.rev >= etatFourApres.rev);
      eq(etatFourBorne.slots.length, 3, 'le fourneau garde EXACTEMENT 3 cases après la tentative refusée — jamais agrandi');

      // même vérification sur une étagère (taille 9), posée à un endroit
      // distinct — près du JOUEUR (pas du fourneau, déjà à la limite de la
      // portée d'OUVERTURE, 6 blocs, plus stricte que celle de POSE, 7)
      const bxE = Math.floor(posIvan.x) + 1, byE = Math.floor(posIvan.y) + 3, bzE = Math.floor(posIvan.z) + 1;
      ivan.envoyer({ t: 'bloc', x: bxE, y: byE, z: bzE, id: B.ETAGERE, j: 0 });
      await ivan.attendre('bloc', 2000, m => m.x === bxE && m.z === bzE && m.id === B.ETAGERE);
      const cleEtagere = `${bxE},${byE},${bzE}`;
      ivan.envoyer({ t: 'cont_ouvrir', j: 0, x: bxE, y: byE, z: bzE });
      const etatEtagere0 = await ivan.attendre('cont_etat', 3000, m => m.cle === cleEtagere);
      eq(etatEtagere0.type, 'etagere', 'l\'étagère est bien reconnue comme conteneur de type etagere');
      eq(etatEtagere0.slots.length, 9, 'taille correcte de l\'étagère (9 cases)');
      const seqHorsBornesEtagere = ++seqIvan;
      ivan.envoyer({ t: 'cont_transfert', j: 0, seq: seqHorsBornesEtagere,
                     de: { z: 'inv', i: iLogIvan2 }, vers: { z: 'cont', cle: cleEtagere, i: 20 }, n: 1 });
      const majHorsBornesEtagere = await ivan.attendre('inv_maj', 3000, m => m.ack === seqHorsBornesEtagere);
      ok(majHorsBornesEtagere.refus && majHorsBornesEtagere.refus.some(r => r.motif === 'incompatible'),
         'SPEC-SYNC-014 (revue adversariale) : un indice hors de la taille réelle de l\'étagère (i=20, taille 9) est refusé');
      ivan.envoyer({ t: 'cont_ouvrir', j: 0, x: bxE, y: byE, z: bzE });
      const etatEtagereBorne = await ivan.attendre('cont_etat', 3000, m => m.cle === cleEtagere && m.rev >= etatEtagere0.rev);
      eq(etatEtagereBorne.slots.length, 9, 'l\'étagère garde EXACTEMENT 9 cases après la tentative refusée — jamais agrandie');
      eq(compte(etatEtagereBorne.slots, B.LOG), 0, 'aucun bois n\'est apparu dans l\'étagère après le refus (aucune quantité créée)');

      eve2.fermer(); faye.fermer(); ivan.fermer();
      await dodo(200);
    } catch (e) {
      echecs++;
      details.push(`  ${C.r}✗ exception (conteneurs) : ${e.message}${C.x}\n${C.d}${e.stack}${C.x}`);
    } finally {
      serveurCont.kill();
      await dodo(200);
      if (echecs && logsCont.length) console.log(C.d + 'journal serveur (conteneurs) :\n' + logsCont.join('') + C.x);
    }

  } catch (e) {
    echecs++;
    details.push(`  ${C.r}✗ exception : ${e.message}${C.x}\n${C.d}${e.stack}${C.x}`);
  } finally {
    serveur.kill();
    await dodo(200);
  }

  console.log(`\n${C.b}Integration inventaire (B1)${C.x}`);
  console.log(details.join('\n'));
  const total = passes + echecs;
  if (echecs) {
    console.log(`\n${C.r}${echecs} echec(s)${C.x} sur ${total}\n`);
    if (logs.length) console.log(C.d + 'journal serveur :\n' + logs.join('') + C.x);
    process.exit(1);
  }
  console.log(`\n${C.g}${passes}/${total} tests d integration passent${C.x}\n`);
  process.exit(0);
})();
