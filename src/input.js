/* input.js — clavier, souris, et surtout la capture du pointeur.
   Le verrou souris est traité comme une CONSÉQUENCE de l'état du jeu, jamais
   comme une variable indépendante : c'est ce qui évite les désynchronisations
   (curseur libre alors que le jeu croit être en partie, et inversement). */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  // états : 'menu' (accueil) · 'playing' · 'paused' · 'ui' (inventaire/établi) · 'dead'
  var LOCKED_STATES = { playing: true };

  function createInput(canvas, hooks) {
    hooks = hooks || {};
    var state = 'menu';
    var keys = Object.create(null);
    var mouse = { left: false, right: false };
    var lockPending = false;
    var lockError = null;
    var retryTimer = null;

    // ─── correspondance touches → actions (AZERTY et QWERTY) ─────────────────
    var BINDINGS = {
      forward: ['KeyW', 'KeyZ', 'ArrowUp'],
      back: ['KeyS', 'ArrowDown'],
      left: ['KeyA', 'KeyQ', 'ArrowLeft'],
      right: ['KeyD', 'ArrowRight'],
      jump: ['Space'],
      sprint: ['ShiftLeft', 'ShiftRight'],
    };
    var CODE_TO_ACTION = {};
    Object.keys(BINDINGS).forEach(function (a) {
      BINDINGS[a].forEach(function (c) { CODE_TO_ACTION[c] = a; });
    });

    function actions() {
      return {
        forward: !!keys.forward, back: !!keys.back, left: !!keys.left,
        right: !!keys.right, jump: !!keys.jump, sprint: !!keys.sprint,
      };
    }
    function clearKeys() { for (var k in keys) keys[k] = false; mouse.left = mouse.right = false; }

    // ─── verrou du pointeur ──────────────────────────────────────────────────
    function isLocked() { return document.pointerLockElement === canvas; }

    /* Demande le verrou. Chrome le refuse pendant ~1,25 s après une sortie par
       Échap : on retente au lieu d'échouer en silence. */
    function requestLock(attempt) {
      if (isLocked() || lockPending) return;
      lockPending = true;
      lockError = null;
      var p;
      try {
        // unadjustedMovement : supprime l'accélération souris de l'OS.
        // Certains navigateurs ne connaissent pas l'option : on retombe alors
        // sur l'appel sans argument.
        p = canvas.requestPointerLock({ unadjustedMovement: true });
      } catch (e) {
        try { p = canvas.requestPointerLock(); } catch (e2) { p = null; }
      }
      if (p && typeof p.then === 'function') {
        p.then(function () { lockPending = false; }, function (err) {
          lockPending = false;
          // NotSupportedError = unadjustedMovement refusé : on réessaie sans
          if (err && err.name === 'NotSupportedError' && !attempt) {
            try { canvas.requestPointerLock(); } catch (e3) {}
            return;
          }
          scheduleRetry(err);
        });
      } else {
        // API ancienne, sans promesse : on vérifie peu après
        setTimeout(function () {
          lockPending = false;
          if (!isLocked() && LOCKED_STATES[state]) scheduleRetry(null);
        }, 250);
      }
    }

    function scheduleRetry(err) {
      lockError = (err && err.message) || 'le navigateur a refusé la capture';
      if (hooks.onLockError) hooks.onLockError(lockError);
      clearTimeout(retryTimer);
      // au-delà du délai imposé par le navigateur, une nouvelle tentative passe
      retryTimer = setTimeout(function () {
        if (LOCKED_STATES[state] && !isLocked()) requestLock(true);
      }, 1400);
    }

    function exitLock() {
      clearTimeout(retryTimer);
      if (isLocked()) document.exitPointerLock();
    }

    /* Point d'entrée unique : tout changement d'état passe par ici, et le
       verrou suit. Aucun autre code ne touche à requestPointerLock. */
    function setState(next) {
      if (next === state) return;
      var prev = state;
      state = next;
      clearKeys();
      if (LOCKED_STATES[next]) requestLock(false);
      else exitLock();
      if (hooks.onState) hooks.onState(next, prev);
    }

    document.addEventListener('pointerlockchange', function () {
      lockPending = false;
      if (isLocked()) {
        lockError = null;
        clearTimeout(retryTimer);
        if (hooks.onLockGained) hooks.onLockGained();
        return;
      }
      clearKeys();
      // Le verrou a sauté alors qu'on jouait : Échap, alt-tab, clic hors fenêtre.
      // On met en PAUSE plutôt que de laisser tourner une partie sans entrées.
      if (state === 'playing') setState('paused');
      if (hooks.onLockLost) hooks.onLockLost();
    });

    document.addEventListener('pointerlockerror', function () {
      lockPending = false;
      scheduleRetry({ message: 'capture refusée par le navigateur' });
    });

    /* Mode saisie : tant qu'il est actif, AUCUNE touche ne pilote le jeu.
       Sans ce verrou, taper « avance » dans le chat ferait courir le joueur.
       Déclaré ici, avant les gestionnaires qui le lisent. */
    var EFFACE = String.fromCharCode(8);   // sentinelle « retour arriere »           // sentinelle « retour arrière »
    var saisieActive = false;
    function setSaisie(v) {
      saisieActive = !!v;
      if (saisieActive) clearKeys();
      return saisieActive;
    }

    // ─── souris ──────────────────────────────────────────────────────────────
    var MAX_DELTA = 180;   // au-delà, c'est un artefact d'acquisition du verrou
    var SENS = 0.0022;

    document.addEventListener('mousemove', function (e) {
      if (saisieActive) return;
      if (!isLocked() || state !== 'playing') return;
      var dx = e.movementX || 0, dy = e.movementY || 0;
      // Certains navigateurs envoient un delta énorme à la prise du verrou :
      // l'appliquer ferait pivoter la vue d'un coup. On l'ignore.
      if (Math.abs(dx) > MAX_DELTA || Math.abs(dy) > MAX_DELTA) return;
      if (hooks.onLook) hooks.onLook(-dx * SENS, -dy * SENS);
    });

    canvas.addEventListener('mousedown', function (e) {
      if (saisieActive) { e.preventDefault(); return; }
      if (state === 'menu' || state === 'paused') { e.preventDefault(); return; }
      if (!isLocked()) return;
      e.preventDefault();
      if (e.button === 0) { mouse.left = true; if (hooks.onAttack) hooks.onAttack(); }
      else if (e.button === 2) { mouse.right = true; if (hooks.onUse) hooks.onUse(); }
      else if (e.button === 1 && hooks.onPick) hooks.onPick();
    });
    window.addEventListener('mouseup', function (e) {
      if (e.button === 0) mouse.left = false;
      if (e.button === 2) mouse.right = false;
    });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    window.addEventListener('wheel', function (e) {
      if (state !== 'playing' || !isLocked()) return;
      if (hooks.onScroll) hooks.onScroll(e.deltaY > 0 ? 1 : -1);
    }, { passive: true });

    // ─── clavier ─────────────────────────────────────────────────────────────
    var lastSpace = 0;

    window.addEventListener('keydown', function (e) {
      // la saisie texte capte tout, sauf Entrée et Échap qui la terminent
      if (saisieActive) {
        if (e.code === 'Enter' || e.code === 'NumpadEnter') {
          e.preventDefault();
          if (hooks.onSaisieValider) hooks.onSaisieValider();
        } else if (e.code === 'Escape') {
          e.preventDefault();
          if (hooks.onSaisieAnnuler) hooks.onSaisieAnnuler();
        } else if (e.code === 'Backspace') {
          e.preventDefault();
          if (hooks.onSaisieTouche) hooks.onSaisieTouche('');
        } else if (e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          if (hooks.onSaisieTouche) hooks.onSaisieTouche(e.key);
        }
        return;
      }

      // Échap : le navigateur relâche déjà le verrou ; on décide de la suite.
      if (e.code === 'Escape') {
        if (hooks.onEscape) hooks.onEscape();
        return;
      }
      if (state !== 'playing') {
        // quelques raccourcis restent actifs hors jeu (fermer l'inventaire)
        if (hooks.onKeyAnyState) hooks.onKeyAnyState(e.code);
        return;
      }

      var a = CODE_TO_ACTION[e.code];
      if (a) {
        if (a === 'jump') {
          // double appui sur Espace = bascule vol, comme dans le jeu d'origine
          if (!keys.jump) {
            var now = performance.now();
            if (now - lastSpace < 280 && hooks.onToggleFly) hooks.onToggleFly();
            lastSpace = now;
          }
          e.preventDefault();
        }
        keys[a] = true;
        return;
      }
      if (e.code >= 'Digit1' && e.code <= 'Digit9') {
        if (hooks.onSelectSlot) hooks.onSelectSlot(+e.code.slice(5) - 1);
        return;
      }
      if (hooks.onKey) hooks.onKey(e.code, e);
    });

    window.addEventListener('keyup', function (e) {
      if (saisieActive) return;
      var a = CODE_TO_ACTION[e.code];
      if (a) keys[a] = false;
    });

    // ─── perte de focus ──────────────────────────────────────────────────────
    // Sans ça, alt-tab laisse une touche « collée » et le joueur part tout seul.
    window.addEventListener('blur', function () {
      clearKeys();
      if (state === 'playing') setState('paused');
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { clearKeys(); if (state === 'playing') setState('paused'); }
    });

    return {
      get state() { return state; },
      setState: setState, isLocked: isLocked, actions: actions, keys: keys,
      setSaisie: setSaisie, EFFACE: EFFACE,
      get saisieActive() { return saisieActive; },
      mouse: mouse, clearKeys: clearKeys, requestLock: requestLock, exitLock: exitLock,
      get lockError() { return lockError; },
      BINDINGS: BINDINGS, SENS: SENS, MAX_DELTA: MAX_DELTA,
    };
  }

  MC.createInput = createInput;
  MC.LOCKED_STATES = LOCKED_STATES;
})(typeof globalThis !== 'undefined' ? globalThis : this);
