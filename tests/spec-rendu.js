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

    it('SPEC-RENDU-015 : mesurerTick — le p50 affiché (panneau F3) est celui sur lequel l’adaptation décide, pas le FPS instantané', function () {
      var fenetre = Q.creerFenetre(5);
      var etat = Q.creerEtat({ seuilBas: 30, seuilHaut: 50, delaiSec: 3 });
      var t = 0, m;
      for (var i = 0; i < 8; i++) { t += 0.4; m = Q.mesurerTick(fenetre, etat, t, 40); }
      t += 0.4; m = Q.mesurerTick(fenetre, etat, t, 10);        // une image lente isolée
      A.equal(m.fps, 10, 'FPS instantané du tick');
      A.equal(m.p50, 40, 'p50 de la fenêtre (ce que montre le panneau F3)');
      A.equal(m.decisions.fpsP50, m.p50, 'la décision porte la valeur exacte qu’elle a lue : la même');
      A.ok(m.p95 >= m.p50, 'p95 du même calcul');
    });

    it('SPEC-RENDU-006 : antialiasEffectif — « auto » suit l’adaptatif, « oui » le réactive à la main, « non » le coupe', function () {
      A.equal(Q.antialiasEffectif('auto', true), true);
      A.equal(Q.antialiasEffectif('auto', false), false, 'auto : coupé quand le FPS l’a coupé');
      A.equal(Q.antialiasEffectif('oui', false), true, 'réactivé manuellement malgré un FPS bas');
      A.equal(Q.antialiasEffectif('non', true), false, 'coupé manuellement');
      A.equal(Q.antialiasEffectif(undefined, true), true, 'option absente (ancien stockage) : auto');
      A.ok(Q.CHOIX_ANTIALIAS.indexOf('auto') === 0, 'auto est le premier choix (défaut)');
    });

    it('SPEC-RENDU-006 : un FPS bas prolongé coupe l’antialias en « auto », un FPS haut restauré le rend', function () {
      var fenetre = Q.creerFenetre(5);
      var etat = Q.creerEtat({ seuilBas: 30, seuilHaut: 50, delaiSec: 3 });
      var t = 0, m;
      for (var i = 0; i < 30; i++) { t += 0.4; m = Q.mesurerTick(fenetre, etat, t, 12); }
      A.notOk(Q.antialiasEffectif('auto', m.decisions.antialias), 'coupé après ' + t.toFixed(1) + ' s sous le seuil');
      A.ok(Q.antialiasEffectif('oui', m.decisions.antialias), 'le réglage manuel le réactive');
      for (var j = 0; j < 60; j++) { t += 0.4; m = Q.mesurerTick(fenetre, etat, t, 60); }
      A.ok(Q.antialiasEffectif('auto', m.decisions.antialias), 'rendu après retour à un FPS haut');
    });

    // atlas synthétique 2×2 tuiles de 4 texels : couleurs franches distinctes
    function atlasSynthetique() {
      var L = 8, H = 8, T = 4, data = new Uint8ClampedArray(L * H * 4);
      var couleurs = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [40, 160, 40]];
      for (var y = 0; y < H; y++) for (var x = 0; x < L; x++) {
        var t = ((y / T) | 0) * 2 + ((x / T) | 0), k = (y * L + x) * 4, c = couleurs[t];
        data[k] = c[0]; data[k + 1] = c[1]; data[k + 2] = c[2]; data[k + 3] = 255;
        // tuile 3 : « feuillage » — un texel sur deux transparent (rgb nul, comme un canvas)
        if (t === 3 && (x + y) % 2) { data[k] = data[k + 1] = data[k + 2] = 0; data[k + 3] = 0; }
      }
      return { data: data, L: L, H: H, T: T, couleurs: couleurs };
    }
    it('SPEC-RENDU-012 : mipmapsAtlas — aucune tuile ne déborde sur sa voisine tant qu’elle fait au moins un texel', function () {
      var a = atlasSynthetique();
      var niv = Q.mipmapsAtlas(a.data, a.L, a.H, a.T, 0.5, [3]);
      A.equal(niv.length, 3, 'niveaux 4×4, 2×2, 1×1');
      A.equal(niv[0].width, 4); A.equal(niv[2].width, 1);
      // niveaux 1 (tuile 2 texels) et 2 (tuile 1 texel) : chaque tuile garde sa couleur pure
      [0, 1].forEach(function (k) {
        var n = niv[k], tk = a.T >> (k + 1);
        for (var y = 0; y < n.height; y++) for (var x = 0; x < n.width; x++) {
          var t = ((y / tk) | 0) * 2 + ((x / tk) | 0), c = a.couleurs[t], o = (y * n.width + x) * 4;
          A.equal(n.data[o] + ',' + n.data[o + 1] + ',' + n.data[o + 2], c.join(','),
            'niveau ' + (k + 1) + ' texel ' + x + ',' + y + ' : couleur de sa tuile seule');
        }
      });
    });

    it('SPEC-RENDU-012 : mipmapsAtlas — un feuillage troué ne s’assombrit pas au loin', function () {
      var a = atlasSynthetique();
      var n1 = Q.mipmapsAtlas(a.data, a.L, a.H, a.T, 0.5, [3])[0];
      // tuile 3 au niveau 1 : texels (2..3, 2..3)
      for (var y = 2; y < 4; y++) for (var x = 2; x < 4; x++) {
        var o = (y * n1.width + x) * 4;
        A.equal(n1.data[o] + ',' + n1.data[o + 1] + ',' + n1.data[o + 2], '40,160,40', 'couleur du feuillage, pas assombrie');
      }
    });

    /* Atlas 16×16 de 2×2 tuiles de 8 texels (16 texels par tuile au niveau
       1 : un pas de couverture = 1/16). Tuile 0 : quatre blocs 2×2 portant
       chacun 3 texels d'alpha 160 (au-dessus du seuil 127,5 au niveau 0,
       moyenne 120 en dessous au niveau 1). Tuile 1 : cinq texels isolés
       opaques (moyenne 63,75 au niveau 1). */
    function atlasCouverture() {
      var L = 16, T = 8, data = new Uint8ClampedArray(L * L * 4);
      function pose(tuile, x, y, a) {
        var k = (((tuile >> 1) * T + y) * L + (tuile & 1) * T + x) * 4;
        data[k] = 50; data[k + 1] = 150; data[k + 2] = 50; data[k + 3] = a;
      }
      [[0, 0], [4, 0], [0, 4], [4, 4]].forEach(function (b) {
        pose(0, b[0], b[1], 160); pose(0, b[0] + 1, b[1], 160); pose(0, b[0], b[1] + 1, 160);
      });
      [[0, 0], [2, 0], [4, 2], [6, 4], [2, 6]].forEach(function (p) { pose(1, p[0], p[1], 255); });
      return { data: data, L: L, T: T };
    }
    function couvertureTuile(niv, tuile, tk) {
      var n = 0;
      for (var y = 0; y < tk; y++) for (var x = 0; x < tk; x++)
        if (niv.data[(((tuile >> 1) * tk + y) * niv.width + (tuile & 1) * tk + x) * 4 + 3] >= 127.5) n++;
      return n / (tk * tk);
    }
    it('SPEC-RENDU-012 : mipmapsAtlas — une tuile à découpe garde sa couverture au seuil d’alphaTest, au pas près, sans jamais s’épaissir', function () {
      var a = atlasCouverture(), pas = 1 / 16;
      var n1 = Q.mipmapsAtlas(a.data, a.L, a.L, a.T, 0.5, [0, 1])[0];
      // tuile 0 : 12/64 = 0,1875 au niveau 0 ; sans conservation, 0 au niveau 1 (la plante disparaît)
      var c0 = couvertureTuile(n1, 0, 4);
      A.ok(Math.abs(c0 - 0.1875) <= pas, 'tuile 0 : couverture ' + c0 + ' ≈ 0,1875 (à un pas près)');
      // tuile 1 : 5/64 ≈ 0,078 ; la remise à l'échelle donnerait 5/16 : plus loin de la cible que 0
      var c1 = couvertureTuile(n1, 1, 4);
      A.ok(c1 <= 5 / 64 + pas, 'tuile 1 : couverture ' + c1 + ' ≤ 0,078 + un pas (pas d’épaississement)');
    });

    it('SPEC-RENDU-012 : mipmapsAtlas — une tuile hors découpe (fondu : verre, eau) garde son alpha moyen, sans remise à l’échelle', function () {
      var a = atlasCouverture();
      var niv = Q.mipmapsAtlas(a.data, a.L, a.L, a.T, 0.5, []);
      // tuile 0 hors découpe : moyenne exacte (3 × 160 / 4 = 120) sur chaque bloc
      A.equal(niv[0].data[3], 120, 'niveau 1 : alpha moyen 120, non rééchelonné');
      var somme0 = 0, somme2 = 0;
      for (var y = 0; y < 8; y++) for (var x = 0; x < 8; x++) somme0 += a.data[(y * 16 + x) * 4 + 3];
      for (var y2 = 0; y2 < 2; y2++) for (var x2 = 0; x2 < 2; x2++) somme2 += niv[1].data[(y2 * 4 + x2) * 4 + 3];
      A.ok(Math.abs(somme0 / 64 - somme2 / 4) <= 1, 'niveau 2 : même alpha moyen qu’au niveau 0 (' + somme0 / 64 + ' / ' + somme2 / 4 + ')');
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

    it('SPEC-RENDU-011 : niveau initial — un rendu logiciel détecté peut démarrer directement au palier bas', function () {
      var etat = Q.creerEtat({ paliersDPR: [2, 1.5, 1], niveauInitial: 99 });
      var d = Q.decisions(etat);
      A.equal(etat.niveau, etat.niveauMax, 'borné au niveau maximal déclaré');
      A.notOk(d.refraction, 'réfraction déjà coupée au démarrage');
      A.notOk(d.antialias, 'antialias déjà coupé au démarrage');
      A.equal(d.dpr, 1, 'DPR déjà au plancher');
    });

    // ── SPEC-RENDU-014 : culling grossier d'occlusion (logique pure, lointain.js) ──
    // Le test réel (visibilité des maillages de chunk dans le vrai renderer)
    // vit en e2e (tests/e2e.js) ; ici, le principe géométrique lui-même —
    // « un mur de relief plein devant une colonne l'occlut, une colonne à
    // découvert ne l'est jamais » — est vérifié à froid, sans THREE ni DOM.
    var LO = MC.Lointain;
    it('SPEC-RENDU-014 : une colonne cachée derrière un mur de relief plein est occluse', function () {
      // un mur (hauteur 40) à 30 blocs de la caméra, la cible à 100 blocs,
      // droit derrière le mur, largement plus bas que lui
      function mur(x, z) { return x > 25 && x < 35 ? 40 : 5; }
      var cam = { x: 0, y: 6, z: 0 };
      var occlus = LO.occlusionColonne(mur, cam, 100, 0, 6, { pas: 8 });
      A.ok(occlus, 'la colonne derrière le mur est occluse');
    });

    it('SPEC-RENDU-014 : une colonne à découvert (pas de relief intermédiaire) n’est jamais occluse', function () {
      function plat(x, z) { return 5; }
      var cam = { x: 0, y: 6, z: 0 };
      var occlus = LO.occlusionColonne(plat, cam, 100, 0, 6, { pas: 8 });
      A.notOk(occlus, 'terrain plat : rien ne masque la colonne');
    });

    it('SPEC-RENDU-014 : une colonne trop proche de la caméra n’est jamais occluse (jamais son propre chunk)', function () {
      function mur(x, z) { return 40; }   // un relief très haut partout, y compris tout près
      var cam = { x: 0, y: 6, z: 0 };
      var occlus = LO.occlusionColonne(mur, cam, 5, 0, 6, { pas: 8 });
      A.notOk(occlus, 'une colonne à 5 blocs (sous le pas d’échantillonnage) reste toujours visible');
    });

    it('SPEC-RENDU-014 : plusieurs colonnes alignées derrière un mur plein sont TOUTES occluses, celles devant ne le sont pas', function () {
      function mur(x, z) { return x > 25 && x < 35 ? 50 : 5; }
      var cam = { x: 0, y: 6, z: 0 };
      var devant = [10, 15, 20].map(function (x) { return LO.occlusionColonne(mur, cam, x, 0, 6, { pas: 8 }); });
      var derriere = [50, 70, 90, 110].map(function (x) { return LO.occlusionColonne(mur, cam, x, 0, 6, { pas: 8 }); });
      A.ok(devant.every(function (v) { return !v; }), 'aucune colonne avant le mur n’est occluse : ' + devant);
      A.ok(derriere.every(function (v) { return v; }), 'toutes les colonnes derrière le mur sont occluses : ' + derriere);
    });

    it('SPEC-RENDU-014 : sans donnée de hauteur exploitable (null), pas de faux positif', function () {
      function inconnue() { return null; }
      var cam = { x: 0, y: 6, z: 0 };
      A.notOk(LO.occlusionColonne(inconnue, cam, 100, 0, 6, { pas: 8 }), 'hauteur inconnue : jamais occluse (repli sûr)');
    });

  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
