/* donjons.js — structures gardées par un miniboss, propres à leur biome, à
   leur climat et à leur altitude.
   Logique pure. Un donjon est entièrement déterminé par la graine et sa
   région : chaque chunk peut donc en poser SA part sans connaître les autres,
   dans n'importe quel ordre de génération. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var B = C.B, I = C.I, SEA = C.SEA_LEVEL;

  var REGION = 96;          // un donjon au plus par région de 96 × 96 blocs
  var PROBA = 0.6;          // proportion de régions qui en contiennent un
  var DEMI = 6;             // demi-largeur extérieure de la crypte (13 × 13)
  var HAUT = 6;             // hauteur de la crypte, murs compris
  var PROFONDEUR = 16;      // sol de la crypte sous la surface
  // au-delà, un donjon ne touche plus un chunk : salle (12) + escalier (64) + marge
  var PORTEE = 80;

  /* Types de donjons. `boss` : un gardien, ou une liste tirée au sort. */
  var TYPES = {
    crypte:           { nom: 'Crypte', boss: ['boss_zombie', 'boss_squelette', 'boss_slime'] },
    mine:             { nom: 'Mine abandonnée', boss: ['boss_araignee'] },
    pyramide:         { nom: 'Pyramide', boss: ['boss_pharaon'] },
    forteresse_glace: { nom: 'Forteresse de glace', boss: ['boss_yeti'] },
    temple:           { nom: 'Temple de la jungle', boss: ['boss_serpent'] },
    hutte:            { nom: 'Hutte de la sorcière', boss: ['boss_sorciere'] },
    citadelle:        { nom: 'Citadelle des cimes', boss: ['boss_wyverne'] },
    monument:         { nom: 'Monument sous-marin', boss: ['boss_gardien_ancien'], marin: true },
    epave:            { nom: 'Épave', boss: ['boss_capitaine'], marin: true },
  };
  // tous les gardiens, sans doublon
  var BOSS = [];
  Object.keys(TYPES).forEach(function (t) {
    TYPES[t].boss.forEach(function (b) { if (BOSS.indexOf(b) < 0) BOSS.push(b); });
  });

  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  /* Quel donjon pour quel lieu. L'altitude et la profondeur comptent autant
     que le biome : une montagne n'accueille sa citadelle qu'au sommet, un
     océan son monument que dans les grands fonds. */
  function typePour(bio, surf, tirage) {
    if (bio && bio.marin) {
      var prof = SEA - surf;
      if (prof >= 9) return 'monument';
      if (prof >= 4) return 'epave';
      return null;
    }
    if (surf < SEA + 2) return null;          // rivage, lac : rien
    var id = bio ? bio.id : 'plaines';
    if (id === 'desert') return 'pyramide';
    if (id === 'taiga' || id === 'pics_glaces') return 'forteresse_glace';
    if (id === 'jungle') return 'temple';
    if (id === 'marais') return 'hutte';
    if (id === 'montagnes' && surf >= 44) return 'citadelle';
    if (id === 'badlands' || id === 'montagnes') return 'mine';
    return tirage < 0.55 ? 'crypte' : 'mine';
  }

  function creer(N, hauteur, biomeDe) {
    var cache = new Map();

    /* Le donjon d'une région, ou null. Mis en cache : les chunks voisins le
       redemandent tous, et son plan (quelques milliers de blocs) ne change pas. */
    function deRegion(rx, rz) {
      var k = rx + ',' + rz;
      if (cache.has(k)) return cache.get(k);
      var d = construire(rx, rz);
      cache.set(k, d);
      return d;
    }

    function construire(rx, rz) {
      if (N.hash2(rx * 92821 + 17, rz * 68917 - 5) > PROBA) return null;
      var marge = 20;
      var x = rx * REGION + marge + Math.floor(N.hash2(rx * 311, rz * 719) * (REGION - 2 * marge));
      var z = rz * REGION + marge + Math.floor(N.hash2(rx * 977, rz * 131) * (REGION - 2 * marge));
      var surf = hauteur(x, z);
      var bio = biomeDe ? biomeDe(x, z) : null;
      var type = typePour(bio, surf, N.hash2(rx * 13 - 1, rz * 29 + 3));
      if (!type) return null;
      var liste = TYPES[type].boss;
      var d = {
        id: rx + ',' + rz, type: type, nom: TYPES[type].nom, x: x, z: z, surface: surf,
        boss: liste[Math.floor(N.hash2(rx * 53 + 7, rz * 41 - 3) * liste.length) % liste.length],
        salle: null, coffre: null, spawn: null, entree: null, blocs: [],
      };
      BATISSEURS[type](d, outilsPour(d), rx, rz);
      return d;
    }

    /* Petits outils de construction partagés par tous les bâtisseurs. */
    function outilsPour(d) {
      var bl = d.blocs;
      return {
        pose: function (x, y, z, id) { bl.push([x, y, z, id]); },
        // pavé plein (bornes incluses)
        pave: function (x0, y0, z0, x1, y1, z1, id) {
          for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) bl.push([x, y, z, id]);
        },
        // pavé creux : une coque de `mur`, remplie de `dedans` (0 = air, B.WATER sous l'eau)
        coque: function (x0, y0, z0, x1, y1, z1, mur, dedans) {
          for (var x = x0; x <= x1; x++) for (var y = y0; y <= y1; y++) for (var z = z0; z <= z1; z++) {
            var bord = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
            bl.push([x, y, z, bord ? (typeof mur === 'function' ? mur(x, y, z) : mur) : dedans]);
          }
        },
        // comble le vide sous une emprise, du sol naturel jusqu'à `yHaut`
        fondation: function (x0, z0, x1, z1, yHaut, id) {
          for (var x = x0; x <= x1; x++) for (var z = z0; z <= z1; z++) {
            for (var y = Math.max(1, hauteur(x, z) + 1); y <= yHaut; y++) bl.push([x, y, z, id]);
          }
        },
        mousse: function (x, y, z) { return N.hash3(x, y, z) < 0.3 ? B.MOSSY_COBBLE : B.STONE_BRICK; },
        hash: function (a, b, c) { return N.hash3(a, b || 0, c || 0); },
      };
    }

    function salle(d, x0, y0, z0, x1, y1, z1) {
      d.salle = { x0: x0, y0: y0, z0: z0, x1: x1, y1: y1, z1: z1 };
    }
    function coffre(d, o, x, y, z) {
      d.coffre = { x: x, y: y, z: z };
      o.pose(x, y, z, B.CHEST);
    }

    // ─── bâtisseurs ─────────────────────────────────────────────────────────
    var BATISSEURS = {
      /* Crypte : salle souterraine en brique moussue, quatre piliers et leurs
         torches, un escalier qui remonte à l'air libre. */
      crypte: function (d, o, rx, rz) {
        var x = d.x, z = d.z;
        var y0 = Math.max(4, Math.min(d.surface - PROFONDEUR, SEA - 6));
        d.y = y0;
        o.coque(x - DEMI, y0, z - DEMI, x + DEMI, y0 + HAUT, z + DEMI, o.mousse, 0);
        [[-3, -3], [3, -3], [-3, 3], [3, 3]].forEach(function (p) {
          for (var py = 1; py < HAUT; py++) o.pose(x + p[0], y0 + py, z + p[1], B.STONE_BRICK);
          o.pose(x + p[0] + (p[0] > 0 ? 1 : -1), y0 + 1, z + p[1], B.TORCH);
        });
        salle(d, x - DEMI + 1, y0 + 1, z - DEMI + 1, x + DEMI - 1, y0 + HAUT - 1, z + DEMI - 1);
        coffre(d, o, x, y0 + 1, z + DEMI - 2);
        d.spawn = { x: x + 0.5, y: y0 + 1, z: z + 0.5 };
        escalierVersSurface(d, o, rx, rz, DEMI);
      },

      /* Mine abandonnée : une chambre profonde, quatre galeries étayées de
         poutres, des rails, des toiles, et un puits à échelle vers la surface. */
      mine: function (d, o) {
        var x = d.x, z = d.z;
        var y0 = Math.max(5, d.surface - 28);
        d.y = y0;
        o.coque(x - 5, y0, z - 5, x + 5, y0 + 6, z + 5, B.PLANKS, 0);
        for (var k = 0; k < 4; k++) {
          var ux = DIRS[k][0], uz = DIRS[k][1], px = -uz, pz = ux;
          for (var i = 6; i <= 24; i++) {
            var cx = x + ux * i, cz = z + uz * i;
            for (var w = -1; w <= 1; w++) {
              o.pose(cx + px * w, y0, cz + pz * w, B.PLANKS);
              for (var a = 1; a <= 3; a++) o.pose(cx + px * w, y0 + a, cz + pz * w, 0);
            }
            o.pose(cx, y0 + 1, cz, B.RAIL);
            // étai tous les quatre blocs : deux poteaux et une poutre
            if (i % 4 === 0) {
              o.pose(cx + px, y0 + 1, cz + pz, B.LOG); o.pose(cx + px, y0 + 2, cz + pz, B.LOG);
              o.pose(cx - px, y0 + 1, cz - pz, B.LOG); o.pose(cx - px, y0 + 2, cz - pz, B.LOG);
              for (var w2 = -1; w2 <= 1; w2++) o.pose(cx + px * w2, y0 + 3, cz + pz * w2, B.PLANKS);
            }
            if (i % 8 === 2) o.pose(cx - px, y0 + 1, cz - pz, B.TORCH);
            if (o.hash(cx, y0, cz) < 0.12) o.pose(cx - px, y0 + 3, cz - pz, B.COBWEB);
          }
          // porte de la chambre vers la galerie
          for (var w3 = -1; w3 <= 1; w3++) for (var b = 1; b <= 3; b++) o.pose(x + ux * 5 + px * w3, y0 + b, z + uz * 5 + pz * w3, 0);
        }
        [[-4, -4], [4, -4]].forEach(function (p) { o.pose(x + p[0], y0 + 1, z + p[1], B.TORCH); });
        [[-3, 3], [3, -3], [0, -3]].forEach(function (p) { o.pose(x + p[0], y0 + 5, z + p[1], B.COBWEB); });
        salle(d, x - 4, y0 + 1, z - 4, x + 4, y0 + 5, z + 4);
        coffre(d, o, x - 4, y0 + 1, z);
        d.spawn = { x: x + 0.5, y: y0 + 1, z: z + 0.5 };
        // puits d'échelle, dans un coin, jusqu'à la surface
        var sx = x + 4, sz = z + 4;
        for (var y = y0 + 1; y <= d.surface + 1; y++) o.pose(sx, y, sz, B.LADDER);
        o.pose(sx, d.surface + 2, sz, 0);
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (q) {
          o.pose(sx + q[0], d.surface + 1, sz + q[1], B.PLANKS);
        });
        d.entree = { x: sx, y: d.surface + 1, z: sz };
      },

      /* Pyramide : grès taillé en gradins, une chambre au cœur, un couloir
         d'entrée au ras du sable. */
      pyramide: function (d, o) {
        var x = d.x, z = d.z, R = 10;
        var y0 = d.surface;
        d.y = y0;
        o.fondation(x - R, z - R, x + R, z + R, y0, B.SANDSTONE);
        for (var n = 0; n <= R; n++) {
          var r = R - n;
          for (var dx = -r; dx <= r; dx++) for (var dz = -r; dz <= r; dz++) {
            var bord = Math.abs(dx) === r || Math.abs(dz) === r;
            o.pose(x + dx, y0 + 1 + n, z + dz, bord || n === 0 ? B.SANDSTONE_BRICK : B.SANDSTONE);
          }
        }
        // chambre intérieure
        o.coque(x - 5, y0 + 1, z - 5, x + 5, y0 + 7, z + 5, B.SANDSTONE_BRICK, 0);
        [[-4, -4], [4, -4], [-4, 4], [4, 4]].forEach(function (p) {
          o.pose(x + p[0], y0 + 2, z + p[1], B.GOLD_BLOCK);
          o.pose(x + p[0], y0 + 3, z + p[1], B.TORCH);
        });
        // couloir d'entrée, côté sud
        for (var i = 5; i <= R + 1; i++) for (var w = -1; w <= 1; w++) for (var hy = 2; hy <= 4; hy++) {
          o.pose(x + w, y0 + hy, z + i, 0);
        }
        salle(d, x - 4, y0 + 2, z - 4, x + 4, y0 + 6, z + 4);
        coffre(d, o, x, y0 + 2, z - 4);
        d.spawn = { x: x + 0.5, y: y0 + 2, z: z + 0.5 };
        d.entree = { x: x, y: y0 + 2, z: z + R + 1 };
      },

      /* Forteresse de glace : une enceinte de briques de glace, quatre tours
         d'angle et un donjon central qui abrite le yéti. */
      forteresse_glace: function (d, o) {
        var x = d.x, z = d.z, R = 9;
        var y0 = d.surface;
        d.y = y0;
        o.fondation(x - R - 1, z - R - 1, x + R + 1, z + R + 1, y0, B.PACKED_ICE);
        o.pave(x - R, y0, z - R, x + R, y0, z + R, B.PACKED_ICE);
        o.pave(x - R + 1, y0 + 1, z - R + 1, x + R - 1, y0 + 8, z + R - 1, 0);
        // enceinte crénelée
        for (var i = -R; i <= R; i++) for (var hy = 1; hy <= 5; hy++) {
          [[i, -R], [i, R], [-R, i], [R, i]].forEach(function (p) {
            o.pose(x + p[0], y0 + hy, z + p[1], hy === 5 && (i & 1) ? 0 : B.ICE_BRICK);
          });
        }
        // tours d'angle
        [[-R, -R], [R, -R], [-R, R], [R, R]].forEach(function (p) {
          o.coque(x + p[0] - 1, y0 + 1, z + p[1] - 1, x + p[0] + 1, y0 + 10, z + p[1] + 1, B.ICE_BRICK, 0);
          o.pose(x + p[0], y0 + 11, z + p[1], B.LANTERN);
        });
        // porte sud de l'enceinte
        for (var w = -1; w <= 1; w++) for (var hg = 1; hg <= 3; hg++) o.pose(x + w, y0 + hg, z + R, 0);
        // donjon central
        // le sol du donjon est celui de la cour : l'intérieur commence en y0 + 1
        o.coque(x - 5, y0, z - 5, x + 5, y0 + 9, z + 5, B.ICE_BRICK, 0);
        for (var w2 = -1; w2 <= 1; w2++) for (var hk = 1; hk <= 3; hk++) o.pose(x + w2, y0 + hk, z + 5, 0);
        [[-4, -4], [4, -4], [-4, 4], [4, 4]].forEach(function (p) { o.pose(x + p[0], y0 + 1, z + p[1], B.LANTERN); });
        salle(d, x - 4, y0 + 1, z - 4, x + 4, y0 + 8, z + 4);
        coffre(d, o, x, y0 + 1, z - 4);
        d.spawn = { x: x + 0.5, y: y0 + 1, z: z + 0.5 };
        d.entree = { x: x, y: y0 + 1, z: z + R };
      },

      /* Temple de la jungle : trois gradins de pierre moussue envahis de
         lianes, un sanctuaire à l'intérieur. */
      temple: function (d, o) {
        var x = d.x, z = d.z, R = 7;
        var y0 = d.surface;
        d.y = y0;
        o.fondation(x - R, z - R, x + R, z + R, y0, B.MOSSY_COBBLE);
        for (var n = 0; n < 3; n++) {
          var r = R - n * 2;
          o.coque(x - r, y0 + 1 + n * 3, z - r, x + r, y0 + 3 + n * 3, z + r, o.mousse, 0);
        }
        // sanctuaire : on creuse l'intérieur des gradins
        o.pave(x - 5, y0 + 1, z - 5, x + 5, y0 + 6, z + 5, 0);
        o.pave(x - 5, y0, z - 5, x + 5, y0, z + 5, B.STONE_BRICK);
        // lianes aux murs
        for (var i = -R; i <= R; i += 2) {
          [[i, -R - 1], [i, R + 1], [-R - 1, i], [R + 1, i]].forEach(function (p) {
            if (o.hash(x + p[0], y0, z + p[1]) < 0.6) {
              o.pose(x + p[0], y0 + 3, z + p[1], B.VINES); o.pose(x + p[0], y0 + 2, z + p[1], B.VINES);
            }
          });
        }
        [[-4, -4], [4, -4], [-4, 4], [4, 4]].forEach(function (p) { o.pose(x + p[0], y0 + 1, z + p[1], B.TORCH); });
        // entrée frontale
        for (var w = -1; w <= 1; w++) for (var hy = 1; hy <= 3; hy++) {
          o.pose(x + w, y0 + hy, z + R, 0); o.pose(x + w, y0 + hy, z + R - 1, 0);
        }
        salle(d, x - 5, y0 + 1, z - 5, x + 5, y0 + 5, z + 5);
        coffre(d, o, x, y0 + 1, z - 5);
        o.pose(x - 1, y0 + 1, z - 5, B.BOOKSHELF); o.pose(x + 1, y0 + 1, z - 5, B.BOOKSHELF);
        d.spawn = { x: x + 0.5, y: y0 + 1, z: z + 0.5 };
        d.entree = { x: x, y: y0 + 1, z: z + R };
      },

      /* Hutte de la sorcière : sur pilotis au-dessus du marais, une échelle
         pour y monter. La sorcière s'éveille dès qu'on approche. */
      hutte: function (d, o) {
        var x = d.x, z = d.z;
        var yp = Math.max(d.surface, SEA) + 4;          // plancher
        d.y = yp;
        [[-3, -3], [3, -3], [-3, 3], [3, 3]].forEach(function (p) {
          for (var y = hauteur(x + p[0], z + p[1]) + 1; y < yp; y++) o.pose(x + p[0], y, z + p[1], B.SPRUCE_LOG);
        });
        o.coque(x - 3, yp, z - 3, x + 3, yp + 4, z + 3, B.PLANKS, 0);
        o.pave(x - 4, yp + 5, z - 4, x + 4, yp + 5, z + 4, B.SPRUCE_LOG);
        // porte, fenêtres, échelle
        o.pose(x, yp + 1, z + 3, 0); o.pose(x, yp + 2, z + 3, 0);
        o.pose(x - 3, yp + 2, z, B.GLASS); o.pose(x + 3, yp + 2, z, B.GLASS);
        for (var y2 = hauteur(x, z + 4) + 1; y2 <= yp; y2++) o.pose(x, y2, z + 4, B.LADDER);
        o.pose(x - 2, yp + 1, z - 2, B.BOOKSHELF);
        o.pose(x + 2, yp + 1, z + 2, B.MUSHROOM);
        o.pose(x - 2, yp + 3, z + 2, B.LANTERN);
        // la zone d'éveil déborde largement de la hutte : on la voit venir
        salle(d, x - 9, yp - 8, z - 9, x + 9, yp + 6, z + 9);
        coffre(d, o, x + 2, yp + 1, z - 2);
        d.spawn = { x: x + 0.5, y: yp + 1, z: z + 0.5 };
        d.entree = { x: x, y: yp + 1, z: z + 4 };
      },

      /* Citadelle des cimes : une tour d'obsidienne et de brique au sommet
         d'une montagne ; la wyverne attend au-dessus de la plate-forme. */
      citadelle: function (d, o) {
        var x = d.x, z = d.z, R = 4, H = 14;
        var y0 = d.surface;
        d.y = y0;
        o.fondation(x - R - 1, z - R - 1, x + R + 1, z + R + 1, y0, B.STONE_BRICK);
        o.coque(x - R, y0, z - R, x + R, y0 + H, z + R, function (bx, by, bz) {
          return (Math.abs(bx - x) === R && Math.abs(bz - z) === R) ? B.OBSIDIAN : B.STONE_BRICK;
        }, 0);
        // plate-forme au sommet, créneaux et lanternes
        o.pave(x - R - 2, y0 + H, z - R - 2, x + R + 2, y0 + H, z + R + 2, B.STONE_BRICK);
        for (var i = -R - 2; i <= R + 2; i += 2) {
          [[i, -R - 2], [i, R + 2], [-R - 2, i], [R + 2, i]].forEach(function (p) {
            o.pose(x + p[0], y0 + H + 1, z + p[1], B.OBSIDIAN);
          });
        }
        [[-R, -R], [R, R]].forEach(function (p) { o.pose(x + p[0], y0 + H + 1, z + p[1], B.LANTERN); });
        // échelle intérieure jusqu'au toit, par une trappe ouverte
        for (var y = y0 + 1; y <= y0 + H; y++) o.pose(x + R - 1, y, z, B.LADDER);
        // porte au pied de la tour
        for (var w = 0; w <= 1; w++) for (var hy = 1; hy <= 2; hy++) o.pose(x - R, y0 + hy, z + w, 0);
        o.pose(x - 2, y0 + 1, z - 2, B.TORCH);
        salle(d, x - R - 2, y0 + H + 1, z - R - 2, x + R + 2, y0 + H + 9, z + R + 2);
        coffre(d, o, x - 2, y0 + H + 1, z + 2);
        d.spawn = { x: x + 0.5, y: y0 + H + 5, z: z + 0.5 };
        d.entree = { x: x - R, y: y0 + 1, z: z };
      },

      /* Monument sous-marin : un temple de prismarine au fond des abysses,
         rempli d'eau et éclairé de lanternes marines. */
      monument: function (d, o) {
        var x = d.x, z = d.z, R = 8;
        var y0 = d.surface;
        d.y = y0;
        var h = Math.max(4, Math.min(7, SEA - 2 - y0));
        o.pave(x - R, y0, z - R, x + R, y0, z + R, B.PRISMARINE);
        o.coque(x - R, y0 + 1, z - R, x + R, y0 + h, z + R, function (bx, by, bz) {
          return ((by + bx + bz) % 5 + 5) % 5 === 0 ? B.SEA_LANTERN : B.PRISMARINE_BRICK;
        }, B.WATER);
        // quatre ouvertures, quatre piliers
        [[0, R], [0, -R], [R, 0], [-R, 0]].forEach(function (p) {
          for (var a = -1; a <= 1; a++) for (var b = 1; b <= 3; b++) {
            o.pose(x + p[0] + (p[0] ? 0 : a), y0 + b, z + p[1] + (p[1] ? 0 : a), B.WATER);
          }
        });
        [[-4, -4], [4, -4], [-4, 4], [4, 4]].forEach(function (p) {
          for (var y = 1; y < h; y++) o.pose(x + p[0], y0 + y, z + p[1], B.PRISMARINE);
          o.pose(x + p[0], y0 + h - 1, z + p[1], B.SEA_LANTERN);
        });
        salle(d, x - R + 1, y0 + 1, z - R + 1, x + R - 1, y0 + h - 1, z + R - 1);
        coffre(d, o, x, y0 + 1, z);
        d.spawn = { x: x + 3.5, y: y0 + 2, z: z + 0.5 };
        d.entree = { x: x, y: y0 + 1, z: z + R };
      },

      /* Épave : une coque de navire échouée, pleine d'eau, et son mât. */
      epave: function (d, o) {
        var x = d.x, z = d.z, L = 6;
        var y0 = d.surface + 1;
        d.y = y0;
        for (var i = -L; i <= L; i++) {
          var larg = Math.abs(i) >= L - 1 ? 1 : 2;       // la proue et la poupe s'effilent
          for (var w = -larg; w <= larg; w++) {
            o.pose(x + i, y0, z + w, B.PLANKS);                        // quille
            var flanc = Math.abs(w) === larg || Math.abs(i) === L;
            o.pose(x + i, y0 + 1, z + w, flanc ? B.SPRUCE_LOG : B.WATER);
            o.pose(x + i, y0 + 2, z + w, flanc ? B.PLANKS : B.WATER);
            // pont percé : une planche sur trois manque
            if (y0 + 3 < SEA) o.pose(x + i, y0 + 3, z + w, o.hash(x + i, y0, z + w) < 0.35 ? B.WATER : B.PLANKS);
          }
        }
        // mât, sans jamais crever la surface
        for (var y = y0 + 4; y < Math.min(y0 + 10, SEA); y++) o.pose(x, y, z, B.SPRUCE_LOG);
        salle(d, x - L - 4, y0 - 1, z - 6, x + L + 4, y0 + 6, z + 6);
        coffre(d, o, x - 3, y0 + 1, z);
        // le capitaine attend sur le pont : la cale est trop basse pour lui
        d.spawn = { x: x + 2.5, y: y0 + 4, z: z + 1.5 };
        d.entree = { x: x, y: y0 + 3, z: z };
      },
    };

    /* Escalier de la crypte : on essaie les quatre directions et l'on garde la
       première qui remonte jusqu'à l'air libre sans passer sous l'eau. Sans
       issue possible, le donjon reste — il faudra creuser. */
    function escalierVersSurface(d, o, rx, rz, demi) {
      for (var di = 0; di < 4; di++) {
        var dir = DIRS[(di + Math.floor(N.hash2(rx, rz) * 4)) % 4];
        var plan = escalier(d, dir, demi);
        if (plan) { plan.forEach(function (b) { d.blocs.push(b); }); return; }
      }
    }
    function escalier(d, dir, demi) {
      var ux = dir[0], uz = dir[1];
      var px = -uz, pz = ux;              // perpendiculaire : largeur du couloir
      var out = [];
      // porte dans le mur
      for (var w = -1; w <= 1; w++) for (var hy = 1; hy <= 3; hy++) {
        out.push([d.x + ux * demi + px * w, d.y + hy, d.z + uz * demi + pz * w, 0]);
      }
      for (var i = 0; i < 64; i++) {
        var cx = d.x + ux * (demi + 1 + i), cz = d.z + uz * (demi + 1 + i);
        var marche = d.y + i;                         // une marche par bloc
        var surf = hauteur(cx, cz);
        if (surf <= SEA) return null;                 // sous l'eau : on renonce
        for (var w2 = -1; w2 <= 1; w2++) {
          var bx = cx + px * w2, bz = cz + pz * w2;
          out.push([bx, marche, bz, B.STONE_BRICK]);
          for (var a = 1; a <= 3; a++) out.push([bx, marche + a, bz, 0]);
        }
        if (marche >= surf) {
          // sortie : deux piliers en ruine et une torche, visibles de loin
          d.entree = { x: cx, y: marche + 1, z: cz };
          [-2, 2].forEach(function (w3) {
            var qx = cx + px * w3, qz = cz + pz * w3;
            for (var hh = 1; hh <= 3; hh++) out.push([qx, marche + hh, qz, B.MOSSY_COBBLE]);
            out.push([qx, marche + 4, qz, B.TORCH]);
          });
          return out;
        }
      }
      return null;
    }

    /* Les donjons dont le plan peut toucher le rectangle [x0,x1] × [z0,z1]. */
    function dansZone(x0, z0, x1, z1) {
      var res = [];
      var rx0 = Math.floor((x0 - PORTEE) / REGION), rx1 = Math.floor((x1 + PORTEE) / REGION);
      var rz0 = Math.floor((z0 - PORTEE) / REGION), rz1 = Math.floor((z1 + PORTEE) / REGION);
      for (var rx = rx0; rx <= rx1; rx++) for (var rz = rz0; rz <= rz1; rz++) {
        var d = deRegion(rx, rz);
        if (d) res.push(d);
      }
      return res;
    }

    /* Pose dans un chunk la part des donjons qui le concerne. */
    function appliquer(cx, cz, CX, CZ, put) {
      var x0 = cx * CX, z0 = cz * CZ, x1 = x0 + CX - 1, z1 = z0 + CZ - 1;
      var n = 0;
      dansZone(x0, z0, x1, z1).forEach(function (d) {
        for (var i = 0; i < d.blocs.length; i++) {
          var b = d.blocs[i];
          if (b[0] < x0 || b[0] > x1 || b[2] < z0 || b[2] > z1) continue;
          put(b[0], b[1], b[2], b[3]);
          n++;
        }
      });
      return n;
    }

    /* Le donjon dont la SALLE contient ce point (le couloir n'en fait pas partie). */
    function salleA(x, y, z) {
      var l = dansZone(x, z, x, z);
      for (var i = 0; i < l.length; i++) {
        var s = l[i].salle;
        // bornes semi-ouvertes : on reçoit aussi bien un bloc qu'une position
        if (x >= s.x0 && x < s.x1 + 1 && y >= s.y0 && y < s.y1 + 1 &&
            z >= s.z0 && z < s.z1 + 1) return l[i];
      }
      return null;
    }

    /* Le donjon dont ce bloc est le coffre, ou null. */
    function coffreA(x, y, z) {
      var l = dansZone(x, z, x, z);
      for (var i = 0; i < l.length; i++) {
        var c = l[i].coffre;
        if (c.x === x && c.y === y && c.z === z) return l[i];
      }
      return null;
    }

    /* Butin du coffre, tiré de la graine : le même donjon donne toujours le
       même contenu, en solo comme sur une autre machine. Chaque type de donjon
       ajoute ses richesses propres à une base commune. */
    var BUTIN_TYPE = {
      crypte:           [[I.EMERALD, 1, 3, 0.6], [I.ARC, 1, 1, 0.35], [I.IRON_SWORD, 1, 1, 0.25], [I.BONE, 2, 6, 0.8]],
      mine:             [[I.DIAMOND, 1, 2, 0.4], [B.RAIL, 4, 12, 0.8], [I.GOLD_INGOT, 1, 4, 0.5], [B.TORCH, 4, 10, 0.9]],
      pyramide:         [[I.GOLD_INGOT, 3, 8, 1], [I.EMERALD, 2, 5, 0.8], [I.DIAMOND, 1, 2, 0.35], [I.BONE, 2, 5, 0.7]],
      forteresse_glace: [[B.PACKED_ICE, 4, 12, 0.9], [I.DIAMOND, 1, 2, 0.45], [I.IRON_PICKAXE, 1, 1, 0.4]],
      temple:           [[I.EMERALD, 2, 6, 0.9], [I.ARBALETE, 1, 1, 0.3], [I.GOLDEN_APPLE, 1, 1, 0.35], [B.VINES, 2, 6, 0.6]],
      hutte:            [[I.BONE_MEAL, 3, 9, 0.9], [B.MUSHROOM, 2, 6, 0.8], [I.INK_SAC, 1, 4, 0.6], [I.GOLDEN_APPLE, 1, 1, 0.2]],
      citadelle:        [[I.DIAMOND, 2, 4, 0.8], [B.OBSIDIAN, 2, 6, 0.7], [I.GOLDEN_APPLE, 1, 2, 0.6], [I.FEATHER, 4, 10, 0.8]],
      monument:         [[I.PRISMARINE_SHARD, 6, 16, 1], [B.SPONGE, 1, 4, 0.8], [B.SEA_LANTERN, 2, 5, 0.7], [I.GOLD_INGOT, 2, 6, 0.7]],
      epave:            [[I.EMERALD, 2, 5, 0.9], [I.COOKED_FISH, 2, 6, 0.8], [I.GOLD_INGOT, 1, 3, 0.6], [I.ARBALETE, 1, 1, 0.2]],
    };
    function butin(d) {
      var s = 0;
      function r() { s++; return N.hash3(d.x * 7 + s, (d.y || 0) + s * 13, d.z * 11 - s); }
      function entre(a, b) { return a + Math.floor(r() * (b - a + 1)); }
      var l = [
        { id: I.BREAD, n: entre(2, 4) },
        { id: I.IRON_INGOT, n: entre(2, 5) },
        { id: I.COAL, n: entre(3, 8) },
        { id: I.FLECHE, n: entre(4, 12) },
      ];
      (BUTIN_TYPE[d.type] || []).forEach(function (t) {
        if (r() < t[3]) l.push({ id: t[0], n: entre(t[1], t[2]) });
      });
      return l;
    }

    return { deRegion: deRegion, dansZone: dansZone, appliquer: appliquer,
             salleA: salleA, coffreA: coffreA, butin: butin };
  }

  MC.Donjons = { creer: creer, typePour: typePour, TYPES: TYPES, REGION: REGION, BOSS: BOSS,
                 DEMI: DEMI, HAUT: HAUT, PORTEE: PORTEE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
