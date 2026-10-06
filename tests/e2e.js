/* e2e.js — tests end-to-end : ils pilotent une VRAIE partie dans le navigateur
   (rendu, DOM, boucle de jeu, capture souris) et vérifient le comportement
   observable, pas l'état interne des modules.

   Exécution : ouvrir tests/e2e.html, ou appeler window.runE2E(). */
(function (G) {
  'use strict';
  var tests = [];
  /* `e2e(nom, fn)` ou `e2e(nom, fiche, fn)` (SPEC-BANC-002 côté e2e) — la
     fiche { teste, pourquoi, attendu, delai } est facultative ; `delai` (en
     secondes) surcharge le délai par défaut d'un test — un filet de sécurité
     contre un test qui ne rend jamais la main, généreux par défaut (15 min),
     pas un couperet pour un test lent (SPEC-BANC-010, révisé). */
  function e2e(name, ficheOuFn, fn) {
    var fiche = fn ? ficheOuFn : null;
    var f = fn || ficheOuFn;
    tests.push({ name: name, fiche: fiche, fn: f });
  }

  function fail(msg) { var e = new Error(msg); e.isAssertion = true; throw e; }

  /* Le test en cours d'instrumentation (SPEC-BANC-009/011/012/013), ou null
     hors d'un passage par `runUnE2E`. `etape()` et `capture()` ci-dessous
     l'utilisent quand il existe, et ne font rien sinon (usage direct via
     `runE2E`, sans instrumentation, reste possible). */
  var enCours = null;

  function compter(fn) {
    return function () {
      try {
        var r = fn.apply(null, arguments);
        if (enCours) enCours.assertions.ok++;
        return r;
      } catch (e) {
        if (enCours) enCours.assertions.ko++;
        throw e;
      }
    };
  }
  var brute = {
    ok: function (v, m) { if (!v) fail((m || 'attendu vrai') + ' — obtenu ' + v); },
    notOk: function (v, m) { if (v) fail((m || 'attendu faux') + ' — obtenu ' + v); },
    equal: function (a, b, m) { if (a !== b) fail((m || 'égalité') + ' — attendu ' + b + ', obtenu ' + a); },
    ne: function (a, b, m) { if (a === b) fail((m || 'différence') + ' — les deux valent ' + a); },
    gt: function (a, b, m) { if (!(a > b)) fail((m || 'supérieur') + ' — ' + a + ' <= ' + b); },
    lt: function (a, b, m) { if (!(a < b)) fail((m || 'inférieur') + ' — ' + a + ' >= ' + b); },
    close: function (a, b, eps, m) {
      if (Math.abs(a - b) > (eps === undefined ? 1e-6 : eps))
        fail((m || 'proximité') + ' — attendu ' + b + ', obtenu ' + a);
    },
  };
  var A = {};
  Object.keys(brute).forEach(function (k) { A[k] = compter(brute[k]); });
  A.ok2 = function (v, m) { A.ok(v, m); };

  /* Capture immédiate de l'image affichée, réduite à 480 px de large au
     plus, en JPEG compressé (SPEC-BANC-011). `renderer.render` doit être
     rappelé juste avant : le tampon peut avoir été consommé par le rendu
     normal de la boucle de jeu entre deux `await`. */
  /* Rend l'image COMPOSÉE telle que le joueur la voit : en écran partagé,
     toutes les vues (renderViews), pas la seule caméra principale dans le
     dernier viewport réglé (qui laissait trois quadrants sur quatre vides). */
  function rendreTout(g) {
    if (g.vues && g.vues.length > 1 && g.render.renderViews) g.render.renderViews(g.vues);
    else g.render.render();
  }
  function capturer(g, libelle) {
    try {
      rendreTout(g);
      var src = g.render.renderer.domElement;
      var w = src.width, h = src.height;
      if (!w || !h) return null;
      var echelle = Math.min(1, 480 / w);
      var cw = Math.max(1, Math.round(w * echelle)), ch = Math.max(1, Math.round(h * echelle));
      var c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(src, 0, 0, cw, ch);
      // URL de données complète : banc-ui.js l'utilise TELLE QUELLE comme
      // src des vignettes affichées dans la page (SPEC-BANC-011) — retirer
      // le préfixe ici casserait leur affichage. C'est envoyerCahier(),
      // au moment d'envoyer au serveur, qui retire le préfixe pour envoyer
      // du base64 pur (voir tests/banc-ui.js).
      return { libelle: libelle || '', type: 'image/jpeg', base64: c.toDataURL('image/jpeg', 0.7) };
    } catch (e) { return null; }
  }

  /* Déclare une étape en cours d'exécution (SPEC-BANC-009) : visible en
     direct dans le banc, capturée (SPEC-BANC-011) et horodatée pour le
     cahier de test (SPEC-BANC-012/013). Sans test en cours instrumenté
     (`enCours` nul), ne fait rien — un test lancé hors du banc reste valide. */
  function etape(libelle, n, total) {
    if (!enCours) return;
    enCours.etapeCourante = libelle + (total ? ' (' + n + '/' + total + ')' : '');
    enCours.etapes.push({ libelle: libelle, t_ms: ahora() - enCours.t0, n: n, total: total });
    var c = capturer(enCours.g, libelle);
    if (c) { c.t_ms = ahora() - enCours.t0; enCours.captures.push(c); }
  }

  /* Capture manuelle, hors étape déclarée : `capture('apres-teleportation')`
     depuis un test enregistre une capture NOMMÉE en cours de route (rôle
     'intermediaire', posé par runUnE2E()/conclure() une fois toutes les
     captures du test connues — voir plus bas) : le libellé, stable d'un run
     à l'autre pour un même test, est ce que le registre (tools/registre.js)
     et sa vue historique par test utilisent pour aligner les captures d'un
     même point du test à travers plusieurs runs. */
  function capture(libelle) {
    if (!enCours) return;
    var c = capturer(enCours.g, libelle || 'capture');
    if (c) { c.t_ms = ahora() - enCours.t0; enCours.captures.push(c); }
  }

  /* Horloge RÉELLE, liée au chargement : un test étiqueté `rendu` remplace
     performance.now par une horloge déterministe (tests/rendu-repro.js,
     SPEC-BANC-084) ; les durées et métriques d'images, elles, restent mesurées
     en temps réel. */
  var maintenantReel = (typeof performance !== 'undefined' && performance.now) ? performance.now.bind(performance) : function () { return Date.now(); };
  function ahora() { return maintenantReel(); }
  function moyenne(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }

  // ─── étapes déclarées et triplets d'images (SPEC-BANC-077 à 083) ──────────
  /* Dessine le canvas de rendu COURANT dans un canvas hors-écran, SANS
     encoder en JPEG (la compression, coûteuse, est différée hors de la
     boucle de collecte — voir capturerTriplet ci-dessous). `g.render.render()`
     est rappelé avant, comme `capturer()` ci-dessus : le tampon peut avoir
     été consommé par la boucle de jeu normale entre deux `await`. */
  function dessinerFrame(g) {
    try {
      rendreTout(g);
      var src = g.render.renderer.domElement;
      var w = src.width, h = src.height;
      if (!w || !h) return null;
      var echelle = Math.min(1, 320 / w);
      var cw = Math.max(1, Math.round(w * echelle)), ch = Math.max(1, Math.round(h * echelle));
      var c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      // { willReadFrequently: true } dès la création : ce canvas est relu
      // par getImageData (ecartPixelsMoyen) — l'option ne s'applique qu'au
      // PREMIER getContext(), la reposer plus tard n'aurait aucun effet.
      c.getContext('2d', { willReadFrequently: true }).drawImage(src, 0, 0, cw, ch);
      return c;
    } catch (e) { return null; }
  }
  /* Pose de la caméra et position du joueur (SPEC-BANC-079). */
  function poseCourante(g) {
    var cam = g.render && g.render.camera, s = g.player && g.player.state;
    return {
      camera: cam ? { x: cam.position.x, y: cam.position.y, z: cam.position.z,
        qx: cam.quaternion.x, qy: cam.quaternion.y, qz: cam.quaternion.z, qw: cam.quaternion.w } : null,
      joueur: s ? { x: s.pos.x, y: s.pos.y, z: s.pos.z } : null,
    };
  }
  function ecartPose(a, b) {
    if (!a || !b || !a.camera || !b.camera) return 0;
    var dp = Math.hypot(a.camera.x - b.camera.x, a.camera.y - b.camera.y, a.camera.z - b.camera.z);
    var dq = Math.hypot(a.camera.qx - b.camera.qx, a.camera.qy - b.camera.qy, a.camera.qz - b.camera.qz, a.camera.qw - b.camera.qw);
    return dp + dq;
  }
  /* Écart moyen de pixels entre deux images (échantillonné : un pixel sur
     ~7, coût borné même à haute résolution) — 0-255 par canal, moyenne des
     trois canaux (SPEC-BANC-081). */
  function ecartPixelsMoyen(cA, cB) {
    if (!cA || !cB) return 0;
    try {
      var w = Math.min(cA.width, cB.width), h = Math.min(cA.height, cB.height);
      if (!w || !h) return 0;
      // { willReadFrequently: true } : évite l'avertissement navigateur
      // (Canvas2D readback lent sans cette option) — ce canvas SERT à lire
      // ses pixels, jamais à être réaffiché.
      var dA = cA.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
      var dB = cB.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
      var somme = 0, n = 0, pas = 4 * 7;
      for (var i = 0; i < dA.length; i += pas) {
        somme += Math.abs(dA[i] - dB[i]) + Math.abs(dA[i + 1] - dB[i + 1]) + Math.abs(dA[i + 2] - dB[i + 2]);
        n++;
      }
      return n ? somme / (n * 3) : 0;
    } catch (e) { return 0; }
  }
  /* Capture un TRIPLET de 3 images RÉELLEMENT consécutives (SPEC-BANC-078) :
     lues dans la boucle de rendu juste après `renderer.render()` (via
     `dessinerFrame`, ci-dessus), sur les images N, N+1, N+2 — `await frames(1)`
     entre chaque laisse la vraie boucle de jeu avancer d'exactement une
     image entre deux lectures. La compression JPEG (`toDataURL`) est
     différée APRÈS la collecte des trois canvases, hors de cette boucle. */
  var compteurImagesTriplet = 0;
  /* Mouvement scripté (SPEC-BANC-082) : l'image i du triplet est prise à la
     pose pose0 + i × pas (tests/rendu-repro.js), POSÉE avant d'attendre
     l'image du jeu — la pose ne dépend donc ni de l'horloge ni de la charge,
     et se rejoue à l'identique. */
  function lirePoseJoueur(g) {
    var s = g.player.state;
    return { x: s.pos.x, y: s.pos.y, z: s.pos.z, yaw: s.yaw, pitch: s.pitch };
  }
  function poserJoueur(g, p) {
    var s = g.player.state;
    s.pos.x = p.x; s.pos.y = p.y; s.pos.z = p.z; s.yaw = p.yaw; s.pitch = p.pitch;
    s.vel.x = s.vel.y = s.vel.z = 0;
  }
  function capturerTriplet(g, nomEtape, bord, mouvement) {
    return (async function () {
      var images = [];
      var pose0 = mouvement ? lirePoseJoueur(g) : null;
      if (mouvement) g.player.state.flying = true;     // pas de chute pendant un mouvement scripté
      for (var i = 0; i < 3; i++) {
        if (mouvement) { poserJoueur(g, G.MC_REPRO.poseALImage(pose0, mouvement, i)); await (G.MC_REPRO.attendreImages || frames)(1); }
        else if (i > 0) await frames(1);
        var t = ahora();
        var c = dessinerFrame(g);
        compteurImagesTriplet++;
        images.push({ canvas: c, t_ms: t, numero: compteurImagesTriplet, pose: poseCourante(g) });
      }
      var ecartsPixels = [], ecartsPose = [];
      for (var k = 1; k < images.length; k++) {
        ecartsPixels.push(ecartPixelsMoyen(images[k - 1].canvas, images[k].canvas));
        ecartsPose.push(ecartPose(images[k - 1].pose, images[k].pose));
      }
      var instabilite = { pixels: moyenne(ecartsPixels), pose: moyenne(ecartsPose) };
      var t0Triplet = images[0].t_ms;
      // un canvas manqué (largeur/hauteur nulle, contexte perdu…) n'est
      // jamais poussé — même convention que capturer()/capture() ci-dessus,
      // qui ne poussent une capture qu'en cas de succès réel.
      var captures = images.filter(function (im) { return !!im.canvas; }).map(function (im, i) {
        return {
          role: 'triplet', etape: nomEtape, bord: bord, rang: i,
          libelle: nomEtape + '-' + bord + '-' + i,
          type: 'image/jpeg', base64: im.canvas.toDataURL('image/jpeg', 0.7),
          t_ms: Math.round(im.t_ms - (enCours ? enCours.t0 : t0Triplet)),
          numero_image: im.numero,
          duree_image_ms: i > 0 ? Math.round(im.t_ms - images[i - 1].t_ms) : 0,
          pose: im.pose, instabilite: instabilite,
        };
      });
      return { captures: captures, instabilite: instabilite, mouvement: mouvement ? G.MC_REPRO.decrire(mouvement) : null };
    })();
  }
  /* API e2e `T.etape('nom')` (SPEC-BANC-077) : ouvre une étape et ferme la
     précédente (ou l'étape implicite `test`, ouverte par runUnE2E avant
     d'appeler le corps du test). Chaque bord (début d'étape, fin d'étape)
     capture un triplet — la fermeture de l'étape précédente et l'ouverture
     de la suivante sont CHAÎNÉES (`ctx._chaineEtapes`) pour que deux appels
     rapprochés à `T.etape()` ne collectent jamais deux triplets en même
     temps sur le même test ; la chaîne est attendue par `conclure()` avant
     de rendre le résultat du test (voir runUnE2E plus bas), donc jamais
     bloquante pour le test lui-même : `T.etape()` reste un appel SYNCHRONE. */
  function fermerEtapeCourante(g, ctx) {
    var e = ctx.etapeCourante2;
    if (!e) return Promise.resolve();
    return capturerTriplet(g, e.nom, 'fin', e.mouvement || null).then(function (r) {
      e.fin = r;
      e.fin_t_ms = ahora() - ctx.t0;
      ctx.etapeCourante2 = null;
    });
  }
  function ouvrirEtape(g, ctx, nom, mouvement) {
    return capturerTriplet(g, nom, 'debut', mouvement || null).then(function (r) {
      var e = { nom: nom, mouvement: mouvement || null, debut: r, debut_t_ms: ahora() - ctx.t0, fin: null, fin_t_ms: null };
      ctx.etapesTriplets.push(e);
      ctx.etapeCourante2 = e;
    });
  }
  var T = {};
  /* `T.etape(nom, { mouvement: { type: 'rotation'|'deplacement', vitesse? } })` :
     une étape qui juge le tremblement EN MOUVEMENT (SPEC-BANC-082) ; sans
     `mouvement`, la caméra reste immobile et on juge scintillements et artefacts. */
  T.etape = function (nom, opts) {
    if (!enCours) return;
    var mouvement = opts && opts.mouvement ? opts.mouvement : null;
    if (mouvement) G.MC_REPRO.pasMouvement(mouvement, 0);    // mouvement inconnu : refusé tout de suite, pas dans la chaîne asynchrone
    var ctx = enCours;
    ctx._chaineEtapes = (ctx._chaineEtapes || Promise.resolve()).then(function () {
      var suite = ctx.etapeCourante2 ? fermerEtapeCourante(ctx.g, ctx) : Promise.resolve();
      return suite.then(function () { return ouvrirEtape(ctx.g, ctx, nom, mouvement); });
    });
  };

  /* `T.mesure(titre, entetes, lignes)` (SPEC-LIMITE-007) : ajoute un tableau de
     mesures au cahier de test, sous les captures du test en cours (clé
     `mesures` de resultats.json, rendue par tests/rapport.js). `lignes` :
     tableaux de cellules (texte ou nombre). Sans test instrumenté, ne fait rien. */
  T.mesure = function (titre, entetes, lignes) {
    if (!enCours) return;
    enCours.mesures.push({
      titre: String(titre), entetes: entetes.map(String),
      lignes: lignes.map(function (l) { return l.map(function (c) { return String(c); }); }),
    });
  };

  // ─── utilitaires ───────────────────────────────────────────────────────────
  /* Attend n images RÉELLES. Piège : une version qui teste le compteur avant
     le premier requestAnimationFrame résout de façon synchrone pour n=1, et
     tous les `for (...) await frames(1)` tournent alors sans jamais laisser
     la boucle de jeu s'exécuter. */
  function frames(n) {
    return new Promise(function (res) {
      var left = Math.max(1, n | 0);
      var step = function () {
        if (enCours) enCours.images.push(ahora());
        if (--left <= 0) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* En contexte de test, `pointerLockElement` est simulé (`Object.defineProperty`)
     pour que le jeu se croie en partie sans geste utilisateur réel — c'est
     exactement ce que teste la machine à états. Mais sous automatisation
     (Playwright/CDP), `canvas.requestPointerLock()` peut réellement aboutir
     SANS geste utilisateur, contrairement à un navigateur utilisé à la main :
     `src/input.js` appelle ces vraies API à chaque changement d'état
     (`requestLock`/`exitLock`), et un octroi ou une levée réel(le), asynchrone,
     déclenche un VRAI `pointerlockchange` — lu par `isLocked()` via ce même
     getter truqué, donc DÉSYNCHRONISÉ du vrai verrou natif. Un test peut ainsi
     se retrouver mis en PAUSE par surprise, en pleine partie, par un octroi
     tardif que personne n'attendait (constaté sur SPEC-HISTOIRE-014, non
     reproductible en isolation, seulement après un test qui enchaîne
     plusieurs changements d'état verrouillés). On coupe donc les VRAIES API à
     la racine, une fois pour toutes : seule `fakeLock` pilote alors
     `pointerLockElement`, sans concurrence possible d'un événement natif. */
  var verrouReelCoupe = false;
  function couperVerrouReel(g) {
    if (verrouReelCoupe) return;
    verrouReelCoupe = true;
    try {
      g.render.renderer.domElement.requestPointerLock = function () { return Promise.resolve(); };
    } catch (e) { /* rien */ }
    try { document.exitPointerLock = function () {}; } catch (e) { /* rien */ }
  }
  function fakeLock(g, on) {
    couperVerrouReel(g);
    var cv = g.render.renderer.domElement;
    Object.defineProperty(document, 'pointerLockElement',
      { get: function () { return on ? cv : null; }, configurable: true });
    document.dispatchEvent(new Event('pointerlockchange'));
  }

  function key(code, type) {
    window.dispatchEvent(new KeyboardEvent(type || 'keydown', { code: code, bubbles: true }));
  }
  function mouseDown(g, button) {
    g.render.renderer.domElement.dispatchEvent(
      new MouseEvent('mousedown', { button: button, bubbles: true, cancelable: true }));
  }
  function mouseUp(button) {
    window.dispatchEvent(new MouseEvent('mouseup', { button: button, bubbles: true }));
  }
  function look(dx, dy) {
    document.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy }));
  }

  var C, I, B, Inv, P;
  function initRefs() { C = MC.Core; I = C.I; B = C.B; Inv = MC.Inventory; P = MC.Physics; }

  /* Remet la partie dans un état connu : au sol, en vie, inventaire vide. */
  async function reset(g) {
    g.input.setState('playing');
    fakeLock(g, true);
    var s = g.player.state;
    s.inv.load([]);
    s.hp = 20; s.hunger = 20; s.air = 10; s.dead = false; s.flying = false;
    s.selected = 0; s.exhaustion = 0; s.vel.x = s.vel.y = s.vel.z = 0;
    /* Le suivi de chute survit à la téléportation ci-dessous : un test qui
       laisse le joueur tomber de haut (« avancer » finit en l'air, vol coupé)
       ferait sinon « atterrir » d'une chute de 60 blocs au point d'apparition
       et le tuerait, de façon intermittente selon les images écoulées. */
    s.fallFrom = null; s.onGround = false;
    g.entities.list.length = 0;
    var col = g.world.findSpawnColumn();
    /* Le chunk du point d'apparition doit être VRAIMENT chargé avant qu'on y
       lise le sol : `groundAt` s'appuie sur `getBlock`, qui rend 0 (rien de
       solide) pour un chunk absent — le sol tomberait alors au bedrock (0),
       loin sous le vrai terrain, et tout bloc posé ensuite près du départ
       (setBlock) échouerait en silence (chunk absent) sur les chunks pas
       encore revenus. Ça ne pouvait pas arriver tant que la génération
       restait synchrone ; devenue asynchrone par workers (L47), un test qui
       vient de téléporter loin (donjon, etc.) puis de faire `reset()` peut
       repartir d'ici AVANT que les chunks d'origine ne soient revenus.
       `getChunk(..., true)` génère d'abord le chunk exact (sol correct),
       puis `streamChunks(true)` — synchrone, sans worker (SPEC-PERF-006) —
       recharge tout son voisinage avant de rendre la main, comme le font
       déjà les tests qui téléportent eux-mêmes (SPEC-DONJON-004, EAU-008).
       Sans nouveau chunk à générer, son coût reste négligeable (Map.has). */
    var scx = Math.floor(col[0] / MC.Core.CHUNK_X), scz = Math.floor(col[1] / MC.Core.CHUNK_Z);
    g.world.getChunk(scx, scz, true);
    var gy = g.world.groundAt(col[0], col[1], true);
    s.pos.x = col[0] + 0.5; s.pos.y = gy + 1.2; s.pos.z = col[1] + 0.5;
    s.yaw = 0; s.pitch = 0;
    g.streamChunks(true);
    await frames(3);
    return s;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Démarrage et états
  // ══════════════════════════════════════════════════════════════════════════
  e2e('le jeu démarre sur le menu principal, monde déjà généré', {
        "teste": "au premier chargement, l'état est menu et le monde est déjà généré en arrière-plan",
        "pourquoi": "un joueur qui arrive doit voir le menu tout de suite, sans attendre la génération",
        "attendu": "état menu, overlay visible, des chunks déjà présents, boutons Nouvelle partie et Multijoueur"
  }, async function (g) {
    g.input.setState('menu');
    await frames(2);
    A.equal(g.input.state, 'menu', 'état menu');
    A.equal(getComputedStyle(document.querySelector('.overlay')).display, 'flex', 'écran visible');
    A.gt(g.world.chunks.size, 20, 'chunks déjà générés (' + g.world.chunks.size + ')');
    A.ok(document.querySelector('#btn-nouvelle'), 'bouton Nouvelle partie present');
    A.ok(document.querySelector('#btn-multi'), 'bouton Multijoueur present');
  });

  /* Le viseur est centré en CSS sur son conteneur : s'il ne coïncide pas avec
     le centre du canvas, on vise à côté de ce qu'on croit viser. On compare au
     conteneur (et non à la fenêtre) pour que le test vaille aussi dans la page
     de tests, où la partie est affichée dans un cadre réduit. */
  e2e('le viseur coïncide avec le centre du canvas', {
        "teste": "l'alignement visuel du viseur (crosshair) avec le centre du canvas de rendu",
        "pourquoi": "un viseur décalé ferait viser un bloc différent de celui affiché à l'écran",
        "attendu": "le canvas remplit son conteneur, le viseur est centré horizontalement et verticalement, l'aspect caméra suit"
  }, async function (g) {
    var cv = g.render.renderer.domElement;
    var host = cv.parentElement;
    var r = cv.getBoundingClientRect();
    // On compare deux rectangles VISUELS (getBoundingClientRect des deux
    // côtés) plutôt que la taille visuelle du canvas à la taille en disposition
    // (clientWidth) de son conteneur : le banc loge le jeu dans une surface
    // virtuelle mise à l'échelle par CSS (SPEC-BANC-017), où les deux
    // diffèrent légitimement — seule la comparaison visuelle reste valable
    // dans les deux cas (jeu plein cadre ou surface réduite par transform).
    var rHost = host.getBoundingClientRect();
    A.close(r.width, rHost.width, 1.5, 'le canvas remplit son conteneur en largeur');
    A.close(r.height, rHost.height, 1.5, 'et en hauteur');
    var cr = g.ui.hudDe(0).querySelector('.crosshair').getBoundingClientRect();
    A.close(cr.left + cr.width / 2, r.left + r.width / 2, 1.5, 'viseur centré horizontalement');
    A.close(cr.top + cr.height / 2, r.top + r.height / 2, 1.5, 'viseur centré verticalement');
    // et le rapport d'aspect de la caméra doit suivre, sinon l'image est étirée
    A.close(g.render.camera.aspect, r.width / r.height, 0.02, 'aspect de la caméra cohérent');
  });

  e2e('passer en partie masque le menu', {
        "teste": "le passage à l'état playing masque l'overlay du menu",
        "pourquoi": "le menu ne doit pas rester visible par-dessus le jeu une fois la partie lancée",
        "attendu": "état playing et overlay display: none"
  }, async function (g) {
    g.input.setState('playing');
    fakeLock(g, true);
    await frames(2);
    A.equal(g.input.state, 'playing');
    A.equal(getComputedStyle(document.querySelector('.overlay')).display, 'none', 'menu masqué');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Capture souris et pause  (les défauts signalés)
  // ══════════════════════════════════════════════════════════════════════════
  e2e('perdre la capture souris met le jeu en PAUSE', {
        "teste": "perdre le pointer lock (Échap, clic hors fenêtre) fait passer le jeu en pause plutôt qu'en course libre",
        "pourquoi": "sans ce garde-fou, un joueur qui perd la capture continuerait à bouger sans contrôle",
        "attendu": "état paused et menu pause affiché"
  }, async function (g) {
    await reset(g);
    A.equal(g.input.state, 'playing', 'en partie');
    fakeLock(g, false);                     // simule Échap / clic hors fenêtre
    await frames(2);
    A.equal(g.input.state, 'paused', 'le jeu est passé en pause, pas en course libre');
    A.equal(getComputedStyle(document.querySelector('.overlay')).display, 'flex', 'menu pause affiché');
  });

  e2e('en pause, le monde est figé', {
        "teste": "qu'en pause, ni la physique du joueur ni l'horloge du monde n'avancent",
        "pourquoi": "une pause qui laisse tomber le joueur ou avancer le temps trahit sa promesse d'arrêt",
        "attendu": "position Y et g.time inchangés après 30 frames en pause"
  }, async function (g) {
    await reset(g);
    var s = g.player.state;
    s.pos.y += 8;                            // en l'air : il devrait tomber
    fakeLock(g, false);
    await frames(2);
    var y0 = s.pos.y, t0 = g.time;
    await frames(30);
    A.close(s.pos.y, y0, 1e-6, 'le joueur ne bouge plus');
    A.close(g.time, t0, 1e-6, 'le temps du monde est figé');
  });

  e2e('perdre le focus de la fenêtre met en pause', {
        "teste": "l'événement blur de la fenêtre déclenche la pause",
        "pourquoi": "changer d'onglet ou d'application ne doit pas laisser le jeu tourner sans contrôle",
        "attendu": "état paused après un événement blur"
  }, async function (g) {
    await reset(g);
    window.dispatchEvent(new Event('blur'));
    await frames(2);
    A.equal(g.input.state, 'paused', 'pause sur perte de focus');
  });

  e2e('les touches sont relâchées quand on perd le contrôle', {
        "teste": "que les actions clavier (ex. avancer) retombent à faux quand la capture est perdue",
        "pourquoi": "sans ça, une touche maintenue au moment de la perte de contrôle resterait bloquée en 'appuyée', créant une dérive fantôme au retour",
        "attendu": "actions().forward vrai touche enfoncée, puis faux après fakeLock(false)"
  }, async function (g) {
    await reset(g);
    key('KeyW');
    A.ok(g.input.actions().forward, 'touche enfoncée');
    fakeLock(g, false);
    await frames(2);
    A.notOk(g.input.actions().forward, 'touche relâchée : pas de dérive fantôme');
  });

  e2e('reprendre depuis la pause relance la partie', {
        "teste": "le bouton Reprendre du menu pause ramène en état playing",
        "pourquoi": "c'est le chemin normal de retour au jeu après une pause",
        "attendu": "après clic sur #btn-resume et reverrouillage souris, état playing"
  }, async function (g) {
    await reset(g);
    fakeLock(g, false);
    await frames(2);
    A.equal(g.input.state, 'paused');
    document.querySelector('#btn-resume').click();
    fakeLock(g, true);
    await frames(3);
    A.equal(g.input.state, 'playing', 'partie reprise');
  });

  e2e('Échap bascule partie ↔ pause', {
        "teste": "la touche Échap fait l'aller-retour entre playing et paused",
        "pourquoi": "c'est le raccourci clavier attendu par convention pour mettre en pause",
        "attendu": "premier Échap => paused, second Échap (avec verrouillage souris) => playing"
  }, async function (g) {
    await reset(g);
    key('Escape');
    await frames(2);
    A.equal(g.input.state, 'paused', 'Échap met en pause');
    key('Escape');
    fakeLock(g, true);
    await frames(2);
    A.equal(g.input.state, 'playing', 'Échap reprend');
  });

  e2e('la souris ne fait pivoter la vue qu\'en partie', {
        "teste": "que le mouvement souris ne change le yaw qu'en état playing, pas en pause",
        "pourquoi": "en pause, la vue ne doit plus répondre à la souris (menu affiché par-dessus)",
        "attendu": "yaw change en playing, yaw inchangé après un look() en pause"
  }, async function (g) {
    await reset(g);
    var y0 = g.player.state.yaw;
    look(100, 0);
    A.ne(g.player.state.yaw, y0, 'en partie : la vue tourne');

    fakeLock(g, false);
    await frames(2);
    var y1 = g.player.state.yaw;
    look(100, 0);
    A.equal(g.player.state.yaw, y1, 'en pause : la vue ne bouge plus');
  });

  e2e('un delta de souris aberrant est ignoré', {
        "teste": "qu'un très grand delta de souris (artefact d'acquisition du pointer lock) est filtré",
        "pourquoi": "sans filtre, le premier mouvement après capture ferait tourner la caméra violemment",
        "attendu": "yaw inchangé après un delta de 5000, mais un mouvement normal (50) fait tourner la vue"
  }, async function (g) {
    await reset(g);
    var y0 = g.player.state.yaw;
    look(5000, 0);                           // artefact d'acquisition du verrou
    A.equal(g.player.state.yaw, y0, 'le saut de vue est filtré');
    look(50, 0);
    A.ne(g.player.state.yaw, y0, 'un mouvement normal passe');
  });

  e2e('la souris tourne dans le bon sens', {
        "teste": "le sens de rotation de la caméra en fonction du mouvement de la souris",
        "pourquoi": "une inversion d'axe rendrait le jeu injouable",
        "attendu": "souris à droite tourne à droite (produit vectoriel positif), souris en bas fait regarder vers le bas (pitch négatif)"
  }, async function (g) {
    await reset(g);
    var s = g.player.state;
    s.yaw = 0; s.pitch = 0;
    function avant(yaw) { return { x: -Math.sin(yaw), z: -Math.cos(yaw) }; }
    var f0 = avant(0);
    look(120, 0);                            // souris vers la droite
    var f1 = avant(s.yaw);
    A.gt(f0.x * f1.z - f0.z * f1.x, 0, 'souris à droite => on tourne à droite');
    s.pitch = 0;
    look(0, 120);                            // souris vers le bas
    A.lt(s.pitch, 0, 'souris en bas => on regarde en bas');
  });

  e2e('le tangage est borné : on ne se retourne jamais', {
        "teste": "que le pitch (tangage) reste borné à ±90° même avec un mouvement souris massif",
        "pourquoi": "sans borne, le joueur pourrait faire un tour complet et perdre tout repère visuel",
        "attendu": "|pitch| < π/2 + epsilon dans les deux sens, même après de nombreux mouvements extrêmes"
  }, async function (g) {
    await reset(g);
    for (var i = 0; i < 60; i++) look(0, -150);
    A.lt(Math.abs(g.player.state.pitch), Math.PI / 2 + 1e-6, 'tangage borné');
    for (var j = 0; j < 120; j++) look(0, 150);
    A.lt(Math.abs(g.player.state.pitch), Math.PI / 2 + 1e-6, 'borné dans l\'autre sens');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Déplacement réel dans la boucle
  // ══════════════════════════════════════════════════════════════════════════
  e2e('avancer déplace le joueur dans la direction du regard', {
        "teste": "que la touche avancer (Z/W) déplace le joueur dans l'axe où il regarde, pour les 4 directions cardinales",
        "pourquoi": "c'est le déplacement de base du jeu ; un décalage entre regard et mouvement casserait toute la navigation",
        "attendu": "à chaque yaw testé, un déplacement notable et aligné (produit scalaire > 0.97) avec la direction du regard"
  }, async function (g) {
    var s = await reset(g);
    s.flying = true;
    for (var deg = 0; deg < 360; deg += 90) {
      s.yaw = deg * Math.PI / 180;
      s.pos.y = 60; s.vel.x = s.vel.y = s.vel.z = 0;
      var x0 = s.pos.x, z0 = s.pos.z;
      key('KeyW');
      await frames(45);
      key('KeyW', 'keyup');
      await frames(2);
      var dx = s.pos.x - x0, dz = s.pos.z - z0, n = Math.hypot(dx, dz);
      A.gt(n, 0.5, 'déplacement à ' + deg + '°');
      var look2 = { x: -Math.sin(s.yaw), z: -Math.cos(s.yaw) };
      A.gt((dx / n) * look2.x + (dz / n) * look2.z, 0.97, 'aligné sur le regard à ' + deg + '°');
    }
    s.flying = false;
  });

  e2e('le joueur tombe et se pose sur le terrain', {
        "teste": "la gravité et la résolution de collision au sol après une chute",
        "pourquoi": "le joueur doit finir par se stabiliser sur un bloc solide, pas traverser le sol ni rester suspendu",
        "attendu": "onGround devient vrai et un bloc solide se trouve sous les pieds"
  }, async function (g) {
    var s = await reset(g);
    s.pos.y += 12;
    s.vel.y = 0;
    for (var i = 0; i < 200 && !s.onGround; i++) await frames(1);
    A.ok(s.onGround, 'posé au sol');
    A.ok(MC.Core.isSolid(g.world.getBlock(Math.floor(s.pos.x), Math.floor(s.pos.y) - 1, Math.floor(s.pos.z))),
      'un bloc solide sous les pieds');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Inventaire et craft par l'interface
  // ══════════════════════════════════════════════════════════════════════════
  e2e('E ouvre l\'inventaire et libère la souris', {
        "teste": "la touche E ouvre l'écran d'inventaire (état ui) et le referme en playing",
        "pourquoi": "c'est le raccourci standard pour accéder à l'inventaire pendant la partie",
        "attendu": "état ui et .inv-screen visible après E, retour à playing après un second E"
  }, async function (g) {
    await reset(g);
    key('KeyE');
    await frames(2);
    A.equal(g.input.state, 'ui', 'état interface');
    A.equal(getComputedStyle(document.querySelector('.inv-screen')).display, 'flex', 'inventaire visible');
    key('KeyE');
    fakeLock(g, true);
    await frames(2);
    A.equal(g.input.state, 'playing', 'refermé');
  });

  e2e('Échap ferme l\'inventaire sans passer par la pause', {
        "teste": "que Échap, depuis l'inventaire ouvert, ramène directement en playing sans passer par paused",
        "pourquoi": "fermer l'inventaire ne doit pas mettre le jeu en pause : ce sont deux écrans distincts",
        "attendu": "état playing directement après Échap depuis l'inventaire"
  }, async function (g) {
    await reset(g);
    key('KeyE');
    await frames(2);
    key('Escape');
    fakeLock(g, true);
    await frames(2);
    A.equal(g.input.state, 'playing', 'retour direct en partie');
  });

  e2e('l\'inventaire affiche les objets détenus', {
        "teste": "que le contenu réel de l'inventaire (quantités) est rendu dans l'écran .inv-screen",
        "pourquoi": "l'affichage doit refléter fidèlement l'état de l'inventaire du joueur",
        "attendu": "la quantité 17 apparaît dans le texte de l'écran après avoir ajouté 17 cobble"
  }, async function (g) {
    var s = await reset(g);
    s.inv.add(B.COBBLE, 17);
    key('KeyE');
    await frames(2);
    var txt = document.querySelector('.inv-screen').textContent;
    A.ok(txt.indexOf('17') >= 0, 'la quantité 17 est affichée');
    key('Escape'); fakeLock(g, true); await frames(2);
  });

  e2e('cliquer déplace une pile entre deux cases', {
        "teste": "le glisser-déposer d'une pile d'objets entre deux cases de l'inventaire au clic gauche",
        "pourquoi": "c'est l'interaction de base pour réorganiser son inventaire",
        "attendu": "clic sur la case source prend la pile en main, clic sur la case cible la dépose, la source se vide"
  }, async function (g) {
    var s = await reset(g);
    s.inv.add(B.COBBLE, 10);
    key('KeyE');
    await frames(2);
    var slots = document.querySelectorAll('.inv-screen .hb-row .slot');
    slots[0].dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    A.ok(g.ui.heldStack, 'pile prise en main');
    A.equal(g.ui.heldStack.n, 10);
    slots[3].dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    A.notOk(g.ui.heldStack, 'pile reposée');
    A.equal(s.inv.slots[3].n, 10, 'arrivée en case 3');
    A.equal(s.inv.slots[0], null, 'case 0 vidée');
    key('Escape'); fakeLock(g, true); await frames(2);
  });

  e2e('le clic droit prend la moitié d\'une pile', {
        "teste": "que le clic droit sur une pile n'en prend que la moitié, en laissant l'autre moitié affichée en place",
        "pourquoi": "c'est le comportement standard attendu pour scinder une pile ; depuis B1 (docs/vague-2/B1.md § 6), la pile n'est jamais réellement retirée de sa case avant qu'une opération de transfert n'ait réellement abouti — seul l'AFFICHAGE de l'origine est réduit",
        "attendu": "5 « tenus » (heldStack) et 5 affichés sur la case d'origine, sans que la case ait réellement bougé tant que rien n'a été déposé ailleurs"
  }, async function (g) {
    var s = await reset(g);
    s.inv.add(B.COBBLE, 10);
    key('KeyE');
    await frames(2);
    var slots = document.querySelectorAll('.inv-screen .hb-row .slot');
    slots[0].dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }));
    A.equal(g.ui.heldStack.n, 5, 'moitié prise (visuellement)');
    A.equal(s.inv.slots[0].n, 10, 'la case réelle n\'a pas encore bougé (rien n\'a été déposé)');
    A.equal(document.querySelectorAll('.inv-screen .hb-row .slot')[0].querySelector('.n').textContent, '5',
      'l\'affichage de l\'origine est bien réduit de moitié');
    // clic droit ailleurs : dépose une unité pour de vrai (transfert n=1)
    slots[3].dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }));
    A.equal(s.inv.slots[0].n, 9, 'une unité réellement partie de l\'origine');
    A.equal(s.inv.slots[3].n, 1, 'une unité réellement arrivée à la cible');
    A.equal(g.ui.heldStack.n, 4, 'reste 4 en main');
    slots[0].dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    A.notOk(g.ui.heldStack, 'reclic sur l\'origine : annulé');
    A.equal(s.inv.slots[0].n, 9, 'rien de plus n\'a bougé lors de l\'annulation');
    key('Escape'); fakeLock(g, true); await frames(2);
  });

  e2e('crafter des planches depuis un tronc, via l\'interface', {
        "teste": "le circuit complet de craft à travers l'UI : poser un tronc dans la grille de craft, obtenir des planches",
        "pourquoi": "vérifie que la reconnaissance de recette et le remplissage d'inventaire fonctionnent bout en bout via les vrais clics UI ; depuis B1 (docs/vague-2/B1.md § 6), un craft (opération `MC.Conteneurs`) va TOUJOURS directement dans l'inventaire, jamais dans la main",
        "attendu": "une recette reconnue donnant 4 planches, rentrées directement dans l'inventaire (jamais tenues en main)"
  }, async function (g) {
    var s = await reset(g);
    s.inv.add(B.LOG, 1);
    key('KeyE');
    await frames(2);
    // prendre le tronc dans la hotbar
    document.querySelectorAll('.inv-screen .hb-row .slot')[0]
      .dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    // le poser dans la grille de craft
    document.querySelectorAll('.inv-screen .craft-grid .slot')[0]
      .dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    A.ok(g.ui.container.result, 'une recette est reconnue');
    A.equal(g.ui.container.result.id, B.PLANKS, 'planches');
    // prendre le résultat
    document.querySelector('.inv-screen .slot.result')
      .dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    A.notOk(g.ui.heldStack, 'rien en main : le craft va direct à l\'inventaire');
    A.equal(s.inv.count(B.PLANKS), 4, '4 planches rentrées à l\'inventaire aussitôt');
    key('Escape'); fakeLock(g, true); await frames(3);
    A.equal(s.inv.count(B.PLANKS), 4, 'toujours là après fermeture');
  });

  e2e('fermer l\'inventaire rend les objets restés dans la grille', {
        "teste": "que fermer l'inventaire restitue au joueur les objets laissés dans la grille de craft (rien n'est perdu)",
        "pourquoi": "un objet oublié dans la grille de craft ne doit jamais disparaître à la fermeture",
        "attendu": "objets sortis de l'inventaire pendant le craft, puis intégralement restitués après fermeture (Échap)"
  }, async function (g) {
    var s = await reset(g);
    s.inv.add(B.COBBLE, 8);
    key('KeyE');
    await frames(2);
    document.querySelectorAll('.inv-screen .hb-row .slot')[0]
      .dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    document.querySelectorAll('.inv-screen .craft-grid .slot')[0]
      .dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    A.equal(s.inv.count(B.COBBLE), 0, 'sortis de l\'inventaire');
    key('Escape'); fakeLock(g, true); await frames(3);
    A.equal(s.inv.count(B.COBBLE), 8, 'restitués à la fermeture — rien n\'est perdu');
  });

  e2e('un établi posé ouvre une grille 3×3', {
        "teste": "l'interaction avec un établi posé dans le monde : il ouvre bien une interface de craft avec grille 3×3",
        "pourquoi": "l'établi doit donner accès à la grande grille de craft, contrairement à la grille 2×2 de l'inventaire seul",
        "attendu": "useOn renvoie 'open:craft' et la grille affichée contient 9 cases"
  }, async function (g) {
    var s = await reset(g);
    var bx = Math.floor(s.pos.x), bz = Math.floor(s.pos.z) + 2;
    var by = g.world.groundAt(bx, bz, true) + 1;
    g.world.setBlock(bx, by, bz, B.CRAFTING_TABLE);
    var res = g.player.useOn({ x: bx, y: by, z: bz, block: B.CRAFTING_TABLE, nx: 0, ny: 1, nz: 0 });
    A.equal(res, 'open:craft', 'l\'établi demande son interface');
    g.ui.openContainer('craft', s.inv, null, undefined, s.grille);
    g.input.setState('ui');
    await frames(2);
    A.equal(document.querySelectorAll('.inv-screen .craft-grid .slot').length, 9, 'grille 3×3');
    key('Escape'); fakeLock(g, true); await frames(2);
  });

  e2e('SPEC-CONSTR-001 : deux escaliers posés s\'orientent et s\'ajustent en angle, dans la vraie boucle', {
        "teste": "la pose d'escaliers dans la boucle de jeu réelle : orientation selon le regard, puis ajustement d'angle (forme intérieure/extérieure) entre deux escaliers adjacents perpendiculaires",
        "pourquoi": "couvre SPEC-CONSTR-001 en conditions réelles (rendu inclus), pas seulement en test unitaire de la logique de formes",
        "attendu": "le premier escalier s'oriente selon le regard du joueur ; le second, adjacent et perpendiculaire, fait prendre à au moins l'un des deux une forme d'angle plutôt que droite"
  }, async function (g) {
    var s = await reset(g);
    var bx = Math.floor(s.pos.x), bz = Math.floor(s.pos.z) + 2;
    var by = g.world.groundAt(bx, bz, true) + 1;
    // un appui maîtrisé : ce qui se trouve là (établi d'une maison…) ne doit pas intercepter la pose
    [0, 1].forEach(function (dz) {
      g.world.setBlock(bx, by - 1, bz + dz, B.STONE);
      for (var yy = by; yy < by + 3; yy++) g.world.setBlock(bx, yy, bz + dz, 0);
    });
    s.inv.add(B.ESCALIER_STONE, 2); s.selected = 0;
    s.yaw = 0;
    var res = g.player.useOn({ x: bx, y: by - 1, z: bz, block: g.world.getBlock(bx, by - 1, bz),
                               nx: 0, ny: 1, nz: 0, t: 1 });
    A.equal(res, 'place', 'l\'escalier se pose');
    A.equal(g.world.getBlock(bx, by, bz), B.ESCALIER_STONE, 'le bon bloc est posé');
    var etat = MC.Formes.unpackEscalier(g.world.getEtat(bx, by, bz));
    A.equal(etat.orientation, C.orientDeRegard(g.player.lookDir()), 'orienté selon le regard');
    // laisse le mailleur reconstruire le chunk (une géométrie non cubique de
    // plus) sans lever d'exception dans la vraie boucle de rendu
    await frames(5);

    // un second, perpendiculaire et adjacent : l'angle s'ajuste tout seul
    s.yaw = Math.PI / 2;
    var res2 = g.player.useOn({ x: bx, y: by - 1, z: bz + 1, block: g.world.getBlock(bx, by - 1, bz + 1),
                                nx: 0, ny: 1, nz: 0, t: 1 });
    A.equal(res2, 'place', 'le second escalier se pose');
    await frames(5);
    var e0 = MC.Formes.unpackEscalier(g.world.getEtat(bx, by, bz));
    var e1 = MC.Formes.unpackEscalier(g.world.getEtat(bx, by, bz + 1));
    A.ok(e0.forme !== MC.Formes.DROIT || e1.forme !== MC.Formes.DROIT,
         'au moins un des deux a pris un angle intérieur ou extérieur');
  });

  /* Une petite scène dégagée devant le joueur : un sol de pierre de
     (2r+1)² cases sous ses pieds, de l'air sur 5 blocs au-dessus — ce qui
     se trouvait là (arbre, maison…) ne cache rien. Le joueur y est posé. */
  async function sceneDegagee(g, s, r) {
    var bx = Math.floor(s.pos.x), bz = Math.floor(s.pos.z), by = Math.floor(s.pos.y - 0.2);
    for (var dx = -r; dx <= r; dx++) for (var dz = -r; dz <= r; dz++) {
      g.world.setBlock(bx + dx, by - 1, bz + dz, B.STONE);
      for (var yy = by; yy < by + 5; yy++) g.world.setBlock(bx + dx, yy, bz + dz, 0);
    }
    s.pos.y = by; s.vel.x = s.vel.y = s.vel.z = 0;
    await frames(6);
    return { x: bx, y: by, z: bz };
  }

  e2e('SPEC-CONSTR-001 : un escalier de chaque matériau de construction se pose et s\'affiche', {
        "teste": "la pose, dans la vraie boucle, d'un escalier de chaque matériau de construction (béton, terre cuite, marbre, chaux, pavé, chaume, poutres…), en rangées devant le joueur, chacun orienté selon le regard ; deux rangs se raccordent en angle",
        "pourquoi": "les 23 escaliers ajoutés pour SPEC-CONSTR-001 doivent se poser, se mailler et s'afficher avec la texture de leur matériau, pas seulement exister dans les tables",
        "attendu": "chaque escalier est posé, orienté vers le regard, et la capture montre les rangées d'escaliers aux couleurs de leurs matériaux"
  }, async function (g) {
    var s = await reset(g);
    var o = await sceneDegagee(g, s, 9);
    var mats = ['BETON_ROUGE', 'BETON_JAUNE', 'BETON_BLEU', 'BETON_VERT', 'BETON_NOIR', 'BETON_BLANC', 'BETON_GRIS',
                'TERRACOTTA', 'TERRACOTTA_RED', 'TERRACOTTA_YELLOW', 'TERRACOTTA_BLUE', 'TERRACOTTA_GREEN', 'TERRACOTTA_BLACK',
                'TERRACOTTA_WHITE', 'TERRACOTTA_GRAY', 'MARBRE', 'CHAUX', 'PAVE', 'CHAUME',
                'POUTRE_CHENE', 'POUTRE_SAPIN', 'POUTRE_BOULEAU', 'POUTRE_ACACIA', 'POUTRE_JUNGLE'];
    s.yaw = 0; s.pitch = -0.5;               // regard vers le nord (-z), un peu vers le bas
    var poses = [];
    mats.forEach(function (m, i) {
      var esc = C.BLOCKS[B[m]].escalier;
      A.ok(esc, m + ' a un escalier');
      // trois rangées de huit, de 3 à 7 blocs devant le joueur
      var x = o.x - 4 + (i % 8), z = o.z - 3 - 2 * Math.floor(i / 8);
      s.inv.load([]); s.inv.add(esc, 1); s.selected = 0;
      var res = g.player.useOn({ x: x, y: o.y - 1, z: z, block: B.STONE, nx: 0, ny: 1, nz: 0, t: 1 });
      A.equal(res, 'place', m + ' : l\'escalier se pose');
      A.equal(g.world.getBlock(x, o.y, z), esc, m + ' : le bon escalier est en place');
      A.equal(MC.Formes.unpackEscalier(g.world.getEtat(x, o.y, z)).orientation, C.orientDeRegard(g.player.lookDir()),
              m + ' : orienté selon le regard');
      poses.push([x, z]);
    });
    // un peu en hauteur (en vol) pour embrasser les trois rangées
    s.flying = true; s.pos.y = o.y + 4; s.pos.z = o.z + 0.5; s.vel.x = s.vel.y = s.vel.z = 0;
    s.pitch = -0.7;
    await frames(20);
    capture('escaliers-de-chaque-materiau');
    // de biais : les marches, leurs contremarches et leurs textures
    s.pos.x = o.x + 5.5; s.yaw = 0.7; s.pitch = -0.6;
    await frames(6);
    capture('escaliers-de-biais');
    s.yaw = 0; s.pitch = 0; s.flying = false;
  });

  /* ── L24 : toitures (SPEC-CONSTR-003), intérieurs (SPEC-INTERIEUR-001), livres (SPEC-INTERIEUR-003) ──
     Un bâtiment généré (MC.Habitats, `batirBatimentPourEssai` : mêmes
     bâtisseurs que les lieux du monde) est recopié bloc par bloc, états
     compris, dans le monde affiché, devant le joueur, sur une dalle de pierre
     dégagée : ce qu'on voit est exactement ce que la génération pose. */
  function degager(g, x0, z0, x1, z1, ySol, h) {
    for (var x = x0; x <= x1; x++) for (var z = z0; z <= z1; z++) {
      g.world.setBlock(x, ySol - 1, z, B.STONE);
      for (var y = ySol; y < ySol + h; y++) g.world.setBlock(x, y, z, 0);
    }
  }
  function poserBatiment(g, l, dy) {
    var n = 0;
    l.blocs.forEach(function (a) {
      for (var i = 0; i < a.length; i += 5) {
        g.world.setBlock(a[i], a[i + 1] + dy, a[i + 2], a[i + 3]);
        if (a[i + 4]) g.world.setEtat(a[i], a[i + 1] + dy, a[i + 2], a[i + 4]);
        n++;
      }
    });
    return n;
  }
  /* Le premier bâtiment de ce type et de ce plan (une maison en L, une grange…)
     parmi quelques parcelles d'essai voisines. */
  function batimentDePlan(g, type, style, urbain, plan, ox, oz, L) {
    // le plan se tire de l'origine de la parcelle : on essaie les origines voisines
    for (var dz = 0; dz < 8; dz++) for (var dx = 0; dx < 8; dx++) {
      var l = g.world.habitats.batirBatimentPourEssai(type, style, urbain, 0, type === 'artisan' ? 'forgeron' : null, ox + dx, oz + dz, L);
      if (!plan || l.batiments[0].plan === plan) return l;
    }
    return null;
  }
  // dégage le terrain sous l'emprise d'un bâtiment d'essai (débord du toit compris), puis l'y pose
  function poserSurDalle(g, l, ySol) {
    var x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    l.blocs.forEach(function (a) { for (var i = 0; i < a.length; i += 5) { x0 = Math.min(x0, a[i]); x1 = Math.max(x1, a[i]); z0 = Math.min(z0, a[i + 2]); z1 = Math.max(z1, a[i + 2]); } });
    degager(g, x0 - 2, z0 - 2, x1 + 2, z1 + 2, ySol, 26);
    return poserBatiment(g, l, ySol - 65);
  }

  e2e('SPEC-CONSTR-003 : chaque style couvre ses bâtiments de son toit — pignon, raide, croupe, noue, plat, dôme, chapeau', {
        "teste": "des maisons générées de chaque style (colombages, isba, case d'acacia, maison sur pilotis, ville de brique, grès, igloo, champignon) et une maison en L, recopiées dans le monde affiché puis vues d'en haut, dans la vraie boucle",
        "pourquoi": "SPEC-CONSTR-003 : pans en pente, faîtages, arêtiers et noues doivent se mailler et s'afficher tels que la génération les pose, avec les angles automatiques des escaliers",
        "attendu": "chaque toit en pente est fait d'escaliers de son matériau (arêtiers en coins extérieurs pour la croupe, noue en coins intérieurs pour la maison en L), les autres styles gardent toit plat, dôme ou chapeau ; une capture par style",
        "delai": 240
  }, async function (g) {
    var s = await reset(g);
    var o = await sceneDegagee(g, s, 2);
    var H = MC.Habitats, Fo = MC.Formes;
    var cas = [['colombages-pignon', 'plaines', false, null], ['maison-en-L-noue', 'plaines', false, 'L'], ['isba-raide', 'taiga', false, null],
               ['case-croupe', 'savane', false, null], ['pilotis-croupe', 'jungle', false, null], ['ville-de-brique-croupe', 'plaines', true, null],
               ['gres-plat', 'desert', false, null], ['igloo-dome', 'pics_glaces', false, null], ['champignon-chapeau', 'champignons', false, null]];
    var ox = o.x - 5, oz = o.z - 18;
    for (var c = 0; c < cas.length; c++) {
      var nom = cas[c][0], sc = cas[c][1], urbain = cas[c][2], st = H.stylePour(sc, urbain);
      var l = batimentDePlan(g, 'maison', sc, urbain, cas[c][3], ox, oz, urbain ? 12 : 9);
      A.ok(l, nom + ' : un bâtiment généré');
      poserSurDalle(g, l, o.y);
      var formes = {}, escaliers = 0, b = l.batiments[0];
      for (var x = b.x0 - 2; x <= b.x1 + 2; x++) for (var z = b.z0 - 2; z <= b.z1 + 5; z++) for (var y = o.y; y < o.y + 24; y++) {
        var df = C.BLOCKS[g.world.getBlock(x, y, z)];
        if (df && df.forme === 'escalier' && df.mat === st.toit) { escaliers++; var f = Fo.unpackEscalier(g.world.getEtat(x, y, z)).forme; formes[f] = (formes[f] || 0) + 1; }
      }
      if (st.forme === 'pignon' || st.forme === 'raide') A.ok(escaliers > 10, nom + ' : un toit d\'escaliers (' + escaliers + ')');
      else A.equal(escaliers, 0, nom + ' : ' + st.forme + ' en blocs pleins, sans escalier');
      if (st.croupe) A.ok((formes[Fo.EXT_G] || 0) + (formes[Fo.EXT_D] || 0) >= 4, nom + ' : des arêtiers ' + JSON.stringify(formes));
      if (cas[c][3] === 'L') A.ok((formes[Fo.INT_G] || 0) + (formes[Fo.INT_D] || 0) >= 2, nom + ' : une noue ' + JSON.stringify(formes));
      // assez haut et assez loin pour embrasser tout le toit, même d'une maison de ville à étages
      var haut = b.y1 - 65 + o.y;
      s.flying = true; s.pos.x = (b.x0 + b.x1) / 2 + 0.5; s.pos.y = haut + 6; s.pos.z = b.z1 + 8 + (haut - o.y); s.vel.x = s.vel.y = s.vel.z = 0;
      s.yaw = 0; s.pitch = -0.55;
      await frames(24);
      capture('toit-' + nom);
    }
    s.flying = false; s.yaw = 0; s.pitch = 0;
  });

  e2e('SPEC-INTERIEUR-001 : on entre dans des intérieurs meublés — maison, grange, point info, auberge, forge, boutique', {
        "teste": "des bâtiments générés de plusieurs fonctions et styles, recopiés dans le monde affiché ; le joueur se tient à l'intérieur, regard vers le fond",
        "pourquoi": "SPEC-INTERIEUR-001 : aucun bâtiment généré n'est creux — le mobilier de sa fonction doit se mailler, s'éclairer et se voir de l'intérieur, pas seulement exister dans l.blocs",
        "attendu": "chaque intérieur compte plusieurs meubles de sa fonction (lit et table de la maison, foin, tonneau et étagère de la grange, bibliothèques du point info, chaises et cheminée de l'auberge, enclume de la forge, étagères de la boutique) ; une capture par intérieur",
        "delai": 240
  }, async function (g) {
    var s = await reset(g);
    var o = await sceneDegagee(g, s, 2);
    var MEUBLES = [B.LIT, B.TABLE, B.CHAISE, B.ARMOIRE, B.ETAGERE, B.BIBLIOTHEQUE, B.TAPIS, B.LAMPE, B.VASE, B.PRESENTOIR, B.SOCLE, B.FOYER, B.TONNEAU, B.HAY, B.ENCLUME, B.CHEST];
    var cas = [['maison-colombages', 'maison', 'plaines', null, [B.LIT, B.TABLE]], ['maison-isba', 'maison', 'taiga', null, [B.LIT, B.FOYER]],
               ['grange', 'ferme', 'plaines', 'grange', [B.HAY, B.TONNEAU, B.ETAGERE]], ['point-info', 'point_info', 'foret', null, [B.BIBLIOTHEQUE]],
               ['auberge', 'salon', 'plaines', null, [B.CHAISE, B.LIT]], ['forge', 'artisan', 'montagnes', null, [B.ENCLUME]],
               ['boutique', 'magasin', 'savane', null, [B.ETAGERE]]];
    var ox = o.x - 6, oz = o.z - 6;
    for (var c = 0; c < cas.length; c++) {
      var nom = cas[c][0];
      var l = batimentDePlan(g, cas[c][1], cas[c][2], false, cas[c][3], ox, oz, cas[c][1] === 'ferme' ? 10 : 12);
      A.ok(l, nom + ' : un bâtiment généré');
      var dy = o.y - 65;
      poserSurDalle(g, l, o.y);
      var b = l.batiments[0], zone = b.grange || b, vus = {}, n = 0;
      for (var x = zone.x0 + 1; x < zone.x1; x++) for (var z = zone.z0 + 1; z < zone.z1; z++) for (var y = b.y0 + dy; y < b.y0 + dy + 2; y++) {
        var id = g.world.getBlock(x, y, z);
        if (MEUBLES.indexOf(id) >= 0) { n++; vus[id] = 1; }
      }
      A.ok(n >= 3, nom + ' : meublé (' + n + ' meubles)');
      cas[c][4].forEach(function (id) { A.ok(vus[id], nom + ' : ' + C.nameOf(id)); });
      // à l'intérieur, près de la porte, regard vers le fond (la façade est en v = 0, côté -z)
      // tête sous le plafond, juste derrière la porte, regard plongeant vers le fond
      var px = b.dedans ? b.dedans.x : b.porte.x + 0.5, pz = b.dedans ? b.dedans.z - 1.4 : b.porte.z + 0.9;
      s.flying = true; s.pos.x = px; s.pos.y = b.y0 + dy + 0.75; s.pos.z = pz; s.vel.x = s.vel.y = s.vel.z = 0;
      s.yaw = Math.PI; s.pitch = -0.62;
      await frames(24);
      capture('interieur-' + nom);
    }
    s.flying = false; s.yaw = 0; s.pitch = 0;
  });

  /* Le panneau d'un livre est du DOM, hors du canvas : il est rasterisé (SVG
     foreignObject, styles calculés recopiés en ligne) et posé sur l'image du
     jeu, pour que la capture montre ce que voit le joueur. */
  // les hauteurs (et largeurs, sauf celle du panneau) restent libres : le texte
  // rasterisé reflue sans être tronqué si la police de repli diffère un peu
  var LIBRES = /^(height|min-height|max-height|block-size|min-block-size|max-block-size|overflow|overflow-x|overflow-y)$/;
  function copierStyles(src, dst, racine) {
    var cs = getComputedStyle(src), t = '';
    for (var i = 0; i < cs.length; i++) {
      if (LIBRES.test(cs[i]) || (!racine && /^(width|inline-size)$/.test(cs[i]))) continue;
      t += cs[i] + ':' + cs.getPropertyValue(cs[i]) + ';';
    }
    dst.setAttribute('style', t);
    for (var k = 0; k < src.children.length; k++) copierStyles(src.children[k], dst.children[k], false);
  }
  async function captureAvecPanneau(g, libelle, el) {
    if (!enCours) return;
    try {
      rendreTout(g);
      var src = g.render.renderer.domElement, rc = src.getBoundingClientRect();
      var echelle = Math.min(1, 480 / src.width);
      var c = document.createElement('canvas');
      c.width = Math.round(src.width * echelle); c.height = Math.round(src.height * echelle);
      var ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0, c.width, c.height);
      var r = el.getBoundingClientRect(), clone = el.cloneNode(true);
      copierStyles(el, clone, true);
      clone.style.position = 'static'; clone.style.transform = 'none'; clone.style.margin = '0';
      var html = new XMLSerializer().serializeToString(clone);
      var hSvg = Math.ceil(r.height * 1.6);   // marge si le texte reflue un peu plus bas
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.ceil(r.width) + '" height="' + hSvg + '">' +
                '<foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">' + html + '</div></foreignObject></svg>';
      var img = new Image();
      await new Promise(function (ok2, ko) { img.onload = ok2; img.onerror = ko; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
      var kx = c.width / rc.width, ky = c.height / rc.height;
      ctx.drawImage(img, (r.left - rc.left) * kx, (r.top - rc.top) * ky, r.width * kx, hSvg * ky);
      enCours.captures.push({ libelle: libelle, type: 'image/jpeg', base64: c.toDataURL('image/jpeg', 0.8), t_ms: ahora() - enCours.t0 });
    } catch (e) { capture(libelle); }
  }

  e2e('SPEC-INTERIEUR-003 : lire un livre de bibliothèque, puis écrire et signer son propre livre', {
        "teste": "l'écran de lecture d'un livre du monde (carnet d'explorateur qui situe un donjon), feuilleté page à page, puis l'écran d'écriture d'un livre vierge : titre, page, signature",
        "pourquoi": "SPEC-INTERIEUR-003 : les livres des bibliothèques se lisent et le joueur écrit et signe les siens ; l'écriture passe par l'opération « ecrire » (MC.Conteneurs, la même que le serveur applique à LIVRE_ECRIRE)",
        "attendu": "le livre du monde s'affiche en lecture seule avec son titre, ses pages et son auteur ; le livre écrit porte titre et page ; signé, il passe en lecture seule et la pile tenue garde son contenu signé"
  }, async function (g) {
    var s = await reset(g);
    var Lv = MC.Livres;
    var monde = Lv.livreIndices(g.world.seed, { id: 'village:0,0', nom: 'Valombre', x: 0, z: 0 },
                                [{ nom: 'Crypte', x: 320, z: -240, gardien: 'Roi squelette' }, { nom: 'Mine abandonnée', x: -90, z: 60 }]);
    s.inv.load([]); s.inv.setAt(0, { id: I.LIVRE, n: 1, data: monde }); s.selected = 0;
    g.ouvrirLivreEnMain(); await frames(3);
    var el = document.querySelector('.livre-ecran');
    A.ok(el && el.style.display !== 'none', 'l\'écran du livre est ouvert');
    A.ok(el.textContent.indexOf('Carnet d\'explorateur') >= 0 && !el.querySelector('textarea'), 'lecture seule, titre affiché');
    A.ok(el.textContent.indexOf(monde.auteur) >= 0, 'l\'auteur est affiché');
    await captureAvecPanneau(g, 'ecran-lecture', el);
    el.querySelector('.livre-suiv').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await frames(2);
    el = document.querySelector('.livre-ecran');
    A.ok(el.textContent.indexOf('Crypte') >= 0 && el.textContent.indexOf('au nord-est') >= 0, 'page 2 : la crypte, au nord-est');
    await captureAvecPanneau(g, 'ecran-lecture-page-2', el);
    key('Escape'); await frames(2);
    A.equal(document.querySelector('.livre-ecran').style.display, 'none', 'Échap referme le livre');

    // écrire et signer un livre vierge
    g.input.setState('playing'); fakeLock(g, true);
    s.inv.setAt(1, { id: I.LIVRE, n: 1 }); s.selected = 1;
    g.ouvrirLivreEnMain(); await frames(3);
    el = document.querySelector('.livre-ecran');
    var titre = el.querySelector('.livre-titre'), page = el.querySelector('.livre-page');
    A.ok(titre && page, 'mode écriture : un titre et une page à remplir');
    titre.value = 'Journal de bord'; titre.dispatchEvent(new Event('input', { bubbles: true }));
    page.value = 'Premier jour.\nUn village au bord du lac.'; page.dispatchEvent(new Event('input', { bubbles: true }));
    await frames(2);
    await captureAvecPanneau(g, 'ecran-ecriture', el);
    el.querySelector('.livre-signer').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await frames(2);
    el = document.querySelector('.livre-ecran');
    A.ok(!el.querySelector('textarea') && el.textContent.indexOf('Journal de bord') >= 0, 'signé : lecture seule');
    await captureAvecPanneau(g, 'livre-signe', el);
    key('Escape'); await frames(2);
    var d = s.inv.stackAt(1).data;
    A.ok(d && d.signe && d.titre === 'Journal de bord' && d.pages[0] === 'Premier jour.\nUn village au bord du lac.', 'la pile tenue garde le livre écrit et signé');
    A.ok(d.auteur && d.auteur.length > 0, 'signé d\'un nom (' + d.auteur + ')');
    s.inv.load([]); s.selected = 0;
  });

  /* SPEC-OBJET-001 : un avatar de joueur DISTANT (même chemin que le réseau :
     une entrée de net.distants, son armure dans `equip` — net.js la remplit
     d'EQUIP_VU et d'ETAT.eq) posé devant la caméra, vu de face et de dos. */
  e2e('SPEC-OBJET-001 : l\'armure complète de chaque matière se voit sur l\'avatar d\'un autre joueur, de face et de dos', {
        "teste": "le rendu de l'avatar d'un joueur distant portant casque, plastron, jambières et bottes de tissu, cuir, mailles, bronze, fer, or puis diamant : boîtes d'armure accrochées à la tête, au buste, aux bras et aux jambes, teinte et texture de la matière ; vu de face et de dos",
        "pourquoi": "SPEC-OBJET-001 : l'armure doit se voir sur l'avatar — avant ce correctif, jambières et bottes ne s'affichaient jamais et l'équipement des autres joueurs n'arrivait pas au rendu",
        "attendu": "neuf boîtes d'armure (calotte et nuque, plastron et deux épaulières, deux jambières, deux bottes) à la couleur de la matière, qui changent l'image rendue ; captures de face et de dos pour chaque matière",
        "delai": 300
  }, async function (g) {
    var s = await reset(g);
    var o = await sceneDegagee(g, s, 4);
    var NP = MC.NetProtocol, ID = 990001;
    var pos = { x: o.x + 0.5, y: o.y, z: o.z + 0.5 - 3 };
    var d = { id: ID, nom: 'Mannequin', pos: { x: pos.x, y: pos.y, z: pos.z }, cible: { x: pos.x, y: pos.y, z: pos.z }, yaw: 0,
              equip: NP.armureDepuisVisible(null), eqSig: 'e2e' };
    g.net.distants.set(ID, d);
    try {
      s.yaw = 0; s.pitch = -0.2;
      await frames(4);
      var m = g.render.maillagesDistants.get(ID);
      A.ok(m, 'l\'avatar du joueur distant est dans la scène');
      A.equal((m.userData.armure || []).length, 0, 'sans armure : aucune pièce');
      // l'image de l'avatar sans armure, pour comparer
      function signatureImage() {
        g.render.render();
        var src = g.render.renderer.domElement, c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        var ctx = c.getContext('2d');
        ctx.drawImage(src, src.width * 0.35, src.height * 0.2, src.width * 0.3, src.height * 0.6, 0, 0, 64, 64);
        return ctx.getImageData(0, 0, 64, 64).data;
      }
      function ecart(a, b) { var n = 0; for (var i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 40) n++; return n; }
      var nu = signatureImage();
      capture('avatar-sans-armure');
      // M1 : corps ET armure projettent et reçoivent l'ombre, comme les mobs (sinon l'armure seule flottait au sol)
      function fusionsDe(mm) { return mm.userData.fusions || []; }
      A.equal(fusionsDe(m).length, 6, 'six parties du corps fusionnées (tête, buste, bras, jambes)');
      fusionsDe(m).forEach(function (f) { A.ok(f.castShadow && f.receiveShadow, f.userData.fusion + ' : ombre portée et reçue'); });
      // F5 : l'atlas d'armure — une tuile par matière, dont les pixels sont exactement le motif de cette matière
      var atlas = g.render.atlasArmure(), N = atlas.userData.tuile, ctxA = atlas.image.getContext('2d');
      function tuileDe(mt) { return atlas.userData.matieres.indexOf(mt) + 1; }
      ['tissu', 'cuir', 'mailles', 'bronze', 'fer', 'or', 'diamant'].forEach(function (mt) {
        var motif = MC.Apparence.motifArmure(mt), px = ctxA.getImageData(tuileDe(mt) * N, 0, N, N).data, diff = 0;
        A.ok(tuileDe(mt) > 0, mt + ' : a sa tuile dans l\'atlas');
        for (var q = 0; q < motif.pixels.length; q++) if (px[q * 4] !== motif.pixels[q]) diff++;
        A.equal(diff, 0, mt + ' : sa tuile peint exactement son motif');
      });
      var MATS = ['TISSU', 'CUIR', 'MAILLES', 'BRONZE', 'FER', 'OR', 'DIAMANT'];
      for (var k = 0; k < MATS.length; k++) {
        var mat = MATS[k];
        d.equip = NP.armureDepuisVisible([I[mat + '_CASQUE'], I[mat + '_PLASTRON'], I[mat + '_JAMBIERES'], I[mat + '_BOTTES']]);
        d.yaw = Math.PI;                      // face à la caméra
        await frames(3);
        var pieces = m.userData.armure || [];
        A.equal(pieces.length, 9, mat + ' : neuf boîtes d\'armure');
        ['casque', 'plastron', 'jambieres', 'bottes'].forEach(function (p) {
          var siennes = pieces.filter(function (b) { return b.piece === p; });
          A.ok(siennes.length > 0, mat + ' : ' + p + ' visible');
          var attendu = C.def(I[mat + '_' + p.toUpperCase()]).couleurArmure;
          siennes.forEach(function (b) {
            A.equal(b.couleur, attendu, mat + ' ' + p + ' : teinte de la matière');
            // F5 : la tuile de texture est CELLE de sa matière
            A.equal(b.matiere, mat.toLowerCase(), mat + ' ' + p + ' : motif de sa matière');
            A.equal(b.tuile, tuileDe(mat.toLowerCase()), mat + ' ' + p + ' : texturée par la tuile de sa matière');
            // dessinée par la partie fusionnée du membre qui la porte, visible, texturée par l'atlas
            var f = b.porteur.children.filter(function (o) { return o.userData.fusion; })[0];
            A.ok(f && f.visible && f.material.visible && f.material.map === atlas, mat + ' ' + p + ' : accrochée au corps, texturée');
          });
        });
        A.equal(pieces.filter(function (b) { return b.piece === 'jambieres' || b.piece === 'bottes'; })
                  .filter(function (b) { return b.porteur === m.userData.membres.jambeG || b.porteur === m.userData.membres.jambeD; }).length,
                4, mat + ' : jambières et bottes aux deux jambes');
        A.gt(ecart(signatureImage(), nu), 40, mat + ' : l\'armure change l\'image rendue (de face)');
        capture('face-' + mat.toLowerCase());
        d.yaw = 0;                            // de dos
        await frames(3);
        A.gt(ecart(signatureImage(), nu), 40, mat + ' : l\'armure change l\'image rendue (de dos)');
        capture('dos-' + mat.toLowerCase());
      }
      // retirer l'armure : l'avatar se déshabille
      d.equip = NP.armureDepuisVisible(null);
      await frames(3);
      A.equal(m.userData.armure.length, 0, 'armure retirée : plus aucune pièce');
    } finally {
      g.net.distants.delete(ID);
      s.pitch = 0;
      await frames(2);
    }
  });

  e2e('SPEC-OBJET-001 : en écran partagé, chaque joueur voit l\'armure des autres joueurs locaux, jamais son propre corps', {
        "teste": "à deux joueurs locaux, l'avatar du joueur 2 (armure de fer complète) est dans la scène, visible dans la vue du joueur 1 et caché dans la sienne ; il se rhabille quand son équipement change",
        "pourquoi": "SPEC-OBJET-001 : l'armure se voit sur l'avatar du joueur local aussi — en écran partagé, les joueurs locaux n'avaient pas d'avatar du tout",
        "attendu": "un avatar par joueur local, chacun caché dans sa propre vue, neuf pièces d'armure de fer puis d'or après changement ; retour au solo : plus aucun avatar local"
  }, async function (g) {
    var s = await reset(g);
    var o = await sceneDegagee(g, s, 4);
    fausseManette([{ axes: [0, 0, 0, 0] }]);
    g.composerEquipe(2, MC.Modes.regles('creatif', 'facile'));
    try {
      await frames(4);
      var s1 = g.equipe[0].player.state, s2 = g.equipe[1].player.state;
      [s1, s2].forEach(function (st) { st.flying = true; st.vel.x = st.vel.y = st.vel.z = 0; });
      s1.pos.x = o.x + 0.5; s1.pos.y = o.y; s1.pos.z = o.z + 0.5;
      s2.pos.x = o.x + 0.5; s2.pos.y = o.y; s2.pos.z = o.z + 0.5 - 3;
      s1.yaw = 0; s1.pitch = -0.2; s2.yaw = Math.PI; s2.pitch = 0;
      ['casque', 'plastron', 'jambieres', 'bottes'].forEach(function (p) { s2.equip[p] = { id: I['FER_' + p.toUpperCase()], n: 1 }; });
      await frames(6);
      var av = g.render.avatarsLocaux;
      A.equal(av.length, 2, 'un avatar par joueur local');
      A.equal(av[1].userData.armure.length, 9, 'le joueur 2 porte ses neuf pièces de fer');
      A.equal(av[0].userData.armure.length, 0, 'le joueur 1 ne porte rien');
      A.close(av[1].position.z, s2.pos.z, 0.01, 'l\'avatar suit le joueur 2');
      // corps et armure : même règle d'ombre (reçue, jamais projetée par un avatar local, voir render.js)
      av[1].userData.fusions.forEach(function (f) { A.ok(!f.castShadow && f.receiveShadow, f.userData.fusion + ' : ombre reçue, non projetée'); });
      // M2 : pour CHAQUE vue rendue par renderViews, le corps de son joueur est
      // caché et celui de l'autre visible (relevé pendant le rendu de la vue)
      var trace = g.render.tracerAvatarsLocaux(true);
      try { g.render.renderViews(g.vues); } finally { g.render.tracerAvatarsLocaux(false); }
      A.equal(trace.length, 2, 'les deux vues ont été rendues');
      for (var v = 0; v < 2; v++) {
        for (var a = 0; a < 2; a++) {
          A.equal(trace[v][a], a !== v, 'vue ' + (v + 1) + ' : le corps du joueur ' + (a + 1) + (a === v ? ' (le sien) est caché' : ' est visible'));
        }
      }
      capture('ecran-partage-joueur2-en-fer');
      // le joueur 2 se tourne : de dos dans la vue du joueur 1
      s2.yaw = 0;
      await frames(3);
      capture('ecran-partage-joueur2-de-dos');
      s2.yaw = Math.PI;
      ['casque', 'plastron', 'jambieres', 'bottes'].forEach(function (p) { s2.equip[p] = { id: I['OR_' + p.toUpperCase()], n: 1 }; });
      await frames(3);
      A.equal(av[1].userData.armure.filter(function (b) { return b.couleur === C.def(I.OR_PLASTRON).couleurArmure; }).length, 9,
              'changé pour de l\'or : l\'avatar se rhabille');
      capture('ecran-partage-joueur2-en-or');
      // F6 : un joueur local mort n'est plus debout dans les autres vues
      s2.dead = true;
      await frames(2);
      trace = g.render.tracerAvatarsLocaux(true);
      try { g.render.renderViews(g.vues); } finally { g.render.tracerAvatarsLocaux(false); }
      A.equal(trace[0][1], false, 'joueur 2 mort : son avatar n\'apparaît plus dans la vue du joueur 1');
      s2.dead = false; s2.hp = 20;
      await frames(2);
      trace = g.render.tracerAvatarsLocaux(true);
      try { g.render.renderViews(g.vues); } finally { g.render.tracerAvatarsLocaux(false); }
      A.equal(trace[0][1], true, 'revenu à la vie : de nouveau visible');
    } finally {
      soloRetabli(g); await frames(3);
    }
    A.equal(g.render.avatarsLocaux.length, 0, 'seul : aucun avatar local');
  });

  e2e('SPEC-OBJET-001 : à quatre joueurs locaux en armure complète, face à face, la cadence reste jouable', {
        "teste": "la cadence d'images en écran partagé à quatre, chaque joueur en armure complète (quatre matières différentes) et voyant les trois autres",
        "pourquoi": "G9 : les avatars des joueurs locaux et leurs neuf pièces d'armure ne doivent pas faire chuter la cadence de l'écran partagé",
        "attendu": "trois avatars habillés visibles par vue ; au moins 55 images/s (G9) et moins de 30 % de perte de cadence par rapport à la même scène sans les avatars"
  }, async function (g) {
    var s = await reset(g);
    var o = await sceneDegagee(g, s, 4);
    fausseManette([{ axes: [0, 0, 0, 0] }, { axes: [0, 0, 0, 0] }, { axes: [0, 0, 0, 0] }]);
    g.composerEquipe(4, MC.Modes.regles('creatif', 'facile'));
    try {
      await frames(4);
      var MATS = ['CUIR', 'MAILLES', 'OR', 'DIAMANT'];
      // en carré, chacun tourné vers le centre
      [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]].forEach(function (p, i) {
        var st = g.equipe[i].player.state;
        st.flying = true; st.vel.x = st.vel.y = st.vel.z = 0;
        st.pos.x = o.x + 0.5 + p[0]; st.pos.y = o.y; st.pos.z = o.z + 0.5 + p[1];
        st.yaw = Math.atan2(p[0], p[1]); st.pitch = -0.2;
        ['casque', 'plastron', 'jambieres', 'bottes'].forEach(function (q) { st.equip[q] = { id: I[MATS[i] + '_' + q.toUpperCase()], n: 1 }; });
      });
      await frames(10);
      var av = g.render.avatarsLocaux;
      A.equal(av.length, 4, 'quatre avatars locaux');
      av.forEach(function (m, i) { A.equal(m.userData.armure.length, 9, 'joueur ' + (i + 1) + ' : armure complète'); });
      capture('quatre-joueurs-en-armure');
      /* Cadence médiane (robuste aux à-coups du banc) sur 90 images, mesurée
         en alternance avec les avatars (trois en armure dans chaque vue) et
         sans eux (même scène, mêmes regards) ; on garde la meilleure de
         quatre mesures de chaque, pour absorber un poste partagé. */
      async function cadenceMediane() {
        var ms = [], t = performance.now();
        for (var f = 0; f < 90; f++) { await frames(1); var n = performance.now(); ms.push(n - t); t = n; }
        ms.sort(function (x, y) { return x - y; });
        return 1000 / ms[45];
      }
      // même scène, mêmes regards : avec les avatars, puis sans (retirés du rendu)
      var avec = 0, sans = 0;
      try {
        for (var r = 0; r < 4; r++) {
          g.render.masquerAvatarsLocaux(true); await frames(5); sans = Math.max(sans, await cadenceMediane());
          g.render.masquerAvatarsLocaux(false); await frames(5); avec = Math.max(avec, await cadenceMediane());
        }
      } finally { g.render.masquerAvatarsLocaux(false); }
      A.gt(avec, 55, 'G9 : au moins 55 images/s en quadrant, trois avatars en armure par vue (' + avec.toFixed(0) + ' ; sans avatars ' + sans.toFixed(0) + ')');
      A.gt(avec, sans * 0.7, 'moins de 30 % de perte de cadence avec les avatars (' + avec.toFixed(0) + ') que sans (' + sans.toFixed(0) + ')');
    } finally {
      soloRetabli(g); await frames(3);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Miner, poser, ramasser — dans la boucle réelle
  // ══════════════════════════════════════════════════════════════════════════
  e2e('maintenir le clic gauche mine le bloc visé', {
        "teste": "que maintenir le clic gauche sur un bloc visé finit par le casser",
        "pourquoi": "c'est l'action de minage de base du jeu",
        "attendu": "après un maintien suffisant du clic, le bloc visé devient de l'air (id 0)"
  }, async function (g) {
    var s = await reset(g);
    s.inv.add(I.IRON_PICKAXE, 1); s.selected = 0;
    s.pitch = -Math.PI / 2 + 0.05;
    await frames(2);
    var t = g.player.aim();
    A.ok(t, 'un bloc est visé');
    var avant = g.world.getBlock(t.x, t.y, t.z);
    mouseDown(g, 0);
    for (var i = 0; i < 240 && g.world.getBlock(t.x, t.y, t.z) === avant; i++) await frames(1);
    mouseUp(0);
    A.equal(g.world.getBlock(t.x, t.y, t.z), 0, 'le bloc a été cassé');
  });

  e2e('le bloc miné tombe et le client ne le ramasse pas', {
        "teste": "qu'un bloc cassé fait apparaître une entité au sol et que le client ne la ramasse plus lui-même : le ramassage est fait par le serveur (DONNE, INV_MAJ — SPEC-ARCHI-027, tests/integration-archi-vie.js)",
        "pourquoi": "le ramassage côté client, hors journal d'inventaire, dupliquerait des objets",
        "attendu": "l'inventaire local n'augmente pas après le minage"
  }, async function (g) {
    var s = await reset(g);
    s.inv.add(I.IRON_SHOVEL, 1); s.selected = 0;
    s.pitch = -Math.PI / 2 + 0.05;
    await frames(2);
    var t = g.player.aim();
    var avant = g.world.getBlock(t.x, t.y, t.z);
    mouseDown(g, 0);
    for (var i = 0; i < 300 && g.world.getBlock(t.x, t.y, t.z) === avant; i++) await frames(1);
    mouseUp(0);
    var total0 = s.inv.slots.reduce(function (a, x) { return a + (x ? x.n : 0); }, 0);
    for (var j = 0; j < 200; j++) await frames(1);
    var total1 = s.inv.slots.reduce(function (a, x) { return a + (x ? x.n : 0); }, 0);
    A.equal(total1, total0, 'le client ne ramasse rien lui-même (' + total0 + ' -> ' + total1 + ')');
  });

  e2e('la barre de progression du minage apparaît puis disparaît', {
        "teste": "l'anneau de progression de minage (.mining-ring) s'affiche pendant le maintien du clic et disparaît au relâchement",
        "pourquoi": "le joueur a besoin d'un retour visuel de la progression de minage",
        "attendu": "display block pendant le minage, display none après relâchement du clic"
  }, async function (g) {
    var s = await reset(g);
    s.pitch = -Math.PI / 2 + 0.05;
    await frames(2);
    var hudM = g.ui.hudDe(0);
    mouseDown(g, 0);
    await frames(8);
    A.equal(getComputedStyle(hudM.querySelector('.mining-ring')).display, 'block', 'barre visible');
    mouseUp(0);
    await frames(4);
    A.equal(getComputedStyle(hudM.querySelector('.mining-ring')).display, 'none', 'barre masquée');
  });

  e2e('le clic droit pose un bloc du bon type', {
        "teste": "que le clic droit pose bien le type de bloc sélectionné, sur la face visée, en consommant une unité",
        "pourquoi": "c'est l'action de construction de base du jeu",
        "attendu": "useOn renvoie 'place', le bloc posé est du bon type, l'inventaire perd une unité"
  }, async function (g) {
    var s = await reset(g);
    s.inv.add(B.BRICK, 10); s.selected = 0;
    // on choisit une colonne bien définie, à l'écart du joueur, et on s'assure
    // que la face visée est libre — sinon le refus de pose est légitime
    var bx = Math.floor(s.pos.x) + 3, bz = Math.floor(s.pos.z);
    var by = g.world.groundAt(bx, bz, true);
    g.world.setBlock(bx, by + 1, bz, 0);
    var n0 = s.inv.count(B.BRICK);
    var r = g.player.useOn({ x: bx, y: by, z: bz, block: g.world.getBlock(bx, by, bz),
                             nx: 0, ny: 1, nz: 0 });
    A.equal(r, 'place', 'pose acceptée');
    A.equal(g.world.getBlock(bx, by + 1, bz), B.BRICK, 'brique posée sur la face visée');
    A.equal(s.inv.count(B.BRICK), n0 - 1, 'une brique consommée');
  });

  e2e('poser dans son propre corps est refusé', {
        "teste": "que poser un bloc à l'emplacement occupé par le joueur lui-même est refusé",
        "pourquoi": "sans ce garde-fou le joueur pourrait s'enfermer ou se bloquer dans un bloc",
        "attendu": "useOn renvoie null et rien n'est consommé dans l'inventaire"
  }, async function (g) {
    var s = await reset(g);
    s.inv.add(B.BRICK, 5); s.selected = 0;
    var bx = Math.floor(s.pos.x), bz = Math.floor(s.pos.z);
    var by = Math.floor(s.pos.y) - 1;
    var n0 = s.inv.count(B.BRICK);
    var r = g.player.useOn({ x: bx, y: by, z: bz, block: g.world.getBlock(bx, by, bz),
                             nx: 0, ny: 1, nz: 0 });
    A.equal(r, null, 'refusé : le bloc irait dans les jambes');
    A.equal(s.inv.count(B.BRICK), n0, 'rien consommé');
  });

  e2e('le bloc visé est mis en surbrillance', {
        "teste": "que le contour de surbrillance (LineSegments) du bloc visé s'affiche quand on vise un bloc et s'éteint quand on ne vise rien",
        "pourquoi": "le joueur doit voir clairement quel bloc sera affecté par ses actions",
        "attendu": "visible=true en visant le sol, visible=false en regardant le ciel"
  }, async function (g) {
    var s = await reset(g);
    s.pitch = -Math.PI / 2 + 0.05;
    await frames(3);
    var hl = g.render.scene.children.find(function (o) { return o.type === 'LineSegments'; });
    A.ok(hl.visible, 'surbrillance active en visant le sol');
    s.pitch = 1.4;                            // on regarde le ciel
    await frames(3);
    A.notOk(hl.visible, 'plus rien de visé : surbrillance éteinte');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Combat et entités
  // ══════════════════════════════════════════════════════════════════════════
  e2e('un mob apparaît et reçoit un maillage', {
        "teste": "qu'une entité apparue (spawn) reçoit un objet 3D de rendu, et que le retirer libère cet objet",
        "pourquoi": "toute entité vivante doit être visible, et sa suppression ne doit pas laisser de maillage fantôme",
        "attendu": "un maillage existe après spawn, il est absent après entities.remove()"
  }, async function (g) {
    var s = await reset(g);
    var z = g.entities.spawn('zombie', s.pos.x + 3, s.pos.y, s.pos.z);
    await frames(3);
    A.ok(g.render.entityMeshes.get(z.eid), 'le zombie a un objet 3D');
    g.entities.remove(z);
    await frames(3);
    A.notOk(g.render.entityMeshes.get(z.eid), 'objet 3D retiré avec l\'entité');
  });

  e2e('frapper un mob visé envoie ATTAQUE au serveur', {
        "teste": "qu'un clic gauche sur le reflet d'un mob (net.mobsDistants) envoie un message ATTAQUE au serveur avec l'identifiant de la créature, sans la blesser localement (SPEC-ARCHI-027)",
        "pourquoi": "le combat n'a plus qu'un chemin : le serveur valide portée, cadence et dégâts ; le client ne blesse plus rien (les dégâts réels sont testés dans tests/integration-archi-vie.js)",
        "attendu": "net.attaquer est appelé avec l'eid du mouton visé"
  }, async function (g) {
    var s = await reset(g);
    s.yaw = 0; s.pitch = 0;
    var dist = 2.5;
    var reflet = { eid: 987654, type: 'sheep', pos: { x: s.pos.x, y: s.pos.y, z: s.pos.z - dist } };
    var sp = MC.EntitySpecs.sheep;
    // Un mouton fait 1,2 m : à l'horizontale on lui passe AU-DESSUS. Il faut
    // viser sa boîte, donc incliner le regard vers son milieu.
    var dy = (reflet.pos.y + sp.h / 2) - (s.pos.y + g.player.EYE);
    s.pitch = Math.atan2(dy, dist);
    g.net.mobsDistants.set(reflet.eid, reflet);
    var appels = [], vrai = g.net.attaquer;
    g.net.attaquer = function (eid, degats, j) { appels.push({ eid: eid, degats: degats, j: j }); return true; };
    try {
      await frames(2);
      s.attackCd = 0;
      mouseDown(g, 0);
      mouseUp(0);
      await frames(2);
    } finally { g.net.attaquer = vrai; g.net.mobsDistants.delete(reflet.eid); }
    A.equal(appels.length, 1, 'un seul message ATTAQUE');
    A.equal(appels[0] && appels[0].eid, reflet.eid, 'visant le mouton');
  });

  e2e('un zombie local ne blesse plus le joueur : les créatures sont au serveur', {
        "teste": "qu'une créature présente dans la liste locale du client, au contact du joueur en zone PvE, ne lui inflige plus aucun dégât (le client n'appelle plus entities.update, SPEC-ARCHI-027)",
        "pourquoi": "les dégâts des créatures sont calculés par le serveur (vérifié par tests/integration-archi-vie.js) : un second calcul côté client les compterait deux fois",
        "attendu": "les PV du joueur restent intacts pendant 90 images"
  }, async function (g) {
    var s = await reset(g);
    var r0 = g.world.reglesZoneEn;
    g.world.reglesZoneEn = function () { return MC.Zones.regles('pvp_pve'); };
    try {
      g.entities.spawn('zombie', s.pos.x + 0.6, s.pos.y, s.pos.z);
      var hp0 = s.hp;
      await frames(90);
      A.equal(s.hp, hp0, 'aucun dégât calculé par le client (' + s.hp + ')');
    } finally { g.world.reglesZoneEn = r0; g.entities.list.length = 0; }
  });

  e2e('la mort ouvre l\'écran de réapparition', {
        "teste": "que descendre les PV à zéro fait passer en état dead avec un écran de réapparition, et que cliquer Réapparaître demande la renaissance AU SERVEUR (message RENAITRE) puis reprend la partie",
        "pourquoi": "le cycle mort/réapparition doit être complet et ne pas laisser le joueur bloqué ; le lieu, la vie et la faim de la renaissance sont décidés par le serveur (SPEC-ARCHI-026, tests/integration-archi-vie.js)",
        "attendu": "état dead, RENAITRE envoyé pour le joueur 0, puis état playing et dead=false"
  }, async function (g) {
    var s = await reset(g);
    g.player.hurt(20);
    await frames(4);
    A.equal(g.input.state, 'dead', 'état mort');
    A.ok(document.querySelector('#btn-respawn'), 'bouton Réapparaître');
    var appels = [], vrai = g.net.renaitre;
    g.net.renaitre = function (j) { appels.push(j); return true; };
    try {
      document.querySelector('#btn-respawn').click();
      fakeLock(g, true);
      await frames(4);
    } finally { g.net.renaitre = vrai; }
    A.equal(g.input.state, 'playing', 'partie reprise');
    A.equal(appels.length, 1, 'une demande de renaissance');
    A.equal(appels[0], 0, 'pour le joueur 0');
    A.notOk(s.dead, 'vivant');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Agriculture, fourneau, cycle
  // ══════════════════════════════════════════════════════════════════════════
  e2e('labourer puis planter fonctionne en jeu', {
        "teste": "l'usage d'une houe sur de l'herbe (labourer) puis de graines sur la terre labourée (planter)",
        "pourquoi": "c'est le point de départ du cycle d'agriculture",
        "attendu": "labourer transforme GRASS en FARMLAND, planter pose WHEAT0 au-dessus et la culture est suivie par world.crops"
  }, async function (g) {
    var s = await reset(g);
    var bx = Math.floor(s.pos.x) + 2, bz = Math.floor(s.pos.z);
    var by = g.world.groundAt(bx, bz, true);
    g.world.setBlock(bx, by, bz, B.GRASS);
    s.inv.add(I.WOOD_HOE, 1); s.selected = 0;
    A.equal(g.player.useOn({ x: bx, y: by, z: bz, block: B.GRASS, nx: 0, ny: 1, nz: 0 }), 'till');
    A.equal(g.world.getBlock(bx, by, bz), B.FARMLAND, 'labouré');

    s.inv.add(I.SEEDS, 1); s.selected = 1;
    A.equal(g.player.useOn({ x: bx, y: by, z: bz, block: B.FARMLAND, nx: 0, ny: 1, nz: 0 }), 'plant');
    A.equal(g.world.getBlock(bx, by + 1, bz), B.WHEAT0, 'planté');
    await frames(3);
    A.gt(g.world.crops.size, 0, 'la culture est suivie');
  });

  e2e('le blé pousse avec le temps et se récolte', {
        "teste": "que le blé progresse à travers ses stades de croissance avec le temps du monde, puis peut être récolté pour donner du blé en item",
        "pourquoi": "la croissance temporisée des cultures est le cœur de la mécanique d'agriculture",
        "attendu": "après plusieurs tick du monde, le blé atteint WHEAT3 (mûr) et sa récolte produit un drop de type WHEAT"
  }, async function (g) {
    var s = await reset(g);
    var bx = Math.floor(s.pos.x) + 3, bz = Math.floor(s.pos.z);
    var by = g.world.groundAt(bx, bz, true);
    g.world.setBlock(bx, by, bz, B.FARMLAND);
    g.world.setBlock(bx, by + 1, bz, B.WHEAT0);
    for (var i = 0; i < 12; i++) g.world.tick(20, 14, function () { return 0; });
    A.equal(g.world.getBlock(bx, by + 1, bz), B.WHEAT3, 'blé mûr');
    var res = g.player.mineTick(0.1, { x: bx, y: by + 1, z: bz, block: B.WHEAT3 },
                                function () { return 0; });
    A.ok(res, 'récolté');
    A.ok(res.drops.some(function (d) { return d.id === I.WHEAT; }), 'du blé obtenu');
  });

  e2e('le fourneau cuit et l\'interface se met à jour', {
        "teste": "l'interface d'un fourneau (ouverture, affichage du minerai et du combustible) et la logique de cuisson sur le contenu qu'elle affiche ; la cuisson d'un fourneau posé est celle du serveur (SPEC-ARCHI-030, tests/integration-archi-inv.js)",
        "pourquoi": "vérifie que l'interface s'ouvre dans la boucle réelle et que le contenu affiché cuit avec MC.Inventory.tickFurnace ; le client ne simule plus de fourneau lui-même",
        "attendu": "useOn renvoie 'open:furnace', l'interface est ouverte, et après cuisson du contenu affiché, output contient un lingot de fer"
  }, async function (g) {
    var s = await reset(g);
    var bx = Math.floor(s.pos.x) + 2, bz = Math.floor(s.pos.z) + 2;
    var by = g.world.groundAt(bx, bz, true) + 1;
    g.world.setBlock(bx, by, bz, B.FURNACE);
    var r = g.player.useOn({ x: bx, y: by, z: bz, block: B.FURNACE, nx: 0, ny: 1, nz: 0 });
    A.equal(r, 'open:furnace');
    var k = bx + ',' + by + ',' + bz;
    var four = MC.Inventory.newFurnace();
    four.input = { id: B.IRON_ORE, n: 1 };
    four.fuel = { id: I.COAL, n: 1 };
    g.ui.openContainer('furnace', s.inv, four, k);
    g.input.setState('ui');
    await frames(2);
    A.equal(getComputedStyle(document.querySelector('.inv-screen')).display, 'flex', 'interface ouverte');
    // la cuisson d'un fourneau posé est celle du serveur : ici on fait cuire le contenu affiché
    for (var i = 0; i < 600 && !four.output; i++) {
      if (MC.Inventory.tickFurnace(four, 1 / 20)) g.ui.refreshFurnace();
      if (i % 20 === 0) await frames(1);
    }
    A.ok(four.output, 'quelque chose est sorti');
    A.equal(four.output.id, I.IRON_INGOT, 'lingot de fer');
    key('Escape'); fakeLock(g, true); await frames(2);
  });

  e2e('clic droit sur un villageois ouvre le panneau d echange', {
        "teste": "que viser et faire un clic droit sur un villageois ouvre l'interface d'échange avec la liste complète de ses offres",
        "pourquoi": "c'est le point d'entrée du commerce avec les villageois",
        "attendu": "état ui, un élément .trades affiché avec autant de lignes que d'offres dans MC.Inventory.TRADES"
  }, async function (g) {
    var s = await reset(g);
    s.yaw = 0; s.pitch = 0;
    var dist = 2.2;
    var v = g.entities.spawn('villager', s.pos.x, s.pos.y, s.pos.z - dist);
    var dy = (v.pos.y + v.h / 2) - (s.pos.y + g.player.EYE);
    s.pitch = Math.atan2(dy, dist);
    await frames(2);
    mouseDown(g, 2); mouseUp(2);
    await frames(3);
    A.equal(g.input.state, 'ui', 'interface ouverte');
    A.ok(document.querySelector('.trades'), 'liste d offres affichee');
    A.equal(document.querySelectorAll('.trades .trade').length, MC.Inventory.TRADES.length,
      'toutes les offres sont listees');
    key('Escape'); fakeLock(g, true); await frames(2);
    g.entities.remove(v);
  });

  e2e('un echange realisable se conclut au clic', {
        "teste": "qu'une offre d'échange payable (le joueur a le prix demandé) se conclut au clic : le prix est prélevé, la contrepartie reçue",
        "pourquoi": "c'est le mécanisme transactionnel de base du commerce",
        "attendu": "après clic sur l'offre, l'inventaire reçoit la contrepartie et perd le prix"
  }, async function (g) {
    var s = await reset(g);
    var t = MC.Inventory.TRADES[0];
    s.inv.add(t.give[0].id, t.give[0].n);
    g.ui.openContainer('trade', s.inv, null, 1);
    g.input.setState('ui');
    await frames(2);
    var rows = document.querySelectorAll('.trades .trade');
    A.notOk(rows[0].classList.contains('ko'), 'la premiere offre est payable');
    rows[0].dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    await frames(2);
    A.equal(s.inv.count(t.get.id), t.get.n, 'contrepartie recue');
    A.equal(s.inv.count(t.give[0].id), 0, 'prix preleve');
    key('Escape'); fakeLock(g, true); await frames(2);
  });

  e2e('une offre non payable est inerte', {
        "teste": "qu'une offre d'échange marquée indisponible (classe .ko) ne fait rien au clic",
        "pourquoi": "un joueur sans les moyens de payer ne doit pas pouvoir déclencher l'échange",
        "attendu": "la ligne porte bien la classe .ko et l'inventaire est inchangé après clic"
  }, async function (g) {
    var s = await reset(g);
    g.ui.openContainer('trade', s.inv, null, 1);
    g.input.setState('ui');
    await frames(2);
    var rows = document.querySelectorAll('.trades .trade');
    A.ok(rows[0].classList.contains('ko'), 'offre marquee indisponible');
    var avant = s.inv.slots.filter(function (x) { return x; }).length;
    rows[0].dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    await frames(2);
    A.equal(s.inv.slots.filter(function (x) { return x; }).length, avant, 'inventaire inchange');
    key('Escape'); fakeLock(g, true); await frames(2);
  });

  e2e('poser une torche cree une lumiere ponctuelle', {
        "teste": "que poser une torche l'inscrit au registre de lumières du monde et crée une source lumineuse visible à sa position, retirée si la torche est cassée",
        "pourquoi": "l'éclairage dynamique doit suivre fidèlement la présence des torches, sans fuite ni lumière fantôme",
        "attendu": "une entrée dans world.lights et une lumière du torchPool positionnée sur la torche ; les deux disparaissent quand la torche est cassée"
  }, async function (g) {
    var s = await reset(g);
    s.inv.add(B.TORCH, 4); s.selected = 0;
    var bx = Math.floor(s.pos.x) + 2, bz = Math.floor(s.pos.z);
    var by = g.world.groundAt(bx, bz, true);
    g.world.setBlock(bx, by + 1, bz, 0);
    var r = g.player.useOn({ x: bx, y: by, z: bz, block: g.world.getBlock(bx, by, bz),
                             nx: 0, ny: 1, nz: 0 });
    A.equal(r, 'place', 'torche posee');
    A.equal(g.world.getBlock(bx, by + 1, bz), B.TORCH);
    // le registre peut deja contenir les torches d'un donjon voisin : on suit CELLE-CI
    A.ok(g.world.lights.has(g.world.key3(bx, by + 1, bz)), 'inscrite au registre');
    function surLaTorche(L) {
      return L.visible && Math.abs(L.position.x - (bx + 0.5)) < 0.01 &&
             Math.abs(L.position.z - (bz + 0.5)) < 0.01 && Math.abs(L.position.y - (by + 1.55)) < 0.01;
    }
    await frames(4);
    A.equal(g.render.torchPool.filter(surLaTorche).length, 1, 'une lumiere ponctuelle est placee sur elle');
    g.world.setBlock(bx, by + 1, bz, 0);
    await frames(4);
    A.notOk(g.world.lights.has(g.world.key3(bx, by + 1, bz)), 'retiree du registre');
    A.equal(g.render.torchPool.filter(surLaTorche).length, 0,
      'lumiere eteinte quand la torche disparait');
  });

  e2e('le nombre de lumieres reste borne meme avec beaucoup de torches', {
        "teste": "qu'avec un grand nombre de torches posées, le nombre de lumières réellement actives dans le rendu reste borné à MAX_TORCH_LIGHTS",
        "pourquoi": "un nombre illimité de lumières temps réel effondrerait les performances",
        "attendu": "le nombre de lumières visibles dans le torchPool ne dépasse jamais render.MAX_TORCH_LIGHTS, malgré 40 torches posées"
  }, async function (g) {
    var s = await reset(g);
    var bx = Math.floor(s.pos.x), bz = Math.floor(s.pos.z);
    var by = g.world.groundAt(bx, bz, true) + 3;
    for (var i = 0; i < 40; i++) {
      g.world.setBlock(bx + (i % 7) - 3, by, bz + ((i / 7) | 0) - 3, B.STONE);
      g.world.setBlock(bx + (i % 7) - 3, by + 1, bz + ((i / 7) | 0) - 3, B.TORCH);
    }
    A.gt(g.world.lights.size, 20, 'beaucoup de torches posees');
    await frames(4);
    var allumees = g.render.torchPool.filter(function (L) { return L.visible; }).length;
    A.ok(allumees <= g.render.MAX_TORCH_LIGHTS,
      'pool borne a ' + g.render.MAX_TORCH_LIGHTS + ' (actives : ' + allumees + ')');
    // nettoyage
    g.world.lights.forEach(function (t) { g.world.setBlock(t.x, t.y, t.z, 0); });
  });

  e2e('un coffre affiche son contenu dans son interface', {
        "teste": "qu'un coffre demande son interface et y affiche son contenu ; le contenu rendu au sol à la casse est l'affaire du serveur (SPEC-SYNC-012, tests/integration-archi-inv.js), le client ne lâche plus rien lui-même (SPEC-ARCHI-001)",
        "pourquoi": "un coffre ne doit jamais faire perdre les objets qu'il contient : le joueur doit les voir",
        "attendu": "le contenu (42) apparaît dans l'interface du coffre"
  }, async function (g) {
    var s = await reset(g);
    var bx = Math.floor(s.pos.x) + 3, bz = Math.floor(s.pos.z) + 1;
    var by = g.world.groundAt(bx, bz, true) + 1;
    g.world.setBlock(bx, by, bz, B.CHEST);
    var r = g.player.useOn({ x: bx, y: by, z: bz, block: B.CHEST, nx: 0, ny: 1, nz: 0 });
    A.equal(r, 'open:chest', 'le coffre demande son interface');

    var k = bx + ',' + by + ',' + bz;
    g.chests[k] = MC.Inventory.create(27);
    g.chests[k].add(B.COBBLE, 42);
    g.ui.openContainer('chest', s.inv, g.chests[k], k);
    g.input.setState('ui');
    await frames(3);
    A.ok(document.querySelector('.inv-screen').textContent.indexOf('42') >= 0,
      'le contenu du coffre est affiche');
    key('Escape'); fakeLock(g, true); await frames(3);
    A.equal(typeof g.spillContainer, 'undefined', 'le client ne fait plus tomber lui-même le contenu d un coffre cassé');
    delete g.chests[k];
    g.world.setBlock(bx, by, bz, 0);
  });

  e2e('la jauge d usure apparait sur un outil entame', {
        "teste": "que la jauge d'usure (.wear) n'apparaît dans l'inventaire que sur un outil déjà entamé, pas sur un outil neuf",
        "pourquoi": "couvre le bug identifié (catalogue.js ignorait fiche.delai) où la jauge d'usure ne s'affichait pas correctement ; vérifie le mécanisme dans la vraie interface",
        "attendu": "aucune .wear sur un outil neuf, au moins une .wear après wearTool(0)"
  }, async function (g) {
    var s = await reset(g);
    s.inv.add(I.WOOD_PICKAXE, 1); s.selected = 0;
    key('KeyE');
    await frames(3);
    A.equal(document.querySelectorAll('.inv-screen .slot .wear').length, 0,
      'outil neuf : aucune jauge');
    key('Escape'); fakeLock(g, true); await frames(2);

    s.inv.wearTool(0);
    key('KeyE');
    await frames(3);
    A.gt(document.querySelectorAll('.inv-screen .slot .wear').length, 0,
      'outil entame : la jauge apparait dans l inventaire');
    key('Escape'); fakeLock(g, true); await frames(2);
  });

  e2e('la touche G jette l objet tenu', {
        "teste": "que la touche G jette une unité de l'objet actuellement sélectionné : l'unité quitte l'inventaire et l'objet au sol vient du SERVEUR (répliqué dans net.mobsDistants), jamais d'une entité locale",
        "pourquoi": "c'est le raccourci standard pour se débarrasser d'un objet ; depuis SPEC-ARCHI-031 l'inventaire et les objets au sol appartiennent au serveur, une page sans serveur ne peut plus rien jeter",
        "attendu": "une unité de moins dans l'inventaire, un nouvel objet au sol dans les répliques du serveur, et aucune entité locale créée par la touche"
  }, async function (g) {
    if (!(await serveurPresent())) { A.ok(true, 'serveur absent : test ignore'); return; }
    var s = await reset(g);
    var graineAvant = g.world.seed;
    g.rejoindreServeur({ pseudo: 'Jeteur' + Date.now() % 100000, joueurs: 1 });   // active aussi la prédiction d'inventaire (predInv)
    await sonderE2E(function () { return g.net.etat === 'en ligne'; }, 15000);
    A.equal(g.net.etat, 'en ligne', 'connecte au serveur');
    s = g.player.state;     // rejoindreServeur recompose l'équipe : le joueur local est un autre objet
    /* L'inventaire est celui du serveur : on s'y procure un objet RÉEL en
       cassant un bloc du monde serveur (comme SPEC-SUCCES-001), qui tombe
       puis est ramassé par le serveur. */
    var cible = null;
    await sonderE2E(function () {
      var p = g.player.state.pos, x = Math.floor(p.x), z = Math.floor(p.z);
      for (var y = Math.floor(p.y) - 1; y >= Math.floor(p.y) - 3; y--) {
        var id = g.world.getBlock(x, y, z);
        if (id && C.BLOCKS[id] && C.BLOCKS[id].hardness >= 0 && id !== B.WATER) { cible = { x: x, y: y, z: z }; return true; }
      }
      return false;
    }, 15000);
    A.ok(cible, 'un bloc réel du monde serveur est sous le joueur');
    g.net.poserBloc(cible.x, cible.y, cible.z, 0, 0, 0);
    function caseTenue() {
      for (var i = 0; i < Inv.HOTBAR_SIZE; i++) if (s.inv.slots[i]) return i;
      return -1;
    }
    await sonderE2E(function () { return caseTenue() >= 0; }, 15000);
    function objetsAuSol() {
      var out = [];
      g.net.mobsDistants.forEach(function (m) { if (m.type === 'item') out.push(m.eid); });
      return out;
    }
    /* Le bloc cassé tombe puis est ramassé par le serveur, parfois en plusieurs fois :
       on attend que l'inventaire et le sol ne bougent plus (1,2 s de calme) avant de jeter. */
    var signature = null, depuis = Date.now();
    await sonderE2E(function () {
      var sig = JSON.stringify(s.inv.slots.slice(0, Inv.HOTBAR_SIZE)) + '|' + objetsAuSol().join(',');
      if (sig !== signature) { signature = sig; depuis = Date.now(); }
      return caseTenue() >= 0 && objetsAuSol().length === 0 && Date.now() - depuis > 1200;
    }, 15000);
    var idx = caseTenue();
    A.ok(idx >= 0, 'le serveur a rendu un objet à l inventaire (' + idx + ')');
    s.selected = idx;
    var id0 = s.inv.slots[idx].id, avant = s.inv.count(id0), vusAvant = objetsAuSol();
    var localAvant = g.entities.list.length;
    key('KeyG');
    /* Le serveur peut ramasser l'objet jeté 0,4 s plus tard : l'unité en moins se constate
       tout de suite (prédiction), l'objet au sol dès que le relevé suivant le montre. */
    A.equal(s.inv.count(id0), avant - 1, 'une unite en moins');
    A.equal(g.entities.list.length, localAvant, 'la touche ne cree aucune entite locale');
    var nouveauSol = function () { return objetsAuSol().some(function (e) { return vusAvant.indexOf(e) < 0; }); };
    await sonderE2E(nouveauSol, 3000);
    A.ok(nouveauSol(), 'un objet au sol, venu du serveur');
    g.net.deconnecter();
    await sonderE2E(function () { return g.net.etat !== 'en ligne'; }, 5000);
    // le serveur a imposé SA graine : on rend aux tests suivants le monde qu'ils attendent
    if (g.world.seed !== graineAvant) g.remplacerMonde(graineAvant);
    await reset(g);
  });

  e2e('des grottes existent sous la surface', {
        "teste": "que la génération de terrain produit bien des cavités souterraines (blocs d'air) sous la surface",
        "pourquoi": "les grottes font partie de l'identité du monde généré ; sans elles, le sous-sol serait un bloc plein",
        "attendu": "au moins un bloc d'air trouvé en sondant des colonnes de chunks générés entre y=5 et y=20"
  }, async function (g) {
    await reset(g);
    var creux = 0;
    g.world.chunks.forEach(function (c) {
      for (var y = 5; y < 20; y++)
      for (var z = 0; z < 16; z += 4)
      for (var x = 0; x < 16; x += 4) {
        if (c.blocks[MC.Core.idx(x, y, z)] === 0) creux++;
      }
    });
    A.gt(creux, 0, 'des vides souterrains sont generes (' + creux + ')');
  });

  /* SPEC-AUDIT-002 : retirer une entite doit liberer geometrie ET materiaux.
     Ne liberer que la geometrie laisse fuir un materiau par entite, et les
     zombies disparaissent a chaque aube : la fuite est continue. */
  e2e('SPEC-AUDIT-002 : retirer une entite libere ses materiaux', async function (g) {
    var s = await reset(g);
    var avant = g.render.materiauxLiberes;
    var mobs = [];
    for (var i = 0; i < 5; i++) mobs.push(g.entities.spawn('zombie', s.pos.x + 3 + i, s.pos.y, s.pos.z));
    // selon ce qu'a laissé le test précédent, la boucle peut mettre quelques images à les mailler
    for (var k = 0; k < 60 && mobs.some(function (m) { return !g.render.entityMeshes.has(m.eid); }); k++) await frames(1);
    // d'autres créatures peuvent naître entre-temps (habitants, petits) : on suit les nôtres
    A.equal(mobs.filter(function (m) { return g.render.entityMeshes.has(m.eid); }).length, 5, 'cinq maillages crees');
    mobs.forEach(function (m) { g.entities.remove(m); });
    await frames(3);
    A.equal(mobs.filter(function (m) { return g.render.entityMeshes.has(m.eid); }).length, 0, 'maillages retires');
    A.ok(g.render.materiauxLiberes > avant,
      'des materiaux ont ete liberes (' + (g.render.materiauxLiberes - avant) + ')');
  });

  /* SPEC-AUDIT-003 : redemarrer une partie ne doit rien abandonner. */
  e2e('SPEC-AUDIT-003 : une nouvelle partie libere les entites vivantes', async function (g) {
    var s = await reset(g);
    for (var i = 0; i < 4; i++) g.entities.spawn('sheep', s.pos.x + 2 + i, s.pos.y, s.pos.z);
    g.entities.dropItem(s.pos.x, s.pos.y + 1, s.pos.z, B.COBBLE, 1);
    await frames(3);
    A.ok(g.render.entityMeshes.size >= 5, 'des maillages existent');
    var avant = g.render.materiauxLiberes;
    g.render.libererToutesEntites();
    A.equal(g.render.entityMeshes.size, 0, 'tout est retire');
    A.ok(g.render.materiauxLiberes > avant, 'les materiaux sont liberes');
    g.entities.list.length = 0;
    await frames(2);
  });

  /* SPEC-AUDIT-001 : plus de torche fantome apres un redemarrage. */
  e2e('SPEC-AUDIT-001 : une nouvelle partie n herite pas des lumieres', async function (g) {
    var s = await reset(g);
    var bx = Math.floor(s.pos.x) + 2, bz = Math.floor(s.pos.z);
    var by = g.world.groundAt(bx, bz, true) + 1;
    g.world.setBlock(bx, by, bz, B.TORCH);
    A.ok(g.world.lights.size > 0, 'une torche est posee');
    g.world.reset(g.render.disposeChunk);
    A.equal(g.world.lights.size, 0, 'registre de lumieres vide apres reinitialisation');
    await frames(3);
    /* Le monde régénéré a ses propres sources (torches de donjon, lanternes) :
       ce qui compte, c'est qu'aucune lumière ne survive de l'ancienne partie. */
    var actives = g.render.torchPool.filter(function (L) { return L.visible; });
    A.equal(actives.filter(function (L) {
      return Math.abs(L.position.x - (bx + 0.5)) < 0.01 && Math.abs(L.position.z - (bz + 0.5)) < 0.01 &&
             Math.abs(L.position.y - (by + 0.55)) < 0.01;
    }).length, 0, 'aucune lumiere ponctuelle a l emplacement de l ancienne torche');
    var sources = [];
    g.world.lights.forEach(function (l) { sources.push(l); });
    A.ok(actives.every(function (L) {
      return sources.some(function (l) { return Math.abs(l.x + 0.5 - L.position.x) < 0.01 && Math.abs(l.z + 0.5 - L.position.z) < 0.01; });
    }), 'chaque lumiere active appartient au monde courant');
    await reset(g);
  });

  /* SPEC-CHAT-010 : ouvrir le chat doit neutraliser les touches de jeu.
     Sans ce verrou, ecrire « avance » ferait courir le joueur. */
  e2e('SPEC-CHAT-010 : T ouvre le chat et neutralise les deplacements', async function (g) {
    var s = await reset(g);
    key('KeyT');
    await frames(3);
    A.ok(g.chat.enSaisie, 'chat ouvert');
    A.ok(g.input.saisieActive, 'entrees de jeu verrouillees');

    var x0 = s.pos.x, z0 = s.pos.z;
    // un vrai appui porte toujours `key` : on le fournit comme le navigateur
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w' }));
    await frames(20);
    A.close(s.pos.x, x0, 1e-6, 'le joueur n a pas bouge en X');
    A.close(s.pos.z, z0, 1e-6, 'ni en Z');
    A.ok(g.chat.saisie.length > 0, 'la touche a alimente le champ');

    key('Escape');
    await frames(3);
    A.notOk(g.chat.enSaisie, 'chat referme');
    A.notOk(g.input.saisieActive, 'entrees rendues au jeu');
  });

  e2e('SPEC-CHAT-001 : un message tape apparait dans la fenetre', async function (g) {
    await reset(g);
    g.chat.vider();
    key('KeyT');
    await frames(2);
    'bonjour'.split('').forEach(function (ch) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, code: 'Key' + ch.toUpperCase() }));
    });
    A.equal(g.chat.saisie, 'bonjour', 'texte saisi');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter' }));
    await frames(4);
    A.equal(g.chat.messages.length, 1, 'message publie');
    A.equal(g.chat.messages[0].texte, 'bonjour');
    A.ok(document.querySelector('.chat-log').textContent.indexOf('bonjour') >= 0,
      'affiche dans la fenetre');
    A.notOk(g.input.saisieActive, 'saisie refermee');
  });

  e2e('SPEC-CHAT-009 : une commande produit une reponse systeme', async function (g) {
    await reset(g);
    g.chat.vider();
    g.chat.ouvrir();
    g.chat.saisie = '/graine';
    var m = g.chat.valider('Joueur');
    g.traiterMessage(m);
    await frames(2);
    var sys = g.chat.messages.filter(function (x) { return x.type === 'systeme'; });
    A.ok(sys.length > 0, 'une reponse systeme est apparue');
    A.ok(sys[0].texte.indexOf(String(g.world.seed)) >= 0, 'la graine est annoncee');
  });

  e2e('SPEC-CHAT-007 : un message contenant du balisage est neutralise', async function (g) {
    await reset(g);
    g.chat.vider();
    g.chat.envoyer('Pirate', '<img src=x onerror=alert(1)>');
    await frames(3);
    var log = document.querySelector('.chat-log');
    A.equal(log.querySelectorAll('img').length, 0, 'aucune balise injectee');
    A.ok(log.textContent.indexOf('onerror') >= 0, 'le texte brut est bien affiche');
  });

  e2e('le retour arriere efface un caractere', {
        "teste": "que la touche Retour arrière (Backspace) efface le dernier caractère du champ de saisie du chat",
        "pourquoi": "c'est un raccourci d'édition de texte de base attendu par tout utilisateur",
        "attendu": "la saisie 'abc' devient 'ab' après un Backspace"
  }, async function (g) {
    await reset(g);
    key('KeyT');
    await frames(2);
    ['a', 'b', 'c'].forEach(function (ch) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, code: 'Key' + ch.toUpperCase() }));
    });
    A.equal(g.chat.saisie, 'abc');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backspace', key: 'Backspace' }));
    A.equal(g.chat.saisie, 'ab', 'un caractere retire');
    key('Escape');
    await frames(2);
  });

  /* ── Ecran partage ──────────────────────────────────────────────────── */

  function fausseManette(specs) {
    navigator.getGamepads = function () {
      return specs.map(function (p) {
        if (!p) return null;
        return { connected: p.connected !== false, index: p.index || 0,
                 axes: p.axes || [0, 0, 0, 0],
                 buttons: (p.buttons || []).map(function (b) {
                   return { pressed: !!b, value: b ? 1 : 0 }; }) };
      });
    };
  }
  function soloRetabli(g) {
    g.composerEquipe(1, MC.Modes.regles('survie', 'facile'));
  }

  e2e('SPEC-SPLIT-001 : composer une equipe de 1 a 4 joueurs', async function (g) {
    await reset(g);
    for (var n = 1; n <= 4; n++) {
      fausseManette([{ axes: [0,0,0,0] }, { axes: [0,0,0,0] }, { axes: [0,0,0,0] }]);
      g.composerEquipe(n, MC.Modes.regles('survie', 'facile'));
      await frames(4);
      A.equal(g.equipe.length, n, n + ' joueur(s)');
      A.equal(g.vues.length, n, n + ' vue(s)');
    }
    soloRetabli(g); await frames(3);
  });

  e2e('SPEC-SPLIT-008 : chaque joueur a son HUD, place sur sa vue', async function (g) {
    await reset(g);
    fausseManette([{ axes: [0,0,0,0] }, { axes: [0,0,0,0] }, { axes: [0,0,0,0] }]);
    g.composerEquipe(4, MC.Modes.regles('survie', 'facile'));
    await frames(5);
    var hs = document.querySelectorAll('.hud');
    A.equal(hs.length, 4, 'quatre HUD');
    // `g.vues[i]` est exprimé dans le repère de référence de l'hôte (sa
    // taille de disposition, `clientWidth`/`clientHeight`) ; le rectangle
    // visuel (getBoundingClientRect) peut être mis à l'échelle par CSS dans
    // le banc (SPEC-BANC-017) — on compare donc les deux dans le même repère
    // plutôt que de supposer une échelle 1:1.
    var host = g.render.renderer.domElement.parentElement;
    var echelleVisuelle = host.getBoundingClientRect().width / host.clientWidth;
    for (var i = 0; i < 4; i++) {
      var r = hs[i].getBoundingClientRect(), v = g.vues[i];
      A.close(r.width, v.w * echelleVisuelle, 2, 'HUD ' + i + ' : largeur de sa vue');
      A.close(r.height, v.h * echelleVisuelle, 2, 'HUD ' + i + ' : hauteur de sa vue');
    }
    soloRetabli(g); await frames(3);
  });

  e2e('SPEC-SPLIT-007 : inventaires et vies independants', async function (g) {
    await reset(g);
    fausseManette([{ axes: [0,0,0,0] }]);
    g.composerEquipe(2, MC.Modes.regles('survie', 'facile'));
    await frames(3);
    g.equipe[0].player.state.inv.add(B.COBBLE, 7);
    g.equipe[0].player.hurt(6);
    A.equal(g.equipe[1].player.state.inv.count(B.COBBLE), 0, 'inventaire distinct');
    A.equal(g.equipe[1].player.state.hp, 20, 'vie distincte');
    soloRetabli(g); await frames(3);
  });

  e2e('SPEC-SPLIT-011 : le stick gauche deplace le joueur 2', async function (g) {
    await reset(g);
    fausseManette([{ axes: [0, -1, 0, 0] }]);
    g.composerEquipe(2, MC.Modes.regles('creatif', 'facile'));
    await frames(3);
    var st = g.equipe[1].player.state;
    st.flying = true;
    // en l'air, loin du relief : une pente devant lui l'arrêterait, pas la manette
    st.pos.y = C.WORLD_H - 4; st.vel.y = 0;
    var x0 = st.pos.x, z0 = st.pos.z;
    await frames(40);
    var d = Math.hypot(st.pos.x - x0, st.pos.z - z0);
    A.gt(d, 1, 'le joueur 2 a avance a la manette (' + d.toFixed(2) + ')');
    soloRetabli(g); await frames(3);
  });

  e2e('SPEC-SPLIT-013 : manette debranchee, joueur au repos', async function (g) {
    await reset(g);
    fausseManette([{ connected: false, axes: [0, -1, 0, 0] }]);
    g.composerEquipe(2, MC.Modes.regles('creatif', 'facile'));
    await frames(3);
    var st = g.equipe[1].player.state;
    st.flying = true; st.vel.x = 0; st.vel.z = 0;
    var x0 = st.pos.x, z0 = st.pos.z;
    await frames(40);
    A.close(Math.hypot(st.pos.x - x0, st.pos.z - z0), 0, 0.05, 'aucun deplacement');
    soloRetabli(g); await frames(3);
  });

  e2e('SPEC-SPLIT-006 : les vues couvrent le cadre sans chevauchement', async function (g) {
    await reset(g);
    fausseManette([{ axes: [0,0,0,0] }, { axes: [0,0,0,0] }, { axes: [0,0,0,0] }]);
    g.composerEquipe(4, MC.Modes.regles('survie', 'facile'));
    await frames(4);
    var host = g.render.renderer.domElement.parentElement;
    var aire = g.vues.reduce(function (s2, v) { return s2 + v.w * v.h; }, 0);
    A.close(aire, host.clientWidth * host.clientHeight, 4, 'couverture totale');
    soloRetabli(g); await frames(3);
  });

  e2e('SPEC-SPLIT-016 : en cauchemar, une mort detruit la partie', async function (g) {
    await reset(g);
    fausseManette([{ axes: [0,0,0,0] }]);
    var st = localStorage;
    MC.Saves.toutEffacer(st);
    var meta = MC.Saves.creer(st, { nom: 'Test cauchemar', difficulte: 'cauchemar', graine: 99 });
    g.partieId = meta.id;
    MC.Saves.sauvegarder(st, meta.id, g);
    A.ok(MC.Saves.trouver(st, meta.id), 'partie enregistree');

    g.composerEquipe(2, MC.Modes.regles('survie', 'cauchemar'));
    await frames(3);
    g.equipe[1].player.hurt(20);
    await frames(8);
    A.equal(MC.Saves.trouver(st, meta.id), null, 'partie detruite');
    A.equal(g.world.overrides.size, 0, 'carte effacee');

    MC.Saves.toutEffacer(st);
    soloRetabli(g);
    g.player.state.dead = false; g.player.state.hp = 20;
    g.input.setState('playing'); fakeLock(g, true);
    await frames(3);
  });

  e2e('SPEC-SPLIT-015 : hors cauchemar, un mort n arrete pas les autres', async function (g) {
    await reset(g);
    fausseManette([{ axes: [0, -1, 0, 0] }]);
    g.composerEquipe(2, MC.Modes.regles('creatif', 'facile'));
    await frames(3);
    g.equipe[0].player.state.dead = true;
    var st2 = g.equipe[1].player.state;
    st2.flying = true;
    st2.pos.y = C.WORLD_H - 4; st2.vel.y = 0;       // hors du relief, comme SPLIT-011
    var x0 = st2.pos.x, z0 = st2.pos.z;
    await frames(40);
    A.gt(Math.hypot(st2.pos.x - x0, st2.pos.z - z0), 0.5, 'le joueur 2 bouge encore');
    soloRetabli(g);
    g.player.state.dead = false; g.player.state.hp = 20;
    await frames(3);
  });

  e2e('SPEC-SPLIT-005 : a quatre joueurs la cadence reste jouable', async function (g) {
    await reset(g);
    fausseManette([{ axes: [0,0,0,0] }, { axes: [0,0,0,0] }, { axes: [0,0,0,0] }]);
    g.composerEquipe(4, MC.Modes.regles('survie', 'facile'));
    await frames(10);
    var t0 = performance.now();
    await frames(60);
    var fps = 60 / ((performance.now() - t0) / 1000);
    A.gt(fps, 20, 'au moins 20 images/s en quadrant (' + fps.toFixed(0) + ')');
    soloRetabli(g); await frames(3);
  });

  /* ── Multijoueur ─────────────────────────────────────────────────────────
     Ces tests ne s executent que si la page est servie par le serveur de jeu :
     ouverts depuis un simple serveur statique, ils passent en s annoncant
     ignores plutot que d echouer a tort. */
  var SERVEUR_DISPO = null;
  /* Sondage borné (jamais un délai fixe) : rend la main dès que `fn()` est vrai, ou au bout de `ms`. */
  async function sonderE2E(fn, ms) {
    var fin = Date.now() + (ms || 8000);
    while (!fn() && Date.now() < fin) await wait(50);
    return !!fn();
  }
  async function serveurPresent() {
    if (SERVEUR_DISPO !== null) return SERVEUR_DISPO;
    try {
      var ws = new WebSocket((location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host);
      SERVEUR_DISPO = await new Promise(function (res) {
        var fini = false;
        var t = setTimeout(function () { if (!fini) { fini = true; try { ws.close(); } catch (e) {} res(false); } }, 1200);
        ws.onopen = function () { fini = true; clearTimeout(t); ws.close(); res(true); };
        ws.onerror = function () { if (!fini) { fini = true; clearTimeout(t); res(false); } };
      });
    } catch (e) { SERVEUR_DISPO = false; }
    return SERVEUR_DISPO;
  }

  /* Une case d'air à portée certaine du joueur (le serveur refuse au-delà de
     7 blocs depuis les yeux) : le relief autour du point d'apparition peut
     être un creux, où « le sol deux blocs plus loin » est hors d'atteinte. */
  function caseLibreProche(g) {
    var p = g.player.state.pos, fx = Math.floor(p.x), fy = Math.floor(p.y), fz = Math.floor(p.z);
    for (var r = 2; r <= 3; r++) for (var dy = 0; dy <= 2; dy++) for (var dx = -r; dx <= r; dx++) for (var dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      var x = fx + dx, y = fy + dy, z = fz + dz;
      if (g.world.getBlock(x, y, z) === 0) return { x: x, y: y, z: z };
    }
    return { x: fx, y: fy + 2, z: fz };
  }

  e2e('SPEC-NET-021 : un joueur distant est affiche avec son nom', async function (g) {
    if (!(await serveurPresent())) { A.ok(true, 'serveur absent : test ignore'); return; }
    await reset(g);
    /* Le serveur de ce banc est OUVERT (--serveur) : un second joueur y est admis.
       Sur un serveur fermé (le solo), un second poste serait refusé
       (poste_deja_connecte, SPEC-ARCHI-007) — le test ne dépend donc d'aucun
       délai fixe mais attend chaque étape par sondage borné. */
    var autre = MC.createNetClient({});
    g.net.connecter('', 'Hote', 1);
    await sonderE2E(function () { return g.net.etat === 'en ligne'; }, 15000);
    A.equal(g.net.etat, 'en ligne', 'connecte');
    autre.connecter('', 'Visiteur', 1);
    await sonderE2E(function () { return autre.etat === 'en ligne' || autre.etat === 'erreur'; }, 15000);
    A.equal(autre.etat, 'en ligne', 'le visiteur est admis (' + (autre.erreur || 'sans erreur') + ')');
    autre.envoyer({ t: 'bouge', x: g.player.state.pos.x + 3, y: g.player.state.pos.y,
                    z: g.player.state.pos.z, yaw: 0 });
    await sonderE2E(function () { return g.net.distants.size >= 1; }, 15000);
    await frames(5);
    A.equal(g.net.distants.size, 1, 'un joueur distant connu');
    var d = [...g.net.distants.values()][0];
    A.equal(d.nom, 'Visiteur', 'son nom est connu');
    await sonderE2E(function () { return g.render.maillagesDistants.size > 0; }, 15000);

    A.gt(g.render.maillagesDistants.size, 0, 'un maillage lui est associe (etat ' + g.input.state + ', distants ' + g.net.distants.size + ')');
    var m = g.render.maillagesDistants.get(d.id);
    A.ok(m && m.children.some(function (o) { return o.isSprite; }), 'une etiquette de nom existe');
    autre.deconnecter(); g.net.deconnecter();
    await wait(300);
  });

  e2e('SPEC-NET-011 : une pose de bloc est diffusee aux autres', async function (g) {
    if (!(await serveurPresent())) { A.ok(true, 'serveur absent : test ignore'); return; }
    await reset(g);
    g.net.connecter('', 'Poseur', 1);
    // la bienvenue replace le joueur là où le serveur le tient : on vise APRÈS
    for (var t = 0; t < 30 && g.net.etat !== 'en ligne'; t++) await wait(100);
    await wait(300);
    var s2 = g.player.state;
    var cl = caseLibreProche(g), bx = cl.x, by = cl.y, bz = cl.z;
    g.world.setBlock(bx, by, bz, 0);
    g.net.poserBloc(bx, by, bz, B.BRICK);
    await wait(600);
    A.equal(g.world.getBlock(bx, by, bz), B.BRICK, 'le serveur a confirme la pose');
    g.net.deconnecter();
    await wait(300);
  });

  e2e('SPEC-NET-022 : ecran partage et reseau se combinent', async function (g) {
    if (!(await serveurPresent())) { A.ok(true, 'serveur absent : test ignore'); return; }
    await reset(g);
    navigator.getGamepads = function () { return [{ connected: true, index: 0, axes: [0,0,0,0], buttons: [] }]; };
    g.composerEquipe(2, MC.Modes.regles('survie', 'facile'));
    await frames(4);
    g.net.connecter('', 'Duo', g.equipe.length);
    for (var t = 0; t < 30 && g.net.etat !== 'en ligne'; t++) await wait(100);
    A.equal(g.net.etat, 'en ligne', 'connecte malgre l ecran partage');
    A.equal(g.equipe.length, 2, 'toujours deux joueurs locaux');
    A.equal(g.vues.length, 2, 'toujours deux vues');
    g.net.deconnecter();
    g.composerEquipe(1, MC.Modes.regles('survie', 'facile'));
    await wait(300);
  });

  e2e('SPEC-NET-030 : une reconnexion immediate survit a la fermeture tardive de l ancienne socket', async function (g) {
    if (!(await serveurPresent())) { A.ok(true, 'serveur absent : test ignore'); return; }
    await reset(g);
    g.net.connecter('', 'Premier', 1);
    for (var t = 0; t < 30 && g.net.etat !== 'en ligne'; t++) await wait(100);
    A.equal(g.net.etat, 'en ligne', 'premiere connexion');
    // on coupe et on rappelle AUSSITOT : la fermeture de la premiere arrive apres coup
    g.net.deconnecter();
    g.net.connecter('', 'Second', 1);
    for (var u = 0; u < 30 && g.net.etat !== 'en ligne'; u++) await wait(100);
    await wait(400);
    A.equal(g.net.etat, 'en ligne', 'la seconde connexion tient');
    var cl = caseLibreProche(g), bx = cl.x, by = cl.y, bz = cl.z;
    g.world.setBlock(bx, by, bz, 0);
    g.net.poserBloc(bx, by, bz, B.BRICK);
    await wait(600);
    A.equal(g.world.getBlock(bx, by, bz), B.BRICK, 'et elle porte encore les poses de bloc');
    g.net.deconnecter();
    await wait(300);
  });

  e2e('SPEC-NET-023 : la perte de connexion bascule en solo sans planter', async function (g) {
    if (!(await serveurPresent())) { A.ok(true, 'serveur absent : test ignore'); return; }
    await reset(g);
    g.net.connecter('', 'Fragile', 1);
    await wait(700);
    A.equal(g.net.etat, 'en ligne', 'connecte');
    g.net.deconnecter();
    await frames(10);
    A.equal(g.net.etat, 'hors ligne', 'hors ligne');
    A.equal(g.net.distants.size, 0, 'les joueurs distants sont oublies');
    // et le jeu continue de tourner
    var y0 = g.player.state.pos.y;
    g.player.state.pos.y += 5;
    await frames(40);
    A.lt(g.player.state.pos.y, y0 + 5, 'la physique tourne toujours');
    A.equal(g.render.maillagesDistants.size, 0, 'plus aucun maillage distant');
  });

  e2e('B1 (docs/vague-2/B1.md § 6) : predInv/journal actifs en ligne, doSave neutralisee et inventaire solo restaure a la deconnexion', {
        "teste": "que rejoindreServeur active la prediction d'inventaire (predInv) et le journal de player.js, que le client n'a plus de doSave (le serveur sauvegarde, SPEC-ARCHI-036), et que l'inventaire/equipement solo d'avant connexion revient tel quel a la deconnexion",
        "pourquoi": "le serveur devient seul maitre de l'inventaire en ligne (SPEC-SYNC-007/008) ; une sauvegarde locale ou un inventaire solo perdu casserait la partie hors ligne",
        "attendu": "predInv et journalInv presents en ligne, g.doSave n'existe plus, inventaire solo (7 cailloux) retrouve intact apres deconnexion"
  }, async function (g) {
    if (!(await serveurPresent())) { A.ok(true, 'serveur absent : test ignore'); return; }
    await reset(g);
    var s = g.player.state;
    s.inv.slots[0] = { id: B.COBBLE, n: 7 };
    A.notOk(s.journalInv, 'hors ligne : pas de journal actif');
    g.rejoindreServeur({ pseudo: 'SoloB1_' + Date.now() % 100000, joueurs: 1 });
    for (var t = 0; t < 30 && g.net.etat !== 'en ligne'; t++) await wait(100);
    A.equal(g.net.etat, 'en ligne', 'connecte');
    await wait(300);
    var j = g.equipe[0];
    A.ok(j.predInv, 'predInv cree pour le joueur local');
    A.ok(Array.isArray(g.player.state.journalInv), 'journal actif en ligne');
    A.equal(typeof g.doSave, 'undefined', 'SPEC-ARCHI-036 : le client n a plus de doSave (le serveur sauvegarde)');
    g.net.deconnecter();
    for (var u = 0; u < 30 && g.net.etat === 'en ligne'; u++) await wait(100);
    await wait(300);
    A.equal(g.net.etat, 'hors ligne', 'de nouveau hors ligne');
    A.notOk(g.player.state.journalInv, 'journal desactive hors ligne');
    A.equal(g.player.state.inv.count(B.COBBLE), 7, 'inventaire solo restaure apres deconnexion');
  });

  e2e('B1 (étape 8, docs/vague-2/B1.md § 6/8) : coffre en ligne — modèle référence, conteneur PARTAGÉ (pas une copie locale)', {
        "teste": "qu'ouvrir un coffre en ligne passe par CONTENEUR_OUVRIR/CONTENEUR_ETAT (ui.container.cont posé, modèle référencé) plutôt que par une copie locale (Inv.create), et qu'un second client réseau qui ouvre la MÊME position reçoit un CONTENEUR_ETAT portant la MÊME clé — la preuve que le serveur tient un état unique et partagé",
        "pourquoi": "avant B1 étape 8, un coffre en ligne était entièrement local (chests[k] côté client) : deux joueurs sur le même coffre avaient chacun leur copie, ce qui permettait de dupliquer des objets (risque documenté docs/vague-2/README.md)",
        "attendu": "ui.container.cont existe et porte type:'chest' après la réponse serveur ; un second client (MC.createNetClient brut) obtient un CONTENEUR_ETAT de même clé ; Échap referme proprement (CONTENEUR_FERMER, plus d'écran)"
  }, async function (g) {
    if (!(await serveurPresent())) { A.ok(true, 'serveur absent : test ignore'); return; }
    await reset(g);
    g.rejoindreServeur({ pseudo: 'CoffreOnline_' + Date.now() % 100000, joueurs: 1 });
    for (var t = 0; t < 30 && g.net.etat !== 'en ligne'; t++) await wait(100);
    A.equal(g.net.etat, 'en ligne', 'connecté');
    await wait(300);

    var cl = caseLibreProche(g), bx = cl.x, by = cl.y, bz = cl.z;
    g.net.poserBloc(bx, by, bz, B.CHEST);
    for (var u = 0; u < 30 && g.world.getBlock(bx, by, bz) !== B.CHEST; u++) await wait(100);
    A.equal(g.world.getBlock(bx, by, bz), B.CHEST, 'le coffre est posé côté serveur');

    // ouvre EXACTEMENT comme un clic droit dessus (g.ouvrirConteneur, exposé
    // pour les tests comme g.coffreDe/g.parlerA) — asynchrone : l'écran ne
    // s'affiche vraiment qu'à la réponse du serveur (onConteneurEtat).
    g.ouvrirConteneur('chest', { x: bx, y: by, z: bz });
    for (var v = 0; v < 30 && !(g.ui.container && g.ui.container.cont); v++) await wait(100);
    A.ok(g.ui.container && g.ui.container.cont,
         'le serveur a répondu CONTENEUR_ETAT : le coffre s\'affiche en modèle référencé');
    A.equal(g.ui.container.kind, 'chest', 'genre chest');
    A.equal(g.ui.container.cont.type, 'chest', 'le miroir réseau porte le type renvoyé par le serveur');
    var cleCoffre = g.ui.container.cont.cle;
    A.ok(cleCoffre, 'le miroir porte la clé du conteneur serveur');

    // second joueur, second client réseau BRUT (même patron que SPEC-NET-021) :
    // ouvre la MÊME position — preuve que le serveur tient un état PARTAGÉ,
    // pas une copie par joueur (le risque documenté par B1 étape 7/8).
    var etatsAutre = [];
    var autre = MC.createNetClient({ onConteneurEtat: function (m) { etatsAutre.push(m); } });
    autre.connecter('', 'Visiteur', 1);
    for (var w = 0; w < 30 && autre.etat !== 'en ligne'; w++) await wait(100);
    A.equal(autre.etat, 'en ligne', 'second client connecté');
    autre.envoyer({ t: 'cont_ouvrir', j: 0, x: bx, y: by, z: bz });
    for (var x2 = 0; x2 < 30 && !etatsAutre.length; x2++) await wait(100);
    A.ok(etatsAutre.length, 'le second joueur reçoit bien un CONTENEUR_ETAT pour la même position');
    A.equal(etatsAutre[0].cle, cleCoffre, 'même clé : c\'est le MÊME conteneur serveur, jamais une copie locale');

    // fermeture propre : Échap referme l'écran (CONTENEUR_FERMER envoyé,
    // désabonnement) — jamais le modèle legacy (clickSlotLegacy) en ligne.
    key('Escape');
    await frames(2);
    A.notOk(g.ui.isContainerOpen(), 'l\'écran est refermé');

    autre.deconnecter(); g.net.deconnecter();
    await wait(300);
  });

  /* ── Menus ───────────────────────────────────────────────────────────── */

  function videParties() { MC.Saves.toutEffacer(localStorage); }

  e2e('SPEC-MENU-001 : le menu liste les parties avec leurs metadonnees', async function (g) {
    videParties();
    MC.Saves.creer(localStorage, { nom: 'Alpha', mode: 'creatif',
                                   difficulte: 'cauchemar', graine: 4242 });
    g.afficherMenu();
    await frames(3);
    var l = document.querySelectorAll('.partie');
    A.equal(l.length, 1, 'une partie listee');
    var t = l[0].textContent;
    A.ok(t.indexOf('Alpha') >= 0, 'le nom');
    A.ok(t.indexOf('Cr') >= 0, 'le mode');
    A.ok(t.indexOf('Cauchemar') >= 0, 'la difficulte');
    A.ok(t.indexOf('4242') >= 0, 'la graine');
    videParties();
  });

  e2e('SPEC-MENU-002 : le formulaire offre les cinq reglages', async function (g) {
    videParties(); g.afficherMenu(); await frames(2);
    document.querySelector('#btn-nouvelle').click();
    await frames(3);
    A.ok(document.querySelector('#f-nom'), 'champ nom');
    A.ok(document.querySelector('#f-graine'), 'champ graine');
    A.equal(document.querySelectorAll('.choix[data-nom="mode"] .opt').length, 3, 'trois modes : survie, créatif, histoire');
    A.equal(document.querySelectorAll('.choix[data-nom="diff"] .opt').length, 4, 'quatre difficultes');
    A.equal(document.querySelectorAll('.choix[data-nom="joueurs"] .opt').length, 4, 'un a quatre joueurs');
    // le mode histoire déplie ses paramètres
    var fsH = document.querySelector('#f-histoire');
    A.equal(fsH.style.display, 'none', 'paramètres d histoire repliés hors du mode histoire');
    document.querySelector('.choix[data-nom="mode"] .opt[data-val="histoire"]').click();
    A.ok(fsH.style.display !== 'none', 'dépliés en mode histoire');
    A.ok(document.querySelector('#f-heros') && document.querySelectorAll('.choix[data-nom="longueur"] .opt').length === 3, 'héros et longueur');
    document.querySelector('.choix[data-nom="interactions"] .opt[data-val="restreinte"]').click();
    var pierre = document.querySelector('.cat-bloc[value="pierre"]'), vegetal = document.querySelector('.cat-bloc[value="vegetal"]');
    A.ok(!pierre.checked && vegetal.checked, 'le préréglage coche ses catégories');
    document.querySelector('.choix[data-nom="interactions"] .opt[data-val="libre"]').click();
    A.ok(pierre.checked, 'libre : tout coché');
  });

  e2e('SPEC-MENU-004 : une graine textuelle est convertie', async function (g) {
    videParties(); g.afficherMenu(); await frames(2);
    document.querySelector('#btn-nouvelle').click(); await frames(2);
    document.querySelector('#f-nom').value = 'Test graine';
    document.querySelector('#f-graine').value = 'mot de passe';
    document.querySelector('#btn-creer').click();
    await frames(8);
    A.equal(g.world.seed, MC.Modes.graineDepuisTexte('mot de passe'),
      'la graine du monde suit le mot saisi');
    videParties();
  });

  e2e('SPEC-MENU-003 : une graine vide est tiree au hasard', async function (g) {
    videParties(); g.afficherMenu(); await frames(2);
    var graines = [];
    for (var i = 0; i < 2; i++) {
      document.querySelector('#btn-nouvelle').click(); await frames(2);
      document.querySelector('#f-nom').value = 'Hasard ' + i;
      document.querySelector('#f-graine').value = '';
      document.querySelector('#btn-creer').click();
      await frames(8);
      graines.push(g.world.seed);
      g.afficherMenu(); await frames(2);
    }
    A.ne(graines[0], graines[1], 'deux tirages differents');
    videParties();
  });

  e2e('SPEC-MENU-005 : le mode et la difficulte choisis sont appliques', async function (g) {
    videParties(); g.afficherMenu(); await frames(2);
    document.querySelector('#btn-nouvelle').click(); await frames(2);
    document.querySelector('#f-nom').value = 'Creatif paisible';
    document.querySelector('.choix[data-nom="mode"] .opt[data-val="creatif"]').click();
    document.querySelector('.choix[data-nom="diff"] .opt[data-val="paisible"]').click();
    document.querySelector('#btn-creer').click();
    await frames(8);
    A.equal(g.regles.mode.id, 'creatif', 'mode applique');
    A.equal(g.regles.difficulte.id, 'paisible', 'difficulte appliquee');
    A.ok(g.player.state.flying, 'le vol est actif en creatif');
    A.ok(g.regles.invulnerable, 'invulnerable');
    videParties();
  });

  e2e('SPEC-MENU-007 : le nombre de joueurs locaux choisi est applique', async function (g) {
    videParties(); g.afficherMenu(); await frames(2);
    navigator.getGamepads = function () {
      return [{ connected: true, index: 0, axes: [0,0,0,0], buttons: [] },
              { connected: true, index: 1, axes: [0,0,0,0], buttons: [] }];
    };
    document.querySelector('#btn-nouvelle').click(); await frames(2);
    document.querySelector('#f-nom').value = 'A trois';
    document.querySelector('.choix[data-nom="joueurs"] .opt[data-val="3"]').click();
    document.querySelector('#btn-creer').click();
    await frames(8);
    A.equal(g.equipe.length, 3, 'trois joueurs locaux');
    A.equal(g.vues.length, 3, 'trois vues');
    g.composerEquipe(1, MC.Modes.regles('survie', 'facile'));
    videParties(); await frames(3);
  });

  e2e('SPEC-MENU-006 : supprimer demande confirmation puis retire la partie', async function (g) {
    videParties();
    MC.Saves.creer(localStorage, { nom: 'A jeter', graine: 1 });
    g.afficherMenu(); await frames(3);
    A.equal(document.querySelectorAll('.partie').length, 1, 'une partie');
    var b = document.querySelector('.suppr');
    b.click();                       // premier clic : arme seulement
    await frames(2);
    A.equal(document.querySelectorAll('.partie').length, 1, 'toujours la apres un seul clic');
    A.ok(/Confirmer/.test(b.textContent), 'le bouton demande confirmation');
    b.click();                       // second clic : confirme
    await frames(3);
    A.equal(document.querySelectorAll('.partie').length, 0, 'partie supprimee');
    videParties();
  });

  e2e('SPEC-MENU-008 : l ecran multijoueur offre adresse et pseudo', async function (g) {
    videParties(); g.afficherMenu(); await frames(2);
    document.querySelector('#btn-multi').click();
    await frames(3);
    A.ok(document.querySelector('#f-hote'), 'champ adresse');
    A.ok(document.querySelector('#f-pseudo'), 'champ pseudo');
    A.ok(document.querySelector('#btn-join'), 'bouton rejoindre');
    document.querySelector('#btn-retour').click();
    await frames(2);
    A.ok(document.querySelector('#btn-nouvelle'), 'retour a la liste');
  });

  e2e('SPEC-MENU-009 : le menu pause offre sauvegarder et quitter', async function (g) {
    await reset(g);
    key('Escape');
    await frames(3);
    A.equal(g.input.state, 'paused');
    A.ok(document.querySelector('#btn-save'), 'bouton sauvegarder');
    A.ok(document.querySelector('#btn-quit'), 'bouton menu principal');
    A.ok(document.querySelector('#btn-resume'), 'bouton reprendre');
    key('Escape'); fakeLock(g, true); await frames(3);
  });

  e2e('SPEC-OPTION-001 : les options s appliquent aussitôt et se conservent', async function (g) {
    var avant = JSON.parse(JSON.stringify(g.options));
    try {
      await reset(g);
      key('Escape'); await frames(3);
      document.querySelector('#btn-options').click(); await frames(2);
      A.ok(document.querySelector('.options'), 'l écran des options');
      function glisser(k, v) {
        var i = document.querySelector('input[data-opt="' + k + '"]');
        i.value = v; i.dispatchEvent(new Event('input'));
      }
      glisser('champ', 90);
      A.equal(g.render.camera.fov, 90, 'champ de vision appliqué');
      glisser('sensibilite', 2);
      A.close(g.input.SENS, 0.0044, 1e-9, 'sensibilité appliquée');
      glisser('volume', 0.5);
      A.close(g.audio.volume, 0.5, 1e-9, 'volume appliqué');
      glisser('vueMax', 6);
      A.ok(g.render.RENDER_DIST <= 6, 'distance de vue bornée');
      var ombres = document.querySelector('input[data-opt="ombres"]');
      ombres.checked = false; ombres.dispatchEvent(new Event('change'));
      A.equal(g.render.ombresActives, false, 'ombres coupées');
      var real = document.querySelector('input[data-opt="realiste"]');
      real.checked = false; real.dispatchEvent(new Event('change'));
      A.equal(g.render.loin.options.realiste, false, 'rendu lointain simple');
      // conservées : relues du stockage
      var lu = MC.Options.charger(localStorage);
      A.equal(lu.champ, 90); A.equal(lu.vueMax, 6); A.equal(lu.ombres, false);
      document.querySelector('#btn-opt-defaut').click(); await frames(2);
      A.equal(g.render.camera.fov, 72, 'les défauts reviennent');
      document.querySelector('#btn-retour').click(); await frames(2);
      A.ok(document.querySelector('#btn-resume'), 'retour à la pause');
    } finally {
      g.options = avant; MC.Options.sauver(localStorage, avant);
      key('Escape'); fakeLock(g, true); await frames(3);
    }
  });

  e2e('SPEC-OPTION-005 / SPEC-OPTION-006 : la résolution et la vue étendue s appliquent au rendu', async function (g) {
    var avant = JSON.parse(JSON.stringify(g.options)), ecrans = g.ecrans;
    try {
      await reset(g);
      var r = g.render.renderer, hote = r.domElement.clientWidth;
      g.reglerOption('resolution', '800x600'); await frames(2);
      A.close(r.getPixelRatio(), Math.min(800 / hote, 600 / r.domElement.clientHeight), 1e-6, 'le tampon prend la résolution voulue');
      A.equal(r.domElement.clientWidth, hote, 'l image garde la taille de l hôte');
      g.reglerOption('resolution', 'native'); await frames(2);
      g.ecrans = [{ largeur: 1920, hauteur: 1080, principal: true, nom: 'A' }, { largeur: 1920, hauteur: 1080, principal: false, nom: 'B' }];
      g.reglerOption('orientation', 'vertical');
      g.reglerOption('nombreEcrans', 2); await frames(2);
      A.gt(g.render.camera.fov, 100, 'empilés : champ vertical élargi');
      A.ok(g.ui && document.querySelector('.vue-etendue'), 'le HUD se range sur l écran principal');
      g.ecrans = [g.ecrans[0]];
      g.reglerOption('nombreEcrans', 3); await frames(2);
      A.ok(g.disposition.repli, 'un écran manque : repli');
      A.equal(g.render.camera.fov, avant.champ, 'et la vue revient à un écran');
      // l'écran d'options propose les listes
      key('Escape'); await frames(3);
      document.querySelector('#btn-options').click(); await frames(2);
      A.ok(document.querySelector('select[data-opt="resolution"]'), 'liste des résolutions');
      A.ok(document.querySelector('select[data-opt="gpu"]'), 'choix du GPU');
      A.ok(document.querySelector('select[data-opt="ecran"]'), 'choix de l écran');
      document.querySelector('#btn-retour').click(); await frames(2);
      key('Escape'); fakeLock(g, true); await frames(3);
    } finally {
      g.ecrans = ecrans;
      g.options = avant; MC.Options.sauver(localStorage, avant);
      g.reglerOption('nombreEcrans', avant.nombreEcrans);
      g.reglerOption('resolution', avant.resolution);
    }
  });

  e2e('SPEC-OPTION-007 : les écrans défilent au lieu d être rognés, et la taille de l interface s applique', async function (g) {
    var avant = JSON.parse(JSON.stringify(g.options));
    try {
      await reset(g);
      key('Escape'); await frames(3);
      document.querySelector('#btn-options').click(); await frames(2);
      var ov = document.querySelector('.overlay'), panneau = ov.firstElementChild;
      A.equal(getComputedStyle(ov).overflowY, 'auto', 'l écran défile verticalement');
      A.equal(getComputedStyle(ov).overflowX, 'auto', 'et horizontalement');
      A.ok(document.querySelector('select[data-opt="tailleInterface"]'), 'la taille de l interface se choisit');
      g.reglerOption('tailleInterface', '60'); await frames(2);
      var petit = panneau.getBoundingClientRect().height;
      A.close(parseFloat(getComputedStyle(ov.parentNode).getPropertyValue('--ui')), 0.6, 1e-6, 'échelle 60 % appliquée');
      g.reglerOption('tailleInterface', '150'); await frames(2);
      var grand = panneau.getBoundingClientRect().height;
      A.close(parseFloat(getComputedStyle(ov.parentNode).getPropertyValue('--ui')), 1.5, 1e-6, 'échelle 150 % appliquée');
      /* La croissance RÉELLE du panneau n'est pas strictement proportionnelle
         à l'échelle : `.opt-liste` se range sur plusieurs colonnes « quand
         la place le permet » (CSS grid `auto-fit`), et `zoom` change combien
         en tient — deux comportements DU MÊME spec qui se combinent. On
         vérifie donc que l'échelle a un effet net et dans le bon sens,
         plutôt qu'un ratio exact qui dépend de la largeur disponible. */
      A.gt(grand, petit * 1.3, 'le panneau grandit nettement avec la taille choisie (' + petit.toFixed(0) + ' -> ' + grand.toFixed(0) + ')');
      // à 150 %, il ne tient plus : il déborde, mais rien n'est hors d'atteinte
      A.gt(ov.scrollHeight, ov.clientHeight, 'le panneau déborde de la fenêtre');
      ov.scrollTop = 0; await frames(1);
      A.ok(panneau.getBoundingClientRect().top >= ov.getBoundingClientRect().top - 1, 'le haut du panneau est visible, pas rogné');
      ov.scrollTop = ov.scrollHeight; await frames(1);
      var b = document.querySelector('#btn-retour').getBoundingClientRect(), o = ov.getBoundingClientRect();
      A.ok(b.bottom <= o.bottom + 1 && b.top >= o.top - 1, 'en défilant, le bouton Retour devient visible');
      // automatique : l'interface suit la taille de l'hôte du rendu (SPEC-OPTION-008
      // l'a rendue distincte de la fenêtre : `g.tailleVue()` est la référence)
      g.reglerOption('tailleInterface', 'auto'); await frames(2);
      var tv = g.tailleVue();
      A.close(parseFloat(getComputedStyle(ov.parentNode).getPropertyValue('--ui')),
              MC.Options.echelleInterface('auto', tv.l, tv.h), 1e-6, 'auto suit la taille de l\'hôte');
      document.querySelector('#btn-retour').click(); await frames(2);
      key('Escape'); fakeLock(g, true); await frames(3);
    } finally {
      g.options = avant; MC.Options.sauver(localStorage, avant);
      g.reglerOption('tailleInterface', avant.tailleInterface || 'auto');
    }
  });

  e2e('SPEC-OPTION-003 : une touche se remappe, un conflit est signalé, l aide suit', async function (g) {
    var avant = JSON.parse(JSON.stringify(g.options));
    function presser(code) { document.dispatchEvent(new KeyboardEvent('keydown', { code: code, bubbles: true, cancelable: true })); }
    try {
      await reset(g);
      key('Escape'); await frames(3);
      document.querySelector('#btn-options').click(); await frames(2);
      document.querySelector('.lier[data-action="inventaire"]').click();
      presser('KeyI'); await frames(2);
      A.equal(MC.Options.actionDe(g.options.touches, 'KeyI'), 'inventaire', 'I ouvre l inventaire');
      A.ok(/enregistrée/.test(document.querySelector('#opt-msg').textContent));
      document.querySelector('.lier[data-action="carte"]').click();
      presser('KeyI'); await frames(2);
      A.ok(/Conflit/.test(document.querySelector('#opt-msg').textContent), 'conflit signalé');
      A.equal(MC.Options.actionDe(g.options.touches, 'KeyC'), 'carte', 'la carte garde sa touche');
      document.querySelector('.lier[data-action="avancer"]').click();
      presser('KeyU'); await frames(2);
      A.equal(g.input.BINDINGS.forward.join(','), 'KeyU', 'avancer se fait avec U');
      A.equal(MC.Options.charger(localStorage).touches.inventaire.join(','), 'KeyI', 'conservé');
      document.querySelector('#btn-retour').click(); await frames(2);
      var aide = document.querySelector('table.keys').textContent;
      A.ok(aide.indexOf('U') >= 0 && aide.indexOf('I') >= 0, 'l aide de la pause montre les touches en vigueur');
      key('Escape'); fakeLock(g, true); await frames(3);
      key('KeyI'); await frames(2);
      A.equal(g.input.state, 'ui', 'la nouvelle touche ouvre l inventaire');
      key('KeyI'); await frames(2);
    } finally {
      g.options = avant; MC.Options.sauver(localStorage, avant);
      g.input.setTouches(avant.touches);
      if (g.input.state === 'ui') { key('Escape'); await frames(2); }
    }
  });

  e2e('SPEC-OPTION-002 : chaque bouton des menus fait ce qu il annonce', async function (g) {
    videParties(); g.afficherMenu(); await frames(2);
    document.querySelector('#btn-aide').click(); await frames(2);
    A.ok(document.querySelector('table.keys'), 'l aide');
    document.querySelector('#btn-retour').click(); await frames(2);
    A.ok(document.querySelector('#btn-nouvelle'), 'retour à l accueil');
    document.querySelector('#btn-options').click(); await frames(2);
    A.ok(document.querySelector('.options'), 'options depuis l accueil');
    document.querySelector('#btn-retour').click(); await frames(2);
    A.ok(document.querySelector('#btn-nouvelle'), 'retour à l accueil depuis les options');
    document.querySelector('#btn-multi').click(); await frames(2);
    A.ok(document.querySelector('#f-hote'), 'multijoueur');
    document.querySelector('#btn-retour').click(); await frames(2);
    document.querySelector('#btn-nouvelle').click(); await frames(2);
    A.ok(document.querySelector('#btn-creer'), 'l écran de création');
    var ret = document.querySelector('#btn-retour');
    A.ok(ret, 'la création a un retour');
    ret.click(); await frames(2);
    A.ok(document.querySelector('#btn-nouvelle'), 'retour depuis la création');
    // pause : affichage, options, succès, sauvegarder, reprendre, menu principal
    await reset(g);
    key('Escape'); await frames(3);
    document.querySelector('#btn-affichage').click(); await frames(2);
    A.ok(document.querySelector('.aff-liste'), 'affichage');
    document.querySelector('#btn-retour').click(); await frames(2);
    document.querySelector('#btn-options').click(); await frames(2);
    A.ok(document.querySelector('.options'), 'options depuis la pause');
    document.querySelector('#btn-retour').click(); await frames(2);
    document.querySelector('#btn-succes').click(); await frames(2);
    A.equal(g.input.state, 'ui', 'le panneau des succès');
    key('Escape'); await frames(3);
    if (g.input.state !== 'paused') { key('Escape'); await frames(3); }
    A.equal(g.input.state, 'paused');
    // sauvegarder rend compte de la sauvegarde (ou de son impossibilité, partie sans nom)
    document.querySelector('#btn-save').click(); await frames(3);
    A.ok(/sauvegard/i.test(document.body.textContent), 'sauvegarder annonce son résultat');
    document.querySelector('#btn-resume').click(); fakeLock(g, true); await frames(3);
    A.equal(g.input.state, 'playing', 'reprendre relance la partie');
    key('Escape'); await frames(3);
    document.querySelector('#btn-quit').click(); await frames(3);
    A.ok(document.querySelector('#btn-nouvelle'), 'menu principal');
    videParties();
    await reset(g);
  });

  e2e('SPEC-MENU-010 : la graine courante est affichee en pause', async function (g) {
    await reset(g);
    key('Escape');
    await frames(3);
    var t = document.querySelector('.panel .sub').textContent;
    A.ok(t.indexOf(String(g.world.seed)) >= 0, 'la graine est affichee : ' + t);
    key('Escape'); fakeLock(g, true); await frames(3);
  });

  e2e('le ciel change entre le jour et la nuit', {
        "teste": "que la couleur de fond du ciel change selon l'heure du monde, et que la nuit est plus sombre que le jour",
        "pourquoi": "le cycle jour/nuit doit se refléter visuellement dans le rendu",
        "attendu": "couleur de fond différente entre 20% et 70% de DAY_LENGTH, et la nuit strictement plus sombre (somme RVB plus faible)"
  }, async function (g) {
    await reset(g);
    var DL = MC.DayCycle.DAY_LENGTH;
    g.time = DL * 0.2;
    await frames(3);
    var jour = g.render.scene.background.getHex();
    g.time = DL * 0.7;
    await frames(3);
    var nuit = g.render.scene.background.getHex();
    A.ne(jour, nuit, 'la couleur du ciel diffère');
    var lum = function (h) { return (h >> 16) + ((h >> 8) & 255) + (h & 255); };
    A.lt(lum(nuit), lum(jour), 'la nuit est plus sombre');
    g.time = DL * 0.2;
  });

  e2e('sous l\'eau, la vue se teinte et le brouillard se resserre', {
        "teste": "qu'être immergé dans l'eau resserre la distance du brouillard de rendu par rapport à l'air libre",
        "pourquoi": "l'immersion doit donner un retour visuel clair (vue trouble) cohérent avec le fait d'être sous l'eau",
        "attendu": "fog.far strictement inférieur à sa valeur hors de l'eau, une fois la tête immergée dans une poche d'eau créée pour le test"
  }, async function (g) {
    var s = await reset(g);
    var far0 = g.render.scene.fog.far;
    // on crée une poche d'eau autour de la tête
    var bx = Math.floor(s.pos.x), by = Math.floor(s.pos.y), bz = Math.floor(s.pos.z);
    for (var y = by; y <= by + 3; y++) g.world.setBlock(bx, y, bz, B.WATER);
    s.flying = true;
    await frames(4);
    A.lt(g.render.scene.fog.far, far0, 'brouillard resserré sous l\'eau');
    for (var y2 = by; y2 <= by + 3; y2++) g.world.setBlock(bx, y2, bz, 0);
    s.flying = false;
    s.pos.y = g.world.groundAt(bx, bz, true) + 1.2;
    await frames(4);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Sauvegarde
  // ══════════════════════════════════════════════════════════════════════════
  e2e('sauvegarder puis recharger restitue la construction et l\'inventaire', {
        "teste": "le cycle complet sauvegarde/rechargement : une construction posée, un inventaire modifié et des PV changés sont retrouvés à l'identique après avoir tout effacé puis rechargé la sauvegarde",
        "pourquoi": "c'est la garantie de persistance de base attendue par un joueur",
        "attendu": "après effacement puis MC.Saves.charger(), le bloc posé, la quantité de verre et les PV sont retrouvés exactement"
  }, async function (g) {
    var s = await reset(g);
    /* La sauvegarde ecrit dans l emplacement de la partie courante : sans
       emplacement il n y a rien a ecrire, et c est voulu. On en cree un. */
    MC.Saves.toutEffacer(localStorage);
    var meta = MC.Saves.creer(localStorage, { nom: 'Test sauvegarde', graine: g.world.seed });
    g.partieId = meta.id;
    var bx = Math.floor(s.pos.x) + 4, bz = Math.floor(s.pos.z) + 4;
    var by = g.world.groundAt(bx, bz, true) + 1;
    g.world.setBlock(bx, by, bz, B.BRICK);
    s.inv.add(B.GLASS, 33);
    s.hp = 11;
    A.ok(MC.Saves.sauvegarder(localStorage, g.partieId, g), 'sauvegarde écrite');   // le module de sauvegarde (le serveur l'utilise) : le client n'a plus de doSave

    // on casse tout et on vide l'inventaire
    g.world.setBlock(bx, by, bz, 0);
    s.inv.load([]);
    s.hp = 20;
    A.equal(g.world.getBlock(bx, by, bz), 0, 'construction effacée');

    A.ok(MC.Saves.charger(localStorage, g.partieId, g), 'rechargée');
    g.world.getChunk(Math.floor(bx / 16), Math.floor(bz / 16), true);
    A.equal(g.world.getBlock(bx, by, bz), B.BRICK, 'brique retrouvée');
    A.equal(s.inv.count(B.GLASS), 33, 'inventaire retrouvé');
    A.equal(s.hp, 11, 'vie retrouvée');
    MC.Saves.toutEffacer(localStorage);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // HUD
  // ══════════════════════════════════════════════════════════════════════════
  e2e('le HUD reflète la vie et la faim', {
        "teste": "que les barres de vie (cœurs) et de faim (pastilles) du HUD affichent le bon nombre de pips pleins selon hp et hunger",
        "pourquoi": "le joueur doit pouvoir lire son état vital d'un coup d'œil, fidèlement",
        "attendu": "6 PV affiche 3 cœurs pleins, 4 points de faim affiche 2 pastilles pleines"
  }, async function (g) {
    var s = await reset(g);
    s.hp = 6; s.hunger = 4;
    await frames(3);
    // un HUD par joueur depuis l ecran partage : on interroge celui du joueur 1
    var hud = g.ui.hudDe(0);
    var pleins = hud.querySelectorAll('.bar.health .pip.full').length;
    A.equal(pleins, 3, '6 pv = 3 cœurs pleins');
    var food = hud.querySelectorAll('.bar.hunger .pip.full').length;
    A.equal(food, 2, '4 points de faim = 2 pastilles');
    s.hp = 20; s.hunger = 20;
  });

  e2e('la jauge d\'air n\'apparaît que sous l\'eau', {
        "teste": "que la barre d'air (.bar.air) du HUD reste masquée à air plein et apparaît en apnée",
        "pourquoi": "afficher la jauge d'air en permanence encombrerait l'interface hors de l'eau, sans utilité",
        "attendu": "display none à air=10 (plein), différent de none à air=4 (en manque)"
  }, async function (g) {
    var s = await reset(g);
    s.air = 10;
    await frames(3);
    var hudA = g.ui.hudDe(0);
    A.equal(getComputedStyle(hudA.querySelector('.bar.air')).display, 'none', 'masquée hors de l\'eau');
    s.air = 4;
    await frames(3);
    A.ne(getComputedStyle(hudA.querySelector('.bar.air')).display, 'none', 'visible en apnée');
    s.air = 10;
  });

  e2e('la hotbar suit la sélection et le contenu', {
        "teste": "que la hotbar affiche la bonne case en surbrillance et les bonnes quantités, et se met à jour au changement de sélection clavier",
        "pourquoi": "la hotbar est la vue principale de l'inventoire actif pendant le jeu",
        "attendu": "case 0 en surbrillance avec quantité 7 affichée, puis case 2 sélectionnée et en surbrillance après Digit3"
  }, async function (g) {
    var s = await reset(g);
    s.inv.add(B.BRICK, 7);
    await frames(3);
    var hudH = g.ui.hudDe(0);
    var slots = hudH.querySelectorAll('.hotbar .slot');
    A.ok(slots[0].classList.contains('on'), 'case 0 sélectionnée');
    A.equal(slots[0].querySelector('.n').textContent, '7', 'quantité affichée');
    key('Digit3');
    await frames(3);
    A.equal(s.selected, 2, 'sélection au clavier');
    A.ok(hudH.querySelectorAll('.hotbar .slot')[2].classList.contains('on'), 'surbrillance déplacée');
    s.selected = 0;
  });

  e2e('la molette change d\'objet sélectionné', {
        "teste": "que la molette de la souris fait défiler la sélection de la hotbar, dans les deux sens",
        "pourquoi": "c'est un raccourci standard et rapide de changement d'objet",
        "attendu": "deltaY positif avance la sélection (0 -> 1), deltaY négatif la recule (1 -> 0)"
  }, async function (g) {
    var s = await reset(g);
    s.selected = 0;
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    A.equal(s.selected, 1, 'molette bas => case suivante');
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    A.equal(s.selected, 0, 'molette haut => case précédente');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Performance
  // ══════════════════════════════════════════════════════════════════════════
  e2e('la boucle tient une cadence correcte', {
        "teste": "que la boucle de jeu tient un minimum de 20 images par seconde sur 90 frames mesurées",
        "pourquoi": "une cadence trop basse rendrait le jeu injouable ; ce test sert de garde-fou de performance minimal",
        "attendu": "fps mesuré > 20 (seuil volontairement bas pour absorber la variance du banc headless)"
  }, async function (g) {
    await reset(g);
    var t0 = performance.now();
    await frames(90);
    var dt = performance.now() - t0;
    var fps = 90 / (dt / 1000);
    A.gt(fps, 20, 'au moins 20 images/s (mesuré ' + fps.toFixed(0) + ')');
  });

  /* Heure du monde tombant en plein dans un temps donné (la météo est une
     fonction de la graine et de l'heure : on ne la force pas, on s'y rend). */
  function heureDe(g, type) {
    var me = g.world.meteo;
    // 40 s après le début du segment : avant le fondu vers le temps suivant
    for (var k = 1; k < 20000; k++) if (me.typeDu(k) === type) return k * MC.Meteo.SEGMENT + 40;
    return null;
  }

  e2e('SPEC-METEO-007 : la pluie tombe dehors et s arrete aux toits ; la meteo s affiche', async function (g) {
    var s = await reset(g);
    var t = heureDe(g, 'pluie');
    A.ok(t !== null, 'une averse existe dans ce monde');
    g.time = t;
    // un toit de pierre juste au-dessus du joueur
    var bx = Math.floor(s.pos.x), by = Math.floor(s.pos.y) + 4, bz = Math.floor(s.pos.z);
    for (var dx = -3; dx <= 3; dx++) for (var dz = -3; dz <= 3; dz++) g.world.setBlock(bx + dx, by, bz + dz, B.STONE);
    /* Chaque goutte garde son « sol » (hauteur d'abri) en cache tant qu'elle
       ne change pas de colonne (render.js, animer_ — un cache par particule,
       jamais invalidé par un setBlock), lui-même dérivé d'un second cache
       (game.js, `abri()`) volontairement vidé une fois par seconde SIMULÉE
       seulement (« un bloc posé... pris en compte sans balayer chaque
       image », commentaire d'origine) : une goutte déjà en chute pile
       au-dessus de la colonne qu'on vient de couvrir continue de traverser
       le nouveau toit jusqu'à sa PROCHAINE renaissance naturelle (colonne
       changée par la dérive du vent, ou trop basse), qui n'arrive pas
       forcément dans les 40 premières images ni avant que le cache d'une
       seconde n'ait tourné. 40 images est une durée fixe qui suppose ce
       recalage déjà fait ; on attend plutôt le recalage LUI-MÊME (le vrai
       critère), avec un garde-fou généreux (400 images) au cas où une
       goutte s'attarderait plus longtemps. */
    // Le jeu promet un recalage en ~1 s simulée (cache d'abri vidé chaque
    // seconde) : au-delà de 2 s simulées, c'est un vrai défaut, et l'assertion
    // qui suit doit le signaler. Les 400 images ne sont qu'un filet si
    // l'horloge simulée n'avance plus.
    var __garde = 0, __dureeMax = g.duree + 2;
    while (__garde++ < 400 && g.duree < __dureeMax) {
      await frames(1);
      var __sysAvant = g.precipitation && g.precipitation.forme === 'neige' ? g.render.precipitations.neige : g.render.precipitations.pluie;
      if (!__sysAvant) break;
      var __encoreStale = false;
      for (var __i = 0; __i < __sysAvant.actifs; __i++) {
        if (!__sysAvant.vivant[__i]) continue;
        if (Math.abs(__sysAvant.x[__i] - (bx + 0.5)) < 3 && Math.abs(__sysAvant.z[__i] - (bz + 0.5)) < 3 &&
            __sysAvant.sol[__i] < by - 1) { __encoreStale = true; break; }
      }
      if (!__encoreStale && __garde >= 40) break;
    }
    var biome = g.world.biomeAt(bx, bz).id;
    if (g.precipitation && g.precipitation.forme) {
      var sys = g.precipitation.forme === 'neige' ? g.render.precipitations.neige : g.render.precipitations.pluie;
      A.gt(sys.actifs, 50, 'des particules tombent (' + sys.actifs + ', ' + g.precipitation.forme + ')');
      var sousToit = 0, traversent = 0;
      for (var i = 0; i < sys.actifs; i++) {
        if (Math.abs(sys.x[i] - (bx + 0.5)) < 3 && Math.abs(sys.z[i] - (bz + 0.5)) < 3) {
          sousToit++;
          if (sys.vivant[i] && sys.y[i] < by) traversent++;
        }
      }
      A.equal(traversent, 0, 'aucune goutte sous le toit (' + sousToit + ' au-dessus de lui)');
    } else {
      A.ok(['desert', 'badlands', 'volcan'].indexOf(biome) >= 0 || g.meteo.precipitation > 0,
           'pas de précipitation ici : biome sec ou averse locale absente (' + biome + ')');
    }
    A.ok(/Météo/.test(document.querySelector('.debug') ? document.querySelector('.debug').innerHTML : document.body.innerHTML),
         'la météo s affiche');
    A.ok(typeof g.audio.tonnerre === 'function' && typeof g.audio.ambiance === 'function', 'tonnerre et nappes sonores');
    for (var ex = -3; ex <= 3; ex++) for (var ez = -3; ez <= 3; ez++) g.world.setBlock(bx + ex, by, bz + ez, 0);
    g.time = 60;
    await frames(3);
  });

  e2e('SPEC-METEO-008 : un orage fait tomber des eclairs visibles', async function (g) {
    await reset(g);
    var t = heureDe(g, 'tempete') || heureDe(g, 'orage');
    A.ok(t !== null, 'un orage existe dans ce monde');
    var avant = g.eclairs || 0, vus = 0;
    // on avance l'heure à la main pour parcourir une minute d'orage sans attendre
    for (var i = 0; i < 120; i++) {
      g.time = t + i * 0.5;
      await frames(1);
      vus = Math.max(vus, g.render.eclairsVisibles);
    }
    A.gt((g.eclairs || 0) - avant, 0, 'des éclairs sont tombés : ' + ((g.eclairs || 0) - avant));
    g.time = 60;
    await frames(3);
  });

  e2e('SPEC-HABITAT-007 : les habitants d un village apparaissent et parlent selon leur metier', async function (g) {
    var s = await reset(g);
    // le village le plus proche de l'origine
    var H = MC.Habitats, v = null;
    for (var r = 0; r < 12 && !v; r++) for (var rx = -r; rx <= r && !v; rx++) for (var rz = -r; rz <= r && !v; rz++) {
      if (Math.max(Math.abs(rx), Math.abs(rz)) !== r) continue;
      v = g.world.habitats.lieuDeRegion('village', rx, rz);
    }
    A.ok(v, 'un village existe');
    s.flying = true;
    s.pos.x = v.x + 0.5; s.pos.z = v.z + 0.5; s.pos.y = v.h0 + 3;
    g.render.setDistance(5);                 // la génération forcée reste raisonnable
    g.streamChunks(true);
    // SPEC-ARCHI-024 : les habitants viennent du SERVEUR (ETAT.mobs). Sans serveur (page de test), le client
    // n'en fait plus apparaître de lui-même ; on les fait naître comme le fait server.js (peuplerLieux)
    var pnjs = [];
    for (var i = 0; i < 90; i++) {
      await frames(1);
      pnjs = pnjs.concat(g.entities.list.filter(function (e) { return e.pnj && e.lieu === v.id; }));
    }
    A.equal(pnjs.length, 0, 'le client ne fait plus apparaître d habitants de lui-même');
    MC.Habitats.pnjsManquants([v], g.entities.list, g.world.pnjsMorts, g.time).forEach(function (p) {
      g.entities.spawn('villager', p.x, p.y + 0.05, p.z, { pnj: p.id, role: p.role, nom: p.nom, foyer: { x: p.x, z: p.z }, lieu: p.lieu });
    });
    await frames(2);
    pnjs = g.entities.list.filter(function (e) { return e.pnj && e.lieu === v.id; });
    A.equal(pnjs.length, v.pnjs.length, 'ses ' + v.pnjs.length + ' habitants sont là');
    var guide = pnjs.filter(function (e) { return e.role === 'guide'; })[0];
    A.ok(guide && guide.foyer, 'le guide, attaché à son point info');
    A.equal(g.lieu && g.lieu.id, v.id, 'on sait qu on est à ' + v.nom);
    g.parlerA(guide);
    await frames(2);
    A.ok(g.ui.isContainerOpen(), 'le dialogue s ouvre');
    A.ok(/Guide/.test(document.querySelector('.inv-box h2').textContent), 'titré par son métier : ' + document.querySelector('.inv-box h2').textContent);
    A.ok(document.querySelector('.replique') && document.querySelector('.btn-service'), 'une réplique et un service');
    var avant = g.world.reperes.liste.length;
    document.querySelector('.btn-service').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await frames(2);
    A.gt(g.world.reperes.liste.length, avant, 'le guide a marqué les environs sur la carte');
    g.ui.closeContainer();
    g.input.setState('playing');
    s.flying = false;
    await reset(g);
  });

  e2e('explorer ne fait pas exploser le nombre de chunks', {
        "teste": "qu'en se déplaçant en vol sur une longue distance, les chunks trop éloignés du joueur sont bien déchargés et leur nombre total reste borné",
        "pourquoi": "sans déchargement, une longue exploration ferait fuir la mémoire indéfiniment",
        "attendu": "aucun chunk chargé au-delà de RENDER_DIST + 5, et le nombre total de chunks reste sous une borne liée à la distance de vue"
  }, async function (g) {
    var s = await reset(g);
    s.flying = true;
    s.yaw = 0;
    key('KeyW');
    for (var i = 0; i < 180; i++) await frames(1);
    key('KeyW', 'keyup');
    s.flying = false;
    // la distance de vue est adaptative : on vérifie qu'aucun chunk ne traîne au-delà de sa marge
    var R = g.render.RENDER_DIST, ccx = Math.floor(s.pos.x / 16), ccz = Math.floor(s.pos.z / 16), loin = 0;
    g.world.chunks.forEach(function (c) { if (Math.hypot(c.cx - ccx, c.cz - ccz) > R + 5) loin++; });
    A.equal(loin, 0, 'les chunks lointains sont déchargés (' + g.world.chunks.size + ' chargés, R = ' + R + ')');
    A.lt(g.world.chunks.size, Math.PI * (R + 5) * (R + 5) * 1.5, 'et leur nombre reste borné par la distance de vue');
    await reset(g);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Grille 3×3, livre des recettes et livre des objets
  // ══════════════════════════════════════════════════════════════════════════
  /* Referme proprement l'inventaire quel que soit l'etat laisse par le test. */
  async function fermerInv(g) {
    if (g.ui.isContainerOpen()) { key('KeyE'); await frames(2); }
    g.input.setState('playing');
    fakeLock(g, true);
    await frames(2);
  }

  e2e('SPEC-GRILLE-001 : la grille de craft de l inventaire fait 3x3', async function (g) {
    await reset(g);
    key('KeyE');
    await frames(3);
    A.equal(g.input.state, 'ui', 'inventaire ouvert');
    var cases = document.querySelectorAll('.inv-screen .craft-grid .slot');
    A.equal(cases.length, 9, 'neuf cases de fabrication');
    await fermerInv(g);
  });

  e2e('SPEC-GRILLE-004 : fermer l inventaire rend le contenu de la grille', async function (g) {
    var s = await reset(g);
    s.inv.add(B.PLANKS, 5);
    key('KeyE');
    await frames(3);
    // on pose deux planches dans la grille, prelevees de l'inventaire
    g.ui.container.grid[0] = { id: B.PLANKS, n: 2 };
    s.inv.remove(B.PLANKS, 2);
    A.equal(s.inv.count(B.PLANKS), 3, 'trois planches restent en poche');
    key('KeyE');
    await frames(3);
    A.equal(s.inv.count(B.PLANKS), 5, 'les cinq planches sont revenues');
    await fermerInv(g);
  });

  e2e('SPEC-LIVRE-005 : L ouvre le livre, recettes faisables en tete', async function (g) {
    var s = await reset(g);
    s.inv.add(B.LOG, 4);
    key('KeyL');
    await frames(3);
    A.equal(g.input.state, 'ui', 'le livre ouvre aussi l inventaire');
    var pan = document.querySelector('.inv-screen .livre');
    A.ok(pan, 'panneau du livre affiche');
    A.equal(pan.querySelector('h3').textContent, 'Livre des recettes', 'variante survie');
    var lignes = pan.querySelectorAll('.livre-liste .rec');
    A.gt(lignes.length, 10, 'toutes les recettes sont listees');
    A.ok(lignes[0].classList.contains('ok'), 'la premiere est realisable');
    await fermerInv(g);
  });

  e2e('SPEC-LIVRE-004 : un ingredient manquant est signale dans le livre', async function (g) {
    await reset(g);
    key('KeyL');
    await frames(3);
    var pan = document.querySelector('.inv-screen .livre');
    A.equal(pan.querySelectorAll('.livre-liste .rec.ok').length, 0,
            'les mains vides, rien n est realisable');
    A.gt(pan.querySelectorAll('.livre-liste .rec-i .slot.ko').length, 10,
         'les ingredients manquants sont marques');
    await fermerInv(g);
  });

  e2e('SPEC-LIVRE-006 : la recherche restreint le livre sans fermer l inventaire',
      async function (g) {
    await reset(g);
    key('KeyL');
    await frames(3);
    var pan = document.querySelector('.inv-screen .livre');
    var total = pan.querySelectorAll('.livre-liste .rec').length;
    var champ = pan.querySelector('.livre-rech');
    champ.value = 'pioche';
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    await frames(2);
    var apres = pan.querySelectorAll('.livre-liste .rec').length;
    // autant d'entrées que de recettes de pioche (bois, pierre, fer, diamant)
    var recettesPioche = MC.Inventory.RECIPES.filter(function (r) {
      var d = C.ITEMS[r.out]; return d && d.tool === 'pickaxe';
    }).length;
    A.equal(apres, recettesPioche, 'toutes les pioches');
    A.lt(apres, total, 'la liste est bien restreinte');
    /* Taper « e » dans la recherche ne doit pas refermer l'inventaire : le
       champ absorbe les touches du jeu. */
    champ.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e', bubbles: true }));
    await frames(2);
    A.equal(g.input.state, 'ui', 'l inventaire est toujours ouvert');
    await fermerInv(g);
  });

  e2e('SPEC-LIVRE-007 : cliquer une recette la pose dans la grille', async function (g) {
    var s = await reset(g);
    s.inv.add(B.PLANKS, 3); s.inv.add(I.STICK, 2);
    key('KeyL');
    await frames(3);
    var pan = document.querySelector('.inv-screen .livre');
    var cible = null;
    Array.prototype.forEach.call(pan.querySelectorAll('.livre-liste .rec.ok'), function (r) {
      if (!cible && r.querySelector('.rec-n').textContent.indexOf('Pioche') === 0) cible = r;
    });
    A.ok(cible, 'la pioche est realisable');
    cible.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await frames(3);
    A.equal(g.ui.container.result && g.ui.container.result.id, I.WOOD_PICKAXE,
            'la grille produit une pioche en bois');
    A.equal(s.inv.count(B.PLANKS), 0, 'les planches ont ete prelevees');
    A.equal(s.inv.count(I.STICK), 0, 'les batons aussi');
    await fermerInv(g);
  });

  e2e('SPEC-LIVRE-012 / SPEC-LIVRE-010 : en creatif le livre donne les objets',
      async function (g) {
    var reglesAvant = g.regles;
    var s = await reset(g);
    g.ui.setRegles(MC.Modes.regles('creatif', 'facile'));
    key('KeyL');
    await frames(3);
    var pan = document.querySelector('.inv-screen .livre');
    A.equal(pan.querySelector('h3').textContent, 'Livre des objets', 'variante creatif');
    A.equal(pan.querySelectorAll('.livre-liste .rec').length, 0, 'pas de recettes ici');
    var champ = pan.querySelector('.livre-rech');
    champ.value = 'Pioche en fer';
    champ.dispatchEvent(new Event('input', { bubbles: true }));
    await frames(2);
    var lignes = pan.querySelectorAll('.livre-liste .obj');
    A.equal(lignes.length, 1, 'une seule entree');
    lignes[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await frames(3);
    A.equal(s.inv.count(I.IRON_PICKAXE), 1, 'la pioche en fer est arrivee sans craft');
    await fermerInv(g);
    g.ui.setRegles(reglesAvant);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Monde : streaming, donjons
  // ══════════════════════════════════════════════════════════════════════════
  e2e('SPEC-TERRAIN-004 : en ecran partage, le sol suit le joueur 2 qui s eloigne',
      async function (g) {
    await reset(g);
    fausseManette([{ axes: [0, 0, 0, 0] }]);
    g.composerEquipe(2, MC.Modes.regles('creatif', 'facile'));
    await frames(3);
    var st = g.equipe[1].player.state;
    st.flying = true;
    st.pos.x += 400; st.pos.y = C.WORLD_H - 4; st.vel.x = st.vel.y = st.vel.z = 0;
    // la génération est budgétée : on laisse le streaming rattraper
    for (var i = 0; i < 40 && !g.world.estCharge(st.pos.x, st.pos.z); i++) await frames(5);
    A.ok(g.world.estCharge(st.pos.x, st.pos.z), 'le chunk sous le joueur 2 est chargé');
    A.ok(g.world.estCharge(g.player.state.pos.x, g.player.state.pos.z), 'celui du joueur 1 aussi');
    soloRetabli(g); await frames(3);
  });

  /* Maillages de terrain présents dans la scène sans appartenir à un chunk du
     monde courant : ce sont les « blocs fantômes » d'une partie précédente. */
  function maillagesOrphelins(g) {
    var siens = new Set();
    g.world.chunks.forEach(function (c) {
      g.render.PASSES.forEach(function (p) { if (c[p[0]]) siens.add(c[p[0]]); });
    });
    var m0 = g.render.materials;
    var mats = [m0.opaque, m0.cutout, m0.blend, m0.lumineux];
    return g.render.scene.children.filter(function (o) {
      return o.isMesh && mats.indexOf(o.material) >= 0 && !siens.has(o);
    }).length;
  }

  e2e('SPEC-TERRAIN-007 : changer de partie ne laisse aucun bloc fantome de l ancien monde',
      async function (g) {
    await reset(g);
    A.equal(maillagesOrphelins(g), 0, 'départ propre');
    videParties(); g.afficherMenu(); await frames(2);
    document.querySelector('#btn-nouvelle').click(); await frames(2);
    document.querySelector('#f-nom').value = 'Fantomes';
    document.querySelector('#btn-creer').click();
    await frames(8);
    A.equal(maillagesOrphelins(g), 0, 'après création : aucun maillage de l ancienne graine');
    var m = MC.Saves.creer(localStorage, { nom: 'Autre carte', graine: 777 });
    g.afficherMenu(); await frames(2);
    document.querySelector('.charger[data-id="' + m.id + '"]').click();
    await frames(8);
    A.equal(g.world.seed, 777, 'la partie chargée a sa graine');
    A.equal(maillagesOrphelins(g), 0, 'après chargement non plus');
    videParties();
    await reset(g);
  });

  e2e('SPEC-DONJON-004 / SPEC-DONJON-006 : entrer dans un donjon eveille son gardien',
      async function (g) {
    var s = await reset(g);
    var l = g.world.donjons.dansZone(s.pos.x - 900, s.pos.z - 900, s.pos.x + 900, s.pos.z + 900)
      .filter(function (x) { return x.type === 'crypte'; });
    var d = l[0];
    A.ok(d, 'un donjon à proximité');
    g.world.donjonsVaincus.delete(d.id);
    // la salle du gardien : le vestibule d'un petit donjon, la plus profonde d'un moyen ou d'un grand
    s.pos.x = d.spawn.x + 1; s.pos.y = d.spawn.y; s.pos.z = d.spawn.z;
    s.vel.x = s.vel.y = s.vel.z = 0;
    // une téléportation n'est pas une chute : sans cela, le joueur encore en
    // l'air au point d'apparition « tombe » de 40 blocs et meurt en arrivant
    s.fallFrom = null; s.onGround = true;
    g.streamChunks(true);
    await frames(4);
    var bossDe = function () { return g.entities.list.filter(function (e) { return e.donjon === d.id && MC.EntitySpecs[e.type].boss; }); };
    // SPEC-ARCHI-034 : l'éveil du gardien est l'affaire du serveur (tests/integration-archi-env.js) ;
    // le client, lui, n'invoque plus rien — on éveille donc le gardien comme le fait server.js
    A.equal(bossDe().length, 0, 'le client n éveille plus de gardien de lui-même');
    A.ok(g.entities.invoquerGardien(d), 'le serveur éveille le gardien');
    await frames(3);
    var boss = bossDe();
    A.equal(boss.length, 1, 'le gardien est éveillé (état : ' + g.input.state + ')');
    var barre = document.querySelector('.barre-boss');
    A.ok(barre && barre.style.display !== 'none', 'sa barre de vie s affiche');
    A.ok(barre.textContent.indexOf(MC.EntitySpecs[boss[0].type].nom) >= 0, 'avec son nom');
    s.hp = 20;
    g.entities.damage(boss[0], 9999);
    await frames(3);
    A.ok(g.world.donjonsVaincus.has(d.id), 'la victoire est mémorisée');
    A.equal(barre.style.display, 'none', 'la barre disparaît');
    // parti puis revenu : il ne se relève pas
    g.entities.list.length = 0;
    await frames(3);
    A.equal(g.entities.list.filter(function (e) { return e.donjon === d.id && MC.EntitySpecs[e.type] &&
      MC.EntitySpecs[e.type].boss; }).length, 0, 'pas de second gardien');
    // le butin du coffre de donjon est tiré par le SERVEUR (SPEC-ARCHI-030) : le client n'en tire plus rien
    A.equal(typeof g.coffreDe, 'undefined', 'le client ne tire plus le butin d un coffre lui-même');
    g.entities.list.length = 0;
    g.world.coffresPilles.clear();
    g.world.donjonsVaincus.clear();
    await reset(g);
  });

  /* Une piste plate et dégagée (3 de large, `longueur` de long) devant le joueur, au niveau de
     ses pieds : les blocs manquants se POSENT et les obstacles se CASSENT par le serveur (BLOC),
     quel que soit le relief du point d'apparition. Rend le nombre de cases encore fautives. */
  async function aplanirPiste(g, cap, longueur) {
    var s = g.player.state, W = g.world, sup = Math.floor(s.pos.y - 0.05);
    var fx = Math.round(-Math.sin(cap)), fz = Math.round(-Math.cos(cap)), lx = -fz, lz = fx;
    var px = Math.floor(s.pos.x), pz = Math.floor(s.pos.z), cases = [];
    for (var i = 0; i <= longueur; i++) for (var l = -1; l <= 1; l++) cases.push([px + fx * i + lx * l, pz + fz * i + lz * l]);
    cases.forEach(function (c) { W.getChunk(Math.floor(c[0] / 16), Math.floor(c[1] / 16), true); });
    for (var k = 0; k < cases.length; k++) {
      var x = cases[k][0], z = cases[k][1];
      if (W.getBlock(x, sup, z) === 0 || MC.Core.isWater(W.getBlock(x, sup, z))) { g.net.poserBloc(x, sup, z, B.STONE); await wait(12); }
      for (var h = 1; h <= 3; h++) if (W.getBlock(x, sup + h, z) !== 0) { g.net.poserBloc(x, sup + h, z, 0); await wait(12); }
    }
    var fautives = cases.length;
    for (var t = 0; t < 50 && fautives; t++) {
      fautives = cases.filter(function (c) {
        return W.getBlock(c[0], sup, c[1]) === 0 || [1, 2, 3].some(function (h) { return W.getBlock(c[0], sup + h, c[1]) !== 0; });
      }).length;
      if (fautives) await wait(100);
    }
    return fautives;
  }

  e2e('SPEC-VEHIC-006 / SPEC-VEHIC-002 / SPEC-ARCHI-021 : poser, monter, rouler au clavier et descendre avec F — sur le serveur', {
        "teste": "qu'un véhicule se pose, se monte, se conduit au clavier et se quitte par le serveur local : la voiture posée vient du serveur (réplique de net.mobsDistants), le joueur y monte à la réponse du serveur, la prédiction la conduit au clavier sans s'écarter de l'état du serveur, et F fait descendre",
        "pourquoi": "les véhicules n'existent plus que dans le serveur (solo fermé, écran partagé et réseau : un seul chemin) ; une conduite simulée par la page elle-même ne prouverait plus rien",
        "attendu": "la voiture apparaît dans net.mobsDistants, s.monture devient cette réplique, elle avance de plusieurs blocs sans correction du serveur de plus d'un bloc, le conducteur la suit, le HUD affiche des km/h, F remet le joueur à pied à côté de l'engin"
  }, async function (g) {
    A.ok(await serveurPresent(), 'le serveur de jeu sert la page (sans lui ce test ne prouve rien : échec explicite, pas un faux vert)');
    await reset(g);
    g.rejoindreServeur({ pseudo: 'Pilote' + Date.now() % 100000, joueurs: 1 });
    for (var t = 0; t < 40 && g.net.etat !== 'en ligne'; t++) await wait(100);
    A.equal(g.net.etat, 'en ligne', 'connecté au serveur');
    await wait(500);
    var s = g.player.state;
    // une piste plate et dégagée devant le joueur, bâtie par le serveur ; il apprend le cap par les entrées
    s.yaw = 0;
    await frames(15);
    A.equal(await aplanirPiste(g, 0, 5), 0, 'la piste est plate et dégagée (blocs posés et cassés par le serveur)');
    var sol = Math.floor(s.pos.y - 0.05);
    var cible = { x: Math.floor(s.pos.x), y: sol, z: Math.floor(s.pos.z), nx: 0, ny: 1, nz: 0 };
    A.ok(g.world.getBlock(cible.x, cible.y, cible.z) !== 0, 'le bloc visé est plein');
    g.poserVehicule(g.player, 'voiture', cible, 0);
    var auto = null;
    for (var u = 0; u < 40 && !auto; u++) {
      await wait(100);
      g.net.mobsDistants.forEach(function (m) { if (m.vehicule === 'voiture') auto = m; });
    }
    A.ok(auto, 'la voiture posée vient du serveur (réplique dans net.mobsDistants)');
    if (!auto) { g.net.deconnecter(); await wait(300); return; }
    A.ok(g.monterDans(auto), 'la demande de montée part');
    for (var v = 0; v < 40 && s.monture !== auto; v++) await wait(100);
    A.equal(s.monture, auto, 'le serveur accepte : le joueur est au volant de la réplique');
    A.ok(auto.predit, 'la réplique est prédite (plus interpolée)');
    var x0 = auto.pos.x, z0 = auto.pos.z;
    key('KeyW');
    // 7 m/s² d'accélération : une seconde de temps SIMULÉ (g.duree) donne plus de trois
    // blocs. On attend ce temps simulé, pas un nombre fixe d'images réelles
    // (le clamp dt, SPEC-BANC-010, rend les images réelles peu fiables comme horloge).
    var dureeCible = g.duree + 1.0, garde = 0;
    while (g.duree < dureeCible && garde++ < 600) await frames(1);
    key('KeyW', 'keyup');
    var parcouru = Math.hypot(auto.pos.x - x0, auto.pos.z - z0);
    A.ok(parcouru > 2, 'la voiture a avancé (' + parcouru.toFixed(1) + ' blocs)');
    A.ok(Math.abs(s.pos.x - auto.pos.x) < 0.01 && Math.abs(s.pos.z - auto.pos.z) < 0.01, 'le conducteur a suivi');
    A.ok(g.ecartReseau < 1, 'la prédiction colle au serveur (dernière correction : ' + (g.ecartReseau || 0).toFixed(3) + ' bloc)');
    var hud = document.querySelector('.debug') || document.body;
    A.ok(/km\/h/.test(hud.textContent || document.body.textContent), 'le HUD affiche la vitesse');
    key('KeyF');
    for (var w = 0; w < 40 && s.monture; w++) await wait(100);
    A.notOk(s.monture, 'F : pied à terre (le serveur a fait descendre)');
    A.notOk(auto.predit, 'et la voiture est de nouveau suivie d après le relevé du serveur');
    A.notOk(P.collides(g.world, s.pos.x, s.pos.y, s.pos.z, 0.6, 1.8), 'à côté de la voiture, pas dedans');
    g.net.deconnecter();
    await wait(300);
  });

  e2e('SPEC-HUD-001 / SPEC-HUD-003 : une bascule masque .debug seul, F1 masque puis rétablit tout le HUD', async function (g) {
    await reset(g);
    var debug = document.querySelector('.debug');
    var hotbar = document.querySelector('.hotbar');
    A.notOk(debug.classList.contains('hud-masque'), 'les infos sont visibles au départ');
    A.notOk(hotbar.classList.contains('hud-masque'), 'la barre d objets aussi');

    // bascule d'un seul composant : les autres ne bougent pas
    g.hud.basculer('infos');
    g.ui.appliquerHud();
    A.ok(debug.classList.contains('hud-masque'), 'les infos se masquent seules');
    A.notOk(hotbar.classList.contains('hud-masque'), 'la barre d objets reste visible');
    g.hud.basculer('infos');
    g.ui.appliquerHud();
    A.notOk(debug.classList.contains('hud-masque'), 'et se rétablissent');

    // F1 : bascule générale, tout le HUD à la fois
    key('F1');
    await frames(2);
    A.ok(debug.classList.contains('hud-masque'), 'F1 masque les infos');
    A.ok(hotbar.classList.contains('hud-masque'), 'F1 masque aussi la barre d objets');
    key('F1');
    await frames(2);
    A.notOk(debug.classList.contains('hud-masque'), 'F1 rétablit les infos');
    A.notOk(hotbar.classList.contains('hud-masque'), 'et la barre d objets');
  });

  e2e('SPEC-HUD-002 / SPEC-HUD-008 : les infos donnent graine et cap cardinal, T rouvre le chat même masqué', async function (g) {
    var s = await reset(g);
    var debug = document.querySelector('.debug');
    await frames(2);
    A.ok(new RegExp('Graine <b>' + g.world.seed).test(debug.innerHTML), 'la graine figure dans les infos');
    A.ok(/\b(N|NE|E|SE|S|SO|O|NO)\b/.test(debug.textContent), 'un point cardinal figure dans les infos');

    // le chat est masqué (bascule individuelle) : T doit quand même l'ouvrir
    g.hud.regler('chat', false);
    g.ui.appliquerHud();
    var chatBox = document.querySelector('.chat');
    A.ok(chatBox.classList.contains('hud-masque'), 'le chat est masqué au départ');
    key('KeyT');
    await frames(2);
    A.ok(g.chat.enSaisie, 'la saisie est ouverte');
    A.notOk(chatBox.classList.contains('hud-masque'), 'T a rouvert le chat malgré le masquage');
    g.chat.annuler();
    g.input.setSaisie(false);
    g.hud.regler('chat', true);
    g.ui.appliquerHud();
    await reset(g);
  });

  e2e('SPEC-EAU-008 : la surface de l eau deforme ce qu on voit a travers elle, dessus comme dessous', async function (g) {
    var s = await reset(g);
    /* L'adaptation de qualité (SPEC-RENDU-005) coupe la réfraction sous 30 FPS et ne la
       rend qu'au-dessus de 50 : les tests lourds qui précèdent (serveur réel) peuvent
       l'avoir laissée coupée. On repart du palier plein — ce test porte sur la réfraction, pas sur la charge. */
    g.reinitialiserQualite();
    // la mer la plus proche : une colonne d'eau profonde autour du point de départ
    var cible = null;
    for (var r = 0; r < 400 && !cible; r += 4) for (var a2 = 0; a2 < 12 && !cible; a2++) {
      var x = Math.round(Math.cos(a2 / 12 * 6.283) * r), z = Math.round(Math.sin(a2 / 12 * 6.283) * r);
      var col = g.world.bio.colonne(x, z);
      if (col.eau - col.h >= 4) cible = { x: x, z: z, eau: col.eau };
    }
    A.ok(cible, 'une mer existe près du départ');
    s.flying = true;
    s.pos.x = cible.x + 0.5; s.pos.z = cible.z + 0.5; s.pos.y = cible.eau + 6; s.pitch = -0.9;
    g.render.setDistance(5);
    g.streamChunks(true);
    for (var i = 0; i < 30; i++) await frames(1);
    A.gt(g.render.eau.enVue, 0, 'de l eau dans le champ');
    A.equal(g.render.eau.refraction.value, 1, 'au-dessus : la passe de réfraction relit le fond en le déformant');
    // plongée
    s.pos.y = cible.eau - 2;
    for (var j = 0; j < 20; j++) await frames(1);
    A.ok(g.render.eau.sousLEau, 'sous l eau : tout le champ passe par le calque qui ondule');
    s.flying = false;
    await reset(g);
  });

  e2e('SPEC-SYNC-024 : J affiche les relations de faction reçues du serveur, sans casser sur un type inconnu',
      async function (g) {
    await reset(g);
    var P = MC.Politique, pol = P.creer(7);
    P.decouvrir(pol, [{ id: 'v1', kind: 'megapole', x: 0, z: 0, nom: 'Alpha' }, { id: 'v2', kind: 'megapole', x: 300, z: 0, nom: 'Beta' }]);
    pol.relations.set('royaume:v1~royaume:v2', 'guerre');
    pol.factions.set('mystere:x', { id: 'mystere:x', type: 'mystere', nom: 'Inconnue', caractere: '?', objectif: '?' });
    var gu = MC.Guildes.creerEtat();
    MC.Guildes.appliquerAction(gu, 'Pseudo-du-serveur', { type: 'faction', action: 'creer', args: { nom: 'Lions' } });
    var fid = MC.Guildes.factionsDe(gu, 'Pseudo-du-serveur').principale;
    MC.Guildes.appliquerAction(gu, 'Pseudo-du-serveur', { type: 'faction', action: 'relation', args: { faction: fid, cible: 'royaume:v1', relation: 'ennemie' } }, pol);
    // ce que game.js garde après un POLITIQUE complet ; le pseudo local diffère du nom connu du serveur
    g.etatPolitique = { etat: P.appliquerReseau(null, P.instantaneReseau(pol)), guildes: MC.Guildes.serialiser(gu), moi: 'Pseudo-du-serveur' };
    var nomAvant = g.nomJoueur; g.nomJoueur = 'Pseudo-du-serveur-mais-tronque';
    key('KeyJ');
    await frames(2);
    var panneau = document.querySelector('.factions-panneau');
    A.ok(panneau && panneau.style.display !== 'none', 'J ouvre le panneau des factions');
    A.ok(/Alpha/.test(panneau.textContent) && /En guerre avec[^·]*Beta/.test(panneau.textContent), 'les relations PNJ↔PNJ sont affichées');
    A.ok(/Inconnue/.test(panneau.textContent), 'une faction de type inconnu s\'affiche sans casser le panneau');
    A.ok(/Lions/.test(panneau.textContent) && /Ennemie de [^·]*Alpha/.test(panneau.textContent), 'la faction du joueur (nom connu du serveur) et sa relation envers un PNJ');
    key('KeyJ');
    await frames(2);
    g.nomJoueur = nomAvant; g.etatPolitique = null;
  });

  e2e('SPEC-SUCCES-001 : casser un bloc débloque « Premier bloc » (décidé par le serveur, toast) et K ouvre le panneau des succès',
      async function (g) {
    if (!(await serveurPresent())) { A.ok(true, 'serveur absent : test ignore'); return; }
    var s = await reset(g);
    g.succes = MC.Succes.creer();          // miroir vierge ; le serveur (SPEC-ARCHI-042) décide des succès
    /* Le solo passe par le serveur : on se connecte, on prend un bloc RÉEL du
       monde serveur (celui sous le joueur une fois BIENVENUE reçue), on le casse
       par BLOC, et on attend par sondage le déblocage annoncé par le serveur. */
    g.net.connecter('', 'Poseur', 1);
    await sonderE2E(function () { return g.net.etat === 'en ligne'; }, 15000);
    A.equal(g.net.etat, 'en ligne', 'connecte au serveur');
    var cible = null;
    await sonderE2E(function () {
      var p = g.player.state.pos, x = Math.floor(p.x), z = Math.floor(p.z);
      for (var y = Math.floor(p.y) - 1; y >= Math.floor(p.y) - 3; y--) {
        var id = g.world.getBlock(x, y, z);
        if (id && C.BLOCKS[id] && C.BLOCKS[id].hardness >= 0 && id !== B.WATER) { cible = { x: x, y: y, z: z }; return true; }
      }
      return false;
    }, 15000);
    A.ok(cible, 'un bloc réel du monde serveur est sous le joueur');
    g.net.poserBloc(cible.x, cible.y, cible.z, 0, 0, 0);
    await sonderE2E(function () { return g.succes.estDebloque('premier_bloc'); }, 15000);
    A.ok(g.succes.estDebloque('premier_bloc'), 'le serveur a débloqué « premier bloc » (miroir du client)');
    await sonderE2E(function () {
      return Array.prototype.some.call(document.querySelectorAll('.toasts .toast'), function (el) { return /Premier bloc/.test(el.textContent); });
    }, 5000);
    var toastVisible = Array.prototype.some.call(document.querySelectorAll('.toasts .toast'),
      function (el) { return /Premier bloc/.test(el.textContent); });
    A.ok(toastVisible, 'un toast « Premier bloc » est affiché');

    key('KeyK');
    await frames(2);
    var panneau = document.querySelector('.succes-panneau');
    A.ok(panneau && panneau.style.display !== 'none', 'K ouvre le panneau des succès');
    A.ok(/Premier bloc/.test(panneau.textContent), 'le panneau liste « Premier bloc »');
    key('KeyK');
    await frames(2);
    A.equal(panneau.style.display, 'none', 'un second K referme le panneau');
    g.net.deconnecter();
    await wait(300);
  });

  e2e('SPEC-NUAGE-003 : le ciel rend la spirale d un cyclone, l entonnoir d une tornade et ses effets, la brume des creux', async function (g) {
    await reset(g);
    var me = g.world.meteo, cyc0 = me.cyclones, tor0 = me.tornades, pou0 = me.pousseeTornade, bru0 = me.brume;
    var p = g.player.state.pos;
    try {
      // chaque couche dérive avec le vent de son altitude (SPEC-VENT-001)
      g.time = 3000; await frames(2);
      var dc = g.render.formations.derivesCouches;
      A.ok(dc[0].value.distanceTo(dc[4].value) > 1, 'stratus et cirrus ne dérivent pas ensemble');
      // un cyclone tout proche : sa spirale passe au shader
      me.cyclones = function () { return [{ id: 'c', x: p.x + 300, z: p.z, rayon: 900, oeil: 60, force: 0.9, sens: 1 }]; };
      await frames(2);
      A.close(g.render.formations.cyclones.value[0].z, 900, 0.01, 'le rayon');
      A.close(g.render.formations.forcesCyclones.value.x, 0.9, 0.01, 'la force');
      // une tornade : l'entonnoir se dresse ; la poussée et l'arrachage sont l'affaire du serveur (SPEC-ARCHI-022) :
      // le client ne déplace plus le joueur, même si une poussée lui était calculable
      me.tornades = function () { return [{ id: 't', x: p.x + 6, z: p.z, rayon: 12, force: 1, vie: 20, sens: 1 }]; };
      // (une poussée forte, que l'ancien client aurait appliquée)
      me.pousseeTornade = function (x, y, z) { return { x: (p.x + 6 - x) * 2, y: 10, z: 0 }; };
      await frames(3);
      var tm = g.render.formations.tornades[0];
      A.ok(tm && tm.visible, 'un entonnoir visible');
      A.close(tm.position.x, p.x + 6, 0.5, 'à sa place');
      A.gt(tm.scale.y, 15, 'du sol aux nuages');
      var x0 = p.x;
      for (var i = 0; i < 20; i++) await frames(1);
      A.ok(Math.abs(p.x - x0) < 0.3 && p.y < g.world.heightAt(Math.floor(p.x), Math.floor(p.z)) + 1.5, 'le client n emporte plus le joueur (le serveur seul le pousse)');
      me.tornades = function () { return []; };
      await frames(2);
      A.ok(!tm.visible, 'et l entonnoir se dissipe');
      // brume (SPEC-VENT-003)
      me.brume = function () { return 0.8; };
      await frames(3);
      A.ok(g.render.formations.brume.every(function (m) { return m.visible; }), 'les nappes de brume se posent');
      A.close(g.brume, 0.8, 0.001);
      me.brume = function () { return 0; };
      await frames(2);
      A.ok(g.render.formations.brume.every(function (m) { return !m.visible; }), 'et se lèvent');
    } finally {
      me.cyclones = cyc0; me.tornades = tor0; me.pousseeTornade = pou0; me.brume = bru0;
      g.time = 60;
      await reset(g);
    }
  });

  e2e('SPEC-MOB-010 : les créatures ont des membres animés, un regard, et une silhouette simple au loin', async function (g) {
    await reset(g);
    var p = g.player.state.pos;
    var z = g.entities.spawn('zombie', p.x + 3, p.y, p.z);
    var v = g.entities.spawn('villager', p.x - 3, p.y, p.z, { role: 'forgeron', pnj: 'e2e-forgeron' });
    try {
      await frames(3);
      var mz = g.render.entityMeshes.get(z.eid), mv = g.render.entityMeshes.get(v.eid);
      A.ok(mz && mz.userData.membres, 'le zombie a des membres articulés');
      A.ok(mv && mv.userData.membres && mv.userData.membres.tete, 'l habitant aussi, et une tête');
      // une entité simulée pilote le maillage du zombie : marche, coup, regard, distance
      var fe = { pos: { x: mz.position.x, y: mz.position.y, z: mz.position.z }, vel: { x: 2, y: 0, z: 0 }, yaw: 0, age: 0 };
      var angles = [];
      for (var i = 0; i < 12; i++) { fe.age += 0.05; g.render.animerMembres(mz, fe, 0.05, 'essai'); angles.push(mz.userData.membres.jambeG.rotation.x); }
      A.gt(Math.max.apply(null, angles) - Math.min.apply(null, angles), 0.2, 'les jambes bougent en marchant');
      fe.vel.x = 0; fe.coupA = fe.age; fe.age += 0.18;
      g.render.animerMembres(mz, fe, 0.05, 'essai');
      A.lt(mz.userData.membres.brasD.rotation.x, -1, 'le bras se lève pour frapper');
      fe.coupA = undefined; fe.vise = { x: fe.pos.x - 8, y: fe.pos.y + 1.6, z: fe.pos.z };
      g.render.animerMembres(mz, fe, 0.05, 'essai');
      A.close(mz.userData.membres.tete.rotation.y, 1.2, 0.01, 'la tête se tourne vers la cible (bornée)');
      fe.pos.x += 90; mz.position.x += 90;
      A.equal(g.render.animerMembres(mz, fe, 0.05, 'essai'), 'simple');
      A.ok(!mz.userData.detail.visible && mz.userData.simple.visible, 'au loin, un modèle simplifié');
      // l'habitant forgeron porte son tablier : un accessoire de plus que son voisin
      A.equal(MC.Apparence.variante('villager', 'e2e-forgeron', 'forgeron').accessoire, 'tablier');
    } finally {
      g.entities.list.splice(g.entities.list.indexOf(z), 1);
      g.entities.list.splice(g.entities.list.indexOf(v), 1);
      await frames(2);
    }
  });

  e2e('SPEC-RELIEF-011 / SPEC-ARCHI-023 : un panache monte du cratère, dérive au vent, rougeoie en éruption ; aucune bombe n est créée par le client', async function (g) {
    await reset(g);
    var p = g.player.state.pos, bio = g.world.bio, dz0 = bio.volcansDansZone;
    var faux = { x: Math.floor(p.x) + 40, z: Math.floor(p.z), sommet: Math.floor(p.y) + 20, R: 30, cratere: 6, actif: true };
    try {
      bio.volcansDansZone = function () { return [faux]; };
      await frames(3);
      var m = g.render.panaches[0];
      A.ok(m && m.visible, 'un panache au-dessus du cratère');
      var pos = m.geometry.attributes.position.array, haut = -1e9;
      for (var i = 1; i < pos.length; i += 3) haut = Math.max(haut, pos[i]);
      A.gt(haut, faux.sommet + 30, 'il monte haut');
      // en éruption : panache épais et rougeoyant ; les bombes et les coulées sont SUPPRIMÉES (SPEC-ARCHI-023) :
      // même si le module en calcule, le client n en crée plus aucune et ne pose aucune lave
      var a0 = MC.Volcanisme.activite;
      MC.Volcanisme.activite = function () { return { fumee: 1, grondement: false, eruption: { debut: 0, fin: 1e9 }, prochaine: null }; };
      var p0 = MC.Volcanisme.projectiles;
      MC.Volcanisme.projectiles = function () { return [{ t: 0, x: faux.x, y: faux.sommet + 2, z: faux.z, vx: 2, vy: 20, vz: 0 }]; };
      await frames(3);
      A.equal(m.material.color.getHex(), 0x8a4a30, 'rougeoyant');
      A.notOk(g.entities.list.some(function (e) { return e.type === 'arrow' && e.genre === 'bombe'; }), 'aucune bombe volcanique côté client');
      MC.Volcanisme.activite = a0; MC.Volcanisme.projectiles = p0;
    } finally {
      bio.volcansDansZone = dz0;
      for (var j = g.entities.list.length - 1; j >= 0; j--) if (g.entities.list[j].genre === 'bombe') g.entities.list.splice(j, 1);
      await frames(2);
    }
  });

  e2e('SPEC-ARCHI-034 : le client n appelle plus world.tick avec eau, circuits, cultures ni feu, et ne fait apparaître aucune créature (600 images)', async function (g) {
    await reset(g);
    var w = g.world, tick0 = w.tick, appels = 0, actifs = 0, spawns = 0;
    var noms = ['spawn', 'trySpawn', 'trySpawnSouterrain', 'invoquerGardien', 'invoquerGardes'], origs = {};
    w.tick = function (dt, st, r, opts) {
      appels++;
      if (!opts || opts.eau !== false || opts.circuits !== false || opts.cultures !== false || opts.feu !== false) actifs++;
      return tick0.apply(w, arguments);
    };
    noms.forEach(function (n) { origs[n] = g.entities[n]; g.entities[n] = function () { spawns++; return origs[n].apply(g.entities, arguments); }; });
    try {
      for (var i = 0; i < 600; i++) await frames(1);
      A.gt(appels, 100, 'le tic du monde tourne bien (' + appels + ' appels)');
      A.equal(actifs, 0, 'aucun appel de world.tick avec eau, circuits, cultures ou feu actifs');
      A.equal(spawns, 0, 'aucune apparition de créature côté client');
    } finally {
      w.tick = tick0;
      noms.forEach(function (n) { g.entities[n] = origs[n]; });
      await reset(g);
    }
  });

  e2e('SPEC-ROUTE-006 : les convois se montrent et s animent, puis disparaissent au loin', async function (g) {
    await reset(g);
    var p = g.player.state.pos;
    A.ok(Array.isArray(g.convois), 'le jeu calcule les convois proches');
    // le temps du test, le jeu ne recalcule pas ses propres convois
    var routes0 = g.world.routes; g.world.routes = null;
    try {
    var liste = [{ id: 'e2e:0', type: 'villager', role: 'marchand_ambulant', x: p.x + 4, y: p.y, z: p.z, yaw: 0 },
                 { id: 'e2e:1', type: 'goat', role: 'bat', x: p.x + 4, y: p.y, z: p.z + 2.2, yaw: 0 },
                 { id: 'e2e:b', type: 'bateau', role: 'batelier', x: p.x + 8, y: p.y, z: p.z, yaw: 0 }];
    A.equal(g.render.syncFigurants(liste), 3, 'trois figurants');
    var m = g.render.figurants.get('e2e:0');
    A.ok(m && m.userData.membres, 'le marchand a ses membres');
    A.ok(g.render.figurants.get('e2e:b').children.length > 0, 'le bateau a sa coque');
    // il avance : ses jambes bougent
    var angles = [];
    for (var i = 0; i < 10; i++) { liste[0].z += 0.1; g.render.syncFigurants(liste); angles.push(m.userData.membres.jambeG.rotation.x); await frames(1); }
    A.gt(Math.max.apply(null, angles) - Math.min.apply(null, angles), 0.05, 'il marche');
    A.equal(g.render.syncFigurants([]), 0, 'et disparaît');
    } finally { g.world.routes = routes0; }
  });

  e2e('SPEC-ZONE-003 : la zone courante s affiche, l entrée dans une autre zone s annonce, le composant se masque', async function (g) {
    await reset(g);
    var ind = document.querySelector('.zone-indicateur');
    await frames(3);
    A.ok(ind && ind.style.display !== 'none' && ind.textContent.length > 0, 'la zone courante au HUD : ' + (ind && ind.textContent));
    var z0 = g.world.zoneEn;
    try {
      g.world.zoneEn = function () { return { zone: 'pvp' }; };
      // On attend le changement de l'INDICATEUR (mis à jour au même tick que
      // l'annonce, dans annoncerZone) plutôt qu'un texte "PvP" n'importe où
      // dans la page : sur le banc, le panneau de sélection des tests affiche
      // en permanence des libellés de spec contenant "PvP" (ex. « SPEC-ZONE —
      // zones de jeu (PvP/PvE... ) »), qui font croire à tort que l'annonce
      // est déjà là avant même que la boucle attende une seule image.
      for (var i = 0; i < 40 && !/zone-pvp/.test(ind.className); i++) await frames(1);
      var toasts = document.querySelector('.toasts');
      A.ok(toasts && /Vous entrez en zone PvP/.test(toasts.textContent), 'l entrée est annoncée');
      A.ok(/zone-pvp/.test(ind.className), 'l indicateur change');
      g.hud.regler('zone', false); g.ui.appliquerHud(); await frames(1);
      A.ok(getComputedStyle(ind).display === 'none', 'masquable comme les autres composants');
      g.hud.regler('zone', true); g.ui.appliquerHud();
    } finally {
      g.world.zoneEn = z0;
      await frames(3);
    }
  });

  e2e('SPEC-VUE-005 : une perspective atmospherique commune voile tout ce qui s eloigne, sans rupture', async function (g) {
    await reset(g);
    g.time = MC.DayCycle.DAY_LENGTH * 0.2;
    g.render.reglerRealiste(true);
    for (var i = 0; i < 60 && !g.render.lointain; i++) await frames(1);
    A.ok(g.render.lointain, 'le relief lointain est là');
    // un seul brouillard pour tous : vrais blocs, relief lointain, imposteurs
    [g.render.materials.opaque, g.render.materials.cutout, g.render.lointain.material].forEach(function (m) {
      A.ok(m.fog !== false, 'chaque matériau lointain ou proche prend le même voile');
    });
    if (g.render.loin.arbres) A.ok(g.render.loin.arbres.material.fog !== false, 'les imposteurs aussi');
    var f = g.render.loin.brouillard.color, ciel = g.render.scene.background;
    A.ok(f.b >= ciel.b - 0.02 && (f.r < ciel.r + 0.05), 'de jour, le voile bleuit le lointain');
    // la nuit, les silhouettes des lieux s'éclairent
    g.time = MC.DayCycle.DAY_LENGTH * 0.72;
    await frames(3);
    g.render.reglerRealiste(false);
    A.equal(g.render.loin.options.realiste, false, 'l option se coupe');
    if (g.render.loin.arbres) A.equal(g.render.loin.arbres.visible, false, 'et les imposteurs s effacent');
    g.render.reglerRealiste(true);
    g.time = 60;
    await reset(g);
  });

  /* SPEC-PERF-011/012 (correction de la revue adversariale, bug bloquant) :
     Three r128 (WebGLShadowMap) fabrique pour la passe ombre un
     MeshDepthMaterial générique qui ignore Material.onBeforeCompile — il lit
     l'attribut `uv` brut (voir mesher.js/pushUV), jamais mis à l'échelle par
     le greedy meshing. Sur un grand quad fusionné (feuillage), l'alphaTest
     de l'ombre échantillonnait donc UNE tuile étirée au lieu du motif
     répété, faussant la silhouette de l'ombre. render.js assigne maintenant
     un customDepthMaterial (matDepthCutout) qui applique la même répétition
     fract() (avecAtlasRepete, uvBase/uvRep) que le matériau visible.
     Ce test compare directement la CARTE D'OMBRE (sun.shadow.map, lue via
     WebGLRenderer.readRenderTargetPixels — le paquet RGBA de profondeur que
     l'alphaTest de la passe ombre produit réellement) d'un cube 8×8×8 de
     feuilles maillé fusionné (chemin réel de syncChunk) à celle du même
     cube maillé sans fusion (référence face-par-bloc, jamais concernée par
     le bug — chaque quad y couvre déjà exactement une tuile) : sans la
     correction, syncChunk n'assigne plus customDepthMaterial et l'écart de
     paquets de profondeur grandit très au-delà du seuil (mesuré : ~0.007
     avec la correction contre ~0.12 sans, sur cette même scène). */
  e2e('SPEC-PERF-012 : l\'ombre d\'un feuillage fusionné suit la répétition d\'atlas, pas une tuile étirée (customDepthMaterial)', async function (g) {
    await reset(g);
    var W = g.world;
    // loin du spawn : un site dédié, sans interférence avec les autres tests.
    // Le joueur est téléporté AVANT toute image : sinon le streaming (encore
    // calé sur le spawn) décharge ce chunk avant qu'on ait pu l'éditer.
    var X = 3008, Z = 3008, Y = 100;
    var cx = Math.floor(X / C.CHUNK_X), cz = Math.floor(Z / C.CHUNK_Z);
    var s = g.player.state;
    s.flying = true; s.vel.x = s.vel.y = s.vel.z = 0;
    s.pos.x = X + 8; s.pos.y = Y + 34; s.pos.z = Z - 4; s.yaw = 0; s.pitch = -1.1;
    g.time = MC.DayCycle.DAY_LENGTH * 0.2;   // soleil visible, incliné

    var chunk = W.getChunk(cx, cz, true);
    A.ok(chunk, 'le chunk du site de test est généré');

    // un socle de pierre (16×16, opaque, reçoit l'ombre) et, dessus, un cube
    // de 8×8×8 feuilles isolé par de l'air — le scénario exact de la revue.
    var dx, dz, dy, lx, ly, lz;
    for (dx = 0; dx < 16; dx++) for (dz = 0; dz < 16; dz++) {
      for (dy = -1; dy <= 9; dy++) W.setBlock(X + dx, Y + dy, Z + dz, 0);
      W.setBlock(X + dx, Y, Z + dz, B.STONE);
    }
    for (lx = 4; lx < 12; lx++) for (lz = 4; lz < 12; lz++) for (ly = 1; ly <= 8; ly++)
      W.setBlock(X + lx, Y + ly, Z + lz, B.LEAVES);

    await frames(3);   // laisse le joueur/caméra et le soleil (updateAmbience) se caler
    chunk = W.chunks.get(W.key(cx, cz));

    var renderer = g.render.renderer, sun = g.render.sun;
    function carteOmbre() {
      g.render.render();
      var rt = sun.shadow.map;
      var w = rt.width, h = rt.height;
      var buf = new Uint8Array(w * h * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      return buf;
    }
    function diffMoyen(a, b) {
      var somme = 0;
      for (var p = 0; p < a.length; p++) somme += Math.abs(a[p] - b[p]);
      return somme / a.length;
    }

    // référence : le même chunk maillé SANS fusion (chemin face-par-bloc
    // d'avant ce lot — chaque quad couvre déjà exactement une tuile, jamais
    // concerné par le bug) ; on force temporairement `fusion` à faux, sans
    // toucher au code de production.
    var buildOriginal = MC.Mesher.buildChunk;
    var carteNaive;
    try {
      MC.Mesher.buildChunk = function (ch, pass, sample, lumiere, eauDe, simplifie) {
        return buildOriginal(ch, pass, sample, lumiere, eauDe, simplifie, false);
      };
      g.render.syncChunk(W, chunk);
      carteNaive = carteOmbre();
    } finally {
      MC.Mesher.buildChunk = buildOriginal;
    }

    // reconstruit la vraie passe fusionnée (chemin réel du jeu, syncChunk)
    g.render.syncChunk(W, chunk);
    A.equal(chunk.meshC.customDepthMaterial, g.render.materials.depthCutout,
      'le mesh cutout réel reçoit le matériau de profondeur à répétition');
    var carteFusionnee = carteOmbre();

    var diff = diffMoyen(carteFusionnee, carteNaive);
    A.ok(diff < 0.03, 'carte d\'ombre du feuillage fusionné proche de la référence naïve — écart moyen ' + diff.toFixed(4) +
      '/255 (sans la correction, le motif étiré fausse la silhouette de l\'ombre et fait grimper cet écart bien au-delà du seuil)');
  });

  /* Mode histoire (SPEC-ARCHI-041) : le récit vit sur le SERVEUR. Ces tests jouent donc sur un VRAI
     serveur en mode histoire : le serveur de test (--tests) en lance un second, jetable, sur un port
     libre (POST /tests/serveur-histoire), auquel la page se connecte comme à n'importe quel serveur
     distant. Le client n'affiche que ce que le serveur annonce ; rien n'est simulé localement.
     En dernier : ces tests changent de règles (mode histoire) ; chacun les rend en partant. */
  async function rejoindreHistoire(g, histoire, presGuide) {
    var rep = null;
    try {
      var r = await fetch('/tests/serveur-histoire', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                       body: JSON.stringify({ histoire: histoire, presGuide: !!presGuide }) });
      rep = await r.json();
    } catch (e) { rep = null; }
    if (!rep || !rep.ok) return false;                      // pas de serveur de test : test ignoré, comme les autres tests réseau
    g.net.connecter('ws://127.0.0.1:' + rep.port, 'Testeur', 1);
    await sonderE2E(function () { return g.net.etat === 'en ligne'; }, 30000);
    A.equal(g.net.etat, 'en ligne', 'connecté au serveur d\'histoire');
    return true;
  }
  async function quitterHistoire(g) {
    g.net.deconnecter();
    g.oublierHistoire();
    g.ui.objectifHistoire(null);
    g.adopterRegles('survie', 'facile', null);
    fakeLock(g, true); g.input.setState('playing');
    await frames(2);
  }

  e2e('SPEC-HISTOIRE-009 : une partie en mode histoire raconte, guide, limite et tient un journal', async function (g) {
    await reset(g);
    g.render.setDistance(5);
    try {
      if (!(await rejoindreHistoire(g, { heros: 'Testeur', longueur: 'courte', interactions: { preset: 'restreinte' } }, true))) {
        A.ok(false, 'serveur d histoire indisponible (POST /tests/serveur-histoire : lancer le banc avec server.js --tests)'); return;
      }
      await sonderE2E(function () { var d = document.querySelector('.dialogue-histoire'); return g.histoire && d && d.style.display !== 'none'; }, 30000);
      A.ok(g.histoire && g.regles.histoire, 'le récit est lancé, annoncé par le serveur');
      var dlg = document.querySelector('.dialogue-histoire');
      A.ok(dlg && dlg.style.display !== 'none', 'le premier chapitre est raconté');
      A.ok(/réveil/i.test(dlg.textContent), 'Le réveil du village : ' + dlg.querySelector('h3').textContent);
      A.equal(g.input.state, 'ui', 'la main est à l interface pendant le récit');
      dlg.querySelector('button').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await frames(3);
      A.equal(g.input.state, 'playing', 'on reprend la main après « Continuer »');
      fakeLock(g, true);
      for (var i = 0; i < 40; i++) await frames(1);
      var obj = document.querySelector('.objectif-histoire');
      A.ok(obj && obj.style.display !== 'none' && /guide/i.test(obj.textContent), 'l objectif s affiche : ' + (obj && obj.textContent));
      A.ok(g.world.reperes.liste.some(function (r) { return /★/.test(r.nom); }), 'un repère marque l objectif');
      // interactions restreintes : la pierre ne se casse pas (règle adoptée du serveur)
      A.notOk(MC.Modes.peutCasser(g.regles, B.STONE), 'la pierre est hors de l histoire');
      // le guide du village : le serveur le fait naître, le joueur s'éveille à côté de lui
      var guide = null;
      for (var t = 0; t < 600 && !guide; t++) {
        await frames(1);
        g.net.mobsDistants.forEach(function (m) { if (m.role === 'guide') guide = m; });
      }
      A.ok(guide, 'le guide du village de départ est là');
      var avant = g.histoire.histoire.etape + g.histoire.histoire.chap * 10;
      g.parlerA(guide);
      await sonderE2E(function () { var d = document.querySelector('.dialogue-histoire'); return d && d.style.display !== 'none'; }, 8000);
      A.ok(document.querySelector('.dialogue-histoire').style.display !== 'none', 'il raconte (réplique envoyée par le serveur)');
      await sonderE2E(function () { return g.histoire.histoire.etape + g.histoire.histoire.chap * 10 > avant; }, 8000);
      A.gt(g.histoire.histoire.etape + g.histoire.histoire.chap * 10, avant, 'et l histoire avance, côté serveur');
      document.querySelector('.dialogue-histoire button').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await frames(3);
      // le journal
      fakeLock(g, true);
      g.input.setState('playing');
      key('KeyH');
      await frames(2);
      var j = document.querySelector('.journal-histoire');
      A.ok(j && j.style.display !== 'none' && /Couronne des Saisons/.test(j.textContent), 'H ouvre le journal');
      key('KeyH');
      await frames(2);
      A.equal(j.style.display, 'none', 'H le referme');
    } finally { await quitterHistoire(g); }
  });

  /* Tout à la fin aussi : encore une connexion à un serveur d'histoire. */
  e2e('SPEC-HISTOIRE-014 : une réplique du récit libère la souris et se répond au clic ou au clavier', async function (g) {
    await reset(g);
    g.render.setDistance(5);
    var sortie = document.exitPointerLock, sorties = 0;
    try {
      document.exitPointerLock = function () { sorties++; };
      if (!(await rejoindreHistoire(g, { heros: 'Testeur', longueur: 'courte', interactions: { preset: 'restreinte' } }, false))) {
        A.ok(false, 'serveur d histoire indisponible (POST /tests/serveur-histoire : lancer le banc avec server.js --tests)'); return;
      }
      await sonderE2E(function () { var d = document.querySelector('.dialogue-histoire'); return g.histoire && d && d.style.display !== 'none'; }, 30000);
      var dlg = document.querySelector('.dialogue-histoire');
      A.ok(dlg.style.display !== 'none', 'le premier chapitre est raconté');
      A.equal(g.input.state, 'ui', 'la main est à l interface');
      // la capture demandée au lancement arrive APRÈS l'ouverture du récit :
      // elle doit être relâchée aussitôt, sinon la réplique est incliquable
      fakeLock(g, true);
      A.gt(sorties, 0, 'une capture tardive est relâchée');
      A.equal(g.input.state, 'ui', 'et l on reste sur l interface');
      // reprendre le jeu (fin de chargement, retour de pause) ne recapture pas la souris
      g.input.setState('playing');
      A.equal(g.input.state, 'ui', 'pas de reprise tant qu une réplique attend');
      fakeLock(g, false);
      // Entrée répond « Continuer » ; on déroule les répliques au clavier
      for (var i = 0; i < 12 && dlg.style.display !== 'none'; i++) { key('Enter'); await frames(2); }
      A.equal(dlg.style.display, 'none', 'le récit se déroule au clavier');
      A.equal(g.input.state, 'playing', 'puis on reprend la main');
      // un choix se prend au chiffre
      var pris = null;
      g.input.setState('ui');
      g.ui.dialogueHistoire({ titre: 'Choix', texte: '?', choix: [{ id: 'a', texte: 'A' }, { id: 'b', texte: 'B' }] },
                            function (id) { pris = id; });
      A.ok(/1/.test(dlg.querySelector('kbd').textContent), 'les choix affichent leur touche');
      key('Digit2'); await frames(1);
      A.equal(pris, 'b', 'la touche 2 prend le deuxième choix');
    } finally {
      document.exitPointerLock = sortie;
      await quitterHistoire(g);
    }
  });

  e2e('SPEC-HISTOIRE-010 : les trois archétypes se choisissent et se jouent — ici, l enquête', async function (g) {
    await reset(g);
    g.render.setDistance(5);
    try {
      if (!(await rejoindreHistoire(g, { archetype: 'enquete', heros: 'Testeur', longueur: 'courte', interactions: { preset: 'restreinte' } }, false))) {
        A.ok(false, 'serveur d histoire indisponible (POST /tests/serveur-histoire : lancer le banc avec server.js --tests)'); return;
      }
      await sonderE2E(function () { var d = document.querySelector('.dialogue-histoire'); return g.histoire && d && d.style.display !== 'none'; }, 30000);
      A.ok(g.histoire && g.histoire.archetype === 'enquete', 'le récit choisi est bien une enquête');
      var dlg = document.querySelector('.dialogue-histoire');
      A.ok(dlg && dlg.style.display !== 'none', 'un dialogue de chapitre s affiche');
      dlg.querySelector('button').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await frames(3);
      var obj = document.querySelector('.objectif-histoire');
      await sonderE2E(function () { return obj && obj.style.display !== 'none'; }, 5000);
      A.ok(obj && obj.style.display !== 'none' && /enquête/i.test(obj.textContent),
           'l objectif parle de l enquête : ' + (obj && obj.textContent));
    } finally { await quitterHistoire(g); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // L48 — rendu fiable et adaptatif (SPEC-RENDU-…, SPEC-PERF-015/016)
  // ══════════════════════════════════════════════════════════════════════════

  /* SPEC-RENDU-001/002 : simule webglcontextlost/restored via l'extension
     WEBGL_lose_context (la seule façon fiable de reproduire l'événement). */
  e2e('SPEC-RENDU-001 / SPEC-RENDU-002 : la perte du contexte GPU arrête le rendu et affiche un message ; la restauration le reprend', async function (g) {
    await reset(g);
    var gl = g.render.renderer.getContext();
    var ext = gl.getExtension('WEBGL_lose_context');
    A.ok(ext, 'l extension de simulation est disponible dans ce navigateur');
    var msg = document.querySelector('.contexte-perdu');
    A.ok(msg, 'le message de perte existe dans le DOM');
    A.equal(getComputedStyle(msg).display, 'none', 'invisible au repos');
    var avantAppels = 0;
    var infoAvant = g.render.renderer.info.render.calls;
    ext.loseContext();
    await frames(3);
    A.ok(g.render.contextePerdu, 'le moteur se sait en perte de contexte');
    A.equal(getComputedStyle(msg).display, 'flex', 'le message apparaît');
    // pendant la perte : aucun rendu ne s avance (renderViews renvoie 0 vues traitées)
    var traitees = g.render.renderViews(g.vues);
    A.equal(traitees, 0, 'renderViews ne rend plus rien pendant la coupure');
    ext.restoreContext();
    await frames(5);
    A.notOk(g.render.contextePerdu, 'le contexte est restauré');
    A.equal(getComputedStyle(msg).display, 'none', 'le message disparaît');
    // un rendu réussit de nouveau
    var apres = g.render.renderViews(g.vues);
    A.gt(apres, 0, 'le rendu reprend après restauration');
  });

  /* SPEC-PERF-015 : g.perf est calculé en continu, indépendamment de son
     affichage — on le lit directement sans toucher au panneau F3. */
  e2e('SPEC-PERF-015 : g.perf expose des métriques finies, cohérentes avec renderer.info', async function (g) {
    await reset(g);
    g.render.setDistance(4);
    g.streamChunks(true);
    for (var i = 0; i < 20; i++) await frames(1);
    var p = g.perf;
    ['msGeneration', 'msMaillage', 'appelsDessin', 'triangles', 'fps', 'fpsP50', 'fpsP95', 'renderDist'].forEach(function (k) {
      A.ok(isFinite(p[k]), 'g.perf.' + k + ' est fini : ' + p[k]);
    });
    A.equal(p.appelsDessin, g.render.renderer.info.render.calls, 'appelsDessin == renderer.info.render.calls');
    A.equal(p.triangles, g.render.renderer.info.render.triangles, 'triangles == renderer.info.render.triangles');
  });

  /* SPEC-PERF-016 : le panneau F3 s'ouvre et se ferme sur la touche F3, et
     affiche chaque métrique attendue. */
  e2e('SPEC-PERF-016 : F3 affiche le panneau de métriques, un second appui le masque', async function (g) {
    await reset(g);
    var f3 = document.querySelector('.panneau-f3');
    A.ok(f3, 'le panneau existe dans le DOM');
    if (g.ui.f3Visible) key('F3');                 // état connu : fermé
    await frames(1);
    A.equal(getComputedStyle(f3).display, 'none', 'fermé au départ');
    key('F3'); await frames(2);
    A.equal(getComputedStyle(f3).display, 'block', 'un appui l ouvre');
    var texte = f3.textContent;
    ['FPS', 'dessin', 'triangles', 'génération', 'maillage', 'vue'].forEach(function (mot) {
      A.ok(texte.toLowerCase().indexOf(mot.toLowerCase()) >= 0, 'le panneau mentionne « ' + mot + ' » : ' + texte);
    });
    key('F3'); await frames(1);
    A.equal(getComputedStyle(f3).display, 'none', 'un second appui le masque');
  });

  /* SPEC-RENDU-012 : mipmaps de l'atlas, activables/désactivables sans
     reconstruire tout le renderer (même instance avant/après). */
  /* Les niveaux sont fournis par MC.Qualite.mipmapsAtlas (tuile par tuile)
     plutôt que générés par le GPU : Three.js remet alors `generateMipmaps` à
     false de lui-même — la preuve d'activation est donc la chaîne de niveaux
     (`texture.mipmaps`) et le filtre de réduction, pas ce drapeau. */
  e2e('SPEC-RENDU-012 : l’option mipmaps (activée par défaut) change la texture de l’atlas sans reconstruire le renderer', async function (g) {
    var avant = JSON.parse(JSON.stringify(g.options));
    try {
      A.equal(MC.Options.defauts().mipmaps, true, 'mipmaps activés par défaut');
      var s = await reset(g);
      s.flying = true; s.pos.y += 30; s.pitch = -0.35;
      g.render.setDistance(6);
      g.streamChunks(true);
      for (var w = 0; w < 10; w++) await frames(1);
      var tex = g.render.materials.opaque.map, rendererAvant = g.render.renderer;
      var niveaux = Math.log2(Math.max(tex.image.width, tex.image.height)) + 1;
      g.reglerOption('mipmaps', false);
      await frames(2);
      capture('mipmaps-coupes');
      A.equal(g.render.renderer, rendererAvant, 'même instance de renderer après le basculement');
      A.equal(tex.minFilter, THREE.NearestFilter, 'coupés : filtre nearest, niveau 0 seul');
      A.equal(tex.mipmaps.length, 0, 'coupés : aucune chaîne de niveaux en mémoire');
      A.notOk(g.render.mipmapsActifs, 'coupés');
      g.reglerOption('mipmaps', true);
      await frames(2);
      capture('mipmaps-actifs');
      A.equal(g.render.renderer, rendererAvant, 'toujours la même instance de renderer');
      A.equal(g.render.materials.opaque.map, tex, 'même texture d’atlas (pas de reconstruction des matériaux)');
      A.equal(tex.minFilter, THREE.NearestMipmapLinearFilter, 'actifs : filtre à mip (nearest dans un niveau, linéaire entre niveaux)');
      A.equal(tex.mipmaps.length, niveaux, 'actifs : chaîne complète de ' + niveaux + ' niveaux');
      A.equal(tex.mipmaps[1].width, tex.image.width / 2, 'niveau 1 à demi-taille');
      A.ok(g.render.mipmapsActifs, 'actifs');
      s.flying = false;
    } finally {
      g.options = avant; MC.Options.sauver(localStorage, avant);
      g.reglerOption('mipmaps', avant.mipmaps);
      await reset(g);
    }
  });

  /* SPEC-RENDU-012 : le shader d'atlas (avecAtlasRepete, render.js) lit le
     niveau de mipmap calculé sur la coordonnée CONTINUE du bloc et plafonné
     à log2(TILE). Preuve visuelle par niveaux colorés : la chaîne de l'atlas
     est remplacée le temps du test par des niveaux unis — 0 à 3 rouges, 4
     bleu, 5 et au-delà verts — lus en « nearest » entre niveaux. Sur un
     plateau de briques (grands quads fusionnés) vu en rasant :
     - près (3 à 8 blocs), le niveau lu est bas : aucun pixel bleu. Un niveau
       calculé après le fract() sauterait au plafond le long de chaque bord
       de bloc : des lignes bleues ;
     - loin (45 à 64 blocs), le niveau voulu dépasse 4 : il doit être
       plafonné (bleu), jamais vert. */
  e2e('SPEC-RENDU-012 : le niveau de mipmap de l’atlas est continu aux bords des blocs et plafonné à log2(TILE)', async function (g) {
    var s = await reset(g);
    var tex = g.render.materials.opaque.map, avantMip = tex.mipmaps, avantFiltre = tex.minFilter;
    var avantAA = g.options.antialias, dist = g.render.RENDER_DIST;
    var Y = 118, X0 = Math.floor(s.pos.x) - 4, Z0 = Math.floor(s.pos.z) - 32, N = 72, modifies = [];
    A.equal(g.render.atlasShader.lodMax.value, Math.log2(g.render.atlasShader.texels.value.x / MC.Mesher.ATLAS_COLS),
      'plafond du shader : log2(TILE)');
    A.equal(g.render.atlasShader.lodMax.value, 4, 'tuiles de 16 texels : niveau 4');
    try {
      g.reglerOption('antialias', 'non');
      g.reglerOption('mipmaps', true);
      A.ok(g.render.mipmapsActifs, 'mipmaps actifs (WebGL2)');
      g.render.setDistance(8);
      g.streamChunks(true);
      for (var x = X0; x < X0 + N; x++) for (var z = Z0; z < Z0 + 64; z++) {
        g.world.setBlock(x, Y, z, B.BRICK); modifies.push([x, z]);
      }
      // niveaux colorés, mêmes tailles que la vraie chaîne
      var couleur = function (k) { return k <= 3 ? [220, 30, 30] : k === 4 ? [30, 30, 220] : [30, 220, 30]; };
      tex.mipmaps = avantMip.map(function (niv, k) {
        var w = niv.width, h = niv.height, d = new Uint8ClampedArray(w * h * 4), c = couleur(k);
        for (var i = 0; i < w * h; i++) { d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = 255; }
        return new ImageData(d, w, h);
      });
      tex.minFilter = THREE.NearestMipmapNearestFilter;
      tex.needsUpdate = true;
      s.flying = true; g.time = 60;
      s.pos.x = X0 + N / 2 + 0.5; s.pos.z = Z0 + 0.5; s.pos.y = Y + 1 + 2 - g.player.EYE;
      s.yaw = Math.PI; s.pitch = -0.15;     // regard vers +z, le long du plateau
      for (var t0 = performance.now(); performance.now() - t0 < 15000;) {
        await frames(1);
        var sale = false;
        for (var cx = Math.floor(X0 / 16); cx <= Math.floor((X0 + N) / 16); cx++)
          for (var cz = Math.floor(Z0 / 16); cz <= Math.floor((Z0 + 64) / 16); cz++) {
            var c = g.world.chunks.get(g.world.key(cx, cz)); if (c && c.dirty) sale = true;
          }
        if (!sale) break;
      }
      await frames(3);
      g.render.setAntialias(false);
      g.render.render();
      var cv = g.render.renderer.domElement, W = cv.width, H = cv.height;
      var c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
      var ctx = c2.getContext('2d'); ctx.drawImage(cv, 0, 0);
      capture('niveaux-colores');
      var cam = g.render.camera;
      function ligne(d) {                      // rangée d'écran d'un point du plateau à d blocs devant
        var v = new THREE.Vector3(s.pos.x, Y + 1, s.pos.z + d).project(cam);
        return Math.round((1 - v.y) / 2 * H);
      }
      function compter(y0, y1) {
        // colonnes centrales : le plateau (72 blocs de large) y couvre toute la bande, même à 64 blocs
        var px = ctx.getImageData(Math.round(W * 0.3), Math.min(y0, y1), Math.round(W * 0.4), Math.max(1, Math.abs(y1 - y0))).data, n = { r: 0, b: 0, v: 0, tot: 0 };
        for (var i = 0; i < px.length; i += 4) {
          var r = px[i], gg = px[i + 1], b = px[i + 2];
          n.tot++;
          if (r > gg + 50 && r > b + 50) n.r++;
          else if (b > r + 50 && b > gg + 50) n.b++;
          else if (gg > r + 50 && gg > b + 50) n.v++;
        }
        return n;
      }
      var pres = compter(ligne(8), ligne(3)), loin = compter(ligne(64) + 2, ligne(45));
      A.gt(pres.r, pres.tot * 0.8, 'près : le plateau lu aux niveaux bas (rouge) — ' + JSON.stringify(pres));
      A.ok(pres.b <= pres.tot * 0.002, 'près : pas de ligne au niveau plafond le long des bords de blocs — ' + JSON.stringify(pres));
      A.gt(loin.b, loin.tot * 0.5, 'loin : niveau plafonné à 4 (bleu) — ' + JSON.stringify(loin));
      A.equal(loin.v, 0, 'loin : jamais au-delà du plafond (vert) — ' + JSON.stringify(loin));
    } finally {
      tex.mipmaps = avantMip; tex.minFilter = avantFiltre; tex.needsUpdate = true;
      modifies.forEach(function (p) { g.world.setBlock(p[0], Y, p[1], 0); });
      g.reglerOption('antialias', avantAA || 'auto');
      g.render.setDistance(dist);
      s.flying = false;
      await reset(g);
    }
  });

  /* SPEC-RENDU-012 : sur l'atlas RÉEL, les tuiles hors découpe à alpha
     partiel (verres, eau : leur alpha est une opacité) gardent leur opacité
     moyenne à tous les niveaux lus (0 à log2(TILE)) — seules les tuiles de
     la passe cutout voient leur alpha rééchelonné. */
  e2e('SPEC-RENDU-012 : atlas réel — verres et eau gardent leur alpha moyen (± 2 %) à tous les niveaux de mipmap', async function (g) {
    var opt = g.options.mipmaps;
    try {
      g.reglerOption('mipmaps', true);
      await frames(1);
      var tex = g.render.materials.opaque.map, C = MC.Core, TILE = 16, COLS = MC.Mesher.ATLAS_COLS;
      var cv = tex.mipmaps[0], L = cv.width;
      var niveaux = [cv.getContext('2d').getImageData(0, 0, L, cv.height)].concat(tex.mipmaps.slice(1, 5));
      var vues = {}, tuiles = [];
      C.BLOCKS.forEach(function (b) {
        if (!b || !b.tiles || C.passOf(b.id) === 'cutout') return;
        if (!(C.passOf(b.id) === 'blend' || /verre/i.test(b.name || ''))) return;
        b.tiles.forEach(function (t) { if (!vues[t]) { vues[t] = 1; tuiles.push({ t: t, nom: b.name }); } });
      });
      A.ok(tuiles.some(function (x) { return x.t === 11; }), 'le verre (tuile 11) est contrôlé');
      var controlees = 0;
      tuiles.forEach(function (x) {
        var moy = niveaux.map(function (n, k) {
          var tk = TILE >> k, ox = (x.t % COLS) * tk, oy = ((x.t / COLS) | 0) * tk, s = 0;
          for (var y = 0; y < tk; y++) for (var xx = 0; xx < tk; xx++) s += n.data[((oy + y) * n.width + ox + xx) * 4 + 3];
          return s / (tk * tk);
        });
        if (moy[0] >= 254.5) return;                  // tuile opaque : rien à vérifier
        controlees++;
        moy.forEach(function (m, k) {
          A.ok(Math.abs(m - moy[0]) <= Math.max(1, moy[0] * 0.02),
            x.nom + ' (tuile ' + x.t + ') niveau ' + k + ' : alpha moyen ' + m.toFixed(1) + ' contre ' + moy[0].toFixed(1) + ' au niveau 0');
        });
      });
      A.gt(controlees, 0, 'au moins une tuile translucide contrôlée');
    } finally {
      g.reglerOption('mipmaps', opt);
      await frames(1);
    }
  });

  /* SPEC-RENDU-012 : en WebGL1, le shader n'a ni textureLod ni dFdx : les
     mipmaps y réintroduiraient coutures et mélanges de tuiles — ils restent
     coupés quel que soit le réglage. */
  e2e('SPEC-RENDU-012 : sans WebGL2, l’option mipmaps reste sans effet (niveau 0 seul)', async function (g) {
    var caps = g.render.renderer.capabilities, avant = caps.isWebGL2, opt = g.options.mipmaps;
    var tex = g.render.materials.opaque.map;
    try {
      g.reglerOption('mipmaps', false);
      caps.isWebGL2 = false;
      g.reglerOption('mipmaps', true);
      await frames(1);
      A.notOk(g.render.mipmapsActifs, 'mipmaps refusés sans WebGL2');
      A.equal(tex.minFilter, THREE.NearestFilter, 'filtre nearest');
      A.equal(tex.mipmaps.length, 0, 'aucune chaîne de niveaux');
    } finally {
      caps.isWebGL2 = avant;
      g.reglerOption('mipmaps', false);
      g.reglerOption('mipmaps', opt);
      await frames(1);
    }
  });

  /* SPEC-RENDU-006 : l'antialias est piloté par le FPS mesuré — injecté ici
     (g.mesurerFPS substitué), jamais celui de la machine de test — et
     réactivable à la main dans l'écran des options. Le délai de l'hystérésis
     est raccourci (g.etatQualite) pour ne pas attendre 2 × 3 s. */
  e2e('SPEC-RENDU-006 : un FPS bas injecté prolongé coupe l’antialias, le réglage manuel des options ou un FPS haut le rétablit', async function (g) {
    var avant = JSON.parse(JSON.stringify(g.options));
    var mesurer = g.mesurerFPS, delai = g.etatQualite.delaiSec, dist = g.render.RENDER_DIST;
    var fpsInjecte = 12;
    // attente bornée en TEMPS (le nombre d'images par seconde du navigateur
    // sans fenêtre varie de 60 à plusieurs centaines)
    async function attendre(cond, maxMs) {
      var t0 = performance.now();
      while (!cond() && performance.now() - t0 < (maxMs || 15000)) await frames(1);
      return cond();
    }
    async function ticks(n) {
      var m0 = g.perf.mesures;
      await attendre(function () { return g.perf.mesures >= m0 + n; });
    }
    try {
      await reset(g);
      g.reglerOption('antialias', 'auto');
      g.reinitialiserQualite();
      g.etatQualite.delaiSec = 0.8;
      g.mesurerFPS = function () { return fpsInjecte; };
      A.ok(g.render.antialiasActif, 'actif au départ (palier plein)');
      A.ok(await attendre(function () { return !g.render.antialiasActif; }), 'FPS bas prolongé : antialias coupé');
      A.equal(g.qualite.antialias, false, 'c’est la décision adaptative qui l’a coupé');
      A.ok(g.qualite.fpsP50 < g.etatQualite.seuilBas, 'sur un p50 mesuré sous le seuil : ' + g.qualite.fpsP50);
      capture('aa-coupe-fps-bas');

      // réactivation manuelle, par l'écran des options, FPS toujours bas
      key('Escape'); await frames(3);
      document.querySelector('#btn-options').click(); await frames(2);
      var sel = document.querySelector('select[data-opt="antialias"]');
      A.ok(sel, 'le lissage se règle dans les options');
      var etatAA = document.querySelector('[data-etat="antialias"]');
      A.ok(/coupé \(FPS bas\)/.test(etatAA.textContent), 'l’écran indique l’état effectif en automatique : ' + etatAA.textContent);
      sel.value = 'oui'; sel.dispatchEvent(new Event('change'));
      A.ok(g.render.antialiasActif, 'réactivé aussitôt à la main');
      A.ok(/actuellement actif/.test(etatAA.textContent), 'état affiché mis à jour : ' + etatAA.textContent);
      await ticks(3);
      A.ok(g.render.antialiasActif, 'reste actif malgré l’adaptatif qui le couperait (' + g.qualite.antialias + ')');
      sel.value = 'auto'; sel.dispatchEvent(new Event('change'));
      A.notOk(g.render.antialiasActif, 'retour en automatique : le FPS bas le coupe de nouveau');
      document.querySelector('#btn-retour').click(); await frames(2);
      key('Escape'); fakeLock(g, true); await frames(3);

      // FPS haut restauré : rétabli sans intervention
      fpsInjecte = 60;
      A.ok(await attendre(function () { return g.render.antialiasActif; }), 'FPS haut prolongé : antialias rétabli');
      A.equal(g.qualite.antialias, true, 'par la décision adaptative');
      capture('aa-retabli-fps-haut');
    } finally {
      g.mesurerFPS = mesurer; g.etatQualite.delaiSec = delai;
      g.options = avant; MC.Options.sauver(localStorage, avant);
      g.reglerOption('antialias', avant.antialias || 'auto');
      g.reinitialiserQualite();
      g.render.setDistance(dist);
      await reset(g);
    }
  });

  /* SPEC-RENDU-015 : le panneau F3 et la décision d'adaptation lisent le
     MÊME calcul. On lit en même temps le texte AFFICHÉ par le panneau et
     `g.qualite.fpsP50` (la valeur sur laquelle l'adaptatif a décidé), au même
     tick de mesure. Le FPS injecté (40 stable puis une image lente à 10)
     distingue le p50 (40) du FPS instantané (10) : un panneau ou un
     adaptatif qui lirait une autre mesure le trahirait. */
  e2e('SPEC-RENDU-015 : le p50 affiché au panneau F3 est exactement celui de la décision d’adaptation', async function (g) {
    var mesurer = g.mesurerFPS, dist = g.render.RENDER_DIST;
    var f3 = document.querySelector('.panneau-f3');
    function lirePanneau() {
      var m = /p50\s*(\d+)/.exec(f3.textContent);
      return m ? Number(m[1]) : NaN;
    }
    async function prochainTick() {    // borné en TEMPS : le nombre d'images par seconde varie
      var m0 = g.perf.mesures, t0 = performance.now();
      while (g.perf.mesures === m0 && performance.now() - t0 < 5000) await frames(1);
      A.ok(g.perf.mesures > m0, 'un tick de mesure a eu lieu');
      await frames(1);                 // le panneau se redessine à l'image suivante
    }
    try {
      await reset(g);
      g.reinitialiserQualite();
      if (!g.ui.f3Visible) g.ui.toggleF3();
      /* onze ticks (4,4 s, tous dans la fenêtre de 5 s) de valeurs toutes
         différentes, la dernière la plus lente : triées, 5 15 25 … 105 ;
         p50 = 55, alors que p40 = 45, p60 = 65, la moyenne ≈ 55,9 et le FPS
         instantané = 5 — seul le p50 donne 55. */
      var suite = [15, 85, 35, 105, 55, 25, 95, 45, 75, 65, 5], i = 0;
      g.mesurerFPS = function () { return suite[Math.min(i++, suite.length - 1)]; };
      for (var t = 0; t < suite.length; t++) await prochainTick();
      var affiche = lirePanneau(), decide = g.qualite.fpsP50;   // lus ensemble, même image
      capture('f3-p50-suite-variee');
      A.equal(i, suite.length, 'chaque tick a consommé une valeur injectée');
      A.equal(g.fps, 5, 'FPS instantané du dernier tick');
      A.equal(g.qualite.mesure, g.perf.mesures, 'la décision vient du tick que le panneau affiche');
      A.equal(affiche, decide, 'égalité stricte : panneau ' + affiche + ' / adaptatif ' + decide);
      A.equal(decide, g.perf.fpsP50, 'g.perf (source du panneau) et g.qualite partagent la valeur');
      A.equal(affiche, 55, 'tous deux lisent le p50 de la fenêtre, et lui seul');
    } finally {
      g.mesurerFPS = mesurer;
      if (g.ui.f3Visible) g.ui.toggleF3();
      g.reinitialiserQualite();
      g.render.setDistance(dist);
    }
  });

  /* SPEC-RENDU-011 : l'avertissement de rendu logiciel s'affiche une seule
     fois et peut être ignoré — on ne peut pas forcer un VRAI rendu logiciel
     dans ce navigateur, donc on exerce directement le mécanisme d'affichage
     (celui que game.js appelle si SPEC-RENDU-010 détecte un rendu logiciel
     au démarrage). Le drapeau « déjà averti » est définitif pour la session :
     si un lancement précédent de ce même test (le même `g`, réutilisé par
     toute la suite e2e) l'a déjà déclenché, un nouvel appel ne doit RIEN
     ajouter — le test vérifie donc l'idempotence entre deux appels
     consécutifs, condition suffisante et vraie quel que soit l'état de
     départ, plutôt qu'un premier appel qui suppose (à tort, selon l'ordre
     d'exécution) qu'aucun toast n'existe encore. */
  e2e('SPEC-RENDU-011 : l’avertissement de rendu logiciel ne s’affiche qu’une seule fois', async function (g) {
    var avant = document.querySelectorAll('.toast').length;
    g.ui.avertirRenduLogiciel('SwiftShader (simulé)');
    await frames(2);
    var apresUn = document.querySelectorAll('.toast').length;
    A.ok(apresUn - avant <= 1, 'au plus un avertissement ajouté par cet appel : ' + avant + ' → ' + apresUn);
    if (apresUn > avant) {
      var texte = Array.from(document.querySelectorAll('.toast')).map(function (t) { return t.textContent; }).join(' | ');
      A.ok(/accélération matérielle/i.test(texte), 'le message parle d’accélération matérielle : ' + texte);
    }
    g.ui.avertirRenduLogiciel('SwiftShader (simulé)');
    await frames(2);
    var apresDeux = document.querySelectorAll('.toast').length;
    A.equal(apresDeux, apresUn, 'un second appel ne redouble pas l’avertissement');
  });

  /* SPEC-RENDU-013 : les maillages de chunk gardent le frustum culling actif
     (à la différence des maillages spéciaux, qui le désactivent). */
  e2e('SPEC-RENDU-013 : les maillages de chunk restent soumis au frustum culling', async function (g) {
    await reset(g);
    g.render.setDistance(4);
    g.streamChunks(true);
    for (var i = 0; i < 10; i++) await frames(1);
    var trouve = 0, culled = 0;
    g.world.chunks.forEach(function (c) {
      g.render.PASSES.forEach(function (p) {
        var m = c[p[0]];
        if (m) { trouve++; if (m.frustumCulled) culled++; }
      });
    });
    A.gt(trouve, 0, 'des maillages de chunk existent');
    A.equal(culled, trouve, 'tous ont le frustum culling actif : ' + culled + '/' + trouve);
  });

  /* SPEC-RENDU-006 : le contexte WebGL se crée désormais sans MSAA (voir la
     note près de sa création, src/render.js) — le lissage vient d'une passe
     de post-traitement (FXAA léger) que `setAntialias` bascule réellement,
     sans jamais recréer le renderer/canvas. La preuve d'un VRAI basculement
     GPU (pas juste une option mémorisée) : la passe ajoute un appel de
     dessin plein écran de plus (`renderer.info.render.calls`) quand elle
     tourne, aucun quand elle est coupée. */
  e2e('SPEC-RENDU-006 : setAntialias bascule réellement une passe de post-traitement (appels de dessin en plus/en moins)', async function (g) {
    await reset(g);
    g.render.setDistance(3);
    g.streamChunks(true);
    for (var i = 0; i < 3; i++) await frames(1);
    var rendererAvant = g.render.renderer;

    // les deux mesures dans le même tour synchrone, sans image intermédiaire :
    // ni le streaming des chunks ni un tick de l'adaptatif (qui réapplique sa
    // décision toutes les 0,4 s) ne peuvent s'intercaler entre elles
    await frames(2);
    g.render.setAntialias(true);
    g.render.renderViews(g.vues);
    A.equal(g.render.antialiasActif, true, 'option activée');
    var avecAA = g.render.metriquesDessin.appelsDessin;

    g.render.setAntialias(false);
    g.render.renderViews(g.vues);
    A.equal(g.render.antialiasActif, false, 'option désactivée');
    var sansAA = g.render.metriquesDessin.appelsDessin;

    A.equal(g.render.renderer, rendererAvant, 'même instance de renderer — pas de reconstruction du contexte');
    A.gt(avecAA, sansAA, 'la passe FXAA ajoute au moins un appel de dessin : ' + avecAA + ' (actif) > ' + sansAA + ' (coupé)');

    // réactivable manuellement (la fiche l'exige explicitement) : par le
    // choix « toujours actif » des options, qu'aucun tick adaptatif n'écrase
    var choixAvant = g.options.antialias;
    try {
      g.render.setAntialias(false);
      g.reglerOption('antialias', 'oui');
      await frames(1);
      A.equal(g.render.antialiasActif, true, 'réactivable manuellement dans les options');
    } finally {
      g.reglerOption('antialias', choixAvant || 'auto');
    }
  });

  /* SPEC-RENDU-009 : sous le seuil de foule, chaque mob garde son maillage
     complet (articulé) ; passé ce seuil, l'espèce entière bascule en un
     seul THREE.InstancedMesh — vérifié ici en conditions réelles (vraie
     scène, vrai renderer), pas en simulant juste le compte. */
  e2e('SPEC-RENDU-009 : les mobs d’une même espèce en surnombre sont fusionnés en un seul InstancedMesh', async function (g) {
    await reset(g);
    var s = g.player.state;
    s.flying = true;
    // une distance de vue modeste et fixe, et une scène qu'on laisse se
    // stabiliser (streaming en cours ailleurs dans la campagne e2e, s'il en
    // reste, peut sinon faire bouger `appelsDessin` d'une image à l'autre
    // indépendamment des moutons — cette mesure se calibre de toute façon
    // sur elle-même ci-dessous plutôt que sur un seuil absolu).
    g.render.setDistance(3);
    g.streamChunks(true);
    for (var wi = 0; wi < 10; wi++) await frames(1);
    var appels0 = g.render.metriquesDessin.appelsDessin;

    // sous le seuil (4 < 5) : maillages individuels complets
    var peu = [];
    for (var i = 0; i < 4; i++) peu.push(g.entities.spawn('sheep', s.pos.x + 2 + i, s.pos.y + 1, s.pos.z));
    await frames(3);
    var individuelsPeu = peu.filter(function (e) { return g.render.entityMeshes.has(e.eid); }).length;
    A.equal(individuelsPeu, 4, 'sous le seuil (4 moutons) : chacun garde son maillage individuel');
    A.notOk(g.render.instancesMobs.sheep && g.render.instancesMobs.sheep.mesh.count > 0, 'pas d’instance active sous le seuil');
    var appels4 = g.render.metriquesDessin.appelsDessin;
    // coût par mob individuel mesuré ICI (se calibre sur le bruit ambiant
    // de cette exécution — chunks/météo — au lieu d'un seuil absolu)
    var coutParMob = Math.max(1, (appels4 - appels0) / 4);

    peu.forEach(function (e) { g.entities.remove(e); });
    await frames(2);

    // 20 moutons d'un coup : passe le seuil, bascule en instance
    var vingt = [];
    for (var j = 0; j < 20; j++) vingt.push(g.entities.spawn('sheep', s.pos.x + 2 + (j % 8), s.pos.y + 1, s.pos.z + 2 + Math.floor(j / 8)));
    await frames(3);
    var individuelsApres = vingt.filter(function (e) { return g.render.entityMeshes.has(e.eid); }).length;
    A.equal(individuelsApres, 0, 'en surnombre (20 moutons) : plus aucun n’a de maillage individuel propre');
    var info = g.render.instancesMobs.sheep;
    A.ok(info, 'une instance partagée existe pour l’espèce « sheep »');
    A.equal(info.mesh.count, 20, 'les 20 moutons sont tous représentés par l’instance : ' + info.mesh.count);
    A.ok(g.render.scene.children.indexOf(info.mesh) >= 0, 'l’instance est bien dans la scène rendue');
    var appels20 = g.render.metriquesDessin.appelsDessin;
    // 20 moutons en maillages individuels auraient coûté environ
    // 20 * coutParMob appels de plus qu'à vide ; l'instance partagée doit en
    // coûter une toute petite fraction de ça (marge généreuse : moins que
    // le coût de 8 moutons individuels, pour une seule espèce entière)
    A.lt(appels20 - appels0, coutParMob * 8, 'l’instance partagée coûte bien moins que 20 moutons individuels (mesuré : '
      + coutParMob.toFixed(1) + ' appels/mob individuel) : +' + (appels20 - appels0) + ' pour 20 moutons instanciés');

    vingt.forEach(function (e) { g.entities.remove(e); });
    await frames(1);
  });

  /* SPEC-RENDU-014 : culling grossier d'occlusion — vérifie que le mécanisme
     tourne réellement à chaque image dans le chemin de rendu normal (pas
     une fonction pure jamais appelée) : les compteurs exposés par render.js
     reflètent l'état courant, et une colonne de chunks franchement occluse
     par un relief proche perd sa visibilité. Le test géométrique exact
     (mur fabriqué, colonnes derrière) vit sous Node (tests/spec-rendu.js,
     logique pure de lointain.js) — ici, on vérifie l'intégration réelle sur
     le vrai terrain généré, en cherchant une pente assez raide pour masquer
     au moins une colonne derrière elle (comme les autres tests de
     géographie de cette suite, sur la graine fixe du monde de test). */
  e2e('SPEC-RENDU-014 : le culling d’occlusion tourne dans le chemin de rendu réel et masque des chunks derrière une pente raide', async function (g) {
    var s = await reset(g);
    s.flying = true;
    g.render.setDistance(8);
    g.streamChunks(true);
    for (var i = 0; i < 20; i++) await frames(1);
    A.gt(g.render.chunksCharges, 0, 'des chunks sont chargés');
    A.equal(typeof g.render.chunksOcclus, 'number', 'le compteur d’occlusion est bien tenu à jour par le rendu réel');
    // la grille de relief lointain (grilleLointaine, source du test
    // d'occlusion) se construit progressivement, par lots, au fil des
    // images (LOINTAIN_BUDGET, game.js) — on attend qu'elle soit prête,
    // comme les autres tests qui en dépendent (ex. « le relief lointain
    // est là » plus haut dans cette suite), avant de chercher une occlusion.
    for (var wi = 0; wi < 90 && !g.render.lointain; wi++) await frames(1);
    A.ok(g.render.lointain, 'la grille de relief lointain est prête');

    // recherche d’une position de caméra et d’un VRAI centre de chunk (grille
    // 16×16, comme `chunksActifs` en tiendra) réellement occlus par le relief
    // intermédiaire, avec le même test géométrique que le renderer
    // (`MC.Lointain.occlusionColonne`, appliqué à `echantillonLointain` —
    // exactement la source que `majLointain` donne à `grilleLointaine` en
    // jeu). Comme la recherche d’eau isolée de SPEC-RENDU-004 ci-dessus : un
    // relief même modeste (quelques blocs de dénivelé) occlut déjà une
    // colonne lointaine vue depuis une caméra proche du sol — pas besoin
    // d’une falaise franche pour un test représentatif. Bornée à 90 blocs
    // (dans le rayon de rendu réglé plus haut) pour être sûr que la cible
    // trouvée soit un chunk réellement chargé.
    var hauteurFn = function (x, z) { return g.world.echantillonLointain(x, z).h; };
    var trouve = null;
    for (var r = 4; r < 160 && !trouve; r += 4) {
      for (var a = 0; a < 24 && !trouve; a++) {
        var ang = a / 24 * 6.283;
        var bx = Math.round(s.pos.x + Math.cos(ang) * r), bz = Math.round(s.pos.z + Math.sin(ang) * r);
        var camPos = { x: bx, y: hauteurFn(bx, bz) + 2, z: bz };
        for (var ccx = -5; ccx <= 5 && !trouve; ccx++) {
          for (var ccz = -5; ccz <= 5 && !trouve; ccz++) {
            var cx = ccx * 16 + 8 + Math.round(bx / 16) * 16, cz = ccz * 16 + 8 + Math.round(bz / 16) * 16;
            if (Math.hypot(cx - camPos.x, cz - camPos.z) > 90) continue;
            var cibleH = hauteurFn(cx, cz);
            if (MC.Lointain.occlusionColonne(hauteurFn, camPos, cx, cz, cibleH, { pas: 16 })) {
              trouve = { camPos: camPos, cx: cx, cz: cz };
            }
          }
        }
      }
    }
    A.ok(trouve, 'une position de caméra et un centre de chunk réellement occlus existent sur cette graine');
    s.pos.x = trouve.camPos.x; s.pos.z = trouve.camPos.z; s.pos.y = trouve.camPos.y;
    s.yaw = Math.atan2(trouve.cx - trouve.camPos.x, trouve.cz - trouve.camPos.z); s.pitch = 0;
    g.streamChunks(true);
    for (var k = 0; k < 20; k++) await frames(1);
    A.gt(g.render.chunksOcclus, 0, 'au moins un chunk masqué par le relief : ' + g.render.chunksOcclus + '/' + g.render.chunksCharges);
    var invisibles = 0;
    g.world.chunks.forEach(function (c) {
      g.render.PASSES.forEach(function (p) { var m = c[p[0]]; if (m && !m.visible) invisibles++; });
    });
    A.gt(invisibles, 0, 'au moins un maillage de chunk réellement rendu invisible');

    // Correctif revue adversariale : l'occlusion n'est jamais APPLIQUÉE en
    // multi-vues, mais un chunk déjà masqué (visible=false hérité de la vue
    // unique juste avant) doit être réellement REND VISIBLE dès la bascule
    // en écran partagé — sinon un trou de terrain persiste pour tous les
    // joueurs, sans rapport avec ce que voit chacune des nouvelles caméras.
    fausseManette([{ axes: [0, 0, 0, 0] }]);
    g.composerEquipe(2, MC.Modes.regles('survie', 'facile'));
    await frames(3);
    var invisiblesApres = 0;
    g.world.chunks.forEach(function (c) {
      g.render.PASSES.forEach(function (p) { var m = c[p[0]]; if (m && !m.visible) invisiblesApres++; });
    });
    A.equal(invisiblesApres, 0, 'aucun chunk ne reste caché à tort après le passage en écran partagé : ' + invisiblesApres);
    soloRetabli(g); await frames(2);
  });

  /* SPEC-RENDU-004 : une nappe d'eau lointaine (au-delà du seuil interne) ne
     déclenche pas la réfraction ; approchée, elle la déclenche. */
  e2e('SPEC-RENDU-004 : la réfraction ne s’active qu’à moins d’une distance fixe de la caméra', async function (g) {
    var s = await reset(g);
    // palier de qualité plein (voir SPEC-EAU-008) : la charge des tests précédents ne doit pas couper la réfraction
    g.reinitialiserQualite();
    var cible = null;
    for (var r = 0; r < 400 && !cible; r += 4) for (var a2 = 0; a2 < 12 && !cible; a2++) {
      var x = Math.round(Math.cos(a2 / 12 * 6.283) * r), z = Math.round(Math.sin(a2 / 12 * 6.283) * r);
      var col = g.world.bio.colonne(x, z);
      if (col.eau - col.h >= 4) cible = { x: x, z: z, eau: col.eau };
    }
    A.ok(cible, 'une mer existe près du départ');
    s.flying = true;
    g.render.setDistance(6);
    // loin : l'eau est dans le champ (brouillard/distance de vue le permettent)
    // mais hors du seuil de réfraction — le terrain a d'autres points d'eau
    // (rivières, mares) éparpillés, donc on essaie plusieurs directions/
    // distances jusqu'à en trouver une vraiment isolée d'ici (déterministe
    // sur la graine fixe du monde de test, mais pas prévisible à l'avance)
    var offsets = [[70, 0], [150, 0], [0, 150], [-150, 0], [0, -150], [300, 0], [0, 300], [-300, 0]];
    var lointaine = false;
    for (var oi = 0; oi < offsets.length && !lointaine; oi++) {
      s.pos.x = cible.x + offsets[oi][0]; s.pos.z = cible.z + offsets[oi][1];
      s.pos.y = cible.eau + 30; s.pitch = -0.6; s.yaw = 0;
      g.streamChunks(true);
      for (var i = 0; i < 15; i++) await frames(1);
      if (g.render.eau.distance > 40) lointaine = true;
    }
    A.ok(lointaine, 'un point assez loin de toute eau a été trouvé : ' + g.render.eau.distance);
    A.equal(g.render.eau.refraction.value, 0, 'pas de réfraction à cette distance');
    // proche : la même mer, cette fois à portée — comme pour le point
    // lointain ci-dessus, on force le rechargement synchrone (streamChunks
    // en mode illimité) au lieu de compter sur le rattrapage progressif
    // (budgeté, potentiellement via Worker) de la boucle de jeu : sans ça,
    // le maillage d'eau proche de `cible` peut ne pas encore avoir été
    // regénéré/remaillé après l'excursion lointaine — et `eau.distance`
    // continue alors de désigner l'ancien maillage éloigné, de façon
    // dépendante du temps réel écoulé (relâche CPU/Worker), donc intermittente.
    s.pos.x = cible.x + 0.5; s.pos.z = cible.z + 0.5; s.pos.y = cible.eau + 4; s.pitch = -0.9;
    g.streamChunks(true);
    for (var j = 0; j < 20; j++) await frames(1);
    A.lt(g.render.eau.distance, 40, 'l’eau est maintenant à portée : ' + g.render.eau.distance);
    A.equal(g.render.eau.refraction.value, 1, 'la réfraction s’active');
    s.flying = false;
    await reset(g);
  });

  /* SPEC-RENDU-003 : sous un FPS p50 bas (injecté, jamais mesuré ici), la
     passe de réfraction (setRenderTarget vers la cible dédiée) ne se
     recalcule pas à chaque image. */
  e2e('SPEC-RENDU-003 : la fréquence de la passe de réfraction est plafonnée sous un FPS bas injecté', async function (g) {
    var s = await reset(g);
    var cible = null;
    for (var r = 0; r < 400 && !cible; r += 4) for (var a2 = 0; a2 < 12 && !cible; a2++) {
      var x = Math.round(Math.cos(a2 / 12 * 6.283) * r), z = Math.round(Math.sin(a2 / 12 * 6.283) * r);
      var col = g.world.bio.colonne(x, z);
      if (col.eau - col.h >= 4) cible = { x: x, z: z, eau: col.eau };
    }
    A.ok(cible, 'une mer existe près du départ');
    s.flying = true;
    s.pos.x = cible.x + 0.5; s.pos.z = cible.z + 0.5; s.pos.y = cible.eau + 4; s.pitch = -0.9;
    g.render.setDistance(5);
    g.streamChunks(true);
    for (var i = 0; i < 10; i++) await frames(1);
    A.gt(g.render.eau.enVue, 0, 'de l’eau dans le champ');
    // FPS p50 injecté bas : la même source que le panneau F3 (SPEC-RENDU-015)
    g.render.eau.options.fpsP50 = 10;
    // renderer.info compte aussi la carte d'ombres et d'autres passes : on
    // compte donc les appels À LA PASSE DE RÉFRACTION elle-même, exposés par
    // render.js, plutôt que d'espionner renderer.setRenderTarget en général
    var avant = g.render.eau.appelsRefraction, vuesRendues = 0;
    try {
      for (var k = 0; k < 40; k++) { g.render.renderViews(g.vues); vuesRendues++; }
    } finally {
      g.render.eau.options.fpsP50 = null;
    }
    var appels = g.render.eau.appelsRefraction - avant;
    A.ok(appels < vuesRendues, 'moins d’appels de réfraction que d’images rendues : ' + appels + '/' + vuesRendues);
    s.flying = false;
    await reset(g);
  });

  /* SPEC-RENDU-002 (revue adversariale de bf733bf) : Three.js n'a jamais
     détaché les anciens écouteurs 'dispose' de ses géométries au redémarrage
     du contexte GL — un dispose() tardif sur une géométrie de chunk créée
     AVANT la perte retombait sur l'ancien contexte et levait une erreur GL
     (« object does not belong to this context »), reproduit en direct avec
     ~200 avertissements sur 149 chunks. Ce test provoque le même scénario
     complet (perte → restauration → remaillage réel des chunks marqués dirty
     par onContextRestored, game.js) PUIS force la libération de tous les
     maillages d'entités (mobs) qui ont survécu à la perte sans être
     reconstruits — c'est ce second cas qui a d'abord échappé à la première
     version de ce correctif (`libererEntite` ne posait aucune garde de
     génération, contrairement à `disposerGeom` pour les chunks), reproduit
     par ~40 avertissements sous deux pertes de contexte successives.
     Note technique : intercepter console.warn/console.error NE SUFFIT PAS
     ici — l'avertissement « object does not belong to this context » est
     émis directement par la couche de validation WebGL du navigateur (pas
     par un appel JS console.warn de Three.js), donc invisible à un simple
     monkey-patch de console. On vérifie à la place l'état d'erreur GL réel
     via gl.getError(), qui EST mis à jour par ces appels invalides. */
  e2e('SPEC-RENDU-002 : perte, restauration, remaillage des chunks et libération des entités survivantes ne lèvent aucune erreur GL', async function (g) {
    await reset(g);
    var gl = g.render.renderer.getContext();
    var ext = gl.getExtension('WEBGL_lose_context');
    A.ok(ext, 'l’extension de simulation est disponible dans ce navigateur');
    g.render.setDistance(4);
    g.streamChunks(true);
    for (var i = 0; i < 15; i++) await frames(1);
    A.gt(g.world.chunks.size, 0, 'des chunks sont chargés avant la perte (' + g.world.chunks.size + ')');
    while (gl.getError() !== gl.NO_ERROR) { /* purge tout code d'erreur résiduel avant de mesurer */ }

    ext.loseContext();
    await frames(3);
    ext.restoreContext();
    await frames(5);
    // tous les chunks visibles sont marqués dirty par onContextRestored
    // (game.js) ; remeshDirtyNear() n'en remaille que 3 par image, on
    // laisse donc tourner assez d'images pour tous les rattraper. Le monde
    // continue de tourner pendant ce temps (mobs qui apparaissent) : ils
    // sont d'abord RENDUS sous le nouveau contexte sans être reconstruits
    // (survivent à la perte), exactement le cas visé par `libererEntite`.
    var tours = Math.ceil(g.world.chunks.size / 3) + 15;
    for (var k = 0; k < tours; k++) await frames(1);
    // force la libération de toute entité encore suivie (mob, figurant…) —
    // certaines ont pu être créées avant la perte et seulement re-rendues
    // depuis (jamais reconstruites), le cas que `libererEntite` doit garder.
    g.render.libererToutesEntites();

    var codes = [];
    var e;
    while ((e = gl.getError()) !== gl.NO_ERROR) codes.push(e);
    A.equal(codes.length, 0, 'aucune erreur GL après perte/restauration/remaillage/libération des entités (' + codes.join(',') + ')');
  });

  /* SPEC-RENDU-002 (revue, point 2) : la carte d'ombres du soleil (FBO
     interne à Three.js) n'était jamais reconstruite après restauration —
     `sun.shadow.map` reste abandonné (jamais dispose()) puis Three.js le
     régénère tout seul dès le premier rendu avec `castShadow` actif. */
  e2e('SPEC-RENDU-002 : la carte d’ombres du soleil se reconstruit après restauration du contexte', async function (g) {
    await reset(g);
    var gl = g.render.renderer.getContext();
    var ext = gl.getExtension('WEBGL_lose_context');
    A.ok(ext, 'l’extension de simulation est disponible');
    g.render.setDistance(3);
    g.streamChunks(true);
    for (var i = 0; i < 10; i++) await frames(1);
    A.ok(g.render.ombresActives, 'les ombres sont actives par défaut');
    g.render.renderViews(g.vues);
    var carteAvant = g.render.sun.shadow.map;
    A.ok(carteAvant, 'une carte d’ombres existe avant la perte');
    ext.loseContext();
    await frames(3);
    ext.restoreContext();
    // la boucle de jeu normale tourne pendant ces images (game.js) : elle a
    // déjà pu redessiner (et donc reconstruire la carte) avant qu'on
    // revienne ici — on vérifie donc la RECONSTRUCTION (nouvelle instance),
    // pas un instant `null` qu'un rendu concurrent aurait déjà comblé.
    await frames(5);
    var carteApres = g.render.sun.shadow.map;
    A.ok(carteApres, 'la carte d’ombres est reconstruite après restauration');
    A.ok(carteApres !== carteAvant, 'c’est une NOUVELLE carte, pas l’ancienne réutilisée après un contexte périmé');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Outillage de test — banc navigateur (L42)
  // ══════════════════════════════════════════════════════════════════════════
  /* SPEC-BANC-009/011 : un test à deux étapes déclarées doit produire au
     moins quatre captures (début, deux étapes, fin) et faire apparaître ses
     libellés dans l'ordre — c'est `runUnE2E` qui les collecte, ce test ne
     fait qu'appeler `etape()` comme n'importe quel test réel le ferait. */
  e2e('SPEC-BANC-009 : les étapes déclarées apparaissent avant la fin du test',
    { teste: 'les points de progression e2e', pourquoi: 'le banc doit suivre un test en cours, pas seulement son résultat final',
      attendu: 'deux etape() posent deux entrées horodatées, dans l\'ordre' },
    async function (g) {
      await reset(g);
      etape('préparation');
      await frames(2);
      etape('action', 1, 2);
      await frames(2);
      etape('vérification', 2, 2);
      A.ok(true, 'trois étapes déclarées sans lever d\'exception');
    });

  /* SPEC-BANC-077 à 081 : `T.etape('nom')` (à ne pas confondre avec `etape()`
     ci-dessus, SPEC-BANC-009, la progression en direct) ouvre une étape et
     ferme la précédente — un test qui en déclare DEUX doit produire TROIS
     étapes au total dans son historique de triplets (l'implicite `test`,
     puis les deux déclarées, la dernière fermant l'implicite). Vérifié via
     un FAUX test imbriqué (même patron que SPEC-BANC-010 ci-dessous) : ce
     test-ci inspecte directement `res.etapesTriplets`/`res.captures`, ce
     qu'aucun test normal ne peut faire depuis l'intérieur de sa propre
     fonction (le résultat n'existe qu'une fois le test terminé). */
  e2e('SPEC-BANC-077 à 081 : T.etape() produit trois étapes (implicite + deux déclarées) avec un triplet réel à chaque bord',
    { teste: 'l\'API T.etape() et les triplets d\'images qu\'elle capture',
      pourquoi: 'sans vérification directe de la structure produite, une régression dans le chaînage des étapes ou la capture des triplets passerait inaperçue',
      attendu: 'etapesTriplets = [test, a, b] ; chaque étape a un triplet de début ET de fin (sauf la dernière, fermée par la fin du test) ; chaque triplet a 3 images de numéros consécutifs' },
    async function (g) {
      await reset(g);
      var enComptePrecedent = enCours;
      var faux = {
        id: 'demo-etapes-interne', name: 'faux test à deux étapes (interne, jamais listé dans une vraie campagne)',
        fn: async function () {
          await frames(2);
          T.etape('a');
          await frames(2);
          T.etape('b');
          await frames(2);
        },
      };
      var res = await runUnE2E(g, faux, { delaiDefaut: 30 });
      enCours = enComptePrecedent;
      A.equal(res.etat, 'reussi', 'le faux test se termine normalement : ' + res.message);
      A.equal(res.etapesTriplets.length, 3, 'trois étapes au total : ' + JSON.stringify(res.etapesTriplets.map(function (e) { return e.nom; })));
      A.equal(res.etapesTriplets.map(function (e) { return e.nom; }).join(','), 'test,a,b', 'implicite « test » puis les deux déclarées, dans l\'ordre');
      // les trois étapes sont FERMÉES (test par T.etape('a'), a par T.etape('b'),
      // b par la fin du test) : chacune porte un score d'instabilité de
      // début ET de fin (SPEC-BANC-081) — un nombre, jamais négatif.
      res.etapesTriplets.forEach(function (e) {
        A.ok(e.instabilite_debut && typeof e.instabilite_debut.pixels === 'number' && e.instabilite_debut.pixels >= 0,
          'étape « ' + e.nom + ' » : instabilité de début — ' + JSON.stringify(e.instabilite_debut));
        A.ok(e.instabilite_fin && typeof e.instabilite_fin.pixels === 'number' && e.instabilite_fin.pixels >= 0,
          'étape « ' + e.nom + ' » : instabilité de fin — ' + JSON.stringify(e.instabilite_fin));
        A.ok(e.metriques && typeof e.metriques.fps_moy === 'number', 'étape « ' + e.nom + ' » : métriques par étape (SPEC-BANC-087)');
      });
      // identité (SPEC-BANC-080) et contenu (SPEC-BANC-078/079) sur UN triplet,
      // retrouvé dans `res.captures` — la forme réellement exposée/persistée
      // (celle que le registre relit, tools/registre.js construireCaptures).
      var capturesTriplet = res.captures.filter(function (c) { return c.role === 'triplet'; });
      A.equal(capturesTriplet.length, 18, '6 étapes-bords (test, a, b, chacune début+fin) × 3 images = 18 captures triplet : ' + capturesTriplet.length);
      var t0 = capturesTriplet.filter(function (c) { return c.etape === 'test' && c.bord === 'debut'; }).sort(function (a, b) { return a.rang - b.rang; });
      A.equal(t0.length, 3, 'triplet « test » début : 3 images');
      A.equal(t0.map(function (c) { return c.rang; }).join(','), '0,1,2', 'rangs 0,1,2 dans l\'ordre');
      var numeros = t0.map(function (c) { return c.numero_image; });
      A.ok(numeros[1] === numeros[0] + 1 && numeros[2] === numeros[1] + 1, 'numéros d\'image consécutifs : ' + numeros);
      t0.forEach(function (c) {
        A.ok(c.pose && c.pose.camera && typeof c.pose.camera.x === 'number', 'chaque image porte la pose de la caméra');
        A.ok(typeof c.t_ms === 'number', 'chaque image porte son horodatage (t_ms)');
        A.ok(typeof c.duree_image_ms === 'number', 'chaque image porte la durée depuis la précédente');
        A.ok(c.instabilite && typeof c.instabilite.pixels === 'number' && c.instabilite.pixels >= 0, 'score d\'instabilité pixels : nombre ≥ 0');
        A.ok(typeof c.instabilite.pose === 'number' && c.instabilite.pose >= 0, 'score d\'instabilité de pose : nombre ≥ 0');
      });
    });

  /* SPEC-OPTION-008 : l'espace de rendu (rendu, HUD, menus) ne descend
     jamais sous 800×600 — on rétrécit l'hôte réel (celui que reçoit
     `MC.createGame`, parent de la surface interne `.mc-surface`) bien en
     dessous et on vérifie que la surface garde le plancher, réduite à
     l'échelle plutôt qu'étirée plus petite. */
  e2e('SPEC-OPTION-008 : l\'espace de rendu ne descend jamais sous 800×600', async function (g) {
    await reset(g);
    var surface = g.render.renderer.domElement.parentElement;
    var host = surface.parentElement;
    var stylePrec = host.getAttribute('style') || '';
    host.style.width = '640px';
    host.style.height = '400px';
    window.dispatchEvent(new Event('resize'));
    await frames(2);
    try {
      A.equal(surface.clientWidth, 800, 'la surface garde au moins 800 de large');
      A.equal(surface.clientHeight, 600, 'et 600 de haut, malgré un hôte de 640×400');
      A.ok(/scale\(/.test(surface.style.transform), 'affichage réduit par transform: scale(), pas étiré');
      var echelleAttendue = Math.min(640 / 800, 400 / 600); // 0.667 : la hauteur est limitante ici
      var m = surface.style.transform.match(/scale\(([\d.]+)\)/);
      A.close(parseFloat(m[1]), echelleAttendue, 0.01, 'échelle correcte (rapport d\'aspect conservé)');
      // les clics restent justes malgré la réduction : le bouton du menu répond
      g.input.setState('menu');
      await frames(2);
      var btn = document.querySelector('#btn-nouvelle');
      A.ok(btn, 'bouton « Nouvelle partie » présent');
      var r = btn.getBoundingClientRect();
      A.gt(r.width, 0, 'taille visuelle non nulle malgré la réduction');
      // le point central du bouton doit bien désigner LE bouton (pas un
      // voisin ni la transformation qui l'aurait décalé) : c'est ce que le
      // navigateur utilise pour router un vrai clic.
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var cible = document.elementFromPoint(cx, cy);
      A.ok(cible && (cible === btn || btn.contains(cible)), 'le point central du bouton reste cliquable sous transformation CSS');
    } finally {
      if (stylePrec) host.setAttribute('style', stylePrec); else host.removeAttribute('style');
      window.dispatchEvent(new Event('resize'));
      await frames(2);
    }
  });

  /* SPEC-BANC-010 (révisé) : le délai par test est un FILET DE SÉCURITÉ
     contre un test qui ne rend JAMAIS la main (deadlock) — un test qui
     appelle etape() en boucle sans jamais rendre la main —, pas un couperet
     pour un test simplement lent : un test lent continue jusqu'à SON vrai
     résultat (ok/échec), signalé au passage dans la zone des lents (un
     avertissement, jamais une cause d'échec). Le défaut (15 min) est
     délibérément généreux ; `fiche.delai` (en secondes) le réduit pour un
     test qui a vraiment besoin de moins.

     Ce test-ci vérifie le mécanisme EN INTERNE, sur un FAUX test qui ne se
     termine jamais, appelé directement via runUnE2E() — il ne bloque plus
     lui-même. Avant une réécriture antérieure, il se bloquait réellement
     (comme n'importe quel test réel) : dans une vraie campagne, il
     ressortait donc TOUJOURS à l'état 'delai', ce qui compte comme un échec
     de campagne — un test dont le rôle est de VÉRIFIER le mécanisme de délai
     n'a pas à dépendre de ce même mécanisme pour son propre verdict. Cette
     réécriture a aussi mis au jour un vrai bug ailleurs : `fiche.delai` ne
     survivait pas au passage par le catalogue (tests/catalogue.js,
     ficheDe()) — le test bloqué tournait donc à son délai PAR DÉFAUT plutôt
     qu'à celui de sa fiche, jusqu'à être arrêté plus brutalement par le
     tueur externe (tools/e2e-headless.js) — corrigé séparément. */
  e2e('SPEC-BANC-010 : un test bloqué est coupé à son délai',
    { teste: 'le délai par test (fiche.delai, en secondes)',
      pourquoi: 'un test qui ne rend jamais la main ne doit pas geler la campagne ; son délai propre doit être lu depuis la fiche telle qu\'elle arrive par le catalogue, pas seulement depuis sa déclaration dans tests/e2e.js',
      attendu: 'le faux test bloqué ressort à l\'état "delai", coupé à SON délai (pas le délai par défaut), avec son étape rapportée ; ce test-ci, lui, reste vert' },
    async function (g) {
      await reset(g);
      var enComptePrecedent = enCours; // restauré après l'appel imbriqué (voir plus bas)
      var bloque = {
        id: 'demo-delai-interne', name: 'faux test bloqué (interne, jamais listé dans une vraie campagne)',
        fiche: { delai: 0.3 },
        fn: async function () {
          etape('bloqué ici volontairement');
          await new Promise(function () { /* ne se résout jamais : le délai doit couper */ });
        },
      };
      var t0 = ahora();
      var res = await runUnE2E(g, bloque, { delaiDefaut: 30 });
      enCours = enComptePrecedent;
      A.equal(res.etat, 'delai', 'l\'état rapporté par le faux test est "delai"');
      A.lt(ahora() - t0, 5000, 'coupé à SON délai (0,3 s) et non au délai par défaut (30 s) : ' + (ahora() - t0) + ' ms');
      A.ok(res.etapes.length > 0 && res.etapes[res.etapes.length - 1].libelle === 'bloqué ici volontairement',
        'l\'étape en cours au moment de la coupure est rapportée');
      A.ok(/délai dépassé/.test(res.message || ''), 'le message dit « délai dépassé » : ' + res.message);
    });

  /* SPEC-BANC-017 : MC_DEBUG pilote le rendu intégré, à la main comme par un
     test — téléportation, heure, saison, météo, distance de vue, plein
     panneau puis retour, capture. */
  e2e('SPEC-BANC-017 : MC_DEBUG pilote le jeu comme un test le ferait', async function (g) {
    await reset(g);
    var d = MC.Debug.creer(g);
    var av = d.teleporter(g.player.state.pos.x + 5, g.player.state.pos.z + 5);
    A.close(g.player.state.pos.x, av.x, 1e-6, 'téléportation en X appliquée');
    A.close(g.player.state.pos.z, av.z, 1e-6, 'téléportation en Z appliquée');

    var t = d.heure(6);
    A.ok(t >= 0, 'heure réglée (' + t + ')');

    var avantD = g.render.RENDER_DIST;
    d.distanceVue(3);
    A.equal(g.render.RENDER_DIST, 3, 'distance de vue changée');
    d.distanceVue(avantD);

    var cv = g.render.renderer.domElement;
    var rAvant = cv.getBoundingClientRect();
    var panneau = document.createElement('div');
    panneau.style.cssText = 'position:fixed;top:0;left:0;width:300px;height:200px;';
    document.body.appendChild(panneau);
    A.ok(d.agrandir(panneau), 'passage en plein panneau');
    A.ok(d.estAgrandi, 'état agrandi');
    A.ok(d.reduire(), 'retour à la taille normale');
    A.notOk(d.estAgrandi, 'état réduit');
    document.body.removeChild(panneau);
    var rApres = cv.getBoundingClientRect();
    A.close(rApres.width / rApres.height, rAvant.width / rAvant.height, 0.05, 'rapport d\'aspect rétabli');

    var img = d.capture();
    A.ok(typeof img === 'string' && img.indexOf('data:image/jpeg') === 0, 'capture manuelle produite');
  });

  /* SPEC-BANC-016 : la fin d'un test referme ce qu'il a laissé ouvert. On
     ouvre volontairement l'inventaire sans le refermer : `runUnE2E` doit
     nettoyer derrière lui. */
  e2e('SPEC-BANC-016 : le nettoyage de fin de test referme dialogues et écrans laissés ouverts', async function (g) {
    await reset(g);
    key('KeyE');
    await frames(2);
    A.equal(g.input.state, 'ui', 'inventaire ouvert, volontairement laissé ainsi');
    var dlg = document.querySelector('.dialogue-histoire');
    if (dlg) dlg.style.display = 'flex';
    G.nettoyerE2E(g);
    A.equal(g.input.state, 'menu', 'l\'état de jeu est remis à un état connu');
    if (dlg) A.equal(dlg.style.display, 'none', 'le dialogue d\'histoire résiduel est refermé');
    await reset(g);
  });

  /* SPEC-BANC-007 : le menu de sélection ne doit jamais rester ouvert par-
     dessus la liste des tests une fois une action de lancement faite —
     sinon il lui vole sa hauteur (retour testeur). Test de PAGE (pas de
     partie réelle) : il vérifie le chrome du banc lui-même via la poignée
     que tests/banc-ui.js expose sur `window.MC_BANC`.

     Note : on n'appelle pas réellement `btn-lancer.click()` ici — ce test
     s'exécute LUI-MÊME au sein d'une campagne (`etat.enCours` est déjà vrai),
     et `lancer()` est délibérément non réentrant ; vider/reconstruire la
     sélection partagée en pleine campagne d'englobante fausserait aussi son
     résumé. On vérifie donc directement `refermerSelection` — la fonction
     que PARTAGENT tous les boutons d'action (Lancer, Tout, échecs, ouvrir
     un test, une vignette…) pour refermer le menu (voir tests/banc-ui.js). */
  e2e('SPEC-BANC-007 : le menu de sélection se referme après une action de lancement', async function () {
    if (!window.MC_BANC) return; // hors du banc (ne devrait pas arriver ici)
    var B2 = window.MC_BANC;
    B2.refs.panneauSel.hidden = false;
    A.equal(B2.refs.panneauSel.hidden, false, 'panneau ouvert au départ');
    B2.refermerSelection();
    A.equal(B2.refs.panneauSel.hidden, true, 'refermerSelection() referme bien le panneau');
  });

  /* SPEC-BANC-033/035/036/037/038/040 (docs/banc/historique-global.md §3.1) :
     ouvre la zone Historique global, vérifie qu'un tri et un filtre rapide
     changent réellement l'affichage (donc que les routes serveur
     /tests/historique/* répondent et que tests/historique.js les exploite),
     puis que l'export CSV produit un fichier cohérent avec les colonnes
     affichées. `attendreCondition` poll une petite fonction plutôt qu'un
     délai fixe : le temps de réponse réseau n'est pas garanti d'une machine
     à l'autre. */
  function attendreCondition(fn, timeoutMs) {
    var t0 = ahora();
    function boucle() {
      if (fn()) return Promise.resolve();
      if (ahora() - t0 > (timeoutMs || 8000)) return Promise.reject(new Error('condition non atteinte à temps'));
      return wait(60).then(boucle);
    }
    return boucle();
  }
  e2e('SPEC-BANC-033/035/036/037/038 : la zone Historique s\'ouvre, trie, filtre et exporte la vue filtrée',
    { teste: 'la zone « Historique global » du banc (tableau, tri, filtres rapides, export)',
      pourquoi: 'sans un vrai test qui clique dans la page, une régression dans le câblage DOM ↔ routes serveur (tests/historique.js ↔ tools/historique.js/server.js) passerait inaperçue malgré des tests Node purs tous verts',
      attendu: 'le bouton "Historique" ouvre la zone et charge des lignes ; cliquer un en-tête trie (flèche affichée) ; le filtre rapide "Échecs" ne garde que des lignes d\'état échec (ou aucune) ; l\'export CSV produit un texte dont l\'en-tête correspond aux colonnes affichées' },
    async function () {
      if (!window.MC_HISTORIQUE) { A.ok(false, 'window.MC_HISTORIQUE absent — tests/historique.js non chargé par tests/index.html'); return; }
      var zone = document.getElementById('zone-historique');
      A.equal(zone.hidden, true, 'la zone est fermée par défaut (aucun diaporama/tableau ouvert sans action)');

      var btn = document.getElementById('btn-historique');
      A.ok(btn, 'bouton « Historique » présent dans l\'en-tête du banc');
      btn.click();
      A.equal(zone.hidden, false, 'la zone s\'ouvre après le clic');

      // La vue officielle démarre sur « inscrits seulement » (SPEC-BANC-037) :
      // un dépôt de développement peut n'avoir AUCUNE entrée encore promue au
      // registre versionné (seulement des cahiers locaux) — ce test bascule
      // donc sur « tous les runs » pour garantir des données, plutôt que de
      // supposer le registre non vide (ce qui varie d'un poste à l'autre).
      var btnTous = zone.querySelector('[data-rapide="tous"]');
      A.ok(btnTous, 'bouton de filtre rapide « Tous les runs » présent');
      btnTous.click();
      try {
        await attendreCondition(function () {
          var tbody = zone.querySelector('#hist-table tbody');
          return !!(tbody && tbody.children.length && tbody.textContent.trim() !== '' && tbody.textContent.indexOf('aucune ligne') < 0);
        }, 8000);
      } catch (e) {
        var diag = null;
        try { diag = await (await fetch('/tests/historique/lignes?rapide=tous&filtre=%7B%7D&page=1&taille=5')).text(); } catch (e2) { diag = 'fetch a échoué : ' + e2.message; }
        A.ok(false, 'délai dépassé en attendant des lignes — tbody=' + JSON.stringify((zone.querySelector('#hist-table tbody') || {}).innerHTML || '').slice(0, 400) + ' ; requête directe=' + String(diag).slice(0, 400));
      }
      var lignesInitiales = zone.querySelectorAll('#hist-table tbody tr').length;
      A.gt(lignesInitiales, 0, 'le tableau affiche au moins une ligne une fois « tous les runs » actif (cahiers locaux au moins)');

      // ── tri (SPEC-BANC-035) : cliquer l'en-tête « État », visible par défaut.
      // Chaque rafraîchissement RECONSTRUIT le <thead> (rendreEntetes()) : les
      // <th> sont donc remplacés à chaque clic — on les requiert à chaque fois
      // depuis le DOM plutôt que de garder une référence, sous peine d'inspecter
      // un nœud détaché qui ne verra jamais la flèche apparaître.
      function entetesTri() { return Array.prototype.slice.call(zone.querySelectorAll('#hist-table thead tr:first-child th')); }
      function entete(nom) { return entetesTri().filter(function (th) { return th.textContent.indexOf(nom) === 0; })[0]; }
      A.ok(entete('État'), 'colonne « État » visible par défaut : ' + entetesTri().map(function (t) { return t.textContent; }).join(' | '));
      entete('État').click();
      await attendreCondition(function () { var th = entete('État'); return !!th && /▲/.test(th.textContent); }, 5000);
      A.ok(/▲/.test(entete('État').textContent), 'flèche de tri croissant affichée après le premier clic');

      // ── filtre rapide (SPEC-BANC-037) : « Échecs » ne garde que des lignes d'état échec
      var btnEchecs = zone.querySelector('[data-rapide="echecs"]');
      A.ok(btnEchecs, 'bouton de filtre rapide « Échecs » présent');
      btnEchecs.click();
      // le clic pose « chargement… » AU MÊME INSTANT (synchrone) : attendre que ce texte parte, c'est attendre la réponse
      // du serveur et le tableau redessiné — comparer au texte d'avant passait trop tôt (tableau encore celui d'avant)
      await attendreCondition(function () { return zone.querySelector('#hist-page-info').textContent !== 'chargement…'; }, 8000);
      var lignesApres = Array.prototype.slice.call(zone.querySelectorAll('#hist-table tbody tr'));
      var toutesEchecOuVide = lignesApres.length === 0 || lignesApres.every(function (tr) {
        return tr.className.indexOf('etat-echec') >= 0 || tr.textContent.indexOf('aucune ligne') >= 0;
      });
      A.ok(toutesEchecOuVide, 'après le filtre rapide « Échecs », toutes les lignes affichées sont en échec (ou la liste est vide)');

      // ── export CSV (SPEC-BANC-038) : intercepte le Blob avant le téléchargement
      // réel pour vérifier que son en-tête correspond aux colonnes affichées,
      // sans dépendre d'un répertoire de téléchargement particulier.
      var blobCapture = null;
      var ancienCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = function (blob) { blobCapture = blob; return ancienCreateObjectURL.call(URL, blob); };
      try {
        var btnCsv = document.getElementById('hist-export-csv');
        A.ok(btnCsv, 'bouton « Export CSV » présent');
        btnCsv.click();
        await attendreCondition(function () { return blobCapture !== null; }, 8000);
        var texte = await blobCapture.text();
        var premiereLigne = texte.split('\n')[0];
        A.ok(/État/.test(premiereLigne) || /Nom du test/.test(premiereLigne), 'l\'en-tête CSV contient des libellés de colonnes affichées : ' + premiereLigne);
      } finally {
        URL.createObjectURL = ancienCreateObjectURL;
      }

      // remise à zéro pour ne pas laisser la zone ouverte ni filtrée (SPEC-BANC-016)
      document.getElementById('hist-rapide-inscrits').checked = true;
      document.getElementById('hist-rapide-inscrits').dispatchEvent(new Event('change'));
      document.getElementById('hist-fermer').click();
      A.equal(zone.hidden, true, 'la zone se referme');
    });

  // ══════════════════════════════════════════════════════════════════════════
  // B3 — génération et maillage en Web Workers (SPEC-PERF-004 à 010, 014)
  // ══════════════════════════════════════════════════════════════════════════

  /* Téléporte loin (des chunks jamais visités, donc jamais en cache) et
     laisse `n` images s'écouler pour que le streaming (workers OU repli)
     les rattrape. Un seuil « calibré » : on mesure d'abord le temps réel du
     premier lot sur CETTE machine/CE navigateur, puis on vérifie que la
     suite ne s'en écarte pas dans des proportions déraisonnables — un seuil
     absolu ferait clignoter la porte sur une machine plus lente ou un rendu
     logiciel (@lent, voir plus bas). */
  function coinInexplore() {
    // un point différent à chaque appel : deux tests qui l'utilisent tous
    // les deux ne se marchent pas dessus (l'un n'a pas déjà chargé les
    // chunks de l'autre)
    coinInexplore.n = (coinInexplore.n || 0) + 1;
    var loin = 200000 + coinInexplore.n * 4096;
    return [loin, loin];
  }

  /* Compte, parmi les chunks VOULUS autour d'un centre donné, combien sont
     déjà chargés (ou déjà maillés). Mesurer sur `g.world.chunks.size` tout
     court serait faussé : `world.unloadLoin` décharge en une seule fois,
     dans la MÊME image, tous les chunks de l'ancienne position (des
     centaines après quelques tests précédents), pendant que les nouveaux
     n'arrivent qu'au compte-gouttes — la taille totale du monde peut rester
     négative pendant des dizaines d'images alors que le streaming autour du
     nouveau centre fonctionne parfaitement. */
  function chunksVoulusCharges(g, centre, R) {
    var voulus = g.world.chunksVoulus([centre], R);
    var n = 0;
    voulus.forEach(function (v) { if (g.world.chunks.has(g.world.key(v[1], v[2]))) n++; });
    return n;
  }
  function maillesVoulusCharges(g, centre, R) {
    var voulus = g.world.chunksVoulus([centre], R);
    var n = 0;
    voulus.forEach(function (v) {
      var c = g.world.chunks.get(g.world.key(v[1], v[2]));
      if (c && (c.mesh || c.meshC || c.meshT || c.meshL)) n++;
    });
    return n;
  }

  e2e('SPEC-PERF-004 : temps du thread principal pour 20 chunks sous le budget calibré',
      async function (g) {
    await reset(g);
    var lent = g.render.materiel && g.render.materiel.renduLogiciel;
    var pt = coinInexplore();
    g.render.setDistance(5);
    var s = g.player.state;
    s.pos.x = pt[0]; s.pos.z = pt[1];
    var centre = [Math.floor(pt[0] / 16), Math.floor(pt[1] / 16)];
    var avant = chunksVoulusCharges(g, centre, 5);
    A.equal(avant, 0, 'endroit vraiment inexploré au départ');
    var t0 = performance.now();
    var images = 0;
    while (chunksVoulusCharges(g, centre, 5) - avant < 20 && images < 400) { await frames(1); images++; }
    var ms = performance.now() - t0;
    A.gt(chunksVoulusCharges(g, centre, 5) - avant, 0, 'au moins un chunk généré à cet endroit inexploré');
    // budget large et délibérément permissif (rendu logiciel possible en CI) :
    // ce test surveille une RÉGRESSION grossière (blocage du thread
    // principal), pas une performance de pointe
    var budget = lent ? 60000 : 15000;
    A.lt(ms, budget, 'thread principal pas bloqué pour ~20 chunks (' + Math.round(ms) + ' ms, budget ' + budget + ' ms)' +
         (lent ? ' [rendu logiciel]' : ''));
  });

  e2e('SPEC-PERF-007 : temps de maillage du thread principal sous le budget calibré',
      async function (g) {
    await reset(g);
    var lent = g.render.materiel && g.render.materiel.renduLogiciel;
    var pt = coinInexplore();
    g.render.setDistance(5);
    var s = g.player.state;
    s.pos.x = pt[0]; s.pos.z = pt[1];
    var centre = [Math.floor(pt[0] / 16), Math.floor(pt[1] / 16)];
    var avantMailles = maillesVoulusCharges(g, centre, 5);
    var t0 = performance.now();
    var images = 0;
    while (maillesVoulusCharges(g, centre, 5) - avantMailles < 15 && images < 400) { await frames(1); images++; }
    var ms = performance.now() - t0;
    A.gt(maillesVoulusCharges(g, centre, 5) - avantMailles, 0, 'au moins un chunk maillé et affiché');
    var budget = lent ? 60000 : 15000;
    A.lt(ms, budget, 'thread principal pas bloqué pour le maillage (' + Math.round(ms) + ' ms, budget ' + budget + ' ms)' +
         (lent ? ' [rendu logiciel]' : ''));
  });

  /* SPEC-PERF-008 : un tampon TRANSFÉRÉ à un worker est détaché côté
     émetteur (byteLength retombe à 0) — on le vérifie directement sur
     l'instantané des voisins que game.js transfère à chaque `maille`. */
  e2e('SPEC-PERF-008 : le tampon d\'origine des voisins est détaché après le postMessage vers le worker de maillage', async function (g) {
    await reset(g);
    if (!MC.Workers || !MC.Workers.disponible()) return;  // rien à vérifier sans Worker (SPEC-PERF-006 le couvre)
    var pt = coinInexplore();
    g.render.setDistance(4);
    var s = g.player.state;
    s.pos.x = pt[0]; s.pos.z = pt[1];
    for (var i = 0; i < 30 && g.world.chunks.size < 4; i++) await frames(1);
    var cx = Math.floor(s.pos.x / 16), cz = Math.floor(s.pos.z / 16);
    for (var j = 0; j < 60 && !g.world.voisinsCharges(cx, cz); j++) await frames(1);
    if (!g.world.voisinsCharges(cx, cz)) return;   // terrain trop lent à charger sur cette machine : test non concluant
    var voisins = MC.TachesChunks.instantaneVoisins(g.world, cx, cz);
    var transferables = MC.ContratsV2.transferablesDe({ voisins: voisins });
    A.gt(transferables.length, 0, 'au moins un tampon à transférer');
    var buf0 = transferables[0];
    A.gt(buf0.byteLength, 0, 'le tampon a un contenu avant transfert');
    // un canal MessageChannel local : postMessage AVEC transfert détache
    // le tampon exactement comme le ferait Worker.postMessage
    var mc = new MessageChannel();
    mc.port1.postMessage(null, transferables);
    A.equal(buf0.byteLength, 0, 'le tampon d\'origine est détaché après le transfert');
  });

  /* SPEC-PERF-014 : remailler 100 fois le même chunk ne doit pas créer 100
     géométries — la capacité est réutilisée tant qu'elle suffit. */
  e2e('SPEC-PERF-014 : 100 remaillages du même chunk — géométries créées bornées', async function (g) {
    await reset(g);
    g.render.setDistance(4);
    g.streamChunks(true);
    var c = g.world.chunks.get(g.world.key(Math.floor(g.player.state.pos.x / 16), Math.floor(g.player.state.pos.z / 16)));
    A.ok(c, 'un chunk existe sous le joueur');
    var avant = g.render.perf().geometriesCreees;
    for (var i = 0; i < 100; i++) {
      c.dirty = true;
      g.render.syncChunk(g.world, c);
    }
    var creees = g.render.perf().geometriesCreees - avant;
    // la toute première réécriture peut agrandir la géométrie (capacité de
    // départ éventuellement nulle) : on tolère une poignée de recréations,
    // jamais 100
    A.lt(creees, 10, '100 remaillages du même chunk créent très peu de géométries (' + creees + ')');
  });

  /* SPEC-PERF-006 : sans Worker (globale retirée AVANT la création du jeu),
     le monde se génère et s'affiche quand même — repli synchrone complet.
     Un second jeu, isolé, dans un hôte hors écran : on ne touche pas à
     `window.GAME` (partagé par toute la campagne). */
  e2e('SPEC-PERF-006 : sans Worker (globale retirée avant création du jeu) le monde se génère et s\'affiche',
      async function () {
    var VraiWorker = window.Worker;
    var host2 = document.createElement('div');
    host2.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:800px;height:600px;';
    document.body.appendChild(host2);
    var g2 = null;
    try {
      delete window.Worker;                 // MC.Workers.disponible() doit s'en apercevoir
      g2 = MC.createGame(host2);
      g2.input.setState('playing');
      for (var i = 0; i < 10; i++) await frames(1);
      A.gt(g2.world.chunks.size, 5, 'des chunks sont générés sans Worker (' + g2.world.chunks.size + ')');
      var meshes = 0;
      g2.world.chunks.forEach(function (c) { if (c.mesh || c.meshC || c.meshT || c.meshL) meshes++; });
      A.gt(meshes, 0, 'au moins un chunk est maillé et affiché sans Worker');
      g2.render.render();
      A.gt(g2.render.renderer.info.render.calls, 0, 'un vrai rendu a eu lieu');
    } finally {
      if (VraiWorker !== undefined) window.Worker = VraiWorker;
      // un second contexte WebGL, jamais rendu à personne : le libérer tout
      // de suite évite d'épuiser la poignée de contextes que le navigateur
      // accorde à une page pendant le reste de la campagne e2e
      if (g2 && g2.render && g2.render.renderer) {
        try { if (g2.render.renderer.forceContextLoss) g2.render.renderer.forceContextLoss(); } catch (e) { /* rien */ }
        try { g2.render.renderer.dispose(); } catch (e) { /* rien */ }
      }
      if (host2.parentNode) host2.parentNode.removeChild(host2);
    }
  });

  /* SPEC-PERF-009 : un bloc modifié PENDANT qu'un maillage de ce chunk est
     en vol chez un worker ne doit jamais être écrasé par le résultat
     périmé qui revient ensuite — l'affichage final reflète la MODIFICATION
     (version plus récente que celle qui a été envoyée en maillage). */
  e2e('SPEC-PERF-009 : bloc modifié pendant un maillage en vol — l\'affichage final reflète la modification', async function (g) {
    await reset(g);
    var s = g.player.state;
    var wx = Math.floor(s.pos.x), wz = Math.floor(s.pos.z);
    var wy = g.world.groundAt(wx, wz, true);
    var cx = Math.floor(wx / 16), cz = Math.floor(wz / 16);
    g.render.setDistance(4);
    g.streamChunks(true);
    A.ok(g.world.voisinsCharges(cx, cz), 'voisinage complet, prérequis du maillage');
    // pose un bloc distinctif, laisse le remaillage partir (worker ou repli),
    // puis modifie ENCORE avant que le résultat revienne
    g.world.setBlock(wx, wy + 1, wz, C.B.STONE);
    g.streamChunks(false);                  // distribue (ou exécute) le maillage de version N
    g.world.setBlock(wx, wy + 1, wz, C.B.GLASS || C.B.STONE);  // version N+1 avant tout résultat
    for (var i = 0; i < 60; i++) {
      await frames(1);
      g.streamChunks(false);
      if (!g.world.chunks.get(g.world.key(cx, cz)).dirty) break;
    }
    A.equal(g.world.getBlock(wx, wy + 1, wz), C.B.GLASS || C.B.STONE, 'le monde logique porte la dernière modification');
    // et le chunk n'est plus marqué sale : il finit par se stabiliser sur
    // la bonne version, jamais coincé sur un résultat périmé
    var c = g.world.chunks.get(g.world.key(cx, cz));
    A.notOk(c.dirty, 'le chunk finit par être remaillé proprement après la modification');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Audio — sons synthétisés dans le vrai AudioContext (SPEC-AUDIO-001 à 006)
  // ══════════════════════════════════════════════════════════════════════════
  /* Un navigateur sans fenêtre peut laisser le contexte suspendu faute de
     geste utilisateur : ces tests vérifient que les nœuds WebAudio sont créés
     et reliés (le jeu les règle même suspendu), jamais qu'on entend — la
     qualité d'un son n'est pas vérifiable par un test. */
  function sonsDepuis(g, n0, prefixe) {
    return g.sons.derniers.slice(n0).filter(function (s) { return s.nom && s.nom.indexOf(prefixe) === 0; });
  }
  function avecAudio(g) {
    g.audio.resume();
    var ctx = g.audio.context;
    A.ok(ctx && typeof ctx.createGain === 'function' && ctx.destination, 'un vrai AudioContext (état : ' + (ctx && ctx.state) + ')');
    return ctx;
  }

  e2e('SPEC-AUDIO-001 : une cascade posée près du joueur s\'entend — la sonde du lieu la trouve et sa nappe monte', {
        "teste": "qu'une chute d'eau (eau courante dont un flanc donne sur le vide) posée à quatre blocs du joueur est trouvée par la sonde du lieu (quatre fois par seconde) et fait monter la nappe « cascade » du vrai AudioContext",
        "pourquoi": "l'audit avait trouvé la rivière et la cascade jamais transmises aux nappes : le code pur les décidait, le jeu ne les lui donnait pas",
        "attendu": "g.sons.sonde.cascade > 0 puis le gain de la nappe cascade > 0 ; une fois l'eau retirée, la cascade se tait"
  }, async function (g) {
    var s = await reset(g);
    avecAudio(g);
    var x = Math.floor(s.pos.x) + 3, z = Math.floor(s.pos.z), y0 = Math.floor(s.pos.y);
    var poses = [];
    try {
      for (var y = y0; y <= y0 + 4; y++) for (var dx = 0; dx <= 1; dx++) {
        poses.push([x + dx, y, z, g.world.getBlock(x + dx, y, z)]);
        g.world.setBlock(x + dx, y, z, C.B.EAU_7);
      }
      A.ok(await sonderE2E(function () { return g.sons.sonde && g.sons.sonde.cascade > 0; }, 4000), 'la sonde entend la cascade (' + JSON.stringify(g.sons.sonde) + ')');
      await frames(2);
      A.gt(g.audio.gainsNappes.cascade, 0, 'la nappe « cascade » monte dans le vrai contexte');
    } finally {
      poses.forEach(function (p) { g.world.setBlock(p[0], p[1], p[2], p[3]); });
    }
    A.ok(await sonderE2E(function () { return g.sons.sonde && g.sons.sonde.cascade === 0; }, 4000), 'l\'eau retirée, la cascade se tait');
  });

  e2e('SPEC-AUDIO-003 : marcher fait des pas selon le sol, synthétisés dans le vrai AudioContext', {
        "teste": "qu'avancer deux secondes au sol joue des pas de la matière du bloc sous les pieds (MC.Ambiance.creerSuiviPas, matiereBloc), et que chacun crée réellement des nœuds WebAudio",
        "pourquoi": "l'audit avait trouvé sonAction jamais appelé : ni pas, ni nage, ni chute, ni tir ne s'entendaient",
        "attendu": "au moins deux sons « action_pas_<matière> » joués, la matière étant celle du sol, et le compteur de sons joués de audio.js qui avance"
  }, async function (g) {
    var s = await reset(g);
    avecAudio(g);
    A.ok(await sonderE2E(function () { return s.onGround; }, 4000), 'le joueur est posé au sol');
    /* une allée de pierre dégagée devant lui (yaw 0 : vers -z), pour que la
       marche ne bute ni ne tombe à l'eau selon le relief du point d'apparition */
    var bx = Math.floor(s.pos.x), by = Math.floor(s.pos.y), bz = Math.floor(s.pos.z), sauves = [];
    for (var dz = -14; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 3; dy++) {
      sauves.push([bx + dx, by + dy, bz + dz, g.world.getBlock(bx + dx, by + dy, bz + dz)]);
      g.world.setBlock(bx + dx, by + dy, bz + dz, dy === -1 ? C.B.STONE : 0);
    }
    s.yaw = 0;
    try {
    var n0 = g.sons.derniers.length, joues0 = g.audio.stats.joues, x0 = s.pos.x, z0 = s.pos.z, sol0 = 0, nf = 0;
    key('KeyW');
    var fin = Date.now() + 2000;                       // deux secondes de marche, quel que soit le nombre d'images
    while (Date.now() < fin) { await frames(1); nf++; if (s.onGround) sol0++; }
    key('KeyW', 'keyup');
    await frames(2);
    var pas = sonsDepuis(g, n0, 'action_pas_');
    A.ok(pas.length >= 2, 'des pas en marchant (' + pas.length + ' ; parcouru ' + Math.hypot(s.pos.x - x0, s.pos.z - z0).toFixed(1) +
         ' blocs, au sol ' + sol0 + '/' + nf + ' images, nage ' + s.swimming + ', vol ' + s.flying + ', sons ' + JSON.stringify(g.sons.derniers.slice(n0).slice(-5)) + ')');
    A.ok(pas.every(function (p) { return p.joue; }), 'chacun réellement synthétisé');
    A.ok(pas.some(function (p) { return p.nom === 'action_pas_pierre'; }), 'des pas de pierre, la matière de l allée');
    A.gt(g.audio.stats.joues, joues0, 'audio.js a créé des voix');
    A.ok(g.audio.voixActives <= g.audio.maxVoix, 'le budget de voix tient');
    } finally {
      key('KeyW', 'keyup');
      for (var k = sauves.length - 1; k >= 0; k--) g.world.setBlock(sauves[k][0], sauves[k][1], sauves[k][2], sauves[k][3]);
    }
  });

  e2e('SPEC-AUDIO-002 / SPEC-AUDIO-005 : les sons relayés par le serveur (créature blessée, réveil d\'un gardien) sont joués là où ils se produisent', {
        "teste": "que les évènements du message SONS (blessure d'un loup, réveil d'un gardien) passent par MC.Ambiance (son de l'espèce) puis audio.js (spatialisé, étouffé par la roche), et qu'une créature au-delà de la portée n'est pas jouée",
        "pourquoi": "les créatures ne vivent plus que dans le serveur : sans ce relais, blessures, morts, attaques et réveils restaient muets",
        "attendu": "« blesse » (loup) et « gardien » joués ; un cri de créature à 200 blocs ne crée aucune voix"
  }, async function (g) {
    var s = await reset(g);
    avecAudio(g);
    var p = s.pos, n0 = g.sons.derniers.length;
    g.sonsServeur([{ k: 'blesse', e: 'wolf', x: p.x + 3, y: p.y, z: p.z },
                   { k: 'gardien', e: 'boss_zombie', x: p.x - 6, y: p.y, z: p.z }]);
    var l = g.sons.derniers.slice(n0);
    A.ok(l.some(function (x) { return x.nom === MC.Ambiance.sonCreature('wolf', 'blesse') && x.joue; }), 'la blessure du loup');
    A.ok(l.some(function (x) { return x.nom === MC.Ambiance.sonEvenement('gardien') && x.joue; }), 'le réveil du gardien');
    var n1 = g.sons.derniers.length;
    g.sonsServeur([{ k: 'mort', e: 'sheep', x: p.x + 200, y: p.y, z: p.z }]);
    A.ok(g.sons.derniers.slice(n1).every(function (x) { return !x.joue; }), 'à 200 blocs, rien ne se joue');
  });

  e2e('SPEC-AUDIO-006 : chaque catégorie de sons a son volume dans les options, appliqué aussitôt', {
        "teste": "que l'écran des options propose un curseur par catégorie (ambiance, créatures, actions, interactions, interface, événements) et que le régler change aussitôt le volume de la catégorie dans audio.js",
        "pourquoi": "l'audit avait trouvé un volume général seulement : impossible de baisser les créatures sans couper le reste",
        "attendu": "six curseurs ; créatures à 0 : volumeCategorie('creature') vaut 0 et un cri n'est plus joué ; les défauts reviennent ensuite"
  }, async function (g) {
    var avant = JSON.parse(JSON.stringify(g.options));
    try {
      var s = await reset(g);
      avecAudio(g);
      key('Escape'); await frames(3);
      document.querySelector('#btn-options').click(); await frames(2);
      MC.Ambiance.CATEGORIES.forEach(function (c) {
        A.ok(document.querySelector('input[data-opt="' + MC.Ambiance.OPTIONS_VOLUME[c] + '"]'), 'un curseur pour « ' + c + ' »');
      });
      var i = document.querySelector('input[data-opt="volumeCreatures"]');
      i.value = 0; i.dispatchEvent(new Event('input'));
      A.equal(g.audio.volumeCategorie('creature'), 0, 'créatures à 0, aussitôt');
      A.equal(g.audio.jouer('cri_monstre', { categorie: 'creature', x: s.pos.x + 1, y: s.pos.y, z: s.pos.z }), false, 'un cri de créature ne joue plus');
      A.ok(g.audio.jouer('succes', { categorie: 'evenement' }), 'les autres catégories jouent');
      var e = document.querySelector('input[data-opt="volumeEvenements"]');
      e.value = 0.3; e.dispatchEvent(new Event('input'));
      A.close(g.audio.volumeCategorie('evenement'), 0.3, 1e-9, 'événements à 0,3');
      document.querySelector('#btn-opt-defaut').click(); await frames(2);
      A.close(g.audio.volumeCategorie('creature'), MC.Ambiance.VOLUMES_DEFAUT.creature, 1e-9, 'les défauts reviennent');
      document.querySelector('#btn-retour').click(); await frames(2);
    } finally {
      g.options = avant; MC.Options.sauver(localStorage, avant);
      key('Escape'); fakeLock(g, true); await frames(3);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Saisons et profondeurs (SPEC-SAISON-005, SPEC-LUMIERE-007, SPEC-SOUTERRAIN-003)
  // ══════════════════════════════════════════════════════════════════════════
  /* Le premier point d'une spirale (pas de 24 blocs) autour de (x0, z0) où
     `pred(colonne, x, z)` est vrai — une prospection pure, sans générer. */
  function spiraleColonnes(w, x0, z0, pred, rayon) {
    for (var r = 0; r <= (rayon || 12000); r += 24) {
      var n = Math.max(1, Math.round(r * 2 * Math.PI / 24));
      for (var k = 0; k < n; k++) {
        var x = Math.round(x0 + Math.cos(k / n * 2 * Math.PI) * r), z = Math.round(z0 + Math.sin(k / n * 2 * Math.PI) * r);
        if (pred(w.bio.colonne(x, z), x, z)) return { x: x, z: z };
      }
    }
    return null;
  }
  function chargerAutour(g, x, z, n) {
    var cx = Math.floor(x / 16), cz = Math.floor(z / 16);
    for (var a = -n; a <= n; a++) for (var b = -n; b <= n; b++) g.world.getChunk(cx + a, cz + b, true);
  }
  function surfaceDe(w, x, z) { var y = MC.Core.WORLD_H - 1; while (y > 0 && w.getBlock(x, y, z) === 0) y--; return y; }
  // une heure de jour (ou de nuit) dans la saison qui commence à `debut` (secondes du monde)
  function heureDans(debut, nuit) {
    for (var t = debut; t < debut + 3 * MC.DayCycle.DAY_LENGTH; t += 5) if (!!MC.DayCycle.isNight(t) === !!nuit && (nuit || MC.DayCycle.sunIntensity(t) > 0.8)) return t;
    return debut;
  }
  /* Le balayage des eaux de saison (le même code que le serveur : le poste ne
     le fait jamais tourner seul, eauxSaison: false) jusqu'à `fini()`. */
  function balayerEaux(g, temps, fini, max, pas) {
    pas = pas || 1;
    for (var i = 0; i < (max || 4000); i += pas) {
      if (fini()) return true;
      for (var k = 0; k < pas; k++) g.world.tickEauxSaison(temps);
    }
    return fini();
  }

  e2e('SPEC-SAISON-005 : en hiver, un lac froid gèle — on marche sur la glace, elle fond au printemps et l\'on tombe à l\'eau', {
        "teste": "qu'un vrai lac d'une région froide (généré, nature « lac », climat sous le seuil de gel) se prend en glace quand le balayage des eaux de saison tourne à une heure d'hiver, que le joueur posé dessus y tient debout et y marche, puis qu'au printemps la glace fond sous lui et qu'il tombe dans l'eau",
        "pourquoi": "le gel n'était éprouvé que sur une colonne forcée, et jamais rendu ni parcouru dans le jeu",
        "attendu": "glace (état 1) au centre du lac l'hiver, joueur au sol à la cote de la glace pendant toute la marche (≥ 2 blocs parcourus), eau au même endroit au printemps et joueur passé sous la surface ; captures du lac liquide, gelé, de la marche et du dégel"
  }, async function (g) {
    var s = await reset(g), w = g.world, B = MC.Core.B, temps0 = g.time, YL = MC.DayCycle.YEAR_LENGTH;
    var p = spiraleColonnes(w, s.pos.x, s.pos.z, function (c) { return c.climat.lac && c.climat.t < 0.38 && c.climat.t >= 0.26 && c.eau > c.h; });
    A.ok(p, 'un lac froid existe dans ce monde');
    var l = w.bio.lacProche(p.x, p.z);
    A.ok(l, 'son lac');
    var lx = l.x, lz = l.z;
    var dist0 = g.render.RENDER_DIST;
    g.render.setDistance(4);
    var hiver = heureDans(YL * 0.8), printemps = heureDans(YL * 1.05);
    try {
      chargerAutour(g, lx, lz, 2);
      var ly = surfaceDe(w, lx, lz);
      A.equal(w.getBlock(lx, ly, lz), B.WATER, 'le lac est liquide au départ');
      s.flying = true; s.pos.x = lx + 0.5; s.pos.z = lz + 9.5; s.pos.y = ly + 7; s.yaw = 0; s.pitch = -0.6;
      g.time = heureDans(YL * 0.6);
      g.streamChunks(true);
      for (var i = 0; i < 20; i++) await frames(1);
      capture('lac-liquide-en-automne');
      s.pos.x = lx + 0.5; s.pos.z = lz + 0.5; s.pos.y = ly + 22; s.pitch = -1.55;
      for (var i1 = 0; i1 < 10; i1++) await frames(1);
      capture('lac-liquide-vu-de-haut');
      s.pos.x = lx + 0.5; s.pos.z = lz + 9.5; s.pos.y = ly + 7; s.pitch = -0.6;
      g.time = hiver;
      A.ok(balayerEaux(g, hiver, function () { return w.getBlock(lx, ly, lz) === B.ICE; }), 'l\'hiver, le centre du lac gèle');
      var liquides = function () {
        var n = 0;
        for (var ax = -l.R; ax <= l.R; ax++) for (var az = -l.R; az <= l.R; az++) {
          if (Math.hypot(ax, az) > l.R - 1) continue;
          if (w.getBlock(lx + ax, ly, lz + az) === B.WATER && w.getBlock(lx + ax, ly + 1, lz + az) === 0) n++;
        }
        return n;
      };
      A.ok(balayerEaux(g, hiver, function () { return liquides() === 0; }, 8000, 50), 'tout le lac gèle (' + liquides() + ' colonnes encore liquides)');
      A.equal(w.getEtat(lx, ly, lz), 1, 'glace de saison (état 1)');
      for (var j = 0; j < 20; j++) await frames(1);
      capture('lac-gele-en-hiver');
      s.pos.x = lx + 0.5; s.pos.z = lz + 0.5; s.pos.y = ly + 22; s.pitch = -1.55;
      for (var j2 = 0; j2 < 10; j2++) await frames(1);
      capture('lac-gele-vu-de-haut');
      // posé sur la glace, il y tient
      s.flying = false; s.vel.x = s.vel.y = s.vel.z = 0; s.fallFrom = null;
      s.pos.x = lx + 0.5; s.pos.z = lz + 0.5; s.pos.y = ly + 1.05; s.yaw = 0; s.pitch = -0.25;
      A.ok(await sonderE2E(function () { return s.onGround; }, 3000), 'le joueur se pose sur la glace');
      A.close(s.pos.y, ly + 1, 0.05, 'à la cote de la glace');
      // il y marche (yaw 0 : vers -z), sans jamais s'enfoncer
      var x0 = s.pos.x, z0 = s.pos.z, yMin = s.pos.y;
      key('KeyW');
      var fin = Date.now() + 1500;
      while (Date.now() < fin) { await frames(1); yMin = Math.min(yMin, s.pos.y); }
      key('KeyW', 'keyup');
      await frames(2);
      var parcouru = Math.hypot(s.pos.x - x0, s.pos.z - z0);
      A.gt(parcouru, 2, 'il a marché sur la glace (' + parcouru.toFixed(1) + ' blocs)');
      A.gt(yMin, ly + 0.95, 'sans s\'enfoncer (y min ' + yMin.toFixed(2) + ', glace en ' + ly + ')');
      A.equal(w.getBlock(Math.floor(s.pos.x), ly, Math.floor(s.pos.z)), B.ICE, 'toujours sur la glace');
      capture('marche-sur-la-glace');
      // le printemps : la glace fond sous lui
      g.time = printemps;
      var gx = Math.floor(s.pos.x), gz = Math.floor(s.pos.z);
      A.ok(balayerEaux(g, printemps, function () { return w.getBlock(gx, ly, gz) === B.WATER; }), 'au printemps, la glace fond sous ses pieds');
      A.ok(await sonderE2E(function () { return s.pos.y < ly + 0.9; }, 4000), 'et il tombe dans l\'eau (y ' + s.pos.y.toFixed(2) + ')');
      for (var k = 0; k < 10; k++) await frames(1);
      capture('degel-dans-l-eau');
    } finally {
      key('KeyW', 'keyup');
      balayerEaux(g, printemps, function () { return false; }, 600);    // tout ce que l'hiver a gelé redevient liquide
      g.time = temps0; s.flying = false;
      g.render.setDistance(dist0);
      await reset(g);
    }
  });

  e2e('SPEC-LUMIERE-007 : dans une grotte humide, champignons et lichens luminescents éclairent la roche ; la nuit, le plancton éclaire le récif', {
        "teste": "qu'un lichen luminescent généré dans une grotte luxuriante (sous les plaines et forêts) éclaire les cases voisines dans l'éclairage calculé au maillage, sans aucune lumière du ciel, et que la nuit le balayage des eaux fait monter du plancton luminescent au-dessus d'un récif, qui éclaire à son tour l'eau autour",
        "pourquoi": "l'audit avait trouvé le plancton jamais généré, et aucune vérification de la lumière réellement émise par les organismes",
        "attendu": "lumière de bloc ≥ 6/15 à côté du lichen, ciel à 0 ; plancton (état 1) posé sur un corail la nuit, lumière de bloc > 0 au-dessus de lui ; captures de la grotte et du récif"
  }, async function (g) {
    var s = await reset(g), w = g.world, C2 = MC.Core, B = C2.B, temps0 = g.time, DL = MC.DayCycle.DAY_LENGTH;
    var dist0 = g.render.RENDER_DIST;
    g.render.setDistance(4);
    try {
      // un lichen dans les grottes humides, le plus près possible du départ
      var lichen = null, cx0 = Math.floor(s.pos.x / 16), cz0 = Math.floor(s.pos.z / 16);
      for (var r = 0; r <= 12 && !lichen; r++) for (var a = -r; a <= r && !lichen; a++) for (var b = -r; b <= r && !lichen; b++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
        var ch = w.getChunk(cx0 + a, cz0 + b, true), bl = ch.blocks;
        for (var i = 0; i < bl.length && !lichen; i++) {
          if (bl[i] !== B.LICHEN_LUMINEUX) continue;
          var lx = i % 16, lz = ((i / 16) | 0) % 16, ly = (i / 256) | 0;
          lichen = { x: ch.cx * 16 + lx, y: ly, z: ch.cz * 16 + lz };
        }
      }
      A.ok(lichen, 'un lichen luminescent dans une grotte proche');
      chargerAutour(g, lichen.x, lichen.z, 1);
      // une case libre à côté, au sol, où se tenir face au lichen
      var place = null;
      for (var d = 2; d <= 4 && !place; d++) [[d, 0], [-d, 0], [0, d], [0, -d]].forEach(function (q) {
        if (place) return;
        var x = lichen.x + q[0], z = lichen.z + q[1], y = lichen.y;
        if (w.getBlock(x, y, z) === 0 && w.getBlock(x, y + 1, z) === 0 && C2.isSolid(w.getBlock(x, y - 1, z))) place = { x: x, y: y, z: z, dx: -q[0], dz: -q[1] };
      });
      A.ok(place, 'de quoi se tenir près du lichen');
      g.time = heureDans(0, true);
      s.flying = true; s.vel.x = s.vel.y = s.vel.z = 0;
      s.pos.x = place.x + 0.5; s.pos.y = place.y; s.pos.z = place.z + 0.5;
      s.yaw = Math.atan2(-place.dx, -place.dz); s.pitch = -0.35;
      g.streamChunks(true);
      var c = w.getChunk(Math.floor(lichen.x / 16), Math.floor(lichen.z / 16));
      A.ok(await sonderE2E(function () { return !!c.lumiere; }, 8000), 'l\'éclairage du chunk est calculé');
      var chunkDe = function (a2, b2) { return w.chunks.get(w.key(a2, b2)) || null; };
      var autour = MC.Lumiere.lumiereEn(chunkDe, lichen.x + 0.5, lichen.y + 1.5, lichen.z + 0.5);
      A.ok(autour.bloc >= 6 / 15, 'le lichen éclaire la case au-dessus de lui (lumière ' + (autour.bloc * 15).toFixed(0) + '/15)');
      A.equal(MC.Lumiere.lumiereEn(chunkDe, lichen.x + 0.5, lichen.y + 1.5, lichen.z + 0.5).ciel, 0, 'sans le moindre jour : c\'est une grotte');
      for (var f = 0; f < 20; f++) await frames(1);
      capture('grotte-humide-lichen');

      // la nuit, le plancton sur un récif des mers chaudes
      var recifPt = null;
      for (var rr = 0; rr <= 9000 && !recifPt; rr += 32) {
        var nn = Math.max(1, Math.round(rr * 2 * Math.PI / 32));
        for (var kk = 0; kk < nn && !recifPt; kk++) {
          var xx = Math.round(Math.cos(kk / nn * 2 * Math.PI) * rr), zz = Math.round(Math.sin(kk / nn * 2 * Math.PI) * rr);
          if (w.biomeAt(xx, zz).id === 'ocean_chaud') recifPt = { x: xx, z: zz };
        }
      }
      A.ok(recifPt, 'un récif corallien dans ce monde');
      chargerAutour(g, recifPt.x, recifPt.z, 2);
      var nuit = heureDans(MC.DayCycle.YEAR_LENGTH * 0.3, true);
      g.time = nuit;
      var plancton = null;
      balayerEaux(g, nuit, function () {
        if (plancton) return true;
        for (var a3 = -24; a3 <= 24 && !plancton; a3++) for (var b3 = -24; b3 <= 24 && !plancton; b3++) {
          var x3 = recifPt.x + a3, z3 = recifPt.z + b3, y3 = surfaceDe(w, x3, z3);
          for (var y4 = y3; y4 > y3 - 10; y4--) if (w.getBlock(x3, y4, z3) === B.PLANCTON_LUMINEUX) { plancton = { x: x3, y: y4, z: z3 }; break; }
        }
        return !!plancton;
      }, 3000);
      A.ok(plancton, 'la nuit, du plancton luminescent est monté au-dessus du récif');
      balayerEaux(g, nuit, function () { return false; }, 400);       // tout le récif alentour
      A.equal(w.getEtat(plancton.x, plancton.y, plancton.z), 1, 'posé par la nuit (état 1)');
      // vu d'au-dessus de la mer, à quelques blocs, penché vers le récif
      s.pos.x = plancton.x + 2.5; s.pos.y = surfaceDe(w, plancton.x, plancton.z) + 2; s.pos.z = plancton.z + 0.5; s.yaw = Math.PI / 2; s.pitch = -1.2;
      A.ok(MC.DayCycle.isNight(g.time), 'il fait nuit (soleil ' + MC.DayCycle.sunIntensity(g.time).toFixed(2) + ')');
      g.streamChunks(true);
      var cp = w.getChunk(Math.floor(plancton.x / 16), Math.floor(plancton.z / 16));
      A.ok(await sonderE2E(function () { return !!cp.lumiere && MC.Lumiere.lumiereEn(chunkDe, plancton.x + 0.5, plancton.y + 1.5, plancton.z + 0.5).bloc > 0; }, 8000),
           'le plancton éclaire l\'eau au-dessus de lui');
      for (var f2 = 0; f2 < 20; f2++) await frames(1);
      capture('recif-plancton-la-nuit');
      // au jour, il se disperse
      var jour = heureDans(MC.DayCycle.YEAR_LENGTH * 0.3, false);
      A.ok(balayerEaux(g, jour, function () { return w.getBlock(plancton.x, plancton.y, plancton.z) === B.WATER; }), 'au jour, le plancton se disperse');
    } finally {
      g.time = temps0; s.flying = false;
      g.render.setDistance(dist0);
      await reset(g);
    }
  });

  e2e('SPEC-SOUTERRAIN-003 : une mine abandonnée sous terre — ses galeries, ses rails et ses étais, dans les matériaux de son biome', {
        "teste": "qu'une mine abandonnée des structures souterraines (MC.Souterrain.creerStructures) est bien posée dans les chunks générés près du départ : le joueur, placé dans une galerie, a un rail sous les pieds, des étais (poteaux de bois et poutre de planches) le long de la galerie et des lumières",
        "pourquoi": "l'audit avait trouvé aucune structure propre aux biomes souterrains ; seuls les donjons de surface existaient",
        "attendu": "un rail à la case du joueur, au moins deux étais dans les dix blocs devant lui, une lumière à moins de huit blocs ; captures de la galerie et de la chambre"
  }, async function (g) {
    var s = await reset(g), w = g.world, B = MC.Core.B;
    var dist0 = g.render.RENDER_DIST;
    g.render.setDistance(4);
    try {
      var S = w.structuresSouterraines;
      A.ok(S, 'le monde porte ses structures souterraines');
      var mines = S.dansZone(s.pos.x - 1500, s.pos.z - 1500, s.pos.x + 1500, s.pos.z + 1500)
        .filter(function (m) { return m.genre === 'mine' && !m.noye; })
        .sort(function (a, b) { return Math.hypot(a.x - s.pos.x, a.z - s.pos.z) - Math.hypot(b.x - s.pos.x, b.z - s.pos.z); });
      A.gt(mines.length, 0, 'une mine abandonnée à moins de 1500 blocs');
      var mine = null;
      for (var i = 0; i < mines.length && !mine; i++) {
        var m = mines[i];
        chargerAutour(g, m.x + 12, m.z, 1);
        if (w.getBlock(m.x + 12, m.y + 1, m.z) === B.RAIL && w.getBlock(m.x + 12, m.y + 2, m.z) === 0) mine = m;
      }
      A.ok(mine, 'une mine dont la galerie est intacte (aucun donjon de surface ne l\'a écrasée)');
      // dans la galerie est, tourné vers la chambre (yaw π/2 : vers -x)
      s.flying = true; s.vel.x = s.vel.y = s.vel.z = 0;
      s.pos.x = mine.x + 14.5; s.pos.y = mine.y + 1; s.pos.z = mine.z + 0.5; s.yaw = Math.PI / 2; s.pitch = -0.1;
      g.streamChunks(true);
      A.equal(w.getBlock(Math.floor(s.pos.x), mine.y + 1, Math.floor(s.pos.z)), B.RAIL, 'un rail sous les pieds');
      var etais = 0, lumieres = 0;
      for (var d = 0; d <= 10; d++) {
        var x = Math.floor(s.pos.x) - d;
        if (w.getBlock(x, mine.y + 1, mine.z + 1) === B.LOG && w.getBlock(x, mine.y + 1, mine.z - 1) === B.LOG &&
            w.getBlock(x, mine.y + 3, mine.z) === B.PLANKS) etais++;
      }
      for (var dx = -8; dx <= 8; dx++) for (var dz = -2; dz <= 2; dz++) for (var dy = 0; dy <= 4; dy++) {
        if (MC.Core.lampeDe(w.getBlock(Math.floor(s.pos.x) + dx, mine.y + dy, mine.z + dz)) > 0) lumieres++;
      }
      A.ok(etais >= 2, 'des étais le long de la galerie (' + etais + ')');
      A.gt(lumieres, 0, 'une lumière dans la galerie');
      A.ok(mine.nom && mine.biome, 'mine propre à son biome : ' + mine.nom + ' (' + mine.biome + ')');
      for (var f = 0; f < 25; f++) await frames(1);
      capture('mine-galerie-rails-etais');
      s.pos.x = mine.x + 3.5; s.yaw = Math.PI / 2 + 0.6;
      for (var f2 = 0; f2 < 15; f2++) await frames(1);
      capture('mine-chambre');
    } finally {
      s.flying = false;
      g.render.setDistance(dist0);
      await reset(g);
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Limites de rendu loin de l'origine (SPEC-LIMITE-007)
  // ══════════════════════════════════════════════════════════════════════════
  /* Sonde non bloquante, dans l'esprit de SPEC-LIMITE-006 : elle MESURE et
     écrit le tableau au cahier ; seul son fonctionnement (une image rendue et
     un relevé par distance) la fait échouer, jamais ce qu'elle trouve. Tout
     se passe dans UN bloc synchrone par image (caméra, ambiance, rendu, relevé
     des pixels) : la boucle de jeu ne peut pas s'intercaler et fausser l'écart. */
  function imageReduite(g, canvas, ctx2d) {
    rendreTout(g);
    ctx2d.drawImage(g.render.renderer.domElement, 0, 0, canvas.width, canvas.height);
    return ctx2d.getImageData(0, 0, canvas.width, canvas.height).data;
  }
  /* Écart moyen (en % de l'échelle 0-255) entre deux images, sur la luminosité de chaque canal. */
  function ecartImages(a, b) {
    var somme = 0, n = 0;
    for (var i = 0; i < a.length; i += 4) { somme += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n += 3; }
    return n ? somme / n / 255 * 100 : 0;
  }
  function diversite(a) {            // une image uniforme (rien rendu, ou tout au fond) a une variance nulle
    var m = 0, v = 0, n = 0, i;
    for (i = 0; i < a.length; i += 4) { m += a[i] + a[i + 1] + a[i + 2]; n += 3; }
    m /= n;
    for (i = 0; i < a.length; i += 4) { v += Math.pow(a[i] - m, 2) + Math.pow(a[i + 1] - m, 2) + Math.pow(a[i + 2] - m, 2); }
    return Math.sqrt(v / n);
  }
  function statsEcarts(serie) {
    var moy = serie.reduce(function (x, y) { return x + y; }, 0) / (serie.length || 1);
    var max = serie.length ? Math.max.apply(null, serie) : 0;
    return { moy: moy, max: max, saut: moy > 1e-9 ? max / moy : (max > 1e-9 ? Infinity : 1) };
  }
  function f2(v) { return isFinite(v) ? v.toFixed(3) : '∞'; }

  e2e('SPEC-LIMITE-007 : la sonde de rendu mesure, à 10⁴, 10⁵, 10⁶ et 10⁷ blocs, le tremblement de la géométrie et des animations', {
        "teste": "que le jeu, téléporté à 10⁴, 10⁵, 10⁶ puis 10⁷ blocs de l'origine (et à l'origine pour référence), rend une image de la scène et que l'on mesure, entre images fixes, l'écart produit par un déplacement de caméra de 1/64 de bloc (tremblement de la géométrie) et par l'avance du temps de 0,05 s (eau, vent, nuages)",
        "pourquoi": "les positions sont en 32 bits côté GPU : la limite de rendu loin de l'origine n'était calculée qu'en théorie (SPEC-LIMITE-004), jamais observée dans le navigateur",
        "attendu": "une image rendue et un relevé chiffré par distance (écart moyen, saut maximal) dans le tableau du cahier, avec une capture par distance ; la sonde ne juge pas ce qu'elle mesure"
  }, async function (g) {
    var s = await reset(g), w = g.world, B = MC.Core.B;
    var dist0 = g.render.RENDER_DIST, temps0 = g.time;
    var canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
    var ctx2d = canvas.getContext('2d');
    var DISTANCES = [0, 1e4, 1e5, 1e6, 1e7];
    var lignes = [], releves = [];
    g.render.setDistance(3);
    try {
      for (var di = 0; di < DISTANCES.length; di++) {
        var D = DISTANCES[di];
        T.etape('distance ' + (D === 0 ? 'origine' : D.toExponential(0)));
        var x = D + 8, z = 8;
        chargerAutour(g, x, z, 2);
        var y = surfaceDe(w, x, z);
        s.flying = true; s.vel.x = s.vel.y = s.vel.z = 0; s.fallFrom = null;
        s.pos.x = x + 0.5; s.pos.z = z + 0.5; s.pos.y = y + 6; s.yaw = 0.7; s.pitch = -0.45;
        g.streamChunks(true);
        // attend que les maillages soient prêts : le nombre de triangles dessinés cesse de bouger (borné à 6 s)
        var dernier = -1, stable = 0, t0 = Date.now();
        while (stable < 5 && Date.now() - t0 < 6000) {
          await frames(2);
          var tri = g.render.renderer.info.render.triangles;
          stable = (tri > 0 && tri === dernier) ? stable + 1 : 0;
          dernier = tri;
        }
        capture('rendu-a-' + (D === 0 ? 'l-origine' : D.toExponential(0).replace('e+', 'e')));
        // ── relevés dans un bloc SYNCHRONE : la boucle de jeu ne s'y glisse jamais ──
        var cam = { x: s.pos.x, y: s.pos.y + 1.62, z: s.pos.z };   // hauteur des yeux (src/player.js)
        var T0 = g.time;
        g.render.setCamera(cam, s.yaw, s.pitch);
        g.render.updateAmbience(T0, false);
        var ref = imageReduite(g, canvas, ctx2d);
        var vari = diversite(ref);
        var tri2 = g.render.renderer.info.render.triangles;
        // tremblement de la géométrie : 8 pas de 1/64 de bloc, temps figé
        var serieG = [], prec = ref;
        for (var k = 1; k <= 8; k++) {
          g.render.setCamera({ x: cam.x + k / 64, y: cam.y, z: cam.z }, s.yaw, s.pitch);
          g.render.updateAmbience(T0, false);
          var img = imageReduite(g, canvas, ctx2d);
          serieG.push(ecartImages(prec, img)); prec = img;
        }
        // tremblement des animations : caméra fixe, 8 pas de 0,05 s
        g.render.setCamera(cam, s.yaw, s.pitch);
        var serieA = [], precA = null;
        for (var m = 0; m <= 8; m++) {
          g.render.updateAmbience(T0 + m * 0.05, false);
          var imgA = imageReduite(g, canvas, ctx2d);
          if (precA) serieA.push(ecartImages(precA, imgA));
          precA = imgA;
        }
        g.render.updateAmbience(g.time, false);
        var eg = statsEcarts(serieG), ea = statsEcarts(serieA);
        releves.push({ D: D, diversite: vari, triangles: tri2, eg: eg, ea: ea });
        lignes.push([D === 0 ? 'origine (référence)' : D.toExponential(0).replace('e+', ' × 10^').replace('1 × 10^', '10^'),
          tri2, vari.toFixed(1), f2(eg.moy), f2(eg.max), f2(eg.saut), f2(ea.moy), f2(ea.max), f2(ea.saut)]);
      }
      T.mesure('Rendu loin de l\'origine — écart entre images fixes (% de l\'échelle 0-255, image 400 × 300)',
        ['distance (blocs)', 'triangles', 'contraste', 'géométrie : écart moyen / pas de 1/64', 'géométrie : saut max', 'géométrie : saut/moyenne',
         'animations : écart moyen / 0,05 s', 'animations : saut max', 'animations : saut/moyenne'], lignes);
      // la sonde elle-même doit fonctionner : une image rendue et un relevé fini par distance
      A.equal(releves.length, DISTANCES.length, 'un relevé par distance');
      releves.forEach(function (r) {
        A.ok(isFinite(r.eg.moy) && isFinite(r.ea.moy) && isFinite(r.diversite), 'relevé chiffré à ' + r.D + ' blocs');
      });
      A.gt(releves[0].triangles, 0, 'la référence à l\'origine dessine bien la scène');
    } finally {
      g.render.setDistance(dist0);
      g.time = temps0; s.flying = false;
      await reset(g);
    }
  });

  // ─── nettoyage ─────────────────────────────────────────────────────────────
  /* SPEC-BANC-016 : fin de test et fin de campagne referment tout ce qu'un
     test peut avoir laissé ouvert (dialogue d'histoire, journal, écrans de
     conteneur, chat) et rendent la main au jeu dans un état stable, pour que
     rejouer un test seul donne le même résultat que dans la campagne. */
  function nettoyer(g) {
    try {
      ['.dialogue-histoire', '.journal-histoire', '.objectif-histoire'].forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) { if (el.style) el.style.display = 'none'; });
      });
    } catch (e) { /* rien */ }
    try {
      if (g.chat && g.chat.enSaisie) { g.chat.saisie = ''; g.chat.enSaisie = false; }
      if (g.input) g.input.saisieActive = false;
    } catch (e) { /* rien */ }
    try { if (g.ui && g.ui.heldStack) g.ui.heldStack = null; } catch (e) { /* rien */ }
    try { fakeLock(g, true); } catch (e) { /* rien */ }
    try { if (g.input) g.input.setState('menu'); } catch (e) { /* rien */ }
  }

  // ─── diagnostics d'un test (SPEC-BANC-092 à 094, 099, 101) ─────────────────
  /* Pendant un test : un enregistreur de vol (tampon circulaire du journal, tous
     niveaux), les tâches longues du fil principal, et de quoi dater les erreurs
     que la page capte (tests/erreurs-page.js). Joints au résultat SEULEMENT si le
     test échoue ou est lent (opts.seuilLentMs) — sinon jetés, pour ne pas
     transporter des Mo de journaux de tests qui vont bien. */
  var CAPACITE_VOL_E2E = 500;
  var BORNES_HISTOGRAMME_MS = [8, 17, 25, 34, 50, 100, 250];
  function journalTests() {
    return G.MC && G.MC.Journal && G.MC.Journal.outilsHarnais ? G.MC.Journal.outilsHarnais : null;
  }
  function demarrerDiagnostics(test) {
    var d = { J: journalTests(), vol: null, longtasks: [], observateur: null, mur0: Date.now(), t0: maintenantReel() };
    if (d.J && d.J.sortieAnneau) {
      d.J.contexte({ test: test.name });
      d.vol = d.J.sortieAnneau('vol-e2e', 'trace', CAPACITE_VOL_E2E);
      d.J.ajouterSortie(d.vol);
    }
    try {
      if (typeof PerformanceObserver === 'function' && (PerformanceObserver.supportedEntryTypes || []).indexOf('longtask') >= 0) {
        d.observateur = new PerformanceObserver(function (liste) {
          liste.getEntries().forEach(function (x) {
            var attr = (x.attribution || []).map(function (a) { return [a.containerType, a.containerName || a.containerSrc || a.containerId].filter(Boolean).join(' '); }).filter(Boolean).join(', ');
            d.longtasks.push({ debut_ms: Math.round(x.startTime - d.t0), duree_ms: Math.round(x.duration), attribution: attr || null });
          });
        });
        d.observateur.observe({ type: 'longtask' });
      }
    } catch (x) { d.observateur = null; }
    return d;
  }
  /* Histogramme des temps d'image (en ms), d'après les horodatages réels des images du test. */
  function histogrammeImages(images) {
    var h = {}, n = 0;
    BORNES_HISTOGRAMME_MS.forEach(function (b) { h['<=' + b] = 0; });
    h['>' + BORNES_HISTOGRAMME_MS[BORNES_HISTOGRAMME_MS.length - 1]] = 0;
    for (var i = 1; i < images.length; i++) {
      var dt = images[i] - images[i - 1];
      if (!(dt > 0)) continue;
      n++;
      var place = false;
      for (var k = 0; k < BORNES_HISTOGRAMME_MS.length && !place; k++) if (dt <= BORNES_HISTOGRAMME_MS[k]) { h['<=' + BORNES_HISTOGRAMME_MS[k]]++; place = true; }
      if (!place) h['>' + BORNES_HISTOGRAMME_MS[BORNES_HISTOGRAMME_MS.length - 1]]++;
    }
    return n ? h : null;
  }
  /* SPEC-BANC-094 : l'instantané de l'état du jeu — jamais d'exception. */
  function prendreInstantane(g) {
    try {
      if (G.MC_DEBUG && G.MC_DEBUG.instantane) return G.MC_DEBUG.instantane();
      return G.MC.Debug.creer(g).instantane();
    } catch (x) { return { erreurs: ['instantané impossible : ' + ((x && x.message) || x)] }; }
  }
  function terminerDiagnostics(d, ctx, g, etat, dureeMs, opts) {
    try { if (d.observateur) d.observateur.disconnect(); } catch (x) { /* rien */ }
    var out = {};
    var lent = !!(opts && opts.seuilLentMs && dureeMs > opts.seuilLentMs);
    var garder = etat !== 'reussi' || lent;
    if (d.vol) {
      var lignes = d.vol.entrees.length ? d.vol.lignes() : null;
      var perdues = d.vol.perdues;
      d.J.retirerSortie('vol-e2e'); d.J.contexte({ test: null });
      if (garder && lignes) { out.vol = lignes; out.volPerdues = perdues; }
    }
    if (!garder) return out;
    out.instantane = ctx.instantane || prendreInstantane(g);
    if (G.MC_ERREURS_PAGE) {
      var errs = G.MC_ERREURS_PAGE.depuis(d.mur0).filter(function (x) { return x.type !== 'console.warn'; });
      if (errs.length) out.erreursCachees = errs;
    }
    // SPEC-BANC-103 : les derniers messages échangés côté client (le serveur de jeu du banc, lui, est relu par conclure())
    try {
      if (g.net && typeof g.net.derniersMessages === 'function') {
        var msgs = g.net.derniersMessages(50);
        if (msgs.length) out.reseau = { client: msgs };
      }
    } catch (x) { /* le réseau n'est pas indispensable à un diagnostic */ }
    if (d.longtasks.length) out.longtasks = d.longtasks;
    var hist = histogrammeImages(ctx.images);
    if (hist) out.histogrammeImages = hist;
    return out;
  }

  // ─── exécution d'un seul test, instrumenté ─────────────────────────────────
  /* Rend un objet conforme à `tests[]` de `resultats.json` (SPEC-BANC-012/013).
     `delaiDefaut` (secondes) s'applique faute de fiche.delai (SPEC-BANC-010,
     révisé) : FILET DE SÉCURITÉ contre un test qui ne rend JAMAIS la main
     (deadlock), PAS un couperet pour un test simplement lent — un test lent
     continue jusqu'à SON vrai résultat (ok/échec), signalé au passage dans la
     zone des lents (un simple avertissement, jamais une cause d'échec). Le
     défaut (15 min) est délibérément généreux : seul un test réellement
     bloqué doit un jour l'atteindre ; `fiche.delai` reste le moyen de le
     réduire pour un test qui a besoin de vérifier le mécanisme lui-même (voir
     le faux test bloqué de SPEC-BANC-010 plus bas). */
  function runUnE2E(g, test, opts) {
    opts = opts || {};
    initRefs();
    var delaiMs = ((test.fiche && test.fiche.delai) || opts.delaiDefaut || 15 * 60) * 1000;
    /* SPEC-BANC-084 : un test visuel (étiqueté `rendu`) fixe graine, heure,
       météo, caméra, résolution et horloge AVANT son corps et sa première
       capture ; `fiche.scene` ne fait que surcharger les valeurs par défaut
       (tests/rendu-repro.js). */
    var estRendu = !!(test.fiche && Array.isArray(test.fiche.etiquettes) && test.fiche.etiquettes.indexOf('rendu') >= 0 && G.MC_REPRO);
    var preparation = estRendu
      ? G.MC_REPRO.fixer(g, test.fiche.scene || {}, { frames: frames, resolution: G.MC_BANC && G.MC_BANC.reglerResolution })
      : Promise.resolve(null);
    return preparation.then(function (sceneEtat) { return runUnE2EPrepare(g, test, opts, delaiMs, sceneEtat); }, function (err) {
      return { id: test.id !== undefined ? test.id : null, nom: test.name, type: 'e2e', groupe: 'end-to-end', domaines: test.domaines || [], specs: test.specs || [],
        fiche: test.fiche || null, etat: 'echec', debut: new Date().toISOString(), duree_ms: 0, etapes: [], assertions: { ok: 0, ko: 1 },
        message: 'scène non fixable : ' + ((err && err.message) || err), pile: null, attendu: undefined, obtenu: undefined, metriques: null, captures: [], etapesTriplets: [] };
    });
  }
  function runUnE2EPrepare(g, test, opts, delaiMs, sceneEtat) {
    return new Promise(function (resolve) {
      var ctx = { g: g, t0: ahora(), debutISO: new Date().toISOString(), images: [], etapes: [], captures: [],
                  assertions: { ok: 0, ko: 0 }, etapeCourante: null, mesures: [],
                  // étapes déclarées et triplets (SPEC-BANC-077 à 081)
                  etapesTriplets: [], etapeCourante2: null, _chaineEtapes: null };
      enCours = ctx;
      var diag = demarrerDiagnostics(test);
      var c0 = capturer(g, 'début');
      if (c0) { c0.t_ms = 0; ctx.captures.push(c0); }
      // étape IMPLICITE `test` (SPEC-BANC-077) : ouverte dès le départ, comme
      // n'importe quelle étape déclarée — un test qui n'appelle jamais
      // T.etape() garde exactement CETTE étape, du début à la fin du test.
      ctx._chaineEtapes = ouvrirEtape(g, ctx, 'test');
      var fini = false;

      /* Rôle de chaque capture (SPEC-BANC-032, historique par test) : la
         PREMIÈRE (toujours « début », posée ci-dessus) et la DERNIÈRE
         (toujours posée par conclure(), qu'il s'agisse de « fin », « échec »
         ou « délai dépassé ») ne sont connues qu'une fois le test terminé —
         d'où l'affectation ICI, une seule fois, plutôt qu'à chaque push. */
      function assignerRoles() {
        var n = ctx.captures.length;
        ctx.captures.forEach(function (c, i) {
          c.role = (i === 0) ? 'debut' : (i === n - 1 ? 'fin' : 'intermediaire');
        });
      }

      // percentile générique (p50/p95) sur un tableau de nombres déjà triable
      function percentile(valeurs, p) {
        if (!valeurs.length) return 0;
        var triees = valeurs.slice().sort(function (a, b) { return a - b; });
        return triees[Math.min(triees.length - 1, Math.floor(triees.length * p))];
      }
      /* Métriques (SPEC-BANC-087) sur une fenêtre d'images du test : bornes
         [debutMs, finMs] en ms depuis ctx.t0, ou tout le test si omises —
         c'est ce qui permet de produire les MÊMES métriques globalement
         (metriques(), plus bas) et par étape (dans etapesTriplets, ci-dessous). */
      function metriquesFenetre(debutMs, finMs) {
        var d0 = debutMs === undefined ? -Infinity : debutMs, d1 = finMs === undefined ? Infinity : finMs;
        var imgs = ctx.images.filter(function (t) { var rel = t - ctx.t0; return rel >= d0 && rel <= d1; });
        var deltas = [];
        for (var i = 1; i < imgs.length; i++) deltas.push(imgs[i] - imgs[i - 1]);
        var msImage = deltas.filter(function (d) { return d > 0; });
        var fps = msImage.map(function (d) { return 1000 / d; });
        var info = null;
        try { info = g.render.renderer.info.render; } catch (e) { /* rien */ }
        var memInfo = null;
        try { memInfo = g.render.renderer.info.memory; } catch (e) { /* rien */ }
        var tasJS = null;
        try { tasJS = performance.memory ? performance.memory.usedJSHeapSize : null; } catch (e) { /* rien */ }
        // noms de champs alignés sur le schéma documenté par tests/rapport.js
        // (noyau, SPEC-BANC-012/013/014) : fps_moy/appels/memoire, pas
        // fps_moyen/appels_dessin/memoire_js — sinon rapport.html, les
        // exports et la campagne affichent ces métriques comme absentes.
        return {
          images: imgs.length,
          fps_moy: moyenne(fps), fps_min: fps.length ? Math.min.apply(null, fps) : 0,
          ms_image_p50: percentile(msImage, 0.50), ms_image_p95: percentile(msImage, 0.95),
          fps_p95: percentile(fps, 0.95),
          ms_image: moyenne(msImage),
          appels: info ? info.calls : null, triangles: info ? info.triangles : null,
          memoire: memInfo, tasJS: tasJS,
        };
      }
      function metriques() { return metriquesFenetre(); }
      function conclure(etat, message, pile, attendu, obtenu) {
        if (fini) return; fini = true;
        clearTimeout(minuteur);
        // referme l'étape encore ouverte (implicite `test`, ou la dernière
        // déclarée) puis attend TOUTE la chaîne d'étapes (SPEC-BANC-077) —
        // aucun triplet en vol n'est perdu, même si le test se termine juste
        // après un T.etape() dont la collecte (3 vraies images) est encore
        // en cours.
        var chaine = (ctx._chaineEtapes || Promise.resolve()).then(function () { return fermerEtapeCourante(g, ctx); });
        chaine.then(function () {
          assignerRoles();
          // aplati les triplets de chaque étape dans `captures` (identité
          // SPEC-BANC-080 : test/étape/debut|fin/rang, au même titre que les
          // autres images d'un diaporama), ET porte les étapes elles-mêmes
          // avec leurs métriques propres (fenêtre debut_t_ms→fin_t_ms).
          var capturesTriplets = [];
          var etapesAvecMetriques = ctx.etapesTriplets.map(function (e) {
            (e.debut ? e.debut.captures : []).forEach(function (c) { capturesTriplets.push(c); });
            (e.fin ? e.fin.captures : []).forEach(function (c) { capturesTriplets.push(c); });
            return {
              nom: e.nom, mouvement: e.fin && e.fin.mouvement ? e.fin.mouvement : (e.debut ? e.debut.mouvement : null),
              debut_t_ms: Math.round(e.debut_t_ms),
              fin_t_ms: e.fin_t_ms === null ? null : Math.round(e.fin_t_ms),
              instabilite_debut: e.debut ? e.debut.instabilite : null,
              instabilite_fin: e.fin ? e.fin.instabilite : null,
              metriques: metriquesFenetre(e.debut_t_ms, e.fin_t_ms === null ? undefined : e.fin_t_ms),
            };
          });
          var res = {
            id: test.id !== undefined ? test.id : null, nom: test.name, type: 'e2e',
            groupe: 'end-to-end', domaines: test.domaines || [], specs: test.specs || [],
            fiche: test.fiche || null, etat: etat, debut: ctx.debutISO, duree_ms: ahora() - ctx.t0, etapes: ctx.etapes,
            assertions: ctx.assertions, message: message || null, pile: pile || null,
            attendu: attendu, obtenu: obtenu, metriques: metriques(),
            captures: ctx.captures.concat(capturesTriplets),
            mesures: ctx.mesures,
            etapesTriplets: etapesAvecMetriques,
          };
          // SPEC-BANC-092 à 094, 099, 101 : vol, instantané, erreurs cachées, tâches longues — si échec ou lenteur
          if (etat !== 'reussi' && !ctx.instantane) ctx.instantane = prendreInstantane(g);     // délai : le test ne rend jamais la main, pas de finally
          Object.assign(res, terminerDiagnostics(diag, ctx, g, etat, res.duree_ms, opts));
          if (sceneEtat) { res.scene = sceneEtat.decrit; sceneEtat.restaurer(); }
          enCours = null;
          nettoyer(g);
          /* SPEC-BANC-103 : pour un test réseau en échec, le journal du serveur de jeu du banc (POST /tests/serveur-jeu)
             pendant le test — avec `traceReseau: true` à sa création, il porte aussi une ligne par message échangé. */
          if (res.reseau && typeof fetch === 'function') {
            fetch('/tests/serveur-jeu/journal').then(function (rep) { return rep.json(); }).then(function (o) {
              res.reseau.journal_serveur = String((o && o.journal) || '').split(/\r?\n/).filter(Boolean).slice(-50);
            }, function () { /* pas de serveur de jeu de test : le journal du serveur manque, le reste est là */ }).then(function () { resolve(res); });
          } else resolve(res);
        });
      }
      var minuteur = setTimeout(function () {
        var c = capturer(g, 'délai dépassé');
        if (c) { c.t_ms = ahora() - ctx.t0; ctx.captures.push(c); }
        conclure('delai', 'délai dépassé (' + (delaiMs / 1000) + ' s)' +
                 (ctx.etapeCourante ? ' — étape en cours : ' + ctx.etapeCourante : ''));
      }, delaiMs);

      /* SPEC-BANC-094 : l'instantané est pris dans le `finally` du test — il existe même
         si l'échec survient au milieu du test, avant toute capture « fin ». */
      (async function () {
        try { return await test.fn(g); }
        finally { ctx.instantane = prendreInstantane(g); }
      })().then(function () {
        var c = capturer(g, 'fin');
        if (c) { c.t_ms = ahora() - ctx.t0; ctx.captures.push(c); }
        conclure('reussi', null);
      }, function (e) {
        var msg = (e && e.message) || String(e);
        var pile = (e && e.stack) ? String(e.stack) : null;
        var c = capturer(g, 'échec');
        if (c) { c.t_ms = ahora() - ctx.t0; ctx.captures.push(c); }
        conclure('echec', msg, pile, e && e.attendu, e && e.obtenu);
      });
    });
  }

  // ─── exécution de la suite ─────────────────────────────────────────────────
  /* Historique, non instrumenté : `filtre` (facultatif) ne lance que les
     tests dont le nom le contient. Conservé pour un usage minimal. */
  async function runE2E(g, onProgress, filtre) {
    initRefs();
    g = g || window.GAME;
    var results = [], passed = 0, failed = 0;
    for (var i = 0; i < tests.length; i++) {
      var t = tests[i];
      if (filtre && t.name.indexOf(filtre) < 0) continue;
      try {
        await t.fn(g);
        results.push({ ok: true, name: t.name });
        passed++;
      } catch (e) {
        results.push({ ok: false, name: t.name, message: (e && e.message) || String(e) });
        failed++;
      }
      if (onProgress) onProgress(results[results.length - 1], i + 1, tests.length);
    }
    nettoyer(g);
    return { results: results, passed: passed, failed: failed, total: filtre ? results.length : tests.length };
  }

  /* Campagne instrumentée (SPEC-BANC-008/009/010) : `liste` est un
     sous-ensemble de `tests` (avec éventuellement `id`/`domaines`/`specs`
     déjà posés par le catalogue) ; `suivi = { debutTest(t), etape(t, libelle,
     n, total), finTest(t, resultat) }` ; `arretee()` — fonction consultée
     entre deux tests — permet à l'appelant de couper la campagne
     (bouton « arrêter », SPEC-BANC-014 : campagne marquée interrompue). */
  async function runCampagneE2E(g, liste, suivi, opts) {
    initRefs();
    opts = opts || {};
    var resultats = [];
    for (var i = 0; i < liste.length; i++) {
      if (opts.arretee && opts.arretee()) break;
      var t = liste[i];
      if (suivi && suivi.debutTest) suivi.debutTest(t);
      var r = await runUnE2E(g, t, opts);
      resultats.push(r);
      if (suivi && suivi.finTest) suivi.finTest(t, r);
    }
    nettoyer(g);
    return resultats;
  }

  /* Exécute UN test par son NOM EXACT, avec la même instrumentation que
     `runUnE2E` (étapes, triplets, métriques) — pour tools/e2e-headless.js
     (campagne sans fenêtre, SPEC-BANC-023/024/025), qui ne connaît les
     tests que par leur nom (transmis en JSON, jamais la fonction elle-même
     : elle vit dans la fermeture de ce module). Ambiguïté (aucun test ou
     plusieurs du même nom exact) : rendu explicite plutôt que de deviner. */
  function runUnE2EParNom(g, nom, opts) {
    var trouves = tests.filter(function (t) { return t.name === nom; });
    if (trouves.length !== 1) {
      return Promise.resolve({ etat: 'echec', nom: nom, duree_ms: 0, etapes: [], captures: [],
        assertions: { ok: 0, ko: 1 }, message: 'sélection par nom exact ambiguë ou vide (' + trouves.length + ' correspondance(s))' });
    }
    return runUnE2E(g, trouves[0], opts);
  }

  G.runE2E = runE2E;
  G.runUnE2E = runUnE2E;
  G.runUnE2EParNom = runUnE2EParNom;
  G.runCampagneE2E = runCampagneE2E;
  G.nettoyerE2E = nettoyer;
  /* Un lot d'e2e peut vivre dans son propre fichier, chargé APRÈS celui-ci
     (tests/index.html ; ex. tests/e2e-jouabilite.js, SPEC-JOUABLE-*) : il
     enregistre ses tests dans la MÊME liste (donc mêmes campagnes, même
     instrumentation, mêmes captures début/fin) et réutilise les mêmes
     outils. `enregistreur(fichier)` rend un `e2e(nom, fiche, fn)` qui porte
     le fichier d'origine (catalogue, périmètre). tests/run.js lit ce
     fichier en texte comme celui-ci (FICHIERS_E2E). */
  G.E2E_API = {
    enregistreur: function (fichier) {
      return function (name, ficheOuFn, fn) {
        tests.push({ name: name, fiche: fn ? ficheOuFn : null, fn: fn || ficheOuFn, fichier: fichier });
      };
    },
    A: A, T: T, fail: fail, frames: frames, wait: wait, key: key, fakeLock: fakeLock,
    mouseDown: mouseDown, mouseUp: mouseUp, look: look, reset: reset, sonderE2E: sonderE2E,
    serveurPresent: serveurPresent, capture: capture, initRefs: initRefs,
    // rendu reproductible et mouvements scriptés (SPEC-BANC-082, 084)
    capturerTriplet: capturerTriplet, poseCourante: poseCourante,
  };
  Object.defineProperty(G, 'E2E_COUNT', { get: function () { return tests.length; }, configurable: true });
  G.E2E_LISTE = tests;
  G.etape = etape;
  G.capture = capture;
  /* NE JAMAIS remplacer le harnais : dans tests/index.html, tests/harness.js
     a déjà posé G.T (describe/it/run, et les suites de tous les fichiers
     unit/functional/spec-* chargés avant ce fichier). L'écraser par ce petit
     objet { etape } vidait le catalogue du banc navigateur de TOUS ses tests
     Node (150 tests e2e visibles sur ~1 440) — banc-ui.js lit `T.suites`.
     On greffe donc l'API e2e sur le harnais : pendant un e2e, `T.etape(nom)`
     est celle de ce fichier (SPEC-BANC-077) ; sinon, celle du harnais
     (`etape(libellé, n, total)`, tests/harness.js). Sans harnais (page qui
     ne charge que e2e.js), l'objet e2e reste exposé tel quel. */
  if (G.T && typeof G.T.run === 'function' && G.T !== T) {
    var etapeHarnais = G.T.etape;
    G.T.etape = function () {
      if (enCours || typeof etapeHarnais !== 'function') return T.etape.apply(T, arguments);
      return etapeHarnais.apply(G.T, arguments);
    };
  } else {
    G.T = T;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
