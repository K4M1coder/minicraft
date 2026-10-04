/* mesure-recul.js — banc du « retour en arrière » en marchant (rubber-banding).

   Lance un VRAI server.js (d'un arbre quelconque : `--racine`, ce qui permet
   de mesurer un clone jetable d'un tag ou d'un commit de bissection), y
   connecte un client ÉMULÉ avec les modules de CET arbre (monde, joueur,
   MC.Synchro : la prédiction et la réconciliation de src/game.js), et le fait
   marcher selon un parcours fixe (avant, pas de côté, course, sauts, recul,
   virages) pendant `--duree` secondes, image par image au rythme réel.

   À chaque ETAT reçu il relève :
   - la correction : position prédite avant / après réconciliation (vecteur,
     norme) et son « recul » = composante opposée à la direction du mouvement ;
   - la divergence au point acquitté : position du serveur pour l'entrée `s`
     contre la position que le client avait prédite après cette MÊME entrée
     (indépendant du rejeu : c'est l'écart prédiction/serveur pur) ;
   - le retard d'entrées : entrées envoyées non acquittées (nombre, secondes) ;
   et, par le préchargement tools/mesure-recul-preload.js, les tics du
   serveur (écart réel, temps perdu au plafond de 0,25 s).

   Conditions : `--charge N` lance N boucles CPU Node en parallèle ;
   `--blocage 2000:500` bloque le tic serveur 500 ms toutes les 2 s.

   Usage : node tools/mesure-recul.js [--racine DIR] [--duree 30] [--charge N]
           [--blocage P:D] [--json] [--graine N] [--prechargement R] [--journal F]
   Module : require('./mesure-recul.js').mesurer(opts) → résumé. */
'use strict';
const net = require('net');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const vm = require('vm');
const { spawn } = require('child_process');
const { performance } = require('perf_hooks');

const dodo = (ms) => new Promise(r => setTimeout(r, ms));
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function chargerModules(racine) {
  const src = fs.readFileSync(path.join(racine, 'server.js'), 'utf8');
  const bloc = /const MODULES = \[([\s\S]*?)\];/.exec(src)[1];
  const noms = [];
  bloc.replace(/'([^']+)'/g, (_, n) => { noms.push(n); return ''; });
  const c = vm.createContext(Object.assign(Object.create(null), {
    console: { log() {}, info() {}, warn() {}, error() {}, debug() {} }, Math, JSON, Date, Error, Number, String, Array, Object, Boolean,
    Map, Set, Uint8Array, Uint16Array, Int8Array, Float32Array, isNaN, isFinite, parseInt, parseFloat,
  }));
  c.globalThis = c;
  noms.forEach(m => vm.runInContext(fs.readFileSync(path.join(racine, 'src', m + '.js'), 'utf8'), c, { filename: m + '.js' }));
  return c.MC;
}

// ── client WebSocket minimal (indépendant de la version mesurée) ────────────
function connecter(port) {
  return new Promise((resolve, reject) => {
    const cle = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.setNoDelay(true);            // comme un navigateur
      sock.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + cle + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    let tampon = Buffer.alloc(0), etabli = false;
    const client = {
      surMessage: null, attentes: [],
      envoyer(obj) {
        const charge = Buffer.from(JSON.stringify(obj), 'utf8'), n = charge.length, m = crypto.randomBytes(4);
        const ent = n < 126 ? 2 : (n < 65536 ? 4 : 10);
        const buf = Buffer.alloc(ent + 4 + n);
        buf[0] = 0x81;
        if (n < 126) buf[1] = 0x80 | n;
        else if (n < 65536) { buf[1] = 0x80 | 126; buf.writeUInt16BE(n, 2); }
        else { buf[1] = 0x80 | 127; buf.writeBigUInt64BE(BigInt(n), 2); }
        m.copy(buf, ent);
        for (let i = 0; i < n; i++) buf[ent + 4 + i] = charge[i] ^ m[i % 4];
        try { sock.write(buf); } catch (e) { /* fermé */ }
      },
      attendre(type, ms) {
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('délai dépassé pour ' + type)), ms || 8000);
          client.attentes.push({ type, res: (m) => { clearTimeout(t); res(m); } });
        });
      },
      fermer() { try { sock.destroy(); } catch (e) { /* déjà */ } },
    };
    sock.on('data', (bloc) => {
      tampon = Buffer.concat([tampon, bloc]);
      if (!etabli) {
        const i = tampon.indexOf('\r\n\r\n');
        if (i < 0) return;
        const ent = tampon.slice(0, i).toString();
        if (!/ 101 /.test(ent.split('\r\n')[0]) || !ent.includes(crypto.createHash('sha1').update(cle + GUID).digest('base64'))) {
          sock.destroy(); reject(new Error('poignée de main refusée : ' + ent.split('\r\n')[0])); return;
        }
        etabli = true; tampon = tampon.slice(i + 4); resolve(client);
      }
      for (;;) {
        if (tampon.length < 2) break;
        const op = tampon[0] & 0x0f;
        let n = tampon[1] & 0x7f, off = 2;
        if (n === 126) { if (tampon.length < 4) break; n = tampon.readUInt16BE(2); off = 4; }
        else if (n === 127) { if (tampon.length < 10) break; n = Number(tampon.readBigUInt64BE(2)); off = 10; }
        if (tampon.length < off + n) break;
        const charge = tampon.slice(off, off + n);
        tampon = tampon.slice(off + n);
        if (op !== 1) continue;
        let msg; try { msg = JSON.parse(charge.toString('utf8')); } catch (e) { continue; }
        if (client.surMessage) client.surMessage(msg);
        for (let k = client.attentes.length - 1; k >= 0; k--) {
          if (client.attentes[k].type === msg.t) { client.attentes[k].res(msg); client.attentes.splice(k, 1); }
        }
      }
    });
    sock.on('error', (e) => { if (!etabli) reject(e); });
  });
}

