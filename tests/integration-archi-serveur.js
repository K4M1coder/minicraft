/* integration-archi-serveur.js — chantier ARCHI (L50), lot A0 : le serveur
   local FERMÉ au réseau, sur de vrais processus `server.js` (jamais require()d)
   et de vraies sockets.

   Couvre SPEC-ARCHI-001 (serveur toujours présent, index servi, BIENVENUE),
   002 (liaison 127.0.0.1 et ::1 seulement), 003 (contrôle d'Origin), 004
   (port stable, repli, --port 0, port occupé), 005 (ouverture/fermeture à
   chaud), 006 (même protocole local et ouvert), 007 (un seul poste en fermé,
   capacité identique), 009 à 011 (pause exacte, reprise sans rattrapage,
   BIENVENUE.pause).

   Usage : node tests/integration-archi-serveur.js */
'use strict';
const FORMAT_IDS = require('./format-ids.js').FIRST_ITEM;   // SPEC-SAVE-025 : annoncé par REJOINDRE
const A = require('./aide-integration-archi.js');
const { CA, dodo, connecter, requete, sonde, lancer, rejoindre, attendreClients, dossierTemp, supprimerDossier } = A;
const R = A.creerRapport('Intégration ARCHI — serveur local fermé au réseau (SPEC-ARCHI-001 à 011)');
const { ok, eq } = R;

const serveurs = [];
async function demarrer(args, env) {
  const s = await lancer(args, env);
  serveurs.push(s);
  return s;
}

