/* spec-perf.js — tests des specs SPEC-PERF-001/002/003 (lot A « bruit et
   génération », audit rendu du 2026-09-24, scratchpad/specs-perf.md) : cache
   de grille interpolé pour le bruit 3D des grottes (même technique que
   src/densite.js valeurCoin/valeurLisse), bornage mémoire du cache, écart
   mesuré face au bruit exact. Voir aussi tests/bench-generation.js
   (SPEC-PERF-017/018), le banc de non-régression que ce fichier ne duplique
   pas : ici, on vérifie le comportement, pas la vitesse d'exécution répétée. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;

  // chunks sur une spirale carrée autour de l'origine, comme le ferait le
  // joueur en s'éloignant du spawn — même patron que scratchpad/bench.js.
  function spirale(n) {
    var pts = [[0, 0]], x = 0, z = 0, dx = 1, dz = 0, steps = 1, stepCount = 0, turns = 0;
    while (pts.length < n) {
      x += dx; z += dz; pts.push([x, z]); stepCount++;
      if (stepCount === steps) {
        stepCount = 0;
        var t = dx; dx = -dz; dz = t; turns++;
        if (turns % 2 === 0) steps++;
      }
    }
    return pts.slice(0, n);
  }

  describe('Specs — PERF, bruit et génération (lot A, audit du 2026-09-24)', function () {
    it('SPEC-PERF-001 : la génération de chunk reste sous le budget de temps grâce au cache de grille du bruit de grotte',
      // SPEC-BANC-062 : un budget de temps mesuré en millisecondes n'a de
      // sens que SANS l'enveloppe d'observation des fonctions (comme G12,
      // tests/gates.js) — `@budget-perf` fait sauter la fenêtre d'observation
      // pour CE test précis (tests/run.js), sans désactiver l'enveloppe pour
      // le reste de la campagne (--sans-fonctions le ferait, lui, globalement).
      { etiquettes: ['budget-perf'] },
      function () {
      var w = MC.createWorld(20260924);
      // 80 chunks (pas 40) : un seul chunk de ville coûte largement plus que
      // les autres (habitats/routes) et fausse la moyenne sur un petit
      // échantillon — 80 l'amortit assez pour un seuil stable (voir aussi
      // tests/bench-generation.js, qui mesure la même chose plus précisément).
      var coords = spirale(80), total = 0;
      coords.forEach(function (c) {
        var t0 = performance.now();
        w.getChunk(c[0], c[1], true);
        total += performance.now() - t0;
      });
      var avg = total / coords.length;
      /* Seuil généreux et non le chiffre mesuré (SPEC-PERF-017/tests/budget-perf.json
         y veillent avec plus de précision) : mesuré ~44-45 ms/chunk le
         2026-09-24 (80 chunks en spirale) contre ~98-112 ms/chunk avant le
         cache — 65 ms laisse une bonne marge à une machine plus lente, tout
         en restant nettement sous la moyenne d'avant : un retour au bruit
         non mis en cache doit échouer ici. */
      A.lt(avg, 65, 'génération moyenne sous le budget de 65 ms/chunk (mesuré ' + avg.toFixed(1) + ' ms)');
    });

    it('SPEC-PERF-002 : le cache de coins de bruit de grotte est borné, sans fuite sur une session longue', function () {
      var w = MC.createWorld(2);
      var last = 0, drops = 0, max = 0;
      // 18000 colonnes très écartées (aucune réutilisation de grille possible),
      // chacune sondée sur toute sa hauteur : de quoi pousser les trois caches
      // (tunnels a/b, cavernes) au-delà de leur borne et observer une purge.
      for (var i = 0; i < 18000; i++) {
        var wx = i * 400, wz = -i * 500;
        for (var y = 2; y < 80; y += 3) w.isCave(wx, y, wz, 80);
        var s = w.perf.caveCacheSize();
        if (s < last) drops++;
        last = s; max = Math.max(max, s);
      }
      // 3 champs (tunnels a, tunnels b, cavernes) × 200000 coins, comme
      // densite.js (`coins.size > 200000` → clear) : jamais plus au total.
      A.lt(max, 600001, 'jamais plus de 600000 coins en cache au total (3 × 200000) : max=' + max);
      A.gt(drops, 0, 'le cache a bien été purgé au moins une fois sous la charge (drops=' + drops + ')');
    });

    it('SPEC-PERF-003 : le relief des grottes interpolé reste quasi indiscernable du bruit exact, sur un large échantillon', function () {
      var w = MC.createWorld(20260924);
      var N = w.noise, Bio = w.bio, C = MC.Core;
      var CAVE_TOP_MARGIN = 5;
      // reproduit isCave AVANT le cache de grille (src/world.js, même formules
      // exactes) : la référence à laquelle comparer le résultat interpolé.
      function isCaveExact(wx, wy, wz, surface) {
        if (wy < 2) return false;
        var plafond = Math.min(surface - CAVE_TOP_MARGIN, C.SEA_LEVEL - 3);
        if (wy > plafond) return false;
        var a = N.fbm3(wx / 26, wy / 15, wz / 26, 2, 2, 0.5);
        var b = N.fbm3((wx + 411) / 34, (wy + 77) / 19, (wz - 233) / 34, 2, 2, 0.5);
        if (a > 0.60 && b > 0.56) return true;
        if (wy >= 6 && wy <= 28) {
          var cav = N.fbm3((wx - 911) / 40, (wy + 13) / 12, (wz + 577) / 40, 2, 2, 0.5);
          if (cav > 0.66) return true;
        }
        return false;
      }
      var coords = spirale(40), total = 0, diff = 0;
      coords.forEach(function (c) {
        var cx = c[0], cz = c[1];
        for (var x = 0; x < 16; x++) for (var z = 0; z < 16; z++) {
          var wx = cx * 16 + x, wz = cz * 16 + z;
          var h = Math.max(1, Math.min(C.WORLD_H - 14, Bio.hauteur(wx, wz)));
          for (var y = 1; y <= h; y++) {
            total++;
            if (isCaveExact(wx, y, wz, h) !== w.isCave(wx, y, wz, h)) diff++;
          }
        }
      });
      A.gt(total, 100000, 'assez de blocs testés sur les 40 chunks (' + total + ')');
      var pct = 100 * diff / total;
      // mesuré ~0.78 % sur 48 chunks (2026-09-24) : la tolérance ci-dessous
      // laisse une bonne marge sans jamais devenir aveugle à une vraie régression
      A.lt(pct, 2, 'écart grotte/pas-grotte sous 2 % (' + diff + '/' + total + ' = ' + pct.toFixed(3) + ' %)');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