function portLibre() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
}

async function lancerServeur(racine, port, env, args) {
  const proc = spawn(process.execPath, ['-r', path.join(__dirname, 'mesure-recul-preload.js'), path.join(racine, 'server.js'), '--port', String(port)].concat(args || []),
    { cwd: racine, stdio: ['ignore', 'pipe', 'pipe'], env });
  const logs = [];
  let vivant = true;
  proc.stdout.on('data', d => logs.push(String(d)));
  proc.stderr.on('data', d => logs.push('ERR ' + String(d)));
  const sortie = new Promise(r => proc.on('exit', (code) => { vivant = false; r(code); }));
  const fin = Date.now() + 60000;
  for (;;) {
    if (!vivant) throw new Error('serveur arrêté au démarrage : ' + logs.join('').slice(-600));
    const ok = await new Promise(r => { const s = net.connect(port, '127.0.0.1', () => { s.destroy(); r(true); }); s.on('error', () => r(false)); });
    if (ok) break;
    if (Date.now() > fin) { proc.kill(); throw new Error('démarrage trop long'); }
    await dodo(100);
  }
  return {
    proc, logs,
    async arreter() {
      if (!vivant) return;
      try { proc.kill(); } catch (e) { /* déjà */ }
      await Promise.race([sortie, dodo(3000)]);
      if (vivant) { try { process.kill(proc.pid, 'SIGKILL'); } catch (e) { /* déjà */ } await Promise.race([sortie, dodo(2000)]); }
    },
  };
}

/* Charge CPU : N processus Node en boucle active, arrêtés avec le banc. */
function lancerCharge(n) {
  const procs = [];
  for (let i = 0; i < n; i++) {
    procs.push(spawn(process.execPath, ['-e', 'const p=' + process.pid + ';setInterval(()=>{try{process.kill(p,0)}catch(e){process.exit(0)}},1000).unref();' +
      'function b(){const f=Date.now()+50;while(Date.now()<f){}setImmediate(b)}b()'], { stdio: 'ignore' }));
  }
  return { arreter() { procs.forEach(p => { try { p.kill(); } catch (e) { /* déjà */ } }); } };
}

/* Parcours fixe, fonction du temps écoulé (s) : touches et regard. */
function parcours(t, yaw0) {
  const k = { forward: 0, back: 0, left: 0, right: 0, jump: 0, sprint: 0 };
  let yaw = yaw0, nom;
  const c = t % 30;
  if (c < 5) { nom = 'avant'; k.forward = 1; }
  else if (c < 8) { nom = 'côté'; k.right = 1; }
  else if (c < 13) { nom = 'course+virage'; k.forward = 1; k.sprint = 1; yaw = yaw0 + (c - 8) * 0.3; }
  else if (c < 17) { nom = 'avant+sauts'; k.forward = 1; k.jump = 1; yaw = yaw0 + 1.5; }
  else if (c < 20) { nom = 'arrière'; k.back = 1; yaw = yaw0 + 1.5; }
  else if (c < 25) { nom = 'course+sauts+virage'; k.forward = 1; k.sprint = 1; k.jump = 1; yaw = yaw0 + 1.5 - (c - 20) * 0.4; }
  else { nom = 'diagonale'; k.forward = 1; k.left = 1; yaw = yaw0 - 0.5; }
  return { k, yaw, nom };
}

