/* charge.js — SPEC-SERVEUR-002 : banc de charge du serveur.

   Lance un vrai serveur (processus enfant) et lui connecte, PAR PALIERS, de 1
   à 100 clients simulés qui parlent le vrai protocole (src/net-protocol.js) —
   aucun rendu, aucun navigateur : juste des sockets et des messages, comme
   tests/integration-net.js mais à l'échelle. Deux scénarios :

     groupé  : tous les clients errent près du point d'apparition (une ville).
     réparti : les clients se répartissent en zones distinctes AVANT la mesure
               (phase de « calage »), pour forcer la génération et la
               simulation de chunks séparés.

   Limite assumée (documentée dans docs/charge.md) : le protocole réel n'a ni
   téléportation ni triche de vitesse — le serveur cadence les entrées sur le
   temps réel écoulé (SY.creerBudget). Les zones du scénario réparti sont donc
   à quelques centaines de blocs les unes des autres (atteintes en couru réel
   pendant le calage), pas à plusieurs kilomètres : assez pour sortir du rayon
   de chunks toujours chargés autour du spawn (3 chunks ≈ 48 blocs) et forcer
   une génération distincte, ce qui est le but réel du scénario.

   Usage :
     node tests/charge.js [--paliers 1,5,10,25,50,100] [--duree 20]
                           [--calage 10] [--scenario groupe|reparti|tous]
                           [--rapport fichier.json] [--port-base 8400]
                           [--graine 20260921]

   Sort en code 1 si un seuil (tic serveur, latence, erreurs) est dépassé. */
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

// ── protocole (même module que le serveur et le client réels) ──────────────
const ctx = vm.createContext(Object.assign(Object.create(null), {
  console, Math, JSON, Date, Error, Number, String, Array, Object, Boolean,
  Map, Set, Uint8Array, isNaN, isFinite, parseInt, parseFloat,
}));
ctx.globalThis = ctx;
vm.runInContext(fs.readFileSync(path.join(RACINE, 'src/net-protocol.js'), 'utf8'), ctx);
const NP = ctx.MC.NetProtocol;

const dodo = (ms) => new Promise(r => setTimeout(r, ms));
const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

// ── arguments ────────────────────────────────────────────────────────────────
function analyserArgv(argv) {
  const o = {
    paliers: [1, 5, 10, 25, 50, 100],
    duree: 20,          // secondes MESURÉES par palier/scénario
    calage: 10,          // secondes de repositionnement (réparti seulement)
    scenario: 'tous',     // groupe | reparti | tous
    rapport: null,
    portBase: 8400,
    graine: 20260921,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--paliers') o.paliers = v().split(',').map(n => parseInt(n, 10)).filter(n => n > 0);
    else if (a === '--duree') o.duree = parseFloat(v());
    else if (a === '--calage') o.calage = parseFloat(v());
    else if (a === '--scenario') o.scenario = v();
    else if (a === '--rapport') o.rapport = v();
    else if (a === '--port-base') o.portBase = parseInt(v(), 10);
    else if (a === '--graine') o.graine = parseInt(v(), 10);
  }
  o.scenarios = o.scenario === 'tous' ? ['groupe', 'reparti'] : [o.scenario];
  return o;
}

// ── seuils (calibrés sur cette machine — voir docs/charge.md) ──────────────
/* Ils se resserrent difficilement en dessous de 25 joueurs (peu de travail
   par tic), et se desserrent au-delà : plus de joueurs veut dire plus
   d'entités et de chunks actifs, donc un tic plus long — c'est attendu, la
   porte sert à repérer une DÉGRADATION anormale, pas à interdire toute
   croissance du coût avec la charge. Réglable par variable d'environnement
   pour recalibrer sans toucher au code. */
