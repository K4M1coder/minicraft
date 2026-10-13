/* integration-console-morte.js — un serveur dont la sortie standard devient
   INVALIDE en cours de route reste réactif, ne boucle pas, et un serveur en
   tempête de pannes s'arrête au lieu de tourner dans le vide (SPEC-SECU-002,
   SPEC-BANC-106, SPEC-BANC-108, SPEC-ARCHI-013).

   Le défaut d'origine (v0.8.0, rendu immédiat par l'exécutable de v0.9.0) :
   relancé par une bascule de partie avec une sortie standard héritée qui
   devient invalide, le serveur levait EBADF à chaque ligne de journal ; son
   gestionnaire d'exceptions journalisait — donc relevait EBADF — et
   sauvegardait le monde EN SYNCHRONE à chaque tour : 80 à 95 % d'un cœur,
   52 Mo de journal par jour, tic affamé, ETAT tardifs, joueur recalé en
   arrière. Aucun test ne le voyait : leurs serveurs ont une sortie valide.

   La sortie morte est reproduite par tools/precharge-console-morte.js
   (sortie standard FICHIER, puis descripteur invalide : EBADF exactement
   comme dans la réalité). Scénarios :
     - morte : un client émulé MARCHE (tools/mesure-recul.js) sur un serveur
       à console morte, pendant qu'on sonde /api/parties ;
     - bascule : charger une partie relance le serveur ; seul l'enfant perd sa
       console (cas réel) ; l'enfant reste réactif et n'écrit pas dans la
       sortie du parent ;
     - tempete : une exception à chaque tour de boucle → dernière sauvegarde,
       une ligne E-SERV-008, arrêt code 70.

   Usage : node tests/integration-console-morte.js [morte|bascule|tempete] */
'use strict';
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const A = require('./aide-integration-archi.js');
const { dodo, requete, rejoindre, dossierTemp, supprimerDossier, RACINE } = A;
const R = A.creerRapport('Intégration — serveur à console morte, gardien des pannes (SPEC-SECU-002)');
const { ok, eq } = R;
const PRECHARGE = path.join(RACINE, 'tools', 'precharge-console-morte.js');

const portLibre = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const lire = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } };
function lignesJournal(dossier) {
  let fichiers = [];
  try { fichiers = fs.readdirSync(dossier).filter(f => /\.log$/.test(f)); } catch (e) { return []; }
  return fichiers.map(f => lire(path.join(dossier, f))).join('').split('\n').filter(l => /^\d+ \d{4}-/.test(l));
}
async function sonder(f, ms, pas) {
  const fin = Date.now() + ms;
  for (;;) { if (await f()) return true; if (Date.now() >= fin) return false; await dodo(pas || 100); }
}
/* Sonde /api/parties toutes les 250 ms pendant `ms` : latence maximale, échecs. */
async function sondeApi(port, ms) {
  const r = { requetes: 0, echecs: 0, maxMs: 0 };
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const t0 = Date.now();
    const rep = await Promise.race([requete(port, '/api/parties'), dodo(2000).then(() => ({ code: 0, erreur: 'délai 2 s' }))]);
    const d = Date.now() - t0;
    r.requetes++;
    if (rep.code !== 200) r.echecs++;
    if (d > r.maxMs) r.maxMs = d;
    await dodo(250);
  }
  return r;
}

/* Fait écrire au serveur des lignes de journal à des tours de boucle
   DIFFÉRENTS (un témoin rejoint — ou est refusé — puis part, deux fois) : sur
   une sortie morte, Node rattrape la première écriture en échec mais fait de
   la suivante une exception non rattrapée — c'est elle qui lançait la boucle. */
async function provoquerLignes(port) {
  for (let k = 0; k < 2; k++) {
    try { const t = await rejoindre(port, 'Temoin' + k, 1); await dodo(200); t.client.fermer(); } catch (e) { /* refusé : la ligne de refus suffit */ }
    await dodo(300);
  }
}

