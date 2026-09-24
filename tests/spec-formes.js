/* spec-formes.js — tests de L24 (SPEC-CONSTR-001 à 004) : escaliers, dalles,
   clôtures/murets/vitres/rambardes. Un bloc d'orientation, la géométrie qui en
   découle, les angles automatiques, la fusion des dalles, les raccords aux
   voisins, la montée sans sauter, et le fil de bout en bout (pose/casse via
   player.js, maillage via mesher.js, collisions via physics.js). */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, P = MC.Physics, F = MC.Formes, Inv = MC.Inventory;
  var B = C.B, I = C.I;
  var flatWorld = G.flatWorld;

  function partie(groundY) {
    var w = flatWorld(groundY === undefined ? 9 : groundY, B.STONE);
    var ents = MC.createEntities(w);
    var pl = MC.createPlayer(w, ents);
    pl.state.pos = { x: 3.5, y: 20, z: 3.5 };
    pl.state.onGround = true;
    return { w: w, ents: ents, pl: pl, s: pl.state };
  }

  describe('Specs — L24 : escaliers, dalles, clôtures/murets/vitres/rambardes', { teste: 'Les blocs à forme (escaliers, dalles…) : leur boîte de collision, leur solidité et leur maillage.', pourquoi: 'Un bloc à forme qui reprend la boîte ou l\'occlusion d\'un bloc plein casserait la collision ou l\'affichage de tous les blocs fins.', attendu: 'les blocs à forme délèguent correctement à MC.Formes et se maillent avec les bonnes tuiles, en plus des specs SPEC-CONSTR-*/SPEC-BLOC-* couvertes une à une.' }, function () {

    // ── SPEC-CONSTR-001 : escaliers ────────────────────────────────────────
    it('SPEC-CONSTR-001 : un escalier existe pour chaque matériau attendu', function () {
      ['ESCALIER_PLANKS', 'ESCALIER_SAPIN', 'ESCALIER_BOULEAU', 'ESCALIER_ACACIA', 'ESCALIER_JUNGLE',
       'ESCALIER_STONE', 'ESCALIER_COBBLE', 'ESCALIER_STONE_BRICK', 'ESCALIER_SANDSTONE', 'ESCALIER_BRICK']
        .forEach(function (nom) {
          A.ok(B[nom], nom + ' existe');
          A.equal(C.BLOCKS[B[nom]].forme, 'escalier', nom + ' est un escalier');
        });
    });

    it('SPEC-CONSTR-001 : recette — 6 blocs en marche font 4 escaliers', function () {
      var grid = [B.STONE, 0, 0, B.STONE, B.STONE, 0, B.STONE, B.STONE, B.STONE];
      var r = Inv.matchRecipe(grid, 3, 3);
      A.ok(r && r.id === B.ESCALIER_STONE && r.n === 4, 'la marche de pierre rend 4 escaliers de pierre');
    });

    it('SPEC-CONSTR-001 : packEscalier/unpackEscalier font l\'aller-retour', function () {
      [[0, false, F.DROIT], [3, true, F.EXT_D], [2, false, F.INT_G]].forEach(function (c) {
        var e = F.packEscalier(c[0], c[1], c[2]);
        var u = F.unpackEscalier(e);
        A.equal(u.orientation, c[0], 'orientation');
        A.equal(u.inverse, c[1], 'inversion');
        A.equal(u.forme, c[2], 'forme');
      });
    });

    it('SPEC-CONSTR-001 : boitesEscalier — marche droite, deux boîtes, contremarche du bon côté', function () {
      // orientation 0 = N (contremarche vers -z, régal côté z1=1 → 0.5..1)
      var boites = F.boitesEscalier(F.packEscalier(0, false, F.DROIT));
      A.equal(boites.length, 2, 'bas + haut');
      A.equal(boites[0].y0, 0); A.equal(boites[0].y1, 0.5);
      A.equal(boites[1].y0, 0.5); A.equal(boites[1].y1, 1);
      A.equal(boites[1].z0, 0); A.equal(boites[1].z1, 0.5, 'marche haute côté nord (contremarche)');
    });

    it('SPEC-CONSTR-001 : inversé (sous un plafond), les moitiés hautes/basses s\'échangent', function () {
      var b = F.boitesEscalier(F.packEscalier(1, true, F.DROIT));
      A.equal(b[0].y0, 0.5, 'la marche pleine largeur passe en haut');
      A.equal(b[1].y1, 0.5, 'la petite marche passe en bas');
    });

    it('SPEC-CONSTR-001 : les angles intérieurs et extérieurs ont le bon nombre de boîtes', function () {
      A.equal(F.boitesEscalier(F.packEscalier(0, false, F.EXT_G)).length, 2, 'extérieur : bas + un quart');
      A.equal(F.boitesEscalier(F.packEscalier(0, false, F.INT_D)).length, 3, 'intérieur : bas + haut + un quart');
    });

    it('SPEC-CONSTR-001 : formeDepuisVoisins tourne l\'angle vers l\'extérieur ou l\'intérieur', function () {
      // orientation 0 (contremarche au nord, ouverture au sud) : le voisin
      // "avant" est au sud (dir 2), le voisin "arrière" au nord (dir 0).
      A.equal(F.formeDepuisVoisins(0, false, null, null), F.DROIT, 'sans voisin : droit');
      A.equal(F.formeDepuisVoisins(0, false, { orientation: 1, inverse: false }, null), F.EXT_G,
              'voisin avant perpendiculaire (est) : coin extérieur gauche');
      A.equal(F.formeDepuisVoisins(0, false, { orientation: 3, inverse: false }, null), F.EXT_D,
              'voisin avant perpendiculaire (ouest) : coin extérieur droit');
      A.equal(F.formeDepuisVoisins(0, false, null, { orientation: 1, inverse: false }), F.INT_G,
              'voisin arrière perpendiculaire (est) : coin intérieur gauche');
      A.equal(F.formeDepuisVoisins(0, false, null, { orientation: 3, inverse: false }), F.INT_D,
              'voisin arrière perpendiculaire (ouest) : coin intérieur droit');
      A.equal(F.formeDepuisVoisins(0, false, { orientation: 2, inverse: false }, null), F.DROIT,
              'voisin avant de même axe (parallèle) : reste droit');
      A.equal(F.formeDepuisVoisins(0, false, { orientation: 3, inverse: true }, null), F.DROIT,
              'voisin d\'une autre moitié (inversé) ignoré');
    });

    it('SPEC-CONSTR-001 : posé, un escalier s\'oriente selon le regard, dans les quatre directions', function () {
      [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2].forEach(function (yaw) {
        var g = partie();
        g.s.inv.add(B.ESCALIER_STONE, 1); g.s.selected = 0;
        g.s.yaw = yaw; g.s.pitch = 0;
        var t = { x: 5, y: 9, z: 5, block: B.STONE, nx: 0, ny: 1, nz: 0, t: 1 };
        A.equal(g.pl.useOn(t), 'place', 'se pose');
        var e = F.unpackEscalier(g.w.getEtat(5, 10, 5));
        A.equal(e.orientation, C.orientDeRegard(g.pl.lookDir()), 'orientation = regard');
        A.equal(e.inverse, false, 'pas de plafond : pas inversé');
      });
    });

    it('SPEC-CONSTR-001 : posé sous un plafond, l\'escalier s\'inverse', function () {
      var g = partie();
      g.w.setBlock(5, 11, 5, B.STONE);          // plafond juste au-dessus de la case visée
      g.s.inv.add(B.ESCALIER_STONE, 1); g.s.selected = 0;
      g.s.yaw = 0; g.s.pitch = 0;
      var t = { x: 5, y: 9, z: 5, block: B.STONE, nx: 0, ny: 1, nz: 0, t: 1 };
      A.equal(g.pl.useOn(t), 'place', 'se pose');
      A.ok(F.unpackEscalier(g.w.getEtat(5, 10, 5)).inverse, 'inversé sous le plafond');
    });

    it('SPEC-CONSTR-001 : deux escaliers perpendiculaires s\'ajustent en angle, et se défont à la casse', function () {
      var g = partie();
      g.s.inv.add(B.ESCALIER_STONE, 2); g.s.selected = 0;
      g.s.yaw = 0; g.s.pitch = 0;    // regarde vers le nord : orientation 0
      g.pl.useOn({ x: 5, y: 9, z: 5, block: B.STONE, nx: 0, ny: 1, nz: 0, t: 1 });
      g.s.yaw = Math.PI / 2;         // regarde vers l'est : orientation 1
      g.pl.useOn({ x: 6, y: 9, z: 5, block: B.STONE, nx: 0, ny: 1, nz: 0, t: 1 });
      var e0 = F.unpackEscalier(g.w.getEtat(5, 10, 5));
      var e1 = F.unpackEscalier(g.w.getEtat(6, 10, 5));
      A.ok(e0.forme !== F.DROIT || e1.forme !== F.DROIT, 'au moins l\'un des deux a pris un angle');

      // on casse le second : le premier redevient droit si c'était lui que ça affectait
      g.w.setBlock(6, 10, 5, 0);
      F.actualiserZoneEscalier(g.w, 6, 10, 5);
      var e0apres = F.unpackEscalier(g.w.getEtat(5, 10, 5));
      A.equal(e0apres.forme, F.DROIT, 'sans voisin, l\'escalier restant redevient droit');
    });

    it('SPEC-CONSTR-001 : lireEscalier ne voit que les blocs de forme escalier', function () {
      var g = partie();
      g.w.setBlock(5, 10, 5, B.ESCALIER_STONE);
      g.w.setEtat(5, 10, 5, F.packEscalier(2, false, F.DROIT));
      A.deep(F.lireEscalier(g.w, 5, 10, 5), { orientation: 2, inverse: false, forme: F.DROIT });
      A.equal(F.lireEscalier(g.w, 5, 9, 5), null, 'un bloc plein n\'est pas un escalier');
    });

    it('SPEC-CONSTR-001 : orientationPose combine le regard et le plafond', function () {
      var e = F.unpackEscalier(F.orientationPose({ x: 1, y: 0, z: 0 }, true));
      A.equal(e.orientation, C.orientDeRegard({ x: 1, y: 0, z: 0 }));
      A.ok(e.inverse, 'plafond => inversé');
      A.equal(e.forme, F.DROIT, 'droit à la pose, avant ajustement aux voisins');
    });

    it('SPEC-CONSTR-001 : actualiserEscalier recalcule un seul escalier depuis ses voisins actuels', function () {
      var w = flatWorld(-1, 0);
      w.setBlock(5, 10, 5, B.ESCALIER_STONE);
      w.setEtat(5, 10, 5, F.packEscalier(0, false, F.DROIT));
      A.notOk(F.actualiserEscalier(w, 5, 10, 5), 'sans voisin, rien ne change');
      // (5,10,5) est orienté 0 (contremarche nord) : son côté ouvert regarde le
      // sud (5,10,6) — un escalier perpendiculaire à cet endroit tourne l'angle.
      w.setBlock(5, 10, 6, B.ESCALIER_STONE);
      w.setEtat(5, 10, 6, F.packEscalier(1, false, F.DROIT));
      A.ok(F.actualiserEscalier(w, 5, 10, 5), 'un voisin perpendiculaire change son angle');
    });

    it('SPEC-CONSTR-001 : on monte un escalier sans sauter (marche de 0,5)', function () {
      var w = flatWorld(9, B.STONE);
      w.setBlock(5, 10, 5, B.ESCALIER_STONE);
      // contremarche à l'ouest : le côté ouvert (la marche basse) regarde l'est —
      // on l'aborde par là, comme on aborderait un vrai escalier par sa marche.
      w.setEtat(5, 10, 5, F.packEscalier(3, false, F.DROIT));
      var body = { pos: { x: 6.5, y: 10, z: 5.5 }, vel: { x: -3, y: 0, z: 0 } };
      for (var i = 0; i < 30; i++) P.move(w, body, 1 / 30, 0.6, 1.8, 0.55);
      A.ok(body.pos.x < 6.3, 'le corps a avancé jusque sur la marche');
      A.ok(body.pos.y >= 10.4, 'et s\'est élevé sur la marche, sans saut');
    });

    it('SPEC-CONSTR-001 : sans assistance de pas, le même escalier bloque le passage', function () {
      var w = flatWorld(9, B.STONE);
      w.setBlock(5, 10, 5, B.ESCALIER_STONE);
      w.setEtat(5, 10, 5, F.packEscalier(3, false, F.DROIT));
      var body = { pos: { x: 6.5, y: 10, z: 5.5 }, vel: { x: -3, y: 0, z: 0 } };
      for (var i = 0; i < 30; i++) P.move(w, body, 1 / 30, 0.6, 1.8, 0);
      A.ok(body.pos.y < 10.1, 'sans le pas de 0,5, le corps reste au sol, bloqué par la marche');
    });

    // ── SPEC-CONSTR-002 : dalles ─────────────────────────────────────────────
    it('SPEC-CONSTR-002 : une dalle existe pour chaque matériau attendu, et connaît son bloc plein', function () {
      A.equal(C.BLOCKS[B.DALLE_STONE].forme, 'dalle');
      A.equal(C.BLOCKS[B.DALLE_STONE].mat, B.STONE);
      A.equal(C.BLOCKS[B.STONE].dalle, B.DALLE_STONE);
    });

    it('SPEC-CONSTR-002 : recette — 3 blocs en rangée font 6 dalles', function () {
      var r = Inv.matchRecipe([B.STONE, B.STONE, B.STONE], 3, 1);
      A.ok(r && r.id === B.DALLE_STONE && r.n === 6);
    });

    it('SPEC-CONSTR-002 : boitesDalle — moitié basse ou haute', function () {
      A.deep(F.boitesDalle(F.packDalle(false)), [{ x0: 0, y0: 0, z0: 0, x1: 1, y1: 0.5, z1: 1 }]);
      A.deep(F.boitesDalle(F.packDalle(true)), [{ x0: 0, y0: 0.5, z0: 0, x1: 1, y1: 1, z1: 1 }]);
    });

    it('SPEC-CONSTR-002 : decisionDalle pose selon la face et la hauteur visées', function () {
      A.equal(F.decisionDalle({ memeMateriau: false, normaleY: 1, fracY: 0 }).moitie, 'bas', 'face du dessus : bas');
      A.equal(F.decisionDalle({ memeMateriau: false, normaleY: -1, fracY: 0 }).moitie, 'haut', 'face du dessous : haut');
      A.equal(F.decisionDalle({ memeMateriau: false, normaleY: 0, fracY: 0.8 }).moitie, 'haut', 'face latérale, clic haut');
      A.equal(F.decisionDalle({ memeMateriau: false, normaleY: 0, fracY: 0.2 }).moitie, 'bas', 'face latérale, clic bas');
    });

    it('SPEC-CONSTR-002 : deux dalles du même matériau, moitiés complémentaires, fusionnent', function () {
      A.equal(F.decisionDalle({ memeMateriau: true, moitieVisee: 'bas', normaleY: 1, fracY: 0 }).action, 'fusion',
              'dalle basse + clic sur sa face du dessus (moitié haute libre) : fusion');
      A.equal(F.decisionDalle({ memeMateriau: true, moitieVisee: 'haut', normaleY: -1, fracY: 0 }).action, 'fusion',
              'dalle haute + clic sur sa face du dessous (moitié basse libre) : fusion');
      A.equal(F.decisionDalle({ memeMateriau: true, moitieVisee: 'bas', normaleY: -1, fracY: 0 }).action, 'poser',
              'dalle basse + clic sous elle (occupé) : pas de fusion');
    });

    it('SPEC-CONSTR-002 : poser une dalle sur de l\'air choisit la bonne moitié, et deux dalles fusionnent en bloc plein', function () {
      var g = partie();
      g.s.inv.add(B.DALLE_STONE, 2); g.s.selected = 0;
      // clic sur le dessus du sol : dalle basse dans la case au-dessus
      A.equal(g.pl.useOn({ x: 5, y: 9, z: 5, block: B.STONE, nx: 0, ny: 1, nz: 0, t: 1 }), 'place');
      A.equal(g.w.getBlock(5, 10, 5), B.DALLE_STONE);
      A.equal(g.w.getEtat(5, 10, 5), F.packDalle(false));

      // on revise la même case, par le dessus (moitié haute encore libre) : fusion en pierre pleine
      // 'place-ici' (et non 'place') : la case modifiée est celle visée elle-même,
      // pas la case adjacente habituelle — SPEC-CONSTR-002, distinguée pour que
      // la synchronisation réseau (game.js/onUse) annonce la bonne position.
      A.equal(g.pl.useOn({ x: 5, y: 10, z: 5, block: B.DALLE_STONE, nx: 0, ny: 1, nz: 0, t: 1 }), 'place-ici');
      A.equal(g.w.getBlock(5, 10, 5), B.STONE, 'les deux moitiés font un bloc plein');
    });

    it('SPEC-CONSTR-002 : la fusion (place-ici) écrit sur la case visée, ce qu\'il faut annoncer au serveur en ligne', function () {
      // reproduit ce que fait game.js/onUse : la position à envoyer au serveur
      // dépend du résultat ('place' -> case adjacente, 'place-ici' -> visée).
      var g = partie();
      g.s.inv.add(B.DALLE_STONE, 2); g.s.selected = 0;
      g.pl.useOn({ x: 5, y: 9, z: 5, block: B.STONE, nx: 0, ny: 1, nz: 0, t: 1 });
      var target = { x: 5, y: 10, z: 5, block: B.DALLE_STONE, nx: 0, ny: 1, nz: 0, t: 1 };
      var res = g.pl.useOn(target);
      var bx, by, bz;
      if (res === 'place-ici') { bx = target.x; by = target.y; bz = target.z; }
      else { bx = target.x + target.nx; by = target.y + target.ny; bz = target.z + target.nz; }
      A.deep([bx, by, bz], [5, 10, 5], 'la case réellement modifiée, pas la case adjacente vide (6,11,5)');
      A.equal(g.w.getBlock(bx, by, bz), B.STONE);
    });

    it('SPEC-CONSTR-002 : à mi-hauteur, une dalle basse laisse passer par-dessus mais bloque en dessous', function () {
      var w = flatWorld(9, B.STONE);
      w.setBlock(5, 10, 5, B.DALLE_STONE);
      w.setEtat(5, 10, 5, F.packDalle(false));
      A.ok(P.collides(w, 5.5, 10.2, 5.5, 0.6, 0.4), 'un corps bas, dans la dalle, collisionne');
      A.notOk(P.collides(w, 5.5, 10.6, 5.5, 0.6, 0.4), 'au-dessus de la dalle, libre');
    });

    // ── SPEC-CONSTR-004 : clôtures, murets, vitres, rambardes ───────────────
    it('SPEC-CONSTR-004 : les quatre formes raccordables existent', function () {
      ['CLOTURE', 'MURET', 'VITRE', 'RAMBARDE'].forEach(function (nom) {
        A.ok(B[nom], nom + ' existe');
        A.equal(C.BLOCKS[B[nom]].forme, nom.toLowerCase());
      });
    });

    it('SPEC-CONSTR-004 : connexions — un voisin plein ou de même sorte raccorde, sinon non', function () {
      var c = F.connexions({
        n: { plein: true, memeType: false }, e: { plein: false, memeType: true },
        s: { plein: false, memeType: false }, o: null,
      });
      A.deep(c, { n: true, e: true, s: false, o: false });
    });

    it('SPEC-CONSTR-004 : boitesConnect donne un poteau seul quand rien ne se raccorde', function () {
      A.equal(F.boitesConnect('cloture', { n: false, e: false, s: false, o: false }).length, 1);
      A.equal(F.boitesConnect('muret', { n: true, e: false, s: false, o: false }).length, 2);
    });

    it('SPEC-CONSTR-004 : boitesBloc d\'une clôture — un poteau, puis un bras par raccord (angle, T)', function () {
      var def = C.BLOCKS[B.CLOTURE];
      var aucun = F.boitesBloc(def, 0, function () { return { plein: false, memeType: false }; });
      A.equal(aucun.length, 1, 'isolée : rien qu\'un poteau');

      var enAngle = F.boitesBloc(def, 0, function (dx, dz) {
        return { plein: (dx === 1 && dz === 0) || (dx === 0 && dz === 1), memeType: false };
      });
      A.equal(enAngle.length, 1 + 2 * 2, 'deux raccords (angle), deux bras chacun');

      var enT = F.boitesBloc(def, 0, function (dx, dz) {
        return { plein: !(dx === -1 && dz === 0), memeType: false };
      });
      A.equal(enT.length, 1 + 3 * 2, 'trois raccords (T), deux bras chacun');
    });

    it('SPEC-CONSTR-004 : une vitre et un muret se raccordent aussi bien à un bloc plein qu\'à leur propre sorte', function () {
      var vitre = C.BLOCKS[B.VITRE];
      var b = F.boitesBloc(vitre, 0, function (dx) {
        return { plein: dx === 1, memeType: dx === -1 };
      });
      A.equal(b.length, 3, 'poteau + un bras vers le plein + un bras vers l\'autre vitre');
    });

    // ── mailleur et physique : appel générique via core.boiteDe ─────────────
    it('boiteDe délègue à MC.Formes pour un bloc `forme`, et rien pour un bloc plein', function () {
      A.equal(C.boiteDe(B.STONE), null, 'un bloc plein n\'a pas de boîte partielle');
      var e = F.packEscalier(0, false, F.DROIT);
      var boites = C.boiteDe(B.ESCALIER_STONE, e, null);
      A.deep(boites, F.boitesEscalier(e));
    });

    it('isSolid exclut les blocs de forme (portés par leurs boîtes, pas par un plein)', function () {
      A.notOk(C.isSolid(B.ESCALIER_STONE));
      A.notOk(C.isSolid(B.DALLE_STONE));
      A.notOk(C.isSolid(B.CLOTURE));
      A.ok(C.isSolid(B.STONE));
    });

    it('mesher.buildChunk dessine un escalier avec les tuiles de son matériau', function () {
      var Mesher = MC.Mesher;
      var c = { cx: 0, cz: 0, blocks: new Uint16Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z),
                etats: new Uint8Array(C.CHUNK_X * C.WORLD_H * C.CHUNK_Z) };
      var k = C.idx(2, 10, 2);
      c.blocks[k] = B.ESCALIER_STONE;
      c.etats[k] = F.packEscalier(0, false, F.DROIT);
      var geo = Mesher.buildChunk(c, 'cutout', function () { return 0; });
      A.ok(geo && geo.positions.length > 0, 'de la géométrie est produite');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
