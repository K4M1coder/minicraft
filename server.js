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

// ── paramètres de lancement (SPEC-PACK-002) ─────────────────────────────────
/* Compatibilité : l'ancien usage `node server.js 8080` (port positionnel,
   utilisé par les tests d'intégration existants) reste accepté — on le
   traduit en `--port 8080` avant l'analyse déclarative. */
const SANS_PARAMETRE = process.argv.slice(2).length === 0;   // SPEC-PACK-001 : ouvre le navigateur
let argvBrut = process.argv.slice(2);
if (argvBrut[0] && /^\d+$/.test(argvBrut[0])) argvBrut = ['--port', argvBrut[0], ...argvBrut.slice(1)];


// ── chargement des modules de logique pure ───────────────────────────────────
const MODULES = ['core', 'formes', 'noise', 'biomes', 'densite', 'zones', 'volcanisme', 'souterrain', 'recifs', 'donjons', 'habitats', 'routes', 'carte', 'feu', 'meteo', 'lointain', 'world', 'circuits', 'lumiere', 'mesher', 'physics', 'faune', 'factions', 'inventory', 'vehicules',
                 'entities', 'player', 'synchro', 'daycycle', 'save', 'saves', 'modes',
                 'chat', 'commandes', 'split', 'net-protocol', 'parametres', 'admin', 'politique', 'guildes', 'livre', 'livres'];

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
const SY = MC.Synchro;
const C = MC.Core;

/* L'analyse elle-même est pure et testée sous Node (tests/spec-parametres.js) ;
   c'est ICI, et seulement ici, qu'une erreur ou --aide arrête le programme. */
const analyse = MC.Parametres.analyser(argvBrut);
if (!analyse.ok) {
  console.log(analyse.message);
  process.exit(analyse.code === 'aide' ? 0 : 1);
}
const PARAMS = analyse.config;
const PORT = PARAMS.port;

// ── état du monde, autoritatif ───────────────────────────────────────────────
const CONF = {
  graine: PARAMS.graine !== null ? PARAMS.graine : (parseInt(process.env.MC_GRAINE, 10) || 20260921),
  mode: process.env.MC_MODE || 'survie',
  difficulte: process.env.MC_DIFFICULTE || 'facile',
  /* Le serveur fait autorité : il simule les joueurs à partir de leurs
     entrées. On le fait tourner aussi vite que le client affiche, et l'on
     diffuse l'état à la même cadence : c'est ce qui rend la correction
     invisible. Réglables par MC_TICK_HZ et MC_ETAT_HZ. */
  tickHz: parseInt(process.env.MC_TICK_HZ, 10) || 60,
  etatHz: parseInt(process.env.MC_ETAT_HZ, 10) || 60,
  serveurSeul: PARAMS.serveurSeul,
  maxJoueurs: PARAMS.maxJoueurs,
  pvp: PARAMS.pvp,
  mondeFichier: PARAMS.monde ? path.resolve(RACINE, PARAMS.monde) : null,
};

// ── administration (SPEC-ADMIN-001 à 008) ───────────────────────────────────
/* Sans --admin, le serveur tire un jeton et l'affiche UNE fois au démarrage :
   jamais de console laissée sans protection, jamais de secret par défaut
   devinable. */
const ADMIN_SECRET = PARAMS.admin || MC.Admin.nouveauJeton('demarrage-');
const admin = MC.Admin.creerEtat({
  motDePasseAdmin: ADMIN_SECRET,
  listeBlancheActive: PARAMS.listeBlanche,
  emailObligatoire: false,
});
if (!PARAMS.admin) {
  journal(`aucun --admin fourni : jeton d'administration généré → ${ADMIN_SECRET}`);
  journal('conservez-le : il ne sera plus jamais affiché (relancez avec --admin=... pour le fixer)');
}

const regles = MC.Modes.regles(CONF.mode, CONF.difficulte);
const monde = MC.createWorld(CONF.graine, { zonePolitique: PARAMS.zone });
const entites = MC.createEntities(monde);
const chat = MC.Chat.creer({ max: 120 });
// SPEC-FACTION-006 à 013 : factions PNJ (royaumes, guildes marchandes, ordres,
// bandits, cultes) et factions de joueurs — le serveur fait foi sur les deux.
const politique = MC.Politique.creer(CONF.graine);
const guildes = MC.Guildes.creerEtat();
let heure = 60;
let meteoT = null;
let accEau = 0;
let accCircuits = 0;      // L29 mécanismes (SPEC-MECA-008) : même cadence que l'eau

// ── persistance du monde (SPEC-SERVEUR-001) ─────────────────────────────────
/* `--monde fichier.json` fait vivre le monde sans joueur local : sauvegarde
   régulière ET à l'arrêt (SIGINT/SIGTERM), reprise au lancement suivant. Le
   format est délibérément indépendant de MC.Save (pensé pour UN joueur local) :
   ici il n'y a ni joueur ni inventaire à sauver, seulement le monde partagé
   et l'état d'administration (rôles, listes, invitations, journal). */
