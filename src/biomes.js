/* biomes.js — climat, relief et classement des biomes, terrestres et marins.
   Logique pure : fonction de (graine, x, z), sans aucune dépendance au monde
   chargé. C'est ce qui permet à chaque chunk d'être généré seul, dans
   n'importe quel ordre, en tombant toujours sur les mêmes frontières. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var B = C.B, SEA = C.SEA_LEVEL;

  /* Tables de biomes.
     `arbres` et `plantes` : probabilités PAR COLONNE (les plantes marines
     poussent au fond de l'eau). Tables d'apparition, en poids relatifs :
       mobsJour / mobsNuit   au sol          mobsEau   dans l'eau
       mobsCiel              en vol
     `fond` : le sol immergé, [surface, sous-couche]. */
  var LISTE = {
    // ── terrestres ──
    plaines: {
      id: 'plaines', nom: 'Plaines', surface: B.GRASS, sousSol: B.DIRT,
      arbres: [{ type: 'chene', p: 0.003 }],
      plantes: [{ id: B.TALL_GRASS, p: 0.09 }, { id: B.FLOWER_RED, p: 0.012 },
                { id: B.FLOWER_YELLOW, p: 0.012 }],
      mobsJour: { sheep: 4, pig: 3, chicken: 3, villager: 2, garde: 1 },
      mobsNuit: { zombie: 5, skeleton: 3, spider: 3, pillager: 1 },
      mobsCiel: { bird: 3 },
    },
    foret: {
      id: 'foret', nom: 'Forêt', surface: B.GRASS, sousSol: B.DIRT,
      arbres: [{ type: 'chene', p: 0.022 }, { type: 'bouleau', p: 0.014 }],
      plantes: [{ id: B.TALL_GRASS, p: 0.06 }, { id: B.MUSHROOM, p: 0.006 },
                { id: B.FLOWER_YELLOW, p: 0.004 }],
      mobsJour: { pig: 4, sheep: 2, wolf: 3, chicken: 1 },
      mobsNuit: { zombie: 4, skeleton: 4, spider: 4 },
      mobsCiel: { bird: 5 },
    },
    desert: {
      id: 'desert', nom: 'Désert', surface: B.SAND, sousSol: B.SAND, roche: B.SANDSTONE,
      arbres: [{ type: 'cactus', p: 0.006 }],
      plantes: [{ id: B.DEAD_BUSH, p: 0.012 }],
      mobsJour: { villager: 1 },
      mobsNuit: { mummy: 6, spider: 3, skeleton: 1 },
      mobsCiel: {},
    },
    taiga: {
      id: 'taiga', nom: 'Taïga enneigée', surface: B.SNOW, sousSol: B.DIRT, gel: true,
      arbres: [{ type: 'sapin', p: 0.016 }],
      plantes: [{ id: B.TALL_GRASS, p: 0.01 }],
      mobsJour: { wolf: 4, sheep: 3, polar_bear: 1 },
      mobsNuit: { zombie: 4, skeleton: 4, wolf: 1 },
      mobsCiel: { bird: 1 },
    },
    marais: {
      id: 'marais', nom: 'Marais', surface: B.GRASS, sousSol: B.DIRT, berges: true,
      arbres: [{ type: 'chene_marais', p: 0.012 }],
      plantes: [{ id: B.TALL_GRASS, p: 0.14 }, { id: B.MUSHROOM, p: 0.018 }],
      mobsJour: { pig: 2, slime: 2, chicken: 1 },
      mobsNuit: { slime: 5, zombie: 3, spider: 2 },
      mobsEau: { fish: 2 },
      mobsCiel: { bird: 2 },
    },
    montagnes: {
      id: 'montagnes', nom: 'Montagnes', surface: B.GRASS, sousSol: B.DIRT,
      // au-dessus de ces altitudes, la roche affleure puis la neige tient
      rocheDes: 46, neigeDes: 54,
      arbres: [{ type: 'sapin', p: 0.005 }],
      plantes: [{ id: B.TALL_GRASS, p: 0.03 }],
      mobsJour: { sheep: 3, goat: 4 },
      mobsNuit: { skeleton: 5, zombie: 3, spider: 2 },
      mobsCiel: { eagle: 3 },
    },
    jungle: {
      id: 'jungle', nom: 'Jungle', surface: B.GRASS, sousSol: B.DIRT,
      arbres: [{ type: 'tropical', p: 0.05 }, { type: 'chene', p: 0.008 }],
      plantes: [{ id: B.TALL_GRASS, p: 0.18 }, { id: B.MELON, p: 0.006 },
                { id: B.FLOWER_RED, p: 0.004 }],
      mobsJour: { chicken: 2, pig: 2 },
      mobsNuit: { zombie: 3, spider: 5, skeleton: 2 },
      mobsCiel: { parrot: 6 },
    },
    savane: {
      id: 'savane', nom: 'Savane', surface: B.GRASS, sousSol: B.DIRT,
      arbres: [{ type: 'acacia', p: 0.005 }],
      plantes: [{ id: B.TALL_GRASS, p: 0.26 }],
      mobsJour: { sheep: 3, chicken: 2, villager: 1, garde: 1 },
      mobsNuit: { zombie: 3, skeleton: 2, pillager: 3, vindicator: 2 },
      mobsCiel: { bird: 2 },
    },
    badlands: {
      id: 'badlands', nom: 'Badlands', surface: B.RED_SAND, sousSol: B.TERRACOTTA,
      strates: true,
      arbres: [{ type: 'cactus', p: 0.003 }],
      plantes: [{ id: B.DEAD_BUSH, p: 0.02 }],
      mobsJour: {},
      mobsNuit: { skeleton: 4, spider: 2, pillager: 3 },
      mobsCiel: { eagle: 1 },
    },
    pics_glaces: {
      id: 'pics_glaces', nom: 'Pics glacés', surface: B.SNOW, sousSol: B.PACKED_ICE, gel: true,
      arbres: [{ type: 'pic_glace', p: 0.012 }],
      plantes: [],
      mobsJour: { polar_bear: 3 },
      mobsNuit: { skeleton: 4, zombie: 2 },
      mobsCiel: {},
    },
    champignons: {
      id: 'champignons', nom: 'Île aux champignons', surface: B.MYCELIUM, sousSol: B.DIRT,
      arbres: [{ type: 'champignon_geant', p: 0.02 }],
      plantes: [{ id: B.MUSHROOM, p: 0.04 }],
      // aucun monstre n'y naît, de jour comme de nuit
      mobsJour: { pig: 3 },
      mobsNuit: {},
      mobsCiel: { seagull: 1 },
    },

    volcan: {
      id: 'volcan', nom: 'Volcan', surface: B.BASALT, sousSol: B.BASALT, roche: B.BASALT,
      arbres: [], plantes: [{ id: B.DEAD_BUSH, p: 0.004 }],
      mobsJour: {}, mobsNuit: { skeleton: 2, slime: 1 }, mobsCiel: {},
    },
    // glacier : la glace bleue recouvre les hauteurs froides, fendue de crevasses
    glacier: {
      id: 'glacier', nom: 'Glacier', surface: B.BLUE_ICE, sousSol: B.PACKED_ICE, gel: true,
      arbres: [], plantes: [],
      mobsJour: { polar_bear: 2 }, mobsNuit: { skeleton: 3 }, mobsCiel: {},
    },

    // ── marins : le biome d'une colonne immergée ──
    ocean: {
      id: 'ocean', nom: 'Océan', marin: true, surface: B.SAND, sousSol: B.SAND,
      fond: [B.SAND, B.GRAVEL],
      arbres: [], plantes: [{ id: B.SEAGRASS, p: 0.08 }, { id: B.KELP, p: 0.02 }],
      mobsJour: {}, mobsNuit: {},
      mobsEau: { fish: 5, squid: 3, dolphin: 1, drowned: 1 },
      mobsCiel: { seagull: 3 },
    },
    ocean_chaud: {
      id: 'ocean_chaud', nom: 'Récif corallien', marin: true, recif: true,
      surface: B.SAND, sousSol: B.SAND, fond: [B.SAND, B.SAND],
      arbres: [], plantes: [{ id: B.SEAGRASS, p: 0.1 }, { id: B.SEA_PICKLE, p: 0.012 }],
      mobsJour: {}, mobsNuit: {},
      mobsEau: { tropical_fish: 8, turtle: 2, dolphin: 2, jellyfish: 2 },
      mobsCiel: { seagull: 2 },
    },
    ocean_gele: {
      id: 'ocean_gele', nom: 'Océan gelé', marin: true, gel: true, icebergs: true,
      surface: B.GRAVEL, sousSol: B.GRAVEL, fond: [B.GRAVEL, B.GRAVEL],
      arbres: [], plantes: [{ id: B.SEAGRASS, p: 0.02 }],
      mobsJour: {}, mobsNuit: {},
      mobsEau: { fish: 3, squid: 2 },
      mobsCiel: {},
    },
    foret_varech: {
      id: 'foret_varech', nom: 'Forêt de varech', marin: true,
      surface: B.SAND, sousSol: B.GRAVEL, fond: [B.GRAVEL, B.SAND],
      arbres: [], plantes: [{ id: B.KELP, p: 0.3 }, { id: B.SEAGRASS, p: 0.12 }],
      mobsJour: {}, mobsNuit: {},
      mobsEau: { fish: 6, squid: 2, shark: 1 },
      mobsCiel: { seagull: 2 },
    },
    abysses: {
      id: 'abysses', nom: 'Abysses', marin: true,
      surface: B.GRAVEL, sousSol: B.CLAY, fond: [B.GRAVEL, B.CLAY],
      arbres: [], plantes: [{ id: B.KELP, p: 0.03 }, { id: B.SPONGE, p: 0.005 },
                            { id: B.SEA_PICKLE, p: 0.006 }],
      mobsJour: {}, mobsNuit: {},
      mobsEau: { squid: 4, shark: 3, jellyfish: 3, drowned: 2 },
      mobsCiel: {},
    },
  };
  var TERRESTRES = ['plaines', 'foret', 'desert', 'taiga', 'marais', 'montagnes',
                    'jungle', 'savane', 'badlands', 'pics_glaces', 'champignons', 'volcan', 'glacier'];
  var MARINS = ['ocean', 'ocean_chaud', 'ocean_gele', 'foret_varech', 'abysses'];
  var ORDRE = TERRESTRES.concat(MARINS);
  // tous les biomes exposent les quatre tables : un biome sans ciel a une table vide
  ORDRE.forEach(function (k) {
    ['mobsJour', 'mobsNuit', 'mobsEau', 'mobsCiel'].forEach(function (t) { LISTE[k][t] = LISTE[k][t] || {}; });
  });

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smoothstep(a, b, v) { var t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); }
  /* Le fbm se concentre autour de 0,5 (5 % des valeurs sous 0,27, 5 % au-dessus
     de 0,73) : on l'étale sur [0,1] avant de le seuiller, sinon les biomes
     « extrêmes » (désert, taïga) n'apparaîtraient presque jamais. */
  function etaler(v) { return clamp01(0.5 + (v - 0.5) * 2.2); }

  // profondeur à partir de laquelle une colonne immergée devient un biome marin
  var PROF_MARINE = 2;

  function creer(N) {
    /* Trois champs indépendants, décalés pour ne pas être corrélés :
       température, humidité, et propension au relief montagneux. */
    function climat(wx, wz) {
      var t = etaler(N.fbm((wx + 1733) / 420, (wz - 911) / 420, 3, 2, 0.5));
      var h = etaler(N.fbm((wx - 5227) / 360, (wz + 3301) / 360, 3, 2, 0.5));
      var r = etaler(N.fbm((wx + 9127) / 300, (wz + 7411) / 300, 3, 2, 0.5));
      /* Poids CONTINUS : ils pilotent le relief. Un choix discret de biome
         appliqué directement à la hauteur ferait des falaises à chaque
         frontière ; les poids la font varier en douceur. */
      var wm = smoothstep(0.76, 0.92, r);
      var wd = smoothstep(0.60, 0.74, t) * (1 - smoothstep(0.46, 0.60, h)) * (1 - wm);
      // les badlands sont le cœur le plus sec des déserts : mesas en terrasses
      var wb = wd * (1 - smoothstep(0.26, 0.36, h));
      // le marais est tempéré : plus chaud et humide, c'est la jungle
      var ws = smoothstep(0.60, 0.72, h) * smoothstep(0.34, 0.46, t) * (1 - smoothstep(0.54, 0.62, t)) *
               (1 - wm) * (1 - wd);
      // îles aux champignons : très humide, relief nul, température douce
      var wc = smoothstep(0.80, 0.88, h) * (1 - smoothstep(0.18, 0.28, r)) *
               smoothstep(0.34, 0.40, t) * (1 - smoothstep(0.56, 0.62, t));
      return { t: t, h: h, r: r, montagne: wm, desert: wd, badlands: wb, marais: ws, champignons: wc };
    }

    /* ── Volcans ───────────────────────────────────────────────────────────
       Un au plus par région de 384 blocs, un sur trois environ. Un cône qui
       s'élève du relief (ou de la mer : c'est alors une île), un cratère au
       sommet, rempli de lave. Tout est fonction pure de la graine. */
    var REGION_VOLCAN = 384;
    var volcans = new Map();
    function volcanDe(rx, rz) {
      var k = rx + ',' + rz;
      if (volcans.has(k)) return volcans.get(k);
      var v = null;
      if (N.hash2(rx * 7919 + 3, rz * 104729 - 11) < 0.34) {
        var m = 80;
        v = { x: rx * REGION_VOLCAN + m + Math.floor(N.hash2(rx * 31, rz * 57) * (REGION_VOLCAN - 2 * m)),
              z: rz * REGION_VOLCAN + m + Math.floor(N.hash2(rx * 83, rz * 29) * (REGION_VOLCAN - 2 * m)),
              R: 42 + Math.floor(N.hash2(rx * 5, rz * 13) * 22) };
        v.sommet = 60 + Math.floor(N.hash2(rx * 17, rz * 3) * 4);
        v.cratere = 7;
        v.lave = v.sommet - 4;
      }
      volcans.set(k, v);
      return v;
    }
    function volcanProche(wx, wz) {
      var rx = Math.floor(wx / REGION_VOLCAN), rz = Math.floor(wz / REGION_VOLCAN);
      for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) {
        var v = volcanDe(rx + a, rz + b);
        if (v && Math.hypot(wx - v.x, wz - v.z) < v.R) return v;
      }
      return null;
    }

    /* ── Lacs ──────────────────────────────────────────────────────────────
       Un lac par région de 160 blocs, une fois sur deux, au-dessus du niveau
       de la mer. Son niveau est fixé au centre : toute la cuvette se remplit
       à la même hauteur, et les berges s'adoucissent vers l'eau. */
    var REGION_LAC = 160;
    var lacs = new Map();
    function lacDe(rx, rz) {
      var k = rx + ',' + rz;
      if (lacs.has(k)) return lacs.get(k);
      var l = null;
      if (N.hash2(rx * 4507 - 9, rz * 8837 + 1) < 0.5) {
        var m = 40;
        l = { x: rx * REGION_LAC + m + Math.floor(N.hash2(rx * 41, rz * 11) * (REGION_LAC - 2 * m)),
              z: rz * REGION_LAC + m + Math.floor(N.hash2(rx * 3, rz * 97) * (REGION_LAC - 2 * m)),
              R: 14 + Math.floor(N.hash2(rx * 7, rz * 71) * 16) };
        var cc = climat(l.x, l.z);
        var base = hauteurBrute(l.x, l.z, cc);
        l.niveau = base - 1;
        // pas de lac en mer, sur une montagne, dans un désert brûlant ou sous un volcan
        if (l.niveau < SEA + 3 || l.niveau > 48 || cc.badlands > 0.5 || volcanProche(l.x, l.z)) l = null;
      }
      lacs.set(k, l);
      return l;
    }
    function lacProche(wx, wz) {
      var rx = Math.floor(wx / REGION_LAC), rz = Math.floor(wz / REGION_LAC);
      for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) {
        var l = lacDe(rx + a, rz + b);
        if (l && Math.hypot(wx - l.x, wz - l.z) < l.R + 8) return l;
      }
      return null;
    }

    function classerTerre(c) {
      if (c.volcan) return 'volcan';
      if (c.glacier) return 'glacier';
      if (c.champignons > 0.5) return 'champignons';
      if (c.t < 0.06) return 'pics_glaces';
      if (c.montagne > 0.5) return 'montagnes';
      if (c.badlands > 0.5) return 'badlands';
      if (c.desert > 0.5) return 'desert';
      if (c.t < 0.26) return 'taiga';
      if (c.marais > 0.5) return 'marais';
      if (c.t > 0.58 && c.h > 0.62) return 'jungle';
      if (c.t > 0.56 && c.h > 0.40) return 'savane';
      if (c.h > 0.52) return 'foret';
      return 'plaines';
    }
    function classerMer(c, prof) {
      if (c.t < 0.26) return 'ocean_gele';
      if (prof >= 10) return 'abysses';
      if (c.t > 0.62 && prof <= 8) return 'ocean_chaud';
      if (c.h > 0.55) return 'foret_varech';
      return 'ocean';
    }
    /* Classement d'un climat. Sans altitude, on renvoie le biome terrestre :
       c'est ce qu'attendent les appels qui ne connaissent que le climat. */
    function classer(c, altitude) {
      if (altitude !== undefined && altitude <= SEA - PROF_MARINE && c.champignons <= 0.5 && !c.lac) {
        return classerMer(c, SEA - altitude);
      }
      return classerTerre(c);
    }

    /* Hauteur du terrain. La base reprend le relief d'origine (continents,
       collines, détail) ; chaque biome la module par son poids. */
    function hauteurBrute(wx, wz, c) {
      var continent = N.fbm(wx / 320, wz / 320, 3, 2, 0.5);
      var hills = N.signed(N.fbm(wx / 70, wz / 70, 4, 2, 0.5));
      var detail = N.signed(N.fbm(wx / 18, wz / 18, 2, 2, 0.5));
      var relief = Math.pow(Math.max(0, continent - 0.52) * 2.1, 1.7);
      var basin = Math.pow(Math.max(0, 0.46 - continent) * 2.6, 1.4);
      // fosses : les continents les plus bas plongent vers les abysses
      var fosse = Math.pow(Math.max(0, 0.38 - continent) * 3.2, 1.3) * 9;

      // le désert aplanit les collines en dunes molles
      var collines = hills * 9 * (1 - 0.65 * c.desert);
      var h = SEA + 2 + collines - basin * 14 - fosse + relief * 30 + detail * 2.5;

      // montagnes : des crêtes (bruit « ridged ») plutôt que des bosses rondes
      if (c.montagne > 0) {
        var ridge = 1 - Math.abs(N.signed(N.fbm((wx + 300) / 85, (wz - 170) / 85, 3, 2, 0.5)));
        h += c.montagne * (12 + ridge * ridge * 30);
      }
      // badlands : des mesas, plateaux étagés de quatre blocs
      if (c.badlands > 0) {
        var mesa = N.fbm((wx - 800) / 60, (wz + 400) / 60, 2, 2, 0.5);
        var haut = h + smoothstep(0.45, 0.62, mesa) * 12;
        var terrasse = Math.floor(haut / 4) * 4 + 0.5;
        h = h + (terrasse - h) * c.badlands;
      }
      // le marais tire le sol vers le niveau de l'eau : flaques et îlots
      if (c.marais > 0) {
        var cible = SEA + 0.9 + detail * 1.6;
        h = h + (cible - h) * c.marais * 0.85;
      }
      // l'île aux champignons émerge, même au large
      if (c.champignons > 0 && h < SEA + 4) {
        h = h + (SEA + 4 + detail * 1.5 - h) * c.champignons * 0.9;
      }
      /* Falaises côtières : par endroits, le rivage se dresse d'un coup. La
         montée tient dans quelques blocs d'altitude du relief de base, donc
         dans une bande étroite le long de la côte : une paroi, pas une pente. */
      var fal = smoothstep(0.60, 0.66, N.fbm((wx + 4411) / 260, (wz - 1717) / 260, 2, 2, 0.5));
      if (fal > 0 && h > SEA - 3 && c.marais < 0.5) h += fal * 11 * smoothstep(SEA - 1.5, SEA + 0.5, h);
      c.falaise = fal;
      /* Escarpements : dans certaines régions, une marche de sept blocs suit
         une courbe de niveau du bruit — une ligne de falaises dans la plaine. */
      var zoneEsc = smoothstep(0.56, 0.62, N.fbm((wx + 77) / 400, (wz + 99) / 400, 2, 2, 0.5));
      if (zoneEsc > 0) {
        h += zoneEsc * 7 * smoothstep(0.50, 0.52, N.fbm((wx - 2231) / 90, (wz + 881) / 90, 2, 2, 0.5));
      }
      c.escarpement = zoneEsc;
      // plafond souple : pas de plateaux tranchés net au sommet du monde
      if (h > 56) h = 56 + (h - 56) * 0.45;
      return Math.max(3, Math.floor(h));
    }

    /* Une colonne complète : hauteur du sol, niveau de l'eau (la mer, ou un
       lac au-dessus d'elle), niveau de la lave (cratère), et le climat annoté
       des reliefs particuliers qu'elle traverse. */
    function colonne(wx, wz) {
      var c = climat(wx, wz);
      var h = hauteurBrute(wx, wz, c);
      var eau = SEA, lave = 0;
      c.volcan = false; c.lac = false; c.glacier = false;
      var v = volcanProche(wx, wz);
      if (v) {
        var d = Math.hypot(wx - v.x, wz - v.z);
        var cone = SEA + 2 + (v.sommet - SEA - 2) * Math.pow(1 - d / v.R, 1.5);
        if (d < v.cratere) {
          // le cratère : une cuvette sous le rebord, pleine de lave
          cone = v.sommet - 7 + Math.pow(d / v.cratere, 2) * 5;
          lave = v.lave;
        }
        if (cone > h) h = Math.floor(cone);
        c.volcan = d < v.R * 0.8;
        // coulées : des rigoles de magma qui dévalent les flancs
        c.coulee = c.volcan && d > v.cratere + 1 &&
          Math.abs(N.fbm((wx - v.x) / 11 + 50, (wz - v.z) / 11 - 50, 2, 2, 0.5) - 0.5) < 0.025;
      }
      var l = !v && lacProche(wx, wz);
      if (l) {
        var dl = Math.hypot(wx - l.x, wz - l.z);
        if (dl < l.R) {
          // cuvette : plus profonde au centre
          var fond = l.niveau - 1 - Math.floor((1 - Math.pow(dl / l.R, 2)) * 6);
          if (h > fond) h = fond;
          eau = l.niveau;
          c.lac = true;
        } else if (h > l.niveau + 1) {
          // berge : le relief descend en pente douce vers l'eau
          var k = (dl - l.R) / 8;
          h = Math.floor(l.niveau + 1 + (h - l.niveau - 1) * k);
        }
      }
      // glacier : les hauteurs froides se couvrent de glace bleue
      c.glacier = !c.volcan && c.t < 0.22 && h >= 44;
      return { h: Math.max(3, h), eau: eau, lave: lave, climat: c };
    }
    function hauteur(wx, wz) { return colonne(wx, wz).h; }

    /* Hauteur, eau, lave ET biome d'une colonne, en un seul calcul du climat. */
    function echantillon(wx, wz) {
      var col = colonne(wx, wz);
      col.biome = LISTE[classer(col.climat, col.h)];
      return col;
    }
    function biomeAt(wx, wz) { return echantillon(wx, wz).biome; }

    return { climat: climat, classer: classer, biomeAt: biomeAt, hauteur: hauteur,
             echantillon: echantillon, colonne: colonne, volcanProche: volcanProche,
             lacProche: lacProche, volcanDe: volcanDe, lacDe: lacDe };
  }

  /* Tirage pondéré d'un type de mob dans une table { type: poids }. */
  function tirerMob(table, r) {
    var total = 0, k;
    for (k in table) total += table[k];
    if (!total) return null;
    var x = r * total;
    for (k in table) { x -= table[k]; if (x < 0) return k; }
    return null;
  }

  MC.Biomes = { LISTE: LISTE, ORDRE: ORDRE, TERRESTRES: TERRESTRES, MARINS: MARINS,
                creer: creer, smoothstep: smoothstep, etaler: etaler, tirerMob: tirerMob,
                PROF_MARINE: PROF_MARINE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
