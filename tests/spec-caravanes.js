/* spec-caravanes.js — test de SPEC-ROUTE-006 : caravanes, voyageurs, bateaux. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var CV = MC.Caravanes;

  describe('Specs — convois', function () {
    it('SPEC-ROUTE-006 : caravanes et voyageurs circulent sur les routes, des bateaux entre les ports, les mêmes pour tous @lent', function () {
      // la géométrie d'un tracé
      var ligne = [{ x: 0, y: 30, z: 0 }, { x: 10, y: 30, z: 0 }, { x: 10, y: 32, z: 10 }];
      var cum = CV.longueurs(ligne);
      A.deep(cum, [0, 10, 20]);
      var mi = CV.pointA(ligne, cum, 15);
      A.close(mi.x, 10.5, 1e-9); A.close(mi.z, 5.5, 1e-9); A.close(mi.y, 31, 1e-9);
      // composition selon le rôle
      var c = CV.composition('commerce', 'x');
      A.equal(c[0].role, 'marchand_ambulant', 'un marchand en tête');
      A.ok(c.slice(1).every(function (m) { return m.role === 'bat'; }) && c.length >= 2, 'et ses bêtes de bât');
      var t = CV.composition('tourisme', 'y');
      A.equal(t[0].role, 'guide'); A.gt(t.length, 2, 'des voyageurs');
      A.equal(CV.composition('bateau', 'z')[0].type, 'bateau');
      // sur un vrai monde : une ville et ses routes
      var w = MC.createWorld(20260921);
      var villes = w.habitats.lieuxProches(0, 0, 4000).filter(function (l) { return l.kind === 'ville'; });
      A.gt(villes.length, 0, 'une ville');
      var trajets = [];
      for (var i = 0; i < villes.length && trajets.length === 0; i++) trajets = CV.trajetsDe(villes[i], w.routes);
      A.gt(trajets.length, 0, 'des trajets depuis la ville');
      var tr = trajets[0];
      // au fil d'une journée, des convois passent
      var vus = 0, convois = {};
      for (var s = 0; s < 3 * CV.PERIODE; s += 20) {
        CV.enRoute(tr, s).forEach(function (f) {
          vus++; convois[f.convoi] = 1;
          // chaque membre est sur le tracé
          var proche = tr.noeuds.some(function (n) { return Math.hypot(n.x + 0.5 - f.x, n.z + 0.5 - f.z) < 3; });
          A.ok(proche, 'sur la route');
        });
      }
      A.gt(vus, 0, 'des convois passent');
      A.gt(Object.keys(convois).length, 0);
      A.deep(CV.enRoute(tr, 1234), CV.enRoute(tr, 1234), 'les mêmes pour tous, à la même heure');
      // un convoi : ses membres se suivent à distance régulière, et il avance
      var instant = null;
      for (var s2 = 0; s2 < 3 * CV.PERIODE && !instant; s2 += 5) {
        var l = CV.enRoute(tr, s2);
        var parConvoi = {};
        l.forEach(function (f) { (parConvoi[f.convoi] = parConvoi[f.convoi] || []).push(f); });
        Object.keys(parConvoi).forEach(function (k) { if (parConvoi[k].length >= 2 && !instant) instant = { t: s2, m: parConvoi[k] }; });
      }
      A.ok(instant, 'un convoi complet en route');
      var d01 = Math.hypot(instant.m[0].x - instant.m[1].x, instant.m[0].z - instant.m[1].z);
      A.ok(d01 <= CV.ESPACEMENT + 0.01, 'ils se suivent');
      var tete = instant.m[0], plusTard = CV.enRoute(tr, instant.t + 10).filter(function (f) { return f.id === tete.id; })[0];
      if (plusTard) A.gt(Math.hypot(plusTard.x - tete.x, plusTard.z - tete.z), 5, 'il avance');
      // bateaux : seulement si l'eau relie les deux ports
      var p1 = { id: 'a', x: 0, z: 0, nom: 'A' }, p2 = { id: 'b', x: 200, z: 0, nom: 'B' };
      var b = CV.voieEau(p1, p2, function () { return true; }, 26.4);
      A.ok(b && b.role === 'bateau', 'une voie d eau');
      A.equal(CV.voieEau(p1, p2, function (x) { return x < 100; }, 26.4), null, 'pas à travers les terres');
      var bat = [];
      for (var s3 = 0; s3 < 8 * CV.PERIODE && !bat.length; s3 += 10) bat = CV.enRoute(b, s3);
      A.ok(bat.length && bat[0].type === 'bateau', 'un bateau navigue');
      A.gt(CV.VITESSE.bateau, CV.VITESSE.commerce);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