async function scenarioPortEtLiaison() {
  const dossier = dossierTemp('mc-archi-a-');
  try {
    // ── 004 : port stable 8080 (repli jusqu'à 8099) — sans paramètre de port
    const libre8080 = (await sonde(8080, '127.0.0.1')) !== 'ok';
    const s1 = await demarrer(['--dossier-parties', dossier]);
    ok(s1.port >= 8080 && s1.port <= 8099, 'SPEC-ARCHI-004 : sans --port, le port est dans 8080..8099', 'port ' + s1.port);
    if (libre8080) eq(s1.port, 8080, 'SPEC-ARCHI-004 : 8080 libre → 8080 exactement');
    else R.saut('SPEC-ARCHI-004 : 8080 exactement', '8080 occupé sur cette machine');
    const s2 = await demarrer(['--dossier-parties', dossier + '-2']);
    ok(s2.port > s1.port && s2.port <= 8099, 'SPEC-ARCHI-004 : un second serveur prend le port libre suivant', s1.port + ' puis ' + s2.port);
    ok(s1.logs.some(l => /port \d+/.test(l) && l.indexOf('écoute') >= 0), 'SPEC-ARCHI-004 : le port est annoncé dans le journal');

    // ── 004 : port imposé occupé → code non nul et message clair
    const s3 = A.RACINE && require('child_process').spawnSync(process.execPath, [require('path').join(A.RACINE, 'server.js'), '--port', String(s1.port), '--dossier-parties', dossier + '-3'],
      { cwd: A.RACINE, encoding: 'utf8', timeout: 20000 });
    ok(s3.status !== 0 && s3.status !== null, 'SPEC-ARCHI-004 : port imposé occupé → code de sortie non nul', 'code ' + s3.status);
    ok(/déjà utilisé/.test(s3.stdout || ''), 'SPEC-ARCHI-004 : message clair (port déjà utilisé)', (s3.stdout || '').slice(0, 200));

    // ── 004 : --port 0 → MC_PORT= égal au port réellement ouvert
    const s4 = await demarrer(['--port', '0', '--dossier-parties', dossier + '-4']);
    ok(s4.port > 0 && (await requete(s4.port, '/index.html')).code === 200, 'SPEC-ARCHI-004 : --port 0 imprime MC_PORT= et ce port sert bien le jeu', 'port ' + s4.port);

    // ── 001 : le serveur par défaut sert index.html et répond BIENVENUE
    eq((await requete(s1.port, '/index.html')).code, 200, 'SPEC-ARCHI-001 : index.html servi (200)');
    const { client, bienvenue } = await rejoindre(s1.port, 'Alice', 1);
    ok(typeof bienvenue.graine === 'number' && bienvenue.reseau === 'ferme', 'SPEC-ARCHI-001 : BIENVENUE reçu en boucle locale, réseau fermé par défaut');
    client.fermer();

    // ── 002 : liaison explicite 127.0.0.1 ET ::1, jamais 0.0.0.0
    const ecoute = s1.logs.find(l => l.indexOf('écoute :') >= 0) || '';
    ok(/127\.0\.0\.1/.test(ecoute) && !/0\.0\.0\.0|toutes les interfaces/.test(ecoute), 'SPEC-ARCHI-002 : le journal annonce 127.0.0.1 (pas 0.0.0.0)', ecoute);
    eq(await sonde(s1.port, '127.0.0.1'), 'ok', 'SPEC-ARCHI-002 : 127.0.0.1 accepte la connexion');
    const v6 = ecoute.indexOf('::1') >= 0;
    if (v6) eq(await sonde(s1.port, '::1'), 'ok', 'SPEC-ARCHI-002 : ::1 accepte la connexion');
    else R.saut('SPEC-ARCHI-002 : ::1', 'IPv6 de boucle locale indisponible sur cette machine');
    const externes = A.adressesNonLocales();
    if (!externes.length) R.saut('SPEC-ARCHI-002 : adresses non locales', 'aucune interface réseau externe');
    for (const adr of externes) {
      const r = await sonde(s4.port, adr);                     // port 0 : jamais celui d'un serveur ouvert qui occuperait 8080 sur cette machine
      ok(r !== 'ok', 'SPEC-ARCHI-002 : ' + adr + ' ne peut pas se connecter (' + r + ')', 'connexion acceptée depuis ' + adr);
      ok(r === 'ECONNREFUSED' || r === 'delai' || r === 'ETIMEDOUT' || r === 'EHOSTUNREACH', 'SPEC-ARCHI-002 : ' + adr + ' → refus de connexion', 'code ' + r);
    }
    await s1.arreter(); await s2.arreter(); await s4.arreter();
  } finally { [dossier, dossier + '-2', dossier + '-3', dossier + '-4'].forEach(supprimerDossier); }
}

async function scenarioOrigine() {
  const dossier = dossierTemp('mc-archi-o-');
  try {
    const s = await demarrer(['--port', '0', '--dossier-parties', dossier]);
    const P = s.port;
    // WebSocket : Origin tierce → 403 ; origines locales → 101 ; absente → 101
    let e = null;
    try { (await connecter(P, { origine: 'http://exemple.invalid' })).fermer(); } catch (x) { e = x; }
    ok(e && e.message === 'http 403', 'SPEC-ARCHI-003 : Origin http://exemple.invalid → 403', e && e.message);
    const bad = await connecter(P, { origine: 'http://exemple.invalid' }).then(c => { c.fermer(); return true; }, () => false);
    ok(!bad, 'SPEC-ARCHI-003 : aucune BIENVENUE possible depuis une origine tierce');
    for (const o of CA.originesLocales(P)) {
      const c = await connecter(P, { origine: o }).then(x => x, () => null);
      ok(!!c, 'SPEC-ARCHI-003 : Origin ' + o + ' → 101');
      if (c) c.fermer();
    }
    const sans = await connecter(P, {}).then(x => x, () => null);
    ok(!!sans, 'SPEC-ARCHI-003 : sans Origin (client non navigateur en boucle locale) → 101');
    if (sans) sans.fermer();
    // rebond DNS : un Host qui n'est pas local est refusé
    const rebond = await connecter(P, { hoteHttp: 'evil.example:' + P }).then(c => { c.fermer(); return true; }, () => false);
    ok(!rebond, 'SPEC-ARCHI-003 : un en-tête Host non local est refusé (rebond DNS)');
    // même règle sur /api/parties
    eq((await requete(P, '/api/parties', { entetes: { Origin: 'http://exemple.invalid' } })).code, 403, 'SPEC-ARCHI-003 : /api/parties depuis une origine tierce → 403');
    eq((await requete(P, '/api/parties', { entetes: { Origin: 'http://localhost:' + P } })).code, 200, 'SPEC-ARCHI-003 : /api/parties avec Origin http://localhost:P → 200');
    eq((await requete(P, '/api/parties')).code, 200, 'SPEC-ARCHI-003 : /api/parties sans Origin → 200');
    eq((await requete(P, '/api/parties', { corps: { nom: 'x' }, entetes: { Origin: 'http://exemple.invalid' } })).code, 403, 'SPEC-ARCHI-003 : écriture sur /api/parties depuis une origine tierce → 403');
    await s.arreter();
  } finally { supprimerDossier(dossier); }
}

