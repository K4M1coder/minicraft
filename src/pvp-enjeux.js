/* pvp-enjeux.js — B4 : PvP, enjeux et sanctions (docs/vague-2/B4.md,
   SPEC-PVP-001 à 006). Logique pure : ni socket ni DOM — server.js s'en sert
   comme branchement (comme guildes.js/politique.js/economie.js), et le solo
   ne s'en sert PAS (pas de PvP réseau hors ligne, B4.md § 5).

   Un module pur ne lit ses dépendances (MC.Admin pour canon()) qu'à l'APPEL,
   jamais au chargement, pour que l'ordre des <script>/MODULES ne casse rien —
   même règle que economie.js/politique.js, qui dupliquent aussi leur propre
   hachage déterministe plutôt que d'en dépendre. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  // ─── hachage déterministe (dupliqué de politique.js/economie.js h01) ───────
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
  function canon(nom) { return MC.Admin && MC.Admin.canon ? MC.Admin.canon(nom) : String(nom || '').trim().toLowerCase(); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ─── constantes (B4.md § 4) ─────────────────────────────────────────────────
  var FRACTION_MIN = 0.10, FRACTION_MAX = 0.25;
  var FENETRE_MEURTRES = 600;      // secondes de jeu (10 min) — voir server.js `heure`
  var SEUIL_MEURTRES = 3;
  var PENALITE = 10;
  var SEUIL_HORS_LA_LOI = -50;
  var DUREE_DUEL = 120;
  var DELAI_PROPOSITION = 30;
  var RAYON_DUEL = 32;
  var SUCCES = [1, 5, 25];

  // ─── état ────────────────────────────────────────────────────────────────
  function creerEtat() {
    return {
      v: 1,
      meurtres: new Map(),       // nom canon -> [heures des meurtres récents]
      victoires: new Map(),      // nom canon -> n
      reputations: new Map(),    // nom canon -> { factionId: valeur (-100..100) }
      propositions: new Map(),   // invité (canon) -> { de (canon), heure }
      duels: new Map(),          // cleDuel(a,b) -> { a, b, debut, fin, centre:{x,z} }
    };
  }
  function cleDuel(a, b) { return a < b ? a + '~' + b : b + '~' + a; }

  // ─── butin (SPEC-PVP-001) ───────────────────────────────────────────────────
  /* Vrai seulement si le PvP est autorisé (réglage + zone, COMBAT-002) ET
     qu'aucun duel consenti n'est en cours (SPEC-PVP-005 : jamais de butin en
     duel, même si le PvP est par ailleurs autorisé à cet endroit). */
  function butinAutorise(ctx) {
    return !!(ctx && ctx.pvpAutorise && !ctx.duel);
  }
  function totalObjets(inv) {
    var slots = (inv && inv.slots) || [];
    var t = 0;
    for (var i = 0; i < slots.length; i++) if (slots[i]) t += slots[i].n;
    return t;
  }
  /* Ajoute une pile déjà retirée du perdant à l'inventaire du gagnant.
     Renvoie le reliquat non casé (0 si tout est rentré) — même convention que
     MC.Inventory.add/addStack. Le `dmg` d'un outil n'est PAS préservé au
     passage (limitation connue, documentée : MC.Inventory.remove elle-même
     ne le préserve pas davantage lors d'un retrait par id — B4.md ne demande
     que la conservation des QUANTITÉS, pas de l'usure). */
  function ajouterButin(inv, pile) {
    if (!inv) return pile.n;
    if (pile.data !== undefined && inv.addStack) return inv.addStack(pile.id, pile.n, pile.data);
    return inv.add ? inv.add(pile.id, pile.n) : pile.n;
  }
  /* SPEC-PVP-001 : prélève une fraction bornée (10 à 25 %) du nombre total
     d'objets du PERDANT (équipement exclu : seul `invPerdant` — typiquement
     `state.inv` — est lu, jamais `state.equip`) et la remet au GAGNANT.
     Déterministe par `graine` (jamais Math.random, comme le reste de la
     vague 2) : rejouable, testable, insensible à l'ordre d'arrivée réseau.
     Atomique dans le sens où chaque objet retiré du perdant est soit rendu
     au gagnant soit renvoyé dans `reste` (jamais perdu, jamais dupliqué) —
     l'appelant fait tomber `reste` au sol (server.js : `lacherAuxPieds`). */
  function resoudreButin(invPerdant, invGagnant, graine) {
    var slots = (invPerdant && invPerdant.slots) || [];
    var total = totalObjets(invPerdant);
    var perte = [];
    if (total > 0) {
      var h = hache(graine, 'pvp-butin');
      var f = FRACTION_MIN + h * (FRACTION_MAX - FRACTION_MIN);
      var cible = Math.max(1, Math.round(total * f));
      for (var i = 0; i < slots.length && cible > 0; i++) {
        var s = slots[i];
        if (!s) continue;
        var pris = Math.min(s.n, cible);
        if (pris <= 0) continue;
        var pile = { id: s.id, n: pris };
        // une pile porteuse de dmg/data n'est jamais fragmentée (elle vaut 1
        // exemplaire en pratique — outil, livre) : prise entière ou laissée.
        if (pris === s.n) {
          if (s.dmg) pile.dmg = s.dmg;
          if (s.data !== undefined) pile.data = s.data;
        }
        perte.push(pile);
        cible -= pris;
        s.n -= pris;
        if (s.n <= 0) slots[i] = null;
      }
    }
    var reste = [];
    perte.forEach(function (p) {
      var r = ajouterButin(invGagnant, p);
      if (r > 0) reste.push({ id: p.id, n: r });
    });
    return { perte: perte, reste: reste };
  }

  // ─── factions proches (SPEC-PVP-003/006) ───────────────────────────────────
  /* Ids des factions politiques (MC.Politique) dont le territoire (siège +
     rayon) couvre (x, z) — mêmes noms de champs que politique.js
     (`f.siege.x/z`, `f.territoire`). Triées pour un ordre déterministe. */
  function factionsProches(politique, x, z) {
    var out = [];
    if (!politique || !politique.factions || !politique.factions.forEach) return out;
    politique.factions.forEach(function (f, id) {
      if (!f || !f.siege) return;
      var d = Math.hypot(f.siege.x - x, f.siege.z - z);
      if (d <= (f.territoire || 0)) out.push(id);
    });
    return out.sort();
  }

  // ─── réputation (SPEC-PVP-003/006) ─────────────────────────────────────────
  function reputation(etat, nom, factionId) {
    var r = etat.reputations.get(canon(nom));
    return (r && typeof r[factionId] === 'number') ? r[factionId] : 0;
  }
  function estHorsLaLoi(etat, nom, factionId) {
    return reputation(etat, nom, factionId) <= SEUIL_HORS_LA_LOI;
  }
  function appliquerReputation(etat, nom, factionId, delta) {
    var c = canon(nom);
    var r = etat.reputations.get(c);
    if (!r) { r = {}; etat.reputations.set(c, r); }
    var v = clamp((typeof r[factionId] === 'number' ? r[factionId] : 0) + delta, -100, 100);
    r[factionId] = v;
    return v;
  }
  /* SPEC-PVP-003 : enregistre un meurtre NON CONSENTI (l'appelant ne doit
     jamais appeler ceci pour un coup porté pendant un duel — B4.md § 6) ;
     fenêtre glissante de 10 min de jeu, dégradation de 10 points par meurtre
     à partir du 3e (donc -10 au 3e, -20 cumulé au 4e…), auprès de chaque
     faction dont le territoire couvre le lieu du meurtre. */
  function enregistrerMeurtre(etat, tueur, victime, heure, factions) {
    var nom = canon(tueur);
    var liste = (etat.meurtres.get(nom) || []).filter(function (h) { return heure - h < FENETRE_MEURTRES; });
    liste.push(heure);
    etat.meurtres.set(nom, liste);
    var penalites = [], horsLaLoi = [];
    if (liste.length >= SEUIL_MEURTRES) {
      (factions || []).forEach(function (factionId) {
        var valeur = appliquerReputation(etat, nom, factionId, -PENALITE);
        penalites.push({ id: factionId, delta: -PENALITE, valeur: valeur });
        if (valeur <= SEUIL_HORS_LA_LOI) horsLaLoi.push(factionId);
      });
    }
    return { penalites: penalites, horsLaLoi: horsLaLoi };
  }
  /* SPEC-PVP-006 : un joueur hors-la-loi (réputation ≤ -50) envers UNE
     faction dont le territoire couvre (x, z) subit l'embargo — peu importe
     ses relations avec d'autres factions ailleurs. */
  function embargo(etat, nom, politique, x, z) {
    var ids = factionsProches(politique, x, z);
    for (var i = 0; i < ids.length; i++) if (estHorsLaLoi(etat, nom, ids[i])) return true;
    return false;
  }

  // ─── duels consentis (SPEC-PVP-005) ────────────────────────────────────────
  function proposerDuel(etat, de, invite, heure) {
    var d = canon(de), inv = canon(invite);
    if (!d || !inv || d === inv) return { ok: false, motif: 'invalide' };
    etat.propositions.set(inv, { de: d, heure: heure });
    return { ok: true, de: d, invite: inv };
  }
  /* `accepte` false (ou proposition caduque) : rien ne se crée — refusé PAR
     DÉFAUT tant que l'invité ne répond pas explicitement (B4.md § 2).
     `posA`/`posB` : positions ACTUELLES du proposeur et de l'invité, prises
     par l'appelant au moment de la réponse — c'est leur point médian qui fixe
     le centre du duel (`RAYON_DUEL`), pas leurs positions au moment de la
     proposition. */
  function repondreDuel(etat, invite, accepte, heure, posA, posB) {
    var inv = canon(invite);
    var p = etat.propositions.get(inv);
    if (!p) return { ok: false, motif: 'aucune_proposition' };
    etat.propositions.delete(inv);
    if (heure - p.heure > DELAI_PROPOSITION) return { ok: false, motif: 'expiree' };
    if (!accepte) return { ok: true, refuse: true, de: p.de, invite: inv };
    var centre = { x: (posA.x + posB.x) / 2, z: (posA.z + posB.z) / 2 };
    var fin = heure + DUREE_DUEL;
    etat.duels.set(cleDuel(p.de, inv), { a: p.de, b: inv, debut: heure, fin: fin, centre: centre });
    return { ok: true, de: p.de, invite: inv, centre: centre, fin: fin };
  }
  /* Vrai seulement si un duel entre `a` et `b` est en cours (fin non
     dépassée) ET que LES DEUX se trouvent dans le rayon du duel autour de
     son centre — un joueur qui s'éloigne perd la protection/permission du
     duel (revérifié à CHAQUE coup, comme la portée d'un conteneur, B1). */
  function duelActif(etat, a, b, heure, posA, posB) {
    var ca = canon(a), cb = canon(b);
    if (!ca || !cb || ca === cb) return false;
    var d = etat.duels.get(cleDuel(ca, cb));
    if (!d) return false;
    if (heure > d.fin) return false;
    if (Math.hypot(posA.x - d.centre.x, posA.z - d.centre.z) > RAYON_DUEL) return false;
    if (Math.hypot(posB.x - d.centre.x, posB.z - d.centre.z) > RAYON_DUEL) return false;
    return true;
  }
  /* À appeler une fois par tic (server.js, même cadence qu'avancerEconomie) :
     purge les propositions caduques (silencieusement, pas d'évènement dédié —
     l'invité n'a rien à en apprendre, `/duel accepter` le lui dira assez tôt)
     et renvoie les duels qui viennent de se terminer ({a, b}) pour que
     l'appelant notifie les deux (`PVP duel_fin`). */
  function expirer(etat, heure) {
    var propositionsCaduques = [];
    etat.propositions.forEach(function (p, invite) {
      if (heure - p.heure > DELAI_PROPOSITION) propositionsCaduques.push(invite);
    });
    propositionsCaduques.forEach(function (invite) { etat.propositions.delete(invite); });
    var evts = [];
    var duelsFinis = [];
    etat.duels.forEach(function (d, cle) { if (heure > d.fin) duelsFinis.push(cle); });
    duelsFinis.forEach(function (cle) {
      var d = etat.duels.get(cle);
      etat.duels.delete(cle);
      evts.push({ a: d.a, b: d.b });
    });
    return evts;
  }

  // ─── succès et victoires (SPEC-PVP-004) ────────────────────────────────────
  function enregistrerVictoire(etat, nom) {
    var c = canon(nom);
    var n = (etat.victoires.get(c) || 0) + 1;
    etat.victoires.set(c, n);
    return n;
  }

  // ─── persistance (B4.md § 6 : duels et propositions ÉPHÉMÈRES, non
  // persistés — un redémarrage du serveur les perd, comme une reconnexion
  // perdrait de toute façon leurs deux participants). ────────────────────────
  function serialiser(etat) {
    return {
      v: 1,
      meurtres: Array.from(etat.meurtres.entries()),
      victoires: Array.from(etat.victoires.entries()),
      reputations: Array.from(etat.reputations.entries()).map(function (e) { return [e[0], Object.assign({}, e[1])]; }),
    };
  }
  function charger(data) {
    var etat = creerEtat();
    if (!data || data.v !== 1) return etat;
    etat.meurtres = new Map((data.meurtres || []).map(function (e) { return [e[0], (e[1] || []).slice()]; }));
    etat.victoires = new Map(data.victoires || []);
    etat.reputations = new Map((data.reputations || []).map(function (e) { return [e[0], Object.assign({}, e[1])]; }));
    return etat;
  }

  MC.PvpEnjeux = {
    FRACTION_MIN: FRACTION_MIN, FRACTION_MAX: FRACTION_MAX, FENETRE_MEURTRES: FENETRE_MEURTRES,
    SEUIL_MEURTRES: SEUIL_MEURTRES, PENALITE: PENALITE, SEUIL_HORS_LA_LOI: SEUIL_HORS_LA_LOI,
    DUREE_DUEL: DUREE_DUEL, DELAI_PROPOSITION: DELAI_PROPOSITION, RAYON_DUEL: RAYON_DUEL, SUCCES: SUCCES,
    creerEtat: creerEtat,
    butinAutorise: butinAutorise, resoudreButin: resoudreButin,
    factionsProches: factionsProches,
    reputation: reputation, estHorsLaLoi: estHorsLaLoi, enregistrerMeurtre: enregistrerMeurtre, embargo: embargo,
    proposerDuel: proposerDuel, repondreDuel: repondreDuel, duelActif: duelActif, expirer: expirer,
    enregistrerVictoire: enregistrerVictoire,
    serialiser: serialiser, charger: charger,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
