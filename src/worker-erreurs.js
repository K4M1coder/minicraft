/* worker-erreurs.js — les erreurs d'un worker remontent au fil principal
   (SPEC-BANC-097, docs/banc/historique-global.md §3.13).

   Une exception non rattrapée ou une promesse rejetée DANS un worker ne passe
   par aucune console visible de la page : sans ce relais, une génération ou un
   maillage qui plante en silence ne laisse aucune trace. `installer(self)` pose
   les deux écouteurs (`error`, `unhandledrejection`) qui renvoient l'erreur et
   sa pile au fil principal par `postMessage({ type: 'journal', … })`, que le
   pool (src/workers.js) verse au journal (domaine WORKER, code E-WORK-002).

   Chargé par worker-monde.js et worker-maillage.js (importScripts, juste après
   journal.js), identique pour tout worker. Module PUR : la cible (`self`) est
   passée en argument, rien n'est lu dans l'environnement. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var MAX_MESSAGE = 1000, MAX_PILE = 4000;
  function court(v, n) { return String(v === undefined || v === null ? '' : v).slice(0, n); }

  /* Le message à envoyer pour une erreur donnée (exposé pour les tests). */
  function messageErreur(origine, nom, message, pile, fichier, ligne) {
    return {
      type: 'journal', niveau: 'error', domaine: 'WORKER', origine: origine, worker: court(nom, 80),
      message: court(message || 'erreur sans message', MAX_MESSAGE), pile: pile ? court(pile, MAX_PILE) : null,
      fichier: fichier ? court(fichier, 300) : null, ligne: typeof ligne === 'number' ? ligne : null,
    };
  }

  /* Pose les écouteurs sur `cible` (le `self` d'un worker). L'événement `error`
     N'EST PAS annulé : le fil principal reçoit aussi `worker.onerror`, dont dépend
     le repli sur la génération synchrone (SPEC-PERF-006). Rend vrai si installé. */
  function installer(cible, nom) {
    if (!cible || typeof cible.addEventListener !== 'function' || typeof cible.postMessage !== 'function') return false;
    function signaler(m) { try { cible.postMessage(m); } catch (e) { /* le relais ne doit jamais ajouter une panne à la panne */ } }
    cible.addEventListener('error', function (ev) {
      var e = ev && ev.error;
      signaler(messageErreur('error', nom, (ev && ev.message) || (e && e.message), e && e.stack, ev && ev.filename, ev && ev.lineno));
    });
    cible.addEventListener('unhandledrejection', function (ev) {
      var r = ev && ev.reason;
      signaler(messageErreur('unhandledrejection', nom, r && r.message ? r.message : (typeof r === 'string' ? r : 'promesse rejetée'), r && r.stack));
    });
    return true;
  }

  MC.WorkerErreurs = { installer: installer, messageErreur: messageErreur, MAX_MESSAGE: MAX_MESSAGE, MAX_PILE: MAX_PILE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