// ── morte : marcher sur un serveur dont la console meurt ────────────────────
async function scenarioMorte() {
  const { mesurer } = require('../tools/mesure-recul.js');
  const res = await mesurer({ consoleMorte: true, consoleMorteMs: 200, duree: 8, prechargement: 3,
    pendant: async (port) => { await provoquerLignes(port); return sondeApi(port, 5500); } });
  const jr = res.journalServeur;
  ok(jr.sortieStandardOctets > 0, 'préparation : la sortie standard était un fichier valide au démarrage (lignes reçues avant sa mort)', JSON.stringify(jr));
  eq(jr.exceptions, 0, 'SPEC-SECU-002 : la console morte ne produit AUCUNE exception non rattrapée (avant : des dizaines de milliers)');
  eq(jr.notesConsole, 1, 'SPEC-BANC-108 : une seule note E-JOURNAL-001 dans le journal fichier');
  ok(jr.octets < 256 * 1024, 'SPEC-BANC-106 : le journal fichier reste borné (' + jr.octets + ' octets ; avant : 50 Mo en 15 s)');
  ok(res.pendant && res.pendant.echecs === 0 && res.pendant.maxMs < 2000, 'SPEC-SECU-002 : /api/parties répond en moins de 2 s pendant toute la marche', JSON.stringify(res.pendant));
  const etatsParS = res.etats / res.duree;
  ok(etatsParS >= 40, 'SPEC-SECU-002 : cadence d\'ETAT normale (' + etatsParS.toFixed(1) + '/s, attendu ≈ 60 ; avant : ≈ 15)');
  ok(res.serveur && res.serveur.ecartP95Ms < 60 && res.serveur.pendant.ticsLongs === 0, 'SPEC-SECU-002 : les tics du serveur gardent leur cadence (écart p95 ' + (res.serveur && res.serveur.ecartP95Ms) + ' ms, aucun tic > 250 ms)', JSON.stringify(res.serveur));
  ok(res.retardMax <= 4, 'SPEC-SECU-002 : les entrées du client sont acquittées sans retard (' + res.retardMax + ' en attente au plus ; avant : 7)');
  ok(res.reculMax <= 0.05, 'SPEC-SECU-002 (témoin, ne discrimine pas seul) : le client émulé qui marche ne revient pas sur ses pas (recul max ' + res.reculMax + ' bloc) — le recul ne se voit qu’en vrai navigateur sur disque lent (tests/e2e-jouabilite.js, préréglage jouabilite) ; ici ce sont les vérifications de cause ci-dessus qui rougissent sans le correctif');
  ok(res.deplacement > 10, 'préparation : le client a vraiment marché (' + res.deplacement + ' blocs)');
}

// ── bascule : l'enfant d'une relance perd sa console ─────────────────────────
async function scenarioBascule() {
  const d = dossierTemp('mc-console-bascule-');
  const journalDossier = path.join(d, 'logs');
  const sortie = path.join(d, 'sortie-parent.txt');
  const temoin = path.join(d, 'console-morte.pid');
  const port = await portLibre();
  const fd = fs.openSync(sortie, 'w+');
  let proc;
  try {
    proc = spawn(process.execPath, [path.join(RACINE, 'server.js'), '--port', String(port), '--dossier-parties', path.join(d, 'parties')], {
      cwd: RACINE, stdio: ['ignore', fd, fd],
      env: Object.assign({}, process.env, {
        NODE_OPTIONS: ((process.env.NODE_OPTIONS || '') + ' --require "' + PRECHARGE.split(path.sep).join('/') + '"').trim(),   // NODE_OPTIONS : l'antislash y échappe
        MC_CONSOLE_MORTE_RELANCE: '1', MC_CONSOLE_MORTE_MS: '200', MC_CONSOLE_MORTE_TEMOIN: temoin,
        MC_JOURNAL_DOSSIER: journalDossier, MC_TEST_ARRET_SI_MORT: String(process.pid),
      }),
    });
  } finally { fs.closeSync(fd); }
  try {
    ok(await sonder(async () => (await requete(port, '/api/parties')).code === 200, 30000), 'préparation : le serveur parent répond');
    const id = (await requete(port, '/api/parties', { corps: { nom: 'Bascule', graine: 9 } })).json.partie.id;
    await requete(port, '/api/parties/charger', { corps: { id } });
    let pidEnfant = null;
    ok(await sonder(async () => { const r = await requete(port, '/api/parties'); if (r.json && r.json.actif === id) { pidEnfant = r.json.monde.pid; return true; } return false; }, 30000),
      'SPEC-ARCHI-013 : la bascule relance le serveur sur la partie choisie');
    ok(pidEnfant && pidEnfant !== proc.pid, 'préparation : c\'est un autre processus (pid ' + pidEnfant + ')');
    ok(await sonder(() => lire(temoin) === String(pidEnfant), 15000, 25), 'préparation : la sortie standard de l\'enfant (et d\'elle seule) est morte', lire(temoin));
    // des joueurs arrivent et partent : l'enfant journalise — avant le correctif, chaque ligne levait EBADF et la boucle démarrait
    await provoquerLignes(port);
    const j = await rejoindre(port, 'Alice', 1);
    const vus = j.client.depuis();
    const api = await sondeApi(port, 3000);
    const etats = vus('etat').length;
    ok(api.echecs === 0 && api.maxMs < 2000, 'SPEC-SECU-002 : le serveur relancé reste réactif (/api/parties en moins de 2 s)', JSON.stringify(api));
    ok(etats >= 100, 'SPEC-SECU-002 : il diffuse ses ETAT à cadence normale (' + etats + ' en ≈ 3 s, attendu ≈ 180)');
    j.client.fermer();
    const lignes = lignesJournal(journalDossier).filter(l => l.indexOf(pidEnfant + ' ') === 0);
    ok(lignes.some(l => /Alice/.test(l)), 'préparation : le journal fichier de l\'enfant a bien reçu ses lignes', lignes.slice(-3).join(' | '));
    eq(lignes.filter(l => /EXCEPTION NON RATTRAPÉE/.test(l)).length, 0, 'SPEC-SECU-002 : aucune exception non rattrapée dans le serveur relancé');
    ok(lignes.filter(l => /E-JOURNAL-001/.test(l)).length <= 1, 'SPEC-BANC-108 : au plus une note E-JOURNAL-001');
    ok(!new RegExp('MC_PORT=' + port + '[\\s\\S]*MC_PORT=' + port).test(lire(sortie)) && lire(sortie).indexOf('partie « Bascule »') < 0,
      'SPEC-ARCHI-013 : la sortie standard FICHIER du parent n\'est pas héritée par l\'enfant (il a son propre journal)', lire(sortie).slice(-300));
  } finally {
    await A.arreterSurPort(port, 5000);
    try { proc.kill(); } catch (e) { /* déjà arrêté */ }
    await dodo(300);
    supprimerDossier(d);
  }
}

