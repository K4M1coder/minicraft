/* economie.js — prix dynamiques, trésors de lieux et commerce (SPEC-ECO-001 à
   007, SPEC-METIER-001 à 005, SPEC-SYNC-023). Logique pure, un état par
   monde (solo : g.economie ; serveur : la variable `economie` de la section
   B2 de server.js). Aucun Math.random : tout hachage est déterministe, comme
   politique.js (h01) — dupliqué ici pour ne dépendre de rien au chargement.

   Un module pur ne lit ses dépendances (MC.Habitats, MC.Inventory,
   MC.Metiers, MC.Caravanes, MC.ContratsV2) qu'à l'APPEL, jamais au
   chargement : l'ordre des <script> ne peut donc rien casser ici. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var B = C.B, I = C.I;

  // ─── hachage déterministe (dupliqué de politique.js h01, aucune dépendance) ─
  function h32(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function hache() {
    var s = '';
    for (var i = 0; i < arguments.length; i++) s += (i ? '|' : '') + arguments[i];
    return h32(s) / 4294967296;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function canon(nom) { return String(nom || '').trim().toLowerCase(); }

  // ─── référentiel des prix (SPEC-ECO-002) ────────────────────────────────────
  var BOIS_IDS = [B.LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.JUNGLE_LOG, B.ACACIA_LOG,
                  B.PLANKS, B.PLANCHES_BOULEAU, B.PLANCHES_SAPIN, B.PLANCHES_JUNGLE, B.PLANCHES_ACACIA];
  var GEMME_IDS = [I.DIAMOND, I.RUBIS, I.SAPHIR];
  var CATEGORIE_BASE = { nourriture: 0.15, bois: 0.1, minerai: 0.4, gemme: 1.2, outil: 0.6 };
  function categorieDe(objetId) {
    if (objetId === I.WHEAT || objetId === I.APPLE) return 'nourriture';
    if (BOIS_IDS.indexOf(objetId) >= 0) return 'bois';
    if (objetId === I.IRON_INGOT || objetId === I.COAL) return 'minerai';
    if (GEMME_IDS.indexOf(objetId) >= 0) return 'gemme';
    if (C.durabilityOf && C.durabilityOf(objetId)) return 'outil';
    return null;
  }
  /* SPEC-ECO-002 : émeraudes par unité, catégorie × facteur régional (biome)
     borné [0,5 ; 1,8]. Déterministe, indépendant de la graine du monde (le
     référentiel de prix de base est le même pour tous les mondes). */
  function prixBaseRegional(objetId, contexte) {
    var cat = categorieDe(objetId);
    var base = cat ? CATEGORIE_BASE[cat] : 0.2;
    var biome = (contexte && contexte.biome) || 'plaines';
    var f = clamp(0.5 + hache('biome', objetId, biome) * 1.3, 0.5, 1.8);
    return base * f;
  }

  // ─── état ────────────────────────────────────────────────────────────────
  var REF_STOCK = 64;         // stock de référence par défaut d'une ressource
  var TRESOR_MIN = 200, TRESOR_ETENDUE = 300;   // trésor cible d'un lieu, déterministe
  /* SPEC-METIER-002 (SPECS.md) : le minerai du forgeron est « alimenté par le
     commerce (ECO-004) ou une mine à proximité ». passageCaravane ne
     transporte que des ressources de `stocks` (le blé, le bois… jamais un
     village ne « fait passer » du minerai par charrette dans ce plan) : on
     retient donc l'autre moitié de la phrase — une mine à proximité — comme
     source par défaut, symétrique à `stocks` : un stock initial, qui repousse
     vers sa référence dans tickJour (voir plus bas). */
  var MINERAI_REF = 24;

  function creerEtat(graine) {
    return { v: 1, graine: graine || 1, jour: 0, lieux: new Map(), joueurs: new Map(), departs: new Map() };
  }

  function lieuDe(etat, lieu, contexte) {
    var id = typeof lieu === 'string' ? lieu : (lieu && lieu.id);
    if (!id) return null;
    if (etat.lieux.has(id)) return etat.lieux.get(id);
    var ctx = contexte || {};
    var biome = ctx.biome || (lieu && lieu.biome) || 'plaines';
    var x = (lieu && lieu.x) || 0, z = (lieu && lieu.z) || 0;
    var tresorCible = TRESOR_MIN + Math.floor(hache(etat.graine, 'tresor', id) * TRESOR_ETENDUE);
    var minerai = {};
    minerai[I.IRON_INGOT] = MINERAI_REF;   // « une mine à proximité » (METIER-002)
    var L = { id: id, biome: biome, x: x, z: z, tresor: tresorCible, tresorCible: tresorCible,
              stocks: {}, minerai: minerai, pnjs: {} };
    etat.lieux.set(id, L);
    return L;
  }
  function stockDe(L, objetId) {
    if (!L.stocks[objetId]) L.stocks[objetId] = { stock: REF_STOCK, ref: REF_STOCK };
    return L.stocks[objetId];
  }
  function pnjDe(L, pnjId) {
    if (!L.pnjs[pnjId]) L.pnjs[pnjId] = { echanges: 0 };
    return L.pnjs[pnjId];
  }
  function joueurDe(etat, nom) {
    var c = canon(nom);
    if (!c) return null;
    if (!etat.joueurs.has(c)) etat.joueurs.set(c, { collecte: {}, statuts: [] });
    return etat.joueurs.get(c);
  }

  // ─── offres et prix ──────────────────────────────────────────────────────
  /* Le côté non-émeraude d'une offre — ce qui distingue un achat (le joueur
     paie une émeraude) d'une vente (le joueur cède la ressource). */
  function estAchat(offre) { return offre.give.length === 1 && offre.give[0].id === I.EMERALD; }
  function ressourceDe(offre) { return estAchat(offre) ? offre.get : offre.give[0]; }

  /* SPEC-ECO-001 : prix courant réel d'un lot, borné à ±60 % du prix de base
     selon l'écart au stock de référence (e proche de 1 : stock épuisé, cher ;
     e proche de -1 : surstock, bon marché). */
  function prixCourant(etat, lieuId, offre) {
    var res = ressourceDe(offre);
    var L = lieuDe(etat, lieuId, {});
    var base = prixBaseRegional(res.id, { biome: L ? L.biome : 'plaines' });
    var s = L ? stockDe(L, res.id) : { stock: REF_STOCK, ref: REF_STOCK };
    var e = (s.ref - s.stock) / s.ref;
    return base * res.n * (1 + 0.6 * clamp(e / 0.75, -1, 1));
  }

  /* SPEC-ECO-001 : arrondi du lot conclu — l'émeraude à au moins 1, jamais 0 ;
     la quantité de marchandise reste celle de l'offre (simplification assumée
     du texte « lot ≥ 4 », voir docs/vague-2/B2.md § 10 et le rapport du lot). */
  function lotExecute(offre, prix) {
    var em = Math.max(1, Math.round(prix));
    if (estAchat(offre)) {
      return { give: [{ id: I.EMERALD, n: em }], get: { id: offre.get.id, n: offre.get.n } };
    }
    return { give: offre.give.map(function (g) { return { id: g.id, n: g.n }; }), get: { id: I.EMERALD, n: em } };
  }

  function acheter(etat, lieuId, objetId, n) {
    var L = lieuDe(etat, lieuId, {}); if (!L) return 0;
    var s = stockDe(L, objetId);
    s.stock = Math.max(0, s.stock - n);
    return s.stock;
  }
  function vendre(etat, lieuId, objetId, n) {
    var L = lieuDe(etat, lieuId, {}); if (!L) return 0;
    var s = stockDe(L, objetId);
    s.stock += n;
    return s.stock;
  }

  /* Ligne interne enrichie : offre brute, prix, ressource, disponibilité —
     partagée par offresDe (forme du contrat, réseau) et executerTroc (arbitre
     réellement l'échange). `role` absent ou inconnu : catalogue Inv.TRADES,
     prix figé, stock illimité, jamais de trésor (SPEC-ECO-001, § 13). */
  function offresInternes(etat, lieuId, role, pnjId, nom) {
    var Hab = MC.Habitats, Met = MC.Metiers, Inv = MC.Inventory;
    if (!role || !Hab || !Hab.ROLES[role]) {
      return (Inv ? Inv.TRADES : []).map(function (tr, i) {
        return { i: i, offre: tr, prix: null, res: null, achat: null, stock: null, dispo: true, minerai: 0 };
      });
    }
    var L = lieuDe(etat, lieuId, {});
    var roleDef = Hab.ROLES[role];
    var pnj = pnjId !== undefined && pnjId !== null ? pnjDe(L, pnjId) : null;
    var echanges = pnj ? pnj.echanges : 0;
    var offres = roleDef.offres.concat(Met ? Met.offresActives(role, echanges) : []);
    var jd = nom ? joueurDe(etat, nom) : null;
    var rem = jd && Met ? Met.remise(jd, role) : 0;
    return offres.map(function (o, i) {
      var res = ressourceDe(o);
      var achat = estAchat(o);
      var prix = Math.max(0, prixCourant(etat, lieuId, o) * (1 - rem));
      var s = L.stocks[res.id];
      var stock = s ? s.stock : null;
      var minReq = Met ? Met.mineraiRequis(o) : 0;
      var dispo = true;
      /* Un objet forgé depuis du minerai (METIER-002) n'est pas lui-même
         « en stock » : sa disponibilité ne dépend que du minerai du village,
         jamais d'un stock de l'objet fini (qui resterait à 0 pour toujours). */
      if (minReq > 0) { if ((L.minerai[I.IRON_INGOT] || 0) < minReq) dispo = false; }
      else if (achat && (stock === null || stock < res.n)) dispo = false;
      return { i: i, offre: o, prix: prix, res: res, achat: achat, stock: stock, dispo: dispo, minerai: minReq };
    });
  }

  /* Forme du contrat (ContratsV2.validerLigneOffre) : { i, give, get, prix,
     stock, dispo }. Appelée par le solo (game.js) et le serveur (réponse
     `troc consulter`). */
  function offresDe(etat, lieuId, role, pnjId, nom) {
    return offresInternes(etat, lieuId, role, pnjId, nom).map(function (li) {
      if (li.res === null) {
        var tr = li.offre;
        var prixFige = tr.get.id === I.EMERALD ? tr.get.n : (tr.give[0].id === I.EMERALD ? tr.give[0].n : 0);
        return { i: li.i, give: tr.give.map(function (g) { return { id: g.id, n: g.n }; }),
                 get: { id: tr.get.id, n: tr.get.n }, prix: prixFige, stock: null, dispo: true };
      }
      var lot = lotExecute(li.offre, li.prix);
      return { i: li.i, give: lot.give, get: lot.get, prix: +li.prix.toFixed(4), stock: li.stock, dispo: li.dispo };
    });
  }

  function placeDisponible(inv, id, n) {
    if (inv.firstEmpty() >= 0) return true;
    var max = C.maxStack(id), place = 0;
    for (var s = 0; s < inv.slots.length; s++) {
      var st = inv.slots[s];
      if (st && st.id === id) place += max - st.n;
    }
    return place >= n;
  }

  /* SPEC-SYNC-023 : arbitre un échange complet, EN DEUX PHASES strictes —
     tout valider (possession, stock, minerai, trésor, place dans
     l'inventaire) PUIS SEULEMENT APRÈS muter (inventaire, stock, minerai,
     trésor, compteurs) — jamais d'état intermédiaire en cas de refus.
     ctx = { lieuId, role, pnjId, indice, fois, nom, embargo? } ; `embargo`
     (calculé par B4 après son rebase) est vérifié EN PREMIER. */
  function executerTroc(etat, inv, ctx) {
    if (ctx.embargo) return { ok: false, motif: 'embargo' };
    var fois = ctx.fois && ctx.fois > 0 ? Math.floor(ctx.fois) : 1;
    var internes = offresInternes(etat, ctx.lieuId, ctx.role, ctx.pnjId, ctx.nom);
    var li = internes[ctx.indice];
    if (!li) return { ok: false, motif: 'offre' };

    var give, get, achat = !!li.achat, resId = li.res ? li.res.id : null, resN = 0;
    if (li.res === null) {
      var tr = li.offre;
      give = tr.give.map(function (g) { return { id: g.id, n: g.n * fois }; });
      get = { id: tr.get.id, n: tr.get.n * fois };
    } else {
      var lot = lotExecute(li.offre, li.prix);
      give = lot.give.map(function (g) { return { id: g.id, n: g.n * fois }; });
      get = { id: lot.get.id, n: lot.get.n * fois };
      resN = li.res.n * fois;
    }
    var emeraude = achat ? give[0].n : get.n;   // ce que le PNJ touche (achat) ou verse (vente)

    // ── phase 1 : validation, sans effet ───────────────────────────────────
    for (var i = 0; i < give.length; i++) {
      if (inv.count(give[i].id) < give[i].n) return { ok: false, motif: 'absent' };
    }
    var L = lieuDe(etat, ctx.lieuId, {});
    var minReq = (li.minerai || 0) * fois;
    /* Un objet forgé depuis du minerai (METIER-002) n'a pas de « stock »
       propre : seul le minerai du village le borne. */
    if (li.res !== null) {
      if (minReq > 0) {
        if ((L.minerai[I.IRON_INGOT] || 0) < minReq) return { ok: false, motif: 'stock' };
      } else if (achat) {
        var s = L.stocks[resId];
        if ((s ? s.stock : 0) < resN) return { ok: false, motif: 'stock' };
      } else if (L.tresor < emeraude) return { ok: false, motif: 'tresor' };
    }
    if (!placeDisponible(inv, get.id, get.n)) return { ok: false, motif: 'plein' };

    // ── phase 2 : mutation, en bloc ─────────────────────────────────────────
    for (var j = 0; j < give.length; j++) inv.remove(give[j].id, give[j].n);
    inv.add(get.id, get.n);
    if (li.res !== null) {
      if (minReq > 0) {
        L.minerai[I.IRON_INGOT] = Math.max(0, (L.minerai[I.IRON_INGOT] || 0) - minReq);
        L.tresor += emeraude;
      } else if (achat) {
        var st = stockDe(L, resId);
        st.stock = Math.max(0, st.stock - resN);
        L.tresor += emeraude;
      } else {
        var st2 = stockDe(L, resId);
        st2.stock += resN;
        L.tresor -= emeraude;
      }
    }
    if (ctx.pnjId !== undefined && ctx.pnjId !== null) pnjDe(L, ctx.pnjId).echanges += fois;
    if (ctx.nom && MC.Metiers) {
      var metier = MC.Metiers.metierDeCollecte(li.offre);
      if (metier && !achat) {
        var jd = joueurDe(etat, ctx.nom);
        jd.collecte[metier] = (jd.collecte[metier] || 0) + fois;
      }
    }
    var transaction = {
      offre: MC.ContratsV2 ? MC.ContratsV2.offreId(ctx.lieuId, ctx.role, ctx.indice) : (ctx.lieuId + '|' + ctx.role + '|' + ctx.indice),
      give: give, get: get, prix: emeraude, fois: fois,
    };
    var validee = MC.ContratsV2 ? MC.ContratsV2.validerTransaction(transaction) : transaction;
    return { ok: true, transaction: validee || transaction };
  }

  // ─── trésor, temps, banque ──────────────────────────────────────────────
  var MULT_SAISON = { ete: 1, printemps: 0.5, automne: 0.5, hiver: 0 };
  /* SPEC-ECO-003 : le trésor d'un lieu REVIENT vers sa cible (pas de plafond
     ouvert, qui diverge) ; les stocks regagnent leur référence, au rythme de
     la saison — dupliqué de world.js multCroissance (non exportée). */
  function tickJour(etat, jour, saison) {
    etat.jour = jour;
    var Met = MC.Metiers;
    var mult = MULT_SAISON[saison] !== undefined ? MULT_SAISON[saison] : 1;
    etat.lieux.forEach(function (L) {
      if (mult > 0) {
        Object.keys(L.stocks).forEach(function (id) {
          var s = L.stocks[id];
          var delta = Math.max(1, Math.round(s.ref * 0.08 * mult));
          if (s.stock < s.ref) s.stock = Math.min(s.ref, s.stock + delta);
          else if (s.stock > s.ref) s.stock = Math.max(s.ref, s.stock - delta);
        });
      } else if (Met) {
        /* SPEC-ENV-003 : hors saison de pousse (hiver, mult = 0), l'offre des
           métiers agricoles (nourriture, METIER-001) diminue à son tour,
           proportionnellement à la réduction de pousse hivernale (ici totale)
           — faute de récolte, le stock ne fait que s'épuiser ; il se restaure
           au cycle de printemps suivant via la branche mult > 0 ci-dessus
           (SAISON-006), inchangée pour toute autre ressource, qui gèle. */
        Object.keys(L.stocks).forEach(function (id) {
          if (!Met.estRessourceAgricole(+id)) return;
          var s = L.stocks[id];
          s.stock = Math.max(0, s.stock - Math.max(1, Math.round(s.ref * 0.08)));
        });
      }
      /* METIER-002 : la « mine à proximité » repousse vers MINERAI_REF, SANS
         dépendre de la saison (on mine toute l'année, contrairement à la
         pousse des cultures) — symétrique à la régénération des stocks. */
      if (L.minerai[I.IRON_INGOT] === undefined) L.minerai[I.IRON_INGOT] = 0;
      if (L.minerai[I.IRON_INGOT] < MINERAI_REF) {
        L.minerai[I.IRON_INGOT] = Math.min(MINERAI_REF, L.minerai[I.IRON_INGOT] + Math.max(1, Math.round(MINERAI_REF * 0.08)));
      }
      L.tresor += Math.round((L.tresorCible - L.tresor) * 0.05);
    });
  }

  /* SPEC-ECO-005 : 1 émeraude par tranche de 32 déposées, ≤ 4/jour, prélevé
     sur les piles d'émeraude dans l'ordre. `slots` : inv.slots (piles|null). */
  function appliquerFraisBanque(slots, jours) {
    if (!slots || !jours) return 0;
    var total = 0;
    for (var i = 0; i < slots.length; i++) { var s = slots[i]; if (s) total += s.n; }
    var tranches = Math.floor(total / 32);
    var parJour = Math.min(4, tranches);
    var frais = parJour * jours, reste = frais, retire = 0;
    for (var j = 0; j < slots.length && reste > 0; j++) {
      var st = slots[j];
      if (!st || st.id !== I.EMERALD) continue;
      var take = Math.min(st.n, reste);
      st.n -= take; reste -= take; retire += take;
      if (st.n <= 0) slots[j] = null;
    }
    return retire;
  }

  /* SPEC-ECO-006 : moyenne des prix courants des lieux connus dans le rayon. */
  function coursRegional(etat, x, z, rayon) {
    var totaux = {}, comptes = {};
    etat.lieux.forEach(function (L) {
      if (Math.hypot(L.x - x, L.z - z) > rayon) return;
      Object.keys(L.stocks).forEach(function (id) {
        var s = L.stocks[id];
        var base = prixBaseRegional(+id, { biome: L.biome });
        var e = (s.ref - s.stock) / s.ref;
        var prix = base * (1 + 0.6 * clamp(e / 0.75, -1, 1));
        totaux[id] = (totaux[id] || 0) + prix;
        comptes[id] = (comptes[id] || 0) + 1;
      });
    });
    return Object.keys(totaux).map(function (id) { return { id: +id, prix: totaux[id] / comptes[id] }; });
  }

  /* SPEC-ECO-004/METIER-005 : déplace le surplus réel (au-delà de la
     référence) d'un lieu vers un autre, idempotent par `etat.departs`.
     ctx = { origine, origineCtx, destination, destinationCtx } (objets lieu
     explicites, ou identifiants si déjà connus). */
  function passageCaravane(etat, trajet, indexDepart, ctx) {
    var dernier = etat.departs.has(trajet.id) ? etat.departs.get(trajet.id) : -1;
    if (indexDepart <= dernier) return { deplace: 0, rejoue: true };
    etat.departs.set(trajet.id, indexDepart);
    var Lo = lieuDe(etat, ctx.origine, ctx.origineCtx || {});
    var Ld = lieuDe(etat, ctx.destination, ctx.destinationCtx || {});
    if (!Lo || !Ld || !MC.Caravanes) return { deplace: 0 };
    var stocksOrigine = {};
    Object.keys(Lo.stocks).forEach(function (id) { stocksOrigine[id] = Lo.stocks[id].stock; });
    var cargaison = MC.Caravanes.cargaisonDe(trajet, indexDepart, stocksOrigine);
    if (!cargaison) return { deplace: 0 };
    var so = stockDe(Lo, cargaison.id), sd = stockDe(Ld, cargaison.id);
    var surplus = Math.max(0, so.stock - so.ref);
    var n = Math.min(cargaison.n, surplus);
    if (n > 0) { so.stock -= n; sd.stock += n; }
    return { objet: cargaison.id, n: n };
  }

  function masseDe(etat) {
    var m = 0;
    etat.lieux.forEach(function (L) { m += L.tresor; });
    return m;
  }

  /* SPEC-ECO-003 : simulation de plusieurs jours, pour vérifier que la masse
     monétaire (trésors des lieux) reste bornée. */
  function simuler(opts) {
    opts = opts || {};
    var etat = creerEtat(opts.graine || 1);
    var lieux = opts.lieux || [{ id: 'v1', biome: 'plaines', x: 0, z: 0 }, { id: 'v2', biome: 'desert', x: 800, z: 0 }];
    lieux.forEach(function (l) { lieuDe(etat, l, { biome: l.biome }); });
    var saisons = ['printemps', 'ete', 'automne', 'hiver'];
    var initiale = masseDe(etat);
    var masses = [];
    var jours = opts.jours || 100;
    for (var j = 1; j <= jours; j++) {
      tickJour(etat, j, saisons[j % saisons.length]);
      masses.push(masseDe(etat));
    }
    return { masses: masses, initiale: initiale };
  }

  // ─── sauvegarde ─────────────────────────────────────────────────────────
  function serialiser(etat) {
    var lieux = [];
    etat.lieux.forEach(function (L, id) {
      var stocks = {};
      Object.keys(L.stocks).forEach(function (k) { var s = L.stocks[k]; stocks[k] = [s.stock, s.ref, 0]; });
      var pnjs = {};
      Object.keys(L.pnjs).forEach(function (k) { pnjs[k] = { echanges: L.pnjs[k].echanges }; });
      lieux.push([id, { id: L.id, biome: L.biome, x: L.x, z: L.z, tresor: L.tresor, tresorCible: L.tresorCible,
                         stocks: stocks, minerai: L.minerai, pnjs: pnjs }]);
    });
    var joueurs = [];
    etat.joueurs.forEach(function (j, nom) { joueurs.push([nom, { collecte: j.collecte, statuts: j.statuts }]); });
    var departs = [];
    etat.departs.forEach(function (idx, trajetId) { departs.push([trajetId, idx]); });
    return { v: 1, graine: etat.graine, jour: etat.jour, lieux: lieux, joueurs: joueurs, departs: departs };
  }
  function charger(data) {
    var etat = creerEtat(data && data.graine !== undefined ? data.graine : 1);
    if (!data) return etat;
    etat.jour = data.jour || 0;
    (data.lieux || []).forEach(function (e) {
      var id = e[0], d = e[1] || {};
      var stocks = {};
      Object.keys(d.stocks || {}).forEach(function (k) { var v = d.stocks[k]; stocks[k] = { stock: v[0], ref: v[1] }; });
      etat.lieux.set(id, { id: d.id || id, biome: d.biome || 'plaines', x: d.x || 0, z: d.z || 0,
                            tresor: d.tresor || 0, tresorCible: d.tresorCible || 0,
                            stocks: stocks, minerai: d.minerai || {}, pnjs: d.pnjs || {} });
    });
    (data.joueurs || []).forEach(function (e) { etat.joueurs.set(e[0], { collecte: (e[1] && e[1].collecte) || {}, statuts: (e[1] && e[1].statuts) || [] }); });
    (data.departs || []).forEach(function (e) { etat.departs.set(e[0], e[1]); });
    return etat;
  }

  MC.Economie = {
    creerEtat: creerEtat, lieuDe: lieuDe, ressourceDe: ressourceDe, estAchat: estAchat,
    prixBaseRegional: prixBaseRegional, prixCourant: prixCourant, lotExecute: lotExecute,
    offresDe: offresDe, executerTroc: executerTroc,
    acheter: acheter, vendre: vendre, appliquerFraisBanque: appliquerFraisBanque,
    coursRegional: coursRegional, tickJour: tickJour, passageCaravane: passageCaravane,
    simuler: simuler, serialiser: serialiser, charger: charger,
    // exposés pour les tests et pour metiers/executerTroc côté serveur
    categorieDe: categorieDe, REF_STOCK: REF_STOCK,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
