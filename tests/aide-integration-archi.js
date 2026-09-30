/* aide-integration-archi.js — outillage commun des suites d'intégration du
   chantier ARCHI (serveur local fermé au réseau, pause, sauvegarde, parties).
   Ce fichier n'est PAS un test : il fournit un client WebSocket minimal, le
   lancement/arrêt d'un vrai `server.js` (jamais require()d) et de petits
   assertions. Chaque suite lance ET arrête ses serveurs. */
'use strict';
const net = require('net');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { spawn } = require('child_process');

const RACINE = path.join(__dirname, '..');
const ctx = vm.createContext(Object.assign(Object.create(null), {
  console, Math, JSON, Date, Error, Number, String, Array, Object, Boolean,
  Map, Set, Uint8Array, isNaN, isFinite, parseInt, parseFloat,
}));
ctx.globalThis = ctx;
['contrats-vague2', 'contrats-archi', 'net-protocol'].forEach(m => {
  vm.runInContext(fs.readFileSync(path.join(RACINE, 'src', m + '.js'), 'utf8'), ctx);
});
const NP = ctx.MC.NetProtocol;
const CA = ctx.MC.ContratsArchi;

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const dodo = (ms) => new Promise(r => setTimeout(r, ms));

function creerRapport(titre) {
  const r = { passes: 0, echecs: 0, details: [], sauts: 0 };
  r.ok = (cond, nom, info) => {
    if (cond) { r.passes++; r.details.push(`  ${C.g}·${C.x} ${C.d}${nom}${C.x}`); }
    else { r.echecs++; r.details.push(`  ${C.r}✗ ${nom}${C.x}${info ? '\n    ' + C.r + info + C.x : ''}`); }
  };
  r.eq = (a, b, nom) => r.ok(a === b, nom, `attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`);
  r.saut = (nom, motif) => { r.sauts++; r.details.push(`  ${C.y}○ ${nom} — ignoré : ${motif}${C.x}`); };
  r.fin = () => {
    console.log(`\n${C.b}${titre}${C.x}`);
    r.details.forEach(l => console.log(l));
    console.log(`\n${r.echecs ? C.r + r.echecs + ' échec(s)' : C.g + 'tout passe'}${C.x} — ${r.passes} vérification(s)` + (r.sauts ? `, ${r.sauts} ignorée(s)` : ''));
    return r.echecs === 0 ? 0 : 1;
  };
  return r;
}

/* Adresse IPv4 non locale de la machine (celle qu'un voisin du réseau
   utiliserait), ou null s'il n'y en a aucune. */
function adresseReseau() {
  const ifs = os.networkInterfaces();
  for (const nom of Object.keys(ifs)) {
    for (const a of ifs[nom] || []) if (!a.internal && a.family === 'IPv4') return a.address;
  }
  return null;
}
function adressesNonLocales() {
  const out = [];
  const ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(nom => (ifs[nom] || []).forEach(a => {
    if (a.internal) return;
    if (a.family === 'IPv6' && /^fe80/i.test(a.address)) return;      // lien local : zone requise
    out.push(a.address);
  }));
  return out;
}

// ── client WebSocket minimal ────────────────────────────────────────────────
/* opts : { hote (défaut 127.0.0.1), origine, hoteHttp (en-tête Host) }.
   Résout avec le client, ou rejette avec Error('http <code>') si la poignée de
   main est refusée (403…), ou avec l'erreur de socket (ECONNREFUSED…). */
