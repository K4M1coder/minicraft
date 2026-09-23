/* spec-commandes.js — tests de la spec SPEC-CMD-001. Chaque commande du chat
   fait ce qu'elle annonce : messages et actions renvoyés par MC.Commandes,
   à partir d'un contexte injecté. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var Chat = MC.Chat, Cmd = MC.Commandes, DC = MC.DayCycle, S = MC.Succes;

  function cmd(texte) { return Chat.parseCommande(texte); }

  describe('Specs — commandes du chat', function () {
    it('SPEC-CMD-001 : /aide liste les commandes', function () {
      var r = Cmd.executer(cmd('/aide'), {});
      A.equal(r.messages.length, 1, 'un message');
      A.ok(r.messages[0].indexOf('/heure') >= 0, 'cite /heure');
      A.equal(r.actions.length, 0, 'aucune action');
      A.equal(Cmd.aide(), r.messages[0], 'aide() renvoie le même texte');
    });

    it('SPEC-CMD-001 : /heure donne l\'heure et jour/nuit', function () {
      var rJour = Cmd.executer(cmd('/heure'), { temps: DC.DAY_LENGTH * 0.1 });
      A.ok(rJour.messages[0].indexOf('jour') >= 0, 'il fait jour : ' + rJour.messages[0]);
      var rNuit = Cmd.executer(cmd('/heure'), { temps: DC.DAY_LENGTH * 0.7 });
      A.ok(rNuit.messages[0].indexOf('nuit') >= 0, 'il fait nuit : ' + rNuit.messages[0]);
    });

    it('SPEC-CMD-001 : /jour et /nuit renvoient une action heure', function () {
      var rj = Cmd.executer(cmd('/jour'), { dureeJour: 420 });
      A.equal(rj.actions.length, 1, 'une action');
      A.equal(rj.actions[0].type, 'heure', 'type heure');
      A.close(rj.actions[0].valeur, 420 * 0.2, 0.001, 'valeur = 20% du cycle');

      var rn = Cmd.executer(cmd('/nuit'), { dureeJour: 420 });
      A.equal(rn.actions[0].type, 'heure', 'type heure');
      A.close(rn.actions[0].valeur, 420 * 0.7, 0.001, 'valeur = 70% du cycle');
    });

    it('SPEC-CMD-001 : /ou renvoie la position du joueur', function () {
      var r = Cmd.executer(cmd('/ou'), { position: { x: 1.234, y: 65, z: -8.9 } });
      A.ok(r.messages[0].indexOf('1.2') >= 0, 'x arrondi affiché : ' + r.messages[0]);
      A.ok(r.messages[0].indexOf('-8.9') >= 0, 'z affiché : ' + r.messages[0]);
    });

    it('SPEC-CMD-001 : /graine renvoie la graine du monde', function () {
      var r = Cmd.executer(cmd('/graine'), { graine: 20260921 });
      A.ok(r.messages[0].indexOf('20260921') >= 0, r.messages[0]);
    });

    it('SPEC-CMD-001 : /vider ne renvoie aucun message mais une action vider', function () {
      var r = Cmd.executer(cmd('/vider'), {});
      A.equal(r.messages.length, 0, 'pas de message');
      A.equal(r.actions.length, 1, 'une action');
      A.equal(r.actions[0].type, 'vider', 'type vider');
    });

    it('SPEC-CMD-001 : /rejoindre avec et sans adresse', function () {
      var r1 = Cmd.executer(cmd('/rejoindre'), {});
      A.equal(r1.actions[0].type, 'rejoindre', 'type rejoindre');
      A.equal(r1.actions[0].hote, '', 'hôte vide par défaut');
      A.ok(r1.messages[0].indexOf('serveur local') >= 0, r1.messages[0]);

      var r2 = Cmd.executer(cmd('/rejoindre exemple.fr'), {});
      A.equal(r2.actions[0].hote, 'exemple.fr', 'hôte transmis');
      A.ok(r2.messages[0].indexOf('exemple.fr') >= 0, r2.messages[0]);
    });

    it('SPEC-CMD-001 : /quitter renvoie une action quitter', function () {
      var r = Cmd.executer(cmd('/quitter'), {});
      A.equal(r.actions[0].type, 'quitter', 'type quitter');
      A.ok(r.messages[0].length > 0, 'un message de confirmation');
    });

    it('SPEC-CMD-001 : /qui hors ligne, puis en ligne avec des joueurs', function () {
      var rHors = Cmd.executer(cmd('/qui'), { enLigne: false });
      A.ok(rHors.messages[0].indexOf('Hors ligne') >= 0, rHors.messages[0]);

      var rSeul = Cmd.executer(cmd('/qui'), { enLigne: true, joueurs: [] });
      A.ok(rSeul.messages[0].indexOf('seul') >= 0, rSeul.messages[0]);

      var rAvec = Cmd.executer(cmd('/qui'), { enLigne: true, joueurs: ['Alice', 'Bob'] });
      A.ok(rAvec.messages[0].indexOf('Alice') >= 0 && rAvec.messages[0].indexOf('Bob') >= 0, rAvec.messages[0]);
    });

    it('SPEC-CMD-001 : /meteo décrit temps, température et vent', function () {
      var rSansMeteo = Cmd.executer(cmd('/meteo'), { meteo: null });
      A.ok(rSansMeteo.messages[0].indexOf('indisponible') >= 0, rSansMeteo.messages[0]);

      var r = Cmd.executer(cmd('/meteo'), {
        meteo: { nom: 'Pluie', vent: { force: 0.42 }, temperature: 12.6 },
      });
      A.ok(r.messages[0].indexOf('Pluie') >= 0, r.messages[0]);
      A.ok(r.messages[0].indexOf('13') >= 0, 'température arrondie : ' + r.messages[0]);
      A.ok(r.messages[0].indexOf('0.4') >= 0, 'vent affiché : ' + r.messages[0]);
    });

    it('SPEC-CMD-001 : /succes compte les débloqués sur le total', function () {
      var suivi = S.creer();
      suivi.signaler({ type: 'casser', bloc: MC.Core.B.STONE });
      var r = Cmd.executer(cmd('/succes'), { succes: suivi });
      A.ok(r.messages[0].indexOf('1/' + S.total()) >= 0, r.messages[0]);

      var rSans = Cmd.executer(cmd('/succes'), {});
      A.ok(rSans.messages[0].indexOf('indisponibles') >= 0, rSans.messages[0]);
    });

    it('SPEC-CMD-001 : une commande inconnue renvoie un message d\'erreur clair', function () {
      var r = Cmd.executer(cmd('/danser'), {});
      A.ok(r.messages[0].indexOf('inconnue') >= 0, r.messages[0]);
      A.ok(r.messages[0].indexOf('danser') >= 0, r.messages[0]);
      A.equal(r.actions.length, 0, 'aucune action pour une commande inconnue');
    });

    it('SPEC-CMD-001 : toutes les commandes de LISTE se reconnaissent', function () {
      Cmd.LISTE.forEach(function (nom) {
        var r = Cmd.executer({ nom: nom, args: [] }, { succes: S.creer() });
        A.ok(r && r.messages, nom + ' répond');
      });
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
