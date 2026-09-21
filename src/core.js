/* core.js — constantes, définitions des blocs et des objets.
   Aucune dépendance : ni THREE, ni DOM. Chargeable sous Node comme dans le navigateur. */
(function (G) {
  'use strict';

  var MC = G.MC = G.MC || {};

  // ─── géométrie du monde ────────────────────────────────────────────────────
  var CHUNK_X = 16, CHUNK_Z = 16, WORLD_H = 80, SEA_LEVEL = 26;

  // index dans le tableau plat d'un chunk
  function idx(x, y, z) { return (y * CHUNK_Z + z) * CHUNK_X + x; }

  // ─── espace d'ids unifié ───────────────────────────────────────────────────
  // 0 = air, 1..63 = blocs (posables), 64+ = objets (non posables).
  // Un seul espace d'ids permet à l'inventaire, au craft et aux drops de
  // manipuler indifféremment un bloc ou un objet.
  var B = {
    AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6,
    PLANKS: 7, COBBLE: 8, BRICK: 9, GLASS: 10, WATER: 11,
    CRAFTING_TABLE: 12, FURNACE: 13, FARMLAND: 14,
    WHEAT0: 15, WHEAT1: 16, WHEAT2: 17, WHEAT3: 18,
    COAL_ORE: 19, IRON_ORE: 20, WOOL: 21, BEDROCK: 22, TORCH: 23, CHEST: 24,
  };
  var I = {
    STICK: 64, COAL: 65, IRON_INGOT: 66, WHEAT: 67, SEEDS: 68, BREAD: 69,
    RAW_MUTTON: 70, COOKED_MUTTON: 71, ROTTEN_FLESH: 72, EMERALD: 73,
    WOOD_PICKAXE: 74, STONE_PICKAXE: 75, IRON_PICKAXE: 76,
    WOOD_AXE: 77, STONE_AXE: 78, IRON_AXE: 79,
    WOOD_SHOVEL: 80, STONE_SHOVEL: 81, IRON_SHOVEL: 82,
    WOOD_SWORD: 83, STONE_SWORD: 84, IRON_SWORD: 85,
    WOOD_HOE: 86, STONE_HOE: 87,
    FICELLE: 88, ARC: 89, FLECHE: 90,
  };

  var FIRST_ITEM = 64;
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

  var TOOL_DEFS = [
    ['pickaxe', [I.WOOD_PICKAXE, I.STONE_PICKAXE, I.IRON_PICKAXE], 'Pioche', 36],
    ['axe',     [I.WOOD_AXE, I.STONE_AXE, I.IRON_AXE], 'Hache', 39],
    ['shovel',  [I.WOOD_SHOVEL, I.STONE_SHOVEL, I.IRON_SHOVEL], 'Pelle', 42],
    ['sword',   [I.WOOD_SWORD, I.STONE_SWORD, I.IRON_SWORD], 'Épée', 45],
    ['hoe',     [I.WOOD_HOE, I.STONE_HOE], 'Houe', 48],
  ];
  var TIER_NAME = ['', 'en bois', 'en pierre', 'en fer'];
  var TIER_DURABILITY = [0, 60, 132, 251];      // bois, pierre, fer
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
  function def(id) { return isItem(id) ? ITEMS[id] : BLOCKS[id]; }

  /* Trois régimes de rendu, à ne pas confondre :
     'opaque' — écrit la profondeur, aucun tri ;
     'cutout' — alphaTest : le fragment passe ou non, profondeur écrite, pas de tri
                (feuillage, cultures) ;
     'blend'  — fondu réel : exige depthWrite:false et un tri (eau, verre). */
  function passOf(id) { var d = BLOCKS[id]; return (d && d.pass) || 'opaque'; }
  function lightOf(id) { var d = BLOCKS[id]; return (d && d.light) || 0; }
  function durabilityOf(id) { var d = ITEMS[id]; return (d && d.durability) || 0; }
  function nameOf(id) { var d = def(id); return d ? d.name : (id === 0 ? 'Air' : '?' + id); }
  function maxStack(id) { var d = def(id); return (d && d.maxStack) || 64; }

  // un bloc arrête-t-il le joueur ?
  function isSolid(id) {
    var d = BLOCKS[id];
    return !!d && !d.liquid && !d.plant;
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
    if (d.plant) return false;
    return d.transparent ? nb === self : true;
  }

  // ─── temps de minage ───────────────────────────────────────────────────────
  var TIER_SPEED = [1, 2.5, 5, 8];   // main nue, bois, pierre, fer

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
    CHUNK_X: CHUNK_X, CHUNK_Z: CHUNK_Z, WORLD_H: WORLD_H, SEA_LEVEL: SEA_LEVEL,
    idx: idx, B: B, I: I, BLOCKS: BLOCKS, ITEMS: ITEMS, WHEAT_STAGES: WHEAT_STAGES,
    FIRST_ITEM: FIRST_ITEM, isBlock: isBlock, isItem: isItem,
    def: def, nameOf: nameOf, maxStack: maxStack, passOf: passOf,
    lightOf: lightOf, durabilityOf: durabilityOf, TIER_DURABILITY: TIER_DURABILITY,
    isSolid: isSolid, isReplaceable: isReplaceable, occludes: occludes,
    breakTime: breakTime, dropsOf: dropsOf, TIER_SPEED: TIER_SPEED,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
