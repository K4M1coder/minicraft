/* spec-livre.js — tests des specs SPEC-LIVRE-* et SPEC-GRILLE-*. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, Inv = MC.Inventory, L = MC.Livre, M = MC.Modes;
  var B = C.B, I = C.I;

  function recetteDe(idSortie) {
    for (var i = 0; i < Inv.RECIPES.length; i++) {
      if (Inv.RECIPES[i].out === idSortie) return Inv.RECIPES[i];
    }
    return null;
  }

  describe('Specs — livre des recettes', function () {

    it('SPEC-LIVRE-001 : le livre liste toutes les recettes', function () {
      var inv = Inv.create(36);
      var c = L.catalogue(inv);
      A.equal(c.length, Inv.RECIPES.length, 'autant d entrees que de recettes');
      c.forEach(function (e) {
        A.ok(e.nom && e.nom !== '?', 'chaque entree a un nom : ' + e.sortie);
        A.ok(e.n > 0, 'et une quantite produite');
      });
    });

    it('SPEC-LIVRE-002 : les ingredients et leurs quantites sont exacts', function () {
      // pioche en bois : 3 planches + 2 batons
      var r = recetteDe(I.WOOD_PICKAXE);
      A.ok(r, 'recette trouvee');
      var b = L.besoins(r);
      var parId = {};
      b.forEach(function (x) { parId[x.id] = x.n; });
      A.equal(parId[B.PLANKS], 3, 'trois planches');
      A.equal(parId[I.STICK], 2, 'deux batons');
      A.equal(b.length, 2, 'deux ingredients distincts');
    });

    it('SPEC-LIVRE-002 : une recette informe agrege ses ingredients repetes', function () {
      var r = recetteDe(I.BREAD);          // 3 bles
      var b = L.besoins(r);
      A.equal(b.length, 1, 'un seul ingredient distinct');
      A.equal(b[0].id, I.WHEAT);
      A.equal(b[0].n, 3, 'trois exemplaires, pas un');
    });

    it('SPEC-LIVRE-003 : une recette realisable est signalee', function () {
      var inv = Inv.create(36);
      inv.add(B.PLANKS, 3); inv.add(I.STICK, 2);
      var r = recetteDe(I.WOOD_PICKAXE);
      A.ok(L.faisable(r, inv), 'faisable avec juste ce qu il faut');
      A.equal(L.manques(r, inv).length, 0, 'rien ne manque');
    });

    it('SPEC-LIVRE-004 : une recette non realisable indique ce qui manque', function () {
      var inv = Inv.create(36);
      inv.add(B.PLANKS, 1);                 // il en faut 3, et 2 batons
      var r = recetteDe(I.WOOD_PICKAXE);
      var m = L.manques(r, inv);
      A.equal(m.length, 2, 'deux manques');
      var parId = {};
      m.forEach(function (x) { parId[x.id] = x.manque; });
      A.equal(parId[B.PLANKS], 2, 'il manque 2 planches');
      A.equal(parId[I.STICK], 2, 'il manque 2 batons');
    });

    it('SPEC-LIVRE-005 : les recettes realisables sont presentees en premier', function () {
      var inv = Inv.create(36);
      inv.add(B.LOG, 4);                    // permet tronc -> planches
      var c = L.catalogue(inv);
      var faisables = c.filter(function (e) { return e.faisable; });
      A.ok(faisables.length > 0, 'au moins une recette faisable');
      // toutes les faisables precedent toutes les autres
      var vuNonFaisable = false;
      c.forEach(function (e) {
        if (!e.faisable) vuNonFaisable = true;
        else A.notOk(vuNonFaisable, 'aucune faisable apres une non faisable');
      });
    });

    it('SPEC-LIVRE-005 : sans rien en poche, aucune recette n est faisable', function () {
      var c = L.catalogue(Inv.create(36));
      A.equal(c.filter(function (e) { return e.faisable; }).length, 0);
      c.forEach(function (e) { A.ok(e.manques.length > 0, e.nom + ' liste ses manques'); });
    });

    it('SPEC-LIVRE-006 : le livre se filtre par nom', function () {
      var inv = Inv.create(36);
      var tout = L.catalogue(inv);
      var pioches = L.catalogue(inv, 'pioche');
      A.ok(pioches.length > 0, 'des pioches existent');
      A.ok(pioches.length < tout.length, 'la recherche restreint');
      pioches.forEach(function (e) {
        A.ok(/pioche/i.test(e.nom), 'resultat pertinent : ' + e.nom);
      });
    });

    it('SPEC-LIVRE-006 : le filtre porte aussi sur les ingredients', function () {
      var r = L.catalogue(Inv.create(36), 'ficelle');
      A.ok(r.length > 0, 'des recettes utilisent la ficelle');
      A.ok(r.some(function (e) { return e.nom === 'Arc'; }), 'l arc en fait partie');
    });

    it('SPEC-LIVRE-007 : choisir une recette remplit la grille', function () {
      var inv = Inv.create(36);
      inv.add(B.PLANKS, 3); inv.add(I.STICK, 2);
      var g = L.remplirGrille(recetteDe(I.WOOD_PICKAXE), inv, 3);
      A.ok(g, 'grille produite');
      A.equal(g.length, 9);
      // motif MMM / _S_ / _S_
      A.equal(g[0].id, B.PLANKS); A.equal(g[1].id, B.PLANKS); A.equal(g[2].id, B.PLANKS);
      A.equal(g[3], null, 'case vide');
      A.equal(g[4].id, I.STICK);
      A.equal(g[7].id, I.STICK);
      // et la grille produit bien la recette attendue
      var ids = g.map(function (s) { return s ? s.id : 0; });
      var res = Inv.matchRecipe(ids, 3, 3);
      A.ok(res, 'la grille est reconnue');
      A.equal(res.id, I.WOOD_PICKAXE, 'elle donne bien une pioche');
    });

    it('SPEC-LIVRE-008 : le remplissage preleve les ingredients', function () {
      var inv = Inv.create(36);
      inv.add(B.PLANKS, 10); inv.add(I.STICK, 5);
      L.remplirGrille(recetteDe(I.WOOD_PICKAXE), inv, 3);
      A.equal(inv.count(B.PLANKS), 7, 'trois planches prelevees');
      A.equal(inv.count(I.STICK), 3, 'deux batons preleves');
    });

    it('SPEC-LIVRE-009 : une recette irrealisable ne preleve rien', function () {
      var inv = Inv.create(36);
      inv.add(B.PLANKS, 2);                 // il en faut 3
      var avant = inv.serialize();
      var g = L.remplirGrille(recetteDe(I.WOOD_PICKAXE), inv, 3);
      A.equal(g, null, 'aucune grille');
      A.deep(inv.serialize(), avant, 'inventaire intact, pas de prelevement partiel');
    });

    it('une recette informe se pose aussi dans la grille', function () {
      var inv = Inv.create(36);
      inv.add(B.LOG, 1);
      var g = L.remplirGrille(recetteDe(B.PLANKS), inv, 3);
      A.ok(g, 'grille produite');
      var ids = g.map(function (s) { return s ? s.id : 0; });
      A.equal(Inv.matchRecipe(ids, 3, 3).id, B.PLANKS, 'reconnue');
      A.equal(inv.count(B.LOG), 0, 'le tronc a ete preleve');
    });

    /* Toutes les recettes du jeu doivent etre posables ET reconnues : un motif
       mal recopie produirait une recette impossible a realiser depuis le livre. */
    it('toutes les recettes du livre produisent bien leur objet', function () {
      Inv.RECIPES.forEach(function (r) {
        var inv = Inv.create(36);
        L.besoins(r).forEach(function (b) { inv.add(b.id, b.n); });
        var g = L.remplirGrille(r, inv, 3);
        A.ok(g, 'grille pour ' + C.nameOf(r.out));
        var ids = g.map(function (s) { return s ? s.id : 0; });
        var res = Inv.matchRecipe(ids, 3, 3);
        A.ok(res, 'reconnue : ' + C.nameOf(r.out));
        A.equal(res.id, r.out, 'produit bien ' + C.nameOf(r.out));
        A.equal(res.n, r.n, 'en bonne quantite');
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — livre des objets (créatif)', function () {

    it('SPEC-LIVRE-011 : blocs et objets sont listes separement', function () {
      var c = L.catalogueObjets();
      A.ok(c.blocs.length > 5, 'des blocs');
      A.ok(c.objets.length > 5, 'des objets');
      c.blocs.forEach(function (e) { A.ok(C.isBlock(e.id), e.nom + ' est un bloc'); });
      c.objets.forEach(function (e) { A.ok(C.isItem(e.id), e.nom + ' est un objet'); });
    });

    it('SPEC-LIVRE-011 : les blocs incassables ne sont pas proposes', function () {
      var c = L.catalogueObjets();
      A.notOk(c.blocs.some(function (e) { return e.id === B.BEDROCK; }), 'pas de socle');
      A.notOk(c.blocs.some(function (e) { return e.id === B.WATER; }), 'pas d eau');
    });

    it('SPEC-LIVRE-011 : les stades de culture ne sont pas proposes', function () {
      var c = L.catalogueObjets();
      C.WHEAT_STAGES.forEach(function (id) {
        A.notOk(c.blocs.some(function (e) { return e.id === id; }),
                'pas de ' + C.nameOf(id) + ' : on seme avec des graines');
      });
      A.ok(c.objets.some(function (e) { return e.id === I.SEEDS; }), 'les graines, elles, y sont');
    });

    it('SPEC-LIVRE-006 : le catalogue d objets se filtre', function () {
      var c = L.catalogueObjets('pioche');
      A.equal(c.blocs.length, 0, 'aucun bloc ne s appelle pioche');
      A.equal(c.objets.length, 3, 'les trois pioches');
    });

    it('SPEC-LIVRE-010 : en creatif, le livre donne l objet demande', function () {
      var inv = Inv.create(36);
      var regles = M.regles('creatif', 'facile');
      var r = L.donner(inv, I.IRON_PICKAXE, 1, regles);
      A.ok(r, 'don accepte');
      A.equal(inv.count(I.IRON_PICKAXE), 1, 'la pioche est arrivee');
      L.donner(inv, B.COBBLE, null, regles);
      A.equal(inv.count(B.COBBLE), 64, 'une pile entiere par defaut');
    });

    it('SPEC-LIVRE-012 : en survie, le livre ne donne rien', function () {
      var inv = Inv.create(36);
      var regles = M.regles('survie', 'facile');
      A.equal(L.donner(inv, I.IRON_PICKAXE, 1, regles), null, 'refuse');
      A.equal(inv.count(I.IRON_PICKAXE), 0, 'rien recu');
      A.equal(L.donner(inv, B.COBBLE, 10, null), null, 'refuse sans regles');
    });

    it('SPEC-LIVRE-010 : un identifiant inconnu est refuse', function () {
      var inv = Inv.create(36);
      A.equal(L.donner(inv, 9999, 1, M.regles('creatif', 'facile')), null);
    });

    it('SPEC-LIVRE-010 : un inventaire plein renvoie le reliquat', function () {
      var inv = Inv.create(1);
      var regles = M.regles('creatif', 'facile');
      var r = L.donner(inv, B.COBBLE, 200, regles);
      A.equal(r.donne, 64, 'une pile casee');
      A.equal(r.reste, 136, 'le reste est signale');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — grille de craft 3×3', function () {

    it('SPEC-GRILLE-002 : toutes les recettes 3x3 marchent sans etabli', function () {
      // la grille de l inventaire fait desormais 3x3 : on verifie que les
      // recettes les plus grandes y tiennent
      var grandes = Inv.RECIPES.filter(function (r) {
        return r.type === 'shaped' && (r.w === 3 || r.h === 3);
      });
      A.ok(grandes.length > 0, 'des recettes 3x3 existent');
      grandes.forEach(function (r) {
        var inv = Inv.create(36);
        L.besoins(r).forEach(function (b) { inv.add(b.id, b.n); });
        var g = L.remplirGrille(r, inv, 3);
        A.ok(g, C.nameOf(r.out) + ' tient dans la grille 3x3');
      });
    });

    it('SPEC-GRILLE-003 : le coffre est fabricable', function () {
      var r = recetteDe(B.CHEST);
      A.ok(r, 'la recette du coffre existe');
      var inv = Inv.create(36);
      L.besoins(r).forEach(function (b) { inv.add(b.id, b.n); });
      var g = L.remplirGrille(r, inv, 3);
      A.ok(g, 'grille produite');
      var ids = g.map(function (s) { return s ? s.id : 0; });
      A.equal(Inv.matchRecipe(ids, 3, 3).id, B.CHEST, 'la grille donne un coffre');
    });

    it('SPEC-GRILLE-003 : le fourneau aussi', function () {
      var r = recetteDe(B.FURNACE);
      var inv = Inv.create(36);
      L.besoins(r).forEach(function (b) { inv.add(b.id, b.n); });
      var ids = L.remplirGrille(r, inv, 3).map(function (s) { return s ? s.id : 0; });
      A.equal(Inv.matchRecipe(ids, 3, 3).id, B.FURNACE);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
