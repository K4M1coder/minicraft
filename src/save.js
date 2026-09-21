/* save.js — sérialisation de la partie. Le stockage est injecté (localStorage
   dans le navigateur, un objet factice dans les tests) : la logique reste pure. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var KEY = 'minicraft.save.v1';
  var VERSION = 1;

  /* On ne sauvegarde QUE les blocs modifiés par le joueur, pas les chunks :
     le terrain est reproductible depuis la graine, donc le delta suffit et
     la sauvegarde reste minuscule. */
  function serialize(state) {
    var over = [];
    state.world.overrides.forEach(function (id, k) {
      var p = k.split(',');
      over.push([+p[0], +p[1], +p[2], id]);
    });
    var crops = [];
    state.world.crops.forEach(function (c) { crops.push([c.x, c.y, c.z, +c.t.toFixed(2)]); });

    var p = state.player.state;
    return {
      v: VERSION,
      seed: state.world.seed,
      time: +state.time.toFixed(1),
      overrides: over,
      crops: crops,
      player: {
        x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2),
        yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3),
        hp: p.hp, hunger: p.hunger, air: +p.air.toFixed(1),
        selected: p.selected, flying: !!p.flying,
        inv: p.inv.serialize(),
      },
      chests: state.chests ? Object.keys(state.chests).map(function (k) {
        return [k, state.chests[k].serialize()];
      }) : [],
      furnaces: state.furnaces ? Object.keys(state.furnaces).map(function (k) {
        var f = state.furnaces[k];
        return [k, f.input ? [f.input.id, f.input.n] : 0,
                   f.fuel ? [f.fuel.id, f.fuel.n] : 0,
                   f.output ? [f.output.id, f.output.n] : 0,
                   +f.burn.toFixed(2), +f.cook.toFixed(2)];
      }) : [],
    };
  }

  /* Réinjecte un état sauvegardé. Les overrides sont posés AVANT toute
     génération de chunk : generateChunk les applique ensuite tout seul. */
  function apply(data, state) {
    if (!data || data.v !== VERSION) return false;
    var w = state.world;
    w.overrides.clear();
    w.crops.clear();
    (data.overrides || []).forEach(function (o) {
      w.overrides.set(o[0] + ',' + o[1] + ',' + o[2], o[3]);
    });
    (data.crops || []).forEach(function (c) {
      w.crops.set(c[0] + ',' + c[1] + ',' + c[2], { x: c[0], y: c[1], z: c[2], t: c[3] });
    });
    // les chunks déjà en mémoire sont invalides : on les jette pour qu'ils
    // soient régénérés avec les overrides
    w.chunks.forEach(function (c) { if (state.disposeChunk) state.disposeChunk(c); });
    w.chunks.clear();

    var p = state.player.state;
    var d = data.player || {};
    p.pos.x = d.x || 0; p.pos.y = d.y || 0; p.pos.z = d.z || 0;
    p.vel.x = p.vel.y = p.vel.z = 0;
    p.yaw = d.yaw || 0; p.pitch = d.pitch || 0;
    p.hp = d.hp === undefined ? 20 : d.hp;
    p.hunger = d.hunger === undefined ? 20 : d.hunger;
    p.air = d.air === undefined ? 10 : d.air;
    p.selected = d.selected || 0;
    p.flying = !!d.flying;
    p.dead = p.hp <= 0;
    if (d.inv) p.inv.load(d.inv);

    state.time = data.time || 0;

    /* Les registres dérivés (lumières) ne passent pas par setBlock lors d'un
       chargement : il faut les reconstruire, sinon les torches posées avant la
       sauvegarde cessent d'éclairer. */
    if (w.rebuildRegistries) w.rebuildRegistries();

    if (state.chests) {
      for (var ck in state.chests) delete state.chests[ck];
      (data.chests || []).forEach(function (c) {
        var inv = MC.Inventory.create(27);
        inv.load(c[1]);
        state.chests[c[0]] = inv;
      });
    }

    if (state.furnaces && data.furnaces) {
      for (var k in state.furnaces) delete state.furnaces[k];
      data.furnaces.forEach(function (f) {
        state.furnaces[f[0]] = {
          input: f[1] ? { id: f[1][0], n: f[1][1] } : null,
          fuel: f[2] ? { id: f[2][0], n: f[2][1] } : null,
          output: f[3] ? { id: f[3][0], n: f[3][1] } : null,
          burn: f[4], cook: f[5],
        };
      });
    }
    return true;
  }

  function save(storage, state) {
    try {
      storage.setItem(KEY, JSON.stringify(serialize(state)));
      return true;
    } catch (e) { return false; }
  }
  function load(storage, state) {
    try {
      var raw = storage.getItem(KEY);
      if (!raw) return false;
      return apply(JSON.parse(raw), state);
    } catch (e) { return false; }
  }
  function hasSave(storage) {
    try { return !!storage.getItem(KEY); } catch (e) { return false; }
  }
  function clear(storage) {
    try { storage.removeItem(KEY); return true; } catch (e) { return false; }
  }

  MC.Save = { KEY: KEY, VERSION: VERSION, serialize: serialize, apply: apply,
              save: save, load: load, hasSave: hasSave, clear: clear };
})(typeof globalThis !== 'undefined' ? globalThis : this);
