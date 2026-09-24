/* spec-vent.js — tests des specs SPEC-VENT-* : ce que le vent fait bouger. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, B = C.B, CX = C.CHUNK_X, CZ = C.CHUNK_Z;

  // un chunk plat de pierre (y ≤ 10) où l'on pose ce que l'on veut éprouver
  function chunkAvec(poser) {
    var bl = new Uint8Array(CX * C.WORLD_H * CZ);
    for (var x = 0; x < CX; x++) for (var z = 0; z < CZ; z++) for (var y = 0; y <= 10; y++) bl[C.idx(x, y, z)] = B.GRASS;
    poser(function (x, y, z, id) { bl[C.idx(x, y, z)] = id; });
    return { cx: 0, cz: 0, blocks: bl };
  }
  function lecteur(c) {
    return function (wx, wy, wz) {
      if (wy < 0 || wy >= C.WORLD_H) return 0;
      if (wx < 0 || wx >= CX || wz < 0 || wz >= CZ) return wy <= 10 ? B.GRASS : 0;
      return c.blocks[C.idx(wx, wy, wz)];
    };
  }
  function souplesDe(id, passe) {
    var c = chunkAvec(function (p) { p(8, 11, 8, id); });
    var raw = MC.Mesher.buildChunk(c, passe, lecteur(c));
    var hauts = [], bas = [];
    for (var i = 0; i < raw.positions.length / 3; i++) {
      var x = raw.positions[i * 3], y = raw.positions[i * 3 + 1], z = raw.positions[i * 3 + 2];
      if (x < 8 || x > 9 || z < 8 || z > 9 || y < 11) continue;          // le bloc éprouvé seulement
      (y > 11.5 ? hauts : bas).push(raw.souples[i]);
    }
    return { raw: raw, hauts: hauts, bas: bas };
  }

  describe('Specs — le vent sur la végétation', function () {
    it('SPEC-VENT-002 : herbes, fleurs, cultures et feuillages ploient au vent, pied fixe ; le reste ne bouge pas', function () {
      [B.TALL_GRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.WHEAT3].forEach(function (id) {
        var r = souplesDe(id, 'cutout');
        A.equal(r.raw.souples.length, r.raw.positions.length / 3, 'une souplesse par sommet');
        A.ok(r.hauts.length > 0 && r.hauts.every(function (v) { return v === 1; }), C.nameOf(id) + ' : le sommet ploie');
        A.ok(r.bas.length > 0 && r.bas.every(function (v) { return v === 0; }), C.nameOf(id) + ' : le pied reste planté');
      });
      var f = souplesDe(B.LEAVES, 'cutout');
      A.ok(f.hauts.concat(f.bas).every(function (v) { return v > 0 && v < 0.5; }), 'le feuillage frémit, tout entier et doucement');
      [[B.TORCH, 'cutout'], [B.LADDER, 'cutout'], [B.COBWEB, 'cutout']].forEach(function (c) {
        var t = souplesDe(c[0], c[1]);
        A.ok(t.hauts.concat(t.bas).every(function (v) { return v === 0; }), C.nameOf(c[0]) + ' ne bouge pas');
      });
      var pierre = souplesDe(B.STONE, 'opaque');
      A.ok(pierre.raw.souples.every(function (v) { return v === 0; }), 'les blocs pleins ne bougent pas');
    });

    it('SPEC-VENT-003 : la brume se pose au matin et par temps humide dans les creux, et dérive avec le vent de surface', function () {
      var me = MC.Meteo.creer(20260921), J = MC.DayCycle.DAY_LENGTH;
      var calme = Object.assign({}, me.etat(0), { precipitation: 0, couverture: 0.2, vent: { x: 0.2, z: 0, force: 0.2, angle: 0 } });
      var vallee = { ySol: 30, fond: 30, humidite: 0.8 }, crete = { ySol: 70, fond: 30, humidite: 0.8 };
      var aube = J * 0.96, midi = J * 0.3;
      A.gt(me.brume(aube, calme, vallee), 0.5, 'dense à l aube dans la vallée');
      A.lt(me.brume(midi, calme, vallee), 0.05, 'levée en plein jour par beau temps');
      A.equal(me.brume(aube, calme, crete), 0, 'rien sur les hauteurs');
      A.gt(me.brume(aube, calme, vallee), me.brume(aube, calme, { ySol: 30, fond: 30, humidite: 0.1 }), 'plus dense quand l air est humide');
      var pluie = Object.assign({}, calme, { precipitation: 0.6, couverture: 0.9 });
      A.gt(me.brume(midi, pluie, vallee), 0.3, 'par temps de pluie, même à midi');
      var bourrasque = Object.assign({}, calme, { vent: { x: 1.4, z: 0, force: 1.4, angle: 0 } });
      A.lt(me.brume(aube, bourrasque, vallee), me.brume(aube, calme, vallee), 'le vent fort la disperse');
      // elle dérive avec le vent de surface — celui du sol, pas celui des cirrus
      var d0 = me.deriveBrume(1000), d1 = me.deriveBrume(1100), v = me.ventEn(1050, 0);
      var dx = d1.x - d0.x, dz = d1.z - d0.z;
      A.gt(dx * v.x + dz * v.z, 0, 'dans le sens du vent au sol');
      A.deep(me.deriveBrume(1000), MC.Meteo.creer(20260921).deriveBrume(1000), 'la même pour tous les postes');
    });

    it('SPEC-VENT-001 : le ciel d un monde suit son climat et chaque couche dérive avec le vent de son altitude', function () {
      var w = MC.createWorld(20260921), me = w.meteo;
      var d0 = me.deriveCouche(0, 3000), d4 = me.deriveCouche(4, 3000);
      A.gt(Math.hypot(d4.x, d4.z), Math.hypot(d0.x, d0.z), 'les cirrus vont plus loin que les stratus');
      var a0 = Math.atan2(d0.z, d0.x), a4 = Math.atan2(d4.z, d4.x);
      A.gt(Math.abs(Math.atan2(Math.sin(a4 - a0), Math.cos(a4 - a0))), 0.05, 'et dans une autre direction');
      // la pluie et la neige suivent le vent de leur altitude : il tourne en montant
      var v0 = me.ventEn(3000, 0), v1 = me.ventEn(3000, 90);
      A.ok(Math.abs(v1.angle - v0.angle) > 0.01 && v1.force > v0.force * 0.9, 'le vent des averses n est pas celui du sol');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
