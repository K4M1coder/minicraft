/* travaux-serveur.js — travaux longs du serveur découpés sous un budget de
   temps par tic, pour que la boucle de simulation ne se bloque jamais :
   - `creerFileChunks` : génération des chunks voulus autour des joueurs, par
     tranches de colonnes (`monde.tacheGenerationBrute`), les plus urgents
     d'abord (le sol sous un joueur), puis du plus proche au plus lointain ;
   - `creerPreparateur` : une liste d'étapes courtes (construire un lieu, tracer
     une route…) exécutées tant que le budget le permet, reprises au tic suivant ;
   - `creerSerialiseur` : sérialisation JSON d'un état de monde dont les grandes
     listes (blocs modifiés, états) sont écrites par tranches, sur un instantané
     cohérent (copie sur écriture des valeurs modifiées pendant la sérialisation).
   Module PUR : ni Node ni DOM ; l'horloge est fournie par l'appelant
   (`horloge()` en millisecondes, croissante). Les résultats ne dépendent
   jamais de la découpe : seul le moment où ils arrivent change. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  /* Budgets par tic (ms) de la boucle du serveur — un tic à 60 Hz dure 16,7 ms ;
     l'objectif mesuré est un tic p99 < 50 ms pendant la marche (tools/mesure-tics.js). */
  var BUDGETS = {
    TIC_MS: 50,               // durée maximale visée d'un tic (p99), tout compris
    FOND_MS: 6,               // génération de chunks et préparation des lieux, par tic, sans urgence
    URGENT_MS: 20,            // idem quand le sol d'un joueur manque (il attend : on s'y consacre)
    TRANCHE_SAUVEGARDE_MS: 4, // une tranche de sérialisation de sauvegarde
    ATTENTE_SOL_MAX_S: 5,     // au-delà, le sol d'un joueur est généré d'un coup (attente bornée)
  };

  function cle(cx, cz) { return cx + ',' + cz; }

  /* File de génération. `monde` : createWorld (tacheGenerationBrute,
     integrerChunk, chunkDe). `vouloir(liste)` : la liste [[d2, cx, cz], …]
     triée du plus proche au plus lointain (monde.chunksVoulus) ; les tâches
     de chunks qui n'y sont plus sont abandonnées. `travailler(urgents,
     echeance, horloge)` : `urgents` [[cx, cz], …] passent avant tout ; rend le
     nombre de chunks intégrés. */
  function creerFileChunks(monde) {
    var voulus = [], curseur = 0;
    var taches = new Map();
    var integres = 0;
    function prochain(urgents) {
      for (var i = 0; urgents && i < urgents.length; i++) {
        if (!monde.chunkDe(urgents[i][0], urgents[i][1])) return urgents[i];
      }
      while (curseur < voulus.length) {
        var v = voulus[curseur];
        if (!monde.chunkDe(v[1], v[2])) return [v[1], v[2]];
        curseur++;
      }
      return null;
    }
    return {
      vouloir: function (liste) {
        voulus = (liste || []).slice();
        curseur = 0;
        var garder = new Set(voulus.map(function (v) { return cle(v[1], v[2]); }));
        taches.forEach(function (t, k) { if (!garder.has(k)) taches.delete(k); });
      },
      travailler: function (urgents, echeance, horloge) {
        var n = 0;
        for (;;) {
          var c = prochain(urgents);
          if (!c) break;
          var k = cle(c[0], c[1]);
          var t = taches.get(k);
          if (!t) { t = monde.tacheGenerationBrute(c[0], c[1]); taches.set(k, t); }
          var fini = t.avancer(echeance, horloge);
          if (!fini) break;
          taches.delete(k);
          if (!monde.chunkDe(c[0], c[1])) { monde.integrerChunk(c[0], c[1], t.resultat()); n++; integres++; }
          if (horloge() >= echeance) break;
        }
        return n;
      },
      // chunks de la liste [[cx, cz], …] encore absents
      manquants: function (liste) {
        var n = 0;
        for (var i = 0; i < liste.length; i++) if (!monde.chunkDe(liste[i][0], liste[i][1])) n++;
        return n;
      },
      get enCours() { return taches.size; },
      get integres() { return integres; },
      get restants() {
        var n = 0;
        for (var i = curseur; i < voulus.length; i++) if (!monde.chunkDe(voulus[i][1], voulus[i][2])) n++;
        return n;
      },
    };
  }

  /* Les 3×3 chunks autour d'une position : ce qu'il faut pour qu'un joueur ait
     un sol (et des murs) sous lui, de quelque côté qu'il franchisse un bord. */
  function chunksDuSol(x, z) {
    var cx = Math.floor(x / 16), cz = Math.floor(z / 16), out = [];
    out.push([cx, cz]);
    for (var dx = -1; dx <= 1; dx++) for (var dz = -1; dz <= 1; dz++) if (dx || dz) out.push([cx + dx, cz + dz]);
    return out;
  }

  /* Étapes courtes exécutées sous budget. Une étape (fonction) peut rendre un
     tableau de nouvelles étapes, ajoutées à la fin. `avancer` rend true quand
     tout est fait. */
  function creerPreparateur() {
    var etapes = [], i = 0, actif = false;
    return {
      lancer: function (liste) { etapes = (liste || []).slice(); i = 0; actif = true; },
      avancer: function (echeance, horloge) {
        while (i < etapes.length) {
          var r = etapes[i++]();
          if (r && r.length) for (var k = 0; k < r.length; k++) etapes.push(r[k]);
          if (horloge() >= echeance) break;
        }
        if (i >= etapes.length) { actif = false; etapes = []; i = 0; return true; }
        return false;
      },
      get actif() { return actif; },
      get restantes() { return etapes.length - i; },
    };
  }

  /* ── sérialisation par tranches ──────────────────────────────────────────── */
  /* JSON d'une entrée [x, y, z, valeur] dont la clé est « x,y,z » : exactement
     ce que JSON.stringify([+x, +y, +z, valeur]) écrirait. */
  function nombreJSON(n) { return isFinite(n) ? String(n) : 'null'; }
  function entreeJSON(k, v) {
    var p = k.split(',');
    var j = v === undefined || typeof v === 'function' ? 'null' : JSON.stringify(v);
    return '[' + nombreJSON(+p[0]) + ',' + nombreJSON(+p[1]) + ',' + nombreJSON(+p[2]) + ',' + j + ']';
  }
  var ABSENT = {};
  /* `tete` : l'état sans ses grandes listes — chacune y est remplacée par la
     chaîne `MARQUE + nom` (à sa place, pour garder l'ordre des clés) ;
     `sources` : [{ nom, map }] — Map « x,y,z » → valeur. L'instantané des clés
     est pris à la création ; une modification ultérieure doit être annoncée
     AVANT d'avoir lieu par `avantModification(nom, cle)` (la valeur d'origine
     est gardée) : le texte produit est celui de l'état au moment de la
     création, quoi qu'il arrive ensuite. `avancer(echeance, horloge)` rend true
     quand tout est écrit ; `morceaux()` : les morceaux du texte, dans l'ordre,
     dont la concaténation vaut JSON.stringify de l'état complet. */
  var MARQUE = '\u0000MC-SERIALISATION\u0000';
  function creerSerialiseur(tete, sources, opts) {
    opts = opts || {};
    var texteTete = JSON.stringify(tete);
    var etat = (sources || []).map(function (s) {
      return { nom: s.nom, map: s.map, cles: Array.from(s.map.keys()), i: 0, morceaux: [], copie: new Map() };
    });
    var parIndex = {};
    etat.forEach(function (e) { parIndex[e.nom] = e; });
    var courant = 0, fini = etat.length === 0;
    var maxParPas = opts.maxParPas || 2048;
    function valeur(e, k) {
      if (e.copie.has(k)) return e.copie.get(k);
      return e.map.get(k);
    }
    return {
      avantModification: function (nom, k) {
        var e = parIndex[nom];
        if (!e || fini || e.copie.has(k)) return;
        e.copie.set(k, e.map.has(k) ? e.map.get(k) : ABSENT);
      },
      avancer: function (echeance, horloge) {
        while (!fini) {
          var e = etat[courant];
          var morceau = [];
          var fin = Math.min(e.cles.length, e.i + maxParPas);
          for (; e.i < fin; e.i++) {
            var k = e.cles[e.i], v = valeur(e, k);
            if (v === ABSENT) continue;
            morceau.push(entreeJSON(k, v));
          }
          if (morceau.length) e.morceaux.push(morceau.join(','));
          if (e.i >= e.cles.length) { courant++; if (courant >= etat.length) fini = true; }
          if (!fini && echeance !== undefined && horloge() >= echeance) return false;
        }
        return true;
      },
      get fini() { return fini; },
      morceaux: function () {
        if (!fini) return null;
        var out = [], reste = texteTete;
        etat.forEach(function (e) {
          var m = JSON.stringify(MARQUE + e.nom);
          var p = reste.indexOf(m);
          if (p < 0) throw new Error('marque absente de la tête : ' + e.nom);
          out.push(reste.slice(0, p) + '[');
          e.morceaux.forEach(function (x, n) { out.push(n ? ',' + x : x); });
          reste = ']' + reste.slice(p + m.length);
        });
        out.push(reste);
        return out;
      },
    };
  }

  MC.TravauxServeur = {
    BUDGETS: BUDGETS, MARQUE: MARQUE,
    creerFileChunks: creerFileChunks, chunksDuSol: chunksDuSol,
    creerPreparateur: creerPreparateur, creerSerialiseur: creerSerialiseur, entreeJSON: entreeJSON,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
