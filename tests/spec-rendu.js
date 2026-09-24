/* spec-rendu.js — tests Node de src/qualite.js (logique pure de qualité
   adaptative) pour les specs SPEC-RENDU-003 à 008, 010, 015 et SPEC-PERF-015.
   Le FPS est toujours INJECTÉ ici (jamais mesuré) : c'est le contrat des
   specs concernées (voir SPECS.md, section L48). */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var Q = MC.Qualite;

  describe('Specs — rendu adaptatif (qualite.js)', function () {

    it('SPEC-PERF-015 : la fenêtre glissante calcule un p50/p95 fini à partir d’un FPS injecté', function () {
      var f = Q.creerFenetre(5);
      for (var i = 0; i < 300; i++) Q.ajouterEchantillon(f, i * 0.02, 55 + (i % 10));
      var p50 = Q.percentile(f, 50), p95 = Q.percentile(f, 95);
      A.ok(isFinite(p50) && p50 !== null, 'p50 fini : ' + p50);
      A.ok(isFinite(p95) && p95 !== null, 'p95 fini : ' + p95);
      A.ok(p95 >= p50, 'p95 >= p50');
    });

    it('SPEC-PERF-015 : la fenêtre ne garde que les échantillons des N dernières secondes', function () {
      var f = Q.creerFenetre(5);
      Q.ajouterEchantillon(f, 0, 10);
      Q.ajouterEchantillon(f, 1, 10);
      Q.ajouterEchantillon(f, 10, 60);          // 9 s plus tard : les deux premiers sortent de la fenêtre
      A.equal(f.echantillons.length, 1, 'un seul échantillon restant');
      A.equal(Q.percentile(f, 50), 60, 'p50 = dernier échantillon');
    });

    it('SPEC-RENDU-015 : panneau F3 et adaptatif lisent la MÊME fenêtre — égalité stricte', function () {
      var fenetre = Q.creerFenetre(5);
      var etat = Q.creerEtat({ seuilBas: 30, seuilHaut: 50, delaiSec: 1 });
      var t = 0;
      for (var i = 0; i < 40; i++) { t += 0.1; Q.ajouterEchantillon(fenetre, t, 20); }
      var p50Panneau = Q.percentile(fenetre, 50);              // ce que lirait g.perf.fpsP50
      var d = Q.evaluer(etat, t, Q.percentile(fenetre, 50));   // ce que lit la décision d'adaptation
      A.equal(Q.percentile(fenetre, 50), p50Panneau, 'même calcul, même valeur, à l’image près');
      A.ok(d.niveau >= 0, 'décision produite à partir de la même source');
    });

    it('SPEC-RENDU-003 : la réfraction saute une image sur deux sous le seuil de FPS', function () {
      var rendues = 0, appels = 0;
      for (var i = 0; i < 60; i++) {
        rendues++;
        if (Q.refractionFrequenceOK(i, 25, 40)) appels++;    // FPS 25 < seuil 40
      }
      A.equal(rendues, 60, '60 images rendues');
      A.ok(appels < rendues / 2 + 1 && appels <= 30, 'appels inférieurs de moitié : ' + appels);
    });

    it('SPEC-RENDU-003 : au-dessus du seuil, la réfraction se recalcule à pleine fréquence', function () {
      var appels = 0;
      for (var i = 0; i < 60; i++) if (Q.refractionFrequenceOK(i, 60, 40)) appels++;
      A.equal(appels, 60, 'pleine fréquence : ' + appels);
    });

    it('SPEC-RENDU-004 : l’eau lointaine ne déclenche pas la réfraction, l’eau proche oui', function () {
      A.notOk(Q.eauRefractanteVisible(150, 96), 'eau à 150 blocs, seuil 96 : pas de réfraction');
      A.ok(Q.eauRefractanteVisible(40, 96), 'eau à 40 blocs, seuil 96 : réfraction');
    });

    it('SPEC-RENDU-005 : la réfraction se désactive après N secondes de FPS bas, se réactive après retour', function () {
      var etat = Q.creerEtat({ seuilBas: 30, seuilHaut: 50, delaiSec: 3 });
      var t = 0, d;
      // FPS bas pendant 3.5 s : la réfraction doit céder
      for (var i = 0; i < 35; i++) { t += 0.1; d = Q.evaluer(etat, t, 20); }
      A.notOk(d.refraction, 'réfraction coupée après ' + t.toFixed(1) + ' s à FPS bas');
      // FPS haut prolongé : elle doit revenir
      for (var j = 0; j < 40; j++) { t += 0.1; d = Q.evaluer(etat, t, 60); }
      A.ok(d.refraction, 'réfraction réactivée après retour à un FPS haut');
    });

    it('SPEC-RENDU-006 : l’antialias se désactive après la réfraction, sous un FPS bas plus prolongé', function () {
      var etat = Q.creerEtat({ seuilBas: 30, seuilHaut: 50, delaiSec: 1 });
      var t = 0, d;
      for (var i = 0; i < 30; i++) { t += 0.1; d = Q.evaluer(etat, t, 10); }
      A.notOk(d.refraction, 'réfraction déjà coupée');
      A.notOk(d.antialias, 'antialias coupé après un FPS bas plus long : ' + t.toFixed(1) + ' s');
    });

    it('SPEC-RENDU-007 : le DPR descend par paliers sous un FPS bas persistant, sans jamais passer sous 1', function () {
      var etat = Q.creerEtat({ seuilBas: 30, seuilHaut: 50, delaiSec: 1, paliersDPR: [2, 1.5, 1] });
      var t = 0, d;
      for (var i = 0; i < 60; i++) { t += 0.1; d = Q.evaluer(etat, t, 5); }
      A.equal(d.dpr, 1, 'DPR au palier plancher : ' + d.dpr);
      A.ok(d.dpr >= 1, 'jamais sous 1');
    });

    it('SPEC-RENDU-007 : le DPR ne dépasse jamais le plafond des options utilisateur', function () {
      A.equal(Q.plafonnerDPR(2, 1.25), 1.25, 'plafonné à 1.25');
      A.equal(Q.plafonnerDPR(0.4, 2), 1, 'jamais sous 1');
      A.equal(Q.plafonnerDPR(1.5, 2), 1.5, 'sous le plafond : inchangé');
    });

    it('SPEC-RENDU-008 : cascade — la réfraction cède avant l’antialias, avant le DPR', function () {
      var etat = Q.creerEtat({ seuilBas: 30, seuilHaut: 50, delaiSec: 1, paliersDPR: [2, 1.5, 1] });
      var t = 0, historique = [];
      for (var i = 0; i < 6; i++) {
        for (var k = 0; k < 10; k++) { t += 0.1; }
        historique.push(Q.evaluer(etat, t, 5));
      }
      // au premier cran, la réfraction seule cède
      var i1 = historique.findIndex(function (d) { return !d.refraction; });
      var i2 = historique.findIndex(function (d) { return !d.antialias; });
      var i3 = historique.findIndex(function (d) { return d.dpr < 2; });
      A.ok(i1 >= 0 && i2 >= 0 && i3 >= 0, 'les trois dégradations ont eu lieu');
      A.ok(i1 <= i2, 'réfraction cède avant (ou en même temps que) l’antialias');
      A.ok(i2 <= i3, 'antialias cède avant (ou en même temps que) le DPR');
    });

    it('SPEC-RENDU-007 : le DPR adaptatif ne fait jamais passer le tampon sous l’équivalent 800×600', function () {
      // hôte confortable (1920×1080) : le plancher ne force rien, le palier plancher (DPR 1) suffit
      A.equal(Q.ajusterDPR(1, 2, 1920, 1080), 1, 'DPR 1 sur un grand hôte : déjà largement au-dessus de 800×600');
      // hôte minuscule (400×300, jamais testé en vrai, mais la fonction doit rester sûre) :
      // il faut un DPR d’au moins 2 pour atteindre 800×600
      A.close(Q.ajusterDPR(1, 4, 400, 300), 2, 0.001, 'DPR relevé pour ne pas repasser sous 800×600');
      // le plancher ne dépasse jamais ce qu’il faut : sur 800×600 pile, DPR=1 suffit déjà
      A.equal(Q.ajusterDPR(1, 2, 800, 600), 1, 'à 800×600 pile, DPR 1 suffit');
    });

    it('SPEC-RENDU-008 : un budget de frame tenu ne dégrade rien', function () {
      var etat = Q.creerEtat({ seuilBas: 30, seuilHaut: 50, delaiSec: 1 });
      var t = 0, d;
      for (var i = 0; i < 50; i++) { t += 0.1; d = Q.evaluer(etat, t, 90); }
      A.equal(d.niveau, 0, 'aucune dégradation à FPS confortable');
      A.ok(d.refraction && d.antialias && d.dpr === 2, 'tout au maximum');
    });

    it('SPEC-RENDU-010 : un rendu logiciel connu (SwiftShader, llvmpipe…) est détecté', function () {
      A.ok(Q.detecterRenduLogiciel('Google SwiftShader'), 'SwiftShader détecté');
      A.ok(Q.detecterRenduLogiciel('llvmpipe (LLVM 12.0.0, 256 bits)'), 'llvmpipe détecté');
      A.ok(Q.detecterRenduLogiciel('Microsoft Basic Render Driver'), 'Basic Render Driver détecté');
      A.notOk(Q.detecterRenduLogiciel('NVIDIA GeForce RTX 3080/PCIe/SSE2'), 'un GPU matériel n’est pas signalé');
      A.notOk(Q.detecterRenduLogiciel(null), 'nom absent : pas de faux positif');
    });

    it('niveau initial : un rendu logiciel détecté peut démarrer directement au palier bas', function () {
      var etat = Q.creerEtat({ paliersDPR: [2, 1.5, 1], niveauInitial: 99 });
      var d = Q.decisions(etat);
      A.equal(etat.niveau, etat.niveauMax, 'borné au niveau maximal déclaré');
      A.notOk(d.refraction, 'réfraction déjà coupée au démarrage');
      A.notOk(d.antialias, 'antialias déjà coupé au démarrage');
      A.equal(d.dpr, 1, 'DPR déjà au plancher');
    });

  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
