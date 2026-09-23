/* ombres.js — logique pure des ombres portées par le soleil ou la lune.

   Deux besoins distincts, deux échelles :
   - à courte distance, des cascades d'ombres nettes (shadow mapping Three.js)
     qui suivent la caméra et s'orientent selon l'astre du moment ;
   - au loin, où mailler des cascades coûterait trop cher, un ombrage du
     relief calculé une fois par échantillon de grille (marche d'horizon +
     versant), qui redonne du volume aux montagnes sans ombre portée nette.
   Ce module ne calcule que les nombres ; l'intégration Three.js (shadow
   cameras, uniforms) vit ailleurs. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var SEUIL_HORIZON = 0.05;    // en dessous, l'astre est trop bas pour porter une ombre nette

  /* Base orthonormée (droite, haut) perpendiculaire à `astre`, droite restant
     horizontale quand c'est possible (astre non vertical). Cas dégénéré
     (astre ~vertical) : on retombe sur l'axe monde X pour rester stable. */
  function baseOrthonormee(astre) {
    var haut = { x: 0, y: 1, z: 0 };
    // droite = haut × astre, horizontale si astre n'est pas vertical
    var dx = haut.y * astre.z - haut.z * astre.y;
    var dy = haut.z * astre.x - haut.x * astre.z;
    var dz = haut.x * astre.y - haut.y * astre.x;
    var n = Math.hypot(dx, dy, dz);
    var droite;
    if (n < 1e-6) {
      droite = { x: 1, y: 0, z: 0 };
    } else {
      droite = { x: dx / n, y: dy / n, z: dz / n };
    }
    // haut réel = astre × droite, pour une base bien orthonormée
    var hx = astre.y * droite.z - astre.z * droite.y;
    var hy = astre.z * droite.x - astre.x * droite.z;
    var hz = astre.x * droite.y - astre.y * droite.x;
    var hn = Math.hypot(hx, hy, hz) || 1;
    haut = { x: hx / hn, y: hy / hn, z: hz / hn };
    return { droite: droite, haut: haut };
  }

  /* Cascades d'ombres nettes autour de la caméra : plusieurs carrés emboîtés,
     calés sur la grille de texels pour ne pas scintiller quand la caméra
     bouge d'un pas plus petit qu'un texel. */
  function cascades(cam, astre, opts) {
    if (!astre || astre.y < SEUIL_HORIZON) return null;
    opts = opts || {};
    var tailles = opts.tailles || [48, 160];
    var resolution = opts.resolution || 2048;
    var recul = opts.recul != null ? opts.recul : 200;
    var base = baseOrthonormee(astre);
    var droite = base.droite, haut = base.haut;

    return tailles.map(function (taille) {
      var texel = taille / resolution;
      // projection de la caméra dans la base (droite, haut), calage au texel
      var pd = cam.x * droite.x + cam.y * droite.y + cam.z * droite.z;
      var ph = cam.x * haut.x + cam.y * haut.y + cam.z * haut.z;
      var cd = Math.round(pd / texel) * texel;
      var ch = Math.round(ph / texel) * texel;
      // reconstruction du centre calé à partir de la profondeur de cam sur l'axe astre
      var pa = cam.x * astre.x + cam.y * astre.y + cam.z * astre.z;
      var centre = {
        x: droite.x * cd + haut.x * ch + astre.x * pa,
        y: droite.y * cd + haut.y * ch + astre.y * pa,
        z: droite.z * cd + haut.z * ch + astre.z * pa,
      };
      var position = {
        x: centre.x + astre.x * recul,
        y: centre.y + astre.y * recul,
        z: centre.z + astre.z * recul,
      };
      return { taille: taille, texel: texel, centre: centre, position: position, droite: droite, haut: haut };
    });
  }

  /* Choisit l'astre qui éclaire : le soleil s'il est assez haut, sinon la
     lune (intensité réduite), sinon aucun (crépuscule profond / nouvelle lune
     sous l'horizon). */
  function choisirAstre(soleil, lune) {
    if (soleil && soleil.y >= SEUIL_HORIZON) {
      return { dir: soleil, intensite: 1, lune: false };
    }
    if (lune && lune.y >= SEUIL_HORIZON) {
      return { dir: lune, intensite: 0.25, lune: true };
    }
    return null;
  }

  /* Ombrage du relief lointain : marche d'horizon vers l'astre (ombre portée
     approchée, sans cascade) + ombrage de versant (produit scalaire avec la
     normale approchée). Combine les deux effets multiplicativement.

     Boucle chaude : on pré-calcule la surface (max sol/eau) une fois dans un
     tableau à part et on indexe directement dedans, sans passer par des
     fonctions ni recalculer max() à chaque pas de la marche d'horizon —
     c'est ce qui tient 256×256 échantillons sous 150 ms. */
  function ombrerRelief(grille, astre, opts) {
    opts = opts || {};
    var cote = grille.cote, pas = grille.pas;
    var n = cote * cote;
    var facteurs = new Float32Array(n);

    if (!astre || astre.y < SEUIL_HORIZON) {
      facteurs.fill(1);
      return facteurs;
    }

    var plancher = opts.plancher != null ? opts.plancher : 0.55;
    var maxPas = opts.pas != null ? opts.pas : 24;

    // surface pré-calculée (max sol/eau), lue directement dans la boucle chaude
    var surf = new Float32Array(n);
    var sol = grille.sol, eau = grille.eau;
    for (var k = 0; k < n; k++) surf[k] = sol[k] > eau[k] ? sol[k] : eau[k];

    // direction horizontale normalisée vers l'astre
    var hx = astre.x, hz = astre.z;
    var hn = Math.hypot(hx, hz);
    if (hn < 1e-6) { hx = 1; hz = 0; } else { hx /= hn; hz /= hn; }
    var tanElevation = astre.y / (hn || 1e-6);
    var ax = astre.x, ay = astre.y, az = astre.z;
    var facteurEch = 1 - plancher;

    // la direction de marche est la même pour tout l'échantillonnage : les
    // décalages entiers et les seuils de hauteur par pas se précalculent une
    // seule fois plutôt que de rappeler Math.round à chaque échantillon
    var odx = new Int32Array(maxPas + 1), odz = new Int32Array(maxPas + 1);
    var seuil = new Float32Array(maxPas + 1);
    for (var d = 1; d <= maxPas; d++) {
      odx[d] = Math.round(hx * d);
      odz[d] = Math.round(hz * d);
      seuil[d] = d * pas * tanElevation;
    }

    for (var gz = 0; gz < cote; gz++) {
      var ligne = gz * cote;
      for (var gx = 0; gx < cote; gx++) {
        var i = ligne + gx;
        var h = surf[i];

        // marche d'horizon : ombre si un point plus loin dans la direction de
        // l'astre dépasse la ligne de visée vers l'astre
        var ombre = false;
        for (var dd = 1; dd <= maxPas; dd++) {
          var ix = gx + odx[dd], iz = gz + odz[dd];
          if (ix < 0 || iz < 0 || ix >= cote || iz >= cote) break;
          if (surf[iz * cote + ix] > h + seuil[dd]) { ombre = true; break; }
        }

        // ombrage de versant : normale approchée par différences finies
        var hx1 = gx + 1 < cote ? surf[ligne + gx + 1] : h;
        var hx0 = gx - 1 >= 0 ? surf[ligne + gx - 1] : h;
        var hz1 = gz + 1 < cote ? surf[ligne + cote + gx] : h;
        var hz0 = gz - 1 >= 0 ? surf[ligne - cote + gx] : h;
        var dhdx = (hx1 - hx0) / (2 * pas);
        var dhdz = (hz1 - hz0) / (2 * pas);
        // normale (-dhdx, 1, -dhdz) normalisée
        var nn = Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
        var eclairement = (-dhdx * ax + ay + -dhdz * az) / nn;
        if (eclairement < 0) eclairement = 0;

        var f = ombre ? 0 : eclairement;
        facteurs[i] = plancher + facteurEch * f;
      }
    }
    return facteurs;
  }

  /* Point du sol où tombe l'ombre d'un objet situé en (x, hauteurSource, z) :
     on descend le long de -astre jusqu'à hauteurSol. Utilisé pour les nuages. */
  function ombreDecalee(x, z, hauteurSource, hauteurSol, astre) {
    if (!astre || astre.y <= 0) return null;
    var dh = hauteurSource - hauteurSol;
    var t = dh / astre.y;         // paramètre le long de -astre pour descendre de dh
    return { x: x - astre.x * t, z: z - astre.z * t };
  }

  MC.Ombres = {
    cascades: cascades,
    choisirAstre: choisirAstre,
    ombrerRelief: ombrerRelief,
    ombreDecalee: ombreDecalee,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
