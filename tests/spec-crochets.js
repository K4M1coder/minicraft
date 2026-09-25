/* spec-crochets.js — tests des crochets git eux-mêmes (tools/hooks/*.js),
   hors du périmètre de tests/spec-banc.js. Fichier Node-only, volontairement :
   comme spec-banc.js, il lit le texte des crochets sur disque — `require`,
   `process` et `__dirname` sont exposés dans le contexte d'exécution par
   tests/run.js à cette seule fin (voir son en-tête). */
(function (G) {
  'use strict';
  var T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path');
  var RACINE = path.join(__dirname, '..');

  describe('Specs — crochets git (filet anti-blocage)', function () {

    it('SPEC-BANC-010 : un seul filet anti-blocage de 15 min (900 s) partout, crochets compris', function () {
      // La constante partagée doit rester à 900 s : c'est elle que les crochets
      // référencent désormais (plus de littéral numérique à scanner dans leur
      // texte), donc c'est elle qu'il faut vérifier directement pour que ce
      // test détecte encore une dérive de la valeur partagée.
      var DELAI_FILET_S = require('../tools/hooks/delai-filet.js').DELAI_FILET_S;
      A.equal(DELAI_FILET_S, 900, 'la constante partagée DELAI_FILET_S vaut 900 s');

      var fichiersCrochets = ['pre-commit.js', 'pre-push.js', 'pre-merge-commit.js']
        .filter(function (f) { return fs.existsSync(path.join(RACINE, 'tools', 'hooks', f)); });
      A.ok(fichiersCrochets.indexOf('pre-commit.js') >= 0, 'pre-commit.js existe');
      A.ok(fichiersCrochets.indexOf('pre-push.js') >= 0, 'pre-push.js existe');

      var deviants = [];
      fichiersCrochets.forEach(function (f) {
        var txt = fs.readFileSync(path.join(RACINE, 'tools', 'hooks', f), 'utf8');
        // toute occurrence de --delai suivie d'une valeur : elle DOIT être 900
        var re = /--delai['"]?\s*,\s*['"]?(\d+)/g;
        var m;
        while ((m = re.exec(txt))) {
          if (m[1] !== '900') deviants.push(f + ' passe --delai ' + m[1]);
        }
      });
      A.deep(deviants, [], 'aucun crochet ne passe un délai différent de 900 s : ' + deviants.join(', '));
    });

  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
