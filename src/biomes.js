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
      mobsJour: { sheep: 4, pig: 3, chicken: 3, villager: 2 },
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
      mobsJour: { sheep: 3, chicken: 2, villager: 1 },
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
                    'jungle', 'savane', 'badlands', 'pics_glaces', 'champignons'];
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

    function classerTerre(c) {
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
      if (altitude !== undefined && altitude <= SEA - PROF_MARINE && c.champignons <= 0.5) {
        return classerMer(c, SEA - altitude);
      }
      return classerTerre(c);
    }

    /* Hauteur du terrain. La base reprend le relief d'origine (continents,
       collines, détail) ; chaque biome la module par son poids. */
    function hauteurDe(wx, wz, c) {
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
      // plafond souple : pas de plateaux tranchés net au sommet du monde
      if (h > 56) h = 56 + (h - 56) * 0.45;
      return Math.max(3, Math.floor(h));
    }
    function hauteur(wx, wz) { return hauteurDe(wx, wz, climat(wx, wz)); }

    /* Hauteur ET biome d'une colonne, en un seul calcul du climat. */
    function echantillon(wx, wz) {
      var c = climat(wx, wz);
      var h = hauteurDe(wx, wz, c);
      return { h: h, biome: LISTE[classer(c, h)], climat: c };
    }
    function biomeAt(wx, wz) { return echantillon(wx, wz).biome; }

    return { climat: climat, classer: classer, biomeAt: biomeAt, hauteur: hauteur,
             echantillon: echantillon };
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
