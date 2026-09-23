/* audio.js — retours sonores synthétisés à la volée avec WebAudio.
   Aucun fichier son : le projet reste un dossier de fichiers texte.
   Tout est encapsulé pour que l'absence d'AudioContext (navigateur ancien,
   politique d'autoplay) dégrade en silence plutôt qu'en erreur. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  function createAudio() {
    var ctx = null, master = null, enabled = true, ready = false;

    function init() {
      if (ctx || !enabled) return ctx;
      try {
        var AC = G.AudioContext || G.webkitAudioContext;
        if (!AC) { enabled = false; return null; }
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.28;
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

    /* Nappes continues de pluie et de vent : deux bruits en boucle, filtrés,
       dont on règle le volume en douceur selon le temps qu'il fait. */
    var nappes = null;
    function creerNappes() {
      if (nappes || !ctx) return nappes;
      var n = ctx.sampleRate * 2, buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      function nappe(type, freq, q) {
        var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        var fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = freq; fl.Q.value = q;
        var g = ctx.createGain(); g.gain.value = 0;
        src.connect(fl); fl.connect(g); g.connect(master);
        src.start();
        return { gain: g, filtre: fl };
      }
      nappes = { pluie: nappe('bandpass', 2600, 0.4), vent: nappe('lowpass', 380, 0.8) };
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

    /* Renvoie true seulement si un son a VRAIMENT été émis. Une valeur de
       retour optimiste masquerait l'absence de WebAudio et rendrait les tests
       verts pour de mauvaises raisons. */
    function play(nom) {
      if (!enabled) return false;
      var f = SONS[nom];
      if (!f) return false;
      init();
      if (!ctx) return false;
      try { f(); } catch (e) { return false; }
      return true;
    }

    function setEnabled(v) {
      enabled = !!v;
      if (!enabled && ctx && ctx.state === 'running') { try { ctx.suspend(); } catch (e) {} }
      if (enabled) resume();
      return enabled;
    }

    return {
      play: play, resume: resume, setEnabled: setEnabled, tonnerre: tonnerre, ambiance: ambiance,
      get enabled() { return enabled; },
      get ready() { return !!ctx && ctx.state === 'running'; },
      SONS: SONS,
      get context() { return ctx; },
    };
  }

  MC.createAudio = createAudio;
})(typeof globalThis !== 'undefined' ? globalThis : this);
