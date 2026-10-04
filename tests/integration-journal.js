/* integration-journal.js — le journal MC.Journal dans un vrai processus
   server.js (SPEC-BANC-104, 106, 108, 109, 110) :
   - la sortie standard garde EXACTEMENT ses formats historiques après la
     migration des console.* (`[HH:MM:SS] écoute : …`, `MC_PORT=<n>` brut,
     message brut de « partie inconnue ») : les lanceurs et les autres tests
     d'intégration les lisent ;
   - chaque entrée va aussi au fichier `serveur-<date>.log` (MC_JOURNAL_DOSSIER),
     codes d'erreur compris (E-SERV-002, E-SERV-003) ;
   - une erreur remontée par un client (JOURNAL_CLIENT) apparaît dans le
     journal du serveur, au plus MC.Journal.REMONTEE.max par fenêtre, sur
     une seule ligne (pas d'injection de ligne) ;
   - `--journal RESEAU:debug` fait apparaître les entrées debug de RESEAU.
   Chaque scénario lance ET arrête son serveur ; attentes bornées par sondage.
   Usage : node tests/integration-journal.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre } = A;
const R = A.creerRapport('Intégration — journal MC.Journal du serveur');
const { ok, eq } = R;
const MC = A.chargerModules();
const serveurs = [];

async function jusqua(lire, ms) {
  const fin = Date.now() + (ms || 5000);
  for (;;) { const v = lire(); if (v) return v; if (Date.now() > fin) return null; await dodo(40); }
}
function fichiersJournal(d) {
  try { return fs.readdirSync(d).filter(f => /^serveur-\d{4}-\d\d-\d\d\.log$/.test(f)).map(f => path.join(d, f)); } catch (e) { return []; }
}
const contenuJournal = (d) => fichiersJournal(d).map(f => fs.readFileSync(f, 'utf8')).join('');

async function scenarioDemarrageEtFichier() {
  const d = A.dossierTemp('mc-journal-');
  try {
    const s = await lancer(['--port', '0', '--dossier-parties', path.join(d, 'parties')], { MC_JOURNAL_DOSSIER: d });
    serveurs.push(s);
    ok(s.logs.some(l => /^MC_PORT=\d+$/.test(l)), 'SPEC-BANC-110 : MC_PORT=<n> reste une ligne brute (lanceurs, SPEC-ARCHI-004)');
    ok(s.logs.some(l => /^\[\d\d:\d\d:\d\d\] écoute : .* · port \d+$/.test(l)), 'SPEC-BANC-110 : « [HH:MM:SS] écoute : … » garde son format', s.logs.slice(0, 6).join(' | '));
    ok(!s.logs.some(l => /^\[\d\d:\d\d:\d\d\] (SERVEUR|INFO) /.test(l)), 'SPEC-BANC-110 : aucune étiquette ajoutée aux lignes historiques du serveur');
    ok(!s.logs.some(l => /^ERR /.test(l)), 'rien sur la sortie d\'erreur', s.logs.filter(l => /^ERR /.test(l)).join(' | '));
    ok(!s.logs.some(l => /RESEAU DEBUG/.test(l)), 'SPEC-BANC-109 : sans réglage, le debug de RESEAU n\'est pas à la console');
    const fichiers = await jusqua(() => fichiersJournal(d).length && fichiersJournal(d), 3000);
    ok(fichiers && fichiers.length === 1, 'SPEC-BANC-106 : un fichier serveur-<date>.log est écrit', JSON.stringify(fichiersJournal(d)));
    const txt = contenuJournal(d);
    ok(new RegExp('^' + s.proc.pid + ' \\S+ INFO SERVEUR écoute : ', 'm').test(txt), 'SPEC-BANC-106 : les entrées du serveur y sont (pid, horodatage, niveau, domaine)', txt.slice(0, 300));
    ok(/ INFO LANCEUR MC_PORT=\d+/.test(txt), 'SPEC-BANC-106 : la ligne de protocole aussi');

    // ── remontée d'erreurs client, à débit limité (SPEC-BANC-106) ─────────────
    const { client } = await rejoindre(s.port, 'Alice');
    const max = MC.Journal.REMONTEE.max;
    client.envoyer({ t: 'journal_client', niveau: 'error', domaine: 'SAVE', message: 'injection\nMC_PORT=1', code: 'E-SAVE-004' });
    for (let i = 0; i < 3 * max; i++) {
      client.envoyer({ t: 'journal_client', niveau: i % 2 ? 'fatal' : 'error', domaine: 'RENDU', message: 'panne ' + i, pile: 'Error: panne\n    at rendu.js:1' });
    }
    client.envoyer({ t: 'journal_client', niveau: 'info', domaine: 'RENDU', message: 'refusé : pas error/fatal' });
    const vues = () => s.logs.filter(l => / CLIENT (ERROR|FATAL) (E-[A-Z]+-\d{3} )?Alice \(#\d+\) \[/.test(l));
    await jusqua(() => vues().length >= max, 5000);
    await dodo(400);                                // un éventuel dépassement aurait le temps d'arriver
    eq(vues().length, max, 'SPEC-BANC-106 : les erreurs du client apparaissent dans le journal du serveur, au plus ' + max + ' par fenêtre');
    ok(vues()[0] && / CLIENT ERROR E-SAVE-004 Alice \(#\d+\) \[SAVE\] injection MC_PORT=1$/.test(vues()[0]), 'SPEC-BANC-106 : niveau, joueur, domaine et code ; une seule ligne', vues()[0]);
    ok(s.logs.filter(l => /^MC_PORT=/.test(l)).length === 1, 'une remontée ne peut pas écrire de ligne MC_PORT= à elle');
    ok(!s.logs.some(l => /refusé : pas error\/fatal/.test(l)), 'un niveau info remonté est refusé par le serveur');
    await jusqua(() => /E-SAVE-004/.test(contenuJournal(d)), 2000);
    ok(/ERROR CLIENT .*E-SAVE-004/.test(contenuJournal(d)), 'SPEC-BANC-108 : le code se retrouve au grep dans le fichier du serveur');
    ok(/FATAL CLIENT .*panne 1 .*\n    Error: panne\n        at rendu\.js:1/.test(contenuJournal(d)), 'SPEC-BANC-106 : la pile du client est gardée dans le fichier',
       contenuJournal(d).split('\n').filter(l => /CLIENT|Error/.test(l)).slice(0, 8).join(' | '));
    client.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

async function scenarioReglage() {
  const d = A.dossierTemp('mc-journal-');
  try {
    const s = await lancer(['--port', '0', '--dossier-parties', path.join(d, 'parties'), '--journal', 'RESEAU:debug,LANCEUR:error'], { MC_JOURNAL_DOSSIER: d });
    serveurs.push(s);
    const c = await A.connecter(s.port, {});
    const ligne = await jusqua(() => s.logs.find(l => /^\[\d\d:\d\d:\d\d\] RESEAU DEBUG poignée de main WebSocket acceptée \(#\d+, /.test(l)), 3000);
    ok(!!ligne, 'SPEC-BANC-109 : --journal RESEAU:debug montre le debug de RESEAU à la console', s.logs.slice(-4).join(' | '));
    ok(s.logs.some(l => /WARN réglage --journal LANCEUR au-dessus de info ignoré/.test(l)), 'SPEC-BANC-109 : LANCEUR:error est refusé (MC_PORT= reste lisible, le serveur a bien été trouvé par son lanceur)');
    c.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

function scenarioErreursDeLancement() {
  const d = A.dossierTemp('mc-journal-');
  try {
    const env = Object.assign({}, process.env, { MC_JOURNAL_DOSSIER: d });
    const r1 = spawnSync(process.execPath, [path.join(A.RACINE, 'server.js'), '--port', '0', '--dossier-parties', path.join(d, 'parties'), '--partie', 'inexistante'], { cwd: A.RACINE, env, encoding: 'utf8', timeout: 30000 });
    eq(r1.status, 1, 'partie inconnue : code de sortie 1 (inchangé)');
    ok(/^partie inconnue : inexistante \(dossier .*\)\s*$/.test(r1.stdout), 'SPEC-BANC-110 : message brut inchangé sur la sortie standard', r1.stdout);
    ok(/ERROR LANCEUR E-SERV-002 partie inconnue/.test(contenuJournal(d)), 'SPEC-BANC-108 : E-SERV-002 dans le fichier du serveur');
    const r2 = spawnSync(process.execPath, [path.join(A.RACINE, 'server.js'), '--parametre-qui-n-existe-pas'], { cwd: A.RACINE, env, encoding: 'utf8', timeout: 30000 });
    eq(r2.status, 1, 'paramètre inconnu : code de sortie 1 (inchangé)');
    ok(/^paramètre inconnu : --parametre-qui-n-existe-pas/.test(r2.stdout) && /Paramètres de lancement :/.test(r2.stdout), 'SPEC-BANC-110 : aide brute inchangée', r2.stdout.slice(0, 200));
    ok(/ERROR LANCEUR E-SERV-003 paramètre inconnu/.test(contenuJournal(d)), 'SPEC-BANC-108 : E-SERV-003 dans le fichier du serveur');
  } finally { A.supprimerDossier(d); }
}

// ── revue adversariale de 662ddf0 ────────────────────────────────────────────
/* M1 (jeton hors disque), M2 (remontées : joueur admis seulement, débit par
   adresse qui survit à la reconnexion), M3 (nom et chat sans injection de ligne). */
