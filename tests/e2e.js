/* e2e.js — tests end-to-end : ils pilotent une VRAIE partie dans le navigateur
   (rendu, DOM, boucle de jeu, capture souris) et vérifient le comportement
   observable, pas l'état interne des modules.

   Exécution : ouvrir tests/e2e.html, ou appeler window.runE2E(). */
(function (G) {
  'use strict';
  var tests = [];
  function e2e(name, fn) { tests.push({ name: name, fn: fn }); }

  function fail(msg) { var e = new Error(msg); e.isAssertion = true; throw e; }
  var A = {
    ok: function (v, m) { if (!v) fail((m || 'attendu vrai') + ' — obtenu ' + v); },
    notOk: function (v, m) { if (v) fail((m || 'attendu faux') + ' — obtenu ' + v); },
    equal: function (a, b, m) { if (a !== b) fail((m || 'égalité') + ' — attendu ' + b + ', obtenu ' + a); },
    ne: function (a, b, m) { if (a === b) fail((m || 'différence') + ' — les deux valent ' + a); },
    ok2: function (v, m) { A.ok(v, m); },
    gt: function (a, b, m) { if (!(a > b)) fail((m || 'supérieur') + ' — ' + a + ' <= ' + b); },
    lt: function (a, b, m) { if (!(a < b)) fail((m || 'inférieur') + ' — ' + a + ' >= ' + b); },
    close: function (a, b, eps, m) {
      if (Math.abs(a - b) > (eps === undefined ? 1e-6 : eps))
        fail((m || 'proximité') + ' — attendu ' + b + ', obtenu ' + a);
    },
  };

  // ─── utilitaires ───────────────────────────────────────────────────────────
  /* Attend n images RÉELLES. Piège : une version qui teste le compteur avant
     le premier requestAnimationFrame résout de façon synchrone pour n=1, et
     tous les `for (...) await frames(1)` tournent alors sans jamais laisser
     la boucle de jeu s'exécuter. */
  function frames(n) {
    return new Promise(function (res) {
      var left = Math.max(1, n | 0);
      var step = function () { if (--left <= 0) return res(); requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* En contexte de test on ne peut pas obtenir un vrai verrou de pointeur
     (il exige un geste utilisateur). On simule donc `pointerLockElement`
     pour que le jeu se croie en partie, ce qui est exactement ce que teste
     la machine à états. */
  function fakeLock(g, on) {
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
    g.entities.list.length = 0;
    var col = g.world.findSpawnColumn();
    var gy = g.world.groundAt(col[0], col[1], true);
    s.pos.x = col[0] + 0.5; s.pos.y = gy + 1.2; s.pos.z = col[1] + 0.5;
    s.yaw = 0; s.pitch = 0;
    await frames(3);
    return s;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Démarrage et états
  // ══════════════════════════════════════════════════════════════════════════
  e2e('le jeu démarre sur le menu principal, monde déjà généré', async function (g) {
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
  e2e('le viseur coïncide avec le centre du canvas', async function (g) {
    var cv = g.render.renderer.domElement;
    var host = cv.parentElement;
    var r = cv.getBoundingClientRect();
    // clientWidth exclut la bordure, contrairement à getBoundingClientRect :
    // c'est bien la zone de contenu que le canvas doit remplir.
    A.close(r.width, host.clientWidth, 1.5, 'le canvas remplit son conteneur en largeur');
    A.close(r.height, host.clientHeight, 1.5, 'et en hauteur');
    var cr = g.ui.hudDe(0).querySelector('.crosshair').getBoundingClientRect();
    A.close(cr.left + cr.width / 2, r.left + r.width / 2, 1.5, 'viseur centré horizontalement');
    A.close(cr.top + cr.height / 2, r.top + r.height / 2, 1.5, 'viseur centré verticalement');
    // et le rapport d'aspect de la caméra doit suivre, sinon l'image est étirée
    A.close(g.render.camera.aspect, r.width / r.height, 0.02, 'aspect de la caméra cohérent');
  });

  e2e('passer en partie masque le menu', async function (g) {
    g.input.setState('playing');
    fakeLock(g, true);
    await frames(2);
    A.equal(g.input.state, 'playing');
    A.equal(getComputedStyle(document.querySelector('.overlay')).display, 'none', 'menu masqué');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Capture souris et pause  (les défauts signalés)
  // ══════════════════════════════════════════════════════════════════════════
  e2e('perdre la capture souris met le jeu en PAUSE', async function (g) {
    await reset(g);
    A.equal(g.input.state, 'playing', 'en partie');
    fakeLock(g, false);                     // simule Échap / clic hors fenêtre
    await frames(2);
    A.equal(g.input.state, 'paused', 'le jeu est passé en pause, pas en course libre');
    A.equal(getComputedStyle(document.querySelector('.overlay')).display, 'flex', 'menu pause affiché');
  });

  e2e('en pause, le monde est figé', async function (g) {
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

  e2e('perdre le focus de la fenêtre met en pause', async function (g) {
    await reset(g);
    window.dispatchEvent(new Event('blur'));
    await frames(2);
    A.equal(g.input.state, 'paused', 'pause sur perte de focus');
  });

  e2e('les touches sont relâchées quand on perd le contrôle', async function (g) {
    await reset(g);
    key('KeyW');
    A.ok(g.input.actions().forward, 'touche enfoncée');
    fakeLock(g, false);
    await frames(2);
    A.notOk(g.input.actions().forward, 'touche relâchée : pas de dérive fantôme');
  });

  e2e('reprendre depuis la pause relance la partie', async function (g) {
    await reset(g);
    fakeLock(g, false);
    await frames(2);
    A.equal(g.input.state, 'paused');
    document.querySelector('#btn-resume').click();
    fakeLock(g, true);
    await frames(3);
    A.equal(g.input.state, 'playing', 'partie reprise');
  });

  e2e('Échap bascule partie ↔ pause', async function (g) {
    await reset(g);
    key('Escape');
    await frames(2);
    A.equal(g.input.state, 'paused', 'Échap met en pause');
    key('Escape');
    fakeLock(g, true);
    await frames(2);
    A.equal(g.input.state, 'playing', 'Échap reprend');
  });

  e2e('la souris ne fait pivoter la vue qu\'en partie', async function (g) {
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

  e2e('un delta de souris aberrant est ignoré', async function (g) {
    await reset(g);
    var y0 = g.player.state.yaw;
    look(5000, 0);                           // artefact d'acquisition du verrou
    A.equal(g.player.state.yaw, y0, 'le saut de vue est filtré');
    look(50, 0);
    A.ne(g.player.state.yaw, y0, 'un mouvement normal passe');
  });

  e2e('la souris tourne dans le bon sens', async function (g) {
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

  e2e('le tangage est borné : on ne se retourne jamais', async function (g) {
    await reset(g);
    for (var i = 0; i < 60; i++) look(0, -150);
    A.lt(Math.abs(g.player.state.pitch), Math.PI / 2 + 1e-6, 'tangage borné');
    for (var j = 0; j < 120; j++) look(0, 150);
    A.lt(Math.abs(g.player.state.pitch), Math.PI / 2 + 1e-6, 'borné dans l\'autre sens');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Déplacement réel dans la boucle
  // ══════════════════════════════════════════════════════════════════════════
  e2e('avancer déplace le joueur dans la direction du regard', async function (g) {
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

  e2e('le joueur tombe et se pose sur le terrain', async function (g) {
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
  e2e('E ouvre l\'inventaire et libère la souris', async function (g) {
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

  e2e('Échap ferme l\'inventaire sans passer par la pause', async function (g) {
    await reset(g);
    key('KeyE');
    await frames(2);
    key('Escape');
    fakeLock(g, true);
    await frames(2);
    A.equal(g.input.state, 'playing', 'retour direct en partie');
  });

  e2e('l\'inventaire affiche les objets détenus', async function (g) {
    var s = await reset(g);
    s.inv.add(B.COBBLE, 17);
    key('KeyE');
    await frames(2);
    var txt = document.querySelector('.inv-screen').textContent;
    A.ok(txt.indexOf('17') >= 0, 'la quantité 17 est affichée');
    key('Escape'); fakeLock(g, true); await frames(2);
  });

  e2e('cliquer déplace une pile entre deux cases', async function (g) {
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

  e2e('le clic droit prend la moitié d\'une pile', async function (g) {
    var s = await reset(g);
    s.inv.add(B.COBBLE, 10);
    key('KeyE');
    await frames(2);
    var slots = document.querySelectorAll('.inv-screen .hb-row .slot');
    slots[0].dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }));
    A.equal(g.ui.heldStack.n, 5, 'moitié prise');
    A.equal(s.inv.slots[0].n, 5, 'moitié laissée');
    slots[0].dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    key('Escape'); fakeLock(g, true); await frames(2);
  });

  e2e('crafter des planches depuis un tronc, via l\'interface', async function (g) {
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
    A.ok(g.ui.heldStack, 'résultat en main');
    A.equal(g.ui.heldStack.id, B.PLANKS);
    A.equal(g.ui.heldStack.n, 4, '4 planches');
    key('Escape'); fakeLock(g, true); await frames(3);
    A.equal(s.inv.count(B.PLANKS), 4, 'les planches sont rentrées à l\'inventaire');
  });

  e2e('fermer l\'inventaire rend les objets restés dans la grille', async function (g) {
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

  e2e('un établi posé ouvre une grille 3×3', async function (g) {
    var s = await reset(g);
    var bx = Math.floor(s.pos.x), bz = Math.floor(s.pos.z) + 2;
    var by = g.world.groundAt(bx, bz, true) + 1;
    g.world.setBlock(bx, by, bz, B.CRAFTING_TABLE);
    var res = g.player.useOn({ x: bx, y: by, z: bz, block: B.CRAFTING_TABLE, nx: 0, ny: 1, nz: 0 });
    A.equal(res, 'open:craft', 'l\'établi demande son interface');
    g.ui.openContainer('craft', s.inv);
    g.input.setState('ui');
    await frames(2);
    A.equal(document.querySelectorAll('.inv-screen .craft-grid .slot').length, 9, 'grille 3×3');
    key('Escape'); fakeLock(g, true); await frames(2);
  });

  e2e('SPEC-CONSTR-001 : deux escaliers posés s\'orientent et s\'ajustent en angle, dans la vraie boucle', async function (g) {
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

  // ══════════════════════════════════════════════════════════════════════════
  // Miner, poser, ramasser — dans la boucle réelle
  // ══════════════════════════════════════════════════════════════════════════
  e2e('maintenir le clic gauche mine le bloc visé', async function (g) {
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

  e2e('le bloc miné tombe puis est ramassé automatiquement', async function (g) {
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
    A.gt(total1, total0, 'l\'inventaire s\'est rempli (' + total0 + ' -> ' + total1 + ')');
  });

  e2e('la barre de progression du minage apparaît puis disparaît', async function (g) {
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

  e2e('le clic droit pose un bloc du bon type', async function (g) {
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

  e2e('poser dans son propre corps est refusé', async function (g) {
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

  e2e('le bloc visé est mis en surbrillance', async function (g) {
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
  e2e('un mob apparaît et reçoit un maillage', async function (g) {
    var s = await reset(g);
    var z = g.entities.spawn('zombie', s.pos.x + 3, s.pos.y, s.pos.z);
    await frames(3);
    A.ok(g.render.entityMeshes.get(z.eid), 'le zombie a un objet 3D');
    g.entities.remove(z);
    await frames(3);
    A.notOk(g.render.entityMeshes.get(z.eid), 'objet 3D retiré avec l\'entité');
  });

  e2e('frapper un mob visé le blesse', async function (g) {
    var s = await reset(g);
    s.yaw = 0; s.pitch = 0;
    var dist = 2.5;
    var z = g.entities.spawn('sheep', s.pos.x, s.pos.y, s.pos.z - dist);
    // Un mouton fait 1,2 m : à l'horizontale on lui passe AU-DESSUS. Il faut
    // viser sa boîte, donc incliner le regard vers son milieu.
    var dy = (z.pos.y + z.h / 2) - (s.pos.y + g.player.EYE);
    s.pitch = Math.atan2(dy, dist);
    await frames(2);
    var hp0 = z.hp;
    s.attackCd = 0;
    mouseDown(g, 0);
    mouseUp(0);
    await frames(2);
    A.lt(z.hp, hp0, 'le mouton est blessé (' + hp0 + ' -> ' + z.hp + ')');
  });

  e2e('un zombie au contact fait perdre de la vie', async function (g) {
    var s = await reset(g);
    // le point d'apparition est une zone sûre (SPEC-ZONE-001) : l'essai se fait en zone PvP et PvE
    var r0 = g.world.reglesZoneEn;
    g.world.reglesZoneEn = function () { return MC.Zones.regles('pvp_pve'); };
    try {
      g.entities.spawn('zombie', s.pos.x + 0.6, s.pos.y, s.pos.z);
      var hp0 = s.hp;
      for (var i = 0; i < 180 && s.hp === hp0; i++) await frames(1);
      A.lt(s.hp, hp0, 'le joueur a perdu de la vie (' + s.hp + ')');
    } finally { g.world.reglesZoneEn = r0; g.entities.list.length = 0; }
  });

  e2e('la mort ouvre l\'écran de réapparition', async function (g) {
    var s = await reset(g);
    g.player.hurt(20);
    await frames(4);
    A.equal(g.input.state, 'dead', 'état mort');
    A.ok(document.querySelector('#btn-respawn'), 'bouton Réapparaître');
    document.querySelector('#btn-respawn').click();
    fakeLock(g, true);
    await frames(4);
    A.equal(g.input.state, 'playing', 'partie reprise');
    A.equal(s.hp, 20, 'vie restaurée');
    A.notOk(s.dead, 'vivant');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Agriculture, fourneau, cycle
  // ══════════════════════════════════════════════════════════════════════════
  e2e('labourer puis planter fonctionne en jeu', async function (g) {
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

  e2e('le blé pousse avec le temps et se récolte', async function (g) {
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

  e2e('le fourneau cuit et l\'interface se met à jour', async function (g) {
    var s = await reset(g);
    var bx = Math.floor(s.pos.x) + 2, bz = Math.floor(s.pos.z) + 2;
    var by = g.world.groundAt(bx, bz, true) + 1;
    g.world.setBlock(bx, by, bz, B.FURNACE);
    var r = g.player.useOn({ x: bx, y: by, z: bz, block: B.FURNACE, nx: 0, ny: 1, nz: 0 });
    A.equal(r, 'open:furnace');
    var k = bx + ',' + by + ',' + bz;
    g.furnaces[k] = MC.Inventory.newFurnace();
    g.furnaces[k].input = { id: B.IRON_ORE, n: 1 };
    g.furnaces[k].fuel = { id: I.COAL, n: 1 };
    g.ui.openContainer('furnace', s.inv, g.furnaces[k], k);
    g.input.setState('ui');
    await frames(2);
    A.equal(getComputedStyle(document.querySelector('.inv-screen')).display, 'flex', 'interface ouverte');
    // laisser cuire : l'état 'ui' fait tourner les fourneaux
    for (var i = 0; i < 600 && !g.furnaces[k].output; i++) await frames(1);
    A.ok(g.furnaces[k].output, 'quelque chose est sorti');
    A.equal(g.furnaces[k].output.id, I.IRON_INGOT, 'lingot de fer');
    key('Escape'); fakeLock(g, true); await frames(2);
  });

  e2e('clic droit sur un villageois ouvre le panneau d echange', async function (g) {
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

  e2e('un echange realisable se conclut au clic', async function (g) {
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

  e2e('une offre non payable est inerte', async function (g) {
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

  e2e('poser une torche cree une lumiere ponctuelle', async function (g) {
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

  e2e('le nombre de lumieres reste borne meme avec beaucoup de torches', async function (g) {
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

  e2e('un coffre stocke des objets et les rend quand on le casse', async function (g) {
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

    // on casse le coffre : le contenu doit retomber au sol
    var avant = g.entities.list.length;
    g.spillContainer(bx, by, bz);
    A.gt(g.entities.list.length, avant, 'des objets sont tombes');
    A.notOk(g.chests[k], 'le coffre est oublie');
    g.entities.list.length = 0;
  });

  e2e('la jauge d usure apparait sur un outil entame', async function (g) {
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

  e2e('la touche G jette l objet tenu', async function (g) {
    var s = await reset(g);
    s.inv.add(B.COBBLE, 3); s.selected = 0;
    var avant = g.entities.list.length;
    key('KeyG');
    await frames(3);
    A.equal(s.inv.count(B.COBBLE), 2, 'une unite en moins');
    A.gt(g.entities.list.length, avant, 'une entite au sol');
    g.entities.list.length = 0;
  });

  e2e('des grottes existent sous la surface', async function (g) {
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
    await frames(3);
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

  e2e('le retour arriere efface un caractere', async function (g) {
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
    for (var i = 0; i < 4; i++) {
      var r = hs[i].getBoundingClientRect(), v = g.vues[i];
      A.close(r.width, v.w, 2, 'HUD ' + i + ' : largeur de sa vue');
      A.close(r.height, v.h, 2, 'HUD ' + i + ' : hauteur de sa vue');
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
    var autre = MC.createNetClient({});
    g.net.connecter('', 'Hote', 1);
    await wait(700);
    A.equal(g.net.etat, 'en ligne', 'connecte');
    autre.connecter('', 'Visiteur', 1);
    await wait(700);
    autre.envoyer({ t: 'bouge', x: g.player.state.pos.x + 3, y: g.player.state.pos.y,
                    z: g.player.state.pos.z, yaw: 0 });
    await wait(500);
    await frames(5);
    A.equal(g.net.distants.size, 1, 'un joueur distant connu');
    var d = [...g.net.distants.values()][0];
    A.equal(d.nom, 'Visiteur', 'son nom est connu');
    A.gt(g.render.maillagesDistants.size, 0, 'un maillage lui est associe');
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

  e2e('le ciel change entre le jour et la nuit', async function (g) {
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

  e2e('sous l\'eau, la vue se teinte et le brouillard se resserre', async function (g) {
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
  e2e('sauvegarder puis recharger restitue la construction et l\'inventaire', async function (g) {
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
    A.ok(g.doSave(false), 'sauvegarde écrite');

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
  e2e('le HUD reflète la vie et la faim', async function (g) {
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

  e2e('la jauge d\'air n\'apparaît que sous l\'eau', async function (g) {
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

  e2e('la hotbar suit la sélection et le contenu', async function (g) {
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

  e2e('la molette change d\'objet sélectionné', async function (g) {
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
  e2e('la boucle tient une cadence correcte', async function (g) {
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
    await frames(40);
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
    // le repeuplement passe une fois par seconde : on l'attend
    var pnjs = [];
    for (var i = 0; i < 240 && pnjs.length < v.pnjs.length; i++) {
      await frames(1);
      pnjs = g.entities.list.filter(function (e) { return e.pnj && e.lieu === v.id; });
    }
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

  e2e('explorer ne fait pas exploser le nombre de chunks', async function (g) {
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
    var boss = g.entities.list.filter(function (e) { return e.donjon === d.id && MC.EntitySpecs[e.type].boss; });
    A.equal(boss.length, 1, 'le gardien s est éveillé (état : ' + g.input.state + ')');
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
    // le coffre donne son butin, une seule fois
    var inv = g.coffreDe(d.coffre.x, d.coffre.y, d.coffre.z);
    A.ok(inv && inv.slots.some(function (x) { return x; }), 'le coffre est garni');
    A.equal(g.coffreDe(d.coffre.x, d.coffre.y, d.coffre.z), inv, 'et reste le même coffre');
    g.entities.list.length = 0;
    delete g.chests[d.coffre.x + ',' + d.coffre.y + ',' + d.coffre.z];
    g.world.coffresPilles.clear();
    g.world.donjonsVaincus.clear();
    await reset(g);
  });

  e2e('SPEC-VEHIC-006 / SPEC-VEHIC-002 : monter en voiture, rouler au clavier, descendre avec F',
      async function (g) {
    var s = await reset(g);
    s.fallFrom = null;
    var V = MC.Vehicules;
    // une piste plate, dégagée, au-dessus du relief
    var y0 = Math.floor(s.pos.y) + 12;
    for (var x = -3; x <= 3; x++) for (var z = -40; z <= 3; z++) {
      g.world.setBlock(Math.floor(s.pos.x) + x, y0, Math.floor(s.pos.z) + z, B.STONE);
      for (var h = 1; h <= 3; h++) g.world.setBlock(Math.floor(s.pos.x) + x, y0 + h, Math.floor(s.pos.z) + z, 0);
    }
    var auto = V.poser(g.entities, 'voiture', Math.floor(s.pos.x) + 0.5, y0 + 1, Math.floor(s.pos.z) + 0.5, 0);
    await frames(3);
    A.ok(g.monterDans(auto), 'on monte');
    A.equal(s.monture, auto, 'le joueur est au volant');
    var z0 = auto.pos.z;
    key('KeyW');
    // 7 m/s² d'accélération : deux secondes donnent une bonne dizaine de blocs
    await frames(120);
    key('KeyW', 'keyup');
    A.ok(auto.pos.z < z0 - 5, 'la voiture a avancé (' + (z0 - auto.pos.z).toFixed(1) + ' blocs)');
    A.ok(Math.abs(s.pos.z - auto.pos.z) < 0.01, 'le conducteur a suivi');
    var hud = document.querySelector('.debug') || document.body;
    A.ok(/km\/h/.test(hud.textContent || document.body.textContent), 'le HUD affiche la vitesse');
    key('KeyF');
    await frames(3);
    A.equal(s.monture, null, 'F : pied à terre');
    A.notOk(P.collides(g.world, s.pos.x, s.pos.y, s.pos.z, 0.6, 1.8), 'à côté de la voiture, pas dedans');
    g.entities.remove(auto);
    await reset(g);
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

  e2e('SPEC-SUCCES-001 : casser un bloc débloque « Premier bloc » (toast) et K ouvre le panneau des succès',
      async function (g) {
    var s = await reset(g);
    g.succes = MC.Succes.creer();          // suivi vierge, indépendant des tests précédents
    s.inv.add(I.IRON_SHOVEL, 1); s.selected = 0;
    s.pitch = -Math.PI / 2 + 0.05;
    await frames(2);
    var t = g.player.aim();
    A.ok(t, 'un bloc est visé sous le joueur');
    var avant = g.world.getBlock(t.x, t.y, t.z);
    mouseDown(g, 0);
    for (var i = 0; i < 240 && g.world.getBlock(t.x, t.y, t.z) === avant; i++) await frames(1);
    mouseUp(0);
    await frames(2);
    A.ok(g.succes.estDebloque('premier_bloc'), 'le suivi de la partie a débloqué « premier bloc »');
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
      // une tornade : l'entonnoir se dresse, pousse le joueur et arrache les plantes (SPEC-NUAGE-004)
      me.tornades = function () { return [{ id: 't', x: p.x + 6, z: p.z, rayon: 12, force: 1, vie: 20, sens: 1 }]; };
      // la poussée vient de la vraie liste, interne à Meteo : on l'aligne sur la tornade simulée
      me.pousseeTornade = function (x, y, z) { return { x: (p.x + 6 - x) * 2, y: 10, z: 0 }; };
      await frames(3);
      var tm = g.render.formations.tornades[0];
      A.ok(tm && tm.visible, 'un entonnoir visible');
      A.close(tm.position.x, p.x + 6, 0.5, 'à sa place');
      A.gt(tm.scale.y, 15, 'du sol aux nuages');
      var x0 = p.x;
      for (var i = 0; i < 20; i++) await frames(1);
      A.ok(Math.abs(p.x - x0) > 0.3 || p.y > g.world.heightAt(Math.floor(p.x), Math.floor(p.z)) + 1.5, 'le joueur est emporté');
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

  e2e('SPEC-RELIEF-011 : un panache monte du cratère, dérive au vent, rougeoie en éruption ; les bombes tombent', async function (g) {
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
      // en éruption : panache épais et rougeoyant, bombes lancées
      var a0 = MC.Volcanisme.activite;
      MC.Volcanisme.activite = function () { return { fumee: 1, grondement: false, eruption: { debut: 0, fin: 1e9 }, prochaine: null }; };
      var p0 = MC.Volcanisme.projectiles;
      MC.Volcanisme.projectiles = function () { return [{ t: 0, x: faux.x, y: faux.sommet + 2, z: faux.z, vx: 2, vy: 20, vz: 0 }]; };
      await frames(3);
      A.equal(m.material.color.getHex(), 0x8a4a30, 'rougeoyant');
      A.ok(g.entities.list.some(function (e) { return e.type === 'arrow' && e.genre === 'bombe'; }), 'des bombes volcaniques');
      MC.Volcanisme.activite = a0; MC.Volcanisme.projectiles = p0;
    } finally {
      bio.volcansDansZone = dz0;
      for (var j = g.entities.list.length - 1; j >= 0; j--) if (g.entities.list[j].genre === 'bombe') g.entities.list.splice(j, 1);
      await frames(2);
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
      for (var i = 0; i < 40 && !/PvP/.test(document.body.textContent); i++) await frames(1);
      A.ok(/Vous entrez en zone PvP/.test(document.body.textContent), 'l entrée est annoncée');
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

  /* En dernier : ce test change de partie (mode histoire, autre graine). */
  e2e('SPEC-HISTOIRE-009 : une partie en mode histoire raconte, guide, limite et tient un journal', async function (g) {
    await reset(g);
    videParties();
    g.render.setDistance(5);
    g.creerPartie({ nom: 'Récit', mode: 'histoire', difficulte: 'facile', graineTexte: 'couronne', joueurs: 1,
                    histoire: { heros: 'Testeur', longueur: 'courte', interactions: { preset: 'restreinte' } } });
    await frames(5);
    A.ok(g.histoire && g.regles.histoire, 'le récit est lancé');
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
    // interactions restreintes : la pierre ne se casse pas
    A.notOk(MC.Modes.peutCasser(g.regles, B.STONE), 'la pierre est hors de l histoire');
    // le guide du village : l'histoire avance
    var guide = null;
    for (var t = 0; t < 240 && !guide; t++) {
      await frames(1);
      guide = g.entities.list.filter(function (e) { return e.role === 'guide' && g.histoire.histoire.liens.depart && e.lieu === g.histoire.histoire.liens.depart.id; })[0];
    }
    A.ok(guide, 'le guide du village de départ est là');
    var avant = g.histoire.histoire.etape + g.histoire.histoire.chap * 10;
    g.parlerA(guide);
    await frames(3);
    A.ok(document.querySelector('.dialogue-histoire').style.display !== 'none', 'il raconte');
    A.gt(g.histoire.histoire.etape + g.histoire.histoire.chap * 10, avant, 'et l histoire avance');
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
  });

  /* Tout à la fin aussi : encore un changement de partie, vers un autre
     archétype (l enquête). */
  e2e('SPEC-HISTOIRE-010 : les trois archétypes se choisissent et se jouent — ici, l enquête', async function (g) {
    await reset(g);
    videParties();
    g.render.setDistance(5);
    g.creerPartie({ nom: 'Enquête', mode: 'histoire', difficulte: 'facile', graineTexte: 'crime', joueurs: 1,
                    histoire: { archetype: 'enquete', heros: 'Testeur', longueur: 'courte', interactions: { preset: 'restreinte' } } });
    await frames(5);
    A.ok(g.histoire && g.histoire.archetype === 'enquete', 'le récit choisi est bien une enquête');
    var dlg = document.querySelector('.dialogue-histoire');
    A.ok(dlg && dlg.style.display !== 'none', 'un dialogue de chapitre s affiche');
    var obj = document.querySelector('.objectif-histoire');
    A.ok(obj && obj.style.display !== 'none' && /enquête/i.test(obj.textContent),
         'l objectif parle de l enquête : ' + (obj && obj.textContent));
  });

  // ─── exécution ─────────────────────────────────────────────────────────────
  /* `filtre` (facultatif) : ne lance que les tests dont le nom le contient. */
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
    // remise en état propre
    try { g.input.setState('menu'); } catch (e) {}
    return { results: results, passed: passed, failed: failed, total: filtre ? results.length : tests.length };
  }

  G.runE2E = runE2E;
  G.E2E_COUNT = tests.length;
})(typeof globalThis !== 'undefined' ? globalThis : this);
