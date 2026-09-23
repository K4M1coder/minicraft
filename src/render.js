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

    /* Écran partagé : une caméra par joueur local, allouées à la demande.
       La première est `camera` ci-dessus, qui reste celle du joueur 1 — tout
       le code existant (ambiance, torches) continue de s'y référer. */
    var cameras = [camera];
    function cameraDe(i) {
      while (cameras.length <= i) {
        cameras.push(new THREE.PerspectiveCamera(72, sz[0] / sz[1], 0.1, 1000));
      }
      return cameras[i];
    }
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

    /* Apparence par type : une silhouette (famille de forme) et ses couleurs —
       corps, tête, yeux. Les gardiens reprennent la forme de leur espèce,
       agrandie par leur gabarit, et portent une couronne dorée. `variantes` :
       une palette de corps par variante (poissons tropicaux, perroquets). */
    var MOB_LOOK = {
      zombie:   { forme: 'bipede', c: [0x3f7a43, 0x4a8f52], yeux: 0xff4444 },
      sheep:    { forme: 'quadrupede', c: [0xf0efe8, 0xe8ded0], yeux: 0x222222 },
      villager: { forme: 'bipede', c: [0x6b4f3a, 0xc9a882], yeux: 0x222222 },
      skeleton: { forme: 'bipede', c: [0xd8d8d0, 0xe8e8e0], yeux: 0x111111, mince: true },
      spider:   { forme: 'araignee', c: [0x2e2622, 0x3a302a], yeux: 0xff2222 },
      mummy:    { forme: 'bipede', c: [0xc8b88a, 0xd8c89a], yeux: 0x2a2010 },
      slime:    { forme: 'cube', c: [0x6ecb5a, 0x4a9a3a], yeux: 0x1a3a14 },
      wolf:     { forme: 'quadrupede', c: [0xb8b8bc, 0xd0d0d4], yeux: 0x222222 },
      pig:      { forme: 'quadrupede', c: [0xe8a0a0, 0xf0b0b0], yeux: 0x222222 },
      chicken:  { forme: 'oiseau_sol', c: [0xf4f2ea, 0xf4f2ea], yeux: 0x111111, bec: 0xe8a030 },
      goat:     { forme: 'quadrupede', c: [0xd8d0c0, 0xe8e0d0], yeux: 0x222222, cornes: true },
      polar_bear: { forme: 'quadrupede', c: [0xf2f2ee, 0xf8f8f4], yeux: 0x111111 },
      fish:     { forme: 'poisson', c: [0x8aa8c0, 0x6a88a0], yeux: 0x111111 },
      tropical_fish: { forme: 'poisson', c: [0xf08a30, 0xf0f0f0], yeux: 0x111111,
                       variantes: [[0xf08a30, 0xf0f0f0], [0x3070e0, 0xf0d030], [0xe03060, 0xf0f0f0],
                                   [0x30c0a0, 0x203040]] },
      squid:    { forme: 'calmar', c: [0x2a3a6a, 0x3a4a8a], yeux: 0xe0e0e0 },
      dolphin:  { forme: 'poisson', c: [0x7a8ca0, 0xc0ccd8], yeux: 0x111111, allonge: 1.6 },
      turtle:   { forme: 'tortue', c: [0x4a7a3a, 0x8ab070], yeux: 0x111111 },
      shark:    { forme: 'poisson', c: [0x5a6a78, 0xd0d8e0], yeux: 0x111111, allonge: 1.8, aileron: true },
      jellyfish: { forme: 'meduse', c: [0xd080e0, 0xf0c0f8], yeux: 0xffffff },
      crab:     { forme: 'crabe', c: [0xd04a2a, 0xe06a40], yeux: 0x111111 },
      drowned:  { forme: 'bipede', c: [0x3a8a8a, 0x5aa0a0], yeux: 0x60e0ff },
      bird:     { forme: 'oiseau', c: [0x8a5a3a, 0xc08a5a], yeux: 0x111111, bec: 0xe0b030 },
      seagull:  { forme: 'oiseau', c: [0xf0f0f0, 0x9aa0a8], yeux: 0x111111, bec: 0xf0c030 },
      parrot:   { forme: 'oiseau', c: [0xe03030, 0x3070e0], yeux: 0x111111, bec: 0x333333,
                  variantes: [[0xe03030, 0x3070e0], [0x30c040, 0xf0d030], [0x3080f0, 0xf0f0f0]] },
      eagle:    { forme: 'oiseau', c: [0x5a3a22, 0xf0f0e8], yeux: 0x111111, bec: 0xf0c030 },
      pillager: { forme: 'bipede', c: [0x4a4a52, 0x9a8a78], yeux: 0x111111 },
      vindicator: { forme: 'bipede', c: [0x2a2a30, 0x9a8a78], yeux: 0x111111 },
      boss_zombie:    { forme: 'bipede', c: [0x2f5a33, 0x3a7042], yeux: 0xff2222, couronne: true },
      boss_araignee:  { forme: 'araignee', c: [0x3a1a2a, 0x4a2438], yeux: 0xff66ff, couronne: true },
      boss_squelette: { forme: 'bipede', c: [0xb8b8b0, 0xd8d8d0], yeux: 0x3a6aff, mince: true, couronne: true },
      boss_slime:     { forme: 'cube', c: [0x4aa0d8, 0x2a78b0], yeux: 0x0a2a44, couronne: true },
      boss_pharaon:   { forme: 'bipede', c: [0xd8c070, 0xe8d8a0], yeux: 0x40ff60, couronne: true },
      boss_yeti:      { forme: 'bipede', c: [0xf0f4f8, 0xd8e4ec], yeux: 0x3a8aff, couronne: true },
      boss_serpent:   { forme: 'serpent', c: [0x3a8a2a, 0xd0c040], yeux: 0xffd000, couronne: true },
      boss_sorciere:  { forme: 'bipede', c: [0x5a2a7a, 0x8ab070], yeux: 0xd040ff, couronne: true, chapeau: true },
      boss_wyverne:   { forme: 'wyverne', c: [0x7a1a1a, 0xc04030], yeux: 0xffd000, couronne: true },
      boss_gardien_ancien: { forme: 'poisson', c: [0x6ab0a0, 0x3a7a70], yeux: 0xff6030, allonge: 1.1,
                             pics: true, couronne: true },
      boss_capitaine: { forme: 'bipede', c: [0x2a5a6a, 0x4a8a8a], yeux: 0x60e0ff, couronne: true },
    };

    function mat(couleur, extra) {
      var o = { color: couleur };
      if (extra) for (var k in extra) o[k] = extra[k];
      return new THREE.MeshLambertMaterial(o);
    }
    function boite(w, h, d, couleur, x, y, z) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(couleur));
      m.position.set(x, y, z);
      return m;
    }

    /* Arme tenue : quelques boîtes, dans la main droite. */
    function armeMesh(id, echelle) {
      var d = C.ITEMS[id];
      if (!d) return null;
      var grp = new THREE.Group();
      var k = echelle || 1;
      if (d.ranged) {
        grp.add(boite(0.06 * k, 0.6 * k, 0.06 * k, 0x6a4a28, 0, 0, 0));
        grp.add(boite(0.4 * k, 0.05 * k, 0.05 * k, 0x8a8a90, 0, 0.2 * k, 0));
      } else {
        var lame = d.tool === 'axe' ? 0x9a9aa2 : (id === C.I.TRIDENT ? 0x5ad8d0 : 0xd8d8e0);
        grp.add(boite(0.05 * k, 0.3 * k, 0.05 * k, 0x6a4a28, 0, -0.15 * k, 0));
        if (d.tool === 'axe') grp.add(boite(0.05 * k, 0.2 * k, 0.22 * k, lame, 0, 0.1 * k, -0.08 * k));
        else grp.add(boite(0.06 * k, 0.6 * k, 0.03 * k, lame, 0, 0.3 * k, 0));
      }
      return grp;
    }

    /* Maillage d'un véhicule, l'avant vers -Z comme pour les créatures. */
    var COULEURS_VEHICULES = { bateau: 0x9a6a3a, moto: 0xc02a2a, voiture: 0x2a6ac0, camion: 0xd88a2a,
                               avion: 0xd8d8e0, sous_marin: 0xe0c030 };
    function vehiculeMesh(nom, spec) {
      var grp = new THREE.Group();
      var w = spec.w, h = spec.h, c = COULEURS_VEHICULES[nom] || 0x888888;
      var noir = 0x18181c, vitre = 0x9ad0f0;
      function roue(x, z, r) {
        var m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.22, 12), mat(noir));
        m.rotation.z = Math.PI / 2; m.position.set(x, r, z);
        grp.add(m);
        (grp.userData.roues = grp.userData.roues || []).push(m);
      }
      if (nom === 'bateau') {
        grp.add(boite(w, 0.2, w * 1.7, c, 0, 0.1, 0));
        grp.add(boite(0.12, h * 0.6, w * 1.7, c, -w / 2, h * 0.4, 0));
        grp.add(boite(0.12, h * 0.6, w * 1.7, c, w / 2, h * 0.4, 0));
        grp.add(boite(w, h * 0.6, 0.12, c, 0, h * 0.4, w * 0.85));
        grp.add(boite(w * 0.6, h * 0.5, 0.12, c, 0, h * 0.35, -w * 0.85));
      } else if (nom === 'moto') {
        grp.add(boite(0.3, 0.35, 1.4, c, 0, 0.55, 0));
        grp.add(boite(0.34, 0.15, 0.5, 0x222222, 0, 0.78, 0.15));
        grp.add(boite(0.5, 0.06, 0.06, 0x9a9aa2, 0, 1.0, -0.55));
        roue(0, -0.6, 0.32); roue(0, 0.6, 0.32);
      } else if (nom === 'voiture') {
        grp.add(boite(w, h * 0.45, w * 2.1, c, 0, h * 0.42, 0));
        grp.add(boite(w * 0.9, h * 0.38, w * 1.1, c, 0, h * 0.82, 0.1));
        grp.add(boite(w * 0.86, h * 0.3, 0.05, vitre, 0, h * 0.82, -w * 0.46));
        [-1, 1].forEach(function (s) { roue(s * w * 0.5, -w * 0.7, 0.34); roue(s * w * 0.5, w * 0.7, 0.34); });
      } else if (nom === 'camion') {
        grp.add(boite(w, h * 0.55, w * 0.9, c, 0, h * 0.5, -w * 0.9));
        grp.add(boite(w * 0.9, h * 0.25, 0.05, vitre, 0, h * 0.62, -w * 1.36));
        grp.add(boite(w, h * 0.75, w * 1.6, 0x6a6a72, 0, h * 0.6, w * 0.4));
        [-1, 1].forEach(function (s) {
          roue(s * w * 0.5, -w * 0.95, 0.42); roue(s * w * 0.5, w * 0.1, 0.42); roue(s * w * 0.5, w * 0.8, 0.42);
        });
      } else if (nom === 'avion') {
        grp.add(boite(0.7, 0.7, w * 1.5, c, 0, 0.7, 0));
        grp.add(boite(w * 2.2, 0.08, 0.9, c, 0, 0.75, -0.1));
        grp.add(boite(1.4, 0.06, 0.4, c, 0, 0.9, w * 0.7));
        grp.add(boite(0.06, 0.6, 0.4, c, 0, 1.2, w * 0.7));
        grp.add(boite(0.6, 0.3, 0.6, vitre, 0, 1.15, -0.3));
        var helice = boite(1.3, 0.1, 0.04, 0x333338, 0, 0.7, -w * 0.77);
        grp.add(helice);
        grp.userData.helice = helice;
        roue(-0.6, -0.3, 0.2); roue(0.6, -0.3, 0.2);
      } else if (nom === 'sous_marin') {
        grp.add(boite(w * 0.8, h * 0.7, w * 2, c, 0, h * 0.4, 0));
        grp.add(boite(w * 0.5, h * 0.4, w * 0.6, c, 0, h * 0.9, -0.1));
        grp.add(boite(w * 0.3, h * 0.2, 0.05, vitre, 0, h * 0.5, -w));
        [-0.35, 0.35].forEach(function (x) { grp.add(boite(0.18, 0.18, 0.05, vitre, x * w, h * 0.45, -w - 0.01)); });
        var helice2 = boite(0.9, 0.1, 0.04, 0x333338, 0, h * 0.4, w + 0.05);
        grp.add(helice2);
        grp.userData.helice = helice2;
      }
      return grp;
    }

    /* Projectiles : la flèche est un trait, les sortilèges des globes. */
    var COULEURS_PROJECTILES = { neige: 0xf4f8ff, sortilege: 0xc040ff, feu: 0xff6020, laser: 0x60ffe0 };
    function projectileMesh(genre) {
      if (!genre || genre === 'fleche') {
        var g2 = new THREE.Group();
        g2.add(boite(0.04, 0.04, 0.6, 0x8a6a3c, 0, 0, 0));
        g2.add(boite(0.08, 0.08, 0.08, 0xc8c8d0, 0, 0, -0.3));
        return g2;
      }
      var m = new THREE.Mesh(new THREE.SphereGeometry(genre === 'neige' ? 0.22 : 0.18, 8, 6),
                             new THREE.MeshBasicMaterial({ color: COULEURS_PROJECTILES[genre] || 0xffffff }));
      var g3 = new THREE.Group();
      g3.add(m);
      return g3;
    }

    function mobMesh(type, spec, entite) {
      if (spec && spec.vehicule) return vehiculeMesh(spec.vehicule, spec);
      if (type === 'arrow') return projectileMesh(entite && entite.genre);
      var grp = new THREE.Group();
      var L = MOB_LOOK[type] || { forme: 'bipede', c: [0x888888, 0xaaaaaa], yeux: 0x222222 };
      var w = spec.w, h = spec.h;
      var col = L.c;
      if (L.variantes && entite && entite.variante !== undefined) col = L.variantes[entite.variante % L.variantes.length];
      var yeuxY, yeuxZ, ecart, ailes = [], queue = null, main = null;

      if (L.forme === 'quadrupede') {
        // corps horizontal sur quatre pattes, tête en avant (vers -Z)
        var pl = h * 0.4;
        grp.add(boite(w * 0.8, h * 0.45, w * 1.3, col[0], 0, pl + h * 0.22, 0.05));
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
          grp.add(boite(w * 0.2, pl, w * 0.2, col[0], p[0] * w * 0.26, pl / 2, p[1] * w * 0.45));
        });
        grp.add(boite(w * 0.55, h * 0.4, w * 0.45, col[1], 0, h * 0.72, -w * 0.72));
        if (L.cornes) [-1, 1].forEach(function (s) { grp.add(boite(0.06, 0.2, 0.06, 0x8a7a60, s * w * 0.18, h * 0.98, -w * 0.72)); });
        yeuxY = h * 0.78; yeuxZ = -w * 0.95; ecart = w * 0.14;
      } else if (L.forme === 'araignee') {
        // corps bas et large, huit pattes en éventail
        grp.add(boite(w * 0.7, h * 0.5, w * 0.8, col[0], 0, h * 0.45, w * 0.1));
        grp.add(boite(w * 0.45, h * 0.42, w * 0.4, col[1], 0, h * 0.45, -w * 0.45));
        for (var i = 0; i < 4; i++) {
          [-1, 1].forEach(function (s) {
            var patte = boite(w * 0.55, h * 0.1, h * 0.1, col[0], s * w * 0.55, h * 0.35, -w * 0.25 + i * w * 0.2);
            patte.rotation.z = s * 0.45;
            grp.add(patte);
          });
        }
        yeuxY = h * 0.52; yeuxZ = -w * 0.66; ecart = w * 0.1;
      } else if (L.forme === 'cube') {
        // gelée translucide et son noyau plus sombre
        var gel = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat(col[0], { transparent: true, opacity: 0.72 }));
        gel.position.y = h / 2;
        grp.add(gel);
        grp.add(boite(w * 0.45, h * 0.45, w * 0.45, col[1], 0, h * 0.45, 0));
        yeuxY = h * 0.68; yeuxZ = -w * 0.51; ecart = w * 0.18;
      } else if (L.forme === 'poisson') {
        // corps fuselé dans l'axe, queue battante, nageoire dorsale
        var lg = w * (L.allonge || 1.3);
        grp.add(boite(w * 0.55, h * 0.8, lg, col[0], 0, h * 0.5, 0));
        grp.add(boite(w * 0.5, h * 0.3, lg * 0.8, col[1], 0, h * 0.2, 0));
        queue = boite(0.05, h * 0.9, w * 0.45, col[0], 0, h * 0.5, lg * 0.6);
        grp.add(queue);
        if (L.aileron) grp.add(boite(0.06, h * 0.6, w * 0.4, col[0], 0, h * 1.1, 0));
        if (L.pics) [-1, 1].forEach(function (s) {
          for (var k = -1; k <= 1; k++) grp.add(boite(0.12, 0.12, 0.3, 0xe0a060, s * w * 0.3, h * (0.5 + k * 0.3), k * 0.3));
        });
        yeuxY = h * 0.62; yeuxZ = -lg * 0.5; ecart = w * 0.22;
      } else if (L.forme === 'calmar') {
        grp.add(boite(w * 0.7, h * 0.7, w * 0.7, col[0], 0, h * 0.6, 0));
        for (var t = 0; t < 8; t++) {
          var a = t / 8 * Math.PI * 2;
          grp.add(boite(0.08, h * 0.5, 0.08, col[1], Math.cos(a) * w * 0.25, h * 0.1, Math.sin(a) * w * 0.25));
        }
        yeuxY = h * 0.6; yeuxZ = -w * 0.36; ecart = w * 0.2;
      } else if (L.forme === 'meduse') {
        var cloche = new THREE.Mesh(new THREE.SphereGeometry(w * 0.45, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
                                    mat(col[0], { transparent: true, opacity: 0.6, emissive: 0x401040 }));
        cloche.position.y = h * 0.5;
        grp.add(cloche);
        for (var f = 0; f < 6; f++) {
          var b = f / 6 * Math.PI * 2;
          grp.add(boite(0.03, h * 0.6, 0.03, col[1], Math.cos(b) * w * 0.25, h * 0.2, Math.sin(b) * w * 0.25));
        }
        yeuxY = -10; yeuxZ = 0; ecart = 0;
      } else if (L.forme === 'crabe') {
        grp.add(boite(w, h * 0.5, w * 0.7, col[0], 0, h * 0.5, 0));
        [-1, 1].forEach(function (s) {
          grp.add(boite(w * 0.25, h * 0.3, w * 0.25, col[1], s * w * 0.55, h * 0.55, -w * 0.4));
          for (var k = 0; k < 3; k++) grp.add(boite(w * 0.3, 0.05, 0.05, col[0], s * w * 0.6, h * 0.2, -0.1 + k * 0.12));
        });
        yeuxY = h * 0.85; yeuxZ = -w * 0.3; ecart = w * 0.15;
      } else if (L.forme === 'tortue') {
        grp.add(boite(w * 0.9, h * 0.5, w * 1.1, col[0], 0, h * 0.45, 0));
        grp.add(boite(w * 0.3, h * 0.3, w * 0.3, col[1], 0, h * 0.35, -w * 0.65));
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
          grp.add(boite(w * 0.3, h * 0.12, w * 0.2, col[1], p[0] * w * 0.5, h * 0.2, p[1] * w * 0.4));
        });
        yeuxY = h * 0.4; yeuxZ = -w * 0.8; ecart = w * 0.08;
      } else if (L.forme === 'oiseau' || L.forme === 'oiseau_sol' || L.forme === 'wyverne') {
        // corps, tête, bec ; deux ailes animées (voir syncEntities)
        var wy = L.forme === 'wyverne';
        grp.add(boite(w * 0.5, h * 0.5, w * 1.1, col[0], 0, h * 0.5, 0));
        grp.add(boite(w * 0.4, h * 0.4, w * 0.4, col[1], 0, h * 0.75, -w * 0.6));
        grp.add(boite(w * 0.12, w * 0.1, w * 0.25, L.bec || 0x333333, 0, h * 0.72, -w * 0.9));
        [-1, 1].forEach(function (s) {
          var aile = new THREE.Group();
          aile.position.set(s * w * 0.25, h * 0.6, 0);
          aile.add(boite(w * (wy ? 1.4 : 0.9), 0.05, w * (wy ? 0.9 : 0.6), wy ? col[1] : col[0], s * w * (wy ? 0.7 : 0.45), 0, 0));
          aile.userData.sens = s;
          grp.add(aile);
          ailes.push(aile);
        });
        if (L.forme === 'oiseau_sol') {
          [-1, 1].forEach(function (s) { grp.add(boite(0.05, h * 0.3, 0.05, 0xe8a030, s * w * 0.15, h * 0.15, 0)); });
          grp.add(boite(0.08, 0.12, 0.1, 0xd02020, 0, h * 0.98, -w * 0.6));
        }
        if (wy) {
          queue = boite(w * 0.2, h * 0.2, w * 0.9, col[0], 0, h * 0.45, w * 0.95);
          grp.add(queue);
        }
        yeuxY = h * 0.8; yeuxZ = -w * 0.81; ecart = w * 0.12;
      } else if (L.forme === 'serpent') {
        // anneaux successifs derrière la tête
        for (var n = 0; n < 6; n++) {
          grp.add(boite(w * (0.6 - n * 0.05), h * (0.55 - n * 0.04), w * 0.5, n % 2 ? col[1] : col[0],
                        Math.sin(n * 0.9) * w * 0.3, h * 0.3, w * 0.45 * n));
        }
        grp.add(boite(w * 0.7, h * 0.5, w * 0.6, col[0], 0, h * 0.4, -w * 0.45));
        yeuxY = h * 0.55; yeuxZ = -w * 0.76; ecart = w * 0.2;
      } else {
        // bipède : le gabarit d'origine, affiné pour les squelettes
        var ep = L.mince ? 0.45 : 0.7;
        grp.add(boite(w * (L.mince ? 0.7 : 1), h * 0.62, w * ep, col[0], 0, h * 0.31, 0));
        grp.add(boite(w * 0.75, h * 0.28, w * 0.75, col[1], 0, h * 0.76, 0));
        if (L.chapeau) {
          grp.add(boite(w * 1.2, 0.06, w * 1.2, 0x2a1a3a, 0, h * 0.92, 0));
          grp.add(boite(w * 0.5, h * 0.25, w * 0.5, 0x2a1a3a, 0, h * 1.05, 0));
        }
        yeuxY = h * 0.78; yeuxZ = -w * 0.38; ecart = w * 0.18;
        main = { x: w * 0.55, y: h * 0.45, z: -w * 0.2 };
      }
      // deux yeux, pour qu'on voie où le mob regarde
      var eyeMat = new THREE.MeshBasicMaterial({ color: L.yeux });
      [-1, 1].forEach(function (s) {
        var e = new THREE.Mesh(new THREE.BoxGeometry(0.08 * Math.max(1, w), 0.08 * Math.max(1, w), 0.02), eyeMat);
        e.position.set(s * ecart, yeuxY, yeuxZ);
        grp.add(e);
      });
      // arme en main droite
      var arme = entite && (entite.arme || (spec && spec.arme));
      if (arme && main) {
        var am = armeMesh(arme, Math.max(1, w * 1.2));
        if (am) { am.position.set(main.x, main.y, main.z); am.rotation.x = -0.6; grp.add(am); }
      }
      if (L.couronne) {
        var or = mat(0xf0c040);
        var cw = Math.max(0.4, w * 0.6);
        var base = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.12, cw), or);
        base.position.y = h + 0.08;
        grp.add(base);
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
          var pic = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.1), or);
          pic.position.set(p[0] * cw * 0.4, h + 0.22, p[1] * cw * 0.4);
          grp.add(pic);
        });
      }
      grp.userData.ailes = ailes;
      grp.userData.queue = queue;
      return grp;
    }

    /* Petites animations : ailes qui battent, queue qui ondule, hélice. */
    function animer(m, e) {
      var t = e.age || 0;
      var ailes = m.userData.ailes;
      if (ailes && ailes.length) {
        var battement = Math.sin(t * (e.type === 'boss_wyverne' ? 5 : 16)) * 0.7;
        ailes.forEach(function (a) { a.rotation.z = a.userData.sens * battement; });
      }
      if (m.userData.queue) m.userData.queue.rotation.y = Math.sin(t * 8) * 0.5;
      if (m.userData.helice && e.vehicule) {
        m.userData.helice.rotation.z += Math.min(1.2, Math.abs(e.vitesse || 0) * 0.08 + 0.02);
      }
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

    /* Joueurs distants : meme representation que les mobs, avec une etiquette
       de nom. Ils vivent dans une table separee des entites locales pour ne
       pas etre simules deux fois. */
    var maillagesDistants = new Map();

    /* Etiquette de nom : un sprite toujours face a la camera. On la dessine
       sur un petit canvas plutot que d utiliser du DOM, pour qu elle soit
       occultee par le decor comme n importe quel objet de la scene. */
    function etiquetteNom(texte) {
      var cv = document.createElement('canvas');
      cv.width = 256; cv.height = 64;
      var ctx = cv.getContext('2d');
      ctx.font = 'bold 34px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var w = Math.min(248, ctx.measureText(texte).width + 24);
      ctx.fillStyle = 'rgba(10,12,16,.72)';
      ctx.fillRect((256 - w) / 2, 10, w, 44);
      ctx.fillStyle = '#e8eaed';
      ctx.fillText(texte, 128, 33, 240);
      var tex = new THREE.CanvasTexture(cv);
      tex.minFilter = THREE.LinearFilter;
      var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true,
                                                          depthTest: true }));
      sp.scale.set(1.6, 0.4, 1);
      sp.position.y = 2.15;
      return sp;
    }

    function syncDistants(net) {
      var vus = new Set();
      net.distants.forEach(function (d) {
        vus.add(d.id);
        var m = maillagesDistants.get(d.id);
        if (!m) {
          m = mobMesh('villager', { w: 0.6, h: 1.8 });
          m.traverse(function (o) {
            if (o.material && o.material.color) o.material.color.setHex(0x4a86c8);
          });
          m.add(etiquetteNom(d.nom || ('Joueur ' + d.id)));
          m.userData.nom = d.nom;
          scene.add(m);
          maillagesDistants.set(d.id, m);
        } else if (m.userData.nom !== d.nom && d.nom) {
          // le nom n arrive parfois qu apres la premiere position
          var vieille = m.children.filter(function (o) { return o.isSprite; });
          vieille.forEach(function (o) {
            m.remove(o);
            if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
          });
          m.add(etiquetteNom(d.nom));
          m.userData.nom = d.nom;
        }
        m.position.set(d.pos.x, d.pos.y, d.pos.z);
        m.rotation.y = d.yaw || 0;
      });
      maillagesDistants.forEach(function (m, id) {
        if (!vus.has(id)) { libererEntite(m); maillagesDistants.delete(id); }
      });

      // mobs simules par le serveur
      net.mobsDistants.forEach(function (d) {
        var cle = 'm' + d.eid;
        vus.add(cle);
        var m2 = maillagesDistants.get(cle);
        if (!m2) {
          m2 = mobMesh(d.type, MC.EntitySpecs[d.type] || MC.EntitySpecs.sheep, d);
          scene.add(m2);
          maillagesDistants.set(cle, m2);
        }
        m2.position.set(d.pos.x, d.pos.y, d.pos.z);
        m2.rotation.y = d.yaw || 0;
      });
      maillagesDistants.forEach(function (m, id) {
        if (!vus.has(id)) { libererEntite(m); maillagesDistants.delete(id); }
      });
    }

    function syncEntities(entities, net) {
      if (net) syncDistants(net);
      var seen = new Set();
      for (var i = 0; i < entities.list.length; i++) {
        var e = entities.list[i];
        seen.add(e.eid);
        var m = entityMeshes.get(e.eid);
        if (!m) {
          m = e.type === 'item' ? itemMesh(e.item) : mobMesh(e.type, entities.SPECS[e.type], e);
          m.userData.blesse = false;
          scene.add(m);
          entityMeshes.set(e.eid, m);
        }
        m.position.set(e.pos.x, e.pos.y, e.pos.z);
        if (e.type === 'item') {
          m.rotation.y = e.age * 1.8;
          m.position.y += 0.18 + Math.sin(e.age * 2.6) * 0.06;   // flottement
        } else if (e.type === 'arrow') {
          // un projectile pointe dans le sens de sa course
          var vh = Math.hypot(e.vel.x, e.vel.z);
          m.rotation.set(Math.atan2(e.vel.y, vh), Math.atan2(-e.vel.x, -e.vel.z), 0, 'YXZ');
        } else {
          m.rotation.y = e.yaw || 0;
          // l'avion se cabre quand il monte, pique quand il descend
          if (e.vehicule === 'avion') m.rotation.x = Math.max(-0.5, Math.min(0.5, e.vel.y * 0.06));
          animer(m, e);
          // clignotement rouge quand le mob vient d'être touché — seulement au changement
          var hurt = e.hurtCd > 0;
          if (m.userData.blesse !== hurt) {
            m.userData.blesse = hurt;
            m.traverse(function (o) {
              if (o.material && o.material.emissive)
                o.material.emissive.setHex(hurt ? 0x661111 : 0x000000);
            });
          }
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

    /* Une surbrillance par joueur : en écran partagé chacun vise un bloc
       différent, une seule boîte sauterait de l'un à l'autre. */
    var surbrillances = [highlight];
    function surbrillanceDe(i) {
      while (surbrillances.length <= i) {
        var h3 = new THREE.LineSegments(highlight.geometry, highlight.material);
        h3.visible = false;
        scene.add(h3);
        surbrillances.push(h3);
      }
      return surbrillances[i];
    }
    function setHighlight(target, index) {
      var h4 = surbrillanceDe(index || 0);
      if (!target) { h4.visible = false; return; }
      h4.visible = true;
      h4.position.set(target.x + 0.5, target.y + 0.5, target.z + 0.5);
    }

    function setCamera(pos, yaw, pitch, index) {
      var cam = cameraDe(index || 0);
      cam.position.set(pos.x, pos.y, pos.z);
      cam.rotation.set(pitch, yaw, 0, 'YXZ');
      return cam;
    }

    function resize() {
      var s = hostSize();
      sz = s;
      cameras.forEach(function (c2) { c2.aspect = s[0] / s[1]; c2.updateProjectionMatrix(); });
      renderer.setSize(s[0], s[1]);
    }

    /* Rendu en plusieurs vues. Le test de ciseaux limite chaque passe à son
       rectangle : sans lui, effacer le tampon pour la deuxième vue effacerait
       la première. WebGL compte les Y depuis le bas, l'interface depuis le
       haut : d'où l'inversion. */
    function renderViews(vues) {
      var taille = hostSize();
      if (!vues || vues.length <= 1) {
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, taille[0], taille[1]);
        renderer.render(scene, camera);
        return 1;
      }
      var H = taille[1];
      renderer.setScissorTest(true);
      for (var i = 0; i < vues.length; i++) {
        var v = vues[i];
        var y = H - v.y - v.h;
        renderer.setViewport(v.x, y, v.w, v.h);
        renderer.setScissor(v.x, y, v.w, v.h);
        var cam = cameraDe(i);
        var aspect = v.w / Math.max(1, v.h);
        if (cam.aspect !== aspect) { cam.aspect = aspect; cam.updateProjectionMatrix(); }
        renderer.render(scene, cam);
      }
      renderer.setScissorTest(false);
      return vues.length;
    }

    function render() { renderer.render(scene, camera); }

    return {
      scene: scene, camera: camera, renderer: renderer, sun: sun,
      syncChunk: syncChunk, disposeChunk: disposeChunk, syncEntities: syncEntities,
      updateAmbience: updateAmbience, setHighlight: setHighlight, setCamera: setCamera,
      updateTorches: updateTorches, torchPool: torchPool, MAX_TORCH_LIGHTS: MAX_TORCH_LIGHTS,
      libererToutesEntites: libererToutesEntites, syncDistants: syncDistants,
      maillagesDistants: maillagesDistants,
      get materiauxLiberes() { return liberees; },
      resize: resize, render: render, renderViews: renderViews,
      cameraDe: cameraDe, cameras: cameras, RENDER_DIST: RENDER_DIST,
      materials: { opaque: matOpaque, cutout: matCutout, blend: matBlend },
      entityMeshes: entityMeshes,
    };
  }

  MC.createRenderer = createRenderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