async function scenarioReseauAChaud() {
  const dossier = dossierTemp('mc-archi-r-');
  try {
    const s = await demarrer(['--port', '0', '--max-joueurs', '3', '--dossier-parties', dossier]);
    const P = s.port;
    // ── 007 : un poste à 2 joueurs locaux (2/3), un second poste refusé en fermé
    const a = await rejoindre(P, 'Alice', 2);
    eq(a.bienvenue.toi.length, 2, 'SPEC-ARCHI-007 : un poste de 2 joueurs locaux est admis (2/3)');
    const b = await connecter(P);
    b.envoyer({ t: 'rejoindre', formatIds: FORMAT_IDS, nom: 'Bob', locaux: 1 });
    const refus = await b.attendre('refus', 3000).catch(() => null);
    eq(refus && refus.motif, 'poste_deja_connecte', 'SPEC-ARCHI-007 : en fermé, un second poste est refusé (poste_deja_connecte)');
    b.fermer();
    await dodo(100);
    ok(a.client.messages.filter(m => m.t === 'arrive').length === 0, 'SPEC-ARCHI-007 : le refus ne perturbe pas le poste connecté');

    // ── 005 : ouverture à chaud
    const lan = A.adresseReseau();
    if (lan) ok(await sonde(P, lan) !== 'ok', 'SPEC-ARCHI-005 : avant ouverture, l\'adresse réseau est fermée');
    a.client.envoyer({ t: 'reseau', ouvert: true });
    const ouvert = await a.client.attendre('reseau_etat', 4000, m => m.etat === 'ouvert');
    ok(ouvert.port === P && Array.isArray(ouvert.adresses), 'SPEC-ARCHI-005 : RESEAU_ETAT {ouvert} porte le port et les adresses');
    ok(CA.validerReseauEtat(ouvert) !== null, 'SPEC-ARCHI-019 : RESEAU_ETAT respecte le contrat');
    // le client local est resté connecté et continue de recevoir l'état
    const depuisOuverture = a.client.depuis();
    await dodo(400);
    ok(depuisOuverture('etat').length > 5, 'SPEC-ARCHI-005 : le client local reste connecté et joue sans interruption', 'ETAT reçus ' + depuisOuverture('etat').length);

    // ── 007 (ouvert) : mêmes règles de capacité que SPEC-SERVEUR-010
    const c2 = await connecter(P);
    c2.envoyer({ t: 'rejoindre', formatIds: FORMAT_IDS, nom: 'Carl', locaux: 2 });
    const plein = await c2.attendre('refus', 3000).catch(() => null);
    eq(plein && plein.motif, 'serveur_complet', 'SPEC-ARCHI-007 : ouvert, un poste à 2 refusé quand il ne reste qu\'une place (serveur_complet)');
    c2.fermer();
    const d = await rejoindre(P, 'Dora', 1);
    ok(!!d.bienvenue, 'SPEC-ARCHI-007 : ouvert, un poste à 1 joueur est admis dans la place restante');
    eq(d.bienvenue.reseau, 'ouvert', 'SPEC-ARCHI-006 : BIENVENUE annonce le réseau ouvert');

    if (lan) {
      d.client.fermer(); await dodo(200);          // libère la place de Dora pour Eve
      const distant = await rejoindre(P, 'Eve', 1, { hote: lan }).catch(x => x);
      ok(distant && distant.bienvenue, 'SPEC-ARCHI-005 : ouvert, une connexion depuis l adresse réseau aboutit', String(distant));
      const ev = distant && distant.client;
      ok(!!ev, 'SPEC-ARCHI-005 : le joueur distant est connecté');
      if (ev) {
        const av = ev.depuis();
        ev.envoyer({ t: 'reseau', ouvert: false });
        ev.envoyer({ t: 'arret' });
        ev.envoyer({ t: 'pause', actif: true });
        await dodo(600);
        eq(av('reseau_etat').length, 0, 'SPEC-ARCHI-005 : un RESEAU venu d\'une connexion non locale est ignoré');
        ok(s.vivant, 'SPEC-ARCHI-008 : un ARRET venu d\'une connexion non locale est ignoré (le processus vit)');
        eq((await requete(P, '/api/parties', { hote: lan })).code, 403, 'SPEC-ARCHI-013 : /api/parties depuis une connexion non locale → 403');
        // fermeture : le distant est expulsé (reseau_ferme), le local reste
        const avA = a.client.depuis();
        a.client.envoyer({ t: 'reseau', ouvert: false });
        const ferme = await a.client.attendre('reseau_etat', 4000, m => m.etat === 'ferme');
        ok(!!ferme, 'SPEC-ARCHI-005 : RESEAU {ouvert:false} → RESEAU_ETAT {ferme}');
        const expulse = await ev.attendre('refus', 3000).catch(() => null);
        eq(expulse && expulse.motif, 'reseau_ferme', 'SPEC-ARCHI-005 : le client distant est expulsé avec le motif reseau_ferme');
        await dodo(300);
        ok(ev.fermee, 'SPEC-ARCHI-005 : sa connexion est coupée');
        await dodo(300);
        ok(avA('etat').length > 5, 'SPEC-ARCHI-005 : le client local reste connecté et joue après la fermeture', 'ETAT ' + avA('etat').length);
        ok(await sonde(P, lan) !== 'ok', 'SPEC-ARCHI-005 : l\'adresse réseau est de nouveau fermée');
      }
    } else {
      R.saut('SPEC-ARCHI-005 : connexion depuis une adresse non locale', 'aucune interface réseau externe');
      a.client.envoyer({ t: 'reseau', ouvert: false });
      await a.client.attendre('reseau_etat', 4000, m => m.etat === 'ferme');
    }
    eq((await requete(P, '/index.html')).code, 200, 'SPEC-ARCHI-005 : le serveur sert toujours le jeu après ouverture puis fermeture (même processus)');
    ok(s.vivant, 'SPEC-ARCHI-005 : aucun redémarrage du processus');
    a.client.fermer(); d.client.fermer();
    await s.arreter();
  } finally { supprimerDossier(dossier); }
}

