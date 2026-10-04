/* mesure-tics.js — banc des tics du serveur de jeu (blocages de la boucle).

   Lance un VRAI server.js (réseau fermé, monde dans un dossier temporaire) avec
   le profil des tics (MC_TEST_PROFIL_TICS, voir server.js) et y joue des
   scénarios avec un client WebSocket minimal :
   - arrivée : du REJOINDRE au BIENVENUE puis au premier ETAT qui porte `toi` ;
   - course : course en ligne droite sur du terrain neuf (avant + sprint, regard
     fixe), entrées à 60 Hz comme le jeu ;
   - sauvegarde : pendant la course, sauvegardes périodiques (MC_SAUVEGARDE_MS),
     monde gonflé de `--blocs` modifications (MC_TEST_BLOCS) ;
   - pause/reprise : PAUSE puis reprise ;
   - reprise : arrêt du serveur, relance sur le même fichier de monde et
     reconnexion — le joueur revient LOIN du point d'apparition (terrain à
     générer), comme une partie rechargée.
   Il rend, par fenêtre de scénario, la durée des tics (p50, p99, max), les tics
   de plus de 50 ms avec leurs sections, les tâches longues hors tic (messages,
   sauvegardes) et le retard de la boucle d'évènements.

   Usage : node tools/mesure-tics.js [--duree 30] [--charge N] [--blocs N]
           [--cadence-sauvegarde MS] [--cpu-prof DOSSIER] [--graine N] [--yaw R] [--vol] [--json]
   --vol : course en vol (mode créatif), sans obstacle — le pire cas de terrain neuf.
   Module : require('./mesure-tics.js').mesurer(opts) → résumé. */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const A = require('../tests/aide-integration-archi.js');

const NP = A.NP;

function centile(l, p) { if (!l.length) return 0; const s = l.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }

/* Charge CPU : N processus Node en boucle active, arrêtés avec le banc. */
function lancerCharge(n) {
  const procs = [];
  for (let i = 0; i < n; i++) {
    procs.push(spawn(process.execPath, ['-e', 'const p=' + process.pid + ';setInterval(()=>{try{process.kill(p,0)}catch(e){process.exit(0)}},1000).unref();' +
      'function b(){const f=Date.now()+50;while(Date.now()<f){}setImmediate(b)}b()'], { stdio: 'ignore' }));
  }
  return { arreter() { procs.forEach(p => { try { p.kill(); } catch (e) { /* déjà */ } }); } };
}

function lireProfil(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }

/* Résumé d'une fenêtre [debut, fin] (Date.now()) du profil. */
function fenetre(profil, debut, fin, nom) {
  if (!profil) return { nom, erreur: 'profil illisible' };
  const tics = profil.tics.filter(t => t[0] >= debut && t[0] <= fin);
  const ms = tics.map(t => t[1]), ecarts = tics.map(t => t[2]);
  const plus10 = profil.longs.filter(l => l.t >= debut && l.t <= fin);
  const longs = plus10.filter(l => l.ms > 50);
  const taches = profil.taches.filter(l => l.t >= debut && l.t <= fin);
  // sources : somme des sections des tics de plus de 50 ms ; et, pour les tics de plus de 10 ms, max par section
  const sources = {}, max10 = {};
  longs.forEach(l => Object.keys(l.sections).forEach(k => { sources[k] = +((sources[k] || 0) + l.sections[k]).toFixed(1); }));
  plus10.forEach(l => Object.keys(l.sections).forEach(k => { max10[k] = Math.max(max10[k] || 0, l.sections[k]); }));
  return {
    nom, tics: tics.length,
    ticP50: +centile(ms, 0.5).toFixed(2), ticP99: +centile(ms, 0.99).toFixed(2), ticMax: +Math.max(0, ...ms).toFixed(1),
    ecartP99: +centile(ecarts, 0.99).toFixed(1), ecartMax: +Math.max(0, ...ecarts).toFixed(1),
    ticsSup10: plus10.length, ticsSup50: longs.length, sourcesTicsSup50: sources, maxParSectionTicsSup10: max10,
    pires: longs.slice().sort((a, b) => b.ms - a.ms).slice(0, 5),
    tachesSup5: taches.length, tachesMax: taches.slice().sort((a, b) => b.ms - a.ms).slice(0, 5),
  };
}

