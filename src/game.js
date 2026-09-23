/* game.js — orchestration : boucle, streaming des chunks, machine à états,
   et câblage entre entrées, monde, joueur, entités et interface. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core, P = MC.Physics, Inv = MC.Inventory, DC = MC.DayCycle;
  var B = C.B, I = C.I;

  var GEN_BUDGET = 2, MESH_BUDGET = 2;     // par frame, pour ne pas saccader
  var LOINTAIN_BUDGET = 1200;              // colonnes lointaines échantillonnées par frame
  var SPAWN_INTERVAL = 3.5;

  function createGame(host) {
    var atlas = MC.buildAtlas();
    var render = MC.createRenderer(host, atlas, { renderDist: 6 });
    var canvas = render.renderer.domElement;

    var SEED = 20260921;
    var world = MC.createWorld(SEED);
    var entities = MC.createEntities(world);
    // `world` et `entities` sont reassignes quand on change de partie
    var regles = MC.Modes.regles('survie', 'facile');

    /* Le solo est « une equipe d'un joueur » : meme chemin de code que
       l'ecran partage, donc teste en permanence plutot qu'en cas special. */
    var equipe = [];
    var player = MC.createPlayer(world, entities, regles);
    equipe.push({ index: 0, nom: 'Joueur 1', player: player,
                  source: 'clavier', manette: null, vue: null });
    var manettes = [];

    function joueurPrincipal() { return equipe[0].player; }
    var furnaces = Object.create(null);
    var chests = Object.create(null);
    var audio = MC.createAudio();
    var chat = MC.Chat.creer();

    /* Client reseau. Nul tant qu on joue en solo : le jeu fonctionne
       exactement pareil, le reseau n est qu une couche en plus. */
    var net = MC.createNetClient({
      onBienvenue: function (m) {
        // le serveur fait autorite sur la graine : on rebatit le monde
        if (m.graine !== world.seed) {
          /* Le message promettait une reconstruction qui n'avait pas lieu :
             le client gardait SON terrain, le serveur le sien, et les blocs
             échangés tombaient sur un relief qui n'était pas le bon. */
          remplacerMonde(m.graine);
          composerEquipe(equipe.length || 1, regles);
          ui.toast('Graine du serveur : ' + m.graine + ' — monde reconstruit');
        }
        g.time = m.heure || 0;
        (m.blocs || []).forEach(function (b) {
          var cx = Math.floor(b[0] / 16), cz = Math.floor(b[2] / 16);
          world.getChunk(cx, cz, true);
          world.setBlock(b[0], b[1], b[2], b[3]);
        });
        (m.chat || []).forEach(function (c) { chat.recevoir(c); });
        chat.systeme('Connecte au serveur (' + (m.joueurs || []).length + ' autre(s) joueur(s))');
      },
      onBloc: function (x, y, z, id) {
        // autorite serveur : on applique sans discuter, meme si l on avait
        // predit autre chose localement
        /* Chunk absent : on le génère pour y appliquer le bloc. L'ignorer
           perdait la modification — on retrouvait plus tard un terrain qui
           ne correspondait plus à celui du serveur (blocs fantômes). */
        var cx = Math.floor(x / 16), cz = Math.floor(z / 16);
        world.getChunk(cx, cz, true);
        world.setBlock(x, y, z, id);
      },
      onChat: function (m) { chat.recevoir(m); },
      onArrive: function (m) { chat.systeme(m.nom + ' a rejoint'); },
      onQuitte: function (m) { chat.systeme((m.nom || 'Un joueur') + ' est parti'); },
      onEtat: function (m) { if (typeof m.heure === 'number') g.time = m.heure; },
      /* Le serveur fait autorité : pour chacun de nos joueurs, on adopte sa
         position et ses statistiques, puis on rejoue les entrées qu'il n'a
         pas encore traitées (voir synchro.js). */
      onToi: function (liste) {
        for (var i = 0; i < liste.length; i++) {
          var j = equipe[i];
          if (!j || !j.prediction) continue;
          var ecart = MC.Synchro.reconcilier(j.player, liste[i], j.prediction);
          g.ecartReseau = ecart;
          var st = j.player.state, etaitMort = st.dead;
          MC.Synchro.appliquerStats(st, liste[i]);
          if (i === 0 && st.dead && !etaitMort && input.state === 'playing') {
            audio.play('mort'); input.setState('dead');
          }
        }
      },
      // le butin ramassé côté serveur arrive dans notre inventaire
      onDonne: function (m) {
        var j = equipe[m.j] || equipe[0];
        var reste = j.player.pickUp(m.id, m.n);
        if (!reste && m.j === 0) { ui.toast('+' + m.n + ' ' + C.nameOf(m.id)); audio.play('ramasser'); }
      },
      onStatut: function (e, info) {
        if (e === 'en ligne') ui.toast('En ligne');
        else if (e === 'erreur') ui.toast('Reseau : ' + (info || 'erreur'), 'warn');
        else if (e === 'hors ligne' && info) {
          ui.toast('Reseau : ' + info + ' — retour en solo', 'warn');
          chat.systeme('Connexion perdue. La partie continue en solo.');
        }
      },
    });

    // registre d'affichage du HUD (SPEC-HUD-001) : conservé d'une partie à
    // l'autre via localStorage, quand il est disponible
    var hudStockage = (function () { try { return window.localStorage; } catch (e) { return null; } })();
    var hud = MC.Hud.creerRegistre(hudStockage);

    var g = {
      world: world, entities: entities, player: player, render: render,
      time: 60, fps: 0, furnaces: furnaces, chests: chests, audio: audio, chat: chat,
      equipe: equipe, regles: regles, vues: [], nbLocaux: 1, net: net, hud: hud,
      disposeChunk: render.disposeChunk,
    };

    var ui = MC.createUI(host, atlas, {
      onSelectSlot: selectSlot,
      onPlay: startGame,
      onResume: resume,
      onSave: function () { doSave(true); },
      onQuit: toMenu,
      onRespawn: respawn,
      onSound: function (n) { audio.play(n); },
      onNouvelle: function () { ui.menuNouvelle(); },
      onMulti: function () { ui.menuMulti({ pseudo: g.nomJoueur }); },
      onRetourMenu: function () { afficherMenu(); },
      onContinuerFin: function () { continuerApresFin(); },
      onCharger: chargerPartie,
      onSupprimer: supprimerPartie,
      onCreer: creerPartie,
      onRejoindre: rejoindreServeur,
    }, hud);

    var input = MC.createInput(canvas, {
      onLook: function (dyaw, dpitch) {
        var s = player.state;
        s.yaw += dyaw;
        s.pitch += dpitch;
        var lim = Math.PI / 2 - 0.001;
        s.pitch = Math.max(-lim, Math.min(lim, s.pitch));
      },
      onAttack: onAttack,
      onUse: onUse,
      onScroll: function (d) {
        selectSlot((player.state.selected + d + Inv.HOTBAR_SIZE) % Inv.HOTBAR_SIZE);
      },
      onSelectSlot: selectSlot,
      onToggleFly: function () {
        player.state.flying = !player.state.flying;
        player.state.vel.y = 0;
        ui.toast(player.state.flying ? 'Vol activé' : 'Vol désactivé');
      },
      onKey: onKey,
      onSaisieTouche: function (k) {
        // input.EFFACE signale un retour arriere ; tout autre caractere s'ajoute
        if (k === input.EFFACE) chat.saisie = chat.saisie.slice(0, -1);
        else chat.saisie = chat.saisie + k;
      },
      onSaisieValider: function () {
        var m = chat.valider(g.nomJoueur || 'Joueur');
        input.setSaisie(false);
        if (m) traiterMessage(m);
      },
      onSaisieAnnuler: function () { chat.annuler(); input.setSaisie(false); },
      onKeyAnyState: onKeyAnyState,
      onEscape: onEscape,
      onState: onStateChange,
      onLockError: function (msg) {
        ui.setLockHint('La capture de la souris a été refusée (' + msg +
                       '). Cliquez à nouveau — le navigateur impose un court délai après Échap.');
      },
      onLockGained: function () { ui.setLockHint(''); },
    });
    g.input = input;
    g.ui = ui;

    // ─── états ───────────────────────────────────────────────────────────────
    function onStateChange(next) {
      if (next === 'playing') { ui.hideScreen(); }
      else if (next === 'paused') {
        ui.menuPause({
          nom: g.nomPartie, graine: world.seed,
          mode: regles.mode.nom, difficulte: regles.difficulte.nom,
          enLigne: net.enLigne(),
        });
      }
      else if (next === 'menu') { afficherMenu(); }
      else if (next === 'dead') { ui.ecranMort(); }
      if (next !== 'ui' && ui.isContainerOpen()) forceCloseContainer();
    }

    /* Le menu est le seul point d entree : creer, charger, supprimer,
       rejoindre. Toute la logique de persistance vit dans Saves ; ici on ne
       fait que du cablage. */
    function afficherMenu() {
      var st = storage();
      ui.menuParties(st ? MC.Saves.lister(st) : []);
    }
    g.afficherMenu = afficherMenu;

    function appliquerPartie(meta) {
      g.partieId = meta.id;
      g.nomPartie = meta.nom;
      regles = MC.Modes.regles(meta.mode, meta.difficulte, meta.histoire);
      g.regles = regles;
      ui.setRegles(regles);
      g.graine = meta.graine;
      // une partie créée avant SPEC-HUD-002 n'a pas ce champ dans ses métadonnées
      g.versionCarte = meta.versionCarte === undefined ? 'inconnue' : meta.versionCarte;
    }

    function creerPartie(opts) {
      var st = storage();
      if (!st) { ui.toast('Stockage indisponible', 'warn'); return; }
      var graine = MC.Modes.graineDepuisTexte(opts.graineTexte);
      var meta = MC.Saves.creer(st, {
        nom: opts.nom, mode: opts.mode, difficulte: opts.difficulte, graine: graine,
        histoire: opts.mode === 'histoire' ? MC.Histoire.parametres(opts.histoire) : null,
      });
      g.histoire = null;
      appliquerPartie(meta);
      // le monde doit repartir de la bonne graine
      remplacerMonde(meta.graine);
      for (var k in furnaces) delete furnaces[k];
      for (var k2 in chests) delete chests[k2];
      g.time = 60;
      composerEquipe(opts.joueurs || 1, regles);
      chat.vider();
      chat.systeme('Nouvelle partie « ' + meta.nom + ' » — graine ' + meta.graine);
      ui.toast('Partie créée');
      input.setState('playing');
      if (meta.mode === 'histoire') demarrerHistoire(meta.histoire || MC.Histoire.parametres({}));
    }

    g.creerPartie = creerPartie;

    function chargerPartie(id) {
      var st = storage();
      if (!st) return;
      var meta = MC.Saves.trouver(st, id);
      if (!meta) { ui.toast('Partie introuvable', 'warn'); return; }
      appliquerPartie(meta);
      remplacerMonde(meta.graine);
      var r = MC.Saves.charger(st, id, g);
      if (!r) { ui.toast('Sauvegarde illisible', 'warn'); return; }
      composerEquipe(1, regles);
      if (!r.vierge) {
        // la position sauvegardee prime sur le point d apparition
        var d = g.dernierePosition;
        if (d) { player.state.pos.x = d.x; player.state.pos.y = d.y; player.state.pos.z = d.z; }
      }
      streamChunks(true);
      chat.vider();
      chat.systeme('Partie « ' + meta.nom + ' » chargée — graine ' + meta.graine);
      ui.toast(r.vierge ? 'Nouvelle carte' : 'Partie chargée');
      input.setState('playing');
      if (meta.mode !== 'histoire') g.histoire = null;
      else if (!g.histoire) demarrerHistoire(meta.histoire || MC.Histoire.parametres({}));
      repereObjectif = null;
    }

    function supprimerPartie(id) {
      var st = storage();
      if (!st) return;
      var meta = MC.Saves.trouver(st, id);
      MC.Saves.supprimer(st, id);
      if (g.partieId === id) g.partieId = null;
      ui.toast('« ' + (meta ? meta.nom : 'Partie') + ' » supprimée');
      afficherMenu();
    }

    function rejoindreServeur(opts) {
      g.nomJoueur = opts.pseudo;
      composerEquipe(opts.joueurs || 1, regles);
      equipe.forEach(function (j) { j.prediction = MC.Synchro.creerPrediction(); });
      entities.list.length = 0;              // en ligne, les créatures sont celles du serveur
      input.setState('playing');
      net.connecter(opts.hote, opts.pseudo, opts.joueurs || 1);
    }

    /* Change de monde. L'ANCIEN est libéré d'abord : ses maillages vivent
       dans la scène, pas dans le monde. On appelait jadis reset() sur le
       NOUVEAU monde, encore vide — les chunks de la partie précédente
       restaient affichés, superposés au nouveau terrain : blocs flottants
       qu'on traverse, murs invisibles contre lesquels on bute. */
    function remplacerMonde(graine) {
      world.reset(render.disposeChunk);
      entities.list.length = 0;
      render.libererToutesEntites();
      world = MC.createWorld(graine);
      reconstruireDependances();
      grille = creerGrilleLointaine();
      // les habitants suivis appartenaient à l'ancien monde
      pnjsSuivis.clear();
      return world;
    }
    g.remplacerMonde = remplacerMonde;

    /* Le monde est recree a chaque partie (graine differente) : entites,
       joueur et registres doivent le suivre, sinon ils pointent sur l ancien. */
    /* Relief lointain : une grille de 256 × 256 colonnes, une tous les 8 blocs,
       soit deux kilomètres de côté. Elle suit le monde courant. */
    function creerGrilleLointaine() {
      var w = world;
      return MC.Lointain.creerGrille({ pas: 8, cote: 256,
                                       echantillon: function (x, z) { return w.echantillonLointain(x, z); } });
    }
    var grille = creerGrilleLointaine();

    /* Sommet de chaque colonne, pour la pluie qui s'arrête aux toits et la
       foudre qui épargne qui s'abrite. Mis en cache, vidé chaque seconde : un
       bloc posé ou cassé est pris en compte sans balayer chaque image. */
    var abris = new Map(), abrisT = 0;
    function abri(x, z) {
      var k = x * 73856093 ^ z * 19349663, v = abris.get(k);
      if (v !== undefined) return v;
      v = -1;
      if (world.estCharge(x, z)) {
        for (var y = C.WORLD_H - 1; y > 0; y--) {
          var id = world.getBlock(x, y, z);
          if (!id) continue;
          var d = C.BLOCKS[id];
          if (d && d.plant && !d.aquatique && !C.isLeaves(id)) continue;      // l'herbe ne protège de rien
          v = y; break;
        }
      } else v = world.heightAt(x, z);
      abris.set(k, v);
      return v;
    }
    g.abri = abri;

    /* Météo : même graine, même ciel que le serveur et les autres postes. */
    var meteoT = null;
    function majMeteo(dt) {
      var me = world.meteo;
      if (!me) return;
      dt = dt || 0;
      abrisT += dt;
      if (abrisT > 1) { abrisT = 0; abris.clear(); }
      var et = me.etat(g.time);
      g.meteo = et;
      render.majMeteo(et, me.derive(g.time));
      // ce qui tombe au-dessus du joueur 1, et ce qu'on en entend
      var p1 = player.state.pos, bio = world.biomeAt(Math.floor(p1.x), Math.floor(p1.z));
      var tj = equipe[0] && equipe[0].temperature;
      var tC = tj ? tj.temperature : me.temperature(world.bio.climat(p1.x, p1.z).t, p1.y, g.time, et, bio.id);
      var prec = me.precipitation(p1.x, p1.z, g.time, tC, bio.id, et);
      g.precipitation = prec;
      render.majPrecipitations(dt, prec, et.vent, abri);
      var dehors = abri(Math.floor(p1.x), Math.floor(p1.z)) <= p1.y + 1.8;
      var sousLeau = P.headInWater(world, p1, player.EYE);
      audio.ambiance(prec.forme === 'pluie' ? prec.intensite * (dehors ? 1 : 0.35) * (sousLeau ? 0.2 : 1) : 0,
                     et.vent.force * (dehors ? 1 : 0.4) * (sousLeau ? 0.1 : 1),
                     prec.forme === 'neige' ? prec.intensite : 0);
      // éclairs tombés depuis la dernière image (après un saut d'heure, on ne rattrape pas)
      if (meteoT === null || g.time < meteoT || g.time - meteoT > 5) meteoT = g.time;
      var l = me.eclairs(meteoT, g.time);
      meteoT = g.time;
      var pc = player.state.pos;
      l.forEach(function (e) {
        var lieu = me.lieuEclair(e, pc.x, pc.z);
        var ySol = world.estCharge(lieu.x, lieu.z) ? world.groundAt(lieu.x, lieu.z) : world.heightAt(lieu.x, lieu.z);
        render.eclair(lieu.x, ySol + 1, lieu.z, e.force);
        g.eclairs = (g.eclairs || 0) + 1;
        audio.tonnerre(Math.hypot(lieu.x - pc.x, lieu.z - pc.z), e.force);
        /* La foudre blesse qui se tient à découvert tout près — en ligne,
           c'est au serveur d'en décider, comme de tous les dégâts. */
        if (!net.enLigne()) {
          equipe.forEach(function (j) {
            var st = j.player.state;
            if (!st.dead && me.foudroie(lieu, st.pos, abri)) {
              j.player.hurt(me.DEGATS_FOUDRE);
              if (j.index === 0) { ui.toast('Foudroyé !'); audio.play('blesse'); }
            }
          });
          entities.list.forEach(function (en) {
            if (en.kind === 'item' || !en.pos) return;
            if (me.foudroie(lieu, en.pos, abri)) entities.damage(en, 8, null, null);
          });
        }
        if (g.surEclair) g.surEclair(e, lieu, ySol);
      });
    }

    // ─── habitants, métiers et lieux ─────────────────────────────────────────
    var pnjsSuivis = new Map(), pnjT = 0, lieuActuel = null;
    function ouvrirBanque() {
      if (!world.banque) return;
      ui.openContainer('chest', player.state.inv, world.banque, 'banque');
      input.setState('ui');
    }
    function rendreService(service, ent) {
      var st = player.state;
      var r = MC.Habitats.servir(service, {
        inv: st.inv, etat: st, temps: g.time, dureeJour: DC.DAY_LENGTH, estNuit: DC.isNight(g.time),
        habitats: world.habitats, reperes: world.reperes, x: st.pos.x, z: st.pos.z,
        lieu: world.habitats ? world.habitats.lieuA(Math.floor(st.pos.x), Math.floor(st.pos.z)) : null,
        pvMax: player.MAX_HP || 20,
      });
      if (r.temps !== undefined && !net.enLigne()) g.time = r.temps;
      if (r.ouvrir === 'banque') ouvrirBanque();
      return r;
    }
    g.rendreService = rendreService;
    /* Parler à un habitant : son métier décide du titre, de la réplique, des
       offres et du service proposé. Un village hostile ne commerce plus. */
    function parlerA(ent) {
      if (g.histoire && !g.histoire.fin && parlerHistoire(ent)) return;
      if (world.reputation && !MC.Factions.commerceOuvert(world.reputation)) {
        ui.toast('Les villageois refusent de commercer avec vous', 'warn');
        return;
      }
      MC.Factions.surEchange(world.reputation);
      // un villageois né dans la campagne, sans métier, garde ses échanges d'origine
      var role = ent.role ? (MC.Habitats.ROLES[ent.role] || MC.Habitats.ROLES.habitant)
                          : { nom: 'Villageois', service: null, offres: Inv.TRADES, repliques: ['Bonjour, voyageur.'] };
      var LIBELLES = { info: 'Indiquez-moi les environs', banque: 'Ouvrir mon compte', repos: 'Se reposer (1 émeraude)',
                       reparer: 'Réparer l\'outil en main', detente: 'Profiter du spectacle' };
      var h = ((ent.eid || 0) * 7 + Math.floor(g.time / 20)) % role.repliques.length;
      var opts = {
        titre: role.nom + (ent.nom ? ' — ' + ent.nom : ''),
        villageois: !ent.role,
        replique: role.repliques[h],
        offres: role.offres,
        services: role.service ? [{ id: role.service, libelle: LIBELLES[role.service] }] : [],
        onService: function (id) {
          var r = rendreService(id, ent);
          ui.toast(r.message, r.ok ? null : 'warn');
          if (r.ok && id === 'info' && chat) chat.systeme(r.message);
          return r;
        },
      };
      g.dernierDialogue = { role: ent.role || 'habitant', nom: ent.nom, service: role.service };
      ui.openContainer('trade', player.state.inv, opts, ent.eid);
      input.setState('ui');
    }
    g.parlerA = parlerA;

    /* Les habitants des lieux proches apparaissent quand leur coin est chargé.
       Un habitant tué ne renaît pas de la partie. Hors ligne seulement : en
       ligne, c'est le serveur qui les fait vivre. */
    function peuplerLieux(dt) {
      if (!world.habitats || net.enLigne()) return;
      pnjT -= dt;
      if (pnjT > 0) return;
      pnjT = 1;
      /* Qui a disparu depuis la dernière fois ? S'il est tombé sous les coups,
         il est mort ; sinon (liste vidée par une nouvelle partie), on l'oublie. */
      pnjsSuivis.forEach(function (e, id) {
        if (entities.list.indexOf(e) >= 0) return;
        if (e.hp <= 0) world.pnjsMorts.set(id, g.time);
        pnjsSuivis.delete(id);
      });
      var lieux = [];
      equipe.forEach(function (j) {
        var p = j.player.state.pos;
        world.habitats.lieuxProches(p.x, p.z, 90).forEach(function (l) { if (lieux.indexOf(l) < 0) lieux.push(l); });
      });
      MC.Habitats.pnjsManquants(lieux, entities.list, world.pnjsMorts, g.time).forEach(function (p) {
        if (!world.estCharge(p.x, p.z)) return;
        var e = entities.spawn('villager', p.x, p.y + 0.05, p.z,
                               { pnj: p.id, role: p.role, nom: p.nom, foyer: { x: p.x, z: p.z }, lieu: p.lieu });
        pnjsSuivis.set(p.id, e);
      });
    }
    g.peuplerLieux = peuplerLieux;
    // ─── mode histoire ───────────────────────────────────────────────────────
    var histoireT = 0, choixAffiche = null, fileRecit = [], repereObjectif = null;
    function peutCategorie(cat) { return MC.Modes.categoriePermise(regles, cat); }
    /* Démarre le récit : il se lie aux lieux réels autour du départ, et le
       héros s'éveille sur la place de son village. */
    function demarrerHistoire(params) {
      var s = player.state;
      var liens = MC.Histoire.lier(world, s.pos.x, s.pos.z);
      g.histoire = MC.Histoire.creer(params, liens, peutCategorie);
      fileRecit.length = 0; choixAffiche = null; repereObjectif = null;
      if (liens.depart) {
        var px = Math.floor(liens.depart.x), pz = Math.floor(liens.depart.z) + 3;
        s.pos.x = px + 0.5; s.pos.z = pz + 0.5; s.pos.y = C.WORLD_H - 2;
        s.vel.x = s.vel.y = s.vel.z = 0;
        streamChunks(true);
        s.pos.y = world.groundAt(px, pz, true) + 1.2;
        g.spawnPoint = { x: s.pos.x, y: s.pos.y, z: s.pos.z };
      }
      presenter(MC.Histoire.commencer(g.histoire));
      return g.histoire;
    }
    g.demarrerHistoire = demarrerHistoire;
    function signalerHistoire(ev, ctx) {
      if (!g.histoire || g.histoire.fin) return [];
      ev.t = g.time;
      var n = MC.Histoire.signaler(g.histoire, ev, ctx);
      presenter(n);
      return n;
    }
    g.signalerHistoire = signalerHistoire;
    function compteur() { var inv = player.state.inv; return { compter: function (id) { return inv.count(id); } }; }
    /* Ce que le moteur demande : raconter, donner, prendre, faire apparaître. */
    function presenter(notifs) {
      (notifs || []).forEach(function (n) {
        switch (n.type) {
          case 'chapitre': fileRecit.push({ titre: n.titre, texte: n.texte }); chat.systeme('— ' + n.titre + ' —'); break;
          case 'dialogue': fileRecit.push({ titre: n.titre, texte: n.texte }); break;
          case 'evenement': fileRecit.push({ titre: n.titre, texte: n.texte }); faireApparaitre(n); break;
          case 'etape': ui.toast(n.texte); audio.play('craft'); break;
          case 'quete': ui.toast(n.texte); audio.play('echange'); break;
          case 'info': ui.toast(n.texte); break;
          case 'echec': ui.toast(n.texte, 'warn'); break;
          case 'recompense':
            n.objets.forEach(function (o) {
              var reste = player.pickUp(o.id, o.n);
              if (reste) entities.dropItem(player.state.pos.x, player.state.pos.y + 0.5, player.state.pos.z, o.id, reste);
              ui.toast('Récompense : ' + o.n + ' ' + C.nameOf(o.id));
            });
            break;
          case 'prendre': {
            var inv = player.state.inv, reste2 = n.objets[0].n;
            (n.parmi || [n.objets[0].id]).forEach(function (id) {
              var k = Math.min(reste2, inv.count(id));
              if (k > 0) { inv.remove(id, k); reste2 -= k; }
            });
            break;
          }
          case 'fin': finHistoire(n); break;
        }
      });
      afficherRecit();
    }
    function fermerRecit() {
      if (!ui.dialogueOuvert() && input.state === 'ui' && !ui.isContainerOpen()) input.setState('playing');
    }
    /* Une réplique à la fois ; puis, s'il y en a un, le choix en attente. */
    function afficherRecit() {
      if (!g.histoire || ui.dialogueOuvert() || input.state === 'menu' || input.state === 'dead') return;
      var d = fileRecit.shift();
      if (d) {
        if (ui.isContainerOpen()) forceCloseContainer();
        input.setState('ui');
        ui.dialogueHistoire(d, function () { afficherRecit(); fermerRecit(); });
        return;
      }
      var c = MC.Histoire.choixEnAttente(g.histoire);
      if (c && choixAffiche !== c.id) {
        choixAffiche = c.id;
        if (ui.isContainerOpen()) forceCloseContainer();
        input.setState('ui');
        ui.dialogueHistoire({ titre: 'Votre choix', texte: c.texte,
                              choix: c.options.map(function (o) { return { id: o.id, texte: o.texte }; }) },
                            function (opt) {
                              choixAffiche = null;
                              presenter(MC.Histoire.choisir(g.histoire, c.id, opt));
                              fermerRecit();
                            });
      }
    }
    // les créatures d'un événement : autour du joueur, ou autour du village de départ
    function faireApparaitre(n) {
      var ctr = n.pres && n.pres !== 'joueur' && world.estCharge(n.pres.x, n.pres.z) ? n.pres : player.state.pos;
      (n.apparitions || []).forEach(function (a, ia) {
        for (var k = 0; k < a.n; k++) {
          var ang = (k + ia * 3) * 2.1, d = 8 + (k % 3) * 3;
          var x = Math.floor(ctr.x + Math.cos(ang) * d), z = Math.floor(ctr.z + Math.sin(ang) * d);
          if (!world.estCharge(x, z)) continue;
          var y = world.groundAt(x, z, true) + 1;
          entities.spawn(a.type, x + 0.5, y, z + 0.5, a.role ? { role: a.role, nom: 'le caravanier' } : { histoire: n.id });
        }
      });
    }
    /* Parler à un habitant pendant le récit : l'histoire d'abord, puis ses
       quêtes, et le commerce seulement si l'histoire l'autorise. */
    function parlerHistoire(ent) {
      var H = MC.Histoire, h = g.histoire, role = ent.role || 'habitant';
      var R0 = MC.Habitats.ROLES[role] || MC.Habitats.ROLES.habitant;
      var nom = R0.nom + (ent.nom ? ' — ' + ent.nom : '');
      var n1 = signalerHistoire({ type: 'parler', role: role, lieu: ent.lieu, nom: nom }, compteur());
      if (n1.some(function (n) { return n.type === 'dialogue' || n.type === 'info' || n.type === 'etape'; })) return true;
      var n2 = H.rendreQuete(h, role, compteur());
      if (n2.some(function (n) { return n.type === 'quete'; })) { presenter(n2); return true; }
      var q = H.queteProposee(h, role);
      if (q) {
        input.setState('ui');
        ui.dialogueHistoire({ titre: nom, texte: q.texte + ' — « ' + q.titre + ' »',
                              choix: [{ id: 'oui', texte: 'Accepter la quête' }, { id: 'non', texte: 'Refuser' }] },
                            function (c) {
                              if (c === 'oui' && H.accepter(h, q.id)) { ui.toast('Quête acceptée : ' + q.titre); chat.systeme('Quête : ' + q.titre); }
                              fermerRecit();
                            });
        return true;
      }
      if (n2.length) { presenter(n2); return true; }
      if (!regles.commerce) {
        input.setState('ui');
        ui.dialogueHistoire({ titre: nom, texte: R0.repliques[(ent.eid || 0) % R0.repliques.length] }, fermerRecit);
        return true;
      }
      return false;
    }
    function finHistoire(n) {
      var h = g.histoire;
      var stats = h ? 'Quêtes secondaires : ' + h.secondairesFaites + '/' + h.secondairesPrevues +
                      ' · Chapitres : ' + Math.min(h.chap + 1, h.chapitres.length) + '/' + h.chapitres.length : '';
      g.finHistoire = n;
      chat.systeme('Fin : ' + n.titre);
      ui.objectifHistoire(null);
      forceCloseContainer();
      input.setState('menu');
      ui.ecranFin(n, stats);
      if (g.partieId) doSave(false);
    }
    function continuerApresFin() {
      if (g.partieId) input.setState('playing');
      else afficherMenu();
    }
    /* Deux fois par seconde : où l'on est, ce qu'on porte, l'heure, le ciel. */
    function majHistoire(dt) {
      if (!g.histoire || net.enLigne()) { ui.objectifHistoire(null); return; }
      var h = g.histoire, s = player.state;
      if (!h.fin) ui.objectifHistoire(MC.Histoire.objectif(h), s.pos);
      histoireT -= dt;
      if (histoireT > 0 || h.fin) return;
      histoireT = 0.5;
      signalerHistoire({ type: 'position', x: s.pos.x, z: s.pos.z });
      signalerHistoire({ type: 'biome', id: world.biomeAt(Math.floor(s.pos.x), Math.floor(s.pos.z)).id });
      signalerHistoire({ type: 'inventaire' }, compteur());
      signalerHistoire({ type: 'temps', nuit: DC.isNight(g.time) });
      if (g.meteo) signalerHistoire({ type: 'meteo', meteo: g.meteo.type });
      // le repère de l'objectif, suivi par la boussole
      var o = MC.Histoire.objectif(h);
      if (world.reperes && h.params.reperes) {
        var cible = o && o.cible;
        if (repereObjectif && (!cible || repereObjectif.x !== Math.round(cible.x) || repereObjectif.z !== Math.round(cible.z))) {
          world.reperes.retirer(repereObjectif.id); repereObjectif = null;
        }
        if (cible && !repereObjectif) {
          repereObjectif = world.reperes.ajouter('★ ' + cible.nom, cible.x, cible.z, '#e8c040');
          world.reperes.suivi = repereObjectif.id;
        }
      }
      afficherRecit();
    }

    // entrer dans un lieu : on l'annonce
    function annoncerLieu() {
      if (!world.habitats) return;
      var p = player.state.pos;
      var l = world.habitats.lieuA(Math.floor(p.x), Math.floor(p.z));
      if (l !== lieuActuel) {
        lieuActuel = l;
        g.lieu = l;
        if (l) ui.toast('Bienvenue à ' + l.nom + ' — ' + MC.Habitats.LIEUX[l.kind].nom.toLowerCase() + ', ' + l.style.toLowerCase());
        if (l && g.histoire) signalerHistoire({ type: 'lieu', id: l.id });
      }
    }

    /* Distance de vue : réévaluée toutes les deux secondes selon la fluidité. */
    var vueT = 0;
    function ajusterVue(dt) {
      vueT += dt;
      if (vueT < 2) return;
      vueT = 0;
      var r = MC.Lointain.ajusterDistance(render.RENDER_DIST, g.fps, g.enAttente || 0);
      if (r !== render.RENDER_DIST) render.setDistance(r);
    }

    function reconstruireDependances() {
      entities = MC.createEntities(world);
      g.world = world;
      g.entities = entities;
    }

    function storage() {
      try { return window.localStorage; } catch (e) { return null; }
    }

    function resume() {
      audio.resume();      // l'audio n'est autorisé qu'après un geste utilisateur
      if (player.state.dead) { input.setState('dead'); return; }
      input.setState('playing');
    }
    function toMenu() { input.setState('menu'); }

    function startGame(forceNew) {
      audio.resume();
      var st = storage();
      if (!forceNew && st && MC.Save.hasSave(st)) {
        if (MC.Save.load(st, g)) {
          ui.toast('Partie chargée');
          prime();
          input.setState('playing');
          return;
        }
      }
      if (forceNew && st) MC.Save.clear(st);
      newWorld();
      input.setState('playing');
    }

    function newWorld() {
      world.reset(render.disposeChunk);        // vide AUSSI le registre de lumieres
      entities.list.length = 0;
      render.libererToutesEntites();           // libere geometries ET materiaux
      for (var k in furnaces) delete furnaces[k];
      for (var k2 in chests) delete chests[k2];
      var s = player.state;
      s.inv.load([]);
      s.hp = 20; s.hunger = 20; s.air = 10; s.dead = false;
      s.flying = false; s.selected = 0; s.exhaustion = 0;
      g.time = 60;
      placeAtSpawn();
      prime();
      ui.toast('Nouveau monde');
    }

    /* Recompose l'equipe pour n joueurs locaux. Appele au demarrage d'une
       partie : c'est le seul endroit ou le nombre de joueurs change. */
    function composerEquipe(n, nouvellesRegles) {
      n = Math.max(1, Math.min(MC.Split.MAX_LOCAUX, n | 0));
      regles = nouvellesRegles || regles;
      g.regles = regles;
      ui.setRegles(regles);

      var col = world.findSpawnColumn();
      streamChunks(true);
      var centre = { x: col[0] + 0.5, y: world.groundAt(col[0], col[1], true) + 1.2,
                     z: col[1] + 0.5 };
      var nouvelle = MC.Split.creerEquipe(n, world, entities, regles, centre);

      equipe.length = 0;
      manettes.length = 0;
      nouvelle.forEach(function (j) {
        equipe.push(j);
        if (j.source === 'manette') {
          manettes.push(MC.creerManette(j.manette, function () {
            return (typeof navigator !== 'undefined' && navigator.getGamepads)
              ? navigator.getGamepads() : [];
          }));
        } else manettes.push(null);
      });
      player = equipe[0].player;
      // g.player doit suivre : sinon l'interface et la sauvegarde continuent
      // de pointer sur le joueur d'AVANT la recomposition
      g.player = player;
      g.nbLocaux = equipe.length;
      g.spawnPoint = { x: centre.x, y: centre.y, z: centre.z };
      return equipe;
    }
    g.composerEquipe = composerEquipe;

    function placeAtSpawn() {
      var col = world.findSpawnColumn();
      var s = player.state;
      s.pos.x = col[0] + 0.5; s.pos.y = C.WORLD_H; s.pos.z = col[1] + 0.5;
      s.vel.x = s.vel.y = s.vel.z = 0;
      streamChunks(true);
      s.pos.y = world.groundAt(col[0], col[1], true) + 1.2;
      g.spawnPoint = { x: s.pos.x, y: s.pos.y, z: s.pos.z };
    }

    function respawn() {
      if (net.enLigne()) {
        // le serveur décide du lieu de renaissance ; l'état suivant nous y placera
        equipe.forEach(function (j) { net.renaitre(j.index); if (j.prediction) j.prediction.confirmer(Infinity); });
        player.state.dead = false;
        input.setState('playing');
        return;
      }
      var sp = g.spawnPoint;
      if (!sp) { placeAtSpawn(); sp = g.spawnPoint; }
      // on réapparaît sur un sol valide même si le terrain a changé
      var gy = world.groundAt(Math.floor(sp.x), Math.floor(sp.z), true);
      player.respawn({ x: sp.x, y: gy + 1.2, z: sp.z });
      input.setState('playing');
      ui.toast('Réapparition');
    }

    function prime() {
      // génère le voisinage d'un coup : pas d'écran vide au démarrage
      streamChunks(true);
      var s = player.state;
      if (P.collides(world, s.pos.x, s.pos.y, s.pos.z, player.PW, player.PH)) {
        s.pos.y = world.groundAt(Math.floor(s.pos.x), Math.floor(s.pos.z), true) + 1.2;
      }
      g.spawnPoint = g.spawnPoint || { x: s.pos.x, y: s.pos.y, z: s.pos.z };
    }

    // ─── streaming des chunks ────────────────────────────────────────────────
    /* Un centre de streaming par joueur local. N'en suivre qu'un seul
       laissait le joueur 2 d'un écran partagé marcher sur des chunks jamais
       générés — ou déchargés sous ses pieds : ni sol, ni collision, ni image. */
    function centresStreaming() {
      var out = [];
      for (var i = 0; i < equipe.length; i++) {
        var p = equipe[i].player.state.pos;
        out.push([Math.floor(p.x / C.CHUNK_X), Math.floor(p.z / C.CHUNK_Z)]);
      }
      if (!out.length) {
        var s0 = player.state.pos;
        out.push([Math.floor(s0.x / C.CHUNK_X), Math.floor(s0.z / C.CHUNK_Z)]);
      }
      return out;
    }

    // ─── streaming des chunks ────────────────────────────────────────────────
    function streamChunks(unlimited) {
      var centres = centresStreaming();
      var R = render.RENDER_DIST;
      /* On GÉNÈRE un anneau de plus que l'on n'affiche : un chunk n'est
         maillé que lorsque ses 8 voisins existent, sans quoi l'anneau
         extérieur ne serait jamais visible et le bord du monde apparaîtrait
         en deçà du brouillard. */
      var aGenerer = world.chunksVoulus(centres, R + 1);
      var aMailler = world.chunksVoulus(centres, R);

      var genMax = unlimited ? 1e9 : GEN_BUDGET, meshMax = unlimited ? 1e9 : MESH_BUDGET;
      var gen = 0, manquants = 0;
      for (var i = 0; i < aGenerer.length; i++) {
        var cx = aGenerer[i][1], cz = aGenerer[i][2];
        if (world.chunks.has(world.key(cx, cz))) continue;
        if (gen >= genMax) { manquants++; continue; }
        world.getChunk(cx, cz, true);
        // les 8 voisins : leurs faces de bordure ET leur occlusion ambiante changent
        world.marquerVoisins(cx, cz);
        gen++;
      }

      var meshed = 0, attente = 0;
      for (var j = 0; j < aMailler.length; j++) {
        if (meshed >= meshMax) { attente++; continue; }
        var mx = aMailler[j][1], mz = aMailler[j][2];
        var c = world.chunks.get(world.key(mx, mz));
        if (!c || !c.dirty) continue;
        // voisinage 3×3 complet, sinon coutures et ombres de contact fausses
        // bord du disque : ses voisins en diagonale ne seront jamais générés, ce n'est pas un retard
        if (!world.voisinsCharges(mx, mz)) continue;
        render.syncChunk(world, c);
        meshed++;
      }
      // chunks voulus pas encore affichés : la distance de vue n'avance que s'ils sont rattrapés
      g.enAttente = attente + manquants;

      world.unloadLoin(centres, R + 3, render.disposeChunk);
    }
    g.streamChunks = streamChunks;

    function remeshDirtyNear() {
      var centres = centresStreaming();
      var done = 0;
      world.chunks.forEach(function (c) {
        if (done >= 3 || !c.dirty) return;
        var proche = centres.some(function (ce) {
          return Math.abs(c.cx - ce[0]) <= 2 && Math.abs(c.cz - ce[1]) <= 2;
        });
        if (!proche || !world.voisinsCharges(c.cx, c.cz)) return;
        render.syncChunk(world, c);
        done++;
      });
    }

    // ─── donjons ─────────────────────────────────────────────────────────────
    /* Un gardien s'éveille quand un joueur entre dans sa salle, à condition
       qu'il n'ait pas déjà été vaincu. En ligne, les mobs appartiennent au
       serveur : on ne crée pas de gardien local qu'il ignorerait. */
    function surveillerDonjons() {
      /* Les défaites D'ABORD : traiter l'éveil avant laissait, l'image qui suit
         la mort du gardien, un donjon pas encore marqué vaincu — un second
         gardien se relevait aussitôt. */
      var evts = entities.evenements();
      for (var k = 0; k < evts.length; k++) {
        if (g.histoire && evts[k].type === 'mort' && evts[k].parJoueur) signalerHistoire({ type: 'tuer', mob: evts[k].victime });
        if (g.histoire && evts[k].type === 'boss_vaincu') signalerHistoire({ type: 'boss', donjon: evts[k].donjon });
        // une mort de la main du joueur change ce que les factions pensent de lui
        if (evts[k].type === 'mort' && evts[k].parJoueur && world.reputation) {
          MC.Factions.surMort(evts[k].victime, world.reputation).forEach(function (c) {
            var mot = { hostile: 'vous est désormais hostile', neutre: 'vous tolère', amical: 'vous est désormais amical' };
            chat.systeme(c.nom + ' ' + mot[c.statut]);
            ui.toast(c.nom + ' ' + mot[c.statut], c.statut === 'hostile' ? 'warn' : undefined);
          });
          continue;
        }
        if (evts[k].type !== 'boss_vaincu') continue;
        if (evts[k].donjon) world.donjonsVaincus.add(evts[k].donjon);
        chat.systeme(evts[k].nom + ' est vaincu !');
        ui.toast(evts[k].nom + ' est vaincu !');
      }
      if (net.enLigne() || !regles.monstres) return;
      for (var i = 0; i < equipe.length; i++) {
        var p = equipe[i].player.state;
        if (p.dead) continue;
        var d = world.salleDonjon(p.pos.x, p.pos.y + 0.5, p.pos.z);
        if (!d || world.donjonsVaincus.has(d.id)) continue;
        var b = entities.invoquerGardien(d);
        if (b) {
          var nom = entities.SPECS[b.type].nom;
          chat.systeme(nom + " s'éveille !");
          ui.toast(nom + " s'éveille !", 'warn');
          audio.play('blesse');
        }
      }
    }

    /* Le gardien le plus proche du joueur 1, pour la barre de vie. */
    function gardienProche() {
      var p = player.state.pos, best = null, bd = 32 * 32;
      for (var i = 0; i < entities.list.length; i++) {
        var e = entities.list[i];
        var s = entities.SPECS[e.type];
        if (!s || !s.boss || e.dead) continue;
        var dx = e.pos.x - p.x, dy = e.pos.y - p.y, dz = e.pos.z - p.z;
        var d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bd) { bd = d2; best = { nom: s.nom, hp: e.hp, max: s.hp }; }
      }
      return best;
    }

    /* Un coffre de donjon se remplit de son butin la première fois qu'on
       l'ouvre — ou qu'on le casse. Ensuite il vit comme n'importe quel coffre. */
    function coffreDe(x, y, z) {
      var k = x + ',' + y + ',' + z;
      if (chests[k]) return chests[k];
      if (world.coffresPilles.has(k)) return null;
      var butin = world.butinCoffre(x, y, z);
      if (!butin) return null;
      world.coffresPilles.add(k);
      var inv = Inv.create(27);
      butin.forEach(function (st) { inv.add(st.id, st.n); });
      chests[k] = inv;
      return inv;
    }
    g.coffreDe = coffreDe;

    // ─── carte ──────────────────────────────────────────────────────────────
    function aUneCarte(pl) { return regles.blocsIllimites || pl.state.inv.count(I.CARTE) > 0; }
    function ouvrirCarte() {
      if (!world.reperes) return false;
      world.exploration.explorer(world, player.state.pos.x, player.state.pos.z);
      ui.ouvrirCarte({ world: world, joueur: player.state, reperes: world.reperes,
                       exploration: world.exploration,
                       surChange: function (quoi, r) {
                         if (quoi === 'ajout') ui.toast('Repère « ' + r.nom + ' » posé');
                       } });
      input.setState('ui');
      return true;
    }
    g.ouvrirCarte = ouvrirCarte;
    var explorationT = 0;

    // ─── véhicules ──────────────────────────────────────────────────────────
    var V = MC.Vehicules;

    /* Pose un véhicule devant le joueur, sur le bloc visé, tourné comme lui. */
    function poserVehicule(pl, nom, cible) {
      var st = pl.state;
      var x = cible.x + cible.nx + 0.5, y = cible.y + cible.ny, z = cible.z + cible.nz + 0.5;
      var d = V.DEFS[nom];
      // un peu de place : on remonte d'un cran si l'engin serait dans le décor
      for (var k = 0; k < 3 && P.collides(world, x, y, z, d.w, d.h); k++) y++;
      if (P.collides(world, x, y, z, d.w, d.h)) { ui.toast('Pas assez de place pour ' + d.nom, 'warn'); return false; }
      V.poser(entities, nom, x, y, z, st.yaw);
      if (!regles.blocsIllimites) st.inv.consumeAt(st.selected, 1);
      audio.play('poser');
      ui.toast(d.nom + ' posé — clic droit pour monter');
      return true;
    }

    /* Clic droit sur un véhicule : monter, ou ouvrir la soute du camion en
       tenant Maj. Renvoie true si l'action a été prise. */
    function interagirVehicule(j, e, sprint) {
      var st = j.player.state;
      if (!e || !e.vehicule || e === st.monture) return false;
      if (net.enLigne()) { ui.toast('Les véhicules ne sont pas disponibles en ligne', 'warn'); return true; }
      if (sprint && e.soute && j.index === 0) {
        ui.openContainer('chest', st.inv, e.soute, 'soute');
        input.setState('ui');
        return true;
      }
      if (e.conducteur) { if (j.index === 0) ui.toast('Déjà occupé', 'warn'); return true; }
      if (V.monter(st, e)) {
        if (j.index === 0) ui.toast(V.DEFS[e.vehicule].nom + ' — ZQSD pour conduire, F pour descendre');
        audio.play('poser');
      }
      return true;
    }

    function descendreDe(j) {
      var st = j.player.state;
      if (!st.monture) return false;
      V.descendre(st, world, j.player.PW, j.player.PH);
      if (j.index === 0) ui.toast('Pied à terre');
      return true;
    }
    g.descendreDe = descendreDe;
    g.monterDans = function (e) { return interagirVehicule(equipe[0], e, false); };

    // ─── actions ─────────────────────────────────────────────────────────────
    /* Casser un fourneau ou un coffre doit rendre son contenu : sinon les
       objets disparaissent silencieusement, ce qui est la pire des pertes. */
    function spillContainer(x, y, z) {
      var k = x + ',' + y + ',' + z;
      var lache = 0;
      var f = furnaces[k];
      if (f) {
        [f.input, f.fuel, f.output].forEach(function (st) {
          if (st) { entities.dropItem(x + 0.5, y + 0.5, z + 0.5, st.id, st.n); lache += st.n; }
        });
        delete furnaces[k];
      }
      var ch = coffreDe(x, y, z);
      if (ch) {
        ch.slots.forEach(function (st) {
          if (st) { entities.dropItem(x + 0.5, y + 0.5, z + 0.5, st.id, st.n); lache += st.n; }
        });
        delete chests[k];
      }
      if (lache) ui.toast(lache + ' objet(s) récupéré(s) du conteneur');
      return lache;
    }
    g.spillContainer = spillContainer;

    function selectSlot(i) {
      if (i < 0 || i >= Inv.HOTBAR_SIZE) return;
      player.state.selected = i;
      player.cancelMining();
    }

    /* Créature du serveur visée par un joueur (en ligne, il n'y a pas de
       créature locale : on vise celles que le serveur nous montre). */
    function mobDistantVise(pl) {
      var o = pl.eyePos(), d = pl.lookDir(), best = null, bt = Infinity;
      net.mobsDistants.forEach(function (m) {
        if (m.type === 'item' || m.type === 'arrow') return;
        var sp = MC.EntitySpecs[m.type] || { w: 0.6, h: 1.8 };
        var hw = sp.w / 2 + 0.12;
        var t = entities.rayBox(o, d, m.pos.x - hw, m.pos.y - 0.12, m.pos.z - hw,
                                m.pos.x + hw, m.pos.y + sp.h + 0.12, m.pos.z + hw);
        if (t !== null && t <= pl.REACH && t < bt) { bt = t; best = m; }
      });
      return best;
    }
    function attaqueEnLigne(j) {
      var pl = j.player, st = pl.state;
      if (st.attackCd > 0) return false;
      var m = mobDistantVise(pl);
      if (!m) return false;
      st.attackCd = 0.45;
      var h = pl.held(), d = h ? C.def(h.id) : null;
      net.attaquer(m.eid, (d && d.damage) || 1, j.index);
      audio.play('frapper');
      return true;
    }
    function tirEnLigne(j) {
      var pl = j.player, h = pl.held(), d = h && C.def(h.id);
      var avant = entities.list.length;
      var tir = pl.tirer();                    // consomme munitions et usure comme en solo…
      if (!tir) return null;
      entities.list.splice(avant);             // …mais la flèche vole côté serveur
      net.tirer(pl.lookDir(), d.vitesseTir || 34,
                d.sansMunition ? (d.degatsTir || 6) : 5 + (d.bonusTir || 0), d.ranged, j.index);
      return tir;
    }

    function onAttack() {
      if (input.state !== 'playing') return;
      if (net.enLigne()) { attaqueEnLigne(equipe[0]); return; }
      var e = entities.aimedAt(player.eyePos(), player.lookDir(), player.REACH);
      if (e && e === player.state.monture) e = null;
      if (e) {
        var r = player.attack(e);
        if (r) audio.play(r.toolBroke ? 'brise' : 'frapper');
        if (r && r.killed) ui.toast('Éliminé');
      }
      // sinon le minage continu est géré dans la boucle
    }

    function onUse() {
      if (input.state !== 'playing') return;

      // une arme a distance tire au clic droit, avant toute autre interaction
      var enMain = player.held();
      if (enMain && C.def(enMain.id) && C.def(enMain.id).ranged) {
        var tir = net.enLigne() ? tirEnLigne(equipe[0]) : player.tirer();
        if (tir) {
          audio.play('frapper');
          if (tir.toolBroke) ui.toast("Votre arc s'est brisé", 'warn');
        } else ui.toast('Plus de munitions', 'warn');
        return;
      }

      // interagir avec un PNJ a priorité sur le bloc derrière lui
      var ent = entities.aimedAt(player.eyePos(), player.lookDir(), player.REACH);
      if (ent && ent.vehicule && interagirVehicule(equipe[0], ent, input.actions().sprint)) return;
      // en ligne, les habitants appartiennent au serveur : on vise leur reflet
      if (!ent && net.enLigne()) {
        var md = mobDistantVise(player);
        if (md && MC.EntitySpecs[md.type] && MC.EntitySpecs[md.type].npc) ent = md;
      }
      if (ent && entities.SPECS[ent.type] && entities.SPECS[ent.type].npc) { parlerA(ent); return; }

      var target = player.aim();
      if (!target) return;
      var mange = player.heldId();
      var res = player.useOn(target);
      if (!res) return;
      if (res === 'interdit') { ui.toast('Cette histoire ne vous permet pas de l\'utiliser', 'warn'); return; }
      if (res === 'eat' && net.enLigne()) net.manger(mange, 0);
      if (res.indexOf('vehicule:') === 0) { poserVehicule(player, res.slice(9), target); return; }
      if (res === 'carte') { ouvrirCarte(); return; }
      if (res.indexOf('open:') === 0) {
        var kind = res.slice(5);
        var k = target.x + ',' + target.y + ',' + target.z;
        if (kind === 'furnace') {
          if (!furnaces[k]) furnaces[k] = Inv.newFurnace();
          ui.openContainer('furnace', player.state.inv, furnaces[k], k);
        } else if (kind === 'chest') {
          if (!coffreDe(target.x, target.y, target.z)) chests[k] = Inv.create(27);
          ui.openContainer('chest', player.state.inv, chests[k], k);
        } else if (kind === 'banque') {
          // un coffre-fort ouvre le compte, le même dans toutes les banques
          ouvrirBanque();
          return;
        } else if (kind === 'info') {
          var ri = rendreService('info', null);
          ui.toast(ri.message);
          if (chat) chat.systeme(ri.message);
          return;
        } else {
          ui.openContainer('craft', player.state.inv);
        }
        input.setState('ui');
        return;
      }
      if (res === 'place' && net.enLigne()) {
        // le serveur fait autorite : on lui annonce la pose
        var bx = target.x + target.nx, by = target.y + target.ny, bz = target.z + target.nz;
        net.poserBloc(bx, by, bz, world.getBlock(bx, by, bz), 0, 0);
      }
      if (res === 'place') audio.play('poser');
      else if (res === 'eat') audio.play('manger');
      else if (res === 'till') { audio.play('poser'); ui.toast('Terre labourée'); }
      else if (res === 'plant') { audio.play('poser'); ui.toast('Graines plantées'); }
      else if (res === 'grow') { audio.play('poser'); ui.toast('Ça pousse !'); }
    }

    function onKey(code) {
      if (code === 'KeyE') {
        ui.openContainer('inv', player.state.inv);
        input.setState('ui');
      } else if (code === 'KeyL') {
        ui.openContainer('inv', player.state.inv);
        ui.toggleLivre();
        input.setState('ui');
      } else if (code === 'F5') {
        doSave(true);
      } else if (code === 'F1') {
        // bascule générale du HUD (SPEC-HUD-001)
        hud.basculerTout();
        ui.appliquerHud();
      } else if (code === 'KeyT') {
        // même masqué, T doit rouvrir le chat pour pouvoir y écrire (SPEC-HUD-008)
        if (!hud.visible('chat')) hud.regler('chat', true);
        chat.ouvrir();
        input.setSaisie(true);
      } else if (code === 'Slash') {
        if (!hud.visible('chat')) hud.regler('chat', true);
        chat.ouvrir(); chat.saisie = '/';
        input.setSaisie(true);
      } else if (code === 'KeyM') {
        ui.toast(audio.setEnabled(!audio.enabled) ? 'Son activé' : 'Son coupé');
      } else if (code === 'KeyC') {
        if (aUneCarte(player)) ouvrirCarte();
        else ui.toast('Il faut une carte dans l\'inventaire', 'warn');
      } else if (code === 'KeyH') {
        if (g.histoire) { ui.journalHistoire(g.histoire); input.setState('ui'); }
        else ui.toast('Le journal n\'existe qu\'en mode histoire', 'warn');
      } else if (code === 'KeyJ') {
        ui.panneauFactions(world.reputation);
        input.setState('ui');
      } else if (code === 'KeyF') {
        descendreDe(equipe[0]);
      } else if (code === 'KeyG') {
        // G et non Q : sur AZERTY, Q est déjà la touche « aller à gauche »
        var d = player.dropSelected(1);
        if (d) { ui.toast('Jeté : ' + C.nameOf(d.id)); audio.play('poser'); }
      }
    }

    function onKeyAnyState(code) {
      if (input.state !== 'ui') return;
      if (code === 'KeyE') closeUI();
      else if (code === 'KeyC' && ui.carteOuverte()) closeUI();
      else if (code === 'KeyJ' && ui.factionsOuvertes()) closeUI();
      else if (code === 'KeyH' && ui.journalOuvert()) closeUI();
      else if (code === 'KeyL') ui.toggleLivre();
    }

    function onEscape() {
      if (input.state === 'ui') { closeUI(); return; }
      if (input.state === 'playing') { input.setState('paused'); return; }
      if (input.state === 'paused') { resume(); return; }
    }

    function forceCloseContainer() {
      var rendus = ui.closeContainer();
      dropLeftovers(rendus);
    }
    function dropLeftovers(rendus) {
      if (!rendus || !rendus.length) return;
      var s = player.state;
      rendus.forEach(function (r) {
        entities.dropItem(s.pos.x, s.pos.y + 1, s.pos.z, r.id, r.n);
      });
      ui.toast('Inventaire plein : objets lâchés au sol', 'warn');
    }
    function closeUI() {
      ui.fermerCarte();
      ui.fermerFactions();
      if (ui.fermerJournal) ui.fermerJournal();
      forceCloseContainer();
      // une réplique du récit attend sa réponse : on garde la main sur l'interface
      if (ui.dialogueOuvert && ui.dialogueOuvert()) return;
      input.setState('playing');
    }

    /* Une commande donne un retour immediat ; un message ordinaire part au
       reseau quand il y en a un. */
    function traiterMessage(m) {
      var cmd = MC.Chat.parseCommande(m.texte);
      if (cmd) {
        executerCommande(cmd);
        return;
      }
      if (g.net && g.net.envoyerChat) g.net.envoyerChat(m.texte);
    }

    function executerCommande(cmd) {
      var s = player.state;
      switch (cmd.nom) {
        case 'heure':
          chat.systeme('Il est ' + DC.clockString(g.time) +
                       (DC.isNight(g.time) ? ' — il fait nuit' : ' — il fait jour'));
          break;
        case 'jour': g.time = DC.DAY_LENGTH * 0.2; chat.systeme('Le jour se lève.'); break;
        case 'nuit': g.time = DC.DAY_LENGTH * 0.7; chat.systeme('La nuit tombe.'); break;
        case 'ou':
        case 'pos':
          chat.systeme('Vous êtes en ' + s.pos.x.toFixed(1) + ' / ' +
                       s.pos.y.toFixed(1) + ' / ' + s.pos.z.toFixed(1));
          break;
        case 'graine': chat.systeme('Graine du monde : ' + world.seed); break;
        case 'aide':
          chat.systeme('Commandes : /heure /jour /nuit /ou /graine /vider /aide ' +
                       '/rejoindre [adresse] /quitter /qui');
          break;
        case 'rejoindre': {
          var hote = cmd.args[0] || '';
          chat.systeme('Connexion' + (hote ? ' a ' + hote : ' au serveur local') + '…');
          net.connecter(hote, g.nomJoueur || 'Joueur', equipe.length);
          break;
        }
        case 'quitter':
          net.deconnecter();
          chat.systeme('Deconnecte. Partie en solo.');
          break;
        case 'qui': {
          if (!net.enLigne()) { chat.systeme('Hors ligne.'); break; }
          var noms = [];
          net.distants.forEach(function (d) { noms.push(d.nom); });
          chat.systeme('En ligne : vous' + (noms.length ? ', ' + noms.join(', ') : ' (seul)'));
          break;
        }
        case 'vider': chat.vider(); break;
        default: chat.systeme('Commande inconnue : /' + cmd.nom);
      }
    }
    g.traiterMessage = traiterMessage;

    /* Le butin revient au joueur le plus proche : en ecran partage, tout
       donner au joueur 1 serait injuste et deroutant. */
    function joueurLePlusProche(pos) {
      var best = equipe[0].player, bd = Infinity;
      for (var i = 0; i < equipe.length; i++) {
        var st2 = equipe[i].player.state;
        if (st2.dead) continue;
        var d = Math.hypot(st2.pos.x - pos.x, st2.pos.y - pos.y, st2.pos.z - pos.z);
        if (d < bd) { bd = d; best = equipe[i].player; }
      }
      return best;
    }

    /* Mode cauchemar : la carte ET la sauvegarde disparaissent. */
    function perdrePartie() {
      audio.play('mort');
      var st = storage();
      if (st && g.partieId) MC.Saves.supprimer(st, g.partieId);
      g.partieId = null;
      world.reset(render.disposeChunk);
      entities.list.length = 0;
      render.libererToutesEntites();
      ui.toast('Cauchemar : la carte et la sauvegarde ont ete detruites', 'warn');
      input.setState('dead');
    }
    g.perdrePartie = perdrePartie;

    function doSave(notify) {
      var st = storage();
      if (!st) { if (notify) ui.toast('Sauvegarde indisponible', 'warn'); return false; }
      // pas d emplacement (partie non nommee) : rien a ecrire
      if (!g.partieId) { if (notify) ui.toast('Aucune partie à sauvegarder', 'warn'); return false; }
      var ok = MC.Saves.sauvegarder(st, g.partieId, g);
      if (notify) { ui.toast(ok ? 'Partie sauvegardée' : 'Échec de la sauvegarde', ok ? '' : 'warn');
                    if (ok) audio.play('sauver'); }
      return ok;
    }
    g.doSave = doSave;

    /* Simule UN joueur local. Le joueur 1 lit le clavier, les autres leur
       manette : au-dela de la source, le traitement est identique — c'est ce
       qui evite d'avoir deux logiques de jeu a maintenir. */
    function simulerJoueur(j, dt) {
      var pl = j.player, st = pl.state;
      var man = manettes[j.index];
      var touches;

      if (j.source === 'clavier') {
        touches = input.actions();
      } else if (man && man.connectee()) {
        touches = man.actions();
        var r = man.regard(dt);
        st.yaw += r.dyaw;
        st.pitch += r.dpitch;
        var lim = Math.PI / 2 - 0.001;
        st.pitch = Math.max(-lim, Math.min(lim, st.pitch));
      } else {
        // manette debranchee : le joueur reste au repos plutot que de courir
        touches = { forward: 0, back: 0, left: 0, right: 0, jump: 0, sprint: 0 };
      }

      if (st.dead) {
        if (st.monture) V.descendre(st, world, pl.PW, pl.PH);
        return;
      }
      if (net.enLigne() && j.prediction) {
        /* Prédiction : l'entrée part au serveur ET s'applique tout de suite,
           par le même code que lui. Les statistiques (vie, faim, air) ne sont
           pas calculées ici : elles arrivent du serveur. */
        var entree = j.prediction.enregistrer(dt, touches, st.yaw, st.pitch, st.flying);
        net.envoyerEntree(entree, j.index);
        MC.Synchro.rejouer(pl, [entree]);
      } else if (st.monture) {
        // à bord : les touches de déplacement deviennent les commandes de l'engin
        var mt = st.monture;
        V.conduire(mt, dt, world, {
          avant: touches.forward, arriere: touches.back, gauche: touches.left,
          droite: touches.right, monter: touches.jump, descendre: touches.sprint,
        });
        if (!V.caler(st)) { /* engin détruit : on est à pied */ }
        else if (V.DEFS[mt.vehicule].respire) st.air = pl.MAX_AIR;     // cabine étanche
      } else {
        pl.updateMovement(dt, touches);
        // on ne traverse pas les creatures : la separation vient APRES le
        // deplacement, sinon le joueur entre puis ressort en tremblant
        entities.separer(st, dt);
      }
      if (!net.enLigne()) pl.updateSurvival(dt);

      /* Climat : la température autour du joueur, réévaluée deux fois par
         seconde (feux voisins compris). Hors ligne elle agit sur le corps ;
         en ligne, c'est le serveur qui l'applique — on ne fait que l'afficher. */
      if (world.meteo) {
        j.tempT = (j.tempT || 0) - dt;
        if (j.tempT <= 0 || !j.temperature) {
          j.tempT = 0.5;
          j.temperature = world.meteo.temperatureEn(world, st.pos, g.time, g.meteo);
        }
        var avantClimat = st.climat;
        if (!net.enLigne()) pl.subirClimat(dt, j.temperature.temperature);
        else { st.temperature = j.temperature.temperature; st.climat = null; }
        if (j.index === 0 && st.climat !== avantClimat && st.climat) {
          ui.toast(st.climat === 'froid' ? 'Vous gelez : approchez-vous d\'un feu' : 'Chaleur écrasante : vous avez soif');
          if (st.climat === 'froid') audio.play('froid');
        }
      }

      // visee et actions
      var cible = pl.aim();
      var mob = entities.aimedAt(pl.eyePos(), pl.lookDir(), pl.REACH);
      var casse = j.source === 'clavier' ? input.mouse.left
                                         : !!(man && man.boutons().casser);
      var utilise = j.source === 'clavier' ? input.mouse.right
                                           : !!(man && man.boutons().utiliser);

      if (casse && cible && !mob) {
        var pos = { x: cible.x, y: cible.y, z: cible.z };
        var outil = pl.heldId();
        var nAvant = entities.list.length;
        var res = pl.mineTick(dt, cible);
        if (pl.state.interdit === 'casser') {
          pl.state.interdit = null;
          if (!(g.interditT > g.time)) { g.interditT = g.time + 3; ui.toast('Cette histoire ne vous permet pas de casser ce bloc', 'warn'); }
        }
        if (res) {
          if (net.enLigne()) {
            // le serveur calcule le butin et nous le donne : pas de double compte
            entities.list.splice(nAvant);
            net.poserBloc(pos.x, pos.y, pos.z, 0, outil, j.index);
          }
          if (C.BLOCKS[res.id] && C.BLOCKS[res.id].interactive) spillContainer(pos.x, pos.y, pos.z);
          audio.play(res.toolBroke ? 'brise' : 'casser');
          if (res.drops.length === 0 && C.BLOCKS[res.id] && C.BLOCKS[res.id].needsTool)
            ui.toast('Il faut un outil adapte pour recuperer ce bloc', 'warn');
        }
      } else if (!casse) pl.cancelMining();

      if (casse && net.enLigne() && j.source !== 'clavier') attaqueEnLigne(j);
      if (casse && mob && j.source !== 'clavier') {
        // au clavier, la frappe passe par l'evenement de clic ; a la manette
        // on echantillonne, avec le temps de recharge du joueur pour cadence
        var ra = pl.attack(mob);
        if (ra) audio.play('frapper');
      }

      if (utilise) {
        j.useCd = (j.useCd || 0) - dt;
        if (j.useCd <= 0) { j.useCd = 0.22; utiliserPour(j); }
      } else j.useCd = 0;

      render.setHighlight(cible, j.index);

      // boutons a front montant, pour les manettes
      if (man && man.connectee()) {
        if (man.vientDAppuyer(man.BTN.VOL)) {
          if (!descendreDe(j)) { st.flying = !st.flying; st.vel.y = 0; }
        }
        if (man.vientDAppuyer(man.BTN.SUIVANT))
          st.selected = (st.selected + 1) % Inv.HOTBAR_SIZE;
        if (man.vientDAppuyer(man.BTN.PRECEDENT))
          st.selected = (st.selected + Inv.HOTBAR_SIZE - 1) % Inv.HOTBAR_SIZE;
      }
    }

    /* Utilisation « clic droit » generique, pour n'importe quel joueur local. */
    function utiliserPour(j) {
      var pl = j.player;
      var enMain = pl.held();
      if (enMain && C.def(enMain.id) && C.def(enMain.id).ranged) {
        var tir = pl.tirer();
        if (tir) audio.play('frapper');
        return;
      }
      var vis = entities.aimedAt(pl.eyePos(), pl.lookDir(), pl.REACH);
      if (vis && vis.vehicule && interagirVehicule(j, vis, false)) return;
      var target = pl.aim();
      if (!target) return;
      var res = pl.useOn(target);
      if (!res) return;
      if (res.indexOf('vehicule:') === 0) { poserVehicule(pl, res.slice(9), target); return; }
      if (res.indexOf('open:') === 0) {
        // seules les interfaces du joueur 1 s'ouvrent : un seul clavier
        if (j.index !== 0) return;
        ouvrirConteneur(res.slice(5), target);
        return;
      }
      if (res === 'place') audio.play('poser');
      else if (res === 'eat') audio.play('manger');
      else if (res === 'till' || res === 'plant') audio.play('poser');
    }

    function ouvrirConteneur(kind, target) {
      var k = target.x + ',' + target.y + ',' + target.z;
      if (kind === 'furnace') {
        if (!furnaces[k]) furnaces[k] = Inv.newFurnace();
        ui.openContainer('furnace', player.state.inv, furnaces[k], k);
      } else if (kind === 'chest') {
        if (!chests[k]) chests[k] = Inv.create(27);
        ui.openContainer('chest', player.state.inv, chests[k], k);
      } else {
        ui.openContainer('craft', player.state.inv);
      }
      input.setState('ui');
    }

    // ─── boucle ──────────────────────────────────────────────────────────────
    var last = performance.now(), acc = 0, frames = 0, spawnT = 0, autoSaveT = 0;

    function frame(now) {
      requestAnimationFrame(frame);
      var dt = Math.min((now - last) / 1000, 0.05);   // clamp : évite l'explosion après un onglet inactif
      last = now;

      var st = input.state;
      var actif = st === 'playing';

      streamChunks(false);
      remeshDirtyNear();
      // la carte retient ce que chaque joueur a vu de près
      explorationT -= dt;
      if (explorationT <= 0 && world.exploration) {
        explorationT = 0.5;
        for (var ej = 0; ej < equipe.length; ej++) {
          world.exploration.explorer(world, equipe[ej].player.state.pos.x, equipe[ej].player.state.pos.z);
        }
      }

      if (actif) {
        // chaque joueur local est simule, quelle que soit sa source d'entrees
        for (var qi = 0; qi < equipe.length; qi++) simulerJoueur(equipe[qi], dt);

        // entites et butin : le butin va au joueur le plus proche
        // (en ligne, créatures, butin et dégâts sont l'affaire du serveur)
        var ev = net.enLigne() ? { damage: 0, picked: [] }
                               : entities.update(dt, player.state, { reputation: world.reputation });
        if (ev.damage) { player.hurt(ev.damage); audio.play('blesse'); }
        for (var i = 0; i < ev.picked.length; i++) {
          var p2 = ev.picked[i];
          var dest = joueurLePlusProche(p2.entity ? p2.entity.pos : player.state.pos);
          var reste = dest.pickUp(p2.id, p2.n);
          if (reste > 0) entities.dropItem(dest.state.pos.x, dest.state.pos.y + 0.5,
                                           dest.state.pos.z, p2.id, reste);
          else { ui.toast('+' + p2.n + ' ' + C.nameOf(p2.id)); audio.play('ramasser'); }
        }
        entities.mergeItems();
        surveillerDonjons();

        // temps, apparitions, cultures
        g.time += dt;
        g.duree = (g.duree || 0) + dt;
        world.tick(dt, 14);
        spawnT += dt;
        if (spawnT >= SPAWN_INTERVAL && !net.enLigne()) {
          spawnT = 0;
          if (regles.monstres || MC.Modes.plafondsEntites(regles).sheep > 0) {
            entities.trySpawn(player.state, DC.isNight(g.time), null,
                              MC.Modes.plafondsEntites(regles));
          }
          if (!DC.isNight(g.time)) entities.burnUndead(false);
        }

        for (var fk in furnaces) {
          if (Inv.tickFurnace(furnaces[fk], dt)) ui.refreshFurnace();
        }

        autoSaveT += dt;
        if (autoSaveT >= 60) { autoSaveT = 0; doSave(false); }

        // mort : en cauchemar, un seul joueur suffit a perdre la partie
        if (MC.Split.partiePerdue(equipe, regles)) {
          var finT = g.histoire && !g.histoire.fin ? MC.Histoire.signaler(g.histoire, { type: 'mort' }) : [];
          perdrePartie();
          finT.forEach(function (n) { if (n.type === 'fin') finHistoire(n); });
        }
        else if (MC.Split.tousMorts(equipe)) { audio.play('mort'); input.setState('dead'); }
      } else if (st === 'ui') {
        // l'inventaire est ouvert : le monde continue doucement (fourneaux, cultures)
        world.tick(dt, 14);
        for (var fk2 in furnaces) if (Inv.tickFurnace(furnaces[fk2], dt)) ui.refreshFurnace();
        render.setHighlight(null);
      } else {
        render.setHighlight(null);
      }

      if (net.enLigne()) net.interpoler(dt);
      /* On passe TOUJOURS l objet reseau, meme hors ligne : ses tables sont
         alors vides et la meme boucle de reconciliation retire les maillages
         des joueurs partis. Appeler la synchronisation seulement en ligne
         laissait des joueurs fantomes dans la scene apres une deconnexion. */
      render.syncEntities(entities, net, function (x, y, z) { return MC.Lumiere.lumiereEn(world.chunkDe, x, y, z); },
                          DC.sunIntensity(g.time));

      // une camera par joueur, puis un rendu par vue
      var taille = [host.clientWidth || innerWidth, host.clientHeight || innerHeight];
      var vues = MC.Split.dispositions(equipe.length, taille[0], taille[1]);
      g.vues = vues;
      for (var vi = 0; vi < equipe.length; vi++) {
        var sj = equipe[vi].player.state;
        equipe[vi].vue = vues[vi];
        render.setCamera({ x: sj.pos.x, y: sj.pos.y + player.EYE, z: sj.pos.z },
                         sj.yaw, sj.pitch, vi);
      }
      var s2 = player.state;
      // relief lointain, météo, distance de vue
      grille.recentrer(s2.pos.x, s2.pos.z);
      grille.avancer(LOINTAIN_BUDGET);
      render.majLointain(grille);
      majMeteo(dt);
      if (st === 'playing' || st === 'ui') { ajusterVue(dt); peuplerLieux(dt); annoncerLieu(); majHistoire(dt); }
      var submerged = P.headInWater(world, s2.pos, player.EYE);
      render.updateAmbience(g.time, submerged);
      render.updateTorches(world);
      render.renderViews(vues);
      ui.placerHuds(vues);

      frames++; acc += dt;
      if (acc >= 0.4) {
        g.fps = Math.round(frames / acc);
        frames = 0; acc = 0;
      }
      for (var hi = 0; hi < equipe.length; hi++) ui.updateHUDJoueur(g, equipe[hi].player, hi);
      ui.barreBoss(st === 'playing' || st === 'ui' ? gardienProche() : null);
      ui.boussole(st === 'playing' ? world.reperes : null, player.state);
      render.syncReperes(world.reperes);
      ui.updateHUD(g);
    }

    window.addEventListener('resize', render.resize);
    window.addEventListener('beforeunload', function () { if (g.spawnPoint) doSave(false); });

    // démarrage : menu, monde prêt derrière
    placeAtSpawn();
    afficherMenu();
    requestAnimationFrame(frame);

    return g;
  }

  MC.createGame = createGame;
})(typeof globalThis !== 'undefined' ? globalThis : this);