// ── 009 à 011 : pause exacte ─────────────────────────────────────────────────
async function etatMonde(port) {
  const r = await requete(port, '/api/parties');
  return r.json && r.json.monde;
}
async function scenarioPause() {
  const dossier = dossierTemp('mc-archi-p-');
  const fichier = require('path').join(dossier, 'monde.json');
  try {
    const s = await demarrer(['--port', '0', '--monde', fichier, '--dossier-parties', dossier], { MC_GRACE_ARRET_MS: '6000' });
    const P = s.port;
    const a = await rejoindre(P, 'Alice', 2);            // écran partagé : la pause porte sur le POSTE
    const cl = a.client;
    await dodo(600);
    const toi0 = cl.dernier('etat').toi.map(t => ({ x: t.x, y: t.y, z: t.z }));

    // ── 009 : PAUSE → PAUSE_ETAT
    cl.envoyer({ t: 'pause', actif: true });
    const p1 = await cl.attendre('pause_etat', 3000, m => m.actif === true);
    ok(CA.validerPauseEtat(p1) !== null && p1.actif === true, 'SPEC-ARCHI-009 : PAUSE {actif:true} → PAUSE_ETAT {actif:true, rev}');
    await dodo(150);
    const m0 = await etatMonde(P);
    ok(m0 && m0.pause === true, 'SPEC-ARCHI-010 : le serveur est en pause');
    const apres = cl.depuis();
    // messages de jeu envoyés PENDANT la pause : sans effet
    for (let i = 1; i <= 60; i++) for (let j = 0; j < 2; j++) cl.envoyer({ t: 'e', s: 1000 + i, j, dt: 0.016, k: 1, yaw: 0, pitch: 0, v: 0 });
    const bx = Math.floor(toi0[0].x), by = Math.floor(toi0[0].y) + 3, bz = Math.floor(toi0[0].z);
    cl.envoyer({ t: 'bloc', x: bx, y: by, z: bz, id: 9 });
    cl.ping();
    cl.envoyer({ t: 'chat', texte: 'bonjour en pause' });
    await dodo(3000);
    const m1 = await etatMonde(P);
    ok(Math.abs(m1.heure - m0.heure) < 0.02, 'SPEC-ARCHI-010 : l\'heure du monde est identique 3 s plus tard', m0.heure + ' → ' + m1.heure);
    eq(m1.sigCreatures, m0.sigCreatures, 'SPEC-ARCHI-010 : la position des créatures est identique 3 s plus tard');
    ok(apres('etat').length <= 1, 'SPEC-ARCHI-010 : aucun ETAT diffusé pendant la pause (hors le dernier)', 'ETAT ' + apres('etat').length);
    ok(apres('bloc').length === 0, 'SPEC-ARCHI-010 : un BLOC reçu en pause est ignoré');
    ok(cl.pongs >= 1, 'SPEC-ARCHI-010 : les ping sont répondus pendant la pause');
    ok(apres('chat').some(m => m.texte === 'bonjour en pause'), 'SPEC-ARCHI-010 : le CHAT continue de fonctionner en pause');

    // ── 011 : reprise exacte
    cl.envoyer({ t: 'pause', actif: false });
    const p2 = await cl.attendre('pause_etat', 3000, m => m.actif === false);
    ok(p2.rev > p1.rev, 'SPEC-ARCHI-009 : PAUSE {actif:false} → PAUSE_ETAT {actif:false} avec une révision plus grande');
    const etatReprise = await cl.attendre('etat', 3000, m => m.heure !== undefined && cl.messages.indexOf(m) > cl.messages.indexOf(p2));
    const dh = etatReprise.heure - m1.heure;
    ok(dh >= -0.1 && dh < 0.5, 'SPEC-ARCHI-011 : après 3 s de pause l\'heure a avancé de moins de 0,5 s à la reprise', 'écart ' + dh.toFixed(3) + ' s');
    const toi1 = etatReprise.toi;
    ok(toi1.every((t, i) => Math.hypot(t.x - toi0[i].x, t.z - toi0[i].z) < 0.05), 'SPEC-ARCHI-010 : les ENTREE reçues en pause n\'ont pas déplacé les joueurs (les 2 joueurs locaux)', JSON.stringify(toi1.map(t => [t.x, t.z])) + ' vs ' + JSON.stringify(toi0.map(t => [t.x, t.z])));
    // les deux joueurs locaux redeviennent actifs : le serveur accuse (s) leurs nouvelles entrées
    ok(toi1.every(t => t.s < 1000), 'SPEC-ARCHI-010 : aucune ENTREE reçue en pause n a ete accusee (j=0 et j=1)', JSON.stringify(toi1.map(t => t.s)));
    let seq = 2000;
    for (let i = 0; i < 30; i++) { for (let j = 0; j < 2; j++) cl.envoyer({ t: 'e', s: ++seq, j, dt: 0.016, k: 1, yaw: 0, pitch: 0, v: 0 }); await dodo(16); }
    await dodo(300);
    const fin = cl.dernier('etat').toi;
    ok(fin.every(t => t.s > 2000), 'SPEC-ARCHI-011 : à la reprise les deux joueurs locaux (j=0 et j=1) rejouent normalement', JSON.stringify(fin.map(t => t.s)));

    // ── 011 : reconnexion pendant une pause volontaire → BIENVENUE.pause === true
    cl.envoyer({ t: 'pause', actif: true });
    await cl.attendre('pause_etat', 3000, m => m.actif === true && cl.messages.indexOf(m) > cl.messages.indexOf(p2));
    await dodo(200);
    cl.fermer();
    await attendreClients(P, 0);
    const hPause = (await etatMonde(P)).heure;
    const b = await rejoindre(P, 'Alice', 1);
    eq(b.bienvenue.pause, true, 'SPEC-ARCHI-011 : BIENVENUE.pause === true quand on se reconnecte pendant une pause');
    await dodo(1200);
    const hApres = (await etatMonde(P)).heure;
    ok(Math.abs(hApres - hPause) < 0.02, 'SPEC-ARCHI-011 : la partie ne bouge pas avant PAUSE {actif:false}', hPause + ' → ' + hApres);
    b.client.envoyer({ t: 'pause', actif: false });
    await b.client.attendre('pause_etat', 3000, m => m.actif === false);
    await dodo(600);
    ok((await etatMonde(P)).heure - hApres > 0.3, 'SPEC-ARCHI-011 : la partie reprend après PAUSE {actif:false}');

    // ── 011 : un départ sans pause (onglet fermé) met le serveur en pause ; l'actualisation reprend la partie
    b.client.fermer();
    await attendreClients(P, 0);
    const mAbs = await etatMonde(P);
    ok(mAbs.pause === true, 'SPEC-ARCHI-008 : sans client, le serveur fermé est mis en pause');
    const c = await rejoindre(P, 'Alice', 1);
    eq(c.bienvenue.pause, false, 'SPEC-ARCHI-008 : une reconnexion dans le délai de grâce reprend la partie (actualisation de page)');
    ok(s.vivant, 'SPEC-ARCHI-008 : aucune terminaison pendant la reconnexion');
    c.client.fermer();
    await s.arreter();
  } finally { supprimerDossier(dossier); }
}

