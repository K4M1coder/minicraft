/* serveur-tic.js — la boucle de simulation
   Un tic du serveur : simulation des joueurs, du monde et diffusion de
   l'état (server.js l'appelle par `setInterval`).

   Module du serveur (SPEC-SERVEUR-008) : extrait de server.js sans changement
   de comportement. Il ne touche ni socket ni fichier par lui-même : tout ce
   dont il dépend arrive par le contexte S (état partagé, fonctions des autres
   modules) et S.hote (minuteries, process, Buffer… de Node), que server.js
   construit puis passe à `installer(S)`. Installer publie dans S les
   fonctions et valeurs de ce module dont les autres ont besoin. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  function installer(S) {
    const { process, require, setImmediate, setInterval } = S.hote;
    const {
      NP, SY, C, CONF, admin, regles, monde, entites, chat, politique, pvp, conteneursPoses,
      derniereEmissionFour, peuplerLieux, avancerPolitique, diffuserPolitiqueSiChangee,
      avancerCatastrophes, catastrophesEnAttente, etapesCatastrophe, appliquerTornades,
      surveillerDonjonsServeur, avancerEconomie, avancerCaravanes, abriServeur, SPAWN,
      clients, diffuser, noterBlocMonde, diffuserBlocsMonde, envoyer, journal, profilTics,
      signalerRecit, sonderRecit, executerBlocCommandeServeur, synchroniserZones, abonnesActuels,
      fermerConteneurPourAbonnes, envoyerInvMaj, signalerSucces, crediterSuccesEvenement,
      tickerSuccesJoueur, entretenirMonture, liberSoutesDetruites, tousLesJoueurs,
      verifierSommeil, pvpAutorise, joueurParEtat, joueurParNom, peutBlesserJoueurs,
      issuePvp,
    } = S;
    const EP = S.EP;   // état partagé modifiable, à forme fixe (créé par server.js)
    Object.assign(S, { statsMesures, majChunksVoulus, solChargeEn });

    /* SPEC-AUDIO-002/005 : les sons que seul le serveur connaît — créatures
       blessées, tuées, qui frappent ou tirent (journal d'entites.js), gardien
       qui s'éveille (S.sonsEnAttente, rempli par surveillerDonjonsServeur) —
       partent dans un message SONS vers chaque client dont un joueur est à
       portée (décision pure : NP.sonsDepuisEvenements, NP.sonsPour). */
    function diffuserSons(evts) {
      let sons = NP.sonsDepuisEvenements(evts);
      if (S.sonsEnAttente && S.sonsEnAttente.length) { sons = sons.concat(S.sonsEnAttente); S.sonsEnAttente.length = 0; }
      if (!sons.length) return;
      clients.forEach(c => {
        if (!c.rejoint || !c.joueurs || !c.joueurs.length) return;
        const l = NP.sonsPour(sons, c.joueurs.map(x => x.joueur.state.pos), NP.PORTEE_SONS, NP.MAX_SONS);
        if (l.length) envoyer(c, { t: NP.MSG.SONS, l });
      });
    }

    let meteoT = null;
    let accEau = 0;
    let accCircuits = 0;      // L29 mécanismes (SPEC-MECA-008) : même cadence que l'eau
    let accFourMsg = 0;       // B1 (étape 7) : cadence de message des fourneaux posés (≤ 2 Hz, SPEC-SYNC-015)
    /* SPEC-MECA-005 : un bouton actionné reste enfoncé DUREE_BOUTON_TICS tics de
       circuits (1 s à 5 Hz). Horloge MONOTONE (le compte des tics de circuits) :
       l'heure du monde peut reculer (fixerHeureDuJour) et laisserait un bouton
       enfoncé indéfiniment. */
    S.DUREE_BOUTON_TICS = 5;
    let ticsCircuits = 0;
    S.ticsCircuits = () => ticsCircuits;
    // diffusion des écrits du tic de circuits (voir plus bas) : cases touchées, niveaux de batterie annoncés
    const changesCircuits = new Map(), batteriesEnvoyees = new Map();
    const ECART_BATTERIE_ENVOI = 13;   // ≈ 5 % de MC.Circuits.CAPACITE_BATTERIE
    /* SPEC-MECA-002 : combustion des générateurs thermiques. Clé du conteneur →
       secondes de combustion restantes de la pièce en cours. Pas persistée : à
       la relance, la pièce entamée est perdue (au plus une), le reste du
       combustible est dans le conteneur, lui sauvegardé. */
    const FUEL_SECONDES_PAR_UNITE = 10;
    const combustionGenerateurs = new Map();
    // un générateur cassé oublie la pièce entamée (reposé, il repart de son conteneur)
    S.oublierCombustion = (x, y, z) => combustionGenerateurs.delete(MC.ContratsV2.cleConteneur(x, y, z));
    function brulerGenerateur(x, y, z, dt) {
      const k = MC.ContratsV2.cleConteneur(x, y, z);
      let reste = combustionGenerateurs.get(k) || 0;
      if (reste <= 0) {
        const cont = conteneursPoses.get(k);
        let i = -1;
        if (cont) for (let s = 0; s < cont.slots.length; s++) {
          const p = cont.slots[s];
          if (p && p.n > 0 && MC.Inventory.fuelValue(p.id) > 0) { i = s; break; }
        }
        if (i < 0) { combustionGenerateurs.delete(k); return false; }
        const pile = cont.slots[i];
        reste = MC.Inventory.fuelValue(pile.id) * FUEL_SECONDES_PAR_UNITE;
        pile.n -= 1;
        if (pile.n <= 0) cont.slots[i] = null;
        cont.rev = (cont.rev || 0) + 1;
        // SPEC-SYNC-015 : qui a ce générateur ouvert voit la pièce prise
        const abonnesG = abonnesActuels(k);
        if (abonnesG.length) {
          const deltaG = { cle: k, rev: cont.rev, maj: [[i, MC.ContratsV2.pileVersCase(cont.slots[i])]] };
          abonnesG.forEach(({ c: c2 }) => envoyer(c2, Object.assign({ t: NP.MSG.CONTENEUR_MAJ }, deltaG)));
        }
      }
      combustionGenerateurs.set(k, reste - dt);
      return true;
    }
    // SPEC-SERVEUR-005 : purge périodique de admin.sessions/invitations/sanctions
    // — cadence et seuils réglables (comme MC_SAUVEGARDE_MS) pour les tests
    // d'intégration, sans quoi il faudrait des dizaines de milliers de sessions
    // réelles pour observer une purge. `heure` (l'horloge du monde, en secondes
    // simulées) est l'unité déjà utilisée par MC.Admin.ouvrirSession/fermerSession
    // à l'appel — les seuils d'ancienneté par défaut sont donc exprimés dans
    // cette même unité (secondes), pas en millisecondes malgré le nom `*Ms` hérité
    // de src/admin.js (générique : il ne fait que comparer deux nombres).
    let accPurge = 0;
    const PURGE_ADMIN_S = parseInt(process.env.MC_ADMIN_PURGE_S, 10) || 3600;
    const PURGE_ADMIN_OPTS = {
      sessionsMax: parseInt(process.env.MC_ADMIN_PURGE_SESSIONS_MAX, 10) || undefined,
      sessionsAgeMs: parseInt(process.env.MC_ADMIN_PURGE_SESSIONS_AGE_S, 10) || 90 * 24 * 3600,
      invitationsMax: parseInt(process.env.MC_ADMIN_PURGE_INVITATIONS_MAX, 10) || undefined,
      invitationsAgeMs: parseInt(process.env.MC_ADMIN_PURGE_INVITATIONS_AGE_S, 10) || 30 * 24 * 3600,
      sanctionsMax: parseInt(process.env.MC_ADMIN_PURGE_SANCTIONS_MAX, 10) || undefined,
      sanctionsAgeMs: parseInt(process.env.MC_ADMIN_PURGE_SANCTIONS_AGE_S, 10) || 90 * 24 * 3600,
    };

    // ── instrumentation de performance (SPEC-SERVEUR-002) ───────────────────────
    /* Coût quasi nul quand désactivée (une lecture d'env au démarrage, un `if`
       par tic) : le banc de charge l'active via MC_MESURES=1, une exploitation
       normale ne le fait jamais. Les échantillons vivent en mémoire seulement —
       10 s d'historique à 60 Hz suffisent pour une moyenne et un 95e centile
       représentatifs sans faire grossir le processus. */
    const MESURES_ACTIVES = process.env.MC_MESURES === '1';
    const MESURES_MAX_ECH = 600;
    const mesuresTicks = [];
    function enregistrerTic(ms) {
      mesuresTicks.push(ms);
      if (mesuresTicks.length > MESURES_MAX_ECH) mesuresTicks.shift();
    }
    function statsMesures() {
      if (!MESURES_ACTIVES) return { actif: false };
      if (!mesuresTicks.length) return { actif: true, echantillons: 0 };
      const tri = mesuresTicks.slice().sort((a, b) => a - b);
      const somme = tri.reduce((a, b) => a + b, 0);
      const idxP95 = Math.min(tri.length - 1, Math.floor(tri.length * 0.95));
      const mem = process.memoryUsage();
      return {
        actif: true,
        echantillons: tri.length,
        tickMoyenMs: +(somme / tri.length).toFixed(3),
        tickP95Ms: +tri[idxP95].toFixed(3),
        memoireRssMo: +(mem.rss / 1048576).toFixed(2),
        memoireHeapMo: +(mem.heapUsed / 1048576).toFixed(2),
        joueurs: [...clients.values()].filter(c => c.rejoint).length,
      };
    }

    // ── boucle de simulation ─────────────────────────────────────────────────────
    const { performance } = require('perf_hooks');
    S.performance = performance;
    EP.dernier = performance.now();
    let accEtat = 0;
    let accSpawn = 0, rotationSpawn = 0, accDonjons = 0;
    const SPAWN_JOUEURS_PAR_TIC = 8;
    let accChunks = 1;         // premier passage immédiat

    /* ── travaux budgétés du tic : génération des chunks, préparation des lieux ──
       Le serveur a besoin du terrain autour de chaque joueur (sol, créatures,
       habitants) et des lieux (villages, villes, routes) jusqu'à RAYON_LIEUX pour
       l'entretien du monde (politique, caravanes, catastrophes). Les produire d'un
       coup bloquait la boucle (mesuré, tools/mesure-tics.js : 0,6 à 0,9 s à
       l'arrivée d'un joueur, des tics de 100 à 600 ms en marchant) : ils le sont
       désormais par petites tranches, sous un budget de temps par tic
       (MC.TravauxServeur.BUDGETS), le sol sous un joueur avant tout le reste. */
    const TS = MC.TravauxServeur;
    S.TS = TS;
    const horlogeTic = () => performance.now();
    const fileChunks = TS.creerFileChunks(monde);
    const cycleLieux = monde.habitats && monde.habitats.regionsDansZone ? TS.creerCycleLieux(monde.habitats) : null;
    /* MC_TEST_BUDGET_CHUNKS_MS=<ms> : budget de génération de chunks par tic imposé (0 : une
       colonne par tic, une génération très lente), réservé aux suites d'intégration qui
       doivent voir un joueur dépasser son terrain (sol absent, véhicule gelé), jamais en
       exploitation. Les préparations gardent leur réserve garantie. */
    const BUDGETS_TIC = (function () {
      const ms = parseFloat(process.env.MC_TEST_BUDGET_CHUNKS_MS);
      if (!(ms >= 0)) return TS.BUDGETS;
      setImmediate(() => journal('ATTENTION : MC_TEST_BUDGET_CHUNKS_MS actif — génération de chunks bridée à ' + ms + ' ms par tic (réglage de test, jamais en exploitation)'));
      return Object.assign({}, TS.BUDGETS, { FOND_MS: ms, URGENT_MS: ms });
    })();
    const prepCatastrophes = TS.creerPreparateur();
    const RAYON_CHUNKS_JOUEUR = 3, RAYON_DECHARGE = 5;
    const RAYON_LIEUX = 1500;                // le plus grand rayon que consulte l'entretien du monde (avancerCatastrophes)
    const RAYON_VILLES_CARAVANES = 900;      // celui d'avancerCaravanes
    function centresChunks() {
      const centres = [[Math.floor(SPAWN.x / 16), Math.floor(SPAWN.z / 16)]];
      clients.forEach(c => {
        if (c.rejoint && c.joueurs) c.joueurs.forEach(js => centres.push([Math.floor(js.joueur.state.pos.x / 16), Math.floor(js.joueur.state.pos.z / 16)]));
      });
      return centres;
    }
    function majChunksVoulus() { fileChunks.vouloir(monde.chunksVoulus(centresChunks(), RAYON_CHUNKS_JOUEUR)); }
    /* Après les lieux : les naissances de cyclones (150 ms d'un coup : le relief de 225
       cellules), celles que l'entretien consulte et la suivante, d'avance ; puis, une
       route à la fois, les trajets des villes que les caravanes consultent. Les routes
       obtenues sont celles qu'un appel direct aurait tracées (caches de routes.js). */
    function etapesSuiteEntretien(lire, positions) {
      const etapes = [];
      if (monde.meteo && monde.meteo.preparerGenesesCyclones) {
        monde.meteo.epoquesCyclones(EP.heure).forEach(e => {
          const etape = () => (monde.meteo.preparerGenesesCyclones(e, horlogeTic() + 2, horlogeTic) ? null : [etape]);
          etapes.push(etape);
        });
      }
      if (monde.routes && monde.routes.connexionsDe && monde.routes.cheminEntre) {
        etapes.push(() => {
          const villes = [];
          positions.forEach(p => monde.habitats.lieuxProches(p.x, p.z, RAYON_VILLES_CARAVANES, lire).forEach(l => {
            if ((l.kind === 'ville' || l.kind === 'megapole') && villes.indexOf(l) < 0) villes.push(l);
          }));
          return villes.map(v => () => monde.routes.connexionsDe(v).map(c2 => () => { monde.routes.cheminEntre(v, c2); }));
        });
      }
      return etapes;
    }
    /* Une fois par cadence d'entretien (1 s). Un cycle de lieux PRÊT (préparé tic après
       tic, aussi longtemps qu'il le faut) est consommé : politique, caravanes et
       catastrophes s'exécutent sur ses positions et ses lieux, sans rien construire
       d'un coup ; puis un nouveau cycle démarre pour les positions du moment. Vivacité :
       l'entretien a lieu dès que la préparation finit, jamais « si elle tient en un appel ». */
    let entretiensFaits = 0;
    function entretienDuMonde() {
      if (cycleLieux && cycleLieux.pret) {
        const positions = cycleLieux.consommer();
        const ctx = { positions, proches: (x, z, r) => monde.habitats.lieuxProches(x, z, r, cycleLieux.lire) };
        avancerPolitique(ctx);
        diffuserPolitiqueSiChangee();         // SPEC-SYNC-024 : les clients connectés suivent l'état politique
        avancerCaravanes(ctx);
        avancerCatastrophes(ctx);
        entretiensFaits++;
      } else if (!cycleLieux) {
        avancerPolitique(); diffuserPolitiqueSiChangee(); avancerCaravanes(); avancerCatastrophes();
        entretiensFaits++;
      }
      if (cycleLieux && !cycleLieux.actif && !cycleLieux.pret) {
        cycleLieux.demarrer(tousLesJoueurs().map(({ js }) => js.joueur.state.pos), RAYON_LIEUX, etapesSuiteEntretien);
        cycleLieux.avancer(performance.now() + TS.BUDGETS.PREPARATION_MIN_MS, horlogeTic);
      }
    }
    /* Le sol sous un joueur : ses 3×3 chunks existent côté serveur. */
    function solChargeEn(x, z) { return fileChunks.manquants(TS.chunksDuSol(x, z)) === 0; }
    // pendant un rejeu d'entrées : le joueur (ou son véhicule, qu'il occupe) est-il encore sur du terrain généré ?
    function solJoueurOk(st) { return solChargeEn(st.pos.x, st.pos.z); }
    function solPret(js) { return solChargeEn(js.joueur.state.pos.x, js.joueur.state.pos.z); }
    function travauxDuTic(joueurs) {
      const urgents = [];
      joueurs.forEach(({ js }) => TS.chunksDuSol(js.joueur.state.pos.x, js.joueur.state.pos.z).forEach(c => urgents.push(c)));
      if (!prepCatastrophes.actif && catastrophesEnAttente.length) { const c = catastrophesEnAttente.shift(); prepCatastrophes.lancer(etapesCatastrophe(c.l, c.evt, c.heure)); }
      // chunks (urgents d'abord) sous budget, puis chaque préparation avec sa réserve garantie
      TS.travaillerTic(fileChunks, urgents, [cycleLieux, prepCatastrophes], horlogeTic, BUDGETS_TIC);
      if (profilTics) profilTics.section('chunks et preparations');
    }

    // SPEC-DONJON-017 : « pillé depuis » observé à la première détection d'un
    // coffre marqué dans monde.coffresPilles (posé par la section conteneurs,
    // jamais modifiée ici) — pas l'instant exact du pillage, mais borné à la
    // cadence d'entretien du monde (~1 s, voir accChunks ci-dessus), négligeable
    // devant le long délai de régénération (plusieurs jours simulés).
    const coffresPilleDepuis = new Map();
    /* SPEC-DONJON-017 : un coffre de donjon pillé (marqué dans
       monde.coffresPilles par remplirConteneurNeuf, section conteneurs — jamais
       touchée ici) regarnit son contenu après un long délai. Toute la logique
       (dater le pillage à sa première détection, décider du délai, désabonner
       les joueurs qui l'avaient ouvert — même précaution que la casse d'un
       conteneur, revue adversariale item 3, ~l. 1344-1367 — puis l'effacer de
       `conteneursPoses`) vit dans MC.Donjons.regenererCoffres, PURE et testée
       sous Node avec de fausses collections (tests/spec-donjons.js) : ici, on ne
       fait que lui passer les VRAIES. À la prochaine ouverture, le coffre
       effacé de `conteneursPoses` est retrouvé absent par
       `ouvrirConteneurPourJoueur` (section conteneurs), qui en recrée un neuf
       que `remplirConteneurNeuf` regarnit — exactement le chemin qu'un coffre
       jamais ouvert emprunte déjà, sans qu'il faille dupliquer cette logique
       ici. */
    function regenererCoffresDonjon() {
      if (!monde.donjons || !monde.coffresPilles) return;
      const dureeJour = parseInt(process.env.MC_DONJON_JOUR_S, 10) || (MC.DayCycle ? MC.DayCycle.DAY_LENGTH : 1200);
      monde.donjons.regenererCoffres(monde.coffresPilles, coffresPilleDepuis, conteneursPoses, EP.heure, dureeJour, fermerConteneurPourAbonnes);
    }

    function joueurReference() {
      for (const c of clients.values()) if (c.rejoint) return { pos: c.pos };
      return { pos: SPAWN };
    }

    /* Sous Windows, un minuteur de 16,7 ms est souvent arrondi à 31 ms : la
       simulation tombait à 30-40 Hz. On sonde donc plus souvent (au rythme réel
       de l horloge système) et l on ne fait un pas que lorsque sa période est
       écoulée — la cadence visée est tenue, sans boucle active qui brûlerait le CPU. */
    const PERIODE_TICK = 1000 / CONF.tickHz;
    const tic = () => {
      const now = performance.now();
      /* SPEC-ARCHI-010/011 : en pause RIEN n'avance (heure, monde, créatures,
         cumulateurs, politique, économie, fourneaux, expirations…) et `dernier`
         est rebasé à chaque passage : à la reprise, le premier dt ne contient pas
         la pause, aucun rattrapage. */
      if (EP.enPause) { EP.dernier = now; return; }
      if (now - EP.dernier < PERIODE_TICK * 0.9) return;
      /* `dt` plafonné : la simulation du MONDE ne fait pas de pas géant après un
         tic long. Le temps RÉEL (`dtReel`), lui, est crédité au budget d'entrées
         des joueurs (SPEC-SYNC-004) : leurs entrées couvrent tout le temps écoulé,
         les leur retirer les mettait en retard pour toujours (recul en marchant). */
      const dtReel = (now - EP.dernier) / 1000;
      const dt = Math.min(dtReel, 0.25);
      EP.dernier = now;
      const __t0 = MESURES_ACTIVES ? performance.now() : 0;
      if (profilTics) profilTics.debutTic();

      EP.heure += dt;
      if (clients.size > 0) EP.dureeJeu += dt;
      /* Eau et circuits : diffusés explicitement plus bas (leurs changements
         seraient sinon perdus), donc désactivés ici. Cultures et feu, eux,
         avancent dans le tic et chaque bloc changé est diffusé (SPEC-SYNC-018/019,
         SPEC-ARCHI-034) : les clients n'en simulent plus rien. */
      monde.tick(dt, 14, null, { temps: EP.heure, circuits: false, eau: false,
        surBloc: noterBlocMonde });
      diffuserBlocsMonde();
      if (profilTics) profilTics.section('monde.tick');

      // SPEC-SERVEUR-005 : purge périodique de admin.sessions/invitations/sanctions
      accPurge += dt;
      if (accPurge >= PURGE_ADMIN_S) {
        accPurge = 0;
        MC.Admin.purger(admin, EP.heure, PURGE_ADMIN_OPTS);
      }

      /* Le serveur simule les créatures autour des joueurs : il lui faut donc le
         terrain autour d'eux. Sans cela, une créature hors des chunks du point
         d'apparition n'avait pas de sol — gelée désormais, elle tombait jadis
         dans le vide — et aucune apparition n'y trouvait de terrain valide. */
      accChunks += dt;
      if (accChunks >= 1) {
        accChunks = 0;
        if (profilTics) profilTics.section('avant entretien');
        // le terrain voulu autour des joueurs : généré par la file, tic après tic (travauxDuTic)
        majChunksVoulus();
        monde.unloadLoin(centresChunks(), RAYON_DECHARGE);
        if (profilTics) profilTics.section('chunks: dechargement');
        peuplerLieux();
        if (profilTics) profilTics.section('peuplerLieux');
        entretienDuMonde();
        // SPEC-SECU-012 : qui s'approche d'une région redéfinie l'apprend avant d'y entrer
        clients.forEach(c => synchroniserZones(c));
        if (profilTics) profilTics.section('entretien du monde');
        avancerEconomie();
        verifierSommeil();
        if (profilTics) profilTics.section('catastrophes+sommeil');
        // B4 : propositions de duel caduques (silencieuses) et duels terminés
        // (SPEC-PVP-005) — les deux participants en sont avertis, s'ils sont
        // encore connectés.
        MC.PvpEnjeux.expirer(pvp, EP.heure).forEach(({ a, b }) => {
          const ja = joueurParNom(a), jb = joueurParNom(b);
          if (ja) envoyer(ja.c, { t: NP.MSG.PVP, evt: 'duel_fin', contre: b });
          if (jb) envoyer(jb.c, { t: NP.MSG.PVP, evt: 'duel_fin', contre: a });
        });
        regenererCoffresDonjon();
        if (profilTics) profilTics.section('pvp+donjons');
      }
      // l'eau coule : le serveur, qui fait foi sur les blocs, diffuse chaque changement
      accEau += dt;
      if (accEau >= 0.25) {
        accEau = 0;
        monde.coulerEau(96).forEach(ch => diffuser({ t: NP.MSG.BLOC, x: ch[0], y: ch[1], z: ch[2], id: ch[3] }));
      }
      // L29 mécanismes (SPEC-MECA-008) : le serveur fait foi, et diffuse chaque
      // changement — un bloc dont seul l'état a changé (une lampe, un compteur…)
      // garde son id, le client applique l'état comme pour tout bloc posé.
      accCircuits += dt;
      if (accCircuits >= 0.2) {
        accCircuits = 0;
        /* SPEC-MECA-005 : ce que seul le serveur sait — les corps présents
           (plaques de pression, détecteurs de présence : joueurs vivants et
           créatures, ni objets au sol ni projectiles) et les boutons encore
           enfoncés (ACTIONNER, relâchés après DUREE_BOUTON_TICS tics). */
        const corps = [];
        tousLesJoueurs().forEach(({ js }) => {
          const st = js.joueur.state;
          if (!st.dead) corps.push({ x: st.pos.x, y: st.pos.y, z: st.pos.z, joueur: true });
        });
        entites.list.forEach(en => {
          if (en.pos && !en.dead && en.type !== 'item' && en.type !== 'arrow') corps.push({ x: en.pos.x, y: en.pos.y, z: en.pos.z });
        });
        const boutons = {};
        const appuyes = S.boutonsAppuyes || (S.boutonsAppuyes = new Map());
        appuyes.forEach((fin, k) => { if (ticsCircuits < fin) boutons[k] = true; else appuyes.delete(k); });
        monde.tickCircuits({
          temps: EP.heure,
          entites: corps,
          boutons,
          /* SPEC-MECA-002 : le générateur thermique loin de la lave brûle le
             combustible rangé dans son conteneur posé (9 cases) : une pièce
             prise quand la précédente est consumée, FUEL_SECONDES_PAR_UNITE
             secondes de jeu par unité de fuelValue (le charbon : 8). Vrai si
             du combustible brûle pendant ce tic. */
          bruler: (x, y, z) => brulerGenerateur(x, y, z, 0.2),
          // SPEC-MECA-001 : éjecte le premier objet du distributeur — munition
          // (ammo) en projectile, sinon un objet au sol ; les entités (item ou
          // arrow) rejoignent tout seules la diffusion d'état périodique (ETAT),
          // pas besoin de message dédié.
          onDistribuer: (x, y, z) => {
            const kd = MC.ContratsV2.cleConteneur(x, y, z);
            const cont = conteneursPoses.get(kd);
            if (!cont) return;
            const i = MC.Circuits.distributeurChoix(cont.slots);
            if (i < 0) return;
            const st = cont.slots[i];
            const idef = C.ITEMS[st.id];
            st.n -= 1;
            if (st.n <= 0) cont.slots[i] = null;
            cont.rev = (cont.rev || 0) + 1;
            if (idef && idef.ammo) {
              entites.tirer({ x: x + 0.5, y: y + 1, z: z + 0.5 }, { x: 0, y: 1, z: 0 },
                             14, idef.damage || 5, null, idef.ammoType || 'fleche');
            } else {
              entites.dropStack(x + 0.5, y + 1, z + 0.5, { id: st.id, n: 1, dmg: st.dmg, data: st.data });
            }
            // SPEC-SYNC-015 : un joueur qui a ce distributeur ouvert voit l'éjection
            const abonnesD = abonnesActuels(kd);
            if (abonnesD.length) {
              const deltaD = { cle: kd, rev: cont.rev, maj: [[i, MC.ContratsV2.pileVersCase(cont.slots[i])]] };
              abonnesD.forEach(({ c: c2, j: j2 }) => envoyer(c2, Object.assign({ t: NP.MSG.CONTENEUR_MAJ }, deltaD)));
            }
          },
          // SPEC-MECA-007 : rejoue la commande stockée avec le même routage que
          // /faction plus haut — messages système, pas de diffusion large.
          onCommande: (x, y, z) => executerBlocCommandeServeur(x, y, z),
        }).forEach(ch => {
          const k = ch.x + ',' + ch.y + ',' + ch.z;
          if (!changesCircuits.has(k)) changesCircuits.set(k, { x: ch.x, y: ch.y, z: ch.z, bloc: false });
          if (ch.setBlock !== undefined) changesCircuits.get(k).bloc = true;
        });
        ticsCircuits++;
        /* Diffusion : l'état final de chaque case touchée, une fois, aux seuls
           clients à portée (comme les autres blocs que le monde décide,
           SPEC-SYNC-018 : noterBlocMonde/diffuserBlocsMonde). Le niveau d'une
           batterie qui se charge ou se décharge change à chaque tic : il n'est
           annoncé que s'il a bougé d'au moins ECART_BATTERIE_ENVOI, ou touche
           0 ou sa capacité, ou au plus une fois par seconde (5 tics). Un client
           qui recharge le chunk retrouve l'état exact par les overrides. */
        changesCircuits.forEach((ch, k) => {
          const id = monde.getBlock(ch.x, ch.y, ch.z), etat = monde.getEtat(ch.x, ch.y, ch.z) || 0;
          if (!ch.bloc && id === C.B.BATTERIE) {
            const env = batteriesEnvoyees.get(k);
            const borne = etat === 0 || etat === MC.Circuits.CAPACITE_BATTERIE;
            if (env && !borne && Math.abs(etat - env.etat) < ECART_BATTERIE_ENVOI && ticsCircuits - env.tic < 5) { env.attente = true; return; }
            batteriesEnvoyees.set(k, { etat, tic: ticsCircuits, attente: false });
          } else if (id !== C.B.BATTERIE) batteriesEnvoyees.delete(k);
          noterBlocMonde(ch.x, ch.y, ch.z, id, etat);
        });
        changesCircuits.clear();
        // un niveau retenu finit toujours par partir (au plus une seconde après), même si la batterie s'arrête
        batteriesEnvoyees.forEach((env, k) => {
          if (!env.attente || ticsCircuits - env.tic < 5) return;
          const p = k.split(',').map(Number);
          if (monde.getBlock(p[0], p[1], p[2]) !== C.B.BATTERIE) { batteriesEnvoyees.delete(k); return; }
          env.etat = monde.getEtat(p[0], p[1], p[2]) || 0; env.tic = ticsCircuits; env.attente = false;
          noterBlocMonde(p[0], p[1], p[2], C.B.BATTERIE, env.etat);
        });
      }

      if (profilTics) profilTics.section('eau+circuits');
      /* B1 (étape 7) : les fourneaux posés cuisent à CHAQUE tic (SPEC-SYNC-016 —
         ils n'attendent pas qu'un joueur regarde), mais un CONTENEUR_MAJ n'est
         émis qu'à un rythme limité (≤ 2 Hz) et SEULEMENT s'il existe un abonné
         (SPEC-SYNC-015) — le delta compare l'instantané envoyé la dernière fois
         à l'état courant, donc reste correct même après une longue absence. */
      conteneursPoses.forEach(cont => { if (cont.four) MC.Conteneurs.tickFour(cont, dt); });
      accFourMsg += dt;
      if (accFourMsg >= 0.5) {
        accFourMsg = 0;
        conteneursPoses.forEach((cont, cle) => {
          if (!cont.four) return;
          const av = derniereEmissionFour.get(cle);
          derniereEmissionFour.set(cle, MC.Conteneurs.instantane(cont));
          if (!av) return;
          const abonnesF = abonnesActuels(cle);
          if (!abonnesF.length) return;
          const maj = MC.Conteneurs.diff(av.slots, cont.slots);
          if (!maj.length && av.four.burn === cont.four.burn && av.four.cook === cont.four.cook) return;
          const deltaF = { cle, rev: cont.rev, maj, four: { burn: cont.four.burn, cook: cont.four.cook } };
          abonnesF.forEach(({ c: c2, j: j2 }) => envoyer(c2, Object.assign({ t: NP.MSG.CONTENEUR_MAJ }, deltaF)));
        });
      }

      if (profilTics) profilTics.section('fourneaux');
      const joueurs = tousLesJoueurs();
      travauxDuTic(joueurs);
      /* Chaque joueur avance selon SES entrées, dans la limite du temps écoulé :
         c'est le serveur qui décide de la position et des statistiques. */
      joueurs.forEach(({ js }) => {
        js.attaqueCd = Math.max(0, js.attaqueCd - dt);
        js.tirCd = Math.max(0, js.tirCd - dt);
        const st = js.joueur.state;
        /* Sans son sol côté serveur (arrivée loin du point d'apparition, terrain encore
           en génération), le joueur ATTEND : ses entrées restent en file, le temps lui
           est crédité (MC.Synchro.patienterEntrees) et il rattrape tout dès que le sol
           existe — jamais de chute dans le vide. Attente bornée : au-delà de
           ATTENTE_SOL_MAX_S, son sol est généré d'un coup. */
        let pas;
        if (!solPret(js)) {
          js.attenteSol = (js.attenteSol || 0) + dtReel;
          if (js.attenteSol > TS.BUDGETS.ATTENTE_SOL_MAX_S) {
            TS.chunksDuSol(st.pos.x, st.pos.z).forEach(c => monde.getChunk(c[0], c[1], true));
            journal('sol d un joueur généré d un coup après ' + js.attenteSol.toFixed(1) + ' s d attente');
          }
        }
        if (solPret(js)) {
          js.attenteSol = 0;
          // SPEC-SYNC-004 : temps réel crédité, entrées invalides écartées (MC.Synchro.avancerEntrees)
          pas = SY.avancerEntrees(js.joueur, js.entrees, js.budget, dtReel, js.dernier, solJoueurOk);
        } else {
          SY.patienterEntrees(js.entrees, js.budget, dtReel, st.dead);
          pas = { dernier: js.dernier, avance: 0 };
        }
        js.dernier = pas.dernier;
        const avance = pas.avance;
        entretenirMonture(js, dt, avance);                    // P-VEH : engin détruit, mort, client muet
        /* SPEC-ARCHI-026 : le corps vit au temps SERVEUR (dt réel, gelé en pause
           avec toute la boucle), jamais au rythme des entrées reçues : un client
           muet a faim et se soigne comme les autres. Un seul appel par tic. */
        js.joueur.updateSurvival(dt);
        tickerSuccesJoueur(js, dt);
        /* SPEC-ARCHI-047 : le serveur ne déplace JAMAIS le corps d'un joueur pour le séparer
           des créatures — le client le prédit (MC.Synchro) sans connaître cette poussée, et
           chaque ETAT recalait un joueur immobile qu'une créature serrait. Ce sont les
           créatures qui cèdent (entites.update → cederAuxJoueurs). */
        /* Le climat agit sur le corps : c'est au serveur, qui fait foi sur la
           vie et la faim, d'appliquer froid et chaleur. Température réévaluée
           deux fois par seconde, comme chez le client. */
        if (monde.meteo && !st.dead) {
          js.tempT = (js.tempT || 0) - dt;
          if (js.tempT <= 0 || !js.temperature) {
            js.tempT = 0.5;
            js.temperature = monde.meteo.temperatureEn(monde, st.pos, EP.heure);
          }
          js.joueur.subirClimat(dt, js.temperature.temperature);
        }
      });

      if (profilTics) profilTics.section('joueurs');
      /* La foudre : mêmes éclairs, aux mêmes instants et aux mêmes lieux que
         chez les clients (la météo est une fonction de la graine et de l'heure) ;
         le serveur seul en tire les dégâts. */
      if (monde.meteo && joueurs.length) {
        if (meteoT === null || EP.heure < meteoT || EP.heure - meteoT > 5) meteoT = EP.heure;
        const l = monde.meteo.eclairs(meteoT, EP.heure);
        meteoT = EP.heure;
        l.forEach(e => {
          joueurs.forEach(({ c, j, js }) => {
            const st = js.joueur.state;
            const lieu = monde.meteo.lieuEclair(e, st.pos.x, st.pos.z);
            if (!st.dead && monde.meteo.foudroie(lieu, st.pos, abriServeur)) {
              js.joueur.hurt(monde.meteo.DEGATS_FOUDRE);
              // SPEC-ARCHI-042 : le cri et l'annonce sont décidés ici ; « Rescapé » seulement si l'on survit
              envoyer(c, { t: NP.MSG.FOUDROYE, j });
              if (!st.dead) signalerSucces(js, { type: 'foudre' });
            }
            entites.list.forEach(en => {
              if (en.kind !== 'item' && en.pos && monde.meteo.foudroie(lieu, en.pos, abriServeur)) entites.damage(en, 8, null, null);
            });
            // SPEC-CONSTR-007 : la foudre allume ce qu'elle touche, si c'est inflammable.
            if (MC.Feu) {
              const ySol = monde.estCharge(lieu.x, lieu.z) ? monde.groundAt(lieu.x, lieu.z) : monde.heightAt(lieu.x, lieu.z);
              MC.Feu.allumerParFoudre(monde.getBlock, lieu.x, ySol, lieu.z).forEach(a => {
                monde.setBlock(a[0], a[1], a[2], a[3]);
                diffuser({ t: NP.MSG.BLOC, x: a[0], y: a[1], z: a[2], id: a[3], etat: 0 });
              });
            }
          });
        });
      }

      appliquerTornades(dt, joueurs);
      // ARCHI-041 : le récit de chaque joueur évalue où il est et ce qu'il porte (temps de jeu : gelé en pause avec toute la boucle)
      if (regles.histoire) joueurs.forEach(({ c, j, js }) => sonderRecit(c, j, js, dt));

      if (profilTics) profilTics.section('meteo+tornades+recit');
      liberSoutesDetruites();
      const etats = joueurs.map(x => x.js.joueur.state);
      const ref = joueurs.length ? { pos: joueurs[0].js.joueur.state.pos } : joueurReference();
      const ev = entites.update(dt, ref, { joueurs: etats.length ? etats : [ref],
        hiver: MC.DayCycle.saison(EP.heure).nom === 'hiver', pvpOk: pvpAutorise, peutBlesser: peutBlesserJoueurs });
      // SPEC-DONJON-018 : la victoire RÉELLE sur un gardien (événement 'boss_vaincu'
      // du journal d'entites.js, jamais un appel direct isolé) marque le donjon
      // vaincu (pré-existant : jamais fait par le serveur avant ce lot, seulement
      // au chargement d'une sauvegarde) ET profite à la faction dont le
      // territoire couvre ce donjon, s'il y en a une.
      const evtsTic = entites.evenements();
      diffuserSons(evtsTic);
      evtsTic.forEach(evt => {
        // ARCHI-041 : le récit du joueur qui a tué la créature (ou vaincu le gardien) l'apprend
        if (regles.histoire && (evt.type === 'mort' || evt.type === 'boss_vaincu')) {
          if (evt.type === 'mort' && evt.auteurJoueur && evt.auteur) {
            const x = joueurParEtat(evt.auteur);
            if (x) signalerRecit(x.c, x.j, x.js, { type: 'tuer', mob: evt.victime });
          }
          if (evt.type === 'boss_vaincu') {
            tousLesJoueurs().forEach(x => {
              if (!x.js.recit) return;
              const st = x.js.joueur.state;
              if (evt.auteur === st || (evt.pos && Math.hypot(evt.pos.x - st.pos.x, evt.pos.z - st.pos.z) <= 96)) {
                signalerRecit(x.c, x.j, x.js, { type: 'boss', donjon: evt.donjon });
              }
            });
          }
        }
        crediterSuccesEvenement(evt);
        if (evt.type !== 'boss_vaincu') return;
        const msgV = chat.systeme(evt.nom + ' est vaincu !');
        if (msgV) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: msgV.texte, type: 'systeme', ts: msgV.t });
        if (!evt.donjon || !monde.donjonsVaincus || monde.donjonsVaincus.has(evt.donjon)) return;
        monde.donjonsVaincus.add(evt.donjon);
        const parts = evt.donjon.split(',');
        const d = monde.donjons && monde.donjons.deRegion ? monde.donjons.deRegion(+parts[0], +parts[1]) : null;
        if (d && MC.Donjons.victoireGardien) {
          const r = MC.Donjons.victoireGardien(d, politique);
          if (r) {
            const f = politique.factions.get(r.faction);
            const msgF = chat.systeme((f ? f.nom : r.faction) + (r.revendique ? ' revendique le territoire de ' : ' tire profit de ') + d.id + '.');
            if (msgF) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: msgF.texte, type: 'systeme', ts: msgF.t });
          }
        }
      });
      // les coups des créatures, appliqués aux joueurs qu'ils visaient — B4
      // (SPEC-PVP-001 à 003) : un coup de FLÈCHE tiré par un JOUEUR (`d.par`) suit
      // le même chemin qu'un coup de mêlée (butin, meurtre, victoire), sans le
      // multiplicateur `regles.degatsMob` (réservé aux créatures — piège B4.md
      // § 13, bogue corrigé au passage : une flèche de joueur en était
      // auparavant multipliée comme un coup de mob).
      ev.degatsPar.forEach(d => {
        const x = joueurs.find(y => y.js.joueur.state === d.joueur);
        if (!x) return;
        const st = x.js.joueur.state;
        const avant = st.dead;
        if (d.par) {
          x.js.joueur.hurt(Math.round(d.n));
          if (!avant && st.dead) {
            const auteur = joueurParEtat(d.par);
            if (auteur) {
              const duel = MC.PvpEnjeux.duelActif(pvp, auteur.c.nom, x.c.nom, EP.heure, d.par.pos, st.pos);
              journal(`⚔ ${auteur.c.nom} a vaincu ${x.c.nom} (PvP, flèche)`);
              const msg = chat.systeme(auteur.c.nom + ' a vaincu ' + x.c.nom);
              if (msg) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: msg.texte, type: 'systeme', ts: msg.t });
              MC.Admin.journaliser(admin, { auteur: auteur.c.nom, action: 'combat_joueur', cible: x.c.nom, details: d.n, heure: EP.heure });
              issuePvp(auteur, x, duel);
            }
          }
        } else {
          x.js.joueur.hurt(Math.round(d.n * (regles.degatsMob || 1)));
        }
      });
      /* B1 (SPEC-SYNC-007) : le ramassage est désormais rangé dans l'inventaire
         SERVEUR (`js.joueur.pickUp`, le même code que le solo) — le client ne
         l'ajoute plus lui-même, il apprend le gain par l'INV_MAJ qui suit. Un
         inventaire déjà plein rend le reliquat au sol ; DONNE ne sert plus qu'au
         retour visuel/sonore (toast, son de ramassage), jamais à l'ajout. */
      ev.picked.forEach(p => {
        const x = joueurs.find(y => y.js.joueur.state === p.joueur);
        if (!x) return;
        const reste = x.js.joueur.pickUp(p.id, p.n, p.data, p.dmg);
        const pris = p.n - reste;
        if (pris > 0) envoyerInvMaj(x.c, x.j, { gain: { id: p.id, n: pris } });
        if (reste > 0) entites.dropStack(p.joueur.pos.x, p.joueur.pos.y + 1, p.joueur.pos.z, { id: p.id, n: reste, data: p.data, dmg: p.dmg });
        envoyer(x.c, { t: NP.MSG.DONNE, j: x.j, id: p.id, n: pris > 0 ? pris : p.n });
      });
      entites.mergeItems();
      if (profilTics) profilTics.section('entites');

      /* SPEC-ARCHI-034 : apparitions autour des joueurs, à tour de rôle (un seul
         joueur par tic d'apparition : la cadence totale ne dépend pas du nombre
         de joueurs ; avec un joueur c'est exactement l'ancien rythme). */
      accSpawn += dt;
      if (accSpawn >= 3.5) {
        accSpawn = 0;
        if (clients.size > 0) {
          /* Au plus SPAWN_JOUEURS_PAR_TIC joueurs par tic, à tour de rôle : jusqu'à
             8 joueurs chacun garde le rythme d'un solo (une tentative par 3,5 s) ;
             au-delà, le coût par tic reste borné et la cadence par joueur baisse
             (100 joueurs : une tentative chacun toutes les ~44 s, 8 par tic). */
          const cibles = joueurs.length ? [] : [ref];
          for (let k = 0; k < Math.min(SPAWN_JOUEURS_PAR_TIC, joueurs.length); k++) cibles.push(joueurs[(rotationSpawn++) % joueurs.length].js.joueur.state);
          cibles.forEach(cible => {
            entites.trySpawn(cible, MC.DayCycle.isNight(EP.heure), null, MC.Modes.plafondsEntites(regles));
            entites.trySpawnSouterrain(cible, null, MC.Modes.plafondsEntites(regles));
          });
          if (!MC.DayCycle.isNight(EP.heure)) entites.burnUndead(false);
        }
      }
      accDonjons += dt;
      if (accDonjons >= 0.25) { accDonjons = 0; surveillerDonjonsServeur(); }
      if (profilTics) profilTics.section('apparitions+donjons');

      /* Diffusion d'état à cadence réduite : simuler à 20 Hz et n'envoyer qu'à
         10 Hz divise le trafic par deux sans que l'on voie la différence, les
         clients interpolant entre deux relevés. */
      /* On garde le reliquat plutôt que de remettre à zéro : avec une horloge
         qui bat à ~15,6 ms (Windows), une image sur deux tombait juste sous la
         période et sautait son envoi — 30 états par seconde au lieu de 60. La
         petite tolérance absorbe la gigue du minuteur. */
      accEtat += dt;
      // SPEC-SERVEUR-007 : la cadence de diffusion s'adapte à la charge (nombre
      // de clients connectés, file d'envoi TCP la plus encombrée) plutôt que de
      // rester fixe — calcul PUR, testé sous Node (src/net-protocol.js). Recalculé
      // à chaque tic : toujours cohérent avec la charge actuelle.
      let fileEnvoiMax = 0;
      clients.forEach(c => { const f = (c.socket && c.socket.writableLength) || 0; if (f > fileEnvoiMax) fileEnvoiMax = f; });
      const etatHzEffectif = NP.calculerEtatHz(CONF.etatHz, { nbClients: clients.size, fileMax: fileEnvoiMax });
      const periodeEtat = 1 / etatHzEffectif;
      if (accEtat >= periodeEtat * 0.9) {
        accEtat = Math.min(periodeEtat, Math.max(0, accEtat - periodeEtat));
        if (clients.size > 0) {
          const js = tousLesJoueurs().map(({ c, j, js: x }) => {
            const st = x.joueur.state;
            const o = { id: c.id, j, nom: c.nom, x: +st.pos.x.toFixed(2), y: +st.pos.y.toFixed(2),
                        z: +st.pos.z.toFixed(2), yaw: +st.yaw.toFixed(2), mort: st.dead ? 1 : 0 };
            // SPEC-OBJET-001 : l'armure visible, seulement si le joueur en porte
            const eq = NP.armureVisible(st.equip);
            if (eq) o.eq = eq;
            return o;
          });
          // créatures, objets au sol et projectiles : tout ce qui vit dans le monde
          const decrire = e => {
            const o = { e: e.eid, t: e.type, x: +e.pos.x.toFixed(2), y: +e.pos.y.toFixed(2),
                        z: +e.pos.z.toFixed(2), yaw: +(e.yaw || 0).toFixed(2) };
            if (e.type === 'item') o.i = e.item;
            if (e.genre) o.g = e.genre;
            if (e.arme) o.a = e.arme;
            if (e.variante !== undefined) o.v = e.variante;
            if (e.role) { o.r = e.role; o.n = e.nom; }
            /* Véhicule (SPEC-SYNC-022) : nom, vitesse, occupé, carburant, avarie — ce qu'il faut
               pour l'animer et, si le client en prend le volant, le prédire. */
            if (e.vehicule) {
              o.ve = e.vehicule; o.vi = +(e.vitesse || 0).toFixed(2);
              if (e.conducteur) o.co = 1;
              if (e.carburant != null) o.ca = +e.carburant.toFixed(1);
              if (e.avarie) o.av = e.avarieGravite || 1;
            }
            return o;
          };
          /* Une description par entité et par relevé, pas par client : à 100 joueurs elle
             serait recalculée cent fois pour la même créature (regroupement, SPEC-SYNC-022). */
          const decrites = new Map();
          const decrireUne = e => { let o = decrites.get(e); if (!o) { o = decrire(e); decrites.set(e, o); } return o; };
          // SPEC-ARCHI-046 : au millième — arrondie au dixième, l'heure restait figée puis sautait de 0,1 s
          const commun = { t: NP.MSG.ETAT, joueurs: [], mobs: [], heure: +EP.heure.toFixed(3) };
          const vivants = [], objetsAuSol = [], vehicules = [];
          entites.list.forEach(e => { (e.type === 'item' ? objetsAuSol : e.vehicule ? vehicules : vivants).push(e); });
          clients.forEach(c => {
            if (!c.rejoint || !c.joueurs) return;
            /* À chacun les créatures les plus proches de SES joueurs, plafonnées à
               NP.MAX_MOBS_DIFFUSES (invariant documenté et testé, SPEC-SERVEUR-007) :
               avec les habitants des villes, les premières de la liste pouvaient
               être à l'autre bout du monde. */
            const pos = c.joueurs.map(x => x.joueur.state.pos);
            const d2 = e => Math.min.apply(null, pos.map(p => (e.pos.x - p.x) ** 2 + (e.pos.z - p.z) ** 2));
            /* SPEC-SYNC-026 : les objets au sol ont leur propre plafond — jamais évincés par les créatures */
            commun.mobs = NP.selectionnerMobsProches(vivants, pos, NP.PORTEE_MOBS_DIFFUSES, NP.MAX_MOBS_DIFFUSES).map(decrireUne)
              .concat(NP.selectionnerMobsProches(objetsAuSol, pos, NP.PORTEE_MOBS_DIFFUSES, NP.MAX_ITEMS_DIFFUSES).map(decrireUne))
              // les véhicules ont leur propre plafond (SPEC-SYNC-022) : ni évincés par les créatures, ni sans borne
              .concat(((sel) => { c.vehiculesVus = new Set(sel.map(e => e.eid)); return sel.map(decrireUne); })(
                NP.selectionnerAvecHysteresis(vehicules, pos, NP.PORTEE_MOBS_DIFFUSES, NP.MAX_VEHICULES_DIFFUSES, c.vehiculesVus)));
            /* Les AUTRES joueurs, bornés à la même portée que les créatures : sans
               ce filtre, chaque diffusion d'état grandissait en O(joueurs²) — une
               liste complète envoyée à CHAQUE client. Invisible jusqu'à quelques
               dizaines de joueurs, ça sature le réseau bien avant que la
               simulation elle-même ne peine (identifié au banc de charge,
               SPEC-SERVEUR-002 — chiffres avant/après dans docs/charge.md). */
            commun.joueurs = js.filter(j => d2({ pos: { x: j.x, z: j.z } }) < NP.PORTEE_MOBS_DIFFUSES * NP.PORTEE_MOBS_DIFFUSES);
            commun.toi = c.joueurs.map(x => SY.etatJoueur(x.joueur, x.dernier));
            envoyer(c, commun);
          });
        }
      }
      if (MESURES_ACTIVES) enregistrerTic(performance.now() - __t0);
      if (profilTics) { profilTics.section('etat'); profilTics.finTic(dtReel * 1000); }
    };
    S.tic = tic;
  }

  MC.ServeurTic = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
