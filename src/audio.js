/* audio.js — retours sonores synthétisés à la volée avec WebAudio.
   Aucun fichier son : le projet reste un dossier de fichiers texte.
   Tout est encapsulé pour que l'absence d'AudioContext (navigateur ancien,
   politique d'autoplay) dégrade en silence plutôt qu'en erreur. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  function createAudio() {
    var ctx = null, master = null, enabled = true, ready = false;
    var Amb = MC.Ambiance; // module pur : décide, ici on ne fait que synthétiser
    var auditeur = { x: 0, y: 0, z: 0, yaw: 0 };
    var volumes = {}; // réglages par catégorie (SPEC-AUDIO-006) ; défauts dans Ambiance

    function init() {
      if (ctx || !enabled) return ctx;
      try {
        var AC = G.AudioContext || G.webkitAudioContext;
        if (!AC) { enabled = false; return null; }
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.28 * volumeGeneral;
        master.connect(ctx.destination);
      } catch (e) { enabled = false; ctx = null; }
      return ctx;
    }

    /* Les navigateurs suspendent l'audio tant qu'aucun geste utilisateur n'a eu
       lieu : on le réveille au premier clic plutôt que d'échouer en silence. */
    function resume() {
      init();
      if (ctx && ctx.state === 'suspended') ctx.resume();
      ready = !!ctx && ctx.state === 'running';
      return ready;
    }

    /* Brique de base : une enveloppe courte sur un oscillateur.
       `type` : forme d'onde · `f0`→`f1` : glissando · `dur` : secondes. */
    function blip(type, f0, f1, dur, gain, delay) {
      if (!enabled) return;
      init();
      if (!ctx) return;
      var t = ctx.currentTime + (delay || 0);
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      // attaque très courte puis extinction : évite le clic de coupure
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain === undefined ? 0.5 : gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(master);
      osc.start(t); osc.stop(t + dur + 0.02);
    }

    /* Bruit filtré : sert aux impacts mats (casser, poser, pas). */
    function noise(dur, freq, q, gain, delay, filtre) {
      if (!enabled) return;
      init();
      if (!ctx) return;
      var t = ctx.currentTime + (delay || 0);
      var n = Math.max(1, Math.floor(ctx.sampleRate * dur));
      var buf = ctx.createBuffer(1, n, ctx.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var bp = ctx.createBiquadFilter();
      bp.type = filtre || 'bandpass'; bp.frequency.value = freq; bp.Q.value = q || 1;
      var g = ctx.createGain();
      g.gain.value = gain === undefined ? 0.5 : gain;
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(t);
    }

    var SONS = {
      casser:   function () { noise(0.13, 420, 1.1, 0.55); },
      poser:    function () { noise(0.07, 760, 2.0, 0.42); },
      ramasser: function () { blip('sine', 880, 1320, 0.09, 0.35); },
      craft:    function () { blip('triangle', 520, 780, 0.11, 0.35);
                              blip('triangle', 780, 1040, 0.09, 0.28, 0.08); },
      frapper:  function () { noise(0.09, 260, 0.8, 0.6); },
      blesse:   function () { blip('sawtooth', 300, 120, 0.22, 0.4); },
      mort:     function () { blip('sawtooth', 320, 60, 0.9, 0.45); },
      manger:   function () { noise(0.10, 300, 1.4, 0.4);
                              noise(0.10, 260, 1.4, 0.35); },
      echange:  function () { blip('sine', 660, 990, 0.10, 0.3);
                              blip('sine', 990, 1320, 0.10, 0.25, 0.09); },
      brise:    function () { noise(0.22, 180, 0.7, 0.6);
                              blip('sawtooth', 240, 90, 0.25, 0.3); },
      sauver:   function () { blip('sine', 740, 740, 0.07, 0.25);
                              blip('sine', 988, 988, 0.12, 0.25, 0.07); },
      tonnerre: function () { tonnerre(0, 1); },
      froid:    function () { blip('sine', 1400, 900, 0.18, 0.12); },
    };

    /* SPEC-AUDIO-003 : un même geste (pas, minage, casse, pose, nage, chute,
       combat, tir) sonne différemment selon la matière — une fréquence de
       base par matière, modulée par l'action. `MC.Ambiance.sonAction` décide
       du nom ('action_<action>_<matiere>') ; ici on le synthétise. */
    var FREQ_MATIERE = { herbe: 900, pierre: 300, sable: 1400, bois: 500,
                         neige: 1800, eau: 2200, metal: 200, laine: 700 };
    function jouerAction(action, matiere) {
      var f = FREQ_MATIERE[matiere] || FREQ_MATIERE.pierre;
      switch (action) {
        case 'pas':    noise(0.05, f, 1.3, 0.22); return true;
        case 'miner':  noise(0.11, f * 0.85, 1.0, 0.42); return true;
        case 'casser': noise(0.17, f * 0.75, 0.85, 0.55); return true;
        case 'poser':  noise(0.07, f * 1.35, 1.9, 0.4); return true;
        case 'nage':   noise(0.13, 1500, 1.4, 0.3); return true;
        case 'chute':  blip('sawtooth', 220, 70, 0.28, 0.35); return true;
        case 'combat': noise(0.09, 260, 0.8, 0.55); return true;
        case 'tir':    blip('square', 1200, 380, 0.09, 0.3); return true;
        default: return false;
      }
    }

    /* SPEC-AUDIO-002 : sons par créature (cri, pas, blessure, mort, attaque),
       une texture par famille plutôt que par espèce (des dizaines d'espèces
       partagent la même silhouette sonore). Noms décidés par
       `MC.Ambiance.sonCreature`. */
    function jouerCreature(nom) {
      switch (nom) {
        case 'cri_predateur': blip('sawtooth', 260, 180, 0.4, 0.3); return true;
        case 'cri_monstre':   blip('sawtooth', 140, 90, 0.5, 0.35); return true;
        case 'cri_betail':    blip('triangle', 320, 260, 0.3, 0.3); return true;
        case 'cri_volaille':  blip('square', 900, 1200, 0.12, 0.25); return true;
        case 'cri_aquatique': blip('sine', 500, 700, 0.3, 0.2); return true;
        case 'cri_generique': blip('triangle', 300, 260, 0.25, 0.25); return true;
        case 'pas_bete':      noise(0.08, 260, 1.0, 0.3); return true;
        case 'pas_monstre':   noise(0.10, 180, 0.9, 0.35); return true;
        case 'pas_leger':     noise(0.04, 700, 1.6, 0.18); return true;
        case 'mort_monstre':  blip('sawtooth', 220, 40, 0.7, 0.4); return true;
        case 'blesse_eau':    noise(0.12, 1200, 1.2, 0.35); return true;
        case 'mort_eau':      noise(0.3, 500, 0.9, 0.4); return true;
        default: return false;
      }
    }

    /* SPEC-AUDIO-004 : interactions (portes/trappes, coffres, fourneau,
       établi, échanges, interface). `craft` et `echange` existent déjà dans
       SONS (rétrocompatibilité) ; le reste est synthétisé ici. */
    function jouerInteraction(nom) {
      switch (nom) {
        case 'porte':     noise(0.14, 320, 1.4, 0.4); return true;
        case 'trappe':    noise(0.09, 420, 1.6, 0.35); return true;
        case 'coffre':    noise(0.15, 260, 1.1, 0.45); blip('sine', 500, 700, 0.08, 0.2, 0.1); return true;
        case 'fourneau':  noise(0.2, 200, 0.7, 0.4, 0, 'lowpass'); return true;
        case 'interface': blip('sine', 700, 900, 0.05, 0.18); return true;
        default: return false;
      }
    }

    /* SPEC-AUDIO-005 : événements (tonnerre déjà couvert par SONS.tonnerre,
       éruption, cyclone/tornade, succès, chapitres/fins d'histoire, réveil
       d'un gardien). */
    function jouerEvenement(nom) {
      switch (nom) {
        case 'eruption': noise(0.4, 90, 0.6, 0.7, 0, 'lowpass'); noise(1.2, 60, 0.8, 0.6, 0.1, 'lowpass'); return true;
        case 'cyclone':  noise(1.5, 500, 0.5, 0.5); noise(1.5, 220, 0.6, 0.4, 0.05, 'lowpass'); return true;
        case 'succes':   blip('sine', 660, 990, 0.1, 0.3); blip('sine', 990, 1320, 0.12, 0.28, 0.1); return true;
        case 'chapitre': blip('triangle', 440, 660, 0.2, 0.3); blip('triangle', 660, 880, 0.25, 0.28, 0.15); return true;
        case 'fin_histoire': blip('sine', 523, 784, 0.3, 0.3); blip('sine', 784, 1046, 0.4, 0.3, 0.2); return true;
        case 'gardien':  blip('sawtooth', 90, 200, 0.6, 0.4); noise(0.4, 140, 0.8, 0.4, 0.1, 'lowpass'); return true;
        default: return false;
      }
    }

    /* Point d'entrée unique de la synthèse : SONS (historique) d'abord, puis
       chaque famille décidée par ambiance.js. Renvoie false sans rien jouer
       si le nom n'est reconnu nulle part — jamais d'exception qui remonterait
       jusqu'au jeu pour un nom de son mal orthographié. */
    function synthetiser(nom) {
      if (SONS[nom]) { SONS[nom](); return true; }
      if (typeof nom === 'string' && nom.indexOf('action_') === 0) {
        var reste = nom.slice('action_'.length);
        var us = reste.indexOf('_');
        var action = us >= 0 ? reste.slice(0, us) : reste;
        var matiere = us >= 0 ? reste.slice(us + 1) : '';
        return jouerAction(action, matiere);
      }
      if (jouerCreature(nom)) return true;
      if (jouerInteraction(nom)) return true;
      if (jouerEvenement(nom)) return true;
      return false;
    }

    /* Tonnerre : un craquement, puis un long grondement grave. Le son voyage à
       340 blocs par seconde : un éclair lointain gronde après son flash. */
    function tonnerre(distance, force) {
      var retard = Math.min(6, (distance || 0) / 340);
      var f = force === undefined ? 1 : force;
      var att = Math.max(0.15, 1 - (distance || 0) / 260);
      noise(0.25, 1800, 0.6, 0.5 * f * att, retard);
      noise(2.8, 90, 0.7, 0.9 * f * att, retard + 0.05, 'lowpass');
      noise(1.6, 160, 0.9, 0.5 * f * att, retard + 0.4, 'lowpass');
      return retard;
    }

    /* Nappes continues (SPEC-AUDIO-001) : un bruit blanc en boucle par nappe,
       chacune avec son propre filtre — vent, pluie, mer/ressac, rivière,
       cascade, feuillage, grillons nocturnes, résonance des grottes, rumeur
       des villes, grondement des volcans. `ambiance()` (historique, pluie +
       vent seulement) reste disponible ; `majNappes()` couvre tout le reste. */
    var NAPPE_PARAMS = {
      pluie:     { type: 'bandpass', freq: 2600, q: 0.4 },
      vent:      { type: 'lowpass',  freq: 380,  q: 0.8 },
      mer:       { type: 'lowpass',  freq: 220,  q: 0.9 },
      riviere:   { type: 'bandpass', freq: 1800, q: 0.6 },
      cascade:   { type: 'highpass', freq: 900,  q: 0.5 },
      feuillage: { type: 'bandpass', freq: 3200, q: 0.3 },
      grillons:  { type: 'bandpass', freq: 4200, q: 6 },
      grotte:    { type: 'lowpass',  freq: 140,  q: 1.2 },
      ville:     { type: 'bandpass', freq: 600,  q: 0.5 },
      volcan:    { type: 'lowpass',  freq: 70,   q: 1.0 },
    };
    var nappes = null;
    function creerNappes() {
      if (nappes || !ctx) return nappes;
      var n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      function nappe(p) {
        var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        var fl = ctx.createBiquadFilter(); fl.type = p.type; fl.frequency.value = p.freq; fl.Q.value = p.q;
        var g = ctx.createGain(); g.gain.value = 0;
        src.connect(fl); fl.connect(g); g.connect(master);
        src.start();
        return { gain: g, filtre: fl };
      }
      nappes = {};
      for (var k in NAPPE_PARAMS) nappes[k] = nappe(NAPPE_PARAMS[k]);
      return nappes;
    }
    function ambiance(pluie, vent, neige) {
      if (!enabled) return false;
      init();
      if (!ctx || ctx.state !== 'running') return false;
      creerNappes();
      var t = ctx.currentTime;
      // la neige tombe sans bruit : elle ne compte que pour un souffle
      nappes.pluie.gain.gain.setTargetAtTime(Math.max(0, pluie) * 0.55, t, 0.6);
      nappes.vent.gain.gain.setTargetAtTime(Math.max(0, vent) * 0.5 + (neige || 0) * 0.08, t, 0.8);
      nappes.vent.filtre.frequency.setTargetAtTime(260 + vent * 520, t, 0.8);
      return true;
    }

    /* `etat` : le contexte {biome, nuit, pluie, vent, neige, sousTerre,
       eauProche, villeProche, volcanProche, riviereProche, cascadeProche}
       que game.js assemble à partir de world/meteo/habitats. La décision
       (quelle nappe, à quel gain) vient de MC.Ambiance ; ici on ne fait que
       lisser les gains vers leur nouvelle cible. */
    function majNappes(etat) {
      if (!enabled) return false;
      init();
      if (!ctx || ctx.state !== 'running') return false;
      creerNappes();
      var gains = Amb ? Amb.nappes(etat) : {};
      var catVol = Amb ? Amb.volumeCategorie('ambiance', volumes) : 1;
      var t = ctx.currentTime;
      for (var k in nappes) {
        nappes[k].gain.gain.setTargetAtTime((gains[k] || 0) * catVol, t, 0.7);
      }
      return true;
    }

    /* Renvoie true seulement si un son a VRAIMENT été émis. Une valeur de
       retour optimiste masquerait l'absence de WebAudio et rendrait les tests
       verts pour de mauvaises raisons. */
    function play(nom) {
      if (!enabled) return false;
      init();
      if (!ctx) return false;
      try { return synthetiser(nom); } catch (e) { return false; }
    }

    /* SPEC-AUDIO-006 : position/orientation de l'auditeur (le joueur local),
       mise à jour chaque image par game.js. */
    function positionAuditeur(x, y, z, yaw) {
      auditeur.x = x || 0; auditeur.y = y || 0; auditeur.z = z || 0; auditeur.yaw = yaw || 0;
    }

    /* Volume d'une catégorie : lecture (sans second argument) ou réglage
       (0..1, réutilisable depuis un futur menu d'options — SPEC-OPTION-001). */
    function volumeCategorie(categorie, v) {
      if (v === undefined) return Amb ? Amb.volumeCategorie(categorie, volumes) : 1;
      volumes[categorie] = Math.max(0, Math.min(1, v));
      return volumes[categorie];
    }

    /* `jouer(nom, opts)` : API étendue au-dessus de `play`. `opts` peut
       porter {x,y,z} (position de la source dans le monde — sinon le son
       n'est pas spatialisé), `categorie` (pour le volume de catégorie),
       `sousEau`/`roche` (occlusion), `portee`. Le calcul (gain/pan/filtre)
       vient de MC.Ambiance.spatialiser ; ici on route la synthèse à travers
       un bus temporaire plutôt que directement vers `master`. */
    function jouer(nom, opts) {
      if (!enabled) return false;
      init();
      if (!ctx) return false;
      opts = opts || {};
      var categorie = opts.categorie || 'action';
      var catVol = Amb ? Amb.volumeCategorie(categorie, volumes) : 1;
      var spatial = null;
      if (opts.x !== undefined || opts.y !== undefined || opts.z !== undefined) {
        spatial = Amb ? Amb.spatialiser(auditeur, { x: opts.x || 0, y: opts.y || 0, z: opts.z || 0 }, opts)
                      : { gain: 1, pan: 0, coupure: 20000 };
      }
      var bus = ctx.createGain();
      bus.gain.value = catVol * (spatial ? spatial.gain : 1);
      var sortie = bus;
      if (spatial) {
        if (typeof ctx.createStereoPanner === 'function') {
          var pan = ctx.createStereoPanner();
          pan.pan.value = spatial.pan;
          sortie.connect(pan); sortie = pan;
        }
        if (spatial.coupure < 20000) {
          var lp = ctx.createBiquadFilter();
          lp.type = 'lowpass'; lp.frequency.value = spatial.coupure;
          sortie.connect(lp); sortie = lp;
        }
      }
      sortie.connect(master);
      // le temps de la synthèse (purement synchrone : elle ne fait que
      // programmer des enveloppes WebAudio), on redirige `master` vers ce
      // bus spatialisé plutôt que de réécrire chaque fonction de synthèse
      var precedent = master;
      master = bus;
      var joue = false;
      try { joue = synthetiser(nom); } finally { master = precedent; }
      return joue;
    }

    /* Volume général 0..1 (SPEC-OPTION-001) : 0,28 est le niveau d'origine. */
    var volumeGeneral = 1;
    function setVolume(v) {
      volumeGeneral = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = 0.28 * volumeGeneral;
      return volumeGeneral;
    }
    function setEnabled(v) {
      enabled = !!v;
      if (!enabled && ctx && ctx.state === 'running') { try { ctx.suspend(); } catch (e) {} }
      if (enabled) resume();
      return enabled;
    }

    return {
      play: play, jouer: jouer, resume: resume, setEnabled: setEnabled, tonnerre: tonnerre, setVolume: setVolume,
      get volume() { return volumeGeneral; },
      ambiance: ambiance, majNappes: majNappes,
      positionAuditeur: positionAuditeur, volumeCategorie: volumeCategorie,
      get enabled() { return enabled; },
      get ready() { return !!ctx && ctx.state === 'running'; },
      SONS: SONS,
      get context() { return ctx; },
    };
  }

  MC.createAudio = createAudio;
})(typeof globalThis !== 'undefined' ? globalThis : this);
