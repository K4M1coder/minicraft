/* audio.js — retours sonores synthétisés à la volée avec WebAudio.
   Aucun fichier son : le projet reste un dossier de fichiers texte — tout
   est oscillateurs, bruit filtré et enveloppes.
   Tout est encapsulé pour que l'absence d'AudioContext (navigateur ancien,
   Node) ou un contexte suspendu (politique d'autoplay) dégrade en silence
   plutôt qu'en erreur.

   Les DÉCISIONS (quel son, quel volume et quel panoramique, quelle voix
   céder quand le budget est plein) viennent de MC.Ambiance (module pur,
   testé sous Node) ; ici on ne fait qu'exécuter. Le constructeur du
   contexte est injectable (`MC.createAudio({ AudioContext: Faux })`) : les
   tests Node vérifient ainsi, sur un faux contexte, que les nœuds sont créés
   et reliés comme il faut.

   Graphe : chaque son ponctuel a son bus (gain de catégorie × gain spatial)
   → panoramique → passe-bas d'occlusion → `entree` ; les nappes ont leur bus
   `nappesBus` → `entree` ; `entree` → filtre de l'auditeur (sous l'eau) →
   `master` (volume général) → sortie. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  function createAudio(optsAudio) {
    optsAudio = optsAudio || {};
    var ctx = null, master = null, entree = null, filtreAuditeur = null, nappesBus = null;
    var enabled = true;
    var Amb = MC.Ambiance; // module pur : décide, ici on ne fait que synthétiser
    var auditeurs = [{ x: 0, y: 0, z: 0, yaw: 0 }];
    var volumes = {}; // réglages par catégorie (SPEC-AUDIO-006) ; défauts dans Ambiance
    var MAX_VOIX = optsAudio.maxVoix || 24;
    var voix = [];            // sons ponctuels qui jouent encore (budget de voix)
    var sortie = null;        // là où la synthèse en cours branche ses nœuds
    var capture = null;       // sources et fin de la voix en cours de synthèse
    var hauteur = 1;          // multiplicateur de fréquence de la voix en cours
    var sousEau = false;
    var stats = { joues: 0, refuses: 0, evinces: 0, noeuds: 0 };
    var volumeGeneral = 1;

    function init() {
      if (ctx || !enabled) return ctx;
      try {
        var AC = optsAudio.AudioContext || G.AudioContext || G.webkitAudioContext;
        if (!AC) { enabled = false; return null; }
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.28 * volumeGeneral;
        master.connect(ctx.destination);
        filtreAuditeur = ctx.createBiquadFilter();
        filtreAuditeur.type = 'lowpass'; filtreAuditeur.frequency.value = 20000; filtreAuditeur.Q.value = 0.7;
        filtreAuditeur.connect(master);
        entree = ctx.createGain(); entree.gain.value = 1;
        entree.connect(filtreAuditeur);
        nappesBus = ctx.createGain(); nappesBus.gain.value = 1;
        nappesBus.connect(entree);
        sortie = entree;
        if (sousEau) appliquerSousEau();
      } catch (e) { enabled = false; ctx = null; }
      return ctx;
    }

    /* Les navigateurs suspendent l'audio tant qu'aucun geste utilisateur n'a eu
       lieu : on le réveille au premier clic plutôt que d'échouer en silence.
       Suspendu, le contexte accepte quand même nœuds et enveloppes : ils
       sonneront dès qu'il reprendra. */
    function resume() {
      init();
      if (ctx && ctx.state === 'suspended' && ctx.resume) {
        try { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* refusé : on réessaiera */ }
      }
      return !!ctx && ctx.state === 'running';
    }

    function noter(src, fin) {
      stats.noeuds++;
      if (capture) { capture.sources.push(src); if (fin > capture.fin) capture.fin = fin; }
    }

    /* Brique de base : une enveloppe courte sur un oscillateur.
       `type` : forme d'onde · `f0`→`f1` : glissando · `dur` : secondes. */
    function blip(type, f0, f1, dur, gain, delay) {
      if (!ctx) return;
      var t = ctx.currentTime + (delay || 0);
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = type;
      f0 *= hauteur; f1 = f1 ? f1 * hauteur : f1;
      osc.frequency.setValueAtTime(Math.max(1, f0), t);
      if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      // attaque très courte puis extinction : évite le clic de coupure
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain === undefined ? 0.5 : Math.max(0.0002, gain), t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(sortie || master);
      osc.start(t); osc.stop(t + dur + 0.02);
      noter(osc, t + dur + 0.02);
    }

    /* Bruit filtré : sert aux impacts mats (casser, poser, pas), au vent, à
       l'eau, aux grondements. Un seul tampon de bruit blanc, partagé (on n'en
       recrée pas un à chaque pas). */
    var tamponBruit = null;
    function bruit() {
      if (tamponBruit) return tamponBruit;
      var n = Math.floor(ctx.sampleRate * 2);
      tamponBruit = ctx.createBuffer(1, n, ctx.sampleRate);
      var d = tamponBruit.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      return tamponBruit;
    }
    function noise(dur, freq, q, gain, delay, filtre) {
      if (!ctx) return;
      var t = ctx.currentTime + (delay || 0);
      var src = ctx.createBufferSource();
      src.buffer = bruit();
      var bp = ctx.createBiquadFilter();
      bp.type = filtre || 'bandpass'; bp.frequency.value = Math.max(20, freq * hauteur); bp.Q.value = q || 1;
      var g = ctx.createGain();
      var v = gain === undefined ? 0.5 : gain;
      // décroissance plutôt qu'un bruit plat : un choc s'éteint
      g.gain.setValueAtTime(Math.max(0.0002, v), t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(bp); bp.connect(g); g.connect(sortie || master);
      // départ au hasard dans le tampon (bouclé : un long grondement ne
      // s'arrête pas au bout des 2 s) — deux pas de suite ne sont pas identiques
      src.loop = true;
      src.start(t, Math.random() * 1.5);
      src.stop(t + dur + 0.02);
      noter(src, t + dur + 0.02);
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
                              noise(0.10, 260, 1.4, 0.35, 0.12); },
      echange:  function () { blip('sine', 660, 990, 0.10, 0.3);
                              blip('sine', 990, 1320, 0.10, 0.25, 0.09); },
      brise:    function () { noise(0.22, 180, 0.7, 0.6);
                              blip('sawtooth', 240, 90, 0.25, 0.3); },
      sauver:   function () { blip('sine', 740, 740, 0.07, 0.25);
                              blip('sine', 988, 988, 0.12, 0.25, 0.07); },
      tonnerre: function () { grondement(0, 1); },
      froid:    function () { blip('sine', 1400, 900, 0.18, 0.12); },
      clic:     function () { jouerInteraction('interface'); },
    };
    // catégorie de volume des sons historiques (SONS), joués par `play`
    var CATEGORIE_SON = { casser: 'action', poser: 'action', ramasser: 'action', frapper: 'action', blesse: 'action',
                          mort: 'action', manger: 'action', brise: 'action', craft: 'interaction', echange: 'interaction',
                          sauver: 'interface', froid: 'interface', clic: 'interface', tonnerre: 'evenement' };

    /* SPEC-AUDIO-003 : un même geste (pas, minage, casse, pose, nage, chute,
       combat, tir) sonne différemment selon la matière — une couleur par
       matière (fréquence, résonance, filtre), modulée par l'action.
       `MC.Ambiance.sonAction` décide du nom ('action_<action>_<matiere>') ; ici
       on le synthétise. */
    var MATIERE = {
      herbe:   { f: 900,  q: 0.9, filtre: 'bandpass', crisse: 2600 },
      terre:   { f: 480,  q: 0.9, filtre: 'lowpass' },
      pierre:  { f: 300,  q: 1.6, filtre: 'bandpass', claque: 1200 },
      sable:   { f: 1500, q: 0.6, filtre: 'highpass', crisse: 3800 },
      gravier: { f: 1100, q: 0.7, filtre: 'bandpass', crisse: 3000 },
      bois:    { f: 520,  q: 3.2, filtre: 'bandpass', claque: 700 },
      neige:   { f: 1800, q: 0.5, filtre: 'lowpass',  crisse: 2400 },
      eau:     { f: 2200, q: 0.8, filtre: 'bandpass' },
      metal:   { f: 200,  q: 8,   filtre: 'bandpass', claque: 2300 },
      laine:   { f: 380,  q: 0.5, filtre: 'lowpass' },
      verre:   { f: 2600, q: 6,   filtre: 'bandpass', claque: 3200 },
      feuilles:{ f: 3000, q: 0.4, filtre: 'bandpass', crisse: 4200 },
    };
    function jouerAction(action, matiere) {
      var m = MATIERE[matiere] || MATIERE.pierre;
      switch (action) {
        case 'pas':
          noise(0.06, m.f, m.q, 0.24, 0, m.filtre);
          if (m.crisse) noise(0.05, m.crisse, 1.2, 0.08, 0.01);
          return true;
        case 'miner':
          noise(0.08, m.f * 0.9, m.q, 0.4, 0, m.filtre);
          if (m.claque) blip('square', m.claque, m.claque * 0.7, 0.03, 0.06);
          return true;
        case 'casser':
          noise(0.18, m.f * 0.75, m.q * 0.6, 0.55, 0, m.filtre);
          noise(0.12, m.f * 1.4, 1, 0.25, 0.04);
          return true;
        case 'poser':
          noise(0.07, m.f * 1.3, m.q, 0.42, 0, m.filtre);
          if (m.claque) blip('triangle', m.claque * 0.6, m.claque * 0.5, 0.04, 0.1);
          return true;
        case 'nage':
          noise(0.18, 1400, 0.9, 0.3, 0, 'bandpass');
          noise(0.14, 600, 0.7, 0.22, 0.07, 'lowpass');
          return true;
        case 'chute':
          noise(0.22, m.f * 0.5, 0.7, 0.6, 0, 'lowpass');
          blip('sine', 140, 60, 0.18, 0.3);
          return true;
        case 'combat':
          noise(0.08, 260, 0.8, 0.55);
          blip('triangle', 180, 90, 0.07, 0.2);
          return true;
        case 'tir':
          blip('triangle', 420, 180, 0.12, 0.25);              // corde qui se détend
          noise(0.16, 2400, 0.8, 0.18, 0.02, 'highpass');      // la flèche qui siffle
          return true;
        default: return false;
      }
    }

    /* SPEC-AUDIO-002 : sons par créature (cri, pas, blessure, mort, attaque).
       Une texture par famille ; la hauteur propre à chaque espèce (voix de
       MC.Ambiance.ESPECES, passée en `opts.hauteur` à `jouer`) les distingue. */
    function jouerCreature(nom) {
      switch (nom) {
        case 'cri_predateur': blip('sawtooth', 260, 420, 0.25, 0.22); blip('sawtooth', 420, 210, 0.45, 0.2, 0.22); return true;
        case 'cri_monstre':   blip('sawtooth', 140, 90, 0.55, 0.3); noise(0.5, 220, 1.5, 0.15, 0.05, 'lowpass'); return true;
        case 'cri_betail':    blip('triangle', 320, 240, 0.35, 0.28); blip('sine', 160, 120, 0.35, 0.12); return true;
        case 'cri_volaille':  blip('square', 900, 1300, 0.07, 0.16); blip('square', 1100, 1500, 0.06, 0.14, 0.1); return true;
        case 'cri_aquatique': blip('sine', 500, 820, 0.25, 0.16); noise(0.2, 900, 2, 0.06, 0.05); return true;
        case 'cri_carapace':  noise(0.06, 1800, 4, 0.12); noise(0.06, 1700, 4, 0.1, 0.09); return true;
        case 'cri_humain':    blip('triangle', 210, 260, 0.16, 0.18); blip('triangle', 250, 190, 0.2, 0.16, 0.16); return true;
        case 'cri_gardien':   blip('sawtooth', 70, 140, 0.7, 0.35); blip('square', 95, 60, 0.9, 0.18, 0.15); noise(0.8, 120, 0.9, 0.3, 0.1, 'lowpass'); return true;
        case 'cri_generique': blip('triangle', 300, 260, 0.25, 0.25); return true;
        case 'pas_bete':      noise(0.07, 260, 1.0, 0.28, 0, 'lowpass'); return true;
        case 'pas_monstre':   noise(0.10, 180, 0.9, 0.32, 0, 'lowpass'); return true;
        case 'pas_leger':     noise(0.04, 700, 1.6, 0.16); return true;
        case 'pas_humain':    noise(0.06, 420, 1.2, 0.24); return true;
        case 'pas_lourd':     noise(0.16, 90, 0.8, 0.5, 0, 'lowpass'); blip('sine', 60, 40, 0.15, 0.25); return true;
        case 'blesse_monstre': blip('sawtooth', 200, 90, 0.25, 0.35); return true;
        case 'blesse_petit':  blip('square', 1200, 700, 0.1, 0.18); return true;
        case 'blesse_eau':    noise(0.12, 1200, 1.2, 0.35); return true;
        case 'blesse_humain': blip('triangle', 380, 220, 0.18, 0.3); return true;
        case 'mort_monstre':  blip('sawtooth', 220, 40, 0.7, 0.4); return true;
        case 'mort_petit':    blip('square', 1000, 300, 0.25, 0.18); return true;
        case 'mort_eau':      noise(0.3, 500, 0.9, 0.4); return true;
        case 'mort_humain':   blip('triangle', 300, 90, 0.6, 0.32); return true;
        case 'mort_gardien':  blip('sawtooth', 160, 30, 1.6, 0.45); noise(1.4, 90, 0.8, 0.5, 0.1, 'lowpass'); return true;
        case 'morsure':       noise(0.06, 1500, 1.5, 0.35); noise(0.06, 900, 1.5, 0.3, 0.07); return true;
        case 'charge':        noise(0.14, 200, 0.9, 0.5, 0, 'lowpass'); blip('triangle', 150, 80, 0.12, 0.2); return true;
        case 'frapper_lourd': noise(0.2, 120, 0.8, 0.7, 0, 'lowpass'); blip('sine', 90, 45, 0.25, 0.35); return true;
        default: return false;
      }
    }

    /* SPEC-AUDIO-004 : interactions (portes et trappes, coffres, fourneau,
       établi, échanges, interface). `craft` et `echange` existent déjà dans
       SONS ; le reste est synthétisé ici. */
    function jouerInteraction(nom) {
      switch (nom) {
        case 'porte':     blip('sawtooth', 180, 140, 0.18, 0.08); noise(0.14, 320, 1.4, 0.4, 0.12); return true;   // gond, puis le battant
        case 'trappe':    noise(0.09, 520, 1.8, 0.38); blip('triangle', 300, 200, 0.05, 0.12); return true;
        case 'coffre':    blip('sawtooth', 220, 300, 0.2, 0.06); noise(0.15, 260, 1.1, 0.45, 0.15); blip('sine', 500, 700, 0.08, 0.2, 0.25); return true;
        case 'fourneau':  noise(0.2, 200, 0.7, 0.4, 0, 'lowpass'); noise(0.5, 900, 0.5, 0.12, 0.1, 'bandpass'); return true;
        case 'interface': blip('sine', 700, 900, 0.05, 0.18); return true;
        default: return false;
      }
    }

    /* SPEC-AUDIO-005 : événements (tonnerre : `grondement`, éruption,
       cyclone et tornade, succès, chapitres et fins d'histoire, réveil d'un
       gardien). */
    function jouerEvenement(nom, o) {
      var f = o && o.force !== undefined ? Math.max(0.2, o.force) : 1;
      switch (nom) {
        case 'eruption': noise(0.4, 90, 0.6, 0.7, 0, 'lowpass'); noise(1.6, 60, 0.8, 0.6, 0.1, 'lowpass'); noise(0.8, 1400, 0.6, 0.15, 0.3, 'highpass'); return true;
        case 'cyclone':  noise(2.4, 500, 0.5, 0.45 * f); noise(2.4, 220, 0.6, 0.4 * f, 0.05, 'lowpass'); blip('sine', 300, 520, 2.2, 0.05 * f, 0.2); return true;
        case 'tornade':  noise(3.5, 140, 0.7, 0.6 * f, 0, 'lowpass'); noise(3.0, 700, 0.4, 0.25 * f, 0.2); blip('sawtooth', 55, 75, 3.2, 0.08 * f); return true;
        case 'succes':   blip('sine', 660, 990, 0.1, 0.3); blip('sine', 990, 1320, 0.12, 0.28, 0.1); blip('sine', 1320, 1320, 0.2, 0.2, 0.22); return true;
        case 'chapitre': blip('triangle', 440, 660, 0.2, 0.3); blip('triangle', 660, 880, 0.25, 0.28, 0.15); return true;
        case 'fin_histoire': blip('sine', 523, 523, 0.3, 0.3); blip('sine', 659, 659, 0.3, 0.28, 0.25); blip('sine', 784, 784, 0.5, 0.3, 0.5); blip('sine', 1046, 1046, 0.9, 0.3, 0.8); return true;
        case 'gardien':  blip('sawtooth', 90, 200, 0.6, 0.4); blip('square', 60, 45, 1.2, 0.2, 0.3); noise(0.9, 140, 0.8, 0.4, 0.1, 'lowpass'); return true;
        default: return false;
      }
    }

    /* Point d'entrée unique de la synthèse : SONS (historique) d'abord, puis
       chaque famille décidée par ambiance.js. Renvoie false sans rien jouer
       si le nom n'est reconnu nulle part — jamais d'exception qui remonterait
       jusqu'au jeu pour un nom de son mal orthographié. */
    function synthetiser(nom, o) {
      if (typeof nom !== 'string') return false;
      if (SONS[nom]) { SONS[nom](); return true; }
      if (nom.indexOf('action_') === 0) {
        var reste = nom.slice('action_'.length);
        var us = reste.indexOf('_');
        var action = us >= 0 ? reste.slice(0, us) : reste;
        var matiere = us >= 0 ? reste.slice(us + 1) : '';
        return jouerAction(action, matiere);
      }
      if (jouerCreature(nom)) return true;
      if (jouerInteraction(nom)) return true;
      if (jouerEvenement(nom, o)) return true;
      return false;
    }

    /* Tonnerre : un craquement, puis un long grondement grave. Le son voyage à
       340 blocs par seconde : un éclair lointain gronde après son flash. */
    function grondement(distance, force) {
      var retard = Math.min(6, (distance || 0) / 340);
      var f = force === undefined ? 1 : force;
      var att = Math.max(0.15, 1 - (distance || 0) / 260);
      noise(0.25, 1800, 0.6, 0.5 * f * att, retard);
      noise(2.8, 90, 0.7, 0.9 * f * att, retard + 0.05, 'lowpass');
      noise(1.6, 160, 0.9, 0.5 * f * att, retard + 0.4, 'lowpass');
      return retard;
    }
    /* `opts` : { x, z } du point d'impact, pour le panoramique (le volume
       suit déjà la distance, et le retard le trajet du son). */
    function tonnerre(distance, force, opts) {
      var retard = Math.min(6, (distance || 0) / 340);
      if (!enabled) return retard;
      init();
      if (!ctx) return retard;
      var spatial = null;
      if (opts && opts.x !== undefined) {
        var a = auditeurs[0];
        spatial = Amb ? Amb.spatialiser(a, { x: opts.x, y: a.y, z: opts.z }, { portee: 1e9 }) : null;
        if (spatial) spatial.gain = 1;      // le volume, c'est `grondement` qui le règle d'après la distance
      }
      executer('evenement', spatial, {}, function () { grondement(distance, force); return true; });
      return retard;
    }

    /* Voix ponctuelle : budget (MC.Ambiance.admettreVoix), bus de catégorie,
       panoramique et passe-bas d'occlusion, puis la synthèse `fn` branchée sur
       ce bus. Renvoie true seulement si des nœuds ont réellement été créés. */
    function purgerVoix() {
      var t = ctx.currentTime;
      for (var i = voix.length - 1; i >= 0; i--) if (voix[i].fin <= t) voix.splice(i, 1);
    }
    function arreterVoix(v) {
      v.sources.forEach(function (s) { try { s.stop(); } catch (e) { /* déjà arrêtée */ } });
      try { v.bus.disconnect(); } catch (e) { /* rien */ }
    }
    function executer(categorie, spatial, o, fn) {
      var catVol = Amb ? Amb.volumeCategorie(categorie, volumes) : 1;
      var gain = catVol * (spatial ? spatial.gain : 1) * (o.volume === undefined ? 1 : o.volume);
      if (gain < 0.002) { stats.refuses++; return false; }      // inaudible : pas une voix de plus
      purgerVoix();
      var dec = Amb ? Amb.admettreVoix(voix, { categorie: categorie, gain: gain }, MAX_VOIX) : { admis: voix.length < MAX_VOIX, evincer: -1 };
      if (!dec.admis) { stats.refuses++; return false; }
      if (dec.evincer >= 0) { arreterVoix(voix[dec.evincer]); voix.splice(dec.evincer, 1); stats.evinces++; }
      var bus = ctx.createGain();
      bus.gain.value = gain;
      var bout = bus;
      if (spatial) {
        if (typeof ctx.createStereoPanner === 'function' && Math.abs(spatial.pan) > 0.001) {
          var pan = ctx.createStereoPanner();
          pan.pan.value = spatial.pan;
          bout.connect(pan); bout = pan;
        }
        if (spatial.coupure < 20000) {
          var lp = ctx.createBiquadFilter();
          lp.type = 'lowpass'; lp.frequency.value = spatial.coupure;
          bout.connect(lp); bout = lp;
        }
      }
      bout.connect(entree);
      var precSortie = sortie, precCapture = capture, precHauteur = hauteur;
      sortie = bus; capture = { sources: [], fin: ctx.currentTime }; hauteur = o.hauteur || 1;
      var joue = false;
      try { joue = !!fn(); } catch (e) { joue = false; }
      var cap = capture;
      sortie = precSortie; capture = precCapture; hauteur = precHauteur;
      if (!joue || !cap.sources.length) { try { bus.disconnect(); } catch (e) { /* rien */ } return false; }
      voix.push({ categorie: categorie, gain: gain, fin: cap.fin + 0.05, sources: cap.sources, bus: bus });
      stats.joues++;
      return true;
    }

    /* Nappes continues (SPEC-AUDIO-001) : un bruit blanc en boucle par nappe,
       chacune avec son propre filtre — vent, pluie, mer, ressac (houle lente),
       rivière, cascade, feuillage, grillons (stridulation hachée), résonance
       des grottes, rumeur des villes, grondement des volcans. `ambiance()`
       (historique, pluie + vent seulement) reste disponible ; `majNappes()`
       couvre tout. Les nappes ne comptent pas dans le budget de voix : onze
       boucles, créées une fois, qu'on monte et qu'on baisse. */
    var NAPPE_PARAMS = {
      pluie:     { type: 'bandpass', freq: 2600, q: 0.4 },
      vent:      { type: 'lowpass',  freq: 380,  q: 0.8 },
      mer:       { type: 'lowpass',  freq: 220,  q: 0.9 },
      ressac:    { type: 'lowpass',  freq: 700,  q: 0.6, lfo: { freq: 0.11, profondeur: 0.9 } },
      riviere:   { type: 'bandpass', freq: 1800, q: 0.6, lfo: { freq: 0.7, profondeur: 0.2 } },
      cascade:   { type: 'highpass', freq: 900,  q: 0.5 },
      feuillage: { type: 'bandpass', freq: 3200, q: 0.3, lfo: { freq: 0.3, profondeur: 0.5 } },
      grillons:  { type: 'bandpass', freq: 4200, q: 6,   lfo: { freq: 4.5, profondeur: 1, forme: 'square' } },
      grotte:    { type: 'lowpass',  freq: 140,  q: 1.2 },
      ville:     { type: 'bandpass', freq: 600,  q: 0.5 },
      volcan:    { type: 'lowpass',  freq: 70,   q: 1.0 },
    };
    var nappes = null;
    function creerNappes() {
      if (nappes || !ctx) return nappes;
      var buf = bruit();
      function nappe(p) {
        var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        var fl = ctx.createBiquadFilter(); fl.type = p.type; fl.frequency.value = p.freq; fl.Q.value = p.q;
        var g = ctx.createGain(); g.gain.value = 0;
        var sortieNappe = g;
        if (p.lfo) {
          // modulation lente du volume : houle du ressac, stridulation des grillons
          var mod = ctx.createGain(); mod.gain.value = 1 - p.lfo.profondeur / 2;
          var lfo = ctx.createOscillator(); lfo.type = p.lfo.forme || 'sine'; lfo.frequency.value = p.lfo.freq;
          var prof = ctx.createGain(); prof.gain.value = p.lfo.profondeur / 2;
          lfo.connect(prof); prof.connect(mod.gain);
          lfo.start();
          g.connect(mod); sortieNappe = mod;
        }
        src.connect(fl); fl.connect(g); sortieNappe.connect(nappesBus);
        src.start();
        stats.noeuds++;
        return { gain: g, filtre: fl };
      }
      nappes = {};
      for (var k in NAPPE_PARAMS) nappes[k] = nappe(NAPPE_PARAMS[k]);
      return nappes;
    }
    function ambiance(pluie, vent, neige) {
      if (!enabled || !ctx) return false;
      creerNappes();
      var t = ctx.currentTime;
      // la neige tombe sans bruit : elle ne compte que pour un souffle
      nappes.pluie.gain.gain.setTargetAtTime(Math.max(0, pluie) * 0.55, t, 0.6);
      nappes.vent.gain.gain.setTargetAtTime(Math.max(0, vent) * 0.5 + (neige || 0) * 0.08, t, 0.8);
      nappes.vent.filtre.frequency.setTargetAtTime(260 + vent * 520, t, 0.8);
      return true;
    }

    /* `etat` : le contexte {biome, nuit, pluie, vent, neige, sousTerre,
       eauProche, villeProche, volcanProche, riviereProche, cascadeProche,
       merProche, feuillageProche} que game.js assemble à partir du monde, de
       la météo et de la sonde du lieu. La décision (quelle nappe, à quel
       gain) vient de MC.Ambiance ; ici on ne fait que lisser les gains vers
       leur nouvelle cible. Fonctionne aussi contexte suspendu : les nœuds sont
       prêts et les gains à jour quand le navigateur autorise le son. */
    var derniersGains = {};
    function majNappes(etat) {
      // jamais de contexte créé ici : la boucle tourne dès le menu, avant tout
      // geste — le contexte naît au premier `resume()` (clic) ou au premier son
      if (!enabled || !ctx) return false;
      creerNappes();
      var gains = Amb ? Amb.nappes(etat) : {};
      var catVol = Amb ? Amb.volumeCategorie('ambiance', volumes) : 1;
      var t = ctx.currentTime;
      for (var k in nappes) {
        var v = (gains[k] || 0) * catVol;
        derniersGains[k] = v;
        nappes[k].gain.gain.setTargetAtTime(v, t, 0.7);
      }
      if (etat && etat.vent !== undefined) nappes.vent.filtre.frequency.setTargetAtTime(260 + Math.max(0, Math.min(1, etat.vent)) * 520, t, 0.8);
      return true;
    }

    /* Son historique (SONS) ou décidé par ambiance.js, sans position : joué à
       l'oreille, avec le volume de sa catégorie. Renvoie true seulement si un
       son a VRAIMENT été émis — une valeur optimiste masquerait l'absence de
       WebAudio et rendrait les tests verts pour de mauvaises raisons. */
    function play(nom) {
      return jouer(nom, { categorie: CATEGORIE_SON[nom] || 'action' });
    }

    /* SPEC-AUDIO-006 : position/orientation de l'auditeur (le joueur local),
       mise à jour chaque image par game.js. En écran partagé, `auditeursVues`
       en pose un par vue : chaque son se règle sur le plus proche. */
    function positionAuditeur(x, y, z, yaw) {
      auditeurs.length = 1;
      auditeurs[0] = { x: x || 0, y: y || 0, z: z || 0, yaw: yaw || 0 };
    }
    function auditeursVues(liste) {
      if (!liste || !liste.length) return auditeurs.length;
      auditeurs = liste.map(function (a) { return { x: a.x || 0, y: a.y || 0, z: a.z || 0, yaw: a.yaw || 0 }; });
      return auditeurs.length;
    }

    /* L'auditeur a la tête sous l'eau : tout passe par un passe-bas
       (MC.Ambiance.etouffementAuditeur) — les nappes comme les sons ponctuels. */
    function appliquerSousEau() {
      if (!ctx) return;
      var e = Amb ? Amb.etouffementAuditeur(sousEau) : { coupure: sousEau ? 650 : 20000, gain: sousEau ? 0.6 : 1 };
      var t = ctx.currentTime;
      filtreAuditeur.frequency.setTargetAtTime(e.coupure, t, 0.08);
      entree.gain.setTargetAtTime(e.gain, t, 0.08);
    }
    function setSousEau(v) {
      v = !!v;
      if (v === sousEau) return sousEau;
      sousEau = v;
      appliquerSousEau();
      return sousEau;
    }

    /* Volume d'une catégorie : lecture (sans second argument) ou réglage
       (0..1, depuis les options — SPEC-AUDIO-006, MC.Ambiance.OPTIONS_VOLUME). */
    function volumeCategorie(categorie, v) {
      if (v === undefined) return Amb ? Amb.volumeCategorie(categorie, volumes) : 1;
      volumes[categorie] = Math.max(0, Math.min(1, v));
      return volumes[categorie];
    }

    /* `jouer(nom, opts)` : API étendue au-dessus de `play`. `opts` peut
       porter {x,y,z} (position de la source dans le monde — sinon le son
       n'est pas spatialisé), `categorie` (pour le volume de catégorie),
       `sousEau`/`roche` (occlusion), `portee`, `hauteur` (voix d'une espèce),
       `force`, `volume`. Le calcul (gain/pan/filtre) vient de
       MC.Ambiance.spatialiser sur l'auditeur le plus proche. */
    function jouer(nom, opts) {
      if (!enabled) return false;
      init();
      if (!ctx) return false;
      opts = opts || {};
      var categorie = opts.categorie || 'action';
      var spatial = null;
      if (opts.x !== undefined || opts.y !== undefined || opts.z !== undefined) {
        var src = { x: opts.x || 0, y: opts.y === undefined ? auditeurs[0].y : opts.y, z: opts.z || 0 };
        var a = auditeurs[Amb ? Amb.choisirAuditeur(auditeurs, src) : 0];
        spatial = Amb ? Amb.spatialiser(a, src, opts) : { gain: 1, pan: 0, coupure: 20000 };
      }
      return executer(categorie, spatial, opts, function () { return synthetiser(nom, opts); });
    }

    /* Volume général 0..1 (SPEC-OPTION-001) : 0,28 est le niveau d'origine. */
    function setVolume(v) {
      volumeGeneral = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = 0.28 * volumeGeneral;
      return volumeGeneral;
    }
    function setEnabled(v) {
      enabled = !!v;
      if (!enabled && ctx && ctx.state === 'running') { try { ctx.suspend(); } catch (e) { /* rien */ } }
      if (enabled) resume();
      return enabled;
    }

    return {
      play: play, jouer: jouer, resume: resume, setEnabled: setEnabled, tonnerre: tonnerre, setVolume: setVolume,
      get volume() { return volumeGeneral; },
      ambiance: ambiance, majNappes: majNappes,
      positionAuditeur: positionAuditeur, auditeursVues: auditeursVues, volumeCategorie: volumeCategorie,
      setSousEau: setSousEau,
      get sousEau() { return sousEau; },
      get enabled() { return enabled; },
      get ready() { return !!ctx && ctx.state === 'running'; },
      get voixActives() { if (ctx) purgerVoix(); return voix.length; },
      get maxVoix() { return MAX_VOIX; },
      get gainsNappes() { return derniersGains; },
      get auditeurs() { return auditeurs; },
      stats: stats,
      SONS: SONS,
      get context() { return ctx; },
    };
  }

  MC.createAudio = createAudio;
})(typeof globalThis !== 'undefined' ? globalThis : this);
