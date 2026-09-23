/* habitats.js — habitations isolées, villages et villes, propres à leur biome.
   Logique pure. Comme les donjons, un lieu est entièrement déterminé par la
   graine et sa région : chaque chunk pose SA part sans connaître les autres,
   dans n'importe quel ordre.

   - trois échelles : la maison isolée, le village (3 × 3 parcelles), la ville
     (5 × 5 parcelles, rues pavées, bâtiments à étages) ;
   - un style par biome (colombages, isbas, grès, pilotis, adobes, igloos,
     maisons-champignons…) et une variante urbaine ;
   - des bâtiments qui servent : point info, banque, salon, magasin, artisans,
     marché, ferme, loisirs — chacun avec son habitant et son métier ;
   - des lampadaires tout le long des rues.

   Les blocs d'un lieu sont rangés PAR CHUNK dès sa construction : une ville
   compte des dizaines de milliers de blocs, et un chunk ne veut que les siens. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var B = C.B, I = C.I, SEA = C.SEA_LEVEL, CX = C.CHUNK_X, CZ = C.CHUNK_Z, WH = C.WORLD_H;

  // ─── styles ──────────────────────────────────────────────────────────────
  /* mur, coin (poteaux d'angle), sol, soubassement, toit, fenetre, route,
     place ; toit : pignon | raide | plat | dome | chapeau ; pilotis : hauteur. */
  var STYLES = {
    plaines:     { nom: 'Colombages', mur: B.PLANKS, coin: B.LOG, sol: B.PLANKS, soubassement: B.COBBLE,
                   toit: B.TUILES, forme: 'pignon', fenetre: B.GLASS, route: B.GRAVEL, place: B.STONE_BRICK },
    foret:       { nom: 'Chalets de bouleau', mur: B.PLANCHES_BOULEAU, coin: B.BIRCH_LOG, sol: B.PLANCHES_BOULEAU,
                   soubassement: B.COBBLE, toit: B.ARDOISE, forme: 'pignon', fenetre: B.GLASS, route: B.GRAVEL,
                   place: B.COBBLE },
    taiga:       { nom: 'Isbas', mur: B.PLANCHES_SAPIN, coin: B.SPRUCE_LOG, sol: B.PLANCHES_SAPIN,
                   soubassement: B.COBBLE, toit: B.PLANCHES_SAPIN, forme: 'raide', fenetre: B.GLASS,
                   route: B.GRAVEL, place: B.COBBLE },
    desert:      { nom: 'Maisons de grès', mur: B.SANDSTONE_BRICK, coin: B.SANDSTONE, sol: B.SANDSTONE,
                   soubassement: B.SANDSTONE, toit: B.SANDSTONE, forme: 'plat', fenetre: 0, route: B.SANDSTONE,
                   place: B.SANDSTONE_BRICK },
    savane:      { nom: "Cases d'acacia", mur: B.PLANCHES_ACACIA, coin: B.ACACIA_LOG, sol: B.PLANCHES_ACACIA,
                   soubassement: B.TERRACOTTA, toit: B.HAY, forme: 'pignon', fenetre: 0, route: B.GRAVEL,
                   place: B.TERRACOTTA },
    jungle:      { nom: 'Maisons sur pilotis', mur: B.PLANCHES_JUNGLE, coin: B.JUNGLE_LOG, sol: B.PLANCHES_JUNGLE,
                   soubassement: B.JUNGLE_LOG, toit: B.JUNGLE_LEAVES, forme: 'pignon', fenetre: 0, pilotis: 3,
                   route: B.PLANCHES_JUNGLE, place: B.MOSSY_COBBLE },
    marais:      { nom: 'Cabanes sur pilotis', mur: B.PLANKS, coin: B.LOG, sol: B.PLANKS, soubassement: B.LOG,
                   toit: B.PLANCHES_SAPIN, forme: 'pignon', fenetre: B.GLASS, pilotis: 2, route: B.PLANKS,
                   place: B.MOSSY_COBBLE },
    badlands:    { nom: 'Adobes', mur: B.TERRACOTTA, coin: B.TERRACOTTA_RED, sol: B.TERRACOTTA,
                   soubassement: B.TERRACOTTA_RED, toit: B.TERRACOTTA_YELLOW, forme: 'plat', fenetre: 0,
                   route: B.RED_SAND, place: B.TERRACOTTA_RED },
    montagnes:   { nom: 'Chalets de pierre', mur: B.STONE_BRICK, coin: B.SPRUCE_LOG, sol: B.PLANCHES_SAPIN,
                   soubassement: B.COBBLE, toit: B.ARDOISE, forme: 'raide', fenetre: B.GLASS, route: B.COBBLE,
                   place: B.STONE_BRICK },
    pics_glaces: { nom: 'Igloos', mur: B.ICE_BRICK, coin: B.PACKED_ICE, sol: B.PACKED_ICE, soubassement: B.PACKED_ICE,
                   toit: B.SNOW, forme: 'dome', fenetre: B.ICE, route: B.PACKED_ICE, place: B.ICE_BRICK },
    champignons: { nom: 'Maisons-champignons', mur: B.MUSHROOM_STEM, coin: B.MUSHROOM_STEM, sol: B.PLANKS,
                   soubassement: B.MUSHROOM_STEM, toit: B.MUSHROOM_CAP, forme: 'chapeau', fenetre: B.GLASS,
                   route: B.GRAVEL, place: B.MYCELIUM },
  };
  STYLES.glacier = STYLES.pics_glaces;
  // variante urbaine : pierre, brique et enduits, rues pavées
  var URBAIN = {
    plaines:  { nom: 'Ville de brique', mur: B.BRICK, coin: B.STONE_BRICK, toit: B.TUILES, route: B.PAVE, place: B.STONE_BRICK },
    foret:    { nom: 'Ville à pans de bois', mur: B.CHAUX, coin: B.BIRCH_LOG, toit: B.ARDOISE, route: B.PAVE, place: B.STONE_BRICK },
    taiga:    { nom: 'Ville de granit', mur: B.STONE_BRICK, coin: B.SPRUCE_LOG, toit: B.ARDOISE, route: B.PAVE, place: B.COBBLE },
    desert:   { nom: 'Médina blanche', mur: B.CHAUX, coin: B.SANDSTONE_BRICK, toit: B.SANDSTONE_BRICK, route: B.SANDSTONE_BRICK, place: B.SANDSTONE },
    savane:   { nom: 'Ville ocre', mur: B.TERRACOTTA, coin: B.ACACIA_LOG, toit: B.TUILES, route: B.PAVE, place: B.TERRACOTTA_RED },
    jungle:   { nom: 'Cité des canopées', mur: B.CHAUX, coin: B.JUNGLE_LOG, toit: B.JUNGLE_LEAVES, route: B.PAVE, place: B.MOSSY_COBBLE },
    badlands: { nom: 'Pueblo', mur: B.TERRACOTTA, coin: B.TERRACOTTA_RED, toit: B.TERRACOTTA_YELLOW, route: B.PAVE, place: B.TERRACOTTA_YELLOW },
  };
  function stylePour(biomeId, urbain) {
    var s = STYLES[biomeId] || STYLES.plaines;
    if (!urbain || !URBAIN[biomeId]) return s;
    var u = {}, k;
    for (k in s) u[k] = s[k];
    for (k in URBAIN[biomeId]) u[k] = URBAIN[biomeId][k];
    u.pilotis = 0;
    return u;
  }

  // ─── échelles de lieux ───────────────────────────────────────────────────
  var LIEUX = {
    ville:   { nom: 'Ville', region: 640, proba: 0.55, lots: 5, pas: 16, lot: 12, marge: 6,
               biomes: ['plaines', 'foret', 'desert', 'savane', 'taiga', 'jungle', 'badlands'], denivele: 10 },
    village: { nom: 'Village', region: 224, proba: 0.5, lots: 3, pas: 13, lot: 10, marge: 4,
               biomes: ['plaines', 'foret', 'desert', 'savane', 'taiga', 'jungle', 'marais', 'badlands',
                        'montagnes', 'champignons', 'pics_glaces'], denivele: 8 },
    maison:  { nom: 'Habitation isolée', region: 72, proba: 0.2, lots: 1, pas: 12, lot: 9, marge: 2,
               biomes: ['plaines', 'foret', 'desert', 'savane', 'taiga', 'jungle', 'marais', 'badlands',
                        'montagnes', 'champignons', 'pics_glaces', 'glacier'], denivele: 6 },
  };
  var ORDRE_LIEUX = ['ville', 'village', 'maison'];

  /* Bâtiments. `role` : l'habitant qu'on y trouve. */
  var BATIMENTS = {
    maison:     { nom: 'Maison', role: 'habitant' },
    point_info: { nom: 'Point info', role: 'guide' },
    banque:     { nom: 'Banque', role: 'banquier' },
    salon:      { nom: 'Salon', role: 'aubergiste' },
    magasin:    { nom: 'Magasin', role: 'marchand' },
    artisan:    { nom: 'Atelier', role: null },            // forgeron, menuisier ou tisserand
    marche:     { nom: 'Marché', role: 'marchand_ambulant' },
    ferme:      { nom: 'Ferme', role: 'fermier' },
    loisirs:    { nom: 'Loisirs', role: 'animateur' },
    place:      { nom: 'Place', role: null },
  };
  var ARTISANS = ['forgeron', 'menuisier', 'tisserand'];
  var LOISIRS = ['parc', 'fontaine', 'theatre'];

  /* Métiers : ce que l'habitant propose. `offres` suivent le format des
     échanges (give → get) ; `service` ouvre une action propre au métier. */
  function o(give, get) { return { give: give, get: get }; }
  function e(n) { return { id: I.EMERALD, n: n }; }
  var ROLES = {
    habitant:   { nom: 'Habitant', service: null, offres: [o([{ id: I.WHEAT, n: 6 }], e(1)), o([e(1)], { id: I.APPLE, n: 3 })],
                  repliques: ['Belle journée, n\'est-ce pas ?', 'Méfiez-vous des chemins la nuit.', 'Le point info vous dira où aller.'] },
    guide:      { nom: 'Guide', service: 'info', offres: [o([e(2)], { id: I.CARTE, n: 1 }), o([e(1)], { id: B.TORCH, n: 16 })],
                  repliques: ['Bienvenue ! Je peux vous indiquer les lieux alentour.', 'Voulez-vous que je marque les environs sur votre carte ?'] },
    banquier:   { nom: 'Banquier', service: 'banque',
                  offres: [o([{ id: I.GOLD_INGOT, n: 3 }], e(2)), o([e(3)], { id: I.GOLD_INGOT, n: 4 }), o([{ id: I.DIAMOND, n: 1 }], e(4))],
                  repliques: ['Votre compte est ouvert dans toutes nos agences.', 'Vos biens seront en sûreté dans nos coffres.'] },
    aubergiste: { nom: 'Aubergiste', service: 'repos',
                  offres: [o([e(1)], { id: I.BREAD, n: 3 }), o([e(1)], { id: I.MUSHROOM_STEW, n: 1 }), o([e(2)], { id: I.COOKED_PORK, n: 4 })],
                  repliques: ['Une chambre pour la nuit ? Une émeraude.', 'Asseyez-vous, la soupe est chaude.'] },
    marchand:   { nom: 'Marchand', service: null,
                  offres: [o([{ id: B.WOOL, n: 6 }], e(1)), o([e(1)], { id: B.GLASS, n: 8 }), o([e(2)], { id: B.CHEST, n: 2 }),
                           o([e(3)], { id: I.IRON_PICKAXE, n: 1 }), o([{ id: I.COAL, n: 12 }], e(1))],
                  repliques: ['Tout ce qu\'il faut pour bâtir et voyager !', 'Prix d\'ami, rien que pour vous.'] },
    marchand_ambulant: { nom: 'Marchand ambulant', service: null,
                  offres: [o([e(1)], { id: I.SEEDS, n: 12 }), o([e(1)], { id: I.MELON_SLICE, n: 8 }), o([{ id: I.RAW_FISH, n: 6 }], e(1)),
                           o([e(1)], { id: B.FLOWER_RED, n: 6 })],
                  repliques: ['Des produits frais, ce matin même !', 'Le marché ferme à la nuit tombée.'] },
    forgeron:   { nom: 'Forgeron', service: 'reparer',
                  offres: [o([{ id: I.IRON_INGOT, n: 4 }], e(1)), o([e(4)], { id: I.IRON_SWORD, n: 1 }), o([e(3)], { id: I.IRON_AXE, n: 1 }),
                           o([e(12)], { id: I.DIAMOND_PICKAXE, n: 1 })],
                  repliques: ['Une lame émoussée ? Je vous la répare.', 'Le fer se travaille à chaud.'] },
    menuisier:  { nom: 'Menuisier', service: null,
                  offres: [o([{ id: B.LOG, n: 8 }], e(1)), o([e(1)], { id: B.PLANCHES_SAPIN, n: 16 }), o([e(1)], { id: B.LADDER, n: 8 }),
                           o([e(2)], { id: B.BOOKSHELF, n: 2 }), o([e(2)], { id: B.TONNEAU, n: 2 })],
                  repliques: ['Du bois bien sec, rien de tel.', 'Il vous faut une étagère ?'] },
    tisserand:  { nom: 'Tisserand', service: null,
                  offres: [o([{ id: I.FICELLE, n: 8 }], e(1)), o([e(1)], { id: B.WOOL_RED, n: 4 }), o([e(1)], { id: B.WOOL_BLUE, n: 4 }),
                           o([e(1)], { id: B.WOOL_YELLOW, n: 4 }), o([e(1)], { id: B.WOOL_GREEN, n: 4 })],
                  repliques: ['Des couleurs pour égayer vos murs.', 'La laine d\'ici est la plus douce.'] },
    fermier:    { nom: 'Fermier', service: null,
                  offres: [o([{ id: I.WHEAT, n: 8 }], e(1)), o([e(1)], { id: I.BREAD, n: 4 }), o([e(1)], { id: B.HAY, n: 3 }),
                           o([{ id: I.RAW_CHICKEN, n: 4 }], e(1))],
                  repliques: ['La récolte s\'annonce bonne.', 'Un peu de pluie ne ferait pas de mal aux champs.'] },
    animateur:  { nom: 'Animateur', service: 'detente', offres: [o([e(1)], { id: I.GOLDEN_APPLE, n: 1 })],
                  repliques: ['Prenez le temps de souffler un peu !', 'Le spectacle commence bientôt.'] },
    ermite:     { nom: 'Ermite', service: 'info', offres: [o([{ id: I.BONE, n: 6 }], e(1)), o([e(2)], { id: I.GOLDEN_APPLE, n: 1 })],
                  repliques: ['Peu de visiteurs s\'aventurent jusqu\'ici.', 'Je connais chaque sentier de ces terres.'] },
  };

  // ─── noms ────────────────────────────────────────────────────────────────
  var DEBUTS = ['Val', 'Mont', 'Beau', 'Clair', 'Roche', 'Bois', 'Pierre', 'Font', 'Haut', 'Belle', 'Sainte-', 'Grand'];
  var FINS = ['ombre', 'fleur', 'ville', 'rive', 'mont', 'lac', 'val', 'bourg', 'pré', 'champ', 'brune', 'aigue'];
  var PRENOMS = ['Adèle', 'Bastien', 'Camille', 'Denis', 'Élise', 'Fabien', 'Gaëlle', 'Hugo', 'Inès', 'Jules', 'Katia',
                 'Léon', 'Maëlle', 'Nino', 'Odile', 'Paul', 'Rose', 'Simon', 'Tessa', 'Ulysse', 'Violette', 'Yanis'];
  function nomDe(h1, h2) {
    return DEBUTS[Math.floor(h1 * DEBUTS.length) % DEBUTS.length] + FINS[Math.floor(h2 * FINS.length) % FINS.length];
  }

  function creer(N, hauteur, biomeDe) {
    var caches = { ville: new Map(), village: new Map(), maison: new Map() };
    var PLAFONDS = { ville: 64, village: 512, maison: 4096 };

    function lieuDeRegion(kind, rx, rz) {
      var cache = caches[kind], k = rx + ',' + rz;
      if (cache.has(k)) return cache.get(k);
      var l = construire(kind, rx, rz);
      cache.set(k, l);
      /* Les plus anciens s'effacent (ils se reconstruiraient à l'identique).
         Le plafond suit la densité : avec une grande distance de vue, des
         centaines de régions de maisons sont consultées à chaque chunk. */
      if (cache.size > PLAFONDS[kind]) {
        var premier = cache.keys().next().value;
        cache.delete(premier);
      }
      return l;
    }

    var PORTEE = { ville: 50, village: 26, maison: 10 };
    // un lieu plus grand passe avant : un village ne s'installe pas dans une ville
    function occupePar(kind, x, z) {
      var rang = ORDRE_LIEUX.indexOf(kind);
      for (var i = 0; i < rang; i++) {
        var k2 = ORDRE_LIEUX[i], R = LIEUX[k2].region;
        var rx = Math.floor(x / R), rz = Math.floor(z / R);
        for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) {
          var l = lieuDeRegion(k2, rx + a, rz + b);
          if (l && Math.abs(l.x - x) < l.demi + PORTEE[kind] + 8 && Math.abs(l.z - z) < l.demi + PORTEE[kind] + 8) return true;
        }
      }
      return false;
    }

    function construire(kind, rx, rz) {
      var def = LIEUX[kind], R = def.region;
      var graineK = kind === 'ville' ? 7 : kind === 'village' ? 13 : 29;
      if (N.hash2(rx * 5381 + graineK, rz * 33391 - graineK) > def.proba) return null;
      var demi = Math.floor((def.lots * def.pas) / 2) + def.marge;
      var m = demi + 8;
      var x = rx * R + m + Math.floor(N.hash2(rx * 131 + graineK, rz * 977) * (R - 2 * m));
      var z = rz * R + m + Math.floor(N.hash2(rx * 419, rz * 263 + graineK) * (R - 2 * m));
      var bio = biomeDe ? biomeDe(x, z) : null;
      if (!bio || bio.marin || def.biomes.indexOf(bio.id) < 0) return null;
      // terrain : pas trop accidenté, au sec
      var hs = [];
      for (var i = -2; i <= 2; i++) for (var j = -2; j <= 2; j++) hs.push(hauteur(x + i * demi / 2, z + j * demi / 2));
      hs.sort(function (a, b) { return a - b; });
      var h0 = hs[Math.floor(hs.length / 2)];
      if (hs[hs.length - 1] - hs[0] > def.denivele * 2 || h0 <= SEA + 1 || h0 > WH - 40) return null;
      if (occupePar(kind, x, z)) return null;
      var urbain = kind === 'ville';
      var st = stylePour(bio.id, urbain);
      var l = {
        id: kind + ':' + rx + ',' + rz, kind: kind, nom: kind === 'maison' ? 'Maison de ' + PRENOMS[Math.floor(N.hash2(rx, rz * 7) * PRENOMS.length) % PRENOMS.length]
                                                        : nomDe(N.hash2(rx * 3, rz * 5 + graineK), N.hash2(rx * 11 + graineK, rz * 17)),
        biome: bio.id, style: st.nom, x: x, z: z, demi: demi, h0: h0,
        batiments: [], pnjs: [], lampes: 0,
        blocs: new Map(),                 // clé de chunk → [x, y, z, id, x, y, z, id, …]
        plateforme: { x0: x - demi, z0: z - demi, x1: x + demi, z1: z + demi, h0: h0,
                      surface: bio.surface || B.GRASS, sousSol: bio.sousSol || B.DIRT, routes: [] },
      };
      var outils = outilsPour(l, st);
      PLANS[kind](l, st, outils, rx, rz);
      return l;
    }

    // ─── outils de construction ─────────────────────────────────────────────
    function outilsPour(l, st) {
      function pose(x, y, z, id) {
        if (y <= 0 || y >= WH) return;
        var k = Math.floor(x / CX) + ',' + Math.floor(z / CZ);
        var a = l.blocs.get(k);
        if (!a) { a = []; l.blocs.set(k, a); }
        a.push(x, y, z, id);
        if (id && C.BLOCKS[id] && C.BLOCKS[id].light) l.lampes++;
      }
      /* Un repère local de bâtiment : u le long de la façade, v en profondeur,
         la porte en v = 0. `rot` tourne le bâtiment d'un quart de tour. */
      function repere(ox, oz, w, d, rot) {
        return function (u, v) {
          switch (rot & 3) {
            case 0: return [ox + u, oz + v];
            case 1: return [ox + d - 1 - v, oz + u];
            case 2: return [ox + w - 1 - u, oz + d - 1 - v];
            default: return [ox + v, oz + w - 1 - u];
          }
        };
      }
      return { pose: pose, repere: repere, hash: function (a, b, c) { return N.hash3(a, b || 0, c || 0); } };
    }

    /* Une maison générique : sol, murs avec poteaux d'angle, fenêtres, porte,
       étages (échelle), toit selon la forme du style. Renvoie le bâtiment. */
    function corps(l, st, o, p, w, d, y0, etages, type, nom, rot) {
      var H = 4, haut = y0 + etages * H;
      var fx = function (u, v) { return p(u, v)[0]; }, fz = function (u, v) { return p(u, v)[1]; };
      var pil = st.pilotis || 0;
      if (pil) {
        // pilotis : quatre poteaux, une échelle d'accès, le plancher surélevé
        [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1]].forEach(function (c) {
          for (var y = y0; y < y0 + pil; y++) o.pose(fx(c[0], c[1]), y, fz(c[0], c[1]), st.soubassement);
        });
        for (var ye = y0; ye < y0 + pil; ye++) o.pose(fx(Math.floor(w / 2), -1), ye, fz(Math.floor(w / 2), -1), B.LADDER);
        y0 += pil; haut += pil;
      }
      for (var u = 0; u < w; u++) for (var v = 0; v < d; v++) {
        var x = fx(u, v), z = fz(u, v);
        o.pose(x, y0 - 1, z, u === 0 || v === 0 || u === w - 1 || v === d - 1 ? st.soubassement : st.sol);
        for (var y = y0; y < haut; y++) {
          var bord = u === 0 || v === 0 || u === w - 1 || v === d - 1;
          var coin = (u === 0 || u === w - 1) && (v === 0 || v === d - 1);
          var plancher = (y - y0) % H === H - 1 && y < haut - 1;           // plancher d'étage
          var id = 0;
          if (coin) id = st.coin;
          else if (bord) {
            var ye2 = (y - y0) % H;
            var fenetre = ye2 === 1 && ((u + v) % 3 === 1);
            id = fenetre ? (st.fenetre || 0) : st.mur;
            if (plancher) id = st.coin;
          } else if (plancher) id = st.sol;
          o.pose(x, y, z, id);
        }
      }
      // porte : fermée, orientée vers l'extérieur (la rue) — SPEC-PORTE-001
      var pu = Math.floor(w / 2);
      var idPorteBat = C.PORTE_FERMEE_LIST[(rot || 0) & 3];
      o.pose(fx(pu, 0), y0, fz(pu, 0), idPorteBat); o.pose(fx(pu, 0), y0 + 1, fz(pu, 0), idPorteBat);
      // échelle entre étages, contre le mur du fond
      if (etages > 1) for (var ye3 = y0; ye3 < haut - 1; ye3++) o.pose(fx(1, d - 2), ye3, fz(1, d - 2), B.LADDER);
      // lumière à chaque étage
      for (var et = 0; et < etages; et++) {
        o.pose(fx(w - 2, d - 2), y0 + et * H, fz(w - 2, d - 2), B.PLANKS);
        o.pose(fx(w - 2, d - 2), y0 + et * H + 1, fz(w - 2, d - 2), B.LANTERN);
      }
      toit(st, o, p, w, d, haut);
      var c0 = p(0, 0), c1 = p(w - 1, d - 1);
      var bat = { type: type, nom: nom || BATIMENTS[type].nom, lieu: l.id,
                  x0: Math.min(c0[0], c1[0]), z0: Math.min(c0[1], c1[1]), x1: Math.max(c0[0], c1[0]), z1: Math.max(c0[1], c1[1]),
                  y0: y0, y1: haut + Math.ceil(d / 2) + 1, porte: { x: fx(pu, 0), z: fz(pu, 0) },
                  dedans: { x: fx(pu, 2) + 0.5, y: y0, z: fz(pu, 2) + 0.5 } };
      l.batiments.push(bat);
      return bat;
    }

    function toit(st, o, p, w, d, y) {
      var fx = function (u, v) { return p(u, v)[0]; }, fz = function (u, v) { return p(u, v)[1]; };
      var forme = st.forme;
      if (forme === 'plat') {
        for (var u = 0; u < w; u++) for (var v = 0; v < d; v++) {
          o.pose(fx(u, v), y, fz(u, v), st.toit);
          if (u === 0 || v === 0 || u === w - 1 || v === d - 1) o.pose(fx(u, v), y + 1, fz(u, v), st.mur);
        }
        return;
      }
      if (forme === 'dome' || forme === 'chapeau') {
        var cu = (w - 1) / 2, cv = (d - 1) / 2, R = Math.max(w, d) / 2 + (forme === 'chapeau' ? 1.5 : 0.5);
        for (var u2 = -2; u2 < w + 2; u2++) for (var v2 = -2; v2 < d + 2; v2++) {
          var r = Math.hypot(u2 - cu, v2 - cv);
          if (r > R) continue;
          var hh = forme === 'chapeau' ? Math.round((1 - r / R) * 3) : Math.round(Math.sqrt(Math.max(0, R * R - r * r)) * 0.7);
          var x = fx(u2, v2), z = fz(u2, v2);
          o.pose(x, y + hh, z, st.toit);
          if (forme === 'chapeau' && r > R - 1.5) o.pose(x, y + hh - 1, z, st.toit);
        }
        return;
      }
      // pignon (raide : deux rangs par marche) : pans le long de w, pignons pleins
      var pasY = forme === 'raide' ? 2 : 1, moitie = Math.ceil(d / 2);
      for (var k = 0; k <= moitie; k++) {
        for (var s = 0; s < pasY; s++) {
          var yy = y + k * pasY + s;
          for (var u3 = -1; u3 <= w; u3++) {
            [k - 1, d - k].forEach(function (vv) {
              if (vv < -1 || vv > d) return;
              o.pose(fx(u3, vv), yy, fz(u3, vv), st.toit);
            });
          }
          // pignons : le mur remonte sous le toit
          for (var v3 = k; v3 < d - k; v3++) {
            o.pose(fx(0, v3), yy, fz(0, v3), st.mur);
            o.pose(fx(w - 1, v3), yy, fz(w - 1, v3), st.mur);
          }
        }
      }
    }

    function pnj(l, role, x, y, z, bat) {
      var h = N.hash3(Math.floor(x), y, Math.floor(z));
      l.pnjs.push({ id: l.id + '#' + l.pnjs.length, role: role, nom: PRENOMS[Math.floor(h * PRENOMS.length) % PRENOMS.length],
                    x: x, y: y, z: z, batiment: bat ? bat.type : null, lieu: l.id });
    }

    // lampadaire : un poteau de deux blocs, une lanterne au sommet
    function lampadaire(l, st, o, x, y, z) {
      o.pose(x, y, z, st.coin); o.pose(x, y + 1, z, st.coin); o.pose(x, y + 2, z, B.LANTERN);
    }

    // ─── bâtiments ───────────────────────────────────────────────────────────
    /* Chaque bâtisseur reçoit l'origine de sa parcelle (ox, oz), sa taille
       (L × L), l'orientation de sa façade vers la rue, et le niveau du sol. */
    var BATISSEURS = {
      maison: function (l, st, o, ox, oz, L, rot, y0, urbain) {
        var w = 7 + Math.floor(o.hash(ox, 1, oz) * 3), d = 6 + Math.floor(o.hash(ox, 2, oz) * 2);
        var etages = urbain ? 1 + Math.floor(o.hash(ox, 3, oz) * 3) : 1;
        var p = o.repere(ox + Math.floor((L - w) / 2), oz + 1, w, d, rot);
        var b = corps(l, st, o, p, w, d, y0, etages, 'maison', rot);
        // un lit (laine), une table, un coffre
        var q = function (u, v) { return p(u, v); };
        var c = q(w - 2, 1); o.pose(c[0], b.y0, c[1], B.WOOL_RED);
        var t = q(1, 1); o.pose(t[0], b.y0, t[1], B.CRAFTING_TABLE);
        var ch = q(2, d - 2); o.pose(ch[0], b.y0, ch[1], B.CHEST);
        pnj(l, 'habitant', b.dedans.x, b.y0, b.dedans.z, b);
      },
      point_info: function (l, st, o, ox, oz, L, rot, y0) {
        var w = 7, d = 7, p = o.repere(ox + Math.floor((L - w) / 2), oz + 1, w, d, rot);
        var b = corps(l, st, o, p, w, d, y0, 1, 'point_info', rot);
        var a = p(1, 1), c = p(w - 2, 1);
        o.pose(a[0], b.y0, a[1], B.PANNEAU_INFO); o.pose(c[0], b.y0, c[1], B.PANNEAU_INFO);
        var f = p(Math.floor(w / 2) - 2, -1), g2 = p(Math.floor(w / 2) + 2, -1);
        lampadaire(l, st, o, f[0], b.y0, f[1]); lampadaire(l, st, o, g2[0], b.y0, g2[1]);
        pnj(l, 'guide', b.dedans.x, b.y0, b.dedans.z, b);
      },
      banque: function (l, st, o, ox, oz, L, rot, y0) {
        var w = 11, d = 9, sb = {}, k;
        for (k in st) sb[k] = st[k];
        sb.mur = B.STONE_BRICK; sb.coin = B.STONE_BRICK; sb.sol = B.STONE_BRICK; sb.forme = 'plat'; sb.toit = B.STONE_BRICK;
        var p = o.repere(ox + Math.floor((L - w) / 2), oz, w, d, rot);
        var b = corps(l, sb, o, p, w, d, y0, 2, 'banque', rot);
        for (var u = 2; u < w - 2; u++) { var cp = p(u, 3); o.pose(cp[0], b.y0, cp[1], B.COMPTOIR); }
        o.pose(p(Math.floor(w / 2), 3)[0], b.y0, p(Math.floor(w / 2), 3)[1], 0);
        [[2, d - 2], [4, d - 2], [6, d - 2], [8, d - 2]].forEach(function (c) {
          var q = p(c[0], c[1]); o.pose(q[0], b.y0, q[1], B.COFFRE_FORT);
        });
        var or = p(w - 2, d - 2); o.pose(or[0], b.y0, or[1], B.GOLD_BLOCK);
        var f = p(1, -1), g2 = p(w - 2, -1);
        lampadaire(l, st, o, f[0], b.y0, f[1]); lampadaire(l, st, o, g2[0], b.y0, g2[1]);
        var ban = p(Math.floor(w / 2), 5);
        pnj(l, 'banquier', ban[0] + 0.5, b.y0, ban[1] + 0.5, b);
      },
      salon: function (l, st, o, ox, oz, L, rot, y0) {
        var w = Math.min(11, L), d = Math.min(9, L - 1), p = o.repere(ox + Math.floor((L - w) / 2), oz, w, d, rot);
        var b = corps(l, st, o, p, w, d, y0, 1, 'salon', rot);
        for (var u = 1; u < w - 1; u++) { var cp = p(u, d - 3); o.pose(cp[0], b.y0, cp[1], B.COMPTOIR); }
        [[1, d - 2], [2, d - 2], [3, d - 2]].forEach(function (c) { var q = p(c[0], c[1]); o.pose(q[0], b.y0, q[1], B.TONNEAU); o.pose(q[0], b.y0 + 1, q[1], B.TONNEAU); });
        // tables et leurs lanternes
        [[2, 2], [w - 3, 2], [2, 4], [w - 3, 4]].forEach(function (c) {
          var q = p(c[0], c[1]); o.pose(q[0], b.y0, q[1], B.PLANKS); o.pose(q[0], b.y0 + 1, q[1], B.LANTERN);
        });
        var ab = p(Math.floor(w / 2), d - 2);
        pnj(l, 'aubergiste', ab[0] + 0.5, b.y0, ab[1] + 0.5, b);
      },
      magasin: function (l, st, o, ox, oz, L, rot, y0) {
        var w = 9, d = 7, p = o.repere(ox + Math.floor((L - w) / 2), oz + 1, w, d, rot);
        var b = corps(l, st, o, p, w, d, y0, 1, 'magasin', rot);
        for (var u = 1; u < w - 1; u++) { var cp = p(u, 3); o.pose(cp[0], b.y0, cp[1], B.COMPTOIR); }
        o.pose(p(Math.floor(w / 2), 3)[0], b.y0, p(Math.floor(w / 2), 3)[1], 0);
        [[1, d - 2], [3, d - 2], [5, d - 2], [7, d - 2]].forEach(function (c) { var q = p(c[0], c[1]); o.pose(q[0], b.y0, q[1], B.CHEST); });
        var f = p(1, -1); lampadaire(l, st, o, f[0], b.y0, f[1]);
        var m = p(Math.floor(w / 2), 5);
        pnj(l, 'marchand', m[0] + 0.5, b.y0, m[1] + 0.5, b);
      },
      artisan: function (l, st, o, ox, oz, L, rot, y0, urbain, sous) {
        var w = 9, d = 7, p = o.repere(ox + Math.floor((L - w) / 2), oz + 1, w, d, rot);
        var noms = { forgeron: 'Forge', menuisier: 'Menuiserie', tisserand: 'Atelier du tisserand' };
        var b = corps(l, st, o, p, w, d, y0, 1, 'artisan', noms[sous], rot);
        b.metier = sous;
        var outilsAtelier = sous === 'forgeron' ? [B.ENCLUME, B.FURNACE, B.FURNACE, B.COBBLE]
                          : sous === 'menuisier' ? [B.CRAFTING_TABLE, B.PLANKS, B.TONNEAU, B.BOOKSHELF]
                          : [B.WOOL_RED, B.WOOL_BLUE, B.WOOL_YELLOW, B.WOOL_GREEN];
        outilsAtelier.forEach(function (id, i) { var q = p(1 + i * 2, d - 2); o.pose(q[0], b.y0, q[1], id); });
        pnj(l, sous, b.dedans.x, b.y0, b.dedans.z, b);
      },
      marche: function (l, st, o, ox, oz, L, rot, y0) {
        // quatre étals sous des toiles de couleur, autour d'une allée
        var toiles = [B.WOOL_RED, B.WOOL_YELLOW, B.WOOL_BLUE, B.WOOL_GREEN];
        var p = o.repere(ox, oz, L, L, rot);
        [[1, 1], [L - 5, 1], [1, L - 5], [L - 5, L - 5]].forEach(function (c, i) {
          for (var u = 0; u < 4; u++) for (var v = 0; v < 4; v++) {
            var q = p(c[0] + u, c[1] + v);
            if ((u === 0 || u === 3) && (v === 0 || v === 3)) for (var y = y0; y < y0 + 3; y++) o.pose(q[0], y, q[1], st.coin);
            o.pose(q[0], y0 + 3, q[1], toiles[i]);
            if (v === 1 && u > 0 && u < 3) o.pose(q[0], y0, q[1], B.COMPTOIR);
          }
          var lan = p(c[0] + 1, c[1] + 3); o.pose(lan[0], y0, lan[1], B.LANTERN);
        });
        var c0 = p(0, 0), c1 = p(L - 1, L - 1);
        var bat = { type: 'marche', nom: 'Marché', lieu: l.id, x0: Math.min(c0[0], c1[0]), z0: Math.min(c0[1], c1[1]),
                    x1: Math.max(c0[0], c1[0]), z1: Math.max(c0[1], c1[1]), y0: y0, y1: y0 + 4,
                    porte: { x: p(Math.floor(L / 2), 0)[0], z: p(Math.floor(L / 2), 0)[1] } };
        l.batiments.push(bat);
        var m1 = p(2, 3), m2 = p(L - 3, L - 4);
        pnj(l, 'marchand_ambulant', m1[0] + 0.5, y0, m1[1] + 0.5, bat);
        pnj(l, 'marchand_ambulant', m2[0] + 0.5, y0, m2[1] + 0.5, bat);
      },
      ferme: function (l, st, o, ox, oz, L, rot, y0) {
        // un champ de blé irrigué par une rigole, et une grange de foin
        var p = o.repere(ox, oz, L, L, rot);
        for (var u = 0; u < L; u++) for (var v = 0; v < L - 4; v++) {
          var q = p(u, v + 4);
          if (u === Math.floor(L / 2)) { o.pose(q[0], y0 - 1, q[1], B.WATER); continue; }
          o.pose(q[0], y0 - 1, q[1], B.FARMLAND);
          o.pose(q[0], y0, q[1], (u + v) % 3 === 0 ? B.WHEAT2 : B.WHEAT3);
        }
        for (var gu = 0; gu < 5; gu++) for (var gv = 0; gv < 3; gv++) for (var y = y0; y < y0 + 3; y++) {
          var r = p(gu, gv);
          var bord = gu === 0 || gu === 4 || gv === 0 || gv === 2 || y === y0 + 2;
          o.pose(r[0], y, r[1], bord ? (y === y0 + 2 ? B.HAY : st.mur) : (y === y0 ? B.HAY : 0));
        }
        var porte = p(2, 0), idPorteFerme = C.PORTE_FERMEE_LIST[(rot || 0) & 3];
        o.pose(porte[0], y0, porte[1], idPorteFerme); o.pose(porte[0], y0 + 1, porte[1], idPorteFerme);
        var lan = p(6, 1); o.pose(lan[0], y0, lan[1], B.LANTERN);
        var c0 = p(0, 0), c1 = p(L - 1, L - 1);
        var bat = { type: 'ferme', nom: 'Ferme', lieu: l.id, x0: Math.min(c0[0], c1[0]), z0: Math.min(c0[1], c1[1]),
                    x1: Math.max(c0[0], c1[0]), z1: Math.max(c0[1], c1[1]), y0: y0, y1: y0 + 3,
                    porte: { x: porte[0], z: porte[1] } };
        l.batiments.push(bat);
        var f = p(7, 2);
        pnj(l, 'fermier', f[0] + 0.5, y0, f[1] + 0.5, bat);
      },
      loisirs: function (l, st, o, ox, oz, L, rot, y0, urbain, sous) {
        var p = o.repere(ox, oz, L, L, rot), cx = Math.floor(L / 2);
        var noms = { parc: 'Parc', fontaine: 'Fontaine', theatre: 'Théâtre' };
        if (sous === 'fontaine' || sous === 'parc') {
          for (var u = 0; u < L; u++) for (var v = 0; v < L; v++) {
            var q = p(u, v), r = Math.hypot(u - cx, v - cx);
            if (sous === 'fontaine' && r < 3.5) {
              o.pose(q[0], y0 - 1, q[1], r < 2.5 ? B.WATER : st.place);
              if (r >= 2.5) o.pose(q[0], y0, q[1], st.place);
            } else if (sous === 'parc') {
              var h = o.hash(q[0], y0, q[1]);
              o.pose(q[0], y0 - 1, q[1], B.GRASS);
              if (h < 0.08) o.pose(q[0], y0, q[1], B.FLOWER_RED);
              else if (h < 0.16) o.pose(q[0], y0, q[1], B.FLOWER_YELLOW);
              else if (h < 0.19) { for (var t = 0; t < 3; t++) o.pose(q[0], y0 + t, q[1], B.LOG); o.pose(q[0], y0 + 3, q[1], B.LEAVES); }
            }
          }
          if (sous === 'fontaine') for (var y = y0; y < y0 + 3; y++) o.pose(p(cx, cx)[0], y, p(cx, cx)[1], st.place);
          if (sous === 'fontaine') o.pose(p(cx, cx)[0], y0 + 3, p(cx, cx)[1], B.WATER);
          [[1, 1], [L - 2, 1], [1, L - 2], [L - 2, L - 2]].forEach(function (c) { var q2 = p(c[0], c[1]); lampadaire(l, st, o, q2[0], y0, q2[1]); });
        } else {
          // théâtre : une scène de planches, des gradins face à elle
          for (var u2 = 1; u2 < L - 1; u2++) for (var v2 = L - 5; v2 < L - 1; v2++) {
            var s = p(u2, v2); o.pose(s[0], y0, s[1], B.PLANKS);
          }
          for (var g2 = 0; g2 < 3; g2++) for (var u3 = 1; u3 < L - 1; u3++) {
            var gq = p(u3, 1 + g2);
            for (var yy = y0; yy <= y0 + g2; yy++) o.pose(gq[0], yy, gq[1], st.soubassement);
          }
          [[1, L - 1], [L - 2, L - 1]].forEach(function (c) { var q3 = p(c[0], c[1]); lampadaire(l, st, o, q3[0], y0 + 1, q3[1]); });
        }
        var c0 = p(0, 0), c1 = p(L - 1, L - 1);
        var bat = { type: 'loisirs', nom: noms[sous], metier: sous, lieu: l.id, x0: Math.min(c0[0], c1[0]), z0: Math.min(c0[1], c1[1]),
                    x1: Math.max(c0[0], c1[0]), z1: Math.max(c0[1], c1[1]), y0: y0, y1: y0 + 5,
                    porte: { x: p(cx, 0)[0], z: p(cx, 0)[1] } };
        l.batiments.push(bat);
        var a = p(cx + 2, cx - 2);
        pnj(l, 'animateur', a[0] + 0.5, sous === 'theatre' ? y0 + 1 : y0, a[1] + 0.5, bat);
      },
      // la place centrale : dallée, un puits, des lampadaires aux quatre coins
      place: function (l, st, o, ox, oz, L, rot, y0) {
        var p = o.repere(ox, oz, L, L, rot), cx = Math.floor(L / 2);
        for (var u = 0; u < L; u++) for (var v = 0; v < L; v++) { var q = p(u, v); o.pose(q[0], y0 - 1, q[1], st.place); }
        for (var du = -1; du <= 1; du++) for (var dv = -1; dv <= 1; dv++) {
          var w2 = p(cx + du, cx + dv);
          if (du === 0 && dv === 0) { for (var yw = y0 - 4; yw < y0; yw++) o.pose(w2[0], yw, w2[1], B.WATER); continue; }
          o.pose(w2[0], y0, w2[1], st.coin);
          o.pose(w2[0], y0 + 3, w2[1], st.toit);
        }
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) {
          var q2 = p(cx + c[0], cx + c[1]); o.pose(q2[0], y0 + 1, q2[1], st.coin); o.pose(q2[0], y0 + 2, q2[1], st.coin);
        });
        var lp = p(cx, cx - 1); o.pose(lp[0], y0 + 2, lp[1], B.LANTERN);
        [[0, 0], [L - 1, 0], [0, L - 1], [L - 1, L - 1]].forEach(function (c) { var q3 = p(c[0], c[1]); lampadaire(l, st, o, q3[0], y0, q3[1]); });
        var c0 = p(0, 0), c1 = p(L - 1, L - 1);
        l.batiments.push({ type: 'place', nom: 'Place de ' + l.nom, lieu: l.id, x0: Math.min(c0[0], c1[0]), z0: Math.min(c0[1], c1[1]),
                           x1: Math.max(c0[0], c1[0]), z1: Math.max(c0[1], c1[1]), y0: y0, y1: y0 + 4,
                           porte: { x: p(cx, 0)[0], z: p(cx, 0)[1] } });
      },
    };

    // ─── plans ───────────────────────────────────────────────────────────────
    function melanger(liste, graine) {
      var l = liste.slice();
      for (var i = l.length - 1; i > 0; i--) {
        var j = Math.floor(N.hash2(graine * 31 + i, i * 17) * (i + 1));
        var t = l[i]; l[i] = l[j]; l[j] = t;
      }
      return l;
    }
    /* Grille de parcelles séparées par des rues : la parcelle centrale est la
       place ; les autres reçoivent leur programme, les plus demandés au plus
       près du centre. Chaque façade regarde vers la rue qui mène au centre. */
    function grille(l, st, o, def, programme, urbain) {
      var n = def.lots, pas = def.pas, L = def.lot, rue = pas - L;
      var x0 = l.x - Math.floor(n * pas / 2), z0 = l.z - Math.floor(n * pas / 2);
      var y0 = l.h0 + 1, milieu = Math.floor(n / 2);
      var pl = l.plateforme;
      pl.rues = { x0: x0, z0: z0, pas: pas, lot: L, n: n, route: st.route };
      // parcelles, de la plus centrale à la plus excentrée
      var lots = [];
      for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
        if (i === milieu && j === milieu) continue;
        lots.push({ i: i, j: j, d: Math.max(Math.abs(i - milieu), Math.abs(j - milieu)) + (Math.abs(i - milieu) + Math.abs(j - milieu)) * 0.01 });
      }
      lots.sort(function (a, b) { return a.d - b.d; });
      BATISSEURS.place(l, st, o, x0 + milieu * pas + rue, z0 + milieu * pas + rue, L, 0, y0);
      lots.forEach(function (lot, k) {
        var prog = programme[k] || ['maison'];
        var ox = x0 + lot.i * pas + rue, oz = z0 + lot.j * pas + rue;
        // façade vers le centre : la rue la plus proche de la place
        var di = milieu - lot.i, dj = milieu - lot.j, rot;
        if (Math.abs(dj) >= Math.abs(di)) rot = dj > 0 ? 2 : 0; else rot = di > 0 ? 1 : 3;
        BATISSEURS[prog[0]](l, st, o, ox, oz, L, rot, y0, urbain, prog[1]);
      });
      // lampadaires le long des rues, tous les six blocs
      for (var a = 0; a <= n; a++) {
        for (var b = 0; b < n * pas; b += 6) {
          var rx = x0 + a * pas, rz = z0 + b;
          lampadaire(l, st, o, rx, y0, rz);
          lampadaire(l, st, o, x0 + b, y0, z0 + a * pas);
        }
      }
    }

    var PLANS = {
      ville: function (l, st, o, rx, rz) {
        var g = rx * 7 + rz * 13;
        var art = melanger(ARTISANS, g), loi = melanger(LOISIRS, g + 1);
        // l'anneau central : les services ; l'anneau extérieur : logements, fermes, loisirs
        var coeur = melanger([['point_info'], ['banque'], ['salon'], ['magasin'], ['artisan', art[0]], ['artisan', art[1]],
                              ['marche'], ['loisirs', loi[0]]], g + 2);
        var peripherie = melanger([['maison'], ['maison'], ['maison'], ['maison'], ['maison'], ['maison'], ['maison'],
                                   ['artisan', art[2]], ['salon'], ['magasin'], ['loisirs', loi[1]], ['loisirs', loi[2]],
                                   ['ferme'], ['ferme'], ['ferme'], ['point_info']], g + 3);
        grille(l, st, o, LIEUX.ville, coeur.concat(peripherie), true);
      },
      village: function (l, st, o, rx, rz) {
        var g = rx * 11 + rz * 5;
        var art = ARTISANS[Math.floor(N.hash2(rx, rz + 3) * 3) % 3], loi = LOISIRS[Math.floor(N.hash2(rx + 5, rz) * 3) % 3];
        var prog = melanger([['point_info'], ['salon'], ['magasin'], ['artisan', art], ['ferme'], ['maison'],
                             ['loisirs', loi], ['marche']], g);
        grille(l, st, o, LIEUX.village, prog, false);
      },
      maison: function (l, st, o, rx, rz) {
        var L = LIEUX.maison.lot, ox = l.x - Math.floor(L / 2), oz = l.z - Math.floor(L / 2);
        var rot = Math.floor(N.hash2(rx * 3, rz * 9) * 4) % 4;
        BATISSEURS.maison(l, st, o, ox, oz, L, rot, l.h0 + 1, false);
        // l'habitant d'une maison isolée est un ermite qui connaît la région
        l.pnjs[l.pnjs.length - 1].role = 'ermite';
        var c = [l.x + (rot === 1 ? -5 : 5), l.z + (rot === 0 ? -5 : 5)];
        lampadaire(l, st, o, c[0], l.h0 + 1, c[1]);
      },
    };

    // ─── lecture ─────────────────────────────────────────────────────────────
    /* Les lieux dont l'emprise touche le rectangle [x0,x1] × [z0,z1]. */
    function lieuxDansZone(x0, z0, x1, z1) {
      var res = [];
      ORDRE_LIEUX.forEach(function (kind) {
        var R = LIEUX[kind].region, P = PORTEE[kind] + 12;
        var rx0 = Math.floor((x0 - P) / R), rx1 = Math.floor((x1 + P) / R);
        var rz0 = Math.floor((z0 - P) / R), rz1 = Math.floor((z1 + P) / R);
        for (var rx = rx0; rx <= rx1; rx++) for (var rz = rz0; rz <= rz1; rz++) {
          var l = lieuDeRegion(kind, rx, rz);
          if (!l) continue;
          if (l.x + l.demi < x0 || l.x - l.demi > x1 || l.z + l.demi < z0 || l.z - l.demi > z1) continue;
          res.push(l);
        }
      });
      return res;
    }

    /* Surface de la plateforme en une colonne : rue, ou sol du biome. */
    function surfaceEn(l, x, z) {
      var r = l.plateforme.rues;
      if (!r) return l.plateforme.surface;
      var u = x - r.x0, v = z - r.z0, rue = r.pas - r.lot;
      var total = r.n * r.pas + rue;
      if (u < 0 || v < 0 || u >= total || v >= total) return l.plateforme.surface;
      if (u % r.pas < rue || v % r.pas < rue) return r.route;
      return l.plateforme.surface;
    }

    /* Pose dans un chunk la part des lieux qui le concerne : d'abord la
       plateforme nivelée (le terrain comblé, le dessus dégagé des arbres et
       des bosses), puis les bâtiments. */
    function appliquer(cx, cz, put) {
      var x0 = cx * CX, z0 = cz * CZ, x1 = x0 + CX - 1, z1 = z0 + CZ - 1, n = 0;
      lieuxDansZone(x0, z0, x1, z1).forEach(function (l) {
        var p = l.plateforme;
        var ax = Math.max(x0, p.x0), bx = Math.min(x1, p.x1), az = Math.max(z0, p.z0), bz = Math.min(z1, p.z1);
        for (var x = ax; x <= bx; x++) for (var z = az; z <= bz; z++) {
          for (var y = Math.max(1, p.h0 - 12); y < p.h0; y++) put(x, y, z, y >= p.h0 - 3 ? p.sousSol : B.STONE);
          put(x, p.h0, z, surfaceEn(l, x, z));
          for (var y2 = p.h0 + 1; y2 < Math.min(WH, p.h0 + 32); y2++) put(x, y2, z, 0);
          n++;
        }
        var a = l.blocs.get(cx + ',' + cz);
        if (a) for (var i = 0; i < a.length; i += 4) { put(a[i], a[i + 1], a[i + 2], a[i + 3]); n++; }
      });
      return n;
    }

    function lieuA(x, z) {
      var l = lieuxDansZone(x, z, x, z);
      for (var i = 0; i < l.length; i++) {
        if (Math.abs(l[i].x - x) <= l[i].demi && Math.abs(l[i].z - z) <= l[i].demi) return l[i];
      }
      return null;
    }
    function batimentA(x, y, z) {
      var l = lieuA(Math.floor(x), Math.floor(z));
      if (!l) return null;
      for (var i = 0; i < l.batiments.length; i++) {
        var b = l.batiments[i];
        if (x >= b.x0 && x <= b.x1 + 1 && z >= b.z0 && z <= b.z1 + 1 && y >= b.y0 - 1 && y <= b.y1) return b;
      }
      return null;
    }
    /* Les lieux dans un rayon, du plus proche au plus lointain. */
    function lieuxProches(x, z, rayon) {
      return lieuxDansZone(x - rayon, z - rayon, x + rayon, z + rayon)
        .map(function (l) { return { lieu: l, d: Math.hypot(l.x - x, l.z - z) }; })
        .filter(function (e2) { return e2.d <= rayon; })
        .sort(function (a, b) { return a.d - b.d; })
        .map(function (e2) { return e2.lieu; });
    }

    return { lieuDeRegion: lieuDeRegion, lieuxDansZone: lieuxDansZone, appliquer: appliquer, lieuA: lieuA,
             batimentA: batimentA, lieuxProches: lieuxProches, surfaceEn: surfaceEn };
  }

  /* Les habitants qu'il faut faire apparaître : ceux des lieux proches qui ne
     sont pas encore dans la liste des entités (repérés par leur identifiant),
     sauf ceux qu'on a tués (`morts`) — ils ne renaissent pas aussitôt. */
  /* `morts` : un Set d'identifiants, ou une Map identifiant → heure de la mort.
     Avec une Map et l'heure `temps`, un habitant mort depuis plus de `delai`
     secondes cède sa place à un remplaçant — même métier, même foyer, nouveau
     nom : le lieu garde sa population sans ressusciter personne. Le remplaçant
     porte un nouvel identifiant (`id+1`, `id+2`…) ; tué à son tour, il sera
     remplacé de la même façon. */
  var DELAI_REMPLACEMENT = 420;          // une journée de jeu
  function pnjsManquants(lieux, entites, morts, temps, delai) {
    var presents = new Set();
    entites.forEach(function (e) { if (e.pnj) presents.add(e.pnj); });
    var l = [], estMap = morts && typeof morts.get === 'function' && !(morts instanceof Set);
    delai = delai === undefined ? DELAI_REMPLACEMENT : delai;
    lieux.forEach(function (lieu) {
      lieu.pnjs.forEach(function (p) {
        var id = p.id, k = 0;
        // la génération en cours : le premier de la lignée qui n'est pas mort
        while (morts && morts.has(id)) {
          if (!estMap || temps === undefined || temps - morts.get(id) < delai) return;   // pas encore remplacé
          k++;
          id = p.id + '+' + k;
        }
        if (presents.has(id)) return;
        if (k === 0) { l.push(p); return; }
        var r = {}, c;
        for (c in p) r[c] = p[c];
        r.id = id;
        r.nom = PRENOMS[(PRENOMS.indexOf(p.nom) + k * 7) % PRENOMS.length];
        r.remplacant = k;
        l.push(r);
      });
    });
    return l;
  }

  // ─── services des métiers ────────────────────────────────────────────────
  var POINTS_CARDINAUX = ['à l\'est', 'au sud-est', 'au sud', 'au sud-ouest', 'à l\'ouest', 'au nord-ouest', 'au nord', 'au nord-est'];
  function cap(dx, dz) {
    // x vers l'est, z vers le sud
    var a = Math.atan2(dz, dx), k = Math.round(a / (Math.PI / 4));
    return POINTS_CARDINAUX[((k % 8) + 8) % 8];
  }
  var COUT = { repos: 1, reparer: 1 };
  var RAYON_INFO = 700, DETENTE_DELAI = 120;

  /* Rend un service. ctx : { inv, etat (joueur), temps, dureeJour, estNuit,
     habitats, reperes, x, z, lieu }. Renvoie { ok, message, ... } : le jeu
     applique le reste (ouvrir le compte, avancer l'heure). */
  function servir(service, ctx) {
    var inv = ctx.inv, st = ctx.etat;
    function payer(n) {
      if (!inv || inv.count(I.EMERALD) < n) return false;
      inv.remove(I.EMERALD, n);
      return true;
    }
    switch (service) {
      case 'info': {
        if (!ctx.habitats) return { ok: false, message: 'Je ne connais rien des environs.' };
        var ici = ctx.lieu ? ctx.lieu.id : null;
        var lieux = ctx.habitats.lieuxProches(ctx.x, ctx.z, RAYON_INFO)
          .filter(function (l) { return l.id !== ici; }).slice(0, 4);
        if (!lieux.length) return { ok: true, message: 'Il n\'y a rien d\'autre à des lieues à la ronde.', lieux: [] };
        var poses = 0;
        lieux.forEach(function (l) {
          if (ctx.reperes && !ctx.reperes.proche(l.x, l.z, 12)) { ctx.reperes.ajouter(l.nom, l.x, l.z); poses++; }
        });
        var txt = lieux.map(function (l) {
          return l.nom + ' (' + LIEUX[l.kind].nom.toLowerCase() + ', ' + Math.round(Math.hypot(l.x - ctx.x, l.z - ctx.z)) +
                 ' blocs ' + cap(l.x - ctx.x, l.z - ctx.z) + ')';
        }).join(', ');
        return { ok: true, message: 'Aux alentours : ' + txt + '.' + (poses ? ' Je les ai marqués sur votre carte.' : ''),
                 lieux: lieux, reperesPoses: poses };
      }
      case 'banque':
        return { ok: true, ouvrir: 'banque', message: 'Voici votre compte.' };
      case 'repos': {
        if (!payer(COUT.repos)) return { ok: false, message: 'Une chambre coûte une émeraude.' };
        if (st) { st.hp = ctx.pvMax || 20; st.hunger = Math.max(st.hunger || 0, 16); }
        var r = { ok: true, message: 'Vous vous reposez : vous voilà frais et dispos.' };
        if (ctx.estNuit && ctx.dureeJour) {
          // on dort jusqu'au matin
          var j = Math.floor(ctx.temps / ctx.dureeJour);
          r.temps = (j + 1) * ctx.dureeJour + ctx.dureeJour * 0.02;
          r.message = 'Vous dormez jusqu\'au matin.';
        }
        return r;
      }
      case 'reparer': {
        var s = inv && inv.slots[st ? st.selected : 0];
        var max = s ? C.durabilityOf(s.id) : 0;
        if (!s || !max) return { ok: false, message: 'Tenez en main l\'outil à réparer.' };
        if (!s.dmg) return { ok: false, message: 'Cet outil est comme neuf.' };
        var prix = max >= 1000 ? 3 : COUT.reparer;
        if (!payer(prix)) return { ok: false, message: 'La réparation coûte ' + prix + ' émeraude' + (prix > 1 ? 's' : '') + '.' };
        s.dmg = 0;
        return { ok: true, message: C.nameOf(s.id) + ' : réparé à neuf.' };
      }
      case 'detente': {
        if (st && st.detenteT !== undefined && ctx.temps - st.detenteT < DETENTE_DELAI) {
          return { ok: false, message: 'Revenez un peu plus tard pour le prochain spectacle.' };
        }
        if (st) { st.hp = Math.min(ctx.pvMax || 20, (st.hp || 0) + 6); st.detenteT = ctx.temps; }
        return { ok: true, message: 'Vous passez un bon moment : +6 points de vie.' };
      }
    }
    return { ok: false, message: 'Je ne peux rien pour vous.' };
  }

  MC.Habitats = { STYLES: STYLES, URBAIN: URBAIN, LIEUX: LIEUX, BATIMENTS: BATIMENTS, ROLES: ROLES,
                  ARTISANS: ARTISANS, LOISIRS: LOISIRS, ORDRE_LIEUX: ORDRE_LIEUX,
                  stylePour: stylePour, creer: creer, pnjsManquants: pnjsManquants, servir: servir,
                  DELAI_REMPLACEMENT: DELAI_REMPLACEMENT,
                  RAYON_INFO: RAYON_INFO };
})(typeof globalThis !== 'undefined' ? globalThis : this);
