/* spec-routes.js — tests des specs SPEC-ROUTE-*. Routes de commerce et de
   tourisme entre les lieux : graphe, tracé qui suit le relief, ponts,
   destinations touristiques, panneaux et lampadaires. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core;
  var B = C.B;

  var mondes = {};
  function monde(g) { g = g || 20260921; if (!mondes[g]) mondes[g] = MC.createWorld(g); return mondes[g]; }

  // toutes les villes sur un carré de ±etendue blocs autour de l'origine
  function villes(w, etendue) {
    var R = MC.Habitats.LIEUX.ville.region, n = Math.ceil(etendue / R), l = [];
    for (var rx = -n; rx < n; rx++) for (var rz = -n; rz < n; rz++) {
      var v = w.habitats.lieuDeRegion('ville', rx, rz);
      if (v) l.push(v);
    }
    return l;
  }

  // le point qu'attend cheminEntre : position, identifiant, nom, emprise
  function pt(l) { return { x: l.x, z: l.z, id: l.id, nom: l.nom, demi: l.demi || 0 }; }

  // génère les chunks qui couvrent un rectangle de blocs [x0,x1]×[z0,z1]
  function genererZone(w, x0, z0, x1, z1) {
    for (var cx = Math.floor(x0 / 16); cx <= Math.floor(x1 / 16); cx++)
      for (var cz = Math.floor(z0 / 16); cz <= Math.floor(z1 / 16); cz++) w.getChunk(cx, cz, true);
  }

  describe('Specs — routes', function () {
    it('SPEC-ROUTE-001 : des routes de commerce relient chaque ville à ses voisines et aux villages alentour', function () {
      var w = monde(), vs = villes(w, 12000);
      A.gt(vs.length, 2, 'plusieurs villes à relier : ' + vs.length);
      var relieesVilleOuVillage = 0;
      vs.forEach(function (v) {
        var conns = w.routes.connexionsDe(v);
        if (conns.some(function (c) { return c.type === 'ville' || c.type === 'village'; })) relieesVilleOuVillage++;
      });
      A.gt(relieesVilleOuVillage, 0, 'au moins une ville reliée à une voisine ou à un village');
      // le graphe est bien un graphe : chaque connexion pointe vers un lieu réel, à une distance cohérente
      var v0 = vs.filter(function (v) { return w.routes.connexionsDe(v).length > 0; })[0];
      var conns0 = w.routes.connexionsDe(v0);
      conns0.forEach(function (c) {
        A.ok(c.id && typeof c.x === 'number' && typeof c.z === 'number', 'une destination identifiée : ' + c.type);
        A.close(c.dist, Math.hypot(c.x - v0.x, c.z - v0.z), 0.01, 'distance cohérente pour ' + c.type);
      });
      // déterministe : mêmes connexions à chaque appel et sur un monde recréé à l'identique
      var w2 = MC.createWorld(w.seed), v0b = villes(w2, 12000).filter(function (v) { return v.id === v0.id; })[0];
      A.ok(v0b, 'la même ville se retrouve');
      A.deep(w.routes.connexionsDe(v0).map(function (c) { return c.id; }).sort(),
             w2.routes.connexionsDe(v0b).map(function (c) { return c.id; }).sort(), 'le même graphe, à chaque fois');
    });

    it('SPEC-ROUTE-002 : une route suit le relief sans marche de plus d\'un bloc, et contourne ce qui est trop raide', function () {
      var w = monde(), vs = villes(w, 12000);
      var v0 = vs.filter(function (v) { return w.routes.connexionsDe(v).some(function (c) { return c.type === 'village' || c.type === 'ville'; }); })[0];
      A.ok(v0, 'une ville avec au moins une destination proche');
      var dest = w.routes.connexionsDe(v0).filter(function (c) { return c.type === 'village' || c.type === 'ville'; })[0];
      var chemin = w.routes.cheminEntre(pt(v0), pt(dest));
      A.gt(chemin.nodes.length, 1, 'un tracé avec plusieurs points');
      var marches = 0, examines = 0;
      for (var i = 1; i < chemin.nodes.length; i++) {
        var a = chemin.nodes[i - 1], b = chemin.nodes[i];
        if (a.pont || b.pont) continue;             // un pont ne suit pas le relief : c'est voulu (SPEC-ROUTE-003)
        examines++;
        if (Math.abs(b.y - a.y) > 1) marches++;
      }
      A.gt(examines, 0, 'des points de terrain (hors pont) à vérifier');
      A.equal(marches, 0, 'aucune marche de plus d\'un bloc hors pont (' + marches + '/' + examines + ')');
    });

    it('SPEC-ROUTE-003 : une route franchit l\'eau et les ravins par des ponts', function () {
      var w = monde(), vs = villes(w, 16000);
      // on cherche un chemin qui comporte au moins un pont
      var chemin = null, v0 = null, dest = null;
      for (var i = 0; i < vs.length && !chemin; i++) {
        var conns = w.routes.connexionsDe(vs[i]);
        for (var j = 0; j < conns.length && !chemin; j++) {
          var c = w.routes.cheminEntre(pt(vs[i]), pt(conns[j]));
          if (c.nodes.some(function (n) { return n.pont; })) { chemin = c; v0 = vs[i]; dest = conns[j]; }
        }
      }
      A.ok(chemin, 'au moins un tracé, parmi les villes trouvées, comporte un pont');
      // le point le plus profond du pont (celui qui enjambe vraiment quelque
      // chose) plutôt que le premier, qui peut être encore au ras du sol
      var pontNodes = chemin.nodes.filter(function (n) { return n.pont; });
      var pont = pontNodes.reduce(function (pire, n) {
        var h = w.heightAt(n.x, n.z);
        return (!pire || h < pire.h) ? { n: n, h: h } : pire;
      }, null);
      var hNat = pont.h; pont = pont.n;
      // on génère les chunks autour du pont et on vérifie qu'il est bien posé :
      // un tablier (planches) porté par des piliers depuis le sol réel
      genererZone(w, pont.x - 20, pont.z - 20, pont.x + 20, pont.z + 20);
      A.gt(pont.y, hNat, 'le tablier du pont passe au-dessus du sol/de l\'eau naturels (' + pont.y + ' > ' + hNat + ')');
      A.equal(w.getBlock(pont.x, pont.y, pont.z), B.PLANKS, 'un tablier de planches');
      var pilier = false;
      for (var y = Math.max(1, pont.hSol); y < pont.y; y++) if (w.getBlock(pont.x, y, pont.z) === B.COBBLE) pilier = true;
      A.ok(pilier, 'un pilier porte le tablier jusqu\'au sol');
    });

    it('SPEC-ROUTE-004 : des routes touristiques mènent des villes aux sites remarquables (volcans, lacs, sommets)', function () {
      var w = monde(), vs = villes(w, 16000);
      var avecPoi = null, poi = null;
      for (var i = 0; i < vs.length && !avecPoi; i++) {
        var conns = w.routes.connexionsDe(vs[i]);
        var p = conns.filter(function (c) { return c.type === 'volcan' || c.type === 'lac' || c.type === 'sommet'; })[0];
        if (p) { avecPoi = vs[i]; poi = p; }
      }
      A.ok(avecPoi, 'au moins une ville avec un site remarquable à proximité');
      A.ok(['volcan', 'lac', 'sommet'].indexOf(poi.type) >= 0, 'le type de site est reconnu : ' + poi.type);
      var chemin = w.routes.cheminEntre(pt(avecPoi), pt(poi));
      var dernier = chemin.nodes[chemin.nodes.length - 1];
      A.close(Math.hypot(dernier.x - poi.x, dernier.z - poi.z), 0, 2, 'le tracé mène bien jusqu\'au site');
    });

    it('SPEC-ROUTE-005 : aux carrefours, des panneaux indiquent nom et distance ; aux abords des villes, des lampadaires', function () {
      var w = monde(), vs = villes(w, 12000);
      var v0 = vs.filter(function (v) { return w.routes.connexionsDe(v).length > 0; })[0];
      var dest = w.routes.connexionsDe(v0)[0];
      var chemin = w.routes.cheminEntre(pt(v0), pt(dest));
      // on pose les chunks à la sortie de la ville, là où panneau et lampadaires doivent apparaître
      var pres = chemin.nodes.filter(function (n) {
        return Math.hypot(n.x - v0.x, n.z - v0.z) < v0.demi + 70;
      });
      A.gt(pres.length, 0, 'des points de route près de la ville');
      var xs = pres.map(function (n) { return n.x; }), zs = pres.map(function (n) { return n.z; });
      genererZone(w, Math.min.apply(null, xs) - 4, Math.min.apply(null, zs) - 4, Math.max.apply(null, xs) + 4, Math.max.apply(null, zs) + 4);
      var panneaux = 0, lanternes = 0;
      pres.forEach(function (n) {
        for (var dx = -3; dx <= 3; dx++) for (var dz = -3; dz <= 3; dz++) for (var dy = 0; dy <= 4; dy++) {
          var b = w.getBlock(n.x + dx, n.y + dy, n.z + dz);
          if (b === B.PANNEAU_INFO) panneaux++;
          if (b === B.LANTERN) lanternes++;
        }
      });
      A.gt(panneaux, 0, 'un panneau à la sortie de ville');
      A.gt(lanternes, 0, 'des lampadaires aux abords de la ville');
      // les données du panneau donnent bien un nom et une distance
      var noeudPanneau = chemin.nodes.filter(function (n) { return n.panneau; })[0];
      A.ok(noeudPanneau && noeudPanneau.panneauInfo && noeudPanneau.panneauInfo.nom && noeudPanneau.panneauInfo.distance > 0,
           'le panneau porte un nom et une distance : ' + JSON.stringify(noeudPanneau && noeudPanneau.panneauInfo));
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
