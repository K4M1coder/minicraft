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

  describe('Specs — ombre des nuages', function () {
    var ME = MC.Meteo;
    it('SPEC-OMBRE-003 : les nuages projettent leur ombre au sol, décalée selon le soleil, et elle dérive avec eux', function () {
      var m = ME.creer(11), et = Object.assign({}, m.etat(0), { couverture: 1 });
      var zenith = { x: 0, y: 1, z: 0 }, oblique = { x: 0.6, y: 0.5, z: 0 };
      var n = Math.hypot(oblique.x, oblique.y); oblique.x /= n; oblique.y /= n;
      var ombres = 0, clairs = 0, decales = 0;
      for (var i = 0; i < 300; i++) {
        var x = i * 29, z = i * 53, f = m.ombreNuage(x, 30, z, 0, zenith, et);
        A.ok(f >= 0.5 && f <= 1, 'facteur borné');
        if (f < 0.75) ombres++; else if (f > 0.99) clairs++;
        if (Math.abs(m.ombreNuage(x, 30, z, 0, oblique, et) - f) > 0.2) decales++;
      }
      A.gt(ombres, 10, 'des taches d ombre sous les nuages : ' + ombres);
      A.gt(clairs, 10, 'et du soleil entre eux : ' + clairs);
      A.gt(decales, 10, 'un soleil oblique déplace l ombre : ' + decales);
      A.equal(m.ombreNuage(0, 30, 0, 0, { x: 0.2, y: -0.3, z: 0 }, et), 1, 'la nuit, pas d ombre de nuage');
      // l'ombre voyage avec le vent
      var bouge = 0;
      for (var j = 0; j < 200; j++) if (Math.abs(m.ombreNuage(j * 41, 30, j * 17, 0, zenith, et) - m.ombreNuage(j * 41, 30, j * 17, 600, zenith, et)) > 0.2) bouge++;
      A.gt(bouge, 10, 'dix minutes plus tard, l ombre a bougé : ' + bouge);
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
  describe('Specs — le climat sur le corps', function () {
    var ME = MC.Meteo;
    it('SPEC-METEO-005 : un feu réchauffe, l eau rafraîchit ; le froid mordant blesse, la fournaise assoiffe', function () {
      var w = monde(), m = w.meteo;
      A.ok(m && typeof m.temperatureEn === 'function', 'le monde porte sa météo');
      var cx = 90, cz = 90;
      w.getChunk(Math.floor(cx / 16), Math.floor(cz / 16), true);
      var y = w.groundAt(cx, cz, true) + 1, pos = { x: cx + 0.5, y: y, z: cz + 0.5 };
      for (var dy = 0; dy < 3; dy++) for (var dx = -3; dx <= 3; dx++) for (var dz = -3; dz <= 3; dz++) w.setBlock(cx + dx, y + dy, cz + dz, 0);
      var base = m.temperatureEn(w, pos, 100);
      w.setBlock(cx + 2, y, cz, B.TORCH);
      var torche = m.temperatureEn(w, pos, 100);
      A.ok(torche.feu && torche.temperature > base.temperature + 5, 'près d une torche : ' + base.temperature + ' → ' + torche.temperature);
      w.setBlock(cx + 2, y, cz, B.LAVA);
      var lave = m.temperatureEn(w, pos, 100);
      A.ok(lave.temperature > torche.temperature, 'la lave chauffe plus fort : ' + lave.temperature);
      w.setBlock(cx + 2, y, cz, 0);
      w.setBlock(cx, y, cz, B.WATER);
      var eau = m.temperatureEn(w, pos, 100);
      A.ok(eau.eau, 'dans l eau');
      w.setBlock(cx, y, cz, 0);
      // sur le corps
      function joueur(mode, diff) { return MC.createPlayer(G.flatWorld(10, B.STONE), null, MC.Modes.regles(mode, diff)); }
      var pl = joueur('survie', 'facile'), hp = pl.state.hp;
      A.equal(pl.subirClimat(0.5, 15), null, 'doux : aucun effet');
      for (var i = 0; i < 40; i++) pl.subirClimat(0.5, -25);
      A.equal(pl.state.climat, 'froid');
      A.ok(pl.state.hp < hp, 'vingt secondes à -25 °C blessent : ' + hp + ' → ' + pl.state.hp);
      var doux = joueur('survie', 'paisible');
      for (var k = 0; k < 40; k++) doux.subirClimat(0.5, -25);
      A.equal(doux.state.hp, 20, 'en paisible, le froid ne tue pas');
      var crea = joueur('creatif', 'facile');
      for (var c2 = 0; c2 < 40; c2++) crea.subirClimat(0.5, -25);
      A.equal(crea.state.hp, 20, 'en créatif, rien ne blesse');
      var chaud = joueur('survie', 'facile'), ex = chaud.state.exhaustion;
      for (var h = 0; h < 20; h++) chaud.subirClimat(0.5, 45);
      A.equal(chaud.state.climat, 'chaleur');
      A.ok(chaud.state.exhaustion > ex + 2, 'la fournaise creuse la faim : ' + chaud.state.exhaustion.toFixed(1));
    });

    it('SPEC-METEO-006 : la foudre frappe qui se tient à découvert tout près, pas qui s abrite', function () {
      var m = ME.creer(3), lieu = { x: 10, z: 10 };
      function ciel() { return 20; }
      function toit() { return 40; }
      A.ok(m.foudroie(lieu, { x: 11, y: 21, z: 10.5 }, ciel), 'à découvert, à un bloc');
      A.notOk(m.foudroie(lieu, { x: 16, y: 21, z: 10 }, ciel), 'à six blocs : épargné');
      A.notOk(m.foudroie(lieu, { x: 10.5, y: 21, z: 10.5 }, toit), 'sous un toit : épargné');
      A.ok(m.DEGATS_FOUDRE >= 4, 'des dégâts sérieux : ' + m.DEGATS_FOUDRE);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — lumière des blocs', function () {
    var L = MC.Lumiere, CX = C.CHUNK_X, CZ = C.CHUNK_Z;
    // 3 × 3 chunks factices : un sol de pierre en y ≤ 10, de l'air au-dessus
    function region() {
      var chunks = new Map();
      for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) {
        var bl = new Uint8Array(CX * C.WORLD_H * CZ);
        for (var y = 0; y <= 10; y++) for (var z = 0; z < CZ; z++) for (var x = 0; x < CX; x++) bl[C.idx(x, y, z)] = B.STONE;
        chunks.set(a + ',' + b, { cx: a, cz: b, blocks: bl });
      }
      function chunkDe(a, b) { return chunks.get(a + ',' + b) || null; }
      function poser(wx, wy, wz, id) {
        var c = chunkDe(Math.floor(wx / CX), Math.floor(wz / CZ));
        c.blocks[C.idx(((wx % CX) + CX) % CX, wy, ((wz % CZ) + CZ) % CZ)] = id;
        c.emetteurs = null;
      }
      return { chunkDe: chunkDe, poser: poser };
    }

    it('SPEC-LUMIERE-001 : une source éclaire de proche en proche, un cran par bloc, et les murs l arrêtent', function () {
      A.equal(L.emission(B.TORCH), 12); A.equal(L.emission(B.LAVA), 15); A.equal(L.emission(B.STONE), 0);
      A.ok(L.opaque(B.STONE) && !L.opaque(B.GLASS) && !L.opaque(B.LEAVES) && !L.opaque(B.WATER) && !L.opaque(0));
      var r = region();
      r.poser(8, 11, 8, B.TORCH);
      var e = L.eclairer(r.chunkDe, 0, 0);
      A.equal(e.niveau(8, 11, 8), 12, 'la source à son plein niveau');
      A.equal(e.niveau(9, 11, 8), 11, 'un bloc plus loin : un cran de moins');
      A.equal(e.niveau(12, 11, 8), 8);
      A.equal(e.niveau(8, 11, 13), 7);
      A.equal(e.niveau(8, 10, 8), 0, 'la pierre ne s allume pas');
      // un mur de pierre : la lumière le contourne, plus faible, au lieu de le traverser
      for (var y = 11; y < 30; y++) for (var z = 0; z < 16; z++) r.poser(10, y, z, B.STONE);
      e = L.eclairer(r.chunkDe, 0, 0);
      A.equal(e.niveau(11, 11, 8), 0, 'derrière un mur plein, le noir');
      // le verre la laisse passer
      r.poser(10, 11, 8, B.GLASS);
      e = L.eclairer(r.chunkDe, 0, 0);
      A.equal(e.niveau(11, 11, 8), 9, 'à travers le verre : 12 − 3');
    });

    it('SPEC-LUMIERE-002 : autant de sources que l on veut, et la lumière passe d un chunk à l autre', function () {
      var r = region(), n = 0;
      for (var x = 0; x < 16; x += 2) for (var z = 0; z < 16; z += 2) { r.poser(x, 11, z, B.TORCH); n++; }
      for (var i = 0; i < 20; i++) { r.poser(-8 + (i % 5), 11, -8 + ((i / 5) | 0), B.LANTERN); n++; }
      var e = L.eclairer(r.chunkDe, 0, 0);
      A.ok(e.sources >= 64, 'toutes les sources du chunk comptent (' + e.sources + ' sur ' + n + ') — aucune limite de nombre');
      // une torche dans le chunk voisin éclaire le bord du chunk central
      var r2 = region();
      r2.poser(-3, 11, 5, B.TORCH);
      var e2 = L.eclairer(r2.chunkDe, 0, 0);
      A.equal(e2.niveau(0, 11, 5), 9, 'lumière venue du chunk voisin (12 − 3)');
      A.equal(e2.niveau(-1, 11, 5), 10, 'et la marge d une case la connaît aussi');
      // le mailleur l'inscrit dans les sommets
      var c = r2.chunkDe(0, 0);
      var raw = MC.Mesher.buildChunk(c, 'opaque', function (wx, wy) { return wy <= 10 ? B.STONE : 0; }, e2);
      A.equal(raw.lums.length, raw.positions.length / 3, 'une lumière par sommet');
      var allumes = raw.lums.filter(function (v) { return v > 0; }).length;
      A.ok(allumes > 0 && allumes < raw.lums.length, 'le sol près de la torche s éclaire, le reste non');
      A.ok(Math.max.apply(null, raw.lums) <= 1, 'bornée à 1');
      var sans = MC.Mesher.buildChunk(c, 'opaque', function (wx, wy) { return wy <= 10 ? B.STONE : 0; });
      A.ok(sans.lums.every(function (v) { return v === 0; }), 'sans propagation, aucune lueur');
    });

    it('SPEC-LUMIERE-003 : poser, retirer une source ou ouvrir un passage recalcule les chunks à portée, et eux seuls', function () {
      var r = region();
      var t = L.chunksTouches(r.chunkDe, 2, 11, 2, 0, B.TORCH);
      A.ok(t.length >= 2 && t.some(function (c) { return c[0] === 0 && c[1] === 0; }), 'poser une torche : son chunk et ses voisins proches');
      A.ok(t.some(function (c) { return c[0] === -1 && c[1] === -1; }), 'près d un coin, le chunk en diagonale aussi');
      A.equal(L.chunksTouches(r.chunkDe, 8, 5, 8, B.STONE, B.COBBLE).length, 0, 'un bloc qui ne change ni la lumière ni l opacité ne coûte rien');
      A.gt(L.chunksTouches(r.chunkDe, 8, 30, 8, 0, B.STONE).length, 0, 'un bloc opaque posé en plein air fait de l ombre : on recalcule');
      r.poser(8, 11, 8, B.TORCH);
      A.ok(L.chunksTouches(r.chunkDe, 10, 11, 8, 0, B.STONE).length > 0, 'fermer un passage près d une torche rééclaire');
      A.equal(L.chunksTouches(r.chunkDe, 10, 11, 8, B.TALL_GRASS, 0).length, 0, 'une herbe ne change rien à la lumière');
      // un lac de lave n'éclaire que par sa surface
      var r3 = region();
      for (var x = 2; x < 14; x++) for (var z = 2; z < 14; z++) for (var y = 3; y <= 10; y++) r3.poser(x, y, z, B.LAVA);
      var em = L.emetteurs(r3.chunkDe(0, 0));
      A.equal(em.length / 2, 12 * 12, 'seule la couche du dessus rayonne (' + em.length / 2 + ')');
      A.equal(L.eclairer(r3.chunkDe, 0, 0).niveau(8, 11, 8), 14, 'et elle éclaire au-dessus du lac');
      // le vrai monde tient ces caches à jour
      var w = monde();
      var ch = w.getChunk(40, 40, true);
      L.emetteurs(ch);
      A.ok(Array.isArray(ch.emetteurs), 'sources en cache');
      w.setBlock(40 * 16 + 3, 60, 40 * 16 + 3, B.TORCH);
      A.equal(ch.emetteurs, null, 'un bloc changé vide le cache du chunk');
      w.setBlock(40 * 16 + 3, 60, 40 * 16 + 3, 0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — lumière du ciel', function () {
    var L = MC.Lumiere, CX = C.CHUNK_X, CZ = C.CHUNK_Z;
    function region() {
      var chunks = new Map();
      for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) {
        var bl = new Uint8Array(CX * C.WORLD_H * CZ);
        for (var y = 0; y <= 10; y++) for (var z = 0; z < CZ; z++) for (var x = 0; x < CX; x++) bl[C.idx(x, y, z)] = B.STONE;
        chunks.set(a + ',' + b, { cx: a, cz: b, blocks: bl });
      }
      function chunkDe(a, b) { return chunks.get(a + ',' + b) || null; }
      function poser(wx, wy, wz, id) {
        var c = chunkDe(Math.floor(wx / CX), Math.floor(wz / CZ));
        c.blocks[C.idx(((wx % CX) + CX) % CX, wy, ((wz % CZ) + CZ) % CZ)] = id;
        c.emetteurs = null;
      }
      return { chunkDe: chunkDe, poser: poser };
    }

    it('SPEC-LUMIERE-004 : le jour descend jusqu au premier bloc opaque puis se répand ; une grotte close est noire', function () {
      var r = region();
      // un surplomb : dalle de pierre en y = 15 au-dessus de x, z ∈ [4, 12]
      for (var x = 4; x <= 12; x++) for (var z = 4; z <= 12; z++) r.poser(x, 15, z, B.STONE);
      // une grotte close dans la pierre : x, z ∈ [6, 10], y ∈ [4, 7]
      for (var gx = 6; gx <= 10; gx++) for (var gz = 6; gz <= 10; gz++) for (var gy = 4; gy <= 7; gy++) r.poser(gx, gy, gz, 0);
      // une colonne d'eau profonde ailleurs
      for (var wy = 1; wy <= 30; wy++) r.poser(-6, wy, -6, B.WATER);
      var e = L.eclairer(r.chunkDe, 0, 0);
      A.equal(e.ciel(2, 20, 2), 15, 'plein jour en plein air');
      A.equal(e.ciel(2, 11, 2), 15, 'jusqu au sol');
      var sous = e.ciel(8, 11, 8);
      A.ok(sous > 0 && sous < 15, 'sous le surplomb, la pénombre : ' + sous);
      A.ok(e.ciel(8, 11, 8) < e.ciel(5, 11, 5), 'plus sombre au cœur qu au bord de l abri');
      A.equal(e.ciel(8, 5, 8), 0, 'la grotte close est noire');
      A.equal(e.ciel(8, 9, 8), 0, 'la pierre aussi, évidemment');
      var eau = L.eclairer(r.chunkDe, -1, -1);
      A.ok(eau.ciel(10, 25, 10) > eau.ciel(10, 5, 10), 'le fond de l eau est plus sombre que sa surface : ' +
           eau.ciel(10, 25, 10) + ' → ' + eau.ciel(10, 5, 10));
    });

    it('SPEC-LUMIERE-005 : ciel et sources se combinent — dehors le jour domine, la nuit seules les sources éclairent', function () {
      var r = region();
      for (var gx = 6; gx <= 10; gx++) for (var gz = 6; gz <= 10; gz++) for (var gy = 4; gy <= 7; gy++) r.poser(gx, gy, gz, 0);
      r.poser(7, 4, 7, B.TORCH);
      var e = L.eclairer(r.chunkDe, 0, 0);
      var raw = MC.Mesher.buildChunk(r.chunkDe(0, 0), 'opaque', function (wx, wy) { return wy <= 10 ? B.STONE : 0; }, e);
      A.equal(raw.ciels.length, raw.positions.length / 3, 'un ciel par sommet');
      var dehors = 0, dedans = 0;
      for (var i = 0; i < raw.ciels.length; i++) {
        if (raw.positions[i * 3 + 1] > 10.5) { if (raw.ciels[i] === 1) dehors++; }
        else if (raw.positions[i * 3 + 1] < 8) { if (raw.ciels[i] === 0) dedans++; }
      }
      A.gt(dehors, 100, 'le sol en plein air reçoit tout le ciel');
      A.gt(dedans, 20, 'les parois de la grotte, aucun');
      // la règle de combinaison, commune au terrain et aux créatures
      var jour = 1, nuit = 0;
      A.ok(L.eclat(1, 0, jour) > 0.95, 'dehors, de jour : pleine lumière');
      A.ok(L.eclat(1, 0, nuit) < 0.4 && L.eclat(1, 0, nuit) > 0.2, 'dehors, de nuit : pénombre lunaire');
      A.ok(L.eclat(0, 0, jour) < 0.05, 'dans une grotte, même en plein jour : le noir');
      A.ok(L.eclat(0, 1, nuit) > 0.8, 'près d une torche : on y voit');
      A.ok(L.eclat(0, 1, jour) < L.eclat(0, 1, nuit) + 0.01, 'une torche compte moins en plein jour');
    });

    it('SPEC-LUMIERE-006 : une créature prend la lumière de sa case', function () {
      var r = region();
      for (var gx = 6; gx <= 10; gx++) for (var gz = 6; gz <= 10; gz++) for (var gy = 4; gy <= 7; gy++) r.poser(gx, gy, gz, 0);
      r.poser(10, 4, 10, B.TORCH);
      var c = r.chunkDe(0, 0);
      c.lumiere = L.eclairer(r.chunkDe, 0, 0);
      var dehors = L.lumiereEn(r.chunkDe, 3.5, 11.2, 3.5), grotte = L.lumiereEn(r.chunkDe, 6.5, 4.5, 6.5),
          torche = L.lumiereEn(r.chunkDe, 9.5, 4.5, 9.5);
      A.equal(dehors.ciel, 1, 'dehors : tout le ciel');
      A.equal(grotte.ciel, 0, 'au fond de la grotte : aucun');
      A.gt(torche.bloc, grotte.bloc, 'près de la torche : sa lueur');
      A.deep(L.lumiereEn(r.chunkDe, 100, 20, 100), { ciel: 1, bloc: 0 }, 'hors des chunks calculés : plein jour par défaut');
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
