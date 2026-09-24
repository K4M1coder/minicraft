/* integration-cdp-fake.js — test d'intégration du client CDP minimal
   (tools/cdp.js, SPEC-BANC-023) contre un FAUX serveur WebSocket local —
   PAS un vrai navigateur (voir tests/integration-e2e-headless.js pour la
   campagne e2e réelle). Un vrai script Node asynchrone, comme les autres
   tests/integration-*.js, plutôt qu'un test décrit avec describe/it :
   tests/harness.js (`T.run`) est délibérément SYNCHRONE — `it(nom, fn)`
   marque un test réussi dès que `fn()` REND (return) sans lever, y compris
   quand `fn` rend une Promise encore en attente ; toute assertion qui
   échouerait plus tard, dans un `.then()`, ne serait donc JAMAIS rapportée
   comme un échec de test (au mieux un rejet non attrapé, plus tard, sans
   rapport avec le bon test). Vérifié à la main avant d'écrire ce fichier :
   aucun des ~950 tests existants (describe/it) ne rend de Promise, tous
   sont synchrones — ce module de test avait justement besoin de vraies
   requêtes HTTP et WebSocket, donc du modèle async correct utilisé ici et
   dans les autres tests/integration-*.js (voir leur en-tête).

   Le faux serveur répond en HTTP simple sur /json/version (découverte CDP),
   puis accepte la mise à niveau WebSocket À LA MAIN — pas de dépendance
   `ws` — en réutilisant TEL QUEL le protocole RFC 6455 déjà écrit pour le
   jeu (src/net-protocol.js, `MC.NetProtocol`), chargé ici via tests/run.js
   comme une source normale (voir la construction du contexte plus bas).

   Usage : node tests/integration-cdp-fake.js */
'use strict';
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const vm = require('vm');
const fs = require('fs');

const RACINE = path.join(__dirname, '..');
const CDP = require(path.join(RACINE, 'tools', 'cdp.js'));

// src/net-protocol.js est un module UMD chargé comme dans le navigateur
// (pose globalThis.MC.NetProtocol) — un petit contexte vm suffit, pas
// besoin du chargeur complet de tests/run.js pour ce seul module.
const ctxNet = vm.createContext(Object.assign(Object.create(null), { console }));
ctxNet.globalThis = ctxNet;
vm.runInContext(fs.readFileSync(path.join(RACINE, 'src', 'net-protocol.js'), 'utf8'), ctxNet, { filename: 'src/net-protocol.js' });
const N = ctxNet.MC.NetProtocol;

