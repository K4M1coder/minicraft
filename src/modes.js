/* modes.js — modes de jeu et difficultés.
   Toutes les règles qui dépendent du mode sont rassemblées ici plutôt que
   dispersées en `if` dans la boucle : on peut ainsi les tester une par une. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var MODES = {
    survie: {
      id: 'survie', nom: 'Survie',
      description: 'Ramassez, fabriquez, mangez, survivez.',
      vole: false, invulnerable: false, faim: true,
      casseInstantanee: false, blocsIllimites: false, useDurabilite: true,
    },
    creatif: {
      id: 'creatif', nom: 'Créatif',
      description: 'Vol libre, blocs illimités, aucun danger.',
      vole: true, invulnerable: true, faim: false,
      casseInstantanee: true, blocsIllimites: true, useDurabilite: false,
    },
    histoire: {
      id: 'histoire', nom: 'Histoire',
      description: 'Une aventure guidée : quêtes, choix et fins multiples.',
      vole: false, invulnerable: false, faim: true,
      casseInstantanee: false, blocsIllimites: false, useDurabilite: true, histoire: true,
    },
  };

  /* ─── interactions du mode histoire ─────────────────────────────────────
     Le récit remplace le bac à sable : on ne casse, ne pose et n'utilise que
     ce que les paramètres de l'histoire permettent, par catégories. */
  function blocsDe() {
    var B = MC.Core.B;
    return {
      vegetal:      { nom: 'Végétaux', ids: [B.TALL_GRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.DEAD_BUSH, B.MUSHROOM, B.LEAVES,
                                           B.BIRCH_LEAVES, B.SPRUCE_LEAVES, B.JUNGLE_LEAVES, B.ACACIA_LEAVES, B.VINES, B.CACTUS,
                                           B.MELON, B.KELP, B.SEAGRASS, B.WHEAT0, B.WHEAT1, B.WHEAT2, B.WHEAT3, B.SEA_PICKLE] },
      bois:         { nom: 'Bois', ids: [B.LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.JUNGLE_LOG, B.ACACIA_LOG, B.PLANKS,
                                        B.PLANCHES_SAPIN, B.PLANCHES_BOULEAU, B.PLANCHES_ACACIA, B.PLANCHES_JUNGLE] },
      terre:        { nom: 'Terre, sable, gravier', ids: [B.DIRT, B.GRASS, B.SAND, B.GRAVEL, B.CLAY, B.SNOW, B.RED_SAND,
                                                         B.MYCELIUM, B.FARMLAND] },
      pierre:       { nom: 'Pierre et minerais', ids: [B.STONE, B.COBBLE, B.COAL_ORE, B.IRON_ORE, B.GOLD_ORE, B.DIAMOND_ORE,
                                                      B.SANDSTONE, B.TERRACOTTA, B.TERRACOTTA_RED, B.TERRACOTTA_YELLOW, B.BASALT,
                                                      B.ICE, B.PACKED_ICE, B.BLUE_ICE, B.MOSSY_COBBLE, B.OBSIDIAN] },
      construction: { nom: 'Blocs de construction', ids: [B.BRICK, B.GLASS, B.STONE_BRICK, B.SANDSTONE_BRICK, B.ICE_BRICK,
                                                         B.PRISMARINE, B.PRISMARINE_BRICK, B.TUILES, B.ARDOISE, B.CHAUX, B.PAVE,
                                                         B.WOOL, B.WOOL_RED, B.WOOL_BLUE, B.WOOL_YELLOW, B.WOOL_GREEN, B.HAY,
                                                         B.LADDER, B.RAIL, B.BOOKSHELF, B.GOLD_BLOCK] },
      lumiere:      { nom: 'Lumières', ids: [B.TORCH, B.LANTERN, B.SEA_LANTERN] },
      mobilier:     { nom: 'Mobilier', ids: [B.CRAFTING_TABLE, B.FURNACE, B.CHEST, B.COMPTOIR, B.TONNEAU, B.ENCLUME] },
    };
  }
  var CATEGORIES_OBJETS = {
    nourriture:  { nom: 'Nourriture', si: function (d) { return !!d.food; } },
    armes:       { nom: 'Armes', si: function (d) { return d.tool === 'sword' || !!d.ranged || !!d.ammo; } },
    outils:      { nom: 'Outils', si: function (d) { return (!!d.tool && d.tool !== 'sword') || !!d.engrais; } },
    vehicules:   { nom: 'Véhicules', si: function (d) { return !!d.vehicule; } },
    exploration: { nom: 'Carte', si: function (d) { return !!d.carte; } },
  };
  var PRESETS_INTERACTIONS = {
    restreinte: { nom: 'Restreinte', description: 'Presque rien ne se casse ni ne se pose : on parle, on explore, on combat.',
                  blocs: ['vegetal', 'lumiere'], objets: ['nourriture', 'armes', 'exploration'] },
    moderee:    { nom: 'Modérée', description: 'Bois, terre, végétaux, lumières et mobilier ; outils et armes.',
                  blocs: ['vegetal', 'bois', 'terre', 'lumiere', 'mobilier'], objets: ['nourriture', 'armes', 'outils', 'exploration'] },
    libre:      { nom: 'Libre', description: 'Tout est permis, comme en survie.',
                  blocs: ['vegetal', 'bois', 'terre', 'pierre', 'construction', 'lumiere', 'mobilier'],
                  objets: ['nourriture', 'armes', 'outils', 'vehicules', 'exploration'] },
  };
  /* Interactions effectives : un préréglage, et/ou des catégories choisies. */
  function interactions(opts) {
    opts = opts || {};
    var p = PRESETS_INTERACTIONS[opts.preset] || PRESETS_INTERACTIONS.moderee;
    var blocs = opts.blocs || p.blocs, objets = opts.objets || p.objets;
    var ids = new Set(), cat = blocsDe();
    blocs.forEach(function (k) { if (cat[k]) cat[k].ids.forEach(function (id) { ids.add(id); }); });
    return { preset: opts.preset || 'moderee', blocs: blocs.slice(), objets: objets.slice(), ids: ids };
  }
  function peutCasser(r, id) { return !r || !r.interactions || r.interactions.ids.has(id); }
  function peutPoser(r, id) { return !r || !r.interactions || r.interactions.ids.has(id); }
  /* Un objet : permis si aucune catégorie ne le concerne (bâton, lingot,
     émeraude…) ou si l'une des siennes est autorisée. */
  function peutUtiliser(r, id) {
    if (!r || !r.interactions) return true;
    var d = MC.Core.def(id);
    if (!d || id < MC.Core.FIRST_ITEM) return peutPoser(r, id);
    var concerne = false, permis = false;
    Object.keys(CATEGORIES_OBJETS).forEach(function (k) {
      if (!CATEGORIES_OBJETS[k].si(d)) return;
      concerne = true;
      if (r.interactions.objets.indexOf(k) >= 0) permis = true;
    });
    return !concerne || permis;
  }
  /* Une catégorie (de blocs ou d'objets) est-elle ouverte ? Les objectifs du
     récit qui en dépendent sautent sinon. */
  function categoriePermise(r, k) {
    if (!r || !r.interactions) return true;
    return r.interactions.blocs.indexOf(k) >= 0 || r.interactions.objets.indexOf(k) >= 0;
  }

  /* Les difficultés ne changent que des coefficients, sauf « cauchemar » qui
     ajoute une conséquence irréversible : la partie est effacée à la mort. */
  var DIFFICULTES = {
    paisible: {
      id: 'paisible', nom: 'Paisible', ordre: 0,
      description: 'Aucun monstre. La faim ne tue pas.',
      monstres: false, degatsMob: 0, plafondMonstres: 0,
      degatsFamine: false, regenMultiplicateur: 2, permadeath: false,
    },
    facile: {
      id: 'facile', nom: 'Facile', ordre: 1,
      description: 'Peu de monstres, coups amortis.',
      monstres: true, degatsMob: 0.5, plafondMonstres: 6,
      degatsFamine: true, regenMultiplicateur: 1.4, permadeath: false,
    },
    difficile: {
      id: 'difficile', nom: 'Difficile', ordre: 2,
      description: 'Monstres nombreux et coups appuyés.',
      monstres: true, degatsMob: 1.5, plafondMonstres: 16,
      degatsFamine: true, regenMultiplicateur: 0.7, permadeath: false,
    },
    cauchemar: {
      id: 'cauchemar', nom: 'Cauchemar', ordre: 3,
      description: 'Coups doublés. À la mort, la carte ET la sauvegarde sont détruites.',
      monstres: true, degatsMob: 2, plafondMonstres: 22,
      degatsFamine: true, regenMultiplicateur: 0.4, permadeath: true,
    },
  };

  var ORDRE_DIFFICULTES = ['paisible', 'facile', 'difficile', 'cauchemar'];

  function mode(id) { return MODES[id] || MODES.survie; }
  function difficulte(id) { return DIFFICULTES[id] || DIFFICULTES.facile; }

  /* Règles dérivées, pour éviter de recombiner mode et difficulté partout. */
  function regles(modeId, diffId, options) {
    var m = mode(modeId), d = difficulte(diffId);
    return {
      histoire: !!m.histoire,
      interactions: m.histoire ? interactions(options && options.interactions) : null,
      commerce: m.histoire ? !(options && options.commerce === false) : true,
      mode: m, difficulte: d,
      // en créatif la difficulté n'a aucun effet : rien ne peut blesser
      monstres: m.invulnerable ? false : d.monstres,
      plafondMonstres: m.invulnerable ? 0 : d.plafondMonstres,
      degatsMob: m.invulnerable ? 0 : d.degatsMob,
      degatsFamine: m.faim && d.degatsFamine,
      faim: m.faim,
      vole: m.vole,
      invulnerable: m.invulnerable,
      casseInstantanee: m.casseInstantanee,
      blocsIllimites: m.blocsIllimites,
      useDurabilite: m.useDurabilite,
      regenMultiplicateur: d.regenMultiplicateur,
      permadeath: !m.invulnerable && d.permadeath,
    };
  }

  /* Plafonds d'apparition par type, dérivés de la difficulté.
     En paisible, aucun hostile mais les animaux et villageois restent. */
  function plafondsEntites(r) {
    var m = r.monstres ? r.plafondMonstres : 0;
    return {
      zombie: m,
      // tous les hostiles réunis (zombies, squelettes, araignées, momies, slimes)
      monstres: m,
      sheep: 8,
      villager: 4,
      // les autres animaux (cochons, loups) partagent un plafond commun
      animaux: 12,
    };
  }

  /* Graine : on accepte un nombre ou un texte libre (comme le jeu d'origine),
     converti en entier stable — c'est ce qui permet de retrouver la même carte
     sur une autre machine en tapant le même mot. */
  function graineDepuisTexte(txt) {
    if (txt === null || txt === undefined) return null;
    var s = String(txt).trim();
    if (!s.length) return null;
    if (/^-?\d+$/.test(s)) {
      var n = parseInt(s, 10);
      if (isFinite(n)) return n | 0;
    }
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h | 0;
  }

  function graineAleatoire() {
    return (Math.floor(Math.random() * 2147483647) - 1073741823) | 0;
  }

  MC.Modes = {
    PRESETS_INTERACTIONS: PRESETS_INTERACTIONS, CATEGORIES_OBJETS: CATEGORIES_OBJETS, categoriesBlocs: blocsDe,
    interactions: interactions, peutCasser: peutCasser, peutPoser: peutPoser, peutUtiliser: peutUtiliser,
    categoriePermise: categoriePermise,
    MODES: MODES, DIFFICULTES: DIFFICULTES, ORDRE_DIFFICULTES: ORDRE_DIFFICULTES,
    mode: mode, difficulte: difficulte, regles: regles, plafondsEntites: plafondsEntites,
    graineDepuisTexte: graineDepuisTexte, graineAleatoire: graineAleatoire,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
