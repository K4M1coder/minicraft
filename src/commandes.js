/* commandes.js — commandes du chat (SPEC-CMD-001). Logique pure : ce module ne
   fait AUCUN effet — il traduit une commande déjà analysée par
   MC.Chat.parseCommande en messages à afficher et en actions à appliquer par
   l'appelant (game.js). `ctx` est un contexte injecté :
     { temps, dureeJour, graine, position:{x,y,z}, meteo, succes, enLigne, joueurs }
   `meteo` est { nom, vent:{force}, temperature } ou null.
   `succes` est le suivi rendu par MC.Succes.creer() (ou équivalent : au moins
   `debloques()`), ou null/undefined si indisponible.
   `joueurs` est la liste des noms des autres joueurs en ligne. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  /* Registre unique des commandes (SPEC-CMD-005) : il alimente /list, /help,
     /<commande> help et /aide, et LISTE en est dérivée. Chaque entrée :
       nom (principal), alias[], usage, resume, details (description plus
       longue), sousCommandes[] (une ligne chacune, pour /admin, /faction et
       /duel), exemples[], disponibilite : 'toujours' | 'en ligne' | 'admin'.
     Toute commande ajoutée à `executer` doit y figurer (test de garde). Chaque
     message produit tient dans MC.Chat.MAX_LONGUEUR (160) caractères. */
  var REGISTRE = [
    { nom: 'help', alias: ['aide'], usage: '/help [commande]',
      resume: 'Aide d\'une commande, ou résumé de toutes',
      details: 'Sans argument, résume toutes les commandes. Avec un nom (avec ou sans /, alias admis), détaille cette commande.',
      sousCommandes: [], exemples: ['/help duel', '/help /faction'], disponibilite: 'toujours' },
    { nom: 'list', alias: ['liste', 'commandes'], usage: '/list',
      resume: 'Liste toutes les commandes disponibles',
      details: 'Affiche une ligne par commande du jeu : usage, résumé et, le cas échéant, sa disponibilité.',
      sousCommandes: [], exemples: ['/list'], disponibilite: 'toujours' },
    { nom: 'heure', alias: [], usage: '/heure',
      resume: 'Donne l\'heure, jour ou nuit, et la saison',
      details: 'Indique l\'heure du monde, s\'il fait jour ou nuit, puis la saison, le jour de l\'année et l\'an.',
      sousCommandes: [], exemples: ['/heure'], disponibilite: 'toujours' },
    { nom: 'jour', alias: [], usage: '/jour',
      resume: 'Demande au serveur de lever le jour',
      details: 'Demande au serveur de ramener l\'heure à l\'aube. Il n\'accepte qu\'en mode créatif ou pour un administrateur.',
      sousCommandes: [], exemples: ['/jour'], disponibilite: 'toujours' },
    { nom: 'nuit', alias: [], usage: '/nuit',
      resume: 'Demande au serveur de faire tomber la nuit',
      details: 'Demande au serveur de passer l\'heure à la nuit. Il n\'accepte qu\'en mode créatif ou pour un administrateur.',
      sousCommandes: [], exemples: ['/nuit'], disponibilite: 'toujours' },
    { nom: 'ou', alias: ['pos'], usage: '/ou',
      resume: 'Donne votre position (x / y / z)',
      details: 'Affiche vos coordonnées exactes dans le monde, à un dixième de bloc près.',
      sousCommandes: [], exemples: ['/ou', '/pos'], disponibilite: 'toujours' },
    { nom: 'graine', alias: [], usage: '/graine',
      resume: 'Donne la graine du monde',
      details: 'Affiche la graine qui a généré ce monde : la même graine redonne le même monde.',
      sousCommandes: [], exemples: ['/graine'], disponibilite: 'toujours' },
    { nom: 'vider', alias: [], usage: '/vider',
      resume: 'Vide la fenêtre de discussion',
      details: 'Efface les messages affichés dans le chat. Rien d\'autre n\'est modifié.',
      sousCommandes: [], exemples: ['/vider'], disponibilite: 'toujours' },
    { nom: 'rejoindre', alias: [], usage: '/rejoindre [adresse]',
      resume: 'Se connecte à un serveur',
      details: 'Se connecte à l\'adresse donnée (nom ou IP, port éventuel), sinon au serveur local. Un hôte nommé help ou aide se joint par son adresse complète.',
      sousCommandes: [], exemples: ['/rejoindre', '/rejoindre exemple.fr:8080'], disponibilite: 'toujours' },
    { nom: 'quitter', alias: [], usage: '/quitter',
      resume: 'Se déconnecte du serveur',
      details: 'Quitte le serveur courant et revient à une partie en solo.',
      sousCommandes: [], exemples: ['/quitter'], disponibilite: 'toujours' },
    { nom: 'qui', alias: [], usage: '/qui',
      resume: 'Liste les joueurs en ligne',
      details: 'Affiche les noms des autres joueurs connectés au serveur. Hors ligne, répond « Hors ligne. ».',
      sousCommandes: [], exemples: ['/qui'], disponibilite: 'en ligne' },
    { nom: 'meteo', alias: [], usage: '/meteo',
      resume: 'Décrit le temps, la température et le vent',
      details: 'Affiche le temps qu\'il fait, la température à votre position (en °C) et la force du vent.',
      sousCommandes: [], exemples: ['/meteo'], disponibilite: 'toujours' },
    { nom: 'succes', alias: [], usage: '/succes',
      resume: 'Compte les succès débloqués',
      details: 'Affiche le nombre de succès débloqués sur le total existant.',
      sousCommandes: [], exemples: ['/succes'], disponibilite: 'toujours' },
    { nom: 'rendu', alias: [], usage: '/rendu [realiste|simple]',
      resume: 'Règle le rendu lointain',
      details: 'Sans argument, indique le rendu actuel. « realiste » active arbres, silhouettes, ombrage et voile d\'air au loin ; « simple » est plus sobre.',
      sousCommandes: [], exemples: ['/rendu', '/rendu simple'], disponibilite: 'toujours' },
    { nom: 'admin', alias: [], usage: '/admin <sous-commande>',
      resume: 'Panneau d\'administration du serveur',
      details: 'Traduit une demande en action réseau ; le serveur seul vérifie le rôle. Exige d\'être en ligne. Sans sous-commande, rappelle l\'usage.',
      sousCommandes: [
        '/admin auth <secret> — s\'authentifier comme administrateur',
        '/admin joueurs — joueurs connectés',
        '/admin sessions [nom] — sessions d\'un joueur ou de tous',
        '/admin inventaire <nom> — inventaire d\'un joueur',
        '/admin listes — listes blanche et noire',
        '/admin journal [n] — n dernières lignes du journal (50 par défaut)',
        '/admin liste ajouter|retirer <blanche|noire> <nom|email> <valeur> — gérer une liste',
        '/admin invitation [usagesMax] [expireMin] [email] — créer une invitation',
        '/admin invitation revoquer <jeton> — révoquer une invitation',
        '/admin role <nom> [retirer] — nommer ou retirer un modérateur',
        '/admin sanction <nom> <avertir|sourdine|expulser|bannir|liste_noire> [dureeMin] — sanctionner'],
      exemples: ['/admin auth monSecret', '/admin sanction Vilain bannir 30'], disponibilite: 'admin' },
    { nom: 'faction', alias: [], usage: '/faction [sous-commande]',
      resume: 'Factions de joueurs (le serveur arbitre)',
      details: 'Sans sous-commande, informe sur votre faction. Le serveur décide de tout ; sa réponse arrive dans le chat.',
      sousCommandes: [
        '/faction creer <nom> [couleur] [emblème] [devise…] — fonder une faction',
        '/faction postuler <faction> — demander à entrer',
        '/faction accepter|refuser <faction> <joueur> — répondre à une candidature',
        '/faction inviter <faction> <joueur> — inviter un joueur',
        '/faction rejoindre <faction> — accepter une invitation',
        '/faction quitter <faction> — quitter la faction',
        '/faction nommer <faction> <joueur> <rang> — donner un rang',
        '/faction promouvoir|retrograder|exclure <faction> <joueur> — gérer un membre',
        '/faction transmettre <faction> <joueur> — passer le commandement',
        '/faction dissoudre <faction> — dissoudre la faction',
        '/faction principale <faction> — choisir sa faction principale',
        '/faction relation <faction> <cible> <alliee|neutre|ennemie> — déclarer une relation',
        '/faction dire <texte> — parler aux membres de sa faction',
        '/faction info — informations sur sa faction'],
      exemples: ['/faction creer Loups', '/faction dire rendez-vous au col'], disponibilite: 'en ligne' },
    { nom: 'duel', alias: [], usage: '/duel <nom>|accepter|refuser',
      resume: 'Duel consenti avec un autre joueur',
      details: 'Propose un duel à un joueur, ou répond à un défi reçu. Le serveur arbitre. Un joueur nommé help ou aide ne peut pas être défié ainsi.',
      sousCommandes: [
        '/duel <nom> — proposer un duel à ce joueur',
        '/duel accepter — accepter le défi reçu',
        '/duel refuser — refuser le défi reçu'],
      exemples: ['/duel Alice', '/duel accepter'], disponibilite: 'en ligne' },
    { nom: 'quete', alias: [], usage: '/quete [lister]|accepter <id>|remettre <id>',
      resume: 'Quêtes proposées par le serveur',
      details: 'Liste les quêtes proposées et en cours, en accepte une ou la remet. Le serveur arbitre seul ; sa réponse arrive dans le chat.',
      sousCommandes: [
        '/quete lister — quêtes proposées et en cours (par défaut)',
        '/quete accepter <id> — accepter une quête proposée',
        '/quete remettre <id> — remettre une quête dont l\'objectif est atteint'],
      exemples: ['/quete lister', '/quete accepter ferme:0'], disponibilite: 'en ligne' },
  ];

  var LISTE = REGISTRE.map(function (c) { return c.nom; });

  function trouver(nom) {
    nom = String(nom || '').replace(/^\//, '').toLowerCase();
    for (var i = 0; i < REGISTRE.length; i++) {
      if (REGISTRE[i].nom === nom || REGISTRE[i].alias.indexOf(nom) >= 0) return REGISTRE[i];
    }
    return null;
  }

  function msg(texte) { return { messages: texte ? [texte] : [], actions: [] }; }
  function action(texte, act) { return { messages: texte ? [texte] : [], actions: [act] }; }

  /* Message court de /help et /aide sans argument : un seul message, généré
     depuis le registre (SPEC-CMD-001, SPEC-CMD-005). */
  function aide() {
    return 'Commandes : ' + REGISTRE.map(function (c) {
      return '/' + c.nom + (c.nom === 'help' ? ' <commande>' : '');
    }).join(' ');
  }

  function inconnue(nom) {
    var n = String(nom || '').replace(/^\//, '');
    return 'Commande inconnue : /' + (n.length > 30 ? n.slice(0, 30) + '…' : n) + ' — tapez /list';
  }

  var MENTION = { 'en ligne': ' [en ligne]', admin: ' [admin]', toujours: '' };

  /* /list (SPEC-CMD-002) : un message d'en-tête, puis un message par commande. */
  function liste() {
    var m = [REGISTRE.length + ' commandes — /help <commande> pour le détail'];
    REGISTRE.forEach(function (c) {
      m.push(c.usage + ' — ' + c.resume +
             (c.alias.length ? ' (alias : ' + c.alias.map(function (a) { return '/' + a; }).join(' ') + ')' : '') +
             MENTION[c.disponibilite]);
    });
    return { messages: m, actions: [] };
  }

  /* Aide détaillée d'une commande du registre (SPEC-CMD-003) : libellés fixes,
     un message par ligne. */
  function aideCommande(def) {
    var m = ['Usage : ' + def.usage, 'Description : ' + def.details];
    if (def.alias.length) m.push('Alias : ' + def.alias.map(function (a) { return '/' + a; }).join(' '));
    def.sousCommandes.forEach(function (sc) { m.push('Sous-commande : ' + sc); });
    def.exemples.forEach(function (ex) { m.push('Exemple : ' + ex); });
    if (def.disponibilite === 'admin') m.push('Disponibilité : réservée aux administrateurs (le serveur vérifie le rôle)');
    else if (def.disponibilite === 'en ligne') m.push('Disponibilité : en ligne (arbitrée par le serveur)');
    return { messages: m, actions: [] };
  }

  /* /help [commande] et /aide [commande] */
  function aideDe(args) {
    if (!args.length) return msg(aide());
    var def = trouver(args[0]);
    return def ? aideCommande(def) : msg(inconnue(args[0]));
  }

  /* Panneau admin en jeu (SPEC-ADMIN-006), exposé via le chat plutôt qu'un
     écran dédié : /admin traduit une commande texte en une action réseau,
     jamais en décision — c'est TOUJOURS le serveur qui vérifie le rôle. */
  function admin(args) {
    var sous = (args[0] || '').toLowerCase();
    var reste = args.slice(1);
    switch (sous) {
      case 'auth':
        return action('Authentification…', { type: 'admin', action: 'auth', args: { secret: reste[0] || '' } });
      case 'joueurs':
        return action('Joueurs connectés…', { type: 'admin', action: 'joueurs', args: {} });
      case 'sessions':
        return action('Sessions…', { type: 'admin', action: 'sessions', args: { nom: reste[0] || null } });
      case 'inventaire':
        return action('Inventaire…', { type: 'admin', action: 'inventaire', args: { nom: reste[0] || null } });
      case 'listes':
        return action('Listes…', { type: 'admin', action: 'listes', args: {} });
      case 'journal':
        return action('Journal…', { type: 'admin', action: 'journal', args: { limite: parseInt(reste[0], 10) || 50 } });
      case 'liste': {
        // /admin liste ajouter|retirer blanche|noire nom|email valeur
        var verbe = (reste[0] || '') === 'retirer' ? 'liste_retirer' : 'liste_ajouter';
        return action('Liste…', { type: 'admin', action: verbe,
          args: { liste: reste[1], categorie: reste[2], valeur: reste[3] } });
      }
      case 'invitation': {
        if ((reste[0] || '') === 'revoquer') {
          return action('Révocation…', { type: 'admin', action: 'invitation_revoquer', args: { token: reste[1] } });
        }
        var usagesMax = parseInt(reste[0], 10) || 1;
        var expireMin = parseInt(reste[1], 10) || (24 * 60);
        return action('Invitation…', { type: 'admin', action: 'invitation_creer',
          args: { usagesMax: usagesMax, expireDansMs: expireMin * 60000, email: reste[2] || null } });
      }
      case 'role':
        return action('Rôle…', { type: 'admin', action: 'role_nommer',
          args: { nom: reste[0], role: (reste[1] || '') === 'retirer' ? null : 'moderateur' } });
      case 'sanction':
        return action('Sanction…', { type: 'admin', action: 'sanction',
          args: { nom: reste[0], type: reste[1], dureeMs: (parseInt(reste[2], 10) || 0) * 60000 } });
      // SPEC-FACTION-013 / SPEC-ADMIN-008 : modération des factions de joueurs (admin ou modérateur)
      case 'factions':
        return action('Factions…', { type: 'admin', action: 'faction_gerer', args: { op: 'lister' } });
      case 'faction': {
        var op = (reste[0] || '').toLowerCase();
        /* Un nom de faction peut compter des espaces : `dissoudre` prend tous les mots
           (jamais le seul premier, qui viserait une AUTRE faction) ; `renommer` envoie
           aussi les mots, le serveur retenant le plus long début qui désigne une
           faction (le reste est le nouveau nom). Pour lever un doute : l'identifiant (g12) ou « _ » à la place d'un espace. */
        if (op === 'renommer' && reste[1] && reste[2]) {
          return action('Renommage de la faction…', { type: 'admin', action: 'faction_gerer',
            args: { op: 'renommer', faction: reste[1], nom: reste.slice(2).join(' '), mots: reste.slice(1) } });
        }
        if (op === 'dissoudre' && reste[1]) {
          return action('Dissolution de la faction…', { type: 'admin', action: 'faction_gerer',
            args: { op: 'dissoudre', faction: reste.slice(1).join(' '), mots: reste.slice(1) } });
        }
        return msg('/admin factions | faction renommer <faction> <nouveau nom> | faction dissoudre <faction> (un nom à espaces s’écrit tel quel, ou avec _)');
      }
      default:
        return msg('/admin auth <secret> | joueurs | sessions [nom] | inventaire <nom> | listes | journal | ' +
                   'liste ajouter|retirer <blanche|noire> <nom|email> <valeur> | ' +
                   'invitation <usagesMax> <expireMin> [email] | invitation revoquer <jeton> | ' +
                   'role <nom> [retirer] | sanction <nom> <avertir|sourdine|expulser|bannir|liste_noire> [dureeMin] | ' +
                   'factions | faction renommer|dissoudre <faction> [nouveau nom]');
    }
  }

  /* Faction de joueurs (SPEC-FACTION-009 à 012) : comme /admin, cette commande
     ne fait AUCUN effet — elle traduit en une action réseau/locale que
     l'appelant (server.js en ligne, game.js hors ligne) applique via
     MC.Guildes, qui seul détient l'état et décide qui a le droit de quoi. */
  function faction(args) {
    var r = factionSans(args);
    // la commande d'origine accompagne l'action : en ligne, le jeu la relaie au serveur
    (r.actions || []).forEach(function (a) { a.brut = args.join(' '); });
    return r;
  }
  /* Un nom de faction peut compter des espaces (« La Meute ») : la commande se lit
     par la FIN — les `nFin` derniers mots sont les autres arguments (joueur, rang…),
     tout ce qui précède est le nom de la faction. Avec trop peu de mots pour cela,
     le premier est la faction (forme à un mot). */
  function nomEtFin(reste, nFin) {
    if (reste.length > nFin) return { faction: reste.slice(0, reste.length - nFin).join(' '), fin: reste.slice(reste.length - nFin) };
    return { faction: reste[0], fin: reste.slice(1) };
  }
  var RE_COULEUR = /^#[0-9a-fA-F]{6}$/;
  function factionSans(args) {
    var sous = (args[0] || '').toLowerCase();
    var reste = args.slice(1), nf;
    switch (sous) {
      case 'creer': {
        /* /faction creer <nom…> [#couleur [emblème [devise…]]] : le nom court jusqu'à la
           couleur (#rrggbb) ; sans couleur, tous les mots sont le nom. */
        var ic = -1;
        for (var i = 1; i < reste.length && ic < 0; i++) if (RE_COULEUR.test(reste[i])) ic = i;
        return action('Création de la faction…', { type: 'faction', action: 'creer',
          args: { nom: ic < 0 ? reste.join(' ') : reste.slice(0, ic).join(' '), couleur: ic < 0 ? null : reste[ic],
                  emblem: ic < 0 ? null : (reste[ic + 1] || null), devise: ic < 0 ? '' : reste.slice(ic + 2).join(' ') } });
      }
      case 'postuler':
        return action('Candidature envoyée…', { type: 'faction', action: 'postuler', args: { faction: reste.join(' ') } });
      case 'accepter':
        nf = nomEtFin(reste, 1);
        return action('Candidature acceptée…', { type: 'faction', action: 'accepter', args: { faction: nf.faction, joueur: nf.fin[0] } });
      case 'refuser':
        nf = nomEtFin(reste, 1);
        return action('Candidature refusée…', { type: 'faction', action: 'refuser', args: { faction: nf.faction, joueur: nf.fin[0] } });
      case 'inviter':
        nf = nomEtFin(reste, 1);
        return action('Invitation envoyée…', { type: 'faction', action: 'inviter', args: { faction: nf.faction, joueur: nf.fin[0] } });
      case 'rejoindre':
        return action('Invitation acceptée…', { type: 'faction', action: 'accepterInvitation', args: { faction: reste.join(' ') } });
      case 'quitter':
        return action('Vous quittez la faction…', { type: 'faction', action: 'quitter', args: { faction: reste.join(' ') } });
      case 'nommer':
        nf = nomEtFin(reste, 2);
        return action('Rang modifié…', { type: 'faction', action: 'nommerRang',
          args: { faction: nf.faction, joueur: nf.fin[0], rang: nf.fin[1] } });
      case 'promouvoir':
        nf = nomEtFin(reste, 1);
        return action('Promotion…', { type: 'faction', action: 'promouvoir', args: { faction: nf.faction, joueur: nf.fin[0] } });
      case 'retrograder':
        nf = nomEtFin(reste, 1);
        return action('Rétrogradation…', { type: 'faction', action: 'retrograder', args: { faction: nf.faction, joueur: nf.fin[0] } });
      case 'exclure':
        nf = nomEtFin(reste, 1);
        return action('Exclusion…', { type: 'faction', action: 'exclure', args: { faction: nf.faction, joueur: nf.fin[0] } });
      case 'transmettre':
        nf = nomEtFin(reste, 1);
        return action('Transmission du commandement…', { type: 'faction', action: 'transmettre', args: { faction: nf.faction, joueur: nf.fin[0] } });
      case 'dissoudre':
        return action('Dissolution…', { type: 'faction', action: 'dissoudre', args: { faction: reste.join(' ') } });
      case 'principale':
        return action('Faction principale…', { type: 'faction', action: 'principale', args: { faction: reste.join(' ') } });
      case 'relation':
        /* la faction et la cible peuvent toutes deux compter des espaces : au-delà de trois
           mots, tous ceux qui précèdent la relation partent tels quels (`mots`) et le jeu
           (guildes.js) cherche la coupure qui donne deux désignations connues. */
        return action('Relation déclarée…', { type: 'faction', action: 'relation',
          args: { faction: reste[0], cible: reste[1], relation: reste.length > 3 ? reste[reste.length - 1] : reste[2],
                  mots: reste.length > 3 ? reste.slice(0, -1) : undefined } });
      case 'dire':
        return action('', { type: 'faction', action: 'dire', args: { texte: reste.join(' ') } });
      case 'info': case '': case undefined:
        return action('Informations de faction…', { type: 'faction', action: 'info', args: {} });
      default:
        return msg('/faction creer <nom> [#couleur [emblème [devise…]]] | postuler <faction> | ' +
                   'accepter|refuser <faction> <joueur> | inviter <faction> <joueur> | rejoindre <faction> | ' +
                   'quitter <faction> | nommer <faction> <joueur> <rang> | promouvoir|retrograder|exclure <faction> <joueur> | ' +
                   'transmettre <faction> <joueur> | dissoudre <faction> | principale <faction> | ' +
                   'relation <faction> <cible> <alliee|neutre|ennemie> | dire <texte> | info');
    }
  }

  /* Duel consenti (SPEC-PVP-005) : comme /faction et /admin, cette commande
     ne fait AUCUN effet — elle traduit en une action que l'appelant applique
     (server.js : arbitre réel via MC.PvpEnjeux ; hors ligne : message
     d'indisponibilité, pas de PvP réseau en solo, B4.md § 5). `brut`
     accompagne l'action pour que `game.js` relaie le texte original au
     serveur, comme /faction. */
  function duel(args) {
    var r = duelSans(args);
    (r.actions || []).forEach(function (a) { a.brut = args.join(' '); });
    return r;
  }
  function duelSans(args) {
    var sous = (args[0] || '').toLowerCase();
    if (sous === 'accepter') return action('Réponse envoyée…', { type: 'duel', action: 'accepter', args: {} });
    if (sous === 'refuser') return action('Réponse envoyée…', { type: 'duel', action: 'refuser', args: {} });
    if (!sous) return msg('/duel <nom> | /duel accepter | /duel refuser');
    return action('Duel proposé à ' + args[0] + '…', { type: 'duel', action: 'proposer', args: { nom: args[0] } });
  }

  /* Quêtes (SPEC-QUETE-004) : comme /duel, la commande ne décide rien — elle
     traduit en une action que game.js relaie au serveur, seul arbitre. */
  function quete(args) {
    return action('', { type: 'quete', action: (args[0] || 'lister').toLowerCase(), args: {}, brut: args.join(' ') });
  }

  function executer(cmd, ctx) {
    ctx = ctx || {};
    if (!cmd || !cmd.nom) return msg('Commande inconnue.');
    var def = trouver(cmd.nom);
    if (!def) return msg(inconnue(cmd.nom));
    var args = cmd.args || [];
    /* SPEC-CMD-004 : forme suffixée « /<commande> help|aide » — interceptée ICI,
       avant tout case, donc sans exécuter la commande ni produire d'action. */
    if (args.length && /^(help|aide)$/i.test(args[0])) return aideCommande(def);
    cmd = { nom: def.nom, args: args };      // alias résolus : le switch ne voit que les noms principaux
    var DC = MC.DayCycle;
    switch (cmd.nom) {
      case 'help':
        return aideDe(args);
      case 'list':
        return liste();
      case 'heure': {
        var t = ctx.temps || 0;
        var txt = 'Il est ' + DC.clockString(t) +
                   (DC.isNight(t) ? ' — il fait nuit' : ' — il fait jour');
        if (DC.saison) {
          var sa = DC.saison(t);
          txt += ' — ' + sa.nom + ', jour ' + sa.jour + '/' + DC.DAYS_PER_YEAR + ', an ' + sa.annee;
        }
        return msg(txt);
      }
      case 'jour':
        return action('Le jour se lève.',
          { type: 'heure', valeur: (ctx.dureeJour || DC.DAY_LENGTH) * 0.2 });
      case 'nuit':
        return action('La nuit tombe.',
          { type: 'heure', valeur: (ctx.dureeJour || DC.DAY_LENGTH) * 0.7 });
      case 'ou': {
        var p = ctx.position || { x: 0, y: 0, z: 0 };
        return msg('Vous êtes en ' + p.x.toFixed(1) + ' / ' + p.y.toFixed(1) + ' / ' + p.z.toFixed(1));
      }
      case 'graine':
        return msg('Graine du monde : ' + ctx.graine);
      case 'rejoindre': {
        var hote = (cmd.args && cmd.args[0]) || '';
        return action('Connexion' + (hote ? ' à ' + hote : ' au serveur local') + '…',
          { type: 'rejoindre', hote: hote });
      }
      case 'quitter':
        return action('Déconnecté. Partie en solo.', { type: 'quitter' });
      case 'qui': {
        if (!ctx.enLigne) return msg('Hors ligne.');
        var noms = ctx.joueurs || [];
        return msg('En ligne : vous' + (noms.length ? ', ' + noms.join(', ') : ' (seul)'));
      }
      case 'vider':
        return { messages: [], actions: [{ type: 'vider' }] };
      case 'meteo': {
        var me = ctx.meteo;
        if (!me) return msg('Météo indisponible.');
        var temp = typeof me.temperature === 'number' ? Math.round(me.temperature) + ' °C' : 'inconnue';
        var force = me.vent && typeof me.vent.force === 'number' ? me.vent.force.toFixed(1) : '0.0';
        return msg((me.nom || 'Temps inconnu') + ' — température ' + temp + ' — vent ' + force);
      }
      case 'succes': {
        var s = ctx.succes;
        var total = MC.Succes ? MC.Succes.total() : 0;
        if (!s || typeof s.debloques !== 'function') return msg('Succès indisponibles.');
        var faits = s.debloques().length;
        return msg('Succès : ' + faits + '/' + total + ' débloqué(s).');
      }
      /* /rendu realiste | simple : imposteurs d'arbres, silhouettes des lieux,
         ombrage du relief et voile d'air au loin — ou un rendu plus sobre. */
      case 'rendu': {
        var v = (cmd.args && cmd.args[0] || '').toLowerCase();
        if (v !== 'realiste' && v !== 'simple') {
          return msg('Rendu lointain : ' + (ctx.renduRealiste === false ? 'simple' : 'réaliste') + ' — /rendu realiste ou /rendu simple');
        }
        return action('Rendu lointain ' + (v === 'realiste' ? 'réaliste' : 'simple') + '.', { type: 'rendu', realiste: v === 'realiste' });
      }
      case 'admin':
        if (!ctx.enLigne) return msg('Le panneau admin exige d\'être en ligne.');
        return admin(cmd.args || []);
      case 'faction':
        return faction(cmd.args || []);
      case 'duel':
        return duel(cmd.args || []);
      case 'quete':
        return quete(cmd.args || []);
      default:
        return msg(inconnue(cmd.nom));
    }
  }

  MC.Commandes = { LISTE: LISTE, REGISTRE: REGISTRE, executer: executer, aide: aide };
})(typeof globalThis !== 'undefined' ? globalThis : this);
