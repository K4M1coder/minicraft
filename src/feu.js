/* feu.js — le feu : ce qui prend, comment il se propage, comment il s'éteint,
   et comment sa fumée dérive avec le vent. Logique pure (SPEC-CONSTR-007).

   Un bloc B.FEU occupe une case ; son état (world.getEtat/setEtat) porte son
   âge, en pas de simulation. À chaque pas (world.js:coulerFeu, cadencé comme
   l'eau) :
     - il s'éteint net s'il touche l'eau ou s'il pleut à ciel ouvert ;
     - sans rien à consumer autour ni dessous, il s'essouffle vite ;
     - nourri, il vieillit plus longtemps et a une chance, à chaque pas,
       d'embraser un voisin inflammable ;
     - une fois son âge limite atteint, il s'éteint (le bloc redevient l'air).
   `rand` est injecté (comme C.dropsOf) pour des tests déterministes. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var B = C.B;

  var VOISINS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

  // durée de vie (en pas) : nourrie, une flamme dure ; sans rien à bruler,
  // elle ne fait que passer (torche allumée sur de la pierre nue, par ex.)
  var AGE_MAX = 30;
  var AGE_SANS_COMBUSTIBLE = 3;
  var CHANCE_PROPAGATION = 0.12;
  var CHANCE_ALLUMAGE_LAVE = 0.2;

  function inflammable(id) { return C.isInflammable(id); }

  function aDuCombustibleAutour(lire, x, y, z) {
    for (var i = 0; i < 6; i++) {
      var v = VOISINS6[i];
      if (inflammable(lire(x + v[0], y + v[1], z + v[2]))) return true;
    }
    return false;
  }
  // un appui solide et non inflammable (pierre, terre…) fait durer un feu
  // même sans rien autour à consumer — un petit feu de camp posé au sol.
  function surAppuiSolide(lire, x, y, z) {
    var d = lire(x, y - 1, z);
    return C.isSolid(d) && !inflammable(d);
  }
  function presDeLave(lire, x, y, z) {
    for (var i = 0; i < 6; i++) {
      var v = VOISINS6[i];
      if (C.isLava(lire(x + v[0], y + v[1], z + v[2]))) return true;
    }
    return false;
  }
  // mouillé : de l'eau touche la case, ou il pleut à ciel ouvert au-dessus
  // (le second cas est fourni par l'appelant : lui seul connaît la météo).
  function estMouille(lire, x, y, z, pluie) {
    if (pluie) return true;
    for (var i = 0; i < 6; i++) {
      var v = VOISINS6[i];
      if (C.isWater(lire(x + v[0], y + v[1], z + v[2]))) return true;
    }
    return false;
  }

  /* Peut-on allumer un feu ici (case vide, avec de quoi le nourrir) ? Sert au
     briquet (player.js) et à la propagation. */
  function peutAllumer(lire, x, y, z) {
    if (lire(x, y, z) !== 0) return false;
    return aDuCombustibleAutour(lire, x, y, z) || surAppuiSolide(lire, x, y, z);
  }

  /* Un pas de simulation en (x, y, z), où l'on suppose un B.FEU (sinon []).
     `lire(x,y,z)` lit un bloc, `lireEtat(x,y,z)` son état (l'âge du feu).
     `rand` (injectée) pour les tirages de propagation. `pluie` : pleut-il
     ici, à ciel ouvert (fourni par l'appelant, cf. world.js:pluieIci).
     Renvoie une liste de changements [x, y, z, id, etat]. */
  function etapeFeu(lire, lireEtat, x, y, z, rand, pluie) {
    var out = [];
    if (lire(x, y, z) !== B.FEU) return out;
    var r = rand || Math.random;
    if (estMouille(lire, x, y, z, pluie)) { out.push([x, y, z, 0, 0]); return out; }

    var nourrie = aDuCombustibleAutour(lire, x, y, z);
    var appui = surAppuiSolide(lire, x, y, z);
    if (!nourrie && !appui) { out.push([x, y, z, 0, 0]); return out; }

    var age = (lireEtat(x, y, z) || 0) + 1;
    var limite = nourrie ? AGE_MAX : AGE_SANS_COMBUSTIBLE;
    if (age >= limite) { out.push([x, y, z, 0, 0]); return out; }

    out.push([x, y, z, B.FEU, age]);
    for (var i = 0; i < 6; i++) {
      var v = VOISINS6[i], nx = x + v[0], ny = y + v[1], nz = z + v[2];
      if (inflammable(lire(nx, ny, nz)) && r() < CHANCE_PROPAGATION) out.push([nx, ny, nz, B.FEU, 0]);
    }
    return out;
  }

  /* Allumage par la lave : un bloc inflammable adjacent à de la lave a, à
     chaque pas, une chance de prendre feu. `id` : le bloc lu à (x,y,z),
     laissé à l'appelant pour éviter une relecture. */
  function allumerParLave(lire, x, y, z, rand) {
    var r = rand || Math.random;
    if (!inflammable(lire(x, y, z))) return [];
    if (!presDeLave(lire, x, y, z)) return [];
    return r() < CHANCE_ALLUMAGE_LAVE ? [[x, y, z, B.FEU, 0]] : [];
  }

  /* Position d'une particule de fumée à l'âge `age` (secondes écoulées
     depuis son émission), dérivée par le vent local. `vent` : fonction de
     l'altitude -> {x, z} (MC.Meteo.ventEn), ou null (pas de dérive).
     `montee` : vitesse d'ascension (blocs/s). Fonction pure, testée telle
     quelle — c'est elle qui garantit une fumée déterministe au vent donné. */
  function deriveeFumee(x, y, z, age, montee, vent) {
    var h = age * (montee || 3);
    var w = vent ? vent(y + h) : { x: 0, z: 0 };
    return { x: x + w.x * age, y: y + h, z: z + w.z * age };
  }

  MC.Feu = {
    inflammable: inflammable, aDuCombustibleAutour: aDuCombustibleAutour,
    surAppuiSolide: surAppuiSolide, presDeLave: presDeLave, estMouille: estMouille,
    peutAllumer: peutAllumer, etapeFeu: etapeFeu, allumerParLave: allumerParLave,
    deriveeFumee: deriveeFumee, AGE_MAX: AGE_MAX, AGE_SANS_COMBUSTIBLE: AGE_SANS_COMBUSTIBLE,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
