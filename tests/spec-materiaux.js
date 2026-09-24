/* spec-materiaux.js — tests de SPEC-CONSTR-005/006/007 : verre teinté et
   teintures, matériaux de construction et leur génération naturelle, et le
   feu (propagation, extinction, lumière, fumée au vent). */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, Inv = MC.Inventory, F = MC.Feu;
  var B = C.B, I = C.I, CX = C.CHUNK_X, CZ = C.CHUNK_Z;

  function rien() { return 1; }      // rand qui ne fait jamais gagner un tirage < seuil
  function toujours() { return 0; }  // rand qui gagne toujours un tirage < seuil

  // grille 3×3 pour matchRecipe : ids en vrac, le reste à 0
  function grille9(ids) {
    var g = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (var i = 0; i < ids.length; i++) g[i] = ids[i];
    return g;
  }

  describe('Specs — matériaux L24', function () {
    // ─── SPEC-CONSTR-005 : fonte, teintures, verre et béton teintés ────────
    it('SPEC-CONSTR-005 : le verre se fond à partir du sable au fourneau', function () {
      A.equal(Inv.smeltResult(B.SAND), B.GLASS, 'sable fondu -> verre');
    });
    it('SPEC-CONSTR-005 : des colorants se tirent des fleurs, des minerais et de l encre de calmar', function () {
      A.deep(Inv.matchRecipe(grille9([I.INK_SAC]), 3, 3), { id: I.DYE_BLACK, n: 2 }, 'encre -> teinture noire');
      A.deep(Inv.matchRecipe(grille9([I.BONE_MEAL]), 3, 3), { id: I.DYE_WHITE, n: 2 }, 'poudre d os -> teinture blanche');
      A.deep(Inv.matchRecipe(grille9([I.COAL]), 3, 3), { id: I.DYE_GRAY, n: 2 }, 'charbon -> teinture grise');
      A.deep(Inv.matchRecipe(grille9([B.FLOWER_RED]), 3, 3), { id: I.DYE_RED, n: 2 }, 'coquelicot -> teinture rouge (déjà là)');
    });
    it('SPEC-CONSTR-005 : les teintures teignent laine, verre, béton et terre cuite', function () {
      A.deep(Inv.matchRecipe(grille9([B.WOOL, I.DYE_BLACK]), 3, 3), { id: B.WOOL_BLACK, n: 1 }, 'laine noire');
      A.deep(Inv.matchRecipe(grille9([B.WOOL, I.DYE_GRAY]), 3, 3), { id: B.WOOL_GRAY, n: 1 }, 'laine grise');
      A.deep(Inv.matchRecipe(grille9([B.TERRACOTTA, I.DYE_BLUE]), 3, 3), { id: B.TERRACOTTA_BLUE, n: 1 }, 'terre cuite bleue');
      var neufVerres = grille9([B.GLASS, B.GLASS, B.GLASS, B.GLASS, B.GLASS, B.GLASS, B.GLASS, B.GLASS, I.DYE_RED]);
      A.deep(Inv.matchRecipe(neufVerres, 3, 3), { id: B.VERRE_ROUGE, n: 8 }, 'verre teinté rouge');
      var poudre = grille9([B.SAND, B.SAND, B.SAND, B.SAND, B.GRAVEL, B.GRAVEL, B.GRAVEL, B.GRAVEL, I.DYE_BLUE]);
      A.deep(Inv.matchRecipe(poudre, 3, 3), { id: B.BETON_POUDRE_BLEU, n: 8 }, 'béton en poudre bleu');
      var durci = grille9([B.BETON_POUDRE_BLEU, B.BETON_POUDRE_BLEU, B.BETON_POUDRE_BLEU, B.BETON_POUDRE_BLEU, I.SEAU_EAU]);
      A.deep(Inv.matchRecipe(durci, 3, 3), { id: B.BETON_BLEU, n: 4 }, 'béton bleu, poudre + eau');
      A.ok(C.BLOCKS[B.VERRE_ROUGE].transparent, 'le verre teinté reste transparent');
    });

    // ─── SPEC-CONSTR-006 : matériaux et génération naturelle ───────────────
    it('SPEC-CONSTR-006 : marbre, chaume et poutres se fabriquent, pour chaque essence', function () {
      A.deep(Inv.matchRecipe(grille9([B.STONE, B.STONE, B.STONE, B.STONE, B.STONE, B.STONE, B.STONE, B.STONE, B.STONE]), 3, 3),
             { id: B.MARBRE, n: 1 }, 'marbre taillé dans la pierre');
      ['CHENE', 'SAPIN', 'BOULEAU', 'ACACIA', 'JUNGLE'].forEach(function (nom) {
        A.ok(C.BLOCKS[B['POUTRE_' + nom]], 'poutre ' + nom + ' définie');
        A.ok(C.isInflammable(B['POUTRE_' + nom]), 'poutre ' + nom + ' inflammable');
      });
      A.ok(C.isInflammable(B.CHAUME), 'le chaume prend feu');
    });
    it('SPEC-CONSTR-006 : marbre et ardoise se trouvent naturellement en sous-sol', function () {
      // un petit monde réel : quelques chunks suffisent, la densité du filon
      // rend la présence quasi certaine sur autant de colonnes.
      var w = MC.createWorld(4242);
      var trouveMarbre = false, trouveArdoise = false;
      for (var cx = -2; cx <= 2 && !(trouveMarbre && trouveArdoise); cx++) {
        for (var cz = -2; cz <= 2 && !(trouveMarbre && trouveArdoise); cz++) {
          var c = w.getChunk(cx, cz, true);
          for (var i = 0; i < c.blocks.length; i++) {
            if (c.blocks[i] === B.MARBRE) trouveMarbre = true;
            if (c.blocks[i] === B.ARDOISE) trouveArdoise = true;
          }
        }
      }
      A.ok(trouveMarbre, 'du marbre est apparu dans le sous-sol généré');
      A.ok(trouveArdoise, 'de l ardoise est apparue dans le sous-sol généré');
    });

    // ─── SPEC-CONSTR-007 : le feu ───────────────────────────────────────────
    it('SPEC-CONSTR-007 : un matériau inflammable prend, un autre non', function () {
      A.ok(F.inflammable(B.PLANKS), 'les planches sont inflammables');
      A.ok(F.inflammable(B.WOOL_BLACK), 'la laine noire est inflammable');
      A.notOk(F.inflammable(B.STONE), 'la pierre ne prend pas');
      A.notOk(F.inflammable(B.MARBRE), 'le marbre ne prend pas');
    });
    it('SPEC-CONSTR-007 : le feu se propage à un voisin inflammable, ou s éteint sans combustible', function () {
      function lireAvecPlanches(blocs) {
        return function (x, y, z) { var k = x + ',' + y + ',' + z; return blocs[k] !== undefined ? blocs[k] : 0; };
      }
      // un feu entouré de planches, avec un tirage qui gagne toujours : il se propage
      var blocs = {};
      blocs['0,0,0'] = B.FEU; blocs['1,0,0'] = B.PLANKS; blocs['0,-1,0'] = B.STONE;
      var etats = {};
      var lire = lireAvecPlanches(blocs);
      var lireEtat = function (x, y, z) { return etats[x + ',' + y + ',' + z] || 0; };
      var ops = F.etapeFeu(lire, lireEtat, 0, 0, 0, toujours, false);
      var propage = ops.some(function (o) { return o[0] === 1 && o[3] === B.FEU; });
      A.ok(propage, 'la flamme a gagné le voisin inflammable');
      A.ok(F.aDuCombustibleAutour(lire, 0, 0, 0), 'du combustible est bien détecté autour');
      A.ok(F.surAppuiSolide(lire, 0, 0, 0), 'le feu repose sur un appui solide');

      // posé sur un appui solide (pierre) mais sans rien à bruler autour : il
      // dure quelques pas puis s'éteint (AGE_SANS_COMBUSTIBLE), jamais AGE_MAX
      var blocsSeul = {}; blocsSeul['0,0,0'] = B.FEU; blocsSeul['0,-1,0'] = B.STONE;
      var lireSeul = lireAvecPlanches(blocsSeul);
      var age = 0, id = B.FEU, pasEcoules = 0;
      for (var pas = 0; pas < F.AGE_MAX && id === B.FEU; pas++) {
        var out = F.etapeFeu(lireSeul, function () { return age; }, 0, 0, 0, rien, false);
        pasEcoules++;
        out.forEach(function (o) { if (o[0] === 0 && o[1] === 0 && o[2] === 0) { id = o[3]; age = o[4] || 0; blocsSeul['0,0,0'] = id; } });
      }
      A.equal(id, 0, 'sans combustible autour, le feu finit par s éteindre');
      A.ok(pasEcoules <= F.AGE_SANS_COMBUSTIBLE + 1, 'il s éteint bien avant AGE_MAX, faute de combustible');
    });
    it('SPEC-CONSTR-007 : le feu s éteint au contact de l eau ou sous la pluie', function () {
      function lire(x, y, z) {
        if (x === 0 && y === 0 && z === 0) return B.FEU;
        if (x === 1 && y === 0 && z === 0) return B.WATER;
        return 0;
      }
      var out = F.etapeFeu(lire, function () { return 0; }, 0, 0, 0, rien, false);
      A.deep(out, [[0, 0, 0, 0, 0]], 'de l eau adjacente éteint le feu');
      A.ok(F.estMouille(lire, 0, 0, 0, false), 'estMouille détecte l eau voisine');
      var lireSec = function (x, y, z) { return (x === 0 && y === 0 && z === 0) ? B.FEU : 0; };
      var outPluie = F.etapeFeu(lireSec, function () { return 0; }, 0, 0, 0, rien, true);
      A.deep(outPluie, [[0, 0, 0, 0, 0]], 'la pluie à ciel ouvert éteint aussi le feu');
    });
    it('SPEC-CONSTR-007 : le feu et le foyer sont des sources de lumière (src/lumiere.js)', function () {
      A.gt(C.lampeDe(B.FEU), 0, 'le feu éclaire');
      A.gt(C.lampeDe(B.FOYER), 0, 'le foyer éclaire');
      A.ok(C.estFumigene(B.FEU), 'le feu fume');
      A.ok(C.estFumigene(B.FOYER), 'le foyer fume');
      A.ok(C.estFumigene(B.CHEMINEE), 'la cheminée fume');
      A.ok(C.estFumigene(B.TORCH), 'la torche fume aussi');
    });
    it('SPEC-CONSTR-007 : la lave peut allumer un matériau inflammable tout proche', function () {
      var lire = function (x, y, z) { if (x === 0 && y === 0 && z === 0) return B.PLANKS; if (x === 1) return B.LAVA; return 0; };
      A.ok(F.presDeLave(lire, 0, 0, 0), 'la lave est détectée à côté');
      A.deep(F.allumerParLave(lire, 0, 0, 0, toujours), [[0, 0, 0, B.FEU, 0]], 'la planche prend feu, tirage favorable');
      A.deep(F.allumerParLave(lire, 0, 0, 0, rien), [], 'tirage défavorable : rien ne se passe encore');
    });
    it('SPEC-CONSTR-007 : la foudre allume ce qu\'elle touche, si c\'est inflammable', function () {
      // le bloc frappé au sol est inflammable : il prend feu directement
      var lireSol = function (x, y, z) { return (x === 0 && y === 10 && z === 0) ? B.PLANKS : 0; };
      A.deep(F.allumerParFoudre(lireSol, 0, 10, 0), [[0, 10, 0, B.FEU, 0]], 'le sol frappé prend feu');
      // le sol n'est pas inflammable (pierre), mais ce qui est juste au-dessus l'est (une charpente)
      var lireDessus = function (x, y, z) {
        if (x === 0 && y === 10 && z === 0) return B.STONE;
        if (x === 0 && y === 11 && z === 0) return B.PLANKS;
        return 0;
      };
      A.deep(F.allumerParFoudre(lireDessus, 0, 10, 0), [[0, 11, 0, B.FEU, 0]], 'sinon le bloc juste au-dessus');
      // rien d'inflammable nulle part : pas de feu
      var lireRien = function () { return B.STONE; };
      A.deep(F.allumerParFoudre(lireRien, 0, 10, 0), [], 'rien à allumer : rien ne se passe');
    });
    it('SPEC-CONSTR-007 : un briquet peut allumer un feu contre un matériau inflammable ou un appui', function () {
      var lireAvecPlanche = function (x, y, z) { return (x === 1 && y === 0 && z === 0) ? B.PLANKS : 0; };
      A.ok(F.peutAllumer(lireAvecPlanche, 0, 0, 0), 'une case vide contre une planche peut s allumer');
      var lireVide = function () { return 0; };
      A.notOk(F.peutAllumer(lireVide, 0, 0, 0), 'flottant dans le vide, rien à allumer');
      var lireSurRoche = function (x, y, z) { return (y === -1) ? B.STONE : 0; };
      A.ok(F.peutAllumer(lireSurRoche, 0, 0, 0), 'posé sur un sol solide, un feu peut aussi prendre');
      // I.BRIQUET (l'objet posé par le joueur) porte le drapeau que player.js consulte
      A.ok(C.def(I.BRIQUET).briquet, 'le briquet est reconnu comme tel par le craft/l inventaire');
    });
    it('SPEC-CONSTR-007 : propagation, extinction et lumière sur un petit monde réel (world.js)', function () {
      var w = MC.createWorld(9001);
      w.getChunk(0, 0, true);
      var x = 5, y = 90, z = 5;   // haut dans les airs : garanti vide, sans dépendre du terrain généré
      w.setBlock(x, y, z, B.STONE);
      w.setBlock(x + 1, y, z, B.STONE);          // appui sous la planche voisine aussi
      w.setBlock(x, y + 1, z, B.PLANKS);
      w.setBlock(x + 1, y + 1, z, B.PLANKS);
      w.setBlock(x, y + 1, z, B.FEU);
      w.setEtat(x, y + 1, z, 0);
      var registre = false;
      w.lights.forEach(function (l) { if (l.x === x && l.y === y + 1 && l.z === z) registre = true; });
      A.ok(registre, 'le feu posé s enregistre comme source de lumière');
      var gagne = false;
      for (var pas = 0; pas < 40 && !gagne; pas++) {
        w.coulerFeu(64, undefined, toujours);
        if (w.getBlock(x + 1, y + 1, z) === B.FEU) gagne = true;
      }
      A.ok(gagne, 'la planche voisine a fini par prendre feu (tirage toujours favorable)');
      // de l'eau versée juste au-dessus du foyer d'origine l'éteint dès le
      // passage suivant (immédiat : ce n'est pas juste qu'il se serait
      // essoufflé de toute façon, faute de combustible, quelques pas plus tard)
      w.setBlock(x, y + 2, z, B.WATER);
      w.coulerFeu(64, undefined, toujours);
      A.equal(w.getBlock(x, y + 1, z), 0, 'l eau au-dessus a éteint ce foyer, dès le pas suivant');
    });

    // ─── fumée : dérive pure avec le vent (rendu dans render.js:majFumees) ──
    it('SPEC-CONSTR-007 : la fumée monte et dérive avec le vent (fonction pure)', function () {
      var ventNul = function () { return { x: 0, z: 0 }; };
      var p0 = F.deriveeFumee(10, 5, 10, 0, 2, ventNul);
      A.deep(p0, { x: 10, y: 5, z: 10 }, 'à l âge 0, aucune dérive');
      var sansVent = F.deriveeFumee(10, 5, 10, 3, 2, ventNul);
      A.equal(sansVent.y, 11, 'elle monte de montee*age sans vent');
      A.close(sansVent.x, 10, 1e-9, 'sans vent, aucune dérive horizontale');
      var ventEst = function () { return { x: 4, z: 0 }; };
      var avecVent = F.deriveeFumee(10, 5, 10, 3, 2, ventEst);
      A.equal(avecVent.x, 10 + 4 * 3, 'elle dérive d autant plus qu elle est âgée');
      var ventParAltitude = function (y) { return { x: y > 20 ? 9 : 0, z: 0 }; };
      var basse = F.deriveeFumee(0, 0, 0, 1, 2, ventParAltitude);
      var haute = F.deriveeFumee(0, 30, 0, 1, 2, ventParAltitude);
      A.equal(basse.x, 0, 'à basse altitude, le vent local est nul ici');
      A.equal(haute.x, 9, 'à haute altitude, un vent plus fort la pousse davantage');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
