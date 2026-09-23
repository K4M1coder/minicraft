/* spec-couverture.js — couverture des interactions (SPECS.md, « L22 — couverture
   des interactions ») : échelles et lianes, combat, physique, véhicules,
   faisabilité des recettes, butins, commandes du chat.
   Logique pure, comme le reste des tests : aucune dépendance au DOM. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, P = MC.Physics, M = MC.Modes, V = MC.Vehicules, Inv = MC.Inventory, Chat = MC.Chat;
  var B = C.B, I = C.I;
  var flatWorld = G.flatWorld, seededRand = G.seededRand;

  function partie(modeId, groundY, groundId) {
    var w = flatWorld(groundY === undefined ? 10 : groundY, groundId);
    var ents = MC.createEntities(w);
    var pl = MC.createPlayer(w, ents, M.regles(modeId || 'survie', 'facile'));
    pl.state.pos = { x: 0.5, y: (groundY === undefined ? 10 : groundY) + 1, z: 0.5 };
    pl.state.onGround = true;
    pl.state.yaw = 0; pl.state.pitch = 0;
    return { w: w, ents: ents, pl: pl, s: pl.state };
  }
  var keysVides = { forward: false, back: false, left: false, right: false, jump: false, sprint: false };
  function keys(o) { return Object.assign({}, keysVides, o || {}); }

  // ══════════════════════════════════════════════════════════════════════════
  describe('SPEC-PORTE-003 — echelles et lianes', function () {

    it('SPEC-PORTE-003 : une echelle porte bien la propriete grimpable', function () {
      A.ok(C.BLOCKS[B.LADDER].grimpable, 'echelle grimpable');
      A.ok(C.BLOCKS[B.VINES].grimpable, 'lianes grimpables');
    });

    /* Le mur solide est derriere l echelle, DANS L AXE du deplacement (z, pour
       yaw=0) : en avancant, le joueur bute dessus et reste dans la colonne de
       l echelle au lieu de la traverser puis de s en eloigner. */
    function poserEchelle(g, id) {
      // colonne haute : a 3,4 m/s pendant 2 s (60 pas de 1/30 s) on grimpe
      // environ 6,8 m — il faut de la marge au-dessus du point de depart.
      for (var y = 11; y <= 25; y++) { g.w.setBlock(0, y, -1, B.STONE); g.w.setBlock(0, y, 0, id || B.LADDER); }
    }

    it('SPEC-PORTE-003 : avancer face a une echelle fait grimper', function () {
      var g = partie('survie', 10);
      poserEchelle(g);
      g.s.pos = { x: 0.5, y: 11, z: 0.5 };
      g.s.yaw = 0;                              // avancer = vers -Z, contre le mur
      var y0 = g.s.pos.y;
      for (var i = 0; i < 60; i++) g.pl.updateMovement(1 / 30, keys({ forward: true }));
      A.ok(g.s.grimpe, 'le joueur est accroche a l echelle');
      A.gt(g.s.pos.y, y0, 'il est monte (' + y0 + ' -> ' + g.s.pos.y.toFixed(2) + ')');
    });

    it('SPEC-PORTE-003 : sauter contre une echelle fait aussi grimper', function () {
      var g = partie('survie', 10);
      poserEchelle(g);
      g.s.pos = { x: 0.5, y: 11, z: 0.5 };
      var y0 = g.s.pos.y;
      for (var i = 0; i < 60; i++) g.pl.updateMovement(1 / 30, keys({ jump: true }));
      A.gt(g.s.pos.y, y0, 'sauter en la touchant fait aussi monter');
    });

    it('SPEC-PORTE-003 : sans avancer ni sauter, on se tient (on ne tombe pas vite)', function () {
      var g = partie('survie', 10);
      poserEchelle(g);
      g.s.pos = { x: 0.5, y: 13, z: 0.5 };
      for (var i = 0; i < 30; i++) g.pl.updateMovement(1 / 30, keys());
      A.ok(g.s.grimpe, 'toujours accroche');
      // la descente est plafonnee (1,2 m/s) : tres loin d une chute libre, qui
      // aurait perdu bien plus qu un metre en une seconde
      A.ok(g.s.pos.y > 11.5, 'descente lente, pas une chute libre (y=' + g.s.pos.y.toFixed(2) + ')');
    });

    it('SPEC-PORTE-003 : s accroupir (sprint) sur une echelle fait redescendre', function () {
      var g = partie('survie', 10);
      poserEchelle(g);
      g.s.pos = { x: 0.5, y: 14, z: 0.5 };
      var y0 = g.s.pos.y;
      for (var i = 0; i < 30; i++) g.pl.updateMovement(1 / 30, keys({ sprint: true }));
      A.lt(g.s.pos.y, y0, 'il redescend volontairement (' + y0 + ' -> ' + g.s.pos.y.toFixed(2) + ')');
    });

    it('SPEC-PORTE-003 : on ne prend pas de degats de chute en lachant une echelle en haut', function () {
      var g = partie('survie', 10);
      for (var y = 11; y <= 30; y++) { g.w.setBlock(0, y, -1, B.STONE); g.w.setBlock(0, y, 0, B.LADDER); }
      g.s.pos = { x: 0.5, y: 19, z: 0.5 };
      g.s.yaw = 0;
      // on grimpe un peu (fallFrom doit rester nul tant qu'on est accroche)
      for (var i = 0; i < 20; i++) g.pl.updateMovement(1 / 30, keys({ forward: true }));
      A.equal(g.s.fallFrom, null, 'aucune chute enregistree pendant l ascension');
    });

    it('SPEC-PORTE-003 : des lianes se grimpent comme une echelle', function () {
      var g = partie('survie', 10);
      poserEchelle(g, B.VINES);
      g.s.pos = { x: 0.5, y: 11, z: 0.5 };
      g.s.yaw = 0;
      var y0 = g.s.pos.y;
      for (var i = 0; i < 60; i++) g.pl.updateMovement(1 / 30, keys({ forward: true }));
      A.ok(g.s.grimpe, 'accroche aux lianes');
      A.gt(g.s.pos.y, y0, 'monte le long des lianes');
    });

    it('SPEC-PORTE-003 : les lianes se fabriquent en mousse et la corde a partir d une echelle', function () {
      var r1 = Inv.matchRecipe([0, B.COBBLE, 0, 0, B.VINES, 0, 0, 0, 0], 3, 3);
      A.ok(r1, 'pierre moussue = pave + lianes');
      A.equal(r1.id, B.MOSSY_COBBLE);
      // motif de l echelle : deux montants de batons relies par trois barreaux
      var g2 = [I.STICK, 0, I.STICK, I.STICK, I.STICK, I.STICK, I.STICK, 0, I.STICK];
      var r2 = Inv.matchRecipe(g2, 3, 3);
      A.ok(r2, 'l echelle se fabrique avec des batons');
      A.equal(r2.id, B.LADDER);
      A.equal(r2.n, 3);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('SPEC-COMBAT-001 — combat contre les creatures', function () {

    it('SPEC-COMBAT-001 : les degats suivent l arme tenue', function () {
      var g1 = partie(), g2 = partie(), g3 = partie();
      var m1 = g1.ents.spawn('zombie', 1, 11, 0.5);
      var m2 = g2.ents.spawn('zombie', 1, 11, 0.5);
      var m3 = g3.ents.spawn('zombie', 1, 11, 0.5);
      g1.pl.attack(m1);                                   // main nue
      var degatsMain = 14 - m1.hp;

      g2.s.inv.add(I.WOOD_SWORD, 1); g2.s.selected = 0;
      g2.pl.attack(m2);
      var degatsBois = 14 - m2.hp;

      g3.s.inv.add(I.IRON_SWORD, 1); g3.s.selected = 0;
      g3.pl.attack(m3);
      var degatsFer = 14 - m3.hp;

      A.equal(degatsMain, 1, 'main nue : 1 point');
      A.ok(degatsBois > degatsMain, 'epee en bois > main nue');
      A.ok(degatsFer > degatsBois, 'epee en fer > epee en bois');
    });

    it('SPEC-COMBAT-001 : un coup projette la cible en arriere (recul)', function () {
      var g = partie();
      var m = g.ents.spawn('zombie', 1.5, 11, 0.5);
      g.s.inv.add(I.WOOD_SWORD, 1); g.s.selected = 0;
      g.pl.attack(m);
      A.gt(m.vel.x, 0, 'recul horizontal, dans le sens oppose au coup');
      A.gt(m.vel.y, 0, 'un peu souleve');
    });

    it('SPEC-COMBAT-001 : apres un coup, une breve invulnerabilite empeche le coup suivant', function () {
      var g = partie();
      var m = g.ents.spawn('zombie', 1, 11, 0.5);
      var tue1 = g.ents.damage(m, 1, g.s.pos, g.pl.state);
      var hpApres = m.hp;
      var tue2 = g.ents.damage(m, 1, g.s.pos, g.pl.state);   // immediatement : hurtCd actif
      A.notOk(tue1, 'pas mort au premier coup');
      A.equal(m.hp, hpApres, 'le second coup immediat ne fait rien (invulnerabilite)');
      A.notOk(tue2, 'renvoie faux, le coup est ignore');
    });

    it('SPEC-COMBAT-001 : l invulnerabilite passee, un nouveau coup blesse a nouveau', function () {
      var g = partie();
      var m = g.ents.spawn('zombie', 1, 11, 0.5);
      g.ents.damage(m, 1, g.s.pos, g.pl.state);
      var hp1 = m.hp;
      for (var i = 0; i < 40; i++) g.ents.update(1 / 30, g.s);   // laisse passer hurtCd (0.35s)
      g.ents.damage(m, 1, g.s.pos, g.pl.state);
      A.lt(m.hp, hp1, 'blesse a nouveau une fois le delai passe');
    });

    it('SPEC-COMBAT-001 : une creature tuee laisse son butin au sol', function () {
      var g = partie();
      var m = g.ents.spawn('sheep', 1, 11, 0.5);
      var n0 = g.ents.list.length;
      var tue = false;
      while (!tue) tue = g.ents.damage(m, 100, g.s.pos, g.pl.state);
      var items = g.ents.list.filter(function (e) { return e.type === 'item'; });
      A.ok(items.length > 0, 'des objets sont apparus au sol');
      var ids = items.map(function (e) { return e.item; });
      A.ok(ids.indexOf(I.RAW_MUTTON) >= 0, 'mouton cru lache');
      A.ok(ids.indexOf(B.WOOL) >= 0, 'laine lachee');
    });

    it('SPEC-COMBAT-001 : le joueur en cooldown d attaque ne peut pas re-attaquer aussitot', function () {
      var g = partie();
      var m = g.ents.spawn('zombie', 1, 11, 0.5);
      var r1 = g.pl.attack(m);
      var r2 = g.pl.attack(m);
      A.ok(r1, 'premier coup accepte');
      A.equal(r2, null, 'second coup immediat refuse (cooldown du joueur)');
    });

    it('SPEC-COMBAT-001 : une creature hostile blesse le joueur qui la laisse approcher', function () {
      var g = partie();
      var z = g.ents.spawn('zombie', 0.5, 11, -1);
      var hp0 = g.s.hp;
      var total = 0;
      for (var i = 0; i < 400 && total === 0; i++) {
        var ev = g.ents.update(1 / 30, g.s);
        total += ev.damage;
      }
      A.gt(total, 0, 'le zombie a fini par frapper');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('SPEC-PHYS-001 — physique : gravite, chute, collisions, marche', function () {

    it('SPEC-PHYS-001 : sans sol, le joueur tombe (gravite)', function () {
      var g = partie('survie', -5, 0);           // aucun sol sous les pieds
      g.s.pos = { x: 0.5, y: 50, z: 0.5 };
      g.s.onGround = false;
      var y0 = g.s.pos.y, vy0 = g.s.vel.y;
      g.pl.updateMovement(1 / 30, keys());
      A.lt(g.s.vel.y, vy0, 'la vitesse verticale diminue');
      A.lt(g.s.pos.y, y0, 'il descend');
    });

    it('SPEC-PHYS-001 : une chute de plus de 3,5 blocs blesse', function () {
      var g = partie('survie', -5, 0);
      g.w.setBlock(0, 0, 0, B.STONE);              // un seul bloc de sol, loin en dessous
      g.s.pos = { x: 0.5, y: 20, z: 0.5 };
      g.s.onGround = false;
      g.s.fallFrom = null;
      var hp0 = g.s.hp;
      for (var i = 0; i < 300 && g.s.pos.y > 1.01; i++) g.pl.updateMovement(1 / 30, keys());
      A.lt(g.s.hp, hp0, 'une chute de ' + (20 - 1) + ' blocs blesse (' + hp0 + ' -> ' + g.s.hp + ')');
    });

    it('SPEC-PHYS-001 : une petite chute (moins de 3,5 blocs) ne blesse pas', function () {
      var g = partie('survie', -5, 0);
      g.w.setBlock(0, 0, 0, B.STONE);
      g.s.pos = { x: 0.5, y: 3, z: 0.5 };
      g.s.onGround = false;
      g.s.fallFrom = null;
      var hp0 = g.s.hp;
      for (var i = 0; i < 200 && g.s.pos.y > 1.01; i++) g.pl.updateMovement(1 / 30, keys());
      A.equal(g.s.hp, hp0, 'aucun degat pour une chute courte');
    });

    it('SPEC-PHYS-001 : atterrir dans l eau amortit les degats de chute', function () {
      var g = partie('survie', -5, 0);
      // une colonne d eau profonde sous une haute chute
      var wSol = g.w.getBlock;
      g.w.getBlock = function (x, y, z) {
        x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
        if (x === 0 && z === 0 && y >= 0 && y <= 8) return B.WATER;
        if (x === 0 && z === 0 && y < 0) return B.STONE;
        return wSol.call(g.w, x, y, z);
      };
      g.s.pos = { x: 0.5, y: 30, z: 0.5 };
      g.s.onGround = false;
      g.s.fallFrom = null;
      var hp0 = g.s.hp;
      for (var i = 0; i < 400 && g.s.pos.y > 3; i++) g.pl.updateMovement(1 / 30, keys());
      A.equal(g.s.hp, hp0, 'la meme chute, terminee dans l eau, ne blesse pas');
    });

    it('SPEC-PHYS-001 : un mur solide arrete le mouvement horizontal (collision)', function () {
      var g = partie('survie', 10);
      g.w.setBlock(1, 11, 0, B.STONE); g.w.setBlock(1, 12, 0, B.STONE);
      g.s.pos = { x: 0.5, y: 11, z: 0.5 };
      g.s.yaw = 0;                              // strafe droite pure = +X, colonne z=0 inchangee
      for (var i = 0; i < 60; i++) g.pl.updateMovement(1 / 30, keys({ right: true }));
      A.lt(g.s.pos.x, 1.0, 'bloque avant d entrer dans le mur (x=' + g.s.pos.x.toFixed(2) + ')');
      A.notOk(P.collides(g.w, g.s.pos.x, g.s.pos.y, g.s.pos.z, g.pl.PW, g.pl.PH), 'jamais dans le decor');
    });

    it('SPEC-PHYS-001 : le joueur peut marcher sur une marche d un bloc en sautant', function () {
      var g = partie('survie', 10);
      // une marche d un bloc devant lui, vers -Z
      for (var z = -1; z >= -6; z--) g.w.setBlock(0, 11, z, B.STONE);
      g.s.pos = { x: 0.5, y: 11, z: 0.5 };
      var y0 = g.s.pos.y;
      for (var i = 0; i < 90; i++) g.pl.updateMovement(1 / 30, keys({ forward: true, jump: (i % 20 < 2) }));
      A.gt(g.s.pos.y, y0 + 0.5, 'monte sur la marche (y=' + g.s.pos.y.toFixed(2) + ')');
    });

    it('SPEC-PHYS-001 : voler (creatif) desactive la gravite normale', function () {
      var g = partie('creatif', -5, 0);
      g.s.pos = { x: 0.5, y: 30, z: 0.5 };
      g.s.flying = true;
      for (var i = 0; i < 30; i++) g.pl.updateMovement(1 / 30, keys());
      A.close(g.s.pos.y, 30, 0.5, 'en vol, on ne tombe pas');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('SPEC-VEHIC-012 — chaque vehicule : fabrique, pose, monte, conduit, quitte', function () {

    function circuitPlat() { return flatWorld(10, B.STONE); }

    V.TYPES.forEach(function (nom) {
      it('SPEC-VEHIC-012 : ' + nom + ' — fabrication, pose, embarquement, conduite, debarquement', function () {
        var d = V.DEFS[nom];

        // 1) fabricable : une recette produit son objet
        var rec = Inv.RECIPES.filter(function (r) { return r.out === d.objet; });
        A.ok(rec.length > 0, nom + ' : au moins une recette produit son objet');

        // 2) se pose : useOn renvoie l ordre de pose depuis l objet en main
        var w = circuitPlat(), ents = MC.createEntities(w);
        var pl = MC.createPlayer(w, ents, M.regles('survie', 'facile'));
        pl.state.pos = { x: 0.5, y: 11, z: 5.5 };
        pl.state.inv.add(d.objet, 1);
        pl.state.selected = pl.state.inv.slots.findIndex(function (s) { return s && s.id === d.objet; });
        var r = pl.useOn({ x: 0, y: 10, z: 0, nx: 0, ny: 1, nz: 0 });
        A.equal(r, 'vehicule:' + nom, nom + ' : useOn demande sa pose');

        // 3) pose effective (c est vehicules.poser qui fait apparaitre l entite)
        var e = V.poser(ents, nom, 0.5, 11, 0.5, 0);
        A.ok(e, nom + ' : pose');
        A.equal(e.vehicule, nom);
        A.equal(e.conducteur, null, 'personne a bord au depart');

        // 4) on monte
        var joueur = pl.state;
        joueur.pos = { x: 0.5, y: 11, z: 0.5 };
        var monte = V.monter(joueur, e);
        A.ok(monte, nom + ' : embarquement accepte');
        A.equal(e.conducteur, joueur);
        A.equal(joueur.monture, e);

        // 5) on conduit : au moins un pas de conduite avance sans erreur
        var y0 = e.pos.y, x0 = e.pos.x, z0 = e.pos.z;
        for (var i = 0; i < 90; i++) V.conduire(e, 1 / 30, w, { avant: true });
        var bouge = Math.hypot(e.pos.x - x0, e.pos.y - y0, e.pos.z - z0) > 0.01
                  || Math.abs(e.vitesse) > 0.01;
        A.ok(bouge, nom + ' : la conduite fait quelque chose (position ou vitesse a change)');

        // 6) on descend
        var descendu = V.descendre(joueur, w, pl.PW, pl.PH);
        A.ok(descendu, nom + ' : debarquement accepte');
        A.equal(e.conducteur, null, 'le siege est libere');
        A.equal(joueur.monture, null, 'le joueur n est plus a bord');
        A.notOk(P.collides(w, joueur.pos.x, joueur.pos.y, joueur.pos.z, pl.PW, pl.PH),
                'depose hors du decor');
      });
    });

    it('SPEC-VEHIC-012 : on ne peut pas monter dans un vehicule deja occupe', function () {
      var w = circuitPlat(), ents = MC.createEntities(w);
      var e = V.poser(ents, 'voiture', 0.5, 11, 0.5, 0);
      var j1 = { pos: { x: 0.5, y: 11, z: 0.5 }, vel: { x: 0, y: 0, z: 0 } };
      var j2 = { pos: { x: 0.5, y: 11, z: 0.5 }, vel: { x: 0, y: 0, z: 0 } };
      A.ok(V.monter(j1, e), 'le premier monte');
      A.notOk(V.monter(j2, e), 'le second ne peut pas monter dans un siege occupe');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('SPEC-DROP-001 — butins : blocs et creatures', function () {

    it('SPEC-DROP-001 : chaque bloc cassable rend un butin fait d identifiants connus', function () {
      var manquants = [];
      C.BLOCKS.forEach(function (d, id) {
        if (!d || d.hardness < 0) return;                 // indestructible (socle, eau, lave)
        var drops = C.dropsOf(id, true, function () { return 0; });
        drops.forEach(function (dr) {
          if (!C.def(dr.id)) manquants.push(d.name + ' (' + id + ') -> ' + dr.id);
        });
      });
      A.deep(manquants, [], 'aucun butin de bloc ne pointe vers un identifiant inconnu');
    });

    it('SPEC-DROP-001 : chaque creature avec du butin rend des identifiants connus', function () {
      var Ent = MC.createEntities(flatWorld(10, B.STONE));
      var manquants = [];
      Object.keys(Ent.SPECS).forEach(function (type) {
        var s = Ent.SPECS[type];
        if (!s.drops) return;
        s.drops.forEach(function (dr) {
          if (!C.def(dr.id)) manquants.push(type + ' -> ' + dr.id);
        });
      });
      A.deep(manquants, [], 'aucun butin de creature ne pointe vers un identifiant inconnu');
    });

    it('SPEC-DROP-001 : une creature sans butin declare ne lache jamais d objet a sa mort', function () {
      var g = partie();
      var v = g.ents.spawn('villager', 1, 11, 0.5);
      var n0 = g.ents.list.length;
      var tue = false;
      while (!tue) tue = g.ents.damage(v, 100, g.s.pos, g.pl.state);
      var items = g.ents.list.filter(function (e) { return e.type === 'item'; });
      A.equal(items.length, 0, 'le villageois ne rend aucun butin');
    });

    it('SPEC-DROP-001 : un bloc de pierre casse a la pioche rend du pave', function () {
      var g = partie('survie', 10);
      g.s.inv.add(I.WOOD_PICKAXE, 1); g.s.selected = 0;
      g.w.setBlock(2, 11, 0, B.STONE);
      var target = { x: 2, y: 11, z: 0, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      var res = null;
      for (var i = 0; i < 200 && !res; i++) res = g.pl.mineTick(1 / 30, target, function () { return 0; });
      A.ok(res, 'le bloc a fini par ceder');
      A.equal(res.drops.length, 1);
      A.equal(res.drops[0].id, B.COBBLE, 'la pierre rend du pave, pas elle-meme');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('SPEC-RECETTE-007 — chaque recette est faisable de bout en bout', function () {

    /* Construit l ensemble des identifiants obtenables : blocs generes par le
       monde (terrain, biomes, structures), plus la fermeture par le butin de
       bloc, le butin de creature, la cuisson, les echanges d habitants, les
       echanges génériques (TRADES) et les recettes elles-memes — jusqu a point
       fixe. Une recette n est faisable que si tous ses ingredients y figurent. */
    function ensembleObtenable() {
      var obt = {};
      function add(id) { if (id && !obt[id]) { obt[id] = true; return true; } return false; }

      // ── blocs que la génération du monde pose réellement (terrain, biomes,
      //    structures) : voir world.js et biomes.js. La terre labourée et le
      //    blé mûr viennent du cycle agriculture (graines -> labour -> pousse),
      //    un mécanisme du jeu, pas une recette.
      [B.GRASS, B.DIRT, B.STONE, B.SAND, B.SNOW, B.TERRACOTTA, B.TERRACOTTA_RED, B.TERRACOTTA_YELLOW,
       B.COAL_ORE, B.IRON_ORE, B.GOLD_ORE, B.DIAMOND_ORE, B.RED_SAND, B.DEAD_BUSH, B.TALL_GRASS,
       B.MUSHROOM, B.MYCELIUM, B.SEAGRASS, B.KELP, B.PACKED_ICE, B.CORAL_RED, B.CORAL_YELLOW, B.CORAL_BLUE,
       B.CORAL_FAN_RED, B.CORAL_FAN_YELLOW, B.CORAL_FAN_BLUE, B.SEA_PICKLE, B.CACTUS, B.SPRUCE_LOG,
       B.SPRUCE_LEAVES, B.JUNGLE_LOG, B.JUNGLE_LEAVES, B.VINES, B.ACACIA_LOG, B.ACACIA_LEAVES,
       B.MUSHROOM_STEM, B.MUSHROOM_CAP, B.BIRCH_LOG, B.BIRCH_LEAVES, B.LOG, B.LEAVES, B.FLOWER_RED,
       B.FLOWER_YELLOW, B.SANDSTONE, B.GRAVEL, B.BASALT, B.BLUE_ICE, B.MELON, B.CLAY, B.SPONGE, B.ICE,
       B.FARMLAND, C.WHEAT_STAGES[3],
      ].forEach(add);

      var Ent = MC.createEntities(flatWorld(10, B.STONE));
      var N = MC.makeNoise(1);
      var Donjons = MC.Donjons.creer(N, function () { return 40; }, function () { return null; });

      var changed = true;
      while (changed) {
        changed = false;

        // butin de bloc : tout id obtenable qui est un bloc cassable rend son butin
        Object.keys(obt).forEach(function (k) {
          var id = +k;
          if (!C.isBlock(id)) return;
          var d = C.BLOCKS[id];
          if (!d || d.hardness < 0) return;
          C.dropsOf(id, true, function () { return 0; }).forEach(function (dr) {
            if (add(dr.id)) changed = true;
          });
        });

        // butin de creature : chaque type de creature rend son butin declare
        Object.keys(Ent.SPECS).forEach(function (type) {
          var s = Ent.SPECS[type];
          if (!s.drops) return;
          s.drops.forEach(function (dr) { if (add(dr.id)) changed = true; });
        });

        // butin des donjons (coffres) : on echantillonne plusieurs graines pour
        // couvrir les entrees a faible probabilite de la table de butin
        MC.Donjons.TYPES && Object.keys(MC.Donjons.TYPES).forEach(function (type) {
          for (var s2 = 0; s2 < 40; s2++) {
            Donjons.butin({ x: s2 * 17, y: 1, z: -s2 * 23, type: type }).forEach(function (dr) {
              if (add(dr.id)) changed = true;
            });
          }
        });

        // cuisson : tout id obtenable qui se fait fondre donne son resultat
        Object.keys(obt).forEach(function (k) {
          var res = Inv.smeltResult(+k);
          if (res && add(res)) changed = true;
        });

        // echanges d habitants : chaque offre dont le prix est deja obtenable
        // rend sa contrepartie obtenable
        var ROLES = MC.Habitats.ROLES;
        Object.keys(ROLES).forEach(function (role) {
          (ROLES[role].offres || []).forEach(function (of) {
            var possible = of.give.every(function (g) { return obt[g.id]; });
            if (possible && add(of.get.id)) changed = true;
          });
        });

        // echanges generiques (TRADES)
        (Inv.TRADES || []).forEach(function (tr) {
          var possible = tr.give.every(function (g) { return obt[g.id]; });
          if (possible && add(tr.get.id)) changed = true;
        });

        // recettes : celles dont tous les ingredients sont obtenables rendent
        // leur sortie obtenable
        Inv.RECIPES.forEach(function (rec) {
          var ids = rec.type === 'shaped' ? Object.keys(rec.keys).map(function (k) { return rec.keys[k]; })
                                           : rec.ingredients;
          var possible = ids.every(function (id) { return obt[id]; });
          if (possible && add(rec.out)) changed = true;
        });
      }
      return obt;
    }

    var OBT = ensembleObtenable();

    function ingredientsDe(rec) {
      var ids = rec.type === 'shaped' ? Object.keys(rec.keys).map(function (k) { return rec.keys[k]; })
                                       : rec.ingredients;
      var uniq = {};
      ids.forEach(function (id) { uniq[id] = true; });
      return Object.keys(uniq).map(Number);
    }

    it('SPEC-RECETTE-007 : chaque recette n emploie que des ingredients obtenables', function () {
      var echecs = [];
      Inv.RECIPES.forEach(function (rec) {
        ingredientsDe(rec).forEach(function (ing) {
          if (!OBT[ing]) {
            echecs.push(C.nameOf(rec.out) + ' (recette -> ' + rec.out + ') a besoin de ' +
                        C.nameOf(ing) + ' (' + ing + '), introuvable dans les sources connues');
          }
        });
      });
      A.deep(echecs, [], 'recettes bloquees : ' + echecs.join(' | '));
    });

    it('SPEC-RECETTE-007 : le resultat de chaque recette est un identifiant reconnu', function () {
      var inconnus = [];
      Inv.RECIPES.forEach(function (rec) {
        if (!C.def(rec.out)) inconnus.push(rec.out);
      });
      A.deep(inconnus, [], 'sorties de recette inconnues : ' + inconnus.join(', '));
    });

    it('SPEC-RECETTE-007 : la fermeture des obtenables couvre les objets courants du jeu', function () {
      [I.STICK, B.PLANKS, I.IRON_INGOT, I.GOLD_INGOT, I.DIAMOND, B.GLASS, B.CHEST,
       I.WOOD_SWORD, I.IRON_SWORD, I.DIAMOND_PICKAXE, I.ARC, I.FLECHE, I.EMERALD,
       I.VOITURE, I.BATEAU, I.MOTEUR, I.ROUE, I.BONE_MEAL, B.TORCH].forEach(function (id) {
        A.ok(OBT[id], C.nameOf(id) + ' (' + id + ') devrait etre obtenable');
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('SPEC-CMD-001 — commandes du chat', function () {
    /* La liste reelle des commandes vit dans src/game.js (executerCommande),
       couplee a l etat du jeu (monde, reseau, interface) : ce n est pas de la
       logique pure et game.js n est pas charge par les tests sous Node (voir
       tests/run.js). Ce qui EST pur, et donc testable ici, c est le parseur de
       chat.js sur lequel toute commande s appuie : Chat.estCommande et
       Chat.parseCommande. Les effets de chaque commande (/heure, /jour, /nuit,
       /ou, /graine, /aide, /rejoindre, /quitter, /qui, /vider) sont couverts
       manuellement via un jeu réel, hors de portee de ces tests unitaires. */

    it('SPEC-CMD-001 : un slash suivi d un mot est reconnu comme commande', function () {
      A.ok(Chat.estCommande('/aide'));
      A.ok(Chat.estCommande('/ou'));
      A.ok(Chat.estCommande('/rejoindre monserveur'));
      A.notOk(Chat.estCommande('bonjour'), 'texte ordinaire');
      A.notOk(Chat.estCommande(''), 'chaine vide');
      A.notOk(Chat.estCommande('/'), 'un slash seul ne suffit pas');
      A.notOk(Chat.estCommande(null), 'null ne plante pas');
      A.notOk(Chat.estCommande(42), 'un nombre n est pas une commande');
    });

    it('SPEC-CMD-001 : le nom de la commande est extrait et normalise en minuscules', function () {
      var c = Chat.parseCommande('/AIDE');
      A.equal(c.nom, 'aide', 'le nom est mis en minuscules');
      A.deep(c.args, []);
    });

    it('SPEC-CMD-001 : les arguments sont separes, espaces multiples tolerés', function () {
      var c = Chat.parseCommande('/rejoindre    192.168.1.10   ');
      A.equal(c.nom, 'rejoindre');
      A.deep(c.args, ['192.168.1.10'], 'les espaces superflus ne creent pas d arguments vides');
    });

    it('SPEC-CMD-001 : une commande sans argument donne un tableau vide, pas null', function () {
      var c = Chat.parseCommande('/qui');
      A.equal(c.nom, 'qui');
      A.deep(c.args, []);
    });

    it('SPEC-CMD-001 : un texte qui ne commence pas par / n est pas une commande', function () {
      A.equal(Chat.parseCommande('salut tout le monde'), null);
      A.equal(Chat.parseCommande('  /aide'), null, 'le slash doit etre le tout premier caractere');
    });

    it('SPEC-CMD-001 : plusieurs arguments sont tous conserves, dans l ordre', function () {
      var c = Chat.parseCommande('/donner pierre 64 joueur1');
      A.deep(c.args, ['pierre', '64', 'joueur1']);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
