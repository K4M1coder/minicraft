/* worker-monde.js — coquille du worker de génération (SPEC-PERF-004, 007,
   009). Tourne dans un Worker dédié : charge les modules purs par
   `importScripts` (même jeton anti-cache `?v=` que index.html, transmis
   dans l'URL du script par src/workers.js/game.js), crée SON monde
   (`MC.createWorld`, avec SES propres caches de bruit) à `init`, génère les
   chunks demandés (`genere`) en s'appuyant sur MC.TachesChunks (le même code
   que le repli synchrone du thread principal). */
(function () {
  'use strict';
  var suffixe = (function () {
    var m = /[?&]v=([^&]+)/.exec(self.location.search);
    return m ? '?v=' + m[1] : '';
  })();
  // ordre de src/world.js dans index.html (sous-ensemble) — voir
  // docs/vague-2/B3.md § 10 « pièges connus »
  var MODULES = ['journal', 'worker-erreurs', 'core', 'formes', 'noise', 'biomes', 'densite', 'zones', 'volcanisme', 'souterrain', 'recifs',
                 'donjons', 'habitats', 'routes', 'carte', 'eau', 'feu', 'meteo', 'lointain', 'world', 'circuits',
                 'lumiere', 'factions', 'inventory', 'daycycle', 'contrats-vague2', 'taches-chunks'];
  importScripts.apply(self, MODULES.map(function (m) { return m + '.js' + suffixe; }));

  var MC = self.MC;
  // SPEC-BANC-097 : exceptions et promesses rejetées de ce worker remontent au journal du fil principal
  MC.WorkerErreurs.installer(self, 'worker-monde');
  var monde = null, epoqueCourante = -1;

  self.onmessage = function (ev) {
    var m = MC.ContratsV2.validerMessageWorker(ev.data);
    if (!m) return;
    try {
      if (m.type === 'init') {
        epoqueCourante = m.epoque;
        monde = MC.createWorld(m.graine, m.options);
        self.postMessage({ type: 'pret', epoque: epoqueCourante });
        return;
      }
      if (m.type === 'genere') {
        // une réponse pour une époque révolue (nouvelle graine entre-temps)
        // n'intéresse plus personne : autant ne pas la calculer
        if (!monde || m.epoque !== epoqueCourante) return;
        var r = MC.TachesChunks.executerGeneration(monde, m);
        self.postMessage(r.message, r.transferables);
      }
    } catch (e) {
      self.postMessage({ type: 'erreur', epoque: m.epoque, cx: m.cx, cz: m.cz, message: String((e && e.message) || e) });
    }
  };
})();
