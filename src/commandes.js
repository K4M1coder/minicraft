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
               'rejoindre', 'quitter', 'qui', 'meteo', 'succes'];

  function msg(texte) { return { messages: texte ? [texte] : [], actions: [] }; }
  function action(texte, act) { return { messages: texte ? [texte] : [], actions: [act] }; }

  function aide() {
    return 'Commandes : /heure /jour /nuit /ou /graine /vider /aide /meteo /succes ' +
           '/rejoindre [adresse] /quitter /qui';
  }

  function executer(cmd, ctx) {
    ctx = ctx || {};
    if (!cmd || !cmd.nom) return msg('Commande inconnue.');
    var DC = MC.DayCycle;
    switch (cmd.nom) {
      case 'heure': {
        var t = ctx.temps || 0;
        return msg('Il est ' + DC.clockString(t) +
                   (DC.isNight(t) ? ' — il fait nuit' : ' — il fait jour'));
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
      default:
        return msg('Commande inconnue : /' + cmd.nom);
    }
  }

  MC.Commandes = { LISTE: LISTE, executer: executer, aide: aide };
})(typeof globalThis !== 'undefined' ? globalThis : this);
