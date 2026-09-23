/* server.js — serveur de jeu MiniCraft. Node pur, AUCUNE dépendance npm :
   WebSocket (RFC 6455) implémenté à la main, fichiers statiques servis par le
   même processus.

   Usage :  node server.js [port]

   Le serveur réutilise les MÊMES modules de logique que le client (world,
   entities, chat…). C'est la raison d'être de la séparation logique/rendu :
   sans elle, il faudrait réécrire la simulation côté serveur et les deux
   divergeraient au premier correctif. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const RACINE = __dirname;
const PORT = parseInt(process.argv[2], 10) || 8080;

// ── chargement des modules de logique pure ───────────────────────────────────
const MODULES = ['core', 'noise', 'biomes', 'donjons', 'world', 'mesher', 'physics', 'faune', 'inventory', 'vehicules',
                 'entities', 'player', 'daycycle', 'save', 'saves', 'modes',
                 'chat', 'split', 'net-protocol'];

const ctx = vm.createContext(Object.assign(Object.create(null), {
  console, Math, JSON, Date, Error, Number, String, Array, Object, Boolean,
  Map, Set, Uint8Array, Float32Array, isNaN, isFinite, parseInt, parseFloat,
}));
ctx.globalThis = ctx;
MODULES.forEach(m => {
  vm.runInContext(fs.readFileSync(path.join(RACINE, 'src', m + '.js'), 'utf8'),
                  ctx, { filename: m + '.js' });
});
const MC = ctx.MC;
const NP = MC.NetProtocol;

// ── état du monde, autoritatif ───────────────────────────────────────────────
const CONF = {
  graine: parseInt(process.env.MC_GRAINE, 10) || 20260921,
  mode: process.env.MC_MODE || 'survie',
  difficulte: process.env.MC_DIFFICULTE || 'facile',
  tickHz: 20,          // simulation
  etatHz: 10,          // diffusion des positions
};

const regles = MC.Modes.regles(CONF.mode, CONF.difficulte);
const monde = MC.createWorld(CONF.graine);
const entites = MC.createEntities(monde);
const chat = MC.Chat.creer({ max: 120 });
let heure = 60;

/* Le serveur a besoin d'un « joueur de référence » pour l'IA des mobs
   (poursuite, apparition). On prend le premier client connecté ; sans client,
   la simulation tourne au ralenti autour de l'origine. */
const spawnCol = monde.findSpawnColumn();
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  monde.getChunk(Math.floor(spawnCol[0] / 16) + cx, Math.floor(spawnCol[1] / 16) + cz, true);
}
const SPAWN = {
  x: spawnCol[0] + 0.5,
  y: monde.groundAt(spawnCol[0], spawnCol[1], true) + 1.2,
  z: spawnCol[1] + 0.5,
};

// ── clients ──────────────────────────────────────────────────────────────────
let prochainId = 1;
const clients = new Map();          // id -> {id, nom, socket, pos, yaw, pitch, locaux, vivant}

function diffuser(msg, saufId) {
  const trame = NP.encoder(JSON.stringify(msg), NP.OP.TEXTE, Buffer.alloc);
  clients.forEach(c => {
    if (c.id === saufId || !c.vivant) return;
    try { c.socket.write(trame); } catch (e) { fermer(c, 'ecriture impossible'); }
  });
}
function envoyer(c, msg) {
  if (!c || !c.vivant) return;
  try {
    c.socket.write(NP.encoder(JSON.stringify(msg), NP.OP.TEXTE, Buffer.alloc));
  } catch (e) { fermer(c, 'ecriture impossible'); }
}

function fermer(c, raison) {
  if (!c || !c.vivant) return;
  c.vivant = false;
  clients.delete(c.id);
  try { c.socket.destroy(); } catch (e) {}
  const m = chat.systeme(c.nom + ' a quitté la partie');
  diffuser({ t: NP.MSG.QUITTE, id: c.id, nom: c.nom });
  if (m) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
  journal(`- ${c.nom} (#${c.id}) parti — ${raison || 'deconnexion'} · ${clients.size} en ligne`);
}

function journal(txt) {
  const h = new Date().toTimeString().slice(0, 8);
  console.log(`[${h}] ${txt}`);
}

// ── fichiers statiques ───────────────────────────────────────────────────────
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon',
};

/* Piège classique : « ../../etc/passwd ». On résout le chemin ABSOLU puis on
   vérifie qu'il reste sous la racine — comparer les chaînes avant résolution
   ne suffit pas, l'encodage URL permet de contourner. */
