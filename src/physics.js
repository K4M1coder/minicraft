/* physics.js — collisions AABB et orientation des déplacements.
   Pas de THREE : on manipule des {x,y,z} nus, ce qui rend tout cela
   directement vérifiable en tests unitaires. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;

  /* Direction voulue, dans le repère du regard.
     La caméra regarde vers -Z ; après rotation `yaw` autour de Y :
        avant  = (-sin, 0, -cos)      droite = ( cos, 0, -sin)
     Les DEUX composantes Z sont négatives. Les oublier miroite le déplacement
     par rapport à l'axe X : correct en regardant vers ±X, inversé vers ±Z.
     C'est exactement le bug corrigé ici, d'où la fonction dédiée et testée. */
  function wishDirection(yaw, fwd, strafe) {
    var sin = Math.sin(yaw), cos = Math.cos(yaw);
    var x = strafe * cos - fwd * sin;
    var z = -strafe * sin - fwd * cos;
    var len = Math.hypot(x, z);
    if (len > 1e-9) { x /= len; z /= len; }   // pas de bonus en diagonale
    else { x = 0; z = 0; }
    return { x: x, z: z };
  }

  /* Le pavé [x±w/2] × [y, y+h] × [z±w/2] chevauche-t-il un bloc solide ? */
  function collides(world, x, y, z, w, h) {
    var r = w / 2;
    var x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    var y0 = Math.floor(y), y1 = Math.floor(y + h - 1e-6);
    var z0 = Math.floor(z - r), z1 = Math.floor(z + r);
    for (var yy = y0; yy <= y1; yy++)
    for (var zz = z0; zz <= z1; zz++)
    for (var xx = x0; xx <= x1; xx++)
      if (C.isSolid(world.getBlock(xx, yy, zz))) return true;
    return false;
  }

  /* Premier bloc au CONTACT d'un pavé — le pavé élargi de `marge` — qui
     satisfait `pred(id)`. Sert aux blocs qui blessent au toucher (cactus) :
     la collision nous arrête juste avant le bloc, un test de chevauchement
     strict ne le verrait donc jamais. */
  function contact(world, x, y, z, w, h, marge, pred) {
    var r = w / 2 + marge;
    var x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    var y0 = Math.floor(y - marge), y1 = Math.floor(y + h - 1e-6);
    var z0 = Math.floor(z - r), z1 = Math.floor(z + r);
    for (var yy = y0; yy <= y1; yy++)
    for (var zz = z0; zz <= z1; zz++)
    for (var xx = x0; xx <= x1; xx++) {
      var id = world.getBlock(xx, yy, zz);
      if (id && pred(id)) return id;
    }
    return 0;
  }

  /* Le corps occupe-t-il un bloc portant la propriété `prop` (grimpable,
     ralentit) ? Renvoie la définition du premier trouvé, ou null. */
  function occupeAvec(world, x, y, z, w, h, prop) {
    var id = contact(world, x, y, z, w, h, 0, function (b) {
      var d = C.BLOCKS[b]; return !!d && !!d[prop];
    });
    return id ? C.BLOCKS[id] : null;
  }

  /* Vitesse verticale qu'il faut pour monter sur le rebord situé devant soi
     (direction `dir`), ou 0 s'il n'y a pas de rebord franchissable : plus de
     2,6 blocs à gravir, ou pas la place de se tenir debout dessus. */
  var HISSE_MAX = 2.6, GRAVITE_HISSE = 30;
  function elanPourSortir(world, pos, dir, w, h) {
    var n = Math.hypot(dir.x, dir.z);
    if (n < 1e-9) return 0;
    var ax = pos.x + dir.x / n * (w / 2 + 0.35), az = pos.z + dir.z / n * (w / 2 + 0.35);
    var pied = Math.floor(pos.y);
    if (!C.isSolid(world.getBlock(Math.floor(ax), pied, Math.floor(az))) &&
        !C.isSolid(world.getBlock(Math.floor(ax), pied + 1, Math.floor(az)))) return 0;
    for (var dy = 1; dy <= 3; dy++) {
      var y = pied + dy;
      if (y - pos.y > HISSE_MAX) return 0;
      if (collides(world, ax, y, az, w, h)) continue;
      // assez haut pour passer par-dessus, marge comprise
      return Math.sqrt(2 * GRAVITE_HISSE * (y - pos.y + 0.25));
    }
    return 0;
  }

  /* Déplace un corps axe par axe. Si un axe collisionne, on annule cet axe
     SEUL — c'est ce qui permet de glisser le long d'un mur au lieu de s'y coller. */
  function moveAxis(world, body, axis, amount, w, h) {
    if (!amount) return false;
    var p = body.pos;
    var old = p[axis];
    p[axis] = old + amount;
    if (collides(world, p.x, p.y, p.z, w, h)) {
      p[axis] = old;
      body.vel[axis] = 0;
      return true;
    }
    return false;
  }

  /* Déplace sur les 3 axes. Renvoie quels axes ont buté. */
  function move(world, body, dt, w, h) {
    var hx = moveAxis(world, body, 'x', body.vel.x * dt, w, h);
    var hz = moveAxis(world, body, 'z', body.vel.z * dt, w, h);
    var dy = body.vel.y * dt;
    var hy = moveAxis(world, body, 'y', dy, w, h);
    return { x: hx, y: hy, z: hz, landed: hy && dy < 0, bumpedHead: hy && dy > 0 };
  }

  /* Le corps est-il dans l'eau ? On échantillonne à hauteur de poitrine (70 %),
     pas aux pieds : plus bas, le point de mesure reste dans le bloc d'eau d'une
     simple flaque d'un bloc et l'on se mettrait à nager en la traversant. */
  var SWIM_SAMPLE = 0.7;
  function inWater(world, pos, h) {
    var b = world.getBlock(Math.floor(pos.x), Math.floor(pos.y + h * SWIM_SAMPLE),
                          Math.floor(pos.z));
    return C.isWater(b);
  }
  function headInWater(world, pos, eye) {
    return C.isWater(world.getBlock(Math.floor(pos.x), Math.floor(pos.y + eye), Math.floor(pos.z)));
  }

  /* Le corps touche-t-il de la lave ? Renvoie sa définition (dégâts `brule`). */
  function dansLave(world, pos, w, h) {
    return occupeAvec(world, pos.x, pos.y, pos.z, w, h, 'lave');
  }

  /* Lissage exponentiel : indépendant du framerate, contrairement à un lerp naïf
     où `a += (b-a) * 0.2` va deux fois plus vite à 120 fps qu'à 60. */
  function approach(cur, target, rate, dt) {
    return cur + (target - cur) * (1 - Math.exp(-rate * dt));
  }

  /* Raycast voxel DDA (Amanatides & Woo) : on saute de frontière de voxel en
     frontière, au lieu d'échantillonner à petits pas (qui rate les coins).
     `dir` doit être normalisé. `hits(id)` dit si un bloc arrête le rayon. */
  function raycast(world, origin, dir, reach, hits) {
    var x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    var stepX = Math.sign(dir.x), stepY = Math.sign(dir.y), stepZ = Math.sign(dir.z);
    var tdX = stepX ? Math.abs(1 / dir.x) : Infinity;
    var tdY = stepY ? Math.abs(1 / dir.y) : Infinity;
    var tdZ = stepZ ? Math.abs(1 / dir.z) : Infinity;
    var tmX = stepX ? (stepX > 0 ? x + 1 - origin.x : origin.x - x) * tdX : Infinity;
    var tmY = stepY ? (stepY > 0 ? y + 1 - origin.y : origin.y - y) * tdY : Infinity;
    var tmZ = stepZ ? (stepZ > 0 ? z + 1 - origin.z : origin.z - z) * tdZ : Infinity;

    var nx = 0, ny = 0, nz = 0, t = 0;
    var test = hits || function (id) { return id !== 0 && !C.BLOCKS[id].liquid; };
    var guard = 0;
    while (t <= reach && guard++ < 512) {
      var b = world.getBlock(x, y, z);
      if (test(b)) return { x: x, y: y, z: z, nx: nx, ny: ny, nz: nz, block: b, t: t };
      if (tmX < tmY && tmX < tmZ) { x += stepX; t = tmX; tmX += tdX; nx = -stepX; ny = 0; nz = 0; }
      else if (tmY < tmZ)         { y += stepY; t = tmY; tmY += tdY; nx = 0; ny = -stepY; nz = 0; }
      else                        { z += stepZ; t = tmZ; tmZ += tdZ; nx = 0; ny = 0; nz = -stepZ; }
    }
    return null;
  }

  /* Deux pavés se chevauchent-ils ? Sert au ramassage et aux coups. */
  function boxOverlap(ax, ay, az, aw, ah, bx, by, bz, bw, bh) {
    return Math.abs(ax - bx) < (aw + bw) / 2 &&
           Math.abs(az - bz) < (aw + bw) / 2 &&
           ay < by + bh && by < ay + ah;
  }

  MC.Physics = {
    wishDirection: wishDirection, collides: collides, contact: contact, occupeAvec: occupeAvec, elanPourSortir: elanPourSortir, dansLave: dansLave, moveAxis: moveAxis, move: move,
    inWater: inWater, headInWater: headInWater, approach: approach, SWIM_SAMPLE: SWIM_SAMPLE,
    raycast: raycast, boxOverlap: boxOverlap,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
