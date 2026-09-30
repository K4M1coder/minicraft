/* integration-archi-client.js — chantier ARCHI (L50), lot A0 : la page du jeu
   (index.html) face à son serveur de jeu local, dans un VRAI navigateur
   (Edge/Chrome sans fenêtre, piloté par CDP — tools/navigateur.js, tools/cdp.js),
   fenêtre de 1280×800 (jamais sous 800×600).

   Couvre SPEC-ARCHI-009 (la pause du serveur suit les menus, jamais l'inventaire),
   SPEC-ARCHI-005 (réseau ouvert/fermé depuis le menu), SPEC-ARCHI-008 (« Quitter le
   jeu » arrête le processus), SPEC-ARCHI-013 (les parties du menu vivent sur le
   serveur), SPEC-ARCHI-015 (import des parties du navigateur), SPEC-ARCHI-016
   (sans serveur de jeu : écran d'explication, aucune simulation), SPEC-ARCHI-017
   (écran d'attente à étapes, erreur au bout de 15 s), SPEC-ARCHI-039 (le menu
   pause lit ETAT_RESEAU).

   Sans navigateur installé le script s'ignore (code 0) avec un avertissement.
   Usage : node tests/integration-archi-client.js */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const A = require('./aide-integration-archi.js');
const { dodo, requete, lancer, dossierTemp, supprimerDossier, RACINE } = A;
const R = A.creerRapport('Intégration ARCHI — la page du jeu face à son serveur local (navigateur réel)');
const { ok, eq } = R;

let NAV = null, CDP = null;
try { NAV = require('../tools/navigateur.js'); CDP = require('../tools/cdp.js'); } catch (e) { NAV = null; }

const serveurs = [];
async function demarrer(args, env) { const s = await lancer(args, env); serveurs.push(s); return s; }

/* Serveur de fichiers « quelconque » (python -m http.server, npx serve…) :
   sert le dépôt tel quel, sans aucune API de jeu. `bloque` : la route
   /api/parties ne répond jamais (serveur volontairement bloqué). */
function serveurStatique(bloque) {
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
  const srv = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (bloque && url.indexOf('/api/parties') === 0) return;                // ne répond jamais
    const f = path.join(RACINE, url === '/' ? 'index.html' : decodeURIComponent(url));
    if (!f.startsWith(RACINE) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port })));
}

