/* integration-net.js — tests d'intégration du serveur : vraies sockets TCP,
   vraie poignée de main WebSocket, vrai protocole. Complète spec-net.js, qui
   ne teste que les octets, jamais la connexion.

   Usage : node tests/integration-net.js [port]
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
const PORT = parseInt(process.argv[2], 10) || 8099;

// on réutilise le module de protocole, exactement comme le serveur
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

// ── client WebSocket minimal ────────────────────────────────────────────────
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
        // le client DOIT masquer ses trames
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
      /* Attend un message d'un type donné, avec délai maximal : sans quoi un
         test qui n'aboutit pas bloquerait indéfiniment. */
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
        const attendu = crypto.createHash('sha1')
          .update(cle + NP.GUID).digest('base64');
        if (!entetes.includes('101') || !entetes.includes(attendu)) {
          reject(new Error('poignee de main refusee'));
          return;
        }
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
  const serveur = spawn(process.execPath, [path.join(RACINE, 'server.js'), String(PORT)],
                        { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  serveur.stdout.on('data', d => logs.push(String(d)));
  serveur.stderr.on('data', d => logs.push('ERR ' + String(d)));
  serveur.on('error', e => logs.push('SPAWN ' + e.message));

  /* On attend que le serveur ECOUTE vraiment plutot qu'un delai fixe : la
     generation initiale du monde prend un temps variable selon la machine,
     et un delai fixe rend le test capricieux. */
  for (let essai = 0; essai < 60; essai++) {
    await dodo(100);
    const sonde = await requete(PORT, '/index.html');
    if (sonde.code === 200) break;
  }

  try {
    // ── SPEC-NET-019 / 020 : fichiers statiques
    const idx = await requete(PORT, '/index.html');
    eq(idx.code, 200, 'SPEC-NET-019 : index.html est servi');
    ok(/text\/html/.test(idx.type || ''), 'SPEC-NET-019 : type MIME correct');
    const src = await requete(PORT, '/src/core.js');
    eq(src.code, 200, 'SPEC-NET-019 : les modules sont servis');
    const racine = await requete(PORT, '/');
    eq(racine.code, 200, 'SPEC-NET-019 : la racine sert index.html');

    const hack = await requete(PORT, '/../server.js');
    ok(hack.code === 403 || hack.code === 404,
       'SPEC-NET-020 : la remontee de chemin est refusee', 'code ' + hack.code);
    const hack2 = await requete(PORT, '/%2e%2e%2fserver.js');
    ok(hack2.code === 403 || hack2.code === 404,
       'SPEC-NET-020 : la remontee encodee est refusee', 'code ' + hack2.code);

    // ── SPEC-NET-001 : poignee de main reelle
    const a = await connecter(PORT);
    ok(true, 'SPEC-NET-001 : la poignee de main aboutit sur une vraie socket');

    // ── SPEC-NET-009 / 010 : bienvenue
    a.envoyer({ t: 'rejoindre', nom: 'Alice', locaux: 2 });
    const bienvenueA = await a.attendre('bienvenue');
    ok(typeof bienvenueA.id === 'number', 'SPEC-NET-010 : un identifiant est attribue');
    ok(typeof bienvenueA.graine === 'number', 'SPEC-NET-009 : la graine est transmise');
    ok(!!bienvenueA.mode, 'SPEC-NET-009 : le mode est transmis');
    ok(!!bienvenueA.difficulte, 'SPEC-NET-009 : la difficulte est transmise');
    ok(typeof bienvenueA.heure === 'number', 'SPEC-NET-009 : l heure est transmise');
    ok(Array.isArray(bienvenueA.blocs), 'SPEC-NET-018 : l etat du monde est transmis');

    // ── SPEC-NET-011 : pose de bloc diffusee
    const b = await connecter(PORT);
    b.envoyer({ t: 'rejoindre', nom: 'Bob', locaux: 1 });
    const bienvenueB = await b.attendre('bienvenue');
    ok(bienvenueB.id !== bienvenueA.id, 'SPEC-NET-010 : les identifiants sont distincts');
    ok(bienvenueB.joueurs.some(j => j.nom === 'Alice'),
       'SPEC-NET-021 : les joueurs deja presents sont annonces');

    const arrivee = await a.attendre('arrive');
    eq(arrivee.nom, 'Bob', 'SPEC-NET-021 : l arrivee de Bob est signalee a Alice');

    /* Le serveur fait autorité et vérifie la portée : on pose le bloc juste
       au-dessus de la tête d'Alice, là où elle se tient — donc dans l'air. */
    const moi = bienvenueA.toi && bienvenueA.toi[0];
    ok(!!moi && typeof moi.x === 'number', 'SPEC-NET-028 : la bienvenue donne la position qui fait foi');
    const BX = Math.floor(moi.x), BY = Math.floor(moi.y) + 3, BZ = Math.floor(moi.z);
    a.envoyer({ t: 'bloc', x: BX, y: BY, z: BZ, id: 9 });
    const blocRecu = await b.attendre('bloc');
    eq(blocRecu.x, BX, 'SPEC-NET-011 : Bob recoit la pose de bloc');
    eq(blocRecu.id, 9, 'SPEC-NET-011 : avec le bon identifiant de bloc');
    const blocEcho = await a.attendre('bloc');
    ok(!!blocEcho, 'SPEC-NET-012 : l emetteur recoit aussi la confirmation du serveur');

    // ── SPEC-NET-014 : chat diffuse a tous
    a.envoyer({ t: 'chat', texte: 'bonjour tout le monde' });
    const chatB = await b.attendre('chat', 3000, m => m.auteur === 'Alice');
    ok(chatB.texte.indexOf('bonjour') >= 0, 'SPEC-NET-014 : Bob recoit le message');
    eq(chatB.auteur, 'Alice', 'SPEC-NET-014 : l auteur est transmis');

    // ── SPEC-NET-026 : le client ne peut plus imposer sa position
    a.envoyer({ t: 'bouge', x: moi.x + 50, y: moi.y + 20, z: moi.z + 50, yaw: 1.2, pitch: -0.3 });
    await dodo(250);
    const apresBouge = a.messages.filter(m => m.t === 'etat').pop();
    ok(!!apresBouge && Math.abs(apresBouge.toi[0].x - moi.x) < 1,
       'SPEC-NET-026 : une position imposée par le client est ignorée');

    // ── SPEC-NET-013 / 016 / 017 : Alice avance par ses ENTRÉES, le serveur la déplace
    for (let s2 = 1; s2 <= 45; s2++) a.envoyer({ t: 'e', s: s2, j: 0, dt: 1 / 60, k: 1, yaw: 0, pitch: 0 });
    await dodo(700);
    const etat = b.messages.filter(m => m.t === 'etat').pop();
    const etatA = a.messages.filter(m => m.t === 'etat').pop();
    ok(!!etat, 'SPEC-NET-013 : un etat periodique est diffuse');
    if (etat && etatA) {
      const alice = etat.joueurs.find(j => j.id === bienvenueA.id);
      ok(!!alice, 'SPEC-NET-013 : la position d Alice est relayee a Bob');
      const toi = etatA.toi[0];
      eq(toi.s, 45, 'SPEC-NET-013 : le serveur a traité les 45 entrées');
      ok(Math.hypot(toi.x - moi.x, toi.z - moi.z) > 0.5, 'SPEC-NET-013 : et Alice a avancé');
      if (alice) ok(Math.abs(alice.x - toi.x) < 0.05 && Math.abs(alice.z - toi.z) < 0.05,
                    'SPEC-NET-013 : Bob voit Alice là où le serveur l a placée');
      ok(typeof toi.pv === 'number' && typeof toi.faim === 'number',
         'SPEC-NET-028 : vie et faim viennent du serveur');
      ok(Array.isArray(etat.mobs), 'SPEC-NET-016 : les mobs sont diffuses');
      ok(typeof etat.heure === 'number', 'SPEC-NET-017 : l heure du serveur est diffusee');
    }

    // ── SPEC-NET-027 : un bloc hors de portée est refusé, et le client corrigé
    a.envoyer({ t: 'bloc', x: BX + 40, y: BY, z: BZ, id: 9 });
    const correction = await a.attendre('bloc', 2000, m => m.x === BX + 40);
    ok(correction.id !== 9, 'SPEC-NET-027 : le serveur refuse et rappelle le vrai bloc');

    // ── SPEC-NET-029 : un rafraîchissement rapide
    const avantN = b.messages.filter(m => m.t === 'etat').length;
    await dodo(1000);
    const parSeconde = b.messages.filter(m => m.t === 'etat').length - avantN;
    ok(parSeconde >= 45, 'SPEC-NET-029 : au moins 45 états par seconde (' + parSeconde + ')');

    // ── SPEC-NET-018 : un nouveau venu recoit le monde deja modifie
    const c2 = await connecter(PORT);
    c2.envoyer({ t: 'rejoindre', nom: 'Chloe', locaux: 1 });
    const bienvenueC = await c2.attendre('bienvenue');
    ok(bienvenueC.blocs.some(x => x[0] === BX && x[1] === BY && x[2] === BZ && x[3] === 9),
       'SPEC-NET-018 : le bloc pose avant son arrivee lui est transmis');
    ok(bienvenueC.chat.length > 0, 'SPEC-NET-014 : l historique de chat lui est transmis');

    // ── SPEC-NET-008 : messages invalides ignores sans planter
    a.envoyer({ t: 'nawak', x: 1 });
    a.envoyer({ t: 'bloc', x: 'ceci', y: null, z: {}, id: 999 });
    a.envoyer({ pas_de_type: true });
    await dodo(250);
    a.envoyer({ t: 'chat', texte: 'toujours vivant' });
    const apres = await a.attendre('chat', 2500, m => /toujours vivant/.test(m.texte || ''));
    ok(apres.texte.indexOf('toujours vivant') >= 0,
       'SPEC-NET-008 : le serveur survit aux messages invalides');

    // ── SPEC-NET-015 : depart signale
    b.fermer();
    const depart = await a.attendre('quitte', 3000);
    eq(depart.nom, 'Bob', 'SPEC-NET-015 : le depart de Bob est signale');

    a.fermer(); c2.fermer();
    await dodo(200);

  } catch (e) {
    echecs++;
    details.push(`  ${C.r}✗ exception : ${e.message}${C.x}`);
  } finally {
    serveur.kill();
    await dodo(200);
  }

  console.log(`\n${C.b}Integration reseau${C.x}`);
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