function connecter(port, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const cle = crypto.randomBytes(16).toString('base64');
    const hote = opts.hote || '127.0.0.1';
    const sock = net.connect(port, hote, () => {
      sock.setNoDelay(true);               // comme un navigateur : sans Nagle, une petite trame part aussitôt (sinon +1 tic de latence mesuré)
      sock.write(
        'GET / HTTP/1.1\r\n' +
        `Host: ${opts.hoteHttp || (hote.indexOf(':') >= 0 ? '[' + hote + ']' : hote) + ':' + port}\r\n` +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        (opts.origine ? `Origin: ${opts.origine}\r\n` : '') +
        `Sec-WebSocket-Key: ${cle}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    let tampon = Buffer.alloc(0);
    let etabli = false, fini = false;
    const messages = [];
    const attentes = [];
    const client = {
      socket: sock, messages, pongs: 0, fermee: false,
      envoyer(obj) { client.trame(0x1, Buffer.from(JSON.stringify(obj), 'utf8')); },
      trame(opcode, charge) {
        const m = crypto.randomBytes(4);
        const n = charge.length;
        const entete = n < 126 ? 2 : 4;
        const buf = Buffer.alloc(entete + 4 + n);
        buf[0] = 0x80 | opcode;
        if (n < 126) buf[1] = 0x80 | n;
        else { buf[1] = 0x80 | 126; buf.writeUInt16BE(n, 2); }
        m.copy(buf, entete);
        for (let i = 0; i < n; i++) buf[entete + 4 + i] = charge[i] ^ m[i % 4];
        sock.write(buf);
      },
      ping() { client.trame(0x9, Buffer.from('x')); },
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
      // messages d'un type reçus APRÈS l'instant de l'appel
      depuis() { const n = messages.length; return (type) => messages.slice(n).filter(m => m.t === type); },
      dernier(type) { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].t === type) return messages[i]; return null; },
      fermer() { try { sock.destroy(); } catch (e) {} },
    };
    sock.on('data', (bloc) => {
      tampon = Buffer.concat([tampon, bloc]);
      if (!etabli) {
        const i = tampon.indexOf('\r\n\r\n');
        if (i < 0) return;
        const entetes = tampon.slice(0, i).toString();
        const code = parseInt((entetes.split(' ')[1] || '0'), 10);
        const attendu = crypto.createHash('sha1').update(cle + NP.GUID).digest('base64');
        if (code !== 101 || !entetes.includes(attendu)) {
          fini = true; sock.destroy(); reject(new Error('http ' + code)); return;
        }
        etabli = true; fini = true;
        tampon = tampon.slice(i + 4);
        resolve(client);
      }
      for (;;) {
        const d = NP.decoder(tampon);
        if (!d) break;
        tampon = tampon.slice(d.consomme);
        if (d.opcode === NP.OP.PONG) { client.pongs++; if (client.surPong) client.surPong(); continue; }
        if (d.opcode !== NP.OP.TEXTE) continue;
        let msg;
        try { msg = JSON.parse(NP.utf8Decoder(d.charge)); } catch (e) { continue; }
        messages.push(msg);
        if (client.surMessage) client.surMessage(msg);
        for (let k = attentes.length - 1; k >= 0; k--) {
          if (attentes[k].test(msg)) { attentes[k].res(msg); attentes.splice(k, 1); }
        }
      }
    });
    sock.on('close', () => { client.fermee = true; if (!fini) { fini = true; reject(new Error('socket fermee')); } });
    sock.on('error', (e) => { client.fermee = true; if (!fini) { fini = true; reject(e); } });
  });
}

function requete(port, chemin, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const corps = opts.corps === undefined ? null : (typeof opts.corps === 'string' ? opts.corps : JSON.stringify(opts.corps));
    const req = http.request({
      host: opts.hote || '127.0.0.1', port, path: chemin, method: opts.methode || (corps === null ? 'GET' : 'POST'),
      headers: Object.assign({}, opts.entetes || {}, corps === null ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corps) }),
    }, (res) => {
      let txt = '';
      res.on('data', (d) => { txt += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(txt); } catch (e) { /* pas du JSON */ }
        resolve({ code: res.statusCode, corps: txt, json, type: res.headers['content-type'] });
      });
    });
    req.on('error', (e) => resolve({ code: 0, corps: '', erreur: e.code || e.message }));
    if (corps !== null) req.write(corps);
    req.end();
  });
}

/* Tente d'ouvrir une connexion TCP : résout 'ok' ou le code d'erreur. */
function sonde(port, hote) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: hote });
    const t = setTimeout(() => { s.destroy(); resolve('delai'); }, 2500);
    s.on('connect', () => { clearTimeout(t); s.destroy(); resolve('ok'); });
    s.on('error', (e) => { clearTimeout(t); resolve(e.code || e.message); });
  });
}

// ── lancement d'un vrai serveur ─────────────────────────────────────────────
/* args : arguments de server.js ; env : variables d'environnement en plus.
   Résout avec { proc, logs, port, sortie(), arreter() } une fois `MC_PORT=`
   lu ET l'index servi ; rejette si le processus se termine avant. */
function lancer(args, env) {
  const proc = spawn(process.execPath, [path.join(RACINE, 'server.js')].concat(args || []),
    { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, env || {}) });
  const logs = [];
  const srv = { proc, logs, port: null, code: undefined, vivant: true, t0: Date.now(), heureLog: [] };
  proc.stdout.on('data', d => { String(d).split('\n').forEach(l => { if (l) { logs.push(l); srv.heureLog.push([Date.now(), l]); } }); });
  proc.stderr.on('data', d => logs.push('ERR ' + String(d)));
  srv.sortie = new Promise((res) => proc.on('exit', (code) => { srv.vivant = false; srv.code = code; res(code); }));
  srv.arreter = async () => {
    if (!srv.vivant) return srv.code;
    try {
      const c = await connecter(srv.port, {});
      c.envoyer({ t: 'arret' });
      await Promise.race([srv.sortie, dodo(2500)]);
      c.fermer();
    } catch (e) { /* injoignable */ }
    if (srv.vivant) { try { proc.kill(); } catch (e) {} await Promise.race([srv.sortie, dodo(2000)]); }
    return srv.code;
  };
  return new Promise((resolve, reject) => {
    const debut = Date.now();
    const boucle = async () => {
      for (;;) {
        if (!srv.vivant) { reject(new Error('serveur arrêté (code ' + srv.code + ') : ' + logs.join(' | ').slice(0, 300))); return; }
        const l = logs.find(x => /^MC_PORT=\d+$/.test(x));
        if (l) { srv.port = parseInt(l.slice(8), 10); break; }
        if (Date.now() - debut > 20000) { try { proc.kill(); } catch (e) {} reject(new Error('démarrage trop long : ' + logs.join(' | ').slice(0, 300))); return; }
        await dodo(25);
      }
      for (let k = 0; k < 200; k++) {
        const r = await requete(srv.port, '/index.html');
        if (r.code === 200) { srv.demarreMs = Date.now() - srv.t0; resolve(srv); return; }
        await dodo(25);
      }
      reject(new Error('index.html non servi'));
    };
    boucle();
  });
}

/* Rejoint comme joueur : renvoie { client, bienvenue }. */
async function rejoindre(port, nom, locaux, opts) {
  const client = await connecter(port, opts);
  client.envoyer({ t: 'rejoindre', nom, locaux: locaux || 1 });
  const bienvenue = await client.attendre('bienvenue', 8000);
  return { client, bienvenue };
}

/* Attend que le serveur ait constaté le départ de ses clients (la détection
   d'une socket fermée peut tarder sous charge) : monde.clients === n. */
async function attendreClients(port, n, ms) {
  const fin = Date.now() + (ms || 6000);
  while (Date.now() < fin) {
    const r = await requete(port, '/api/parties');
    if (r.json && r.json.monde && r.json.monde.clients === n) return true;
    await dodo(50);
  }
  return false;
}

/* Charge dans un contexte vm les MÊMES modules de logique que server.js (liste
   lue dans server.js pour ne jamais diverger) : sert à fabriquer de vraies
   sauvegardes solo (MC.Save.serialize) pour les tests d'import. */
function chargerModules() {
  const src = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
  const bloc = /const MODULES = \[([\s\S]*?)\];/.exec(src)[1];
  const noms = [];
  bloc.replace(/'([^']+)'/g, (_, n) => { noms.push(n); return ''; });
  const c = vm.createContext(Object.assign(Object.create(null), {
    console, Math, JSON, Date, Error, Number, String, Array, Object, Boolean,
    Map, Set, Uint8Array, Float32Array, isNaN, isFinite, parseInt, parseFloat,
  }));
  c.globalThis = c;
  noms.forEach(m => vm.runInContext(fs.readFileSync(path.join(RACINE, 'src', m + '.js'), 'utf8'), c, { filename: m + '.js' }));
  return c.MC;
}

function dossierTemp(prefixe) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixe));
}
function supprimerDossier(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* tant pis */ } }

module.exports = { RACINE, NP, CA, C, dodo, creerRapport, adresseReseau, adressesNonLocales, connecter, requete, sonde, lancer, rejoindre, attendreClients, chargerModules, dossierTemp, supprimerDossier };
