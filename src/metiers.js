/* metiers.js — règles des métiers villageois (SPEC-METIER-001 à 005), lues
   par economie.js. Logique pure, sans état : chaque fonction ne fait que
   calculer à partir de ce qu'on lui passe, jamais de Math.random. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var B = C.B, I = C.I;

  var SEUIL_BONUS = 15;      // échanges avant qu'une offre bonus s'active (METIER-003)
  var PLAFOND = 40;          // au-delà, le compte d'échanges cesse d'influer
  var SEUIL_STATUT = 20;     // ventes avant le statut qui ouvre la remise (METIER-004)
  var REMISE = 0.1;

  function o(give, get) { return { give: give, get: get }; }
  function e(n) { return { id: I.EMERALD, n: n }; }

  /* Une offre bonus par métier qui en a une (les autres n'en ont aucune) :
     un peu meilleure que l'offre de base équivalente du même métier, pour
     récompenser un PNJ qu'on a beaucoup fréquenté. */
  var OFFRES_BONUS = {
    fermier: [o([{ id: I.WHEAT, n: 6 }], e(1))],
    forgeron: [o([{ id: I.IRON_INGOT, n: 3 }], e(1))],
    menuisier: [o([{ id: B.LOG, n: 6 }], e(1))],
    tisserand: [o([{ id: I.FICELLE, n: 6 }], e(1))],
    marchand_ambulant: [o([{ id: I.RAW_FISH, n: 4 }], e(1))],
  };

  /* SPEC-METIER-003 : les offres bonus d'un métier s'activent à partir de
     SEUIL_BONUS échanges avec CE pnj (compté et plafonné à PLAFOND). */
  function offresActives(role, echanges) {
    var bornees = Math.min(echanges || 0, PLAFOND);
    if (bornees < SEUIL_BONUS) return [];
    return OFFRES_BONUS[role] || [];
  }

  /* SPEC-METIER-002 : certains objets vendus par le forgeron consomment du
     minerai (lingots de fer) du stock partagé du village. */
  var MINERAI_REQUIS = {};
  MINERAI_REQUIS[I.IRON_SWORD] = 2;
  MINERAI_REQUIS[I.IRON_AXE] = 2;
  MINERAI_REQUIS[I.IRON_PICKAXE] = 3;
  MINERAI_REQUIS[I.DIAMOND_PICKAXE] = 3;
  function mineraiRequis(offre) {
    if (!offre || !offre.get) return 0;
    return MINERAI_REQUIS[offre.get.id] || 0;
  }

  /* SPEC-METIER-004 : vendre une ressource au village fait progresser le
     métier associé à cette ressource, propre au joueur. */
  var METIER_DE_RESSOURCE = {};
  METIER_DE_RESSOURCE[I.WHEAT] = 'fermier';
  METIER_DE_RESSOURCE[I.IRON_INGOT] = 'forgeron';
  METIER_DE_RESSOURCE[B.LOG] = 'menuisier';
  METIER_DE_RESSOURCE[I.FICELLE] = 'tisserand';
  METIER_DE_RESSOURCE[I.RAW_FISH] = 'marchand_ambulant';
  function metierDeCollecte(offre) {
    if (!offre || !offre.give || !offre.give.length) return null;
    return METIER_DE_RESSOURCE[offre.give[0].id] || null;
  }

  /* SPEC-ENV-003 : seule ressource vendue par un métier AGRICOLE (fermier,
     METIER-001) — sert à economie.js:tickJour à repérer, sans dupliquer
     METIER_DE_RESSOURCE, quelle offre perd de la pousse en hiver. */
  var METIERS_AGRICOLES = { fermier: true };
  function estRessourceAgricole(objetId) {
    return !!METIERS_AGRICOLES[METIER_DE_RESSOURCE[objetId]];
  }

  /* SPEC-METIER-004 : une remise de REMISE une fois SEUIL_STATUT ventes
     atteintes pour ce métier. `etatJoueur` : { collecte: { [metier]: n } }. */
  function remise(etatJoueur, role) {
    if (!etatJoueur || !etatJoueur.collecte) return 0;
    return (etatJoueur.collecte[role] || 0) >= SEUIL_STATUT ? REMISE : 0;
  }

  MC.Metiers = {
    SEUIL_BONUS: SEUIL_BONUS, PLAFOND: PLAFOND, SEUIL_STATUT: SEUIL_STATUT, REMISE: REMISE,
    OFFRES_BONUS: OFFRES_BONUS,
    offresActives: offresActives, mineraiRequis: mineraiRequis,
    metierDeCollecte: metierDeCollecte, remise: remise,
    estRessourceAgricole: estRessourceAgricole,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