async function session(nav, url) {
  let cible = null;
  const liste = await CDP.listerCibles(nav.port);
  cible = liste.find(c => c.type === 'page') || await CDP.nouvelOnglet(nav.port, 'about:blank');
  const s = new CDP.SessionCDP(cible.webSocketDebuggerUrl);
  await s.connecter(15000);
  await s.envoyer('Page.enable', {}, 10000);
  await s.envoyer('Runtime.enable', {}, 10000);
  await s.envoyer('Emulation.setDeviceMetricsOverride', { width: nav.largeur, height: nav.hauteur, deviceScaleFactor: 1, mobile: false }, 10000);
  s.ev = async (expression) => {
    const r = await s.envoyer('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, 20000);
    if (r.exceptionDetails) throw new Error('évaluation : ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result && r.result.value;
  };
  s.aller = (u) => s.envoyer('Page.navigate', { url: u }, 20000);
  s.attendre = async (expression, ms, pas) => {
    const fin = Date.now() + (ms || 15000);
    while (Date.now() < fin) {
      try { if (await s.ev(expression)) return true; } catch (e) { /* page en cours de chargement */ }
      await dodo(pas || 100);
    }
    return false;
  };
  return s;
}

async function etatApi(port) {
  const r = await requete(port, '/api/parties');
  return r.json;
}

// ── 016 : sans serveur de jeu ────────────────────────────────────────────────
async function scenarioSansServeur(nav) {
  const stat = await serveurStatique(false);
  const s = await session(nav, '');
  try {
    await s.aller('http://127.0.0.1:' + stat.port + '/index.html');
    const affiche = await s.attendre("document.querySelector('#boot h1') && document.querySelector('#boot h1').textContent.indexOf('serveur') >= 0", 20000);
    ok(affiche, 'SPEC-ARCHI-016 : sur un serveur de fichiers sans API de jeu, l\'écran d\'explication s\'affiche');
    const txt = await s.ev("document.getElementById('boot').innerText");
    ok(/node server\.js/.test(txt) && /start\.cmd|start\.sh/.test(txt), 'SPEC-ARCHI-016 : il dit comment lancer le jeu (node server.js, start.cmd, start.sh)', txt.slice(0, 200));
    eq(await s.ev("getComputedStyle(document.getElementById('boot')).display !== 'none'"), true, 'SPEC-ARCHI-016 : l\'écran reste affiché (pas de jeu derrière)');
    eq(await s.ev("typeof window.GAME"), 'undefined', 'SPEC-ARCHI-016 : MC.createGame n\'a pas été appelé (aucun jeu créé)');
    eq(await s.ev("document.querySelectorAll('.mc-surface, canvas').length"), 0, 'SPEC-ARCHI-016 : aucune surface de rendu ni simulation démarrée');
    ok(await s.ev("!!document.querySelector('#boot-actions button')"), 'SPEC-ARCHI-017 : une action (Réessayer) est proposée');
    // file:// : même écran
    const chemin = 'file:///' + path.join(RACINE, 'index.html').replace(/\\/g, '/');
    await s.aller(chemin);
    ok(await s.attendre("document.querySelector('#boot h1') && document.querySelector('#boot h1').textContent.indexOf('serveur') >= 0", 20000), 'SPEC-ARCHI-016 : ouvert en file://, même écran d\'explication');
    eq(await s.ev("typeof window.GAME"), 'undefined', 'SPEC-ARCHI-016 : et aucun jeu en file://');
  } finally { s.fermer(); stat.srv.close(); }
}

// ── 017 : serveur volontairement bloqué → erreur au bout de 15 s ─────────────
async function scenarioBloque(nav) {
  const stat = await serveurStatique(true);
  const s = await session(nav, '');
  try {
    const t0 = Date.now();
    await s.aller('http://127.0.0.1:' + stat.port + '/index.html');
    ok(await s.attendre("document.getElementById('boot').innerText.indexOf('Serveur de jeu') >= 0 && !!document.querySelector('.etape')", 10000), 'SPEC-ARCHI-017 : pendant l\'attente, l\'écran montre les étapes (Serveur de jeu…)');
    ok(await s.ev("getComputedStyle(document.getElementById('boot')).display !== 'none'"), 'SPEC-ARCHI-017 : l\'écran d\'attente est visible pendant le chargement');
    const erreur = await s.attendre("document.querySelector('#boot h1') && document.querySelector('#boot h1').textContent.indexOf('injoignable') >= 0", 40000, 250);
    const duree = Date.now() - t0;
    ok(erreur, 'SPEC-ARCHI-017 : serveur bloqué → message « Serveur injoignable »');
    ok(duree >= 14000 && duree <= 30000, 'SPEC-ARCHI-017 : ... au bout d\'environ 15 s', duree + ' ms');
    ok(/node server\.js/.test(await s.ev("document.getElementById('boot').innerText")), 'SPEC-ARCHI-017 : la cause et l\'action sont écrites à l\'écran');
    eq(await s.ev("typeof window.GAME"), 'undefined', 'SPEC-ARCHI-017 : aucun jeu n\'est démarré');
  } finally { s.fermer(); stat.srv.close(); }
}

// ── le vrai parcours : menu, partie, pause, réseau, import, quitter ──────────
function exportSolo() {
  const MC = A.chargerModules();
  const st = (function () {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
  })();
  ['Solo Un', 'Solo Deux'].forEach((nom, i) => {
    const meta = MC.Saves.creer(st, { nom, graine: 700 + i, mode: 'survie', difficulte: 'facile' });
    const w = MC.createWorld(700 + i);
    w.getChunk(0, 0, true);
    const ents = MC.createEntities(w);
    const regles = MC.Modes.regles('survie', 'facile');
    const pl = MC.createPlayer(w, ents, regles);
    MC.Saves.sauvegarder(st, meta.id, { world: w, player: pl, entities: ents, time: 100, furnaces: {}, chests: {}, regles, duree: 5 });
  });
  const brut = {};
  ['minicraft.parties.v2'].forEach(k => { brut[k] = st.getItem(k); });
  MC.Saves.lister(st).forEach(m => { brut[MC.Saves.slotKey(m.id)] = st.getItem(MC.Saves.slotKey(m.id)); });
  return brut;
}

async function scenarioParcours(nav) {
  const dossier = dossierTemp('mc-archi-c-');
  const serveur = await demarrer(['--port', '0', '--dossier-parties', dossier]);
  const P = serveur.port;
  const s = await session(nav, '');
  const console_ = [];
  s.sur('Runtime.exceptionThrown', (p) => console_.push(p.exceptionDetails && (p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text)));
  try {
    // préparation : des parties « solo » dans le localStorage de CETTE origine (SPEC-ARCHI-015 a)
    await s.aller('http://127.0.0.1:' + P + '/index.html');
    ok(await s.attendre("!!document.querySelector('#boot .etape')", 15000, 20), 'SPEC-ARCHI-017 : l\'écran d\'attente est présent dès le chargement de la page');
    eq(await s.ev("document.querySelectorAll('#boot .etape').length"), 3, 'SPEC-ARCHI-017 : trois étapes visibles (chargement, serveur, connexion)');
    const pret = await s.attendre("typeof window.GAME !== 'undefined' && getComputedStyle(document.getElementById('boot')).display === 'none' && !!document.querySelector('#btn-nouvelle')", 60000);
    ok(pret, 'SPEC-ARCHI-017 : l\'écran d\'attente est remplacé par le menu du jeu');
    ok(await s.ev("!!document.querySelector('#btn-arret') && !!document.querySelector('#btn-import-fichier')"), 'SPEC-ARCHI-013 : le menu offre « Quitter le jeu » et « Importer un fichier »');
    ok(/fermé \(vous seul\)/.test(await s.ev("document.querySelector('.panel .sub').innerText")), 'SPEC-ARCHI-039 : le menu affiche le réseau « fermé (vous seul) » (ETAT_RESEAU)');
    const api0 = await etatApi(P);
    eq(api0.monde.pause, true, 'SPEC-ARCHI-009 : au menu principal le serveur est en pause');
    eq(api0.parties.length, 0, 'SPEC-ARCHI-013 : la liste des parties vient du serveur (vide)');

    // 015 (a) : des parties du navigateur, sur la même origine, sont proposées à l'import
    const brut = exportSolo();
    await s.ev("(function () { var b = " + JSON.stringify(brut) + "; Object.keys(b).forEach(function (k) { localStorage.setItem(k, b[k]); }); })()");
    await s.aller('http://127.0.0.1:' + P + '/index.html');
    ok(await s.attendre("!!document.querySelector('#btn-import-locales')", 60000), 'SPEC-ARCHI-015 : le menu propose d\'importer les parties trouvées dans ce navigateur');
    ok(/2 parties trouvées/.test(await s.ev("document.querySelector('.bandeau').innerText")), 'SPEC-ARCHI-015 : le bandeau compte les 2 parties');
    await s.ev("document.querySelector('#btn-import-locales').click()");
    ok(await s.attendre("document.querySelectorAll('.parties .charger').length === 2", 20000), 'SPEC-ARCHI-015 : après l\'import, les 2 parties apparaissent dans le menu (serveur)');
    eq((await etatApi(P)).parties.length, 2, 'SPEC-ARCHI-015 : le serveur les a rangées sur disque');
    eq(await s.ev("!!document.querySelector('#btn-import-locales')"), false, 'SPEC-ARCHI-015 : le bandeau ne revient plus une fois l\'import fait');

    // 013 : créer une partie par l'interface, l'écran d'attente montre les étapes
    await s.ev("document.querySelector('#btn-nouvelle').click()");
    ok(await s.attendre("!!document.querySelector('#btn-creer')", 5000), 'SPEC-ARCHI-013 : formulaire de création');
    await s.ev("document.querySelector('#f-nom').value = 'Ma partie test'; document.querySelector('#btn-creer').click()");
    ok(await s.attendre("!!document.querySelector('#ecran-attente .etape')", 15000, 30), 'SPEC-ARCHI-017 : le chargement de la partie montre ses étapes (serveur, connexion, terrain)');
    const jouee = await s.attendre("window.GAME.net.etat === 'en ligne' && window.GAME.input.state === 'playing' && !document.querySelector('#ecran-attente')", 90000, 250);
    ok(jouee, 'SPEC-ARCHI-006 : le client se connecte au serveur local comme à un serveur distant (en ligne) et la partie démarre');
    const api1 = await etatApi(P);
    ok(!!api1.actif && api1.parties.some(p => p.id === api1.actif && p.nom === 'Ma partie test'), 'SPEC-ARCHI-013 : la partie créée est la partie active du serveur');
    eq(api1.monde.pause, false, 'SPEC-ARCHI-009 : en jeu le serveur n\'est pas en pause');
    eq(await s.ev("window.GAME.poste.etatReseau(false)"), 'ferme', 'SPEC-ARCHI-039 : ETAT_RESEAU = fermé');

    // 009 : pause du poste
    await s.ev("window.GAME.input.setState('paused')");
    await dodo(500);
    eq((await etatApi(P)).monde.pause, true, 'SPEC-ARCHI-009 : le menu pause met le serveur en pause');
    ok(/fermé \(vous seul\)/.test(await s.ev("document.querySelector('.panel .sub').innerText")), 'SPEC-ARCHI-039 : le menu pause affiche « fermé (vous seul) »');
    // 005 : ouvrir puis fermer le réseau depuis le menu
    await s.ev("document.querySelector('#btn-reseau').click()");
    ok(await s.attendre("document.querySelector('#btn-reseau') && document.querySelector('#btn-reseau').innerText.indexOf('Fermer') >= 0", 8000), 'SPEC-ARCHI-005 : « Ouvrir au réseau » devient « Fermer au réseau »');
    const api2 = await etatApi(P);
    eq(api2.reseau, 'ouvert', 'SPEC-ARCHI-005 : le serveur est ouvert');
    eq(api2.monde.pause, false, 'SPEC-ARCHI-009 : ouvrir au réseau lève la pause (aucune pause en mode ouvert)');
    ok(/ouvert au réseau/.test(await s.ev("document.querySelector('.panel .sub').innerText")), 'SPEC-ARCHI-039 : le menu pause affiche « ouvert au réseau »');
    await s.ev("document.querySelector('#btn-reseau').click()");
    ok(await s.attendre("document.querySelector('#btn-reseau') && document.querySelector('#btn-reseau').innerText.indexOf('Ouvrir') >= 0", 8000), 'SPEC-ARCHI-005 : refermé depuis le menu');
    eq((await etatApi(P)).reseau, 'ferme', 'SPEC-ARCHI-005 : le serveur est de nouveau fermé, sans redémarrage');
    ok(await s.ev("window.GAME.net.etat === 'en ligne'"), 'SPEC-ARCHI-005 : la connexion de jeu locale a survécu à l\'ouverture puis à la fermeture');

    // 009 : reprise, puis l'inventaire ne met PAS en pause
    await s.ev("window.GAME.input.setState('playing')");
    await dodo(500);
    eq((await etatApi(P)).monde.pause, false, 'SPEC-ARCHI-009 : la reprise relance le serveur');
    const rev = (await etatApi(P)).monde.rev;
    await s.ev("window.GAME.input.setState('ui')");
    await dodo(500);
    const apiUi = await etatApi(P);
    ok(apiUi.monde.pause === false && apiUi.monde.rev === rev, 'SPEC-ARCHI-009 : ouvrir l\'inventaire ne déclenche aucun PAUSE (le monde continue)');
    await s.ev("window.GAME.input.setState('playing')");

    // 013 : retour au menu principal (la partie reste sur le serveur), puis reprise
    await s.ev("window.GAME.input.setState('paused')");
    await dodo(300);
    await s.ev("document.querySelector('#btn-quit').click()");
    ok(await s.attendre("!!document.querySelector('.parties') && window.GAME.net.etat === 'hors ligne'", 15000), 'SPEC-ARCHI-013 : « Menu principal » quitte la partie du serveur et rend la liste des parties');
    eq((await etatApi(P)).monde.pause, true, 'SPEC-ARCHI-009 : le retour au menu met le serveur en pause');
    ok(await s.ev("document.querySelectorAll('.parties .charger').length === 3"), 'SPEC-ARCHI-013 : les 3 parties (2 importées + 1 créée) sont listées');

    // 008 : « Quitter le jeu » arrête le processus serveur
    await s.ev("document.querySelector('#btn-arret').click()");
    const code = await Promise.race([serveur.sortie, dodo(8000).then(() => 'trop long')]);
    eq(code, 0, 'SPEC-ARCHI-008 : « Quitter le jeu » arrête le processus serveur (code 0)');
    ok(await s.attendre("document.body.innerText.indexOf('Jeu arrêté') >= 0", 8000), 'SPEC-ARCHI-008 : la page annonce que le jeu est arrêté');
    const erreurs = console_.filter(Boolean);
    ok(erreurs.length === 0, 'aucune exception JavaScript non rattrapée pendant le parcours', erreurs.slice(0, 2).join(' | '));
  } finally { s.fermer(); supprimerDossier(dossier); }
}

(async function () {
  let nav = null;
  try {
    if (!NAV) { console.log('tools/navigateur.js indisponible — suite ignorée'); process.exit(0); }
    try { nav = await NAV.lancer({ largeur: 1280, hauteur: 800 }); }
    catch (e) { console.log('AVERTISSEMENT : aucun navigateur Edge/Chrome utilisable (' + e.message + ') — suite ignorée'); process.exit(0); }
    await CDP.attendrePortPret(nav.port, 20000);
    const tous = { sansserveur: scenarioSansServeur, bloque: scenarioBloque, parcours: scenarioParcours };
    const choix = process.argv[2] ? [process.argv[2]] : Object.keys(tous);
    for (const k of choix) await tous[k](nav);
  } catch (e) {
    R.ok(false, 'exception non prévue', (e && e.stack) || String(e));
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
    if (nav) { try { NAV.arreterProprement(nav); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
