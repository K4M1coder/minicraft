/* spec-saisons.js — tests des specs SPEC-SAISON-* : calendrier (journée de
   20 min, année de 3 h en quatre saisons), durée du jour variable, températures
   et neige, teintes saisonnières des feuillages et de l'herbe, gel/dégel des
   eaux dormantes, croissance des cultures et reproduction. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, B = C.B, DC = MC.DayCycle;
  var flatWorld = G.flatWorld;

  describe('Specs — saisons', function () {
    it('SPEC-SAISON-001 : le temps suit un calendrier — journée de 20 min, année de 9 journées en quatre saisons', function () {
      A.equal(DC.DAY_LENGTH, 1200, 'une journée dure 1200 s (20 min réelles)');
      A.equal(DC.DAYS_PER_YEAR, 9, 'neuf journées par année');
      A.equal(DC.YEAR_LENGTH, 10800, 'une année dure 10800 s (3 h réelles)');

      // chaque jour de l'année incrémente `jour`, sans jamais dépasser 9, puis bascule d'année
      for (var d = 0; d < 9; d++) {
        var s = DC.saison(d * DC.DAY_LENGTH + 1);
        A.equal(s.jour, d + 1, 'jour ' + (d + 1) + ' de l année');
        A.equal(s.annee, 1, 'toujours la première année');
      }
      var s2 = DC.saison(9 * DC.DAY_LENGTH + 1);
      A.equal(s2.jour, 1, 'nouvelle année : de retour au jour 1');
      A.equal(s2.annee, 2, 'et à la deuxième année');

      // quatre saisons, dans l'ordre, chacune couvrant un quart de l'année
      var NOMS = ['printemps', 'ete', 'automne', 'hiver'];
      NOMS.forEach(function (nom, i) {
        var t = DC.YEAR_LENGTH * (i / 4 + 0.125);      // au cœur de la saison i
        A.equal(DC.saison(t).nom, nom, 'saison au cœur du quart ' + i);
        A.equal(DC.saison(t).index, i, 'index de saison');
      });
      // déterministe : deux appels à la même heure du monde donnent le même calendrier
      A.deep(DC.saison(54321), DC.saison(54321), 'même heure, même calendrier');
    });

    it('SPEC-SAISON-002 : la durée du jour et la hauteur du soleil varient avec la saison, sans saut', function () {
      var ete = DC.YEAR_LENGTH * 0.375, hiver = DC.YEAR_LENGTH * 0.875;   // cœur de l été et de l hiver
      function nuitParJour(centre) {
        var jourDebut = Math.floor(centre / DC.DAY_LENGTH) * DC.DAY_LENGTH, n = 0, total = 200;
        for (var i = 0; i < total; i++) if (DC.isNight(jourDebut + (i / total) * DC.DAY_LENGTH)) n++;
        return n / total;
      }
      A.gt(nuitParJour(hiver), nuitParJour(ete), 'les nuits sont plus longues en hiver que l été');

      // la hauteur de l'arc du soleil (composante z) est plus haute l été, plus basse l hiver
      var zEte = DC.astres(ete).soleil.z, zHiver = DC.astres(hiver).soleil.z;
      A.gt(zEte, zHiver, 'le soleil monte plus haut l été');

      // continuité : jamais de saut d'un jour à l'autre — la hauteur du soleil
      // à midi change à peine entre deux jours consécutifs, même en pleine saison
      var midi1 = 3 * DC.DAY_LENGTH + DC.DAY_LENGTH * 0.2, midi2 = midi1 + DC.DAY_LENGTH;
      A.lt(Math.abs(DC.astres(midi1).soleil.z - DC.astres(midi2).soleil.z), 0.02, 'pas de saut d un jour à l autre');

      // lever et coucher restent des repères fixes (à l horizon), quelle que soit la saison
      var L = DC.DAY_LENGTH;
      [0, 4, 8].forEach(function (jour) {
        A.lt(Math.abs(DC.astres(L * jour + L * DC.LEVER).soleil.y), 0.02, 'lever à l horizon, jour ' + jour);
        A.lt(Math.abs(DC.astres(L * jour + L * DC.COUCHER).soleil.y), 0.02, 'coucher à l horizon, jour ' + jour);
      });

      // continuité stricte : à une seconde d intervalle (rien à voir avec un
      // jour entier), la hauteur du soleil ne peut pas sauter
      var tFrontiere = DC.YEAR_LENGTH * 0.75;    // frontière automne/hiver
      A.lt(Math.abs(DC.astres(tFrontiere).soleil.z - DC.astres(tFrontiere + 1).soleil.z), 0.001,
        'aucun saut à la frontière entre deux saisons');
    });

    it('SPEC-SAISON-003 : la température suit la saison — écart marqué en climat tempéré, neige en hiver', function () {
      var me = MC.Meteo.creer(20260921), et = me.etat(0);
      var ete = DC.YEAR_LENGTH * 0.375, hiver = DC.YEAR_LENGTH * 0.875;
      var tEteTempere = me.temperature(0.5, 0, ete, et, 'plaines');
      var tHiverTempere = me.temperature(0.5, 0, hiver, et, 'plaines');
      A.gt(tEteTempere, tHiverTempere + 10, 'écart été/hiver marqué en climat tempéré');

      // aux extrêmes du climat (glacial ou torride), l écart saisonnier est plus faible
      var ecartTempere = tEteTempere - tHiverTempere;
      var ecartGlacial = me.temperature(0.02, 0, ete, et, 'plaines') - me.temperature(0.02, 0, hiver, et, 'plaines');
      A.gt(ecartTempere, ecartGlacial, 'l écart saisonnier est le plus marqué aux climats tempérés');

      // la neige remplace la pluie quand la température saisonnière passe sous le seuil de gel
      A.lt(tHiverTempere, 0.5, 'assez froid l hiver, en climat tempéré, pour neiger');
      var precHiver = me.precipitation(1000, 1000, hiver, tHiverTempere, 'plaines',
        Object.assign({}, et, { precipitation: 0.6, couverture: 0.9 }));
      var precEte = me.precipitation(1000, 1000, ete, tEteTempere, 'plaines',
        Object.assign({}, et, { precipitation: 0.6, couverture: 0.9 }));
      A.equal(precHiver.forme, 'neige', 'il neige quand il fait froid');
      A.equal(precEte.forme, 'pluie', 'il pleut l été');
    });

    it('SPEC-SAISON-004 : les feuillages et l herbe suivent les saisons — caducs, conifères et herbe', function () {
      var ete = DC.YEAR_LENGTH * 0.375, automne = DC.YEAR_LENGTH * 0.625, hiver = DC.YEAR_LENGTH * 0.875;
      var tEte = DC.teinteSaison(ete), tAutomne = DC.teinteSaison(automne), tHiver = DC.teinteSaison(hiver);

      // le feuillage caduc se clairsème l hiver
      A.gt(tEte.densiteCaduc, tHiver.densiteCaduc, 'le feuillage caduc est dense l été');
      A.lt(tHiver.densiteCaduc, 0.5, 'et clairsemé l hiver');

      // il roussit à l automne : la composante rouge grandit devant le vert
      A.gt(tAutomne.caduc.r - tAutomne.caduc.g, tEte.caduc.r - tEte.caduc.g, 'le caduc roussit à l automne');

      // le conifère reste bien plus stable d une saison à l autre que le caduc
      var varConifere = Math.abs(tEte.conifere.g - tHiver.conifere.g);
      var varCaduc = Math.abs(tEte.caduc.g - tHiver.caduc.g);
      A.gt(varCaduc, varConifere, 'le conifère change bien moins que le caduc');

      // et l herbe jaunit vers l automne (le vert cède du terrain au jaune/roux)
      A.gt(tAutomne.herbe.r - tAutomne.herbe.g, tEte.herbe.r - tEte.herbe.g, 'l herbe jaunit vers l automne');

      // le mailleur classe chaque sommet : 0 rien, 1 caduc, 2 conifère, 3 dessus d herbe
      var CX = C.CHUNK_X, CZ = C.CHUNK_Z;
      function chunkAvec(poser) {
        var bl = new Uint8Array(CX * C.WORLD_H * CZ);
        for (var x = 0; x < CX; x++) for (var z = 0; z < CZ; z++) bl[C.idx(x, 10, z)] = B.STONE;
        poser(function (x, y, z, id) { bl[C.idx(x, y, z)] = id; });
        return { cx: 0, cz: 0, blocks: bl };
      }
      function lecteur(c) {
        return function (wx, wy, wz) {
          if (wy < 0 || wy >= C.WORLD_H) return 0;
          if (wx < 0 || wx >= CX || wz < 0 || wz >= CZ) return wy <= 10 ? B.STONE : 0;
          return c.blocks[C.idx(wx, wy, wz)];
        };
      }
      function classesDe(id, pass) {
        var c = chunkAvec(function (p) { p(8, 11, 8, id); });
        var raw = MC.Mesher.buildChunk(c, pass || 'cutout', lecteur(c));
        A.equal(raw.feuillages.length, raw.positions.length / 3, 'une classe de feuillage par sommet');
        return raw.feuillages;
      }
      A.ok(!C.isConifere(B.LEAVES), 'les feuilles de chêne ne sont pas un conifère');
      A.ok(C.isConifere(B.SPRUCE_LEAVES), 'les aiguilles de sapin sont un conifère');
      A.ok(classesDe(B.LEAVES).every(function (v) { return v === 1; }), 'feuilles de chêne : caduc');
      A.ok(classesDe(B.SPRUCE_LEAVES).every(function (v) { return v === 2; }), 'aiguilles de sapin : conifère');
      var cHerbe = chunkAvec(function (p) { p(8, 11, 8, B.GRASS); });
      var rawHerbe = MC.Mesher.buildChunk(cHerbe, 'opaque', lecteur(cHerbe));
      var dessus = [], ailleurs = [];
      for (var i = 0; i < rawHerbe.positions.length / 3; i++) {
        (rawHerbe.normals[i * 3 + 1] > 0.5 && rawHerbe.positions[i * 3 + 1] > 11.5 ? dessus : ailleurs)
          .push(rawHerbe.feuillages[i]);
      }
      A.ok(dessus.length > 0 && dessus.every(function (v) { return v === 3; }), 'dessus de l herbe : classe 3');
      A.ok(ailleurs.every(function (v) { return v === 0; }), 'les côtés et le dessous de l herbe : aucune classe');
      A.ok(classesDe(B.STONE, 'opaque').every(function (v) { return v === 0; }), 'la pierre : aucune classe de feuillage');
    });

    it('SPEC-SAISON-005 : lacs et eaux dormantes gèlent en hiver dans les régions froides, dégèlent au printemps', function () {
      var w = MC.createWorld(20260921);
      // un point de climat assez froid pour geler (on force la nature du bloc :
      // seul le mécanisme de gel/dégel est éprouvé ici, pas la génération des lacs)
      var cx = 0, cz = 0;
      var froid = null;
      for (var r = -8000; r < 8000 && !froid; r += 137) {
        if (w.bio.climat(r, 0).t < 0.3) froid = { x: r, z: 0 };
      }
      A.ok(froid, 'un point assez froid existe dans ce monde');
      cx = Math.floor(froid.x / C.CHUNK_X); cz = Math.floor(froid.z / C.CHUNK_Z);
      var chunk = w.getChunk(cx, cz, true);
      var lx = froid.x - cx * C.CHUNK_X, lz = froid.z - cz * C.CHUNK_Z;
      var y = w.groundAt(froid.x, froid.z) + 1;
      w.setBlock(froid.x, y, froid.z, B.WATER);
      w.setBlock(froid.x, y + 1, froid.z, 0);
      chunk.eau.nature[lz * C.CHUNK_X + lx] = MC.Eau.TYPES.lac;

      var hiver = DC.YEAR_LENGTH * 0.875, printemps = DC.YEAR_LENGTH * 0.125;
      // il faut laisser le mécanisme (une seconde de jeu réel par appel) tourner un peu
      for (var i = 0; i < 5; i++) w.tick(1, 14, Math.random, { temps: hiver, eau: false });
      A.equal(w.getBlock(froid.x, y, froid.z), B.ICE, 'le lac gèle l hiver');

      for (var j = 0; j < 5; j++) w.tick(1, 14, Math.random, { temps: printemps, eau: false });
      A.equal(w.getBlock(froid.x, y, froid.z), B.WATER, 'et dégèle au printemps');

      // une glace du joueur (jamais posée par la saison) n est jamais fondue par le dégel saisonnier
      var wz2 = froid.z + 3;
      w.setBlock(froid.x, y, wz2, B.ICE);
      for (var k = 0; k < 5; k++) w.tick(1, 14, Math.random, { temps: printemps, eau: false });
      A.equal(w.getBlock(froid.x, y, wz2), B.ICE, 'la glace posée par le joueur n est pas concernée');
    });

    it('SPEC-SAISON-006 : les cultures poussent selon la saison, jamais l hiver ; la reproduction s arrête l hiver', function () {
      var w = MC.createWorld(4242);
      var pos = w.findSpawnColumn ? w.findSpawnColumn() : [0, 0];
      var x = pos[0], z = pos[1];
      w.getChunk(Math.floor(x / C.CHUNK_X), Math.floor(z / C.CHUNK_Z), true);
      var y = w.groundAt(x, z) + 1;
      var rienJamais = function () { return 0; };   // toujours sous le seuil d irrégularité (0.75)

      function planter(temps, iterations) {
        w.setBlock(x, y - 1, z, B.FARMLAND);
        w.setBlock(x, y, z, B.WHEAT0);
        for (var i = 0; i < iterations; i++) w.tick(1, 14, rienJamais, { temps: temps, eau: false });
        return w.getBlock(x, y, z);
      }

      var ete = DC.YEAR_LENGTH * 0.375, hiver = DC.YEAR_LENGTH * 0.875, printemps = DC.YEAR_LENGTH * 0.125;
      A.notEqual(planter(ete, 20), B.WHEAT0, 'la culture a bien avancé l été en 20 s');
      A.equal(planter(printemps, 20), B.WHEAT0, 'deux fois plus lentement au printemps : pas encore à 20 s');
      A.notEqual(planter(printemps, 40), B.WHEAT0, 'mais elle finit par pousser au printemps');
      A.equal(planter(hiver, 40), B.WHEAT0, 'jamais l hiver, même en la laissant bien plus longtemps');

      // la reproduction : deux animaux proches, en hiver, ne donnent aucun petit
      var wf = flatWorld(10, B.GRASS), ents = MC.createEntities(wf);
      var pl = { pos: { x: 200, y: 11, z: 200 }, dead: false };
      var a = ents.spawn('sheep', 0.5, 11, 0.5), b = ents.spawn('sheep', 1.5, 11, 0.5);
      var naissances = 0;
      for (var t = 0; t < 20; t++) naissances += ents.update(0.5, pl, { hiver: true }).naissances || 0;
      A.equal(naissances, 0, 'aucune naissance en hiver');
      // ils ont pu s éloigner en errant pendant l hiver : on les rapproche pour
      // isoler l effet du drapeau `hiver`, seul objet de ce test
      a.pos.x = 0.5; a.pos.y = 11; a.pos.z = 0.5; b.pos.x = 1.5; b.pos.y = 11; b.pos.z = 0.5;
      for (var u = 0; u < 20; u++) naissances += ents.update(0.5, pl, { hiver: false }).naissances || 0;
      A.gt(naissances, 0, 'la reproduction reprend hors de l hiver');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
