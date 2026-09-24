/* core.js — constantes, définitions des blocs et des objets.
   Aucune dépendance : ni THREE, ni DOM. Chargeable sous Node comme dans le navigateur. */
(function (G) {
  'use strict';

  var MC = G.MC = G.MC || {};

  // ─── versions ──────────────────────────────────────────────────────────────
  // version du jeu en cours ; la génération de terrain a changé 5 fois
  // (une vieille sauvegarde garde la version d'origine de sa carte, voir saves.js)
  var VERSION_JEU = '0.1.0';
  var VERSION_GENERATION = 5;

  // ─── géométrie du monde ────────────────────────────────────────────────────
  var CHUNK_X = 16, CHUNK_Z = 16, WORLD_H = 128, SEA_LEVEL = 26;

  // index dans le tableau plat d'un chunk
  function idx(x, y, z) { return (y * CHUNK_Z + z) * CHUNK_X + x; }

  // ─── espace d'ids unifié ───────────────────────────────────────────────────
  // 0 = air, 1..4095 = blocs (posables), 4096+ = objets (non posables).
  // Les blocs tiennent désormais sur 16 bits (Uint16Array des chunks,
  // SPEC-SAVE-017) : la marge entre les derniers blocs définis (127) et
  // FIRST_ITEM laisse de la place à de nouveaux blocs sans jamais plus
  // toucher à l'id des objets. Un seul espace d'ids permet à l'inventaire,
  // au craft et aux drops de manipuler indifféremment un bloc ou un objet.
  var B = {
    AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6,
    PLANKS: 7, COBBLE: 8, BRICK: 9, GLASS: 10, WATER: 11,
    CRAFTING_TABLE: 12, FURNACE: 13, FARMLAND: 14,
    WHEAT0: 15, WHEAT1: 16, WHEAT2: 17, WHEAT3: 18,
    COAL_ORE: 19, IRON_ORE: 20, WOOL: 21, BEDROCK: 22, TORCH: 23, CHEST: 24,
    // biomes et végétation
    SNOW: 25, ICE: 26, SANDSTONE: 27, CACTUS: 28,
    BIRCH_LOG: 29, BIRCH_LEAVES: 30, SPRUCE_LOG: 31, SPRUCE_LEAVES: 32,
    TALL_GRASS: 33, FLOWER_RED: 34, FLOWER_YELLOW: 35, DEAD_BUSH: 36, MUSHROOM: 37,
    // donjons
    MOSSY_COBBLE: 38, STONE_BRICK: 39,
    // biomes exotiques
    JUNGLE_LOG: 40, JUNGLE_LEAVES: 41, ACACIA_LOG: 42, ACACIA_LEAVES: 43, VINES: 44,
    RED_SAND: 45, TERRACOTTA: 46, TERRACOTTA_RED: 47, TERRACOTTA_YELLOW: 48,
    PACKED_ICE: 49, MYCELIUM: 50, MUSHROOM_CAP: 51, MUSHROOM_STEM: 52, MELON: 53,
    GRAVEL: 54, CLAY: 55,
    // mer
    KELP: 56, SEAGRASS: 57, CORAL_RED: 58, CORAL_YELLOW: 59, CORAL_BLUE: 60,
    CORAL_FAN_RED: 61, CORAL_FAN_YELLOW: 62, CORAL_FAN_BLUE: 63, SPONGE: 64,
    PRISMARINE: 65, PRISMARINE_BRICK: 66, SEA_LANTERN: 67, SEA_PICKLE: 68,
    // minerais et structures
    GOLD_ORE: 69, DIAMOND_ORE: 70, GOLD_BLOCK: 71, LANTERN: 72, BOOKSHELF: 73,
    SANDSTONE_BRICK: 74, ICE_BRICK: 75, OBSIDIAN: 76, COBWEB: 77, RAIL: 78, HAY: 79,
    WOOL_RED: 80, WOOL_BLUE: 81, WOOL_YELLOW: 82, WOOL_GREEN: 83, LADDER: 84,
    // volcans et glaciers
    LAVA: 85, BASALT: 86, MAGMA: 87, BLUE_ICE: 88,
    // habitations, villages et villes
    PLANCHES_SAPIN: 89, PLANCHES_BOULEAU: 90, PLANCHES_ACACIA: 91, PLANCHES_JUNGLE: 92,
    TUILES: 93, ARDOISE: 94, CHAUX: 95, PAVE: 96, COMPTOIR: 97, COFFRE_FORT: 98,
    TONNEAU: 99, ENCLUME: 100, PANNEAU_INFO: 101,
    // eau courante : sept niveaux, du filet (1) au ras de la source (7)
    EAU_1: 102, EAU_2: 103, EAU_3: 104, EAU_4: 105, EAU_5: 106, EAU_6: 107, EAU_7: 108,
    // portes et trappes : un panneau fin, dont l'id encode l'orientation (N,E,S,O)
    // et l'état (fermée/ouverte) — pas de métadonnées par bloc, voir SPEC-PORTE-*.
    PORTE_FERMEE_N: 109, PORTE_FERMEE_E: 110, PORTE_FERMEE_S: 111, PORTE_FERMEE_O: 112,
    PORTE_OUVERTE_N: 113, PORTE_OUVERTE_E: 114, PORTE_OUVERTE_S: 115, PORTE_OUVERTE_O: 116,
    TRAPPE_FERMEE: 117, TRAPPE_OUVERTE: 118,
    // minerais (SPEC-MINERAI-001) : le dernier bloc libre est 127 (128 = premier
    // objet). Neuf identifiants pour dix matières : cuivre et étain partagent un
    // même filon commun, de même que rubis et saphir avec l'émeraude, et que le
    // quartz avec le soufre — chaque bloc lâche l'une ou l'autre matière au
    // hasard plutôt que de dépenser un identifiant par matière.
    MINERAI_METAUX: 119,     // cuivre + étain
    MINERAI_ARGENT: 120,     // argent + lapis
    MINERAI_GEMMES: 121,     // émeraude + rubis + saphir
    MINERAI_CRISTAL: 122,    // quartz + soufre (près des volcans)
    SEL: 123,                // sel (déserts, badlands)
    // bioluminescence des profondeurs (SPEC-LUMIERE-007)
    CHAMPI_LUMINEUX: 124,    // champignons et lichens des grottes humides
    CRISTAL_LUMINEUX: 125,   // cristaux des géodes
    ALGUE_LUMINEUSE: 126,    // algues des abysses
    PLANCTON_LUMINEUX: 127,  // plancton des récifs, simplifié en bloc
  };
  var I = {
    STICK: 128, COAL: 129, IRON_INGOT: 130, WHEAT: 131, SEEDS: 132, BREAD: 133,
    RAW_MUTTON: 134, COOKED_MUTTON: 135, ROTTEN_FLESH: 136, EMERALD: 137,
    WOOD_PICKAXE: 138, STONE_PICKAXE: 139, IRON_PICKAXE: 140,
    WOOD_AXE: 141, STONE_AXE: 142, IRON_AXE: 143,
    WOOD_SHOVEL: 144, STONE_SHOVEL: 145, IRON_SHOVEL: 146,
    WOOD_SWORD: 147, STONE_SWORD: 148, IRON_SWORD: 149,
    WOOD_HOE: 150, STONE_HOE: 151,
    FICELLE: 152, ARC: 153, FLECHE: 154,
    RAW_PORK: 155, COOKED_PORK: 156, EPEE_RUNIQUE: 157,
    // matières
    GOLD_INGOT: 158, DIAMOND: 159, FEATHER: 160, BONE: 161, BONE_MEAL: 162,
    PRISMARINE_SHARD: 163, INK_SAC: 164,
    DYE_RED: 165, DYE_YELLOW: 166, DYE_BLUE: 167, DYE_GREEN: 168,
    // nourriture
    APPLE: 169, GOLDEN_APPLE: 170, RAW_FISH: 171, COOKED_FISH: 172, BOWL: 173,
    MUSHROOM_STEW: 174, MELON_SLICE: 175, RAW_CHICKEN: 176, COOKED_CHICKEN: 177,
    // outils en diamant
    DIAMOND_PICKAXE: 178, DIAMOND_AXE: 179, DIAMOND_SHOVEL: 180, DIAMOND_SWORD: 181,
    // armes
    ARBALETE: 182,
    // trésors de gardiens
    KHEPESH: 183, HACHE_GIVRE: 184, ARC_JUNGLE: 185, BATON_SORCIERE: 186,
    LANCE_CIMES: 187, TRIDENT: 188, SABRE_CAPITAINE: 189,
    // véhicules et pièces
    ROUE: 190, MOTEUR: 191, HELICE: 192,
    BATEAU: 193, MOTO: 194, VOITURE: 195, CAMION: 196, AVION: 197, SOUS_MARIN: 198,
    WAGONNET: 199,
    // exploration
    CARTE: 200,
    // l'eau se puise et se verse
    SEAU: 201, SEAU_EAU: 202,
    // porte et trappe : l'objet posable ; le bloc réel encode orientation et état
    PORTE: 203, TRAPPE: 204,
    // matières des minerais (SPEC-MINERAI-001 / SPEC-MINERAI-002)
    CUIVRE_BRUT: 205, CUIVRE_LINGOT: 206, ETAIN_BRUT: 207, ETAIN_LINGOT: 208,
    ARGENT_BRUT: 209, ARGENT_LINGOT: 210, LAPIS: 211, RUBIS: 212, SAPHIR: 213,
    QUARTZ: 214, SOUFRE: 215, BRONZE_LINGOT: 216,
    BRONZE_PIOCHE: 217, BRONZE_HACHE: 218, BRONZE_PELLE: 219, BRONZE_EPEE: 220,
    BIJOU: 221,
  };

  /* Ancienne frontière (format de sauvegarde 8 bits, avant SPEC-SAVE-017) :
     les objets démarraient à 128, dans un espace d'ids partagé avec les
     blocs sur un seul octet. `I` ci-dessus est encore déclaré avec CES
     valeurs (128..221) pour ne pas réécrire chaque définition ; elles sont
     décalées vers le nouvel espace juste après. `ANCIEN_FIRST_ITEM` sert de
     pivot à la migration d'une sauvegarde ou d'un monde serveur antérieurs
     (save.js, server.js). */
  var ANCIEN_FIRST_ITEM = 128;
  /* Les objets démarraient à 64 avant l'arrivée des biomes : une sauvegarde
     de cette époque est convertie au chargement par ce décalage (vers
     l'ancien espace 128, puis vers le nouveau ci-dessous). */
  var DECALAGE_OBJETS_V1 = 64;
  // nouvel espace (SPEC-SAVE-017) : les blocs vont de 1 à 4095, les objets
  // commencent à 4096 — largement assez de marge pour L24/L29 et la suite.
  var FIRST_ITEM = 4096;
  (function () {
    var decalage = FIRST_ITEM - ANCIEN_FIRST_ITEM;
    for (var nomObjet in I) I[nomObjet] += decalage;
  })();
  function isBlock(id) { return id > 0 && id < FIRST_ITEM; }
  function isItem(id) { return id >= FIRST_ITEM; }

  // ─── définitions des blocs ─────────────────────────────────────────────────
  // tiles : [dessus, côté, dessous] dans l'atlas.
  // hardness : secondes pour casser à main nue (0 = instantané).
  // tool : classe d'outil efficace. needsTool : sans le bon outil, aucun drop.
  // plant : pas de collision, cassable instantanément.
  var BLOCKS = [];
  function defBlock(id, o) { o.id = id; BLOCKS[id] = o; return o; }

  defBlock(B.GRASS,  { name: 'Herbe', tiles: [0, 1, 2], hardness: 0.6, tool: 'shovel',
                       drops: [{ id: B.DIRT, n: 1 }, { id: I.SEEDS, n: 1, chance: 0.25 }] });
  defBlock(B.DIRT,   { name: 'Terre', tiles: [2, 2, 2], hardness: 0.5, tool: 'shovel' });
  defBlock(B.STONE,  { name: 'Pierre', tiles: [3, 3, 3], hardness: 1.5, tool: 'pickaxe',
                       needsTool: true, drops: [{ id: B.COBBLE, n: 1 }] });
  defBlock(B.SAND,   { name: 'Sable', tiles: [4, 4, 4], hardness: 0.5, tool: 'shovel' });
  defBlock(B.LOG,    { name: 'Tronc', tiles: [6, 5, 6], hardness: 2.0, tool: 'axe' });
  defBlock(B.LEAVES, { name: 'Feuilles', tiles: [7, 7, 7], hardness: 0.2, transparent: true,
                       pass: 'cutout',
                       drops: [{ id: I.STICK, n: 1, chance: 0.35 }] });
  defBlock(B.PLANKS, { name: 'Planche', tiles: [8, 8, 8], hardness: 2.0, tool: 'axe' });
  defBlock(B.COBBLE, { name: 'Pavé', tiles: [9, 9, 9], hardness: 2.0, tool: 'pickaxe', needsTool: true });
  defBlock(B.BRICK,  { name: 'Brique', tiles: [10, 10, 10], hardness: 2.2, tool: 'pickaxe', needsTool: true });
  defBlock(B.GLASS,  { name: 'Verre', tiles: [11, 11, 11], hardness: 0.4, transparent: true,
                     pass: 'blend', drops: [] });
  defBlock(B.WATER,  { name: 'Eau', tiles: [12, 12, 12], transparent: true, liquid: true, pass: 'blend',
                       hardness: -1, drops: [] });
  /* Eau courante : même matière que l'eau, mais elle coule (MC.Eau.ecouler) et
     sa surface descend avec son niveau. Elle ne se ramasse pas. */
  [1, 2, 3, 4, 5, 6, 7].forEach(function (n) {
    defBlock(B['EAU_' + n], { name: 'Eau courante', tiles: [12, 12, 12], transparent: true, liquid: true, pass: 'blend',
                              hardness: -1, drops: [], eauCourante: n });
  });
  // ─── portes et trappes ──────────────────────────────────────────────────────
  /* Un bloc est plein ou non (isSolid) : pas de case pour un panneau qui n'en
     occupe qu'une tranche. On ajoute donc une géométrie locale `panneau`
     (boîte [x0,y0,z0]-[x1,y1,z1] dans le cube unité) que le mailleur dessine
     et que la physique utilise comme boîte de collision partielle (boiteDe).
     L'orientation (mur nord/est/sud/ouest, 0..3) et l'état (ouverte ou non)
     ne sont pas des métadonnées à part : ils SONT l'identifiant de bloc —
     8 ids pour la porte (fermée × 4 murs, ouverte × 4 murs), 2 pour la
     trappe (elle n'a besoin d'aucune orientation stockée : elle se relève
     toujours contre la même face, un choix qui économise des ids sans
     changer le jeu observable). Les deux moitiés (bas/haut) d'une porte
     partagent le même id : le panneau qu'elles dessinent est identique. */
  var EPAIS_PANNEAU = 3 / 16;
  // boîte d'un panneau plein-hauteur flush contre le mur `mur` (0=N,1=E,2=S,3=O)
  function boiteMur(mur) {
    var e = EPAIS_PANNEAU;
    if (mur === 0) return { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: e };
    if (mur === 1) return { x0: 1 - e, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 };
    if (mur === 2) return { x0: 0, y0: 0, z0: 1 - e, x1: 1, y1: 1, z1: 1 };
    return { x0: 0, y0: 0, z0: 0, x1: e, y1: 1, z1: 1 };
  }
  /* Ouverte, la porte pivote d'un quart de tour et vient se plaquer contre le
     mur adjacent (celui qui portait sa charnière) : le mur (mur+3)%4, c-à-d
     le précédent dans le cycle N,E,S,O. */
  function boiteMurOuverte(mur) { return boiteMur((mur + 3) & 3); }

  var PORTE_FERMEE_LIST = [B.PORTE_FERMEE_N, B.PORTE_FERMEE_E, B.PORTE_FERMEE_S, B.PORTE_FERMEE_O];
  var PORTE_OUVERTE_LIST = [B.PORTE_OUVERTE_N, B.PORTE_OUVERTE_E, B.PORTE_OUVERTE_S, B.PORTE_OUVERTE_O];
  var NOMS_MUR = ['nord', 'est', 'sud', 'ouest'];
  PORTE_FERMEE_LIST.forEach(function (id, mur) {
    defBlock(id, { name: 'Porte (' + NOMS_MUR[mur] + ', fermée)', tiles: [190, 190, 190],
                   hardness: 2.0, tool: 'axe', transparent: true, pass: 'cutout',
                   panneau: boiteMur(mur), porte: { wall: mur, ouverte: false } });
  });
  PORTE_OUVERTE_LIST.forEach(function (id, mur) {
    defBlock(id, { name: 'Porte (' + NOMS_MUR[mur] + ', ouverte)', tiles: [190, 190, 190],
                   hardness: 2.0, tool: 'axe', transparent: true, pass: 'cutout',
                   panneau: boiteMurOuverte(mur), porte: { wall: mur, ouverte: true } });
  });
  defBlock(B.TRAPPE_FERMEE, { name: 'Trappe (fermée)', tiles: [191, 191, 191],
                             hardness: 2.0, tool: 'axe', transparent: true, pass: 'cutout',
                             panneau: { x0: 0, y0: 0, z0: 0, x1: 1, y1: EPAIS_PANNEAU, z1: 1 },
                             trappe: { ouverte: false } });
  defBlock(B.TRAPPE_OUVERTE, { name: 'Trappe (ouverte)', tiles: [191, 191, 191],
                              hardness: 2.0, tool: 'axe', transparent: true, pass: 'cutout',
                              panneau: { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: EPAIS_PANNEAU },
                              trappe: { ouverte: true } });

  defBlock(B.CRAFTING_TABLE, { name: 'Établi', tiles: [13, 14, 8], hardness: 2.5, tool: 'axe',
                               interactive: 'craft' });
  defBlock(B.FURNACE, { name: 'Fourneau', tiles: [16, 15, 16], hardness: 3.5, tool: 'pickaxe',
                        needsTool: true, interactive: 'furnace' });
  defBlock(B.FARMLAND, { name: 'Terre labourée', tiles: [17, 2, 2], hardness: 0.5, tool: 'shovel',
                         drops: [{ id: B.DIRT, n: 1 }] });
  defBlock(B.COAL_ORE, { name: 'Minerai de charbon', tiles: [22, 22, 22], hardness: 3.0,
                         tool: 'pickaxe', needsTool: true, drops: [{ id: I.COAL, n: 1 }] });
  defBlock(B.IRON_ORE, { name: 'Minerai de fer', tiles: [23, 23, 23], hardness: 3.0,
                         tool: 'pickaxe', needsTool: true, minTier: 2,
                         drops: [{ id: B.IRON_ORE, n: 1 }] });
  defBlock(B.WOOL,   { name: 'Laine', tiles: [24, 24, 24], hardness: 0.8 });
  defBlock(B.BEDROCK, { name: 'Socle', tiles: [25, 25, 25], hardness: -1, drops: [] });
  // Torche : pas de collision, cassable d'un coup, et surtout `light` — c'est
  // ce champ que la couche rendu utilise pour placer ses lumieres ponctuelles.
  defBlock(B.TORCH, { name: 'Torche', tiles: [50, 50, 50], hardness: 0,
                      transparent: true, plant: true, pass: 'cutout',
                      light: 12, needsSupport: true });
  defBlock(B.CHEST, { name: 'Coffre', tiles: [52, 51, 51], hardness: 2.5, tool: 'axe',
                      interactive: 'chest' });

  // ─── biomes ───────────────────────────────────────────────────────────────
  defBlock(B.SNOW,   { name: 'Neige', tiles: [56, 57, 2], hardness: 0.5, tool: 'shovel' });
  // la glace est un fondu, comme le verre : on voit l'eau prise dessous
  defBlock(B.ICE,    { name: 'Glace', tiles: [58, 58, 58], hardness: 0.5, tool: 'pickaxe',
                       transparent: true, pass: 'blend', drops: [] });
  defBlock(B.SANDSTONE, { name: 'Grès', tiles: [59, 60, 59], hardness: 0.8, tool: 'pickaxe',
                          needsTool: true });
  // cactus : plein, mais il pique (voir player.updateSurvival)
  defBlock(B.CACTUS, { name: 'Cactus', tiles: [61, 62, 61], hardness: 0.4, hurts: 1 });
  defBlock(B.BIRCH_LOG, { name: 'Tronc de bouleau', tiles: [6, 63, 6], hardness: 2.0, tool: 'axe',
                          log: true });
  defBlock(B.BIRCH_LEAVES, { name: 'Feuilles de bouleau', tiles: [64, 64, 64], hardness: 0.2,
                             transparent: true, pass: 'cutout', leaves: true,
                             drops: [{ id: I.STICK, n: 1, chance: 0.35 }] });
  defBlock(B.SPRUCE_LOG, { name: 'Tronc de sapin', tiles: [6, 65, 6], hardness: 2.0, tool: 'axe',
                           log: true });
  // aiguilles de sapin : un conifère (SPEC-SAISON-004) — reste vert à toute saison
  defBlock(B.SPRUCE_LEAVES, { name: 'Aiguilles de sapin', tiles: [66, 66, 66], hardness: 0.2,
                              transparent: true, pass: 'cutout', leaves: true, conifere: true,
                              drops: [{ id: I.STICK, n: 1, chance: 0.35 }] });
  // végétation basse : des plantes, donc traversables et cassées d'un coup
  defBlock(B.TALL_GRASS, { name: 'Hautes herbes', tiles: [67, 67, 67], hardness: 0,
                           transparent: true, plant: true, pass: 'cutout', needsSupport: 'sol',
                           drops: [{ id: I.SEEDS, n: 1, chance: 0.15 }] });
  defBlock(B.FLOWER_RED, { name: 'Coquelicot', tiles: [68, 68, 68], hardness: 0,
                           transparent: true, plant: true, pass: 'cutout', needsSupport: 'sol' });
  defBlock(B.FLOWER_YELLOW, { name: 'Pissenlit', tiles: [69, 69, 69], hardness: 0,
                              transparent: true, plant: true, pass: 'cutout', needsSupport: 'sol' });
  defBlock(B.DEAD_BUSH, { name: 'Buisson mort', tiles: [70, 70, 70], hardness: 0,
                          transparent: true, plant: true, pass: 'cutout', needsSupport: 'sol',
                          drops: [{ id: I.STICK, n: 1, chance: 0.5 }] });
  defBlock(B.MUSHROOM, { name: 'Champignon', tiles: [71, 71, 71], hardness: 0,
                         transparent: true, plant: true, pass: 'cutout', needsSupport: 'sol' });
  defBlock(B.MOSSY_COBBLE, { name: 'Pierre moussue', tiles: [72, 72, 72], hardness: 2.0,
                             tool: 'pickaxe', needsTool: true });
  defBlock(B.STONE_BRICK, { name: 'Brique de pierre', tiles: [73, 73, 73], hardness: 2.0,
                            tool: 'pickaxe', needsTool: true });
  // ─── volcans et glaciers ─────────────────────────────────────────────────
  /* La lave : un liquide, comme l'eau, mais qui brûle (`brule` PV par
     demi-seconde) et luit. `pass: 'lumineux'` la dessine sans éclairage :
     de nuit, elle reste vive au lieu de s'éteindre avec le soleil. */
  defBlock(B.LAVA, { name: 'Lave', tiles: [166, 166, 166], transparent: true, liquid: true, lave: true,
                     pass: 'lumineux', hardness: -1, light: 15, brule: 4, sansLampe: true,
                     drops: [] });
  defBlock(B.BASALT, { name: 'Basalte', tiles: [167, 168, 167], hardness: 1.6, tool: 'pickaxe', needsTool: true });
  defBlock(B.MAGMA, { name: 'Magma', tiles: [169, 169, 169], hardness: 0.8, tool: 'pickaxe', pass: 'lumineux',
                      light: 9, hurts: 1, sansLampe: true });
  defBlock(B.BLUE_ICE, { name: 'Glace bleue', tiles: [170, 170, 170], hardness: 1.4, tool: 'pickaxe' });

  // le chêne d'origine rejoint les familles « tronc » et « feuillage »
  BLOCKS[B.LOG].log = true;
  BLOCKS[B.LEAVES].leaves = true;
  // les chênes lâchent parfois une pomme
  BLOCKS[B.LEAVES].drops = [{ id: I.STICK, n: 1, chance: 0.35 }, { id: I.APPLE, n: 1, chance: 0.06 }];

  // ─── biomes exotiques ──────────────────────────────────────────────────────
  defBlock(B.JUNGLE_LOG, { name: 'Tronc tropical', tiles: [6, 77, 6], hardness: 2.0, tool: 'axe', log: true });
  defBlock(B.JUNGLE_LEAVES, { name: 'Feuilles tropicales', tiles: [78, 78, 78], hardness: 0.2,
                              transparent: true, pass: 'cutout', leaves: true,
                              drops: [{ id: I.STICK, n: 1, chance: 0.3 }] });
  defBlock(B.ACACIA_LOG, { name: "Tronc d'acacia", tiles: [6, 79, 6], hardness: 2.0, tool: 'axe', log: true });
  defBlock(B.ACACIA_LEAVES, { name: "Feuilles d'acacia", tiles: [80, 80, 80], hardness: 0.2,
                              transparent: true, pass: 'cutout', leaves: true,
                              drops: [{ id: I.STICK, n: 1, chance: 0.3 }] });
  // lianes et échelles : on s'y accroche (voir player.updateMovement)
  defBlock(B.VINES, { name: 'Lianes', tiles: [81, 81, 81], hardness: 0, transparent: true,
                      plant: true, pass: 'cutout', grimpable: true });
  defBlock(B.RED_SAND, { name: 'Sable rouge', tiles: [82, 82, 82], hardness: 0.5, tool: 'shovel' });
  defBlock(B.TERRACOTTA, { name: 'Terre cuite', tiles: [83, 83, 83], hardness: 1.2, tool: 'pickaxe' });
  defBlock(B.TERRACOTTA_RED, { name: 'Terre cuite rouge', tiles: [84, 84, 84], hardness: 1.2, tool: 'pickaxe' });
  defBlock(B.TERRACOTTA_YELLOW, { name: 'Terre cuite ocre', tiles: [85, 85, 85], hardness: 1.2, tool: 'pickaxe' });
  defBlock(B.PACKED_ICE, { name: 'Glace compacte', tiles: [86, 86, 86], hardness: 0.6, tool: 'pickaxe' });
  defBlock(B.MYCELIUM, { name: 'Mycélium', tiles: [87, 88, 2], hardness: 0.6, tool: 'shovel',
                         drops: [{ id: B.DIRT, n: 1 }] });
  defBlock(B.MUSHROOM_CAP, { name: 'Chapeau de champignon', tiles: [89, 89, 89], hardness: 0.3, tool: 'axe',
                             drops: [{ id: B.MUSHROOM, n: 1, chance: 0.4 }] });
  defBlock(B.MUSHROOM_STEM, { name: 'Pied de champignon', tiles: [90, 90, 90], hardness: 0.3, tool: 'axe',
                              drops: [{ id: B.MUSHROOM, n: 1, chance: 0.2 }] });
  defBlock(B.MELON, { name: 'Pastèque', tiles: [91, 92, 91], hardness: 1.0, tool: 'axe',
                      drops: [{ id: I.MELON_SLICE, n: 3 }, { id: I.MELON_SLICE, n: 2, chance: 0.5 }] });
  defBlock(B.GRAVEL, { name: 'Gravier', tiles: [93, 93, 93], hardness: 0.6, tool: 'shovel' });
  defBlock(B.CLAY, { name: 'Argile', tiles: [94, 94, 94], hardness: 0.6, tool: 'shovel' });

  // ─── mer ───────────────────────────────────────────────────────────────────
  /* `aquatique` : une plante qui pousse DANS l'eau. Pour la nage, la noyade et
     le maillage de l'eau, sa case compte comme de l'eau ; sinon chaque brin de
     varech découperait une bulle d'air dans l'océan. */
  function planteMarine(id, nom, tile, extra) {
    var o = { name: nom, tiles: [tile, tile, tile], hardness: 0, transparent: true, plant: true,
              pass: 'cutout', aquatique: true, needsSupport: 'sol', drops: [] };
    if (extra) for (var k in extra) o[k] = extra[k];
    return defBlock(id, o);
  }
  planteMarine(B.KELP, 'Varech', 95, { needsSupport: false, drops: [{ id: B.KELP, n: 1 }] });
  planteMarine(B.SEAGRASS, 'Herbier marin', 96);
  defBlock(B.CORAL_RED, { name: 'Corail rouge', tiles: [97, 97, 97], hardness: 0.8, tool: 'pickaxe' });
  defBlock(B.CORAL_YELLOW, { name: 'Corail jaune', tiles: [98, 98, 98], hardness: 0.8, tool: 'pickaxe' });
  defBlock(B.CORAL_BLUE, { name: 'Corail bleu', tiles: [99, 99, 99], hardness: 0.8, tool: 'pickaxe' });
  planteMarine(B.CORAL_FAN_RED, 'Gorgone rouge', 100, { drops: [{ id: I.DYE_RED, n: 1, chance: 0.5 }] });
  planteMarine(B.CORAL_FAN_YELLOW, 'Gorgone jaune', 101, { drops: [{ id: I.DYE_YELLOW, n: 1, chance: 0.5 }] });
  planteMarine(B.CORAL_FAN_BLUE, 'Gorgone bleue', 102, { drops: [{ id: I.DYE_BLUE, n: 1, chance: 0.5 }] });
  defBlock(B.SPONGE, { name: 'Éponge', tiles: [103, 103, 103], hardness: 0.6 });
  defBlock(B.PRISMARINE, { name: 'Prismarine', tiles: [104, 104, 104], hardness: 1.5, tool: 'pickaxe',
                           needsTool: true });
  defBlock(B.PRISMARINE_BRICK, { name: 'Briques de prismarine', tiles: [105, 105, 105], hardness: 1.5,
                                 tool: 'pickaxe', needsTool: true });
  // elle luit dans le noir des abysses : dessinée sans éclairage
  defBlock(B.SEA_LANTERN, { name: 'Lanterne marine', tiles: [106, 106, 106], hardness: 0.3, light: 15, pass: 'lumineux',
                            drops: [{ id: I.PRISMARINE_SHARD, n: 2 }] });
  planteMarine(B.SEA_PICKLE, 'Cornichon de mer', 107, { light: 6, drops: [{ id: B.SEA_PICKLE, n: 1 }] });

  // ─── minerais et structures ────────────────────────────────────────────────
  defBlock(B.GOLD_ORE, { name: "Minerai d'or", tiles: [108, 108, 108], hardness: 3.0, tool: 'pickaxe',
                         needsTool: true, minTier: 3 });
  defBlock(B.DIAMOND_ORE, { name: 'Minerai de diamant', tiles: [109, 109, 109], hardness: 3.5,
                            tool: 'pickaxe', needsTool: true, minTier: 3, drops: [{ id: I.DIAMOND, n: 1 }] });
  defBlock(B.GOLD_BLOCK, { name: "Bloc d'or", tiles: [110, 110, 110], hardness: 3.0, tool: 'pickaxe',
                           needsTool: true });
  defBlock(B.LANTERN, { name: 'Lanterne', tiles: [111, 111, 111], hardness: 0.5, transparent: true,
                        plant: true, pass: 'cutout', light: 13, needsSupport: true });
  defBlock(B.BOOKSHELF, { name: 'Bibliothèque', tiles: [8, 112, 8], hardness: 1.5, tool: 'axe' });
  defBlock(B.SANDSTONE_BRICK, { name: 'Grès taillé', tiles: [113, 113, 113], hardness: 1.2,
                                tool: 'pickaxe', needsTool: true });
  defBlock(B.ICE_BRICK, { name: 'Briques de glace', tiles: [114, 114, 114], hardness: 1.2,
                          tool: 'pickaxe', needsTool: true });
  // ─── habitations : essences de bois, toitures, enduits, mobilier ──────────
  defBlock(B.PLANCHES_SAPIN,   { name: 'Planches de sapin', tiles: [173, 173, 173], hardness: 2.0, tool: 'axe' });
  defBlock(B.PLANCHES_BOULEAU, { name: 'Planches de bouleau', tiles: [174, 174, 174], hardness: 2.0, tool: 'axe' });
  defBlock(B.PLANCHES_ACACIA,  { name: "Planches d'acacia", tiles: [175, 175, 175], hardness: 2.0, tool: 'axe' });
  defBlock(B.PLANCHES_JUNGLE,  { name: 'Planches de jungle', tiles: [176, 176, 176], hardness: 2.0, tool: 'axe' });
  defBlock(B.TUILES,  { name: 'Tuiles', tiles: [177, 177, 177], hardness: 1.6, tool: 'pickaxe' });
  defBlock(B.ARDOISE, { name: 'Ardoise', tiles: [178, 178, 178], hardness: 1.8, tool: 'pickaxe' });
  defBlock(B.CHAUX,   { name: 'Enduit à la chaux', tiles: [179, 179, 179], hardness: 1.2, tool: 'pickaxe' });
  defBlock(B.PAVE,    { name: 'Pavé de rue', tiles: [180, 180, 180], hardness: 1.8, tool: 'pickaxe', needsTool: true });
  defBlock(B.COMPTOIR, { name: 'Comptoir', tiles: [181, 182, 8], hardness: 2.0, tool: 'axe' });
  // le coffre-fort ouvre le compte en banque, commun à toutes les banques
  defBlock(B.COFFRE_FORT, { name: 'Coffre-fort', tiles: [183, 183, 183], hardness: 6, tool: 'pickaxe',
                            needsTool: true, minTier: 2, interactive: 'banque' });
  defBlock(B.TONNEAU, { name: 'Tonneau', tiles: [184, 185, 184], hardness: 2.0, tool: 'axe' });
  defBlock(B.ENCLUME, { name: 'Enclume', tiles: [186, 186, 186], hardness: 5, tool: 'pickaxe', needsTool: true });
  // le panneau d'un point info : il indique les lieux alentour
  defBlock(B.PANNEAU_INFO, { name: "Panneau d'information", tiles: [187, 8, 8], hardness: 1.0, tool: 'axe',
                             interactive: 'info' });
  defBlock(B.OBSIDIAN, { name: 'Obsidienne', tiles: [115, 115, 115], hardness: 12, tool: 'pickaxe',
                         needsTool: true, minTier: 4 });

  // ─── minerais (SPEC-MINERAI-001) ───────────────────────────────────────────
  /* Faute d'identifiants de bloc libres (127 au plus, voir B), plusieurs
     matières partagent un même filon : casser le bloc lâche l'une ou l'autre
     au hasard (parfois les deux), plutôt que de réserver un identifiant par
     matière. Chaque matière garde son propre outil minimal et sa propre
     profondeur de génération (voir world.js:filon). */
  defBlock(B.MINERAI_METAUX, { name: 'Minerai de cuivre et étain', tiles: [227, 227, 227],
                               hardness: 3.0, tool: 'pickaxe', needsTool: true, minTier: 1,
                               drops: [{ id: I.CUIVRE_BRUT, n: 1 }, { id: I.ETAIN_BRUT, n: 1 }] });
  defBlock(B.MINERAI_ARGENT, { name: "Minerai d'argent et de lapis", tiles: [228, 228, 228],
                               hardness: 3.2, tool: 'pickaxe', needsTool: true, minTier: 2,
                               drops: [{ id: I.ARGENT_BRUT, n: 1 }, { id: I.LAPIS, n: 1 }] });
  defBlock(B.MINERAI_GEMMES, { name: 'Filon de gemmes', tiles: [229, 229, 229],
                               hardness: 3.5, tool: 'pickaxe', needsTool: true, minTier: 3,
                               drops: [{ id: I.EMERALD, n: 1 }, { id: I.RUBIS, n: 1, chance: 0.4 },
                                       { id: I.SAPHIR, n: 1, chance: 0.4 }] });
  defBlock(B.MINERAI_CRISTAL, { name: 'Minerai de quartz et de soufre', tiles: [230, 230, 230],
                                hardness: 2.5, tool: 'pickaxe', needsTool: true, minTier: 1,
                                drops: [{ id: I.QUARTZ, n: 1 }, { id: I.SOUFRE, n: 1, chance: 0.4 }] });
  // le sel se ramasse comme le sable : il est lui-même l'objet d'inventaire
  defBlock(B.SEL, { name: 'Sel', tiles: [231, 231, 231], hardness: 0.6, tool: 'shovel' });

  // ─── bioluminescence des profondeurs (SPEC-LUMIERE-007) ────────────────────
  defBlock(B.CHAMPI_LUMINEUX, { name: 'Champignon lumineux', tiles: [232, 232, 232], hardness: 0,
                                transparent: true, plant: true, pass: 'cutout', needsSupport: 'sol',
                                light: 9 });
  defBlock(B.CRISTAL_LUMINEUX, { name: 'Cristal lumineux', tiles: [233, 233, 233], hardness: 1.2,
                                 tool: 'pickaxe', light: 11, pass: 'lumineux', sansLampe: false });
  planteMarine(B.ALGUE_LUMINEUSE, 'Algue luminescente', 234, { light: 8 });
  planteMarine(B.PLANCTON_LUMINEUX, 'Plancton luminescent', 235, { light: 6 });
  // la toile se traverse, mais on s'y englue (voir player.updateMovement)
  defBlock(B.COBWEB, { name: "Toile d'araignée", tiles: [116, 116, 116], hardness: 1.0, tool: 'sword',
                       transparent: true, plant: true, pass: 'cutout', ralentit: 0.25,
                       drops: [{ id: I.FICELLE, n: 1 }] });
  defBlock(B.RAIL, { name: 'Rail', tiles: [117, 117, 117], hardness: 0.7, transparent: true, plant: true,
                     pass: 'cutout', plat: true, needsSupport: 'sol' });
  defBlock(B.HAY, { name: 'Botte de foin', tiles: [118, 119, 118], hardness: 0.5 });
  defBlock(B.WOOL_RED, { name: 'Laine rouge', tiles: [120, 120, 120], hardness: 0.8 });
  defBlock(B.WOOL_BLUE, { name: 'Laine bleue', tiles: [121, 121, 121], hardness: 0.8 });
  defBlock(B.WOOL_YELLOW, { name: 'Laine jaune', tiles: [122, 122, 122], hardness: 0.8 });
  defBlock(B.WOOL_GREEN, { name: 'Laine verte', tiles: [123, 123, 123], hardness: 0.8 });
  defBlock(B.LADDER, { name: 'Échelle', tiles: [124, 124, 124], hardness: 0.4, tool: 'axe',
                       transparent: true, plant: true, pass: 'cutout', grimpable: true });

  // blé : 4 stades, non solides, cassables instantanément
  var WHEAT_STAGES = [B.WHEAT0, B.WHEAT1, B.WHEAT2, B.WHEAT3];
  WHEAT_STAGES.forEach(function (id, s) {
    defBlock(id, {
      name: 'Blé (' + s + '/3)', tiles: [18 + s, 18 + s, 18 + s], hardness: 0,
      transparent: true, plant: true, pass: 'cutout', stage: s,
      drops: s === 3
        ? [{ id: I.WHEAT, n: 1 }, { id: I.WHEAT, n: 1, chance: 0.6 }, { id: I.SEEDS, n: 1 },
           { id: I.SEEDS, n: 1, chance: 0.5 }]
        : [{ id: I.SEEDS, n: 1 }],
    });
  });

  // ─── définitions des objets ────────────────────────────────────────────────
  // tool : classe, tier : 1 bois, 2 pierre, 3 fer. food : points de faim rendus.
  var ITEMS = [];
  function defItem(id, o) { o.id = id; ITEMS[id] = o; return o; }

  defItem(I.STICK, { name: 'Bâton', tile: 26 });
  defItem(I.COAL, { name: 'Charbon', tile: 27, fuel: 8 });
  defItem(I.IRON_INGOT, { name: 'Lingot de fer', tile: 28 });
  defItem(I.WHEAT, { name: 'Blé', tile: 29 });
  defItem(I.SEEDS, { name: 'Graines', tile: 30, plantable: B.WHEAT0 });
  defItem(I.BREAD, { name: 'Pain', tile: 31, food: 5 });
  defItem(I.RAW_MUTTON, { name: 'Mouton cru', tile: 32, food: 2 });
  defItem(I.COOKED_MUTTON, { name: 'Mouton cuit', tile: 33, food: 6 });
  defItem(I.ROTTEN_FLESH, { name: 'Chair putréfiée', tile: 34, food: 1 });
  defItem(I.EMERALD, { name: 'Émeraude', tile: 35 });
  defItem(I.FICELLE, { name: 'Ficelle', tile: 53 });
  // `ranged` : l'arme tire un projectile au lieu de frapper au corps a corps
  defItem(I.ARC, { name: 'Arc', tile: 54, ranged: 'fleche', maxStack: 1,
                   durability: 180, damage: 1 });
  defItem(I.FLECHE, { name: 'Flèche', tile: 55, ammo: true, damage: 5 });
  defItem(I.RAW_PORK, { name: 'Porc cru', tile: 74, food: 3 });
  defItem(I.COOKED_PORK, { name: 'Porc cuit', tile: 75, food: 8 });
  // butin des miniboss : ni recette ni four, il faut vaincre un gardien
  defItem(I.EPEE_RUNIQUE, { name: 'Épée runique', tile: 76, tool: 'sword', tier: 3,
                            damage: 11, durability: 600, maxStack: 1 });

  var TOOL_DEFS = [
    ['pickaxe', [I.WOOD_PICKAXE, I.STONE_PICKAXE, I.IRON_PICKAXE], 'Pioche', 36],
    ['axe',     [I.WOOD_AXE, I.STONE_AXE, I.IRON_AXE], 'Hache', 39],
    ['shovel',  [I.WOOD_SHOVEL, I.STONE_SHOVEL, I.IRON_SHOVEL], 'Pelle', 42],
    ['sword',   [I.WOOD_SWORD, I.STONE_SWORD, I.IRON_SWORD], 'Épée', 45],
    ['hoe',     [I.WOOD_HOE, I.STONE_HOE], 'Houe', 48],
  ];
  var TIER_NAME = ['', 'en bois', 'en pierre', 'en fer', 'en diamant'];
  var TIER_DURABILITY = [0, 60, 132, 251, 1561];      // bois, pierre, fer, diamant
  TOOL_DEFS.forEach(function (d) {
    d[1].forEach(function (id, i) {
      defItem(id, {
        name: d[2] + ' ' + TIER_NAME[i + 1], tile: d[3] + i, tool: d[0], tier: i + 1,
        // une épée fait mal, les autres outils un peu ; la main nue fait 1
        damage: d[0] === 'sword' ? 3 + i * 2 : 2 + i,
        durability: TIER_DURABILITY[i + 1],
        maxStack: 1,
      });
    });
  });

  // ─── accès générique ───────────────────────────────────────────────────────
  // outils en diamant : même gabarit que les autres, un rang au-dessus
  [['pickaxe', I.DIAMOND_PICKAXE, 'Pioche', 145], ['axe', I.DIAMOND_AXE, 'Hache', 146],
   ['shovel', I.DIAMOND_SHOVEL, 'Pelle', 147], ['sword', I.DIAMOND_SWORD, 'Épée', 148]].forEach(function (d) {
    defItem(d[1], { name: d[2] + ' ' + TIER_NAME[4], tile: d[3], tool: d[0], tier: 4,
                    damage: d[0] === 'sword' ? 9 : 5, durability: TIER_DURABILITY[4], maxStack: 1 });
  });

  // ─── matières, nourriture ──────────────────────────────────────────────────
  defItem(I.GOLD_INGOT, { name: "Lingot d'or", tile: 125 });
  defItem(I.DIAMOND, { name: 'Diamant', tile: 126 });
  defItem(I.FEATHER, { name: 'Plume', tile: 127 });
  defItem(I.BONE, { name: 'Os', tile: 128 });
  // l'engrais fait mûrir une culture d'un coup (voir player.useOn)
  defItem(I.BONE_MEAL, { name: "Poudre d'os", tile: 129, engrais: true });
  defItem(I.PRISMARINE_SHARD, { name: 'Éclat de prismarine', tile: 130 });
  defItem(I.INK_SAC, { name: "Poche d'encre", tile: 131 });
  defItem(I.DYE_RED, { name: 'Teinture rouge', tile: 132 });
  defItem(I.DYE_YELLOW, { name: 'Teinture jaune', tile: 133 });
  defItem(I.DYE_BLUE, { name: 'Teinture bleue', tile: 134 });
  defItem(I.DYE_GREEN, { name: 'Teinture verte', tile: 135 });
  defItem(I.APPLE, { name: 'Pomme', tile: 136, food: 4 });
  // la pomme dorée soigne en plus de nourrir
  defItem(I.GOLDEN_APPLE, { name: 'Pomme dorée', tile: 137, food: 6, soin: 10 });
  defItem(I.RAW_FISH, { name: 'Poisson cru', tile: 138, food: 2 });
  defItem(I.COOKED_FISH, { name: 'Poisson cuit', tile: 139, food: 6 });
  defItem(I.BOWL, { name: 'Bol', tile: 140 });
  defItem(I.MUSHROOM_STEW, { name: 'Soupe de champignons', tile: 141, food: 7, rend: I.BOWL, maxStack: 1 });
  defItem(I.MELON_SLICE, { name: 'Tranche de pastèque', tile: 142, food: 2 });
  defItem(I.RAW_CHICKEN, { name: 'Volaille crue', tile: 143, food: 2 });
  defItem(I.COOKED_CHICKEN, { name: 'Volaille rôtie', tile: 144, food: 6 });

  // ─── armes ─────────────────────────────────────────────────────────────────
  // l'arbalète tire plus fort et plus droit que l'arc
  defItem(I.ARBALETE, { name: 'Arbalète', tile: 149, ranged: 'fleche', maxStack: 1, durability: 320,
                        damage: 1, vitesseTir: 46, bonusTir: 3 });
  // trésors de gardiens : aucune recette, aucun four
  defItem(I.KHEPESH, { name: 'Khépesh du pharaon', tile: 150, tool: 'sword', tier: 4, damage: 10,
                       durability: 700, maxStack: 1 });
  defItem(I.HACHE_GIVRE, { name: 'Hache de givre', tile: 151, tool: 'axe', tier: 4, damage: 10,
                           durability: 700, maxStack: 1 });
  defItem(I.ARC_JUNGLE, { name: 'Arc de la jungle', tile: 152, ranged: 'fleche', maxStack: 1,
                          durability: 500, damage: 1, vitesseTir: 44, bonusTir: 4 });
  // le bâton ne consomme rien : il lance des sortilèges
  defItem(I.BATON_SORCIERE, { name: 'Bâton de la sorcière', tile: 153, ranged: 'sortilege', sansMunition: true,
                              maxStack: 1, durability: 400, damage: 1, vitesseTir: 30, degatsTir: 7 });
  defItem(I.LANCE_CIMES, { name: 'Lance des cimes', tile: 154, tool: 'sword', tier: 4, damage: 12,
                           durability: 800, maxStack: 1 });
  defItem(I.TRIDENT, { name: 'Trident', tile: 155, tool: 'sword', tier: 4, damage: 11, durability: 800,
                       maxStack: 1, nageRapide: true });
  defItem(I.SABRE_CAPITAINE, { name: 'Sabre du capitaine', tile: 156, tool: 'sword', tier: 4, damage: 10,
                               durability: 650, maxStack: 1 });

  // ─── véhicules ─────────────────────────────────────────────────────────────
  defItem(I.ROUE, { name: 'Roue', tile: 157 });
  defItem(I.MOTEUR, { name: 'Moteur', tile: 158 });
  defItem(I.HELICE, { name: 'Hélice', tile: 159 });
  // `vehicule` : poser l'objet fait apparaître le véhicule (voir vehicules.js)
  [[I.BATEAU, 'Bateau', 'bateau'], [I.MOTO, 'Moto', 'moto'], [I.VOITURE, 'Voiture', 'voiture'],
   [I.CAMION, 'Camion', 'camion'], [I.AVION, 'Avion', 'avion'], [I.SOUS_MARIN, 'Sous-marin', 'sous_marin']]
    .forEach(function (v, i) { defItem(v[0], { name: v[1], tile: 160 + i, vehicule: v[2], maxStack: 1 }); });
  // le wagonnet ne roule que sur des rails
  defItem(I.WAGONNET, { name: 'Wagonnet', tile: 171, vehicule: 'wagonnet', maxStack: 1 });
  // la carte montre les environs explorés et porte des points de repère
  defItem(I.CARTE, { name: 'Carte', tile: 172, carte: true, maxStack: 1 });
  defItem(I.SEAU, { name: 'Seau', tile: 188, seau: 'vide', maxStack: 16 });
  defItem(I.SEAU_EAU, { name: "Seau d'eau", tile: 189, seau: 'plein', maxStack: 1 });
  // porte/trappe : l'objet posé occupe un ou deux blocs (voir player.useOn)
  defItem(I.PORTE, { name: 'Porte en bois', tile: 190, porte: true, maxStack: 16 });
  defItem(I.TRAPPE, { name: 'Trappe', tile: 191, trappe: true, maxStack: 16 });

  // ─── matières des minerais (SPEC-MINERAI-002) ─────────────────────────────
  defItem(I.CUIVRE_BRUT, { name: 'Cuivre brut', tile: 236 });
  defItem(I.CUIVRE_LINGOT, { name: 'Lingot de cuivre', tile: 237 });
  defItem(I.ETAIN_BRUT, { name: 'Étain brut', tile: 238 });
  defItem(I.ETAIN_LINGOT, { name: "Lingot d'étain", tile: 239 });
  defItem(I.ARGENT_BRUT, { name: 'Argent brut', tile: 240 });
  defItem(I.ARGENT_LINGOT, { name: "Lingot d'argent", tile: 241 });
  defItem(I.LAPIS, { name: 'Lapis-lazuli', tile: 242 });
  defItem(I.RUBIS, { name: 'Rubis', tile: 243 });
  defItem(I.SAPHIR, { name: 'Saphir', tile: 244 });
  defItem(I.QUARTZ, { name: 'Quartz', tile: 245 });
  defItem(I.SOUFRE, { name: 'Soufre', tile: 246, fuel: 3 });
  // le bronze : alliage de cuivre et d'étain, un cran au-dessus de la pierre
  defItem(I.BRONZE_LINGOT, { name: 'Lingot de bronze', tile: 247 });
  defItem(I.BRONZE_PIOCHE, { name: 'Pioche en bronze', tile: 248, tool: 'pickaxe', tier: 2,
                             damage: 4, durability: 190, maxStack: 1 });
  defItem(I.BRONZE_HACHE, { name: 'Hache en bronze', tile: 249, tool: 'axe', tier: 2,
                            damage: 4, durability: 190, maxStack: 1 });
  defItem(I.BRONZE_PELLE, { name: 'Pelle en bronze', tile: 250, tool: 'shovel', tier: 2,
                            damage: 4, durability: 190, maxStack: 1 });
  defItem(I.BRONZE_EPEE, { name: 'Épée en bronze', tile: 251, tool: 'sword', tier: 2,
                           damage: 6, durability: 190, maxStack: 1 });
  // bijou : parure de luxe, sans usage d'outil — un objet de commerce
  defItem(I.BIJOU, { name: 'Bijou', tile: 252 });

  /* ─── variantes de tuiles ──────────────────────────────────────────────────
     Une même tuile répétée sur un grand sol dessine un quadrillage. Les tuiles
     de terrain ont donc plusieurs versions, choisies par la position du bloc,
     et les faces supérieures sans sens (herbe, sable, pierre…) tournent d'un
     quart de tour au hasard. `n` : nombre de versions, base comprise ;
     `tourne` : la rotation est permise ; `cote` : tuile de côté (la frange
     d'herbe doit rester en haut, on ne la décale qu'horizontalement). */
  var TUILES_VARIABLES = {
    0: { n: 4, tourne: true }, 1: { n: 3, cote: true }, 2: { n: 4, tourne: true },
    3: { n: 4, tourne: true }, 4: { n: 4, tourne: true }, 7: { n: 3, tourne: true },
    9: { n: 3, tourne: true }, 12: { n: 3, tourne: true }, 56: { n: 3, tourne: true },
    57: { n: 2, cote: true }, 59: { n: 2, tourne: true }, 82: { n: 3, tourne: true },
    86: { n: 2, tourne: true }, 87: { n: 2, tourne: true }, 93: { n: 3, tourne: true },
    78: { n: 2, tourne: true }, 66: { n: 2, tourne: true }, 64: { n: 2, tourne: true },
    94: { n: 2, tourne: true }, 83: { n: 2, tourne: true },
  };
  var PREMIERE_VARIANTE = 192;         // les variantes suivent les tuiles de base dans l'atlas
  var INDEX_VARIANTES = {};            // tuile -> [tuile, variante 1, variante 2, …]
  (function () {
    var suivante = PREMIERE_VARIANTE;
    Object.keys(TUILES_VARIABLES).map(Number).sort(function (a, b) { return a - b; }).forEach(function (t) {
      var l = [t];
      for (var k = 1; k < TUILES_VARIABLES[t].n; k++) l.push(suivante++);
      INDEX_VARIANTES[t] = l;
    });
  })();
  /* Tuile et rotation (en quarts de tour) d'une face, d'après un hachage de
     la position du bloc. `dessus` : face horizontale, seule à pouvoir tourner. */
  function tuileVariante(tile, h, dessus) {
    var l = INDEX_VARIANTES[tile];
    if (!l) return { tile: tile, rot: 0 };
    var info = TUILES_VARIABLES[tile];
    var k = Math.floor(h * 4096) % l.length;
    var rot = (dessus && info.tourne) ? (Math.floor(h * 65536) & 3) : 0;
    return { tile: l[k], rot: rot };
  }

  function def(id) { return isItem(id) ? ITEMS[id] : BLOCKS[id]; }

  /* Trois régimes de rendu, à ne pas confondre :
     'opaque' — écrit la profondeur, aucun tri ;
     'cutout' — alphaTest : le fragment passe ou non, profondeur écrite, pas de tri
                (feuillage, cultures) ;
     'blend'  — fondu réel : exige depthWrite:false et un tri (eau, verre). */
  function passOf(id) { var d = BLOCKS[id]; return (d && d.pass) || 'opaque'; }
  function lightOf(id) { var d = BLOCKS[id]; return (d && d.light) || 0; }
  /* Faut-il une lumière ponctuelle pour ce bloc ? La lave et le magma luisent
     déjà par leur rendu sans éclairage ; en faire des lampes enregistrerait
     chaque bloc d'un lac souterrain, qui raflerait les dix lumières du
     moteur au détriment des torches du joueur. */
  function lampeDe(id) { var d = BLOCKS[id]; return d && !d.sansLampe ? (d.light || 0) : 0; }
  function durabilityOf(id) { var d = ITEMS[id]; return (d && d.durability) || 0; }
  function nameOf(id) { var d = def(id); return d ? d.name : (id === 0 ? 'Air' : '?' + id); }
  function maxStack(id) { var d = def(id); return (d && d.maxStack) || 64; }

  // un bloc arrête-t-il le joueur ?
  // bois et feuillage, toutes essences confondues (groundAt, apparitions)
  function isLog(id) { var d = BLOCKS[id]; return !!d && !!d.log; }
  function isLeaves(id) { var d = BLOCKS[id]; return !!d && !!d.leaves; }
  // conifère (SPEC-SAISON-004) : un feuillage qui reste vert à toute saison
  function isConifere(id) { var d = BLOCKS[id]; return !!d && !!d.conifere; }

  // eau ou plante noyée : ce qui compte comme « dans l'eau »
  function isLava(id) { var d = BLOCKS[id]; return !!d && !!d.lave; }
  function isWater(id) {
    if (id === B.WATER) return true;
    var d = BLOCKS[id];
    return !!d && (!!d.aquatique || !!d.eauCourante);
  }

  function isSolid(id) {
    var d = BLOCKS[id];
    return !!d && !d.liquid && !d.plant && !d.panneau;
  }
  /* Boîte(s) de collision LOCALE(s) (dans le cube unité) d'un bloc qui n'est
     ni plein ni vide : aujourd'hui seules les portes et les trappes en ont.
     `null` pour tout le reste, ce qui laisse `isSolid` décider seule — la
     physique doit d'abord tester isSolid (bloc plein, comme avant) et
     n'appeler boiteDe que sinon, pour ne rien changer aux blocs existants. */
  function boiteDe(id) {
    var d = BLOCKS[id];
    return (d && d.panneau) ? [d.panneau] : null;
  }
  function estPorte(id) { var d = BLOCKS[id]; return !!d && !!d.porte; }
  function estTrappe(id) { var d = BLOCKS[id]; return !!d && !!d.trappe; }
  /* Bascule d'une porte ou d'une trappe : renvoie le nouvel id (fermé <-> ouvert).
     Fonction pure, testée telle quelle — c'est elle qui centralise la règle
     « même mur, autre état ». Renvoie l'id inchangé si ce n'est ni l'un ni l'autre. */
  function bascule(id) {
    var d = BLOCKS[id];
    if (d && d.porte) return d.porte.ouverte ? PORTE_FERMEE_LIST[d.porte.wall] : PORTE_OUVERTE_LIST[d.porte.wall];
    if (d && d.trappe) return d.trappe.ouverte ? B.TRAPPE_FERMEE : B.TRAPPE_OUVERTE;
    return id;
  }
  /* Le mur (0=N -z, 1=E +x, 2=S +z, 3=O -x) vers lequel une direction pointe :
     sert à orienter une porte posée selon le regard du joueur, et partage la
     même convention que la façade des bâtiments générés (habitats.js). */
  function orientDeRegard(dir) {
    if (Math.abs(dir.x) > Math.abs(dir.z)) return dir.x > 0 ? 1 : 3;
    return dir.z > 0 ? 2 : 0;
  }
  // un bloc peut-il être remplacé en posant dessus ? (air, eau, plantes)
  function isReplaceable(id) {
    if (id === 0) return true;
    var d = BLOCKS[id];
    return !!d && (d.liquid || d.plant);
  }
  // une face est-elle cachée par le voisin ?
  function occludes(self, nb) {
    if (nb === 0) return false;
    var d = BLOCKS[nb];
    if (!d) return false;
    // une plante marine baigne dans l'eau : pas de surface entre les deux
    if (self === B.WATER && d.aquatique) return true;
    // deux eaux qui se touchent, courante ou non : pas de surface entre elles
    if (isWater(self) && isWater(nb) && (BLOCKS[self].liquid || BLOCKS[self].aquatique) && d.liquid) return true;
    if (d.plant) return false;
    return d.transparent ? nb === self : true;
  }

  // ─── temps de minage ───────────────────────────────────────────────────────
  var TIER_SPEED = [1, 2.5, 5, 8, 11];   // main nue, bois, pierre, fer, diamant

  // Renvoie {seconds, harvests}. harvests=false => le bloc casse mais ne donne rien
  // (pierre à main nue, fer avec une pioche en bois).
  function breakTime(blockId, heldId) {
    var b = BLOCKS[blockId];
    if (!b || b.hardness < 0) return { seconds: Infinity, harvests: false };
    if (b.hardness === 0) return { seconds: 0, harvests: true };

    var held = heldId ? ITEMS[heldId] : null;
    var hasTool = !!(held && held.tool && b.tool && held.tool === b.tool);
    var tier = hasTool ? held.tier : 0;
    var speed = TIER_SPEED[tier];
    var harvests = true;
    if (b.needsTool && !hasTool) harvests = false;
    if (b.minTier && tier < b.minTier) harvests = false;
    return { seconds: b.hardness / speed, harvests: harvests };
  }

  // Liste d'objets réellement lâchés. `rand` est injecté pour rendre les tests
  // déterministes (on passe une fonction constante plutôt que Math.random).
  function dropsOf(blockId, harvests, rand) {
    if (!harvests) return [];
    var b = BLOCKS[blockId];
    if (!b) return [];
    var list = b.drops || [{ id: blockId, n: 1 }];
    var r = rand || Math.random;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (d.chance !== undefined && r() > d.chance) continue;
      out.push({ id: d.id, n: d.n });
    }
    return out;
  }

  MC.Core = {
    VERSION_JEU: VERSION_JEU, VERSION_GENERATION: VERSION_GENERATION,
    CHUNK_X: CHUNK_X, CHUNK_Z: CHUNK_Z, WORLD_H: WORLD_H, SEA_LEVEL: SEA_LEVEL,
    idx: idx, B: B, I: I, BLOCKS: BLOCKS, ITEMS: ITEMS, WHEAT_STAGES: WHEAT_STAGES,
    FIRST_ITEM: FIRST_ITEM, ANCIEN_FIRST_ITEM: ANCIEN_FIRST_ITEM,
    DECALAGE_OBJETS_V1: DECALAGE_OBJETS_V1, isBlock: isBlock, isItem: isItem,
    def: def, nameOf: nameOf, maxStack: maxStack, passOf: passOf,
    lightOf: lightOf, lampeDe: lampeDe, durabilityOf: durabilityOf, TIER_DURABILITY: TIER_DURABILITY,
    isLog: isLog, isLeaves: isLeaves, isConifere: isConifere, isWater: isWater, isLava: isLava, TIER_NAME: TIER_NAME,
    TUILES_VARIABLES: TUILES_VARIABLES, INDEX_VARIANTES: INDEX_VARIANTES, tuileVariante: tuileVariante,
    PREMIERE_VARIANTE: PREMIERE_VARIANTE,
    isSolid: isSolid, isReplaceable: isReplaceable, occludes: occludes,
    breakTime: breakTime, dropsOf: dropsOf, TIER_SPEED: TIER_SPEED,
    boiteDe: boiteDe, estPorte: estPorte, estTrappe: estTrappe, bascule: bascule,
    orientDeRegard: orientDeRegard, PORTE_FERMEE_LIST: PORTE_FERMEE_LIST,
    PORTE_OUVERTE_LIST: PORTE_OUVERTE_LIST, EPAIS_PANNEAU: EPAIS_PANNEAU,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
