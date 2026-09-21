/* world.js — chunks, génération procédurale, lecture/écriture de blocs.
   Logique pure : ni THREE, ni DOM. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var CX = C.CHUNK_X, CZ = C.CHUNK_Z, WH = C.WORLD_H, SEA = C.SEA_LEVEL;
  var B = C.B, I = C.I, idx = C.idx;

  function key(a, b) { return a + ',' + b; }
  function key3(x, y, z) { return x + ',' + y + ',' + z; }

  function createWorld(seed) {
    var N = MC.makeNoise(seed === undefined ? 20260921 : seed);
    var chunks = new Map();
    // toutes les modifications du joueur, pour la sauvegarde et pour que la
    // regénération d'un chunk déchargé ne les efface pas
    var overrides = new Map();
    // cultures en croissance : position -> stade, mises à jour par tick()
    var crops = new Map();
    /* Sources de lumière posées par le joueur. La couche rendu y puise les
       torches les plus proches pour y placer ses lumières ponctuelles ; sans
       registre il faudrait balayer tous les chunks à chaque image. */
    var lights = new Map();

    function heightAt(wx, wz) {
      var continent = N.fbm(wx / 320, wz / 320, 3, 2, 0.5);
      var hills = N.signed(N.fbm(wx / 70, wz / 70, 4, 2, 0.5));
      var detail = N.signed(N.fbm(wx / 18, wz / 18, 2, 2, 0.5));
      var relief = Math.pow(Math.max(0, continent - 0.52) * 2.1, 1.7);
      var basin = Math.pow(Math.max(0, 0.46 - continent) * 2.6, 1.4);
      return Math.floor(SEA + 2 + hills * 9 - basin * 14 + relief * 30 + detail * 2.5);
    }

    /* Grottes : deux champs de bruit 3D dont on garde l'intersection, ce qui
       produit des galeries connectées plutôt que des bulles isolées.
       On ne creuse jamais assez haut pour percer le fond de l'océan : l'eau
       ne s'écoule pas, une brèche laisserait une poche d'air sous la mer. */
    var CAVE_TOP_MARGIN = 5;
    function isCave(wx, wy, wz, surface) {
      if (wy < 2) return false;
      var plafond = Math.min(surface - CAVE_TOP_MARGIN, SEA - 3);
      if (wy > plafond) return false;
      var a = N.fbm3(wx / 26, wy / 15, wz / 26, 2, 2, 0.5);
      var b = N.fbm3((wx + 411) / 34, (wy + 77) / 19, (wz - 233) / 34, 2, 2, 0.5);
      // les deux seuils doivent tomber ensemble : intersection = tunnels
      return a > 0.60 && b > 0.56;
    }

    function generateChunk(cx, cz) {
      var blocks = new Uint8Array(CX * WH * CZ);
      var trees = [];

      for (var x = 0; x < CX; x++) for (var z = 0; z < CZ; z++) {
        var wx = cx * CX + x, wz = cz * CZ + z;
        var h = Math.max(1, Math.min(WH - 14, heightAt(wx, wz)));
        var beach = h <= SEA + 1;

        for (var y = 0; y <= h; y++) {
          var b;
          if (y === 0) b = B.BEDROCK;
          else if (isCave(wx, y, wz, h)) b = 0;          // galerie creusée
          else if (y === h) b = beach ? B.SAND : B.GRASS;
          else if (y > h - 4) b = beach ? B.SAND : B.DIRT;
          else {
            b = B.STONE;
            // filons : le charbon partout sous la surface, le fer seulement en
            // profondeur — c'est ce qui donne une raison de descendre
            var nc = N.hash3(wx, y, wz);
            if (y < h - 6 && nc > 0.982) b = B.COAL_ORE;
            else if (y < Math.min(h - 12, 26) && nc < 0.010) b = B.IRON_ORE;
          }
          blocks[idx(x, y, z)] = b;
        }
        for (var yw = h + 1; yw <= SEA; yw++) blocks[idx(x, yw, z)] = B.WATER;

        if (!beach && h > SEA + 1 && x > 2 && x < 13 && z > 2 && z < 13
            && N.hash2(wx * 7, wz * 13) > 0.988) trees.push([x, h + 1, z]);
      }

      function put(x, y, z, b, overwrite) {
        if (x < 0 || x >= CX || z < 0 || z >= CZ || y < 0 || y >= WH) return;
        var i = idx(x, y, z);
        if (overwrite || blocks[i] === 0) blocks[i] = b;
      }
      for (var t = 0; t < trees.length; t++) {
        var tx = trees[t][0], ty = trees[t][1], tz = trees[t][2];
        var th = 4 + ((N.hash2(tx * 31, tz * 17) * 3) | 0);
        for (var i2 = 0; i2 < th; i2++) put(tx, ty + i2, tz, B.LOG, true);
        for (var dy = -2; dy <= 1; dy++) {
          var r = dy >= 0 ? 1 : 2;
          for (var dx = -r; dx <= r; dx++) for (var dz = -r; dz <= r; dz++) {
            if (dy === 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
            if (dy < 0 && Math.abs(dx) === r && Math.abs(dz) === r) continue;
            put(tx + dx, ty + th - 1 + dy, tz + dz, B.LEAVES, false);
          }
        }
      }

      var c = { cx: cx, cz: cz, blocks: blocks, mesh: null, meshT: null, dirty: true };

      // réapplique les modifications du joueur sur ce chunk
      overrides.forEach(function (id, k) {
        var p = k.split(',');
        var ox = +p[0], oy = +p[1], oz = +p[2];
        if (Math.floor(ox / CX) === cx && Math.floor(oz / CZ) === cz) {
          blocks[idx(ox - cx * CX, oy, oz - cz * CZ)] = id;
        }
      });
      return c;
    }

    function getChunk(cx, cz, create) {
      var k = key(cx, cz), c = chunks.get(k);
      if (!c && create) { c = generateChunk(cx, cz); chunks.set(k, c); }
      return c;
    }

    function getBlock(wx, wy, wz) {
      if (wy < 0 || wy >= WH) return 0;
      wx = Math.floor(wx); wy = Math.floor(wy); wz = Math.floor(wz);
      var cx = Math.floor(wx / CX), cz = Math.floor(wz / CZ);
      var c = chunks.get(key(cx, cz));
      if (!c) return 0;
      return c.blocks[idx(wx - cx * CX, wy, wz - cz * CZ)];
    }

    // `record` à false pour les changements internes (croissance) qu'on veut
    // quand même persister ; à true pour une action du joueur. Dans les deux cas
    // on enregistre : la distinction sert au cas où l'on voudrait les traiter à part.
    function setBlock(wx, wy, wz, id) {
      wx = Math.floor(wx); wy = Math.floor(wy); wz = Math.floor(wz);
      if (wy < 0 || wy >= WH) return false;
      var cx = Math.floor(wx / CX), cz = Math.floor(wz / CZ);
      var c = chunks.get(key(cx, cz));
      if (!c) return false;
      var lx = wx - cx * CX, lz = wz - cz * CZ;
      c.blocks[idx(lx, wy, lz)] = id;
      c.dirty = true;
      overrides.set(key3(wx, wy, wz), id);

      // registre des cultures
      var k3 = key3(wx, wy, wz);
      if (id === B.WHEAT0 || id === B.WHEAT1 || id === B.WHEAT2) {
        crops.set(k3, { x: wx, y: wy, z: wz, t: 0 });
      } else {
        crops.delete(k3);
      }

      // registre des sources de lumière
      if (C.lightOf(id) > 0) lights.set(k3, { x: wx, y: wy, z: wz, level: C.lightOf(id) });
      else lights.delete(k3);

      // un bloc de bordure change la silhouette du chunk voisin
      if (lx === 0) touch(cx - 1, cz);
      if (lx === CX - 1) touch(cx + 1, cz);
      if (lz === 0) touch(cx, cz - 1);
      if (lz === CZ - 1) touch(cx, cz + 1);
      return true;
    }
    function touch(cx, cz) { var n = chunks.get(key(cx, cz)); if (n) n.dirty = true; }

    // sommet solide d'une colonne ; `natural` ignore troncs et feuillages
    function groundAt(bx, bz, natural) {
      for (var y = WH - 1; y > 0; y--) {
        var b = getBlock(bx, y, bz);
        if (!C.isSolid(b)) continue;
        if (natural && (b === B.LOG || b === B.LEAVES)) continue;
        return y;
      }
      return 0;
    }

    // Prospecte via heightAt (pure) : on choisit où apparaître AVANT de générer.
    function findSpawnColumn() {
      for (var r = 0; r < 600; r += 4) {
        var steps = Math.max(1, (r / 2) | 0);
        for (var a = 0; a < steps; a++) {
          var ang = (a / steps) * Math.PI * 2;
          var bx = Math.round(Math.cos(ang) * r), bz = Math.round(Math.sin(ang) * r);
          if (heightAt(bx, bz) >= SEA + 3) return [bx, bz];
        }
      }
      return [0, 0];
    }

    // croissance du blé : chaque culture avance d'un stade après `stageTime`
    function tick(dt, stageTime, rand) {
      var st = stageTime || 14;
      var r = rand || Math.random;
      var grown = [];
      crops.forEach(function (c2) {
        c2.t += dt;
        if (c2.t < st) return;
        c2.t = 0;
        // la culture ne pousse que sur de la terre labourée
        if (getBlock(c2.x, c2.y - 1, c2.z) !== B.FARMLAND) return;
        if (r() > 0.75) return;                       // un peu d'irrégularité
        var cur = getBlock(c2.x, c2.y, c2.z);
        var s = C.BLOCKS[cur] && C.BLOCKS[cur].stage;
        if (s === undefined || s >= 3) return;
        setBlock(c2.x, c2.y, c2.z, C.WHEAT_STAGES[s + 1]);
        grown.push([c2.x, c2.y, c2.z, s + 1]);
      });
      return grown;
    }

    /* Après un chargement, `overrides` est rempli directement sans passer par
       setBlock : les registres dérivés doivent donc être reconstruits, sinon
       les torches posées avant la sauvegarde n'éclairent plus. */
    function rebuildRegistries() {
      lights.clear();
      overrides.forEach(function (id, k) {
        if (C.lightOf(id) > 0) {
          var p = k.split(',');
          lights.set(k, { x: +p[0], y: +p[1], z: +p[2], level: C.lightOf(id) });
        }
      });
      return lights.size;
    }

    /* Une torche ne tient que sur un bloc plein. Si son support disparaît,
       elle tombe — sinon on obtient des torches flottantes. */
    function dropUnsupported(wx, wy, wz) {
      var tombees = [];
      var voisins = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
      for (var i = 0; i < voisins.length; i++) {
        var v = voisins[i];
        var bx = wx + v[0], by = wy + v[1], bz = wz + v[2];
        var b = getBlock(bx, by, bz);
        var d = C.BLOCKS[b];
        if (!d || !d.needsSupport) continue;
        if (!hasSupport(bx, by, bz)) { setBlock(bx, by, bz, 0); tombees.push([bx, by, bz, b]); }
      }
      return tombees;
    }

    function hasSupport(wx, wy, wz) {
      if (C.isSolid(getBlock(wx, wy - 1, wz))) return true;
      var lat = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < lat.length; i++)
        if (C.isSolid(getBlock(wx + lat[i][0], wy, wz + lat[i][1]))) return true;
      return false;
    }

    function unloadFar(pcx, pcz, radius, onUnload) {
      var lim = radius * radius;
      var removed = [];
      chunks.forEach(function (c, k) {
        var dx = c.cx - pcx, dz = c.cz - pcz;
        if (dx * dx + dz * dz > lim) { removed.push([k, c]); }
      });
      removed.forEach(function (p) {
        if (onUnload) onUnload(p[1]);
        chunks.delete(p[0]);
      });
      return removed.length;
    }

    return {
      seed: seed, noise: N, chunks: chunks, overrides: overrides, crops: crops,
      lights: lights, rebuildRegistries: rebuildRegistries,
      hasSupport: hasSupport, dropUnsupported: dropUnsupported,
      heightAt: heightAt, isCave: isCave, getChunk: getChunk, getBlock: getBlock, setBlock: setBlock,
      groundAt: groundAt, findSpawnColumn: findSpawnColumn, tick: tick,
      unloadFar: unloadFar, key: key, key3: key3,
    };
  }

  MC.createWorld = createWorld;
})(typeof globalThis !== 'undefined' ? globalThis : this);
