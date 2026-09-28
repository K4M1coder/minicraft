/* integration-quetes.js — la part réseau de SPEC-QUETE-004 : le serveur reste
   seul arbitre du tableau de quêtes actives par joueur (server.js:traiterQuete,
   MC.Politique.accepterQuete/remettreQuete). Vraies sockets, vrai serveur,
   comme integration-pvp.js.

   Le déterminisme des QUÊTES DE FACTION elles-mêmes (naissance, proposition,
   récompense) est déjà couvert, pur et déterministe, par tests/spec-politique.js
   (describe « L46 ») — reproduire ici une vraie faction née d'une ville
   explorée serait fragile (dépend d'un lieu politique réel à une position
   connue à l'avance dans un monde généré, comme le note déjà l'en-tête
   d'integration-pvp.js pour SPEC-PVP-003/006). Ce script vérifie donc
   seulement ce qu'un test pur ne peut pas : le CHEMIN RÉSEAU réel (chat →
   server.js:traiterQuete → MC.Politique) répond bien, sans planter, et
   qu'une remise sans quête active échoue proprement (arbitrage serveur,
   jamais un client) — la non-duplication de la récompense elle-même est
   prouvée par spec-politique.js sur les MÊMES fonctions que celles que
   traiterQuete appelle.

   Usage : node tests/integration-quetes.js [port] */
'use strict';
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { spawn } = require('child_process');

const RACINE = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8219;

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

(async function () {
  const logs = [];
  const s = spawn(process.execPath, [path.join(RACINE, 'server.js'), '--port', String(PORT), '--admin', 'secretQuetes'],
                   { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'] });
  s.stdout.on('data', d => logs.push(String(d)));
  s.stderr.on('data', d => logs.push('ERR ' + String(d)));
  try {
    ok(await attendreDemarrage(PORT), 'le serveur démarre');

    const a = await connecter(PORT);
    a.envoyer({ t: 'rejoindre', nom: 'Alice', locaux: 1 });
    await a.attendre('bienvenue');

    // /quete lister ne plante jamais, même sans quête proposée
    a.envoyer({ t: 'chat', texte: '/quete lister' });
    const rep0 = await a.attendre('chat', 3000, m => m.type === 'systeme');
    ok(!!rep0, 'SPEC-QUETE-004 : /quete lister répond (chemin réseau chat → traiterQuete → MC.Politique)', rep0 && rep0.texte);

    // accepter une quête inconnue échoue proprement, sans planter le serveur
    a.envoyer({ t: 'chat', texte: '/quete accepter introuvable:0' });
    const repAcc = await a.attendre('chat', 3000, m => /introuvable/.test(m.texte || ''));
    ok(!!repAcc, 'SPEC-QUETE-004 : accepter une quête inconnue échoue proprement (arbitrage serveur)', repAcc && repAcc.texte);

    // remettre une quête jamais acceptée échoue — le serveur seul arbitre,
    // jamais un client qui prétendrait l'avoir déjà en cours
    a.envoyer({ t: 'chat', texte: '/quete remettre jamais-acceptee' });
    const repRem1 = await a.attendre('chat', 3000, m => /[Rr]ien à remettre/.test(m.texte || ''));
    ok(!!repRem1, 'SPEC-QUETE-004 : remettre sans quête active échoue (« introuvable » côté arbitrage)', repRem1 && repRem1.texte);

    // une double tentative de remise (même id, deux messages successifs)
    // échoue les DEUX fois faute d'acceptation préalable — le serveur ne se
    // laisse jamais abuser par la seule RÉPÉTITION d'une demande.
    a.envoyer({ t: 'chat', texte: '/quete remettre jamais-acceptee' });
    const repRem2 = await a.attendre('chat', 3000, m => /[Rr]ien à remettre/.test(m.texte || '') && m !== repRem1);
    ok(!!repRem2, 'SPEC-QUETE-004 : une répétition ne fait jamais réussir une remise arbitrée refusée', repRem2 && repRem2.texte);

    a.fermer();
    await dodo(150);
  } catch (e) {
    echecs++;
    details.push(`  ${C.r}✗ exception : ${e.message}${C.x}`);
  } finally {
    s.kill();
    await dodo(200);
  }

  console.log(`\n${C.b}Integration quêtes (SPEC-QUETE-004, arbitrage serveur)${C.x}`);
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
