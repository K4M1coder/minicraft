/* spec-banc-profils.js — journal du serveur, profil CPU, profil GPU en couches
   et messages réseau (SPEC-BANC-100 à 103, docs/banc/historique-global.md
   §3.13). Fichier Node seulement : fonctions pures de tools/diagnostics.js et
   modules chargés dans des contextes isolés. Les profils RÉELS (Profiler.start/stop
   d'un vrai Chrome, SystemInfo.getInfo, timers GPU) et le serveur RÉEL qui plante
   sont vérifiés par tests/integration-banc-diagnostics.js. */
(function (G) {
  'use strict';
  var T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path'), vm = require('vm'), os = require('os');
  var RACINE = path.join(__dirname, '..');
  var DIAG = require(path.join(RACINE, 'tools', 'diagnostics.js'));
  function lire(f) { return fs.readFileSync(path.join(RACINE, f), 'utf8'); }

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — journal du serveur d\'un test d\'intégration (SPEC-BANC-100)', function () {
    it('SPEC-BANC-100 : recolterJournalServeur() lit les journaux des serveurs lancés par le test et isole les exceptions non rattrapées avec leur pile', function () {
      var d = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-journal-essai-'));
      try {
        fs.writeFileSync(path.join(d, 'serveur-2026-10-05.log'), [
          '4242 2026-10-05T10:00:00.000Z INFO SERVEUR écoute : http://127.0.0.1:50000',
          '4242 2026-10-05T10:00:01.000Z INFO SERVEUR EXCEPTION NON RATTRAPÉE (le serveur continue) : Error: panne asynchrone de test',
          '    at Timeout._onTimeout (server.js:300:9)',
          '    at listOnTimeout (node:internal/timers:581:17)',
          '4242 2026-10-05T10:00:02.000Z INFO SERVEUR PROMESSE REJETÉE SANS GESTIONNAIRE (le serveur continue) : Error: rejet de test',
          '    at Immediate._onImmediate (server.js:310:9)',
          '4242 2026-10-05T10:00:03.000Z INFO SERVEUR joueur parti',
        ].join('\n') + '\n');
        fs.writeFileSync(path.join(d, 'autre.txt'), 'ignoré');
        var r = DIAG.recolterJournalServeur(d);
        A.equal(r.fichiers.length, 1, 'seuls les fichiers serveur-*.log sont lus');
        A.equal(r.lignes.length, 7, 'toutes les lignes du journal');
        A.equal(r.pannes.length, 2, 'deux pannes : l\'exception et la promesse rejetée');
        A.ok(/EXCEPTION NON RATTRAPÉE/.test(r.pannes[0].ligne) && /panne asynchrone de test/.test(r.pannes[0].ligne));
        A.ok(/at Timeout\._onTimeout \(server\.js:300:9\)/.test(r.pannes[0].pile), 'avec sa pile');
        A.ok(/PROMESSE REJETÉE/.test(r.pannes[1].ligne) && /server\.js:310:9/.test(r.pannes[1].pile));
        A.deep(DIAG.recolterJournalServeur(path.join(d, 'inexistant')), { lignes: [], pannes: [], fichiers: [] }, 'dossier absent : rien, sans lever');
        var bornee = DIAG.recolterJournalServeur(d, { maxLignes: 3 });
        A.equal(bornee.lignes.length, 3, 'bornée aux dernières lignes');
        A.equal(bornee.pannes.length, 2, 'les pannes, elles, sont cherchées sur tout le journal');
      } finally { fs.rmSync(d, { recursive: true, force: true }); }
    });

    it('SPEC-BANC-100 : tests/run.js donne à chaque script d\'intégration son propre dossier de journal et en joint le contenu à l\'échec ou à la lenteur', function () {
      var run = lire('tests/run.js');
      A.ok(/MC_JOURNAL_DOSSIER: dossierJournal/.test(run), 'un dossier de journal par script');
      A.ok(/recolterJournalServeur\(dossierJournal/.test(run), 'collecté après le script');
      A.ok(/serveur: \{ journal: serveur\.lignes, pannes: serveur\.pannes \}/.test(run), 'joint au résultat (la politique ne le garde que pour un échec ou un test lent)');
      A.ok(/uncaughtException/.test(lire('server.js')) && /unhandledRejection/.test(lire('server.js')), 'server.js journalise lui-même les exceptions et rejets non rattrapés (process.on)');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — profil CPU d\'un test lent (SPEC-BANC-101)', function () {
    /* Un profil minimal, au format .cpuprofile des DevTools de Chrome. */
    function profil(o) {
      return Object.assign({
        nodes: [
          { id: 1, callFrame: { functionName: '(root)', scriptId: '0', url: '', lineNumber: -1, columnNumber: -1 }, children: [2, 3] },
          { id: 2, callFrame: { functionName: 'genererChunk', scriptId: '1', url: 'http://x/src/world.js', lineNumber: 99, columnNumber: 4 }, children: [] },
          { id: 3, callFrame: { functionName: 'mailler', scriptId: '2', url: 'http://x/src/mesher.js', lineNumber: 41, columnNumber: 2 }, children: [] },
        ],
        startTime: 1000000, endTime: 1006000, samples: [2, 2, 3, 2], timeDeltas: [1000, 1000, 2000, 2000],
      }, o || {});
    }

    it('SPEC-BANC-101 : validerCpuprofile() n\'accepte qu\'un profil que les DevTools ouvrent sans erreur', function () {
      A.equal(DIAG.validerCpuprofile(profil()), true);
      A.equal(DIAG.validerCpuprofile(null), false, 'absent');
      A.equal(DIAG.validerCpuprofile(profil({ nodes: [] })), false, 'sans nœuds');
      A.equal(DIAG.validerCpuprofile(profil({ timeDeltas: [1] })), false, 'échantillons et écarts de temps incohérents');
      A.equal(DIAG.validerCpuprofile(profil({ samples: [9, 9, 9, 9] })), false, 'échantillon sur un nœud inexistant');
      A.equal(DIAG.validerCpuprofile(profil({ endTime: 5 })), false, 'fin avant le début');
      A.equal(DIAG.validerCpuprofile(profil({ startTime: 'x' })), false, 'bornes non numériques');
    });

    it('SPEC-BANC-101 : resumerCpuprofile() classe les fonctions par temps propre', function () {
      var top = DIAG.resumerCpuprofile(profil(), 5);
      A.equal(top.length, 2);
      A.ok(/genererChunk/.test(top[0].fonction) && /world\.js:100/.test(top[0].fonction), 'la plus lente d\'abord, ligne comptée à partir de 1 : ' + top[0].fonction);
      A.equal(top[0].ms, 4, 'temps propre en ms (4000 µs sur trois échantillons)');
      A.equal(top[1].ms, 2);
      A.equal(DIAG.resumerCpuprofile({}, 5).length, 0, 'profil invalide : liste vide');
    });

    it('SPEC-BANC-101 : le profil CPU démarre au seuil de lenteur, s\'arrête à la fin du test, est écrit en .cpuprofile et joint au rapport', function () {
      var h = lire('tools/e2e-headless.js');
      A.ok(/setTimeout\(\(\) => \{\s*suivi\.cpu = DIAG\.demarrerProfilCPU\(session\)/.test(h), 'Profiler.start déclenché AU seuil de lenteur, pas avant');
      A.ok(/DIAG\.arreterProfilCPU\(session, opts\.dossierPieces, test\.nom\)/.test(h), 'Profiler.stop à la fin du test');
      A.ok(/if \(suivi\.minuteur\) clearTimeout\(suivi\.minuteur\)/.test(h), 'un test rapide ne paie rien');
      var d = lire('tools/diagnostics.js');
      A.ok(/Profiler\.enable/.test(d) && /Profiler\.start/.test(d) && /Profiler\.stop/.test(d), 'protocole CDP Profiler');
      A.ok(/\.cpuprofile/.test(d), 'fichier .cpuprofile');
    });

    it('SPEC-BANC-101 : le résultat d\'un test e2e porte les tâches longues du fil principal (PerformanceObserver longtask, avec attribution) et l\'histogramme des temps d\'image', function () {
      var e2e = lire('tests/e2e.js');
      A.ok(/PerformanceObserver\(function \(liste\)/.test(e2e) && /observe\(\{ type: 'longtask' \}\)/.test(e2e), 'observateur longtask');
      A.ok(/attribution/.test(e2e) && /containerType/.test(e2e), 'avec attribution');
      A.ok(/function histogrammeImages\(images\)/.test(e2e), 'histogramme des temps d\'image');
      A.ok(/out\.longtasks = d\.longtasks/.test(e2e) && /out\.histogrammeImages = hist/.test(e2e), 'joints au résultat (échec ou lenteur seulement)');
    });

    it('SPEC-BANC-101 : le rapport montre le profil CPU (fichier, durée, fonctions les plus lentes) pour un test lent, avec un lien', function () {
      var RT = require(path.join(RACINE, 'tools', 'resultats-tests.js'));
      var base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-rapport-'));
      var pieces = path.join(RT.DOSSIER_PIECES, 'essai-' + process.pid);
      fs.mkdirSync(pieces, { recursive: true });
      try {
        var source = path.join(pieces, 'test-lent.cpuprofile');
        fs.writeFileSync(source, JSON.stringify(profil()));
        var r = RT.ecrireCahier({ schema: 1, campagne: { preset: 'essai', seuilLentMs: 1000 }, tests: [{
          nom: 'un test lent', type: 'e2e', groupe: 'g', etat: 'ok', duree_ms: 5000, domaines: [], specs: [],
          profilCPU: { source: source, echantillons: 4, duree_ms: 6, top: DIAG.resumerCpuprofile(profil(), 3) },
        }] }, { racine: base });
        var j = JSON.parse(fs.readFileSync(path.join(r.dossierAbsolu, 'resultats.json'), 'utf8'));
        A.ok(/^profils\/test-lent\.cpuprofile$/.test(j.tests[0].profilCPU.fichier), 'le profil est copié dans le cahier : ' + j.tests[0].profilCPU.fichier);
        A.equal(j.tests[0].profilCPU.source, undefined, 'le chemin temporaire ne reste pas');
        A.ok(fs.existsSync(path.join(r.dossierAbsolu, 'profils', 'test-lent.cpuprofile')), 'fichier présent');
        A.notOk(fs.existsSync(source), 'la pièce temporaire est consommée');
        var html = fs.readFileSync(path.join(r.dossierAbsolu, 'rapport.html'), 'utf8');
        A.ok(/profil CPU/.test(html) && /genererChunk/.test(html) && /href="profils\/test-lent\.cpuprofile"/.test(html), 'le rapport le montre et le lie');
        // un test rapide du même cahier n'a rien
        var r2 = RT.ecrireCahier({ schema: 1, campagne: { preset: 'essai', seuilLentMs: 10000 }, tests: [{ nom: 'rapide', type: 'e2e', groupe: 'g', etat: 'ok', duree_ms: 50, domaines: [], specs: [], profilCPU: { fichier: 'profils/x.cpuprofile' } }] }, { racine: base });
        A.equal(JSON.parse(fs.readFileSync(path.join(r2.dossierAbsolu, 'resultats.json'), 'utf8')).tests[0].profilCPU, undefined, 'un test rapide ne porte pas de profil');
      } finally { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(pieces, { recursive: true, force: true }); }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — profil GPU en couches (SPEC-BANC-102)', function () {
    it('SPEC-BANC-102 : chaque couche indique « non disponible » avec sa raison plutôt qu\'une valeur inventée', function () {
      var p = DIAG.assemblerProfilGPU(null, null, null, null);
      ['memoire', 'dessin', 'temps_gpu', 'processus', 'systeme'].forEach(function (c) {
        A.equal(p.couches[c].disponible, false, c + ' : non disponible');
        A.ok(p.couches[c].raison && p.couches[c].raison.length > 5, c + ' : raison donnée');
      });
      A.deep(DIAG.couchesRenseignees(p), [], 'aucune couche renseignée sans données');
      var jeu = { memoire: { disponible: true, geometries: 10, textures: 2, octets_estimes: 1000 }, dessin: { disponible: true, appels: 40, triangles: 9000, programmes: 5, passes: { principale: { appels: 40, triangles: 9000 } } },
        temps_gpu: { disponible: false, raison: 'EXT_disjoint_timer_query_webgl2 non exposée par ce navigateur ou ce GPU' } };
      var proc = { disponible: true, peripheriques: [{ fabricant: 'Google', modele: 'SwiftShader' }] };
      var complet = DIAG.assemblerProfilGPU(jeu, proc, DIAG.NON_DISPONIBLE('compteurs typeperf : run sans fenêtre'), null);
      A.deep(DIAG.couchesRenseignees(complet), ['memoire', 'dessin', 'processus'], 'mémoire, dessin et processus renseignées');
      A.equal(complet.couches.temps_gpu.disponible, false, 'sans l\'extension : temps GPU « non disponible »');
      A.ok(/EXT_disjoint_timer_query_webgl2/.test(complet.couches.temps_gpu.raison), 'et la raison dit pourquoi');
      A.equal(complet.couches.temps_gpu.passes, undefined, 'jamais de valeur inventée');
    });

    it('SPEC-BANC-102 : le jeu mesure mémoire estimée, coût de dessin par passe et — si l\'extension existe — temps GPU en p50/p95 (src/render.js)', function () {
      var r = lire('src/render.js');
      A.ok(/profilGPU: function \(\)/.test(r) && /demarrerProfilGPU: function/.test(r), 'render.profilGPU() et demarrerProfilGPU()');
      A.ok(/EXT_disjoint_timer_query_webgl2/.test(r) && /TIME_ELAPSED_EXT/.test(r) && /GPU_DISJOINT_EXT/.test(r), 'timer queries, mesures disjointes jetées');
      A.ok(/p50_ms/.test(r) && /p95_ms/.test(r), 'p50 et p95');
      A.ok(/renderer\.info\.memory/.test(r) || /info\.memory\.geometries/.test(r), 'renderer.info.memory');
      A.ok(/info\.programs/.test(r), 'programmes de shaders');
      ['principale', 'refraction', 'antialias', 'sous_eau', 'calque_eau'].forEach(function (nom) { A.ok(r.indexOf("passe('" + nom + "'") >= 0, 'passe nommée : ' + nom); });
      A.ok(/note: 'estimation calculée par le jeu/.test(r), 'la mémoire est dite ESTIMÉE : une page ne lit pas la VRAM réelle');
    });

    it('SPEC-BANC-102 : les compteurs typeperf (VRAM dédiée, occupation du moteur) ne sont lus que sur Windows, avec fenêtre et vrai GPU', function () {
      A.equal(DIAG.lireCompteursSysteme({ avecFenetre: false, accelerationMaterielle: true }, 4321, function () { return ''; }).disponible, false, 'sans fenêtre : non disponible');
      A.ok(/sans fenêtre/.test(DIAG.lireCompteursSysteme({ avecFenetre: false, accelerationMaterielle: true }, 1, function () { return ''; }).raison));
      A.ok(/rendu logiciel/.test(DIAG.lireCompteursSysteme({ avecFenetre: true, accelerationMaterielle: false }, 1, function () { return ''; }).raison), 'rendu logiciel : pas de vrai GPU');
      A.equal(DIAG.lireCompteursSysteme({ avecFenetre: true, accelerationMaterielle: null }, 1, function () { return ''; }).disponible, false, 'GPU inconnu : jamais supposé');
      var sortie = '"(PDH-CSV 4.0)","\\\\H\\GPU Process Memory(pid_4321_luid_0x0_0x1_phys_0)\\Dedicated Usage","\\\\H\\GPU Process Memory(pid_99_luid_0x0_0x1_phys_0)\\Dedicated Usage","\\\\H\\GPU Engine(pid_4321_luid_0x0_0x1_phys_0_eng_0_engtype_3D)\\Utilization Percentage"\r\n' +
        '"10/05/2026 22:00:00.000","268435456.000000","1024.000000","37.500000"\r\n';
      var mesures = DIAG.parserTypeperf(sortie);
      A.equal(mesures.length, 3);
      A.close(mesures[0].valeur, 268435456, 0, 'VRAM dédiée');
      var r = DIAG.lireCompteursSysteme({ avecFenetre: true, accelerationMaterielle: true }, 4321, function (cmd, args) {
        A.equal(cmd, 'typeperf'); A.ok(args.indexOf('-sc') >= 0, 'un échantillon'); A.ok(args.some(function (a) { return /GPU Process Memory/.test(a); }));
        return sortie;
      });
      A.equal(r.disponible, true); A.equal(r.pid_gpu, 4321);
      A.equal(r.mesures.length, 2, 'seul le processus GPU du navigateur est retenu (pas pid_99)');
      var panne = DIAG.lireCompteursSysteme({ avecFenetre: true, accelerationMaterielle: true }, 1, function () { throw new Error('typeperf introuvable'); });
      A.equal(panne.disponible, false); A.ok(/typeperf a échoué/.test(panne.raison));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — messages réseau d\'un test en échec (SPEC-BANC-103)', function () {
    it('SPEC-BANC-103 : le client garde les N derniers messages échangés — sens, type, seq, taille, horodatage — dans un tampon borné', function () {
      var sockets = [];
      function FauxWebSocket(url) { this.url = url; this.readyState = 1; sockets.push(this); this.envoyes = []; }
      FauxWebSocket.prototype.send = function (t) { this.envoyes.push(t); };
      FauxWebSocket.prototype.close = function () {};
      var ctx = vm.createContext({ console: console, Math: Math, JSON: JSON, Date: Date, Error: Error, Object: Object, Array: Array, String: String, Number: Number, Map: Map, Set: Set, Promise: Promise, isFinite: isFinite,
        WebSocket: FauxWebSocket, location: { protocol: 'http:', host: 'x' } });
      ctx.globalThis = ctx; ctx.MC_JOURNAL_MODE = 'test';
      ['src/journal.js', 'src/core.js', 'src/contrats-vague2.js', 'src/contrats-archi.js', 'src/net-protocol.js', 'src/net.js'].forEach(function (f) { vm.runInContext(lire(f), ctx, { filename: f }); });
      var net = ctx.MC.createNetClient({});
      net.connecter('ws://x', 'Alice', 1);
      var ws = sockets[0];
      ws.onopen();
      ws.onmessage({ data: JSON.stringify({ t: ctx.MC.NetProtocol.MSG.BIENVENUE, id: 7, joueurs: [] }) });
      net.envoyerEntree({ s: 12, dt: 0.016, k: 0, yaw: 0, pitch: 0, v: 1 }, 0);
      net.envoyerChat('bonjour');
      var m = net.derniersMessages(10);
      A.ok(m.length >= 3, 'les messages sont notés : ' + JSON.stringify(m.map(function (x) { return x.sens + ' ' + x.type; })));
      var recu = m.filter(function (x) { return x.sens === 'recu'; })[0];
      var entree = m.filter(function (x) { return x.sens === 'envoi' && x.type === ctx.MC.NetProtocol.MSG.ENTREE; })[0];
      A.equal(recu.type, ctx.MC.NetProtocol.MSG.BIENVENUE); A.ok(recu.taille > 10, 'taille du texte reçu');
      A.equal(entree.seq, 12, 'le numéro de séquence des entrées');
      A.ok(m.every(function (x) { return typeof x.t === 'number' && typeof x.taille === 'number'; }), 'horodatés, avec leur taille');
      A.ok(m[0].t <= m[m.length - 1].t, 'du plus ancien au plus récent');
      for (var i = 0; i < 400; i++) net.envoyerChat('m' + i);
      A.equal(net.derniersMessages().length, 200, 'tampon borné à 200 messages');
      A.equal(net.derniersMessages(5).length, 5, 'les n derniers');
      A.equal(net.derniersMessages(5)[4].type, ctx.MC.NetProtocol.MSG.CHAT);
    });

    it('SPEC-BANC-103 : messagesDuJournalServeur() lit les lignes RESEAU:trace du journal du serveur (sens, type, seq, taille, horodatage)', function () {
      var lignes = [
        '4242 2026-10-05T10:00:00.100Z INFO SERVEUR écoute : http://127.0.0.1:50000',
        '4242 2026-10-05T10:00:01.000Z TRACE RESEAU recu rejoindre seq=- taille=62 joueur=#1',
        '4242 2026-10-05T10:00:01.010Z TRACE RESEAU envoi bienvenue seq=- taille=48210 joueur=#1',
        '4242 2026-10-05T10:00:01.050Z TRACE RESEAU recu entree seq=12 taille=88 joueur=#1',
        '4242 2026-10-05T10:00:01.055Z TRACE RESEAU envoi etat seq=- taille=912 joueur=#1',
      ];
      var m = DIAG.messagesDuJournalServeur(lignes);
      A.equal(m.length, 4, 'quatre lignes de trace, la ligne d\'écoute est ignorée');
      A.deep(m.map(function (x) { return [x.sens, x.type, x.seq, x.taille]; }), [['recu', 'rejoindre', null, 62], ['envoi', 'bienvenue', null, 48210], ['recu', 'entree', 12, 88], ['envoi', 'etat', null, 912]]);
      A.equal(m[0].t, Date.parse('2026-10-05T10:00:01.000Z'), 'horodatage du serveur');
      A.ok(m.every(function (x) { return x.cote === 'serveur'; }));
    });

    it('SPEC-BANC-103 : rapportReseau() fusionne client et serveur dans l\'ordre du temps, avec le journal du serveur pendant le test', function () {
      var t0 = Date.parse('2026-10-05T10:00:01.000Z');
      var client = [{ sens: 'envoi', type: 'rejoindre', seq: null, taille: 62, t: t0 - 5 }, { sens: 'recu', type: 'bienvenue', seq: null, taille: 48210, t: t0 + 20 }, { sens: 'envoi', type: 'entree', seq: 12, taille: 88, t: t0 + 40 }];
      var journal = [
        '4242 2026-10-05T10:00:01.000Z TRACE RESEAU recu rejoindre seq=- taille=62 joueur=#1',
        '4242 2026-10-05T10:00:01.010Z TRACE RESEAU envoi bienvenue seq=- taille=48210 joueur=#1',
        '4242 2026-10-05T10:00:01.050Z TRACE RESEAU recu entree seq=12 taille=88 joueur=#1',
      ];
      var r = DIAG.rapportReseau(client, journal, 50);
      A.equal(r.messages.length, 6, 'les deux côtés');
      A.deep(r.messages.map(function (x) { return x.cote + ':' + x.sens + ':' + x.type; }),
        ['client:envoi:rejoindre', 'serveur:recu:rejoindre', 'serveur:envoi:bienvenue', 'client:recu:bienvenue', 'client:envoi:entree', 'serveur:recu:entree'], 'ordre du temps, dans les deux sens');
      A.ok(r.messages.every(function (x) { return x.type && typeof x.t === 'number'; }), 'type et horodatage partout');
      A.equal(r.journal_serveur.length, 3, 'le journal du serveur est joint');
      var derniers = DIAG.rapportReseau(client, journal, 2);
      A.equal(derniers.messages.length, 2, 'seulement les N derniers');
      A.equal(derniers.messages[1].type, 'entree');
      // le rapport HTML montre le tableau
      var RT = require(path.join(RACINE, 'tools', 'resultats-tests.js'));
      var base = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-reseau-'));
      try {
        var c = RT.ecrireCahier({ schema: 1, campagne: { preset: 'essai' }, tests: [{ nom: 'test réseau', type: 'integration', groupe: 'g', etat: 'echec', duree_ms: 10, domaines: ['NET'], specs: [], reseau: r }] }, { racine: base });
        var html = fs.readFileSync(path.join(c.dossierAbsolu, 'rapport.html'), 'utf8');
        A.ok(/derniers messages réseau \(6/.test(html) && /bienvenue/.test(html) && /journal du serveur pendant le test/.test(html), 'le rapport affiche les messages et le journal du serveur');
      } finally { fs.rmSync(base, { recursive: true, force: true }); }
    });

    it('SPEC-BANC-103 : le serveur trace chaque message reçu et envoyé avec --journal RESEAU:trace, et son fichier de journal accepte un domaine relevé', function () {
      var cl = lire('src/serveur-clients.js'), rs = lire('src/serveur-reseau.js'), sj = lire('src/serveur-journal.js');
      A.ok(/function traceReseauActive\(\) \{ return !!S\.logReseau && J\.niveau\('RESEAU'\) === 'trace'; \}/.test(cl), 'actif seulement si le domaine RESEAU est relevé au niveau trace');
      A.ok(/tracerMessage\('envoi', msg, texte\.length, c\)/.test(cl), 'envoi tracé');
      A.ok(/S\.tracerMessage\('recu', msg, d\.charge\.length, c\)/.test(rs), 'réception tracée');
      A.ok(/nom: 'fichier', seuil: 'info', suitDomaines: true/.test(sj), 'un domaine relevé écrit aussi dans le fichier du serveur');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
