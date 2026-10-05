/* debug.js — MC_DEBUG (SPEC-BANC-017) : pilotage manuel et par les tests du
   rendu intégré au banc de test. Module mince : `MC.Debug.creer(g)` construit
   une interface à partir d'une partie déjà créée (`g`, l'objet rendu par
   `MC.createGame`) — il ne crée ni ne possède d'état à lui, tout vit dans `g`.

   Utilisé à la fois par le panneau manuel du banc (tests/banc-ui.js) et par
   les tests eux-mêmes, pour que les deux passent par le même chemin. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  function creer(g) {
    var agrandi = null; // { parent, avant, style } le temps d'être plein panneau

    function etatJoueur() {
      var equipe = g.equipe && g.equipe[0];
      return equipe ? equipe.player.state : g.player.state;
    }

    /* Téléporte au bloc (x, z) le plus proche du sol si y est omis, sinon aux
       coordonnées exactes. Coupe la vitesse pour ne pas repartir en chute. */
    function teleporter(x, y, z) {
      var s = etatJoueur();
      if (z === undefined) {
        var gy = g.world.groundAt(Math.floor(x), Math.floor(y), true);
        s.pos.x = x; s.pos.z = y; s.pos.y = gy + 1.2;
      } else {
        s.pos.x = x; s.pos.y = y; s.pos.z = z;
      }
      s.vel.x = s.vel.y = s.vel.z = 0;
      return { x: s.pos.x, y: s.pos.y, z: s.pos.z };
    }

    /* Règle l'heure du jour, en heures (0 à 24). */
    function heure(h) {
      var DC = MC.DayCycle;
      if (typeof h !== 'number' || !isFinite(h)) return g.time;   // heure() sans argument : NaN écrit dans g.time
      var frac = ((h % 24) + 24) % 24 / 24;
      var jourCourant = Math.floor(g.time / DC.DAY_LENGTH);
      g.time = jourCourant * DC.DAY_LENGTH + frac * DC.DAY_LENGTH;
      return g.time;
    }

    /* Règle la saison en gardant l'heure du jour courante ('printemps',
       'ete', 'automne', 'hiver'). */
    function saison(nom) {
      var DC = MC.DayCycle;
      var ORDRE = ['printemps', 'ete', 'été', 'automne', 'hiver'];
      var idx = { printemps: 0, ete: 1, été: 1, automne: 2, hiver: 3 }[String(nom).toLowerCase()];
      if (idx === undefined) return g.time;
      var quart = DC.YEAR_LENGTH / 4;
      var dansAnnee = g.time % DC.YEAR_LENGTH;
      var heureDuJour = dansAnnee % DC.DAY_LENGTH;
      var annees = Math.floor(g.time / DC.YEAR_LENGTH);
      g.time = annees * DC.YEAR_LENGTH + idx * quart + heureDuJour;
      return g.time;
    }

    /* Force un type de météo si le module météo du jeu est actif ; sinon,
       ne fait rien (aucune météo simulée hors partie réelle). */
    function meteo(type) {
      if (!g.meteo) return null;
      g.meteo.nom = type;
      g.meteo.type = type;
      return g.meteo;
    }

    function distanceVue(n) {
      g.render.setDistance(n);
      return g.render.RENDER_DIST;
    }

    /* Plancher SPEC-OPTION-008, dupliqué à dessein : `agrandir` déplace la
       surface interne du jeu (`.mc-surface`, posée par game.js) dans un
       autre conteneur — elle doit continuer à y respecter le même plancher
       de 800×600, mise à l'échelle plutôt qu'étirée à la taille réelle du
       panneau (qui peut être plus petit). */
    function ajusterDansPanneau(surface, panneau) {
      var L = 800, H = 600;
      var pw = panneau.clientWidth || L, ph = panneau.clientHeight || H;
      var l = Math.max(L, pw), h = Math.max(H, ph);
      surface.style.width = l + 'px';
      surface.style.height = h + 'px';
      var echelle = Math.min(pw / l, ph / h) || 1;
      surface.style.transform = echelle < 1 ? 'scale(' + echelle + ')' : 'none';
      surface.style.left = Math.round((pw - l * echelle) / 2) + 'px';
      surface.style.top = Math.round((ph - h * echelle) / 2) + 'px';
    }

    /* Passe le rendu intégré en plein panneau droit (ou le rétablit) : on
       déplace la surface interne du jeu dans un calque de recouvrement, en
       mémorisant tout ce qu'il faut pour revenir bit à bit à l'état
       précédent, rapport d'aspect compris (SPEC-BANC-017). */
    function agrandir(panneau) {
      if (agrandi || !panneau) return false;
      var surface = g.render.renderer.domElement.parentElement;
      agrandi = { surface: surface, parent: surface.parentElement, avant: surface.nextSibling,
                  style: surface.getAttribute('style') || '' };
      panneau.appendChild(surface);
      surface.style.position = 'absolute';
      ajusterDansPanneau(surface, panneau);
      g.render.resize();
      return true;
    }

    function reduire() {
      if (!agrandi) return false;
      var a = agrandi; agrandi = null;
      if (a.avant) a.parent.insertBefore(a.surface, a.avant);
      else a.parent.appendChild(a.surface);
      if (a.style) a.surface.setAttribute('style', a.style); else a.surface.removeAttribute('style');
      g.render.resize();
      return true;
    }

    /* Capture immédiate de l'image affichée, en JPEG compressé. */
    function capture() {
      g.render.render();
      var src = g.render.renderer.domElement;
      return src.toDataURL('image/jpeg', 0.85);
    }

    /* SPEC-BANC-109 : réglage à chaud du journal depuis la console,
       `MC_DEBUG.journal.niveau('SYNC', 'trace')`, et lecture du tampon. */
    var journal = MC.Journal ? {
      niveau: MC.Journal.niveau, regler: MC.Journal.regler, configuration: MC.Journal.configuration,
      tampon: MC.Journal.tampon, vider: MC.Journal.viderTampon,
    } : null;

    /* SPEC-BANC-094 : l'INSTANTANÉ de l'état du jeu, pris par le banc dans le
       `finally` d'un test (donc même si l'échec survient au milieu du test) et
       joint au rapport d'un test en échec ou lent. Lecture seule, bornée, et qui
       ne lève JAMAIS : un champ illisible vaut null et son motif va dans
       `erreurs` — un instantané qui planterait masquerait l'échec qu'il
       documente. Champs : graine, position, heure, météo, chunks chargés / en
       attente / en maillage, files et workers, versions de chunk, entités, mode
       réseau. */
    function instantane() {
      var out = { t: Date.now(), erreurs: [] };
      function champ(nom, fn) {
        try { out[nom] = fn(); } catch (e) { out[nom] = null; out.erreurs.push(nom + ' : ' + ((e && e.message) || e)); }
      }
      function arrondi(v) { return typeof v === 'number' && isFinite(v) ? Math.round(v * 1000) / 1000 : v; }
      champ('graine', function () { return g.world.seed; });
      champ('position', function () {
        var s = etatJoueur();
        return { x: arrondi(s.pos.x), y: arrondi(s.pos.y), z: arrondi(s.pos.z), yaw: arrondi(s.yaw), pitch: arrondi(s.pitch), vivant: !s.dead, vol: !!s.flying };
      });
      champ('heure', function () {
        var DC = MC.DayCycle;
        return { temps: arrondi(g.time), heure_du_jour: DC ? arrondi(((g.time % DC.DAY_LENGTH) / DC.DAY_LENGTH) * 24) : null };
      });
      champ('meteo', function () { return g.meteo ? { type: g.meteo.type || null, nom: g.meteo.nom || null, couverture: g.meteo.couverture === undefined ? null : g.meteo.couverture, precipitation: g.meteo.precipitation === undefined ? null : g.meteo.precipitation } : null; });
      champ('chunks', function () {
        var charges = 0, sales = 0, sansMaillage = 0, min = Infinity, max = -Infinity;
        var versions = {}, nbVersions = 0;
        g.world.chunks.forEach(function (c, cle) {
          charges++;
          if (c.dirty) sales++;
          if (!(c.mesh || c.meshC || c.meshT || c.meshL)) sansMaillage++;
          if (typeof c.version === 'number') {
            if (c.version < min) min = c.version;
            if (c.version > max) max = c.version;
            if (nbVersions < 40) { versions[cle] = c.version; nbVersions++; }     // un échantillon borné, jamais tout le monde
          }
        });
        var files = g.diagnostic ? g.diagnostic().files : null;
        return {
          charges: charges, a_remailler: sales, sans_maillage: sansMaillage,
          en_attente_generation: files ? files.genere.enFile + files.genere.enVol : null,
          en_maillage: files ? files.maille.enFile + files.maille.enVol : null,
          versions: { min: min === Infinity ? null : min, max: max === -Infinity ? null : max, echantillon: versions },
        };
      });
      champ('files', function () { return g.diagnostic ? g.diagnostic().files : null; });
      champ('workers', function () { var d = g.diagnostic ? g.diagnostic() : null; return d ? { pools: d.workers, erreurs: d.erreursWorkers } : null; });
      champ('lointain', function () { return g.diagnostic ? g.diagnostic().lointain : null; });
      champ('entites', function () {
        var parType = {}, n = 0;
        g.entities.list.forEach(function (e) { n++; parType[e.type] = (parType[e.type] || 0) + 1; });
        var distants = g.net && g.net.mobsDistants ? g.net.mobsDistants.size : 0;
        return { total: n, par_type: parType, mobs_distants: distants };
      });
      champ('reseau', function () {
        var net = g.net;
        return { etat: net ? net.etat : null, en_ligne: net && net.enLigne ? !!net.enLigne() : false, hote_distant: !!g.hoteDistant, joueurs_distants: net && net.distants ? net.distants.size : 0 };
      });
      champ('jeu', function () { return { etat_entree: g.input ? g.input.state : null, fps: g.fps, qualite: g.qualite ? g.qualite.palier : null, distance_de_vue: g.render ? g.render.RENDER_DIST : null }; });
      return out;
    }

    return {
      journal: journal, instantane: instantane,
      teleporter: teleporter, heure: heure, saison: saison, meteo: meteo,
      distanceVue: distanceVue, agrandir: agrandir, reduire: reduire, capture: capture,
      get estAgrandi() { return !!agrandi; },
    };
  }

  MC.Debug = { creer: creer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
