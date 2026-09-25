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

  var LISTE = ['aide', 'heure', 'jour', 'nuit', 'ou', 'graine', 'vider',
               'rejoindre', 'quitter', 'qui', 'meteo', 'succes', 'rendu', 'admin', 'faction', 'duel'];

  function msg(texte) { return { messages: texte ? [texte] : [], actions: [] }; }
  function action(texte, act) { return { messages: texte ? [texte] : [], actions: [act] }; }

  function aide() {
    return 'Commandes : /heure /jour /nuit /ou /graine /vider /aide /meteo /succes ' +
           '/rendu [realiste|simple] /rejoindre [adresse] /quitter /qui /admin /faction … /duel <nom>|accepter|refuser';
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
      default:
        return msg('/admin auth <secret> | joueurs | sessions [nom] | inventaire <nom> | listes | journal | ' +
                   'liste ajouter|retirer <blanche|noire> <nom|email> <valeur> | ' +
                   'invitation <usagesMax> <expireMin> [email] | invitation revoquer <jeton> | ' +
                   'role <nom> [retirer] | sanction <nom> <avertir|sourdine|expulser|bannir|liste_noire> [dureeMin]');
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
  function factionSans(args) {
    var sous = (args[0] || '').toLowerCase();
    var reste = args.slice(1);
    switch (sous) {
      case 'creer':
        return action('Création de la faction…', { type: 'faction', action: 'creer',
          args: { nom: reste[0], couleur: reste[1] || null, emblem: reste[2] || null, devise: reste.slice(3).join(' ') || '' } });
      case 'postuler':
        return action('Candidature envoyée…', { type: 'faction', action: 'postuler', args: { faction: reste[0] } });
      case 'accepter':
        return action('Candidature acceptée…', { type: 'faction', action: 'accepter', args: { faction: reste[0], joueur: reste[1] } });
      case 'refuser':
        return action('Candidature refusée…', { type: 'faction', action: 'refuser', args: { faction: reste[0], joueur: reste[1] } });
      case 'inviter':
        return action('Invitation envoyée…', { type: 'faction', action: 'inviter', args: { faction: reste[0], joueur: reste[1] } });
      case 'rejoindre':
        return action('Invitation acceptée…', { type: 'faction', action: 'accepterInvitation', args: { faction: reste[0] } });
      case 'quitter':
        return action('Vous quittez la faction…', { type: 'faction', action: 'quitter', args: { faction: reste[0] } });
      case 'nommer':
        return action('Rang modifié…', { type: 'faction', action: 'nommerRang',
          args: { faction: reste[0], joueur: reste[1], rang: reste[2] } });
      case 'promouvoir':
        return action('Promotion…', { type: 'faction', action: 'promouvoir', args: { faction: reste[0], joueur: reste[1] } });
      case 'retrograder':
        return action('Rétrogradation…', { type: 'faction', action: 'retrograder', args: { faction: reste[0], joueur: reste[1] } });
      case 'exclure':
        return action('Exclusion…', { type: 'faction', action: 'exclure', args: { faction: reste[0], joueur: reste[1] } });
      case 'transmettre':
        return action('Transmission du commandement…', { type: 'faction', action: 'transmettre', args: { faction: reste[0], joueur: reste[1] } });
      case 'dissoudre':
        return action('Dissolution…', { type: 'faction', action: 'dissoudre', args: { faction: reste[0] } });
      case 'principale':
        return action('Faction principale…', { type: 'faction', action: 'principale', args: { faction: reste[0] } });
      case 'relation':
        return action('Relation déclarée…', { type: 'faction', action: 'relation',
          args: { faction: reste[0], cible: reste[1], relation: reste[2] } });
      case 'dire':
        return action('', { type: 'faction', action: 'dire', args: { texte: reste.join(' ') } });
      case 'info': case '': case undefined:
        return action('Informations de faction…', { type: 'faction', action: 'info', args: {} });
      default:
        return msg('/faction creer <nom> [couleur] [emblème] [devise…] | postuler <faction> | ' +
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

  function executer(cmd, ctx) {
    ctx = ctx || {};
    if (!cmd || !cmd.nom) return msg('Commande inconnue.');
    var DC = MC.DayCycle;
    switch (cmd.nom) {
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
      case 'ou':
      case 'pos': {
        var p = ctx.position || { x: 0, y: 0, z: 0 };
        return msg('Vous êtes en ' + p.x.toFixed(1) + ' / ' + p.y.toFixed(1) + ' / ' + p.z.toFixed(1));
      }
      case 'graine':
        return msg('Graine du monde : ' + ctx.graine);
      case 'aide':
        return msg(aide());
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
      default:
        return msg('Commande inconnue : /' + cmd.nom);
    }
  }

  MC.Commandes = { LISTE: LISTE, executer: executer, aide: aide };
})(typeof globalThis !== 'undefined' ? globalThis : this);
