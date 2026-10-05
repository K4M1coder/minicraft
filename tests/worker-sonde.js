/* worker-sonde.js — worker de TEST (SPEC-BANC-097) : lève, sur demande, une
   exception non rattrapée ou une promesse rejetée, pour vérifier qu'elles
   remontent au journal du fil principal par le même chemin que celles des
   workers de génération et de maillage (src/worker-erreurs.js, puis le pool de
   src/workers.js). Servi par le serveur du banc ; jamais chargé par le jeu. */
importScripts('../src/journal.js', '../src/worker-erreurs.js');
self.MC.WorkerErreurs.installer(self, 'worker-sonde');
self.onmessage = function (ev) {
  var m = ev.data || {};
  if (m.type === 'exception') setTimeout(function () { throw new Error(m.message || 'exception de test dans un worker'); }, 0);
  else if (m.type === 'rejet') Promise.reject(new Error(m.message || 'rejet de test dans un worker'));
  else if (m.type === 'echo') self.postMessage({ type: 'echo', valeur: m.valeur });
};
