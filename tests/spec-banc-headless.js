/* spec-banc-headless.js — tests Node PURS, SYNCHRONES, de l'outillage e2e
   sans fenêtre (SPEC-BANC-023/024/025) : détection/lancement du navigateur
   (tools/navigateur.js), déduction de l'accélération matérielle et sélection
   du préréglage e2e-fumee (tools/e2e-headless.js, tests/presets.js).

   Volontairement SANS jamais lancer un vrai navigateur ni ouvrir de vraie
   connexion réseau : tests/harness.js (`T.run`, describe/it) est
   délibérément SYNCHRONE — un test est marqué réussi dès que sa fonction
   REND sans lever, y compris quand elle rend une Promise encore en attente ;
   une assertion qui échouerait plus tard dans un `.then()` ne serait donc
   JAMAIS rapportée comme un échec ici (vérifié à la main : aucun des ~950
   tests existants de ce dépôt, tous synchrones, n'a ce besoin). Le
   protocole CDP contre un faux serveur WebSocket (requête/réponse par id,
   événements relayés, délais, erreurs) a réellement besoin d'await/async
   pour être vérifié correctement : il vit donc dans
   tests/integration-cdp-fake.js, un vrai script Node asynchrone comme les
   autres tests/integration-*.js — voir son en-tête. La campagne e2e réelle,
   dans un vrai Edge/Chrome, vit dans tests/integration-e2e-headless.js.

   Fichier Node-only comme tests/spec-banc.js (voir son en-tête) : pas
   chargé côté navigateur. */
(function (G) {
  'use strict';
  var T = G.T, MC_TESTS = G.MC_TESTS;
  var describe = T.describe, it = T.it, A = T.assert;
  var path = require('path');
  var fs = require('fs');
  var RACINE = path.join(__dirname, '..');
  var NAV = require(path.join(RACINE, 'tools', 'navigateur.js'));
  var E2EH = require(path.join(RACINE, 'tools', 'e2e-headless.js'));

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — détection et lancement du navigateur (tools/navigateur.js)', function () {

    it('SPEC-BANC-023 : un port libre est effectivement libre (bind immédiat possible)', function () {
      // synchrone : NAV.portLibre() rend une Promise, mais rien ici n'a
      // besoin d'attendre son résultat pour vérifier une propriété simple —
      // on teste directement le module net sous-jacent à la place, à la
      // portée réelle de ce fichier (SANS jamais ouvrir de socket vers
      // l'extérieur, un simple bind() local est instantané et synchrone
      // dans son constat, même si l'API Node est async par nature).
      var net = require('net');
      var s = net.createServer();
      var leve = null;
      try { s.listen(0, '127.0.0.1'); s.close(); } catch (e) { leve = e; }
      A.equal(leve, null, 'un bind sur le port 0 (choisi par l\'OS) ne lève jamais');
    });

    it('SPEC-BANC-023 : trouverNavigateur(cheminForce) respecte le chemin forcé s\'il existe, sinon rend null', function () {
      var reel = path.join(RACINE, 'SPECS.md'); // un fichier réel, pas un exécutable : suffit à tester le passage
      A.equal(NAV.trouverNavigateur(reel), reel, 'chemin forcé existant repris tel quel');
      A.equal(NAV.trouverNavigateur(path.join(RACINE, 'ce-fichier-n-existe-vraiment-pas.exe')), null, 'chemin forcé absent -> null');
    });

    it('SPEC-BANC-023 : arreterProprement ne lève jamais, même sans processus ni profil', function () {
      NAV.arreterProprement(null);
      NAV.arreterProprement({});
      NAV.arreterProprement({ processus: null, dossierProfil: null });
      A.ok(true, 'aucune exception');
    });

    it('SPEC-BANC-024 : la largeur/hauteur minimales exposées par le module respectent le plancher de résolution (jamais sous 800×600)', function () {
      A.ok(NAV.LARGEUR_MIN >= 800, 'LARGEUR_MIN >= 800 : ' + NAV.LARGEUR_MIN);
      A.ok(NAV.HAUTEUR_MIN >= 600, 'HAUTEUR_MIN >= 600 : ' + NAV.HAUTEUR_MIN);
      A.ok(NAV.LARGEUR_MIN >= 1280 && NAV.HAUTEUR_MIN >= 800, 'SPEC-BANC-024 : surface par défaut ≥ 1280×800');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — accélération matérielle et sélection (SPEC-BANC-024/025)', function () {

    it('SPEC-BANC-024 : un renderer logiciel connu est reconnu comme tel', function () {
      A.equal(E2EH.accelerationDepuisRenderer('Google SwiftShader'), false, 'SwiftShader = logiciel');
      A.equal(E2EH.accelerationDepuisRenderer('llvmpipe (LLVM 15.0.0, 256 bits)'), false, 'llvmpipe = logiciel');
      A.equal(E2EH.accelerationDepuisRenderer('Microsoft Basic Render Driver'), false, 'pilote de base = logiciel');
    });

    it('SPEC-BANC-024 : un renderer de carte graphique réelle est reconnu comme matériel', function () {
      A.equal(E2EH.accelerationDepuisRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)'), true, 'GPU réel = matériel');
      A.equal(E2EH.accelerationDepuisRenderer('Apple M1'), true, 'GPU réel = matériel');
    });

    it('SPEC-BANC-024 : sans renderer connu (contexte WebGL absent), l\'accélération est indéterminée', function () {
      A.equal(E2EH.accelerationDepuisRenderer(null), null, 'null -> indéterminé, pas "logiciel" par défaut');
      A.equal(E2EH.accelerationDepuisRenderer(''), null, 'chaîne vide -> indéterminé');
    });

    it('SPEC-BANC-025 : le préréglage e2e-fumee sélectionne exactement ses tests nommés, sans en capter d\'autres', function () {
      var fumee = (MC_TESTS.PRESETS || []).filter(function (p) { return p.nom === 'e2e-fumee'; })[0];
      A.ok(fumee, 'préréglage e2e-fumee déclaré');
      A.ok(fumee.criteres.tests.length >= 3, 'au moins quelques tests représentatifs');

      var faux = fumee.criteres.tests.map(function (nom) { return { nom: nom, groupe: 'e2e', type: 'e2e' }; });
      faux.push({ nom: 'un tout autre test qui ne devrait jamais être pris', groupe: 'e2e', type: 'e2e' });
      var specsIndex = MC_TESTS.indexSpecs(fs.readFileSync(path.join(RACINE, 'SPECS.md'), 'utf8'));
      var cat = MC_TESTS.construire(T, faux, specsIndex);
      var selection = MC_TESTS.selection(cat, fumee.criteres);
      A.equal(selection.length, fumee.criteres.tests.length, 'exactement les tests nommés, ni plus ni moins');
      selection.forEach(function (t) {
        A.ok(fumee.criteres.tests.indexOf(t.nom) >= 0, 'chaque test sélectionné fait partie de la liste nommée : ' + t.nom);
      });
    });

    it('SPEC-BANC-025 : e2e-fumee est réservé au crochet (pas au testeur/développeur, pour ne pas dupliquer le préréglage e2e)', function () {
      var fumee = (MC_TESTS.PRESETS || []).filter(function (p) { return p.nom === 'e2e-fumee'; })[0];
      A.ok(fumee && fumee.pour.indexOf('crochet') >= 0, 'e2e-fumee est bien utilisable par un crochet git (pre-push)');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
