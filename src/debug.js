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

    return {
      teleporter: teleporter, heure: heure, saison: saison, meteo: meteo,
      distanceVue: distanceVue, agrandir: agrandir, reduire: reduire, capture: capture,
      get estAgrandi() { return !!agrandi; },
    };
  }

  MC.Debug = { creer: creer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