async function scenarioOuvertSansPause() {
  const dossier = dossierTemp('mc-archi-q-');
  try {
    const s = await demarrer(['--port', '0', '--ouvert', '--dossier-parties', dossier], { MC_GRACE_ARRET_MS: '800' });
    const a = await rejoindre(s.port, 'Alice', 1);
    eq(a.bienvenue.reseau, 'ouvert', 'SPEC-ARCHI-001 : --ouvert lance le serveur directement ouvert');
    const h0 = (await etatMonde(s.port)).heure;
    a.client.envoyer({ t: 'pause', actif: true });
    const rep = await a.client.attendre('pause_etat', 3000);
    eq(rep.actif, false, 'SPEC-ARCHI-009 : en mode ouvert PAUSE est ignorée et répond PAUSE_ETAT {actif:false}');
    await dodo(1000);
    const h1 = (await etatMonde(s.port)).heure;
    ok(h1 - h0 > 0.8, 'SPEC-ARCHI-009 : en mode ouvert l\'heure du monde continue d\'avancer', h0 + ' → ' + h1);
    // le départ du dernier client ne termine rien en mode ouvert
    a.client.fermer();
    await dodo(2500);
    ok(s.vivant, 'SPEC-ARCHI-008 : en mode ouvert, le départ du dernier client ne termine pas le processus');
    await s.arreter();
  } finally { supprimerDossier(dossier); }
}


