/* serveur-messages.js — le routage des messages des clients
   `traiter(c, m)` : un message validé d'un client → son effet sur le monde
   qui fait foi, et les réponses.

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
    const { process, setTimeout } = S.hote;
    const {
      NP, SY, C, logClient, PARAMS, CONF, CA, admin, PARAMS_HISTOIRE, regles, monde, entites,
      indexOverrides, chat, politique, guildes, economie, pvp, joueursRegistre,
      conteneursPoses, derniereEmissionFour, banqueDe, appliquerEtatPersonnage,
      diffuserPolitiqueSiChangee, envoyerPolitiqueComplete, offresPour, SPAWN, clients,
      definirPause, marquerPoste, diffuser, guildeResume, envoyer, fermer, journal,
      filtreRemontees, antiFloodOk, messageReseau, definirReseau, arreter,
    } = S;
    const EP = S.EP;   // état partagé modifiable, à forme fixe (créé par server.js)
    Object.assign(S, { fixerReapparitionLit, traiter });

    // SPEC-SERVEUR-009 : overrides de blocs — un voisinage borné à la connexion
    // (BIENVENUE), puis chunk par chunk sur demande du client (OVERRIDES_DEMANDE,
    // voir traiter() plus bas). `rayon` en CHUNKS (0 = un seul chunk, pour une
    // demande ponctuelle) ; borner par un rayon plutôt que tout renvoyer est ce
    // qui garde BIENVENUE de taille bornée quel que soit le nombre d'overrides.
    const RAYON_BIENVENUE_CHUNKS = 2;
    function overridesEnVue(cx0, cz0, rayon) {
      const blocs = [];
      for (let cx = cx0 - rayon; cx <= cx0 + rayon; cx++) for (let cz = cz0 - rayon; cz <= cz0 + rayon; cz++) {
        const e = indexOverrides.get(cx + ',' + cz);
        if (!e) continue;
        e.forEach((k) => {
          const p = k.split(',');
          const etat = monde.etatsOverrides ? (monde.etatsOverrides.get(k) || 0) : 0;
          blocs.push([+p[0], +p[1], +p[2], monde.overrides.get(k), etat]);
        });
      }
      return blocs;
    }

    // ── traitement des messages ──────────────────────────────────────────────────
    /* Bascules de test réservées aux suites d'intégration (désactivées par
       défaut, jamais en exploitation normale) : elles provoquent volontairement
       une exception dans `traiter()` pour vérifier SPEC-SECU-001, exactement
       comme MC_SAUVEGARDE_MS ou MC_MESURES réduisent un intervalle pour les
       tests plutôt que d'exposer un chemin de code séparé et non testé. */
    const MC_TEST_PANNE = process.env.MC_TEST_PANNE === '1';

    /* SPEC-ARCHI-010 : en pause, tout message qui modifie l'état de jeu est ignoré —
       mouvement, blocs, combat, tir, inventaire (manger, fabriquer, équiper, consommer,
       lâcher, palette créative), conteneurs, commerce, distributeurs. RENAITRE est
       l'EXCEPTION (SPEC-ARCHI-026) : un joueur mort doit pouvoir renaître même dans
       un monde figé (menu ouvert sur l'écran de mort) — la renaissance ne fait
       avancer aucune horloge. Restent acceptés : ping, CHAT, PAUSE, RESEAU, ARRET,
       ADMIN, CONTENEUR_FERMER (simple libération). */
    const MESSAGES_GELES = new Set([
      'ENTREE', 'BLOC', 'ATTAQUE', 'TIR', 'MANGER', 'DISTRIB', 'CRAFT', 'EQUIP',
      'INV_CONSOMMER', 'INV_LACHER', 'INV_CREATIF', 'TROC', 'CONTENEUR_OUVRIR', 'CONTENEUR_TRANSFERT',
      'DORMIR', 'VEHICULE_POSER', 'VEHICULE_MONTER', 'VEHICULE_DESCENDRE', 'VEHICULE_REPARER',
      'DORMIR', 'HISTOIRE_PARLER', 'HISTOIRE_REPONSE',
      'ACTIONNER',
    ].map(k => NP.MSG[k]).filter(Boolean));

    /* SPEC-ARCHI-026 : le lieu de renaissance est décidé ICI. Le lit dont le joueur
       a fait son point de réapparition (`js.spawn`, persistant) tant qu'il existe
       encore, sinon le point d'apparition du monde. */
    function lieuRenaissance(js, j) {
      const sp = js.spawn;
      if (sp && [sp.x, sp.y, sp.z].every(Number.isFinite) && Math.abs(sp.x) < 1e7 && Math.abs(sp.z) < 1e7 && sp.y > -64 && sp.y < 400) {
        monde.getChunk(Math.floor(sp.x / 16), Math.floor(sp.z / 16), true);
        // le lit est sous les pieds (y = lit + 1,05) ou occupé (y = lit + 0,05, anciennes parties solo)
        const bx = Math.floor(sp.x), bz = Math.floor(sp.z);
        const dessous = C.BLOCKS[monde.getBlock(bx, Math.floor(sp.y - 1.0), bz)], dedans = C.BLOCKS[monde.getBlock(bx, Math.floor(sp.y - 0.05), bz)];
        if ((dessous && dessous.dodo) || (dedans && dedans.dodo)) return { x: sp.x, y: sp.y, z: sp.z };
        js.spawn = null;                                   // le lit a disparu
      }
      return { x: SPAWN.x + j * 1.2, y: SPAWN.y, z: SPAWN.z };
    }
    /* Un joueur qui se couche fixe sa réapparition sur le lit à portée (jamais une
       position dictée par le client). Renvoie true si un lit a été trouvé. */
    function fixerReapparitionLit(js) {
      const st = js.joueur.state, px = Math.floor(st.pos.x), py = Math.floor(st.pos.y), pz = Math.floor(st.pos.z);
      let meilleur = null, md = 5 * 5;
      for (let dx = -4; dx <= 4; dx++) for (let dy = -2; dy <= 3; dy++) for (let dz = -4; dz <= 4; dz++) {
        const bd = C.BLOCKS[monde.getBlock(px + dx, py + dy, pz + dz)];
        if (!bd || !bd.dodo) continue;
        const d2 = (px + dx + 0.5 - st.pos.x) ** 2 + (py + dy + 0.5 - st.pos.y) ** 2 + (pz + dz + 0.5 - st.pos.z) ** 2;
        if (d2 < md) { md = d2; meilleur = { x: px + dx + 0.5, y: py + dy + 1.05, z: pz + dz + 0.5 }; }
      }
      if (!meilleur) return false;
      js.spawn = meilleur;
      return true;
    }
    /* SPEC-ARCHI-027 : l'arme d'un coup de mêlée, d'après l'inventaire SERVEUR.
       Le client désigne la case tenue (`i`) ; le serveur ne croit que ce que cette
       case contient réellement (main nue si elle est vide). Sans `i` (ancien
       client), la meilleure arme possédée. Le plafond est donc « ce que le joueur
       possède et tient », jamais un chiffre annoncé. */
    function armeMelee(js, i) {
      const slots = js.joueur.state.inv.slots;
      if (Number.isInteger(i) && i >= 0 && i < slots.length) return (slots[i] && C.def(slots[i].id)) || {};
      let best = {};
      slots.forEach(s => { const df = s && C.def(s.id); if (df && (df.damage || 1) > (best.damage || 1)) best = df; });
      return best;
    }
    /* Cadence, portée et recul du coup, lus dans la définition de l'arme comme le
       fait player.attack (dague 0,22 s, masse 0,95 s…). Le serveur retient 85 %
       de la cadence (gigue réseau) avec un plancher de 0,15 s. */
    function parametresMelee(arme) {
      const cadence = arme.cadence !== undefined ? arme.cadence : 0.45;
      return { degats: arme.damage || 1, cd: Math.max(0.15, cadence * 0.85), recul: arme.recul !== undefined ? arme.recul : 1,
               portee: Math.max(6, (arme.portee || 0) + 0.5) };
    }
    /* L'arme de tir du genre demandé : la case `i` si elle porte une telle arme,
       sinon la meilleure arme de ce genre possédée ; null si aucune (créatif,
       réglages de test). Dégâts et vitesse ne dépassent jamais ceux de l'arme
       (et de la meilleure munition possédée), comme player.tirer. */
    function parametresTir(js, genre, i) {
      const slots = js.joueur.state.inv.slots;
      const bonne = (s) => { const df = s && C.def(s.id); return df && df.ranged === genre ? df : null; };
      let arme = Number.isInteger(i) && i >= 0 && i < slots.length ? bonne(slots[i]) : null;
      if (!arme) slots.forEach(s => { const df = bonne(s); if (df && (!arme || (df.bonusTir || 0) > (arme.bonusTir || 0))) arme = df; });
      if (!arme) return null;
      let degats;
      if (arme.sansMunition) degats = arme.degatsTir || 6;
      else {
        let mun = 5;
        slots.forEach(s => { const df = s && C.def(s.id); if (df && df.ammo && (!df.ammoType || df.ammoType === genre) && (df.damage || 5) > mun) mun = df.damage; });
        degats = mun + (arme.bonusTir || 0);
      }
      return { degats, vitesse: arme.vitesseTir || 34, cd: Math.max(0.3, arme.cadenceTir || 0) };
    }

    function traiter(c, m) {
      if (!m) return;                                   // message invalide : ignoré
      if (c.formatRefuse) return;                       // SPEC-SAVE-025 : refusé pour son format d'ids, plus rien ne s'applique
      // SPEC-ARCHI-010 : en pause, ces messages n'ont aucun effet (ping, PAUSE, RESEAU, ARRET, CHAT continuent)
      if (EP.enPause && MESSAGES_GELES.has(m.t)) return;
      if (MC_TEST_PANNE && m.t === NP.MSG.CHAT && m.texte === '__panne_test_secu_001__') {
        throw new Error('panne de test SPEC-SECU-001');
      }
      if (m.t !== NP.MSG.ENTREE && !antiFloodOk(c, m)) {          // SPEC-SECU-005/006
        // un BLOC ignoré doit resynchroniser le client : sans ça, sa casse/pose
        // locale déjà appliquée (prédiction) resterait un bloc fantôme jamais
        // corrigé — même mécanisme que le refus de portée, qui rappelle `avant`.
        if (m.t === NP.MSG.BLOC) {
          const avantConnu = monde.getBlock(m.x, m.y, m.z);
          envoyer(c, { t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: avantConnu, etat: monde.getEtat(m.x, m.y, m.z) });   // état compris (SPEC-SAVE-024)
        }
        return;
      }
      switch (m.t) {
        case NP.MSG.REJOINDRE: {
          /* SPEC-SAVE-025 : un client d'un autre format d'identifiants (ou qui n'en
             annonce aucun : antérieur à cette règle) parle un autre espace d'ids —
             refusé, motif lisible avec les deux formats, et plus aucun de ses
             messages n'est appliqué. Une autre VERSION du jeu au même format passe. */
          if (m.formatIds !== C.FIRST_ITEM) {
            const formatClient = m.formatIds !== null ? m.formatIds : (m.formatIdsAnnonce ? 'invalide' : 'aucun (version antérieure)');
            const motif = `format d'identifiants incompatible : client ${formatClient}, serveur ${C.FIRST_ITEM}` +
              ` — client v${m.version || '?'}, serveur v${C.VERSION_JEU}`;
            c.formatRefuse = true;
            envoyer(c, { t: NP.MSG.REFUS, motif, formatIds: C.FIRST_ITEM, version: C.VERSION_JEU });
            journal(`x ${m.nom} (${c.ip}) refusé — ${motif}`);
            setTimeout(() => fermer(c, 'format d\'identifiants incompatible'), 50);
            break;
          }
          // liste noire, liste blanche, bannissement, e-mail exigé (SPEC-ADMIN-004)
          const decision = MC.Admin.peutEntrer(admin, { nom: m.nom, email: m.email, invitation: m.invitation }, EP.heure);
          if (!decision.ok) {
            envoyer(c, { t: NP.MSG.REFUS, motif: decision.motif });
            journal(`x ${m.nom} (${c.ip}) refusé — ${decision.motif}`);
            setTimeout(() => fermer(c, 'entree refusee : ' + decision.motif), 50);
            break;
          }
          // SPEC-ARCHI-007 : en mode FERMÉ, un seul poste à la fois
          if (!EP.reseauOuvert && [...clients.values()].some(x => x.rejoint && x.id !== c.id)) {
            envoyer(c, { t: NP.MSG.REFUS, motif: CA.MOTIFS_REFUS.POSTE_DEJA_CONNECTE });
            journal(`x ${m.nom} (${c.ip}) refusé — un poste est déjà connecté (réseau fermé)`);
            setTimeout(() => fermer(c, 'poste deja connecte'), 50);
            break;
          }
          // SPEC-SERVEUR-010 : `maxJoueurs` borne le nombre de JOUEURS présents
          // (écran partagé compris), pas le nombre de connexions — une connexion
          // à 4 joueurs locaux en occupe 4, jamais 1. Toute l'équipe est admise
          // ou refusée d'un bloc : jamais une place partielle (un connecté sans
          // ses coéquipiers serait plus déroutant qu'un refus net).
          if (S.placesOccupees() + m.locaux > CONF.maxJoueurs) {
            envoyer(c, { t: NP.MSG.REFUS, motif: 'serveur_complet' });
            journal(`x ${m.nom} (${c.ip}) refusé — serveur complet (${CONF.maxJoueurs})`);
            setTimeout(() => fermer(c, 'serveur complet'), 50);
            break;
          }
          c.nom = m.nom;
          c.email = m.email || null;
          c.locaux = m.locaux;
          c.rejoint = true;
          marquerPoste(c);                                  // annule le délai de grâce d'arrêt, lève une pause d'absence
          c.role = MC.Admin.roleDe(admin, c.nom);           // un modérateur nommé retrouve son rôle en revenant
          c.sessionId = MC.Admin.ouvrirSession(admin, { nom: c.nom, ip: c.ip }, EP.heure);
          c.joueurs = [];
          for (let j = 0; j < c.locaux; j++) {
            const js = S.creerJoueurServeur(j);
            js.cid = c.id; js.j = j;                         // pour retrouver sa connexion (succès, SPEC-ARCHI-042)
            // B1 (registre des joueurs nommés) : une clé tenue par un joueur DÉJÀ
            // connecté (même nom, écran partagé compris) reste éphémère — jamais
            // restaurée, jamais écrasée dans le registre à la fermeture.
            const cleReg = MC.ContratsV2 ? MC.ContratsV2.cleRegistre(c.nom, j) : null;
            js.cleReg = (cleReg && !S.cleRegDejaConnectee(cleReg)) ? cleReg : null;
            if (js.cleReg) {
              let rec = joueursRegistre.get(js.cleReg);
              // ARCHI-015 : le joueur d'une partie solo importée est adopté par le
              // premier joueur local qui rejoint (son nom n'était pas connu à l'import)
              if (!rec && j === 0 && EP.soloJoueur) {
                rec = EP.soloJoueur; EP.soloJoueur = null;
                if (EP.soloRecit) js.recitSolo = EP.soloRecit;   // ARCHI-041 : son récit l'accompagne (retiré des extras seulement une fois rattaché, voir preparerRecit)
                // SPEC-ARCHI-042 : les succès de la partie solo importée passent au joueur qui l'adopte
                // (l'enregistrement importé peut porter un `succes` VIDE : il ne doit pas
                // masquer ceux, réels, conservés dans extras.succes)
                const vide = (x) => !x || (!(x.debloques && x.debloques.length) && !Object.keys(x.compte || {}).length);
                if (vide(rec.succes) && EP.extrasSolo && EP.extrasSolo.succes && !vide(EP.extrasSolo.succes)) {
                  rec.succes = EP.extrasSolo.succes; EP.extrasSolo.succes = null;
                }
              }
              if (rec) {
                MC.Conteneurs.depuisEnregistrement(js.joueur.state, banqueDe(js.cleReg), rec);
                appliquerEtatPersonnage(js, rec.etat);              // SPEC-SYNC-020 : position, vie, faim, air…
                if (rec.succes) js.succes.charger(rec.succes);      // SPEC-ARCHI-042
              }
              else if (S.MC_TEST_INV) S.MC_TEST_INV.forEach(p => js.joueur.state.inv.add(p[0], p[1]));
            }
            c.joueurs.push(js);
          }
          c.joueurs.forEach((js, j) => S.preparerRecit(js, j));     // avant BIENVENUE : le héros peut être déplacé sur sa place de village
          c.pos = c.joueurs[0].joueur.state.pos;
          S.majChunksVoulus();                                // son terrain entre aussitôt dans la file de génération
          // SPEC-SERVEUR-009 : seul un voisinage borné des overrides accompagne
          // BIENVENUE — plus loin, le client les demande chunk par chunk au fur
          // et à mesure qu'il charge son terrain (case OVERRIDES_DEMANDE
          // plus bas), donc BIENVENUE reste de taille bornée quel que soit le
          // nombre total de blocs modifiés dans le monde.
          const cx0 = Math.floor(c.pos.x / 16), cz0 = Math.floor(c.pos.z / 16);
          const blocs = overridesEnVue(cx0, cz0, RAYON_BIENVENUE_CHUNKS);
          envoyer(c, {
            t: NP.MSG.BIENVENUE,
            id: c.id, graine: CONF.graine, mode: CONF.mode, difficulte: CONF.difficulte,
            version: C.VERSION_JEU, formatIds: C.FIRST_ITEM,                     // SPEC-SAVE-025
            histoire: PARAMS_HISTOIRE ? { interactions: PARAMS_HISTOIRE.interactions || null, commerce: PARAMS_HISTOIRE.commerce } : null,
            zone: monde.zonesEtat ? monde.zonesEtat.politique : 'generee',
            heure: EP.heure, blocs,
            // la position qui fait foi, pour chaque joueur local du poste ; à la
            // connexion s'y ajoutent le regard et le point de réapparition laissés
            // (SPEC-SYNC-020 : un joueur qui revient retrouve l'état exact laissé)
            toi: c.joueurs.map(js => Object.assign(SY.etatJoueur(js.joueur, 0), {
              yaw: js.joueur.state.yaw, pitch: js.joueur.state.pitch, spawn: js.spawn || null,
            })),
            tickHz: CONF.tickHz, etatHz: CONF.etatHz,
            // ARCHI : état du poste — pause (SPEC-ARCHI-011), réseau (SPEC-ARCHI-005), partie chargée
            pause: EP.enPause, pauseRev: EP.pauseRev, reseau: EP.reseauOuvert ? CA.ETAT_RESEAU.OUVERT : CA.ETAT_RESEAU.FERME,
            partie: EP.partieActive ? { id: EP.partieActive.id, nom: EP.partieActive.nom } : null,
            // SPEC-ARCHI-029 / SYNC-025 : l'appartenance de faction qui fait foi est celle du serveur
            guilde: guildeResume(c.nom),
            joueurs: [...clients.values()].filter(x => x.id !== c.id && x.rejoint)
              .map(x => ({ id: x.id, nom: x.nom, x: x.pos.x, y: x.pos.y, z: x.pos.z, yaw: x.yaw })),
            chat: chat.recents(20).map(x => ({ auteur: x.auteur, texte: x.texte, type: x.type, ts: x.t })),
          });
          // SPEC-SYNC-024 : aussitôt après, l'état complet des relations de faction
          // (PNJ et joueurs) — jamais déduit de l'historique du chat
          envoyerPolitiqueComplete(c);
          // SPEC-SECU-012 : les régions redéfinies autour de ses joueurs (BIENVENUE n'en porte aucune)
          S.synchroniserZones(c);
          // B1 (SPEC-SYNC-008) : le nouveau venu apprend son inventaire (restauré,
          // seedé par MC_TEST_INV, ou vide) avant tout autre message d'inventaire.
          c.joueurs.forEach((js, j) => S.envoyerInvMaj(c, j, {}));
          c.joueurs.forEach((js, j) => S.demarrerRecit(c, js, j));   // ARCHI-041 : l'état du récit et ses premières répliques
          // SPEC-ARCHI-042 : l'état des succès de chaque joueur local (compteurs du panneau), sans annonce
          c.joueurs.forEach(js => S.envoyerSuccesEtat(js));
          // SPEC-SYNC-011 : l'équipement déjà visible des joueurs présents (et
          // réciproquement, le sien à eux) — un emplacement vide n'est pas annoncé.
          S.tousLesJoueurs().forEach(({ c: autreC, j: autreJ, js: autreJs }) => {
            if (autreC.id === c.id) return;
            MC.ContratsV2.EQUIP_SLOTS.forEach(slot => {
              const pile = autreJs.joueur.state.equip[slot];
              if (pile) envoyer(c, { t: NP.MSG.EQUIP_VU, id: autreC.id, j: autreJ, slot, objet: pile.id });
            });
          });
          c.joueurs.forEach((js, j) => {
            MC.ContratsV2.EQUIP_SLOTS.forEach(slot => {
              const pile = js.joueur.state.equip[slot];
              if (pile) diffuser({ t: NP.MSG.EQUIP_VU, id: c.id, j, slot, objet: pile.id }, c.id);
            });
          });
          diffuser({ t: NP.MSG.ARRIVE, id: c.id, nom: c.nom, locaux: c.locaux }, c.id);
          const sm = chat.systeme(c.nom + ' a rejoint la partie' +
                                  (c.locaux > 1 ? ' (' + c.locaux + ' joueurs locaux)' : ''));
          if (sm) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: sm.texte, type: 'systeme', ts: sm.t });
          journal(`+ ${c.nom} (#${c.id}) rejoint · ${clients.size} en ligne`);
          break;
        }
        // ── ARCHI : pause du poste, réseau à chaud, arrêt (SPEC-ARCHI-005/008/009) ──
        case NP.MSG.PAUSE:
          if (c.local) marquerPoste(c);
          if (EP.reseauOuvert) { envoyer(c, { t: NP.MSG.PAUSE_ETAT, actif: false, rev: EP.pauseRev }); break; }   // aucune pause en mode ouvert
          if (!c.local) break;
          definirPause(m.actif, false);
          break;
        case NP.MSG.RESEAU:
          if (c.local) marquerPoste(c);
          if (!c.local) { journal(`x RESEAU ignoré : ${c.nom} (#${c.id}, ${c.ip}) n'est pas en boucle locale`); break; }
          // un serveur dédié (--serveur) reste OUVERT : le fermer expulserait ses joueurs puis l'arrêterait tout seul
          if (!m.ouvert && PARAMS.serveurSeul) { journal(`x RESEAU {ouvert:false} ignoré : serveur dédié (--serveur)`); envoyer(c, messageReseau()); break; }
          definirReseau(m.ouvert);
          break;
        case NP.MSG.ARRET:
          if (c.local) marquerPoste(c);
          if (!c.local) { journal(`x ARRET ignoré : ${c.nom} (#${c.id}, ${c.ip}) n'est pas en boucle locale`); break; }
          arreter('ARRET');
          break;
        /* SPEC-ARCHI-025 : le SERVEUR tient l'ensemble des dormeurs sur TOUS les
           joueurs présents (locaux et distants) ; la nuit passe quand une
           majorité stricte dort. Un solo est le cas « tous les joueurs = 1 ». */
        case NP.MSG.DORMIR: {
          const js = c.joueurs && c.joueurs[m.j];
          if (!js || !c.rejoint) break;
          if (!m.actif) { S.dormeurs.delete(js); break; }
          if (!MC.DayCycle.isNight(EP.heure)) { S.messageSystemeA(c, 'On ne dort que la nuit.'); break; }
          S.coucher(js);
          if (!S.verifierSommeil()) {
            const { dorment, total } = S.compterDormeurs();
            S.messageSystemeA(c, `Réapparition fixée ici — en attente que la majorité dorme (${dorment}/${total}).`);
          }
          break;
        }

        /* SPEC-MECA-005 : un levier ou un bouton actionné à la main. Le serveur
           revérifie tout — joueur vivant, case à portée (comme une pose),
           bloc qui s'actionne — et décide lui-même du nouvel état
           (MC.Circuits.actionner) : le message ne porte que la case. Un bouton
           enfoncé le reste DUREE_BOUTON_S secondes de jeu (serveur-tic le relâche). */
        case NP.MSG.ACTIONNER: {
          const js = c.joueurs && c.joueurs[m.j];
          const st0 = js && js.joueur.state;
          if (!st0 || st0.dead || !c.rejoint) break;
          if (Math.hypot(m.x + 0.5 - st0.pos.x, m.y + 0.5 - st0.pos.y - 1.62, m.z + 0.5 - st0.pos.z) > S.PORTEE_BLOC) break;
          const idA = monde.getBlock(m.x, m.y, m.z);
          const etatA = MC.Circuits.actionner(idA, monde.getEtat(m.x, m.y, m.z));
          if (etatA === null) break;
          monde.setEtat(m.x, m.y, m.z, etatA);
          if (C.BLOCKS[idA].circuit.type === 'bouton') {
            const boutons = S.boutonsAppuyes || (S.boutonsAppuyes = new Map());
            boutons.set(m.x + ',' + m.y + ',' + m.z, EP.heure + S.DUREE_BOUTON_S);
          }
          diffuser({ t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: idA, etat: etatA });
          MC.Admin.journaliser(admin, { auteur: c.nom, action: 'bloc_actionne', cible: `${m.x},${m.y},${m.z}`, details: etatA, heure: EP.heure });
          break;
        }

        // ── véhicules (P-VEH, SPEC-ARCHI-021 / SPEC-SYNC-022) : le serveur crée, embarque, conduit ──
        case NP.MSG.VEHICULE_POSER: S.poserVehiculeServeur(c, m); break;
        case NP.MSG.VEHICULE_MONTER: S.monterVehiculeServeur(c, m); break;
        case NP.MSG.VEHICULE_REPARER: S.reparerVehiculeServeur(c, m); break;
        case NP.MSG.VEHICULE_DESCENDRE: {
          const js = c.joueurs && c.joueurs[m.j];
          if (!js || !js.joueur.state.monture) { S.evtVehicule(c, m.j, 'refus', { motif: CA.MOTIFS_VEHICULE.INCONNU }); break; }
          S.descendreVehiculeServeur(c, m.j, js);
          break;
        }

        case NP.MSG.BOUGE:
          /* Ancien message : le client imposait sa position. Le serveur fait
             désormais autorité — on n'en retient que le regard. */
          c.yaw = m.yaw; c.pitch = m.pitch;
          break;

        // SPEC-SERVEUR-009 : le client demande les overrides d'UN chunk qu'il
        // vient de décider de charger (voir game.js streamChunks) — réponse
        // bornée à ce seul chunk, jamais le monde entier.
        case NP.MSG.OVERRIDES_DEMANDE:
          envoyer(c, { t: NP.MSG.OVERRIDES_CHUNK, cx: m.cx, cz: m.cz, blocs: overridesEnVue(m.cx, m.cz, 0) });
          break;

        case NP.MSG.ENTREE: {
          const js = c.joueurs && c.joueurs[m.j];
          // un mort ne rejoue rien : ses entrées ne sont pas gardées pour après la renaissance
          if (!js || js.joueur.state.dead) break;
          // un client qui inonde le serveur perd ses entrées les plus anciennes (au-delà de SY.MAX_EN_ATTENTE)
          SY.empilerEntree(js.entrees, m);
          break;
        }

        case NP.MSG.ATTAQUE: {
          const js = c.joueurs && c.joueurs[m.j];
          if (!js || js.joueur.state.dead) break;
          const st = js.joueur.state;
          // SPEC-ARCHI-027 : dégâts, cadence, portée et recul viennent de l'arme
          // réellement tenue dans l'inventaire serveur, pas de ce que le client annonce.
          const pm = parametresMelee(armeMelee(js, m.i));
          m.degats = Math.min(m.degats, pm.degats);

          // SPEC-COMBAT-002 : cible un autre JOUEUR plutôt qu'une créature —
          // mêmes portée, cadence et dégâts qu'en PvE, mais soumis au réglage
          // PvP du serveur ET aux règles de zone des deux joueurs.
          if (m.joueurCible) {
            if (js.attaqueCd > 0) break;
            const cible = S.joueurParCle(m.joueurCible);
            if (!cible || cible.js.joueur.state.dead) break;
            if (cible.c.id === c.id && cible.j === m.j) break;               // pas sur soi-même
            const vst = cible.js.joueur.state;
            const d2 = Math.hypot(vst.pos.x - st.pos.x, vst.pos.y + 0.9 - st.pos.y - 1.6, vst.pos.z - st.pos.z);
            if (d2 > pm.portee) break;
            // B4 (SPEC-PVP-002/005) : un duel consenti autorise le coup MÊME hors
            // zone PvP et MÊME entre membres d'une même faction (le consentement
            // explicite prime) ; sinon, comme avant, zone ET faction.
            const duel = MC.PvpEnjeux.duelActif(pvp, c.nom, cible.c.nom, EP.heure, st.pos, vst.pos);
            if (!duel && !(S.pvpAutorise(st.pos, vst.pos) && MC.Guildes.peutBlesser(guildes, c.nom, cible.c.nom))) break;
            js.attaqueCd = pm.cd;
            const avant = vst.dead;
            vst.hurtCd = 0;
            cible.js.joueur.hurt(m.degats);
            // recul, comme pour une créature (entities.damage s'en inspire)
            const dx = vst.pos.x - st.pos.x, dz = vst.pos.z - st.pos.z, dd = Math.hypot(dx, dz) || 1;
            vst.vel.x += (dx / dd) * 5 * pm.recul; vst.vel.z += (dz / dd) * 5 * pm.recul; vst.vel.y = 4.5 * pm.recul;
            MC.Admin.journaliser(admin, { auteur: c.nom, action: 'combat_joueur', cible: cible.c.nom, details: m.degats, heure: EP.heure });
            if (!avant && vst.dead) {
              const msg = chat.systeme(c.nom + ' a vaincu ' + cible.c.nom);
              if (msg) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: msg.texte, type: 'systeme', ts: msg.t });
              journal(`⚔ ${c.nom} a vaincu ${cible.c.nom} (PvP)`);
              // B4 (SPEC-PVP-001/003/004) : butin, meurtre, réputation, victoire —
              // jamais de butin ni de meurtre compté pendant un duel consenti.
              S.issuePvp({ c, j: m.j, js }, cible, duel);
            }
            break;
          }

          const e = entites.list.find(x => x.eid === m.eid);
          if (!e || e.dead || e.type === 'item' || e === st.monture) break;     // jamais l'engin qu'on conduit
          const d = Math.hypot(e.pos.x - st.pos.x, e.pos.y + e.h / 2 - st.pos.y - 1.6, e.pos.z - st.pos.z);
          // portée et cadence vérifiées : on ne frappe ni de loin ni en rafale
          if (d > pm.portee || js.attaqueCd > 0) break;
          js.attaqueCd = pm.cd;
          entites.damage(e, m.degats, st.pos, st, pm.recul);
          // journal des actions (SPEC-ADMIN-002) : les combats aussi
          MC.Admin.journaliser(admin, { auteur: c.nom, action: 'combat', cible: e.type, details: m.degats, heure: EP.heure });
          break;
        }

        case NP.MSG.TIR: {
          const js = c.joueurs && c.joueurs[m.j];
          if (!js || js.joueur.state.dead || js.tirCd > 0) break;
          // SPEC-SYNC-028 : en survie, pas de munition (ou d'arme) dans l'inventaire serveur, pas de projectile
          if (!regles.blocsIllimites && !S.POSE_LIBRE && !S.debiterTir(js, m.genre)) break;
          // SPEC-ARCHI-027 : dégâts, vitesse et cadence de l'arme possédée, jamais ceux annoncés
          const pt = parametresTir(js, m.genre, m.i);
          js.tirCd = pt ? pt.cd : 0.3;
          const st = js.joueur.state;
          const o = { x: st.pos.x + m.dx * 0.4, y: st.pos.y + 1.62 + m.dy * 0.4, z: st.pos.z + m.dz * 0.4 };
          entites.tirer(o, { x: m.dx, y: m.dy, z: m.dz }, pt ? Math.min(m.vitesse, pt.vitesse) : m.vitesse,
                        pt ? Math.min(m.degats, pt.degats) : m.degats, st, m.genre);
          break;
        }

        case NP.MSG.MANGER: {
          // B1 (SPEC-SYNC-009) : validé contre l'inventaire serveur — le client
          // ne peut plus se nourrir d'un objet qu'il ne possède pas réellement.
          const js = c.joueurs && c.joueurs[m.j];
          if (!js) break;
          const r = MC.Conteneurs.appliquer(S.ctxJoueur(js), { k: 'manger', id: m.id, i: m.i });
          if (r.ok) {
            const st = js.joueur.state;
            if (r.effets.food) st.hunger = Math.min(20, st.hunger + r.effets.food);
            if (r.effets.soin) js.joueur.heal(r.effets.soin);
            if (r.effets.cru) { st.malade = (st.malade || 0) + 20; st.malaiseT = 0; }
            if (r.effets.lache) S.lacherAuxPieds(js, r.effets.lache);
            S.signalerSucces(js, { type: 'manger', id: m.id });
            if (m.seq !== undefined && S.seqNouveau(js, m.seq)) S.envoyerInvMaj(c, m.j, {});
          } else if (m.seq !== undefined && S.seqNouveau(js, m.seq)) {
            S.refuserOp(c, m.j, m.seq, r.motif);
          }
          break;
        }

        case NP.MSG.RENAITRE: {
          const js = c.joueurs && c.joueurs[m.j];
          if (!js || !js.joueur.state.dead) break;
          js.joueur.respawn(lieuRenaissance(js, m.j));
          js.entrees.length = 0;
          js.budget = SY.creerBudget();                  // la renaissance repart de la réserve normale, rien d'accumulé
          js.attaqueCd = 0; js.tirCd = 0;
          break;
        }

        case NP.MSG.BLOC: {
          /* Le serveur fait autorité : il applique, PUIS diffuse à tous — y
             compris à l'émetteur, dont la prédiction locale est ainsi confirmée
             ou corrigée.

             SPEC-SECU-007 : la portée est vérifiée AVANT toute génération de
             chunk — `monde.getBlock` ne force jamais la génération (il renvoie 0
             si le chunk n'est pas chargé), donc `blocAutorise` peut s'exécuter
             sans jamais appeler `monde.getChunk(…, true)`. Un client hors de
             portée ne peut ainsi jamais forcer le serveur à générer du terrain
             arbitrairement loin — seul un BLOC autorisé, donc proche d'un joueur
             déjà présent, déclenche `getChunk(cx, cz, true)` plus bas. */
          const js = c.joueurs && c.joueurs[m.j];
          /* Chunk pas encore généré côté serveur (terrain en file) : getBlock y rend 0 et
             la casse ou la pose s'appuierait sur un faux « air ». Tout près du joueur (à
             portée de bloc, donc SPEC-SECU-007 respectée), il est généré d'abord ; plus
             loin, le contrôle de portée ci-dessous refuse comme avant. */
          if (!monde.chunkDe(Math.floor(m.x / 16), Math.floor(m.z / 16))) {
            const st0 = js && js.joueur.state;
            if (st0 && Number.isFinite(m.x) && Number.isFinite(m.z) &&
                Math.hypot(m.x + 0.5 - st0.pos.x, m.z + 0.5 - st0.pos.z) <= S.PORTEE_BLOC + 1) {
              monde.getChunk(Math.floor(m.x / 16), Math.floor(m.z / 16), true);
            }
          }
          const avant = monde.getBlock(m.x, m.y, m.z);
          /* Bascule d'une porte ou d'une trappe (ouvrir/fermer) : un changement d'état
             d'un bloc DÉJÀ posé, sans objet ; on n'accepte que la vraie bascule
             (C.bascule) d'un bloc à portée, jamais un autre remplacement. */
          if (m.id !== 0 && avant !== m.id && C.bascule(avant) === m.id) {
            const st0 = js && js.joueur.state;
            const proche = st0 && !st0.dead &&
              Math.hypot(m.x + 0.5 - st0.pos.x, m.y + 0.5 - st0.pos.y - 1.62, m.z + 0.5 - st0.pos.z) <= S.PORTEE_BLOC;
            if (!proche) { envoyer(c, { t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: avant, etat: monde.getEtat(m.x, m.y, m.z) }); break; }
            const etatBascule = monde.getEtat(m.x, m.y, m.z);
            monde.setBlock(m.x, m.y, m.z, m.id);
            diffuser({ t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: m.id, etat: etatBascule });
            MC.Admin.journaliser(admin, { auteur: c.nom, action: 'bloc_bascule', cible: `${m.x},${m.y},${m.z}`, details: m.id, heure: EP.heure });
            break;
          }
          /* L'état d'une porte ou d'une trappe ne sert qu'au serveur (bit 0 : dernier
             signal vu par les circuits, SPEC-MECA-006) : il n'est JAMAIS repris du
             client — une porte posée part de 0, ses deux moitiés comprises, et le
             tic suivant l'ouvre si un signal la touche déjà. */
          if (m.id && (C.estPorte(m.id) || C.estTrappe(m.id))) m.etat = 0;
          // SPEC-SAVE-023 : au-delà de C.etatMaxDe du bloc posé (SPEC-SAVE-021 ; 0 pour un bloc sans état), l'état reçu retombe à 0
          if (m.etat > C.etatMaxDe(m.id)) m.etat = 0;
          if (!S.blocAutorise(js, m, avant, c)) {
            // refusé : on rappelle au client ce qui s'y trouve vraiment
            envoyer(c, { t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: avant, etat: monde.getEtat(m.x, m.y, m.z) });
            break;
          }
          /* SPEC-SYNC-028 : en survie, poser exige l'objet dans l'inventaire SERVEUR
             (retiré ici). Refus : le bloc autoritaire est rappelé et l'inventaire
             renvoyé, la prédiction du client ayant supposé un objet qu'il n'a pas. */
          if (m.id !== 0 && S.cellulesCompagnes(m).some(cc => !C.isReplaceable(monde.getBlock(cc.x, cc.y, cc.z)))) {
            envoyer(c, { t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: avant, etat: monde.getEtat(m.x, m.y, m.z) });   // la case voisine est prise : rien ne se pose
            break;
          }
          // un conteneur généré jamais ouvert (coffre de donjon, bibliothèque) : son contenu se tire AVANT que la case ne change
          let contNeuf = null;
          if (m.id === 0 && avant) {
            const dA = C.BLOCKS[avant];
            const tA = dA && dA.interactive && MC.ContratsV2.TYPES_CONTENEUR[dA.interactive];
            const kA = MC.ContratsV2.cleConteneur(m.x, m.y, m.z);
            if (tA && !tA.parJoueur && !conteneursPoses.has(kA)) {
              contNeuf = MC.Conteneurs.creerConteneur(dA.interactive);
              if (contNeuf) S.remplirConteneurNeuf(contNeuf, dA.interactive, m.x, m.y, m.z, kA);
            }
          }
          let pileDebitee = null;
          if (m.id !== 0 && !regles.blocsIllimites && !S.POSE_LIBRE) {
            pileDebitee = S.debiterPose(js, m.id, m.i);
            if (!pileDebitee) {
              envoyer(c, { t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: avant, etat: monde.getEtat(m.x, m.y, m.z) });
              S.envoyerInvMaj(c, m.j, {});
              break;
            }
          }
          /* SPEC-MECA-008 : l'état d'un mécanisme posé est décidé ICI — seule
             l'orientation choisie passe (piston, tapis) ; une batterie reprend le
             niveau de la pile débitée sur l'inventaire du SERVEUR (SPEC-MECA-003),
             celui annoncé seulement quand rien n'est débité (créatif, pose libre). */
          const etatMeca = m.id ? MC.Circuits.etatDePose(m.id, m.etat,
            pileDebitee ? (pileDebitee.data && pileDebitee.data.niveau) : m.etat) : null;
          if (etatMeca !== null) m.etat = etatMeca;
          // SPEC-MECA-003 : le niveau d'une batterie cassée, lu avant que la case ne change
          const etatAvantCasse = (m.id === 0 && avant === C.B.BATTERIE) ? monde.getEtat(m.x, m.y, m.z) : 0;
          const cx = Math.floor(m.x / 16), cz = Math.floor(m.z / 16);
          monde.getChunk(cx, cz, true);
          monde.setBlock(m.x, m.y, m.z, m.id);
          // état du bloc posé (orientation, niveau… — SPEC-SAVE-017) : 0 par
          // défaut, comme un bloc cassé ou sans état particulier
          if (monde.setEtat) monde.setEtat(m.x, m.y, m.z, m.etat || 0);
          // une casse lâche son butin côté serveur : c'est lui qui le distribue
          if (m.id === 0 && avant) {
            const cassure = C.breakTime(avant, m.outil);
            // SPEC-OBJET-003 : bijou d'émeraude — chance au butin
            const bijou = js && js.joueur.state.equip && js.joueur.state.equip.bijou;
            const bd = bijou && C.def(bijou.id);
            const bonusChance = (bd && bd.effet && bd.effet.type === 'chance') ? bd.effet.valeur : 0;
            C.dropsOf(avant, cassure.harvests, null, bonusChance).forEach(d =>
              entites.dropItem(m.x + 0.5, m.y + 0.5, m.z + 0.5, d.id, d.n, undefined,
                               d.id === C.B.BATTERIE ? { niveau: etatAvantCasse } : undefined));
          }
          diffuser({ t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: m.id, etat: m.etat || 0 });
          if (m.id !== 0) S.signalerRecit(c, m.j, js, { type: 'poser', bloc: m.id, x: m.x, y: m.y, z: m.z });   // ARCHI-041
          // la case compagne d'une porte ou d'un lit se pose avec elle ; à la casse, l'autre moitié part aussi
          S.cellulesCompagnes(m).forEach(cc => {
            monde.getChunk(Math.floor(cc.x / 16), Math.floor(cc.z / 16), true);
            monde.setBlock(cc.x, cc.y, cc.z, cc.id);
            if (monde.setEtat) monde.setEtat(cc.x, cc.y, cc.z, cc.etat);
            diffuser({ t: NP.MSG.BLOC, x: cc.x, y: cc.y, z: cc.z, id: cc.id, etat: cc.etat });
          });
          if (m.id === 0 && avant) S.compagnesDeCasse(avant, m).forEach(cc => {
            monde.setBlock(cc.x, cc.y, cc.z, 0);
            diffuser({ t: NP.MSG.BLOC, x: cc.x, y: cc.y, z: cc.z, id: 0, etat: 0 });
          });
          /* Escalier (SPEC-CONSTR-001) : le serveur fait autorité sur l'angle,
             recalculé ici (même algorithme que le client) plutôt que confié au
             message reçu — pose ou casse peut aussi changer l'angle des 4
             voisins, diffusé séparément à ceux dont l'état a bougé. */
          const bAffecte = (m.id && C.BLOCKS[m.id] && C.BLOCKS[m.id].forme === 'escalier')
            || (C.BLOCKS[avant] && C.BLOCKS[avant].forme === 'escalier');
          if (bAffecte && MC.Formes) {
            const voisins = [[0, 0, 0], [0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
            const avantE = voisins.map(v => monde.getEtat(m.x + v[0], m.y + v[1], m.z + v[2]));
            MC.Formes.actualiserZoneEscalier(monde, m.x, m.y, m.z);
            voisins.forEach((v, i) => {
              const x2 = m.x + v[0], y2 = m.y + v[1], z2 = m.z + v[2];
              const e2 = monde.getEtat(x2, y2, z2);
              if (e2 !== avantE[i]) diffuser({ t: NP.MSG.BLOC, x: x2, y: y2, z: z2, id: monde.getBlock(x2, y2, z2), etat: e2 });
            });
          }
          // journal des actions (SPEC-ADMIN-002) : de quoi rejouer qui a construit ou détruit quoi
          MC.Admin.journaliser(admin, { auteur: c.nom, action: m.id ? 'bloc_pose' : 'bloc_casse',
                                         cible: `${m.x},${m.y},${m.z}`, details: m.id, heure: EP.heure });
          // SPEC-ARCHI-042 : le succès se décide ici, sur une casse que le serveur a acceptée
          if (m.id === 0 && avant) S.signalerSucces(js, { type: 'casser', bloc: avant });
          /* B1 (étape 7) : un conteneur posé cassé lâche son contenu au sol —
             UNE SEULE FOIS ici (le serveur fait autorité sur la casse), même si
             deux joueurs l'avaient ouvert en même temps. `fermerConteneurPourAbonnes`
             (revue adversariale, item 3) désabonne CHAQUE joueur qui l'avait
             ouvert AVANT de retirer l'entrée : sans ça, `js.conteneurOuvert`
             resterait pointé sur cette clé, et si un AUTRE bloc conteneur (un
             fourneau, par exemple) est reposé au même endroit, ce joueur se
             retrouverait abonné au nouveau conteneur sans jamais avoir rouvert —
             un coffre (27 cases) qu'il croit toujours voir alors que 3 cases
             existent réellement dessous. */
          if (m.id === 0 && avant) {
            const defAvant = C.BLOCKS[avant];
            const tAvant = defAvant && defAvant.interactive && MC.ContratsV2.TYPES_CONTENEUR[defAvant.interactive];
            if (tAvant && !tAvant.parJoueur) {
              const kc = MC.ContratsV2.cleConteneur(m.x, m.y, m.z);
              const contCasse = conteneursPoses.get(kc) || contNeuf;
              if (contCasse) {
                S.fermerConteneurPourAbonnes(kc);
                contCasse.slots.forEach(s => { if (s) entites.dropStack(m.x + 0.5, m.y + 0.5, m.z + 0.5, s); });
                conteneursPoses.delete(kc);
                derniereEmissionFour.delete(kc);
              }
            }
          }
          break;
        }

        /* SPEC-SYNC-017 : DISTRIB est une DÉCLARATION, pas un dépôt aveugle —
           `m.slots` (déjà borné et normalisé par net-protocol.js) est ce que le
           joueur VEUT voir dans le distributeur ; `MC.Conteneurs.declarer` ne
           prélève dans son inventaire serveur que ce qu'il possède réellement
           (tronqué), et rend ce qu'un retrait n'a pas pu récupérer (Σ inv +
           distributeur conservée par id). Le distributeur est un conteneur posé
           comme un autre depuis l'étape 7 (`conteneursPoses`) — gardé pour un
           appelant historique (solo via un ancien client, tests) ; le client
           à jour préfère `CONTENEUR_TRANSFERT` (modèle référence, § 6/8). */
        case NP.MSG.DISTRIB: {
          const js = c.joueurs && c.joueurs[m.j];
          if (!js || monde.getBlock(m.x, m.y, m.z) !== C.B.DISTRIBUTEUR) break;
          const kd = MC.ContratsV2.cleConteneur(m.x, m.y, m.z);
          let cont = conteneursPoses.get(kd);
          if (!cont) { cont = MC.Conteneurs.creerConteneur('distributeur'); conteneursPoses.set(kd, cont); }
          MC.Conteneurs.declarer(js.joueur.state.inv, cont, m.slots);
          S.envoyerInvMaj(c, m.j, {});
          break;
        }

        /* SPEC-BANC-106 : erreur error/fatal d'un client, rassemblée dans le journal
           du serveur, au-delà du débit ignorée (le client applique déjà la même
           limite de son côté). */
        case NP.MSG.JOURNAL_CLIENT: {
          // seulement un joueur admis ; au plus REMONTEE.max par fenêtre et par ADRESSE (une reconnexion ne remet
          // rien à zéro) et REMONTEE_SERVEUR.globalMax en tout — le fichier du journal reste borné
          if (!c.rejoint) break;
          if (!filtreRemontees(c.ip)) break;
          logClient[m.niveau](`${c.nom} (#${c.id}) [${m.domaine}] ${m.message}`, { client: c.id, domaine: m.domaine }, m.pile || null, m.code ? { code: m.code } : null);
          break;
        }

        case NP.MSG.CHAT: {
          /* B4 (SPEC-PVP-005) : /duel <nom> | /duel accepter | /duel refuser —
             interception AVANT /faction (§ 4 du plan), jamais diffusé au chat
             général : une réponse système au seul intéressé (et à l'adversaire
             quand il y en a un). */
          if (typeof m.texte === 'string' && /^\/duel(\s|$)/.test(m.texte)) {
            S.traiterDuel(c, m.texte);
            break;
          }
          /* SPEC-QUETE-004 : /quete lister | accepter <id> | remettre <id> —
             le serveur reste SEUL arbitre (MC.Politique.accepterQuete/remettreQuete),
             jamais un client : un « remettre » qui arrive deux fois (deux
             clients, un double clic) ne verse jamais deux fois la récompense
             (remettreQuete ne retrouve plus de quête 'active' au second appel). */
          if (typeof m.texte === 'string' && /^\/quete(\s|$)/.test(m.texte)) {
            S.traiterQuete(c, m.texte);
            break;
          }
          /* /faction … : le serveur fait foi sur les factions de joueurs
             (SPEC-FACTION-009 à 013) ; la réponse ne va qu'à l'intéressé, et
             « dire » ne va qu'aux membres de sa faction principale. */
          if (typeof m.texte === 'string' && /^\/faction(\s|$)/.test(m.texte)) {
            const r = MC.Commandes.executer({ nom: 'faction', args: m.texte.trim().split(/\s+/).slice(1) }, {});
            const actions = (r.actions || []).filter(a => a.type === 'faction');
            if (!actions.length) (r.messages || []).forEach(t => envoyer(c, { t: NP.MSG.CHAT, auteur: null, texte: t, type: 'systeme' }));
            actions.forEach(a => {
              // l'état politique permet à une faction de joueurs de se déclarer envers une faction PNJ (SPEC-FACTION-017)
              const res = MC.Guildes.appliquerAction(guildes, c.nom, a, politique);
              if (res.canal) {
                const membres = new Set(res.canal.membres);
                clients.forEach(cl => { if (cl.rejoint && membres.has(cl.nom)) envoyer(cl, { t: NP.MSG.CHAT, auteur: null, texte: res.message, type: 'faction' }); });
              } else envoyer(c, { t: NP.MSG.CHAT, auteur: null, texte: res.message, type: 'systeme' });
              MC.Admin.journaliser(admin, { auteur: c.nom, action: 'faction', cible: a.action, details: res.ok, heure: EP.heure });
              if (res.ok && !res.canal) EP.guildesSales = true;
            });
            diffuserPolitiqueSiChangee();     // SPEC-SYNC-024 : appartenances et relations diffusées sans attendre le tic
            break;
          }
          const msg = chat.envoyer(c.nom, m.texte);
          if (msg) {
            diffuser({ t: NP.MSG.CHAT, auteur: msg.auteur, texte: msg.texte,
                       type: msg.type, ts: msg.t });
            journal(`<${c.nom}> ${msg.texte}`);
            MC.Admin.journaliser(admin, { auteur: c.nom, action: 'chat', cible: msg.texte, heure: EP.heure });
          }
          break;
        }

        case NP.MSG.ADMIN: {
          S.traiterAdmin(c, m);
          break;
        }

        // ── B1 : inventaire, équipement, grille de fabrication (SPEC-SYNC-007 à
        // 011, 014) — chaque opération passe par MC.Conteneurs.appliquer, la même
        // fonction pure que la prédiction client et le solo (docs/vague-2/B1.md).
        case NP.MSG.CRAFT: {
          const js = c.joueurs && c.joueurs[m.j];
          if (!js) break;
          const rc = S.traiterOp(c, m, js, { k: 'craft', fois: m.fois });
          if (rc && rc.ok && rc.effets && rc.effets.ids) rc.effets.ids.forEach(id => S.signalerSucces(js, { type: 'fabriquer', id }));
          break;
        }
        case NP.MSG.EQUIP: {
          const js = c.joueurs && c.joueurs[m.j];
          if (!js) break;
          const r = S.traiterOp(c, m, js, { k: 'equip', slot: m.slot, i: m.i });
          if (r && r.ok) S.diffuserEquipVu(c, m.j, js, m.slot);
          break;
        }
        /* B1 (étape 7, SPEC-SYNC-012/013) : s'abonner à un conteneur à portée —
           bloc (x,y,z) ou banquier (eid). Un seul conteneur ouvert à la fois par
           joueur local (une nouvelle ouverture remplace la précédente, comme un
           joueur qui ferme un coffre pour en ouvrir un autre). Refus SILENCIEUX
           sauf si le message porte un `seq` (clic explicite côté client, B1.md
           § 4) — sinon un `INV_MAJ` de refus. */
        case NP.MSG.CONTENEUR_OUVRIR: {
          const js = c.joueurs && c.joueurs[m.j];
          if (!js || js.joueur.state.dead) break;
          // `seq` facultatif (§ 4 du plan) : quand il est fourni, il partage le
          // même compteur strictement croissant que les autres opérations de ce
          // joueur local — sinon l'`ack` d'un refus ne correspondrait jamais au
          // `seq` envoyé, et le client ne saurait jamais le relier à sa demande.
          if (m.seq !== undefined && !S.seqNouveau(js, m.seq)) break;
          const r = S.ouvrirConteneurPourJoueur(js, m);
          if (!r) { if (m.seq !== undefined) S.refuserOp(c, m.j, m.seq, 'portee'); break; }
          if (r.type === 'banque') S.signalerSucces(js, { type: 'banque' });
          envoyer(c, {
            t: NP.MSG.CONTENEUR_ETAT, j: m.j, cle: r.cle, type: r.type, rev: r.cont.rev || 0,
            slots: r.cont.slots.map(MC.ContratsV2.pileVersCase),
            four: r.cont.four ? { burn: r.cont.four.burn, cook: r.cont.four.cook } : undefined,
          });
          break;
        }
        case NP.MSG.CONTENEUR_TRANSFERT: {
          const js = c.joueurs && c.joueurs[m.j];
          if (!js) break;
          S.traiterOp(c, m, js, { k: 'transfert', de: m.de, vers: m.vers, n: m.n });
          break;
        }
        /* Fermer la grille rend son contenu à l'inventaire (SPEC-SYNC-007) ; un
           conteneur posé ou la banque : simple désabonnement (rien à rendre,
           tout y est déjà réellement). */
        case NP.MSG.CONTENEUR_FERMER: {
          const js = c.joueurs && c.joueurs[m.j];
          if (!js) break;
          if (m.cle === 'grille') { S.traiterOp(c, m, js, { k: 'rendreGrille' }); break; }
          if (js.conteneurOuvert === m.cle) { js.conteneurOuvert = null; js.banquePos = null; js.banqueEid = null; }
          break;
        }
        case NP.MSG.INV_CONSOMMER: {
          const js = c.joueurs && c.joueurs[m.j];
          if (!js) break;
          // les diminutions que le serveur a déjà faites lui-même (pose, tir) ne se comptent pas deux fois
          const opsRestantes = S.absorberDebitsPrevus(js, m.ops);
          if (!opsRestantes.length) {
            if (S.seqNouveau(js, m.seq)) S.envoyerInvMaj(c, m.j, {});
            break;
          }
          S.traiterOp(c, m, js, { k: 'consommer', ops: opsRestantes });
          break;
        }
        case NP.MSG.INV_LACHER: {
          const js = c.joueurs && c.joueurs[m.j];
          if (!js) break;
          S.traiterOp(c, m, js, { k: 'lacher', i: m.i, n: m.n });
          break;
        }
        case NP.MSG.INV_CREATIF: {
          const js = c.joueurs && c.joueurs[m.j];
          if (!js) break;
          S.traiterOp(c, m, js, { k: 'creatif', i: m.i, id: m.id, n: m.n });
          break;
        }

        /* SPEC-SYNC-023 (B2, L45) : commerce serveur-autoritaire, contre les
           helpers de l'API inter-lots (docs/vague-2/B1.md § 5) : `seqNouveau`,
           `envoyerInvMaj`, `refuserOp`, `etatJoueurServeur`, la Map `banques` —
           tous fournis par B1 (fusionné). */
        case NP.MSG.HISTOIRE_PARLER: S.traiterHistoireParler(c, m); break;
        case NP.MSG.HISTOIRE_REPONSE: S.traiterHistoireReponse(c, m); break;
        case NP.MSG.TROC: {
          const js = c.joueurs && c.joueurs[m.j];
          if (!js || js.joueur.state.dead) break;
          const ent = entites.list.find(e => e.eid === m.eid && e.type === 'villager');
          if (!ent) break;
          const st = js.joueur.state;
          const d = Math.hypot(ent.pos.x - st.pos.x, (ent.pos.y || 0) - st.pos.y, ent.pos.z - st.pos.z);
          if (d > MC.ContratsV2.BORNES.PORTEE_TROC) break;
          // un village hostile ferme le commerce, comme en solo (game.js parlerA) —
          // piège signalé par docs/vague-2/B2.md § 13 : garder ce contrôle AVANT
          // executerTroc, côté serveur comme côté client.
          if (monde.reputation && !MC.Factions.commerceOuvert(monde.reputation)) break;

          if (m.action === 'consulter') {
            envoyer(c, { t: NP.MSG.TROC, action: 'offres', eid: m.eid, offres: offresPour(ent, c.nom) });
            break;
          }
          // action === 'echanger' : idempotence par seq (B1)
          if (!S.seqNouveau(js, m.seq)) break;
          // B4 (SPEC-PVP-006) : hors-la-loi envers une faction dont le territoire
          // couvre le lieu du PNJ → embargo (motif 'embargo', economie.js § 8).
          // SPEC-FACTION-015 : le même motif s'applique quand la faction politique
          // qui couvre le PNJ est EN GUERRE contre la faction de joueurs (guildes.js)
          // principale du joueur — extension de FACTION-003 aux factions politiques
          // et aux factions de joueurs qui leur sont alliées/ennemies (guildes.js:
          // declarerRelation pose déjà cette relation dans `politique.relations`,
          // la même Map que `MC.Politique.relationEntre` relit).
          const factionLieuTroc = MC.Politique.factionCouvrant(politique, ent.pos.x, ent.pos.z);
          const factionJoueurTroc = MC.Guildes.factionsDe(guildes, c.nom).principale;
          const embargoFaction = !!(factionLieuTroc && factionJoueurTroc &&
            MC.Politique.commerceFermeAvec(politique, factionLieuTroc, factionJoueurTroc));
          const embargo = embargoFaction || MC.PvpEnjeux.embargo(pvp, c.nom, politique, ent.pos.x, ent.pos.z);
          const r = MC.Economie.executerTroc(economie, S.etatJoueurServeur(js).inv, {
            lieuId: ent.lieu, role: ent.role, pnjId: ent.pnj, indice: m.offre, fois: m.fois || 1,
            nom: c.nom, embargo,
          });
          if (!r.ok) { S.refuserOp(c, m.j, m.seq, r.motif); break; }
          S.signalerSucces(js, { type: 'echange' });
          S.envoyerInvMaj(c, m.j, {});
          MC.Admin.journaliser(admin, { auteur: c.nom, action: 'troc', cible: m.eid, details: r.transaction, heure: EP.heure });
          envoyer(c, { t: NP.MSG.TROC, action: 'offres', eid: m.eid, offres: offresPour(ent, c.nom) });
          break;
        }
      }
    }
  }

  MC.ServeurMessages = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
