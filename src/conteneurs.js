/* conteneurs.js — MC.Conteneurs : module pur d'inventaire, équipement, grille
   de fabrication et conteneurs (B1, docs/vague-2/B1.md § 3).

   Même code pour le solo, la prédiction client en ligne et le serveur. Ne lit
   MC.Core / MC.Inventory / MC.ContratsV2 qu'à l'appel (chargé après
   `inventory`, avant `net-protocol` n'est pas requis ici). Ni THREE, ni DOM,
   ni socket. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var MAX_HUNGER = 20, MAX_HP = 20;
  var CHANCE_MALADIE = 1 / 3;

  function C() { return MC.Core; }
  function Inv() { return MC.Inventory; }
  function CV() { return MC.ContratsV2; }

  // ─── conteneurs ────────────────────────────────────────────────────────────
  function creerConteneur(type) {
    var t = CV().TYPES_CONTENEUR[type];
    if (!t) return null;
    var cont = { type: type, taille: t.taille, slots: new Array(t.taille).fill(null), rev: 0 };
    if (t.four) cont.four = { burn: 0, cook: 0 };
    return cont;
  }
  // la taille fixée à la création, ou celle du type (0 si type inconnu : tout indice refusé)
  function tailleConteneur(cont) {
    if (typeof cont.taille === 'number') return cont.taille;
    var t = CV().TYPES_CONTENEUR[cont.type];
    return t ? t.taille : 0;
  }

  function accepteCase(cont, i, pile) {
    var t = CV().TYPES_CONTENEUR[cont.type];
    if (!t || !t.four) return true;
    var F = CV().FOUR;
    if (i === F.ENTREE) return Inv().smeltResult(pile.id) > 0;
    if (i === F.COMBUSTIBLE) return Inv().fuelValue(pile.id) > 0;
    if (i === F.SORTIE) return false;
    return true;
  }

  // transformations de case blanche-listées (INV_CONSOMMER { vers })
  var TRANSFORMATIONS = [];
  function initTransformations() {
    if (TRANSFORMATIONS.length) return TRANSFORMATIONS;
    var I = C().I;
    TRANSFORMATIONS.push([I.SEAU_EAU, I.SEAU, false]);
    TRANSFORMATIONS.push([I.SEAU, I.SEAU_EAU, true]);
    return TRANSFORMATIONS;
  }
  function trouverTransformation(de, vers) {
    var liste = initTransformations();
    for (var i = 0; i < liste.length; i++) {
      if (liste[i][0] === de && liste[i][1] === vers) return { eau: !!liste[i][2] };
    }
    return null;
  }

  // ─── zones (emplacements du contrat) ──────────────────────────────────────
  function resolveZone(ctx, e) {
    if (e.z === 'inv') return { slots: ctx.joueur.inv.slots, cont: null };
    if (e.z === 'grille') return { slots: ctx.joueur.grille.slots, cont: null };
    var cont = ctx.conteneur(e.cle);
    if (!cont) return null;
    return { slots: cont.slots, cont: cont };
  }
  /* Revue adversariale (défaut confirmé) : le contrat (validerEmplacement,
     contrats-vague2.js) plafonne `i` à 27 pour TOUTE zone 'cont' — une borne
     générique, pas la taille RÉELLE du conteneur visé (fourneau 3, étagère 9,
     distributeur 9, bibliothèque 18), que seul le serveur connaît une fois le
     conteneur résolu. Sans cette vérification, `zd.slots[op.vers.i] = …`
     agrandissait le tableau JS au-delà de `cont.taille` : le conteneur ne
     correspondait alors plus au schéma persisté (`validerConteneurPersiste`
     exige `slots.length === taille`) et disparaissait ENTIER, silencieusement,
     au prochain `--monde` (perte totale, pas seulement de l'excédent).
     Toujours utiliser `cont.taille` (fixée à la création, jamais la longueur
     physique du tableau, qui pourrait déjà avoir grossi par ce même bug ou une
     vieille sauvegarde corrompue) — voir aussi `normaliserTailleConteneur`
     (server.js, défense en profondeur à la persistance). */
  function indiceValide(z, i) {
    if (typeof i !== 'number' || i < 0) return false;
    /* SPEC-JOUABLE-008 : un conteneur sans `taille` (le miroir client d'un
       conteneur en ligne en manquait) prend celle de son TYPE — jamais
       « undefined », qui refusait en silence tout transfert vers ou depuis
       un coffre ouvert : rien ne pouvait y entrer ni en sortir. */
    var taille = z.cont ? tailleConteneur(z.cont) : z.slots.length;
    return i < taille;
  }
  function marquerZone(mods, e) {
    if (e.z === 'inv') mods.inv = true;
    else if (e.z === 'grille') mods.grille = true;
    else if (mods.conteneurs.indexOf(e.cle) < 0) mods.conteneurs.push(e.cle);
  }
  function toucherRev(z) { if (z.cont) z.cont.rev = (z.cont.rev || 0) + 1; }

  // ─── opérations ────────────────────────────────────────────────────────────
  function transfert(ctx, op) {
    var zs = resolveZone(ctx, op.de), zd = resolveZone(ctx, op.vers);
    if (!zs || !zd) return { ok: false, motif: 'ferme' };
    // indice hors bornes du conteneur/zone RÉELLEMENT ciblé : refusé comme une
    // case absente (source) ou incompatible (destination) — jamais une
    // écriture qui agrandirait le tableau au-delà de sa taille véritable.
    if (!indiceValide(zs, op.de.i)) return { ok: false, motif: 'absent' };
    if (!indiceValide(zd, op.vers.i)) return { ok: false, motif: 'incompatible' };
    var S = zs.slots[op.de.i];
    if (!S) return { ok: false, motif: 'absent' };
    if (S.n < op.n) return { ok: false, motif: 'quantite' };
    var D = zd.slots[op.vers.i];
    var mods = { inv: false, equip: false, grille: false, conteneurs: [] };

    if (!D) {
      var aDmgOuData = !!S.dmg || S.data !== undefined;
      if (aDmgOuData && op.n !== S.n) return { ok: false, motif: 'incompatible' };
      var moved = { id: S.id, n: op.n };
      if (S.dmg) moved.dmg = S.dmg;
      if (S.data !== undefined) moved.data = S.data;
      if (!accepteCase(zd.cont || cadreLibre(), op.vers.i, moved)) return { ok: false, motif: 'incompatible' };
      zd.slots[op.vers.i] = moved;
      S.n -= op.n;
      if (S.n <= 0) zs.slots[op.de.i] = null;
    } else if (D.id === S.id && !S.dmg && !D.dmg && S.data === undefined && D.data === undefined) {
      var max = C().maxStack(S.id);
      if (D.n + op.n > max) return { ok: false, motif: 'plein' };
      D.n += op.n;
      S.n -= op.n;
      if (S.n <= 0) zs.slots[op.de.i] = null;
    } else {
      if (op.n !== S.n || op.n !== D.n) return { ok: false, motif: 'incompatible' };
      if (!accepteCase(zd.cont || cadreLibre(), op.vers.i, S) || !accepteCase(zs.cont || cadreLibre(), op.de.i, D)) {
        return { ok: false, motif: 'incompatible' };
      }
      zd.slots[op.vers.i] = S;
      zs.slots[op.de.i] = D;
    }
    marquerZone(mods, op.de); marquerZone(mods, op.vers);
    toucherRev(zs); toucherRev(zd);
    return { ok: true, modifs: mods, effets: {} };
  }
  // conteneur factice pour accepteCase quand la zone est inv/grille (accepte tout)
  var CADRE_LIBRE = { type: '__libre__' };
  function cadreLibre() { return CADRE_LIBRE; }

  function capacite(inv, id, n) {
    var max = C().maxStack(id), cap = 0;
    for (var i = 0; i < inv.slots.length && cap < n; i++) {
      var s = inv.slots[i];
      if (s && s.id === id) cap += max - s.n;
      else if (!s) cap += max;
    }
    return cap >= n;
  }
  function craft(ctx, op) {
    var grille = ctx.joueur.grille, inv = ctx.joueur.inv;
    var fait = 0, faits = [];
    for (var k = 0; k < op.fois; k++) {
      var ids = grille.slots.map(function (s) { return s ? s.id : 0; });
      var m = Inv().matchRecipe(ids, 3, 3);
      if (!m) { if (fait === 0) return { ok: false, motif: 'recette' }; break; }
      if (!capacite(inv, m.id, m.n)) { if (fait === 0) return { ok: false, motif: 'plein' }; break; }
      for (var i = 0; i < grille.slots.length; i++) if (grille.slots[i]) grille.consumeAt(i, 1);
      inv.add(m.id, m.n);
      faits.push(m.id);
      fait++;
    }
    // `ids` : ce qui a été fabriqué, une entrée par fois (le serveur en tire les succès)
    return { ok: true, modifs: { inv: true, equip: false, grille: true, conteneurs: [] }, effets: { fois: fait, ids: faits } };
  }

  function equip(ctx, op) {
    var inv = ctx.joueur.inv;
    var S = inv.slots[op.i];
    var E = ctx.joueur.equip[op.slot] || null;
    if (!S && !E) return { ok: false, motif: 'absent' };
    if (S) {
      var d = C().def(S.id);
      if (!d || d.equipSlot !== op.slot) return { ok: false, motif: 'incompatible' };
      if (S.n > 1) return { ok: false, motif: 'quantite' };
    }
    inv.slots[op.i] = E;
    ctx.joueur.equip[op.slot] = S;
    return { ok: true, modifs: { inv: true, equip: true, grille: false, conteneurs: [] }, effets: {} };
  }

  function consommer(ctx, op) {
    var inv = ctx.joueur.inv;
    var appliquees = 0, ignorees = 0;
    for (var k = 0; k < op.ops.length; k++) {
      var o = op.ops[k];
      var S = inv.slots[o.i];
      if (!S || S.id !== o.id) { ignorees++; continue; }
      if (o.n !== undefined) {
        if (S.n < o.n) { ignorees++; continue; }
        inv.consumeAt(o.i, o.n);
        appliquees++;
      } else if (o.usure !== undefined) {
        var casse = false, ok = false;
        for (var u = 0; u < o.usure && !casse; u++) {
          var r = inv.wearTool(o.i);
          if (r === null) break;
          ok = true;
          if (r === 'broken') casse = true;
        }
        if (ok) appliquees++; else ignorees++;
      } else if (o.vers !== undefined) {
        var paire = trouverTransformation(S.id, o.vers);
        if (!paire || (paire.eau && !(ctx.eauProche && ctx.eauProche()))) { ignorees++; continue; }
        S.id = o.vers;
        appliquees++;
      }
    }
    if (!appliquees) return { ok: false, motif: 'absent' };
    var effets = {};
    if (ignorees) effets.ignorees = ignorees;
    return { ok: true, modifs: { inv: true, equip: false, grille: false, conteneurs: [] }, effets: effets };
  }

  function manger(ctx, op) {
    var inv = ctx.joueur.inv;
    var i = op.i;
    if (i === undefined) {
      i = -1;
      for (var k = 0; k < inv.slots.length; k++) if (inv.slots[k] && inv.slots[k].id === op.id) { i = k; break; }
    }
    var S = i >= 0 ? inv.slots[i] : null;
    if (!S || S.id !== op.id) return { ok: false, motif: 'absent' };
    var d = C().def(op.id);
    if (!d || !d.food) return { ok: false, motif: 'incompatible' };
    var stats = ctx.stats;
    if (stats) {
      var plein = stats.faim >= MAX_HUNGER;
      var soinUtile = d.soin && stats.vie < (stats.vieMax || MAX_HP);
      if (plein && !soinUtile) return { ok: false, motif: 'interdit' };
    }
    inv.consumeAt(i, 1);
    var effets = { food: d.food };
    if (d.soin) effets.soin = d.soin;
    if (d.cru) effets.cru = (ctx.rand || Math.random)() < CHANCE_MALADIE;
    if (d.rend) {
      var reste = inv.add(d.rend, 1);
      if (reste) effets.lache = { id: d.rend, n: reste };
    }
    return { ok: true, modifs: { inv: true, equip: false, grille: false, conteneurs: [] }, effets: effets };
  }

  function lacher(ctx, op) {
    var inv = ctx.joueur.inv;
    var S = inv.slots[op.i];
    if (!S || S.n < op.n) return { ok: false, motif: 'absent' };
    var id = S.id, data = S.data;
    var removed = inv.consumeAt(op.i, op.n);
    // SPEC-JOUABLE-006 : la donnée de la pile (livre écrit, niveau d'une batterie…) part avec l'objet jeté
    var lache = { id: id, n: removed };
    if (data !== undefined) lache.data = data;
    return { ok: true, modifs: { inv: true, equip: false, grille: false, conteneurs: [] }, effets: { lache: lache } };
  }

  function creatif(ctx, op) {
    if (!ctx.regles || !ctx.regles.blocsIllimites) return { ok: false, motif: 'creatif' };
    var inv = ctx.joueur.inv;
    var max = C().maxStack(op.id);
    inv.slots[op.i] = { id: op.id, n: Math.min(op.n, max) };
    return { ok: true, modifs: { inv: true, equip: false, grille: false, conteneurs: [] }, effets: {} };
  }

  function rendreGrille(ctx) {
    var grille = ctx.joueur.grille, inv = ctx.joueur.inv;
    var reste = [];
    for (var i = 0; i < grille.slots.length; i++) {
      var s = grille.slots[i];
      if (!s) continue;
      var r = inv.add(s.id, s.n);
      if (r > 0) reste.push({ id: s.id, n: r });
      grille.slots[i] = null;
    }
    return { ok: true, modifs: { inv: true, equip: false, grille: true, conteneurs: [] }, effets: { reste: reste } };
  }

  /* DISTRIB (SPEC-SYNC-017) : le joueur déclare le contenu voulu, case par
     case, du conteneur `cont`. Ajout prélevé dans `inv` (tronqué à ce que le
     joueur possède), retrait rendu à `inv` (le non-casé reste dans le
     conteneur) : la somme inv + conteneur est conservée par objet. */
  function declarer(inv, cont, slotsDeclares) {
    for (var i = 0; i < cont.slots.length; i++) {
      var actuel = cont.slots[i];
      var voulu = slotsDeclares[i] || null;
      if (actuel && voulu && actuel.id === voulu.id) {
        var delta = voulu.n - actuel.n;
        if (delta > 0) {
          actuel.n += inv.remove(actuel.id, delta);
        } else if (delta < 0) {
          var rendu = inv.add(actuel.id, -delta);
          actuel.n = voulu.n + rendu;   // ce qui n'a pas pu être rendu reste dans le conteneur
        }
        if (actuel.n <= 0) cont.slots[i] = null;
      } else if (!actuel && voulu) {
        var pris = inv.remove(voulu.id, voulu.n);
        cont.slots[i] = pris > 0 ? { id: voulu.id, n: pris } : null;
      } else if (actuel && !voulu) {
        var r2 = inv.add(actuel.id, actuel.n);
        cont.slots[i] = r2 > 0 ? { id: actuel.id, n: r2 } : null;
      } else if (actuel && voulu && actuel.id !== voulu.id) {
        var r3 = inv.add(actuel.id, actuel.n);
        var n3 = inv.remove(voulu.id, voulu.n);
        if (n3 > 0) cont.slots[i] = { id: voulu.id, n: n3 };
        else cont.slots[i] = r3 > 0 ? { id: actuel.id, n: r3 } : null;
      }
    }
    cont.rev = (cont.rev || 0) + 1;
    return { ok: true };
  }

  function appliquer(ctx, op) {
    switch (op.k) {
      case 'transfert': return transfert(ctx, op);
      case 'craft': return craft(ctx, op);
      case 'equip': return equip(ctx, op);
      case 'consommer': return consommer(ctx, op);
      case 'manger': return manger(ctx, op);
      case 'lacher': return lacher(ctx, op);
      case 'creatif': return creatif(ctx, op);
      case 'rendreGrille': return rendreGrille(ctx);
      case 'declarer': {
        var cont = ctx.conteneur(op.cle);
        if (!cont) return { ok: false, motif: 'ferme' };
        declarer(ctx.joueur.inv, cont, (op.slots || []).map(CV().caseVersPile));
        return { ok: true, modifs: { inv: true, equip: false, grille: false, conteneurs: [op.cle] }, effets: {} };
      }
      default: return { ok: false, motif: 'inconnu' };
    }
  }

  // ─── fourneau ──────────────────────────────────────────────────────────────
  function tickFour(cont, dt) {
    if (!cont.four) return false;
    var F = CV().FOUR;
    var f = { input: cont.slots[F.ENTREE], fuel: cont.slots[F.COMBUSTIBLE], output: cont.slots[F.SORTIE],
              burn: cont.four.burn, cook: cont.four.cook };
    var changed = Inv().tickFurnace(f, dt);
    cont.slots[F.ENTREE] = f.input; cont.slots[F.COMBUSTIBLE] = f.fuel; cont.slots[F.SORTIE] = f.output;
    cont.four.burn = f.burn; cont.four.cook = f.cook;
    if (changed) cont.rev = (cont.rev || 0) + 1;
    return changed;
  }

  // ─── delta, instantané ─────────────────────────────────────────────────────
  function memePile(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return a.id === b.id && a.n === b.n && (a.dmg || 0) === (b.dmg || 0) &&
      JSON.stringify(a.data) === JSON.stringify(b.data);
  }
  function diff(avant, apres) {
    var out = [], n = Math.max(avant.length, apres.length);
    for (var i = 0; i < n; i++) {
      var a = avant[i] || null, b = apres[i] || null;
      if (!memePile(a, b)) out.push([i, CV().pileVersCase(b)]);
    }
    return out;
  }
  function clonerPile(s) {
    if (!s) return null;
    var p = { id: s.id, n: s.n };
    if (s.dmg) p.dmg = s.dmg;
    if (s.data !== undefined) p.data = s.data;
    return p;
  }
  function instantane(cont) {
    var out = { type: cont.type, taille: cont.taille, rev: cont.rev, slots: cont.slots.map(clonerPile) };
    if (cont.four) out.four = { burn: cont.four.burn, cook: cont.four.cook };
    return out;
  }
  function restaurer(cont, inst) {
    cont.slots = inst.slots.map(clonerPile);
    cont.rev = inst.rev;
    if (inst.four) cont.four = { burn: inst.four.burn, cook: inst.four.cook };
  }

  // ─── prédiction (client, SPEC-SYNC-008) ────────────────────────────────────
  function creerPrediction() {
    var seq = 0, file = [];
    return {
      suivant: function (op) { seq++; file.push({ seq: seq, op: op }); return seq; },
      confirmer: function (ack) { file = file.filter(function (e) { return e.seq > ack; }); },
      enAttente: function () { return file.slice(); },
      // rejoue les opérations en attente sur un état confirmé (copie),
      // avec le contexte fourni par l'appelant (regles/eauProche/stats) —
      // best-effort : une opération qui échouerait au rejeu est simplement ignorée.
      rejouer: function (etatConfirme, conteneursConfirmes, ctxExtra) {
        var base = ctxExtra || {};
        var ctx = {
          joueur: etatConfirme,
          conteneur: function (cle) { return conteneursConfirmes ? (conteneursConfirmes[cle] || null) : null; },
          regles: base.regles || { blocsIllimites: false },
          stats: base.stats, eauProche: base.eauProche, rand: base.rand,
        };
        file.forEach(function (e) { appliquer(ctx, e.op); });
        return etatConfirme;
      },
    };
  }

  // ─── enregistrement joueur (persistance, § 8) ──────────────────────────────
  function versEnregistrement(joueur, banque) {
    var rec = { v: 1, equip: {} };
    rec.inv = joueur.inv.slots.map(CV().pileVersCase);
    rec.banque = banque.slots.map(CV().pileVersCase);
    CV().EQUIP_SLOTS.forEach(function (s) { rec.equip[s] = CV().pileVersCase(joueur.equip[s]); });
    return rec;
  }
  function depuisEnregistrement(joueur, banque, rec) {
    var v = CV().validerEnregistrementJoueur(rec);
    if (!v) return false;
    joueur.inv.load(v.inv);
    banque.slots = v.banque.map(CV().caseVersPile);
    joueur.equip = {};
    CV().EQUIP_SLOTS.forEach(function (s) { joueur.equip[s] = CV().caseVersPile(v.equip[s]); });
    return true;
  }

  MC.Conteneurs = {
    creerConteneur: creerConteneur, accepteCase: accepteCase, appliquer: appliquer,
    tickFour: tickFour, diff: diff, instantane: instantane, restaurer: restaurer,
    creerPrediction: creerPrediction,
    versEnregistrement: versEnregistrement, depuisEnregistrement: depuisEnregistrement,
    declarer: declarer,
    get TRANSFORMATIONS() { return initTransformations(); },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
