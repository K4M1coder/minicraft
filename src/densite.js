/* densite.js — carte de densité humaine (L38, SPEC-DENSITE-001/002).
   Logique pure, comme biomes.js et habitats.js : entièrement déterminée par
   la graine et la position, sans dépendre de l'ordre d'exploration.

   Un bruit à grande échelle (« combien de monde par ici ? ») se combine à
   une habitabilité tirée du biome (fertilité), du relief, de la proximité de
   l'eau douce ou d'une côte, du climat et des volcans, pour classer chaque
   point en quatre bandes :
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

  /* Biomes hostiles à l'installation humaine, en deux familles :
     - le climat (SPEC-DENSITE-001) : les biomes que le climat seul dessine
       (MC.Biomes les classe d'après la température et l'humidité) — grand
       froid (taïga, pics glacés, glacier) et chaleur sèche (désert, badlands) ;
     - la fertilité : les sols et les milieux ingrats — montagnes, île aux
       champignons, marais, jungle dense.
     `MALUS_BIOME` réunit les deux (une seule table, lue biome par biome). */
  var MALUS_CLIMAT = { desert: 0.45, badlands: 0.5, pics_glaces: 0.7, glacier: 0.75, taiga: 0.12 };
  var MALUS_FERTILITE = { montagnes: 0.55, champignons: 0.4, marais: 0.22, jungle: 0.08 };
  var MALUS_BIOME = {};
  [MALUS_CLIMAT, MALUS_FERTILITE].forEach(function (t) { for (var k in t) MALUS_BIOME[k] = t[k]; });

  /* Le climat lu en continu (température t, humidité h de MC.Biomes.climat, 0..1),
     pour que deux points d'un même biome mais de climats très différents ne pèsent
     pas pareil : le grand froid (t bas), la chaleur sèche (t haut, h bas) et l'aridité
     (h bas) retirent de l'habitabilité même avant d'avoir fait basculer le biome.
     Le malus par biome ci-dessus reste le plancher : au cœur d'un désert ou d'un
     glacier, rien ne change. */
  var CLIMAT = { froid: 0.4, froidDe: 0.18, froidA: 0.34, chaleur: 0.5, chaleurDe: 0.60, chaleurA: 0.74,
                 secDe: 0.60, secA: 0.46, aridite: 0.3, aridDe: 0.25, aridA: 0.45 };
  function malusClimatContinu(cl) {
    var froid = CLIMAT.froid * (1 - smoothstep(CLIMAT.froidDe, CLIMAT.froidA, cl.t));
    var chaleur = CLIMAT.chaleur * smoothstep(CLIMAT.chaleurDe, CLIMAT.chaleurA, cl.t) * (1 - smoothstep(CLIMAT.secA, CLIMAT.secDe, cl.h));
    return froid + chaleur;
  }
  function malusAridite(cl) { return CLIMAT.aridite * (1 - smoothstep(CLIMAT.aridDe, CLIMAT.aridA, cl.h)); }

  /* SPEC-DENSITE-001 : le volcan pèse sur l'habitabilité — un volcan actif
     repousse l'installation (coulées, bombes, cendres : SPEC-RELIEF-011), un
     volcan éteint bien moins (pentes et cratère seulement). Le malus est plein
     sur le cône (jusqu'à 0,6 × R), puis s'éteint en douceur jusqu'à 2 × R. */
  var VOLCAN = { actif: 0.6, eteint: 0.25, plein: 0.6, portee: 2 };

  /* `env` (facultatif) : les données environnementales du monde —
     `volcanProche(x, z, facteur)` et `climat(x, z)` de MC.Biomes. Sans elle, la carte ne tient
     compte que des biomes, du relief et de l'eau. */
  function creer(N, hauteur, biomeDe, riviereDe, env) {
    env = env || {};
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

    /* Proximité d'un volcan (0..1, pondérée par son activité) : 1 sur le cône
       d'un volcan actif, 0 au-delà de VOLCAN.portee rayons. */
    function proximiteVolcan(x, z) {
      if (!env.volcanProche) return 0;
      var v = env.volcanProche(x, z, VOLCAN.portee);
      if (!v) return 0;
      var d = Math.hypot(x - v.x, z - v.z);
      var k = 1 - smoothstep(v.R * VOLCAN.plein, v.R * VOLCAN.portee, d);
      return k * (v.actif ? 1 : VOLCAN.eteint / VOLCAN.actif);
    }

    /* Les facteurs de l'habitabilité, un par donnée environnementale
       (SPEC-DENSITE-001) : chacun est ce qu'il ajoute (+) ou retire (-) à
       l'habitabilité de base 1 — mer, fertilité du biome, relief, eau douce
       et côtes, climat, volcans. */
    function facteurs(x, z) {
      var bio = biomeDe ? biomeDe(x, z) : null;
      var f = { mer: 0, fertilite: 0, relief: 0, eau: 0, climat: 0, volcan: 0 };
      if (bio) {
        if (bio.marin) f.mer = -0.85;
        if (MALUS_CLIMAT[bio.id]) f.climat = -MALUS_CLIMAT[bio.id];
        if (MALUS_FERTILITE[bio.id]) f.fertilite = -MALUS_FERTILITE[bio.id];
      }
      if (env.climat && !(bio && bio.marin)) {
        var cl = env.climat(x, z);
        f.climat = -Math.min(0.85, Math.max(-f.climat, malusClimatContinu(cl)));
        f.fertilite = -Math.min(0.85, Math.max(-f.fertilite, malusAridite(cl)));
      }
      f.relief = -(1 - planeite(x, z)) * 0.35;
      if (pointEau(x, z)) f.eau = 0.22;
      f.volcan = -VOLCAN.actif * proximiteVolcan(x, z);
      return f;
    }

    function habitabilite(x, z) {
      var f = facteurs(x, z);
      var h = 1 + f.mer + f.fertilite + f.relief + f.eau + f.climat + f.volcan;
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
    /* La densité varie à l'échelle de plusieurs centaines de blocs, mais la
       calculer coûte des dizaines d'appels au bruit (biomes et relief tout
       autour). Les routes et les zones la demandent à chaque nœud de tracé :
       sans cache, générer les chunks d'une ville prenait plus d'une minute.
       On la calcule donc une fois par coin d'une grille de PAS blocs et l'on
       interpole entre les quatre coins — écart négligeable à cette échelle. */
    var PAS = 16, coins = new Map();
    function valeurCoin(i, j) {
      var k = i + ',' + j, v = coins.get(k);
      if (v === undefined) {
        if (coins.size > 200000) coins.clear();
        v = valeurEn(i * PAS, j * PAS);
        coins.set(k, v);
      }
      return v;
    }
    function valeurLisse(x, z) {
      var fx = x / PAS, fz = z / PAS, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, w = fz - j;
      var a = valeurCoin(i, j), b = valeurCoin(i + 1, j), c = valeurCoin(i, j + 1), d = valeurCoin(i + 1, j + 1);
      return (a * (1 - u) + b * u) * (1 - w) + (c * (1 - u) + d * u) * w;
    }
    function classeEn(x, z) {
      var v = valeurLisse(x, z);
      return {
        classe: classeDe(v), valeur: v,
        versRurale: smoothstep(0, SEUILS.rurale, v),
        versUrbain: smoothstep(SEUILS.rurale, SEUILS.urbaine, v),
        versHyper: smoothstep(SEUILS.urbaine, SEUILS.hyperurbaine, v),
      };
    }

    return { classeEn: classeEn, valeurEn: valeurEn, habitabilite: habitabilite, facteurs: facteurs };
  }

  MC.Densite = { creer: creer, CLASSES: CLASSES, SEUILS: SEUILS, MALUS_BIOME: MALUS_BIOME,
                 CLIMAT: CLIMAT, MALUS_CLIMAT: MALUS_CLIMAT, MALUS_FERTILITE: MALUS_FERTILITE, VOLCAN: VOLCAN };
})(typeof globalThis !== 'undefined' ? globalThis : this);
