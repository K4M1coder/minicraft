/* livre.js — livre des recettes (survie) et livre des objets (créatif).
   Logique pure : le calcul de ce qui manque, de ce qui est réalisable et du
   remplissage de la grille ne connaît ni DOM ni rendu. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core, Inv = MC.Inventory;

  /* Besoins d'une recette, agrégés par objet.
     Une recette façonnée peut répéter le même ingrédient à plusieurs cases :
     il faut les additionner, sinon « 3 planches » passerait pour « 1 planche ». */
  function besoins(recette) {
    var agg = {};
    if (recette.type === 'shaped') {
      for (var y = 0; y < recette.h; y++) {
        for (var x = 0; x < recette.w; x++) {
          var ch = recette.pattern[y][x];
          if (ch === ' ') continue;
          var id = recette.keys[ch];
          if (!id) continue;
          agg[id] = (agg[id] || 0) + 1;
        }
      }
    } else {
      recette.ingredients.forEach(function (id) { agg[id] = (agg[id] || 0) + 1; });
    }
    return Object.keys(agg).map(function (k) {
      return { id: +k, n: agg[k], nom: C.nameOf(+k) };
    }).sort(function (a, b) { return b.n - a.n || a.id - b.id; });
  }

  /* Ce qui manque pour réaliser la recette avec cet inventaire. */
  function manques(recette, inv) {
    var out = [];
    besoins(recette).forEach(function (b) {
      var dispo = inv.count(b.id);
      if (dispo < b.n) out.push({ id: b.id, nom: b.nom, manque: b.n - dispo, requis: b.n });
    });
    return out;
  }

  function faisable(recette, inv) { return manques(recette, inv).length === 0; }

  /* Catalogue complet, annoté pour l'inventaire courant.
     Les recettes réalisables passent devant : c'est la question que se pose le
     joueur en ouvrant le livre — « que puis-je fabriquer maintenant ? ». */
  function catalogue(inv, filtre) {
    var f = (filtre || '').trim().toLowerCase();
    var out = Inv.RECIPES.map(function (r, i) {
      var b = besoins(r);
      var m = inv ? manques(r, inv) : b.map(function (x) {
        return { id: x.id, nom: x.nom, manque: x.n, requis: x.n };
      });
      return {
        index: i, recette: r, sortie: r.out, n: r.n,
        nom: C.nameOf(r.out), type: r.type,
        besoins: b, manques: m, faisable: m.length === 0,
      };
    });
    if (f) {
      out = out.filter(function (e) {
        if (e.nom.toLowerCase().indexOf(f) >= 0) return true;
        return e.besoins.some(function (b) { return b.nom.toLowerCase().indexOf(f) >= 0; });
      });
    }
    // tri stable : faisables d'abord, ordre de déclaration ensuite
    out.sort(function (a, b) {
      if (a.faisable !== b.faisable) return a.faisable ? -1 : 1;
      return a.index - b.index;
    });
    return out;
  }

  /* Dispose la recette dans une grille 3×3 et prélève les ingrédients.
     Renvoie la grille (tableau de 9 piles) ou null si irréalisable.
     On ne prélève QU'APRÈS avoir vérifié : un prélèvement partiel laisserait
     le joueur sans ses ressources et sans son objet. */
  /* Disposition PURE de la recette dans une grille n×n (aucun prélèvement) :
     { id, n:1 } par case occupée, `null` ailleurs. Base commune à
     `remplirGrille` (solo historique) et à `ui.js` `poserRecette`, qui,
     depuis B1 (docs/vague-2/B1.md § 6), pose une suite d'opérations
     `transfert` inv → grille plutôt que de muter directement les tableaux —
     la grille est désormais une zone au même titre que l'inventaire. */
  function disposition(recette, taille) {
    var n = taille || 3;
    var grille = new Array(n * n).fill(null);
    if (recette.type === 'shaped') {
      // on centre la recette en haut à gauche de la grille
      for (var y = 0; y < recette.h; y++) {
        for (var x = 0; x < recette.w; x++) {
          var ch = recette.pattern[y][x];
          if (ch === ' ') continue;
          var id = recette.keys[ch];
          if (!id) continue;
          grille[y * n + x] = { id: id, n: 1 };
        }
      }
    } else {
      recette.ingredients.forEach(function (id, i) {
        grille[i] = { id: id, n: 1 };
      });
    }
    return grille;
  }

  /* Dispose la recette dans une grille 3×3 et prélève les ingrédients.
     Renvoie la grille (tableau de 9 piles) ou null si irréalisable.
     On ne prélève QU'APRÈS avoir vérifié : un prélèvement partiel laisserait
     le joueur sans ses ressources et sans son objet.
     Conservée pour d'éventuels appelants directs (hors UI) ; `ui.js` ne
     l'utilise plus (voir `disposition` ci-dessus). */
  function remplirGrille(recette, inv, taille) {
    if (!faisable(recette, inv)) return null;
    var grille = disposition(recette, taille);
    // prélèvement effectif, une fois la grille sûre
    besoins(recette).forEach(function (b) { inv.remove(b.id, b.n); });
    return grille;
  }

  /* ── Livre des objets (créatif) ─────────────────────────────────────────
     Tout ce que le jeu connaît, blocs et objets séparés : chercher une pioche
     parmi les blocs de terrain serait pénible. */
  function catalogueObjets(filtre) {
    var f = (filtre || '').trim().toLowerCase();
    var blocs = [], objets = [];
    /* Les stades de croissance du blé sont des blocs, mais personne ne veut
       « poser du blé à moitié poussé » : on sème avec des graines. Les proposer
       ajouterait quatre entrées inutiles portant presque le même nom. */
    var cultures = {};
    C.WHEAT_STAGES.forEach(function (id) { cultures[id] = true; });
    for (var id = 1; id < C.FIRST_ITEM; id++) {
      var d = C.BLOCKS[id];
      if (!d || d.hardness < 0) continue;             // ni socle ni eau
      if (cultures[id]) continue;
      blocs.push({ id: id, nom: d.name, categorie: 'bloc' });
    }
    for (var j = C.FIRST_ITEM; j < C.ITEMS.length; j++) {
      var o = C.ITEMS[j];
      if (!o) continue;
      objets.push({ id: j, nom: o.name, categorie: 'objet' });
    }
    function garde(l) {
      if (!f) return l;
      return l.filter(function (e) { return e.nom.toLowerCase().indexOf(f) >= 0; });
    }
    return { blocs: garde(blocs), objets: garde(objets) };
  }

  /* Donne un objet directement. Réservé au créatif : en survie, cela
     court-circuiterait toute la boucle de jeu. */
  function donner(inv, id, n, regles) {
    if (!regles || !regles.blocsIllimites) return null;
    if (!C.def(id)) return null;
    var quantite = n || C.maxStack(id);
    var reste = inv.add(id, quantite);
    return { id: id, donne: quantite - reste, reste: reste };
  }

  MC.Livre = {
    besoins: besoins, manques: manques, faisable: faisable,
    catalogue: catalogue, remplirGrille: remplirGrille, disposition: disposition,
    catalogueObjets: catalogueObjets, donner: donner,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
