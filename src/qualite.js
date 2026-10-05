/* qualite.js — logique PURE de qualité adaptative (SPEC-RENDU-003 à 008, 010,
   015 ; SPEC-PERF-015). Aucune dépendance à THREE ni au DOM : tout est
   calculé à partir d'un FPS INJECTÉ par l'appelant (jamais mesuré ici), ce
   qui permet de tester au chronomètre simulé sous Node.

   Deux couches :
   - une fenêtre glissante générique (percentile sur les N dernières
     secondes), utilisée à la fois par le panneau F3 (SPEC-PERF-015) et par
     la logique d'adaptation (SPEC-RENDU-005 à 008) — même source, comme
     l'exige SPEC-RENDU-015 : l'appelant partage UNE SEULE fenêtre entre les
     deux usages plutôt que d'en recréer une par consommateur ;
   - un état à hystérésis qui décide, à partir d'un p50 déjà calculé, du
     palier de qualité (réfraction, antialias, DPR) en cascade : le réglage
     le moins coûteux visuellement cède en premier (SPEC-RENDU-008). */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  // ── fenêtre glissante (secondes) ─────────────────────────────────────────
  function creerFenetre(dureeSec) {
    return { duree: dureeSec > 0 ? dureeSec : 5, echantillons: [] };
  }
  function ajouterEchantillon(fenetre, t, valeur) {
    if (!isFinite(valeur)) return fenetre;
    fenetre.echantillons.push([t, valeur]);
    var limite = t - fenetre.duree;
    while (fenetre.echantillons.length && fenetre.echantillons[0][0] < limite) fenetre.echantillons.shift();
    return fenetre;
  }
  /* Percentile `p` (0..100) sur les échantillons actuellement dans la
     fenêtre, ou null si elle est vide. Tri à chaque appel : la fenêtre ne
     contient que quelques centaines de valeurs au plus (5 s à 60 Hz). */
  function percentile(fenetre, p) {
    var vals = fenetre.echantillons.map(function (e) { return e[1]; }).sort(function (a, b) { return a - b; });
    if (!vals.length) return null;
    var idx = Math.min(vals.length - 1, Math.max(0, Math.round((p / 100) * (vals.length - 1))));
    return vals[idx];
  }

  // ── détection d'un rendu logiciel (SPEC-RENDU-010) ───────────────────────
  var MARQUEURS_LOGICIEL = ['swiftshader', 'llvmpipe', 'mesa software rasterizer', 'microsoft basic render driver', 'basic render driver', 'software rasterizer'];
  function detecterRenduLogiciel(nomRenduUnmasked) {
    if (!nomRenduUnmasked) return false;
    var s = String(nomRenduUnmasked).toLowerCase();
    return MARQUEURS_LOGICIEL.some(function (m) { return s.indexOf(m) >= 0; });
  }

  // ── réfraction : fréquence plafonnée sous un seuil de FPS (SPEC-RENDU-003) ─
  /* `image` : compteur d'images incrémenté par l'appelant (0, 1, 2…). Sous le
     seuil, la passe ne se recalcule qu'une image sur deux (les images
     paires) ; au-dessus, chaque image la recalcule. */
  function refractionFrequenceOK(image, fpsP50, seuil) {
    if (fpsP50 == null || fpsP50 >= seuil) return true;
    return (image % 2) === 0;
  }

  // ── réfraction : distance de l'eau à la caméra (SPEC-RENDU-004) ──────────
  function eauRefractanteVisible(distance, seuilDistance) {
    return isFinite(distance) && distance <= seuilDistance;
  }

  /* DPR : le palier adaptatif lui-même ne descend jamais sous 1 (c'est la
     part que cette fonction garantit), puis le plafond des options
     utilisateur s'applique par-dessus. Ce plafond peut légitimement être
     inférieur à 1 quand une résolution fixe plus petite que l'hôte a été
     choisie (SPEC-OPTION-005) : dans ce cas le choix explicite de
     l'utilisateur l'emporte sur le plancher adaptatif — ce n'est pas
     l'adaptatif qui « descend sous 1 », c'est un réglage assumé. */
  function plafonnerDPR(dpr, plafond) {
    var p = isFinite(plafond) && plafond > 0 ? plafond : dpr;
    return Math.min(Math.max(1, dpr), p);
  }

  /* 800×600 est la taille de rendu minimale du jeu (en dessous, menus et HUD
     deviennent illisibles) : quelle que soit la dégradation adaptative, le
     tampon de rendu (taille CSS de l'hôte × DPR) ne doit jamais descendre
     sous cet équivalent. Pour un hôte plus grand que 800×600, le DPR=1 du
     dernier palier le garantit déjà ; cette fonction ne relève le DPR que
     dans le cas extrême d'un hôte plus petit que le plancher. */
  function dprPlancher(largeurCss, hauteurCss, seuilL, seuilH) {
    seuilL = seuilL > 0 ? seuilL : 800; seuilH = seuilH > 0 ? seuilH : 600;
    if (!(largeurCss > 0) || !(hauteurCss > 0)) return 1;
    return Math.max(1, seuilL / largeurCss, seuilH / hauteurCss);
  }
  /* Combine le palier adaptatif, le plafond des options ET le plancher
     800×600 : le plancher a toujours le dernier mot, jamais l'adaptatif. */
  function ajusterDPR(dprPalier, plafondOptions, largeurCss, hauteurCss) {
    return Math.max(plafonnerDPR(dprPalier, plafondOptions), dprPlancher(largeurCss, hauteurCss));
  }

  /* Niveaux de dégradation, du moins coûteux au plus coûteux visuellement :
       0            : tout actif — réfraction, antialias, DPR au premier palier
       1            : réfraction coupée
       2            : + antialias coupé
       3..3+len(P)-2: + DPR qui descend d'un palier de `paliersDPR` à chaque cran
     Le dernier niveau atteint le dernier palier de `paliersDPR` (ex. 1). */
  function creerEtat(opts) {
    opts = opts || {};
    var paliersDPR = opts.paliersDPR && opts.paliersDPR.length ? opts.paliersDPR.slice() : [2, 1.5, 1];
    return {
      seuilBas: opts.seuilBas != null ? opts.seuilBas : 30,
      seuilHaut: opts.seuilHaut != null ? opts.seuilHaut : 50,
      delaiSec: opts.delaiSec != null ? opts.delaiSec : 3,
      paliersDPR: paliersDPR,
      niveauMax: 2 + (paliersDPR.length - 1),
      niveau: opts.niveauInitial != null ? Math.max(0, Math.min(2 + (paliersDPR.length - 1), opts.niveauInitial | 0)) : 0,
      sousSeuilDepuis: null,
      dessusSeuilDepuis: null,
    };
  }

  function decisions(etat) {
    var niveau = etat.niveau, paliers = etat.paliersDPR;
    var idxDPR = niveau <= 2 ? 0 : Math.min(paliers.length - 1, niveau - 2);
    return { niveau: niveau, refraction: niveau < 1, antialias: niveau < 2, dpr: paliers[idxDPR] };
  }

  /* Une évaluation par « tick » de la boucle d'adaptation (ex. toutes les
     secondes, pas nécessairement chaque image). `p50` vient de la même
     fenêtre que le panneau F3 (SPEC-RENDU-015). Renvoie les décisions
     courantes ; `etat` est modifié en place (état à hystérésis). */
  function evaluer(etat, t, p50) {
    if (p50 == null) { etat.sousSeuilDepuis = null; etat.dessusSeuilDepuis = null; return decisions(etat); }
    if (p50 < etat.seuilBas) {
      etat.dessusSeuilDepuis = null;
      if (etat.sousSeuilDepuis == null) etat.sousSeuilDepuis = t;
      if (t - etat.sousSeuilDepuis >= etat.delaiSec && etat.niveau < etat.niveauMax) {
        etat.niveau++;
        etat.sousSeuilDepuis = t;              // laisse un délai avant le cran suivant
      }
    } else if (p50 >= etat.seuilHaut) {
      etat.sousSeuilDepuis = null;
      if (etat.dessusSeuilDepuis == null) etat.dessusSeuilDepuis = t;
      if (t - etat.dessusSeuilDepuis >= etat.delaiSec && etat.niveau > 0) {
        etat.niveau--;
        etat.dessusSeuilDepuis = t;
      }
    } else {
      etat.sousSeuilDepuis = null; etat.dessusSeuilDepuis = null;
    }
    return decisions(etat);
  }

  /* SPEC-RENDU-015 : UNE mesure de FPS (`fps`, la valeur de g.fps de ce
     tick) produit en un seul calcul le p50/p95 affichés au panneau F3 ET la
     décision d'adaptation. Le p50 transmis à `evaluer` est recopié tel quel
     dans les décisions (`fpsP50`) : l'appelant n'a plus aucun moyen
     d'afficher une valeur et d'en décider avec une autre. */
  function mesurerTick(fenetre, etat, t, fps) {
    ajouterEchantillon(fenetre, t, fps);
    var p50 = percentile(fenetre, 50), p95 = percentile(fenetre, 95);
    var d = evaluer(etat, t, p50);
    d.fpsP50 = p50;
    return { fps: fps, p50: p50, p95: p95, decisions: d };
  }

  /* SPEC-RENDU-006 : choix du joueur pour l'antialias (options) combiné à
     la décision adaptative. « auto » (défaut) suit le FPS mesuré ; « oui »
     le réactive manuellement quoi que dise l'adaptatif ; « non » le coupe. */
  var CHOIX_ANTIALIAS = ['auto', 'oui', 'non'];
  function antialiasEffectif(choix, decisionAuto) {
    if (choix === 'oui' || choix === true) return true;
    if (choix === 'non' || choix === false) return false;
    return decisionAuto !== false;
  }

  /* SPEC-RENDU-012 : chaîne de mipmaps d'un atlas en grille régulière de
     tuiles carrées (`tuile` texels, puissance de deux, comme l'atlas).
     `data` : RGBA 8 bits du niveau 0 (largeur × hauteur, puissances de deux).
     Rend les niveaux 1.. jusqu'à 1×1 : [{ width, height, data }].
     Sûr pour un atlas (pas de débordement d'une tuile sur sa voisine) :
     - chaque texel d'un niveau moyenne un bloc 2×2 du niveau précédent,
       aligné sur la grille : tant qu'une tuile fait au moins 1 texel
       (niveaux 0..log2(tuile)), aucun bloc ne chevauche deux tuiles ;
       au-delà, le mélange est inévitable — le shader plafonne donc le
       niveau lu à log2(tuile) (voir render.js, avecAtlasRepete) ;
     - la couleur est moyennée en pondérant par l'alpha : un texel
       transparent (rgb nul) n'assombrit pas le feuillage au loin ;
     - l'alpha d'une tuile À DÉCOUPE (`tuilesDecoupe` : indices des tuiles
       de la passe cutout, à alphaTest) est remis à l'échelle pour garder au
       mieux, au seuil `seuilAlpha` (leur alphaTest), la couverture du niveau
       0 : herbes et fleurs s'amincissent moins au loin. Les autres tuiles
       (fondu : verre, eau… dont l'alpha est une opacité, pas une découpe)
       gardent la moyenne simple : leur opacité ne change pas au loin. */
  function mipmapsAtlas(data, largeur, hauteur, tuile, seuilAlpha, tuilesDecoupe) {
    var seuil = (seuilAlpha > 0 ? seuilAlpha : 0.5) * 255;
    var nivMaxTuile = Math.round(Math.log(tuile) / Math.LN2);
    var colsT = largeur / tuile, rowsT = hauteur / tuile;
    // couverture et présence d'alpha partiel par tuile, au niveau 0
    var couv0 = new Float32Array(colsT * rowsT), decoupe = new Uint8Array(colsT * rowsT);
    var enDecoupe = new Uint8Array(colsT * rowsT);
    (tuilesDecoupe || []).forEach(function (t) { if (t >= 0 && t < enDecoupe.length) enDecoupe[t] = 1; });
    for (var ty = 0; ty < rowsT; ty++) for (var tx = 0; tx < colsT; tx++) {
      var n = 0, partiel = 0;
      for (var y = 0; y < tuile; y++) for (var x = 0; x < tuile; x++) {
        var a = data[((ty * tuile + y) * largeur + tx * tuile + x) * 4 + 3];
        if (a >= seuil) n++;
        if (a < 255) partiel = 1;
      }
      couv0[ty * colsT + tx] = n / (tuile * tuile);
      decoupe[ty * colsT + tx] = partiel && enDecoupe[ty * colsT + tx] ? 1 : 0;
    }
    var niveaux = [], src = data, sl = largeur, sh = hauteur, k = 0;
    while (sl > 1 || sh > 1) {
      k++;
      var dl = Math.max(1, sl >> 1), dh = Math.max(1, sh >> 1);
      var brut = new Float32Array(dl * dh * 4);
      for (var dy = 0; dy < dh; dy++) for (var dx = 0; dx < dl; dx++) {
        var r = 0, g = 0, b = 0, sa = 0, rr = 0, gg = 0, bb = 0, cnt = 0;
        for (var oy = 0; oy < 2; oy++) for (var ox = 0; ox < 2; ox++) {
          var sx = Math.min(sl - 1, dx * 2 + ox), sy = Math.min(sh - 1, dy * 2 + oy);
          var i = (sy * sl + sx) * 4, al = src[i + 3];
          r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; sa += al;
          rr += src[i]; gg += src[i + 1]; bb += src[i + 2]; cnt++;
        }
        var o = (dy * dl + dx) * 4;
        if (sa > 0) { brut[o] = r / sa; brut[o + 1] = g / sa; brut[o + 2] = b / sa; }
        else { brut[o] = rr / cnt; brut[o + 1] = gg / cnt; brut[o + 2] = bb / cnt; }
        brut[o + 3] = sa / cnt;
      }
      var out = new Uint8ClampedArray(dl * dh * 4);
      for (var q = 0; q < out.length; q++) out[q] = Math.round(brut[q]);
      // couverture conservée, tuile par tuile, tant qu'une tuile a au moins 1 texel
      if (k <= nivMaxTuile) {
        var tk = tuile >> k;
        for (var ty2 = 0; ty2 < rowsT; ty2++) for (var tx2 = 0; tx2 < colsT; tx2++) {
          var it = ty2 * colsT + tx2;
          if (!decoupe[it]) continue;
          var alphas = [];
          for (var y2 = 0; y2 < tk; y2++) for (var x2 = 0; x2 < tk; x2++) alphas.push(brut[((ty2 * tk + y2) * dl + tx2 * tk + x2) * 4 + 3]);
          var echelle = echelleCouverture(alphas, couv0[it], seuil);
          if (echelle === 1) continue;
          for (var y3 = 0; y3 < tk; y3++) for (var x3 = 0; x3 < tk; x3++) {
            var j = ((ty2 * tk + y3) * dl + tx2 * tk + x3) * 4 + 3;
            out[j] = Math.round(Math.min(255, brut[j] * echelle));
          }
        }
      }
      niveaux.push({ width: dl, height: dh, data: out });
      src = brut; sl = dl; sh = dh;
    }
    return niveaux;
  }
  function couverture(alphas, echelle, seuil) {
    var n = 0;
    for (var i = 0; i < alphas.length; i++) if (Math.min(255, alphas[i] * echelle) >= seuil) n++;
    return n / alphas.length;
  }
  /* Facteur d'échelle de l'alpha qui rapproche le plus la couverture au
     seuil de la couverture visée (recherche dichotomique, la couverture
     croît avec l'échelle par paliers) ; 1 si l'écart est déjà minimal. La
     dichotomie encadre le palier de la cible : on garde celle des deux
     bornes dont la couverture en est la plus proche (en cas d'égalité,
     celle qui couvre le moins : ne pas épaissir une plante au loin). */
  function echelleCouverture(alphas, cible, seuil) {
    var pas = 1 / alphas.length;
    var c1 = couverture(alphas, 1, seuil);
    if (Math.abs(c1 - cible) < pas / 2) return 1;
    var lo = 0.05, hi = 16;
    for (var it = 0; it < 24; it++) {
      var mid = (lo + hi) / 2;
      if (couverture(alphas, mid, seuil) < cible) lo = mid; else hi = mid;
    }
    var ecLo = Math.abs(couverture(alphas, lo, seuil) - cible), ecHi = Math.abs(couverture(alphas, hi, seuil) - cible);
    var meilleur = ecLo <= ecHi ? lo : hi, ecart = Math.min(ecLo, ecHi);
    return ecart < Math.abs(c1 - cible) ? meilleur : 1;
  }

  MC.Qualite = {
    creerFenetre: creerFenetre, ajouterEchantillon: ajouterEchantillon, percentile: percentile,
    detecterRenduLogiciel: detecterRenduLogiciel,
    refractionFrequenceOK: refractionFrequenceOK, eauRefractanteVisible: eauRefractanteVisible,
    plafonnerDPR: plafonnerDPR, dprPlancher: dprPlancher, ajusterDPR: ajusterDPR,
    creerEtat: creerEtat, decisions: decisions, evaluer: evaluer,
    mesurerTick: mesurerTick, CHOIX_ANTIALIAS: CHOIX_ANTIALIAS, antialiasEffectif: antialiasEffectif,
    mipmapsAtlas: mipmapsAtlas,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MC.Qualite;
})(typeof globalThis !== 'undefined' ? globalThis : this);
