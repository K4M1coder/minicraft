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
    // au-delà des chunks, le relief lointain porte la vue jusqu'à LOINTAIN_VUE blocs
    var lointainEtendue = 0;
    function recalerBrouillard() {
      var proche = RENDER_DIST * C.CHUNK_X;
      if (lointainEtendue > 0) {
        FOG_FAR = lointainEtendue * 0.47;
        FOG_NEAR = Math.min(proche * 0.9, FOG_FAR * 0.5);
      } else {
        FOG_NEAR = proche * 0.55; FOG_FAR = proche * 0.98;
      }
    }

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
    var camera = new THREE.PerspectiveCamera(72, sz[0] / sz[1], 0.1, 3000);

    /* Écran partagé : une caméra par joueur local, allouées à la demande.
       La première est `camera` ci-dessus, qui reste celle du joueur 1 — tout
       le code existant (ambiance, torches) continue de s'y référer. */
    var cameras = [camera];
    function cameraDe(i) {
      while (cameras.length <= i) {
        cameras.push(new THREE.PerspectiveCamera(72, sz[0] / sz[1], 0.1, 3000));
      }
      return cameras[i];
    }
    // le GPU choisi (SPEC-OPTION-004) : le navigateur n'en retient que la préférence
    var renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: opts.powerPreference || 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    // ombres portées du soleil (ou de la lune) sur le terrain proche
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setSize(sz[0], sz[1]);
    canvasHost.appendChild(renderer.domElement);

    var hemi = new THREE.HemisphereLight(0xdfefff, 0x4a5a44, 0.95);
    scene.add(hemi);
    var sun = new THREE.DirectionalLight(0xfff2d8, 0.55);
    scene.add(sun);
    scene.add(sun.target);
    /* Carte d'ombres : un cadre de CADRE_OMBRE blocs qui suit la caméra, calé
       sur la grille des texels (MC.Ombres.cascades) pour que les ombres ne
       scintillent pas quand on marche. Au-delà, le relief lointain porte son
       propre ombrage. */
    var CADRE_OMBRE = 96, RESOLUTION_OMBRE = 2048, RECUL_OMBRE = 240;
    sun.castShadow = true;
    sun.shadow.mapSize.set(RESOLUTION_OMBRE, RESOLUTION_OMBRE);
    sun.shadow.bias = -0.0005;
    if ('normalBias' in sun.shadow) sun.shadow.normalBias = 0.03;
    (function () {
      var sc = sun.shadow.camera;
      sc.left = -CADRE_OMBRE / 2; sc.right = CADRE_OMBRE / 2; sc.top = CADRE_OMBRE / 2; sc.bottom = -CADRE_OMBRE / 2;
      sc.near = 1; sc.far = RECUL_OMBRE * 2;
      sc.updateProjectionMatrix();
    })();
    var soleilDir = { value: new THREE.Vector3(0, 1, 0) }, forceOmbreNuages = { value: 0 };

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

    /* lumineux : lave, magma, lanternes marines. Sans éclairage : ils gardent
       leur éclat de nuit comme au fond des abysses, au lieu de s'assombrir. */
    var matLumineux = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true });

    /* Lumière des blocs (MC.Lumiere) : un attribut `lum` par sommet, ajouté
       comme une lueur chaude par-dessus l'éclairage du ciel. Plus discrète en
       plein jour, où le soleil domine, qu'au cœur de la nuit ou d'une grotte. */
    var forceTorches = { value: 1 };
    /* SPEC-SAISON-004 : teintes saisonnières du feuillage et de l'herbe, mises
       à jour une fois par image (majCiel) à partir de MC.DayCycle.teinteSaison —
       un calcul CPU bon marché, partagé par tous les chunks via ces uniforms. */
    var saisonCaduc = { value: new THREE.Color(0.5, 0.8, 0.4) };
    var saisonConifere = { value: new THREE.Color(0.24, 0.5, 0.28) };
    var saisonHerbe = { value: new THREE.Color(0.48, 0.75, 0.34) };
    var saisonDensite = { value: 1 };
    /* Eau : vent de surface et passe de réfraction (le décor vu à travers la
       surface, sans l'eau). Les paramètres d'onde arrivent par sommet. */
    var ventEau = { value: new THREE.Vector2(1, 0) };
    var refractionTex = { value: null }, refractionActive = { value: 0 }, tailleEcran = { value: new THREE.Vector2(1, 1) };
    var GLSL_CAUSTIQUES = [
      'float caustique(vec2 p, float t) {',
      '  vec2 q = p * 1.4;',
      '  float a = sin(q.x + t * 1.1 + sin(q.y * 1.7 + t)) * sin(q.y * 1.2 - t * 0.8 + sin(q.x * 1.3 - t * 0.6));',
      '  float b = sin(q.x * 0.7 - t * 0.9 + sin(q.y * 1.1)) * sin(q.y * 0.9 + t * 1.2);',
      '  return pow(abs(a * 0.6 + b * 0.4), 3.0) * 2.2;',
      '}', ''].join('\n');
    function avecLumiereDesBlocs(mat, eau) {
      mat.onBeforeCompile = function (sh) {
        sh.uniforms.tempsEau = UN.temps; sh.uniforms.ventEau = ventEau;
        /* Le vent au sol fait ployer herbes, fleurs, cultures et feuillages
           (attribut souple : pied fixe, sommet mobile) ; la phase dépend de la
           position, donc deux blocs voisins bougent ensemble, sans fissure. */
        sh.vertexShader = 'attribute float immerge;\nattribute float souple;\nattribute float feuillage;\n' +
          'varying float vImmerge;\nvarying float vFeuillage;\n' +
          'uniform float tempsEau; uniform vec2 ventEau;\n' +
          sh.vertexShader.replace('#include <begin_vertex>', ['#include <begin_vertex>',
            '  vImmerge = immerge;',
            '  vFeuillage = feuillage;',
            '  if (souple > 0.0) {',
            '    vec4 wpS = modelMatrix * vec4(transformed, 1.0);',
            '    float fS = length(ventEau);',
            '    vec2 dS = fS > 0.001 ? ventEau / fS : vec2(1.0, 0.0);',
            '    float phS = dot(wpS.xz, vec2(0.63, 0.41)) * 1.3 + tempsEau * (1.6 + fS * 3.0);',
            '    float ampS = (0.05 + 0.16 * fS) * souple;',
            '    transformed.xz += dS * ampS * (0.65 + 0.35 * sin(phS)) + vec2(-dS.y, dS.x) * ampS * 0.3 * sin(phS * 1.7 + 0.8);',
            '  }'].join('\n'));
        sh.uniforms.saisonCaduc = saisonCaduc; sh.uniforms.saisonConifere = saisonConifere;
        sh.uniforms.saisonHerbe = saisonHerbe; sh.uniforms.saisonDensite = saisonDensite;
        /* SPEC-SAISON-004 : teinte du feuillage caduc, du conifère et de
           l'herbe selon la saison (uniform, aucune reconstruction de chunk).
           Le feuillage caduc se clairsème l'hiver : un hachage stable par
           sommet (indépendant de l'image) le retire d'une fraction du chunk. */
        sh.fragmentShader = 'uniform float tempsEau;\nvarying float vImmerge;\nvarying float vFeuillage;\n' +
          'uniform vec3 saisonCaduc; uniform vec3 saisonConifere; uniform vec3 saisonHerbe; uniform float saisonDensite;\n' +
          GLSL_CAUSTIQUES + sh.fragmentShader.replace('#include <map_fragment>',
            ['#include <map_fragment>',
             '  if (vFeuillage > 0.5 && vFeuillage < 1.5) {',
             '    float hF = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);',
             '    if (hF > saisonDensite) discard;',
             '    diffuseColor.rgb *= saisonCaduc;',
             '  } else if (vFeuillage > 1.5 && vFeuillage < 2.5) { diffuseColor.rgb *= saisonConifere; }',
             '  else if (vFeuillage > 2.5) { diffuseColor.rgb *= saisonHerbe; }'].join('\n'));
        if (eau) {
          sh.uniforms.refractionTex = refractionTex; sh.uniforms.refractionActive = refractionActive;
          sh.uniforms.tailleEcran = tailleEcran;
          /* Ondes : la nature (onde.x) choisit amplitude, longueur, vitesse et
             écume ; le sens mêle courant (onde.yz) et vent (MC.Eau.directionOnde).
             Près du rivage (onde.w : profondeur), la vague se dresse et déferle. */
          sh.vertexShader = 'attribute vec4 onde;\nattribute vec4 onde2;\n' +
            'varying float vType; varying float vPhase; varying float vEcume; varying float vVit;\n' +
            sh.vertexShader.replace('#include <begin_vertex>', [
              '#include <begin_vertex>',
              '  vType = 0.0; vPhase = 0.0; vEcume = 0.0; vVit = 0.0;',
              '  if (onde.y > 0.0) {',
              '    float A = onde.x, L = onde.y, Vt = onde.z, E = onde.w, K = onde2.z;',
              '    vec2 vd = length(ventEau) > 0.001 ? normalize(ventEau) : vec2(1.0, 0.0);',
              '    vec2 fl = onde2.xy;',
              '    vec2 dir = length(fl) > 0.01 ? normalize(mix(vd, normalize(fl), K)) : vd;',
              '    vec4 wpE = modelMatrix * vec4(transformed, 1.0);',
              '    float ph = dot(wpE.xz, dir) * 6.2832 / L - tempsEau * Vt * 6.2832 / L;',
              '    float surf = mod(onde2.w, 2.0), chute = step(1.5, onde2.w);',
              '    transformed.y += surf * (sin(ph) + 0.35 * sin(ph * 2.3 + 1.7)) * A;',
              '    vType = 1.0 + chute * 5.0; vPhase = ph; vEcume = E; vVit = Vt;',
              '  }'].join('\n'));
          sh.fragmentShader = 'uniform sampler2D refractionTex; uniform float refractionActive; uniform vec2 tailleEcran;\n' +
            'varying float vType; varying float vPhase; varying float vEcume; varying float vVit;\n' + sh.fragmentShader;
        }
        sh.uniforms.forceTorches = forceTorches;
        sh.uniforms.carteNuages = UN.carte; sh.uniforms.deriveNuages = UN.derive; sh.uniforms.tempsNuages = UN.temps;
        sh.uniforms.couvNuages = UN.couvertureCiel; sh.uniforms.soleilDir = soleilDir; sh.uniforms.forceOmbreNuages = forceOmbreNuages;
        sh.vertexShader = 'attribute float lum;\nattribute float ciel;\nvarying float vLum;\nvarying float vCiel;\nvarying vec3 vMondeO;\n' +
          sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLum = lum;\n  vCiel = ciel;')
            .replace('#include <project_vertex>', '#include <project_vertex>\n  vMondeO = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        /* Les sources ajoutent leur lueur ; le ciel, lui, dose toute la
           lumière du soleil et de l'atmosphère : une grotte close est noire. */
        sh.fragmentShader = 'uniform float forceTorches;\nvarying float vLum;\nvarying float vCiel;\nvarying vec3 vMondeO;\n' +
          GLSL_OMBRE_NUAGES +
          sh.fragmentShader.replace('#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.8, 0.55) * pow(vLum, 2.2) * forceTorches;' +
            '\n  diffuseColor.rgb *= max(0.03, pow(vCiel, 1.3)) * ombreNuages(vMondeO);' +
            /* sous l'eau : la lumière bleuit et s'atténue avec la profondeur, et les
               caustiques dansent sur le fond (seulement de jour, sous le ciel) */
            '\n  if (vImmerge > 0.5) {' +
            '\n    float attE = exp(-vImmerge * 0.13);' +
            '\n    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.5, 0.78, 1.0), min(1.0, vImmerge / 5.0)) * (0.35 + 0.65 * attE);' +
            '\n    totalEmissiveRadiance += diffuseColor.rgb * caustique(vMondeO.xz, tempsEau) * 0.45 * attE * forceOmbreNuages * vCiel;' +
            '\n  }' +
            (eau ? '\n  if (vType > 0.5) {' +
                   '\n    float fo = vType > 5.5 ? step(0.55, fract(vMondeO.y * 1.3 + tempsEau * vVit * 0.25 + sin(vMondeO.x * 2.0 + vMondeO.z * 1.7) * 0.2))' +
                   '\n                           : smoothstep(0.55, 1.0, sin(vPhase));' +
                   '\n    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.96, 1.0), fo * vEcume);' +
                   /* réfraction : le décor, vu à travers la surface, ondule */
                   '\n    if (refractionActive > 0.5) {' +
                   '\n      vec2 uvR = gl_FragCoord.xy / tailleEcran + vec2(sin(vPhase), cos(vPhase * 1.3)) * 0.012;' +
                   '\n      vec3 fondR = texture2D(refractionTex, uvR).rgb;' +
                   '\n      totalEmissiveRadiance += fondR * 0.5 * (1.0 - fo * vEcume);' +
                   '\n      diffuseColor.rgb *= 0.55;' +
                   '\n      diffuseColor.a = 1.0;' +
                   '\n    }' +
                   '\n  }' : ''));
      };
      return mat;
    }
    /* Ombre des nuages au sol : la même lecture de texture que les cumulus
       (MC.Meteo.densiteNuage), au point où l'on rencontre la couche en
       remontant vers le soleil. Le ciel (vCiel) la module déjà : sous un toit,
       il n'y a plus de soleil à voiler. */
    var GLSL_OMBRE_NUAGES = [
      'uniform sampler2D carteNuages; uniform vec2 deriveNuages; uniform float tempsNuages; uniform float couvNuages;',
      'uniform vec3 soleilDir; uniform float forceOmbreNuages;',
      'float ombreNuages(vec3 m) {',
      '  if (forceOmbreNuages <= 0.0 || soleilDir.y <= 0.05) return 1.0;',
      '  vec2 q = m.xz + soleilDir.xz / soleilDir.y * (74.8 - m.y);',
      '  vec2 p = (q - deriveNuages) / 350.0; float e = tempsNuages / 90.0;',
      '  float nA = texture2D(carteNuages, p + vec2(e * 0.031, e * 0.017) + 0.137).a;',
      '  float nB = texture2D(carteNuages, p * 1.37 + vec2(-e * 0.023, e * 0.029) + 0.637).a;',
      '  float n = mix(nA, nB, 0.5 + 0.5 * sin(e * 1.3 + nA * 6.2832));',
      '  float champ = texture2D(carteNuages, (q - deriveNuages) / 9600.0 + vec2(tempsNuages / 60000.0, 0.0)).a;',
      '  float couv = clamp(0.30 + (couvNuages - 0.3) * 0.95 + (champ - 0.5) * 0.9, 0.0, 1.0);',
      '  float d = clamp((n - (0.62 - couv * 0.34)) * 5.0, 0.0, 1.0);',
      '  return 1.0 - 0.5 * d * forceOmbreNuages;',
      '}', ''].join('\n');
    avecLumiereDesBlocs(matOpaque); avecLumiereDesBlocs(matCutout); avecLumiereDesBlocs(matBlend, true);

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
      g.setAttribute('lum', new THREE.Float32BufferAttribute(raw.lums && raw.lums.length ? raw.lums
                                                               : new Float32Array(raw.positions.length / 3), 1));
      g.setAttribute('ciel', new THREE.Float32BufferAttribute(raw.ciels && raw.ciels.length ? raw.ciels
                                                                : new Float32Array(raw.positions.length / 3).fill(1), 1));
      var nv = raw.positions.length / 3;
      g.setAttribute('onde', new THREE.Float32BufferAttribute(raw.ondes && raw.ondes.length === nv * 4 ? raw.ondes
                                                                : new Float32Array(nv * 4), 4));
      g.setAttribute('onde2', new THREE.Float32BufferAttribute(raw.ondes2 && raw.ondes2.length === nv * 4 ? raw.ondes2
                                                                 : new Float32Array(nv * 4), 4));
      g.setAttribute('immerge', new THREE.Float32BufferAttribute(raw.immerges && raw.immerges.length === nv ? raw.immerges
                                                                   : new Float32Array(nv), 1));
      g.setAttribute('souple', new THREE.Float32BufferAttribute(raw.souples && raw.souples.length === nv ? raw.souples
                                                                  : new Float32Array(nv), 1));
      // SPEC-SAISON-004 : classe de teinte saisonnière par sommet (0 rien, 1
      // caduc, 2 conifère, 3 dessus d'herbe) — voir avecLumiereDesBlocs.
      g.setAttribute('feuillage', new THREE.Float32BufferAttribute(raw.feuillages && raw.feuillages.length === nv ? raw.feuillages
                                                                     : new Float32Array(nv), 1));
      g.setIndex(raw.indices);
      g.computeBoundingSphere();
      return g;
    }

    // une passe de rendu = un maillage par chunk ; l'ordre de rendu va
    // de l'opaque au fondu, ce dernier devant être dessiné en dernier
    var PASSES = [['mesh', matOpaque, 'opaque', 0],
                  ['meshL', matLumineux, 'lumineux', 0],
                  ['meshC', matCutout, 'cutout', 1],
                  ['meshT', matBlend, 'blend', 2]];

    var maillagesEau = new Set();
    function syncChunk(world, chunk, simplifie) {
      var sample = world.getBlock;
      var passes = PASSES;
      // une propagation de lumière par chunk, partagée par ses quatre passes
      var lumiere = MC.Lumiere && world.chunkDe ? MC.Lumiere.eclairer(world.chunkDe, chunk.cx, chunk.cz) : null;
      // l'eau des chunks voisins : les coins partagés s'agitent pareil des deux côtés
      function eauDe(wx, wz) {
        var c2 = world.chunkDe && world.chunkDe(Math.floor(wx / C.CHUNK_X), Math.floor(wz / C.CHUNK_Z));
        if (!c2 || !c2.eau) return null;
        var k = (wz - c2.cz * C.CHUNK_Z) * C.CHUNK_X + (wx - c2.cx * C.CHUNK_X);
        if (!c2.eau.nature[k]) return null;
        return { nature: c2.eau.nature[k], flux: { x: c2.eau.flux[k * 2] / 127, z: c2.eau.flux[k * 2 + 1] / 127 }, prof: c2.eau.prof[k] };
      }
      chunk.sourcesLumiere = lumiere ? lumiere.sources : 0;
      // gardée sur le chunk : les créatures qui s'y tiennent en prennent leur éclat
      chunk.lumiere = lumiere;
      for (var i = 0; i < passes.length; i++) {
        var key = passes[i][0], mat = passes[i][1], pass = passes[i][2];
        var raw = MC.Mesher.buildChunk(chunk, pass, sample, lumiere, eauDe, !!simplifie);
        if (chunk[key]) { maillagesEau.delete(chunk[key]); scene.remove(chunk[key]); chunk[key].geometry.dispose(); chunk[key] = null; }
        if (raw) {
          var m = new THREE.Mesh(toGeometry(raw), mat);
          m.position.set(chunk.cx * C.CHUNK_X, 0, chunk.cz * C.CHUNK_Z);
          m.renderOrder = passes[i][3];
          m.castShadow = pass !== 'blend';
          m.receiveShadow = true;
          if (pass === 'blend') maillagesEau.add(m);
          scene.add(m);
          chunk[key] = m;
        }
      }
      chunk.dirty = false;
      chunk.simplifie = !!simplifie;
    }

    function disposeChunk(chunk) {
      PASSES.forEach(function (p) {
        var k = p[0];
        if (chunk[k]) { maillagesEau.delete(chunk[k]); scene.remove(chunk[k]); chunk[k].geometry.dispose(); chunk[k] = null; }
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
      villager: { forme: 'bipede', c: [0x6b4f3a, 0xc9a882], yeux: 0x222222, humain: true },
      joueur:   { forme: 'bipede', c: [0x4a86c8, 0xc9a882], yeux: 0x222222, humain: true },
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
      pillager: { forme: 'bipede', c: [0x4a4a52, 0x9a8a78], yeux: 0x111111, humain: true },
      vindicator: { forme: 'bipede', c: [0x2a2a30, 0x9a8a78], yeux: 0x111111, humain: true },
      garde:    { forme: 'bipede', c: [0x3a5a9a, 0xc9a882], yeux: 0x222222, humain: true },
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
      var m = new THREE.MeshLambertMaterial(o);
      // couleur d'origine : l'éclat de la case où se tient la créature la module
      m.userData.base = m.color.clone();
      return m;
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
                               avion: 0xd8d8e0, sous_marin: 0xe0c030, wagonnet: 0x6a6a72 };
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
      } else if (nom === 'wagonnet') {
        // une benne ouverte sur quatre roues
        grp.add(boite(w, 0.12, w * 1.2, c, 0, 0.25, 0));
        [[-1, 0], [1, 0]].forEach(function (p) { grp.add(boite(0.08, h * 0.6, w * 1.2, c, p[0] * w / 2, 0.5, 0)); });
        [[0, -1], [0, 1]].forEach(function (p) { grp.add(boite(w, h * 0.6, 0.08, c, 0, 0.5, p[1] * w * 0.6)); });
        [-1, 1].forEach(function (sx) { roue(sx * w * 0.45, -w * 0.35, 0.14); roue(sx * w * 0.45, w * 0.35, 0.14); });
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
      /* SPEC-MOB-010 : chaque individu a sa variante (taille, teinte, et pour
         les humains vêtements selon le métier et accessoire) ; ses membres
         sont articulés pour que la pose (MC.Apparence.pose) les anime. */
      var AP = MC.Apparence;
      var va = AP ? AP.variante(type, entite ? (entite.pnj || entite.nom || entite.eid || entite.id || 0) : 0, entite && entite.role) : null;
      if (va && !L.variantes) col = [AP.teinter(col[0], va.teinte), AP.teinter(col[1], va.teinte * 0.6)];
      var membres = null, teteG = null, yeuxFaits = false;
      // un membre pivote à son attache (hanche, épaule, cou) : la boîte pend dessous
      function membre(lx, ly, lz, couleur, px, py, pz) {
        var gm = new THREE.Group();
        gm.position.set(px, py, pz);
        gm.add(boite(lx, ly, lz, couleur, 0, -ly / 2, 0));
        grp.add(gm);
        return gm;
      }
      function yeuxDans(tete, y, z, ec) {
        var em = new THREE.MeshBasicMaterial({ color: L.yeux });
        [-1, 1].forEach(function (s) {
          var e = new THREE.Mesh(new THREE.BoxGeometry(0.08 * Math.max(1, w), 0.08 * Math.max(1, w), 0.02), em);
          e.position.set(s * ec, y, z);
          tete.add(e);
        });
        yeuxFaits = true;
      }

      if (L.forme === 'quadrupede') {
        // corps horizontal sur quatre pattes articulées, tête en avant (vers -Z) sur son cou
        var pl = h * 0.4;
        grp.add(boite(w * 0.8, h * 0.45, w * 1.3, col[0], 0, pl + h * 0.22, 0.05));
        var pattes = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(function (p) {
          return membre(w * 0.2, pl, w * 0.2, col[0], p[0] * w * 0.26, pl, p[1] * w * 0.45);
        });
        teteG = new THREE.Group();
        teteG.position.set(0, h * 0.62, -w * 0.6);
        teteG.add(boite(w * 0.55, h * 0.4, w * 0.45, col[1], 0, h * 0.1, -w * 0.12));
        if (L.cornes) [-1, 1].forEach(function (s) { teteG.add(boite(0.06, 0.2, 0.06, 0x8a7a60, s * w * 0.18, h * 0.36, -w * 0.12)); });
        grp.add(teteG);
        yeuxDans(teteG, h * 0.16, -w * 0.35, w * 0.14);
        membres = { jambeG: pattes[0], jambeD: pattes[1], brasG: pattes[3], brasD: pattes[2], tete: teteG, quadrupede: true };
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
        // bipède articulé : jambes, buste, bras, tête sur le cou
        var fin = L.mince ? 0.6 : 1;
        var haut = va && va.haut !== undefined ? va.haut : col[0], bas = va && va.bas !== undefined ? va.bas : AP ? AP.teinter(col[0], -0.25) : col[0];
        var peau = va && va.peau !== undefined ? va.peau : col[1];
        var hj = h * 0.38, hb = h * 0.34, ht = h * 0.24, lb = w * 0.3 * fin;
        var jg = membre(w * 0.34 * fin, hj, w * 0.36 * fin, bas, -w * 0.2, hj, 0);
        var jd = membre(w * 0.34 * fin, hj, w * 0.36 * fin, bas, w * 0.2, hj, 0);
        var buste = boite(w * (L.mince ? 0.7 : 0.9), hb, w * 0.5 * (L.mince ? 0.8 : 1), haut, 0, hj + hb / 2, 0);
        grp.add(buste);
        var bg = membre(lb, hb * 1.02, lb, L.humain ? haut : col[0], -w * 0.45 - lb * 0.1, hj + hb * 0.97, 0);
        var bd = membre(lb, hb * 1.02, lb, L.humain ? haut : col[0], w * 0.45 + lb * 0.1, hj + hb * 0.97, 0);
        if (L.humain) [bg, bd].forEach(function (b) { b.add(boite(lb * 0.95, hb * 0.22, lb * 0.95, peau, 0, -hb * 0.95, 0)); });
        teteG = new THREE.Group();
        teteG.position.set(0, hj + hb, 0);
        teteG.add(boite(w * 0.75, ht, w * 0.75, L.humain ? peau : col[1], 0, ht / 2, 0));
        if (L.humain && va && va.cheveux !== undefined) teteG.add(boite(w * 0.78, ht * 0.22, w * 0.78, va.cheveux, 0, ht * 0.93, 0.01));
        grp.add(teteG);
        yeuxDans(teteG, ht * 0.55, -w * 0.38, w * 0.18);
        var acc = (va && va.accessoire) || (L.chapeau ? 'chapeau_sorciere' : null);
        accessoire(acc, teteG, buste, w, ht, hj, hb);
        membres = { jambeG: jg, jambeD: jd, brasG: bg, brasD: bd, tete: teteG, buste: buste };
        main = { bras: bd, y: -hb * 0.95, z: -w * 0.1 };
      }
      // deux yeux, pour qu'on voie où le mob regarde
      var eyeMat = new THREE.MeshBasicMaterial({ color: L.yeux });
      if (!yeuxFaits) [-1, 1].forEach(function (s) {
        var e = new THREE.Mesh(new THREE.BoxGeometry(0.08 * Math.max(1, w), 0.08 * Math.max(1, w), 0.02), eyeMat);
        e.position.set(s * ecart, yeuxY, yeuxZ);
        grp.add(e);
      });
      // arme en main droite
      var arme = entite && (entite.arme || (spec && spec.arme));
      if (arme && main) {
        var am = armeMesh(arme, Math.max(1, w * 1.2));
        // tenue au bout du bras droit : elle suit le coup
        if (am) { am.position.set(0, main.y, main.z); am.rotation.x = -1.2; main.bras.add(am); }
      }
      if (L.couronne) {
        var or = mat(0xf0c040);
        var cw = Math.max(0.4, w * 0.6);
        // sur la tête quand elle est articulée : la couronne suit le regard
        var porte = teteG && !membres.quadrupede ? teteG : grp, dy = porte === grp ? 0 : -teteG.position.y;
        var base = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.12, cw), or);
        base.position.y = h + 0.08 + dy;
        porte.add(base);
        [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (p) {
          var pic = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.1), or);
          pic.position.set(p[0] * cw * 0.4, h + 0.22 + dy, p[1] * cw * 0.4);
          porte.add(pic);
        });
      }
      grp.userData.ailes = ailes;
      grp.userData.queue = queue;
      grp.userData.membres = membres;
      grp.userData.phase = 0;
      if (va && !(spec && spec.boss)) grp.userData.echelle = va.echelle;
      // au loin, une silhouette d'une seule boîte remplace le modèle complet
      var detail = new THREE.Group();
      while (grp.children.length) detail.add(grp.children[0]);
      grp.add(detail);
      var simple = boite(Math.max(0.3, w * (L.forme === 'bipede' ? 0.8 : 1)), h * 0.95, Math.max(0.3, w * (L.forme === 'quadrupede' ? 1.3 : 0.6)),
                         col[0], 0, h * 0.48, 0);
      simple.visible = false;
      grp.add(simple);
      grp.userData.detail = detail;
      grp.userData.simple = simple;
      grp.userData.yeux = spec ? spec.h * 0.85 : 1.5;
      grp.userData.vmax = spec ? spec.speed : 2;
      return grp;
    }

    /* Accessoires des bipèdes : sur la tête ou le buste. */
    function accessoire(nom, tete, buste, w, ht, hj, hb) {
      if (!nom) return;
      var bs = buste.position;
      if (nom === 'chapeau_sorciere') {
        tete.add(boite(w * 1.2, 0.06, w * 1.2, 0x2a1a3a, 0, ht, 0));
        tete.add(boite(w * 0.5, ht * 1.1, w * 0.5, 0x2a1a3a, 0, ht * 1.55, 0));
      } else if (nom === 'chapeau_paille') {
        tete.add(boite(w * 1.3, 0.05, w * 1.3, 0xd8c070, 0, ht, 0));
        tete.add(boite(w * 0.7, ht * 0.35, w * 0.7, 0xd8c070, 0, ht * 1.15, 0));
      } else if (nom === 'chapeau_haut') {
        tete.add(boite(w * 0.95, 0.04, w * 0.95, 0x141418, 0, ht, 0));
        tete.add(boite(w * 0.6, ht * 0.8, w * 0.6, 0x141418, 0, ht * 1.4, 0));
      } else if (nom === 'bonnet') {
        tete.add(boite(w * 0.8, ht * 0.35, w * 0.8, 0xa03030, 0, ht * 0.95, 0));
      } else if (nom === 'casquette') {
        tete.add(boite(w * 0.8, ht * 0.25, w * 0.8, 0x2a5aa0, 0, ht * 0.95, 0));
        tete.add(boite(w * 0.6, 0.04, w * 0.35, 0x2a5aa0, 0, ht * 0.85, -w * 0.5));
      } else if (nom === 'casque') {
        tete.add(boite(w * 0.84, ht * 0.5, w * 0.84, 0x9a9aa2, 0, ht * 0.8, 0));
      } else if (nom === 'capuche') {
        tete.add(boite(w * 0.86, ht * 0.9, w * 0.86, 0xd8d8e0, 0, ht * 0.6, 0.04));
      } else if (nom === 'lunettes') {
        tete.add(boite(w * 0.6, 0.05, 0.03, 0x202020, 0, ht * 0.55, -w * 0.4));
      } else if (nom === 'tablier') {
        buste.parent.add(boite(w * 0.7, hb * 1.3, 0.04, 0x6a4a2a, 0, bs.y - hb * 0.2, -w * 0.27));
      } else if (nom === 'sac') {
        buste.parent.add(boite(w * 0.6, hb * 0.6, w * 0.3, 0x7a5a3a, 0, bs.y, w * 0.4));
      } else if (nom === 'echarpe') {
        buste.parent.add(boite(w * 0.95, hb * 0.18, w * 0.55, 0xd0a040, 0, bs.y + hb * 0.42, 0));
      }
    }

    /* SPEC-MOB-010 : la pose du moment (allure, pas, coup, regard) sur les
       membres, et le niveau de détail selon la distance à la caméra. */
    var posPrec = new Map();
    function animerMembres(m, e, dt, cle) {
      var AP = MC.Apparence, mb = m.userData.membres;
      var d = camera.position.distanceTo(m.position);
      var niv = AP ? AP.niveauDetail(d) : 'complet';
      if (m.userData.detail) {
        m.userData.detail.visible = niv === 'complet';
        m.userData.simple.visible = niv === 'simple';
      }
      if (!mb || !AP || niv !== 'complet') return niv;
      // vitesse : celle de l'entité, ou mesurée d'une image à l'autre (entités distantes)
      var v;
      if (e.vel) v = Math.hypot(e.vel.x, e.vel.z);
      else {
        var p0 = posPrec.get(cle);
        v = p0 && dt > 0 ? Math.hypot(e.pos.x - p0.x, e.pos.z - p0.z) / dt : 0;
        posPrec.set(cle, { x: e.pos.x, z: e.pos.z });
      }
      var al = AP.allure(v, m.userData.vmax, !!e.nage || !!e.dansEau);
      m.userData.phase = AP.avancerPhase(m.userData.phase, Math.max(v, al === 'nage' ? 1 : 0), dt);
      var age = e.age || 0;
      var att = e.coupA !== undefined && age - e.coupA < 0.45 ? (age - e.coupA) / 0.45 : -1;
      var p = AP.pose({ allure: al, phase: m.userData.phase, attaque: att, temps: age,
                        regard: AP.regard(e.pos, e.yaw || 0, m.userData.yeux, e.vise) });
      mb.jambeG.rotation.x = p.jambeG; mb.jambeD.rotation.x = p.jambeD;
      mb.brasG.rotation.x = p.brasG; mb.brasD.rotation.x = p.brasD;
      mb.tete.rotation.set(-p.tete.tangage, p.tete.lacet, 0, 'YXZ');
      if (mb.buste) m.userData.detail.rotation.x = -p.buste * 0.35;
      m.userData.pose = p;
      return niv;
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
          m = mobMesh('joueur', { w: 0.6, h: 1.8, speed: 4.8 }, { id: d.nom || d.id });
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
        animerMembres(m, d, dtEntites, 'j' + d.id);
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
          m2 = d.type === 'item' && d.item ? itemMesh(d.item)
             : mobMesh(d.type, MC.EntitySpecs[d.type] || MC.EntitySpecs.sheep, d);
          scene.add(m2);
          maillagesDistants.set(cle, m2);
        }
        m2.position.set(d.pos.x, d.pos.y, d.pos.z);
        m2.rotation.y = d.yaw || 0;
        animerMembres(m2, d, dtEntites, cle);
      });
      maillagesDistants.forEach(function (m, id) {
        if (!vus.has(id)) { libererEntite(m); maillagesDistants.delete(id); }
      });
    }

    /* Éclat d'une créature : la lumière de sa case (ciel et sources), selon
       la même règle que le terrain — une créature ne luit pas au fond d'une grotte. */
    var TORCHE = new THREE.Color(1, 0.8, 0.55), ROUGE = new THREE.Color(0x661111);
    function eclairerEntite(m, e, lumiereEn, jour) {
      var l = lumiereEn(e.pos.x, e.pos.y + (e.h || 1) * 0.6, e.pos.z);
      var k = Math.max(0.03, Math.pow(l.ciel, 1.3)), t = Math.pow(l.bloc, 2.2) * (0.95 - 0.6 * jour);
      m.userData.eclat = k + t;
      m.traverse(function (o) {
        var mt = o.material;
        if (!mt || !mt.userData || !mt.userData.base) return;
        mt.color.copy(mt.userData.base).multiplyScalar(k);
        if (mt.emissive && !m.userData.blesse) mt.emissive.copy(mt.userData.base).multiply(TORCHE).multiplyScalar(t);
      });
    }
    var dernierSync = 0, dtEntites = 0;
    function syncEntities(entities, net, lumiereEn, jour) {
      var maintenant = typeof performance !== 'undefined' ? performance.now() : Date.now();
      dtEntites = dernierSync ? Math.min(0.1, (maintenant - dernierSync) / 1000) : 0.016;
      dernierSync = maintenant;
      if (net) syncDistants(net);
      var seen = new Set();
      for (var i = 0; i < entities.list.length; i++) {
        var e = entities.list[i];
        seen.add(e.eid);
        var m = entityMeshes.get(e.eid);
        if (!m) {
          m = e.type === 'item' ? itemMesh(e.item) : mobMesh(e.type, entities.SPECS[e.type], e);
          m.userData.blesse = false;
          m.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
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
          // un petit : même créature, à demi-taille
          var ech = e.bebe ? 0.55 : 1;
          if (m.scale.x !== ech) m.scale.setScalar(ech);
          // l'avion se cabre quand il monte, pique quand il descend
          if (e.vehicule === 'avion') m.rotation.x = Math.max(-0.5, Math.min(0.5, e.vel.y * 0.06));
          animer(m, e);
          animerMembres(m, e, dtEntites, e.eid);
          if (m.userData.echelle && !e.bebe && m.scale.x !== m.userData.echelle) m.scale.setScalar(m.userData.echelle);
          if (lumiereEn) {
            m.userData.lumT = (m.userData.lumT || 0) - 1;
            if (m.userData.lumT <= 0) { m.userData.lumT = 8; eclairerEntite(m, e, lumiereEn, jour || 0); }
          }
          // clignotement rouge quand le mob vient d'être touché — seulement au changement
          var hurt = e.hurtCd > 0;
          if (m.userData.blesse !== hurt) {
            m.userData.blesse = hurt;
            m.traverse(function (o) {
              if (o.material && o.material.emissive) o.material.emissive.copy(hurt ? ROUGE : new THREE.Color(0));
            });
            m.userData.lumT = 0;
          }
        }
      }
      entityMeshes.forEach(function (m, id) {
        if (!seen.has(id)) { libererEntite(m); entityMeshes.delete(id); }
      });
    }

    // ─── ciel : soleil, lune, étoiles, nuages ─────────────────────────────────
    /* Tout le ciel suit la caméra : astres et étoiles à distance fixe, dans
       le fond de la scène (dessinés en premier, sans écrire la profondeur, le
       relief passe donc devant). Ils échappent au brouillard, qui sinon les
       noierait dans la couleur du ciel. */
    // le ciel doit rester DEVANT le relief lointain, et DERRIÈRE rien d'autre
    var DIST_CIEL = 2000, KC = DIST_CIEL / 420;
    var ciel = new THREE.Group();
    ciel.renderOrder = -10;
    scene.add(ciel);

    function texture(larg, dessin) {
      var cv = document.createElement('canvas');
      cv.width = cv.height = larg;
      dessin(cv.getContext('2d'), larg);
      var t = new THREE.CanvasTexture(cv);
      t.magFilter = THREE.NearestFilter;
      return t;
    }
    function matCiel(o) {
      return new THREE.MeshBasicMaterial(Object.assign({ fog: false, depthWrite: false, transparent: true }, o));
    }

    // soleil : un disque carré, pixellisé comme le reste, et un halo additif
    var soleil = new THREE.Mesh(new THREE.PlaneGeometry(34 * KC, 34 * KC), matCiel({
      map: texture(16, function (c) {
        c.fillStyle = '#fff4c0'; c.fillRect(2, 2, 12, 12);
        c.fillStyle = '#ffe070'; c.fillRect(2, 2, 12, 2); c.fillRect(2, 12, 12, 2);
        c.fillStyle = '#fffbe8'; c.fillRect(5, 5, 6, 6);
      }),
    }));
    var halo = new THREE.Mesh(new THREE.PlaneGeometry(130 * KC, 130 * KC), matCiel({
      map: (function () {
        var t = texture(64, function (c) {
          var gr = c.createRadialGradient(32, 32, 2, 32, 32, 32);
          gr.addColorStop(0, 'rgba(255,240,190,0.55)'); gr.addColorStop(0.35, 'rgba(255,210,140,0.18)');
          gr.addColorStop(1, 'rgba(255,200,120,0)');
          c.fillStyle = gr; c.fillRect(0, 0, 64, 64);
        });
        t.magFilter = THREE.LinearFilter;
        return t;
      })(),
      blending: THREE.AdditiveBlending,
    }));
    ciel.add(halo); ciel.add(soleil);

    /* Lune : cratères, et une ombre qui dessine la phase (8 phases, une par
       jour). On repeint la texture à chaque changement de phase seulement. */
    var luneCanvas = document.createElement('canvas');
    luneCanvas.width = luneCanvas.height = 16;
    var luneTex = new THREE.CanvasTexture(luneCanvas);
    luneTex.magFilter = THREE.NearestFilter;
    var lune = new THREE.Mesh(new THREE.PlaneGeometry(26 * KC, 26 * KC), matCiel({ map: luneTex }));
    ciel.add(lune);
    var phaseDessinee = -1;
    function dessinerLune(ph) {
      var c = luneCanvas.getContext('2d');
      c.clearRect(0, 0, 16, 16);
      c.fillStyle = '#e8ecf4'; c.fillRect(2, 2, 12, 12);
      c.fillStyle = '#b8c0cc';
      [[4, 4, 2], [9, 6, 3], [5, 10, 2], [10, 11, 1]].forEach(function (k) { c.fillRect(k[0], k[1], k[2], k[2]); });
      // la part non éclairée, de 0 (nouvelle, tout sombre) à 4 (pleine, rien)
      var eclairee = ph <= 4 ? ph / 4 : (8 - ph) / 4;
      var ombre = Math.round(12 * (1 - eclairee));
      c.fillStyle = 'rgba(12,16,32,0.92)';
      if (ph <= 4) c.fillRect(2, 2, ombre, 12);
      else c.fillRect(14 - ombre, 2, ombre, 12);
      luneTex.needsUpdate = true;
      phaseDessinee = ph;
    }

    // étoiles : des points sur la voûte, qui s'éteignent au lever du jour
    var etoilesGeo = new THREE.BufferGeometry();
    (function () {
      var pos = [], col = [], graine = 99;
      function r() { graine = (graine * 16807) % 2147483647; return graine / 2147483647; }
      for (var i = 0; i < 1400; i++) {
        var u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        var y = Math.abs(u) * 0.95 + 0.05 * u;                   // surtout au-dessus de l'horizon
        pos.push(Math.cos(a) * s * DIST_CIEL, y * DIST_CIEL, Math.sin(a) * s * DIST_CIEL);
        var b = 0.55 + r() * 0.45, bleu = r() < 0.2;
        col.push(bleu ? b * 0.8 : b, bleu ? b * 0.9 : b, b);
      }
      etoilesGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      etoilesGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    })();
    var etoilesMat = new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true,
                                                transparent: true, opacity: 0, fog: false, depthWrite: false });
    var etoiles = new THREE.Points(etoilesGeo, etoilesMat);
    etoiles.renderOrder = -11;
    ciel.add(etoiles);

    /* Nuages : une grande nappe texturée par un bruit TUILABLE (le motif
       boucle sans couture), qui dérive avec le vent. Un fondu radial calculé
       dans le shader les efface vers l'horizon, là où le brouillard n'agit pas. */
    var nuagesTex = (function () {
      var N = 128, cv = document.createElement('canvas');
      cv.width = cv.height = N;
      var c = cv.getContext('2d'), img = c.createImageData(N, N);
      var graine = 7;
      function r() { graine = (graine * 16807) % 2147483647; return graine / 2147483647; }
      // quatre octaves de bruit de valeur périodique
      var octaves = [8, 16, 32, 64].map(function (k) {
        var g2 = []; for (var i = 0; i < k * k; i++) g2.push(r()); return { k: k, g: g2 };
      });
      function bruit(o, x, y) {
        var fx = x / N * o.k, fy = y / N * o.k, x0 = Math.floor(fx), y0 = Math.floor(fy);
        var tx = fx - x0, ty = fy - y0, x1 = (x0 + 1) % o.k, y1 = (y0 + 1) % o.k;
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        var g2 = o.g, k = o.k;
        return (g2[y0 * k + x0] * (1 - tx) + g2[y0 * k + x1] * tx) * (1 - ty) +
               (g2[y1 * k + x0] * (1 - tx) + g2[y1 * k + x1] * tx) * ty;
      }
      for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
        var v = bruit(octaves[0], x, y) * 0.5 + bruit(octaves[1], x, y) * 0.25 +
                bruit(octaves[2], x, y) * 0.15 + bruit(octaves[3], x, y) * 0.1;
        // on garde le bruit BRUT : le seuil (la couverture du ciel) se règle
        // dans le shader, sans repeindre la texture quand le temps change
        var k2 = (y * N + x) * 4;
        img.data[k2] = img.data[k2 + 1] = img.data[k2 + 2] = 255;
        img.data[k2 + 3] = Math.round(Math.max(0, Math.min(1, v)) * 255);
      }
      c.putImageData(img, 0, 0);
      var t = new THREE.CanvasTexture(cv);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      // lissés : à plusieurs centaines de blocs par motif, des pixels francs feraient des dalles
      t.magFilter = THREE.LinearFilter;
      return t;
    })();
    /* Cinq couches (MC.Meteo.COUCHES), chacune faite de tranches empilées :
       un cumulus a de l'épaisseur, un cirrus n'est qu'un voile. Le shader
       reprend la formule de Meteo.densiteNuage sur une texture de bruit :
       - la forme se déforme avec le temps (deux lectures qui glissent l'une
         sur l'autre, mêlées selon une phase propre à chaque point) ;
       - un champ lent de rassemblement forme et dissipe des bancs entiers ;
       - la couverture suit la météo ;
       - une carte du relief éteint le nuage là où la roche monte : il
         contourne les sommets au lieu de les traverser. */
    var ME = MC.Meteo;
    var reliefTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    reliefTex.magFilter = reliefTex.minFilter = THREE.LinearFilter;
    var UN = {
      carte: { value: nuagesTex }, relief: { value: reliefTex },
      zoneRelief: { value: new THREE.Vector4(0, 0, 1, 0) },
      derive: { value: new THREE.Vector2() }, temps: { value: 0 },
      couvertureCiel: { value: 0.3 }, teinte: { value: new THREE.Color(1, 1, 1) }, sombre: { value: 0 },
      // deux cyclones au plus : (x, z, rayon, œil) et (force, sens) de chacun
      cyc: { value: [new THREE.Vector4(), new THREE.Vector4()] }, cycF: { value: new THREE.Vector4() },
    };
    // le vecteur caméra → point s'interpole bien, pas sa longueur : on la prend par pixel
    var VS_NUAGE = 'varying vec2 vMonde; varying vec2 vRel;' +
      'void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vMonde = w.xz;' +
      ' vRel = w.xz - cameraPosition.xz; gl_Position = projectionMatrix * viewMatrix * w; }';
    var FS_NUAGE = [
      'uniform sampler2D carte; uniform sampler2D relief; uniform vec4 zoneRelief;',
      'uniform vec2 derive; uniform float temps; uniform float couvertureCiel; uniform vec3 teinte; uniform float sombre;',
      'uniform float motif; uniform float etire; uniform float vent; uniform float couvCouche; uniform float opacite;',
      'uniform float ySlice; uniform float frac; uniform float dome; uniform float taille; uniform float graine;',
      'uniform vec2 deriveC; uniform vec4 cyc[2]; uniform vec4 cycF;',
      'varying vec2 vMonde; varying vec2 vRel;',
      'void main(){',
      '  float vDist = length(vRel);',
      // chaque couche dérive avec le vent de son altitude (SPEC-VENT-001)
      '  vec2 p = (vMonde - deriveC) / motif; p.x /= etire;',
      '  float e = temps / ' + ME.EVOLUTION.toFixed(1) + ';',
      '  float nA = texture2D(carte, p + vec2(e * 0.031, e * 0.017) + graine).a;',
      '  float nB = texture2D(carte, p * 1.37 + vec2(-e * 0.023, e * 0.029) + 0.5 + graine).a;',
      '  float n = mix(nA, nB, 0.5 + 0.5 * sin(e * 1.3 + nA * 6.2832));',
      '  float champ = texture2D(carte, (vMonde - derive) / 9600.0 + vec2(temps / 60000.0, 0.0)).a;',
      '  float couv = clamp(couvCouche + (couvertureCiel - 0.3) * 0.95 + (champ - 0.5) * 0.9, 0.0, 1.0);',
      // SPEC-NUAGE-003 : la spirale d'un cyclone, même formule que Meteo.influenceCyclone
      '  float oeilF = 1.0;',
      '  for (int k = 0; k < 2; k++) {',
      '    vec4 c = cyc[k]; float f = k == 0 ? cycF.x : cycF.z; float sn = k == 0 ? cycF.y : cycF.w;',
      '    if (f <= 0.0) continue;',
      '    vec2 dd = vMonde - c.xy; float dist = length(dd);',
      '    if (dist >= c.z) continue;',
      '    float r = dist / c.z, oe = c.w / c.z;',
      '    float bras = 0.5 + 0.5 * sin(atan(dd.y, dd.x) * 3.0 - r * 10.0 * sn + temps * 0.05 * sn);',
      '    float bande = smoothstep(oe, oe + 0.15, r) * (1.0 - smoothstep(0.75, 1.0, r));',
      '    couv = max(couv, clamp(bande * (0.5 + 0.5 * bras), 0.0, 1.0) * f * 0.95);',
      '    if (dist < c.w) oeilF = 0.15;',
      '  }',
      '  float seuil = 0.62 - couv * 0.34 + dome * frac * frac * 0.12;',
      '  float d = clamp((n - seuil) * 5.0, 0.0, 1.0) * oeilF;',
      '  if (zoneRelief.w > 0.5) {',
      '    vec2 r = (vMonde - zoneRelief.xy) / zoneRelief.z;',
      '    if (r.x > 0.0 && r.y > 0.0 && r.x < 1.0 && r.y < 1.0) {',
      '      float h = texture2D(relief, r).r * 255.0;',
      '      d *= clamp((ySlice - h - 1.0) / 3.0, 0.0, 1.0);',
      '    }',
      '  }',
      '  float a = d * opacite * (1.0 - smoothstep(taille * 0.2, taille * 0.48, vDist));',
      '  if (a < 0.01) discard;',
      '  gl_FragColor = vec4(teinte * (0.7 + 0.3 * frac) * (1.0 - sombre * (0.3 + 0.45 * d)), a);',
      '}'].join('\n');
    var tranches = [];
    var derivesCouches = [];
    ME.COUCHES.forEach(function (co, ci) {
      var geo = new THREE.PlaneGeometry(co.taille, co.taille);
      var dC = { value: new THREE.Vector2() };
      derivesCouches.push(dC);
      for (var s = 0; s < co.tranches; s++) {
        var frac = co.tranches > 1 ? s / (co.tranches - 1) : 0;
        var y = co.y + frac * co.epaisseur;
        var u = Object.assign({}, UN, {
          motif: { value: co.motif }, etire: { value: co.etire || 1 }, vent: { value: co.vent },
          couvCouche: { value: co.couverture },
          // N tranches superposées rendent l'opacité voulue de la couche
          opacite: { value: 1 - Math.pow(1 - co.opacite, 1 / co.tranches) },
          ySlice: { value: y }, frac: { value: frac }, dome: { value: co.dome ? 1 : 0 },
          taille: { value: co.taille }, graine: { value: ci * 0.137 }, deriveC: dC,
        });
        var mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: false,
          side: THREE.DoubleSide, uniforms: u, vertexShader: VS_NUAGE, fragmentShader: FS_NUAGE });
        var tr = new THREE.Mesh(geo, mat);
        tr.rotation.x = -Math.PI / 2;
        // après l'eau : vu d'au-dessus des nuages, la mer ne doit pas les traverser
        tr.renderOrder = 5;
        tr.frustumCulled = false;
        tr.userData = { y: y, couche: co.nom };
        scene.add(tr);
        tranches.push(tr);
      }
    });
    var nuages = tranches[0];

    /* Relief sous les nuages : la grille du relief lointain, en texture. */
    var versionRelief = -1;
    function majReliefNuages(grille) {
      if (!grille || !grille.pret || grille.version === versionRelief) return false;
      versionRelief = grille.version;
      var a = grille.actif, n = grille.cote, px = new Uint8Array(n * n * 4);
      for (var i = 0; i < n * n; i++) {
        px[i * 4] = Math.max(0, Math.min(255, Math.round(Math.max(a.sol[i], a.eau[i]))));
        px[i * 4 + 3] = 255;
      }
      var t = new THREE.DataTexture(px, n, n, THREE.RGBAFormat);
      t.magFilter = t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      if (UN.relief.value !== reliefTex) UN.relief.value.dispose();
      UN.relief.value = t;
      UN.zoneRelief.value.set(a.x0 - grille.pas / 2, a.z0 - grille.pas / 2, n * grille.pas, 1);
      return true;
    }

    /* ── Relief lointain ──────────────────────────────────────────────────
       Un maillage grossier jusqu'à l'horizon. Là où les vrais chunks sont
       maillés, un disque est découpé dans le shader (`trou`) : pas besoin de
       reconstruire le maillage à chaque pas du joueur. */
    var matLointain = new THREE.MeshLambertMaterial({ vertexColors: true });
    var trouLointain = { value: new THREE.Vector3(0, 0, 0) };
    matLointain.onBeforeCompile = function (sh) {
      sh.uniforms.trou = trouLointain;
      sh.vertexShader = 'varying vec3 vMondeL;\n' + sh.vertexShader.replace('#include <project_vertex>',
        '#include <project_vertex>\n  vMondeL = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'uniform vec3 trou; varying vec3 vMondeL;\n' + sh.fragmentShader.replace('void main() {',
        'void main() {\n  if (length(vMondeL.xz - trou.xy) < trou.z) discard;');
    };
    var lointain = null, versionLointain = -1, grilleLointaine = null, baseLointain = null;
    var soleilOmbre = null, ombreT = 0;
    /* Le relief lointain s'ombre lui-même (MC.Ombres.ombrerRelief) : versants
       à contre-jour et vallées encaissées. On ne recalcule que quand le
       soleil a assez bougé, et au plus toutes les deux secondes. */
    function ombrerLointain(astre) {
      if (!lointain || !grilleLointaine || !MC.Ombres) return false;
      var t = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (soleilOmbre && t - ombreT < 2000 &&
          Math.abs(soleilOmbre.x - astre.x) + Math.abs(soleilOmbre.y - astre.y) + Math.abs(soleilOmbre.z - astre.z) < 0.03) return false;
      if (soleilOmbre && Math.abs(soleilOmbre.x - astre.x) + Math.abs(soleilOmbre.y - astre.y) + Math.abs(soleilOmbre.z - astre.z) < 0.01) return false;
      soleilOmbre = { x: astre.x, y: astre.y, z: astre.z }; ombreT = t;
      var a = grilleLointaine.actif;
      var f = optionsLointain.realiste ? MC.Ombres.ombrerRelief({ cote: grilleLointaine.cote, pas: grilleLointaine.pas, sol: a.sol, eau: a.eau }, astre)
                                       : new Float32Array(grilleLointaine.cote * grilleLointaine.cote).fill(1);
      var col = lointain.geometry.attributes.color;
      for (var i = 0; i < f.length; i++) {
        col.array[i * 3] = baseLointain[i * 3] * f[i];
        col.array[i * 3 + 1] = baseLointain[i * 3 + 1] * f[i];
        col.array[i * 3 + 2] = baseLointain[i * 3 + 2] * f[i];
      }
      col.needsUpdate = true;
      return true;
    }
    function majLointain(grille) {
      majReliefNuages(grille);
      if (!grille || !grille.pret || grille.version === versionLointain) return false;
      versionLointain = grille.version;
      var raw = MC.Lointain.maillage(grille, 1.5);
      grilleLointaine = grille; baseLointain = raw.colors.slice(); soleilOmbre = null;
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(raw.positions, 3));
      g.setAttribute('color', new THREE.BufferAttribute(raw.colors, 3));
      g.setIndex(new THREE.BufferAttribute(raw.indices, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      if (lointain) { scene.remove(lointain); lointain.geometry.dispose(); }
      lointain = new THREE.Mesh(g, matLointain);
      scene.add(lointain);
      majArbresLointains(grille);
      lointainEtendue = raw.etendue;
      recalerBrouillard();
      return true;
    }
    /* ── Au loin : arbres en imposteurs, lieux en silhouettes ──────────────
       Des panneaux croisés instanciés pour les forêts, des boîtes pour les
       bâtiments ; les uns comme les autres s'effacent dans le disque des
       vrais chunks, comme le relief lointain. Tout suit l'option « rendu
       réaliste lointain ». */
    var optionsLointain = { realiste: true };
    var planche = (function () {
      var cv = document.createElement('canvas'), W = 32, H = 64, N = 7;
      cv.width = W * N; cv.height = H;
      var c = cv.getContext('2d');
      function tronc(i, col, larg, haut) { c.fillStyle = col; c.fillRect(i * W + W / 2 - larg / 2, H - haut, larg, haut); }
      function boule(i, col, cx, cy, r) { c.fillStyle = col; c.beginPath(); c.arc(i * W + cx, cy, r, 0, 6.2832); c.fill(); }
      // 1 feuillu, 2 bouleau, 3 conifère, 4 tropical, 5 acacia, 6 cactus, 7 champignon
      tronc(0, '#6a4a2a', 4, 24); boule(0, '#3f7a32', 16, 24, 13); boule(0, '#4f8e3a', 11, 30, 8); boule(0, '#4f8e3a', 21, 29, 8);
      tronc(1, '#e8e2d0', 3, 30); boule(1, '#6aa446', 16, 22, 11); boule(1, '#7ab452', 16, 30, 9);
      tronc(2, '#5a3e22', 3, 14);
      c.fillStyle = '#2e5a3a';
      for (var k = 0; k < 4; k++) { c.beginPath(); c.moveTo(2 * W + 16, 6 + k * 10); c.lineTo(2 * W + 4 + k, 26 + k * 10); c.lineTo(2 * W + 28 - k, 26 + k * 10); c.fill(); }
      tronc(3, '#7a5a32', 4, 44); boule(3, '#2f8a2e', 16, 14, 13); boule(3, '#3a9a36', 8, 18, 7); boule(3, '#3a9a36', 24, 18, 7);
      tronc(4, '#8a5a30', 3, 28); c.fillStyle = '#7a8e30'; c.fillRect(4 * W + 2, 28, 28, 7); c.fillRect(4 * W + 6, 23, 20, 6);
      c.fillStyle = '#4a8a36'; c.fillRect(5 * W + 12, 18, 8, 46); c.fillRect(5 * W + 5, 30, 6, 4); c.fillRect(5 * W + 5, 24, 3, 8);
      c.fillRect(5 * W + 21, 34, 6, 4); c.fillRect(5 * W + 24, 26, 3, 10);
      tronc(6, '#d8ccb4', 6, 34); c.fillStyle = '#b8302a'; c.beginPath(); c.ellipse(6 * W + 16, 30, 15, 9, 0, 3.1416, 6.2832); c.fill();
      var t = new THREE.CanvasTexture(cv);
      t.magFilter = THREE.NearestFilter;
      return t;
    })();
    var matArbres = new THREE.MeshLambertMaterial({ map: planche, alphaTest: 0.5, side: THREE.DoubleSide });
    matArbres.onBeforeCompile = function (sh) {
      sh.uniforms.trou = trouLointain;
      sh.vertexShader = 'attribute float essence;\nvarying vec3 vMondeI;\n' +
        sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n  vUv.x = (vUv.x + essence - 1.0) / 7.0;')
          .replace('#include <project_vertex>', '#include <project_vertex>\n  vMondeI = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;');
      sh.fragmentShader = 'uniform vec3 trou; varying vec3 vMondeI;\n' + sh.fragmentShader.replace('void main() {',
        'void main() {\n  if (length(vMondeI.xz - trou.xy) < trou.z) discard;');
    };
    var geoArbre = (function () {
      var pos = [], uv = [], idx = [], nor = [];
      [[1, 0], [0, 1]].forEach(function (d, q) {
        var b = pos.length / 3, ax = d[0] * 0.5, az = d[1] * 0.5;
        pos.push(-ax, 0, -az, ax, 0, az, -ax, 1, -az, ax, 1, az);
        uv.push(0, 0, 1, 0, 0, 1, 1, 1);
        for (var k = 0; k < 4; k++) nor.push(0, 1, 0);
        idx.push(b, b + 1, b + 2, b + 2, b + 1, b + 3);
      });
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      return g;
    })();
    var arbresLointains = null;
    function majArbresLointains(grille) {
      if (arbresLointains) { scene.remove(arbresLointains); arbresLointains.dispose && arbresLointains.dispose(); arbresLointains = null; }
      var l = MC.Lointain.imposteurs(grille, { max: 50000 });
      if (!l.length) return 0;
      var g = geoArbre.clone();
      var ess = new Float32Array(l.length);
      var m = new THREE.InstancedMesh(g, matArbres, l.length), mat4 = new THREE.Matrix4();
      l.forEach(function (a, i) {
        mat4.makeScale(a.taille * 0.7, a.taille, a.taille * 0.7).setPosition(a.x, a.y - 1.5, a.z);
        m.setMatrixAt(i, mat4);
        ess[i] = a.essence;
      });
      g.setAttribute('essence', new THREE.InstancedBufferAttribute(ess, 1));
      m.instanceMatrix.needsUpdate = true;
      m.frustumCulled = false;
      m.visible = optionsLointain.realiste;
      scene.add(m);
      arbresLointains = m;
      return l.length;
    }
    // silhouettes des lieux : boîtes, fenêtres allumées la nuit
    var nuitLointaine = { value: 0 };
    var matSilhouettes = new THREE.MeshLambertMaterial({ vertexColors: false });
    matSilhouettes.onBeforeCompile = function (sh) {
      sh.uniforms.trou = trouLointain; sh.uniforms.nuit = nuitLointaine;
      sh.vertexShader = 'varying vec3 vMondeS; varying vec3 vNormS;\n' +
        sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  vMondeS = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n  vNormS = normal;');
      sh.fragmentShader = 'uniform vec3 trou; uniform float nuit; varying vec3 vMondeS; varying vec3 vNormS;\n' +
        sh.fragmentShader.replace('void main() {', 'void main() {\n  if (length(vMondeS.xz - trou.xy) < trou.z) discard;')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' +
            '  float fen = step(0.55, fract(vMondeS.y * 0.33)) * step(0.5, fract((vMondeS.x + vMondeS.z) * 0.3)) * step(abs(vNormS.y), 0.5);\n' +
            '  totalEmissiveRadiance += vec3(1.0, 0.8, 0.45) * fen * nuit * 0.9;');
    };
    var COULEURS_LIEUX = { desert: 0xd8c898, badlands: 0xb86a44, taiga: 0x6a4a2e, pics_glaces: 0xc8dcf0, glacier: 0xc8dcf0,
                           jungle: 0x9a6a40, marais: 0x8a6a42, savane: 0xa86a3a, champignons: 0xb03028, montagnes: 0x8a8a92 };
    var silhouettesLointaines = null, sigSilhouettes = '';
    function majSilhouettes(lieux) {
      var sig = (lieux || []).map(function (l) { return l.id; }).join('|');
      if (sig === sigSilhouettes) return false;
      sigSilhouettes = sig;
      if (silhouettesLointaines) { scene.remove(silhouettesLointaines); silhouettesLointaines.dispose && silhouettesLointaines.dispose(); silhouettesLointaines = null; }
      var boites = MC.Lointain.silhouettes(lieux);
      if (!boites.length) return true;
      var parLieu = {};
      (lieux || []).forEach(function (l) { parLieu[l.id] = l; });
      var geo = new THREE.BoxGeometry(1, 1, 1);
      geo.translate(0, 0.5, 0);
      var m = new THREE.InstancedMesh(geo, matSilhouettes, boites.length), mat4 = new THREE.Matrix4(), col = new THREE.Color();
      boites.forEach(function (b, i) {
        mat4.makeScale(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0).setPosition((b.x0 + b.x1) / 2, b.y0, (b.z0 + b.z1) / 2);
        m.setMatrixAt(i, mat4);
        var l = parLieu[b.lieu];
        col.setHex((l && COULEURS_LIEUX[l.biome]) || 0xb89a70);
        m.setColorAt(i, col);
      });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.frustumCulled = false;
      m.visible = optionsLointain.realiste;
      scene.add(m);
      silhouettesLointaines = m;
      return true;
    }
    function reglerRealiste(v) {
      optionsLointain.realiste = !!v;
      if (arbresLointains) arbresLointains.visible = optionsLointain.realiste;
      if (silhouettesLointaines) silhouettesLointaines.visible = optionsLointain.realiste;
      soleilOmbre = null;              // l'ombrage du relief se recalcule (ou s'efface)
      return optionsLointain.realiste;
    }

    // le disque découpé suit le joueur de la vue en cours
    function placerTrou(cam) {
      trouLointain.value.set(cam.position.x, cam.position.z, Math.max(0, (RENDER_DIST - 0.7) * C.CHUNK_X));
    }
    function setDistance(r) {
      RENDER_DIST = Math.max(2, r | 0);
      recalerBrouillard();
      return RENDER_DIST;
    }

    /* Réglages du joueur (SPEC-OPTION-001) : champ de vision et ombres. */
    var ombresActives = true, champBase = 72;
    function setChamp(fov) {
      champBase = fov;
      var f = MC.Options ? MC.Options.champEtendu(fov, dispositionVue.nombre, dispositionVue.orientation) : fov;
      cameras.concat([camera]).forEach(function (c) { c.fov = f; c.updateProjectionMatrix(); });
      return f;
    }
    function setOmbres(v) {
      ombresActives = !!v;
      if (!ombresActives) sun.castShadow = false;
      return ombresActives;
    }

    /* Météo transmise par le jeu : état du ciel et dérive des nuages. */
    var meteoCiel = null, flash = 0;
    /* `ciel` (facultatif) : { me: l'instance Meteo, temps, vent local (cyclone
       compris), sol(x, z) }. */
    function majMeteo(et, derive, ciel) {
      meteoCiel = et;
      if (derive) UN.derive.value.set(derive.x, derive.z);
      if (ciel && ciel.vent) ventEau.value.set(ciel.vent.x, ciel.vent.z);
      else if (et && et.vent) ventEau.value.set(et.vent.x, et.vent.z);
      if (ciel && ciel.me) {
        var me = ciel.me, t = ciel.temps;
        if (me.deriveCouche) derivesCouches.forEach(function (dC, i) { var d = me.deriveCouche(i, t); dC.value.set(d.x, d.z); });
        var cys = me.cyclones ? me.cyclones(t) : [];
        var cam = camera.position;
        cys = cys.slice().sort(function (a, b) {
          return Math.hypot(a.x - cam.x, a.z - cam.z) - Math.hypot(b.x - cam.x, b.z - cam.z);
        });
        for (var k = 0; k < 2; k++) {
          var c = cys[k];
          UN.cyc.value[k].set(c ? c.x : 0, c ? c.z : 0, c ? c.rayon : 1, c ? c.oeil : 0);
          if (k === 0) { UN.cycF.value.x = c ? c.force : 0; UN.cycF.value.y = c ? c.sens : 1; }
          else { UN.cycF.value.z = c ? c.force : 0; UN.cycF.value.w = c ? c.sens : 1; }
        }
        majTornades(me.tornades ? me.tornades(t) : [], ciel.sol, t);
      }
      if (et) {
        UN.couvertureCiel.value = et.couverture;
        UN.sombre.value = Math.max(0, (et.couverture - 0.6) / 0.4) * 0.8;
      }
    }
    /* ── Tornades (SPEC-NUAGE-004) : un entonnoir qui descend de la base des
       cumulus jusqu'au sol, tourne sur lui-même et s'élargit en montant. */
    var geoTornade = new THREE.CylinderGeometry(1, 0.14, 1, 28, 14, true);
    geoTornade.translate(0, 0.5, 0);
    var VS_TORN = 'varying vec2 vUv; varying float vH;' +
      'void main(){ vUv = uv; vH = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
    var FS_TORN = [
      'uniform sampler2D carte; uniform float temps; uniform float sens; uniform float force; uniform vec3 teinte;',
      'varying vec2 vUv; varying float vH;',
      'void main(){',
      '  vec2 q = vec2(vUv.x * 3.0 + temps * 0.45 * sens + vUv.y * 0.8 * sens, vUv.y * 1.6 - temps * 0.08);',
      '  float n = texture2D(carte, q).a * 0.65 + texture2D(carte, q * 2.3 + 0.37).a * 0.35;',
      '  float stries = 0.5 + 0.5 * sin((vUv.x + vUv.y * 0.6 * sens) * 6.2832 * 6.0 + temps * 5.0 * sens);',
      '  float bords = smoothstep(0.0, 0.08, vH) * (1.0 - smoothstep(0.82, 1.0, vH));',
      '  float a = force * bords * clamp(0.25 + n * 0.7 + stries * 0.2 - 0.25, 0.0, 1.0) * 0.8;',
      '  if (a < 0.02) discard;',
      '  gl_FragColor = vec4(teinte * (0.55 + 0.25 * n), a);',
      '}'].join('\n');
    var tornadesM = [];
    function majTornades(liste, sol, t) {
      for (var i = 0; i < Math.max(liste.length, tornadesM.length); i++) {
        var tn = liste[i], m = tornadesM[i];
        if (!tn) { if (m) m.visible = false; continue; }
        if (!m) {
          m = new THREE.Mesh(geoTornade, new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
            uniforms: { carte: UN.carte, temps: UN.temps, sens: { value: 1 }, force: { value: 1 },
                        teinte: { value: new THREE.Color(0.62, 0.62, 0.66) } },
            vertexShader: VS_TORN, fragmentShader: FS_TORN }));
          m.renderOrder = 4; m.frustumCulled = false; m.userData.tornade = true;
          scene.add(m); tornadesM.push(m);
        }
        var y0 = sol ? sol(Math.floor(tn.x), Math.floor(tn.z)) : C.SEA_LEVEL;
        var h = Math.max(20, ME.COUCHES[1].y - y0);
        m.position.set(tn.x, y0, tn.z);
        m.scale.set(tn.rayon * 1.6, h, tn.rayon * 1.6);
        m.material.uniforms.sens.value = tn.sens;
        // l'entonnoir naît du nuage et y remonte en mourant
        var age = tn.vie !== undefined ? tn.vie : 10;
        m.material.uniforms.force.value = Math.max(0, Math.min(1, tn.force)) * Math.min(1, age / 4);
        m.material.uniforms.teinte.value.copy(scene.fog ? scene.fog.color : new THREE.Color(0.6, 0.6, 0.6)).multiplyScalar(0.8);
        m.visible = true;
      }
    }

    /* ── Brume (SPEC-VENT-003) : des nappes basses, posées dans les creux,
       qui dérivent avec le vent de surface. Quelques plans empilés suivent le
       joueur au-dessus du point bas alentour ; le relief (même carte que les
       nuages) ne laisse la brume qu'à quelques blocs au-dessus du sol. */
    var UB = { force: { value: 0 }, deriveB: { value: new THREE.Vector2() }, teinteB: { value: new THREE.Color(1, 1, 1) } };
    var FS_BRUME = [
      'uniform sampler2D carte; uniform sampler2D relief; uniform vec4 zoneRelief; uniform float temps;',
      'uniform float force; uniform vec2 deriveB; uniform vec3 teinteB; uniform float ySlice;',
      'varying vec2 vMonde; varying vec2 vRel;',
      'void main(){',
      '  float vDist = length(vRel);',
      '  vec2 p = (vMonde - deriveB) / 160.0;',
      '  float n = texture2D(carte, p + vec2(temps / 3000.0, 0.0)).a * 0.6 + texture2D(carte, p * 2.7 + 0.21).a * 0.4;',
      '  float h = ySlice - 3.0;',
      '  if (zoneRelief.w > 0.5) {',
      '    vec2 r = (vMonde - zoneRelief.xy) / zoneRelief.z;',
      '    if (r.x > 0.0 && r.y > 0.0 && r.x < 1.0 && r.y < 1.0) h = texture2D(relief, r).r * 255.0;',
      '  }',
      '  float dessus = ySlice - h;',
      '  float m = smoothstep(0.0, 1.5, dessus) * (1.0 - smoothstep(3.0, 9.0, dessus));',
      '  float a = force * smoothstep(0.3, 0.75, n) * m * (1.0 - smoothstep(60.0, 190.0, vDist)) * 0.3;',
      '  if (a < 0.01) discard;',
      '  gl_FragColor = vec4(teinteB, a);',
      '}'].join('\n');
    var plansBrume = [];
    for (var kb = 0; kb < 5; kb++) {
      var mb = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
        uniforms: Object.assign({ carte: UN.carte, relief: UN.relief, zoneRelief: UN.zoneRelief, temps: UN.temps,
                                  ySlice: { value: 0 } }, UB),
        vertexShader: VS_NUAGE, fragmentShader: FS_BRUME }));
      mb.rotation.x = -Math.PI / 2; mb.renderOrder = 4; mb.frustumCulled = false; mb.visible = false;
      mb.userData.brume = kb;
      scene.add(mb); plansBrume.push(mb);
    }
    /* `b` : { force 0..1, fond (y du point bas), derive {x, z} }. */
    function majBrume(b) {
      var f = b ? b.force : 0;
      UB.force.value = f;
      if (b && b.derive) UB.deriveB.value.set(b.derive.x, b.derive.z);
      if (scene.fog) UB.teinteB.value.copy(scene.fog.color).lerp(new THREE.Color(1, 1, 1), 0.45);
      var cam = camera.position;
      plansBrume.forEach(function (m, k) {
        m.visible = f > 0.02;
        if (!m.visible) return;
        var y = (b.fond || C.SEA_LEVEL) + 1 + k * 2.2;
        m.position.set(Math.round(cam.x), y, Math.round(cam.z));
        m.material.uniforms.ySlice.value = y;
      });
      return f;
    }

    /* Un éclair : un trait brisé du nuage au sol, et un flash qui blanchit
       ciel et lumière un instant. */
    function eclair(x, ySol, z, force) {
      var pts = [], y = ME.COUCHES[1].y + 4, px = x, pz = z;
      var graine = (x * 73856093) ^ (z * 19349663);
      function r() { graine = (graine * 16807 + 12345) % 2147483647; return (graine % 1000) / 1000; }
      while (y > ySol) {
        var ny = Math.max(ySol, y - 3 - r() * 5);
        var nx = px + (r() - 0.5) * 5, nz = pz + (r() - 0.5) * 5;
        if (ny <= ySol) { nx = x; nz = z; }
        pts.push(px, y, pz, nx, ny, nz);
        px = nx; pz = nz; y = ny;
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      var m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xeef2ff, transparent: true,
                                                                       opacity: 1, fog: false }));
      m.renderOrder = 6;
      scene.add(m);
      eclairs.push({ mesh: m, vie: 0.35 });
      flash = Math.max(flash, force === undefined ? 1 : force);
      return m;
    }
    function majCiel(time) {
      UN.temps.value = time;
      // SPEC-SAISON-004 : teintes du feuillage et de l'herbe, recalculées une
      // fois par image — bon marché, et sans reconstruire aucun chunk.
      if (DC.teinteSaison) {
        var ts = DC.teinteSaison(time);
        saisonCaduc.value.setRGB(ts.caduc.r, ts.caduc.g, ts.caduc.b);
        saisonConifere.value.setRGB(ts.conifere.r, ts.conifere.g, ts.conifere.b);
        saisonHerbe.value.setRGB(ts.herbe.r, ts.herbe.g, ts.herbe.b);
        saisonDensite.value = ts.densiteCaduc;
      }
      var a = DC.astres(time);
      if (a.phaseLune !== phaseDessinee) dessinerLune(a.phaseLune);
      etoilesMat.opacity = a.etoiles;
      etoiles.visible = a.etoiles > 0.01;
      // soleil et lune disparaissent sous l'horizon plutôt que de traverser le sol
      soleil.visible = halo.visible = a.soleil.y > -0.12;
      lune.visible = a.lune.y > -0.12;
      ciel.userData.astres = a;
      // nuages : blancs le jour, rosés à l'aube et au soir, gris la nuit
      var jour = DC.sunIntensity(time);
      var s = DC.skyColor(time);
      var crep = DC.isDusk(time) || DC.isDawn(time);
      var te = UN.teinte.value;
      te.setRGB(0.25 + jour * 0.75 + (crep ? 0.15 : 0), 0.27 + jour * 0.73 - (crep ? 0.05 : 0), 0.34 + jour * 0.66);
      if (!jour) te.lerp(new THREE.Color(s[0], s[1], s[2]), 0.3);
      if (flash > 0) te.lerp(new THREE.Color(0.9, 0.92, 1), flash);
      return a;
    }
    /* Recentre le ciel sur une caméra (une par vue en écran partagé). Les
       nuages suivent en décalant leur texture d'autant : ils restent
       immobiles dans le monde au lieu de voyager avec le joueur. */
    function placerCiel(cam) {
      var a = ciel.userData.astres;
      if (!a) return;
      ciel.position.copy(cam.position);
      function poser(m, d, dist) {
        m.position.set(d.x * dist, d.y * dist, d.z * dist);
        m.lookAt(0, 0, 0);
      }
      poser(soleil, a.soleil, DIST_CIEL); poser(halo, a.soleil, DIST_CIEL + 5);
      poser(lune, a.lune, DIST_CIEL);
      // chaque tranche suit la caméra ; le shader lit le monde en coordonnées absolues
      for (var i = 0; i < tranches.length; i++) {
        tranches[i].position.set(cam.position.x, tranches[i].userData.y, cam.position.z);
      }
      placerTrou(cam);
    }

    // ─── pluie et neige ───────────────────────────────────────────────────────
    /* Des particules dans une boîte qui suit la caméra. Chacune connaît le
       sommet de sa colonne (`abri`) : elle s'y arrête — un toit, un feuillage
       ou une voûte de grotte protègent de l'averse — puis renaît en haut. */
    var PLUIE_MAX = 3200, NEIGE_MAX = 2600, BOITE = 26, HAUT_P = 22;
    function systeme(n, estPluie) {
      var geo = new THREE.BufferGeometry();
      var pos = new Float32Array(n * (estPluie ? 6 : 3));
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.attributes.position.setUsage && geo.attributes.position.setUsage(THREE.DynamicDrawUsage);
      var obj = estPluie
        ? new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xb4c8ea, transparent: true, opacity: 0.5, depthWrite: false }))
        : new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.16, transparent: true, opacity: 0.92,
                                                           depthWrite: false }));
      obj.frustumCulled = false;
      obj.renderOrder = 4;
      obj.visible = false;
      scene.add(obj);
      return { obj: obj, pos: pos, x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n),
               sol: new Float32Array(n), vivant: new Uint8Array(n), col: new Int32Array(n * 2),
               n: n, pluie: estPluie, actifs: 0 };
    }
    var pluie = systeme(PLUIE_MAX, true), neige = systeme(NEIGE_MAX, false);
    var tempsP = 0;
    function renaitre(sys, i, cam, abri, enHaut) {
      var x = cam.x + (Math.random() * 2 - 1) * BOITE, z = cam.z + (Math.random() * 2 - 1) * BOITE;
      var sol = abri ? abri(Math.floor(x), Math.floor(z)) + 1 : -1e9;
      sys.x[i] = x; sys.z[i] = z; sys.sol[i] = sol;
      sys.col[i * 2] = Math.floor(x); sys.col[i * 2 + 1] = Math.floor(z);
      sys.y[i] = enHaut ? cam.y + HAUT_P * (0.8 + Math.random() * 0.2) : cam.y - 8 + Math.random() * (HAUT_P + 8);
      // sous un toit qui couvre toute la hauteur visible : particule en sommeil
      sys.vivant[i] = sol < cam.y + HAUT_P ? 1 : 0;
      if (sys.y[i] < sol) sys.y[i] = sol + Math.random() * Math.max(0, cam.y + HAUT_P - sol);
    }
    function animer_(sys, voulus, dt, cam, abri, vent) {
      if (voulus <= 0) { sys.obj.visible = false; sys.actifs = 0; return 0; }
      var vx = vent ? vent.x : 0, vz = vent ? vent.z : 0;
      var chute = sys.pluie ? 24 : 2.4, derive = sys.pluie ? 6 : 3.2;
      for (var i = 0; i < voulus; i++) {
        if (i >= sys.actifs) renaitre(sys, i, cam, abri, false);
        var x = sys.x[i], z = sys.z[i];
        // la boîte suit la caméra : ce qui en sort réapparaît de l'autre côté
        if (Math.abs(x - cam.x) > BOITE || Math.abs(z - cam.z) > BOITE) { renaitre(sys, i, cam, abri, false); x = sys.x[i]; z = sys.z[i]; }
        var y = sys.y[i] - chute * dt;
        x += vx * derive * dt; z += vz * derive * dt;
        if (!sys.pluie) { x += Math.sin(tempsP * 1.7 + i) * 0.4 * dt; z += Math.cos(tempsP * 1.3 + i * 0.7) * 0.4 * dt; }
        // poussée par le vent dans une autre colonne : le toit de celle-ci compte désormais
        var fx = Math.floor(x), fz = Math.floor(z);
        if (abri && (fx !== sys.col[i * 2] || fz !== sys.col[i * 2 + 1])) {
          sys.col[i * 2] = fx; sys.col[i * 2 + 1] = fz;
          sys.sol[i] = abri(fx, fz) + 1;
        }
        if (y < sys.sol[i] || y < cam.y - 12) { renaitre(sys, i, cam, abri, true); x = sys.x[i]; y = sys.y[i]; z = sys.z[i]; }
        sys.x[i] = x; sys.y[i] = y; sys.z[i] = z;
        var cache = !sys.vivant[i];
        if (sys.pluie) {
          var k = i * 6, yy = cache ? -1e5 : y;
          sys.pos[k] = x; sys.pos[k + 1] = yy; sys.pos[k + 2] = z;
          sys.pos[k + 3] = x - vx * 0.22; sys.pos[k + 4] = yy + 0.75; sys.pos[k + 5] = z - vz * 0.22;
        } else {
          var k2 = i * 3;
          sys.pos[k2] = x; sys.pos[k2 + 1] = cache ? -1e5 : y; sys.pos[k2 + 2] = z;
        }
      }
      sys.actifs = voulus;
      sys.obj.geometry.setDrawRange(0, voulus * (sys.pluie ? 2 : 1));
      sys.obj.geometry.attributes.position.needsUpdate = true;
      sys.obj.visible = true;
      return voulus;
    }
    /* prec : { forme: 'pluie' | 'neige' | null, intensite } ; abri(x, z) : sommet
       de la colonne ; renvoie le nombre de particules animées. */
    function majPrecipitations(dt, prec, vent, abri, cam) {
      cam = cam || camera.position;
      tempsP += dt;
      var i = prec && prec.forme ? Math.max(0, Math.min(1, prec.intensite)) : 0;
      var np = animer_(pluie, prec && prec.forme === 'pluie' ? Math.floor(PLUIE_MAX * i) : 0, dt, cam, abri, vent);
      var nn = animer_(neige, prec && prec.forme === 'neige' ? Math.floor(NEIGE_MAX * i) : 0, dt, cam, abri, vent);
      return np + nn;
    }

    // ─── repères : une colonne de lumière, visible de loin ─────────────────────
    var colonnes = new Map();
    var sigReperes = '';
    function syncReperes(reperes) {
      var l = reperes ? reperes.liste : [];
      var sig = l.map(function (r) { return r.id + ':' + r.x + ':' + r.z + ':' + r.couleur; }).join('|');
      if (sig === sigReperes) return colonnes.size;
      sigReperes = sig;
      colonnes.forEach(function (m) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); });
      colonnes.clear();
      l.forEach(function (r) {
        var m = new THREE.Mesh(new THREE.BoxGeometry(0.35, 120, 0.35),
          new THREE.MeshBasicMaterial({ color: r.couleur, transparent: true, opacity: 0.45, depthWrite: false,
                                        fog: false, blending: THREE.AdditiveBlending }));
        m.position.set(r.x + 0.5, 60, r.z + 0.5);
        m.renderOrder = 3;
        scene.add(m);
        colonnes.set(r.id, m);
      });
      return colonnes.size;
    }

    // ─── ambiance ────────────────────────────────────────────────────────────
    var skyC = new THREE.Color();
    var UNDERWATER = new THREE.Color(0x2a5f9e);

    var GRIS_ORAGE = new THREE.Color(0.42, 0.45, 0.5), BLANC_ECLAIR = new THREE.Color(0.85, 0.88, 1);
    var VOILE_AIR = new THREE.Color(0.62, 0.74, 0.92);
    var derniereAmbiance = 0, eclairs = [];
    function updateAmbience(time, submerged) {
      sousLEau = !!submerged;
      var maintenant = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
      var dtA = Math.min(0.1, Math.max(0, maintenant - (derniereAmbiance || maintenant)));
      derniereAmbiance = maintenant;
      flash = Math.max(0, flash - dtA * 3.2);
      eclairs = eclairs.filter(function (e) {
        e.vie -= dtA;
        e.mesh.material.opacity = Math.max(0, e.vie / 0.35);
        if (e.vie > 0) return true;
        scene.remove(e.mesh); e.mesh.geometry.dispose(); e.mesh.material.dispose();
        return false;
      });
      var s = DC.skyColor(time);
      skyC.setRGB(s[0], s[1], s[2]);
      var me = meteoCiel, vis = 1, lum = 1;
      if (me) {
        // ciel qui se couvre : il grisaille, d'autant plus sombre que c'est bouché
        var k = Math.max(0, (me.couverture - 0.45) / 0.55) * 0.7;
        var g2 = GRIS_ORAGE.clone().multiplyScalar(0.35 + 0.65 * DC.sunIntensity(time));
        skyC.lerp(g2, k);
        vis = 1 - me.precipitation * 0.72;
        lum = me.lumiere;
      }
      if (flash > 0) skyC.lerp(BLANC_ECLAIR, flash * 0.8);
      /* Perspective atmosphérique : au loin, les couleurs bleuissent et
         s'éclaircissent. Le brouillard est commun à tout (vrais blocs, relief
         lointain, imposteurs) : on teinte sa couleur d'un voile d'air bleu. */
      var brume = skyC.clone();
      if (optionsLointain.realiste) brume.lerp(VOILE_AIR, 0.3 * DC.sunIntensity(time) * (me ? 1 - me.couverture * 0.6 : 1));
      nuitLointaine.value = 1 - DC.sunIntensity(time);
      if (submerged) {
        scene.background.copy(UNDERWATER);
        scene.fog.color.copy(UNDERWATER);
        scene.fog.near = 0.5; scene.fog.far = 22;
      } else {
        scene.background.copy(skyC);
        scene.fog.color.copy(brume);
        scene.fog.near = FOG_NEAR * vis; scene.fog.far = Math.max(60, FOG_FAR * vis);
      }
      var inten = DC.sunIntensity(time);
      // Plancher d'éclairage nocturne : une nuit physiquement correcte serait
      // noire, donc injouable. On garde le contraste jour/nuit tout en laissant
      // le relief lisible (et les zombies visibles avant qu'ils ne mordent).
      // la nuit, les sources de lumière prennent le dessus
      forceTorches.value = 0.95 - inten * 0.6;
      /* Le soleil direct pèse assez, face à l'ambiance, pour que les ombres
         portées se voient ; par temps couvert (lum bas) il s'efface et
         l'ambiance diffuse prend le relais, comme sous un vrai ciel gris. */
      sun.intensity = (0.1 + inten * 0.95) * Math.min(1.2, lum * lum) + flash * 0.8;
      hemi.intensity = (0.44 + inten * 0.3) * (1.25 - 0.25 * lum) + flash * 0.9;
      // la lumière hémisphérique vire au bleu nuit quand le soleil se couche
      hemi.color.setRGB(0.55 + s[0] * 0.45, 0.62 + s[1] * 0.38, 0.72 + s[2] * 0.28);
      var ast = majCiel(time);
      // la lumière vient du soleil visible ; sous l'horizon, de la lune, faiblement
      var choix = MC.Ombres ? MC.Ombres.choisirAstre(ast.soleil, ast.lune) : null;
      var d = choix ? choix.dir : { x: 0, y: 1, z: 0 };
      var cadre = choix ? MC.Ombres.cascades(camera.position, d,
                                              { tailles: [CADRE_OMBRE], resolution: RESOLUTION_OMBRE, recul: RECUL_OMBRE }) : null;
      if (cadre) {
        sun.position.set(cadre[0].position.x, cadre[0].position.y, cadre[0].position.z);
        sun.target.position.set(cadre[0].centre.x, cadre[0].centre.y, cadre[0].centre.z);
        sun.castShadow = !submerged && ombresActives;
      } else {
        sun.position.set(camera.position.x, camera.position.y + 100, camera.position.z);
        sun.target.position.copy(camera.position);
        sun.castShadow = false;
      }
      sun.target.updateMatrixWorld();
      soleilDir.value.set(ast.soleil.x, ast.soleil.y, ast.soleil.z);
      forceOmbreNuages.value = inten;
      ombrerLointain(ast.soleil);
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
          L.intensity = 0.6;             // le terrain a sa lumière propagée : celle-ci éclaire les créatures
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
      renderer.setPixelRatio(MC.Options ? MC.Options.rapportPixels(resolutionVoulue, { l: s[0], h: s[1] }, devicePixelRatio) : Math.min(devicePixelRatio, 2));
      renderer.setSize(s[0], s[1]);
    }
    /* Résolution de rendu (SPEC-OPTION-005) : le tampon prend la taille voulue,
       l'image s'étire sur l'hôte sans se déformer (même rapport largeur/hauteur). */
    var resolutionVoulue = 'native';
    function setResolution(id) { resolutionVoulue = id || 'native'; resize(); return renderer.getPixelRatio(); }
    /* Vue étendue sur plusieurs écrans (SPEC-OPTION-006) : empilés, le champ
       vertical s'ouvre d'autant ; côte à côte, l'aspect de l'hôte suffit. */
    var dispositionVue = { nombre: 1, orientation: 'horizontal' };
    function setDisposition(d) { dispositionVue = d || dispositionVue; setChamp(champBase); return dispositionVue; }

    /* Rendu en plusieurs vues. Le test de ciseaux limite chaque passe à son
       rectangle : sans lui, effacer le tampon pour la deuxième vue effacerait
       la première. WebGL compte les Y depuis le bas, l'interface depuis le
       haut : d'où l'inversion. */
    /* ── Eau : réfraction et vue sous l'eau ───────────────────────────────
       Au-dessus de l'eau proche, une passe du décor sans l'eau (à demi-
       résolution) : la surface la relit en la déformant. Sous l'eau, toute
       l'image passe par un calque qui l'ondule et la bleuit. */
    var rtRefraction = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
    var rtEcran = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true });
    var tailleTampon = new THREE.Vector2();
    var calque = (function () {
      var sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      var mat = new THREE.ShaderMaterial({
        uniforms: { image: { value: null }, temps: UN.temps, force: { value: 1 } },
        depthTest: false, depthWrite: false,
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: 'uniform sampler2D image; uniform float temps; uniform float force; varying vec2 vUv;' +
          'void main(){ vec2 d = vec2(sin(vUv.y * 22.0 + temps * 2.1), cos(vUv.x * 18.0 + temps * 1.7)) * 0.006 * force;' +
          ' vec3 c = texture2D(image, vUv + d).rgb; gl_FragColor = vec4(mix(c, c * vec3(0.55, 0.8, 1.0), 0.35 * force), 1.0); }',
      });
      sc.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
      return { scene: sc, camera: cam, mat: mat };
    })();
    var sousLEau = false, eauEnVue = 0;
    function eauProche(cam) {
      var n = 0;
      maillagesEau.forEach(function (m) {
        if (!m.visible) return;
        var dx = m.position.x + 8 - cam.position.x, dz = m.position.z + 8 - cam.position.z;
        if (dx * dx + dz * dz < 96 * 96) n++;
      });
      return n;
    }
    function passeRefraction(cam) {
      renderer.getDrawingBufferSize(tailleTampon);
      var w = Math.max(4, tailleTampon.x >> 1), h = Math.max(4, tailleTampon.y >> 1);
      if (rtRefraction.width !== w || rtRefraction.height !== h) rtRefraction.setSize(w, h);
      tailleEcran.value.set(tailleTampon.x, tailleTampon.y);
      maillagesEau.forEach(function (m) { m.userData.vuAvant = m.visible; m.visible = false; });
      renderer.setRenderTarget(rtRefraction);
      renderer.render(scene, cam);
      renderer.setRenderTarget(null);
      maillagesEau.forEach(function (m) { m.visible = m.userData.vuAvant; });
      refractionTex.value = rtRefraction.texture;
      refractionActive.value = 1;
    }
    function rendreVue(cam) {
      eauEnVue = eauProche(cam);
      refractionActive.value = 0;
      if (sousLEau) {
        renderer.getDrawingBufferSize(tailleTampon);
        if (rtEcran.width !== tailleTampon.x || rtEcran.height !== tailleTampon.y) rtEcran.setSize(tailleTampon.x, tailleTampon.y);
        renderer.setRenderTarget(rtEcran);
        renderer.render(scene, cam);
        renderer.setRenderTarget(null);
        calque.mat.uniforms.image.value = rtEcran.texture;
        renderer.render(calque.scene, calque.camera);
        return;
      }
      if (eauEnVue > 0 && optionsRendu.refraction) passeRefraction(cam);
      renderer.render(scene, cam);
    }
    var optionsRendu = { refraction: true };

    function renderViews(vues) {
      var taille = hostSize();
      if (!vues || vues.length <= 1) {
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, taille[0], taille[1]);
        placerCiel(camera);
        rendreVue(camera);
        return 1;
      }
      refractionActive.value = 0;
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
        placerCiel(cam);             // chaque vue a son ciel, centré sur sa caméra
        renderer.render(scene, cam);
      }
      renderer.setScissorTest(false);
      return vues.length;
    }

    function render() { placerCiel(camera); renderer.render(scene, camera); }

    return {
      scene: scene, camera: camera, renderer: renderer, sun: sun,
      syncChunk: syncChunk, disposeChunk: disposeChunk, syncEntities: syncEntities,
      updateAmbience: updateAmbience, setHighlight: setHighlight, setCamera: setCamera,
      updateTorches: updateTorches, torchPool: torchPool, MAX_TORCH_LIGHTS: MAX_TORCH_LIGHTS,
      libererToutesEntites: libererToutesEntites, syncDistants: syncDistants,
      maillagesDistants: maillagesDistants,
      get materiauxLiberes() { return liberees; },
      resize: resize, render: render, renderViews: renderViews,
      cameraDe: cameraDe, cameras: cameras,
      get RENDER_DIST() { return RENDER_DIST; },
      materials: { opaque: matOpaque, cutout: matCutout, blend: matBlend, lumineux: matLumineux },
      forceTorches: forceTorches,
      PASSES: PASSES,
      entityMeshes: entityMeshes, syncReperes: syncReperes, colonnesReperes: colonnes, animerMembres: animerMembres,
      majLointain: majLointain, setDistance: setDistance, majMeteo: majMeteo, eclair: eclair, majBrume: majBrume,
      setChamp: setChamp, setOmbres: setOmbres, setResolution: setResolution, setDisposition: setDisposition,
      get resolution() { return resolutionVoulue; }, get disposition() { return dispositionVue; }, get ombresActives() { return ombresActives; },
      formations: { derivesCouches: derivesCouches, cyclones: UN.cyc, forcesCyclones: UN.cycF, tornades: tornadesM, brume: plansBrume },
      majSilhouettes: majSilhouettes, reglerRealiste: reglerRealiste,
      loin: { options: optionsLointain, get arbres() { return arbresLointains; }, get silhouettes() { return silhouettesLointaines; },
              get brouillard() { return scene.fog; } },
      eau: { maillages: maillagesEau, refraction: refractionActive, options: optionsRendu, ventEau: ventEau,
             get sousLEau() { return sousLEau; }, get enVue() { return eauEnVue; } },
      ombres: { soleil: sun, cadre: CADRE_OMBRE, soleilDir: soleilDir, forceNuages: forceOmbreNuages, ombrerLointain: ombrerLointain },
      majPrecipitations: majPrecipitations, precipitations: { pluie: pluie, neige: neige },
      get flash() { return flash; }, get eclairsVisibles() { return eclairs.length; },
      get lointain() { return lointain; },
      get brouillard() { return { near: FOG_NEAR, far: FOG_FAR }; },
      ciel: { groupe: ciel, soleil: soleil, lune: lune, etoiles: etoiles, nuages: nuages, tranches: tranches,
              maj: majCiel, placer: placerCiel },
    };
  }

  MC.createRenderer = createRenderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