function etatMonde() {
  const overrides = [];
  monde.overrides.forEach((id, k) => { const p = k.split(','); overrides.push([+p[0], +p[1], +p[2], id]); });
  // États de bloc (SPEC-SAVE-017) : à part des overrides — poser un état ne
  // pose pas forcément un bloc, le coupler aux overrides en perdrait au chargement.
  const etats = [];
  if (monde.etatsOverrides) {
    monde.etatsOverrides.forEach((etat, k) => { const p = k.split(','); etats.push([+p[0], +p[1], +p[2], etat]); });
  }
  const crops = [];
  monde.crops.forEach(c => crops.push([c.x, c.y, c.z, +c.t.toFixed(2)]));
  return {
    // v2 (SPEC-SAVE-017) : ajoute la liste `etats` ; les blocs eux-mêmes ne
    // bougent pas (aucun objet d'inventaire ici, voir le commentaire plus
    // haut), donc un fichier v1 (sans `etats`) se relit sans conversion d'id.
    v: 2, graine: CONF.graine, heure,
    overrides, etats, crops,
    donjons: monde.donjonsVaincus ? Array.from(monde.donjonsVaincus) : [],
    pilles: monde.coffresPilles ? Array.from(monde.coffresPilles) : [],
    pnjsMorts: monde.pnjsMorts ? Array.from(monde.pnjsMorts.entries()) : [],
    admin: MC.Admin.serialiser(admin),
    zones: monde.zonesEtat ? MC.Zones.serialiser(monde.zonesEtat) : null,
    politique: MC.Politique.serialiser(politique),
    guildes: MC.Guildes.serialiser(guildes),
  };
}
function appliquerEtatMonde(data) {
  if (!data || (data.v !== 1 && data.v !== 2)) return false;   // format inconnu : refusé proprement
  if (data.graine !== undefined && data.graine !== CONF.graine) {
    // une graine différente : la carte ne correspondrait plus aux overrides
    journal(`avertissement : la graine du fichier (${data.graine}) diffère de celle lancée (${CONF.graine}) — reprise quand même`);
  }
  heure = data.heure || 60;
  monde.overrides.clear();
  (data.overrides || []).forEach(o => monde.overrides.set(o[0] + ',' + o[1] + ',' + o[2], o[3]));
  if (monde.etatsOverrides) {
    monde.etatsOverrides.clear();
    (data.etats || []).forEach(o => { if (o[3]) monde.etatsOverrides.set(o[0] + ',' + o[1] + ',' + o[2], o[3]); });
  }
  monde.crops.clear();
  (data.crops || []).forEach(c => monde.crops.set(c[0] + ',' + c[1] + ',' + c[2], { x: c[0], y: c[1], z: c[2], t: c[3] }));
  if (monde.donjonsVaincus) { monde.donjonsVaincus.clear(); (data.donjons || []).forEach(id => monde.donjonsVaincus.add(id)); }
  if (monde.coffresPilles) { monde.coffresPilles.clear(); (data.pilles || []).forEach(k => monde.coffresPilles.add(k)); }
  if (monde.pnjsMorts) {
    monde.pnjsMorts.clear();
    (data.pnjsMorts || []).forEach(m => { if (m && typeof m[0] === 'string') monde.pnjsMorts.set(m[0], +m[1] || 0); });
  }
  if (data.admin) MC.Admin.appliquer(admin, data.admin);
  if (data.zones && monde.zonesEtat) MC.Zones.appliquer(monde.zonesEtat, data.zones);
  if (data.politique) {
    const pol = MC.Politique.charger(data.politique);
    politique.seed = pol.seed; politique.jour = pol.jour;
    politique.factions = pol.factions; politique.relations = pol.relations; politique.annonces = pol.annonces;
  }
  if (data.guildes) {
    const gu = MC.Guildes.charger(data.guildes);
    guildes.factions = gu.factions; guildes.joueurs = gu.joueurs;
    guildes.invitations = gu.invitations; guildes.prochainId = gu.prochainId;
  }
  return true;
}
function sauvegarderMonde() {
  if (!CONF.mondeFichier) return false;
  try {
    fs.writeFileSync(CONF.mondeFichier, JSON.stringify(etatMonde()));
    return true;
  } catch (e) { journal('échec de la sauvegarde du monde : ' + e.message); return false; }
}
if (CONF.mondeFichier) {
  try {
    if (fs.existsSync(CONF.mondeFichier)) {
      const data = JSON.parse(fs.readFileSync(CONF.mondeFichier, 'utf8'));
      if (appliquerEtatMonde(data)) journal(`monde repris depuis ${CONF.mondeFichier} (heure ${heure.toFixed(1)})`);
      else journal(`fichier de monde illisible ou d'une autre version : ${CONF.mondeFichier} — nouvelle carte`);
    } else {
      journal(`aucune sauvegarde à ${CONF.mondeFichier} — nouvelle carte, créée à la première sauvegarde`);
    }
  } catch (e) { journal('échec de la reprise du monde : ' + e.message); }
  // sauvegarde régulière : toutes les deux minutes par défaut, comme un
  // compromis entre sécurité (peu de perte en cas d'arrêt brutal) et coût
  // disque négligeable. Réglable (MC_SAUVEGARDE_MS) : les tests d'intégration
  // en ont besoin d'un intervalle court pour vérifier la sauvegarde périodique
  // sans attendre deux minutes.
  setInterval(sauvegarderMonde, parseInt(process.env.MC_SAUVEGARDE_MS, 10) || 120000);
}
/* Les habitants des villes et villages proches des joueurs : le serveur les
   fait vivre, comme toutes les créatures. Un habitant tué ne renaît pas. */
const pnjsSuivis = new Map();                 // les morts : monde.pnjsMorts (identifiant → heure)
function peuplerLieux() {
  if (!monde.habitats) return;
  pnjsSuivis.forEach((e, id) => {
    if (entites.list.indexOf(e) >= 0) return;
    if (e.hp <= 0) monde.pnjsMorts.set(id, heure);
    pnjsSuivis.delete(id);
  });
  const lieux = [];
  tousLesJoueurs().forEach(({ js }) => {
    const p = js.joueur.state.pos;
    monde.habitats.lieuxProches(p.x, p.z, 90).forEach(l => { if (lieux.indexOf(l) < 0) lieux.push(l); });
  });
  MC.Habitats.pnjsManquants(lieux, entites.list, monde.pnjsMorts, heure).forEach(p => {
    if (!monde.estCharge(p.x, p.z)) return;
    const e = entites.spawn('villager', p.x, p.y + 0.05, p.z,
                            { pnj: p.id, role: p.role, nom: p.nom, foyer: { x: p.x, z: p.z }, lieu: p.lieu });
    pnjsSuivis.set(p.id, e);
  });
}
/* SPEC-FACTION-006/007/008 : les royaumes et guildes marchandes se découvrent
   au fil des villes/mégapoles explorées par les joueurs (comme les habitants,
   habitats.js ne connaît que ce qui a été chargé) ; la simulation avance d'un
   jour de jeu à la fois, rattrapée d'un coup si le serveur est resté longtemps
   sans public — toujours de façon déterministe (graine + jour). Chaque
   naissance et chaque événement notable (raid, alliance, guerre…) s'annonce
   dans le chat, comme un message système. */
