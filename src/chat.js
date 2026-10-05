/* chat.js — modèle de messagerie. Pur : ni DOM, ni réseau.
   Le même module sert au client (affichage) et au serveur (diffusion), ce qui
   garantit que troncature et validation s'appliquent des deux côtés. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var MAX_MESSAGES = 60;
  var MAX_LONGUEUR = 160;

  /* Neutralise le texte avant insertion dans l'interface. Les messages
     arrivent d'autres joueurs par le réseau : sans cette étape, n'importe qui
     pourrait injecter du balisage dans la fenêtre des autres. */
  function echapper(txt) {
    return String(txt === null || txt === undefined ? '' : txt)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function estCommande(txt) {
    return typeof txt === 'string' && txt.charAt(0) === '/' && txt.length > 1;
  }

  function parseCommande(txt) {
    if (!estCommande(txt)) return null;
    var morceaux = txt.slice(1).trim().split(/\s+/);
    var nom = morceaux.shift();
    if (!nom) return null;
    return { nom: nom.toLowerCase(), args: morceaux };
  }

  function creer(opts) {
    opts = opts || {};
    var max = opts.max || MAX_MESSAGES;
    var maxLongueur = opts.maxLongueur || MAX_LONGUEUR;
    var horloge = opts.horloge || function () { return Date.now(); };

    var etat = {
      messages: [],
      enSaisie: false,
      saisie: '',
      nonLus: 0,
      prochainId: 1,
    };

    /* Ajoute un message déjà normalisé. Renvoie le message, ou null si le
       texte est vide après nettoyage — c'est le seul motif de rejet, la
       longueur excessive étant tronquée plutôt que refusée. */
    function pousser(auteur, texte, type, t) {
      var net = String(texte === null || texte === undefined ? '' : texte).trim();
      if (!net.length) return null;
      if (net.length > maxLongueur) net = net.slice(0, maxLongueur);
      var m = {
        id: etat.prochainId++,
        auteur: auteur === undefined ? null : auteur,
        texte: net,
        type: type || 'joueur',
        t: t === undefined ? horloge() : t,
      };
      etat.messages.push(m);
      // on borne par la fin : les plus anciens sortent
      while (etat.messages.length > max) etat.messages.shift();
      etat.nonLus++;
      return m;
    }

    function envoyer(auteur, texte) { return pousser(auteur, texte, 'joueur'); }
    function systeme(texte) { return pousser(null, texte, 'systeme'); }
    function recevoir(msg) {
      if (!msg) return null;
      return pousser(msg.auteur, msg.texte, msg.type || 'joueur', msg.t);
    }

    function recents(n) {
      var k = Math.max(0, etat.messages.length - (n || 10));
      return etat.messages.slice(k);
    }

    /* Les `base` derniers messages, étendus à toute la réponse système qui les
       termine (série ininterrompue de messages système, plafonnée à `plafond`) :
       une réponse multi-lignes (/list, /help) s'affiche en entier. */
    function recentsLot(base, plafond) {
      base = base || 8; plafond = Math.max(base, plafond || 24);
      var m = etat.messages, k = 0;
      while (k < plafond && k < m.length && m[m.length - 1 - k].type === 'systeme') k++;
      return recents(Math.max(base, k));
    }

    // ─── saisie ──────────────────────────────────────────────────────────────
    function ouvrir() { etat.enSaisie = true; etat.saisie = ''; etat.nonLus = 0; return true; }
    function fermer() { etat.enSaisie = false; etat.saisie = ''; return true; }
    function annuler() { return fermer(); }

    /* Pendant la saisie, les touches doivent alimenter le champ et non
       déplacer le joueur : sans ce verrou, taper « avance » ferait avancer. */
    function bloqueEntrees() { return etat.enSaisie; }

    function valider(auteur) {
      if (!etat.enSaisie) return null;
      var txt = etat.saisie;
      fermer();
      return envoyer(auteur, txt);
    }

    return {
      get messages() { return etat.messages; },
      get enSaisie() { return etat.enSaisie; },
      get nonLus() { return etat.nonLus; },
      get saisie() { return etat.saisie; },
      set saisie(v) { etat.saisie = String(v === null || v === undefined ? '' : v); },
      envoyer: envoyer, systeme: systeme, recevoir: recevoir, recents: recents, recentsLot: recentsLot,
      ouvrir: ouvrir, fermer: fermer, annuler: annuler, valider: valider,
      bloqueEntrees: bloqueEntrees,
      marquerLu: function () { etat.nonLus = 0; },
      vider: function () { etat.messages.length = 0; etat.nonLus = 0; },
    };
  }

  MC.Chat = {
    creer: creer, echapper: echapper, estCommande: estCommande,
    parseCommande: parseCommande,
    MAX_MESSAGES: MAX_MESSAGES, MAX_LONGUEUR: MAX_LONGUEUR,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
