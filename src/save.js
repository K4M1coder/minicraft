/* save.js — sérialisation de la partie. Le stockage est injecté (localStorage
   dans le navigateur, un objet factice dans les tests) : la logique reste pure. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var KEY = 'minicraft.save.v1';
  /* v2 : blocs et objets sur un seul octet (128..255 = objets).
     v3 (SPEC-SAVE-017) : blocs sur 16 bits, objets décalés à MC.Core.FIRST_ITEM,
     et chaque override de bloc porte en plus son état (orientation, niveau…). */
  var VERSION = 3;

  /* On ne sauvegarde QUE les blocs modifiés par le joueur, pas les chunks :
     le terrain est reproductible depuis la graine, donc le delta suffit et
     la sauvegarde reste minuscule. */
  function serialize(state) {
    var over = [];
    state.world.overrides.forEach(function (id, k) {
      var p = k.split(',');
      over.push([+p[0], +p[1], +p[2], id]);
    });
    /* États de bloc (SPEC-SAVE-017) : une liste À PART des overrides — poser
       un état ne pose pas forcément un bloc (le bloc peut avoir été là avant
       ce lot), donc le coupler à `overrides` en aurait perdu au chargement. */
    var etats = [];
    if (state.world.etatsOverrides) {
      state.world.etatsOverrides.forEach(function (etat, k) {
        var p = k.split(',');
        etats.push([+p[0], +p[1], +p[2], etat]);
      });
    }
    var crops = [];
    state.world.crops.forEach(function (c) { crops.push([c.x, c.y, c.z, +c.t.toFixed(2)]); });

    var p = state.player.state;
    return {
      v: VERSION,
      seed: state.world.seed,
      time: +state.time.toFixed(1),
      overrides: over,
      etats: etats,
      crops: crops,
      // donjons : gardiens vaincus et coffres déjà pillés ne reviennent pas
      donjons: state.world.donjonsVaincus ? Array.from(state.world.donjonsVaincus) : [],
      pilles: state.world.coffresPilles ? Array.from(state.world.coffresPilles) : [],
      // la carte : ce qu'on a exploré, les repères posés et celui qu'on suit
      explores: state.world.exploration ? state.world.exploration.serialiser() : [],
      reperes: state.world.reperes ? state.world.reperes.serialiser() : [],
      suivi: state.world.reperes && state.world.reperes.suivi ? state.world.reperes.suivi : 0,
      reputation: state.world.reputation ? state.world.reputation.serialiser() : null,
      // SPEC-FACTION-006 à 013 : factions du monde (naissance, relations, jour
      // de simulation) et factions de joueurs (guilde locale) — l'un et
      // l'autre optionnels, pour ne rien changer aux sauvegardes qui datent
      // d'avant ce module.
      politique: state.world.politique && MC.Politique ? MC.Politique.serialiser(state.world.politique) : null,
      guildes: state.guildes && MC.Guildes ? MC.Guildes.serialiser(state.guildes) : null,
      // L45 : prix dynamiques, trésors de lieux, métiers — optionnel, absent
      // sur une ancienne sauvegarde (un état neuf est créé paresseusement)
      economie: state.economie && MC.Economie ? MC.Economie.serialiser(state.economie) : null,
      // le compte en banque, commun à toutes les banques du monde
      banque: state.world.banque ? state.world.banque.serialize() : [],
      // les habitants tués, et quand : ils ne ressuscitent pas au chargement
      pnjsMorts: state.world.pnjsMorts ? Array.from(state.world.pnjsMorts.entries()) : [],
      // les redéfinitions de zone d'un administrateur (SPEC-ZONE-004) : la
      // politique elle-même reste un réglage de lancement, jamais rechargée
      zones: state.world.zonesEtat && MC.Zones ? MC.Zones.serialiser(state.world.zonesEtat) : null,
      // l'avancée du récit : chapitre, étape, choix, quêtes — MC.Recits connaît
      // l'archétype ; un état assigné à la main sans champ « archetype » (les
      // anciens tests, ou une manipulation directe de MC.Histoire) reste une
      // épopée, comme avant ce module.
      histoire: state.histoire && MC.Recits ? MC.Recits.serialiser(
                  state.histoire.archetype ? state.histoire : { archetype: 'epopee', histoire: state.histoire })
                : (state.histoire && MC.Histoire ? MC.Histoire.serialiser(state.histoire) : null),
      // les créatures ne sont pas sauvegardées, les véhicules si : on les a construits
      vehicules: state.entities && MC.Vehicules && !state.sansVehiculesLocaux ? MC.Vehicules.serialiser(state.entities) : [],
      // les succès débloqués et leurs compteurs (SPEC-SUCCES-001)
      succes: state.succes ? state.succes.serialiser() : null,
      player: {
        x: +p.pos.x.toFixed(2), y: +p.pos.y.toFixed(2), z: +p.pos.z.toFixed(2),
        yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3),
        hp: p.hp, hunger: p.hunger, air: +p.air.toFixed(1),
        selected: p.selected, flying: !!p.flying,
        inv: p.inv.serialize(),
        // équipement (B1, docs/vague-2/B1.md § 8) : optionnel — absent d'une
        // sauvegarde plus ancienne, rechargé alors comme un équipement vide
        // (comportement d'avant cette section). Aucune montée de VERSION.
        equip: (MC.ContratsV2 && p.equip) ? (function () {
          var out = {};
          MC.ContratsV2.EQUIP_SLOTS.forEach(function (s) { out[s] = MC.ContratsV2.pileVersCase(p.equip[s]); });
          return out;
        })() : undefined,
      },
      // le 3e champ (taille) n'existait pas avant l'armoire/étagère/bibliothèque
      // (SPEC-INTERIEUR-002, tailles différentes d'un coffre) : absent, une
      // vieille sauvegarde recharge comme avant (27, la taille d'un coffre).
      chests: state.chests ? Object.keys(state.chests).map(function (k) {
        return [k, state.chests[k].serialize(), state.chests[k].size];
      }) : [],
      // SPEC-INTERIEUR-002 : ce qu'exposent les présentoirs et les socles.
      expositions: state.expositions ? Object.keys(state.expositions).map(function (k) {
        var s = state.expositions[k];
        return [k, s.id, s.n, s.data || null];
      }) : [],
      // SPEC-INTERIEUR-002 : la réapparition se fixe sur le dernier lit où
      // l'on a dormi — absente tant qu'on n'a jamais dormi (comportement
      // d'avant cette spec : la réapparition suit alors le point d'arrivée).
      spawnPoint: state.spawnPoint || null,
      // SPEC-MECA-001 : distributeurs — même format que les coffres.
      distributeurs: state.distributeurs ? Object.keys(state.distributeurs).map(function (k) {
        return [k, state.distributeurs[k].serialize()];
      }) : [],
      // SPEC-MECA-007 : commande (texte) de chaque bloc de commande.
      commandes: state.world.commandesBloc ? Array.from(state.world.commandesBloc.entries()).map(function (e) {
        var p = e[0].split(',');
        return [+p[0], +p[1], +p[2], e[1]];
      }) : [],
      furnaces: state.furnaces ? Object.keys(state.furnaces).map(function (k) {
        var f = state.furnaces[k];
        return [k, f.input ? [f.input.id, f.input.n] : 0,
                   f.fuel ? [f.fuel.id, f.fuel.n] : 0,
                   f.output ? [f.output.id, f.output.n] : 0,
                   +f.burn.toFixed(2), +f.cook.toFixed(2)];
      }) : [],
    };
  }

  /* ── Identifiants d'objet dans la sauvegarde (SPEC-SAVE-017) ──────────────
     Les ids d'OBJET ont changé deux fois (v1 : dès 64 ; v2 : dès 128 ; v3 :
     dès MC.Core.FIRST_ITEM) ; les ids de BLOC, jamais. Toute renumérotation
     passe donc par UNE fonction, `migrerIdsObjets`, qui applique la
     conversion à TOUS les champs qui portent un id d'objet — y compris ceux
     apparus après la v3 (inutile pour v1/v2, où ils sont absents, mais prêt
     pour une future renumérotation).

     `CHAMPS_IDS` classe chaque champ de `serialize` : une fonction (le champ
     porte des ids d'objet, voici comment les convertir) ou un texte (le
     champ n'en porte aucun, et pourquoi). Un champ ajouté à `serialize` sans
     classement fait échouer un test (`champsNonClasses`) : c'est l'oubli de
     la banque, des soutes et des indices d'enquête (corrigé ici) qu'on
     n'aurait jamais dû pouvoir commettre. */
  function pileIds(p, conv) { if (Array.isArray(p) && typeof p[0] === 'number' && p[0]) p[0] = conv(p[0]); }
  function pilesIds(l, conv) { if (Array.isArray(l)) l.forEach(function (p) { pileIds(p, conv); }); }
  // un champ mal formé (pas un tableau) est laissé tel quel, jamais une exception :
  // un import ne doit pas rejeter toute la partie pour un champ abîmé
  function liste(l) { return Array.isArray(l) ? l : []; }
  // un objet dont les CLÉS sont des ids (stocks de l'économie) : renommées
  function clesIds(o, conv) {
    if (!o || typeof o !== 'object') return o;
    var out = {};
    Object.keys(o).forEach(function (k) {
      var n = +k;
      out[Number.isInteger(n) && n > 0 && String(n) === k ? String(conv(n)) : k] = o[k];
    });
    return out;
  }
  var SANS_ID = 'sans id d\'objet : ';
  var CHAMPS_IDS = {
    v: SANS_ID + 'version du format',
    seed: SANS_ID + 'graine',
    time: SANS_ID + 'heure',
    overrides: SANS_ID + 'ids de BLOC (inchangés d\'une version à l\'autre)',
    etats: SANS_ID + 'états de bloc',
    crops: SANS_ID + 'positions et croissance',
    donjons: SANS_ID + 'identifiants de donjons (textes)',
    pilles: SANS_ID + 'clés de coffres pillés (textes)',
    explores: SANS_ID + 'cases de carte explorées',
    reperes: SANS_ID + 'repères (nom, position, couleur)',
    suivi: SANS_ID + 'repère suivi',
    reputation: SANS_ID + 'valeur par faction',
    politique: SANS_ID + 'factions, relations, annonces (apparu après la v3)',
    guildes: SANS_ID + 'guildes du joueur (apparu après la v3)',
    pnjsMorts: SANS_ID + 'identifiants d\'habitants (textes)',
    zones: SANS_ID + 'régions (apparu après la v3)',
    succes: SANS_ID + 'compteurs par identifiant de succès (textes)',
    spawnPoint: SANS_ID + 'position (apparu après la v3)',
    commandes: SANS_ID + 'texte des blocs de commande (apparu après la v3)',
    // ── porteurs d'ids d'objet ──
    player: function (p, conv) {
      if (!p) return;
      pilesIds(p.inv, conv);
      if (p.equip && typeof p.equip === 'object') Object.keys(p.equip).forEach(function (s) { pileIds(p.equip[s], conv); });
    },
    banque: function (b, conv) { pilesIds(b, conv); },
    chests: function (l, conv) { liste(l).forEach(function (c) { if (c) pilesIds(c[1], conv); }); },
    distributeurs: function (l, conv) { liste(l).forEach(function (c) { if (c) pilesIds(c[1], conv); }); },
    furnaces: function (l, conv) {
      liste(l).forEach(function (f) { if (f) [1, 2, 3].forEach(function (i) { pileIds(f[i], conv); }); });
    },
    // soute : 6e champ de chaque véhicule (MC.Vehicules.serialiser)
    vehicules: function (l, conv) { liste(l).forEach(function (v) { if (Array.isArray(v)) pilesIds(v[5], conv); }); },
    // présentoirs et socles : [clé, id, n, data]
    expositions: function (l, conv) {
      liste(l).forEach(function (e) { if (Array.isArray(e) && typeof e[1] === 'number' && e[1]) e[1] = conv(e[1]); });
    },
    // récit : seuls les indices d'objet d'une enquête portent un id d'objet ;
    // l'épopée ne garde que des clés de chapitres, la colonie des ids de BLOC
    histoire: function (h, conv) {
      var q = h && h.archetype === 'enquete' ? h.enquete : null;
      if (!q || !Array.isArray(q.indices)) return;
      q.indices.forEach(function (ind) {
        if (ind && ind.type === 'objet' && typeof ind.objet === 'number') ind.objet = conv(ind.objet);
      });
    },
    // économie (apparue après la v3) : stocks et minerai indexés par id d'objet
    economie: function (eco, conv) {
      if (!eco || !Array.isArray(eco.lieux)) return;
      eco.lieux.forEach(function (e) {
        var L = Array.isArray(e) ? e[1] : null;
        if (!L) return;
        if (L.stocks) L.stocks = clesIds(L.stocks, conv);
        if (L.minerai) L.minerai = clesIds(L.minerai, conv);
      });
    },
  };
  // champs de `player` : seuls `inv` et `equip` portent des ids d'objet
  var CHAMPS_JOUEUR = { x: 1, y: 1, z: 1, yaw: 1, pitch: 1, hp: 1, hunger: 1, air: 1, selected: 1, flying: 1,
                        inv: 'objets', equip: 'objets' };

  /* Applique `conv(id)` à chaque id d'objet de la sauvegarde `data` (en place). */
  function migrerIdsObjets(data, conv) {
    Object.keys(CHAMPS_IDS).forEach(function (k) {
      if (typeof CHAMPS_IDS[k] === 'function' && data[k] != null) CHAMPS_IDS[k](data[k], conv);
    });
    return data;
  }
  /* Champs de `data` (et de `data.player`) absents du classement. Conçu pour
     la SORTIE de `serialize` (format courant) : c'est elle que le test de
     classement lui passe ; une sauvegarde ancienne ou forgée n'a pas à y
     être soumise. */
  function champsNonClasses(data) {
    var manquants = Object.keys(data || {}).filter(function (k) { return !CHAMPS_IDS.hasOwnProperty(k); });
    if (data && data.player && typeof data.player === 'object') {
      Object.keys(data.player).forEach(function (k) {
        if (!CHAMPS_JOUEUR.hasOwnProperty(k)) manquants.push('player.' + k);
      });
    }
    return manquants;
  }

  /* Version 1 : les objets commençaient à l'id 64. Ils ont été décalés vers
     128 pour laisser la place à de nouveaux blocs. Étape intermédiaire :
     produit une sauvegarde v2 (128..255), que migrerV2 convertit ensuite
     vers le nouvel espace 16 bits. Idempotente : sans effet sur une
     sauvegarde qui n'est pas v1, et ne convertit que l'ancien espace
     d'objets (64..127). */
  function migrerV1(data) {
    if (!data || data.v !== 1) return data;
    var dec = MC.Core.DECALAGE_OBJETS_V1;
    migrerIdsObjets(data, function (v) { return v >= dec && v < MC.Core.ANCIEN_FIRST_ITEM ? v + dec : v; });
    data.v = 2;
    return data;
  }

  /* Version 2 : format 8 bits, objets 128..255 (SPEC-SAVE-017). Les blocs ne
     bougent pas (1..127, inchangés dans le nouvel espace) ; tous les objets
     (inventaire, coffres, fours, banque, soutes, indices d'enquête…) sont
     décalés vers MC.Core.FIRST_ITEM. Une sauvegarde de ce format n'a jamais
     connu d'état de bloc : `etats` est simplement absent (aucun état).
     Idempotente : sans effet sur une sauvegarde qui n'est pas v2 (une v3
     peut porter le bloc 200, ancien id de la carte), et ne convertit que
     l'ancien espace d'objets (128..255). */
  function migrerV2(data) {
    if (!data || data.v !== 2) return data;
    var ancien = MC.Core.ANCIEN_FIRST_ITEM, off = MC.Core.FIRST_ITEM - ancien;
    migrerIdsObjets(data, function (v) { return v >= ancien && v < 2 * ancien ? v + off : v; });
    data.v = 3;
    return data;
  }

  /* Réinjecte un état sauvegardé. Les overrides sont posés AVANT toute
     génération de chunk : generateChunk les applique ensuite tout seul. */
  function apply(data, state) {
    // migrations sur une copie : la donnée de l'appelant n'est jamais modifiée
    if (data && (data.v === 1 || data.v === 2)) data = JSON.parse(JSON.stringify(data));
    if (data && data.v === 1) data = migrerV1(data);
    if (data && data.v === 2) data = migrerV2(data);
    if (!data || data.v !== VERSION) return false;    // format inconnu : refusé proprement
    var w = state.world;
    w.overrides.clear();
    if (w.etatsOverrides) w.etatsOverrides.clear();
    w.crops.clear();
    (data.overrides || []).forEach(function (o) {
      w.overrides.set(o[0] + ',' + o[1] + ',' + o[2], o[3]);
    });
    if (w.etatsOverrides) {
      (data.etats || []).forEach(function (o) {
        if (o[3]) w.etatsOverrides.set(o[0] + ',' + o[1] + ',' + o[2], o[3]);
      });
    }
    (data.crops || []).forEach(function (c) {
      w.crops.set(c[0] + ',' + c[1] + ',' + c[2], { x: c[0], y: c[1], z: c[2], t: c[3] });
    });
    if (w.donjonsVaincus) {
      w.donjonsVaincus.clear();
      (data.donjons || []).forEach(function (id) { w.donjonsVaincus.add(id); });
    }
    /* `sansVehiculesLocaux` (la page du jeu) : les véhicules appartiennent au SERVEUR
       (SPEC-ARCHI-021) ; une ancienne sauvegarde du navigateur ne doit pas en faire
       apparaître de fantômes dans les entités locales. */
    if (state.entities && MC.Vehicules && !state.sansVehiculesLocaux) {
      // les véhicules de la partie en cours cèdent la place à ceux de la sauvegarde
      state.entities.list.filter(function (e) { return e.vehicule; })
        .forEach(function (e) { state.entities.remove(e); });
      MC.Vehicules.restaurer(state.entities, data.vehicules || []);
    }
    if (w.exploration) w.exploration.charger(data.explores || []);
    if (w.reputation) w.reputation.charger(data.reputation);
    if (w.politique && MC.Politique && data.politique) {
      var pol = MC.Politique.charger(data.politique);
      w.politique.seed = pol.seed; w.politique.jour = pol.jour;
      w.politique.factions = pol.factions; w.politique.relations = pol.relations; w.politique.annonces = pol.annonces;
    }
    if (state.guildes !== undefined && MC.Guildes) state.guildes = MC.Guildes.charger(data.guildes);
    if (state.economie !== undefined && MC.Economie && data.economie) state.economie = MC.Economie.charger(data.economie);
    if (w.banque) w.banque.load(data.banque || []);
    if (w.pnjsMorts) {
      w.pnjsMorts.clear();
      (data.pnjsMorts || []).forEach(function (m) { if (m && typeof m[0] === 'string') w.pnjsMorts.set(m[0], +m[1] || 0); });
    }
    if (w.zonesEtat && MC.Zones && data.zones) MC.Zones.appliquer(w.zonesEtat, data.zones);
    if (MC.Recits) {
      var peutHistoire = function (cat) { return MC.Modes.categoriePermise(state.regles, cat); };
      // une vieille sauvegarde (MC.Histoire.serialiser, sans champ « archetype »)
      // se recharge comme une épopée
      state.histoire = data.histoire
        ? MC.Recits.charger(data.histoire.archetype ? data.histoire : { archetype: 'epopee', histoire: data.histoire }, peutHistoire)
        : null;
    } else if (MC.Histoire) {
      state.histoire = data.histoire ? MC.Histoire.charger(data.histoire, function (cat) {
        return MC.Modes.categoriePermise(state.regles, cat);
      }) : null;
    }
    // les succès : tolère une sauvegarde d'avant ce module (data.succes absent)
    if (state.succes) state.succes.charger(data.succes);
    if (w.reperes) {
      w.reperes.charger(data.reperes || []);
      w.reperes.suivi = data.suivi || null;
    }
    if (w.coffresPilles) {
      w.coffresPilles.clear();
      (data.pilles || []).forEach(function (k) { w.coffresPilles.add(k); });
    }
    // les chunks déjà en mémoire sont invalides : on les jette pour qu'ils
    // soient régénérés avec les overrides
    w.chunks.forEach(function (c) { if (state.disposeChunk) state.disposeChunk(c); });
    w.chunks.clear();

    var p = state.player.state;
    var d = data.player || {};
    p.pos.x = d.x || 0; p.pos.y = d.y || 0; p.pos.z = d.z || 0;
    p.vel.x = p.vel.y = p.vel.z = 0;
    p.yaw = d.yaw || 0; p.pitch = d.pitch || 0;
    p.hp = d.hp === undefined ? 20 : d.hp;
    p.hunger = d.hunger === undefined ? 20 : d.hunger;
    p.air = d.air === undefined ? 10 : d.air;
    p.selected = d.selected || 0;
    p.flying = !!d.flying;
    p.dead = p.hp <= 0;
    if (d.inv) p.inv.load(d.inv);
    // équipement (B1.md § 8) : absent (vieille sauvegarde) → équipement vide,
    // comportement d'avant cette section — aucune conversion d'id ici : elle
    // est faite plus haut, par migrerIdsObjets (CHAMPS_IDS.player).
    if (MC.ContratsV2 && p.equip) {
      var equipCharge = MC.ContratsV2.validerEquip(d.equip || {}) || {};
      MC.ContratsV2.EQUIP_SLOTS.forEach(function (s) {
        p.equip[s] = MC.ContratsV2.caseVersPile(equipCharge[s]);
      });
    }

    state.time = data.time || 0;

    /* Les registres dérivés (lumières) ne passent pas par setBlock lors d'un
       chargement : il faut les reconstruire, sinon les torches posées avant la
       sauvegarde cessent d'éclairer. */
    if (w.rebuildRegistries) w.rebuildRegistries();

    if (state.chests) {
      for (var ck in state.chests) delete state.chests[ck];
      (data.chests || []).forEach(function (c) {
        var inv = MC.Inventory.create(c[2] || 27);
        inv.load(c[1]);
        state.chests[c[0]] = inv;
      });
    }

    // SPEC-INTERIEUR-002 : présentoirs et socles ; absent des vieilles
    // sauvegardes (d'avant cette spec), donc juste vidé dans ce cas.
    if (state.expositions) {
      for (var ek in state.expositions) delete state.expositions[ek];
      (data.expositions || []).forEach(function (e) {
        if (!e || !e[1]) return;
        state.expositions[e[0]] = { id: e[1], n: e[2], data: e[3] || undefined };
      });
    }
    // le point de réapparition ne se fixe que si l'on a dormi au moins une
    // fois ; sinon on laisse game.js retomber sur son comportement d'avant
    // (réapparition au point d'arrivée du joueur).
    state.spawnPoint = data.spawnPoint || state.spawnPoint || null;
    // SPEC-MECA-001 : contenu des distributeurs, même principe que les coffres
    // mais une petite grille de 9 cases.
    if (state.distributeurs) {
      for (var dk in state.distributeurs) delete state.distributeurs[dk];
      (data.distributeurs || []).forEach(function (d) {
        var inv = MC.Inventory.create(9);
        inv.load(d[1]);
        state.distributeurs[d[0]] = inv;
      });
    }
    // SPEC-MECA-007 : la commande (texte) de chaque bloc de commande.
    if (w.commandesBloc) {
      w.commandesBloc.clear();
      (data.commandes || []).forEach(function (c) {
        if (c[3]) w.commandesBloc.set(c[0] + ',' + c[1] + ',' + c[2], String(c[3]).slice(0, 200));
      });
    }

    if (state.furnaces && data.furnaces) {
      for (var k in state.furnaces) delete state.furnaces[k];
      data.furnaces.forEach(function (f) {
        state.furnaces[f[0]] = {
          input: f[1] ? { id: f[1][0], n: f[1][1] } : null,
          fuel: f[2] ? { id: f[2][0], n: f[2][1] } : null,
          output: f[3] ? { id: f[3][0], n: f[3][1] } : null,
          burn: f[4], cook: f[5],
        };
      });
    }
    return true;
  }

  function save(storage, state) {
    try {
      storage.setItem(KEY, JSON.stringify(serialize(state)));
      return true;
    } catch (e) { return false; }
  }
  function load(storage, state) {
    try {
      var raw = storage.getItem(KEY);
      if (!raw) return false;
      return apply(JSON.parse(raw), state);
    } catch (e) { return false; }
  }
  function hasSave(storage) {
    try { return !!storage.getItem(KEY); } catch (e) { return false; }
  }
  function clear(storage) {
    try { storage.removeItem(KEY); return true; } catch (e) { return false; }
  }

  MC.Save = { KEY: KEY, VERSION: VERSION, serialize: serialize, apply: apply,
              migrerV1: migrerV1, migrerV2: migrerV2,
              CHAMPS_IDS: CHAMPS_IDS, migrerIdsObjets: migrerIdsObjets, champsNonClasses: champsNonClasses,
              save: save, load: load, hasSave: hasSave, clear: clear };
})(typeof globalThis !== 'undefined' ? globalThis : this);