function avancerPolitique() {
  if (monde.habitats) {
    const sites = [];
    tousLesJoueurs().forEach(({ js }) => {
      const p = js.joueur.state.pos;
      monde.habitats.lieuxProches(p.x, p.z, 300).forEach(l => {
        if ((l.kind === 'ville' || l.kind === 'megapole') && !sites.some(s => s.id === l.id)) {
          sites.push({ id: l.id, kind: l.kind, x: l.x, z: l.z, nom: l.nom });
        }
      });
    });
    MC.Politique.decouvrir(politique, sites);
  }
  const jourCourant = Math.floor(heure / MC.DayCycle.DAY_LENGTH);
  if (jourCourant <= politique.jour) return;
  const avant = politique.annonces.length;
  MC.Politique.tourDuMonde(politique, jourCourant);
  politique.annonces.slice(avant).forEach(a => {
    const m = chat.systeme(a.texte);
    if (m) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
  });
}
// sommet de colonne : qui s'abrite échappe à la foudre
function abriServeur(x, z) {
  for (let y = C.WORLD_H - 1; y > 0; y--) {
    const id = monde.getBlock(x, y, z);
    if (!id) continue;
    const d = C.BLOCKS[id];
    if (d && d.plant && !d.aquatique && !C.isLeaves(id)) continue;
    return y;
  }
  return -1;
}

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
  if (c.sessionId) MC.Admin.fermerSession(admin, c.sessionId, heure);
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

// ── console web d'administration : API HTTP (SPEC-ADMIN-001 à 005/007) ─────
/* Le jeton n'est JAMAIS accepté en paramètre d'URL (un lien reste dans
   l'historique, les journaux du proxy, l'onglet ouvert des semaines) :
   uniquement l'en-tête Authorization, comme n'importe quelle API. */
function roleRequete(req) {
  const ent = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(ent);
  if (!m) return null;
  return MC.Admin.authentifier(admin, m[1]);
}
function lireCorpsJSON(req, cb) {
  let brut = '';
  req.on('data', d => { brut += d; if (brut.length > 8192) req.destroy(); });
  req.on('end', () => { try { cb(brut ? JSON.parse(brut) : {}); } catch (e) { cb({}); } });
}
function repondreJSON(res, code, obj) {
  const corps = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(corps) });
  res.end(corps);
}
const RE_API = /^\/admin\/api\/([a-z_]+)\/?$/;
function traiterApiAdmin(req, res) {
  const url = req.url.split('?')[0];
  const mm = RE_API.exec(url);
  if (!mm) return false;
  const action = mm[1];
  const r = roleRequete(req);
  if (!r) { repondreJSON(res, 401, { ok: false, motif: 'non_authentifie' }); return true; }
  if (req.method === 'GET') {
    const q = {};
    new URL(req.url, 'http://localhost').searchParams.forEach((v, k) => { q[k] = v; });
    const res2 = executerActionAdmin(r.role, r.nom || 'console', action, q);
    repondreJSON(res, res2.ok ? 200 : 403, res2);
    return true;
  }
  if (req.method === 'POST') {
    lireCorpsJSON(req, (args) => {
      const res2 = executerActionAdmin(r.role, r.nom || 'console', action, args);
      repondreJSON(res, res2.ok ? 200 : 403, res2);
    });
    return true;
  }
  repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' });
  return true;
}

