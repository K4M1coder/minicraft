/* inventory.js — piles, inventaire, et moteur de craft (façonné + informe).
   Logique pure, entièrement testable hors navigateur. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var B = C.B, I = C.I;

  var HOTBAR_SIZE = 9, MAIN_SIZE = 27, TOTAL = HOTBAR_SIZE + MAIN_SIZE;

  function createInventory(size) {
    var slots = new Array(size || TOTAL).fill(null);

    function stackAt(i) { return slots[i]; }

    /* Ajoute n exemplaires de `id`. Remplit d'abord les piles existantes, puis
       les cases vides. Renvoie le reliquat non casé (0 si tout est rentré). */
    function add(id, n) {
      if (!id || n <= 0) return 0;
      var max = C.maxStack(id);
      for (var i = 0; i < slots.length && n > 0; i++) {
        var s = slots[i];
        if (s && s.id === id && s.n < max) {
          var can = Math.min(max - s.n, n);
          s.n += can; n -= can;
        }
      }
      for (var j = 0; j < slots.length && n > 0; j++) {
        if (!slots[j]) {
          var take = Math.min(max, n);
          slots[j] = { id: id, n: take }; n -= take;
        }
      }
      return n;
    }

    function count(id) {
      var t = 0;
      for (var i = 0; i < slots.length; i++) if (slots[i] && slots[i].id === id) t += slots[i].n;
      return t;
    }

    /* Retire n exemplaires. Renvoie le nombre réellement retiré. */
    function remove(id, n) {
      var removed = 0;
      for (var i = 0; i < slots.length && removed < n; i++) {
        var s = slots[i];
        if (!s || s.id !== id) continue;
        var take = Math.min(s.n, n - removed);
        s.n -= take; removed += take;
        if (s.n === 0) slots[i] = null;
      }
      return removed;
    }

    // retire 1 exemplaire d'une case précise (consommation d'un outil, d'un aliment)
    function consumeAt(i, n) {
      var s = slots[i];
      if (!s) return 0;
      var take = Math.min(s.n, n === undefined ? 1 : n);
      s.n -= take;
      if (s.n <= 0) slots[i] = null;
      return take;
    }

    function setAt(i, stack) { slots[i] = stack || null; }

    /* Use un outil d'un point. Renvoie 'broken' si l'outil casse, 'used' s'il
       s'use, null s'il n'est pas usable. La pile porte son propre compteur
       `dmg` : chaque outil etant une pile de 1, il n'y a pas d'ambiguite. */
    function wearTool(i) {
      var st = slots[i];
      if (!st) return null;
      var max = C.durabilityOf(st.id);
      if (!max) return null;
      st.dmg = (st.dmg || 0) + 1;
      if (st.dmg >= max) { slots[i] = null; return 'broken'; }
      return 'used';
    }
    function isEmpty() { return slots.every(function (s) { return !s; }); }
    function firstEmpty() {
      for (var i = 0; i < slots.length; i++) if (!slots[i]) return i;
      return -1;
    }
    // le 3e champ (usure) n'est ecrit que s'il existe : les anciennes
    // sauvegardes a deux champs restent lisibles
    function serialize() {
      return slots.map(function (s) {
        if (!s) return 0;
        return s.dmg ? [s.id, s.n, s.dmg] : [s.id, s.n];
      });
    }
    function load(data) {
      for (var i = 0; i < slots.length; i++) {
        var d = data && data[i];
        if (d && d[0]) {
          slots[i] = { id: d[0], n: d[1] };
          if (d[2]) slots[i].dmg = d[2];
        } else slots[i] = null;
      }
    }

    return {
      slots: slots, size: slots.length, stackAt: stackAt, add: add, count: count,
      remove: remove, consumeAt: consumeAt, setAt: setAt, isEmpty: isEmpty,
      wearTool: wearTool,
      firstEmpty: firstEmpty, serialize: serialize, load: load,
    };
  }

  // ─── recettes ──────────────────────────────────────────────────────────────
  // Façonnée : `pattern` (lignes de caractères) + `keys`. ' ' = case vide.
  // Informe : `ingredients` (liste d'ids, ordre indifférent).
  var RECIPES = [];
  function shaped(out, n, pattern, keys) {
    RECIPES.push({ type: 'shaped', out: out, n: n, pattern: pattern, keys: keys,
                   w: pattern[0].length, h: pattern.length });
  }
  function shapeless(out, n, ingredients) {
    RECIPES.push({ type: 'shapeless', out: out, n: n, ingredients: ingredients });
  }

  shapeless(B.PLANKS, 4, [B.LOG]);
  // toutes les essences donnent les mêmes planches : une seule famille de bois
  shapeless(B.PLANKS, 4, [B.BIRCH_LOG]);
  shapeless(B.PLANKS, 4, [B.SPRUCE_LOG]);
  // le 2×2 de sable donne déjà du verre : le grès prend trois sables, en vrac
  shapeless(B.SANDSTONE, 2, [B.SAND, B.SAND, B.SAND]);
  shaped(B.STONE_BRICK, 4, ['SS', 'SS'], { S: B.STONE });
  shapeless(B.PLANKS, 4, [B.JUNGLE_LOG]);
  shapeless(B.PLANKS, 4, [B.ACACIA_LOG]);

  // ─── construction ─────────────────────────────────────────────────────────
  shaped(B.LADDER, 3, ['S S', 'SSS', 'S S'], { S: I.STICK });
  shaped(B.SANDSTONE_BRICK, 4, ['GG', 'GG'], { G: B.SANDSTONE });
  shaped(B.PACKED_ICE, 1, ['III', 'III', 'III'], { I: B.ICE });
  shaped(B.ICE_BRICK, 4, ['II', 'II'], { I: B.PACKED_ICE });
  shaped(B.BOOKSHELF, 1, ['PPP', 'WWW', 'PPP'], { P: B.PLANKS, W: B.WOOL });
  shaped(B.HAY, 1, ['WWW', 'WWW', 'WWW'], { W: I.WHEAT });
  shapeless(I.WHEAT, 9, [B.HAY]);
  shaped(B.GOLD_BLOCK, 1, ['GGG', 'GGG', 'GGG'], { G: I.GOLD_INGOT });
  shapeless(I.GOLD_INGOT, 9, [B.GOLD_BLOCK]);
  shaped(B.RAIL, 8, ['I I', 'ISI', 'I I'], { I: I.IRON_INGOT, S: I.STICK });
  shaped(B.LANTERN, 1, [' I ', 'ITI', ' I '], { I: I.IRON_INGOT, T: B.TORCH });
  shaped(B.PRISMARINE, 1, ['SS', 'SS'], { S: I.PRISMARINE_SHARD });
  shaped(B.PRISMARINE_BRICK, 1, ['SSS', 'SSS', 'SSS'], { S: I.PRISMARINE_SHARD });
  shaped(B.SEA_LANTERN, 1, ['S S', ' T ', 'S S'], { S: I.PRISMARINE_SHARD, T: B.TORCH });
  shaped(B.COBWEB, 1, ['F F', ' F ', 'F F'], { F: I.FICELLE });
  shapeless(B.MOSSY_COBBLE, 1, [B.COBBLE, B.VINES]);
  // teintures : fleurs, coraux et laine
  shapeless(I.DYE_RED, 2, [B.FLOWER_RED]);
  shapeless(I.DYE_YELLOW, 2, [B.FLOWER_YELLOW]);
  shapeless(I.DYE_BLUE, 2, [B.CORAL_BLUE]);
  shapeless(B.WOOL_RED, 1, [B.WOOL, I.DYE_RED]);
  shapeless(B.WOOL_BLUE, 1, [B.WOOL, I.DYE_BLUE]);
  shapeless(B.WOOL_YELLOW, 1, [B.WOOL, I.DYE_YELLOW]);
  shapeless(B.WOOL_GREEN, 1, [B.WOOL, I.DYE_GREEN]);
  shapeless(B.TERRACOTTA_RED, 1, [B.TERRACOTTA, I.DYE_RED]);
  shapeless(B.TERRACOTTA_YELLOW, 1, [B.TERRACOTTA, I.DYE_YELLOW]);

  // ─── cuisine et agriculture ───────────────────────────────────────────────
  shaped(I.BOWL, 4, ['P P', ' P '], { P: B.PLANKS });
  shapeless(I.MUSHROOM_STEW, 1, [B.MUSHROOM, B.MUSHROOM, I.BOWL]);
  shaped(I.GOLDEN_APPLE, 1, ['GGG', 'GAG', 'GGG'], { G: I.GOLD_INGOT, A: I.APPLE });
  shapeless(I.BONE_MEAL, 3, [I.BONE]);
  shapeless(I.MELON_SLICE, 9, [B.MELON]);

  // ─── armes ────────────────────────────────────────────────────────────────
  shaped(I.ARBALETE, 1, ['SIS', 'F F', ' S '], { S: I.STICK, I: I.IRON_INGOT, F: I.FICELLE });
  shaped(I.FLECHE, 8, ['I', 'S', 'P'], { I: I.IRON_INGOT, S: I.STICK, P: I.FEATHER });

  // ─── véhicules ────────────────────────────────────────────────────────────
  shaped(I.ROUE, 2, [' P ', 'PIP', ' P '], { P: B.PLANKS, I: I.IRON_INGOT });
  shaped(I.MOTEUR, 1, ['III', 'ICI', 'III'], { I: I.IRON_INGOT, C: I.COAL });
  shaped(I.HELICE, 1, ['P P', ' I ', 'P P'], { P: B.PLANKS, I: I.IRON_INGOT });
  shaped(I.BATEAU, 1, ['P P', 'PPP'], { P: B.PLANKS });
  shaped(I.MOTO, 1, [' I ', 'RMR'], { I: I.IRON_INGOT, R: I.ROUE, M: I.MOTEUR });
  shaped(I.VOITURE, 1, ['III', 'RMR'], { I: I.IRON_INGOT, R: I.ROUE, M: I.MOTEUR });
  shaped(I.CAMION, 1, ['IIK', 'IIM', 'RRR'], { I: I.IRON_INGOT, K: B.CHEST, M: I.MOTEUR, R: I.ROUE });
  shaped(I.AVION, 1, [' H ', 'IMI', 'I I'], { H: I.HELICE, I: I.IRON_INGOT, M: I.MOTEUR });
  shaped(I.WAGONNET, 1, ['I I', 'III'], { I: I.IRON_INGOT });
  // pas de papier dans ce monde : une carte de laine tendue sur un cadre de bois
  shaped(I.CARTE, 1, ['SSS', 'SWS', 'SSS'], { S: I.STICK, W: B.WOOL });
  // habitations : deux troncs d'une essence donnent ses planches ; elles se refondent en planches communes
  shaped(B.PLANCHES_SAPIN, 8, ['LL'], { L: B.SPRUCE_LOG });
  shaped(B.PLANCHES_BOULEAU, 8, ['LL'], { L: B.BIRCH_LOG });
  shaped(B.PLANCHES_ACACIA, 8, ['LL'], { L: B.ACACIA_LOG });
  shaped(B.PLANCHES_JUNGLE, 8, ['LL'], { L: B.JUNGLE_LOG });
  shapeless(B.PLANKS, 1, [B.PLANCHES_SAPIN]);
  shapeless(B.PLANKS, 1, [B.PLANCHES_BOULEAU]);
  shapeless(B.PLANKS, 1, [B.PLANCHES_ACACIA]);
  shapeless(B.PLANKS, 1, [B.PLANCHES_JUNGLE]);
  shaped(B.TUILES, 4, ['TT', 'TT'], { T: B.TERRACOTTA_RED });
  shaped(B.ARDOISE, 4, ['SC', 'CS'], { S: B.STONE, C: I.COAL });
  shaped(B.CHAUX, 4, ['SB', 'BS'], { S: B.SAND, B: I.BONE_MEAL });
  shaped(B.PAVE, 4, ['GG', 'GG'], { G: B.GRAVEL });
  shaped(B.COMPTOIR, 2, ['PPP', 'C C'], { P: B.PLANKS, C: B.COBBLE });
  shaped(B.COFFRE_FORT, 1, ['III', 'ICI', 'III'], { I: I.IRON_INGOT, C: B.CHEST });
  shaped(B.TONNEAU, 1, ['PSP', 'P P', 'PSP'], { P: B.PLANKS, S: I.STICK });
  shaped(B.ENCLUME, 1, ['III', ' I ', 'III'], { I: I.IRON_INGOT });
  shaped(B.PANNEAU_INFO, 1, ['PPP', 'PPP', ' S '], { P: B.PLANKS, S: I.STICK });
  shaped(I.SEAU, 1, ['I I', ' I '], { I: I.IRON_INGOT });
  // porte : 2 colonnes × 3 planches. trappe : 2 rangées × 3 planches.
  shaped(I.PORTE, 1, ['PP', 'PP', 'PP'], { P: B.PLANKS });
  shaped(I.TRAPPE, 1, ['PPP', 'PPP'], { P: B.PLANKS });
  shaped(I.SOUS_MARIN, 1, ['GIG', 'IMI', 'III'], { G: B.GLASS, I: I.IRON_INGOT, M: I.MOTEUR });
  shaped(I.STICK, 4, ['P', 'P'], { P: B.PLANKS });
  shaped(B.CRAFTING_TABLE, 1, ['PP', 'PP'], { P: B.PLANKS });
  shaped(B.FURNACE, 1, ['CCC', 'C C', 'CCC'], { C: B.COBBLE });
  shaped(B.BRICK, 1, ['CC', 'CC'], { C: B.COBBLE });
  shaped(B.GLASS, 1, ['SS', 'SS'], { S: B.SAND });
  shapeless(I.BREAD, 1, [I.WHEAT, I.WHEAT, I.WHEAT]);
  shaped(B.TORCH, 4, ['C', 'S'], { C: I.COAL, S: I.STICK });
  shaped(B.CHEST, 1, ['PPP', 'P P', 'PPP'], { P: B.PLANKS });
  shapeless(I.FICELLE, 4, [B.WOOL]);
  shaped(I.ARC, 1, [' SF', 'B F', ' SF'], { S: I.STICK, B: I.STICK, F: I.FICELLE });
  shaped(I.FLECHE, 4, ['S', 'F'], { S: I.STICK, F: I.FICELLE });

  // ─── minerais (SPEC-MINERAI-002) : lingots, alliage, outils et objets ─────
  shapeless(I.BRONZE_LINGOT, 1, [I.CUIVRE_LINGOT, I.ETAIN_LINGOT]);
  var MAT_BRONZE = I.BRONZE_LINGOT;
  shaped(I.BRONZE_PIOCHE, 1, ['MMM', ' S ', ' S '], { M: MAT_BRONZE, S: I.STICK });
  shaped(I.BRONZE_HACHE, 1, ['MM', 'MS', ' S'], { M: MAT_BRONZE, S: I.STICK });
  shaped(I.BRONZE_PELLE, 1, ['M', 'S', 'S'], { M: MAT_BRONZE, S: I.STICK });
  shaped(I.BRONZE_EPEE, 1, ['M', 'M', 'S'], { M: MAT_BRONZE, S: I.STICK });
  // le lapis se broie en teinture bleue, comme un colorant minéral
  shapeless(I.DYE_BLUE, 4, [I.LAPIS]);
  // le sel, mêlé au sable, donne un enduit à la chaux plus résistant
  shapeless(B.CHAUX, 4, [B.SAND, B.SAND, B.SEL]);
  // arbalète légère, sans fer : la pointe de quartz remplace la mécanique
  shaped(I.ARBALETE, 1, ['SQS', 'F F', ' S '], { S: I.STICK, Q: I.QUARTZ, F: I.FICELLE });
  // le soufre brûle : une torche qui n'a pas besoin de charbon
  shaped(B.TORCH, 4, ['U', 'S'], { U: I.SOUFRE, S: I.STICK });
  // bijou : une gemme sertie dans l'argent, un objet de commerce et de prestige
  shapeless(I.BIJOU, 1, [I.ARGENT_LINGOT, I.RUBIS]);
  shapeless(I.BIJOU, 1, [I.ARGENT_LINGOT, I.SAPHIR]);
  shapeless(I.BIJOU, 1, [I.ARGENT_LINGOT, I.EMERALD]);

  // ─── L24 matériaux (SPEC-CONSTR-005/006/007) ──────────────────────────────
  // teintures manquantes : encre de calmar (noir), poudre d'os (blanc), charbon (gris)
  shapeless(I.DYE_BLACK, 2, [I.INK_SAC]);
  shapeless(I.DYE_WHITE, 2, [I.BONE_MEAL]);
  shapeless(I.DYE_GRAY, 2, [I.COAL]);
  // verre teinté : une teinture + du verre
  var TEINTES_DYE = [
    [B.VERRE_ROUGE, I.DYE_RED], [B.VERRE_JAUNE, I.DYE_YELLOW], [B.VERRE_BLEU, I.DYE_BLUE],
    [B.VERRE_VERT, I.DYE_GREEN], [B.VERRE_NOIR, I.DYE_BLACK], [B.VERRE_BLANC, I.DYE_WHITE],
    [B.VERRE_GRIS, I.DYE_GRAY],
  ];
  TEINTES_DYE.forEach(function (t) { shapeless(t[0], 8, [B.GLASS, B.GLASS, B.GLASS, B.GLASS,
    B.GLASS, B.GLASS, B.GLASS, B.GLASS, t[1]]); });
  // béton en poudre : sable + gravier + teinture ; il durcit au contact d'un seau d'eau
  var BETON_POUDRE_DYE = [
    [B.BETON_POUDRE_ROUGE, I.DYE_RED], [B.BETON_POUDRE_JAUNE, I.DYE_YELLOW], [B.BETON_POUDRE_BLEU, I.DYE_BLUE],
    [B.BETON_POUDRE_VERT, I.DYE_GREEN], [B.BETON_POUDRE_NOIR, I.DYE_BLACK], [B.BETON_POUDRE_BLANC, I.DYE_WHITE],
    [B.BETON_POUDRE_GRIS, I.DYE_GRAY],
  ];
  var BETON_DURCI = [
    [B.BETON_ROUGE, B.BETON_POUDRE_ROUGE], [B.BETON_JAUNE, B.BETON_POUDRE_JAUNE], [B.BETON_BLEU, B.BETON_POUDRE_BLEU],
    [B.BETON_VERT, B.BETON_POUDRE_VERT], [B.BETON_NOIR, B.BETON_POUDRE_NOIR], [B.BETON_BLANC, B.BETON_POUDRE_BLANC],
    [B.BETON_GRIS, B.BETON_POUDRE_GRIS],
  ];
  BETON_POUDRE_DYE.forEach(function (t) { shapeless(t[0], 8, [B.SAND, B.SAND, B.SAND, B.SAND,
    B.GRAVEL, B.GRAVEL, B.GRAVEL, B.GRAVEL, t[1]]); });
  BETON_DURCI.forEach(function (t) { shapeless(t[0], 4, [t[1], t[1], t[1], t[1], I.SEAU_EAU]); });
  // laine et terre cuite : les teintes manquantes (rouge/jaune existaient déjà)
  shapeless(B.WOOL_BLACK, 1, [B.WOOL, I.DYE_BLACK]);
  shapeless(B.WOOL_WHITE, 1, [B.WOOL, I.DYE_WHITE]);
  shapeless(B.WOOL_GRAY, 1, [B.WOOL, I.DYE_GRAY]);
  shapeless(B.TERRACOTTA_BLUE, 1, [B.TERRACOTTA, I.DYE_BLUE]);
  shapeless(B.TERRACOTTA_GREEN, 1, [B.TERRACOTTA, I.DYE_GREEN]);
  shapeless(B.TERRACOTTA_BLACK, 1, [B.TERRACOTTA, I.DYE_BLACK]);
  shapeless(B.TERRACOTTA_WHITE, 1, [B.TERRACOTTA, I.DYE_WHITE]);
  shapeless(B.TERRACOTTA_GRAY, 1, [B.TERRACOTTA, I.DYE_GRAY]);

  // ─── L24 matériaux (SPEC-CONSTR-006) : marbre, chaume, poutres ────────────
  // le marbre se taille aussi (rare, mais on n'a pas à attendre d'en trouver) ;
  // il se trouve surtout naturellement en sous-sol (voir world.js:filon).
  shaped(B.MARBRE, 1, ['SSS', 'SSS', 'SSS'], { S: B.STONE });
  shaped(B.CHAUME, 1, ['WWW', 'WWW'], { W: I.WHEAT });
  // poutres : trois planches empilées (une colonne, motif distinct des
  // planches elles-mêmes — 'LL' est déjà pris par la recette planches <- troncs)
  shaped(B.POUTRE_CHENE, 2, ['P', 'P', 'P'], { P: B.PLANKS });
  shaped(B.POUTRE_SAPIN, 2, ['P', 'P', 'P'], { P: B.PLANCHES_SAPIN });
  shaped(B.POUTRE_BOULEAU, 2, ['P', 'P', 'P'], { P: B.PLANCHES_BOULEAU });
  shaped(B.POUTRE_ACACIA, 2, ['P', 'P', 'P'], { P: B.PLANCHES_ACACIA });
  shaped(B.POUTRE_JUNGLE, 2, ['P', 'P', 'P'], { P: B.PLANCHES_JUNGLE });

  // ─── L24 matériaux (SPEC-CONSTR-007) : briquet ────────────────────────────
  // silex et acier : un lingot de fer et un pavé (à défaut d'un objet « silex »)
  shapeless(I.BRIQUET, 1, [I.IRON_INGOT, B.COBBLE]);

  // outils : 3 matériaux × 5 familles
  var MATS = [[B.PLANKS, 1], [B.COBBLE, 2], [I.IRON_INGOT, 3], [I.DIAMOND, 4]];
  var TOOLSETS = {
    pickaxe: [I.WOOD_PICKAXE, I.STONE_PICKAXE, I.IRON_PICKAXE, I.DIAMOND_PICKAXE],
    axe:     [I.WOOD_AXE, I.STONE_AXE, I.IRON_AXE, I.DIAMOND_AXE],
    shovel:  [I.WOOD_SHOVEL, I.STONE_SHOVEL, I.IRON_SHOVEL, I.DIAMOND_SHOVEL],
    sword:   [I.WOOD_SWORD, I.STONE_SWORD, I.IRON_SWORD, I.DIAMOND_SWORD],
    hoe:     [I.WOOD_HOE, I.STONE_HOE],
  };
  MATS.forEach(function (m, i) {
    var mat = m[0];
    if (TOOLSETS.pickaxe[i]) shaped(TOOLSETS.pickaxe[i], 1, ['MMM', ' S ', ' S '], { M: mat, S: I.STICK });
    if (TOOLSETS.axe[i])     shaped(TOOLSETS.axe[i], 1,     ['MM', 'MS', ' S'], { M: mat, S: I.STICK });
    if (TOOLSETS.shovel[i])  shaped(TOOLSETS.shovel[i], 1,  ['M', 'S', 'S'], { M: mat, S: I.STICK });
    if (TOOLSETS.sword[i])   shaped(TOOLSETS.sword[i], 1,   ['M', 'M', 'S'], { M: mat, S: I.STICK });
    if (TOOLSETS.hoe[i])     shaped(TOOLSETS.hoe[i], 1,     ['MM', ' S', ' S'], { M: mat, S: I.STICK });
  });

  // ─── L24 formes : escaliers, dalles, clôtures, murets, vitres, rambardes ───
  // (SPEC-CONSTR-001/002/004) — une recette par matériau, sur le gabarit
  // classique (6 → 4 escaliers, 3 → 6 dalles) réutilisé par toutes les formes.
  C.BLOCKS.forEach(function (base) {
    if (!base) return;
    if (base.escalier) shaped(base.escalier, 4, ['M  ', 'MM ', 'MMM'], { M: base.id });
    if (base.dalle) shaped(base.dalle, 6, ['MMM'], { M: base.id });
  });
  shaped(B.CLOTURE, 3, ['PSP', 'PSP'], { P: B.PLANKS, S: I.STICK });
  shaped(B.MURET, 6, ['CCC', 'CCC'], { C: B.COBBLE });
  shaped(B.VITRE, 16, ['GGG', 'GGG'], { G: B.GLASS });
  shaped(B.RAMBARDE, 6, ['SBS', 'SBS'], { S: B.STONE_BRICK, B: I.STICK });

  // ═══════════════════════════════════════════════════════════════════════
  // ─── L25 objets (SPEC-OBJET-001 à 005) ───────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════

  // ─── tissu et cuir (SPEC-OBJET-001) ──────────────────────────────────────
  // la laine se tisse en tissu ; le cuir se tanne à partir de chair
  // putréfiée (un débouché pour un butin de zombie autrement inutile)
  shapeless(I.TISSU, 4, [B.WOOL, B.WOOL]);
  // le cuir se tanne au fourneau (voir SMELT plus bas) à partir de chair putréfiée

  // ─── armures : fabrication et réparation (SPEC-OBJET-001) ───────────────
  var ARMOR_PATTERN = {
    CASQUE: ['MMM', 'M M'],
    PLASTRON: ['M M', 'MMM', 'MMM'],
    JAMBIERES: ['MMM', 'M M', 'M M'],
    BOTTES: ['M M'],
  };
  var ARMOR_MATERIAL = {
    TISSU: I.TISSU, CUIR: I.CUIR, BRONZE: I.BRONZE_LINGOT,
    FER: I.IRON_INGOT, OR: I.GOLD_INGOT, DIAMANT: I.DIAMOND,
  };
  Object.keys(ARMOR_MATERIAL).forEach(function (fam) {
    var mat = ARMOR_MATERIAL[fam];
    Object.keys(ARMOR_PATTERN).forEach(function (slot) {
      var id = I[fam + '_' + slot];
      shaped(id, 1, ARMOR_PATTERN[slot], { M: mat });
      // réparation à l'établi (et à l'enclume, qui donne accès au même établi) :
      // une pièce usée combinée à sa matière première redevient neuve
      shapeless(id, 1, [id, mat]);
    });
  });
  // les mailles se tissent de ficelle autour d'un peu de fer, sans plaque
  shapeless(I.MAILLES_CASQUE, 1, [I.FICELLE, I.FICELLE, I.IRON_INGOT]);
  shapeless(I.MAILLES_PLASTRON, 1, [I.FICELLE, I.FICELLE, I.FICELLE, I.IRON_INGOT, I.IRON_INGOT]);
  shapeless(I.MAILLES_JAMBIERES, 1, [I.FICELLE, I.FICELLE, I.IRON_INGOT, I.IRON_INGOT]);
  shapeless(I.MAILLES_BOTTES, 1, [I.FICELLE, I.IRON_INGOT]);
  shapeless(I.MAILLES_CASQUE, 1, [I.MAILLES_CASQUE, I.IRON_INGOT]);
  shapeless(I.MAILLES_PLASTRON, 1, [I.MAILLES_PLASTRON, I.IRON_INGOT]);
  shapeless(I.MAILLES_JAMBIERES, 1, [I.MAILLES_JAMBIERES, I.IRON_INGOT]);
  shapeless(I.MAILLES_BOTTES, 1, [I.MAILLES_BOTTES, I.IRON_INGOT]);

  // ─── armes (SPEC-OBJET-002) ───────────────────────────────────────────────
  var ARME_FAMILLES = ['DAGUE', 'EPEE_LONGUE', 'HACHE_GUERRE', 'MASSE', 'LANCE'];
  var ARME_PATTERN = {
    DAGUE: ['M', 'S'],
    EPEE_LONGUE: ['MM', 'MM', ' S'],
    HACHE_GUERRE: ['MM', 'MM', 'MS'],
    MASSE: ['MM', 'MS', 'SS'],
    // distinct de la pelle (M/S/S) et de l'épée (M/M/S) : la pointe entre deux hampes
    LANCE: ['S', 'M', 'S'],
  };
  var ARME_TIER_SUFFIXE = ['BOIS', 'PIERRE', 'FER', 'DIAMANT'];
  ARME_FAMILLES.forEach(function (fam) {
    MATS.forEach(function (m, i) {
      var mat = m[0];
      shaped(I[fam + '_' + ARME_TIER_SUFFIXE[i]], 1, ARME_PATTERN[fam], { M: mat, S: I.STICK });
    });
  });
  shapeless(I.ARC_LONG, 1, [I.STICK, I.STICK, I.STICK, I.FICELLE, I.FICELLE, I.FEATHER]);
  shapeless(I.ARBALETE_LOURDE, 1, [I.STICK, I.STICK, I.IRON_INGOT, I.IRON_INGOT, I.FICELLE, I.FICELLE]);
  shapeless(I.FRONDE, 1, [I.FICELLE, I.FICELLE, I.STICK]);
  shapeless(I.GALET, 4, [B.COBBLE]);

  // ─── gemmes taillées et bijoux (SPEC-OBJET-003) ─────────────────────────
  shapeless(I.RUBIS_TAILLE, 1, [I.RUBIS]);
  shapeless(I.SAPHIR_TAILLE, 1, [I.SAPHIR]);
  shapeless(I.EMERAUDE_TAILLEE, 1, [I.EMERALD]);
  shapeless(I.DIAMANT_TAILLE, 1, [I.DIAMOND]);
  var BIJOU_GEMME_TAILLEE = { RUBIS: I.RUBIS_TAILLE, SAPHIR: I.SAPHIR_TAILLE,
                              EMERAUDE: I.EMERAUDE_TAILLEE, DIAMANT: I.DIAMANT_TAILLE };
  ['ANNEAU', 'AMULETTE', 'DIADEME'].forEach(function (fam) {
    var monture = fam === 'ANNEAU' ? I.ARGENT_LINGOT : fam === 'AMULETTE' ? I.GOLD_INGOT : I.DIAMOND;
    Object.keys(BIJOU_GEMME_TAILLEE).forEach(function (gem) {
      shapeless(I[fam + '_' + gem], 1, [monture, BIJOU_GEMME_TAILLEE[gem]]);
    });
  });

  // ─── nourriture et cuisine (SPEC-OBJET-004) ──────────────────────────────
  shapeless(I.FROMAGE, 1, [B.WOOL, B.SEL]);
  shapeless(I.SOUPE_LEGUMES, 1, [I.BOWL, I.MELON_SLICE, I.WHEAT]);
  shapeless(I.RAGOUT, 1, [I.BOWL, I.COOKED_MUTTON, I.WHEAT]);
  shapeless(I.TARTE_POMME, 1, [I.WHEAT, I.WHEAT, I.APPLE]);
  shapeless(I.GATEAU, 1, [I.WHEAT, I.WHEAT, I.WHEAT, I.FROMAGE]);

  // ─── pièges (SPEC-OBJET-005) ─────────────────────────────────────────────
  shapeless(I.KIT_DESAMORCAGE, 1, [I.IRON_INGOT, I.IRON_INGOT, I.FICELLE, I.STICK]);
  // un joueur peut aussi piéger ou enjoliver son propre coffre
  shapeless(B.COFFRE_PIEGE, 1, [B.CHEST, I.FICELLE, I.FLECHE]);
  shapeless(B.COFFRE_SURPRISE, 1, [B.CHEST, I.GOLD_INGOT]);

  /* Réduit une grille w×h à sa boîte englobante non vide.
     Sans ça, une recette posée en bas à droite d'une grille 3×3 ne serait pas
     reconnue alors qu'elle est valide. */
  function trimGrid(grid, w, h) {
    var minX = w, maxX = -1, minY = h, maxY = -1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (grid[y * w + x]) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return { w: 0, h: 0, cells: [] };
    var nw = maxX - minX + 1, nh = maxY - minY + 1, cells = [];
    for (var yy = 0; yy < nh; yy++) for (var xx = 0; xx < nw; xx++) {
      cells.push(grid[(yy + minY) * w + (xx + minX)] || 0);
    }
    return { w: nw, h: nh, cells: cells };
  }

  /* `grid` : tableau de w*h ids (0 = vide). Renvoie {id, n} ou null. */
  function matchRecipe(grid, w, h) {
    var t = trimGrid(grid, w, h);
    var present = grid.filter(function (v) { return v; });
    if (!present.length) return null;

    for (var r = 0; r < RECIPES.length; r++) {
      var rec = RECIPES[r];
      if (rec.type === 'shaped') {
        if (rec.w !== t.w || rec.h !== t.h) continue;
        var ok = true;
        for (var y = 0; y < rec.h && ok; y++) {
          for (var x = 0; x < rec.w; x++) {
            var ch = rec.pattern[y][x];
            var want = ch === ' ' ? 0 : rec.keys[ch];
            if (t.cells[y * rec.w + x] !== want) { ok = false; break; }
          }
        }
        if (ok) return { id: rec.out, n: rec.n };
      } else {
        if (present.length !== rec.ingredients.length) continue;
        var pool = rec.ingredients.slice();
        var all = true;
        for (var i = 0; i < present.length; i++) {
          var k = pool.indexOf(present[i]);
          if (k < 0) { all = false; break; }
          pool.splice(k, 1);
        }
        if (all && !pool.length) return { id: rec.out, n: rec.n };
      }
    }
    return null;
  }

  // ─── fourneau ──────────────────────────────────────────────────────────────
  var SMELT = {};
  SMELT[B.IRON_ORE] = I.IRON_INGOT;
  SMELT[I.RAW_MUTTON] = I.COOKED_MUTTON;
  SMELT[I.RAW_PORK] = I.COOKED_PORK;
  SMELT[B.SAND] = B.GLASS;
  SMELT[B.COBBLE] = B.STONE;
  SMELT[B.GOLD_ORE] = I.GOLD_INGOT;
  SMELT[I.RAW_FISH] = I.COOKED_FISH;
  SMELT[I.RAW_CHICKEN] = I.COOKED_CHICKEN;
  SMELT[B.CACTUS] = I.DYE_GREEN;
  SMELT[B.CLAY] = B.TERRACOTTA;
  SMELT[B.RED_SAND] = B.GLASS;
  // minerais (SPEC-MINERAI-002) : le brut fond en lingot, comme le fer et l'or
  SMELT[I.CUIVRE_BRUT] = I.CUIVRE_LINGOT;
  SMELT[I.ETAIN_BRUT] = I.ETAIN_LINGOT;
  SMELT[I.ARGENT_BRUT] = I.ARGENT_LINGOT;
  // le cuir se tanne au fourneau, à partir de chair putréfiée (SPEC-OBJET-001)
  SMELT[I.ROTTEN_FLESH] = I.CUIR;

  function smeltResult(id) { return SMELT[id] || 0; }
  function fuelValue(id) {
    var d = C.def(id);
    if (d && d.fuel) return d.fuel;
    if (id === B.PLANKS || C.isLog(id)) return 1.5;
    if (id === B.HAY) return 2;
    if (id === I.STICK) return 0.5;
    if (id === B.CRAFTING_TABLE) return 1.5;
    return 0;
  }

  /* Fait avancer un fourneau de dt secondes. `f` : {input, fuel, output, burn, cook}.
     Renvoie true si l'état a changé (pour rafraîchir l'UI). */
  var SMELT_TIME = 6;
  function tickFurnace(f, dt) {
    var changed = false;
    // consommer du combustible si besoin et possible
    if (f.burn <= 0 && f.input && smeltResult(f.input.id) && f.fuel) {
      var v = fuelValue(f.fuel.id);
      if (v > 0) {
        f.burn = v * SMELT_TIME;
        f.fuel.n--;
        if (f.fuel.n <= 0) f.fuel = null;
        changed = true;
      }
    }
    if (f.burn > 0) {
      f.burn = Math.max(0, f.burn - dt);
      changed = true;
      var res = f.input ? smeltResult(f.input.id) : 0;
      if (res && (!f.output || (f.output.id === res && f.output.n < C.maxStack(res)))) {
        f.cook += dt;
        if (f.cook >= SMELT_TIME) {
          f.cook -= SMELT_TIME;
          f.input.n--;
          if (f.input.n <= 0) f.input = null;
          if (f.output) f.output.n++;
          else f.output = { id: res, n: 1 };
        }
      } else {
        f.cook = 0;
      }
    } else {
      f.cook = 0;
    }
    return changed;
  }

  function newFurnace() { return { input: null, fuel: null, output: null, burn: 0, cook: 0 }; }

  // ─── échanges avec les villageois ──────────────────────────────────────────
  // give : ce que le joueur cède · get : ce qu'il reçoit
  var TRADES = [
    { give: [{ id: I.WHEAT, n: 8 }], get: { id: I.EMERALD, n: 1 } },
    { give: [{ id: B.WOOL, n: 4 }], get: { id: I.EMERALD, n: 1 } },
    { give: [{ id: I.EMERALD, n: 1 }], get: { id: I.BREAD, n: 4 } },
    { give: [{ id: I.EMERALD, n: 2 }], get: { id: I.IRON_INGOT, n: 3 } },
    { give: [{ id: I.EMERALD, n: 3 }], get: { id: I.IRON_PICKAXE, n: 1 } },
    // minerais (SPEC-MINERAI-002) : le villageois achète les matières brutes et vend les rares
    { give: [{ id: I.CUIVRE_LINGOT, n: 4 }], get: { id: I.EMERALD, n: 1 } },
    { give: [{ id: I.ETAIN_LINGOT, n: 4 }], get: { id: I.EMERALD, n: 1 } },
    { give: [{ id: I.QUARTZ, n: 3 }], get: { id: I.EMERALD, n: 1 } },
    { give: [{ id: I.EMERALD, n: 2 }], get: { id: I.ARGENT_LINGOT, n: 2 } },
    { give: [{ id: I.EMERALD, n: 4 }], get: { id: I.RUBIS, n: 1 } },
    { give: [{ id: I.EMERALD, n: 4 }], get: { id: I.SAPHIR, n: 1 } },
    { give: [{ id: I.EMERALD, n: 6 }], get: { id: I.BIJOU, n: 1 } },
    { give: [{ id: I.BIJOU, n: 1 }], get: { id: I.EMERALD, n: 8 } },
    // les bijoux taillés (SPEC-OBJET-003) valent cher : la monture y ajoute son prix
    { give: [{ id: I.ANNEAU_RUBIS, n: 1 }], get: { id: I.EMERALD, n: 6 } },
    { give: [{ id: I.ANNEAU_SAPHIR, n: 1 }], get: { id: I.EMERALD, n: 6 } },
    { give: [{ id: I.ANNEAU_EMERAUDE, n: 1 }], get: { id: I.EMERALD, n: 6 } },
    { give: [{ id: I.ANNEAU_DIAMANT, n: 1 }], get: { id: I.EMERALD, n: 6 } },
    { give: [{ id: I.AMULETTE_RUBIS, n: 1 }], get: { id: I.EMERALD, n: 9 } },
    { give: [{ id: I.AMULETTE_SAPHIR, n: 1 }], get: { id: I.EMERALD, n: 9 } },
    { give: [{ id: I.AMULETTE_EMERAUDE, n: 1 }], get: { id: I.EMERALD, n: 9 } },
    { give: [{ id: I.AMULETTE_DIAMANT, n: 1 }], get: { id: I.EMERALD, n: 9 } },
    { give: [{ id: I.DIADEME_RUBIS, n: 1 }], get: { id: I.EMERALD, n: 14 } },
    { give: [{ id: I.DIADEME_SAPHIR, n: 1 }], get: { id: I.EMERALD, n: 14 } },
    { give: [{ id: I.DIADEME_EMERAUDE, n: 1 }], get: { id: I.EMERALD, n: 14 } },
    { give: [{ id: I.DIADEME_DIAMANT, n: 1 }], get: { id: I.EMERALD, n: 14 } },
  ];

  function canTrade(inv, trade) {
    for (var i = 0; i < trade.give.length; i++) {
      if (inv.count(trade.give[i].id) < trade.give[i].n) return false;
    }
    return true;
  }

  /* Effectue l'échange. Renvoie le reliquat non casé (0 si tout est rentré).
     On ne retire les ingrédients QUE si la contrepartie peut être reçue, sinon
     le joueur paierait sans rien obtenir. */
  function doTrade(inv, trade) {
    if (!canTrade(inv, trade)) return null;
    // simulation : reste-t-il de la place ?
    var libre = inv.firstEmpty() >= 0;
    if (!libre) {
      var max = C.maxStack(trade.get.id), place = 0;
      for (var s = 0; s < inv.slots.length; s++) {
        var st = inv.slots[s];
        if (st && st.id === trade.get.id) place += max - st.n;
      }
      if (place < trade.get.n) return null;
    }
    for (var i = 0; i < trade.give.length; i++) inv.remove(trade.give[i].id, trade.give[i].n);
    return inv.add(trade.get.id, trade.get.n);
  }

  MC.Inventory = {
    HOTBAR_SIZE: HOTBAR_SIZE, MAIN_SIZE: MAIN_SIZE, TOTAL: TOTAL,
    TRADES: TRADES, canTrade: canTrade, doTrade: doTrade,
    create: createInventory, RECIPES: RECIPES, matchRecipe: matchRecipe,
    trimGrid: trimGrid, smeltResult: smeltResult, fuelValue: fuelValue,
    tickFurnace: tickFurnace, newFurnace: newFurnace, SMELT_TIME: SMELT_TIME,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
