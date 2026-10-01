/* integration-archi-reseau.js — lot B-RESEAU du chantier « solo = serveur
   toujours présent » : SPEC-ARCHI-029, 036, 037, 038, 039 (l. 2629 et 2642), 040
   et le prérequis SPEC-SYNC-025, sur de vrais processus server.js FERMÉS au
   réseau (comme le solo) puis, pour la page du jeu, dans un VRAI navigateur
   (Edge/Chrome sans fenêtre, 1280×800 — jamais sous 800×600).

   Partie serveur (sans navigateur) :
   - 029 : `/faction` est arbitrée par le serveur fermé ; l'appartenance revient
     dans BIENVENUE à la reconnexion (même guilde) ;
   - 036 : POST /api/parties/sauver écrit la partie sur demande, refuse toute
     origine ou tout hôte non local, est espacée, et répond 409 sans partie ;
   - 038 : OVERRIDES_DEMANDE est traitée par le serveur fermé.
   Partie navigateur (ignorée sans navigateur) :
   - 037 : une position fausse imposée au client est corrigée par le serveur ;
   - 038 : le client demande les overrides des chunks qu'il charge ;
   - 036 : « Sauvegarder » écrit le fichier du serveur, le client n'écrit rien
     dans localStorage, et la FERMETURE BRUTALE de l'onglet (sans crochet
     beforeunload) ne perd rien : le serveur sauvegarde au départ du dernier
     client ;
   - 039 : /qui liste les joueurs connectés, réseau ouvert comme fermé ;
   - audit statique de src/game.js (029, 036, 037, 038, 040).

   Usage : node tests/integration-archi-reseau.js */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./aide-integration-archi.js');
const { dodo, requete, lancer, rejoindre, dossierTemp, supprimerDossier, RACINE } = A;
const R = A.creerRapport('Intégration ARCHI — B-RESEAU : factions, sauvegarde, prédiction, overrides, joueurs');
const { ok, eq } = R;

let NAV = null, CDP = null;
try { NAV = require('../tools/navigateur.js'); CDP = require('../tools/cdp.js'); } catch (e) { NAV = null; }

const serveurs = [];
async function demarrer(args, env) { const s = await lancer(['--port', '0'].concat(args || []), env); serveurs.push(s); return s; }
async function sonder(fn, ms, pas) {
  const fin = Date.now() + (ms || 8000);
  for (;;) {
    let v = false;
    try { v = await fn(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() >= fin) return false;
    await dodo(pas || 40);
  }
}
/* Crée puis charge une partie sur un serveur lancé avec --dossier-parties. */
async function chargerPartie(port, corps) {
  const id = (await requete(port, '/api/parties', { corps })).json.partie.id;
  await requete(port, '/api/parties/charger', { corps: { id } });
  const actif = await sonder(async () => ((await requete(port, '/api/parties')).json || {}).actif === id, 30000, 100);
  return actif ? id : null;
}
/* Tous les fichiers .json du dossier des parties qui contiennent l'état d'un monde. */
function fichiersMonde(dossier) {
  const out = [];
  (function parcourir(d) {
    let liste = [];
    try { liste = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    liste.forEach(e => {
      const f = path.join(d, e.name);
      if (e.isDirectory()) parcourir(f);
      else if (/\.json$/.test(e.name)) {
        try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j && Array.isArray(j.overrides)) out.push({ f, j }); } catch (e2) { /* en cours d'écriture */ }
      }
    });
  })(dossier);
  return out;
}
const aBloc = (dossier, x, y, z) => fichiersMonde(dossier).some(m => m.j.overrides.some(o => o[0] === x && o[1] === y && o[2] === z));