function servir(req, res) {
  if (req.url.indexOf('/admin/api/') === 0 && traiterApiAdmin(req, res)) return;
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
    rejoint: false, ip: socket.remoteAddress || '?',
    role: null, sessionId: null,             // rôle d'administration (SPEC-ADMIN-006/008)
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
      // liste noire, liste blanche, bannissement, e-mail exigé (SPEC-ADMIN-004)
      const decision = MC.Admin.peutEntrer(admin, { nom: m.nom, email: m.email, invitation: m.invitation }, heure);
      if (!decision.ok) {
        envoyer(c, { t: NP.MSG.REFUS, motif: decision.motif });
        journal(`x ${m.nom} (${c.ip}) refusé — ${decision.motif}`);
        setTimeout(() => fermer(c, 'entree refusee : ' + decision.motif), 50);
        break;
      }
      if ([...clients.values()].filter(x => x.rejoint).length >= CONF.maxJoueurs) {
        envoyer(c, { t: NP.MSG.REFUS, motif: 'serveur_complet' });
        journal(`x ${m.nom} (${c.ip}) refusé — serveur complet (${CONF.maxJoueurs})`);
        setTimeout(() => fermer(c, 'serveur complet'), 50);
        break;
      }
      c.nom = m.nom;
      c.email = m.email || null;
      c.locaux = m.locaux;
      c.rejoint = true;
      c.role = MC.Admin.roleDe(admin, c.nom);           // un modérateur nommé retrouve son rôle en revenant
      c.sessionId = MC.Admin.ouvrirSession(admin, { nom: c.nom, ip: c.ip }, heure);
      c.joueurs = [];
      for (let j = 0; j < c.locaux; j++) c.joueurs.push(creerJoueurServeur(j));
      c.pos = c.joueurs[0].joueur.state.pos;
      // l'état complet du monde modifié, pour que le nouveau venu voie les
      // constructions faites avant son arrivée
      const blocs = [];
      monde.overrides.forEach((id, k) => {
        const p = k.split(',');
        const etat = monde.etatsOverrides ? (monde.etatsOverrides.get(k) || 0) : 0;
        blocs.push([+p[0], +p[1], +p[2], id, etat]);
      });
      envoyer(c, {
        t: NP.MSG.BIENVENUE,
        id: c.id, graine: CONF.graine, mode: CONF.mode, difficulte: CONF.difficulte,
        zone: monde.zonesEtat ? monde.zonesEtat.politique : 'generee',
        heure, blocs,
        // la position qui fait foi, pour chaque joueur local du poste
        toi: c.joueurs.map(js => SY.etatJoueur(js.joueur, 0)),
        tickHz: CONF.tickHz, etatHz: CONF.etatHz,
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
      /* Ancien message : le client imposait sa position. Le serveur fait
         désormais autorité — on n'en retient que le regard. */
      c.yaw = m.yaw; c.pitch = m.pitch;
      break;

    case NP.MSG.ENTREE: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) break;
      js.entrees.push(m);
      // un client qui inonde le serveur perd ses entrées les plus anciennes
      if (js.entrees.length > 240) js.entrees.splice(0, js.entrees.length - 240);
      break;
    }

    case NP.MSG.ATTAQUE: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || js.joueur.state.dead) break;
      const st = js.joueur.state;

      // SPEC-COMBAT-002 : cible un autre JOUEUR plutôt qu'une créature —
      // mêmes portée, cadence et dégâts qu'en PvE, mais soumis au réglage
      // PvP du serveur ET aux règles de zone des deux joueurs.
      if (m.joueurCible) {
        if (js.attaqueCd > 0) break;
        const cible = joueurParCle(m.joueurCible);
        if (!cible || cible.js.joueur.state.dead) break;
        if (cible.c.id === c.id && cible.j === m.j) break;               // pas sur soi-même
        const vst = cible.js.joueur.state;
        const d2 = Math.hypot(vst.pos.x - st.pos.x, vst.pos.y + 0.9 - st.pos.y - 1.6, vst.pos.z - st.pos.z);
        if (d2 > 6) break;
        if (!pvpAutorise(st.pos, vst.pos)) break;
        // deux membres d'une même faction ne se blessent pas (SPEC-FACTION-012)
        if (!MC.Guildes.peutBlesser(guildes, c.nom, cible.c.nom)) break;
        js.attaqueCd = 0.4;
        const avant = vst.dead;
        vst.hurtCd = 0;
        cible.js.joueur.hurt(m.degats);
        // recul, comme pour une créature (entities.damage s'en inspire)
        const dx = vst.pos.x - st.pos.x, dz = vst.pos.z - st.pos.z, dd = Math.hypot(dx, dz) || 1;
        vst.vel.x += (dx / dd) * 5; vst.vel.z += (dz / dd) * 5; vst.vel.y = 4.5;
        MC.Admin.journaliser(admin, { auteur: c.nom, action: 'combat_joueur', cible: cible.c.nom, details: m.degats, heure });
        if (!avant && vst.dead) {
          const msg = chat.systeme(c.nom + ' a vaincu ' + cible.c.nom);
          if (msg) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: msg.texte, type: 'systeme', ts: msg.t });
          journal(`⚔ ${c.nom} a vaincu ${cible.c.nom} (PvP)`);
        }
        break;
      }

      const e = entites.list.find(x => x.eid === m.eid);
      if (!e || e.dead || e.type === 'item') break;
      const d = Math.hypot(e.pos.x - st.pos.x, e.pos.y + e.h / 2 - st.pos.y - 1.6, e.pos.z - st.pos.z);
      // portée et cadence vérifiées : on ne frappe ni de loin ni en rafale
      if (d > 6 || js.attaqueCd > 0) break;
      js.attaqueCd = 0.4;
      entites.damage(e, m.degats, st.pos, st);
      // journal des actions (SPEC-ADMIN-002) : les combats aussi
      MC.Admin.journaliser(admin, { auteur: c.nom, action: 'combat', cible: e.type, details: m.degats, heure });
      break;
    }

    case NP.MSG.TIR: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || js.joueur.state.dead || js.tirCd > 0) break;
      js.tirCd = 0.3;
      const st = js.joueur.state;
      const o = { x: st.pos.x + m.dx * 0.4, y: st.pos.y + 1.62 + m.dy * 0.4, z: st.pos.z + m.dz * 0.4 };
      entites.tirer(o, { x: m.dx, y: m.dy, z: m.dz }, m.vitesse, m.degats, st, m.genre);
      break;
    }

    case NP.MSG.MANGER: {
      const js = c.joueurs && c.joueurs[m.j];
      const d = C.ITEMS[m.id];
      if (!js || !d || !d.food) break;
      const st = js.joueur.state;
      st.hunger = Math.min(20, st.hunger + d.food);
      if (d.soin) js.joueur.heal(d.soin);
      break;
    }

    case NP.MSG.RENAITRE: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || !js.joueur.state.dead) break;
      js.joueur.respawn({ x: SPAWN.x + m.j * 1.2, y: SPAWN.y, z: SPAWN.z });
      js.entrees.length = 0;
      break;
    }

    case NP.MSG.BLOC: {
      /* Le serveur fait autorité : il applique, PUIS diffuse à tous — y
         compris à l'émetteur, dont la prédiction locale est ainsi confirmée
         ou corrigée. */
      const cx = Math.floor(m.x / 16), cz = Math.floor(m.z / 16);
      monde.getChunk(cx, cz, true);
      const avant = monde.getBlock(m.x, m.y, m.z);
      const js = c.joueurs && c.joueurs[m.j];
      if (!blocAutorise(js, m, avant, c)) {
        // refusé : on rappelle au client ce qui s'y trouve vraiment
        envoyer(c, { t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: avant });
        break;
      }
      monde.setBlock(m.x, m.y, m.z, m.id);
      // état du bloc posé (orientation, niveau… — SPEC-SAVE-017) : 0 par
      // défaut, comme un bloc cassé ou sans état particulier
      if (monde.setEtat) monde.setEtat(m.x, m.y, m.z, m.etat || 0);
      // une casse lâche son butin côté serveur : c'est lui qui le distribue
      if (m.id === 0 && avant) {
        const cassure = C.breakTime(avant, m.outil);
        C.dropsOf(avant, cassure.harvests).forEach(d =>
          entites.dropItem(m.x + 0.5, m.y + 0.5, m.z + 0.5, d.id, d.n));
      }
      diffuser({ t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: m.id, etat: m.etat || 0 });
      /* Escalier (SPEC-CONSTR-001) : le serveur fait autorité sur l'angle,
         recalculé ici (même algorithme que le client) plutôt que confié au
         message reçu — pose ou casse peut aussi changer l'angle des 4
         voisins, diffusé séparément à ceux dont l'état a bougé. */
      const bAffecte = (m.id && C.BLOCKS[m.id] && C.BLOCKS[m.id].forme === 'escalier')
        || (C.BLOCKS[avant] && C.BLOCKS[avant].forme === 'escalier');
      if (bAffecte && MC.Formes) {
        const voisins = [[0, 0, 0], [0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
        const avantE = voisins.map(v => monde.getEtat(m.x + v[0], m.y + v[1], m.z + v[2]));
        MC.Formes.actualiserZoneEscalier(monde, m.x, m.y, m.z);
        voisins.forEach((v, i) => {
          const x2 = m.x + v[0], y2 = m.y + v[1], z2 = m.z + v[2];
          const e2 = monde.getEtat(x2, y2, z2);
          if (e2 !== avantE[i]) diffuser({ t: NP.MSG.BLOC, x: x2, y: y2, z: z2, id: monde.getBlock(x2, y2, z2), etat: e2 });
        });
      }
      // journal des actions (SPEC-ADMIN-002) : de quoi rejouer qui a construit ou détruit quoi
      MC.Admin.journaliser(admin, { auteur: c.nom, action: m.id ? 'bloc_pose' : 'bloc_casse',
                                     cible: `${m.x},${m.y},${m.z}`, details: m.id, heure });
      break;
    }

    case NP.MSG.CHAT: {
      /* /faction … : le serveur fait foi sur les factions de joueurs
         (SPEC-FACTION-009 à 013) ; la réponse ne va qu'à l'intéressé, et
         « dire » ne va qu'aux membres de sa faction principale. */
      if (typeof m.texte === 'string' && /^\/faction(\s|$)/.test(m.texte)) {
        const r = MC.Commandes.executer({ nom: 'faction', args: m.texte.trim().split(/\s+/).slice(1) }, {});
        const actions = (r.actions || []).filter(a => a.type === 'faction');
        if (!actions.length) (r.messages || []).forEach(t => envoyer(c, { t: NP.MSG.CHAT, auteur: null, texte: t, type: 'systeme' }));
        actions.forEach(a => {
          const res = MC.Guildes.appliquerAction(guildes, c.nom, a);
          if (res.canal) {
            const membres = new Set(res.canal.membres);
            clients.forEach(cl => { if (cl.rejoint && membres.has(cl.nom)) envoyer(cl, { t: NP.MSG.CHAT, auteur: null, texte: res.message, type: 'faction' }); });
          } else envoyer(c, { t: NP.MSG.CHAT, auteur: null, texte: res.message, type: 'systeme' });
          MC.Admin.journaliser(admin, { auteur: c.nom, action: 'faction', cible: a.action, details: res.ok, heure });
        });
        break;
      }
      const msg = chat.envoyer(c.nom, m.texte);
      if (msg) {
        diffuser({ t: NP.MSG.CHAT, auteur: msg.auteur, texte: msg.texte,
                   type: msg.type, ts: msg.t });
        journal(`<${c.nom}> ${msg.texte}`);
        MC.Admin.journaliser(admin, { auteur: c.nom, action: 'chat', cible: msg.texte, heure });
      }
      break;
    }

    case NP.MSG.ADMIN: {
      traiterAdmin(c, m);
      break;
    }
  }
}

