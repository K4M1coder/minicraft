/* integration-admin.js — tests d'intégration RÉELS de l'administration et de
   la persistance du serveur : vrai processus `server.js`, vraies sockets,
   vraies requêtes HTTP. Complète tests/integration-net.js.

   Usage : node tests/integration-admin.js [port] */
'use strict';
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const { spawn } = require('child_process');

const RACINE = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8299;

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

// ── client WebSocket minimal (repris d'integration-net.js) ──────────────────
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
        if (!entetes.includes('101')) { reject(new Error('poignee de main refusee')); return; }
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

function requeteJSON(port, methode, chemin, jeton, corps) {
  return new Promise((resolve) => {
    const data = corps ? Buffer.from(JSON.stringify(corps)) : null;
    const req = http.request({
      host: '127.0.0.1', port, path: chemin, method: methode,
      headers: Object.assign(
        jeton ? { Authorization: 'Bearer ' + jeton } : {},
        data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
    }, (res) => {
      let brut = '';
      res.on('data', d => { brut += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(brut); } catch (e) {}
        resolve({ code: res.statusCode, json });
      });
    });
    req.on('error', () => resolve({ code: 0, json: null }));
    if (data) req.write(data);
    req.end();
  });
}

const dodo = (ms) => new Promise(r => setTimeout(r, ms));

function demarrer(args, env) {
  return spawn(process.execPath, [path.join(RACINE, 'server.js'), ...args],
    { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, env || {}) });
}
async function attendrePret(port) {
  for (let essai = 0; essai < 60; essai++) {
    await dodo(100);
    const r = await requeteJSON(port, 'GET', '/index.html', null, null);
    if (r.code === 200) return true;
  }
  return false;
}