/* Client joueur : rejoint, mesure l'arrivée, puis envoie des entrées à 60 Hz. */
async function joueur(port, nom) {
  const cl = await A.connecter(port);
  const t0 = Date.now();
  cl.envoyer({ t: NP.MSG.REJOINDRE, formatIds: require('../tests/format-ids.js').FIRST_ITEM, nom, locaux: 1 });
  const bienvenue = await cl.attendre(NP.MSG.BIENVENUE, 60000);
  const tBienvenue = Date.now() - t0;
  await cl.attendre(NP.MSG.ETAT, 60000, m => m.toi && m.toi[0]);
  const tEtat = Date.now() - t0;
  let s = 0, iv = null, touches = 0, yaw = 0;
  const j = {
    client: cl, bienvenue, arrivee: { bienvenueMs: tBienvenue, premierEtatMs: tEtat },
    position() { const e = cl.dernier(NP.MSG.ETAT); return e && e.toi && e.toi[0]; },
    courir(k, y) { touches = k; yaw = y; },
    demarrer() {
      let der = Date.now();
      iv = setInterval(() => {
        const n = Date.now(), dt = Math.min(0.05, (n - der) / 1000); der = n;
        if (dt <= 0) return;
        cl.envoyer({ t: NP.MSG.ENTREE, s: ++s, j: 0, dt: +dt.toFixed(4), k: touches, yaw, pitch: 0, v: j.vol ? 1 : 0 });
      }, 16);
    },
    arreter() { if (iv) clearInterval(iv); iv = null; },
    fermer() { j.arreter(); cl.fermer(); },
  };
  // vide la mémoire des messages reçus (les ETAT s'accumulent sinon pendant de longues mesures)
  const purge = setInterval(() => { if (cl.messages.length > 2000) cl.messages.splice(0, cl.messages.length - 200); }, 1000);
  const f = j.fermer; j.fermer = () => { clearInterval(purge); f(); };
  return j;
}

/* Le cap le plus long sur la terre ferme depuis le point de départ (sans eau sur
   400 blocs si possible) : à la nage, la course n'avancerait presque plus et ne
   chargerait guère de terrain neuf. Le joueur avance vers (-sin yaw, -cos yaw). */
function capAuSec(graine, p) {
  const MC = A.chargerModules();
  const monde = MC.createWorld(graine);
  let meilleur = 0, dist = -1;
  for (let k = 0; k < 16; k++) {
    const yaw = k * Math.PI / 8;
    let d = 0;
    for (; d < 400; d += 4) {
      const e = monde.echantillonLointain(Math.floor(p.x - Math.sin(yaw) * d), Math.floor(p.z - Math.cos(yaw) * d));
      if (e.eau > e.h) break;
    }
    if (d > dist) { dist = d; meilleur = yaw; }
  }
  return meilleur;
}

const AVANT_SPRINT = 1 | 16 | 32;      // avant + saut + sprint (MC.Synchro.encoderTouches) : la course franchit les obstacles

