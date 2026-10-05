/* recifs.js — la flore sous-marine et les récifs (SPEC-MER-010, 011).
   Logique pure : ce qui pousse sur un fond selon sa profondeur, la
   température de l'eau et la lumière qui y parvient ; et les structures
   récifales — récifs frangeants au ras des côtes chaudes, barrières plus au
   large, atolls autour des îles volcaniques éteintes et leur lagon. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  /* La lumière qui parvient au fond (0..1) : elle s'éteint avec la profondeur. */
  function lumiereAuFond(prof) { return Math.exp(-Math.max(0, prof) / 9); }
  /* Les abysses (SPEC-LUMIERE-007) : à partir de cette profondeur, moins d'un
     quart de la lumière du jour parvient au fond. */
  var PROF_ABYSSES = 13, LUMIERE_ABYSSES = lumiereAuFond(PROF_ABYSSES);

  /* Chaque espèce : profondeurs, températures (t du climat 0..1) et lumière
     minimale où elle pousse, et sa fréquence. `B` : la table des blocs. */
  function especes(B) {
    return [
      { id: B.POSIDONIE,     nom: 'posidonie',     prof: [1, 12], t: [0.45, 0.8], lum: 0.3, p: 0.22 },
      { id: B.ANEMONE_ROSE,  nom: 'anémone',       prof: [2, 16], t: [0.5, 1],    lum: 0.15, p: 0.03 },
      { id: B.ANEMONE_VERTE, nom: 'anémone verte', prof: [4, 22], t: [0.3, 0.7],  lum: 0.1, p: 0.02 },
      { id: B.ALGUE_ROUGE,   nom: 'algue rouge',   prof: [6, 30], t: [0.2, 0.9],  lum: 0.03, p: 0.05 },
      { id: B.ALGUE_BRUNE,   nom: 'algue brune',   prof: [1, 10], t: [0, 0.55],   lum: 0.3, p: 0.08 },
      { id: B.GORGONE_POURPRE, nom: 'gorgone',     prof: [8, 40], t: [0.35, 1],   lum: 0, p: 0.03 },
      { id: B.EPONGE_JAUNE,  nom: 'éponge',        prof: [10, 60], t: [0, 1],     lum: 0, p: 0.015 },
      { id: B.EPONGE_ORANGE, nom: 'éponge orange', prof: [5, 30], t: [0.5, 1],    lum: 0, p: 0.012 },
      { id: B.LAMINAIRE,     nom: 'laminaire',     prof: [3, 20], t: [0, 0.4],    lum: 0.05, p: 0.1, colonne: true },
      // SPEC-LUMIERE-007 : dans les abysses, où le jour n'arrive presque plus, des algues qui luisent
      { id: B.ALGUE_LUMINEUSE, nom: 'algue luminescente', prof: [PROF_ABYSSES, 255], t: [0, 1], lum: 0, p: 0.02, sombre: LUMIERE_ABYSSES },
    ];
  }
  /* Ce qui pousse ici, ou null. `h1`, `h2` : deux tirages 0..1 propres à la colonne.
     `sombre` : une espèce des profondeurs ne pousse que là où la lumière du jour
     est tombée sous ce seuil (l'inverse de `lum`). */
  function floreEn(B, prof, t, h1, h2) {
    var l = lumiereAuFond(prof), candidats = especes(B).filter(function (e) {
      return prof >= e.prof[0] && prof <= e.prof[1] && t >= e.t[0] && t <= e.t[1] && l >= e.lum &&
             (e.sombre === undefined || l <= e.sombre);
    });
    var cumul = 0;
    for (var i = 0; i < candidats.length; i++) {
      cumul += candidats[i].p;
      if (h1 < cumul) return { id: candidats[i].id, colonne: !!candidats[i].colonne, hauteur: 2 + Math.floor(h2 * Math.max(1, prof - 3)) };
    }
    return null;
  }

  /* Structure récifale en (x, z). `ctx` : { prof, t (0..1), cote (0..1, proximité
     d'une côte : 1 au rivage), volcan (le plus proche : { x, z, R, actif }),
     bruit (0..1, lent, pour dessiner la barrière) }. Rend { type, sommet } où
     sommet est la profondeur visée du haut du récif (0 = à fleur d'eau). */
  function structureEn(x, z, ctx) {
    if (ctx.t < 0.6 || ctx.prof < 1) return null;        // les récifs veulent une eau chaude
    var v = ctx.volcan;
    if (v && !v.actif) {
      var d = Math.hypot(x - v.x, z - v.z), r0 = v.R * 1.25, r1 = v.R * 1.55;
      if (d >= r0 && d <= r1 && ctx.prof <= 14) return { type: 'atoll', sommet: 0 };
      if (d > v.R * 0.95 && d < r0 && ctx.prof <= 14) return { type: 'lagon', sommet: Math.min(ctx.prof, 3) };
    }
    if (ctx.prof <= 4 && ctx.cote > 0.7) return { type: 'frangeant', sommet: 1 };
    if (ctx.prof >= 5 && ctx.prof <= 12 && ctx.cote > 0.25 && ctx.cote < 0.55 && ctx.bruit > 0.42 && ctx.bruit < 0.58) {
      return { type: 'barriere', sommet: 1 };
    }
    return null;
  }

  MC.Recifs = { PROF_ABYSSES: PROF_ABYSSES, lumiereAuFond: lumiereAuFond, especes: especes, floreEn: floreEn, structureEn: structureEn };
})(typeof globalThis !== 'undefined' ? globalThis : this);
