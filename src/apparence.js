/* apparence.js — l'allure des créatures, des habitants et des avatars
   (SPEC-MOB-010). Logique pure : variantes tirées de l'identité (taille,
   teinte, vêtements selon le métier, accessoires), poses animées (marche,
   course, nage, attaque, regard vers la cible) et niveau de détail selon la
   distance. Le rendu (render.js) ne fait qu'appliquer ces nombres. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  function hache(n, k) {
    var h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(k | 0, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 15), 0x27d4eb2f);
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  }
  /* Une graine stable depuis un identifiant (nombre ou texte). */
  function graineDe(id) {
    if (typeof id === 'number') return id | 0;
    var s = String(id || ''), h = 2166136261;
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h | 0;
  }

  /* Vêtements par métier : haut, bas, et l'accessoire qui le signale. */
  var METIERS = {
    habitant:          { haut: [0x6b4f3a, 0x5a6a3a, 0x7a3a3a, 0x3a4a6a], bas: [0x3a2e24, 0x2e2a3a], accessoires: [null, 'bonnet', null] },
    fermier:           { haut: [0x8a6a3a, 0x6a7a3a], bas: [0x3a4a6a], accessoires: ['chapeau_paille'] },
    forgeron:          { haut: [0x3a3a3e], bas: [0x2a2a2e], accessoires: ['tablier'] },
    menuisier:         { haut: [0x8a5a2a], bas: [0x4a3a2a], accessoires: ['tablier'] },
    tisserand:         { haut: [0xa04a8a, 0x4a8aa0], bas: [0x3a2e3a], accessoires: ['echarpe'] },
    marchand:          { haut: [0x2a6a4a, 0x6a2a4a], bas: [0x2a2a3a], accessoires: ['sac'] },
    marchand_ambulant: { haut: [0xa07a3a], bas: [0x4a3a2a], accessoires: ['sac', 'chapeau_paille'] },
    banquier:          { haut: [0x1e1e2a], bas: [0x1e1e2a], accessoires: ['lunettes', 'chapeau_haut'] },
    aubergiste:        { haut: [0xe8e0d0], bas: [0x5a3a2a], accessoires: ['tablier'] },
    guide:             { haut: [0x2a5aa0], bas: [0x2a2a3a], accessoires: ['casquette'] },
    garde:             { haut: [0x3a5a9a], bas: [0x2a3a5a], accessoires: ['casque'] },
    pretre:            { haut: [0xe8e8f0], bas: [0xe8e8f0], accessoires: ['capuche'] },
  };
  var PEAUX = [0xf1c8a0, 0xd9a577, 0xb07a50, 0x8a5a36, 0x5e3c24];

  /* La variante d'un individu : même identité, même allure, sur tous les postes. */
  function variante(type, id, role) {
    var g = graineDe(id);
    var r = function (k) { return hache(g, k); };
    var v = { echelle: 0.9 + r(1) * 0.2, teinte: (r(2) - 0.5) * 0.24, palette: Math.floor(r(3) * 4), accessoire: null };
    var humain = type === 'villager' || type === 'garde' || type === 'joueur' || type === 'pillager' || type === 'vindicator';
    if (humain) {
      var m = METIERS[role] || METIERS[type === 'garde' ? 'garde' : 'habitant'];
      v.peau = PEAUX[Math.floor(r(4) * PEAUX.length)];
      v.haut = m.haut[Math.floor(r(5) * m.haut.length)];
      v.bas = m.bas[Math.floor(r(6) * m.bas.length)];
      v.accessoire = m.accessoires[Math.floor(r(7) * m.accessoires.length)];
      v.cheveux = [0x2a1a10, 0x6a4a2a, 0xc8a060, 0x8a2a1a, 0xd8d8d8][Math.floor(r(8) * 5)];
      if (type === 'joueur') { v.haut = [0x4a86c8, 0xc8864a, 0x4ac886, 0xc84a86, 0x8a4ac8][Math.floor(r(5) * 5)]; v.accessoire = null; }
    }
    return v;
  }
  /* Une couleur éclaircie ou assombrie de `k` (−1..1). */
  function teinter(c, k) {
    var rr = (c >> 16) & 255, gg = (c >> 8) & 255, bb = c & 255;
    function f(x) { return Math.max(0, Math.min(255, Math.round(k >= 0 ? x + (255 - x) * k : x * (1 + k)))); }
    return (f(rr) << 16) | (f(gg) << 8) | f(bb);
  }

  /* Allure : 'repos', 'marche', 'course', 'nage', selon la vitesse et le milieu. */
  function allure(vitesse, vitesseMax, nage) {
    if (nage) return 'nage';
    if (vitesse < 0.15) return 'repos';
    return vitesse > Math.max(1.2, (vitesseMax || 2) * 0.75) ? 'course' : 'marche';
  }
  /* Avance la phase du pas (radians) selon la vitesse. */
  function avancerPhase(phase, vitesse, dt) { return (phase + vitesse * dt * 3.2) % (Math.PI * 2); }

  /* Pose : angles des membres (radians), buste penché, tête (lacet, tangage).
     `etat` : { allure, phase, attaque (0..1 depuis le début du coup, ou -1),
     regard { lacet, tangage } relatif au corps, temps }. */
  function pose(etat) {
    var ph = etat.phase || 0, al = etat.allure || 'repos', t = etat.temps || 0;
    var amp = al === 'course' ? 1.0 : al === 'marche' ? 0.55 : al === 'nage' ? 0.35 : 0;
    var p = {
      jambeG: Math.sin(ph) * amp, jambeD: -Math.sin(ph) * amp,
      brasG: -Math.sin(ph) * amp * 0.8, brasD: Math.sin(ph) * amp * 0.8,
      buste: al === 'course' ? 0.18 : al === 'nage' ? 1.1 : 0,
      tete: { lacet: 0, tangage: 0 },
      souffle: al === 'repos' ? Math.sin(t * 2) * 0.02 : 0,
    };
    if (al === 'nage') {                     // brasse : bras en avant, battement des jambes
      p.brasG = -2.4 + Math.sin(ph * 2) * 0.5; p.brasD = -2.4 + Math.sin(ph * 2 + Math.PI) * 0.5;
      p.jambeG = Math.sin(ph * 3) * 0.35; p.jambeD = -Math.sin(ph * 3) * 0.35;
    }
    if (etat.attaque >= 0 && etat.attaque <= 1) {
      // bras droit levé puis abattu
      var a = etat.attaque;
      p.brasD = a < 0.4 ? -2.2 * (a / 0.4) : -2.2 + 2.6 * ((a - 0.4) / 0.6);
      p.buste += Math.sin(a * Math.PI) * 0.15;
    }
    if (etat.regard) {
      p.tete.lacet = Math.max(-1.2, Math.min(1.2, etat.regard.lacet || 0));
      p.tete.tangage = Math.max(-0.7, Math.min(0.7, etat.regard.tangage || 0));
    }
    return p;
  }

  /* Le regard vers une cible, relatif au lacet du corps (l'avant est −Z). */
  function regard(pos, yaw, yeux, cible) {
    if (!cible) return null;
    var dx = cible.x - pos.x, dy = cible.y - (pos.y + yeux), dz = cible.z - pos.z;
    var d = Math.hypot(dx, dz);
    if (d < 0.01 || d > 24) return null;
    var monde = Math.atan2(-dx, -dz), rel = monde - yaw;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    return { lacet: rel, tangage: Math.atan2(dy, d) };
  }

  /* Niveau de détail : le modèle complet de près, une silhouette simple au loin. */
  var DETAIL = { complet: 40, simple: 160 };
  function niveauDetail(distance) {
    return distance <= DETAIL.complet ? 'complet' : distance <= DETAIL.simple ? 'simple' : 'cache';
  }

  MC.Apparence = { variante: variante, teinter: teinter, allure: allure, avancerPhase: avancerPhase, pose: pose,
                   regard: regard, niveauDetail: niveauDetail, graineDe: graineDe, METIERS: METIERS, DETAIL: DETAIL };
})(typeof globalThis !== 'undefined' ? globalThis : this);
