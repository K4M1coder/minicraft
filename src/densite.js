/* densite.js — carte de densité humaine (L38, SPEC-DENSITE-001/002).
   Logique pure, comme biomes.js et habitats.js : entièrement déterminée par
   la graine et la position, sans dépendre de l'ordre d'exploration.

   Un bruit à grande échelle (« combien de monde par ici ? ») se combine à
   une habitabilité tirée du relief, du biome et de la proximité de l'eau
   douce ou d'une côte, pour classer chaque point en quatre bandes :
   vierge < rurale < urbaine < hyperurbaine. Les frontières sont lissées
   (smoothstep) plutôt que tranchées : `classeEn` renvoie, en plus de la
   classe, des poids de transition que `habitats.js` utilise pour moduler en
   douceur la probabilité qu'un lieu y naisse (faubourgs, banlieues, campagne
   qui se vide peu à peu — SPEC-DENSITE-002), au lieu d'un tout-ou-rien net.

   `classeEn(x, z)` est aussi le point d'extension prévu pour les zones de
   jeu (SPEC-ZONE-*, hors de cette tâche) : une autre tâche pourra le lire
   sans dépendre du reste de ce module. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var smoothstep = (MC.Biomes && MC.Biomes.smoothstep) || function (e0, e1, v) {
    var t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  // frontières des quatre classes, sur la valeur combinée [0,1]
  var SEUILS = { rurale: 0.22, urbaine: 0.52, hyperurbaine: 0.82 };
  var CLASSES = ['vierge', 'rurale', 'urbaine', 'hyperurbaine'];

  /* Biomes hostiles à l'installation humaine : leur fertilité chute d'autant
     (montagnes, glace et badlands en tête ; marais et forêts denses, moins). */
  var MALUS_BIOME = { montagnes: 0.55, desert: 0.45, badlands: 0.5, pics_glaces: 0.7,
                       glacier: 0.75, champignons: 0.4, marais: 0.22, taiga: 0.12, jungle: 0.08 };

  function creer(N, hauteur, biomeDe, riviereDe) {
    /* Le bruit de population, à une échelle bien plus large que le climat
       (SPEC-DENSITE-001) : plusieurs kilomètres séparent deux pics, si bien
       qu'une poche hyperurbaine reste un événement rare et isolé — jamais un
       simple aléa de quelques centaines de blocs. Décalage propre pour ne
       pas se corréler au bruit de température/humidité de biomes.js. */
    function bruitPopulation(x, z) {
      return N.fbm((x + 41777) / 3600, (z - 27331) / 3600, 3, 2, 0.5);
    }

    /* Un relief plat autour du point favorise l'installation — une grande
       plaine pour asseoir une mégapole, un flanc doux pour un hameau. */
    function planeite(x, z) {
      var R = 48, hs = [hauteur(x, z)];
      for (var a = 0; a < 4; a++) {
        var ang = a * Math.PI / 2;
        hs.push(hauteur(x + Math.cos(ang) * R, z + Math.sin(ang) * R));
      }
      var mn = Math.min.apply(null, hs), mx = Math.max.apply(null, hs);
      return 1 - smoothstep(4, 30, mx - mn);
    }

    /* Un rivage ou une rivière tout près : l'eau douce et les côtes relèvent
       l'habitabilité (et rendent un port possible — HABITAT-013, ROUTE-008). */
    function pointEau(x, z) {
      var R = 60;
      if (biomeDe) {
        for (var a = 0; a < 8; a++) {
          var ang = a * Math.PI / 4;
          var b = biomeDe(x + Math.cos(ang) * R, z + Math.sin(ang) * R);
          if (b && b.marin) return true;
        }
      }
      if (riviereDe) {
        for (var d = -R; d <= R; d += 20) {
          if (riviereDe(x + d, z) > 0.975 || riviereDe(x, z + d) > 0.975) return true;
        }
      }
      return false;
    }

    function habitabilite(x, z) {
      var bio = biomeDe ? biomeDe(x, z) : null;
      var h = 1;
      if (bio) {
        if (bio.marin) h -= 0.85;
        var m = MALUS_BIOME[bio.id];
        if (m) h -= m;
      }
      h -= (1 - planeite(x, z)) * 0.35;
      if (pointEau(x, z)) h += 0.22;
      return Math.max(0, Math.min(1, h));
    }

    function valeurEn(x, z) {
      var pop = smoothstep(0.30, 0.72, bruitPopulation(x, z));
      var hab = habitabilite(x, z);
      return Math.max(0, Math.min(1, pop * 0.62 + hab * 0.38));
    }

    function classeDe(v) {
      if (v < SEUILS.rurale) return 'vierge';
      if (v < SEUILS.urbaine) return 'rurale';
      if (v < SEUILS.hyperurbaine) return 'urbaine';
      return 'hyperurbaine';
    }

    /* SPEC-DENSITE-002 : trois poids de transition, chacun 0 avant sa
       frontière et 1 bien après, en douceur — ce que `habitats.js` combine
       pour moduler la probabilité d'un lieu plutôt que trancher net. */
    function classeEn(x, z) {
      var v = valeurEn(x, z);
      return {
        classe: classeDe(v), valeur: v,
        versRurale: smoothstep(0, SEUILS.rurale, v),
        versUrbain: smoothstep(SEUILS.rurale, SEUILS.urbaine, v),
        versHyper: smoothstep(SEUILS.urbaine, SEUILS.hyperurbaine, v),
      };
    }

    return { classeEn: classeEn, valeurEn: valeurEn, habitabilite: habitabilite };
  }

  MC.Densite = { creer: creer, CLASSES: CLASSES, SEUILS: SEUILS, MALUS_BIOME: MALUS_BIOME };
})(typeof globalThis !== 'undefined' ? globalThis : this);