async function mesurer(o) {
  o = Object.assign({ duree: 30, charge: 0, blocs: 0, cadenceSauvegarde: 0, graine: 20260921, cpuProf: null }, o || {});
  const dossier = A.dossierTemp('mc-mesure-tics-');
  const fProfil = path.join(dossier, 'profil.json');
  const fMonde = path.join(dossier, 'monde.json');
  const env = {
    MC_TEST_PROFIL_TICS: fProfil, MC_GRAINE: String(o.graine), MC_MODE: o.vol ? 'creatif' : 'survie', MC_DIFFICULTE: 'paisible',
    MC_SAUVEGARDE_MS: String(o.cadenceSauvegarde || 3600000), MC_JOURNAL_DOSSIER: path.join(dossier, 'journal'),
  };
  if (o.blocs) env.MC_TEST_BLOCS = String(o.blocs);
  const args = ['--port', '0', '--monde', fMonde, '--dossier-parties', dossier];
  const res = { graine: o.graine, charge: o.charge, blocs: o.blocs, scenarios: {} };
  const charge = o.charge > 0 ? lancerCharge(o.charge) : null;
  let s = null, j = null;
  const lancerServeur = async () => {
    if (o.cpuProf) {
      fs.mkdirSync(o.cpuProf, { recursive: true });
      process.env.NODE_OPTIONS = ((process.env.NODE_OPTIONS || '') + ' --cpu-prof --cpu-prof-dir=' + JSON.stringify(path.resolve(o.cpuProf))).trim();
    }
    const t0 = Date.now();
    const srv = await A.lancer(args, env);
    srv.pretMs = Date.now() - t0;
    return srv;
  };
  try {
    // 1. démarrage + première connexion
    s = await lancerServeur();
    res.demarrageMs = s.pretMs;
    let d0 = Date.now();
    j = await joueur(s.port, 'Coureur');
    j.vol = !!o.vol;
    const spawn = j.bienvenue.toi[0];
    await A.dodo(1500);
    res.scenarios.arrivee = Object.assign({ arrivee: j.arrivee }, fenetre(lireProfil(fProfil), d0, Date.now(), 'arrivée'));

    // 2. course en ligne droite sur du terrain neuf (et sauvegardes périodiques, si cadence)
    const p0 = j.position();
    const yaw = o.yaw !== undefined ? o.yaw : capAuSec(o.graine, p0);
    res.scenarios.cap = +yaw.toFixed(3);
    j.demarrer();
    if (o.vol) { j.courir(16, yaw); await A.dodo(2000); }     // en vol : on monte d'abord au-dessus des arbres
    j.courir(o.vol ? 1 | 32 : AVANT_SPRINT, yaw);
    d0 = Date.now();
    await A.dodo(o.duree * 1000);
    let d1 = Date.now();
    const p1 = j.position();
    j.courir(0, yaw);
    await A.dodo(600);
    res.scenarios.course = Object.assign({ distance: p0 && p1 ? +Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1) : null,
      depart: p0 && { x: +p0.x.toFixed(1), y: +p0.y.toFixed(1), z: +p0.z.toFixed(1) }, arrivee: p1 && { x: +p1.x.toFixed(1), y: +p1.y.toFixed(1), z: +p1.z.toFixed(1) } },
      fenetre(lireProfil(fProfil), d0, d1, 'course'));
    // sauvegardes écrites pendant la course, et la plus longue part synchrone annoncée par le journal
    const sauv = s.heureLog.filter(x => x[0] >= d0 && x[0] <= d1 + 1000 && /sauvegarde du monde \(cadence\) — sérialisation/.test(x[1]));
    res.scenarios.course.sauvegardes = sauv.length;
    res.scenarios.course.sauvegardeMaxMs = Math.max(0, ...sauv.map(x => parseFloat(/sérialisation ([\d.]+) ms/.exec(x[1])[1])));

    // 3. pause puis reprise (sauvegarde immédiate à la pause, SPEC-ARCHI-012)
    d0 = Date.now();
    j.client.envoyer({ t: NP.MSG.PAUSE, actif: true });
    await A.dodo(1500);
    j.client.envoyer({ t: NP.MSG.PAUSE, actif: false });
    await A.dodo(1500);
    res.scenarios.pause = fenetre(lireProfil(fProfil), d0, Date.now(), 'pause/reprise');

    // 4. reprise de la partie : arrêt, relance sur le même monde, reconnexion loin du point d'apparition
    j.fermer(); j = null;
    await s.arreter();
    s = await lancerServeur();
    d0 = Date.now();
    j = await joueur(s.port, 'Coureur');
    const pr = j.position();
    await A.dodo(2500);
    res.scenarios.reprise = Object.assign({ arrivee: j.arrivee, loinDuSpawn: pr ? +Math.hypot(pr.x - spawn.x, pr.z - spawn.z).toFixed(1) : null,
      position: pr ? { x: +pr.x.toFixed(1), y: +pr.y.toFixed(1), z: +pr.z.toFixed(1) } : null },
    fenetre(lireProfil(fProfil), d0, Date.now(), 'reprise'));
    // le joueur repris ne tombe pas : son altitude reste celle qu'il avait
    const pf = j.position();
    res.scenarios.reprise.chute = pr && pf ? +(pr.y - pf.y).toFixed(2) : null;
    const prof = lireProfil(fProfil);
    res.boucle = prof && prof.boucle;
  } finally {
    if (j) j.fermer();
    if (s) await s.arreter();
    if (charge) charge.arreter();
    A.supprimerDossier(dossier);
  }
  return res;
}

module.exports = { mesurer, fenetre, centile };

if (require.main === module) {
  const a = process.argv.slice(2), o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--duree') o.duree = +a[++i];
    else if (a[i] === '--charge') o.charge = +a[++i];
    else if (a[i] === '--blocs') o.blocs = +a[++i];
    else if (a[i] === '--cadence-sauvegarde') o.cadenceSauvegarde = +a[++i];
    else if (a[i] === '--graine') o.graine = +a[++i];
    else if (a[i] === '--cpu-prof') o.cpuProf = a[++i];
    else if (a[i] === '--json') o.json = true;
    else if (a[i] === '--yaw') o.yaw = +a[++i];
    else if (a[i] === '--vol') o.vol = true;
  }
  mesurer(o).then((r) => {
    console.log(o.json ? JSON.stringify(r) : JSON.stringify(r, null, 1));
    process.exit(0);
  }).catch((e) => { console.error(e && e.stack || e); process.exit(2); });
}