function seuils(palier) {
  const p = palier <= 25 ? { tickMoyenMs: 50, tickP95Ms: 90, latenceP95Ms: 500 }
          : palier <= 50 ? { tickMoyenMs: 90, tickP95Ms: 160, latenceP95Ms: 800 }
          : { tickMoyenMs: 180, tickP95Ms: 300, latenceP95Ms: 1200 };
  return {
    tickMoyenMs: +(process.env.MC_SEUIL_TICK_MOYEN || p.tickMoyenMs),
    tickP95Ms: +(process.env.MC_SEUIL_TICK_P95 || p.tickP95Ms),
    latenceP95Ms: +(process.env.MC_SEUIL_LATENCE_P95 || p.latenceP95Ms),
    tauxPerteMax: +(process.env.MC_SEUIL_PERTE || 0.02),      // 2 % de pertes tolérées (jitter)
  };
}

// ── client WebSocket minimal (repris de tests/integration-net.js), enrichi de
//    compteurs réseau et de latence pour le banc ───────────────────────────
function connecter(port, nom) {
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
    const attentes = [];
    const client = {
      nom, socket: sock, bytesRecus: 0, ferme: false, erreurs: 0,
      pos: { x: 0, y: 0, z: 0 },
      envoyer(obj) {
        if (client.ferme) return;
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
        try { sock.write(buf); } catch (e) { client.erreurs++; }
      },
      attendre(type, ms, predicat) {
        return new Promise((res, rej) => {
          const t = setTimeout(() => {
            const i = attentes.indexOf(a);
            if (i >= 0) attentes.splice(i, 1);
            rej(new Error('delai depasse pour ' + type));
          }, ms || 3000);
          const a = { test: (m2) => m2.t === type && (!predicat || predicat(m2)), res: (m2) => { clearTimeout(t); res(m2); } };
          attentes.push(a);
        });
      },
      fermer() { client.ferme = true; try { sock.destroy(); } catch (e) {} },
    };
    sock.on('data', (bloc) => {
      client.bytesRecus += bloc.length;
      tampon = Buffer.concat([tampon, bloc]);
      if (!etabli) {
        const i = tampon.indexOf('\r\n\r\n');
        if (i < 0) return;
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
        if (msg.t === 'etat' && msg.toi && msg.toi[0]) client.pos = msg.toi[0];
        for (let k = attentes.length - 1; k >= 0; k--) {
          if (attentes[k].test(msg)) { attentes[k].res(msg); attentes.splice(k, 1); }
        }
      }
    });
    sock.on('error', () => { client.erreurs++; reject(new Error('connexion refusee')); });
    sock.on('close', () => { client.ferme = true; });
  });
}

function requeteHTTP(port, chemin, entetes) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: chemin, headers: entetes || {} }, (res) => {
      let corps = '';
      res.on('data', (d) => { corps += d; });
      res.on('end', () => resolve({ code: res.statusCode, corps }));
    }).on('error', () => resolve({ code: 0, corps: '' }));
  });
}
async function attendrePret(port) {
  for (let essai = 0; essai < 100; essai++) {
    const r = await requeteHTTP(port, '/index.html');
    if (r.code === 200) return true;
    await dodo(100);
  }
  throw new Error('serveur non pret sur le port ' + port);
}
async function mesuresServeur(port, secret) {
  const r = await requeteHTTP(port, '/admin/api/mesures', { Authorization: 'Bearer ' + secret });
  try { return JSON.parse(r.corps).data; } catch (e) { return { actif: false }; }
}

// ── mouvement simulé ─────────────────────────────────────────────────────────
const TOUCHES = ['forward', 'back', 'left', 'right', 'jump', 'sprint'];
const K_FORWARD = 1 << TOUCHES.indexOf('forward');
const K_SPRINT = 1 << TOUCHES.indexOf('sprint');
const NB_ZONES = 8;
const VITESSE_ANGULAIRE = 0.3;    // rad/s : une lente ronde autour du point tenu

/* Un client « vit » : il avance en rond (marche normale) autour d'un point —
   le spawn commun pour « groupé », un point atteint pendant le calage pour
   « réparti » — tout en minant/posant un bloc, attaquant et discutant à
   intervalles réguliers. Chaque action réseau reprend le vrai protocole. */
