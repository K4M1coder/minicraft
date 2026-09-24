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
    // ruines d'une cité oubliée, enfouies sous n'importe quel biome (SPEC-SOUTERRAIN-003)
    cite_ancienne:    { nom: 'Cité ancienne', boss: ['boss_squelette'] },
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
    if (id === 'volcan') return null;             // la lave n'épargnerait rien
    if (id === 'glacier') return 'forteresse_glace';
    if (id === 'desert') return 'pyramide';
    if (id === 'taiga' || id === 'pics_glaces') return 'forteresse_glace';
    if (id === 'jungle') return 'temple';
    if (id === 'marais') return 'hutte';
    if (id === 'montagnes' && surf >= 44) return 'citadelle';
    if (id === 'badlands' || id === 'montagnes') return 'mine';
    // ruines d'une cité ancienne : enfouies sous n'importe quel biome ordinaire
    if (tirage < 0.12) return 'cite_ancienne';
    return tirage < 0.6 ? 'crypte' : 'mine';
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
        taille: tailleDe(rx, rz, type, surf), salles: [], niveaux: 1, gardes: [], coffres: [],
      };
      var o = outilsPour(d);
      BATISSEURS[type](d, o, rx, rz);
      // le petit donjon d'origine : une salle, et son coffre
      d.salles.push({ x0: d.salle.x0, y0: d.salle.y0, z0: d.salle.z0, x1: d.salle.x1, y1: d.salle.y1, z1: d.salle.z1, niveau: 0, vestibule: true });
      d.coffres.push(d.coffre);
      if (d.taille !== 'petit') complexe(d, o, rx, rz);
      return d;
    }

    /* ─── Tailles et complexes ────────────────────────────────────────────────
       Un donjon est petit (la salle d'origine et son accès), moyen (plusieurs
       salles sur un niveau) ou grand (plusieurs niveaux). Les grands sont
       rares et demandent de la profondeur sous eux. Le plan est tiré de la
       graine : des salles posées sur une grille, reliées par un arbre de
       couloirs, les niveaux joints par des escaliers ; le gardien descend dans
       la plus grande salle du niveau le plus profond. */
    function tailleDe(rx, rz, type, surf) {
      if (TYPES[type].marin || type === 'hutte') return 'petit';     // sous l'eau, sur pilotis : une seule pièce
      var r = N.hash2(rx * 613 + 11, rz * 227 - 5);
      var place = surf - 4;                                   // profondeur disponible sous la surface
      if (r < 0.14 && place >= 40) return 'grand';
      if (r < 0.46 && place >= 22) return 'moyen';
      return 'petit';
    }
    /* Identité de chaque type : matériaux, décor, lumière, gardes. */
    var THEMES = {
      crypte:           { mur: 'mousse', sol: B.STONE_BRICK, pilier: B.STONE_BRICK, deco: [B.COBWEB, B.BOOKSHELF], lumiere: B.TORCH, gardes: ['zombie', 'skeleton'] },
      mine:             { mur: B.PLANKS, sol: B.GRAVEL, pilier: B.LOG, deco: [B.RAIL, B.COBWEB, B.COAL_ORE], lumiere: B.LANTERN, gardes: ['spider', 'zombie'] },
      pyramide:         { mur: B.SANDSTONE_BRICK, sol: B.SANDSTONE, pilier: B.SANDSTONE_BRICK, deco: [B.GOLD_BLOCK, B.TERRACOTTA_YELLOW], lumiere: B.TORCH, gardes: ['mummy', 'skeleton'] },
      forteresse_glace: { mur: B.ICE_BRICK, sol: B.PACKED_ICE, pilier: B.BLUE_ICE, deco: [B.PACKED_ICE, B.SNOW], lumiere: B.LANTERN, gardes: ['skeleton', 'zombie'] },
      temple:           { mur: B.MOSSY_COBBLE, sol: B.MOSSY_COBBLE, pilier: B.JUNGLE_LOG, deco: [B.VINES, B.JUNGLE_LEAVES], lumiere: B.TORCH, gardes: ['spider', 'skeleton'] },
      hutte:            { mur: B.PLANKS, sol: B.PLANKS, pilier: B.LOG, deco: [B.MUSHROOM, B.COBWEB], lumiere: B.LANTERN, gardes: ['slime', 'zombie'] },
      citadelle:        { mur: B.STONE_BRICK, sol: B.OBSIDIAN, pilier: B.OBSIDIAN, deco: [B.GOLD_BLOCK, B.LANTERN], lumiere: B.LANTERN, gardes: ['skeleton', 'pillager'] },
      cite_ancienne:    { mur: 'mousse', sol: B.STONE_BRICK, pilier: B.STONE_BRICK, deco: [B.CRISTAL_LUMINEUX, B.MINERAI_ARGENT], lumiere: B.CRISTAL_LUMINEUX, gardes: ['golem_cristal', 'araignee_caverne'] },
    };
    var CELLULE = 15, ETAGE = 10;
    function complexe(d, o, rx, rz) {
      var th = THEMES[d.type] || THEMES.crypte;
      var s = 0;
      function r() { s++; return N.hash3(rx * 131 + s * 7, s * 17 - rz, rz * 97 + s); }
      function entre(a, b) { return a + Math.floor(r() * (b - a + 1)); }
      var grand = d.taille === 'grand';
      var niveaux = grand ? entre(2, 3) : 1;
      var total = grand ? entre(9, 14) : entre(4, 6);
      var mur = function (x, y, z) { return th.mur === 'mousse' ? o.mousse(x, y, z) : th.mur; };
      var descentes = [];                                      // où l'on descend d'un niveau à l'autre
      // le complexe s'enfouit sous le point le plus bas de son emprise : une
      // citadelle de sommet, une pyramide ou un temple y descendent par un puits
      var yHaut = d.y;
      for (var ai = -2; ai <= 2; ai++) for (var aj = -2; aj <= 2; aj++) {
        yHaut = Math.min(yHaut, hauteur(d.x + ai * CELLULE, d.z + aj * CELLULE) - 8);
      }
      if (yHaut < d.y) {
        for (var py = yHaut + 1; py <= d.y; py++) {
          o.pose(d.x, py, d.z, B.LADDER);
          o.pose(d.x, py, d.z + 1, 0); o.pose(d.x + 1, py, d.z, 0);  // de quoi tenir sur l'échelle
        }
      }
      // autant de niveaux que la profondeur en permet ; un seul, et le grand n'est plus que moyen
      niveaux = Math.max(1, Math.min(niveaux, Math.floor((yHaut - 4) / ETAGE) + 1));
      if (grand && niveaux < 2) { grand = false; d.taille = 'moyen'; total = Math.min(total, 6); }
      // cellules libres de la grille (5 × 5 autour du vestibule), par niveau
      var parNiveau = [];
      for (var n = 0; n < niveaux; n++) parNiveau.push(n === niveaux - 1 ? total - Math.floor(total / niveaux) * (niveaux - 1) : Math.floor(total / niveaux));
      d.profondeur = d.y - yHaut;
      for (var nv = 0; nv < niveaux; nv++) {
        var yN = yHaut - nv * ETAGE;
        if (yN < 4) { niveaux = nv; break; }
        var cellules = [];
        for (var ci = -2; ci <= 2; ci++) for (var cj = -2; cj <= 2; cj++) {
          if (nv === 0 && Math.abs(ci) <= 0 && Math.abs(cj) <= 0) continue;       // la place du vestibule
          cellules.push([ci, cj, r()]);
        }
        cellules.sort(function (a, b) { return a[2] - b[2]; });
        // au niveau inférieur, la première salle se tient sous la descente du niveau du dessus
        if (nv > 0) cellules.unshift([descentes[nv - 1].ci, descentes[nv - 1].cj, 0]);
        var salles = [];
        for (var k = 0; salles.length < parNiveau[nv] && k < cellules.length; k++) {
          var c = cellules[k];
          if (salles.some(function (sl) { return sl.ci === c[0] && sl.cj === c[1]; })) continue;
          var w = entre(5, 11), p = entre(5, 11), h = entre(5, 7);
          var cx = d.x + c[0] * CELLULE, cz = d.z + c[1] * CELLULE;
          var sl = { ci: c[0], cj: c[1], x0: cx - (w >> 1), z0: cz - (p >> 1), x1: cx + (w >> 1), z1: cz + (p >> 1),
                     y0: yN + 1, y1: yN + h - 1, niveau: nv, cx: cx, cz: cz, yN: yN };
          salles.push(sl);
          o.coque(sl.x0 - 1, yN, sl.z0 - 1, sl.x1 + 1, yN + h, sl.z1 + 1, mur, 0);
          for (var fx = sl.x0; fx <= sl.x1; fx++) for (var fz = sl.z0; fz <= sl.z1; fz++) o.pose(fx, yN, fz, th.sol);
          // piliers aux quatre coins intérieurs des grandes salles, une lumière à chacun
          if (w >= 8 && p >= 8) [[sl.x0 + 1, sl.z0 + 1], [sl.x1 - 1, sl.z0 + 1], [sl.x0 + 1, sl.z1 - 1], [sl.x1 - 1, sl.z1 - 1]].forEach(function (q) {
            for (var py = yN + 1; py < yN + h; py++) o.pose(q[0], py, q[1], th.pilier);
          });
          o.pose(cx, yN + 1, sl.z0, th.lumiere); o.pose(cx, yN + 1, sl.z1, th.lumiere);
          // décor propre au type, le long des murs
          for (var dk = 0; dk < 3; dk++) {
            var dx2 = entre(sl.x0, sl.x1), dz2 = r() < 0.5 ? sl.z0 : sl.z1;
            o.pose(dx2, yN + 1 + (th.deco[dk % th.deco.length] === B.COBWEB ? h - 3 : 0), dz2, th.deco[dk % th.deco.length]);
          }
        }
        // couloirs : un arbre couvrant (le plus proche d'abord) relie les salles du niveau
        var relie = [nv === 0 ? { cx: d.x, cz: d.z, yN: yHaut } : salles[0]];
        var reste = salles.slice(nv === 0 ? 0 : 1);
        while (reste.length) {
          var best = null, bi = -1, bj = -1;
          for (var i2 = 0; i2 < relie.length; i2++) for (var j2 = 0; j2 < reste.length; j2++) {
            var dd = Math.abs(relie[i2].cx - reste[j2].cx) + Math.abs(relie[i2].cz - reste[j2].cz);
            if (!best || dd < best) { best = dd; bi = i2; bj = j2; }
          }
          couloir(o, th, relie[bi].cx, relie[bi].cz, reste[bj].cx, reste[bj].cz, yN);
          relie.push(reste[bj]); reste.splice(bj, 1);
        }
        if (nv > 0) { var de = descentes[nv - 1]; escalierInterieur(o, th, de.cx, de.cz, de.yN, yN); }
        salles.forEach(function (sl2) { d.salles.push(sl2); });
        // la descente vers le niveau suivant : un escalier dans la dernière salle posée
        if (nv < niveaux - 1 && salles.length) {
          var bas = salles[salles.length - 1];
          descentes.push({ ci: bas.ci, cj: bas.cj, cx: bas.cx, cz: bas.cz, yN: yN });
        }
        d.niveaux = nv + 1;
      }
      // le gardien : dans la plus grande salle du niveau le plus profond
      var fond = d.salles.filter(function (sl3) { return sl3.niveau === d.niveaux - 1 && !sl3.vestibule; });
      if (!fond.length) return;
      fond.sort(function (a, b) { return (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0); });
      var boss = fond[0];
      boss.gardien = true;
      d.salle = { x0: boss.x0, y0: boss.y0, z0: boss.z0, x1: boss.x1, y1: boss.y1, z1: boss.z1 };
      d.spawn = { x: boss.cx + 0.5, y: boss.y0, z: boss.cz + 0.5 };
      // le trésor suit le gardien ; d'autres coffres dans quelques salles
      var tresor = { x: boss.cx, y: boss.y0, z: boss.z1 - 1 };
      o.pose(tresor.x, tresor.y, tresor.z, B.CHEST);
      d.coffre = tresor;
      d.coffres.push(tresor);
      d.salles.forEach(function (sl4, i4) {
        if (sl4.vestibule || sl4.gardien) return;
        // des gardes dans chaque salle ; dans un grand donjon, un sous-gardien par niveau
        var nG = grand ? 2 : 1;
        for (var g2 = 0; g2 < nG; g2++) {
          d.gardes.push({ salle: i4, type: th.gardes[(i4 + g2) % th.gardes.length],
                          x: sl4.cx + 0.5 + (g2 ? 2 : -2), y: sl4.y0, z: sl4.cz + 0.5 });
        }
        if (grand && i4 === d.salles.findIndex(function (q) { return q.niveau === sl4.niveau && !q.vestibule && !q.gardien; })) {
          d.gardes.push({ salle: i4, type: d.boss, sousGardien: true, x: sl4.cx + 0.5, y: sl4.y0, z: sl4.cz + 0.5 });
        }
        if (r() < (grand ? 0.45 : 0.3)) {
          var cf = { x: sl4.x0 + 1, y: sl4.y0, z: sl4.z1 - 1 };
          o.pose(cf.x, cf.y, cf.z, B.CHEST);
          d.coffres.push(cf);
        }
      });
    }
    // couloir en équerre de trois de large et trois de haut, au niveau yN
    function couloir(o, th, x0, z0, x1, z1, yN) {
      function tron(ax, az, bx, bz) {
        var sx = Math.sign(bx - ax), sz = Math.sign(bz - az), x = ax, z = az;
        for (var guard = 0; guard < 200; guard++) {
          for (var w = -1; w <= 1; w++) {
            var px = sx ? x : x + w, pz = sx ? z + w : z;
            o.pose(px, yN, pz, th.sol);
            for (var h = 1; h <= 3; h++) o.pose(px, yN + h, pz, 0);
          }
          if (x === bx && z === bz) break;
          if (x !== bx) x += sx; else if (z !== bz) z += sz;
        }
      }
      tron(x0, z0, x1, z0);
      tron(x1, z0, x1, z1);
    }
    // escalier droit qui descend d'un niveau, trois de large, dans une salle et au-delà
    function escalierInterieur(o, th, cx, cz, yHaut, yBas) {
      var n = yHaut - yBas;
      for (var i = 0; i <= n; i++) {
        var y = yHaut - i, x = cx - (n >> 1) + i;
        for (var w = -1; w <= 1; w++) {
          o.pose(x, y, cz + w, th.sol);
          for (var h = 1; h <= 4; h++) o.pose(x, y + h, cz + w, 0);
        }
      }
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

      /* Cité ancienne : des ruines de brique de pierre moussue, un décor de
         cristaux lumineux plutôt que de torches — la même forme que la
         crypte, un autre matériau et une autre lumière (SPEC-SOUTERRAIN-003). */
      cite_ancienne: function (d, o, rx, rz) {
        var x = d.x, z = d.z;
        var y0 = Math.max(4, Math.min(d.surface - PROFONDEUR, SEA - 6));
        d.y = y0;
        o.coque(x - DEMI, y0, z - DEMI, x + DEMI, y0 + HAUT, z + DEMI, o.mousse, 0);
        [[-3, -3], [3, -3], [-3, 3], [3, 3]].forEach(function (p) {
          for (var py = 1; py < HAUT; py++) o.pose(x + p[0], y0 + py, z + p[1], B.STONE_BRICK);
          o.pose(x + p[0] + (p[0] > 0 ? 1 : -1), y0 + 1, z + p[1], B.CRISTAL_LUMINEUX);
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

    /* Le donjon dont ce bloc est un coffre, et lequel : { donjon, indice }, ou null. */
    function coffreA(x, y, z) {
      var l = dansZone(x, z, x, z);
      for (var i = 0; i < l.length; i++) {
        var cs = l[i].coffres && l[i].coffres.length ? l[i].coffres : [l[i].coffre];
        for (var k = 0; k < cs.length; k++) {
          var c = cs[k];
          if (c && c.x === x && c.y === y && c.z === z) return { donjon: l[i], indice: k };
        }
      }
      return null;
    }
    /* La salle (de n'importe quel niveau) qui contient ce point : { donjon, index }. */
    function salleDe(x, y, z) {
      var l = dansZone(x, z, x, z);
      for (var i = 0; i < l.length; i++) {
        var ss = l[i].salles || [];
        for (var k = 0; k < ss.length; k++) {
          var s2 = ss[k];
          if (x >= s2.x0 && x < s2.x1 + 1 && y >= s2.y0 && y < s2.y1 + 1 && z >= s2.z0 && z < s2.z1 + 1) return { donjon: l[i], index: k };
        }
      }
      return null;
    }

    /* Butin du coffre, tiré de la graine : le même donjon donne toujours le
       même contenu, en solo comme sur une autre machine. Chaque type de donjon
       ajoute ses richesses propres à une base commune. */
    var BUTIN_TYPE = {
      crypte:           [[I.EMERALD, 1, 3, 0.6], [I.ARC, 1, 1, 0.35], [I.IRON_SWORD, 1, 1, 0.25], [I.BONE, 2, 6, 0.8], [I.ARGENT_LINGOT, 1, 3, 0.4]],
      mine:             [[I.DIAMOND, 1, 2, 0.4], [B.RAIL, 4, 12, 0.8], [I.GOLD_INGOT, 1, 4, 0.5], [B.TORCH, 4, 10, 0.9], [I.CUIVRE_LINGOT, 2, 5, 0.6], [I.ETAIN_LINGOT, 2, 5, 0.6]],
      pyramide:         [[I.GOLD_INGOT, 3, 8, 1], [I.EMERALD, 2, 5, 0.8], [I.DIAMOND, 1, 2, 0.35], [I.BONE, 2, 5, 0.7]],
      forteresse_glace: [[B.PACKED_ICE, 4, 12, 0.9], [I.DIAMOND, 1, 2, 0.45], [I.IRON_PICKAXE, 1, 1, 0.4]],
      temple:           [[I.EMERALD, 2, 6, 0.9], [I.ARBALETE, 1, 1, 0.3], [I.GOLDEN_APPLE, 1, 1, 0.35], [B.VINES, 2, 6, 0.6]],
      hutte:            [[I.BONE_MEAL, 3, 9, 0.9], [B.MUSHROOM, 2, 6, 0.8], [I.INK_SAC, 1, 4, 0.6], [I.GOLDEN_APPLE, 1, 1, 0.2]],
      citadelle:        [[I.DIAMOND, 2, 4, 0.8], [B.OBSIDIAN, 2, 6, 0.7], [I.GOLDEN_APPLE, 1, 2, 0.6], [I.FEATHER, 4, 10, 0.8]],
      monument:         [[I.PRISMARINE_SHARD, 6, 16, 1], [B.SPONGE, 1, 4, 0.8], [B.SEA_LANTERN, 2, 5, 0.7], [I.GOLD_INGOT, 2, 6, 0.7]],
      epave:            [[I.EMERALD, 2, 5, 0.9], [I.COOKED_FISH, 2, 6, 0.8], [I.GOLD_INGOT, 1, 3, 0.6], [I.ARBALETE, 1, 1, 0.2]],
      cite_ancienne:    [[I.LAPIS, 2, 6, 0.7], [I.QUARTZ, 2, 6, 0.7], [I.RUBIS, 1, 2, 0.3],
                         [I.SAPHIR, 1, 2, 0.3], [I.ARGENT_LINGOT, 2, 5, 0.6], [I.BIJOU, 1, 1, 0.15]],
    };
    var RICHESSE = { petit: 1, moyen: 1.6, grand: 2.6 };
    function butin(d, indice) {
      var s = (indice || 0) * 101;
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
      // un grand donjon récompense davantage ; le trésor du gardien plus que les autres coffres
      var k = RICHESSE[d.taille] || 1;
      if (k > 1) l.forEach(function (it) { it.n = Math.max(1, Math.round(it.n * k)); });
      if (d.taille === 'grand' && r() < 0.8) l.push({ id: I.DIAMOND, n: entre(1, 3) });
      return l;
    }

    return { deRegion: deRegion, dansZone: dansZone, appliquer: appliquer,
             salleA: salleA, salleDe: salleDe, coffreA: coffreA, butin: butin };
  }

  MC.Donjons = { creer: creer, typePour: typePour, TYPES: TYPES, REGION: REGION, BOSS: BOSS, TAILLES: ['petit', 'moyen', 'grand'],
                 DEMI: DEMI, HAUT: HAUT, PORTEE: PORTEE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
