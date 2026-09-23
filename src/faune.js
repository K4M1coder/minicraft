/* faune.js — déplacements des créatures qui ne marchent pas : nageurs et
   volants. Logique pure. Chaque fonction reçoit l'entité, son gabarit et un
   contexte { world, cible, rand } et règle la VITESSE de l'entité ; la
   collision avec les blocs reste l'affaire de Physics.move. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core, P = MC.Physics;
  var SEA = C.SEA_LEVEL;

  function dansLEau(world, x, y, z) { return C.isWater(world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))); }
  function solide(world, x, y, z) { return C.isSolid(world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))); }

  /* Nouveau cap d'errance, tiré au hasard. `vertical` donne une pente. */
  function nouveauCap(e, r, vertical) {
    e.cap = r() * Math.PI * 2;
    e.pente = (r() - 0.5) * vertical;
    e.capCd = 2 + r() * 4;
  }

  /* ── Nage ────────────────────────────────────────────────────────────────
     Dans l'eau : ni gravité ni flottaison, un déplacement en trois dimensions.
     La créature ne quitte pas l'eau de son plein gré : si la case devant elle
     n'est pas de l'eau, elle fait demi-tour. Hors de l'eau, elle retombe et
     s'asphyxie. Renvoie { dedans, degats } : dégâts d'asphyxie à appliquer. */
  var ASPHYXIE_DELAI = 4, ASPHYXIE_CADENCE = 1.5;
  function nager(e, s, dt, ctx) {
    var w = ctx.world, r = ctx.rand || Math.random;
    var cy = e.pos.y + e.h * 0.5;
    var dedans = dansLEau(w, e.pos.x, cy, e.pos.z);
    var res = { dedans: dedans, degats: 0 };
    if (!dedans) {
      // hors de l'eau : on se débat, on s'asphyxie
      e.asphyxie = (e.asphyxie || 0) + dt;
      e.vel.y -= 30 * dt;
      if (e.onGround && r() < dt * 3) { e.vel.y = 4; e.vel.x = (r() - 0.5) * 3; e.vel.z = (r() - 0.5) * 3; }
      if (e.asphyxie > ASPHYXIE_DELAI) {
        e.asphyxieT = (e.asphyxieT || 0) + dt;
        if (e.asphyxieT >= ASPHYXIE_CADENCE) { e.asphyxieT = 0; res.degats = 1; }
      }
      return res;
    }
    e.asphyxie = 0;
    var cible = ctx.cible;
    var vx, vy, vz;
    var chasse = cible && !cible.dead && ctx.agressif &&
                 dansLEau(w, cible.pos.x, cible.pos.y + 0.9, cible.pos.z);
    var dist = cible ? Math.hypot(cible.pos.x - e.pos.x, cible.pos.y + 0.9 - cy, cible.pos.z - e.pos.z) : 1e9;
    if (chasse && dist < (s.vue || 16)) {
      var d = dist || 1;
      vx = (cible.pos.x - e.pos.x) / d * s.speed;
      vy = (cible.pos.y + 0.9 - cy) / d * s.speed;
      vz = (cible.pos.z - e.pos.z) / d * s.speed;
    } else {
      e.capCd = (e.capCd || 0) - dt;
      if (e.capCd <= 0 || e.cap === undefined) nouveauCap(e, r, 0.9);
      var sp = s.speed * 0.55;
      vx = Math.cos(e.cap) * sp; vz = Math.sin(e.cap) * sp; vy = e.pente * sp;
      // pas d'eau devant : demi-tour
      var ax = e.pos.x + Math.cos(e.cap) * (e.w / 2 + 0.6), az = e.pos.z + Math.sin(e.cap) * (e.w / 2 + 0.6);
      if (!dansLEau(w, ax, cy, az)) { e.cap += Math.PI * (0.7 + r() * 0.6); vx = -vx; vz = -vz; }
    }
    // ni plus haut que la surface, ni dans le fond
    if (vy > 0 && !dansLEau(w, e.pos.x, e.pos.y + e.h + 0.2, e.pos.z)) vy = -0.3;
    if (vy < 0 && solide(w, e.pos.x, e.pos.y - 0.3, e.pos.z)) vy = 0.3;
    e.vel.x = P.approach(e.vel.x, vx, 4, dt);
    e.vel.y = P.approach(e.vel.y, vy, 4, dt);
    e.vel.z = P.approach(e.vel.z, vz, 4, dt);
    if (Math.abs(e.vel.x) + Math.abs(e.vel.z) > 0.05) e.yaw = Math.atan2(-e.vel.x, -e.vel.z);
    return res;
  }

  /* ── Vol ─────────────────────────────────────────────────────────────────
     Ni gravité ni sol : on vise une altitude au-dessus du relief, relevée
     toutes les secondes (un sondage de colonne par image serait coûteux). On
     évite les obstacles en montant et en virant. Un volant agressif tourne
     au-dessus de sa cible puis plonge sur elle. */
  function volerVers(e, s, dt, ctx) {
    var w = ctx.world, r = ctx.rand || Math.random;
    e.solT = (e.solT || 0) - dt;
    if (e.solT <= 0 || e.sol === undefined) {
      e.solT = 1;
      var g = w.groundAt ? w.groundAt(Math.floor(e.pos.x), Math.floor(e.pos.z), false) : 0;
      e.sol = Math.max(g, SEA);
    }
    if (e.altitude === undefined) e.altitude = (s.altitude || [5, 12])[0] +
      r() * ((s.altitude || [5, 12])[1] - (s.altitude || [5, 12])[0]);
    var cible = ctx.cible;
    var vx, vy, vz;
    var dist = cible ? Math.hypot(cible.pos.x - e.pos.x, cible.pos.z - e.pos.z) : 1e9;
    if (ctx.agressif && cible && !cible.dead && dist < (s.vue || 24)) {
      // cycle : tourner au-dessus, puis piquer
      e.piqueCd = (e.piqueCd === undefined ? 5 : e.piqueCd) - dt;
      var visee;
      if (e.piqueCd <= 0) {
        visee = { x: cible.pos.x, y: cible.pos.y + 1, z: cible.pos.z };
        if (e.piqueCd < -2.5) e.piqueCd = 6 + r() * 3;
      } else {
        var a = (e.age || 0) * 0.6 + (e.eid || 0);
        visee = { x: cible.pos.x + Math.cos(a) * 8, y: cible.pos.y + 7, z: cible.pos.z + Math.sin(a) * 8 };
      }
      var dx = visee.x - e.pos.x, dy = visee.y - e.pos.y, dz = visee.z - e.pos.z;
      var d = Math.hypot(dx, dy, dz) || 1;
      vx = dx / d * s.speed; vy = dy / d * s.speed; vz = dz / d * s.speed;
    } else {
      e.capCd = (e.capCd || 0) - dt;
      if (e.capCd <= 0 || e.cap === undefined) nouveauCap(e, r, 0);
      vx = Math.cos(e.cap) * s.speed; vz = Math.sin(e.cap) * s.speed;
      vy = (e.sol + e.altitude - e.pos.y) * 0.8;
      vy = Math.max(-2.5, Math.min(2.5, vy));
    }
    // obstacle devant : on monte et on vire
    var n = Math.hypot(vx, vz) || 1;
    var ox = e.pos.x + vx / n * (e.w / 2 + 1), oz = e.pos.z + vz / n * (e.w / 2 + 1);
    if (solide(w, ox, e.pos.y + e.h * 0.5, oz)) {
      vy = Math.max(vy, 3);
      if (!ctx.agressif) e.cap += Math.PI / 2;
    }
    if (e.pos.y > C.WORLD_H - 4) vy = Math.min(vy, 0);
    e.vel.x = P.approach(e.vel.x, vx, 3, dt);
    e.vel.y = P.approach(e.vel.y, vy, 3, dt);
    e.vel.z = P.approach(e.vel.z, vz, 3, dt);
    if (Math.abs(e.vel.x) + Math.abs(e.vel.z) > 0.05) e.yaw = Math.atan2(-e.vel.x, -e.vel.z);
    return { piqueEnCours: ctx.agressif && e.piqueCd <= 0 };
  }

  /* ── Marche lestée ───────────────────────────────────────────────────────
     Noyés, crabes, capitaine : ils ne flottent pas. Dans l'eau ils coulent
     doucement et marchent au fond ; s'ils poursuivent une cible plus haute,
     ils remontent vers elle. Seule la composante verticale est réglée ici. */
  function lester(e, s, dt, ctx) {
    var w = ctx.world;
    if (!P.inWater(w, e.pos, e.h)) return false;
    e.vel.y -= 30 * 0.3 * dt;
    if (e.vel.y < -2.5) e.vel.y = -2.5;
    var c = ctx.cible;
    if (ctx.agressif && c && !c.dead && c.pos.y > e.pos.y + 1 &&
        Math.hypot(c.pos.x - e.pos.x, c.pos.z - e.pos.z) < (s.vue || 16)) {
      e.vel.y = P.approach(e.vel.y, 2.4, 5, dt);
    }
    return true;
  }

  MC.Faune = { nager: nager, volerVers: volerVers, lester: lester, nouveauCap: nouveauCap,
               ASPHYXIE_DELAI: ASPHYXIE_DELAI };
})(typeof globalThis !== 'undefined' ? globalThis : this);
