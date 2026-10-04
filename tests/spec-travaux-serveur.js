/* spec-travaux-serveur.js — les travaux longs du serveur découpés sous un
   budget de temps par tic (src/travaux-serveur.js) : génération de chunks par
   tranches de colonnes, préparation des lieux, des routes et des naissances de
   cyclones par petites étapes, sérialisation de la sauvegarde par tranches,
   attente d'un joueur dont le sol n'est pas encore généré. Mesure sur un vrai
   serveur : tests/integration-archi-tics.js et tools/mesure-tics.js.

   Règle d'or : la découpe ne change JAMAIS le résultat — mêmes blocs (hash de
   chunks figés AVANT le découpage, sur quatre graines), même lieu, même
   texte de sauvegarde que JSON.stringify. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var TS = MC.TravauxServeur;

  function fnv(h, arr) {
    if (!arr) return h;
    for (var i = 0; i < arr.length; i++) {
      h ^= arr[i] & 0xff; h = Math.imul(h, 16777619) >>> 0;
      h ^= (arr[i] >>> 8) & 0xff; h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
  }
  function empreinte(ch) {
    var h = 2166136261;
    h = fnv(h, ch.blocks); h = fnv(h, ch.etats); h = fnv(h, ch.eau.nature); h = fnv(h, ch.eau.flux); h = fnv(h, ch.eau.prof);
    return h.toString(16);
  }
  function horlogeFactice() { var t = 0; var f = function () { return t; }; f.avancer = function (ms) { t += ms; }; return f; }
  /* Empreintes relevées avec src/world.js AVANT le découpage en tranches (commit
     436e31c), avec les modules de ce banc (tests/sources-node.js, MC.Eau compris) :
     [cx, cz, empreinte, lumières enregistrées]. Le dernier chunk de
     chaque graine est celui du premier lieu habité à moins de 600 blocs du point
     d'apparition (lieux, routes, états de bloc). */
  var REFERENCE = {
    7: [[0, 0, '8b45d14b', 4], [-1, -12, '77386bce', 5], [37, -12, '8237b9b8', 23], [-80, 45, 'c2035fe3', 23], [150, 150, '451de95e', 23], [10, -22, '5bca1605', 63]],
    4242: [[0, 0, '7a71105d', 25], [-2, 0, '8346ecc', 50], [37, -12, 'a859145c', 57], [-80, 45, '1560c1d2', 57], [150, 150, 'aaa6f2d0', 57], [-12, 15, '3bf96d8a', 60]],
    99991: [[0, 0, '60a3ee07', 2], [-1, 10, 'e2f9b02a', 3], [37, -12, '2f1e63f0', 11], [-80, 45, '1a5e9649', 14], [150, 150, '63b50a80', 14], [-17, 25, 'a6fc27c9', 40]],
    20260921: [[0, 0, 'b4092a2c', 17], [0, 3, 'c0e165a3', 17], [37, -12, '985b85a0', 44], [-80, 45, '4140b2c2', 44], [150, 150, '3a0d097a', 45], [-16, 14, '54e49b8b', 49]],
  };

  describe('Travaux du serveur sous budget par tic — génération, lieux, sauvegarde, attente du sol', {
    teste: 'La génération de chunk par tranches de colonnes (world.tacheGenerationBrute), la file de génération du serveur (MC.TravauxServeur.creerFileChunks : urgents d\'abord, budget tenu), le préparateur d\'étapes, la recherche des régions de lieux et des naissances de cyclones par étapes, la sérialisation de sauvegarde par tranches sur un instantané, et l\'attente d\'un joueur sans sol (MC.Synchro.patienterEntrees).',
    pourquoi: 'Le serveur se bloquait 0,6 à 0,9 s à l\'arrivée d\'un joueur et produisait des tics de 100 à 600 ms en marchant (mesuré par tools/mesure-tics.js) : ces travaux sont désormais découpés sous un budget par tic. Le découpage ne doit changer aucun résultat du monde — c\'est ce que ces tests figent, hash de chunks de référence compris.',
    attendu: 'mêmes chunks que la génération d\'un bloc (empreintes figées sur quatre graines), mêmes lieux, même texte de sauvegarde que JSON.stringify malgré des modifications pendant la sérialisation, budgets respectés sur une horloge factice, et rattrapage exact des entrées après l\'attente du sol.',
  }, function () {

    it('SPEC-PERF-004 : la génération par tranches (une colonne par pas) redonne les chunks de référence d\'avant le découpage, sur quatre graines', function () {
      Object.keys(REFERENCE).forEach(function (g) {
        var w = MC.createWorld(+g);
        REFERENCE[g].forEach(function (r) {
          var t = w.tacheGenerationBrute(r[0], r[1]);
          var pas = 0;
          while (!t.avancer(0, function () { return 1; })) pas++;
          A.ok(pas >= 256, 'graine ' + g + ' : le chunk (' + r[0] + ',' + r[1] + ') s\'est fait en ' + (pas + 1) + ' pas (une colonne par pas)');
          var ch = w.integrerChunk(r[0], r[1], t.resultat());
          A.equal(empreinte(ch), r[2], 'graine ' + g + ' : chunk (' + r[0] + ',' + r[1] + ') identique à la référence');
          A.equal(w.lights.size, r[3], 'graine ' + g + ' : lumières enregistrées identiques après (' + r[0] + ',' + r[1] + ')');
        });
      });
    });

    it('SPEC-PERF-004 : getChunk (génération d\'un bloc) redonne aussi les chunks de référence', function () {
      var w = MC.createWorld(4242);
      REFERENCE[4242].slice(0, 3).forEach(function (r) {
        A.equal(empreinte(w.getChunk(r[0], r[1], true)), r[2], 'chunk (' + r[0] + ',' + r[1] + ')');
      });
    });

    it('SPEC-PERF-004 : l\'index des modifications par chunk (definirIndexOverrides) applique exactement les mêmes blocs et états', function () {
      function avecModifs(w) {
        for (var i = 0; i < 300; i++) w.overrides.set(w.key3(i * 7 % 64 - 20, 30 + i % 20, i * 13 % 64 - 20), 1 + i % 5);
        for (var j = 0; j < 50; j++) w.etatsOverrides.set(w.key3(j * 3 % 48 - 10, 31, j * 5 % 48 - 10), 1 + j % 3);
        return w;
      }
      var a = avecModifs(MC.createWorld(7)), b = avecModifs(MC.createWorld(7));
      var index = { blocs: new Map(), etats: new Map() };
      function indexer(map, idx) {
        map.forEach(function (v, k) {
          var p = k.split(','), c = Math.floor(+p[0] / 16) + ',' + Math.floor(+p[2] / 16);
          if (!idx.has(c)) idx.set(c, new Set());
          idx.get(c).add(k);
        });
      }
      indexer(b.overrides, index.blocs); indexer(b.etatsOverrides, index.etats);
      b.definirIndexOverrides(function (cx, cz, quoi) { return index[quoi].get(cx + ',' + cz); });
      [[-2, -2], [-1, 0], [0, 1], [2, 2], [5, 5]].forEach(function (c) {
        var ca = a.getChunk(c[0], c[1], true), cb = b.getChunk(c[0], c[1], true);
        A.equal(empreinte(cb), empreinte(ca), 'chunk (' + c[0] + ',' + c[1] + ') : blocs et états identiques avec et sans index');
      });
    });

    it('SPEC-PERF-005 : la file de génération sert d\'abord les chunks urgents, puis du plus proche au plus lointain, et rend la main à l\'échéance', function () {
      var w = MC.createWorld(99991);
      var f = TS.creerFileChunks(w);
      var h = horlogeFactice();
      // chaque colonne « coûte » 0,1 ms sur l'horloge factice
      var tacheOrig = w.tacheGenerationBrute;
      w.tacheGenerationBrute = function (cx, cz) {
        var t = tacheOrig(cx, cz);
        return { avancer: function (e, hor) { return t.avancer(e, function () { h.avancer(0.1); return hor(); }); }, resultat: t.resultat };
      };
      f.vouloir(w.chunksVoulus([[40, 40]], 1));
      A.equal(f.restants, 5, 'cinq chunks voulus (rayon 1)');
      var urgent = [[60, 60]];
      var n = f.travailler(urgent, h() + 3, h);
      A.equal(n, 0, 'trois millisecondes ne suffisent pas pour un chunk (25,6 ms de colonnes)');
      A.ok(h() >= 3 && h() < 3.2, 'la main est rendue à l\'échéance (' + h().toFixed(2) + ' ms)');
      A.equal(f.enCours, 1, 'le chunk entamé est gardé pour le tic suivant');
      f.travailler(urgent, h() + 30, h);
      A.ok(!!w.chunkDe(60, 60), 'le chunk urgent est généré en premier');
      A.ok(!w.chunkDe(40, 40), 'les autres attendent');
      A.equal(f.manquants(urgent), 0, 'plus aucun urgent manquant');
      f.travailler([], h() + 30, h);
      A.ok(!!w.chunkDe(40, 40), 'puis le plus proche du centre');
      f.vouloir([]);
      A.equal(f.enCours, 0, 'une tâche qui n\'est plus voulue est abandonnée');
      A.equal(f.integres, 2, 'deux chunks intégrés');
    });

    it('SPEC-PERF-005 : le sol d\'un joueur, ce sont les 3×3 chunks autour de lui (chunksDuSol)', function () {
      var s = TS.chunksDuSol(-1, 33);
      A.equal(s.length, 9);
      A.deep(s[0], [-1, 2], 'son propre chunk d\'abord');
      A.ok(s.some(function (c) { return c[0] === -2 && c[1] === 1; }) && s.some(function (c) { return c[0] === 0 && c[1] === 3; }), 'les huit voisins');
    });

    it('SPEC-PERF-005 : le préparateur exécute ses étapes sous budget, reprend où il s\'était arrêté et accepte des étapes ajoutées', function () {
      var p = TS.creerPreparateur(), h = horlogeFactice(), faites = [];
      function etape(n) { return function () { faites.push(n); h.avancer(1); if (n === 2) return [etape(10), etape(11)]; }; }
      p.lancer([etape(1), etape(2), etape(3)]);
      A.ok(p.actif, 'actif après lancement');
      A.equal(p.avancer(h() + 2, h), false, 'deux étapes dans un budget de 2 ms');
      A.deep(faites, [1, 2]);
      A.equal(p.restantes, 3, 'l\'étape 3 et les deux ajoutées restent');
      A.equal(p.avancer(h() + 100, h), true, 'puis tout le reste');
      A.deep(faites, [1, 2, 3, 10, 11]);
      A.ok(!p.actif, 'inactif une fois fini');
    });

    it('SPEC-PERF-004 : les régions d\'une zone (regionsDansZone) donnent, construites une à une, exactement les lieux de lieuxProches', function () {
      var w = MC.createWorld(20260921);
      var sp = w.findSpawnColumn();
      var zone = [sp[0] - 400, sp[1] - 400, sp[0] + 400, sp[1] + 400];
      var regions = w.habitats.regionsDansZone(zone[0], zone[1], zone[2], zone[3]);
      A.ok(regions.length > 10, 'des régions de plusieurs genres (' + regions.length + ')');
      var vus = [];
      regions.forEach(function (r) {
        var l = w.habitats.lieuDeRegion(r[0], r[1], r[2]);
        if (l && !(l.x + l.demi < zone[0] || l.x - l.demi > zone[2] || l.z + l.demi < zone[1] || l.z - l.demi > zone[3])) vus.push(l.id);
      });
      var attendus = w.habitats.lieuxDansZone(zone[0], zone[1], zone[2], zone[3]).map(function (l) { return l.id; });
      A.deep(vus, attendus, 'mêmes lieux, même ordre');
    });

    it('SPEC-PERF-004 : les naissances de cyclones préparées par tranches (preparerGenesesCyclones) sont celles calculées d\'un coup', function () {
      var w1 = MC.createWorld(4242), w2 = MC.createWorld(4242);
      var t = 20000;
      var epoques = w2.meteo.epoquesCyclones(t);
      A.ok(epoques.length >= 2, 'les fenêtres consultées plus la suivante (' + epoques.join(',') + ')');
      var h = horlogeFactice(), pas = 0;
      epoques.forEach(function (e) {
        while (!w2.meteo.preparerGenesesCyclones(e, h() + 1, function () { h.avancer(0.5); return h(); })) pas++;
      });
      A.ok(pas > epoques.length, 'la préparation s\'est faite en plusieurs tranches (' + pas + ')');
      A.equal(JSON.stringify(w2.meteo.cyclones(t)), JSON.stringify(w1.meteo.cyclones(t)), 'mêmes cyclones à l\'instant t');
    });

    it('SPEC-SERVEUR-004 : la sérialisation par tranches écrit exactement JSON.stringify de l\'état, même modifié pendant qu\'elle avance (instantané)', function () {
      var ov = new Map(), et = new Map();
      for (var i = 0; i < 5000; i++) ov.set((i % 97 - 40) + ',' + (i % 60) + ',' + (Math.floor(i / 97) - 20), i % 300);
      for (var j = 0; j < 700; j++) et.set(j + ',' + (j % 7) + ',-' + j, 1 + j % 15);
      function etatComplet() {
        var o = [], e = [];
        ov.forEach(function (v, k) { var p = k.split(','); o.push([+p[0], +p[1], +p[2], v]); });
        et.forEach(function (v, k) { var p = k.split(','); e.push([+p[0], +p[1], +p[2], v]); });
        return { v: 2, graine: 7, heure: 12.5, overrides: o, etats: e, crops: [[1, 2, 3, 0.5]], joueurs: [['a', { x: 1 }]], extras: null };
      }
      var attendu = JSON.stringify(etatComplet());
      var tete = { v: 2, graine: 7, heure: 12.5, overrides: TS.MARQUE + 'overrides', etats: TS.MARQUE + 'etats', crops: [[1, 2, 3, 0.5]], joueurs: [['a', { x: 1 }]], extras: null };
      var ser = TS.creerSerialiseur(tete, [{ nom: 'overrides', map: ov }, { nom: 'etats', map: et }], { maxParPas: 100 });
      var h = horlogeFactice(), tranches = 0;
      while (!ser.avancer(h() + 1, function () { h.avancer(0.6); return h(); })) {
        tranches++;
        if (tranches === 3) {
          // le monde change pendant la sérialisation : annoncé AVANT chaque écriture
          ['0,0,-20', '5,5,5', '-40,0,-20'].forEach(function (k) { ser.avantModification('overrides', k); });
          ov.set('0,0,-20', 999); ov.set('5,5,5', 1); ov.delete('-40,0,-20');
          ser.avantModification('etats', '3,3,-3'); et.delete('3,3,-3');
        }
      }
      A.ok(tranches > 10, 'plusieurs tranches (' + tranches + ')');
      A.equal(ser.morceaux().join(''), attendu, 'texte identique à JSON.stringify de l\'état au début de la sérialisation');
      A.equal(TS.entreeJSON('1,-2,3', 7), JSON.stringify([1, -2, 3, 7]), 'une entrée écrite comme JSON.stringify');
      A.equal(TS.entreeJSON('1,2,3', undefined), '[1,2,3,null]', 'valeur absente : null, comme JSON.stringify');
      A.ok(TS.BUDGETS.TRANCHE_SAUVEGARDE_MS > 0 && TS.BUDGETS.TRANCHE_SAUVEGARDE_MS < TS.BUDGETS.TIC_MS, 'budget de tranche documenté, sous le budget de tic');
    });

    it('SPEC-SYNC-004 : un joueur sans sol attend (patienterEntrees) — rien n\'est rejoué, puis il rattrape exactement ses entrées, sans en gagner', function () {
      var w = MC.createWorld(7);
      var file = [], budget = MC.Synchro.creerBudget();
      // des durées exactes en binaire (1/64 s) : la somme des entrées vaut 2 s au bit près
      for (var i = 1; i <= 128; i++) MC.Synchro.empilerEntree(file, { s: i, dt: 1 / 64, k: 1, yaw: 0, pitch: 0, v: 0 });
      // deux secondes d'attente : crédit borné par la durée des entrées en file (2 s)
      for (var t = 0; t < 128; t++) MC.Synchro.patienterEntrees(file, budget, 1 / 64);
      A.equal(file.length, 128, 'aucune entrée consommée pendant l\'attente');
      A.ok(Math.abs(budget.credit - 2) < 1e-6, 'crédit = durée des entrées qui attendent (' + budget.credit.toFixed(3) + ')');
      for (var u = 0; u < 640; u++) MC.Synchro.patienterEntrees(file, budget, 1 / 64);
      A.ok(budget.credit <= 2 + 1e-6, 'jamais plus que la durée des entrées en file, même après 10 s');
      var sp = w.findSpawnColumn();
      for (var cx = -1; cx <= 1; cx++) for (var cz = -1; cz <= 1; cz++) w.getChunk(Math.floor(sp[0] / 16) + cx, Math.floor(sp[1] / 16) + cz, true);
      var j = MC.createPlayer(w, MC.createEntities(w));
      j.state.pos.x = sp[0] + 0.5; j.state.pos.z = sp[1] + 0.5; j.state.pos.y = w.groundAt(sp[0], sp[1], true) + 1.2;
      var r = MC.Synchro.avancerEntrees(j, file, budget, 1 / 64, 0);
      A.equal(r.dernier, 128, 'au retour du sol, toutes les entrées en attente sont rejouées d\'un coup');
      A.equal(file.length, 0);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
