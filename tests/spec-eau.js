/* spec-eau.js — tests des specs SPEC-EAU-*. Natures de l'eau, ondulations,
   sens des ondes, rivières et cascades, écoulement, vagues de rivage, lumière
   sous l'eau. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, E = MC.Eau;
  var B = C.B, CX = C.CHUNK_X, CZ = C.CHUNK_Z;

  var mondes = {};
  function monde(g) { g = g || 20260921; if (!mondes[g]) mondes[g] = MC.createWorld(g); return mondes[g]; }
  function angle(a, b) { return Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.z * b.z))); }

  /* Un chunk factice : fond de pierre à `fond(x, z)`, eau jusqu'à SEA, et les
     tableaux d'eau que remplit la génération. */
  function chunkEau(fond, nature) {
    var bl = new Uint8Array(CX * C.WORLD_H * CZ), SEA = C.SEA_LEVEL;
    var eau = { nature: new Uint8Array(CX * CZ), flux: new Int8Array(CX * CZ * 2), prof: new Uint8Array(CX * CZ) };
    for (var x = 0; x < CX; x++) for (var z = 0; z < CZ; z++) {
      var h = fond(x, z);
      for (var y = 0; y <= h; y++) bl[C.idx(x, y, z)] = B.STONE;
      for (var y2 = h + 1; y2 <= SEA; y2++) bl[C.idx(x, y2, z)] = B.WATER;
      if (h < SEA) { eau.nature[z * CX + x] = nature; eau.prof[z * CX + x] = SEA - h; }
    }
    return { cx: 0, cz: 0, blocks: bl, eau: eau };
  }
  function lecteur(c) {
    return function (wx, wy, wz) {
      if (wy < 0 || wy >= C.WORLD_H) return 0;
      if (wx < 0 || wx >= CX || wz < 0 || wz >= CZ) return wy <= 10 ? B.STONE : 0;
      return c.blocks[C.idx(wx, wy, wz)];
    };
  }

  describe('Specs — eau', function () {
    it('SPEC-EAU-001 : l eau se classe en écoulement, chute, rivière, lac, mer et océan', function () {
      A.deep(E.NOMS.slice(1), ['lac', 'mer', 'ocean', 'riviere', 'ecoulement', 'chute'], 'six natures');
      A.equal(E.natureColonne({ h: 20, eau: 26, climat: { lac: true } }), E.TYPES.lac);
      A.equal(E.natureColonne({ h: 20, eau: 26, climat: { riviere: true } }), E.TYPES.riviere);
      A.equal(E.natureColonne({ h: 22, eau: 26, climat: {} }), E.TYPES.mer, 'peu profonde : la mer');
      A.equal(E.natureColonne({ h: 5, eau: 26, climat: {} }), E.TYPES.ocean, 'profonde : l océan');
      A.equal(E.natureColonne({ h: 30, eau: 26, climat: {} }), 0, 'pas d eau');
      A.ok(E.estCourante(B.EAU_3) && !E.estCourante(B.WATER), 'l eau courante se distingue de la source');
      // dans un monde généré, chaque colonne d'eau porte sa nature
      var w = monde(), vus = {};
      for (var cx = -12; cx <= 12; cx += 3) for (var cz = -12; cz <= 12; cz += 3) {
        var c = w.getChunk(cx, cz, true);
        for (var i = 0; i < CX * CZ; i++) if (c.eau.nature[i]) vus[E.NOMS[c.eau.nature[i]]] = 1;
      }
      A.ok(vus.mer && vus.ocean, 'mer et océan générés : ' + Object.keys(vus).join(', '));
    });

    it('SPEC-EAU-002 : chaque nature ondule à sa façon, et le maillage le porte par sommet', function () {
      var noms = ['lac', 'mer', 'ocean', 'riviere', 'ecoulement', 'chute'];
      noms.forEach(function (n) {
        var p = E.PARAMS[n];
        A.ok(p && p.longueur > 0 && p.vitesse > 0 && p.ecume >= 0, n + ' a ses paramètres');
      });
      A.gt(E.PARAMS.ocean.amplitude, E.PARAMS.lac.amplitude * 3, 'la houle de l océan domine le clapot du lac');
      A.gt(E.PARAMS.ocean.longueur, E.PARAMS.riviere.longueur * 4, 'et ses vagues sont plus longues');
      A.gt(E.PARAMS.chute.ecume, E.PARAMS.lac.ecume + 0.5, 'la chute écume');
      A.gt(E.PARAMS.riviere.vitesse, E.PARAMS.lac.vitesse * 2, 'la rivière court');
      // maillage : un lac et un océan de même fond ne portent pas les mêmes ondes
      function amplitudeMoyenne(nature) {
        var c = chunkEau(function () { return 5; }, nature);
        var raw = MC.Mesher.buildChunk(c, 'blend', lecteur(c));
        A.equal(raw.ondes.length, raw.positions.length / 3 * 4, 'quatre valeurs d onde par sommet');
        A.equal(raw.ondes2.length, raw.positions.length / 3 * 4);
        var s = 0, n = 0;
        for (var i = 0; i < raw.ondes.length; i += 4) if (raw.ondes[i + 1] > 0) { s += raw.ondes[i]; n++; }
        return s / n;
      }
      A.gt(amplitudeMoyenne(E.TYPES.ocean), amplitudeMoyenne(E.TYPES.lac) * 3, 'océan contre lac, dans les sommets');
    });

    it('SPEC-EAU-003 : le sens des ondes mêle courant et vent selon la nature', function () {
      var courant = { x: 1, z: 0 }, vent = { x: 0, z: 1 };
      var chute = E.directionOnde('chute', courant, vent), lac = E.directionOnde('lac', courant, vent),
          riv = E.directionOnde('riviere', courant, vent);
      A.ok(angle(chute, courant) < 0.01, 'une chute suit la pente, pas le vent');
      A.ok(angle(lac, vent) < angle(lac, courant), 'un lac suit surtout le vent');
      A.ok(angle(riv, courant) < angle(riv, vent) && angle(riv, vent) < 1.5, 'une rivière mêle les deux, le courant l emporte');
      A.ok(angle(E.directionOnde('mer', null, vent), vent) < 0.01, 'sans courant : le vent seul');
      A.deep(E.directionOnde('lac', null, null), { x: 0, z: 0 }, 'ni courant ni vent : pas de sens');
    });

    it('SPEC-EAU-004 : des rivières descendent vers la mer ou un lac, dans un lit creusé, avec des cascades', function () {
      var w = monde(), Bi = MC.Biomes.creer(w.noise), rivieres = 0, cascades = 0, lits = 0, montees = 0, suivies = 0;
      for (var x = -3000; x <= 3000 && rivieres < 120; x += 17) for (var z = -3000; z <= 3000; z += 17) {
        var col = Bi.colonne(x, z);
        if (!col.climat.riviere) continue;
        rivieres++;
        A.ok(col.eau > col.h, 'de l eau dans le lit');
        // le lit est plus bas que les berges : quelques pas de côté, le sol remonte
        var g = Bi.courantRiviere(x, z);
        var cote = Bi.colonne(Math.round(x - g.z * 8), Math.round(z + g.x * 8));
        if (cote.h >= col.eau || cote.climat.riviere) lits++;
        // en suivant le courant, le niveau ne remonte pas ; il décroche parfois d'un palier
        var px = x, pz = z, niv = col.eau;
        for (var k = 0; k < 20; k++) {
          var cr = Bi.courantRiviere(px, pz);
          px += cr.x * 3; pz += cr.z * 3;
          var c2 = Bi.colonne(Math.round(px), Math.round(pz));
          if (!c2.climat.riviere) break;
          if (c2.eau > niv) montees++;
          if (c2.eau <= niv - 3) cascades++;
          niv = c2.eau;
          suivies++;
        }
        if (rivieres > 60 && cascades > 0) break;
      }
      A.gt(rivieres, 20, 'des rivières coulent : ' + rivieres + ' colonnes');
      A.gt(lits / rivieres, 0.8, 'dans un lit plus bas que ses berges (' + lits + '/' + rivieres + ')');
      A.ok(montees <= suivies * 0.1, 'elles descendent : ' + montees + ' remontées sur ' + suivies + ' pas');
      A.gt(cascades, 0, 'et décrochent en cascades : ' + cascades);
      A.equal(Bi.niveauRiviere(C.SEA_LEVEL - 5), C.SEA_LEVEL, 'au pied du relief, la rivière rejoint la mer');
    });

    it('SPEC-EAU-005 : l eau s écoule, s étale sur sept blocs, tombe, et se retire sans sa source', function () {
      // un plateau de pierre en plein ciel : y = 100
      var w = MC.createWorld(5), y = 100;
      for (var cx = -2; cx <= 2; cx++) for (var cz = -2; cz <= 2; cz++) w.getChunk(cx, cz, true);
      for (var x = -12; x <= 12; x++) for (var z = -3; z <= 3; z++) w.setBlock(x, y, z, B.STONE);
      w.setBlock(0, y + 1, 0, B.WATER);
      for (var i = 0; i < 80; i++) w.coulerEau(400);
      A.equal(w.getBlock(1, y + 1, 0), B.EAU_7, 'à côté de la source : le niveau 7');
      A.equal(w.getBlock(4, y + 1, 0), B.EAU_4, 'un niveau de moins par bloc');
      A.equal(w.getBlock(7, y + 1, 0), B.EAU_1, 'sept blocs : le dernier filet');
      A.equal(w.getBlock(8, y + 1, 0), 0, 'au-delà, rien');
      // au bord du plateau (z = 3), l'eau tombe
      w.setBlock(0, y + 1, 4, 0);
      A.ok(C.isWater(w.getBlock(0, y + 1, 3)), 'l eau atteint le bord');
      A.ok(C.isWater(w.getBlock(0, y, 4)) || C.isWater(w.getBlock(0, y - 1, 4)), 'et elle tombe dans le vide');
      // la source retirée, tout se retire
      w.setBlock(0, y + 1, 0, 0);
      for (var j = 0; j < 200 && w.eauEnAttente > 0; j++) w.coulerEau(400);
      var reste = 0;
      for (var x2 = -10; x2 <= 10; x2++) for (var z2 = -3; z2 <= 3; z2++) if (C.isWater(w.getBlock(x2, y + 1, z2))) reste++;
      A.equal(reste, 0, 'sans source, l eau courante disparaît');
      // un bloc cassé au bord de la mer se remplit
      var w2 = MC.createWorld(5), trouve = null;
      for (var a = -40; a < 40 && !trouve; a++) for (var b = -40; b < 40 && !trouve; b++) {
        w2.getChunk(Math.floor(a / 16), Math.floor(b / 16), true);
        var h = w2.groundAt(a, b, true);
        if (w2.getBlock(a, h + 1, b) === B.WATER && w2.getBlock(a + 1, h + 1, b) !== B.WATER && C.isSolid(w2.getBlock(a + 1, h + 1, b))) trouve = [a + 1, h + 1, b];
      }
      if (trouve) {
        for (var cc = -2; cc <= 2; cc++) for (var cd = -2; cd <= 2; cd++) w2.getChunk(Math.floor(trouve[0] / 16) + cc, Math.floor(trouve[2] / 16) + cd, true);
        w2.setBlock(trouve[0], trouve[1], trouve[2], 0);
        for (var k2 = 0; k2 < 10; k2++) w2.coulerEau(400);
        A.ok(C.isWater(w2.getBlock(trouve[0], trouve[1], trouve[2])), 'la mer envahit le trou');
      }
      // le seau : puiser, verser
      A.ok(C.def(C.I.SEAU) && C.def(C.I.SEAU_EAU), 'seau vide et seau d eau');
      A.ok(MC.Inventory.RECIPES.some(function (r) { return r.out === C.I.SEAU; }), 'le seau se fabrique');
    });

    it('SPEC-EAU-006 : près du rivage, les vagues se dressent, déferlent et courent vers la plage', function () {
      // fond qui remonte vers x = 15 : profondeur 12 au large, 1 au bord
      var c = chunkEau(function (x) { return C.SEA_LEVEL - 12 + Math.floor(x * 0.75); }, E.TYPES.mer);
      for (var x = 0; x < CX; x++) for (var z = 0; z < CZ; z++) {
        var k = z * CX + x;
        if (c.eau.nature[k]) { c.eau.flux[k * 2] = 127; c.eau.flux[k * 2 + 1] = 0; }    // vers la plage (+x)
      }
      var raw = MC.Mesher.buildChunk(c, 'blend', lecteur(c));
      var large = { A: 0, E: 0, n: 0 }, bord = { A: 0, E: 0, n: 0 }, versPlage = 0, surfaces = 0;
      for (var i = 0; i < raw.positions.length / 3; i++) {
        if (raw.ondes[i * 4 + 1] <= 0 || raw.ondes2[i * 4 + 3] % 2 < 1) continue;          // sommets de surface
        surfaces++;
        var px = raw.positions[i * 3];
        var zone = px < 4 ? large : (px > 12 ? bord : null);
        if (zone) { zone.A += raw.ondes[i * 4]; zone.E += raw.ondes[i * 4 + 3]; zone.n++; }
        if (raw.ondes2[i * 4] > 0.5) versPlage++;
      }
      A.gt(surfaces, 100, 'des sommets de surface');
      A.gt(bord.A / bord.n, (large.A / large.n) * 1.8, 'la vague se dresse près du bord');
      A.gt(bord.E / bord.n, large.E / large.n + 0.2, 'et y déferle en écume');
      A.gt(versPlage / surfaces, 0.9, 'elle court vers la plage');
      // la génération oriente les vagues vers la côte
      var w = monde(), tournees = 0, cotieres = 0;
      for (var cx = -15; cx <= 15; cx += 2) for (var cz = -15; cz <= 15; cz += 2) {
        var ch = w.getChunk(cx, cz, true);
        for (var j = 0; j < CX * CZ; j++) {
          if (ch.eau.nature[j] !== E.TYPES.mer || ch.eau.prof[j] > 3) continue;
          cotieres++;
          if (ch.eau.flux[j * 2] || ch.eau.flux[j * 2 + 1]) tournees++;
        }
      }
      A.gt(cotieres, 20, 'des eaux côtières');
      A.gt(tournees / cotieres, 0.5, 'la plupart tournées vers le rivage (' + tournees + '/' + cotieres + ')');
    });

    it('SPEC-EAU-007 : sous l eau, les faces noyées savent à quelle profondeur elles sont', function () {
      var c = chunkEau(function () { return C.SEA_LEVEL - 9; }, E.TYPES.mer);
      var raw = MC.Mesher.buildChunk(c, 'opaque', lecteur(c));
      A.equal(raw.immerges.length, raw.positions.length / 3, 'une immersion par sommet');
      var fond = 0, profond = 0;
      for (var i = 0; i < raw.immerges.length; i++) {
        if (raw.positions[i * 3 + 1] === C.SEA_LEVEL - 8 && raw.normals[i * 3 + 1] === 1) {
          fond++;
          if (raw.immerges[i] === 9) profond++;
        }
      }
      A.gt(fond, 50, 'le fond marin');
      A.equal(profond, fond, 'chacune de ses faces sous neuf blocs d eau');
      var sec = chunkEau(function () { return C.SEA_LEVEL + 2; }, 0);
      var raw2 = MC.Mesher.buildChunk(sec, 'opaque', lecteur(sec));
      A.ok(raw2.immerges.every(function (v) { return v === 0; }), 'à l air libre, aucune immersion');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
