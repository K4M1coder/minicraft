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
  };

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
  function regles(modeId, diffId) {
    var m = mode(modeId), d = difficulte(diffId);
    return {
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
    return {
      zombie: r.monstres ? r.plafondMonstres : 0,
      sheep: 8,
      villager: 4,
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
    MODES: MODES, DIFFICULTES: DIFFICULTES, ORDRE_DIFFICULTES: ORDRE_DIFFICULTES,
    mode: mode, difficulte: difficulte, regles: regles, plafondsEntites: plafondsEntites,
    graineDepuisTexte: graineDepuisTexte, graineAleatoire: graineAleatoire,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
