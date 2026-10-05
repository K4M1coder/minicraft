/* rendu-repro.js — rendu REPRODUCTIBLE et mouvements scriptés des tests
   visuels (SPEC-BANC-082, SPEC-BANC-084, docs/banc/historique-global.md §3.7
   et §3.8). Module de test (navigateur ET Node, sans dépendance) chargé par
   tests/index.html avant tests/e2e.js, qui l'appelle pour les tests étiquetés
   `rendu` ; il ne touche à rien tant qu'on n'appelle pas `fixer`.

   Ce qui rend deux captures de la même scène identiques :
     - la graine du monde, l'heure du jeu, la météo (tirée de la graine et de
       l'heure : on choisit un instant où elle est celle demandée), la
       position et l'orientation de la caméra, la résolution ;
     - une HORLOGE DÉTERMINISTE : requestAnimationFrame livre des horodatages
       virtuels qui avancent de 1/60 s par image réelle (donc `dt` du jeu
       constant) et performance.now() les suit — les animations non liées au
       test (eau, nuages, fumées) deviennent une fonction du NOMBRE d'images
       écoulées, pas de la vitesse de la machine ;
     - un Math.random déterministe (particules) ;
     - une mesure de FPS constante (60), pour que la qualité adaptative ne
       dégrade jamais le rendu selon la charge de la machine.

   Mouvements scriptés (SPEC-BANC-082) : un tremblement en mouvement se juge
   sur un déplacement ou une rotation à VITESSE FIXE (`MOUVEMENTS`, unités
   documentées), appliqué par pas absolus indexés sur l'image (pose(i) =
   pose(0) + i × pas) : le pas ne dépend ni de l'horloge ni de la charge, il
   est identique d'un run à l'autre. */
