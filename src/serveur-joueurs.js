/* serveur-joueurs.js — les joueurs : sommeil, PvP, quêtes, duels
   Création d'un joueur serveur, sommeil, PvP et ses enjeux, quêtes
   et duels.

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
      NP, SY, C, CONF, admin, regles, monde, entites, chat, politique, guildes, economie,
      pvp, SPAWN, clients, diffuser, envoyer, journal, fixerReapparitionLit,
      etatJoueurServeur, envoyerInvMaj, lacherAuxPieds, signalerSucces,
    } = S;
    const EP = S.EP;   // état partagé modifiable, à forme fixe (créé par server.js)
    Object.assign(S, {
      creerJoueurServeur, tousLesJoueurs, messageSystemeA, compterDormeurs,
      coucher, verifierSommeil, placesOccupees, pvpAutorise, joueurParCle,
      joueurParEtat, joueurParNom, peutBlesserJoueurs, issuePvp, traiterQuete,
      traiterDuel,
    });

    // ── joueurs simulés ──────────────────────────────────────────────────────────
    /* Un joueur du serveur : le MÊME code que celui du client (player.js), piloté
       par les entrées reçues. C'est lui qui fait foi sur la position et les
       statistiques (vie, faim, air, mort). */
    function creerJoueurServeur(j) {
      const joueur = MC.createPlayer(monde, entites, regles);
      joueur.state.pos.x = SPAWN.x + j * 1.2; joueur.state.pos.y = SPAWN.y; joueur.state.pos.z = SPAWN.z;
      // B1 : grille de fabrication propre à ce joueur local, et idempotence des
      // messages d'inventaire (dernierSeq, revInv — voir seqNouveau/envoyerInvMaj).
      const grille = MC.Inventory.create(MC.ContratsV2 ? MC.ContratsV2.BORNES.SLOTS_GRILLE : 9);
      return { joueur, grille, cleReg: null, dernierSeq: 0, revInv: 0,
               // SPEC-ARCHI-042 : succès du joueur, suivi de position (distance, altitude, nuit),
               // connexion et rang local (renseignés à REJOINDRE), dernier état de succès envoyé
               succes: MC.Succes.creer(), suiveur: MC.Succes.creerSuiveur(), cid: null, j: 0,
               succesRevEnvoyee: -1, succesEnvoiT: 0, lieuSucces: null, lieuT: 0,
               // B1 (étape 7) : conteneur posé (ou 'banque') actuellement ouvert par
               // ce joueur local — un seul à la fois, voir resoudreConteneur/ctxJoueur.
               conteneurOuvert: null, banquePos: null, banqueEid: null,
               entrees: [], dernier: 0, budget: SY.creerBudget(), attaqueCd: 0, tirCd: 0 };
    }
    function tousLesJoueurs() {
      const l = [];
      clients.forEach(c => { if (c.rejoint && c.joueurs) c.joueurs.forEach((js, j) => l.push({ c, j, js })); });
      return l;
    }
    /* Message système adressé à UN client (le chat serveur, lui, est diffusé). */
    function messageSystemeA(c, texte) {
      envoyer(c, { t: NP.MSG.CHAT, auteur: null, texte, type: 'systeme', ts: Date.now() });
    }
    /* SPEC-ARCHI-025 : les joueurs couchés (objets `js`, propres à une connexion et
       un joueur local) avec l'endroit et la vie de leur coucher. Le vote de sommeil
       est tenu PAR LE SERVEUR, sans dépendre du client : un dormeur qui bouge, est
       touché, meurt ou se déconnecte sort du compte tout seul. La nuit passe dès
       qu'une MAJORITÉ STRICTE des joueurs présents et vivants dort (au moins un) —
       un seul éveillé ne bloque donc pas cent joueurs. */
    const dormeurs = new Map();          // js -> { x, y, z, pv }
    S.dormeurs = dormeurs;
    const SOMMEIL_DEPLACEMENT_MAX = 1.5; // blocs : au-delà, il s'est levé
    function compterDormeurs() {
      let total = 0, dorment = 0;
      const presents = new Set();
      tousLesJoueurs().forEach(({ js }) => {
        presents.add(js);
        const st = js.joueur.state;
        if (st.dead) { dormeurs.delete(js); return; }
        total++;
        const d = dormeurs.get(js);
        if (!d) return;
        if (Math.hypot(st.pos.x - d.x, st.pos.z - d.z) > SOMMEIL_DEPLACEMENT_MAX || Math.abs(st.pos.y - d.y) > SOMMEIL_DEPLACEMENT_MAX || st.hp < d.pv) {
          dormeurs.delete(js);                    // il s'est levé, ou il a été touché
          return;
        }
        dorment++;
      });
      dormeurs.forEach((d, js) => { if (!presents.has(js)) dormeurs.delete(js); });
      return { dorment, total };
    }
    function coucher(js) {
      const st = js.joueur.state;
      fixerReapparitionLit(js);          // SPEC-ARCHI-026 : se coucher fixe aussi la réapparition, sur le lit à portée
      dormeurs.set(js, { x: st.pos.x, y: st.pos.y, z: st.pos.z, pv: st.hp });
    }
    /* Fait passer la nuit quand une majorité stricte des joueurs présents dort.
       Renvoie vrai si la nuit vient de passer. Appelée à chaque DORMIR et une fois
       par seconde (un éveillé peut être parti, un dormeur s'être levé). */
    function verifierSommeil() {
      if (!dormeurs.size) return false;
      if (!MC.DayCycle.isNight(EP.heure)) { dormeurs.clear(); return false; }
      const { dorment, total } = compterDormeurs();
      if (total === 0 || dorment * 2 <= total) return false;
      dormeurs.clear();
      EP.heure = MC.DayCycle.avancerJourApresDormir(EP.heure);
      const m = chat.systeme('Le jour se lève.');
      if (m) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
      journal(`nuit passée : la majorité des joueurs dormait (heure ${EP.heure.toFixed(1)})`);
      return true;
    }
    // SPEC-SERVEUR-010 : nombre de JOUEURS déjà admis (écran partagé compris),
    // pas de connexions — testé en conditions réelles (tests/integration-
    // capacite.js) : `server.js` a des effets de bord au chargement (écoute
    // immédiate), donc jamais `require()` directement, comme le reste de la
    // suite (toujours un vrai processus lancé via `spawn`, jamais isolé).
    function placesOccupees() {
      let n = 0;
      clients.forEach(c => { if (c.rejoint) n += c.locaux || 1; });
      return n;
    }

    /* SPEC-COMBAT-002 : le PvP n'est permis que si le serveur l'autorise
       (--pvp, désactivé par défaut) ET si la zone des DEUX joueurs le permet
       (SPEC-ZONE-001) — un joueur réfugié en zone sûre reste protégé même si
       son agresseur, lui, se tient en zone PvP. */
    function pvpAutorise(posA, posB) {
      return !!CONF.pvp && (!MC.Zones || MC.Zones.pvpAutorise(monde.zones, monde.zonesEtat, posA, posB, politique));
    }
    // un identifiant stable pour désigner un joueur cible dans un message ATTAQUE
    function cleJoueur(id, j) { return id + '/' + (j || 0); }
    function joueurParCle(cle) {
      const p = String(cle).split('/');
      const id = +p[0], j = +p[1] || 0;
      return tousLesJoueurs().find(x => x.c.id === id && x.j === j) || null;
    }

    // ── PvP : enjeux et sanctions (B4, SPEC-PVP-001 à 006) ──────────────────────
    /* État `pvp` (MC.PvpEnjeux) déclaré plus haut, avec `politique`/`guildes`
       (même raison : lu par `etatMonde`/`appliquerEtatMonde` dès la reprise
       `--monde`, avant ce point du fichier). Cette section rassemble les
       helpers, tous des déclarations de fonction (hissées), donc utilisables
       depuis `traiter()` bien plus haut dans le fichier — même patron que
       `ctxJoueur`/`resoudreConteneur` pour B1. */

    // retrouve le tuple {c, j, js} du joueur local dont le state est EXACTEMENT
    // `state` (identité d'objet — comme `joueurs.find` sur `ev.picked`/`degatsPar`
    // déjà utilisé plus bas pour le ramassage et les dégâts de créature).
    function joueurParEtat(state) {
      return tousLesJoueurs().find(x => x.js.joueur.state === state) || null;
    }
    // retrouve un joueur CONNECTÉ par son nom de connexion (insensible à la casse
    // et aux espaces, comme `canon`) — utilisé par /duel, qui désigne sa cible
    // par son nom plutôt que par la clé « id/j » de ATTAQUE (piège B4.md § 13 :
    // deux joueurs locaux d'un même poste partagent ce nom, jamais deux « vrais »
    // adversaires).
    function joueurParNom(nom) {
      const cnom = MC.Admin.canon(nom);
      return tousLesJoueurs().find(x => MC.Admin.canon(x.c.nom) === cnom) || null;
    }
    /* Fournie à `entites.update` comme `opts.peutBlesser` (SPEC-PVP-002/005) :
       un duel consenti en cours autorise le coup MÊME hors zone PvP/sans --pvp ;
       sinon, PvP autorisé par la zone/le réglage ET aucune faction commune —
       exactement la même règle que `case ATTAQUE` pour le corps à corps. Prend
       des STATES (comme `stepArrow`/`degatsPar` les manipulent), retrouve les
       noms au besoin — jamais l'inverse (`peutBlesser` de guildes.js prend des
       NOMS, piège documenté par B4.md § 13). */
    function peutBlesserJoueurs(stA, stB) {
      const a = joueurParEtat(stA), b = joueurParEtat(stB);
      if (!a || !b) return false;
      const duel = MC.PvpEnjeux.duelActif(pvp, a.c.nom, b.c.nom, EP.heure, stA.pos, stB.pos);
      return duel || (pvpAutorise(stA.pos, stB.pos) && MC.Guildes.peutBlesser(guildes, a.c.nom, b.c.nom));
    }
    function envoyerSysteme(c, texte) {
      envoyer(c, { t: NP.MSG.CHAT, auteur: null, texte, type: 'systeme' });
    }
    /* Issue commune d'une mort PvP (corps à corps ou flèche) : butin, meurtre,
       réputation, hors-la-loi — jamais en duel (SPEC-PVP-001/003/005) — et, DANS
       TOUS LES CAS, la victoire et son message (SPEC-PVP-004). `vainqueur`/
       `vaincu` : { c, j, js }. */
    function issuePvp(vainqueur, vaincu, duel) {
      const nomV = vainqueur.c.nom, nomP = vaincu.c.nom;
      let perte;
      if (!duel) {
        const invPerdant = etatJoueurServeur(vaincu.js).inv, invGagnant = etatJoueurServeur(vainqueur.js).inv;
        const r = MC.PvpEnjeux.resoudreButin(invPerdant, invGagnant, nomV + '|' + nomP + '|' + EP.heure.toFixed(3));
        perte = r.perte;
        // le reliquat que le vainqueur ne peut pas porter tombe À SES PIEDS (il
        // vient de le gagner : c'est lui qui a la priorité dessus, pas le vaincu).
        r.reste.forEach(p => lacherAuxPieds(vainqueur.js, p));
        const posVaincu = vaincu.js.joueur.state.pos;
        const factions = MC.PvpEnjeux.factionsProches(politique, posVaincu.x, posVaincu.z);
        const res = MC.PvpEnjeux.enregistrerMeurtre(pvp, nomV, nomP, EP.heure, factions);
        if (res.penalites.length) envoyer(vainqueur.c, { t: NP.MSG.PVP, evt: 'reputation', factions: res.penalites });
        if (res.horsLaLoi.length) {
          envoyer(vainqueur.c, { t: NP.MSG.PVP, evt: 'hors_la_loi',
            factions: res.penalites.filter(p => res.horsLaLoi.indexOf(p.id) >= 0) });
        }
      }
      const n = MC.PvpEnjeux.enregistrerVictoire(pvp, nomV);
      envoyer(vainqueur.c, { t: NP.MSG.PVP, evt: 'victoire', contre: nomP, n });
      // SPEC-ARCHI-042 : un duel consenti n'a aucun enjeu (ni butin ni meurtre) : il ne rapporte aucun succès,
      // sinon deux comptes se « battraient » en duel pour farmer « Champion »
      if (!duel) signalerSucces(vainqueur.js, { type: 'pvp_victoire', n });
      const msgDefaite = { t: NP.MSG.PVP, evt: 'defaite', de: nomV };
      if (perte) msgDefaite.perte = perte;
      envoyer(vaincu.c, msgDefaite);
      envoyerInvMaj(vainqueur.c, vainqueur.j, {});
      envoyerInvMaj(vaincu.c, vaincu.j, {});
      MC.Admin.journaliser(admin, { auteur: nomV, action: 'pvp_victoire', cible: nomP, details: duel ? 'duel' : 'meurtre', heure: EP.heure });
    }
    /* /duel <nom> | /duel accepter | /duel refuser (case CHAT, avant /faction).
       Jamais diffusé au chat général : une réponse système au seul intéressé (et
       à l'adversaire, quand il y en a un joignable). */
    /* SPEC-QUETE-004 : /quete lister | accepter <id> | remettre <id>. Les
       propositions viennent de MC.Politique.quetesActives(politique) (quêtes de
       faction, y compris de reconstruction/secours ajoutées côté lieu — voir
       habitats.js:queteCatastrophe pour SPEC-QUETE-003, proposées de la même
       façon par leur `id`) ; le tableau PAR JOUEUR (`quetesJoueurs`) est ce que
       le serveur arbitre : accepterQuete/remettreQuete (politique.js) décident
       seuls, jamais un client. */
    // SPEC-QUETE-001/QUETE-005 : ressource abstraite de faction -> objet réel
    // livré par le joueur (le même vocabulaire que politique.js:ressourceCiblePourLivraison).
    // jamais I.EMERALD lui-même pour 'or' : MC.Economie.prixCourant traite une
    // offre dont give[0].id === EMERALD comme un ACHAT (estAchat), qui lirait
    // alors offre.get (toujours null ici) — le lingot d'or est la vraie
    // ressource physique derrière la trésorerie d'une faction (banquier,
    // habitats.js), l'émeraude n'étant que sa monnaie d'échange.
    const RESSOURCE_ITEM_QUETE = { or: C.I.GOLD_INGOT, nourriture: C.I.WHEAT };
    const MONTANT_LIVRAISON_QUETE = 10;
    const RAYON_RECONSTRUCTION_QUETE = 48;
    function quetesDisponibles() {
      return MC.Politique.quetesActives(politique).concat(EP.quetesCatastrophe.filter(q => MC.Habitats.queteActive(q, EP.heure)));
    }
    /* SPEC-QUETE-002/003/004/005 : vérifie RÉELLEMENT l'objectif avant de rendre
       la quête remise — jamais une simple formalité. Renvoie { ok, motif?,
       recompense? } ; en cas de succès, applique aussi l'effet réel sur l'état
       du monde (livraison à la faction, élimination de la cible, rien de plus à
       appliquer pour une reconstruction constatée sur place) et calcule la
       récompense réelle (QUETE-005) à partir de CE succès, jamais avant. */
    function verifierEtAppliquerObjectif(js, quete) {
      if (quete.type === 'livrer') {
        const objetId = RESSOURCE_ITEM_QUETE[quete.ressource];
        if (objetId == null) return { ok: false, motif: 'objectif_non_verifiable' };
        const inv = js.joueur.state.inv;
        if (!inv || inv.count(objetId) < MONTANT_LIVRAISON_QUETE) {
          return { ok: false, motif: 'ressource_manquante', requis: MONTANT_LIVRAISON_QUETE };
        }
        inv.remove(objetId, MONTANT_LIVRAISON_QUETE);
        MC.Politique.livrerQuete(politique, quete.faction, quete.ressource, MONTANT_LIVRAISON_QUETE);
        const recompense = MC.Politique.recompenseReelle(politique, quete,
          { economie, objetId, montant: MONTANT_LIVRAISON_QUETE, lieuId: quete.faction });
        return { ok: true, recompense };
      }
      if (quete.type === 'eliminer') {
        // reussirQueteElimination revalide elle-même que la cible promise est
        // toujours une faction connue et toujours en guerre/rivalité — un
        // conflit apaisé entre-temps refuse la remise (motif null -> refus ici).
        const cibleId = MC.Politique.reussirQueteElimination(politique, quete.faction, quete.cible);
        if (!cibleId) return { ok: false, motif: 'objectif_non_atteint' };
        const recompense = MC.Politique.recompenseReelle(politique, quete, { economie });
        return { ok: true, recompense };
      }
      // 'reconstruction'/'secours' : vérifiées à part dans traiterQuete (position
      // du joueur par rapport au lieu sinistré, pas un objectif d'inventaire).
      return { ok: false, motif: 'objectif_non_verifiable' };
    }
    function traiterQuete(c, texte) {
      const args = texte.trim().split(/\s+/).slice(1);
      const sous = (args[0] || '').toLowerCase();
      if (sous === 'lister' || !sous) {
        const dispo = quetesDisponibles();
        const mien = MC.Politique.quetesActivesDeJoueur(EP.quetesJoueurs, c.nom);
        if (!dispo.length && !mien.length) { envoyerSysteme(c, 'Aucune quête pour le moment.'); return; }
        dispo.forEach(q => envoyerSysteme(c, 'Proposée : [' + q.id + '] ' + q.titre + ' (récompense estimée ' + q.recompense + ')'));
        mien.forEach(q => envoyerSysteme(c, 'En cours : [' + q.id + '] ' + q.titre + ' — ' + q.statut));
        return;
      }
      if (sous === 'accepter') {
        const id = args[1];
        const quete = quetesDisponibles().find(q => q.id === id);
        if (!quete) { envoyerSysteme(c, 'Quête introuvable : ' + id); return; }
        const r = MC.Politique.accepterQuete(EP.quetesJoueurs, c.nom, quete);
        envoyerSysteme(c, r.ok ? 'Quête acceptée : ' + quete.titre : 'Quête déjà acceptée.');
        MC.Admin.journaliser(admin, { auteur: c.nom, action: 'quete_accepter', cible: id, details: r.ok, heure: EP.heure });
        return;
      }
      if (sous === 'remettre') {
        const id = args[1];
        const quete = MC.Politique.quetesActivesDeJoueur(EP.quetesJoueurs, c.nom).find(q => q.id === id && q.statut === 'active');
        if (!quete) { envoyerSysteme(c, 'Rien à remettre pour cette quête (déjà remise, ou jamais acceptée).'); return; }
        const moi = joueurParNom(c.nom);
        if (!moi) { envoyerSysteme(c, 'Rien à remettre pour cette quête (déjà remise, ou jamais acceptée).'); return; }
        // SPEC-QUETE-002/003/004 : l'objectif RÉEL est vérifié ici, avant toute
        // remise — une remise prématurée (rien livré, cible pas éliminée, hors
        // de portée du lieu sinistré) est refusée, sans marquer la quête remise
        // (elle reste 'active' : le joueur peut réessayer une fois l'objectif atteint).
        let resultat;
        if (quete.type === 'reconstruction' || quete.type === 'secours') {
          const st = moi.js.joueur.state;
          const d = (quete.x !== undefined && quete.z !== undefined) ? Math.hypot(st.pos.x - quete.x, st.pos.z - quete.z) : Infinity;
          if (d > RAYON_RECONSTRUCTION_QUETE) {
            resultat = { ok: false, motif: 'trop_loin_du_lieu' };
          } else {
            resultat = { ok: true, recompense: MC.Politique.recompenseReelle(politique, quete, {}) };
          }
        } else {
          resultat = verifierEtAppliquerObjectif(moi.js, quete);
        }
        if (!resultat.ok) {
          envoyerSysteme(c, 'Objectif non atteint : ' + quete.titre + ' (' + resultat.motif + ').');
          MC.Admin.journaliser(admin, { auteur: c.nom, action: 'quete_remettre_refusee', cible: id, details: resultat.motif, heure: EP.heure });
          return;
        }
        const r = MC.Politique.remettreQuete(EP.quetesJoueurs, c.nom, id, resultat.recompense);
        if (!r.ok) { envoyerSysteme(c, 'Rien à remettre pour cette quête (déjà remise, ou jamais acceptée).'); return; }
        // SPEC-QUETE-004/005 : la récompense est réellement créditée à
        // l'inventaire serveur du joueur — jamais seulement annoncée en chat.
        if (r.quete.recompenseVersee > 0) {
          moi.js.joueur.state.inv.add(C.I.EMERALD, Math.round(r.quete.recompenseVersee));
          envoyerInvMaj(moi.c, moi.j, {});
        }
        envoyerSysteme(c, 'Quête remise : ' + r.quete.titre + ' — récompense ' + r.quete.recompenseVersee + ' émeraude(s).');
        MC.Admin.journaliser(admin, { auteur: c.nom, action: 'quete_remettre', cible: id, details: r.quete.recompenseVersee, heure: EP.heure });
        return;
      }
      envoyerSysteme(c, 'Usage : /quete lister | accepter <id> | remettre <id>');
    }
    function traiterDuel(c, texte) {
      const args = texte.trim().split(/\s+/).slice(1);
      const sous = (args[0] || '').toLowerCase();
      if (sous === 'accepter' || sous === 'refuser') {
        const prop = pvp.propositions.get(MC.Admin.canon(c.nom));
        const proposeur = prop ? joueurParNom(prop.de) : null;
        const moi = joueurParNom(c.nom);
        if (!moi) return;
        const posProposeur = proposeur ? proposeur.js.joueur.state.pos : moi.js.joueur.state.pos;
        const r = MC.PvpEnjeux.repondreDuel(pvp, c.nom, sous === 'accepter', EP.heure, posProposeur, moi.js.joueur.state.pos);
        if (!r.ok) { envoyerSysteme(c, 'Duel : aucune proposition à laquelle répondre (ou trop tard).'); return; }
        if (r.refuse) {
          envoyerSysteme(c, 'Duel refusé.');
          if (proposeur) envoyerSysteme(proposeur.c, c.nom + ' refuse le duel.');
          return;
        }
        envoyerSysteme(c, 'Duel commencé avec ' + r.de + ' — ' + MC.PvpEnjeux.DUREE_DUEL + ' s, restez à moins de ' +
                       MC.PvpEnjeux.RAYON_DUEL + ' blocs l\'un de l\'autre.');
        envoyer(c, { t: NP.MSG.PVP, evt: 'duel_debut', contre: r.de });
        if (proposeur) {
          envoyerSysteme(proposeur.c, c.nom + ' accepte le duel !');
          envoyer(proposeur.c, { t: NP.MSG.PVP, evt: 'duel_debut', contre: c.nom });
        }
        return;
      }
      const cibleNom = args[0];
      if (!cibleNom) { envoyerSysteme(c, 'Usage : /duel <nom> | /duel accepter | /duel refuser'); return; }
      // SPEC-ARCHI-028 : seul sur le serveur (solo fermé), il n'y a personne à défier
      if (!tousLesJoueurs().some(x => x.c.id !== c.id)) { envoyerSysteme(c, 'Duel : aucun autre joueur à défier sur ce serveur.'); return; }
      const adversaire = joueurParNom(cibleNom);
      if (!adversaire || adversaire.c.id === c.id) { envoyerSysteme(c, 'Joueur introuvable : ' + cibleNom); return; }
      const r = MC.PvpEnjeux.proposerDuel(pvp, c.nom, cibleNom, EP.heure);
      if (!r.ok) { envoyerSysteme(c, 'Duel : impossible de se dueller soi-même.'); return; }
      envoyerSysteme(c, 'Duel proposé à ' + adversaire.c.nom + ' — ' + MC.PvpEnjeux.DELAI_PROPOSITION + ' s pour répondre.');
      envoyer(adversaire.c, { t: NP.MSG.PVP, evt: 'duel_propose', de: c.nom, jusque: EP.heure + MC.PvpEnjeux.DELAI_PROPOSITION });
    }
  }

  MC.ServeurJoueurs = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
