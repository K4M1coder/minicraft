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
  /* SPEC-HABITAT-008 : la ville occupe une grande région (plusieurs kilomètres
     de côté) — une seule par région, donc des villes voisines très espacées ;
     village et maison restent sur des mailles bien plus fines, ce qui les
     multiplie autour de chaque ville et dans la campagne alentour. */
  var LIEUX = {
    /* SPEC-HABITAT-013 : la mégapole n'apparaît qu'en zone hyperurbaine
       (MC.Densite) — rare par construction (le bruit de population qui la
       classe ainsi ne culmine que sur de vastes échelles) — et sur un très
       grand terrain plat (une plaine, ou un rivage) : plus d'un kilomètre de
       côté (9 parcelles de 140, marge comprise). */
    megapole: { nom: 'Mégapole', region: 20000, proba: 0.6, lots: 9, pas: 140, lot: 108, marge: 24,
                biomes: ['plaines', 'savane', 'desert'], denivele: 8 },
    ville:   { nom: 'Ville', region: 2400, proba: 0.55, lots: 5, pas: 16, lot: 12, marge: 6,
               biomes: ['plaines', 'foret', 'desert', 'savane', 'taiga', 'jungle', 'badlands'], denivele: 10 },
    village: { nom: 'Village', region: 224, proba: 0.5, lots: 3, pas: 13, lot: 10, marge: 4,
               biomes: ['plaines', 'foret', 'desert', 'savane', 'taiga', 'jungle', 'marais', 'badlands',
                        'montagnes', 'champignons', 'pics_glaces'], denivele: 8 },
    maison:  { nom: 'Habitation isolée', region: 72, proba: 0.2, lots: 1, pas: 12, lot: 9, marge: 2,
               biomes: ['plaines', 'foret', 'desert', 'savane', 'taiga', 'jungle', 'marais', 'badlands',
                        'montagnes', 'champignons', 'pics_glaces', 'glacier'], denivele: 6 },
  };
  // l'ordre fixe le rang : un lieu plus tôt dans la liste exclut les
  // suivants de son emprise (`occupePar`) — la mégapole avant tout le reste
  var ORDRE_LIEUX = ['megapole', 'ville', 'village', 'maison'];
  /* Densité par biome (SPEC-HABITAT-008) : villages et maisons isolées se font
     rares en montagne, désert, badlands et glace — la campagne s'y vide,
     seule la ville (déjà limitée aux biomes vivables) continue d'y apparaître
     par endroits. 1 = densité normale (pas de filtre supplémentaire). */
  var DENSITE_CAMPAGNE = { montagnes: 0.3, desert: 0.28, pics_glaces: 0.15, badlands: 0.35, glacier: 0.1, taiga: 0.6 };

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
    tour:       { nom: 'Tour', role: 'habitant' },       // HABITAT-013 : cœur de mégapole
    immeuble:   { nom: 'Immeuble', role: 'habitant' },    // HABITAT-013 : quartiers d'immeubles
    port:       { nom: 'Port', role: null },              // HABITAT-013/ROUTE-008 : quai en bord d'eau
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

  /* `riviereDe` (optionnel, Bio.riviere) : L38, pour la carte de densité
     (eau douce/côtes — SPEC-DENSITE-001) et pour savoir si une mégapole ou un
     village borde un fleuve et mérite un port (HABITAT-013, ROUTE-008). */
  /* `env` : données environnementales du monde (MC.Biomes : volcans, climat),
     transmises telles quelles à la carte de densité (SPEC-DENSITE-001). */
  function creer(N, hauteur, biomeDe, riviereDe, env) {
    var caches = { megapole: new Map(), ville: new Map(), village: new Map(), maison: new Map() };
    var PLAFONDS = { megapole: 16, ville: 64, village: 512, maison: 4096 };
    // SPEC-DENSITE-001/002 : carte de densité, point d'extension unique
    // (repartitionOk) d'où naissent les lieux selon leur classe
    var Dens = MC.Densite ? MC.Densite.creer(N, hauteur, biomeDe, riviereDe, env) : null;

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

    /* Le lieu d'une région s'il est déjà en cache (null : région sans lieu),
       undefined sinon — sans jamais construire : le serveur s'en sert pour garder
       l'identité des lieux du cache (endommagés, repeuplés) dans ses propres préparations. */
    function lieuEnCache(kind, rx, rz) {
      var cache = caches[kind];
      return cache ? cache.get(rx + ',' + rz) : undefined;
    }
    var PORTEE = { megapole: 140, ville: 70, village: 26, maison: 10 };
    /* SPEC-HABITAT-012 : la taille d'une ville varie — petite (3×3 parcelles),
       moyenne (5×5, la taille d'origine) ou grande cité (7×7) — tirée une
       fois par région, indépendamment du reste de sa construction. */
    function tailleVille(rx, rz) {
      var r = N.hash2(rx * 1531 + 71, rz * 911 - 37);
      return r < 0.45 ? 3 : r < 0.82 ? 5 : 7;
    }
    /* Position candidate d'une ville, sans construire le lieu : une fonction
       pure, dupliquant juste le tirage de position de `construire`, qui sert
       à vérifier l'espacement entre villes voisines SANS jamais construire
       récursivement une région voisine (ce qui boucierait : la région
       voisine vérifierait à son tour la nôtre, pas encore en cache). */
    function candidatVille(rx, rz) {
      var def = LIEUX.ville, R = def.region, graineK = 7;
      if (N.hash2(rx * 5381 + graineK, rz * 33391 - graineK) > def.proba) return null;
      var lotsN = tailleVille(rx, rz);
      var demi = Math.floor((lotsN * def.pas) / 2) + def.marge;
      var m = demi + 8;
      var x = rx * R + m + Math.floor(N.hash2(rx * 131 + graineK, rz * 977) * (R - 2 * m));
      var z = rz * R + m + Math.floor(N.hash2(rx * 419, rz * 263 + graineK) * (R - 2 * m));
      return { x: x, z: z, demi: demi };
    }
    /* Même chose pour la mégapole (HABITAT-013) : taille fixe (contrairement
       à la ville), mais un espacement bien plus grand encore. */
    function candidatMegapole(rx, rz) {
      var def = LIEUX.megapole, R = def.region, graineK = 41;
      if (N.hash2(rx * 5381 + graineK, rz * 33391 - graineK) > def.proba) return null;
      var demi = Math.floor((def.lots * def.pas) / 2) + def.marge;
      var m = demi + 8;
      var x = rx * R + m + Math.floor(N.hash2(rx * 131 + graineK, rz * 977) * (R - 2 * m));
      var z = rz * R + m + Math.floor(N.hash2(rx * 419, rz * 263 + graineK) * (R - 2 * m));
      return { x: x, z: z, demi: demi };
    }
    // SPEC-HABITAT-008 : deux villes restent à plusieurs kilomètres l'une de l'autre
    var ESPACEMENT_VILLES = 1300;
    // HABITAT-013 : les mégapoles, elles, restent à des dizaines de kilomètres
    var ESPACEMENT_MEGAPOLES = 7000;
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

    /* SPEC-HABITAT-008/SPEC-DENSITE-002 : la répartition des lieux, isolée
       dans une seule fonction — c'est ici que la carte de densité (MC.Densite,
       zones vierge/rurale/urbaine/hyperurbaine — L38) module en douceur la
       probabilité de chaque genre de lieu, en plus de l'espacement des
       villes/mégapoles et de la rareté de la campagne par biome, sans
       toucher au reste de `construire`. `false` refuse le lieu à cet endroit. */
    function repartitionOk(kind, rx, rz, x, z, bio, graineK) {
      /* deux villes (ou deux mégapoles) ne s'installent jamais à moins de
         plusieurs centaines/milliers de blocs l'une de l'autre — on ne
         construit jamais la région voisine (récursion croisée : elle nous
         vérifierait à son tour), seulement sa position candidate, pure et
         sans cache. Le départage est arbitraire mais fixe (rz puis rx) :
         une région ne cède la place qu'à une voisine « antérieure » dans cet
         ordre, ce qui reste vrai quel que soit l'ordre réel de génération
         des chunks. */
      if (kind === 'megapole') {
        for (var avm = -1; avm <= 1; avm++) for (var bvm = -1; bvm <= 1; bvm++) {
          if (!avm && !bvm) continue;
          var rzM = rz + bvm, rxM = rx + avm;
          if (!(rzM < rz || (rzM === rz && rxM < rx))) continue;
          var candM = candidatMegapole(rxM, rzM);
          if (candM && Math.hypot(candM.x - x, candM.z - z) < ESPACEMENT_MEGAPOLES) return false;
        }
        // SPEC-DENSITE-002 : une mégapole ne naît qu'en zone hyperurbaine —
        // rare et très espacée par construction du bruit de population (un
        // seul calcul, comme ci-dessous : inutile de le refaire au second appel)
        if (Dens && !bio && Dens.classeEn(x, z).classe !== 'hyperurbaine') return false;
        return true;
      }
      if (kind === 'ville') {
        for (var av = -1; av <= 1; av++) for (var bv = -1; bv <= 1; bv++) {
          if (!av && !bv) continue;
          var rzV = rz + bv, rxV = rx + av;
          if (!(rzV < rz || (rzV === rz && rxV < rx))) continue;
          var cand = candidatVille(rxV, rzV);
          if (cand && Math.hypot(cand.x - x, cand.z - z) < ESPACEMENT_VILLES) return false;
        }
      } else if (bio && DENSITE_CAMPAGNE[bio.id] !== undefined &&
          N.hash2(rx * 1013 + 37 + graineK, rz * 2027 - 19) > DENSITE_CAMPAGNE[bio.id]) return false;
      /* SPEC-DENSITE-002 : transitions progressives plutôt qu'un tranchant
         net — presque rien en zone vierge, la campagne (village/maison)
         pleine en zone rurale puis en repli à mesure que l'urbain gagne, la
         ville pleine en zone urbaine et cédant à son tour la place à la
         mégapole en entrant dans l'hyperurbain.
         Ce test est coûteux (plusieurs `hauteur`/`biomeDe` de plus) : on ne
         le fait qu'au premier appel de `construire` (bio encore null, avant
         même le sondage du biome) — le second, avec le biome en main, ne
         referait que le même calcul déterministe pour le même résultat. */
      if (Dens && !bio) {
        var d = Dens.classeEn(x, z);
        // presque rien en zone vierge (versRurale ≈ 0 juste là) pour les deux
        // genres ; en zone hyperurbaine, la ville cède un peu la place à la
        // mégapole, la campagne beaucoup plus — mais rurale ET urbaine restent
        // pleinement fertiles pour l'une comme pour l'autre (pas de tranchant
        // net entre elles : seules les deux extrémités de la carte s'éclaircissent)
        var pVierge = 1 - (1 - d.versRurale) * 0.9;
        // la ville garde sa place jusque dans l'hyperurbain (des satellites
        // plausibles autour d'une mégapole) ; la campagne (village, maison),
        // elle, s'efface bien davantage — c'est la mégapole qui prend le relais
        var p = kind === 'ville' ? pVierge : pVierge * (1 - d.versHyper * 0.85);
        var r = N.hash2(rx * 1523 + graineK * 3 + 7, rz * 3121 - graineK * 5 - 11);
        if (r > p) return false;
      }
      return true;
    }

    function construire(kind, rx, rz) {
      var def = LIEUX[kind], R = def.region;
      var graineK = kind === 'ville' ? 7 : kind === 'village' ? 13 : kind === 'megapole' ? 41 : 29;
      if (N.hash2(rx * 5381 + graineK, rz * 33391 - graineK) > def.proba) return null;
      // taille propre à cette ville (SPEC-HABITAT-012) ; les autres genres gardent leur taille unique
      var lotsN = kind === 'ville' ? tailleVille(rx, rz) : def.lots;
      var demi = Math.floor((lotsN * def.pas) / 2) + def.marge;
      var m = demi + 8;
      var x = rx * R + m + Math.floor(N.hash2(rx * 131 + graineK, rz * 977) * (R - 2 * m));
      var z = rz * R + m + Math.floor(N.hash2(rx * 419, rz * 263 + graineK) * (R - 2 * m));
      if (!repartitionOk(kind, rx, rz, x, z, null, graineK)) return null;
      var bio = biomeDe ? biomeDe(x, z) : null;
      if (!bio || bio.marin || def.biomes.indexOf(bio.id) < 0) return null;
      if (!repartitionOk(kind, rx, rz, x, z, bio, graineK)) return null;
      // terrain : pas trop accidenté, au sec — l'échantillon reste borné à un
      // rayon raisonnable même pour un lieu très étendu (la mégapole) : au-delà,
      // le relief continental varie de toute façon, plaine ou pas
      var hs = [], rSonde = Math.min(demi, 180) / 2;
      for (var i = -2; i <= 2; i++) for (var j = -2; j <= 2; j++) hs.push(hauteur(x + i * rSonde, z + j * rSonde));
      hs.sort(function (a, b) { return a - b; });
      var h0 = hs[Math.floor(hs.length / 2)], denivele = hs[hs.length - 1] - hs[0];
      if (denivele > def.denivele * 2 || h0 <= SEA + 1 || h0 > WH - 40) return null;
      if (occupePar(kind, x, z)) return null;
      var urbain = kind === 'ville' || kind === 'megapole';
      return fabriquer(kind, rx, rz, x, z, demi, h0, denivele, lotsN, bio, stylePour(bio.id, urbain), graineK);
    }
    /* Le lieu lui-même, une fois son emplacement, son terrain et son style
       décidés par `construire` (seul appelant en jeu). Séparé pour que les
       tests puissent bâtir n'importe quel style partout (`batirPourEssai`). */
    function fabriquer(kind, rx, rz, x, z, demi, h0, denivele, lotsN, bio, st, graineK) {
      var l = {
        id: kind + ':' + rx + ',' + rz, kind: kind, nom: kind === 'maison' ? 'Maison de ' + PRENOMS[Math.floor(N.hash2(rx, rz * 7) * PRENOMS.length) % PRENOMS.length]
                                                        : nomDe(N.hash2(rx * 3, rz * 5 + graineK), N.hash2(rx * 11 + graineK, rz * 17)),
        biome: bio.id, style: st.nom, x: x, z: z, demi: demi, h0: h0, denivele: denivele, lots: lotsN,
        batiments: [], pnjs: [], lampes: 0,
        blocs: new Map(),                 // clé de chunk → [x, y, z, id, etat, x, y, z, id, etat, …]
        plateforme: { x0: x - demi, z0: z - demi, x1: x + demi, z1: z + demi, h0: h0,
                      surface: bio.surface || B.GRASS, sousSol: bio.sousSol || B.DIRT, routes: [] },
      };
      var outils = outilsPour(l, st);
      PLANS[kind](l, st, outils, rx, rz);
      return l;
    }

    // ─── outils de construction ─────────────────────────────────────────────
    function outilsPour(l, st) {
      /* `etat` (optionnel, 5e champ, SPEC-CONSTR-003) : orientation d'un
         escalier de toiture, moitié d'une dalle de faîtage… stocké en
         parallèle de l'id dans `l.blocs` et rejoué par world.js (setEtat) en
         même temps que le bloc — jamais interrogé aux voisins, contrairement
         aux clôtures/murets (voir formes.js). */
      function pose(x, y, z, id, etat) {
        if (y <= 0 || y >= WH) return;
        var k = Math.floor(x / CX) + ',' + Math.floor(z / CZ);
        var a = l.blocs.get(k);
        if (!a) { a = []; l.blocs.set(k, a); }
        a.push(x, y, z, id, etat || 0);
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

    /* Le gros œuvre seul : sol, murs avec poteaux d'angle, fenêtres, pilotis
       — sans porte, sans échelle, sans lumière, sans toit ni entrée dans
       `l.batiments`. Sert de brique à `corps` (le bâtiment complet) et aux
       ailes secondaires d'un plan en L (SPEC-HABITAT-010, BATISSEURS.maison).
       Renvoie {y0, haut} : le rez-de-chaussée et le sommet des murs après
       l'éventuel exhaussement sur pilotis. */
    function corpsBrut(l, st, o, p, w, d, y0, etages) {
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
      return { y0: y0, haut: haut };
    }

    /* Une maison générique : le gros œuvre (`corpsBrut`), la porte, les
       étages (échelle), une lumière, le toit selon la forme du style.
       Renvoie le bâtiment. */
    /* ─── Intérieurs (SPEC-INTERIEUR-001) ───────────────────────────────────
       Chaque bâtiment reçoit le mobilier de sa fonction, étage par étage, sans
       jamais encombrer l'allée de la porte (colonne du milieu, deux premiers
       rangs), l'échelle (u=1, v=d-2) ni la lanterne (u=w-2, v=d-2). Les
       meubles regardent l'intérieur : leur orientation suit celle du bâtiment.
       Les bâtisseurs posent ensuite leurs pièces propres (comptoirs, coffres) :
       posées après, elles l'emportent sur un meuble de la même case. */
    var MOBILIER = {
      // [u, v, bloc, décalage d'orientation] — u, v : 'g' gauche, 'd' droite, 'c' centre, 'f' fond
      maison:     [['d', 1, 'LIT'], ['c+1', 'm', 'TABLE'], ['c+2', 'm', 'CHAISE', 1], ['c', 'm', 'CHAISE', 3],
                   ['g', 'f', 'ARMOIRE', 2], ['c', 'f', 'FOYER', 2], ['g', 1, 'VASE'], ['c+1', 'm+1', 'TAPIS']],
      etage:      [['d', 1, 'LIT'], ['g', 'f-1', 'ARMOIRE', 2], ['c+1', 'm', 'TAPIS'], ['g', 1, 'LAMPE']],
      magasin:    [['g', 'f', 'ETAGERE', 2], ['c+2', 'f', 'ETAGERE', 2], ['d', 1, 'PRESENTOIR'], ['g', 1, 'VASE']],
      banque:     [['c', 'f', 'SOCLE'], ['g', 1, 'VASE'], ['d', 1, 'VASE'], ['c+1', 'm', 'TAPIS']],
      salon:      [['g', 'f', 'ETAGERE', 2], ['d', 'f-1', 'FOYER', 2], ['c', 'm+1', 'TAPIS'], ['g', 1, 'LAMPE']],
      artisan:    [['g', 'f-1', 'ARMOIRE', 2], ['d', 1, 'ETAGERE'], ['c+1', 'm', 'TABLE'], ['c', 'm', 'CHAISE', 1]],
      point_info: [['g', 'f', 'BIBLIOTHEQUE', 2], ['c+2', 'f', 'BIBLIOTHEQUE', 2], ['c+1', 'm', 'PRESENTOIR'], ['d', 1, 'LAMPE'],
                   ['c', 'm+1', 'TAPIS']],
      tour:       [['d', 1, 'LIT'], ['c+1', 'm', 'TABLE'], ['c', 'm', 'CHAISE', 1], ['g', 'f-1', 'ARMOIRE', 2], ['g', 1, 'LAMPE']],
      immeuble:   [['d', 1, 'LIT'], ['c+1', 'm', 'TABLE'], ['c', 'm', 'CHAISE', 1], ['g', 'f-1', 'ARMOIRE', 2], ['g', 1, 'LAMPE']],
    };
    function meubler(o, p, w, d, y0, etages, type, rot, aEtages) {
      if (!B.LIT) return;                                       // mobilier absent (anciens tests)
      var pu = Math.floor(w / 2), m = Math.max(2, Math.floor(d / 2));
      function col(c) {
        if (c === 'g') return 1;
        if (c === 'd') return w - 2;
        var k = parseInt(c.slice(1) || '0', 10) || 0;
        return pu + k;
      }
      function rang(r) {
        if (typeof r === 'number') return r;
        if (r[0] === 'f') return d - 2 + (parseInt(r.slice(1) || '0', 10) || 0);
        return m + (parseInt(r.slice(1) || '0', 10) || 0);
      }
      for (var et = 0; et < etages; et++) {
        var liste = MOBILIER[et === 0 ? type : (MOBILIER[type] && (type === 'tour' || type === 'immeuble') ? type : 'etage')] || [];
        var y = y0 + et * 4;
        liste.forEach(function (mb) {
          var u = col(mb[0]), v = rang(mb[1]), id = B[mb[2]];
          if (!id || u < 1 || u > w - 2 || v < 1 || v > d - 2) return;
          if (u === pu && v <= 2) return;                                   // l'allée de la porte
          if (u === w - 2 && v === d - 2) return;                           // la lanterne
          if (aEtages && u === 1 && v === d - 2) return;                    // l'échelle
          var q = p(u, v), orient = (rot + (mb[3] || 0)) & 3;
          var etat = MC.Formes && MC.Formes.packMeuble && C.BLOCKS[id] && C.BLOCKS[id].forme === 'meuble' ? MC.Formes.packMeuble(orient, false) : 0;
          o.pose(q[0], y, q[1], id, etat);
          // le lit occupe deux cases : la tête, derrière le pied
          if (mb[2] === 'LIT' && v + 1 <= d - 2) {
            var t = p(u, v + 1);
            o.pose(t[0], y, t[1], id, MC.Formes.packMeuble(orient, true));
          }
        });
      }
    }

    function corps(l, st, o, p, w, d, y0, etages, type, nom, rot) {
      var H = 4;
      var brut = corpsBrut(l, st, o, p, w, d, y0, etages);
      y0 = brut.y0; var haut = brut.haut;
      var fx = function (u, v) { return p(u, v)[0]; }, fz = function (u, v) { return p(u, v)[1]; };
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
      // un intérieur meublé selon la fonction du bâtiment (SPEC-INTERIEUR-001)
      meubler(o, p, w, d, y0, etages, type, rot || 0, etages > 1);
      toit(st, o, p, w, d, haut);
      var c0 = p(0, 0), c1 = p(w - 1, d - 1);
      var bat = { type: type, nom: nom || BATIMENTS[type].nom, lieu: l.id,
                  x0: Math.min(c0[0], c1[0]), z0: Math.min(c0[1], c1[1]), x1: Math.max(c0[0], c1[0]), z1: Math.max(c0[1], c1[1]),
                  y0: y0, y1: haut + Math.ceil(d / 2) + 1, porte: { x: fx(pu, 0), z: fz(pu, 0) },
                  dedans: { x: fx(pu, 2) + 0.5, y: y0, z: fz(pu, 2) + 0.5 } };
      l.batiments.push(bat);
      return bat;
    }

    /* SPEC-CONSTR-003 : toit en pente fait d'escaliers orientés, faîtage en
       dalle haute (ou en bloc plein si le matériau n'a pas de dalle — tous
       les matériaux de toiture des styles pignon/raide ont leur escalier,
       voir core.js L24, mais pas tous leur dalle). Les formes plates et
       dômes/chapeaux, elles, restent en blocs pleins : le style l'exige
       (désert, igloos, champignons…). Un bâtiment composé (plan en L) pose
       simplement un toit par volume : là où deux pans se recoupent, le
       second recouvre le premier — une noue approximative plutôt qu'un
       raccord parfaitement mitré, mais jamais de trou. */
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
      // pignon/raide : deux pans le long de w, montant en escaliers vers le
      // faîtage (raide : une marche pleine puis l'escalier, deux fois plus
      // raide qu'un pignon simple) ; pignons (u=0 et u=w-1) pleins sous le toit.
      var Fo = MC.Formes, matDef = C.BLOCKS[st.toit];
      var escId = matDef && matDef.escalier, dalleId = matDef && matDef.dalle;
      var raide = forme === 'raide', pasY = raide ? 2 : 1, moitie = Math.ceil(d / 2);
      // direction du monde vers laquelle "v" croît à cette rotation, dérivée
      // de p() elle-même (donc juste quel que soit rot) : le pan côté v<0
      // grimpe vers +v (le faîtage), le pan côté v>=d grimpe vers -v.
      var d0 = p(0, 0), d1 = p(0, 1);
      var orAvant = C.orientDeRegard({ x: d1[0] - d0[0], z: d1[1] - d0[1] });
      var orArriere = (orAvant + 2) & 3;
      for (var k = 0; k <= moitie; k++) {
        var faite = k >= moitie, yy0 = y + k * pasY;
        [[k - 1, orAvant], [d - k, orArriere]].forEach(function (pair) {
          var vv = pair[0], orient = pair[1];
          if (vv < -1 || vv > d) return;
          for (var u3 = -1; u3 <= w; u3++) {
            var x = fx(u3, vv), z = fz(u3, vv);
            if (faite) {
              if (dalleId) o.pose(x, yy0, z, dalleId, Fo.packDalle(true));
              else o.pose(x, yy0, z, st.toit);
            } else if (raide) {
              o.pose(x, yy0, z, st.toit);
              if (escId) o.pose(x, yy0 + 1, z, escId, Fo.packEscalier(orient, false, Fo.DROIT));
              else o.pose(x, yy0 + 1, z, st.toit);
            } else if (escId) {
              o.pose(x, yy0, z, escId, Fo.packEscalier(orient, false, Fo.DROIT));
            } else {
              o.pose(x, yy0, z, st.toit);
            }
          }
        });
        // pignons : le mur remonte sous le toit, sur toute sa hauteur locale
        var yTop = (!faite && raide) ? yy0 + 1 : yy0;
        for (var v3 = k; v3 < d - k; v3++) for (var yw = yy0; yw <= yTop; yw++) {
          o.pose(fx(0, v3), yw, fz(0, v3), st.mur);
          o.pose(fx(w - 1, v3), yw, fz(w - 1, v3), st.mur);
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
      /* SPEC-HABITAT-010 : trois plans reconnaissables — carrée (presque
         aussi large que profonde), longère (large et basse) et en L (un
         corps principal et une aile secondaire accolée à l'arrière, posée en
         gros œuvre seul par `corpsBrut` : pas de porte ni d'habitant propres,
         juste un volume de plus sous le même toit de style). En ville, le
         gabarit suit la densité : une maison mitoyenne, mur à mur avec la
         parcelle voisine, façade étroite et plusieurs étages plutôt qu'un des
         trois plans de la campagne. */
      maison: function (l, st, o, ox, oz, L, rot, y0, urbain) {
        var etages = urbain ? 1 + Math.floor(o.hash(ox, 3, oz) * 3) : 1;
        var plan, w, d, p, b;
        if (urbain) {
          plan = 'mitoyenne';
          w = Math.max(5, L - 2); d = 6 + Math.floor(o.hash(ox, 2, oz) * 2);
          p = o.repere(ox + Math.floor((L - w) / 2), oz + 1, w, d, rot);
          b = corps(l, st, o, p, w, d, y0, etages, 'maison', null, rot);
        } else {
          var choix = Math.floor(o.hash(ox, 4, oz) * 3);
          plan = ['carree', 'longere', 'L'][choix];
          if (plan === 'carree') { w = 7 + Math.floor(o.hash(ox, 1, oz) * 2); d = w - 1; }
          else if (plan === 'longere') { w = Math.min(L - 2, 10 + Math.floor(o.hash(ox, 1, oz) * 3)); d = 5; }
          else { w = 6; d = 5; }
          p = o.repere(ox + Math.floor((L - w) / 2), oz + 1, w, d, rot);
          b = corps(l, st, o, p, w, d, y0, etages, 'maison', null, rot);
          if (plan === 'L') {
            // aile secondaire, accolée au mur du fond (aucun recouvrement
            // avec le corps principal, toujours dans la parcelle — HABITAT-011)
            var w2 = 3, d2 = 3;
            var offU = Math.floor((w - w2) / 2);
            var p2 = o.repere(ox + Math.floor((L - w) / 2) + offU, oz + 1 + d, w2, d2, rot);
            var brut2 = corpsBrut(l, st, o, p2, w2, d2, y0, 1);
            toit(st, o, p2, w2, d2, brut2.haut);
          }
        }
        b.plan = plan;
        // le mobilier vient de meubler() ; restent l'établi et le coffre de la maisonnée
        var q = function (u, v) { return p(u, v); };
        if (!B.LIT) { var c = q(w - 2, 1); o.pose(c[0], b.y0, c[1], B.WOOL_RED); }
        var t = q(1, 1); if (B.LIT) t = q(1, 2); o.pose(t[0], b.y0, t[1], B.CRAFTING_TABLE);
        var ch = q(2, d - 2); o.pose(ch[0], b.y0, ch[1], B.CHEST);
        pnj(l, 'habitant', b.dedans.x, b.y0, b.dedans.z, b);
      },
      point_info: function (l, st, o, ox, oz, L, rot, y0) {
        var variantes = [[7, 7], [9, 6]], vi = Math.floor(o.hash(ox, 30, oz) * variantes.length);
        var w = variantes[vi][0], d = variantes[vi][1];
        var p = o.repere(ox + Math.floor((L - w) / 2), oz + 1, w, d, rot);
        var b = corps(l, st, o, p, w, d, y0, 1, 'point_info', null, rot);
        b.plan = 'v' + vi;
        var a = p(1, 1), c = p(w - 2, 1);
        o.pose(a[0], b.y0, a[1], B.PANNEAU_INFO); o.pose(c[0], b.y0, c[1], B.PANNEAU_INFO);
        var f = p(Math.floor(w / 2) - 2, -1), g2 = p(Math.floor(w / 2) + 2, -1);
        lampadaire(l, st, o, f[0], b.y0, f[1]); lampadaire(l, st, o, g2[0], b.y0, g2[1]);
        pnj(l, 'guide', b.dedans.x, b.y0, b.dedans.z, b);
      },
      banque: function (l, st, o, ox, oz, L, rot, y0) {
        var variantes = [[11, 9], [13, 10]], vi = Math.floor(o.hash(ox, 31, oz) * variantes.length);
        var w = variantes[vi][0], d = variantes[vi][1], sb = {}, k;
        for (k in st) sb[k] = st[k];
        sb.mur = B.STONE_BRICK; sb.coin = B.STONE_BRICK; sb.sol = B.STONE_BRICK; sb.forme = 'plat'; sb.toit = B.STONE_BRICK;
        var p = o.repere(ox + Math.floor((L - w) / 2), oz, w, d, rot);
        var b = corps(l, sb, o, p, w, d, y0, 2, 'banque', null, rot);
        b.plan = 'v' + vi;
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
        var alterne = o.hash(ox, 32, oz) < 0.5;
        var w = Math.min(alterne ? 11 : 9, L), d = Math.min(alterne ? 9 : 11, L - 1);
        var p = o.repere(ox + Math.floor((L - w) / 2), oz, w, d, rot);
        var b = corps(l, st, o, p, w, d, y0, 1, 'salon', null, rot);
        b.plan = alterne ? 'large' : 'profond';
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
        var variantes = [[9, 7], [11, 6]], vi = Math.floor(o.hash(ox, 33, oz) * variantes.length);
        var w = variantes[vi][0], d = variantes[vi][1];
        var p = o.repere(ox + Math.floor((L - w) / 2), oz + 1, w, d, rot);
        var b = corps(l, st, o, p, w, d, y0, 1, 'magasin', null, rot);
        b.plan = 'v' + vi;
        for (var u = 1; u < w - 1; u++) { var cp = p(u, 3); o.pose(cp[0], b.y0, cp[1], B.COMPTOIR); }
        o.pose(p(Math.floor(w / 2), 3)[0], b.y0, p(Math.floor(w / 2), 3)[1], 0);
        for (var uc = 1; uc < w - 1; uc += 2) { var qc = p(uc, d - 2); o.pose(qc[0], b.y0, qc[1], B.CHEST); }
        var f = p(1, -1); lampadaire(l, st, o, f[0], b.y0, f[1]);
        var m = p(Math.floor(w / 2), 5);
        pnj(l, 'marchand', m[0] + 0.5, b.y0, m[1] + 0.5, b);
      },
      artisan: function (l, st, o, ox, oz, L, rot, y0, urbain, sous) {
        var variantes = [[9, 7], [11, 8]], vi = Math.floor(o.hash(ox, 34, oz) * variantes.length);
        var w = variantes[vi][0], d = variantes[vi][1];
        var p = o.repere(ox + Math.floor((L - w) / 2), oz + 1, w, d, rot);
        var noms = { forgeron: 'Forge', menuisier: 'Menuiserie', tisserand: 'Atelier du tisserand' };
        var b = corps(l, st, o, p, w, d, y0, 1, 'artisan', noms[sous], rot);
        b.metier = sous; b.plan = 'v' + vi;
        var outilsAtelier = sous === 'forgeron' ? [B.ENCLUME, B.FURNACE, B.FURNACE, B.COBBLE]
                          : sous === 'menuisier' ? [B.CRAFTING_TABLE, B.PLANKS, B.TONNEAU, B.BOOKSHELF]
                          : [B.WOOL_RED, B.WOOL_BLUE, B.WOOL_YELLOW, B.WOOL_GREEN];
        outilsAtelier.forEach(function (id, i) { var q = p(1 + i * 2, d - 2); o.pose(q[0], b.y0, q[1], id); });
        pnj(l, sous, b.dedans.x, b.y0, b.dedans.z, b);
      },
      marche: function (l, st, o, ox, oz, L, rot, y0) {
        // deux plans reconnaissables : quatre petits étals aux coins, ou
        // deux grands étals plus fournis (HABITAT-010)
        var grand = o.hash(ox, 35, oz) < 0.5;
        var taille = grand ? 5 : 4;
        var toiles = [B.WOOL_RED, B.WOOL_YELLOW, B.WOOL_BLUE, B.WOOL_GREEN];
        var p = o.repere(ox, oz, L, L, rot);
        [[1, 1], [L - 1 - taille, 1], [1, L - 1 - taille], [L - 1 - taille, L - 1 - taille]].forEach(function (c, i) {
          for (var u = 0; u < taille; u++) for (var v = 0; v < taille; v++) {
            var q = p(c[0] + u, c[1] + v);
            if ((u === 0 || u === taille - 1) && (v === 0 || v === taille - 1)) for (var y = y0; y < y0 + 3; y++) o.pose(q[0], y, q[1], st.coin);
            o.pose(q[0], y0 + 3, q[1], toiles[i]);
            if (v === 1 && u > 0 && u < taille - 1) o.pose(q[0], y0, q[1], B.COMPTOIR);
          }
          var lan = p(c[0] + 1, c[1] + taille - 1); o.pose(lan[0], y0, lan[1], B.LANTERN);
        });
        var c0 = p(0, 0), c1 = p(L - 1, L - 1);
        var bat = { type: 'marche', nom: 'Marché', plan: grand ? 'grand' : 'petit', lieu: l.id,
                    x0: Math.min(c0[0], c1[0]), z0: Math.min(c0[1], c1[1]),
                    x1: Math.max(c0[0], c1[0]), z1: Math.max(c0[1], c1[1]), y0: y0, y1: y0 + 4,
                    porte: { x: p(Math.floor(L / 2), 0)[0], z: p(Math.floor(L / 2), 0)[1] } };
        l.batiments.push(bat);
        var m1 = p(2, 3), m2 = p(L - 3, L - 4);
        pnj(l, 'marchand_ambulant', m1[0] + 0.5, y0, m1[1] + 0.5, bat);
        pnj(l, 'marchand_ambulant', m2[0] + 0.5, y0, m2[1] + 0.5, bat);
      },
      /* SPEC-HABITAT-010 : deux plans — 'champ' (petite grange, grand champ)
         et 'grange' (grange plus vaste, champ réduit) — typiques de la
         campagne (villages/villes seulement : la ferme n'apparaît jamais en
         mégapole, voir programmeMegapole). */
      ferme: function (l, st, o, ox, oz, L, rot, y0) {
        var grange = o.hash(ox, 36, oz) < 0.5;
        var gw = grange ? Math.min(L - 2, 7) : 5, gd = grange ? 4 : 3;
        var champDebut = gd + 1;
        var p = o.repere(ox, oz, L, L, rot);
        for (var u = 0; u < L; u++) for (var v = 0; v < L - champDebut; v++) {
          var q = p(u, v + champDebut);
          if (u === Math.floor(L / 2)) { o.pose(q[0], y0 - 1, q[1], B.WATER); continue; }
          o.pose(q[0], y0 - 1, q[1], B.FARMLAND);
          o.pose(q[0], y0, q[1], (u + v) % 3 === 0 ? B.WHEAT2 : B.WHEAT3);
        }
        for (var gu = 0; gu < gw; gu++) for (var gv = 0; gv < gd; gv++) for (var y = y0; y < y0 + 3; y++) {
          var r = p(gu, gv);
          var bord = gu === 0 || gu === gw - 1 || gv === 0 || gv === gd - 1 || y === y0 + 2;
          o.pose(r[0], y, r[1], bord ? (y === y0 + 2 ? B.HAY : st.mur) : (y === y0 ? B.HAY : 0));
        }
        var porte = p(Math.min(2, gw - 1), 0), idPorteFerme = C.PORTE_FERMEE_LIST[(rot || 0) & 3];
        o.pose(porte[0], y0, porte[1], idPorteFerme); o.pose(porte[0], y0 + 1, porte[1], idPorteFerme);
        var lan = p(gw + 1, 1); o.pose(lan[0], y0, lan[1], B.LANTERN);
        var c0 = p(0, 0), c1 = p(L - 1, L - 1);
        var bat = { type: 'ferme', nom: 'Ferme', plan: grange ? 'grange' : 'champ', lieu: l.id,
                    x0: Math.min(c0[0], c1[0]), z0: Math.min(c0[1], c1[1]),
                    x1: Math.max(c0[0], c1[0]), z1: Math.max(c0[1], c1[1]), y0: y0, y1: y0 + 3,
                    porte: { x: porte[0], z: porte[1] } };
        l.batiments.push(bat);
        var f = p(gw, 2);
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
      /* la place centrale : dallée, un puits, des lampadaires aux quatre
         coins — deux plans (HABITAT-010) : un puits simple, ou un grand
         bassin entouré de quatre piliers supplémentaires. */
      place: function (l, st, o, ox, oz, L, rot, y0) {
        var bassin = o.hash(ox, 37, oz) < 0.5;
        var p = o.repere(ox, oz, L, L, rot), cx = Math.floor(L / 2);
        for (var u = 0; u < L; u++) for (var v = 0; v < L; v++) { var q = p(u, v); o.pose(q[0], y0 - 1, q[1], st.place); }
        var rEau = bassin ? 1.5 : 0.5;
        for (var du = -2; du <= 2; du++) for (var dv = -2; dv <= 2; dv++) {
          if (Math.hypot(du, dv) > rEau) continue;
          var w2 = p(cx + du, cx + dv);
          for (var yw = y0 - 4; yw < y0; yw++) o.pose(w2[0], yw, w2[1], B.WATER);
        }
        // piliers autour du point d'eau : au ras du bassin (large) ou du puits (simple)
        var rp = bassin ? 2 : 1;
        [[-rp, -rp], [rp, -rp], [-rp, rp], [rp, rp]].forEach(function (c) {
          var q2 = p(cx + c[0], cx + c[1]); o.pose(q2[0], y0 + 1, q2[1], st.coin); o.pose(q2[0], y0 + 2, q2[1], st.coin);
        });
        var lp = p(cx, cx - rp); o.pose(lp[0], y0 + 2, lp[1], B.LANTERN);
        [[0, 0], [L - 1, 0], [0, L - 1], [L - 1, L - 1]].forEach(function (c) { var q3 = p(c[0], c[1]); lampadaire(l, st, o, q3[0], y0, q3[1]); });
        var c0 = p(0, 0), c1 = p(L - 1, L - 1);
        l.batiments.push({ type: 'place', nom: 'Place de ' + l.nom, plan: bassin ? 'bassin' : 'puits', lieu: l.id,
                           x0: Math.min(c0[0], c1[0]), z0: Math.min(c0[1], c1[1]),
                           x1: Math.max(c0[0], c1[0]), z1: Math.max(c0[1], c1[1]), y0: y0, y1: y0 + 4,
                           porte: { x: p(cx, 0)[0], z: p(cx, 0)[1] } });
      },
      /* HABITAT-013 : le cœur de la mégapole — une tour, haute (gabarit
         borné par C.WORLD_H, sans jamais crever le plafond du monde), avec
         une échelle intérieure à chaque étage (fournie par `corps`, comme
         pour n'importe quel bâtiment à étages). SPEC-HABITAT-010 : deux
         plans — élancée (étroite, très haute) ou massive (large, moins
         d'étages) — plutôt qu'un seul gabarit répété partout. */
      tour: function (l, st, o, ox, oz, L, rot, y0) {
        var sb = {}, k; for (k in st) sb[k] = st[k];
        sb.mur = B.CHAUX; sb.forme = 'plat'; sb.toit = st.coin; sb.fenetre = B.GLASS;
        var elancee = o.hash(ox, 41, oz) < 0.5;
        var w = Math.min(elancee ? 9 : 13, L - 6), d = w;
        var maxEt = Math.max(1, Math.floor((WH - 8 - y0) / 4));
        var baseEt = elancee ? 12 : 7, spreadEt = elancee ? 14 : 8;
        var etages = Math.min(maxEt, baseEt + Math.floor(o.hash(ox, 42, oz) * spreadEt));
        var p = o.repere(ox + Math.floor((L - w) / 2), oz + 1, w, d, rot);
        var b = corps(l, sb, o, p, w, d, y0, etages, 'tour', null, rot);
        b.plan = elancee ? 'elancee' : 'massive';
        pnj(l, 'habitant', b.dedans.x, b.y0, b.dedans.z, b);
      },
      /* HABITAT-013 : un immeuble de logements — plus large et plus haut
         qu'une maison urbaine, mais bâti avec les mêmes outils (`corps`).
         SPEC-HABITAT-010 : une barre (longue, basse) ou un plot (carré,
         plus haut) selon le tirage. */
      immeuble: function (l, st, o, ox, oz, L, rot, y0) {
        var barre = o.hash(ox, 43, oz) < 0.5;
        var w = Math.min(barre ? 16 : 11, L - 6), d = Math.min(barre ? 12 : 11, L - 8);
        var etages = barre ? 3 + Math.floor(o.hash(ox, 44, oz) * 5) : 5 + Math.floor(o.hash(ox, 44, oz) * 6);
        var p = o.repere(ox + Math.floor((L - w) / 2), oz + 1, w, d, rot);
        var b = corps(l, st, o, p, w, d, y0, etages, 'immeuble', null, rot);
        b.plan = barre ? 'barre' : 'plot';
        pnj(l, 'habitant', b.dedans.x, b.y0, b.dedans.z, b);
      },
    };

    /* HABITAT-013/ROUTE-008 : un quai de planches, posé quand le lieu borde
       la mer ou un grand fleuve — cherché par un sondage tout autour de son
       emprise (peu coûteux : quelques dizaines d'appels à biomeDe/riviereDe,
       une seule fois par lieu). Rien n'est posé si aucune eau n'est trouvée. */
    function portSiCotier(l, st, o) {
      var trouve = null;
      for (var a = 0; a < 16 && !trouve; a++) {
        var ang = a * Math.PI / 8;
        var bx = l.x + Math.cos(ang) * (l.demi + 6), bz = l.z + Math.sin(ang) * (l.demi + 6);
        var b = biomeDe ? biomeDe(bx, bz) : null;
        var estEau = (b && b.marin) || (riviereDe && riviereDe(bx, bz) > 0.975);
        if (estEau) trouve = ang;
      }
      if (trouve === null) return;
      var dx = Math.cos(trouve), dz = Math.sin(trouve);
      var px = l.x + dx * l.demi, pz = l.z + dz * l.demi, y = l.h0;
      var x0 = px, z0 = pz, x1 = px, z1 = pz;
      for (var d2 = 0; d2 <= 14; d2++) {
        var x = Math.round(px + dx * d2), z = Math.round(pz + dz * d2);
        o.pose(x, y - 1, z, st.soubassement || B.LOG);
        o.pose(x, y, z, B.PLANKS);
        if (d2 % 4 === 0) o.pose(x, y + 1, z, B.LANTERN);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
      l.batiments.push({ type: 'port', nom: 'Port', lieu: l.id, x0: x0, z0: z0, x1: x1, z1: z1, y0: y, y1: y + 2,
                         porte: { x: Math.round(px), z: Math.round(pz) } });
    }

    // ─── plans ───────────────────────────────────────────────────────────────
    function melanger(liste, graine) {
      var l = liste.slice();
      for (var i = l.length - 1; i > 0; i--) {
        var j = Math.floor(N.hash2(graine * 31 + i, i * 17) * (i + 1));
        var t = l[i]; l[i] = l[j]; l[j] = t;
      }
      return l;
    }
    /* Le quartier d'une parcelle (SPEC-HABITAT-012), d'après son anneau `d`
       autour de la place (0 = place elle-même) et le rayon de la ville
       `milieu` : cœur commerçant, couronne résidentielle (seulement quand la
       ville est assez grande pour en avoir une), faubourgs agricoles au bord. */
    function quartierDe(d, milieu) {
      var dd = Math.round(d);
      if (dd <= 1) return 'centre';
      if (dd <= Math.max(1, milieu - 1)) return 'residentiel';
      return 'faubourgs';
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
        var bat = l.batiments[l.batiments.length - 1];
        if (bat) bat.quartier = quartierDe(lot.d, milieu);
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

    /* Programme d'une ville de taille `n` (SPEC-HABITAT-012) : le cœur
       commerçant (services) occupe toujours les parcelles les plus centrales
       — `grille` les distribue déjà de la plus proche à la plus excentrée —
       puis la couronne se remplit de logements et de fermes, en cyclant sur
       les artisans et loisirs restants pour ne jamais tarir la liste, quelle
       que soit la taille de la ville (petite : 3×3 : 8 parcelles — grande :
       7×7 : 48 parcelles). */
    function programmeVille(n, g, art, loi) {
      var total = n * n - 1;
      var coeur = melanger([['point_info'], ['banque'], ['salon'], ['magasin'], ['artisan', art[0]], ['artisan', art[1]],
                            ['marche'], ['loisirs', loi[0]]], g + 2);
      // le troisième artisan et les deux autres loisirs n'apparaissent qu'une
      // fois chacun, même dans une grande cité : au-delà, on ne fait plus que
      // des logements et des fermes (les faubourgs agricoles)
      var uneFois = [['artisan', art[2]], ['loisirs', loi[1]], ['loisirs', loi[2]], ['point_info'], ['salon'], ['magasin']];
      var extra = [];
      for (var i = 0; i < total - coeur.length; i++) {
        extra.push(i < uneFois.length ? uneFois[i] : (i % 3 === 0 ? ['ferme'] : ['maison']));
      }
      var periph = melanger(extra, g + 3);
      return coeur.concat(periph).slice(0, total);
    }
    /* Programme d'une mégapole (HABITAT-013) : un cœur de tours, une
       couronne d'immeubles largement parsemée de parcs — jamais la moindre
       maison individuelle ni ferme, contrairement à la ville. */
    function programmeMegapole(n, g) {
      var total = n * n - 1;
      var coeur = melanger([['tour'], ['tour'], ['tour'], ['tour'], ['tour'], ['tour'],
                            ['loisirs', 'parc'], ['loisirs', 'fontaine']], g + 2);
      var extra = [];
      for (var i = 0; i < total - coeur.length; i++) {
        extra.push(i % 6 === 0 ? ['loisirs', 'parc'] : ['immeuble']);
      }
      var periph = melanger(extra, g + 3);
      return coeur.concat(periph).slice(0, total);
    }
    var PLANS = {
      megapole: function (l, st, o, rx, rz) {
        var g = rx * 7 + rz * 13, n = l.lots || LIEUX.megapole.lots;
        var programme = programmeMegapole(n, g);
        var defTaille = { lots: n, pas: LIEUX.megapole.pas, lot: LIEUX.megapole.lot, marge: LIEUX.megapole.marge };
        grille(l, st, o, defTaille, programme, true);
        portSiCotier(l, st, o);
      },
      ville: function (l, st, o, rx, rz) {
        var g = rx * 7 + rz * 13, n = l.lots || LIEUX.ville.lots;
        var art = melanger(ARTISANS, g), loi = melanger(LOISIRS, g + 1);
        var programme = programmeVille(n, g, art, loi);
        var defTaille = { lots: n, pas: LIEUX.ville.pas, lot: LIEUX.ville.lot, marge: LIEUX.ville.marge };
        grille(l, st, o, defTaille, programme, true);
        portSiCotier(l, st, o);
      },
      village: function (l, st, o, rx, rz) {
        var g = rx * 11 + rz * 5;
        var art = ARTISANS[Math.floor(N.hash2(rx, rz + 3) * 3) % 3], loi = LOISIRS[Math.floor(N.hash2(rx + 5, rz) * 3) % 3];
        var prog = melanger([['point_info'], ['salon'], ['magasin'], ['artisan', art], ['ferme'], ['maison'],
                             ['loisirs', loi], ['marche']], g);
        grille(l, st, o, LIEUX.village, prog, false);
        portSiCotier(l, st, o);
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
    /* Les régions que `lieuxDansZone` consulte pour cette zone, dans le même
       ordre : [genre, rx, rz]. Sert à préparer les lieux d'une grande zone par
       petites étapes (serveur : `lieuDeRegion` une région à la fois, sous un
       budget de temps par tic) — les lieux construits sont les mêmes, en
       cache, que ceux qu'un appel direct aurait construits d'un coup. */
    function regionsDansZone(x0, z0, x1, z1) {
      var res = [];
      ORDRE_LIEUX.forEach(function (kind) {
        var R = LIEUX[kind].region, P = PORTEE[kind] + 12;
        var rx0 = Math.floor((x0 - P) / R), rx1 = Math.floor((x1 + P) / R);
        var rz0 = Math.floor((z0 - P) / R), rz1 = Math.floor((z1 + P) / R);
        for (var rx = rx0; rx <= rx1; rx++) for (var rz = rz0; rz <= rz1; rz++) res.push([kind, rx, rz]);
      });
      return res;
    }
    /* `lire(genre, rx, rz)` (facultatif) remplace lieuDeRegion : le serveur y passe
       ses lieux déjà préparés par étapes (MC.TravauxServeur.creerCycleLieux), pour
       que l'entretien du monde ne reconstruise rien d'un coup. Même résultat. */
    function lieuxDansZone(x0, z0, x1, z1, lire) {
      var res = [];
      var lireRegion = lire || lieuDeRegion;
      ORDRE_LIEUX.forEach(function (kind) {
        var R = LIEUX[kind].region, P = PORTEE[kind] + 12;
        var rx0 = Math.floor((x0 - P) / R), rx1 = Math.floor((x1 + P) / R);
        var rz0 = Math.floor((z0 - P) / R), rz1 = Math.floor((z1 + P) / R);
        for (var rx = rx0; rx <= rx1; rx++) for (var rz = rz0; rz <= rz1; rz++) {
          var l = lireRegion(kind, rx, rz);
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
       plateforme (le dessus dégagé des arbres et des bosses pour bâtir),
       puis les bâtiments.
       SPEC-HABITAT-009 : la plateforme n'est plus arasée à une profondeur
       fixe — la fondation part du terrain réel jusqu'au niveau de la place,
       un pilier de soutien qui s'allonge sur la pente (fondation profonde,
       ou pilotis en creux) plutôt qu'un socle identique partout, qu'il y ait
       ou non un dénivelé à combler en dessous. */
    function appliquer(cx, cz, put) {
      var x0 = cx * CX, z0 = cz * CZ, x1 = x0 + CX - 1, z1 = z0 + CZ - 1, n = 0;
      lieuxDansZone(x0, z0, x1, z1).forEach(function (l) {
        var p = l.plateforme;
        var ax = Math.max(x0, p.x0), bx = Math.min(x1, p.x1), az = Math.max(z0, p.z0), bz = Math.min(z1, p.z1);
        for (var x = ax; x <= bx; x++) for (var z = az; z <= bz; z++) {
          var hNat = Math.max(1, Math.min(WH - 14, hauteur(x, z)));
          var base = Math.max(1, Math.min(hNat, p.h0 - 1) - 2);
          for (var y = base; y < p.h0; y++) put(x, y, z, y >= p.h0 - 3 ? p.sousSol : B.STONE);
          put(x, p.h0, z, surfaceEn(l, x, z));
          for (var y2 = p.h0 + 1; y2 < Math.min(WH, p.h0 + 32); y2++) put(x, y2, z, 0);
          n++;
        }
        var a = l.blocs.get(cx + ',' + cz);
        if (a) for (var i = 0; i < a.length; i += 5) { put(a[i], a[i + 1], a[i + 2], a[i + 3], a[i + 4]); n++; }
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
    function lieuxProches(x, z, rayon, lire) {
      return lieuxDansZone(x - rayon, z - rayon, x + rayon, z + rayon, lire)
        .map(function (l) { return { lieu: l, d: Math.hypot(l.x - x, l.z - z) }; })
        .filter(function (e2) { return e2.d <= rayon; })
        .sort(function (a, b) { return a.d - b.d; })
        .map(function (e2) { return e2.lieu; });
    }

    /* Pour les tests (SPEC-SAVE-021 : balayage de tous les états posés par la
       génération) : bâtir un lieu d'un genre et d'un style imposés, sans
       passer par les filtres de terrain, de biome et de répartition — le
       lieu n'entre dans aucun cache et n'apparaît jamais en jeu. Même
       emplacement, même taille et mêmes tirages que `construire`. */
    function batirPourEssai(kind, styleCle, urbain, rx, rz) {
      var def = LIEUX[kind], R = def.region;
      var graineK = kind === 'ville' ? 7 : kind === 'village' ? 13 : kind === 'megapole' ? 41 : 29;
      var lotsN = kind === 'ville' ? tailleVille(rx, rz) : def.lots;
      var demi = Math.floor((lotsN * def.pas) / 2) + def.marge, m = demi + 8;
      var x = rx * R + m + Math.floor(N.hash2(rx * 131 + graineK, rz * 977) * (R - 2 * m));
      var z = rz * R + m + Math.floor(N.hash2(rx * 419, rz * 263 + graineK) * (R - 2 * m));
      return fabriquer(kind, rx, rz, x, z, demi, 64, 0, lotsN, { id: styleCle }, stylePour(styleCle, urbain), graineK);
    }
    /* Un seul bâtiment (`BATISSEURS[type]`) sur une parcelle de côté L, avec
       une orientation et une variante (`sous` : artisan, loisirs) imposées. */
    function batirBatimentPourEssai(type, styleCle, urbain, rot, sous, ox, oz, L) {
      var st = stylePour(styleCle, urbain);
      var l = { id: 'essai:' + type, kind: 'essai', nom: 'Essai', biome: styleCle, style: st.nom, x: ox, z: oz, demi: L,
                h0: 64, denivele: 0, lots: 1, batiments: [], pnjs: [], lampes: 0, blocs: new Map(),
                plateforme: { x0: ox, z0: oz, x1: ox + L, z1: oz + L, h0: 64, surface: B.GRASS, sousSol: B.DIRT, routes: [] } };
      BATISSEURS[type](l, st, outilsPour(l, st), ox, oz, L, rot, 65, urbain, sous);
      return l;
    }

    return { lieuDeRegion: lieuDeRegion, lieuEnCache: lieuEnCache, lieuxDansZone: lieuxDansZone, regionsDansZone: regionsDansZone, appliquer: appliquer, lieuA: lieuA,
             batimentA: batimentA, lieuxProches: lieuxProches, surfaceEn: surfaceEn,
             batirPourEssai: batirPourEssai, batirBatimentPourEssai: batirBatimentPourEssai };
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
  // une journée de jeu (SPEC-SAISON-001 : 1200 s) ; MC.DayCycle n'est pas
  // garanti chargé avant ce module, d'où la valeur de repli littérale.
  var DELAI_REMPLACEMENT = (typeof MC !== 'undefined' && MC.DayCycle && MC.DayCycle.DAY_LENGTH) || 1200;
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
        /* SPEC-TRANSPORT-002 : un véhicule avarié (collision) se répare ici
           en priorité, si le joueur est actuellement à son bord — sinon,
           comportement inchangé (l'outil en main, METIER-002). */
        if (ctx.vehicule && MC.Vehicules && ctx.vehicule.avarie) {
          var coutV = MC.Vehicules.coutReparation(ctx.vehicule);
          if (!payer(coutV)) return { ok: false, message: 'La réparation du véhicule coûte ' + coutV + ' émeraude' + (coutV > 1 ? 's' : '') + '.' };
          MC.Vehicules.reparer(ctx.vehicule);
          return { ok: true, message: 'Véhicule réparé : comme neuf.' };
        }
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

  // ─── catastrophes environnementales (SPEC-ENV-001/004, SPEC-QUETE-003) ────
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  /* Hachage déterministe indépendant de MC.Noise, comme volcanisme.js:hache —
     ces fonctions n'ont pas accès au bruit du monde (elles agissent après
     coup sur un lieu déjà construit), seulement à la graine du monde. */
  function hacheEnv(a, b, c, d) {
    var h = Math.imul((a | 0) + 1, 2654435761) ^ Math.imul((b | 0) + 1, 2246822519) ^
            Math.imul((c | 0) + 1, 3266489917) ^ Math.imul((d | 0) + 1, 668265263);
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h ^= h >>> 13;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* SPEC-ENV-001 : une tornade (NUAGE-004) ou un cyclone (NUAGE-003) qui
     traverse un lieu habité endommage 5 à 20 % de ses bâtiments — des blocs
     RETIRÉS (mis à l'air), STRICTEMENT parmi ceux qui tombent sur le tracé
     réel de l'événement (jamais ailleurs dans le lieu). `trace` : une suite
     de points `{x, z, rayon, force}` (la trajectoire échantillonnée, par
     exemple depuis `MC.Meteo.tornades`/`cyclones` — force la plus forte du
     passage fixe l'intensité). Déterministe : même lieu, même tracé, même
     graine ⇒ mêmes blocs endommagés, sur tous les postes. Journalise
     l'événement dans `l.catastrophes` (SPEC-QUETE-003). */
  var FRACTION_DEGATS_MIN = 0.05, FRACTION_DEGATS_MAX = 0.20;
  function endommagerLieu(l, trace, graine, heure, type) {
    if (!l || !trace || !trace.length) return null;
    var candidats = [];
    l.blocs.forEach(function (arr, cle) {
      for (var i = 0; i < arr.length; i += 5) {
        if (!arr[i + 3]) continue;               // déjà de l'air : rien à endommager
        var x = arr[i], z = arr[i + 2], touche = false;
        for (var t = 0; t < trace.length && !touche; t++) {
          var p = trace[t];
          if (Math.hypot(x - p.x, z - p.z) <= (p.rayon || 6)) touche = true;
        }
        if (touche) candidats.push({ cle: cle, i: i, x: x, z: z });
      }
    });
    var total = 0; l.blocs.forEach(function (arr) { total += arr.length / 5; });
    var intensite = clamp01(trace.reduce(function (m, p) { return Math.max(m, p.force !== undefined ? p.force : 0.5); }, 0));
    var fraction = FRACTION_DEGATS_MIN + (FRACTION_DEGATS_MAX - FRACTION_DEGATS_MIN) * intensite;
    if (!candidats.length || !total) {
      var vide = { lieu: l.id, heure: heure || 0, ampleur: 0, blocs: 0, type: type || 'tornade' };
      l.catastrophes = l.catastrophes || []; l.catastrophes.push(vide);
      return vide;
    }
    candidats.forEach(function (c, idx) { c.h = hacheEnv(graine, c.x, c.z, idx); });
    candidats.sort(function (a, b) { return a.h - b.h; });
    // AUCUN plancher à 1, et Math.floor (jamais round) : un lieu trop petit
    // pour qu'un seul bloc endommagé reste sous 20 % de son total ne subit
    // AUCUN dégât plutôt que d'en subir un qui dépasserait largement la borne
    // haute (revue adversariale — round(0.6)=1=33 % d'un lieu de 3 blocs).
    // `cible / total` reste ainsi TOUJOURS ≤ fraction ≤ FRACTION_DEGATS_MAX.
    var cible = Math.min(candidats.length, Math.floor(total * fraction));
    for (var k = 0; k < cible; k++) {
      var arr2 = l.blocs.get(candidats[k].cle);
      arr2[candidats[k].i + 3] = 0; arr2[candidats[k].i + 4] = 0;
    }
    var entry = { lieu: l.id, heure: heure || 0, ampleur: cible ? cible / total : 0, blocs: cible, type: type || 'tornade' };
    l.catastrophes = l.catastrophes || [];
    l.catastrophes.push(entry);
    if (l.catastrophes.length > 20) l.catastrophes.shift();
    return entry;
  }

  /* SPEC-ENV-004 : une éruption ou une tornade qui détruit des cultures d'un
     lieu habité fait migrer 10 à 30 % de ses habitants (proportionnellement à
     `gravite`, 0..1) vers un AUTRE lieu habité viable (choisi par l'appelant,
     typiquement le plus proche via `lieuxProches`) — réduit durablement la
     population de `source` (POP-002 reprend ensuite le repeuplement progressif
     via `pnjsManquants`), augmente d'autant celle de `dest`. Ne change jamais
     la capacité d'un lieu (le nombre de postes définis à sa construction),
     seulement qui les occupe. */
  var MIGRATION_MIN = 0.10, MIGRATION_MAX = 0.30;
  function migrerPopulation(source, dest, gravite, graine) {
    if (!source || !dest || !source.pnjs || !source.pnjs.length) return { migres: 0 };
    var fraction = MIGRATION_MIN + (MIGRATION_MAX - MIGRATION_MIN) * clamp01(gravite);
    // AUCUN plancher à 1, et Math.floor (jamais round/max) : un lieu trop
    // petit pour qu'un seul migrant reste sous 30 % de sa population ne perd
    // personne plutôt que de dépasser largement la borne haute (même
    // principe que endommagerLieu — revue adversariale : round/max(1, …)
    // ferait migrer 100 % d'un lieu d'un seul habitant, ou 33 % d'un lieu de
    // trois, très au-delà de 10-30 %). Atteignable en jeu réel : une
    // habitation isolée (LIEUX.maison, lots: 1) ne compte souvent qu'un ou
    // deux habitants.
    var n = Math.min(source.pnjs.length, Math.floor(source.pnjs.length * fraction));
    if (!n) return { migres: 0, sourceId: source.id, versId: dest.id };
    var candidats = source.pnjs.map(function (p, idx) { return { p: p, h: hacheEnv(graine, idx, source.pnjs.length, 11) }; });
    candidats.sort(function (a, b) { return a.h - b.h; });
    var partants = candidats.slice(0, n).map(function (c) { return c.p; });
    var idsPartants = {};
    partants.forEach(function (p) { idsPartants[p.id] = true; });
    source.pnjs = source.pnjs.filter(function (p) { return !idsPartants[p.id]; });
    partants.forEach(function (p) {
      var np = {}, k; for (k in p) np[k] = p[k];
      np.lieu = dest.id;
      dest.pnjs.push(np);
    });
    return { migres: partants.length, sourceId: source.id, versId: dest.id };
  }

  /* SPEC-QUETE-003 : une catastrophe qui endommage un lieu habité (ENV-001)
     génère une quête de reconstruction (dégâts francs) ou de secours (dégâts
     légers), proposée par ce lieu, limitée dans le temps, avec une
     récompense proportionnée aux dégâts mesurés (`entry.blocs`, le journal
     renvoyé par `endommagerLieu`). `MC.Politique.recompenseReelle` (type
     'reconstruction'/'secours') affine cette estimation au moment de la
     remise, si l'appelant le souhaite — cette fonction-ci ne fait que
     proposer, comme `MC.Politique.questesDe`. */
  var DUREE_QUETE_CATASTROPHE = 3 * DELAI_REMPLACEMENT;   // trois jours de jeu
  function queteCatastrophe(l, entry) {
    if (!l || !entry || !entry.blocs) return null;
    var grave = entry.ampleur > 0.12;
    var libelleType = entry.type === 'eruption' ? 'une éruption' : entry.type === 'cyclone' ? 'un cyclone' : 'une tornade';
    return {
      id: l.id + ':catastrophe:' + Math.round(entry.heure), lieu: l.id, x: l.x, z: l.z,
      type: grave ? 'reconstruction' : 'secours',
      titre: l.nom + (grave ? ' demande de l\'aide pour se reconstruire après ' : ' a besoin de secours après ') + libelleType + '.',
      degats: entry.blocs, ampleur: entry.ampleur, depuis: entry.heure, expire: entry.heure + DUREE_QUETE_CATASTROPHE,
      recompense: Math.max(3, Math.round(entry.blocs * 0.5)),
    };
  }
  function queteActive(q, heure) { return !!q && heure >= q.depuis && heure < q.expire; }

  MC.Habitats = { STYLES: STYLES, URBAIN: URBAIN, LIEUX: LIEUX, BATIMENTS: BATIMENTS, ROLES: ROLES,
                  ARTISANS: ARTISANS, LOISIRS: LOISIRS, ORDRE_LIEUX: ORDRE_LIEUX,
                  stylePour: stylePour, creer: creer, pnjsManquants: pnjsManquants, servir: servir,
                  DELAI_REMPLACEMENT: DELAI_REMPLACEMENT,
                  RAYON_INFO: RAYON_INFO,
                  // SPEC-ENV-001/004, SPEC-QUETE-003
                  endommagerLieu: endommagerLieu, migrerPopulation: migrerPopulation,
                  queteCatastrophe: queteCatastrophe, queteActive: queteActive,
                  FRACTION_DEGATS_MIN: FRACTION_DEGATS_MIN, FRACTION_DEGATS_MAX: FRACTION_DEGATS_MAX,
                  MIGRATION_MIN: MIGRATION_MIN, MIGRATION_MAX: MIGRATION_MAX };
})(typeof globalThis !== 'undefined' ? globalThis : this);