// ── 029 : factions arbitrées par le serveur fermé ────────────────────────────
async function scenarioFactions() {
  const s = await demarrer([]);
  const a = await rejoindre(s.port, 'Alice', 1);
  eq(a.bienvenue.guilde, null, 'SPEC-ARCHI-029 : sans faction, BIENVENUE annonce guilde = null (aucun état local par défaut)');
  a.client.envoyer({ t: 'chat', texte: '/faction creer Braves' });
  const rep = await a.client.attendre('chat', 4000, m => /Braves/.test(m.texte || '')).catch(() => null);
  ok(!!rep && /fondée/.test(rep.texte), 'SPEC-ARCHI-029 : /faction creer en solo fermé est arbitrée par le serveur, qui confirme la création', rep && rep.texte);
  a.client.fermer();
  ok(await A.attendreClients(s.port, 0, 8000), 'préparation : le serveur a constaté le départ d\'Alice');
  let b = null;
  await sonder(async () => { try { b = await rejoindre(s.port, 'Alice', 1); return true; } catch (e) { return false; } }, 10000, 200);
  ok(!!b && !!b.bienvenue.guilde && b.bienvenue.guilde.nom === 'Braves' && b.bienvenue.guilde.rang === 'chef',
    'SPEC-ARCHI-029 / SYNC-025 : à la reconnexion BIENVENUE annonce la même guilde, confirmée par le serveur', JSON.stringify(b && b.bienvenue.guilde));
  if (b) b.client.fermer();
  await s.arreter();
}

// ── 036 : demande de sauvegarde ──────────────────────────────────────────────
async function scenarioSauvegarde() {
  const dossier = dossierTemp('mc-archi-r1-');
  try {
    const s = await demarrer(['--dossier-parties', dossier], { MC_SAUVEGARDE_MS: '600000' });
    const r0 = await requete(s.port, '/api/parties/sauver', { corps: {} });
    eq(r0.code, 409, 'SPEC-ARCHI-036 : sans partie active, la demande de sauvegarde est refusée (409)');
    const id = await chargerPartie(s.port, { nom: 'Sauv', graine: 31, mode: 'creatif' });
    ok(!!id, 'préparation : la partie est chargée par le serveur');
    const a = await rejoindre(s.port, 'Alice', 1);
    const p = a.bienvenue.toi[0];
    const bx = Math.floor(p.x), by = Math.floor(p.y) + 3, bz = Math.floor(p.z);
    a.client.envoyer({ t: 'bloc', x: bx, y: by, z: bz, id: 9, j: 0 });
    await a.client.attendre('chat', 200).catch(() => null);
    ok(!aBloc(dossier, bx, by, bz), 'préparation : rien n\'est encore écrit (cadence 10 min)');
    // on attend que le serveur ait traité la pose (ordre des messages d'une connexion) avant de demander
    a.client.envoyer({ t: 'chat', texte: 'marqueur' });
    ok(await sonder(() => s.logs.some(l => /<Alice> marqueur/.test(l)), 6000), 'préparation : la pose est traitée');
    const r1 = await requete(s.port, '/api/parties/sauver', { corps: {} });
    ok(r1.code === 200 && r1.json.ok === true && r1.json.ecrite === true, 'SPEC-ARCHI-036 : la demande de sauvegarde répond ok et a écrit', r1.corps);
    ok(aBloc(dossier, bx, by, bz), 'SPEC-ARCHI-036 : le fichier de partie du serveur contient le bloc posé');
    const r2 = await requete(s.port, '/api/parties/sauver', { corps: {} });
    eq(r2.code, 429, 'SPEC-ARCHI-036 : une seconde demande dans la seconde est refusée (429) — la sérialisation bloque la boucle');
    await dodo(1100);
    const r3 = await requete(s.port, '/api/parties/sauver', { corps: {}, entetes: { Origin: 'http://evil.example' } });
    eq(r3.code, 403, 'SPEC-ARCHI-036 : une page tierce (Origin étrangère) ne peut pas déclencher de sauvegarde');
    const r4 = await requete(s.port, '/api/parties/sauver', { corps: {}, entetes: { Host: 'evil.example' } });
    eq(r4.code, 403, 'SPEC-ARCHI-036 : un en-tête Host étranger est refusé (pas de privilège sur la seule adresse locale)');
    const r5 = await requete(s.port, '/api/parties/sauver', { corps: {}, methode: 'GET' });
    ok(r5.code === 405 || r5.code === 200 && r5.json && r5.json.parties, 'SPEC-ARCHI-036 : la sauvegarde n\'est pas déclenchable par un simple GET');
    a.client.fermer();
    await s.arreter();
  } finally { supprimerDossier(dossier); }

  // réseau OUVERT : un joueur distant (adresse non locale) ne peut pas demander la sauvegarde
  const dossier2 = dossierTemp('mc-archi-r2-');
  try {
    const ext = A.adressesNonLocales().filter(x => x.indexOf(':') < 0)[0];
    if (!ext) { ok(true, 'SPEC-ARCHI-036 : (aucune interface non locale sur ce poste — vérification du réseau ouvert ignorée)'); return; }
    const s = await demarrer(['--ouvert', '--dossier-parties', dossier2]);
    await chargerPartie(s.port, { nom: 'Ouv', graine: 5 });
    const r = await requete(s.port, '/api/parties/sauver', { corps: {}, hote: ext, entetes: { Host: ext + ':' + s.port } });
    ok(r.code === 403, 'SPEC-ARCHI-036 : sur un serveur ouvert, une demande venant d\'une adresse non locale est refusée', 'code ' + r.code);
    await s.arreter();
  } finally { supprimerDossier(dossier2); }
}

