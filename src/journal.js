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
     limité. Le client n'envoie pas plus de REMONTEE.max par fenêtre ; le
     serveur n'en journalise pas plus par ADRESSE (une reconnexion ne remet
     rien à zéro) ni, toutes adresses confondues, plus de REMONTEE_SERVEUR. */
  var TYPE_REMONTEE = 'journal_client';
  var REMONTEE = { max: 5, fenetreMs: 10000, messageMax: 500, pileMax: 2000 };
  var REMONTEE_SERVEUR = { globalMax: 30, globalFenetreMs: 60000, maxAdresses: 1000 };
  var CAPACITE_TAMPON = 2000;
  var RE_CODE = /\bE-[A-Z]+-\d{3}\b/;
  var RE_DOMAINE = /^[A-Z0-9_-]{1,24}$/;
  /* Caractères de contrôle C0 (hors tabulation et saut de ligne), DEL, C1,
     séparateurs de ligne Unicode : jamais dans une ligne écrite. */
  var RE_CONTROLES = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g;

  function aPropre(o, k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k); }
  function rang(niveau) { return aPropre(RANG, niveau) ? RANG[niveau] : RANG.info; }
  function niveauValide(n) { return aPropre(RANG, n); }
  function modeValide(m) { return aPropre(MODES, m); }
  /* Texte d'une valeur quelconque, sans jamais lever (objet sans prototype,
     toString qui lève…). */
  function texteSur(v) {
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v;
    try { return String(v); } catch (e) {
      try { return Object.prototype.toString.call(v); } catch (e2) { return '[illisible]'; }
    }
  }
  function domaineDe(d) { return texteSur(d || 'JEU').toUpperCase(); }

  /* Une entrée écrite tient sur des lignes à elle : chaque saut de ligne est
     suivi d'une indentation (une suite ne commence jamais en colonne 0, donc
     jamais par `MC_PORT=`), les caractères de contrôle sont retirés. */
  function ligneSure(texte) {
    return texteSur(texte).replace(/\r\n|\r|\n|\u2028|\u2029/g, '\n    ').replace(RE_CONTROLES, '');
  }
  /* Version une-ligne (texte venu d'un client) : chaque suite de contrôles
     devient une espace. */
  function uneLigne(texte) {
    return texteSur(texte).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ');
  }

  /* Copie défensive et bornée des données structurées : une entrée ne doit
     jamais garder une référence vivante (le monde, un joueur) ni grossir sans
     limite le tampon. */
  function copieDonnees(d) {
    if (d === undefined || d === null) return null;
    if (typeof d !== 'object') return typeof d === 'function' ? null : d;
    try {
      var s = JSON.stringify(d);
      if (s === undefined) return null;
      if (s.length > 4000) return { tronque: true, apercu: s.slice(0, 4000) };
      return JSON.parse(s);
    } catch (e) { return { illisible: texteSur(e && e.message) || 'données illisibles' }; }
  }
  function pileDe(erreur) {
    if (!erreur) return null;
    if (typeof erreur === 'string') return erreur;
    try {
      if (erreur.stack) return texteSur(erreur.stack);
      if (erreur.message) return texteSur(erreur.message);
    } catch (e) { return '[pile illisible]'; }
    return texteSur(erreur);
  }

  function deuxChiffres(n) { return (n < 10 ? '0' : '') + n; }
  function heureDe(t) {
    var d = new Date(t);
    var ms = d.getMilliseconds();
    return deuxChiffres(d.getHours()) + ':' + deuxChiffres(d.getMinutes()) + ':' + deuxChiffres(d.getSeconds()) +
           '.' + (ms < 10 ? '00' : ms < 100 ? '0' : '') + ms;
  }

  /* Le code rappelé devant le message, sauf s'il y figure déjà. */
  function prefixeCode(e) { return e.code && e.message.indexOf(e.code) < 0 ? e.code + ' ' : ''; }
  /* Une ligne de texte par entrée (fichier du serveur, rapport de test) :
     on y retrouve au grep le domaine, le niveau et le code d'erreur. */
  function formater(e) {
    var l = e.horodatage + ' ' + e.niveau.toUpperCase() + ' ' + e.domaine + ' ' + prefixeCode(e) + ligneSure(e.message);
    if (e.donnees !== null && e.donnees !== undefined) {
      try { l += ' ' + JSON.stringify(e.donnees); } catch (err) { /* illisible */ }
    }
    if (e.contexte && e.contexte.test) l += ' {test: ' + ligneSure(e.contexte.test) + '}';
    if (e.pile) l += '\n    ' + ligneSure(e.pile);
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

  /* Filtre des remontées côté serveur : `passe(adresse)` dit si une
     remontée de cette adresse est journalisée — au plus `ipMax` par
     `ipFenetreMs` et par adresse, `globalMax` par `globalFenetreMs` en tout.
     La table des adresses est bornée (vidée au-delà de `maxAdresses`). */
  function filtreRemontee(opts) {
    opts = opts || {};
    var horloge = opts.horloge;
    var ipMax = opts.ipMax || REMONTEE.max, ipFenetre = opts.ipFenetreMs || REMONTEE.fenetreMs;
    var maxAdresses = opts.maxAdresses || REMONTEE_SERVEUR.maxAdresses;
    var global = limiteur(opts.globalMax || REMONTEE_SERVEUR.globalMax, opts.globalFenetreMs || REMONTEE_SERVEUR.globalFenetreMs, horloge);
    var parAdresse = Object.create(null), nAdresses = 0;
    return function (adresse) {
      var a = texteSur(adresse) || '?';
      if (!parAdresse[a]) {
        if (nAdresses >= maxAdresses) { parAdresse = Object.create(null); nAdresses = 0; }
        parAdresse[a] = limiteur(ipMax, ipFenetre, horloge); nAdresses++;
      }
      return parAdresse[a]() && global();
    };
  }

  /* Analyse `RENDU:debug,SYNC:trace` (paramètre d'URL `?journal=`, option
     serveur `--journal`) : { ok, domaines: { RENDU: 'debug', … }, erreurs }. */
  function analyserReglage(texte) {
    var domaines = Object.create(null), erreurs = [];
    texteSur(texte).split(',').forEach(function (morceau) {
      var m = morceau.trim();
      if (!m) return;
      var i = m.lastIndexOf(':');
      var d = i > 0 ? domaineDe(m.slice(0, i).trim()) : '';
      var n = i > 0 ? m.slice(i + 1).trim().toLowerCase() : '';
      if (!RE_DOMAINE.test(d) || !niveauValide(n)) { erreurs.push(m); return; }
      domaines[d] = n;
    });
    var copie = {};
    Object.keys(domaines).forEach(function (k) { copie[k] = domaines[k]; });
    return { ok: erreurs.length === 0, domaines: copie, erreurs: erreurs };
  }

  /* Validation d'une remontée reçue par le serveur : copie bornée et
     nettoyée, ou null. Le message tient sur UNE ligne (un client ne doit
     jamais écrire une ligne à lui dans la sortie du serveur, un faux
     `MC_PORT=` lu par un lanceur) ; la pile garde ses sauts de ligne mais
     perd tout caractère de contrôle (ESC, OSC, C1, retour chariot). */
  function validerRemontee(msg) {
    if (!msg || typeof msg !== 'object' || msg.t !== TYPE_REMONTEE) return null;
    if (msg.niveau !== 'error' && msg.niveau !== 'fatal') return null;
    var d = typeof msg.domaine === 'string' ? msg.domaine.toUpperCase() : '';
    if (!RE_DOMAINE.test(d)) return null;
    if (typeof msg.message !== 'string') return null;
    var texte = uneLigne(msg.message).trim().slice(0, REMONTEE.messageMax);
    if (!texte) return null;
    var v = { t: TYPE_REMONTEE, niveau: msg.niveau, domaine: d, message: texte };
    if (typeof msg.code === 'string' && /^E-[A-Z]+-\d{3}$/.test(msg.code)) v.code = msg.code;
    if (typeof msg.pile === 'string' && msg.pile) {
      var pile = msg.pile.slice(0, REMONTEE.pileMax).replace(/\r\n|\r/g, '\n').replace(RE_CONTROLES, '');
      if (pile) v.pile = pile;
    }
    return v;
  }

  // ─── une instance de journal ───────────────────────────────────────────────
  function creer(options) {
    options = options || {};
    var modeInitial = modeValide(options.mode) ? options.mode : 'jeu';
    var etat = {
      mode: modeInitial,
      production: MODES[modeInitial].production,
      domaines: Object.create(null),
      contexte: Object.create(null),
      fournisseur: null,
      afficherJoueur: null,
      horloge: function () { return Date.now(); },
      cibleConsole: null,           // null : la console de l'environnement (G.console)
      formatConsole: null,
      methodeConsole: null,
      enCours: 0,
    };
    /* Tampon circulaire : un tableau de taille fixe, un index de début, une
       taille — l'insertion ne déplace jamais rien. */
    var anneau = { cases: new Array(CAPACITE_TAMPON), debut: 0, taille: 0 };
    function anneauAjouter(e) {
      var cap = anneau.cases.length;
      if (anneau.taille < cap) { anneau.cases[(anneau.debut + anneau.taille) % cap] = e; anneau.taille++; }
      else { anneau.cases[anneau.debut] = e; anneau.debut = (anneau.debut + 1) % cap; }
    }
    function anneauListe() {
      var out = [], cap = anneau.cases.length;
      for (var i = 0; i < anneau.taille; i++) out.push(anneau.cases[(anneau.debut + i) % cap]);
      return out;
    }
    function anneauCapacite(n) {
      var garder = anneauListe().slice(-n);
      anneau = { cases: new Array(n), debut: 0, taille: 0 };
      garder.forEach(anneauAjouter);
    }

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
    var sortieTampon = { nom: 'tampon', seuil: 'trace', ecrire: anneauAjouter };
    var sorties = [sortieConsole, sortieTampon];
    var loggers = Object.create(null);

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

    /* Ne lève JAMAIS : un journal qui ferait tomber l'appelant serait pire
       que pas de journal. */
    function emettre(domaine, niveau, message, donnees, erreur, opts) {
      try {
        if (rang(niveau) < rang(seuilProduction(domaine))) return null;
        // une sortie (ou l'affichage joueur) qui journalise à son tour ne doit pas boucler
        if (etat.enCours > 2) return null;
        opts = opts && typeof opts === 'object' ? opts : {};
        var t;
        try { t = etat.horloge(); } catch (err) { t = NaN; }
        if (typeof t !== 'number' || !isFinite(t)) t = Date.now();
        var texte = texteSur(message);
        var codeMsg = RE_CODE.exec(texte);
        var codeOpt = typeof opts.code === 'string' && RE_CODE.test(opts.code) ? opts.code : null;
        var e = {
          t: t,
          horodatage: new Date(t).toISOString(),
          domaine: domaine,
          niveau: niveau,
          message: texte,
          donnees: copieDonnees(donnees),
          pile: pileDe(erreur),
          contexte: contexteCourant(),
          code: codeOpt || (codeMsg ? codeMsg[0] : null),
          joueur: opts.joueur ? texteSur(opts.joueur) : null,
          brut: !!opts.brut,
        };
        // l'objet d'erreur n'est gardé que pour la console (inspectable dans les outils) — pas énumérable
        if (erreur && typeof erreur === 'object') Object.defineProperty(e, 'erreurObjet', { value: erreur, enumerable: false });
      } catch (err) { return null; }
      etat.enCours++;
      try {
        for (var i = 0; i < sorties.length; i++) {
          var s = sorties[i];
          try {
            var seuil = rang(s.seuil);
            if (s.suitDomaines && etat.domaines[domaine] !== undefined) seuil = Math.min(seuil, rang(etat.domaines[domaine]));
            if (rang(niveau) < seuil) continue;
            s.ecrire(e);
          } catch (err) { /* une sortie en panne ne fait pas tomber les autres */ }
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
        if (modeValide(o.mode)) { etat.mode = o.mode; sortieConsole.seuil = MODES[o.mode].console; etat.production = MODES[o.mode].production; }
      }
      if (o.seuilConsole !== undefined) { ancien.seuilConsole = sortieConsole.seuil; if (niveauValide(o.seuilConsole)) sortieConsole.seuil = o.seuilConsole; }
      if (o.production !== undefined) { ancien.production = etat.production; if (niveauValide(o.production)) etat.production = o.production; }
      if (o.afficherJoueur !== undefined) { ancien.afficherJoueur = etat.afficherJoueur; etat.afficherJoueur = typeof o.afficherJoueur === 'function' ? o.afficherJoueur : null; }
      if (o.horloge !== undefined) { ancien.horloge = etat.horloge; if (typeof o.horloge === 'function') etat.horloge = o.horloge; }
      if (o.capaciteTampon !== undefined) {
        ancien.capaciteTampon = anneau.cases.length;
        if (o.capaciteTampon >= 1) anneauCapacite(Math.floor(o.capaciteTampon));
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
               capaciteTampon: anneau.cases.length, sorties: sorties.map(function (s) { return s.nom; }) };
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
    /* Le réglage d'une page (`location.search`) : `?dev` passe en mode
       développement, `?journal=RENDU:debug,…` règle des domaines. Ne lève
       jamais : un paramètre mal encodé (`?journal=%`) est refusé, le
       chargement continue. */
    function reglerDepuisUrl(recherche) {
      var q = texteSur(recherche);
      if (/[?&]dev(=|&|$)/.test(q)) configurer({ mode: 'dev' });
      var m = /[?&]journal=([^&]*)/.exec(q);
      if (!m) return { ok: true, domaines: {}, erreurs: [] };
      var brut;
      try { brut = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { return { ok: false, domaines: {}, erreurs: [m[1]] }; }
      return regler(brut);
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
      return anneauListe().filter(function (e) {
        if (f.domaine && e.domaine !== domaineDe(f.domaine)) return false;
        if (f.niveau && rang(e.niveau) < rang(f.niveau)) return false;
        if (f.test && (!e.contexte || e.contexte.test !== f.test)) return false;
        return true;
      });
    }
    function viderTampon() { var n = anneau.taille; anneau = { cases: new Array(anneau.cases.length), debut: 0, taille: 0 }; return n; }

    journal.configurer = configurer;
    journal.configuration = configuration;
    journal.niveau = niveau;
    journal.regler = regler;
    journal.reglerDepuisUrl = reglerDepuisUrl;
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
    journal.ligneSure = ligneSure;
    journal.limiteur = limiteur;
    journal.filtreRemontee = filtreRemontee;
    journal.analyserReglage = analyserReglage;
    journal.validerRemontee = validerRemontee;
    journal.sortieRemontee = sortieRemontee;
    journal.sortieCollecte = sortieCollecte;
    journal.heureDe = heureDe;
    journal.NIVEAUX = NIVEAUX;
    journal.MODES = MODES;
    journal.TYPE_REMONTEE = TYPE_REMONTEE;
    journal.REMONTEE = REMONTEE;
    journal.REMONTEE_SERVEUR = REMONTEE_SERVEUR;
    /* Pour le harnais de test (contexte du test en cours, collecte du
       rapport) : un OBJET, que l'observation des fonctions de tests/run.js
       n'enveloppe pas — sans quoi chaque test « appellerait » le journal et
       la carte d'impact rattacherait tous les tests à src/journal.js. */
    journal.outilsHarnais = { contexte: contexte, ajouterSortie: ajouterSortie, retirerSortie: retirerSortie, sortieCollecte: sortieCollecte };
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
        if (e.pile) msg.pile = e.pile.slice(0, REMONTEE.pileMax);
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
