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
      rocheDes: 52, neigeDes: 64,
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

  /* Poids climatiques dérivés des trois champs bruts (température, humidité,
     propension montagneuse). Extrait de `climat()` pour être réutilisé sur un
     triplet perturbé : c'est ce qui permet à `melange()` de repérer un biome
     voisin sans reéchantillonner le bruit (SPEC-BIOME-005). */
  function pesee(t, h, r) {
    var wm = smoothstep(0.76, 0.92, r);
    var wd = smoothstep(0.60, 0.74, t) * (1 - smoothstep(0.46, 0.60, h)) * (1 - wm);
    var wb = wd * (1 - smoothstep(0.26, 0.36, h));
    var ws = smoothstep(0.60, 0.72, h) * smoothstep(0.34, 0.46, t) * (1 - smoothstep(0.54, 0.62, t)) *
             (1 - wm) * (1 - wd);
    var wc = smoothstep(0.80, 0.88, h) * (1 - smoothstep(0.18, 0.28, r)) *
             smoothstep(0.34, 0.40, t) * (1 - smoothstep(0.56, 0.62, t));
    return { t: t, h: h, r: r, montagne: wm, desert: wd, badlands: wb, marais: ws, champignons: wc };
  }

  // profondeur à partir de laquelle une colonne immergée devient un biome marin
  var PROF_MARINE = 2;

  /* Trois profils de volcans (SPEC-RELIEF-010) : `exp` façonne le profil du
     cône (haut => flancs raides et étroits, bas => dôme large et plat),
     `craterFrac` la part du rayon occupée par le cratère, `dd`/`dr` la
     profondeur du fond du cratère et la remontée vers son rebord, `dl` le
     niveau de la lave (constant, entre le fond et le rebord — actif seulement). */
  var TYPES_VOLCAN = {
    // stratovolcan : élancé, cône étroit et raide
    stratovolcan: { rMin: 34, rRange: 18, sommetBase: 66, sommetRange: 12, exp: 1.9, craterFrac: 0.16, dd: 7, dl: 4, dr: 5 },
    // bouclier : large et plat, pentes très douces
    bouclier: { rMin: 60, rRange: 30, sommetBase: 54, sommetRange: 8, exp: 0.65, craterFrac: 0.10, dd: 4, dl: 2, dr: 3 },
    // caldeira : sommet effondré, un vaste cratère peu profond au regard de son rayon
    caldeira: { rMin: 46, rRange: 20, sommetBase: 58, sommetRange: 10, exp: 1.3, craterFrac: 0.52, dd: 15, dl: 9, dr: 11 },
  };

  function creer(N) {
    /* Trois champs indépendants, décalés pour ne pas être corrélés :
       température, humidité, et propension au relief montagneux.
       Échelles larges (SPEC-BIOME-006, SPEC-BIOME-007) : les régions
       climatiques et les massifs s'étendent sur plusieurs kilomètres, si bien
       qu'un désert et une banquise — climats incompatibles — ne se touchent
       jamais à moins de plusieurs centaines de blocs. */
    function climat(wx, wz) {
      /* La température (t) sépare à elle seule les déserts brûlants des
         banquises glacées : deux octaves sur une très large échelle (SPEC-BIOME-007)
         empêchent la moindre poche fine de contredire la tendance régionale, si
         bien qu'aucun désert ne touche une banquise à moins de 800 blocs. */
      var t = etaler(N.fbm((wx - 9000) / 4200, (wz - 2200) / 4200, 2, 2, 0.32));
      var h = etaler(N.fbm((wx - 5227) / 900, (wz + 3301) / 900, 3, 2, 0.5));
      var r = etaler(N.fbm((wx + 9127) / 640, (wz + 7411) / 640, 3, 2, 0.5));
      // poids CONTINUS : ils pilotent le relief autant que le classement du biome
      return pesee(t, h, r);
    }

    /* ── Volcans ───────────────────────────────────────────────────────────
       Au plus un par région de 384 blocs. Un cône qui s'élève du relief (ou de
       la mer : c'est alors une île), un cratère au sommet. Tout est fonction
       pure de la graine — y compris la chaîne (SPEC-RELIEF-008), qui ne
       consulte que le résultat, déjà pur, de la région précédente : le monde
       ne dépend jamais de l'ordre dans lequel il est exploré. */
    var REGION_VOLCAN = 384;
    var volcans = new Map();
    var GRILLE_VOLCAN = 4;          // 4×4 points sondés par région, à la recherche d'un relief
    function volcanDe(rx, rz) {
      var k = rx + ',' + rz;
      if (volcans.has(k)) return volcans.get(k);
      var v = null;
      var m = 80;
      // on sonde une petite grille de la région : un volcan a besoin d'un
      // vrai relief montagneux (SPEC-RELIEF-007 — jamais au milieu d'une
      // plaine), qu'une seule position tirée au hasard risquerait de manquer
      var meilleur = -1, mx = 0, mz = 0;
      for (var gx = 0; gx < GRILLE_VOLCAN; gx++) for (var gz = 0; gz < GRILLE_VOLCAN; gz++) {
        var px = rx * REGION_VOLCAN + m + Math.round((gx + 0.5) / GRILLE_VOLCAN * (REGION_VOLCAN - 2 * m));
        var pz = rz * REGION_VOLCAN + m + Math.round((gz + 0.5) / GRILLE_VOLCAN * (REGION_VOLCAN - 2 * m));
        var wm = climat(px, pz).montagne;
        if (wm > meilleur) { meilleur = wm; mx = px; mz = pz; }
      }
      if (meilleur >= 0.35 && N.hash2(rx * 7919 + 3, rz * 104729 - 11) < 0.34) {
        // léger jitter autour du meilleur point sondé, pour ne pas s'aligner sur la grille —
        // annulé s'il retombe hors du relief montagneux qui a justifié ce volcan
        var jx = Math.floor((N.hash2(rx * 31, rz * 57) - 0.5) * 20);
        var jz = Math.floor((N.hash2(rx * 83, rz * 29) - 0.5) * 20);
        var cx = mx, cz = mz;
        if (climat(mx + jx, mz + jz).montagne >= 0.30) { cx = mx + jx; cz = mz + jz; }
        cx = Math.max(rx * REGION_VOLCAN + m, Math.min(rx * REGION_VOLCAN + REGION_VOLCAN - m, cx));
        cz = Math.max(rz * REGION_VOLCAN + m, Math.min(rz * REGION_VOLCAN + REGION_VOLCAN - m, cz));
        // trois profils distincts (SPEC-RELIEF-010)
        var tirage = N.hash2(rx * 211 + 3, rz * 307 - 7);
        var type = tirage < 0.45 ? 'stratovolcan' : tirage < 0.8 ? 'bouclier' : 'caldeira';
        var td = TYPES_VOLCAN[type];
        var R = td.rMin + Math.floor(N.hash2(rx * 5, rz * 13) * td.rRange);
        v = { x: cx, z: cz, R: R, type: type };
        v.sommet = td.sommetBase + Math.floor(N.hash2(rx * 17, rz * 3) * td.sommetRange);
        v.cratere = Math.max(4, Math.round(R * td.craterFrac));
        // éteint un peu moins d'une fois sur deux (SPEC-RELIEF-009) : plus de
        // lave, le cratère se referme alors en lac ou en herbe
        v.actif = N.hash2(rx * 617 - 3, rz * 911 + 5) < 0.6;
        v.lave = v.actif ? v.sommet - td.dl : 0;
        v.lac = !v.actif && N.hash2(rx * 313 + 9, rz * 419 - 17) < 0.5;
        // chaîne (SPEC-RELIEF-008) : parfois, ce volcan prolonge la crête de
        // son voisin immédiat (la région à l'ouest)
        var ouest = volcanDe(rx - 1, rz);
        if (ouest && ouest.chaine && N.hash2(rx * 41 - 9, rz * 23 + 1) < 0.55) {
          v.chaine = ouest.chaine;
        } else if (N.hash2(rx * 97 + 11, rz * 131 - 3) < 0.35) {
          v.chaine = rx + ',' + rz;
        }
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

    /* ── Transitions (SPEC-BIOME-005) ─────────────────────────────────────────
       Le classement ci-dessus tranche net à 0,5 sur des poids pourtant continus :
       vu du sol, un pas suffirait à faire basculer l'herbe en sable. `melange`
       perturbe légèrement les trois champs bruts, dans une direction choisie par
       un bruit fin (le « dithering »), et reclasse : si un si petit écart suffit
       à changer de biome, c'est qu'on est près d'une frontière — le voisin ainsi
       trouvé et un poids (bruit indépendant, jusqu'à 0,5) disent de combien le
       mélanger. Loin de toute frontière, le moindre écart ne change rien : le
       poids retombe à 0 tout seul. Volcans, glaciers, lacs et rivières restent
       des ruptures nettes, voulues (cf. SPEC-BIOME-003) : on ne les mélange pas. */
    var BANDE_MEL = 0.05;               // demi-largeur, en climat, de la bande perturbée
    function melange(wx, wz, col) {
      col = col || colonne(wx, wz);
      var c = col.climat;
      var principal = classer(c, col.h);
      var bioP = LISTE[principal];
      if (bioP.marin || c.volcan || c.glacier || c.lac || c.riviere) {
        return { principal: principal, voisin: null, poids: 0 };
      }
      // dithering : un bruit fin décale localement les champs, plutôt qu'une
      // ligne nette suivant une simple courbe de niveau du climat
      var dith = N.fbm((wx + 4001) / 9, (wz - 2207) / 9, 2, 2, 0.5) * 2 - 1;
      var c2 = pesee(clamp01(c.t + dith * BANDE_MEL), clamp01(c.h + dith * BANDE_MEL), clamp01(c.r + dith * BANDE_MEL));
      var voisin = classerTerre(c2);
      if (voisin === principal) return { principal: principal, voisin: null, poids: 0 };
      // poids : un bruit indépendant, triangulaire, maximal au cœur de la bande
      var g = N.fbm((wx - 733) / 9, (wz + 511) / 9, 2, 2, 0.5);
      var poids = 0.5 * (1 - Math.abs(g * 2 - 1));
      return { principal: principal, voisin: voisin, poids: poids };
    }

    /* Hauteur du terrain. La base reprend le relief d'origine (continents,
       collines, détail) ; chaque biome la module par son poids. */
    function hauteurBrute(wx, wz, c) {
      // continents, chaînes et bassins (SPEC-BIOME-006) : une échelle kilométrique,
      // bien plus large que les collines (70) et le détail (18) qui suivent
      var continent = N.fbm(wx / 900, wz / 900, 3, 2, 0.5);
      var hills = N.signed(N.fbm(wx / 70, wz / 70, 4, 2, 0.5));
      var detail = N.signed(N.fbm(wx / 18, wz / 18, 2, 2, 0.5));
      var relief = Math.pow(Math.max(0, continent - 0.52) * 2.1, 1.7);
      var basin = Math.pow(Math.max(0, 0.46 - continent) * 2.6, 1.4);
      // fosses : les continents les plus bas plongent vers les abysses
      var fosse = Math.pow(Math.max(0, 0.38 - continent) * 3.2, 1.3) * 9;

      // le désert aplanit les collines en dunes molles
      var collines = hills * 9 * (1 - 0.65 * c.desert);
      var h = SEA + 2 + collines - basin * 14 - fosse + relief * 30 + detail * 2.5;
      // relief de fond, sans le détail ni les crêtes : il donne leur pente aux rivières
      c.hLisse = SEA + 2 + collines - basin * 14 - fosse + relief * 30;

      // montagnes : des crêtes (bruit « ridged ») plutôt que des bosses rondes
      if (c.montagne > 0) {
        var ridge = 1 - Math.abs(N.signed(N.fbm((wx + 300) / 85, (wz - 170) / 85, 3, 2, 0.5)));
        h += c.montagne * (12 + ridge * ridge * 30);
        /* Grands massifs : au cœur des chaînes les plus hautes, les crêtes
           se dressent encore et percent la première couche de nuages. Le
           massif est large (bruit à 190 blocs) : la pente reste gravissable. */
        var massif = smoothstep(0.80, 0.99, c.r) * c.montagne;
        if (massif > 0) {
          var pic = N.fbm((wx - 911) / 190, (wz + 613) / 190, 3, 2, 0.5);
          h += massif * (16 + smoothstep(0.3, 0.8, pic) * 36);
        }
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
      if (h > 92) h = 92 + (h - 92) * 0.45;
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
        var td = TYPES_VOLCAN[v.type];
        var cone = SEA + 2 + (v.sommet - SEA - 2) * Math.pow(Math.max(0, 1 - d / v.R), td.exp);
        var enCratere = d < v.cratere;
        if (enCratere) {
          // le cratère : une cuvette sous le rebord, pleine de lave s'il est actif
          cone = v.sommet - td.dd + Math.pow(d / v.cratere, 2) * td.dr;
          if (v.actif) lave = v.lave;
        }
        if (cone > h) h = Math.floor(cone);
        // éteint : le cratère redevient le biome ambiant — un lac ou de l'herbe (SPEC-RELIEF-009)
        c.volcan = d < v.R * 0.8 && (v.actif || !enCratere);
        if (!v.actif && enCratere && v.lac) {
          eau = Math.max(eau, v.sommet - td.dd + td.dr - 2);
        }
        // coulées : des rigoles de magma qui dévalent les flancs, tant qu'il est actif
        c.coulee = v.actif && c.volcan && d > v.cratere + 1 &&
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
      /* ── Rivières ──────────────────────────────────────────────────────────
         Un réseau de tracés sinueux (la ligne médiane d'un bruit). Leur niveau
         suit le relief de fond par paliers de trois blocs : l'eau descend vers
         la mer, et là où le palier change, elle décroche en cascade. Le lit est
         creusé sous ce niveau ; les berges descendent en pente douce vers lui,
         ou se relèvent en levée là où le terrain serait plus bas que l'eau. */
      c.riviere = false;
      if (!v && !c.lac && h > SEA - 1 && c.montagne < 0.6 && c.hLisse < SEA + 44) {
        var rv = riviere(wx, wz);
        if (rv > RIVE) {
          var niv = niveauRiviere(c.hLisse);
          if (rv > LIT) {
            var creux = 1 + Math.floor((rv - LIT) / (1 - LIT) * 3);
            h = Math.min(h, niv - creux);
            eau = niv;
            c.riviere = true;
          } else {
            var pente = Math.floor((LIT - rv) / (LIT - RIVE) * 6);
            h = Math.max(niv + 1, Math.min(h, niv + 1 + pente));
          }
        }
      }
      // glacier : les hauteurs froides se couvrent de glace bleue
      c.glacier = !c.volcan && c.t < 0.22 && h >= 44;
      return { h: Math.max(3, h), eau: eau, lave: lave, climat: c };
    }
    function hauteur(wx, wz) { return colonne(wx, wz).h; }

    // 1 sur la ligne médiane d'une rivière, décroissant vers ses berges
    var LIT = 0.992, RIVE = 0.975;
    function riviere(wx, wz) {
      var n = N.fbm((wx + 3313) / 720, (wz - 1771) / 720, 3, 2, 0.5);
      return 1 - Math.abs(n - 0.5) * 2;
    }
    function niveauRiviere(hLisse) {
      return SEA + Math.floor(Math.max(0, hLisse - SEA - 1) / 3) * 3;
    }
    /* Sens du courant d'une rivière en (wx, wz) : le long du tracé (perpendiculaire
       au gradient du bruit), dans le sens où le relief de fond descend. */
    function courantRiviere(wx, wz) {
      var e = 2;
      var gx = riviere(wx + e, wz) - riviere(wx - e, wz), gz = riviere(wx, wz + e) - riviere(wx, wz - e);
      var tx = -gz, tz = gx, n = Math.hypot(tx, tz);
      if (n < 1e-9) return { x: 0, z: 0 };
      tx /= n; tz /= n;
      var hA = climat(wx + tx * 12, wz + tz * 12), hB = climat(wx - tx * 12, wz - tz * 12);
      var a = hauteurBrute(wx + tx * 12, wz + tz * 12, hA) && hA.hLisse, b = hauteurBrute(wx - tx * 12, wz - tz * 12, hB) && hB.hLisse;
      return a <= b ? { x: tx, z: tz } : { x: -tx, z: -tz };
    }

    /* Hauteur, eau, lave ET biome d'une colonne, en un seul calcul du climat. */
    function echantillon(wx, wz) {
      var col = colonne(wx, wz);
      col.biome = LISTE[classer(col.climat, col.h)];
      return col;
    }
    function biomeAt(wx, wz) { return echantillon(wx, wz).biome; }

    return { climat: climat, classer: classer, biomeAt: biomeAt, hauteur: hauteur,
             echantillon: echantillon, colonne: colonne, volcanProche: volcanProche,
             lacProche: lacProche, volcanDe: volcanDe, lacDe: lacDe, melange: melange,
             riviere: riviere, niveauRiviere: niveauRiviere, courantRiviere: courantRiviere, LIT: LIT, RIVE: RIVE };
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
