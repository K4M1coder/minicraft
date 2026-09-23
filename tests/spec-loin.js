/* spec-loin.js — tests des specs SPEC-VUE-003 à 007 : ce qu'on voit au loin. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, L = MC.Lointain, B = C.B, CX = C.CHUNK_X, CZ = C.CHUNK_Z;

  var mondes = {};
  function monde(g) { g = g || 20260921; if (!mondes[g]) mondes[g] = MC.createWorld(g); return mondes[g]; }
  function grilleDe(w, x, z) {
    var gr = L.creerGrille({ pas: 8, cote: 96, echantillon: function (a, b) { return w.echantillonLointain(a, b); } });
    gr.recentrer(x, z);
    while (!gr.avancer(4000)) { /* remplir */ }
    return gr;
  }

  describe('Specs — au loin', function () {
    it('SPEC-VUE-003 : au-delà des chunks, les forêts deviennent des imposteurs selon la densité et l essence du biome', function () {
      var w = monde(), gr = grilleDe(w, 0, 0);
      var l = L.imposteurs(gr);
      A.gt(l.length, 200, 'des arbres au loin : ' + l.length);
      var a = gr.actif, parEssence = {};
      l.forEach(function (t) {
        parEssence[t.essence] = (parEssence[t.essence] || 0) + 1;
        A.ok(t.taille > 0 && t.essence >= 1 && t.essence <= 7, 'une essence et une taille');
      });
      A.gt(Object.keys(parEssence).length, 1, 'plusieurs essences : ' + JSON.stringify(parEssence));
      // aucun arbre sur l'eau ; plus d'arbres là où la forêt est dense
      var dense = 0, clair = 0, nDense = 0, nClair = 0;
      for (var i = 0; i < gr.cote * gr.cote; i++) {
        if (a.eau[i] > a.sol[i]) A.equal(a.arbres[i], 0, 'pas de forêt sous l eau');
        if (a.arbres[i] > 0.015) nDense++; else if (a.arbres[i] > 0 && a.arbres[i] < 0.006) nClair++;
      }
      l.forEach(function (t) {
        var gx = Math.round((t.x - a.x0) / gr.pas), gz = Math.round((t.z - a.z0) / gr.pas);
        var k = Math.max(0, Math.min(gr.cote - 1, gz)) * gr.cote + Math.max(0, Math.min(gr.cote - 1, gx));
        if (a.arbres[k] > 0.015) dense++; else if (a.arbres[k] > 0 && a.arbres[k] < 0.006) clair++;
      });
      if (nDense && nClair) A.gt(dense / nDense, (clair / nClair) * 1.5, 'la densité suit celle du biome');
      A.deep(L.imposteurs(grilleDe(w, 0, 0)).slice(0, 20), l.slice(0, 20), 'mêmes arbres aux mêmes places');
      A.ok(L.imposteurs(gr, { max: 50 }).length <= 50, 'un plafond d instances');
      A.equal(L.ESSENCES.sapin, 3);
      A.deep(L.essenceDe({ biome: MC.Biomes.LISTE.foret, h: 40, eau: 26 }).essence > 0, true, 'la forêt a son essence');
    });

    it('SPEC-VUE-004 : villes et villages se voient de loin en silhouettes, fenêtres éclairées la nuit', function () {
      var w = monde(), lieux = w.habitats.lieuxProches(0, 0, 1500);
      A.gt(lieux.length, 2, 'des lieux alentour');
      var s = L.silhouettes(lieux), nb = 0;
      lieux.forEach(function (l) { nb += l.batiments.filter(function (b) { return b.type !== 'place'; }).length; });
      A.equal(s.length, nb, 'une silhouette par bâtiment');
      s.forEach(function (b) { A.ok(b.x1 > b.x0 && b.z1 > b.z0 && b.y1 > b.y0, 'un volume'); });
      A.ok(s.some(function (b) { return b.fenetres; }) && s.some(function (b) { return !b.fenetres; }),
           'des fenêtres aux maisons, pas aux champs');
    });

    it('SPEC-VUE-007 : un chunk lointain se maille sans ses petites plantes, sans rien perdre d autre', function () {
      var bl = new Uint8Array(CX * C.WORLD_H * CZ);
      for (var x = 0; x < CX; x++) for (var z = 0; z < CZ; z++) {
        for (var y = 0; y <= 10; y++) bl[C.idx(x, y, z)] = B.GRASS;
        if ((x + z) % 2) bl[C.idx(x, 11, z)] = B.TALL_GRASS;
      }
      bl[C.idx(4, 11, 4)] = B.TORCH; bl[C.idx(6, 11, 6)] = B.LEAVES;
      var c = { cx: 0, cz: 0, blocks: bl };
      function lire(wx, wy, wz) { return (wx < 0 || wx >= CX || wz < 0 || wz >= CZ) ? (wy <= 10 ? B.GRASS : 0) : bl[C.idx(wx, wy, wz)]; }
      var plein = MC.Mesher.buildChunk(c, 'cutout', lire), leger = MC.Mesher.buildChunk(c, 'cutout', lire, null, null, true);
      A.lt(leger.positions.length, plein.positions.length / 4, 'bien moins de sommets : ' + leger.positions.length / 3 + ' contre ' + plein.positions.length / 3);
      A.gt(leger.positions.length, 0, 'la torche et le feuillage restent');
      var o1 = MC.Mesher.buildChunk(c, 'opaque', lire), o2 = MC.Mesher.buildChunk(c, 'opaque', lire, null, null, true);
      A.equal(o2.positions.length, o1.positions.length, 'le relief est intact');
    });

    it('SPEC-VUE-006 : la commande /rendu règle le rendu réaliste lointain', function () {
      var r = MC.Commandes.executer({ nom: 'rendu', args: ['simple'] }, {});
      A.deep(r.actions, [{ type: 'rendu', realiste: false }], 'simple');
      A.deep(MC.Commandes.executer({ nom: 'rendu', args: ['realiste'] }, {}).actions, [{ type: 'rendu', realiste: true }], 'réaliste');
      A.equal(MC.Commandes.executer({ nom: 'rendu', args: [] }, { renduRealiste: false }).actions.length, 0, 'sans argument : l état');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