// ── panneau admin en jeu (SPEC-ADMIN-006) ────────────────────────────────────
/* Le client déclare une ACTION ; le serveur ne fait jamais confiance à un rôle
   annoncé par le client — seul `c.role`, attribué PAR le serveur à l'authen-
   tification, décide. Refuser silencieusement (erreur générique) évite de
   confirmer à un tiers curieux qu'un jeton particulier existe. */
function reponseAdmin(c, action, ok, data, erreur) {
  envoyer(c, { t: NP.MSG.ADMIN_REP, action, ok, data: data || null, erreur: erreur || null });
}
function joueursEnLigne() {
  return tousLesJoueurs().map(({ c: cl, js }) => ({
    nom: cl.nom, ip: cl.ip, connecteLe: null,
    x: +js.joueur.state.pos.x.toFixed(1), y: +js.joueur.state.pos.y.toFixed(1), z: +js.joueur.state.pos.z.toFixed(1),
  }));
}
function traiterAdmin(c, m) {
  const Adm = MC.Admin;
  if (m.action === 'auth') {
    const r = Adm.authentifier(admin, m.args && m.args.secret);
    if (!r) { reponseAdmin(c, 'auth', false, null, 'refuse'); return; }
    c.role = r.role;
    if (r.nom) c.nom = c.nom || r.nom;
    if (r.role === Adm.ROLES.ADMIN && c.rejoint) Adm.noterAdminConnu(admin, c.nom);
    reponseAdmin(c, 'auth', true, { role: r.role });
    journal(`+ ${c.nom} (#${c.id}) authentifie en ${r.role}`);
    return;
  }
  if (!c.role) { reponseAdmin(c, m.action, false, null, 'non_authentifie'); return; }
  const r = executerActionAdmin(c.role, c.nom, m.action, m.args || {});
  reponseAdmin(c, m.action, r.ok, r.ok ? r.data : null, r.ok ? null : r.motif);
}

/* Cœur commun au panneau en jeu (WebSocket) ET à la console web (HTTP) : les
   deux ne doivent JAMAIS diverger sur qui a le droit de faire quoi — d'où un
   seul endroit qui décide, appelé par les deux façades. */
