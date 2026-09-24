/* spec-conteneurs.js — B1 : inventaire et conteneurs serveur (docs/vague-2/B1.md,
   SPEC-SYNC-007 à 017). Module pur `src/conteneurs.js` (MC.Conteneurs), partagé
   par le solo, la prédiction client et le serveur. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var K = MC.ContratsV2;
  var I = MC.Core.I, B = MC.Core.B;

  describe('Conteneurs — raccordement au protocole (B1, étape 1)', {
    teste: 'NP.valider délègue les nouveaux types de message (vague 2) à MC.ContratsV2, et MANGER passe par validerManger.',
    pourquoi: 'B2 (TROC) et B4 (PVP) dépendent de ce raccordement fait par B1 ; sans lui aucun nouveau message n\'atteindrait jamais la logique de jeu.',
    attendu: 'un CRAFT valide est accepté et normalisé ; un CRAFT malformé (fois hors bornes) est refusé ; MANGER accepte toujours la forme historique.',
  }, function () {
    it('SPEC-SYNC-010 : NP.valider accepte un CRAFT valide et refuse un CRAFT malformé', function () {
      var NP = MC.NetProtocol;
      A.equal(NP.MSG.CRAFT, 'craft', 'le type CRAFT est fusionné dans NP.MSG');
      var ok = NP.valider({ t: 'craft', j: 0, seq: 1, fois: 2 });
      A.ok(ok, 'un CRAFT bien formé est accepté');
      A.equal(ok.fois, 2);
      A.equal(NP.valider({ t: 'craft', j: 0, seq: 1, fois: 0 }), null, 'fois hors bornes refusé');
      A.equal(NP.valider({ t: 'craft', j: 0, fois: 1 }), null, 'seq manquant refusé');
    });

    it('SPEC-SYNC-009 : MANGER reste accepté sous sa forme historique et sous sa forme étendue', function () {
      var NP = MC.NetProtocol;
      var m1 = NP.valider({ t: 'manger', id: I.BREAD, j: 0 });
      A.ok(m1, 'forme historique acceptée');
      var m2 = NP.valider({ t: 'manger', id: I.BREAD, j: 0, i: 3, seq: 5 });
      A.ok(m2, 'forme étendue (i, seq) acceptée');
      A.equal(m2.i, 3); A.equal(m2.seq, 5);
      A.equal(NP.valider({ t: 'manger', j: 0 }), null, 'id manquant refusé');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
