/* spec-volcans.js — test de SPEC-RELIEF-011 : la vie d'un volcan actif. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var V = MC.Volcanisme;

  describe('Specs — volcans actifs', function () {
    it('SPEC-RELIEF-011 : un volcan actif fume, gronde, crache des bombes, et sa coulée descend puis se fige en basalte', function () {
      var w = MC.createWorld(20260921);
      var l = w.bio.volcansDansZone(-6000, -6000, 6000, 6000);
      var actif = l.filter(function (v) { return v.actif; })[0], eteint = l.filter(function (v) { return !v.actif; })[0];
      A.ok(actif, 'un volcan actif dans la région');
      // fumée permanente ; rien pour un volcan éteint
      A.gt(V.activite(actif, 10, w.seed).fumee, 0.1, 'il fume');
      if (eteint) A.equal(V.activite(eteint, 10, w.seed).fumee, 0, 'l éteint ne fume pas');
      // des éruptions, ni toujours ni jamais, les mêmes pour tous
      var eruptions = [];
      for (var k = 0; k < 40; k++) { var e = V.eruptionDe(actif, k * V.FENETRE + 1, w.seed); if (e) eruptions.push(e); }
      A.gt(eruptions.length, 3, 'de temps à autre');
      A.lt(eruptions.length, 30, 'pas toujours');
      A.deep(V.eruptionDe(actif, eruptions[0].debut, w.seed), eruptions[0], 'déterministe');
      var e0 = eruptions[0];
      A.ok(V.activite(actif, e0.debut - 5, w.seed).grondement, 'il gronde avant d entrer en éruption');
      var pendant = V.activite(actif, e0.debut + 5, w.seed);
      A.ok(pendant.eruption, 'éruption en cours'); A.equal(pendant.fumee, 1, 'panache épais');
      A.ok(!V.activite(actif, e0.fin + V.REFROIDISSEMENT + 5, w.seed).eruption, 'puis elle cesse');
      // bombes incandescentes : seulement pendant l'éruption, lancées vers le haut depuis le sommet
      var b = V.projectiles(actif, e0.debut, e0.debut + 10, w.seed);
      A.gt(b.length, 5, 'des bombes');
      b.forEach(function (p) { A.ok(p.vy > 0 && p.y >= actif.sommet, 'du cratère, vers le ciel'); });
      A.equal(V.projectiles(actif, e0.debut - 20, e0.debut - 10, w.seed).length, 0, 'aucune avant');
      A.deep(V.projectiles(actif, e0.debut, e0.debut + 10, w.seed), b, 'les mêmes pour tous');
      // la coulée part du bord du cratère et descend la pente
      var c = V.coulee(actif, e0, w.heightAt);
      A.gt(c.length, 5, 'une coulée');
      var d0 = Math.hypot(c[0].x - actif.x, c[0].z - actif.z);
      A.ok(d0 >= actif.cratere - 1 && d0 <= actif.cratere + 3, 'elle déborde du cratère');
      A.lt(c[c.length - 1].y, c[0].y, 'elle descend');
      for (var i = 1; i < c.length; i++) A.ok(c[i].y <= c[i - 1].y + 1, 'jamais plus d un bloc de remontée');
      // elle avance pendant l'éruption, puis se fige en basalte
      A.equal(V.etatCellule(c[0], e0, e0.debut - 1), null, 'pas avant');
      A.equal(V.etatCellule(c[0], e0, e0.debut + 1), 'lave');
      A.equal(V.etatCellule(c[c.length - 1], e0, e0.debut + 1), null, 'le front n est pas encore là');
      A.equal(V.etatCellule(c[c.length - 1], e0, e0.fin + V.REFROIDISSEMENT + 1), 'basalte', 'figée');
      A.equal(V.GRONDEMENT > 0, true);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
