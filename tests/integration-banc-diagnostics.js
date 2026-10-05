/* integration-banc-diagnostics.js — les diagnostics joints aux échecs et aux
   lenteurs, contre de VRAIS serveurs et un VRAI navigateur sans fenêtre
   (SPEC-BANC-092 à 103, docs/banc/historique-global.md §3.13) :
     - serveur : exception non rattrapée et promesse rejetée dans un vrai
       server.js, journal et sortie capturés (100) ; trace des messages réseau
       des deux côtés avec --journal RESEAU:trace (103) ;
     - navigateur : exception, promesse rejetée, message du navigateur lui-même
       (CSP), ressources introuvables, worker qui plante par le vrai pool,
       erreur de shader, contexte WebGL perdu puis restauré, erreur gl.getError
       sondée (095 à 099) ; instantané et vol d'un test en échec (093, 094) ;
     - une vraie campagne e2e où un test lent produit un profil CPU
       (.cpuprofile), une trace GPU et un profil GPU en couches (101, 102).
   Les tests Node de tests/spec-banc-diagnostics.js, spec-banc-erreurs.js et
   spec-banc-profils.js vérifient la logique ; ici, la plomberie réelle.

   Aucun serveur ni navigateur ne reste après le script. IGNORÉ (code 0,
   avertissement) pour la partie navigateur sans Edge/Chrome installé.

   Usage : node tests/integration-banc-diagnostics.js */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const A = require('./aide-integration-archi.js');
const RACINE = A.RACINE;
const CDP = require(path.join(RACINE, 'tools', 'cdp.js'));
const NAV = require(path.join(RACINE, 'tools', 'navigateur.js'));
const DIAG = require(path.join(RACINE, 'tools', 'diagnostics.js'));
const E2EH = require(path.join(RACINE, 'tools', 'e2e-headless.js'));
const RT = require(path.join(RACINE, 'tools', 'resultats-tests.js'));

const R = A.creerRapport('Diagnostics joints aux échecs et aux lenteurs (SPEC-BANC-092 à 103)');
const dodo = A.dodo;
const aNettoyer = { serveurs: [], navigateurs: [], dossiers: [] };
function nettoyerTout() {
  aNettoyer.navigateurs.forEach((h) => { try { NAV.arreterProprement(h); } catch (e) { /* déjà parti */ } });
  aNettoyer.serveurs.forEach((p) => { try { p.kill(); } catch (e) { /* déjà parti */ } });
  aNettoyer.dossiers.forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* verrouillé */ } });
}
process.on('exit', nettoyerTout);
function dossierTemp(prefixe) { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefixe)); aNettoyer.dossiers.push(d); return d; }
async function attendre(fn, ms, quoi) {
  const fin = Date.now() + (ms || 8000);
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > fin) throw new Error('condition non atteinte à temps : ' + (quoi || ''));
    await dodo(60);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 1. Serveurs : pannes non rattrapées (100) et messages réseau (103)
