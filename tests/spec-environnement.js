/* spec-environnement.js — SPEC-ENV-001/002/004/005 et SPEC-QUETE-003 : les
   catastrophes environnementales (tornade, cyclone, éruption) qui touchent
   les lieux habités, les routes et les donjons — logique pure. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var H = MC.Habitats, R = MC.Routes, Vol = MC.Volcanisme, Dj = MC.Donjons, P = MC.Politique;

  function unVillage(w) {
    for (var r = 0; r < 12; r++) for (var rx = -r; rx <= r; rx++) for (var rz = -r; rz <= r; rz++) {
      var v = w.habitats.lieuDeRegion('village', rx, rz);
      if (v && v.blocs.size > 0) return v;
    }
    return null;
  }
  function totalBlocs(l) {
    var n = 0; l.blocs.forEach(function (a) { n += a.length / 5; });
    return n;
  }
  function pleinsRestants(l) {
    var n = 0; l.blocs.forEach(function (a) { for (var i = 0; i < a.length; i += 5) if (a[i + 3]) n++; });
    return n;
  }

  describe('Specs — environnement (catastrophes)', function () {
    it('SPEC-ENV-001 : une tornade qui traverse un lieu endommage 5 à 20 % de ses bâtiments, localisés au tracé', function () {
      var w = MC.createWorld(31), v = unVillage(w);
      A.ok(v, 'un village');
      var totalAvant = totalBlocs(v), pleinsAvant = pleinsRestants(v);
      // un tracé qui balaie tout le lieu (rayon large) : la fraction plafonne à 20 %
      var trace = [{ x: v.x, z: v.z, rayon: v.demi * 3, force: 1 }];
      var entry = H.endommagerLieu(v, trace, 42, 1000, 'tornade');
      A.ok(entry, 'un journal renvoyé');
      A.equal(entry.lieu, v.id);
      A.equal(entry.heure, 1000);
      A.ok(entry.ampleur >= H.FRACTION_DEGATS_MIN - 1e-9 && entry.ampleur <= H.FRACTION_DEGATS_MAX + 1e-9,
           'ampleur dans 5 à 20 % : ' + entry.ampleur);
      A.equal(pleinsAvant - pleinsRestants(v), entry.blocs, 'exactement les blocs comptés ont été retirés');
      A.gt(entry.blocs, 0, 'des dégâts réels');

      // un tracé qui ne passe PAS par le lieu (loin) : aucun dégât
      var w2 = MC.createWorld(31), v2 = unVillage(w2);
      var loin = [{ x: v2.x + 100000, z: v2.z + 100000, rayon: 5, force: 1 }];
      var entry2 = H.endommagerLieu(v2, loin, 42, 1000, 'tornade');
      A.equal(entry2.blocs, 0, 'hors du tracé réel : aucun dégât');

      // lieu synthétique minuscule (moins de 20 blocs) : un plancher à 1 bloc
      // dépasserait très largement 20 % — soit rien n'est endommagé, soit
      // l'ampleur réelle reste bien dans [5 %, 20 %] (revue adversariale)
      var minuscule = { id: 'test:minuscule', blocs: new Map([['0,0', [
        0, 60, 0, 1, 0,   1, 60, 0, 1, 0,   2, 60, 0, 1, 0,   3, 60, 0, 1, 0,
        0, 60, 1, 1, 0,   1, 60, 1, 1, 0,   2, 60, 1, 1, 0,   3, 60, 1, 1, 0,
      ]]]) };   // 8 blocs pleins
      var traceMinuscule = [{ x: 1, z: 0, rayon: 3, force: 1 }];
      var entryMin = H.endommagerLieu(minuscule, traceMinuscule, 5, 1, 'tornade');
      A.ok(entryMin.blocs === 0 || (entryMin.ampleur >= H.FRACTION_DEGATS_MIN - 1e-9 && entryMin.ampleur <= H.FRACTION_DEGATS_MAX + 1e-9),
           'lieu minuscule : rien n\'est endommagé, ou l\'ampleur réelle reste dans 5-20 % : blocs=' + entryMin.blocs + ' ampleur=' + entryMin.ampleur);
      // un lieu de 3 blocs : floor(3 * 20 %) = floor(0.6) = 0 — SANS plancher
      // à 1, aucun dégât n'est appliqué (avec l'ancien Math.max(1, …), un
      // bloc aurait été retiré, soit 33 % du lieu — largement hors bornes).
      var infime = { id: 'test:infime', blocs: new Map([['0,0', [0, 60, 0, 1, 0, 1, 60, 0, 1, 0, 2, 60, 0, 1, 0]]]) };
      var entryInfime = H.endommagerLieu(infime, [{ x: 1, z: 0, rayon: 3, force: 1 }], 5, 1, 'tornade');
      A.equal(entryInfime.blocs, 0, 'floor(3 * 20 %) = 0 : aucun dégât plutôt que d\'en dépasser largement 20 %');

      // un tracé étroit ne touche qu'une petite fraction, strictement localisée
      var w3 = MC.createWorld(31), v3 = unVillage(w3);
      var etroit = [{ x: v3.x - v3.demi, z: v3.z - v3.demi, rayon: 3, force: 0 }];
      var entry3 = H.endommagerLieu(v3, etroit, 42, 1000, 'cyclone');
      A.ok(entry3.ampleur <= H.FRACTION_DEGATS_MAX + 1e-9, 'jamais plus de 20 % même sur un lieu entier');

      // déterminisme : même graine, mêmes dégâts
      var w4 = MC.createWorld(31), v4 = unVillage(w4);
      var trace4 = [{ x: v4.x, z: v4.z, rayon: v4.demi * 3, force: 1 }];
      var entry4 = H.endommagerLieu(v4, trace4, 42, 1000, 'tornade');
      A.equal(entry4.blocs, entry.blocs, 'même graine, même trajectoire : mêmes dégâts');
    });

    it('SPEC-QUETE-003 : une catastrophe qui endommage un lieu génère une quête limitée dans le temps, récompense proportionnée', function () {
      var w = MC.createWorld(31), v = unVillage(w);
      var trace = [{ x: v.x, z: v.z, rayon: v.demi * 3, force: 0.9 }];
      var entry = H.endommagerLieu(v, trace, 7, 500, 'eruption');
      var q = H.queteCatastrophe(v, entry);
      A.ok(q, 'une quête proposée');
      A.equal(q.lieu, v.id);
      A.ok(q.type === 'reconstruction' || q.type === 'secours');
      A.ok(H.queteActive(q, 500), 'active dès l\'apparition');
      A.ok(H.queteActive(q, q.expire - 1), 'encore active juste avant expiration');
      A.notOk(H.queteActive(q, q.expire), 'expirée après son délai');
      A.gt(q.recompense, 0, 'récompense positive');
      // plus de dégâts, plus de récompense
      var w2 = MC.createWorld(31), v2 = unVillage(w2);
      var entryPetit = H.endommagerLieu(v2, [{ x: v2.x, z: v2.z, rayon: 3, force: 0 }], 7, 500, 'tornade');
      var qPetit = H.queteCatastrophe(v2, entryPetit);
      if (qPetit && entryPetit.blocs < entry.blocs) A.gt(q.recompense, qPetit.recompense, 'dégâts corrélés à la récompense');
      // pas de dégât : pas de quête
      A.equal(H.queteCatastrophe(v, { blocs: 0, ampleur: 0, heure: 0 }), null, 'sans dégât, pas de quête');
    });

    it('SPEC-ENV-004 : une catastrophe qui détruit les cultures fait migrer 10 à 30 % de la population, proportionnellement à la gravité', function () {
      var w = MC.createWorld(31), src = unVillage(w);
      A.ok(src.pnjs.length >= 3, 'assez d\'habitants pour observer une migration');
      var w2 = MC.createWorld(31), dest = null;
      w2.habitats.lieuxProches(src.x, src.z, 3000).forEach(function (l) { if (!dest && l.id !== src.id && l.pnjs.length) dest = l; });
      A.ok(dest, 'un lieu de destination existe à proximité');
      var popSrcAvant = src.pnjs.length, popDestAvant = dest.pnjs.length;
      var r = H.migrerPopulation(src, dest, 0.5, 99);
      A.gt(r.migres, 0, 'au moins un migrant');
      var frac = r.migres / popSrcAvant;
      A.ok(frac >= H.MIGRATION_MIN - 1e-9 && frac <= H.MIGRATION_MAX + 1e-9, 'fraction migrée dans 10 à 30 % : ' + frac);
      A.equal(src.pnjs.length, popSrcAvant - r.migres, 'population source réduite d\'autant');
      A.equal(dest.pnjs.length, popDestAvant + r.migres, 'population destination augmentée d\'autant');
      dest.pnjs.slice(popDestAvant).forEach(function (p) { A.equal(p.lieu, dest.id, 'les migrants portent le nouveau lieu'); });
      // gravité plus forte : fraction plus grande
      var w3 = MC.createWorld(31), src3 = unVillage(w3);
      var w4 = MC.createWorld(31), dest3 = null;
      w4.habitats.lieuxProches(src3.x, src3.z, 3000).forEach(function (l) { if (!dest3 && l.id !== src3.id) dest3 = l; });
      var faible = H.migrerPopulation(unVillage(MC.createWorld(31)), dest3, 0.0, 99);
      var fort = H.migrerPopulation(src3, dest3, 1.0, 99);
      A.ok(fort.migres >= faible.migres, 'gravité maximale migre au moins autant que gravité minimale');
    });

    it('SPEC-ENV-002 : une éruption active près d\'une route la rend impraticable ; caravanes redirigées ou arrêtées, route reprise après l\'éruption', function () {
      var volcan = { x: 0, z: 0 };
      var cheminTouche = { a: { id: 'a', nom: 'A' }, b: { id: 'b', nom: 'B' }, role: 'commerce',
                            nodes: [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }] };
      var cheminLoin = { a: { id: 'a', nom: 'A' }, b: { id: 'b', nom: 'B' }, role: 'commerce',
                          nodes: [{ x: 5000, z: 5000 }, { x: 5010, z: 5000 }] };
      var enEruption = { eruption: { id: 'e1' } };
      var horsEruption = { eruption: null };
      A.notOk(R.routePraticable(cheminTouche, volcan, enEruption), 'impraticable pendant l\'éruption, à proximité');
      A.ok(R.routePraticable(cheminLoin, volcan, enEruption), 'praticable si trop loin du cratère');
      A.ok(R.routePraticable(cheminTouche, volcan, horsEruption), 'de nouveau praticable une fois l\'éruption terminée');

      // caravanes : trajetsDe-like array, une route de repli mène à la même destination
      var trajetTouche = { id: 'r:a>b', b: 'B', a: 'A', nodes: cheminTouche.nodes, role: 'commerce' };
      var trajetAlt = { id: 'r:a>b2', b: 'B', a: 'A', nodes: cheminLoin.nodes, role: 'commerce' };
      var res = R.trajetsAffectesParEruption([trajetTouche, trajetAlt], volcan, enEruption);
      var etatTouche = res.filter(function (r2) { return r2.trajet === trajetTouche || r2.original === trajetTouche; })[0];
      A.ok(etatTouche, 'le trajet touché apparaît dans le résultat');
      A.equal(etatTouche.etat, 'redirection', 'redirigé vers une alternative praticable');
      A.equal(etatTouche.trajet, trajetAlt, 'l\'alternative choisie mène à la même destination');

      // sans alternative : arrêtée
      var res2 = R.trajetsAffectesParEruption([trajetTouche], volcan, enEruption);
      A.equal(res2[0].etat, 'arret', 'sans alternative, la caravane est stoppée');

      // hors éruption : toujours praticable, aucune caravane affectée
      var res3 = R.trajetsAffectesParEruption([trajetTouche], volcan, horsEruption);
      A.equal(res3[0].etat, 'praticable');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
