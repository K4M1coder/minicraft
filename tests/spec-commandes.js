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

    it('SPEC-ADMIN-006 : /admin exige d\'être en ligne, puis traduit en action réseau', function () {
      var hors = Cmd.executer(cmd('/admin joueurs'), {});
      A.equal(hors.actions.length, 0, 'hors ligne : pas d\'action');
      A.ok(hors.messages[0].indexOf('ligne') >= 0);

      var r = Cmd.executer(cmd('/admin auth secret123'), { enLigne: true });
      A.equal(r.actions[0].type, 'admin');
      A.equal(r.actions[0].action, 'auth');
      A.equal(r.actions[0].args.secret, 'secret123');

      var joueurs = Cmd.executer(cmd('/admin joueurs'), { enLigne: true });
      A.equal(joueurs.actions[0].action, 'joueurs');

      var sanction = Cmd.executer(cmd('/admin sanction Vilain bannir 30'), { enLigne: true });
      A.equal(sanction.actions[0].action, 'sanction');
      A.equal(sanction.actions[0].args.nom, 'Vilain');
      A.equal(sanction.actions[0].args.type, 'bannir');
      A.equal(sanction.actions[0].args.dureeMs, 30 * 60000);

      var inv = Cmd.executer(cmd('/admin invitation 3 60'), { enLigne: true });
      A.equal(inv.actions[0].action, 'invitation_creer');
      A.equal(inv.actions[0].args.usagesMax, 3);
      A.equal(inv.actions[0].args.expireDansMs, 60 * 60000);

      var sansSousCommande = Cmd.executer(cmd('/admin'), { enLigne: true });
      A.ok(sansSousCommande.messages[0].indexOf('auth') >= 0, 'liste l\'usage sans sous-commande');
    });

    it('SPEC-CMD-001 : toutes les commandes de LISTE se reconnaissent', function () {
      Cmd.LISTE.forEach(function (nom) {
        var r = Cmd.executer({ nom: nom, args: [] }, { succes: S.creer() });
        A.ok(r && r.messages, nom + ' répond');
      });
    });

    /* ─── SPEC-CMD-002 à 005 : /list, /help, forme suffixée, registre unique ─── */
    var MAX = Chat.MAX_LONGUEUR;
    var fs = require('fs'), path = require('path');
    var RACINE = path.join(__dirname, '..');
    function noms() {
      var tous = [];
      Cmd.REGISTRE.forEach(function (c) { tous.push(c.nom); c.alias.forEach(function (a) { tous.push(a); }); });
      return tous;
    }
    function ctxVide() { return {}; }
    function aucuneAction(r, quoi) { A.equal(r.actions.length, 0, quoi + ' : aucune action'); }
    function tailles(r, quoi) {
      r.messages.forEach(function (m) { A.ok(m.length <= MAX, quoi + ' : ' + m.length + ' caractères > ' + MAX + ' : ' + m); });
    }

    it('SPEC-CMD-002 : /list donne une ligne par commande du registre, sans fantôme ni omission', function () {
      var r = Cmd.executer(cmd('/list'), ctxVide());
      aucuneAction(r, '/list');
      tailles(r, '/list');
      A.equal(r.messages.length, Cmd.REGISTRE.length + 1, 'un en-tête + une ligne par commande');
      A.ok(r.messages[0].indexOf(String(Cmd.REGISTRE.length)) === 0 && r.messages[0].indexOf('/help') > 0, 'en-tête : ' + r.messages[0]);
      Cmd.REGISTRE.forEach(function (c, i) {
        var ligne = r.messages[i + 1];
        A.ok(ligne.indexOf(c.usage) === 0, '/' + c.nom + ' : ligne commençant par son usage : ' + ligne);
        A.ok(ligne.indexOf(c.resume) > 0, '/' + c.nom + ' : le résumé figure : ' + ligne);
        c.alias.forEach(function (a) { A.ok(ligne.indexOf('/' + a) > 0, '/' + c.nom + ' : alias /' + a + ' cité'); });
      });
      A.ok(/\[admin\]/.test(r.messages.filter(function (m) { return m.indexOf('/admin ') === 0; })[0]), '/admin signalée « admin »');
      ['/qui', '/faction', '/duel'].forEach(function (n) {
        var l = r.messages.filter(function (m) { return m.indexOf(n + ' ') === 0 || m === n; })[0];
        A.ok(/\[en ligne\]/.test(l), n + ' signalée « en ligne » : ' + l);
      });
      A.ok(!/\[/.test(r.messages.filter(function (m) { return m.indexOf('/heure') === 0; })[0]), '/heure n\'a aucune mention');
    });

    it('SPEC-CMD-002 : /liste et /commandes sont des alias de /list, hors ligne comme en ligne', function () {
      var ref = Cmd.executer(cmd('/list'), ctxVide());
      ['/liste', '/commandes', '/LIST'].forEach(function (t) {
        A.deep(Cmd.executer(cmd(t), ctxVide()), ref, t + ' = /list');
        A.deep(Cmd.executer(cmd(t), { enLigne: true }), ref, t + ' en ligne = /list');
        A.deep(Cmd.executer(cmd(t), { enLigne: false }), ref, t + ' hors ligne = /list');
      });
    });

    it('SPEC-CMD-003 : /help X donne usage, description, alias, sous-commandes et exemple, en messages de 160 caractères au plus', function () {
      Cmd.REGISTRE.forEach(function (c) {
        var r = Cmd.executer(cmd('/help ' + c.nom), ctxVide());
        aucuneAction(r, '/help ' + c.nom);
        tailles(r, '/help ' + c.nom);
        A.ok(r.messages[0].indexOf('Usage : ' + c.usage) === 0, c.nom + ' : « Usage : » en tête');
        A.ok(r.messages[1].indexOf('Description : ') === 0, c.nom + ' : « Description : » ensuite');
        A.equal(r.messages.filter(function (m) { return m.indexOf('Alias : ') === 0; }).length, c.alias.length ? 1 : 0, c.nom + ' : « Alias : » seulement s\'il y en a');
        A.equal(r.messages.filter(function (m) { return m.indexOf('Sous-commande : ') === 0; }).length, c.sousCommandes.length, c.nom + ' : une ligne par sous-commande');
        A.ok(r.messages.filter(function (m) { return m.indexOf('Exemple : ') === 0; }).length >= 1, c.nom + ' : au moins un exemple');
        // « Sous-commande : » = préfixe fixe ; le reste est la ligne du registre
        c.sousCommandes.forEach(function (sc) { A.ok(r.messages.indexOf('Sous-commande : ' + sc) >= 0, c.nom + ' : ' + sc); });
      });
      var fac = Cmd.executer(cmd('/help faction'), ctxVide()).messages.join('\n');
      ['creer', 'postuler', 'dissoudre', 'relation', 'dire'].forEach(function (s) { A.ok(fac.indexOf('/faction ' + s) >= 0, '/help faction cite ' + s); });
      var adm = Cmd.executer(cmd('/help admin'), ctxVide()).messages.join('\n');
      ['auth', 'joueurs', 'sanction', 'invitation'].forEach(function (s) { A.ok(adm.indexOf('/admin ' + s) >= 0, '/help admin cite ' + s); });
    });

    it('SPEC-CMD-003 : /help accepte « / » initial, toute casse et les alias ; /aide X = /help X', function () {
      Cmd.REGISTRE.forEach(function (c) {
        var ref = Cmd.executer(cmd('/help ' + c.nom), ctxVide());
        [c.nom.toUpperCase(), '/' + c.nom, '/' + c.nom.toUpperCase()].concat(c.alias, c.alias.map(function (a) { return '/' + a; })).forEach(function (x) {
          A.deep(Cmd.executer(cmd('/help ' + x), ctxVide()), ref, '/help ' + x + ' = /help ' + c.nom);
          A.deep(Cmd.executer(cmd('/aide ' + x), ctxVide()), ref, '/aide ' + x + ' = /help ' + c.nom);
        });
      });
      ['help', 'aide', 'list'].forEach(function (x) {
        A.deep(Cmd.executer(cmd('/aide ' + x), ctxVide()), Cmd.executer(cmd('/help ' + x), ctxVide()), '/aide ' + x);
      });
      var pos = Cmd.executer(cmd('/help pos'), ctxVide());
      A.ok(pos.messages[0].indexOf('Usage : /ou') === 0, 'l\'alias /pos renvoie l\'aide de /ou');
      A.ok(Cmd.executer(cmd('/help help'), ctxVide()).messages[0].indexOf('Usage : /help') === 0, '/help help donne l\'aide de /help');
    });

    it('SPEC-CMD-003 : /help et /aide sans argument gardent le message unique de SPEC-CMD-001', function () {
      ['/help', '/aide', '/HELP'].forEach(function (t) {
        var r = Cmd.executer(cmd(t), ctxVide());
        A.equal(r.messages.length, 1, t + ' : un seul message');
        A.equal(r.messages[0], Cmd.aide(), t + ' = Commandes.aide()');
        A.ok(r.messages[0].indexOf('/heure') >= 0, t + ' cite /heure');
        A.ok(r.messages[0].indexOf('/help <commande>') >= 0 && r.messages[0].indexOf('/list') >= 0, t + ' cite /help <commande> et /list');
        A.ok(r.messages[0].length <= MAX, t + ' tient dans ' + MAX + ' caractères : ' + r.messages[0].length);
        aucuneAction(r, t);
      });
    });

    it('SPEC-CMD-003 : un nom inconnu donne un seul message clair, nom tronqué à 30 caractères, sans action', function () {
      var r = Cmd.executer(cmd('/help danser'), ctxVide());
      A.equal(r.messages.length, 1);
      A.equal(r.messages[0], 'Commande inconnue : /danser — tapez /list');
      aucuneAction(r, '/help danser');
      var long = new Array(200).join('x');
      var rl = Cmd.executer(cmd('/help ' + long), ctxVide());
      A.equal(rl.messages.length, 1);
      A.ok(rl.messages[0].length <= MAX, 'nom très long : ' + rl.messages[0].length + ' caractères');
      A.ok(rl.messages[0].indexOf('tapez /list') > 0, 'le « tapez /list » survit');
      var r2 = Cmd.executer(cmd('/help duel xyz'), ctxVide());
      A.deep(r2, Cmd.executer(cmd('/help duel'), ctxVide()), 'les arguments en trop sont ignorés');
    });

    it('SPEC-CMD-004 : /<commande> help|aide (toute casse) = /help <commande>, sans action, pour tout le registre', function () {
      noms().forEach(function (n) {
        var def = Cmd.REGISTRE.filter(function (c) { return c.nom === n || c.alias.indexOf(n) >= 0; })[0];
        var ref = Cmd.executer(cmd('/help ' + def.nom), ctxVide());
        ['help', 'aide', 'HELP', 'Aide'].forEach(function (mot) {
          [ctxVide(), { enLigne: false }, { enLigne: true }].forEach(function (ctx) {
            var r = Cmd.executer(cmd('/' + n + ' ' + mot), ctx);
            A.deep(r, ref, '/' + n + ' ' + mot + ' = /help ' + def.nom);
            aucuneAction(r, '/' + n + ' ' + mot);
          });
        });
        A.deep(Cmd.executer(cmd('/' + n + ' help superflu'), ctxVide()), ref, '/' + n + ' help x : arguments en trop ignorés');
      });
    });

    it('SPEC-CMD-004 : help en premier argument n\'exécute jamais la commande (duel, rejoindre, faction, admin, vider, jour, rendu)', function () {
      ['/duel help', '/duel HELP', '/duel aide', '/rejoindre help', '/rejoindre Aide', '/faction help', '/faction aide',
       '/admin help', '/vider help', '/jour help', '/nuit help', '/rendu help', '/quitter help', '/qui help'].forEach(function (t) {
        var r = Cmd.executer(cmd(t), { enLigne: true });
        aucuneAction(r, t);
        A.ok(r.messages.length > 0 && r.messages[0].indexOf('Usage : ') === 0, t + ' affiche l\'aide : ' + r.messages[0]);
      });
      // /admin help répond même hors ligne (l'interception précède le test enLigne)
      A.ok(Cmd.executer(cmd('/admin help'), { enLigne: false }).messages[0].indexOf('Usage : /admin') === 0, '/admin help hors ligne');
    });

    it('SPEC-CMD-004 : seul le PREMIER argument compte ; /duel Help2, /duel accepter help et /faction dire help se comportent comme avant', function () {
      var d = Cmd.executer(cmd('/duel Helpme'), {});
      A.equal(d.actions[0].action, 'proposer', 'un nom qui commence par help reste un défi');
      A.equal(d.actions[0].args.nom, 'Helpme');
      var da = Cmd.executer(cmd('/duel accepter help'), {});
      A.equal(da.actions[0].action, 'accepter', '/duel accepter help = accepter');
      var f = Cmd.executer(cmd('/faction dire help'), {});
      A.equal(f.actions[0].action, 'dire');
      A.equal(f.actions[0].args.texte, 'help', '/faction dire help dit « help »');
      var a = Cmd.executer(cmd('/admin auth help'), { enLigne: true });
      A.equal(a.actions[0].args.secret, 'help', '/admin auth help : le secret est « help »');
      var j = Cmd.executer(cmd('/rejoindre help:8080'), {});
      A.equal(j.actions[0].hote, 'help:8080', '/rejoindre help:8080 se connecte');
      // conséquence assumée : un joueur nommé help ne se défie pas
      A.equal(Cmd.executer(cmd('/duel Help'), {}).actions.length, 0, '/duel Help : aide, pas de défi');
    });

    it('SPEC-CMD-005 : test de garde — chaque case de executer est au registre et réciproquement', function () {
      var src = fs.readFileSync(path.join(RACINE, 'src', 'commandes.js'), 'utf8');
      var a = src.indexOf('function executer(');
      var corps = src.slice(a, src.indexOf('MC.Commandes =', a));
      var cases = [];
      corps.replace(/^ {6}case '([a-z]+)':/gm, function (_, n) { cases.push(n); return ''; });
      var principaux = Cmd.REGISTRE.map(function (c) { return c.nom; }).sort();
      A.deep(cases.slice().sort(), principaux, 'les case de executer = les noms principaux du registre');
      // comportement : aucun nom ni alias du registre n'est « inconnu », un nom absent l'est
      noms().forEach(function (n) {
        var r = Cmd.executer({ nom: n, args: [] }, { succes: S.creer() });
        A.ok(r.messages.join('').indexOf('Commande inconnue') < 0, '/' + n + ' est reconnue');
      });
      var x = Cmd.executer({ nom: 'zzzabsent', args: [] }, {});
      A.ok(x.messages[0].indexOf('Commande inconnue') === 0, 'un nom absent est inconnu');
    });

    it('SPEC-CMD-005 : chaque entrée du registre est complète et LISTE en est dérivée', function () {
      var vus = {};
      Cmd.REGISTRE.forEach(function (c) {
        A.ok(c.nom && c.usage && c.resume && c.details, c.nom + ' : nom, usage, résumé, détails');
        A.ok(c.usage.indexOf('/' + c.nom) === 0, c.nom + ' : l\'usage commence par la commande');
        A.ok(c.exemples && c.exemples.length >= 1, c.nom + ' : au moins un exemple');
        A.ok(['toujours', 'en ligne', 'admin'].indexOf(c.disponibilite) >= 0, c.nom + ' : disponibilité connue');
        A.ok(Array.isArray(c.alias) && Array.isArray(c.sousCommandes), c.nom + ' : alias et sousCommandes sont des listes');
        [c.nom].concat(c.alias).forEach(function (n) { A.ok(!vus[n], 'nom ou alias en double : ' + n); vus[n] = true; });
      });
      A.deep(Cmd.LISTE, Cmd.REGISTRE.map(function (c) { return c.nom; }), 'LISTE = noms principaux, ordre du registre, sans alias');
    });

    it('SPEC-CMD-005 : aide() est générée depuis le registre et cite chaque commande principale', function () {
      var t = Cmd.aide();
      Cmd.REGISTRE.forEach(function (c) { A.ok(t.indexOf('/' + c.nom) >= 0, 'aide() cite /' + c.nom); });
      A.ok(t.length <= MAX, 'aide() tient dans ' + MAX + ' caractères : ' + t.length);
    });

    it('SPEC-CMD-005 : /list, /help et leurs formes suffixées sont purs : zéro action, quel que soit le contexte', function () {
      ['/list', '/help', '/help duel', '/help inconnu', '/aide faction', '/duel help', '/faction help', '/admin help', '/rejoindre help'].forEach(function (t) {
        [undefined, {}, { enLigne: false }, { enLigne: true, joueurs: ['A'] }].forEach(function (ctx) {
          var r = Cmd.executer(cmd(t), ctx);
          A.equal(r.actions.length, 0, t + ' : zéro action');
          A.ok(r.messages.length >= 1, t + ' : répond');
        });
      });
    });

    it('SPEC-CMD-005 : audit statique — ni le client ni le serveur n\'ont de branche propre à /list, /help ou aux alias, rien n\'est relayé', function () {
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      var serveur = require('./source-serveur.js').sourceServeur(RACINE);
      var a = jeu.indexOf('var ACTIONS_COMMANDE');
      var table = jeu.slice(a, jeu.indexOf('};', a));
      A.ok(!/\b(help|list|aide)\b/.test(table), 'ACTIONS_COMMANDE n\'a pas de gestionnaire d\'aide');
      A.ok(/net\.envoyerChat\('\/faction '/.test(jeu) && /net\.envoyerChat\('\/duel '/.test(jeu), 'seules les actions faction et duel sont relayées');
      A.ok(!/\^\\\/(help|list|aide|liste|commandes)/.test(serveur), 'le serveur n\'intercepte ni /help ni /list');
      A.ok(!/case 'help'|case 'list'/.test(jeu) && !/case 'help'|case 'list'/.test(serveur), 'aucun case help ou list hors de commandes.js');
    });

    it('SPEC-CMD-005 : dans un bloc de commande, /list et /help ne laissent aucun effet (client et serveur ne retiennent que les actions)', function () {
      // Les deux appelants (game.js declencherBlocCommande, serveur-admin.js
      // executerBlocCommandeServeur) jettent les messages et n'appliquent que les actions :
      // il suffit donc que ces commandes n'en renvoient aucune (prouvé ci-dessus) et que
      // les appelants n'affichent rien (audit statique).
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      var corps = jeu.slice(jeu.indexOf('function declencherBlocCommande'), jeu.indexOf('Mode cauchemar'));
      A.ok(!/chat\.systeme|res\.messages/.test(corps), 'declencherBlocCommande n\'affiche aucun message');
      var adm = fs.readFileSync(path.join(RACINE, 'src', 'serveur-admin.js'), 'utf8');
      var bloc = adm.slice(adm.indexOf('function executerBlocCommandeServeur'), adm.indexOf('Fixe l\'heure DANS LE JOUR'));
      A.ok(!/res\.messages/.test(bloc), 'executerBlocCommandeServeur n\'envoie aucun message');
      ['/list', '/help duel', '/duel help', '/faction help', '/admin help'].forEach(function (t) {
        var res = Cmd.executer(cmd(t), { enLigne: true, joueurs: [] });
        A.equal(res.actions.filter(function (x) { return x.type === 'heure'; }).length, 0, t + ' ne change pas l\'heure');
        A.equal(res.actions.length, 0, t + ' : aucune action à appliquer');
      });
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
