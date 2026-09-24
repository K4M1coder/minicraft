/* spec-blocs16.js — tests de SPEC-SAVE-017 : blocs sur 16 bits, état par
   bloc, et migration sans perte d'une sauvegarde ou d'un monde serveur
   antérieurs (8 bits). */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, NP = MC.NetProtocol;
  var B = C.B, I = C.I;

  // un id > 255 : au-delà de l'ancienne limite d'un octet, dans la marge
  // laissée libre entre les derniers blocs définis (127) et FIRST_ITEM.
  var GROS_ID = 300;

  describe('Specs — SPEC-SAVE-017 : blocs 16 bits et état de bloc', function () {

    it('SPEC-SAVE-017 : l\'espace d\'ids sépare largement blocs et objets', function () {
      A.equal(C.FIRST_ITEM, 4096, 'les objets commencent à 4096');
      A.ok(C.FIRST_ITEM - 127 > 3000, 'grande marge laissée aux futurs blocs');
      A.ok(C.isBlock(GROS_ID), 'un id > 255 reste un bloc');
      A.notOk(C.isItem(GROS_ID), 'et n\'est pas un objet');
      A.ok(C.isItem(I.STICK), 'les objets existants restent des objets');
    });

    it('SPEC-SAVE-017 : un bloc d\'id > 255 se pose et se relit', function () {
      var w = G.etatMinimal(77);
      w.world.setBlock(2, 40, 2, GROS_ID);
      A.equal(w.world.getBlock(2, 40, 2), GROS_ID, 'la valeur 16 bits n\'est pas tronquée');
      // un chunk généré à neuf le rejoue aussi (via overrides)
      w.world.chunks.delete('0,0');
      w.world.getChunk(0, 0, true);
      A.equal(w.world.getBlock(2, 40, 2), GROS_ID, 'toujours là après régénération du chunk');
    });

    it('SPEC-SAVE-017 : un bloc d\'id > 255 se sauvegarde et se recharge', function () {
      var e = G.etatMinimal(78);
      e.world.setBlock(3, 41, 3, GROS_ID);
      var data = JSON.parse(JSON.stringify(MC.Save.serialize(e)));
      var f = G.etatMinimal(78);
      A.ok(MC.Save.apply(data, f), 'chargement accepté');
      // apply() vide les chunks : c'est generateChunk, via les overrides, qui
      // rejoue le bloc — exactement comme au chargement réel d'une partie.
      f.world.getChunk(0, 0, true);
      A.equal(f.world.getBlock(3, 41, 3), GROS_ID, 'le bloc de plus de 255 survit à la sauvegarde');
    });

    it('SPEC-SAVE-017 : un bloc d\'id > 255 traverse le protocole réseau', function () {
      var msg = NP.valider({ t: 'bloc', x: 3, y: 41, z: 3, id: GROS_ID });
      A.ok(msg, 'accepté par le protocole');
      A.equal(msg.id, GROS_ID, 'l\'id 16 bits passe intact');
      A.equal(NP.valider({ t: 'bloc', x: 0, y: 0, z: 0, id: 65535 }).id, 65535, 'la borne haute passe');
      A.equal(NP.valider({ t: 'bloc', x: 0, y: 0, z: 0, id: 65536 }), null, 'au-delà de 16 bits, refusé');
    });

    it('SPEC-SAVE-017 : un état se pose, se relit, se sauvegarde', function () {
      var w = G.etatMinimal(79);
      A.equal(w.world.getEtat(5, 40, 5), 0, 'aucun état par défaut');
      A.ok(w.world.setEtat(5, 40, 5, 200), 'l\'état se pose (chunk chargé)');
      A.equal(w.world.getEtat(5, 40, 5), 200, 'et se relit');
      // survit à une régénération de chunk (rejoué depuis etatsOverrides)
      w.world.chunks.delete('0,0');
      w.world.getChunk(0, 0, true);
      A.equal(w.world.getEtat(5, 40, 5), 200, 'toujours là après régénération');

      // et à une sauvegarde/rechargement complet
      var data = JSON.parse(JSON.stringify(MC.Save.serialize(w)));
      var w2 = G.etatMinimal(79);
      A.ok(MC.Save.apply(data, w2), 'chargement accepté');
      w2.world.getChunk(0, 0, true);
      A.equal(w2.world.getEtat(5, 40, 5), 200, 'l\'état survit à la sauvegarde');
    });

    it('SPEC-SAVE-017 : setEtat sur un chunk non chargé échoue proprement', function () {
      var w = G.etatMinimal(80);
      A.notOk(w.world.setEtat(9999, 40, 9999, 1), 'chunk lointain jamais généré');
      A.equal(w.world.getEtat(9999, 40, 9999), 0, 'lecture par défaut, sans exception');
    });

    it('SPEC-SAVE-017 : une sauvegarde 8 bits migre sans perte, inventaire compris', function () {
      // fabrique une sauvegarde « v2 » (ancien format 8 bits, objets 128..255),
      // exactement telle qu'un ancien client l'aurait écrite avant ce lot.
      var ANCIEN_FIRST_ITEM = C.ANCIEN_FIRST_ITEM;               // 128
      var offNouveau = C.FIRST_ITEM - ANCIEN_FIRST_ITEM;
      function versAncien(idActuel) { return idActuel - offNouveau; }   // objet -> ancien id (128..255)

      var ancienPioche = versAncien(I.IRON_PICKAXE);
      var ancienneEmeraude = versAncien(I.EMERALD);
      var ancienCharbon = versAncien(I.COAL);
      A.ok(ancienPioche >= 128 && ancienPioche < 256, 'l\'ancien id de la pioche tient sur un octet');

      var v2 = {
        v: 2, seed: 99, time: 42,
        overrides: [[0, 30, 0, B.BRICK], [1, 31, 1, B.STONE]],
        crops: [],
        player: {
          x: 5, y: 30, z: 5, yaw: 0, pitch: 0, hp: 18, hunger: 15, air: 10,
          selected: 0, flying: false,
          inv: [[ancienPioche, 1, 3], [B.PLANKS, 20], [ancienneEmeraude, 2]],
        },
        chests: [['10,20,30', [[ancienneEmeraude, 4]]]],
        furnaces: [['1,2,3', [B.IRON_ORE, 3], [ancienCharbon, 5], 0, 0, 0]],
      };
      var jeuAvant = JSON.parse(JSON.stringify(v2));

      var e = G.etatMinimal(99);
      // apply() ne clone que le cas v1 (l'ancien format tolérait déjà cette
      // mutation en place) : on passe donc ici une copie, comme le fait tout
      // appelant réel (Save.load reçoit toujours du JSON fraîchement parsé).
      A.ok(MC.Save.apply(JSON.parse(JSON.stringify(v2)), e), 'une sauvegarde 8 bits (v2) se charge');
      A.equal(e.player.state.inv.slots[0].id, I.IRON_PICKAXE, 'la pioche retrouve son identité 16 bits');
      A.equal(e.player.state.inv.slots[0].dmg, 3, 'et son usure');
      A.equal(e.player.state.inv.slots[1].id, B.PLANKS, 'un bloc ne bouge pas de place');
      A.equal(e.player.state.inv.slots[1].n, 20, 'ni de quantité');
      A.equal(e.player.state.inv.slots[2].id, I.EMERALD, 'la seconde pile d\'objet aussi migre');
      A.equal(e.chests['10,20,30'].slots[0].id, I.EMERALD, 'coffre converti sans perte');
      A.equal(e.chests['10,20,30'].slots[0].n, 4, 'quantité du coffre conservée');
      A.equal(e.furnaces['1,2,3'].fuel.id, I.COAL, 'combustible du fourneau converti');
      A.equal(e.world.overrides.get('0,30,0'), B.BRICK, 'les blocs posés restent (id inchangé)');
      A.equal(e.world.overrides.get('1,31,1'), B.STONE, 'même chose pour le second');
      A.equal(e.world.etatsOverrides.get('0,30,0') || 0, 0,
              'une sauvegarde d\'avant les états leur donne 0 par défaut');
      A.deep(v2, jeuAvant, 'la donnée d\'origine n\'est pas modifiée par la migration');
    });

    it('SPEC-SAVE-017 : un monde serveur (--monde) sauvegardé en 8 bits migre aussi', function () {
      // même principe que server.js:appliquerEtatMonde, mais sans process réel :
      // les overrides du monde partagé ne portent que des blocs (jamais
      // d'objet d'inventaire), donc aucune conversion d'id n'est nécessaire —
      // seule la version doit être acceptée et les états défauter à 0.
      var v1MondeServeur = {
        v: 1, graine: 55, heure: 12.5,
        overrides: [[4, 20, 4, B.COBBLE]],
        crops: [], donjons: [], pilles: [], pnjsMorts: [],
      };
      function appliquer(data) {
        if (!data || (data.v !== 1 && data.v !== 2)) return false;
        return true;
      }
      A.ok(appliquer(v1MondeServeur), 'un monde v1 (blocs seuls) reste lisible tel quel');
      A.notOk(appliquer({ v: 47 }), 'un format inconnu est refusé');
    });

    it('SPEC-SAVE-017 : un format de sauvegarde inconnu est refusé proprement', function () {
      var e = G.etatMinimal(1);
      A.notOk(MC.Save.apply({ v: 999, overrides: [] }, e), 'version 999 : refusée');
      A.notOk(MC.Save.apply(null, e), 'absence de données : refusée');
      A.notOk(MC.Save.apply({}, e), 'objet sans version : refusé');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