function executerActionAdmin(role, nomActeur, action, args) {
  const Adm = MC.Admin;
  args = args || {};
  const roleCible = args.nom ? Adm.roleDe(admin, args.nom) : null;
  if (!Adm.peutAgir(role, action, roleCible)) return { ok: false, motif: 'refuse' };

  switch (action) {
    case 'mesures': return { ok: true, data: statsMesures() };
    case 'joueurs': return { ok: true, data: Adm.vueJoueurs(admin, joueursEnLigne(), role) };
    case 'sessions': return { ok: true, data: Adm.vueSessions(admin, args.nom, role) };
    case 'listes': return { ok: true, data: Adm.vueListes(admin, role) };
    case 'journal': return { ok: true, data: Adm.vueJournal(admin, role, args.limite) };
    case 'inventaire': {
      const cible = [...clients.values()].find(x => x.nom === args.nom);
      const inv = cible && cible.joueurs && cible.joueurs[0] ? cible.joueurs[0].joueur.state.inv.serialize() : [];
      return { ok: true, data: inv };
    }
    case 'liste_ajouter':
      return { ok: true, data: Adm.ajouterListe(admin, args.liste, args.categorie, args.valeur, nomActeur, heure) };
    case 'liste_retirer':
      return { ok: true, data: Adm.retirerListe(admin, args.liste, args.categorie, args.valeur, nomActeur, heure) };
    case 'invitation_creer':
      return { ok: true, data: Adm.creerInvitation(admin, args, nomActeur, heure) };
    case 'invitation_revoquer':
      return { ok: true, data: Adm.revoquerInvitation(admin, args.token, nomActeur, heure) };
    case 'role_nommer':
      return { ok: true, data: Adm.nommerRole(admin, args.nom, args.role || null, nomActeur, heure) };
    case 'zone_definir': {
      // SPEC-ZONE-004 / SPEC-ADMIN-006 : un administrateur redéfinit la zone
      // de la région où se trouve le point (x, z) donné.
      const r = MC.Zones.definirRegion(monde.zonesEtat, +args.x || 0, +args.z || 0, args.zone, nomActeur, heure);
      if (r.ok) MC.Admin.journaliser(admin, { auteur: nomActeur, action: 'zone_definie', cible: r.region, details: r.zone, heure });
      return { ok: true, data: r };
    }
    case 'zone_retirer': {
      const r = MC.Zones.retirerRegion(monde.zonesEtat, +args.x || 0, +args.z || 0);
      if (r.ok) MC.Admin.journaliser(admin, { auteur: nomActeur, action: 'zone_retiree', cible: null, heure });
      return { ok: true, data: r };
    }
    case 'sanction': {
      const res = Adm.sanctionner(admin, { nom: args.nom, type: args.type, dureeMs: args.dureeMs, auteur: nomActeur }, heure);
      if (res.ok && (args.type === 'expulser' || args.type === 'bannir')) {
        const cible = [...clients.values()].find(x => x.nom === args.nom);
        if (cible) fermer(cible, 'sanction : ' + args.type);
      }
      return { ok: true, data: res };
    }
    default: return { ok: false, motif: 'action_inconnue' };
  }
}

// ── joueurs simulés ──────────────────────────────────────────────────────────
/* Un joueur du serveur : le MÊME code que celui du client (player.js), piloté
   par les entrées reçues. C'est lui qui fait foi sur la position et les
   statistiques (vie, faim, air, mort). */
function creerJoueurServeur(j) {
  const joueur = MC.createPlayer(monde, entites, regles);
  joueur.state.pos.x = SPAWN.x + j * 1.2; joueur.state.pos.y = SPAWN.y; joueur.state.pos.z = SPAWN.z;
  return { joueur, entrees: [], dernier: 0, budget: SY.creerBudget(), attaqueCd: 0, tirCd: 0 };
}
const PORTEE_BLOC = 7;
function blocAutorise(js, m, avant, c) {
  if (!js || js.joueur.state.dead) return false;
  const st = js.joueur.state;
  const d = Math.hypot(m.x + 0.5 - st.pos.x, m.y + 0.5 - st.pos.y - 1.62, m.z + 0.5 - st.pos.z);
  if (d > PORTEE_BLOC) return false;                      // hors de portée
  if (m.id === 0) {
    const def = C.BLOCKS[avant];
    if (!def || def.hardness < 0) return false;            // ni le socle ni l'eau
    if (def.circuit && def.circuit.adminSeul) return blocCommandeAutorise(c);
    return true;
  }
  // on ne pose que dans une case libre (air, eau, plante)
  if (!C.isReplaceable(avant)) return false;
  const posee = C.BLOCKS[m.id];
  if (posee && posee.circuit && posee.circuit.adminSeul) return blocCommandeAutorise(c);
  return true;
}
/* SPEC-MECA-007 : poser ou casser un bloc de commande — en ligne, réservé à
   un administrateur (le serveur fait toujours autorité, jamais le mode local
   du client, qui ne veut rien dire une fois connecté). */
function blocCommandeAutorise(c) {
  return !!(MC.Circuits && MC.Circuits.commandeAutorisee({ enLigne: true, role: c && c.role }));
}
function tousLesJoueurs() {
  const l = [];
  clients.forEach(c => { if (c.rejoint && c.joueurs) c.joueurs.forEach((js, j) => l.push({ c, j, js })); });
  return l;
}

/* SPEC-COMBAT-002 : le PvP n'est permis que si le serveur l'autorise
   (--pvp, désactivé par défaut) ET si la zone des DEUX joueurs le permet
   (SPEC-ZONE-001) — un joueur réfugié en zone sûre reste protégé même si
   son agresseur, lui, se tient en zone PvP. */
function pvpAutorise(posA, posB) {
  return !!CONF.pvp && (!MC.Zones || MC.Zones.pvpAutorise(monde.zones, monde.zonesEtat, posA, posB));
}
// un identifiant stable pour désigner un joueur cible dans un message ATTAQUE
function cleJoueur(id, j) { return id + '/' + (j || 0); }
function joueurParCle(cle) {
  const p = String(cle).split('/');
  const id = +p[0], j = +p[1] || 0;
  return tousLesJoueurs().find(x => x.c.id === id && x.j === j) || null;
}

// ── instrumentation de performance (SPEC-SERVEUR-002) ───────────────────────
/* Coût quasi nul quand désactivée (une lecture d'env au démarrage, un `if`
   par tic) : le banc de charge l'active via MC_MESURES=1, une exploitation
   normale ne le fait jamais. Les échantillons vivent en mémoire seulement —
   10 s d'historique à 60 Hz suffisent pour une moyenne et un 95e centile
   représentatifs sans faire grossir le processus. */
const MESURES_ACTIVES = process.env.MC_MESURES === '1';
const MESURES_MAX_ECH = 600;
const mesuresTicks = [];
function enregistrerTic(ms) {
  mesuresTicks.push(ms);
  if (mesuresTicks.length > MESURES_MAX_ECH) mesuresTicks.shift();
}
function statsMesures() {
  if (!MESURES_ACTIVES) return { actif: false };
  if (!mesuresTicks.length) return { actif: true, echantillons: 0 };
  const tri = mesuresTicks.slice().sort((a, b) => a - b);
  const somme = tri.reduce((a, b) => a + b, 0);
  const idxP95 = Math.min(tri.length - 1, Math.floor(tri.length * 0.95));
  const mem = process.memoryUsage();
  return {
    actif: true,
    echantillons: tri.length,
    tickMoyenMs: +(somme / tri.length).toFixed(3),
    tickP95Ms: +tri[idxP95].toFixed(3),
    memoireRssMo: +(mem.rss / 1048576).toFixed(2),
    memoireHeapMo: +(mem.heapUsed / 1048576).toFixed(2),
    joueurs: [...clients.values()].filter(c => c.rejoint).length,
  };
}

