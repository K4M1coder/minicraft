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

  /* SPEC-VENT-001 : le vent tourne et forcit avec l'altitude. À 170 blocs
     (couche des cirrus) il a tourné jusqu'à 60° de plus qu'au sol et forcit
     de ×2,5. */
  var ALT_VENT_HAUT = 170;        // altitude de référence pour la rotation/le renforcement max
  var ROTATION_VENT_HAUT = Math.PI / 3;   // 60°
  var FORCE_VENT_HAUT = 1.5;      // + 150 % de force, soit ×2,5 au total
  var RAFALE_AMPLITUDE = 0.5;     // rafales : ± 25 % autour de la force de base

  /* SPEC-NUAGE-003 : cyclones tropicaux. Ils naissent par régions de quelques
     milliers de blocs, dans des fenêtres de temps, seulement au-dessus d'une
     mer chaude et humide ; on ne cherche des naissances que dans un rayon
     raisonnable de cellules autour de l'origine (un monde est infini, mais
     un jeu n'a besoin que des cyclones dans une région jouable). */
  var CYCL_REGION = 4000;         // taille d'une cellule génératrice
  var CYCL_PORTEE = 7;            // rayon de recherche en cellules (15 × 15)
  var CYCL_EPOCH = 5400;          // fenêtre de temps d'une naissance possible (1 h 30)
  var CYCL_PROB = 0.12;           // probabilité qu'une cellule chaude engendre un cyclone
  var CYCL_VIE_MIN = 3600, CYCL_VIE_MAX = 14400;   // durée de vie : 1 à 4 heures
  var CYCL_STEER = 2.6;           // multiplicateur du vent dominant pour le déplacement
  var CYCL_TICK = 300;            // pas d'échantillonnage de la surface parcourue
  var CYCL_RAYON_MIN = 900, CYCL_RAYON_MAX = 1600;

  /* SPEC-NUAGE-004 : tornades. Elles ne naissent que pendant un orage ou une
     tempête, là où chaleur, humidité et cisaillement dépassent des seuils. */
  var TORN_REGION = 1500, TORN_PORTEE = 5;
  var TORN_PROB = 0.2;
  var TORN_VIE_MIN = 15, TORN_VIE_MAX = 60;       // quelques dizaines de secondes
  var TORN_RAYON_MIN = 8, TORN_RAYON_MAX = 26;
  var TORN_SEUIL_CHALEUR = 22, TORN_SEUIL_HUMIDITE = 0.55, TORN_SEUIL_CISAILLEMENT = 0.35;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function smoothstep(a, b, v) { var t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); }
  function tirer(table, r) {
    var total = 0, k;
    for (k in table) total += table[k];
    var x = r * total;
    for (k in table) { x -= table[k]; if (x < 0) return k; }
    return k;
  }

  /* Mer chaude et humide par défaut : des poches de bruit, raisonnable pour
     les tests. Un monde réel injecterait ici sa propre carte des océans. */
  function chaudeDefaut(N) {
    return function (x, z) { return N.value2(x / 5000 + 100.7, z / 5000 - 55.3) > 0.6; };
  }
  /* Conditions locales par défaut (température, humidité), indépendantes de
     l'heure : un monde réel injecterait ici son climat et son relief. */
  function conditionsDefaut(N) {
    return function (x, z) {
      return {
        temperature: 15 + N.value2(x / 2000 + 11.3, z / 2000 - 7.7) * 20,
        humidite: clamp01(N.value2(x / 1800 - 3.1, z / 1800 + 2.9)),
      };
    };
  }

  function creer(graine, opts) {
    var N = MC.makeNoise((graine | 0) ^ 0x5eed);
    opts = opts || {};
    var estMerChaude = opts.estMerChaude || chaudeDefaut(N);
    var conditionsEn = opts.conditionsEn || conditionsDefaut(N);
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

    /* SPEC-VENT-001 : le vent au sol tourne et forcit en montant, avec des
       rafales. `y` : altitude du point considéré (0 au sol). La rotation et
       le renforcement sont progressifs, maximaux à ALT_VENT_HAUT (couche des
       cirrus) ; au-delà, ils saturent plutôt que de s'emballer. */
    function ventEn(temps, y, et) {
      et = et || etat(temps);
      var fracAlt = clamp01((y || 0) / ALT_VENT_HAUT);
      var ang = et.vent.angle + fracAlt * ROTATION_VENT_HAUT;
      var force = et.vent.force * (1 + FORCE_VENT_HAUT * fracAlt);
      // rafale : bruit rapide, borné, propre à l'altitude pour ne pas être synchrone partout
      var rafale = 1 + (N.value2(temps * 0.6, (y || 0) * 0.13 + 9.5) - 0.5) * RAFALE_AMPLITUDE;
      force *= rafale;
      return { x: Math.cos(ang) * force, z: Math.sin(ang) * force, force: force, angle: ang };
    }
    /* Le vent à l'altitude d'une couche de nuages COUCHES[i]. */
    function ventCouche(i, temps) { return ventEn(temps, COUCHES[i].y); }

    /* Dérive par couche : chaque couche de nuages dérive selon le vent de son
       altitude (rotation et renforcement compris), intégrée segment par
       segment comme `derive`, pour ne jamais sauter quand le vent tourne. */
    var derivesCouches = [];
    function vecteurVentCouche(i, k) {
      var t = TYPES[typeDu(k)], a = angleDu(k);
      var y = COUCHES[i].y, fracAlt = clamp01(y / ALT_VENT_HAUT);
      var ang = a + fracAlt * ROTATION_VENT_HAUT;
      var force = t.vent * VITESSE_VENT * (1 + FORCE_VENT_HAUT * fracAlt);
      return { x: Math.cos(ang) * force, z: Math.sin(ang) * force };
    }
    function deriveCouche(i, temps) {
      var arr = derivesCouches[i] || (derivesCouches[i] = [{ x: 0, z: 0 }]);
      var k = Math.max(0, Math.floor(temps / SEGMENT));
      if (k > 200000) k = 200000;
      while (arr.length <= k) {
        var idx = arr.length - 1, v = vecteurVentCouche(i, idx), d = arr[idx];
        arr.push({ x: d.x + v.x * SEGMENT, z: d.z + v.z * SEGMENT });
      }
      var v2 = vecteurVentCouche(i, k), d0 = arr[k], dt = Math.max(0, temps - k * SEGMENT);
      return { x: d0.x + v2.x * dt, z: d0.z + v2.z * dt };
    }

    /* Champ de rassemblement : de grandes régions où les nuages se regroupent
       et d'autres où ils se dissipent. Il dérive avec le vent et se transforme
       lentement : un banc se forme, grossit, s'effiloche. */
    function rassemblement(x, z, temps, dv) {
      dv = dv || derive(temps);
      return N.fbm3((x - dv.x) / 2400, (z - dv.z) / 2400, temps / 600, 2, 2, 0.5);
    }

    // ── SPEC-NUAGE-003 : cyclones ───────────────────────────────────────────
    /* Naissances possibles d'une région (cx, cz) dans la fenêtre `e` : liste
       (0 ou 1 élément) mémorisée une fois pour toutes, indépendante de
       l'instant d'appel — seule la dynamique (position, force) dépend de
       `temps`. */
    var genesesCyclones = new Map();
    var CYCL_CELLULES = (2 * CYCL_PORTEE + 1) * (2 * CYCL_PORTEE + 1);
    /* Une cellule (cx, cz) de la fenêtre `e` : sa naissance éventuelle, ajoutée à `l`.
       Chaque cellule interroge le relief (mer chaude ?) : la fenêtre entière coûte
       plus de 100 ms — d'où `preparerGenesesCyclones`, la même boucle par tranches. */
    function celluleCyclone(e, i, l) {
      var cx = -CYCL_PORTEE + Math.floor(i / (2 * CYCL_PORTEE + 1)), cz = -CYCL_PORTEE + i % (2 * CYCL_PORTEE + 1);
      var base = e * 1000003 + cx * 9176 + cz * 6971;
      var roll = N.hash3(cx, cz, e * 7 + 13);
      var centreX = cx * CYCL_REGION + CYCL_REGION / 2, centreZ = cz * CYCL_REGION + CYCL_REGION / 2;
      if (roll >= CYCL_PROB || !estMerChaude(centreX, centreZ)) return;
      var tBirth = e * CYCL_EPOCH + N.hash3(cx, cz, e * 7 + 91) * CYCL_EPOCH;
      l.push({
        id: 'cy' + base,
        tBirth: tBirth,
        vie: CYCL_VIE_MIN + N.hash3(cx, cz, e * 7 + 17) * (CYCL_VIE_MAX - CYCL_VIE_MIN),
        x0: centreX + (N.hash3(cx, cz, e * 7 + 23) - 0.5) * CYCL_REGION * 0.6,
        z0: centreZ + (N.hash3(cx, cz, e * 7 + 29) - 0.5) * CYCL_REGION * 0.6,
        forcePic: 0.6 + N.hash3(cx, cz, e * 7 + 5) * 0.4,
        sens: N.hash3(cx, cz, e * 7 + 3) < 0.5 ? 1 : -1,
        rayonMax: CYCL_RAYON_MIN + N.hash3(cx, cz, e * 7 + 41) * (CYCL_RAYON_MAX - CYCL_RAYON_MIN),
        oeilFrac: 0.12 + N.hash3(cx, cz, e * 7 + 47) * 0.08,
      });
    }
    var genesesEnCours = new Map();      // e -> { i, l } : fenêtre préparée en partie
    function preparerGenesesCyclones(e, echeance, horloge) {
      if (genesesCyclones.has(e)) return true;
      var p = genesesEnCours.get(e) || { i: 0, l: [] };
      while (p.i < CYCL_CELLULES) {
        celluleCyclone(e, p.i, p.l);
        p.i++;
        if (echeance !== undefined && p.i < CYCL_CELLULES && horloge() >= echeance) { genesesEnCours.set(e, p); return false; }
      }
      genesesEnCours.delete(e);
      genesesCyclones.set(e, p.l);
      return true;
    }
    function genesesEpoch(e) {
      if (!genesesCyclones.has(e)) preparerGenesesCyclones(e);
      return genesesCyclones.get(e);
    }
    /* Les fenêtres de naissance que `cyclones(temps)` consulte, plus la suivante
       (pour la préparer avant d'en avoir besoin). */
    function epoquesCyclones(temps) {
      var out = [], e0 = Math.floor((temps - CYCL_VIE_MAX) / CYCL_EPOCH), e1 = Math.floor(temps / CYCL_EPOCH);
      for (var e = e0; e <= e1 + 1; e++) out.push(e);
      return out;
    }
    function positionCyclone(g, temps) {
      var d0 = derive(g.tBirth), d1 = derive(temps);
      return { x: g.x0 + (d1.x - d0.x) * CYCL_STEER, z: g.z0 + (d1.z - d0.z) * CYCL_STEER };
    }
    // fraction du temps écoulé passée au-dessus d'une mer chaude, mémorisée par cyclone
    var surfaceCyclones = new Map();
    function fractionChaudeCyclone(g, temps) {
      var arr = surfaceCyclones.get(g.id);
      if (!arr) { arr = [0]; surfaceCyclones.set(g.id, arr); }
      var maxIdx = Math.floor(g.vie / CYCL_TICK);
      var idx = Math.min(Math.floor((temps - g.tBirth) / CYCL_TICK), maxIdx);
      if (idx < 0) return 1;
      while (arr.length <= idx) {
        var i = arr.length - 1, p = positionCyclone(g, g.tBirth + i * CYCL_TICK);
        arr.push(arr[i] + (estMerChaude(p.x, p.z) ? 1 : 0));
      }
      return idx > 0 ? arr[idx] / idx : (estMerChaude(g.x0, g.z0) ? 1 : 0.35);
    }
    function etatCyclone(g, temps) {
      var age = temps - g.tBirth;
      var pos = positionCyclone(g, temps);
      var monte = smoothstep(0, g.vie * 0.15, age), tombe = 1 - smoothstep(g.vie * 0.75, g.vie, age);
      var enveloppe = clamp01(monte) * clamp01(tombe);
      var frac = fractionChaudeCyclone(g, temps);
      var force = clamp01(g.forcePic * enveloppe * (0.35 + 0.65 * frac));
      var rayon = g.rayonMax * clamp01(0.3 + 0.7 * enveloppe);
      return { id: g.id, x: pos.x, z: pos.z, rayon: rayon, oeil: rayon * g.oeilFrac, force: force, sens: g.sens };
    }
    var cacheCyclonesT = null, cacheCyclonesL = null;
    /* Cyclones actifs à `temps` : nés d'une mer chaude et humide, ils se
       déplacent avec le vent dominant, tournent, et s'affaiblissent en
       vieillissant ou en quittant les eaux chaudes. Mémorisé pour l'instant
       courant : le rendu interroge cette fonction à chaque image. */
    function cyclones(temps) {
      var key = Math.round(temps * 4) / 4;
      if (cacheCyclonesT === key) return cacheCyclonesL;
      var l = [];
      var e0 = Math.floor((temps - CYCL_VIE_MAX) / CYCL_EPOCH), e1 = Math.floor(temps / CYCL_EPOCH);
      for (var e = e0; e <= e1; e++) genesesEpoch(e).forEach(function (g) {
        if (temps < g.tBirth || temps > g.tBirth + g.vie) return;
        var et = etatCyclone(g, temps);
        if (et.force > 0.05) l.push(et);
      });
      cacheCyclonesT = key; cacheCyclonesL = l;
      return l;
    }
    /* Influence d'un cyclone en (x, z) : vent tournant (et légèrement rentrant
       vers l'œil), pluies intenses, couverture et densité en spirale — dégagé
       dans l'œil. Combine tous les cyclones dont le rayon couvre ce point. */
    function influenceCyclone(x, z, temps) {
      var res = { vent: { x: 0, z: 0, force: 0 }, precipitation: 0, couverture: 0, oeil: false, spirale: 0 };
      cyclones(temps).forEach(function (c) {
        var dx = x - c.x, dz = z - c.z, dist = Math.hypot(dx, dz);
        if (dist >= c.rayon) return;
        var r = dist / c.rayon, oeilR = c.oeil / c.rayon;
        if (dist < c.oeil) res.oeil = true;
        var theta = Math.atan2(dz, dx);
        var bras = 0.5 + 0.5 * Math.sin(theta * 3 - r * 10 * c.sens + temps * 0.05 * c.sens);
        var bande = smoothstep(oeilR, oeilR + 0.15, r) * (1 - smoothstep(0.75, 1, r));
        var spirale = clamp01(bande * (0.5 + 0.5 * bras)) * c.force;
        res.spirale = Math.max(res.spirale, spirale);
        res.couverture = Math.max(res.couverture, spirale * 0.95);
        res.precipitation = Math.max(res.precipitation, c.force * clamp01(r - oeilR) * (1 - r));
        if (dist > 0.01) {
          var tang = (1 - r) * c.force * 1.4;
          res.vent.x += (-dz / dist) * c.sens * tang;
          res.vent.z += (dx / dist) * c.sens * tang;
        }
      });
      res.vent.force = Math.hypot(res.vent.x, res.vent.z);
      return res;
    }

    // ── SPEC-NUAGE-004 : tornades ───────────────────────────────────────────
    var genesesTornades = new Map();
    function genesesSegmentTornade(k) {
      var l = genesesTornades.get(k);
      if (l) return l;
      l = [];
      if (etat(k * SEGMENT + SEGMENT / 2).eclairs > 0) {
        for (var cx = -TORN_PORTEE; cx <= TORN_PORTEE; cx++) for (var cz = -TORN_PORTEE; cz <= TORN_PORTEE; cz++) {
          var centreX = cx * TORN_REGION + TORN_REGION / 2, centreZ = cz * TORN_REGION + TORN_REGION / 2;
          var cond = conditionsEn(centreX, centreZ);
          var vSol = ventEn(k * SEGMENT, 2), vHaut = ventEn(k * SEGMENT, COUCHES[1].y);
          var cisaillement = Math.hypot(vHaut.x - vSol.x, vHaut.z - vSol.z);
          if (cond.temperature < TORN_SEUIL_CHALEUR || cond.humidite < TORN_SEUIL_HUMIDITE ||
              cisaillement < TORN_SEUIL_CISAILLEMENT) continue;
          var roll = N.hash3(cx, cz, k * 11 + 5);
          if (roll >= TORN_PROB) continue;
          var tBirth = k * SEGMENT + N.hash3(cx, cz, k * 11 + 51) * SEGMENT;
          l.push({
            id: 'tn' + (k * 1000003 + cx * 977 + cz * 733),
            tBirth: tBirth,
            vie: TORN_VIE_MIN + N.hash3(cx, cz, k * 11 + 61) * (TORN_VIE_MAX - TORN_VIE_MIN),
            x0: centreX + (N.hash3(cx, cz, k * 11 + 71) - 0.5) * TORN_REGION * 0.6,
            z0: centreZ + (N.hash3(cx, cz, k * 11 + 81) - 0.5) * TORN_REGION * 0.6,
            forcePic: 0.5 + N.hash3(cx, cz, k * 11 + 91) * 0.5,
            sens: N.hash3(cx, cz, k * 11 + 97) < 0.5 ? 1 : -1,
            rayonMax: TORN_RAYON_MIN + N.hash3(cx, cz, k * 11 + 101) * (TORN_RAYON_MAX - TORN_RAYON_MIN),
          });
        }
      }
      genesesTornades.set(k, l);
      return l;
    }
    function positionTornade(g, temps) {
      var d0 = derive(g.tBirth), d1 = derive(temps);
      return { x: g.x0 + (d1.x - d0.x), z: g.z0 + (d1.z - d0.z) };
    }
    var cacheTornadesT = null, cacheTornadesL = null;
    /* Tornades actives à `temps` : formées sous un orage ou une tempête, là où
       chaleur, humidité et cisaillement du vent le permettent ; elles suivent
       le vent puis se dissipent en quelques dizaines de secondes. `vie` :
       âge en secondes depuis la formation. */
    function tornades(temps) {
      var key = Math.round(temps * 4) / 4;
      if (cacheTornadesT === key) return cacheTornadesL;
      var l = [];
      var k0 = Math.floor((temps - TORN_VIE_MAX) / SEGMENT), k1 = Math.floor(temps / SEGMENT);
      for (var k = k0; k <= k1; k++) genesesSegmentTornade(k).forEach(function (g) {
        if (temps < g.tBirth || temps > g.tBirth + g.vie) return;
        var age = temps - g.tBirth;
        var monte = smoothstep(0, g.vie * 0.25, age), tombe = 1 - smoothstep(g.vie * 0.7, g.vie, age);
        var enveloppe = clamp01(monte) * clamp01(tombe);
        if (enveloppe <= 0.02) return;
        var pos = positionTornade(g, temps);
        l.push({ id: g.id, x: pos.x, z: pos.z, rayon: g.rayonMax * (0.5 + 0.5 * enveloppe),
                 force: g.forcePic * enveloppe, vie: age, sens: g.sens });
      });
      cacheTornadesT = key; cacheTornadesL = l;
      return l;
    }
    /* Poussée d'une tornade sur un point (x, y, z) : aspiration vers l'axe,
       rotation autour de lui, soulèvement — nulle au-delà du rayon d'action
       (un peu plus large que l'entonnoir visible), et affaiblie en altitude. */
    var TORN_PORTEE_ACTION = 2.2, TORN_HAUTEUR_ACTION = 50;
    /* SPEC-VENT-003 : bancs de brume. Denses au petit matin et par temps
       humide, ils s'étendent dans les creux — vallées, bords de l'eau — et se
       lèvent sur les hauteurs ; ils dérivent avec le vent de surface.
       `lieu` : { ySol, fond (le point bas alentour, ou l'eau), humidite 0..1 }. */
    function brume(temps, et, lieu) {
      et = et || etat(temps);
      var jour = MC.DayCycle ? MC.DayCycle.DAY_LENGTH : 1200;
      var p = ((temps % jour) + jour) % jour / jour;
      // l'aube (0,92 → 1) et le petit matin (0 → 0,15), le cœur du jour la lève
      var matin = p >= 0.85 ? smoothstep(0.85, 0.95, p) : 1 - smoothstep(0.05, 0.16, p);
      var humide = et.precipitation > 0 ? 0.55 : et.couverture > 0.7 ? 0.3 : 0;
      var base = Math.max(matin * 0.9, humide);
      var hum = clamp01(lieu && lieu.humidite !== undefined ? lieu.humidite : 0.5);
      var creux = lieu ? clamp01((lieu.fond + 12 - lieu.ySol) / 12) : 1;
      return clamp01(base * (0.25 + 0.75 * hum) * creux * (1 - clamp01(et.vent.force - 0.6) * 0.8));
    }
    /* La brume dérive avec le vent de surface. */
    function deriveBrume(temps) { return derive(temps); }

    /* `liste` (facultatif) : les tornades déjà calculées pour `temps` — le serveur
       en passe la liste pour ne la recalculer ni la contourner. */
    function pousseeTornade(x, y, z, temps, liste) {
      var px = 0, py = 0, pz = 0;
      (liste || tornades(temps)).forEach(function (t) {
        var dx = x - t.x, dz = z - t.z, dist = Math.hypot(dx, dz);
        var portee = t.rayon * TORN_PORTEE_ACTION;
        if (dist >= portee) return;
        var r = clamp01(dist / portee);
        var g = 1 - r;
        var haut = clamp01(1 - y / TORN_HAUTEUR_ACTION);
        if (dist > 0.01) {
          var aspiration = t.force * g * 6, tangent = t.force * g * 9;
          px += (-dx / dist) * aspiration + (-dz / dist) * t.sens * tangent;
          pz += (-dz / dist) * aspiration + (dx / dist) * t.sens * tangent;
        }
        py += t.force * g * haut * 8;
      });
      return { x: px, y: py, z: pz };
    }

    /* Densité (0..1) d'une couche de nuages au point (x, z), à l'altitude y
       d'une de ses tranches. `hauteurSol` : le relief sous ce point ; un nuage
       ne traverse pas la roche — sa densité s'éteint à l'approche du sol.
       SPEC-NUAGE-003 : un cyclone proche impose sa spirale (couverture
       accrue, œil dégagé) par-dessus la texture ordinaire des nuages. */
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
      var infl = influenceCyclone(x, z, temps);
      if (infl.spirale > 0) d = Math.max(d, infl.spirale * 0.95);
      if (infl.oeil) d *= 0.15;
      if (hauteurSol !== undefined && hauteurSol !== null) d *= clamp01((y - hauteurSol - 1) / 3);
      return d;
    }

    /* Température en °C d'un point : climat (0 glacial … 1 torride), altitude,
       heure du jour, temps qu'il fait, saison. Les déserts sont brûlants le
       jour et froids la nuit.
       SPEC-SAISON-003 : l'écart été/hiver est progressif (une fonction continue
       de l'heure du monde) et le plus marqué aux climats tempérés (climatT
       proche de 0,5) — les extrêmes (glacial ou torride) varient déjà tant
       avec l'heure et le climat qu'une saison y change peu de choses. */
    var SAISON_AMPL = 11;   // écart maximal (°C) entre le cœur de l'été et de l'hiver, en climat tempéré
    function temperature(climatT, altitude, temps, et, biomeId) {
      et = et || etat(temps);
      var soleil = MC.DayCycle ? MC.DayCycle.sunIntensity(temps) : 1;
      var t = -12 + climatT * 46;
      if (altitude > 40) t -= (altitude - 40) * 0.3;
      t += soleil * 4 - (1 - soleil) * 3;
      t += et.chaleur * (0.4 + 0.6 * soleil);
      if (MC.DayCycle) {
        var tempere = 4 * climatT * (1 - climatT);           // 0 aux extrêmes, 1 à climatT = 0,5
        t += MC.DayCycle.facteurSaison(temps) * SAISON_AMPL * tempere;
      }
      if (SECS[biomeId]) t += soleil * 8 - (1 - soleil) * 8;
      if (biomeId === 'volcan') t += 10;
      return Math.round(t * 10) / 10;
    }

    /* Ce qui tombe du ciel en (x, z) : de la pluie, de la neige, ou rien.
       Il ne pleut que là où les nuages se sont rassemblés. */
    function precipitation(x, z, temps, tempC, biomeId, et) {
      et = et || etat(temps);
      if (SECS[biomeId]) return { forme: null, intensite: 0 };
      // les bandes d'un cyclone pleuvent quel que soit le temps alentour
      var cy = influenceCyclone(x, z, temps).precipitation;
      if (et.precipitation <= 0 && cy <= 0.05) return { forme: null, intensite: 0 };
      var local = smoothstep(0.34, 0.5, rassemblement(x, z, temps));
      var i = Math.max(et.precipitation * (0.25 + 0.75 * local), Math.min(1, cy * 1.6));
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
             eclairs: eclairs, lieuEclair: lieuEclair,
             ventEn: ventEn, ventCouche: ventCouche, deriveCouche: deriveCouche,
             cyclones: cyclones, influenceCyclone: influenceCyclone,
             tornades: tornades, pousseeTornade: pousseeTornade,
             preparerGenesesCyclones: preparerGenesesCyclones, epoquesCyclones: epoquesCyclones, brume: brume, deriveBrume: deriveBrume };
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
