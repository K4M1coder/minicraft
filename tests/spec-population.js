/* spec-population.js — tests des specs SPEC-POP-*. Les habitants tués le
   restent, des remplaçants maintiennent la population des lieux, les animaux
   se reproduisent sous un plafond. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, H = MC.Habitats;
  var B = C.B;

  function unVillage(w) {
    for (var r = 0; r < 10; r++) for (var rx = -r; rx <= r; rx++) for (var rz = -r; rz <= r; rz++) {
      var v = w.habitats.lieuDeRegion('village', rx, rz);
      if (v) return v;
    }
    return null;
  }

  describe('Specs — population', function () {
    it('SPEC-POP-001 : un habitant tué reste mort, même après rechargement', function () {
      var w = MC.createWorld(31), v = unVillage(w);
      A.ok(v, 'un village');
      var tue = v.pnjs[0];
      w.pnjsMorts.set(tue.id, 500);
      var manquants = H.pnjsManquants([v], [], w.pnjsMorts, 510);
      A.notOk(manquants.some(function (p) { return p.id === tue.id; }), 'il ne réapparaît pas');
      A.equal(manquants.length, v.pnjs.length - 1, 'les autres, oui');
      // la sauvegarde s'en souvient
      var mem = {}, st = { getItem: function (k) { return mem[k] || null; }, setItem: function (k, x) { mem[k] = x; },
                           removeItem: function (k) { delete mem[k]; } };
      var ents = MC.createEntities(w), pl = MC.createPlayer(w, ents, MC.Modes.regles('survie', 'facile'));
      var etat = { world: w, entities: ents, player: pl, time: 510, furnaces: {}, chests: {}, spawnPoint: { x: 0, y: 40, z: 0 } };
      A.ok(MC.Save.save(st, etat));
      w.pnjsMorts.clear();
      A.ok(MC.Save.load(st, etat));
      A.equal(w.pnjsMorts.get(tue.id), 500, 'la mort et son heure sont revenues avec la partie');
      A.notOk(H.pnjsManquants([v], [], w.pnjsMorts, 520).some(function (p) { return p.id === tue.id; }), 'toujours mort');
      w.reset();
      A.equal(w.pnjsMorts.size, 0, 'une nouvelle partie repart de zéro');
    });

    it('SPEC-POP-002 : un lieu en sous-effectif accueille des remplaçants, jusqu à sa capacité', function () {
      var w = MC.createWorld(31), v = unVillage(w), D = H.DELAI_REMPLACEMENT;
      var morts = new Map();
      v.pnjs.forEach(function (p) { morts.set(p.id, 1000); });
      A.equal(H.pnjsManquants([v], [], morts, 1000 + D - 1).length, 0, 'le village vidé reste vide un temps');
      var r = H.pnjsManquants([v], [], morts, 1000 + D + 1);
      A.equal(r.length, v.pnjs.length, 'puis chaque place est reprise, pas davantage');
      r.forEach(function (p, i) {
        A.notEqual(p.id, v.pnjs[i].id, 'un remplaçant n est pas le défunt : ' + p.id);
        A.equal(p.role, v.pnjs[i].role, 'même métier');
        A.equal(p.remplacant, 1);
      });
      // présent : on n'en fait pas apparaître un second
      var presents = r.map(function (p) { return { pnj: p.id }; });
      A.equal(H.pnjsManquants([v], presents, morts, 1000 + D + 5).length, 0, 'la capacité n est jamais dépassée');
      // le remplaçant tué est remplacé à son tour
      morts.set(r[0].id, 3000);
      var r2 = H.pnjsManquants([v], presents.slice(1), morts, 3000 + D + 1);
      A.equal(r2.length, 1);
      A.equal(r2[0].remplacant, 2, 'deuxième génération');
      // sans heure (ancien registre), les morts restent morts
      A.equal(H.pnjsManquants([v], [], new Set(v.pnjs.map(function (p) { return p.id; }))).length, 0);
    });

    it('SPEC-POP-003 : deux animaux proches engendrent un petit, sous un plafond, et le petit grandit', function () {
      var w = G.flatWorld(10, B.GRASS), ents = MC.createEntities(w), R = ents.REPRO;
      var pl = { pos: { x: 200, y: 11, z: 200 }, dead: false };
      var a = ents.spawn('sheep', 0.5, 11, 0.5), b = ents.spawn('sheep', 1.5, 11, 0.5);
      var naissances = 0;
      for (var t = 0; t < 20; t++) naissances += ents.update(0.5, pl).naissances || 0;
      A.equal(naissances, 1, 'un agneau est né');
      var petit = ents.list.filter(function (e) { return e.bebe; })[0];
      A.ok(petit && petit.type === 'sheep', 'un petit mouton');
      A.ok(a.reproCd > 0 && b.reproCd > 0, 'les parents se reposent');
      for (var u = 0; u < 20; u++) naissances += ents.update(0.5, pl).naissances || 0;
      A.equal(naissances, 1, 'pas de naissance pendant le repos');
      for (var k = 0; k < R.croissance * 2 + 4; k++) ents.update(0.5, pl);
      A.notOk(petit.bebe, 'le petit a grandi');
      // plafond : un troupeau déjà nombreux ne grossit plus
      var w2 = G.flatWorld(10, B.GRASS), e2 = MC.createEntities(w2), n0;
      for (var i = 0; i < R.plafond; i++) e2.spawn('pig', i * 0.9, 11, 0.5);
      n0 = e2.list.length;
      for (var v2 = 0; v2 < 40; v2++) e2.update(0.5, pl);
      A.equal(e2.list.filter(function (e) { return e.type === 'pig'; }).length, n0, 'au plafond, plus de naissance');
      // les monstres ne se reproduisent pas
      var w3 = G.flatWorld(10, B.GRASS), e3 = MC.createEntities(w3);
      e3.spawn('zombie', 0.5, 11, 0.5); e3.spawn('zombie', 1.5, 11, 0.5);
      for (var z = 0; z < 20; z++) e3.update(0.5, pl);
      A.equal(e3.list.filter(function (e) { return e.type === 'zombie'; }).length, 2, 'pas de zombies qui prolifèrent');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