// ══════════════════════════════════════════════════════════════════════════
async function partieServeur() {
  // ── SPEC-BANC-100 : un vrai server.js qui lève une exception asynchrone et un rejet ──
  const dJournal = dossierTemp('mc-diag-journal-');
  const dParties = dossierTemp('mc-diag-parties-');
  const fichierMonde = path.join(dParties, 'monde.json');
  const s = await A.lancer(['--port', '0', '--monde', fichierMonde, '--dossier-parties', dParties],
    { MC_JOURNAL_DOSSIER: dJournal, MC_TEST_PANNE_ASYNC: '1', MC_TEST_PANNE_REJET: '1' });
  aNettoyer.serveurs.push(s.proc);
  try {
    const r = await attendre(() => { const x = DIAG.recolterJournalServeur(dJournal); return x.pannes.length >= 2 ? x : null; }, 10000, 'pannes du serveur dans son journal');
    R.ok(true, 'SPEC-BANC-100 : les deux pannes (exception et promesse rejetée) arrivent dans le journal du serveur');
    const exc = r.pannes.find(p => /EXCEPTION NON RATTRAPÉE/.test(p.ligne));
    const rej = r.pannes.find(p => /PROMESSE REJETÉE/.test(p.ligne));
    R.ok(exc && /panne asynchrone de test SPEC-SECU-002/.test(exc.ligne), 'SPEC-BANC-100 : l\'exception non rattrapée est isolée, avec son message', exc && exc.ligne);
    R.ok(exc && /at /.test(exc.pile), 'SPEC-BANC-100 : et sa pile', exc && exc.pile);
    R.ok(rej && /rejet de test SPEC-SECU-002/.test(rej.ligne), 'SPEC-BANC-100 : la promesse rejetée aussi');
    R.ok(s.logs.some(l => /EXCEPTION NON RATTRAPÉE/.test(l)), 'SPEC-BANC-100 : stdout du processus serveur capturé (la même panne y figure)');
    R.ok(s.vivant, 'SPEC-BANC-100 : le serveur a survécu à ses pannes (process.on uncaughtException / unhandledRejection)');
    // la collecte → le rapport d'un test d'intégration en échec
    const base = dossierTemp('mc-diag-cahier-');
    const c = RT.ecrireCahier({ schema: 1, campagne: { preset: 'essai', seuilLentMs: 20000 }, tests: [
      { nom: 'intégration en échec', type: 'integration', groupe: 'g', etat: 'echec', duree_ms: 900, domaines: ['NET'], specs: [], message: 'x', serveur: { journal: r.lignes, pannes: r.pannes } },
      { nom: 'intégration réussie', type: 'integration', groupe: 'g', etat: 'ok', duree_ms: 900, domaines: ['NET'], specs: [], serveur: { journal: r.lignes, pannes: r.pannes } },
    ] }, { racine: base });
    const j = JSON.parse(fs.readFileSync(path.join(c.dossierAbsolu, 'resultats.json'), 'utf8'));
    R.ok(j.tests[0].serveur && j.tests[0].serveur.pannes.length >= 2, 'SPEC-BANC-100 : le journal du serveur est joint au test d\'intégration en échec');
    R.ok(j.tests[1].serveur === undefined, 'SPEC-BANC-100 : et pas à celui qui a réussi');
    R.ok(/pannes du serveur/.test(fs.readFileSync(path.join(c.dossierAbsolu, 'rapport.html'), 'utf8')), 'SPEC-BANC-100 : le rapport les montre');
  } catch (e) { R.ok(false, 'SPEC-BANC-100 : partie serveur', e.stack || String(e)); }
  await s.arreter();

  // ── SPEC-BANC-103 : trace des messages des deux côtés ───────────────────────
  const dJ2 = dossierTemp('mc-diag-reseau-');
  const dP2 = dossierTemp('mc-diag-parties2-');
  const s2 = await A.lancer(['--port', '0', '--monde', path.join(dP2, 'monde.json'), '--dossier-parties', dP2, '--journal', 'RESEAU:trace'], { MC_JOURNAL_DOSSIER: dJ2 });
  aNettoyer.serveurs.push(s2.proc);
  try {
    const nom = 'Tracee';
    const client = await A.connecter(s2.port, {});
    const cote = [];     // ce que le CLIENT a émis et reçu, daté
    const envoyerBrut = client.envoyer.bind(client);
    client.envoyer = (obj) => { cote.push({ sens: 'envoi', type: obj.t, seq: typeof obj.s === 'number' ? obj.s : null, taille: JSON.stringify(obj).length, t: Date.now() }); envoyerBrut(obj); };
    client.surMessage = (m) => cote.push({ sens: 'recu', type: m.t, seq: typeof m.seq === 'number' ? m.seq : null, taille: JSON.stringify(m).length, t: Date.now() });
    client.envoyer({ t: 'rejoindre', formatIds: require('./format-ids.js').FIRST_ITEM, nom, locaux: 1 });
    await client.attendre('bienvenue', 8000);
    for (let i = 1; i <= 3; i++) { client.envoyer({ t: 'entree', s: i, j: 0, dt: 0.016, k: 0, yaw: 0, pitch: 0, v: 1 }); await dodo(30); }
    client.envoyer({ t: 'chat', texte: 'bonjour trace' });
    await dodo(400);
    const r = await attendre(() => {
      const x = DIAG.recolterJournalServeur(dJ2);
      const m = DIAG.messagesDuJournalServeur(x.lignes);
      return m.some(y => y.type === 'chat') && m.some(y => y.type === 'entree') && m.some(y => y.sens === 'envoi') ? x : null;
    }, 8000, 'lignes de trace réseau dans le journal du serveur');
    const rapport = DIAG.rapportReseau(cote, r.lignes, 80);
    const cotes = new Set(rapport.messages.map(m => m.cote));
    R.ok(cotes.has('client') && cotes.has('serveur'), 'SPEC-BANC-103 : le rapport porte les messages des DEUX côtés');
    const sens = new Set(rapport.messages.map(m => m.sens));
    R.ok(sens.has('envoi') && sens.has('recu'), 'SPEC-BANC-103 : dans les deux sens');
    const srv = DIAG.rapportReseau(cote, r.lignes, 5000).messages.filter(m => m.cote === 'serveur');   // tous : l'ETAT à haute cadence repousse le début hors des 80 derniers
    R.ok(srv.some(m => m.sens === 'recu' && m.type === 'rejoindre') && srv.some(m => m.sens === 'envoi' && m.type === 'bienvenue'), 'SPEC-BANC-103 : le serveur a tracé rejoindre (reçu) et bienvenue (envoyé)', JSON.stringify(srv.slice(0, 8)) + ' | lignes: ' + r.lignes.length);
    const entree = srv.find(m => m.sens === 'recu' && m.type === 'entree');
    R.ok(entree && entree.seq >= 1 && entree.taille > 20, 'SPEC-BANC-103 : seq et taille d\'un message d\'entrée côté serveur', JSON.stringify(entree));
    R.ok(rapport.messages.every(m => m.type && typeof m.t === 'number' && m.t > 1e12), 'SPEC-BANC-103 : type et horodatage partout');
    R.ok(rapport.messages.every((m, i, a) => i === 0 || a[i - 1].t <= m.t), 'SPEC-BANC-103 : liste ordonnée dans le temps');
    R.ok(rapport.journal_serveur.length > 0 && rapport.journal_serveur.some(l => / RESEAU /.test(l)), 'SPEC-BANC-103 : le journal du serveur est joint');
    const dernier = DIAG.rapportReseau(cote, r.lignes, 5);
    R.eq(dernier.messages.length, 5, 'SPEC-BANC-103 : seulement les N derniers messages');
    client.fermer();
  } catch (e) { R.ok(false, 'SPEC-BANC-103 : trace réseau', e.stack || String(e)); }
  await s2.arreter();

  // sans l'option, rien n'est tracé (aucun coût ni bruit en exploitation)
  const dJ3 = dossierTemp('mc-diag-sanstrace-');
  const dP3 = dossierTemp('mc-diag-parties3-');
  const s3 = await A.lancer(['--port', '0', '--monde', path.join(dP3, 'monde.json'), '--dossier-parties', dP3], { MC_JOURNAL_DOSSIER: dJ3 });
  aNettoyer.serveurs.push(s3.proc);
  try {
    const { client } = await A.rejoindre(s3.port, 'Muette', 1);
    client.envoyer({ t: 'chat', texte: 'rien à tracer' });
    await dodo(500);
    const x = DIAG.recolterJournalServeur(dJ3);
    R.eq(DIAG.messagesDuJournalServeur(x.lignes).length, 0, 'SPEC-BANC-103 : sans --journal RESEAU:trace, aucune ligne de trace dans le journal du serveur');
    client.fermer();
  } catch (e) { R.ok(false, 'SPEC-BANC-103 : sans trace', e.stack || String(e)); }
  await s3.arreter();
}