// ── 038 : le serveur fermé traite OVERRIDES_DEMANDE ──────────────────────────
async function scenarioOverrides() {
  const s = await demarrer([]);
  const a = await rejoindre(s.port, 'Alice', 1);
  const p = a.bienvenue.toi[0];
  const bx = Math.floor(p.x), by = Math.floor(p.y) + 3, bz = Math.floor(p.z);
  a.client.envoyer({ t: 'bloc', x: bx, y: by, z: bz, id: 9, j: 0 });
  await a.client.attendre('bloc', 3000, m => m.x === bx && m.y === by && m.z === bz);
  a.client.envoyer({ t: 'overrides_demande', cx: Math.floor(bx / 16), cz: Math.floor(bz / 16) });
  const rep = await a.client.attendre('overrides_chunk', 4000).catch(() => null);
  ok(!!rep && (rep.blocs || []).some(b => b[0] === bx && b[1] === by && b[2] === bz && b[3] === 9),
    'SPEC-ARCHI-038 : en solo fermé, OVERRIDES_DEMANDE est traitée par le serveur local (OVERRIDES_CHUNK avec le bloc posé)');
  a.client.fermer();
  await s.arreter();
}

// ── la page du jeu, dans un vrai navigateur ──────────────────────────────────
async function ouvrirOnglet(nav) {
  const cible = await CDP.nouvelOnglet(nav.port, 'about:blank');
  const s = new CDP.SessionCDP(cible.webSocketDebuggerUrl);
  await s.connecter(15000);
  await s.envoyer('Page.enable', {}, 10000);
  await s.envoyer('Runtime.enable', {}, 10000);
  await s.envoyer('Emulation.setDeviceMetricsOverride', { width: nav.largeur, height: nav.hauteur, deviceScaleFactor: 1, mobile: false }, 10000);
  s.cibleId = cible.id;
  s.ev = async (expression) => {
    const r = await s.envoyer('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, 30000);
    if (r.exceptionDetails) throw new Error('évaluation : ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result && r.result.value;
  };
  s.aller = (u) => s.envoyer('Page.navigate', { url: u }, 20000);
  s.attendre = (expression, ms, pas) => sonder(() => s.ev(expression), ms || 15000, pas || 100);
  return s;
}

async function scenarioPage(nav) {
  const dossier = dossierTemp('mc-archi-r3-');
  // cadence de 10 minutes : seule la FERMETURE du dernier client peut sauvegarder pendant le test
  const serveur = await demarrer(['--dossier-parties', dossier], { MC_SAUVEGARDE_MS: '600000' });
  const P = serveur.port;
  const s = await ouvrirOnglet(nav);
  const erreursJs = [];
  s.sur('Runtime.exceptionThrown', (p) => erreursJs.push(p.exceptionDetails && (p.exceptionDetails.exception ? p.exceptionDetails.exception.description : p.exceptionDetails.text)));
  let ferme = false;
  try {
    await s.aller('http://127.0.0.1:' + P + '/index.html');
    ok(await s.attendre("typeof window.GAME !== 'undefined' && !!document.querySelector('#btn-nouvelle')", 90000, 200), 'préparation : la page du jeu affiche son menu');
    const cles0 = await s.ev('Object.keys(localStorage).sort().join(",")');
    await s.ev("document.querySelector('#btn-nouvelle').click()");
    ok(await s.attendre("!!document.querySelector('#btn-creer')", 8000), 'préparation : formulaire de création');
    await s.ev("document.querySelector('#f-nom').value = 'Partie reseau'; document.querySelector('#btn-creer').click()");
    const jouee = await s.attendre("window.GAME.net.etat === 'en ligne' && window.GAME.input.state === 'playing' && !document.querySelector('#ecran-attente')", 120000, 250);
    ok(jouee, 'préparation : la partie démarre (connexion de jeu au serveur local)');
    if (!jouee) return;
    ok(await s.attendre("window.GAME.equipe[0].player.state.pos.y > 0 && window.GAME.equipe[0].prediction.suivant > 5", 30000), 'SPEC-ARCHI-037 : le joueur prédit son mouvement (les entrées partent au serveur à chaque image)');

    /* 037 + 038 : on impose au client une position FAUSSE (comme une prédiction qui
       aurait dérapé). Le serveur, qui tient la vraie, la corrige (réconciliation) ; et
       les chunks voulus autour de la fausse position déclenchent des OVERRIDES_DEMANDE.
       Espions posés sur net.demanderOverrides et MC.Synchro.reconcilier. */
    const ref = await s.ev("(function () { var st = window.GAME.equipe[0].player.state; return { x: st.pos.x, z: st.pos.z }; })()");
    await s.ev("(function () { var n = window.GAME.net, o = n.demanderOverrides; window.__ov = { appels: 0, envoyes: 0 }; n.demanderOverrides = function (cx, cz) { window.__ov.appels++; var r = o.call(n, cx, cz); if (r) window.__ov.envoyes++; return r; }; " +
      "var S = MC.Synchro, rc = S.reconcilier; window.__ecartMax = 0; S.reconcilier = function () { var e = rc.apply(S, arguments); if (e > window.__ecartMax) window.__ecartMax = e; return e; }; })()");
    let demandes = false;
    for (let k = 1; k <= 12 && !demandes; k++) {           // la correction peut précéder l'image qui charge : on réessaie, chaque fois plus loin
      await s.ev("(function () { var st = window.GAME.equipe[0].player.state; st.pos.x = " + (ref.x + 200 * k) + "; })()");
      demandes = await s.attendre("window.__ov.envoyes > 0", 1500, 30);
    }
    ok(demandes, 'SPEC-ARCHI-038 : en solo fermé, un chunk voulu déclenche une OVERRIDES_DEMANDE envoyée au serveur local');
    ok(await s.attendre("window.__ecartMax > 20", 15000), 'SPEC-ARCHI-037 : en solo fermé, le serveur corrige une prédiction fausse (écart réconcilié > 20 blocs)');
    ok(await s.attendre("Math.abs(window.GAME.equipe[0].player.state.pos.x - " + ref.x + ") < 5", 15000), 'SPEC-ARCHI-037 : la position du joueur est revenue à celle du serveur');

    // 036 : « Sauvegarder » écrit le fichier du serveur, le client n'écrit rien dans localStorage
    const bloc1 = await s.ev("(function () { var g = window.GAME, st = g.equipe[0].player.state, x = Math.floor(st.pos.x), y = Math.floor(st.pos.y) + 3, z = Math.floor(st.pos.z); g.world.setBlock(x, y, z, 9); g.net.poserBloc(x, y, z, 9, 0, 0); g.net.envoyerChat('marqueur-un'); return { x: x, y: y, z: z }; })()");
    ok(await sonder(() => serveur.logs.some(l => /marqueur-un/.test(l)), 15000), 'préparation : le serveur a traité la pose (bloc 1)');
    ok(!aBloc(dossier, bloc1.x, bloc1.y, bloc1.z), 'préparation : le bloc 1 n\'est pas encore sur disque (cadence de 10 minutes, jeu en cours)');
    const rep = await s.ev("window.GAME.demanderSauvegarde(true).then(function (r) { return JSON.stringify(r); })");
    ok(/"ok":true/.test(rep), 'SPEC-ARCHI-036 : « Sauvegarder » (demanderSauvegarde) est acceptée par le serveur', rep);
    ok(aBloc(dossier, bloc1.x, bloc1.y, bloc1.z), 'SPEC-ARCHI-036 : « Sauvegarder » a écrit le fichier de partie du SERVEUR (le bloc 1 y est)');
    const cles1 = await s.ev('Object.keys(localStorage).sort().join(",")');
    const sansPseudo = (c) => c.split(',').filter(k => k && k !== 'minicraft.pseudo').join(',');
    eq(sansPseudo(cles1), sansPseudo(cles0), 'SPEC-ARCHI-036 : le client n\'a écrit aucune partie dans localStorage (seul le pseudo peut apparaître)');
    ok(!/partie|save/.test(sansPseudo(cles1)), 'SPEC-ARCHI-036 : aucune clé de partie dans localStorage');
    eq(await s.ev("typeof window.GAME.doSave"), 'undefined', 'SPEC-ARCHI-036 : le client n\'a plus de doSave');

    // 039 : /qui liste les joueurs, réseau ouvert (un second joueur est admis) comme fermé
    await s.ev("(function () { var g = window.GAME; window.__sys = []; var o = g.chat.systeme; g.chat.systeme = function (t) { window.__sys.push(String(t)); return o.apply(g.chat, arguments); }; g.traiterMessage({ texte: '/qui' }); })()");
    ok(await s.attendre("window.__sys.some(function (t) { return /En ligne : vous \\(seul\\)/.test(t); })", 5000), 'SPEC-ARCHI-039 : /qui répond « En ligne » (jamais « Hors ligne ») en solo fermé');
    await s.ev("window.GAME.input.setState('paused')");
    ok(await s.attendre("!!document.querySelector('#btn-reseau')", 8000), 'préparation : menu pause');
    await s.ev("document.querySelector('#btn-reseau').click()");
    ok(await s.attendre("document.querySelector('#btn-reseau') && document.querySelector('#btn-reseau').innerText.indexOf('Fermer') >= 0", 10000), 'préparation : réseau ouvert');
    await s.ev("window.GAME.input.setState('playing')");
    const bob = await rejoindre(P, 'Bob', 1);
    ok(await s.attendre("window.GAME.net.distants.size === 1", 8000), 'préparation : le joueur distant est connu de la page');
    await s.ev("window.__sys.length = 0; window.GAME.traiterMessage({ texte: '/qui' })");
    ok(await s.attendre("window.__sys.some(function (t) { return /En ligne : vous, Bob/.test(t); })", 5000), 'SPEC-ARCHI-039 : /qui liste les joueurs connectés (la liste est toujours affichée)');
    ok(await s.ev("window.GAME.net.enLigne()"), 'SPEC-ARCHI-039 : net.enLigne() reste vrai, réseau ouvert');
    bob.client.fermer();
    await s.ev("window.GAME.input.setState('paused')");
    await s.ev("document.querySelector('#btn-reseau').click()");
    ok(await s.attendre("document.querySelector('#btn-reseau') && document.querySelector('#btn-reseau').innerText.indexOf('Ouvrir') >= 0", 10000), 'préparation : réseau refermé');
    ok(await s.ev("window.GAME.net.enLigne()"), 'SPEC-ARCHI-039 : net.enLigne() reste vrai, réseau fermé');
    await s.ev("window.GAME.input.setState('playing')");

    // 036 (d) : FERMETURE BRUTALE de l'onglet — un bloc posé après la dernière sauvegarde survit
    const bloc2 = await s.ev("(function () { var g = window.GAME, st = g.equipe[0].player.state, x = Math.floor(st.pos.x) + 2, y = Math.floor(st.pos.y) + 3, z = Math.floor(st.pos.z); g.world.setBlock(x, y, z, 9); g.net.poserBloc(x, y, z, 9, 0, 0); g.net.envoyerChat('marqueur-deux'); return { x: x, y: y, z: z }; })()");
    ok(await sonder(() => serveur.logs.some(l => /marqueur-deux/.test(l)), 15000), 'préparation : le serveur a traité la pose (bloc 2)');
    ok(!aBloc(dossier, bloc2.x, bloc2.y, bloc2.z), 'préparation : le bloc 2 n\'est pas encore sur disque');
    try { await CDP.fermerOnglet(nav.port, s.cibleId); } catch (e) { /* « Target is closing » n'est pas du JSON */ }            // l'onglet disparaît sans aucun évènement de page exploitable
    ferme = true;
    ok(await sonder(() => aBloc(dossier, bloc2.x, bloc2.y, bloc2.z), 40000, 100),
      'SPEC-ARCHI-036 : après la fermeture brutale de l\'onglet (sans beforeunload), le serveur a sauvegardé au départ du dernier client — le bloc 2 est sur disque');
    ok(await sonder(() => serveur.logs.some(l => /sauvegarde du monde \(dernier client\)/.test(l)), 5000),
      'SPEC-ARCHI-036 : c\'est la sauvegarde « dernier client » du serveur qui l\'a écrit', serveur.logs.slice(-6).join(' | '));
    const erreurs = erreursJs.filter(Boolean);
    ok(erreurs.length === 0, 'aucune exception JavaScript non rattrapée pendant le parcours', erreurs.slice(0, 2).join(' | '));
  } finally {
    if (!ferme) { try { await CDP.fermerOnglet(nav.port, s.cibleId); } catch (e) { /* déjà fermé */ } }
    try { s.fermer(); } catch (e) { /* déjà fermé */ }
    await serveur.arreter();
    supprimerDossier(dossier);
  }
}

// ── revue B-RESEAU : index des overrides, /sauver en vol, départ en mode ouvert, mandataire, séparation ──
async function scenarioIndexOverrides() {
  const s = await demarrer([]);
  const a = await rejoindre(s.port, 'Alice', 1);
  const p = a.bienvenue.toi[0];
  const bx = Math.floor(p.x), by = Math.floor(p.y) + 3, bz = Math.floor(p.z);
  for (let k = 0; k < 3; k++) {
    a.client.envoyer({ t: 'bloc', x: bx, y: by + k, z: bz, id: 9, j: 0 });
    await a.client.attendre('bloc', 3000, m => m.x === bx && m.y === by + k && m.z === bz);
  }
  const cx = Math.floor(bx / 16), cz = Math.floor(bz / 16);
  const demander = async (x, z) => {
    const avant = a.client.depuis();
    a.client.envoyer({ t: 'overrides_demande', cx: x, cz: z });
    return sonder(() => avant('overrides_chunk').find(m => m.cx === x && m.cz === z), 4000).then(v => v || null);
  };
  const r1 = await demander(cx, cz);
  eq(r1 && r1.blocs.filter(b => b[3] === 9).length, 3, 'SPEC-SERVEUR-009 : l\'index par chunk renvoie exactement les 3 blocs posés dans le chunk');
  const r2 = await demander(cx + 2, cz);
  eq(r2 && r2.blocs.length, 0, 'SPEC-SERVEUR-009 : un autre chunk ne renvoie rien de ce chunk');
  a.client.envoyer({ t: 'bloc', x: bx, y: by + 1, z: bz, id: 0, j: 0 });
  await a.client.attendre('bloc', 3000, m => m.x === bx && m.y === by + 1 && m.z === bz && m.id === 0);
  const r3 = await demander(cx, cz);
  ok(!!r3 && r3.blocs.filter(b => b[3] === 9).length === 2 && !r3.blocs.some(b => b[1] === by + 1 && b[3] !== 0), 'SPEC-SERVEUR-009 : casser un bloc met l\'index à jour (2 blocs restent)');
  // demandes invalides : jamais de réponse, le serveur reste debout
  const avant = a.client.depuis();
  ['x', null, 1.5, 1e12, -1e12, {}].forEach(v => a.client.envoyer({ t: 'overrides_demande', cx: v, cz: 0 }));
  a.client.envoyer({ t: 'overrides_demande', cx: 0 });
  const r4 = await demander(cx, cz);
  ok(!!r4 && avant('overrides_chunk').filter(m => m.cx !== cx || m.cz !== cz).length === 0, 'SPEC-SERVEUR-009 : cx/cz non entiers ou hors bornes sont refusés sans réponse');
  a.client.fermer();
  await s.arreter();
}

async function scenarioSauverEnVol() {
  const dossier = dossierTemp('mc-archi-r4-');
  try {
    const s = await demarrer(['--dossier-parties', dossier], { MC_SAUVEGARDE_MS: '600000', MC_TEST_SAUVEGARDE_LENTE_MS: '4500' });
    await chargerPartie(s.port, { nom: 'Vol', graine: 8, mode: 'creatif' });
    const a = await rejoindre(s.port, 'Alice', 1);
    const p = a.bienvenue.toi[0];
    const bx = Math.floor(p.x), by = Math.floor(p.y) + 3, bz = Math.floor(p.z);
    a.client.envoyer({ t: 'bloc', x: bx, y: by, z: bz, id: 9, j: 0 });
    a.client.envoyer({ t: 'chat', texte: 'un' });
    ok(await sonder(() => s.logs.some(l => /<Alice> un$/.test(l)), 6000), 'préparation : bloc 1 traité');
    const t0 = Date.now();
    const premiere = requete(s.port, '/api/parties/sauver', { corps: {} });          // écriture n° 1 : en vol pendant 2,5 s
    a.client.envoyer({ t: 'bloc', x: bx + 1, y: by, z: bz, id: 9, j: 0 });
    a.client.envoyer({ t: 'chat', texte: 'deux' });
    ok(await sonder(() => s.logs.some(l => /<Alice> deux$/.test(l)), 6000), 'préparation : bloc 2 traité pendant l\'écriture');
    ok(await sonder(() => Date.now() - t0 > 2200, 4000, 50), 'préparation : plus d\'une seconde écoulée');
    const seconde = await requete(s.port, '/api/parties/sauver', { corps: {} });
    ok(seconde.code === 200 && seconde.json.ok === true, 'SPEC-ARCHI-036 : la seconde demande répond', seconde.code + ' ' + seconde.corps);
    ok(aBloc(dossier, bx + 1, by, bz), 'SPEC-ARCHI-036 : ok:true n\'est annoncé qu\'une fois le bloc 2 sur disque (pas à la fin de l\'écriture antérieure)');
    await premiere;
    a.client.fermer();
    await s.arreter();
  } finally { supprimerDossier(dossier); }
}

async function scenarioDepartOuvert() {
  const dossier = dossierTemp('mc-archi-r5-');
  try {
    const s = await demarrer(['--ouvert', '--dossier-parties', dossier], { MC_SAUVEGARDE_MS: '600000' });
    await chargerPartie(s.port, { nom: 'Ouvert', graine: 9, mode: 'creatif' });
    const a = await rejoindre(s.port, 'Alice', 1);
    const b = await rejoindre(s.port, 'Bob', 1);
    const p = a.bienvenue.toi[0];
    const bx = Math.floor(p.x), by = Math.floor(p.y) + 3, bz = Math.floor(p.z);
    a.client.envoyer({ t: 'bloc', x: bx, y: by, z: bz, id: 9, j: 0 });
    a.client.envoyer({ t: 'chat', texte: 'pose' });
    ok(await sonder(() => s.logs.some(l => /<Alice> pose$/.test(l)), 6000), 'préparation : bloc traité');
    ok(!aBloc(dossier, bx, by, bz), 'préparation : rien sur disque (cadence 10 min)');
    b.client.socket.destroy();
    ok(await sonder(() => aBloc(dossier, bx, by, bz), 10000, 100), 'SPEC-ARCHI-012 : en mode ouvert, le départ d\'un joueur déclenche une sauvegarde (débounce 1,5 s)');
    a.client.fermer();
    await s.arreter();
  } finally { supprimerDossier(dossier); }
}

async function scenarioMandataire() {
  const dossier = dossierTemp('mc-archi-r6-');
  try {
    const s = await demarrer(['--dossier-parties', dossier]);
    for (const en of ['X-Forwarded-For', 'Forwarded', 'X-Real-Ip']) {
      const e = {}; e[en] = '203.0.113.9';
      const r1 = await requete(s.port, '/api/parties', { entetes: e });
      const r2 = await requete(s.port, '/api/parties/sauver', { corps: {}, entetes: e });
      ok(r1.code === 403 && r2.code === 403, 'SPEC-ARCHI-002 : l\'API des parties refuse un en-tête de mandataire (' + en + ')', r1.code + '/' + r2.code);
    }
    eq((await requete(s.port, '/api/parties')).code, 200, 'contrôle : sans en-tête de mandataire, la boucle locale est admise');
    await s.arreter();
  } finally { supprimerDossier(dossier); }
}

async function scenarioSeparation() {
  const s = await demarrer([], { MC_TEST_MOB: 'sheep' });
  const a = await rejoindre(s.port, 'Alice', 1);
  for (let i = 1; i <= 40; i++) {
    a.client.envoyer({ t: 'e', s: i, j: 0, dt: 0.016, k: 0, yaw: 0, pitch: 0, v: 0 });
    await dodo(20);
  }
  const etat = await sonder(() => { const e = a.client.dernier('etat'); return e && e.toi && e.toi[0].s >= 35 && e; }, 6000);
  const mob = etat && (etat.mobs || []).find(m => m.t === 'sheep');
  ok(!!etat && !!mob, 'préparation : le serveur diffuse la créature de test');
  if (etat && mob) {
    const d = Math.hypot(etat.toi[0].x - mob.x, etat.toi[0].z - mob.z);
    ok(d >= 0.5, 'SPEC-ARCHI-037 : une créature et le joueur ne se chevauchent pas (distance ' + d.toFixed(2) + ' au lieu de 0,3 au départ)');
    // SPEC-ARCHI-047 : c'est la créature qui cède — le corps du joueur, prédit par son client, ne bouge pas
    const t0 = a.bienvenue.toi[0];
    ok(Math.hypot(etat.toi[0].x - t0.x, etat.toi[0].z - t0.z) < 0.01, 'SPEC-ARCHI-047 : le serveur ne pousse pas le joueur immobile (déplacement ' + Math.hypot(etat.toi[0].x - t0.x, etat.toi[0].z - t0.z).toFixed(3) + ')');
  }
  a.client.fermer();
  await s.arreter();
}

// ── audit statique de src/game.js ───────────────────────────────────────────
function scenarioAudit() {
  const src = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
  const sansCommentaires = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\/\/[^\n'"]*$/gm, '');
  const corps = (nom) => {
    const m = new RegExp('\\n( *)function ' + nom + '\\(').exec(sansCommentaires);
    if (!m) return null;
    const debut = m.index + 1;
    const fin = sansCommentaires.indexOf('\n' + m[1] + '}', debut);
    return sansCommentaires.slice(debut, fin);
  };
  ok(!/creerEtat\(\)/.test(sansCommentaires) && !/MC\.Guildes/.test(sansCommentaires), 'SPEC-ARCHI-029 (audit) : game.js n\'instancie plus MC.Guildes.creerEtat() ni ne l\'appelle');
  ok(!/\bdoSave\b/.test(sansCommentaires) && !/Saves\.sauvegarder/.test(sansCommentaires), 'SPEC-ARCHI-036 (audit) : plus de doSave ni d\'écriture de partie (MC.Saves.sauvegarder) dans game.js');
  ok(!/beforeunload/.test(sansCommentaires), 'SPEC-ARCHI-036 (audit) : plus de crochet beforeunload dans game.js');
  ok(!/minicraft\.partie/.test(sansCommentaires), 'SPEC-ARCHI-036 (audit) : game.js n\'écrit pas de clé minicraft.partie*');
  const sj = corps('simulerJoueur');
  ok(!!sj && !/updateMovement\(/.test(sj) && /prediction\.enregistrer/.test(sj) && !/net\.enLigne\(\)\s*&&\s*j\.prediction/.test(sj),
    'SPEC-ARCHI-037 (audit) : simulerJoueur n\'applique aucun déplacement hors de la prédiction (plus de updateMovement direct)');
  const sc = corps('streamChunks');
  ok(!!sc && /demanderOverrides/.test(sc) && !/net\.enLigne\(\)/.test(sc), 'SPEC-ARCHI-038 (audit) : streamChunks demande les overrides sans condition sur net.enLigne()');
  const fr = corps('frameReseau');
  ok(!!fr && /net\.interpoler\(dt\)/.test(fr) && !/\bif\b/.test(fr), 'SPEC-ARCHI-040 (audit) : frameReseau appelle net.interpoler(dt) sans condition');
  const ctx = corps('contexteCommande');
  ok(!!ctx && !/net\.enLigne\(\)/.test(ctx), 'SPEC-ARCHI-039 (audit) : le contexte des commandes ne lit plus net.enLigne()');
  const fa = (/function actionCommandeFaction\([^)]*\) \{[^}]*\}/.exec(sansCommentaires) || [''])[0];
  ok(/envoyerChat/.test(fa) && !/net\.enLigne\(\)/.test(fa),'SPEC-ARCHI-029 (audit) : /faction est toujours envoyée au serveur');
}

(async () => {
  let nav = null;
  try {
    scenarioAudit();
    await scenarioFactions();
    await scenarioSauvegarde();
    await scenarioOverrides();
    await scenarioIndexOverrides();
    await scenarioSauverEnVol();
    await scenarioDepartOuvert();
    await scenarioMandataire();
    await scenarioSeparation();
    if (!NAV) console.log('tools/navigateur.js indisponible — partie navigateur ignorée');
    else {
      try { nav = await NAV.lancer({ largeur: 1280, hauteur: 800 }); }
      catch (e) { console.log('AVERTISSEMENT : aucun navigateur Edge/Chrome utilisable (' + e.message + ') — partie navigateur ignorée'); nav = null; }
      if (nav) { await CDP.attendrePortPret(nav.port, 20000); await scenarioPage(nav); }
    }
  } catch (e) {
    ok(false, 'le scénario ne doit pas lever d\'exception', e && e.stack);
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
    if (nav) { try { NAV.arreterProprement(nav); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