// ── 006 : le client parle EXACTEMENT le même protocole au serveur local et à un serveur ouvert
async function sequence(port) {
  const a = await rejoindre(port, 'Alice', 1);
  const moi = a.bienvenue.toi[0];
  a.client.envoyer({ t: 'bloc', x: Math.floor(moi.x), y: Math.floor(moi.y) + 3, z: Math.floor(moi.z), id: 9 });
  a.client.envoyer({ t: 'chat', texte: 'salut' });
  await a.client.attendre('chat', 3000, m => m.texte === 'salut');
  await a.client.attendre('bloc', 3000);
  const vus = a.client.messages.filter(m => m.t !== 'etat' && m.t !== 'reseau_etat').map(m => m.t);
  const cles = Object.keys(a.bienvenue).filter(k => k !== 'reseau').sort();
  a.client.fermer();
  return { vus, cles };
}
async function scenarioMemeProtocole() {
  const d1 = dossierTemp('mc-archi-m1-'), d2 = dossierTemp('mc-archi-m2-');
  try {
    const ferme = await demarrer(['--port', '0', '--dossier-parties', d1]);
    const ouvert = await demarrer(['--port', '0', '--ouvert', '--dossier-parties', d2]);
    const sf = await sequence(ferme.port), so = await sequence(ouvert.port);
    ok(JSON.stringify(sf.vus) === JSON.stringify(so.vus), 'SPEC-ARCHI-006 : même suite de messages reçus (poser, chat) sur le serveur local fermé et sur un serveur ouvert', JSON.stringify(sf.vus) + ' vs ' + JSON.stringify(so.vus));
    ok(JSON.stringify(sf.cles) === JSON.stringify(so.cles), 'SPEC-ARCHI-006 : BIENVENUE a les mêmes champs dans les deux modes (seule la valeur de reseau diffère)');
    const fs = require('fs'), path = require('path');
    ['src/game.js', 'src/net.js'].forEach(f => {
      const txt = fs.readFileSync(path.join(A.RACINE, f), 'utf8');
      // ni chargement du module serveur (require/import/balise script), ni accès à ses objets : seul le protocole les relie
      const code = txt.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      const charge = /\brequire\s*\(/.test(code) || /(^|[;\s])import\s+(\{|\*|\w+\s+from)|\bimport\s*\(/m.test(code) || /src\s*=\s*['"][^'"]*server\.js/.test(code)
        || /\bsauvegarderMondeSync\b|\betatMonde\b|\bappliquerEtatMonde\b/.test(code);
      ok(!charge, 'SPEC-ARCHI-006 : ' + f + ' ne charge jamais server.js ni ne touche à l\'état du monde du serveur (seul le protocole les relie)');
    });
    await ferme.arreter(); await ouvert.arreter();
  } finally { supprimerDossier(d1); supprimerDossier(d2); }
}

(async function () {
  try {
    // `node tests/integration-archi-serveur.js pause` ne lance qu'un scénario (mise au point)
    const tous = { port: scenarioPortEtLiaison, origine: scenarioOrigine, reseau: scenarioReseauAChaud, pause: scenarioPause, ouvert: scenarioOuvertSansPause, protocole: scenarioMemeProtocole };
    const choix = process.argv[2] ? [process.argv[2]] : Object.keys(tous);
    await Promise.all(choix.map(k => tous[k]()));
  } catch (e) {
    R.ok(false, 'exception non prévue', (e && e.stack) || String(e));
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
  }
  const code = R.fin();
  process.exit(code);
})();