// ══════════════════════════════════════════════════════════════════════════
// 2. Navigateur réel
// ══════════════════════════════════════════════════════════════════════════
function codeHttp(port, chemin) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: chemin, timeout: 2000 }, (res) => { res.resume(); resolve(res.statusCode || 0); });
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
  });
}
/* Un serveur de test (--tests) et un navigateur sans fenêtre, sur la page du banc, avec le collecteur CDP. */
async function ouvrirBanc() {
  const port = await NAV.portLibre();
  const serveur = spawn(process.execPath, [path.join(RACINE, 'server.js'), '--port', String(port), '--serveur', '--tests'],
    { cwd: RACINE, stdio: 'ignore', env: Object.assign({}, process.env, { MC_TEST_POSE_LIBRE: '1', MC_JOURNAL_DOSSIER: dossierTemp('mc-diag-banc-') }) });
  aNettoyer.serveurs.push(serveur);
  await attendre(async () => (await codeHttp(port, '/tests/index.html')) === 200, 20000, 'serveur de test');
  const handle = await NAV.lancer({ largeur: NAV.LARGEUR_MIN, hauteur: NAV.HAUTEUR_MIN });
  aNettoyer.navigateurs.push(handle);
  const info = await CDP.attendrePortPret(handle.port, 20000);
  const cibles = await CDP.listerCibles(handle.port);
  const cible = (cibles || []).find(c => c.type === 'page') || await CDP.nouvelOnglet(handle.port, 'about:blank');
  const session = new CDP.SessionCDP(cible.webSocketDebuggerUrl);
  await session.connecter(20000);
  const col = new DIAG.CollecteurCDP(session);
  await col.attacher({ scriptNouveauDocument: fs.readFileSync(path.join(RACINE, 'tests', 'erreurs-page.js'), 'utf8') });
  const nav = new CDP.SessionCDP(info.webSocketDebuggerUrl);
  await nav.connecter(20000);
  await session.envoyer('Emulation.setDeviceMetricsOverride', { width: handle.largeur, height: handle.hauteur, deviceScaleFactor: 1, mobile: false }, 10000);
  await session.envoyer('Page.navigate', { url: 'http://127.0.0.1:' + port + '/tests/index.html' }, 20000);
  await attendre(async () => {
    try { const r = await session.envoyer('Runtime.evaluate', { expression: "typeof window.runE2E === 'function' && typeof MC !== 'undefined' && typeof ensureGame === 'function' && !!window.MC_BANC", returnByValue: true }, 5000); return r.result && r.result.value === true; } catch (e) { return false; }
  }, 25000, 'page du banc prête');
  async function evaluer(expression, delai) {
    const r = await session.envoyer('Runtime.evaluate', { expression: '(async () => {' + expression + '})()', awaitPromise: true, returnByValue: true }, delai || 60000);
    if (r.exceptionDetails) throw new Error('exception dans la page : ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result && r.result.value;
  }
  return { port, session, col, nav, handle, evaluer, info, fermer() { try { nav.fermer(); } catch (e) { /* rien */ } try { session.fermer(); } catch (e) { /* rien */ } } };
}

async function partieNavigateur() {
  const b = await ouvrirBanc();
  try {
    // ── SPEC-BANC-095 : exception non rattrapée et promesse rejetée ──────────
    b.col.debutTest();
    await b.evaluer(`
      setTimeout(function () { throw new Error('exception de test 095'); }, 0);
      Promise.reject(new Error('rejet de test 095'));
      await new Promise(function (r) { setTimeout(r, 400); });`);
    await dodo(300);
    let f = b.col.finTest();
    const exc = f.erreursCachees.filter(e => e.type === 'exception');
    R.ok(exc.some(e => /exception de test 095/.test(e.message)), 'SPEC-BANC-095 : l\'exception non rattrapée est vue par CDP (Runtime.exceptionThrown)');
    R.ok(exc.some(e => /rejet de test 095/.test(e.message)), 'SPEC-BANC-095 : la promesse rejetée aussi');
    R.ok(exc.some(e => /exception de test 095/.test(e.message) && /at /.test(e.pile || '')), 'SPEC-BANC-095 : avec sa pile', JSON.stringify(exc.map(e => e.pile)));
    const page = await b.evaluer(`return MC_ERREURS_PAGE.toutes().map(function (e) { return { type: e.type, message: e.message, pile: !!e.pile }; });`);
    R.ok(page.some(e => e.type === 'exception_page' && /exception de test 095/.test(e.message)), 'SPEC-BANC-095 : la page l\'a captée AUSSI de son côté (tests/erreurs-page.js, avant les scripts du jeu)');
    R.ok(page.some(e => e.type === 'promesse_rejetee' && /rejet de test 095/.test(e.message) && e.pile), 'SPEC-BANC-095 : et la promesse rejetée, avec sa pile');
    const journal = await b.evaluer(`return MC.Journal.tampon({ domaine: 'PAGE', niveau: 'error' }).map(function (e) { return e.message; });`);
    R.ok(journal.some(m => /exception de test 095/.test(m)), 'SPEC-BANC-095 : l\'exception figure dans le journal du jeu (domaine PAGE)');
    const fusion = DIAG.fusionner([page.map((e) => ({ t: 1, source: 'page', type: e.type, niveau: 'error', message: e.message })), f.erreursCachees]);
    R.eq(fusion.filter(e => /exception de test 095/.test(e.message)).length, 1, 'SPEC-BANC-095 : page et CDP ne comptent la panne qu\'une fois');
    R.ok(await b.evaluer(`return document.querySelector('script').getAttribute('src') === 'erreurs-page.js';`), 'SPEC-BANC-095 : tests/erreurs-page.js est le premier script de la page');

    // ── SPEC-BANC-096 : message du navigateur lui-même (hors console.*) ───────
    b.col.debutTest();
    await b.evaluer(`try { new Worker('data:application/javascript,'); } catch (e) { } await new Promise(function (r) { setTimeout(r, 300); });`);
    await dodo(300);
    f = b.col.finTest();
    const secu = f.erreursCachees.find(e => e.source === 'navigateur' && e.type === 'security');
    R.ok(secu && /Content Security Policy/.test(secu.message), 'SPEC-BANC-096 : une erreur de sécurité émise par le navigateur lui-même (Log.entryAdded) apparaît dans le journal du test', JSON.stringify(f.erreursCachees.map(e => e.type + ':' + e.message.slice(0, 50))));
    R.ok(f.vol.some(l => /NAVIGATEUR:security/.test(l)), 'SPEC-BANC-096 : dans le vol, daté');
    R.ok(!f.vol.some(l => /CONSOLE/.test(l) && /Content Security Policy/.test(l)), 'SPEC-BANC-096 : alors qu\'elle n\'a jamais atteint console.*');
    // une VRAIE dépréciation, émise par le navigateur pendant le test (un écouteur « unload », une API préfixée)
    b.col.debutTest();
    await b.evaluer(`window.addEventListener('unload', function () {}); try { webkitRequestAnimationFrame(function () {}); } catch (e) { } await new Promise(function (r) { setTimeout(r, 400); });`);
    await dodo(400);
    f = b.col.finTest();
    const deps = f.erreursCachees.filter(e => e.type === 'deprecation');
    R.ok(deps.some(e => /UnloadHandler/.test(e.message)), 'SPEC-BANC-096 : une dépréciation émise par le navigateur pendant un test sans fenêtre (écouteur unload) apparaît dans le journal du test', JSON.stringify(f.erreursCachees.map(e => e.type + ':' + e.message.slice(0, 60))));
    R.ok(deps.some(e => /PrefixedRequestAnimationFrame/.test(e.message)), 'SPEC-BANC-096 : une seconde (API préfixée) aussi');
    R.ok(!f.vol.some(l => /CONSOLE/.test(l) && /Unload/i.test(l)), 'SPEC-BANC-096 : alors qu\'elle n\'aurait jamais atteint console.* (domaine Audits)');
    R.ok(f.vol.some(l => /NAVIGATEUR:deprecation/.test(l)), 'SPEC-BANC-096 : elle figure dans le vol, datée');

    // ── SPEC-BANC-099 : ressources introuvables ───────────────────────────────
    b.col.debutTest();
    await b.evaluer(`
      var s = document.createElement('script'); s.src = '/introuvable-099.js'; document.head.appendChild(s);
      var im = document.createElement('img'); im.src = '/introuvable-099.png'; document.body.appendChild(im);
      await new Promise(function (r) { setTimeout(r, 500); });
      im.remove(); s.remove();`);
    await dodo(300);
    f = b.col.finTest();
    R.ok(f.erreursCachees.some(e => e.source === 'reseau' && e.statut === 404 && /introuvable-099\.js/.test(e.url)), 'SPEC-BANC-099 : le script manquant (HTTP 404) est vu par CDP Network.responseReceived');
    R.ok(f.erreursCachees.some(e => e.source === 'reseau' && /introuvable-099\.png/.test(e.url)), 'SPEC-BANC-099 : l\'image manquante aussi');
    const res = await b.evaluer(`return MC_ERREURS_PAGE.toutes().filter(function (e) { return e.type === 'ressource'; }).map(function (e) { return e.message; });`);
    R.ok(res.some(m => /<script>.*introuvable-099\.js/.test(m)) && res.some(m => /<img>.*introuvable-099\.png/.test(m)), 'SPEC-BANC-099 : et l\'écouteur « error » en phase de capture de la page attrape <script> et <img>', JSON.stringify(res));
    const ws = await b.evaluer(`
      var net = MC.createNetClient({});
      net.connecter('ws://127.0.0.1:1/introuvable', 'Essai', 1);
      await new Promise(function (r) { setTimeout(r, 1200); });
      return MC.Journal.tampon({ domaine: 'NET' }).map(function (e) { return { code: e.code, niveau: e.niveau, message: e.message }; });`);
    R.ok(ws.some(e => e.code === 'E-NET-001'), 'SPEC-BANC-099 : l\'erreur WebSocket du client (onerror) va au journal (E-NET-001)', JSON.stringify(ws));
    R.ok(ws.some(e => e.code === 'E-NET-002' && /1006/.test(e.message)), 'SPEC-BANC-099 : et le code de fermeture (onclose) aussi (E-NET-002, code 1006)', JSON.stringify(ws));

    // ── SPEC-BANC-097 : worker qui plante, par le vrai pool ───────────────────
    b.col.debutTest();
    const pw = await b.evaluer(`
      var pool = MC.Workers.creerPool({ script: '/tests/worker-sonde.js', taille: 1, onMessage: function () {}, onErreur: function () {} });
      pool.envoyer({ type: 'exception', message: 'exception 097 dans le worker' });
      await new Promise(function (r) { setTimeout(r, 1000); });
      pool.envoyer({ type: 'rejet', message: 'rejet 097 dans le worker' });
      await new Promise(function (r) { setTimeout(r, 800); });
      pool.fermer();
      return MC.Journal.tampon({ domaine: 'WORKER' }).map(function (e) { return { code: e.code, message: e.message, pile: e.pile }; });`);
    await dodo(300);
    f = b.col.finTest();
    R.ok(pw.some(e => e.code === 'E-WORK-002' && /exception 097/.test(e.message) && /worker-sonde/.test(e.pile || '')), 'SPEC-BANC-097 : l\'exception levée dans le worker apparaît dans le journal du fil principal, avec sa pile (relais postMessage)', JSON.stringify(pw));
    R.ok(pw.some(e => e.code === 'E-WORK-001' && /exception 097/.test(e.message)), 'SPEC-BANC-097 : et worker.onerror du pool (E-WORK-001)');
    R.ok(pw.some(e => e.code === 'E-WORK-002' && /rejet 097/.test(e.message)), 'SPEC-BANC-097 : la promesse rejetée dans le worker, que ni onerror ni la console ne montrent, aussi');
    const duWorker = f.erreursCachees.filter(e => e.source === 'worker');
    R.ok(duWorker.some(e => /exception 097/.test(e.message) && /worker-sonde\.js/.test(e.worker || '')), 'SPEC-BANC-097 : sans fenêtre, CDP (Target.setAutoAttach) voit aussi l\'exception du worker, marquée avec son script', JSON.stringify(f.erreursCachees.map(e => e.source + ':' + e.message.slice(0, 40))));
    // les vrais workers du jeu démarrent toujours avec le relais d'erreurs chargé (importScripts)
    const vrai = await b.evaluer(`
      var w = new Worker('/src/worker-monde.js?v=' + Date.now());
      var rep = await new Promise(function (resolve) {
        var t = setTimeout(function () { resolve({ type: 'delai' }); }, 8000);
        w.onmessage = function (ev) { clearTimeout(t); resolve(ev.data); };
        w.onerror = function (ev) { clearTimeout(t); resolve({ type: 'erreur', message: ev.message }); };
        w.postMessage({ type: 'init', epoque: 1, graine: 7, options: { zonePolitique: null }, v: MC.ContratsV2.VERSION });
      });
      w.terminate();
      return rep;`);
    R.eq(vrai.type, 'pret', 'SPEC-BANC-097 : le VRAI worker de génération démarre avec le relais d\'erreurs et répond « pret » (' + JSON.stringify(vrai) + ')');
    const vraiM = await b.evaluer(`
      var w = new Worker('/src/worker-maillage.js?v=' + Date.now());
      var rep = await new Promise(function (resolve) {
        var t = setTimeout(function () { resolve({ type: 'delai' }); }, 8000);
        w.onmessage = function (ev) { clearTimeout(t); resolve(ev.data); };
        w.onerror = function (ev) { clearTimeout(t); resolve({ type: 'erreur', message: ev.message }); };
        w.postMessage({ type: 'init', epoque: 1, graine: 7, options: { zonePolitique: null }, v: MC.ContratsV2.VERSION });
      });
      w.terminate();
      return rep;`);
    R.eq(vraiM.type, 'pret', 'SPEC-BANC-097 : le VRAI worker de maillage aussi (' + JSON.stringify(vraiM) + ')');

    // ── SPEC-BANC-098 : shader, contexte WebGL, gl.getError ───────────────────
    b.col.debutTest();
    const gl = await b.evaluer(`
      var g = ensureGame();
      var out = { checkShaderErrors: g.render.renderer.debug.checkShaderErrors };
      var m = new THREE.ShaderMaterial({ vertexShader: 'void main() { gl_Position = vec4(0.0); }', fragmentShader: 'void main() { gl_FragColor = vec4(inconnu098); }' });
      var maille = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3)), m);
      g.render.scene.add(maille); g.render.render(); g.render.scene.remove(maille);
      out.shader = MC_ERREURS_PAGE.toutes().filter(function (e) { return /shader error/.test(e.message); }).map(function (e) { return e.type; });
      var ctxGL = g.render.renderer.getContext();
      var ext = ctxGL.getExtension('WEBGL_lose_context');
      out.perte = !!ext;
      if (ext) { ext.loseContext(); await new Promise(function (r) { setTimeout(r, 400); }); out.perdu = g.render.contextePerdu; ext.restoreContext(); await new Promise(function (r) { setTimeout(r, 900); }); out.restaure = !g.render.contextePerdu; }
      // une vraie erreur WebGL, que seule gl.getError() révèle ; le rendu continue, la sonde la voit
      ctxGL.activeTexture(0);
      var avant = g.render.sondeGL.interrogations;
      var images = g.render.sondeGL.images;
      for (var i = 0; i < 130; i++) await new Promise(function (r) { requestAnimationFrame(r); });
      out.interrogations = g.render.sondeGL.interrogations - avant;
      out.images = g.render.sondeGL.images - images;
      out.codes = MC.Journal.tampon({ domaine: 'RENDU' }).map(function (e) { return e.code; });
      // jamais en jeu normal : la sonde se coupe
      g.render.activerSondeGL(false);
      var inter = g.render.sondeGL.interrogations;
      for (var k = 0; k < 70; k++) await new Promise(function (r) { requestAnimationFrame(r); });
      out.apresCoupure = g.render.sondeGL.interrogations - inter;
      g.render.activerSondeGL(true);
      return out;`);
    await dodo(300);
    f = b.col.finTest();
    R.ok(gl.checkShaderErrors === true, 'SPEC-BANC-098 : renderer.debug.checkShaderErrors reste à true en test');
    R.ok(gl.shader.length > 0, 'SPEC-BANC-098 : l\'erreur de compilation d\'un shader (console.error de three.js) est captée par le journal de la page', JSON.stringify(gl.shader));
    R.ok(f.vol.some(l => /shader error/.test(l)), 'SPEC-BANC-098 : et par CDP (Runtime.consoleAPICalled), dans le vol du test');
    R.ok(gl.perte && gl.perdu === true && gl.restaure === true, 'SPEC-BANC-098 : le contexte WebGL perdu puis restauré (simulé par WEBGL_lose_context)', JSON.stringify(gl));
    R.ok(gl.codes.indexOf('E-RENDU-001') >= 0, 'SPEC-BANC-098 : la perte est journalisée (E-RENDU-001)');
    R.ok(gl.codes.indexOf('E-RENDU-002') >= 0, 'SPEC-BANC-098 : la restauration aussi (E-RENDU-002)');
    R.ok(gl.codes.indexOf('E-RENDU-003') >= 0, 'SPEC-BANC-098 : une erreur gl.getError() sondée est journalisée (E-RENDU-003)', JSON.stringify(gl.codes));
    R.ok(gl.interrogations >= 1 && gl.interrogations <= Math.ceil(gl.images / 60) + 1, 'SPEC-BANC-098 : gl.getError() est interrogé une image sur 60, pas plus (' + gl.interrogations + ' interrogations pour ' + gl.images + ' images)');
    R.eq(gl.apresCoupure, 0, 'SPEC-BANC-098 : la sonde coupée n\'interroge plus rien (jamais active en jeu normal)');

    // ── SPEC-BANC-093 / 094 / 092 : un e2e en échec, un lent, un réussi ───────
    const faux = await b.evaluer(`
      var g = ensureGame();
      var J = MC.Journal;
      function corps(nom, panne, attente) {
        return { name: nom, fiche: null, fn: async function () {
          J('RENDU').trace('étape 1 de ' + nom + ' : trace invisible');
          J('SYNC').debug('étape 2 de ' + nom + ' : debug invisible');
          setTimeout(function () { throw new Error('exception tardive de ' + nom); }, 0);
          if (attente) await new Promise(function (r) { setTimeout(r, attente); });
          if (panne) throw new Error('panne volontaire de ' + nom);
        } };
      }
      var echec = await runUnE2E(g, corps('faux-echec', true, 50), { seuilLentMs: 5000 });
      var lent = await runUnE2E(g, corps('faux-lent', false, 400), { seuilLentMs: 150 });
      var bon = await runUnE2E(g, corps('faux-bon', false, 0), { seuilLentMs: 5000 });
      function resume(r) { return { etat: r.etat, cles: Object.keys(r).filter(function (k) { return ['vol', 'instantane', 'erreursCachees', 'longtasks', 'histogrammeImages', 'volPerdues'].indexOf(k) >= 0; }), vol: r.vol, instantane: r.instantane, erreursCachees: r.erreursCachees, metriques: !!r.metriques, histogramme: r.histogrammeImages }; }
      return { echec: resume(echec), lent: resume(lent), bon: resume(bon) };`, 120000);
    R.eq(faux.echec.etat, 'echec', 'SPEC-BANC-094 : (le faux test échoue bien)');
    const i = faux.echec.instantane;
    R.ok(i && i.graine === 20260921 && i.position && typeof i.position.x === 'number' && i.heure && i.meteo !== undefined && i.chunks && i.chunks.charges > 0 && i.files && i.workers && i.entites && i.reseau && Array.isArray(i.erreurs),
      'SPEC-BANC-094 : un test qui échoue produit un instantané (graine, position, heure, météo, chunks, files, workers, entités, mode réseau)', JSON.stringify(i).slice(0, 300));
    R.ok(i && i.chunks.versions && i.chunks.versions.echantillon && Object.keys(i.chunks.versions.echantillon).length > 0, 'SPEC-BANC-094 : avec les versions de chunk');
    R.ok(i && i.reseau.etat === 'hors ligne', 'SPEC-BANC-094 : et le mode réseau (« hors ligne » ici)');
    R.ok(faux.echec.vol && faux.echec.vol.length >= 2 && /TRACE RENDU étape 1 de faux-echec/.test(faux.echec.vol.join('\n')) && /DEBUG SYNC étape 2 de faux-echec/.test(faux.echec.vol.join('\n')),
      'SPEC-BANC-093 : le test en échec joint le contenu de son tampon circulaire, y compris des entrées trace et debug qui n\'apparaissent jamais à la console', JSON.stringify(faux.echec.vol).slice(0, 300));
    R.ok((faux.echec.erreursCachees || []).some(e => /exception tardive de faux-echec/.test(e.message)), 'SPEC-BANC-095 : l\'exception levée par le jeu PENDANT le test figure dans ses erreurs cachées, avec sa pile');
    R.ok(faux.echec.histogramme && Object.keys(faux.echec.histogramme).length > 3, 'SPEC-BANC-101 : l\'histogramme des temps d\'image accompagne un test en échec');
    R.eq(faux.lent.etat, 'reussi', 'SPEC-BANC-092 : (le faux lent réussit)');
    R.ok(faux.lent.vol && faux.lent.instantane, 'SPEC-BANC-092 : un test lent, même réussi, porte vol et instantané');
    R.eq(faux.bon.cles.length, 0, 'SPEC-BANC-092 : un test réussi et rapide ne porte aucun diagnostic');
    R.ok(faux.bon.metriques, 'SPEC-BANC-092 : seulement ses métriques', JSON.stringify(faux.bon.cles));
    const sans = await b.evaluer(`return MC.Journal.tampon({ test: 'faux-bon' }).length + ' ' + MC.Journal.configuration().sorties.join(',');`);
    R.ok(!/vol-e2e/.test(sans), 'SPEC-BANC-093 : aucune sortie « vol » ne reste branchée après les tests (' + sans + ')');

    // ── SPEC-BANC-102 : couches de la page, et — avec le vrai navigateur — le processus ──
    const info = await DIAG.lireInfoGPUProcessus(b.nav);
    R.ok(info.disponible && info.peripheriques.length > 0, 'SPEC-BANC-102 : CDP SystemInfo.getInfo donne le GPU et le pilote du processus', JSON.stringify(info).slice(0, 200));
    R.ok(info.fonctionnalites && typeof info.fonctionnalites === 'object', 'SPEC-BANC-102 : avec les fonctionnalités accélérées');
    const pj = await b.evaluer(`var g = ensureGame(); var ok = g.render.demarrerProfilGPU(); for (var i = 0; i < 40; i++) await new Promise(function (r) { requestAnimationFrame(r); }); var p = g.render.profilGPU(); g.render.arreterProfilGPU(); return { ext: ok, p: p };`);
    R.ok(pj.p.memoire.disponible && pj.p.memoire.octets_estimes > 0 && pj.p.memoire.geometries > 0, 'SPEC-BANC-102 : couche mémoire : géométries, textures et estimation en octets');
    R.ok(pj.p.dessin.disponible && pj.p.dessin.appels > 0 && pj.p.dessin.triangles > 0 && pj.p.dessin.programmes > 0 && pj.p.dessin.passes.principale.appels > 0, 'SPEC-BANC-102 : couche dessin : appels, triangles, programmes, par passe');
    if (pj.ext) R.ok(pj.p.temps_gpu.disponible && pj.p.temps_gpu.image.p50_ms >= 0 && pj.p.temps_gpu.image.p95_ms >= pj.p.temps_gpu.image.p50_ms, 'SPEC-BANC-102 : EXT_disjoint_timer_query_webgl2 exposée : temps GPU en p50 et p95', JSON.stringify(pj.p.temps_gpu).slice(0, 200));
    else R.ok(pj.p.temps_gpu.disponible === false && /EXT_disjoint_timer_query_webgl2/.test(pj.p.temps_gpu.raison) && pj.p.temps_gpu.passes === undefined, 'SPEC-BANC-102 : sans EXT_disjoint_timer_query_webgl2, la couche « temps GPU » dit « non disponible », jamais une valeur inventée', JSON.stringify(pj.p.temps_gpu));
    const trace = new DIAG.TraceGPU(b.nav);
    await trace.demarrer();
    await b.evaluer(`for (var i = 0; i < 30; i++) await new Promise(function (r) { requestAnimationFrame(r); });`);
    const dTrace = dossierTemp('mc-diag-trace-');
    const rt = await trace.arreter(dTrace, 'Un test lent');
    R.ok(rt === null || (rt.evenements > 0 && fs.existsSync(rt.source) && Array.isArray(JSON.parse(fs.readFileSync(rt.source, 'utf8')).traceEvents)), 'SPEC-BANC-102 : la trace des catégories gpu est un fichier « traceEvents » ouvrable dans le visualiseur de performances (ou absente si le navigateur n\'a rien tracé)');
    R.ok(DIAG.CATEGORIES_TRACE_GPU === 'gpu,disabled-by-default-gpu.service', 'SPEC-BANC-102 : catégories gpu et disabled-by-default-gpu.service');
  } catch (e) {
    R.ok(false, 'partie navigateur', e.stack || String(e));
  }
  b.fermer();
}

// ══════════════════════════════════════════════════════════════════════════
// 3. Une vraie campagne sans fenêtre : test lent → profil CPU et GPU (101, 102)
// ══════════════════════════════════════════════════════════════════════════
async function partieCampagne() {
  const selection = [
    { id: 'DIAG-1', nom: 'SPEC-BANC-084 : deux exécutions successives du même test visuel produisent des captures pixel-identiques', type: 'e2e', groupe: 'e2e', domaines: ['BANC'], specs: [], fiche: null },
    { id: 'DIAG-2', nom: 'le viseur coïncide avec le centre du canvas', type: 'e2e', groupe: 'e2e', domaines: [], specs: [], fiche: null },
  ];
  const pieces = path.join(RT.DOSSIER_PIECES, 'integration-' + process.pid + '-' + Date.now().toString(36));
  aNettoyer.dossiers.push(pieces);
  const resultat = await E2EH.executerCampagne(selection, {
    delaiDemarrageMs: 25000, delaiTestMs: 60000, delaiGlobalMs: 180000, seuilLentMs: 800, dossierPieces: pieces,
    ecrire: (t) => process.stderr.write(t + '\n'),
  });
  if (!resultat.ok) { R.ok(false, 'campagne sans fenêtre', resultat.motif); return; }
  const lent = resultat.tests[0], rapide = resultat.tests[1];
  R.ok(lent.duree_ms > 800 && lent.etat === 'ok', 'SPEC-BANC-101 : (le premier test dépasse le seuil de lenteur de la campagne : ' + lent.duree_ms + ' ms)');
  R.ok(rapide.duree_ms <= 800 && rapide.etat === 'ok', 'SPEC-BANC-101 : (et le second reste sous le seuil : ' + rapide.duree_ms + ' ms)');
  // profil CPU
  R.ok(lent.profilCPU && lent.profilCPU.source && fs.existsSync(lent.profilCPU.source), 'SPEC-BANC-101 : un test dépassant le seuil produit un fichier .cpuprofile', JSON.stringify(lent.profilCPU));
  let profil = null;
  try { profil = JSON.parse(fs.readFileSync(lent.profilCPU.source, 'utf8')); } catch (e) { /* illisible */ }
  R.ok(profil && DIAG.validerCpuprofile(profil), 'SPEC-BANC-101 : ouvrable dans les DevTools (nœuds, échantillons, écarts de temps cohérents)');
  R.ok(profil && profil.nodes.length > 10 && profil.samples.length > 10, 'SPEC-BANC-101 : et réellement échantillonné (' + (profil && profil.samples.length) + ' échantillons)');
  R.ok(lent.profilCPU.top && lent.profilCPU.top.length > 0, 'SPEC-BANC-101 : avec le palmarès des fonctions les plus lentes');
  R.ok(rapide.profilCPU === undefined && rapide.vol === undefined && rapide.instantane === undefined && rapide.profilGPU === undefined, 'SPEC-BANC-092 : le test rapide ne porte ni profil, ni vol, ni instantané');
  R.ok(rapide.metriques && rapide.metriques.images > 0, 'SPEC-BANC-092 : mais toujours ses métriques');
  // profil GPU en couches
  const gpu = lent.profilGPU;
  R.ok(gpu && gpu.couches, 'SPEC-BANC-102 : un test lent produit un profil GPU en couches');
  if (gpu) {
    const renseignees = DIAG.couchesRenseignees(gpu);
    R.ok(['memoire', 'dessin', 'processus'].every(c => renseignees.indexOf(c) >= 0), 'SPEC-BANC-102 : au moins les couches mémoire, dessin et processus sont renseignées (' + renseignees.join(', ') + ')');
    R.ok(gpu.couches.dessin.passes && gpu.couches.dessin.passes.principale, 'SPEC-BANC-102 : le coût de dessin est donné par passe');
    R.ok(gpu.couches.processus.peripheriques && gpu.couches.processus.peripheriques.length > 0, 'SPEC-BANC-102 : le processus donne le GPU et son pilote');
    const t = gpu.couches.temps_gpu;
    R.ok(t.disponible ? (t.image.p50_ms >= 0) : (/EXT_disjoint_timer_query_webgl2|non mesuré/.test(t.raison) && t.passes === undefined), 'SPEC-BANC-102 : temps GPU : mesuré en p50/p95, ou « non disponible » avec sa raison — jamais inventé', JSON.stringify(t).slice(0, 160));
    R.ok(gpu.couches.systeme.disponible === false && /fenêtre|Windows/.test(gpu.couches.systeme.raison), 'SPEC-BANC-102 : la couche système (typeperf) est « non disponible » sans fenêtre : ' + gpu.couches.systeme.raison);
    if (gpu.couches.processus.trace) R.ok(fs.existsSync(gpu.couches.processus.trace.source) && gpu.couches.processus.trace.evenements > 0, 'SPEC-BANC-102 : la trace GPU d\'un test lent est jointe');
  }
  R.ok(resultat.environnement.gpuProcessus && resultat.environnement.gpuProcessus.disponible, 'SPEC-BANC-102 : l\'environnement de la campagne porte le GPU vu du processus (SystemInfo.getInfo)');
  // jusqu'au cahier : pièces copiées, rapport
  const base = dossierTemp('mc-diag-cahier2-');
  const c = RT.ecrireCahier({ schema: 1, campagne: { preset: 'essai', seuilLentMs: 800, environnement: resultat.environnement }, tests: resultat.tests }, { captures: resultat.captures, racine: base });
  const j = JSON.parse(fs.readFileSync(path.join(c.dossierAbsolu, 'resultats.json'), 'utf8'));
  const jl = j.tests[0], jr = j.tests[1];
  R.ok(jl.profilCPU && /^profils\/.+\.cpuprofile$/.test(jl.profilCPU.fichier) && fs.existsSync(path.join(c.dossierAbsolu, jl.profilCPU.fichier)), 'SPEC-BANC-101 : le .cpuprofile est joint au cahier du test lent', JSON.stringify(jl.profilCPU));
  R.ok(jl.diagnostic_pour === 'lent', 'SPEC-BANC-092 : le cahier dit que c\'est la lenteur qui a déclenché les diagnostics');
  R.ok(jr.profilCPU === undefined && jr.profilGPU === undefined, 'SPEC-BANC-092 : et rien pour le test rapide');
  const html = fs.readFileSync(path.join(c.dossierAbsolu, 'rapport.html'), 'utf8');
  R.ok(/profil CPU/.test(html) && /couche GPU/.test(html) && /href="profils\//.test(html), 'SPEC-BANC-101/102 : le rapport montre le profil CPU (avec lien) et les couches GPU');
  R.ok(Object.keys(fs.readdirSync(pieces)).length === 0 || fs.readdirSync(pieces).every(f => !/cpuprofile/.test(f)), 'les pièces temporaires du profil sont consommées par le cahier');
}

(async () => {
  try { await partieServeur(); } catch (e) { R.ok(false, 'partie serveur', e.stack || String(e)); }
  if (!NAV.trouverNavigateur()) {
    R.saut('parties navigateur et campagne', 'aucun Edge/Chrome installé (tools/navigateur.js) — SPEC-BANC-095 à 099 et 101/102 non vérifiées ici');
  } else {
    try { await partieNavigateur(); } catch (e) { R.ok(false, 'partie navigateur', e.stack || String(e)); }
    try { await partieCampagne(); } catch (e) { R.ok(false, 'partie campagne', e.stack || String(e)); }
  }
  const code = R.fin();
  nettoyerTout();
  process.exit(code);
})();
