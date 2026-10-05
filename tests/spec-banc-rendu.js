/* spec-banc-rendu.js — rendu reproductible, mouvements scriptés et triplets en
   boucle (SPEC-BANC-080, 082, 084, docs/banc/historique-global.md §3.7 et
   §3.8). Fichier Node seulement : le module de rendu (tests/rendu-repro.js) est
   chargé dans un contexte isolé avec un faux navigateur (horloge, rAF), et le
   panneau de l'historique dans le faux DOM de tests/aide-faux-dom.js. Le
   rendu RÉEL (pixels identiques d'une exécution à l'autre, poses de la caméra)
   est vérifié par les e2e de tests/e2e-banc.js. */
(function (G) {
  'use strict';
  var T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path'), vm = require('vm');
  var RACINE = path.join(__dirname, '..');
  var DOM = require(path.join(RACINE, 'tests', 'aide-faux-dom.js'));

  /* Le module de rendu dans un contexte isolé : `fenetre` joue window (rAF
     enregistrés, déclenchés à la main), `perf` joue performance. */
  function chargerRepro() {
    var ctx = vm.createContext({ Math: Object.create(Math), Object: Object, Array: Array, Error: Error, Number: Number, JSON: JSON, Date: Date, Promise: Promise });
    ctx.globalThis = ctx;
    vm.runInContext(fs.readFileSync(path.join(RACINE, 'tests', 'rendu-repro.js'), 'utf8'), ctx, { filename: 'rendu-repro.js' });
    return ctx.MC_REPRO;
  }
  function fauxNavigateur() {
    var f = { rappels: [], perf: { now: function () { return 123456; } } };
    f.fenetre = { requestAnimationFrame: function (cb) { f.rappels.push(cb); return f.rappels.length; }, cancelAnimationFrame: function () {} };
    f.Math = { random: function () { return 0.5; } };
    /* une « image réelle » : tous les rappels enregistrés reçoivent le même horodatage réel */
    f.image = function (reel) { var cbs = f.rappels; f.rappels = []; cbs.forEach(function (cb) { cb(reel); }); };
    return f;
  }

  describe('Specs — banc : rendu reproductible (SPEC-BANC-084)', function () {
    var R = chargerRepro();

    it('SPEC-BANC-084 : la scène par défaut fixe graine, heure, météo, orientation et une résolution de 1280×800', function () {
      var s = R.normaliserScene({});
      A.equal(s.graine, 20260921);
      A.equal(s.heure, 12);
      A.equal(s.meteo, 'clair');
      A.deep(s.resolution, [1280, 800]);
      A.equal(s.yaw, 0);
      A.equal(s.pitch, 0);
      var surcharge = R.normaliserScene({ heure: 18, yaw: 1 });
      A.equal(surcharge.heure, 18, 'une valeur donnée remplace le défaut');
      A.equal(surcharge.graine, 20260921, 'le reste garde le défaut');
    });

    it('SPEC-BANC-084 : une résolution sous 800×600 est refusée, jamais corrigée en silence', function () {
      A.throws(function () { R.normaliserScene({ resolution: [640, 480] }); }, '640×480');
      A.throws(function () { R.normaliserScene({ resolution: [800, 599] }); }, '800×599');
      A.throws(function () { R.normaliserScene({ resolution: [1280] }); }, 'liste incomplète');
      A.deep(R.normaliserScene({ resolution: [800, 600] }).resolution, [800, 600], '800×600 est le plancher accepté');
    });

    it('SPEC-BANC-084 : le générateur aléatoire est déterministe — même graine, même suite', function () {
      var a = R.alea(7), b = R.alea(7), c = R.alea(8);
      var sa = [a(), a(), a(), a()], sb = [b(), b(), b(), b()], sc = [c(), c(), c(), c()];
      A.deep(sa, sb, 'même graine : même suite');
      A.notEqual(JSON.stringify(sa), JSON.stringify(sc), 'autre graine : autre suite');
      sa.forEach(function (v) { A.ok(v >= 0 && v < 1, 'dans [0, 1)'); });
    });

    it('SPEC-BANC-084 : l\'horloge déterministe avance de 1/60 s par image réelle, rappels d\'une même image compris', function () {
      var f = fauxNavigateur();
      var h = R.creerHorloge({ window: f.fenetre, performance: f.perf, Math: f.Math });
      var vus = [];
      h.installer(3);
      A.equal(f.perf.now(), 0, 'performance.now est virtuelle');
      f.fenetre.requestAnimationFrame(function (t) { vus.push(['a', t]); });
      f.fenetre.requestAnimationFrame(function (t) { vus.push(['b', t]); });
      f.image(5000);                 // horodatage RÉEL quelconque
      A.close(vus[0][1], R.DT_MS, 1e-9, 'première image : 1/60 s');
      A.equal(vus[0][1], vus[1][1], 'deux rappels de la même image reçoivent le même horodatage');
      f.fenetre.requestAnimationFrame(function (t) { vus.push(['c', t]); });
      f.image(5123);                 // la durée réelle écoulée n'entre pas en compte
      A.close(vus[2][1], 2 * R.DT_MS, 1e-9, 'image suivante : 2/60 s, quelle que soit la durée réelle');
      A.close(f.perf.now(), 2 * R.DT_MS, 1e-9, 'performance.now suit');
      A.equal(h.images, 2);
      h.recaler(R.ORIGINE_HORLOGE_MS);
      f.fenetre.requestAnimationFrame(function (t) { vus.push(['d', t]); });
      f.image(9000);
      A.close(vus[3][1], R.ORIGINE_HORLOGE_MS + R.DT_MS, 1e-6, 'recalée : repart d\'une origine fixe, indépendante de ce qui a précédé');
      // Math.random est la suite déterministe de la graine
      var ref = R.alea(3);
      A.equal(f.Math.random(), ref(), 'Math.random déterministe');
      h.restaurer();
      A.equal(f.perf.now(), 123456, 'performance.now rétablie');
      A.equal(f.Math.random(), 0.5, 'Math.random rétabli');
      A.notOk(h.installee, 'horloge libérée');
    });

    it('SPEC-BANC-084 : trouverInstant() cherche un instant stable où le monde a la météo demandée, à l\'heure demandée', function () {
      var DC = { DAY_LENGTH: 1200 };
      var appels = [];
      var monde = { meteo: { etat: function (t) {
        appels.push(t);
        var jour = Math.floor(t / 1200);
        // le jour 3 est clair et stable ; le jour 1 est clair mais en fondu ; les autres sont couverts
        if (jour === 3) return { type: 'clair', fondu: 0 };
        if (jour === 1) return { type: 'clair', fondu: 0.4 };
        return { type: 'couvert', fondu: 0 };
      } } };
      var t = R.trouverInstant(monde, DC, 12, 'clair');
      A.equal(t, 3 * 1200 + 600, 'midi du premier jour clair ET stable (le fondu du jour 1 est écarté)');
      A.equal(R.trouverInstant(monde, DC, 12, 'tempete', 10), null, 'aucun instant : null');
      A.equal(R.trouverInstant({ meteo: null }, DC, 6, 'clair'), 1200 + 300, 'monde sans météo : le premier jour, à l\'heure demandée');
    });

    it('SPEC-BANC-084 : comparer() distingue des captures identiques de captures différentes ; la tolérance est négligeable et documentée', function () {
      var a = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
      var b = new Uint8Array(a);
      var egal = R.comparer(a, b);
      A.ok(egal.identiques && egal.moyen === 0 && egal.pixelsDifferents === 0, 'identiques');
      A.ok(R.negligeable(egal));
      var c = new Uint8Array(a); c[0] = 13;
      var proche = R.comparer(a, c);
      A.equal(proche.pixelsDifferents, 1);
      A.ok(proche.max <= R.TOLERANCE.max, 'un écart d\'un canal de 3 sur un pixel : sous le maximum toléré');
      A.ok(!R.comparer(a, new Uint8Array([200, 20, 30, 255, 40, 50, 60, 255])).identiques, 'un pixel très différent');
      A.notOk(R.negligeable(R.comparer(a, new Uint8Array([200, 20, 30, 255, 40, 50, 60, 255]))), 'au-delà de la tolérance');
      A.notOk(R.comparer(a, new Uint8Array(4)).identiques, 'tailles différentes : jamais identiques');
      A.equal(R.TOLERANCE.moyen, 0.05);
    });

    it('SPEC-BANC-084 : le moteur applique la scène aux tests étiquetés rendu avant leur corps (tests/e2e.js)', function () {
      var e2e = fs.readFileSync(path.join(RACINE, 'tests', 'e2e.js'), 'utf8');
      A.ok(/etiquettes\.indexOf\('rendu'\)/.test(e2e) && /MC_REPRO\.fixer\(/.test(e2e), 'runUnE2E fixe la scène des tests étiquetés rendu');
      A.ok(/sceneEtat\.restaurer\(\)/.test(e2e), 'et la libère à la fin du test');
      var page = fs.readFileSync(path.join(RACINE, 'tests', 'index.html'), 'utf8');
      A.ok(page.indexOf("'rendu-repro.js', 'e2e.js'") >= 0, 'rendu-repro.js est chargé avant e2e.js');
    });
  });

  describe('Specs — banc : mouvements scriptés (SPEC-BANC-082)', function () {
    var R = chargerRepro();

    it('SPEC-BANC-082 : deux mouvements documentés — rotation à 30 deg/s, déplacement à 4 blocs/s — avec leur unité', function () {
      A.equal(R.MOUVEMENTS.rotation.vitesse, 30);
      A.equal(R.MOUVEMENTS.rotation.unite, 'deg/s');
      A.equal(R.MOUVEMENTS.deplacement.vitesse, 4);
      A.equal(R.MOUVEMENTS.deplacement.unite, 'blocs/s');
      A.ok(R.MOUVEMENTS.rotation.description.length > 10 && R.MOUVEMENTS.deplacement.description.length > 10, 'décrits en clair');
    });

    it('SPEC-BANC-082 : le pas d\'une image est vitesse × 1/60 s — 0,5 degré de lacet, ou 1/15 de bloc le long du cap', function () {
      var r = R.pasMouvement({ type: 'rotation' }, 0);
      A.close(r.dyaw * 180 / Math.PI, 0.5, 1e-9, 'rotation : 0,5 degré par image');
      A.equal(r.dx, 0);
      var d = R.pasMouvement({ type: 'deplacement' }, 0);
      A.close(Math.hypot(d.dx, d.dz), 4 / 60, 1e-9, 'déplacement : 1/15 de bloc par image');
      A.close(d.dz, -4 / 60, 1e-9, 'à lacet 0, le jeu regarde vers -z');
      var est = R.pasMouvement({ type: 'deplacement' }, Math.PI / 2);
      A.close(est.dx, -4 / 60, 1e-9, 'le déplacement suit le cap');
      A.close(R.pasMouvement({ type: 'rotation', vitesse: 60 }, 0).dyaw * 180 / Math.PI, 1, 1e-9, 'vitesse choisie');
      A.throws(function () { R.pasMouvement({ type: 'secousse' }, 0); }, 'mouvement inconnu');
      A.throws(function () { R.pasMouvement({ type: 'constructor' }, 0); }, 'propriété héritée');
      A.throws(function () { R.pasMouvement(null, 0); }, 'mouvement absent');
    });

    it('SPEC-BANC-082 : la pose de l\'image i est pose0 + i × pas, absolue — identique d\'un run à l\'autre', function () {
      var pose0 = { x: 10, y: 64, z: -3, yaw: 0.25, pitch: -0.1 };
      var a = [0, 1, 2].map(function (i) { return R.poseALImage(pose0, { type: 'rotation' }, i); });
      var b = [0, 1, 2].map(function (i) { return R.poseALImage(pose0, { type: 'rotation' }, i); });
      A.deep(a, b, 'reproductible');
      A.deep(a[0], pose0, 'l\'image 0 est la pose de départ');
      A.close(a[2].yaw - a[1].yaw, a[1].yaw - a[0].yaw, 1e-12, 'pas constant');
      A.equal(a[2].x, 10, 'une rotation ne déplace pas');
      var d = R.poseALImage(pose0, { type: 'deplacement' }, 2);
      A.equal(d.yaw, 0.25, 'un déplacement ne tourne pas');
      A.equal(d.y, 64, 'ni ne monte');
      A.close(Math.hypot(d.x - 10, d.z + 3), 2 * 4 / 60, 1e-9, 'deux pas');
    });

    it('SPEC-BANC-082 : decrire() consigne le type, la vitesse, l\'unité et la durée d\'une image', function () {
      A.deep(R.decrire({ type: 'rotation' }), { type: 'rotation', vitesse: 30, unite: 'deg/s', dt_ms: 1000 / 60 });
      A.equal(R.decrire({ type: 'deplacement', vitesse: 2 }).vitesse, 2, 'vitesse choisie');
    });

    it('SPEC-BANC-082 : T.etape accepte un mouvement et le triplet de l\'étape le suit (tests/e2e.js)', function () {
      var e2e = fs.readFileSync(path.join(RACINE, 'tests', 'e2e.js'), 'utf8');
      A.ok(/T\.etape = function \(nom, opts\)/.test(e2e), 'T.etape(nom, { mouvement })');
      A.ok(/capturerTriplet\(g, nomEtape, bord, mouvement\)/.test(e2e), 'le triplet reçoit le mouvement');
      A.ok(/poseALImage\(pose0, mouvement, i\)/.test(e2e), 'chaque image du triplet est posée à pose0 + i × pas');
    });
  });

  describe('Specs — banc : les triplets d\'une étape se lisent en boucle dans l\'historique (SPEC-BANC-080)', function () {
    function triplet(etape, bord, rangs) {
      return rangs.map(function (r) {
        return { role: 'triplet', etape: etape, bord: bord, rang: r, libelle: etape + '-' + bord + '-' + r, image: 'img-' + etape + '-' + bord + '-' + r + '.jpg' };
      });
    }
    function fauxPanneau(images, minuteurs) {
      return DOM.fauxDom(function (url) { return /\/images\?/.test(url) ? { images: images } : { lignes: [], total: 0, effectifs: {} }; }, {
        avant: function (ctx) {
          ctx.setInterval = function (fn, ms) { minuteurs.push({ fn: fn, ms: ms, arrete: false }); return minuteurs.length; };
          ctx.clearInterval = function (id) { if (minuteurs[id - 1]) minuteurs[id - 1].arrete = true; };
        },
      });
    }

    it('SPEC-BANC-080 : grouperTriplets() identifie un triplet par (étape, bord) et ordonne ses images par rang', function () {
      var d = DOM.fauxDom(function () { return { lignes: [], total: 0, effectifs: {} }; });
      var caps = [{ role: 'debut', libelle: 'début', image: 'a.jpg' }]
        .concat(triplet('marche', 'debut', [2, 0, 1]), triplet('marche', 'fin', [1]), triplet('course', 'debut', [0, 1, 2]));
      var g = d.H.grouperTriplets(caps);
      A.equal(g.autres.length, 1, 'l\'image ordinaire reste à part');
      A.equal(g.triplets.length, 3, 'trois triplets : marche/début, marche/fin, course/début');
      var marche = g.triplets.filter(function (t) { return t.etape === 'marche' && t.bord === 'debut'; })[0];
      A.deep(marche.images.map(function (c) { return c.rang; }), [0, 1, 2], 'images triées par rang');
      A.deep(d.H.grouperTriplets(null), { autres: [], triplets: [] }, 'entrée absente');
    });

    it('SPEC-BANC-080 : la vignette d\'un triplet lit ses trois images en boucle rapide, image par image', function () {
      var minuteurs = [];
      var images = [{ run: 'r1', debut_run: '2026-01-01T00:00:00.000Z', etat: 'reussi', duree_ms: 10, inscrit: true, preset: 'pr', commit_court: 'aaa', cle: 'G › t', nom: 't',
        captures: triplet('marche', 'debut', [0, 1, 2]).map(function (c, i) { c.image = String(i + 1).repeat(40) + '.jpg'; return c; }) }];
      var d = fauxPanneau(images, minuteurs);
      d.H.ouvrirTest({ cle: 'G › t', nom: 't', run: 'r1' });
      var p = d.obtenir('hist-panneau-test');
      var imgs = p.tous(function (n) { return n.tagName === 'IMG'; });
      A.equal(imgs.length, 1, 'UNE vignette pour le triplet (pas trois images séparées)');
      var img = imgs[0];
      A.equal(img.attrs['data-boucle'], '3', 'trois images en boucle');
      var attendues = ['1', '2', '3'].map(function (c) { return '/tests/registre/images/' + c.repeat(40) + '.jpg'; });
      A.equal(img.attrs.src, attendues[0], 'commence par le rang 0');
      A.equal(minuteurs.length, 1, 'un minuteur de clignotement');
      A.equal(minuteurs[0].ms, d.H.CADENCE_CLIGNOTEMENT_MS, 'cadence rapide documentée');
      A.ok(minuteurs[0].ms <= 200, 'assez rapide pour qu\'un scintillement saute aux yeux (' + minuteurs[0].ms + ' ms)');
      var vus = [];
      for (var i = 0; i < 6; i++) { minuteurs[0].fn(); vus.push(img.attrs.src); }
      A.deep(vus, [attendues[1], attendues[2], attendues[0], attendues[1], attendues[2], attendues[0]], 'rang 1, 2, 0, 1, 2, 0 : en boucle, image par image');
      // fermer le panneau arrête la boucle
      d.H.fermer();
      A.ok(minuteurs[0].arrete, 'la boucle s\'arrête à la fermeture du panneau');
    });

    it('SPEC-BANC-080 : un triplet dont le registre ne garde que l\'image centrale reste une vignette fixe, sans minuteur', function () {
      var minuteurs = [];
      var caps = triplet('marche', 'fin', [0, 1, 2]);
      caps[0].image = null; caps[2].image = null; caps[1].image = 'c'.repeat(40) + '.jpg';
      var d = fauxPanneau([{ run: 'r1', debut_run: '2026-01-01T00:00:00.000Z', etat: 'reussi', inscrit: true, cle: 'G › t', nom: 't', captures: caps }], minuteurs);
      d.H.ouvrirTest({ cle: 'G › t', nom: 't', run: 'r1' });
      var p = d.obtenir('hist-panneau-test');
      var imgs = p.tous(function (n) { return n.tagName === 'IMG'; });
      A.equal(imgs.length, 1);
      A.equal(imgs[0].attrs['data-boucle'], '1');
      A.equal(minuteurs.length, 0, 'une seule image : rien à faire clignoter');
      A.ok(/2 image\(s\) de triplet non conservée/.test(p.textContent), 'les deux autres images sont « non conservées », pas « manquantes »');
    });

    it('SPEC-BANC-080 : rouvrir le panneau d\'un autre test arrête les boucles du précédent (aucun minuteur orphelin)', function () {
      var minuteurs = [];
      var imgs3 = triplet('e', 'debut', [0, 1, 2]);
      var d = fauxPanneau([{ run: 'r1', debut_run: '2026-01-01T00:00:00.000Z', etat: 'reussi', inscrit: true, cle: 'G › t', nom: 't', captures: imgs3.map(function (c, i) { c.image = String(i + 4).repeat(40) + '.jpg'; return c; }) }], minuteurs);
      d.H.ouvrirTest({ cle: 'G › t', nom: 't', run: 'r1' });
      d.H.ouvrirTest({ cle: 'G › t', nom: 't', run: 'r1' });
      A.equal(minuteurs.length, 2, 'deux ouvertures, deux minuteurs créés');
      A.ok(minuteurs[0].arrete, 'le premier est arrêté dès la seconde ouverture');
      A.notOk(minuteurs[1].arrete, 'le second tourne');
      d.H.arreterBoucles();
      A.ok(minuteurs[1].arrete, 'arreterBoucles() les arrête tous');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
