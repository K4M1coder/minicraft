/* ambiance.js — module pur : DÉCIDE quoi jouer et à quel volume/position,
   sans jamais toucher à WebAudio (c'est audio.js qui synthétise). Testable
   sous Node comme le reste de la logique du jeu.

   SPEC-AUDIO-001 à 006 : nappes d'environnement (et sonde du lieu autour de
   l'auditeur), sons de créature (table indexée par les espèces réelles de
   entities.js), sons d'action par matière (pas, minage, casse, pose, nage,
   chute, combat, tir), sons d'interaction, sons d'événement (dont les suivis
   de cyclone et de tornade), et spatialisation (gain/pan/étouffement,
   occlusion par la roche, choix de l'auditeur en écran partagé, budget de
   voix) + volumes par catégorie.

   Les blocs sont lus par un accesseur injecté (`lire(x, y, z)` → id) : le
   module ne connaît ni le monde ni le rendu. Il consulte MC.Core et MC.Eau
   s'ils sont chargés (ils le sont avant lui, sous Node comme au navigateur)
   pour reconnaître l'eau, l'eau courante, les feuilles et la roche. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  function core() { return MC.Core || null; }
  function defBloc(id) { var C = core(); return C && C.BLOCKS ? C.BLOCKS[id] : null; }
  function estEau(id) {
    var C = core();
    if (C && C.isWater) return C.isWater(id);
    var d = defBloc(id); return !!(d && d.liquid && !d.lave);
  }
  function estCourante(id) { return !!(MC.Eau && MC.Eau.estCourante && MC.Eau.estCourante(id)); }
  function estFeuille(id) { var d = defBloc(id); return !!(d && d.leaves); }
  /* Ce qui arrête le son : un bloc plein et opaque (roche, terre, bois…) —
     ni l'air, ni l'eau, ni le verre, ni les feuilles, ni les plantes. */
  function bloqueSon(id) {
    if (!id) return false;
    var d = defBloc(id);
    if (!d) return id > 0;     // id inconnu de cette version : un cube plein (SPEC-SAVE-028)
    return !d.transparent && !d.liquid && !d.plant && !d.leaves && !d.panneau;
  }

  // ─── SPEC-AUDIO-001 : nappes d'environnement ──────────────────────────────
  /* `ctx` : { biome (objet biomeAt : id, marin, gel, berges…), nuit (bool),
     pluie/vent/neige (0..1, déjà dérivés de la météo locale), sousTerre (bool),
     eauProche (0..1), villeProche (0..1), volcanProche (0..1),
     riviereProche/cascadeProche/merProche/feuillageProche (0..1, sonde du lieu
     — voir sonderEnvironnement) }.
     Renvoie le gain (0..1) de chaque nappe ; les nappes non pertinentes au
     lieu/moment restent à 0 plutôt que d'être simplement coupées ailleurs. */
  var NAPPES = ['vent', 'pluie', 'mer', 'ressac', 'riviere', 'cascade', 'feuillage', 'grillons', 'grotte', 'ville', 'volcan'];
  function nappes(ctx) {
    ctx = ctx || {};
    var bio = ctx.biome || {};
    var nuit = !!ctx.nuit;
    var pluie = clamp01(ctx.pluie), vent = clamp01(ctx.vent), neige = clamp01(ctx.neige);
    var out = {};
    NAPPES.forEach(function (k) { out[k] = 0; });

    if (ctx.sousTerre) {
      // sous terre : ni vent, ni pluie, ni feuillage — juste la roche qui résonne,
      // l'eau qui goutte ou coule tout près, et le grondement du volcan si l'on
      // approche d'une chambre magmatique
      out.grotte = 0.55 + clamp01(ctx.eauProche) * 0.15;
      out.riviere = clamp01(ctx.riviereProche) * 0.6;
      out.cascade = clamp01(ctx.cascadeProche) * 0.8;
      out.volcan = clamp01(ctx.volcanProche);
      return out;
    }

    out.vent = vent;
    out.pluie = pluie;
    // la mer : au large (biome marin) ou sur le rivage (sonde) ; le ressac, ce
    // sont les vagues qui se brisent — fort sur la côte, absent au grand large
    var mer = clamp01(ctx.merProche);
    if (bio.marin) out.mer = 0.5 + vent * 0.35;
    if (mer > 0) {
      out.mer = Math.max(out.mer, mer * (0.45 + vent * 0.3));
      out.ressac = clamp01(mer * (0.55 + vent * 0.45));
    }
    if (ctx.riviereProche) out.riviere = clamp01(ctx.riviereProche);
    if (ctx.cascadeProche) out.cascade = clamp01(ctx.cascadeProche);
    if (bio.id === 'foret' || bio.id === 'jungle' || bio.id === 'marais' || bio.id === 'champignons') {
      out.feuillage = 0.35 + vent * 0.25;
    }
    // des arbres tout autour, quel que soit le biome : leurs feuilles bruissent au vent
    if (ctx.feuillageProche) out.feuillage = Math.max(out.feuillage, clamp01(ctx.feuillageProche) * (0.25 + vent * 0.35));
    if (nuit && !bio.marin && !bio.gel && bio.id !== 'desert' && bio.id !== 'badlands') {
      out.grillons = 0.5 * (1 - pluie * 0.8);   // les grillons se taisent sous l'averse
    }
    if (ctx.villeProche) out.ville = clamp01(ctx.villeProche) * (nuit ? 0.4 : 0.7);
    if (ctx.volcanProche || bio.id === 'volcan') out.volcan = Math.max(out.volcan, clamp01(ctx.volcanProche || 1));
    // la neige assourdit sans bruiter, mais alourdit un peu le souffle du vent
    out.vent = clamp01(out.vent + neige * 0.1);
    return out;
  }

  /* Sonde du lieu autour de l'auditeur, pour nourrir `nappes` : proximité
     (0..1, 1 = sur place) d'une rivière, d'une cascade, de la mer et de
     feuillages. `lire(x, y, z)` → id de bloc ; `opts` : { nature(x, z) → code
     MC.Eau.TYPES de la colonne générée (0 inconnu), rayon (16), pas (2 : un ruisseau d'un bloc ne passe pas entre deux colonnes),
     haut (6), bas (8), niveauMer }. Coût borné : (2·rayon/pas + 1)² colonnes
     de haut+bas+1 blocs — l'appelant la relance quelques fois par seconde,
     jamais à chaque image. Une cascade : une eau qui coule (ou de rivière)
     dont un flanc donne sur le vide — la même règle que le maillage de la
     chute (mesher.js). */
  function sonderEnvironnement(lire, x, y, z, opts) {
    opts = opts || {};
    var R = opts.rayon || 16, pas = opts.pas || 2, haut = opts.haut === undefined ? 6 : opts.haut,
        bas = opts.bas === undefined ? 8 : opts.bas;
    var T = (MC.Eau && MC.Eau.TYPES) || { lac: 1, mer: 2, ocean: 3, riviere: 4, ecoulement: 5, chute: 6 };
    var C = core();
    var niveauMer = opts.niveauMer !== undefined ? opts.niveauMer : (C && C.SEA_LEVEL !== undefined ? C.SEA_LEVEL : 26);
    var out = { riviere: 0, cascade: 0, mer: 0, feuillage: 0, eau: 0, colonnes: 0 };
    var x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z), feuilles = 0, colonnes = 0;
    for (var dx = -R; dx <= R; dx += pas) {
      for (var dz = -R; dz <= R; dz += pas) {
        var dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > R) continue;
        colonnes++;
        var w = 1 - dist / (R + 1);
        var cx = x0 + dx, cz = z0 + dz, vuFeuille = false;
        for (var yy = y0 + haut; yy >= y0 - bas; yy--) {
          var id = lire(cx, yy, cz);
          if (!id) continue;
          if (!vuFeuille && estFeuille(id)) { vuFeuille = true; continue; }
          if (!estEau(id)) {
            if (bloqueSon(id)) break;     // le sol de la colonne : rien d'audible dessous
            continue;
          }
          // la surface de l'eau de cette colonne
          out.eau = Math.max(out.eau, w);
          var nat = opts.nature ? (opts.nature(cx, cz) || 0) : 0;
          var vive = estCourante(id) || nat === T.riviere || nat === T.chute || nat === T.ecoulement;
          if (vive) {
            out.riviere = Math.max(out.riviere, w * (estCourante(id) ? 0.8 : 1));
            if (flancVide(lire, cx, yy, cz) || flancVide(lire, cx, yy - 1, cz)) out.cascade = Math.max(out.cascade, w);
          } else if (nat === T.mer || nat === T.ocean || (nat === 0 && yy <= niveauMer && profondeur(lire, cx, yy, cz) >= 3)) {
            out.mer = Math.max(out.mer, w);
          }
          break;
        }
        if (vuFeuille) feuilles += w;
      }
    }
    out.colonnes = colonnes;
    out.feuillage = colonnes ? clamp01(feuilles / colonnes * 2.5) : 0;
    return out;
  }
  function flancVide(lire, x, y, z) {
    if (!estEau(lire(x, y, z))) return false;
    return lire(x + 1, y, z) === 0 || lire(x - 1, y, z) === 0 || lire(x, y, z + 1) === 0 || lire(x, y, z - 1) === 0;
  }
  function profondeur(lire, x, y, z) {
    var n = 0;
    while (n < 6 && estEau(lire(x, y - n, z))) n++;
    return n;
  }

  // ─── SPEC-AUDIO-002 : sons par créature ───────────────────────────────────
  /* Table indexée par les espèces RÉELLES du jeu (clés de entities.js SPECS) :
     famille sonore (timbre), hauteur (multiplicateur de fréquence : chaque
     espèce a sa voix dans la famille), foulée (blocs entre deux pas ; 0 = ni
     pas : vole ou nage), cadence des cris (secondes, min-max), attaque (la
     créature frappe, tire ou pique). Les véhicules (v_*), les objets au sol
     et les flèches ne sont pas des créatures. */
  var ESPECES = {
    zombie:   { famille: 'monstre',  hauteur: 1.00, foulee: 1.4, cri: [6, 14],  attaque: true },
    skeleton: { famille: 'monstre',  hauteur: 1.35, foulee: 1.3, cri: [7, 15],  attaque: true },
    spider:   { famille: 'monstre',  hauteur: 1.70, foulee: 0.8, cri: [5, 11],  attaque: true },
    mummy:    { famille: 'monstre',  hauteur: 0.85, foulee: 1.4, cri: [7, 15],  attaque: true },
    slime:    { famille: 'monstre',  hauteur: 1.55, foulee: 1.2, cri: [6, 12],  attaque: true },
    drowned:  { famille: 'monstre',  hauteur: 0.78, foulee: 1.4, cri: [7, 15],  attaque: true },
    mimic:    { famille: 'monstre',  hauteur: 1.20, foulee: 1.0, cri: [9, 18],  attaque: true },
    araignee_caverne:  { famille: 'monstre', hauteur: 1.90, foulee: 0.8, cri: [5, 11], attaque: true },
    elementaire_magma: { famille: 'monstre', hauteur: 0.60, foulee: 1.3, cri: [6, 12], attaque: true },
    golem_cristal:     { famille: 'monstre', hauteur: 0.70, foulee: 1.8, cri: [8, 16], attaque: true },
    rodeur_abysse:     { famille: 'monstre', hauteur: 0.92, foulee: 1.4, cri: [7, 14], attaque: true },
    creature_aveugle:  { famille: 'monstre', hauteur: 1.10, foulee: 1.2, cri: [8, 16], attaque: true },

    wolf:       { famille: 'predateur', hauteur: 1.25, foulee: 1.1, cri: [8, 18],  attaque: true },
    polar_bear: { famille: 'predateur', hauteur: 0.65, foulee: 1.9, cri: [9, 20],  attaque: true },
    goat:       { famille: 'betail',    hauteur: 1.30, foulee: 1.0, cri: [7, 16],  attaque: true },

    sheep:    { famille: 'betail',   hauteur: 1.10, foulee: 1.1, cri: [7, 16],  attaque: false },
    pig:      { famille: 'betail',   hauteur: 0.90, foulee: 1.0, cri: [7, 16],  attaque: false },

    chicken:  { famille: 'volaille', hauteur: 1.00, foulee: 0.6, cri: [5, 12],  attaque: false },
    bird:     { famille: 'volaille', hauteur: 1.60, foulee: 0,   cri: [4, 10],  attaque: false },
    seagull:  { famille: 'volaille', hauteur: 1.20, foulee: 0,   cri: [4, 10],  attaque: false },
    parrot:   { famille: 'volaille', hauteur: 1.40, foulee: 0,   cri: [4, 9],   attaque: false },
    eagle:    { famille: 'volaille', hauteur: 0.80, foulee: 0,   cri: [8, 18],  attaque: false },
    chauve_souris: { famille: 'volaille', hauteur: 2.20, foulee: 0, cri: [3, 8], attaque: false },

    fish:          { famille: 'aquatique', hauteur: 1.40, foulee: 0, cri: [10, 22], attaque: false },
    tropical_fish: { famille: 'aquatique', hauteur: 1.70, foulee: 0, cri: [10, 22], attaque: false },
    squid:         { famille: 'aquatique', hauteur: 0.80, foulee: 0, cri: [10, 20], attaque: false },
    dolphin:       { famille: 'aquatique', hauteur: 1.90, foulee: 0, cri: [6, 14],  attaque: true },
    shark:         { famille: 'aquatique', hauteur: 0.60, foulee: 0, cri: [9, 18],  attaque: true },
    jellyfish:     { famille: 'aquatique', hauteur: 1.10, foulee: 0, cri: [12, 24], attaque: true },

    turtle:   { famille: 'carapace', hauteur: 0.85, foulee: 0,   cri: [12, 24], attaque: false },
    crab:     { famille: 'carapace', hauteur: 1.40, foulee: 0.5, cri: [9, 18],  attaque: false },

    villager:   { famille: 'humain', hauteur: 1.00, foulee: 1.5, cri: [10, 24], attaque: false },
    garde:      { famille: 'humain', hauteur: 0.88, foulee: 1.5, cri: [12, 26], attaque: true },
    pillager:   { famille: 'humain', hauteur: 0.95, foulee: 1.5, cri: [9, 20],  attaque: true },
    vindicator: { famille: 'humain', hauteur: 0.80, foulee: 1.5, cri: [9, 20],  attaque: true },

    boss_zombie:         { famille: 'gardien', hauteur: 0.80, foulee: 2.0, cri: [5, 10], attaque: true },
    boss_araignee:       { famille: 'gardien', hauteur: 1.50, foulee: 1.2, cri: [5, 10], attaque: true },
    boss_squelette:      { famille: 'gardien', hauteur: 1.15, foulee: 1.8, cri: [5, 10], attaque: true },
    boss_slime:          { famille: 'gardien', hauteur: 1.30, foulee: 2.2, cri: [5, 10], attaque: true },
    boss_pharaon:        { famille: 'gardien', hauteur: 0.90, foulee: 1.9, cri: [5, 10], attaque: true },
    boss_yeti:           { famille: 'gardien', hauteur: 0.55, foulee: 2.4, cri: [5, 10], attaque: true },
    boss_serpent:        { famille: 'gardien', hauteur: 1.70, foulee: 1.4, cri: [5, 10], attaque: true },
    boss_sorciere:       { famille: 'gardien', hauteur: 1.95, foulee: 1.6, cri: [5, 10], attaque: true },
    boss_wyverne:        { famille: 'gardien', hauteur: 0.70, foulee: 0,   cri: [5, 10], attaque: true },
    boss_gardien_ancien: { famille: 'gardien', hauteur: 0.62, foulee: 0,   cri: [5, 10], attaque: true },
    boss_capitaine:      { famille: 'gardien', hauteur: 0.75, foulee: 1.9, cri: [5, 10], attaque: true },
  };
  var GENERIQUE = { famille: 'generique', hauteur: 1, foulee: 1.3, cri: [8, 16], attaque: true };
  var SONS_CREATURE = {
    predateur: { cri: 'cri_predateur', pas: 'pas_bete', blesse: 'blesse', mort: 'mort', attaque: 'morsure' },
    monstre:   { cri: 'cri_monstre', pas: 'pas_monstre', blesse: 'blesse_monstre', mort: 'mort_monstre', attaque: 'frapper' },
    betail:    { cri: 'cri_betail', pas: 'pas_bete', blesse: 'blesse', mort: 'mort', attaque: 'charge' },
    volaille:  { cri: 'cri_volaille', pas: 'pas_leger', blesse: 'blesse_petit', mort: 'mort_petit', attaque: 'morsure' },
    aquatique: { cri: 'cri_aquatique', pas: null, blesse: 'blesse_eau', mort: 'mort_eau', attaque: 'morsure' },
    carapace:  { cri: 'cri_carapace', pas: 'pas_leger', blesse: 'blesse_petit', mort: 'mort_petit', attaque: 'morsure' },
    humain:    { cri: 'cri_humain', pas: 'pas_humain', blesse: 'blesse_humain', mort: 'mort_humain', attaque: 'frapper' },
    gardien:   { cri: 'cri_gardien', pas: 'pas_lourd', blesse: 'blesse_monstre', mort: 'mort_gardien', attaque: 'frapper_lourd' },
    generique: { cri: 'cri_generique', pas: 'pas_bete', blesse: 'blesse', mort: 'mort', attaque: 'frapper' },
  };
  var ACTIONS_CREATURE = ['cri', 'pas', 'blesse', 'mort', 'attaque'];
  function voixCreature(espece) { return ESPECES[espece] || GENERIQUE; }
  /* `action` : 'cri' | 'pas' | 'blesse' | 'mort' | 'attaque'. Renvoie le nom
     de son (synthétisé par audio.js) ou null si cette créature n'en émet pas :
     une poule ne frappe pas, un poisson ne fait pas de pas. Une espèce
     inconnue (ajoutée plus tard sans entrée ici) garde une voix générique. */
  function sonCreature(espece, action) {
    var v = voixCreature(espece);
    if (action === 'attaque' && !v.attaque) return null;
    if (action === 'pas' && !v.foulee) return null;
    var table = SONS_CREATURE[v.famille];
    return (table && table[action]) || null;
  }
  // un « type » d'entité qui n'est pas une créature : objet au sol, flèche, véhicule
  function estCreature(type) {
    return !!type && type !== 'item' && type !== 'arrow' && type.indexOf('v_') !== 0;
  }

  // ─── SPEC-AUDIO-003 : actions selon la matière ────────────────────────────
  var ACTIONS_MATIERE = ['pas', 'miner', 'casser', 'poser', 'nage', 'chute', 'combat', 'tir'];
  var MATIERES = ['herbe', 'terre', 'pierre', 'sable', 'gravier', 'bois', 'neige', 'eau', 'metal', 'laine', 'verre', 'feuilles'];
  var SUFFIXE_MATIERE = { roche: 'pierre' };
  MATIERES.forEach(function (m) { SUFFIXE_MATIERE[m] = m; });
  /* `matiere` : nom générique (herbe, pierre, sable, bois, neige, eau…) —
     `matiereBloc` le tire d'un id de bloc. Une matière inconnue retombe sur
     la pierre, une action inconnue ne sonne pas. */
  function sonAction(action, matiere) {
    if (ACTIONS_MATIERE.indexOf(action) < 0) return null;
    var suf = SUFFIXE_MATIERE[matiere] || 'pierre';
    return 'action_' + action + '_' + suf;
  }
  /* La matière d'un bloc, d'après sa définition (MC.Core.BLOCKS) : liquide,
     feuillage, outil qui le travaille (pelle, hache, pioche) et nom. Jamais
     d'exception : un id inconnu (ou l'air) rend null. */
  var RE_NEIGE = /neige/i, RE_GLACE = /glace/i, RE_SABLE = /sable|sel\b|^sel$|poudre/i, RE_GRAVIER = /gravier/i,
      RE_HERBE = /herbe|mycélium|mycelium/i, RE_METAL = /\bor\b|fer|métal|metaux|métaux|enclume|coffre-fort|piston|rail|argent/i,
      RE_LAINE = /laine|tapis|foin|éponge|eponge|chaume/i, RE_VERRE = /verre|vitre|lanterne marine|cristal/i;
  function matiereBloc(id) {
    if (!id) return null;
    var d = defBloc(id);
    if (!d) return 'pierre';
    var nom = d.name || '';
    if (d.liquid) return d.lave ? 'pierre' : 'eau';
    if (d.leaves) return 'feuilles';
    if (RE_NEIGE.test(nom)) return 'neige';
    if (RE_GLACE.test(nom)) return 'verre';
    if (RE_LAINE.test(nom)) return 'laine';
    if (d.plant) return 'feuilles';
    if (d.tool === 'shovel') {
      if (RE_GRAVIER.test(nom)) return 'gravier';
      if (RE_SABLE.test(nom)) return 'sable';
      if (RE_HERBE.test(nom)) return 'herbe';
      return 'terre';
    }
    if (d.tool === 'axe') return 'bois';
    if (RE_VERRE.test(nom)) return 'verre';
    if (RE_METAL.test(nom)) return 'metal';
    return 'pierre';
  }

  /* La matière d'un coup porté (combat) : celle de l'arme tenue — bois,
     pierre ou métal — et la main nue frappe mat (laine). */
  var RE_ARME_METAL = /fer|\bor\b|diamant|acier|runique|trident|sabre|khepesh|lance|givre|masse|dague|argent/i,
      RE_ARME_BOIS = /bois|bâton|baton/i, RE_ARME_PIERRE = /pierre|silex/i;
  function matiereArme(id) {
    var C = core();
    var d = id && C && C.def ? C.def(id) : null;
    if (!d) return 'laine';
    var nom = d.name || '';
    if (RE_ARME_BOIS.test(nom)) return 'bois';
    if (RE_ARME_PIERRE.test(nom)) return 'pierre';
    if (RE_ARME_METAL.test(nom)) return 'metal';
    return d.damage ? 'metal' : 'laine';
  }

  /* Pas, nage et chute du joueur : un suivi par joueur local, avancé à chaque
     image avec `etat` { x, y, z, auSol, nage, vole, monte (à bord d'un
     véhicule), vy (vitesse verticale), matiere (sous les pieds) }. Un pas
     toutes les FOULEE blocs parcourus au sol, une brasse toutes les
     FOULEE_NAGE blocs dans l'eau ; une chute à l'atterrissage quand on
     arrivait à plus de VITESSE_CHUTE blocs/s (une petite réception ne fait
     qu'un pas). Renvoie la liste (souvent vide) de { action, matiere, force }. */
  var FOULEE = 1.7, FOULEE_NAGE = 1.5, VITESSE_CHUTE = 9, VITESSE_RECEPTION = 5;
  function creerSuiviPas() {
    var prec = null, dist = 0, enLair = false, vyMin = 0;
    return {
      avancer: function (etat) {
        var out = [];
        if (!etat) return out;
        if (!prec || etat.vole || etat.monte) {
          prec = { x: etat.x, z: etat.z }; dist = 0; enLair = false; vyMin = 0;
          return out;
        }
        var d = Math.hypot(etat.x - prec.x, etat.z - prec.z);
        prec.x = etat.x; prec.z = etat.z;
        if (d > 4) d = 0;                      // téléportation, réapparition : pas un pas
        if (etat.nage) {
          if (enLair && vyMin <= -VITESSE_RECEPTION) out.push({ action: 'nage', matiere: 'eau', force: clamp01(-vyMin / 20) + 0.4 });
          enLair = false; vyMin = 0;
          dist += d;
          if (dist >= FOULEE_NAGE) { dist = 0; out.push({ action: 'nage', matiere: 'eau', force: 0.6 }); }
          return out;
        }
        if (!etat.auSol) {
          enLair = true;
          vyMin = Math.min(vyMin, etat.vy || 0);
          return out;
        }
        if (enLair) {
          if (vyMin <= -VITESSE_CHUTE) { out.push({ action: 'chute', matiere: etat.matiere, force: clamp01(-vyMin / 25) }); dist = 0; }
          else if (vyMin <= -VITESSE_RECEPTION) { out.push({ action: 'pas', matiere: etat.matiere, force: 0.8 }); dist = 0; }
          enLair = false; vyMin = 0;
        }
        dist += d;
        if (dist >= FOULEE) { dist = 0; out.push({ action: 'pas', matiere: etat.matiere, force: 0.6 }); }
        return out;
      },
    };
  }

  /* Rythme d'un geste répété (minage d'un bloc : un coup toutes les
     `periode` secondes tant qu'on mine). Le premier coup part aussitôt. */
  function creerRythme(periode) {
    var t = 0;
    return {
      avancer: function (dt, actif) {
        if (!actif) { t = 0; return false; }
        t -= dt || 0;
        if (t > 0) return false;
        t = t + periode > 0 ? t + periode : periode;
        return true;
      },
    };
  }

  /* Pas et cris des créatures qu'on voit (répliques du serveur) : `mobs`,
     tableau de { eid, type, pos:{x,y,z} } ; `auditeurs`, positions des
     joueurs locaux ; `rand` facultatif (Math.random). Seules les créatures à
     moins de PORTEE_CREATURES de l'auditeur le plus proche comptent, et au
     plus MAX_SONS_CREATURES sons partent par appel (les autres attendent
     l'image suivante) : le budget reste borné quel que soit le monde. */
  var PORTEE_CREATURES = 28, MAX_SONS_CREATURES = 3;
  function creerSuiviCreatures() {
    var memo = new Map(), vus = new Set();
    function delaiCri(v, rand) { return v.cri[0] + rand() * (v.cri[1] - v.cri[0]); }
    return {
      get suivies() { return memo.size; },
      avancer: function (mobs, auditeurs, dt, rand) {
        rand = rand || Math.random;
        var out = [];
        vus.clear();
        for (var i = 0; i < (mobs ? mobs.length : 0); i++) {
          var m = mobs[i];
          if (!m || !m.pos || !estCreature(m.type)) continue;
          var a = auditeurs && auditeurs.length ? auditeurs[choisirAuditeur(auditeurs, m.pos)] : null;
          if (!a) continue;
          var dist = Math.hypot(m.pos.x - a.x, m.pos.y - a.y, m.pos.z - a.z);
          if (dist > PORTEE_CREATURES) continue;
          vus.add(m.eid);
          var v = voixCreature(m.type);
          var s = memo.get(m.eid);
          if (!s) { s = { x: m.pos.x, z: m.pos.z, dist: 0, cri: delaiCri(v, rand) * (0.3 + 0.7 * rand()) }; memo.set(m.eid, s); }
          var d = Math.hypot(m.pos.x - s.x, m.pos.z - s.z);
          s.x = m.pos.x; s.z = m.pos.z;
          if (d < 3) s.dist += d;
          s.cri -= dt || 0;
          if (out.length >= MAX_SONS_CREATURES) continue;
          var pas = v.foulee && s.dist >= v.foulee ? sonCreature(m.type, 'pas') : null;
          if (pas) { s.dist = 0; out.push({ nom: pas, espece: m.type, action: 'pas', eid: m.eid, x: m.pos.x, y: m.pos.y, z: m.pos.z, hauteur: v.hauteur }); }
          if (s.cri <= 0 && out.length < MAX_SONS_CREATURES) {
            s.cri = delaiCri(v, rand);
            out.push({ nom: sonCreature(m.type, 'cri'), espece: m.type, action: 'cri', eid: m.eid, x: m.pos.x, y: m.pos.y, z: m.pos.z, hauteur: v.hauteur });
          }
        }
        memo.forEach(function (s, eid) { if (!vus.has(eid)) memo.delete(eid); });
        return out;
      },
    };
  }

  // ─── SPEC-AUDIO-004 : interactions ────────────────────────────────────────
  var SONS_INTERACTION = {
    porte: 'porte', trappe: 'trappe', coffre: 'coffre', fourneau: 'fourneau',
    etabli: 'craft', echange: 'echange', interface: 'interface',
  };
  function sonInteraction(type) { return SONS_INTERACTION[type] || null; }
  /* Ce qui bascule : 'trappe' pour une trappe, 'porte' pour une porte (et par
     défaut : un portail, un lit…) — d'après la définition du bloc. */
  function interactionBloc(id) {
    var d = defBloc(id);
    if (d && d.trappe) return 'trappe';
    return 'porte';
  }

  // ─── SPEC-AUDIO-005 : événements ──────────────────────────────────────────
  var SONS_EVENEMENT = {
    tonnerre: 'tonnerre', eruption: 'eruption', cyclone: 'cyclone', tornade: 'tornade',
    succes: 'succes', chapitre: 'chapitre', fin: 'fin_histoire', gardien: 'gardien',
  };
  function sonEvenement(type) { return SONS_EVENEMENT[type] || null; }

  /* Cyclone et tornade : le client connaît les deux (météo déterministe,
     même graine que le serveur). `etat` : { temps, cyclone (0..1, force du
     cyclone qui souffle sur l'auditeur), tornades: [{ id, x, z, force }] },
     `auditeur` : {x, z}. Un cyclone s'annonce quand sa force dépasse
     SEUIL_CYCLONE puis gronde toutes les REPRISE_CYCLONE secondes ; une
     tornade à moins de PORTEE_TORNADE gronde là où elle est, toutes les
     REPRISE_TORNADE secondes. Renvoie [{ nom, type, force, x?, z?, portee? }]. */
  var SEUIL_CYCLONE = 0.2, FIN_CYCLONE = 0.12, REPRISE_CYCLONE = 9, PORTEE_TORNADE = 260, REPRISE_TORNADE = 4;
  function creerSuiviMeteo() {
    var cycloneActif = false, cycloneT = -Infinity, tornadesT = new Map(), dernierT = null;
    return {
      avancer: function (etat, auditeur) {
        var out = [];
        if (!etat) return out;
        var t = etat.temps || 0;
        if (dernierT !== null && t < dernierT) { cycloneT = -Infinity; tornadesT.clear(); }   // l'heure a reculé (chargement, /heure)
        dernierT = t;
        var f = clamp01(etat.cyclone);
        if (f >= SEUIL_CYCLONE && (!cycloneActif || t - cycloneT >= REPRISE_CYCLONE)) {
          cycloneActif = true; cycloneT = t;
          out.push({ nom: sonEvenement('cyclone'), type: 'cyclone', force: f });
        } else if (f < FIN_CYCLONE) cycloneActif = false;
        var presentes = new Set();
        (etat.tornades || []).forEach(function (tn) {
          if (!auditeur || Math.hypot(tn.x - auditeur.x, tn.z - auditeur.z) > PORTEE_TORNADE) return;
          presentes.add(tn.id);
          var vu = tornadesT.get(tn.id);
          if (vu !== undefined && t - vu < REPRISE_TORNADE) return;
          tornadesT.set(tn.id, t);
          out.push({ nom: sonEvenement('tornade'), type: 'tornade', force: clamp01(tn.force === undefined ? 1 : tn.force),
                     x: tn.x, z: tn.z, portee: PORTEE_TORNADE });
        });
        tornadesT.forEach(function (v, id) { if (!presentes.has(id)) tornadesT.delete(id); });
        return out;
      },
    };
  }

  // ─── SPEC-AUDIO-006 : spatialisation, étouffement, volumes ───────────────
  var PORTEE_DEFAUT = 24;
  /* `auditeur` : {x,y,z, yaw (radians, 0 = +z)}. `source` : {x,y,z}.
     `opts` : { portee, sousEau (le son vient de/traverse l'eau), roche
     (occlusion par de la roche pleine entre les deux : booléen ou nombre de
     blocs traversés, voir `occlusion`) }.
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
    var roche = typeof opts.roche === 'number' ? opts.roche : (opts.roche ? 1 : 0);
    if (roche > 0) etouffement *= roche >= 3 ? 0.08 : 0.15;
    gain *= etouffement;
    var coupure = etouffement >= 1 ? 20000 : Math.round(300 + etouffement * 4000);

    return { gain: gain, pan: pan, distance: dist, coupure: coupure };
  }

  /* Occlusion simple : on échantillonne le segment auditeur → source tous
     les `pas` blocs (0,7 par défaut, au plus MAX_ECHANTILLONS points) et on
     compte les blocs pleins (roche, terre, bois…) et les blocs d'eau
     traversés, sans compter les cases des deux extrémités. Renvoie
     { roche, eau } (nombres de cases distinctes). */
  var MAX_ECHANTILLONS = 48;
  function occlusion(lire, a, b, pas) {
    var out = { roche: 0, eau: 0 };
    if (!lire || !a || !b) return out;
    var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    var L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L < 1) return out;
    var n = Math.min(MAX_ECHANTILLONS, Math.ceil(L / (pas || 0.7)));
    var ax = Math.floor(a.x), ay = Math.floor(a.y), az = Math.floor(a.z);
    var bx = Math.floor(b.x), by = Math.floor(b.y), bz = Math.floor(b.z);
    var px = null, py = null, pz = null;
    for (var i = 1; i < n; i++) {
      var k = i / n;
      var x = Math.floor(a.x + dx * k), y = Math.floor(a.y + dy * k), z = Math.floor(a.z + dz * k);
      if (x === px && y === py && z === pz) continue;
      px = x; py = y; pz = z;
      if ((x === ax && y === ay && z === az) || (x === bx && y === by && z === bz)) continue;
      var id = lire(x, y, z);
      if (bloqueSon(id)) out.roche++;
      else if (id && estEau(id)) out.eau++;
    }
    return out;
  }

  /* Écran partagé : chaque vue a son auditeur ; un son se règle sur le plus
     proche d'entre eux (indice dans `auditeurs`, 0 s'il n'y en a qu'un). */
  function choisirAuditeur(auditeurs, source) {
    if (!auditeurs || auditeurs.length < 2 || !source) return 0;
    var best = 0, bd = Infinity;
    for (var i = 0; i < auditeurs.length; i++) {
      var p = auditeurs[i];
      if (!p) continue;
      var d = (p.x - source.x) * (p.x - source.x) + (p.y - (source.y || 0)) * (p.y - (source.y || 0)) + (p.z - source.z) * (p.z - source.z);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /* L'auditeur a la tête sous l'eau : tout ce qu'il entend passe par un filtre
     passe-bas (coupure en Hz) et s'atténue (gain) ; à l'air libre, rien. */
  function etouffementAuditeur(sousEau) {
    return sousEau ? { coupure: 650, gain: 0.6 } : { coupure: 20000, gain: 1 };
  }

  /* Budget de voix : au plus `max` sons ponctuels à la fois. `actives` :
     [{ categorie, gain }] des voix qui jouent encore ; `demande` : { categorie,
     gain }. Score = priorité de la catégorie + gain : un événement (tonnerre,
     succès) passe avant une interaction, une action, une créature. Une
     demande admise quand tout est plein évince la voix de plus faible score
     (son indice dans `evincer`, -1 sinon) ; une demande qui ne bat personne
     est refusée — on ne coupe pas un son plus important pour un moindre. */
  var PRIORITES = { ambiance: 0, creature: 1, action: 2, interface: 2.5, interaction: 3, evenement: 4 };
  function scoreVoix(v) { return (PRIORITES[v.categorie] !== undefined ? PRIORITES[v.categorie] : 1) + clamp01(v.gain); }
  function admettreVoix(actives, demande, max) {
    actives = actives || [];
    if (actives.length < max) return { admis: true, evincer: -1 };
    var pire = -1, ps = Infinity;
    for (var i = 0; i < actives.length; i++) {
      var s = scoreVoix(actives[i]);
      if (s < ps) { ps = s; pire = i; }
    }
    if (pire >= 0 && scoreVoix(demande) > ps) return { admis: true, evincer: pire };
    return { admis: false, evincer: -1 };
  }

  var CATEGORIES = ['ambiance', 'creature', 'action', 'interaction', 'interface', 'evenement'];
  var VOLUMES_DEFAUT = { ambiance: 0.5, creature: 0.7, action: 0.8, interaction: 0.6, interface: 0.5, evenement: 0.9 };
  /* Le réglage d'options (MC.Options.REGLAGES) qui porte le volume de chaque
     catégorie. */
  var OPTIONS_VOLUME = { ambiance: 'volumeAmbiance', creature: 'volumeCreatures', action: 'volumeActions',
                         interaction: 'volumeInteractions', interface: 'volumeInterface', evenement: 'volumeEvenements' };
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
    NAPPES: NAPPES,
    sonderEnvironnement: sonderEnvironnement,
    ESPECES: ESPECES,
    ACTIONS_CREATURE: ACTIONS_CREATURE,
    voixCreature: voixCreature,
    sonCreature: sonCreature,
    estCreature: estCreature,
    creerSuiviCreatures: creerSuiviCreatures,
    ACTIONS_MATIERE: ACTIONS_MATIERE,
    MATIERES: MATIERES,
    sonAction: sonAction,
    matiereBloc: matiereBloc,
    matiereArme: matiereArme,
    creerSuiviPas: creerSuiviPas,
    creerRythme: creerRythme,
    sonInteraction: sonInteraction,
    interactionBloc: interactionBloc,
    sonEvenement: sonEvenement,
    creerSuiviMeteo: creerSuiviMeteo,
    spatialiser: spatialiser,
    occlusion: occlusion,
    bloqueSon: bloqueSon,
    choisirAuditeur: choisirAuditeur,
    etouffementAuditeur: etouffementAuditeur,
    admettreVoix: admettreVoix,
    PRIORITES: PRIORITES,
    volumeCategorie: volumeCategorie,
    CATEGORIES: CATEGORIES,
    VOLUMES_DEFAUT: VOLUMES_DEFAUT,
    OPTIONS_VOLUME: OPTIONS_VOLUME,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