function cheminSur(urlPath) {
  let brut;
  try { brut = decodeURIComponent(urlPath.split('?')[0]); }
  catch (e) { return null; }
  if (brut.indexOf('\0') >= 0) return null;                 // octet nul
  if (brut === '/' || brut === '') brut = '/index.html';
  const resolu = path.resolve(RACINE, '.' + brut);
  const racine = path.resolve(RACINE);
  // le séparateur final évite que /racine-bis passe pour /racine
  if (resolu !== racine && !resolu.startsWith(racine + path.sep)) return null;
  return resolu;
}

function servir(req, res) {
  const chemin = cheminSur(req.url);
  if (!chemin) { res.writeHead(403); res.end('403 chemin refusé'); return; }
  fs.stat(chemin, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('404 introuvable'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(chemin).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(chemin).pipe(res);
  });
}

// ── serveur HTTP + bascule WebSocket ─────────────────────────────────────────
const serveur = http.createServer(servir);

serveur.on('upgrade', (req, socket) => {
  if (!NP.estRequeteWebSocket(req.headers)) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  const cle = req.headers['sec-websocket-key'];
  socket.write(NP.reponseHandshake(cle, (s) =>
    crypto.createHash('sha1').update(s).digest('base64')));
  socket.setNoDelay(true);

  const c = {
    id: prochainId++, nom: 'Joueur', socket, vivant: true, locaux: 1,
    pos: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z }, yaw: 0, pitch: 0,
    rejoint: false,
  };
  clients.set(c.id, c);

  /* TCP ne respecte aucune frontière de message : une lecture peut contenir
     une demi-trame, ou trois. On accumule et on décode tant qu'une trame
     complète sort. Oublier cela donne des coupures aléatoires sous charge —
     précisément quand on en a le moins besoin. */
  let tampon = Buffer.alloc(0);
  socket.on('data', (bloc) => {
    tampon = Buffer.concat([tampon, bloc]);
    for (;;) {
      const d = NP.decoder(tampon);
      if (!d) break;                                 // trame incomplète : on attend
      tampon = tampon.slice(d.consomme);

      if (d.opcode === NP.OP.FERME) { fermer(c, 'fermeture demandee'); return; }
      if (d.opcode === NP.OP.PING) {
        socket.write(NP.encoder(Buffer.from(d.charge), NP.OP.PONG, Buffer.alloc));
        continue;
      }
      if (d.opcode !== NP.OP.TEXTE) continue;

      let msg;
      try { msg = JSON.parse(NP.utf8Decoder(d.charge)); } catch (e) { continue; }
      traiter(c, NP.valider(msg));
    }
  });

  socket.on('error', () => fermer(c, 'erreur socket'));
  socket.on('close', () => fermer(c, 'socket fermee'));
});

// ── traitement des messages ──────────────────────────────────────────────────
function traiter(c, m) {
  if (!m) return;                                   // message invalide : ignoré
  switch (m.t) {
    case NP.MSG.REJOINDRE: {
      c.nom = m.nom;
      c.locaux = m.locaux;
      c.rejoint = true;
      // l'état complet du monde modifié, pour que le nouveau venu voie les
      // constructions faites avant son arrivée
      const blocs = [];
      monde.overrides.forEach((id, k) => {
        const p = k.split(',');
        blocs.push([+p[0], +p[1], +p[2], id]);
      });
      envoyer(c, {
        t: NP.MSG.BIENVENUE,
        id: c.id, graine: CONF.graine, mode: CONF.mode, difficulte: CONF.difficulte,
        heure, blocs,
        joueurs: [...clients.values()].filter(x => x.id !== c.id && x.rejoint)
          .map(x => ({ id: x.id, nom: x.nom, x: x.pos.x, y: x.pos.y, z: x.pos.z, yaw: x.yaw })),
        chat: chat.recents(20).map(x => ({ auteur: x.auteur, texte: x.texte, type: x.type, ts: x.t })),
      });
      diffuser({ t: NP.MSG.ARRIVE, id: c.id, nom: c.nom, locaux: c.locaux }, c.id);
      const sm = chat.systeme(c.nom + ' a rejoint la partie' +
                              (c.locaux > 1 ? ' (' + c.locaux + ' joueurs locaux)' : ''));
      if (sm) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: sm.texte, type: 'systeme', ts: sm.t });
      journal(`+ ${c.nom} (#${c.id}) rejoint · ${clients.size} en ligne`);
      break;
    }
    case NP.MSG.BOUGE:
      c.pos.x = m.x; c.pos.y = m.y; c.pos.z = m.z;
      c.yaw = m.yaw; c.pitch = m.pitch;
      break;

    case NP.MSG.BLOC: {
      /* Le serveur fait autorité : il applique, PUIS diffuse à tous — y
         compris à l'émetteur, dont la prédiction locale est ainsi confirmée
         ou corrigée. */
      const cx = Math.floor(m.x / 16), cz = Math.floor(m.z / 16);
      monde.getChunk(cx, cz, true);
      monde.setBlock(m.x, m.y, m.z, m.id);
      diffuser({ t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: m.id });
      break;
    }

    case NP.MSG.CHAT: {
      const msg = chat.envoyer(c.nom, m.texte);
      if (msg) {
        diffuser({ t: NP.MSG.CHAT, auteur: msg.auteur, texte: msg.texte,
                   type: msg.type, ts: msg.t });
        journal(`<${c.nom}> ${msg.texte}`);
      }
      break;
    }
  }
}

