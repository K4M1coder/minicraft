/* spec-apparence.js — tests de SPEC-MOB-010 : variantes, poses, niveau de détail. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var AP = MC.Apparence;

  describe('Specs — apparence des créatures', function () {
    it('SPEC-MOB-010 : variantes par individu, vêtements selon le métier, poses animées, modèle simple au loin', function () {
      // variantes : stables pour un individu, diverses d'un individu à l'autre
      A.deep(AP.variante('sheep', 42), AP.variante('sheep', 42), 'même individu, même allure');
      var tailles = {}, teintes = {};
      for (var i = 0; i < 40; i++) {
        var v = AP.variante('zombie', i);
        A.ok(v.echelle >= 0.9 && v.echelle <= 1.1, 'taille bornée');
        tailles[v.echelle.toFixed(2)] = 1; teintes[v.teinte.toFixed(2)] = 1;
      }
      A.gt(Object.keys(tailles).length, 10, 'des tailles variées');
      A.gt(Object.keys(teintes).length, 10, 'des teintes variées');
      A.equal(AP.variante('villager', 'Jeanne', 'forgeron').accessoire, 'tablier', 'le forgeron porte son tablier');
      A.equal(AP.variante('garde', 7, 'garde').accessoire, 'casque', 'le garde son casque');
      var peaux = {}, hauts = {};
      for (var j = 0; j < 30; j++) { var h = AP.variante('villager', 'pnj' + j, 'habitant'); peaux[h.peau] = 1; hauts[h.haut] = 1; }
      A.gt(Object.keys(peaux).length, 2, 'des habitants de toutes carnations');
      A.gt(Object.keys(hauts).length, 2, 'des vêtements variés');
      A.equal(AP.graineDe('Alice'), AP.graineDe('Alice'));
      A.ok(AP.variante('joueur', 'Alice').haut !== undefined, 'un avatar de joueur a sa tenue');
      A.equal(AP.teinter(0x808080, 0), 0x808080);
      A.gt(AP.teinter(0x808080, 0.5) & 255, 0x80, 'éclaircir');
      // allures
      A.equal(AP.allure(0, 2, false), 'repos');
      A.equal(AP.allure(1, 2.6, false), 'marche');
      A.equal(AP.allure(2.5, 2.6, false), 'course');
      A.equal(AP.allure(2.5, 2.6, true), 'nage');
      var ph = AP.avancerPhase(0, 2, 0.1);
      A.gt(ph, 0, 'le pas avance avec la vitesse');
      A.equal(AP.avancerPhase(1, 0, 0.1), 1, 'à l arrêt, le pas s arrête');
      // poses
      var repos = AP.pose({ allure: 'repos', phase: 1 });
      A.equal(repos.jambeG, 0); A.equal(repos.brasD, 0);
      var marche = AP.pose({ allure: 'marche', phase: Math.PI / 2 }), course = AP.pose({ allure: 'course', phase: Math.PI / 2 });
      A.ok(marche.jambeG > 0 && marche.jambeD < 0, 'les jambes alternent');
      A.gt(course.jambeG, marche.jambeG, 'on court à grandes enjambées');
      A.gt(course.buste, 0, 'le buste se penche en courant');
      var nage = AP.pose({ allure: 'nage', phase: 0 });
      A.lt(nage.brasG, -1.5, 'en nageant, les bras vont devant');
      A.gt(nage.buste, 0.8, 'le corps s allonge');
      var leve = AP.pose({ allure: 'repos', attaque: 0.4 }), abattu = AP.pose({ allure: 'repos', attaque: 1 });
      A.lt(leve.brasD, -2, 'le bras se lève');
      A.gt(abattu.brasD, leve.brasD + 2, 'puis s abat');
      // regard vers la cible, relatif au corps et borné
      var r = AP.regard({ x: 0, y: 0, z: 0 }, 0, 1.6, { x: 0, y: 1.6, z: -5 });
      A.close(r.lacet, 0, 1e-9, 'droit devant');
      var r2 = AP.regard({ x: 0, y: 0, z: 0 }, 0, 1.6, { x: -5, y: 1.6, z: 0 });
      A.close(r2.lacet, Math.PI / 2, 1e-9, 'à gauche');
      A.equal(AP.regard({ x: 0, y: 0, z: 0 }, 0, 1.6, { x: 100, y: 0, z: 0 }), null, 'trop loin : pas de regard');
      var p = AP.pose({ allure: 'repos', regard: { lacet: 3, tangage: -2 } });
      A.equal(p.tete.lacet, 1.2); A.equal(p.tete.tangage, -0.7);
      // niveau de détail
      A.equal(AP.niveauDetail(10), 'complet');
      A.equal(AP.niveauDetail(80), 'simple');
      A.equal(AP.niveauDetail(400), 'cache');
      A.ok(AP.METIERS.forgeron && AP.DETAIL.complet < AP.DETAIL.simple);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
