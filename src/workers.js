/* workers.js — pool de Web Workers et détection de disponibilité (SPEC-PERF-006,
   007) : navigateur seulement (utilise `Worker`, jamais chargé sous Node).
   Aucune connaissance du contenu des messages : c'est src/taches-chunks.js
   (côté worker) et src/game.js (côté thread principal) qui portent le
   protocole (src/contrats-vague2.js). */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  /* Un Worker peut exister (typeof Worker !== 'undefined') sans pouvoir être
     CRÉÉ : `file://` (pas d'origine), une CSP `worker-src` restrictive… La
     seule façon fiable de le savoir est d'essayer. */
  function disponible() {
    if (typeof Worker === 'undefined') return false;
    try {
      var w = new Worker('data:application/javascript,');
      w.terminate();
      return true;
    } catch (e) {
      return false;
    }
  }

  /* Pool de `taille` workers identiques (même script). `envoyer` choisit un
     worker LIBRE (pas de round-robin aveugle : un pool de maillage à
     plusieurs workers doit répartir la charge) et renvoie `false` si aucun
     n'est libre (l'appelant garde alors la tâche pour un prochain appel).
     `libres()` : nombre de workers actuellement inoccupés — c'est sur cette
     valeur que l'appelant (game.js, via MC.FileChunks.distribuer) borne le
     nombre de tâches à distribuer par image. */
  /* SPEC-BANC-097 : les erreurs d'un worker vont au journal (domaine WORKER).
       E-WORK-001  `worker.onerror` : exception non rattrapée / script introuvable (le
                   fil principal ne reçoit ni pile ni objet d'erreur, seulement message,
                   fichier et ligne) ;
       E-WORK-002  message `journal` envoyé PAR le worker (src/worker-erreurs.js) : l'erreur
                   ou la promesse rejetée vue de l'intérieur, avec sa pile ;
       E-WORK-004  `worker.onmessageerror` : un message reçu n'a pas pu être désérialisé. */
  function logWorker() { return MC.Journal ? MC.Journal('WORKER') : null; }
  function relayerJournal(d, script) {
    var log = logWorker();
    if (!log) return;
    log.error('E-WORK-002 ' + String(d.message || 'erreur dans un worker').slice(0, 1000),
      { worker: d.worker || script, origine: d.origine || null, fichier: d.fichier || null, ligne: d.ligne === undefined ? null : d.ligne }, d.pile || null);
  }
  function creerPool(opts) {
    if (typeof Worker === 'undefined') return null;
    var taille = Math.max(1, (opts && opts.taille) || 1);
    var workers = [], occupe = [];
    try {
      for (var i = 0; i < taille; i++) {
        var w = new Worker(opts.script);
        (function (idx) {
          w.onmessage = function (ev) {
            // un message de journal n'est PAS le résultat d'une tâche : il ne libère pas le worker
            if (ev.data && ev.data.type === 'journal') { relayerJournal(ev.data, opts.script); return; }
            occupe[idx] = false;
            if (opts.onMessage) opts.onMessage(ev.data);
          };
          w.onerror = function (ev) {
            occupe[idx] = false;
            var log = logWorker();
            if (log) log.error('E-WORK-001 erreur non rattrapée dans un worker : ' + String((ev && ev.message) || 'erreur sans message'),
              { worker: opts.script, fichier: (ev && ev.filename) || null, ligne: (ev && ev.lineno) || null });
            if (opts.onErreur) opts.onErreur(ev);
          };
          w.onmessageerror = function () {
            var log = logWorker();
            if (log) log.error('E-WORK-004 message de worker illisible (désérialisation impossible)', { worker: opts.script });
          };
        })(i);
        workers.push(w);
        occupe.push(false);
      }
    } catch (e) {
      workers.forEach(function (w) { try { w.terminate(); } catch (e2) { /* rien */ } });
      return null;
    }
    function indexLibre() {
      for (var i = 0; i < workers.length; i++) if (!occupe[i]) return i;
      return -1;
    }
    return {
      taille: taille,
      libres: function () {
        var n = 0;
        for (var i = 0; i < occupe.length; i++) if (!occupe[i]) n++;
        return n;
      },
      envoyer: function (msg, transferables) {
        var i = indexLibre();
        if (i < 0) return false;
        occupe[i] = true;
        workers[i].postMessage(msg, transferables || []);
        return true;
      },
      /* `init` (et tout message qui doit atteindre TOUT le pool, jamais un
         seul worker) : CHAQUE worker a son propre `epoqueCourante` en
         portée de module (worker-monde.js/worker-maillage.js) — un `init`
         envoyé via `envoyer()` (un seul worker libre) laisse les autres
         bloqués sur une époque périmée pour toujours : leurs tâches
         suivantes sont silencieusement ignorées (`m.epoque !==
         epoqueCourante`), sans réponse, donc sans jamais libérer leur slot
         `occupe` — un chunk reste indéfiniment `dirty`. `diffuser` ne
         touche JAMAIS `occupe` (un `init` ne consomme aucun worker). */
      diffuser: function (msg) {
        workers.forEach(function (w) { w.postMessage(msg, []); });
      },
      fermer: function () {
        workers.forEach(function (w) { try { w.terminate(); } catch (e) { /* rien */ } });
      },
    };
  }

  MC.Workers = { disponible: disponible, creerPool: creerPool };
})(typeof globalThis !== 'undefined' ? globalThis : this);
