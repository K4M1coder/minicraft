/* eau.js — l'eau : ce qu'elle est, comment elle ondule, comment elle coule.
   Logique pure.

   - six natures d'eau : écoulement, chute, rivière, lac, mer, océan ;
   - chacune ondule à sa façon (amplitude, longueur d'onde, vitesse, écume) ;
   - le sens des ondes mêle le courant et le vent, dans une proportion propre
     à chaque nature : une chute ne suit que la pente, un lac surtout le vent ;
   - l'écoulement : l'eau descend, s'étale sur sept blocs en s'amenuisant, et
     se retire quand plus rien ne la nourrit. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var B = C.B;

  /* Code des natures (il voyage dans les sommets du maillage : 0 = pas d'eau). */
  var TYPES = { lac: 1, mer: 2, ocean: 3, riviere: 4, ecoulement: 5, chute: 6 };
  var NOMS = ['', 'lac', 'mer', 'ocean', 'riviere', 'ecoulement', 'chute'];

  /* amplitude (blocs), longueur d'onde (blocs), vitesse (blocs/s), écume (0-1),
     courant : part du courant dans le sens des ondes (le reste vient du vent). */
  var PARAMS = {
    lac:        { amplitude: 0.03, longueur: 3.0,  vitesse: 0.6, ecume: 0.00, courant: 0.1 },
    mer:        { amplitude: 0.07, longueur: 7.0,  vitesse: 1.4, ecume: 0.15, courant: 0.2 },
    ocean:      { amplitude: 0.14, longueur: 16.0, vitesse: 2.4, ecume: 0.25, courant: 0.15 },
    riviere:    { amplitude: 0.04, longueur: 2.0,  vitesse: 2.2, ecume: 0.20, courant: 0.75 },
    ecoulement: { amplitude: 0.02, longueur: 1.2,  vitesse: 3.0, ecume: 0.35, courant: 0.9 },
    chute:      { amplitude: 0.00, longueur: 1.0,  vitesse: 6.0, ecume: 0.80, courant: 1.0 },
  };

  /* Sens des ondes : courant et vent mêlés selon la nature. Renvoie un vecteur
     horizontal unitaire (ou nul s'il n'y a ni courant ni vent). */
  function directionOnde(type, flux, vent) {
    var p = PARAMS[type] || PARAMS.lac;
    var fx = flux ? flux.x : 0, fz = flux ? flux.z : 0;
    var nf = Math.hypot(fx, fz);
    if (nf > 0) { fx /= nf; fz /= nf; }
    var vx = vent ? vent.x : 0, vz = vent ? vent.z : 0;
    var nv = Math.hypot(vx, vz);
    if (nv > 0) { vx /= nv; vz /= nv; }
    var k = nf > 0 ? p.courant : 0;
    var x = fx * k + vx * (1 - k), z = fz * k + vz * (1 - k);
    var n = Math.hypot(x, z);
    return n > 1e-6 ? { x: x / n, z: z / n } : { x: 0, z: 0 };
  }

  /* ─── eau courante ────────────────────────────────────────────────────────
     Sept niveaux (EAU_1 le plus mince … EAU_7 au ras de la source). */
  var NIVEAUX = [0, B.EAU_1, B.EAU_2, B.EAU_3, B.EAU_4, B.EAU_5, B.EAU_6, B.EAU_7];
  function niveauDe(id) {
    if (id === B.WATER) return 8;                    // une source vaut plus que tout écoulement
    var i = NIVEAUX.indexOf(id);
    return i > 0 ? i : 0;
  }
  function blocDeNiveau(n) { return n >= 8 ? B.WATER : (n > 0 ? NIVEAUX[n] : 0); }
  function estCourante(id) { return niveauDe(id) > 0 && id !== B.WATER; }
  // une case où l'eau peut s'étendre : air, ou plante non aquatique
  function libre(id) {
    if (id === 0) return true;
    var d = C.BLOCKS[id];
    return !!d && d.plant && !d.aquatique && !d.liquid;
  }

  /* Une eau repose-t-elle sur quelque chose ? Au-dessus d'un vide ou d'une
     eau qui tombe, elle ne s'étale pas : elle nourrit ce qui est en dessous.
     Une source s'étale toujours. */
  function posee(lire, x, y, z) {
    var d = lire(x, y - 1, z);
    return !(libre(d) || estCourante(d));
  }

  /* Le niveau que devrait porter la case (x, y, z), d'après ce qui l'entoure :
     de l'eau au-dessus la remplit (7) ; sinon la plus haute voisine posée,
     moins un. Une source reste une source. */
  function niveauVoulu(lire, x, y, z) {
    if (lire(x, y, z) === B.WATER) return 8;
    if (niveauDe(lire(x, y + 1, z)) > 0) return 7;
    var m = 0;
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      var nx = x + d[0], nz = z + d[1], n = niveauDe(lire(nx, y, nz));
      if (n <= 1) return;
      if (n < 8 && !posee(lire, nx, y, nz)) return;
      m = Math.max(m, Math.min(7, n - 1));
    });
    return m;
  }

  /* Un pas d'écoulement autour de (x, y, z) : la liste des changements
     [x, y, z, id] à appliquer. `lire(x, y, z)` lit le monde. */
  function ecouler(lire, x, y, z) {
    var out = [], id = lire(x, y, z), n = niveauDe(id);
    if (n === 0) {
      // une case libre au bord d'une eau : celle-ci l'envahit-elle ?
      if (!libre(id)) return out;
      var v = niveauVoulu(lire, x, y, z);
      if (v > 0) out.push([x, y, z, blocDeNiveau(v)]);
      return out;
    }
    if (id !== B.WATER) {
      // eau courante : elle se maintient, baisse ou disparaît selon ce qui la nourrit
      var voulu = niveauVoulu(lire, x, y, z);
      if (voulu !== n) {
        out.push([x, y, z, blocDeNiveau(voulu)]);
        if (voulu === 0) return out;
        n = voulu;
      }
    }
    // elle descend d'abord…
    var dessous = lire(x, y - 1, z);
    if (y > 1 && (libre(dessous) || (estCourante(dessous) && niveauDe(dessous) < 7))) {
      out.push([x, y - 1, z, blocDeNiveau(7)]);
      if (id !== B.WATER) return out;
    }
    // … puis s'étale, un niveau de moins par bloc, si elle repose sur quelque chose
    if (n > 1 && (id === B.WATER || posee(lire, x, y, z))) {
      var cible = Math.min(7, n - 1);
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        var nx = x + d[0], nz = z + d[1], vi = lire(nx, y, nz);
        if (libre(vi) || (estCourante(vi) && niveauDe(vi) < cible)) out.push([nx, y, nz, blocDeNiveau(cible)]);
      });
    }
    return out;
  }

  /* Sens d'écoulement d'une eau courante : vers la voisine de niveau plus bas
     (ou vers le vide), en moyenne. */
  function fluxCourant(lire, x, y, z) {
    var n = niveauDe(lire(x, y, z)), fx = 0, fz = 0;
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      var vi = lire(x + d[0], y, z + d[1]);
      var m = niveauDe(vi);
      if (libre(vi)) m = -1;
      if (m >= 0 && m >= n) return;
      var poids = n - m;
      fx += d[0] * poids; fz += d[1] * poids;
    });
    var k = Math.hypot(fx, fz);
    return k > 0 ? { x: fx / k, z: fz / k } : { x: 0, z: 0 };
  }

  /* Nature d'une eau générée, d'après la colonne du terrain (Biomes.colonne /
     echantillon) : rivière, lac, mer peu profonde ou océan. */
  var PROFONDEUR_OCEAN = 10;
  function natureColonne(col) {
    if (!col || !(col.eau > col.h)) return 0;
    var c = col.climat || {};
    if (c.riviere) return TYPES.riviere;
    if (c.lac) return TYPES.lac;
    return col.eau - col.h >= PROFONDEUR_OCEAN ? TYPES.ocean : TYPES.mer;
  }

  /* SPEC-SAISON-005 : une eau dormante — celle qui gèle en surface l'hiver,
     dans le froid. `nature` : la nature générée de la colonne (TYPES) ;
     (x, y, z) : sa case d'eau de surface ; `lire(x, y, z)` lit le monde.
     - un lac l'est toujours ;
     - une « mer » perchée au-dessus du niveau de la mer aussi : c'est le lac
       du cratère d'un volcan éteint (natureColonne ne la distingue pas) ;
     - une rivière seulement là où elle est calme : à moins de RAYON_CALME
       blocs, ni eau courante (un rapide), ni surface d'eau plus haute ou plus
       basse que la sienne (une cascade : le lit décroche par paliers de trois
       blocs, SPEC-EAU-004) ;
     - la mer, l'océan, l'écoulement et la chute jamais (la banquise des mers
       froides est générée, elle ne dépend pas de la saison). */
  var RAYON_CALME = 2;
  function surfaceGelable(id) { return id === B.WATER || id === B.ICE; }
  function eauDormante(nature, lire, x, y, z) {
    if (nature === TYPES.lac) return true;
    if (nature === TYPES.mer || nature === TYPES.ocean) return y > C.SEA_LEVEL;
    if (nature !== TYPES.riviere) return false;
    for (var dx = -RAYON_CALME; dx <= RAYON_CALME; dx++) for (var dz = -RAYON_CALME; dz <= RAYON_CALME; dz++) {
      if (!dx && !dz) continue;
      var a = lire(x + dx, y, z + dz), dessus = lire(x + dx, y + 1, z + dz);
      if (estCourante(a) || estCourante(dessus)) return false;          // un rapide, un filet qui tombe
      if (surfaceGelable(dessus)) return false;                         // l'eau monte d'un palier : cascade en amont
      if (a === 0 || libre(a)) {
        // l'eau descend d'un palier : cascade en aval (on regarde quatre blocs plus bas)
        for (var k = 1; k <= 4; k++) {
          var b = lire(x + dx, y - k, z + dz);
          if (surfaceGelable(b) || estCourante(b)) return false;
          if (b !== 0 && !libre(b)) break;
        }
      }
    }
    return true;
  }

  MC.Eau = { TYPES: TYPES, NOMS: NOMS, PARAMS: PARAMS, NIVEAUX: NIVEAUX, PROFONDEUR_OCEAN: PROFONDEUR_OCEAN,
             directionOnde: directionOnde, niveauDe: niveauDe, blocDeNiveau: blocDeNiveau, estCourante: estCourante,
             ecouler: ecouler, fluxCourant: fluxCourant, natureColonne: natureColonne,
             RAYON_CALME: RAYON_CALME, eauDormante: eauDormante };
})(typeof globalThis !== 'undefined' ? globalThis : this);
