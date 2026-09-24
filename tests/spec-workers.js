/* spec-workers.js — B3 : génération et maillage en Web Workers (SPEC-PERF-004
   à 010, 014), testés sous Node SANS Worker : src/file-chunks.js et
   src/taches-chunks.js sont purs, exécutables tels quels ; c'est exactement
   ce que fait le repli synchrone (SPEC-PERF-006) quand `Worker` est
   indisponible — les mêmes fonctions, appelées sur le thread principal. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;

  function mondeAvecVoisinage(graine, cx, cz) {
    var w = MC.createWorld(graine);
    for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) w.getChunk(cx + dx, cz + dz, true);
    return w;
  }

  function memeTableau(a, b) {
    if (!a && !b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function eauDeSynchrone(w) {
    return function (wx, wz) {
      var c2 = w.chunkDe(Math.floor(wx / MC.Core.CHUNK_X), Math.floor(wz / MC.Core.CHUNK_Z));
      if (!c2 || !c2.eau) return null;
      var k = (wz - c2.cz * MC.Core.CHUNK_Z) * MC.Core.CHUNK_X + (wx - c2.cx * MC.Core.CHUNK_X);
      if (!c2.eau.nature[k]) return null;
      return { nature: c2.eau.nature[k], flux: { x: c2.eau.flux[k * 2] / 127, z: c2.eau.flux[k * 2 + 1] / 127 }, prof: c2.eau.prof[k] };
    };
  }

  describe('Workers — SPEC-PERF-004 à 010, 014 (B3)', {
    teste: 'Génération et maillage exécutables hors du thread principal (worker), avec un ordonnanceur pur des tâches, des résultats identiques au chemin synchrone, et une réutilisation des géométries — le tout testé sous Node, sans Worker.',
    pourquoi: 'Le résultat d\'un worker doit être identique bloc à bloc, sommet à sommet, à ce que produit le monde réel ; l\'ordonnanceur (priorités, budget, rejet des résultats périmés) est un module pur, donc vérifiable exhaustivement sans navigateur.',
    attendu: 'genererBrut/integrerChunk reconstituent le chunk exact de getChunk ; executerMaillage sur un instantané donne les mêmes sommets que buildChunk sur le monde réel ; MC.FileChunks respecte son budget d\'intégration, rejette les résultats périmés et priorise par distance.',
  }, function () {

    it('SPEC-PERF-004 : genererBrut puis integrerChunk donne exactement le chunk de getChunk (blocs, états, overrides, lumières)', function () {
      var graine = 4242, cx = 3, cz = -2;
      var lx = 4, ly = 40, lz = 5;
      var idPose = MC.Core.B.TORCH;
      var li = MC.Core.idx(lx, ly, lz);

      /* Une modification du joueur enregistrée AVANT toute génération (le cas
         d'un chunk jamais chargé, comme après un rechargement de
         sauvegarde) : `overrides`/`etatsOverrides` sont exposés tels quels
         par createWorld — même mécanisme que setBlock/setEtat, sans exiger
         que le chunk existe déjà. */
      var wRef = MC.createWorld(graine);
      wRef.overrides.set(wRef.key3(cx * MC.Core.CHUNK_X + lx, ly, cz * MC.Core.CHUNK_Z + lz), idPose);
      wRef.etatsOverrides.set(wRef.key3(cx * MC.Core.CHUNK_X + lx, ly, cz * MC.Core.CHUNK_Z + lz), 3);
      var attendu = wRef.getChunk(cx, cz, true);   // chemin synchrone habituel

      // même graine, mêmes overrides, mais reçu comme le serait un résultat
      // de worker : brut d'abord (SANS overrides ni lumières), puis intégré
      var w2 = MC.createWorld(graine);
      w2.overrides.set(w2.key3(cx * MC.Core.CHUNK_X + lx, ly, cz * MC.Core.CHUNK_Z + lz), idPose);
      w2.etatsOverrides.set(w2.key3(cx * MC.Core.CHUNK_X + lx, ly, cz * MC.Core.CHUNK_Z + lz), 3);
      var brut = w2.genererBrut(cx, cz);
      A.ok(brut.blocks && brut.blocks.length === MC.Core.CHUNK_X * MC.Core.WORLD_H * MC.Core.CHUNK_Z, 'blocks a la bonne taille');
      A.ok(brut.etats === null || brut.etats.length === brut.blocks.length, 'etats null ou de la bonne taille');
      A.notEqual(brut.blocks[li], idPose, 'le chunk brut n\'a pas encore l\'override — c\'est integrerChunk qui l\'applique');

      var obtenu = w2.integrerChunk(cx, cz, brut);
      A.ok(memeTableau(obtenu.blocks, attendu.blocks), 'mêmes blocs (overrides compris)');
      A.equal(obtenu.blocks[li], idPose, 'override appliqué par integrerChunk');
      A.equal(obtenu.etats[li], 3, 'état rejoué par integrerChunk');
      A.ok(memeTableau(obtenu.eau.nature, attendu.eau.nature), 'même eau (nature)');
      A.equal(obtenu.version, 1, 'version initiale = 1');

      // idempotent : un second appel pour la même position ne recrée rien
      var memeChunk = w2.integrerChunk(cx, cz, { blocks: new Uint16Array(brut.blocks.length), etats: null, eau: brut.eau });
      A.ok(memeChunk === obtenu, 'integrerChunk est idempotent (chunk déjà présent renvoyé tel quel)');
    });

    it('SPEC-PERF-006 : repli synchrone — executerGeneration/executerMaillage sur le thread principal, même résultat que le chemin normal', function () {
      var w = MC.createWorld(777);
      var cx = 1, cz = 1;
      var r = MC.TachesChunks.executerGeneration(w, { type: 'genere', epoque: 0, cx: cx, cz: cz });
      A.equal(r.message.type, 'chunk');
      A.equal(r.message.cx, cx); A.equal(r.message.cz, cz);
      A.ok(r.message.ms >= 0, 'ms mesuré');
      var attendu = w.genererBrut(cx, cz);
      A.ok(memeTableau(r.message.blocks, attendu.blocks), 'mêmes blocs que genererBrut appelé directement');

      var w2 = mondeAvecVoisinage(555, 0, 0);
      var voisins = MC.TachesChunks.instantaneVoisins(w2, 0, 0);
      var rm = MC.TachesChunks.executerMaillage({ type: 'maille', epoque: 0, cx: 0, cz: 0, version: 1,
                                                    simplifie: false, fusion: true, voisins: voisins });
      A.equal(rm.message.type, 'maillage');
      A.ok(rm.message.passes.opaque || rm.message.passes.cutout || rm.message.passes.blend || rm.message.passes.lumineux,
           'au moins une passe produite pour un chunk réel');
    });

    it('SPEC-PERF-007 : executerMaillage sur instantané des 9 voisins = buildChunk sur le monde (fusion comprise, quatre passes)', function () {
      var w = mondeAvecVoisinage(9001, 2, -1);
      var cx = 2, cz = -1;
      var chunk = w.chunkDe(cx, cz);
      var lumiere = MC.Lumiere.eclairer(w.chunkDe, cx, cz);
      var eauDe = eauDeSynchrone(w);

      var voisins = MC.TachesChunks.instantaneVoisins(w, cx, cz);
      var r = MC.TachesChunks.executerMaillage({ type: 'maille', epoque: 0, cx: cx, cz: cz, version: chunk.version,
                                                  simplifie: false, fusion: true, voisins: voisins });

      MC.ContratsV2.PASSES_MAILLAGE.forEach(function (pass) {
        var attendu = MC.Mesher.buildChunk(chunk, pass, w.getBlock, lumiere, eauDe, false, true);
        var obtenu = r.message.passes[pass];
        if (!attendu) { A.ok(!obtenu, 'passe ' + pass + ' absente des deux côtés'); return; }
        A.ok(obtenu, 'passe ' + pass + ' présente des deux côtés');
        A.ok(memeTableau(new Float32Array(attendu.positions), obtenu.positions), 'positions identiques (' + pass + ')');
        A.ok(memeTableau(new Float32Array(attendu.normals), obtenu.normals), 'normales identiques (' + pass + ')');
        A.ok(memeTableau(new Uint32Array(attendu.indices), obtenu.indices), 'indices identiques (' + pass + ')');
        if (attendu.uvBases && attendu.uvBases.length) {
          A.ok(memeTableau(new Float32Array(attendu.uvBases), obtenu.uvBases), 'uvBases identiques (' + pass + ')');
        }
      });
      // la fenêtre de lumière transmise reconstruit le même éclairage
      var depuis = MC.Lumiere.depuisTableaux(r.message.lumiere.niveaux, r.message.lumiere.ciel, r.message.lumiere.sources);
      A.equal(depuis.sources, lumiere.sources, 'même nombre de sources');
      for (var lx = -1; lx <= MC.Core.CHUNK_X; lx += 5) for (var lz = -1; lz <= MC.Core.CHUNK_Z; lz += 5) {
        for (var ly = 0; ly < MC.Core.WORLD_H; ly += 17) {
          A.equal(depuis.niveau(lx, ly, lz), lumiere.niveau(lx, ly, lz), 'même niveau de lumière en ' + lx + ',' + ly + ',' + lz);
          A.equal(depuis.ciel(lx, ly, lz), lumiere.ciel(lx, ly, lz), 'même ciel en ' + lx + ',' + ly + ',' + lz);
        }
      }
    });

    it('SPEC-PERF-008 : versTableauxTypes — types, longueurs par sommet, valeurs par défaut de toGeometry ; transferablesDe liste chaque tampon une fois', function () {
      var w = mondeAvecVoisinage(321, 0, 0);
      var chunk = w.chunkDe(0, 0);
      var lumiere = MC.Lumiere.eclairer(w.chunkDe, 0, 0);
      var raw = MC.Mesher.buildChunk(chunk, 'opaque', w.getBlock, lumiere, eauDeSynchrone(w), false, true);
      A.ok(raw, 'un maillage opaque existe pour ce chunk');
      var t = MC.TachesChunks.versTableauxTypes(raw);
      var nv = raw.positions.length / 3;
      A.equal(Object.prototype.toString.call(t.positions), '[object Float32Array]');
      A.equal(Object.prototype.toString.call(t.indices), '[object Uint32Array]');
      A.equal(t.positions.length, nv * 3);
      A.equal(t.uvBases.length, nv * 2);
      A.equal(t.ondes.length, nv * 4);
      // ciel par défaut = 1 (pas 0) si vide — même règle que toGeometry
      var raw2 = { positions: raw.positions, normals: raw.normals, uvs: raw.uvs, colors: raw.colors,
                   indices: raw.indices, lums: [], ciels: [] };
      var t2 = MC.TachesChunks.versTableauxTypes(raw2);
      A.ok(t2.ciels.every(function (v) { return v === 1; }), 'ciel par défaut = 1');
      A.ok(t2.lums.every(function (v) { return v === 0; }), 'lum par défaut = 0');
      A.equal(MC.TachesChunks.versTableauxTypes(null), null, 'null → null');

      // transferablesDe : chaque tampon une seule fois, même si partagé
      var msg = { type: 'maillage', epoque: 0, cx: 0, cz: 0, version: 1,
                  passes: { opaque: t, lumineux: null, cutout: null, blend: null }, lumiere: null, ms: 0 };
      var bufs = MC.ContratsV2.transferablesDe(msg);
      A.equal(new Set(bufs).size, bufs.length, 'aucun tampon listé deux fois');
      A.ok(bufs.indexOf(t.positions.buffer) >= 0, 'le tampon des positions est du lot');
      A.ok(bufs.indexOf(t.indices.buffer) >= 0, 'le tampon des indices est du lot');
    });

    it('SPEC-PERF-009 : un résultat de version ou d\'époque périmée est rejeté et le chunk redemandé', function () {
      var f = MC.FileChunks.creer({});
      f.voulus([[0, 0]], [[0, 5, 5]], []);
      var t = f.distribuer('genere', 1);
      A.equal(t.length, 1);
      // mauvaise époque : périmé
      A.equal(f.recu({ type: 'chunk', epoque: 999, cx: 5, cz: 5 }, function () { return 1; }), 'perime');

      // maillage : version périmée
      f.voulus([[0, 0]], [], [[0, 6, 6]]);
      var tm = f.distribuer('maille', 1);
      A.equal(tm.length, 1);
      var r = f.recu({ type: 'maillage', epoque: 0, cx: 6, cz: 6, version: 3 }, function () { return 4; });
      A.equal(r, 'perime', 'version 3 reçue alors que le chunk est déjà en version 4');
      // le chunk redevient distribuable (pas resté marqué en vol pour rien)
      f.voulus([[0, 0]], [], [[0, 6, 6]]);
      var tm2 = f.distribuer('maille', 1);
      A.equal(tm2.length, 1, 'la tâche est de nouveau distribuable après un rejet');

      // un résultat pour une tâche qu'on n'a pas en vol : ignoré (pas une erreur)
      A.equal(f.recu({ type: 'chunk', epoque: 0, cx: 99, cz: 99 }, function () { return 1; }), 'ignore');

      // une version correcte s'intègre
      f.voulus([[0, 0]], [], [[0, 6, 6]]);
      f.distribuer('maille', 1);
      A.equal(f.recu({ type: 'maillage', epoque: 0, cx: 6, cz: 6, version: 4 }, function () { return 4; }), 'integrer');
      A.equal(f.aIntegrer('maille').length, 1);
    });

    it('SPEC-PERF-005 : 50 chunks demandés d\'un coup — jamais plus d\'intégrations par image que le budget, rattrapage en ⌈50/budget⌉ images', function () {
      var budget = 3;
      var f = MC.FileChunks.creer({ integrationsGenParImage: budget });
      var demandes = [];
      for (var i = 0; i < 50; i++) demandes.push([i, i, 0]);
      f.voulus([[0, 0]], demandes, []);
      // tous distribués (aucune limite dans distribuer lui-même hors `libres`)
      var taches = f.distribuer('genere', 50);
      A.equal(taches.length, 50);
      taches.forEach(function (t) { f.recu({ type: 'chunk', epoque: 0, cx: t.cx, cz: t.cz }, function () { return 1; }); });

      var images = 0, integres = 0;
      while (integres < 50) {
        var lot = f.aIntegrer('genere');
        A.ok(lot.length <= budget, 'jamais plus de ' + budget + ' intégrations en une image');
        integres += lot.length;
        images++;
        if (images > 100) break;   // garde-fou anti-boucle infinie si le test est cassé
      }
      A.equal(integres, 50, 'les 50 résultats finissent par être intégrés');
      A.equal(images, Math.ceil(50 / budget), 'rattrapage en ⌈50/budget⌉ images');
    });

    it('SPEC-PERF-010 : distribution par distance croissante, recalculée quand un centre se déplace', function () {
      var f = MC.FileChunks.creer({});
      var voulus = [[0, 5, 0], [0, -5, 0], [0, 1, 0], [0, 0, 0]];
      f.voulus([[0, 0]], voulus, []);
      var t1 = f.distribuer('genere', 4);
      A.deep(t1.map(function (t) { return [t.cx, t.cz]; }), [[0, 0], [1, 0], [5, 0], [-5, 0]]);

      // le centre se déplace : même liste de positions voulues, priorités inversées
      var f2 = MC.FileChunks.creer({});
      f2.voulus([[6, 0]], voulus, []);
      var t2 = f2.distribuer('genere', 4);
      A.deep(t2.map(function (t) { return [t.cx, t.cz]; }), [[5, 0], [1, 0], [0, 0], [-5, 0]]);
    });

    it('SPEC-PERF-014 (amorce pure) : FileChunks.oublier purge file, en-vol et intégration d\'une position pour les deux genres', function () {
      var f = MC.FileChunks.creer({});
      f.voulus([[0, 0]], [[0, 2, 2]], [[0, 2, 2]]);
      f.distribuer('genere', 1); f.distribuer('maille', 1);
      f.oublier(2, 2);
      f.voulus([[0, 0]], [[0, 2, 2]], [[0, 2, 2]]);
      var apres = f.distribuer('genere', 1);
      A.equal(apres.length, 1, 'de nouveau distribuable : oublier() a bien libéré la marque « en vol »');
    });

    it('MC.FileChunks.echec remet une tâche en jeu (worker en erreur)', function () {
      var f = MC.FileChunks.creer({});
      f.voulus([[0, 0]], [[0, 3, 3]], []);
      f.distribuer('genere', 1);
      A.equal(f.distribuer('genere', 1).length, 0, 'toujours en vol, rien à redistribuer');
      f.echec('genere', 3, 3);
      A.equal(f.distribuer('genere', 1).length, 1, 'redistribuable après un échec');
    });

    it('MC.FileChunks.nouvelleEpoque vide les files et en-vol des deux genres, incrémente l\'époque', function () {
      var f = MC.FileChunks.creer({});
      var e0 = f.epoque;
      f.voulus([[0, 0]], [[0, 1, 1]], [[0, 2, 2]]);
      f.distribuer('genere', 1); f.distribuer('maille', 1);
      var e1 = f.nouvelleEpoque();
      A.equal(e1, e0 + 1);
      A.equal(f.stats().enFile, 0);
      A.equal(f.stats().enVol, 0);
      // un résultat de l'ancienne époque est désormais périmé
      A.equal(f.recu({ type: 'chunk', epoque: e0, cx: 1, cz: 1 }, function () { return 1; }), 'perime');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
