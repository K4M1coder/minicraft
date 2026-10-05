/* serveur-admin.js — les actions d'administration
   Cœur commun au panneau en jeu et à la console web (SPEC-ADMIN-001 à 008),
   heure du jour, blocs de commande.

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
    const { NP, C, CONF, admin, regles, monde, clients, envoyer, fermer, journal } = S;
    const EP = S.EP;   // état partagé modifiable, à forme fixe (créé par server.js)
    Object.assign(S, { executerBlocCommandeServeur, traiterAdmin, executerActionAdmin });

    // ── panneau admin en jeu (SPEC-ADMIN-006) ────────────────────────────────────
    /* Le client déclare une ACTION ; le serveur ne fait jamais confiance à un rôle
       annoncé par le client — seul `c.role`, attribué PAR le serveur à l'authen-
       tification, décide. Refuser silencieusement (erreur générique) évite de
       confirmer à un tiers curieux qu'un jeton particulier existe. */
    function reponseAdmin(c, action, ok, data, erreur) {
      envoyer(c, { t: NP.MSG.ADMIN_REP, action, ok, data: data || null, erreur: erreur || null });
    }
    function joueursEnLigne() {
      return S.tousLesJoueurs().map(({ c: cl, js }) => ({
        nom: cl.nom, ip: cl.ip, connecteLe: null,
        x: +js.joueur.state.pos.x.toFixed(1), y: +js.joueur.state.pos.y.toFixed(1), z: +js.joueur.state.pos.z.toFixed(1),
      }));
    }
    /* SPEC-MECA-007 : rejoue la commande d'un bloc de commande avec le MÊME
       analyseur/routeur que le chat (MC.Chat.parseCommande + MC.Commandes.executer,
       SPEC-CMD-001) — seules les actions qui ont un sens sans joueur qui tape
       sont appliquées ici (l'heure du monde) ; les autres (rejoindre un serveur,
       ouvrir le panneau admin…) sont silencieusement ignorées. */
    function executerBlocCommandeServeur(x, y, z) {
      const texte = monde.getCommande(x, y, z);
      if (!texte) return;
      const cmd = MC.Chat.parseCommande(texte);
      if (!cmd) return;
      const res = MC.Commandes.executer(cmd, {
        temps: EP.heure, dureeJour: MC.DayCycle ? MC.DayCycle.DAY_LENGTH : 1200,
        graine: CONF.graine, position: { x, y, z }, meteo: null, succes: null, enLigne: true, joueurs: [],
      });
      (res.actions || []).forEach(a => { if (a.type === 'heure') fixerHeureDuJour(a.valeur); });
    }
    /* Fixe l'heure DANS LE JOUR courant (la date, la saison et les cumulateurs
       par jour ne reculent jamais) : `v` est une heure du jour, en secondes. */
    function fixerHeureDuJour(v) {
      const dl = MC.DayCycle.DAY_LENGTH;
      EP.heure = Math.floor(EP.heure / dl) * dl + (v % dl);
      S.dormeurs.clear();                     // un saut d'heure annule le vote de sommeil en cours
    }
    /* SPEC-ARCHI-025 : demande d'heure d'un client (ADMIN 'heure'). Réservée à un
       administrateur authentifié OU à l'hôte local d'un monde en mode créatif —
       jamais à « n'importe quel joueur en créatif » d'un serveur ouvert. Débit
       limité (1 par seconde et par connexion) ; ne journalise que si l'heure
       change ; annule le vote de sommeil (fixerHeureDuJour). */
    function changerHeureDemandee(c, args) {
      if (!c.rejoint) return { ok: false, data: null, motif: 'non_rejoint' };
      if (EP.enPause) return { ok: false, data: null, motif: 'pause' };
      const admin_ = c.role === MC.Admin.ROLES.ADMIN;
      if (!admin_ && !(c.local && regles.blocsIllimites)) return { ok: false, data: null, motif: 'reserve_creatif_ou_admin' };
      const v = args.valeur;
      if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1e6) return { ok: false, data: null, motif: 'valeur_invalide' };
      const maintenant = Date.now();
      if (c.derniereHeureMs && maintenant - c.derniereHeureMs < 1000) return { ok: false, data: null, motif: 'trop_rapide' };
      c.derniereHeureMs = maintenant;
      const avant = EP.heure;
      fixerHeureDuJour(v);
      if (Math.abs(EP.heure - avant) >= 0.5) MC.Admin.journaliser(admin, { auteur: c.nom, action: 'heure', cible: null, details: +EP.heure.toFixed(1), heure: EP.heure });
      return { ok: true, data: { heure: +EP.heure.toFixed(1) }, motif: null };
    }
    function traiterAdmin(c, m) {
      const Adm = MC.Admin;
      if (m.action === 'auth') {
        const r = Adm.authentifier(admin, m.args && m.args.secret);
        if (!r) { reponseAdmin(c, 'auth', false, null, 'refuse'); return; }
        c.role = r.role;
        if (r.nom) c.nom = c.nom || r.nom;
        if (r.role === Adm.ROLES.ADMIN && c.rejoint) Adm.noterAdminConnu(admin, c.nom);
        reponseAdmin(c, 'auth', true, { role: r.role });
        journal(`+ ${c.nom} (#${c.id}) authentifie en ${r.role}`);
        return;
      }
      /* SPEC-ARCHI-025 : /jour, /nuit — même règle en solo et en réseau : refusé
         hors mode créatif, sauf pour un administrateur authentifié. */
      if (m.action === 'heure') {
        const r = changerHeureDemandee(c, m.args || {});
        reponseAdmin(c, 'heure', r.ok, r.data, r.motif);
        return;
      }
      /* SPEC-ARCHI-033 : modifier la commande d'un bloc de commande n'exige pas un
         jeton admin quand la règle commune (blocCommandeAutorise) l'accorde — hôte
         local en créatif. Le serveur revérifie tout : pas en pause, un vrai bloc de
         commande, à portée d'un des joueurs de ce client. */
      if (m.action === 'bloc_commande' && c.role !== MC.Admin.ROLES.ADMIN) {
        const a = m.args || {};
        const x = a.x | 0, y = a.y | 0, z = a.z | 0;
        const def = C.BLOCKS[monde.getBlock(x, y, z)];
        const proche = (c.joueurs || []).some(js => S.distanceConteneur(js.joueur.state, x, y, z) <= S.PORTEE_BLOC);
        if (EP.enPause || !c.rejoint || !S.blocCommandeAutorise(c) || !def || !def.circuit || def.circuit.type !== 'commande' || !proche) {
          reponseAdmin(c, m.action, false, null, 'refuse');
          return;
        }
        const rc = executerActionAdmin(MC.Admin.ROLES.ADMIN, c.nom, m.action, a);
        reponseAdmin(c, m.action, rc.ok, rc.ok ? rc.data : null, rc.ok ? null : rc.motif);
        return;
      }
      if (!c.role) { reponseAdmin(c, m.action, false, null, 'non_authentifie'); return; }
      const r = executerActionAdmin(c.role, c.nom, m.action, m.args || {});
      reponseAdmin(c, m.action, r.ok, r.ok ? r.data : null, r.ok ? null : r.motif);
    }

    /* Cœur commun au panneau en jeu (WebSocket) ET à la console web (HTTP) : les
       deux ne doivent JAMAIS diverger sur qui a le droit de faire quoi — d'où un
       seul endroit qui décide, appelé par les deux façades. */
    function executerActionAdmin(role, nomActeur, action, args) {
      const Adm = MC.Admin;
      args = args || {};
      const roleCible = args.nom ? Adm.roleDe(admin, args.nom) : null;
      if (!Adm.peutAgir(role, action, roleCible)) return { ok: false, motif: 'refuse' };

      switch (action) {
        case 'mesures': return { ok: true, data: S.statsMesures() };
        case 'joueurs': return { ok: true, data: Adm.vueJoueurs(admin, joueursEnLigne(), role) };
        case 'sessions': return { ok: true, data: Adm.vueSessions(admin, args.nom, role) };
        case 'listes': return { ok: true, data: Adm.vueListes(admin, role) };
        case 'journal': return { ok: true, data: Adm.vueJournal(admin, role, args.limite) };
        case 'inventaire': {
          const cible = [...clients.values()].find(x => x.nom === args.nom);
          const inv = cible && cible.joueurs && cible.joueurs[0] ? cible.joueurs[0].joueur.state.inv.serialize() : [];
          return { ok: true, data: inv };
        }
        case 'liste_ajouter':
          return { ok: true, data: Adm.ajouterListe(admin, args.liste, args.categorie, args.valeur, nomActeur, EP.heure) };
        case 'liste_retirer':
          return { ok: true, data: Adm.retirerListe(admin, args.liste, args.categorie, args.valeur, nomActeur, EP.heure) };
        case 'invitation_creer':
          return { ok: true, data: Adm.creerInvitation(admin, args, nomActeur, EP.heure) };
        case 'invitation_revoquer':
          return { ok: true, data: Adm.revoquerInvitation(admin, args.token, nomActeur, EP.heure) };
        case 'role_nommer':
          return { ok: true, data: Adm.nommerRole(admin, args.nom, args.role || null, nomActeur, EP.heure) };
        case 'zone_definir': {
          // SPEC-ZONE-004 / SPEC-ADMIN-006 : un administrateur redéfinit la zone
          // de la région où se trouve le point (x, z) donné.
          const r = MC.Zones.definirRegion(monde.zonesEtat, +args.x || 0, +args.z || 0, args.zone, nomActeur, EP.heure);
          if (r.ok) MC.Admin.journaliser(admin, { auteur: nomActeur, action: 'zone_definie', cible: r.region, details: r.zone, heure: EP.heure });
          return { ok: true, data: r };
        }
        case 'zone_retirer': {
          const r = MC.Zones.retirerRegion(monde.zonesEtat, +args.x || 0, +args.z || 0);
          if (r.ok) MC.Admin.journaliser(admin, { auteur: nomActeur, action: 'zone_retiree', cible: null, heure: EP.heure });
          return { ok: true, data: r };
        }
        case 'bloc_commande': {
          const x = args.x | 0, y = args.y | 0, z = args.z | 0;
          const texte = monde.setCommande(x, y, z, args.texte);
          MC.Admin.journaliser(admin, { auteur: nomActeur, action: 'bloc_commande', cible: `${x},${y},${z}`, details: texte, heure: EP.heure });
          return { ok: true, data: { texte } };
        }
        case 'sanction': {
          const res = Adm.sanctionner(admin, { nom: args.nom, type: args.type, dureeMs: args.dureeMs, auteur: nomActeur }, EP.heure);
          if (res.ok && (args.type === 'expulser' || args.type === 'bannir')) {
            const cible = [...clients.values()].find(x => x.nom === args.nom);
            if (cible) fermer(cible, 'sanction : ' + args.type);
          }
          return { ok: true, data: res };
        }
        default: return { ok: false, motif: 'action_inconnue' };
      }
    }
  }

  MC.ServeurAdmin = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
