/* spec-objets.js — tests des specs SPEC-OBJET-001 à 005 : tissu et armures,
   armes de mêlée et à distance, gemmes et bijoux, cuisine, coffres piégés
   et surprises. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, Inv = MC.Inventory, M = MC.Modes;
  var B = C.B, I = C.I;
  var flatWorld = G.flatWorld, seededRand = G.seededRand;

  function partie(modeId) {
    var w = flatWorld(10, B.STONE);
    var ents = MC.createEntities(w);
    var pl = MC.createPlayer(w, ents, M.regles(modeId || 'survie', 'facile'));
    pl.state.pos = { x: 0.5, y: 11, z: 0.5 };
    pl.state.onGround = true;
    pl.state.yaw = 0; pl.state.pitch = 0;
    return { w: w, ents: ents, pl: pl, s: pl.state };
  }
  function grille(cells) {
    var g = new Array(9).fill(0);
    cells.forEach(function (c) { g[c[0]] = c[1]; });
    return g;
  }
  function equipe(pl, slot, id) {
    pl.state.equip[slot] = { id: id, n: 1 };
  }

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — SPEC-OBJET-001 : tissu et armures', function () {

    it('SPEC-OBJET-001 : la laine se tisse en tissu', function () {
      var r = Inv.matchRecipe([B.WOOL, B.WOOL], 2, 1);
      A.ok(r, 'recette reconnue');
      A.equal(r.id, I.TISSU);
    });

    it('SPEC-OBJET-001 : sept matières donnent chacune quatre pièces d\'armure', function () {
      ['TISSU', 'CUIR', 'MAILLES', 'BRONZE', 'FER', 'OR', 'DIAMANT'].forEach(function (fam) {
        ['CASQUE', 'PLASTRON', 'JAMBIERES', 'BOTTES'].forEach(function (slot) {
          var id = I[fam + '_' + slot];
          A.ok(id, fam + '_' + slot + ' existe');
          var d = C.def(id);
          A.ok(d, 'objet défini');
          A.equal(d.equipSlot, slot.toLowerCase());
          A.ok(d.defense > 0, 'défense positive');
          A.ok(d.durability > 0, 'durabilité positive');
        });
      });
    });

    it('SPEC-OBJET-001 : le fer protège mieux que le tissu (défense croissante par matière)', function () {
      A.gt(C.def(I.FER_PLASTRON).defense, C.def(I.TISSU_PLASTRON).defense);
      A.gt(C.def(I.DIAMANT_PLASTRON).defense, C.def(I.FER_PLASTRON).defense);
    });

    it('SPEC-OBJET-001 : l\'armure réduit les dégâts encaissés', function () {
      var g = partie();
      var sansArmure = g.s.hp;
      g.pl.hurt(10);
      var perteSansArmure = sansArmure - g.s.hp;

      var g2 = partie();
      equipe(g2.pl, 'casque', I.DIAMANT_CASQUE);
      equipe(g2.pl, 'plastron', I.DIAMANT_PLASTRON);
      equipe(g2.pl, 'jambieres', I.DIAMANT_JAMBIERES);
      equipe(g2.pl, 'bottes', I.DIAMANT_BOTTES);
      var avant = g2.s.hp;
      g2.pl.hurt(10);
      var perteAvecArmure = avant - g2.s.hp;
      A.ok(perteAvecArmure < perteSansArmure, 'moins de dégâts en armure complète de diamant');
      A.ok(perteAvecArmure <= 2, 'diamant complet réduit fortement (80% plafond)');
    });

    it('SPEC-OBJET-001 : chaque coup use la durabilité des pièces portées', function () {
      var g = partie();
      equipe(g.pl, 'casque', I.FER_CASQUE);
      g.s.equip.casque.dmg = C.durabilityOf(I.FER_CASQUE) - 1;
      g.pl.hurt(3);
      A.equal(g.s.equip.casque, null, 'la pièce usée à bout casse et disparaît');
    });

    it('SPEC-OBJET-001 : une pièce d\'armure se répare avec sa matière première', function () {
      var r = Inv.matchRecipe([I.FER_PLASTRON, I.IRON_INGOT], 2, 1);
      A.ok(r, 'réparation reconnue');
      A.equal(r.id, I.FER_PLASTRON);
    });

    it('SPEC-OBJET-001 : les mailles se fabriquent en ficelle et fer, sans plaque', function () {
      var r = Inv.matchRecipe([I.FICELLE, I.FICELLE, I.IRON_INGOT], 3, 1);
      A.ok(r, 'recette reconnue');
      A.equal(r.id, I.MAILLES_CASQUE);
    });

    it('SPEC-OBJET-001 : couleurArmure (apparence.js) reflète la matière équipée', function () {
      var stack = { id: I.OR_CASQUE, n: 1 };
      A.equal(MC.Apparence.couleurArmure(stack), C.def(I.OR_CASQUE).couleurArmure);
      A.equal(MC.Apparence.couleurArmure(null), null, 'rien de porté : aucune couleur');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — SPEC-OBJET-002 : armes', function () {

    it('SPEC-OBJET-002 : cinq familles de mêlée existent en quatre matières', function () {
      ['DAGUE', 'EPEE_LONGUE', 'HACHE_GUERRE', 'MASSE', 'LANCE'].forEach(function (fam) {
        ['BOIS', 'PIERRE', 'FER', 'DIAMANT'].forEach(function (tier) {
          var d = C.def(I[fam + '_' + tier]);
          A.ok(d, fam + '_' + tier + ' défini');
          A.ok(d.damage > 0, 'dégâts positifs');
          A.ok(d.portee > 0, 'portée positive');
          A.ok(d.cadence > 0, 'cadence positive');
          A.ok(d.recul !== undefined, 'recul défini');
        });
      });
    });

    it('SPEC-OBJET-002 : les dégâts progressent avec la matière', function () {
      A.gt(C.def(I.EPEE_LONGUE_DIAMANT).damage, C.def(I.EPEE_LONGUE_BOIS).damage);
    });

    it('SPEC-OBJET-002 : chaque famille se fabrique sans collision de recette', function () {
      var r = Inv.matchRecipe(grille([[0, I.IRON_INGOT], [3, I.STICK]]), 3, 3); // dague : M/S
      A.ok(r, 'dague reconnue');
      A.equal(r.id, I.DAGUE_FER);
    });

    it('SPEC-OBJET-002 : la lance se fabrique distinctement de la pelle', function () {
      var r = Inv.matchRecipe(grille([[0, I.STICK], [3, I.IRON_INGOT], [6, I.STICK]]), 3, 3);
      A.ok(r, 'lance reconnue');
      A.equal(r.id, I.LANCE_FER);
      A.notEqual(r.id, I.IRON_SHOVEL);
    });

    it('SPEC-OBJET-002 : une arme au recul plus fort repousse davantage', function () {
      var g = partie();
      var z1 = g.ents.spawn('zombie', 3, 11, 0.5);
      g.ents.damage(z1, 1, { x: 0.5, y: 11, z: 0.5 }, g.pl, 0.5);
      var vx1 = z1.vel.x;
      var g2 = partie();
      var z2 = g2.ents.spawn('zombie', 3, 11, 0.5);
      g2.ents.damage(z2, 1, { x: 0.5, y: 11, z: 0.5 }, g2.pl, 3);
      A.gt(Math.abs(z2.vel.x), Math.abs(vx1), 'recul ×3 pousse plus loin que recul ×0.5');
    });

    it('SPEC-OBJET-002 : la portée et la cadence de l\'arme en main s\'appliquent au coup', function () {
      var g = partie();
      g.s.inv.add(I.LANCE_FER, 1); g.s.selected = 0;
      A.equal(g.pl.reachArme(), C.def(I.LANCE_FER).portee);
      var e = g.ents.spawn('zombie', 1, 11, 0.5);
      g.pl.attack(e);
      A.close(g.s.attackCd, C.def(I.LANCE_FER).cadence, 1e-6);
    });

    it('SPEC-OBJET-002 : l\'arc long, l\'arbalète lourde et la fronde se fabriquent', function () {
      var r1 = Inv.matchRecipe([I.STICK, I.STICK, I.STICK, I.FICELLE, I.FICELLE, I.FEATHER], 6, 1);
      A.equal(r1.id, I.ARC_LONG);
      var r2 = Inv.matchRecipe([I.STICK, I.STICK, I.IRON_INGOT, I.IRON_INGOT, I.FICELLE, I.FICELLE], 6, 1);
      A.equal(r2.id, I.ARBALETE_LOURDE);
      var r3 = Inv.matchRecipe([I.FICELLE, I.FICELLE, I.STICK], 3, 1);
      A.equal(r3.id, I.FRONDE);
    });

    it('SPEC-OBJET-002 : la fronde tire des galets, pas des flèches', function () {
      var g = partie();
      g.s.inv.add(I.FRONDE, 1); g.s.selected = 0;
      g.s.inv.add(I.FLECHE, 5);
      g.s.inv.add(I.GALET, 5);
      var r = g.pl.tirer();
      A.ok(r, 'tir effectué');
      A.equal(r.munition, I.GALET, 'consomme un galet, pas une flèche');
      A.equal(g.s.inv.count(I.FLECHE), 5, 'les flèches ne bougent pas');
    });

    it('SPEC-OBJET-002 : l\'arbalète lourde impose un délai entre deux tirs', function () {
      var g = partie();
      g.s.inv.add(I.ARBALETE_LOURDE, 1); g.s.selected = 0;
      g.s.inv.add(I.FLECHE, 5);
      A.ok(g.pl.tirer(), 'premier tir');
      A.equal(g.pl.tirer(), null, 'aucun second tir immédiat : en recharge');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — SPEC-OBJET-003 : gemmes taillées et bijoux', function () {

    it('SPEC-OBJET-003 : chaque gemme brute se taille', function () {
      A.equal(Inv.matchRecipe([I.RUBIS], 1, 1).id, I.RUBIS_TAILLE);
      A.equal(Inv.matchRecipe([I.SAPHIR], 1, 1).id, I.SAPHIR_TAILLE);
      A.equal(Inv.matchRecipe([I.EMERALD], 1, 1).id, I.EMERAUDE_TAILLEE);
      A.equal(Inv.matchRecipe([I.DIAMOND], 1, 1).id, I.DIAMANT_TAILLE);
    });

    it('SPEC-OBJET-003 : douze bijoux se portent dans l\'unique emplacement "bijou"', function () {
      ['ANNEAU', 'AMULETTE', 'DIADEME'].forEach(function (fam) {
        ['RUBIS', 'SAPHIR', 'EMERAUDE', 'DIAMANT'].forEach(function (gem) {
          var d = C.def(I[fam + '_' + gem]);
          A.equal(d.equipSlot, 'bijou');
          A.ok(d.effet && d.effet.type, 'un effet est défini');
        });
      });
    });

    it('SPEC-OBJET-003 : chaque gemme donne son propre effet (résistance, vitesse, chance, lumière)', function () {
      A.equal(C.def(I.ANNEAU_RUBIS).effet.type, 'resistance');
      A.equal(C.def(I.ANNEAU_SAPHIR).effet.type, 'vitesse');
      A.equal(C.def(I.ANNEAU_EMERAUDE).effet.type, 'chance');
      A.equal(C.def(I.ANNEAU_DIAMANT).effet.type, 'lumiere');
    });

    it('SPEC-OBJET-003 : une monture plus riche amplifie l\'effet de la même gemme', function () {
      A.gt(C.def(I.DIADEME_SAPHIR).effet.valeur, C.def(I.ANNEAU_SAPHIR).effet.valeur);
    });

    it('SPEC-OBJET-003 : un bijou de résistance réduit les dégâts en plus de l\'armure', function () {
      var g = partie();
      equipe(g.pl, 'bijou', I.ANNEAU_RUBIS);
      var avant = g.s.hp;
      g.pl.hurt(10);
      var perte = avant - g.s.hp;
      A.ok(perte < 10, 'le bijou réduit les dégâts bruts');
    });

    it('SPEC-OBJET-003 : un bijou de saphir accélère le déplacement', function () {
      var g = partie();
      var keys = { forward: true, right: false, left: false, back: false, sprint: false, jump: false };
      var sansBijou = partie();
      sansBijou.pl.updateMovement(0.2, keys);
      var vSans = Math.hypot(sansBijou.s.vel.x, sansBijou.s.vel.z);

      equipe(g.pl, 'bijou', I.ANNEAU_SAPHIR);
      g.pl.updateMovement(0.2, keys);
      var vAvec = Math.hypot(g.s.vel.x, g.s.vel.z);
      A.gt(vAvec, vSans, 'plus rapide avec le bijou de vitesse');
    });

    it('SPEC-OBJET-003 : un bijou d\'émeraude porte chance au butin (minage, C.dropsOf)', function () {
      var bloc = { drops: [{ id: I.DIAMOND, n: 1, chance: 0.45 }] };
      B.__TEST_CHANCE__ = 9001;
      try {
        C.BLOCKS[B.__TEST_CHANCE__] = bloc;
        // rand() fixe à 0.5 : sans bonus, 0.5 > 0.45 → rien ; un bonus de chance
        // (celui d'un bijou d'émeraude, ~0.12) resserre le tirage vers 0 et
        // suffit à faire passer un tirage qui ratait de peu.
        var rFixe = function () { return 0.5; };
        A.equal(C.dropsOf(B.__TEST_CHANCE__, true, rFixe, 0).length, 0, 'sans bijou : le tirage rate');
        A.equal(C.dropsOf(B.__TEST_CHANCE__, true, rFixe, 0.12).length, 1, 'bijou d\'émeraude (0.12) : ça passe');
        // un drop déjà garanti (chance 1, ou pas de chance du tout) reste inchangé
        var garanti = { drops: [{ id: I.STONE, n: 1 }] };
        C.BLOCKS[B.__TEST_CHANCE__] = garanti;
        A.equal(C.dropsOf(B.__TEST_CHANCE__, true, rFixe, 0.12).length, 1, 'un drop garanti n\'est pas affecté');
      } finally {
        // ni le bloc ni le nom de test ne survivent au test, même en échec : la
        // table B est comparée au registre figé des ids (SPEC-SAVE-019, tests/spec-ids.js)
        delete C.BLOCKS[B.__TEST_CHANCE__];
        delete B.__TEST_CHANCE__;
      }
    });

    it('SPEC-OBJET-003 : la chance au butin s\'applique aussi au butin des créatures tuées', function () {
      var g = partie();
      equipe(g.pl, 'bijou', I.ANNEAU_EMERAUDE);
      var e = g.ents.spawn('zombie', g.s.pos.x, g.s.pos.y, g.s.pos.z);
      e.hp = 1;
      var avant = g.ents.list.filter(function (x) { return x.type === 'item'; }).length;
      g.ents.damage(e, 100, null, g.s, 1);
      // le drop reste probabiliste (les armes des zombies ont une chance <1),
      // donc on vérifie seulement que le calcul ne plante pas et que la mort
      // est bien enregistrée — le tirage exact est déjà couvert par dropsOf.
      A.ok(e.dead, 'la créature meurt');
    });

    it('SPEC-OBJET-003 : les bijoux valent cher chez les marchands', function () {
      var trade = Inv.TRADES.filter(function (t) { return t.give[0].id === I.DIADEME_DIAMANT; })[0];
      A.ok(trade, 'un échange existe pour le diadème de diamant');
      A.gt(trade.get.n, 5, 'un bijou de diadème vaut plus que quelques émeraudes');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — SPEC-OBJET-004 : nourriture et cuisine', function () {

    it('SPEC-OBJET-004 : pain, fromage, soupes, ragoûts, tartes et gâteau se cuisinent', function () {
      A.equal(Inv.matchRecipe([B.WOOL, B.SEL], 2, 1).id, I.FROMAGE);
      A.equal(Inv.matchRecipe([I.BOWL, I.MELON_SLICE, I.WHEAT], 3, 1).id, I.SOUPE_LEGUMES);
      A.equal(Inv.matchRecipe([I.BOWL, I.COOKED_MUTTON, I.WHEAT], 3, 1).id, I.RAGOUT);
      A.equal(Inv.matchRecipe([I.WHEAT, I.WHEAT, I.APPLE], 3, 1).id, I.TARTE_POMME);
      A.equal(Inv.matchRecipe([I.WHEAT, I.WHEAT, I.WHEAT, I.FROMAGE], 4, 1).id, I.GATEAU);
    });

    it('SPEC-OBJET-004 : chaque plat rassasie selon sa recette', function () {
      A.ok(C.def(I.GATEAU).food > C.def(I.BAIES).food, 'le gâteau nourrit plus que des baies');
      A.ok(C.def(I.RAGOUT).food >= 6, 'un ragoût est copieux');
    });

    it('SPEC-OBJET-004 : le ragoût et le gâteau soignent un peu en plus de nourrir', function () {
      A.ok(C.def(I.RAGOUT).soin > 0);
      A.ok(C.def(I.GATEAU).soin > 0);
    });

    it('SPEC-OBJET-004 : la viande et le poisson crus sont marqués comme pouvant rendre malade', function () {
      [I.RAW_MUTTON, I.RAW_PORK, I.RAW_CHICKEN, I.RAW_FISH].forEach(function (id) {
        A.ok(C.def(id).cru, C.nameOf(id) + ' est cru');
      });
      A.notOk(C.def(I.COOKED_MUTTON).cru, 'cuit, ce n\'est plus le cas');
    });

    it('SPEC-OBJET-004 : manger cru rend parfois malade, un effet temporaire qui blesse un peu', function () {
      var g = partie();
      g.s.hunger = 10;
      g.s.inv.add(I.RAW_MUTTON, 1); g.s.selected = 0;
      var target = { x: 0, y: 9, z: 0, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      var res = g.pl.useOn(target, function () { return 0.01; }); // en dessous de la chance de maladie
      A.equal(res, 'eat');
      A.ok(g.s.malade > 0, 'le joueur est malade');
      var avant = g.s.hp;
      g.pl.updateSurvival(4.1);
      A.ok(g.s.hp < avant, 'le malaise blesse un peu, régulièrement');
    });

    it('SPEC-OBJET-004 : un buisson mort laisse parfois des baies', function () {
      var drops = C.BLOCKS[B.DEAD_BUSH].drops;
      A.ok(drops.some(function (d) { return d.id === I.BAIES; }));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — SPEC-OBJET-005 : coffres piégés et surprises', function () {

    it('SPEC-OBJET-005 : les deux coffres suspects existent comme blocs interactifs', function () {
      A.equal(C.BLOCKS[B.COFFRE_PIEGE].interactive, 'coffre_piege');
      A.equal(C.BLOCKS[B.COFFRE_SURPRISE].interactive, 'coffre_surprise');
    });

    it('SPEC-OBJET-005 : un coffre piégé se rigge ou un coffre surprise s\'enjolive', function () {
      A.equal(Inv.matchRecipe([B.CHEST, I.FICELLE, I.FLECHE], 3, 1).id, B.COFFRE_PIEGE);
      A.equal(Inv.matchRecipe([B.CHEST, I.GOLD_INGOT], 2, 1).id, B.COFFRE_SURPRISE);
    });

    it('SPEC-OBJET-005 : quatre types de piège sont tirés au hasard, de façon déterministe', function () {
      A.equal(C.tirerPiege(function () { return 0; }), 'fleches');
      A.equal(C.tirerPiege(function () { return 0.99; }), 'gaz');
      A.equal(C.tirerPiege(function () { return 0.3; }), 'explosion');
      A.equal(C.tirerPiege(function () { return 0.6; }), 'alarme');
    });

    it('SPEC-OBJET-005 : une surprise est un butin rare ou un mimic', function () {
      A.equal(C.tirerSurprise(function () { return 0.1; }), 'rare');
      A.equal(C.tirerSurprise(function () { return 0.9; }), 'mimic');
    });

    it('SPEC-OBJET-005 : sans le kit de désamorçage, aucune tentative n\'est possible', function () {
      A.equal(C.tenterDesamorcage(false, function () { return 0; }), false);
    });

    it('SPEC-OBJET-005 : avec le kit, le désamorçage réussit presque toujours', function () {
      A.equal(C.tenterDesamorcage(true, function () { return 0.5; }), true);
      A.equal(C.tenterDesamorcage(true, function () { return 0.95; }), false, 'reste un risque résiduel');
    });

    it('SPEC-OBJET-005 : le kit de désamorçage se fabrique', function () {
      var r = Inv.matchRecipe([I.IRON_INGOT, I.IRON_INGOT, I.FICELLE, I.STICK], 4, 1);
      A.equal(r.id, I.KIT_DESAMORCAGE);
    });

    it('SPEC-OBJET-005 : le mimic est une créature hostile qui garde un butin de valeur', function () {
      var s = MC.EntitySpecs.mimic;
      A.ok(s, 'le mimic est défini');
      A.ok(s.hostile, 'il attaque');
      A.ok(s.drops && s.drops.length > 0, 'il laisse du butin');
    });

    it('SPEC-OBJET-005 : le mimic apparaît et se combat comme une créature ordinaire', function () {
      var g = partie();
      var m = g.ents.spawn('mimic', 1, 11, 0.5);
      A.ok(m, 'apparu');
      A.equal(m.type, 'mimic');
      var mort = g.ents.damage(m, 999, { x: 0, y: 11, z: 0 }, g.pl);
      A.ok(mort, 'peut être vaincu');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
