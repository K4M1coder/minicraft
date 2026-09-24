/* ambiance.js — module pur : DÉCIDE quoi jouer et à quel volume/position,
   sans jamais toucher à WebAudio (c'est audio.js qui synthétise). Testable
   sous Node comme le reste de la logique du jeu.

   SPEC-AUDIO-001 à 006 : nappes d'environnement, sons de créature, sons
   d'action par matière, sons d'interaction, sons d'événement, et
   spatialisation (gain/pan/étouffement) + volumes par catégorie. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  // ─── SPEC-AUDIO-001 : nappes d'environnement ──────────────────────────────
  /* `ctx` : { biome (objet biomeAt : id, marin, gel, berges…), nuit (bool),
     pluie/vent/neige (0..1, déjà dérivés de la météo locale), sousTerre (bool),
     eauProche (0..1), villeProche (0..1), volcanProche (0..1) }.
     Renvoie le gain (0..1) de chaque nappe ; les nappes non pertinentes au
     lieu/moment restent à 0 plutôt que d'être simplement coupées ailleurs. */
  function nappes(ctx) {
    ctx = ctx || {};
    var bio = ctx.biome || {};
    var nuit = !!ctx.nuit;
    var pluie = clamp01(ctx.pluie), vent = clamp01(ctx.vent), neige = clamp01(ctx.neige);
    var out = { vent: 0, pluie: 0, mer: 0, riviere: 0, cascade: 0, feuillage: 0,
                grillons: 0, grotte: 0, ville: 0, volcan: 0 };

    if (ctx.sousTerre) {
      // sous terre : ni vent, ni pluie, ni feuillage — juste la roche qui résonne,
      // et le grondement du volcan si l'on en approche une chambre magmatique
      out.grotte = 0.55 + clamp01(ctx.eauProche) * 0.15;
      out.volcan = clamp01(ctx.volcanProche);
      return out;
    }

    out.vent = vent;
    out.pluie = pluie;
    if (bio.marin) out.mer = 0.5 + vent * 0.35;
    if (ctx.riviereProche) out.riviere = clamp01(ctx.riviereProche);
    if (ctx.cascadeProche) out.cascade = clamp01(ctx.cascadeProche);
    if (bio.id === 'foret' || bio.id === 'jungle' || bio.id === 'marais' || bio.id === 'champignons') {
      out.feuillage = 0.35 + vent * 0.25;
    }
    if (nuit && !bio.marin && !bio.gel && bio.id !== 'desert' && bio.id !== 'badlands') {
      out.grillons = 0.5;
    }
    if (ctx.villeProche) out.ville = clamp01(ctx.villeProche) * (nuit ? 0.4 : 0.7);
    if (ctx.volcanProche || bio.id === 'volcan') out.volcan = Math.max(out.volcan, clamp01(ctx.volcanProche || 1));
    // la neige assourdit sans bruiter, mais alourdit un peu le souffle du vent
    out.vent = clamp01(out.vent + neige * 0.1);
    return out;
  }

  // ─── SPEC-AUDIO-002 : sons par créature ───────────────────────────────────
  var FAMILLES_CREATURE = {
    loup: 'predateur', ours: 'predateur', renard: 'predateur',
    zombie: 'monstre', squelette: 'monstre', araignee: 'monstre', creeper: 'monstre',
    slime: 'monstre', enderman: 'monstre',
    vache: 'betail', cochon: 'betail', mouton: 'betail', cheval: 'betail', lapin: 'betail',
    poule: 'volaille',
    poisson: 'aquatique', calmar: 'aquatique', dauphin: 'aquatique',
  };
  var SONS_CREATURE = {
    predateur: { cri: 'cri_predateur', pas: 'pas_bete', blesse: 'blesse', mort: 'mort', attaque: 'frapper' },
    monstre: { cri: 'cri_monstre', pas: 'pas_monstre', blesse: 'blesse', mort: 'mort_monstre', attaque: 'frapper' },
    betail: { cri: 'cri_betail', pas: 'pas_bete', blesse: 'blesse', mort: 'mort', attaque: null },
    volaille: { cri: 'cri_volaille', pas: 'pas_leger', blesse: 'blesse', mort: 'mort', attaque: null },
    aquatique: { cri: 'cri_aquatique', pas: null, blesse: 'blesse_eau', mort: 'mort_eau', attaque: 'frapper' },
    generique: { cri: 'cri_generique', pas: 'pas_bete', blesse: 'blesse', mort: 'mort', attaque: 'frapper' },
  };
  /* `action` : 'cri' | 'pas' | 'blesse' | 'mort' | 'attaque'. Renvoie le nom
     de son (clé de audio.SONS) ou null si cette créature n'en émet pas
     (un poulet ne frappe pas, une bête ne « meurt » pas comme un monstre). */
  function sonCreature(espece, action) {
    var famille = FAMILLES_CREATURE[espece] || 'generique';
    var table = SONS_CREATURE[famille];
    return (table && table[action]) || null;
  }

  // ─── SPEC-AUDIO-003 : actions selon la matière ────────────────────────────
  var ACTIONS_MATIERE = ['pas', 'miner', 'casser', 'poser', 'nage', 'chute', 'combat', 'tir'];
  var SUFFIXE_MATIERE = {
    herbe: 'herbe', pierre: 'pierre', roche: 'pierre', sable: 'sable', bois: 'bois',
    neige: 'neige', eau: 'eau', metal: 'metal', laine: 'laine',
  };
  /* `matiere` : nom générique (herbe, pierre, sable, bois, neige, eau…), pas
     un id de bloc — c'est au bord de l'appelant (game.js) de faire ce tri
     à partir de C.BLOCKS, ce module reste sans dépendance sur core.js. */
  function sonAction(action, matiere) {
    if (ACTIONS_MATIERE.indexOf(action) < 0) return null;
    var suf = SUFFIXE_MATIERE[matiere] || 'pierre';
    return 'action_' + action + '_' + suf;
  }

  // ─── SPEC-AUDIO-004 : interactions ────────────────────────────────────────
  var SONS_INTERACTION = {
    porte: 'porte', trappe: 'trappe', coffre: 'coffre', fourneau: 'fourneau',
    etabli: 'craft', echange: 'echange', interface: 'interface',
  };
  function sonInteraction(type) { return SONS_INTERACTION[type] || null; }

  // ─── SPEC-AUDIO-005 : événements ──────────────────────────────────────────
  var SONS_EVENEMENT = {
    tonnerre: 'tonnerre', eruption: 'eruption', cyclone: 'cyclone',
    succes: 'succes', chapitre: 'chapitre', fin: 'fin_histoire', gardien: 'gardien',
  };
  function sonEvenement(type) { return SONS_EVENEMENT[type] || null; }

  // ─── SPEC-AUDIO-006 : spatialisation, étouffement, volumes ───────────────
  var PORTEE_DEFAUT = 24;
  /* `auditeur` : {x,y,z, yaw (radians, 0 = +z)}. `source` : {x,y,z}.
     `opts` : { portee, sousEau (le son vient de/traverse l'eau), roche
     (occlusion par de la roche pleine entre les deux) }.
     Renvoie { gain (0..1), pan (-1..1), distance, coupure (Hz, filtre passe-bas
     appliqué par l'étouffement — 20000 = pas de filtrage perceptible) }. */
  function spatialiser(auditeur, source, opts) {
    opts = opts || {};
    auditeur = auditeur || {}; source = source || {};
    var dx = (source.x || 0) - (auditeur.x || 0);
    var dy = (source.y || 0) - (auditeur.y || 0);
    var dz = (source.z || 0) - (auditeur.z || 0);
    var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    var portee = opts.portee || PORTEE_DEFAUT;
    var gain = clamp01(1 - dist / portee);
    gain = gain * gain; // atténuation perçue plus proche de l'oreille que du linéaire

    var yaw = auditeur.yaw || 0;
    var droite = dx * Math.cos(-yaw) - dz * Math.sin(-yaw);
    var pan = dist > 0.001 ? clamp(droite / Math.max(1, dist), -1, 1) : 0;

    var etouffement = 1;
    if (opts.sousEau) etouffement *= 0.35;
    if (opts.roche) etouffement *= 0.15;
    gain *= etouffement;
    var coupure = etouffement >= 1 ? 20000 : Math.round(300 + etouffement * 4000);

    return { gain: gain, pan: pan, distance: dist, coupure: coupure };
  }

  var CATEGORIES = ['ambiance', 'creature', 'action', 'interaction', 'evenement'];
  var VOLUMES_DEFAUT = { ambiance: 0.5, creature: 0.7, action: 0.8, interaction: 0.6, evenement: 0.9 };
  /* `volumes` : réglages courants (partiels ou absents) → on retombe sur le
     défaut de la catégorie, ou 1 pour une catégorie inconnue plutôt que 0
     (un son sans catégorie déclarée ne doit pas devenir muet). */
  function volumeCategorie(categorie, volumes) {
    var v = volumes && volumes[categorie] !== undefined ? volumes[categorie]
          : (VOLUMES_DEFAUT[categorie] !== undefined ? VOLUMES_DEFAUT[categorie] : 1);
    return clamp01(v);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function clamp01(v) { return clamp(v === undefined || v === null || isNaN(v) ? 0 : v, 0, 1); }

  MC.Ambiance = {
    nappes: nappes,
    sonCreature: sonCreature,
    sonAction: sonAction,
    sonInteraction: sonInteraction,
    sonEvenement: sonEvenement,
    spatialiser: spatialiser,
    volumeCategorie: volumeCategorie,
    CATEGORIES: CATEGORIES,
    VOLUMES_DEFAUT: VOLUMES_DEFAUT,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