function demarrerVie(client, { yawBase, sprint, surLatence, surPerte }) {
  let s = 0;
  const debut = Date.now();
  const minuteurs = [];
  minuteurs.push(setInterval(() => {
    s++;
    const t = (Date.now() - debut) / 1000;
    const yaw = yawBase + (sprint ? 0 : t * VITESSE_ANGULAIRE);
    client.envoyer({ t: 'e', s, j: 0, dt: 0.05, k: K_FORWARD | (sprint ? K_SPRINT : 0), yaw, pitch: 0 });
  }, 50));

  if (!sprint) {
    let phase = 0;
    minuteurs.push(setInterval(() => {
      const p = client.pos || { x: 0, y: 64, z: 0 };
      const decal = phase % 2 === 0 ? -1 : 2;              // sous les pieds, puis au-dessus
      const bx = Math.floor(p.x), by = Math.floor(p.y) + decal, bz = Math.floor(p.z);
      const id = phase % 2 === 0 ? 0 : 3;                   // mine (air), puis pose (terre)
      phase++;
      const t0 = Date.now();
      client.envoyer({ t: 'bloc', x: bx, y: by, z: bz, id, j: 0 });
      client.attendre('bloc', 2500, m => m.x === bx && m.y === by && m.z === bz)
        .then(() => surLatence(Date.now() - t0))
        .catch(() => surPerte());
    }, 2000));

    minuteurs.push(setInterval(() => {
      client.envoyer({ t: 'attaque', eid: Math.floor(Math.random() * 1e6), j: 0, degats: 2 });
    }, 3000));

    minuteurs.push(setInterval(() => {
      client.envoyer({ t: 'chat', texte: 'ping ' + client.nom + ' ' + Math.floor(Math.random() * 1000) });
    }, 5000 + Math.random() * 3000));
  }

  return () => minuteurs.forEach(clearInterval);
}

