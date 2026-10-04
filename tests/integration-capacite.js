/* integration-capacite.js — SPEC-SERVEUR-010 : `maxJoueurs` borne le nombre
   de JOUEURS présents, écran partagé compris, pas le nombre de connexions.
   Vraies sockets TCP, vrai protocole — même patron que integration-net.js
   (dont ce fichier réutilise le client WebSocket minimal), sur son propre
   serveur dédié (`--max-joueurs 3`) pour ne jamais perturber les scénarios
   plus larges d'integration-net.js.

   Usage : node tests/integration-capacite.js [port] */
'use strict';
require('./journal-temp.js');   // journal des serveurs lancés : dossier temporaire (SPEC-BANC-106)
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { spawn } = require('child_process');

const RACINE = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8098;

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

// ── client WebSocket minimal (copie d'integration-net.js) ───────────────────
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
      res.on('end', () => resolve({ code: res.statusCode, corps, type: res.headers['content-type'] }));
    }).on('error', () => resolve({ code: 0, corps: '' }));
  });
}
const dodo = (ms) => new Promise(r => setTimeout(r, ms));

// ── scénario ─────────────────────────────────────────────────────────────────
(async function () {
  const serveur = spawn(process.execPath,
    [path.join(RACINE, 'server.js'), String(PORT), '--max-joueurs', '3', '--ouvert'],
    { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'] });
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
    // Alice arrive en écran partagé à 2 joueurs locaux : 2/3 places occupées.
    const alice = await connecter(PORT);
    alice.envoyer({ t: 'rejoindre', nom: 'Alice', locaux: 2 });
    const bienvenueAlice = await alice.attendre('bienvenue', 5000);
    ok(!!bienvenueAlice, 'Alice (2 locaux) est admise — 2/3 places occupées');

    // Bob arrive à son tour à 2 joueurs locaux : 2+2=4 > 3, refusé EN BLOC —
    // jamais une partie de son équipe admise pendant que l'autre est rejetée.
    const bob = await connecter(PORT);
    bob.envoyer({ t: 'rejoindre', nom: 'Bob', locaux: 2 });
    const refusBob = await bob.attendre('refus', 5000);
    eq(refusBob.motif, 'serveur_complet', 'Bob (2 locaux) refusé en bloc — dépasserait 3 (2+2)');
    bob.fermer();

    // Chloé arrive seule (1 local) : 2+1=3, la place exacte restante.
    const chloe = await connecter(PORT);
    chloe.envoyer({ t: 'rejoindre', nom: 'Chloe', locaux: 1 });
    const bienvenueChloe = await chloe.attendre('bienvenue', 5000);
    ok(!!bienvenueChloe, 'Chloé (1 local) est admise — comble exactement 3/3');

    // Une place de plus, même minime (1 local), est refusée : le serveur
    // est bien plein (3 vrais joueurs, pas « 2 connexions »).
    const dan = await connecter(PORT);
    dan.envoyer({ t: 'rejoindre', nom: 'Dan', locaux: 1 });
    const refusDan = await dan.attendre('refus', 5000);
    eq(refusDan.motif, 'serveur_complet', 'Dan (1 local) refusé — 3/3 déjà occupées par 2 connexions');
    dan.fermer();

    alice.fermer();
    chloe.fermer();
  } catch (e) {
    echecs++;
    details.push(`  ${C.r}✗ exception${C.x} : ${e.message}\n${e.stack}`);
  } finally {
    serveur.kill();
    await dodo(150);
  }

  console.log(`${C.b}integration-capacite${C.x} (${passes + echecs} test(s))`);
  details.forEach(d => console.log(d));
  if (echecs) console.log(`\n${logs.slice(-20).join('')}`);
  console.log(echecs
    ? `${C.r}${echecs} échec(s)${C.x} sur ${passes + echecs} tests`
    : `${C.g}${passes}/${passes} tests d'intégration passent${C.x}`);
  process.exit(echecs ? 1 : 0);
})();
