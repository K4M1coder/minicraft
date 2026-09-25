/* integration-inventaire.js — B1 : inventaire et conteneurs serveur, partie 1
   (docs/vague-2/B1.md § 9 étape 5, SPEC-SYNC-007 à 011, 014). Vrai processus
   server.js, vraies sockets TCP : REJOINDRE (registre, MC_TEST_INV), CRAFT,
   EQUIP/EQUIP_VU, MANGER, INV_CONSOMMER, INV_LACHER, INV_CREATIF, idempotence
   du `seq`, reconnexion sous le même nom.

   Usage : node tests/integration-inventaire.js [port]
   Le serveur est démarré et arrêté par le test lui-même. */
'use strict';
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { spawn } = require('child_process');

const RACINE = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8199;

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
  const serveur = spawn(process.execPath, [path.join(RACINE, 'server.js'), String(PORT)], {
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
    const seedMonde = JSON.stringify([[I.CUIR_CASQUE, 1]]);
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
      await zoe.attendre('bienvenue');
      const majZoe = await zoe.attendre('inv_maj');
      const iCasqueZoe = trouverIndex(majZoe.inv, I.CUIR_CASQUE);
      ok(iCasqueZoe >= 0, 'SPEC-SYNC-021 : le casque de Zoe est bien dans son inventaire initial');
      zoe.envoyer({ t: 'equip', j: 0, seq: 1, slot: 'casque', i: iCasqueZoe });
      await zoe.attendre('inv_maj', 3000, m => m.ack === 1);
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
        zoe2.fermer();
      } finally {
        serveur2.kill();
        await dodo(200);
        try { fs.unlinkSync(fichierMonde); } catch (e) {}
      }
    } finally {
      try { serveur1.kill(); } catch (e) {}
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