// ── boucle de simulation ─────────────────────────────────────────────────────
let dernier = Date.now();
let accEtat = 0;
let accSpawn = 0;
let accChunks = 1;         // premier passage immédiat

function joueurReference() {
  for (const c of clients.values()) if (c.rejoint) return { pos: c.pos };
  return { pos: SPAWN };
}

setInterval(() => {
  const now = Date.now();
  const dt = Math.min((now - dernier) / 1000, 0.25);
  dernier = now;

  heure += dt;
  monde.tick(dt, 14);

  /* Le serveur simule les créatures autour des joueurs : il lui faut donc le
     terrain autour d'eux. Sans cela, une créature hors des chunks du point
     d'apparition n'avait pas de sol — gelée désormais, elle tombait jadis
     dans le vide — et aucune apparition n'y trouvait de terrain valide. */
  accChunks += dt;
  if (accChunks >= 1) {
    accChunks = 0;
    const centres = [[Math.floor(SPAWN.x / 16), Math.floor(SPAWN.z / 16)]];
    clients.forEach(c => {
      if (c.rejoint) centres.push([Math.floor(c.pos.x / 16), Math.floor(c.pos.z / 16)]);
    });
    monde.chunksVoulus(centres, 3).forEach(v => monde.getChunk(v[1], v[2], true));
    monde.unloadLoin(centres, 5);
  }

  const ref = joueurReference();
  entites.update(dt, ref, {});
  entites.mergeItems();

  accSpawn += dt;
  if (accSpawn >= 3.5) {
    accSpawn = 0;
    if (clients.size > 0) {
      entites.trySpawn(ref, MC.DayCycle.isNight(heure), null,
                       MC.Modes.plafondsEntites(regles));
      if (!MC.DayCycle.isNight(heure)) entites.burnUndead(false);
    }
  }

  /* Diffusion d'état à cadence réduite : simuler à 20 Hz et n'envoyer qu'à
     10 Hz divise le trafic par deux sans que l'on voie la différence, les
     clients interpolant entre deux relevés. */
  accEtat += dt;
  if (accEtat >= 1 / CONF.etatHz) {
    accEtat = 0;
    if (clients.size > 0) {
      const joueurs = [...clients.values()].filter(c => c.rejoint).map(c => ({
        id: c.id, x: +c.pos.x.toFixed(2), y: +c.pos.y.toFixed(2), z: +c.pos.z.toFixed(2),
        yaw: +c.yaw.toFixed(2),
      }));
      const mobs = entites.list.filter(e => e.type !== 'item').slice(0, 40).map(e => ({
        e: e.eid, t: e.type,
        x: +e.pos.x.toFixed(2), y: +e.pos.y.toFixed(2), z: +e.pos.z.toFixed(2),
        yaw: +(e.yaw || 0).toFixed(2),
      }));
      diffuser({ t: NP.MSG.ETAT, joueurs, mobs, heure: +heure.toFixed(1) });
    }
  }
}, 1000 / CONF.tickHz);

// ── démarrage ────────────────────────────────────────────────────────────────
serveur.listen(PORT, () => {
  journal(`MiniCraft — serveur sur http://localhost:${PORT}`);
  journal(`graine ${CONF.graine} · mode ${CONF.mode} · difficulté ${CONF.difficulte}`);
  journal(`simulation ${CONF.tickHz} Hz · diffusion d'état ${CONF.etatHz} Hz`);
});

process.on('SIGINT', () => {
  journal('arrêt demandé');
  clients.forEach(c => { try { c.socket.destroy(); } catch (e) {} });
  serveur.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
});

module.exports = { serveur, cheminSur, CONF };
