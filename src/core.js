/* core.js — constantes, définitions des blocs et des objets.
   Aucune dépendance : ni THREE, ni DOM. Chargeable sous Node comme dans le navigateur. */
(function (G) {
  'use strict';

  var MC = G.MC = G.MC || {};

  // ─── versions ──────────────────────────────────────────────────────────────
  // version du jeu en cours ; la génération de terrain a changé 5 fois
  // (une vieille sauvegarde garde la version d'origine de sa carte, voir saves.js)
  var VERSION_JEU = '0.7.0';
  var VERSION_GENERATION = 5;

  // ─── géométrie du monde ────────────────────────────────────────────────────
  var CHUNK_X = 16, CHUNK_Z = 16, WORLD_H = 128, SEA_LEVEL = 26;

  // index dans le tableau plat d'un chunk
  function idx(x, y, z) { return (y * CHUNK_Z + z) * CHUNK_X + x; }

  // ─── espace d'ids unifié ───────────────────────────────────────────────────
  // 0 = air, 1..4095 = blocs (posables), 4096+ = objets (non posables).
  // Les blocs tiennent désormais sur 16 bits (Uint16Array des chunks,
  // SPEC-SAVE-017) : chaque famille de blocs a sa plage (PLAGES_IDS plus bas,
  // SPEC-SAVE-020), et la marge restante sous FIRST_ITEM laisse de la place à
  // de nouveaux blocs sans jamais plus toucher à l'id des objets. Chaque id est
  // figé par le registre tests/donnees/ids.json (SPEC-SAVE-019) : ne jamais
  // renuméroter. Un seul espace d'ids permet à l'inventaire,
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
    // minerais (SPEC-MINERAI-001), déclarés quand 127 était le dernier id de
    // bloc (avant SPEC-SAVE-017) et gardés tels quels depuis (décision L40-bis).
    // Neuf identifiants pour dix matières : cuivre et étain partagent un
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
  // ─── L29 mécanismes : circuits et énergie (SPEC-MECA-001 à 008) ───────────
  // Ids 650..849 réservés à cet agent. Le comportement de chaque bloc est
  // décrit par le champ `circuit` posé plus bas (lu par src/circuits.js et
  // par le registre de src/world.js) ; l'id lui-même ne porte aucune logique.
  Object.assign(B, {
    FIL_SIGNAL: 650, LEVIER_CIRCUIT: 651, BOUTON_CIRCUIT: 652, PLAQUE_PRESSION: 653,
    REPETEUR_CIRCUIT: 654,
    PORTE_NON: 655, PORTE_ET: 656, PORTE_OU: 657, PORTE_XOR: 658,
    PORTE_NAND: 659, PORTE_NOR: 660, PORTE_XNOR: 661,
    BASCULE_CIRCUIT: 662, COMPTEUR_CIRCUIT: 663, COMPARATEUR_CIRCUIT: 664,
    LAMPE_ETEINTE: 665, LAMPE_ALLUMEE: 666,
    TAPIS_ROULANT: 667, ASCENSEUR: 668, ALARME: 669,
    DETECTEUR_PRESENCE: 670, DETECTEUR_LUMIERE: 671, DETECTEUR_JOURNUIT: 672,
    DETECTEUR_METEO: 673, HORLOGE_CIRCUIT: 674, DETECTEUR_EAU: 675,
    EOLIENNE: 676, ROUE_HYDRAULIQUE: 677, GENERATEUR_THERMIQUE: 678,
    CABLE_ENERGIE: 679, BATTERIE: 680,
    DISTRIBUTEUR: 681, PISTON: 682, PISTON_COLLANT: 683, TETE_PISTON: 684,
    BLOC_COMMANDE: 685,
  });

  // ─── L24 matériaux (SPEC-CONSTR-005/006/007) : blocs 400-599 ───────────────
  var B24 = {
    VERRE_ROUGE: 400, VERRE_JAUNE: 401, VERRE_BLEU: 402, VERRE_VERT: 403,
    VERRE_NOIR: 404, VERRE_BLANC: 405, VERRE_GRIS: 406,
    BETON_POUDRE_ROUGE: 407, BETON_POUDRE_JAUNE: 408, BETON_POUDRE_BLEU: 409, BETON_POUDRE_VERT: 410,
    BETON_POUDRE_NOIR: 411, BETON_POUDRE_BLANC: 412, BETON_POUDRE_GRIS: 413,
    BETON_ROUGE: 414, BETON_JAUNE: 415, BETON_BLEU: 416, BETON_VERT: 417,
    BETON_NOIR: 418, BETON_BLANC: 419, BETON_GRIS: 420,
    WOOL_BLACK: 421, WOOL_WHITE: 422, WOOL_GRAY: 423,
    TERRACOTTA_BLUE: 424, TERRACOTTA_GREEN: 425, TERRACOTTA_BLACK: 426,
    TERRACOTTA_WHITE: 427, TERRACOTTA_GRAY: 428,
    MARBRE: 429, CHAUME: 430,
    POUTRE_CHENE: 431, POUTRE_SAPIN: 432, POUTRE_BOULEAU: 433, POUTRE_ACACIA: 434, POUTRE_JUNGLE: 435,
    FEU: 436, FOYER: 437, CHEMINEE: 438,
  };
  for (var clefB24 in B24) B[clefB24] = B24[clefB24];
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
  // ─── L24 matériaux (SPEC-CONSTR-005/007) : objets 500-599 ──────────────────
  var I24 = { DYE_BLACK: 500, DYE_WHITE: 501, DYE_GRAY: 502, BRIQUET: 503 };
  for (var clefI24 in I24) I[clefI24] = I24[clefI24];

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

  /* Plages d'identifiants (SPEC-SAVE-020) : chaque famille de contenu a la
     sienne, disjointe des autres, entièrement d'un côté de FIRST_ITEM. Un
     bloc ou un objet nouveau prend un id libre dans la plage de sa famille
     (ou dans une plage nouvelle, déclarée ici), puis s'inscrit au registre
     figé des ids (tests/donnees/ids.json, SPEC-SAVE-019). Les objets sont
     donnés dans le NOUVEL espace ; entre parenthèses, l'ancien (8 bits) dans
     lequel les définitions plus bas les écrivent avant décalage.
     Réservée (`reservee: true`, aucun bloc ne s'y définit) : 128-199, les
     anciens ids d'objets du format 8 bits — une vieille sauvegarde mal
     migrée y laisserait des objets qu'il ne faut jamais confondre avec des
     blocs. Libres aujourd'hui : blocs 900-949 et 1100-4095 ; objets
     4568-4667 et au-delà de 4767. */
  var PLAGES_IDS = [
    { nom: 'blocs-origine',     genre: 'bloc',  premier: 1,    dernier: 127 },   // terrain, végétation, mer, minerais, portes
    { nom: 'reserve-anciens-objets', genre: 'bloc', premier: 128, dernier: 199, reservee: true },  // anciens ids d'objets (format 8 bits)
    { nom: 'formes-l24',        genre: 'bloc',  premier: 200,  dernier: 399 },   // escaliers, dalles, clôture, muret, vitre, rambarde
    { nom: 'materiaux-l24',     genre: 'bloc',  premier: 400,  dernier: 599 },   // verres teintés, bétons, laines, terres cuites, poutres, feu
    { nom: 'coffres-l25',       genre: 'bloc',  premier: 600,  dernier: 649 },   // coffres piégé et surprise
    { nom: 'mecanismes-l29',    genre: 'bloc',  premier: 650,  dernier: 849 },   // circuits et énergie
    { nom: 'flore-marine-l35',  genre: 'bloc',  premier: 850,  dernier: 899 },   // anémones, algues, éponges, corail blanc
    { nom: 'interieur',         genre: 'bloc',  premier: 950,  dernier: 1099 },  // mobilier
    { nom: 'objets-origine',    genre: 'objet', premier: 4096, dernier: 4189 },  // (128-221) outils, nourriture, matières, véhicules…
    { nom: 'objets-l25',        genre: 'objet', premier: 4190, dernier: 4467 },  // (222-499) armures, armes, bijoux, cuisine
    { nom: 'objets-l24',        genre: 'objet', premier: 4468, dernier: 4567 },  // (500-599) teintures, briquet
    { nom: 'objets-interieur',  genre: 'objet', premier: 4668, dernier: 4767 },  // (700-799) livre, note
  ];

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

  // ── L35 flore marine (SPEC-MER-010) : blocs 850-859, tuiles 896-905 ──────
  B.ANEMONE_ROSE = 850; B.ANEMONE_VERTE = 851; B.ALGUE_ROUGE = 852; B.ALGUE_BRUNE = 853;
  B.POSIDONIE = 854; B.GORGONE_POURPRE = 855; B.EPONGE_JAUNE = 856; B.EPONGE_ORANGE = 857;
  B.LAMINAIRE = 858; B.CORAIL_BLANC = 859;
  planteMarine(B.ANEMONE_ROSE, 'Anémone rose', 896);
  planteMarine(B.ANEMONE_VERTE, 'Anémone verte', 897);
  planteMarine(B.ALGUE_ROUGE, 'Algue rouge', 898, { drops: [{ id: I.DYE_RED, n: 1, chance: 0.3 }] });
  planteMarine(B.ALGUE_BRUNE, 'Algue brune', 899);
  planteMarine(B.POSIDONIE, 'Posidonie', 900);
  planteMarine(B.GORGONE_POURPRE, 'Gorgone pourpre', 901);
  defBlock(B.EPONGE_JAUNE, { name: 'Éponge jaune', tiles: [902, 902, 902], hardness: 0.6 });
  defBlock(B.EPONGE_ORANGE, { name: 'Éponge orange', tiles: [903, 903, 903], hardness: 0.6 });
  planteMarine(B.LAMINAIRE, 'Laminaire', 904, { needsSupport: false, drops: [{ id: B.LAMINAIRE, n: 1 }] });
  // le squelette des récifs : corail blanc, dur, sur lequel poussent les colonies
  defBlock(B.CORAIL_BLANC, { name: 'Corail blanc', tiles: [905, 905, 905], hardness: 1.0, tool: 'pickaxe' });

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
  /* Conçu quand les ids de bloc s'arrêtaient à 127 (voir B) et conservé
     depuis (décision L40-bis : minerais mutualisés), plusieurs
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

  // ─── L29 mécanismes : circuits et énergie (SPEC-MECA-001 à 008) ───────────
  // `circuit.type` est le seul champ que src/circuits.js et le registre de
  // src/world.js lisent pour savoir comment simuler le bloc ; `entree`/
  // `sortie` valent pour les portes à deux entrées orientées (le mur de face,
  // comme les portes en bois, encodé dans l'état — voir circuits.js).
  var TC = { hardness: 1.2, tool: 'pickaxe' };
  defBlock(B.FIL_SIGNAL, { name: 'Fil de signal', tiles: [768, 768, 768], hardness: 0.2,
                          transparent: true, plant: true, pass: 'cutout', circuit: { type: 'fil' } });
  defBlock(B.LEVIER_CIRCUIT, { name: 'Levier', tiles: [769, 769, 769], hardness: 0.4,
                              transparent: true, plant: true, pass: 'cutout', circuit: { type: 'levier', source: true } });
  defBlock(B.BOUTON_CIRCUIT, { name: 'Bouton', tiles: [770, 770, 770], hardness: 0.4,
                              transparent: true, plant: true, pass: 'cutout', circuit: { type: 'bouton', source: true } });
  defBlock(B.PLAQUE_PRESSION, { name: 'Plaque de pression', tiles: [771, 771, 771], hardness: 0.4,
                               transparent: true, plant: true, pass: 'cutout', circuit: { type: 'plaque', source: true } });
  defBlock(B.REPETEUR_CIRCUIT, { name: 'Répéteur', tiles: [772, 772, 772], hardness: 0.4,
                                transparent: true, plant: true, pass: 'cutout', circuit: { type: 'repeteur' } });
  defBlock(B.PORTE_NON, Object.assign({ name: 'Porte NON', tiles: [773, 773, 773], circuit: { type: 'non' } }, TC));
  defBlock(B.PORTE_ET, Object.assign({ name: 'Porte ET', tiles: [774, 774, 774], circuit: { type: 'et' } }, TC));
  defBlock(B.PORTE_OU, Object.assign({ name: 'Porte OU', tiles: [775, 775, 775], circuit: { type: 'ou' } }, TC));
  defBlock(B.PORTE_XOR, Object.assign({ name: 'Porte OU exclusif', tiles: [776, 776, 776], circuit: { type: 'xor' } }, TC));
  defBlock(B.PORTE_NAND, Object.assign({ name: 'Porte NON-ET', tiles: [777, 777, 777], circuit: { type: 'nand' } }, TC));
  defBlock(B.PORTE_NOR, Object.assign({ name: 'Porte NON-OU', tiles: [778, 778, 778], circuit: { type: 'nor' } }, TC));
  defBlock(B.PORTE_XNOR, Object.assign({ name: 'Porte NON-OU exclusif', tiles: [779, 779, 779], circuit: { type: 'xnor' } }, TC));
  defBlock(B.BASCULE_CIRCUIT, Object.assign({ name: 'Bascule (mémoire)', tiles: [780, 780, 780], circuit: { type: 'bascule' } }, TC));
  defBlock(B.COMPTEUR_CIRCUIT, Object.assign({ name: 'Compteur', tiles: [781, 781, 781], circuit: { type: 'compteur' } }, TC));
  defBlock(B.COMPARATEUR_CIRCUIT, Object.assign({ name: 'Comparateur', tiles: [782, 782, 782], circuit: { type: 'comparateur' } }, TC));
  defBlock(B.LAMPE_ETEINTE, Object.assign({ name: 'Lampe (éteinte)', tiles: [783, 783, 783], circuit: { type: 'lampe', allumee: false } }, TC));
  defBlock(B.LAMPE_ALLUMEE, Object.assign({ name: 'Lampe (allumée)', tiles: [784, 784, 784], light: 14,
                                           circuit: { type: 'lampe', allumee: true } }, TC));
  defBlock(B.TAPIS_ROULANT, Object.assign({ name: 'Tapis roulant', tiles: [785, 785, 785], circuit: { type: 'tapis' } }, TC));
  defBlock(B.ASCENSEUR, Object.assign({ name: 'Ascenseur', tiles: [786, 786, 786], circuit: { type: 'ascenseur' } }, TC));
  defBlock(B.ALARME, Object.assign({ name: 'Alarme', tiles: [787, 787, 787], circuit: { type: 'alarme' } }, TC));
  defBlock(B.DETECTEUR_PRESENCE, Object.assign({ name: 'Détecteur de présence', tiles: [788, 788, 788], circuit: { type: 'presence', source: true } }, TC));
  defBlock(B.DETECTEUR_LUMIERE, Object.assign({ name: 'Détecteur de lumière', tiles: [789, 789, 789], circuit: { type: 'lumiere', source: true } }, TC));
  defBlock(B.DETECTEUR_JOURNUIT, Object.assign({ name: 'Détecteur jour/nuit', tiles: [790, 790, 790], circuit: { type: 'journuit', source: true } }, TC));
  defBlock(B.DETECTEUR_METEO, Object.assign({ name: 'Détecteur météo', tiles: [791, 791, 791], circuit: { type: 'meteo', source: true } }, TC));
  defBlock(B.HORLOGE_CIRCUIT, Object.assign({ name: 'Horloge', tiles: [792, 792, 792], circuit: { type: 'horloge', source: true } }, TC));
  defBlock(B.DETECTEUR_EAU, Object.assign({ name: "Détecteur de niveau d'eau", tiles: [793, 793, 793], circuit: { type: 'eau', source: true } }, TC));
  defBlock(B.EOLIENNE, Object.assign({ name: 'Éolienne', tiles: [794, 794, 794], circuit: { type: 'eolienne', generateur: true } }, TC));
  defBlock(B.ROUE_HYDRAULIQUE, Object.assign({ name: 'Roue hydraulique', tiles: [795, 795, 795], circuit: { type: 'hydraulique', generateur: true } }, TC));
  defBlock(B.GENERATEUR_THERMIQUE, Object.assign({ name: 'Générateur thermique', tiles: [796, 796, 796], circuit: { type: 'thermique', generateur: true } }, TC));
  defBlock(B.CABLE_ENERGIE, { name: 'Câble', tiles: [797, 797, 797], hardness: 0.3, transparent: true,
                              plant: true, pass: 'cutout', circuit: { type: 'cable', energie: true } });
  defBlock(B.BATTERIE, Object.assign({ name: 'Batterie', tiles: [798, 798, 798], circuit: { type: 'batterie', energie: true } }, TC));
  defBlock(B.DISTRIBUTEUR, Object.assign({ name: 'Distributeur', tiles: [799, 799, 799], circuit: { type: 'distributeur' }, interactive: 'distributeur' }, TC));
  defBlock(B.PISTON, Object.assign({ name: 'Piston', tiles: [800, 800, 800], circuit: { type: 'piston' } }, TC));
  defBlock(B.PISTON_COLLANT, Object.assign({ name: 'Piston collant', tiles: [801, 801, 801], circuit: { type: 'piston', collant: true } }, TC));
  defBlock(B.TETE_PISTON, { name: 'Tête de piston', tiles: [802, 802, 802], hardness: 1.2, tool: 'pickaxe',
                            circuit: { type: 'tete-piston' } });
  defBlock(B.BLOC_COMMANDE, { name: 'Bloc de commande', tiles: [803, 803, 803],
                              hardness: -1, circuit: { type: 'commande', adminSeul: true },
                              interactive: 'bloc_commande' });

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

  // ─── L24 formes : escaliers, dalles, clôtures/murets/vitres/rambardes ──────
  /* SPEC-CONSTR-001 à 004. Plage réservée à cet agent : identifiants de bloc
     200-399, tuiles d'atlas 384-511 (voir atlas.js) — ici on réutilise les
     tuiles [dessus, côté, dessous] du matériau de base : aucune tuile neuve
     n'est nécessaire, l'escalier ou la dalle a juste la forme en moins.
     `mat` porte l'id du bloc plein d'origine (fusion des dalles, drops).
     `forme` marque le bloc pour core.isSolid/boiteDe et pour mesher.js —
     la géométrie et l'état vivent dans src/formes.js (MC.Formes),
     chargé après core.js mais référencé seulement à l'appel (pas au chargement). */
  var PROCHAIN_ID_FORME = 200;
  function idForme(nom) { var id = PROCHAIN_ID_FORME++; B[nom] = id; return id; }
  function escalierDe(nom, baseId) {
    var base = BLOCKS[baseId];
    var escId = idForme(nom);
    defBlock(escId, {
      name: 'Escalier (' + base.name.toLowerCase() + ')', tiles: base.tiles.slice(),
      hardness: base.hardness, tool: base.tool, needsTool: base.needsTool,
      transparent: true, pass: 'cutout', forme: 'escalier', mat: baseId,
    });
    base.escalier = escId;       // le bloc plein connaît son escalier (habitats.js, recettes)
  }
  function dalleDe(nom, baseId) {
    var base = BLOCKS[baseId];
    var dalleId = idForme(nom);
    defBlock(dalleId, {
      name: 'Dalle (' + base.name.toLowerCase() + ')', tiles: base.tiles.slice(),
      hardness: base.hardness, tool: base.tool, needsTool: base.needsTool,
      transparent: true, pass: 'cutout', forme: 'dalle', mat: baseId,
    });
    base.dalle = dalleId;        // le bloc plein connaît sa dalle (recette inverse, tests)
  }
  [['ESCALIER_PLANKS', B.PLANKS], ['ESCALIER_SAPIN', B.PLANCHES_SAPIN],
   ['ESCALIER_BOULEAU', B.PLANCHES_BOULEAU], ['ESCALIER_ACACIA', B.PLANCHES_ACACIA],
   ['ESCALIER_JUNGLE', B.PLANCHES_JUNGLE], ['ESCALIER_STONE', B.STONE],
   ['ESCALIER_COBBLE', B.COBBLE], ['ESCALIER_STONE_BRICK', B.STONE_BRICK],
   ['ESCALIER_SANDSTONE', B.SANDSTONE], ['ESCALIER_BRICK', B.BRICK],
   ['ESCALIER_TUILES', B.TUILES], ['ESCALIER_ARDOISE', B.ARDOISE], ['ESCALIER_HAY', B.HAY],
   // matériaux de toiture supplémentaires (SPEC-CONSTR-003 : pans en pente
   // des bâtiments générés, voir habitats.js `toit`)
   ['ESCALIER_JUNGLE_LEAVES', B.JUNGLE_LEAVES], ['ESCALIER_SANDSTONE_BRICK', B.SANDSTONE_BRICK],
   ['ESCALIER_TERRACOTTA_YELLOW', B.TERRACOTTA_YELLOW],
  ].forEach(function (p) { escalierDe(p[0], p[1]); });
  [['DALLE_PLANKS', B.PLANKS], ['DALLE_SAPIN', B.PLANCHES_SAPIN],
   ['DALLE_BOULEAU', B.PLANCHES_BOULEAU], ['DALLE_ACACIA', B.PLANCHES_ACACIA],
   ['DALLE_JUNGLE', B.PLANCHES_JUNGLE], ['DALLE_STONE', B.STONE],
   ['DALLE_COBBLE', B.COBBLE], ['DALLE_STONE_BRICK', B.STONE_BRICK],
   ['DALLE_SANDSTONE', B.SANDSTONE], ['DALLE_BRICK', B.BRICK],
  ].forEach(function (p) { dalleDe(p[0], p[1]); });

  // clôture (bois), muret (pavé), vitre (panneau de verre), rambarde (pierre) :
  // se raccordent d'eux-mêmes aux voisins pleins ou de même sorte (SPEC-CONSTR-004).
  defBlock(idForme('CLOTURE'), { name: 'Clôture', tiles: BLOCKS[B.PLANKS].tiles.slice(),
                                 hardness: 2.0, tool: 'axe', transparent: true, pass: 'cutout',
                                 forme: 'cloture', mat: B.PLANKS });
  defBlock(idForme('MURET'), { name: 'Muret', tiles: BLOCKS[B.COBBLE].tiles.slice(),
                               hardness: 2.0, tool: 'pickaxe', needsTool: true,
                               transparent: true, pass: 'cutout', forme: 'muret', mat: B.COBBLE });
  defBlock(idForme('VITRE'), { name: 'Vitre', tiles: BLOCKS[B.GLASS].tiles.slice(),
                               hardness: 0.4, transparent: true, pass: 'blend',
                               forme: 'vitre', mat: B.GLASS });
  defBlock(idForme('RAMBARDE'), { name: 'Rambarde', tiles: BLOCKS[B.STONE_BRICK].tiles.slice(),
                                  hardness: 2.0, tool: 'pickaxe', needsTool: true,
                                  transparent: true, pass: 'cutout', forme: 'rambarde', mat: B.STONE_BRICK });

  // ─── L24 matériaux (SPEC-CONSTR-005/006) : verre teinté, béton, laine, terre cuite ───
  // sept teintures communes : quatre végétales/minérales déjà là, plus noir
  // (encre de calmar), blanc (poudre d'os) et gris (charbon) — voir inventory.js.
  var TEINTES_L24 = [
    { id: 'ROUGE' }, { id: 'JAUNE' }, { id: 'BLEU' }, { id: 'VERT' },
    { id: 'NOIR' }, { id: 'BLANC' }, { id: 'GRIS' },
  ];
  TEINTES_L24.forEach(function (t, i) {
    var tVerre = 520 + i, tPoudre = 527 + i, tBeton = 534 + i;
    defBlock(B['VERRE_' + t.id], { name: 'Verre teinté', tiles: [tVerre, tVerre, tVerre],
                                   hardness: 0.4, transparent: true, pass: 'blend', drops: [] });
    // le béton en poudre tombe comme le sable/gravier : une pelle suffit
    defBlock(B['BETON_POUDRE_' + t.id], { name: 'Béton en poudre', tiles: [tPoudre, tPoudre, tPoudre],
                                          hardness: 0.5, tool: 'shovel' });
    defBlock(B['BETON_' + t.id], { name: 'Béton', tiles: [tBeton, tBeton, tBeton],
                                   hardness: 1.8, tool: 'pickaxe', needsTool: true });
  });
  // laine : trois teintes de plus (les quatre premières existaient déjà, SPEC-MINERAI-*)
  defBlock(B.WOOL_BLACK, { name: 'Laine noire', tiles: [541, 541, 541], hardness: 0.8, inflammable: true });
  defBlock(B.WOOL_WHITE, { name: 'Laine blanche', tiles: [542, 542, 542], hardness: 0.8, inflammable: true });
  defBlock(B.WOOL_GRAY,  { name: 'Laine grise', tiles: [543, 543, 543], hardness: 0.8, inflammable: true });
  // terre cuite : cinq teintes de plus (rouge et jaune existaient déjà)
  defBlock(B.TERRACOTTA_BLUE,  { name: 'Terre cuite bleue', tiles: [544, 544, 544], hardness: 1.2, tool: 'pickaxe' });
  defBlock(B.TERRACOTTA_GREEN, { name: 'Terre cuite verte', tiles: [545, 545, 545], hardness: 1.2, tool: 'pickaxe' });
  defBlock(B.TERRACOTTA_BLACK, { name: 'Terre cuite noire', tiles: [546, 546, 546], hardness: 1.2, tool: 'pickaxe' });
  defBlock(B.TERRACOTTA_WHITE, { name: 'Terre cuite blanche', tiles: [547, 547, 547], hardness: 1.2, tool: 'pickaxe' });
  defBlock(B.TERRACOTTA_GRAY,  { name: 'Terre cuite grise', tiles: [548, 548, 548], hardness: 1.2, tool: 'pickaxe' });

  // ─── L24 matériaux (SPEC-CONSTR-006) : marbre, chaume, poutres ────────────
  // le marbre et l'ardoise (bloc existant) se trouvent aussi naturellement en
  // sous-sol (voir world.js:filon) ; le marbre se taille aussi à l'établi.
  defBlock(B.MARBRE, { name: 'Marbre', tiles: [549, 549, 549], hardness: 1.5, tool: 'pickaxe', needsTool: true });
  // chaume : une toiture légère et inflammable, comme le foin
  defBlock(B.CHAUME, { name: 'Chaume', tiles: [550, 550, 550], hardness: 0.5, tool: 'axe', inflammable: true });
  var POUTRES_L24 = [
    { id: 'CHENE', nom: 'de chêne' }, { id: 'SAPIN', nom: 'de sapin' }, { id: 'BOULEAU', nom: 'de bouleau' },
    { id: 'ACACIA', nom: "d'acacia" }, { id: 'JUNGLE', nom: 'de jungle' },
  ];
  POUTRES_L24.forEach(function (p, i) {
    var tp = 551 + i;
    defBlock(B['POUTRE_' + p.id], { name: 'Poutre ' + p.nom, tiles: [tp, tp, tp],
                                    hardness: 2.0, tool: 'axe', inflammable: true });
  });

  // ─── L24 matériaux (SPEC-CONSTR-007) : le feu ──────────────────────────────
  // `inflammable` : ce que le feu peut consumer (voir feu.js). `fumee` :
  // source qui fait fumer (torches, foyer, cheminée, et le feu lui-même).
  defBlock(B.FEU, { name: 'Feu', tiles: [556, 556, 556], hardness: 0, transparent: true, plant: true,
                    pass: 'lumineux', light: 14, hurts: 1, fumee: true, sansLampe: false, drops: [] });
  defBlock(B.FOYER, { name: 'Foyer', tiles: [557, 558, 558], hardness: 3.5, tool: 'pickaxe', needsTool: true,
                      light: 10, fumee: true });
  defBlock(B.CHEMINEE, { name: 'Cheminée', tiles: [559, 559, 559], hardness: 2.0, tool: 'pickaxe',
                        light: 3, fumee: true });
  BLOCKS[B.TORCH].fumee = true;
  // bois et végétaux existants qui prennent feu (leur nouveau lot fixe le
  // reste : poutres, chaume, laines noire/blanche/grise ci-dessus)
  [B.LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.JUNGLE_LOG, B.ACACIA_LOG,
   B.LEAVES, B.BIRCH_LEAVES, B.SPRUCE_LEAVES, B.JUNGLE_LEAVES, B.ACACIA_LEAVES,
   B.PLANKS, B.PLANCHES_SAPIN, B.PLANCHES_BOULEAU, B.PLANCHES_ACACIA, B.PLANCHES_JUNGLE,
   B.WOOL, B.WOOL_RED, B.WOOL_BLUE, B.WOOL_YELLOW, B.WOOL_GREEN,
   B.HAY, B.BOOKSHELF, B.TALL_GRASS, B.DEAD_BUSH, B.COBWEB,
  ].forEach(function (id) { BLOCKS[id].inflammable = true; });
  function isInflammable(id) { var d = BLOCKS[id]; return !!d && !!d.inflammable; }
  function estFumigene(id) { var d = BLOCKS[id]; return !!d && !!d.fumee; }

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

  // ─── L24 matériaux (SPEC-CONSTR-005/007) : teintures et briquet ──────────
  defItem(I.DYE_BLACK, { name: 'Teinture noire', tile: 512 });
  defItem(I.DYE_WHITE, { name: 'Teinture blanche', tile: 513 });
  defItem(I.DYE_GRAY, { name: 'Teinture grise', tile: 514 });
  // silex et acier : allume un feu sur un bloc plein ou un matériau
  // inflammable visé (voir player.js:utiliserBriquet) — pas de recette d'usure.
  defItem(I.BRIQUET, { name: 'Briquet', tile: 515, briquet: true, maxStack: 1 });

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

  /* SPEC-SAVE-028 : un id de bloc inconnu de cette version (monde écrit par
     une version plus récente) est conservé tel quel dans le monde et ses
     sauvegardes ; il se dessine et se comporte comme un cube neutre — plein,
     incassable, à l'aspect du socle (`substitut`) — au lieu d'être invisible
     et traversable. Hors de BLOCKS : aucun balayage des blocs définis ne le voit. */
  var BLOC_INCONNU = { name: 'Bloc inconnu', substitut: B.BEDROCK, tiles: BLOCKS[B.BEDROCK].tiles.slice(),
                       hardness: -1, drops: [], inconnu: true };
  // définition servant au rendu et à la collision : celle du bloc, ou le bloc neutre
  function defRendu(id) { return BLOCKS[id] || (isBlock(id) ? BLOC_INCONNU : undefined); }

  function isSolid(id) {
    var d = defRendu(id);
    return !!d && !d.liquid && !d.plant && !d.panneau && !d.forme;
  }
  /* Boîte(s) de collision LOCALE(s) (dans le cube unité) d'un bloc qui n'est
     ni plein ni vide : portes/trappes (`panneau`) et, depuis L24, escaliers,
     dalles, clôtures, murets, vitres, rambardes (`forme`, voir formes.js).
     `null` pour tout le reste, ce qui laisse `isSolid` décider seule — la
     physique doit d'abord tester isSolid (bloc plein, comme avant) et
     n'appeler boiteDe que sinon, pour ne rien changer aux blocs existants.
     `etat` (octet du bloc) et `voisinFn` (accesseur de voisin, voir
     MC.Formes.boitesBloc) ne sont utiles qu'aux blocs `forme` ; les autres
     appelants (portes, trappes) peuvent les omettre. */
  function boiteDe(id, etat, voisinFn) {
    var d = BLOCKS[id];
    if (!d) return null;
    if (d.panneau) return [d.panneau];
    if (d.forme && MC.Formes) return MC.Formes.boitesBloc(d, etat, voisinFn);
    return null;
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
    var d = defRendu(nb);
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
  // `bonusChance` (SPEC-OBJET-003) : un bijou d'émeraude porte chance — il
  // resserre le tirage aléatoire vers 0 plutôt que de gonfler `d.chance`
  // directement, pour qu'un drop déjà garanti (chance 1) reste inchangé.
  function dropsOf(blockId, harvests, rand, bonusChance) {
    if (!harvests) return [];
    var b = BLOCKS[blockId];
    if (!b) return [];
    var list = b.drops || [{ id: blockId, n: 1 }];
    var r = rand || Math.random;
    var mul = 1 - Math.max(0, Math.min(0.9, bonusChance || 0));
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (d.chance !== undefined && r() * mul > d.chance) continue;
      out.push({ id: d.id, n: d.n });
    }
    return out;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ─── L25 objets (SPEC-OBJET-001 à 005) ───────────────────────────────────
  // Plage réservée à cet agent : objets 222-499 (avant décalage FIRST_ITEM),
  // blocs 600-649, tuiles d'atlas 640-767. Les autres agents (formes ;
  // matériaux/verre/feu ; mécanismes) travaillent dans d'autres plages.
  // ═══════════════════════════════════════════════════════════════════════

  // ─── coffres piégés et surprises (SPEC-OBJET-005) ────────────────────────
  // Se comportent comme un coffre tant qu'on ne l'a pas ouvert : c'est
  // l'interaction (game.js) qui résout le piège ou la surprise à l'ouverture.
  B.COFFRE_PIEGE = 600;
  B.COFFRE_SURPRISE = 601;
  defBlock(B.COFFRE_PIEGE, { name: 'Coffre suspect', tiles: [718, 719, 719], hardness: 2.5,
                             tool: 'axe', interactive: 'coffre_piege' });
  defBlock(B.COFFRE_SURPRISE, { name: 'Coffre doré', tiles: [720, 721, 721], hardness: 2.5,
                                tool: 'axe', interactive: 'coffre_surprise' });

  var TRAP_TYPES = ['fleches', 'explosion', 'alarme', 'gaz'];
  // Fonctions pures, injectables par `rand` pour des tests déterministes.
  function tirerPiege(rand) {
    var r = (rand || Math.random)();
    return TRAP_TYPES[Math.min(TRAP_TYPES.length - 1, Math.floor(r * TRAP_TYPES.length))];
  }
  function tirerSurprise(rand) { return (rand || Math.random)() < 0.7 ? 'rare' : 'mimic'; }
  // Un kit de désamorçage réussit presque toujours ; sans lui, on ne tente rien.
  function tenterDesamorcage(aLeKit, rand) {
    if (!aLeKit) return false;
    return (rand || Math.random)() < 0.9;
  }

  // Les objets ci-dessous sont numérotés dans l'ancien espace (128..) par
  // lisibilité, comme le reste de `I` ; `DEC` les reporte dans le nouvel
  // espace (FIRST_ITEM), exactement comme le fait la boucle plus haut pour
  // les objets déjà déclarés — indispensable puisque cette boucle a déjà
  // tourné au moment où ce bloc s'exécute.
  var DEC = FIRST_ITEM - ANCIEN_FIRST_ITEM;

  // ─── matières de base : tissu et cuir (SPEC-OBJET-001) ───────────────────
  I.TISSU = 222 + DEC; I.CUIR = 223 + DEC;
  defItem(I.TISSU, { name: 'Tissu', tile: 640 });
  defItem(I.CUIR, { name: 'Cuir', tile: 641 });

  // ─── armures : sept matières × quatre pièces (SPEC-OBJET-001) ────────────
  // `defense` : cumulée par armureReduction (player.js), plafonnée à 80 %.
  // `couleurArmure` : lue par apparence.js pour habiller l'avatar (render.js).
  var ARMOR_SLOTS = ['CASQUE', 'PLASTRON', 'JAMBIERES', 'BOTTES'];
  var NOM_PIECE = { CASQUE: 'Casque', PLASTRON: 'Plastron', JAMBIERES: 'Jambières', BOTTES: 'Bottes' };
  var ARMOR_MATS = [
    // clé, nom, durabilité, couleur, défense [casque, plastron, jambières, bottes]
    { cle: 'TISSU',   nom: 'en tissu',   dur: 60,  couleur: 0xd8d0b0, def: [1, 2, 1, 1] },
    { cle: 'CUIR',    nom: 'en cuir',    dur: 80,  couleur: 0x8a5a2a, def: [1, 3, 2, 1] },
    { cle: 'MAILLES', nom: 'en mailles', dur: 120, couleur: 0x9aa0a8, def: [1, 4, 3, 1] },
    { cle: 'BRONZE',  nom: 'en bronze',  dur: 130, couleur: 0xc08a4a, def: [2, 5, 3, 2] },
    { cle: 'FER',     nom: 'en fer',     dur: 180, couleur: 0xd8d8dc, def: [2, 6, 5, 2] },
    { cle: 'OR',      nom: 'en or',      dur: 110, couleur: 0xe8c840, def: [2, 5, 3, 1] },
    { cle: 'DIAMANT', nom: 'en diamant', dur: 450, couleur: 0x60e0e0, def: [3, 8, 6, 3] },
  ];
  (function () {
    var idArmure = 224 + DEC, tileArmure = 642;
    ARMOR_MATS.forEach(function (m) {
      ARMOR_SLOTS.forEach(function (slot, i) {
        var nomCle = m.cle + '_' + slot;
        I[nomCle] = idArmure++;
        defItem(I[nomCle], {
          name: NOM_PIECE[slot] + ' ' + m.nom, tile: tileArmure++,
          equipSlot: slot.toLowerCase(), defense: m.def[i], durability: m.dur,
          couleurArmure: m.couleur, maxStack: 1,
        });
      });
    });
  })();

  // ─── armes de mêlée : cinq familles × quatre matières (SPEC-OBJET-002) ──
  // `portee`, `cadence`, `recul` : lus par player.js/game.js pour la portée
  // de visée, le délai entre deux coups et l'intensité du recul infligé.
  var MELEE_TYPES = [
    { cle: 'DAGUE',        nom: 'Dague',            tool: 'sword', dmg0: 2, dmgPas: 1, cadence: 0.22, portee: 4,   recul: 0.6 },
    { cle: 'EPEE_LONGUE',  nom: 'Épée longue',       tool: 'sword', dmg0: 4, dmgPas: 2, cadence: 0.55, portee: 6,   recul: 1.1 },
    { cle: 'HACHE_GUERRE', nom: 'Hache de guerre',   tool: 'axe',   dmg0: 5, dmgPas: 2, cadence: 0.85, portee: 5,   recul: 1.8 },
    { cle: 'MASSE',        nom: 'Masse',             tool: null,    dmg0: 6, dmgPas: 2, cadence: 0.95, portee: 4.5, recul: 2.4 },
    { cle: 'LANCE',        nom: 'Lance',             tool: 'sword', dmg0: 3, dmgPas: 2, cadence: 0.5,  portee: 7,   recul: 1.0 },
  ];
  var MELEE_TIER_SUFFIXE = ['', 'BOIS', 'PIERRE', 'FER', 'DIAMANT'];
  (function () {
    var idArme = 252 + DEC, tileArme = 670;
    MELEE_TYPES.forEach(function (t) {
      for (var tier = 1; tier <= 4; tier++) {
        var nomCle = t.cle + '_' + MELEE_TIER_SUFFIXE[tier];
        I[nomCle] = idArme++;
        var o = {
          name: t.nom + ' ' + TIER_NAME[tier], tile: tileArme++,
          damage: t.dmg0 + t.dmgPas * (tier - 1), durability: TIER_DURABILITY[tier],
          cadence: t.cadence, portee: t.portee, recul: t.recul, maxStack: 1,
        };
        if (t.tool) { o.tool = t.tool; o.tier = tier; }
        defItem(I[nomCle], o);
      }
    });
  })();

  // ─── armes à distance et fronde (SPEC-OBJET-002) ─────────────────────────
  // `cadenceTir` : délai minimal entre deux tirs (player.js) ; 0 = comme
  // l'arc et l'arbalète d'origine, qui tirent à chaque clic.
  I.ARC_LONG = 272 + DEC; I.ARBALETE_LOURDE = 273 + DEC; I.FRONDE = 274 + DEC; I.GALET = 275 + DEC;
  defItem(I.ARC_LONG, { name: 'Arc long', tile: 690, ranged: 'fleche', maxStack: 1,
                        durability: 260, damage: 1, vitesseTir: 40, bonusTir: 2, cadenceTir: 0.15 });
  defItem(I.ARBALETE_LOURDE, { name: 'Arbalète lourde', tile: 691, ranged: 'fleche', maxStack: 1,
                               durability: 420, damage: 1, vitesseTir: 52, bonusTir: 7, cadenceTir: 1.1 });
  defItem(I.FRONDE, { name: 'Fronde', tile: 692, ranged: 'galet', maxStack: 1,
                      durability: 200, damage: 1, vitesseTir: 30, bonusTir: 0, cadenceTir: 0.35 });
  defItem(I.GALET, { name: 'Galet', tile: 693, ammo: true, ammoType: 'galet', damage: 3 });
  ITEMS[I.FLECHE].ammoType = 'fleche';

  // ─── gemmes taillées et bijoux (SPEC-OBJET-003) ─────────────────────────
  I.RUBIS_TAILLE = 276 + DEC; I.SAPHIR_TAILLE = 277 + DEC; I.EMERAUDE_TAILLEE = 278 + DEC; I.DIAMANT_TAILLE = 279 + DEC;
  defItem(I.RUBIS_TAILLE, { name: 'Rubis taillé', tile: 694 });
  defItem(I.SAPHIR_TAILLE, { name: 'Saphir taillé', tile: 695 });
  defItem(I.EMERAUDE_TAILLEE, { name: 'Émeraude taillée', tile: 696 });
  defItem(I.DIAMANT_TAILLE, { name: 'Diamant taillé', tile: 697 });
  /* Un bijou se porte dans un unique emplacement (`equipSlot: 'bijou'`) et
     donne un petit effet selon sa gemme ; la monture (anneau, amulette,
     diadème) module son intensité. `effet.type` : 'resistance' (réduction
     de dégâts en plus de l'armure), 'vitesse' (multiplicateur de
     déplacement), 'chance' (bonus de chance au butin), 'lumiere' (rayon de
     lumière porté — donnée exposée pour un futur raccord au moteur
     d'éclairage, non câblée ici). */
  var GEMME_EFFET = {
    RUBIS: { type: 'resistance', valeur: 0.06 }, SAPHIR: { type: 'vitesse', valeur: 0.12 },
    EMERAUDE: { type: 'chance', valeur: 0.12 }, DIAMANT: { type: 'lumiere', valeur: 8 },
  };
  var BIJOU_MULT = { ANNEAU: 1, AMULETTE: 1.3, DIADEME: 1.6 };
  var BIJOU_NOM = { ANNEAU: 'Anneau', AMULETTE: 'Amulette', DIADEME: 'Diadème' };
  var NOM_GEMME = { RUBIS: 'de rubis', SAPHIR: 'de saphir', EMERAUDE: "d'émeraude", DIAMANT: 'de diamant' };
  (function () {
    var idBijou = 280 + DEC, tileBijou = 698;
    ['ANNEAU', 'AMULETTE', 'DIADEME'].forEach(function (fam) {
      ['RUBIS', 'SAPHIR', 'EMERAUDE', 'DIAMANT'].forEach(function (gem) {
        var nomCle = fam + '_' + gem;
        I[nomCle] = idBijou++;
        var base = GEMME_EFFET[gem];
        var valeur = Math.round(base.valeur * BIJOU_MULT[fam] * 1000) / 1000;
        defItem(I[nomCle], {
          name: BIJOU_NOM[fam] + ' ' + NOM_GEMME[gem], tile: tileBijou++,
          equipSlot: 'bijou', maxStack: 1, effet: { type: base.type, valeur: valeur },
        });
      });
    });
  })();

  // ─── nourriture et cuisine (SPEC-OBJET-004) ──────────────────────────────
  I.FROMAGE = 292 + DEC; I.SOUPE_LEGUMES = 293 + DEC; I.RAGOUT = 294 + DEC; I.TARTE_POMME = 295 + DEC;
  I.GATEAU = 296 + DEC; I.BAIES = 297 + DEC; I.KIT_DESAMORCAGE = 298 + DEC;
  defItem(I.FROMAGE, { name: 'Fromage', tile: 710, food: 4 });
  defItem(I.SOUPE_LEGUMES, { name: 'Soupe de légumes', tile: 711, food: 6, rend: I.BOWL, maxStack: 1 });
  defItem(I.RAGOUT, { name: 'Ragoût', tile: 712, food: 8, soin: 2, rend: I.BOWL, maxStack: 1 });
  defItem(I.TARTE_POMME, { name: 'Tarte aux pommes', tile: 713, food: 6 });
  defItem(I.GATEAU, { name: 'Gâteau', tile: 714, food: 9, soin: 2 });
  defItem(I.BAIES, { name: 'Baies', tile: 715, food: 2 });
  // outil de détection/désamorçage des pièges (SPEC-OBJET-005) : consommé à l'usage
  defItem(I.KIT_DESAMORCAGE, { name: 'Kit de désamorçage', tile: 716 });

  // la viande et le poisson crus rendent malade une fois sur trois (player.js)
  [I.RAW_MUTTON, I.RAW_PORK, I.RAW_CHICKEN, I.RAW_FISH].forEach(function (id) { ITEMS[id].cru = true; });
  // le buisson mort laisse parfois des baies
  BLOCKS[B.DEAD_BUSH].drops.push({ id: I.BAIES, n: 1, chance: 0.3 });

  // ═══════════════════════════════════════════════════════════════════════
  // ─── INTERIEUR (SPEC-INTERIEUR-002/003) ──────────────────────────────────
  // Plage réservée à cet agent : blocs 950-1099, objets 700-799 (avant
  // décalage FIRST_ITEM), tuiles d'atlas 906-1000. Ne pas toucher à
  // src/habitats.js (un autre agent y pose les plans/toitures des bâtiments ;
  // leurs intérieurs viendront plus tard en s'appuyant sur ce mobilier).
  // ═══════════════════════════════════════════════════════════════════════
  Object.assign(B, {
    LIT: 950, TABLE: 951, CHAISE: 952, ARMOIRE: 953, ETAGERE: 954,
    BIBLIOTHEQUE: 955, TAPIS: 956, LAMPE: 957, VASE: 958, PRESENTOIR: 959, SOCLE: 960,
  });
  I.LIVRE = 700 + DEC; I.NOTE = 701 + DEC;

  /* Mobilier orienté (SPEC-INTERIEUR-002) : `forme: 'meuble'` délègue les
     boîtes de maillage/collision à MC.Formes.boitesBloc (même mécanisme que
     les escaliers, voir formes.js) ; `meuble` nomme la géométrie de base à
     tourner selon l'orientation stockée dans l'état (world.getEtat/setEtat),
     posée comme une porte (Core.orientDeRegard) — voir player.js. Un meuble
     tient dans un seul id, sans variante par matière : c'est la géométrie
     qui compte pour cette spec, pas un jeu de skins.
     `interactive` réutilise le mécanisme des coffres (game.js `chests`) pour
     l'armoire, l'étagère et la bibliothèque : ce sont des conteneurs comme un
     coffre, juste posés/rendus différemment. `expose` marque présentoir et
     socle : ce ne sont PAS des conteneurs à grille, mais un unique
     emplacement affichant l'objet qui y est posé (game.js `expositions`,
     voir plus bas). `dodo` marque le lit : l'interaction n'ouvre rien, elle
     fait dormir (game.js). */
  defBlock(B.LIT, { name: 'Lit', tiles: [906, 906, 906], hardness: 0.2, tool: 'axe',
                    forme: 'meuble', meuble: 'lit', dodo: true, maxStack: 1 });
  defBlock(B.TABLE, { name: 'Table', tiles: [907, 907, 907], hardness: 2.0, tool: 'axe',
                      forme: 'meuble', meuble: 'table', maxStack: 1 });
  defBlock(B.CHAISE, { name: 'Chaise', tiles: [908, 908, 908], hardness: 2.0, tool: 'axe',
                       forme: 'meuble', meuble: 'chaise', maxStack: 1 });
  defBlock(B.ARMOIRE, { name: 'Armoire', tiles: [909, 909, 909], hardness: 2.5, tool: 'axe',
                        forme: 'meuble', meuble: 'armoire', interactive: 'armoire', maxStack: 1 });
  defBlock(B.ETAGERE, { name: 'Étagère', tiles: [910, 910, 910], hardness: 2.0, tool: 'axe',
                        forme: 'meuble', meuble: 'etagere', interactive: 'etagere', maxStack: 1 });
  defBlock(B.BIBLIOTHEQUE, { name: 'Bibliothèque', tiles: [911, 911, 911], hardness: 2.0, tool: 'axe',
                             forme: 'meuble', meuble: 'bibliotheque', interactive: 'bibliotheque', maxStack: 1 });
  defBlock(B.TAPIS, { name: 'Tapis', tiles: [912, 912, 912], hardness: 0.1, transparent: true,
                      pass: 'cutout', forme: 'meuble', meuble: 'tapis', maxStack: 1 });
  defBlock(B.LAMPE, { name: 'Lampe', tiles: [913, 913, 913], hardness: 0.5, transparent: true,
                      pass: 'cutout', light: 12, forme: 'meuble', meuble: 'lampe', maxStack: 1 });
  defBlock(B.VASE, { name: 'Vase', tiles: [914, 914, 914], hardness: 0.5, transparent: true,
                     pass: 'cutout', forme: 'meuble', meuble: 'vase', maxStack: 1 });
  defBlock(B.PRESENTOIR, { name: 'Présentoir', tiles: [915, 915, 915], hardness: 1.5, tool: 'axe',
                           transparent: true, pass: 'cutout', forme: 'meuble', meuble: 'presentoir',
                           expose: true, maxStack: 1 });
  defBlock(B.SOCLE, { name: 'Socle', tiles: [916, 916, 916], hardness: 2.0, tool: 'pickaxe', needsTool: true,
                      forme: 'meuble', meuble: 'socle', expose: true, maxStack: 1 });

  /* Livre et note (SPEC-INTERIEUR-003) : vierges tant que `data` (porté par
     la pile d'inventaire, voir inventory.js) ne contient rien — écrits puis
     signés depuis l'écran de lecture (ui.js), qui refuse ensuite toute
     modification (MC.Livres.estModifiable). */
  defItem(I.LIVRE, { name: 'Livre', tile: 917, livre: true, maxStack: 1 });
  defItem(I.NOTE, { name: 'Note', tile: 918, livre: true, maxStack: 1 });

  /* ─── état de bloc : `etatMax` (SPEC-SAVE-021) ─────────────────────────────
     L'état d'un bloc tient sur un octet (world.getEtat/setEtat). Chaque bloc
     déclare la plus grande valeur qu'il peut porter : 0 = bloc sans état (le
     cas général). La borne suit la disposition des bits de chaque famille ;
     tests/spec-ids.js balaie tous les producteurs d'état (MC.Formes,
     MC.Circuits.tick, MC.Feu, bâtiments générés) et échoue si l'un d'eux
     dépasse. Un bloc peut aussi déclarer `etatMax` dans sa définition. */
  var ETAT_MAX_FORME = {
    escalier: 63,   // orientation 2 bits | inversé 1 bit | forme d'angle 3 bits (formes.js)
    dalle: 1,       // moitié haute
    meuble: 7,      // orientation 2 bits | variante 1 bit (pied/tête du lit)
    // clôture, muret, vitre, rambarde : raccords recalculés depuis les voisins, rien de stocké
  };
  var ETAT_MAX_CIRCUIT = {           // dispositions lues par circuits.js (tick, forceDe)
    fil: 14, cable: 14,              // force reçue (≤ 15) moins 1 par bloc : 14 au plus
    levier: 1, bouton: 1, plaque: 1, // bit 0 = actionné (forceDe)
    // repeteur : sortie 1 bit | compte (≤ délai) dans les bits 1-7 — calculé plus bas
    non: 1, et: 1, ou: 1, xor: 1, nand: 1, nor: 1, xnor: 1, comparateur: 1,
    bascule: 3,                      // mémoire 1 bit | set précédent 1 bit
    compteur: 31,                    // valeur 4 bits | entrée précédente 1 bit
    lampe: 0,                        // allumée ou non : c'est l'id (LAMPE_ALLUMEE)
    tapis: 1, ascenseur: 1, alarme: 1,
    presence: 1, lumiere: 1, journuit: 1, meteo: 1, horloge: 1, eau: 1,
    eolienne: 15, hydraulique: 15, thermique: 15, batterie: 15,   // puissance / niveau 0..15
    distributeur: 1, commande: 1,    // dernier signal vu (front montant)
    piston: 15,                      // orientation 3 bits | sorti 1 bit
    'tete-piston': 0,
  };
  BLOCKS.forEach(function (d) {
    if (!d || d.etatMax !== undefined) return;
    var m = 0;
    if (d.forme && ETAT_MAX_FORME[d.forme] !== undefined) m = ETAT_MAX_FORME[d.forme];
    else if (d.circuit && d.circuit.type === 'repeteur') {
      // compte borné par le délai (circuits.js : pasRepeteur) : 1 | (délai << 1), 3 au délai 1 par défaut
      m = 1 | (Math.max(1, d.circuit.delai || 1) << 1);
    } else if (d.circuit) m = ETAT_MAX_CIRCUIT[d.circuit.type];   // type absent de la table : indéfini, le test le signale
    /* Portes et trappes : orientation et ouverture restent dans l'id (10 ids,
       décision L40-bis) ; seul le bit 0 mémorise le dernier signal vu par les
       circuits (SPEC-MECA-006, circuits.js). */
    else if (d.porte || d.trappe) m = 1;
    else if (d.id === B.FEU) m = 29;   // âge en pas de simulation : < MC.Feu.AGE_MAX (30), donc 29 au plus
    d.etatMax = m;
  });
  function etatMaxDe(id) { var d = BLOCKS[id]; return (d && !isItem(id) && d.etatMax) || 0; }

  MC.Core = {
    VERSION_JEU: VERSION_JEU, VERSION_GENERATION: VERSION_GENERATION,
    CHUNK_X: CHUNK_X, CHUNK_Z: CHUNK_Z, WORLD_H: WORLD_H, SEA_LEVEL: SEA_LEVEL,
    idx: idx, B: B, I: I, BLOCKS: BLOCKS, ITEMS: ITEMS, WHEAT_STAGES: WHEAT_STAGES,
    FIRST_ITEM: FIRST_ITEM, ANCIEN_FIRST_ITEM: ANCIEN_FIRST_ITEM, PLAGES_IDS: PLAGES_IDS,
    // `etatMaxDe` est l'API ; `etatMax` n'en est qu'un alias (même fonction)
    etatMaxDe: etatMaxDe, etatMax: etatMaxDe,
    DECALAGE_OBJETS_V1: DECALAGE_OBJETS_V1, isBlock: isBlock, isItem: isItem,
    def: def, nameOf: nameOf, maxStack: maxStack, passOf: passOf,
    lightOf: lightOf, lampeDe: lampeDe, durabilityOf: durabilityOf, TIER_DURABILITY: TIER_DURABILITY,
    isLog: isLog, isLeaves: isLeaves, isConifere: isConifere, isWater: isWater, isLava: isLava, TIER_NAME: TIER_NAME,
    isInflammable: isInflammable, estFumigene: estFumigene,
    TUILES_VARIABLES: TUILES_VARIABLES, INDEX_VARIANTES: INDEX_VARIANTES, tuileVariante: tuileVariante,
    PREMIERE_VARIANTE: PREMIERE_VARIANTE,
    isSolid: isSolid, isReplaceable: isReplaceable, occludes: occludes,
    BLOC_INCONNU: BLOC_INCONNU, defRendu: defRendu,
    breakTime: breakTime, dropsOf: dropsOf, TIER_SPEED: TIER_SPEED,
    boiteDe: boiteDe, estPorte: estPorte, estTrappe: estTrappe, bascule: bascule,
    orientDeRegard: orientDeRegard, PORTE_FERMEE_LIST: PORTE_FERMEE_LIST,
    PORTE_OUVERTE_LIST: PORTE_OUVERTE_LIST, EPAIS_PANNEAU: EPAIS_PANNEAU,
    tirerPiege: tirerPiege, tirerSurprise: tirerSurprise, tenterDesamorcage: tenterDesamorcage,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
