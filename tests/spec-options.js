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
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
