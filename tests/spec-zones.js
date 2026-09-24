/* spec-zones.js — SPEC-ZONE-001 à 004 et la part pure de SPEC-COMBAT-002 :
   carte de zones déterministe, règles par zone, politiques du serveur,
   redéfinition d'une région par un administrateur, et permission de PvP
   entre deux positions. Le reste de SPEC-COMBAT-002 (autorité du serveur,
   annonce du vainqueur) est couvert par tests/integration-pvp.js — une
   vraie socket, comme integration-net.js. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var Z = MC.Zones;

  var mondes = {};
  function monde(g, opts) {
    var cle = (g || 20260921) + JSON.stringify(opts || {});
    if (!mondes[cle]) mondes[cle] = MC.createWorld(g, opts);
    return mondes[cle];
  }

  describe('SPEC-ZONE — zones de jeu (PvP/PvE, PvP seul, PvE seul, sûre)', { teste: 'Les zones de jeu (PvP/PvE) et leurs fonctions de regroupement et de résolution des règles.', pourquoi: 'Une zone mal résolue changerait silencieusement les règles de combat d\'un joueur (PvP alors qu\'il croit être protégé).', attendu: 'les régions et leurs règles combinées correspondent à la carte de zones, en plus des specs SPEC-ZONE-* couvertes une à une.' }, function () {

    it('SPEC-ZONE-001 : quatre zones, et des règles cohérentes pour chacune', function () {
      A.equal(Z.TYPES.length, 4, 'quatre zones définies');
      ['pvp_pve', 'pvp', 'pve', 'sure'].forEach(function (t) { A.ok(Z.TYPES.indexOf(t) >= 0, t + ' existe'); });

      var sure = Z.regles('sure');
      A.notOk(sure.degatsJoueurs, 'sûre : aucun dégât entre joueurs');
      A.notOk(sure.degatsMob, 'sûre : aucun dégât de monstre');
      A.notOk(sure.apparitionHostile, 'sûre : aucune apparition hostile');

      var pve = Z.regles('pve');
      A.notOk(pve.degatsJoueurs, 'PvE seul : les joueurs ne se blessent pas');
      A.ok(pve.degatsMob, 'PvE seul : les monstres restent dangereux');

      var pvp = Z.regles('pvp');
      A.ok(pvp.degatsJoueurs, 'PvP seul : les joueurs se blessent');
      A.notOk(pvp.apparitionHostile, 'PvP seul : pas de monstres hostiles');

      var pvpPve = Z.regles('pvp_pve');
      A.ok(pvpPve.degatsJoueurs && pvpPve.degatsMob && pvpPve.apparitionHostile,
           'PvP + PvE : tout est permis, la plus dangereuse');
    });

    it('SPEC-ZONE-001 : la carte générée est déterministe (même graine, même point)', function () {
      var w1 = monde(555), w2 = MC.createWorld(555);
      A.ok(w1.zones && typeof w1.zones.classeBase === 'function', 'la carte est branchée dans le monde');
      [[0, 0], [4000, -2500], [-9000, 12000], [777, -333]].forEach(function (p) {
        A.equal(w1.zones.classeBase(p[0], p[1]), w2.zones.classeBase(p[0], p[1]),
                'même classe en (' + p[0] + ',' + p[1] + ') sur un monde recréé à l\'identique');
      });
    });

    it('SPEC-ZONE-001 : le point d\'apparition est toujours sûr, et la carte suit la densité @lent', function () {
      var w = monde(20260921);
      var col = w.findSpawnColumn();
      A.equal(w.zoneEn(col[0], col[1]).zone, 'sure', 'le point d\'apparition du monde est sûr');
      // sur un large échantillon, la génération produit bien les quatre zones
      var comptes = { sure: 0, pve: 0, pvp: 0, pvp_pve: 0 };
      for (var x = -20000; x < 20000; x += 400) for (var z = -20000; z < 20000; z += 400) {
        comptes[w.zones.classeBase(x, z)]++;
      }
      A.gt(comptes.sure, 0, 'des zones sûres apparaissent (mégapoles) : ' + JSON.stringify(comptes));
      A.gt(comptes.pvp_pve, 0, 'des zones vierges, plus dangereuses, apparaissent : ' + JSON.stringify(comptes));
    });

    it('SPEC-ZONE-004 : le serveur choisit sa politique — tout PvE, tout sûr, tout PvP', function () {
      var loin = { x: 9000, z: -9000 };            // loin du point d'apparition, toujours sûr
      var wPve = monde(1, { zonePolitique: 'tout_pve' });
      A.equal(wPve.zoneEn(loin.x, loin.z).zone, 'pve', 'politique tout_pve : partout en PvE (hors apparition)');
      var wSur = monde(1, { zonePolitique: 'tout_sur' });
      A.equal(wSur.zoneEn(loin.x, loin.z).zone, 'sure', 'politique tout_sur : partout sûr');
      var wPvp = monde(1, { zonePolitique: 'tout_pvp' });
      A.equal(wPvp.zoneEn(loin.x, loin.z).zone, 'pvp_pve', 'politique tout_pvp : partout dangereux');
      // une politique inconnue retombe sur la carte générée, sans planter
      var wInc = monde(1, { zonePolitique: 'n_importe_quoi' });
      A.ok(Z.TYPES.indexOf(wInc.zoneEn(loin.x, loin.z).zone) >= 0, 'politique inconnue : repli sur "generee"');
    });

    it('regionDe() regroupe les points par case de 128 blocs', function () {
      A.equal(Z.regionDe(0, 0), Z.regionDe(50, 60), 'deux points proches partagent leur région');
      A.notEqual(Z.regionDe(0, 0), Z.regionDe(200, 0), 'une région voisine diffère');
    });

    it('reglesEn() combine la carte et les redéfinitions en un seul appel', function () {
      var etat = Z.creerEtat({ politique: 'tout_pve' });
      var carte = Z.creer(null, null, { politique: 'tout_pve' });
      A.notOk(Z.reglesEn(carte, etat, 9000, 9000).degatsJoueurs, 'tout_pve, loin du spawn : pas de PvP');
      Z.definirRegion(etat, 9000, 9000, 'pvp', 'admin', 1);
      A.ok(Z.reglesEn(carte, etat, 9000, 9000).degatsJoueurs, 'la redéfinition change aussi les règles rendues');
    });

    it('SPEC-ZONE-004 : un administrateur redéfinit la zone d\'une région, et peut revenir en arrière', function () {
      var etat = Z.creerEtat({ politique: 'generee' });
      var carte = Z.creer(null, null, { politique: 'generee' });
      A.equal(Z.zoneEn(carte, etat, 500, 500).zone, 'pvp_pve', 'sans densité, la carte générée retombe sur pvp_pve');
      var r = Z.definirRegion(etat, 500, 500, 'sure', 'admin1', 1000);
      A.ok(r.ok, 'la redéfinition est acceptée');
      A.equal(Z.zoneEn(carte, etat, 500, 500).zone, 'sure', 'la région redéfinie prime sur la carte générée');
      A.ok(Z.zoneEn(carte, etat, 500, 500).redefinie, 'zoneEn signale la redéfinition');
      // toute la région (128 blocs) est concernée, pas seulement le point exact
      A.equal(Z.zoneEn(carte, etat, 505, 480).zone, 'sure', 'toute la région redéfinie est couverte');
      // hors de la région, la carte générée reprend la main
      A.equal(Z.zoneEn(carte, etat, 5000, 5000).zone, 'pvp_pve', 'hors de la région, rien n\'a changé');
      A.notOk(Z.definirRegion(etat, 1, 1, 'inconnue', 'admin1', 1000).ok, 'une zone inconnue est refusée');
      var ret = Z.retirerRegion(etat, 500, 500);
      A.ok(ret.ok, 'la région se retire');
      A.equal(Z.zoneEn(carte, etat, 500, 500).zone, 'pvp_pve', 'après retrait, la carte générée reprend la main');
    });

    it('SPEC-ZONE-004 : la redéfinition d\'une région se sérialise et se recharge', function () {
      var etat = Z.creerEtat({ politique: 'tout_pve' });
      Z.definirRegion(etat, 100, 100, 'sure', 'admin1', 42);
      var data = Z.serialiser(etat);
      var repris = Z.creerEtat({ politique: 'tout_pve' });
      A.ok(Z.appliquer(repris, data), 'la reprise réussit');
      A.equal(Z.listeRegions(repris).length, 1, 'la région redéfinie est reprise');
      A.equal(Z.listeRegions(repris)[0].zone, 'sure');
    });

    it('SPEC-ZONE-002 : les apparitions hostiles suivent la règle de zone, hors ligne comme en ligne', function () {
      // un monde "tout sûr" ne fait jamais naître de créature hostile
      var w = monde(2, { zonePolitique: 'tout_sur' });
      var entities = MC.createEntities(w);
      var player = { pos: { x: 0, y: 70, z: 0 } };
      var hostiles = 0, essais = 0;
      for (var i = 0; i < 300; i++) {
        var e = entities.trySpawn(player, true, Math.random, { zombie: 999, sheep: 999, villager: 999 });
        if (e) { essais++; if (entities.SPECS[e.type] && entities.SPECS[e.type].hostile) hostiles++; }
      }
      A.equal(hostiles, 0, 'zone sûre partout : aucune créature hostile n\'est née (' + essais + ' essais)');
    });

    it('SPEC-ZONE-002 : les dégâts d\'un monstre sont annulés en zone sûre', function () {
      var w = monde(3, { zonePolitique: 'tout_sur' });
      var entities = MC.createEntities(w);
      var e = entities.spawn('zombie', 5, 70, 5, {});
      var joueur = { pos: { x: 5, y: 70, z: 5.4 }, dead: false, hp: 20 };
      // même très proche et longtemps, jamais de dégât en zone sûre
      for (var i = 0; i < 20; i++) entities.update(0.5, joueur, { joueurs: [joueur] });
      A.equal(joueur.hp, 20, 'la vie du joueur reste intacte en zone sûre');
    });

    it('SPEC-COMBAT-002 (pur) : pvpAutorise exige que les DEUX positions soient en zone PvP', function () {
      var etat = Z.creerEtat({ politique: 'tout_pvp' });
      var carte = Z.creer(null, null, { politique: 'tout_pvp' });
      var loinA = { x: 9000, z: 9000 }, loinB = { x: 9200, z: 9000 };
      A.ok(Z.pvpAutorise(carte, etat, loinA, loinB), 'deux joueurs en zone PvP : autorisé');
      Z.definirRegion(etat, loinB.x, loinB.z, 'sure', 'admin', 1);
      A.notOk(Z.pvpAutorise(carte, etat, loinA, loinB),
              'un des deux joueurs réfugié en zone sûre : le PvP est refusé, même agressé depuis une zone PvP');
    });

  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
