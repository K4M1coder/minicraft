/* souterrain.js — biomes souterrains : géodes et grottes de cristal sous les
   montagnes, chambres magmatiques sous les volcans, grottes luxuriantes sous
   les plaines et les forêts, grottes englouties sous les fonds marins, et au
   plus profond l'abîme (SPEC-SOUTERRAIN-001). Logique pure : ni THREE, ni
   document — une fonction de (biome de surface, profondeur), rien d'autre,
   pour que world.js et entities.js puissent l'appeler sans état partagé. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var B = C.B, I = C.I;

  // au plus profond, quel que soit ce qui se trouve au-dessus : l'abîme
  var ABIME_Y = 9;

  /* Matériaux et créatures de chaque biome souterrain. `deco` : blocs semés
     sur le sol des cavités (SPEC-LUMIERE-007 pour les luminescents). `mobs` :
     table d'apparition, au même format que MC.Biomes (poids relatifs, lue par
     MC.Biomes.tirerMob). */
  var BIOMES = {
    geode: {
      id: 'geode', nom: 'Géode', mur: B.STONE, sol: B.STONE,
      deco: [B.MINERAI_CRISTAL, B.CRISTAL_LUMINEUX, B.CRISTAL_LUMINEUX],
      lumiere: B.CRISTAL_LUMINEUX,
      mobs: { golem_cristal: 3, chauve_souris: 5 },
    },
    chambre_magmatique: {
      id: 'chambre_magmatique', nom: 'Chambre magmatique', mur: B.BASALT, sol: B.MAGMA,
      deco: [B.MAGMA, B.BASALT],
      lumiere: B.LAVA,
      mobs: { elementaire_magma: 4, chauve_souris: 1 },
    },
    luxuriante: {
      id: 'luxuriante', nom: 'Grotte luxuriante', mur: B.MOSSY_COBBLE, sol: B.MYCELIUM,
      deco: [B.VINES, B.CHAMPI_LUMINEUX, B.CHAMPI_LUMINEUX],
      lumiere: B.CHAMPI_LUMINEUX,
      // grotte humide : champignons ET lichens luminescents (SPEC-LUMIERE-007)
      lumieres: [B.CHAMPI_LUMINEUX, B.LICHEN_LUMINEUX],
      mobs: { araignee_caverne: 3, chauve_souris: 6 },
    },
    englouties: {
      id: 'englouties', nom: 'Grotte engloutie', mur: B.PRISMARINE, sol: B.GRAVEL,
      deco: [B.ALGUE_LUMINEUSE, B.KELP],
      lumiere: B.ALGUE_LUMINEUSE,
      mobs: { creature_aveugle: 5 },
    },
    abime: {
      id: 'abime', nom: 'Abîme', mur: B.OBSIDIAN, sol: B.STONE,
      deco: [B.CRISTAL_LUMINEUX],
      lumiere: B.CRISTAL_LUMINEUX,
      mobs: { rodeur_abysse: 4, chauve_souris: 2 },
    },
    // toute grotte qui ne tombe sous aucun des cas ci-dessus : la grotte ordinaire
    grotte: {
      id: 'grotte', nom: 'Grotte', mur: B.STONE, sol: B.STONE, deco: [], lumiere: 0,
      mobs: { chauve_souris: 5, araignee_caverne: 2 },
    },
  };

  // biomes de surface qui donnent leur empreinte au sous-sol
  var MONTAGNE_LIKE = { montagnes: 1, pics_glaces: 1, glacier: 1 };
  var LUXURIANT_LIKE = { plaines: 1, foret: 1, marais: 1, jungle: 1, savane: 1, champignons: 1 };

  /* Le biome souterrain en un point : d'abord l'abîme (le plus profond
     l'emporte sur tout), puis l'englouti (sous une colonne marine), puis ce
     que dit la surface, puis la grotte ordinaire à défaut. */
  function biomeAt(surfaceId, y, estMarin) {
    if (y <= ABIME_Y) return 'abime';
    if (estMarin) return 'englouties';
    if (surfaceId === 'volcan') return 'chambre_magmatique';
    if (MONTAGNE_LIKE[surfaceId]) return 'geode';
    if (LUXURIANT_LIKE[surfaceId]) return 'luxuriante';
    return 'grotte';
  }

  function materiaux(id) { return BIOMES[id] || BIOMES.grotte; }
  function mobsPour(id) { return materiaux(id).mobs; }

  /* Un bloc de décor pour le sol d'une cavité de ce biome, ou 0 (rien). `r`
     est un tirage dans [0, 1[ — le même hash déterministe qui sert déjà à
     placer les minerais, pour que la même graine redonne toujours le même
     monde. Environ un cinquième des sols de cavité reçoit un décor. */
  function decorSol(biomeId, r) {
    var m = materiaux(biomeId);
    if (!m.deco.length) return 0;
    if (r > 0.94 && m.lumiere) return m.lumieres ? m.lumieres[Math.floor(r * 9973) % m.lumieres.length] : m.lumiere;
    if (r > 0.8) return m.deco[Math.floor(r * 977) % m.deco.length];
    return 0;
  }

  /* ─── structures souterraines (SPEC-SOUTERRAIN-003) ────────────────────────
     Chaque biome souterrain a ses structures, de trois genres : un donjon qui
     lui est propre, les ruines d'une ancienne cité, une mine abandonnée avec
     ses rails et ses étais. Toutes sont bâties dans les matériaux du biome
     (mur, sol, lumière, décor : BIOMES plus haut) ; chaque biome y ajoute ce
     qui le distingue (un cœur de cristal, une forge de magma, un jardin de
     champignons, une cité noyée, un autel d'obsidienne, des toiles). Une
     grotte engloutie bâtit sous l'eau : ses salles sont noyées. */
  var GENRES = ['donjon', 'ruines', 'mine'];
  var STRUCTURES = {
    geode:              { donjon: 'Sanctuaire de cristal', ruines: 'Ruines cristallines', mine: 'Mine de cristal abandonnée',
                          coeur: B.CRISTAL_LUMINEUX, minerai: B.MINERAI_CRISTAL },
    chambre_magmatique: { donjon: 'Forge du magma', ruines: 'Ruines calcinées', mine: 'Mine de soufre abandonnée',
                          coeur: B.MAGMA, minerai: B.MINERAI_CRISTAL, lumiere: B.LANTERN },
    luxuriante:         { donjon: 'Jardin des spores', ruines: 'Ruines envahies', mine: 'Mine envahie de mousse',
                          coeur: B.CHAMPI_LUMINEUX, minerai: B.MINERAI_METAUX },
    englouties:         { donjon: 'Temple englouti', ruines: 'Cité engloutie', mine: 'Mine noyée',
                          coeur: B.SEA_LANTERN, minerai: B.MINERAI_ARGENT, noye: true, lumiere: B.SEA_LANTERN, mur: B.PRISMARINE_BRICK },
    abime:              { donjon: 'Autel de l\'abîme', ruines: 'Cité perdue de l\'abîme', mine: 'Mine profonde abandonnée',
                          coeur: B.OBSIDIAN, minerai: B.MINERAI_GEMMES },
    grotte:             { donjon: 'Crypte des cavernes', ruines: 'Ruines d\'une cité ancienne', mine: 'Mine abandonnée',
                          coeur: B.COBWEB, minerai: B.IRON_ORE, lumiere: B.TORCH, mur: B.STONE_BRICK },
  };
  function structurePour(biomeId, genre) {
    var s = STRUCTURES[biomeId] || STRUCTURES.grotte, m = materiaux(biomeId);
    return { biome: biomeId, genre: genre, nom: s[genre], mur: s.mur || m.mur, sol: m.sol,
             lumiere: s.lumiere || m.lumiere || B.TORCH, deco: m.deco, coeur: s.coeur, minerai: s.minerai,
             noye: !!s.noye };
  }

  // richesses du trésor d'un donjon souterrain : [id, min, max, chance]
  var BUTIN_BIOME = {
    geode:              [[I.SAPHIR, 1, 2, 0.6], [I.LAPIS, 2, 6, 0.8], [I.DIAMOND, 1, 1, 0.35]],
    chambre_magmatique: [[I.RUBIS, 1, 2, 0.6], [I.GOLD_INGOT, 2, 5, 0.8], [B.OBSIDIAN, 2, 4, 0.5]],
    luxuriante:         [[I.EMERALD, 1, 3, 0.7], [I.BONE_MEAL, 3, 8, 0.8], [B.MUSHROOM, 2, 6, 0.6]],
    englouties:         [[I.PRISMARINE_SHARD, 4, 10, 0.9], [B.SEA_LANTERN, 2, 4, 0.7], [I.GOLD_INGOT, 1, 4, 0.6]],
    abime:              [[I.DIAMOND, 1, 3, 0.7], [B.OBSIDIAN, 2, 6, 0.8], [I.RUBIS, 1, 2, 0.5]],
    grotte:             [[I.EMERALD, 1, 2, 0.5], [I.BONE, 2, 6, 0.8], [I.ARGENT_LINGOT, 1, 3, 0.4]],
  };

  var REGION_STRUCT = 112;      // une structure au plus par région de 112 × 112 blocs
  var PROBA_STRUCT = 0.4;       // part des régions qui en ont une
  var PORTEE_STRUCT = 30;       // au-delà, une structure ne touche plus un chunk
  var Y_MIN_STRUCT = 7;         // au-dessus des lacs de lave des profondeurs (y <= 6)
  var Y_MAX_STRUCT = 15;        // sous le plafond des biomes souterrains (16)
  var HAUT_STRUCT = 6;          // hauteur des salles, murs compris
  var TOIT_STRUCT = 3;          // roche gardée entre le haut d'une structure et la surface
  // demi-emprise de chaque genre (murs compris) : donjon ±6, ruines ±12, mine ±24 (galeries)
  var EMPRISE_STRUCT = { donjon: 7, ruines: 13, mine: 25 };

  /* `N` : le bruit du monde (hash2/hash3) ; `hauteur(x, z)` : la surface ;
     `biomeDe(x, z)` : le biome de surface. Comme MC.Donjons : chaque région
     se construit seule, à la demande, pour que chaque chunk pose SA part dans
     n'importe quel ordre de génération. */
  function creerStructures(N, hauteur, biomeDe) {
    var cache = new Map();

    function deRegion(rx, rz) {
      var k = rx + ',' + rz;
      if (cache.has(k)) return cache.get(k);
      if (cache.size > 4096) cache.clear();
      var s = construire(rx, rz);
      cache.set(k, s);
      return s;
    }

    function construire(rx, rz) {
      if (N.hash2(rx * 7121 + 3, rz * 5399 - 11) > PROBA_STRUCT) return null;
      var marge = PORTEE_STRUCT - 4;
      var x = rx * REGION_STRUCT + marge + Math.floor(N.hash2(rx * 431, rz * 823) * (REGION_STRUCT - 2 * marge));
      var z = rz * REGION_STRUCT + marge + Math.floor(N.hash2(rx * 977 + 5, rz * 197) * (REGION_STRUCT - 2 * marge));
      var y0 = Y_MIN_STRUCT + Math.floor(N.hash2(rx * 59 - 7, rz * 83 + 1) * (Y_MAX_STRUCT - Y_MIN_STRUCT + 1));
      // toute l'emprise reste sous terre (ou sous le fond de la mer), avec du roc au-dessus
      var bas = Infinity;
      for (var a = -2; a <= 2; a++) for (var b = -2; b <= 2; b++) bas = Math.min(bas, hauteur(x + a * 12, z + b * 12));
      if (y0 + HAUT_STRUCT + TOIT_STRUCT > bas) return null;
      var bio = biomeDe ? biomeDe(x, z) : null;
      var sId = biomeAt(bio ? bio.id : 'plaines', y0, !!(bio && bio.marin));
      var genre = GENRES[Math.floor(N.hash2(rx * 13 + 7, rz * 17 - 3) * GENRES.length) % GENRES.length];
      var st = structurePour(sId, genre);
      /* Une structure noyée est décidée par le biome du centre, mais ses salles
         s'étendent bien plus loin : près d'une côte, elle déborderait sous la terre
         ferme, au contact des cavernes d'air (l'eau fuirait dès qu'on la dérange).
         Elle n'existe que si TOUTE son emprise (et une marge) est marine. */
      if (st.noye && biomeDe) {
        var r = EMPRISE_STRUCT[genre] + 2;
        for (var a2 = -r; a2 <= r; a2 += 2) for (var b2 = -r; b2 <= r; b2 += 2) {
          var bi = biomeDe(x + a2, z + b2);
          if (!bi || !bi.marin) return null;
        }
      }
      st.id = 'sous:' + rx + ',' + rz; st.x = x; st.y = y0; st.z = z;
      st.blocs = []; st.salles = [];
      BATIR[genre](st, outils(st));
      // les blocs, rangés par chunk : chaque chunk ne relit que les siens
      st.parChunk = new Map();
      for (var i = 0; i < st.blocs.length; i++) {
        var bl = st.blocs[i], kc = Math.floor(bl[0] / 16) + ',' + Math.floor(bl[2] / 16);
        var l = st.parChunk.get(kc);
        if (!l) { l = []; st.parChunk.set(kc, l); }
        l.push(bl);
      }
      return st;
    }

    function outils(st) {
      var bl = st.blocs, vide = st.noye ? B.WATER : 0;
      function h3(x, y, z) { return N.hash3(x * 3 + 17, y * 7 - 5, z * 5 + 3); }
      return {
        vide: vide,
        pose: function (x, y, z, id) { if (y > 0) bl.push([x, y, z, id]); },
        // le mur du biome, piqué de minerai par endroits ; moussu dans les grottes luxuriantes
        mur: function (x, y, z) {
          var r = h3(x, y, z);
          if (r < 0.04 && st.minerai) return st.minerai;
          if (st.biome === 'luxuriante' && r < 0.4) return B.MOSSY_COBBLE;
          return st.mur;
        },
        h3: h3,
      };
    }

    // une salle creuse : sol, murs, plafond ; dedans le vide (de l'air, ou de l'eau)
    function salle(st, o, x0, y0, z0, x1, y1, z1, murs) {
      for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) {
        var bord = x === x0 || x === x1 || z === z0 || z === z1;
        if (y === y0) o.pose(x, y, z, st.sol);
        else if (y === y1 || (bord && murs)) o.pose(x, y, z, o.mur(x, y, z));
        else o.pose(x, y, z, o.vide);
      }
      st.salles.push({ x0: x0 + 1, y0: y0 + 1, z0: z0 + 1, x1: x1 - 1, y1: y1 - 1, z1: z1 - 1 });
    }

    var BATIR = {
      /* Le donjon propre au biome : une grande salle à piliers, éclairée de la
         lumière du biome, un cœur à son centre (amas de cristal, bassin de
         magma cerclé de basalte, tertre de champignons, lanterne marine,
         autel d'obsidienne, toiles), du décor le long des murs. */
      donjon: function (st, o) {
        var x = st.x, y = st.y, z = st.z, R = 6, H = HAUT_STRUCT;
        salle(st, o, x - R, y, z - R, x + R, y + H, z + R, true);
        [[-3, -3], [3, -3], [-3, 3], [3, 3]].forEach(function (p) {
          for (var py = 1; py < H; py++) o.pose(x + p[0], y + py, z + p[1], st.mur);
          o.pose(x + p[0] + (p[0] > 0 ? 1 : -1), y + 1, z + p[1], st.lumiere);
        });
        if (st.biome === 'chambre_magmatique') {
          for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) o.pose(x + a, y, z + b, (a || b) ? B.BASALT : B.MAGMA);
        } else if (st.biome === 'abime') {
          o.pose(x, y + 1, z, B.OBSIDIAN); o.pose(x, y + 2, z, B.CRISTAL_LUMINEUX);
        } else {
          o.pose(x, y + 1, z, st.coeur);
          if (st.coeur === B.CRISTAL_LUMINEUX || st.coeur === B.SEA_LANTERN) o.pose(x, y + 2, z, st.coeur);
        }
        for (var k = 0; k < 6; k++) {
          var dx = -R + 1 + Math.floor(o.h3(x, k, z) * (2 * R - 1)), dz = k % 2 ? -R + 1 : R - 1;
          var d = st.deco && st.deco.length ? st.deco[k % st.deco.length] : st.coeur;
          o.pose(x + dx, y + 1, z + dz, d);
        }
        /* le trésor au fond de la salle (butin propre au biome : MC.Souterrain.butin,
           lu par world.butinCoffre) et ses gardes, deux créatures du biome qui
           s'éveillent à l'entrée (comme les gardes des donjons de MC.Donjons) */
        o.pose(x, y + 1, z + R - 1, B.CHEST);
        st.coffres = [{ x: x, y: y + 1, z: z + R - 1 }];
        var gtypes = Object.keys(materiaux(st.biome).mobs).filter(function (t) { return t !== 'chauve_souris'; })
          .sort(function (a, b) { return materiaux(st.biome).mobs[b] - materiaux(st.biome).mobs[a]; });
        st.gardes = gtypes.length ? [-2, 2].map(function (dx, k) {
          return { salle: 0, type: gtypes[k % gtypes.length], x: x + dx + 0.5, y: y + 1, z: z + 0.5 };
        }) : [];
        // deux portes, de part et d'autre : la salle s'ouvre sur la roche, comme une grotte
        for (var w = -1; w <= 1; w++) for (var hy = 1; hy <= 3; hy++) { o.pose(x + R, y + hy, z + w, o.vide); o.pose(x - R, y + hy, z + w, o.vide); }
      },

      /* Les ruines d'une ancienne cité : une rue pavée du sol du biome, des
         maisons de cinq sur cinq dont les murs s'effondrent par endroits,
         quelques colonnes encore debout et la lumière du biome. */
      ruines: function (st, o) {
        var x = st.x, y = st.y, z = st.z, R = 12, H = HAUT_STRUCT;
        // la grande caverne qui abrite la cité
        for (var cx = x - R; cx <= x + R; cx++) for (var cz = z - R; cz <= z + R; cz++) {
          o.pose(cx, y, cz, st.sol);
          for (var cy = y + 1; cy < y + H; cy++) o.pose(cx, cy, cz, o.vide);
          o.pose(cx, y + H, cz, o.mur(cx, y + H, cz));
        }
        st.salles.push({ x0: x - R, y0: y + 1, z0: z - R, x1: x + R, y1: y + H - 1, z1: z + R });
        // la rue
        for (var i = -R; i <= R; i++) for (var w = -1; w <= 1; w++) o.pose(x + i, y, z + w, st.mur);
        // les maisons, de part et d'autre de la rue
        [-8, -1, 6].forEach(function (mx) {
          [-7, 3].forEach(function (mz) {
            var x0 = x + mx, z0 = z + mz;
            for (var a = 0; a <= 4; a++) for (var b = 0; b <= 4; b++) {
              if (a !== 0 && a !== 4 && b !== 0 && b !== 4) continue;
              var haut = 1 + Math.floor(o.h3(x0 + a, y, z0 + b) * 4);       // murs effondrés : 1 à 4 de haut
              if (b === (mz < 0 ? 4 : 0) && a === 2) haut = 0;               // la porte, côté rue
              for (var hy = 1; hy <= haut && hy < H; hy++) o.pose(x0 + a, y + hy, z0 + b, o.mur(x0 + a, y + hy, z0 + b));
            }
            o.pose(x0 + 2, y + 1, z0 + 2, o.h3(x0, y, z0) < 0.5 ? st.lumiere : st.coeur);
          });
        });
        // colonnes encore debout le long de la rue
        for (var c = -R + 2; c <= R - 2; c += 5) [-2, 2].forEach(function (s) {
          var hc = 2 + Math.floor(o.h3(x + c, y + 9, z + s) * (H - 2));
          for (var hy2 = 1; hy2 <= hc && hy2 < H; hy2++) o.pose(x + c, y + hy2, z + s, st.mur);
        });
      },

      /* La mine abandonnée : quatre galeries étayées partent d'une chambre ; un
         rail court au milieu de chaque galerie ; tous les quatre blocs, un étai
         (deux poteaux de bois et une poutre de planches) ; du minerai du biome
         dans les parois, des toiles, quelques lumières. */
      mine: function (st, o) {
        var x = st.x, y = st.y, z = st.z, L = 22;
        salle(st, o, x - 4, y, z - 4, x + 4, y + 5, z + 4, true);
        var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        dirs.forEach(function (d) {
          var ux = d[0], uz = d[1], px = -uz, pz = ux;
          for (var i = 4; i <= L; i++) {
            var cx = x + ux * i, cz = z + uz * i;
            for (var w = -2; w <= 2; w++) {
              var bx = cx + px * w, bz = cz + pz * w;
              if (Math.abs(w) === 2) {                      // les parois, piquées de minerai
                for (var hy = 1; hy <= 3; hy++) o.pose(bx, y + hy, bz, o.h3(bx, y + hy, bz) < 0.12 ? st.minerai : o.mur(bx, y + hy, bz));
                continue;
              }
              o.pose(bx, y, bz, st.sol);
              for (var a = 1; a <= 3; a++) o.pose(bx, y + a, bz, o.vide);
              o.pose(bx, y + 4, bz, o.mur(bx, y + 4, bz));
            }
            o.pose(cx, y + 1, cz, B.RAIL);
            if (i % 4 === 0) {
              o.pose(cx + px, y + 1, cz + pz, B.LOG); o.pose(cx + px, y + 2, cz + pz, B.LOG);
              o.pose(cx - px, y + 1, cz - pz, B.LOG); o.pose(cx - px, y + 2, cz - pz, B.LOG);
              for (var w2 = -1; w2 <= 1; w2++) o.pose(cx + px * w2, y + 3, cz + pz * w2, B.PLANKS);
            }
            if (i % 4 === 2 && !st.noye) o.pose(cx - px, y + 1, cz - pz, st.lumiere);
            if (i % 4 === 2 && st.noye) o.pose(cx - px, y + 4, cz - pz, st.lumiere);
            if (!st.noye && o.h3(cx, y, cz) < 0.1) o.pose(cx - px, y + 3, cz - pz, B.COBWEB);
          }
          /* La galerie ouvre déjà sa section (vide sur y+1..3, w de -1 à 1) dès i = 4,
             dans la paroi de la chambre : on n'y repose rien après les poteaux, la poutre
             et le rail du premier étai, sans quoi ils seraient effacés. */
          st.salles.push({ x0: Math.min(x + ux * 4, x + ux * L) - (uz ? 1 : 0), y0: y + 1, z0: Math.min(z + uz * 4, z + uz * L) - (ux ? 1 : 0),
                           x1: Math.max(x + ux * 4, x + ux * L) + (uz ? 1 : 0), y1: y + 3, z1: Math.max(z + uz * 4, z + uz * L) + (ux ? 1 : 0) });
        });
        [[-3, -3], [3, 3]].forEach(function (p) { o.pose(x + p[0], y + 1, z + p[1], st.lumiere); });
        o.pose(x, y + 1, z, st.coeur === B.COBWEB ? B.RAIL : st.coeur);
      },
    };

    function dansZone(x0, z0, x1, z1) {
      var res = [];
      var rx0 = Math.floor((x0 - PORTEE_STRUCT) / REGION_STRUCT), rx1 = Math.floor((x1 + PORTEE_STRUCT) / REGION_STRUCT);
      var rz0 = Math.floor((z0 - PORTEE_STRUCT) / REGION_STRUCT), rz1 = Math.floor((z1 + PORTEE_STRUCT) / REGION_STRUCT);
      for (var rx = rx0; rx <= rx1; rx++) for (var rz = rz0; rz <= rz1; rz++) {
        var s = deRegion(rx, rz);
        if (s) res.push(s);
      }
      return res;
    }

    /* Pose dans le chunk (cx, cz) la part des structures qui le touche. */
    function appliquer(cx, cz, put) {
      var x0 = cx * 16, z0 = cz * 16, n = 0, kc = cx + ',' + cz;
      dansZone(x0, z0, x0 + 15, z0 + 15).forEach(function (s) {
        var l = s.parChunk.get(kc);
        if (!l) return;
        for (var i = 0; i < l.length; i++) { put(l[i][0], l[i][1], l[i][2], l[i][3]); n++; }
      });
      return n;
    }

    /* La structure dont une salle contient ce point, ou null. */
    function structureA(x, y, z) {
      var l = dansZone(x, z, x, z);
      for (var i = 0; i < l.length; i++) for (var k = 0; k < l[i].salles.length; k++) {
        var s = l[i].salles[k];
        if (x >= s.x0 && x < s.x1 + 1 && y >= s.y0 && y < s.y1 + 1 && z >= s.z0 && z < s.z1 + 1) return l[i];
      }
      return null;
    }

    /* Le donjon souterrain dont ce bloc est le coffre au trésor : { donjon, indice }, ou null. */
    function coffreA(x, y, z) {
      var l = dansZone(x, z, x, z);
      for (var i = 0; i < l.length; i++) {
        var cs = l[i].coffres || [];
        for (var k = 0; k < cs.length; k++) if (cs[k].x === x && cs[k].y === y && cs[k].z === z) return { donjon: l[i], indice: k };
      }
      return null;
    }
    /* La salle (gardée) d'un donjon souterrain qui contient ce point : { donjon, index }, ou null. */
    function salleDe(x, y, z) {
      var l = dansZone(x, z, x, z);
      for (var i = 0; i < l.length; i++) {
        if (!l[i].gardes || !l[i].gardes.length) continue;
        var s = l[i].salles[0];
        if (x >= s.x0 && x < s.x1 + 1 && y >= s.y0 && y < s.y1 + 1 && z >= s.z0 && z < s.z1 + 1) return { donjon: l[i], index: 0 };
      }
      return null;
    }
    /* Butin du trésor d'un donjon souterrain, tiré de sa position (déterministe, comme
       MC.Donjons.butin) : une base de vivres et de fer, les richesses propres au biome. */
    function butin(st, indice) {
      var sd = (indice || 0) * 101;
      function r() { sd++; return N.hash3(st.x * 7 + sd, st.y + sd * 13, st.z * 11 - sd); }
      function entre(a, b) { return a + Math.floor(r() * (b - a + 1)); }
      var l = [{ id: I.BREAD, n: entre(2, 4) }, { id: I.IRON_INGOT, n: entre(2, 5) }, { id: I.COAL, n: entre(3, 8) }];
      (BUTIN_BIOME[st.biome] || BUTIN_BIOME.grotte).forEach(function (t) {
        if (r() < t[3]) l.push({ id: t[0], n: entre(t[1], t[2]) });
      });
      return l;
    }

    return { deRegion: deRegion, dansZone: dansZone, appliquer: appliquer, structureA: structureA,
             coffreA: coffreA, salleDe: salleDe, butin: butin };
  }

  MC.Souterrain = {
    ABIME_Y: ABIME_Y, BIOMES: BIOMES,
    biomeAt: biomeAt, materiaux: materiaux, mobsPour: mobsPour, decorSol: decorSol,
    // SPEC-SOUTERRAIN-003
    GENRES: GENRES, STRUCTURES: STRUCTURES, structurePour: structurePour, creerStructures: creerStructures,
    REGION_STRUCT: REGION_STRUCT, PORTEE_STRUCT: PORTEE_STRUCT,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