(async function () {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-admin-'));
  const fichierMonde = path.join(tmp, 'monde.json');
  const PORT1 = PORT, PORT2 = PORT + 1;

  const s1 = demarrer(
    ['--port', String(PORT1), '--admin', 'secretA', '--liste-blanche', '--monde', fichierMonde],
    { MC_SAUVEGARDE_MS: '300' });
  const logs1 = [];
  s1.stdout.on('data', d => logs1.push(String(d)));
  s1.stderr.on('data', d => logs1.push('ERR ' + String(d)));

  try {
    ok(await attendrePret(PORT1), 'SPEC-SERVEUR-001 : le serveur démarre avec --port/--admin/--monde');

    // ── SPEC-ADMIN-001 : console protégée ────────────────────────────────────
    const sansAuth = await requeteJSON(PORT1, 'GET', '/admin/api/joueurs', null, null);
    eq(sansAuth.code, 401, 'SPEC-ADMIN-001 : sans jeton, la console refuse');
    const mauvaisAuth = await requeteJSON(PORT1, 'GET', '/admin/api/joueurs', 'faux-jeton', null);
    eq(mauvaisAuth.code, 401, 'SPEC-ADMIN-001 : un mauvais jeton est refusé');
    const bonAuth = await requeteJSON(PORT1, 'GET', '/admin/api/joueurs', 'secretA', null);
    eq(bonAuth.code, 200, 'SPEC-ADMIN-001 : le bon jeton donne accès à la console');
    ok(Array.isArray(bonAuth.json.data), 'SPEC-ADMIN-001 : la liste des joueurs connectés est renvoyée');

    // ── SPEC-ADMIN-004 : liste blanche activée refuse un joueur non inscrit ──
    const bloque = await connecter(PORT1);
    bloque.envoyer({ t: 'rejoindre', nom: 'Etranger', locaux: 1 });
    const refus = await bloque.attendre('refus');
    eq(refus.motif, 'liste_blanche', 'SPEC-ADMIN-004 : refusé faute d\'inscription');
    bloque.fermer();

    // ── SPEC-ADMIN-005 : un lien d'invitation fait entrer malgré la liste blanche
    const invCreation = await requeteJSON(PORT1, 'POST', '/admin/api/invitation_creer', 'secretA',
      { usagesMax: 1, expireDansMs: 60000 });
    eq(invCreation.code, 200, 'SPEC-ADMIN-005 : un administrateur crée une invitation');
    const jeton = invCreation.json.data.token;
    ok(!!jeton, 'SPEC-ADMIN-005 : un jeton d\'invitation est renvoyé');

    const alice = await connecter(PORT1);
    alice.envoyer({ t: 'rejoindre', nom: 'Alice', locaux: 1, invitation: jeton });
    const bienvenue = await alice.attendre('bienvenue');
    ok(typeof bienvenue.id === 'number', 'SPEC-ADMIN-005 : l\'invitation fait entrer malgré la liste blanche');

    // une seconde invitée avec le même jeton (déjà épuisé, usagesMax=1) est refusée
    const bob = await connecter(PORT1);
    bob.envoyer({ t: 'rejoindre', nom: 'Bob', locaux: 1, invitation: jeton });
    const refusBob = await bob.attendre('refus');
    ok(refusBob.motif.indexOf('invitation') >= 0, 'SPEC-ADMIN-005 : un jeton épuisé est refusé à un second usage');
    bob.fermer();

    // ── SPEC-ADMIN-002 : le journal enregistre la pose d'un bloc ────────────
    const moi = bienvenue.toi[0];
    const bx = Math.floor(moi.x), by = Math.floor(moi.y) + 3, bz = Math.floor(moi.z);
    alice.envoyer({ t: 'bloc', x: bx, y: by, z: bz, id: 9 });
    await alice.attendre('bloc');
    await dodo(150);
    const journalR = await requeteJSON(PORT1, 'GET', '/admin/api/journal', 'secretA', null);
    ok(journalR.json.data.some(e => e.action === 'bloc_pose' && e.auteur === 'Alice'),
       'SPEC-ADMIN-002 : la pose de bloc est journalisée avec son auteur');

    // ── SPEC-ADMIN-006 : panneau admin en jeu, refus aux non-admins ─────────
    const panneau = await connecter(PORT1);
    panneau.envoyer({ t: 'admin', action: 'sessions' });
    const refusPanneau = await panneau.attendre('admin_rep', 3000, m => m.action === 'sessions');
    eq(refusPanneau.ok, false, 'SPEC-ADMIN-006 : sans authentification, l\'action est refusée');
    eq(refusPanneau.erreur, 'non_authentifie', 'SPEC-ADMIN-006 : motif du refus');

    panneau.envoyer({ t: 'admin', action: 'auth', args: { secret: 'mauvais' } });
    const authRatee = await panneau.attendre('admin_rep', 3000, m => m.action === 'auth');
    eq(authRatee.ok, false, 'SPEC-ADMIN-001 : un mauvais secret n\'authentifie pas');

    panneau.envoyer({ t: 'admin', action: 'auth', args: { secret: 'secretA' } });
    const authOk = await panneau.attendre('admin_rep', 3000, m => m.action === 'auth' && m.ok);
    eq(authOk.data.role, 'admin', 'SPEC-ADMIN-006 : le panneau authentifie en administrateur');

    panneau.envoyer({ t: 'admin', action: 'joueurs' });
    const joueursR = await panneau.attendre('admin_rep', 3000, m => m.action === 'joueurs');
    ok(joueursR.ok && joueursR.data.some(j => j.nom === 'Alice'),
       'SPEC-ADMIN-006 : le panneau admin liste bien les joueurs connectés');

    // ── SPEC-ADMIN-008 : nomme un modérateur, il a des droits restreints ────
    panneau.envoyer({ t: 'admin', action: 'role_nommer', args: { nom: 'Modo', role: 'moderateur' } });
    const roleR = await panneau.attendre('admin_rep', 3000, m => m.action === 'role_nommer');
    ok(roleR.ok && roleR.data.ok && !!roleR.data.jeton, 'SPEC-ADMIN-008 : un modérateur est nommé, avec son propre jeton');

    const modo = await connecter(PORT1);
    modo.envoyer({ t: 'admin', action: 'auth', args: { secret: roleR.data.jeton } });
    const modoAuth = await modo.attendre('admin_rep', 3000, m => m.action === 'auth');
    eq(modoAuth.data.role, 'moderateur', 'SPEC-ADMIN-008 : le jeton du modérateur l\'authentifie comme tel');

    modo.envoyer({ t: 'admin', action: 'invitation_creer', args: {} });
    const modoInv = await modo.attendre('admin_rep', 3000, m => m.action === 'invitation_creer');
    eq(modoInv.ok, false, 'SPEC-ADMIN-008 : un modérateur ne crée pas d\'invitation');

    modo.envoyer({ t: 'admin', action: 'joueurs' });
    const modoJoueurs = await modo.attendre('admin_rep', 3000, m => m.action === 'joueurs');
    ok(modoJoueurs.ok && modoJoueurs.data[0].ip === undefined,
       'SPEC-ADMIN-007 : un modérateur ne voit pas les IP des joueurs');

    alice.fermer(); panneau.fermer(); modo.fermer();
  } catch (e) {
    echecs++;
    details.push(`  ${C.r}✗ exception : ${e.message}${C.x}\n${logs1.join('')}`);
  } finally {
    // la sauvegarde périodique doit avoir pris le bloc avant l'arrêt : sous Windows, tuer le
    // processus ne déclenche pas la sauvegarde de sortie, et un serveur occupé à générer du
    // terrain peut prendre du retard sur son intervalle — on l'attend (8 s au plus)
    for (let essai = 0; essai < 80; essai++) {
      try { if ((JSON.parse(fs.readFileSync(fichierMonde, 'utf8')).overrides || []).length) break; } catch (e) { /* en cours d'écriture */ }
      await dodo(100);
    }
    try { s1.kill(); } catch (e) {}
  }

  // ── SPEC-SERVEUR-001 : sauvegarde périodique et reprise au redémarrage ───
  await dodo(300);   // laisser au moins une sauvegarde périodique (MC_SAUVEGARDE_MS=300) s'exécuter
  let repriseOk = false, blocRepris = false;
  try {
    ok(fs.existsSync(fichierMonde), 'SPEC-SERVEUR-001 : la sauvegarde périodique a écrit le fichier de monde');
    const s2 = demarrer(['--port', String(PORT2), '--admin', 'secretA', '--monde', fichierMonde]);
    const logs2 = [];
    s2.stdout.on('data', d => logs2.push(String(d)));
    try {
      repriseOk = await attendrePret(PORT2);
      ok(repriseOk, 'SPEC-SERVEUR-001 : le serveur redémarre en reprenant le même fichier de monde');
      if (repriseOk) {
        const alice2 = await connecter(PORT2);
        alice2.envoyer({ t: 'rejoindre', nom: 'Alice2', locaux: 1 });
        const bienvenue2 = await alice2.attendre('bienvenue');
        blocRepris = (bienvenue2.blocs || []).length > 0;
        ok(blocRepris, 'SPEC-SERVEUR-001 : le bloc posé avant l\'arrêt est repris au démarrage suivant',
           JSON.stringify(bienvenue2.blocs).slice(0, 200));
        alice2.fermer();
      }
    } finally { try { s2.kill(); } catch (e) {} }
  } catch (e) {
    echecs++;
    details.push(`  ${C.r}✗ exception (reprise) : ${e.message}${C.x}`);
  }

  // ── SPEC-SERVEUR-005 : purge périodique de admin.sessions sur un vrai serveur ──
  /* MC.Admin.purger() est déjà testé PUR (isolé) dans tests/spec-admin.js —
     ici, on prouve seulement que server.js l'appelle RÉELLEMENT depuis sa
     boucle périodique (MC_ADMIN_PURGE_S/MC_ADMIN_PURGE_SESSIONS_MAX,
     réglages de test au même titre que MC_SAUVEGARDE_MS) : des sessions
     fermées en nombre au-delà du seuil disparaissent, une session encore
     ouverte survit toujours. */
  const PORT3 = PORT + 2;
  const s3 = demarrer(['--port', String(PORT3), '--admin', 'secretB'], {
    MC_ADMIN_PURGE_S: '1', MC_ADMIN_PURGE_SESSIONS_MAX: '2', MC_ADMIN_PURGE_SESSIONS_AGE_S: '999999',
  });
  try {
    ok(await attendrePret(PORT3), 'SPEC-SERVEUR-005 : le serveur de purge démarre');

    // une session qui reste ouverte tout du long
    const ouverte = await connecter(PORT3);
    ouverte.envoyer({ t: 'rejoindre', nom: 'RestéConnecté', locaux: 1 });
    await ouverte.attendre('bienvenue');

    // plusieurs sessions FERMÉES, largement au-delà du seuil (sessionsMax=2)
    for (let i = 0; i < 5; i++) {
      const cli = await connecter(PORT3);
      cli.envoyer({ t: 'rejoindre', nom: 'Passager' + i, locaux: 1 });
      await cli.attendre('bienvenue');
      cli.fermer();
      await dodo(30);
    }

    const avantPurge = await requeteJSON(PORT3, 'GET', '/admin/api/sessions', 'secretB', null);
    eq(avantPurge.code, 200, 'SPEC-SERVEUR-005 : la console lit les sessions avant purge');
    ok(avantPurge.json.data.length >= 6, 'SPEC-SERVEUR-005 : 6 sessions au moins avant la première purge (5 fermées + 1 ouverte)');

    // laisse au moins un passage de la boucle de purge (MC_ADMIN_PURGE_S=1) s'exécuter
    await dodo(1400);

    const apresPurge = await requeteJSON(PORT3, 'GET', '/admin/api/sessions', 'secretB', null);
    eq(apresPurge.code, 200, 'SPEC-SERVEUR-005 : la console lit les sessions après purge');
    ok(apresPurge.json.data.length < avantPurge.json.data.length,
       'SPEC-SERVEUR-005 : la purge périodique réelle a réduit le nombre de sessions',
       `avant=${avantPurge.json.data.length} après=${apresPurge.json.data.length}`);
    const survivante = apresPurge.json.data.find(s => s.nom === 'RestéConnecté');
    ok(survivante && survivante.deconnecteLe === null,
       'SPEC-SERVEUR-005 : la session toujours ouverte survit à la purge, même au-delà du seuil de taille');

    ouverte.fermer();
  } catch (e) {
    echecs++;
    details.push(`  ${C.r}✗ exception (purge SPEC-SERVEUR-005) : ${e.message}${C.x}`);
  } finally {
    try { s3.kill(); } catch (e) {}
  }

  // ── SPEC-SERVEUR-009 : BIENVENUE reste borné face à un grand nombre de
  // modifications éparses dans le monde ────────────────────────────────────
  /* Un monde préfabriqué (fichier --monde) avec des milliers d'overrides
     dispersés sur des chunks TRÈS éloignés les uns des autres — impossible à
     obtenir par de vraies poses de blocs (limitées par la portée d'un
     joueur, voir SPEC-NET-027) mais représentatif d'une partie qui dure :
     BIENVENUE ne doit PAS grossir avec le nombre total d'overrides du
     monde, seulement avec le voisinage borné de la connexion — le reste se
     demande chunk par chunk (voir tests/integration-net.js pour ce round-trip). */
  const fichierMondeGros = path.join(tmp, 'monde-gros.json');
  const overridesEparses = [];
  const NB_OVERRIDES = 4000;
  for (let i = 0; i < NB_OVERRIDES; i++) {
    // dispersés tous les 400 blocs : largement hors du rayon borné autour
    // de n'importe quel point de connexion proche de (0, 0)
    overridesEparses.push([(i % 200) * 400, 5, Math.floor(i / 200) * 400, 9]);
  }
  fs.writeFileSync(fichierMondeGros, JSON.stringify({
    v: 2, graine: 20260921, heure: 60, overrides: overridesEparses, etats: [], crops: [],
  }));
  const PORT4 = PORT + 3;
  const s4 = demarrer(['--port', String(PORT4), '--admin', 'secretC', '--monde', fichierMondeGros]);
  try {
    ok(await attendrePret(PORT4), 'SPEC-SERVEUR-009 : le serveur démarre avec un monde à 4000 overrides épars');
    const eve = await connecter(PORT4);
    eve.envoyer({ t: 'rejoindre', nom: 'Eve', locaux: 1 });
    const bienvenueEve = await eve.attendre('bienvenue');
    const tailleBienvenue = JSON.stringify(bienvenueEve).length;
    ok(tailleBienvenue < 50000,
       `SPEC-SERVEUR-009 : BIENVENUE reste sous un seuil de taille (${tailleBienvenue} octets) malgré ${NB_OVERRIDES} overrides dans le monde`,
       `blocs transmis : ${bienvenueEve.blocs.length}`);
    ok(bienvenueEve.blocs.length < NB_OVERRIDES,
       'SPEC-SERVEUR-009 : BIENVENUE ne transmet pas TOUS les overrides du monde',
       `${bienvenueEve.blocs.length} / ${NB_OVERRIDES}`);

    // un override lointain (le dernier de la liste, x=79600 z=7600), jamais
    // demandé, n'apparaît pas dans BIENVENUE…
    ok(!bienvenueEve.blocs.some(x => x[0] === 79600 && x[2] === 7600),
       'SPEC-SERVEUR-009 : un override très éloigné n est pas inclus dans BIENVENUE');
    // …mais arrive bien sur demande explicite de SON chunk
    const cxLoin = Math.floor(79600 / 16), czLoin = Math.floor(7600 / 16);
    eve.envoyer({ t: 'overrides_demande', cx: cxLoin, cz: czLoin });
    const overridesLoin = await eve.attendre('overrides_chunk', 3000, m => m.cx === cxLoin && m.cz === czLoin);
    ok(overridesLoin.blocs.some(x => x[0] === 79600 && x[2] === 7600 && x[3] === 9),
       'SPEC-SERVEUR-009 : ce chunk lointain arrive bien via OVERRIDES_DEMANDE');

    eve.fermer();
  } catch (e) {
    echecs++;
    details.push(`  ${C.r}✗ exception (BIENVENUE bornée, SPEC-SERVEUR-009) : ${e.message}${C.x}`);
  } finally {
    try { s4.kill(); } catch (e) {}
  }

  await dodo(200);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}

  console.log(`\n${C.b}Integration admin${C.x}\n${details.join('\n')}\n`);
  const total = passes + echecs;
  if (echecs) { console.log(`${C.r}${echecs} échec(s)${C.x} sur ${total} tests\n`); process.exit(1); }
  console.log(`${C.g}${passes}/${total} tests d intégration passent${C.x}\n`);
})();
