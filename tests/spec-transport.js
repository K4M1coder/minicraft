/* spec-transport.js — SPEC-TRANSPORT-003 : risque d'attaque d'une caravane
   marchande. (SPEC-TRANSPORT-001/002 : voir tests/spec-vehicules.js ;
   SPEC-TRANSPORT-004/005 suivent plus bas.) */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, I = C.I;
  var CV = MC.Caravanes, Eco = MC.Economie;

  describe('Specs — transport (caravanes, fret, péages)', function () {

    it('SPEC-TRANSPORT-003 : risque d\'attaque plus élevé en danger, réduit par un garde, cargaison diminuée seulement en cas d\'attaque', function () {
      var trajet = { id: 'r:beaulac>valombre', role: 'axe' };   // 'axe' : seul rôle qui peut porter un garde
      var N = 3000;
      function taux(danger, garde) {
        var touches = 0;
        for (var k = 0; k < N; k++) if (CV.subitAttaque(trajet, k, danger, garde)) touches++;
        return touches / N;
      }
      var tPaix = taux(false, false), tGuerre = taux(true, false);
      A.ok(tGuerre > tPaix * 3, 'nettement plus dangereux en guerre/zone pvp : ' + tGuerre.toFixed(3) + ' vs ' + tPaix.toFixed(3));
      A.close(tPaix, CV.P_ATTAQUE_PAISIBLE, 0.02, 'proche de la probabilité de base en paix');
      A.close(tGuerre, CV.P_ATTAQUE_DANGER, 0.03, 'proche de la probabilité de base en danger');

      var tGuerreGarde = taux(true, true);
      A.ok(tGuerreGarde < tGuerre * 0.5, 'un garde réduit nettement le risque : ' + tGuerreGarde.toFixed(3) + ' vs ' + tGuerre.toFixed(3));

      // même trajet, même index : toujours le même verdict (déterministe)
      A.equal(CV.subitAttaque(trajet, 5, true, false), CV.subitAttaque(trajet, 5, true, false));

      // un garde RÉELLEMENT présent dans composition() (rôle 'axe') réduit le
      // risque mesuré sur les départs qui en portent un, vs ceux qui n'en ont pas
      var avecGarde = 0, sansGarde = 0, attaquesAvec = 0, attaquesSans = 0;
      for (var k2 = 0; k2 < N; k2++) {
        var membres = CV.composition('axe', trajet.id + ':' + k2);
        var g = CV.aGarde(membres);
        if (g) { avecGarde++; if (CV.subitAttaque(trajet, k2, true, true)) attaquesAvec++; }
        else { sansGarde++; if (CV.subitAttaque(trajet, k2, true, false)) attaquesSans++; }
      }
      A.gt(avecGarde, 100, 'des départs avec garde, dans cet échantillon');
      A.gt(sansGarde, 100, 'des départs sans garde, dans cet échantillon');
      A.ok((attaquesAvec / avecGarde) < (attaquesSans / sansGarde), 'moins d\'attaques réussies quand un vrai garde accompagne le convoi');

      // ── intégration réelle : MC.Economie.passageCaravane (le point d'entrée
      // câblé par server.js:avancerCaravanes — jamais un appel isolé à
      // subitAttaque en dehors du calcul du taux ci-dessus) ──
      var etat = Eco.creerEtat(11);
      var Lo = Eco.lieuDe(etat, { id: 'orig', biome: 'plaines', x: 0, z: 0 });
      var Ld = Eco.lieuDe(etat, { id: 'dest', biome: 'plaines', x: 300, z: 0 });
      Lo.stocks[I.WHEAT] = { stock: 500, ref: 64 };
      Ld.stocks[I.WHEAT] = { stock: 20, ref: 64 };
      var trajetSansGarde = { id: 'r:orig>dest', role: 'commerce' };   // jamais de garde (composition('commerce',…))
      var indexAttaque = null, indexPaisible = null;
      for (var idx = 0; idx < 500 && (indexAttaque === null || indexPaisible === null); idx++) {
        var membresC = CV.composition('commerce', trajetSansGarde.id + ':' + idx);
        A.notOk(CV.aGarde(membresC), 'une caravane "commerce" n\'a jamais de garde');
        if (indexAttaque === null && CV.subitAttaque(trajetSansGarde, idx, true, false)) indexAttaque = idx;
        if (indexPaisible === null && !CV.subitAttaque(trajetSansGarde, idx, true, false)) indexPaisible = idx;
      }
      A.ok(indexAttaque !== null && indexPaisible !== null, 'un index attaqué et un index épargné, trouvés dans l\'échantillon');

      var rPaisible = Eco.passageCaravane(etat, trajetSansGarde, indexPaisible, { origine: Lo, destination: Ld, danger: true });
      A.notOk(rPaisible.attaque, 'pas d\'attaque ici');
      A.gt(rPaisible.n, 0, 'cargaison transportée intacte');

      var stockLoAvant = Lo.stocks[I.WHEAT].stock, stockLdAvant = Ld.stocks[I.WHEAT].stock;
      // ce qu'un départ IDENTIQUE, sans attaque, aurait transporté (même
      // formule que passageCaravane, calculée directement, sans dépendre
      // d'un second tirage probabiliste — indexAttaque est déterministe,
      // mais son verdict à un seuil de 0,04 (paisible) n'est pas garanti)
      var stocksSnapshot = {}; Object.keys(Lo.stocks).forEach(function (id) { stocksSnapshot[id] = stockLoAvant; });
      var cargaisonSansAttaque = CV.cargaisonDe(trajetSansGarde, indexAttaque, stocksSnapshot);
      var nSansAttaque = Math.min(cargaisonSansAttaque.n, Math.max(0, stockLoAvant - 64));

      var rAttaque = Eco.passageCaravane(etat, trajetSansGarde, indexAttaque, { origine: Lo, destination: Ld, danger: true });
      A.ok(rAttaque.attaque, 'attaque relevée par passageCaravane, le vrai point d\'entrée');
      A.ok(rAttaque.n < nSansAttaque, 'la cargaison EFFECTIVEMENT livrée est réduite par l\'attaque, vs le même départ épargné');
      A.equal(Lo.stocks[I.WHEAT].stock, stockLoAvant - rAttaque.n, 'origine débitée exactement du transporté');
      A.equal(Ld.stocks[I.WHEAT].stock, stockLdAvant + rAttaque.n, 'destination créditée exactement du transporté');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
