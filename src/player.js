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
  var CHANCE_MALADIE = 1 / 3;   // SPEC-OBJET-004 : viande ou poisson cru

  /* `regles` provient de Modes.regles(mode, difficulte). Le joueur ne connaît
     ni le mode ni la difficulté : il ne voit que des règles déjà résolues,
     ce qui évite de recombiner mode et difficulté à chaque usage. */
  var REGLES_DEFAUT = {
    vole: false, invulnerable: false, faim: true, degatsFamine: true,
    casseInstantanee: false, blocsIllimites: false, useDurabilite: true,
    regenMultiplicateur: 1, monstres: true, degatsMob: 1, permadeath: false,
  };

  function createPlayer(world, entities, regles) {
    var R = Object.assign({}, REGLES_DEFAUT, regles || {});
    var pl = {
      pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 },
      yaw: 0, pitch: 0, onGround: false, flying: !!R.vole, swimming: false,
      hp: MAX_HP, hunger: MAX_HUNGER, air: MAX_AIR, exhaustion: 0,
      inv: Inv.create(Inv.TOTAL), selected: 0,
      mining: null, attackCd: 0, regenT: 0, hurtFlash: 0,
      fallFrom: null, dead: false,
      // équipement (SPEC-OBJET-001/003) : quatre pièces d'armure et un bijou
      equip: { casque: null, plastron: null, jambieres: null, bottes: null, bijou: null },
      tirCd: 0, malade: 0, malaiseT: 0,
      w: PW, h: PH, eye: EYE, reach: REACH, regles: R,
    };

    function held() { return pl.inv.slots[pl.selected]; }
    function heldId() { var s = held(); return s ? s.id : 0; }

    /* ─── journal d'inventaire (B1, docs/vague-2/B1.md § 6) ──────────────────
       En ligne, `pl.journalInv` est un tableau fourni par game.js : chaque
       diminution prédite (pose, usure, munition, engrais, transformation du
       seau…) y est poussée AU MOMENT MÊME où elle a lieu — jamais reconstituée
       après coup, ce qu'un INV_MAJ arrivé entre-temps rendrait faux. Hors
       ligne, `journalInv` est absent : ces fonctions ne font alors que muter
       `pl.inv`, exactement comme avant. Le repas (`useOn` → 'eat') ne
       journalise PAS : c'est le message MANGER, envoyé à part par game.js,
       qui porte cette information au serveur. */
    function journaliser(op) {
      if (Array.isArray(pl.journalInv)) pl.journalInv.push(op);
    }
    // consomme n exemplaires de la case i (pose de bloc, engrais, munition…)
    function consommerCase(i, n) {
      var s = pl.inv.slots[i];
      var id = s && s.id;
      var pris = pl.inv.consumeAt(i, n);
      if (pris > 0 && id) journaliser({ i: i, id: id, n: pris });
      return pris;
    }
    // use l'outil de la case i d'un point (minage, coup porté, tir)
    function userCase(i) {
      var s = pl.inv.slots[i];
      var id = s && s.id;
      var r = pl.inv.wearTool(i);
      if (r && id) journaliser({ i: i, id: id, usure: 1 });
      return r;
    }
    // transforme la pile de la case i en `vers` (seau plein <-> vide)
    function transformerCase(i, vers) {
      var s = pl.inv.slots[i];
      if (!s) return null;
      var id = s.id;
      s.id = vers;
      journaliser({ i: i, id: id, vers: vers });
      return s;
    }

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
      if (swimming) {
        speed *= SWIM_DRAG;
        // le trident fend l'eau : on nage presque aussi vite qu'on marche
        var enMain = held() && C.def(held().id);
        if (enMain && enMain.nageRapide) speed *= 1.9;
      }
      // une toile d'araignée englue ; la lave, plus encore
      var englue = P.occupeAvec(world, pl.pos.x, pl.pos.y, pl.pos.z, PW, PH, 'ralentit');
      if (englue) speed *= englue.ralentit;
      pl.dansLave = !!P.dansLave(world, pl.pos, PW, PH);
      if (pl.dansLave) speed *= 0.35;
      if (pl.hunger <= 0) speed *= 0.6;              // affamé, on traîne
      speed *= vitesseBijou();                       // SPEC-OBJET-003 : bijou de saphir

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

      /* Échelles et lianes : on monte en avançant (ou en sautant), on
         redescend lentement sinon — et l'on n'y prend jamais de dégâts de chute. */
      var prise = !pl.flying && P.occupeAvec(world, pl.pos.x, pl.pos.y, pl.pos.z, PW, PH, 'grimpable');
      pl.grimpe = !!prise;
      if (prise) {
        if (keys.forward || keys.jump) pl.vel.y = 3.4;
        else if (keys.sprint) pl.vel.y = -3;
        else pl.vel.y = Math.max(pl.vel.y, -1.2);
        pl.fallFrom = null;
      }
      if (englue) pl.vel.y = Math.max(pl.vel.y * 0.5, -1.2);

      // suivi de chute, pour les dégâts à l'atterrissage
      if (!pl.flying && !swimming && !prise) {
        if (pl.vel.y > 0 || pl.onGround) pl.fallFrom = pl.pos.y;
        else if (pl.fallFrom === null) pl.fallFrom = pl.pos.y;
      } else pl.fallFrom = null;

      var before = pl.pos.y;
      // 0,5 bloc franchissable en marchant (SPEC-CONSTR-001) : une marche
      // d'escalier ou une dalle, jamais un bloc plein entier.
      var PAS_AUTO = (!pl.flying && pl.onGround) ? 0.55 : 0;
      var hit = P.move(world, pl, dt, PW, PH, PAS_AUTO);
      /* Se hisser hors de l'eau. La poussée de nage cesse dès que la poitrine
         émerge : trop tôt pour franchir un rebord, si bien qu'on restait
         prisonnier de la mer, même face à une plage au ras de l'eau. Nageant
         contre un rebord libre au-dessus, on reçoit juste l'élan qu'il faut. */
      if (!pl.flying && (hit.x || hit.z) && (wish.x || wish.z) &&
          (swimming || P.inWater(world, { x: pl.pos.x, y: pl.pos.y - 0.4, z: pl.pos.z }, PH))) {
        var elan = P.elanPourSortir(world, pl.pos, wish, PW, PH);
        if (elan > pl.vel.y) pl.vel.y = elan;
      }
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

    // ─── armure et bijou (SPEC-OBJET-001/003) ─────────────────────────────────
    var ARMOR_SLOTS = ['casque', 'plastron', 'jambieres', 'bottes'];
    /* Fraction de dégâts absorbée par l'armure et la résistance d'un bijou,
       plafonnée à 80 % : un joueur en diamant complet garde toujours une
       vulnérabilité. */
    function armureReduction() {
      var def = 0;
      ARMOR_SLOTS.forEach(function (k) {
        var s = pl.equip[k], d = s && C.def(s.id);
        if (d && d.defense) def += d.defense;
      });
      var bijou = pl.equip.bijou, bd = bijou && C.def(bijou.id);
      var bonus = (bd && bd.effet && bd.effet.type === 'resistance') ? bd.effet.valeur : 0;
      return Math.min(0.8, def * 0.04 + bonus);
    }
    // chaque coup encaissé use d'un point de durabilité chaque pièce portée
    function userArmure() {
      ARMOR_SLOTS.forEach(function (k) {
        var s = pl.equip[k];
        if (!s) return;
        var max = C.durabilityOf(s.id);
        if (!max) return;
        s.dmg = (s.dmg || 0) + 1;
        if (s.dmg >= max) pl.equip[k] = null;
      });
    }
    // vitesse (SPEC-OBJET-003) : un bijou de saphir presse le pas
    function vitesseBijou() {
      var bijou = pl.equip.bijou, bd = bijou && C.def(bijou.id);
      return (bd && bd.effet && bd.effet.type === 'vitesse') ? 1 + bd.effet.valeur : 1;
    }
    // chance au butin (SPEC-OBJET-003) : un bijou d'émeraude porte chance
    function chanceBijou() {
      var bijou = pl.equip.bijou, bd = bijou && C.def(bijou.id);
      return (bd && bd.effet && bd.effet.type === 'chance') ? bd.effet.valeur : 0;
    }

    // ─── survie ──────────────────────────────────────────────────────────────
    function hurt(n) {
      if (n <= 0 || pl.dead) return;
      if (R.invulnerable) return;          // créatif : rien ne blesse
      var reduc = armureReduction();
      var n2 = Math.max(0, Math.round(n * (1 - reduc)));
      userArmure();
      pl.hp = Math.max(0, pl.hp - n2);
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
      if (R.faim) {
        if (pl.exhaustion >= 4) { pl.exhaustion -= 4; pl.hunger = Math.max(0, pl.hunger - 1); }
        if (pl.hunger <= 0 && R.degatsFamine) {
          pl.starveT = (pl.starveT || 0) + dt;
          if (pl.starveT >= 4) { pl.starveT = 0; hurt(1); }
        } else pl.starveT = 0;
      } else {
        pl.hunger = MAX_HUNGER;            // créatif : la jauge reste pleine
        pl.exhaustion = 0;
      }

      // régénération : la difficulté en règle la vitesse
      if (pl.hunger >= 16 && pl.hp < MAX_HP) {
        pl.regenT += dt * (R.regenMultiplicateur || 1);
        if (pl.regenT >= 3.5) { pl.regenT = 0; heal(1); pl.exhaustion += 1.5; }
      } else pl.regenT = 0;

      // la lave brûle, vite et fort
      pl.lavaT = Math.max(0, (pl.lavaT || 0) - dt);
      var lave = P.dansLave(world, pl.pos, PW, PH);
      if (lave && pl.lavaT <= 0) { pl.lavaT = 0.5; hurt(lave.brule); }

      // les cactus piquent, par petites touches régulières
      pl.piqueT = Math.max(0, (pl.piqueT || 0) - dt);
      var pique = P.contact(world, pl.pos.x, pl.pos.y, pl.pos.z, PW, PH, 0.06, function (id) {
        return C.BLOCKS[id] && C.BLOCKS[id].hurts;
      });
      if (pique && pl.piqueT <= 0) { pl.piqueT = 0.6; hurt(C.BLOCKS[pique].hurts); }

      if (pl.hurtFlash > 0) pl.hurtFlash -= dt;
      if (pl.attackCd > 0) pl.attackCd -= dt;
      if (pl.tirCd > 0) pl.tirCd -= dt;

      // malaise (nourriture crue, gaz d'un piège — SPEC-OBJET-004/005) :
      // de petites brûlures régulières tant que l'effet dure
      if (pl.malade > 0) {
        pl.malade -= dt;
        pl.malaiseT += dt;
        if (pl.malaiseT >= 4) { pl.malaiseT = 0; hurt(1); }
      } else pl.malaiseT = 0;
    }

    /* Le climat sur le corps. Un froid mordant (≤ -10 °C) blesse peu à peu,
       d'autant plus vite qu'il gèle fort — sauf en paisible, où il ne tue pas ;
       une chaleur écrasante (≥ 38 °C) assoiffe : la faim se creuse plus vite. */
    var FROID_MORDANT = -10, CHALEUR_ECRASANTE = 38;
    function subirClimat(dt, tempC) {
      if (pl.dead || typeof tempC !== 'number') return null;
      pl.temperature = tempC;
      var effet = tempC <= FROID_MORDANT ? 'froid' : (tempC >= CHALEUR_ECRASANTE ? 'chaleur' : null);
      pl.climat = effet;
      if (effet === 'froid') {
        pl.froidT = (pl.froidT || 0) + dt * (1 + (FROID_MORDANT - tempC) / 10);
        if (pl.froidT >= 6) { pl.froidT = 0; if (R.degatsFamine) hurt(1); }
      } else pl.froidT = 0;
      if (effet === 'chaleur' && R.faim) pl.exhaustion += dt * 0.3 * (1 + (tempC - CHALEUR_ECRASANTE) / 10);
      return effet;
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
      // mode histoire : ce bloc ne se casse pas dans cette aventure
      if (target && MC.Modes && !MC.Modes.peutCasser(R, target.block)) {
        pl.mining = null; pl.interdit = 'casser';
        return null;
      }
      if (!target) { pl.mining = null; return null; }
      var same = pl.mining && pl.mining.x === target.x
              && pl.mining.y === target.y && pl.mining.z === target.z;
      if (!same) pl.mining = { x: target.x, y: target.y, z: target.z, t: 0 };

      var bt = C.breakTime(target.block, heldId());
      if (!isFinite(bt.seconds)) { pl.mining.total = Infinity; return null; }
      // créatif : tout cède d'un coup, et tout se récolte
      if (R.casseInstantanee && bt.seconds > 0) { bt = { seconds: 0, harvests: true }; }
      pl.mining.total = bt.seconds;
      pl.mining.t += dt;
      if (pl.mining.t < bt.seconds) return null;

      var id = target.block;
      // SPEC-MECA-003 : une batterie cassée garde son niveau d'énergie —
      // il faut le lire avant de vider le bloc, l'état ne survit pas seul.
      var niveauBatterie = (id === B.BATTERIE) ? (world.getEtat(target.x, target.y, target.z) & 15) : null;
      var drops;
      /* Casser une moitié de porte casse l'autre (même id, cherché juste
         au-dessus ou en dessous) et rend une seule porte, jamais deux. */
      if (C.estPorte(id)) {
        drops = bt.harvests ? [{ id: I.PORTE, n: 1 }] : [];
        world.setBlock(target.x, target.y, target.z, 0);
        if (world.getBlock(target.x, target.y + 1, target.z) === id) world.setBlock(target.x, target.y + 1, target.z, 0);
        else if (world.getBlock(target.x, target.y - 1, target.z) === id) world.setBlock(target.x, target.y - 1, target.z, 0);
      } else if (C.estTrappe(id)) {
        drops = bt.harvests ? [{ id: I.TRAPPE, n: 1 }] : [];
        world.setBlock(target.x, target.y, target.z, 0);
      } else {
        drops = C.dropsOf(id, bt.harvests, rand, chanceBijou());
        world.setBlock(target.x, target.y, target.z, 0);
        // un escalier cassé peut changer l'angle de ses voisins
        if (C.BLOCKS[id] && C.BLOCKS[id].forme === 'escalier') {
          MC.Formes.actualiserZoneEscalier(world, target.x, target.y, target.z);
        }
      }
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
      if (R.useDurabilite && C.BLOCKS[id] && C.BLOCKS[id].hardness > 0) {
        casse = userCase(pl.selected) === 'broken';
      }

      // une torche perd son support quand le bloc qui la portait disparait
      var tombees = world.dropUnsupported ? world.dropUnsupported(target.x, target.y, target.z) : [];
      for (var t = 0; t < tombees.length; t++) {
        var td = C.dropsOf(tombees[t][3], true, rand);
        for (var u = 0; u < td.length; u++) drops.push(td[u]);
      }

      for (var d = 0; d < drops.length; d++) {
        var dataDrop = (niveauBatterie !== null && drops[d].id === B.BATTERIE) ? { niveau: niveauBatterie } : undefined;
        entities.dropItem(target.x + 0.5, target.y + 0.5, target.z + 0.5,
                          drops[d].id, drops[d].n, rand, dataDrop);
      }
      return { broken: true, id: id, drops: drops, toolBroke: casse };
    }

    function cancelMining() { pl.mining = null; }

    /* Seau : vide, il puise une source d'eau visée ; plein, il la verse devant
       la face visée (la visée ordinaire traverse l'eau : on relance un rayon
       qui s'y arrête). */
    function utiliserSeau(etat) {
      var hit = P.raycast(world, eyePos(), lookDir(), REACH, function (id) { return id !== 0; });
      if (!hit) return null;
      if (etat === 'vide') {
        if (hit.block !== B.WATER) return null;
        world.setBlock(hit.x, hit.y, hit.z, 0);
        if (!R.blocsIllimites) consommerCase(pl.selected, 1);
        var reste = pl.inv.add(I.SEAU_EAU, 1);
        return reste ? 'seau_perdu' : 'puise';
      }
      var x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
      if (C.isWater(hit.block)) { x = hit.x; y = hit.y; z = hit.z; }
      var ici = world.getBlock(x, y, z);
      if (!C.isReplaceable(ici)) return null;
      world.setBlock(x, y, z, B.WATER);
      if (!R.blocsIllimites) transformerCase(pl.selected, I.SEAU);
      return 'verse';
    }

    /* Briquet (SPEC-CONSTR-007) : allume un feu sur la face visée, si elle
       peut prendre (un matériau inflammable tout près, ou un appui solide). */
    function utiliserBriquet() {
      var hit = P.raycast(world, eyePos(), lookDir(), REACH, function (id) { return id !== 0; });
      if (!hit) return null;
      var x = hit.x + hit.nx, y = hit.y + hit.ny, z = hit.z + hit.nz;
      if (y < 0 || y >= C.WORLD_H) return null;
      if (!C.isReplaceable(world.getBlock(x, y, z))) return null;
      if (!MC.Feu || !MC.Feu.peutAllumer(world.getBlock, x, y, z)) return null;
      world.setBlock(x, y, z, B.FEU);
      if (world.setEtat) world.setEtat(x, y, z, 0);
      return 'allume';
    }

    // ─── poser / utiliser ────────────────────────────────────────────────────
    /* Renvoie une chaîne décrivant ce qui s'est passé : 'place', 'till',
       'plant', 'open:craft', 'open:furnace', 'eat', ou null. */
    function useOn(target, rand) {
      if (!target) return null;
      var stack = held();
      var id = stack ? stack.id : 0;
      var tb = world.getBlock(target.x, target.y, target.z);
      var tdef = C.BLOCKS[tb];

      // interagir avec un bloc-interface a priorité (sauf si on est accroupi)
      if (tdef && tdef.interactive) return 'open:' + tdef.interactive;

      /* Lit (SPEC-INTERIEUR-002) : un clic droit sur un lit fait dormir,
         quel que soit ce qu'on tient en main — game.js décide de la suite
         (avancer le temps, fixer la réapparition). */
      if (tdef && tdef.dodo) return 'dormir';

      /* Présentoir/socle (SPEC-INTERIEUR-002) : main vide sur un présentoir
         qui expose déjà un objet le récupère ; sinon, avec un objet en main,
         on l'y pose (game.js gère le transfert avec `expositions`). */
      if (tdef && tdef.expose) return id ? 'exposer' : 'retirer';

      /* Porte ou trappe : un clic droit bascule, quel que soit ce qu'on tient
         en main. Les deux moitiés d'une porte partagent le même id : on
         retrouve l'autre moitié en cherchant ce même id juste au-dessus ou
         en dessous, et on la bascule avec. */
      if (tdef && (tdef.porte || tdef.trappe)) {
        var nouvId = C.bascule(tb);
        world.setBlock(target.x, target.y, target.z, nouvId);
        if (tdef.porte) {
          if (world.getBlock(target.x, target.y + 1, target.z) === tb) world.setBlock(target.x, target.y + 1, target.z, nouvId);
          else if (world.getBlock(target.x, target.y - 1, target.z) === tb) world.setBlock(target.x, target.y - 1, target.z, nouvId);
        }
        return 'bascule';
      }

      if (!id) return null;
      var idef = C.def(id);
      // mode histoire : cet objet ou ce bloc n'a pas sa place dans l'aventure
      if (MC.Modes && !MC.Modes.peutUtiliser(R, id)) { pl.interdit = 'utiliser'; return 'interdit'; }

      // la carte s'ouvre d'un clic droit
      if (idef && idef.carte) return 'carte';
      // livre ou note (SPEC-INTERIEUR-003) : un clic droit l'ouvre — en
      // écriture s'il n'est pas encore signé, en lecture sinon
      if (idef && idef.livre) return 'livre';
      if (idef && idef.seau) return utiliserSeau(idef.seau);
      if (idef && idef.briquet) return utiliserBriquet();
      // véhicule : c'est le jeu qui le fait apparaître (voir vehicules.js)
      if (idef && idef.vehicule) return 'vehicule:' + idef.vehicule;

      /* Porte : occupe deux blocs verticaux, orientée selon le regard du
         joueur (même convention que les façades des bâtiments générés).
         Trappe : un seul bloc, toujours posée fermée. */
      if (idef && idef.porte) {
        var bxp = target.x + target.nx, byp = target.y + target.ny, bzp = target.z + target.nz;
        if (byp < 0 || byp + 1 >= C.WORLD_H) return null;
        if (!C.isReplaceable(world.getBlock(bxp, byp, bzp)) ||
            !C.isReplaceable(world.getBlock(bxp, byp + 1, bzp))) return null;
        if (P.boxOverlap(bxp + 0.5, byp, bzp + 0.5, 1, 2, pl.pos.x, pl.pos.y, pl.pos.z, PW, PH)) return null;
        for (var ep = 0; ep < entities.list.length; ep++) {
          var enp = entities.list[ep];
          if (enp.type === 'item') continue;
          if (P.boxOverlap(bxp + 0.5, byp, bzp + 0.5, 1, 2, enp.pos.x, enp.pos.y, enp.pos.z, enp.w, enp.h)) return null;
        }
        var mur = C.orientDeRegard(lookDir());
        var idPorte = C.PORTE_FERMEE_LIST[mur];
        world.setBlock(bxp, byp, bzp, idPorte);
        world.setBlock(bxp, byp + 1, bzp, idPorte);
        if (!R.blocsIllimites) consommerCase(pl.selected, 1);
        return 'place';
      }
      if (idef && idef.trappe) {
        var bxt = target.x + target.nx, byt = target.y + target.ny, bzt = target.z + target.nz;
        if (byt < 0 || byt >= C.WORLD_H) return null;
        if (!C.isReplaceable(world.getBlock(bxt, byt, bzt))) return null;
        if (P.boxOverlap(bxt + 0.5, byt, bzt + 0.5, 1, 1, pl.pos.x, pl.pos.y, pl.pos.z, PW, PH)) return null;
        world.setBlock(bxt, byt, bzt, B.TRAPPE_FERMEE);
        if (!R.blocsIllimites) consommerCase(pl.selected, 1);
        return 'place';
      }

      /* Mobilier orienté (SPEC-INTERIEUR-002) : posé comme un bloc plein,
         mais son état porte l'orientation du regard (même convention que la
         porte, Core.orientDeRegard). Le lit occupe en plus la case dans le
         prolongement (tête, variante=true) — les deux blocs partagent le
         même id, seule leur variante d'état diffère (l'oreiller). */
      if (idef && idef.meuble) {
        var mx = target.x + target.nx, my = target.y + target.ny, mz = target.z + target.nz;
        if (my < 0 || my >= C.WORLD_H) return null;
        if (!C.isReplaceable(world.getBlock(mx, my, mz))) return null;
        if (P.boxOverlap(mx + 0.5, my, mz + 0.5, 1, 1, pl.pos.x, pl.pos.y, pl.pos.z, PW, PH)) return null;
        var orientM = C.orientDeRegard(lookDir());
        if (idef.meuble === 'lit') {
          var dM = MC.Formes.DIRS[orientM];
          var hx = mx + dM[0], hy = my, hz = mz + dM[1];
          if (!C.isReplaceable(world.getBlock(hx, hy, hz))) return null;
          if (P.boxOverlap(hx + 0.5, hy, hz + 0.5, 1, 1, pl.pos.x, pl.pos.y, pl.pos.z, PW, PH)) return null;
          world.setBlock(mx, my, mz, id);
          world.setEtat(mx, my, mz, MC.Formes.packMeuble(orientM, false));
          world.setBlock(hx, hy, hz, id);
          world.setEtat(hx, hy, hz, MC.Formes.packMeuble(orientM, true));
        } else {
          world.setBlock(mx, my, mz, id);
          world.setEtat(mx, my, mz, MC.Formes.packMeuble(orientM, false));
        }
        if (!R.blocsIllimites) consommerCase(pl.selected, 1);
        return 'place';
      }

      /* Dalle (SPEC-CONSTR-002) : moitié basse ou haute selon l'endroit
         visé (hauteur du point cliqué sur la face du bloc), et deux dalles
         du même matériau font un bloc plein — MC.Formes.decisionDalle
         centralise la règle, ici on ne fait que lire la visée et écrire. */
      if (idef && tdef && tdef.forme === 'dalle') {
        var eDalle = eyePos(), dDalle = lookDir();
        var fracY = Math.max(0, Math.min(1, (eDalle.y + dDalle.y * target.t) - target.y));
        var decision = MC.Formes.decisionDalle({
          memeMateriau: tb === id, moitieVisee: world.getEtat(target.x, target.y, target.z) ? 'haut' : 'bas',
          normaleY: target.ny, fracY: fracY,
        });
        if (decision.action === 'fusion') {
          world.setBlock(target.x, target.y, target.z, tdef.mat);
          world.setEtat(target.x, target.y, target.z, 0);
          if (!R.blocsIllimites) consommerCase(pl.selected, 1);
          // la case modifiée est celle visée (target), pas la case adjacente
          // où un bloc se pose d'ordinaire — SPEC-CONSTR-002 : à distinguer
          // pour que la synchronisation réseau annonce la bonne position.
          return 'place-ici';
        }
      }
      if (idef && idef.forme === 'dalle') {
        var bxd = target.x + target.nx, byd = target.y + target.ny, bzd = target.z + target.nz;
        if (byd < 0 || byd >= C.WORLD_H) return null;
        var eDalle2 = eyePos(), dDalle2 = lookDir();
        var fracY2 = Math.max(0, Math.min(1, (eDalle2.y + dDalle2.y * target.t) - target.y));
        var dec2 = MC.Formes.decisionDalle({ memeMateriau: false, normaleY: target.ny, fracY: fracY2 });
        var cible = world.getBlock(bxd, byd, bzd);
        // même dalle déjà en place (moitié opposée) dans la case adjacente : fusion là aussi
        if (cible === id) {
          var moitieCible = world.getEtat(bxd, byd, bzd) ? 'haut' : 'bas';
          if (moitieCible !== dec2.moitie) {
            world.setBlock(bxd, byd, bzd, idef.mat);
            world.setEtat(bxd, byd, bzd, 0);
            if (!R.blocsIllimites) consommerCase(pl.selected, 1);
            return 'place';
          }
          return null;
        }
        if (!C.isReplaceable(cible)) return null;
        world.setBlock(bxd, byd, bzd, id);
        world.setEtat(bxd, byd, bzd, MC.Formes.packDalle(dec2.moitie === 'haut'));
        if (!R.blocsIllimites) consommerCase(pl.selected, 1);
        return 'place';
      }

      /* Engrais : une culture mûrit d'un coup ; sur l'herbe, il fait pousser
         herbes hautes et fleurs alentour. */
      if (idef && idef.engrais) {
        var tst = C.BLOCKS[tb] && C.BLOCKS[tb].stage;
        if (tst !== undefined && tst < 3) {
          world.setBlock(target.x, target.y, target.z, C.WHEAT_STAGES[3]);
          if (!R.blocsIllimites) consommerCase(pl.selected, 1);
          return 'grow';
        }
        if (tb === B.GRASS) {
          var n = 0;
          for (var gx = -2; gx <= 2; gx++) for (var gz = -2; gz <= 2; gz++) {
            if (world.getBlock(target.x + gx, target.y, target.z + gz) !== B.GRASS) continue;
            if (world.getBlock(target.x + gx, target.y + 1, target.z + gz) !== 0) continue;
            if (((gx * 7 + gz * 13 + target.x + target.z) & 3) === 0) continue;   // un peu d'irrégularité
            var fl = ((gx + gz) & 3) === 0 ? B.FLOWER_RED : ((gx - gz) & 3) === 0 ? B.FLOWER_YELLOW : B.TALL_GRASS;
            world.setBlock(target.x + gx, target.y + 1, target.z + gz, fl);
            n++;
          }
          if (n && !R.blocsIllimites) consommerCase(pl.selected, 1);
          return n ? 'grow' : null;
        }
        return null;
      }

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
          if (!R.blocsIllimites) consommerCase(pl.selected, 1);
          return 'plant';
        }
        return null;
      }

      // aliment : on mange si la faim n'est pas pleine
      if (idef && idef.food) {
        // un aliment qui soigne se mange même rassasié
        if (pl.hunger >= MAX_HUNGER && !(idef.soin && pl.hp < MAX_HP)) return null;
        pl.hunger = Math.min(MAX_HUNGER, pl.hunger + idef.food);
        if (idef.soin) heal(idef.soin);
        // cru (SPEC-OBJET-004) : un tiers du temps, ça rend malade un moment
        if (idef.cru && (rand || Math.random)() < CHANCE_MALADIE) {
          pl.malade += 20; pl.malaiseT = 0;
        }
        pl.inv.consumeAt(pl.selected, 1);
        // la soupe rend son bol
        if (idef.rend) {
          var reste = pl.inv.add(idef.rend, 1);
          if (reste && entities.dropItem) entities.dropItem(pl.pos.x, pl.pos.y + 1, pl.pos.z, idef.rend, reste);
        }
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
      /* SPEC-MECA-007 : bloc de commande — hors ligne, seul le mode créatif
         y touche (en ligne, le serveur fait de toute façon foi : voir
         server.js/blocAutorise, qui corrige toute prédiction locale). */
      if (bdef && bdef.circuit && bdef.circuit.adminSeul && MC.Circuits
          && !MC.Circuits.commandeAutorisee({ enLigne: false, mode: R.blocsIllimites ? 'creatif' : 'survie' })) return null;

      world.setBlock(bx, by, bz, id);
      /* Escalier (SPEC-CONSTR-001) : orienté selon le regard, inversé si le
         plafond est plein juste au-dessus, puis les angles s'ajustent
         d'eux-mêmes à lui et à ses 4 voisins horizontaux. */
      if (bdef && bdef.forme === 'escalier') {
        var sousPlafond = C.isSolid(world.getBlock(bx, by + 1, bz));
        world.setEtat(bx, by, bz, MC.Formes.orientationPose(lookDir(), sousPlafond));
        MC.Formes.actualiserZoneEscalier(world, bx, by, bz);
      }
      // SPEC-MECA-003 : une batterie reposée retrouve le niveau qu'elle
      // portait sur sa pile (0 si elle n'en portait pas — batterie neuve).
      if (bdef && bdef.circuit && bdef.circuit.type === 'batterie') {
        var stPose = held();
        world.setEtat(bx, by, bz, (stPose && stPose.data && stPose.data.niveau) || 0);
      }
      if (!R.blocsIllimites) consommerCase(pl.selected, 1);
      return 'place';
    }

    // ─── frapper ─────────────────────────────────────────────────────────────
    function attack(entity) {
      if (!entity || pl.attackCd > 0) return null;
      var s = held();
      var d = s ? C.def(s.id) : null;
      // cadence et recul propres à l'arme (SPEC-OBJET-002), 0.45s/×1 sinon
      pl.attackCd = (d && d.cadence !== undefined) ? d.cadence : 0.45;
      var dmg = (d && d.damage) ? d.damage : 1;
      var reculMul = (d && d.recul !== undefined) ? d.recul : 1;
      pl.exhaustion += 0.1;
      var killed = entities.damage(entity, dmg, pl.pos, pl, reculMul);
      var casse = R.useDurabilite && userCase(pl.selected) === 'broken';
      return { damage: dmg, killed: killed, toolBroke: casse };
    }
    // portée de visée de l'arme en main (SPEC-OBJET-002), REACH sinon
    function reachArme() {
      var s = held(), d = s && C.def(s.id);
      return (d && d.portee) || REACH;
    }

    /* Tir a l'arc. Renvoie {entity, munition} ou null si l'on n'a pas
       l'arme en main ou pas de munition. */
    function tirer() {
      var st = held();
      if (!st) return null;
      var d = C.def(st.id);
      if (!d || !d.ranged) return null;
      // cadence de tir (SPEC-OBJET-002) : l'arbalète lourde recharge lentement
      if (pl.tirCd > 0) return null;

      var dir = lookDir();
      var o = eyePos();
      var depart = { x: o.x + dir.x * 0.4, y: o.y + dir.y * 0.4, z: o.z + dir.z * 0.4 };
      var e;
      if (d.sansMunition) {
        // bâton : un sortilège, sans rien consommer
        e = entities.tirer(depart, dir, d.vitesseTir || 30, d.degatsTir || 6, pl, d.ranged);
      } else {
        // munition : on cherche la premiere pile dont l'`ammoType` correspond
        // a l'arme (fleche pour l'arc/l'arbalete, galet pour la fronde)
        var iMun = -1;
        for (var i = 0; i < pl.inv.slots.length; i++) {
          var s2 = pl.inv.slots[i];
          var d2 = s2 && C.def(s2.id);
          if (d2 && d2.ammo && (!d2.ammoType || d2.ammoType === d.ranged)) { iMun = i; break; }
        }
        if (iMun < 0 && !R.blocsIllimites) return null;
        var munId = iMun >= 0 ? pl.inv.slots[iMun].id : I.FLECHE;
        if (iMun >= 0 && !R.blocsIllimites) consommerCase(iMun, 1);
        // arbalète, arc de la jungle, fronde… : plus rapides, plus forts
        e = entities.tirer(depart, dir, d.vitesseTir || 34,
                           ((C.def(munId) && C.def(munId).damage) || 5) + (d.bonusTir || 0), pl, d.ranged);
      }

      pl.tirCd = d.cadenceTir || 0;
      var casse = R.useDurabilite && userCase(pl.selected) === 'broken';
      pl.exhaustion += 0.05;
      return { entity: e, munition: d.sansMunition ? 0 : munId, toolBroke: casse };
    }

    function pickUp(id, n, data) { return data !== undefined ? pl.inv.addStack(id, n, data) : pl.inv.add(id, n); }

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
      updateMovement: updateMovement, updateSurvival: updateSurvival, subirClimat: subirClimat,
      hurt: hurt, heal: heal, respawn: respawn, aim: aim,
      mineTick: mineTick, cancelMining: cancelMining, useOn: useOn,
      attack: attack, tirer: tirer, pickUp: pickUp, dropSelected: dropSelected,
      reachArme: reachArme, armureReduction: armureReduction, chanceBijou: chanceBijou,
      regles: R, MAX_HP: MAX_HP, MAX_HUNGER: MAX_HUNGER, MAX_AIR: MAX_AIR,
      PW: PW, PH: PH, EYE: EYE, REACH: REACH,
    };
  }

  MC.createPlayer = createPlayer;
  MC.PlayerConst = { PW: PW, PH: PH, EYE: EYE, MAX_HP: MAX_HP,
                     MAX_HUNGER: MAX_HUNGER, MAX_AIR: MAX_AIR, REACH: REACH };
})(typeof globalThis !== 'undefined' ? globalThis : this);
