/* journal.js — MC.Journal, le journal unique du jeu (SPEC-BANC-104 à 110,
   docs/banc/historique-global.md §3.14).

   Module PUR, chargé EN PREMIER partout, identique dans le navigateur, les
   workers, Node (tests vm) et server.js : ni DOM, ni disque, ni réseau. Ce qui
   dépend de l'environnement (fichier du serveur, toast du joueur, envoi au
   serveur) est INJECTÉ sous forme de « sorties » ou de fonctions.

     var log = MC.Journal('RENDU');
     log.trace/debug/info/warn/error/fatal(message, donnees?, erreur?, options?)
       options : { joueur: 'texte lisible' }  → affiché au joueur (SPEC-BANC-107)
                 { code: 'E-SAVE-002' }       → code d'erreur stable (SPEC-BANC-108,
                                                aussi reconnu en tête du message)
                 { brut: true }               → ligne console sans préfixe (lignes
                                                de protocole du serveur : MC_PORT=…)

   Chaque entrée : horodatage, domaine, niveau, message, données, pile de
   l'erreur, contexte (joueur local, mode, test en cours) — plus code et
   texte joueur. Elle part vers chaque SORTIE dont le seuil est atteint :
   console (warn en jeu, info en développement), tampon circulaire (tous
   niveaux), puis celles qu'on ajoute (fichier du serveur, remontée au
   serveur, rapport de test).

   Deux filtres successifs :
     1. production : une entrée n'existe que si son niveau atteint le seuil
        de son DOMAINE (réglé par `niveau()`/`regler()`), à défaut le seuil
        de production du mode (debug ; trace en test) ;
     2. chaque sortie a son seuil ; la console suit aussi le réglage du
        domaine (`?journal=RENDU:debug` montre le debug de RENDU à la console).

   C'est le SEUL fichier de src/ et server.js qui touche à `console`
   (porte G16, SPEC-BANC-110). */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var NIVEAUX = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
  var RANG = { trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5, aucun: 6 };
  /* Seuils par défaut selon le mode : console et production. */
  var MODES = {
    jeu: { console: 'warn', production: 'debug' },
    dev: { console: 'info', production: 'debug' },
    test: { console: 'aucun', production: 'trace' },
    serveur: { console: 'info', production: 'debug' },
  };
  var METHODE = { trace: 'debug', debug: 'debug', info: 'info', warn: 'warn', error: 'error', fatal: 'error' };
  /* Remontée des erreurs client vers le serveur (SPEC-BANC-106) : type de
     message réseau (repris par MC.NetProtocol.MSG.JOURNAL_CLIENT) et débit
     limité, appliqué des DEUX côtés (le client n'envoie pas plus, le serveur
     n'en journalise pas plus par connexion). */
  var TYPE_REMONTEE = 'journal_client';
  var REMONTEE = { max: 5, fenetreMs: 10000, messageMax: 500, pileMax: 2000 };
  var CAPACITE_TAMPON = 2000;
  var RE_CODE = /\bE-[A-Z]+-\d{3}\b/;
  var RE_DOMAINE = /^[A-Z0-9_-]{1,24}$/;

  function rang(niveau) { return RANG[niveau] !== undefined ? RANG[niveau] : RANG.info; }
  function niveauValide(n) { return typeof n === 'string' && RANG[n] !== undefined; }
  function domaineDe(d) { return String(d || 'JEU').toUpperCase(); }

  /* Copie défensive et bornée des données structurées : une entrée ne doit
     jamais garder une référence vivante (le monde, un joueur) ni grossir sans
     limite le tampon. */
  function copieDonnees(d) {
    if (d === undefined || d === null) return null;
    if (typeof d !== 'object') return d;
    try {
      var s = JSON.stringify(d);
      if (s === undefined) return null;
      if (s.length > 4000) return { tronque: true, apercu: s.slice(0, 4000) };
      return JSON.parse(s);
    } catch (e) { return { illisible: String(e && e.message || e) }; }
  }
  function pileDe(erreur) {
    if (!erreur) return null;
    if (typeof erreur === 'string') return erreur;
    if (erreur.stack) return String(erreur.stack);
    if (erreur.message) return String(erreur.message);
    return String(erreur);
  }

  function deuxChiffres(n) { return (n < 10 ? '0' : '') + n; }
  function heureDe(t) {
    var d = new Date(t);
    var ms = d.getMilliseconds();
    return deuxChiffres(d.getHours()) + ':' + deuxChiffres(d.getMinutes()) + ':' + deuxChiffres(d.getSeconds()) +
           '.' + (ms < 10 ? '00' : ms < 100 ? '0' : '') + ms;
  }

  /* Une ligne de texte par entrée (fichier du serveur, rapport de test) :
     on y retrouve au grep le domaine, le niveau et le code d'erreur. */
  /* Le code rappelé devant le message, sauf s'il y figure déjà. */
  function prefixeCode(e) { return e.code && e.message.indexOf(e.code) < 0 ? e.code + ' ' : ''; }
  function formater(e) {
    var l = e.horodatage + ' ' + e.niveau.toUpperCase() + ' ' + e.domaine + ' ' + prefixeCode(e) + e.message;
    if (e.donnees !== null && e.donnees !== undefined) {
      try { l += ' ' + JSON.stringify(e.donnees); } catch (err) { /* illisible */ }
    }
    if (e.contexte && e.contexte.test) l += ' {test: ' + e.contexte.test + '}';
    if (e.pile) l += '\n    ' + String(e.pile).split('\n').join('\n    ');
    return l;
  }

  /* `max` autorisations par fenêtre glissante de `fenetreMs` : rend une
     fonction qui dit si l'appel courant passe. */
  function limiteur(max, fenetreMs, horloge) {
    var temps = [];
    var maintenant = horloge || function () { return Date.now(); };
    return function () {
      var t = maintenant();
      while (temps.length && t - temps[0] >= fenetreMs) temps.shift();
      if (temps.length >= max) return false;
      temps.push(t);
      return true;
    };
  }

  /* Analyse `RENDU:debug,SYNC:trace` (paramètre d'URL `?journal=`, option
     serveur `--journal`) : { ok, domaines: { RENDU: 'debug', … }, erreurs }. */
  function analyserReglage(texte) {
    var domaines = {}, erreurs = [];
    String(texte || '').split(',').forEach(function (morceau) {
      var m = morceau.trim();
      if (!m) return;
      var i = m.lastIndexOf(':');
      var d = i > 0 ? domaineDe(m.slice(0, i).trim()) : '';
      var n = i > 0 ? m.slice(i + 1).trim().toLowerCase() : '';
      if (!RE_DOMAINE.test(d) || !niveauValide(n)) { erreurs.push(m); return; }
      domaines[d] = n;
    });
    return { ok: erreurs.length === 0, domaines: domaines, erreurs: erreurs };
  }

  /* Validation d'une remontée reçue par le serveur : copie bornée, ou null. */
  function validerRemontee(msg) {
    if (!msg || typeof msg !== 'object' || msg.t !== TYPE_REMONTEE) return null;
    if (msg.niveau !== 'error' && msg.niveau !== 'fatal') return null;
    var d = typeof msg.domaine === 'string' ? msg.domaine.toUpperCase() : '';
    if (!RE_DOMAINE.test(d)) return null;
    if (typeof msg.message !== 'string' || !msg.message) return null;
    /* Une seule ligne : un client ne doit jamais pouvoir écrire une ligne à
       lui dans la sortie du serveur (un faux `MC_PORT=` lu par un lanceur). */
    var texte = msg.message.replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, REMONTEE.messageMax);
    var v = { t: TYPE_REMONTEE, niveau: msg.niveau, domaine: d, message: texte };
    if (typeof msg.code === 'string' && /^E-[A-Z]+-\d{3}$/.test(msg.code)) v.code = msg.code;
    if (typeof msg.pile === 'string' && msg.pile) v.pile = msg.pile.slice(0, REMONTEE.pileMax);
    return v;
  }

  // ─── une instance de journal ───────────────────────────────────────────────
  function creer(options) {
    options = options || {};
    var modeInitial = MODES[options.mode] ? options.mode : 'jeu';
    var etat = {
      mode: modeInitial,
      production: MODES[modeInitial].production,
      domaines: {},
      contexte: {},
      fournisseur: null,
      afficherJoueur: null,
      horloge: function () { return Date.now(); },
      cibleConsole: null,           // null : la console de l'environnement (G.console)
      formatConsole: null,
      methodeConsole: null,
      tampon: [],
      capacite: CAPACITE_TAMPON,
      enCours: 0,
    };
    var sortieConsole = {
      nom: 'console', seuil: MODES[modeInitial].console, suitDomaines: true,
      ecrire: function (e) {
        var c = etat.cibleConsole || G.console;
        if (!c) return;
        var methode = etat.methodeConsole || METHODE[e.niveau];
        var f = typeof c[methode] === 'function' ? c[methode] : c.log;
        if (typeof f !== 'function') return;
        if (etat.formatConsole) { f.call(c, etat.formatConsole(e)); return; }
        if (e.brut) { f.call(c, e.message); return; }
        var args = ['[' + e.domaine + '] ' + prefixeCode(e) + e.message];
        if (e.donnees !== null) args.push(e.donnees);
        if (e.erreurObjet) args.push(e.erreurObjet);
        f.apply(c, args);
      },
    };
    var sortieTampon = {
      nom: 'tampon', seuil: 'trace',
      ecrire: function (e) {
        etat.tampon.push(e);
        if (etat.tampon.length > etat.capacite) etat.tampon.splice(0, etat.tampon.length - etat.capacite);
      },
    };
    var sorties = [sortieConsole, sortieTampon];
    var loggers = {};

    function seuilProduction(domaine) {
      return etat.domaines[domaine] !== undefined ? etat.domaines[domaine] : etat.production;
    }
    function contexteCourant() {
      var c = {};
      Object.keys(etat.contexte).forEach(function (k) { c[k] = etat.contexte[k]; });
      if (etat.fournisseur) {
        try {
          var f = etat.fournisseur() || {};
          Object.keys(f).forEach(function (k) { if (c[k] === undefined || c[k] === null) c[k] = f[k]; });
        } catch (e) { /* un contexte illisible ne doit jamais empêcher de journaliser */ }
      }
      return c;
    }

    function emettre(domaine, niveau, message, donnees, erreur, opts) {
      if (rang(niveau) < rang(seuilProduction(domaine))) return null;
      // une sortie (ou l'affichage joueur) qui journalise à son tour ne doit pas boucler
      if (etat.enCours > 2) return null;
      opts = opts || {};
      var t = etat.horloge();
      var texte = String(message === undefined ? '' : message);
      var codeMsg = RE_CODE.exec(texte);
      var e = {
        t: t,
        horodatage: new Date(t).toISOString(),
        domaine: domaine,
        niveau: niveau,
        message: texte,
        donnees: copieDonnees(donnees),
        pile: pileDe(erreur),
        contexte: contexteCourant(),
        code: opts.code || (codeMsg ? codeMsg[0] : null),
        joueur: opts.joueur ? String(opts.joueur) : null,
        brut: !!opts.brut,
      };
      // l'objet d'erreur n'est gardé que pour la console (inspectable dans les outils) — pas énumérable
      if (erreur && typeof erreur === 'object') Object.defineProperty(e, 'erreurObjet', { value: erreur, enumerable: false });
      etat.enCours++;
      try {
        for (var i = 0; i < sorties.length; i++) {
          var s = sorties[i];
          var seuil = rang(s.seuil);
          if (s.suitDomaines && etat.domaines[domaine] !== undefined) seuil = Math.min(seuil, rang(etat.domaines[domaine]));
          if (rang(niveau) < seuil) continue;
          try { s.ecrire(e); } catch (err) { /* une sortie en panne ne fait pas tomber les autres */ }
        }
        if (e.joueur && etat.afficherJoueur) {
          try { etat.afficherJoueur(e.joueur, e); } catch (err) { /* idem */ }
        }
      } finally { etat.enCours--; }
      return e;
    }

    function journal(domaine) {
      var d = domaineDe(domaine);
      if (loggers[d]) return loggers[d];
      var l = { domaine: d };
      NIVEAUX.forEach(function (n) {
        l[n] = function (message, donnees, erreur, opts) { return emettre(d, n, message, donnees, erreur, opts); };
      });
      loggers[d] = l;
      return l;
    }

    /* Règle le journal ; rend les valeurs PRÉCÉDENTES des clés données, pour
       pouvoir les rétablir (`J.configurer(ancien)`). */
    function configurer(o) {
      o = o || {};
      var ancien = {};
      if (o.mode !== undefined) {
        ancien.mode = etat.mode; ancien.seuilConsole = sortieConsole.seuil; ancien.production = etat.production;
        if (MODES[o.mode]) { etat.mode = o.mode; sortieConsole.seuil = MODES[o.mode].console; etat.production = MODES[o.mode].production; }
      }
      if (o.seuilConsole !== undefined) { ancien.seuilConsole = sortieConsole.seuil; if (niveauValide(o.seuilConsole)) sortieConsole.seuil = o.seuilConsole; }
      if (o.production !== undefined) { ancien.production = etat.production; if (niveauValide(o.production)) etat.production = o.production; }
      if (o.afficherJoueur !== undefined) { ancien.afficherJoueur = etat.afficherJoueur; etat.afficherJoueur = typeof o.afficherJoueur === 'function' ? o.afficherJoueur : null; }
      if (o.horloge !== undefined) { ancien.horloge = etat.horloge; if (typeof o.horloge === 'function') etat.horloge = o.horloge; }
      if (o.capaciteTampon !== undefined) {
        ancien.capaciteTampon = etat.capacite;
        if (o.capaciteTampon > 0) { etat.capacite = Math.floor(o.capaciteTampon); if (etat.tampon.length > etat.capacite) etat.tampon.splice(0, etat.tampon.length - etat.capacite); }
      }
      if (o.console !== undefined) {
        var c = o.console || {};
        ancien.console = { cible: etat.cibleConsole, format: etat.formatConsole, methode: etat.methodeConsole };
        if ('cible' in c) etat.cibleConsole = c.cible || null;
        if ('format' in c) etat.formatConsole = typeof c.format === 'function' ? c.format : null;
        if ('methode' in c) etat.methodeConsole = c.methode || null;
      }
      return ancien;
    }
    function configuration() {
      var d = {};
      Object.keys(etat.domaines).forEach(function (k) { d[k] = etat.domaines[k]; });
      return { mode: etat.mode, seuilConsole: sortieConsole.seuil, production: etat.production, domaines: d,
               capaciteTampon: etat.capacite, sorties: sorties.map(function (s) { return s.nom; }) };
    }

    /* `niveau('SYNC', 'trace')` règle un domaine à chaud ; `niveau('SYNC')`
       rend son seuil effectif ; `niveau('SYNC', null)` rend le défaut. */
    function niveau(domaine, n) {
      var d = domaineDe(domaine);
      if (n === undefined) return seuilProduction(d);
      if (n === null) { delete etat.domaines[d]; return seuilProduction(d); }
      if (!niveauValide(n)) return null;
      etat.domaines[d] = n;
      return n;
    }
    function regler(texte) {
      var r = analyserReglage(texte);
      Object.keys(r.domaines).forEach(function (d) { etat.domaines[d] = r.domaines[d]; });
      return r;
    }

    function contexte(o) {
      if (o && typeof o === 'object') {
        Object.keys(o).forEach(function (k) {
          if (o[k] === null || o[k] === undefined) delete etat.contexte[k]; else etat.contexte[k] = o[k];
        });
      }
      return contexteCourant();
    }
    function fournirContexte(fn) { etat.fournisseur = typeof fn === 'function' ? fn : null; }

    function ajouterSortie(s) {
      if (!s || typeof s.ecrire !== 'function' || !s.nom) return false;
      retirerSortie(s.nom);
      if (!niveauValide(s.seuil)) s.seuil = 'info';
      sorties.push(s);
      return true;
    }
    function retirerSortie(nom) {
      if (nom === 'console' || nom === 'tampon') return false;     // les deux sorties de base restent
      var avant = sorties.length;
      sorties = sorties.filter(function (s) { return s.nom !== nom; });
      return sorties.length !== avant;
    }
    function seuilSortie(nom, seuil) {
      for (var i = 0; i < sorties.length; i++) {
        if (sorties[i].nom !== nom) continue;
        if (seuil !== undefined && niveauValide(seuil)) sorties[i].seuil = seuil;
        return sorties[i].seuil;
      }
      return null;
    }

    function tampon(filtre) {
      var f = filtre || {};
      return etat.tampon.filter(function (e) {
        if (f.domaine && e.domaine !== domaineDe(f.domaine)) return false;
        if (f.niveau && rang(e.niveau) < rang(f.niveau)) return false;
        if (f.test && (!e.contexte || e.contexte.test !== f.test)) return false;
        return true;
      });
    }
    function viderTampon() { var n = etat.tampon.length; etat.tampon = []; return n; }

    journal.configurer = configurer;
    journal.configuration = configuration;
    journal.niveau = niveau;
    journal.regler = regler;
    journal.contexte = contexte;
    journal.fournirContexte = fournirContexte;
    journal.ajouterSortie = ajouterSortie;
    journal.retirerSortie = retirerSortie;
    journal.seuilSortie = seuilSortie;
    journal.tampon = tampon;
    journal.viderTampon = viderTampon;
    // outils sans état, communs à toutes les instances
    journal.creer = creer;
    journal.formater = formater;
    journal.limiteur = limiteur;
    journal.analyserReglage = analyserReglage;
    journal.validerRemontee = validerRemontee;
    journal.sortieRemontee = sortieRemontee;
    journal.sortieCollecte = sortieCollecte;
    journal.heureDe = heureDe;
    journal.NIVEAUX = NIVEAUX;
    journal.MODES = MODES;
    journal.TYPE_REMONTEE = TYPE_REMONTEE;
    journal.REMONTEE = REMONTEE;
    return journal;
  }

  /* Sortie « remontée au serveur » (multijoueur, SPEC-BANC-106) : les
     entrées error et fatal partent par `envoyer(msg)` (net.envoyer), au plus
     `max` par fenêtre de `fenetreMs`. */
  function sortieRemontee(envoyer, opts) {
    opts = opts || {};
    var passe = limiteur(opts.max || REMONTEE.max, opts.fenetreMs || REMONTEE.fenetreMs, opts.horloge);
    return {
      nom: 'remontee', seuil: 'error',
      ecrire: function (e) {
        if (!passe()) return;
        var msg = { t: TYPE_REMONTEE, niveau: e.niveau, domaine: e.domaine, message: e.message.slice(0, REMONTEE.messageMax) };
        if (e.code) msg.code = e.code;
        if (e.pile) msg.pile = String(e.pile).slice(0, REMONTEE.pileMax);
        envoyer(msg);
      },
    };
  }

  /* Sortie qui collecte (rapport de test, SPEC-BANC-106) : `entrees` et
     `lignes()` (texte formaté, où l'on retrouve les codes au grep). */
  function sortieCollecte(nom, seuil, max) {
    var borne = max || 200;
    var s = {
      nom: nom || 'collecte', seuil: niveauValide(seuil) ? seuil : 'warn', entrees: [],
      ecrire: function (e) { if (s.entrees.length < borne) s.entrees.push(e); },
      lignes: function () { return s.entrees.map(formater); },
    };
    return s;
  }

  /* L'instance commune. Le harnais de test pose `MC_JOURNAL_MODE = 'test'`
     avant de charger les modules (console muette, trace produit). */
  MC.Journal = creer({ mode: G.MC_JOURNAL_MODE });
})(typeof globalThis !== 'undefined' ? globalThis : this);
