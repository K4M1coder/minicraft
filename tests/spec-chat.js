/* spec-chat.js — tests des specs SPEC-CHAT-*. Le modèle de chat est pur :
   il ne connaît ni le DOM ni le réseau, ce qui le rend testable sous Node et
   réutilisable tel quel côté serveur. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var Chat = MC.Chat;

  describe('Specs — chat', { teste: 'La messagerie du jeu (historique, commandes, neutralisation) et sa réception réseau.', pourquoi: 'Le chat affiche du texte reçu d\'autrui : une neutralisation ou une troncature ratée est un risque, pas un détail.', attendu: 'les messages reçus du réseau suivent les mêmes règles que ceux tapés localement, en plus des specs SPEC-CHAT-* couvertes une à une.' }, function () {

    it('SPEC-CHAT-001 : un message envoye apparait dans l historique', function () {
      var c = Chat.creer();
      var m = c.envoyer('Alice', 'bonjour le monde');
      A.ok(m, 'message accepte');
      A.equal(c.messages.length, 1);
      A.equal(c.messages[0].texte, 'bonjour le monde');
      A.equal(c.messages[0].auteur, 'Alice');
    });

    it('SPEC-CHAT-002 : l historique est borne', function () {
      var c = Chat.creer({ max: 5 });
      for (var i = 0; i < 20; i++) c.envoyer('A', 'message ' + i);
      A.equal(c.messages.length, 5, 'taille plafonnee');
      A.equal(c.messages[4].texte, 'message 19', 'le plus recent est conserve');
      A.equal(c.messages[0].texte, 'message 15', 'les plus anciens sont oublies');
    });

    it('SPEC-CHAT-003 : un message vide ou d espaces est refuse', function () {
      var c = Chat.creer();
      A.equal(c.envoyer('A', ''), null, 'vide');
      A.equal(c.envoyer('A', '     '), null, 'espaces');
      A.equal(c.envoyer('A', String.fromCharCode(9, 10, 32)), null, 'blancs reels');
      A.equal(c.envoyer('A', null), null, 'null');
      A.equal(c.messages.length, 0, 'historique intact');
    });

    it('SPEC-CHAT-004 : un message trop long est tronque, pas rejete', function () {
      var c = Chat.creer({ maxLongueur: 20 });
      var m = c.envoyer('A', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      A.ok(m, 'accepte malgre la longueur');
      A.equal(m.texte.length, 20, 'tronque a la limite');
    });

    it('SPEC-CHAT-005 : chaque message porte auteur et horodatage', function () {
      var c = Chat.creer();
      var m = c.envoyer('Bob', 'salut');
      A.equal(m.auteur, 'Bob');
      A.ok(typeof m.t === 'number' && m.t > 0, 'horodatage numerique');
      A.ok(typeof m.id === 'number', 'identifiant de message');
    });

    it('SPEC-CHAT-006 : les messages systeme sont distingues', function () {
      var c = Chat.creer();
      c.envoyer('Bob', 'salut');
      c.systeme('Bob a rejoint la partie');
      A.equal(c.messages[0].type, 'joueur');
      A.equal(c.messages[1].type, 'systeme');
      A.equal(c.messages[1].auteur, null, 'un message systeme n a pas d auteur');
    });

    /* Le texte vient d autres joueurs en reseau : il ne doit jamais pouvoir
       injecter du balisage dans l interface. */
    it('SPEC-CHAT-007 : le texte est neutralise a l affichage', function () {
      var c = Chat.creer();
      var m = c.envoyer('A', '<script>alert(1)</script>');
      var html = Chat.echapper(m.texte);
      A.equal(html.indexOf('<script'), -1, 'aucune balise ouvrante brute');
      A.ok(html.indexOf('&lt;script&gt;') >= 0, 'balise echappee');
      A.equal(Chat.echapper('a & b'), 'a &amp; b', 'esperluette');
      A.equal(Chat.echapper('"x"'), '&quot;x&quot;', 'guillemets');
    });

    it('SPEC-CHAT-008 : les messages recents sont consultables', function () {
      var c = Chat.creer();
      for (var i = 0; i < 10; i++) c.envoyer('A', 'm' + i);
      var r = c.recents(3);
      A.equal(r.length, 3);
      A.equal(r[2].texte, 'm9', 'le dernier en fin de liste');
      A.equal(r[0].texte, 'm7');
      A.equal(c.recents(100).length, 10, 'demander plus que disponible ne plante pas');
    });

    it('SPEC-CHAT-009 : une commande est reconnue et son nom extrait', function () {
      A.ok(Chat.estCommande('/heure'), 'slash reconnu');
      A.notOk(Chat.estCommande('bonjour'), 'texte ordinaire');
      A.notOk(Chat.estCommande('/'), 'un slash seul n est pas une commande');
      var cmd = Chat.parseCommande('/donner pierre 64');
      A.equal(cmd.nom, 'donner');
      A.deep(cmd.args, ['pierre', '64']);
      A.equal(Chat.parseCommande('bonjour'), null, 'pas une commande');
    });

    it('SPEC-CHAT-010 : en saisie, les touches de deplacement sont neutralisees', function () {
      var c = Chat.creer();
      A.notOk(c.enSaisie, 'ferme au depart');
      c.ouvrir();
      A.ok(c.enSaisie, 'ouvert');
      A.ok(c.bloqueEntrees(), 'les entrees de jeu sont bloquees');
      c.fermer();
      A.notOk(c.enSaisie, 'referme');
      A.notOk(c.bloqueEntrees(), 'les entrees reprennent');
    });

    it('SPEC-CHAT-010 : valider envoie et referme, annuler ne publie rien', function () {
      var c = Chat.creer();
      c.ouvrir(); c.saisie = 'coucou';
      var m = c.valider('Moi');
      A.ok(m, 'message publie');
      A.equal(c.messages.length, 1);
      A.notOk(c.enSaisie, 'referme apres envoi');
      A.equal(c.saisie, '', 'champ vide');

      c.ouvrir(); c.saisie = 'jamais envoye';
      c.annuler();
      A.equal(c.messages.length, 1, 'rien n a ete publie');
      A.notOk(c.enSaisie, 'referme');
      A.equal(c.saisie, '', 'champ vide');
    });

    it('les messages recus du reseau entrent dans l historique', function () {
      var c = Chat.creer();
      c.recevoir({ auteur: 'Distant', texte: 'salut de loin', t: 12345, type: 'joueur' });
      A.equal(c.messages.length, 1);
      A.equal(c.messages[0].auteur, 'Distant');
      A.equal(c.messages[0].t, 12345, 'l horodatage de l emetteur est conserve');
    });

    it('un message recu du reseau est tronque et neutralise comme les autres', function () {
      var c = Chat.creer({ maxLongueur: 10 });
      var m = c.recevoir({ auteur: 'X', texte: 'aaaaaaaaaaaaaaaaaaaa' });
      A.equal(m.texte.length, 10, 'tronque meme venant du reseau');
      A.equal(c.recevoir({ auteur: 'X', texte: '   ' }), null, 'vide refuse');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
