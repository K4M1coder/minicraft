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
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