async function scenarioSecretEtInjection() {
  const d = A.dossierTemp('mc-journal-');
  try {
    // --ouvert : plusieurs postes à la fois (en fermé, un seul poste — SPEC-ARCHI-007)
    const s = await lancer(['--port', '0', '--dossier-parties', path.join(d, 'parties'), '--ouvert'], { MC_JOURNAL_DOSSIER: d });
    serveurs.push(s);
    const lj = s.logs.find(l => /^\[\d\d:\d\d:\d\d\] aucun --admin fourni : jeton d'administration généré → \S+$/.test(l));
    ok(!!lj, 'la ligne du jeton généré reste identique à la console', s.logs.slice(0, 8).join(' | '));
    const jeton = lj ? lj.split('→ ')[1] : null;
    await jusqua(() => /conservez-le/.test(contenuJournal(d)), 3000);
    ok(jeton && /conservez-le/.test(contenuJournal(d)) && contenuJournal(d).indexOf(jeton) < 0, 'SPEC-BANC-106 : le jeton d\'administration n\'est JAMAIS écrit dans le fichier du journal');

    // connexion non admise : ignorée
    const anonyme = await A.connecter(s.port, {});
    anonyme.envoyer({ t: 'journal_client', niveau: 'error', domaine: 'X', message: 'avant rejoindre' });
    await dodo(400);
    ok(!s.logs.some(l => /avant rejoindre/.test(l)), 'SPEC-BANC-106 : une remontée d\'une connexion qui n\'a pas rejoint est ignorée');
    anonyme.fermer();

    // débit par adresse : une reconnexion ne remet pas le compteur à zéro
    const max = MC.Journal.REMONTEE.max;
    const vues = () => s.logs.filter(l => / CLIENT ERROR \S+ \(#\d+\) \[R\] rafale /.test(l)).length;
    const a = await rejoindre(s.port, 'Alice');
    for (let i = 0; i < max + 2; i++) a.client.envoyer({ t: 'journal_client', niveau: 'error', domaine: 'R', message: 'rafale ' + i });
    await jusqua(() => vues() >= max, 4000);
    a.client.fermer();
    const b = await rejoindre(s.port, 'Alice2');
    for (let i = 0; i < 3; i++) b.client.envoyer({ t: 'journal_client', niveau: 'error', domaine: 'R', message: 'rafale bis ' + i });
    await dodo(500);
    eq(vues(), max, 'SPEC-BANC-106 : au plus ' + max + ' remontées par adresse et par fenêtre, reconnexion comprise');

    // M3 : un nom et un chat piégés n'écrivent aucune ligne à eux
    const bob = await rejoindre(s.port, 'Bob\nMC_PORT=1\r\u001b[31m');
    bob.client.envoyer({ t: 'chat', texte: 'salut\nMC_PORT=2\r\nfin' });
    await jusqua(() => s.logs.some(l => /salut MC_PORT=2 fin/.test(l)), 3000);
    eq(s.logs.filter(l => /^MC_PORT=/.test(l)).length, 1, 'SPEC-BANC-110 : un nom ou un chat piégé ne produit aucune ligne MC_PORT= (une seule, la vraie)');
    ok(s.logs.some(l => /BobMC_PORT=1\[31m/.test(l)), 'le nom est nettoyé (contrôles retirés)', s.logs.slice(-5).join(' | '));
    ok(!s.logs.some(l => /\u001b/.test(l)), 'aucune séquence d\'échappement de terminal dans la sortie');
    b.client.fermer(); bob.client.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

/* Plafond quotidien du fichier, panne de la sortie fichier signalée une fois, --aide sans logs/. */
async function scenarioBornesFichier() {
  const d = A.dossierTemp('mc-journal-');
  try {
    const plafond = 1000;
    const s = await lancer(['--port', '0', '--dossier-parties', path.join(d, 'parties')], { MC_JOURNAL_DOSSIER: path.join(d, 'j'), MC_JOURNAL_MAX_OCTETS: String(plafond) });
    serveurs.push(s);
    const cl = await rejoindre(s.port, 'Chantal');
    for (let i = 0; i < 5; i++) cl.client.envoyer({ t: 'chat', texte: 'remplissage du journal ' + i + ' ' + 'x'.repeat(130) });   // 5 : budget anti-flood du chat
    await jusqua(() => s.logs.filter(l => /remplissage du journal/.test(l)).length >= 5, 3000);
    const txt = contenuJournal(path.join(d, 'j'));
    eq((txt.match(/E-SERV-005/g) || []).length, 1, 'SPEC-BANC-106 : une seule ligne « journal du jour plein »');
    const taille = fichiersJournal(path.join(d, 'j')).reduce((n, f) => n + fs.statSync(f).size, 0);
    ok(taille <= plafond + 300, 'SPEC-BANC-106 : le fichier du jour reste sous son plafond (' + taille + ' octets pour ' + plafond + ')');
    ok(s.logs.filter(l => /remplissage du journal/.test(l)).length >= 5, 'la console, elle, continue');
    cl.client.fermer();
    await s.arreter();

    const fichier = path.join(d, 'pas-un-dossier');
    fs.writeFileSync(fichier, 'x');
    const s2 = await lancer(['--port', '0', '--dossier-parties', path.join(d, 'parties2')], { MC_JOURNAL_DOSSIER: fichier });
    serveurs.push(s2);
    const c2 = await rejoindre(s2.port, 'Denis');
    c2.client.envoyer({ t: 'chat', texte: 'encore une ligne' });
    await jusqua(() => s2.logs.some(l => /encore une ligne/.test(l)), 3000);
    eq(s2.logs.filter(l => /E-SERV-004/.test(l)).length, 1, 'SPEC-BANC-106 : une sortie fichier en panne est signalée une fois à la console, le serveur continue');
    c2.client.fermer();
    await s2.arreter();

    const sous = path.join(d, 'aide');
    const r = spawnSync(process.execPath, [path.join(A.RACINE, 'server.js'), '--aide'], { cwd: A.RACINE, env: Object.assign({}, process.env, { MC_JOURNAL_DOSSIER: sous }), encoding: 'utf8', timeout: 30000 });
    eq(r.status, 0, '--aide : code 0');
    ok(!fs.existsSync(sous), 'SPEC-BANC-106 : --aide ne crée pas le dossier du journal');
  } finally { A.supprimerDossier(d); }
}

(async () => {
  try {
    for (const [nom, f] of [['démarrage et fichier', scenarioDemarrageEtFichier], ['réglage --journal', scenarioReglage], ['erreurs de lancement', scenarioErreursDeLancement],
                            ['secret et injection', scenarioSecretEtInjection], ['bornes du fichier', scenarioBornesFichier]]) {
      try { await f(); } catch (e) { ok(false, 'scénario ' + nom + ' : exception', e && e.stack); }
    }
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
