/* file-chunks.js — ordonnanceur pur des tâches de génération et de maillage
   (SPEC-PERF-005, 009, 010) : priorités par distance, budget d'intégration
   par image, rejet des résultats périmés (époque ou version), tout sans
   dépendre de Worker ni de `world` — testable sous Node. Utilisé par
   src/game.js (navigateur, avec ou sans Worker) et par tests/spec-workers.js.
   Module PUR : aucune dépendance de chargement. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  function creer(opts) {
    opts = opts || {};
    var horloge = opts.horloge || function () { return Date.now(); };
    var integrationsParImage = {
      genere: opts.integrationsGenParImage || 2,
      maille: opts.integrationsMailleParImage || 2,
    };
    var epoque = 0;
    var stats = { enFile: 0, enVol: 0, integres: 0, perimes: 0 };

    function genreVide() { return { file: [], enVol: new Map(), integration: [] }; }
    var genres = { genere: genreVide(), maille: genreVide() };

    function cle(cx, cz) { return cx + ',' + cz; }

    function distMin(cx, cz, centres) {
      var best = Infinity;
      for (var i = 0; i < centres.length; i++) {
        var dx = centres[i][0] - cx, dz = centres[i][1] - cz, d2 = dx * dx + dz * dz;
        if (d2 < best) best = d2;
      }
      return best;
    }
    // `liste` : format world.chunksVoulus ([d2, cx, cz]) — le d2 fourni sert
    // de repli (aucun centre) ; la priorité effective est toujours recalculée
    // contre `centres` (SPEC-PERF-010 : un centre qui bouge doit se voir).
    function construireFile(genre, liste, centres) {
      var out = [];
      for (var i = 0; i < liste.length; i++) {
        var e = liste[i], cx = e[1], cz = e[2];
        var d2 = centres && centres.length ? distMin(cx, cz, centres) : e[0];
        out.push({ cx: cx, cz: cz, priorite: d2 });
      }
      out.sort(function (a, b) { return a.priorite - b.priorite; });
      genres[genre].file = out;
    }
    /* Remplace ENTIÈREMENT les files de priorité des deux genres (pas
       d'accumulation d'une image à l'autre) — les tâches déjà en vol ou en
       attente d'intégration ne sont pas affectées : seul l'ORDRE change. */
    function voulus(centres, aGenerer, aMailler) {
      construireFile('genere', aGenerer || [], centres || []);
      construireFile('maille', aMailler || [], centres || []);
    }

    function distribuer(genre, libres) {
      var g = genres[genre];
      if (!g || libres <= 0) return [];
      var out = [];
      for (var i = 0; i < g.file.length && out.length < libres; i++) {
        var t = g.file[i], k = cle(t.cx, t.cz);
        if (g.enVol.has(k)) continue;
        g.enVol.set(k, true);
        out.push({ genre: genre, cx: t.cx, cz: t.cz, priorite: t.priorite });
      }
      return out;
    }

    // msg → genre déduit de son type (contrat src/contrats-vague2.js)
    function genreDuType(type) {
      if (type === 'chunk') return 'genere';
      if (type === 'maillage') return 'maille';
      return null;
    }
    /* SPEC-PERF-009 : un résultat s'applique seulement si son époque est la
       courante ET (pour un maillage) sa version correspond encore à celle du
       chunk visé au moment de l'intégration — sinon `perime`. Un résultat
       pour une tâche qu'on n'a pas (ou plus) en vol est `ignore` (doublon,
       ou déjà intégré par le repli synchrone entre-temps). */
    function recu(msg, versionCourante) {
      if (!msg || msg.epoque !== epoque) { stats.perimes++; return 'perime'; }
      var genre = genreDuType(msg.type);
      if (!genre) return 'ignore';
      var g = genres[genre], k = cle(msg.cx, msg.cz);
      if (!g.enVol.has(k)) return 'ignore';
      g.enVol.delete(k);
      if (genre === 'maille' && versionCourante && versionCourante(msg.cx, msg.cz) !== msg.version) {
        stats.perimes++;
        return 'perime';
      }
      g.integration.push(msg);
      stats.integres++;
      return 'integrer';
    }

    function aIntegrer(genre) {
      var g = genres[genre];
      if (!g) return [];
      var budget = integrationsParImage[genre] || 0;
      return g.integration.splice(0, budget);
    }

    // un worker en erreur : la tâche revient en jeu au prochain distribuer()
    function echec(genre, cx, cz) {
      var g = genres[genre];
      if (g) g.enVol.delete(cle(cx, cz));
    }

    // un chunk déchargé : plus la peine de le générer/mailler ni de garder
    // un résultat déjà reçu pour lui
    function oublier(cx, cz) {
      var k = cle(cx, cz);
      ['genere', 'maille'].forEach(function (genre) {
        var g = genres[genre];
        g.file = g.file.filter(function (t) { return cle(t.cx, t.cz) !== k; });
        g.enVol.delete(k);
        g.integration = g.integration.filter(function (m) { return cle(m.cx, m.cz) !== k; });
      });
    }

    function nouvelleEpoque() {
      epoque++;
      genres.genere = genreVide();
      genres.maille = genreVide();
      return epoque;
    }

    function statsAct() {
      stats.enFile = genres.genere.file.length + genres.maille.file.length;
      stats.enVol = genres.genere.enVol.size + genres.maille.enVol.size;
      return { enFile: stats.enFile, enVol: stats.enVol, integres: stats.integres, perimes: stats.perimes };
    }

    return {
      get epoque() { return epoque; },
      voulus: voulus, distribuer: distribuer, recu: recu, aIntegrer: aIntegrer,
      echec: echec, oublier: oublier, nouvelleEpoque: nouvelleEpoque, stats: statsAct,
      horloge: horloge,
    };
  }

  MC.FileChunks = { creer: creer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
