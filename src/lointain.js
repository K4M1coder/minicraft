/* lointain.js — le relief au-delà des chunks chargés. Logique pure.

   Une grille grossière (un échantillon tous les `pas` blocs) autour du
   joueur, tirée directement de la génération du terrain : hauteur du sol,
   niveau de l'eau, couleur vue du ciel. Elle sert à deux choses :
   - dessiner un relief simplifié jusqu'à l'horizon, bien au-delà des chunks
     maillés (on voit les montagnes à un kilomètre) ;
   - dire aux nuages où se dresse la roche, pour qu'ils ne la traversent pas.

   Échantillonner des dizaines de milliers de colonnes prendrait trop de temps
   en une image : la grille se remplit par petits lots (`avancer`) dans un
   tampon, et ne remplace la grille active qu'une fois complète. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  /* opts : { pas, cote (échantillons par côté), echantillon(x, z) → { h, eau, couleur } } */
  function creerGrille(opts) {
    var pas = opts.pas || 8, cote = opts.cote || 256;
    var fn = opts.echantillon;
    var n = cote * cote;
    var MAILLE = pas * 16;             // on ne recentre que par sauts de 16 échantillons

    function tampon() {
      return { x0: 0, z0: 0, sol: new Float32Array(n), eau: new Float32Array(n),
               couleurs: new Uint8Array(n * 3), rempli: 0 };
    }
    var actif = null, chantier = null, cible = null, version = 0;

    function recentrer(cx, cz) {
      var sx = Math.round(cx / MAILLE) * MAILLE, sz = Math.round(cz / MAILLE) * MAILLE;
      var x0 = sx - (cote / 2) * pas, z0 = sz - (cote / 2) * pas;
      if (cible && cible.x0 === x0 && cible.z0 === z0) return false;
      cible = { x0: x0, z0: z0 };
      chantier = tampon();
      chantier.x0 = x0; chantier.z0 = z0;
      return true;
    }

    // remplit au plus `budget` échantillons ; vrai quand une nouvelle grille est prête
    function avancer(budget) {
      if (!chantier) return false;
      var t = chantier, fin = Math.min(n, t.rempli + budget);
      for (var i = t.rempli; i < fin; i++) {
        var gx = i % cote, gz = (i / cote) | 0;
        var e = fn(t.x0 + gx * pas, t.z0 + gz * pas);
        t.sol[i] = e.h; t.eau[i] = e.eau || 0;
        var c = e.couleur || [120, 120, 120];
        t.couleurs[i * 3] = c[0]; t.couleurs[i * 3 + 1] = c[1]; t.couleurs[i * 3 + 2] = c[2];
      }
      t.rempli = fin;
      if (fin < n) return false;
      actif = t; chantier = null; version++;
      return true;
    }

    // hauteur du dessus (sol ou surface de l'eau), interpolée ; null hors grille
    function hauteur(x, z) {
      if (!actif) return null;
      var fx = (x - actif.x0) / pas, fz = (z - actif.z0) / pas;
      if (fx < 0 || fz < 0 || fx > cote - 1 || fz > cote - 1) return null;
      var ix = Math.min(cote - 2, Math.floor(fx)), iz = Math.min(cote - 2, Math.floor(fz));
      var tx = fx - ix, tz = fz - iz;
      function d(a, b) { var i = (iz + b) * cote + ix + a; return Math.max(actif.sol[i], actif.eau[i]); }
      return (d(0, 0) * (1 - tx) + d(1, 0) * tx) * (1 - tz) + (d(0, 1) * (1 - tx) + d(1, 1) * tx) * tz;
    }

    return {
      recentrer: recentrer, avancer: avancer, hauteur: hauteur,
      get pret() { return !!actif; },
      get version() { return version; },
      get enCours() { return chantier ? chantier.rempli / n : 1; },
      get actif() { return actif; },
      pas: pas, cote: cote,
    };
  }

  /* Maillage du relief lointain à partir de la grille active : un sommet par
     échantillon, abaissé de `abaisse` blocs pour rester sous le vrai terrain là
     où les deux se recouvrent. L'eau est posée à plat à son niveau. */
  var EAU = [52, 108, 196];
  function maillage(grille, abaisse) {
    var a = grille.actif;
    if (!a) return null;
    abaisse = abaisse === undefined ? 1.5 : abaisse;
    var cote = grille.cote, pas = grille.pas, n = cote * cote;
    var positions = new Float32Array(n * 3), colors = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      var gx = i % cote, gz = (i / cote) | 0;
      var immerge = a.eau[i] > a.sol[i];
      var y = (immerge ? a.eau[i] : a.sol[i]) - abaisse;
      positions[i * 3] = a.x0 + gx * pas; positions[i * 3 + 1] = y; positions[i * 3 + 2] = a.z0 + gz * pas;
      var c = immerge ? EAU : [a.couleurs[i * 3], a.couleurs[i * 3 + 1], a.couleurs[i * 3 + 2]];
      colors[i * 3] = c[0] / 255; colors[i * 3 + 1] = c[1] / 255; colors[i * 3 + 2] = c[2] / 255;
    }
    var indices = new Uint32Array((cote - 1) * (cote - 1) * 6), k = 0;
    for (var z = 0; z < cote - 1; z++) for (var x = 0; x < cote - 1; x++) {
      var p = z * cote + x;
      // sens trigonométrique vu d'en haut : la face regarde le ciel
      indices[k++] = p; indices[k++] = p + cote; indices[k++] = p + 1;
      indices[k++] = p + 1; indices[k++] = p + cote; indices[k++] = p + cote + 1;
    }
    return { positions: positions, colors: colors, indices: indices, x0: a.x0, z0: a.z0,
             etendue: (cote - 1) * pas };
  }

  /* Couleur d'une colonne vue de loin : le bloc de surface du biome, la neige
     et la roche des hauteurs, la lave des cratères, et la teinte du feuillage
     là où les arbres sont serrés. Ombrée selon l'altitude, comme la carte. */
  function couleurLointaine(col) {
    var C = MC.Core, B = C.B, bio = col.biome || {}, h = col.h;
    var COUL = MC.Carte ? MC.Carte.COULEURS : {};
    var id = bio.surface || B.GRASS;
    if (col.lave > 0) id = B.LAVA;
    else if (col.climat && col.climat.glacier) id = B.BLUE_ICE;
    else if (bio.neigeDes && h >= bio.neigeDes) id = B.SNOW;
    else if (bio.rocheDes && h >= bio.rocheDes) id = B.STONE;
    var c = (COUL[id] || [120, 120, 120]).slice();
    var arbres = 0;
    (bio.arbres || []).forEach(function (a) { arbres += a.p; });
    if (arbres > 0 && id === bio.surface) {
      var f = Math.min(0.75, arbres * 22), fe = COUL[B.LEAVES] || [58, 124, 48];
      for (var i = 0; i < 3; i++) c[i] = c[i] * (1 - f) + fe[i] * f;
    }
    var ombre = 0.78 + Math.max(-0.1, Math.min(0.32, (h - C.SEA_LEVEL) * 0.006));
    return c.map(function (v) { return Math.max(0, Math.min(255, Math.round(v * ombre))); });
  }

  /* Distance de vue adaptative, en chunks : on l'allonge tant que l'image
     reste fluide et que le chargement a rattrapé son retard ; on la raccourcit
     dès que la fluidité se dégrade. Deux seuils écartés évitent l'oscillation. */
  var VUE = { min: 4, max: 18, fluide: 56, lent: 42, retardMax: 6 };
  function ajusterDistance(r, fps, enAttente, bornes) {
    bornes = bornes || VUE;
    if (fps < bornes.lent && r > bornes.min) return r - 1;
    if (fps >= bornes.fluide && enAttente <= bornes.retardMax && r < bornes.max) return r + 1;
    return r;
  }

  MC.Lointain = { creerGrille: creerGrille, maillage: maillage, couleurLointaine: couleurLointaine,
                  ajusterDistance: ajusterDistance, VUE: VUE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
