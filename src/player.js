/* player.js — état du joueur, déplacement, survie et actions (miner, poser,
   labourer, planter, frapper, manger). Logique pure. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core, P = MC.Physics, Inv = MC.Inventory;
  var B = C.B, I = C.I;

  var PW = 0.6, PH = 1.8, EYE = 1.62;
  var GRAVITY = 30, JUMP = 9.2, WALK = 4.8, RUN = 7.4, FLY = 12, ACCEL = 14;
  var SWIM_GRAVITY = 0.28, SWIM_SINK_MAX = 3.2, SWIM_UP = 4.2, SWIM_DRAG = 0.62;
  var MAX_HP = 20, MAX_HUNGER = 20, MAX_AIR = 10, REACH = 5;

  function createPlayer(world, entities) {
    var pl = {
      pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
      yaw: 0, pitch: 0, onGround: false, flying: false, swimming: false,
      hp: MAX_HP, hunger: MAX_HUNGER, air: MAX_AIR, exhaustion: 0,
      inv: Inv.create(Inv.TOTAL), selected: 0,
      mining: null, attackCd: 0, regenT: 0, hurtFlash: 0,
      fallFrom: null, dead: false,
      w: PW, h: PH, eye: EYE, reach: REACH,
    };

    function held() { return pl.inv.slots[pl.selected]; }
    function heldId() { var s = held(); return s ? s.id : 0; }

    function lookDir() {
      var cp = Math.cos(pl.pitch);
      return { x: -Math.sin(pl.yaw) * cp, y: Math.sin(pl.pitch), z: -Math.cos(pl.yaw) * cp };
    }
    function eyePos() { return { x: pl.pos.x, y: pl.pos.y + EYE, z: pl.pos.z }; }

    // ─── déplacement ─────────────────────────────────────────────────────────
    function updateMovement(dt, keys) {
      var fwd = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
      var strafe = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      var wish = P.wishDirection(pl.yaw, fwd, strafe);

      var swimming = !pl.flying && P.inWater(world, pl.pos, PH);
      pl.swimming = swimming;
      var running = keys.sprint && !swimming;
      var speed = pl.flying ? FLY : (running ? RUN : WALK);
      if (swimming) speed *= SWIM_DRAG;
      if (pl.hunger <= 0) speed *= 0.6;              // affamé, on traîne

      pl.vel.x = P.approach(pl.vel.x, wish.x * speed, ACCEL, dt);
      pl.vel.z = P.approach(pl.vel.z, wish.z * speed, ACCEL, dt);

      if (pl.flying) {
        var up = (keys.jump ? 1 : 0) - (keys.sprint ? 1 : 0);
        pl.vel.y = P.approach(pl.vel.y, up * FLY, ACCEL, dt);
      } else if (swimming) {
        pl.vel.y -= GRAVITY * SWIM_GRAVITY * dt;
        if (keys.jump) pl.vel.y = P.approach(pl.vel.y, SWIM_UP, ACCEL, dt);
        else if (keys.sprint) pl.vel.y = P.approach(pl.vel.y, -SWIM_UP, ACCEL, dt);
        if (pl.vel.y < -SWIM_SINK_MAX) pl.vel.y = -SWIM_SINK_MAX;
      } else {
        pl.vel.y -= GRAVITY * dt;
        if (pl.vel.y < -55) pl.vel.y = -55;
        if (keys.jump && pl.onGround) {
          pl.vel.y = JUMP; pl.onGround = false;
          pl.exhaustion += running ? 0.2 : 0.05;
        }
      }

      // suivi de chute, pour les dégâts à l'atterrissage
      if (!pl.flying && !swimming) {
        if (pl.vel.y > 0 || pl.onGround) pl.fallFrom = pl.pos.y;
        else if (pl.fallFrom === null) pl.fallFrom = pl.pos.y;
      } else pl.fallFrom = null;

      var before = pl.pos.y;
      var hit = P.move(world, pl, dt, PW, PH);
      pl.onGround = hit.landed ? true : (hit.y ? pl.onGround : false);

      if (hit.landed && pl.fallFrom !== null) {
        var fall = pl.fallFrom - pl.pos.y;
        if (fall > 3.5 && !swimming) hurt(Math.floor(fall - 3.5));
        pl.fallFrom = null;
      }

      var moved = Math.hypot(pl.vel.x, pl.vel.z) * dt;
      pl.exhaustion += moved * (running ? 0.02 : 0.006);
      if (before !== pl.pos.y) { /* rien : placeholder pour la lisibilité */ }
    }

    // ─── survie ──────────────────────────────────────────────────────────────
    function hurt(n) {
      if (n <= 0 || pl.dead) return;
      pl.hp = Math.max(0, pl.hp - n);
      pl.hurtFlash = 0.4;
      if (pl.hp === 0) pl.dead = true;
    }
    function heal(n) { pl.hp = Math.min(MAX_HP, pl.hp + n); }

    function updateSurvival(dt) {
      if (pl.dead) return;

      // noyade
      if (P.headInWater(world, pl.pos, EYE)) {
        pl.air -= dt;
        if (pl.air < 0) { pl.air = 0; pl.drownT = (pl.drownT || 0) + dt;
                          if (pl.drownT >= 1) { pl.drownT = 0; hurt(2); } }
      } else { pl.air = Math.min(MAX_AIR, pl.air + dt * 4); pl.drownT = 0; }

      // faim : l'épuisement se convertit en points de faim
      if (pl.exhaustion >= 4) { pl.exhaustion -= 4; pl.hunger = Math.max(0, pl.hunger - 1); }
      if (pl.hunger <= 0) {
        pl.starveT = (pl.starveT || 0) + dt;
        if (pl.starveT >= 4) { pl.starveT = 0; hurt(1); }
      } else pl.starveT = 0;

      // régénération
      if (pl.hunger >= 16 && pl.hp < MAX_HP) {
        pl.regenT += dt;
        if (pl.regenT >= 3.5) { pl.regenT = 0; heal(1); pl.exhaustion += 1.5; }
      } else pl.regenT = 0;

      if (pl.hurtFlash > 0) pl.hurtFlash -= dt;
      if (pl.attackCd > 0) pl.attackCd -= dt;
    }

    function respawn(spawnPos) {
      pl.hp = MAX_HP; pl.hunger = MAX_HUNGER; pl.air = MAX_AIR;
      pl.dead = false; pl.vel.x = pl.vel.y = pl.vel.z = 0;
      pl.exhaustion = 0; pl.fallFrom = null;
      pl.pos.x = spawnPos.x; pl.pos.y = spawnPos.y; pl.pos.z = spawnPos.z;
    }

    // ─── visée ───────────────────────────────────────────────────────────────
    function aim() {
      return P.raycast(world, eyePos(), lookDir(), REACH, function (id) {
        if (id === 0) return false;
        var d = C.BLOCKS[id];
        return !!d && !d.liquid;       // les plantes sont visables, pas l'eau
      });
    }

    // ─── minage progressif ───────────────────────────────────────────────────
    /* Renvoie {broken:true, id, drops} au moment où le bloc cède, sinon null.
       `rand` injectable pour des tests déterministes. */
    function mineTick(dt, target, rand) {
      if (!target) { pl.mining = null; return null; }
      var same = pl.mining && pl.mining.x === target.x
              && pl.mining.y === target.y && pl.mining.z === target.z;
      if (!same) pl.mining = { x: target.x, y: target.y, z: target.z, t: 0 };

      var bt = C.breakTime(target.block, heldId());
      if (!isFinite(bt.seconds)) { pl.mining.total = Infinity; return null; }
      pl.mining.total = bt.seconds;
      pl.mining.t += dt;
      if (pl.mining.t < bt.seconds) return null;

      var id = target.block;
      var drops = C.dropsOf(id, bt.harvests, rand);
      world.setBlock(target.x, target.y, target.z, 0);
      // une plante posée sur un bloc cassé tombe aussi
      var above = world.getBlock(target.x, target.y + 1, target.z);
      if (above && C.BLOCKS[above] && C.BLOCKS[above].plant) {
        var ad = C.dropsOf(above, true, rand);
        world.setBlock(target.x, target.y + 1, target.z, 0);
        for (var i = 0; i < ad.length; i++) drops.push(ad[i]);
      }
      pl.mining = null;
      pl.exhaustion += 0.05;

      // usure de l'outil : seulement si le bloc avait une durete non nulle,
      // sinon faucher de l'herbe userait une pioche
      var casse = false;
      if (C.BLOCKS[id] && C.BLOCKS[id].hardness > 0) {
        casse = pl.inv.wearTool(pl.selected) === 'broken';
      }

      // une torche perd son support quand le bloc qui la portait disparait
      var tombees = world.dropUnsupported ? world.dropUnsupported(target.x, target.y, target.z) : [];
      for (var t = 0; t < tombees.length; t++) {
        var td = C.dropsOf(tombees[t][3], true, rand);
        for (var u = 0; u < td.length; u++) drops.push(td[u]);
      }

      for (var d = 0; d < drops.length; d++)
        entities.dropItem(target.x + 0.5, target.y + 0.5, target.z + 0.5,
                          drops[d].id, drops[d].n, rand);
      return { broken: true, id: id, drops: drops, toolBroke: casse };
    }

    function cancelMining() { pl.mining = null; }

    // ─── poser / utiliser ────────────────────────────────────────────────────
    /* Renvoie une chaîne décrivant ce qui s'est passé : 'place', 'till',
       'plant', 'open:craft', 'open:furnace', 'eat', ou null. */
    function useOn(target) {
      if (!target) return null;
      var stack = held();
      var id = stack ? stack.id : 0;
      var tb = world.getBlock(target.x, target.y, target.z);
      var tdef = C.BLOCKS[tb];

      // interagir avec un bloc-interface a priorité (sauf si on est accroupi)
      if (tdef && tdef.interactive) return 'open:' + tdef.interactive;

      if (!id) return null;
      var idef = C.def(id);

      // houe : herbe/terre -> terre labourée
      if (idef && idef.tool === 'hoe') {
        if ((tb === B.GRASS || tb === B.DIRT)
            && C.isReplaceable(world.getBlock(target.x, target.y + 1, target.z))) {
          world.setBlock(target.x, target.y, target.z, B.FARMLAND);
          pl.exhaustion += 0.05;
          return 'till';
        }
        return null;
      }

      // graines : uniquement sur de la terre labourée
      if (idef && idef.plantable) {
        var px = target.x + target.nx, py = target.y + target.ny, pz = target.z + target.nz;
        if (tb === B.FARMLAND && target.ny === 1
            && C.isReplaceable(world.getBlock(px, py, pz))) {
          world.setBlock(px, py, pz, idef.plantable);
          pl.inv.consumeAt(pl.selected, 1);
          return 'plant';
        }
        return null;
      }

      // aliment : on mange si la faim n'est pas pleine
      if (idef && idef.food) {
        if (pl.hunger >= MAX_HUNGER) return null;
        pl.hunger = Math.min(MAX_HUNGER, pl.hunger + idef.food);
        pl.inv.consumeAt(pl.selected, 1);
        return 'eat';
      }

      // pose d'un bloc
      if (!C.isBlock(id)) return null;
      var bx = target.x + target.nx, by = target.y + target.ny, bz = target.z + target.nz;
      if (by < 0 || by >= C.WORLD_H) return null;
      if (!C.isReplaceable(world.getBlock(bx, by, bz))) return null;
      // ne pas s'emmurer : le bloc ne doit pas chevaucher le joueur
      if (C.isSolid(id) && P.boxOverlap(bx + 0.5, by, bz + 0.5, 1, 1,
                                        pl.pos.x, pl.pos.y, pl.pos.z, PW, PH)) return null;
      // ni un mob
      for (var e = 0; e < entities.list.length; e++) {
        var en = entities.list[e];
        if (en.type === 'item') continue;
        if (C.isSolid(id) && P.boxOverlap(bx + 0.5, by, bz + 0.5, 1, 1,
                                          en.pos.x, en.pos.y, en.pos.z, en.w, en.h)) return null;
      }
      // une torche exige un support : sol ou paroi adjacente
      var bdef = C.BLOCKS[id];
      if (bdef && bdef.needsSupport && world.hasSupport && !world.hasSupport(bx, by, bz)) return null;

      world.setBlock(bx, by, bz, id);
      pl.inv.consumeAt(pl.selected, 1);
      return 'place';
    }

    // ─── frapper ─────────────────────────────────────────────────────────────
    function attack(entity) {
      if (!entity || pl.attackCd > 0) return null;
      pl.attackCd = 0.45;
      var s = held();
      var d = s ? C.def(s.id) : null;
      var dmg = (d && d.damage) ? d.damage : 1;
      pl.exhaustion += 0.1;
      var killed = entities.damage(entity, dmg, pl.pos);
      var casse = pl.inv.wearTool(pl.selected) === 'broken';
      return { damage: dmg, killed: killed, toolBroke: casse };
    }

    function pickUp(id, n) { return pl.inv.add(id, n); }

    /* Jette `n` exemplaires de la case selectionnee, devant le joueur.
       Sans ca, un inventaire plein condamne a perdre tout nouveau butin. */
    function dropSelected(n, rand) {
      var st = pl.inv.slots[pl.selected];
      if (!st) return null;
      var take = Math.min(st.n, n === undefined ? 1 : n);
      var id = st.id;
      pl.inv.consumeAt(pl.selected, take);
      var d = lookDir();
      var e = entities.dropItem(pl.pos.x + d.x * 0.8, pl.pos.y + 1.2, pl.pos.z + d.z * 0.8,
                                id, take, rand);
      // on lance l'objet devant soi et on l'empeche d'etre repris aussitot
      e.vel.x = d.x * 5; e.vel.y = 2.2; e.vel.z = d.z * 5;
      e.pickup = 1.0;
      return { id: id, n: take, entity: e };
    }

    return {
      state: pl, held: held, heldId: heldId, lookDir: lookDir, eyePos: eyePos,
      updateMovement: updateMovement, updateSurvival: updateSurvival,
      hurt: hurt, heal: heal, respawn: respawn, aim: aim,
      mineTick: mineTick, cancelMining: cancelMining, useOn: useOn,
      attack: attack, pickUp: pickUp, dropSelected: dropSelected,
      MAX_HP: MAX_HP, MAX_HUNGER: MAX_HUNGER, MAX_AIR: MAX_AIR,
      PW: PW, PH: PH, EYE: EYE, REACH: REACH,
    };
  }

  MC.createPlayer = createPlayer;
  MC.PlayerConst = { PW: PW, PH: PH, EYE: EYE, MAX_HP: MAX_HP,
                     MAX_HUNGER: MAX_HUNGER, MAX_AIR: MAX_AIR, REACH: REACH };
})(typeof globalThis !== 'undefined' ? globalThis : this);
