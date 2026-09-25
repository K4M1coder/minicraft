/* spec-metiers.js — SPEC-METIER-001 à 005 : métiers villageois (src/metiers.js,
   et leur mise en œuvre par src/economie.js). */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var Met = MC.Metiers, Eco = MC.Economie;
  var C = MC.Core, I = C.I, B = C.B;

  function inv() { return MC.Inventory.create(); }

  describe('Specs — métiers', function () {
    it('SPEC-METIER-001 : stock de récolte — descend à la vente, jamais négatif, remonte avec la pousse (hiver : rien)', function () {
      var etat = Eco.creerEtat(1);
      var L = Eco.lieuDe(etat, { id: 'ferme1', biome: 'plaines', x: 0, z: 0 });
      var s = L.stocks[I.WHEAT] = { stock: 10, ref: 64 };
      Eco.acheter(etat, 'ferme1', I.WHEAT, 5);
      A.equal(s.stock, 5, 'descend à l\'achat côté joueur (stock du village diminue)');
      Eco.acheter(etat, 'ferme1', I.WHEAT, 999);
      A.equal(s.stock, 0, 'jamais négatif');
      Eco.tickJour(etat, 1, 'hiver');
      A.equal(s.stock, 0, 'rien ne pousse en hiver');
      Eco.tickJour(etat, 2, 'ete');
      A.gt(s.stock, 0, 'la pousse d\'été remonte le stock');
    });

    it('SPEC-METIER-002 : le forgeron consomme le minerai, refuse à sec avec message, reprend après réapprovisionnement', function () {
      A.equal(Met.mineraiRequis({ get: { id: I.IRON_SWORD, n: 1 } }), 2);
      A.equal(Met.mineraiRequis({ get: { id: I.DIAMOND_PICKAXE, n: 1 } }), 3);
      A.equal(Met.mineraiRequis({ get: { id: I.WHEAT, n: 1 } }), 0, 'pas de minerai pour un objet quelconque');

      // METIER-002 : le minerai est « alimenté par une mine à proximité »
      // (choix documenté dans economie.js, MINERAI_REF) — un stock initial à
      // la création du lieu, jamais écrit à la main ici : on l'épuise par de
      // VRAIS achats (le seul chemin de jeu réel), puis on vérifie le refus
      // à sec et la reprise après régénération (tickJour).
      var etat = Eco.creerEtat(2);
      var L = Eco.lieuDe(etat, { id: 'forge1', biome: 'plaines', x: 0, z: 0 });
      A.gt(L.minerai[I.IRON_INGOT], 0, 'un lieu est alimenté en minerai dès sa création (mine à proximité)');
      var i = inv();
      i.add(I.EMERALD, 500);
      var achats = 0;
      while (L.minerai[I.IRON_INGOT] >= 2 && achats < 100) {
        var ra = Eco.executerTroc(etat, i, { lieuId: 'forge1', role: 'forgeron', pnjId: 'forge1#0', indice: 1, fois: 1 });
        A.ok(ra.ok, 'achat ' + achats + ' : ' + JSON.stringify(ra));
        achats++;
      }
      A.ok(achats > 0 && achats < 100, 'le minerai a bien été épuisé par de vrais achats (' + achats + ')');
      var r1 = Eco.executerTroc(etat, i, { lieuId: 'forge1', role: 'forgeron', pnjId: 'forge1#0', indice: 1, fois: 1 });
      A.ok(!r1.ok && r1.motif === 'stock', 'refusé à sec : ' + JSON.stringify(r1));
      for (var jour = 1; jour <= 20; jour++) Eco.tickJour(etat, jour, 'ete');
      A.gt(L.minerai[I.IRON_INGOT], 0, 'la mine à proximité reconstitue le stock avec le temps');
      var r2 = Eco.executerTroc(etat, i, { lieuId: 'forge1', role: 'forgeron', pnjId: 'forge1#0', indice: 1, fois: 1 });
      A.ok(r2.ok, 'réussit une fois réapprovisionné : ' + JSON.stringify(r2));
    });

    it('SPEC-METIER-003 : offres à 14 ≠ 15 échanges ; 40 = 100 échanges', function () {
      A.deep(Met.offresActives('fermier', 14), [], 'sous le seuil : rien');
      A.gt(Met.offresActives('fermier', 15).length, 0, 'au seuil : l\'offre bonus apparaît');
      A.deep(Met.offresActives('fermier', 40), Met.offresActives('fermier', 100), 'plafonné à 40');
      A.deep(Met.offresActives('habitant', 100), [], 'un métier sans offre bonus n\'en a jamais');
    });

    it('SPEC-METIER-004 : statut absent avant 20 ventes, présent après ; remise mesurée sur le prix courant', function () {
      A.equal(Met.remise({ collecte: { fermier: 19 } }, 'fermier'), 0, 'pas encore de statut');
      A.equal(Met.remise({ collecte: { fermier: 20 } }, 'fermier'), Met.REMISE, 'statut atteint');

      var etat = Eco.creerEtat(3);
      Eco.lieuDe(etat, { id: 'ferme2', biome: 'plaines', x: 0, z: 0 });
      var i = inv();
      for (var k = 0; k < 20; k++) i.add(I.WHEAT, 8);
      // 20 ventes de blé (indice 0 de l'offre fermier : WHEAT contre émeraude)
      for (var v = 0; v < 20; v++) {
        var r = Eco.executerTroc(etat, i, { lieuId: 'ferme2', role: 'fermier', pnjId: 'ferme2#0', indice: 0, fois: 1, nom: 'Alice' });
        A.ok(r.ok, 'vente ' + v + ' : ' + JSON.stringify(r));
      }
      var offresAvant = Eco.offresDe(etat, 'ferme2', 'fermier', 'ferme2#0', 'Bob');
      var offresApres = Eco.offresDe(etat, 'ferme2', 'fermier', 'ferme2#0', 'Alice');
      A.lt(offresApres[0].prix, offresAvant[0].prix, 'la remise abaisse le prix courant pour Alice');

      // metierDeCollecte : la vente de blé fait progresser le fermier, rien d'autre
      A.equal(Met.metierDeCollecte({ give: [{ id: I.WHEAT, n: 8 }], get: { id: I.EMERALD, n: 1 } }), 'fermier');
      A.equal(Met.metierDeCollecte({ give: [{ id: I.IRON_INGOT, n: 4 }], get: { id: I.EMERALD, n: 1 } }), 'forgeron');
      A.equal(Met.metierDeCollecte({ give: [{ id: I.EMERALD, n: 1 }], get: { id: I.BREAD, n: 4 } }), null, 'un achat ne collecte rien');
    });

    it('SPEC-ENV-003 : l\'offre agricole (nourriture, METIER-001) diminue en hiver sous la référence estivale, restaurée à un cycle de printemps', function () {
      A.ok(Met.estRessourceAgricole(I.WHEAT), 'le blé (fermier) est une ressource agricole');
      A.ok(!Met.estRessourceAgricole(I.IRON_INGOT), 'le minerai (forgeron) n\'est pas agricole');
      A.ok(!Met.estRessourceAgricole(B.LOG), 'le bois (menuisier) n\'est pas agricole');

      var etat = Eco.creerEtat(6);
      var L = Eco.lieuDe(etat, { id: 'ferme3', biome: 'plaines', x: 0, z: 0 });
      var s = L.stocks[I.WHEAT] = { stock: 64, ref: 64 };
      var refEte = s.stock;
      for (var j = 1; j <= 10; j++) Eco.tickJour(etat, j, 'hiver');
      A.lt(s.stock, refEte, 'l\'offre hivernale descend sous la référence estivale (même graine)');
      var stockHiver = s.stock;
      for (var k = 11; k <= 40; k++) Eco.tickJour(etat, k, 'printemps');
      A.gt(s.stock, stockHiver, 'un cycle de printemps restaure l\'offre au-delà du creux hivernal');
    });

    it('SPEC-METIER-005 : surplus réel transféré au lieu en pénurie par une caravane ; rien sans surplus', function () {
      var etat = Eco.creerEtat(4);
      var Lo = Eco.lieuDe(etat, { id: 'a', biome: 'plaines', x: 0, z: 0 });
      var Ld = Eco.lieuDe(etat, { id: 'b', biome: 'plaines', x: 100, z: 0 });
      Lo.stocks[I.WHEAT] = { stock: 100, ref: 64 };
      Ld.stocks[I.WHEAT] = { stock: 10, ref: 64 };
      var trajet = { id: 'r:a>b' };
      var r = MC.Economie.passageCaravane(etat, trajet, 1, { origine: Lo, destination: Ld });
      A.gt(r.n, 0, 'du surplus a été transporté : ' + JSON.stringify(r));
      A.lt(Lo.stocks[I.WHEAT].stock, 100, 'le stock d\'origine diminue');
      var rejoue = MC.Economie.passageCaravane(etat, trajet, 1, { origine: Lo, destination: Ld });
      A.equal(rejoue.n || 0, 0, 'un départ déjà traité ne rejoue pas');

      var etat2 = Eco.creerEtat(5);
      var Lo2 = Eco.lieuDe(etat2, { id: 'c', biome: 'plaines', x: 0, z: 0 });
      var Ld2 = Eco.lieuDe(etat2, { id: 'd', biome: 'plaines', x: 100, z: 0 });
      Lo2.stocks[I.WHEAT] = { stock: 5, ref: 64 };   // pas de surplus (sous la référence)
      var r2 = MC.Economie.passageCaravane(etat2, { id: 'r:c>d' }, 1, { origine: Lo2, destination: Ld2 });
      A.equal(r2.n || 0, 0, 'rien sans surplus');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
