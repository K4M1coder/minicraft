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
      /* SPEC-ARCHI-045 : voler est permis par les RÈGLES, pas par l'entrée : hors
         créatif `v` est ignoré (le serveur ne vole pas ; le client non plus, sa
         bascule passe par basculerVol et la réconciliation reprend le vol du
         serveur). À la bascule, la vitesse verticale repart de zéro, ici, donc
         des DEUX côtés — le client le faisait seul : le serveur gardait l'élan
         du saut ou de la chute, et l'ETAT suivant recalait le joueur. */
      if (e.v !== undefined && peutVoler(st) && st.flying !== !!e.v) { st.flying = !!e.v; st.vel.y = 0; }
      joueur.updateMovement(e.dt, decoderTouches(e.k));
    }
    return entrees.length;
  }

  function peutVoler(st) { return !!(st && st.regles && st.regles.vole); }
  /* Double appui sur Espace, bouton de vol de la manette : bascule le vol si
     les règles le permettent (créatif), sinon ne fait rien. Renvoie l'état. */
  function basculerVol(st) {
    if (!peutVoler(st)) { st.flying = false; return false; }
    st.flying = !st.flying;
    st.vel.y = 0;
    return st.flying;
  }

  /* ─── côté client : l'heure du monde (SPEC-ARCHI-046) ──────────────────────
     Le serveur fait foi sur l'heure (SPEC-NET-017) mais ne l'envoie qu'à chaque
     ETAT ; entre deux relevés le client l'avance lui-même. L'écraser à chaque
     relevé la faisait reculer sans cesse (relevé arrondi, déjà vieux de
     quelques millisecondes, tic serveur trop long plafonné à 0,25 s). Ici :
     un seul écrivain, qui avance avec l'image et rattrape l'écart en douceur —
     jamais en reculant —, sauf un vrai saut (sommeil, /jour, /nuit, reprise),
     adopté d'un coup. */
  var SAUT_HEURE = 2, RAPPEL_HEURE = 2;    // s ; fraction de l'écart rattrapée par seconde
  function fini(v) { return typeof v === 'number' && isFinite(v); }
  function creerHorloge() {
    /* `serveur` : le dernier relevé fini reçu — l'heure de repli si `t` cessait
       d'être un nombre fini (une heure NaN adoptée bloquerait l'horloge à jamais :
       NaN n'est égal à rien, aucun écart ne se mesure plus). */
    var t = null, ecart = 0, serveur = null;
    function sain() { if (t !== null && !fini(t)) { t = serveur !== null ? serveur : 0; ecart = 0; } }
    return {
      fixer: function (h) { t = fini(+h) ? +h : 0; ecart = 0; return t; },
      // un relevé du serveur : rend l'heure à afficher maintenant
      recevoir: function (h) {
        if (!fini(h)) { sain(); return t; }
        serveur = h;
        sain();
        if (t === null || Math.abs(h - t) > SAUT_HEURE) { t = h; ecart = 0; }
        else ecart = h - t;
        return t;
      },
      /* une image de `dt` secondes ; `actuel` : la valeur que le jeu affiche — si
         quelqu'un l'a écrite à la main (outil de débogage, test), on la reprend,
         jusqu'au prochain relevé : à plus de SAUT_HEURE de l'heure du serveur, il
         la remplace d'un coup (SPEC-ARCHI-046). Une valeur non finie est ignorée. */
      avancer: function (dt, actuel) {
        if (fini(actuel) && actuel !== t) { t = actuel; ecart = 0; }
        sain();
        if (t === null) t = 0;
        if (!(dt > 0) || !fini(dt)) return t;
        var corr = Math.max(-dt, ecart * Math.min(1, dt * RAPPEL_HEURE));
        ecart -= corr;
        t += dt + corr;
        return t;
      },
      get valeur() { return t; },
    };
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
    var voulu = st.flying;                  // le vol que veut le client, peut-être pas encore envoyé
    ajusterMonture(joueur, serveur, trouver);
    st.pos.x = serveur.x; st.pos.y = serveur.y; st.pos.z = serveur.z;
    st.vel.x = serveur.vx || 0; st.vel.y = serveur.vy || 0; st.vel.z = serveur.vz || 0;
    st.onGround = !!serveur.sol;
    /* SPEC-ARCHI-045 : l'état de vol du serveur au point acquitté — sans lui, le
       rejeu partirait du vol ACTUEL du client et verrait une « bascule » (vitesse
       verticale remise à zéro) là où le serveur n'en a vu aucune. */
    if (serveur.vol !== undefined) st.flying = !!serveur.vol && peutVoler(st);
    if (typeof serveur.chute === 'number') st.fallFrom = serveur.chute;
    else st.fallFrom = null;
    /* À bord côté serveur mais réplique pas encore reçue : rejouer les entrées
       comme une marche à pied ferait dériver le joueur hors de son siège. */
    if (serveur.veh && !st.monture) { prediction.confirmer(serveur.s); return Math.hypot(st.pos.x - avant.x, st.pos.y - avant.y, st.pos.z - avant.z); }
    /* SPEC-JOUABLE-004 : le REGARD est celui du joueur, maintenant. Le rejeu
       oriente chaque entrée comme elle a été jouée (la marche suit le regard
       de l'époque), puis on rend le regard courant : sans cela, un coup de
       souris donné depuis la dernière entrée était effacé par un ETAT arrivé
       avant l'image suivante — la caméra sautait en arrière, et un clic visait
       un autre bloc que celui sous le viseur (constaté sous charge). */
    var yaw = st.yaw, pitch = st.pitch;
    rejouer(joueur, prediction.confirmer(serveur.s));
    st.yaw = yaw; st.pitch = pitch;
    /* Une bascule faite depuis la dernière entrée (double appui entre deux images)
       n'est dans aucune entrée : on la réapplique, comme basculerVol — la
       prochaine entrée la porte, et le serveur fera la même chose au même point. */
    if (st.flying !== voulu && peutVoler(st)) { st.flying = voulu; st.vel.y = 0; }
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
      /* `attente` (facultatif) : la durée des entrées qui attendent déjà dans la
         file. Le plafond (RESERVE × 2) empêche d'économiser du temps PENDANT
         qu'on n'envoie rien ; il ne doit jamais retirer le temps d'entrées déjà
         arrivées : après un tic serveur long, sinon, ce temps était perdu pour
         toujours, et un client honnête — qui envoie exactement le temps réel —
         gardait ce retard sans jamais le rattraper (SPEC-SYNC-004). */
      crediter: function (dtReel, attente) {
        var plafond = Math.max(RESERVE * 2, attente > 0 ? attente : 0);
        credit = Math.min(plafond, credit + (dtReel > 0 ? dtReel : 0));
        return credit;
      },
      consommer: function (dt) {
        if (!(dt > 0) || dt > DT_MAX || dt > credit) return false;
        credit -= dt;
        return true;
      },
      /* Après chaque tic : ce qui n'a pas été consommé retombe sous la réserve.
         Le plafond « attente » de crediter ne vaut que pour des entrées rejouées
         DANS CE tic ; sans cette borne, un joueur qui ne peut pas consommer (mort,
         file gardée pleine…) accumulait jusqu'à la durée de sa file entière, puis
         la dépensait d'un coup : téléportation (revue adversariale). */
      borner: function () { if (credit > RESERVE * 2) credit = RESERVE * 2; return credit; },
      get credit() { return credit; },
    };
  }

  /* File d'entrées d'un joueur côté serveur. Bornée à MAX_EN_ATTENTE, comme
     celle du client : au-delà, le client lui-même les a oubliées. (Avant :
     240 — quatre secondes à 60 images/s ; un retard plus long faisait jeter
     les plus anciennes, dont le déplacement, prédit par le client, n'avait
     jamais lieu côté serveur : l'ETAT suivant ramenait le joueur en arrière.) */
  function empilerEntree(file, e) {
    file.push(e);
    if (file.length > MAX_EN_ATTENTE) file.splice(0, file.length - MAX_EN_ATTENTE);
    return file.length;
  }
  function dureeValide(dt) { return dt > 0 && dt <= DT_MAX; }
  /* Un tic serveur pour un joueur : crédite le temps RÉEL écoulé (pas le dt
     plafonné de la simulation du monde), rejoue les entrées que ce crédit
     couvre, écarte celles qui ne passeront jamais (durée nulle, négative ou
     trop longue : en tête de file, elles la bloquaient). Rend
     { dernier, avance } : la dernière entrée traitée et le temps simulé. */
  /* Borne du rattrapage : au plus MAX_REJEUX_PAR_TIC rejeux par joueur et par
     tic (la file entière ; mesuré ≈ 5,5 ms pour 600 entrées à pied). */
  var MAX_REJEUX_PAR_TIC = MAX_EN_ATTENTE;
  function avancerEntrees(joueur, file, budget, dtReel, dernier) {
    var st = joueur.state, avance = 0, n = 0;
    /* Un joueur qui ne peut rien rejouer (mort) : ses entrées sont jetées et son
       crédit ne dépasse pas la réserve — rien ne s'accumule pour plus tard. */
    if (st.dead) {
      file.length = 0;
      budget.crediter(dtReel, 0);
      budget.borner();
      return { dernier: dernier, avance: 0 };
    }
    var attente = 0;
    for (var i = 0; i < file.length; i++) if (dureeValide(file[i].dt)) attente += file[i].dt;
    budget.crediter(dtReel, attente);
    for (;;) {
      if (n >= MAX_REJEUX_PAR_TIC) break;
      n++;
      while (file.length && !dureeValide(file[0].dt)) file.shift();
      if (!file.length || st.dead || !budget.consommer(file[0].dt)) break;
      var e = file.shift();
      rejouer(joueur, [e]);
      dernier = e.s;
      avance += e.dt;
    }
    budget.borner();
    return { dernier: dernier, avance: avance };
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
      sol: st.onGround ? 1 : 0, vol: st.flying ? 1 : 0, chute: st.fallFrom === null ? null : st.fallFrom,
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

  /* SPEC-SYNC-020 : un point de réapparition reçu ou relu (fichier de monde,
     BIENVENUE) n'est accepté que fini et dans les bornes du monde — sinon
     null (le point d'apparition du monde s'applique). */
  function spawnValide(sp) {
    if (!sp || typeof sp !== 'object') return null;
    var fini = function (v) { return typeof v === 'number' && isFinite(v); };
    if (!fini(sp.x) || !fini(sp.y) || !fini(sp.z)) return null;
    if (Math.abs(sp.x) >= 1e7 || Math.abs(sp.z) >= 1e7 || sp.y <= -64 || sp.y >= 400) return null;
    return { x: sp.x, y: sp.y, z: sp.z };
  }
  /* À la connexion, le client reprend le regard laissé par le joueur local
     (BIENVENUE.toi[i]) ; rend le point de réapparition validé, ou null. */
  function reprendreRetour(st, t) {
    if (!st || !t) return null;
    if (typeof t.yaw === 'number' && isFinite(t.yaw)) st.yaw = t.yaw;
    if (typeof t.pitch === 'number' && isFinite(t.pitch)) st.pitch = Math.max(-1.6, Math.min(1.6, t.pitch));
    return spawnValide(t.spawn);
  }

  /* SPEC-SAVE-024 : applique au monde du client un bloc qui fait foi, reçu du
     serveur — BLOC `{ x, y, z, id, etat }` ou override `[x, y, z, id, etat]`
     (BIENVENUE, OVERRIDES). Le chunk absent est généré pour le recevoir (sans
     quoi la modification serait perdue : blocs fantômes). L'état reçu
     s'applique TOUJOURS, 0 compris : les circuits diffusent un changement
     d'état à id constant (batterie vidée, répéteur éteint, piston rentré…) ;
     seul un état absent (rappel d'un refus, sans état) laisse l'état en place
     — setBlock l'efface déjà si le bloc change. */
  function appliquerBloc(world, b) {
    var x, y, z, id, etat;
    if (Array.isArray(b)) { x = b[0]; y = b[1]; z = b[2]; id = b[3]; etat = b[4]; }
    else { x = b.x; y = b.y; z = b.z; id = b.id; etat = b.etat; }
    world.getChunk(Math.floor(x / 16), Math.floor(z / 16), true);
    world.setBlock(x, y, z, id);
    if (etat === undefined || etat === null) return;
    // un 0 sur une case déjà à 0 n'écrit rien (ni tampon alloué, ni chunk à remailler)
    if (!etat && !world.getEtat(x, y, z)) return;
    world.setEtat(x, y, z, etat);
  }

  MC.Synchro = { appliquerBloc: appliquerBloc, spawnValide: spawnValide, reprendreRetour: reprendreRetour, TOUCHES: TOUCHES, encoderTouches: encoderTouches, decoderTouches: decoderTouches,
                 creerPrediction: creerPrediction, rejouer: rejouer, reconcilier: reconcilier,
                 peutVoler: peutVoler, basculerVol: basculerVol, creerHorloge: creerHorloge, SAUT_HEURE: SAUT_HEURE,
                 creerBudget: creerBudget, empilerEntree: empilerEntree, avancerEntrees: avancerEntrees, MAX_EN_ATTENTE: MAX_EN_ATTENTE, MAX_REJEUX_PAR_TIC: MAX_REJEUX_PAR_TIC, etatJoueur: etatJoueur, ajusterMonture: ajusterMonture, appliquerStats: appliquerStats,
                 DT_MAX: DT_MAX, RESERVE: RESERVE, arrondi: arrondi };
})(typeof globalThis !== 'undefined' ? globalThis : this);
