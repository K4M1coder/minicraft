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
    const s = await lancer(['--port', '0', '--dossier-parties', path.join(d, 'parties'), '--journal', 'RESEAU:debug'], { MC_JOURNAL_DOSSIER: d });
    serveurs.push(s);
    const c = await A.connecter(s.port, {});
    const ligne = await jusqua(() => s.logs.find(l => /^\[\d\d:\d\d:\d\d\] RESEAU DEBUG poignée de main WebSocket acceptée \(#\d+, /.test(l)), 3000);
    ok(!!ligne, 'SPEC-BANC-109 : --journal RESEAU:debug montre le debug de RESEAU à la console', s.logs.slice(-4).join(' | '));
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

(async () => {
  try {
    for (const [nom, f] of [['démarrage et fichier', scenarioDemarrageEtFichier], ['réglage --journal', scenarioReglage], ['erreurs de lancement', scenarioErreursDeLancement]]) {
      try { await f(); } catch (e) { ok(false, 'scénario ' + nom + ' : exception', e && e.stack); }
    }
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