function centile(l, p) { if (!l.length) return 0; const s = l.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }

async function mesurer(o) {
  o = Object.assign({ racine: path.join(__dirname, '..'), prechargement: 6, duree: 30, charge: 0, blocage: '', graine: 20260921, seuil: 0.01, journal: null }, o || {});
  const racine = path.resolve(o.racine);
  const MC = chargerModules(racine);
  const SY = MC.Synchro;
  const port = await portLibre();
  const fichierStats = path.join(os.tmpdir(), 'mesure-recul-' + process.pid + '-' + port + '.json');
  const env = Object.assign({}, process.env, {
    MESURE_SORTIE: fichierStats, MESURE_BLOCAGE: o.blocage || '', MC_GRAINE: String(o.graine), MC_MODE: 'survie',
    MC_DIFFICULTE: 'paisible', MC_TEST_ARRET_SI_MORT: String(process.pid), MC_SAUVEGARDE_MS: '3600000',
    MC_JOURNAL_DOSSIER: path.join(os.tmpdir(), 'mesure-recul-logs-' + process.pid + '-' + port),   // supprimé à la fin
  });
  /* Le monde du serveur jetable va dans un dossier temporaire, jamais dans
     parties/ de l'arbre mesuré. Seuls les arbres antérieurs à --dossier-parties
     (avant L50) ne l'acceptent pas : un paramètre inconnu y arrêterait le
     serveur ; ils écrivent alors dans leur propre parties/ (clone jetable). */
  const dossierParties = path.join(os.tmpdir(), 'mesure-recul-parties-' + process.pid + '-' + port);
  let args = [];
  let accepte = false;
  try { accepte = /dossier-parties/.test(fs.readFileSync(path.join(racine, 'src', 'parametres.js'), 'utf8')); } catch (e) { /* ancien arbre */ }
  if (accepte) args = ['--dossier-parties', dossierParties];
  else if (path.resolve(racine) === path.resolve(__dirname, '..')) throw new Error('cet arbre ne connaît pas --dossier-parties : refus d\'écrire dans ses parties/');
  const charge = o.charge > 0 ? lancerCharge(o.charge) : null;
  const srv = await lancerServeur(racine, port, env, args);
  let cl = null, iv = null;
  try {
    cl = await connecter(port);
    const NP = MC.NetProtocol;
    const pBienvenue = cl.attendre(NP.MSG.BIENVENUE, 30000);
    cl.envoyer({ t: NP.MSG.REJOINDRE, nom: 'Marcheur', locaux: 1 });
    const bienvenue = await pBienvenue;
    const t0 = bienvenue.toi[0];
    const monde = MC.createWorld(bienvenue.graine);
    const charger = (x, z, r) => {
      const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) monde.getChunk(cx + dx, cz + dz, true);
    };
    /* Le jeu génère ses chunks dans des workers : son image ne s'allonge pas
       quand il en faut de nouveaux. Ici on génère d'avance tout le terrain du
       parcours (6 chunks de rayon ≈ 96 blocs), pour que les images du client
       émulé ne s'allongent qu'à cause de la machine, comme dans le jeu. */
    charger(t0.x, t0.z, o.prechargement);
    const regles = MC.Modes && MC.Modes.regles ? MC.Modes.regles(bienvenue.mode, bienvenue.difficulte) : undefined;
    const pl = MC.createPlayer(monde, MC.createEntities(monde), regles);
    const st = pl.state;
    const pred = SY.creerPrediction();
    SY.reconcilier(pl, t0, pred, null);
    const yaw0 = typeof t0.yaw === 'number' ? t0.yaw : 0;

    const hist = new Map();                     // s → position prédite juste après l'entrée s
    const releves = [];                         // un par ETAT avec toi
    let mesure = false, tDebut = 0, phase = '', heurePrec = null;
    const dtHeure = [];
    cl.surMessage = (m) => {
      if (m.t !== NP.MSG.ETAT || !m.toi || !m.toi[0]) return;
      const e = m.toi[0];
      if (typeof m.heure === 'number') { if (heurePrec !== null && mesure) dtHeure.push(m.heure - heurePrec); heurePrec = m.heure; }
      const avant = { x: st.pos.x, y: st.pos.y, z: st.pos.z };
      const vh = Math.hypot(st.vel.x, st.vel.z);
      const dir = vh > 0.5 ? { x: st.vel.x / vh, z: st.vel.z / vh } : null;
      const envoye = pred.suivant - 1;
      const h = hist.get(e.s);
      if (SY.appliquerStats) SY.appliquerStats(st, e);
      SY.reconcilier(pl, e, pred, null);
      const d = { x: st.pos.x - avant.x, y: st.pos.y - avant.y, z: st.pos.z - avant.z };
      const n = Math.hypot(d.x, d.y, d.z);
      for (const s of hist.keys()) { if (s < e.s - 5) hist.delete(s); else break; }
      if (!mesure) return;
      const enAttenteS = pred.enAttente.reduce((a, x) => a + x.dt, 0);
      releves.push({
        t: +((performance.now() - tDebut) / 1000).toFixed(3), phase,
        dx: d.x, dy: d.y, dz: d.z, n, recul: dir ? -(d.x * dir.x + d.z * dir.z) : 0,
        div: h ? Math.hypot(e.x - h.x, e.y - h.y, e.z - h.z) : null,
        retard: envoye - e.s, retardS: enAttenteS,
      });
    };

    // une seconde immobile pour que tout se pose, puis le parcours
    let derniere = performance.now();
    let touches = SY.decoderTouches(0), yawCible = yaw0;
    let tFrames = [], maxFrame = 0;
    iv = setInterval(() => {
      const now = performance.now();
      const reel = (now - derniere) / 1000;
      const dt = Math.min(reel, 0.05);           // comme frame() de game.js
      derniere = now;
      if (!(dt > 0)) return;
      if (mesure) { if (reel > maxFrame) maxFrame = reel; tFrames.push(reel); }
      if (mesure) { const p = parcours((now - tDebut) / 1000, yaw0); touches = p.k; yawCible = p.yaw; phase = p.nom; }
      st.yaw = yawCible; st.pitch = 0;
      charger(st.pos.x, st.pos.z, 2);           // le client a toujours son terrain proche (workers dans le jeu)
      const en = pred.enregistrer(dt, touches, st.yaw, st.pitch, st.flying);
      cl.envoyer({ t: NP.MSG.ENTREE, s: en.s, j: 0, dt: en.dt, k: en.k, yaw: en.yaw, pitch: en.pitch, v: en.v });
      SY.rejouer(pl, [en]);
      hist.set(en.s, { x: st.pos.x, y: st.pos.y, z: st.pos.z });
    }, 16);
    await dodo(1500);
    const depart = { x: st.pos.x, y: st.pos.y, z: st.pos.z };
    tDebut = performance.now(); mesure = true;
    const dateDebut = Date.now();
    await dodo(o.duree * 1000);
    mesure = false;
    const dateFin = Date.now();
    clearInterval(iv); iv = null;
    let stats = null;
    await dodo(600);
    try { stats = JSON.parse(fs.readFileSync(fichierStats, 'utf8')); } catch (e) { stats = null; }
    /* Le préchargement reconnaît la boucle de simulation à son texte (/dernier/ et
       /0\.25/). Si server.js change de forme, il ne l'enveloppe plus : sans tics
       relevés ni blocage injecté, la mesure serait fausse — on le dit clairement. */
    if (!stats || !stats.enveloppe) {
      throw new Error('mesure-recul : boucle de simulation de server.js introuvable par le préchargement (motifs /dernier/ et /0\\.25/ dans le corps du setInterval) — ' +
        'adapter tools/mesure-recul-preload.js ; ni tics serveur relevés ni blocage injecté');
    }

    const corr = releves.filter(r => r.n > o.seuil);
    const reculs = releves.filter(r => r.recul > o.seuil);
    const divs = releves.filter(r => r.div !== null);
    const res = {
      racine, duree: o.duree, charge: o.charge, blocage: o.blocage || null,
      etats: releves.length,
      deplacement: +Math.hypot(st.pos.x - depart.x, st.pos.z - depart.z).toFixed(2),
      corrections: corr.length, correctionsParS: +(corr.length / o.duree).toFixed(2),
      reculs: reculs.length,
      reculTotal: +reculs.reduce((a, r) => a + r.recul, 0).toFixed(3),
      correctionMax: +Math.max(0, ...releves.map(r => r.n)).toFixed(3),
      correctionP95: +centile(corr.map(r => r.n), 0.95).toFixed(3),
      reculMax: +Math.max(0, ...releves.map(r => r.recul)).toFixed(3),
      divergenceMax: +Math.max(0, ...divs.map(r => r.div)).toFixed(3),
      divergences: divs.filter(r => r.div > o.seuil).length,
      retardMoyen: +(releves.reduce((a, r) => a + r.retard, 0) / Math.max(1, releves.length)).toFixed(1),
      retardMax: Math.max(0, ...releves.map(r => r.retard)),
      retardSMax: +Math.max(0, ...releves.map(r => r.retardS)).toFixed(3),
      retardSFinal: releves.length ? +releves[releves.length - 1].retardS.toFixed(3) : null,
      imageMaxS: +maxFrame.toFixed(3), imageP95S: +centile(tFrames, 0.95).toFixed(3),
      serveur: stats ? { tics: stats.tics, ticsLongs: stats.ticsLongs, perduS: +(stats.perduMs / 1000).toFixed(3), ecartMaxMs: +stats.maxEcartMs.toFixed(0),
        ecartP95Ms: centile(stats.ecarts, 0.95), ticMaxMs: +stats.maxTicMs.toFixed(0), blocages: stats.blocages,
        // pendant la mesure seulement : tics de plus de 250 ms et temps qu'ils ont fait perdre au dt plafonné
        pendant: (() => { const l = (stats.longs || []).filter(x => x[0] >= dateDebut && x[0] <= dateFin + 100);
          return { ticsLongs: l.length, perduS: +(l.reduce((a, x) => a + x[1] - 250, 0) / 1000).toFixed(3), maxMs: Math.max(0, ...l.map(x => x[1])) }; })() } : null,
      parPhase: {},
      pires: corr.slice().sort((a, b) => b.n - a.n).slice(0, 8).map(r => ({ t: r.t, phase: r.phase, n: +r.n.toFixed(3), recul: +r.recul.toFixed(3),
        v: [+r.dx.toFixed(3), +r.dy.toFixed(3), +r.dz.toFixed(3)], div: r.div === null ? null : +r.div.toFixed(3), retard: r.retard, retardS: +r.retardS.toFixed(3) })),
    };
    corr.forEach(r => { const p = res.parPhase[r.phase] = res.parPhase[r.phase] || { n: 0, recul: 0 }; p.n++; p.recul = +(p.recul + Math.max(0, r.recul)).toFixed(3); });
    if (dtHeure.length) res.heureServeurParEtat = { moyenne: +(dtHeure.reduce((a, b) => a + b, 0) / dtHeure.length).toFixed(4), max: +Math.max(...dtHeure).toFixed(3) };
    if (o.journal) fs.writeFileSync(o.journal, JSON.stringify({ res, releves }, null, 1));
    return res;
  } finally {
    if (iv) clearInterval(iv);
    if (cl) cl.fermer();
    await srv.arreter();
    if (charge) charge.arreter();
    try { fs.unlinkSync(fichierStats); } catch (e) { /* absent */ }
    try { fs.rmSync(dossierParties, { recursive: true, force: true }); } catch (e) { /* tant pis */ }
    try { fs.rmSync(env.MC_JOURNAL_DOSSIER, { recursive: true, force: true }); } catch (e) { /* tant pis */ }
  }
}

module.exports = { mesurer, parcours };

if (require.main === module) {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--racine') o.racine = a[++i];
    else if (a[i] === '--duree') o.duree = +a[++i];
    else if (a[i] === '--charge') o.charge = +a[++i];
    else if (a[i] === '--blocage') o.blocage = a[++i];
    else if (a[i] === '--graine') o.graine = +a[++i];
    else if (a[i] === '--journal') o.journal = a[++i];
    else if (a[i] === '--json') o.json = true;
    else if (a[i] === '--prechargement') o.prechargement = +a[++i];
  }
  mesurer(o).then((r) => {
    if (o.json) console.log(JSON.stringify(r));
    else console.log(JSON.stringify(r, null, 1));
    process.exit(0);
  }).catch((e) => { console.error(e && e.stack || e); process.exit(2); });
}
