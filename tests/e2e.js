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

  var C, I, B, Inv;
  function initRefs() { C = MC.Core; I = C.I; B = C.B; Inv = MC.Inventory; }

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
    A.ok(document.querySelector('#btn-play'), 'bouton Jouer présent');
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
    var cr = host.querySelector('.crosshair').getBoundingClientRect();
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
    mouseDown(g, 0);
    await frames(8);
    A.equal(getComputedStyle(document.querySelector('.mining-ring')).display, 'block', 'barre visible');
    mouseUp(0);
    await frames(4);
    A.equal(getComputedStyle(document.querySelector('.mining-ring')).display, 'none', 'barre masquée');
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
    g.entities.spawn('zombie', s.pos.x + 0.6, s.pos.y, s.pos.z);
    var hp0 = s.hp;
    for (var i = 0; i < 180 && s.hp === hp0; i++) await frames(1);
    A.lt(s.hp, hp0, 'le joueur a perdu de la vie (' + s.hp + ')');
    g.entities.list.length = 0;
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
    A.equal(g.world.lights.size, 1, 'inscrite au registre');
    await frames(4);
    var allumees = g.render.torchPool.filter(function (L) { return L.visible; }).length;
    A.gt(allumees, 0, 'une lumiere ponctuelle est active');
    g.world.setBlock(bx, by + 1, bz, 0);
    await frames(4);
    A.equal(g.render.torchPool.filter(function (L) { return L.visible; }).length, 0,
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
      'outil entame : la jauge apparait');
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

    A.ok(MC.Save.load(localStorage, g), 'rechargée');
    g.world.getChunk(Math.floor(bx / 16), Math.floor(bz / 16), true);
    A.equal(g.world.getBlock(bx, by, bz), B.BRICK, 'brique retrouvée');
    A.equal(s.inv.count(B.GLASS), 33, 'inventaire retrouvé');
    A.equal(s.hp, 11, 'vie retrouvée');
    localStorage.removeItem(MC.Save.KEY);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // HUD
  // ══════════════════════════════════════════════════════════════════════════
  e2e('le HUD reflète la vie et la faim', async function (g) {
    var s = await reset(g);
    s.hp = 6; s.hunger = 4;
    await frames(3);
    var pleins = document.querySelectorAll('.bar.health .pip.full').length;
    A.equal(pleins, 3, '6 pv = 3 cœurs pleins');
    var food = document.querySelectorAll('.bar.hunger .pip.full').length;
    A.equal(food, 2, '4 points de faim = 2 pastilles');
    s.hp = 20; s.hunger = 20;
  });

  e2e('la jauge d\'air n\'apparaît que sous l\'eau', async function (g) {
    var s = await reset(g);
    s.air = 10;
    await frames(3);
    A.equal(getComputedStyle(document.querySelector('.bar.air')).display, 'none', 'masquée hors de l\'eau');
    s.air = 4;
    await frames(3);
    A.ne(getComputedStyle(document.querySelector('.bar.air')).display, 'none', 'visible en apnée');
    s.air = 10;
  });

  e2e('la hotbar suit la sélection et le contenu', async function (g) {
    var s = await reset(g);
    s.inv.add(B.BRICK, 7);
    await frames(3);
    var slots = document.querySelectorAll('.hotbar .slot');
    A.ok(slots[0].classList.contains('on'), 'case 0 sélectionnée');
    A.equal(slots[0].querySelector('.n').textContent, '7', 'quantité affichée');
    key('Digit3');
    await frames(3);
    A.equal(s.selected, 2, 'sélection au clavier');
    A.ok(document.querySelectorAll('.hotbar .slot')[2].classList.contains('on'), 'surbrillance déplacée');
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

  e2e('explorer ne fait pas exploser le nombre de chunks', async function (g) {
    var s = await reset(g);
    s.flying = true;
    s.yaw = 0;
    key('KeyW');
    for (var i = 0; i < 180; i++) await frames(1);
    key('KeyW', 'keyup');
    s.flying = false;
    A.lt(g.world.chunks.size, 200, 'les chunks lointains sont déchargés (' + g.world.chunks.size + ')');
    await reset(g);
  });

  // ─── exécution ─────────────────────────────────────────────────────────────
  async function runE2E(g, onProgress) {
    initRefs();
    g = g || window.GAME;
    var results = [], passed = 0, failed = 0;
    for (var i = 0; i < tests.length; i++) {
      var t = tests[i];
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
    return { results: results, passed: passed, failed: failed, total: tests.length };
  }

  G.runE2E = runE2E;
  G.E2E_COUNT = tests.length;
})(typeof globalThis !== 'undefined' ? globalThis : this);
