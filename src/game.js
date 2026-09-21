/* game.js — orchestration : boucle, streaming des chunks, machine à états,
   et câblage entre entrées, monde, joueur, entités et interface. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core, P = MC.Physics, Inv = MC.Inventory, DC = MC.DayCycle;
  var B = C.B, I = C.I;

  var GEN_BUDGET = 2, MESH_BUDGET = 2;     // par frame, pour ne pas saccader
  var SPAWN_INTERVAL = 3.5;

  function createGame(host) {
    var atlas = MC.buildAtlas();
    var render = MC.createRenderer(host, atlas, { renderDist: 5 });
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
        var cx = Math.floor(x / 16), cz = Math.floor(z / 16);
        if (world.chunks.has(world.key(cx, cz))) world.setBlock(x, y, z, id);
      },
      onChat: function (m) { chat.recevoir(m); },
      onArrive: function (m) { chat.systeme(m.nom + ' a rejoint'); },
      onQuitte: function (m) { chat.systeme((m.nom || 'Un joueur') + ' est parti'); },
      onEtat: function (m) { if (typeof m.heure === 'number') g.time = m.heure; },
      onStatut: function (e, info) {
        if (e === 'en ligne') ui.toast('En ligne');
        else if (e === 'erreur') ui.toast('Reseau : ' + (info || 'erreur'), 'warn');
        else if (e === 'hors ligne' && info) {
          ui.toast('Reseau : ' + info + ' — retour en solo', 'warn');
          chat.systeme('Connexion perdue. La partie continue en solo.');
        }
      },
    });

    var g = {
      world: world, entities: entities, player: player, render: render,
      time: 60, fps: 0, furnaces: furnaces, chests: chests, audio: audio, chat: chat,
      equipe: equipe, regles: regles, vues: [], nbLocaux: 1, net: net,
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
      onCharger: chargerPartie,
      onSupprimer: supprimerPartie,
      onCreer: creerPartie,
      onRejoindre: rejoindreServeur,
    });

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
      regles = MC.Modes.regles(meta.mode, meta.difficulte);
      g.regles = regles;
      ui.setRegles(regles);
      g.graine = meta.graine;
    }

    function creerPartie(opts) {
      var st = storage();
      if (!st) { ui.toast('Stockage indisponible', 'warn'); return; }
      var graine = MC.Modes.graineDepuisTexte(opts.graineTexte);
      var meta = MC.Saves.creer(st, {
        nom: opts.nom, mode: opts.mode, difficulte: opts.difficulte, graine: graine,
      });
      appliquerPartie(meta);
      // le monde doit repartir de la bonne graine
      world = MC.createWorld(meta.graine);
      reconstruireDependances();
      world.reset(render.disposeChunk);
      entities.list.length = 0;
      render.libererToutesEntites();
      for (var k in furnaces) delete furnaces[k];
      for (var k2 in chests) delete chests[k2];
      g.time = 60;
      composerEquipe(opts.joueurs || 1, regles);
      chat.vider();
      chat.systeme('Nouvelle partie « ' + meta.nom + ' » — graine ' + meta.graine);
      ui.toast('Partie créée');
      input.setState('playing');
    }

    function chargerPartie(id) {
      var st = storage();
      if (!st) return;
      var meta = MC.Saves.trouver(st, id);
      if (!meta) { ui.toast('Partie introuvable', 'warn'); return; }
      appliquerPartie(meta);
      world = MC.createWorld(meta.graine);
      reconstruireDependances();
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
      input.setState('playing');
      net.connecter(opts.hote, opts.pseudo, opts.joueurs || 1);
    }

    /* Le monde est recree a chaque partie (graine differente) : entites,
       joueur et registres doivent le suivre, sinon ils pointent sur l ancien. */
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
    function streamChunks(unlimited) {
      var s = player.state;
      var pcx = Math.floor(s.pos.x / C.CHUNK_X), pcz = Math.floor(s.pos.z / C.CHUNK_Z);
      var R = render.RENDER_DIST;
      var wanted = [];
      for (var dx = -R; dx <= R; dx++) for (var dz = -R; dz <= R; dz++) {
        var d2 = dx * dx + dz * dz;
        if (d2 > R * R) continue;
        wanted.push([d2, pcx + dx, pcz + dz]);
      }
      wanted.sort(function (a, b) { return a[0] - b[0]; });

      var genMax = unlimited ? 1e9 : GEN_BUDGET, meshMax = unlimited ? 1e9 : MESH_BUDGET;
      var gen = 0;
      for (var i = 0; i < wanted.length && gen < genMax; i++) {
        var cx = wanted[i][1], cz = wanted[i][2];
        if (world.chunks.has(world.key(cx, cz))) continue;
        world.getChunk(cx, cz, true);
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) {
          var n = world.chunks.get(world.key(cx + o[0], cz + o[1]));
          if (n) n.dirty = true;
        });
        gen++;
      }

      var meshed = 0;
      for (var j = 0; j < wanted.length && meshed < meshMax; j++) {
        var mx = wanted[j][1], mz = wanted[j][2];
        var c = world.chunks.get(world.key(mx, mz));
        if (!c || !c.dirty) continue;
        // on n'affiche un chunk que si ses 4 voisins existent : sinon des
        // faces de bordure seraient maillées à tort et l'on verrait des coutures
        if (!world.chunks.has(world.key(mx + 1, mz)) || !world.chunks.has(world.key(mx - 1, mz)) ||
            !world.chunks.has(world.key(mx, mz + 1)) || !world.chunks.has(world.key(mx, mz - 1))) continue;
        render.syncChunk(world, c);
        meshed++;
      }

      world.unloadFar(pcx, pcz, R + 2, render.disposeChunk);
    }

    function remeshDirtyNear() {
      var s = player.state;
      var pcx = Math.floor(s.pos.x / C.CHUNK_X), pcz = Math.floor(s.pos.z / C.CHUNK_Z);
      var done = 0;
      world.chunks.forEach(function (c) {
        if (done >= 3 || !c.dirty) return;
        if (Math.abs(c.cx - pcx) > 2 || Math.abs(c.cz - pcz) > 2) return;
        render.syncChunk(world, c);
        done++;
      });
    }

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
      var ch = chests[k];
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

    function onAttack() {
      if (input.state !== 'playing') return;
      var e = entities.aimedAt(player.eyePos(), player.lookDir(), player.REACH);
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
        var tir = player.tirer();
        if (tir) {
          audio.play('frapper');
          if (tir.toolBroke) ui.toast("Votre arc s'est brisé", 'warn');
        } else ui.toast('Plus de munitions', 'warn');
        return;
      }

      // interagir avec un PNJ a priorité sur le bloc derrière lui
      var ent = entities.aimedAt(player.eyePos(), player.lookDir(), player.REACH);
      if (ent && entities.SPECS[ent.type].npc) {
        ui.openContainer('trade', player.state.inv, null, ent.eid);
        input.setState('ui');
        return;
      }

      var target = player.aim();
      if (!target) return;
      var res = player.useOn(target);
      if (!res) return;
      if (res.indexOf('open:') === 0) {
        var kind = res.slice(5);
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
        return;
      }
      if (res === 'place' && net.enLigne()) {
        // le serveur fait autorite : on lui annonce la pose
        var bx = target.x + target.nx, by = target.y + target.ny, bz = target.z + target.nz;
        net.poserBloc(bx, by, bz, world.getBlock(bx, by, bz));
      }
      if (res === 'place') audio.play('poser');
      else if (res === 'eat') audio.play('manger');
      else if (res === 'till') { audio.play('poser'); ui.toast('Terre labourée'); }
      else if (res === 'plant') { audio.play('poser'); ui.toast('Graines plantées'); }
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
      } else if (code === 'KeyT') {
        chat.ouvrir();
        input.setSaisie(true);
      } else if (code === 'Slash') {
        chat.ouvrir(); chat.saisie = '/';
        input.setSaisie(true);
      } else if (code === 'KeyM') {
        ui.toast(audio.setEnabled(!audio.enabled) ? 'Son activé' : 'Son coupé');
      } else if (code === 'KeyG') {
        // G et non Q : sur AZERTY, Q est déjà la touche « aller à gauche »
        var d = player.dropSelected(1);
        if (d) { ui.toast('Jeté : ' + C.nameOf(d.id)); audio.play('poser'); }
      }
    }

    function onKeyAnyState(code) {
      if (input.state !== 'ui') return;
      if (code === 'KeyE') closeUI();
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
      forceCloseContainer();
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

      if (st.dead) return;
      pl.updateMovement(dt, touches);
      // on ne traverse pas les creatures : la separation vient APRES le
      // deplacement, sinon le joueur entre puis ressort en tremblant
      entities.separer(st, dt);
      pl.updateSurvival(dt);

      // visee et actions
      var cible = pl.aim();
      var mob = entities.aimedAt(pl.eyePos(), pl.lookDir(), pl.REACH);
      var casse = j.source === 'clavier' ? input.mouse.left
                                         : !!(man && man.boutons().casser);
      var utilise = j.source === 'clavier' ? input.mouse.right
                                           : !!(man && man.boutons().utiliser);

      if (casse && cible && !mob) {
        var pos = { x: cible.x, y: cible.y, z: cible.z };
        var res = pl.mineTick(dt, cible);
        if (res) {
          if (net.enLigne()) net.poserBloc(pos.x, pos.y, pos.z, 0);
          if (C.BLOCKS[res.id] && C.BLOCKS[res.id].interactive) spillContainer(pos.x, pos.y, pos.z);
          audio.play(res.toolBroke ? 'brise' : 'casser');
          if (res.drops.length === 0 && C.BLOCKS[res.id] && C.BLOCKS[res.id].needsTool)
            ui.toast('Il faut un outil adapte pour recuperer ce bloc', 'warn');
        }
      } else if (!casse) pl.cancelMining();

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
        if (man.vientDAppuyer(man.BTN.VOL)) { st.flying = !st.flying; st.vel.y = 0; }
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
      var target = pl.aim();
      if (!target) return;
      var res = pl.useOn(target);
      if (!res) return;
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

      if (actif) {
        // chaque joueur local est simule, quelle que soit sa source d'entrees
        for (var qi = 0; qi < equipe.length; qi++) simulerJoueur(equipe[qi], dt);

        // entites et butin : le butin va au joueur le plus proche
        var ev = entities.update(dt, player.state, {});
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

        // temps, apparitions, cultures
        g.time += dt;
        g.duree = (g.duree || 0) + dt;
        world.tick(dt, 14);
        spawnT += dt;
        if (spawnT >= SPAWN_INTERVAL) {
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
        if (MC.Split.partiePerdue(equipe, regles)) { perdrePartie(); }
        else if (MC.Split.tousMorts(equipe)) { audio.play('mort'); input.setState('dead'); }
      } else if (st === 'ui') {
        // l'inventaire est ouvert : le monde continue doucement (fourneaux, cultures)
        world.tick(dt, 14);
        for (var fk2 in furnaces) if (Inv.tickFurnace(furnaces[fk2], dt)) ui.refreshFurnace();
        render.setHighlight(null);
      } else {
        render.setHighlight(null);
      }

      if (net.enLigne()) {
        net.pousserPosition(dt, player.state);
        net.interpoler(dt);
      }
      /* On passe TOUJOURS l objet reseau, meme hors ligne : ses tables sont
         alors vides et la meme boucle de reconciliation retire les maillages
         des joueurs partis. Appeler la synchronisation seulement en ligne
         laissait des joueurs fantomes dans la scene apres une deconnexion. */
      render.syncEntities(entities, net);

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
