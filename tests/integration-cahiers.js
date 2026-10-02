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

const DELAI_REQUETE_MS = 60000;
// cahiers malformés fabriqués plus bas : préfixe réservé, nettoyé au début
// ET à la fin (un test interrompu ne les laisse jamais dans le vrai dossier)
const PREFIXE_MALFORMES = '2000-01-01_';
function nettoyerMalformes() {
  const racine = path.join(RACINE, 'tests', 'resultats');
  try {
    fs.readdirSync(racine).filter((d) => d.indexOf(PREFIXE_MALFORMES) === 0 && d.indexOf('integration-cahiers') >= 0)
      .forEach((d) => fs.rmSync(path.join(racine, d), { recursive: true, force: true }));
  } catch (e) { /* dossier absent : rien à nettoyer */ }
}
function requete(port, method, chemin, corps, headers) {
  return new Promise((resolve) => {
    const data = corps ? (Buffer.isBuffer(corps) ? corps : Buffer.from(JSON.stringify(corps))) : null;
    const req = http.request({ host: '127.0.0.1', port, method, path: chemin, headers: Object.assign({}, headers, data ? { 'Content-Length': data.length } : {}) }, (res) => {
      const morceaux = [];
      res.on('data', (d) => morceaux.push(d));
      res.on('end', () => resolve({ code: res.statusCode, corps: Buffer.concat(morceaux), headers: res.headers }));
    });
    req.on('error', () => resolve({ code: 0, corps: null, headers: {} }));
    // délai BORNÉ : une route qui ne répond jamais (le défaut même que ce
    // fichier vérifie) doit faire échouer l'assertion, pas pendre le test
    req.setTimeout(DELAI_REQUETE_MS, () => req.destroy(new Error('délai dépassé')));
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
  nettoyerMalformes();
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

    // ── SPEC-BANC-012 : GET /tests/version sert le commit et la version du jeu ──
    const rVersion = await requete(PORT, 'GET', '/tests/version', null);
    ok(rVersion.code === 200, 'GET /tests/version répond 200');
    let corpsVersion = {};
    try { corpsVersion = JSON.parse(rVersion.corps.toString()); } catch (e) { /* laissé vide, le test suivant échouera proprement */ }
    ok(Object.prototype.hasOwnProperty.call(corpsVersion, 'commit'), 'la réponse porte un champ commit (même absent d\'un dépôt git, il vaut null)');
    ok(typeof corpsVersion.versionJeu === 'string' && corpsVersion.versionJeu.length > 0, 'la réponse porte versionJeu (' + corpsVersion.versionJeu + ')');
    // ce dépôt EST un dépôt git : le commit doit être un court hash, pas null
    ok(typeof corpsVersion.commit === 'string' && /^[0-9a-f]{4,40}$/.test(corpsVersion.commit), 'dans ce dépôt git, commit est un hash court (' + corpsVersion.commit + ')');
    const rVersionPost = await requete(PORT, 'POST', '/tests/version', {}, { 'Content-Type': 'application/json' });
    eq(rVersionPost.code, 405, 'POST /tests/version est refusé (GET seulement)');

    // adresse non locale refusée (en-tête X-Forwarded-For n'est pas utilisé par le serveur :
    // c'est req.socket.remoteAddress qui compte, toujours local ici — donc on vérifie
    // directement la fonction, déjà couverte sous Node dans spec-banc.js)

    // ── CSRF / XSS stocké (correction revue adversariale, 1/3, CRITIQUE) ────
    const rOrigineEtrangere = await requete(PORT, 'POST', '/tests/resultats', envoi, { 'Content-Type': 'application/json', Origin: 'http://evil.example' });
    eq(rOrigineEtrangere.code, 403, 'SPEC-BANC-015 : Origin étranger refusé sur POST /tests/resultats');

    const rTypeInvalide = await requete(PORT, 'POST', '/tests/resultats', envoi, { 'Content-Type': 'text/plain' });
    ok(rTypeInvalide.code === 415 || rTypeInvalide.code === 403, 'SPEC-BANC-015 : Content-Type non JSON refusé sur POST /tests/resultats', String(rTypeInvalide.code));

    // conserver/supprimer refusés depuis une origine étrangère (CSRF)
    const rConserverEtranger = await requete(PORT, 'POST', '/tests/cahiers/' + dossier + '/conserver', { valeur: true }, { 'Content-Type': 'application/json', Origin: 'http://evil.example' });
    eq(rConserverEtranger.code, 403, 'SPEC-BANC-018 : Origin étranger refusé sur POST .../conserver');
    const rSupprimerEtranger = await requete(PORT, 'DELETE', '/tests/cahiers/' + dossier, null, { Origin: 'http://evil.example' });
    eq(rSupprimerEtranger.code, 403, 'SPEC-BANC-018 : Origin étranger refusé sur DELETE .../<dossier>');

    // un champ hostile (<script>) survit tel quel dans le JSON, mais ressort
    // ÉCHAPPÉ dans le rendu HTML de la bibliothèque — XSS stocké corrigé
    const chargeHostile = '<script>alert(1)</script>';
    const envoiHostile = {
      resultats: {
        schema: 1,
        campagne: {
          preset: chargeHostile, debut: new Date().toISOString(), fin: new Date().toISOString(), duree_ms: 1,
          totaux: { total: 1, passes: 1, echecs: 0, ignores: 0 },
          environnement: { source: 'navigateur', commit: chargeHostile, versionJeu: chargeHostile },
        },
        tests: [],
      },
    };
    const rEnvoiHostile = await requete(PORT, 'POST', '/tests/resultats', envoiHostile, { 'Content-Type': 'application/json' });
    ok(rEnvoiHostile.code === 200, 'SPEC-BANC-015 : un cahier au contenu hostile est quand même accepté (assaini, pas rejeté)');
    const dossierHostile = rEnvoiHostile.corps && JSON.parse(rEnvoiHostile.corps.toString()).dossier.split('/').pop();

    const rApiHostile = await requete(PORT, 'GET', '/tests/cahiers/api', null);
    const listeHostile = rApiHostile.code === 200 ? JSON.parse(rApiHostile.corps.toString()).cahiers : [];
    const entreeHostile = listeHostile.find((c) => c.dossier === dossierHostile);
    ok(!!entreeHostile && entreeHostile.preset.indexOf('<script>') >= 0, 'l\'API JSON renvoie le champ tel quel (le JSON n\'a pas à échapper, seul le rendu HTML doit le faire)');

    const rPageHostile = await requete(PORT, 'GET', '/tests/cahiers', null);
    ok(rPageHostile.corps.toString().indexOf('<script>alert(1)</script>') < 0, 'la page /tests/cahiers.html servie telle quelle ne contient jamais le contenu hostile (rendu côté client, pas serveur)');

    // le rendu se fait côté navigateur (tests/cahiers.html, fonction rafraichir()) : on
    // exécute ce même code sous Node, dans un DOM minimal simulé, pour vérifier RÉELLEMENT
    // que le innerHTML produit échappe le champ hostile — pas seulement que la source
    // appelle echapper() (ce qu'un simple grep du fichier ne prouverait pas).
    const { JSDOMMinimal } = (function () {
      function el(tag) {
        const e = { tagName: tag, _innerHTML: '', className: '', children: [], attrs: {}, style: {} };
        Object.defineProperty(e, 'innerHTML', { get() { return e._innerHTML; }, set(v) { e._innerHTML = v; e.children = []; } });
        e.appendChild = (c) => { e.children.push(c); };
        e.setAttribute = (k, v) => { e.attrs[k] = v; };
        return e;
      }
      const elements = { filtre: Object.assign(el('input'), { value: '' }), tri: Object.assign(el('select'), { value: 'debut' }), corps: el('tbody'), vide: el('div') };
      const document = {
        getElementById: (id) => elements[id],
        createElement: (tag) => el(tag),
      };
      return { JSDOMMinimal: { document, elements } };
    })();

    const scriptMatch = fs.readFileSync(path.join(RACINE, 'tests', 'cahiers.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/);
    const vm = require('vm');
    const ctxCahiers = vm.createContext({
      document: JSDOMMinimal.document,
      fetch: () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"cahiers":[]}'), json: () => Promise.resolve({ cahiers: [] }) }),
      alert: () => {}, confirm: () => true, console,
    });
    vm.runInContext(scriptMatch[1], ctxCahiers, { filename: 'cahiers.html-script' });
    ctxCahiers.TOUS = [{
      dossier: dossierHostile || 'x', preset: chargeHostile, source: 'navigateur',
      totaux: { passes: 1, total: 1 }, duree_ms: 1, versionJeu: chargeHostile, commit: chargeHostile,
      interrompue: false, conserve: false, debut: new Date().toISOString(),
    }];
    ctxCahiers.rafraichir();
    const ligneRendue = JSDOMMinimal.elements.corps.children[0] && JSDOMMinimal.elements.corps.children[0].innerHTML;
    ok(!!ligneRendue, 'la ligne du cahier hostile est bien rendue par rafraichir()');
    ok(ligneRendue && ligneRendue.indexOf('<script>alert(1)</script>') < 0, 'XSS stocké corrigé : aucun <script> littéral dans le innerHTML rendu');
    ok(ligneRendue && ligneRendue.indexOf('&lt;script&gt;alert(1)&lt;/script&gt;') >= 0, 'XSS stocké corrigé : le contenu hostile ressort échappé (&lt;script&gt;) dans le innerHTML rendu');

    try {
      const racine = path.join(RACINE, 'tests', 'resultats');
      if (dossierHostile) fs.rmSync(path.join(racine, dossierHostile), { recursive: true, force: true });
    } catch (e) { /* rien */ }

    // ── SPEC-BANC-117/118/120 : page du banc, historique, données malformées ──
    const rBanc = await requete(PORT, 'GET', '/tests/', null);
    ok(rBanc.code === 200 && rBanc.corps.toString().indexOf('banc de test') >= 0, 'SPEC-BANC-120 : /tests/ sert la page du banc (404 avant)', 'code ' + rBanc.code);
    const rBancSans = await requete(PORT, 'GET', '/tests', null);
    ok(rBancSans.code === 301 && rBancSans.headers.location === '/tests/', 'SPEC-BANC-120 : /tests est redirigé vers /tests/ (chemins relatifs de la page)', 'code ' + rBancSans.code + ' ' + rBancSans.headers.location);

    // deux cahiers locaux malformés (JSON valide mais inattendu) : ni la
    // bibliothèque des cahiers ni l'historique ne doivent tomber — avant, une
    // exception laissait la requête SANS réponse (page figée)
    const racineRes = path.join(RACINE, 'tests', 'resultats');
    const malformes = ['2000-01-01_00-00-01_integration-cahiers-null', '2000-01-01_00-00-02_integration-cahiers-bizarre'];
    fs.mkdirSync(path.join(racineRes, malformes[0]), { recursive: true });
    fs.writeFileSync(path.join(racineRes, malformes[0], 'resultats.json'), 'null');
    fs.mkdirSync(path.join(racineRes, malformes[1]), { recursive: true });
    fs.writeFileSync(path.join(racineRes, malformes[1], 'resultats.json'), JSON.stringify({
      campagne: 'pas un objet',
      tests: [null, 3, 'texte', { nom: 'test bizarre integration-cahiers', groupe: 'G-bizarre', domaines: 'PAS-UNE-LISTE', captures: [null, 4],
        message: '\u001b[31mrouge\u001b[0m ' + 'x'.repeat(20000), assertions: { ok: 1, ko: 0 }, etapes: [], etat: 'echec' }],
    }));
    const rApiMal = await requete(PORT, 'GET', '/tests/cahiers/api', null);
    ok(rApiMal.code === 200 && Array.isArray(JSON.parse(rApiMal.corps.toString()).cahiers), 'SPEC-BANC-120 : /tests/cahiers/api répond malgré un resultats.json « null »', 'code ' + rApiMal.code + ' ' + String(rApiMal.corps).slice(0, 200));
    const rLignesMal = await requete(PORT, 'GET', '/tests/historique/lignes?rapide=tous&filtre=' + encodeURIComponent(JSON.stringify({ nom: 'test bizarre integration-cahiers' })), null);
    let jMal = null; try { jMal = JSON.parse(rLignesMal.corps.toString()); } catch (e) { /* jMal reste null */ }
    ok(rLignesMal.code === 200 && jMal && jMal.total === 1, 'SPEC-BANC-120 : l\'historique répond et garde le seul test exploitable du cahier malformé', 'code ' + rLignesMal.code + ' ' + String(rLignesMal.corps).slice(0, 300));
    if (jMal && jMal.lignes && jMal.lignes[0]) {
      const l = jMal.lignes[0];
      ok(Array.isArray(l.domaines) && l.domaines.length === 0 && l.nb_captures === 0, 'SPEC-BANC-120 : liste non-tableau → [] ; captures non-objets ignorées', JSON.stringify({ d: l.domaines, n: l.nb_captures }));
      ok(l.erreur.indexOf('\u001b') < 0 && l.erreur.indexOf('rouge') === 0, 'SPEC-BANC-120 : séquences ANSI retirées du message', l.erreur.slice(0, 40));
      eq(l.cle, 'G-bizarre › test bizarre integration-cahiers', 'SPEC-BANC-119 : identité groupe › nom');
    }
    const rTests = await requete(PORT, 'GET', '/tests/historique/tests?rapide=tous', null);
    let jTests = null; try { jTests = JSON.parse(rTests.corps.toString()); } catch (e) { /* null */ }
    ok(rTests.code === 200 && jTests && Array.isArray(jTests.tests) && jTests.tests.some(t => t.cle === 'G-bizarre › test bizarre integration-cahiers'),
      'SPEC-BANC-118 : /tests/historique/tests liste les tests connus, y compris ceux d\'aucun catalogue', 'code ' + rTests.code);
    const rFiltreTab = await requete(PORT, 'GET', '/tests/historique/lignes?filtre=%5B1%5D', null);
    eq(rFiltreTab.code, 400, 'SPEC-BANC-120 : un filtre JSON qui n\'est pas un objet est refusé (400), jamais une exception');
    const rGrosse = await requete(PORT, 'GET', '/tests/historique/lignes?rapide=tous&taille=1000000', null);
    let jGrosse = null; try { jGrosse = JSON.parse(rGrosse.corps.toString()); } catch (e) { /* null */ }
    ok(rGrosse.code === 200 && jGrosse && jGrosse.taille <= 500 && jGrosse.lignes.length <= 500, 'SPEC-BANC-120 : la taille de page est bornée (500) — plus d\'historique entier en un JSON', 'taille ' + (jGrosse && jGrosse.taille));
    const rExport = await requete(PORT, 'GET', '/tests/historique/export?format=csv&rapide=tous&colonnes=nom,etat&filtre=' + encodeURIComponent(JSON.stringify({ nom: 'test bizarre integration-cahiers' })), null);
    const csv = rExport.corps ? rExport.corps.toString('utf8') : '';
    ok(rExport.code === 200 && /text\/csv/.test(rExport.headers['content-type'] || '') && csv.split('\n')[0].indexOf('Nom du test,État') >= 0 && csv.split('\n').length === 3,
      'SPEC-BANC-038/120 : export CSV produit par le serveur, colonnes demandées seulement', 'code ' + rExport.code + ' ' + csv.slice(0, 120));
    malformes.forEach((d) => { try { fs.rmSync(path.join(racineRes, d), { recursive: true, force: true }); } catch (e) { /* rien */ } });

    // ── SPEC-BANC-122 : seul le banc lui-même interroge ces routes ──────────
    const etrangeres = [
      ['Origin étrangère', { Origin: 'http://evil.example' }],
      ['mandataire (X-Forwarded-For)', { 'X-Forwarded-For': '203.0.113.9' }],
      ['requête intersites (Sec-Fetch-Site)', { 'Sec-Fetch-Site': 'cross-site' }],
      ['Host étranger', { Host: 'evil.example' }],
    ];
    const routesBanc = ['/tests/historique/lignes?rapide=tous', '/tests/historique/export?format=html&rapide=tous', '/tests/historique/tests', '/tests/cahiers/api', '/tests/catalogue'];
    for (const [quoi, ent] of etrangeres) {
      for (const r of routesBanc) {
        const rep = await requete(PORT, 'GET', r, null, ent);
        eq(rep.code, 403, 'SPEC-BANC-122 : ' + quoi + ' refusée sur ' + r.split('?')[0]);
      }
    }
    const rMemeOrigine = await requete(PORT, 'GET', '/tests/historique/lignes?rapide=tous&taille=1', null, { Origin: 'http://127.0.0.1:' + PORT, 'Sec-Fetch-Site': 'same-origin' });
    eq(rMemeOrigine.code, 200, 'SPEC-BANC-122 : la page du banc elle-même (même origine) reste servie');

    // export borné et découpé : un seul à la fois, et la boucle d'évènements
    // reste disponible pendant qu'il s'écrit
    await requete(PORT, 'GET', '/tests/historique/lignes?rapide=tous&taille=1', null); // index déjà construit
    const toutesColonnes = 'run,debut_run,commit,commit_court,sujet_commit,rang_commit,branche,preset,origine,inscrit,test,cle,nom,type,groupe,domaines,specs,fonctions,etiquettes,debut_test,duree_ms,etat,erreur,raison,nb_captures,motif,arbre_modifie,interrompu';
    const exports = [0, 1, 2, 3, 4].map(() => requete(PORT, 'GET', '/tests/historique/export?format=html&rapide=tous&colonnes=' + toutesColonnes, null));
    await dodo(30);
    const t0Sonde = Date.now();
    const rSonde = await requete(PORT, 'GET', '/tests/version', null);
    const latenceSonde = Date.now() - t0Sonde;
    const rExports = await Promise.all(exports);
    const codes = rExports.map(r => r.code);
    // avant : cinq exports de plusieurs dizaines de Mo construits d'un bloc,
    // tous acceptés (200 ×5), la boucle d'évènements bloquée le temps de chacun
    ok(codes.filter(c => c === 200).length >= 1 && codes.filter(c => c === 429).length >= 1 && codes.every(c => c === 200 || c === 429),
      'SPEC-BANC-122 : exports simultanés : un seul à la fois, les autres refusés (429)', JSON.stringify(codes));
    ok(rSonde.code === 200 && latenceSonde < 1500, 'SPEC-BANC-122 : le serveur répond pendant un export (' + latenceSonde + ' ms)', 'code ' + rSonde.code);
    const rFin = rExports.find(r => r.code === 200);
    ok(rFin && /<\/html>$/.test(rFin.corps.toString('utf8')), 'SPEC-BANC-122 : l\'export découpé arrive complet (page HTML fermée)');

    // L1 : le catalogue NODE est publié pour le banc (tests Node seulement et
    // d'intégration visibles sans passage dans l'historique)
    const rCat = await requete(PORT, 'GET', '/tests/catalogue', null);
    let jCat = null; try { jCat = JSON.parse(rCat.corps.toString()); } catch (e) { /* null */ }
    const typesCat = jCat && Array.isArray(jCat.tests) ? new Set(jCat.tests.map(t => t.type)) : new Set();
    ok(rCat.code === 200 && typesCat.has('integration') && jCat.tests.some(t => t.fichier === 'tests/spec-crochets.js'),
      'SPEC-BANC-118 : GET /tests/catalogue publie le catalogue Node (intégration, fichiers Node seulement)', 'code ' + rCat.code);
    ok(jCat && new Set(jCat.tests.map(t => t.cle)).size === jCat.tests.length, 'SPEC-BANC-119 : identités du catalogue Node toutes distinctes');
  } finally {
    nettoyerMalformes();
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
