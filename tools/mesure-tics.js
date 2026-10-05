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
           [--joueurs N]  (N joueurs dispersés, entretien du monde et passage d'un jour : mesurerDisperses)
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

/* Le serveur réécrit le profil toutes les 500 ms (écriture atomique : fichier
   temporaire puis renommage) ; un renommage concurrent d'une lecture peut encore
   échouer sous Windows : on réessaie, borné. */
async function lireProfil(f) {
  for (let k = 0; k < 20; k++) {
    try { const p = JSON.parse(fs.readFileSync(f, 'utf8')); if (p && Array.isArray(p.tics)) return p; } catch (e) { /* en cours d'écriture */ }
    await A.dodo(50);
  }
  return null;
}

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
    res.scenarios.arrivee = Object.assign({ arrivee: j.arrivee }, fenetre(await lireProfil(fProfil), d0, Date.now(), 'arrivée'));

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
      fenetre(await lireProfil(fProfil), d0, d1, 'course'));
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
    res.scenarios.pause = fenetre(await lireProfil(fProfil), d0, Date.now(), 'pause/reprise');

    // 4. reprise de la partie : arrêt, relance sur le même monde, reconnexion loin du point d'apparition
    j.fermer(); j = null;
    await s.arreter();
    s = await lancerServeur();
    d0 = Date.now();
    j = await joueur(s.port, 'Coureur');
    const pr = j.position();
    // comme un vrai client : des entrées à 60 Hz dès l'arrivée, même immobile (la gravité s'applique à chaque entrée rejouée)
    j.demarrer();
    j.courir(0, 0);
    const nEtats = j.client.messages.length;
    await A.dodo(2500);
    const ys = j.client.messages.slice(nEtats).filter(m => m.t === NP.MSG.ETAT && m.toi && m.toi[0]).map(m => m.toi[0].y);
    res.scenarios.reprise = Object.assign({ arrivee: j.arrivee, loinDuSpawn: pr ? +Math.hypot(pr.x - spawn.x, pr.z - spawn.z).toFixed(1) : null,
      position: pr ? { x: +pr.x.toFixed(1), y: +pr.y.toFixed(1), z: +pr.z.toFixed(1) } : null },
    fenetre(await lireProfil(fProfil), d0, Date.now(), 'reprise'));
    // le joueur repris ne tombe pas : son altitude reste celle qu'il avait
    const pf = j.position();
    // la plus grande descente observée depuis la position de retour (un joueur qui tombe dans le vide descend sans fin)
    res.scenarios.reprise.chute = pr && pf && ys.length ? +(pr.y - Math.min(pf.y, ...ys)).toFixed(2) : null;
    res.scenarios.reprise.etatsReprise = ys.length;
    const prof = await lireProfil(fProfil);
    res.boucle = prof && prof.boucle;

    /* 5. (--sol-lent) retour avec une génération de chunks bridée à une colonne par
       tic (MC_TEST_BUDGET_CHUNKS_MS=0) : le sol du joueur met des secondes à exister
       côté serveur. Le client envoie ses entrées dès l'arrivée ; s'il n'attendait pas
       son sol, le serveur le ferait tomber dans le vide. */
    if (o.solLent) {
      j.fermer(); j = null;
      await s.arreter();
      /* Le joueur est déplacé, dans le fichier de monde, à 400 blocs de là, debout sur
         la terre ferme (sol calculé avec les modules du jeu) : son terrain n'existe pas
         encore côté serveur à la relance. */
      const fichier = JSON.parse(fs.readFileSync(fMonde, 'utf8'));
      const entree = (fichier.joueurs || []).find(e => /Coureur/i.test(e[0]));
      if (!entree || !entree[1].etat) throw new Error('joueur Coureur absent du fichier de monde');
      const MCl = A.chargerModules(), wl = MCl.createWorld(o.graine);
      let cible = null;
      for (let dx = 400; dx < 1400 && !cible; dx += 37) {
        const x = Math.floor(entree[1].etat.x) + dx, z = Math.floor(entree[1].etat.z);
        wl.getChunk(Math.floor(x / 16), Math.floor(z / 16), true);
        const y = wl.groundAt(x, z, true);
        if (y > 0 && MCl.Core.isSolid(wl.getBlock(x, y, z)) && wl.getBlock(x, y + 1, z) === 0 && wl.getBlock(x, y + 2, z) === 0) cible = { x: x + 0.5, y: y + 1, z: z + 0.5 };
      }
      if (!cible) throw new Error('aucune terre ferme trouvée pour le scénario --sol-lent');
      Object.assign(entree[1].etat, cible);
      fs.writeFileSync(fMonde, JSON.stringify(fichier));
      env.MC_TEST_BUDGET_CHUNKS_MS = '0';
      s = await lancerServeur();
      delete env.MC_TEST_BUDGET_CHUNKS_MS;
      j = await joueur(s.port, 'Coureur');
      const p5 = j.position();
      j.demarrer(); j.courir(0, 0);
      const n5 = j.client.messages.length;
      await A.dodo(3000);
      const y5 = j.client.messages.slice(n5).filter(m => m.t === NP.MSG.ETAT && m.toi && m.toi[0]).map(m => m.toi[0].y);
      const att = s.heureLog.some(x => /sol d un joueur généré d un coup/.test(x[1]));
      res.scenarios.solLent = { position: p5 && { x: +p5.x.toFixed(1), y: +p5.y.toFixed(1), z: +p5.z.toFixed(1) }, etats: y5.length,
        chute: p5 && y5.length ? +(p5.y - Math.min(...y5)).toFixed(2) : null, solForce: att };
    }
  } finally {
    if (j) j.fermer();
    if (s) await s.arreter();
    if (charge) charge.arreter();
    A.supprimerDossier(dossier);
  }
  return res;
}

