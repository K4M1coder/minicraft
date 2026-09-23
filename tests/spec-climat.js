/* spec-climat.js — tests des specs SPEC-RELIEF-006, SPEC-LUMIERE-*, SPEC-VUE-*
   et SPEC-METEO-*. Hauts sommets et couches de nuages, lumière propagée,
   distance de vue, et météo. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core;
  var B = C.B;

  var mondes = {};
  function monde(g) { g = g || 20260921; if (!mondes[g]) mondes[g] = MC.createWorld(g); return mondes[g]; }

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — sommets et nuages', function () {
    it('SPEC-RELIEF-006 : trois couches de nuages sous les plus hauts sommets, deux au-dessus de tout relief', function () {
      var w = monde(), Bi = MC.Biomes.creer(w.noise), CO = MC.Meteo.COUCHES;
      A.equal(CO.length, 5, 'cinq couches');
      var sommetBas = CO[2].y + CO[2].epaisseur;          // dessus de la troisième couche
      A.ok(CO[3].y > C.WORLD_H && CO[4].y > C.WORLD_H, 'les deux plus hautes dominent tout relief possible');
      // une épaisseur propre à chaque nature de nuage
      var ep = CO.map(function (c) { return c.epaisseur; });
      A.ok(Math.max.apply(null, ep) >= 12 && Math.min.apply(null, ep) === 0, 'des cumulus épais aux cirrus sans épaisseur');
      A.ok(CO.every(function (c, k) { return k === 0 || c.y > CO[k - 1].y + CO[k - 1].epaisseur; }), 'couches étagées sans se chevaucher');
      var max = 0, dessus = 0, n = 0;
      for (var x = -3000; x <= 3000; x += 24) for (var z = -3000; z <= 3000; z += 24) {
        var col = Bi.echantillon(x, z);
        n++;
        if (col.h > max) max = col.h;
        if (col.h > sommetBas) {
          dessus++;
          A.ok(['montagnes', 'pics_glaces', 'glacier', 'volcan'].indexOf(col.biome.id) >= 0,
               'seules les montagnes percent la troisième couche (' + col.biome.id + ')');
        }
      }
      A.ok(max > sommetBas + 4, 'les plus hauts sommets dépassent les trois couches basses : ' + max);
      A.ok(dessus > 0 && dessus / n < 0.04, 'et ils restent rares : ' + (100 * dessus / n).toFixed(2) + ' %');
      A.ok(max <= C.WORLD_H - 1, 'le monde est assez haut pour les contenir');
      // le chunk généré à cet endroit porte bien la roche au-dessus des nuages
      var trouve = null;
      for (var x2 = -3000; x2 <= 3000 && !trouve; x2 += 24) for (var z2 = -3000; z2 <= 3000; z2 += 24) {
        if (Bi.hauteur(x2, z2) > sommetBas + 2) { trouve = [x2, z2]; break; }
      }
      w.getChunk(Math.floor(trouve[0] / 16), Math.floor(trouve[1] / 16), true);
      var h = w.groundAt(trouve[0], trouve[1], true);
      A.ok(h > sommetBas, 'le sol généré culmine au-dessus des nuages : ' + h);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — nuages', function () {
    var ME = MC.Meteo;
    it('SPEC-NUAGE-001 : les nuages se forment, se déforment, se dissipent et dérivent au vent', function () {
      var m = ME.creer(7), cu = ME.COUCHES[1];
      // en un point fixe, la densité change au fil du temps : des nuages naissent puis meurent
      var apparitions = 0, dissipations = 0;
      for (var p = 0; p < 40; p++) {
        var x = p * 173, z = -p * 97, avant = null;
        for (var t = 0; t < 1800; t += 30) {
          var d = m.densiteNuage(cu, x, z, t);
          if (avant !== null && avant < 0.05 && d > 0.3) apparitions++;
          if (avant !== null && avant > 0.3 && d < 0.05) dissipations++;
          avant = d;
        }
      }
      A.ok(apparitions > 0 && dissipations > 0, 'des nuages naissent (' + apparitions + ') et meurent (' + dissipations + ')');
      // la dérive est l'intégrale du vent : continue, même quand le temps change de segment
      var S = ME.SEGMENT;
      for (var k = 1; k < 30; k++) {
        var a = m.derive(k * S - 0.01), b = m.derive(k * S + 0.01);
        A.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.5, 'pas de saut de dérive au segment ' + k);
      }
      var d0 = m.derive(0), d1 = m.derive(3000);
      A.ok(Math.hypot(d1.x - d0.x, d1.z - d0.z) > 100, 'les nuages voyagent');
      // bancs : le champ de rassemblement varie dans l'espace et dans le temps
      var r1 = m.rassemblement(0, 0, 0), r2 = m.rassemblement(5000, 0, 0), r3 = m.rassemblement(0, 0, 4000);
      A.ok(Math.abs(r1 - r2) > 0.01 || Math.abs(r1 - r3) > 0.01, 'des régions plus nuageuses que d autres');
      // un ciel qui se couvre porte plus de nuages
      var clair = 0, bouche = 0;
      var etClair = Object.assign({}, m.etat(0), { couverture: 0.05 });
      var etBouche = Object.assign({}, m.etat(0), { couverture: 1 });
      for (var i = 0; i < 400; i++) {
        clair += m.densiteNuage(cu, i * 37, i * 11, 100, etClair);
        bouche += m.densiteNuage(cu, i * 37, i * 11, 100, etBouche);
      }
      A.ok(bouche > clair * 1.5, 'couverture : ' + clair.toFixed(1) + ' → ' + bouche.toFixed(1));
    });

    it('SPEC-NUAGE-002 : un nuage ne traverse pas la roche, et son épaisseur dépend de sa nature', function () {
      var m = ME.creer(11), cu = ME.COUCHES[1], et = Object.assign({}, m.etat(0), { couverture: 1 });
      var testes = 0;
      for (var i = 0; i < 300; i++) {
        var x = i * 29, z = i * 53;
        if (m.densiteNuage(cu, x, z, 0, et) < 0.2) continue;
        testes++;
        A.equal(m.densiteNuage(cu, x, z, 0, et, cu.y + 2, cu.y), 0, 'éteint dans la montagne');
        A.equal(m.densiteNuage(cu, x, z, 0, et, cu.y - 1, cu.y), 0, 'et au ras de la roche');
        A.ok(m.densiteNuage(cu, x, z, 0, et, cu.y - 10, cu.y) > 0.2, 'intact au-dessus d une vallée');
      }
      A.ok(testes > 10, 'assez de nuages éprouvés : ' + testes);
      // cumulus bombé : ses tranches hautes sont plus minces que sa base
      var bas = 0, haut = 0;
      for (var j = 0; j < 500; j++) {
        bas += m.densiteNuage(cu, j * 31, j * 7, 50, et, null, cu.y);
        haut += m.densiteNuage(cu, j * 31, j * 7, 50, et, null, cu.y + cu.epaisseur);
      }
      A.ok(haut < bas, 'dôme : ' + bas.toFixed(1) + ' à la base, ' + haut.toFixed(1) + ' au sommet');
      A.ok(ME.COUCHES.some(function (c) { return c.etire; }), 'des cirrus étirés en filaments');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — météo', function () {
    var ME = MC.Meteo;
    it('SPEC-METEO-001 : grand soleil, nuages, pluie, orage et tempête s enchaînent sans saut brutal', function () {
      var m = ME.creer(2026), vus = {}, precedent = null;
      for (var k = 0; k < 3000; k++) {
        var t = m.typeDu(k);
        vus[t] = (vus[t] || 0) + 1;
        if (precedent !== null && k % 32 !== 0) {
          A.ok(ME.TRANSITIONS[precedent][t] > 0, precedent + ' → ' + t + ' est une transition permise');
        }
        precedent = t;
      }
      ME.ORDRE_TYPES.forEach(function (t) { A.ok(vus[t] > 0, t + ' arrive (' + (vus[t] || 0) + ')'); });
      // déterministe : même graine, même ciel ; autre graine, autre ciel
      var m2 = ME.creer(2026), m3 = ME.creer(99), diff = 0;
      for (var i = 0; i < 200; i++) {
        A.equal(m2.typeDu(i), m.typeDu(i));
        if (m3.typeDu(i) !== m.typeDu(i)) diff++;
      }
      A.ok(diff > 20, 'une autre graine donne une autre météo');
      // fondu : la couverture évolue continûment d'un temps à l'autre
      var pire = 0;
      for (var s = 0; s < 20000; s += 2) pire = Math.max(pire, Math.abs(m.etat(s + 2).couverture - m.etat(s).couverture));
      A.ok(pire < 0.12, 'couverture continue (pas max ' + pire.toFixed(3) + ')');
      var et = m.etat(1234);
      A.ok(et.vent.force >= 0 && et.vent.force <= 1.3 && typeof et.vent.x === 'number', 'un vent orienté');
    });

    it('SPEC-METEO-002 : il fait froid en altitude et aux pôles, chaud au désert le jour, froid la nuit', function () {
      var m = ME.creer(5), et = m.etat(0);
      var jour = MC.DayCycle.DAY_LENGTH * 0.2, nuit = MC.DayCycle.DAY_LENGTH * 0.7;
      var plaine = m.temperature(0.5, 30, jour, et, 'plaines');
      var sommet = m.temperature(0.5, 110, jour, et, 'montagnes');
      var pics = m.temperature(0.03, 40, jour, et, 'pics_glaces');
      var desertJour = m.temperature(0.85, 30, jour, et, 'desert');
      var desertNuit = m.temperature(0.85, 30, nuit, et, 'desert');
      A.ok(sommet < plaine - 15, 'les sommets sont glacés : ' + sommet + ' contre ' + plaine);
      A.ok(pics < 0, 'les pics glacés gèlent : ' + pics);
      A.ok(desertJour >= 38, 'le désert brûle le jour : ' + desertJour);
      A.ok(desertNuit < desertJour - 12, 'et se refroidit la nuit : ' + desertNuit);
      var soleil = Object.assign({}, et, { chaleur: ME.TYPES.grand_soleil.chaleur });
      var tempete = Object.assign({}, et, { chaleur: ME.TYPES.tempete.chaleur });
      A.ok(m.temperature(0.5, 30, jour, soleil) > m.temperature(0.5, 30, jour, tempete) + 8, 'grand soleil contre tempête');
      A.equal(ME.ressenti(-20), 'glacial'); A.equal(ME.ressenti(0), 'froid'); A.equal(ME.ressenti(18), 'doux');
      A.equal(ME.ressenti(32), 'chaud'); A.equal(ME.ressenti(45), 'brulant');
    });

    it('SPEC-METEO-003 : pluie ou neige selon la température, jamais au désert ni par beau temps', function () {
      var m = ME.creer(8), pluie = Object.assign({}, m.etat(0), { precipitation: 1 });
      var beau = Object.assign({}, m.etat(0), { precipitation: 0 });
      var pleut = false, neige = false;
      for (var i = 0; i < 200; i++) {
        var p = m.precipitation(i * 300, i * 170, 50, 12, 'plaines', pluie);
        if (p.forme) { A.equal(p.forme, 'pluie'); A.ok(p.intensite > 0 && p.intensite <= 1); pleut = true; }
        var n = m.precipitation(i * 300, i * 170, 50, -5, 'taiga', pluie);
        if (n.forme) { A.equal(n.forme, 'neige'); neige = true; }
        A.equal(m.precipitation(i * 300, i * 170, 50, 30, 'desert', pluie).forme, null, 'le désert reste sec');
        A.equal(m.precipitation(i * 300, i * 170, 50, 12, 'plaines', beau).forme, null, 'rien par beau temps');
      }
      A.ok(pleut, 'il pleut en plaine');
      A.ok(neige, 'il neige quand il gèle');
    });

    it('SPEC-METEO-004 : les éclairs ne tombent que par orage, aux mêmes instants et lieux pour tous', function () {
      var m = ME.creer(13), total = 0;
      for (var t = 0; t < 40000; t += 100) {
        m.eclairs(t, t + 100).forEach(function (e) {
          total++;
          A.ok(e.t > t && e.t <= t + 100, 'dans l intervalle');
          A.ok(m.etat(Math.floor(e.t)).eclairs > 0, 'pendant un orage (' + m.etat(Math.floor(e.t)).type + ')');
        });
      }
      A.ok(total > 5, 'des éclairs tombent : ' + total);
      var m2 = ME.creer(13);
      function ids(mm) { return mm.eclairs(0, 40000).map(function (e) { return e.id; }); }
      A.deep(ids(m2), ids(m), 'mêmes éclairs pour tous les postes');
      var e0 = { id: 123, t: 123.5, force: 1 };
      A.deep(m.lieuEclair(e0, 10, 10), m2.lieuEclair(e0, 20, 30), 'deux joueurs voisins le voient au même endroit');
      var lieu = m.lieuEclair(e0, 10, 10);
      A.ok(Math.hypot(lieu.x - 32, lieu.z - 32) <= 81, 'près des joueurs');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — vue lointaine', function () {
    var L = MC.Lointain;
    it('SPEC-VUE-001 : un relief simplifié porte la vue jusqu à un kilomètre, sans figer une image', function () {
      var w = monde(), appels = 0;
      var gr = L.creerGrille({ pas: 8, cote: 128, echantillon: function (x, z) { appels++; return w.echantillonLointain(x, z); } });
      A.ok(gr.recentrer(100, -50), 'une grille se prépare');
      A.ok(!gr.pret, 'pas encore prête');
      var images = 0;
      while (!gr.avancer(1500)) images++;
      A.ok(images >= 10, 'remplie sur plusieurs images (' + images + '), jamais d un bloc');
      A.equal(appels, 128 * 128, 'une colonne par échantillon');
      A.ok(gr.pret && gr.version === 1, 'active une fois complète');
      A.ok(!gr.recentrer(110, -40), 'un petit pas ne relance rien');
      var h = gr.hauteur(100, -50), vrai = Math.max(w.heightAt(100, -50), C.SEA_LEVEL);
      A.ok(Math.abs(h - vrai) < 8, 'hauteur fidèle au terrain : ' + h.toFixed(1) + ' / ' + vrai);
      A.equal(gr.hauteur(1e6, 0), null, 'rien hors de la grille');
      var mm = L.maillage(gr, 1.5);
      A.equal(mm.positions.length, 128 * 128 * 3);
      A.equal(mm.indices.length, 127 * 127 * 6);
      A.ok(mm.etendue >= 1000, 'le relief couvre ' + mm.etendue + ' blocs');
      // couleurs : neige sur les sommets, lave dans les cratères
      var mont = MC.Biomes.LISTE.montagnes;
      var neige = L.couleurLointaine({ biome: mont, h: 100, climat: {} });
      var herbe = L.couleurLointaine({ biome: mont, h: 30, climat: {} });
      A.equal(neige.length, 3);
      A.ok(neige[2] > herbe[2] + 60, 'les sommets sont enneigés');
      var lave = L.couleurLointaine({ biome: MC.Biomes.LISTE.volcan, h: 60, lave: 56, climat: {} });
      A.ok(lave[0] > 150 && lave[2] < 80, 'le cratère rougeoie');
    });

    it('SPEC-VUE-002 : la distance de vue s allonge tant que l image reste fluide, et recule sinon', function () {
      var V = L.VUE;
      A.equal(L.ajusterDistance(6, 60, 0), 7, 'fluide et à jour : on voit plus loin');
      A.equal(L.ajusterDistance(6, 60, 40), 6, 'tant que le chargement n a pas rattrapé, on attend');
      A.equal(L.ajusterDistance(6, 30, 0), 5, 'saccades : on recule');
      A.equal(L.ajusterDistance(6, 50, 0), 6, 'entre les deux seuils, on garde');
      A.equal(L.ajusterDistance(V.max, 60, 0), V.max, 'borne haute');
      A.equal(L.ajusterDistance(V.min, 10, 0), V.min, 'borne basse');
      A.ok(V.max >= 12, 'jusqu à ' + V.max + ' chunks de vrais blocs');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
