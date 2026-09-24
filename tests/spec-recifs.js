/* spec-recifs.js — tests de SPEC-MER-010 et 011 : flore sous-marine et récifs. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, B = C.B, RF = MC.Recifs;

  describe('Specs — flore sous-marine et récifs', function () {
    it('SPEC-MER-010 : chaque espèce pousse selon la profondeur, la température et la lumière', function () {
      A.gt(RF.lumiereAuFond(2), RF.lumiereAuFond(20), 'la lumière s éteint en profondeur');
      A.ok(RF.especes(B).length >= 9, 'anémones, algues rouges et brunes, posidonies, gorgones, éponges, laminaires');
      function tirages(prof, t) {
        var vus = {};
        for (var i = 0; i < 400; i++) {
          var f = RF.floreEn(B, prof, t, i / 400, (i * 7 % 400) / 400);
          if (f) vus[f.id] = (vus[f.id] || 0) + 1;
        }
        return vus;
      }
      var chaudPeuProfond = tirages(4, 0.65), froid = tirages(8, 0.2), profond = tirages(40, 0.7);
      A.ok(chaudPeuProfond[B.POSIDONIE], 'des herbiers de posidonie en eau chaude peu profonde');
      A.ok(!froid[B.POSIDONIE], 'pas en eau froide');
      A.ok(froid[B.LAMINAIRE] && froid[B.ALGUE_BRUNE], 'laminaires et algues brunes en eau froide');
      A.ok(!chaudPeuProfond[B.LAMINAIRE], 'pas de laminaire en eau chaude');
      A.ok(!profond[B.POSIDONIE] && !profond[B.ALGUE_BRUNE], 'rien qui demande de la lumière au fond');
      A.ok(profond[B.EPONGE_JAUNE] || profond[B.GORGONE_POURPRE], 'éponges et gorgones dans l obscurité');
      var col = RF.floreEn(B, 10, 0.2, 0.2, 0.9);
      if (col && col.id === B.LAMINAIRE) A.ok(col.colonne && col.hauteur >= 2, 'la laminaire monte en colonne');
      [B.ANEMONE_ROSE, B.ALGUE_ROUGE, B.POSIDONIE, B.LAMINAIRE].forEach(function (id) {
        A.ok(C.BLOCKS[id] && C.BLOCKS[id].aquatique && C.BLOCKS[id].plant, C.BLOCKS[id].name + ' : une plante d eau');
      });
      A.ok(C.BLOCKS[B.EPONGE_ORANGE] && !C.BLOCKS[B.EPONGE_ORANGE].plant, 'une éponge est un bloc');
    });

    it('SPEC-MER-011 : récifs frangeants, barrières, atolls et lagons des mers chaudes', function () {
      var base = { prof: 3, t: 0.7, cote: 1, volcan: null, bruit: 0.2 };
      A.equal(RF.structureEn(0, 0, base).type, 'frangeant', 'au ras d une côte chaude');
      A.equal(RF.structureEn(0, 0, Object.assign({}, base, { t: 0.3 })), null, 'jamais en eau froide');
      var large = Object.assign({}, base, { prof: 8, cote: 0.35, bruit: 0.5 });
      A.equal(RF.structureEn(0, 0, large).type, 'barriere', 'une barrière au large');
      A.equal(RF.structureEn(0, 0, Object.assign({}, large, { bruit: 0.9 })), null, 'une ligne, pas une nappe');
      var ile = { x: 0, z: 0, R: 40, actif: false };
      A.equal(RF.structureEn(56, 0, Object.assign({}, base, { prof: 6, cote: 0, volcan: ile })).type, 'atoll', 'un anneau autour de l île éteinte');
      A.equal(RF.structureEn(44, 0, Object.assign({}, base, { prof: 6, cote: 0, volcan: ile })).type, 'lagon', 'et son lagon');
      A.equal(RF.structureEn(56, 0, Object.assign({}, base, { prof: 6, cote: 0, volcan: { x: 0, z: 0, R: 40, actif: true } })), null,
              'pas autour d un volcan actif');
      // sur un vrai monde : des récifs de corail dans une mer chaude
      var w = MC.createWorld(20260921), trouve = null;
      for (var r = 0; r < 6000 && !trouve; r += 64) for (var a = 0; a < 24 && !trouve; a++) {
        var x = Math.round(Math.cos(a / 24 * 6.2832) * r), z = Math.round(Math.sin(a / 24 * 6.2832) * r);
        var e = w.bio.echantillon(x, z);
        if (e.biome.marin && e.eau - e.h >= 1 && e.eau - e.h <= 4 && w.bio.climat(x, z).t > 0.65) trouve = [x, z];
      }
      A.ok(trouve, 'une côte chaude peu profonde');
      var ch = w.getChunk(Math.floor(trouve[0] / C.CHUNK_X), Math.floor(trouve[1] / C.CHUNK_Z), true), coraux = 0, flore = 0;
      for (var k = 0; k < ch.blocks.length; k++) {
        var b = ch.blocks[k];
        if (b === B.CORAIL_BLANC || b === B.CORAL_RED || b === B.CORAL_YELLOW || b === B.CORAL_BLUE) coraux++;
        if (C.BLOCKS[b] && C.BLOCKS[b].aquatique) flore++;
      }
      A.gt(coraux + flore, 0, 'récif ou flore marine autour : ' + coraux + ' coraux, ' + flore + ' plantes');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
