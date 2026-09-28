/* zones.js — zones de jeu (SPEC-ZONE-001 à 004). Logique pure, comme
   densite.js et habitats.js : ni THREE, ni document, ni réseau. Deux parts
   bien séparées :

   1. `creer(N, densiteApi, opts)` — la CARTE, déterministe (même graine, même
      classement en tout point, comme MC.Densite.classeEn) : chaque point du
      monde reçoit l'une des quatre zones (PvP-PvE, PvP seul, PvE seul, sûre)
      selon la politique choisie par le serveur (SPEC-ZONE-004) — une carte
      générée qui suit la densité humaine, ou l'un des préréglages « tout
      PvE / tout sûr / tout PvP ». C'est le pendant de `densite.classeEn` :
      un point d'extension pur, sans état mutable.

   2. `creerEtat(opts)` — l'ÉTAT d'un serveur (ou d'une partie solo) : la
      politique choisie au lancement, et les redéfinitions de région posées
      par un administrateur (SPEC-ZONE-004, SPEC-ADMIN-006), qui priment
      toujours sur la carte générée. C'est l'équivalent, pour les zones, de
      `MC.Admin.creerEtat` — mutable, sérialisable, injecté par l'appelant
      (world.js le porte, server.js et game.js le lisent et l'écrivent). */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  // les quatre zones de jeu (SPEC-ZONE-001)
  var TYPES = ['pvp_pve', 'pvp', 'pve', 'sure'];
  // les politiques de génération que le serveur peut choisir (SPEC-ZONE-004)
  var POLITIQUES = ['generee', 'tout_pve', 'tout_sur', 'tout_pvp'];

  function estType(z) { return TYPES.indexOf(z) >= 0; }

  /* Règles d'une zone : dégâts permis entre joueurs, dégâts permis des
     monstres, apparitions hostiles autorisées (SPEC-ZONE-001, SPEC-ZONE-002).
     Une zone inconnue est traitée comme la plus permissive (pvp_pve) plutôt
     que de bloquer tout combat par surprise. */
  function regles(zone) {
    switch (zone) {
      case 'sure': return { degatsJoueurs: false, degatsMob: false, apparitionHostile: false };
      case 'pve':  return { degatsJoueurs: false, degatsMob: true, apparitionHostile: true };
      case 'pvp':  return { degatsJoueurs: true, degatsMob: true, apparitionHostile: false };
      default:     return { degatsJoueurs: true, degatsMob: true, apparitionHostile: true };  // pvp_pve
    }
  }

  // ── 1. la carte déterministe ─────────────────────────────────────────────
  /* `densiteApi` : l'objet renvoyé par MC.Densite.creer (classeEn), ou null —
     sans densité (monde de test, ou politique qui n'en dépend pas), la zone
     générée retombe sur pvp_pve, la plus dangereuse mais jamais bloquante. */
  function creer(N, densiteApi, opts) {
    opts = opts || {};
    var politique = POLITIQUES.indexOf(opts.politique) >= 0 ? opts.politique : 'generee';
    var spawn = opts.spawn || { x: 0, z: 0 };
    var rayonSpawn = opts.rayonSpawn || 24;

    /* Le point d'apparition du monde reste toujours sûr, quelle que soit la
       politique — sans quoi « tout PvP » livrerait un nouveau venu aux coups
       avant même qu'il ait pu s'équiper (SPEC-ZONE-001 : « les points
       d'apparition sûrs »). */
    function pointApparitionSur(x, z) {
      return Math.hypot(x - spawn.x, z - spawn.z) <= rayonSpawn;
    }

    function classeGeneree(x, z) {
      if (pointApparitionSur(x, z)) return 'sure';
      if (!densiteApi) return 'pvp_pve';
      var d = densiteApi.classeEn(x, z);
      // « les lieux habités … sûrs, les zones vierges plus dangereuses » :
      // une gradation entre les deux, sur la même carte que la densité.
      if (d.classe === 'hyperurbaine') return 'sure';
      if (d.classe === 'urbaine' || d.classe === 'rurale') return 'pve';
      return 'pvp_pve';                                        // vierge
    }

    /* La classe de base en un point, AVANT toute redéfinition d'un
       administrateur (voir zoneEn, plus bas, qui les applique). */
    function classeBase(x, z) {
      if (politique === 'tout_pve') return pointApparitionSur(x, z) ? 'sure' : 'pve';
      if (politique === 'tout_sur') return 'sure';
      if (politique === 'tout_pvp') return pointApparitionSur(x, z) ? 'sure' : 'pvp_pve';
      return classeGeneree(x, z);
    }

    return { classeBase: classeBase, politique: politique, pointApparitionSur: pointApparitionSur };
  }

  // ── 2. l'état mutable : politique retenue et redéfinitions de région ────
  /* Une région est une case grossière du monde (128×128 blocs) : assez large
     pour qu'un administrateur redéfinisse « les environs du donjon », sans
     avoir à poser bloc par bloc (SPEC-ZONE-004). */
  var TAILLE_REGION = 128;
  function regionDe(x, z) {
    return Math.floor(x / TAILLE_REGION) + ',' + Math.floor(z / TAILLE_REGION);
  }

  function creerEtat(opts) {
    opts = opts || {};
    return {
      politique: POLITIQUES.indexOf(opts.politique) >= 0 ? opts.politique : 'generee',
      regions: new Map(),          // regionKey -> { zone, auteur, depuis }
    };
  }

  /* `carte` : le résultat de `creer` ci-dessus (classeBase). `etat` : celui
     de `creerEtat`. Toujours passés séparément — la carte ne change jamais
     après la génération du monde, l'état si (une redéfinition, une reprise
     de sauvegarde). */
  /* `politiqueEtat` (facultatif, SPEC-FACTION-014) : l'état de MC.Politique
     (server.js/game.js le porte) — quand le territoire d'une faction couvre
     (x, z), sa relation dominante (guerre active, ou paix stable sur un
     territoire consolidé) module la zone générée. Priorité toujours à une
     redéfinition explicite d'administrateur, vérifiée EN PREMIER : jamais
     écrasée, quelle que soit l'influence politique du lieu. Point d'entrée
     ajouté sans toucher au reste de zoneEn/classeBase. */
  function zoneEn(carte, etat, x, z, politiqueEtat) {
    var region = etat && etat.regions.get(regionDe(x, z));
    if (region) return { zone: region.zone, redefinie: true };
    if (politiqueEtat && MC.Politique && MC.Politique.influenceZone) {
      var influence = MC.Politique.influenceZone(politiqueEtat, x, z);
      if (influence) return { zone: influence, redefinie: false, faction: true };
    }
    return { zone: carte ? carte.classeBase(x, z) : 'pvp_pve', redefinie: false };
  }

  function reglesEn(carte, etat, x, z) {
    return regles(zoneEn(carte, etat, x, z).zone);
  }

  /* Redéfinition d'une région par un administrateur (SPEC-ZONE-004,
     SPEC-ADMIN-006) : prime sur la carte générée tant qu'elle n'est pas
     retirée. `retirerRegion` rend la région à la carte générée. */
  function definirRegion(etat, x, z, zone, auteur, heure) {
    if (!estType(zone)) return { ok: false, motif: 'zone_invalide' };
    var cle = regionDe(x, z);
    etat.regions.set(cle, { zone: zone, auteur: auteur || null, depuis: heure || 0 });
    return { ok: true, region: cle, zone: zone };
  }
  function retirerRegion(etat, x, z) {
    return { ok: etat.regions.delete(regionDe(x, z)) };
  }
  function listeRegions(etat) {
    var l = [];
    etat.regions.forEach(function (r, cle) { l.push(Object.assign({ region: cle }, r)); });
    return l;
  }

  /* PvP entre deux positions (SPEC-COMBAT-002) : chacune doit se trouver
     dans une zone qui autorise les dégâts entre joueurs — un joueur réfugié
     en zone sûre ou PvE ne peut ni frapper ni être frappé depuis là, même si
     l'agresseur, lui, se tient en zone PvP. */
  function pvpAutorise(carte, etat, posA, posB) {
    var ra = reglesEn(carte, etat, posA.x, posA.z);
    var rb = reglesEn(carte, etat, posB.x, posB.z);
    return ra.degatsJoueurs && rb.degatsJoueurs;
  }

  // ── persistance (SPEC-SERVEUR-001) ──────────────────────────────────────
  function serialiser(etat) {
    return { v: 1, politique: etat.politique, regions: Array.from(etat.regions.entries()) };
  }
  function appliquer(etat, data) {
    if (!data || data.v !== 1) return false;
    etat.regions = new Map(data.regions || []);
    // la politique reste un réglage de LANCEMENT (--zone), comme la liste
    // blanche dans admin.js : reprise depuis la ligne de commande courante,
    // jamais depuis le fichier — sinon relancer sans --zone ne suffirait pas.
    return true;
  }

  MC.Zones = {
    TYPES: TYPES, POLITIQUES: POLITIQUES, TAILLE_REGION: TAILLE_REGION,
    regles: regles, creer: creer, creerEtat: creerEtat,
    regionDe: regionDe, zoneEn: zoneEn, reglesEn: reglesEn,
    definirRegion: definirRegion, retirerRegion: retirerRegion, listeRegions: listeRegions,
    pvpAutorise: pvpAutorise, serialiser: serialiser, appliquer: appliquer,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
