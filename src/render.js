/* render.js — seule couche qui connaît THREE. Elle emballe les tableaux bruts
   du mailleur en BufferGeometry et tient à jour les objets de scène. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core, DC = MC.DayCycle;

  function createRenderer(canvasHost, atlas, opts) {
    opts = opts || {};
    var RENDER_DIST = opts.renderDist || 5;
    var FOG_NEAR = RENDER_DIST * C.CHUNK_X * 0.55;
    var FOG_FAR = RENDER_DIST * C.CHUNK_X * 0.98;

    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87b7e8);
    scene.fog = new THREE.Fog(0x87b7e8, FOG_NEAR, FOG_FAR);

    /* On se dimensionne sur le CONTENEUR, pas sur la fenêtre : le viseur est
       centré en CSS sur ce conteneur, donc c'est lui qui doit faire référence.
       Sinon la croix ne coïncide pas avec le centre de la projection. */
    function hostSize() {
      var w = canvasHost.clientWidth || innerWidth;
      var h = canvasHost.clientHeight || innerHeight;
      return [Math.max(1, w), Math.max(1, h)];
    }
    var sz = hostSize();
    var camera = new THREE.PerspectiveCamera(72, sz[0] / sz[1], 0.1, 1000);
    var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(sz[0], sz[1]);
    canvasHost.appendChild(renderer.domElement);

    var hemi = new THREE.HemisphereLight(0xdfefff, 0x4a5a44, 0.95);
    scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xfff2d8, 0.55);
    scene.add(sun);

    var matOpaque = new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true });
    // découpe : alphaTest, profondeur écrite, donc AUCUN tri nécessaire.
    // Le feuillage et les cultures relèvent de ce régime, pas du fondu — en
    // fondu ils paraissent délavés et se trient mal entre eux.
    var matCutout = new THREE.MeshLambertMaterial({
      map: atlas.texture, vertexColors: true, transparent: true,
      alphaTest: 0.5, side: THREE.DoubleSide, depthWrite: true,
    });
    // fondu réel : réservé à l'eau et au verre
    var matBlend = new THREE.MeshLambertMaterial({
      map: atlas.texture, vertexColors: true, transparent: true, opacity: 0.8,
      side: THREE.DoubleSide, depthWrite: false,
    });

    // contour du bloc visé
    var highlight = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }));
    highlight.visible = false;
    scene.add(highlight);

    // ─── chunks ──────────────────────────────────────────────────────────────
    function toGeometry(raw) {
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(raw.positions, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(raw.normals, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(raw.uvs, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(raw.colors, 3));
      g.setIndex(raw.indices);
      g.computeBoundingSphere();
      return g;
    }

    // une passe de rendu = un maillage par chunk ; l'ordre de rendu va
    // de l'opaque au fondu, ce dernier devant être dessiné en dernier
    var PASSES = [['mesh', matOpaque, 'opaque', 0],
                  ['meshC', matCutout, 'cutout', 1],
                  ['meshT', matBlend, 'blend', 2]];

    function syncChunk(world, chunk) {
      var sample = world.getBlock;
      var passes = PASSES;
      for (var i = 0; i < passes.length; i++) {
        var key = passes[i][0], mat = passes[i][1], pass = passes[i][2];
        var raw = MC.Mesher.buildChunk(chunk, pass, sample);
        if (chunk[key]) { scene.remove(chunk[key]); chunk[key].geometry.dispose(); chunk[key] = null; }
        if (raw) {
          var m = new THREE.Mesh(toGeometry(raw), mat);
          m.position.set(chunk.cx * C.CHUNK_X, 0, chunk.cz * C.CHUNK_Z);
          m.renderOrder = passes[i][3];
          scene.add(m);
          chunk[key] = m;
        }
      }
      chunk.dirty = false;
    }

    function disposeChunk(chunk) {
      ['mesh', 'meshC', 'meshT'].forEach(function (k) {
        if (chunk[k]) { scene.remove(chunk[k]); chunk[k].geometry.dispose(); chunk[k] = null; }
      });
    }

    // ─── entités ─────────────────────────────────────────────────────────────
    var entityMeshes = new Map();

    function itemMesh(id) {
      var d = C.def(id);
      var tile = C.isBlock(id) ? d.tiles[0] : d.tile;
      var geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
      // recentrer les UV sur la tuile voulue
      var uv = geo.attributes.uv;
      var tx = tile % atlas.COLS, ty = (tile / atlas.COLS) | 0;
      for (var i = 0; i < uv.count; i++) {
        uv.setXY(i,
          (tx + uv.getX(i)) / atlas.COLS,
          1 - (ty + 1 - uv.getY(i)) / atlas.ROWS);
      }
      uv.needsUpdate = true;
      return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: atlas.texture }));
    }

    var MOB_COLORS = {
      zombie: [0x3f7a43, 0x4a8f52],
      sheep: [0xf0efe8, 0xe8ded0],
      villager: [0x6b4f3a, 0xc9a882],
    };

    function mobMesh(type, spec) {
      var grp = new THREE.Group();
      var col = MOB_COLORS[type] || [0x888888, 0xaaaaaa];
      var body = new THREE.Mesh(
        new THREE.BoxGeometry(spec.w, spec.h * 0.62, spec.w * 0.7),
        new THREE.MeshLambertMaterial({ color: col[0] }));
      body.position.y = spec.h * 0.31;
      grp.add(body);
      var head = new THREE.Mesh(
        new THREE.BoxGeometry(spec.w * 0.75, spec.h * 0.28, spec.w * 0.75),
        new THREE.MeshLambertMaterial({ color: col[1] }));
      head.position.y = spec.h * 0.76;
      grp.add(head);
      // deux yeux, pour qu'on voie où le mob regarde
      var eyeMat = new THREE.MeshBasicMaterial({ color: type === 'zombie' ? 0xff4444 : 0x222222 });
      [-1, 1].forEach(function (s) {
        var e = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), eyeMat);
        e.position.set(s * spec.w * 0.18, spec.h * 0.78, -spec.w * 0.38);
        grp.add(e);
      });
      return grp;
    }

    /* Chaque mob instancie ses propres materiaux (corps, tete, yeux) et chaque
       objet au sol le sien : ne liberer que la geometrie laissait fuir un
       materiau par entite. Sur une longue partie, les zombies disparaissant
       a chaque aube, cela s'accumule sans fin. */
    var liberees = 0;
    function libererEntite(m) {
      scene.remove(m);
      m.traverse(function (o) {
        if (o.geometry) { o.geometry.dispose(); }
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach(function (mt) { mt.dispose(); });
          else o.material.dispose();
          liberees++;
        }
      });
    }

    function libererToutesEntites() {
      entityMeshes.forEach(libererEntite);
      entityMeshes.clear();
    }

    function syncEntities(entities) {
      var seen = new Set();
      for (var i = 0; i < entities.list.length; i++) {
        var e = entities.list[i];
        seen.add(e.eid);
        var m = entityMeshes.get(e.eid);
        if (!m) {
          m = e.type === 'item' ? itemMesh(e.item) : mobMesh(e.type, entities.SPECS[e.type]);
          scene.add(m);
          entityMeshes.set(e.eid, m);
        }
        m.position.set(e.pos.x, e.pos.y, e.pos.z);
        if (e.type === 'item') {
          m.rotation.y = e.age * 1.8;
          m.position.y += 0.18 + Math.sin(e.age * 2.6) * 0.06;   // flottement
        } else {
          m.rotation.y = e.yaw || 0;
          // clignotement rouge quand le mob vient d'être touché
          var hurt = e.hurtCd > 0;
          m.traverse(function (o) {
            if (o.material && o.material.emissive)
              o.material.emissive.setHex(hurt ? 0x661111 : 0x000000);
          });
        }
      }
      entityMeshes.forEach(function (m, id) {
        if (!seen.has(id)) { libererEntite(m); entityMeshes.delete(id); }
      });
    }

    // ─── ambiance ────────────────────────────────────────────────────────────
    var skyC = new THREE.Color();
    var UNDERWATER = new THREE.Color(0x2a5f9e);

    function updateAmbience(time, submerged) {
      var s = DC.skyColor(time);
      skyC.setRGB(s[0], s[1], s[2]);
      if (submerged) {
        scene.background.copy(UNDERWATER);
        scene.fog.color.copy(UNDERWATER);
        scene.fog.near = 0.5; scene.fog.far = 22;
      } else {
        scene.background.copy(skyC);
        scene.fog.color.copy(skyC);
        scene.fog.near = FOG_NEAR; scene.fog.far = FOG_FAR;
      }
      var inten = DC.sunIntensity(time);
      // Plancher d'éclairage nocturne : une nuit physiquement correcte serait
      // noire, donc injouable. On garde le contraste jour/nuit tout en laissant
      // le relief lisible (et les zombies visibles avant qu'ils ne mordent).
      sun.intensity = 0.12 + inten * 0.48;
      hemi.intensity = 0.46 + inten * 0.52;
      // la lumière hémisphérique vire au bleu nuit quand le soleil se couche
      hemi.color.setRGB(0.55 + s[0] * 0.45, 0.62 + s[1] * 0.38, 0.72 + s[2] * 0.28);
      var d = DC.sunDir(time);
      sun.position.set(camera.position.x + d.x * 100, camera.position.y + d.y * 100,
                       camera.position.z + d.z * 100);
      sun.target.position.copy(camera.position);
      sun.target.updateMatrixWorld();
    }

    /* ── Torches ───────────────────────────────────────────────────────────
       Plutôt qu'un moteur de propagation de lumière (coûteux à calculer et à
       remailler), on entretient un petit pool de lumières ponctuelles que l'on
       réaffecte chaque image aux torches les plus proches. Le nombre de
       lumières reste borné, donc le coût du shader aussi. */
    var MAX_TORCH_LIGHTS = 10, TORCH_RANGE = 17;
    var torchPool = [];
    for (var ti = 0; ti < MAX_TORCH_LIGHTS; ti++) {
      // decroissance douce (1.1) : en grotte la torche est la seule source,
      // une decroissance physique realiste laisserait tout noir a 3 blocs
      var pl2 = new THREE.PointLight(0xffb45a, 0, TORCH_RANGE, 1.45);
      pl2.visible = false;
      scene.add(pl2);
      torchPool.push(pl2);
    }

    function updateTorches(world) {
      var cam = camera.position;
      var proches = [];
      world.lights.forEach(function (t) {
        var dx = t.x + 0.5 - cam.x, dy = t.y + 0.5 - cam.y, dz = t.z + 0.5 - cam.z;
        var d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > (TORCH_RANGE * 2.2) * (TORCH_RANGE * 2.2)) return;
        proches.push({ d2: d2, t: t });
      });
      proches.sort(function (a, b) { return a.d2 - b.d2; });
      for (var i = 0; i < torchPool.length; i++) {
        var L = torchPool[i];
        if (i < proches.length) {
          var p = proches[i].t;
          L.position.set(p.x + 0.5, p.y + 0.55, p.z + 0.5);
          L.intensity = 1.5;
          L.visible = true;
        } else {
          L.visible = false;
          L.intensity = 0;
        }
      }
      return Math.min(proches.length, torchPool.length);
    }

    function setHighlight(target) {
      if (!target) { highlight.visible = false; return; }
      highlight.visible = true;
      highlight.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    }

    function setCamera(pos, yaw, pitch) {
      camera.position.set(pos.x, pos.y, pos.z);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }

    function resize() {
      var s = hostSize();
      camera.aspect = s[0] / s[1];
      camera.updateProjectionMatrix();
      renderer.setSize(s[0], s[1]);
    }

    function render() { renderer.render(scene, camera); }

    return {
      scene: scene, camera: camera, renderer: renderer, sun: sun,
      syncChunk: syncChunk, disposeChunk: disposeChunk, syncEntities: syncEntities,
      updateAmbience: updateAmbience, setHighlight: setHighlight, setCamera: setCamera,
      updateTorches: updateTorches, torchPool: torchPool, MAX_TORCH_LIGHTS: MAX_TORCH_LIGHTS,
      libererToutesEntites: libererToutesEntites,
      get materiauxLiberes() { return liberees; },
      resize: resize, render: render, RENDER_DIST: RENDER_DIST,
      materials: { opaque: matOpaque, cutout: matCutout, blend: matBlend },
      entityMeshes: entityMeshes,
    };
  }

  MC.createRenderer = createRenderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
