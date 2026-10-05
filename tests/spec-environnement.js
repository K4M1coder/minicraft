/* spec-environnement.js — SPEC-ENV-001/002/004/005 et SPEC-QUETE-003 : les
   catastrophes environnementales (tornade, cyclone, éruption) qui touchent
   les lieux habités, les routes et les donjons — logique pure. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var flatWorld = G.flatWorld, seededRand = G.seededRand;
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

      // lieu synthétique minuscule (1 à 3 habitants, comme une habitation
      // isolée réelle — LIEUX.maison, lots: 1) : un plancher à 1 migrant
      // dépasserait très largement 30 % (100 % pour 1 habitant, 33 % pour
      // 3) — sans plancher, aucune migration ne doit jamais dépasser 30 %.
      function lieuMinuscule(n) {
        var pnjs = [];
        for (var i = 0; i < n; i++) pnjs.push({ id: 'test:' + n + ':' + i, role: 'habitant', lieu: 'test:src:' + n });
        return { id: 'test:src:' + n, pnjs: pnjs };
      }
      [1, 2, 3].forEach(function (n) {
        var minuscule = lieuMinuscule(n);
        var voisin = { id: 'test:dest:' + n, pnjs: [] };
        var r2 = H.migrerPopulation(minuscule, voisin, 1.0, 7);   // gravité max : le cas le plus favorable à un dépassement
        A.ok(r2.migres === 0 || r2.migres / n <= H.MIGRATION_MAX + 1e-9,
             'lieu de ' + n + ' habitant(s) : aucune migration, ou fraction réelle ≤ 30 % (migres=' + r2.migres + ')');
        A.equal(minuscule.pnjs.length, n - r2.migres, 'la population source ne perd que ce qui a été compté');
      });
      // 1 seul habitant : floor(1 × 30 %) = 0 — personne ne migre plutôt
      // que d'en perdre la totalité (100 %, l'ancien comportement à plancher).
      var unSeul = lieuMinuscule(1);
      var rUnSeul = H.migrerPopulation(unSeul, { id: 'test:dest:1b', pnjs: [] }, 1.0, 7);
      A.equal(rUnSeul.migres, 0, 'floor(1 × 30 %) = 0 : personne ne migre plutôt que de dépasser largement la borne');
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

    /* SPEC-ENV-005 : l'heure (en secondes du monde) d'une éruption en cours d'un volcan, ou -1. */
    function heureEnEruption(v, graine) {
      for (var k = 0; k < 200; k++) {
        var e = Vol.eruptionDe(v, k * Vol.FENETRE, graine);
        if (e) return (e.debut + e.fin) / 2;
      }
      return -1;
    }
    function horsEruption(v, graine) {
      for (var t = 0; t < 40 * Vol.FENETRE; t += 100) if (!Vol.activite(v, t, graine).eruption) return t;
      return -1;
    }

    it('SPEC-ENV-005 : une éruption en cours près d\'un donjon multiplie par 1,5 à 2 les renforts de son gardien, décroissant avec la distance, rien hors éruption ni hors rayon', function () {
      var graine = 7, v = { x: 1000, z: -500, actif: true };
      var t = heureEnEruption(v, graine);
      A.ok(t >= 0, 'une éruption existe pour ce volcan');
      var R5 = Vol.RAYON_RENFORTS;
      var m0 = Vol.multiplicateurRenforts([v], { x: v.x, z: v.z }, t, graine);
      var mMi = Vol.multiplicateurRenforts([v], { x: v.x + R5 / 2, z: v.z }, t, graine);
      var mBord = Vol.multiplicateurRenforts([v], { x: v.x, z: v.z + R5 }, t, graine);
      A.close(m0, 2, 1e-9, 'au pied du cratère : ×2');
      A.close(mMi, 1.75, 1e-9, 'à mi-rayon : ×1,75');
      A.close(mBord, 1.5, 1e-9, 'en bordure de rayon : ×1,5');
      A.equal(Vol.multiplicateurRenforts([v], { x: v.x + R5 + 1, z: v.z }, t, graine), 1, 'hors du rayon : inchangé');
      var th = horsEruption(v, graine);
      A.ok(th >= 0, 'un moment sans éruption');
      A.equal(Vol.multiplicateurRenforts([v], { x: v.x, z: v.z }, th, graine), 1, 'hors éruption : inchangé');
      A.equal(Vol.multiplicateurRenforts([{ x: v.x, z: v.z, actif: false }], { x: v.x, z: v.z }, t, graine), 1, 'un volcan éteint ne change rien');
      A.ok(Vol.multiplicateurRenforts([v, { x: v.x, z: v.z, actif: true }], { x: v.x, z: v.z }, t, graine) <= 2 + 1e-9,
           'plusieurs volcans ne se cumulent pas : jamais au-delà de ×2');
      for (var d = 0; d <= R5; d += 37) {
        var m = Vol.multiplicateurRenforts([v], { x: v.x + d, z: v.z }, t, graine);
        A.ok(m >= 1.5 - 1e-9 && m <= 2 + 1e-9, 'dans le rayon, toujours entre 1,5 et 2 (' + m + ' à ' + d + ')');
      }
      A.equal(Vol.multiplicateurRenforts([], { x: 0, z: 0 }, t, graine), 1, 'sans volcan : inchangé');
    });

    it('SPEC-ENV-005 : sur un vrai monde, un donjon proche d\'un volcan en éruption reçoit le facteur, le même donjon hors éruption non', function () {
      var trouve = null;
      for (var graine = 1; graine <= 60 && !trouve; graine++) {
        var w = MC.createWorld(graine);
        for (var rx = -4; rx <= 4 && !trouve; rx++) for (var rz = -4; rz <= 4 && !trouve; rz++) {
          var v = w.bio.volcanDe(rx, rz);
          if (!v || !v.actif) continue;
          var R5 = Vol.RAYON_RENFORTS;
          var ds = w.donjons.dansZone(v.x - R5 + 50, v.z - R5 + 50, v.x + R5 - 50, v.z + R5 - 50)
            .filter(function (d) { return Math.hypot(d.x - v.x, d.z - v.z) <= R5 - 50; });
          if (ds.length) trouve = { w: w, v: v, d: ds[0], graine: graine };
        }
      }
      A.ok(trouve, 'un donjon à moins de 550 blocs d\'un volcan actif existe dans l\'un des 60 mondes');
      var t = heureEnEruption(trouve.v, trouve.graine), th = horsEruption(trouve.v, trouve.graine);
      var m = Vol.multiplicateurRenfortsDonjon(trouve.w.bio, trouve.d, t, trouve.graine);
      A.ok(m >= 1.5 && m <= 2, 'pendant l\'éruption : ×' + m.toFixed(2) + ' pour ' + trouve.d.id);
      A.equal(Vol.multiplicateurRenfortsDonjon(trouve.w.bio, trouve.d, th, trouve.graine), 1, 'hors éruption : ×1');
      A.equal(Vol.multiplicateurRenfortsDonjon(null, trouve.d, t, trouve.graine), 1, 'sans monde : ×1');
    });

    it('SPEC-ENV-005 : un gardien dont le donjon est près d\'une éruption appelle ses renforts 1,5 à 2 fois plus souvent, sans jamais dépasser son plafond', function () {
      var B = MC.Core.B, DUREE = 1800, dt = 1 / 10;
      var joueur = { pos: { x: 12.5, y: 11, z: 0.5 } };
      /* Même exploration simulée (le joueur ne bouge pas, les renforts sont abattus dès leur apparition
         pour que le plafond n'intervienne pas dans le comptage) avec un facteur de renforts donné. */
      function compter(mult, abattre) {
        var ents = MC.createEntities(flatWorld(10, B.STONE));
        var g = ents.spawn('boss_zombie', 0.5, 11, 0.5, { donjon: '3,4' });
        g.onGround = true;
        var inv = 0, maxVus = 0;
        for (var i = 0; i < DUREE / dt; i++) {
          var ev = ents.update(dt, joueur, { rand: seededRand(i), multRenforts: mult === null ? undefined : function (id) { return id === '3,4' ? mult : 1; } });
          inv += ev.invocations || 0;
          maxVus = Math.max(maxVus, ents.sbires(g));
          if (abattre) ents.list.filter(function (e) { return e.maitre === g.eid; }).forEach(function (e) { ents.remove(e); });
          g.hp = 1e9;                     // le gardien tient pendant toute la mesure
          g.pos.x = 0.5; g.pos.z = 0.5;
        }
        return { inv: inv, maxVus: maxVus };
      }
      var base = compter(null, true), x15 = compter(1.5, true), x2 = compter(2, true), tel = compter(1, true);
      A.ok(base.inv >= 100, 'sans éruption, le gardien appelle régulièrement des renforts (' + base.inv + ')');
      A.equal(tel.inv, base.inv, 'un facteur de 1 ne change rien');
      var r15 = x15.inv / base.inv, r2 = x2.inv / base.inv;
      A.ok(r15 >= 1.45 && r15 <= 1.55, 'facteur 1,5 : ' + x15.inv + ' appels contre ' + base.inv + ' (×' + r15.toFixed(2) + ')');
      A.ok(r2 >= 1.9 && r2 <= 2.1, 'facteur 2 : ' + x2.inv + ' appels contre ' + base.inv + ' (×' + r2.toFixed(2) + ')');
      // le plafond de sbires vivants reste appliqué, éruption ou non
      var plafond = MC.EntitySpecs.boss_zombie.invoque.max;
      var libre = compter(2, false);
      A.ok(libre.maxVus <= plafond, 'sans abattre les renforts, jamais plus de ' + plafond + ' sbires vivants (' + libre.maxVus + ')');
      A.equal(libre.maxVus, plafond, 'et le plafond est atteint');
      // un facteur absurde (NaN, négatif, < 1) est ignoré
      A.equal(compter(NaN, true).inv, base.inv, 'un facteur NaN est ignoré');
      A.equal(compter(0.2, true).inv, base.inv, 'un facteur < 1 est ignoré');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