// ── un palier, un scénario ───────────────────────────────────────────────────
let compteurPort = 0;
async function executerPalier(scenario, palier, opts) {
  const port = opts.portBase + (compteurPort++);
  const secret = 'charge-' + crypto.randomBytes(6).toString('hex');
  const env = Object.assign({}, process.env, { MC_MESURES: '1' });
  const serveur = spawn(process.execPath, [
    path.join(RACINE, 'server.js'),
    '--port', String(port), '--serveur', '--graine', String(opts.graine),
    '--admin', secret, '--max-joueurs', String(Math.max(palier, 8)),
  ], { cwd: RACINE, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  serveur.stdout.on('data', d => logs.push(String(d)));
  serveur.stderr.on('data', d => logs.push('ERR ' + String(d)));

  const resultat = { scenario, palier, erreursConnexion: 0, pertes: 0, latences: [],
                      octetsParClient: [], echec: null };
  try {
    await attendrePret(port);

    const clients = await Promise.all(Array.from({ length: palier }, async (_, i) => {
      try {
        const cli = await connecter(port, 'Bot' + i);
        cli.envoyer({ t: 'rejoindre', formatIds: 4096, nom: 'Bot' + i, locaux: 1 });
        await cli.attendre('bienvenue', 8000);
        return cli;
      } catch (e) { resultat.erreursConnexion++; return null; }
    }));
    const vivants = clients.filter(Boolean);

    // ── phase de calage (réparti) : chaque client court vers sa zone ──────
    const arrets = [];
    if (scenario === 'reparti' && opts.calage > 0) {
      vivants.forEach((cli, i) => {
        const yawBase = (i % NB_ZONES) * (2 * Math.PI / NB_ZONES);
        arrets.push(demarrerVie(cli, { yawBase, sprint: true, surLatence: () => {}, surPerte: () => {} }));
      });
      await dodo(opts.calage * 1000);
      arrets.forEach(a => a());
      arrets.length = 0;
    }

    // ── phase mesurée ──────────────────────────────────────────────────────
    vivants.forEach((cli, i) => {
      const yawBase = scenario === 'reparti' ? (i % NB_ZONES) * (2 * Math.PI / NB_ZONES) : 0;
      arrets.push(demarrerVie(cli, { yawBase, sprint: false,
        surLatence: (ms) => resultat.latences.push(ms), surPerte: () => resultat.pertes++ }));
    });
    const avantBytes = vivants.map(c => c.bytesRecus);
    await dodo(opts.duree * 1000);
    arrets.forEach(a => a());
    resultat.octetsParClient = vivants.map((c, i) => (c.bytesRecus - avantBytes[i]) / opts.duree);
    resultat.joueursConnectes = vivants.length;

    resultat.serveur = await mesuresServeur(port, secret);

    vivants.forEach(c => c.fermer());
  } catch (e) {
    resultat.echec = e.message;
  } finally {
    serveur.kill();
    await dodo(250);
  }
  return resultat;
}

// ── statistiques ─────────────────────────────────────────────────────────────
function moyenne(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function p95(a) {
  if (!a.length) return 0;
  const tri = a.slice().sort((x, y) => x - y);
  return tri[Math.min(tri.length - 1, Math.floor(tri.length * 0.95))];
}

// ── programme principal ─────────────────────────────────────────────────────
(async function () {
  const opts = analyserArgv(process.argv.slice(2));
  const resultats = [];
  let echecSeuil = false;

  console.log(`${C.b}Banc de charge — SPEC-SERVEUR-002${C.x}`);
  console.log(`${C.d}paliers ${opts.paliers.join(',')} · scénarios ${opts.scenarios.join(',')} · durée ${opts.duree}s · calage ${opts.calage}s${C.x}\n`);

  for (const scenario of opts.scenarios) {
    for (const palier of opts.paliers) {
      process.stdout.write(`${C.d}→ ${scenario} / ${palier} joueur(s)…${C.x}`);
      const r = await executerPalier(scenario, palier, opts);
      resultats.push(r);

      const s = seuils(palier);
      const latP95 = p95(r.latences);
      const tickMoyen = r.serveur && r.serveur.tickMoyenMs || 0;
      const tickP95 = r.serveur && r.serveur.tickP95Ms || 0;
      const octetsMoy = moyenne(r.octetsParClient);
      const nRoundTrips = r.latences.length + r.pertes;
      const tauxPerte = nRoundTrips ? r.pertes / nRoundTrips : 0;

      const depasse = [];
      if (r.echec) depasse.push('échec : ' + r.echec);
      if (r.erreursConnexion) depasse.push(r.erreursConnexion + ' connexion(s) refusée(s)');
      if (tickMoyen > s.tickMoyenMs) depasse.push(`tic moyen ${tickMoyen}ms > ${s.tickMoyenMs}ms`);
      if (tickP95 > s.tickP95Ms) depasse.push(`tic p95 ${tickP95}ms > ${s.tickP95Ms}ms`);
      if (latP95 > s.latenceP95Ms) depasse.push(`latence p95 ${latP95}ms > ${s.latenceP95Ms}ms`);
      if (tauxPerte > s.tauxPerteMax) depasse.push(`taux de perte ${(tauxPerte * 100).toFixed(1)}% > ${(s.tauxPerteMax * 100).toFixed(1)}%`);

      r.seuils = s; r.depasse = depasse; r.latenceP95 = latP95; r.octetsParClientMoy = octetsMoy; r.tauxPerte = tauxPerte;
      if (depasse.length) echecSeuil = true;

      const marque = depasse.length ? `${C.r}✗${C.x}` : `${C.g}✓${C.x}`;
      console.log(`\r${marque} ${scenario.padEnd(8)} ${String(palier).padStart(3)} joueurs · ` +
        `tic ${tickMoyen}/${tickP95}ms (moy/p95) · latence p95 ${latP95}ms · ` +
        `${(octetsMoy / 1024).toFixed(1)} Ko/s/client · pertes ${(tauxPerte * 100).toFixed(1)}%` +
        (depasse.length ? `  ${C.r}[${depasse.join(' ; ')}]${C.x}` : ''));
    }
  }

  if (opts.rapport) {
    fs.writeFileSync(path.resolve(opts.rapport), JSON.stringify(resultats, null, 2));
    console.log(`\n${C.d}rapport JSON écrit : ${opts.rapport}${C.x}`);
  }

  console.log('');
  if (echecSeuil) {
    console.log(`${C.r}un ou plusieurs seuils dépassés${C.x}\n`);
    process.exit(1);
  }
  console.log(`${C.g}tous les paliers respectent leurs seuils${C.x}\n`);
  process.exit(0);
})();
