/* spec-admin.js — SPEC-ADMIN-001 à 008 : rôles, listes, invitations, sessions,
   sanctions et journal d'administration. Module pur MC.Admin, testé sans
   aucune socket ni fichier — server.js n'est qu'un branchement au-dessus. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var Adm = MC.Admin;

  describe('SPEC-ADMIN — administration du serveur', function () {

    it('égalité à temps constant : compare tout, ne court-circuite pas', function () {
      A.ok(Adm.egaliteConstante('secret123', 'secret123'), 'identiques');
      A.notOk(Adm.egaliteConstante('secret123', 'secret124'), 'différence en fin de chaîne');
      A.notOk(Adm.egaliteConstante('secret', 'secretplus'), 'longueurs différentes');
      A.notOk(Adm.egaliteConstante('', ''), 'deux chaînes vides ne comptent pas comme un secret valide');
    });

    it('canon() normalise la casse et les espaces des noms', function () {
      A.equal(Adm.canon('  Alice  '), 'alice');
      A.equal(Adm.canon('ALICE'), Adm.canon('alice'));
    });

    it('nouveauJeton() produit des jetons uniques', function () {
      var a = Adm.nouveauJeton('x-'), b = Adm.nouveauJeton('x-');
      A.notEqual(a, b, 'deux jetons tirés à la suite diffèrent');
      A.ok(a.indexOf('x-') === 0, 'préfixe respecté');
    });

    // ── SPEC-ADMIN-001 : console protégée, joueurs connectés ─────────────────
    it('SPEC-ADMIN-001 : le mot de passe admin authentifie, un mauvais secret non', function () {
      var etat = Adm.creerEtat({ motDePasseAdmin: 'motdepasse' });
      A.equal(Adm.authentifier(etat, 'motdepasse').role, Adm.ROLES.ADMIN);
      A.equal(Adm.authentifier(etat, 'faux'), null, 'refuse un mauvais mot de passe');
      A.equal(Adm.authentifier(etat, ''), null, 'refuse un secret vide');
      A.equal(Adm.authentifier(etat, null), null, 'refuse une absence de secret');
    });

    it('SPEC-ADMIN-001 : vueJoueurs liste nom, position et heure de connexion', function () {
      var etat = Adm.creerEtat({ motDePasseAdmin: 'x' });
      var live = [{ nom: 'Alice', x: 1, y: 2, z: 3, ip: '10.0.0.5', connecteLe: 100 }];
      var v = Adm.vueJoueurs(etat, live, Adm.ROLES.ADMIN);
      A.equal(v[0].nom, 'Alice');
      A.equal(v[0].x, 1); A.equal(v[0].connecteLe, 100);
      A.equal(v[0].ip, '10.0.0.5', 'un administrateur voit l\'IP');
    });

    // ── SPEC-ADMIN-002 : inventaire et journal d'actions ─────────────────────
    it('SPEC-ADMIN-002 : le journal des actions est horodaté et consultable', function () {
      var etat = Adm.creerEtat({ motDePasseAdmin: 'x' });
      Adm.journaliser(etat, { auteur: 'Alice', action: 'bloc_pose', cible: '1,2,3', heure: 10 });
      var j = Adm.vueJournal(etat, Adm.ROLES.ADMIN, 10);
      A.equal(j.length, 1);
      A.equal(j[0].auteur, 'Alice');
      A.equal(j[0].action, 'bloc_pose');
      A.equal(j[0].ts, 10);
    });

    // ── SPEC-ADMIN-003 : historique des sessions, y compris joueurs partis ───
    it('SPEC-ADMIN-003 : les sessions ouvertes et fermées restent dans l\'historique', function () {
      var etat = Adm.creerEtat({});
      var id = Adm.ouvrirSession(etat, { nom: 'Bob', ip: '1.2.3.4' }, 5);
      Adm.fermerSession(etat, id, 40);
      var hist = Adm.historiqueSessions(etat, 'Bob');
      A.equal(hist.length, 1);
      A.equal(hist[0].connecteLe, 5);
      A.equal(hist[0].deconnecteLe, 40);
      // un second passage : le premier reste, même après le départ du joueur
      var id2 = Adm.ouvrirSession(etat, { nom: 'Bob', ip: '1.2.3.4' }, 100);
      A.equal(Adm.historiqueSessions(etat, 'Bob').length, 2, 'l\'historique s\'accumule');
      A.ok(Adm.fermerSession(etat, id2, 150));
      A.notOk(Adm.fermerSession(etat, 'inconnu', 200), 'fermer une session inconnue échoue proprement');
    });

    it('SPEC-ADMIN-003 / SPEC-ADMIN-007 : vueSessions masque l\'IP à un modérateur', function () {
      var etat = Adm.creerEtat({});
      Adm.ouvrirSession(etat, { nom: 'Bob', ip: '9.9.9.9' }, 1);
      var vAdmin = Adm.vueSessions(etat, 'Bob', Adm.ROLES.ADMIN);
      var vMod = Adm.vueSessions(etat, 'Bob', Adm.ROLES.MODERATEUR);
      A.equal(vAdmin[0].ip, '9.9.9.9');
      A.equal(vMod[0].ip, undefined, 'un modérateur ne voit jamais d\'IP');
    });

    // ── SPEC-ADMIN-004 : listes blanche / noire, e-mail exigé ────────────────
    it('SPEC-ADMIN-004 : un nom en liste noire est refusé', function () {
      var etat = Adm.creerEtat({});
      Adm.ajouterListe(etat, 'noire', 'nom', 'Vilain', 'admin', 1);
      A.ok(Adm.estListeNoire(etat, 'vilain', null));
      var r = Adm.peutEntrer(etat, { nom: 'Vilain' }, 10);
      A.equal(r.ok, false);
      A.equal(r.motif, 'liste_noire');
    });

    it('SPEC-ADMIN-004 : la liste blanche activée exige une inscription', function () {
      var etat = Adm.creerEtat({ listeBlancheActive: true });
      A.equal(Adm.peutEntrer(etat, { nom: 'Inconnu' }, 1).motif, 'liste_blanche');
      Adm.ajouterListe(etat, 'blanche', 'nom', 'Inconnu', 'admin', 1);
      A.ok(Adm.peutEntrer(etat, { nom: 'Inconnu' }, 1).ok, 'inscrit : entre');
      A.ok(Adm.estListeBlanche(etat, 'inconnu', null));
      Adm.retirerListe(etat, 'blanche', 'nom', 'Inconnu', 'admin', 2);
      A.notOk(Adm.peutEntrer(etat, { nom: 'Inconnu' }, 1).ok, 'retiré : refusé de nouveau');
    });

    it('SPEC-ADMIN-004 : l\'e-mail est exigé à la connexion quand le serveur l\'exige', function () {
      var etat = Adm.creerEtat({ emailObligatoire: true });
      A.equal(Adm.peutEntrer(etat, { nom: 'Alice' }, 1).motif, 'email_requis');
      A.ok(Adm.peutEntrer(etat, { nom: 'Alice', email: 'a@b.co' }, 1).ok);
    });

    it('SPEC-ADMIN-004 : liste noire par e-mail', function () {
      var etat = Adm.creerEtat({});
      Adm.ajouterListe(etat, 'noire', 'email', 'Mauvais@Exemple.com', 'admin', 1);
      A.equal(Adm.peutEntrer(etat, { nom: 'Quiconque', email: 'mauvais@exemple.com' }, 1).motif, 'liste_noire');
    });

    // ── SPEC-ADMIN-005 : invitations ──────────────────────────────────────────
    it('SPEC-ADMIN-005 : un lien d\'invitation valide fait entrer même en liste blanche', function () {
      var etat = Adm.creerEtat({ listeBlancheActive: true });
      var inv = Adm.creerInvitation(etat, { usagesMax: 2, expireDansMs: 1000 }, 'admin', 0);
      A.ok(inv.ok);
      var r1 = Adm.peutEntrer(etat, { nom: 'Nouveau', invitation: inv.token }, 100);
      A.ok(r1.ok, 'entre malgré la liste blanche');
      var r2 = Adm.peutEntrer(etat, { nom: 'Autre', invitation: inv.token }, 200);
      A.ok(r2.ok, 'second usage autorisé (usagesMax=2)');
      var r3 = Adm.peutEntrer(etat, { nom: 'Trop', invitation: inv.token }, 300);
      A.equal(r3.ok, false, 'un troisième usage est refusé : épuisée');
    });

    it('SPEC-ADMIN-005 : une invitation expirée ou révoquée est refusée', function () {
      var etat = Adm.creerEtat({});
      var inv = Adm.creerInvitation(etat, { expireDansMs: 10 }, 'admin', 0);
      A.equal(Adm.consommerInvitation(etat, inv.token, 999).motif, 'expiree');

      var inv2 = Adm.creerInvitation(etat, {}, 'admin', 0);
      Adm.revoquerInvitation(etat, inv2.token, 'admin', 5);
      A.equal(Adm.consommerInvitation(etat, inv2.token, 6).motif, 'revoquee');

      A.equal(Adm.consommerInvitation(etat, 'jeton-inexistant', 1).motif, 'introuvable');
    });

    // ── SPEC-ADMIN-006 : panneau admin en jeu, refus aux non-admins ─────────
    it('SPEC-ADMIN-006 : peutAgir refuse toute action à un joueur sans rôle', function () {
      A.notOk(Adm.peutAgir(null, 'joueurs'));
      A.ok(Adm.peutAgir(Adm.ROLES.ADMIN, 'joueurs'));
      A.ok(Adm.peutAgir(Adm.ROLES.MODERATEUR, 'joueurs'));
    });

    // ── SPEC-ADMIN-007 : confidentialité par rôle, journal des actions ──────
    it('SPEC-ADMIN-007 : IP et e-mails sont invisibles à un modérateur', function () {
      var etat = Adm.creerEtat({ motDePasseAdmin: 'x' });
      Adm.ajouterListe(etat, 'blanche', 'email', 'a@b.co', 'admin', 1);
      var vAdmin = Adm.vueListes(etat, Adm.ROLES.ADMIN);
      var vMod = Adm.vueListes(etat, Adm.ROLES.MODERATEUR);
      A.deep(vAdmin.blancheEmails, ['a@b.co']);
      A.equal(vMod.blancheEmails, undefined, 'un modérateur ne voit pas les e-mails');
      A.equal(vMod.invitations, undefined, 'ni les invitations');
      var live = [{ nom: 'Alice', x: 0, y: 0, z: 0, ip: '1.1.1.1', connecteLe: 1 }];
      A.equal(Adm.vueJoueurs(etat, live, Adm.ROLES.MODERATEUR)[0].ip, undefined);
    });

    it('SPEC-ADMIN-007 : chaque action d\'administration est journalisée avec son auteur', function () {
      var etat = Adm.creerEtat({ motDePasseAdmin: 'x' });
      Adm.ajouterListe(etat, 'noire', 'nom', 'Vilain', 'AdminA', 1);
      Adm.creerInvitation(etat, {}, 'AdminA', 2);
      Adm.nommerRole(etat, 'Modo', Adm.ROLES.MODERATEUR, 'AdminA', 3);
      var j = Adm.vueJournal(etat, Adm.ROLES.ADMIN, 100);
      A.ok(j.every(function (e) { return e.auteur === 'AdminA'; }), 'chaque entrée porte son auteur');
      A.ok(j.some(function (e) { return e.action === 'role_nomme'; }));
    });

    it('SPEC-ADMIN-007 : un e-mail ou une IP glissés en détail sont masqués au modérateur', function () {
      var etat = Adm.creerEtat({});
      Adm.journaliser(etat, { auteur: 'A', action: 'note', details: 'contact@ex.co', heure: 1 });
      var j = Adm.vueJournal(etat, Adm.ROLES.MODERATEUR, 10);
      A.equal(j[0].details, '(masqué)');
    });

    // ── SPEC-ADMIN-008 : modérateurs, droits restreints ──────────────────────
    it('SPEC-ADMIN-008 : un modérateur ne crée pas d\'invitation ni ne gère les listes/rôles', function () {
      A.notOk(Adm.peutAgir(Adm.ROLES.MODERATEUR, 'invitation_creer'));
      A.notOk(Adm.peutAgir(Adm.ROLES.MODERATEUR, 'liste_ajouter'));
      A.notOk(Adm.peutAgir(Adm.ROLES.MODERATEUR, 'role_nommer'));
      A.notOk(Adm.peutAgir(Adm.ROLES.MODERATEUR, 'reglages'));
      A.ok(Adm.peutAgir(Adm.ROLES.ADMIN, 'invitation_creer'));
      A.ok(Adm.peutAgir(Adm.ROLES.ADMIN, 'role_nommer'));
    });

    it('SPEC-ADMIN-008 : noterAdminConnu protège aussi le pseudo d\'un administrateur connecté', function () {
      var etat = Adm.creerEtat({ motDePasseAdmin: 'x' });
      A.equal(Adm.roleDe(etat, 'AdminAlice'), null, 'encore inconnu');
      Adm.noterAdminConnu(etat, 'AdminAlice');
      A.equal(Adm.roleDe(etat, 'AdminAlice'), Adm.ROLES.ADMIN);
      A.notOk(Adm.peutAgir(Adm.ROLES.MODERATEUR, 'sanction', Adm.roleDe(etat, 'AdminAlice')),
              'un modérateur ne sanctionne pas ce pseudo une fois identifié comme admin');
    });

    it('SPEC-ADMIN-008 : un modérateur ne peut sanctionner ni un admin ni un autre modérateur', function () {
      A.notOk(Adm.peutAgir(Adm.ROLES.MODERATEUR, 'sanction', Adm.ROLES.ADMIN));
      A.notOk(Adm.peutAgir(Adm.ROLES.MODERATEUR, 'sanction', Adm.ROLES.MODERATEUR));
      A.ok(Adm.peutAgir(Adm.ROLES.MODERATEUR, 'sanction', null), 'un joueur ordinaire reste sanctionnable');
      A.ok(Adm.peutAgir(Adm.ROLES.ADMIN, 'sanction', Adm.ROLES.MODERATEUR), 'un admin, lui, le peut');
    });

    it('SPEC-ADMIN-008 : nommerRole donne et retire un rôle de modérateur, jamais admin', function () {
      var etat = Adm.creerEtat({});
      var r = Adm.nommerRole(etat, 'Modo', Adm.ROLES.MODERATEUR, 'AdminA', 1);
      A.ok(r.ok);
      A.equal(Adm.roleDe(etat, 'Modo'), Adm.ROLES.MODERATEUR);
      A.ok(Adm.authentifier(etat, r.jeton).role === Adm.ROLES.MODERATEUR, 'le jeton du modérateur l\'authentifie');
      var refuse = Adm.nommerRole(etat, 'X', Adm.ROLES.ADMIN, 'AdminA', 2);
      A.equal(refuse.ok, false, 'on ne nomme jamais admin par ce chemin');
      var retire = Adm.nommerRole(etat, 'Modo', null, 'AdminA', 3);
      A.ok(retire.ok);
      A.equal(Adm.roleDe(etat, 'Modo'), null);
    });

    it('SPEC-ADMIN-008 : avertissement, sourdine, expulsion et bannissement temporaire', function () {
      var etat = Adm.creerEtat({});
      Adm.sanctionner(etat, { nom: 'Joueur', type: 'avertir', auteur: 'Modo' }, 1);
      A.equal(Adm.sanctionDe(etat, 'Joueur').avertissements, 1);

      Adm.sanctionner(etat, { nom: 'Joueur', type: 'sourdine', dureeMs: 1000, auteur: 'Modo' }, 10);
      A.ok(Adm.estSourdine(etat, 'Joueur', 500));
      A.notOk(Adm.estSourdine(etat, 'Joueur', 2000), 'la sourdine expire');

      Adm.sanctionner(etat, { nom: 'Joueur', type: 'bannir', dureeMs: 5000, auteur: 'Modo' }, 100);
      A.equal(Adm.estBanni(etat, 'Joueur', 200).ok, false, 'banni temporairement');
      A.ok(Adm.estBanni(etat, 'Joueur', 6000).ok, 'le bannissement temporaire expire');

      var soiMeme = Adm.sanctionner(etat, { nom: 'Modo', type: 'avertir', auteur: 'Modo' }, 1);
      A.equal(soiMeme.ok, false, 'on ne se sanctionne pas soi-même par erreur d\'appel');
    });

    it('SPEC-ADMIN-008 : un bannissement admin peut être permanent', function () {
      var etat = Adm.creerEtat({});
      Adm.sanctionner(etat, { nom: 'Recidiviste', type: 'bannir', auteur: 'AdminA' }, 0);
      A.equal(Adm.estBanni(etat, 'Recidiviste', 10 * 365 * 24 * 3600 * 1000).ok, false, 'toujours banni bien plus tard');
    });

    it('SPEC-ADMIN-008 : un ajout en liste noire fait partie des sanctions disponibles au modérateur', function () {
      var etat = Adm.creerEtat({});
      var r = Adm.sanctionner(etat, { nom: 'Recidiviste', type: 'liste_noire', auteur: 'Modo' }, 1);
      A.ok(r.ok);
      A.ok(Adm.estListeNoire(etat, 'Recidiviste', null));
    });

    // ── SPEC-SERVEUR-001 : l'administration survit à un redémarrage ─────────
    it('SPEC-SERVEUR-001 : serialiser()/appliquer() reprennent listes, rôles, invitations et journal', function () {
      var etat = Adm.creerEtat({ motDePasseAdmin: 'secret', listeBlancheActive: true });
      Adm.ajouterListe(etat, 'noire', 'nom', 'Vilain', 'AdminA', 1);
      Adm.nommerRole(etat, 'Modo', Adm.ROLES.MODERATEUR, 'AdminA', 2);
      Adm.creerInvitation(etat, { usagesMax: 3 }, 'AdminA', 3);
      Adm.ouvrirSession(etat, { nom: 'Bob', ip: '1.2.3.4' }, 4);

      var data = Adm.serialiser(etat);
      var repris = Adm.creerEtat({ motDePasseAdmin: 'secret' });   // le mot de passe revient du lancement, pas du fichier
      A.ok(Adm.appliquer(repris, JSON.parse(JSON.stringify(data))));

      A.ok(Adm.estListeNoire(repris, 'Vilain', null), 'liste noire reprise');
      A.equal(Adm.roleDe(repris, 'Modo'), Adm.ROLES.MODERATEUR, 'rôle repris');
      A.equal(Adm.vueListes(repris, Adm.ROLES.ADMIN).invitations.length, 1, 'invitation reprise');
      A.equal(Adm.historiqueSessions(repris, 'Bob').length, 1, 'session reprise');
      A.equal(Adm.appliquer(repris, null), false, 'des données absentes ne cassent rien');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
