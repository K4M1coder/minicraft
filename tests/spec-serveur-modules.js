/* spec-serveur-modules.js — SPEC-SERVEUR-008 : server.js découpé en modules
   purs testables sous Node (src/serveur-*.js).

   Deux volets :
     - l'audit statique : server.js reste un ASSEMBLAGE (paramètres, contexte S,
       installation des modules, écoute, signaux) sous un seuil de lignes, et
       chaque module du serveur se charge SEUL dans un contexte vm vierge ;
     - pour chaque module, son installation dans un contexte S FACTICE (de
       fausses sockets, de faux clients, un dossier temporaire) et une de ses
       règles, exercée sans serveur ni réseau. Le comportement de bout en bout
       reste prouvé par les tests d'intégration (vrais processus server.js).
   Fichier Node-only : `require` et `__dirname` sont exposés par tests/run.js. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm');
  var Buffer = require('buffer').Buffer, URL = require('url').URL, processus = require('process');
  var RACINE = path.join(__dirname, '..');
  var SS = require('./source-serveur.js');
  var NP = MC.NetProtocol, C = MC.Core, CA = MC.ContratsArchi;

  var SEUIL_LIGNES_SERVER = 400;

  /* Ce que S.hote porte en vrai (server.js) — ici les VRAIS objets de Node,
     sauf les minuteries, neutralisées : un module installé par un test ne
     doit jamais laisser tourner un minuteur derrière lui. */
  function hote(extra) {
    return Object.assign({
      process: { env: {}, pid: 4242, memoryUsage: processus.memoryUsage, execPath: processus.execPath },
      Buffer: Buffer, Promise: Promise, SyntaxError: SyntaxError, URL: URL, require: require,
      setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; },
      setImmediate: function () {}, __filename: path.join(RACINE, 'server.js'), __dirname: RACINE,
    }, extra || {});
  }
  function dossierTemp(prefixe) { return fs.mkdtempSync(path.join(os.tmpdir(), prefixe)); }
  function supprimer(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* tant pis */ } }
  // fausse socket : garde les messages JSON des trames écrites
  function fausseSocket() {
    var s = { recus: [], detruite: false };
    s.write = function (buf) {
      var i = 0;
      while (i < buf.length) {
        var t = NP.decoder(buf.slice(i));
        if (!t) break;
        s.recus.push(JSON.parse(Buffer.from(t.charge).toString('utf8')));
        i += t.consomme;
      }
      return true;
    };
    s.destroy = function () { s.detruite = true; };
    return s;
  }
  function client(id, nom, extra) { return Object.assign({ id: id, nom: nom, vivant: true, rejoint: true, socket: fausseSocket() }, extra || {}); }
  function journalFactice(lignes) { return function (txt) { lignes.push(txt); }; }

  describe('Serveur découpé en modules (SPEC-SERVEUR-008)', {
    teste: 'server.js (assemblage) et src/serveur-*.js : seuil de lignes, chargement isolé de chaque module, installation dans un contexte S factice',
    pourquoi: 'Un server.js de plusieurs milliers de lignes ne se teste qu\'en bloc, sur un vrai processus : découpé en modules dont les dépendances arrivent par un contexte injecté, chaque partie se vérifie seule, sous Node, sans socket.',
    attendu: 'server.js sous le seuil et sans fonction à lui ; chaque module chargé seul ne définit que son MC.Serveur… ; installé avec de faux voisins, il publie ses fonctions et applique ses règles.',
  }, function () {

    it('SPEC-SERVEUR-008 : audit — server.js ne dépasse pas ' + SEUIL_LIGNES_SERVER + ' lignes et ne garde que l\'assemblage', function () {
      var src = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
      var n = src.split('\n').length;
      A.ok(n <= SEUIL_LIGNES_SERVER, 'server.js : ' + n + ' lignes (seuil ' + SEUIL_LIGNES_SERVER + ')');
      A.equal((src.match(/^(async\s+)?function\s/gm) || []).length, 0, 'aucune fonction déclarée dans server.js : la logique vit dans les modules');
      A.ok(/MC\.ServeurTic\.installer\(S\)/.test(src) && /setInterval\(S\.tic, 4\)/.test(src), 'la boucle de tic est branchée par server.js, son corps vit dans serveur-tic');
      A.ok(/http\.createServer|creerEcouteur/.test(SS.sourceServeur(RACINE)), 'le service HTTP/WS est créé par un module du serveur');
    });

    it('SPEC-SERVEUR-008 : chaque module du serveur se charge SEUL dans un contexte vm vierge et ne définit que son MC.Serveur…', function () {
      var noms = SS.modulesServeur(RACINE);
      A.ok(noms.length >= 10, noms.length + ' modules serveur listés dans MODULES de server.js');
      var sources = require('./sources-node.js'), purs = fs.readFileSync(path.join(RACINE, 'tests', 'gates.js'), 'utf8');
      noms.forEach(function (m) {
        var c = vm.createContext({});
        c.globalThis = c;
        vm.runInContext(fs.readFileSync(path.join(RACINE, 'src', m + '.js'), 'utf8'), c, { filename: m + '.js' });
        var cles = Object.keys(c.MC || {});
        A.equal(cles.length, 1, m + ' : un seul objet défini (' + cles.join(', ') + ')');
        A.ok(/^Serveur[A-Z]/.test(cles[0]) && typeof c.MC[cles[0]].installer === 'function', m + ' : MC.' + cles[0] + '.installer');
        A.ok(sources.indexOf(m) >= 0, m + ' : chargé par les tests Node (tests/sources-node.js)');
        A.ok(purs.indexOf("'" + m + "'") >= 0, m + ' : soumis aux portes de pureté G5/G6 (tests/gates.js)');
      });
    });

    it('SPEC-SERVEUR-008 : serveur-journal — format de console historique (« écoute : », MC_PORT=) et fichier quotidien sans SECRET', function () {
      var conf = null, lignes = [];
      function J(domaine) { return { info: function (m) { lignes.push([domaine, m]); }, warn: function () {}, error: function () {}, fatal: function () {}, debug: function () {} }; }
      J.configurer = function (o) { conf = o; };
      J.ligneSure = MC.Journal.ligneSure; J.formater = MC.Journal.formater;
      var d = dossierTemp('mc-srv-journal-');
      try {
        var S = { EP: {}, hote: hote(), fs: fs, path: path, RACINE: d, J: J };
        MC.ServeurJournal.installer(S);
        A.equal(conf.mode, 'serveur', 'MC.Journal configuré en mode serveur');
        var t = new Date(2026, 0, 2, 3, 4, 5).getTime();
        A.equal(conf.console.format({ t: t, domaine: 'SERVEUR', niveau: 'info', message: 'écoute : 127.0.0.1 · port 8080' }), '[03:04:05] écoute : 127.0.0.1 · port 8080');
        A.equal(conf.console.format({ t: t, domaine: 'CLIENT', niveau: 'error', message: 'boum' }), '[03:04:05] CLIENT ERROR boum');
        A.equal(conf.console.format({ t: t, brut: true, message: 'MC_PORT=8080' }), 'MC_PORT=8080', 'les lignes de protocole sortent telles quelles');
        A.equal(conf.console.format({ t: t, domaine: 'SERVEUR', niveau: 'info', message: 'a\nMC_PORT=1' }).indexOf('\nMC_PORT='), -1, 'un saut de ligne ne fabrique jamais une ligne de protocole');
        S.journal('bonjour');
        A.deep(lignes[lignes.length - 1], ['SERVEUR', 'bonjour'], 'journal() écrit au domaine SERVEUR');
        var sortie = S.sortieFichierJournal(d);
        sortie.ecrire({ t: t, domaine: 'SECRET', niveau: 'info', message: 'jeton' });
        sortie.ecrire({ t: t, domaine: 'SERVEUR', niveau: 'info', message: 'ligne' });
        var f = path.join(d, 'serveur-2026-01-02.log');
        var txt = fs.readFileSync(f, 'utf8');
        A.ok(/^4242 /.test(txt) && txt.indexOf('ligne') >= 0, 'ligne préfixée du pid');
        A.equal(txt.indexOf('jeton'), -1, 'le domaine SECRET n\'entre jamais dans le fichier');
        A.equal(S.DOSSIER_JOURNAL, path.resolve(d, 'logs'), 'dossier par défaut : logs/ sous la racine');
      } finally { supprimer(d); }
    });

    it('SPEC-SERVEUR-008 : serveur-parties — l\'adaptateur de fichiers de MC.Saves écrit l\'index et refuse toute autre clé', function () {
      var d = dossierTemp('mc-srv-parties-');
      try {
        var S = { EP: {}, hote: hote(), fs: fs, path: path, DOSSIER_PARTIES: d };
        MC.ServeurParties.installer(S);
        S.stockageParties.setItem(MC.Saves.INDEX_KEY, '[]');
        A.equal(fs.readFileSync(path.join(d, 'index.json'), 'utf8'), '[]', 'index.json écrit');
        A.equal(S.stockageParties.getItem(MC.Saves.INDEX_KEY), '[]', 'et relu');
        A.throws(function () { S.stockageParties.setItem('../evasion', 'x'); }, /refus/, 'clé hors des parties refusée');
        A.equal(S.stockageParties.getItem(MC.Saves.SLOT_PREFIX + '../x'), null, 'identifiant de partie invalide : rien n\'est lu');
        A.equal(S.fichierMonde('abc'), path.join(d, 'abc.json'));
        S.stockageParties.removeItem(MC.Saves.INDEX_KEY);
        A.ok(!fs.existsSync(path.join(d, 'index.json')), 'retiré');
      } finally { supprimer(d); }
    });

    function installerEtat(extra) {
      var lignes = [];
      var S = Object.assign({ EP: {}, hote: hote(), PARAMS: { zone: null }, CONF: { graine: 1234, mode: 'survie', difficulte: 'facile', mondeFichier: null, tickHz: 60, etatHz: 60 },
        regles: MC.Modes.regles('survie', 'facile'), admin: MC.Admin.creerEtat({ motDePasseAdmin: 'secret' }),
        NP: NP, SY: MC.Synchro, C: C, CA: CA, journal: journalFactice(lignes), lignes: lignes }, extra || {});
      MC.ServeurEtat.installer(S);
      return S;
    }

    it('SPEC-SERVEUR-008 : serveur-etat — l\'index des overrides par chunk suit chaque écriture du monde ; une banque par joueur', function () {
      var S = installerEtat();
      A.equal(S.EP.heure, 60, 'horloge du monde initiale');
      S.monde.overrides.set('17,5,33', C.B.STONE);
      A.ok(S.indexOverrides.get('1,2').has('17,5,33'), 'indexé sous son chunk');
      S.monde.overrides.delete('17,5,33');
      A.ok(!S.indexOverrides.has('1,2'), 'désindexé, chunk vide retiré');
      A.ok(S.banqueDe('alice/0') === S.banqueDe('alice/0') && S.banqueDe('alice/0') !== S.banqueDe('bob/0'), 'une banque par clé de registre');
      A.ok(S.joueursRegistre instanceof Map && S.conteneursPoses instanceof Map, 'registres prêts');
    });

    function installerMonde(extra) {
      var S = installerEtat(extra);
      MC.ServeurMonde.installer(S);
      S.clients = new Map();
      S.normaliserTailleConteneur = function () {};
      S.snapshotRecits = function () { return new Map(); };
      return S;
    }

    it('SPEC-SERVEUR-008 : serveur-monde — etatMonde puis appliquerEtatMonde rendent l\'heure, les blocs et l\'administration', function () {
      var S = installerMonde();
      S.EP.heure = 321.5;
      S.monde.overrides.set('1,70,2', C.B.STONE);
      MC.Admin.nommerRole(S.admin, 'Alice', 'moderateur', 'test', 0);
      var etat = JSON.parse(JSON.stringify(S.etatMonde()));
      A.equal(etat.heure, 321.5);
      var S2 = installerMonde();
      S2.appliquerEtatMonde(etat);
      A.equal(S2.EP.heure, 321.5, 'heure relue');
      A.equal(S2.monde.overrides.get('1,70,2'), C.B.STONE, 'override relu');
      A.equal(MC.Admin.roleDe(S2.admin, 'Alice'), 'moderateur', 'rôles relus');
    });

    it('SPEC-SERVEUR-008 : serveur-sauvegarde — un monde neuf est créé à la première sauvegarde, écrite de façon atomique', function () {
      var d = dossierTemp('mc-srv-sauve-');
      try {
        var f = path.join(d, 'monde.json');
        var S = installerMonde({ fs: fs, path: path, CONF: { graine: 99, mode: 'survie', difficulte: 'facile', mondeFichier: f, tickHz: 60, etatHz: 60 },
          logServeur: { warn: function () {}, info: function () {} }, logLanceur: { error: function () {}, info: function () {} },
          stockageParties: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} } });
        S.EP.partieActive = null; S.EP.reseauOuvert = false;
        MC.ServeurSauvegarde.installer(S);
        A.ok(S.lignes.some(function (l) { return /aucune sauvegarde/.test(l); }), 'monde absent : nouvelle carte annoncée');
        S.EP.heure = 77;
        A.ok(S.sauvegarderMondeSync(), 'sauvegarde synchrone réussie');
        var relu = JSON.parse(fs.readFileSync(f, 'utf8'));
        A.equal(relu.heure, 77);
        A.equal(relu.graine, 99);
        A.ok(!fs.existsSync(f + '.tmp.4242'), 'aucun fichier temporaire laissé');
        // gardes de la sauvegarde asynchrone : arrêt commencé, écriture interdite, écriture déjà en vol
        S.hote.process.hrtime = processus.hrtime;
        S.EP.sauvegardeArretee = true; S.sauvegarderMondeAsync('essai');
        A.ok(!S.EP.sauvegardeEnCours, 'après le début de l\'arrêt : aucune sauvegarde asynchrone ne démarre');
        S.EP.sauvegardeArretee = false; S.EP.ecritureMondeInterdite = true; S.sauvegarderMondeAsync('essai');
        A.ok(!S.EP.sauvegardeEnCours, 'monde refusé mis de côté : aucune écriture');
        S.EP.ecritureMondeInterdite = false; S.sauvegarderMondeAsync('essai');
        A.ok(S.EP.sauvegardeEnCours && S.EP.sauvegardeEnCoursAttente, 'sinon la sauvegarde démarre (sérialisée par tranches, en vol)');
        var attente = S.EP.sauvegardeEnCoursAttente;
        S.sauvegarderMondeAsync('essai');
        A.ok(S.EP.sauvegardeEnCoursAttente === attente, 'jamais deux sauvegardes concurrentes');
      } finally { supprimer(d); }
    });

    it('SPEC-SERVEUR-008 : serveur-simulation — un point d\'apparition est choisi au démarrage ; un toit abrite de la foudre', function () {
      var S = installerEtat({ PARAMS_HISTOIRE: null, sauvegarderMondeAsync: function () {} });
      MC.ServeurSimulation.installer(S);
      A.ok(S.SPAWN && isFinite(S.SPAWN.x) && isFinite(S.SPAWN.y) && isFinite(S.SPAWN.z), 'SPAWN publié');
      var x = Math.floor(S.SPAWN.x), z = Math.floor(S.SPAWN.z), haut = C.WORLD_H - 2;
      S.monde.setBlock(x, haut, z, C.B.STONE);
      A.equal(S.abriServeur(x, z), haut, 'le plus haut bloc plein de la colonne fait toit');
    });

    function installerClients(extra) {
      var lignes = [];
      var S = Object.assign({ EP: {}, hote: hote(), NP: NP, J: MC.Journal, CA: CA, admin: MC.Admin.creerEtat({ motDePasseAdmin: 'x' }),
        monde: null, chat: MC.Chat.creer({ max: 10 }), guildes: MC.Guildes.creerEtat(), joueursRegistre: new Map(), recitsRegistre: new Map(),
        sauvegarderMondeAsync: function () {}, journal: journalFactice(lignes), lignes: lignes, performance: { now: function () { return 1; } } }, extra || {});
      MC.ServeurClients.installer(S);
      return S;
    }

    it('SPEC-SERVEUR-008 : serveur-clients — diffusion (sauf l\'émetteur), pause du poste diffusée, blocs du monde à portée seulement', function () {
      var S = installerClients();
      var a = client(1, 'A'), b = client(2, 'B');
      S.clients.set(1, a); S.clients.set(2, b);
      S.diffuser({ t: NP.MSG.CHAT, texte: 'salut' }, 1);
      A.equal(a.socket.recus.length, 0, 'l\'émetteur exclu');
      A.equal(b.socket.recus[0].texte, 'salut');
      var rev = S.EP.pauseRev;
      S.definirPause(true);
      A.ok(S.EP.enPause && S.EP.pauseRev === rev + 1, 'pause posée, révision avancée');
      A.deep(b.socket.recus[1], { t: NP.MSG.PAUSE_ETAT, actif: true, rev: rev + 1 }, 'PAUSE_ETAT diffusé');
      a.joueurs = [{ joueur: { state: { pos: { x: 0, y: 0, z: 0 } } } }];
      b.joueurs = [{ joueur: { state: { pos: { x: 5000, y: 0, z: 0 } } } }];
      var avantB = b.socket.recus.length;
      S.noterBlocMonde(3, 64, 4, C.B.STONE);
      S.diffuserBlocsMonde();
      A.equal(a.socket.recus[a.socket.recus.length - 1].t, NP.MSG.BLOC, 'bloc envoyé au joueur proche');
      A.equal(b.socket.recus.length, avantB, 'rien au joueur lointain');
      S.envoyer({ vivant: false, socket: fausseSocket() }, { t: 'x' });   // client mort : sans effet ni exception
    });

    it('SPEC-SERVEUR-008 : serveur-http — cheminSur refuse la sortie de la racine et ne sert jamais les parties', function () {
      var S = { EP: {}, hote: hote(), fs: fs, path: path, RACINE: RACINE, CONF: { mondeFichier: path.join(RACINE, 'monde-test.json') }, DOSSIER_PARTIES: path.join(RACINE, 'parties') };
      MC.ServeurHttp.installer(S);
      A.equal(S.cheminSur('/'), path.join(RACINE, 'index.html'));
      A.equal(S.cheminSur('/../server.js'), null, 'remontée refusée');
      A.equal(S.cheminSur('/%2e%2e%2fserver.js'), null, 'remontée encodée refusée');
      A.equal(S.cheminSur('/parties/index.json'), null, 'parties jamais servies en statique');
      A.equal(S.cheminSur('/monde-test.json'), null, 'fichier --monde jamais servi');
      A.equal(S.cheminSur('/a%00b'), null, 'octet nul refusé');
    });

    /* Audit : un fichier de src/ hors de la liste blanche ne serait PAS servi au
       navigateur (404) — le jeu casserait sans bruit. Chaque fichier (sous-dossiers
       compris) doit correspondre à RESSOURCES_JEU ; sinon, message qui dit quoi faire. */
    function fichiersSrcHorsListe(fichiers, motifs) {
      return fichiers.filter(function (rel) {
        var url = '/src/' + rel.split(path.sep).join('/');
        return !motifs.some(function (re) { return re.test(url); });
      }).map(function (rel) {
        return 'src/' + rel.split(path.sep).join('/') + ' ne serait pas servi par le serveur (liste blanche RESSOURCES_JEU de src/serveur-http.js) : ' +
          'renommez-le (minuscules, chiffres et tirets, extension .js ou .css, directement dans src/) ou ajoutez un motif exact à RESSOURCES_JEU, ' +
          'avec un test dans tests/integration-archi-securite.js';
      });
    }
    function listerSrc(dossier, prefixe) {
      var out = [];
      fs.readdirSync(dossier, { withFileTypes: true }).forEach(function (e) {
        var rel = prefixe ? path.join(prefixe, e.name) : e.name;
        if (e.isDirectory()) out = out.concat(listerSrc(path.join(dossier, e.name), rel)); else out.push(rel);
      });
      return out;
    }
    it('SPEC-NET-020 : audit — tout fichier de src/ correspond à la liste blanche des ressources du jeu', function () {
      var S = { EP: {}, hote: hote(), fs: fs, path: path, RACINE: RACINE, CONF: {}, DOSSIER_PARTIES: path.join(RACINE, 'parties') };
      MC.ServeurHttp.installer(S);
      A.ok(Array.isArray(S.RESSOURCES_JEU) && S.RESSOURCES_JEU.length > 0, 'RESSOURCES_JEU publiée');
      // l'audit lui-même attrape ce qu'il doit attraper
      ['x.json', path.join('img', 'a.png'), 'Core.js', 'mon_module.js', 'a.JS', '.cache.js', path.join('sous', 'b.js')].forEach(function (f) {
        var m = fichiersSrcHorsListe([f], S.RESSOURCES_JEU);
        A.equal(m.length, 1, 'src/' + f + ' signalé');
        A.ok(/RESSOURCES_JEU/.test(m[0]) && /renommez-le/.test(m[0]), 'le message dit comment l\'autoriser');
      });
      A.deep(fichiersSrcHorsListe(['core.js', 'ui.css', 'worker-monde.js'], S.RESSOURCES_JEU), [], 'noms valides acceptés');
      var hors = fichiersSrcHorsListe(listerSrc(path.join(RACINE, 'src'), ''), S.RESSOURCES_JEU);
      A.ok(hors.length === 0, hors.join('\n'));
    });

    it('SPEC-NET-020 : serveur-http — liste blanche : seules les ressources du jeu, jamais le dépôt, quel que soit l\'encodage', function () {
      var S = { EP: {}, hote: hote(), fs: fs, path: path, RACINE: RACINE, CONF: {}, DOSSIER_PARTIES: path.join(RACINE, 'parties') };
      MC.ServeurHttp.installer(S);
      A.equal(S.cheminSur('/index.html'), path.join(RACINE, 'index.html'));
      A.equal(S.cheminSur('/admin.html'), path.join(RACINE, 'admin.html'));
      A.equal(S.cheminSur('/src/core.js?v=3'), path.join(RACINE, 'src', 'core.js'));
      A.equal(S.cheminSur('/src/ui.css'), path.join(RACINE, 'src', 'ui.css'));
      ['/.git', '/.git/HEAD', '/%2egit/HEAD', '/..%2f.git/config', '/src/../.git/HEAD', '/%252e%252e%252f.git/HEAD', '/src\\..\\.git\\HEAD',
        '/src%5c..%5c.git%5cHEAD', '/.GIT/HEAD', '/index.html::$DATA', '/GIT~1/HEAD', '/.git./HEAD', '/.git%20/HEAD', '/SRC/core.js',
        '/src/core.js.', '/src/core.js%20', '/INDEX.HTML', '/server.js', '/README.md', '/SPECS.md', '/logs/x.log', '/.claude/settings.json',
        '/node_modules/x/index.js', '/tools/paquet.js', '/tests/index.html', '/tests/', '/src/sous/x.js', '/%E0%A4%A'].forEach(function (c) {
        A.equal(S.cheminSur(c), null, c + ' refusé');
      });
      A.equal(S.cheminBanc('/tests/'), path.join(RACINE, 'tests', 'index.html'), 'banc : sa page');
      A.equal(S.cheminBanc('/SPECS.md'), path.join(RACINE, 'SPECS.md'), 'banc : SPECS.md relu par la page');
      A.equal(S.cheminBanc('/tests/donnees/ids.json'), path.join(RACINE, 'tests', 'donnees', 'ids.json'));
      A.equal(S.cheminBanc('/tests/resultats/2026-10-04_14-32-20_pr/captures/0001-debut.jpg'),
        path.join(RACINE, 'tests', 'resultats', '2026-10-04_14-32-20_pr', 'captures', '0001-debut.jpg'));
      ['/tests/../.git/HEAD', '/tests/registre/impact.json', '/tests/resultats/../../server.js', '/tests\\..\\server.js', '/tests/INDEX.html',
        '/tests/index.html::$DATA', '/tests/resultats/x/../../../.git/HEAD', '/index.html', '/README.md'].forEach(function (c) {
        A.equal(S.cheminBanc(c), null, 'banc : ' + c + ' refusé');
      });
    });

    it('SPEC-SERVEUR-008 : serveur-banc — une route du banc qui lève répond 500 en JSON, le serveur continue', function () {
      var lignes = [];
      var S = { EP: {}, hote: hote(), fs: fs, path: path, RACINE: RACINE, NP: NP, C: C, PARAMS: {}, CONF: {}, journal: journalFactice(lignes),
        repondreJSON: function (res, code, obj) { res.code = code; res.obj = obj; } };
      MC.ServeurBanc.installer(S);
      var res = { headersSent: false };
      S.filetErreurTests(function () { throw new Error('boum'); }, { url: '/tests/x' }, res);
      A.equal(res.code, 500);
      A.ok(lignes.some(function (l) { return /boum/.test(l); }), 'l\'erreur est journalisée');
    });

    it('SPEC-SERVEUR-008 : serveur-reseau — hôte local, état du réseau annoncé', function () {
      var S = { EP: {}, hote: hote(), NP: NP, CA: CA, PARAMS: { origines: null, port: 8080 }, CONF: {}, journal: function () {} };
      S.EP.reseauOuvert = false;
      MC.ServeurReseau.installer(S);
      A.ok(S.hoteLocal({ headers: { host: 'localhost:8080' } }) && S.hoteLocal({ headers: { host: '[::1]:1' } }), 'localhost et ::1 sont locaux');
      A.ok(!S.hoteLocal({ headers: { host: 'exemple.org' } }), 'un autre hôte ne l\'est pas');
      S.EP.portActuel = 8123; S.EP.adressesActives = ['127.0.0.1'];
      A.deep(S.messageReseau(), { t: NP.MSG.RESEAU_ETAT, etat: CA.ETAT_RESEAU.FERME, port: 8123, adresses: ['127.0.0.1'] });
    });

    it('SPEC-SERVEUR-008 : serveur-antiflood — budget par joueur local et par type, avertissement avant toute exclusion', function () {
      var envoyes = [], fermes = [];
      var S = { EP: {}, hote: hote(), NP: NP, CA: CA, admin: MC.Admin.creerEtat({ motDePasseAdmin: 'x' }), journal: function () {},
        envoyer: function (c, m) { envoyes.push(m); }, fermer: function (c) { fermes.push(c); } };
      S.EP.heure = 0;
      MC.ServeurAntiflood.installer(S);
      var c = { id: 1, nom: 'X', ip: '1.2.3.4' };
      var ok = 0;
      for (var i = 0; i < 40; i++) if (S.antiFloodOk(c, { t: 'ping_test' })) ok++;
      A.equal(ok, 30, 'budget général : 30 messages par seconde');
      var okChat = 0;
      for (var k = 0; k < 8; k++) if (S.antiFloodOk(c, { t: NP.MSG.CHAT })) okChat++;
      A.equal(okChat, 5, 'chat : 5 messages par fenêtre');
      for (var n = 0; n < 400; n++) S.antiFloodOk(c, { t: 'ping_test' });
      A.equal(fermes.length, 0, 'jamais exclu au premier constat aberrant');
      A.ok(envoyes.some(function (m) { return m.t === NP.MSG.CHAT && /ralentissez/.test(m.texte); }), 'un avertissement est envoyé');
    });

    it('SPEC-SERVEUR-008 : serveur-messages — un client d\'un autre format d\'identifiants est refusé, puis plus rien ne s\'applique', function () {
      var envoyes = [];
      var S = { EP: {}, hote: hote(), NP: NP, C: C, SY: MC.Synchro, CA: CA, monde: { getBlock: function () { return 0; }, getEtat: function () { return 0; } },
        envoyer: function (c, m) { envoyes.push(m); }, journal: function () {}, antiFloodOk: function () { return true; } };
      S.EP.enPause = false;
      MC.ServeurMessages.installer(S);
      var c = { id: 1, ip: '127.0.0.1' };
      S.traiter(c, { t: NP.MSG.REJOINDRE, nom: 'Vieux', formatIds: C.FIRST_ITEM + 1, version: '0.0.1' });
      A.ok(c.formatRefuse, 'client marqué refusé');
      A.equal(envoyes[0].t, NP.MSG.REFUS);
      A.ok(/format d'identifiants incompatible/.test(envoyes[0].motif));
      S.traiter(c, { t: NP.MSG.CHAT, texte: 'encore' });
      A.equal(envoyes.length, 1, 'plus aucun message traité');
      S.EP.enPause = true;
      var c2 = { id: 2 };
      S.traiter(c2, { t: NP.MSG.BLOC, x: 0, y: 0, z: 0, id: 1 });
      A.equal(envoyes.length, 1, 'en pause, un BLOC est gelé sans réponse');
    });

    it('SPEC-SERVEUR-008 : serveur-recit — l\'instantané des récits prend celui des joueurs connectés', function () {
      var exporte = { v: 1, x: 'connecte' };
      var S = { EP: {}, hote: hote(), NP: NP, CONF: {}, CA: CA, regles: MC.Modes.regles('survie', 'facile'), recitsRegistre: new Map([['ancien/0', { v: 1 }]]) };
      S.clients = new Map([[1, { joueurs: [{ cleReg: 'alice/0', recit: { archetype: 'epopee' }, recitFin: null }] }]]);
      MC.ServeurRecit.installer(S);
      var rs = S.RS, exp0 = rs.exporter;
      S.RS.exporter = function () { return exporte; };
      try {
        var snap = S.snapshotRecits();
        A.equal(snap.get('ancien/0').v, 1, 'les récits des joueurs absents restent');
        A.equal(snap.get('alice/0'), exporte, 'celui d\'un joueur connecté est exporté de son état vivant');
      } finally { rs.exporter = exp0; }
    });

    it('SPEC-SERVEUR-008 : serveur-admin — une action refusée par le rôle n\'a aucun effet ; un admin redéfinit une zone', function () {
      var admin = MC.Admin.creerEtat({ motDePasseAdmin: 'x' });
      var zonesEtat = MC.Zones.creerEtat();
      var S = { EP: {}, hote: hote(), NP: NP, C: C, CONF: {}, admin: admin, regles: MC.Modes.regles('survie', 'facile'), monde: { zonesEtat: zonesEtat },
        clients: new Map(), envoyer: function () {}, fermer: function () {}, journal: function () {} };
      S.EP.heure = 10;
      MC.ServeurAdmin.installer(S);
      A.deep(S.executerActionAdmin('joueur', 'Bob', 'zone_definir', { x: 0, z: 0, zone: 'sure' }), { ok: false, motif: 'refuse' });
      A.equal(zonesEtat.regions.size, 0, 'refus sans effet');
      var r = S.executerActionAdmin('admin', 'Root', 'zone_definir', { x: 0, z: 0, zone: 'sure' });
      A.ok(r.ok && r.data.ok, 'redéfinition acceptée');
      A.equal(MC.Zones.zoneEn(null, zonesEtat, 1, 1).zone, 'sure');
    });

    it('SPEC-SERVEUR-008 : serveur-inventaire — numéros de séquence strictement croissants ; une clé de registre connectée est reconnue', function () {
      var S = { EP: {}, hote: hote(), NP: NP, C: C, clients: new Map([[1, { joueurs: [{ cleReg: 'alice/0' }] }]]), envoyer: function () {}, journal: function () {} };
      MC.ServeurInventaire.installer(S);
      var js = { dernierSeq: 3 };
      A.ok(!S.seqNouveau(js, 3) && !S.seqNouveau(js, 2), 'rejeu refusé');
      A.ok(S.seqNouveau(js, 4) && js.dernierSeq === 4, 'nouveau accepté');
      A.ok(S.cleRegDejaConnectee('alice/0') && !S.cleRegDejaConnectee('bob/0'));
    });

    it('SPEC-SERVEUR-008 : serveur-inventaire — un conteneur posé n\'est accessible qu\'ouvert ET à portée, revérifiée à chaque opération', function () {
      var coffre = MC.Conteneurs.creerConteneur('coffre');
      var S = { EP: {}, hote: hote(), NP: NP, C: C, regles: MC.Modes.regles('survie', 'facile'), conteneursPoses: new Map([['10,64,10', coffre]]),
        clients: new Map(), envoyer: function () {}, journal: function () {} };
      MC.ServeurInventaire.installer(S);
      var PORTEE = MC.ContratsV2.BORNES.PORTEE_CONTENEUR;
      var st = { pos: { x: 10.5, y: 64 - 1.62 + 0.5, z: 10.5 }, inv: MC.Inventory.create(36), equip: {} };
      var js = { joueur: { state: st }, conteneurOuvert: '10,64,10' };
      A.ok(S.ctxJoueur(js).conteneur('10,64,10') === coffre, 'ouvert et au contact : accessible');
      A.equal(S.ctxJoueur(js).conteneur('11,64,10'), null, 'une autre clé que celle ouverte : refusée');
      st.pos.x = 10.5 + PORTEE - 0.01;
      A.ok(S.ctxJoueur(js).conteneur('10,64,10') === coffre, 'juste en deçà de la portée (' + PORTEE + ' blocs) : accessible');
      st.pos.x = 10.5 + PORTEE + 0.01;
      A.equal(S.ctxJoueur(js).conteneur('10,64,10'), null, 'juste au-delà : refusé, même ouvert');
    });

    it('SPEC-SERVEUR-008 : serveur-succes — un succès débloqué part au client du joueur, puis son état', function () {
      var envoyes = [];
      var c = { id: 7, nom: 'A', rejoint: true };
      var S = { EP: {}, hote: hote(), NP: NP, clients: new Map([[7, c]]), envoyer: function (cl, m) { envoyes.push(m); }, journal: function () {} };
      MC.ServeurSucces.installer(S);
      var js = { cid: 7, j: 0, succes: { signaler: function () { return [{ id: 'premier', nom: 'Premier' }]; }, revision: function () { return 1; }, serialiser: function () { return { ok: 1 }; } } };
      var n = S.signalerSucces(js, { type: 'casser' });
      A.equal(n.length, 1);
      A.deep(envoyes.map(function (m) { return m.t; }), [NP.MSG.SUCCES_DEBLOQUE, NP.MSG.SUCCES_ETAT]);
      A.deep(S.signalerSucces(null, {}), [], 'sans joueur : rien');
    });

    it('SPEC-SERVEUR-008 : serveur-pose — un débit prévu par le serveur est absorbé une seule fois du journal client', function () {
      var S = { EP: {}, hote: hote(), C: C, regles: MC.Modes.regles('survie', 'facile'), journal: function () {} };
      MC.ServeurPose.installer(S);
      var inv = MC.Inventory.create(9);
      inv.add(C.B.STONE, 2);
      var js = { joueur: { state: { inv: inv } } };
      A.ok(S.debiterPose(js, C.B.STONE, 0), 'pose débitée');
      A.equal(inv.count(C.B.STONE), 1);
      var ops = [{ i: 0, id: C.B.STONE, n: 1 }];
      A.deep(S.absorberDebitsPrevus(js, ops), [], 'le journal client de la même pose n\'est pas débité deux fois');
      A.deep(S.absorberDebitsPrevus(js, ops), ops, 'le crédit ne sert qu\'une fois');
      A.ok(!S.debiterPose({ joueur: { state: { inv: MC.Inventory.create(9) } } }, C.B.STONE), 'rien à poser : refus');
    });

    it('SPEC-SERVEUR-008 : serveur-vehicules — un évènement de véhicule est adressé au joueur local, un véhicule détruit n\'est plus trouvé', function () {
      var envoyes = [];
      var S = { EP: {}, hote: hote(), NP: NP, CA: CA, C: C, entites: { list: [{ eid: 5, vehicule: { type: 'chariot' }, dead: false }, { eid: 6, vehicule: {}, dead: true }] },
        envoyer: function (c, m) { envoyes.push(m); } };
      MC.ServeurVehicules.installer(S);
      S.evtVehicule({}, 1, CA.EVT_VEHICULE.REFUS, { motif: 'loin' });
      A.deep(envoyes[0], { t: NP.MSG.VEHICULE_EVT, j: 1, evt: CA.EVT_VEHICULE.REFUS, motif: 'loin' });
      A.equal(S.vehiculeParEid(5).eid, 5);
      A.equal(S.vehiculeParEid(6), null, 'détruit');
    });

    it('SPEC-SERVEUR-008 : serveur-joueurs — joueurs connectés énumérés par poste, retrouvés par nom canonique et par clé', function () {
      var S = { EP: {}, hote: hote(), NP: NP, C: C, CONF: {}, clients: new Map() };
      MC.ServeurJoueurs.installer(S);
      S.clients.set(3, { id: 3, nom: 'Élodie', rejoint: true, locaux: 2, joueurs: [{ n: 0 }, { n: 1 }] });
      S.clients.set(4, { id: 4, nom: 'Hors', rejoint: false, joueurs: [{ n: 0 }] });
      A.equal(S.tousLesJoueurs().length, 2, 'seuls les postes ayant rejoint');
      A.equal(S.placesOccupees(), 2, 'places : joueurs locaux du poste');
      A.equal(S.joueurParNom('élodie').c.id, 3, 'nom canonique');
      A.equal(S.joueurParCle('3/1').js.n, 1, 'clé id/joueur local');
      A.equal(S.joueurParCle('4/0'), null);
    });

    function contexteExpositions() {
      var blocs = new Map(), messages = [], objetsLaches = [];
      var poste = { rejoint: true, joueurs: [{ joueur: { state: { pos: { x: 0.5, y: 40, z: 0.5 }, dead: false } } }] };
      var contexte = {
        hote: hote(), NP: NP, C: C, CA: CA, regles: {}, PORTEE_BLOC: 6,
        monde: { getBlock: function (x, y, z) { return blocs.get(x + ',' + y + ',' + z) || 0; }, chunkDe: function () { return {}; } },
        entites: { dropStack: function (x, y, z, pile) { objetsLaches.push({ x: x, y: y, z: z, pile: pile }); } },
        expositions: new Map(), conteneursPoses: new Map(), clients: new Map([['poste', poste]]),
        envoyer: function (destinataire, message) { messages.push({ destinataire: destinataire, message: message }); },
        diffuser: function () {}, journal: function () {},
      };
      MC.ServeurObjets.installer(contexte);
      return { S: contexte, poste: poste, blocs: blocs, messages: messages, objetsLaches: objetsLaches };
    }

    it('SPEC-SYNC-027 : un chunk sans objet exposé transmet aussi son état vide', function () {
      var scenario = contexteExpositions();
      scenario.S.envoyerExpositionsDuChunk(scenario.poste, 0, 0);
      A.equal(scenario.messages.length, 1, 'un état vide est transmis pour effacer un ancien miroir');
      A.deep(scenario.messages[0].message, { t: CA.MSG.EXPOSITIONS, l: [], cx: 0, cz: 0 }, 'le chunk complet est vide');
    });

    it('SPEC-SYNC-027 : un chunk contenant 257 objets exposés les transmet tous sans effacer les paquets précédents', function () {
      var scenario = contexteExpositions();
      for (var index = 0; index < 257; index++) {
        var cle = (index % 16) + ',' + (40 + Math.floor(index / 256)) + ',' + (Math.floor(index / 16) % 16);
        scenario.blocs.set(cle, C.B.PRESENTOIR);
        scenario.S.expositions.set(cle, { id: C.I.DIAMOND, n: 1 });
      }
      scenario.S.envoyerExpositionsDuChunk(scenario.poste, 0, 0);
      var miroir = new Map(), remplacements = 0;
      scenario.messages.forEach(function (envoi) {
        var message = envoi.message;
        A.ok(CA.validerExpositions(message), 'chaque paquet respecte le contrat réseau existant');
        if (message.cx !== undefined) { miroir.clear(); remplacements++; }
        message.l.forEach(function (exposition) { miroir.set(exposition.slice(0, 3).join(','), exposition[3]); });
      });
      A.equal(miroir.size, 257, 'aucun objet n\'est tronqué dans le miroir du client');
      A.equal(remplacements, 1, 'le chunk est remplacé une seule fois');
    });

    it('SPEC-ARCHI-043 : un support disparu est libéré une seule fois et vidé chez deux clients présents', function () {
      var scenario = contexteExpositions();
      var autre = { rejoint: true, joueurs: [{ joueur: { state: { pos: { x: 2.5, y: 40, z: 0.5 }, dead: false } } }] };
      scenario.S.clients.set('autre', autre);
      scenario.blocs.set('0,40,0', C.B.PRESENTOIR);
      scenario.S.expositions.set('0,40,0', { id: C.I.DIAMOND, n: 1 });
      scenario.S.envoyerExpositionsProches(scenario.poste);
      scenario.S.envoyerExpositionsProches(autre);
      scenario.blocs.delete('0,40,0');
      scenario.messages.length = 0;
      A.equal(typeof scenario.S.entretenirExpositions, 'function', 'le module publie l\'entretien des expositions');
      scenario.S.entretenirExpositions();
      scenario.S.entretenirExpositions();
      A.equal(scenario.S.expositions.size, 0, 'l\'objet n\'est plus exposé sans son support');
      A.equal(scenario.objetsLaches.length, 1, 'un seul objet tombe, même après deux entretiens');
      [scenario.poste, autre].forEach(function (poste) {
        A.ok(scenario.messages.some(function (envoi) { return envoi.destinataire === poste && envoi.message.l.some(function (exposition) { return exposition[0] === 0 && exposition[1] === 40 && exposition[2] === 0 && exposition[3] === 0; }); }), 'le miroir de chaque client est vidé');
      });
    });

    it('SPEC-SYNC-027 : revenir sous 96 blocs resynchronise un chunk déjà connu sans redemande', function () {
      var scenario = contexteExpositions();
      scenario.blocs.set('0,40,0', C.B.PRESENTOIR);
      scenario.S.expositions.set('0,40,0', { id: C.I.DIAMOND, n: 1 });
      scenario.S.envoyerExpositionsProches(scenario.poste);
      A.equal(typeof scenario.S.entretenirExpositions, 'function', 'le module publie l\'entretien des expositions');
      scenario.messages.length = 0;
      scenario.S.entretenirExpositions();
      A.equal(scenario.messages.length, 0, 'un objet inchangé ne produit pas un nouvel état');
      scenario.poste.joueurs[0].joueur.state.pos.x = 100;
      scenario.S.entretenirExpositions();
      scenario.S.expositions.set('0,40,0', { id: C.I.EMERALD, n: 1 });
      scenario.messages.length = 0;
      scenario.S.entretenirExpositions();
      A.equal(scenario.messages.length, 0, 'le remplacement hors rayon n\'est pas envoyé');
      scenario.poste.joueurs[0].joueur.state.pos.x = 90;
      scenario.S.entretenirExpositions();
      A.ok(scenario.messages.some(function (envoi) { return envoi.message.l.some(function (exposition) { return exposition[3] === C.I.EMERALD; }); }), 'l\'émeraude courante est reçue au retour');
    });

    it('SPEC-SYNC-027 : une exposition reçue par chunk puis retirée hors rayon est effacée au retour', function () {
      var scenario = contexteExpositions();
      scenario.poste.joueurs[0].joueur.state.pos.x = 100;
      scenario.blocs.set('0,40,0', C.B.PRESENTOIR);
      scenario.S.expositions.set('0,40,0', { id: C.I.DIAMOND, n: 1 });
      scenario.S.envoyerExpositionsDuChunk(scenario.poste, 0, 0);
      A.ok(scenario.messages.some(function (envoi) { return envoi.message.l.some(function (exposition) { return exposition[3] === C.I.DIAMOND; }); }), 'le client connaît le diamant par le snapshot du chunk');
      scenario.messages.length = 0;
      scenario.S.libererExposition(0, 40, 0);
      A.equal(scenario.messages.length, 0, 'la destruction hors rayon n\'est pas diffusée à ce poste');
      scenario.poste.joueurs[0].joueur.state.pos.x = 90;
      scenario.S.entretenirExpositions();
      A.ok(scenario.messages.some(function (envoi) { return envoi.message.l.some(function (exposition) { return exposition[0] === 0 && exposition[1] === 40 && exposition[2] === 0 && exposition[3] === 0; }); }), 'le miroir ancien est vidé au retour sans recharger le chunk');
    });

    it('SPEC-SYNC-027 : une exposition annoncée par un refus hors portée reste synchronisée après sa disparition', function () {
      var scenario = contexteExpositions();
      scenario.S.envoyerInvMaj = function () {};
      scenario.poste.joueurs[0].joueur.state.pos.x = 100;
      scenario.blocs.set('0,40,0', C.B.PRESENTOIR);
      scenario.S.expositions.set('0,40,0', { id: C.I.DIAMOND, n: 1 });
      scenario.S.exposer(scenario.poste, { j: 0, x: 0, y: 40, z: 0, i: 0 });
      A.ok(scenario.messages.some(function (envoi) { return envoi.message.l.some(function (exposition) { return exposition[3] === C.I.DIAMOND; }); }), 'le refus annonce l\'état qui fait foi');
      scenario.messages.length = 0;
      scenario.S.libererExposition(0, 40, 0);
      A.equal(scenario.messages.length, 0, 'la disparition hors rayon ne part pas directement au client');
      scenario.poste.joueurs[0].joueur.state.pos.x = 90;
      scenario.S.entretenirExpositions();
      A.ok(scenario.messages.some(function (envoi) { return envoi.message.l.some(function (exposition) { return exposition[0] === 0 && exposition[1] === 40 && exposition[2] === 0 && exposition[3] === 0; }); }), 'l\'objet annoncé par le refus disparaît du miroir au retour');
    });

    it('SPEC-SERVEUR-008 : serveur-tic — mesures désactivées par défaut ; un tic en pause n\'avance pas le monde', function () {
      var S = { EP: {}, hote: hote(), C: C, CONF: { tickHz: 60, etatHz: 60 }, clients: new Map(), monde: {}, SPAWN: { x: 0, y: 64, z: 0 } };
      S.EP.enPause = true; S.EP.heure = 5;
      MC.ServeurTic.installer(S);
      A.deep(S.statsMesures(), { actif: false });
      A.equal(typeof S.tic, 'function');
      S.tic();
      A.equal(S.EP.heure, 5, 'l\'heure reste figée en pause');
    });
    /* SPEC-ENV-005 : le câblage serveur. serveur-tic passe à entites.update un
       multRenforts qui convertit l'id de donjon « rx,rz » en région, lit le donjon
       du monde, et interroge le volcanisme à l'heure EP.heure avec la graine CONF.graine. */
    it('SPEC-ENV-005 : serveur-tic passe à entites.update un multRenforts câblé sur le monde, l\'heure et la graine du serveur', function () {
      var Vol = MC.Volcanisme, R5 = Vol.RAYON_RENFORTS, trouve = null;
      for (var graine = 1; graine <= 60 && !trouve; graine++) {
        var w = MC.createWorld(graine);
        for (var rx = -4; rx <= 4 && !trouve; rx++) for (var rz = -4; rz <= 4 && !trouve; rz++) {
          var v = w.bio.volcanDe(rx, rz);
          if (!v || !v.actif) continue;
          var ds = w.donjons.dansZone(v.x - R5 + 50, v.z - R5 + 50, v.x + R5 - 50, v.z + R5 - 50)
            .filter(function (d) { return Math.hypot(d.x - v.x, d.z - v.z) <= R5 - 50; });
          if (ds.length) trouve = { w: w, v: v, d: ds[0], graine: graine };
        }
      }
      A.ok(trouve, 'un donjon proche d\'un volcan actif');
      var tEr = -1, tHors = -1, k, t;
      for (k = 0; k < 200 && tEr < 0; k++) { var e = Vol.eruptionDe(trouve.v, k * Vol.FENETRE, trouve.graine); if (e) tEr = (e.debut + e.fin) / 2; }
      for (t = 0; t < 40 * Vol.FENETRE && tHors < 0; t += 100) if (!Vol.activite(trouve.v, t, trouve.graine).eruption) tHors = t;
      A.ok(tEr >= 0 && tHors >= 0, 'une heure en éruption et une heure calme');

      var recu = null;
      var entites = { list: [], update: function (dt, ref, opts) { recu = opts; return { degatsPar: [], picked: [] }; }, evenements: function () { return []; }, mergeItems: function () {} };
      var base = { EP: { heure: tEr, dernier: -1e9, dureeJeu: 0 }, hote: hote(), NP: NP, C: C, CONF: { tickHz: 60, etatHz: 60, graine: trouve.graine },
        clients: new Map(), monde: trouve.w, entites: entites, profilTics: null, conteneursPoses: new Map(), boutonsAppuyes: new Map(), pvp: MC.PvpEnjeux.creerEtat(), tousLesJoueurs: function () { return []; }, SPAWN: { x: 0, y: 64, z: 0 }, regles: MC.Modes.regles('survie', 'facile') };
      var S = new Proxy(base, { get: function (cible, nom) {
        if (nom in cible || typeof nom === 'symbol') return cible[nom];
        return function () { return undefined; };
      } });
      MC.ServeurTic.installer(S);
      base.EP.dernier = -1e9;   // l'installation a réglé l'horloge sur maintenant : on laisse un temps écoulé
      S.tic();
      A.ok(recu && typeof recu.multRenforts === 'function', 'le tic passe multRenforts à entites.update');
      var attendu = Vol.multiplicateurRenfortsDonjon(trouve.w.bio, trouve.d, base.EP.heure, trouve.graine);
      A.ok(attendu >= 1.5 && attendu <= 2, 'le donjon est bien touché à l\'heure du tic : ' + attendu);
      A.equal(recu.multRenforts(trouve.d.id), attendu, 'id de donjon « rx,rz » converti en région : même facteur que le calcul pur');
      A.equal(recu.multRenforts('n\'importe quoi'), 1, 'un id mal formé : ×1');
      // hors éruption : même donjon, facteur 1 (l'heure du serveur est bien celle lue)
      base.EP.heure = tHors; base.EP.dernier = -1e9;
      recu = null; S.tic();
      A.equal(recu.multRenforts(trouve.d.id), 1, 'hors éruption : ×1');
    });

  });
  describe('Redéfinition de zone diffusée sans délai (SPEC-SECU-012)', {
    teste: 'src/serveur-admin.js (ZONE_MAJ aux postes concernés) et src/net.js (ZONE_MAJ reçu, vérifié, remis au jeu)',
    pourquoi: 'BIENVENUE ne porte que la politique de zone : sans message dédié, un joueur déjà connecté continuait de croire sa région dans son ancienne zone (indicateur, annonces) jusqu\'à une reconnexion.',
    attendu: 'zone_definir et zone_retirer acceptés envoient ZONE_MAJ aux seuls postes dont un joueur est dans la région ; une action refusée n\'envoie rien ; le client ne remet au jeu qu\'un ZONE_MAJ bien formé.',
  }, function () {

    it('SPEC-SECU-012 : serveur-admin — une redéfinition de zone part aussitôt aux postes dont un joueur est dans la région (ou une voisine), jamais aux autres ; un arrivant tardif et un joueur qui s\'approche l\'apprennent aussi', function () {
      var admin = MC.Admin.creerEtat({ motDePasseAdmin: 'x' });
      var monde = { zonesEtat: MC.Zones.creerEtat() };
      monde.zoneEn = function (x, z) { return MC.Zones.zoneEn(null, monde.zonesEtat, x, z); };
      var T = MC.Zones.TAILLE_REGION, recus = {};
      function poste(id, x, z) { return { id: id, rejoint: true, joueurs: [{ joueur: { state: { pos: { x: x, y: 64, z: z } } } }] }; }
      var dedans = poste(1, 3.5, 4.5), autreRegion = poste(4, 3 * T + 5, 4.5);
      var S = { EP: {}, hote: hote(), NP: NP, C: C, CONF: {}, admin: admin, regles: MC.Modes.regles('survie', 'facile'), monde: monde,
        clients: new Map([[1, dedans], [2, poste(2, 100000, 100000)], [3, { id: 3, rejoint: false }], [4, autreRegion]]),
        envoyer: function (c, m) { (recus[c.id] = recus[c.id] || []).push(m); }, fermer: function () {}, journal: function () {} };
      S.EP.heure = 0;
      MC.ServeurAdmin.installer(S);
      S.executerActionAdmin('joueur', 'Bob', 'zone_definir', { x: 3, z: 4, zone: 'pvp' });
      A.deep(recus, {}, 'action refusée : rien n\'est annoncé');
      S.executerActionAdmin('admin', 'Root', 'zone_definir', { x: 3, z: 4, zone: 'pvp' });
      A.equal(recus[1].length, 1, 'le poste dans la région est prévenu, dès l\'action');
      A.deep(recus[1][0], { t: NP.MSG.ZONE_MAJ, x: T / 2, z: T / 2, region: MC.Zones.regionDe(3, 4), zone: 'pvp', effective: 'pvp' });
      A.equal(MC.Zones.regionDe(recus[1][0].x, recus[1][0].z), MC.Zones.regionDe(3, 4), 'le point annoncé est dans la région');
      A.ok(!recus[2] && !recus[3] && !recus[4], 'un poste dans une autre région (au-delà des voisines), loin, ou qui n\'a pas rejoint, ne reçoit rien');
      // un poste dans une AUTRE région redéfinie, elle aussi, l'apprend — et celui de la première région non
      S.executerActionAdmin('admin', 'Root', 'zone_definir', { x: 3 * T + 5, z: 4, zone: 'sure' });
      A.equal(recus[4].length, 1, 'le poste de l\'autre région est prévenu');
      A.equal(recus[4][0].zone, 'sure');
      A.equal(recus[1].length, 1, 'celui de la première région ne l\'est pas (trop loin)');
      S.synchroniserZones(dedans);
      A.equal(recus[1].length, 1, 'rien de nouveau : aucun envoi répété');
      // arrivant tardif : il apprend la redéfinition de sa région à son arrivée (après BIENVENUE)
      var tard = poste(5, 10, 10);
      S.clients.set(5, tard);
      S.synchroniserZones(tard);
      A.equal(recus[5].length, 1, 'arrivant tardif : prévenu de la région où il naît');
      A.equal(recus[5][0].zone, 'pvp');
      // un joueur qui s'approche (région voisine) l'apprend avant d'y entrer
      autreRegion.joueurs[0].joueur.state.pos.x = T + 5;
      S.synchroniserZones(autreRegion);
      A.ok(recus[4].some(function (m) { return m.region === MC.Zones.regionDe(3, 4) && m.zone === 'pvp'; }), 'en approchant, il apprend la région voisine redéfinie');
      S.executerActionAdmin('admin', 'Root', 'zone_retirer', { x: 3, z: 4 });
      var dernier = recus[1][recus[1].length - 1];
      A.equal(dernier.zone, null, 'région rendue à la carte : zone null');
      A.equal(dernier.effective, MC.Zones.zoneEn(null, monde.zonesEtat, 3, 4).zone, 'et la zone de la carte qui s\'y applique de nouveau');
      var n = recus[1].length;
      S.executerActionAdmin('admin', 'Root', 'zone_retirer', { x: 3, z: 4 });
      A.equal(recus[1].length, n, 'retirer une région déjà rendue : rien de nouveau à annoncer');
    });

    it('SPEC-SECU-012 : client — un ZONE_MAJ bien formé est remis au jeu, normalisé ; un ZONE_MAJ invalide est ignoré', function () {
      if (!MC.createNetClient) G.Function(fs.readFileSync(path.join(RACINE, 'src', 'net.js'), 'utf8'))();
      var vus = [], ancien = G.WebSocket, socket = null;
      G.WebSocket = function () { socket = this; this.readyState = 1; this.send = function () {}; this.close = function () {}; };
      try {
        MC.createNetClient({ onZoneMaj: function (m) { vus.push(m); } }).connecter('ws://faux', 'Test', 1);
      } finally { G.WebSocket = ancien; }
      function recevoir(m) { socket.onmessage({ data: JSON.stringify(m) }); }
      recevoir({ t: NP.MSG.ZONE_MAJ, x: 3, z: 4, region: '0,0', zone: 'pvp', effective: 'pvp', parasite: 1 });
      recevoir({ t: NP.MSG.ZONE_MAJ, x: 3, z: 4, zone: null, effective: 'pvp_pve' });
      recevoir({ t: NP.MSG.ZONE_MAJ, x: 3, z: 4, zone: 'inconnue' });
      recevoir({ t: NP.MSG.ZONE_MAJ, x: 'a', z: 4, zone: 'pvp' });
      recevoir({ t: NP.MSG.ZONE_MAJ, x: 3, zone: 'sure' });
      A.deep(vus, [{ x: 3, z: 4, zone: 'pvp' }, { x: 3, z: 4, zone: null }], 'deux messages valides, normalisés ; trois invalides ignorés');
    });
  });
  describe('Armure visible des autres joueurs (SPEC-OBJET-001)', {
    teste: 'src/net.js : l\'armure d\'un joueur distant, apprise par EQUIP_VU et par ETAT (eq), rangée dans son entrée de `distants` pour que render.js l\'habille',
    pourquoi: 'le serveur annonçait l\'équipement (EQUIP_VU) mais le client l\'ignorait : aucune armure ne se voyait sur un autre joueur.',
    attendu: 'EQUIP_VU change la pièce sur-le-champ (joueur d\'écran partagé compris) ; chaque ETAT fait foi (eq absent = aucune armure) ; un id invalide est ignoré.',
  }, function () {
    it('SPEC-OBJET-001 : client — EQUIP_VU et ETAT.eq habillent le joueur distant, ETAT fait foi', function () {
      if (!MC.createNetClient) G.Function(fs.readFileSync(path.join(RACINE, 'src', 'net.js'), 'utf8'))();
      var ancien = G.WebSocket, socket = null, I = C.I;
      G.WebSocket = function () { socket = this; this.readyState = 1; this.send = function () {}; this.close = function () {}; };
      var net;
      try { net = MC.createNetClient({}); net.connecter('ws://faux', 'Test', 1); } finally { G.WebSocket = ancien; }
      function recevoir(m) { socket.onmessage({ data: JSON.stringify(m) }); }
      recevoir({ t: NP.MSG.BIENVENUE, id: 1, joueurs: [{ id: 2, nom: 'Bob', x: 0, y: 64, z: 0 }] });
      var bob = net.distants.get(2);
      A.equal(MC.Apparence.signatureArmure(bob.equip), '0,0,0,0', 'rien de connu : aucune armure');
      recevoir({ t: NP.MSG.EQUIP_VU, id: 2, j: 0, slot: 'casque', objet: I.FER_CASQUE });
      A.equal(bob.equip.casque.id, I.FER_CASQUE, 'EQUIP_VU : le casque se voit aussitôt');
      recevoir({ t: NP.MSG.EQUIP_VU, id: 2, j: 0, slot: 'bottes', objet: I.FER_CASQUE });
      A.equal(bob.equip.bottes, null, 'un casque annoncé aux pieds est ignoré');
      recevoir({ t: NP.MSG.ETAT, joueurs: [{ id: 2, j: 0, nom: 'Bob', x: 1, y: 64, z: 0, yaw: 0, eq: [I.OR_CASQUE, I.OR_PLASTRON, I.OR_JAMBIERES, I.OR_BOTTES] },
                                          { id: 2, j: 1, nom: 'Bob', x: 2, y: 64, z: 0, yaw: 0, eq: [0, 0, 0, I.CUIR_BOTTES] }], mobs: [] });
      A.equal(MC.Apparence.signatureArmure(bob.equip), [I.OR_CASQUE, I.OR_PLASTRON, I.OR_JAMBIERES, I.OR_BOTTES].join(','), 'ETAT : les quatre pièces d\'or');
      A.equal(net.distants.get('2/1').equip.bottes.id, I.CUIR_BOTTES, 'joueur d\'écran partagé (clé id/j) habillé aussi');
      recevoir({ t: NP.MSG.EQUIP_VU, id: 2, j: 1, slot: 'casque', objet: I.DIAMANT_CASQUE });
      A.equal(net.distants.get('2/1').equip.casque.id, I.DIAMANT_CASQUE, 'EQUIP_VU vise le bon joueur d\'écran partagé');
      recevoir({ t: NP.MSG.ETAT, joueurs: [{ id: 2, j: 0, nom: 'Bob', x: 1, y: 64, z: 0, yaw: 0 }], mobs: [] });
      A.equal(MC.Apparence.signatureArmure(bob.equip), '0,0,0,0', 'ETAT sans eq : il ne porte plus rien');
      recevoir({ t: NP.MSG.EQUIP_VU, id: 2, j: 0, slot: 'casque', objet: 0 });
      A.equal(bob.equip.casque, null, 'objet 0 : emplacement vidé');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
