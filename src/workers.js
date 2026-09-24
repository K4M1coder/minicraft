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
  function creerPool(opts) {
    if (typeof Worker === 'undefined') return null;
    var taille = Math.max(1, (opts && opts.taille) || 1);
    var workers = [], occupe = [];
    try {
      for (var i = 0; i < taille; i++) {
        var w = new Worker(opts.script);
        (function (idx) {
          w.onmessage = function (ev) {
            occupe[idx] = false;
            if (opts.onMessage) opts.onMessage(ev.data);
          };
          w.onerror = function (ev) {
            occupe[idx] = false;
            if (opts.onErreur) opts.onErreur(ev);
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
      fermer: function () {
        workers.forEach(function (w) { try { w.terminate(); } catch (e) { /* rien */ } });
      },
    };
  }

  MC.Workers = { disponible: disponible, creerPool: creerPool };
})(typeof globalThis !== 'undefined' ? globalThis : this);
