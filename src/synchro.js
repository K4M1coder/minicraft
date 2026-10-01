/* synchro.js — le serveur fait autorité, le client prédit.
   Logique pure, partagée par le serveur et le client.

   Principe : le client n'envoie pas sa position mais ses ENTRÉES (touches,
   regard, durée de l'image), numérotées. Le serveur rejoue ces entrées avec
   le MÊME code de déplacement (player.js) et renvoie la position qui fait
   foi, avec le numéro de la dernière entrée traitée. Le client, lui, applique
   ses entrées tout de suite (prédiction : aucune latence ressentie), les garde
   en mémoire, et à chaque état reçu repart de la position du serveur puis
   rejoue celles que le serveur n'a pas encore vues (réconciliation). */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var TOUCHES = ['forward', 'back', 'left', 'right', 'jump', 'sprint'];

  // six touches tiennent sur six bits
  function encoderTouches(keys) {
    var k = 0;
    for (var i = 0; i < TOUCHES.length; i++) if (keys && keys[TOUCHES[i]]) k |= 1 << i;
    return k;
  }
  function decoderTouches(k) {
    var o = {};
    for (var i = 0; i < TOUCHES.length; i++) o[TOUCHES[i]] = (k >> i) & 1 ? 1 : 0;
    return o;
  }

  function arrondi(v, n) { var k = Math.pow(10, n); return Math.round(v * k) / k; }

  /* ─── côté client : entrées en attente de confirmation ─────────────────── */
  var MAX_EN_ATTENTE = 600;              // dix secondes à 60 images/s
  function creerPrediction() {
    var enAttente = [];
    var suivant = 1;
    return {
      enAttente: enAttente,
      // mémorise une entrée ; renvoie la version à envoyer au serveur
      enregistrer: function (dt, keys, yaw, pitch, vol) {
        /* Arrondie comme elle voyagera sur le réseau : client et serveur rejouent
           alors EXACTEMENT les mêmes nombres, et la prédiction tombe juste. */
        var e = { s: suivant++, dt: arrondi(dt, 4), k: encoderTouches(keys), yaw: arrondi(yaw, 4),
                  pitch: arrondi(pitch, 4), v: vol ? 1 : 0 };
        enAttente.push(e);
        if (enAttente.length > MAX_EN_ATTENTE) enAttente.shift();
        return e;
      },
      // le serveur a traité jusqu'à `s` : on oublie ce qui est confirmé
      confirmer: function (s) {
        while (enAttente.length && enAttente[0].s <= s) enAttente.shift();
        return enAttente;
      },
      get suivant() { return suivant; },
    };
  }

  /* Rejoue une suite d'entrées sur un joueur (player.js). Sert au serveur,
     pour simuler, et au client, pour réconcilier : un seul code, donc les deux
     calculent exactement la même trajectoire. */
  function rejouer(joueur, entrees) {
    var st = joueur.state;
    for (var i = 0; i < entrees.length; i++) {
      var e = entrees[i];
      st.yaw = e.yaw; st.pitch = e.pitch;
      if (e.v !== undefined && st.regles && st.regles.vole) st.flying = !!e.v;
      joueur.updateMovement(e.dt, decoderTouches(e.k));
    }
    return entrees.length;
  }

  /* Véhicule (SPEC-SYNC-022) : le serveur dit à bord de QUEL véhicule le joueur
     se trouve (`serveur.veh`, absent à pied). `trouver(eid)` rend la réplique
     du véhicule que le client connaît (net.mobsDistants) : on s'y embarque pour
     prédire sa conduite, ou on la quitte quand le serveur nous a fait descendre.
     La réplique prédite cesse d'être interpolée (`predit`). */
  function ajusterMonture(joueur, serveur, trouver) {
    var st = joueur.state, v = serveur.veh;
    var mt = st.monture;
    if (mt && (!v || mt.eid !== v.eid)) {
      mt.conducteur = null; mt.predit = false;
      if (mt.cible) { mt.cible.x = mt.pos.x; mt.cible.y = mt.pos.y; mt.cible.z = mt.pos.z; }
      st.monture = null;
    }
    if (v && !st.monture && trouver) {
      var rep = trouver(v.eid);
      if (rep) {
        rep.conducteur = st; rep.predit = true;
        rep.vel = rep.vel || { x: 0, y: 0, z: 0 };
        st.monture = rep;
      }
    }
    if (v && st.monture && st.monture.eid === v.eid && MC.Vehicules) MC.Vehicules.appliquerSync(st.monture, v);
    return st.monture;
  }

  /* Réconciliation : on adopte l'état du serveur, puis on rejoue les entrées
     qu'il n'a pas encore traitées. Renvoie l'écart entre la position prédite
     avant correction et celle qui en résulte (0 quand la prédiction était
     juste — le cas courant). */
  function reconcilier(joueur, serveur, prediction, trouver) {
    var st = joueur.state;
    var avant = { x: st.pos.x, y: st.pos.y, z: st.pos.z };
    ajusterMonture(joueur, serveur, trouver);
    st.pos.x = serveur.x; st.pos.y = serveur.y; st.pos.z = serveur.z;
    st.vel.x = serveur.vx || 0; st.vel.y = serveur.vy || 0; st.vel.z = serveur.vz || 0;
    st.onGround = !!serveur.sol;
    if (typeof serveur.chute === 'number') st.fallFrom = serveur.chute;
    else st.fallFrom = null;
    /* À bord côté serveur mais réplique pas encore reçue : rejouer les entrées
       comme une marche à pied ferait dériver le joueur hors de son siège. */
    if (serveur.veh && !st.monture) { prediction.confirmer(serveur.s); return Math.hypot(st.pos.x - avant.x, st.pos.y - avant.y, st.pos.z - avant.z); }
    rejouer(joueur, prediction.confirmer(serveur.s));
    return Math.hypot(st.pos.x - avant.x, st.pos.y - avant.y, st.pos.z - avant.z);
  }

  /* ─── côté serveur : budget de temps, contre l'accélération tricheuse ────
     Un client ne peut pas simuler plus de temps qu'il ne s'en est écoulé :
     chaque seconde réelle lui crédite une seconde de simulation (avec une
     petite réserve pour les à-coups du réseau). Des entrées au-delà sont
     refusées : envoyer des images plus longues ne fait pas courir plus vite. */
  var RESERVE = 0.25, DT_MAX = 0.1;
  function creerBudget() {
    var credit = RESERVE;
    return {
      crediter: function (dtReel) { credit = Math.min(RESERVE * 2, credit + dtReel); return credit; },
      consommer: function (dt) {
        if (!(dt > 0) || dt > DT_MAX || dt > credit) return false;
        credit -= dt;
        return true;
      },
      get credit() { return credit; },
    };
  }

  /* État d'un joueur tel que le serveur l'envoie à son client : position,
     vitesse, sol, chute en cours, et les statistiques qui font foi. */
  function etatJoueur(joueur, dernier) {
    var st = joueur.state;
    var e = {
      /* Pleine précision : arrondie, la position pourrait tomber un demi-
         millième DANS un mur, où le joueur resterait coincé. */
      s: dernier, x: st.pos.x, y: st.pos.y, z: st.pos.z,
      vx: st.vel.x, vy: st.vel.y, vz: st.vel.z,
      sol: st.onGround ? 1 : 0, chute: st.fallFrom === null ? null : st.fallFrom,
      pv: st.hp, faim: st.hunger, air: +st.air.toFixed(1), mort: st.dead ? 1 : 0,
    };
    // à bord : l'état exact du véhicule conduit (SPEC-SYNC-022)
    if (st.monture && !st.monture.dead && MC.Vehicules) e.veh = MC.Vehicules.etatSync(st.monture);
    return e;
  }
  // les statistiques du serveur écrasent celles du client
  function appliquerStats(st, e) {
    if (typeof e.pv === 'number') st.hp = e.pv;
    if (typeof e.faim === 'number') st.hunger = e.faim;
    if (typeof e.air === 'number') st.air = e.air;
    st.dead = !!e.mort;
  }

  MC.Synchro = { TOUCHES: TOUCHES, encoderTouches: encoderTouches, decoderTouches: decoderTouches,
                 creerPrediction: creerPrediction, rejouer: rejouer, reconcilier: reconcilier,
                 creerBudget: creerBudget, etatJoueur: etatJoueur, ajusterMonture: ajusterMonture, appliquerStats: appliquerStats,
                 DT_MAX: DT_MAX, RESERVE: RESERVE, arrondi: arrondi };
})(typeof globalThis !== 'undefined' ? globalThis : this);
