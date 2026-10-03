/* circuits.js — L29 mécanismes : circuits logiques et énergie
   (SPEC-MECA-001 à 008). Logique pure, entièrement testable sous Node.

   Deux façons d'utiliser ce module :
   - un graphe de signaux indépendant du monde (creerReseau/tickReseau),
     pratique pour tester chaque porte, le délai d'un répéteur, la mémoire
     d'une bascule, un compteur, un comparateur et la stabilité d'un cycle ;
   - une simulation posée sur les blocs chargés d'un MC.World (tick), qui
     relit ce même graphe à chaque tic à partir du voisinage des blocs
     `circuit` (voir src/core.js) et écrit le résultat dans leur état
     (world.getEtat/setEtat, SPEC-SAVE-017 : ça sauvegarde tout seul).

   Déterminisme et absence de boucle infinie (SPEC-MECA-004) : chaque tic lit
   UNIQUEMENT les valeurs du tic précédent (une passe, jamais de récursion
   pendant l'évaluation), donc un cycle ne peut jamais boucler indéfiniment
   PENDANT un tic — au pire il oscille d'un tic à l'autre. `validerReseau`
   repère en plus les cycles qui ne traversent aucun élément à mémoire
   (répéteur, bascule, compteur) : ceux-là oscillent à la fréquence du tic,
   ce qui est le signe d'un montage instable plutôt que d'un oscillateur
   voulu (un répéteur dans la boucle borne la fréquence à son délai). */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var B = C.B;

  // ─── portes logiques : table de vérité (SPEC-MECA-004) ────────────────────
  function porte(type, entrees) {
    var xs = (entrees || []).map(function (v) { return v ? 1 : 0; });
    var n = xs.filter(Boolean).length;
    switch (type) {
      case 'oui': return xs[0] ? 1 : 0;
      case 'non': return xs[0] ? 0 : 1;
      case 'et': return xs.length && xs.every(Boolean) ? 1 : 0;
      case 'ou': return xs.some(Boolean) ? 1 : 0;
      case 'xor': return (n % 2 === 1) ? 1 : 0;
      case 'nand': return xs.length && xs.every(Boolean) ? 0 : 1;
      case 'nor': return xs.some(Boolean) ? 0 : 1;
      case 'xnor': return (n % 2 === 1) ? 0 : 1;
      default: return 0;
    }
  }
  var PORTES_COMBINATOIRES = ['fil', 'oui', 'non', 'et', 'ou', 'xor', 'nand', 'nor', 'xnor', 'comparateur'];

  // ─── éléments à mémoire ou à délai, pas à pas (réutilisés par le graphe et
  //     par la simulation sur le monde — une seule règle, deux usages) ──────
  // Répéteur : `n` tics d'entrée haute avant de recopier l'entrée en sortie ;
  // dès que l'entrée retombe, le compte revient à zéro (pas de mémoire).
  function pasRepeteur(etat, entreeHaute, delai) {
    delai = Math.max(1, delai || 1);
    var compte = entreeHaute ? Math.min(delai, (etat.compte || 0) + 1) : 0;
    return { compte: compte, sortie: compte >= delai ? 1 : 0 };
  }
  // Bascule : bascule (0<->1) sur front montant de `set` ; `reset` force 0.
  function pasBascule(etat, set, reset) {
    var mem = etat.memoire || 0;
    if (reset) mem = 0;
    else if (set && !etat.setPrecedent) mem = mem ? 0 : 1;
    return { memoire: mem, setPrecedent: set ? 1 : 0, sortie: mem };
  }
  // Compteur : avance de 1 (modulo `mod`) à chaque front montant de l'entrée.
  function pasCompteur(etat, entreeHaute, mod) {
    mod = mod || 16;
    var val = etat.valeur || 0;
    if (entreeHaute && !etat.entreePrecedente) val = (val + 1) % mod;
    return { valeur: val, entreePrecedente: entreeHaute ? 1 : 0, sortie: val };
  }
  // Comparateur : compare deux niveaux (0..15) ; 'egal' ou (par défaut) '>='.
  function pasComparateur(a, b, mode) {
    a = a | 0; b = b | 0;
    return mode === 'egal' ? (a === b ? 1 : 0) : (a >= b ? 1 : 0);
  }

  // ─── graphe de signaux indépendant du monde ────────────────────────────────
  function creerReseau(noeuds) {
    var index = {};
    noeuds.forEach(function (n) {
      n.entrees = n.entrees || [];
      n.etat = n.etat || 0;
      n._m = n._m || {};                 // mémoire interne (répéteur/bascule/compteur)
      index[n.id] = n;
    });
    return { noeuds: noeuds, index: index };
  }
  function fixerEntree(reseau, id, valeur) {
    var n = reseau.index[id];
    if (n) n.etat = valeur ? 1 : 0;
  }
  function tickReseau(reseau) {
    var nouveaux = {};
    reseau.noeuds.forEach(function (n) {
      var vals = n.entrees.map(function (id) {
        var src = reseau.index[id];
        return src ? (src.etat || 0) : 0;
      });
      var bruts = vals.map(function (v) { return v ? 1 : 0; });
      var r;
      switch (n.type) {
        case 'entree': nouveaux[n.id] = n.etat; break;
        case 'fil': nouveaux[n.id] = bruts.some(Boolean) ? 1 : 0; break;
        case 'oui': case 'non': case 'et': case 'ou': case 'xor': case 'nand': case 'nor': case 'xnor':
          nouveaux[n.id] = porte(n.type, bruts); break;
        case 'repeteur':
          r = pasRepeteur(n._m, !!bruts[0], n.delai);
          n._m.compte = r.compte;
          nouveaux[n.id] = r.sortie;
          break;
        case 'bascule':
          r = pasBascule(n._m, !!bruts[0], !!bruts[1]);
          n._m.memoire = r.memoire; n._m.setPrecedent = r.setPrecedent;
          nouveaux[n.id] = r.sortie;
          break;
        case 'compteur':
          r = pasCompteur(n._m, !!bruts[0], n.mod);
          n._m.valeur = r.valeur; n._m.entreePrecedente = r.entreePrecedente;
          nouveaux[n.id] = r.valeur;
          break;
        case 'comparateur':
          nouveaux[n.id] = pasComparateur(vals[0], vals[1], n.mode);
          break;
        default: nouveaux[n.id] = 0;
      }
    });
    reseau.noeuds.forEach(function (n) { n.etat = nouveaux[n.id]; });
    return reseau;
  }
  /* Cherche un cycle qui ne traverse QUE des nœuds combinatoires (sans délai
     ni mémoire) : un tel montage change à chaque tic, signe d'un circuit
     instable plutôt que d'un oscillateur borné. DFS avec coloriage. */
  function validerReseau(reseau) {
    var couleur = {};   // 0 blanc, 1 gris (en cours), 2 noir (fini)
    var pile = [];
    var cycleTrouve = null;
    function visiter(id) {
      if (cycleTrouve) return;
      couleur[id] = 1; pile.push(id);
      var n = reseau.index[id];
      (n ? n.entrees : []).forEach(function (dep) {
        if (cycleTrouve || !reseau.index[dep]) return;
        if (couleur[dep] === 1) {
          var i = pile.indexOf(dep);
          var cycle = pile.slice(i);
          var instable = cycle.every(function (cid) {
            return PORTES_COMBINATOIRES.indexOf(reseau.index[cid].type) >= 0;
          });
          if (instable) cycleTrouve = cycle;
        } else if (couleur[dep] !== 2) visiter(dep);
      });
      pile.pop(); couleur[id] = 2;
    }
    reseau.noeuds.forEach(function (n) { if (!couleur[n.id]) visiter(n.id); });
    return cycleTrouve ? { ok: false, cycle: cycleTrouve } : { ok: true };
  }

  // ─── énergie (SPEC-MECA-002, SPEC-MECA-003) ────────────────────────────────
  // Éolienne : plus de vent et plus haut, plus de puissance (bornée à 15).
  function puissanceEolienne(vent, altitude, altitudeMax) {
    var vitesse = vent ? Math.hypot(vent.x || 0, vent.z || 0) : 0;
    var facteurAlt = altitudeMax > 0 ? Math.max(0.2, Math.min(1, (altitude || 0) / altitudeMax)) : 1;
    return Math.max(0, Math.min(15, Math.round(vitesse * 10 * facteurAlt)));
  }
  // Roue/turbine hydraulique : proportionnelle au courant local (SPEC-EAU-002).
  function puissanceHydraulique(niveauEau) {
    return Math.max(0, Math.min(15, niveauEau | 0));
  }
  // Générateur thermique : lave à proximité (continu) ou combustible (fini,
  // décompté en tics, comme un fourneau) — l'un ou l'autre suffit.
  function puissanceThermique(laveProche, combustibleRestant) {
    if (laveProche) return 15;
    return combustibleRestant > 0 ? 10 : 0;
  }
  // Câble : perte proportionnelle (par bloc) sur la puissance transportée.
  function transporterEnergie(puissance, longueur, perteParBloc) {
    var p = perteParBloc === undefined ? 0.06 : perteParBloc;
    var v = (puissance || 0) * Math.pow(1 - p, Math.max(0, longueur || 0));
    return Math.max(0, Math.round(v));
  }
  /* Batterie : charge/décharge bornées par tic (débit maximal), niveau
     borné à [0, capacite]. `demande` > 0 tire de l'énergie (déchargement),
     `apport` > 0 en fournit (chargement) — l'un exclut l'autre par appel. */
  function tickBatterie(niveau, capacite, apport, demande, tauxMax) {
    tauxMax = tauxMax === undefined ? 4 : tauxMax;
    niveau = Math.max(0, Math.min(capacite, niveau || 0));
    var fourni = 0;
    if (apport > 0) {
      var charge = Math.min(tauxMax, apport, capacite - niveau);
      niveau += Math.max(0, charge);
    } else if (demande > 0) {
      fourni = Math.min(tauxMax, demande, niveau);
      niveau -= fourni;
    }
    return { niveau: niveau, fourni: fourni };
  }

  // ─── détecteurs et commandes (SPEC-MECA-005) ───────────────────────────────
  // `type` : bouton, levier, plaque, presence, lumiere, journuit, pluie-vent,
  // horloge, eau. `ctx` porte les grandeurs déjà calculées par l'appelant
  // (ce module ne lit ni le monde ni les joueurs directement).
  function detecteur(type, ctx) {
    ctx = ctx || {};
    switch (type) {
      case 'levier': return ctx.actionne ? 1 : 0;
      case 'bouton': return ctx.appuye ? 1 : 0;
      case 'plaque': return (ctx.presents || 0) > 0 ? 1 : 0;
      case 'presence': return (ctx.proches || 0) > 0 ? 1 : 0;
      case 'lumiere': return (ctx.niveau || 0) >= (ctx.seuil === undefined ? 8 : ctx.seuil) ? 1 : 0;
      case 'journuit': return ctx.nuit ? 1 : 0;
      case 'pluie-vent':
        return (ctx.pluie || (ctx.ventVitesse || 0) >= (ctx.seuilVent === undefined ? 1 : ctx.seuilVent)) ? 1 : 0;
      case 'horloge': {
        var p = ctx.periode || 2;
        return Math.floor((ctx.temps || 0) / p) % 2 === 0 ? 1 : 0;
      }
      case 'eau': return (ctx.niveauEau || 0) > 0 ? 1 : 0;
      default: return 0;
    }
  }

  // ─── appareils (SPEC-MECA-006) ─────────────────────────────────────────────
  // Un appareil s'arrête toujours sans énergie, quel que soit le signal.
  function appareil(alimente, signal) {
    return !!(alimente && signal);
  }

  // ─── distributeurs et pistons (SPEC-MECA-001) ──────────────────────────────
  function distributeurChoix(slots) {
    for (var i = 0; i < (slots || []).length; i++) if (slots[i] && slots[i].n > 0) return i;
    return -1;
  }
  var LONGUEUR_MAX_PISTON = 12;
  /* Pousse une rangée de blocs pleins depuis (x,y,z)+dir : s'arrête dès l'air
     (ou un remplaçable), échoue si le bloc n'est pas repoussable (aucun drop
     — un socle par ex.) ou si plus de 12 blocs pleins s'enchaînent.
     `lireBloc(x,y,z)` -> id. Renvoie {ok, positions} du plus loin au plus
     proche (l'ordre dans lequel il faut réécrire pour ne rien perdre). */
  function poussee(lireBloc, x, y, z, dir, collant) {
    var chaine = [];
    var cx = x + dir.x, cy = y + dir.y, cz = z + dir.z;
    for (var i = 0; i < LONGUEUR_MAX_PISTON + 1; i++) {
      var id = lireBloc(cx, cy, cz);
      if (C.isReplaceable(id)) {
        return { ok: true, positions: chaine.slice().reverse(), destination: [cx, cy, cz] };
      }
      var d = C.BLOCKS[id];
      if (!d || d.hardness < 0 || (d.circuit && d.circuit.type === 'commande')) return { ok: false, raison: 'bloque' };
      chaine.push([cx, cy, cz, id]);
      if (chaine.length > LONGUEUR_MAX_PISTON) return { ok: false, raison: 'trop-long' };
      cx += dir.x; cy += dir.y; cz += dir.z;
    }
    return { ok: false, raison: 'trop-long' };
  }
  // Piston collant : en se rétractant, tire le bloc juste devant la tête
  // (position de la tête = position poussée à un bloc) s'il est repoussable.
  function traction(lireBloc, xTete, yTete, zTete, dir) {
    var id = lireBloc(xTete, yTete, zTete);
    var d = C.BLOCKS[id];
    if (!d || C.isReplaceable(id) || d.hardness < 0) return null;
    return { depuis: [xTete, yTete, zTete], vers: [xTete - dir.x, yTete - dir.y, zTete - dir.z], id: id };
  }

  // ─── blocs de commande (SPEC-MECA-007) ─────────────────────────────────────
  // Poser/modifier : réservé à un administrateur connecté au serveur, ou au
  // mode créatif hors ligne (personne d'autre à protéger).
  function commandeAutorisee(ctx) {
    ctx = ctx || {};
    if (ctx.role === 'admin') return true;
    /* Une seule règle, que le serveur soit fermé (solo) ou ouvert : un
       administrateur, ou l'hôte (la machine qui fait tourner le serveur) en
       mode créatif. Un joueur distant n'y touche jamais sans être admin. */
    if (ctx.enLigne) return ctx.mode === 'creatif' && !!ctx.hote;
    return ctx.mode === 'creatif';
  }
  // Déclenche sur front montant du signal ; `actif` retombe avec lui.
  function commandeDeclenche(signal, precedent) {
    return !!(signal && !precedent);
  }

  // ─── simulation sur le monde chargé (SPEC-MECA-008) ────────────────────────
  var VOISINS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // orientation d'un piston (SPEC-MECA-001) : 3 bits (0..5) dans l'état,
  // bit 3 = étendu. Mêmes six directions que VOISINS6, nommées pour lisibilité.
  var DIRS_PISTON = [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 },
                      { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }];
  function estCircuit(id) {
    var d = C.BLOCKS[id];
    return !!(d && d.circuit);
  }
  // Force qu'une case transmet à un voisin direct, AVANT le tic (lecture
  // seule de l'état déjà en place) : 15 pour une source/sortie haute, la
  // force propre décrémentée pour un fil (comme un câble redstone), 0 sinon.
  function forceDe(api, x, y, z) {
    var id = api.getBlock(x, y, z);
    var d = C.BLOCKS[id];
    if (!d || !d.circuit) return 0;
    var e = api.getEtat(x, y, z) || 0;
    if (d.circuit.type === 'fil') return e & 15;
    return (e & 1) ? 15 : 0;
  }
  function forceEnergieDe(api, x, y, z) {
    var id = api.getBlock(x, y, z);
    var d = C.BLOCKS[id];
    if (!d || !d.circuit) return 0;
    var e = api.getEtat(x, y, z) || 0;
    if (d.circuit.type === 'cable') return e & 15;
    if (d.circuit.generateur || d.circuit.type === 'batterie') return e & 15;
    return 0;
  }
  /* Un tic de la simulation posée sur le monde. `positions` : liste [x,y,z,id]
     des blocs `circuit` des chunks CHARGÉS (le registre de world.js s'arrête
     de lui-même aux chunks déchargés — rien à filtrer ici). `api` :
     {getBlock,getEtat,setEtat,setBlock}. `ctx` : grandeurs externes déjà
     calculées par l'appelant (temps, météo, présence…). Déterministe : tout
     se lit AVANT tout se réécrire (une passe, comme tickReseau). */
  function tick(positions, api, ctx) {
    ctx = ctx || {};
    var avant = positions.map(function (p) {
      return { x: p[0], y: p[1], z: p[2], id: p[3], etat: api.getEtat(p[0], p[1], p[2]) || 0 };
    });
    var ecrits = [];
    avant.forEach(function (b) {
      var d = C.BLOCKS[b.id];
      var estPorte = C.estPorte(b.id), estTrappe = C.estTrappe(b.id);
      if (!d || !(d.circuit || estPorte || estTrappe)) return;
      var t = d.circuit ? d.circuit.type : (estPorte ? 'porte' : 'trappe');
      var entrees = VOISINS6.map(function (v) { return forceDe(api, b.x + v[0], b.y + v[1], b.z + v[2]); });
      var bruts = entrees.map(function (f) { return f > 0; });
      var nouvelEtat = b.etat, allume = null;
      if (t === 'porte' || t === 'trappe') {
        /* Motorisées par un signal voisin (SPEC-MECA-006), mais seulement à
           ses FRONTS : le signal monte, elle s'ouvre ; il retombe, elle se
           ferme. Entre deux fronts, la main du joueur (ou d'un habitant) fait
           foi : imposer l'état du signal à CHAQUE tic refermait au tic suivant
           toute porte ouverte à la main sans signal. Le dernier signal vu est
           mémorisé dans le bit 0 de l'état du bloc (inutilisé par les portes
           et trappes, effacé quand le bloc est cassé). */
        var signal = bruts.some(Boolean);
        if (signal === !!(b.etat & 1)) return;
        var estOuverte = t === 'porte' ? d.porte.ouverte : d.trappe.ouverte;
        if (signal !== estOuverte) ecrits.push({ x: b.x, y: b.y, z: b.z, setBlock: C.bascule(b.id) });
        ecrits.push({ x: b.x, y: b.y, z: b.z, setEtat: signal ? (b.etat | 1) : (b.etat & ~1) });
        return;
      }
      if (t === 'fil') {
        var meilleur = 0;
        entrees.forEach(function (f) { meilleur = Math.max(meilleur, f - 1); });
        nouvelEtat = Math.max(0, meilleur);
      } else if (t === 'cable') {
        var m2 = 0;
        VOISINS6.forEach(function (v) { m2 = Math.max(m2, forceEnergieDe(api, b.x + v[0], b.y + v[1], b.z + v[2]) - 1); });
        nouvelEtat = Math.max(0, m2);
      } else if (PORTES_COMBINATOIRES.indexOf(t) >= 0 && t !== 'fil' && t !== 'comparateur') {
        nouvelEtat = porte(t, bruts) ? 1 : 0;
      } else if (t === 'repeteur') {
        var mem = { compte: (b.etat >> 1) & 0x7f };
        var r = pasRepeteur(mem, bruts.some(Boolean), (d.circuit.delai) || 1);
        nouvelEtat = (r.sortie & 1) | ((r.compte & 0x7f) << 1);
      } else if (t === 'bascule') {
        var m3 = { memoire: b.etat & 1, setPrecedent: (b.etat >> 1) & 1 };
        var r2 = pasBascule(m3, bruts[0], bruts[1]);
        nouvelEtat = (r2.sortie & 1) | ((r2.setPrecedent & 1) << 1);
      } else if (t === 'compteur') {
        var m4 = { valeur: b.etat & 15, entreePrecedente: (b.etat >> 4) & 1 };
        var r3 = pasCompteur(m4, bruts[0], 16);
        nouvelEtat = (r3.valeur & 15) | ((r3.entreePrecedente & 1) << 4);
      } else if (t === 'comparateur') {
        nouvelEtat = pasComparateur(entrees[0], entrees[1], d.circuit.mode) ? 1 : 0;
      } else if (t === 'lampe') {
        var estAlim = (ctx.energieDisponible === undefined) || ctx.energieDisponible;
        allume = appareil(estAlim, bruts.some(Boolean));
      } else if (t === 'tapis' || t === 'ascenseur' || t === 'alarme') {
        nouvelEtat = appareil(ctx.energieDisponible !== false, bruts.some(Boolean)) ? 1 : 0;
      } else if (t === 'eolienne') {
        // le vent DE SON ALTITUDE (SPEC-VENT-001) : `ctx.vent` permet de rejouer
        // une situation précise en test, sinon on l'interroge nous-mêmes.
        var vent = ctx.vent !== undefined ? ctx.vent
                 : (MC.Meteo ? MC.Meteo.ventEn(ctx.temps || 0, b.y) : null);
        nouvelEtat = puissanceEolienne(vent, b.y, ctx.altitudeMax || 128);
      } else if (t === 'hydraulique') {
        // le courant local (SPEC-EAU-002) : le plus fort niveau d'eau voisin
        var niveauEau = ctx.niveauEau;
        if (niveauEau === undefined) {
          niveauEau = 0;
          if (MC.Eau) VOISINS6.forEach(function (v) {
            niveauEau = Math.max(niveauEau, MC.Eau.niveauDe(api.getBlock(b.x + v[0], b.y + v[1], b.z + v[2])));
          });
        }
        nouvelEtat = puissanceHydraulique(niveauEau);
      } else if (t === 'thermique') {
        var laveProche = ctx.laveProche;
        if (laveProche === undefined) {
          laveProche = VOISINS6.some(function (v) { return api.getBlock(b.x + v[0], b.y + v[1], b.z + v[2]) === B.LAVA; });
        }
        nouvelEtat = puissanceThermique(laveProche, ctx.combustible || 0);
      } else if (t === 'distributeur') {
        // SPEC-MECA-001 : sur front montant, éjecte un objet — quoi et
        // comment (objet au sol ou projectile) dépend du CONTENU du
        // distributeur, que ce module ignore délibérément (pure, sans accès
        // à l'inventaire ni au monde) : `ctx.onDistribuer` est un simple
        // rappel que l'appelant (game.js hors ligne, server.js en ligne)
        // branche sur son propre stockage de conteneur.
        var sigDist = bruts.some(Boolean), precDist = !!(b.etat & 1);
        if (sigDist && !precDist && ctx.onDistribuer) ctx.onDistribuer(b.x, b.y, b.z);
        nouvelEtat = sigDist ? 1 : 0;
      } else if (t === 'commande') {
        // SPEC-MECA-007 : sur front montant, exécute la commande stockée —
        // même principe : ce module ne connaît ni le texte ni le routage
        // des actions, seulement le moment où déclencher `ctx.onCommande`.
        var sigCmd = bruts.some(Boolean), precCmd = !!(b.etat & 1);
        if (commandeDeclenche(sigCmd, precCmd) && ctx.onCommande) ctx.onCommande(b.x, b.y, b.z);
        nouvelEtat = sigCmd ? 1 : 0;
      } else if (t === 'batterie') {
        var apport = Math.max.apply(null, entrees.concat([0]));
        var res = tickBatterie(b.etat, 15, apport, ctx.demandeBatterie || 0, d.circuit.taux || 4);
        nouvelEtat = res.niveau;
      } else if (['presence', 'lumiere', 'journuit', 'meteo', 'horloge', 'eau'].indexOf(t) >= 0) {
        var nom = t === 'meteo' ? 'pluie-vent' : t;
        nouvelEtat = detecteur(nom, ctx.detecteurs && ctx.detecteurs[b.x + ',' + b.y + ',' + b.z]) ? 1 : 0;
      } else if (t === 'piston') {
        var orient = b.etat & 7, etendu = !!((b.etat >> 3) & 1);
        var dir = DIRS_PISTON[orient] || DIRS_PISTON[0];
        // le signal qui compte est celui qui NE vient PAS de la tête elle-même
        var signalPiston = false;
        VOISINS6.forEach(function (v, i) {
          if (v[0] === dir.x && v[1] === dir.y && v[2] === dir.z) return;
          if (entrees[i] > 0) signalPiston = true;
        });
        if (signalPiston && !etendu) {
          var pous = poussee(api.getBlock, b.x, b.y, b.z, dir, !!d.circuit.collant);
          if (pous.ok) {
            pous.positions.forEach(function (pos) {
              ecrits.push({ x: pos[0] + dir.x, y: pos[1] + dir.y, z: pos[2] + dir.z, setBlock: pos[3] });
            });
            ecrits.push({ x: b.x + dir.x, y: b.y + dir.y, z: b.z + dir.z, setBlock: B.TETE_PISTON });
            nouvelEtat = orient | (1 << 3);
          }
        } else if (!signalPiston && etendu) {
          var hx = b.x + dir.x, hy = b.y + dir.y, hz = b.z + dir.z;
          ecrits.push({ x: hx, y: hy, z: hz, setBlock: 0 });
          if (d.circuit.collant) {
            var tir = traction(api.getBlock, hx + dir.x, hy + dir.y, hz + dir.z, dir);
            if (tir) ecrits.push({ x: tir.vers[0], y: tir.vers[1], z: tir.vers[2], setBlock: tir.id });
            if (tir) ecrits.push({ x: tir.depuis[0], y: tir.depuis[1], z: tir.depuis[2], setBlock: 0 });
          }
          nouvelEtat = orient;
        }
      }
      if (allume !== null) {
        var cible = allume ? B.LAMPE_ALLUMEE : B.LAMPE_ETEINTE;
        if (cible !== b.id) ecrits.push({ x: b.x, y: b.y, z: b.z, setBlock: cible });
      }
      if (nouvelEtat !== b.etat) ecrits.push({ x: b.x, y: b.y, z: b.z, setEtat: nouvelEtat });
    });
    ecrits.forEach(function (e) {
      if (e.setBlock !== undefined) api.setBlock(e.x, e.y, e.z, e.setBlock);
      if (e.setEtat !== undefined) api.setEtat(e.x, e.y, e.z, e.setEtat);
    });
    return ecrits;
  }

  MC.Circuits = {
    porte: porte,
    pasRepeteur: pasRepeteur, pasBascule: pasBascule, pasCompteur: pasCompteur, pasComparateur: pasComparateur,
    creerReseau: creerReseau, fixerEntree: fixerEntree, tickReseau: tickReseau, validerReseau: validerReseau,
    puissanceEolienne: puissanceEolienne, puissanceHydraulique: puissanceHydraulique, puissanceThermique: puissanceThermique,
    transporterEnergie: transporterEnergie, tickBatterie: tickBatterie,
    detecteur: detecteur, appareil: appareil,
    distributeurChoix: distributeurChoix, poussee: poussee, traction: traction,
    commandeAutorisee: commandeAutorisee, commandeDeclenche: commandeDeclenche,
    estCircuit: estCircuit, forceDe: forceDe, forceEnergieDe: forceEnergieDe, tick: tick,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
