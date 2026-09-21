/* gamepad.js — lecture d'une manette, convertie en actions de jeu.
   La source (`navigator.getGamepads`) est INJECTÉE : le module reste pur et
   se teste sous Node en fournissant de faux relevés, ce qui est le seul moyen
   raisonnable de tester des manettes. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  /* Disposition standard (« standard gamepad ») :
     axes 0/1 = stick gauche, axes 2/3 = stick droit.
     boutons : 0 A · 1 B · 2 X · 3 Y · 4 LB · 5 RB · 6 LT · 7 RT
               8 Select · 9 Start · 10 L3 · 11 R3 · 12-15 croix directionnelle */
  var BTN = {
    SAUT: 0, INVENTAIRE: 3, PRECEDENT: 4, SUIVANT: 5,
    CASSER: 6, UTILISER: 7, PAUSE: 9, COURSE: 10, VOL: 11,
  };

  var ZONE_MORTE = 0.22;      // sous ce seuil, on considère le stick au repos
  var SENS_REGARD = 2.6;      // radians par seconde à fond

  /* Zone morte radiale plutôt que par axe : une zone morte par axe rend les
     diagonales impossibles à atteindre en douceur. */
  function applique(v) {
    var a = Math.abs(v);
    if (a < ZONE_MORTE) return 0;
    // on re-étale [seuil, 1] sur [0, 1] pour ne pas perdre de course utile
    return Math.sign(v) * ((a - ZONE_MORTE) / (1 - ZONE_MORTE));
  }

  function creerManette(index, getGamepads, opts) {
    opts = opts || {};
    var sens = opts.sensibilite === undefined ? SENS_REGARD : opts.sensibilite;
    var inverseY = !!opts.inverseY;
    var precedents = {};

    function pad() {
      if (typeof getGamepads !== 'function') return null;
      var l;
      try { l = getGamepads(); } catch (e) { return null; }
      if (!l) return null;
      var p = l[index];
      if (!p || p.connected === false) return null;
      return p;
    }

    function connectee() { return !!pad(); }

    function axe(p, i) {
      if (!p || !p.axes || p.axes.length <= i) return 0;
      return applique(p.axes[i] || 0);
    }

    function presse(p, i) {
      if (!p || !p.buttons || !p.buttons[i]) return false;
      var b = p.buttons[i];
      return typeof b === 'object' ? !!b.pressed : b > 0.5;
    }

    /* Actions de déplacement. L'axe Y d'un stick est négatif vers le haut :
       pousser en avant donne -1, d'où l'inversion. */
    function actions() {
      var p = pad();
      if (!p) return { forward: false, back: false, left: false, right: false,
                       jump: false, sprint: false };
      var x = axe(p, 0), y = axe(p, 1);
      return {
        forward: y < 0, back: y > 0,
        left: x < 0, right: x > 0,
        jump: presse(p, BTN.SAUT),
        sprint: presse(p, BTN.COURSE),
      };
    }

    /* Amplitude analogique du déplacement, pour marcher doucement.
       Renvoie 0 à 1 ; le jeu peut l'ignorer et se contenter des booléens. */
    function amplitude() {
      var p = pad();
      if (!p) return 0;
      return Math.min(1, Math.hypot(axe(p, 0), axe(p, 1)));
    }

    /* Rotation de la vue. Convention alignée sur la souris : pousser le stick
       à droite fait décroître le yaw, donc tourner à droite. */
    function regard(dt) {
      var p = pad();
      if (!p) return { dyaw: 0, dpitch: 0 };
      var rx = axe(p, 2), ry = axe(p, 3);
      return {
        dyaw: -rx * sens * dt,
        dpitch: (inverseY ? ry : -ry) * sens * dt,
      };
    }

    function boutons() {
      var p = pad();
      return {
        casser: presse(p, BTN.CASSER),
        utiliser: presse(p, BTN.UTILISER),
        inventaire: presse(p, BTN.INVENTAIRE),
        pause: presse(p, BTN.PAUSE),
        vol: presse(p, BTN.VOL),
        precedent: presse(p, BTN.PRECEDENT),
        suivant: presse(p, BTN.SUIVANT),
      };
    }

    /* Front montant : vrai une seule fois par appui. Sans cela, ouvrir
       l'inventaire à la manette le ferait clignoter 60 fois par seconde. */
    function vientDAppuyer(i) {
      var p = pad();
      var maintenant = presse(p, i);
      var avant = !!precedents[i];
      precedents[i] = maintenant;
      return maintenant && !avant;
    }

    return {
      index: index, connectee: connectee, actions: actions, amplitude: amplitude,
      regard: regard, boutons: boutons, vientDAppuyer: vientDAppuyer, BTN: BTN,
    };
  }

  MC.creerManette = creerManette;
  MC.GamepadConst = { BTN: BTN, ZONE_MORTE: ZONE_MORTE, SENS_REGARD: SENS_REGARD };
})(typeof globalThis !== 'undefined' ? globalThis : this);
