/* serveur-monde.js — instantané et reprise du monde
   `etatMonde` / `appliquerEtatMonde` (SPEC-SERVEUR-001) : ce qui est
   sauvegardé du monde partagé, et sa relecture.

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
    const {
      SY, CONF, admin, regles, monde, entites, politique, guildes, economie, pvp,
      joueursRegistre, banques, conteneursPoses, derniereEmissionFour, banqueDe, journal,
    } = S;
    const EP = S.EP;   // état partagé modifiable, à forme fixe (créé par server.js)
    Object.assign(S, {
      etatMonde, enregistrementJoueur, appliquerEtatPersonnage,
      appliquerEtatMonde,
    });

    // ── persistance du monde (SPEC-SERVEUR-001) ─────────────────────────────────
    /* `--monde fichier.json` fait vivre le monde sans joueur local : sauvegarde
       régulière ET à l'arrêt (SIGINT/SIGTERM), reprise au lancement suivant. Le
       format est délibérément indépendant de MC.Save (pensé pour UN joueur local) :
       ici il n'y a ni joueur ni inventaire à sauver, seulement le monde partagé
       et l'état d'administration (rôles, listes, invitations, journal). */
    /* `sansBlocs` : les deux grandes listes (blocs modifiés, états) sont remplacées par
       une marque (MC.TravauxServeur.MARQUE + nom), à leur place dans l'ordre des clés :
       la sauvegarde périodique les sérialise ensuite par tranches (sauvegarderMondeAsync). */
    function etatMonde(sansBlocs) {
      let overrides = [], etats = [];
      if (sansBlocs) {
        overrides = MC.TravauxServeur.MARQUE + 'overrides';
        etats = MC.TravauxServeur.MARQUE + 'etats';
      } else {
        monde.overrides.forEach((id, k) => { const p = k.split(','); overrides.push([+p[0], +p[1], +p[2], id]); });
        // États de bloc (SPEC-SAVE-017) : à part des overrides — poser un état ne
        // pose pas forcément un bloc, le coupler aux overrides en perdrait au chargement.
        if (monde.etatsOverrides) {
          monde.etatsOverrides.forEach((etat, k) => { const p = k.split(','); etats.push([+p[0], +p[1], +p[2], etat]); });
        }
      }
      const crops = [];
      monde.crops.forEach(c => crops.push([c.x, c.y, c.z, +c.t.toFixed(2)]));
      return {
        // v2 (SPEC-SAVE-017) : ajoute la liste `etats` ; les blocs eux-mêmes ne
        // bougent pas (aucun objet d'inventaire ici, voir le commentaire plus
        // haut), donc un fichier v1 (sans `etats`) se relit sans conversion d'id.
        v: 2, graine: CONF.graine, heure: EP.heure,
        overrides, etats, crops,
        donjons: monde.donjonsVaincus ? Array.from(monde.donjonsVaincus) : [],
        pilles: monde.coffresPilles ? Array.from(monde.coffresPilles) : [],
        pnjsMorts: monde.pnjsMorts ? Array.from(monde.pnjsMorts.entries()) : [],
        admin: MC.Admin.serialiser(admin),
        zones: monde.zonesEtat ? MC.Zones.serialiser(monde.zonesEtat) : null,
        politique: MC.Politique.serialiser(politique),
        guildes: MC.Guildes.serialiser(guildes),
        economie: MC.Economie.serialiser(economie),
        // B1 (docs/vague-2/B1.md § 7-8) : le registre des joueurs nommés
        // (inventaire, équipement, banque — `MC.Conteneurs.versEnregistrement`
        // inclut déjà la banque) ; un joueur ENCORE connecté à l'instant de la
        // sauvegarde est capturé à jour, pas seulement celui déjà écrit au
        // dernier `fermer()`.
        joueurs: Array.from(snapshotRegistreJoueurs().entries()),
        // B1 (étape 7, SPEC-SYNC-021 partiel — la partie inventaire) : les
        // conteneurs POSÉS (coffres, fourneaux, armoires, étagères,
        // bibliothèques, distributeurs) — un joueur qui en a un ouvert à
        // l'instant de la sauvegarde est capturé à jour (même objet vivant).
        // `normaliserTailleConteneur` : défense en profondeur (revue adversariale)
        // — un conteneur mal formé (jamais censé arriver depuis le correctif
        // d'`indiceValide`, conteneurs.js) n'est plus filtré silencieusement par
        // `validerConteneurPersiste` (qui exige `slots.length === taille`) : il
        // est tronqué à sa vraie taille AVANT sérialisation, l'excédent lâché au
        // sol quand la position est connue — jamais perdu sans trace.
        conteneurs: Array.from(conteneursPoses.entries())
          .map(([cle, cont]) => {
            S.normaliserTailleConteneur(cle, cont);
            return MC.ContratsV2.validerConteneurPersiste({
              cle, type: cont.type, slots: cont.slots.map(MC.ContratsV2.pileVersCase), four: cont.four,
            });
          })
          .filter(Boolean),
        // B4 (docs/vague-2/B4.md § 6) : meurtres récents, victoires et réputations
        // politiques — en dernier, comme prévu par le plan. Duels et propositions
        // sont éphémères, jamais persistés (MC.PvpEnjeux.serialiser les omet déjà).
        pvp: MC.PvpEnjeux.serialiser(pvp),
        // SPEC-QUETE-004 : le tableau de quêtes actives par joueur, persistant à
        // la sauvegarde/reconnexion (nom -> [{ id, statut, … }]).
        quetes: MC.Politique.serialiserQuetes(EP.quetesJoueurs),
        // SPEC-ARCHI-014 : blocs de commande (texte de chaque bloc), et ce que le
        // fichier d'une partie solo importée porte sans que le serveur l'exploite
        // encore (cartes explorées, histoire, succès, véhicules…) : restitué tel
        // quel à chaque sauvegarde, jamais perdu en route.
        commandes: Array.from(monde.commandesBloc.entries()).map(([k, texte]) => {
          const p = k.split(',');
          return [+p[0], +p[1], +p[2], texte];
        }),
        // SPEC-SERVEUR-006 : les véhicules (position, cap, soute, carburant, avarie),
        // au format de MC.Vehicules.serialiser — le même qu'écrivait la sauvegarde solo
        vehicules: MC.Vehicules.serialiser(entites),
        // SPEC-ARCHI-041 : l'état du récit de chaque joueur (parité ARCHI-014 : l'ancien `histoire` solo y est adopté)
        histoire: regles.histoire ? { v: 1, liens: histoireMonde.liens, recits: Array.from(S.snapshotRecits().entries()) } : null,
        soloJoueur: EP.soloJoueur, extras: EP.extrasSolo,
      };
    }
    EP.soloJoueur = null;          // enregistrement du joueur d'une partie solo importée, adopté à la première connexion
    EP.extrasSolo = null;          // champs d'une partie solo importée que le serveur conserve sans encore les jouer (ARCHI-014)
    const VEHICULES_JOUEUR_MAX = 12;            // véhicules posés, libres, par joueur (en plus du plafond global)
    S.VEHICULES_JOUEUR_MAX = VEHICULES_JOUEUR_MAX;
    const VEHICULES_MAX = 256;               // véhicules posés dans le monde (borne contre la pose en rafale, en créatif surtout)
    S.VEHICULES_MAX = VEHICULES_MAX;
    const vehiculesSoute = new Set();        // véhicules à soute vivants (pour libérer leur soute à leur destruction)
    S.vehiculesSoute = vehiculesSoute;
    /* SPEC-ARCHI-041 : le récit. `histoireMonde.liens` : lieux d'épopée liés au monde (leur recherche
       coûte quelques secondes : faite UNE fois, au démarrage, puis persistée) ; `recitsRegistre` :
       récit de chaque joueur nommé (clé de registre) ; `soloRecit` : récit d'une partie solo importée,
       adopté avec son joueur. */
    const histoireMonde = { liens: null };
    S.histoireMonde = histoireMonde;
    const recitsRegistre = new Map();
    S.recitsRegistre = recitsRegistre;
    EP.soloRecit = null;
    /* Enregistrement d'un joueur nommé + son état de personnage (SPEC-SYNC-020,
       nécessaire à la parité de sauvegarde SPEC-ARCHI-014) : position, regard,
       vie, faim, air, case sélectionnée, vol. */
    function enregistrementJoueur(js) {
      const rec = MC.Conteneurs.versEnregistrement(js.joueur.state, banqueDe(js.cleReg));
      const st = js.joueur.state;
      rec.succes = js.succes.serialiser();           // SPEC-ARCHI-042 : les succès suivent le joueur nommé
      rec.etat = {
        x: +st.pos.x.toFixed(2), y: +st.pos.y.toFixed(2), z: +st.pos.z.toFixed(2),
        yaw: +st.yaw.toFixed(3), pitch: +st.pitch.toFixed(3),
        hp: st.hp, hunger: st.hunger, air: +st.air.toFixed(1),
        selected: st.selected, flying: !!st.flying,
        spawn: js.spawn || null,
      };
      return rec;
    }
    /* Réapplique l'état de personnage d'un enregistrement. Un joueur mort à la
       sauvegarde revient en vie au point d'apparition, jamais au cadavre. */
    function appliquerEtatPersonnage(js, etat) {
      if (!etat || typeof etat !== 'object') return;
      const st = js.joueur.state;
      const fini = (v) => typeof v === 'number' && isFinite(v);
      if (fini(etat.hp) && etat.hp > 0) {
        if (fini(etat.x) && fini(etat.y) && fini(etat.z) && Math.abs(etat.x) < 1e7 && Math.abs(etat.z) < 1e7 && etat.y >= -64 && etat.y < 400) {
          st.pos.x = etat.x; st.pos.y = etat.y; st.pos.z = etat.z;
          /* Son terrain n'est PAS généré ici (25 chunks d'un coup : jusqu'à une seconde
             de boucle bloquée avant même BIENVENUE) : la file de chunks du tic le génère
             par tranches, le sol sous ses pieds d'abord, et ses entrées attendent ce sol
             (voir solPret dans la boucle). */
        }
        if (fini(etat.yaw)) st.yaw = etat.yaw;
        if (fini(etat.pitch)) st.pitch = Math.max(-1.6, Math.min(1.6, etat.pitch));
        st.hp = Math.min(20, etat.hp);
        if (fini(etat.hunger)) st.hunger = Math.max(0, Math.min(20, etat.hunger));
        if (fini(etat.air)) st.air = Math.max(0, Math.min(10, etat.air));
        if (Number.isInteger(etat.selected) && etat.selected >= 0 && etat.selected < 9) st.selected = etat.selected;
        st.flying = !!etat.flying && !!regles.vole;
      }
      js.spawn = SY.spawnValide(etat.spawn);         // fini et dans les bornes, sinon le point d'apparition du monde
    }
    /* Fusionne le registre (déjà à jour pour les joueurs déconnectés) avec
       l'état courant de chaque joueur local ENCORE connecté et nommé — sans
       muter `joueursRegistre` lui-même (une vraie déconnexion, plus tard,
       écrira la version définitive via `fermer`). */
    function snapshotRegistreJoueurs() {
      const out = new Map(joueursRegistre);
      S.clients.forEach(c => {
        if (!c.joueurs) return;
        c.joueurs.forEach(js => {
          if (!js.cleReg) return;
          out.set(js.cleReg, enregistrementJoueur(js));
        });
      });
      return out;
    }
    function appliquerEtatMonde(data) {
      if (!data || (data.v !== 1 && data.v !== 2)) return false;   // format inconnu : refusé proprement
      if (data.graine !== undefined && data.graine !== CONF.graine) {
        // une graine différente : la carte ne correspondrait plus aux overrides
        journal(`avertissement : la graine du fichier (${data.graine}) diffère de celle lancée (${CONF.graine}) — reprise quand même`);
      }
      EP.heure = data.heure || 60;
      monde.overrides.clear();
      (data.overrides || []).forEach(o => monde.overrides.set(o[0] + ',' + o[1] + ',' + o[2], o[3]));
      if (monde.etatsOverrides) {
        monde.etatsOverrides.clear();
        (data.etats || []).forEach(o => { if (o[3]) monde.etatsOverrides.set(o[0] + ',' + o[1] + ',' + o[2], o[3]); });
      }
      monde.crops.clear();
      (data.crops || []).forEach(c => monde.crops.set(c[0] + ',' + c[1] + ',' + c[2], { x: c[0], y: c[1], z: c[2], t: c[3] }));
      if (monde.donjonsVaincus) { monde.donjonsVaincus.clear(); (data.donjons || []).forEach(id => monde.donjonsVaincus.add(id)); }
      if (monde.coffresPilles) { monde.coffresPilles.clear(); (data.pilles || []).forEach(k => monde.coffresPilles.add(k)); }
      if (monde.pnjsMorts) {
        monde.pnjsMorts.clear();
        (data.pnjsMorts || []).forEach(m => { if (m && typeof m[0] === 'string') monde.pnjsMorts.set(m[0], +m[1] || 0); });
      }
      if (data.admin) MC.Admin.appliquer(admin, data.admin);
      if (data.zones && monde.zonesEtat) MC.Zones.appliquer(monde.zonesEtat, data.zones);
      if (data.politique) {
        const pol = MC.Politique.charger(data.politique);
        politique.seed = pol.seed; politique.jour = pol.jour;
        politique.factions = pol.factions; politique.relations = pol.relations; politique.annonces = pol.annonces;
      }
      if (data.guildes) {
        const gu = MC.Guildes.charger(data.guildes);
        guildes.factions = gu.factions; guildes.joueurs = gu.joueurs;
        guildes.invitations = gu.invitations; guildes.prochainId = gu.prochainId;
      }
      // SPEC-QUETE-004 : reprise du tableau de quêtes actives par joueur.
      EP.quetesJoueurs = MC.Politique.chargerQuetes(data.quetes);
      if (data.economie) {
        const eco = MC.Economie.charger(data.economie);
        economie.jour = eco.jour; economie.lieux = eco.lieux;
        economie.joueurs = eco.joueurs; economie.departs = eco.departs;
      }
      // B4 : absent d'un fichier plus ancien (avant B4) → simplement vide, comme
      // aujourd'hui. Duels et propositions ne sont jamais dans `data.pvp`
      // (jamais sérialisés) : ils restent donc ceux, vides, de `pvp` au démarrage.
      if (data.pvp) {
        const pv = MC.PvpEnjeux.charger(data.pvp);
        pvp.meurtres = pv.meurtres; pvp.victoires = pv.victoires; pvp.reputations = pv.reputations;
      }
      // B1 (docs/vague-2/B1.md § 7-8) : registre des joueurs nommés — absent
      // d'un fichier plus ancien (v1/v2, ou v2 d'avant cette section), donc
      // simplement vide, comme aujourd'hui. La banque d'un joueur repris n'est
      // PAS reconnectée : `versEnregistrement`/`banqueDe` recréent un conteneur
      // vivant tout de suite (B1.md § 5), sans attendre que le joueur revienne.
      joueursRegistre.clear();
      banques.clear();
      (data.joueurs || []).forEach(entree => {
        if (!Array.isArray(entree) || typeof entree[0] !== 'string' || !MC.ContratsV2) return;
        const v = MC.ContratsV2.validerEnregistrementJoueur(entree[1]);
        if (!v) return;
        joueursRegistre.set(entree[0], v);
        banqueDe(entree[0]).slots = v.banque.map(MC.ContratsV2.caseVersPile);
      });
      // SPEC-ARCHI-014 : blocs de commande, joueur solo importé, extras conservés
      monde.commandesBloc.clear();
      (data.commandes || []).forEach(c => {
        if (Array.isArray(c) && c[3]) monde.setCommande(c[0], c[1], c[2], String(c[3]).slice(0, 200));
      });
      EP.soloJoueur = data.soloJoueur && MC.ContratsV2 ? MC.ContratsV2.validerEnregistrementJoueur(data.soloJoueur) : null;
      EP.extrasSolo = data.extras && typeof data.extras === 'object' ? data.extras : null;
      /* SPEC-SERVEUR-006 : les véhicules reviennent dans le monde. Une partie solo
         importée les porte dans `extras.vehicules` (même format) : ils sont repris
         UNE fois puis retirés des extras, sinon la sauvegarde suivante les
         écrirait deux fois. Les véhicules déjà présents (re-chargement) sont retirés. */
      entites.list.filter(e => e.vehicule).forEach(e => entites.remove(e));
      vehiculesSoute.clear();
      let brutsVeh = Array.isArray(data.vehicules) ? data.vehicules : [];
      if (!brutsVeh.length && EP.extrasSolo && Array.isArray(EP.extrasSolo.vehicules)) brutsVeh = EP.extrasSolo.vehicules;
      if (EP.extrasSolo && 'vehicules' in EP.extrasSolo) { EP.extrasSolo = Object.assign({}, EP.extrasSolo); delete EP.extrasSolo.vehicules; }
      MC.Vehicules.restaurer(entites, brutsVeh.slice(0, VEHICULES_MAX).filter(v => Array.isArray(v) && MC.Vehicules.DEFS[v[0]]
        && [v[1], v[2], v[3]].every(Number.isFinite) && Math.abs(v[1]) < 1e7 && Math.abs(v[3]) < 1e7 && v[2] > -64 && v[2] < 400));
      entites.list.forEach(e => { if (e.vehicule && e.soute) vehiculesSoute.add(e); });
      histoireMonde.liens = data.histoire && data.histoire.liens && typeof data.histoire.liens === 'object' ? data.histoire.liens : null;
      recitsRegistre.clear();
      if (data.histoire && Array.isArray(data.histoire.recits)) {
        data.histoire.recits.forEach(e => { if (Array.isArray(e) && typeof e[0] === 'string' && e[1] && typeof e[1] === 'object') recitsRegistre.set(e[0], e[1]); });
      }
      EP.soloRecit = regles.histoire && EP.extrasSolo && EP.extrasSolo.histoire && typeof EP.extrasSolo.histoire === 'object' ? EP.extrasSolo.histoire : null;
      // B1 (étape 7, SPEC-SYNC-021 partiel) : conteneurs POSÉS — absents d'un
      // fichier plus ancien, donc simplement vides, comme aujourd'hui.
      conteneursPoses.clear();
      derniereEmissionFour.clear();
      (data.conteneurs || []).forEach(o => {
        const v = MC.ContratsV2.validerConteneurPersiste(o);
        if (!v) return;
        const cont = MC.Conteneurs.creerConteneur(v.type);
        if (!cont) return;
        cont.slots = v.slots.map(MC.ContratsV2.caseVersPile);
        if (v.four) cont.four = v.four;
        conteneursPoses.set(v.cle, cont);
      });
      return true;
    }
  }

  MC.ServeurMonde = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
