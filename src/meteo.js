/* meteo.js — ciel et météo. Logique pure : fonction de la graine et de
   l'heure du monde. Serveur et clients calculent donc la MÊME météo sans
   rien s'échanger, comme ils calculent le même terrain.

   - couches de nuages : cinq nappes de natures différentes ;
   - temps qu'il fait : une chaîne de Markov par tranches de SEGMENT secondes,
     avec un fondu entre deux temps ;
   - vent, température ressentie, précipitations (pluie ou neige), éclairs ;
   - densité des nuages en un point : elle évolue (les nuages se forment, se
     déforment, se dissipent, se regroupent) et s'annule contre le relief. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;

  /* Cinq couches, chacune avec sa nature : trois sous les plus hauts sommets
     (qui les transpercent), deux au-dessus de tout relief.
       y           base de la couche
       epaisseur   hauteur du nuage, rendue en `tranches` empilées
       dome        les tranches hautes s'amincissent : cumulus bombés
       etire       motif allongé dans le sens du vent : cirrus en filaments
       vent        multiplicateur de dérive : plus c'est haut, plus ça file
       motif       taille d'un motif en blocs (la taille des nuages)
       couverture  part du ciel couverte par beau temps
       taille      côté de la nappe rendue autour de la caméra */
  var COUCHES = [
    { nom: 'stratus',      y: 54,  epaisseur: 3,  tranches: 2, motif: 640, opacite: 0.55, couverture: 0.20, vent: 0.6, taille: 1400 },
    { nom: 'cumulus',      y: 70,  epaisseur: 16, tranches: 7, motif: 350, opacite: 0.92, couverture: 0.30, vent: 1.0, taille: 1400, dome: true },
    { nom: 'altostratus',  y: 96,  epaisseur: 5,  tranches: 2, motif: 1000, opacite: 0.62, couverture: 0.22, vent: 1.3, taille: 1800 },
    { nom: 'cirrocumulus', y: 134, epaisseur: 2,  tranches: 2, motif: 340, opacite: 0.50, couverture: 0.24, vent: 1.8, taille: 2400 },
    { nom: 'cirrus',       y: 168, epaisseur: 0,  tranches: 1, motif: 2100, opacite: 0.42, couverture: 0.28, vent: 2.4, taille: 2800, etire: 3 },
  ];

  /* Types de temps. couverture : ciel bouché à 1 ; precipitation : intensité
     de la pluie ou de la neige ; vent : force de 0 à 1 ; chaleur : écart de
     température en °C ; eclairs : éclairs par minute. */
  var TYPES = {
    grand_soleil: { nom: 'Grand soleil', couverture: 0.02, precipitation: 0,   vent: 0.12, chaleur: 6,  eclairs: 0,  lumiere: 1.15 },
    clair:        { nom: 'Clair',        couverture: 0.22, precipitation: 0,   vent: 0.25, chaleur: 2,  eclairs: 0,  lumiere: 1.0 },
    nuageux:      { nom: 'Nuageux',      couverture: 0.50, precipitation: 0,   vent: 0.35, chaleur: 0,  eclairs: 0,  lumiere: 0.9 },
    couvert:      { nom: 'Couvert',      couverture: 0.80, precipitation: 0,   vent: 0.40, chaleur: -2, eclairs: 0,  lumiere: 0.75 },
    pluie:        { nom: 'Pluie',        couverture: 0.88, precipitation: 0.6, vent: 0.50, chaleur: -3, eclairs: 0,  lumiere: 0.65 },
    orage:        { nom: 'Orage',        couverture: 0.95, precipitation: 0.85, vent: 0.70, chaleur: -4, eclairs: 5,  lumiere: 0.5 },
    tempete:      { nom: 'Tempête',      couverture: 1.00, precipitation: 1.0, vent: 1.00, chaleur: -6, eclairs: 9,  lumiere: 0.4 },
  };
  var ORDRE_TYPES = ['grand_soleil', 'clair', 'nuageux', 'couvert', 'pluie', 'orage', 'tempete'];
  // de chaque temps, les suivants possibles et leurs poids : pas de saut du grand soleil à la tempête
  var TRANSITIONS = {
    grand_soleil: { grand_soleil: 3, clair: 4, nuageux: 1 },
    clair:        { grand_soleil: 2, clair: 3, nuageux: 3, couvert: 1 },
    nuageux:      { clair: 3, nuageux: 2, couvert: 3, pluie: 1 },
    couvert:      { nuageux: 2, couvert: 2, pluie: 4, orage: 1 },
    pluie:        { couvert: 3, pluie: 2, orage: 2, nuageux: 1 },
    orage:        { pluie: 3, tempete: 1, couvert: 2 },
    tempete:      { orage: 3, pluie: 2 },
  };
  var SEGMENT = 150;         // secondes d'un même temps
  var TRANSITION = 30;       // secondes de fondu vers le suivant
  var ANCRE = 32;            // la chaîne repart d'un tirage indépendant tous les ANCRE segments
  var VITESSE_VENT = 6;      // blocs par seconde à force 1, couche de référence
  var EVOLUTION = 90;        // secondes pour qu'un nuage change de forme
  // biomes sans précipitations : l'air y est trop sec
  var SECS = { desert: 1, badlands: 1, volcan: 1 };

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smoothstep(a, b, v) { var t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); }
  function tirer(table, r) {
    var total = 0, k;
    for (k in table) total += table[k];
    var x = r * total;
    for (k in table) { x -= table[k]; if (x < 0) return k; }
    return k;
  }

  function creer(graine) {
    var N = MC.makeNoise((graine | 0) ^ 0x5eed);
    var types = new Map();

    /* Temps du segment k. Remonter toute la chaîne depuis le premier segment
       coûterait de plus en plus cher au fil de la partie : elle repart donc
       d'un tirage indépendant à chaque ancre, puis avance de proche en proche. */
    function typeDu(k) {
      if (types.has(k)) return types.get(k);
      var a = Math.floor(k / ANCRE) * ANCRE;
      var t = ORDRE_TYPES[Math.floor(N.hash2(a, 7331) * 4)];   // une ancre n'est jamais orageuse
      for (var i = a; i <= k; i++) {
        if (i > a) t = tirer(TRANSITIONS[t], N.hash2(i, 911));
        if (!types.has(i)) types.set(i, t);
      }
      if (types.size > 4096) types.clear();
      return t;
    }

    // direction du vent : tourne lentement, d'un segment à l'autre
    function angleDu(k) { return N.value2(k * 0.35, 5.5) * Math.PI * 6; }

    function melange(a, b, f) { return a + (b - a) * f; }

    /* État du ciel à l'instant `temps` (secondes du monde). */
    function etat(temps) {
      var k = Math.floor(temps / SEGMENT);
      var dans = temps - k * SEGMENT;
      var t0 = typeDu(k), t1 = typeDu(k + 1);
      var f = smoothstep(SEGMENT - TRANSITION, SEGMENT, dans);
      var A = TYPES[t0], Bt = TYPES[t1];
      var force = melange(A.vent, Bt.vent, f) * (0.85 + 0.3 * N.value2(temps / 23, 3.3));
      var ang = melange(angleDu(k), angleDu(k + 1), f);
      return {
        type: f < 0.5 ? t0 : t1, courant: t0, suivant: t1, fondu: f, segment: k,
        nom: TYPES[f < 0.5 ? t0 : t1].nom,
        couverture: melange(A.couverture, Bt.couverture, f),
        precipitation: melange(A.precipitation, Bt.precipitation, f),
        chaleur: melange(A.chaleur, Bt.chaleur, f),
        eclairs: melange(A.eclairs, Bt.eclairs, f),
        lumiere: melange(A.lumiere, Bt.lumiere, f),
        vent: { angle: ang, force: force, x: Math.cos(ang) * force, z: Math.sin(ang) * force },
      };
    }

    /* Dérive cumulée des nuages depuis l'origine des temps : l'intégrale du
       vent, segment par segment. Avec le vent courant multiplié par le temps,
       les nuages sauteraient d'un bout du ciel à l'autre à chaque saute de vent. */
    var derives = [{ x: 0, z: 0 }];
    function vecteurVent(k) {
      var t = TYPES[typeDu(k)], a = angleDu(k);
      return { x: Math.cos(a) * t.vent * VITESSE_VENT, z: Math.sin(a) * t.vent * VITESSE_VENT };
    }
    function derive(temps) {
      var k = Math.max(0, Math.floor(temps / SEGMENT));
      if (k > 200000) k = 200000;
      while (derives.length <= k) {
        var i = derives.length - 1, v = vecteurVent(i), d = derives[i];
        derives.push({ x: d.x + v.x * SEGMENT, z: d.z + v.z * SEGMENT });
      }
      var v2 = vecteurVent(k), d0 = derives[k], dt = Math.max(0, temps - k * SEGMENT);
      return { x: d0.x + v2.x * dt, z: d0.z + v2.z * dt };
    }

    /* Champ de rassemblement : de grandes régions où les nuages se regroupent
       et d'autres où ils se dissipent. Il dérive avec le vent et se transforme
       lentement : un banc se forme, grossit, s'effiloche. */
    function rassemblement(x, z, temps, dv) {
      dv = dv || derive(temps);
      return N.fbm3((x - dv.x) / 2400, (z - dv.z) / 2400, temps / 600, 2, 2, 0.5);
    }

    /* Densité (0..1) d'une couche de nuages au point (x, z), à l'altitude y
       d'une de ses tranches. `hauteurSol` : le relief sous ce point ; un nuage
       ne traverse pas la roche — sa densité s'éteint à l'approche du sol. */
    function densiteNuage(couche, x, z, temps, et, hauteurSol, y) {
      et = et || etat(temps);
      if (y === undefined) y = couche.y;
      var dv = derive(temps), m = couche.vent;
      var u = (x - dv.x * m) / couche.motif, v = (z - dv.z * m) / couche.motif;
      if (couche.etire) u /= couche.etire;
      // forme : un bruit 3D dont la troisième dimension est le temps — il se déforme
      var n = N.fbm3(u * 4, v * 4, temps / EVOLUTION + couche.y, 3, 2, 0.5);
      var couv = clamp01(couche.couverture + (et.couverture - 0.3) * 0.95 +
                         (rassemblement(x, z, temps, dv) - 0.5) * 0.9);
      var seuil = 0.62 - couv * 0.34;
      if (couche.dome && couche.epaisseur > 0) {
        var f = clamp01((y - couche.y) / couche.epaisseur);
        seuil += f * f * 0.12;
      }
      var d = clamp01((n - seuil) * 5);
      if (hauteurSol !== undefined && hauteurSol !== null) d *= clamp01((y - hauteurSol - 1) / 3);
      return d;
    }

    /* Température en °C d'un point : climat (0 glacial … 1 torride), altitude,
       heure du jour, temps qu'il fait. Les déserts sont brûlants le jour et
       froids la nuit. */
    function temperature(climatT, altitude, temps, et, biomeId) {
      et = et || etat(temps);
      var soleil = MC.DayCycle ? MC.DayCycle.sunIntensity(temps) : 1;
      var t = -12 + climatT * 46;
      if (altitude > 40) t -= (altitude - 40) * 0.3;
      t += soleil * 4 - (1 - soleil) * 3;
      t += et.chaleur * (0.4 + 0.6 * soleil);
      if (SECS[biomeId]) t += soleil * 8 - (1 - soleil) * 8;
      if (biomeId === 'volcan') t += 10;
      return Math.round(t * 10) / 10;
    }

    /* Ce qui tombe du ciel en (x, z) : de la pluie, de la neige, ou rien.
       Il ne pleut que là où les nuages se sont rassemblés. */
    function precipitation(x, z, temps, tempC, biomeId, et) {
      et = et || etat(temps);
      if (et.precipitation <= 0 || SECS[biomeId]) return { forme: null, intensite: 0 };
      var local = smoothstep(0.34, 0.5, rassemblement(x, z, temps));
      var i = et.precipitation * (0.25 + 0.75 * local);
      if (i < 0.05) return { forme: null, intensite: 0 };
      return { forme: tempC <= 0.5 ? 'neige' : 'pluie', intensite: Math.round(i * 100) / 100 };
    }

    /* Éclairs tombés dans l'intervalle ]t0, t1] : chaque seconde entière a
       sa chance, selon la fréquence du moment. Déterministe : tous les postes
       voient les mêmes éclairs aux mêmes instants. */
    function eclairs(t0, t1) {
      var l = [];
      for (var s = Math.floor(t0); s <= Math.floor(t1); s++) {
        var et = etat(s), p = et.eclairs / 60;
        if (p <= 0) continue;
        if (N.hash2(s, 4242) < p) {
          var t = s + N.hash2(s, 777);
          if (t > t0 && t <= t1) l.push({ t: t, id: s, force: 0.6 + N.hash2(s, 99) * 0.4 });
        }
      }
      return l;
    }
    /* Où tombe un éclair, près d'un point : la maille de 64 blocs qui contient
       ce point, décalée d'un tirage propre à l'éclair. Deux joueurs voisins le
       voient tomber au même endroit. */
    function lieuEclair(e, cx, cz) {
      var mx = Math.floor(cx / 64) * 64 + 32, mz = Math.floor(cz / 64) * 64 + 32;
      var a = N.hash2(e.id, mx * 3 + mz) * Math.PI * 2, r = 10 + N.hash2(mz, e.id) * 70;
      return { x: Math.floor(mx + Math.cos(a) * r), z: Math.floor(mz + Math.sin(a) * r) };
    }

    /* Température ressentie à une position du monde : celle de l'air (climat,
       altitude, heure, temps), réchauffée près d'un feu — torche, lanterne,
       lave, magma — et rafraîchie dans l'eau. */
    var RAYON_CHALEUR = 3;
    function temperatureEn(world, pos, temps, et) {
      et = et || etat(temps);
      var x = Math.floor(pos.x), y = Math.floor(pos.y), z = Math.floor(pos.z);
      var cl = world.bio ? world.bio.climat(x, z) : { t: 0.5 };
      var bio = world.biomeAt ? world.biomeAt(x, z) : null;
      var t = temperature(cl.t, y, temps, et, bio && bio.id);
      var feu = 0, eau = false;
      for (var dy = -1; dy <= 2; dy++) for (var dz = -RAYON_CHALEUR; dz <= RAYON_CHALEUR; dz++)
      for (var dx = -RAYON_CHALEUR; dx <= RAYON_CHALEUR; dx++) {
        var id = world.getBlock(x + dx, y + dy, z + dz);
        if (!id) continue;
        var d = MC.Core.BLOCKS[id];
        if (!d) continue;
        if (d.light) feu = Math.max(feu, (MC.Core.isLava(id) || id === MC.Core.B.MAGMA) ? 22 : 9);
        if (dx === 0 && dz === 0 && dy >= 0 && dy <= 1 && MC.Core.isWater(id)) eau = true;
      }
      t += feu;
      if (eau) t = t * 0.6 + 4;
      return { temperature: Math.round(t * 10) / 10, feu: feu > 0, eau: eau, ressenti: ressenti(t) };
    }

    /* Un éclair tombé en `lieu` touche-t-il ce qui se tient en `pos` ? Il faut
       être à moins de trois blocs et à ciel ouvert. `abri(x, z)` rend le
       sommet solide de la colonne. */
    var PORTEE_FOUDRE = 3;
    function foudroie(lieu, pos, abri) {
      if (Math.hypot(lieu.x + 0.5 - pos.x, lieu.z + 0.5 - pos.z) > PORTEE_FOUDRE) return false;
      if (abri && abri(Math.floor(pos.x), Math.floor(pos.z)) > pos.y + 1.8) return false;
      return true;
    }

    /* Ombre des nuages en un point du sol (x, ySol, z) : on remonte vers
       l'astre jusqu'à la couche des cumulus, et l'on y lit la densité du
       nuage. Renvoie un facteur d'éclairage, 1 à découvert, 0,5 sous un
       nuage épais. Le shader du terrain applique la même règle. */
    var OMBRE_NUAGE = 0.5;
    function ombreNuage(x, ySol, z, temps, astre, et) {
      if (!astre || astre.y <= 0.05) return 1;
      var cu = COUCHES[1], y = cu.y + cu.epaisseur * 0.3;
      var k = (y - ySol) / astre.y;
      if (k <= 0) return 1;
      var d = densiteNuage(cu, x + astre.x * k, z + astre.z * k, temps, et, null, y);
      return 1 - OMBRE_NUAGE * d;
    }

    return { etat: etat, typeDu: typeDu, derive: derive, rassemblement: rassemblement,
             temperatureEn: temperatureEn, ombreNuage: ombreNuage, foudroie: foudroie, DEGATS_FOUDRE: 6,
             densiteNuage: densiteNuage, temperature: temperature, precipitation: precipitation,
             eclairs: eclairs, lieuEclair: lieuEclair };
  }

  /* Ressenti d'une température, pour l'interface et la survie. */
  function ressenti(tempC) {
    if (tempC <= -10) return 'glacial';
    if (tempC <= 2) return 'froid';
    if (tempC < 28) return 'doux';
    if (tempC < 38) return 'chaud';
    return 'brulant';
  }

  MC.Meteo = { COUCHES: COUCHES, TYPES: TYPES, ORDRE_TYPES: ORDRE_TYPES, TRANSITIONS: TRANSITIONS,
               SEGMENT: SEGMENT, TRANSITION: TRANSITION, VITESSE_VENT: VITESSE_VENT, EVOLUTION: EVOLUTION,
               creer: creer, ressenti: ressenti,
               NUAGES_BAS: COUCHES[0].y, NUAGES_HAUT: COUCHES[COUCHES.length - 1].y };
})(typeof globalThis !== 'undefined' ? globalThis : this);
