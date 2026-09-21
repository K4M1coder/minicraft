/* functional.js — tests fonctionnels : des séquences de jeu complètes,
   du geste du joueur jusqu'à l'effet sur le monde et l'inventaire. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, P = MC.Physics, Inv = MC.Inventory;
  var B = C.B, I = C.I;
  var flatWorld = G.flatWorld, seededRand = G.seededRand;

  /* Une partie minimale mais complète : monde plat, entités, joueur posé dessus. */
  function partie(groundId) {
    var w = flatWorld(10, groundId === undefined ? B.STONE : groundId);
    var ents = MC.createEntities(w);
    var pl = MC.createPlayer(w, ents);
    pl.state.pos = { x: 0.5, y: 11, z: 0.5 };
    pl.state.onGround = true;
    return { w: w, ents: ents, pl: pl, s: pl.state };
  }

  var NOKEY = { forward: 0, back: 0, left: 0, right: 0, jump: 0, sprint: 0 };
  function keys(o) { return Object.assign({}, NOKEY, o || {}); }

  // ══════════════════════════════════════════════════════════════════════════
  describe('Fonctionnel — déplacement du joueur', function () {
    it('avancer déplace bien dans la direction du regard', function () {
      for (var deg = 0; deg < 360; deg += 45) {
        var g = partie();
        g.s.yaw = deg * Math.PI / 180;
        var x0 = g.s.pos.x, z0 = g.s.pos.z;
        for (var i = 0; i < 60; i++) g.pl.updateMovement(1 / 60, keys({ forward: 1 }));
        var dx = g.s.pos.x - x0, dz = g.s.pos.z - z0;
        var n = Math.hypot(dx, dz);
        A.ok(n > 1, 'le joueur a avancé à ' + deg + '° (' + n.toFixed(2) + ' m)');
        var look = { x: -Math.sin(g.s.yaw), z: -Math.cos(g.s.yaw) };
        var dot = (dx / n) * look.x + (dz / n) * look.z;
        A.close(dot, 1, 1e-3, 'direction alignée sur le regard à ' + deg + '°');
      }
    });

    it('courir va plus vite que marcher', function () {
      var a = partie(), b = partie();
      for (var i = 0; i < 120; i++) {
        a.pl.updateMovement(1 / 60, keys({ forward: 1 }));
        b.pl.updateMovement(1 / 60, keys({ forward: 1, sprint: 1 }));
      }
      var da = Math.hypot(a.s.pos.x - 0.5, a.s.pos.z - 0.5);
      var db = Math.hypot(b.s.pos.x - 0.5, b.s.pos.z - 0.5);
      A.ok(db > da * 1.3, 'course nettement plus rapide (' + da.toFixed(1) + ' vs ' + db.toFixed(1) + ')');
    });

    it('sans touche, le joueur ne dérive pas', function () {
      var g = partie();
      var x0 = g.s.pos.x, z0 = g.s.pos.z;
      for (var i = 0; i < 300; i++) g.pl.updateMovement(1 / 60, keys());
      A.close(g.s.pos.x, x0, 1e-6, 'pas de dérive en X');
      A.close(g.s.pos.z, z0, 1e-6, 'pas de dérive en Z');
    });

    it('sauter fait décoller puis retomber au sol', function () {
      var g = partie();
      var y0 = g.s.pos.y, max = y0;
      g.pl.updateMovement(1 / 60, keys({ jump: 1 }));
      for (var i = 0; i < 180; i++) {
        g.pl.updateMovement(1 / 60, keys());
        if (g.s.pos.y > max) max = g.s.pos.y;
      }
      A.ok(max - y0 > 1.0, 'le saut dépasse un bloc (' + (max - y0).toFixed(2) + ')');
      A.close(g.s.pos.y, y0, 0.05, 'retour au sol');
      A.ok(g.s.onGround, 'au sol');
    });

    it('on ne peut pas sauter en l\'air', function () {
      var g = partie();
      g.s.pos.y = 20; g.s.onGround = false;
      var v0 = g.s.vel.y;
      g.pl.updateMovement(1 / 60, keys({ jump: 1 }));
      A.ok(g.s.vel.y < v0, 'la gravité domine, pas de double saut');
    });

    it('un mur bloque mais laisse glisser le long', function () {
      var g = partie();
      g.w.setBlock(0, 11, -2, B.STONE);
      g.w.setBlock(0, 12, -2, B.STONE);
      g.s.yaw = 0;                                   // regarde vers -Z, vers le mur
      for (var i = 0; i < 180; i++) g.pl.updateMovement(1 / 60, keys({ forward: 1 }));
      A.ok(g.s.pos.z > -1.5, 'arrêté par le mur (z=' + g.s.pos.z.toFixed(2) + ')');
    });

    it('nager permet de remonter à la surface', function () {
      var w = flatWorld(4, B.STONE);
      for (var y = 5; y <= 20; y++) for (var x = -2; x <= 2; x++) for (var z = -2; z <= 2; z++)
        w.setBlock(x, y, z, B.WATER);
      var ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents);
      pl.state.pos = { x: 0.5, y: 5, z: 0.5 };
      var y0 = pl.state.pos.y;
      for (var i = 0; i < 300; i++) pl.updateMovement(1 / 60, keys({ jump: 1 }));
      A.ok(pl.state.pos.y > y0 + 5, 'remontée effective (' + y0 + ' -> ' + pl.state.pos.y.toFixed(1) + ')');
    });

    it('sans nager, on coule lentement et non en chute libre', function () {
      var w = flatWorld(4, B.STONE);
      for (var y = 5; y <= 30; y++) for (var x = -2; x <= 2; x++) for (var z = -2; z <= 2; z++)
        w.setBlock(x, y, z, B.WATER);
      var pl = MC.createPlayer(w, MC.createEntities(w));
      pl.state.pos = { x: 0.5, y: 28, z: 0.5 };
      for (var i = 0; i < 60; i++) pl.updateMovement(1 / 60, keys());
      A.ok(pl.state.vel.y >= -3.5, 'vitesse de chute plafonnée (' + pl.state.vel.y.toFixed(2) + ')');
    });

    it('en vol, la gravité ne s\'applique plus', function () {
      var g = partie();
      g.s.flying = true;
      g.s.pos.y = 30;
      for (var i = 0; i < 120; i++) g.pl.updateMovement(1 / 60, keys());
      A.close(g.s.pos.y, 30, 0.2, 'reste en l\'air');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Fonctionnel — survie', function () {
    it('une chute de plus de 3 blocs blesse', function () {
      var g = partie();
      g.s.pos.y = 30; g.s.onGround = false;
      for (var i = 0; i < 300 && !g.s.onGround; i++) g.pl.updateMovement(1 / 60, keys());
      A.ok(g.s.hp < 20, 'dégâts de chute subis (pv=' + g.s.hp + ')');
    });

    it('une petite chute ne blesse pas', function () {
      var g = partie();
      g.s.pos.y = 13; g.s.onGround = false;
      for (var i = 0; i < 300 && !g.s.onGround; i++) g.pl.updateMovement(1 / 60, keys());
      A.equal(g.s.hp, 20, 'aucun dégât');
    });

    it('tomber dans l\'eau n\'inflige pas de dégâts de chute', function () {
      var w = flatWorld(4, B.STONE);
      for (var y = 5; y <= 12; y++) for (var x = -2; x <= 2; x++) for (var z = -2; z <= 2; z++)
        w.setBlock(x, y, z, B.WATER);
      var pl = MC.createPlayer(w, MC.createEntities(w));
      pl.state.pos = { x: 0.5, y: 40, z: 0.5 };
      for (var i = 0; i < 600; i++) pl.updateMovement(1 / 60, keys());
      A.equal(pl.state.hp, 20, 'l\'eau amortit');
    });

    it('rester sous l\'eau finit par noyer', function () {
      var w = flatWorld(4, B.STONE);
      for (var y = 5; y <= 30; y++) for (var x = -2; x <= 2; x++) for (var z = -2; z <= 2; z++)
        w.setBlock(x, y, z, B.WATER);
      var pl = MC.createPlayer(w, MC.createEntities(w));
      pl.state.pos = { x: 0.5, y: 10, z: 0.5 };
      for (var i = 0; i < 60 * 30; i++) { pl.updateMovement(1 / 60, keys()); pl.updateSurvival(1 / 60); }
      A.ok(pl.state.air <= 0, 'plus d\'air');
      A.ok(pl.state.hp < 20, 'dégâts de noyade (pv=' + pl.state.hp + ')');
    });

    it('hors de l\'eau, l\'air se régénère', function () {
      var g = partie();
      g.s.air = 0;
      for (var i = 0; i < 300; i++) g.pl.updateSurvival(1 / 60);
      A.equal(g.s.air, 10, 'air plein');
    });

    it('la faim diminue en courant', function () {
      var g = partie();
      var h0 = g.s.hunger;
      for (var i = 0; i < 60 * 240; i++) {
        g.pl.updateMovement(1 / 60, keys({ forward: 1, sprint: 1 }));
        g.pl.updateSurvival(1 / 60);
      }
      A.ok(g.s.hunger < h0, 'la faim a baissé (' + g.s.hunger + ')');
    });

    it('la vie se régénère si la faim est haute', function () {
      var g = partie();
      g.s.hp = 10; g.s.hunger = 20;
      for (var i = 0; i < 60 * 20; i++) g.pl.updateSurvival(1 / 60);
      A.ok(g.s.hp > 10, 'régénération (pv=' + g.s.hp + ')');
    });

    it('la vie ne se régénère pas si on a faim', function () {
      var g = partie();
      g.s.hp = 10; g.s.hunger = 2;
      for (var i = 0; i < 60 * 20; i++) g.pl.updateSurvival(1 / 60);
      A.ok(g.s.hp <= 10, 'pas de régénération à jeun');
    });

    it('à zéro faim, on perd de la vie', function () {
      var g = partie();
      g.s.hunger = 0;
      var hp0 = g.s.hp;
      for (var i = 0; i < 60 * 20; i++) g.pl.updateSurvival(1 / 60);
      A.ok(g.s.hp < hp0, 'la famine blesse (pv=' + g.s.hp + ')');
    });

    it('à zéro vie, le joueur est mort', function () {
      var g = partie();
      g.pl.hurt(20);
      A.equal(g.s.hp, 0);
      A.ok(g.s.dead, 'marqué mort');
    });

    it('réapparaître restaure vie, faim et position', function () {
      var g = partie();
      g.pl.hurt(20);
      g.pl.respawn({ x: 5, y: 12, z: 5 });
      A.equal(g.s.hp, 20); A.equal(g.s.hunger, 20);
      A.notOk(g.s.dead, 'vivant');
      A.equal(g.s.pos.x, 5);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Fonctionnel — miner et ramasser', function () {
    function viseLeSol(g) {
      g.s.pitch = -Math.PI / 2 + 0.01;
      return g.pl.aim();
    }

    it('miner un bloc prend du temps puis le casse', function () {
      var g = partie();
      var t = viseLeSol(g);
      A.ok(t, 'un bloc est visé');
      A.equal(g.pl.mineTick(0.01, t, function () { return 0; }), null, 'pas cassé tout de suite');
      var res = null;
      for (var i = 0; i < 2000 && !res; i++) res = g.pl.mineTick(1 / 60, t, function () { return 0; });
      A.ok(res, 'le bloc finit par céder');
      A.equal(g.w.getBlock(t.x, t.y, t.z), 0, 'devenu de l\'air');
    });

    it('un meilleur outil mine plus vite', function () {
      function tempsAvec(outil) {
        var g = partie();
        if (outil) { g.s.inv.add(outil, 1); g.s.selected = 0; }
        var t = viseLeSol(g);
        var n = 0, res = null;
        while (!res && n < 100000) { res = g.pl.mineTick(1 / 240, t, function () { return 0; }); n++; }
        return n;
      }
      var main = tempsAvec(0), bois = tempsAvec(I.WOOD_PICKAXE), fer = tempsAvec(I.IRON_PICKAXE);
      A.ok(bois < main, 'pioche bois plus rapide');
      A.ok(fer < bois, 'pioche fer plus rapide');
    });

    it('le bloc miné tombe en objet ramassable', function () {
      var g = partie();
      g.s.inv.add(I.IRON_PICKAXE, 1); g.s.selected = 0;
      var t = viseLeSol(g);
      var res = null;
      for (var i = 0; i < 5000 && !res; i++) res = g.pl.mineTick(1 / 60, t, function () { return 0; });
      A.ok(res, 'cassé');
      var objets = g.ents.list.filter(function (e) { return e.type === 'item'; });
      A.ok(objets.length > 0, 'un objet est tombé');
      A.equal(objets[0].item, B.COBBLE, 'la pierre donne du pavé');
    });

    it('le drop est ramassé et rejoint l\'inventaire', function () {
      var g = partie();
      g.s.inv.add(I.IRON_PICKAXE, 1); g.s.selected = 0;
      var t = viseLeSol(g);
      var res = null;
      for (var i = 0; i < 5000 && !res; i++) res = g.pl.mineTick(1 / 60, t, function () { return 0; });
      var pris = 0;
      for (var j = 0; j < 600; j++) {
        var ev = g.ents.update(1 / 60, g.s, { rand: seededRand(9) });
        ev.picked.forEach(function (p) { g.pl.pickUp(p.id, p.n); pris += p.n; });
      }
      A.ok(pris > 0, 'objet ramassé');
      A.ok(g.s.inv.count(B.COBBLE) > 0, 'pavé en inventaire');
    });

    it('miner la pierre à main nue ne donne rien', function () {
      var g = partie();
      var t = viseLeSol(g);
      var res = null;
      for (var i = 0; i < 20000 && !res; i++) res = g.pl.mineTick(1 / 60, t, function () { return 0; });
      A.ok(res, 'cassé quand même');
      A.equal(res.drops.length, 0, 'aucun drop sans pioche');
      A.equal(g.ents.list.length, 0, 'aucune entité objet');
    });

    it('changer de cible remet la progression à zéro', function () {
      var g = partie();
      var t = viseLeSol(g);
      g.pl.mineTick(0.3, t, function () { return 0; });
      var p1 = g.s.mining.t;
      A.ok(p1 > 0, 'progression entamée');
      g.pl.mineTick(0.01, { x: t.x + 3, y: t.y, z: t.z, block: B.STONE }, function () { return 0; });
      A.ok(g.s.mining.t < p1, 'progression réinitialisée sur la nouvelle cible');
    });

    it('le socle est immininable', function () {
      var w = flatWorld(0, B.BEDROCK);
      var pl = MC.createPlayer(w, MC.createEntities(w));
      pl.state.pos = { x: 0.5, y: 1, z: 0.5 };
      pl.state.pitch = -Math.PI / 2 + 0.01;
      var t = pl.aim();
      A.ok(t, 'visé');
      for (var i = 0; i < 6000; i++) A.equal(pl.mineTick(1 / 60, t, function () { return 0; }), null);
      A.equal(w.getBlock(t.x, t.y, t.z), B.BEDROCK, 'toujours là');
    });

    it('casser un bloc fait tomber la plante posée dessus', function () {
      var g = partie();
      g.s.inv.add(I.IRON_SHOVEL, 1); g.s.selected = 0;
      g.w.setBlock(0, 10, 0, B.FARMLAND);
      g.w.setBlock(0, 11, 0, B.WHEAT3);
      var t = { x: 0, y: 10, z: 0, block: B.FARMLAND, nx: 0, ny: 1, nz: 0 };
      var res = null;
      for (var i = 0; i < 6000 && !res; i++) res = g.pl.mineTick(1 / 60, t, function () { return 0; });
      A.ok(res, 'terre cassée');
      A.equal(g.w.getBlock(0, 11, 0), 0, 'le blé est tombé aussi');
      A.ok(res.drops.some(function (d) { return d.id === I.WHEAT; }), 'le blé a donné sa récolte');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Fonctionnel — poser et utiliser', function () {
    it('poser un bloc le place sur la face visée et consomme la pile', function () {
      var g = partie();
      g.s.inv.add(B.BRICK, 5); g.s.selected = 0;
      var t = { x: 3, y: 10, z: 3, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), 'place');
      A.equal(g.w.getBlock(3, 11, 3), B.BRICK, 'posé au-dessus');
      A.equal(g.s.inv.count(B.BRICK), 4, 'une brique consommée');
    });

    it('on ne peut pas se poser un bloc dans le corps', function () {
      var g = partie();
      g.s.inv.add(B.BRICK, 5); g.s.selected = 0;
      // face du dessus du bloc sur lequel on se tient : le bloc irait dans nos jambes
      var t = { x: 0, y: 10, z: 0, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), null, 'refusé');
      A.equal(g.s.inv.count(B.BRICK), 5, 'rien consommé');
    });

    it('on ne peut pas poser dans un bloc plein', function () {
      var g = partie();
      g.s.inv.add(B.BRICK, 5); g.s.selected = 0;
      var t = { x: 3, y: 5, z: 3, block: B.STONE, nx: 0, ny: 1, nz: 0 };  // y+1 est aussi plein
      A.equal(g.pl.useOn(t), null, 'place occupée');
    });

    it('poser remplace l\'eau', function () {
      var g = partie();
      g.w.setBlock(4, 11, 4, B.WATER);
      g.s.inv.add(B.BRICK, 1); g.s.selected = 0;
      var t = { x: 4, y: 10, z: 4, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), 'place');
      A.equal(g.w.getBlock(4, 11, 4), B.BRICK);
    });

    it('la main vide ne pose rien', function () {
      var g = partie();
      var t = { x: 3, y: 10, z: 3, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), null);
    });

    it('un objet non posable ne pose rien', function () {
      var g = partie();
      g.s.inv.add(I.STICK, 3); g.s.selected = 0;
      var t = { x: 3, y: 10, z: 3, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), null, 'un bâton ne se pose pas');
      A.equal(g.s.inv.count(I.STICK), 3, 'rien consommé');
    });

    it('viser un établi demande l\'ouverture de l\'interface', function () {
      var g = partie();
      g.w.setBlock(2, 11, 2, B.CRAFTING_TABLE);
      var t = { x: 2, y: 11, z: 2, block: B.CRAFTING_TABLE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), 'open:craft');
    });

    it('viser un fourneau demande son interface', function () {
      var g = partie();
      g.w.setBlock(2, 11, 2, B.FURNACE);
      var t = { x: 2, y: 11, z: 2, block: B.FURNACE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), 'open:furnace');
    });

    it('manger restaure la faim et consomme l\'aliment', function () {
      var g = partie();
      g.s.hunger = 10;
      g.s.inv.add(I.BREAD, 2); g.s.selected = 0;
      var t = { x: 3, y: 10, z: 3, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), 'eat');
      A.equal(g.s.hunger, 15, 'le pain rend 5');
      A.equal(g.s.inv.count(I.BREAD), 1, 'un pain consommé');
    });

    it('on ne mange pas le ventre plein', function () {
      var g = partie();
      g.s.hunger = 20;
      g.s.inv.add(I.BREAD, 1); g.s.selected = 0;
      var t = { x: 3, y: 10, z: 3, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), null);
      A.equal(g.s.inv.count(I.BREAD), 1, 'pain intact');
    });

    it('manger ne dépasse jamais la faim maximale', function () {
      var g = partie();
      g.s.hunger = 18;
      g.s.inv.add(I.COOKED_MUTTON, 1); g.s.selected = 0;
      var t = { x: 3, y: 10, z: 3, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      g.pl.useOn(t);
      A.equal(g.s.hunger, 20, 'plafonné');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Fonctionnel — torches, usure, jeter', function () {
    it('une torche se pose sur un sol et pas en plein ciel', function () {
      var g = partie();
      g.s.inv.add(B.TORCH, 4); g.s.selected = 0;
      var surSol = { x: 3, y: 10, z: 3, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(surSol), 'place', 'posee sur le sol');
      A.equal(g.w.getBlock(3, 11, 3), B.TORCH);

      // une face dont le voisinage est entierement vide n a aucun support
      var enLair = { x: 6, y: 30, z: 6, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(enLair), null, 'refusee sans support');
    });

    it('la torche ne bloque pas le passage', function () {
      var g = partie();
      A.notOk(C.isSolid(B.TORCH), 'traversable');
    });

    it('miner use l outil et finit par le briser', function () {
      var g = partie();
      g.s.inv.add(I.WOOD_PICKAXE, 1); g.s.selected = 0;
      g.s.pitch = -Math.PI / 2 + 0.01;
      var casses = 0;
      for (var n = 0; n < 200 && g.s.inv.slots[0]; n++) {
        // on remet un bloc a miner a chaque tour
        g.w.setBlock(Math.floor(g.s.pos.x), 10, Math.floor(g.s.pos.z), B.STONE);
        var t = g.pl.aim();
        if (!t) break;
        var res = null;
        for (var i = 0; i < 4000 && !res; i++) res = g.pl.mineTick(1 / 60, t, function () { return 0; });
        if (res && res.toolBroke) { casses++; break; }
      }
      A.equal(casses, 1, 'la pioche a fini par se briser');
      A.equal(g.s.inv.slots[0], null, 'case liberee');
    });

    it('frapper use aussi l arme', function () {
      var g = partie();
      g.s.inv.add(I.WOOD_SWORD, 1); g.s.selected = 0;
      var m = g.ents.spawn('sheep', 1, 11, 0.5);
      g.pl.attack(m);
      A.equal(g.s.inv.slots[0].dmg, 1, 'une unite d usure');
    });

    it('jeter un objet cree une entite devant le joueur', function () {
      var g = partie();
      g.s.inv.add(B.COBBLE, 5); g.s.selected = 0;
      var d = g.pl.dropSelected(1, seededRand(1));
      A.ok(d, 'objet jete');
      A.equal(d.id, B.COBBLE);
      A.equal(g.s.inv.count(B.COBBLE), 4, 'une unite retiree');
      A.equal(g.ents.list.length, 1, 'une entite au sol');
      A.ok(g.ents.list[0].pickup > 0.5, 'pas ramassable immediatement');
    });

    it('jeter une case vide ne fait rien', function () {
      var g = partie();
      A.equal(g.pl.dropSelected(1, seededRand(1)), null);
      A.equal(g.ents.list.length, 0);
    });

    /* Un objet jete part DEVANT soi, donc hors du rayon d aimantation : il ne
       doit pas revenir tout seul, sinon on ne pourrait rien jeter. Il redevient
       ramassable une fois le delai passe, si l on va le chercher. */
    it('un objet jete ne revient pas tout seul dans l inventaire', function () {
      var g = partie();
      g.s.inv.add(B.COBBLE, 1); g.s.selected = 0;
      g.pl.dropSelected(1, seededRand(1));
      var pris = 0;
      for (var i = 0; i < 600; i++) {
        var ev = g.ents.update(1 / 60, g.s, { rand: seededRand(3) });
        ev.picked.forEach(function (p) { pris += p.n; });
      }
      A.equal(pris, 0, 'reste au sol');
      A.equal(g.ents.list.length, 1, 'entite toujours la');
    });

    it('aller le chercher permet de le reprendre', function () {
      var g = partie();
      g.s.inv.add(B.COBBLE, 1); g.s.selected = 0;
      g.pl.dropSelected(1, seededRand(1));
      // on laisse passer le delai, puis on se place dessus
      for (var i = 0; i < 90; i++) g.ents.update(1 / 60, g.s, { rand: seededRand(3) });
      var e = g.ents.list[0];
      g.s.pos.x = e.pos.x; g.s.pos.z = e.pos.z;
      var pris = 0;
      for (var j = 0; j < 300; j++) {
        var ev = g.ents.update(1 / 60, g.s, { rand: seededRand(3) });
        ev.picked.forEach(function (p) { g.pl.pickUp(p.id, p.n); pris += p.n; });
      }
      A.equal(pris, 1, 'repris en allant dessus');
      A.equal(g.s.inv.count(B.COBBLE), 1, 'de retour en inventaire');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Fonctionnel — agriculture', function () {
    it('la houe transforme l\'herbe en terre labourée', function () {
      var g = partie(B.GRASS);
      g.s.inv.add(I.WOOD_HOE, 1); g.s.selected = 0;
      var t = { x: 3, y: 10, z: 3, block: B.GRASS, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), 'till');
      A.equal(g.w.getBlock(3, 10, 3), B.FARMLAND);
    });

    it('la houe ne laboure pas la pierre', function () {
      var g = partie(B.STONE);
      g.s.inv.add(I.WOOD_HOE, 1); g.s.selected = 0;
      var t = { x: 3, y: 10, z: 3, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), null);
    });

    it('les graines ne se plantent que sur de la terre labourée', function () {
      var g = partie(B.GRASS);
      g.s.inv.add(I.SEEDS, 3); g.s.selected = 0;
      var surHerbe = { x: 3, y: 10, z: 3, block: B.GRASS, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(surHerbe), null, 'refusé sur l\'herbe');
      g.w.setBlock(3, 10, 3, B.FARMLAND);
      var surLabour = { x: 3, y: 10, z: 3, block: B.FARMLAND, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(surLabour), 'plant', 'accepté sur le labour');
      A.equal(g.w.getBlock(3, 11, 3), B.WHEAT0, 'pousse plantée');
      A.equal(g.s.inv.count(I.SEEDS), 2, 'une graine consommée');
    });

    it('cycle complet : labourer, planter, faire pousser, récolter', function () {
      var w = MC.createWorld(4242);
      w.getChunk(0, 0, true);
      var ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents);
      var gy = w.groundAt(8, 8, true);
      w.setBlock(8, gy, 8, B.GRASS);
      pl.state.pos = { x: 8.5, y: gy + 1, z: 8.5 };

      // 1. labourer
      pl.state.inv.add(I.WOOD_HOE, 1); pl.state.selected = 0;
      A.equal(pl.useOn({ x: 8, y: gy, z: 8, block: B.GRASS, nx: 0, ny: 1, nz: 0 }), 'till');

      // 2. planter
      pl.state.inv.add(I.SEEDS, 1); pl.state.selected = 1;
      A.equal(pl.useOn({ x: 8, y: gy, z: 8, block: B.FARMLAND, nx: 0, ny: 1, nz: 0 }), 'plant');

      // 3. pousser jusqu'à maturité
      for (var i = 0; i < 12; i++) w.tick(20, 14, function () { return 0; });
      A.equal(w.getBlock(8, gy + 1, 8), B.WHEAT3, 'blé mûr');

      // 4. récolter
      var t = { x: 8, y: gy + 1, z: 8, block: B.WHEAT3, nx: 0, ny: 1, nz: 0 };
      var res = pl.mineTick(0.1, t, function () { return 0; });
      A.ok(res, 'récolté d\'un coup (plante instantanée)');
      A.ok(res.drops.some(function (d) { return d.id === I.WHEAT; }), 'du blé récolté');
      A.ok(res.drops.some(function (d) { return d.id === I.SEEDS; }), 'des graines récupérées');
    });

    it('du blé récolté on peut faire du pain', function () {
      var grid = new Array(9).fill(0);
      grid[0] = I.WHEAT; grid[1] = I.WHEAT; grid[2] = I.WHEAT;
      var r = Inv.matchRecipe(grid, 3, 3);
      A.ok(r); A.equal(r.id, I.BREAD);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Fonctionnel — combat', function () {
    it('frapper un mouton le blesse', function () {
      var g = partie();
      var m = g.ents.spawn('sheep', 1.0, 11, 0.5);
      var hp0 = m.hp;
      var r = g.pl.attack(m);
      A.ok(r, 'coup porté');
      A.ok(m.hp < hp0, 'mouton blessé');
    });

    it('une épée fait plus mal que la main', function () {
      var a = partie(), b = partie();
      var m1 = a.ents.spawn('sheep', 1, 11, 0.5);
      var m2 = b.ents.spawn('sheep', 1, 11, 0.5);
      b.s.inv.add(I.IRON_SWORD, 1); b.s.selected = 0;
      a.pl.attack(m1); b.pl.attack(m2);
      A.ok(m2.hp < m1.hp, 'épée plus efficace (' + m2.hp + ' vs ' + m1.hp + ')');
    });

    it('le temps de recharge empêche de spammer les coups', function () {
      var g = partie();
      var m = g.ents.spawn('sheep', 1, 11, 0.5);
      g.pl.attack(m);
      A.equal(g.pl.attack(m), null, 'second coup refusé immédiatement');
    });

    it('tuer un mouton fait tomber son butin', function () {
      var g = partie();
      g.s.inv.add(I.IRON_SWORD, 1); g.s.selected = 0;
      var m = g.ents.spawn('sheep', 1, 11, 0.5);
      for (var i = 0; i < 20 && !m.dead; i++) {
        g.s.attackCd = 0; m.hurtCd = 0;
        g.pl.attack(m);
      }
      A.ok(m.dead, 'mouton tué');
      var items = g.ents.list.filter(function (e) { return e.type === 'item'; });
      A.ok(items.length >= 2, 'butin tombé (' + items.length + ' objets)');
    });

    it('un zombie inflige des dégâts au joueur', function () {
      var g = partie();
      g.ents.spawn('zombie', 1.0, 11, 0.5);
      var hp0 = g.s.hp;
      for (var i = 0; i < 180; i++) {
        var ev = g.ents.update(1 / 60, g.s, { rand: seededRand(5) });
        if (ev.damage) g.pl.hurt(ev.damage);
      }
      A.ok(g.s.hp < hp0, 'le joueur est blessé (pv=' + g.s.hp + ')');
    });

    it('le butin d\'un zombie est ramassable', function () {
      var g = partie();
      var z = g.ents.spawn('zombie', 0.8, 11, 0.5);
      for (var i = 0; i < 30 && !z.dead; i++) { z.hurtCd = 0; g.ents.damage(z, 6); }
      var pris = 0;
      for (var j = 0; j < 600; j++) {
        var ev = g.ents.update(1 / 60, g.s, { rand: seededRand(7) });
        ev.picked.forEach(function (p) { g.pl.pickUp(p.id, p.n); pris += p.n; });
      }
      A.ok(pris > 0, 'butin ramassé');
      A.ok(g.s.inv.count(I.ROTTEN_FLESH) > 0, 'chair putréfiée en inventaire');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Fonctionnel — progression complète', function () {
    /* La boucle de jeu canonique : bois -> planches -> établi -> outils ->
       pierre -> pioche en pierre. On vérifie que la chaîne entière tient. */
    it('du tronc à la pioche en pierre', function () {
      var g = partie();
      var inv = g.s.inv;

      inv.add(B.LOG, 4);
      A.equal(inv.count(B.LOG), 4, '4 troncs');

      // 1. tronc -> planches
      var grid = new Array(9).fill(0); grid[0] = B.LOG;
      var r = Inv.matchRecipe(grid, 3, 3);
      A.equal(r.id, B.PLANKS);
      inv.remove(B.LOG, 1); inv.add(r.id, r.n);
      A.equal(inv.count(B.PLANKS), 4, '4 planches');

      // 2. planches -> bâtons
      grid = new Array(9).fill(0); grid[0] = B.PLANKS; grid[3] = B.PLANKS;
      r = Inv.matchRecipe(grid, 3, 3);
      A.equal(r.id, I.STICK);
      inv.remove(B.PLANKS, 2); inv.add(r.id, r.n);
      A.equal(inv.count(I.STICK), 4, '4 bâtons');

      // 3. il reste 2 planches : on refait des planches pour l'établi
      inv.remove(B.LOG, 1); inv.add(B.PLANKS, 4);
      grid = new Array(9).fill(0);
      grid[0] = B.PLANKS; grid[1] = B.PLANKS; grid[3] = B.PLANKS; grid[4] = B.PLANKS;
      r = Inv.matchRecipe(grid, 3, 3);
      A.equal(r.id, B.CRAFTING_TABLE, 'établi');
      inv.remove(B.PLANKS, 4); inv.add(r.id, 1);

      // 4. pioche en bois (3x3, donc établi requis)
      inv.remove(B.LOG, 1); inv.add(B.PLANKS, 4);
      grid = new Array(9).fill(0);
      grid[0] = B.PLANKS; grid[1] = B.PLANKS; grid[2] = B.PLANKS;
      grid[4] = I.STICK; grid[7] = I.STICK;
      r = Inv.matchRecipe(grid, 3, 3);
      A.equal(r.id, I.WOOD_PICKAXE, 'pioche en bois');
      inv.remove(B.PLANKS, 3); inv.remove(I.STICK, 2); inv.add(r.id, 1);

      // 5. miner de la pierre avec cette pioche
      g.s.selected = inv.slots.findIndex(function (s) { return s && s.id === I.WOOD_PICKAXE; });
      A.ok(g.s.selected >= 0, 'pioche équipée');
      g.s.pitch = -Math.PI / 2 + 0.01;
      var t = g.pl.aim();
      var res = null;
      for (var i = 0; i < 5000 && !res; i++) res = g.pl.mineTick(1 / 60, t, function () { return 0; });
      A.ok(res, 'pierre minée');
      A.ok(res.drops.some(function (d) { return d.id === B.COBBLE; }), 'du pavé obtenu');

      // 6. pavé -> pioche en pierre
      inv.add(B.COBBLE, 3); inv.add(I.STICK, 2);
      grid = new Array(9).fill(0);
      grid[0] = B.COBBLE; grid[1] = B.COBBLE; grid[2] = B.COBBLE;
      grid[4] = I.STICK; grid[7] = I.STICK;
      r = Inv.matchRecipe(grid, 3, 3);
      A.equal(r.id, I.STONE_PICKAXE, 'pioche en pierre');

      // 7. et elle permet enfin le fer
      A.ok(C.breakTime(B.IRON_ORE, I.STONE_PICKAXE).harvests, 'le fer devient minable');
    });

    it('chaîne du fer : minerai -> fourneau -> lingot -> pioche en fer', function () {
      var inv = Inv.create(36);
      inv.add(B.IRON_ORE, 3);
      inv.add(I.COAL, 3);

      var f = Inv.newFurnace();
      f.input = { id: B.IRON_ORE, n: 3 };
      f.fuel = { id: I.COAL, n: 3 };
      for (var i = 0; i < 500; i++) Inv.tickFurnace(f, 0.1);
      A.equal(f.output.id, I.IRON_INGOT);
      A.equal(f.output.n, 3, '3 lingots');

      inv.remove(B.IRON_ORE, 3);
      inv.add(I.IRON_INGOT, 3);
      inv.add(I.STICK, 2);
      var grid = new Array(9).fill(0);
      grid[0] = I.IRON_INGOT; grid[1] = I.IRON_INGOT; grid[2] = I.IRON_INGOT;
      grid[4] = I.STICK; grid[7] = I.STICK;
      var r = Inv.matchRecipe(grid, 3, 3);
      A.equal(r.id, I.IRON_PICKAXE, 'pioche en fer');
    });

    it('chaîne alimentaire : blé -> pain -> manger', function () {
      var g = partie();
      g.s.hunger = 8;
      g.s.inv.add(I.WHEAT, 3);
      var grid = new Array(9).fill(0);
      grid[0] = I.WHEAT; grid[1] = I.WHEAT; grid[2] = I.WHEAT;
      var r = Inv.matchRecipe(grid, 3, 3);
      g.s.inv.remove(I.WHEAT, 3);
      g.s.inv.add(r.id, r.n);
      g.s.selected = g.s.inv.slots.findIndex(function (s) { return s && s.id === I.BREAD; });
      var t = { x: 3, y: 10, z: 3, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), 'eat');
      A.equal(g.s.hunger, 13, 'faim restaurée');
    });

    it('chaîne mouton : tuer -> viande crue -> cuire -> manger mieux', function () {
      A.equal(Inv.smeltResult(I.RAW_MUTTON), I.COOKED_MUTTON, 'la cuisson est définie');
      var cru = C.def(I.RAW_MUTTON).food, cuit = C.def(I.COOKED_MUTTON).food;
      A.ok(cuit > cru, 'le cuit nourrit plus (' + cru + ' -> ' + cuit + ')');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Fonctionnel — sauvegarde en situation', function () {
    function mockStorage() {
      var m = {};
      return { getItem: function (k) { return k in m ? m[k] : null; },
               setItem: function (k, v) { m[k] = String(v); },
               removeItem: function (k) { delete m[k]; } };
    }

    it('une partie entamée se recharge à l\'identique', function () {
      var w = MC.createWorld(31337);
      w.getChunk(0, 0, true);
      var ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents);
      var col = w.findSpawnColumn();
      var gy = w.groundAt(col[0], col[1], true);
      pl.state.pos = { x: col[0] + 0.5, y: gy + 1, z: col[1] + 0.5 };

      // on construit une petite tour et on remplit l'inventaire
      for (var i = 0; i < 5; i++) w.setBlock(col[0], gy + 1 + i, col[1] + 2, B.BRICK);
      pl.state.inv.add(B.COBBLE, 64);
      pl.state.inv.add(I.IRON_PICKAXE, 1);
      pl.state.hp = 15;
      var etatA = { world: w, player: pl, entities: ents, time: 123, furnaces: {} };

      var st = mockStorage();
      A.ok(MC.Save.save(st, etatA), 'sauvegardé');

      // nouvelle session, même graine
      var w2 = MC.createWorld(31337);
      var ents2 = MC.createEntities(w2);
      var pl2 = MC.createPlayer(w2, ents2);
      var etatB = { world: w2, player: pl2, entities: ents2, time: 0, furnaces: {} };
      A.ok(MC.Save.load(st, etatB), 'rechargé');
      w2.getChunk(Math.floor(col[0] / 16), Math.floor((col[1] + 2) / 16), true);

      for (var j = 0; j < 5; j++)
        A.equal(w2.getBlock(col[0], gy + 1 + j, col[1] + 2), B.BRICK, 'brique ' + j + ' retrouvée');
      A.equal(pl2.state.inv.count(B.COBBLE), 64, 'inventaire restauré');
      A.equal(pl2.state.hp, 15, 'vie restaurée');
      A.close(pl2.state.pos.x, col[0] + 0.5, 0.01, 'position restaurée');
      A.close(etatB.time, 123, 0.1, 'heure restaurée');
    });

    it('la sauvegarde ne stocke que le delta, pas le terrain', function () {
      var w = MC.createWorld(31337);
      for (var cx = -2; cx <= 2; cx++) for (var cz = -2; cz <= 2; cz++) w.getChunk(cx, cz, true);
      var ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents);
      w.setBlock(1, 40, 1, B.BRICK);
      var data = MC.Save.serialize({ world: w, player: pl, entities: ents, time: 0, furnaces: {} });
      A.equal(data.overrides.length, 1, 'un seul bloc stocké malgré 25 chunks générés');
      var taille = JSON.stringify(data).length;
      A.ok(taille < 4000, 'sauvegarde compacte (' + taille + ' octets)');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
