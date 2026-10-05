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

  describe('Specs — structures propres à chaque biome souterrain (SPEC-SOUTERRAIN-003)', {
    teste: 'Les structures souterraines (MC.Souterrain.creerStructures) : un donjon propre, des ruines d\'ancienne cité et une mine abandonnée pour chaque biome souterrain, dans ses matériaux, générées dans le monde.',
    pourquoi: 'Avant, seules les structures de surface (donjons choisis d\'après le biome de surface) existaient ; aucune ne dépendait du biome souterrain où elle se trouve.',
    attendu: 'chaque biome souterrain a ses trois genres de structures, bâtis dans ses matériaux, générés là où ce biome se trouve, avec rails et étais pour les mines.',
  }, function () {
    var S = Souterrain;
    var BIOMES_SOUS = ['geode', 'chambre_magmatique', 'luxuriante', 'englouties', 'abime', 'grotte'];
    var mondeS = null;
    function structuresDuMonde() {
      if (!mondeS) {
        var w = MC.createWorld(GRAINE);
        mondeS = { w: w, liste: w.structuresSouterraines.dansZone(-6000, -6000, 6000, 6000) };
      }
      return mondeS;
    }

    it('SPEC-SOUTERRAIN-003 : chaque biome souterrain a son donjon, ses ruines et sa mine, bâtis dans ses matériaux', function () {
      A.deep(S.GENRES, ['donjon', 'ruines', 'mine'], 'trois genres : donjon propre, ruines d\'une ancienne cité, mine abandonnée');
      BIOMES_SOUS.forEach(function (b) {
        A.ok(S.STRUCTURES[b], b + ' a ses structures');
        var noms = S.GENRES.map(function (g) { return S.structurePour(b, g).nom; });
        A.equal(new Set(noms).size, 3, b + ' : trois structures distinctes (' + noms.join(', ') + ')');
        var m = S.materiaux(b), st = S.structurePour(b, 'donjon');
        A.equal(st.sol, m.sol, b + ' : le sol du biome');
        if (b !== 'englouties' && b !== 'grotte') A.equal(st.mur, m.mur, b + ' : le mur du biome');
        A.ok(st.lumiere, b + ' : une lumière');
      });
      // les noms d'un biome ne sont pas ceux d'un autre : des structures PROPRES à chacun
      var tous = [];
      BIOMES_SOUS.forEach(function (b) { S.GENRES.forEach(function (g) { tous.push(S.structurePour(b, g).nom); }); });
      A.equal(new Set(tous).size, tous.length, 'dix-huit structures, toutes différentes');
      A.ok(S.structurePour('englouties', 'ruines').noye, 'la cité engloutie est noyée');
    });

    it('SPEC-SOUTERRAIN-003 : dans un monde généré, chaque biome souterrain a ses structures, là où il se trouve, sous terre @lent', function () {
      var m = structuresDuMonde(), w = m.w;
      var vus = {};
      m.liste.forEach(function (st) {
        vus[st.biome] = vus[st.biome] || {};
        vus[st.biome][st.genre] = (vus[st.biome][st.genre] || 0) + 1;
      });
      BIOMES_SOUS.forEach(function (b) { A.ok(vus[b], 'des structures sous le biome ' + b + ' : ' + JSON.stringify(vus[b] || {})); });
      ['geode', 'luxuriante', 'englouties', 'abime', 'grotte'].forEach(function (b) {
        S.GENRES.forEach(function (g) { A.ok(vus[b] && vus[b][g], b + ' : au moins un(e) ' + g + ' sur ±6 km'); });
      });
      // chaque structure est dans le biome souterrain qui la porte, et sous terre (ou sous le fond de la mer)
      m.liste.slice(0, 400).forEach(function (st) {
        var bio = w.biomeAt(st.x, st.z);
        A.equal(S.biomeAt(bio.id, st.y, !!bio.marin), st.biome, st.nom + ' en ' + st.x + ',' + st.y + ',' + st.z);
        var haut = Math.max.apply(null, st.blocs.map(function (b) { return b[1]; }));
        A.ok(haut + 3 <= w.heightAt(st.x, st.z), st.nom + ' : du roc au-dessus (' + haut + ' sous ' + w.heightAt(st.x, st.z) + ')');
        A.ok(st.y >= 7, st.nom + ' : au-dessus des lacs de lave');
      });
      // déterministe : un monde recréé à l'identique redonne les mêmes structures
      var w2 = MC.createWorld(GRAINE), s0 = m.liste[0];
      var s1 = w2.structuresSouterraines.deRegion(Math.floor(s0.x / S.REGION_STRUCT), Math.floor(s0.z / S.REGION_STRUCT));
      A.equal(s1.nom, s0.nom, 'même structure'); A.equal(s1.blocs.length, s0.blocs.length, 'mêmes blocs');
    });

    it('SPEC-SOUTERRAIN-003 : les mines abandonnées ont rails et étais, les ruines leurs murs effondrés, la cité engloutie son eau — posés dans les chunks @lent', function () {
      var m = structuresDuMonde(), w = m.w;
      function premiere(pred) { return m.liste.filter(pred)[0]; }
      var mine = premiere(function (s) { return s.genre === 'mine' && s.biome === 'geode'; });
      A.ok(mine, 'une mine de cristal');
      var rails = mine.blocs.filter(function (b) { return b[3] === B.RAIL; });
      var poteaux = mine.blocs.filter(function (b) { return b[3] === B.LOG; });
      var poutres = mine.blocs.filter(function (b) { return b[3] === B.PLANKS; });
      A.gt(rails.length, 40, 'des rails le long des galeries (' + rails.length + ')');
      A.gt(poteaux.length, 16, 'des étais : leurs poteaux (' + poteaux.length + ')');
      A.gt(poutres.length, 8, 'et leurs poutres (' + poutres.length + ')');
      A.ok(mine.blocs.some(function (b) { return b[3] === B.MINERAI_CRISTAL; }), 'du minerai de cristal dans les parois');
      // posés pour de vrai dans les chunks générés (hors ce qu'un donjon de surface aurait écrasé)
      mine.parChunk.forEach(function (l, k) { var p = k.split(','); w.getChunk(+p[0], +p[1], true); });
      var poses = 0;
      rails.forEach(function (b) { if (w.getBlock(b[0], b[1], b[2]) === B.RAIL) poses++; });
      A.gt(poses / rails.length, 0.8, 'les rails sont dans le monde (' + poses + '/' + rails.length + ')');
      rails.forEach(function (b) { if (w.getBlock(b[0], b[1], b[2]) === B.RAIL) A.ok(C.isSolid(w.getBlock(b[0], b[1] - 1, b[2])), 'un rail posé sur un sol'); });
      var dans = w.structuresSouterraines.structureA(rails[3][0], rails[3][1], rails[3][2]);
      A.ok(dans && dans.id === mine.id, 'la galerie appartient à la mine');

      var ruines = premiere(function (s) { return s.genre === 'ruines' && s.biome === 'luxuriante'; });
      A.ok(ruines, 'des ruines envahies');
      var hauteurs = {};
      ruines.blocs.forEach(function (b) { if (b[1] > ruines.y && (b[3] === B.MOSSY_COBBLE || b[3] === S.materiaux('luxuriante').mur)) { var k = b[0] + ',' + b[2]; hauteurs[k] = Math.max(hauteurs[k] || 0, b[1] - ruines.y); } });
      var hs = Object.keys(hauteurs).map(function (k) { return hauteurs[k]; });
      A.gt(new Set(hs).size, 2, 'des murs de hauteurs inégales : effondrés par endroits');
      A.ok(ruines.blocs.some(function (b) { return b[3] === B.MOSSY_COBBLE; }), 'envahies de mousse');

      var noyee = premiere(function (s) { return s.biome === 'englouties'; });
      A.ok(noyee, 'une structure de grotte engloutie');
      var eau = noyee.blocs.filter(function (b) { return b[3] === B.WATER; }).length, air = noyee.blocs.filter(function (b) { return b[3] === 0; }).length;
      A.gt(eau, 50, 'pleine d\'eau'); A.equal(air, 0, 'sans poche d\'air');
      A.ok(noyee.blocs.some(function (b) { return b[3] === B.PRISMARINE_BRICK || b[3] === B.PRISMARINE; }), 'bâtie de prismarine');

      var donjon = premiere(function (s) { return s.genre === 'donjon' && s.biome === 'abime'; });
      A.ok(donjon, 'un autel de l\'abîme');
      A.ok(donjon.blocs.some(function (b) { return b[3] === B.OBSIDIAN; }), 'd\'obsidienne');
      A.ok(donjon.blocs.some(function (b) { return b[3] === B.CRISTAL_LUMINEUX; }), 'éclairé de cristaux');
    });
  });

  /* ─── Non-régression de la génération (SOUTERRAIN-003, LUMIERE-007) ───────
     Empreintes FNV des chunks bruts (blocs et états) sur quatre graines :
     [cx, cz, avant, après, après masqué]. « avant » : relevée au commit 43d0efb,
     avant les structures souterraines, les lichens et les algues des abysses ;
     « après » : l'état actuel. « après masqué » : la même empreinte, les cases
     des structures souterraines du chunk, des lichens et des algues
     luminescentes mises à 0 — elle était IDENTIQUE à l'empreinte masquée de la
     génération d'avant, pour chacun de ces chunks (relevé fait en chargeant les
     deux versions côte à côte) : rien d'autre n'a changé. La grille couvre
     ±6 chunks autour de l'origine (un sur trois retenu ici), la suite un chunk de
     chaque genre de structure trouvé à moins de 1 500 blocs. */
  var EMPREINTES_L35 = {
      7: [[-6, -6, '32c8d525', 'df93e985', '55fdb2cd'],
        [-6, 0, '9a2c5c6c', 'a8362ecc', '677d4ec0'],
        [-6, 6, '46e10a2', 'a8fd24c7', 'f6be5509'],
        [-4, -2, '7453293b', '815859b6', '55ae7e98'],
        [-4, 4, '3a026e44', '99e96bbc', 'a1dec9b8'],
        [-2, -4, 'd2fa24ab', '65c32fde', 'abb20ca0'],
        [-2, 2, 'ba0a0017', '65c4082f', '534f1b3'],
        [0, -6, '2b8536da', '2b8536da', '2b8536da'],
        [0, 0, '1c68d94b', 'b04efc16', '59603d04'],
        [0, 6, '304c2273', 'ffbe026b', '87a5137b'],
        [2, -2, '972f50c8', '6f3d93d', 'da4356f7'],
        [2, 4, 'ece3ee3f', 'c07efd87', '6a56d0a7'],
        [4, -4, '76b5e5e6', '6760e346', '9907267a'],
        [4, 2, 'ed353e94', 'f0c5fa1c', '162f59f8'],
        [6, -6, 'fef481b', 'fef481b', 'fef481b'],
        [6, 0, 'b78b2cae', '62a76276', '28c7cbae'],
        [6, 6, '3239ddb', '8d902f03', '631a8bcf'],
        [-93, -73, 'dafde8c6', '7f2f6ee4', '33f90384'],
        [-97, -54, '5d61a955', '86a802db', 'cd8d9bd3'],
        [-94, -45, 'c7b0a77d', '807f19ef', '2386b6f3'],
        [-94, -24, '546178ae', '23bc24eb', 'ccc407e7'],
        [-95, -4, '3e0d44a8', '501e6d66', 'd36c320'],
        [-87, -54, 'ad82a59e', '538ce9ff', 'bbab56b2'],
        [-82, -55, '8d2f7311', 'b98482ce', '9dbaba0f'],
        [-59, -67, '1638677b', 'c84ffe0a', '203b6a5c'],
        [-53, -75, '28fade06', 'b71cba79', '1ecf33dd'],
        [-46, -89, 'fd9b3c36', 'd6630ca7', '839efec3'],
        [-41, -95, 'ae6c442a', '65352d31', '73e0630e'],
        [-33, -86, 'eb18d89', 'f685fc19', '8e4bde15'],
        [-31, -27, '7a2a634a', '9219eff0', 'fffd4748'],
        [-19, -38, '7f2db11a', '17caacfb', '2417a74c'],
        [5, 57, '6e2708a7', 'd64ee823', '9b9c07d'],
        [32, -16, '371b5b1a', 'b5a68ebc', '45a1d944']],
      4242: [[-6, -6, 'a9d8429f', '5f5e4f7e', '597d29bb'],
        [-6, 0, 'edb8de95', '2d2dcf9c', '60f1a371'],
        [-6, 6, 'dec17af5', '682d48f1', '89be0ad5'],
        [-4, -2, '5ea1c903', '5ea1c903', '5ea1c903'],
        [-4, 4, 'e9a477b7', 'e9a477b7', 'e9a477b7'],
        [-2, -4, '814aedcc', '814aedcc', '814aedcc'],
        [-2, 2, 'f7933a05', 'f7933a05', 'f7933a05'],
        [0, -6, '5430d32f', '9cba0ae2', '8a7ea431'],
        [0, 0, 'a9976a0b', '7792213b', 'b6746c5b'],
        [0, 6, 'c63eaca9', 'c63eaca9', 'c63eaca9'],
        [2, -2, 'c5b771a8', '1f62fded', 'a3d364fc'],
        [2, 4, 'c520819d', 'b8c0d2cd', '1cf3612d'],
        [4, -4, '60678f1c', 'f4b6aee8', 'd0870402'],
        [4, 2, 'f46601bd', 'f46601bd', 'f46601bd'],
        [6, -6, '83917b0c', '83917b0c', '83917b0c'],
        [6, 0, 'ab2e77f8', 'ab2e77f8', 'ab2e77f8'],
        [6, 6, 'fa1749f8', 'fa1749f8', 'fa1749f8'],
        [-95, -72, 'f8a3e6a0', 'c7f40b71', '4a4753b'],
        [-95, -51, '6764f35d', 'ccb40fc', 'd49b94a1'],
        [-96, -5, '8766ce02', '42aa1d3e', '245e7255'],
        [-93, 23, 'ad95306f', '3b643c89', '76304da8'],
        [-96, 58, '6ede7680', 'c4a51912', 'a8e849db'],
        [-93, 66, '2a83d114', '16a6d819', 'b2ac893d'],
        [-88, -81, 'c44dd8da', '5f81e7b5', '3e753d8e'],
        [-87, -68, 'ca623da7', '79cbbe9', 'ca623da7'],
        [-88, -41, '54a1660d', '724434ed', '4fecd10b'],
        [-89, 9, '4d74ddb1', '2649c6b6', 'baf3643'],
        [-87, 19, 'ce851b3f', 'e7c84e3c', 'b1071fa6'],
        [-87, 82, 'c33f1df1', '40366a19', '5414b7a8'],
        [-83, 38, '83812e19', '57aea97b', '6507fa20'],
        [-79, 74, '44326052', '92a77492', 'aa4047c5'],
        [-81, 94, '5ac14045', 'f69fcd4a', 'ade39df6'],
        [-74, 25, 'a3639f14', '44194cc4', '44d60984'],
        [-66, -66, 'ee418f1e', '85e0c1f1', 'fbbc7deb']],
      99991: [[-6, -6, 'd52d2f14', 'd52d2f14', 'd52d2f14'],
        [-6, 0, '232167d3', 'cea9aa5e', '5ecdc3ac'],
        [-6, 6, 'ebb75a5b', 'ebb75a5b', 'ebb75a5b'],
        [-4, -2, 'f824cc94', 'eb9f3c99', 'f43b8977'],
        [-4, 4, 'b2ca118e', '1876215b', '6f5865a1'],
        [-2, -4, '2a2c5be0', '74cf0fa5', '4e2971bf'],
        [-2, 2, '393ac2e', '5897cc16', '71dfd73a'],
        [0, -6, 'f7714877', '7b6aaf3a', '5c7f3858'],
        [0, 0, 'f7d51607', '103d7a9a', '79919a58'],
        [0, 6, 'cf090c07', 'd056fc42', '4e368510'],
        [2, -2, 'b28e58fa', 'f08a4837', 'c7787a6d'],
        [2, 4, '366a007b', '3554fa63', '542ad0bb'],
        [4, -4, '3919d039', '3919d039', '3919d039'],
        [4, 2, 'b7020677', '1df302da', 'a20cb74c'],
        [6, -6, 'a61b96f4', '6ec5c861', '70f9df3b'],
        [6, 0, '3bd48ed8', '72dbdcf8', '4df4b8fc'],
        [6, 6, 'c7dce1b9', '18909411', '3ae2f3a5'],
        [-94, -59, 'ec53c495', 'b3d0b4ca', 'f311bca'],
        [-95, -41, '6a6efe41', '7dce95b5', 'b2b047bb'],
        [-97, -33, '45fc7729', '4d499ab5', '5ac1f47d'],
        [-94, -16, '877d42d5', '1f0c9808', '48c4c8f8'],
        [-96, -13, '7b6e458a', '540739b1', '7d9373bf'],
        [-94, 26, '9904b05d', '9f3471ae', 'cf095d9c'],
        [-93, 53, '46d67c1a', '88d37bd5', '4c015b00'],
        [-95, 68, '4b10e853', '2ac1cc95', 'c0831670'],
        [-79, -41, '1249c0b0', 'cfa5db05', '6317b9be'],
        [-81, 40, 'a8a47f26', '87df4e5b', 'f4b3c357'],
        [-74, -13, '7403a0ad', '38320342', 'b08d4746'],
        [-75, 32, '3fced24a', 'd1678e17', '8420d455'],
        [-31, 81, 'eb824add', '9a105a7c', 'a31121f4'],
        [-3, -46, 'efd40440', '84be60af', 'd46feaed'],
        [16, -3, 'dedbc7e5', '2275723a', '6ad997ad']],
      20260921: [[-6, -6, '7d7c6ab3', '7d7c6ab3', '7d7c6ab3'],
        [-6, 0, '1378dab8', '1e1b8bb9', '902556d4'],
        [-6, 6, 'fb109a1d', 'fb109a1d', 'fb109a1d'],
        [-4, -2, '4864522c', '4864522c', '4864522c'],
        [-4, 4, '15b06236', '5d53c7cb', '8e863a8a'],
        [-2, -4, 'e11da058', 'e11da058', 'e11da058'],
        [-2, 2, 'b1860e64', 'b1860e64', 'b1860e64'],
        [0, -6, '778fe483', '778fe483', '778fe483'],
        [0, 0, '3757ccb6', 'ab346743', 'b3d8675f'],
        [0, 6, 'a6273ef6', 'a6273ef6', 'a6273ef6'],
        [2, -2, 'e52142d6', 'e52142d6', 'e52142d6'],
        [2, 4, 'aeb10f7f', 'aeb10f7f', 'aeb10f7f'],
        [4, -4, 'dbaafe55', 'dbaafe55', 'dbaafe55'],
        [4, 2, 'ce9d61e4', 'ce9d61e4', 'ce9d61e4'],
        [6, -6, 'bafd64b6', '44176a57', 'c6ca35da'],
        [6, 0, 'e712674b', 'e712674b', 'e712674b'],
        [6, 6, '466167fe', '466167fe', '466167fe'],
        [-94, -74, '13b5b254', 'b890cc05', '38cbb759'],
        [-94, -53, '2e9bb202', '6954a6a', '97260b36'],
        [-95, -47, 'a2bc54f8', 'a4e7ca95', 'e24c40b9'],
        [-95, -31, '4a7e254f', 'c990f9e9', 'b10e118b'],
        [-96, 9, 'a9833417', '6bed0f9f', '91a090d5'],
        [-86, -74, 'fb2f8dbb', '44df6669', 'ea61f4ea'],
        [-88, -46, 'a610295d', 'ce69d822', 'aa45af74'],
        [-89, 17, 'dffe3b97', '9ed408c2', '4e100547'],
        [-90, 31, '4531c16c', 'd0e60df0', '63318e5b'],
        [-86, 81, '6a2df273', '79f35ba0', 'd7f8bc2f'],
        [-83, 81, 'd54cf6d0', 'fed9a484', '38b814f8'],
        [-72, -97, '77294dbc', 'c9c0dc54', '9dc86b25'],
        [-69, 9, '8a10fbbb', 'b50c2db9', '15b74bb4'],
        [-66, 59, 'c08cdad1', '3c032590', '47e5f354'],
        [-61, 54, 'e7930e0a', 'a04227ea', 'de834747'],
        [-53, 37, '7f2846fa', '4d0888cc', '73205336'],
        [53, 51, '27baf9b4', 'b26dacbf', '39edf7b6']],
  };
  function fnvMasque(h, arr, masque) {
    if (!arr) return h;
    for (var i = 0; i < arr.length; i++) {
      var v = masque && masque.has(i) ? 0 : arr[i];
      h ^= v & 0xff; h = Math.imul(h, 16777619) >>> 0;
      h ^= (v >>> 8) & 0xff; h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }
  function empreinteMasquee(r, masque) {
    var h = 2166136261; h = fnvMasque(h, r.blocks, masque); h = fnvMasque(h, r.etats, masque);
    return h.toString(16);
  }
  describe('Non-régression de la génération : seules les zones des structures souterraines, des lichens et des algues des abysses changent (SPEC-SOUTERRAIN-003, SPEC-LUMIERE-007)', {
    teste: 'Les empreintes des chunks bruts sur quatre graines, entières puis masquées des seules cases nouvelles (structures souterraines, lichens, algues luminescentes).',
    pourquoi: 'La génération doit rester déterministe et ne changer QUE là où les specs le demandent : le masque prouve que le reste du chunk est identique, bloc pour bloc, à la génération précédente.',
    attendu: 'chaque chunk redonne son empreinte de référence, entière et masquée ; les chunks inchangés le restent.',
  }, function () {
    it('SPEC-SOUTERRAIN-003 / SPEC-LUMIERE-007 : empreintes de chunks sur quatre graines — identiques hors des cases nouvelles, déterministes @lent', function () {
      var changes = 0, intacts = 0;
      Object.keys(EMPREINTES_L35).forEach(function (g) {
        var w = MC.createWorld(+g);
        EMPREINTES_L35[g].forEach(function (e) {
          var t = w.tacheGenerationBrute(e[0], e[1]);
          t.avancer();
          var r = t.resultat(), masque = new Set();
          w.structuresSouterraines.dansZone(e[0] * 16, e[1] * 16, e[0] * 16 + 15, e[1] * 16 + 15).forEach(function (st) {
            (st.parChunk.get(e[0] + ',' + e[1]) || []).forEach(function (b) { masque.add(C.idx(b[0] - e[0] * 16, b[1], b[2] - e[1] * 16)); });
          });
          for (var i = 0; i < r.blocks.length; i++) if (r.blocks[i] === B.LICHEN_LUMINEUX || r.blocks[i] === B.ALGUE_LUMINEUSE) masque.add(i);
          var lieu = 'graine ' + g + ', chunk (' + e[0] + ',' + e[1] + ')';
          A.equal(empreinteMasquee(r, null), e[3], lieu + ' : empreinte de référence');
          A.equal(empreinteMasquee(r, masque), e[4], lieu + ' : hors des cases nouvelles, identique à la génération précédente');
          if (e[2] === e[3]) intacts++; else changes++;
        });
      });
      A.gt(changes, 0, 'des chunks changent (' + changes + ')');
      A.gt(intacts, 0, 'et d\'autres non (' + intacts + ')');
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

    /* Le biome souterrain d'une case générée, d'après sa colonne de surface. */
    function biomeSous(w, p) {
      var bio = w.biomeAt(p.x, p.z);
      return Souterrain.biomeAt(bio.id, p.y, !!bio.marin);
    }

    it('SPEC-LUMIERE-007 : champignons et lichens luisent dans les grottes humides, les cristaux dans les géodes — et chacun éclaire @lent', function () {
      var w = monde();
      A.gt(C.lampeDe(B.LICHEN_LUMINEUX), 0, 'le lichen luminescent est une source de lumière');
      A.ok(C.BLOCKS[B.LICHEN_LUMINEUX].plant && C.BLOCKS[B.LICHEN_LUMINEUX].needsSupport === 'sol', 'une croûte posée au sol');
      var humides = Souterrain.BIOMES.luxuriante.lumieres;
      A.ok(humides.indexOf(B.CHAMPI_LUMINEUX) >= 0 && humides.indexOf(B.LICHEN_LUMINEUX) >= 0, 'grotte humide : champignons et lichens');
      // générés là où il faut : sous les plaines et forêts (grotte luxuriante), jamais ailleurs
      var ch = chunkDuBiome(w, ['plaines', 'foret']);
      var lichens = recenser2(w, ch[0], ch[1], 6, function (id) { return id === B.LICHEN_LUMINEUX || id === B.CHAMPI_LUMINEUX; }, 400);
      var sortes = {};
      lichens.forEach(function (p) { sortes[p.id] = (sortes[p.id] || 0) + 1; });
      A.gt(sortes[B.LICHEN_LUMINEUX] || 0, 0, 'des lichens luminescents ont été générés : ' + JSON.stringify(sortes));
      A.gt(sortes[B.CHAMPI_LUMINEUX] || 0, 0, 'et des champignons lumineux');
      lichens.forEach(function (p) {
        A.equal(biomeSous(w, p), 'luxuriante', 'luminescent des grottes humides en ' + p.x + ',' + p.y + ',' + p.z);
        A.ok(C.isSolid(w.getBlock(p.x, p.y - 1, p.z)), 'posé sur un sol');
      });
      // les cristaux luisent dans les géodes (sous les montagnes)
      var mt = chunkDuBiome(w, ['montagnes', 'pics_glaces']);
      var cristaux = recenser2(w, mt[0], mt[1], 4, function (id) { return id === B.CRISTAL_LUMINEUX; }, 400);
      A.ok(cristaux.some(function (p) { return biomeSous(w, p) === 'geode'; }), 'des cristaux lumineux dans une géode');
      // chacun éclaire vraiment : la lumière propagée au maillage vaut son émission à sa case
      var p = lichens.filter(function (q) { return q.id === B.LICHEN_LUMINEUX; })[0];
      var cx = Math.floor(p.x / C.CHUNK_X), cz = Math.floor(p.z / C.CHUNK_Z);
      var chunkDe = function (a, b) { return w.getChunk(a, b, true); };
      var lum = MC.Lumiere.eclairer(chunkDe, cx, cz);
      A.ok(lum.niveau(p.x - cx * C.CHUNK_X, p.y, p.z - cz * C.CHUNK_Z) >= C.lampeDe(B.LICHEN_LUMINEUX), 'le lichen éclaire sa case (au moins son émission)');
      A.gt(lum.niveau(p.x - cx * C.CHUNK_X, p.y + 1, p.z - cz * C.CHUNK_Z), 0, 'et l\'air au-dessus');
    });

    it('SPEC-LUMIERE-007 : des algues luminescentes tapissent les fonds des abysses, pas les eaux claires @lent', function () {
      var w = monde();
      var ab = chunkDuBiome(w, ['abysses']);
      A.ok(ab, 'des abysses dans ce monde');
      var algues = recenser2(w, ab[0], ab[1], 5, function (id) { return id === B.ALGUE_LUMINEUSE; }, 400);
      var auFond = algues.filter(function (p) { return w.biomeAt(p.x, p.z).marin && p.y < C.SEA_LEVEL; });
      A.gt(auFond.length, 0, 'des algues luminescentes au fond de la mer');
      auFond.forEach(function (p) {
        var surf = p.y; while (surf < C.WORLD_H - 1 && C.isWater(w.getBlock(p.x, surf + 1, p.z))) surf++;
        // sous un bloc d'algue, le fond ; la colonne d'eau au-dessus mesure la profondeur
        var prof = surf - (p.y - 1);
        // une grotte engloutie n'a pas de colonne d'eau ouverte : on ne garde que les fonds marins
        if (surf + 1 < C.WORLD_H && w.getBlock(p.x, surf + 1, p.z) === 0 && surf === C.SEA_LEVEL) {
          A.ok(prof >= MC.Recifs.PROF_ABYSSES, 'algue des abysses à ' + prof + ' blocs de fond');
        }
      });
      A.lt(MC.Recifs.lumiereAuFond(MC.Recifs.PROF_ABYSSES), 0.25, 'là où presque plus de jour n\'arrive');
      A.equal(MC.Recifs.floreEn(B, 4, 0.7, 0.999, 0.5), null, 'en eau claire, jamais d\'algue luminescente (tirage au-delà des espèces)');
      var vues = 0;
      for (var i = 0; i < 1000; i++) {
        var f = MC.Recifs.floreEn(B, 20, 0.5, i / 1000, 0.5);
        if (f && f.id === B.ALGUE_LUMINEUSE) vues++;
      }
      A.gt(vues, 0, 'à 20 blocs de fond, l\'algue luminescente fait partie de la flore');
    });

    it('SPEC-LUMIERE-007 : la nuit, du plancton luminescent monte au-dessus des récifs des mers chaudes, et se disperse au jour @lent', function () {
      // un monde neuf : le balayage des eaux tourne sur les chunks chargés, seuls ceux du récif ici
      var w = MC.createWorld(GRAINE), DC = MC.DayCycle;
      var rc = chunkDuBiome(w, ['ocean_chaud']);
      A.ok(rc, 'un récif corallien dans ce monde');
      var recif = { 58: 1, 59: 1, 60: 1 };
      recif[B.CORAIL_BLANC] = 1;
      // les sommets de récif sous la surface, dans la zone
      for (var a = -2; a <= 2; a++) for (var b = -2; b <= 2; b++) w.getChunk(rc[0] + a, rc[1] + b, true);
      var nuit = 0, jour = DC.DAY_LENGTH * 0.25;
      for (var t = 0; t < DC.DAY_LENGTH; t += 10) if (DC.isNight(t)) { nuit = t; break; }
      A.ok(DC.isNight(nuit) && !DC.isNight(jour), 'une heure de nuit, une heure de jour');
      var poses = [];
      for (var i = 0; i < 400; i++) w.tickEauxSaison(nuit, function (x, y, z, id, e) { if (id === B.PLANCTON_LUMINEUX) poses.push([x, y, z, e]); });
      A.gt(poses.length, 0, 'du plancton est monté cette nuit');
      poses.forEach(function (p) {
        A.equal(w.getBlock(p[0], p[1], p[2]), B.PLANCTON_LUMINEUX, 'il est là');
        A.equal(p[3], 1, 'posé par la nuit (état 1)');
        A.ok(recif[w.getBlock(p[0], p[1] - 1, p[2])], 'juste au-dessus d\'un récif de corail');
        A.ok(C.isWater(w.getBlock(p[0], p[1] + 1, p[2])), 'sous l\'eau');
        A.gt(w.bio.climat(p[0], p[2]).t, 0.6 - 1e-9, 'dans une mer chaude');
      });
      A.gt(C.lampeDe(B.PLANCTON_LUMINEUX), 0, 'le plancton est une source de lumière');
      var p0 = poses[0];
      A.ok(w.lights.has(w.key3(p0[0], p0[1], p0[2])), 'et le monde l\'enregistre comme lumière');
      // au jour, il se disperse : l'eau revient, la lumière s'éteint
      for (var j = 0; j < 400; j++) w.tickEauxSaison(jour);
      poses.forEach(function (p) { A.equal(w.getBlock(p[0], p[1], p[2]), B.WATER, 'dispersé au jour'); });
      A.notOk(w.lights.has(w.key3(p0[0], p0[1], p0[2])), 'plus de lumière');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
