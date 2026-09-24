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
    if (r > 0.94 && m.lumiere) return m.lumiere;
    if (r > 0.8) return m.deco[Math.floor(r * 977) % m.deco.length];
    return 0;
  }

  MC.Souterrain = {
    ABIME_Y: ABIME_Y, BIOMES: BIOMES,
    biomeAt: biomeAt, materiaux: materiaux, mobsPour: mobsPour, decorSol: decorSol,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