// ── tempête : une exception à chaque tour de boucle ─────────────────────────
async function scenarioTempete() {
  const d = dossierTemp('mc-console-tempete-');
  const f = path.join(d, 'monde.json');
  const journalDossier = path.join(d, 'logs');
  let s = null;
  try {
    s = await A.lancer(['--port', '0', '--monde', f, '--dossier-parties', d],
      { MC_TEST_PANNE_TEMPETE: '1', MC_TEST_PANNE_ASYNC_MS: '3000', MC_JOURNAL_DOSSIER: journalDossier });
    const fini = await Promise.race([s.sortie.then(() => true), dodo(15000).then(() => false)]);
    ok(fini, 'SPEC-SECU-002 : en tempête de pannes, le serveur s\'arrête de lui-même (au lieu de tourner dans le vide)');
    eq(s.code, 70, 'SPEC-SECU-002 : code de sortie 70');
    const lignes = lignesJournal(journalDossier);
    eq(lignes.filter(l => /E-SERV-008/.test(l)).length, 1, 'SPEC-BANC-108 : une ligne E-SERV-008 dans le journal fichier');
    ok(lignes.filter(l => /EXCEPTION NON RATTRAPÉE/.test(l)).length <= 3, 'SPEC-SECU-002 : les exceptions identiques sont regroupées (pas une ligne chacune)', lignes.length + ' lignes');
    let monde = null;
    try { monde = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { monde = null; }
    ok(monde && typeof monde.graine === 'number', 'SPEC-SECU-002 : la dernière sauvegarde de secours a écrit un monde lisible (atomique)');
    eq(fs.readdirSync(d).filter(x => /\.tmp/.test(x)).length, 0, 'SPEC-SECU-002 : aucun fichier temporaire ne traîne');
  } finally {
    if (s && s.vivant) await s.arreter();
    supprimerDossier(d);
  }
}

(async function () {
  try {
    const tous = { morte: scenarioMorte, bascule: scenarioBascule, tempete: scenarioTempete };
    const choix = process.argv[2] ? [process.argv[2]] : Object.keys(tous);
    for (const k of choix) await tous[k]();
  } catch (e) { R.ok(false, 'exception non prévue', (e && e.stack) || String(e)); }
  process.exit(R.fin());
})();
