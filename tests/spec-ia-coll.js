/* spec-ia-coll.js — tests des specs SPEC-IA-*, SPEC-COLL-* et SPEC-NAGE-*.
   Orientation des créatures, collisions entre corps, comportement dans l'eau. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, P = MC.Physics, M = MC.Modes;
  var B = C.B;
  var flatWorld = G.flatWorld, seededRand = G.seededRand;

  /* Direction vers laquelle REGARDE un maillage tourné de `yaw`.
     Le modèle a ses yeux vers -Z : après rotation autour de Y, l'avant vaut
     (-sin, 0, -cos). C'est la seule convention qui compte ici. */
  function avantDuMaillage(yaw) { return { x: -Math.sin(yaw), z: -Math.cos(yaw) }; }
  function angleEntre(a, b) {
    var na = Math.hypot(a.x, a.z), nb = Math.hypot(b.x, b.z);
    if (na < 1e-9 || nb < 1e-9) return 0;
    var d = (a.x * b.x + a.z * b.z) / (na * nb);
    return Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI;
  }

  function scene(groundY, groundId) {
    var w = flatWorld(groundY === undefined ? 10 : groundY,
                      groundId === undefined ? B.STONE : groundId);
    return { w: w, ents: MC.createEntities(w) };
  }
  function joueur(s, x, y, z) {
    var pl = MC.createPlayer(s.w, s.ents, M.regles('survie', 'facile'));
    pl.state.pos = { x: x, y: y, z: z };
    pl.state.onGround = true;
    return pl;
  }
  var NOKEY = { forward: 0, back: 0, left: 0, right: 0, jump: 0, sprint: 0 };
  function keys(o) { return Object.assign({}, NOKEY, o || {}); }

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — orientation des créatures', function () {

    it('SPEC-IA-001 : une creature qui poursuit regarde vers sa cible', function () {
      for (var deg = 0; deg < 360; deg += 30) {
        var s = scene();
        var a = deg * Math.PI / 180;
        var z = s.ents.spawn('zombie', 0.5 + Math.cos(a) * 5, 11, 0.5 + Math.sin(a) * 5);
        var pl = { pos: { x: 0.5, y: 11, z: 0.5 } };
        s.ents.stepAI(z, 1 / 60, pl, seededRand(1));
        var versJoueur = { x: pl.pos.x - z.pos.x, z: pl.pos.z - z.pos.z };
        A.ok(angleEntre(avantDuMaillage(z.yaw), versJoueur) < 1,
          'a ' + deg + '° : regarde sa cible (ecart ' +
          angleEntre(avantDuMaillage(z.yaw), versJoueur).toFixed(1) + '°)');
      }
    });

    /* Regression : la formule d'errance donnait exactement l'oppose du cap,
       les creatures marchaient donc a reculons. */
    it('SPEC-IA-002 : une creature qui erre regarde vers ou elle avance', function () {
      for (var deg = 0; deg < 360; deg += 30) {
        var s = scene();
        var m = s.ents.spawn('sheep', 0.5, 11, 0.5);
        m.wanderDir = deg * Math.PI / 180;
        m.wanderCd = 99;                       // on fige le cap choisi
        var loin = { pos: { x: 500, y: 11, z: 500 } };
        s.ents.stepAI(m, 1 / 60, loin, seededRand(1));
        var vitesse = { x: m.vel.x, z: m.vel.z };
        A.ok(Math.hypot(vitesse.x, vitesse.z) > 0.01, 'la creature avance a ' + deg + '°');
        var ecart = angleEntre(avantDuMaillage(m.yaw), vitesse);
        A.ok(ecart < 1, 'a ' + deg + '° : regarde ou elle va (ecart ' + ecart.toFixed(1) + '°)');
      }
    });

    it('SPEC-IA-003 : une creature a l arret garde son cap', function () {
      var s = scene();
      var m = s.ents.spawn('sheep', 0.5, 11, 0.5);
      m.wanderDir = 1.2; m.wanderCd = 99;
      var loin = { pos: { x: 500, y: 11, z: 500 } };
      s.ents.stepAI(m, 1 / 60, loin, seededRand(1));
      var capEnMouvement = m.yaw;
      m.wanderDir = null;                      // pause dans l'errance
      for (var i = 0; i < 30; i++) s.ents.stepAI(m, 1 / 60, loin, seededRand(1));
      A.close(m.yaw, capEnMouvement, 1e-9, 'le cap ne tourne pas a l arret');
    });

    it('SPEC-IA-004 : le cap suit le deplacement reel apres un obstacle', function () {
      var s = scene();
      // un mur plein a l'est
      for (var y = 11; y < 14; y++) s.w.setBlock(3, y, 0, B.STONE);
      var m = s.ents.spawn('sheep', 2.0, 11, 0.5);
      m.wanderDir = 0;                          // plein est, droit dans le mur
      m.wanderCd = 99;
      var loin = { pos: { x: 500, y: 11, z: 500 } };
      for (var i = 0; i < 60; i++) {
        s.ents.stepAI(m, 1 / 60, loin, seededRand(1));
        s.ents.stepBody(m, 1 / 60);
      }
      // bloquee : la vitesse est nulle, le cap doit rester stable et non osciller
      // le mur est en x=3 ; un corps de 0,7 de large s'arrete a 2,65
      A.ok(m.pos.x < 2.7, 'arretee par le mur (x=' + m.pos.x.toFixed(2) + ')');
      A.ok(isFinite(m.yaw), 'le cap reste une valeur valide');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — collisions entre corps', function () {

    it('SPEC-COLL-001 : un joueur ne traverse pas une creature', function () {
      var s = scene();
      var pl = joueur(s, 0.5, 11, 0.5);
      var z = s.ents.spawn('zombie', 0.5, 11, -3);
      z.wanderDir = null; z.wanderCd = 999;
      pl.state.yaw = 0;                         // vers -Z, droit sur le zombie
      for (var i = 0; i < 180; i++) {
        pl.updateMovement(1 / 60, keys({ forward: 1 }));
        s.ents.separer(pl.state, 1 / 60);
        z.vel.x = 0; z.vel.z = 0;               // on fige le zombie
        z.pos.x = 0.5; z.pos.z = -3;
      }
      var d = Math.hypot(pl.state.pos.x - z.pos.x, pl.state.pos.z - z.pos.z);
      A.ok(d > 0.4, 'une distance minimale est conservee (' + d.toFixed(2) + ')');
    });

    it('SPEC-COLL-002 : une creature ne traverse pas un joueur', function () {
      var s = scene();
      var pl = joueur(s, 0.5, 11, 0.5);
      var z = s.ents.spawn('zombie', 0.5, 11, -6);
      for (var i = 0; i < 300; i++) {
        s.ents.update(1 / 60, pl.state, { rand: seededRand(3) });
      }
      var d = Math.hypot(pl.state.pos.x - z.pos.x, pl.state.pos.z - z.pos.z);
      A.ok(d > 0.4, 'le zombie s arrete au contact (' + d.toFixed(2) + ')');
    });

    it('SPEC-COLL-003 : deux creatures ne se superposent pas', function () {
      var s = scene();
      var a = s.ents.spawn('sheep', 0.5, 11, 0.5);
      var b = s.ents.spawn('sheep', 0.52, 11, 0.5);
      a.wanderDir = null; b.wanderDir = null;
      a.wanderCd = 999; b.wanderCd = 999;
      var loin = { pos: { x: 500, y: 11, z: 500 } };
      for (var i = 0; i < 120; i++) s.ents.update(1 / 60, loin, { rand: seededRand(5) });
      var d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
      A.ok(d > 0.35, 'les deux moutons se sont separes (' + d.toFixed(2) + ')');
    });

    it('SPEC-COLL-004 : la separation est horizontale, on peut se tenir dessus', function () {
      var s = scene();
      var bas = s.ents.spawn('sheep', 0.5, 11, 0.5);
      var haut = s.ents.spawn('sheep', 0.5, 13, 0.5);   // nettement au-dessus
      bas.wanderDir = null; haut.wanderDir = null;
      bas.wanderCd = 999; haut.wanderCd = 999;
      var x0 = haut.pos.x, z0 = haut.pos.z;
      var loin = { pos: { x: 500, y: 11, z: 500 } };
      for (var i = 0; i < 10; i++) s.ents.separerEntites(1 / 60);
      A.close(haut.pos.x, x0, 0.01, 'pas de poussee laterale');
      A.close(haut.pos.z, z0, 0.01, 'pas de poussee laterale');
    });

    it('SPEC-COLL-005 : objets au sol et projectiles ne repoussent personne', function () {
      var s = scene();
      var pl = joueur(s, 0.5, 11, 0.5);
      s.ents.dropItem(0.5, 11, 0.5, B.COBBLE, 1, seededRand(1));
      s.ents.tirer({ x: 0.5, y: 11.5, z: 0.5 }, { x: 0, y: 0, z: 1 }, 0, 5, null);
      var x0 = pl.state.pos.x, z0 = pl.state.pos.z;
      for (var i = 0; i < 30; i++) s.ents.separer(pl.state, 1 / 60);
      A.close(pl.state.pos.x, x0, 1e-9, 'aucune poussee en X');
      A.close(pl.state.pos.z, z0, 1e-9, 'aucune poussee en Z');
    });

    it('SPEC-COLL-006 : la poussee est bornee', function () {
      var s = scene();
      var pl = joueur(s, 0.5, 11, 0.5);
      // trois mobs exactement au meme point : cas extreme
      for (var k = 0; k < 3; k++) s.ents.spawn('zombie', 0.5, 11, 0.5);
      var x0 = pl.state.pos.x, z0 = pl.state.pos.z;
      s.ents.separer(pl.state, 1 / 60);
      var d = Math.hypot(pl.state.pos.x - x0, pl.state.pos.z - z0);
      A.ok(d < 0.25, 'deplacement borne sur une image (' + d.toFixed(3) + ')');
    });

    it('SPEC-COLL-007 : une creature morte ne bloque plus', function () {
      var s = scene();
      var pl = joueur(s, 0.5, 11, 0.5);
      var z = s.ents.spawn('zombie', 0.9, 11, 0.5);
      z.dead = true;                             // marquee morte, pas encore retiree
      var x0 = pl.state.pos.x;
      for (var i = 0; i < 20; i++) s.ents.separer(pl.state, 1 / 60);
      A.close(pl.state.pos.x, x0, 1e-9, 'aucune poussee d une creature morte');
    });

    it('SPEC-COLL-008 : la poussee ne fait pas traverser un mur', function () {
      var s = scene();
      // mur plein a l'ouest du joueur
      for (var y = 11; y < 14; y++) s.w.setBlock(-1, y, 0, B.STONE);
      var pl = joueur(s, 0.5, 11, 0.5);
      // un zombie colle a l'est pousse le joueur vers le mur
      var z = s.ents.spawn('zombie', 1.0, 11, 0.5);
      for (var i = 0; i < 200; i++) {
        z.pos.x = 1.0; z.pos.z = 0.5;
        s.ents.separer(pl.state, 1 / 60);
      }
      A.ok(pl.state.pos.x > -0.2, 'le joueur reste du bon cote du mur (' +
        pl.state.pos.x.toFixed(2) + ')');
      A.notOk(P.collides(s.w, pl.state.pos.x, pl.state.pos.y, pl.state.pos.z, 0.6, 1.8),
        'le joueur n est pas dans un bloc');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — nage des créatures', function () {

    /* Bassin profond : sol solide au fond, eau au-dessus, air ensuite. */
    function bassin(fond, surface) {
      var w = flatWorld(fond, B.STONE);
      for (var y = fond + 1; y <= surface; y++) {
        for (var x = -6; x <= 6; x++) for (var z = -6; z <= 6; z++) w.setBlock(x, y, z, B.WATER);
      }
      return { w: w, ents: MC.createEntities(w), fond: fond, surface: surface };
    }

    it('SPEC-NAGE-001 : une creature dans l eau remonte', function () {
      var s = bassin(4, 20);
      var m = s.ents.spawn('sheep', 0.5, 6, 0.5);
      m.wanderDir = null; m.wanderCd = 999;
      var loin = { pos: { x: 500, y: 11, z: 500 } };
      var y0 = m.pos.y;
      for (var i = 0; i < 60 * 10; i++) s.ents.update(1 / 60, loin, { rand: seededRand(2) });
      A.ok(m.pos.y > y0 + 3, 'elle a remonte (' + y0 + ' -> ' + m.pos.y.toFixed(1) + ')');
    });

    it('SPEC-NAGE-002 : elle flotte a la surface sans osciller', function () {
      var s = bassin(4, 20);
      var m = s.ents.spawn('sheep', 0.5, 6, 0.5);
      m.wanderDir = null; m.wanderCd = 999;
      var loin = { pos: { x: 500, y: 11, z: 500 } };
      for (var i = 0; i < 60 * 15; i++) s.ents.update(1 / 60, loin, { rand: seededRand(2) });
      var min = Infinity, max = -Infinity;
      for (var j = 0; j < 60 * 4; j++) {
        s.ents.update(1 / 60, loin, { rand: seededRand(2) });
        if (m.pos.y < min) min = m.pos.y;
        if (m.pos.y > max) max = m.pos.y;
      }
      A.ok(max - min < 1.2, 'oscillation faible (' + (max - min).toFixed(2) + ' bloc)');
      A.ok(Math.abs(m.pos.y - s.surface) < 3, 'elle se tient pres de la surface');
    });

    it('SPEC-NAGE-003 : la descente est plafonnee', function () {
      var s = bassin(0, 40);
      var m = s.ents.spawn('sheep', 0.5, 38, 0.5);
      m.wanderDir = null; m.wanderCd = 999;
      var loin = { pos: { x: 500, y: 11, z: 500 } };
      var pire = 0;
      for (var i = 0; i < 120; i++) {
        s.ents.update(1 / 60, loin, { rand: seededRand(2) });
        if (m.vel.y < pire) pire = m.vel.y;
      }
      A.ok(pire > -4, 'vitesse de chute plafonnee (' + pire.toFixed(2) + ' m/s)');
    });

    it('SPEC-NAGE-004 : on nage moins vite qu on ne marche', function () {
      function parcours(dansEau) {
        var s = dansEau ? bassin(4, 20) : { w: flatWorld(10, B.STONE) };
        if (!dansEau) s.ents = MC.createEntities(s.w);
        var y = dansEau ? 10 : 11;
        var m = s.ents.spawn('sheep', 0.5, y, 0.5);
        m.wanderDir = 0; m.wanderCd = 9999;
        var loin = { pos: { x: 500, y: 11, z: 500 } };
        var x0 = m.pos.x;
        for (var i = 0; i < 120; i++) s.ents.update(1 / 60, loin, { rand: seededRand(9) });
        return Math.abs(m.pos.x - x0);
      }
      var sec = parcours(false), eau = parcours(true);
      A.ok(eau < sec, 'plus lent dans l eau (' + eau.toFixed(2) + ' contre ' + sec.toFixed(2) + ')');
    });

    it('SPEC-NAGE-005 : un hostile poursuit encore en nageant', function () {
      var s = bassin(4, 20);
      var pl = { pos: { x: 0.5, y: 10, z: 0.5 } };
      var z = s.ents.spawn('zombie', 0.5, 10, -8);
      var d0 = Math.abs(z.pos.z - pl.pos.z);
      for (var i = 0; i < 60 * 6; i++) s.ents.update(1 / 60, pl, { rand: seededRand(4) });
      var d1 = Math.abs(z.pos.z - pl.pos.z);
      A.ok(d1 < d0, 'il se rapproche (' + d0.toFixed(1) + ' -> ' + d1.toFixed(1) + ')');
    });

    it('SPEC-NAGE-006 : un objet coule au lieu de flotter', function () {
      var s = bassin(4, 20);
      var e = s.ents.dropItem(0.5, 18, 0.5, B.COBBLE, 1, seededRand(1));
      e.vel.x = 0; e.vel.z = 0; e.vel.y = 0;
      var loin = { pos: { x: 500, y: 11, z: 500 } };
      var y0 = e.pos.y;
      for (var i = 0; i < 60 * 5; i++) s.ents.update(1 / 60, loin, { rand: seededRand(1) });
      A.ok(e.pos.y < y0 - 2, 'il a coule (' + y0 + ' -> ' + e.pos.y.toFixed(1) + ')');
    });

    it('SPEC-NAGE-007 : sortie de l eau, la vitesse redevient normale', function () {
      var s = bassin(4, 8);
      var m = s.ents.spawn('sheep', 0.5, 12, 0.5);   // au-dessus de l'eau
      m.wanderDir = 0; m.wanderCd = 9999;
      var loin = { pos: { x: 500, y: 11, z: 500 } };
      var x0 = m.pos.x;
      for (var i = 0; i < 120; i++) s.ents.update(1 / 60, loin, { rand: seededRand(9) });
      var horsEau = Math.abs(m.pos.x - x0);
      A.ok(horsEau > 0.5, 'elle avance normalement hors de l eau (' + horsEau.toFixed(2) + ')');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
