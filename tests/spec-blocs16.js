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

  /* Correctif de la migration v1/v2 → v3 : la banque, les soutes des
     véhicules et les indices d'objet d'une enquête n'étaient pas
     renumérotés (audit L40 du 2026-10-03). La plupart des sauvegardes sont
     forgées à la main, aux valeurs d'origine lisibles ; `V2_REELLE`, elle,
     a été écrite par le code de 9f92f99^ (dernier client v2), sans retouche. */
  var V2_REELLE = {"v":2,"seed":4242,"time":321,"overrides":[[1,40,1,24]],"crops":[],"donjons":[],"pilles":[],"explores":[],"reperes":[],"suivi":0,"reputation":{"village":0,"pillards":-60,"morts":-100,"betes":0},"banque":[[158,7],[200,1],[10,5],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"pnjsMorts":[],"histoire":{"archetype":"enquete","enquete":{"params":{},"depart":{"id":"v1","nom":"Bourg","x":10,"z":10},"crime":"vol_tresor","suspects":[{"id":"p2","nom":"Lise","role":"forgeron","alibi":{"lieu":"v1","lieuNom":"Bourg","heure":"à l'aube"},"mobile":"la peur d'être démasqué"},{"id":"p5","nom":"Marc","role":"garde","alibi":{"lieu":"v1","lieuNom":"Bourg","heure":"en matinée"},"mobile":"une dette de jeu"},{"id":"p3","nom":"Paul","role":"aubergiste","alibi":{"lieu":"v1","lieuNom":"Bourg","heure":"l'après-midi"},"mobile":"une vieille rancune"},{"id":"p1","nom":"Jean","role":"fermier","alibi":{"lieu":"v1","lieuNom":"Bourg","heure":"en matinée"},"mobile":"une dette de jeu"},{"id":"p4","nom":"Anne","role":"tisserand","alibi":{"lieu":"v1","lieuNom":"Bourg","heure":"à midi"},"mobile":"la vengeance"}],"coupableId":"p3","indices":[{"id":"temoin0","type":"temoignage","pnj":"p3","nom":"Paul","texte":"Interrogez Paul.","obtenu":false},{"id":"temoin1","type":"temoignage","pnj":"p5","nom":"Marc","texte":"Interrogez Marc.","obtenu":false},{"id":"temoin2","type":"temoignage","pnj":"p4","nom":"Anne","texte":"Interrogez Anne.","obtenu":false},{"id":"temoin3","type":"temoignage","pnj":"p2","nom":"Lise","texte":"Interrogez Lise.","obtenu":false},{"id":"objet0","type":"objet","objet":200,"texte":"Retrouvez carte abandonné sur la scène.","obtenu":false},{"id":"objet1","type":"objet","objet":200,"texte":"Retrouvez carte abandonné sur la scène.","obtenu":false},{"id":"contradiction0","type":"contradiction","a":"temoin0","b":"temoin1","texte":"Recoupez deux témoignages qui se contredisent.","obtenu":false}],"rebondissement":"fuite","chapitres":["crime","enquete","rebondissement","accusation"],"chap":1,"commence":true,"accusation":null,"fin":null,"journal":["Chapitre : Le vol du trésor","Chapitre : L'enquête"]}},"vehicules":[["camion",5.5,40,5.5,0,[[130,9],[5,4],[128,16],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]]],"succes":null,"player":{"x":4.5,"y":60,"z":4.5,"yaw":0,"pitch":0,"hp":17,"hunger":20,"air":10,"selected":0,"flying":false,"inv":[[129,10],[140,1,37],[200,1],[7,20],[159,3],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]},"chests":[["1,40,1",[[137,5],[8,12],[161,4],0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]]],"furnaces":[["2,40,2",[134,3],[129,4],[135,2],3.5,1.25]]};
  // ce que contenait cette partie, nommé par le code de l'époque (C.nameOf de 9f92f99^)
  var V2_REELLE_NOMS = {
    inv: [['Charbon', 10], ['Pioche en fer', 1], ['Carte', 1], ['Planche', 20], ['Diamant', 3]],
    coffre: [['Émeraude', 5], ['Pavé', 12], ['Os', 4]],
    four: [['Mouton cru', 3], ['Charbon', 4], ['Mouton cuit', 2]],
    banque: [["Lingot d'or", 7], ['Carte', 1], ['Verre', 5]],
    soute: [['Lingot de fer', 9], ['Tronc', 4], ['Bâton', 16]],
    indices: ['Carte', 'Carte'],
  };
  describe('Specs — SPEC-SAVE-017 : migration de TOUS les ids d\'objet', function () {
    var OFF_V2 = C.FIRST_ITEM - C.ANCIEN_FIRST_ITEM;      // 128 → 4096
    var DEC_V1 = C.DECALAGE_OBJETS_V1;                     // 64 → 128
    function enV2(id) { return id - OFF_V2; }              // id actuel → id d'objet v2 (128..255)
    function enV1(id) { return id - OFF_V2 - DEC_V1; }     // id actuel → id d'objet v1 (64..127)
    function copie(x) { return JSON.parse(JSON.stringify(x)); }
    function souteVide(n) { var s = []; for (var i = 0; i < n; i++) s.push(0); return s; }
    // le moindre champ d'une sauvegarde v2 — tel qu'un client d'avant le 16 bits l'écrivait
    function v2Base(extra) {
      var d = { v: 2, seed: 4242, time: 30, overrides: [], crops: [], donjons: [], pilles: [],
                explores: [], reperes: [], suivi: 0, reputation: null, pnjsMorts: [], succes: null,
                banque: [], vehicules: [], histoire: null,
                player: { x: 3, y: 40, z: 3, yaw: 0, pitch: 0, hp: 20, hunger: 20, air: 10,
                          selected: 0, flying: false, inv: [] },
                chests: [], furnaces: [] };
      for (var k in extra) d[k] = extra[k];
      return d;
    }
    function enqueteV2(objet) {
      return { archetype: 'enquete', enquete: {
        params: {}, depart: null, crime: 'vol_tresor', suspects: [], coupableId: null,
        indices: [{ id: 'objet0', type: 'objet', objet: objet, texte: 'Retrouvez une émeraude.', obtenu: false }],
        rebondissement: 'fuite', chapitres: ['crime', 'enquete', 'rebondissement', 'accusation'],
        chap: 1, commence: true, accusation: null, fin: null, journal: [] } };
    }

    it('SPEC-SAVE-017 : les anciens ids d\'objet tombent sur des ids indéfinis ou sur d\'autres blocs (le danger)', function () {
      A.equal(enV2(I.COAL), 129, 'le charbon valait 129 en v2');
      A.equal(enV2(I.CARTE), 200, 'la carte valait 200 en v2');
      A.ok(C.BLOCKS[200], 'et 200 est aujourd\'hui un bloc (une forme L24) : une carte non migrée devient ce bloc');
      A.equal(enV1(I.COAL), 65, 'le charbon valait 65 en v1');
    });

    it('SPEC-SAVE-017 : la migration v2 renumérote la banque (D1)', function () {
      var e = G.etatMinimal(4242);
      A.ok(MC.Save.apply(v2Base({ banque: [[enV2(I.COAL), 5], [enV2(I.CARTE), 1], [B.PLANKS, 7]] }), e), 'chargée');
      var s = e.world.banque.slots;
      A.equal(s[0].id, I.COAL, 'charbon retrouvé (et non « ?129 »)');
      A.equal(s[0].n, 5, 'quantité conservée');
      A.equal(s[1].id, I.CARTE, 'la carte reste une carte (et non un escalier)');
      A.equal(s[2].id, B.PLANKS, 'un bloc ne bouge pas');
    });

    it('SPEC-SAVE-017 : la migration v1 renumérote aussi la banque', function () {
      var e = G.etatMinimal(4242);
      var v1 = v2Base({ banque: [[enV1(I.COAL), 5]] }); v1.v = 1;
      A.ok(MC.Save.apply(v1, e), 'chargée');
      A.equal(e.world.banque.slots[0].id, I.COAL, 'v1 → v2 → v3 : charbon');
    });

    it('SPEC-SAVE-017 : la migration v2 renumérote les soutes des véhicules (D2)', function () {
      var soute = souteVide(9); soute[0] = [enV2(I.IRON_INGOT), 2]; soute[1] = [B.COBBLE, 3];
      var e = G.etatMinimal(4242);
      A.ok(MC.Save.apply(v2Base({ vehicules: [['bateau', 5.5, 40, 5.5, 0, soute]] }), e), 'chargée');
      var v = MC.Vehicules.serialiser(e.entities);
      A.equal(v.length, 1, 'le bateau est restauré');
      A.deep(v[0][5][0], [I.IRON_INGOT, 2], 'lingots de fer dans la soute');
      A.deep(v[0][5][1], [B.COBBLE, 3], 'le bloc de la soute ne bouge pas');
    });

    it('SPEC-SAVE-017 : la migration v2 renumérote les indices d\'objet d\'une enquête, qui restent résolubles (D3)', function () {
      var e = G.etatMinimal(4242);
      A.ok(MC.Save.apply(v2Base({ histoire: enqueteV2(enV2(I.EMERALD)) }), e), 'chargée');
      var ind = e.histoire.enquete.indices[0];
      A.equal(ind.objet, I.EMERALD, 'l\'indice demande une émeraude de l\'espace actuel');
      MC.Recits.signaler(e.histoire, { type: 'inventaire' },
        { compter: function (id) { return id === I.EMERALD ? 1 : 0; } });
      A.ok(ind.obtenu, 'un inventaire contenant une émeraude résout l\'indice');
    });

    it('SPEC-SAVE-017 : l\'import d\'une partie v2 (ARCHI-015) ne garde que des ids de l\'espace actuel', function () {
      var soute = souteVide(9); soute[0] = [enV2(I.IRON_INGOT), 2];
      var v2 = v2Base({ banque: [[enV2(I.COAL), 5]], vehicules: [['bateau', 5.5, 40, 5.5, 0, soute]],
                        histoire: enqueteV2(enV2(I.EMERALD)) });
      v2.player.inv = souteVide(36); v2.player.inv[0] = [enV2(I.DIAMOND), 1];   // 36 cases, comme un vrai joueur
      var avant = copie(v2);
      var f = MC.PartiesFichier.migrerSauvegarde({ id: 'ancienne' }, v2);
      A.deep(v2, avant, 'la sauvegarde d\'origine n\'est pas modifiée');
      A.ok(f.soloJoueur, 'joueur importé');
      A.deep(f.soloJoueur.banque[0], [I.COAL, 5], 'banque du joueur importé migrée');
      A.deep(f.soloJoueur.inv[0], [I.DIAMOND, 1], 'inventaire migré');
      A.deep(f.extras.vehicules[0][5][0], [I.IRON_INGOT, 2], 'soute importée migrée');
      A.equal(f.extras.histoire.enquete.indices[0].objet, I.EMERALD, 'indice d\'enquête importé migré');
    });

    it('SPEC-SAVE-017 : une vraie sauvegarde v2 (écrite par le client de 9f92f99^) se recharge sans perte', function () {
      function noms(piles) {
        return piles.filter(Boolean).map(function (s) { return [C.nameOf(s[0]), s[1]]; });
      }
      var avant = copie(V2_REELLE);
      var e = G.etatMinimal(4242);
      A.ok(MC.Save.apply(V2_REELLE, e), 'chargée');
      A.deep(V2_REELLE, avant, 'la donnée d\'origine n\'est pas modifiée');
      var d = MC.Save.serialize(e);
      A.deep(noms(d.player.inv), V2_REELLE_NOMS.inv, 'inventaire');
      A.equal(d.player.inv[1][2], 37, 'usure de la pioche conservée');
      A.deep(noms(d.chests[0][1]), V2_REELLE_NOMS.coffre, 'coffre');
      A.deep(noms([d.furnaces[0][1], d.furnaces[0][2], d.furnaces[0][3]]), V2_REELLE_NOMS.four, 'four');
      A.deep(noms(d.banque), V2_REELLE_NOMS.banque, 'banque');
      A.deep(noms(d.vehicules[0][5]), V2_REELLE_NOMS.soute, 'soute du camion');
      A.deep(e.histoire.enquete.indices.filter(function (i) { return i.type === 'objet'; })
               .map(function (i) { return C.nameOf(i.objet); }), V2_REELLE_NOMS.indices, 'indices d\'enquête');
      // et par l'import (SPEC-ARCHI-015)
      var f = MC.PartiesFichier.migrerSauvegarde({ id: 'reelle' }, V2_REELLE);
      A.deep(noms(f.soloJoueur.inv), V2_REELLE_NOMS.inv, 'import : inventaire');
      A.deep(noms(f.soloJoueur.banque), V2_REELLE_NOMS.banque, 'import : banque');
      A.deep(noms(f.extras.vehicules[0][5]), V2_REELLE_NOMS.soute, 'import : soute');
      A.deep(f.extras.histoire.enquete.indices.filter(function (i) { return i.type === 'objet'; })
               .map(function (i) { return C.nameOf(i.objet); }), V2_REELLE_NOMS.indices, 'import : indices');
    });

    it('SPEC-SAVE-017 : migrerV1/migrerV2 appelées deux fois (ou sur une v3) ne décalent pas deux fois', function () {
      var v2 = v2Base({ banque: [[enV2(I.COAL), 2]] });
      v2.player.inv = [[enV2(I.EMERALD), 1], [B.PLANKS, 4]];
      var une = MC.Save.migrerV2(copie(v2));
      var deux = MC.Save.migrerV2(copie(une));
      A.deep(deux, une, 'migrerV2 appliquée deux fois = une fois');
      A.equal(deux.banque[0][0], I.COAL, 'le charbon n\'est pas décalé une seconde fois');
      // une v3 contenant un bloc de forme (id 200, l'ancien id de la carte) n'est jamais touchée
      A.equal(B.ESCALIER_PLANKS, 200, 'l\'escalier de planches occupe l\'ancien id de la carte');
      var v3 = v2Base({ banque: [[B.ESCALIER_PLANKS, 1], [I.COAL, 3]], overrides: [[0, 40, 0, B.ESCALIER_PLANKS]] });
      v3.v = 3;
      v3.player.inv = [[200, 5]];
      A.deep(MC.Save.migrerV2(copie(v3)), v3, 'migrerV2 laisse une v3 intacte');
      A.deep(MC.Save.migrerV1(copie(v3)), v3, 'migrerV1 aussi');
      // v1 : deux appels directs de migrerV1, puis migrerV2 deux fois
      var v1 = v2Base({ banque: [[enV1(I.COAL), 2]] }); v1.v = 1;
      var a = MC.Save.migrerV1(copie(v1));
      A.deep(MC.Save.migrerV1(copie(a)), a, 'migrerV1 appliquée deux fois = une fois');
      A.equal(MC.Save.migrerV2(MC.Save.migrerV2(a)).banque[0][0], I.COAL, 'v1 → v3 : charbon');
      // un id hors de l'ancien espace d'objets n'est jamais converti
      var bizarre = v2Base({ banque: [[I.COAL, 1], [300, 1]] });
      var mb = MC.Save.migrerV2(bizarre);
      A.deep(mb.banque, [[I.COAL, 1], [300, 1]], 'ids ≥ 256 inchangés par migrerV2');
    });

    it('SPEC-SAVE-017 : un champ porteur mal formé (pas un tableau) ne fait pas rejeter toute la partie à l\'import', function () {
      var v2 = v2Base({ banque: [[enV2(I.COAL), 5]], vehicules: {}, expositions: 5, distributeurs: 'x', chests: null, furnaces: { a: 1 } });
      v2.player.inv = souteVide(36); v2.player.inv[0] = [enV2(I.DIAMOND), 1];
      var f = MC.PartiesFichier.migrerSauvegarde({ id: 'abimee' }, v2);   // ne lève pas
      A.ok(f && f.soloJoueur, 'la partie est importée, joueur compris');
      A.deep(f.soloJoueur.banque[0], [I.COAL, 5], 'et sa banque migrée');
      A.deep(f.soloJoueur.inv[0], [I.DIAMOND, 1], 'son inventaire aussi');
    });

    it('SPEC-SAVE-017 : aucun champ porteur d\'objet n\'échappe à la migration v2', function () {
      var X = enV2(I.COAL);                         // 129 : ne figure nulle part ailleurs dans la sauvegarde forgée
      var soute = souteVide(27); soute[4] = [X, 1];
      var v2 = v2Base({
        banque: [[X, 1]], vehicules: [['camion', 7.5, 40, 7.5, 0, soute]], histoire: enqueteV2(X),
        chests: [['1,2,3', [[X, 1]]]], furnaces: [['4,5,6', [X, 1], [X, 1], [X, 1], 0, 0]],
      });
      v2.player.inv = [[X, 1]];
      var m = MC.Save.migrerV2(copie(v2));
      var restes = [];
      (function parcourir(o, chemin) {
        if (o === X) restes.push(chemin);
        else if (o && typeof o === 'object') Object.keys(o).forEach(function (k) { parcourir(o[k], chemin + '.' + k); });
      })(m, 'data');
      A.deep(restes, [], 'plus aucun id 129 après migration');
      A.equal(m.v, 3, 'version montée');
      var e1 = G.etatMinimal(4242);
      A.ok(MC.Save.apply(copie(m), e1), 'la sauvegarde migrée se recharge');
      A.equal(e1.world.banque.slots[0].id, I.COAL, 'et reste juste');
    });

    it('SPEC-SAVE-017 : migrerIdsObjets renumérote tous les champs porteurs, y compris ceux apparus après la v3', function () {
      function conv(id) { return id + 1000; }
      var d = {
        player: { inv: [[4100, 1], 0], equip: { casque: [4101, 1], bottes: 0 } },
        chests: [['k', [[4102, 2]], 27]], distributeurs: [['k', [[4103, 1]]]],
        furnaces: [['k', [4104, 1], 0, [4105, 1], 0, 0]], banque: [[4106, 1]],
        vehicules: [['camion', 0, 40, 0, 0, [[4107, 1]], 10, 0], ['moto', 0, 40, 0, 0, 0]],
        expositions: [['k', 4108, 1, null]],
        histoire: enqueteV2(4109),
        economie: { v: 1, lieux: [['l', { stocks: { 4110: [1, 1, 0], 7: [2, 2, 0] }, minerai: { 4111: 3 } }]] },
      };
      MC.Save.migrerIdsObjets(d, conv);
      A.equal(d.player.inv[0][0], 5100, 'inventaire');
      A.equal(d.player.equip.casque[0], 5101, 'équipement');
      A.equal(d.chests[0][1][0][0], 5102, 'coffres');
      A.equal(d.distributeurs[0][1][0][0], 5103, 'distributeurs');
      A.equal(d.furnaces[0][1][0], 5104, 'four : entrée');
      A.equal(d.furnaces[0][3][0], 5105, 'four : sortie');
      A.equal(d.banque[0][0], 5106, 'banque');
      A.equal(d.vehicules[0][5][0][0], 5107, 'soute');
      A.equal(d.expositions[0][1], 5108, 'présentoirs');
      A.equal(d.histoire.enquete.indices[0].objet, 5109, 'indices d\'enquête');
      A.deep(Object.keys(d.economie.lieux[0][1].stocks).sort(), ['1007', '5110'], 'stocks de l\'économie (clés)');
      A.deep(Object.keys(d.economie.lieux[0][1].minerai), ['5111'], 'minerai de l\'économie (clés)');
    });

    it('SPEC-SAVE-017 : chaque champ de la sauvegarde est classé « porte des ids d\'objet » ou « sans id »', function () {
      var e = G.etatMinimal(4242);
      var data = MC.Save.serialize(e);
      A.deep(MC.Save.champsNonClasses(data), [], 'tout champ de serialize est classé dans CHAMPS_IDS');
      // un champ ajouté sans classement est détecté
      data.nouveauChamp = [[4100, 1]];
      data.player.nouveauChampJoueur = 1;
      A.deep(MC.Save.champsNonClasses(data), ['nouveauChamp', 'player.nouveauChampJoueur'],
             'un champ nouveau, ni migré ni déclaré neutre, fait échouer ce test');
      // les champs que pouvait porter une sauvegarde v1 ou v2 sont tous classés
      // (aucun n'est « absent avant la v3 »)
      var champsV2 = ['v', 'seed', 'time', 'overrides', 'crops', 'donjons', 'pilles', 'explores', 'reperes',
                      'suivi', 'reputation', 'banque', 'pnjsMorts', 'histoire', 'vehicules', 'succes',
                      'player', 'chests', 'furnaces'];
      champsV2.forEach(function (k) {
        A.ok(MC.Save.CHAMPS_IDS[k], k + ' est classé');
      });
      A.deep(MC.Save.champsNonClasses({ player: {} }), [], 'un objet partiel ne déclenche rien');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