const C = { r: '\x1b[31m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
let passes = 0, echecs = 0;
const details = [];
function ok(cond, nom, info) {
  if (cond) { passes++; details.push(`  ${C.g}·${C.x} ${C.d}${nom}${C.x}`); }
  else { echecs++; details.push(`  ${C.r}✗ ${nom}${C.x}${info ? '\n    ' + C.r + info + C.x : ''}`); }
}
function eq(a, b, nom) { ok(a === b, nom, `attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); }

function sha1b64(s) { return crypto.createHash('sha1').update(s, 'binary').digest('base64'); }

/* Un faux « navigateur » CDP minimal : /json/version en HTTP simple, puis
   une session WebSocket par onglet qui délègue chaque message JSON reçu à
   `comportement(msg, envoyer)`. Suffisant pour exercer tools/cdp.js de bout
   en bout (découverte, connexion, requête/réponse appariées par id,
   événements non sollicités, délais) sans jamais dépendre d'Edge ou
   Chrome. */
function demarrerFauxNavigateur(comportement) {
  const serveur = http.createServer((req, res) => {
    if (req.url === '/json/version') {
      res.setHeader('Content-Type', 'application/json');
      const port = serveur.address().port;
      res.end(JSON.stringify({ Browser: 'FauxNavigateur/1.0', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/faux` }));
      return;
    }
    res.statusCode = 404; res.end();
  });
  // Cette fausse implémentation minimale ne traite jamais de trame CLOSE
  // (0x8) reçue du client : le socket TCP upgradé reste donc ouvert du
  // point de vue du serveur HTTP même après que le client CDP a fermé sa
  // connexion (SessionCDP.fermer() envoie un close WebSocket, mais rien
  // ici ne le lit ni ne referme le socket en retour). `http.Server.close()`
  // attend que TOUTES les connexions ouvertes se terminent avant d'appeler
  // son callback — sans ce suivi, `arreter()` (plus bas) resterait bloqué
  // indéfiniment après chaque sous-test. On garde donc chaque socket
  // upgradé pour pouvoir le détruire explicitement à l'arrêt.
  serveur._socketsUpgrades = new Set();
  serveur.on('upgrade', (req, socket) => {
    const cle = req.headers['sec-websocket-key'];
    if (!N.estRequeteWebSocket(req.headers) || !cle) { socket.destroy(); return; }
    serveur._socketsUpgrades.add(socket);
    socket.on('close', () => serveur._socketsUpgrades.delete(socket));
    socket.write(N.reponseHandshake(cle, sha1b64));
    let tampon = Buffer.alloc(0);
    function envoyer(msgObj) {
      const buf = N.encoder(JSON.stringify(msgObj), N.OP.TEXTE, (n) => Buffer.alloc(n));
      try { socket.write(buf); } catch (e) { /* socket déjà fermée */ }
    }
    socket.on('data', (chunk) => {
      tampon = Buffer.concat([tampon, chunk]);
      for (;;) {
        const trame = N.decoder(tampon);
        if (!trame) break;
        tampon = tampon.slice(trame.consomme);
        if (trame.opcode !== N.OP.TEXTE) continue;
        const texte = N.utf8Decoder(trame.charge);
        let msg;
        try { msg = JSON.parse(texte); } catch (e) { continue; }
        comportement(msg, envoyer);
      }
    });
  });
  return new Promise((resolve) => { serveur.listen(0, '127.0.0.1', () => resolve(serveur)); });
}
function arreter(serveur) {
  if (serveur._socketsUpgrades) serveur._socketsUpgrades.forEach((s) => { try { s.destroy(); } catch (e) { /* déjà fermée */ } });
  return new Promise((r) => serveur.close(() => r()));
}
const dodo = (ms) => new Promise((r) => setTimeout(r, ms));

