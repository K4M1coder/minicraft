/* integration-cahiers.js — test d'intégration RÉEL de la bibliothèque des
   cahiers de test (SPEC-BANC-018 à 022) : un vrai processus `server.js`,
   de vraies requêtes HTTP. Démarre un serveur sur un port libre, enregistre
   un cahier factice (POST /tests/resultats), le liste, l'exporte en HTML
   autonome et en .docx, le compare à lui-même, puis ARRÊTE le serveur.

   Usage : node tests/integration-cahiers.js [port] */
'use strict';
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const RACINE = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8397;

const C = { r: '\x1b[31m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
let passes = 0, echecs = 0;
const details = [];
function ok(cond, nom, info) {
  if (cond) { passes++; details.push(`  ${C.g}·${C.x} ${C.d}${nom}${C.x}`); }
  else { echecs++; details.push(`  ${C.r}✗ ${nom}${C.x}${info ? '\n    ' + C.r + info + C.x : ''}`); }
}
function eq(a, b, nom) { ok(a === b, nom, `attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); }

function requete(port, method, chemin, corps, headers) {
  return new Promise((resolve) => {
    const data = corps ? (Buffer.isBuffer(corps) ? corps : Buffer.from(JSON.stringify(corps))) : null;
    const req = http.request({ host: '127.0.0.1', port, method, path: chemin, headers: Object.assign({}, headers, data ? { 'Content-Length': data.length } : {}) }, (res) => {
      const morceaux = [];
      res.on('data', (d) => morceaux.push(d));
      res.on('end', () => resolve({ code: res.statusCode, corps: Buffer.concat(morceaux), headers: res.headers }));
    });
    req.on('error', () => resolve({ code: 0, corps: null, headers: {} }));
    if (data) req.write(data);
    req.end();
  });
}

const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
function demarrer(args) {
  return spawn(process.execPath, [path.join(RACINE, 'server.js'), ...args],
    { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'] });
}
async function attendrePret(port) {
  for (let i = 0; i < 60; i++) {
    await dodo(100);
    const r = await requete(port, 'GET', '/index.html', null);
    if (r.code === 200) return true;
  }
  return false;
}

(async function () {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cahiers-'));
  const s = demarrer(['--port', String(PORT), '--serveur', '--tests']);
  let sortieServeur = '';
  s.stdout.on('data', (d) => { sortieServeur += d; });
  s.stderr.on('data', (d) => { sortieServeur += d; });

  try {
    const pret = await attendrePret(PORT);
    ok(pret, 'le serveur démarre et répond', sortieServeur.slice(-300));
    if (!pret) throw new Error('serveur indisponible');

    // enregistrement d'un cahier factice avec une capture
    const capBase64 = Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]).toString('base64');
    const envoi = {
      resultats: {
        schema: 1,
        campagne: { preset: 'integration-cahiers', debut: new Date().toISOString(), fin: new Date().toISOString(), duree_ms: 12, totaux: { total: 1, passes: 1, echecs: 0, ignores: 0 } },
        tests: [{ id: 'X', nom: 'test factice', type: 'unitaire', groupe: 'G', domaines: [], specs: [], etat: 'ok', duree_ms: 1, captures: [{ libelle: 'capture', fichier: null }] }],
      },
      captures: [{ libelle: 'capture', type: 'image/jpeg', base64: capBase64 }],
    };
    const rEnvoi = await requete(PORT, 'POST', '/tests/resultats', envoi, { 'Content-Type': 'application/json' });
    ok(rEnvoi.code === 200, 'SPEC-BANC-015 : le cahier factice est accepté', JSON.stringify(rEnvoi.corps && rEnvoi.corps.toString()));
    const dossier = rEnvoi.corps && JSON.parse(rEnvoi.corps.toString()).dossier.split('/').pop();
    ok(!!dossier, 'un dossier de cahier est renvoyé');

    // page et API de la bibliothèque
    const rPage = await requete(PORT, 'GET', '/tests/cahiers', null);
    ok(rPage.code === 200 && /bibliothèque/i.test(rPage.corps.toString()), 'SPEC-BANC-018 : la page /tests/cahiers répond');
    const rApi = await requete(PORT, 'GET', '/tests/cahiers/api', null);
    const liste = rApi.code === 200 ? JSON.parse(rApi.corps.toString()).cahiers : [];
    ok(liste.some((c) => c.dossier === dossier), 'SPEC-BANC-018 : le cahier enregistré apparaît dans la liste');

    // exports HTML autonome et .docx
    const rHTML = await requete(PORT, 'GET', '/tests/cahiers/' + dossier + '/export?format=html', null);
    ok(rHTML.code === 200 && rHTML.corps.toString().indexOf('data:image') >= 0, 'SPEC-BANC-019 : l\'export HTML est autonome (capture en data URI)');
    const rDocx = await requete(PORT, 'GET', '/tests/cahiers/' + dossier + '/export?format=docx', null);
    ok(rDocx.code === 200 && rDocx.headers['content-type'] === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
       'SPEC-BANC-021 : l\'export .docx a le bon type de contenu');
    ok(rDocx.corps && rDocx.corps.length > 100 && rDocx.corps.slice(0, 2).toString('hex') === '504b', 'SPEC-BANC-021 : l\'export .docx est une archive ZIP valide (signature PK)');

    // comparaison à lui-même : aucun écart
    const rComp = await requete(PORT, 'GET', '/tests/cahiers/' + dossier + '/comparer?avec=' + dossier, null);
    const comp = rComp.code === 200 ? JSON.parse(rComp.corps.toString()) : {};
    ok(comp.ok && comp.apparus.length === 0 && comp.disparus.length === 0 && comp.versEchec.length === 0,
       'SPEC-BANC-018 : comparer un cahier à lui-même ne signale aucun écart');

    // adresse non locale refusée (en-tête X-Forwarded-For n'est pas utilisé par le serveur :
    // c'est req.socket.remoteAddress qui compte, toujours local ici — donc on vérifie
    // directement la fonction, déjà couverte sous Node dans spec-banc.js)
  } finally {
    try { s.kill(); } catch (e) { /* rien */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* rien */ }
    // le cahier factice créé par ce test ne doit pas s'accumuler dans le vrai dossier
    try {
      const racine = path.join(RACINE, 'tests', 'resultats');
      fs.readdirSync(racine).filter((d) => d.indexOf('integration-cahiers') >= 0)
        .forEach((d) => fs.rmSync(path.join(racine, d), { recursive: true, force: true }));
    } catch (e) { /* rien à nettoyer */ }
  }

  console.log(`\n${C.b}Integration cahiers${C.x}\n${details.join('\n')}\n`);
  const total = passes + echecs;
  if (echecs) { console.log(`${C.r}${echecs} échec(s)${C.x} sur ${total} tests\n`); process.exit(1); }
  console.log(`${C.g}${passes}/${total} tests d intégration passent${C.x}\n`);
})();
