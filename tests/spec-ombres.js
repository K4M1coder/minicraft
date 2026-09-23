/* spec-ombres.js — tests des specs SPEC-OMBRE-001 et SPEC-OMBRE-002.
   Cascades d'ombres nettes suivant la caméra et l'astre, et ombrage du
   relief lointain selon la hauteur du soleil. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var O = MC.Ombres;

  function norme(v) {
    var n = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / n, y: v.y / n, z: v.z / n };
  }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

  var midi = norme({ x: 0.2, y: 0.95, z: 0.1 });       // soleil haut
  var couchant = norme({ x: 0.9, y: 0.12, z: 0.1 });   // soleil bas, presque à l'horizon
  var nuit = norme({ x: 0.1, y: -0.8, z: 0.2 });       // soleil sous l'horizon

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — ombres', function () {
    it('SPEC-OMBRE-001 : cascades forment une base orthonormée orientée par l\'astre', function () {
      var cs = O.cascades({ x: 0, y: 30, z: 0 }, midi, { tailles: [48, 160], resolution: 2048, recul: 200 });
      A.ok(cs && cs.length === 2, 'deux cascades');
      cs.forEach(function (c) {
        A.ok(Math.abs(dot(c.droite, midi)) < 1e-6, 'droite perpendiculaire à l\'astre');
        A.ok(Math.abs(dot(c.haut, midi)) < 1e-6, 'haut perpendiculaire à l\'astre');
        A.ok(Math.abs(dot(c.droite, c.haut)) < 1e-6, 'droite perpendiculaire à haut');
        A.ok(Math.abs(Math.hypot(c.droite.x, c.droite.y, c.droite.z) - 1) < 1e-6, 'droite unitaire');
        A.ok(Math.abs(Math.hypot(c.haut.x, c.haut.y, c.haut.z) - 1) < 1e-6, 'haut unitaire');
      });
    });

    it('SPEC-OMBRE-001 : chaque cascade porte taille, texel et position = centre + astre*recul', function () {
      var cs = O.cascades({ x: 5, y: 30, z: -12 }, midi, { tailles: [48, 160], resolution: 2048, recul: 200 });
      cs.forEach(function (c, k) {
        A.equal(c.taille, [48, 160][k], 'taille conservée');
        A.equal(c.texel, c.taille / 2048, 'texel = taille / résolution');
        A.ok(Math.abs(c.position.x - (c.centre.x + midi.x * 200)) < 1e-9, 'position.x');
        A.ok(Math.abs(c.position.y - (c.centre.y + midi.y * 200)) < 1e-9, 'position.y');
        A.ok(Math.abs(c.position.z - (c.centre.z + midi.z * 200)) < 1e-9, 'position.z');
      });
    });

    it('SPEC-OMBRE-001 : le centre est calé sur la grille des texels, sans scintillement à petit déplacement', function () {
      var opts = { tailles: [48], resolution: 2048, recul: 200 };
      var base = O.cascades({ x: 0, y: 30, z: 0 }, midi, opts)[0];
      var texel = base.texel;

      // un déplacement de 0.2 texel le long de la base (droite, haut), bien en
      // deçà du demi-texel qui ferait basculer l'arrondi, laisse le centre inchangé
      var camProche = {
        x: 0.2 * texel * base.droite.x + 0.2 * texel * base.haut.x,
        y: 30 + 0.2 * texel * base.droite.y + 0.2 * texel * base.haut.y,
        z: 0.2 * texel * base.droite.z + 0.2 * texel * base.haut.z,
      };
      var cProche = O.cascades(camProche, midi, opts)[0];
      A.deep(base.centre, cProche.centre, 'un déplacement bien plus petit qu\'un demi-texel ne change pas le centre');

      // un déplacement d'exactement un texel le long de "droite" décale le centre d'un texel
      var camDecalee = { x: texel * base.droite.x, y: 30 + texel * base.droite.y, z: texel * base.droite.z };
      var c3 = O.cascades(camDecalee, midi, opts)[0];
      var delta = Math.hypot(c3.centre.x - base.centre.x, c3.centre.y - base.centre.y, c3.centre.z - base.centre.z);
      A.ok(Math.abs(delta - texel) < 1e-6, 'décalage d\'un texel entier : ' + delta + ' vs ' + texel);
    });

    it('SPEC-OMBRE-001 : sous l\'horizon (astre.y < 0.05), pas de cascades', function () {
      A.equal(O.cascades({ x: 0, y: 30, z: 0 }, nuit, {}), null, 'astre sous l\'horizon → null');
      A.equal(O.cascades({ x: 0, y: 30, z: 0 }, { x: 0, y: 0.04, z: 1 }, {}), null, 'astre au ras de l\'horizon → null');
      A.ok(O.cascades({ x: 0, y: 30, z: 0 }, { x: 0, y: 0.06, z: 1 }, {}), 'astre tout juste levé → cascades');
    });

    it('SPEC-OMBRE-001 : choisirAstre alterne soleil, lune et nuit noire', function () {
      var r1 = O.choisirAstre(midi, { x: 0, y: -1, z: 0 });
      A.ok(r1 && !r1.lune && r1.intensite === 1 && r1.dir === midi, 'jour : le soleil, pleine intensité');

      var luneHaute = norme({ x: -0.3, y: 0.8, z: 0.1 });
      var r2 = O.choisirAstre(nuit, luneHaute);
      A.ok(r2 && r2.lune && r2.dir === luneHaute && r2.intensite < 1 && r2.intensite > 0,
           'nuit : la lune, intensité réduite');

      var r3 = O.choisirAstre(nuit, { x: 0, y: -0.5, z: 0 });
      A.equal(r3, null, 'ni soleil ni lune levés : aucun astre');

      // aube : soleil tout juste au seuil
      var r4 = O.choisirAstre({ x: 0, y: 0.05, z: 1 }, luneHaute);
      A.ok(r4 && !r4.lune, 'aube : le soleil prend le pas dès qu\'il atteint le seuil');
    });

    // ── ombrage du relief lointain ──────────────────────────────────────────
    function grillePlate(cote, pas, h) {
      var n = cote * cote;
      var sol = new Float32Array(n).fill(h);
      var eau = new Float32Array(n);
      return { cote: cote, pas: pas, sol: sol, eau: eau };
    }

    function grilleAvecMur(cote, pas, base, murX, hauteurMur) {
      var g = grillePlate(cote, pas, base);
      for (var gz = 0; gz < cote; gz++) {
        for (var dx = -1; dx <= 1; dx++) {
          var gx = murX + dx;
          if (gx >= 0 && gx < cote) g.sol[gz * cote + gx] = hauteurMur;
        }
      }
      return g;
    }

    it('SPEC-OMBRE-002 : terrain plat uniformément éclairé au zénith', function () {
      var g = grillePlate(64, 4, 40);
      var f = O.ombrerRelief(g, midi, {});
      for (var i = 0; i < f.length; i++) A.gt(f[i], 0.9, 'presque plein éclairage sur terrain plat');
    });

    it('SPEC-OMBRE-002 : nuit → tout à 1 (pas d\'ombrage directionnel)', function () {
      var g = grilleAvecMur(64, 4, 20, 32, 60);
      var f = O.ombrerRelief(g, nuit, {});
      for (var i = 0; i < f.length; i++) A.equal(f[i], 1, 'nuit : facteur 1 partout');
    });

    it('SPEC-OMBRE-002 : un mur projette une ombre plus longue au couchant qu\'à midi', function () {
      var cote = 96, pas = 4, base = 20, murX = 48, hauteurMur = 60;
      var g = grilleAvecMur(cote, pas, base, murX, hauteurMur);

      function longueurOmbre(astre) {
        var f = O.ombrerRelief(g, astre, { pas: 24, plancher: 0.55 });
        // direction horizontale de l'astre en x ; on regarde du côté opposé au soleil
        var sens = astre.x >= 0 ? 1 : -1;
        var gz = Math.floor(cote / 2);
        var n = 0;
        for (var k = 1; k < 20; k++) {
          var gx = murX - sens * k;
          if (gx < 0 || gx >= cote) break;
          if (f[gz * cote + gx] <= 0.55 + 1e-6) n++; else break;
        }
        return n;
      }

      var lMidi = longueurOmbre(midi);
      var lCouchant = longueurOmbre(couchant);
      A.gt(lCouchant, lMidi, 'ombre plus longue au couchant (' + lCouchant + ') qu\'à midi (' + lMidi + ')');
    });

    it('SPEC-OMBRE-002 : les facteurs restent dans [plancher, 1]', function () {
      var g = grilleAvecMur(48, 4, 20, 24, 55);
      var plancher = 0.4;
      var f = O.ombrerRelief(g, couchant, { plancher: plancher });
      for (var i = 0; i < f.length; i++) {
        A.ok(f[i] >= plancher - 1e-6 && f[i] <= 1 + 1e-6, 'facteur dans [plancher, 1] : ' + f[i]);
      }
    });

    it('SPEC-OMBRE-002 : reste rapide, 256×256 échantillons en moins de 150 ms', function () {
      var g = grilleAvecMur(256, 4, 30, 128, 70);
      var t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      O.ombrerRelief(g, couchant, {});
      var t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      A.lt(t1 - t0, 150, '256² en ' + (t1 - t0).toFixed(1) + ' ms');
    });

    // ── ombre décalée (utilisée par les nuages) ─────────────────────────────
    it('SPEC-OMBRE-002 : ombreDecalee, soleil au zénith → même point', function () {
      var zenith = { x: 0, y: 1, z: 0 };
      var p = O.ombreDecalee(10, -5, 80, 20, zenith);
      A.ok(Math.abs(p.x - 10) < 1e-9 && Math.abs(p.z - (-5)) < 1e-9, 'zénith : ombre directement sous la source');
    });

    it('SPEC-OMBRE-002 : ombreDecalee, soleil oblique → décalage opposé à l\'astre', function () {
      var astre = norme({ x: 0.6, y: 0.5, z: 0.2 });
      var hSource = 100, hSol = 20;
      var p = O.ombreDecalee(0, 0, hSource, hSol, astre);
      var horizontal = Math.hypot(astre.x, astre.z);
      var distanteAttendue = (hSource - hSol) * horizontal / astre.y;
      var dx = -astre.x / horizontal, dz = -astre.z / horizontal; // direction opposée à l'astre (horizontale)
      A.ok(Math.abs(p.x - dx * distanteAttendue) < 1e-6, 'décalage x attendu');
      A.ok(Math.abs(p.z - dz * distanteAttendue) < 1e-6, 'décalage z attendu');
      var distanceReelle = Math.hypot(p.x, p.z);
      A.ok(Math.abs(distanceReelle - distanteAttendue) < 1e-6, 'distance de décalage : ' + distanceReelle);
    });

    it('SPEC-OMBRE-002 : ombreDecalee, astre sous l\'horizon → null', function () {
      A.equal(O.ombreDecalee(0, 0, 80, 20, { x: 0, y: -0.1, z: 0 }), null, 'astre couché : pas d\'ombre');
      A.equal(O.ombreDecalee(0, 0, 80, 20, { x: 1, y: 0, z: 0 }), null, 'astre à ras l\'horizon (y=0) : pas d\'ombre');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
