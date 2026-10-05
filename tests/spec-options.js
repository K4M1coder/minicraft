/* spec-options.js — tests des specs SPEC-OPTION-001 et 003 : réglages et touches. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var O = MC.Options;

  function stockage() {
    var m = {};
    return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, m: m };
  }

  describe('Specs — options', function () {
    it('SPEC-OPTION-001 : chaque réglage a son défaut et ses bornes, et se conserve', function () {
      var d = O.defauts();
      ['sensibilite', 'volume', 'champ', 'vueMax', 'realiste', 'ombres'].forEach(function (k) {
        A.ok(k in d, 'réglage ' + k);
      });
      A.equal(d.champ, 72); A.equal(d.vueMax, 18); A.equal(d.ombres, true);
      A.equal(O.valeur('volume', 3), 1, 'borné en haut');
      A.equal(O.valeur('champ', 10), 50, 'borné en bas');
      A.equal(O.valeur('sensibilite', 0.3000001), 0.3, 'au pas du réglage');
      A.equal(O.valeur('champ', 'n importe quoi'), 72, 'invalide : le défaut');
      A.equal(O.valeur('ombres', 'oui'), true, 'un booléen reste un booléen');
      var o = O.regler(d, 'volume', 0.35);
      A.equal(o.volume, 0.35); A.equal(d.volume, 0.8, 'l original est intact');
      var st = stockage();
      A.ok(O.sauver(st, o));
      A.equal(O.charger(st).volume, 0.35, 'relu après sauvegarde');
      st.setItem(O.CLE, '{pas du json');
      A.deep(O.charger(st), O.defauts(), 'corrompu : les défauts');
      A.deep(O.charger(null), O.defauts(), 'sans stockage : les défauts');
    });

    it('SPEC-OPTION-001 / SPEC-RENDU-012 : un stockage v0.7.0 (sans schéma) migre — mipmaps prend le nouveau défaut, rien d’autre ne bouge', function () {
      var st = stockage();
      st.setItem(O.CLE, JSON.stringify({ mipmaps: false, volume: 0.5 }));
      var o = O.charger(st);
      A.equal(o.mipmaps, true, 'mipmaps : jamais réglé avant v0.7.0 → défaut courant (activé)');
      A.equal(o.volume, 0.5, 'volume conservé');
      A.equal(o.schema, O.SCHEMA, 'relu au format courant');
      // une table v0.7.0 complète, chaque réglage à une valeur NON par défaut
      var ancien = {}, attendu = {};
      Object.keys(O.REGLAGES).forEach(function (k) {
        var r = O.REGLAGES[k];
        var v = typeof r.defaut === 'boolean' ? !r.defaut : r.valeurs ? r.valeurs[r.valeurs.length - 1] : r.min;
        if (v === r.defaut) v = r.valeurs ? r.valeurs[0] : r.max;
        ancien[k] = v; attendu[k] = v;
      });
      delete ancien.antialias; attendu.antialias = O.REGLAGES.antialias.defaut;   // absent en v0.7.0
      ancien.mipmaps = false; attendu.mipmaps = true;
      st.setItem(O.CLE, JSON.stringify(ancien));
      var m = O.charger(st);
      Object.keys(O.REGLAGES).forEach(function (k) { A.equal(m[k], attendu[k], 'migration : ' + k); });
    });

    it('SPEC-OPTION-001 / SPEC-RENDU-012 : au format 2, un réglage choisi par le joueur se conserve, un réglage jamais touché suit le défaut courant', function () {
      var st = stockage();
      O.sauver(st, O.regler(O.defauts(), 'mipmaps', false));
      var o = O.charger(st);
      A.equal(o.mipmaps, false, 'coupé par le joueur : reste coupé');
      A.deep(o.modifies, ['mipmaps'], 'la liste des réglages modifiés est relue');
      // un réglage enregistré mais jamais réglé (valeur d'un ancien défaut) : défaut courant
      st.setItem(O.CLE, JSON.stringify({ schema: 2, modifies: ['volume'], volume: 0.4, champ: 99 }));
      var p = O.charger(st);
      A.equal(p.volume, 0.4, 'réglé : conservé');
      A.equal(p.champ, O.REGLAGES.champ.defaut, 'jamais réglé : défaut courant');
    });

    it('SPEC-OPTION-003 : les touches se remappent, un conflit est signalé, le choix est conservé et l aide suit', function () {
      var t = O.defauts().touches;
      A.equal(O.actionDe(t, 'KeyE'), 'inventaire');
      A.equal(O.actionDe(t, 'KeyZ'), 'avancer', 'AZERTY');
      A.equal(O.actionDe(t, 'KeyW'), 'avancer', 'QWERTY');
      var r = O.lier(t, 'inventaire', 'KeyI');
      A.equal(r.conflit, null);
      A.equal(O.actionDe(r.touches, 'KeyI'), 'inventaire');
      A.equal(O.actionDe(r.touches, 'KeyE'), null, 'l ancienne touche est libérée');
      var c = O.lier(r.touches, 'carte', 'KeyZ');
      A.equal(c.conflit, 'avancer', 'conflit signalé');
      A.equal(O.actionDe(c.touches, 'KeyC'), 'carte', 'et rien ne change');
      A.ok(O.lier(t, 'jeter', 'Escape').conflit, 'Échap est réservée');
      A.ok(O.lier(t, 'jeter', 'Digit3').conflit, 'les emplacements aussi');
      A.equal(O.lier(t, 'jeter', 'KeyG').conflit, null, 'se relier à sa propre touche n est pas un conflit');
      var st = stockage(), o = O.defauts();
      o.touches = r.touches;
      O.sauver(st, o);
      A.deep(O.charger(st).touches.inventaire, ['KeyI'], 'conservé');
      // l'aide affiche les touches en vigueur
      var aide = O.aide(r.touches);
      A.equal(aide.length, O.ACTIONS.length);
      var inv = aide.filter(function (l) { return l.action === 'inventaire'; })[0];
      A.equal(inv.touches, 'I');
      A.equal(aide[0].touches, 'W / Z / ↑', 'AZERTY et QWERTY côte à côte');
      A.equal(O.nomTouche('Space'), 'espace');
      A.equal(O.nomTouche('F5'), 'F5');
      A.equal(O.nomTouche('KeyQ'), 'Q');
      A.equal(O.RESERVEES.Escape, 'pause');
    });

    it('SPEC-OPTION-004 : le GPU se choisit, conservé, et se traduit en préférence du rendu', function () {
      A.equal(O.defauts().gpu, 'auto');
      A.equal(O.preferenceGpu('haute-performance'), 'high-performance');
      A.equal(O.preferenceGpu('economie'), 'low-power');
      A.equal(O.preferenceGpu('auto'), 'default');
      A.equal(O.valeur('gpu', 'carte inconnue'), 'auto', 'un GPU disparu : repli sur l automatique');
      var st = stockage();
      O.sauver(st, O.regler(O.defauts(), 'gpu', 'economie'));
      A.equal(O.charger(st).gpu, 'economie', 'conservé');
      A.ok(O.REGLAGES.gpu.relance, 'il s applique au prochain lancement');
    });

    it('SPEC-OPTION-005 : les résolutions de 800×600 à 4K, seulement celles que l écran affiche', function () {
      A.deep(O.REGLAGES.resolution.valeurs, ['native', '800x600', '1024x768', '1080p', '1440p', '4k']);
      A.deep(O.resolutionsPour({ largeur: 1920, hauteur: 1080 }), ['native', '800x600', '1024x768', '1080p'], 'un écran 1080p');
      A.equal(O.resolutionsPour({ largeur: 3840, hauteur: 2160 }).length, 6, 'un écran 4K : toutes');
      // le tampon prend la résolution voulue, sans déformer (même facteur sur les deux axes)
      A.close(O.rapportPixels('1080p', { l: 960, h: 540 }, 1), 2, 1e-9);
      A.close(O.rapportPixels('800x600', { l: 1600, h: 900 }, 1), 0.5, 1e-9);
      A.equal(O.rapportPixels('native', { l: 1600, h: 900 }, 3), 2, 'native : l écran, borné à 2');
      A.equal(O.valeur('resolution', '8k'), 'native');
    });

    it('SPEC-OPTION-007 : la taille de l interface — automatique selon la fenêtre, ou choisie', function () {
      A.equal(O.defauts().tailleInterface, 'auto');
      A.equal(O.echelleInterface('auto', 1920, 1080), 1, 'grande fenêtre : taille normale, pas d agrandissement');
      A.close(O.echelleInterface('auto', 1024, 768), 0.8, 1e-9, '1024×768 : réduite');
      A.close(O.echelleInterface('auto', 800, 600), 0.63, 0.01, '800×600 : la plus contrainte des deux dimensions');
      A.equal(O.echelleInterface('auto', 320, 200), 0.6, 'jamais sous 60 %');
      A.equal(O.echelleInterface('125', 800, 600), 1.25, 'une taille choisie l emporte sur la fenêtre');
      A.equal(O.valeur('tailleInterface', '300'), 'auto', 'une taille inconnue revient à auto');
    });

    it('SPEC-OPTION-006 : un, deux ou trois écrans, côte à côte ou empilés, repli sur un seul', function () {
      var trois = [{ largeur: 1920, hauteur: 1080, principal: false }, { largeur: 1920, hauteur: 1080, principal: true },
                   { largeur: 1920, hauteur: 1080, principal: false }];
      var h = O.disposition(trois, { ecran: 0, nombreEcrans: 3, orientation: 'horizontal' });
      A.equal(h.largeur, 5760); A.equal(h.hauteur, 1080);
      A.equal(h.segments.length, 3); A.close(h.segments[1].x, 1 / 3, 1e-9);
      A.equal(h.principal, 1, 'le HUD sur l écran principal');
      var v = O.disposition(trois, { ecran: 1, nombreEcrans: 2, orientation: 'vertical' });
      A.equal(v.hauteur, 2160); A.equal(v.premier, 1); A.equal(v.segments[1].y, 0.5);
      var r = O.disposition([trois[0]], { ecran: 0, nombreEcrans: 3, orientation: 'horizontal' });
      A.equal(r.nombre, 1); A.ok(r.repli, 'un écran manque : un seul écran');
      A.equal(O.disposition(trois, { ecran: 2, nombreEcrans: 2 }).premier, 1, 'la rangée tient dans les écrans présents');
      A.equal(O.champEtendu(72, 3, 'horizontal'), 72, 'côte à côte : l aspect élargit la vue');
      A.gt(O.champEtendu(72, 2, 'vertical'), 100, 'empilés : le champ vertical s ouvre');
      A.ok(O.champEtendu(110, 3, 'vertical') <= 150, 'borné');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
