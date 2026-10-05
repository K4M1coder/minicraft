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
     d'apparition (lieux, routes, états de bloc).
     Relevé de nouveau, d'un bloc (getChunk) ET par tranches, à l'arrivée des
     structures souterraines (SPEC-SOUTERRAIN-003), des lichens des grottes
     humides et des algues des abysses (SPEC-LUMIERE-007) : changent 7 (0,0),
     (37,-12), (10,-22) ; 4242 (0,0), (-2,0) ; 99991 (0,0), (37,-12), (-17,25) ;
     20260921 (0,0), (37,-12), (150,150) — et seulement aux cases nouvelles
     (preuve masquée : tests/spec-souterrain.js, EMPREINTES_L35). Les lumières
     enregistrées augmentent d'autant (algues et lichens luisent). */
  var REFERENCE = {
    7: [[0, 0, '1f260416', 13], [-1, -12, '77386bce', 14], [37, -12, '617673f5', 32], [-80, 45, 'c2035fe3', 32], [150, 150, '451de95e', 32], [10, -22, 'b0df4830', 72]],
    4242: [[0, 0, '32d4602d', 25], [-2, 0, '6f99f929', 50], [37, -12, 'a859145c', 57], [-80, 45, '1560c1d2', 57], [150, 150, 'aaa6f2d0', 57], [-12, 15, '3bf96d8a', 60]],
    99991: [[0, 0, '9cd9a29a', 7], [-1, 10, 'e2f9b02a', 8], [37, -12, '375389d9', 16], [-80, 45, '1a5e9649', 19], [150, 150, '63b50a80', 19], [-17, 25, '917b1571', 45]],
    20260921: [[0, 0, '961e68e9', 18], [0, 3, 'c0e165a3', 18], [37, -12, 'f92dd2c1', 45], [-80, 45, '4140b2c2', 45], [150, 150, '310ae2cf', 46], [-16, 14, '54e49b8b', 50]],
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

    it('SPEC-SYNC-004 : un joueur mort pendant l\'attente de son sol perd ses entrées, et rien ne s\'accumule (comme avancerEntrees)', function () {
      var file = [], budget = MC.Synchro.creerBudget();
      for (var i = 1; i <= 300; i++) MC.Synchro.empilerEntree(file, { s: i, dt: 1 / 64, k: 1, yaw: 0, pitch: 0, v: 0 });
      for (var t = 0; t < 600; t++) MC.Synchro.patienterEntrees(file, budget, 1 / 64, true);
      A.equal(file.length, 0, 'entrées jetées');
      A.ok(budget.credit <= MC.Synchro.RESERVE * 2 + 1e-9, 'crédit borné à la réserve (' + budget.credit + ')');
    });

    it('SPEC-PERF-004 : génération entrelacée dans un ordre mélangé (tâches avancées à tour de rôle, une colonne à la fois) = génération séquentielle, chunk par chunk', function () {
      var liste = [];
      for (var cx = -3; cx <= 2; cx++) for (var cz = -1; cz <= 0; cz++) liste.push([cx * 3 + 1, cz * 5 + 2]);
      var a = MC.createWorld(99991), b = MC.createWorld(99991);
      var attendus = liste.map(function (c) { return empreinte(a.getChunk(c[0], c[1], true)); });
      // ordre mélangé, déterministe
      var ordre = liste.map(function (c, i) { return { c: c, i: i, k: (i * 7919) % 13 }; }).sort(function (x, y) { return x.k - y.k; });
      var taches = ordre.map(function (o) { return { o: o, t: b.tacheGenerationBrute(o.c[0], o.c[1]), fini: false }; });
      var restants = taches.length, tours = 0;
      while (restants > 0) {
        tours++;
        taches.forEach(function (x) {
          if (x.fini) return;
          if (x.t.avancer(0, function () { return 1; })) {
            x.fini = true; restants--;
            b.integrerChunk(x.o.c[0], x.o.c[1], x.t.resultat());
          }
        });
      }
      A.ok(tours > 200, 'les générations se sont vraiment entrelacées (' + tours + ' tours)');
      liste.forEach(function (c, i) { A.equal(empreinte(b.chunkDe(c[0], c[1])), attendus[i], 'chunk (' + c[0] + ',' + c[1] + ') identique'); });
      A.equal(b.lights.size, a.lights.size, 'mêmes lumières enregistrées');
    });

    /* Un faux habitats.js : une région de maison tous les 72 blocs, un lieu une région
       sur cinq, chaque construction « coûte » coutMs sur l'horloge factice — et AUCUN
       cache (le pire cas : celui de habitats.js déborde quand les joueurs sont dispersés). */
    function habitatsFactices(h, coutMs, compte) {
      return {
        regionsDansZone: function (x0, z0, x1, z1) {
          var out = [];
          for (var rx = Math.floor(x0 / 72); rx <= Math.floor(x1 / 72); rx++) for (var rz = Math.floor(z0 / 72); rz <= Math.floor(z1 / 72); rz++) out.push(['maison', rx, rz]);
          return out;
        },
        lieuDeRegion: function (k, rx, rz) {
          h.avancer(coutMs); compte.n++;
          return ((rx * 7 + rz * 3) % 5 + 5) % 5 === 0 ? { id: 'm' + rx + ',' + rz, kind: 'maison', x: rx * 72 + 36, z: rz * 72 + 36, demi: 5 } : null;
        },
      };
    }
    /* La logique d'entretien du serveur (entretienDuMonde + travauxDuTic), jouée sur
       `cadences` secondes à 60 tics, avec une génération de chunks qui prend TOUT son
       budget à chaque tic (un joueur qui vole sans arrêt sur du terrain neuf). */
    function simulerEntretien(nJoueurs, cadences) {
      var h = horlogeFactice(), compte = { n: 0 };
      var cyc = TS.creerCycleLieux(habitatsFactices(h, 0.3, compte));
      var fileAffamante = { manquants: function () { return 0; }, travailler: function (u, e, hor) { while (hor() < e) h.avancer(0.5); return 1; } };
      var joueurs = [];
      for (var i = 0; i < nJoueurs; i++) joueurs.push({ x: (i % 4) * 5000, z: Math.floor(i / 4) * 5000 });
      var executions = [];
      for (var c = 0; c < cadences; c++) {
        if (cyc.pret) { cyc.consommer(); executions.push(c); }
        if (!cyc.actif && !cyc.pret) { cyc.demarrer(joueurs, 1500, null); cyc.avancer(h() + TS.BUDGETS.PREPARATION_MIN_MS, h); }
        for (var t = 0; t < 60; t++) {
          TS.travaillerTic(fileAffamante, [], [cyc], h, TS.BUDGETS);
          joueurs.forEach(function (p) { p.x += 8 / 60; });      // course : 8 blocs par seconde
        }
      }
      return { executions: executions, constructions: compte.n };
    }

    it('SPEC-PERF-005 : vivacité de l\'entretien du monde — 1, 3, 8 et 16 joueurs dispersés, génération de chunks affamante : politique, caravanes et catastrophes s\'exécutent à une cadence bornée', function () {
      [1, 3, 8, 16].forEach(function (n) {
        // première préparation : n × ~1764 régions × 0,3 ms, au moins PREPARATION_MIN_MS par tic
        var premiere = Math.ceil(n * 1764 * 0.3 / (60 * TS.BUDGETS.PREPARATION_MIN_MS)) + 3;
        var r = simulerEntretien(n, premiere + 30);
        A.ok(r.executions.length > 0 && r.executions[0] <= premiere, n + ' joueur(s) : premier entretien à la cadence ' + r.executions[0] + ' (borne ' + premiere + ')');
        var ensuite = r.executions.filter(function (c) { return c > premiere; });
        A.ok(ensuite.length >= 14, n + ' joueur(s) : ensuite au moins une fois toutes les deux cadences (' + ensuite.length + ' en 30)');
        // régime établi (les régions neuves de la course seulement) : jamais plus de 2 cadences d'écart
        var etabli = r.executions.filter(function (c) { return c > premiere + 10; });
        for (var k = 1; k < etabli.length; k++) A.ok(etabli[k] - etabli[k - 1] <= 2, n + ' joueur(s) : en régime établi, au plus 2 cadences entre deux entretiens (' + etabli.join(',') + ')');
      });
    });

    it('SPEC-PERF-005 : une préparation active garde sa réserve (PREPARATION_MIN_MS) même quand la génération de chunks a pris tout le budget du tic', function () {
      var h = horlogeFactice(), recu = [];
      var file = { manquants: function () { return 1; }, travailler: function (u, e, hor) { while (hor() < e) h.avancer(1); return 0; } };
      var prep = { actif: true, avancer: function (e, hor) { recu.push(e - hor()); return false; } };
      var inactif = { actif: false, avancer: function () { throw new Error('une préparation inactive ne travaille pas'); } };
      var r = TS.travaillerTic(file, [[0, 0]], [prep, inactif, null], h, TS.BUDGETS);
      A.ok(r.urgence, 'sol manquant : budget urgent');
      A.ok(h() >= TS.BUDGETS.URGENT_MS, 'la génération a pris tout son budget (' + h() + ' ms)');
      A.equal(recu.length, 1);
      A.ok(recu[0] >= TS.BUDGETS.PREPARATION_MIN_MS - 1e-9, 'la préparation reçoit encore ' + recu[0] + ' ms');
    });

    it('SPEC-PERF-004 : les lieux préparés par un cycle (lire) donnent exactement les lieuxProches d\'un appel direct, sans rien reconstruire ensuite', function () {
      var w = MC.createWorld(20260921);
      var sp = w.findSpawnColumn();
      var cyc = TS.creerCycleLieux(w.habitats);
      cyc.demarrer([{ x: sp[0], z: sp[1] }], 700, function (lire, positions) { return [function () { A.equal(positions.length, 1); }]; });
      var n = 0;
      while (!cyc.avancer(Date.now() + 1, function () { return Date.now(); })) n++;
      A.ok(cyc.pret && !cyc.actif, 'cycle prêt');
      A.ok(cyc.taille > 50, 'régions gardées (' + cyc.taille + ')');
      var directs = w.habitats.lieuxProches(sp[0], sp[1], 700).map(function (l) { return l.id; });
      var lus = w.habitats.lieuxProches(sp[0], sp[1], 700, cyc.lire).map(function (l) { return l.id; });
      A.deep(lus, directs, 'mêmes lieux, même ordre');
      var pos = cyc.consommer();
      A.ok(!cyc.pret && pos && pos[0].x === sp[0], 'consommer rend les positions du cycle et revient au repos');
      A.equal(cyc.cycles, 1);
      // un second cycle aux mêmes positions n'a plus rien à construire
      cyc.demarrer([{ x: sp[0], z: sp[1] }], 700, null);
      A.equal(cyc.restantes, 0, 'rien à reconstruire au cycle suivant');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
