/* game.js — orchestration : boucle, streaming des chunks, machine à états,
   et câblage entre entrées, monde, joueur, entités et interface. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core, P = MC.Physics, Inv = MC.Inventory, DC = MC.DayCycle;
  var B = C.B, I = C.I;

  var GEN_BUDGET = 2, MESH_BUDGET = 2;     // par frame, pour ne pas saccader
  var LOINTAIN_BUDGET = 1200;              // colonnes lointaines échantillonnées par frame
  var PROCHE_SIMPLE = 6;                   // en chunks : en deçà, toujours le maillage complet

  /* SPEC-PERF-006/007 : dossier de src/*.js, calculé à partir de l'URL de CE
     script — index.html le sert depuis 'src/', tests/index.html depuis
     '../src/' : les workers (src/worker-monde.js, src/worker-maillage.js)
     doivent être demandés au même endroit, avec le même jeton anti-cache
     `?v=` que le reste (window.MC_VERSION, ou un jeton local si absent —
     banc de test). */
  var BASE_SRC = (function () {
    var s = typeof document !== 'undefined' ? document.currentScript : null;
    if (s && s.src) return s.src.replace(/[^/]*(\?.*)?$/, '');
    return 'src/';
  })();
  var JETON_VERSION = (typeof window !== 'undefined' && window.MC_VERSION) || String(Date.now());
  function urlWorker(nom) { return BASE_SRC + nom + '.js?v=' + JETON_VERSION; }

  /* `options.poste` (MC.Poste, fourni par index.html) est la liaison avec le
     serveur de jeu local : quand il est présent, TOUT passe par le serveur
     (parties sur disque, monde, pause) ; la page de test (tests/index.html) ne
     le fournit pas et garde la simulation locale historique tant que les lots
     B-* d'élimination des branches `net.enLigne()` n'ont pas tout retiré. */
  function createGame(host, options) {
    var poste = (options && options.poste) || null;
    var atlas = MC.buildAtlas();

    /* SPEC-OPTION-008 : l'espace de rendu ne descend jamais sous 800×600,
       quel que soit `host` (fenêtre réduite, cadre d'un banc de test, ancien
       hôte 640×400…) — une SURFACE interne, posée dans `host`, garde
       toujours au moins ce plancher (rendu, HUD, menus, dialogues : tout
       vit dedans, jamais dans `host` directement) ; si `host` est plus
       petit, la surface le dépasse et s'affiche réduite par une
       transformation CSS (échelle uniforme, centrée, rapport d'aspect
       conservé — les clics restent justes : le navigateur fait déjà cette
       correction lui-même pour tout événement souris). Limité à ce seul
       dimensionnement : le reste du rendu (render.js) est repris ailleurs. */
    var PLANCHER_L = 800, PLANCHER_H = 600;
    var surface = document.createElement('div');
    surface.className = 'mc-surface';
    surface.style.position = 'absolute';
    surface.style.transformOrigin = 'top left';
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(surface);
    function redimensionnerSurface() {
      var hw = host.clientWidth || PLANCHER_L, hh = host.clientHeight || PLANCHER_H;
      var l = Math.max(PLANCHER_L, hw), h = Math.max(PLANCHER_H, hh);
      surface.style.width = l + 'px';
      surface.style.height = h + 'px';
      var echelle = Math.min(hw / l, hh / h) || 1;
      surface.style.transform = echelle < 1 ? 'scale(' + echelle + ')' : 'none';
      surface.style.left = Math.round((hw - l * echelle) / 2) + 'px';
      surface.style.top = Math.round((hh - h * echelle) / 2) + 'px';
    }
    redimensionnerSurface();
    window.addEventListener('resize', redimensionnerSurface);

    // le GPU se choisit avant de créer le rendu (SPEC-OPTION-004)
    var optionsLues = MC.Options ? MC.Options.charger((function () { try { return window.localStorage; } catch (e) { return null; } })()) : null;
    var render = MC.createRenderer(surface, atlas, { renderDist: 6,
      powerPreference: optionsLues ? MC.Options.preferenceGpu(optionsLues.gpu) : undefined,
      // SPEC-RENDU-001/002 : le message et l'arrêt du rendu passent par l'UI ;
      // les maillages de chunks visibles sont remis en file (dirty), le reste
      // (textures, matériaux, render targets) se reconstruit dans render.js
      onContextLost: function () { if (ui) ui.contextePerdue(true); },
      onContextRestored: function () {
        world.chunks.forEach(function (c) { c.dirty = true; });
        if (ui) ui.contextePerdue(false);
      } });
    render.gpuAuLancement = optionsLues ? optionsLues.gpu : 'auto';
    var canvas = render.renderer.domElement;

    var SEED = 20260921;
    var world = MC.createWorld(SEED);

    /* SPEC-PERF-004 à 010 : génération et maillage en Web Workers, avec
       repli synchrone (SPEC-PERF-006) si `Worker` est indisponible (file://,
       CSP), ne peut pas être créé, ou tombe en erreur de façon répétée.
       `fileChunks` (pur, testé sous Node — src/file-chunks.js) ordonnance
       les deux ; les pools eux-mêmes vivent ici (navigateur seulement). */
    var fileChunks = MC.FileChunks.creer({
      integrationsGenParImage: GEN_BUDGET, integrationsMailleParImage: MESH_BUDGET,
    });
    // SPEC-PERF-007 : un seul worker de génération (chaque worker a SES
    // propres caches de bruit) ; le maillage se répartit sur plusieurs
    var NB_WORKERS_MAILLAGE = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency)
      ? Math.min(Math.max(1, navigator.hardwareConcurrency - 1), 4) : 2;
    var poolGeneration = null, poolMaillage = null;
    // requêtes de maillage en vol : simplifié demandé, pour reposer sur le
    // chunk à l'intégration (le message `maillage` ne le reporte pas)
    var simplifieEnVol = Object.create(null);
    // SPEC-SERVEUR-009 : chunks dont les overrides ont déjà été demandés au
    // serveur (net.demanderOverrides) — évite de redemander à chaque image
    // tant que la réponse n'est pas arrivée ni le chunk déchargé/rechargé.
    var overridesDemandes = Object.create(null);
    // débit des demandes d'overrides, sous le budget anti-flood du serveur
    // (FLOOD_MAX_GENERAL = 30/s, server.js) — voir streamChunks.
    var OVERRIDES_DEMANDE_BUDGET = 20;
    var overridesFenetreDebut = 0, overridesFenetreN = 0;
    var erreursGen = 0, erreursMaille = 0;
    function fermerPools() {
      if (poolGeneration) { poolGeneration.fermer(); poolGeneration = null; }
      if (poolMaillage) { poolMaillage.fermer(); poolMaillage = null; }
    }
    function onMessagePool(genre, data) {
      if (data && data.type === 'erreur') {
        var ferme = false;
        if (data.cx !== undefined) {
          // le worker a répondu (il fonctionne) mais CETTE tâche a échoué :
          // elle revient en jeu, et 3 échecs d'affilée coupent le pool
          fileChunks.echec(genre, data.cx, data.cz);
          if (genre === 'genere') { erreursGen++; if (erreursGen >= 3 && poolGeneration) { poolGeneration.fermer(); poolGeneration = null; ferme = true; } }
          else { erreursMaille++; if (erreursMaille >= 3 && poolMaillage) { poolMaillage.fermer(); poolMaillage = null; ferme = true; } }
        } else {
          /* SPEC-PERF-006 : un `error` natif du Worker (script introuvable,
             CSP, exception non rattrapée) — pas de cx/cz, donc rien à
             remettre en jeu précisément, et rien ne garantit qu'un second
             `error` arrivera un jour pour ce même worker (un worker mort
             reste juste silencieux). On coupe IMMÉDIATEMENT, sans attendre
             3 coups qui ne viendraient jamais — mieux vaut basculer trop
             tôt sur le repli synchrone que rester bloqué. */
          if (genre === 'genere' && poolGeneration) { poolGeneration.fermer(); poolGeneration = null; ferme = true; }
          else if (genre === 'maille' && poolMaillage) { poolMaillage.fermer(); poolMaillage = null; ferme = true; }
        }
        /* Un pool coupé laisse potentiellement des tâches « en vol » dont
           personne ne répondra plus jamais — nouvelle époque = elles
           retombent dans la file au prochain `voulus()`, le repli
           synchrone (ou l'autre pool encore vivant, ré-initialisé) les
           reprend. */
        if (ferme) { simplifieEnVol = Object.create(null); reinitialiserPools(); }
        return;
      }
      if (genre === 'genere') erreursGen = 0; else erreursMaille = 0;
      fileChunks.recu(data, function (cx, cz) {
        var c = world.chunks.get(world.key(cx, cz));
        return c ? c.version : -1;
      });
    }
    function demarrerPools() {
      fermerPools();
      if (!MC.Workers || !MC.Workers.disponible()) return;
      poolGeneration = MC.Workers.creerPool({
        script: urlWorker('worker-monde'), taille: 1,
        onMessage: function (d) { onMessagePool('genere', d); },
        onErreur: function () { onMessagePool('genere', { type: 'erreur' }); },
      });
      poolMaillage = MC.Workers.creerPool({
        script: urlWorker('worker-maillage'), taille: NB_WORKERS_MAILLAGE,
        onMessage: function (d) { onMessagePool('maille', d); },
        onErreur: function () { onMessagePool('maille', { type: 'erreur' }); },
      });
      var initMsg = { type: 'init', epoque: fileChunks.epoque, graine: SEED, options: { zonePolitique: null }, v: MC.ContratsV2.VERSION };
      // `diffuser`, jamais `envoyer` : un `init` doit atteindre TOUT le pool
      // (chaque worker a sa propre `epoqueCourante`), pas un seul worker
      // libre — voir la note de src/workers.js `diffuser`.
      if (poolGeneration) poolGeneration.diffuser(initMsg);
      if (poolMaillage) poolMaillage.diffuser(initMsg);
    }
    demarrerPools();
    /* SPEC-PERF-009 : nouvelle époque + réinitialisation des workers déjà
       créés (même graine ou nouvelle) — partagée par remplacerMonde(),
       newWorld() et perdrePartie() (tout ce qui vide/remplace `world`). */
    function reinitialiserPools(zonePolitique) {
      var epoque = fileChunks.nouvelleEpoque();
      var initMsg = { type: 'init', epoque: epoque, graine: world.seed,
                       options: { zonePolitique: zonePolitique || null }, v: MC.ContratsV2.VERSION };
      if (poolGeneration) poolGeneration.diffuser(initMsg);
      if (poolMaillage) poolMaillage.diffuser(initMsg);
    }

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
    var chests = Object.create(null);
    // SPEC-INTERIEUR-002 : ce qu'exposent les présentoirs et les socles, par
    // position (« x,y,z » -> pile { id, n, data } ou undefined si vide).
    var expositions = Object.create(null);
    // SPEC-MECA-001 : petit conteneur (9 cases) d'un distributeur, indexé
    // comme les coffres — hors ligne uniquement (voir server.js en ligne).
    var distributeurs = Object.create(null);
    /* B1 (étape 8, docs/vague-2/B1.md § 6) : miroir client du conteneur posé
       (ou de la banque) actuellement ouvert EN LIGNE — { cle, mirror } où
       `mirror` est un conteneur `{ type, rev, slots, four? }`, la MÊME
       référence que `ui.container.cont` (jamais remplacée, seulement
       mutée : `operer` y applique la prédiction, `onConteneurEtat`/
       `onConteneurMaj`/`onInvMaj` la corrigent). `null` hors ligne ou entre
       deux ouvertures. Un seul conteneur ouvert à la fois (même règle que le
       serveur, § 7). */
    var conteneurOuvert = null;
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
          remplacerMonde(m.graine, { zonePolitique: m.zone });
          composerEquipe(equipe.length || 1, regles);
          ui.toast('Graine du serveur : ' + m.graine + ' — monde reconstruit');
        } else {
          if (m.zone && world.accorderPolitiqueZone) {
            // même graine : on aligne juste la carte des zones sur celle du serveur
            world.accorderPolitiqueZone(m.zone);
          }
          // SPEC-SERVEUR-009 : une reconnexion au même monde (même graine) ne
          // rebâtit rien, donc les chunks déjà chargés avant la coupure ne
          // repasseront JAMAIS par le chemin « nouvellement voulu » de
          // streamChunks — sans ce vidage, un bloc modifié par un autre
          // joueur pendant la déconnexion, dans un chunk déjà chargé avant
          // elle, ne serait plus jamais redemandé ni reçu. On force donc une
          // redemande complète de tous les chunks déjà en mémoire.
          overridesDemandes = Object.create(null);
        }
        g.time = m.heure || 0;
        (m.blocs || []).forEach(function (b) {
          var cx = Math.floor(b[0] / 16), cz = Math.floor(b[2] / 16);
          world.getChunk(cx, cz, true);
          world.setBlock(b[0], b[1], b[2], b[3]);
          if (b[4]) world.setEtat(b[0], b[1], b[2], b[4]);
        });
        (m.chat || []).forEach(function (c) { chat.recevoir(c); });
        chat.systeme('Connecte au serveur (' + (m.joueurs || []).length + ' autre(s) joueur(s))');
      },
      onBloc: function (x, y, z, id, etat) {
        // autorite serveur : on applique sans discuter, meme si l on avait
        // predit autre chose localement
        /* Chunk absent : on le génère pour y appliquer le bloc. L'ignorer
           perdait la modification — on retrouvait plus tard un terrain qui
           ne correspondait plus à celui du serveur (blocs fantômes). */
        var cx = Math.floor(x / 16), cz = Math.floor(z / 16);
        world.getChunk(cx, cz, true);
        world.setBlock(x, y, z, id);
        if (etat) world.setEtat(x, y, z, etat);
      },
      // SPEC-SERVEUR-009 : overrides d'un chunk demandé (BIENVENUE ne porte
      // plus qu'un voisinage borné) — même application qu'onBloc, un à un.
      onOverridesChunk: function (cx, cz, blocs) {
        world.getChunk(cx, cz, true);
        blocs.forEach(function (b) {
          world.setBlock(b[0], b[1], b[2], b[3]);
          if (b[4]) world.setEtat(b[0], b[1], b[2], b[4]);
        });
      },
      onChat: function (m) { chat.recevoir(m); },
      onArrive: function (m) { chat.systeme(m.nom + ' a rejoint'); },
      onQuitte: function (m) { chat.systeme((m.nom || 'Un joueur') + ' est parti'); },
      /* B4 (SPEC-PVP-001 à 006) : le serveur fait foi sur tous les enjeux
         PvP — ce hook ne fait qu'afficher, jamais recalculer. `victoire`
         alimente les succès (SPEC-SUCCES-001), les autres évènements sont de
         simples messages système dans le chat. */
      onPvp: function (m) {
        switch (m.evt) {
          case 'victoire':
            chat.systeme('Victoire contre ' + (m.contre || '?') + ' (' + (m.n || 0) + ' au total).');
            signalerSucces({ type: 'pvp_victoire', n: m.n });
            break;
          case 'defaite': {
            var perte = (m.perte || []).reduce(function (a, p) { return a + p.n; }, 0);
            chat.systeme('Vaincu par ' + (m.de || '?') + (perte ? ' — ' + perte + ' objet(s) perdu(s)' : '') + '.');
            if (perte) ui.toast('-' + perte + ' objet(s) (défaite PvP)', 'warn');
            break;
          }
          case 'duel_propose':
            chat.systeme((m.de || '?') + ' vous propose un duel — /duel accepter ou /duel refuser (30 s).');
            break;
          case 'duel_debut':
            chat.systeme('Duel commencé contre ' + (m.contre || '?') + '.');
            break;
          case 'duel_fin':
            chat.systeme('Duel terminé avec ' + (m.contre || '?') + '.');
            break;
          case 'reputation':
            chat.systeme('Réputation politique dégradée : ' + (m.factions || []).map(function (f) { return f.id + ' (' + f.valeur + ')'; }).join(', '));
            break;
          case 'hors_la_loi':
            ui.toast('Hors-la-loi : embargo commercial sur le territoire concerné', 'warn');
            chat.systeme('Vous êtes désormais hors-la-loi auprès de : ' + (m.factions || []).map(function (f) { return f.id; }).join(', '));
            break;
        }
      },
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
        else if (e === 'erreur') { if (!(poste && attenteTerrain && info === 'poste_deja_connecte')) ui.toast('Reseau : ' + (info || 'erreur'), 'warn'); }
        else if (e === 'hors ligne') {
          if (info && poste) {
            // il n'y a plus de « solo » local : sans serveur, on retourne au menu, qui dit ce qui se passe
            ui.toast('Connexion au serveur perdue', 'warn');
            if (!arrete && !attenteTerrain && input.state !== 'menu') input.setState('menu');
          } else if (info) {
            ui.toast('Reseau : ' + info + ' — retour en solo', 'warn');
            chat.systeme('Connexion perdue. La partie continue en solo.');
          }
          // B1 : l'inventaire/équipement solo d'avant connexion est rendu,
          // que la coupure soit volontaire ou non (B1.md § 6)
          restaurerInventaireSolo();
        }
      },
      // panneau admin en jeu (SPEC-ADMIN-006) : la réponse du serveur s'affiche
      // dans le chat, seule surface déjà présente pour du texte libre
      onAdminRep: function (m) {
        if (m.ok && m.action === 'heure') return;      // l'heure suit par ETAT ; la commande a déjà répondu
        if (!m.ok && m.action === 'heure') {
          chat.systeme(m.erreur === 'reserve_creatif_ou_admin'
            ? 'Refusé : l\'heure ne se règle qu\'en mode créatif ou en administrateur.' : '/heure — refusé (' + m.erreur + ')');
          return;
        }
        if (!m.ok) { chat.systeme('/admin ' + m.action + ' — refusé' + (m.erreur ? ' (' + m.erreur + ')' : '')); return; }
        chat.systeme('/admin ' + m.action + ' → ' + JSON.stringify(m.data).slice(0, 400));
      },
      /* L45, SPEC-SYNC-023 : offres à jour d'un PNJ (réponse à 'consulter' ou
         'echanger') — ne redessine que si c'est CE PNJ qui est ouvert. */
      onTroc: function (m) {
        if (!ui.container || ui.container.kind !== 'trade' || ui.container.pos !== m.eid) return;
        var pnj = ui.container.pnj;
        if (!pnj) return;
        pnj.offres = m.offres || [];
        if (m.cours !== undefined) pnj.cours = m.cours;
        if (m.remise !== undefined) pnj.remise = m.remise;
        ui.renderContainer();
      },
      /* B1 (SPEC-SYNC-008) : le serveur fait foi sur l'inventaire, l'équipement
         et la grille de fabrication — un `rev` périmé est ignoré, `ack` purge
         la file de prédiction de ce joueur local, et l'état affiché repart du
         confirmé + rejeu des opérations encore en attente. Écrit TOUJOURS en
         place (`inv.load`) : `ui.js` garde des références (B1.md § 12). */
      onInvMaj: function (m) {
        var v = MC.ContratsV2.validerInvMaj(m);
        if (!v) return;
        var j = equipe[v.j];
        if (!j || !j.predInv) return;
        if (typeof j.revInv === 'number' && v.rev <= j.revInv) return;
        j.revInv = v.rev;
        var st = j.player.state, CV = MC.ContratsV2;
        st.inv.load(v.inv);
        // la grille fait partie de l'état confirmé : sans elle, un transfert
        // inv→grille refusé par le serveur laisse un objet fantôme dans la grille
        if (st.grille) st.grille.load(v.grille);
        CV.EQUIP_SLOTS.forEach(function (s) { st.equip[s] = CV.caseVersPile(v.equip[s]); });
        j.predInv.confirmer(v.ack);
        // Revue adversariale (item 4) : sans le miroir du conteneur EN LIGNE
        // actuellement ouvert, une opération encore en attente sur la zone
        // 'cont' (transfert vers/depuis un coffre) échouait au rejeu
        // (`conteneur: () => null`) — avec elle aussi, en plus de son côté
        // inventaire (déjà rejoué avant ce correctif).
        var conteneursPourRejeu = (conteneurOuvert && j.index === 0)
          ? (function () { var o = {}; o[conteneurOuvert.cle] = conteneurOuvert.mirror; return o; })() : {};
        j.predInv.rejouer(st, conteneursPourRejeu, { regles: regles });
        if (v.gain && j.index === 0) { ui.toast('+' + v.gain.n + ' ' + C.nameOf(v.gain.id)); audio.play('ramasser'); }
        // B1 (étape 8) : le delta d'un conteneur touché par NOTRE propre
        // opération voyage dans CE message (SYNC-015) — jamais un CONTENEUR_MAJ
        // séparé pour l'auteur, qui clignoterait.
        (v.conteneurs || []).forEach(appliquerDeltaConteneur);
      },
      /* B1 (étape 7-8, SPEC-SYNC-012/013) : le serveur vient d'accepter notre
         CONTENEUR_OUVRIR — état complet, c'est maintenant qu'on ouvre l'écran
         (jamais avant : rien à afficher tant qu'on ne sait pas ce qu'il y a
         dedans, docs/vague-2/B1.md § 6). */
      onConteneurEtat: function (m) {
        var v = MC.ContratsV2.validerConteneurEtat(m);
        if (!v || v.j !== 0) return;
        var mirror = { cle: v.cle, type: v.type, rev: v.rev,
                       slots: v.slots.map(MC.ContratsV2.caseVersPile) };
        if (v.four) mirror.four = { burn: v.four.burn, cook: v.four.cook };
        conteneurOuvert = { cle: v.cle, mirror: mirror };
        var kindUi = v.type === 'furnace' ? 'furnace' : v.type === 'distributeur' ? 'distributeur' : 'chest';
        ui.openContainer(kindUi, player.state.inv, null, v.cle, undefined, mirror);
        input.setState('ui');
      },
      // delta d'un conteneur touché par un AUTRE joueur (SYNC-015) — écrit en
      // place dans le miroir déjà affiché par l'UI, jamais un nouvel objet.
      onConteneurMaj: function (m) {
        var v = MC.ContratsV2.validerConteneurMaj(m);
        if (v) appliquerDeltaConteneur(v);
      },
      /* Revue adversariale (item 3) : le serveur force la fermeture d'un
         conteneur qu'on avait ouvert (cassé, éventuellement remplacé par un
         autre type au même endroit) — jamais de resubscription fantôme :
         `game.operer` ne verra plus JAMAIS `conteneurOuvert.cle` pour cette
         clé après ce message, et l'écran se referme si c'est lui d'affiché. */
      onConteneurFerme: function (m) {
        if (!conteneurOuvert || typeof m.cle !== 'string' || conteneurOuvert.cle !== m.cle) return;
        conteneurOuvert = null;
        if (ui.container && ui.container.cont && ui.container.cont.cle === m.cle) {
          ui.closeContainer();
          if (input.state === 'ui') input.setState('playing');
          ui.toast('Le conteneur a disparu', 'warn');
        }
      },
    });
    /* Applique un delta serveur (`{ cle, rev, maj, four? }`, INV_MAJ.conteneurs
       ou CONTENEUR_MAJ) au miroir du conteneur EN LIGNE actuellement ouvert —
       ignoré s'il ne concerne pas ce conteneur, ou si son `rev` est périmé. */
    function appliquerDeltaConteneur(d) {
      if (!conteneurOuvert || conteneurOuvert.cle !== d.cle) return;
      var m = conteneurOuvert.mirror;
      if (d.rev <= m.rev) return;
      d.maj.forEach(function (e) { m.slots[e[0]] = MC.ContratsV2.caseVersPile(e[1]); });
      if (d.four) m.four = d.four;
      m.rev = d.rev;
      ui.refreshFurnace();
    }

    // registre d'affichage du HUD (SPEC-HUD-001) : conservé d'une partie à
    // l'autre via localStorage, quand il est disponible
    var hudStockage = (function () { try { return window.localStorage; } catch (e) { return null; } })();
    var hud = MC.Hud.creerRegistre(hudStockage);

    var g = {
      world: world, entities: entities, player: player, render: render,
      time: 60, fps: 0, chests: chests, expositions: expositions, distributeurs: distributeurs,
      audio: audio, chat: chat,
      equipe: equipe, regles: regles, vues: [], nbLocaux: 1, net: net, hud: hud,
      disposeChunk: render.disposeChunk,
      succes: MC.Succes.creer(),
      // factions de joueurs hors ligne (joueurs locaux), sauvegardées avec la partie
      guildes: MC.Guildes ? MC.Guildes.creerEtat() : undefined,
      // L45 : prix dynamiques, trésors de lieux, métiers (SPEC-ECO/METIER) —
      // même module et même état joués à l'identique en solo et en ligne
      // SPEC-PERF-015 : métriques de rendu, calculées en continu indépendamment
      // du panneau F3 qui les affiche (SPEC-PERF-016)
      perf: { msGeneration: 0, msMaillage: 0, appelsDessin: 0, triangles: 0, fps: 0, fpsP50: 0, fpsP95: 0, renderDist: render.RENDER_DIST },
    };

    // ── SPEC-RENDU-005 à 008, 015 : boucle de qualité adaptative ───────────
    // Une seule fenêtre glissante de FPS (g.fps, moyenne 0,4 s déjà calculée
    // plus bas) nourrit À LA FOIS le panneau F3 (via g.perf) et la décision
    // d'adaptation : même source, comme l'exige SPEC-RENDU-015.
    var fenetreFPS = MC.Qualite ? MC.Qualite.creerFenetre(5) : null;
    var etatQualite = MC.Qualite ? MC.Qualite.creerEtat({
      // SPEC-RENDU-010/011 : un rendu logiciel détecté démarre au palier bas
      niveauInitial: render.materiel && render.materiel.renduLogiciel ? 99 : 0,
    }) : null;

    /* SPEC-SUCCES-001 : signale un événement au suivi de la partie ; ce qui
       vient de se débloquer s'annonce une seule fois (toast, chat, son). */
    function signalerSucces(ev) {
      var nouveaux = g.succes.signaler(ev);
      nouveaux.forEach(function (n) {
        ui.toast('Succès : ' + n.nom);
        chat.systeme('Succès débloqué : ' + n.nom + ' — ' + n.description);
        audio.jouer(MC.Ambiance.sonEvenement('succes'), { categorie: 'evenement' });
      });
      return nouveaux;
    }
    g.signalerSucces = signalerSucces;

    var ui = MC.createUI(surface, atlas, {
      onSelectSlot: selectSlot,
      onPlay: startGame,
      onResume: resume,
      onSave: function () {
        // le serveur sauvegarde à chaque pause (SPEC-ARCHI-012) : l'entrée dans ce menu l'a déjà fait
        if (poste) ui.toast('Partie sauvegardée par le serveur (à chaque pause, puis toutes les 45 s)');
        else doSave(true);
      },
      onQuit: toMenu,
      onRespawn: respawn,
      onSound: function (n) { audio.play(n); },
      onNouvelle: function () { ui.menuNouvelle(); },
      onMulti: function () { ui.menuMulti({ pseudo: g.nomJoueur }); },
      onRetourMenu: function () { afficherMenu(); },
      onContinuerFin: function () { continuerApresFin(); },
      onCharger: function (id) { return poste ? chargerPartieServeur(id) : chargerPartie(id); },
      onSupprimer: function (id) { return poste ? supprimerPartieServeur(id) : supprimerPartie(id); },
      onCreer: function (o) { return poste ? creerPartieServeur(o) : creerPartie(o); },
      onRejoindre: rejoindreServeur,
      // le poste : réseau à chaud, arrêt, import et export des parties (SPEC-ARCHI-005, 008, 015)
      onReseau: function (ouvrir) { changerReseau(ouvrir); },
      onArret: function () { quitterLeJeu(); },
      onImporterLocales: function () { importerPartiesLocales(); },
      onExporterLocales: function () { exporterPartiesLocales(); },
      onImporterFichier: function (texte) { importerFichierParties(texte); },
      onFabrique: function (id) { signalerSucces({ type: 'fabriquer', id: id }); },
      onEchange: function () { signalerSucces({ type: 'echange' }); },
      // B1 (docs/vague-2/B1.md § 6) : chaque interaction de l'écran
      // inventaire/établi (transfert, équipement, craft, fermeture de la
      // grille) passe par ici — toujours le joueur local 0, seul à avoir un
      // écran ouvert (voir `player` = equipe[0].player plus bas).
      onOperer: function (op, msgBase) { return operer(equipe[0], op, msgBase); },
      onSucces: function () { ui.panneauSucces(g.succes); input.setState('ui'); },
      // SPEC-OPTION-001 et 003 : réglages et touches
      options: function () { return g.options; },
      onOption: function (cle, v) { return reglerOption(cle, v); },
      onLier: function (action, code) { return lierTouche(action, code); },
      resolutions: function () {
        var d = g.disposition || { largeur: screen.width, hauteur: screen.height };
        return MC.Options.resolutionsPour({ largeur: d.largeur || screen.width, hauteur: d.hauteur || screen.height });
      },
      ecrans: function () { return g.ecrans; },
      detecterEcrans: function () { return g.detecterEcrans(); },
      onOptionsDefaut: function () { g.options = MC.Options.defauts(); MC.Options.sauver(hudStockage, g.options); appliquerOptions(); },
    }, hud);

    // SPEC-RENDU-011 : avertissement d'accélération matérielle absente, une
    // seule fois au démarrage — il peut être ignoré, il ne réapparaît jamais
    if (render.materiel && render.materiel.renduLogiciel) ui.avertirRenduLogiciel(render.materiel.nom);

    var input = MC.createInput(canvas, {
      peutJouer: function () { return !(ui.dialogueOuvert && ui.dialogueOuvert()); },
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

    /* Réglages du joueur (SPEC-OPTION-001, 003) : lus au démarrage, appliqués
       aussitôt qu'on les change, conservés avec l'affichage du HUD. */
    g.options = MC.Options.charger(hudStockage);
    /* Taille de référence pour l'échelle d'interface (SPEC-OPTION-007) : celle
       de l'hôte du rendu, pas forcément celle de la fenêtre — le banc de test
       y loge le jeu dans une surface virtuelle mise à l'échelle par CSS, plus
       petite que la fenêtre, et l'interface doit suivre CETTE taille, pas
       celle (bien plus grande) de la fenêtre du navigateur qui héberge le
       banc. `g.tailleVue()` reste le point d'entrée unique de cette mesure. */
    function tailleVue() {
      return { l: (surface && surface.clientWidth) || window.innerWidth, h: (surface && surface.clientHeight) || window.innerHeight };
    }
    g.tailleVue = tailleVue;
    function appliquerOptions() {
      var o = g.options;
      input.setSensibilite(o.sensibilite);
      input.setTouches(o.touches);
      audio.setVolume(o.volume);
      render.setChamp(o.champ);
      render.setOmbres(o.ombres);
      render.reglerRealiste(o.realiste);
      render.setMipmaps(!!o.mipmaps);            // SPEC-RENDU-012
      if (render.RENDER_DIST > o.vueMax) render.setDistance(o.vueMax);
      // affichage (SPEC-OPTION-005, 006)
      g.disposition = MC.Options.disposition(g.ecrans, o);
      render.setDisposition(g.disposition);
      render.setResolution(o.resolution);
      ui.zoneHud && ui.zoneHud(g.disposition.segments[g.disposition.principal]);
      ui.majTouches && ui.majTouches(o.touches);
      var tv = tailleVue();
      ui.echelle && ui.echelle(MC.Options.echelleInterface(o.tailleInterface, tv.l, tv.h));
    }
    // en « auto », l'interface suit la taille de l'hôte (SPEC-OPTION-007)
    window.addEventListener('resize', function () {
      var tv = tailleVue();
      if (ui.echelle) ui.echelle(MC.Options.echelleInterface(g.options.tailleInterface, tv.l, tv.h));
    });
    function reglerOption(cle, v) {
      g.options = MC.Options.regler(g.options, cle, v);
      MC.Options.sauver(hudStockage, g.options);
      appliquerOptions();
      if (cle === 'pleinEcran' || cle === 'ecran') basculerPleinEcran();
      if (cle === 'gpu' && g.options.gpu !== render.gpuAuLancement) ui.toast('Le GPU choisi servira au prochain lancement', 'warn');
      if (cle === 'nombreEcrans' && g.disposition.repli) ui.toast('Écrans insuffisants : affichage sur un seul écran', 'warn');
      return g.options[cle];
    }
    /* Les écrans de la machine (API de gestion des fenêtres quand le
       navigateur l'offre ; sinon l'écran courant seul). */
    g.ecrans = [{ largeur: (window.screen && screen.width) || 1920, hauteur: (window.screen && screen.height) || 1080,
                  principal: true, nom: 'Écran principal' }];
    g.detecterEcrans = function () {
      if (!window.getScreenDetails) return Promise.resolve(g.ecrans);
      return window.getScreenDetails().then(function (d) {
        g.ecransDetails = d.screens;
        g.ecrans = d.screens.map(function (s, i) {
          return { largeur: s.width, hauteur: s.height, principal: s.isPrimary, nom: s.label || ('Écran ' + (i + 1)) };
        });
        appliquerOptions();
        return g.ecrans;
      }, function () { return g.ecrans; });
    };
    function basculerPleinEcran() {
      var el = document.documentElement;
      if (!g.options.pleinEcran) { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {}); return; }
      if (!el.requestFullscreen) return;
      var s = g.ecransDetails && g.ecransDetails[g.disposition.premier];
      el.requestFullscreen(s ? { screen: s } : undefined).catch(function () { ui.toast('Plein écran refusé par le navigateur', 'warn'); });
    }
    function lierTouche(action, code) {
      var r = MC.Options.lier(g.options.touches, action, code);
      if (!r.conflit) {
        g.options = Object.assign({}, g.options, { touches: r.touches });
        MC.Options.sauver(hudStockage, g.options);
        appliquerOptions();
      }
      return r.conflit;
    }
    g.reglerOption = reglerOption;
    g.lierTouche = lierTouche;
    appliquerOptions();

    // ─── états ───────────────────────────────────────────────────────────────
    /* État du réseau tel que l'affiche le menu (SPEC-ARCHI-039) : lu dans
       ETAT_RESEAU, jamais déduit de `net.enLigne()`. Sans poste (page de test),
       une connexion de jeu ne peut être que celle d'un serveur distant. */
    function reseauAffiche() {
      if (poste) return poste.etatReseau(!!g.hoteDistant);
      return net.etat === 'en ligne' ? MC.ContratsArchi.ETAT_RESEAU.DISTANT : undefined;
    }
    function infosPause() {
      return {
        nom: g.nomPartie, graine: world.seed,
        mode: regles.mode.nom, difficulte: regles.difficulte.nom,
        poste: !!poste, reseau: reseauAffiche(),
      };
    }
    function onStateChange(next) {
      // SPEC-ARCHI-009 : le poste dit au serveur s'il doit geler le monde (menus) ou le faire vivre
      if (poste) poste.surEtatSession(next);
      if (next === 'playing') { ui.hideScreen(); }
      else if (next === 'paused') { ui.menuPause(infosPause()); }
      else if (next === 'menu') {
        // revenir au menu quitte la partie du serveur (sauvegardée par la pause)
        if (poste && net.etat !== 'hors ligne') net.deconnecter();
        afficherMenu();
      }
      else if (next === 'dead') { ui.ecranMort(); }
      if (next !== 'ui' && ui.isContainerOpen()) forceCloseContainer();
    }

    /* Le menu est le seul point d entree : creer, charger, supprimer,
       rejoindre. Toute la logique de persistance vit dans Saves ; ici on ne
       fait que du cablage. */
    function afficherMenu() {
      if (poste) { afficherMenuServeur(); return; }
      var st = storage();
      ui.menuParties(st ? MC.Saves.lister(st) : []);
    }
    g.afficherMenu = afficherMenu;
    g.poste = poste;

    // ─── parties sur disque, côté serveur (chantier ARCHI, SPEC-ARCHI-013/015) ───
    var arrete = false;                    // « Quitter le jeu » : plus aucun menu, le serveur s'arrête
    var attenteTerrain = null;             // { ... } tant que l'écran d'attente de la partie est affiché
    function afficherMenuServeur() {
      if (arrete) return;
      var stockage = storage();
      poste.lister().then(function (parties) {
        if (arrete || input.state !== 'menu' || attenteTerrain) return;   // l'utilisateur est passé ailleurs entre-temps
        ui.menuParties(parties, {
          poste: true, reseau: poste.etatReseau(!!g.hoteDistant),
          locales: stockage ? poste.partiesLocalesAImporter(stockage).length : 0,
        });
      }, function () {
        if (arrete) return;
        ui.ecranAttente({
          titre: 'Serveur injoignable', erreur: true,
          etapes: [{ nom: 'Serveur de jeu', etat: 'erreur' }],
          detail: 'Le serveur de jeu ne répond plus. Relancez <code>node server.js</code> (ou <code>start.cmd</code> / <code>start.sh</code>), puis réessayez.',
          actions: [{ texte: 'Réessayer', primaire: true, fn: afficherMenuServeur }],
        });
      });
    }
    function erreurPoste(titre, e) {
      ui.ecranAttente({
        titre: titre, erreur: true,
        detail: 'Cause : <code>' + String((e && (e.motif || e.message)) || e).replace(/[<>&]/g, '') + '</code>',
        actions: [{ texte: 'Retour au menu', primaire: true, fn: function () { attenteTerrain = null; afficherMenu(); } }],
      });
    }
    function pseudoLocal() {
      try { return window.localStorage.getItem('minicraft.pseudo') || 'Joueur'; } catch (e) { return 'Joueur'; }
    }
    function creerPartieServeur(opts) {
      // le récit (mode histoire) n'existe pas encore côté serveur (lot P-HIST) : on le dit plutôt que de créer une partie amputée
      if (opts.mode === 'histoire') {
        ui.toast("Le mode histoire n'est pas encore disponible : il doit d'abord être porté sur le serveur.", 'warn');
        return;
      }
      var graine = MC.Modes.graineDepuisTexte(opts.graineTexte);
      ui.ecranAttente({ titre: opts.nom || 'Nouvelle partie', sousTitre: 'Création de la partie…' });
      poste.creerPartie({
        nom: opts.nom, mode: opts.mode, difficulte: opts.difficulte, graine: graine,
        histoire: opts.mode === 'histoire' ? construireParametresHistoire(opts.histoire) : null,
      }).then(function (meta) { jouerPartieServeur(meta, opts.joueurs || 1); },
              function (e) { erreurPoste('Création impossible', e); });
    }
    function chargerPartieServeur(id) {
      poste.lister().then(function (parties) {
        var meta = parties.filter(function (m) { return m.id === id; })[0];
        if (!meta) { ui.toast('Partie introuvable', 'warn'); afficherMenu(); return; }
        jouerPartieServeur(meta, 1);
      }, function (e) { erreurPoste('Chargement impossible', e); });
    }
    function supprimerPartieServeur(id) {
      poste.supprimerPartie(id).then(function () {
        if (g.partieId === id) g.partieId = null;
        ui.toast('Partie supprimée');
        afficherMenu();
      }, function (e) { erreurPoste('Suppression impossible', e); });
    }
    /* Charge la partie sur le serveur (il se relance sur elle), aligne le monde
       et les règles du client sur ses métadonnées, puis s'y connecte EXACTEMENT
       comme à un serveur distant (SPEC-ARCHI-006). L'écran d'attente montre les
       étapes jusqu'aux premiers chunks maillés (SPEC-ARCHI-017). */
    function jouerPartieServeur(meta, joueurs) {
      var etapes = [{ nom: 'Serveur de jeu', etat: 'cours' }, { nom: 'Connexion', etat: 'attente' },
                    { nom: 'Génération du terrain', etat: 'attente' }];
      function montrer(erreur) {
        ui.ecranAttente({ titre: meta.nom, sousTitre: 'Chargement de la partie', etapes: etapes.map(function (e) { return { nom: e.nom, etat: e.etat }; }) });
      }
      attenteTerrain = { meta: meta, etapes: etapes, montrer: montrer };
      montrer();
      poste.chargerPartie(meta.id).then(function () {
        etapes[0].etat = 'ok'; etapes[1].etat = 'cours'; montrer();
        appliquerPartie(meta);
        remplacerMonde(meta.graine);
        for (var k2 in chests) delete chests[k2];
        for (var ke in expositions) delete expositions[ke];
        for (var kd in distributeurs) delete distributeurs[kd];
        g.histoire = null;
        g.succes = MC.Succes.creer();
        chat.vider();
        var optsRejoindre = { hote: '', pseudo: g.nomJoueur || pseudoLocal(), joueurs: joueurs };
        rejoindreServeur(optsRejoindre);
        montrer();                                       // rejoindreServeur passe en 'playing' (efface l'écran) : on le remet
        surveillerTerrain(optsRejoindre);
      }, function (e) { attenteTerrain = null; erreurPoste('Chargement impossible', e); });
    }
    /* Attend BIENVENUE puis les premiers chunks maillés autour du joueur, sans
       jamais rester figé : au bout de 25 s on y va quand même et on le dit. */
    function surveillerTerrain(optsRejoindre) {
      var at = attenteTerrain;
      if (!at) return;
      var debut = Date.now();
      var essais = 0, reprise = 0;
      var iv = setInterval(function () {
        if (attenteTerrain !== at) { clearInterval(iv); return; }
        var enLigne = net.etat === 'en ligne';
        if (enLigne && at.etapes[1].etat !== 'ok') { at.etapes[1].etat = 'ok'; at.etapes[2].etat = 'cours'; at.montrer(); }
        if (reprise) return;                             // une nouvelle tentative est programmée
        /* Après une actualisation de page (F5), le serveur peut ne pas avoir encore constaté la
           fermeture de l'ancienne connexion : il refuse alors « poste_deja_connecte ». On
           réessaie quelques fois, à 300 ms, avant de parler de connexion refusée. */
        if (net.etat === 'erreur' && net.erreur === MC.ContratsArchi.MOTIFS_REFUS.POSTE_DEJA_CONNECTE && essais < 4) {
          essais++;
          reprise = setTimeout(function () {
            reprise = 0;
            if (attenteTerrain === at) net.connecter(optsRejoindre.hote, optsRejoindre.pseudo, optsRejoindre.joueurs || 1, {});
          }, 300);
          return;
        }
        if (net.etat === 'erreur' || (net.etat === 'hors ligne' && Date.now() - debut > 1500)) {
          clearInterval(iv); attenteTerrain = null;
          erreurPoste('Connexion refusée', { motif: net.erreur || 'connexion impossible' });
          return;
        }
        var pret = enLigne && render.chunksCharges >= 9;
        if (pret || Date.now() - debut > 25000) {
          clearInterval(iv); attenteTerrain = null;
          ui.hideScreen();
          if (input.state !== 'playing') input.setState('playing');
        }
      }, 100);
    }
    // ─── actions du poste : réseau à chaud, arrêt, import, export ─────────────
    function changerReseau(ouvrir) {
      poste.definirReseau(ouvrir).then(function (r) {
        if (!r) { ui.messagePoste('Le serveur n\'a pas répondu.', true); return; }
        ui.toast(r.etat === 'ouvert' ? 'Réseau ouvert — port ' + r.port : 'Réseau fermé');
      });
    }
    function quitterLeJeu() {
      arrete = true;
      if (net.etat !== 'hors ligne') net.deconnecter();
      poste.arreter();
      ui.ecranArrete();
    }
    function compteRendu(r) {
      var n = (r.importees || []).length, i = (r.ignorees || []).length;
      var txt = n + ' partie' + (n > 1 ? 's' : '') + ' importée' + (n > 1 ? 's' : '');
      if (i) txt += ' · ' + i + ' ignorée' + (i > 1 ? 's' : '') + ' (' + r.ignorees.map(function (x) { return x.motif; }).join(' ; ') + ')';
      return txt;
    }
    function importerPartiesLocales() {
      var st = storage();
      if (!st) return;
      poste.importerLocales(st).then(function (r) {
        afficherMenu();
        setTimeout(function () { ui.messagePoste(compteRendu(r), !!(r.ignorees || []).length); }, 300);
      }, function (e) { ui.messagePoste('Import impossible : ' + (e.motif || e.message), true); });
    }
    /* Télécharge un fichier texte (Blob + lien) ; faux si le navigateur refuse. */
    function telechargerTexte(nom, texte) {
      try {
        var url = URL.createObjectURL(new Blob([texte], { type: 'application/json' }));
        var a = document.createElement('a');
        a.href = url; a.download = nom;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        return true;
      } catch (e) { return false; }
    }
    /* « Exporter mes parties » (lot A0-pré, SPEC-ARCHI-015 b) : disponible AUSSI
       sans serveur de jeu — c'est ce qui sauve les parties de l'ancien mode solo
       (le localStorage ne se partage pas entre origines). */
    function exporterPartiesLocales() {
      var st = storage();
      var ok = false;
      if (st) {
        if (poste) ok = poste.telechargerExport(st);
        else ok = telechargerTexte('minicraft-parties.json', JSON.stringify(MC.PartiesFichier.exporter(st)));
      }
      if (!ok) ui.messagePoste('Téléchargement indisponible dans ce navigateur.', true);
      else ui.messagePoste('Fichier minicraft-parties.json téléchargé — à importer dans la nouvelle version du jeu.');
    }
    function importerFichierParties(texte) {
      var doc;
      try { doc = JSON.parse(texte); } catch (e) { ui.messagePoste('Ce fichier n\'est pas un export de parties MiniCraft (JSON illisible).', true); return; }
      poste.importerExport(doc).then(function (r) {
        afficherMenu();
        setTimeout(function () { ui.messagePoste(compteRendu(r), !!(r.ignorees || []).length); }, 300);
      }, function (e) { ui.messagePoste('Import impossible : ' + (e.motif || e.message), true); });
    }
    if (poste) {
      // l'ouverture/fermeture du réseau (ici ou depuis un autre écran) rafraîchit l'écran qui l'affiche
      var reseauVu = poste.etat.reseau;
      poste.surChangement(function (e) {
        if (e.reseau === reseauVu) return;
        reseauVu = e.reseau;
        if (input.state === 'paused') ui.menuPause(infosPause());
        else if (input.state === 'menu' && !attenteTerrain && ui.estMenuParties()) afficherMenu();
      });
    }

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
        histoire: opts.mode === 'histoire' ? construireParametresHistoire(opts.histoire) : null,
      });
      g.histoire = null;
      g.succes = MC.Succes.creer();
      appliquerPartie(meta);
      // le monde doit repartir de la bonne graine
      remplacerMonde(meta.graine);
      for (var k2 in chests) delete chests[k2];
      for (var ke in expositions) delete expositions[ke];
      for (var kd in distributeurs) delete distributeurs[kd];
      g.time = 60;
      composerEquipe(opts.joueurs || 1, regles);
      chat.vider();
      chat.systeme('Nouvelle partie « ' + meta.nom + ' » — graine ' + meta.graine);
      ui.toast('Partie créée');
      input.setState('playing');
      if (meta.mode === 'histoire') demarrerHistoire(meta.histoire || construireParametresHistoire({}));
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
      else if (!g.histoire) demarrerHistoire(meta.histoire || construireParametresHistoire({}));
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

    /* B1 (docs/vague-2/B1.md § 6) : l'inventaire/équipement solo ne survivrait
       pas à `composerEquipe` (qui recrée des joueurs vides pour l'équipe en
       ligne) — on le sérialise ici, `restaurerInventaireSolo` le rend à la
       déconnexion. */
    function serialiserInventaireSolo() {
      var CV = MC.ContratsV2;
      return equipe.map(function (j) {
        var st = j.player.state, equip = {};
        CV.EQUIP_SLOTS.forEach(function (s) { equip[s] = CV.pileVersCase(st.equip[s]); });
        return { inv: st.inv.serialize(), equip: equip };
      });
    }
    function restaurerInventaireSolo() {
      if (!g.inventaireSolo) return;
      var CV = MC.ContratsV2, snap = g.inventaireSolo;
      equipe.forEach(function (j, i) {
        var rec = snap[i];
        if (!rec) return;
        var st = j.player.state;
        st.inv.load(rec.inv);
        CV.EQUIP_SLOTS.forEach(function (s) { st.equip[s] = CV.caseVersPile(rec.equip[s]); });
        delete st.journalInv;
      });
      g.inventaireSolo = null;
    }

    function rejoindreServeur(opts) {
      g.nomJoueur = opts.pseudo;
      // SPEC-ARCHI-039 : un hôte saisi = une AUTRE machine ; vide = le serveur qui sert cette page
      g.hoteDistant = !!(opts.hote && String(opts.hote).trim());
      try { window.localStorage.setItem('minicraft.pseudo', opts.pseudo); } catch (e) { /* stockage bloqué */ }
      g.inventaireSolo = serialiserInventaireSolo();
      composerEquipe(opts.joueurs || 1, regles);
      equipe.forEach(function (j) {
        j.prediction = MC.Synchro.creerPrediction();
        // B1 : prédiction inventaire/équipement/grille, une par joueur local ;
        // le journal de player.js n'est actif qu'en ligne (B1.md § 6)
        j.predInv = MC.Conteneurs.creerPrediction();
        j.revInv = 0;
        j.player.state.journalInv = [];
      });
      entities.list.length = 0;              // en ligne, les créatures sont celles du serveur
      input.setState('playing');
      net.connecter(opts.hote, opts.pseudo, opts.joueurs || 1,
                    { email: opts.email, invitation: opts.invitation });
    }
    g.rejoindreServeur = rejoindreServeur;

    /* Change de monde. L'ANCIEN est libéré d'abord : ses maillages vivent
       dans la scène, pas dans le monde. On appelait jadis reset() sur le
       NOUVEAU monde, encore vide — les chunks de la partie précédente
       restaient affichés, superposés au nouveau terrain : blocs flottants
       qu'on traverse, murs invisibles contre lesquels on bute. */
    function remplacerMonde(graine, mondeOpts) {
      world.reset(render.disposeChunk);
      entities.list.length = 0;
      render.libererToutesEntites();
      world = MC.createWorld(graine, mondeOpts);
      reconstruireDependances();
      grille = creerGrilleLointaine();
      /* SPEC-PERF-009 : nouvelle époque — tout résultat en vol d'un worker
         pour l'ANCIEN monde (autre graine) sera rejeté à réception. Les
         workers de génération reçoivent la graine/zone du nouveau monde ;
         le maillage ne connaît pas la graine (il ne lit que l'instantané
         reçu dans chaque `maille`), seule l'époque compte pour lui. */
      simplifieEnVol = Object.create(null);
      overridesDemandes = Object.create(null);
      reinitialiserPools(mondeOpts && mondeOpts.zonePolitique);
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

    /* Caravanes, voyageurs et bateaux (SPEC-ROUTE-006). Les trajets des lieux
       proches se recalculent toutes les deux secondes ; la position de chaque
       convoi se déduit de l'heure (MC.Caravanes), la même sur tous les postes. */
    var trajetsT = 99, trajetsProches = [], trajetsCache = new Map();
    function convois(p1, dt) {
      var CV = MC.Caravanes;
      if (!CV || !world.routes || !render.syncFigurants) return;
      trajetsT += dt;
      if (trajetsT > 2) {
        trajetsT = 0;
        var lieux = world.habitats.lieuxProches(p1.x, p1.z, 900).filter(function (l) { return l.kind === 'ville' || l.kind === 'megapole'; });
        trajetsProches = [];
        // SPEC-ENV-002 : les volcans actifs proches coupent réellement les
        // routes qui en approchent — une caravane dont le trajet la
        // traverse disparaît (arrêtée) ou emprunte une autre destination
        // encore praticable (redirigée), recalculé à chaque rafraîchissement
        // (l'éruption commence/finit avec le temps, contrairement au tracé).
        var volcansProches = MC.Volcanisme && world.bio && world.bio.volcansDansZone
          ? world.bio.volcansDansZone(p1.x - 1600, p1.z - 1600, p1.x + 1600, p1.z + 1600).filter(function (v) { return v.actif; })
          : [];
        lieux.forEach(function (l) {
          if (!trajetsCache.has(l.id)) trajetsCache.set(l.id, CV.trajetsDe(l, world.routes));
          var trs = trajetsCache.get(l.id);
          volcansProches.forEach(function (v) {
            var act = MC.Volcanisme.activite(v, g.time, SEED);
            if (!act.eruption) return;
            trs = MC.Routes.trajetsAffectesParEruption(trs, v, act)
              .filter(function (r) { return r.etat !== 'arret'; })
              .map(function (r) { return r.trajet; });
          });
          trs.forEach(function (tr) { trajetsProches.push(tr); });
        });
        // bateaux : entre les ports proches que relie l'eau
        var ports = world.habitats.lieuxProches(p1.x, p1.z, 1200).filter(function (l) {
          return (l.batiments || []).some(function (b) { return b.type === 'port'; });
        });
        for (var i = 0; i < ports.length; i++) for (var j = i + 1; j < ports.length; j++) {
          var cle = ports[i].id + '~' + ports[j].id;
          if (!trajetsCache.has(cle)) {
            trajetsCache.set(cle, [CV.voieEau(ports[i], ports[j], function (x, z) {
              var e = world.bio.echantillon(x, z); return e.eau > e.h;
            }, C.SEA_LEVEL + 0.4)].filter(Boolean));
          }
          trajetsCache.get(cle).forEach(function (tr) { trajetsProches.push(tr); });
        }
      }
      var liste = [];
      trajetsProches.forEach(function (tr) {
        CV.enRoute(tr, g.time).forEach(function (f) {
          if (Math.abs(f.x - p1.x) > 110 || Math.abs(f.z - p1.z) > 110) return;
          if (f.type !== 'bateau') f.y += 1;
          f.age = g.time;
          liste.push(f);
        });
      });
      g.convois = liste;
      render.syncFigurants(liste);
    }

    /* Volcans actifs (SPEC-RELIEF-011) : panaches et grondements, purement
       visuels et sonores (SPEC-ARCHI-023). Les bombes et les coulées de lave
       posées par le client ont été SUPPRIMÉES : le serveur n'a pas d'équivalent
       et le client ne modifie plus le monde de son côté. */
    var etatsVolcans = new Map();
    function volcans(me, p1, dt) {
      var V = MC.Volcanisme, bio = world.bio;
      if (!V || !bio.volcansDansZone) return;
      var proches = bio.volcansDansZone(p1.x - 300, p1.z - 300, p1.x + 300, p1.z + 300).filter(function (v) { return v.actif; });
      var t = g.time;
      var vues = proches.map(function (v) {
        var a = V.activite(v, t, world.seed);
        var cle = v.x + ',' + v.z, avant = etatsVolcans.get(cle) || {};
        if (a.grondement && !avant.grondement) { ui.toast('Le volcan gronde…', 'warn'); audio.jouer(MC.Ambiance.sonEvenement('eruption'), { categorie: 'evenement', x: v.x, y: v.sommet, z: v.z, portee: 400 }); }
        if (a.eruption && !avant.eruption) { chat.systeme('Éruption !'); audio.jouer(MC.Ambiance.sonEvenement('eruption'), { categorie: 'evenement', x: v.x, y: v.sommet, z: v.z, portee: 600 }); }
        etatsVolcans.set(cle, { grondement: a.grondement, eruption: !!a.eruption });
        return { v: v, a: a, x: v.x + 0.5, y: v.sommet, z: v.z + 0.5, fumee: a.fumee, eruption: !!a.eruption };
      });
      if (render.majVolcans) render.majVolcans(vues, dt, me.ventEn ? function (y) { return me.ventEn(t, y); } : null);
    }

    /* Fumée (SPEC-CONSTR-007) : feu, foyers, cheminées et torches proches —
       les sources de lumière (world.lights) filtrées à celles qui fument
       (C.estFumigene), les plus proches d'abord, bornées comme les torches. */
    function fumees(me, p1, dt) {
      if (!render.majFumees) return;
      var proches = [];
      world.lights.forEach(function (l) {
        if (!MC.Core.estFumigene(world.getBlock(l.x, l.y, l.z))) return;
        var dx = l.x + 0.5 - p1.x, dy = l.y - p1.y, dz = l.z + 0.5 - p1.z;
        proches.push({ d2: dx * dx + dy * dy + dz * dz, x: l.x + 0.5, y: l.y + 1, z: l.z + 0.5 });
      });
      proches.sort(function (a, b) { return a.d2 - b.d2; });
      var t = g.time;
      render.majFumees(proches.slice(0, 12), dt, me.ventEn ? function (y) { return me.ventEn(t, y); } : null);
    }

    /* Brume (SPEC-VENT-003) : le point bas alentour dit où elle se pose ;
       échantillonné toutes les deux secondes, le relief ne change pas si vite. */
    var brumeT = 99, brumeLieu = null;
    function majBrume(me, et, p1, dt) {
      if (!me.brume || !render.majBrume) return;
      brumeT += dt;
      if (brumeT > 2 || !brumeLieu) {
        brumeT = 0;
        var bas = world.heightAt(Math.floor(p1.x), Math.floor(p1.z)), somme = 0, n = 0;
        for (var a = 0; a < 12; a++) for (var r = 24; r <= 72; r += 48) {
          var h = world.heightAt(Math.floor(p1.x + Math.cos(a * 0.5236) * r), Math.floor(p1.z + Math.sin(a * 0.5236) * r));
          bas = Math.min(bas, h); somme += h; n++;
        }
        var eau = bas <= C.SEA_LEVEL + 1;
        brumeLieu = { ySol: Math.max(bas, C.SEA_LEVEL), fond: eau ? C.SEA_LEVEL : somme / n - 10,
                      humidite: world.bio.climat(p1.x, p1.z).h };
      }
      g.brume = me.brume(g.time, et, brumeLieu);
      render.majBrume({ force: g.brume, fond: brumeLieu.ySol, derive: me.deriveBrume(g.time) });
    }
    /* Tornades (SPEC-NUAGE-004) : la poussée et l'arrachage sont l'affaire du
       serveur (SPEC-ARCHI-022) ; le client n'en rend que l'entonnoir. */

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
      var p1 = player.state.pos, bio = world.biomeAt(Math.floor(p1.x), Math.floor(p1.z));
      // le vent qu'on sent : celui de son altitude, et la ronde d'un cyclone proche
      var ventLocal = me.ventEn ? me.ventEn(g.time, p1.y) : et.vent;
      var cy = me.influenceCyclone ? me.influenceCyclone(p1.x, p1.z, g.time) : null;
      if (cy && cy.vent.force > 0) ventLocal = { x: ventLocal.x + cy.vent.x, z: ventLocal.z + cy.vent.z,
                                                 force: Math.hypot(ventLocal.x + cy.vent.x, ventLocal.z + cy.vent.z) };
      g.ventLocal = ventLocal;
      render.majMeteo(et, me.derive(g.time), { me: me, temps: g.time, vent: ventLocal, sol: world.heightAt });
      majBrume(me, et, p1, dt);
      volcans(me, p1, dt);
      fumees(me, p1, dt);
      convois(p1, dt);
      // ce qui tombe au-dessus du joueur 1, et ce qu'on en entend
      var tj = equipe[0] && equipe[0].temperature;
      var tC = tj ? tj.temperature : me.temperature(world.bio.climat(p1.x, p1.z).t, p1.y, g.time, et, bio.id);
      var prec = me.precipitation(p1.x, p1.z, g.time, tC, bio.id, et);
      g.precipitation = prec;
      // la pluie et la neige suivent le vent de leur altitude (SPEC-VENT-001)
      render.majPrecipitations(dt, prec, me.ventEn ? me.ventEn(g.time, p1.y + 20) : et.vent, abri);
      var dehors = abri(Math.floor(p1.x), Math.floor(p1.z)) <= p1.y + 1.8;
      var sousLeau = P.headInWater(world, p1, player.EYE);
      /* SPEC-AUDIO-001/006 : ce que le joueur 1 entend autour de lui — lieu,
         moment, météo et proximités — décidé par MC.Ambiance, synthétisé par
         audio.majNappes ; positionAuditeur suit son oreille pour le reste
         des sons spatialisés (blessures, portes, coffres…). */
      audio.positionAuditeur(p1.x, p1.y, p1.z, player.state.yaw);
      var villeProche = 0;
      if (world.habitats) {
        var lieuxAudio = world.habitats.lieuxProches(p1.x, p1.z, 120);
        if (lieuxAudio.length) villeProche = Math.max(0, 1 - Math.hypot(lieuxAudio[0].x - p1.x, lieuxAudio[0].z - p1.z) / 120);
      }
      var volcanAudio = world.bio.volcanProche ? world.bio.volcanProche(p1.x, p1.z) : null;
      var volcanProche = volcanAudio ? Math.max(0, 1 - Math.hypot(p1.x - volcanAudio.x, p1.z - volcanAudio.z) / volcanAudio.R) : 0;
      var surfaceY = world.heightAt(Math.floor(p1.x), Math.floor(p1.z));
      audio.majNappes({
        biome: bio, nuit: DC.isNight(g.time), sousTerre: p1.y < surfaceY - 4,
        pluie: prec.forme === 'pluie' ? prec.intensite * (dehors ? 1 : 0.35) * (sousLeau ? 0.2 : 1) : 0,
        vent: et.vent.force * (dehors ? 1 : 0.4) * (sousLeau ? 0.1 : 1),
        neige: prec.forme === 'neige' ? prec.intensite : 0,
        villeProche: villeProche, volcanProche: volcanProche,
      });
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
        /* SPEC-ARCHI-022 : la foudre blesse qui se tient à découvert tout près,
           allume ce qu'elle touche et blesse les créatures — le SERVEUR seul en
           décide (PV, blocs). Ici, seulement la présentation (toast, cri) et
           le suivi de succès, sans jamais toucher à la vie ni au monde : le
           calcul de portée est le même, pur, que celui du serveur. */
        equipe.forEach(function (j) {
          var st = j.player.state;
          var lieuJ = me.lieuEclair(e, st.pos.x, st.pos.z);
          if (!st.dead && me.foudroie(lieuJ, st.pos, abri)) {
            if (j.index === 0) { ui.toast('Foudroyé !'); audio.play('blesse'); }
            signalerSucces({ type: 'foudre' });
          }
        });
        if (g.surEclair) g.surEclair(e, lieu, ySol);
      });
    }

    // ─── habitants, métiers et lieux ─────────────────────────────────────────
    var lieuActuel = null, zoneActuelle = null;
    function rendreService(service, ent) {
      var st = player.state;
      var r = MC.Habitats.servir(service, {
        inv: st.inv, etat: st, temps: g.time, dureeJour: DC.DAY_LENGTH, estNuit: DC.isNight(g.time),
        habitats: world.habitats, reperes: world.reperes, x: st.pos.x, z: st.pos.z,
        lieu: world.habitats ? world.habitats.lieuA(Math.floor(st.pos.x), Math.floor(st.pos.z)) : null,
        pvMax: player.MAX_HP || 20,
        // SPEC-TRANSPORT-002 : réparer le véhicule qu'on conduit, s'il y en a un
        vehicule: st.monture || null,
      });
      /* SPEC-ARCHI-025 : une chambre d'auberge fait dormir jusqu'au matin — le
         client ne touche pas à l'heure, il se couche (le serveur fait passer
         la nuit quand tous les joueurs présents dorment). */
      if (r.temps !== undefined) net.dormir(equipe[0].index, true);
      if (r.ouvrir === 'banque') {
        // SPEC-ARCHI-030 : un banquier ouvre la MÊME banque serveur qu'un
        // coffre-fort (CONTENEUR_OUVRIR par eid) — plus aucune copie locale.
        if (ent) {
          net.ouvrirConteneur({ eid: ent.eid }, 0);
          input.setState('ui');
          signalerSucces({ type: 'banque' });
        }
      }
      // un panneau d'information rappelle aussi la zone de jeu ici (SPEC-ZONE-003) :
      // utile en particulier aux bornes posées aux frontières le long des routes
      if (service === 'info' && r.ok && world.zoneEn) {
        var LIBELLES = { sure: 'zone sûre', pve: 'zone PvE', pvp: 'zone PvP', pvp_pve: 'zone PvP et PvE' };
        var z = world.zoneEn(st.pos.x, st.pos.z).zone;
        r.message += ' Vous êtes ici en ' + (LIBELLES[z] || z) + '.';
      }
      return r;
    }
    g.rendreService = rendreService;
    /* Parler à un habitant : son métier décide du titre, de la réplique, des
       offres et du service proposé. Un village hostile ne commerce plus. */
    function parlerA(ent) {
      if (g.histoire && !finRecit(g.histoire) && parlerHistoire(ent)) return;
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
      /* L45 : un PNJ de métier (lieu connu) commerce par TROC — prix
         dynamiques, stock, trésor, tout est tenu par le SERVEUR (SPEC-SYNC-023,
         SPEC-ARCHI-032) : on envoie 'consulter' et on redessine à sa réponse
         (onTroc, hook réseau), avec un compteur de seq local très simple
         (g.seqTroc) — sans prédiction (un échange reste rare et bref). Un
         villageois sans métier garde Inv.TRADES/Inv.doTrade (illimité, prix
         figé, sans économie). */
      var economique = !!(ent.role && ent.lieu);
      var opts = {
        titre: role.nom + (ent.nom ? ' — ' + ent.nom : ''),
        villageois: !ent.role,
        replique: role.repliques[h],
        offres: economique ? [] : role.offres,
        services: role.service ? [{ id: role.service, libelle: LIBELLES[role.service] }] : [],
        onService: function (id) {
          var r = rendreService(id, ent);
          ui.toast(r.message, r.ok ? null : 'warn');
          if (r.ok && id === 'info' && chat) chat.systeme(r.message);
          return r;
        },
        onTrade: economique ? function (indice) {
          g.seqTroc = (g.seqTroc || 0) + 1;
          net.troc('echanger', ent.eid, { j: 0, seq: g.seqTroc, offre: indice, fois: 1 });
          return { ok: true, attente: true };   // la confirmation arrive par onTroc/onToi
        } : null,
      };
      if (economique) net.troc('consulter', ent.eid, { j: 0 });
      g.dernierDialogue = { role: ent.role || 'habitant', nom: ent.nom, service: role.service };
      ui.openContainer('trade', player.state.inv, opts, ent.eid);
      input.setState('ui');
    }
    g.parlerA = parlerA;

    /* Les habitants des lieux (SPEC-ARCHI-024) viennent du SERVEUR : il les
       fait naître, vivre et mourir (`peuplerLieux` de server.js) et le client
       les reçoit comme toute créature (`net.mobsDistants`). */
    // ─── mode histoire ───────────────────────────────────────────────────────
    var histoireT = 0, choixAffiche = null, fileRecit = [], repereObjectif = null;
    function peutCategorie(cat) { return MC.Modes.categoriePermise(regles, cat); }
    /* Complète les paramètres d histoire génériques (MC.Histoire.parametres)
       avec ce qui n'appartient qu'à MC.Recits : l'archétype choisi, et les
       interactions brutes (que parametres() ne connaît pas). */
    function construireParametresHistoire(o) {
      var p = MC.Histoire.parametres(o);
      p.archetype = (o && MC.Recits.ARCHETYPES[o.archetype]) ? o.archetype : 'epopee';
      p.interactions = o && o.interactions;
      return p;
    }
    // l'archétype en cours, quel que soit son état interne particulier
    function etatInterne(etat) { return etat && (etat.histoire || etat.enquete || etat.colonie); }
    function finRecit(etat) { var i = etatInterne(etat); return i ? i.fin : null; }
    // le lieu où le héros s'éveille, selon l'archétype
    function pointDepart(etat) {
      if (!etat) return null;
      if (etat.archetype === 'epopee') return etat.histoire.liens.depart;
      if (etat.archetype === 'enquete') return etat.enquete.depart;
      if (etat.archetype === 'colonie') return etat.colonie.centre;
      return null;
    }
    /* Démarre le récit : il se lie aux lieux réels autour du départ, et le
       héros s'éveille sur la place de son village. L'épopée se lie au monde
       réel (donjons compris) via MC.Histoire.lier, que MC.Recits.generer ne
       connaît pas ; les autres archétypes se génèrent depuis la graine et
       les lieux proches. */
    function demarrerHistoire(params) {
      var s = player.state;
      var archetype = (params && MC.Recits.ARCHETYPES[params.archetype]) ? params.archetype : 'epopee';
      if (archetype === 'epopee') {
        var liens = MC.Histoire.lier(world, s.pos.x, s.pos.z);
        g.histoire = { archetype: 'epopee', histoire: MC.Histoire.creer(params, liens, peutCategorie) };
      } else {
        var lieux = world.habitats ? world.habitats.lieuxProches(s.pos.x, s.pos.z, 2500) : [];
        g.histoire = MC.Recits.generer(archetype, world.seed, lieux, params);
      }
      fileRecit.length = 0; choixAffiche = null; repereObjectif = null;
      var depart = pointDepart(g.histoire);
      if (depart) {
        var px = Math.floor(depart.x), pz = Math.floor(depart.z) + 3;
        s.pos.x = px + 0.5; s.pos.z = pz + 0.5; s.pos.y = C.WORLD_H - 2;
        s.vel.x = s.vel.y = s.vel.z = 0;
        streamChunks(true);
        s.pos.y = world.groundAt(px, pz, true) + 1.2;
        g.spawnPoint = { x: s.pos.x, y: s.pos.y, z: s.pos.z };
      }
      presenter(MC.Recits.commencer(g.histoire));
      return g.histoire;
    }
    g.demarrerHistoire = demarrerHistoire;
    function signalerHistoire(ev, ctx) {
      if (!g.histoire || finRecit(g.histoire)) return [];
      ev.t = g.time;
      var n = MC.Recits.signaler(g.histoire, ev, ctx);
      presenter(n);
      return n;
    }
    g.signalerHistoire = signalerHistoire;
    function compteur() { var inv = player.state.inv; return { compter: function (id) { return inv.count(id); } }; }
    /* Ce que le moteur demande : raconter, donner, prendre, faire apparaître. */
    function presenter(notifs) {
      (notifs || []).forEach(function (n) {
        switch (n.type) {
          case 'chapitre': fileRecit.push({ titre: n.titre, texte: n.texte }); chat.systeme('— ' + n.titre + ' —');
                           audio.jouer(MC.Ambiance.sonEvenement('chapitre'), { categorie: 'evenement' }); break;
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
      var c = MC.Recits.choixEnAttente(g.histoire);
      if (c && choixAffiche !== c.id) {
        choixAffiche = c.id;
        if (ui.isContainerOpen()) forceCloseContainer();
        input.setState('ui');
        ui.dialogueHistoire({ titre: 'Votre choix', texte: c.texte,
                              choix: c.options.map(function (o) { return { id: o.id, texte: o.texte }; }) },
                            function (opt) {
                              choixAffiche = null;
                              presenter(MC.Recits.choisir(g.histoire, c.id, opt));
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
       quêtes (l'épopée seule en propose), et le commerce seulement si
       l'histoire l'autorise. */
    function parlerHistoire(ent) {
      var h = g.histoire, role = ent.role || 'habitant';
      var R0 = MC.Habitats.ROLES[role] || MC.Habitats.ROLES.habitant;
      var nom = R0.nom + (ent.nom ? ' — ' + ent.nom : '');
      var n1 = signalerHistoire({ type: 'parler', role: role, lieu: ent.lieu, pnj: ent.pnj, nom: nom }, compteur());
      if (n1.some(function (n) { return n.type === 'dialogue' || n.type === 'info' || n.type === 'etape'; })) return true;
      if (h.archetype === 'epopee') {
        var H = MC.Histoire, he = h.histoire;
        var n2 = H.rendreQuete(he, role, compteur());
        if (n2.some(function (n) { return n.type === 'quete'; })) { presenter(n2); return true; }
        var q = H.queteProposee(he, role);
        if (q) {
          input.setState('ui');
          ui.dialogueHistoire({ titre: nom, texte: q.texte + ' — « ' + q.titre + ' »',
                                choix: [{ id: 'oui', texte: 'Accepter la quête' }, { id: 'non', texte: 'Refuser' }] },
                              function (c) {
                                if (c === 'oui' && H.accepter(he, q.id)) { ui.toast('Quête acceptée : ' + q.titre); chat.systeme('Quête : ' + q.titre); }
                                fermerRecit();
                              });
          return true;
        }
        if (n2.length) { presenter(n2); return true; }
      }
      if (!regles.commerce) {
        input.setState('ui');
        ui.dialogueHistoire({ titre: nom, texte: R0.repliques[(ent.eid || 0) % R0.repliques.length] }, fermerRecit);
        return true;
      }
      return false;
    }
    function finHistoire(n) {
      var h = g.histoire, i = etatInterne(h);
      var stats = '';
      if (i) {
        stats = h.archetype === 'epopee' ? 'Quêtes secondaires : ' + i.secondairesFaites + '/' + i.secondairesPrevues +
                                            ' · Chapitres : ' + Math.min(i.chap + 1, i.chapitres.length) + '/' + i.chapitres.length
                                          : 'Chapitres : ' + Math.min(i.chap + 1, i.chapitres.length) + '/' + i.chapitres.length;
      }
      g.finHistoire = n;
      audio.jouer(MC.Ambiance.sonEvenement('fin'), { categorie: 'evenement' });
      signalerSucces({ type: 'histoire', fin: n.id });
      chat.systeme('Fin : ' + n.titre);
      ui.objectifHistoire(null);
      forceCloseContainer();
      input.setState('menu');
      var arche = h && MC.Recits.ARCHETYPES[h.archetype];
      ui.ecranFin(n, stats, arche ? arche.nom : '');
      if (g.partieId) doSave(false);
    }
    function continuerApresFin() {
      if (g.partieId) input.setState('playing');
      else afficherMenu();
    }
    /* Deux fois par seconde : où l'on est, ce qu'on porte, l'heure, le ciel. */
    function majHistoire(dt) {
      if (!g.histoire || net.enLigne()) { ui.objectifHistoire(null); return; }
      var h = g.histoire, s = player.state, i = etatInterne(h), fin = finRecit(h);
      if (!fin) ui.objectifHistoire(MC.Recits.objectif(h), s.pos);
      histoireT -= dt;
      if (histoireT > 0 || fin) return;
      histoireT = 0.5;
      signalerHistoire({ type: 'position', x: s.pos.x, z: s.pos.z });
      signalerHistoire({ type: 'biome', id: world.biomeAt(Math.floor(s.pos.x), Math.floor(s.pos.z)).id });
      signalerHistoire({ type: 'inventaire' }, compteur());
      signalerHistoire({ type: 'temps', nuit: DC.isNight(g.time) });
      if (g.meteo) signalerHistoire({ type: 'meteo', meteo: g.meteo.type });
      // la colonie attire aussi les habitants déjà présents alentour
      if (h.archetype === 'colonie' && world.habitats) {
        var pop = 0;
        world.habitats.lieuxProches(i.centre.x, i.centre.z, 200).forEach(function (l) { pop += (l.pnjs || []).length; });
        signalerHistoire({ type: 'habitants', n: pop });
      }
      // le repère de l'objectif, suivi par la boussole
      var o = MC.Recits.objectif(h);
      if (world.reperes && i && i.params && i.params.reperes) {
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
        if (l) signalerSucces({ type: 'lieu', kind: l.kind });
      }
    }

    /* Zone de jeu courante (SPEC-ZONE-003) : affichée au HUD, et l'entrée
       dans une nouvelle zone annoncée — comme un lieu, mais suivant la carte
       des zones plutôt que celle des habitations. */
    function annoncerZone() {
      if (!world.zoneEn) { zoneActuelle = null; ui.zoneIndicateur(null); return; }
      var p = player.state.pos;
      var z = world.zoneEn(p.x, p.z).zone;
      ui.zoneIndicateur(z);
      if (z !== zoneActuelle) {
        var premiere = zoneActuelle === null;
        zoneActuelle = z;
        if (!premiere) {
          var LIBELLES = { sure: 'zone sûre', pve: 'zone PvE', pvp: 'zone PvP', pvp_pve: 'zone PvP et PvE' };
          var texte = 'Vous entrez en ' + (LIBELLES[z] || z);
          ui.toast(texte);
          if (chat) chat.systeme(texte);
        }
      }
    }

    /* Distance de vue : réévaluée toutes les deux secondes selon la fluidité. */
    var vueT = 0;
    function ajusterVue(dt) {
      vueT += dt;
      if (vueT < 2) return;
      vueT = 0;
      var bornes = Object.assign({}, MC.Lointain.VUE, { max: Math.min(MC.Lointain.VUE.max, g.options.vueMax) });
      var r = MC.Lointain.ajusterDistance(render.RENDER_DIST, g.fps, g.enAttente || 0, bornes);
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
      // SPEC-PERF-009 : tout résultat de worker encore en vol pour l'ancien
      // contenu (mêmes coordonnées, contenu différent) doit être rejeté
      simplifieEnVol = Object.create(null);
      reinitialiserPools();
      entities.list.length = 0;
      render.libererToutesEntites();           // libere geometries ET materiaux
      for (var k2 in chests) delete chests[k2];
      for (var ke in expositions) delete expositions[ke];
      for (var kd in distributeurs) delete distributeurs[kd];
      var s = player.state;
      s.inv.load([]);
      s.hp = 20; s.hunger = 20; s.air = 10; s.dead = false;
      s.flying = false; s.selected = 0; s.exhaustion = 0;
      g.time = 60;
      g.succes = MC.Succes.creer();
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

    // un chunk lointain est-il maillé « allégé » à cette distance ?
    function estSimplifie(d2, R) { return d2 > PROCHE_SIMPLE * PROCHE_SIMPLE && d2 > (R * 0.55) * (R * 0.55); }

    /* SPEC-PERF-004/007/009/014 : applique les résultats de worker déjà
       reçus par fileChunks (budget SPEC-PERF-005 : au plus
       integrationsGenParImage/integrationsMailleParImage par image) —
       `world.integrerChunk` et `render.appliquerMaillage` sont EXACTEMENT ce
       que fait le chemin synchrone (`world.getChunk`/`render.syncChunk`),
       juste appelés depuis un résultat reçu plutôt que calculés ici. */
    function integrerResultatsWorkers() {
      fileChunks.aIntegrer('genere').forEach(function (msg) {
        var k = world.key(msg.cx, msg.cz), dejaLa = world.chunks.has(k);
        world.integrerChunk(msg.cx, msg.cz, { blocks: msg.blocks, etats: msg.etats, eau: msg.eau });
        g.perf.msGeneration = msg.ms;
        if (!dejaLa) world.marquerVoisins(msg.cx, msg.cz);
      });
      fileChunks.aIntegrer('maille').forEach(function (msg) {
        var k = world.key(msg.cx, msg.cz);
        var simplifie = !!simplifieEnVol[k];
        delete simplifieEnVol[k];
        var c = world.chunks.get(k);
        if (!c) return;   // déchargé entre l'envoi de la tâche et la réception
        var lumiereObj = msg.lumiere ? MC.Lumiere.depuisTableaux(msg.lumiere.niveaux, msg.lumiere.ciel, msg.lumiere.sources) : null;
        render.appliquerMaillage(c, msg.passes, lumiereObj, simplifie);
        g.perf.msMaillage = msg.ms;
      });
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

      // SPEC-SERVEUR-009 : demande les overrides de chaque chunk voulu qui
      // n'a pas encore été demandé — en ligne seulement (le solo n'a pas de
      // serveur à interroger, ses overrides sont déjà dans `world`). Le seul
      // garde-fou est `overridesDemandes` (PAS `world.chunks.has(rk)`) :
      // un chunk déjà chargé reste éligible tant qu'il n'a pas encore été
      // demandé — c'est ce qui permet à onBienvenue (reconnexion à la même
      // graine, SPEC-SERVEUR-009) de forcer une redemande de tous les chunks
      // déjà en mémoire en vidant simplement `overridesDemandes`, sans avoir
      // à décharger le monde. Une seule demande par chunk tant qu'il reste
      // chargé : la réponse (onOverridesChunk) arrive de toute façon avant
      // que le mailleur n'ait fini de tourner plusieurs images, largement
      // avant que le chunk ne soit affiché à l'écran.
      // Débit volontairement sous le budget anti-flood général du serveur
      // (FLOOD_MAX_GENERAL = 30/s, server.js) : un arrivage massif (connexion,
      // téléportation, reconnexion) ne fait pas taire silencieusement le
      // serveur pour le reste de la seconde — les chunks reportés seront
      // redemandés dès la prochaine image tant qu'ils restent voulus.
      if (net.enLigne()) {
        var tOverridesNow = performance.now();
        if (tOverridesNow - overridesFenetreDebut > 1000) { overridesFenetreDebut = tOverridesNow; overridesFenetreN = 0; }
        for (var ridx = 0; ridx < aGenerer.length && overridesFenetreN < OVERRIDES_DEMANDE_BUDGET; ridx++) {
          var rcx = aGenerer[ridx][1], rcz = aGenerer[ridx][2];
          var rk = world.key(rcx, rcz);
          if (overridesDemandes[rk]) continue;
          overridesDemandes[rk] = true;
          net.demanderOverrides(rcx, rcz);
          overridesFenetreN++;
        }
      }

      integrerResultatsWorkers();

      var genMax = unlimited ? 1e9 : GEN_BUDGET, meshMax = unlimited ? 1e9 : MESH_BUDGET;
      var gen = 0, manquants = 0, meshed = 0, attente = 0;
      // SPEC-PERF-006 : `unlimited` (chargement/téléportation) reste
      // entièrement synchrone — un aller-retour worker n'a pas sa place dans
      // un appel qui doit produire un monde jouable avant de rendre la main.
      var avecWorkers = !unlimited && (poolGeneration || poolMaillage);

      if (avecWorkers) {
        var aGenererVoulu = aGenerer.filter(function (e) { return !world.chunks.has(world.key(e[1], e[2])); });
        var aMaillerVoulu = aMailler.filter(function (e) {
          var c = world.chunks.get(world.key(e[1], e[2]));
          return c && c.dirty && world.voisinsCharges(e[1], e[2]);
        });
        fileChunks.voulus(centres, aGenererVoulu, aMaillerVoulu);

        if (poolGeneration) {
          var envoiGen = fileChunks.distribuer('genere', poolGeneration.libres());
          envoiGen.forEach(function (t) {
            poolGeneration.envoyer({ type: 'genere', epoque: fileChunks.epoque, cx: t.cx, cz: t.cz }, []);
          });
          manquants = Math.max(0, aGenererVoulu.length - envoiGen.length);
        } else {
          for (var i = 0; i < aGenerer.length; i++) {
            var cx = aGenerer[i][1], cz = aGenerer[i][2];
            if (world.chunks.has(world.key(cx, cz))) continue;
            if (gen >= genMax) { manquants++; continue; }
            var tGen0 = performance.now();
            world.getChunk(cx, cz, true);
            g.perf.msGeneration = performance.now() - tGen0;
            world.marquerVoisins(cx, cz);
            gen++;
          }
        }

        if (poolMaillage) {
          var envoiMaille = fileChunks.distribuer('maille', poolMaillage.libres());
          envoiMaille.forEach(function (t) {
            var c = world.chunks.get(world.key(t.cx, t.cz));
            if (!c) { fileChunks.echec('maille', t.cx, t.cz); return; }
            var simplifie = estSimplifie(t.priorite, R);
            simplifieEnVol[world.key(t.cx, t.cz)] = simplifie;
            var voisins = MC.TachesChunks.instantaneVoisins(world, t.cx, t.cz);
            poolMaillage.envoyer(
              { type: 'maille', epoque: fileChunks.epoque, cx: t.cx, cz: t.cz, version: c.version,
                simplifie: simplifie, fusion: true, voisins: voisins },
              MC.ContratsV2.transferablesDe({ voisins: voisins }));
          });
          attente = Math.max(0, aMaillerVoulu.length - envoiMaille.length);
        } else {
          for (var j = 0; j < aMailler.length; j++) {
            if (meshed >= meshMax) { attente++; continue; }
            var mx = aMailler[j][1], mz = aMailler[j][2];
            var c2 = world.chunks.get(world.key(mx, mz));
            if (!c2 || !c2.dirty || !world.voisinsCharges(mx, mz)) continue;
            var tMesh0 = performance.now();
            render.syncChunk(world, c2, estSimplifie(aMailler[j][0], R));
            g.perf.msMaillage = performance.now() - tMesh0;
            meshed++;
          }
        }
      } else {
        // ── repli synchrone complet (SPEC-PERF-006) : sans Worker, ou priming ──
        for (var ii = 0; ii < aGenerer.length; ii++) {
          var cxs = aGenerer[ii][1], czs = aGenerer[ii][2];
          if (world.chunks.has(world.key(cxs, czs))) continue;
          if (gen >= genMax) { manquants++; continue; }
          var tGen1 = performance.now();
          world.getChunk(cxs, czs, true);
          g.perf.msGeneration = performance.now() - tGen1;
          world.marquerVoisins(cxs, czs);
          gen++;
        }
        for (var jj2 = 0; jj2 < aMailler.length; jj2++) {
          if (meshed >= meshMax) { attente++; continue; }
          var mx2 = aMailler[jj2][1], mz2 = aMailler[jj2][2];
          var c3 = world.chunks.get(world.key(mx2, mz2));
          if (!c3 || !c3.dirty || !world.voisinsCharges(mx2, mz2)) continue;
          var tMesh1 = performance.now();
          render.syncChunk(world, c3, estSimplifie(aMailler[jj2][0], R));
          g.perf.msMaillage = performance.now() - tMesh1;
          meshed++;
        }
      }
      // chunks voulus pas encore affichés : la distance de vue n'avance que s'ils sont rattrapés
      g.enAttente = attente + manquants;

      world.unloadLoin(centres, R + 3, function (c) {
        // un chunk déchargé : plus la peine de garder une tâche en file/en
        // vol pour lui, ni un résultat déjà reçu (SPEC-PERF-005)
        fileChunks.oublier(c.cx, c.cz);
        render.disposeChunk(c);
      });
      // un chunk allégé qu'on approche redevient complet
      for (var kk = 0; kk < aMailler.length && kk < 200; kk++) {
        if (aMailler[kk][0] > PROCHE_SIMPLE * PROCHE_SIMPLE) break;
        var cs = world.chunks.get(world.key(aMailler[kk][1], aMailler[kk][2]));
        if (cs && cs.simplifie) cs.dirty = true;
      }
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
        var tMesh1 = performance.now();
        render.syncChunk(world, c);
        g.perf.msMaillage = performance.now() - tMesh1;
        done++;
      });
    }

    // ─── donjons ─────────────────────────────────────────────────────────────
    /* Les évènements de créatures (cris, morts, défaites de gardien). L'éveil
       des gardes et des gardiens, lui, est l'affaire du SERVEUR
       (SPEC-ARCHI-034) : le client n'y fait apparaître aucune créature. */
    function surveillerDonjons() {
      /* Les défaites D'ABORD : traiter l'éveil avant laissait, l'image qui suit
         la mort du gardien, un donjon pas encore marqué vaincu — un second
         gardien se relevait aussitôt. */
      var evts = entities.evenements();
      for (var k = 0; k < evts.length; k++) {
        // SPEC-AUDIO-002 : chaque créature a son cri de blessure et de mort,
        // joué là où elle se trouve
        if (evts[k].type === 'blesse' || evts[k].type === 'mort') {
          var sonC = MC.Ambiance.sonCreature(evts[k].victime, evts[k].type === 'mort' ? 'mort' : 'blesse');
          if (sonC && evts[k].pos) audio.jouer(sonC, { categorie: 'creature', x: evts[k].pos.x, y: evts[k].pos.y, z: evts[k].pos.z });
        }
        if (g.histoire && evts[k].type === 'mort' && evts[k].parJoueur) signalerHistoire({ type: 'tuer', mob: evts[k].victime });
        if (g.histoire && evts[k].type === 'boss_vaincu') signalerHistoire({ type: 'boss', donjon: evts[k].donjon });
        if (evts[k].type === 'mort' && evts[k].parJoueur) signalerSucces({ type: 'tuer', mob: evts[k].victime });
        if (evts[k].type === 'boss_vaincu') signalerSucces({ type: 'boss', donjon: evts[k].donjon });
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
    }

    /* SPEC-OBJET-003 : les joueurs locaux qui portent un bijou de diamant
       (effet 'lumiere'), pour la lumière portée du rendu (render.js,
       updateLumieresPortees) — un point de plus au même endroit que les
       autres effets de bijou (chanceBijou, vitesseBijou dans player.js). */
    function joueursLumiereBijou() {
      var out = [];
      for (var i = 0; i < equipe.length; i++) {
        var st = equipe[i].player.state;
        if (st.dead) continue;
        var bijou = st.equip && st.equip.bijou, bd = bijou && C.def(bijou.id);
        if (bd && bd.effet && bd.effet.type === 'lumiere') {
          out.push({ x: st.pos.x, y: st.pos.y, z: st.pos.z, rayon: bd.effet.valeur });
        }
      }
      return out;
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

    // ─── mobilier : lit, présentoir, socle (SPEC-INTERIEUR-002) ────────────
    /* SPEC-ARCHI-025 : dormir dans un lit fixe la réapparition dessus (côté
       client : le point de retour du joueur) et envoie DORMIR au SERVEUR. C'est
       lui qui tient l'ensemble des dormeurs sur TOUS les joueurs présents
       (locaux et distants) et fait passer la nuit quand tous dorment ; un solo
       est le cas « tous les joueurs = 1 ». Le client ne touche jamais à
       l'heure ; il n'a plus de liste de dormeurs. `j` : joueur local qui se
       couche (le premier par défaut). */
    function dormir(target, j) {
      if (DC && !DC.isNight(g.time)) { ui.toast('On ne dort que la nuit', 'warn'); return; }
      var idx = j ? j.index : equipe[0].index;
      g.spawnPoint = { x: target.x + 0.5, y: target.y + 0.05, z: target.z + 0.5 };
      audio.jouer(MC.Ambiance.sonInteraction('porte'), interactionOpts(target));
      if (!net.dormir(idx, true)) ui.toast('Réapparition fixée ici — le serveur n\'est pas joignable.', 'warn');
    }
    g.dormir = dormir;

    /* Présentoir/socle : posent ou retirent UN objet exposé (et non toute
       une grille — ce n'est pas un conteneur). Poser remplace un objet déjà
       exposé plutôt que de le refuser : on vise en général pour remplacer,
       et l'ancien objet retombe au sol pour ne rien perdre. */
    function interagirExposition(action, target) {
      // SPEC-ARCHI-043 (reporté) : le contenu exposé n'est pas encore tenu par le
      // serveur (SPEC-SYNC-027) ; toucher à l'inventaire ici sans lui dupliquerait
      // ou perdrait l'objet. On refuse proprement, sans rien modifier.
      ui.toast('Les présentoirs ne sont pas encore disponibles avec le serveur de jeu', 'warn');
    }
    g.interagirExposition = interagirExposition;

    /* Livre/note en main (SPEC-INTERIEUR-003) : la pile porte son contenu
       dans `data` (vierge tant qu'on n'a rien écrit) ; l'écran d'écriture ou
       de lecture (ui.js) le modifie via `surChange`, qui réécrit la pile —
       c'est ainsi que le texte survit à la sauvegarde et au passage dans un
       coffre/bibliothèque (même sérialisation que n'importe quelle pile,
       voir inventory.js). */
    function ouvrirLivreEnMain() {
      var st = player.state, i = st.selected, stack = st.inv.stackAt(i);
      if (!stack || !MC.Livres) return;
      if (!stack.data) stack.data = stack.id === I.NOTE ? MC.Livres.creerNote() : MC.Livres.creerLivre();
      ui.ouvrirLivre(stack.data, {
        auteur: (equipe[0] && equipe[0].nom) || 'Joueur',
        surChange: function (nouveau) {
          var courant = st.inv.stackAt(i);
          if (courant) courant.data = nouveau;
        },
      });
      input.setState('ui');
    }
    g.ouvrirLivreEnMain = ouvrirLivreEnMain;

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
        signalerSucces({ type: 'vehicule', vehicule: e.vehicule });
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
      var ch = coffreDe(x, y, z);
      if (ch) {
        ch.slots.forEach(function (st) {
          if (st) { entities.dropItem(x + 0.5, y + 0.5, z + 0.5, st.id, st.n); lache += st.n; }
        });
        delete chests[k];
      }
      var di = distributeurs[k];
      if (di) {
        di.slots.forEach(function (st) {
          if (st) { entities.dropItem(x + 0.5, y + 0.5, z + 0.5, st.id, st.n, null, st.data); lache += st.n; }
        });
        delete distributeurs[k];
      }
      if (lache) ui.toast(lache + ' objet(s) récupéré(s) du conteneur');
      return lache;
    }
    g.spillContainer = spillContainer;

    /* SPEC-MECA-001 : un distributeur éjecte le premier objet de sa première
       pile non vide — au sol, sauf une munition (flèche, galet…) qui part en
       projectile vers le haut (aucune orientation stockée sur ce bloc). */
    function ejecterDistributeur(x, y, z) {
      var k = x + ',' + y + ',' + z;
      var di = distributeurs[k];
      if (!di) return;
      var i = MC.Circuits.distributeurChoix(di.slots);
      if (i < 0) return;
      var st = di.slots[i];
      var idef = C.def(st.id);
      di.consumeAt(i, 1);
      if (idef && idef.ammo) {
        entities.tirer({ x: x + 0.5, y: y + 1, z: z + 0.5 }, { x: 0, y: 1, z: 0 },
                        14, idef.damage || 5, null, idef.ammoType || 'fleche');
      } else {
        entities.dropItem(x + 0.5, y + 1, z + 0.5, st.id, 1);
      }
    }
    g.ejecterDistributeur = ejecterDistributeur;

    /* SPEC-SUCCES-001 : altitude, distance parcourue et nuit survécue se
       vérifient au fil du temps plutôt qu'à un événement précis. Hors ligne
       seulement : en ligne, plusieurs joueurs partagent l'équipe et rien ne
       fait autorité sur « la » position à suivre. */
    var succesT = 0, succesDist = 0, succesPosPrec = null, succesNuit = DC.isNight(60);
    function tickerSucces(dt) {
      if (net.enLigne()) return;
      var pos = player.state.pos;
      if (succesPosPrec && !player.state.dead) {
        var d = Math.hypot(pos.x - succesPosPrec.x, pos.y - succesPosPrec.y, pos.z - succesPosPrec.z);
        // une téléportation (respawn, nouvelle partie) ne compte pas comme un déplacement
        if (isFinite(d) && d < 20) succesDist += d;
      }
      succesPosPrec = { x: pos.x, y: pos.y, z: pos.z };

      var nuitActuelle = DC.isNight(g.time);
      if (succesNuit && !nuitActuelle && !player.state.dead) signalerSucces({ type: 'nuit' });
      succesNuit = nuitActuelle;

      succesT -= dt;
      if (succesT > 0) return;
      succesT = 1;
      signalerSucces({ type: 'altitude', y: pos.y });
      if (succesDist > 0) { signalerSucces({ type: 'distance', blocs: succesDist }); succesDist = 0; }
    }

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
        if (t !== null && t <= pl.reachArme() && t < bt) { bt = t; best = m; }
      });
      return best;
    }
    /* Un autre joueur, en ligne : même visée qu'une créature, avec un
       gabarit fixe (SPEC-COMBAT-002) — le serveur seul décide si le coup
       porte réellement (réglage PvP, zones des deux joueurs). */
    function joueurDistantVise(pl) {
      var o = pl.eyePos(), d = pl.lookDir(), best = null, bt = Infinity;
      net.distants.forEach(function (dj) {
        var t = entities.rayBox(o, d, dj.pos.x - 0.42, dj.pos.y - 0.1, dj.pos.z - 0.42,
                                dj.pos.x + 0.42, dj.pos.y + 1.9, dj.pos.z + 0.42);
        if (t !== null && t <= pl.reachArme() && t < bt) { bt = t; best = dj; }
      });
      return best;
    }
    function attaqueEnLigne(j) {
      var pl = j.player, st = pl.state;
      if (st.attackCd > 0) return false;
      var h = pl.held(), d = h ? C.def(h.id) : null;
      // cadence propre à l'arme (SPEC-OBJET-002), 0.45s sinon
      var cadence = (d && d.cadence !== undefined) ? d.cadence : 0.45;
      var m = mobDistantVise(pl);
      if (m) {
        st.attackCd = cadence;
        net.attaquer(m.eid, (d && d.damage) || 1, j.index);
        audio.play('frapper');
        return true;
      }
      var dj = joueurDistantVise(pl);
      if (!dj) return false;
      st.attackCd = cadence;
      net.attaquerJoueur(dj.id, (d && d.damage) || 1, j.index);
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
      // portée propre à l'arme en main (SPEC-OBJET-002 : lance, dague…)
      var e = entities.aimedAt(player.eyePos(), player.lookDir(), player.reachArme());
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
      var avantBascule = instantaneBascule(target);
      var res = player.useOn(target);
      if (!res) return;
      if (res === 'interdit') { ui.toast('Cette histoire ne vous permet pas de l\'utiliser', 'warn'); return; }
      if (res === 'eat') net.manger(mange, 0, player.state.selected);
      if (res.indexOf('vehicule:') === 0) { poserVehicule(player, res.slice(9), target); return; }
      if (res === 'carte') { ouvrirCarte(); return; }
      if (res.indexOf('open:') === 0) {
        var kind = res.slice(5);
        var k = target.x + ',' + target.y + ',' + target.z;
        /* SPEC-ARCHI-030 : un conteneur posé (coffre, armoire, étagère,
           bibliothèque, fourneau, distributeur) ou la banque (bloc coffre-fort)
           ne s'affiche qu'après accord du serveur — jamais une copie locale
           (voir onConteneurEtat) : c'est le seul chemin, solo fermé comme réseau. */
        var CONTENEURS_POSES = { furnace: 1, chest: 1, armoire: 1, etagere: 1, bibliotheque: 1, distributeur: 1, banque: 1 };
        if (CONTENEURS_POSES[kind]) {
          net.ouvrirConteneur({ x: target.x, y: target.y, z: target.z }, 0);
          audio.jouer(MC.Ambiance.sonInteraction(kind === 'furnace' ? 'fourneau' : 'coffre'), interactionOpts(target));
          if (kind === 'banque') signalerSucces({ type: 'banque' });
          // L'écran s'affiche vraiment à la réponse du serveur (onConteneurEtat,
          // CONTENEUR_ETAT) — un refus (portée, etc.) laisse l'écran vide,
          // Échap referme normalement (closeUI/forceCloseContainer tolèrent
          // l'absence de conteneur ouvert).
          input.setState('ui');
          return;
        } else if (kind === 'info') {
          var ri = rendreService('info', null);
          ui.toast(ri.message);
          if (chat) chat.systeme(ri.message);
          audio.jouer(MC.Ambiance.sonInteraction('interface'), { categorie: 'interaction' });
          return;
        } else if (kind === 'coffre_piege' || kind === 'coffre_surprise') {
          ouvrirCoffreSuspect(kind, target, k);
          return;
        } else if (kind === 'bloc_commande') {
          ouvrirBlocCommande(target);
          return;
        } else {
          ui.openContainer('craft', player.state.inv, null, undefined, player.state.grille);
          audio.jouer(MC.Ambiance.sonInteraction('etabli'), interactionOpts(target));
        }
        input.setState('ui');
        return;
      }
      if (res === 'dormir') { dormir(target); return; }
      if (res === 'exposer' || res === 'retirer') { interagirExposition(res, target); return; }
      if (res === 'livre') { ouvrirLivreEnMain(); return; }
      if (res === 'place' || res === 'place-ici') annoncerPose(equipe[0], res, target, mange);
      if (res === 'place' || res === 'place-ici') audio.play('poser');
      else if (res === 'eat') { audio.play('manger'); signalerSucces({ type: 'manger', id: mange }); }
      else if (res === 'till') { audio.play('poser'); ui.toast('Terre labourée'); }
      else if (res === 'plant') { audio.play('poser'); ui.toast('Graines plantées'); }
      else if (res === 'grow') { audio.play('poser'); ui.toast('Ça pousse !'); }
      // SPEC-AUDIO-004 : une porte ou une trappe qui bascule, où qu'elle soit
      else if (res === 'bascule') { annoncerBascule(equipe[0], avantBascule); audio.jouer(MC.Ambiance.sonInteraction('porte'), interactionOpts(target)); }
    }

    /* Une porte se compose de deux blocs et se bascule des deux à la fois : on
       relève les trois cases concernées (visée, dessus, dessous) AVANT que
       useOn ne les change, puis on annonce au serveur celles qui ont basculé
       (il vérifie que c'est bien une bascule et la portée ; aucun objet requis). */
    function instantaneBascule(t) {
      return [0, 1, -1].map(function (dy) { return { x: t.x, y: t.y + dy, z: t.z, id: world.getBlock(t.x, t.y + dy, t.z) }; });
    }
    function annoncerBascule(j, avant) {
      avant.forEach(function (c) {
        var maintenant = world.getBlock(c.x, c.y, c.z);
        if (maintenant !== c.id && C.bascule(c.id) === maintenant)
          net.poserBloc(c.x, c.y, c.z, maintenant, 0, j.index, world.getEtat(c.x, c.y, c.z));
      });
    }

    /* SPEC-ARCHI-031 : une pose prédite localement est TOUJOURS annoncée au
       serveur, qui la valide contre son inventaire (SPEC-SYNC-028) et la
       diffuse. 'place-ici' (fusion de dalle en bloc plein, SPEC-CONSTR-002)
       écrit sur la case visée elle-même, pas sur la case adjacente : il faut
       annoncer la bonne position, sinon les autres joueurs ne voient jamais la
       fusion. L'état (orientation d'un escalier, moitié d'une dalle —
       SPEC-CONSTR-001/002) et la case d'inventaire d'où vient l'objet partent
       avec. Sert à tout joueur local (clavier, manette, écran partagé). */
    function annoncerPose(j, res, target, idObjet) {
      var bx, by, bz;
      if (res === 'place-ici') { bx = target.x; by = target.y; bz = target.z; }
      else { bx = target.x + target.nx; by = target.y + target.ny; bz = target.z + target.nz; }
      net.poserBloc(bx, by, bz, world.getBlock(bx, by, bz), 0, j.index, world.getEtat(bx, by, bz), j.player.state.selected);
      signalerHistoire({ type: 'poser', bloc: idObjet, x: bx, y: by, z: bz });
    }

    /* Position d'une interaction (coffre, fourneau, établi, porte…) pour la
       spatialiser (SPEC-AUDIO-006) ; `target` est le bloc visé, toujours
       présent dans ces branches. */
    function interactionOpts(target) {
      return { categorie: 'interaction', x: target.x + 0.5, y: target.y + 0.5, z: target.z + 0.5 };
    }

    /* Coffres piégés et surprises (SPEC-OBJET-005). Le kit de désamorçage en
       main tente de neutraliser le piège avant qu'il ne se déclenche ; sans
       lui (ou en cas d'échec), il se déclenche immédiatement. Un coffre
       surprise cache soit un butin rare, soit un mimic hostile. */
    function ouvrirCoffreSuspect(kind, target, k) {
      // SPEC-ARCHI-044 (reporté) : pièges, surprises et kit de désamorçage
      // modifient inventaire et monde hors du serveur ; refusés proprement
      // plutôt que de dupliquer ou perdre des objets.
      ui.toast('Ce coffre suspect ne peut pas encore être ouvert avec le serveur de jeu', 'warn');
    }

    /* Traduit une opération de MC.Conteneurs en message réseau : applique
       sur l'état affiché ET prévient le serveur avec un `seq` de prédiction
       (rejoué/purgé par `onInvMaj`). Ne
       consomme un `seq` que si l'opération a réellement pris effet, pour que
       les compteurs client/serveur restent alignés un-message-un-seq. */
    function operer(j, op, msgBase) {
      // Un conteneur posé/banque ouvert est résolu par sa clé — c'est le MÊME
      // objet que celui affiché par l'UI (`ui.container.cont`), donc la
      // prédiction s'y voit tout de suite ; il est corrigé plus tard par un
      // delta serveur (INV_MAJ.conteneurs ou CONTENEUR_MAJ, jamais remplacé).
      var ctx = { joueur: j.player.state, conteneur: function (cle) {
        return (conteneurOuvert && conteneurOuvert.cle === cle) ? conteneurOuvert.mirror : null;
      }, regles: regles };
      var r = MC.Conteneurs.appliquer(ctx, op);
      if (r.ok && j.predInv) {
        var seq = j.predInv.suivant(op);
        var msg = Object.assign({}, msgBase, { j: j.index, seq: seq });
        net.envoyer(msg);
      }
      return r;
    }

    /* Vide le journal de diminutions prédites de player.js (consommerCase,
       userCase, transformerCase) dans un ou plusieurs INV_CONSOMMER — au
       plus OPS_MAX opérations chacun (B1.md § 6, § 10). Le journal a déjà
       muté `pl.inv` au moment de la consommation : ce n'est ici qu'un envoi
       groupé, pas une nouvelle application. */
    function purgerJournalInv(j) {
      var st = j.player.state, jour = st.journalInv;
      if (!jour || !jour.length || !j.predInv) return;
      var OPS_MAX = MC.ContratsV2.BORNES.OPS_MAX;
      while (jour.length) {
        var lot = jour.splice(0, OPS_MAX);
        var seq = j.predInv.suivant({ k: 'consommer', ops: lot });
        net.envoyer({ t: MC.ContratsV2.MSG.INV_CONSOMMER, j: j.index, seq: seq, ops: lot });
      }
    }

    function onKey(code) {
      var act = MC.Options.actionDe(g.options.touches, code);
      if (act === 'inventaire') {
        ui.openContainer('inv', player.state.inv, player.state.equip, undefined, player.state.grille);
        input.setState('ui');
      } else if (act === 'livre') {
        ui.openContainer('inv', player.state.inv, player.state.equip, undefined, player.state.grille);
        ui.toggleLivre();
        input.setState('ui');
      } else if (act === 'sauvegarder') {
        doSave(true);
      } else if (act === 'hud') {
        // bascule générale du HUD (SPEC-HUD-001)
        hud.basculerTout();
        ui.appliquerHud();
      } else if (act === 'chat') {
        // même masqué, T doit rouvrir le chat pour pouvoir y écrire (SPEC-HUD-008)
        if (!hud.visible('chat')) hud.regler('chat', true);
        chat.ouvrir();
        input.setSaisie(true);
      } else if (code === 'Slash') {
        if (!hud.visible('chat')) hud.regler('chat', true);
        chat.ouvrir(); chat.saisie = '/';
        input.setSaisie(true);
      } else if (act === 'son') {
        ui.toast(audio.setEnabled(!audio.enabled) ? 'Son activé' : 'Son coupé');
      } else if (act === 'carte') {
        if (aUneCarte(player)) ouvrirCarte();
        else ui.toast('Il faut une carte dans l\'inventaire', 'warn');
      } else if (act === 'journal') {
        if (g.histoire) { ui.journalHistoire(g.histoire, g.finHistoire); input.setState('ui'); }
        else ui.toast('Le journal n\'existe qu\'en mode histoire', 'warn');
      } else if (act === 'factions') {
        ui.panneauFactions(world.reputation);
        input.setState('ui');
      } else if (act === 'succes') {
        ui.panneauSucces(g.succes);
        input.setState('ui');
      } else if (act === 'descendre') {
        descendreDe(equipe[0]);
      } else if (act === 'jeter') {
        // G et non Q : sur AZERTY, Q est déjà la touche « aller à gauche »
        // SPEC-ARCHI-031 : jamais entities.dropItem local — l'objet au sol vient
        // du serveur (lacherAuxPieds), répliqué par ETAT (SPEC-SYNC-026), sinon
        // il apparaîtrait deux fois
        var j0 = equipe[0], i0 = j0.player.state.selected, stack0 = j0.player.state.inv.slots[i0];
        if (stack0) {
          var r0 = operer(j0, { k: 'lacher', i: i0, n: 1 }, { t: MC.ContratsV2.MSG.INV_LACHER, i: i0, n: 1 });
          if (r0.ok) { ui.toast('Jeté : ' + C.nameOf(r0.effets.lache.id)); audio.play('poser'); }
        }
      }
    }

    function onKeyAnyState(code) {
      if (input.state !== 'ui') return;
      // une réplique du récit se répond aussi au clavier : 1-9 pour un choix,
      // Entrée ou Espace pour le premier (« Continuer »)
      if (ui.dialogueOuvert && ui.dialogueOuvert()) {
        var n = /^(Digit|Numpad)([1-9])$/.exec(code);
        if (n) ui.choisirDialogue(+n[2] - 1);
        else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') ui.choisirDialogue(0);
        return;
      }
      var act = MC.Options.actionDe(g.options.touches, code);
      if (act === 'inventaire') closeUI();
      else if (act === 'carte' && ui.carteOuverte()) closeUI();
      else if (act === 'factions' && ui.factionsOuvertes()) closeUI();
      else if (act === 'journal' && ui.journalOuvert()) closeUI();
      else if (act === 'succes' && ui.succesOuverts()) closeUI();
      // le livre (SPEC-INTERIEUR-003) se ferme par Échap (onEscape -> closeUI,
      // qui appelle déjà ui.fermerLivreEcran) : pas de raccourci dédié ici,
      // sans quoi taper une lettre liée à une autre action fermerait le
      // panneau en pleine écriture.
      else if (act === 'livre' && !(ui.livreEcranOuvert && ui.livreEcranOuvert())) ui.toggleLivre();
    }

    function onEscape() {
      if (input.state === 'ui') { closeUI(); return; }
      if (input.state === 'playing') { input.setState('paused'); return; }
      if (input.state === 'paused') { resume(); return; }
    }

    function forceCloseContainer() {
      var cont = ui.container;
      if (cont && cont.cont) {
        // SPEC-ARCHI-030 : un conteneur posé/banque (modèle référence) — tout y
        // est déjà réellement rangé (chaque clic était déjà une opération) :
        // fermer ne fait que se désabonner, rien à déclarer.
        net.fermerConteneur(cont.cont.cle, 0);
        conteneurOuvert = null;
      }
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
      ui.fermerSucces();
      if (ui.fermerLivreEcran) ui.fermerLivreEcran();
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

    /* SPEC-CMD-001 : toute la logique des commandes vit dans MC.Commandes
       (module pur, testable sous Node) ; ici on ne fait que rassembler le
       contexte et appliquer les actions qu'il renvoie. Factorisé pour être
       réutilisé par les blocs de commande (SPEC-MECA-007), qui rejouent le
       même routage sans passer par le chat. */
    function contexteCommande() {
      var s = player.state;
      var noms = [];
      if (net.enLigne()) net.distants.forEach(function (d) { noms.push(d.nom); });
      var j0 = equipe[0];
      return {
        temps: g.time,
        dureeJour: DC.DAY_LENGTH,
        graine: world.seed,
        position: s.pos,
        meteo: g.meteo ? {
          nom: g.meteo.nom, vent: g.meteo.vent,
          temperature: (j0 && j0.temperature) ? j0.temperature.temperature : null,
        } : null,
        succes: g.succes,
        renduRealiste: render.loin ? render.loin.options.realiste : true,
        enLigne: net.enLigne(),
        joueurs: noms,
      };
    }
    /* ─── actions des commandes, un gestionnaire par action (lot A0, « aiguillage ») ───
       Sans changement de comportement : l'ancien `switch` devient une table.
       Chaque lot B-* n'édite que le gestionnaire de SES lignes :
         heure (B-ENV), faction (B-RESEAU), duel (B-VIE) ; les autres sont
         indépendants du réseau de jeu. */
    /* SPEC-ARCHI-025 : /jour et /nuit sont une DEMANDE au serveur (ADMIN 'heure'),
       refusée hors créatif sauf administrateur, identique en solo et en réseau. */
    function actionCommandeHeure(a) { net.admin('heure', { valeur: a.valeur }); }
    function actionCommandeVider() { chat.vider(); }
    function actionCommandeRejoindre(a) { net.connecter(a.hote, g.nomJoueur || 'Joueur', equipe.length); }
    function actionCommandeQuitter() { net.deconnecter(); }
    function actionCommandeRendu(a) { render.reglerRealiste(a.realiste); }
    // factions de joueurs : en ligne le serveur fait foi, hors ligne l'état local
    function actionCommandeFaction(a) {
      if (net.enLigne()) { net.envoyerChat('/faction ' + (a.brut || '')); return; }
      g.guildes = g.guildes || MC.Guildes.creerEtat();
      var rf = MC.Guildes.appliquerAction(g.guildes, g.nomJoueur || 'Joueur', a);
      chat.systeme(rf.message);
    }
    function actionCommandeAdmin(a) { net.admin(a.action, a.args); }
    // B4 (SPEC-PVP-005) : le duel exige le serveur (aucun PvP réseau en solo)
    function actionCommandeDuel(a) {
      if (net.enLigne()) { net.envoyerChat('/duel ' + (a.brut || '')); return; }
      chat.systeme('Le duel exige d\'être en ligne.');
    }
    var ACTIONS_COMMANDE = {
      heure: actionCommandeHeure, vider: actionCommandeVider, rejoindre: actionCommandeRejoindre,
      quitter: actionCommandeQuitter, rendu: actionCommandeRendu, faction: actionCommandeFaction,
      admin: actionCommandeAdmin, duel: actionCommandeDuel,
    };
    function appliquerActionCommande(a) {
      if (a && Object.prototype.hasOwnProperty.call(ACTIONS_COMMANDE, a.type)) ACTIONS_COMMANDE[a.type](a);
    }
    function executerCommande(cmd) {
      var res = MC.Commandes.executer(cmd, contexteCommande());
      res.messages.forEach(function (m) { chat.systeme(m); });
      res.actions.forEach(appliquerActionCommande);
    }
    g.traiterMessage = traiterMessage;

    /* SPEC-MECA-007 : un bloc de commande garde sa commande (texte) sur le
       monde (world.getCommande/setCommande, sauvegardée comme un état de
       bloc) et la rejoue au même routage que le chat, sur front montant du
       signal (circuits.js déclenche onCommande une fois par activation).
       Aucun message de chat affiché : un mécanisme ne doit pas spammer. */
    function declencherBlocCommande(x, y, z) {
      if (!world.getCommande) return;
      var texte = world.getCommande(x, y, z);
      if (!texte) return;
      var cmd = MC.Chat.parseCommande(texte);
      if (!cmd) return;
      var res = MC.Commandes.executer(cmd, contexteCommande());
      res.actions.forEach(appliquerActionCommande);
    }

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
      simplifieEnVol = Object.create(null);
      reinitialiserPools();
      entities.list.length = 0;
      render.libererToutesEntites();
      ui.toast('Cauchemar : la carte et la sauvegarde ont ete detruites', 'warn');
      input.setState('dead');
    }
    g.perdrePartie = perdrePartie;

    function doSave(notify) {
      // B1 (docs/vague-2/B1.md § 6) : le serveur fait foi en ligne — une
      // sauvegarde locale écraserait l'inventaire solo par l'inventaire
      // (souvent vide) de l'équipe en ligne à la prochaine reconnexion.
      if (net.enLigne()) { if (notify) ui.toast('Sauvegarde désactivée en ligne (le serveur fait autorité)', 'warn'); return false; }
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
          } else signalerSucces({ type: 'casser', bloc: res.id });
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
      var idMain = pl.heldId();
      var avantBascule = instantaneBascule(target);
      var res = pl.useOn(target);
      if (!res) return;
      if (res === 'eat') net.manger(idMain, j.index, pl.state.selected);
      if (res.indexOf('vehicule:') === 0) { poserVehicule(pl, res.slice(9), target); return; }
      if (res === 'dormir') { dormir(target, j); return; }
      if (res.indexOf('open:') === 0) {
        // seules les interfaces du joueur 1 s'ouvrent : un seul clavier
        if (j.index !== 0) return;
        ouvrirConteneur(res.slice(5), target);
        return;
      }
      if (res === 'place' || res === 'place-ici') {
        annoncerPose(j, res, target, idMain);
        audio.play('poser');
      }
      else if (res === 'eat') { audio.play('manger'); signalerSucces({ type: 'manger', id: idMain }); }
      else if (res === 'till' || res === 'plant') audio.play('poser');
      // SPEC-AUDIO-004 : une porte ou une trappe qui bascule, où qu'elle soit
      else if (res === 'bascule') { annoncerBascule(j, avantBascule); audio.jouer(MC.Ambiance.sonInteraction('porte'), interactionOpts(target)); }
    }

    /* SPEC-MECA-007 : petite interface (une invite texte suffit — pas besoin
       d'un écran dédié pour une seule ligne) pour lire/écrire la commande
       d'un bloc de commande. Aucune décision ici : le serveur seul tranche
       (administrateur, ou hôte en mode créatif — server.js/blocCommandeAutorise),
       identique en solo fermé et en réseau. */
    function ouvrirBlocCommande(target) {
      var actuel = (world.getCommande && world.getCommande(target.x, target.y, target.z)) || '';
      if (typeof window === 'undefined' || !window.prompt) return;
      var texte = window.prompt('Commande du bloc (ex: /jour) :', actuel);
      if (texte === null) return;
      texte = texte.trim().slice(0, 200);
      // panneau admin existant (SPEC-ADMIN-006) : le serveur revérifie le rôle
      // ou le mode créatif de l'hôte avant d'appliquer (SPEC-ARCHI-033), et sa
      // réponse s'affiche dans le chat (onAdminRep)
      net.admin('bloc_commande', { x: target.x, y: target.y, z: target.z, texte: texte });
    }

    /* Second chemin d'ouverture (joueur au clavier ou à la manette, via
       utiliserPour) : le même que dans onUse — tout conteneur posé passe par
       le serveur (CONTENEUR_OUVRIR, réponse CONTENEUR_ETAT). Ne sert qu'au
       joueur 1 (un seul clavier). */
    function ouvrirConteneur(kind, target) {
      if (kind === 'bloc_commande') { ouvrirBlocCommande(target); return; }
      var CONTENEURS_POSES = { furnace: 1, chest: 1, armoire: 1, etagere: 1, bibliotheque: 1, distributeur: 1, banque: 1 };
      if (CONTENEURS_POSES[kind]) {
        net.ouvrirConteneur({ x: target.x, y: target.y, z: target.z }, 0);
        audio.jouer(MC.Ambiance.sonInteraction(kind === 'furnace' ? 'fourneau' : 'coffre'), interactionOpts(target));
        if (kind === 'banque') signalerSucces({ type: 'banque' });
      } else {
        ui.openContainer('craft', player.state.inv, null, undefined, player.state.grille);
        audio.jouer(MC.Ambiance.sonInteraction('etabli'), interactionOpts(target));
      }
      input.setState('ui');
    }
    // exposé pour les tests (comme g.coffreDe, g.parlerA…) : ouvre un
    // conteneur (posé) au même chemin que le clic droit dessus, en ligne
    // comme hors ligne — évite d'avoir à simuler visée + clic en e2e.
    g.ouvrirConteneur = ouvrirConteneur;

    // ─── boucle ──────────────────────────────────────────────────────────────
    var last = performance.now(), acc = 0, frames = 0, autoSaveT = 0;

    /* ─── frame() découpée par thème (lot A0, « aiguillage » — SPEC-ARCHI-034…) ───
       Sans changement de comportement : chaque sous-fonction reprend, dans le
       même ordre, le bloc qu'elle remplace. Les lots B-* d'élimination des
       branches `net.enLigne()` n'éditent chacun que SA fonction :
         frameJoueurs     — simulation des joueurs locaux, journal d'inventaire (B-INV)
         frameEntites     — créatures, butin, dégâts, donjons, succès (B-VIE)
         frameTemps       — heure, durée de partie, économie (B-INV, B-ENV)
         frameMonde       — world.tick, apparitions (B-ENV)
         frameConteneurs  — cuisson des fourneaux (B-INV)
         frameFinDePartie — sauvegarde automatique, mort, cauchemar (B-RESEAU, B-VIE)
         frameMondeInterface — le monde continue inventaire ouvert (B-ENV, B-INV)
         frameReseau      — interpolation des joueurs distants (B-RESEAU) */
    function frameJoueurs(dt) {
      // chaque joueur local est simule, quelle que soit sa source d'entrees
      for (var qi = 0; qi < equipe.length; qi++) simulerJoueur(equipe[qi], dt);
      // B1 : envoi groupé, en fin d'image, des diminutions journalisées
      // pendant la simulation — jamais avant, un INV_MAJ arrivé entre-temps
      // effacerait un journal vidé trop tôt
      for (var qj = 0; qj < equipe.length; qj++) purgerJournalInv(equipe[qj]);
    }

    function frameEntites(dt) {
      // entites et butin : le butin va au joueur le plus proche
      // (en ligne, créatures, butin et dégâts sont l'affaire du serveur)
      var ev = net.enLigne() ? { damage: 0, picked: [] }
                             : entities.update(dt, player.state, { reputation: world.reputation,
                               hiver: !!(DC.saison && DC.saison(g.time).nom === 'hiver') });
      if (ev.damage) { player.hurt(ev.damage); audio.play('blesse'); }
      for (var i = 0; i < ev.picked.length; i++) {
        var p2 = ev.picked[i];
        var dest = joueurLePlusProche(p2.entity ? p2.entity.pos : player.state.pos);
        var reste = dest.pickUp(p2.id, p2.n, p2.data);
        if (reste > 0) entities.dropItem(dest.state.pos.x, dest.state.pos.y + 0.5,
                                         dest.state.pos.z, p2.id, reste, null, p2.data);
        else { ui.toast('+' + p2.n + ' ' + C.nameOf(p2.id)); audio.play('ramasser'); }
      }
      entities.mergeItems();
      surveillerDonjons();
      tickerSucces(dt);
    }

    function frameTemps(dt) {
      // temps, apparitions, cultures
      g.time += dt;
      g.duree = (g.duree || 0) + dt;
      // L45 : frais de garde et économie n'avancent que dans le serveur (avancerEconomie)
    }

    /* SPEC-ARCHI-034 : eau, circuits, cultures, feu ET apparitions sont simulés
       par le SERVEUR (le client applique les BLOC reçus). Ce que le client
       garde dans world.tick est déterministe par l'heure (neige saisonnière) ;
       aucune créature n'apparaît côté client. */
    function optionsTickClient() {
      return { eau: false, circuits: false, feu: false, cultures: false, temps: g.time };
    }
    function frameMonde(dt) {
      world.tick(dt, 14, null, optionsTickClient());
    }

    function frameConteneurs(dt) {
      // SPEC-ARCHI-030 : les fourneaux posés cuisent dans le SERVEUR (registre
      // `conteneursPoses`, même fenêtre fermée) — rien à simuler ici.
    }

    function frameFinDePartie(dt) {
      autoSaveT += dt;
      if (autoSaveT >= 60) { autoSaveT = 0; doSave(false); }

      // mort : en cauchemar, un seul joueur suffit a perdre la partie
      if (MC.Split.partiePerdue(equipe, regles)) {
        var finT = g.histoire && !finRecit(g.histoire) ? MC.Recits.signaler(g.histoire, { type: 'mort' }) : [];
        perdrePartie();
        finT.forEach(function (n) { if (n.type === 'fin') finHistoire(n); });
      }
      else if (MC.Split.tousMorts(equipe)) { audio.play('mort'); input.setState('dead'); }
    }

    function frameMondeInterface(dt) {
      world.tick(dt, 14, null, optionsTickClient());
    }

    function frameReseau(dt) {
      if (net.enLigne()) net.interpoler(dt);
    }

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
        frameJoueurs(dt);
        frameEntites(dt);
        frameTemps(dt);
        frameMonde(dt);
        frameConteneurs(dt);
        frameFinDePartie(dt);
      } else if (st === 'ui') {
        // l'inventaire est ouvert : le monde continue doucement (fourneaux, cultures)
        frameMondeInterface(dt);
        render.setHighlight(null);
      } else {
        render.setHighlight(null);
      }

      frameReseau(dt);
      /* On passe TOUJOURS l objet reseau, meme hors ligne : ses tables sont
         alors vides et la meme boucle de reconciliation retire les maillages
         des joueurs partis. Appeler la synchronisation seulement en ligne
         laissait des joueurs fantomes dans la scene apres une deconnexion. */
      render.syncEntities(entities, net, function (x, y, z) { return MC.Lumiere.lumiereEn(world.chunkDe, x, y, z); },
                          DC.sunIntensity(g.time));

      // une camera par joueur, puis un rendu par vue
      var taille = [surface.clientWidth || innerWidth, surface.clientHeight || innerHeight];
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
      if (render.majLointain(grille) && world.habitats) {
        // la grille a bougé : les silhouettes des lieux alentour la suivent
        render.majSilhouettes(world.habitats.lieuxProches(s2.pos.x, s2.pos.z, 1000));
      }
      majMeteo(dt);
      if (st === 'playing' || st === 'ui') { ajusterVue(dt); annoncerLieu(); annoncerZone(); majHistoire(dt); }
      var submerged = P.headInWater(world, s2.pos, player.EYE);
      render.updateAmbience(g.time, submerged);
      render.updateTorches(world);
      if (render.updateLumieresPortees) render.updateLumieresPortees(joueursLumiereBijou());
      render.renderViews(vues);
      ui.placerHuds(vues);

      frames++; acc += dt;
      if (acc >= 0.4) {
        g.fps = Math.round(frames / acc);
        frames = 0; acc = 0;
        // SPEC-RENDU-005 à 008, 015 : un seul échantillonnage du FPS, une
        // seule fenêtre — le panneau F3 (g.perf) et l'adaptatif y puisent
        // tous deux, à égalité stricte à l'image près.
        if (fenetreFPS) {
          MC.Qualite.ajouterEchantillon(fenetreFPS, now / 1000, g.fps);
          var p50 = MC.Qualite.percentile(fenetreFPS, 50), p95 = MC.Qualite.percentile(fenetreFPS, 95);
          g.perf.fps = g.fps; g.perf.fpsP50 = p50 == null ? g.fps : p50; g.perf.fpsP95 = p95 == null ? g.fps : p95;
          var decisions = MC.Qualite.evaluer(etatQualite, now / 1000, p50);
          g.qualite = decisions;
          render.eau.options.refraction = decisions.refraction;
          render.eau.options.fpsP50 = g.perf.fpsP50;
          render.setDPR(decisions.dpr);
          // SPEC-RENDU-006 : simple transmission de la décision déjà calculée
          // (même cascade que refraction/DPR ci-dessus) — la logique vit dans
          // qualite.js, seul le câblage est ici.
          render.setAntialias(decisions.antialias);
        }
      }
      // SPEC-PERF-015 : appels de dessin / triangles de la dernière image, et
      // distance de vue courante (partagée avec le panneau F3)
      var md = render.metriquesDessin;
      g.perf.appelsDessin = md.appelsDessin; g.perf.triangles = md.triangles;
      g.perf.renderDist = render.RENDER_DIST;
      for (var hi = 0; hi < equipe.length; hi++) ui.updateHUDJoueur(g, equipe[hi].player, hi);
      ui.barreBoss(st === 'playing' || st === 'ui' ? gardienProche() : null);
      ui.boussole(st === 'playing' ? world.reperes : null, player.state);
      render.syncReperes(world.reperes);
      ui.updateHUD(g);
      if (ui.majF3) ui.majF3(g);
    }

    window.addEventListener('resize', render.resize);
    window.addEventListener('beforeunload', function () { if (g.spawnPoint) doSave(false); });

    // démarrage : menu, monde prêt derrière
    placeAtSpawn();
    // le poste connaît l'état de session dès le départ : le menu est un état de pause (SPEC-ARCHI-009)
    if (poste) poste.surEtatSession(input.state);
    afficherMenu();
    requestAnimationFrame(frame);

    return g;
  }

  MC.createGame = createGame;
})(typeof globalThis !== 'undefined' ? globalThis : this);
