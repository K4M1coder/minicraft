/* integration-pvp.js — tests d'intégration de SPEC-COMBAT-002 et de la part
   en ligne de SPEC-ZONE-002 : vraies sockets, vrai serveur, comme
   integration-net.js. Deux lancements successifs du serveur : l'un avec
   --pvp on (pour vérifier que le PvP marche ET reste soumis aux zones),
   l'autre sans (pour vérifier qu'il reste désactivé par défaut).

   Étendu (B4, docs/vague-2/B4.md § 11, SPEC-PVP-001 à 006) : les deux
   lancements existants portent aussi MC_TEST_INV, pour vérifier en plus —
   scénario 1 (sans --pvp) : /duel autorise le combat MÊME sans --pvp, et
   AUCUN butin/meurtre n'est compté pendant un duel (SPEC-PVP-001/003/005) ;
   scénario 2 (--pvp on) : une flèche entre membres d'une même faction
   n'inflige aucun dégât (SPEC-PVP-002 en ligne), et la défaite finale
   transfère un butin borné au vainqueur, annoncé par un message PVP
   victoire/défaite (SPEC-PVP-001/004). SPEC-PVP-003/006 (réputation,
   embargo) sont vérifiées par tests/spec-pvp.js (pur, déterministe) : les
   reproduire ici exigerait un lieu politique réel à une position connue à
   l'avance, fragile dans un monde généré — inutile, le calcul lui-même
   (fenêtre glissante, seuil, embargo recalculé) est déjà couvert.

   Usage : node tests/integration-pvp.js [port] */
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
const PORT = parseInt(process.argv[2], 10) || 8199;