/* --joueurs N : N joueurs DISPERSÉS (anneau de 600 à 2600 blocs autour du point
   d'apparition, chacun debout sur la terre ferme, villes et factions comprises),
   connectés ensemble et envoyant leurs entrées à 60 Hz, sur un monde dont
   l'heure est placée juste avant la fin d'un jour : la fenêtre mesurée contient
   donc l'entretien du monde à 1 Hz pour tous (lieux, politique, rondes des
   factions, membres des factions) ET le passage d'un jour simulé (politique,
   économie). Deux fenêtres : l'arrivée (terrain de N joueurs à générer) et le
   régime (après le premier jour). */
async function mesurerDisperses(o) {
  o = Object.assign({ joueurs: 16, duree: 30, graine: 20260921 }, o || {});
  const dossier = A.dossierTemp('mc-mesure-tics-n-');
  const fProfil = path.join(dossier, 'profil.json');
  const fMonde = path.join(dossier, 'monde.json');
  const env = { MC_TEST_PROFIL_TICS: fProfil, MC_GRAINE: String(o.graine), MC_MODE: 'survie', MC_DIFFICULTE: 'paisible',
                MC_SAUVEGARDE_MS: '3600000', MC_JOURNAL_DOSSIER: path.join(dossier, 'journal') };
  const args = ['--port', '0', '--monde', fMonde, '--dossier-parties', dossier, '--ouvert', '--max-joueurs', String(Math.max(8, o.joueurs))];
  const noms = []; for (let i = 0; i < o.joueurs; i++) noms.push('Disperse' + i);
  const res = { graine: o.graine, joueurs: o.joueurs, scenarios: {} };
  let s = null, js = [];
  try {
    // 1. une première venue pour que chaque joueur existe dans le fichier de monde
    s = await A.lancer(args, env);
    for (const n of noms) js.push(await joueur(s.port, n));
    const spawn = js[0].bienvenue.toi[0];
    js.forEach(j => j.fermer()); js = [];
    await s.arreter(); s = null;
    // 2. chacun déplacé sur la terre ferme, sur un anneau ; l'heure 8 s avant la fin du jour
    const fichier = JSON.parse(fs.readFileSync(fMonde, 'utf8'));
    const MCl = A.chargerModules(), wl = MCl.createWorld(o.graine);
    const positions = [];
    noms.forEach((n, i) => {
      const entree = (fichier.joueurs || []).find(e => e[0] === n || (e[1] && e[1].nom === n) || String(e[0]).toLowerCase() === n.toLowerCase());
      if (!entree || !entree[1].etat) throw new Error('joueur ' + n + ' absent du fichier de monde');
      let cible = null;
      for (let k = 0; k < 40 && !cible; k++) {
        const ang = (i + k * 0.37) * 2 * Math.PI / noms.length, r = 600 + ((i * 1237 + k * 211) % 2000);
        const x = Math.floor(spawn.x + Math.cos(ang) * r), z = Math.floor(spawn.z + Math.sin(ang) * r);
        wl.getChunk(Math.floor(x / 16), Math.floor(z / 16), true);
        const y = wl.groundAt(x, z, true);
        if (y > 0 && MCl.Core.isSolid(wl.getBlock(x, y, z)) && wl.getBlock(x, y + 1, z) === 0 && wl.getBlock(x, y + 2, z) === 0) cible = { x: x + 0.5, y: y + 1, z: z + 0.5 };
      }
      if (!cible) throw new Error('aucune terre ferme pour ' + n);
      Object.assign(entree[1].etat, cible);
      positions.push(cible);
    });
    const jourLong = MCl.DayCycle.DAY_LENGTH;
    fichier.heure = (Math.floor((fichier.heure || 0) / jourLong) + 1) * jourLong - 8;
    fs.writeFileSync(fMonde, JSON.stringify(fichier));
    res.positions = positions.map(p => [Math.round(p.x), Math.round(p.z)]);
    // 3. relance, arrivée de tous, puis régime (le jour passe pendant la mesure)
    s = await A.lancer(args, env);
    const d0 = Date.now();
    js = await Promise.all(noms.map(n => joueur(s.port, n)));
    js.forEach(j => { j.demarrer(); j.courir(0, 0); });
    await A.dodo(Math.max(10, o.duree / 3) * 1000);
    const d1 = Date.now();
    res.scenarios.arrivee = fenetre(await lireProfil(fProfil), d0, d1, 'arrivée de ' + o.joueurs + ' joueurs dispersés');
    await A.dodo(o.duree * 1000);
    const d2 = Date.now();
    res.scenarios.regime = fenetre(await lireProfil(fProfil), d1, d2, o.joueurs + ' joueurs dispersés, entretien et jour simulé');
    // ce que la politique est devenue (factions découvertes, jour simulé) : relu par un client
    const pol = js[0].client.messages.filter(m => m.t === NP.MSG.POLITIQUE && m.pol);
    res.factionsPnj = pol.reduce((n, m) => n + ((m.pol.f || []).length), 0);     // nées au join puis découvertes en route
    res.jourSimule = pol.length ? Math.max(...pol.map(m => m.pol.jour || 0)) : null;
    res.annoncesPolitiques = js[0].client.messages.filter(m => m.t === NP.MSG.CHAT && m.type === 'systeme' &&
      /change d'objectif|caravane|patrouille|raid|avant-poste|alliance|guerre|rivales|neutres|voit le jour/.test(m.texte || '')).length;
    res.gardesEnRonde = Math.max(0, ...js.map(j => { const e = j.client.dernier(NP.MSG.ETAT); return e ? (e.mobs || []).filter(x => x.pa).length : 0; }));
  } finally {
    js.forEach(j => { try { j.fermer(); } catch (e) { /* déjà */ } });
    if (s) await s.arreter();
    A.supprimerDossier(dossier);
  }
  return res;
}

module.exports = { mesurer, mesurerDisperses, fenetre, centile, capAuSec };

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
    else if (a[i] === '--sol-lent') o.solLent = true;
    else if (a[i] === '--joueurs') o.joueurs = +a[++i];
  }
  (o.joueurs ? mesurerDisperses(o) : mesurer(o)).then((r) => {
    console.log(o.json ? JSON.stringify(r) : JSON.stringify(r, null, 1));
    process.exit(0);
  }).catch((e) => { console.error(e && e.stack || e); process.exit(2); });
}
