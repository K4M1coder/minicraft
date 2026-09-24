/* spec-parametres.js — SPEC-PACK-002 : analyse des paramètres de lancement. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var P = MC.Parametres;

  describe('SPEC-PACK-002 — paramètres de lancement', function () {

    it('SPEC-PACK-002 : sans argument, les valeurs par défaut s\'appliquent', function () {
      var r = P.analyser([]);
      A.ok(r.ok, 'analyse réussie');
      A.equal(r.config.port, 8080, 'port par défaut');
      A.equal(r.config.serveurSeul, false);
      A.equal(r.config.maxJoueurs, 8);
      A.equal(r.config.pvp, false);
      A.equal(r.config.listeBlanche, false);
      A.equal(r.config.admin, null);
      A.equal(r.config.monde, null);
      A.equal(r.config.graine, null);
    });

    it('SPEC-PACK-002 : --serveur active le mode serveur seul', function () {
      var r = P.analyser(['--serveur']);
      A.ok(r.ok);
      A.equal(r.config.serveurSeul, true);
    });

    it('SPEC-PACK-002 : --port accepte une valeur suivante ou en =', function () {
      A.equal(P.analyser(['--port', '9999']).config.port, 9999);
      A.equal(P.analyser(['--port=1234']).config.port, 1234);
    });

    it('SPEC-PACK-002 : --graine, --monde, --max-joueurs, --admin sont lus', function () {
      var r = P.analyser(['--graine', '42', '--monde', 'ma-partie.json',
                           '--max-joueurs', '3', '--admin', 'secret123']);
      A.ok(r.ok, r.message);
      A.equal(r.config.graine, 42);
      A.equal(r.config.monde, 'ma-partie.json');
      A.equal(r.config.maxJoueurs, 3);
      A.equal(r.config.admin, 'secret123');
    });

    it('SPEC-PACK-002 : --pvp et --liste-blanche', function () {
      var r = P.analyser(['--pvp', 'on', '--liste-blanche']);
      A.ok(r.ok);
      A.equal(r.config.pvp, true);
      A.equal(r.config.listeBlanche, true);
      A.equal(P.analyser(['--pvp', 'off']).config.pvp, false);
    });

    it('SPEC-PACK-002 : --aide liste les paramètres et ne lève pas d\'erreur', function () {
      var r = P.analyser(['--aide']);
      A.equal(r.ok, false, 'aide n\'est pas une erreur mais ok=false : l\'appelant sait s\'arrêter proprement');
      A.equal(r.code, 'aide');
      A.ok(r.message.indexOf('--port') >= 0, 'aide mentionne --port');
      A.ok(r.message.indexOf('--admin') >= 0, 'aide mentionne --admin');
    });

    it('SPEC-PACK-002 : un paramètre inconnu est signalé et arrête proprement', function () {
      var r = P.analyser(['--inexistant']);
      A.equal(r.ok, false);
      A.equal(r.code, 'erreur');
      A.ok(r.message.indexOf('inexistant') >= 0, 'message clair : ' + r.message);
    });

    it('SPEC-PACK-002 : une valeur invalide est signalée (port hors bornes, non numérique)', function () {
      A.equal(P.analyser(['--port', 'abc']).ok, false, 'port non numérique refusé');
      A.equal(P.analyser(['--port', '0']).ok, false, 'port hors bornes refusé');
      A.equal(P.analyser(['--port', '999999']).ok, false, 'port hors bornes refusé');
      A.equal(P.analyser(['--pvp', 'peut-etre']).ok, false, 'booléen invalide refusé');
    });

    it('SPEC-PACK-002 : une valeur manquante en fin de ligne est signalée', function () {
      var r = P.analyser(['--port']);
      A.equal(r.ok, false);
      A.ok(r.message.indexOf('port') >= 0);
    });

    it('SPEC-PACK-002 : un argument qui ne commence pas par -- est refusé', function () {
      A.equal(P.analyser(['bonjour']).ok, false);
    });

    it('SPEC-PACK-003 : l aide se déclenche sur demande, et d elle-même sur un paramètre inconnu ou incorrect', function () {
      ['--aide', '--help', '-h', '-?', '/?'].forEach(function (d) {
        var r = P.analyser([d]);
        A.equal(r.code, 'aide', d + ' : une demande d aide, pas une erreur');
        A.ok(r.message.indexOf('--port') >= 0 && r.message.indexOf('--monde') >= 0, 'la liste entière');
      });
      var detail = P.analyser(['--aide', 'port']);
      A.equal(detail.code, 'aide');
      A.ok(/de 1 à 65535/.test(detail.message) && /exemple/.test(detail.message), 'le détail d un paramètre');
      A.ok(P.analyser(['--aide', 'inexistant']).message.indexOf('--graine') >= 0, 'sujet inconnu : la liste');
      var inconnu = P.analyser(['--prot', '80']);
      A.equal(inconnu.code, 'erreur');
      A.ok(/vouliez-vous dire --port/.test(inconnu.message), 'la suggestion la plus proche');
      A.ok(/exemple : node server.js --port/.test(inconnu.message), 'et son aide');
      A.equal(P.suggestion('maxjoueurs'), 'max-joueurs');
      A.equal(P.suggestion('zzzzzz'), null, 'rien de proche : pas de suggestion');
      var loin = P.analyser(['--zzzzzz']);
      A.ok(/--liste-blanche/.test(loin.message), 'sans suggestion : toute la liste');
      var faux = P.analyser(['--pvp', 'peut-etre']);
      A.ok(/on|off/.test(faux.message), 'une valeur incorrecte : l aide du paramètre fautif');
      A.equal(P.aideDe('rien'), null);
      A.ok(P.DEMANDES_AIDE.indexOf('--help') >= 0);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
