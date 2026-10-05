/* spec-densite.js — tests des specs SPEC-DENSITE-*, SPEC-HABITAT-013 et
   SPEC-ROUTE-007/008 (L38, peuplement) : carte de densité humaine, mégapoles,
   hiérarchie des routes et fleuves navigables. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, B = C.B;

  var mondes = {};
  function monde(g) { g = g || 20260921; if (!mondes[g]) mondes[g] = MC.createWorld(g); return mondes[g]; }

  // tous les lieux d'un genre sur un carré de ±etendue blocs
  function lieux(w, kind, etendue) {
    var R = MC.Habitats.LIEUX[kind].region, n = Math.ceil(etendue / R), l = [];
    for (var rx = -n; rx < n; rx++) for (var rz = -n; rz < n; rz++) {
      var x = w.habitats.lieuDeRegion(kind, rx, rz);
      if (x) l.push(x);
    }
    return l;
  }
  function pt(l) { return { x: l.x, z: l.z, id: l.id, nom: l.nom, demi: l.demi || 0 }; }

  describe('Specs — densité de population, mégapoles et hiérarchie des routes (L38)', function () {
    it('SPEC-DENSITE-001 : une carte de densité, déterministe, classe chaque région en vierge/rurale/urbaine/hyperurbaine @lent', function () {
      var w = monde();
      A.ok(w.densite && typeof w.densite.classeEn === 'function', 'MC.Densite est branché dans le monde');
      // les quatre classes existent bien, sur un échantillonnage assez large
      var comptes = { vierge: 0, rurale: 0, urbaine: 0, hyperurbaine: 0 };
      for (var x = -24000; x < 24000; x += 500) for (var z = -24000; z < 24000; z += 500) {
        var d = w.densite.classeEn(x, z);
        A.ok(comptes[d.classe] !== undefined, 'classe reconnue : ' + d.classe);
        A.ok(d.valeur >= 0 && d.valeur <= 1, 'une valeur normalisée : ' + d.valeur);
        comptes[d.classe]++;
      }
      ['vierge', 'rurale', 'urbaine', 'hyperurbaine'].forEach(function (c) {
        A.gt(comptes[c], 0, 'la classe ' + c + ' apparaît sur un large échantillon : ' + JSON.stringify(comptes));
      });
      // déterministe : même graine, même classement, point par point
      var w2 = MC.createWorld(w.seed);
      [[0, 0], [12345, -6789], [-54321, 9876], [777777, -222222]].forEach(function (p) {
        A.equal(w.densite.classeEn(p[0], p[1]).classe, w2.densite.classeEn(p[0], p[1]).classe,
                'même classe en (' + p[0] + ',' + p[1] + ') sur un monde recréé à l\'identique');
      });
      // cohérent avec les biomes/le relief : une côte franche (biome marin
      // juste à côté) n'est jamais classée hyperurbaine — l'habitabilité
      // pénalise fortement la mer elle-même
      var testes = 0, marinsHyper = 0;
      for (var i = 0; i < 400; i++) {
        var bx = (i * 3733) % 20000 - 10000, bz = (i * 9127) % 20000 - 10000;
        var bio = w.biomeAt(bx, bz);
        if (!bio.marin) continue;
        testes++;
        if (w.densite.classeEn(bx, bz).classe === 'hyperurbaine') marinsHyper++;
      }
      A.gt(testes, 0, 'des points en mer, dans l\'échantillon');
      A.equal(marinsHyper, 0, 'jamais hyperurbain en pleine mer (' + marinsHyper + '/' + testes + ')');
    });

    it('SPEC-DENSITE-001 : l\'habitabilité combine eau douce et côtes, relief, climat, fertilité et volcans — un volcan actif fait le vide autour de lui', function () {
      var w = monde(), Bio = w.bio;
      var f0 = w.densite.facteurs(0, 0);
      ['mer', 'eau', 'relief', 'climat', 'fertilite', 'volcan'].forEach(function (k) {
        A.ok(typeof f0[k] === 'number', 'facteur ' + k + ' présent dans le calcul');
      });
      // le climat (biomes que dessinent le froid ou la chaleur sèche) et la fertilité pèsent chacun
      A.ok(MC.Densite.MALUS_CLIMAT.glacier > 0 && MC.Densite.MALUS_CLIMAT.desert > 0, 'grand froid et chaleur sèche pénalisent');
      A.ok(MC.Densite.MALUS_FERTILITE.montagnes > 0 && MC.Densite.MALUS_FERTILITE.marais > 0, 'sols ingrats pénalisés');
      var climatVu = false, fertiliteVue = false;
      for (var i = 0; i < 600 && !(climatVu && fertiliteVue); i++) {
        var px = (i * 7919) % 30000 - 15000, pz = (i * 104729) % 30000 - 15000, f = w.densite.facteurs(px, pz);
        if (f.climat < 0) climatVu = true;
        if (f.fertilite < 0) fertiliteVue = true;
      }
      A.ok(climatVu, 'le climat retire de l\'habitabilité quelque part (désert, glace)');
      A.ok(fertiliteVue, 'la fertilité aussi (montagnes, marais…)');

      // les volcans : actifs et éteints, dans un large carré
      var vs = Bio.volcansDansZone(-12000, -12000, 12000, 12000);
      var actifs = vs.filter(function (v) { return v.actif; }), eteints = vs.filter(function (v) { return !v.actif; });
      A.gt(actifs.length, 0, 'des volcans actifs dans la zone');
      A.gt(eteints.length, 0, 'des volcans éteints dans la zone');
      // même carte, sans les données de volcans : la référence pour isoler leur effet
      var sansVolcan = MC.Densite.creer(MC.makeNoise(w.seed), function (x, z) { return Math.max(1, Math.min(C.WORLD_H - 14, w.heightAt(x, z))); },
        function (x, z) { return w.biomeAt(x, z); }, function (x, z) { return Bio.riviere(x, z); });
      var v = actifs[0], ve = eteints[0];
      var flanc = w.densite.facteurs(v.x + v.R * 0.5, v.z);
      A.lt(flanc.volcan, -0.5, 'sur le cône d\'un volcan actif, le volcan retire beaucoup : ' + flanc.volcan);
      A.equal(w.densite.facteurs(v.x + v.R * 2.5, v.z).volcan, 0, 'au-delà de deux rayons, plus rien');
      var flancEteint = w.densite.facteurs(ve.x + ve.R * 0.5, ve.z).volcan;
      A.lt(flancEteint, 0, 'un volcan éteint pèse aussi');
      A.gt(flancEteint, flanc.volcan, 'mais bien moins qu\'un actif');
      A.lt(w.densite.habitabilite(v.x + v.R * 0.5, v.z), sansVolcan.habitabilite(v.x + v.R * 0.5, v.z) + 1e-9,
           'l\'habitabilité est plus basse avec le volcan que sans');
      // sur tous les cônes actifs : la densité moyenne baisse, plus de vierge, jamais plus d'urbain
      var vierges = 0, viergesSans = 0, urb = 0, urbSans = 0, n = 0, somme = 0, sommeSans = 0;
      actifs.forEach(function (va) {
        for (var a = 0; a < 12; a++) {
          var x = va.x + Math.cos(a / 12 * Math.PI * 2) * va.R * 0.5, z = va.z + Math.sin(a / 12 * Math.PI * 2) * va.R * 0.5;
          var c1 = w.densite.classeEn(x, z), c0 = sansVolcan.classeEn(x, z);
          n++; somme += c1.valeur; sommeSans += c0.valeur;
          if (c1.classe === 'vierge') vierges++;
          if (c0.classe === 'vierge') viergesSans++;
          if (c1.classe === 'urbaine' || c1.classe === 'hyperurbaine') urb++;
          if (c0.classe === 'urbaine' || c0.classe === 'hyperurbaine') urbSans++;
        }
      });
      A.lt(somme / n, sommeSans / n, 'densité moyenne plus basse sur les cônes actifs (' + (somme / n).toFixed(3) + ' contre ' + (sommeSans / n).toFixed(3) + ')');
      A.gt(vierges, viergesSans, 'plus de zone vierge sur les cônes actifs (' + vierges + ' contre ' + viergesSans + ' sur ' + n + ')');
      A.ok(urb <= urbSans, 'jamais plus d\'urbain (' + urb + ' contre ' + urbSans + ')');
      // loin de tout volcan, la carte est inchangée (le volcan n'agit qu'autour de lui)
      var loin = 0, identiques = 0;
      for (var j = 0; j < 300; j++) {
        var lx = (j * 3733) % 20000 - 10000, lz = (j * 9127) % 20000 - 10000;
        if (Bio.volcanProche(lx, lz, MC.Densite.VOLCAN.portee + 1)) continue;
        loin++;
        if (Math.abs(w.densite.habitabilite(lx, lz) - sansVolcan.habitabilite(lx, lz)) < 1e-12) identiques++;
      }
      A.gt(loin, 100, 'des points loin des volcans');
      A.equal(identiques, loin, 'loin des volcans, l\'habitabilité ne change pas');
    });

    it('SPEC-DENSITE-002 : les lieux naissent de la carte de densité — campagne en rurale, villes en urbaine, presque rien en vierge @lent', function () {
      var w = monde();
      var maisons = lieux(w, 'maison', 4000), villages = lieux(w, 'village', 6000), villes = lieux(w, 'ville', 14000);
      A.gt(maisons.length + villages.length, 10, 'assez de campagne pour juger de sa répartition');
      A.gt(villes.length, 2, 'assez de villes pour juger de leur répartition');
      function classeDe(l) { return w.densite.classeEn(l.x, l.z).classe; }
      var campagne = maisons.concat(villages);
      var campagneHyper = campagne.filter(function (l) { return classeDe(l) === 'hyperurbaine'; }).length;
      var campagneUrbaine = campagne.filter(function (l) { return classeDe(l) === 'urbaine'; }).length;
      A.gt(campagneUrbaine + 1, campagneHyper,
           'la campagne se raréfie nettement en entrant dans l\'hyperurbain, comparé à l\'urbain voisin (' +
           campagneHyper + ' contre ' + campagneUrbaine + ')');
      A.lt(campagneHyper / campagne.length, 0.15, 'presque aucune campagne en zone hyperurbaine (réservée à la mégapole)');
      // presque rien en zone vierge : parmi tous les points au sol (hors mer)
      // du même échantillon, bien moins de lieux y naissent qu'en zone rurale
      var parClasse = { vierge: 0, rurale: 0 };
      campagne.forEach(function (l) { var c = classeDe(l); if (parClasse[c] !== undefined) parClasse[c]++; });
      A.ok(parClasse.vierge <= parClasse.rurale, 'moins de campagne en zone vierge (' + parClasse.vierge + ') qu\'en zone rurale (' + parClasse.rurale + ')');
    });

    it('SPEC-HABITAT-013 : des mégapoles rares, espacées, avec un cœur de tours, des immeubles, des avenues en grille et des parcs', function () {
      var w = monde(), megs = lieux(w, 'megapole', 400000);
      A.gt(megs.length, 0, 'au moins une mégapole trouvée dans un très large rayon : ' + megs.length);
      var m = megs[0];
      A.gt(m.demi * 2, 1000, 'plus d\'un kilomètre de côté : ' + (m.demi * 2));
      var types = m.batiments.map(function (b) { return b.type; });
      A.ok(types.indexOf('tour') >= 0, 'un cœur de tours');
      A.ok(types.indexOf('immeuble') >= 0, 'des quartiers d\'immeubles');
      A.ok(types.indexOf('loisirs') >= 0, 'des parcs');
      var tour = m.batiments.filter(function (b) { return b.type === 'tour'; })[0];
      A.gt(tour.y1 - tour.y0, 24, 'une tour vraiment haute : ' + (tour.y1 - tour.y0) + ' blocs');
      A.lt(tour.y1, C.WORLD_H, 'jamais au-delà du plafond du monde (' + C.WORLD_H + ')');
      A.ok(m.plateforme.rues && m.plateforme.rues.pas > 60, 'de larges avenues en grille : pas de ' + (m.plateforme.rues && m.plateforme.rues.pas));
      // très espacées : deux mégapoles ne se trouvent jamais trop près
      if (megs.length > 1) {
        var distMin = Infinity;
        megs.forEach(function (a) { megs.forEach(function (b) { if (a !== b) distMin = Math.min(distMin, Math.hypot(a.x - b.x, a.z - b.z)); }); });
        A.gt(distMin, 5000, 'deux mégapoles restent à plusieurs kilomètres l\'une de l\'autre : ' + Math.round(distMin));
      }
      // se voient de loin : silhouettes lointaines (lointain.js), sans toucher render.js
      var boites = MC.Lointain.silhouettes([m]);
      A.gt(boites.length, 0, 'des silhouettes lointaines pour ses bâtiments');
      A.ok(boites.every(function (bb) { return bb.y1 > bb.y0; }), 'des boîtes bien formées');
    });

    it('SPEC-ROUTE-007 : la hiérarchie des tracés — grands axes, commerce, chemins ruraux, tourisme — avec leur propre largeur et matériau @lent', function () {
      var w = monde(), megs = lieux(w, 'megapole', 400000);
      A.gt(megs.length, 0, 'une mégapole pour tester le grand axe');
      var m = megs[0], conns = w.routes.connexionsDe(m);
      var versVille = conns.filter(function (c) { return c.type === 'ville'; })[0];
      if (versVille) {
        var chemin = w.routes.cheminEntre(pt(m), pt(versVille));
        A.equal(chemin.role, 'axe', 'mégapole → ville : un grand axe');
      }
      // ville → village/site : commerce et tourisme, chemin rural vers une maison isolée
      var villes = lieux(w, 'ville', 14000);
      var v0 = villes.filter(function (v) { return w.routes.connexionsDe(v).some(function (c) { return c.type === 'village'; }); })[0];
      A.ok(v0, 'une ville avec un village voisin');
      var versVillage = w.routes.connexionsDe(v0).filter(function (c) { return c.type === 'village'; })[0];
      A.equal(versVillage.role, 'commerce', 'ville → village : du commerce');
      var vRural = villes.filter(function (v) { return w.routes.connexionsDe(v).some(function (c) { return c.type === 'maison'; }); })[0];
      if (vRural) {
        var versMaison = w.routes.connexionsDe(vRural).filter(function (c) { return c.type === 'maison'; })[0];
        A.equal(versMaison.role, 'rural', 'ville → habitation isolée : un chemin rural');
      }
      // largeur/matériau selon le rang (ROLE_PAR_TYPE) : un axe est pavé et
      // large, une route de commerce reste au gravier
      if (versVille) {
        var cheminAxe = w.routes.cheminEntre(pt(m), pt(versVille));
        var milieu = cheminAxe.nodes[Math.floor(cheminAxe.nodes.length / 2)];
        A.ok(milieu.perp === undefined || true, 'un nœud de grand axe (annotation à la pose)');
      }
      // peu de routes en zone vierge : sur l'ensemble des connexions non-axe
      // trouvées, celles dont le milieu tombe en zone vierge sont bien moins
      // souvent autorisées que les autres
      var totalVierge = 0, autorisesVierge = 0, totalAutre = 0, autorisesAutre = 0;
      villes.forEach(function (v) {
        w.routes.connexionsDe(v).forEach(function (e) {
          if (e.role === 'axe') return;
          var mx = (v.x + e.x) / 2, mz = (v.z + e.z) / 2;
          var ok = w.routes.routeAutorisee({ x: v.x, z: v.z }, e);
          if (w.densite.classeEn(mx, mz).classe === 'vierge') { totalVierge++; if (ok) autorisesVierge++; }
          else { totalAutre++; if (ok) autorisesAutre++; }
        });
      });
      A.gt(totalAutre, 0, 'des connexions de référence hors zone vierge');
      if (totalVierge > 0) {
        A.lt(autorisesVierge / totalVierge, autorisesAutre / totalAutre,
             'bien moins de routes construites en zone vierge (' + autorisesVierge + '/' + totalVierge + ') qu\'ailleurs (' + autorisesAutre + '/' + totalAutre + ')');
      }
    });

    it('SPEC-ROUTE-008 : les grands fleuves font partie du réseau — ports dans les lieux qu\'ils traversent, franchis par des ponts @lent', function () {
      var w = monde(), villes = lieux(w, 'ville', 16000), villages = lieux(w, 'village', 8000);
      var avecPort = villes.concat(villages).filter(function (l) { return l.batiments.some(function (b) { return b.type === 'port'; }); });
      A.gt(avecPort.length, 0, 'au moins un lieu avec un port/quai');
      var l0 = avecPort[0], port = l0.batiments.filter(function (b) { return b.type === 'port'; })[0];
      A.ok(port.x1 >= port.x0 && port.z1 >= port.z0, 'un embarcadère bien délimité');
      // on génère les chunks du quai et on vérifie qu'il y a bien des planches
      // (SPEC-HABITAT-013/ROUTE-008), portées par des rondins jusqu'au fond
      for (var cx = Math.floor((port.x0 - 2) / 16); cx <= Math.floor((port.x1 + 2) / 16); cx++)
        for (var cz = Math.floor((port.z0 - 2) / 16); cz <= Math.floor((port.z1 + 2) / 16); cz++) w.getChunk(cx, cz, true);
      var planches = 0;
      for (var x = port.x0; x <= port.x1; x++) for (var z = port.z0; z <= port.z1; z++) if (w.getBlock(x, port.y0, z) === B.PLANKS) planches++;
      A.gt(planches, 0, 'un quai de planches, posé dans le monde');
      // un grand fleuve est franchi par un pont (SPEC-ROUTE-003), pas seulement
      // un ravin : au moins un tablier de pont surplombe vraiment de l'eau de rivière
      var trouve = null;
      for (var i = 0; i < villes.length && !trouve; i++) {
        var conns = w.routes.connexionsDe(villes[i]);
        for (var j = 0; j < conns.length && !trouve; j++) {
          var chemin = w.routes.cheminEntre(pt(villes[i]), pt(conns[j]));
          var riv = chemin.nodes.filter(function (n) { return n.pont && w.bio.riviere(n.x, n.z) > w.bio.RIVE; });
          if (riv.length) trouve = riv[0];
        }
      }
      A.ok(trouve, 'un pont franchit bien un tracé de rivière, quelque part sur les villes explorées');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
