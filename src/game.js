/* game.js — orchestration : boucle, streaming des chunks, machine à états,
   et câblage entre entrées, monde, joueur, entités et interface. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core, P = MC.Physics, Inv = MC.Inventory, DC = MC.DayCycle;
  var B = C.B, I = C.I;

  var GEN_BUDGET = 2, MESH_BUDGET = 2;     // par frame, pour ne pas saccader
  var SPAWN_INTERVAL = 3.5;

  function createGame(host) {
    var atlas = MC.buildAtlas();
    var render = MC.createRenderer(host, atlas, { renderDist: 5 });
    var canvas = render.renderer.domElement;

    var SEED = 20260921;
    var world = MC.createWorld(SEED);
    var entities = MC.createEntities(world);
    var player = MC.createPlayer(world, entities);
    var furnaces = Object.create(null);
    var chests = Object.create(null);
    var audio = MC.createAudio();

    var g = {
      world: world, entities: entities, player: player, render: render,
      time: 60, fps: 0, furnaces: furnaces, chests: chests, audio: audio,
      disposeChunk: render.disposeChunk,
    };

    var ui = MC.createUI(host, atlas, {
      onSelectSlot: selectSlot,
      onPlay: startGame,
      onResume: resume,
      onSave: function () { doSave(true); },
      onQuit: toMenu,
      onRespawn: respawn,
      onSound: function (n) { audio.play(n); },
    });

    var input = MC.createInput(canvas, {
      onLook: function (dyaw, dpitch) {
        var s = player.state;
        s.yaw += dyaw;
        s.pitch += dpitch;
        var lim = Math.PI / 2 - 0.001;
        s.pitch = Math.max(-lim, Math.min(lim, s.pitch));
      },
      onAttack: onAttack,
      onUse: onUse,
      onScroll: function (d) {
        selectSlot((player.state.selected + d + Inv.HOTBAR_SIZE) % Inv.HOTBAR_SIZE);
      },
      onSelectSlot: selectSlot,
      onToggleFly: function () {
        player.state.flying = !player.state.flying;
        player.state.vel.y = 0;
        ui.toast(player.state.flying ? 'Vol activé' : 'Vol désactivé');
      },
      onKey: onKey,
      onKeyAnyState: onKeyAnyState,
      onEscape: onEscape,
      onState: onStateChange,
      onLockError: function (msg) {
        ui.setLockHint('La capture de la souris a été refusée (' + msg +
                       '). Cliquez à nouveau — le navigateur impose un court délai après Échap.');
      },
      onLockGained: function () { ui.setLockHint(''); },
    });
    g.input = input;
    g.ui = ui;

    // ─── états ───────────────────────────────────────────────────────────────
    function onStateChange(next) {
      if (next === 'playing') { ui.hideScreen(); }
      else if (next === 'paused') { ui.menuPause(); }
      else if (next === 'menu') { ui.menuPrincipal(MC.Save.hasSave(storage())); }
      else if (next === 'dead') { ui.ecranMort(); }
      if (next !== 'ui' && ui.isContainerOpen()) forceCloseContainer();
    }

    function storage() {
      try { return window.localStorage; } catch (e) { return null; }
    }

    function resume() {
      audio.resume();      // l'audio n'est autorisé qu'après un geste utilisateur
      if (player.state.dead) { input.setState('dead'); return; }
      input.setState('playing');
    }
    function toMenu() { input.setState('menu'); }

    function startGame(forceNew) {
      audio.resume();
      var st = storage();
      if (!forceNew && st && MC.Save.hasSave(st)) {
        if (MC.Save.load(st, g)) {
          ui.toast('Partie chargée');
          prime();
          input.setState('playing');
          return;
        }
      }
      if (forceNew && st) MC.Save.clear(st);
      newWorld();
      input.setState('playing');
    }

    function newWorld() {
      world.reset(render.disposeChunk);        // vide AUSSI le registre de lumieres
      entities.list.length = 0;
      render.libererToutesEntites();           // libere geometries ET materiaux
      for (var k in furnaces) delete furnaces[k];
      for (var k2 in chests) delete chests[k2];
      var s = player.state;
      s.inv.load([]);
      s.hp = 20; s.hunger = 20; s.air = 10; s.dead = false;
      s.flying = false; s.selected = 0; s.exhaustion = 0;
      g.time = 60;
      placeAtSpawn();
      prime();
      ui.toast('Nouveau monde');
    }

    function placeAtSpawn() {
      var col = world.findSpawnColumn();
      var s = player.state;
      s.pos.x = col[0] + 0.5; s.pos.y = C.WORLD_H; s.pos.z = col[1] + 0.5;
      s.vel.x = s.vel.y = s.vel.z = 0;
      streamChunks(true);
      s.pos.y = world.groundAt(col[0], col[1], true) + 1.2;
      g.spawnPoint = { x: s.pos.x, y: s.pos.y, z: s.pos.z };
    }

    function respawn() {
      var sp = g.spawnPoint;
      if (!sp) { placeAtSpawn(); sp = g.spawnPoint; }
      // on réapparaît sur un sol valide même si le terrain a changé
      var gy = world.groundAt(Math.floor(sp.x), Math.floor(sp.z), true);
      player.respawn({ x: sp.x, y: gy + 1.2, z: sp.z });
      input.setState('playing');
      ui.toast('Réapparition');
    }

    function prime() {
      // génère le voisinage d'un coup : pas d'écran vide au démarrage
      streamChunks(true);
      var s = player.state;
      if (P.collides(world, s.pos.x, s.pos.y, s.pos.z, player.PW, player.PH)) {
        s.pos.y = world.groundAt(Math.floor(s.pos.x), Math.floor(s.pos.z), true) + 1.2;
      }
      g.spawnPoint = g.spawnPoint || { x: s.pos.x, y: s.pos.y, z: s.pos.z };
    }

    // ─── streaming des chunks ────────────────────────────────────────────────
    function streamChunks(unlimited) {
      var s = player.state;
      var pcx = Math.floor(s.pos.x / C.CHUNK_X), pcz = Math.floor(s.pos.z / C.CHUNK_Z);
      var R = render.RENDER_DIST;
      var wanted = [];
      for (var dx = -R; dx <= R; dx++) for (var dz = -R; dz <= R; dz++) {
        var d2 = dx * dx + dz * dz;
        if (d2 > R * R) continue;
        wanted.push([d2, pcx + dx, pcz + dz]);
      }
      wanted.sort(function (a, b) { return a[0] - b[0]; });

      var genMax = unlimited ? 1e9 : GEN_BUDGET, meshMax = unlimited ? 1e9 : MESH_BUDGET;
      var gen = 0;
      for (var i = 0; i < wanted.length && gen < genMax; i++) {
        var cx = wanted[i][1], cz = wanted[i][2];
        if (world.chunks.has(world.key(cx, cz))) continue;
        world.getChunk(cx, cz, true);
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) {
          var n = world.chunks.get(world.key(cx + o[0], cz + o[1]));
          if (n) n.dirty = true;
        });
        gen++;
      }

      var meshed = 0;
      for (var j = 0; j < wanted.length && meshed < meshMax; j++) {
        var mx = wanted[j][1], mz = wanted[j][2];
        var c = world.chunks.get(world.key(mx, mz));
        if (!c || !c.dirty) continue;
        // on n'affiche un chunk que si ses 4 voisins existent : sinon des
        // faces de bordure seraient maillées à tort et l'on verrait des coutures
        if (!world.chunks.has(world.key(mx + 1, mz)) || !world.chunks.has(world.key(mx - 1, mz)) ||
            !world.chunks.has(world.key(mx, mz + 1)) || !world.chunks.has(world.key(mx, mz - 1))) continue;
        render.syncChunk(world, c);
        meshed++;
      }

      world.unloadFar(pcx, pcz, R + 2, render.disposeChunk);
    }

    function remeshDirtyNear() {
      var s = player.state;
      var pcx = Math.floor(s.pos.x / C.CHUNK_X), pcz = Math.floor(s.pos.z / C.CHUNK_Z);
      var done = 0;
      world.chunks.forEach(function (c) {
        if (done >= 3 || !c.dirty) return;
        if (Math.abs(c.cx - pcx) > 2 || Math.abs(c.cz - pcz) > 2) return;
        render.syncChunk(world, c);
        done++;
      });
    }

    // ─── actions ─────────────────────────────────────────────────────────────
    /* Casser un fourneau ou un coffre doit rendre son contenu : sinon les
       objets disparaissent silencieusement, ce qui est la pire des pertes. */
    function spillContainer(x, y, z) {
      var k = x + ',' + y + ',' + z;
      var lache = 0;
      var f = furnaces[k];
      if (f) {
        [f.input, f.fuel, f.output].forEach(function (st) {
          if (st) { entities.dropItem(x + 0.5, y + 0.5, z + 0.5, st.id, st.n); lache += st.n; }
        });
        delete furnaces[k];
      }
      var ch = chests[k];
      if (ch) {
        ch.slots.forEach(function (st) {
          if (st) { entities.dropItem(x + 0.5, y + 0.5, z + 0.5, st.id, st.n); lache += st.n; }
        });
        delete chests[k];
      }
      if (lache) ui.toast(lache + ' objet(s) récupéré(s) du conteneur');
      return lache;
    }
    g.spillContainer = spillContainer;

    function selectSlot(i) {
      if (i < 0 || i >= Inv.HOTBAR_SIZE) return;
      player.state.selected = i;
      player.cancelMining();
    }

    function onAttack() {
      if (input.state !== 'playing') return;
      var e = entities.aimedAt(player.eyePos(), player.lookDir(), player.REACH);
      if (e) {
        var r = player.attack(e);
        if (r) audio.play(r.toolBroke ? 'brise' : 'frapper');
        if (r && r.killed) ui.toast('Éliminé');
      }
      // sinon le minage continu est géré dans la boucle
    }

    function onUse() {
      if (input.state !== 'playing') return;

      // interagir avec un PNJ a priorité sur le bloc derrière lui
      var ent = entities.aimedAt(player.eyePos(), player.lookDir(), player.REACH);
      if (ent && entities.SPECS[ent.type].npc) {
        ui.openContainer('trade', player.state.inv, null, ent.eid);
        input.setState('ui');
        return;
      }

      var target = player.aim();
      if (!target) return;
      var res = player.useOn(target);
      if (!res) return;
      if (res.indexOf('open:') === 0) {
        var kind = res.slice(5);
        var k = target.x + ',' + target.y + ',' + target.z;
        if (kind === 'furnace') {
          if (!furnaces[k]) furnaces[k] = Inv.newFurnace();
          ui.openContainer('furnace', player.state.inv, furnaces[k], k);
        } else if (kind === 'chest') {
          if (!chests[k]) chests[k] = Inv.create(27);
          ui.openContainer('chest', player.state.inv, chests[k], k);
        } else {
          ui.openContainer('craft', player.state.inv);
        }
        input.setState('ui');
        return;
      }
      if (res === 'place') audio.play('poser');
      else if (res === 'eat') audio.play('manger');
      else if (res === 'till') { audio.play('poser'); ui.toast('Terre labourée'); }
      else if (res === 'plant') { audio.play('poser'); ui.toast('Graines plantées'); }
    }

    function onKey(code) {
      if (code === 'KeyE') {
        ui.openContainer('inv', player.state.inv);
        input.setState('ui');
      } else if (code === 'F5') {
        doSave(true);
      } else if (code === 'KeyM') {
        ui.toast(audio.setEnabled(!audio.enabled) ? 'Son activé' : 'Son coupé');
      } else if (code === 'KeyG') {
        // G et non Q : sur AZERTY, Q est déjà la touche « aller à gauche »
        var d = player.dropSelected(1);
        if (d) { ui.toast('Jeté : ' + C.nameOf(d.id)); audio.play('poser'); }
      }
    }

    function onKeyAnyState(code) {
      if (input.state === 'ui' && (code === 'KeyE')) closeUI();
    }

    function onEscape() {
      if (input.state === 'ui') { closeUI(); return; }
      if (input.state === 'playing') { input.setState('paused'); return; }
      if (input.state === 'paused') { resume(); return; }
    }

    function forceCloseContainer() {
      var rendus = ui.closeContainer();
      dropLeftovers(rendus);
    }
    function dropLeftovers(rendus) {
      if (!rendus || !rendus.length) return;
      var s = player.state;
      rendus.forEach(function (r) {
        entities.dropItem(s.pos.x, s.pos.y + 1, s.pos.z, r.id, r.n);
      });
      ui.toast('Inventaire plein : objets lâchés au sol', 'warn');
    }
    function closeUI() {
      forceCloseContainer();
      input.setState('playing');
    }

    function doSave(notify) {
      var st = storage();
      if (!st) { if (notify) ui.toast('Sauvegarde indisponible', 'warn'); return false; }
      var ok = MC.Save.save(st, g);
      if (notify) { ui.toast(ok ? 'Partie sauvegardée' : 'Échec de la sauvegarde', ok ? '' : 'warn');
                    if (ok) audio.play('sauver'); }
      return ok;
    }
    g.doSave = doSave;

    // ─── boucle ──────────────────────────────────────────────────────────────
    var last = performance.now(), acc = 0, frames = 0, spawnT = 0, autoSaveT = 0;

    function frame(now) {
      requestAnimationFrame(frame);
      var dt = Math.min((now - last) / 1000, 0.05);   // clamp : évite l'explosion après un onglet inactif
      last = now;

      var st = input.state;
      var actif = st === 'playing';

      streamChunks(false);
      remeshDirtyNear();

      if (actif) {
        var keys = input.actions();
        player.updateMovement(dt, keys);
        player.updateSurvival(dt);

        // minage continu tant que le bouton gauche est tenu
        var target = player.aim();
        var mobVise = entities.aimedAt(player.eyePos(), player.lookDir(), player.REACH);
        if (input.mouse.left && target && !mobVise) {
          var cible = { x: target.x, y: target.y, z: target.z };
          var res = player.mineTick(dt, target);
          if (res) {
            if (C.BLOCKS[res.id] && C.BLOCKS[res.id].interactive)
              spillContainer(cible.x, cible.y, cible.z);
            if (res.drops.length === 0 && C.BLOCKS[res.id] && C.BLOCKS[res.id].needsTool)
              ui.toast('Il faut un outil adapté pour récupérer ce bloc', 'warn');
            audio.play(res.toolBroke ? 'brise' : 'casser');
            if (res.toolBroke) ui.toast("Votre outil s'est brisé", "warn");
          }
        } else if (!input.mouse.left) {
          player.cancelMining();
        }
        render.setHighlight(target);

        // pose continue en maintenant le clic droit, avec une cadence
        if (input.mouse.right) {
          g.useCd = (g.useCd || 0) - dt;
          if (g.useCd <= 0) { g.useCd = 0.22; onUse(); }
        } else g.useCd = 0;

        // entités et butin
        var ev = entities.update(dt, player.state, {});
        if (ev.damage) { player.hurt(ev.damage); audio.play('blesse'); }
        for (var i = 0; i < ev.picked.length; i++) {
          var p = ev.picked[i];
          var reste = player.pickUp(p.id, p.n);
          if (reste > 0) entities.dropItem(player.state.pos.x, player.state.pos.y + 0.5,
                                           player.state.pos.z, p.id, reste);
          else { ui.toast('+' + p.n + ' ' + C.nameOf(p.id)); audio.play('ramasser'); }
        }
        entities.mergeItems();

        // temps, apparitions, cultures
        g.time += dt;
        world.tick(dt, 14);
        spawnT += dt;
        if (spawnT >= SPAWN_INTERVAL) {
          spawnT = 0;
          entities.trySpawn(player.state, DC.isNight(g.time));
          if (!DC.isNight(g.time)) entities.burnUndead(false);
        }

        // fourneaux
        for (var fk in furnaces) {
          if (Inv.tickFurnace(furnaces[fk], dt)) ui.refreshFurnace();
        }

        autoSaveT += dt;
        if (autoSaveT >= 60) { autoSaveT = 0; doSave(false); }

        if (player.state.dead) { audio.play('mort'); input.setState('dead'); }
      } else if (st === 'ui') {
        // l'inventaire est ouvert : le monde continue doucement (fourneaux, cultures)
        world.tick(dt, 14);
        for (var fk2 in furnaces) if (Inv.tickFurnace(furnaces[fk2], dt)) ui.refreshFurnace();
        render.setHighlight(null);
      } else {
        render.setHighlight(null);
      }

      render.syncEntities(entities);
      var s2 = player.state;
      render.setCamera({ x: s2.pos.x, y: s2.pos.y + player.EYE, z: s2.pos.z }, s2.yaw, s2.pitch);
      var submerged = P.headInWater(world, s2.pos, player.EYE);
      render.updateAmbience(g.time, submerged);
      render.updateTorches(world);
      render.render();

      frames++; acc += dt;
      if (acc >= 0.4) {
        g.fps = Math.round(frames / acc);
        frames = 0; acc = 0;
      }
      ui.updateHUD(g);
    }

    window.addEventListener('resize', render.resize);
    window.addEventListener('beforeunload', function () { if (g.spawnPoint) doSave(false); });

    // démarrage : menu, monde prêt derrière
    placeAtSpawn();
    ui.menuPrincipal(MC.Save.hasSave(storage()));
    requestAnimationFrame(frame);

    return g;
  }

  MC.createGame = createGame;
})(typeof globalThis !== 'undefined' ? globalThis : this);
