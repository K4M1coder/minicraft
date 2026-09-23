/* save.js — sérialisation de la partie. Le stockage est injecté (localStorage
   dans le navigateur, un objet factice dans les tests) : la logique reste pure. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var KEY = 'minicraft.save.v1';
  var VERSION = 2;

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
      // donjons : gardiens vaincus et coffres déjà pillés ne reviennent pas
      donjons: state.world.donjonsVaincus ? Array.from(state.world.donjonsVaincus) : [],
      pilles: state.world.coffresPilles ? Array.from(state.world.coffresPilles) : [],
      // la carte : ce qu'on a exploré, les repères posés et celui qu'on suit
      explores: state.world.exploration ? state.world.exploration.serialiser() : [],
      reperes: state.world.reperes ? state.world.reperes.serialiser() : [],
      suivi: state.world.reperes && state.world.reperes.suivi ? state.world.reperes.suivi : 0,
      reputation: state.world.reputation ? state.world.reputation.serialiser() : null,
      // le compte en banque, commun à toutes les banques du monde
      banque: state.world.banque ? state.world.banque.serialize() : [],
      // les habitants tués, et quand : ils ne ressuscitent pas au chargement
      pnjsMorts: state.world.pnjsMorts ? Array.from(state.world.pnjsMorts.entries()) : [],
      // l'avancée du récit : chapitre, étape, choix, quêtes secondaires
      histoire: state.histoire && MC.Histoire ? MC.Histoire.serialiser(state.histoire) : null,
      // les créatures ne sont pas sauvegardées, les véhicules si : on les a construits
      vehicules: state.entities && MC.Vehicules ? MC.Vehicules.serialiser(state.entities) : [],
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
  /* Version 1 : les objets commençaient à l'id 64. Ils ont été décalés pour
     laisser la place à de nouveaux blocs ; on convertit donc toute pile
     d'objet des anciennes sauvegardes plutôt que de les déclarer illisibles. */
  function migrerV1(data) {
    var dec = MC.Core.DECALAGE_OBJETS_V1;
    function id(v) { return v >= 64 ? v + dec : v; }
    function pile(p) { if (p && p[0]) p[0] = id(p[0]); return p; }
    if (data.player && data.player.inv) data.player.inv.forEach(pile);
    (data.chests || []).forEach(function (c) { (c[1] || []).forEach(pile); });
    (data.furnaces || []).forEach(function (f) { [1, 2, 3].forEach(function (i) { pile(f[i]); }); });
    data.v = VERSION;
    return data;
  }

  function apply(data, state) {
    if (data && data.v === 1) data = migrerV1(JSON.parse(JSON.stringify(data)));
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
    if (w.donjonsVaincus) {
      w.donjonsVaincus.clear();
      (data.donjons || []).forEach(function (id) { w.donjonsVaincus.add(id); });
    }
    if (state.entities && MC.Vehicules) {
      // les véhicules de la partie en cours cèdent la place à ceux de la sauvegarde
      state.entities.list.filter(function (e) { return e.vehicule; })
        .forEach(function (e) { state.entities.remove(e); });
      MC.Vehicules.restaurer(state.entities, data.vehicules || []);
    }
    if (w.exploration) w.exploration.charger(data.explores || []);
    if (w.reputation) w.reputation.charger(data.reputation);
    if (w.banque) w.banque.load(data.banque || []);
    if (w.pnjsMorts) {
      w.pnjsMorts.clear();
      (data.pnjsMorts || []).forEach(function (m) { if (m && typeof m[0] === 'string') w.pnjsMorts.set(m[0], +m[1] || 0); });
    }
    if (MC.Histoire) {
      state.histoire = data.histoire ? MC.Histoire.charger(data.histoire, function (cat) {
        return MC.Modes.categoriePermise(state.regles, cat);
      }) : null;
    }
    if (w.reperes) {
      w.reperes.charger(data.reperes || []);
      w.reperes.suivi = data.suivi || null;
    }
    if (w.coffresPilles) {
      w.coffresPilles.clear();
      (data.pilles || []).forEach(function (k) { w.coffresPilles.add(k); });
    }
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

  MC.Save = { KEY: KEY, VERSION: VERSION, serialize: serialize, apply: apply, migrerV1: migrerV1,
              save: save, load: load, hasSave: hasSave, clear: clear };
})(typeof globalThis !== 'undefined' ? globalThis : this);
