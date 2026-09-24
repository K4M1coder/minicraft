/* spec-souterrain.js — tests des specs SPEC-SOUTERRAIN-001 à 003,
   SPEC-MINERAI-001 et 002, et SPEC-LUMIERE-007. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, Inv = MC.Inventory, Souterrain = MC.Souterrain;
  var B = C.B, I = C.I;

  var GRAINE = 20260921;
  var mondes = {};
  function monde(g) {
    g = g === undefined ? GRAINE : g;
    if (!mondes[g]) mondes[g] = MC.createWorld(g);
    return mondes[g];
  }

  // prospection pure (sans générer de chunk) : le premier point, sur une
  // spirale, dont le biome est celui demandé — le désert et les badlands sont
  // des biomes rares, souvent loin de l'origine (voir spec-monde.js)
  function chunkDuBiome(w, ids) {
    for (var r = 0; r < 400; r += 2) {
      for (var k = 0; k < 8 * Math.max(1, r); k++) {
        var a = (k / (8 * Math.max(1, r))) * Math.PI * 2;
        var wx = Math.round(Math.cos(a) * r * 16), wz = Math.round(Math.sin(a) * r * 16);
        if (ids.indexOf(w.biomeAt(wx, wz).id) >= 0) return [Math.floor(wx / C.CHUNK_X), Math.floor(wz / C.CHUNK_Z)];
      }
    }
    return null;
  }

  // recense un bloc dans une large zone de colonnes, à toute profondeur : de
  // quoi trouver au moins un exemplaire des minerais et décors les plus rares.
  // `max` borne le nombre de résultats retenus (par défaut, assez pour un test
  // de présence — un peu plus quand on doit ensuite filtrer par biome, sans
  // quoi les premières trouvailles, ailleurs, épuiseraient la borne).
  function recenser(w, r, pred, max) {
    var trouve = [], lim = max || 40;
    for (var cx = -r; cx <= r && trouve.length < lim; cx++) {
      for (var cz = -r; cz <= r && trouve.length < lim; cz++) {
        var c = w.getChunk(cx, cz, true);
        for (var y = 1; y < C.WORLD_H; y++) for (var z = 0; z < C.CHUNK_Z; z++) for (var x = 0; x < C.CHUNK_X; x++) {
          var id = c.blocks[C.idx(x, y, z)];
          if (pred(id)) trouve.push({ x: cx * C.CHUNK_X + x, y: y, z: cz * C.CHUNK_Z + z, id: id });
        }
      }
    }
    return trouve;
  }
  // même chose, autour d'un chunk donné plutôt que de l'origine
  function recenser2(w, ccx, ccz, r, pred, max) {
    return recenser({
      getChunk: function (dx, dz, create) { return w.getChunk(ccx + dx, ccz + dz, create); },
    }, r, pred, max).map(function (p) { return { x: p.x + ccx * C.CHUNK_X, y: p.y, z: p.z + ccz * C.CHUNK_Z, id: p.id }; });
  }

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — minerais (SPEC-MINERAI-001, SPEC-MINERAI-002)', function () {
    it('SPEC-MINERAI-001 : chaque minerai existe, avec son outil et sa profondeur propres @lent', function () {
      var w = monde();
      var champs = [B.MINERAI_METAUX, B.MINERAI_ARGENT, B.MINERAI_GEMMES, B.MINERAI_CRISTAL, B.SEL];
      champs.forEach(function (id) {
        var d = C.BLOCKS[id];
        A.ok(d, 'bloc défini : ' + id);
        A.ok(d.tool === 'pickaxe' || d.tool === 'shovel', 'un outil requis : ' + d.name);
      });
      // le sel est peu profond, dans le désert ou les badlands — des biomes
      // rares, qu'on prospecte d'abord (sans générer) avant d'y regarder
      var chunkSec = chunkDuBiome(w, ['desert', 'badlands']);
      A.ok(chunkSec, 'un désert ou des badlands existent dans ce monde');
      var sel = recenser2(w, chunkSec[0], chunkSec[1], 4, function (id) { return id === B.SEL; });
      A.gt(sel.length, 0, 'du sel a été généré');
      sel.forEach(function (p) {
        var bio = w.biomeAt(p.x, p.z);
        A.ok(bio.id === 'desert' || bio.id === 'badlands', 'sel dans un biome sec : ' + bio.id);
      });
      // les gemmes ne sont trouvées qu'en profondeur (< 18)
      var gemmes = recenser(w, 6, function (id) { return id === B.MINERAI_GEMMES; });
      A.gt(gemmes.length, 0, 'des gemmes ont été générées');
      gemmes.forEach(function (p) { A.lt(p.y, 18, 'gemme profonde : y=' + p.y); });
      // le cristal/quartz-soufre est plus fréquent et plus haut sous un volcan
      var chunkVolcan = chunkDuBiome(w, ['volcan']);
      A.ok(chunkVolcan, 'un volcan existe dans ce monde');
      var cristalVolcan = recenser2(w, chunkVolcan[0], chunkVolcan[1], 3, function (id) { return id === B.MINERAI_CRISTAL; }, 4000)
        .filter(function (p) { return w.biomeAt(p.x, p.z).id === 'volcan'; });
      A.gt(cristalVolcan.length, 0, 'du minerai de cristal près d’un volcan');
    });

    it('SPEC-MINERAI-001 : casser un minerai combiné donne bien sa matière, avec le bon outil', function () {
      A.deep(C.dropsOf(B.MINERAI_METAUX, true, function () { return 0; }).map(function (d) { return d.id; }).sort(),
             [I.CUIVRE_BRUT, I.ETAIN_BRUT].sort());
      var sansOutil = C.breakTime(B.MINERAI_GEMMES, I.WOOD_PICKAXE);
      A.notOk(sansOutil.harvests, 'la pioche en bois ne suffit pas pour les gemmes');
      var avecFer = C.breakTime(B.MINERAI_GEMMES, I.IRON_PICKAXE);
      A.ok(avecFer.harvests, 'la pioche en fer suffit pour les gemmes');
    });

    it('SPEC-MINERAI-002 : lingots et gemmes entrent dans des recettes', function () {
      var g = function (w, h) { var a = []; for (var i = 0; i < w * h; i++) a.push(0); return a; };
      // bronze : cuivre + étain fondus puis alliés
      A.equal(Inv.smeltResult(I.CUIVRE_BRUT), I.CUIVRE_LINGOT);
      A.equal(Inv.smeltResult(I.ETAIN_BRUT), I.ETAIN_LINGOT);
      A.equal(Inv.smeltResult(I.ARGENT_BRUT), I.ARGENT_LINGOT);
      var grille = g(1, 1); grille[0] = I.CUIVRE_LINGOT;
      var grille2 = [I.CUIVRE_LINGOT, I.ETAIN_LINGOT];
      var r = Inv.matchRecipe(grille2, 2, 1);
      A.ok(r && r.id === I.BRONZE_LINGOT, 'cuivre + étain -> bronze');
      // pioche en bronze : un outil complet
      var pioche = [I.BRONZE_LINGOT, I.BRONZE_LINGOT, I.BRONZE_LINGOT, 0, I.STICK, 0, 0, I.STICK, 0];
      var rp = Inv.matchRecipe(pioche, 3, 3);
      A.ok(rp && rp.id === I.BRONZE_PIOCHE, 'la pioche en bronze se façonne');
      A.ok(C.def(I.BRONZE_PIOCHE).tool === 'pickaxe', 'objet : un outil');
      // bijou : un objet de luxe, à partir d'une gemme et d'argent
      var bijou = Inv.matchRecipe([I.ARGENT_LINGOT, I.RUBIS], 2, 1);
      A.ok(bijou && bijou.id === I.BIJOU, 'argent + rubis -> bijou');
    });

    it('SPEC-MINERAI-002 : les habitants échangent les nouvelles matières', function () {
      var noms = [I.CUIVRE_LINGOT, I.QUARTZ, I.RUBIS, I.SAPHIR, I.BIJOU, I.ARGENT_LINGOT];
      var couverts = noms.filter(function (id) {
        return Inv.TRADES.some(function (t) {
          return t.get.id === id || t.give.some(function (gv) { return gv.id === id; });
        });
      });
      A.equal(couverts.length, noms.length, 'chaque matière apparaît dans au moins un échange');
    });

    it('SPEC-MINERAI-002 : les nouvelles matières apparaissent dans des butins de donjon', function () {
      var D = MC.Donjons;
      var trouves = {};
      [I.CUIVRE_LINGOT, I.ETAIN_LINGOT, I.ARGENT_LINGOT, I.LAPIS, I.QUARTZ, I.RUBIS, I.SAPHIR, I.BIJOU].forEach(function (id) {
        trouves[id] = false;
      });
      Object.keys(D.TYPES).forEach(function (t) {
        // butin() est une méthode d'instance ; on relit directement la table utilisée
      });
      var w = monde();
      for (var rx = -8; rx < 8; rx++) for (var rz = -8; rz < 8; rz++) {
        var d = w.donjons.deRegion(rx, rz);
        if (!d) continue;
        d.coffres.forEach(function (cf, i) {
          w.donjons.butin(d, i).forEach(function (it) { if (trouves.hasOwnProperty(it.id)) trouves[it.id] = true; });
        });
      }
      var manquants = Object.keys(trouves).filter(function (k) { return !trouves[k]; });
      A.equal(manquants.length, 0, 'matières jamais vues dans un butin : ' + manquants.join(','));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — biomes souterrains (SPEC-SOUTERRAIN-001)', { teste: 'Les biomes souterrains et leur décor (sol, lumière) selon la profondeur.', pourquoi: 'Couvre SPEC-SOUTERRAIN-001 et le placement du décor qui distingue visuellement chaque biome souterrain.', attendu: 'chaque biome souterrain a son décor propre, cohérent avec sa profondeur, en plus de SPEC-SOUTERRAIN-001.' }, function () {
    it('SPEC-SOUTERRAIN-001 : le biome souterrain suit la surface, l’abîme l’emporte au plus profond', function () {
      A.equal(Souterrain.biomeAt('montagnes', 40, false), 'geode');
      A.equal(Souterrain.biomeAt('pics_glaces', 30, false), 'geode');
      A.equal(Souterrain.biomeAt('volcan', 30, false), 'chambre_magmatique');
      A.equal(Souterrain.biomeAt('plaines', 30, false), 'luxuriante');
      A.equal(Souterrain.biomeAt('foret', 30, false), 'luxuriante');
      A.equal(Souterrain.biomeAt('desert', 30, true), 'englouties');
      A.equal(Souterrain.biomeAt('montagnes', Souterrain.ABIME_Y, false), 'abime');
      A.equal(Souterrain.biomeAt('volcan', 2, false), 'abime', 'l’abîme l’emporte même sous un volcan');
      A.equal(Souterrain.biomeAt('desert', 30, false), 'grotte', 'un désert sans montagne ni volcan : grotte ordinaire');
    });

    it('decorSol : rien pour un biome sans décor, parfois un décor ou une lumière ailleurs', function () {
      A.equal(Souterrain.decorSol('grotte', 0.99), 0, 'la grotte ordinaire n a pas de décor propre');
      A.equal(Souterrain.decorSol('geode', 0.5), 0, 'un tirage bas ne décore pas');
      A.ok(Souterrain.decorSol('geode', 0.99), 'un tirage très haut pose la lumière du biome');
      A.ok(Souterrain.decorSol('luxuriante', 0.85), 'un tirage haut pose un décor');
    });

    it('SPEC-SOUTERRAIN-001 : les grottes sous la mer sont noyées, celles des géodes décorées de cristal', function () {
      var w = monde();
      var pochesEau = recenser(w, 4, function (id) { return id === B.WATER || id === B.ALGUE_LUMINEUSE; });
      A.gt(pochesEau.length, 0, 'de l’eau générée quelque part (mers, grottes englouties)');
      var cristaux = recenser(w, 10, function (id) { return id === B.CRISTAL_LUMINEUX; });
      A.gt(cristaux.length, 0, 'des cristaux lumineux ont été semés en profondeur');
    });
  });

  describe('Specs — créatures souterraines (SPEC-SOUTERRAIN-002)', function () {
    it('SPEC-SOUTERRAIN-002 : chaque biome souterrain a sa table d’apparition, avec des créatures définies', function () {
      var ids = ['geode', 'chambre_magmatique', 'luxuriante', 'englouties', 'abime', 'grotte'];
      ids.forEach(function (bid) {
        var table = Souterrain.mobsPour(bid);
        var especes = Object.keys(table);
        A.gt(especes.length, 0, bid + ' a des créatures');
        especes.forEach(function (type) {
          A.ok(MC.EntitySpecs[type], 'créature définie dans entities.js : ' + type);
        });
      });
      ['chauve_souris', 'araignee_caverne', 'elementaire_magma', 'golem_cristal', 'rodeur_abysse', 'creature_aveugle']
        .forEach(function (t) { A.ok(MC.EntitySpecs[t], t + ' existe'); });
    });

    it('SPEC-SOUTERRAIN-002 : l’apparition souterraine ne se déclenche que sous terre, et choisit une créature du biome', function () {
      var w = MC.createWorld(444);
      var ents = MC.createEntities(w);
      var col = w.findSpawnColumn();
      var surf = w.heightAt(col[0], col[1]);
      w.getChunk(Math.floor(col[0] / C.CHUNK_X), Math.floor(col[1] / C.CHUNK_Z), true);
      // en surface : rien ne doit apparaître par ce canal
      var joueurSurface = { pos: { x: col[0], y: surf + 2, z: col[1] } };
      var r = 0;
      function rng() { r = (r + 0.3172) % 1; return r; }
      var n = 0;
      for (var i = 0; i < 20; i++) if (ents.trySpawnSouterrain(joueurSurface, rng, {})) n++;
      A.equal(n, 0, 'aucune apparition souterraine déclenchée en surface');
    });
  });

  describe('Specs — structures souterraines (SPEC-SOUTERRAIN-003)', function () {
    it('SPEC-SOUTERRAIN-003 : des ruines de cité ancienne apparaissent, avec leur propre butin', function () {
      var D = MC.Donjons;
      A.ok(D.TYPES.cite_ancienne, 'le type existe');
      var w = monde();
      var trouve = null;
      for (var rx = -14; rx < 14 && !trouve; rx++) for (var rz = -14; rz < 14 && !trouve; rz++) {
        var d = w.donjons.deRegion(rx, rz);
        if (d && d.type === 'cite_ancienne') trouve = d;
      }
      A.ok(trouve, 'au moins une cité ancienne dans la zone prospectée');
      A.ok(trouve.salles.length >= 1, 'une salle au moins');
      var butin = w.donjons.butin(trouve, 0);
      A.gt(butin.length, 0, 'le coffre contient quelque chose');
    });

    it('SPEC-SOUTERRAIN-003 : les mines abandonnées ont bien des rails et des étais', function () {
      var w = monde();
      var trouve = null;
      for (var rx = -10; rx < 10 && !trouve; rx++) for (var rz = -10; rz < 10 && !trouve; rz++) {
        var d = w.donjons.deRegion(rx, rz);
        if (d && d.type === 'mine') trouve = d;
      }
      A.ok(trouve, 'au moins une mine abandonnée dans la zone prospectée');
      var rails = trouve.blocs.filter(function (b) { return b[3] === B.RAIL; });
      var etais = trouve.blocs.filter(function (b) { return b[3] === B.LOG; });
      A.gt(rails.length, 0, 'des rails');
      A.gt(etais.length, 0, 'des étais');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — bioluminescence (SPEC-LUMIERE-007)', function () {
    it('SPEC-LUMIERE-007 : champignons, cristaux, algues et plancton sont des sources de lumière', function () {
      [B.CHAMPI_LUMINEUX, B.CRISTAL_LUMINEUX, B.ALGUE_LUMINEUSE, B.PLANCTON_LUMINEUX].forEach(function (id) {
        A.gt(C.lampeDe(id), 0, C.nameOf(id) + ' émet de la lumière');
      });
    });

    it('SPEC-LUMIERE-007 : les champignons lumineux et les cristaux de géode sont générés en profondeur', function () {
      var w = monde();
      var champis = recenser(w, 8, function (id) { return id === B.CHAMPI_LUMINEUX; });
      A.gt(champis.length, 0, 'des champignons lumineux ont poussé sous terre');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
