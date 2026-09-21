/* entities.js — objets au sol, mobs hostiles, animaux et PNJ.
   Logique pure : la couche rendu se contente de suivre `list`. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core, P = MC.Physics;
  var B = C.B, I = C.I;

  // gabarits : largeur, hauteur, vie, vitesse, dégâts
  var SPECS = {
    item:     { w: 0.28, h: 0.28, hp: 1,  speed: 0,   damage: 0 },
    zombie:   { w: 0.6,  h: 1.8,  hp: 14, speed: 2.6, damage: 3, hostile: true },
    sheep:    { w: 0.7,  h: 1.2,  hp: 8,  speed: 1.5, damage: 0,
                drops: [{ id: I.RAW_MUTTON, n: 1 }, { id: B.WOOL, n: 1 }] },
    villager: { w: 0.6,  h: 1.8,  hp: 20, speed: 1.1, damage: 0, npc: true },
    // projectile : petit, sans IA, il traverse tout jusqu'a percuter
    arrow:    { w: 0.16, h: 0.16, hp: 1,  speed: 0,   damage: 5, projectile: true },
  };

  /* Cap d'une créature. Le maillage a ses yeux vers -Z : après rotation de
     `yaw` autour de Y, son avant vaut (-sin, 0, -cos). Pour regarder vers
     (dx, dz) il faut donc yaw = atan2(-dx, -dz).
     La formule d'errance précédente (-dir + PI/2) donnait exactement l'opposé :
     les créatures marchaient à reculons. Une seule fonction désormais, pour que
     poursuite et errance ne puissent plus diverger. */
  function capVers(dx, dz) {
    if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return null;   // pas de cap
    return Math.atan2(-dx, -dz);
  }

  /* Rayon de séparation entre deux corps : moyenne des demi-largeurs, un peu
     resserrée pour que les créatures puissent se frôler sans se repousser en
     permanence. */
  function largeurDe(x) { return (x && typeof x.w === 'number') ? x.w : 0.6; }
  function hauteurDe(x) { return (x && typeof x.h === 'number') ? x.h : 1.8; }
  /* Une largeur manquante donnerait NaN, et NaN contamine silencieusement
     toutes les positions : le corps finit hors du monde sans la moindre erreur.
     D'ou les valeurs de repli. */
  function rayonSeparation(a, b) { return (largeurDe(a) + largeurDe(b)) * 0.42; }
  var VITESSE_SEPARATION = 4;   // m/s : vitesse a laquelle deux corps s ecartent
  var POUSSEE_MAX = 0.2;        // deplacement total maximal par image

  var ARROW_GRAVITY = 14;      // plus douce que la chute libre : trajectoire lisible
  var ARROW_VIE = 12;          // secondes avant disparition

  var GRAVITY = 30, MAX_FALL = 55;
  var NAGE_FREIN = 0.62;        // facteur de vitesse horizontale dans l'eau

  function createEntities(world) {
    var list = [];
    var nextId = 1;

    function spawn(type, x, y, z, extra) {
      var s = SPECS[type];
      var e = {
        eid: nextId++, type: type, pos: { x: x, y: y, z: z }, vel: { x: 0, y: 0, z: 0 },
        hp: s.hp, w: s.w, h: s.h, onGround: false, age: 0, yaw: 0,
        attackCd: 0, wanderCd: 0, hurtCd: 0, dead: false,
      };
      if (extra) for (var k in extra) e[k] = extra[k];
      list.push(e);
      return e;
    }

    function dropItem(x, y, z, id, n, rand) {
      var r = rand || Math.random;
      var e = spawn('item', x, y, z, { item: id, n: n || 1, pickup: 0.4 });
      // petite impulsion pour que les drops ne s'empilent pas exactement
      e.vel.x = (r() - 0.5) * 2.2;
      e.vel.z = (r() - 0.5) * 2.2;
      e.vel.y = 2.2 + r();
      return e;
    }

    /* Lance un projectile. `tireur` sert a ne pas se blesser soi-meme :
       la fleche part de la tete du joueur et le traverse pendant un instant. */
    function tirer(origine, direction, vitesse, degats, tireur) {
      var e = spawn('arrow', origine.x, origine.y, origine.z, {
        degats: degats === undefined ? SPECS.arrow.damage : degats,
        tireur: tireur || null,
        vie: ARROW_VIE,
      });
      var v = vitesse === undefined ? 34 : vitesse;
      e.vel.x = direction.x * v;
      e.vel.y = direction.y * v;
      e.vel.z = direction.z * v;
      return e;
    }

    /* Avance un projectile par petits pas et s'arrete au premier contact.
       On subdivise le deplacement : a 34 m/s et 60 images/s, un pas entier
       fait 0,57 bloc — un mur d'un bloc passerait au travers un tir sur deux. */
    function stepArrow(e, dt, player, events) {
      e.vie -= dt;
      if (e.vie <= 0) { remove(e); return; }
      e.vel.y -= ARROW_GRAVITY * dt;

      var dist = Math.hypot(e.vel.x, e.vel.y, e.vel.z) * dt;
      var pas = Math.max(1, Math.ceil(dist / 0.2));
      var sdt = dt / pas;
      for (var k = 0; k < pas; k++) {
        e.pos.x += e.vel.x * sdt;
        e.pos.y += e.vel.y * sdt;
        e.pos.z += e.vel.z * sdt;

        // bloc solide : le projectile se fiche et disparait
        if (C.isSolid(world.getBlock(Math.floor(e.pos.x), Math.floor(e.pos.y), Math.floor(e.pos.z)))) {
          remove(e); return;
        }
        // entite : on ignore le tireur et les autres projectiles
        for (var i = 0; i < list.length; i++) {
          var c = list[i];
          if (c === e || c.type === 'item' || c.type === 'arrow' || c.dead) continue;
          if (c === e.tireur) continue;
          var hw = c.w / 2;
          if (Math.abs(e.pos.x - c.pos.x) < hw && Math.abs(e.pos.z - c.pos.z) < hw &&
              e.pos.y > c.pos.y && e.pos.y < c.pos.y + c.h) {
            c.hurtCd = 0;                       // un tir vise touche toujours
            damage(c, e.degats, e.pos);
            remove(e);
            return;
          }
        }
        // le joueur, sauf s'il est le tireur
        if (player && e.tireur !== player && e.pos.y > player.pos.y &&
            e.pos.y < player.pos.y + 1.8 &&
            Math.abs(e.pos.x - player.pos.x) < 0.3 &&
            Math.abs(e.pos.z - player.pos.z) < 0.3) {
          if (events) events.damage += e.degats;
          remove(e);
          return;
        }
        if (e.pos.y < -20) { remove(e); return; }
      }
    }

    /* Un corps peut-il en repousser un autre ? Les objets au sol et les
       projectiles traversent tout le monde : les faire pousser rendrait le
       ramassage désagréable et ferait dévier les tirs. */
    function corpsSolide(x) {
      return x && !x.dead && x.type !== 'item' && x.type !== 'arrow';
    }

    /* Écarte deux corps qui se chevauchent, horizontalement seulement : une
       poussée verticale empêcherait de se tenir sur une créature et
       provoquerait des éjections vers le haut. */
    function ecarter(a, b, dt, poidsA, poidsB) {
      var dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
      var d = Math.hypot(dx, dz);
      var r = rayonSeparation(a, b);
      if (d >= r) return 0;

      // chevauchement vertical : deux corps l'un au-dessus de l'autre ne se
      // repoussent pas
      var hA = hauteurDe(a), hB = hauteurDe(b);
      if (a.pos.y >= b.pos.y + hB || b.pos.y >= a.pos.y + hA) return 0;

      // superposition exacte : on choisit une direction stable plutôt qu'au hasard
      if (d < 1e-6) {
        var ang = ((a.eid || 1) * 2.39996);          // angle d'or : repartition
        dx = Math.cos(ang); dz = Math.sin(ang); d = 1;
      }
      var chevauche = r - d;
      // vitesse d ecartement plutot qu un pas fixe : le comportement ne depend
      // plus de la cadence d affichage
      var pousse = Math.min(chevauche, VITESSE_SEPARATION * Math.max(dt, 1 / 240));
      var ux = dx / d, uz = dz / d;
      a.pos.x += ux * pousse * poidsA;
      a.pos.z += uz * pousse * poidsA;
      if (poidsB) { b.pos.x -= ux * pousse * poidsB; b.pos.z -= uz * pousse * poidsB; }
      return pousse;
    }

    /* Repousse corps (un joueur) hors des créatures. Le joueur seul bouge :
       une créature repoussée par le joueur serait injouable en combat. */
    function separer(corps, dt) {
      if (!corps || corps.dead) return 0;
      var total = 0;
      var avantX = corps.pos.x, avantZ = corps.pos.z;
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (!corpsSolide(o)) continue;
        total += ecarter(corps, o, dt, 1, 0);
      }
      /* On borne le deplacement TOTAL, pas chaque contribution : trois corps
         superposes cumuleraient sinon leurs poussees et projetteraient le
         joueur au loin. */
      var dx = corps.pos.x - avantX, dz = corps.pos.z - avantZ;
      var d = Math.hypot(dx, dz);
      if (d > POUSSEE_MAX) {
        corps.pos.x = avantX + (dx / d) * POUSSEE_MAX;
        corps.pos.z = avantZ + (dz / d) * POUSSEE_MAX;
      }
      /* La poussée ne doit jamais faire entrer dans un bloc : sinon un mob
         acculant le joueur contre un mur le ferait passer au travers. */
      if (total > 0 && P.collides(world, corps.pos.x, corps.pos.y, corps.pos.z,
                                  largeurDe(corps), hauteurDe(corps))) {
        corps.pos.x = avantX; corps.pos.z = avantZ;
      }
      return total;
    }

    /* Sépare les créatures entre elles, chacune cédant la moitié. */
    function separerEntites(dt) {
      var n = 0;
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (!corpsSolide(a)) continue;
        for (var j = i + 1; j < list.length; j++) {
          var b = list[j];
          if (!corpsSolide(b)) continue;
          var avant = { ax: a.pos.x, az: a.pos.z, bx: b.pos.x, bz: b.pos.z };
          if (ecarter(a, b, dt, 0.5, 0.5) > 0) {
            n++;
            if (P.collides(world, a.pos.x, a.pos.y, a.pos.z, a.w, a.h)) {
              a.pos.x = avant.ax; a.pos.z = avant.az;
            }
            if (P.collides(world, b.pos.x, b.pos.y, b.pos.z, b.w, b.h)) {
              b.pos.x = avant.bx; b.pos.z = avant.bz;
            }
          }
        }
      }
      return n;
    }

    function remove(e) {
      e.dead = true;
      var i = list.indexOf(e);
      if (i >= 0) list.splice(i, 1);
    }

    function damage(e, amount, knockFrom) {
      if (e.hurtCd > 0 || e.dead) return false;
      e.hp -= amount;
      e.hurtCd = 0.35;
      if (knockFrom) {
        var dx = e.pos.x - knockFrom.x, dz = e.pos.z - knockFrom.z;
        var d = Math.hypot(dx, dz) || 1;
        e.vel.x += (dx / d) * 5; e.vel.z += (dz / d) * 5; e.vel.y = 4.5;
      }
      if (e.hp <= 0) {
        var s = SPECS[e.type];
        if (s.drops) {
          for (var i = 0; i < s.drops.length; i++)
            dropItem(e.pos.x, e.pos.y + 0.5, e.pos.z, s.drops[i].id, s.drops[i].n);
        }
        if (e.type === 'zombie') dropItem(e.pos.x, e.pos.y + 0.5, e.pos.z, I.ROTTEN_FLESH, 1);
        remove(e);
        return true;
      }
      return false;
    }

    /* Physique commune : gravité, collisions, flottaison dans l'eau. */
    function stepBody(e, dt) {
      if (P.inWater(world, e.pos, e.h)) {
        e.vel.y -= GRAVITY * 0.28 * dt;
        if (e.vel.y < -2.2) e.vel.y = -2.2;
        if (e.type !== 'item') {
          /* Flottaison amortie : une poussée constante fait osciller la
             créature autour de la surface. On vise une vitesse de remontée
             et on freine à mesure qu'on s'en approche, ce qui stabilise. */
          var cible = P.headInWater(world, e.pos, e.h * 0.9) ? 3.2 : 0;
          e.vel.y = P.approach(e.vel.y, cible, 6, dt);
        }
      } else {
        e.vel.y -= GRAVITY * dt;
        if (e.vel.y < -MAX_FALL) e.vel.y = -MAX_FALL;
      }
      /* Dans l'eau, on avance moins vite : sans cela une créature nage aussi
         vite qu'elle court, ce qui rend les poursuites aquatiques absurdes. */
      if (P.inWater(world, e.pos, e.h) && e.type !== 'item' && e.type !== 'arrow') {
        e.vel.x *= NAGE_FREIN;
        e.vel.z *= NAGE_FREIN;
      }
      var hit = P.move(world, e, dt, e.w, e.h);
      e.onGround = hit.landed || (e.onGround && !hit.y && Math.abs(e.vel.y) < 1e-3);
      if (hit.landed) e.onGround = true;
      // frottement au sol ; les objets glissent moins
      var fr = e.onGround ? (e.type === 'item' ? 6 : 8) : 1.2;
      e.vel.x = P.approach(e.vel.x, 0, fr, dt);
      e.vel.z = P.approach(e.vel.z, 0, fr, dt);
      return hit;
    }

    /* IA : poursuite pour les hostiles, errance pour les autres. */
    function stepAI(e, dt, player, rand) {
      var r = rand || Math.random;
      var s = SPECS[e.type];
      if (!s.speed) return;

      var dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
      var dist = Math.hypot(dx, dz);

      if (s.hostile && dist < 18) {
        // poursuite
        var d = dist || 1;
        e.vel.x = (dx / d) * s.speed;
        e.vel.z = (dz / d) * s.speed;
        var cp = capVers(dx, dz);
        if (cp !== null) e.yaw = cp;
        // sauter par-dessus un obstacle d'un bloc
        if (e.onGround) {
          var ax = Math.floor(e.pos.x + (dx / d) * 0.7);
          var az = Math.floor(e.pos.z + (dz / d) * 0.7);
          var front = world.getBlock(ax, Math.floor(e.pos.y), az);
          var above = world.getBlock(ax, Math.floor(e.pos.y) + 1, az);
          if (C.isSolid(front) && !C.isSolid(above)) e.vel.y = 8.2;
        }
        e.attackCd -= dt;
        var dy = Math.abs(player.pos.y - e.pos.y);
        if (dist < 1.3 && dy < 2 && e.attackCd <= 0) {
          e.attackCd = 1.1;
          return { attack: s.damage };
        }
      } else {
        // errance : on change de cap de loin en loin
        e.wanderCd -= dt;
        if (e.wanderCd <= 0) {
          e.wanderCd = 2 + r() * 4;
          if (r() < 0.4) { e.wanderDir = null; }
          else { e.wanderDir = r() * Math.PI * 2; }
        }
        if (e.wanderDir === null || e.wanderDir === undefined) {
          e.vel.x = P.approach(e.vel.x, 0, 6, dt);
          e.vel.z = P.approach(e.vel.z, 0, 6, dt);
        } else {
          var sp = s.speed * 0.6;
          e.vel.x = Math.cos(e.wanderDir) * sp;
          e.vel.z = Math.sin(e.wanderDir) * sp;
          var cw = capVers(e.vel.x, e.vel.z);
          if (cw !== null) e.yaw = cw;
          if (e.onGround) {
            var bx = Math.floor(e.pos.x + Math.cos(e.wanderDir) * 0.7);
            var bz = Math.floor(e.pos.z + Math.sin(e.wanderDir) * 0.7);
            if (C.isSolid(world.getBlock(bx, Math.floor(e.pos.y), bz))
                && !C.isSolid(world.getBlock(bx, Math.floor(e.pos.y) + 1, bz))) e.vel.y = 8.2;
          }
        }
      }
      return null;
    }

    /* Un tour de simulation. Renvoie les événements que le jeu doit traiter :
       dégâts au joueur et objets ramassés. */
    function update(dt, player, opts) {
      opts = opts || {};
      var rand = opts.rand || Math.random;
      var events = { damage: 0, picked: [] };

      for (var i = list.length - 1; i >= 0; i--) {
        var e = list[i];
        e.age += dt;
        if (e.hurtCd > 0) e.hurtCd -= dt;

        if (e.type === 'arrow') {
          stepArrow(e, dt, player, events);
          continue;
        }

        if (e.type === 'item') {
          e.pickup -= dt;
          stepBody(e, dt);
          // aimantation vers le joueur quand il est proche
          var dx = player.pos.x - e.pos.x;
          var dy = (player.pos.y + 0.6) - e.pos.y;
          var dz = player.pos.z - e.pos.z;
          var d = Math.hypot(dx, dy, dz);
          if (e.pickup <= 0 && d < 2.2) {
            var pull = 9 / Math.max(0.35, d);
            e.vel.x += (dx / d) * pull * dt * 6;
            e.vel.y += (dy / d) * pull * dt * 6;
            e.vel.z += (dz / d) * pull * dt * 6;
          }
          if (e.pickup <= 0 && d < 0.85) {
            events.picked.push({ id: e.item, n: e.n, entity: e });
            remove(e);
          }
          if (e.age > 300) remove(e);       // les objets oubliés disparaissent
          continue;
        }

        var act = stepAI(e, dt, player, rand);
        stepBody(e, dt);
        if (act && act.attack) events.damage += act.attack;

        // une créature ne traverse pas le joueur
        if (player && !player.dead) ecarter(e, player, dt, 1, 0);

        // noyade et chute dans le vide
        if (e.pos.y < -20) remove(e);
      }
      separerEntites(dt);
      return events;
    }

    /* Fusionne les piles d'objets proches : évite qu'un arbre abattu ne laisse
       trente entités distinctes au même endroit. */
    function mergeItems() {
      var merged = 0;
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (a.type !== 'item' || a.dead) continue;
        for (var j = i + 1; j < list.length; j++) {
          var b = list[j];
          if (b.type !== 'item' || b.dead || b.item !== a.item) continue;
          var d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
          if (d > 0.9) continue;
          var max = C.maxStack(a.item);
          if (a.n + b.n > max) continue;
          a.n += b.n; remove(b); merged++; j--;
        }
      }
      return merged;
    }

    /* Intersection rayon / boîte (méthode des tranches).
       Une mesure « distance du centre à l'axe du regard » ne convient pas :
       le centre d'un mob court est très en dessous des yeux du joueur, donc
       l'écart dépasse toujours le seuil et les mobs bas deviennent intouchables. */
    function rayBox(o, d, minx, miny, minz, maxx, maxy, maxz) {
      var t0 = 0, t1 = Infinity;
      var lo, hi, inv, tmp;
      var O = [o.x, o.y, o.z], D = [d.x, d.y, d.z];
      var MI = [minx, miny, minz], MA = [maxx, maxy, maxz];
      for (var a = 0; a < 3; a++) {
        if (Math.abs(D[a]) < 1e-9) {
          if (O[a] < MI[a] || O[a] > MA[a]) return null;   // parallèle et hors de la dalle
          continue;
        }
        inv = 1 / D[a];
        lo = (MI[a] - O[a]) * inv;
        hi = (MA[a] - O[a]) * inv;
        if (lo > hi) { tmp = lo; lo = hi; hi = tmp; }
        if (lo > t0) t0 = lo;
        if (hi < t1) t1 = hi;
        if (t0 > t1) return null;
      }
      return t0;
    }

    /* Quelle entité le joueur vise-t-il ? La boîte est légèrement élargie
       pour rendre la visée un peu indulgente. */
    var AIM_PAD = 0.12;
    function aimedAt(origin, dir, reach) {
      var best = null, bestT = Infinity;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (e.type === 'item' || e.type === 'arrow' || e.dead) continue;
        var hw = e.w / 2 + AIM_PAD;
        var t = rayBox(origin, dir,
          e.pos.x - hw, e.pos.y - AIM_PAD, e.pos.z - hw,
          e.pos.x + hw, e.pos.y + e.h + AIM_PAD, e.pos.z + hw);
        if (t === null || t > reach) continue;
        if (t < bestT) { bestT = t; best = e; }
      }
      return best;
    }

    function countOf(type) {
      var n = 0;
      for (var i = 0; i < list.length; i++) if (list[i].type === type) n++;
      return n;
    }

    /* Apparition : zombies la nuit, animaux et villageois le jour.
       Toujours hors de vue immédiate du joueur, sur un sol valide. */
    function trySpawn(player, isNight, rand, limits) {
      var r = rand || Math.random;
      var lim = limits || { zombie: 12, sheep: 8, villager: 4 };
      var type = isNight
        ? (r() < 0.8 ? 'zombie' : 'sheep')
        : (r() < 0.65 ? 'sheep' : 'villager');
      if (countOf(type) >= lim[type]) return null;

      var ang = r() * Math.PI * 2;
      var dd = 18 + r() * 22;                       // ni sur le joueur, ni trop loin
      var bx = Math.round(player.pos.x + Math.cos(ang) * dd);
      var bz = Math.round(player.pos.z + Math.sin(ang) * dd);
      var gy = world.groundAt(bx, bz, true);
      if (gy <= 0) return null;
      var ground = world.getBlock(bx, gy, bz);
      if (ground !== B.GRASS && ground !== B.SAND && ground !== B.DIRT) return null;
      if (gy < C.SEA_LEVEL) return null;             // pas sous l'eau
      var s = SPECS[type];
      if (P.collides(world, bx + 0.5, gy + 1, bz + 0.5, s.w, s.h)) return null;
      return spawn(type, bx + 0.5, gy + 1, bz + 0.5);
    }

    /* Au lever du jour les zombies disparaissent, comme ils brûleraient au soleil. */
    function burnUndead(isNight) {
      if (isNight) return 0;
      var n = 0;
      for (var i = list.length - 1; i >= 0; i--) {
        if (list[i].type === 'zombie') { remove(list[i]); n++; }
      }
      return n;
    }

    return {
      list: list, SPECS: SPECS, spawn: spawn, dropItem: dropItem, remove: remove,
      damage: damage, update: update, mergeItems: mergeItems, aimedAt: aimedAt, rayBox: rayBox,
      tirer: tirer, stepArrow: stepArrow, capVers: capVers,
      separer: separer, separerEntites: separerEntites, ecarter: ecarter,
      countOf: countOf, trySpawn: trySpawn, burnUndead: burnUndead, stepBody: stepBody,
      stepAI: stepAI,
    };
  }

  MC.createEntities = createEntities;
  MC.EntitySpecs = SPECS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
