/* admin.js — logique pure de l'administration du serveur (SPEC-ADMIN-001 à 008) :
   rôles (administrateur / modérateur), listes blanche et noire, invitations,
   sessions, sanctions et journal d'administration. Ce module ne connaît ni
   socket ni fichier : server.js s'en sert comme branchement, et lui seul
   décide qui obtient quel jeton. Testable donc entièrement sous Node. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var ROLES = { ADMIN: 'admin', MODERATEUR: 'moderateur' };

  // ── comparaison à temps constant ───────────────────────────────────────────
  /* Comparer deux secrets avec `===` fuit leur longueur ET s'arrête au premier
     octet différent : une attaque par mesure de temps peut ainsi deviner un
     mot de passe caractère par caractère. On parcourt donc TOUJOURS la
     longueur du plus long des deux, sans retour anticipé. */
  function egaliteConstante(a, b) {
    a = String(a === undefined || a === null ? '' : a);
    b = String(b === undefined || b === null ? '' : b);
    var n = Math.max(a.length, b.length);
    var diff = a.length ^ b.length;
    for (var i = 0; i < n; i++) {
      var ca = i < a.length ? a.charCodeAt(i) : 0;
      var cb = i < b.length ? b.charCodeAt(i) : 0;
      diff |= (ca ^ cb);
    }
    return diff === 0 && a.length > 0;
  }

  function canon(nom) { return String(nom || '').trim().toLowerCase(); }

  // ── jetons ──────────────────────────────────────────────────────────────────
  /* Pas de `crypto` ici (module pur, sans dépendance Node) : on mélange
     horodatage, compteur et hasard, suffisant pour un jeton d'invitation ou
     de modérateur qui vit derrière une connexion et peut être révoqué. */
  var compteurJeton = 0;
  function nouveauJeton(prefixe) {
    compteurJeton = (compteurJeton + 1) % 46656;
    var alea = Math.floor(Math.random() * 60466176).toString(36);
    return (prefixe || 'j') + Date.now().toString(36) + compteurJeton.toString(36) + alea;
  }

  // ── état ─────────────────────────────────────────────────────────────────
  function creerEtat(opts) {
    opts = opts || {};
    return {
      motDePasseAdmin: opts.motDePasseAdmin || null,
      emailObligatoire: !!opts.emailObligatoire,
      listeBlancheActive: !!opts.listeBlancheActive,
      roles: new Map(),                 // canon(nom) -> { role, token, nommePar, depuis }
      listeBlancheNoms: new Set(),
      listeBlancheEmails: new Set(),
      listeNoireNoms: new Set(),
      listeNoireEmails: new Set(),
      invitations: new Map(),           // token -> { expire, usagesMax, usages, email, revoque, cree, creePar }
      sessions: [],                     // historique persistant, y compris les partis
      sessionsOuvertes: new Map(),      // id -> session (référence dans `sessions`)
      sanctions: new Map(),             // canon(nom) -> { sourdineJusque, banniJusque, avertissements }
      journal: [],
      /* Le mot de passe administrateur n'est lié à AUCUNE identité de joueur :
         il authentifie une connexion, pas un nom. Pour qu'un modérateur ne
         puisse malgré tout jamais sanctionner « l'administrateur qui joue
         sous tel pseudo », on retient les noms vus authentifiés en admin le
         temps de la session serveur (jamais persisté : ce n'est qu'un indice
         courant, pas un rôle attribué). */
      adminsConnus: new Set(),
    };
  }

  // ── rôles ────────────────────────────────────────────────────────────────
  function authentifier(etat, secret) {
    if (!secret) return null;
    if (etat.motDePasseAdmin && egaliteConstante(secret, etat.motDePasseAdmin)) {
      return { role: ROLES.ADMIN, nom: null };
    }
    var trouve = null;
    etat.roles.forEach(function (r, nomCanon) {
      if (trouve) return;
      if (r.role === ROLES.MODERATEUR && egaliteConstante(secret, r.token)) trouve = { role: r.role, nom: nomCanon };
    });
    return trouve;
  }

  function roleDe(etat, nom) {
    var cle = canon(nom);
    if (etat.adminsConnus.has(cle)) return ROLES.ADMIN;
    var r = etat.roles.get(cle);
    return r ? r.role : null;
  }

  /* Appelé par server.js quand une connexion authentifiée admin est associée
     à un nom de joueur (elle a rejoint la partie sous ce pseudo) : ce nom
     devient protégé au même titre qu'un administrateur pour SPEC-ADMIN-008. */
  function noterAdminConnu(etat, nom) {
    if (nom) etat.adminsConnus.add(canon(nom));
  }

  /* Seul un administrateur nomme ou révoque un modérateur (jamais l'inverse :
     un modérateur ne change ni son rôle ni celui d'un pair, cf. SPEC-ADMIN-008).
     `role` vaut ROLES.MODERATEUR pour nommer, ou null pour révoquer. */
  function nommerRole(etat, nom, role, auteur, heure) {
    if (role !== null && role !== ROLES.MODERATEUR) return { ok: false, motif: 'role_invalide' };
    var cle = canon(nom);
    if (!cle) return { ok: false, motif: 'nom_invalide' };
    if (role === null) {
      var existait = etat.roles.delete(cle);
      journaliser(etat, { auteur: auteur, action: 'role_retire', cible: nom, heure: heure });
      return { ok: existait, jeton: null };
    }
    var jeton = nouveauJeton('mod-');
    etat.roles.set(cle, { role: role, token: jeton, nommePar: auteur, depuis: heure });
    journaliser(etat, { auteur: auteur, action: 'role_nomme', cible: nom, details: role, heure: heure });
    return { ok: true, jeton: jeton };
  }

  // ── permissions (SPEC-ADMIN-007 / 008) ──────────────────────────────────────
  /* Porte unique de décision : server.js ne doit JAMAIS appliquer une action
     d'administration sans être passé par ici. Centraliser évite qu'une route
     oublie une vérification que les autres appliquent. */
  var ACTIONS_ADMIN_SEUL = ['invitation_creer', 'invitation_revoquer', 'liste_ajouter',
    'liste_retirer', 'role_nommer', 'reglages', 'zone_definir', 'zone_retirer'];
    // `mesures` (SPEC-SERVEUR-002) : lecture seule, partagée avec les modérateurs pour la supervision.
  var ACTIONS_PARTAGEES = ['joueurs', 'sessions', 'journal', 'inventaire', 'sanction', 'listes', 'mesures'];

  function peutAgir(roleActeur, action, roleCible) {
    if (!roleActeur) return false;
    if (roleActeur === ROLES.ADMIN) {
      return ACTIONS_ADMIN_SEUL.indexOf(action) >= 0 || ACTIONS_PARTAGEES.indexOf(action) >= 0;
    }
    if (roleActeur === ROLES.MODERATEUR) {
      if (ACTIONS_ADMIN_SEUL.indexOf(action) >= 0) return false;
      if (action === 'sanction' && (roleCible === ROLES.ADMIN || roleCible === ROLES.MODERATEUR)) return false;
      return ACTIONS_PARTAGEES.indexOf(action) >= 0;
    }
    return false;
  }

  // ── liste blanche / liste noire ─────────────────────────────────────────────
  function ajouterListe(etat, liste, categorie, valeur, auteur, heure) {
    var ens = ensembleListe(etat, liste, categorie);
    if (!ens) return { ok: false, motif: 'liste_invalide' };
    var v = categorie === 'email' ? String(valeur || '').trim().toLowerCase() : canon(valeur);
    if (!v) return { ok: false, motif: 'valeur_invalide' };
    ens.add(v);
    journaliser(etat, { auteur: auteur, action: liste + '_ajout_' + categorie, cible: v, heure: heure });
    return { ok: true };
  }
  function retirerListe(etat, liste, categorie, valeur, auteur, heure) {
    var ens = ensembleListe(etat, liste, categorie);
    if (!ens) return { ok: false, motif: 'liste_invalide' };
    var v = categorie === 'email' ? String(valeur || '').trim().toLowerCase() : canon(valeur);
    var existait = ens.delete(v);
    journaliser(etat, { auteur: auteur, action: liste + '_retrait_' + categorie, cible: v, heure: heure });
    return { ok: existait };
  }
  function ensembleListe(etat, liste, categorie) {
    if (liste === 'blanche') return categorie === 'email' ? etat.listeBlancheEmails : etat.listeBlancheNoms;
    if (liste === 'noire') return categorie === 'email' ? etat.listeNoireEmails : etat.listeNoireNoms;
    return null;
  }
  function estListeNoire(etat, nom, email) {
    if (nom && etat.listeNoireNoms.has(canon(nom))) return true;
    if (email && etat.listeNoireEmails.has(String(email).trim().toLowerCase())) return true;
    return false;
  }
  function estListeBlanche(etat, nom, email) {
    if (nom && etat.listeBlancheNoms.has(canon(nom))) return true;
    if (email && etat.listeBlancheEmails.has(String(email).trim().toLowerCase())) return true;
    return false;
  }

  // ── invitations (SPEC-ADMIN-005) ───────────────────────────────────────────
  function creerInvitation(etat, opts, auteur, heure) {
    opts = opts || {};
    var jeton = nouveauJeton('inv-');
    var duree = Math.max(0, +opts.expireDansMs || 0) || (24 * 3600 * 1000);
    etat.invitations.set(jeton, {
      expire: heure + duree,
      usagesMax: Math.max(1, (opts.usagesMax | 0) || 1),
      usages: 0,
      email: opts.email ? String(opts.email).trim().toLowerCase() : null,
      revoque: false,
      cree: heure, creePar: auteur,
    });
    journaliser(etat, { auteur: auteur, action: 'invitation_creee', cible: jeton, heure: heure });
    return { ok: true, token: jeton };
  }
  function revoquerInvitation(etat, jeton, auteur, heure) {
    var inv = etat.invitations.get(jeton);
    if (!inv) return { ok: false, motif: 'introuvable' };
    inv.revoque = true;
    journaliser(etat, { auteur: auteur, action: 'invitation_revoquee', cible: jeton, heure: heure });
    return { ok: true };
  }
  /* Consomme UN usage. Un lien valide fait entrer même en liste blanche
     activée (SPEC-ADMIN-005) : c'est la porte d'entrée que l'administrateur
     ouvre lui-même, elle prime donc sur la restriction générale. */
  function consommerInvitation(etat, jeton, heure) {
    if (!jeton) return { ok: false, motif: 'absent' };
    var inv = etat.invitations.get(jeton);
    if (!inv) return { ok: false, motif: 'introuvable' };
    if (inv.revoque) return { ok: false, motif: 'revoquee' };
    if (heure > inv.expire) return { ok: false, motif: 'expiree' };
    if (inv.usages >= inv.usagesMax) return { ok: false, motif: 'epuisee' };
    inv.usages++;
    return { ok: true, email: inv.email };
  }

  // ── entrée d'un joueur (SPEC-ADMIN-004) ─────────────────────────────────────
  /* Décide si un joueur peut rejoindre. Ne modifie rien d'autre que
     l'invitation (son usage) : les sessions et le journal sont ouverts par
     l'appelant une fois la décision favorable. */
  function peutEntrer(etat, opts, heure) {
    opts = opts || {};
    var nom = opts.nom, email = opts.email, jeton = opts.invitation;
    if (estListeNoire(etat, nom, email)) return { ok: false, motif: 'liste_noire' };
    var s = estBanni(etat, nom, heure);
    if (s.ok === false) return s;
    if (jeton) {
      var r = consommerInvitation(etat, jeton, heure);
      if (!r.ok) return { ok: false, motif: 'invitation_' + r.motif };
      return { ok: true, viaInvitation: true, emailInvitation: r.email };
    }
    if (etat.emailObligatoire && !email) return { ok: false, motif: 'email_requis' };
    if (etat.listeBlancheActive && !estListeBlanche(etat, nom, email)) return { ok: false, motif: 'liste_blanche' };
    return { ok: true };
  }

  // ── sessions (SPEC-ADMIN-003) ───────────────────────────────────────────────
  var compteurSession = 0;
  function ouvrirSession(etat, opts, heure) {
    var s = { id: 's' + (++compteurSession), nom: opts.nom, ip: opts.ip,
              connecteLe: heure, deconnecteLe: null };
    etat.sessions.push(s);
    etat.sessionsOuvertes.set(s.id, s);
    return s.id;
  }
  function fermerSession(etat, id, heure) {
    var s = etat.sessionsOuvertes.get(id);
    if (!s) return false;
    s.deconnecteLe = heure;
    etat.sessionsOuvertes.delete(id);
    return true;
  }
  function historiqueSessions(etat, nom) {
    if (!nom) return etat.sessions.slice();
    var cle = canon(nom);
    return etat.sessions.filter(function (s) { return canon(s.nom) === cle; });
  }

  // ── sanctions (SPEC-ADMIN-008) ──────────────────────────────────────────────
  function sanctionDe(etat, nom) {
    var cle = canon(nom);
    var s = etat.sanctions.get(cle);
    if (!s) { s = { sourdineJusque: 0, banniJusque: 0, avertissements: 0 }; etat.sanctions.set(cle, s); }
    return s;
  }
  function estBanni(etat, nom, heure) {
    var s = etat.sanctions.get(canon(nom));
    if (s && s.banniJusque && heure < s.banniJusque) {
      return { ok: false, motif: 'bannissement', jusque: s.banniJusque };
    }
    return { ok: true };
  }
  function estSourdine(etat, nom, heure) {
    var s = etat.sanctions.get(canon(nom));
    return !!(s && s.sourdineJusque && heure < s.sourdineJusque);
  }

  /* `type` : avertir | sourdine | expulser | bannir | liste_noire.
     Le contrôle des permissions (qui a le droit de sanctionner qui) est fait
     par `peutAgir` AVANT cet appel — cette fonction applique, elle ne juge pas
     à nouveau les rôles, mais refuse toujours qu'un acteur se sanctionne
     lui-même par erreur d'appel. */
  function sanctionner(etat, opts, heure) {
    opts = opts || {};
    var nom = opts.nom, type = opts.type, auteur = opts.auteur;
    if (canon(nom) === canon(auteur)) return { ok: false, motif: 'soi_meme' };
    var s = sanctionDe(etat, nom);
    var duree = Math.max(0, +opts.dureeMs || 0);
    switch (type) {
      case 'avertir': s.avertissements++; break;
      case 'sourdine': s.sourdineJusque = heure + (duree || 5 * 60 * 1000); break;
      case 'expulser': break;                          // pas d'état : le serveur ferme la socket
      case 'bannir':
        // un modérateur ne bannit que temporairement : durée obligatoire, fournie par l'appelant
        s.banniJusque = duree ? heure + duree : Infinity;
        break;
      case 'liste_noire':
        etat.listeNoireNoms.add(canon(nom));
        break;
      default:
        return { ok: false, motif: 'type_invalide' };
    }
    journaliser(etat, { auteur: auteur, action: 'sanction_' + type, cible: nom, details: duree || null, heure: heure });
    return { ok: true };
  }

  // ── journal (SPEC-ADMIN-002 / 007) ──────────────────────────────────────────
  var JOURNAL_MAX = 2000;
  function journaliser(etat, entree) {
    etat.journal.push({
      ts: entree.heure || 0, auteur: entree.auteur || null, action: entree.action,
      cible: entree.cible !== undefined ? entree.cible : null,
      details: entree.details !== undefined ? entree.details : null,
    });
    if (etat.journal.length > JOURNAL_MAX) etat.journal.splice(0, etat.journal.length - JOURNAL_MAX);
  }

  // ── vues filtrées par rôle (SPEC-ADMIN-007) ─────────────────────────────────
  /* Un modérateur ne voit jamais IP ni e-mail — ni dans la liste des joueurs,
     ni dans les sessions, ni dans les listes. Centraliser le filtrage ici
     évite qu'une route serveur oublie de le faire pour un nouveau champ. */
  function vueJoueurs(etat, joueursLive, role) {
    return joueursLive.map(function (j) {
      var v = { nom: j.nom, x: j.x, y: j.y, z: j.z, connecteLe: j.connecteLe, role: roleDe(etat, j.nom) };
      if (role === ROLES.ADMIN) v.ip = j.ip;
      return v;
    });
  }
  function vueSessions(etat, nom, role) {
    return historiqueSessions(etat, nom).map(function (s) {
      var v = { nom: s.nom, connecteLe: s.connecteLe, deconnecteLe: s.deconnecteLe };
      if (role === ROLES.ADMIN) v.ip = s.ip;
      return v;
    });
  }
  function vueListes(etat, role) {
    var v = { blancheActive: etat.listeBlancheActive, blancheNoms: Array.from(etat.listeBlancheNoms),
              noireNoms: Array.from(etat.listeNoireNoms) };
    if (role === ROLES.ADMIN) {
      v.blancheEmails = Array.from(etat.listeBlancheEmails);
      v.noireEmails = Array.from(etat.listeNoireEmails);
      v.invitations = Array.from(etat.invitations.entries()).map(function (e) {
        return Object.assign({ token: e[0] }, e[1]);
      });
    }
    return v;
  }
  function vueJournal(etat, role, limite) {
    var l = etat.journal.slice(-Math.max(1, limite || 200));
    if (role === ROLES.ADMIN) return l;
    // un modérateur voit les actions, jamais une IP ou un e-mail glissé en détail
    return l.map(function (e) {
      var d = e.details;
      if (typeof d === 'string' && (d.indexOf('@') >= 0 || /\d+\.\d+\.\d+\.\d+/.test(d))) d = '(masqué)';
      return { ts: e.ts, auteur: e.auteur, action: e.action, cible: e.cible, details: d };
    });
  }

  // ── persistance (SPEC-SERVEUR-001) ──────────────────────────────────────────
  /* Rôles, listes, invitations, sessions, sanctions et journal survivent à un
     redémarrage — sans quoi bannir quelqu'un ne durerait que jusqu'au prochain
     arrêt du serveur. Le mot de passe administrateur N'EST PAS repris : il
     vient toujours du lancement courant (--admin), jamais d'un fichier. */
  function serialiser(etat) {
    return {
      v: 1,
      listeBlancheActive: etat.listeBlancheActive,
      emailObligatoire: etat.emailObligatoire,
      listeBlancheNoms: Array.from(etat.listeBlancheNoms),
      listeBlancheEmails: Array.from(etat.listeBlancheEmails),
      listeNoireNoms: Array.from(etat.listeNoireNoms),
      listeNoireEmails: Array.from(etat.listeNoireEmails),
      roles: Array.from(etat.roles.entries()),
      invitations: Array.from(etat.invitations.entries()),
      sessions: etat.sessions,
      sanctions: Array.from(etat.sanctions.entries()),
      journal: etat.journal,
    };
  }
  function appliquer(etat, data) {
    if (!data || data.v !== 1) return false;
    // listeBlancheActive et emailObligatoire sont des RÉGLAGES DE LANCEMENT
    // (--liste-blanche, à venir pour l'e-mail) : ils viennent de la ligne de
    // commande courante, jamais d'un fichier — sinon relancer sans
    // --liste-blanche ne suffirait pas à la désactiver.
    etat.listeBlancheNoms = new Set(data.listeBlancheNoms || []);
    etat.listeBlancheEmails = new Set(data.listeBlancheEmails || []);
    etat.listeNoireNoms = new Set(data.listeNoireNoms || []);
    etat.listeNoireEmails = new Set(data.listeNoireEmails || []);
    etat.roles = new Map(data.roles || []);
    etat.invitations = new Map(data.invitations || []);
    etat.sessions = data.sessions || [];
    // toute session encore « ouverte » au moment de l'arrêt est reprise fermée :
    // le processus qui l'avait ouverte n'existe plus pour la clore proprement
    etat.sessionsOuvertes = new Map();
    etat.sanctions = new Map(data.sanctions || []);
    etat.journal = data.journal || [];
    return true;
  }

  MC.Admin = {
    ROLES: ROLES,
    egaliteConstante: egaliteConstante,
    canon: canon,
    nouveauJeton: nouveauJeton,
    creerEtat: creerEtat,
    authentifier: authentifier,
    roleDe: roleDe,
    noterAdminConnu: noterAdminConnu,
    nommerRole: nommerRole,
    peutAgir: peutAgir,
    ajouterListe: ajouterListe,
    retirerListe: retirerListe,
    estListeNoire: estListeNoire,
    estListeBlanche: estListeBlanche,
    creerInvitation: creerInvitation,
    revoquerInvitation: revoquerInvitation,
    consommerInvitation: consommerInvitation,
    peutEntrer: peutEntrer,
    ouvrirSession: ouvrirSession,
    fermerSession: fermerSession,
    historiqueSessions: historiqueSessions,
    sanctionDe: sanctionDe,
    estBanni: estBanni,
    estSourdine: estSourdine,
    sanctionner: sanctionner,
    journaliser: journaliser,
    vueJoueurs: vueJoueurs,
    vueSessions: vueSessions,
    vueListes: vueListes,
    vueJournal: vueJournal,
    serialiser: serialiser,
    appliquer: appliquer,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
