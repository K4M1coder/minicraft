/* serveur-antiflood.js — les budgets de messages par client
   Anti-flood (SPEC-SECU-005/006) : fenêtres glissantes, budgets par type,
   exclusion d'un client aberrant.

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
    const { NP, CA, admin, envoyer, fermer, journal } = S;
    const EP = S.EP;   // état partagé modifiable, à forme fixe (créé par server.js)
    Object.assign(S, { antiFloodOk });

    // ── anti-flood par client (SPEC-SECU-005/006) ────────────────────────────────
    /* Revue adversariale du commit 2365213 : un budget UNIQUE par connexion
       (30 msg/s) expulsait à tort un joueur légitime — creuser en créatif avec
       casse instantanée (src/player.js, mineTick) envoie un `BLOC` par image tant
       que le joueur regarde un bloc différent, soit jusqu'à ~60/s à 60 im/s ; et
       jusqu'à 4 joueurs locaux (écran partagé) partagent la MÊME connexion, donc
       le MÊME budget si on ne les distingue pas.

       Les budgets sont donc désormais PAR JOUEUR LOCAL (`m.j`, 0 à 3) ET PAR TYPE
       de message — un joueur local qui construit vite n'entame jamais le budget
       d'un autre, ni celui d'un autre type d'action :
         - BLOC : FLOOD_MAX_BLOC/s, PAR joueur local — ≥ 80/s pour couvrir la
           casse instantanée en créatif (~60/s à 60 im/s) avec une marge de 1,5×
           pour l'instabilité d'images (rattrapage après un ralentissement) ;
         - les autres messages porteurs d'un joueur local (BOUGE, ATTAQUE, TIR,
           MANGER, RENAITRE, DISTRIB) : FLOOD_MAX_GENERAL/s, PAR joueur local —
           l'exemple 30/s de la spec, ces actions n'étant jamais aussi rafraîchies
           que la casse de bloc ;
         - REJOINDRE/ADMIN (pas de joueur local) : FLOOD_MAX_GENERAL/s PAR
           CONNEXION (un panneau admin ne tape jamais aussi vite) ;
         - CHAT (pas de joueur local, un seul humain tape) : FLOOD_CHAT_MAX par
           FLOOD_CHAT_FENETRE_MS, inchangé.

       Un dépassement de budget n'ignore QUE le message en trop (lettre de
       SPEC-SECU-005/006) — plus jamais de fermeture pour un débit simplement
       soutenu. Seul un débit ABERRANT (> FLOOD_ABERRANT_MULT × le budget
       applicable — un ordre de grandeur qu'aucun client honnête ne peut
       atteindre) déclenche d'abord un avertissement (message CHAT système ciblé),
       puis — s'il persiste plusieurs secondes consécutives malgré
       l'avertissement — une expulsion, journalisée via MC.Admin.journaliser. */
    const FLOOD_FENETRE_MS = 1000, FLOOD_MAX_GENERAL = 30;      // ex. de la spec : 30/s
    const FLOOD_MAX_BLOC = 90;                                  // ≥ 80/s : voir justification ci-dessus
    const FLOOD_CHAT_FENETRE_MS = 10000, FLOOD_CHAT_MAX = 5;    // ~1 message toutes les 2 s en rafale
    const FLOOD_ABERRANT_MULT = 10;                             // > 10x le budget : impossible pour un client honnête
    const FLOOD_SECONDES_APRES_AVERTISSEMENT = 3;               // secondes ABERRANTES consécutives APRÈS l'avertissement
    // messages qui portent un joueur local (`m.j`) : leur budget se compte par
    // joueur local plutôt que par connexion, pour ne pas pénaliser l'écran partagé
    const FLOOD_TYPES_PAR_JOUEUR = new Set([
      NP.MSG.BLOC, NP.MSG.BOUGE, NP.MSG.ATTAQUE, NP.MSG.TIR, NP.MSG.MANGER, NP.MSG.RENAITRE, NP.MSG.DISTRIB,
    ]);
    /* B1 (vague 2, SPEC-SECU-005/006 étendu) : les nouveaux messages c→s portent
       tous un joueur local (`m.j`) — budgets propres à chaque type, donnés par
       MC.ContratsV2.BUDGETS_FLOOD (« troc » y figure déjà, pour B2). */
    if (MC.ContratsV2) Object.keys(MC.ContratsV2.BUDGETS_FLOOD).forEach(t => FLOOD_TYPES_PAR_JOUEUR.add(t));
    FLOOD_TYPES_PAR_JOUEUR.add(NP.MSG.DORMIR);
    [NP.MSG.VEHICULE_POSER, NP.MSG.VEHICULE_MONTER, NP.MSG.VEHICULE_DESCENDRE, NP.MSG.VEHICULE_REPARER].forEach(t => FLOOD_TYPES_PAR_JOUEUR.add(t));
    FLOOD_TYPES_PAR_JOUEUR.add(NP.MSG.HISTOIRE_PARLER);
    FLOOD_TYPES_PAR_JOUEUR.add(NP.MSG.HISTOIRE_REPONSE);
    if (NP.MSG.ACTIONNER) FLOOD_TYPES_PAR_JOUEUR.add(NP.MSG.ACTIONNER);   // SPEC-MECA-005

    /* Compte (et enregistre) l'arrivée d'un message dans sa fenêtre glissante —
       TOUJOURS, même au-delà du budget : c'est ce qui permet de distinguer un
       débit simplement soutenu (compte un peu au-dessus du budget) d'un débit
       aberrant (compte à 10x le budget ou plus), sans quoi un compteur qui
       s'arrête de grossir une fois saturé ne verrait plus la différence. */
    function floodCompte(c, cle, fenetreMs) {
      const maintenant = Date.now();
      const histo = c[cle] || (c[cle] = []);
      while (histo.length && maintenant - histo[0] >= fenetreMs) histo.shift();
      histo.push(maintenant);
      return histo.length;
    }
    function signalerAberrant(c, cle, type) {
      const sec = Math.floor(Date.now() / 1000);
      const cleSec = cle + '_sec', cleSuite = cle + '_suite', cleAverti = cle + '_averti';
      if (c[cleSec] === sec) return;                            // déjà traité cette seconde-ci
      const consecutif = c[cleSec] === sec - 1;
      c[cleSuite] = consecutif ? (c[cleSuite] || 0) + 1 : 1;
      c[cleSec] = sec;
      MC.Admin.journaliser(admin, { auteur: c.nom, action: 'flood_aberrant_' + type, cible: c.ip, details: c[cleSuite], heure: EP.heure });
      if (!c[cleAverti]) {
        // premier constat : un avertissement, jamais une fermeture immédiate
        c[cleAverti] = true;
        envoyer(c, { t: NP.MSG.CHAT, auteur: null, type: 'systeme', ts: Date.now(),
          texte: 'Débit de messages anormalement élevé : ralentissez, ou vous serez déconnecté.' });
        journal(`! ${c.nom} (#${c.id}) avertissement anti-flood (${type})`);
        return;
      }
      if (c[cleSuite] >= FLOOD_SECONDES_APRES_AVERTISSEMENT) {
        journal(`x ${c.nom} (#${c.id}) expulsé — débit aberrant persistant malgré l'avertissement (${type})`);
        fermer(c, 'debit aberrant persistant : ' + type);
      }
    }
    function floodVerifie(c, m, cle, fenetreMs, budget) {
      const n = floodCompte(c, cle, fenetreMs);
      if (n <= budget) return true;                             // sous le budget : rien à signaler
      if (n > budget * FLOOD_ABERRANT_MULT) signalerAberrant(c, cle, m.t);
      return false;                                              // au-dessus du budget : message ignoré (jamais fermé pour ça seul)
    }
    function antiFloodOk(c, m) {
      if (m.t === NP.MSG.CHAT) return floodVerifie(c, m, '_fl_chat', FLOOD_CHAT_FENETRE_MS, FLOOD_CHAT_MAX);
      const parJoueur = FLOOD_TYPES_PAR_JOUEUR.has(m.t);
      const cle = '_fl_' + m.t + (parJoueur ? '_' + (m.j || 0) : '');
      const budgetV2 = (MC.ContratsV2 && MC.ContratsV2.BUDGETS_FLOOD[m.t]) || CA.BUDGETS_FLOOD[m.t];
      const budget = m.t === NP.MSG.BLOC ? FLOOD_MAX_BLOC : (budgetV2 || FLOOD_MAX_GENERAL);
      return floodVerifie(c, m, cle, FLOOD_FENETRE_MS, budget);
    }
  }

  MC.ServeurAntiflood = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
