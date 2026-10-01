/* entities.js — objets au sol, mobs hostiles, animaux et PNJ.
   Logique pure : la couche rendu se contente de suivre `list`. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core, P = MC.Physics;
  var B = C.B, I = C.I;

  /* Gabarits : largeur, hauteur, vie, vitesse, dégâts.
     Comportements optionnels, combinables :
       hostile  poursuit et frappe le joueur       neutral  seulement une fois frappé
       brule    disparaît au lever du jour         tir      attaque à distance
       sauteur  n'avance qu'en bondissant          bond     se jette sur sa proie
       invoque  appelle des renforts               division se scinde en mourant
       boss     gardien de donjon (nom, barre de vie, recul réduit) */
  var SPECS = {
    item:     { w: 0.28, h: 0.28, hp: 1,  speed: 0,   damage: 0 },
    zombie:   { w: 0.6,  h: 1.8,  hp: 14, speed: 2.6, damage: 3, hostile: true, brule: true,
                drops: [{ id: I.ROTTEN_FLESH, n: 1 }] },
    sheep:    { w: 0.7,  h: 1.2,  hp: 8,  speed: 1.5, damage: 0,
                drops: [{ id: I.RAW_MUTTON, n: 1 }, { id: B.WOOL, n: 1 }] },
    villager: { w: 0.6,  h: 1.8,  hp: 20, speed: 1.1, damage: 0, npc: true },
    // projectile : petit, sans IA, il traverse tout jusqu'a percuter
    arrow:    { w: 0.16, h: 0.16, hp: 1,  speed: 0,   damage: 5, projectile: true },

    // ── nouvelles créatures ──
    skeleton: { w: 0.6,  h: 1.8,  hp: 12, speed: 2.2, damage: 2, hostile: true, brule: true,
                tir: { portee: 14, recul: 5, cadence: 2.2, degats: 3, n: 1 },
                drops: [{ id: I.FLECHE, n: 2 }] },
    spider:   { w: 0.95, h: 0.8,  hp: 12, speed: 3.3, damage: 2, hostile: true, brule: true,
                bond: true, drops: [{ id: I.FICELLE, n: 2 }] },
    mummy:    { w: 0.6,  h: 1.8,  hp: 18, speed: 2.2, damage: 3, hostile: true, brule: true,
                drops: [{ id: I.ROTTEN_FLESH, n: 1 }, { id: I.FICELLE, n: 1 }] },
    slime:    { w: 0.9,  h: 0.9,  hp: 10, speed: 2.6, damage: 2, hostile: true, sauteur: true },
    wolf:     { w: 0.6,  h: 0.85, hp: 12, speed: 3.4, damage: 3, neutral: true },
    pig:      { w: 0.8,  h: 0.9,  hp: 10, speed: 1.4, damage: 0,
                drops: [{ id: I.RAW_PORK, n: 2 }, { id: I.CUIR, n: 1, chance: 0.5 }] },
    chicken:  { w: 0.45, h: 0.7,  hp: 4,  speed: 1.4, damage: 0,
                drops: [{ id: I.RAW_CHICKEN, n: 1 }, { id: I.FEATHER, n: 1 }] },
    goat:     { w: 0.7,  h: 1.1,  hp: 10, speed: 2.0, damage: 3, neutral: true },
    polar_bear: { w: 1.3, h: 1.4, hp: 30, speed: 2.6, damage: 6, neutral: true,
                  drops: [{ id: I.RAW_FISH, n: 2 }] },

    // ── faune marine : `nageur` = vit dans l'eau, s'asphyxie dehors ──
    fish:     { w: 0.4,  h: 0.35, hp: 3,  speed: 2.2, damage: 0, nageur: true,
                drops: [{ id: I.RAW_FISH, n: 1 }] },
    tropical_fish: { w: 0.35, h: 0.35, hp: 3, speed: 2.4, damage: 0, nageur: true, variantes: 4,
                     drops: [{ id: I.RAW_FISH, n: 1 }] },
    squid:    { w: 0.8,  h: 0.8,  hp: 10, speed: 1.6, damage: 0, nageur: true,
                drops: [{ id: I.INK_SAC, n: 1 }] },
    dolphin:  { w: 1.0,  h: 0.7,  hp: 20, speed: 5.0, damage: 3, nageur: true, neutral: true,
                drops: [{ id: I.RAW_FISH, n: 1 }] },
    turtle:   { w: 1.0,  h: 0.5,  hp: 16, speed: 1.2, damage: 0, nageur: true },
    // le requin ne chasse que dans l'eau : sur la plage, on est à l'abri
    shark:    { w: 1.4,  h: 0.9,  hp: 26, speed: 4.2, damage: 5, nageur: true, hostile: true, vue: 18,
                drops: [{ id: I.RAW_FISH, n: 2 }] },
    // la méduse dérive et pique quiconque la touche
    jellyfish: { w: 0.7, h: 0.8,  hp: 6,  speed: 0.6, damage: 0, nageur: true, pique: 2 },
    // `lest` : ne flotte pas, marche au fond de l'eau
    crab:     { w: 0.6,  h: 0.4,  hp: 6,  speed: 1.6, damage: 0, lest: true },
    drowned:  { w: 0.6,  h: 1.8,  hp: 18, speed: 2.0, damage: 3, hostile: true, lest: true,
                drops: [{ id: I.ROTTEN_FLESH, n: 1 }] },

    // ── oiseaux : `volant` = ni gravité ni sol ; `altitude` au-dessus du relief ──
    bird:     { w: 0.35, h: 0.35, hp: 3,  speed: 3.5, damage: 0, volant: true, altitude: [4, 10],
                drops: [{ id: I.FEATHER, n: 1 }] },
    seagull:  { w: 0.5,  h: 0.4,  hp: 4,  speed: 4.0, damage: 0, volant: true, altitude: [6, 14],
                drops: [{ id: I.FEATHER, n: 1 }] },
    parrot:   { w: 0.4,  h: 0.5,  hp: 5,  speed: 3.0, damage: 0, volant: true, altitude: [6, 16],
                variantes: 3, drops: [{ id: I.FEATHER, n: 1 }] },
    eagle:    { w: 0.8,  h: 0.6,  hp: 10, speed: 5.5, damage: 0, volant: true, altitude: [12, 22],
                drops: [{ id: I.FEATHER, n: 2 }] },

    // ── humanoïdes armés : `arme` = objet tenu en main, lâché parfois ──
    pillager: { w: 0.6,  h: 1.8,  hp: 20, speed: 2.4, damage: 2, hostile: true, arme: I.ARBALETE,
                tir: { portee: 16, recul: 5, cadence: 2.6, degats: 4, n: 1 },
                drops: [{ id: I.EMERALD, n: 1, chance: 0.3 }, { id: I.FLECHE, n: 2 }] },
    vindicator: { w: 0.6, h: 1.8, hp: 24, speed: 3.0, damage: 4, hostile: true, arme: I.IRON_AXE,
                  drops: [{ id: I.EMERALD, n: 1, chance: 0.4 }] },
    // le garde défend le village : il combat morts et pillards, et le joueur s'il en est l'ennemi
    garde:    { w: 0.6,  h: 1.8,  hp: 30, speed: 2.8, damage: 4, arme: I.IRON_SWORD, vue: 20,
                drops: [{ id: I.EMERALD, n: 1, chance: 0.2 }] },

    // ── gardiens de donjon ──
    boss_zombie:    { w: 1.1, h: 2.8, hp: 90, speed: 2.3, damage: 6, hostile: true, boss: true,
                      nom: 'Gardien putride', vue: 26,
                      invoque: { type: 'zombie', n: 2, max: 4, cadence: 9 } },
    boss_araignee:  { w: 1.6, h: 1.1, hp: 70, speed: 3.6, damage: 5, hostile: true, boss: true,
                      nom: 'Reine des araignées', vue: 26, bond: true,
                      invoque: { type: 'spider', n: 2, max: 3, cadence: 11 } },
    boss_squelette: { w: 0.8, h: 2.4, hp: 70, speed: 2.0, damage: 4, hostile: true, boss: true,
                      nom: 'Roi squelette', vue: 26,
                      tir: { portee: 20, recul: 6, cadence: 1.6, degats: 4, n: 3 } },
    boss_slime:     { w: 2.0, h: 2.0, hp: 80, speed: 2.4, damage: 5, hostile: true, boss: true,
                      nom: 'Slime colossal', vue: 26, sauteur: true,
                      division: { type: 'slime', n: 4 } },
    boss_pharaon:   { w: 1.0, h: 2.6, hp: 110, speed: 2.4, damage: 7, hostile: true, boss: true,
                      nom: 'Pharaon maudit', vue: 26, bond: true, tresor: I.KHEPESH,
                      invoque: { type: 'mummy', n: 2, max: 4, cadence: 10 } },
    boss_yeti:      { w: 1.6, h: 3.0, hp: 130, speed: 2.6, damage: 8, hostile: true, boss: true,
                      nom: 'Yéti', vue: 26, tresor: I.HACHE_GIVRE,
                      tir: { portee: 18, recul: 0, cadence: 2.4, degats: 5, n: 1, genre: 'neige' } },
    boss_serpent:   { w: 1.2, h: 1.0, hp: 100, speed: 4.2, damage: 7, hostile: true, boss: true,
                      nom: 'Grand serpent', vue: 26, bond: true, tresor: I.ARC_JUNGLE },
    boss_sorciere:  { w: 0.7, h: 2.0, hp: 90, speed: 2.2, damage: 3, hostile: true, boss: true,
                      nom: 'Sorcière des marais', vue: 26, tresor: I.BATON_SORCIERE,
                      tir: { portee: 18, recul: 6, cadence: 1.4, degats: 5, n: 2, genre: 'sortilege' },
                      invoque: { type: 'slime', n: 2, max: 3, cadence: 12 } },
    boss_wyverne:   { w: 2.2, h: 1.4, hp: 140, speed: 5.0, damage: 8, hostile: true, boss: true,
                      nom: 'Wyverne des cimes', vue: 32, volant: true, altitude: [8, 14],
                      tresor: I.LANCE_CIMES,
                      tir: { portee: 24, recul: 0, cadence: 2.0, degats: 6, n: 1, genre: 'feu' } },
    boss_gardien_ancien: { w: 2.0, h: 2.0, hp: 150, speed: 3.0, damage: 7, hostile: true, boss: true,
                      nom: 'Gardien ancien', vue: 24, nageur: true, tresor: I.TRIDENT,
                      tir: { portee: 18, recul: 4, cadence: 2.2, degats: 6, n: 1, genre: 'laser' },
                      invoque: { type: 'shark', n: 1, max: 2, cadence: 14 } },
    boss_capitaine: { w: 0.8, h: 2.2, hp: 100, speed: 2.4, damage: 7, hostile: true, boss: true,
                      nom: 'Capitaine noyé', vue: 24, lest: true, arme: I.SABRE_CAPITAINE,
                      tresor: I.SABRE_CAPITAINE,
                      invoque: { type: 'drowned', n: 2, max: 3, cadence: 10 } },

    // ── créatures souterraines (SPEC-SOUTERRAIN-002) : une par biome profond ──
    chauve_souris:     { w: 0.4, h: 0.35, hp: 6,  speed: 4.2, damage: 0, volant: true, altitude: [1, 5],
                         hostile: false, drops: [{ id: I.FEATHER, n: 1, chance: 0.4 }] },
    araignee_caverne:  { w: 0.85, h: 0.7, hp: 12, speed: 3.6, damage: 3, hostile: true, bond: true,
                         drops: [{ id: I.FICELLE, n: 2 }] },
    elementaire_magma: { w: 0.8, h: 1.0, hp: 22, speed: 1.8, damage: 4, hostile: true,
                         drops: [{ id: I.SOUFRE, n: 2 }, { id: B.MAGMA, n: 1, chance: 0.5 }] },
    golem_cristal:     { w: 1.1, h: 1.9, hp: 40, speed: 1.4, damage: 5, hostile: true, neutral: true,
                         drops: [{ id: I.QUARTZ, n: 2 }, { id: B.CRISTAL_LUMINEUX, n: 1, chance: 0.4 }] },
    rodeur_abysse:     { w: 0.7, h: 1.7, hp: 20, speed: 2.8, damage: 5, hostile: true,
                         drops: [{ id: I.ROTTEN_FLESH, n: 1 }, { id: I.LAPIS, n: 1, chance: 0.3 }] },
    creature_aveugle:  { w: 0.6, h: 1.0, hp: 14, speed: 2.0, damage: 2, hostile: true, nageur: true, lest: true,
                         drops: [{ id: I.RAW_FISH, n: 1 }, { id: B.ALGUE_LUMINEUSE, n: 1, chance: 0.3 }] },

    // ── coffre surprise (SPEC-OBJET-005) : un coffre qui mordait ──
    mimic: { w: 0.9, h: 0.9, hp: 26, speed: 2.4, damage: 5, hostile: true,
             drops: [{ id: I.EMERALD, n: 2, chance: 0.6 }, { id: I.GOLD_INGOT, n: 2, chance: 0.5 },
                     { id: I.DIAMOND, n: 1, chance: 0.25 }] },
  };
  /* Butin de gardien : un trésor propre à chacun — que rien d'autre ne donne —
     et une part commune. L'épée runique reste le trésor des gardiens de crypte. */
  Object.keys(SPECS).forEach(function (k) {
    var sp = SPECS[k];
    if (!sp.boss) return;
    sp.drops = [{ id: sp.tresor || I.EPEE_RUNIQUE, n: 1 }, { id: I.EMERALD, n: 4 },
                { id: I.GOLD_INGOT, n: 3 }, { id: I.DIAMOND, n: 1, chance: 0.5 }];
    if (k === 'boss_gardien_ancien') sp.drops.push({ id: I.PRISMARINE_SHARD, n: 8 });
  });

  /* Armes tenues par certaines créatures, avec leur probabilité. Une arme
     ajoute la moitié de ses dégâts à ceux de la créature, et tombe une fois
     sur dix à sa mort. Un squelette armé d'une épée renonce à son arc. */
  var ARMES = {
    zombie:   [[I.STONE_SWORD, 0.12], [I.IRON_SWORD, 0.06], [I.IRON_AXE, 0.04]],
    skeleton: [[I.IRON_SWORD, 0.12]],
    drowned:  [[I.TRIDENT, 0.08]],
  };
  var CHANCE_ARME_LACHEE = 0.1;
  function tirerArme(type, r) {
    var sp = SPECS[type];
    if (sp && sp.arme) return sp.arme;
    var t = ARMES[type];
    if (!t) return 0;
    var x = r();
    for (var i = 0; i < t.length; i++) { if (x < t[i][1]) return t[i][0]; x -= t[i][1]; }
    return 0;
  }
  function degatsAvecArme(s, arme) {
    var d = arme && C.ITEMS[arme];
    return s.damage + (d && d.damage && !d.ranged ? Math.floor(d.damage / 2) : 0);
  }
  // un porteur d'épée se bat au corps à corps, même s'il avait un arc
  function tirDe(e, s) {
    var d = e.arme && C.ITEMS[e.arme];
    if (d && d.tool && !d.ranged) return null;
    return s.tir || null;
  }

  // les véhicules sont des entités : leurs gabarits viennent de vehicules.js
  if (MC.Vehicules) Object.assign(SPECS, MC.Vehicules.gabarits());

  var ARROW_SPEED = 26;         // tirs des créatures : plus lents que ceux du joueur
  var RECUL_BOSS = 0.25;        // un gardien encaisse sans être projeté

  /* Cap d'une créature. Le maillage a ses yeux vers -Z : après rotation de
     `yaw` autour de Y, son avant vaut (-sin, 0, -cos). Pour regarder vers
     (dx, dz) il faut donc yaw = atan2(-dx, -dz).
     La formule d'errance précédente (-dir + PI/2) donnait exactement l'opposé :
     les créatures marchaient à reculons. Une seule fonction désormais, pour que
     poursuite et errance ne puissent plus diverger. */
  function capVers(dx, dz) {
    if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return null;   // pas de cap
    return Math.atan2(-dx, -dz);
  }

  /* Rayon de séparation entre deux corps : moyenne des demi-largeurs, un peu
     resserrée pour que les créatures puissent se frôler sans se repousser en
     permanence. */
  function largeurDe(x) { return (x && typeof x.w === 'number') ? x.w : 0.6; }
  function hauteurDe(x) { return (x && typeof x.h === 'number') ? x.h : 1.8; }
  /* Une largeur manquante donnerait NaN, et NaN contamine silencieusement
     toutes les positions : le corps finit hors du monde sans la moindre erreur.
     D'ou les valeurs de repli. */
  function rayonSeparation(a, b) { return (largeurDe(a) + largeurDe(b)) * 0.42; }
  var VITESSE_SEPARATION = 4;   // m/s : vitesse a laquelle deux corps s ecartent
  var POUSSEE_MAX = 0.2;        // deplacement total maximal par image

  var ARROW_GRAVITY = 14;      // plus douce que la chute libre : trajectoire lisible
  var ARROW_VIE = 12;          // secondes avant disparition

  var GRAVITY = 30, MAX_FALL = 55;
  var NAGE_FREIN = 0.62;        // facteur de vitesse horizontale dans l'eau

  function createEntities(world) {
    var list = [];
    var nextId = 1;
    /* Portes ouvertes par un habitant (voir stepAI) : elles se referment
       seules après quelques secondes. `y2` : l'autre moitié de la porte,
       ou null pour une trappe (un seul bloc). */
    var portesTemp = [];
    var DELAI_FERMETURE_PORTE = 4;

    function spawn(type, x, y, z, extra) {
      var s = SPECS[type];
      var e = {
        eid: nextId++, type: type, pos: { x: x, y: y, z: z }, vel: { x: 0, y: 0, z: 0 },
        hp: s.hp, w: s.w, h: s.h, onGround: false, age: 0, yaw: 0,
        attackCd: 0, wanderCd: 0, hurtCd: 0, dead: false,
      };
      if (s.arme) e.arme = s.arme;
      // variante de couleur (poissons tropicaux, perroquets), stable pour l'entité
      if (s.variantes) e.variante = e.eid % s.variantes;
      if (extra) for (var k in extra) e[k] = extra[k];
      list.push(e);
      return e;
    }

    // `data` : donnée générique optionnelle portée par l'objet au sol (ex.
    // SPEC-MECA-003, le niveau d'une batterie cassée) — reprise telle quelle
    // sur la pile d'inventaire au ramassage (voir events.picked plus bas).
    function dropItem(x, y, z, id, n, rand, data) {
      var r = rand || Math.random;
      var e = spawn('item', x, y, z, { item: id, n: n || 1, pickup: 0.4, data: data });
      // petite impulsion pour que les drops ne s'empilent pas exactement
      e.vel.x = (r() - 0.5) * 2.2;
      e.vel.z = (r() - 0.5) * 2.2;
      e.vel.y = 2.2 + r();
      return e;
    }

    /* Lance un projectile. `tireur` sert a ne pas se blesser soi-meme :
       la fleche part de la tete du joueur et le traverse pendant un instant. */
    /* `genre` : 'fleche' (par défaut), 'neige', 'sortilege', 'feu', 'laser'.
       Seules la flèche et la boule de neige retombent. */
    // 'bombe' : bombe volcanique, lourde (SPEC-RELIEF-011)
    var GRAVITE_PROJECTILE = { fleche: 1, neige: 0.7, sortilege: 0, feu: 0, laser: 0, bombe: 1 };
    function tirer(origine, direction, vitesse, degats, tireur, genre) {
      var e = spawn('arrow', origine.x, origine.y, origine.z, {
        degats: degats === undefined ? SPECS.arrow.damage : degats,
        tireur: tireur || null,
        vie: ARROW_VIE,
        genre: genre || 'fleche',
      });
      var v = vitesse === undefined ? 34 : vitesse;
      e.vel.x = direction.x * v;
      e.vel.y = direction.y * v;
      e.vel.z = direction.z * v;
      return e;
    }

    /* Avance un projectile par petits pas et s'arrete au premier contact.
       On subdivise le deplacement : a 34 m/s et 60 images/s, un pas entier
       fait 0,57 bloc — un mur d'un bloc passerait au travers un tir sur deux. */
    /* `peutBlesser(tireurState, cibleState)` (B4, SPEC-PVP-002/005) : fourni
       par le serveur (server.js), il retrouve les deux joueurs par leur
       `state` et décide — duel consenti en cours (SPEC-PVP-005, prioritaire :
       il autorise même hors zone PvP ou sans --pvp) OU (PvP autorisé par la
       zone/le réglage ET aucune faction commune, SPEC-PVP-002/FACTION-012).
       Quand il est fourni, il REMPLACE `pvpOk` pour un tir de JOUEUR (`pvpOk`
       reste seul juge pour un tir de créature/distributeur, via
       `degatsMobOk`, inchangé) — évalué à CHAQUE pas de la trajectoire, donc
       à l'IMPACT réel, jamais au moment du tir : un duel qui expire ou
       s'éloigne pendant le vol d'un projectile protège la cible, même si le
       tir était permis à l'instant du déclenchement (piège documenté par
       B4.md § 13, testé par SPEC-PVP-005). */
    function stepArrow(e, dt, player, events, joueurs, pvpOk, peutBlesser) {
      var cibles = joueurs && joueurs.length ? joueurs : (player ? [player] : []);
      e.vie -= dt;
      if (e.vie <= 0) { remove(e); return; }
      var gp = GRAVITE_PROJECTILE[e.genre || 'fleche'];
      e.vel.y -= ARROW_GRAVITY * (gp === undefined ? 1 : gp) * dt;

      var dist = Math.hypot(e.vel.x, e.vel.y, e.vel.z) * dt;
      var pas = Math.max(1, Math.ceil(dist / 0.2));
      var sdt = dt / pas;
      for (var k = 0; k < pas; k++) {
        e.pos.x += e.vel.x * sdt;
        e.pos.y += e.vel.y * sdt;
        e.pos.z += e.vel.z * sdt;

        // bloc solide : le projectile se fiche et disparait
        if (C.isSolid(world.getBlock(Math.floor(e.pos.x), Math.floor(e.pos.y), Math.floor(e.pos.z)))) {
          remove(e); return;
        }
        // entite : on ignore le tireur et les autres projectiles
        for (var i = 0; i < list.length; i++) {
          var c = list[i];
          if (c === e || c.type === 'item' || c.type === 'arrow' || c.dead) continue;
          if (c === e.tireur) continue;
          var hw = c.w / 2;
          if (Math.abs(e.pos.x - c.pos.x) < hw && Math.abs(e.pos.z - c.pos.z) < hw &&
              e.pos.y > c.pos.y && e.pos.y < c.pos.y + c.h) {
            c.hurtCd = 0;                       // un tir vise touche toujours
            damage(c, e.degats, e.pos, e.tireur);
            remove(e);
            return;
          }
        }
        // un joueur, sauf s'il est le tireur
        for (var q = 0; q < cibles.length; q++) {
          var pj = cibles[q];
          if (!pj || pj.dead || e.tireur === pj) continue;
          if (e.pos.y > pj.pos.y && e.pos.y < pj.pos.y + 1.8 &&
              Math.abs(e.pos.x - pj.pos.x) < 0.3 && Math.abs(e.pos.z - pj.pos.z) < 0.3) {
            /* SPEC-COMBAT-002 / SPEC-ZONE-002 : une flèche tirée par un autre
               joueur n'est un coup permis que si le PvP l'est (réglage du
               serveur ET zone, jugés par `pvpOk`, fourni par l'appelant) ;
               tirée par une créature, c'est une question de zone PvE. */
            var permis = estJoueur(e.tireur)
              ? (peutBlesser ? peutBlesser(e.tireur, pj) : (pvpOk ? pvpOk(e.tireur.pos, pj.pos) : false))
              : degatsMobOk(pj.pos);
            if (events && permis) {
              if (pj === player) events.damage += e.degats;
              // `par` (B4, SPEC-PVP-001/003) : l'auteur du coup — le state du
              // tireur s'il s'agit d'un joueur, `null` pour une créature ou un
              // distributeur (server.js le retrouve par identité d'objet,
              // comme il le fait déjà pour `joueur`).
              events.degatsPar.push({ joueur: pj, n: e.degats, par: e.tireur || null });
            }
            remove(e);
            return;
          }
        }
        if (e.pos.y < -20) { remove(e); return; }
      }
    }

    /* Un corps peut-il en repousser un autre ? Les objets au sol et les
       projectiles traversent tout le monde : les faire pousser rendrait le
       ramassage désagréable et ferait dévier les tirs. */
    function corpsSolide(x) {
      return x && !x.dead && x.type !== 'item' && x.type !== 'arrow';
    }

    /* Écarte deux corps qui se chevauchent, horizontalement seulement : une
       poussée verticale empêcherait de se tenir sur une créature et
       provoquerait des éjections vers le haut. */
    function ecarter(a, b, dt, poidsA, poidsB) {
      var dx = a.pos.x - b.pos.x, dz = a.pos.z - b.pos.z;
      var d = Math.hypot(dx, dz);
      var r = rayonSeparation(a, b);
      if (d >= r) return 0;

      // chevauchement vertical : deux corps l'un au-dessus de l'autre ne se
      // repoussent pas
      var hA = hauteurDe(a), hB = hauteurDe(b);
      if (a.pos.y >= b.pos.y + hB || b.pos.y >= a.pos.y + hA) return 0;

      // superposition exacte : on choisit une direction stable plutôt qu'au hasard
      if (d < 1e-6) {
        var ang = ((a.eid || 1) * 2.39996);          // angle d'or : repartition
        dx = Math.cos(ang); dz = Math.sin(ang); d = 1;
      }
      var chevauche = r - d;
      // vitesse d ecartement plutot qu un pas fixe : le comportement ne depend
      // plus de la cadence d affichage
      var pousse = Math.min(chevauche, VITESSE_SEPARATION * Math.max(dt, 1 / 240));
      var ux = dx / d, uz = dz / d;
      a.pos.x += ux * pousse * poidsA;
      a.pos.z += uz * pousse * poidsA;
      if (poidsB) { b.pos.x -= ux * pousse * poidsB; b.pos.z -= uz * pousse * poidsB; }
      return pousse;
    }

    /* Repousse corps (un joueur) hors des créatures. Le joueur seul bouge :
       une créature repoussée par le joueur serait injouable en combat. */
    function separer(corps, dt) {
      if (!corps || corps.dead) return 0;
      var total = 0;
      var avantX = corps.pos.x, avantZ = corps.pos.z;
      for (var i = 0; i < list.length; i++) {
        var o = list[i];
        if (!corpsSolide(o) || o === corps.monture) continue;
        total += ecarter(corps, o, dt, 1, 0);
      }
      /* On borne le deplacement TOTAL, pas chaque contribution : trois corps
         superposes cumuleraient sinon leurs poussees et projetteraient le
         joueur au loin. */
      var dx = corps.pos.x - avantX, dz = corps.pos.z - avantZ;
      var d = Math.hypot(dx, dz);
      if (d > POUSSEE_MAX) {
        corps.pos.x = avantX + (dx / d) * POUSSEE_MAX;
        corps.pos.z = avantZ + (dz / d) * POUSSEE_MAX;
      }
      /* La poussée ne doit jamais faire entrer dans un bloc : sinon un mob
         acculant le joueur contre un mur le ferait passer au travers. */
      if (total > 0 && P.collides(world, corps.pos.x, corps.pos.y, corps.pos.z,
                                  largeurDe(corps), hauteurDe(corps))) {
        corps.pos.x = avantX; corps.pos.z = avantZ;
      }
      return total;
    }

    /* Sépare les créatures entre elles, chacune cédant la moitié. */
    function separerEntites(dt) {
      var n = 0;
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (!corpsSolide(a)) continue;
        for (var j = i + 1; j < list.length; j++) {
          var b = list[j];
          if (!corpsSolide(b)) continue;
          var avant = { ax: a.pos.x, az: a.pos.z, bx: b.pos.x, bz: b.pos.z };
          if (ecarter(a, b, dt, 0.5, 0.5) > 0) {
            n++;
            if (P.collides(world, a.pos.x, a.pos.y, a.pos.z, a.w, a.h)) {
              a.pos.x = avant.ax; a.pos.z = avant.az;
            }
            if (P.collides(world, b.pos.x, b.pos.y, b.pos.z, b.w, b.h)) {
              b.pos.x = avant.bx; b.pos.z = avant.bz;
            }
          }
        }
      }
      return n;
    }

    function remove(e) {
      e.dead = true;
      var i = list.indexOf(e);
      if (i >= 0) list.splice(i, 1);
    }

    /* Journal des événements notables (mort d'un gardien) : les dégâts
       arrivent par plusieurs chemins (mêlée, flèche), le jeu les relève ici
       une fois par image plutôt que d'être rappelé depuis chacun. */
    var journal = [];
    function evenements() { var l = journal.slice(); journal.length = 0; return l; }

    /* `auteur` : qui frappe — le joueur (son état, qui porte un inventaire),
       une créature, ou rien (chute, asphyxie). */
    function estJoueur(a) { return !!(a && a.inv); }
    /* `reculMul` (SPEC-OBJET-002) : intensité du recul propre à l'arme du
       joueur (dague légère, masse écrasante…) ; 1 par défaut, comme avant
       l'ajout des nouvelles armes de mêlée. */
    function damage(e, amount, knockFrom, auteur, reculMul) {
      if (e.hurtCd > 0 || e.dead) return false;
      var s = SPECS[e.type];
      e.hp -= amount;
      e.hurtCd = 0.35;
      // un cri de blessure, là où ça se passe (SPEC-AUDIO-002) ; le jeu décide
      // du son exact, ici on ne fait que relever l'événement et sa position
      journal.push({ type: 'blesse', victime: e.type, pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z } });
      // une créature neutre frappée par le joueur lui en veut, et le reste
      if (s.neutral && (!auteur || estJoueur(auteur))) e.enrage = true;
      // frappée par une autre créature, elle riposte contre elle
      if (auteur && !estJoueur(auteur) && auteur.eid && !auteur.dead) { e.cibleE = auteur; e.cibleT = 2; }
      if (knockFrom) {
        var dx = e.pos.x - knockFrom.x, dz = e.pos.z - knockFrom.z;
        var d = Math.hypot(dx, dz) || 1;
        var k = (s.boss ? RECUL_BOSS : (s.vehicule ? 0 : 1)) * (reculMul === undefined ? 1 : reculMul);
        e.vel.x += (dx / d) * 5 * k; e.vel.z += (dz / d) * 5 * k; e.vel.y = 4.5 * k;
      }
      if (e.hp <= 0) {
        // SPEC-OBJET-003 : bijou d'émeraude — chance au butin, aussi sur le
        // butin des créatures (pas seulement le minage).
        var bijouT = auteur && auteur.equip && auteur.equip.bijou;
        var bdT = bijouT && C.def(bijouT.id);
        var bonusT = (bdT && bdT.effet && bdT.effet.type === 'chance') ? bdT.effet.valeur : 0;
        var mulT = 1 - Math.max(0, Math.min(0.9, bonusT));
        if (s.drops) {
          for (var i = 0; i < s.drops.length; i++) {
            if (s.drops[i].chance !== undefined && Math.random() * mulT > s.drops[i].chance) continue;
            dropItem(e.pos.x, e.pos.y + 0.5, e.pos.z, s.drops[i].id, s.drops[i].n);
          }
        }
        // une créature armée lâche parfois son arme (jamais un gardien : son trésor suffit)
        if (e.arme && !s.boss && Math.random() < CHANCE_ARME_LACHEE) {
          dropItem(e.pos.x, e.pos.y + 0.5, e.pos.z, e.arme, 1);
        }
        // le slime colossal éclate en petits slimes qui continuent le combat
        if (s.division) {
          for (var j = 0; j < s.division.n; j++) {
            var ang = (j / s.division.n) * Math.PI * 2;
            var p = spawn(s.division.type, e.pos.x + Math.cos(ang) * 0.8, e.pos.y + 0.2,
                          e.pos.z + Math.sin(ang) * 0.8, { donjon: e.donjon || null });
            p.vel.x = Math.cos(ang) * 3; p.vel.z = Math.sin(ang) * 3; p.vel.y = 5;
          }
        }
        // `auteur` : l'état du joueur qui a porté le coup fatal (null si ce n'est pas un joueur) —
        // le serveur y crédite les succès (SPEC-ARCHI-042)
        var tueur = estJoueur(auteur) ? auteur : null;
        journal.push({ type: 'mort', victime: e.type, parJoueur: estJoueur(auteur), auteur: tueur,
                       pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z } });
        if (s.boss) journal.push({ type: 'boss_vaincu', boss: e.type, nom: s.nom, auteur: tueur,
                                   donjon: e.donjon || null, pos: { x: e.pos.x, y: e.pos.y, z: e.pos.z } });
        remove(e);
        return true;
      }
      return false;
    }

    /* Physique commune : gravité, collisions, flottaison dans l'eau. */
    function stepBody(e, dt) {
      var sb = SPECS[e.type];
      var lv = P.dansLave(world, e.pos, e.w, e.h);
      if (lv) {
        if (e.type === 'item') { remove(e); return { x: false, y: false, z: false }; }
        if (!sb.boss || e.type !== 'boss_wyverne') damage(e, lv.brule);
        e.vel.x *= 0.5; e.vel.z *= 0.5;
      }
      if (sb && sb.lest && P.inWater(world, e.pos, e.h)) {
        // lesté : la verticale a déjà été réglée par Faune.lester
      } else if (P.inWater(world, e.pos, e.h)) {
        e.vel.y -= GRAVITY * 0.28 * dt;
        if (e.vel.y < -2.2) e.vel.y = -2.2;
        if (e.type !== 'item') {
          /* Flottaison amortie : une poussée constante fait osciller la
             créature autour de la surface. On vise une vitesse de remontée
             et on freine à mesure qu'on s'en approche, ce qui stabilise. */
          var cible = P.headInWater(world, e.pos, e.h * 0.9) ? 3.2 : 0;
          e.vel.y = P.approach(e.vel.y, cible, 6, dt);
        }
      } else {
        e.vel.y -= GRAVITY * dt;
        if (e.vel.y < -MAX_FALL) e.vel.y = -MAX_FALL;
      }
      /* Dans l'eau, on avance moins vite : sans cela une créature nage aussi
         vite qu'elle court, ce qui rend les poursuites aquatiques absurdes. */
      // dans l'eau jusqu'à mi-corps : elle nage (et s'anime ainsi, SPEC-MOB-010)
      e.dansEau = P.inWater(world, { x: e.pos.x, y: e.pos.y + e.h * 0.45, z: e.pos.z }, 0.1);
      if (P.inWater(world, e.pos, e.h) && e.type !== 'item' && e.type !== 'arrow') {
        e.vel.x *= NAGE_FREIN;
        e.vel.z *= NAGE_FREIN;
      }
      var hit = P.move(world, e, dt, e.w, e.h);
      e.onGround = hit.landed || (e.onGround && !hit.y && Math.abs(e.vel.y) < 1e-3);
      if (hit.landed) e.onGround = true;
      // frottement au sol ; les objets glissent moins
      var fr = e.onGround ? (e.type === 'item' ? 6 : 8) : 1.2;
      e.vel.x = P.approach(e.vel.x, 0, fr, dt);
      e.vel.z = P.approach(e.vel.z, 0, fr, dt);
      return hit;
    }

    /* Ligne de vue : un tireur ne tire pas à travers un mur. On lance le
       rayon des yeux de la créature vers la poitrine du joueur. */
    function voitCible(e, cible) {
      var o = { x: e.pos.x, y: e.pos.y + e.h * 0.85, z: e.pos.z };
      var tx = cible.pos.x - o.x, ty = cible.pos.y + 1.2 - o.y, tz = cible.pos.z - o.z;
      var d = Math.hypot(tx, ty, tz);
      if (d < 1e-6) return true;
      var hit = P.raycast(world, o, { x: tx / d, y: ty / d, z: tz / d }, d,
                          function (id) { return C.isSolid(id); });
      return !hit || hit.t >= d - 0.3;
    }

    /* Visée balistique : la flèche retombe, on vise donc un peu au-dessus
       de la cible, d'autant plus qu'elle est loin. Une rafale (n > 1)
       s'ouvre en éventail horizontal. */
    function viser(e, cible, tir) {
      var o = { x: e.pos.x, y: e.pos.y + e.h * 0.85, z: e.pos.z };
      var tx = cible.pos.x - o.x, tz = cible.pos.z - o.z;
      var ty = cible.pos.y + 1.2 - o.y;
      var dh = Math.hypot(tx, tz) || 1;
      var t = dh / ARROW_SPEED;
      ty += 0.5 * ARROW_GRAVITY * t * t;
      var base = Math.atan2(tz, tx);
      var dirs = [];
      for (var i = 0; i < tir.n; i++) {
        var a = base + (i - (tir.n - 1) / 2) * 0.12;
        var hx = Math.cos(a) * dh, hz = Math.sin(a) * dh;
        var n = Math.hypot(hx, ty, hz);
        dirs.push({ x: hx / n, y: ty / n, z: hz / n });
      }
      // la flèche part devant la créature, pas de l'intérieur de sa propre boîte
      o.x += (tx / dh) * (e.w / 2 + 0.2); o.z += (tz / dh) * (e.w / 2 + 0.2);
      return { origine: o, directions: dirs, degats: tir.degats, genre: tir.genre || 'fleche' };
    }

    function sbires(maitre) {
      var n = 0;
      for (var i = 0; i < list.length; i++) if (list[i].maitre === maitre.eid && !list[i].dead) n++;
      return n;
    }

    /* Choix de la cible d'une créature, revu deux fois par seconde : le
       joueur s'il est son ennemi (selon sa faction et la réputation du joueur),
       ou la créature ennemie la plus proche. Renvoie { cible, agressif,
       joueur }. Une créature sans faction garde l'ancien comportement : elle
       vise le joueur, agressive selon son gabarit. */
    function choisirCible(e, s, joueur, rep, dt) {
      var F = MC.Factions;
      var f = F && F.factionDe(e.type);
      var contreJoueur = !!(joueur && !joueur.dead &&
        ((F ? F.hostileEnversJoueur(e.type, rep, s.hostile) : s.hostile) || (s.neutral && e.enrage)));
      if (!f) return { cible: joueur, agressif: contreJoueur || !!s.hostile, joueur: true };
      var vue = s.vue || 16;
      e.cibleT = (e.cibleT || 0) - dt;
      if (e.cibleT <= 0 || !e.cibleE || e.cibleE.dead) {
        e.cibleT = 0.5;
        var best = null, bd = vue;
        e.fuirDe = null;
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (o === e || o.dead || o.type === 'item' || o.type === 'arrow') continue;
          if (!F.typesEnnemis(e.type, o.type)) continue;
          var d = Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z);
          if (d < bd && Math.abs(o.pos.y - e.pos.y) < 6) { bd = d; best = o; }
        }
        // les pacifiques ne se battent pas : ils fuient ce qui les menace
        if (s.npc) { e.fuirDe = best && bd < 8 ? best.pos : null; best = null; }
        e.cibleE = best;
      }
      var ce = e.cibleE && !e.cibleE.dead ? e.cibleE : null;
      if (ce && contreJoueur) {
        var dj = Math.hypot(joueur.pos.x - e.pos.x, joueur.pos.z - e.pos.z);
        if (dj < Math.hypot(ce.pos.x - e.pos.x, ce.pos.z - e.pos.z)) ce = null;
      }
      if (ce) return { cible: ce, agressif: true, joueur: false };
      return { cible: joueur, agressif: contreJoueur, joueur: true };
    }

    /* Nageurs et volants. Le déplacement vient de Faune ; les attaques
       (morsure, tir, renforts) suivent les mêmes règles que sur la terre ferme. */
    function stepFaune(e, s, dt, player, rand, agressifImpose) {
      var agressif = agressifImpose !== undefined ? !!agressifImpose : !!(s.hostile || (s.neutral && e.enrage));
      var ctx = { world: world, cible: player, rand: rand, agressif: agressif };
      var act = null;
      if (s.nageur) {
        var res = MC.Faune.nager(e, s, dt, ctx);
        if (res.degats) damage(e, res.degats);
      } else {
        MC.Faune.volerVers(e, s, dt, ctx);
      }
      var hit = P.move(world, e, dt, e.w, e.h);
      e.onGround = !!hit.landed;
      if (!agressif || !player || player.dead) return null;
      var dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
      var dy = player.pos.y + 0.9 - (e.pos.y + e.h / 2);
      var dist = Math.hypot(dx, dz), dist3 = Math.hypot(dx, dy, dz);
      e.attackCd -= dt;
      if (dist3 < 0.9 + s.w / 2 && e.attackCd <= 0) {
        e.attackCd = 1.1;
        act = { attack: degatsAvecArme(s, e.arme) };
      }
      var tir = tirDe(e, s);
      if (tir) {
        e.tirCd = (e.tirCd === undefined ? tir.cadence * 0.5 : e.tirCd) - dt;
        if (!act && e.tirCd <= 0 && dist < tir.portee && dist3 > 1.5 && voitCible(e, player)) {
          e.tirCd = tir.cadence;
          act = { tir: viser(e, player, tir) };
        }
      }
      if (s.invoque) {
        e.invocCd = (e.invocCd === undefined ? 3 : e.invocCd) - dt;
        if (!act && e.invocCd <= 0) {
          e.invocCd = s.invoque.cadence;
          if (sbires(e) < s.invoque.max) act = { invoque: s.invoque };
        }
      }
      return act;
    }

    var RAYON_FOYER = 8;
    /* IA : poursuite pour les hostiles, errance pour les autres. */
    function stepAI(e, dt, player, rand, agressifImpose) {
      var r = rand || Math.random;
      var s = SPECS[e.type];
      if (!s.speed) return;

      var dx = player.pos.x - e.pos.x, dz = player.pos.z - e.pos.z;
      var dist = Math.hypot(dx, dz);
      var agressif = agressifImpose !== undefined ? agressifImpose : (s.hostile || (s.neutral && e.enrage));
      // un villageois fuit le danger au lieu d'errer
      if (e.fuirDe && !agressif) {
        var fx = e.pos.x - e.fuirDe.x, fz = e.pos.z - e.fuirDe.z, fd = Math.hypot(fx, fz) || 1;
        e.vel.x = fx / fd * s.speed * 1.8; e.vel.z = fz / fd * s.speed * 1.8;
        var cf = capVers(e.vel.x, e.vel.z);
        if (cf !== null) e.yaw = cf;
        return null;
      }
      var vue = s.vue || 18;

      if (agressif && dist < vue && !player.dead) {
        var tir = tirDe(e, s);
        var d = dist || 1;
        var ux = dx / d, uz = dz / d;
        var cp = capVers(dx, dz);
        if (cp !== null) e.yaw = cp;
        var act = null;

        // ── déplacement ──
        var vx = ux * s.speed, vz = uz * s.speed;
        if (tir) {
          // un tireur garde ses distances : il recule si on le serre, tourne autour sinon
          if (dist < tir.recul) { vx = -ux * s.speed; vz = -uz * s.speed; }
          else if (dist < tir.portee * 0.7) {
            var sens = (e.eid % 2) ? 1 : -1;
            vx = -uz * s.speed * 0.5 * sens; vz = ux * s.speed * 0.5 * sens;
          }
        }
        if (s.sauteur) {
          // un slime ne glisse pas : il reste posé puis bondit vers sa proie
          e.sautCd = (e.sautCd || 0) - dt;
          if (e.onGround) {
            if (e.sautCd <= 0) {
              e.sautCd = 0.9 + r() * 0.6;
              e.vel.y = 7.5;
              e.vel.x = vx * 1.6; e.vel.z = vz * 1.6;
            } else { e.vel.x = P.approach(e.vel.x, 0, 10, dt); e.vel.z = P.approach(e.vel.z, 0, 10, dt); }
          }
        } else {
          e.vel.x = vx; e.vel.z = vz;
        }
        // bond : l'araignée se jette sur sa proie à courte distance
        e.bondCd = (e.bondCd || 0) - dt;
        if (s.bond && e.onGround && e.bondCd <= 0 && dist > 2.2 && dist < 6) {
          e.bondCd = 3 + r() * 1.5;
          e.vel.y = 6.2; e.vel.x = ux * 8; e.vel.z = uz * 8;
        }
        // sauter par-dessus un obstacle d'un bloc
        if (e.onGround && !s.sauteur) {
          var ax = Math.floor(e.pos.x + ux * (0.4 + s.w / 2));
          var az = Math.floor(e.pos.z + uz * (0.4 + s.w / 2));
          var front = world.getBlock(ax, Math.floor(e.pos.y), az);
          var above = world.getBlock(ax, Math.floor(e.pos.y) + 1, az);
          if (C.isSolid(front) && !C.isSolid(above)) e.vel.y = 8.2;
        }

        // ── attaques ──
        e.attackCd -= dt;
        var dy = Math.abs(player.pos.y - e.pos.y);
        var allonge = 0.8 + s.w / 2;
        if (dist < allonge && dy < Math.max(2, s.h) && e.attackCd <= 0) {
          e.attackCd = 1.1;
          act = { attack: degatsAvecArme(s, e.arme) };
        }
        if (tir) {
          e.tirCd = (e.tirCd === undefined ? tir.cadence * 0.5 : e.tirCd) - dt;
          if (!act && e.tirCd <= 0 && dist < tir.portee && dist > 1.5 && voitCible(e, player)) {
            e.tirCd = tir.cadence;
            act = { tir: viser(e, player, tir) };
          }
        }
        if (s.invoque) {
          e.invocCd = (e.invocCd === undefined ? 3 : e.invocCd) - dt;
          if (!act && e.invocCd <= 0) {
            e.invocCd = s.invoque.cadence;
            if (sbires(e) < s.invoque.max) act = { invoque: s.invoque };
          }
        }
        return act;
      } else {
        // errance : on change de cap de loin en loin
        e.wanderCd -= dt;
        if (e.wanderCd <= 0) {
          e.wanderCd = 2 + r() * 4;
          if (r() < 0.4) { e.wanderDir = null; }
          else { e.wanderDir = r() * Math.PI * 2; }
        }
        /* Un habitant reste près de son foyer (son bâtiment) : trop loin, il
           y retourne au lieu de se perdre dans la campagne. */
        if (e.foyer) {
          var hx = e.foyer.x - e.pos.x, hz = e.foyer.z - e.pos.z, hd = Math.hypot(hx, hz);
          if (hd > RAYON_FOYER) { e.wanderDir = Math.atan2(hz, hx); e.wanderCd = 1; }
        }
        if (e.wanderDir === null || e.wanderDir === undefined) {
          e.vel.x = P.approach(e.vel.x, 0, 6, dt);
          e.vel.z = P.approach(e.vel.z, 0, 6, dt);
        } else {
          var sp = s.speed * 0.6;
          e.vel.x = Math.cos(e.wanderDir) * sp;
          e.vel.z = Math.sin(e.wanderDir) * sp;
          var cw = capVers(e.vel.x, e.vel.z);
          if (cw !== null) e.yaw = cw;
          if (e.onGround) {
            var bx = Math.floor(e.pos.x + Math.cos(e.wanderDir) * 0.7);
            var bz = Math.floor(e.pos.z + Math.sin(e.wanderDir) * 0.7);
            if (C.isSolid(world.getBlock(bx, Math.floor(e.pos.y), bz))
                && !C.isSolid(world.getBlock(bx, Math.floor(e.pos.y) + 1, bz))) e.vel.y = 8.2;
            /* Un habitant qui bute contre une porte fermée l'ouvre, au lieu de
               rester bloqué comme un zombie (voir SPEC-PORTE-001). Elle se
               referme seule un peu après (portesTemp, traité dans update). */
            if (s.npc) {
              var fy2 = Math.floor(e.pos.y);
              for (var dyP = 0; dyP < 2; dyP++) {
                var idP = world.getBlock(bx, fy2 + dyP, bz);
                if (!C.estPorte(idP) || C.BLOCKS[idP].porte.ouverte) continue;
                var ouvId = C.bascule(idP);
                world.setBlock(bx, fy2 + dyP, bz, ouvId);
                var y2 = null;
                if (world.getBlock(bx, fy2 + dyP + 1, bz) === idP) { y2 = fy2 + dyP + 1; world.setBlock(bx, y2, bz, ouvId); }
                else if (world.getBlock(bx, fy2 + dyP - 1, bz) === idP) { y2 = fy2 + dyP - 1; world.setBlock(bx, y2, bz, ouvId); }
                portesTemp.push({ x: bx, y: fy2 + dyP, z: bz, y2: y2, t: DELAI_FERMETURE_PORTE });
                break;
              }
            }
          }
        }
      }
      return null;
    }

    /* Un tour de simulation. Renvoie les événements que le jeu doit traiter :
       dégâts au joueur et objets ramassés. */
    function zoneChargee(e) {
      return !world.estCharge || world.estCharge(e.pos.x, e.pos.z);
    }

    /* Referme les portes qu'un habitant a ouvertes, une fois leur délai
       écoulé — sauf si quelqu'un d'autre les a entre-temps déjà refermées,
       ou si elles sont encore ouvertes pour une autre raison. */
    function refermerPortes(dt) {
      for (var i = portesTemp.length - 1; i >= 0; i--) {
        var pt = portesTemp[i];
        pt.t -= dt;
        if (pt.t > 0) continue;
        portesTemp.splice(i, 1);
        var cur = world.getBlock(pt.x, pt.y, pt.z);
        if (!C.estPorte(cur) || !C.BLOCKS[cur].porte.ouverte) continue;
        var fer = C.bascule(cur);
        world.setBlock(pt.x, pt.y, pt.z, fer);
        if (pt.y2 !== null && world.getBlock(pt.x, pt.y2, pt.z) === cur) world.setBlock(pt.x, pt.y2, pt.z, fer);
      }
    }

    function update(dt, player, opts) {
      opts = opts || {};
      refermerPortes(dt);
      var rand = opts.rand || Math.random;
      var events = { damage: 0, picked: [], degatsPar: [] };
      /* Plusieurs joueurs (le serveur les simule tous) : chaque entité
         s'occupe du plus proche. Sans liste, le joueur unique d'autrefois. */
      var joueurs = opts.joueurs && opts.joueurs.length ? opts.joueurs : [player];
      function procheDe(e) {
        if (joueurs.length === 1) return joueurs[0];
        var best = null, bd = Infinity;
        for (var q = 0; q < joueurs.length; q++) {
          var pj = joueurs[q];
          if (!pj || pj.dead) continue;
          var d = Math.hypot(pj.pos.x - e.pos.x, pj.pos.y - e.pos.y, pj.pos.z - e.pos.z);
          if (d < bd) { bd = d; best = pj; }
        }
        return best || joueurs[0];
      }

      for (var i = list.length - 1; i >= 0; i--) {
        var e = list[i];
        if (!e || e.dead) continue;
        /* Chunk absent : on gèle le corps. Sans sol chargé, la gravité le
           faisait tomber dans le vide jusqu'à y < -20 — les créatures
           disparaissaient et le butin au sol était perdu. */
        if (!zoneChargee(e)) {
          if (e.type === 'arrow') remove(e);
          continue;
        }
        e.age += dt;
        if (e.hurtCd > 0) e.hurtCd -= dt;

        if (e.type === 'arrow') {
          stepArrow(e, dt, player, events, joueurs, opts.pvpOk, opts.peutBlesser);
          continue;
        }

        if (e.type === 'item') {
          e.pickup -= dt;
          stepBody(e, dt);
          if (e.dead) continue;
          // aimantation vers le joueur le plus proche
          var pi = procheDe(e);
          var dx = pi.pos.x - e.pos.x;
          var dy = (pi.pos.y + 0.6) - e.pos.y;
          var dz = pi.pos.z - e.pos.z;
          var d = Math.hypot(dx, dy, dz);
          if (e.pickup <= 0 && d < 2.2) {
            var pull = 9 / Math.max(0.35, d);
            e.vel.x += (dx / d) * pull * dt * 6;
            e.vel.y += (dy / d) * pull * dt * 6;
            e.vel.z += (dz / d) * pull * dt * 6;
          }
          if (e.pickup <= 0 && d < 0.85) {
            events.picked.push({ id: e.item, n: e.n, entity: e, joueur: pi, data: e.data });
            remove(e);
          }
          if (e.age > 300) remove(e);       // les objets oubliés disparaissent
          continue;
        }

        var se = SPECS[e.type];
        var act;
        var pj = procheDe(e);
        if (se.vehicule) {
          // un véhicule abandonné roule sur son élan, flotte ou retombe ; piloté,
          // c'est le jeu qui le conduit, avec les commandes du joueur
          if (!e.conducteur && MC.Vehicules) MC.Vehicules.conduire(e, dt, world, null);
          continue;
        }
        var choix = choisirCible(e, se, pj, opts.reputation, dt);
        if (se.nageur || se.volant) {
          act = stepFaune(e, se, dt, choix.joueur ? pj : choix.cible, rand, choix.agressif);
        } else {
          act = stepAI(e, dt, choix.cible || pj, rand, choix.agressif);
          if (se.lest) MC.Faune.lester(e, se, dt, { world: world, cible: pj,
                                                   agressif: !!(se.hostile || e.enrage) });
          stepBody(e, dt);
        }
        if (e.dead) continue;
        // ce qu'elle regarde et quand elle frappe, pour l'animer (SPEC-MOB-010)
        var vue = choix.cible || (choix.joueur ? pj : null);
        if (vue && vue.pos) { e.vise = e.vise || {}; e.vise.x = vue.pos.x; e.vise.y = vue.pos.y + (vue.h || 1.6) * 0.85; e.vise.z = vue.pos.z; }
        else e.vise = null;
        if (act && act.attack) {
          e.coupA = e.age;
          // le coup va à la cible : le joueur, ou la créature combattue
          if (choix.joueur) {
            // SPEC-ZONE-002 : une zone sûre ou PvE-hostile-restreinte protège
            // aussi du corps à corps d'une créature déjà présente
            if (degatsMobOk(pj.pos)) {
              if (pj === player) events.damage += act.attack;
              events.degatsPar.push({ joueur: pj, n: act.attack });
            }
          } else if (choix.cible && !choix.cible.dead) damage(choix.cible, act.attack, e.pos, e);
        }
        // méduse : elle pique quiconque la frôle
        if (se.pique && pj && !pj.dead) {
          e.piqueCd = (e.piqueCd || 0) - dt;
          if (e.piqueCd <= 0 && P.boxOverlap(e.pos.x, e.pos.y, e.pos.z, e.w + 0.2, e.h,
                                             pj.pos.x, pj.pos.y, pj.pos.z, 0.6, 1.8)) {
            e.piqueCd = 1;
            if (degatsMobOk(pj.pos)) {
              if (pj === player) events.damage += se.pique;
              events.degatsPar.push({ joueur: pj, n: se.pique });
            }
          }
        }
        if (act && act.tir) {
          for (var t = 0; t < act.tir.directions.length; t++) {
            tirer(act.tir.origine, act.tir.directions[t], ARROW_SPEED, act.tir.degats, e, act.tir.genre);
          }
          events.tirs = (events.tirs || 0) + 1;
        }
        if (act && act.invoque) {
          for (var k = 0; k < act.invoque.n; k++) {
            var ang = rand() * Math.PI * 2;
            var sx = e.pos.x + Math.cos(ang) * 1.6, sz = e.pos.z + Math.sin(ang) * 1.6;
            var sp = SPECS[act.invoque.type];
            // on n'invoque pas dans un mur
            if (P.collides(world, sx, e.pos.y, sz, sp.w, sp.h)) { sx = e.pos.x; sz = e.pos.z; }
            spawn(act.invoque.type, sx, e.pos.y, sz, { maitre: e.eid, donjon: e.donjon || null });
          }
          events.invocations = (events.invocations || 0) + 1;
        }

        // une créature ne traverse pas le joueur — sans pour autant entrer dans un mur,
        // comme les deux autres séparations : sinon le joueur l'enfonçait dans la roche
        if (pj && !pj.dead) {
          var avX = e.pos.x, avZ = e.pos.z;
          if (ecarter(e, pj, dt, 1, 0) > 0 && P.collides(world, e.pos.x, e.pos.y, e.pos.z, e.w, e.h)) {
            e.pos.x = avX; e.pos.z = avZ;
          }
        }

        // noyade et chute dans le vide
        if (e.pos.y < -20) remove(e);
      }
      separerEntites(dt);
      reproduire(dt, rand, events, !!opts.hiver);
      return events;
    }

    /* Reproduction : deux adultes de la même espèce, proches l'un de l'autre et
       reposés, donnent un petit — tant que leur espèce reste sous son plafond
       dans les environs. Le petit grandit en quelques minutes. De quoi garder
       une population vivante sans la laisser envahir le monde.
       SPEC-SAISON-006 : l'hiver, plus aucune nouvelle naissance — mais un
       petit déjà né continue de grandir, et les cooldowns continuent de
       s'écouler, pour reprendre net au printemps. */
    var ESPECES = { sheep: 1, pig: 1, chicken: 1, goat: 1, polar_bear: 1, wolf: 1 };
    var REPRO = { rayon: 5, delai: 90, croissance: 180, plafond: 8, zone: 48, cadence: 4 };
    var reproT = 0;
    function reproduire(dt, rand, events, hiver) {
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        if (p.bebe) { p.croissance = (p.croissance || 0) + dt; if (p.croissance >= REPRO.croissance) { p.bebe = false; } }
        if (p.reproCd > 0) p.reproCd -= dt;
      }
      reproT -= dt;
      if (reproT > 0) return;
      reproT = REPRO.cadence;
      if (hiver) return;
      for (var a = 0; a < list.length; a++) {
        var e = list[a];
        if (!ESPECES[e.type] || e.dead || e.bebe || e.reproCd > 0 || !zoneChargee(e)) continue;
        var voisins = 0, partenaire = null;
        for (var b = 0; b < list.length; b++) {
          var o = list[b];
          if (o === e || o.type !== e.type || o.dead) continue;
          var d = Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z);
          if (d < REPRO.zone) voisins++;
          if (!partenaire && !o.bebe && !(o.reproCd > 0) && d < REPRO.rayon) partenaire = o;
        }
        if (!partenaire || voisins + 1 >= REPRO.plafond) continue;
        e.reproCd = partenaire.reproCd = REPRO.delai * (0.8 + rand() * 0.4);
        var petit = spawn(e.type, (e.pos.x + partenaire.pos.x) / 2, Math.max(e.pos.y, partenaire.pos.y) + 0.1,
                          (e.pos.z + partenaire.pos.z) / 2, { bebe: true, croissance: 0 });
        events.naissances = (events.naissances || 0) + 1;
        journal.push({ type: 'naissance', espece: e.type, eid: petit.eid });
      }
    }

    /* Fusionne les piles d'objets proches : évite qu'un arbre abattu ne laisse
       trente entités distinctes au même endroit. */
    function mergeItems() {
      var merged = 0;
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (a.type !== 'item' || a.dead) continue;
        for (var j = i + 1; j < list.length; j++) {
          var b = list[j];
          if (b.type !== 'item' || b.dead || b.item !== a.item) continue;
          var d = Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y, a.pos.z - b.pos.z);
          if (d > 0.9) continue;
          var max = C.maxStack(a.item);
          if (a.n + b.n > max) continue;
          a.n += b.n; remove(b); merged++; j--;
        }
      }
      return merged;
    }

    /* Intersection rayon / boîte (méthode des tranches).
       Une mesure « distance du centre à l'axe du regard » ne convient pas :
       le centre d'un mob court est très en dessous des yeux du joueur, donc
       l'écart dépasse toujours le seuil et les mobs bas deviennent intouchables. */
    function rayBox(o, d, minx, miny, minz, maxx, maxy, maxz) {
      var t0 = 0, t1 = Infinity;
      var lo, hi, inv, tmp;
      var O = [o.x, o.y, o.z], D = [d.x, d.y, d.z];
      var MI = [minx, miny, minz], MA = [maxx, maxy, maxz];
      for (var a = 0; a < 3; a++) {
        if (Math.abs(D[a]) < 1e-9) {
          if (O[a] < MI[a] || O[a] > MA[a]) return null;   // parallèle et hors de la dalle
          continue;
        }
        inv = 1 / D[a];
        lo = (MI[a] - O[a]) * inv;
        hi = (MA[a] - O[a]) * inv;
        if (lo > hi) { tmp = lo; lo = hi; hi = tmp; }
        if (lo > t0) t0 = lo;
        if (hi < t1) t1 = hi;
        if (t0 > t1) return null;
      }
      return t0;
    }

    /* Quelle entité le joueur vise-t-il ? La boîte est légèrement élargie
       pour rendre la visée un peu indulgente. */
    var AIM_PAD = 0.12;
    function aimedAt(origin, dir, reach) {
      var best = null, bestT = Infinity;
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (e.type === 'item' || e.type === 'arrow' || e.dead) continue;
        var hw = e.w / 2 + AIM_PAD;
        var t = rayBox(origin, dir,
          e.pos.x - hw, e.pos.y - AIM_PAD, e.pos.z - hw,
          e.pos.x + hw, e.pos.y + e.h + AIM_PAD, e.pos.z + hw);
        if (t === null || t > reach) continue;
        if (t < bestT) { bestT = t; best = e; }
      }
      return best;
    }

    function countOf(type) {
      var n = 0;
      for (var i = 0; i < list.length; i++) if (list[i].type === type) n++;
      return n;
    }

    /* Apparition : zombies la nuit, animaux et villageois le jour.
       Toujours hors de vue immédiate du joueur, sur un sol valide. */
    /* Éveille le gardien d'un donjon au centre de sa salle. Un seul à la
       fois : le rappeler tant qu'il vit ne fait rien. */
    /* Les gardes d'une salle : ils s'éveillent quand on y entre, une fois. */
    function invoquerGardes(d, index) {
      var cle = d.id + ':' + index, n = [];
      if (gardesEveilles.has(cle)) return n;
      gardesEveilles.add(cle);
      (d.gardes || []).forEach(function (g) {
        if (g.salle !== index || !SPECS[g.type]) return;
        var e = spawn(g.type, g.x, g.y, g.z, { donjon: d.id, garde: true });
        if (e) n.push(e);
      });
      return n;
    }
    var gardesEveilles = new Set();

    function invoquerGardien(d) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].donjon === d.id && SPECS[list[i].type].boss && !list[i].dead) return null;
      }
      return spawn(d.boss, d.spawn.x, d.spawn.y, d.spawn.z, { donjon: d.id });
    }

    /* Apparition. Le point d'abord : son biome ET son milieu décident de qui
       peut y naître — dans l'eau la faune marine, en l'air les oiseaux, au sol
       le reste. Toujours hors de vue immédiate du joueur. */
    /* Zone de jeu (SPEC-ZONE-002) : une zone qui interdit les apparitions
       hostiles (sûre, ou PvP seul) refuse toute naissance d'une créature
       hostile en son sein — hors ligne comme en ligne, puisque c'est ici,
       dans le module partagé par le client et par server.js, que toute
       apparition passe. Sans zones branchées (monde de test), tout reste
       permis, comme avant cette spec. */
    function apparitionHostileOk(bx, bz) {
      return !world.reglesZoneEn || world.reglesZoneEn(bx, bz).apparitionHostile !== false;
    }
    /* SPEC-ZONE-002 : une zone sûre annule aussi les dégâts qu'un monstre
       inflige à un joueur qui s'y tient (mêlée, piqûre, flèche) — pas
       seulement ses apparitions. On juge au point où se trouve le JOUEUR
       visé : c'est sa protection qui compte, où que se tienne l'agresseur. */
    function degatsMobOk(pos) {
      return !world.reglesZoneEn || world.reglesZoneEn(pos.x, pos.z).degatsMob !== false;
    }
    function trySpawn(player, isNight, rand, limits) {
      var r = rand || Math.random;
      var lim = limits || { zombie: 12, sheep: 8, villager: 4 };

      var ang = r() * Math.PI * 2;
      var dd = 18 + r() * 22;                       // ni sur le joueur, ni trop loin
      var bx = Math.round(player.pos.x + Math.cos(ang) * dd);
      var bz = Math.round(player.pos.z + Math.sin(ang) * dd);

      var nuitHostile = isNight && r() < 0.8;
      var bio = world.biomeAt ? world.biomeAt(bx, bz) : null;
      if (!bio || !MC.Biomes) {
        // monde sans biomes (tests) : la répartition d'origine, au sol
        var t0 = nuitHostile ? 'zombie' : (r() < 0.65 ? 'sheep' : 'villager');
        if (t0 === 'zombie' && !apparitionHostileOk(bx, bz)) return null;
        return naitreAuSol(t0, bx, bz, lim, r);
      }
      var gy = world.groundAt(bx, bz, true);
      if (gy <= 0) return null;
      var eau = C.isWater(world.getBlock(bx, gy + 1, bz));
      var type;
      if (eau) {
        type = MC.Biomes.tirerMob(bio.mobsEau, r());
        if (!type) return null;
        // les noyés ne sortent qu'à la nuit
        if (type === 'drowned' && !isNight) return null;
        if (SPECS[type] && SPECS[type].hostile && !apparitionHostileOk(bx, bz)) return null;
        return naitreDansLEau(type, bx, gy, bz, lim, r);
      }
      if (r() < 0.22) {
        type = MC.Biomes.tirerMob(bio.mobsCiel, r());
        if (type && (!SPECS[type] || !SPECS[type].hostile || apparitionHostileOk(bx, bz))) {
          return naitreEnLAir(type, bx, gy, bz, lim, r);
        }
        if (type) return null;
      }
      type = MC.Biomes.tirerMob(nuitHostile ? bio.mobsNuit : bio.mobsJour, r());
      if (!type) return null;
      if (SPECS[type] && SPECS[type].hostile && !apparitionHostileOk(bx, bz)) return null;
      return naitreAuSol(type, bx, bz, lim, r);
    }

    /* Apparition souterraine (SPEC-SOUTERRAIN-002) : ne se déclenche que si le
       joueur est déjà sous terre (bien en dessous de la surface naturelle),
       et choisit sa créature dans la table du biome souterrain — géode,
       chambre magmatique, grotte luxuriante, grotte engloutie ou abîme —
       d'après MC.Souterrain, qui lit lui-même le biome de surface. */
    function trySpawnSouterrain(player, rand, limits) {
      var r = rand || Math.random;
      if (!MC.Souterrain || !world.heightAt || !world.getBlock) return null;
      var px = Math.round(player.pos.x), pz = Math.round(player.pos.z), py = Math.floor(player.pos.y);
      var surf = world.heightAt(px, pz);
      if (py >= surf - 4) return null;                    // le joueur n'est pas sous terre
      var ang = r() * Math.PI * 2, dd = 8 + r() * 16;
      var bx = Math.round(player.pos.x + Math.cos(ang) * dd);
      var bz = Math.round(player.pos.z + Math.sin(ang) * dd);
      var by = py + Math.floor((r() - 0.5) * 10);
      if (by < 2 || by >= C.WORLD_H - 2) return null;
      if (C.isSolid(world.getBlock(bx, by, bz))) return null;          // il faut un vide
      if (!C.isSolid(world.getBlock(bx, by - 1, bz))) return null;     // un sol sous les pieds
      var bio = world.biomeAt ? world.biomeAt(bx, bz) : null;
      var sId = MC.Souterrain.biomeAt(bio ? bio.id : 'plaines', by, !!(bio && bio.marin));
      var type = MC.Biomes ? MC.Biomes.tirerMob(MC.Souterrain.mobsPour(sId), r()) : null;
      if (!type) return null;
      var s = SPECS[type];
      if (!s || !sousPlafond(type, s, limits || {})) return null;
      if (s.hostile && !apparitionHostileOk(bx, bz)) return null;
      if (P.collides(world, bx + 0.5, by, bz + 0.5, s.w, s.h)) return null;
      return spawn(type, bx + 0.5, by, bz + 0.5, { arme: tirerArme(type, r) || undefined });
    }

    var SOLS_VALIDES = [B.GRASS, B.SAND, B.DIRT, B.SNOW, B.RED_SAND, B.MYCELIUM, B.GRAVEL, B.STONE];
    function naitreAuSol(type, bx, bz, lim, r) {
      var s = SPECS[type];
      if (!s || !sousPlafond(type, s, lim)) return null;
      var gy = world.groundAt(bx, bz, true);
      if (gy <= 0) return null;
      if (SOLS_VALIDES.indexOf(world.getBlock(bx, gy, bz)) < 0) return null;
      if (gy < C.SEA_LEVEL) return null;             // pas sous l'eau
      if (P.collides(world, bx + 0.5, gy + 1, bz + 0.5, s.w, s.h)) return null;
      return spawn(type, bx + 0.5, gy + 1, bz + 0.5, { arme: tirerArme(type, r) || undefined });
    }
    function naitreDansLEau(type, bx, gy, bz, lim, r) {
      var s = SPECS[type];
      if (!s || !sousPlafond(type, s, lim)) return null;
      // une profondeur au hasard dans la colonne d'eau
      var haut = gy + 1;
      while (haut < C.WORLD_H - 1 && C.isWater(world.getBlock(bx, haut + 1, bz))) haut++;
      var y = s.lest ? gy + 1 : gy + 1 + Math.floor(r() * Math.max(1, haut - gy - Math.ceil(s.h)));
      if (P.collides(world, bx + 0.5, y, bz + 0.5, s.w, s.h)) return null;
      return spawn(type, bx + 0.5, y, bz + 0.5, { arme: tirerArme(type, r) || undefined });
    }
    function naitreEnLAir(type, bx, gy, bz, lim, r) {
      var s = SPECS[type];
      if (!s || !sousPlafond(type, s, lim)) return null;
      var y = Math.max(gy, C.SEA_LEVEL) + 3 + Math.floor(r() * 6);
      if (y >= C.WORLD_H - 2) return null;
      if (P.collides(world, bx + 0.5, y, bz + 0.5, s.w, s.h)) return null;
      return spawn(type, bx + 0.5, y, bz + 0.5);
    }

    /* Plafonds : par type quand il est donné, sinon global — `monstres` pour
       tous les hostiles réunis (repli : le plafond zombie), `animaux` pour le
       reste. Les occupants des donjons ne comptent pas : ils ne sont pas nés
       du cycle d'apparition et ne doivent pas l'étouffer. */
    function sousPlafond(type, s, lim) {
      if (lim[type] !== undefined && countOf(type) >= lim[type]) return false;
      var n = 0, i, e, se;
      if (s.hostile) {
        var capM = lim.monstres !== undefined ? lim.monstres : lim.zombie;
        if (capM === undefined) return true;
        for (i = 0; i < list.length; i++) {
          e = list[i]; se = SPECS[e.type];
          if (se && se.hostile && !e.donjon) n++;
        }
        return n < capM;
      }
      if (lim[type] !== undefined) return true;
      var famille = s.nageur ? 'marins' : (s.volant ? 'oiseaux' : 'animaux');
      var defaut = { marins: 12, oiseaux: 8, animaux: 8 };
      var cap = lim[famille] !== undefined ? lim[famille] : defaut[famille];
      for (i = 0; i < list.length; i++) {
        e = list[i]; se = SPECS[e.type];
        if (!se || se.hostile || !se.speed || se.npc || se.boss || e.donjon) continue;
        var fe = se.nageur ? 'marins' : (se.volant ? 'oiseaux' : 'animaux');
        if (fe === famille) n++;
      }
      return n < cap;
    }

    /* Au lever du jour les zombies disparaissent, comme ils brûleraient au soleil. */
    function burnUndead(isNight) {
      if (isNight) return 0;
      var n = 0;
      for (var i = list.length - 1; i >= 0; i--) {
        var s = SPECS[list[i].type];
        // sous terre, un donjon protège ses occupants du soleil
        if (s && s.brule && !list[i].donjon) { remove(list[i]); n++; }
      }
      return n;
    }

    return {
      list: list, SPECS: SPECS, spawn: spawn, REPRO: REPRO, dropItem: dropItem, remove: remove,
      damage: damage, update: update, mergeItems: mergeItems, aimedAt: aimedAt, rayBox: rayBox,
      tirer: tirer, stepArrow: stepArrow, capVers: capVers,
      separer: separer, separerEntites: separerEntites, ecarter: ecarter,
      countOf: countOf, trySpawn: trySpawn, trySpawnSouterrain: trySpawnSouterrain, burnUndead: burnUndead, stepBody: stepBody,
      stepAI: stepAI, evenements: evenements, choisirCible: choisirCible, voitCible: voitCible, viser: viser,
      sbires: sbires, sousPlafond: sousPlafond, zoneChargee: zoneChargee, stepFaune: stepFaune,
      tirerArme: tirerArme, degatsAvecArme: degatsAvecArme, tirDe: tirDe,
      invoquerGardien: invoquerGardien, invoquerGardes: invoquerGardes,
    };
  }

  MC.createEntities = createEntities;
  MC.EntitySpecs = SPECS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