// ── boucle de simulation ─────────────────────────────────────────────────────
const { performance } = require('perf_hooks');
let dernier = performance.now();
let accEtat = 0;
let accSpawn = 0;
let accChunks = 1;         // premier passage immédiat

function joueurReference() {
  for (const c of clients.values()) if (c.rejoint) return { pos: c.pos };
  return { pos: SPAWN };
}

/* Sous Windows, un minuteur de 16,7 ms est souvent arrondi à 31 ms : la
   simulation tombait à 30-40 Hz. On sonde donc plus souvent (au rythme réel
   de l horloge système) et l on ne fait un pas que lorsque sa période est
   écoulée — la cadence visée est tenue, sans boucle active qui brûlerait le CPU. */
const PERIODE_TICK = 1000 / CONF.tickHz;
setInterval(() => {
  const now = performance.now();
  if (now - dernier < PERIODE_TICK * 0.9) return;
  const dt = Math.min((now - dernier) / 1000, 0.25);
  dernier = now;
  const __t0 = MESURES_ACTIVES ? performance.now() : 0;

  heure += dt;
  // circuits : diffusé explicitement plus bas (comme l'eau), donc désactivé ici
  monde.tick(dt, 14, null, { temps: heure, circuits: false });

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
    peuplerLieux();
    avancerPolitique();
  }
  // l'eau coule : le serveur, qui fait foi sur les blocs, diffuse chaque changement
  accEau += dt;
  if (accEau >= 0.25) {
    accEau = 0;
    monde.coulerEau(96).forEach(ch => diffuser({ t: NP.MSG.BLOC, x: ch[0], y: ch[1], z: ch[2], id: ch[3] }));
  }
  // L29 mécanismes (SPEC-MECA-008) : le serveur fait foi, et diffuse chaque
  // changement — un bloc dont seul l'état a changé (une lampe, un compteur…)
  // garde son id, le client applique l'état comme pour tout bloc posé.
  accCircuits += dt;
  if (accCircuits >= 0.2) {
    accCircuits = 0;
    monde.tickCircuits({ temps: heure }).forEach(ch => diffuser({
      t: NP.MSG.BLOC, x: ch.x, y: ch.y, z: ch.z,
      id: ch.setBlock !== undefined ? ch.setBlock : monde.getBlock(ch.x, ch.y, ch.z),
      etat: ch.setEtat !== undefined ? ch.setEtat : (monde.getEtat(ch.x, ch.y, ch.z) || 0),
    }));
  }

  /* Chaque joueur avance selon SES entrées, dans la limite du temps écoulé :
     c'est le serveur qui décide de la position et des statistiques. */
  const joueurs = tousLesJoueurs();
  joueurs.forEach(({ js }) => {
    js.budget.crediter(dt);
    js.attaqueCd = Math.max(0, js.attaqueCd - dt);
    js.tirCd = Math.max(0, js.tirCd - dt);
    const st = js.joueur.state;
    while (js.entrees.length && !st.dead && js.budget.consommer(js.entrees[0].dt)) {
      const e = js.entrees.shift();
      SY.rejouer(js.joueur, [e]);
      js.joueur.updateSurvival(e.dt);
      js.dernier = e.s;
    }
    // des entrées trop longues ou trop nombreuses pour le temps écoulé : écartées
    while (js.entrees.length && js.entrees[0].dt > SY.DT_MAX) js.entrees.shift();
    /* Le climat agit sur le corps : c'est au serveur, qui fait foi sur la
       vie et la faim, d'appliquer froid et chaleur. Température réévaluée
       deux fois par seconde, comme chez le client. */
    if (monde.meteo && !st.dead) {
      js.tempT = (js.tempT || 0) - dt;
      if (js.tempT <= 0 || !js.temperature) {
        js.tempT = 0.5;
        js.temperature = monde.meteo.temperatureEn(monde, st.pos, heure);
      }
      js.joueur.subirClimat(dt, js.temperature.temperature);
    }
  });

  /* La foudre : mêmes éclairs, aux mêmes instants et aux mêmes lieux que
     chez les clients (la météo est une fonction de la graine et de l'heure) ;
     le serveur seul en tire les dégâts. */
  if (monde.meteo && joueurs.length) {
    if (meteoT === null || heure < meteoT || heure - meteoT > 5) meteoT = heure;
    const l = monde.meteo.eclairs(meteoT, heure);
    meteoT = heure;
    l.forEach(e => {
      joueurs.forEach(({ js }) => {
        const st = js.joueur.state;
        const lieu = monde.meteo.lieuEclair(e, st.pos.x, st.pos.z);
        if (!st.dead && monde.meteo.foudroie(lieu, st.pos, abriServeur)) js.joueur.hurt(monde.meteo.DEGATS_FOUDRE);
        entites.list.forEach(en => {
          if (en.kind !== 'item' && en.pos && monde.meteo.foudroie(lieu, en.pos, abriServeur)) entites.damage(en, 8, null, null);
        });
      });
    });
  }

  const etats = joueurs.map(x => x.js.joueur.state);
  const ref = joueurs.length ? { pos: joueurs[0].js.joueur.state.pos } : joueurReference();
  const ev = entites.update(dt, ref, { joueurs: etats.length ? etats : [ref],
    hiver: MC.DayCycle.saison(heure).nom === 'hiver', pvpOk: pvpAutorise });
  // les coups des créatures, appliqués aux joueurs qu'ils visaient
  ev.degatsPar.forEach(d => {
    const x = joueurs.find(y => y.js.joueur.state === d.joueur);
    if (x) x.js.joueur.hurt(Math.round(d.n * (regles.degatsMob || 1)));
  });
  // le butin ramassé part au client du joueur qui l'a pris
  ev.picked.forEach(p => {
    const x = joueurs.find(y => y.js.joueur.state === p.joueur);
    if (x) envoyer(x.c, { t: NP.MSG.DONNE, j: x.j, id: p.id, n: p.n });
  });
  entites.mergeItems();

  accSpawn += dt;
  if (accSpawn >= 3.5) {
    accSpawn = 0;
    if (clients.size > 0) {
      entites.trySpawn(ref, MC.DayCycle.isNight(heure), null,
                       MC.Modes.plafondsEntites(regles));
      entites.trySpawnSouterrain(ref, null, MC.Modes.plafondsEntites(regles));
      if (!MC.DayCycle.isNight(heure)) entites.burnUndead(false);
    }
  }

  /* Diffusion d'état à cadence réduite : simuler à 20 Hz et n'envoyer qu'à
     10 Hz divise le trafic par deux sans que l'on voie la différence, les
     clients interpolant entre deux relevés. */
  /* On garde le reliquat plutôt que de remettre à zéro : avec une horloge
     qui bat à ~15,6 ms (Windows), une image sur deux tombait juste sous la
     période et sautait son envoi — 30 états par seconde au lieu de 60. La
     petite tolérance absorbe la gigue du minuteur. */
  accEtat += dt;
  const periodeEtat = 1 / CONF.etatHz;
  if (accEtat >= periodeEtat * 0.9) {
    accEtat = Math.min(periodeEtat, Math.max(0, accEtat - periodeEtat));
    if (clients.size > 0) {
      const js = tousLesJoueurs().map(({ c, j, js: x }) => {
        const st = x.joueur.state;
        return { id: c.id, j, nom: c.nom, x: +st.pos.x.toFixed(2), y: +st.pos.y.toFixed(2),
                 z: +st.pos.z.toFixed(2), yaw: +st.yaw.toFixed(2), mort: st.dead ? 1 : 0 };
      });
      // créatures, objets au sol et projectiles : tout ce qui vit dans le monde
      const decrire = e => {
        const o = { e: e.eid, t: e.type, x: +e.pos.x.toFixed(2), y: +e.pos.y.toFixed(2),
                    z: +e.pos.z.toFixed(2), yaw: +(e.yaw || 0).toFixed(2) };
        if (e.type === 'item') o.i = e.item;
        if (e.genre) o.g = e.genre;
        if (e.arme) o.a = e.arme;
        if (e.variante !== undefined) o.v = e.variante;
        if (e.role) { o.r = e.role; o.n = e.nom; }
        return o;
      };
      const commun = { t: NP.MSG.ETAT, joueurs: [], mobs: [], heure: +heure.toFixed(1) };
      clients.forEach(c => {
        if (!c.rejoint || !c.joueurs) return;
        /* À chacun les créatures les plus proches de SES joueurs : avec les
           habitants des villes, les 80 premières de la liste pouvaient être
           à l'autre bout du monde. */
        const pos = c.joueurs.map(x => x.joueur.state.pos);
        const d2 = e => Math.min.apply(null, pos.map(p => (e.pos.x - p.x) ** 2 + (e.pos.z - p.z) ** 2));
        commun.mobs = entites.list.filter(e => d2(e) < 96 * 96).sort((a, b) => d2(a) - d2(b)).slice(0, 80).map(decrire);
        /* Les AUTRES joueurs, bornés à la même portée que les créatures : sans
           ce filtre, chaque diffusion d'état grandissait en O(joueurs²) — une
           liste complète envoyée à CHAQUE client. Invisible jusqu'à quelques
           dizaines de joueurs, ça sature le réseau bien avant que la
           simulation elle-même ne peine (identifié au banc de charge,
           SPEC-SERVEUR-002 — chiffres avant/après dans docs/charge.md). */
        commun.joueurs = js.filter(j => d2({ pos: { x: j.x, z: j.z } }) < 96 * 96);
        commun.toi = c.joueurs.map(x => SY.etatJoueur(x.joueur, x.dernier));
        envoyer(c, commun);
      });
    }
  }
  if (MESURES_ACTIVES) enregistrerTic(performance.now() - __t0);
}, 4);

