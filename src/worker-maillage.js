/* worker-maillage.js — coquille du worker de maillage (SPEC-PERF-007, 008).
   Charge un sous-ensemble volontairement minimal des modules purs (pas de
   génération de terrain ici : le maillage ne lit que l'instantané des 9
   voisins transmis dans chaque message `maille`, jamais `world`). */
(function () {
  'use strict';
  var suffixe = (function () {
    var m = /[?&]v=([^&]+)/.exec(self.location.search);
    return m ? '?v=' + m[1] : '';
  })();
  var MODULES = ['journal', 'worker-erreurs', 'core', 'formes', 'eau', 'lumiere', 'mesher', 'contrats-vague2', 'taches-chunks'];
  importScripts.apply(self, MODULES.map(function (m) { return m + '.js' + suffixe; }));

  var MC = self.MC;
  // SPEC-BANC-097 : exceptions et promesses rejetées de ce worker remontent au journal du fil principal
  MC.WorkerErreurs.installer(self, 'worker-maillage');
  var epoqueCourante = -1;

  self.onmessage = function (ev) {
    var m = MC.ContratsV2.validerMessageWorker(ev.data);
    if (!m) return;
    try {
      if (m.type === 'init') {
        epoqueCourante = m.epoque;
        self.postMessage({ type: 'pret', epoque: epoqueCourante });
        return;
      }
      if (m.type === 'maille') {
        if (m.epoque !== epoqueCourante) return;
        var r = MC.TachesChunks.executerMaillage(m);
        self.postMessage(r.message, r.transferables);
      }
    } catch (e) {
      self.postMessage({ type: 'erreur', epoque: m.epoque, cx: m.cx, cz: m.cz, message: String((e && e.message) || e) });
    }
  };
})();
