/* vehicules.js — bateau, moto, voiture, camion, avion, sous-marin.
   Logique pure. Un véhicule est une entité du monde (type 'v_<nom>'), ce qui
   lui donne gratuitement collisions, rendu, gel hors des chunks chargés et
   sauvegarde. Ce module ne règle que sa conduite.

   Conventions : l'avant d'un véhicule tourné de `yaw` vaut (-sin, 0, -cos),
   comme pour la caméra et les créatures. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core, P = MC.Physics;
  var I = C.I, SEA = C.SEA_LEVEL;

  /* Caractéristiques. vmax en m/s, accel en m/s², virage en rad/s.
     `milieu` : où l'engin avance à pleine vitesse ; ailleurs il se traîne.
     `siege` : hauteur de l'assise au-dessus du bas de la caisse. */
  /* `carburant` : autonomie de plein en distance parcourue (mètres
     équivalents, `|vitesse| * dt` cumulés — SPEC-TRANSPORT-001). À sec, le
     moteur n'obéit plus aux commandes : le véhicule freine et retombe
     exactement comme un véhicule abandonné (VEHIC-009). */
  var DEFS = {
    // le bateau embarque lui aussi une petite soute (SPEC-TRANSPORT-004)
    bateau:     { nom: 'Bateau', objet: I.BATEAU, w: 1.4, h: 0.7, vmax: 7, accel: 5, virage: 1.9,
                  milieu: 'eau', siege: 0.25, flotte: true, pv: 4, carburant: 30, soute: 9 },
    moto:       { nom: 'Moto', objet: I.MOTO, w: 0.9, h: 1.0, vmax: 16, accel: 10, virage: 2.6,
                  milieu: 'sol', siege: 0.45, marche: true, pv: 6, carburant: 60 },
    voiture:    { nom: 'Voiture', objet: I.VOITURE, w: 1.8, h: 1.3, vmax: 14, accel: 7, virage: 1.8,
                  milieu: 'sol', siege: 0.35, marche: true, pv: 10, carburant: 55 },
    // le camion embarque un coffre de 27 cases
    camion:     { nom: 'Camion', objet: I.CAMION, w: 2.4, h: 2.2, vmax: 10, accel: 4, virage: 1.2,
                  milieu: 'sol', siege: 0.9, marche: true, pv: 14, soute: 27, carburant: 45 },
    // l'avion ne quitte le sol qu'au-delà de sa vitesse de décollage
    avion:      { nom: 'Avion', objet: I.AVION, w: 2.6, h: 1.4, vmax: 26, accel: 6, virage: 1.4,
                  milieu: 'air', siege: 0.4, decollage: 12, marche: true, pv: 10, carburant: 100 },
    // on respire dans le sous-marin : ni noyade, ni remontée forcée
    sous_marin: { nom: 'Sous-marin', objet: I.SOUS_MARIN, w: 1.8, h: 1.6, vmax: 8, accel: 4, virage: 1.5,
                  milieu: 'eau', siege: 0.3, plonge: true, respire: true, pv: 12, carburant: 35 },
    // le wagonnet suit les rails : il tourne tout seul dans les virages
    wagonnet:   { nom: 'Wagonnet', objet: I.WAGONNET, w: 0.9, h: 0.8, vmax: 9, accel: 5, virage: 0,
                  milieu: 'rail', siege: 0.3, rails: true, pv: 4, carburant: 40 },
  };
  var TYPES = Object.keys(DEFS);

  function typeEntite(nom) { return 'v_' + nom; }
  function defDe(e) { return e && e.vehicule ? DEFS[e.vehicule] : null; }

  /* Gabarits d'entités, pour que entities.js les connaisse. Pas d'IA :
     `vehicule` suffit à les tenir à l'écart de la boucle des créatures. */
  function gabarits() {
    var g = {};
    TYPES.forEach(function (t) {
      var d = DEFS[t];
      g[typeEntite(t)] = { w: d.w, h: d.h, hp: d.pv, speed: 0, damage: 0, vehicule: t,
                           drops: [{ id: d.objet, n: 1 }] };
    });
    return g;
  }

  /* Fait apparaître un véhicule, tourné comme `yaw`. */
  function poser(entities, nom, x, y, z, yaw) {
    var d = DEFS[nom];
    if (!d) return null;
    var e = entities.spawn(typeEntite(nom), x, y, z, { vehicule: nom, yaw: yaw || 0, vitesse: 0,
                                                       conducteur: null, carburant: d.carburant });
    if (d.soute && MC.Inventory) e.soute = MC.Inventory.create(d.soute);
    return e;
  }

  /* SPEC-TRANSPORT-001 : consomme le carburant proportionnellement à la
     distance parcourue ce pas ; ne descend jamais sous zéro. */
  function consommer(e, d, dt) {
    if (e.carburant == null || e.carburant <= 0) { e.carburant = 0; return; }
    e.carburant -= Math.abs(e.vitesse) * dt;
    if (e.carburant < 0) e.carburant = 0;
  }

  /* SPEC-TRANSPORT-002 : une collision franche avarie le véhicule — sa vitesse
     maximale (vmaxDans) chute de 30 % tant qu'il n'est pas réparé au forgeron.
     La gravité de l'avarie (1..3) dépend de la vitesse d'impact et fixe le
     coût de la réparation ; un choc trop léger (en-deçà de SEUIL_COLLISION,
     un simple frottement contre un coin) ne laisse aucune trace. */
  var SEUIL_COLLISION = 4;                        // m/s, en-deçà : pas d'avarie
  var PENALITE_AVARIE = 0.7;                       // 30 % de vitesse en moins, avarié
  var COUT_REPARATION = { 1: 5, 2: 10, 3: 20 };    // émeraudes, selon la gravité du choc
  function graviteChoc(vitesse) {
    var v = Math.abs(vitesse);
    if (v < SEUIL_COLLISION) return 0;
    if (v < 9) return 1;
    if (v < 15) return 2;
    return 3;
  }
  /* Appelée quand le déplacement du véhicule vient d'être bloqué net (un mur) :
     `vitesseAvant`, la vitesse au moment du choc, en décide la gravité. Une
     avarie déjà présente ne peut qu'empirer (jamais s'atténuer toute seule). */
  function subirCollision(e, vitesseAvant) {
    var g = graviteChoc(vitesseAvant);
    if (!g) return false;
    e.avarie = true;
    e.avarieGravite = Math.max(e.avarieGravite || 0, g);
    return true;
  }
  function coutReparation(e) {
    if (!e || !e.avarie) return 0;
    return COUT_REPARATION[e.avarieGravite] || COUT_REPARATION[1];
  }
  /* Réparation au forgeron (METIER-002) : remet le véhicule à 100 % de sa
     vitesse maximale. Renvoie le coût exact qu'elle vient d'effacer (0 si le
     véhicule n'était pas avarié — rien à payer, rien à faire). */
  function reparer(e) {
    var cout = coutReparation(e);
    if (!cout) return 0;
    e.avarie = false;
    e.avarieGravite = 0;
    return cout;
  }

  /* SPEC-TRANSPORT-004 : une caravane (ou un joueur) qui subit une attaque
     (SPEC-TRANSPORT-003) en chemin voit la cargaison de la soute du véhicule
     rognée d'autant — la MÊME fraction que pour la cargaison abstraite d'une
     caravane marchande (MC.Caravanes.PERTE_ATTAQUE), appliquée cette fois à
     un inventaire réel. Retire `fraction` de chaque pile, jamais plus que ce
     qu'elle contient ; renvoie le nombre total d'objets perdus. */
  function pillerSoute(e, fraction) {
    if (!e || !e.soute || !(fraction > 0)) return 0;
    var perdu = 0;
    e.soute.slots.forEach(function (s, i) {
      if (!s || !s.n) return;
      var n = Math.min(s.n, Math.round(s.n * fraction));
      if (n <= 0) return;
      s.n -= n;
      perdu += n;
      if (s.n <= 0) e.soute.slots[i] = null;
    });
    return perdu;
  }

  // où l'engin se trouve : eau, sol, ou dans les airs
  function milieuDe(world, e, d) {
    if (P.inWater(world, e.pos, d.h)) return 'eau';
    var sous = world.getBlock(Math.floor(e.pos.x), Math.floor(e.pos.y - 0.1), Math.floor(e.pos.z));
    if (C.isWater(sous)) return 'eau';
    return e.onGround ? 'sol' : 'air';
  }

  /* Vitesse maximale selon le milieu : un bateau échoué ou une voiture dans
     un lac se traînent. L'avion roule au sol pour décoller. `e` (facultatif,
     SPEC-TRANSPORT-002) : le véhicule concret — avarié, sa vitesse plafonne
     30 % plus bas, jusqu'à sa réparation au forgeron. */
  function vmaxDans(d, milieu, e) {
    var vm;
    if (d.milieu === 'air') vm = d.vmax;
    else if (d.milieu === milieu) vm = d.vmax;
    else if (d.milieu === 'sol' && milieu === 'air') vm = d.vmax;     // en plein saut
    else vm = d.vmax * 0.12;
    if (e && e.avarie) vm *= PENALITE_AVARIE;
    return vm;
  }

  /* Un pas de conduite. `cmd` : { avant, arriere, gauche, droite, monter,
     descendre } ou null (véhicule abandonné : il ralentit et subit la
     pesanteur). Renvoie le milieu courant. */
  function conduire(e, dt, world, cmd) {
    var d = defDe(e);
    if (!d) return null;
    if (d.rails) return rouler(e, dt, world, cmd || {}, d);
    var c = (e.carburant === 0) ? {} : (cmd || {});
    var milieu = milieuDe(world, e, d);
    var vm = vmaxDans(d, milieu, e);

    // ── accélérateur et frein ──
    var cible = c.avant ? vm : (c.arriere ? -vm * 0.4 : 0);
    var taux = (c.avant || c.arriere) ? d.accel : d.accel * 0.8;
    if (Math.abs(cible - e.vitesse) <= taux * dt) e.vitesse = cible;
    else e.vitesse += Math.sign(cible - e.vitesse) * taux * dt;
    if (Math.abs(e.vitesse) > vm) e.vitesse = Math.sign(e.vitesse) * vm;
    consommer(e, d, dt);

    // ── direction : on ne braque qu'en roulant (sauf l'avion en vol) ──
    var volant = (c.gauche ? 1 : 0) - (c.droite ? 1 : 0);
    var enVol = d.milieu === 'air' && milieu === 'air';
    var adherence = enVol ? 1 : Math.min(1, Math.abs(e.vitesse) / 3);
    var sens = e.vitesse < 0 ? -1 : 1;
    e.yaw += volant * d.virage * adherence * sens * dt;

    var fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
    e.vel.x = fx * e.vitesse;
    e.vel.z = fz * e.vitesse;

    // ── verticale : chaque engin a sa façon de tenir en l'air ou dans l'eau ──
    var haut = (c.monter ? 1 : 0) - (c.descendre ? 1 : 0);
    if (d.flotte && milieu === 'eau') {
      // bateau : la ligne de flottaison vise la surface
      var surface = surfaceEau(world, e);
      e.vel.y = P.approach(e.vel.y, (surface - 0.3 - e.pos.y) * 4, 6, dt);
    } else if (d.plonge && milieu === 'eau') {
      // sous-marin : on monte et on descend à volonté, sans jamais crever la surface
      e.vel.y = P.approach(e.vel.y, haut * 4, 4, dt);
      if (e.vel.y > 0 && !P.inWater(world, { x: e.pos.x, y: e.pos.y + 0.6, z: e.pos.z }, d.h)) e.vel.y = 0;
    } else if (d.decollage) {
      // avion : la portance croît avec la vitesse ; sous le seuil, il retombe
      var portance = Math.max(0, Math.min(1, (Math.abs(e.vitesse) - d.decollage) / 6));
      var chute = -9 * (1 - portance);
      e.vel.y = P.approach(e.vel.y, haut * 7 * portance + chute, 3, dt);
      if (e.onGround && portance === 0 && e.vel.y < 0) e.vel.y = Math.max(e.vel.y, -1);
    } else {
      e.vel.y -= 30 * dt;
      if (milieu === 'eau') { e.vel.y = Math.max(e.vel.y, -2); }
      if (e.vel.y < -40) e.vel.y = -40;
    }

    // ── déplacement, avec franchissement des marches pour les engins à roues ──
    var etaitAuSol = e.onGround;
    var hit = P.move(world, e, dt, d.w, d.h);
    var bloque = hit.x || hit.z;
    if (bloque && d.marche && etaitAuSol && Math.abs(e.vitesse) > 0.5) {
      /* Marche d'un bloc : on retente le même pas horizontal un bloc plus
         haut. La pesanteur reposera ensuite l'engin sur la marche. */
      var p0 = { x: e.pos.x, y: e.pos.y, z: e.pos.z };
      var px = fx * e.vitesse * dt, pz = fz * e.vitesse * dt;
      if (!P.collides(world, p0.x, p0.y + 1.05, p0.z, d.w, d.h) &&
          !P.collides(world, p0.x + px, p0.y + 1.05, p0.z + pz, d.w, d.h)) {
        e.pos.x = p0.x + px; e.pos.y = p0.y + 1.05; e.pos.z = p0.z + pz;
        e.vel.y = 0;
        bloque = false;
      }
    }
    // un mur arrête net : la vitesse ne reste pas « en mémoire » contre lui,
    // et un choc franc laisse une avarie (SPEC-TRANSPORT-002)
    if (bloque) { subirCollision(e, e.vitesse); e.vitesse *= 0.3; }
    e.onGround = !!hit.landed || (e.onGround && !hit.y && Math.abs(e.vel.y) < 1e-3);
    if (hit.landed) e.onGround = true;
    return milieu;
  }

  /* ── Wagonnet ───────────────────────────────────────────────────────────
     Sur un rail, il file dans l'axe (cap arrondi au quart de tour), centré
     sur la voie. Au bout d'une ligne droite, il prend le rail qui part à
     gauche ou à droite ; sans issue, il s'arrête. Hors des rails, il se
     traîne. */
  var B_RAIL = C.B.RAIL;
  function railEn(world, x, y, z) {
    return world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) === B_RAIL;
  }
  function rouler(e, dt, world, c, d) {
    if (e.carburant === 0) c = {};
    var surRail = railEn(world, e.pos.x, e.pos.y + 0.1, e.pos.z);
    var vm = surRail ? d.vmax : d.vmax * 0.12;
    var cible = c.avant ? vm : (c.arriere ? -vm : 0);
    var taux = d.accel;
    if (Math.abs(cible - e.vitesse) <= taux * dt) e.vitesse = cible;
    else e.vitesse += Math.sign(cible - e.vitesse) * taux * dt;
    consommer(e, d, dt);
    if (surRail) {
      var quart = Math.round(e.yaw / (Math.PI / 2));
      e.yaw = quart * (Math.PI / 2);
      var fx = Math.round(-Math.sin(e.yaw)), fz = Math.round(-Math.cos(e.yaw));
      var sens = e.vitesse < 0 ? -1 : 1;
      var bx = Math.floor(e.pos.x), by = Math.floor(e.pos.y + 0.1), bz = Math.floor(e.pos.z);
      // centré sur la voie, dans l'axe perpendiculaire au mouvement
      if (fx === 0) e.pos.x = bx + 0.5; else e.pos.z = bz + 0.5;
      // au centre du bloc, on regarde la suite de la voie
      var avance = fx ? (e.pos.x - bx - 0.5) * fx * sens : (e.pos.z - bz - 0.5) * fz * sens;
      if (avance >= 0 && !railEn(world, bx + fx * sens + 0.5, by, bz + fz * sens + 0.5) &&
          !railEn(world, bx + fx * sens + 0.5, by + 1, bz + fz * sens + 0.5) &&
          !railEn(world, bx + fx * sens + 0.5, by - 1, bz + fz * sens + 0.5)) {
        /* Droite et gauche du SENS DE MARCHE (l'avant vaut (-sin, -cos), la
           droite (cos, -sin)). Tourner à droite fait décroître le cap, en
           marche avant comme en marche arrière. */
        var mfx = fx * sens, mfz = fz * sens;
        var dr = [-mfz, mfx], ga = [mfz, -mfx];
        if (railEn(world, bx + dr[0] + 0.5, by, bz + dr[1] + 0.5)) {
          e.yaw -= Math.PI / 2; e.pos.x = bx + 0.5; e.pos.z = bz + 0.5;
        } else if (railEn(world, bx + ga[0] + 0.5, by, bz + ga[1] + 0.5)) {
          e.yaw += Math.PI / 2; e.pos.x = bx + 0.5; e.pos.z = bz + 0.5;
        } else {
          e.vitesse = 0;                                  // bout de la voie
          if (fx === 0) e.pos.z = bz + 0.5; else e.pos.x = bx + 0.5;
        }
      }
    }
    var ffx = -Math.sin(e.yaw), ffz = -Math.cos(e.yaw);
    e.vel.x = ffx * e.vitesse;
    e.vel.z = ffz * e.vitesse;
    e.vel.y -= 30 * dt;
    if (e.vel.y < -40) e.vel.y = -40;
    var etaitAuSol = e.onGround;
    var hit = P.move(world, e, dt, d.w, d.h);
    // une pente de rails : on monte d'un bloc comme une voiture
    if ((hit.x || hit.z) && etaitAuSol && Math.abs(e.vitesse) > 0.3) {
      var px = ffx * e.vitesse * dt, pz = ffz * e.vitesse * dt;
      if (!P.collides(world, e.pos.x + px, e.pos.y + 1.05, e.pos.z + pz, d.w, d.h)) {
        e.pos.x += px; e.pos.y += 1.05; e.pos.z += pz; e.vel.y = 0;
      } else e.vitesse = 0;
    }
    e.onGround = !!hit.landed || (e.onGround && !hit.y && Math.abs(e.vel.y) < 1e-3);
    if (hit.landed) e.onGround = true;
    return surRail ? 'rail' : 'sol';
  }

  function surfaceEau(world, e) {
    var x = Math.floor(e.pos.x), z = Math.floor(e.pos.z);
    var y = Math.floor(e.pos.y);
    while (y < C.WORLD_H - 1 && C.isWater(world.getBlock(x, y + 1, z))) y++;
    while (y > 0 && !C.isWater(world.getBlock(x, y, z))) y--;
    return y + 1;
  }

  // ─── à bord ─────────────────────────────────────────────────────────────────
  function siege(e) {
    var d = defDe(e);
    return { x: e.pos.x, y: e.pos.y + (d ? d.siege : 0), z: e.pos.z };
  }

  /* Monter : le véhicule doit être libre. Le joueur se cale sur le siège. */
  function monter(joueur, e) {
    if (!joueur || !defDe(e) || e.conducteur || joueur.monture) return false;
    e.conducteur = joueur;
    joueur.monture = e;
    var s = siege(e);
    joueur.pos.x = s.x; joueur.pos.y = s.y; joueur.pos.z = s.z;
    joueur.vel.x = joueur.vel.y = joueur.vel.z = 0;
    joueur.fallFrom = null;
    return true;
  }

  /* Descendre : on cherche une place libre autour de l'engin, côté gauche
     d'abord, puis tout autour ; faute de mieux, sur le toit. */
  function descendre(joueur, world, largeurJ, hauteurJ) {
    var e = joueur && joueur.monture;
    if (!e) return false;
    var d = defDe(e);
    e.conducteur = null;
    joueur.monture = null;
    var r = (d ? d.w : 1) / 2 + 0.6;
    for (var k = 0; k < 8; k++) {
      var a = e.yaw + Math.PI / 2 + k * Math.PI / 4;
      var x = e.pos.x + Math.cos(a) * r, z = e.pos.z - Math.sin(a) * r;
      for (var dy = 0; dy <= 1; dy++) {
        if (!P.collides(world, x, e.pos.y + dy, z, largeurJ || 0.6, hauteurJ || 1.8)) {
          joueur.pos.x = x; joueur.pos.y = e.pos.y + dy; joueur.pos.z = z;
          joueur.fallFrom = null;
          return true;
        }
      }
    }
    joueur.pos.x = e.pos.x; joueur.pos.y = e.pos.y + (d ? d.h : 1) + 0.05; joueur.pos.z = e.pos.z;
    joueur.fallFrom = null;
    return true;
  }

  /* Suit le véhicule : le conducteur reste sur son siège. */
  function caler(joueur) {
    var e = joueur && joueur.monture;
    if (!e) return false;
    if (e.dead) { joueur.monture = null; return false; }
    var s = siege(e);
    joueur.pos.x = s.x; joueur.pos.y = s.y; joueur.pos.z = s.z;
    joueur.vel.x = joueur.vel.y = joueur.vel.z = 0;
    joueur.onGround = true;
    joueur.fallFrom = null;
    return true;
  }

  function vitesseKmh(e) { return Math.round(Math.hypot(e.vel.x, e.vel.y, e.vel.z) * 3.6); }

  // ─── sauvegarde ─────────────────────────────────────────────────────────────
  function serialiser(entities) {
    var out = [];
    entities.list.forEach(function (e) {
      if (!e.vehicule || e.dead) return;
      out.push([e.vehicule, +e.pos.x.toFixed(2), +e.pos.y.toFixed(2), +e.pos.z.toFixed(2),
                +e.yaw.toFixed(3), e.soute ? e.soute.serialize() : 0,
                e.carburant != null ? +e.carburant.toFixed(2) : undefined,
                e.avarie ? e.avarieGravite : 0]);
    });
    return out;
  }
  function restaurer(entities, data) {
    var n = 0;
    (data || []).forEach(function (v) {
      var e = poser(entities, v[0], v[1], v[2], v[3], v[4]);
      if (!e) return;
      if (e.soute && v[5]) e.soute.load(v[5]);
      if (v[6] != null) e.carburant = v[6];               // sinon : plein (anciennes sauvegardes)
      if (v[7]) { e.avarie = true; e.avarieGravite = v[7]; }
      n++;
    });
    return n;
  }

  MC.Vehicules = { DEFS: DEFS, TYPES: TYPES, typeEntite: typeEntite, defDe: defDe,
                   gabarits: gabarits, poser: poser, conduire: conduire, milieuDe: milieuDe,
                   vmaxDans: vmaxDans, surfaceEau: surfaceEau, siege: siege, monter: monter,
                   descendre: descendre, caler: caler, vitesseKmh: vitesseKmh,
                   serialiser: serialiser, restaurer: restaurer, rouler: rouler, railEn: railEn,
                   // SPEC-TRANSPORT-002 : collision, avarie, réparation au forgeron
                   SEUIL_COLLISION: SEUIL_COLLISION, PENALITE_AVARIE: PENALITE_AVARIE,
                   COUT_REPARATION: COUT_REPARATION, graviteChoc: graviteChoc,
                   subirCollision: subirCollision, coutReparation: coutReparation, reparer: reparer,
                   // SPEC-TRANSPORT-004 : pertes d'une attaque (SPEC-TRANSPORT-003) sur la soute
                   pillerSoute: pillerSoute };
})(typeof globalThis !== 'undefined' ? globalThis : this);