// ── ouverture automatique du navigateur (SPEC-PACK-001) ─────────────────────
/* « Lancé sans paramètre, il ouvre le jeu dans le navigateur » : uniquement
   quand AUCUN paramètre n'a été donné (pas même --port), pour ne jamais
   surprendre un usage scripté ou les tests, qui passent toujours au moins
   --port. Best-effort : sans environnement graphique, on l'ignore. */
function ouvrirNavigateur(url) {
  try {
    const { spawn } = require('child_process');
    let cmd, args;
    if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', url]; }
    else if (process.platform === 'darwin') { cmd = 'open'; args = [url]; }
    else { cmd = 'xdg-open'; args = [url]; }
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch (e) { journal('navigateur non ouvert automatiquement : ' + e.message); }
}

// ── démarrage ────────────────────────────────────────────────────────────────
serveur.listen(PORT, () => {
  journal(`MiniCraft — serveur sur http://localhost:${PORT}`);
  journal(`graine ${CONF.graine} · mode ${CONF.mode} · difficulté ${CONF.difficulte}`);
  journal(`simulation ${CONF.tickHz} Hz · diffusion d'état ${CONF.etatHz} Hz`);
  if (SANS_PARAMETRE && !CONF.serveurSeul) {
    journal('ouverture du navigateur…');
    ouvrirNavigateur(`http://localhost:${PORT}`);
  }
});

/* SIGINT (Ctrl+C) ET SIGTERM (arrêt par un gestionnaire de services) doivent
   tous deux sauvegarder : un serveur seul persistant tourne typiquement sous
   un tel gestionnaire, qui n'envoie jamais SIGINT. */
function arreter(signal) {
  journal(`arrêt demandé (${signal})`);
  if (CONF.mondeFichier) {
    const ok = sauvegarderMonde();
    journal(ok ? `monde sauvegardé dans ${CONF.mondeFichier}` : 'sauvegarde finale échouée');
  }
  clients.forEach(c => { try { c.socket.destroy(); } catch (e) {} });
  serveur.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', () => arreter('SIGINT'));
process.on('SIGTERM', () => arreter('SIGTERM'));

module.exports = { serveur, cheminSur, CONF, admin, ADMIN_SECRET, sauvegarderMonde, appliquerEtatMonde, etatMonde };
