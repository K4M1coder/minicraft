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

  MC.Qualite = {
    creerFenetre: creerFenetre, ajouterEchantillon: ajouterEchantillon, percentile: percentile,
    detecterRenduLogiciel: detecterRenduLogiciel,
    refractionFrequenceOK: refractionFrequenceOK, eauRefractanteVisible: eauRefractanteVisible,
    plafonnerDPR: plafonnerDPR, dprPlancher: dprPlancher, ajusterDPR: ajusterDPR,
    creerEtat: creerEtat, decisions: decisions, evaluer: evaluer,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MC.Qualite;
})(typeof globalThis !== 'undefined' ? globalThis : this);
