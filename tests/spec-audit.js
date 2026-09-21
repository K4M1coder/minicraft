/* spec-audit.js — tests des specs SPEC-AUDIT-*, issues d'une relecture ciblée
   sur les fuites de ressources et les registres désynchronisés. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core;
  var B = C.B;

  describe('Specs — correctifs d\'audit', function () {

    /* Le bug : game.js vidait overrides, crops et chunks au demarrage d'une
       nouvelle partie, mais PAS lights. Les anciennes torches continuaient
       d'eclairer le nouveau terrain a leurs anciennes coordonnees. La parade
       est de regrouper la remise a zero dans le monde lui-meme, a un seul
       endroit, plutot que de la disperser dans l'orchestrateur. */
    it('SPEC-AUDIT-001 : reinitialiser le monde vide TOUS les registres', function () {
      var w = MC.createWorld(42);
      w.getChunk(0, 0, true);
      var gy = w.groundAt(8, 8, true);
      w.setBlock(8, gy, 8, B.FARMLAND);
      w.setBlock(8, gy + 1, 8, B.WHEAT0);       // remplit crops
      w.setBlock(9, gy + 1, 8, B.TORCH);        // remplit lights
      w.setBlock(10, gy + 1, 8, B.BRICK);       // remplit overrides

      A.ok(w.crops.size > 0, 'cultures enregistrees avant');
      A.ok(w.lights.size > 0, 'lumieres enregistrees avant');
      A.ok(w.overrides.size > 0, 'modifications enregistrees avant');
      A.ok(w.chunks.size > 0, 'chunks charges avant');

      var libere = [];
      w.reset(function (c) { libere.push(c.cx + ',' + c.cz); });

      A.equal(w.crops.size, 0, 'cultures videes');
      A.equal(w.lights.size, 0, 'lumieres videes — plus de torche fantome');
      A.equal(w.overrides.size, 0, 'modifications videes');
      A.equal(w.chunks.size, 0, 'chunks vides');
      A.ok(libere.length > 0, 'chaque chunk a ete signale pour liberation');
    });

    it('SPEC-AUDIT-001 : apres reinitialisation, le terrain est celui de la graine', function () {
      var w = MC.createWorld(42);
      w.getChunk(0, 0, true);
      var gy = w.groundAt(5, 5, true);
      w.setBlock(5, gy + 1, 5, B.BRICK);
      w.reset();
      w.getChunk(0, 0, true);
      A.equal(w.getBlock(5, gy + 1, 5), 0, 'la brique posee avant ne revient pas');
      var vierge = MC.createWorld(42);
      vierge.getChunk(0, 0, true);
      A.equal(w.groundAt(5, 5, true), vierge.groundAt(5, 5, true),
        'terrain identique a un monde neuf de meme graine');
    });

    /* Un chunk decharge puis recharge doit retrouver les modifications du
       joueur : c'est `overrides` qui porte cette memoire, et c'est pourquoi
       il ne faut SURTOUT PAS le purger au dechargement. */
    it('SPEC-AUDIT-004 : les constructions survivent au dechargement du chunk', function () {
      var w = MC.createWorld(7);
      w.getChunk(0, 0, true);
      var gy = w.groundAt(3, 3, true);
      for (var i = 0; i < 6; i++) w.setBlock(3, gy + 1 + i, 3, B.BRICK);
      var overridesAvant = w.overrides.size;

      // on s'eloigne assez pour que le chunk se decharge
      w.unloadFar(999, 999, 2, function () {});
      A.equal(w.chunks.size, 0, 'chunk decharge');
      A.equal(w.overrides.size, overridesAvant,
        'les modifications ne sont PAS purgees : elles sont la sauvegarde');

      w.getChunk(0, 0, true);                     // retour sur zone
      for (var j = 0; j < 6; j++) {
        A.equal(w.getBlock(3, gy + 1 + j, 3), B.BRICK, 'brique ' + j + ' retrouvee');
      }
    });

    it('SPEC-AUDIT-004 : torches et cultures survivent aussi au dechargement', function () {
      var w = MC.createWorld(7);
      w.getChunk(0, 0, true);
      var gy = w.groundAt(6, 6, true);
      w.setBlock(6, gy, 6, B.FARMLAND);
      w.setBlock(6, gy + 1, 6, B.WHEAT1);
      w.setBlock(7, gy + 1, 6, B.TORCH);
      w.unloadFar(999, 999, 2, function () {});
      w.getChunk(0, 0, true);
      A.equal(w.getBlock(6, gy + 1, 6), B.WHEAT1, 'culture retrouvee');
      A.equal(w.getBlock(7, gy + 1, 6), B.TORCH, 'torche retrouvee');
      A.ok(w.lights.size > 0, 'la torche eclaire toujours');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
