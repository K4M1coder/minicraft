/* spec-limites.js — exploration des limites techniques dans la suite standard
   (SPEC-LIMITE-001 à 004, SPEC-LIMITE-006), en mode rapide.

   Tests volontairement NON bloquants sur ce qu'ils mesurent : une limite
   atteinte (monde répété au-delà de 2³¹, coordonnées tronquées par le réseau,
   tremblement GPU…) est consignée comme « échec interne » dans le tableau
   affiché, sans faire échouer la suite. Seul l'échec de la construction du
   tableau — une sonde qui plante ou rend une ligne mal formée — fait échouer
   le test, et donc la porte de qualité : l'outil de mesure lui-même doit
   rester sain. L'exploration profonde (toutes les distances, coût de
   génération, cahier dédié) : node tests/explo-limites.js */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T, L = G.MC_LIMITES;
  var describe = T.describe, it = T.it, A = T.assert;
  var afficher = typeof console !== 'undefined' && console.error ? function (t) { console.error(t); } : function () {};
  var maintenant = function () { return typeof performance !== 'undefined' ? performance.now() : Date.now(); };
  var resultat = null;

  function sonderUneFois() {
    if (!resultat) resultat = L.sonder(MC, { rapide: true, maintenant: maintenant });
    return resultat;
  }

  describe('SPEC-LIMITE — exploration des limites techniques (non bloquant, @exploration)', function () {
    ['SPEC-LIMITE-001', 'SPEC-LIMITE-002', 'SPEC-LIMITE-003', 'SPEC-LIMITE-004'].forEach(function (id) {
      it(id + ' : la sonde mesure et construit son tableau (succès et échecs internes, valeurs relevées)', function () {
        var r = sonderUneFois();
        var s = r.sondes.filter(function (x) { return x.id === id; })[0];
        A.ok(s, id + ' a été exécutée');
        // la construction du tableau est la seule vraie vérification
        var t = L.tableau({ sondes: [s] });
        A.gt(t.lignes.length, 0, id + ' : tableau non vide');
        A.ok(typeof s.conclusion === 'string' && s.conclusion.length > 0, id + ' : conclusion rédigée');
        afficher(L.texte({ sondes: [s] }));
      });
    });

    it('SPEC-LIMITE-006 : le tableau récapitulatif se construit, et une sonde défaillante le fait échouer', function () {
      var r = sonderUneFois(), t = L.tableau(r);
      A.equal(t.lignes.length, t.total.ok + t.total.echec + t.total.info, 'chaque ligne a un statut connu');
      // l'outil refuse un tableau impossible à construire
      var plantee = { sondes: [{ id: 'X', titre: 'x', fiche: {}, lignes: [], erreur: 'boum' }] };
      var refuse = false;
      try { L.tableau(plantee); } catch (e) { refuse = /planté/.test(e.message); }
      A.ok(refuse, 'une sonde qui plante fait échouer la construction');
      var malFormee = { sondes: [{ id: 'Y', titre: 'y', fiche: {}, lignes: [{ mesure: 'm', valeur: '1', statut: 'peut-être' }] }] };
      refuse = false;
      try { L.tableau(malFormee); } catch (e) { refuse = /mal formée/.test(e.message); }
      A.ok(refuse, 'une ligne au statut inconnu fait échouer la construction');
      // la précision 32 bits est calculée juste (référence : 2^24 → pas de 2)
      A.equal(L.pas32(16777216), 2);
      A.equal(L.pas32(1), Math.pow(2, -23));
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
