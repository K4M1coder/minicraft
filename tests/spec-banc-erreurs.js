/* spec-banc-erreurs.js — l'instantané de l'état du jeu et les erreurs que la
   console ne montre pas (SPEC-BANC-094 à 099, docs/banc/historique-global.md
   §3.13). Fichier Node seulement : les modules concernés (src/debug.js,
   src/workers.js, src/worker-erreurs.js, src/net.js, tests/erreurs-page.js) sont
   chargés dans des contextes isolés avec de faux environnements. Ce qui exige un
   VRAI navigateur — l'exception qui remonte vraiment de la page, d'un worker, le
   shader qui ne compile pas, le contexte WebGL perdu — est vérifié par
   tests/integration-banc-diagnostics.js. */
(function (G) {
  'use strict';
  var T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path'), vm = require('vm');
  var RACINE = path.join(__dirname, '..');
  var DIAG = require(path.join(RACINE, 'tools', 'diagnostics.js'));
  function lire(f) { return fs.readFileSync(path.join(RACINE, f), 'utf8'); }

  /* Un contexte isolé où l'on charge des fichiers du dépôt, avec un journal en mode test. */
  function contexte(fichiers, extra) {
    var ctx = vm.createContext(Object.assign({
      console: { log: function () {}, warn: function () {}, error: function () {}, info: function () {}, debug: function () {} },
      Math: Math, JSON: JSON, Date: Date, Error: Error, Object: Object, Array: Array, String: String, Number: Number, Map: Map, Set: Set, Promise: Promise,
      isFinite: isFinite, parseInt: parseInt,
    }, extra || {}));
    ctx.globalThis = ctx;
    ctx.MC_JOURNAL_MODE = 'test';
    fichiers.forEach(function (f) { vm.runInContext(lire(f), ctx, { filename: f }); });
    return ctx;
  }

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — instantané de l\'état du jeu (SPEC-BANC-094)', function () {
    function jeuFictif(sur) {
      var g = {
        world: { seed: 20260921, chunks: new Map([['0,0', { version: 3, dirty: false, mesh: {} }], ['1,0', { version: 7, dirty: true }], ['2,0', { version: 5, dirty: false, meshT: {} }]]) },
        player: { state: { pos: { x: 10.123456, y: 64, z: -3.5 }, yaw: 0.5, pitch: -0.25, dead: false, flying: true } },
        time: 1260, meteo: { type: 'clair', nom: 'Clair', couverture: 0.22, precipitation: 0 },
        entities: { list: [{ type: 'zombie' }, { type: 'zombie' }, { type: 'item' }] },
        net: { etat: 'en ligne', enLigne: function () { return true; }, mobsDistants: new Map([[1, {}]]), distants: new Map([[2, {}], [3, {}]]) },
        hoteDistant: false, input: { state: 'playing' }, fps: 58, qualite: { palier: 1 }, render: { RENDER_DIST: 6 },
        diagnostic: function () {
          return { files: { epoque: 4, genere: { enFile: 3, enVol: 2, aIntegrer: 0 }, maille: { enFile: 5, enVol: 1, aIntegrer: 2 } },
            workers: { generation: { taille: 1, libres: 0 }, maillage: { taille: 3, libres: 2 } }, erreursWorkers: { generation: 0, maillage: 1 },
            lointain: { pret: true, enCours: 1, version: 2 } };
        },
      };
      return Object.assign(g, sur || {});
    }
    var ctx = contexte(['src/journal.js', 'src/daycycle.js', 'src/debug.js']);

    it('SPEC-BANC-094 : MC_DEBUG.instantane() porte graine, position, heure, météo, chunks, files des workers, versions, entités et mode réseau', function () {
      var i = ctx.MC.Debug.creer(jeuFictif()).instantane();
      A.equal(i.graine, 20260921, 'graine');
      A.deep(i.position, { x: 10.123, y: 64, z: -3.5, yaw: 0.5, pitch: -0.25, vivant: true, vol: true }, 'position et orientation');
      A.equal(i.heure.temps, 1260, 'temps du monde');
      A.close(i.heure.heure_du_jour, 1.2, 1e-9, 'heure du jour (1260 s sur un cycle de 1200 s : 60 s dans le jour = 1,2 h)');
      A.equal(i.meteo.type, 'clair', 'météo');
      A.equal(i.chunks.charges, 3, 'chunks chargés');
      A.equal(i.chunks.a_remailler, 1, 'chunks à remailler');
      A.equal(i.chunks.sans_maillage, 1, 'chunks sans maillage');
      A.equal(i.chunks.en_attente_generation, 5, 'génération en attente = file + en vol');
      A.equal(i.chunks.en_maillage, 6, 'maillage en attente = file + en vol');
      A.deep(i.chunks.versions.echantillon, { '0,0': 3, '1,0': 7, '2,0': 5 }, 'versions de chunk');
      A.equal(i.chunks.versions.min, 3); A.equal(i.chunks.versions.max, 7);
      A.deep(i.files.genere, { enFile: 3, enVol: 2, aIntegrer: 0 }, 'file de génération');
      A.deep(i.files.maille, { enFile: 5, enVol: 1, aIntegrer: 2 }, 'file de maillage');
      A.deep(i.workers.pools.maillage, { taille: 3, libres: 2 }, 'workers de maillage');
      A.equal(i.workers.erreurs.maillage, 1, 'erreurs des workers');
      A.equal(i.lointain.pret, true, 'relief lointain');
      A.deep(i.entites, { total: 3, par_type: { zombie: 2, item: 1 }, mobs_distants: 1 }, 'entités');
      A.deep(i.reseau, { etat: 'en ligne', en_ligne: true, hote_distant: false, joueurs_distants: 2 }, 'mode réseau');
      A.deep(i.erreurs, [], 'aucun champ illisible');
    });

    it('SPEC-BANC-094 : un champ illisible vaut null et son motif est noté — l\'instantané ne lève jamais, même sur un jeu à moitié construit', function () {
      var d = ctx.MC.Debug.creer(jeuFictif({ world: null, entities: null }));
      var i = d.instantane();
      A.equal(i.graine, null, 'graine illisible');
      A.equal(i.chunks, null, 'chunks illisibles');
      A.equal(i.entites, null, 'entités illisibles');
      A.equal(i.position.vivant, true, 'le reste est lu');
      A.ok(i.erreurs.length >= 3 && i.erreurs.some(function (e) { return /^graine/.test(e); }), 'motifs notés : ' + i.erreurs.join(' | '));
      var vide = ctx.MC.Debug.creer({}).instantane();
      A.ok(vide && Array.isArray(vide.erreurs) && vide.erreurs.length > 0, 'même sur un objet vide');
      // l'échantillon des versions est borné : un monde de milliers de chunks ne gonfle pas le rapport
      var gros = new Map();
      for (var k = 0; k < 5000; k++) gros.set(k + ',0', { version: k });
      var ig = ctx.MC.Debug.creer(jeuFictif({ world: { seed: 1, chunks: gros } })).instantane();
      A.equal(Object.keys(ig.chunks.versions.echantillon).length, 40, 'échantillon borné à 40');
      A.equal(ig.chunks.charges, 5000);
      A.equal(ig.chunks.versions.max, 4999, 'min et max portent sur tous les chunks');
    });

    it('SPEC-BANC-094 : le banc prend l\'instantané dans le finally du test — l\'appel est garanti même si l\'échec survient au milieu (tests/e2e.js)', function () {
      var e2e = lire('tests/e2e.js');
      A.ok(/try \{ return await test\.fn\(g\); \}\s*finally \{ ctx\.instantane = prendreInstantane\(g\); \}/.test(e2e), 'try / finally autour du corps du test');
      A.ok(/if \(etat !== 'reussi' && !ctx\.instantane\) ctx\.instantane = prendreInstantane\(g\)/.test(e2e), 'et à l\'expiration du délai, où le corps ne rend jamais la main');
      A.ok(/MC_DEBUG\.instantane/.test(e2e), 'via MC_DEBUG.instantane()');
      var jeu = lire('src/game.js');
      A.ok(/g\.diagnostic = function/.test(jeu), 'g.diagnostic() expose files, workers et relief lointain');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — erreurs que la console ne montre pas : la page (SPEC-BANC-095, 098, 099)', function () {
    /* Un faux window : enregistre les écouteurs avec leur phase, déclenche des évènements. */
    function fauxWindow() {
      var ecouteurs = {};
      var w = {
        addEventListener: function (type, fn, phase) { (ecouteurs[type] = ecouteurs[type] || []).push({ fn: fn, phase: phase }); },
        declencher: function (type, ev) { (ecouteurs[type] || []).forEach(function (e) { e.fn(ev); }); },
        ecouteurs: ecouteurs, appelsConsole: [],
      };
      w.console = { error: function () { w.appelsConsole.push(['error'].concat([].slice.call(arguments))); }, warn: function () { w.appelsConsole.push(['warn'].concat([].slice.call(arguments))); } };
      return w;
    }
    function chargerPage(w) {
      var ctx = vm.createContext(Object.assign(w, { Math: Math, JSON: JSON, Date: Date, Array: Array, String: String, Object: Object }));
      ctx.window = ctx;
      vm.runInContext(lire('tests/erreurs-page.js'), ctx, { filename: 'erreurs-page.js' });
      return ctx;
    }

    it('SPEC-BANC-095 : tests/erreurs-page.js est le TOUT PREMIER script de tests/index.html, avant three.js et les scripts du jeu', function () {
      var page = lire('tests/index.html');
      var iErreurs = page.indexOf('<script src="erreurs-page.js"></script>');
      A.ok(iErreurs > 0, 'le script est dans la page');
      A.ok(page.indexOf('<script') === iErreurs, 'aucun <script> avant lui');
      A.ok(iErreurs < page.indexOf('three.min.js'), 'avant three.js');
      A.ok(iErreurs < page.indexOf("'../src/journal.js'"), 'avant les modules du jeu');
    });

    it('SPEC-BANC-095 : une exception non rattrapée et une promesse rejetée sont captées avec leur pile, en phase de capture', function () {
      var w = fauxWindow(), ctx = chargerPage(w);
      A.ok(w.ecouteurs.error.length >= 1 && w.ecouteurs.error[0].phase === true, 'écouteur « error » en phase de CAPTURE (les ressources ne remontent pas)');
      A.ok(w.ecouteurs.unhandledrejection.length === 1, 'écouteur « unhandledrejection »');
      var erreur = new Error('exception du jeu'); erreur.stack = 'Error: exception du jeu\n    at monModule (jeu.js:12:3)';
      w.declencher('error', { target: w, message: 'Uncaught Error: exception du jeu', filename: 'http://x/jeu.js', lineno: 12, colno: 3, error: erreur });
      w.declencher('unhandledrejection', { reason: new Error('promesse perdue') });
      var vus = ctx.MC_ERREURS_PAGE.toutes();
      A.equal(vus.length, 2);
      A.equal(vus[0].type, 'exception_page');
      A.ok(/exception du jeu/.test(vus[0].message) && /monModule/.test(vus[0].pile) && vus[0].ligne === 12, 'message, pile et position');
      A.equal(vus[1].type, 'promesse_rejetee');
      A.ok(/promesse perdue/.test(vus[1].message) && /Error: promesse perdue/.test(vus[1].pile), 'la promesse rejetée garde sa pile');
      A.ok(vus.every(function (e) { return typeof e.t === 'number' && e.source === 'page'; }), 'datées');
    });

    it('SPEC-BANC-099 : une ressource qui ne charge pas (script, image) est captée par l\'écouteur « error » en phase de capture', function () {
      var w = fauxWindow(), ctx = chargerPage(w);
      w.declencher('error', { target: { tagName: 'SCRIPT', src: 'http://x/introuvable.js' } });
      w.declencher('error', { target: { tagName: 'IMG', currentSrc: 'http://x/absente.png' } });
      var vus = ctx.MC_ERREURS_PAGE.toutes();
      A.deep(vus.map(function (e) { return e.type + ' ' + e.url; }), ['ressource http://x/introuvable.js', 'ressource http://x/absente.png']);
      A.ok(/<script>/.test(vus[0].message) && /<img>/.test(vus[1].message), 'la balise est dite');
    });

    it('SPEC-BANC-098 : console.error et console.warn (par où three.js écrit les erreurs de shader) sont captés ET transmis à la vraie console', function () {
      var w = fauxWindow(), ctx = chargerPage(w);
      w.console.error('THREE.WebGLProgram: shader error:', 0, 35715, false);
      w.console.warn('avertissement three');
      A.equal(w.appelsConsole.length, 2, 'la vraie console reçoit toujours les appels');
      var vus = ctx.MC_ERREURS_PAGE.toutes();
      A.equal(vus.length, 2);
      A.equal(vus[0].type, 'console.error');
      A.ok(/THREE\.WebGLProgram: shader error:/.test(vus[0].message));
      A.equal(vus[1].niveau, 'warn');
    });

    it('SPEC-BANC-095 : brancher(MC.Journal) verse au journal ce qui a été capté avant lui, puis la suite ; la file est bornée et datée', function () {
      var w = fauxWindow(), ctx = chargerPage(w);
      w.declencher('error', { target: w, message: 'avant le journal', error: null });
      var J = contexte(['src/journal.js']).MC.Journal;
      A.equal(ctx.MC_ERREURS_PAGE.brancher(J), true);
      var avant = J.tampon({ domaine: 'PAGE' });
      A.equal(avant.length, 1, 'l\'erreur d\'avant le journal y est versée');
      A.equal(avant[0].niveau, 'error');
      A.ok(/avant le journal/.test(avant[0].message));
      w.declencher('unhandledrejection', { reason: 'texte brut' });
      var apres = J.tampon({ domaine: 'PAGE' });
      A.equal(apres.length, 2, 'la suite va directement au journal');
      A.equal(apres[1].message, 'texte brut');
      A.equal(ctx.MC_ERREURS_PAGE.brancher('pas un journal'), false, 'un argument invalide est refusé');
      // depuis(ms) ne rend que le récent ; la file reste bornée
      var t0 = Date.now() + 1;
      A.equal(ctx.MC_ERREURS_PAGE.depuis(t0 + 100000).length, 0, 'rien dans le futur');
      for (var i = 0; i < ctx.MC_ERREURS_PAGE.MAX + 50; i++) w.declencher('error', { target: w, message: 'e' + i });
      A.equal(ctx.MC_ERREURS_PAGE.toutes().length, ctx.MC_ERREURS_PAGE.MAX, 'file bornée');
      ctx.MC_ERREURS_PAGE.vider();
      A.equal(ctx.MC_ERREURS_PAGE.toutes().length, 0);
    });

    it('SPEC-BANC-098 : checkShaderErrors reste vrai, le contexte perdu / restauré est journalisé, gl.getError() est sondé une image sur 60 en mode test seulement', function () {
      var r = lire('src/render.js');
      A.ok(/renderer\.debug\.checkShaderErrors = true/.test(r), 'les erreurs de shaders sont écrites par three.js');
      A.ok(/E-RENDU-001/.test(r) && /E-RENDU-002/.test(r), 'perte et restauration du contexte journalisées');
      A.ok(/var PERIODE_SONDE_GL = 60/.test(r), 'une image sur 60');
      A.ok(/configuration\(\)\.mode === 'test'/.test(r), 'actif seulement quand le journal est en mode test (posé par le harnais), jamais en jeu');
      var doc = lire('docs/erreurs.md');
      ['E-RENDU-001', 'E-RENDU-002', 'E-RENDU-003'].forEach(function (c) { A.ok(doc.indexOf('| ' + c + ' |') >= 0, c + ' est dans le catalogue'); });
    });

    it('SPEC-BANC-099 : les erreurs WebSocket (onerror) et le code de fermeture (onclose) du client vont au journal', function () {
      var sockets = [];
      function FauxWebSocket(url) { this.url = url; this.readyState = 0; sockets.push(this); }
      FauxWebSocket.prototype.send = function () {};
      FauxWebSocket.prototype.close = function () {};
      var ctx = contexte(['src/journal.js', 'src/core.js', 'src/contrats-vague2.js', 'src/contrats-archi.js', 'src/net-protocol.js', 'src/net.js'],
        { WebSocket: FauxWebSocket, location: { protocol: 'http:', host: 'localhost:8080' } });
      var J = ctx.MC.Journal;
      var net = ctx.MC.createNetClient({});
      net.connecter('ws://127.0.0.1:1/x', 'Alice', 1);
      var s = sockets[0];
      s.onerror();
      var e1 = J.tampon({ domaine: 'NET', niveau: 'error' }).pop();
      A.equal(e1.code, 'E-NET-001', 'erreur WebSocket : code E-NET-001');
      A.equal(e1.donnees.url, 'ws://127.0.0.1:1/x', 'l\'adresse est dans les données');
      net.connecter('ws://127.0.0.1:1/y', 'Alice', 1);
      sockets[1].onclose({ code: 1006, reason: '', wasClean: false });
      var e2 = J.tampon({ domaine: 'NET', niveau: 'warn' }).pop();
      A.equal(e2.code, 'E-NET-002', 'fermeture anormale : code E-NET-002');
      A.equal(e2.donnees.code, 1006, 'le code de fermeture est dans les données');
      net.connecter('ws://127.0.0.1:1/z', 'Alice', 1);
      sockets[2].onclose({ code: 1000, reason: 'au revoir', wasClean: true });
      var e3 = J.tampon({ domaine: 'NET' }).pop();
      A.equal(e3.niveau, 'info', 'fermeture normale : simple information');
      A.equal(e3.code, null);
    });

    it('SPEC-BANC-099 : les évènements réseau de CDP — ressource introuvable (statut ≥ 400) ou refusée — deviennent des erreurs cachées', function () {
      var requetes = new Map([['r1', { url: 'http://x/a.js', type: 'Script' }]]);
      var e404 = DIAG.depuisReponse({ response: { url: 'http://x/a.js', status: 404, statusText: 'Not Found' }, type: 'Script' });
      A.equal(e404.type, 'ressource'); A.equal(e404.statut, 404); A.ok(/introuvable/.test(e404.message) && DIAG.estErreurCachee(e404));
      A.equal(DIAG.depuisReponse({ response: { url: 'http://x/ok.js', status: 200 } }), null, 'un 200 n\'est pas une erreur');
      A.equal(DIAG.depuisReponse({ response: { url: 'http://x/ok.js', status: 304 } }), null, 'ni un 304');
      var echec = DIAG.depuisEchecReseau({ requestId: 'r1', errorText: 'net::ERR_CONNECTION_REFUSED' }, requetes);
      A.ok(/a\.js/.test(echec.message) && /ERR_CONNECTION_REFUSED/.test(echec.message) && echec.url === 'http://x/a.js');
      A.equal(DIAG.depuisEchecReseau({ requestId: 'r1', canceled: true }, requetes), null, 'une requête annulée par la page n\'est pas une panne');
      A.ok(DIAG.depuisEchecReseau({ requestId: 'r1', canceled: true, blockedReason: 'csp' }, requetes), 'sauf si elle a été bloquée');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — erreurs que la console ne montre pas : navigateur, CDP, workers (SPEC-BANC-096, 097)', function () {
    it('SPEC-BANC-096 : un message du navigateur lui-même (dépréciation, intervention, sécurité), vu par Log.entryAdded, entre dans le journal du test sans toucher console.*', function () {
      var dep = DIAG.depuisLogEntry({ entry: { source: 'deprecation', level: 'warning', text: 'Synchronous XMLHttpRequest on the main thread is deprecated', url: 'http://x/', lineNumber: 4 } });
      A.equal(dep.source, 'navigateur'); A.equal(dep.type, 'deprecation'); A.equal(dep.niveau, 'warn');
      A.equal(dep.ligne, 5, 'ligne comptée à partir de 1');
      A.ok(DIAG.estErreurCachee(dep), 'une dépréciation est une erreur que la console ne montre pas');
      var inter = DIAG.depuisLogEntry({ entry: { source: 'intervention', level: 'warning', text: 'scroll bloqué' } });
      A.equal(inter.type, 'intervention');
      var secu = DIAG.depuisLogEntry({ entry: { source: 'security', level: 'error', text: 'violates the following Content Security Policy directive' } });
      A.equal(secu.niveau, 'error');
      var ligne = DIAG.formaterEntree(dep);
      A.ok(/^\d{4}-\d\d-\d\dT[\d:.]+Z WARN NAVIGATEUR:deprecation Synchronous XMLHttpRequest/.test(ligne), 'ligne horodatée comme le journal du jeu : ' + ligne);
      A.equal(DIAG.estErreurCachee(DIAG.depuisConsole({ type: 'log', args: [{ value: 'bonjour' }] })), false, 'un console.log ordinaire n\'en est pas une');
      A.equal(DIAG.estErreurCachee(DIAG.depuisConsole({ type: 'debug', args: [{ value: 'détail' }] })), false);
    });

    it('SPEC-BANC-096 : une dépréciation, publiée par les Chrome récents comme « problème » (Audits.issueAdded) et non par console.*, est captée ; le bruit d\'accessibilité ou de formulaire ne l\'est pas', function () {
      var dep = DIAG.depuisIssue({ issue: { code: 'DeprecationIssue', details: { deprecationIssueDetails: { type: 'UnloadHandler', sourceCodeLocation: { url: 'http://x/jeu.js', lineNumber: 11, columnNumber: 3 } } } } });
      A.equal(dep.type, 'deprecation'); A.equal(dep.niveau, 'warn'); A.equal(dep.source, 'navigateur');
      A.ok(/dépréciation signalée par le navigateur : UnloadHandler/.test(dep.message), dep.message);
      A.equal(dep.ligne, 12); A.equal(dep.url, 'http://x/jeu.js');
      A.ok(DIAG.estErreurCachee(dep), 'une dépréciation est une erreur que la console ne montre pas');
      A.equal(DIAG.depuisIssue({ issue: { code: 'GenericIssue', details: {} } }), null, 'bruit de formulaire');
      A.equal(DIAG.depuisIssue({ issue: { code: 'ElementAccessibilityIssue', details: {} } }), null, 'bruit d\'accessibilité');
      A.equal(DIAG.depuisIssue({ issue: { code: 'ContentSecurityPolicyIssue', details: {} } }), null, 'la CSP arrive déjà par Log.entryAdded');
      A.equal(DIAG.depuisIssue({ issue: { code: 'constructor' } }), null, 'une propriété héritée n\'est pas un problème');
      A.equal(DIAG.depuisIssue({}), null);
      A.equal(DIAG.depuisIssue({ issue: { code: 'MixedContentIssue', details: {} } }).type, 'issue');
      A.equal(DIAG.depuisIssue({ issue: { code: 'HeavyAdIssue', details: {} } }).type, 'intervention');
    });

    it('SPEC-BANC-096 : le collecteur CDP s\'abonne à Log.entryAdded et range ce qu\'il reçoit dans le vol du test', function () {
      var ecouteurs = {}, envoyes = [];
      var session = {
        sur: function (m, fn) { (ecouteurs[m] = ecouteurs[m] || []).push(fn); },
        envoyer: function (m, p) { envoyes.push(m); return Promise.resolve({}); },
      };
      var col = new DIAG.CollecteurCDP(session);
      var fini = false;
      col.attacher({ scriptNouveauDocument: '/* script */' }).then(function () { fini = true; });
      // les abonnements sont posés tout de suite, de façon synchrone
      ['Log.entryAdded', 'Audits.issueAdded', 'Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Network.loadingFailed', 'Network.responseReceived', 'Target.attachedToTarget'].forEach(function (m) {
        A.ok(ecouteurs[m] && ecouteurs[m].length, 'abonné à ' + m);
      });
      col.debutTest();
      ecouteurs['Log.entryAdded'][0]({ entry: { source: 'deprecation', level: 'warning', text: 'API dépréciée' } });
      ecouteurs['Runtime.consoleAPICalled'][0]({ type: 'log', args: [{ value: 'console ordinaire' }] });
      var f = col.finTest();
      A.equal(f.vol.length, 2, 'les deux entrées dans le vol');
      A.equal(f.erreursCachees.length, 1, 'seule la dépréciation est une erreur cachée');
      A.equal(f.erreursCachees[0].type, 'deprecation');
      // un test suivant ne voit pas ce qui précède
      col.debutTest();
      A.equal(col.finTest().vol.length, 0, 'un nouveau test repart d\'un vol vide');
      // le collecteur borne sa mémoire
      var petit = new DIAG.CollecteurCDP(session, { max: 3 });
      petit.attacher();
      petit.debutTest();
      for (var i = 0; i < 10; i++) petit._ajouter(DIAG.entree('navigateur', 'error', 'exception', 'e' + i));
      var fp = petit.finTest();
      A.equal(fp.vol.length, 3, 'tampon borné');
      A.equal(fp.volPerdues, 7, 'les entrées perdues sont comptées');
    });

    it('SPEC-BANC-095 : Runtime.exceptionThrown donne le message et la pile de l\'exception ; page et CDP voient la même panne, elle n\'est comptée qu\'une fois', function () {
      var e = DIAG.depuisExceptionThrown({ exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: boum\n    at f (jeu.js:3:9)' }, url: 'http://x/jeu.js', lineNumber: 2 } });
      A.equal(e.type, 'exception'); A.equal(e.message, 'Error: boum'); A.ok(/at f \(jeu\.js:3:9\)/.test(e.pile)); A.equal(e.ligne, 3);
      var parLaPage = { t: 5, source: 'page', type: 'exception_page', niveau: 'error', message: 'Error: boum' };
      var fusion = DIAG.fusionner([[parLaPage], [Object.assign({}, e, { t: 6 })]]);
      A.equal(fusion.length, 1, 'une seule entrée pour une même panne');
      A.equal(fusion[0].source, 'page', 'la plus ancienne est gardée');
      var autre = DIAG.fusionner([[parLaPage], [DIAG.depuisLogEntry({ entry: { source: 'deprecation', level: 'warning', text: 'autre chose' } })]]);
      A.equal(autre.length, 2, 'deux pannes différentes restent deux');
      A.equal(DIAG.depuisExceptionThrown({}).message, 'exception sans détail', 'jamais d\'exception sur un évènement inattendu');
    });

    it('SPEC-BANC-097 : le collecteur suit les workers (Target.setAutoAttach, session fille) et marque leurs exceptions', function () {
      var ecouteurs = {}, commandes = [];
      var session = {
        sur: function (m, fn) { (ecouteurs[m] = ecouteurs[m] || []).push(fn); },
        envoyer: function (m, p, d, sid) { commandes.push({ m: m, p: p, sid: sid }); return Promise.resolve({}); },
      };
      var col = new DIAG.CollecteurCDP(session);
      col.attacher();      // les abonnements sont posés tout de suite ; les commandes partent ensuite (async, vérifiées par l'intégration)
      var src = lire('tools/diagnostics.js');
      A.ok(/Target\.setAutoAttach', \{ autoAttach: true, waitForDebuggerOnStart: false, flatten: true \}/.test(src), 'auto-attachement en mode flatten, sans arrêter le worker au démarrage');
      ecouteurs['Target.attachedToTarget'][0]({ sessionId: 'S1', targetInfo: { type: 'worker', url: 'http://x/src/worker-monde.js' } });
      var actives = commandes.filter(function (c) { return c.sid === 'S1'; }).map(function (c) { return c.m; });
      A.deep(actives, ['Runtime.enable', 'Log.enable'], 'les domaines du worker sont activés sur sa session');
      col.debutTest();
      ecouteurs['Runtime.exceptionThrown'][0]({ exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: plantage du worker\n    at executerGeneration' } } }, 'S1');
      var f = col.finTest();
      A.equal(f.erreursCachees.length, 1);
      A.equal(f.erreursCachees[0].source, 'worker', 'marquée « worker »');
      A.equal(f.erreursCachees[0].worker, 'http://x/src/worker-monde.js', 'avec le script du worker');
      A.ok(/plantage du worker/.test(f.vol[0]) && /\[worker\]/.test(f.vol[0]));
      ecouteurs['Target.attachedToTarget'][0]({ sessionId: 'S2', targetInfo: { type: 'iframe', url: 'http://x/' } });
      A.equal(commandes.filter(function (c) { return c.sid === 'S2'; }).length, 0, 'une iframe n\'est pas suivie');
      // le client CDP adresse une session fille et transmet sa session aux écouteurs
      var cdp = fs.readFileSync(path.join(RACINE, 'tools', 'cdp.js'), 'utf8');
      A.ok(/envoyer\(methode, params, delaiMs, sessionId\)/.test(cdp) && /fn\(msg\.params \|\| \{\}, msg\.sessionId\)/.test(cdp), 'tools/cdp.js : sessionId à l\'envoi, et passé aux écouteurs');
    });

    it('SPEC-BANC-097 : un worker renvoie ses erreurs au fil principal par postMessage({ type: \'journal\' }) — sans annuler l\'évènement (le repli synchrone en dépend)', function () {
      var ctx = contexte(['src/worker-erreurs.js']);
      var envoyes = [], ecouteurs = {}, annule = false;
      var faux = {
        postMessage: function (m) { envoyes.push(m); },
        addEventListener: function (type, fn) { ecouteurs[type] = fn; },
      };
      A.equal(ctx.MC.WorkerErreurs.installer(faux, 'worker-monde'), true);
      A.ok(ecouteurs.error && ecouteurs.unhandledrejection, 'les deux écouteurs sont posés');
      var err = new Error('génération impossible'); err.stack = 'Error: génération impossible\n    at executerGeneration (taches-chunks.js:9:1)';
      ecouteurs.error({ message: 'Uncaught Error: génération impossible', error: err, filename: 'worker-monde.js', lineno: 30, preventDefault: function () { annule = true; } });
      ecouteurs.unhandledrejection({ reason: new Error('rejet dans le worker'), preventDefault: function () { annule = true; } });
      A.equal(annule, false, 'l\'évènement n\'est PAS annulé : worker.onerror du fil principal doit encore le recevoir');
      A.equal(envoyes.length, 2);
      A.equal(envoyes[0].type, 'journal'); A.equal(envoyes[0].origine, 'error'); A.equal(envoyes[0].worker, 'worker-monde');
      A.ok(/génération impossible/.test(envoyes[0].message) && /executerGeneration/.test(envoyes[0].pile), 'message et pile');
      A.equal(envoyes[0].ligne, 30);
      A.equal(envoyes[1].origine, 'unhandledrejection');
      A.ok(/rejet dans le worker/.test(envoyes[1].message));
      // un message démesuré est tronqué ; une cible sans postMessage est refusée sans lever
      var long = ctx.MC.WorkerErreurs.messageErreur('error', 'w', new Array(5000).join('x'), new Array(9000).join('y'));
      A.equal(long.message.length, ctx.MC.WorkerErreurs.MAX_MESSAGE); A.equal(long.pile.length, ctx.MC.WorkerErreurs.MAX_PILE);
      A.equal(ctx.MC.WorkerErreurs.installer({}, 'x'), false);
      var casse = { postMessage: function () { throw new Error('port fermé'); }, addEventListener: function (t, fn) { ecouteurs[t] = fn; } };
      ctx.MC.WorkerErreurs.installer(casse, 'x');
      ecouteurs.error({ message: 'm' });      // ne lève pas
    });

    it('SPEC-BANC-097 : le pool verse au journal worker.onerror (E-WORK-001), les messages du worker (E-WORK-002) et onmessageerror (E-WORK-004) — sans libérer le worker ni casser le repli', function () {
      var workers = [];
      function FauxWorker(script) { this.script = script; workers.push(this); }
      FauxWorker.prototype.postMessage = function () {};
      FauxWorker.prototype.terminate = function () {};
      var ctx = contexte(['src/journal.js', 'src/workers.js'], { Worker: FauxWorker });
      var J = ctx.MC.Journal;
      var recus = [], pannes = 0;
      var pool = ctx.MC.Workers.creerPool({ script: 'worker-monde.js', taille: 1, onMessage: function (d) { recus.push(d); }, onErreur: function () { pannes++; } });
      pool.envoyer({ type: 'genere' }, []);
      A.equal(pool.libres(), 0, 'le worker travaille');
      // un message de journal du worker ne libère pas le worker et n'est pas un résultat de tâche
      workers[0].onmessage({ data: { type: 'journal', niveau: 'error', origine: 'unhandledrejection', worker: 'worker-monde', message: 'promesse rejetée dans le worker', pile: 'Error: x\n    at f (w.js:1:1)' } });
      A.equal(pool.libres(), 0, 'toujours occupé : un message de journal n\'est pas une réponse');
      A.equal(recus.length, 0, 'et il n\'est pas transmis comme résultat');
      var e2 = J.tampon({ domaine: 'WORKER' }).pop();
      A.equal(e2.code, 'E-WORK-002'); A.equal(e2.niveau, 'error');
      A.ok(/promesse rejetée dans le worker/.test(e2.message) && /at f \(w\.js:1:1\)/.test(e2.pile), 'message et pile du worker');
      A.equal(e2.donnees.origine, 'unhandledrejection');
      // un vrai résultat libère le worker
      workers[0].onmessage({ data: { type: 'chunk', epoque: 0, cx: 0, cz: 0 } });
      A.equal(pool.libres(), 1); A.equal(recus.length, 1);
      // worker.onerror : journalisé ET transmis à onErreur (le repli synchrone, SPEC-PERF-006)
      workers[0].onerror({ message: 'Uncaught Error: boum', filename: 'worker-monde.js', lineno: 7 });
      var e1 = J.tampon({ domaine: 'WORKER' }).pop();
      A.equal(e1.code, 'E-WORK-001'); A.equal(e1.donnees.ligne, 7); A.equal(e1.donnees.worker, 'worker-monde.js');
      A.equal(pannes, 1, 'onErreur est toujours appelé');
      workers[0].onmessageerror();
      A.equal(J.tampon({ domaine: 'WORKER' }).pop().code, 'E-WORK-004');
    });

    it('SPEC-BANC-097 : worker-monde.js et worker-maillage.js chargent le relais d\'erreurs et l\'installent ; game.js journalise les tâches en échec (E-WORK-003)', function () {
      ['src/worker-monde.js', 'src/worker-maillage.js'].forEach(function (f) {
        var s = lire(f);
        A.ok(/'journal', 'worker-erreurs', 'core'/.test(s), f + ' : worker-erreurs chargé juste après le journal');
        A.ok(/MC\.WorkerErreurs\.installer\(self, '/.test(s), f + ' : écouteurs installés');
      });
      A.ok(/E-WORK-003/.test(lire('src/game.js')), 'game.js : tâche en échec journalisée');
      var doc = lire('docs/erreurs.md');
      ['E-WORK-001', 'E-WORK-002', 'E-WORK-003', 'E-WORK-004', 'E-NET-001', 'E-NET-002'].forEach(function (c) { A.ok(doc.indexOf('| ' + c + ' |') >= 0, c + ' est dans le catalogue'); });
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
