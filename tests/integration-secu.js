/* integration-secu.js — tests d'intégration RÉELS du sous-lot A1 (fiabilité
   transport, L44) : vrai processus server.js, vraies sockets TCP, clients
   qui envoient volontairement des trames malformées, des rafales et des
   coordonnées hors de portée. Complète integration-net.js et spec-secu.js
   (qui ne teste que net-protocol.js hors socket).

   Usage : node tests/integration-secu.js [port]
   Chaque serveur lancé par ce test est arrêté (`kill()`) dans un `finally`,
   même si une assertion échoue ou qu'une exception est levée. */
'use strict';
process.env.MC_TEST_POSE_LIBRE = '1';   // SPEC-SYNC-028 : cette suite n'éprouve pas l'inventaire (les serveurs qu'elle lance héritent du réglage)
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const { spawn } = require('child_process');

const RACINE = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8499;

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

// ── client WebSocket minimal (repris d'integration-net.js), + accès brut ────
// `origin` (SPEC-SECU-011) : quand fourni, pose l'en-tête Origin de la requête
// de poignée de main, comme le ferait un vrai navigateur.
function connecter(port, origin) {
  return new Promise((resolve, reject) => {
    const cle = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(
        'GET / HTTP/1.1\r\n' +
        `Host: 127.0.0.1:${port}\r\n` +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        (origin ? `Origin: ${origin}\r\n` : '') +
        `Sec-WebSocket-Key: ${cle}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });

    let tampon = Buffer.alloc(0);
    let etabli = false;
    const messages = [];
    const attentes = [];

    const client = {
      socket: sock, messages,
      ferme: false,
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
      /* Envoie une trame TEXTE délibérément NON masquée (bit MASK à 0) —
         un vrai navigateur ne le fait jamais, un attaquant qui parle
         directement le protocole, si. */
      envoyerNonMasque(obj) {
        const charge = Buffer.from(JSON.stringify(obj), 'utf8');
        const n = charge.length;
        const entete = n < 126 ? 2 : 4;
        const buf = Buffer.alloc(entete + n);
        buf[0] = 0x81;
        if (n < 126) buf[1] = n;
        else { buf[1] = 126; buf.writeUInt16BE(n, 2); }
        charge.copy(buf, entete);
        sock.write(buf);
      },
      /* Écrit des octets bruts, tels quels — pour fabriquer un en-tête de
         trame mensonger (longueur énorme jamais suivie du corps). */
      envoyerBrut(buf) { sock.write(buf); },
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
      attendreFermeture(ms) {
        if (client.ferme) return Promise.resolve(true);
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('la connexion ne s est pas fermee')), ms || 3000);
          sock.once('close', () => { clearTimeout(t); res(true); });
        });
      },
      fermer() { try { sock.destroy(); } catch (e) {} },
    };

    sock.on('close', () => { client.ferme = true; });
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
    sock.on('error', () => {});
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

function demarrer(args, env) {
  const p = spawn(process.execPath, [path.join(RACINE, 'server.js'), ...args],
    { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, env || {}) });
  const logs = [];
  p.stdout.on('data', d => logs.push(String(d)));
  p.stderr.on('data', d => logs.push('ERR ' + String(d)));
  p.logs = logs;
  return p;
}
async function attendrePret(port) {
  for (let essai = 0; essai < 80; essai++) {
    await dodo(100);
    const r = await requete(port, '/index.html');
    if (r.code === 200) return true;
  }
  return false;
}
async function rejoindre(port, nom, locaux) {
  const cl = await connecter(port);
  cl.envoyer({ t: 'rejoindre', nom, locaux: locaux || 1 });
  const bienvenue = await cl.attendre('bienvenue');
  return { cl, bienvenue };
}

(async function () {
  // ── groupe 1 : résilience aux exceptions (SPEC-SECU-001/002) ─────────────
  {
    const port = PORT;
    const s = demarrer(['--port', String(port), '--serveur'], { MC_TEST_PANNE: '1' });
    try {
      ok(await attendrePret(port), 'le serveur (MC_TEST_PANNE=1) démarre');

      const { cl: a } = await rejoindre(port, 'Alice');
      const { cl: b } = await rejoindre(port, 'Bob');

      // Alice déclenche volontairement une exception dans traiter().
      a.envoyer({ t: 'chat', texte: '__panne_test_secu_001__' });
      await dodo(300);

      ok(true, 'SPEC-SECU-001 : le processus est toujours là (la requête suivante répond)');
      const sonde = await requete(port, '/index.html');
      eq(sonde.code, 200, 'SPEC-SECU-001 : le serveur répond toujours après l exception');

      // Bob, non concerné par l exception d Alice, reste pleinement fonctionnel.
      b.envoyer({ t: 'chat', texte: 'bob va bien' });
      const chatBob = await b.attendre('chat', 3000, m => /bob va bien/.test(m.texte || ''));
      ok(!!chatBob, 'SPEC-SECU-001 : un second client déjà connecté n est pas affecté');

      a.fermer(); b.fermer();
      await dodo(150);
    } catch (e) {
      echecs++; details.push(`  ${C.r}✗ exception (groupe 1a) : ${e.message}${C.x}\n${s.logs.join('')}`);
    } finally {
      try { s.kill(); } catch (e) {}
      await dodo(150);
    }
  }

  {
    const port = PORT + 1;
    const s = demarrer(['--port', String(port), '--serveur'], { MC_TEST_PANNE_ASYNC: '1' });
    try {
      ok(await attendrePret(port), 'le serveur (MC_TEST_PANNE_ASYNC=1) démarre');
      await dodo(600);                                   // laisse la panne asynchrone se produire
      const sonde = await requete(port, '/index.html');
      eq(sonde.code, 200, 'SPEC-SECU-002 : une exception hors handler de message ne tue pas le process');
      ok(s.logs.join('').indexOf('EXCEPTION NON RATTRAPÉE') >= 0,
         'SPEC-SECU-002 : l événement est journalisé');
    } catch (e) {
      echecs++; details.push(`  ${C.r}✗ exception (groupe 1b) : ${e.message}${C.x}\n${s.logs.join('')}`);
    } finally {
      try { s.kill(); } catch (e) {}
      await dodo(150);
    }
  }

  {
    const port = PORT + 2;
    const s = demarrer(['--port', String(port), '--serveur'], { MC_TEST_PANNE_REJET: '1' });
    try {
      ok(await attendrePret(port), 'le serveur (MC_TEST_PANNE_REJET=1) démarre');
      await dodo(600);
      const sonde = await requete(port, '/index.html');
      eq(sonde.code, 200, 'SPEC-SECU-002 : une promesse rejetée non gérée ne tue pas le process');
      ok(s.logs.join('').indexOf('PROMESSE REJETÉE') >= 0,
         'SPEC-SECU-002 : le rejet est journalisé');
    } catch (e) {
      echecs++; details.push(`  ${C.r}✗ exception (groupe 1c) : ${e.message}${C.x}\n${s.logs.join('')}`);
    } finally {
      try { s.kill(); } catch (e) {}
      await dodo(150);
    }
  }

  // ── groupe 2 : bas niveau (tampon, trame non masquée, portée) ────────────
  {
    const port = PORT + 3;
    const s = demarrer(['--port', String(port), '--serveur'], {});
    try {
      ok(await attendrePret(port), 'le serveur démarre (groupe 2)');

      // SPEC-SECU-004 : une trame non masquée doit fermer la connexion.
      const nonMasque = await connecter(port);
      nonMasque.envoyer({ t: 'rejoindre', nom: 'Masque', locaux: 1 });
      await nonMasque.attendre('bienvenue');
      nonMasque.envoyerNonMasque({ t: 'chat', texte: 'coucou en clair' });
      let fermee = false;
      try { await nonMasque.attendreFermeture(2000); fermee = true; } catch (e) { fermee = false; }
      ok(fermee, 'SPEC-SECU-004 : une trame client non masquée fait fermer la connexion');

      // SPEC-SECU-003 : un en-tête annonçant une longueur énorme, jamais
      // complétée, ne doit jamais faire grossir indéfiniment le tampon — la
      // connexion doit finir par être fermée par le serveur.
      const gourmand = await connecter(port);
      gourmand.envoyer({ t: 'rejoindre', nom: 'Gourmand', locaux: 1 });
      await gourmand.attendre('bienvenue');
      // en-tête masqué annonçant 200 Mo (127 = longueur 64 bits), jamais suivi du corps
      const enteteEnorme = Buffer.alloc(14);
      enteteEnorme[0] = 0x81;
      enteteEnorme[1] = 0x80 | 127;
      enteteEnorme.writeUInt32BE(0, 2);
      enteteEnorme.writeUInt32BE(200 * 1024 * 1024, 6);
      enteteEnorme.writeUInt32BE(0, 10);                  // clé de masquage (jamais utilisée)
      gourmand.envoyerBrut(enteteEnorme);
      // puis des paquets de « corps » qui ne complèteront jamais la trame,
      // au-delà de TAMPON_MAX, sans jamais dépasser une poignée de Mo
      const morceau = Buffer.alloc(65536, 0x41);
      let ferme2 = false;
      const attenteFermeture = gourmand.attendreFermeture(5000).then(() => { ferme2 = true; }).catch(() => {});
      for (let i = 0; i < 40 && !ferme2; i++) {           // 40 × 64 Kio = 2,5 Mo, bien au-delà de 1 Mo
        try { gourmand.envoyerBrut(morceau); } catch (e) { break; }
        await dodo(20);
      }
      await attenteFermeture;
      ok(ferme2, 'SPEC-SECU-003 : le tampon borné entraîne la fermeture, la mémoire reste bornée');

      nonMasque.fermer(); gourmand.fermer();
      await dodo(150);
    } catch (e) {
      echecs++; details.push(`  ${C.r}✗ exception (groupe 2) : ${e.message}${C.x}\n${s.logs.join('')}`);
    } finally {
      try { s.kill(); } catch (e) {}
      await dodo(150);
    }
  }

  // ── groupe 3 : anti-flood (SPEC-SECU-005/006) et portée (SPEC-SECU-007) ──
  {
    const port = PORT + 4;
    const s = demarrer(['--port', String(port), '--serveur'], {});
    try {
      ok(await attendrePret(port), 'le serveur démarre (groupe 3)');

      const { cl: alice, bienvenue } = await rejoindre(port, 'Alice');
      const { cl: bob } = await rejoindre(port, 'Bob');
      await alice.attendre('arrive').catch(() => {});     // laisse la diffusion d arrivée se stabiliser

      const moi = bienvenue.toi && bienvenue.toi[0];
      ok(!!moi, 'position de spawn transmise');
      const bx = Math.floor(moi.x), by = Math.floor(moi.y) + 3, bz = Math.floor(moi.z);

      // ── revue adversariale (2365213) : un joueur créatif qui casse en
      // continu (~60 BLOC/s à 60 im/s), ou jusqu à 4 joueurs locaux qui
      // partagent la MÊME connexion, ne doivent JAMAIS être expulsés pour un
      // débit simplement soutenu — chacun a son propre budget (m.j). ──
      const { cl: quad, bienvenue: bvQuad } = await rejoindre(port, 'Quad', 4);
      const posQuad = bvQuad.toi.map(t => ({ x: Math.floor(t.x), y: Math.floor(t.y) + 3, z: Math.floor(t.z) }));
      let quadEnvoyes = 0;
      const debutQuad = Date.now();
      const ivQuad = setInterval(() => {
        if (Date.now() - debutQuad > 3000 || quad.ferme) { clearInterval(ivQuad); return; }
        for (let j = 0; j < 4; j++) {
          const p = posQuad[j];
          quad.envoyer({ t: 'bloc', x: p.x + (quadEnvoyes % 40), y: p.y, z: p.z, id: 0, j });
        }
        quadEnvoyes++;
      }, 1000 / 60);                                       // ~60 BLOC/s PAR joueur local
      await dodo(3300);
      ok(!quad.ferme, 'SPEC-SECU-005 : 4 joueurs locaux à ~60 BLOC/s chacun ne sont jamais expulsés (' + quadEnvoyes + ' images)');
      quad.fermer();

      // ── un débit qui DÉPASSE le budget (mais reste plausible) : les
      // messages en trop sont ignorés — jamais de fermeture — et un BLOC
      // ignoré resynchronise le client avec l état autoritaire, pour ne
      // jamais laisser un bloc fantôme posé/cassé localement en prédiction. ──
      // on pose d'abord un bloc connu, pour avoir un `avant` non nul à vérifier
      alice.envoyer({ t: 'bloc', x: bx, y: by, z: bz, id: 9 });
      await alice.attendre('bloc', 2000, m => m.x === bx && m.z === bz);
      await dodo(1200);                                    // vide le compteur avant la rafale
      const avantDiffusions = () => bob.messages.filter(m => m.t === 'bloc').length;
      const n0 = avantDiffusions();
      for (let i = 0; i < 150; i++) {                       // 150/s > FLOOD_MAX_BLOC (90), < 10x (aberrant)
        alice.envoyer({ t: 'bloc', x: bx, y: by, z: bz, id: (i % 2) ? 9 : 0 });
      }
      await dodo(400);
      const diffuses = avantDiffusions() - n0;
      ok(diffuses > 0 && diffuses < 150, 'SPEC-SECU-005 : une rafale au-delà du budget reste bornée (' + diffuses + '/150 diffusés)');
      const resynchro = alice.messages.filter(m => m.t === 'bloc' && m.x === bx && m.z === bz);
      ok(resynchro.length > diffuses, 'SPEC-SECU-005 : Alice reçoit un rappel du bloc autoritaire pour au moins un message ignoré');
      ok(!alice.ferme, 'SPEC-SECU-005 : Alice reste connectée malgré la rafale au-delà du budget');

      await dodo(1200);
      alice.envoyer({ t: 'chat', texte: 'toujours vivante apres la rafale' });
      const apresRafale = await alice.attendre('chat', 3000, m => /toujours vivante/.test(m.texte || ''));
      ok(!!apresRafale, 'SPEC-SECU-005 : Alice reste utilisable après la rafale');

      // SPEC-SECU-006 : le chat a sa propre limite, plus stricte, séparée.
      const avantChat = bob.messages.filter(m => m.t === 'chat').length;
      for (let i = 0; i < 15; i++) alice.envoyer({ t: 'chat', texte: 'spam ' + i });
      await dodo(300);
      const chatDiffuses = bob.messages.filter(m => m.t === 'chat').length - avantChat;
      ok(chatDiffuses > 0 && chatDiffuses < 15, 'SPEC-SECU-006 : la rafale de CHAT est bornée (' + chatDiffuses + '/15 diffusés)');
      ok(alice.socket.writable !== false && !alice.ferme, 'SPEC-SECU-006 : pas de bannissement automatique sur une seule rafale');

      // ── débit ABERRANT (> 10x le budget BLOC, impossible pour un client
      // honnête) : un avertissement d abord, une expulsion seulement si le
      // débit aberrant persiste ensuite. ──
      await dodo(1200);
      const { cl: goinfre, bienvenue: bvGoinfre } = await rejoindre(port, 'Goinfre');
      const pg = bvGoinfre.toi[0];
      const gx = Math.floor(pg.x), gy = Math.floor(pg.y) + 3, gz = Math.floor(pg.z);
      let aberrantEnvoyes = 0;
      const ivAberrant = setInterval(() => {
        if (goinfre.ferme) { clearInterval(ivAberrant); return; }
        for (let k = 0; k < 30; k++) {                      // ~3000/s : bien > 10x FLOOD_MAX_BLOC (900)
          goinfre.envoyer({ t: 'bloc', x: gx, y: gy, z: gz, id: (aberrantEnvoyes % 2) ? 9 : 0 });
          aberrantEnvoyes++;
        }
      }, 10);
      let avertie = false;
      try {
        await goinfre.attendre('chat', 3000, m => m.type === 'systeme' && /d.bit/i.test(m.texte || ''));
        avertie = true;
      } catch (e) { avertie = false; }
      ok(avertie, 'SPEC-SECU-005 : un débit aberrant déclenche d abord un avertissement');
      let expulsee = false;
      try { await goinfre.attendreFermeture(6000); expulsee = true; } catch (e) { expulsee = false; }
      clearInterval(ivAberrant);
      ok(expulsee, 'SPEC-SECU-005 : le débit aberrant, s il persiste après l avertissement, entraîne l expulsion');

      // SPEC-SECU-007 : un BLOC loin de tout joueur ne doit jamais coûter
      // cher au serveur (aucune génération de chunk) — un lot de BLOC très
      // éloignés, chacun dans un chunk distinct, ne doit pas ralentir
      // perceptiblement le serveur : le round-trip d un message ordinaire
      // juste après reste rapide.
      await dodo(1200);
      const t0 = Date.now();
      for (let i = 0; i < 25; i++) {
        alice.envoyer({ t: 'bloc', x: 500000 + i * 32, y: 40, z: 500000 + i * 32, id: 9 });
      }
      const bxL = bx, byL = by, bzL = bz + 2;               // toujours à portée d Alice
      alice.envoyer({ t: 'bloc', x: bxL, y: byL, z: bzL, id: 9 });
      const echoLoin = await alice.attendre('bloc', 4000, m => m.x === bxL && m.z === bzL);
      const dt = Date.now() - t0;
      ok(!!echoLoin, 'SPEC-SECU-007 : le serveur traite toujours un BLOC proche après une rafale de BLOC hors de portée');
      ok(dt < 3000, 'SPEC-SECU-007 : pas de ralentissement mesurable (aucune génération de chunk) — ' + dt + ' ms');

      alice.fermer(); bob.fermer();
      await dodo(150);
    } catch (e) {
      echecs++; details.push(`  ${C.r}✗ exception (groupe 3) : ${e.message}${C.x}\n${s.logs.join('')}`);
    } finally {
      try { s.kill(); } catch (e) {}
      await dodo(150);
    }
  }

  // ── groupe 4 : sauvegarde atomique et asynchrone (SPEC-SERVEUR-003/004) ──
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-secu-'));
    const fichierMonde = path.join(tmp, 'monde.json');
    const port = PORT + 5;
    // sauvegarde très fréquente pour multiplier les fenêtres d écriture
    const s = demarrer(['--port', String(port), '--serveur', '--monde', fichierMonde], { MC_SAUVEGARDE_MS: '80' });
    try {
      ok(await attendrePret(port), 'le serveur démarre avec --monde (groupe 4)');

      const { cl: alice, bienvenue } = await rejoindre(port, 'Alice');
      const moi = bienvenue.toi[0];
      // quelques blocs pour donner un peu de matière à sérialiser
      for (let i = 0; i < 20; i++) {
        alice.envoyer({ t: 'bloc', x: Math.floor(moi.x) + (i % 5), y: Math.floor(moi.y) + 2, z: Math.floor(moi.z), id: 9 });
      }
      await dodo(150);

      // SPEC-SERVEUR-003 : jamais un fichier tronqué au chemin final — on lit
      // le fichier en boucle pendant que le serveur sauvegarde sans relâche ;
      // toute lecture qui aboutit doit être un JSON valide et complet.
      let lecturesReussies = 0, jamaisTronque = true;
      const finLecture = Date.now() + 1500;
      while (Date.now() < finLecture) {
        try {
          const brut = fs.readFileSync(fichierMonde, 'utf8');
          if (brut) { JSON.parse(brut); lecturesReussies++; }
        } catch (e) {
          jamaisTronque = false;
          details.push(`    (lecture pendant l écriture : ${e.message})`);
        }
      }
      ok(lecturesReussies > 3, 'SPEC-SERVEUR-003 : plusieurs sauvegardes successives ont eu lieu (' + lecturesReussies + ')');
      ok(jamaisTronque, 'SPEC-SERVEUR-003 : aucune lecture n a jamais vu un fichier tronqué (tmp+rename atomique)');
      ok(!fs.existsSync(fichierMonde + '.tmp.tmp'), 'SPEC-SERVEUR-003 : pas de fichier temporaire résiduel imbriqué');

      // SPEC-SERVEUR-004 : la sauvegarde ne doit pas geler la diffusion
      // d état — on mesure le débit d ETAT pendant une fenêtre qui couvre
      // plusieurs cycles de sauvegarde (MC_SAUVEGARDE_MS=80).
      const avantN = alice.messages.filter(m => m.t === 'etat').length;
      await dodo(1000);
      const parSeconde = alice.messages.filter(m => m.t === 'etat').length - avantN;
      ok(parSeconde >= 30, 'SPEC-SERVEUR-004 : la diffusion d état continue pendant les sauvegardes (' + parSeconde + '/s)');

      alice.fermer();
      await dodo(150);
    } catch (e) {
      echecs++; details.push(`  ${C.r}✗ exception (groupe 4) : ${e.message}${C.x}\n${s.logs.join('')}`);
    } finally {
      try { s.kill(); } catch (e) {}
      await dodo(200);
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
    }
  }

  // ── groupe 5 : course sauvegarde async/sync à l'arrêt (revue 2365213) ────
  /* `child_process.kill('SIGTERM')` (et, mesuré, `kill -TERM` sous Git Bash)
     TERMINE le processus SANS jamais invoquer `process.on('SIGTERM')` sous
     Windows — il n'existe aucun signal POSIX réel sur cette plateforme, donc
     un test qui tuerait le process depuis l'extérieur ne testerait JAMAIS le
     chemin `arreter()` ici. `MC_TEST_ARRET_MS` déclenche le même `arreter()`
     qu'un vrai SIGINT/SIGTERM, MAIS depuis l'intérieur du process — seul
     moyen fiable, indépendant de la plateforme, d'exercer la coordination
     entre la sauvegarde périodique (async) et celle de l'arrêt (sync). */
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-race-'));
    let corruptions = 0, tmpResiduels = 0, manquants = 0;
    const ESSAIS = 16;
    for (let i = 0; i < ESSAIS; i++) {
      const fichier = path.join(tmp, 'monde-' + i + '.json');
      const port = PORT + 6 + (i % 4);
      const delai = 15 + (i % 15);                          // varie le moment de l'arrêt autour des sauvegardes (3 ms)
      const s = demarrer(['--port', String(port), '--serveur', '--monde', fichier],
        { MC_SAUVEGARDE_MS: '3', MC_TEST_ARRET_MS: String(delai) });
      await new Promise((res) => s.on('exit', res));
      await dodo(80);
      const tmpAsync = fs.existsSync(fichier + '.tmp');
      const tmpSync = fs.readdirSync(tmp).filter(f => f.indexOf(path.basename(fichier) + '.tmp.') === 0);
      if (tmpAsync || tmpSync.length) { tmpResiduels++; details.push('    (tmp résiduel essai ' + i + ' : async=' + tmpAsync + ' sync=' + JSON.stringify(tmpSync) + ')'); }
      if (!fs.existsSync(fichier)) { manquants++; continue; }
      try { JSON.parse(fs.readFileSync(fichier, 'utf8')); }
      catch (e) { corruptions++; details.push('    (corruption essai ' + i + ' : ' + e.message + ')'); }
    }
    ok(corruptions === 0, 'SPEC-SERVEUR-003 : aucune corruption sur ' + ESSAIS + ' arrêts pendant une sauvegarde en vol (corruptions=' + corruptions + ')');
    ok(tmpResiduels === 0, 'SPEC-SERVEUR-003 : aucun fichier temporaire résiduel après un arrêt propre (' + tmpResiduels + '/' + ESSAIS + ')');
    ok(manquants === 0, 'SPEC-SERVEUR-003 : le fichier final existe toujours après l arrêt (' + manquants + '/' + ESSAIS + ' manquants)');

    // nettoyage au démarrage : un .tmp résiduel d'un arrêt brutal antérieur
    // (process tué sans passer par arreter(), donc jamais renommé) est
    // supprimé — journalisé — au prochain démarrage sur le même fichier.
    const fichierBrutal = path.join(tmp, 'monde-brutal.json');
    fs.writeFileSync(fichierBrutal, JSON.stringify({ v: 2, graine: 1, heure: 60, overrides: [], etats: [], crops: [] }));
    fs.writeFileSync(fichierBrutal + '.tmp', '{"ecriture partielle...');
    const portBrutal = PORT + 6;
    const sBrutal = demarrer(['--port', String(portBrutal), '--serveur', '--monde', fichierBrutal], {});
    try {
      ok(await attendrePret(portBrutal), 'le serveur démarre après un .tmp résiduel préexistant');
      await dodo(200);
      ok(sBrutal.logs.join('').indexOf('résiduel supprimé') >= 0,
         'SPEC-SERVEUR-003 : le .tmp résiduel d un arrêt brutal antérieur est nettoyé au démarrage, journalisé');
      ok(!fs.existsSync(fichierBrutal + '.tmp'), 'SPEC-SERVEUR-003 : le .tmp résiduel a bien été supprimé du disque');
    } finally {
      try { sBrutal.kill(); } catch (e) {}
      await dodo(150);
    }

    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  }

  // ── groupe 6 : en-têtes de sécurité HTTP (SPEC-SECU-010) ─────────────────
  {
    const port = PORT + 10;
    const s = demarrer(['--port', String(port), '--serveur'], {});
    try {
      ok(await attendrePret(port), 'le serveur démarre (groupe 6)');
      const rep = await new Promise((resolve) => {
        http.get({ host: '127.0.0.1', port, path: '/index.html' }, (res) => {
          res.resume();
          res.on('end', () => resolve({ code: res.statusCode, entetes: res.headers }));
        }).on('error', () => resolve({ code: 0, entetes: {} }));
      });
      eq(rep.code, 200, 'SPEC-SECU-010 : /index.html répond 200');
      eq(rep.entetes['x-content-type-options'], 'nosniff', 'SPEC-SECU-010 : X-Content-Type-Options: nosniff');
      const csp = rep.entetes['content-security-policy'] || '';
      ok(!!csp, 'SPEC-SECU-010 : une Content-Security-Policy est présente');
      ok(csp.indexOf('cdnjs.cloudflare.com') >= 0, 'SPEC-SECU-010 : la CSP autorise le CDN de three.js');
      ok(!('x-powered-by' in rep.entetes), 'SPEC-SECU-010 : pas de X-Powered-By');
    } catch (e) {
      echecs++; details.push(`  ${C.r}✗ exception (groupe 6) : ${e.message}${C.x}\n${s.logs.join('')}`);
    } finally {
      try { s.kill(); } catch (e) {}
      await dodo(150);
    }
  }

  // ── groupe 7 : liste blanche d'Origin à la poignée de main (SPEC-SECU-011) ──
  {
    const port = PORT + 11;
    const origineOk = `http://127.0.0.1:${port}`;
    const s = demarrer(['--port', String(port), '--serveur', '--origines', origineOk], {});
    try {
      ok(await attendrePret(port), 'le serveur démarre avec --origines (groupe 7)');

      let refusee = false;
      try { await connecter(port, 'http://interdit.example'); } catch (e) { refusee = true; }
      ok(refusee, 'SPEC-SECU-011 : un Origin absent de la liste configurée est refusé');

      let acceptee = false;
      try { const cl = await connecter(port, origineOk); acceptee = true; cl.fermer(); }
      catch (e) { acceptee = false; }
      ok(acceptee, 'SPEC-SECU-011 : l origine attendue aboutit');
      // Sans --origines (tous les AUTRES groupes de ce fichier se connectent
      // sans Origin), la poignée de main aboutit toujours — c'est le
      // comportement par défaut, déjà vérifié partout ailleurs ici.
    } catch (e) {
      echecs++; details.push(`  ${C.r}✗ exception (groupe 7) : ${e.message}${C.x}\n${s.logs.join('')}`);
    } finally {
      try { s.kill(); } catch (e) {}
      await dodo(150);
    }
  }

  // ── groupe 8 : cadence de diffusion adaptée à la charge (SPEC-SERVEUR-007) ──
  {
    const port = PORT + 12;
    const s = demarrer(['--port', String(port), '--serveur'], { MC_ETAT_HZ: '48' });
    try {
      ok(await attendrePret(port), 'le serveur démarre (groupe 8)');

      const { cl: sonde } = await rejoindre(port, 'Sonde');
      await dodo(300);
      const n0a = sonde.messages.filter(m => m.t === 'etat').length;
      await dodo(1000);
      const tauxPeu = sonde.messages.filter(m => m.t === 'etat').length - n0a;

      // 29 connexions supplémentaires (pas besoin de REJOINDRE : le nombre de
      // clients CONNECTÉS suffit déjà à faire monter la charge côté serveur).
      const autres = await Promise.all(Array.from({ length: 29 }, () => connecter(port)));
      await dodo(300);          // laisse le serveur voir les nouvelles connexions
      const n0b = sonde.messages.filter(m => m.t === 'etat').length;
      await dodo(1000);
      const tauxCharge = sonde.messages.filter(m => m.t === 'etat').length - n0b;

      ok(tauxPeu >= 25, 'SPEC-SERVEUR-007 : avec peu de clients, la cadence reste proche de la configuration (' + tauxPeu + '/s, MC_ETAT_HZ=48)');
      ok(tauxCharge > 0, 'SPEC-SERVEUR-007 : la diffusion continue malgré la charge, jamais interrompue (' + tauxCharge + '/s)');
      ok(tauxCharge < tauxPeu, 'SPEC-SERVEUR-007 : la cadence mesurée diminue progressivement quand le nombre de clients augmente (' + tauxCharge + ' < ' + tauxPeu + ')');

      autres.forEach(cl => cl.fermer());
      sonde.fermer();
      await dodo(150);
    } catch (e) {
      echecs++; details.push(`  ${C.r}✗ exception (groupe 8) : ${e.message}${C.x}\n${s.logs.join('')}`);
    } finally {
      try { s.kill(); } catch (e) {}
      await dodo(150);
    }
  }

  console.log(`\n${C.b}Integration sécurité (L44 — sous-lot A1)${C.x}`);
  console.log(details.join('\n'));
  const total = passes + echecs;
  if (echecs) {
    console.log(`\n${C.r}${echecs} echec(s)${C.x} sur ${total}\n`);
    process.exit(1);
  }
  console.log(`\n${C.g}${passes}/${total} tests d integration passent${C.x}\n`);
  process.exit(0);
})();
