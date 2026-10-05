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

    it('SPEC-SAISON-005 : eau dormante — lac, lac de cratère et rivière calme oui ; cascade, rapide, mer et océan non', function () {
      var T = MC.Eau.TYPES, SEA = C.SEA_LEVEL;
      // une rivière plate de trois de large (z = -1..1) à la cote 40, entre deux berges de pierre
      function riviere(modif) {
        return function (x, y, z) {
          var v = Math.abs(z) <= 1 ? (y <= 40 ? B.WATER : 0) : (y <= 41 ? B.STONE : 0);
          return modif ? modif(x, y, z, v) : v;
        };
      }
      A.ok(MC.Eau.eauDormante(T.riviere, riviere(), 0, 40, 0), 'une rivière plate est calme');
      // un palier : trois blocs plus bas à partir de x = 2 (cascade en aval)
      var aval = riviere(function (x, y, z, v) { return (x >= 2 && Math.abs(z) <= 1) ? (y <= 37 ? B.WATER : 0) : v; });
      A.notOk(MC.Eau.eauDormante(T.riviere, aval, 0, 40, 0), 'à deux blocs d\'une cascade (aval) : pas calme');
      A.ok(MC.Eau.eauDormante(T.riviere, aval, -3, 40, 0), 'plus loin de la cascade : calme de nouveau');
      // un palier plus haut en amont
      var amont = riviere(function (x, y, z, v) { return (x <= -2 && Math.abs(z) <= 1) ? (y <= 43 ? B.WATER : 0) : v; });
      A.notOk(MC.Eau.eauDormante(T.riviere, amont, 0, 40, 0), 'au pied d\'une cascade (amont) : pas calme');
      // un rapide : de l'eau courante tout près
      var rapide = riviere(function (x, y, z, v) { return (x === 1 && y === 40 && z === 0) ? B.EAU_5 : v; });
      A.notOk(MC.Eau.eauDormante(T.riviere, rapide, 0, 40, 0), 'eau courante voisine : pas calme');
      // le gel gagne de proche en proche : une voisine déjà prise en glace ne compte pas comme une cascade
      var prise = riviere(function (x, y, z, v) { return (y === 40 && Math.abs(z) <= 1 && x === 1) ? B.ICE : v; });
      A.ok(MC.Eau.eauDormante(T.riviere, prise, 0, 40, 0), 'une voisine gelée au même niveau laisse la rivière calme');
      // lacs, mers
      A.ok(MC.Eau.eauDormante(T.lac, riviere(), 0, 40, 0), 'un lac dort toujours');
      A.ok(MC.Eau.eauDormante(T.mer, riviere(), 0, SEA + 9, 0), 'une « mer » perchée (lac de cratère) dort');
      A.notOk(MC.Eau.eauDormante(T.mer, riviere(), 0, SEA, 0), 'la mer, au niveau de la mer : non');
      A.notOk(MC.Eau.eauDormante(T.ocean, riviere(), 0, SEA, 0), 'l\'océan : non');
      A.notOk(MC.Eau.eauDormante(T.chute, riviere(), 0, 40, 0), 'une chute : non');
      A.notOk(MC.Eau.eauDormante(0, riviere(), 0, 40, 0), 'une eau qui n\'est pas générée (fontaine, seau) : non');
    });

    /* Une colonne d'eau générée, de nature `nat`, dans un climat donné : le
       premier point d'une spirale (pas de 24 blocs) où `pred(colonne)` est vrai. */
    function chercherColonne(w, pred, rayon) {
      for (var r = 0; r <= (rayon || 12000); r += 24) {
        var n = Math.max(1, Math.round(r * 2 * Math.PI / 24));
        for (var k = 0; k < n; k++) {
          var x = Math.round(Math.cos(k / n * 2 * Math.PI) * r), z = Math.round(Math.sin(k / n * 2 * Math.PI) * r);
          var col = w.bio.colonne(x, z);
          if (pred(col, x, z)) return { x: x, z: z, col: col };
        }
      }
      return null;
    }
    function charger3x3(w, x, z) {
      var cx = Math.floor(x / C.CHUNK_X), cz = Math.floor(z / C.CHUNK_Z);
      for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) w.getChunk(cx + a, cz + b, true);
    }
    function surface(w, x, z) { var y = C.WORLD_H - 1; while (y > 0 && w.getBlock(x, y, z) === 0) y--; return y; }
    function balayer(w, temps, fois, surBloc, occupe) {
      var n = 0;
      for (var i = 0; i < fois; i++) n += w.tickEauxSaison(temps, surBloc, occupe);
      return n;
    }
    var HIVER = DC.YEAR_LENGTH * 0.875, PRINTEMPS = DC.YEAR_LENGTH * 1.125, ETE = DC.YEAR_LENGTH * 1.375;
    var SEUIL = 0.38;

    it('SPEC-SAISON-005 : dans un monde généré, un lac et une rivière calme des régions froides gèlent l\'hiver, dégèlent au printemps @lent', function () {
      var w = MC.createWorld(20260921), T = MC.Eau.TYPES;
      A.equal(w.EAUX_SAISON.GEL_CLIMAT_SEUIL, SEUIL, 'seuil de climat du gel');
      // un vrai lac, assez froid pour geler l'hiver mais pas pris dans la banquise permanente (taïga : t < 0,26)
      var lac = chercherColonne(w, function (c) { return c.climat.lac && c.climat.t < SEUIL && c.climat.t >= 0.26 && c.eau > c.h; });
      A.ok(lac, 'un lac froid existe dans ce monde');
      var riv = chercherColonne(w, function (c, x, z) {
        if (!(c.climat.riviere && c.climat.t < SEUIL && c.climat.t >= 0.26 && c.eau > c.h)) return false;
        // calme : le même niveau d'eau tout autour (pas de palier à moins de 3 blocs)
        for (var dx = -3; dx <= 3; dx++) for (var dz = -3; dz <= 3; dz++) {
          var v = w.bio.colonne(x + dx, z + dz);
          if (v.climat.riviere && v.eau !== c.eau) return false;
        }
        return true;
      });
      A.ok(riv, 'une rivière calme et froide existe dans ce monde');
      [lac, riv].forEach(function (p) { charger3x3(w, p.x, p.z); });
      var yLac = surface(w, lac.x, lac.z), yRiv = surface(w, riv.x, riv.z);
      A.equal(w.getBlock(lac.x, yLac, lac.z), B.WATER, 'le lac est liquide avant l\'hiver');
      A.equal(w.getBlock(riv.x, yRiv, riv.z), B.WATER, 'la rivière aussi');
      var cRiv = w.getChunk(Math.floor(riv.x / 16), Math.floor(riv.z / 16));
      A.equal(cRiv.eau.nature[(riv.z - cRiv.cz * 16) * 16 + (riv.x - cRiv.cx * 16)], T.riviere, 'nature générée : rivière');

      // l'été : rien ne gèle, même en balayant longtemps
      A.equal(balayer(w, ETE, 200), 0, 'l\'été, rien ne change');
      // l'hiver : chaque pas reste dans son budget, et le gel finit par tout couvrir
      var signales = [], parPas = [];
      for (var i = 0; i < 300; i++) parPas.push(w.tickEauxSaison(HIVER, function (x, y, z, id, etat) { signales.push([x, y, z, id, etat]); }));
      A.ok(parPas.every(function (n) { return n <= w.EAUX_SAISON.CHANGEMENTS; }), 'jamais plus de ' + w.EAUX_SAISON.CHANGEMENTS + ' blocs changés par pas');
      A.equal(w.getBlock(lac.x, yLac, lac.z), B.ICE, 'SPEC-SAISON-005 : le lac est gelé en surface l\'hiver');
      A.equal(w.getEtat(lac.x, yLac, lac.z), w.EAUX_SAISON.ETAT, 'glace de saison (état 1)');
      A.equal(w.getBlock(lac.x, yLac - 1, lac.z), B.WATER, 'l\'eau reste liquide sous la glace');
      A.equal(w.getBlock(riv.x, yRiv, riv.z), B.ICE, 'SPEC-SAISON-005 : la rivière calme aussi');
      A.ok(signales.some(function (s) { return s[0] === lac.x && s[2] === lac.z && s[3] === B.ICE && s[4] === 1; }),
           'chaque gel est signalé (le serveur le diffuse) avec son état');
      // on marche sur la glace : c'est un bloc plein pour la physique
      A.ok(C.isSolid(B.ICE), 'la glace porte le joueur');

      // le printemps : tout ce que la saison a gelé redevient de l'eau
      var degels = balayer(w, PRINTEMPS, 300);
      A.gt(degels, 0, 'le dégel change des blocs');
      A.equal(w.getBlock(lac.x, yLac, lac.z), B.WATER, 'SPEC-SAISON-005 : le lac dégèle au printemps');
      A.equal(w.getBlock(riv.x, yRiv, riv.z), B.WATER, 'la rivière aussi');
      A.equal(w.getEtat(lac.x, yLac, lac.z), 0, 'sans état résiduel');
      A.equal(balayer(w, PRINTEMPS, 100), 0, 'puis plus rien à faire');
    });

    it('SPEC-SAISON-005 : le dégel rend l\'eau de la génération — le monde sauvegardé ne garde aucune modification résiduelle @lent', function () {
      var w = MC.createWorld(20260921);
      var lac = chercherColonne(w, function (c) { return c.climat.lac && c.climat.t < SEUIL && c.climat.t >= 0.26 && c.eau > c.h; });
      charger3x3(w, lac.x, lac.z);
      var avant = w.overrides.size;
      balayer(w, HIVER, 300);
      A.gt(w.overrides.size, avant, 'le gel est inscrit dans les modifications (il doit survivre à un redémarrage)');
      balayer(w, PRINTEMPS, 400);
      A.equal(w.overrides.size, avant, 'dégelé : plus aucune modification résiduelle');
      A.equal(w.etatsOverrides.size, 0, 'ni état résiduel');
    });

    it('SPEC-SAISON-005 : le gel n\'emmure personne — une case occupée par un corps (joueur, monture, barque) reste liquide jusqu\'à ce qu\'il la quitte @lent', function () {
      var w = MC.createWorld(20260921);
      var lac = chercherColonne(w, function (c) { return c.climat.lac && c.climat.t < SEUIL && c.climat.t >= 0.26 && c.eau > c.h; });
      charger3x3(w, lac.x, lac.z);
      var y = surface(w, lac.x, lac.z);
      A.equal(w.getBlock(lac.x, y, lac.z), B.WATER, 'le lac est liquide avant l\'hiver');
      // un corps nage dans la case de surface (la boîte d'un joueur : 0,6 × 1,8)
      var corps = { x: lac.x + 0.5, y: y - 0.21, z: lac.z + 0.5, w: 0.6, h: 1.8 };
      var occupe = function (x, yy, z) {
        return MC.Physics.boxOverlap(x + 0.5, yy, z + 0.5, 1, 1, corps.x, corps.y, corps.z, corps.w, corps.h);
      };
      balayer(w, HIVER, 300, null, occupe);
      A.equal(w.getBlock(lac.x, y, lac.z), B.WATER, 'tant que le corps y est, la surface ne gèle pas');
      A.ok(w.getBlock(lac.x + 3, surface(w, lac.x + 3, lac.z), lac.z) === B.ICE ||
           w.getBlock(lac.x - 3, surface(w, lac.x - 3, lac.z), lac.z) === B.ICE, 'le reste du lac gèle bien');
      // le corps s'éloigne : la case gèle au balayage suivant
      corps.x += 6;
      balayer(w, HIVER, 300, null, occupe);
      A.equal(w.getBlock(lac.x, y, lac.z), B.ICE, 'le corps parti, la case gèle');
    });

    it('SPEC-SAISON-005 : le gel ne touche ni l\'eau du joueur, ni les constructions, ni la banquise générée, et survit à un redémarrage @lent', function () {
      var w = MC.createWorld(20260921);
      var lac = chercherColonne(w, function (c) { return c.climat.lac && c.climat.t < SEUIL && c.climat.t >= 0.26 && c.eau > c.h; });
      charger3x3(w, lac.x, lac.z);
      var y = surface(w, lac.x, lac.z);
      // une fontaine du joueur sur la terre ferme, dans le même froid (colonne sans eau générée)
      var terre = null;
      for (var dx = -20; dx <= 20 && !terre; dx++) for (var dz = -20; dz <= 20 && !terre; dz++) {
        var c = w.bio.colonne(lac.x + dx, lac.z + dz);
        if (!(c.eau > c.h) && Math.abs(dx) + Math.abs(dz) > 3) terre = { x: lac.x + dx, z: lac.z + dz };
      }
      A.ok(terre, 'de la terre ferme près du lac');
      charger3x3(w, terre.x, terre.z);
      var yt = surface(w, terre.x, terre.z) + 1;
      w.setBlock(terre.x, yt, terre.z, B.WATER);
      // un ponton posé sur le lac : la colonne n'est plus à nu
      var px = lac.x + 1, py = surface(w, px, lac.z);
      w.setBlock(px, py + 1, lac.z, B.PLANKS);
      // un bloc de glace posé par le joueur sur une autre colonne du lac
      var gx = lac.x - 1, gy = surface(w, gx, lac.z);
      w.setBlock(gx, gy, lac.z, B.ICE);
      balayer(w, HIVER, 300);
      A.equal(w.getBlock(lac.x, y, lac.z), B.ICE, 'le lac gèle');
      A.equal(w.getBlock(terre.x, yt, terre.z), B.WATER, 'la fontaine du joueur ne gèle pas');
      A.equal(w.getBlock(px, py, lac.z), B.WATER, 'sous le ponton, l\'eau ne gèle pas');
      A.equal(w.getBlock(px, py + 1, lac.z), B.PLANKS, 'le ponton est intact');

      // redémarrage : un monde neuf qui relit les modifications sauvegardées (blocs et états)
      var w2 = MC.createWorld(20260921);
      w.overrides.forEach(function (id, k) { w2.overrides.set(k, id); });
      w.etatsOverrides.forEach(function (e, k) { w2.etatsOverrides.set(k, e); });
      charger3x3(w2, lac.x, lac.z);
      A.equal(w2.getBlock(lac.x, y, lac.z), B.ICE, 'après redémarrage, le lac est toujours gelé');
      A.equal(w2.getEtat(lac.x, y, lac.z), 1, 'avec son état de glace de saison');
      // une construction posée sur la glace de saison l'empêche de fondre (rien n'est détruit)
      var bx = lac.x + 2, by = surface(w2, bx, lac.z);
      A.equal(w2.getBlock(bx, by, lac.z), B.ICE, 'une autre colonne du lac est gelée');
      w2.setBlock(bx, by + 1, lac.z, B.COBBLE);
      balayer(w2, PRINTEMPS, 300);
      A.equal(w2.getBlock(lac.x, y, lac.z), B.WATER, 'au printemps, le lac dégèle même après un redémarrage');
      A.equal(w2.getBlock(gx, gy, lac.z), B.ICE, 'la glace du joueur ne fond jamais');
      A.equal(w2.getBlock(bx, by + 1, lac.z), B.COBBLE, 'le bloc posé sur la glace est intact');
      A.equal(w2.getBlock(bx, by, lac.z), B.ICE, 'et la glace qui le porte ne fond pas sous lui');

      // la banquise générée des biomes glacés (taïga…) ne fond jamais
      var bq = chercherColonne(w2, function (c) { return c.climat.lac && c.climat.t < 0.2 && c.eau > c.h; });
      if (bq) {
        charger3x3(w2, bq.x, bq.z);
        var yb = surface(w2, bq.x, bq.z);
        if (w2.getBlock(bq.x, yb, bq.z) === B.ICE) {
          balayer(w2, PRINTEMPS, 400);
          A.equal(w2.getBlock(bq.x, yb, bq.z), B.ICE, 'la banquise d\'un lac de taïga reste prise au printemps');
        }
      }
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
      // gardés côte à côte (ils errent sinon) le temps de deux ou trois tours de reproduction
      for (var u = 0; u < 40 && !naissances; u++) {
        a.pos.x = 0.5; a.pos.z = 0.5; b.pos.x = 1.5; b.pos.z = 0.5;
        naissances += ents.update(0.5, pl, { hiver: false }).naissances || 0;
      }
      A.gt(naissances, 0, 'la reproduction reprend hors de l hiver');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
