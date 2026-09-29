/* spec-donjons.js — tests des specs SPEC-DONJON-013 à 016 : tailles et plans. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core;

  var w = null, parTaille = null;
  function recenser() {
    if (parTaille) return parTaille;
    w = MC.createWorld(20260921);
    parTaille = { petit: [], moyen: [], grand: [] };
    for (var rx = -12; rx < 12; rx++) for (var rz = -12; rz < 12; rz++) {
      var d = w.donjons.deRegion(rx, rz);
      if (d) parTaille[d.taille].push(d);
    }
    return parTaille;
  }
  // l'air d'un donjon parcouru depuis son vestibule : quelles salles atteint-on ?
  function atteintes(d) {
    var plan = new Map();
    d.blocs.forEach(function (b) { plan.set(b[0] + ',' + b[1] + ',' + b[2], b[3]); });
    function libre(k) {
      var v = plan.get(k);
      return v !== undefined && (v === 0 || !C.BLOCKS[v] || !C.BLOCKS[v].solid);
    }
    var v0 = d.salles[0], dep = [Math.round((v0.x0 + v0.x1) / 2), v0.y0, Math.round((v0.z0 + v0.z1) / 2)];
    var vu = new Set([dep.join(',')]), pile = [dep];
    var V = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    while (pile.length) {
      var p = pile.pop();
      for (var i = 0; i < 6; i++) {
        var q = [p[0] + V[i][0], p[1] + V[i][1], p[2] + V[i][2]], k = q.join(',');
        if (!vu.has(k) && libre(k)) { vu.add(k); pile.push(q); }
      }
    }
    return d.salles.map(function (s) {
      for (var x = s.x0; x <= s.x1; x++) for (var y = s.y0; y <= s.y1; y++) for (var z = s.z0; z <= s.z1; z++) {
        if (vu.has(x + ',' + y + ',' + z)) return true;
      }
      return false;
    });
  }

  describe('Specs — tailles et plans des donjons', function () {
    it('SPEC-DONJON-015 : trois tailles — petits d une salle, moyens de plusieurs salles, grands sur plusieurs niveaux', function () {
      var t = recenser();
      t.petit.forEach(function (d) { A.equal(d.salles.length, 1, 'une seule salle'); A.equal(d.niveaux, 1); });
      A.gt(t.moyen.length, 0, 'des moyens');
      t.moyen.forEach(function (d) { A.ok(d.salles.length >= 4, 'plusieurs salles'); A.equal(d.niveaux, 1, 'un niveau'); });
      A.gt(t.grand.length, 0, 'des grands');
      t.grand.forEach(function (d) { A.ok(d.salles.length >= 9, 'une dizaine de salles : ' + d.salles.length); A.ok(d.niveaux >= 2, 'plusieurs niveaux'); });
      A.deep(MC.Donjons.TAILLES, ['petit', 'moyen', 'grand']);
    });

    it('SPEC-DONJON-013 : toute salle est atteignable depuis l entrée, le gardien au plus profond, des gardes ailleurs', function () {
      var t = recenser();
      t.moyen.concat(t.grand).forEach(function (d) {
        A.ok(atteintes(d).every(Boolean), d.type + ' ' + d.id + ' : toutes les salles reliées');
        var g = d.salles.filter(function (s) { return s.gardien; });
        A.equal(g.length, 1, 'un gardien');
        A.equal(g[0].niveau, d.niveaux - 1, 'au niveau le plus profond');
        A.ok(d.spawn.x >= g[0].x0 && d.spawn.x <= g[0].x1 + 1 && d.spawn.z >= g[0].z0 && d.spawn.z <= g[0].z1 + 1, 'il s éveille dans sa salle');
        A.ok(w.salleDonjon(d.spawn.x, d.spawn.y + 0.5, d.spawn.z) === d, 'la salle du gardien est celle qui l éveille');
        d.salles.forEach(function (s, i) {
          if (s.vestibule || s.gardien) return;
          A.ok(d.gardes.some(function (gd) { return gd.salle === i; }), 'des gardes dans la salle ' + i);
        });
        // la pièce où l'on se tient, et ses gardes qui s'éveillent une fois
        var i1 = d.salles.findIndex(function (s) { return !s.vestibule && !s.gardien; });
        var s1 = d.salles[i1], pc = w.pieceDonjon((s1.x0 + s1.x1) / 2, s1.y0 + 0.5, (s1.z0 + s1.z1) / 2);
        A.ok(pc && pc.donjon === d && pc.index === i1, 'la pièce est reconnue');
      });
      var d0 = t.moyen[0], ents = MC.createEntities(w), i2 = d0.salles.findIndex(function (s) { return !s.vestibule && !s.gardien; });
      A.gt(ents.invoquerGardes(d0, i2).length, 0, 'les gardes s éveillent');
      A.equal(ents.invoquerGardes(d0, i2).length, 0, 'une seule fois');
    });

    it('SPEC-DONJON-014 : chaque type a son identité, et deux donjons du même type diffèrent', function () {
      var t = recenser(), tous = t.moyen.concat(t.grand);
      function signature(d) {
        var n = {};
        d.blocs.forEach(function (b) { if (b[3]) n[b[3]] = (n[b[3]] || 0) + 1; });
        return Object.keys(n).sort(function (a, b) { return n[b] - n[a]; })[0] | 0;   // le matériau dominant
      }
      var dominant = {};
      tous.forEach(function (d) { (dominant[d.type] = dominant[d.type] || {})[signature(d)] = 1; });
      var types = Object.keys(dominant);
      A.gt(types.length, 2, 'plusieurs types parmi les complexes : ' + types.join(','));
      var mats = types.map(function (ty) { return Object.keys(dominant[ty]).join('|'); });
      A.gt(new Set(mats).size, 1, 'des matériaux propres au type');
      // variantes : deux donjons d'un même type n'ont pas le même plan
      var parType = {};
      tous.forEach(function (d) { (parType[d.type] = parType[d.type] || []).push(d); });
      Object.keys(parType).forEach(function (ty) {
        var l = parType[ty];
        if (l.length < 2) return;
        var plan = function (d) { return d.salles.map(function (s) { return (s.x1 - s.x0) + 'x' + (s.z1 - s.z0) + '@' + (s.x0 - d.x) + ',' + (s.z0 - d.z); }).join(';'); };
        A.ok(plan(l[0]) !== plan(l[1]), ty + ' : deux plans distincts');
      });
    });

    it('SPEC-DONJON-016 : les grands sont rares, plus gardés et plus riches', function () {
      var t = recenser();
      A.gt(t.petit.length, t.moyen.length * 0.8, 'petits au moins aussi fréquents');
      A.gt(t.moyen.length, t.grand.length * 3, 'grands rares');
      t.grand.forEach(function (d) { A.gt(d.surface, 40, 'de la place sous un grand'); });
      var moy = function (l, f) { return l.reduce(function (a, d) { return a + f(d); }, 0) / l.length; };
      A.gt(moy(t.grand, function (d) { return d.gardes.length; }), moy(t.moyen, function (d) { return d.gardes.length; }), 'plus de gardes');
      A.ok(t.grand.every(function (d) { return d.gardes.some(function (g) { return g.sousGardien; }); }), 'des sous-gardiens');
      A.ok(t.moyen.every(function (d) { return !d.gardes.some(function (g) { return g.sousGardien; }); }), 'pas dans les moyens');
      // butin : plus d'objets en tout, à type égal
      function objets(d) {
        var n = 0;
        d.coffres.forEach(function (c) { var r = w.butinCoffre(c.x, c.y, c.z) || []; r.forEach(function (it) { n += it.n; }); });
        return n;
      }
      var g0 = t.grand[0], p0 = t.petit.filter(function (d) { return d.type === g0.type; })[0];
      if (p0) A.gt(objets(g0), objets(p0) * 2, 'un grand ' + g0.type + ' rapporte davantage');
      A.gt(t.grand[0].coffres.length, 1, 'plusieurs coffres');
      // les coffres d'un même donjon ne tirent pas le même butin
      var c = g0.coffres;
      A.ok(JSON.stringify(w.butinCoffre(c[0].x, c[0].y, c[0].z)) !== JSON.stringify(w.butinCoffre(c[1].x, c[1].y, c[1].z)), "butins distincts");
    });

    it('SPEC-DONJON-017 : un coffre pillé régénère son contenu après un long délai, distinct de POP-002', function () {
      var t = recenser();
      var d = t.moyen[0], DUREE_JOUR = 1200;

      // le délai est mesuré en jours simulés, et volontairement distinct du
      // délai de repeuplement des habitants (POP-002) — jamais la même valeur
      var delaiJours = w.donjons.delaiRegenCoffre(d);
      A.gt(delaiJours, 0, 'un délai positif');
      A.ok(delaiJours * DUREE_JOUR !== MC.Habitats.DELAI_REMPLACEMENT,
           'le délai de régénération d un coffre diffère du délai de repeuplement POP-002');

      // même donjon, même graine ⇒ toujours le même délai (déterministe)
      A.equal(w.donjons.delaiRegenCoffre(d), delaiJours, 'délai déterministe par graine');

      var tPille = 5000;
      var delaiHeure = delaiJours * DUREE_JOUR;

      // vide immédiatement après le pillage
      A.notOk(w.donjons.coffreRegenere(d, tPille, tPille, DUREE_JOUR), 'toujours vide juste après le pillage');
      // toujours vide avant l'écoulement du délai
      A.notOk(w.donjons.coffreRegenere(d, tPille, tPille + delaiHeure - 1, DUREE_JOUR), 'toujours vide juste avant le délai');
      // à nouveau garni une fois le délai écoulé
      A.ok(w.donjons.coffreRegenere(d, tPille, tPille + delaiHeure, DUREE_JOUR), 'garni une fois le délai écoulé');

      // composition déterministe par graine : le même coffre regarni donne
      // exactement le même butin qu'à l'origine (butin() ne dépend que du
      // donjon et de l'indice du coffre, jamais du nombre de pillages)
      var coffre = d.coffres[0];
      var avant = w.butinCoffre(coffre.x, coffre.y, coffre.z);
      var apres = w.butinCoffre(coffre.x, coffre.y, coffre.z);
      A.equal(JSON.stringify(avant), JSON.stringify(apres), 'composition déterministe après régénération');
    });

    it('SPEC-DONJON-017 : regenererCoffres() (server.js regenererCoffresDonjon) exercée directement, avec un faux conteneursPoses', function () {
      // server.js n'appelle plus que MC.Donjons.creer(...).regenererCoffres
      // avec ses VRAIES collections (coffresPilles, coffresPilleDepuis,
      // conteneursPoses) — ce test l'exerce elle-même avec de FAUSSES
      // collections, sur un VRAI coffre de donjon (déterministe par graine),
      // sans lancer de serveur ni naviguer jusqu'à un donjon réel.
      var t = recenser();
      var d = t.moyen[0], DUREE_JOUR = 1200;
      var coffre = d.coffres[0];
      var cle = coffre.x + ',' + coffre.y + ',' + coffre.z;
      var delaiHeure = w.donjons.delaiRegenCoffre(d) * DUREE_JOUR;
      var tPille = 10000;

      var coffresPilles = new Set([cle]);
      var coffresPilleDepuis = new Map();
      var conteneursPoses = new Map([[cle, { type: 'chest', slots: [] }]]);
      var fermetures = [];
      var onFermer = function (c) { fermetures.push(c); };

      // premier passage, juste après le pillage : rien ne bouge encore, mais
      // la première détection date bien l'entrée (coffresPilleDepuis)
      w.donjons.regenererCoffres(coffresPilles, coffresPilleDepuis, conteneursPoses, tPille, DUREE_JOUR, onFermer);
      A.ok(coffresPilles.has(cle), 'toujours marqué pillé, encore avant le délai');
      A.ok(conteneursPoses.has(cle), 'le conteneur existe toujours, encore avant le délai');
      A.equal(fermetures.length, 0, 'onFermer jamais appelé avant le délai');
      A.equal(coffresPilleDepuis.get(cle), tPille, 'la première détection date le pillage');

      // toujours avant le délai : re-appeler ne change toujours rien
      w.donjons.regenererCoffres(coffresPilles, coffresPilleDepuis, conteneursPoses, tPille + delaiHeure - 1, DUREE_JOUR, onFermer);
      A.ok(coffresPilles.has(cle), 'toujours pillé juste avant le délai');
      A.equal(fermetures.length, 0, 'onFermer toujours pas appelé juste avant le délai');

      // le délai est écoulé : le coffre régénère — onFermer AVANT la
      // suppression du conteneur (c'est le correctif : un abonné doit être
      // désabonné avant, jamais après ou jamais du tout)
      w.donjons.regenererCoffres(coffresPilles, coffresPilleDepuis, conteneursPoses, tPille + delaiHeure, DUREE_JOUR, onFermer);
      A.notOk(coffresPilles.has(cle), 'retiré de coffresPilles une fois le délai écoulé');
      A.notOk(conteneursPoses.has(cle), 'le conteneur est effacé — recréé neuf à la prochaine ouverture');
      A.notOk(coffresPilleDepuis.has(cle), 'l entrée « pillé depuis » est nettoyée');
      A.deep(fermetures, [cle], 'onFermer (fermerConteneurPourAbonnes en production) appelé exactement une fois, pour cette clé');

      // un coffre qui n'est PAS un coffre de donjon (coffreA renvoie null) —
      // ni régénéré, ni onFermer jamais appelé pour lui
      var cleInvalide = '999999,5,999999';
      var pillesInvalide = new Set([cleInvalide]);
      var conteneursInvalide = new Map([[cleInvalide, { type: 'chest', slots: [] }]]);
      var fermeturesInvalide = [];
      w.donjons.regenererCoffres(pillesInvalide, new Map(), conteneursInvalide, tPille + delaiHeure * 10, DUREE_JOUR,
                                  function (c) { fermeturesInvalide.push(c); });
      A.ok(conteneursInvalide.has(cleInvalide), 'un coffre hors donjon n est jamais touché par la régénération');
      A.equal(fermeturesInvalide.length, 0, 'onFermer jamais appelé pour un coffre qui n est pas un coffre de donjon');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