(async function () {
  // ── découverte /json/version ────────────────────────────────────────────
  {
    const serveur = await demarrerFauxNavigateur(() => {});
    try {
      const port = serveur.address().port;
      const v = await CDP.version(port);
      ok(v && v.webSocketDebuggerUrl, 'SPEC-BANC-023 : /json/version rend le point d\'entrée WebSocket');
      ok(v && v.webSocketDebuggerUrl.indexOf(`ws://127.0.0.1:${port}`) === 0, 'SPEC-BANC-023 : l\'URL WebSocket rendue est sur le bon port');
    } finally { await arreter(serveur); }
  }

  // ── attendrePortPret patiente jusqu'à ce que le port réponde ────────────
  {
    let serveur = null;
    await dodo(80); // démarre le faux navigateur avec un léger retard : vérifie le sondage répété, pas juste un aller-retour immédiat
    serveur = await demarrerFauxNavigateur(() => {});
    try {
      const v = await CDP.attendrePortPret(serveur.address().port, 3000);
      ok(v && v.webSocketDebuggerUrl, 'SPEC-BANC-023 : attendrePortPret patiente jusqu\'à ce que le port réponde');
    } finally { await arreter(serveur); }
  }

  // ── requête/réponse appariées par id ────────────────────────────────────
  {
    const serveur = await demarrerFauxNavigateur((msg, envoyer) => {
      if (msg.method === 'Runtime.evaluate') {
        envoyer({ id: msg.id, result: { result: { value: msg.params.expression === '1+1' ? 2 : null } } });
      }
    });
    let session = null;
    try {
      const v = await CDP.version(serveur.address().port);
      session = new CDP.SessionCDP(v.webSocketDebuggerUrl);
      await session.connecter(3000);
      const r = await session.envoyer('Runtime.evaluate', { expression: '1+1' }, 3000);
      eq(r.result.value, 2, 'SPEC-BANC-023 : la réponse CDP est appariée à la bonne commande par id');
    } finally { if (session) session.fermer(); await arreter(serveur); }
  }

  // ── événements non sollicités relayés (Runtime.consoleAPICalled) ───────
  {
    const serveur = await demarrerFauxNavigateur((msg, envoyer) => {
      if (msg.method === 'Page.enable') {
        envoyer({ id: msg.id, result: {} });
        envoyer({ method: 'Runtime.consoleAPICalled', params: { type: 'log', args: [{ value: 'bonjour' }] } });
      }
    });
    let session = null;
    try {
      const v = await CDP.version(serveur.address().port);
      session = new CDP.SessionCDP(v.webSocketDebuggerUrl);
      await session.connecter(3000);
      const recus = [];
      session.sur('Runtime.consoleAPICalled', (p) => recus.push(p));
      await session.envoyer('Page.enable', {}, 3000);
      await dodo(50); // laisse le temps à l'événement, envoyé juste après la réponse, d'arriver
      eq(recus.length, 1, 'SPEC-BANC-023 : un événement non sollicité est bien relayé');
      if (recus.length) eq(recus[0].type, 'log', 'SPEC-BANC-023 : le type de l\'événement relayé est conservé');
    } finally { if (session) session.fermer(); await arreter(serveur); }
  }

  // ── délai : une commande sans réponse échoue par délai, sans bloquer la session ──
  {
    const serveur = await demarrerFauxNavigateur(() => { /* ne répond jamais */ });
    let session = null;
    try {
      const v = await CDP.version(serveur.address().port);
      session = new CDP.SessionCDP(v.webSocketDebuggerUrl);
      await session.connecter(3000);
      let erreur = null;
      try { await session.envoyer('Runtime.evaluate', {}, 150); } catch (e) { erreur = e; }
      ok(!!erreur && /délai/.test(erreur.message), 'SPEC-BANC-023 : une commande sans réponse échoue par délai', erreur && erreur.message);
      // la session reste utilisable pour la commande suivante
      const r2 = await session.envoyer('Sonde.encoreVivante', {}, 500).catch((e) => e);
      ok(r2 instanceof Error, 'SPEC-BANC-023 : la session reste utilisable après un délai (nouvelle commande envoyée sans lever)');
    } finally { if (session) session.fermer(); await arreter(serveur); }
  }

  // ── une erreur CDP explicite rejette la commande avec son message ──────
  {
    const serveur = await demarrerFauxNavigateur((msg, envoyer) => { envoyer({ id: msg.id, error: { message: 'domaine inconnu' } }); });
    let session = null;
    try {
      const v = await CDP.version(serveur.address().port);
      session = new CDP.SessionCDP(v.webSocketDebuggerUrl);
      await session.connecter(3000);
      let erreur = null;
      try { await session.envoyer('Truc.inconnu', {}, 3000); } catch (e) { erreur = e; }
      eq(erreur && erreur.message, 'domaine inconnu', 'SPEC-BANC-023 : une erreur CDP explicite est transmise telle quelle');
    } finally { if (session) session.fermer(); await arreter(serveur); }
  }

  console.log(`\n${C.b}Integration CDP (faux navigateur)${C.x}\n${details.join('\n')}\n`);
  const total = passes + echecs;
  if (echecs) { console.log(`${C.r}${echecs} échec(s)${C.x} sur ${total} tests\n`); process.exit(1); }
  console.log(`${C.g}${passes}/${total} tests d intégration passent${C.x}\n`);
})().catch((e) => {
  console.error('\n' + C.r + 'erreur inattendue : ' + (e && e.stack || e) + C.x + '\n');
  process.exit(1);
});