(function (G) {
  'use strict';
  var R = G.MC_REPRO = {};

  R.DT_MS = 1000 / 60;                 // durée virtuelle d'une image
  R.ORIGINE_HORLOGE_MS = 1e6;          // horloge virtuelle au départ d'une scène fixée
  R.RESOLUTION_MIN = [800, 600];       // jamais en dessous (SPEC-OPTION-008)
  R.SCENE_DEFAUT = { graine: 20260921, heure: 12, meteo: 'clair', pos: null, yaw: 0, pitch: 0, resolution: [1280, 800] };
  /* Vitesses documentées des mouvements scriptés : rotation en degrés par
     seconde de lacet, déplacement en blocs par seconde le long du cap. */
  R.MOUVEMENTS = {
    rotation: { unite: 'deg/s', vitesse: 30, description: 'rotation du lacet à 30 degrés par seconde' },
    deplacement: { unite: 'blocs/s', vitesse: 4, description: 'déplacement horizontal le long du cap à 4 blocs par seconde' },
  };

  /* Générateur pseudo-aléatoire (mulberry32) : même graine, même suite. */
  R.alea = function (graine) {
    var a = (graine | 0) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* Pas d'UNE image d'un mouvement scripté : { dyaw (radians), dx, dz (blocs) }.
     Rotation : le lacet augmente de vitesse × dt. Déplacement : avance le long
     du cap `yaw` (la caméra regarde vers -z à yaw 0, convention du jeu :
     direction = (-sin yaw, -cos yaw)). `vitesse` surcharge la vitesse par défaut. */
  R.pasMouvement = function (mouvement, yaw) {
    var m = mouvement || {};
    var def = Object.prototype.hasOwnProperty.call(R.MOUVEMENTS, m.type) ? R.MOUVEMENTS[m.type] : null;
    if (!def) throw new Error('mouvement scripté inconnu : ' + String(m.type) + ' (rotation ou deplacement)');
    var v = typeof m.vitesse === 'number' && isFinite(m.vitesse) ? m.vitesse : def.vitesse;
    var dt = R.DT_MS / 1000;
    if (m.type === 'rotation') return { dyaw: v * dt * Math.PI / 180, dx: 0, dz: 0, vitesse: v, unite: def.unite };
    return { dyaw: 0, dx: -Math.sin(yaw) * v * dt, dz: -Math.cos(yaw) * v * dt, vitesse: v, unite: def.unite };
  };
  /* Pose de l'image d'indice i : pose0 + i × pas (absolue, sans dérive). */
  R.poseALImage = function (pose0, mouvement, i) {
    var p = R.pasMouvement(mouvement, pose0.yaw);
    return { x: pose0.x + p.dx * i, y: pose0.y, z: pose0.z + p.dz * i, yaw: pose0.yaw + p.dyaw * i, pitch: pose0.pitch };
  };
  /* Ce que le rapport garde d'un mouvement : de quoi le rejouer à l'identique. */
  R.decrire = function (mouvement) {
    var p = R.pasMouvement(mouvement, 0);
    return { type: mouvement.type, vitesse: p.vitesse, unite: p.unite, dt_ms: R.DT_MS };
  };

  /* Horloge déterministe. `env` : { window, performance, Math } (le navigateur
     par défaut). installer() remplace requestAnimationFrame/performance.now/
     Math.random ; restaurer() remet l'état d'origine. Les rappels d'une même
     image réelle reçoivent le MÊME horodatage virtuel. */
  R.creerHorloge = function (env) {
    env = env || { window: G, performance: G.performance, Math: Math };
    var w = env.window, perf = env.performance, M = env.Math;
    var virtuel = 0, dernierReel = null, installee = false, images = 0;
    var origine = {};
    function tic(reel) { if (reel !== dernierReel) { dernierReel = reel; virtuel += R.DT_MS; images++; } return virtuel; }
    return {
      installer: function (graineAlea) {
        if (installee) return;
        installee = true; virtuel = 0; dernierReel = null; images = 0;
        origine.raf = w.requestAnimationFrame; origine.annule = w.cancelAnimationFrame;
        origine.hadNow = Object.prototype.hasOwnProperty.call(perf, 'now'); origine.now = perf.now;
        origine.random = M.random;
        var raf = origine.raf;
        w.requestAnimationFrame = function (cb) {
          return raf.call(w, function (reel) { cb(tic(reel)); });
        };
        perf.now = function () { return virtuel; };
        M.random = R.alea(graineAlea === undefined ? 1 : graineAlea);
      },
      restaurer: function () {
        if (!installee) return;
        installee = false;
        w.requestAnimationFrame = origine.raf;
        if (origine.hadNow) perf.now = origine.now; else delete perf.now;
        M.random = origine.random;
      },
      /* Replace l'horloge à une valeur fixe : ce qui a précédé (images de chargement,
         en nombre variable) n'a plus d'effet sur ce qui suit. Le saut est borné par
         les clamps de dt du jeu, identiques d'un run à l'autre. */
      recaler: function (ms) { virtuel = ms; images = 0; },
      get maintenant() { return virtuel; },
      get images() { return images; },
      get installee() { return installee; },
    };
  };

  /* Compteur d'IMAGES DU JEU : `attendre(n)` rend une promesse résolue quand n
     images du jeu sont terminées (le rendu final `renderViews` est enveloppé :
     la promesse est résolue DEPUIS l'image, sa suite s'exécute juste après le
     rappel de requestAnimationFrame du jeu, jamais au milieu). Attendre « n
     rappels d'animation » ne suffit pas pour un état reproductible : selon
     l'ordre d'enregistrement des rappels, la suite s'exécute avant ou après
     l'image du jeu de la même vague (écart d'une image, donc de 1/60 s de jeu). */
  R.creerCompteurImages = function (rendu) {
    var orig = rendu.renderViews, n = 0, attentes = [], actif = true;
    rendu.renderViews = function () {
      var r = orig.apply(this, arguments);
      n++;
      var pretes = attentes.filter(function (a) { return n >= a.cible; });
      attentes = attentes.filter(function (a) { return n < a.cible; });
      pretes.forEach(function (a) { a.res(); });
      return r;
    };
    return {
      attendre: function (k) { return new Promise(function (res) { attentes.push({ cible: n + Math.max(1, k | 0), res: res }); }); },
      restaurer: function () { if (actif) { actif = false; rendu.renderViews = orig; } },
      get compte() { return n; },
    };
  };
  /* Pendant qu'une scène est fixée : attend n images du jeu (null sinon). */
  R.attendreImages = null;

  /* Un instant du monde (absolu, en secondes de jeu) où l'heure est `heure`
     (0-24) et la météo `nomMeteo`, cherché jour après jour : la météo est une
     fonction de la graine et de l'instant (world.meteo.etat). Rend null si
     aucun des `jours` premiers jours ne convient. */
  R.trouverInstant = function (monde, DayCycle, heure, nomMeteo, jours) {
    var frac = (((heure % 24) + 24) % 24) / 24;
    var n = jours || 400;
    for (var d = 1; d <= n; d++) {
      var t = d * DayCycle.DAY_LENGTH + frac * DayCycle.DAY_LENGTH;
      if (!monde.meteo || !nomMeteo) return t;
      // le TYPE (« clair »), pas le libellé affiché (« Clair ») ; et stable sur la minute qui suit :
      // un fondu vers un autre temps changerait le ciel d'une image à l'autre
      var stable = true;
      for (var k = 0; k < 4 && stable; k++) { var e = monde.meteo.etat(t + k * 20); stable = !!e && e.type === nomMeteo && e.fondu === 0; }
      if (stable) return t;
    }
    return null;
  };

  /* Normalise et valide une scène : les champs absents prennent les valeurs
     par défaut ; une résolution sous le plancher est refusée. */
  R.normaliserScene = function (scene) {
    var s = Object.assign({}, R.SCENE_DEFAUT, scene || {});
    if (!Array.isArray(s.resolution) || s.resolution.length !== 2 || !(s.resolution[0] >= R.RESOLUTION_MIN[0]) || !(s.resolution[1] >= R.RESOLUTION_MIN[1])) {
      throw new Error('résolution ' + JSON.stringify(s.resolution) + ' refusée : jamais sous ' + R.RESOLUTION_MIN[0] + '×' + R.RESOLUTION_MIN[1]);
    }
    return s;
  };

  /* Attente BORNÉE (sondage, jamais un délai fixe) que le monde visible soit
     stable : tous les chunks voulus chargés et maillés, plus aucun maillage
     en attente. */
  R.attendreMonde = function (g, frames, delaiMs) {
    var t0 = Date.now();
    function stable() {
      var cx = Math.floor(g.player.state.pos.x / 16), cz = Math.floor(g.player.state.pos.z / 16);
      var R0 = g.render.RENDER_DIST, i, c;
      // tous les chunks voulus sont chargés…
      var voulus = g.world.chunksVoulus([[cx, cz]], R0);
      for (i = 0; i < voulus.length; i++) if (!g.world.chunks.has(g.world.key(voulus[i][1], voulus[i][2]))) return false;
      // …et ceux dont les huit voisins le sont aussi (donc ceux que le mailleur traite) sont maillés
      var mailles = g.world.chunksVoulus([[cx, cz]], Math.max(0, R0 - 1));
      for (i = 0; i < mailles.length; i++) {
        c = g.world.chunks.get(g.world.key(mailles[i][1], mailles[i][2]));
        if (c.dirty || !(c.mesh || c.meshC || c.meshT || c.meshL)) return false;
      }
      // …et le relief lointain est complet (la grille se remplit par petits lots, image après image)
      var d = g.diagnostic ? g.diagnostic().lointain : null;
      if (d && !(d.pret && d.enCours >= 1)) return false;
      return true;
    }
    function boucle() {
      if (stable()) return Promise.resolve(true);
      if (Date.now() - t0 > (delaiMs || 60000)) return Promise.reject(new Error('le monde visible ne se stabilise pas (chunks à charger ou à mailler)'));
      return frames(1).then(boucle);
    }
    return boucle();
  };

  /* Fixe la scène et rend { scene, resolution, instant, horloge, restaurer() }.
     Toutes les valeurs fixées sont rendues, pour être enregistrées avec le
     test (elles ne sont pas déduites après coup). `outils.frames(n)` rend une
     promesse d'attente de n images ; `outils.resolution(l, h)` (facultatif)
     règle la surface de rendu (le banc : MC_BANC.reglerResolution). */
  R.fixer = function (g, sceneBrute, outils) {
    outils = outils || {};
    var frames = outils.frames;
    var s = R.normaliserScene(sceneBrute);
    var anciens = {};
    var horloge = R.creerHorloge();
    var compteur = null;
    function restaurer() {
      horloge.restaurer();
      if (compteur) { compteur.restaurer(); if (R.attendreImages === compteur.attendre) R.attendreImages = null; compteur = null; }
      if (anciens.mesurerFPS) g.mesurerFPS = anciens.mesurerFPS;
    }
    return Promise.resolve().then(function () {
      // 1. la graine : on change de monde si besoin
      if (g.world.seed !== s.graine) {
        if (typeof g.remplacerMonde !== 'function') throw new Error('graine ' + s.graine + ' demandée mais le monde est celui de la graine ' + g.world.seed);
        g.remplacerMonde(s.graine);
      }
      // 2. la qualité adaptative ne bouge plus (FPS constant) et revient au palier plein, puis la résolution
      anciens.mesurerFPS = g.mesurerFPS;
      g.mesurerFPS = function () { return 60; };
      if (typeof g.reinitialiserQualite === 'function') g.reinitialiserQualite();
      if (outils.resolution) outils.resolution(s.resolution[0], s.resolution[1]);
      return frames(2);
    }).then(function () {
      var cv = g.render.renderer.domElement;
      if (cv.width < R.RESOLUTION_MIN[0] || cv.height < R.RESOLUTION_MIN[1]) {
        throw new Error('surface de rendu ' + cv.width + '×' + cv.height + ' : sous le plancher ' + R.RESOLUTION_MIN[0] + '×' + R.RESOLUTION_MIN[1]);
      }
      // 3. le joueur : en vie, au sol, immobile, sans créature ; caméra posée
      var st = g.player.state;
      g.input.setState('playing');
      st.inv.load([]); st.hp = 20; st.hunger = 20; st.air = 10; st.dead = false; st.flying = true;
      st.vel.x = st.vel.y = st.vel.z = 0; st.fallFrom = null;
      g.entities.list.length = 0;
      var pos = s.pos;
      if (!pos) {
        var col = g.world.findSpawnColumn();
        g.world.getChunk(Math.floor(col[0] / 16), Math.floor(col[1] / 16), true);
        pos = [col[0] + 0.5, g.world.groundAt(col[0], col[1], true) + 1.2, col[1] + 0.5];
      }
      st.pos.x = pos[0]; st.pos.y = pos[1]; st.pos.z = pos[2];
      st.yaw = s.yaw; st.pitch = s.pitch;
      // 4. l'heure et la météo : un instant où le monde a la météo demandée
      var DC = G.MC.DayCycle;
      var t = typeof s.temps === 'number' ? s.temps : R.trouverInstant(g.world, DC, s.heure, s.meteo);
      if (t === null) throw new Error('aucun instant à ' + s.heure + ' h avec la météo « ' + s.meteo + ' » pour la graine ' + s.graine);
      g.time = t;
      g.streamChunks(true);
      // 5. l'horloge devient déterministe
      horloge.installer(s.graine);
      compteur = R.creerCompteurImages(g.render);
      R.attendreImages = compteur.attendre;
      return R.attendreMonde(g, frames, outils.delaiMs).then(function () {
        // on se cale sur la FIN d'une image du jeu : la suivante sera la première de la scène
        return compteur.attendre(1);
      }).then(function () {
        // les images de chargement sont en nombre variable : l'état de départ ne les compte plus
        g.time = t;
        horloge.recaler(R.ORIGINE_HORLOGE_MS);
      });
    }).then(function () {
      var cv = g.render.renderer.domElement;
      return {
        scene: s, instant: g.time, horloge: horloge, restaurer: restaurer, images: compteur.attendre,
        resolution: [cv.width, cv.height],
        decrit: { graine: g.world.seed, heure: s.heure, meteo: s.meteo, temps: g.time, camera: { pos: [g.player.state.pos.x, g.player.state.pos.y, g.player.state.pos.z], yaw: s.yaw, pitch: s.pitch }, resolution: [cv.width, cv.height], dt_ms: R.DT_MS },
      };
    }).catch(function (e) { restaurer(); throw e; });
  };

  /* Écart moyen (0-255 par canal) et maximal entre deux images de même taille
     (tableaux RGBA). Deux rendus « pixel-identiques » ont un écart nul. */
  R.comparer = function (a, b) {
    if (!a || !b || a.length !== b.length) return { identiques: false, moyen: Infinity, max: Infinity, pixelsDifferents: Infinity };
    var somme = 0, max = 0, diff = 0, n = a.length / 4;
    for (var i = 0; i < a.length; i += 4) {
      var d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      if (d) diff++;
      somme += d / 3; if (d / 3 > max) max = d / 3;
    }
    return { identiques: diff === 0, moyen: n ? somme / n : 0, max: max, pixelsDifferents: diff, pixels: n };
  };
  /* « Identique à une tolérance négligeable près » : écart moyen sous 0,05 sur
     255 et aucun pixel au-delà de 8. */
  R.TOLERANCE = { moyen: 0.05, max: 8 };
  R.negligeable = function (cmp) { return cmp.identiques || (cmp.moyen <= R.TOLERANCE.moyen && cmp.max <= R.TOLERANCE.max); };
})(typeof globalThis !== 'undefined' ? globalThis : this);