const ctx = vm.createContext(Object.assign(Object.create(null), {
  console, Math, JSON, Date, Error, Number, String, Array, Object, Boolean,
  Map, Set, Uint8Array, isNaN, isFinite, parseInt, parseFloat,
}));
ctx.globalThis = ctx;
vm.runInContext(fs.readFileSync(path.join(RACINE, 'src/net-protocol.js'), 'utf8'), ctx);
const NP = ctx.MC.NetProtocol;

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
    let tampon = Buffer.alloc(0), etabli = false;
    const messages = [], attentes = [];
    const client = {
      socket: sock, messages,
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
      fermer() { try { sock.destroy(); } catch (e) {} },
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
const dodo = (ms) => new Promise(r => setTimeout(r, ms));

async function attendreDemarrage(port) {
  for (let essai = 0; essai < 60; essai++) {
    await dodo(100);
    const sonde = await requete(port, '/index.html');
    if (sonde.code === 200) return true;
  }
  return false;
}

// ── scénario ─────────────────────────────────────────────────────────────────
(async function () {
  const logs = [];

  // ── 1. serveur SANS --pvp : désactivé par défaut (SPEC-COMBAT-002) ────────
  // MC_TEST_INV='[[3,10]]' : 10 pierres (id 3, B.STONE) à quiconque rejoint
  // sans enregistrement existant — de quoi vérifier qu'un duel ne butine pas.
  const s1 = spawn(process.execPath, [path.join(RACINE, 'server.js'), '--port', String(PORT), '--admin', 'secret1', '--ouvert'],
                   { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { MC_TEST_INV: '[[3,10],[4116,1]]' }) });
  s1.stdout.on('data', d => logs.push(String(d)));
  s1.stderr.on('data', d => logs.push('ERR ' + String(d)));
  try {
    ok(await attendreDemarrage(PORT), 'le serveur (sans --pvp) démarre');

    const a1 = await connecter(PORT);
    a1.envoyer({ t: 'rejoindre', nom: 'Alice', locaux: 1 });
    const bA1 = await a1.attendre('bienvenue');
    const b1 = await connecter(PORT);
    b1.envoyer({ t: 'rejoindre', nom: 'Bob', locaux: 1 });
    const bB1 = await b1.attendre('bienvenue');
    ok(!!bB1.zone, 'SPEC-ZONE-004 : la bienvenue transmet la politique de zones du serveur');

    a1.envoyer({ t: 'attaque', j: 0, degats: 5, joueurCible: bB1.id + '/0' });
    await dodo(300);
    const toiB1 = (b1.messages.filter(m => m.t === 'etat').pop() || {}).toi;
    const pvBob1 = toiB1 && toiB1[0] && toiB1[0].pv;
    eq(pvBob1, 20, 'SPEC-COMBAT-002 : sans --pvp, une attaque entre joueurs ne fait AUCUN dégât');

    // ── SPEC-PVP-005 : un duel consenti autorise le combat MÊME sans --pvp ──
    a1.envoyer({ t: 'chat', texte: '/duel Bob' });
    const propose = await b1.attendre('pvp', 3000, m => m.evt === 'duel_propose');
    eq(propose.de, 'Alice', 'SPEC-PVP-005 : Bob reçoit la proposition de duel d\'Alice');
    b1.envoyer({ t: 'chat', texte: '/duel accepter' });
    await a1.attendre('pvp', 3000, m => m.evt === 'duel_debut');
    await b1.attendre('pvp', 3000, m => m.evt === 'duel_debut');

    const invBobAvant = (b1.messages.filter(m => m.t === 'inv_maj').pop() || {}).inv;
    a1.envoyer({ t: 'attaque', j: 0, degats: 5, joueurCible: bB1.id + '/0' });
    await dodo(500);   // laisse passer la cadence d'attaque (0,4 s) avant le prochain coup
    const toiB1d = (b1.messages.filter(m => m.t === 'etat').pop() || {}).toi;
    eq(toiB1d && toiB1d[0] && toiB1d[0].pv, 15, 'SPEC-PVP-005 : en duel, le coup porte même sans --pvp');

    // achever Bob DANS le duel : ni butin ni meurtre non consenti comptés
    // sous charge, la cadence serveur (0,4 s de temps de simulation) peut
    // ne pas être écoulée après 500 ms réelles : on frappe jusqu'à la défaite
    // (bornée) plutôt que de supposer que trois coups précis passent.
    for (let i = 0; i < 12 && !b1.messages.some(m => m.t === 'pvp' && m.evt === 'defaite'); i++) {
      a1.envoyer({ t: 'attaque', j: 0, degats: 5, joueurCible: bB1.id + '/0' });
      await dodo(500);
    }
    const defaite1 = await b1.attendre('pvp', 4000, m => m.evt === 'defaite');
    ok(!defaite1.perte || !defaite1.perte.length, 'SPEC-PVP-001/005 : aucun butin lors d\'une défaite en duel', JSON.stringify(defaite1));
    const victoire1 = await a1.attendre('pvp', 3000, m => m.evt === 'victoire');
    eq(victoire1.n, 1, 'SPEC-PVP-004 : première victoire comptée (message PVP victoire reçu par le vainqueur)');
    await dodo(200);
    ok(!a1.messages.some(m => m.t === 'succes_debloque' && /victoire_pvp/.test(m.id)),
       'SPEC-ARCHI-042 : une victoire en duel (sans enjeu) ne débloque aucun succès PvP (« Champion » non farmable)');
    const invBobApres = (b1.messages.filter(m => m.t === 'inv_maj').pop() || {}).inv;
    ok(JSON.stringify(invBobAvant) === JSON.stringify(invBobApres),
       'SPEC-PVP-001 : l\'inventaire de Bob est inchangé après une défaite en duel', JSON.stringify(invBobApres));

    a1.fermer(); b1.fermer();
    await dodo(150);
  } catch (e) {
    echecs++;
    details.push(`  ${C.r}✗ exception (sans --pvp) : ${e.message}${C.x}`);
  } finally {
    s1.kill();
    await dodo(200);
  }

  // ── 2. serveur AVEC --pvp on, zone forcée en PvP par un administrateur ────
  const PORT2 = PORT + 1;
  // MC_TEST_INV='[[3,20]]' : 20 pierres chacun, de quoi mesurer un butin
  // borné (10 à 25 % de 20 = 2 à 5) à la défaite finale (SPEC-PVP-001).
  const s2 = spawn(process.execPath,
    [path.join(RACINE, 'server.js'), '--port', String(PORT2), '--pvp', 'on', '--admin', 'secret2', '--zone', 'generee', '--ouvert'],
    { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { MC_TEST_INV: '[[3,20],[4116,1]]' }) });
  s2.stdout.on('data', d => logs.push(String(d)));
  s2.stderr.on('data', d => logs.push('ERR ' + String(d)));
  try {
    ok(await attendreDemarrage(PORT2), 'le serveur (--pvp on) démarre');

    const a = await connecter(PORT2);
    a.envoyer({ t: 'rejoindre', nom: 'Alice', locaux: 1 });
    const bA = await a.attendre('bienvenue');
    const b = await connecter(PORT2);
    b.envoyer({ t: 'rejoindre', nom: 'Bob', locaux: 1 });
    const bB = await b.attendre('bienvenue');

    // les joueurs naissent au point d'apparition, qui reste TOUJOURS sûr :
    // une attaque n'y fait aucun dégât même avec --pvp on (SPEC-ZONE-001/002)
    a.envoyer({ t: 'attaque', j: 0, degats: 5, joueurCible: bB.id + '/0' });
    await dodo(300);
    let toiB = (b.messages.filter(m => m.t === 'etat').pop() || {}).toi;
    eq(toiB && toiB[0] && toiB[0].pv, 20,
       'SPEC-ZONE-002 : même avec --pvp on, le point d\'apparition (zone sûre) protège du PvP');

    // un administrateur redéfinit la région où se tiennent les deux joueurs en zone PvP
    const admin = await connecter(PORT2);
    admin.envoyer({ t: 'rejoindre', nom: 'Admin', locaux: 1 });
    await admin.attendre('bienvenue');
    admin.envoyer({ t: 'admin', action: 'auth', args: { secret: 'secret2' } });
    const auth = await admin.attendre('admin_rep', 3000, m => m.action === 'auth');
    ok(auth.ok, 'SPEC-ADMIN-006 : authentification admin acceptée');
    const px = Math.floor(bA.toi[0].x), pz = Math.floor(bA.toi[0].z);
    admin.envoyer({ t: 'admin', action: 'zone_definir', args: { x: px, z: pz, zone: 'pvp' } });
    const rep = await admin.attendre('admin_rep', 3000, m => m.action === 'zone_definir');
    ok(rep.ok, 'SPEC-ZONE-004 : la redéfinition de région par un administrateur est acceptée');

    // désormais, l'attaque porte : c'est bien le serveur qui fait foi
    a.envoyer({ t: 'attaque', j: 0, degats: 5, joueurCible: bB.id + '/0' });
    await dodo(300);
    toiB = (b.messages.filter(m => m.t === 'etat').pop() || {}).toi;
    eq(toiB && toiB[0] && toiB[0].pv, 15,
       'SPEC-COMBAT-002 : en zone PvP et avec --pvp on, l\'attaque blesse réellement Bob');

    // factions de joueurs (SPEC-FACTION-010, 012) : le serveur fait foi
    a.envoyer({ t: 'chat', texte: '/faction creer Loups' });
    const cree = await a.attendre('chat', 3000, m => /Loups/.test(m.texte || '') && /fondée/.test(m.texte || ''));
    ok(!!cree, 'SPEC-FACTION-009 : /faction creer fonde la faction sur le serveur', cree && cree.texte);
    b.envoyer({ t: 'chat', texte: '/faction postuler Loups' });
    await b.attendre('chat', 3000, m => /Candidature envoyée/.test(m.texte || ''));
    a.envoyer({ t: 'chat', texte: '/faction accepter Loups Bob' });
    const acc = await a.attendre('chat', 3000, m => /Bob rejoint/.test(m.texte || ''));
    ok(!!acc, 'SPEC-FACTION-010 : le chef accepte la candidature', acc && acc.texte);
    a.envoyer({ t: 'attaque', j: 0, degats: 5, joueurCible: bB.id + '/0' });
    await dodo(600);
    toiB = (b.messages.filter(m => m.t === 'etat').pop() || {}).toi;
    eq(toiB && toiB[0] && toiB[0].pv, 15, 'SPEC-FACTION-012 : deux membres d\'une même faction ne se blessent pas');

    // ── SPEC-PVP-002 en ligne : une flèche entre membres d'une même faction
    // n'inflige pas davantage de dégâts que le corps à corps ci-dessus.
    a.envoyer({ t: 'tir', j: 0, dx: 0, dy: 0, dz: 1, vitesse: 30, degats: 5, genre: 'fleche' });
    await dodo(400);
    toiB = (b.messages.filter(m => m.t === 'etat').pop() || {}).toi;
    eq(toiB && toiB[0] && toiB[0].pv, 15, 'SPEC-PVP-002 : une flèche entre membres d\'une même faction n\'inflige aucun dégât');

    b.envoyer({ t: 'chat', texte: '/faction dire rendez-vous au col' });
    const canal = await a.attendre('chat', 3000, m => m.type === 'faction');
    ok(/\[Loups\] Bob : rendez-vous au col/.test(canal.texte), 'SPEC-FACTION-012 : le canal de faction porte le message', canal.texte);
    await dodo(200);
    ok(!admin.messages.some(m => m.t === 'chat' && m.type === 'faction'), 'SPEC-FACTION-012 : un non-membre ne le reçoit pas');
    b.envoyer({ t: 'chat', texte: '/faction quitter Loups' });
    await b.attendre('chat', 3000, m => /Vous quittez/.test(m.texte || ''));
    await dodo(500);

    // une cible qui n'existe pas ne fait aucun dégât (mêmes règles qu'en PvE)
    a.envoyer({ t: 'attaque', j: 0, degats: 100, joueurCible: '9999/0' });
    await dodo(150);
    toiB = (b.messages.filter(m => m.t === 'etat').pop() || {}).toi;
    eq(toiB && toiB[0] && toiB[0].pv, 15, 'une cible introuvable ne fait aucun dégât');

    // achever Bob : le serveur annonce qui a vaincu qui (chat)
    const invAliceAvant = (a.messages.filter(m => m.t === 'inv_maj').pop() || {}).inv;
    for (let i = 0; i < 4; i++) {
      a.envoyer({ t: 'attaque', j: 0, degats: 5, joueurCible: bB.id + '/0' });
      await dodo(500);                          // laisse passer la cadence d'attaque (0,4 s)
    }
    const annonce = await a.attendre('chat', 4000, m => /vaincu/.test(m.texte || ''));
    ok(/Alice/.test(annonce.texte) && /Bob/.test(annonce.texte),
       'SPEC-COMBAT-002 : le serveur annonce qui a vaincu qui', annonce && annonce.texte);

    // ── SPEC-PVP-001/004 : butin borné (10-25 % de 20 pierres = 2 à 5),
    // reçu exactement par le vainqueur, victoire/défaite annoncées ────────
    const victoire = await a.attendre('pvp', 3000, m => m.evt === 'victoire');
    eq(victoire.contre, 'Bob', 'SPEC-PVP-004 : Alice reçoit sa victoire contre Bob');
    eq(victoire.n, 1, 'SPEC-PVP-004 : première victoire d\'Alice comptée par le serveur');
    const succesPvp = await a.attendre('succes_debloque', 3000, m => m.id === 'premiere_victoire_pvp').catch(() => null);
    ok(!!succesPvp, 'SPEC-ARCHI-042 : une vraie victoire PvP (hors duel) débloque « Premier sang » côté serveur');
    const defaite = await b.attendre('pvp', 3000, m => m.evt === 'defaite');
    eq(defaite.de, 'Alice', 'SPEC-PVP-001 : Bob apprend qui l\'a vaincu');
    const pertesBob = (defaite.perte || []).reduce((s, p) => s + p.n, 0);
    ok(pertesBob >= 2 && pertesBob <= 5, `SPEC-PVP-001 : perte de Bob (${pertesBob}) dans les bornes [2,5] (10-25 % de 20)`, JSON.stringify(defaite));
    await dodo(200);
    const invBobFinal = (b.messages.filter(m => m.t === 'inv_maj').pop() || {}).inv;
    const totalBobFinal = (invBobFinal || []).reduce((s, c) => s + (c ? c[1] : 0), 0);
    eq(totalBobFinal, 21 - pertesBob, 'SPEC-PVP-001 : Bob garde exactement ce qu\'il n\'a pas perdu');
    const invAliceApres = (a.messages.filter(m => m.t === 'inv_maj').pop() || {}).inv;
    const totalAliceAvant = (invAliceAvant || []).reduce((s, c) => s + (c ? c[1] : 0), 0);
    const totalAliceApres = (invAliceApres || []).reduce((s, c) => s + (c ? c[1] : 0), 0);
    eq(totalAliceApres - totalAliceAvant, pertesBob, 'SPEC-PVP-001 : Alice reçoit exactement ce que Bob a perdu (aucune duplication)');

    a.fermer(); b.fermer(); admin.fermer();
    await dodo(150);
  } catch (e) {
    echecs++;
    details.push(`  ${C.r}✗ exception (--pvp on) : ${e.message}${C.x}`);
  } finally {
    s2.kill();
    await dodo(200);
  }

  console.log(`\n${C.b}Integration PvP (SPEC-COMBAT-002, SPEC-ZONE)${C.x}`);
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
