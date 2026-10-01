/* contrats-archi.js — contrats FIGÉS du chantier « solo = serveur toujours
   présent » (L50, SPEC-ARCHI-019 ; docs/archi-solo-serveur/README.md).

   Il fixe ce qui traverse une frontière entre deux lots ou entre deux
   processus : les noms des nouveaux messages réseau, leur sens, leurs bornes,
   l'énumération ETAT_RESEAU, les motifs de refus et des fonctions `valider*`
   pures. Même modèle que contrats-vague2.js :
   - un validateur renvoie une COPIE normalisée, ou `null` si l'entrée est
     invalide — jamais d'exception, jamais l'objet reçu lui-même ;
   - aucun lot B ou P ne modifie ce fichier : un besoin nouveau passe par un
     amendement explicite (commit dédié qui ne touche que ce fichier et
     tests/spec-contrats-archi.js) ;
   - module PUR (porte G5) : ni THREE, ni DOM, ni socket ; aucune dépendance
     de chargement (il se charge AVANT net-protocol.js, qui fusionne `MSG`
     dans `NP.MSG`). */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var VERSION = 1;

  // ─── noms des nouveaux messages réseau ─────────────────────────────────────
  var MSG = {
    PAUSE: 'pause',                       // c→s : { actif } — le POSTE entre en pause / reprend
    PAUSE_ETAT: 'pause_etat',             // s→c : { actif, rev } — état de pause qui fait foi
    RESEAU: 'reseau',                     // c→s : { ouvert } — ouvrir/fermer au réseau (boucle locale seulement)
    RESEAU_ETAT: 'reseau_etat',           // s→c : { etat, port, adresses }
    ARRET: 'arret',                       // c→s : arrêt propre du processus (boucle locale seulement)
    DORMIR: 'dormir',                     // c→s : { j, actif } — un joueur local se couche / se lève (lot B-ENV)
    HISTOIRE_ETAT: 'histoire_etat',       // s→c : { j, etat } — état du récit d'un joueur (lot P-HIST)
    SUCCES_DEBLOQUE: 'succes_debloque',   // s→c : { j, id } — un succès vient d'être obtenu (lot P-SUCC)
    SUCCES_ETAT: 'succes_etat',           // s→c : { j, etat:{compte,debloques} } — compteurs du panneau (lot P-SUCC)
    FOUDROYE: 'foudroye',                 // s→c : { j } — ce joueur vient d'être foudroyé (lot P-SUCC)
  };
  var SENS = {
    pause: 'c>s', pause_etat: 's>c', reseau: 'c>s', reseau_etat: 's>c', arret: 'c>s',
    dormir: 'c>s', histoire_etat: 's>c', succes_debloque: 's>c',
    succes_etat: 's>c', foudroye: 's>c',
  };

  /* État du réseau tel que le CLIENT le lit (jamais `net.enLigne()`, qui est
     toujours vrai : tout joueur passe par un serveur). `ferme` : serveur local,
     boucle locale seulement ; `ouvert` : serveur local ouvert à d'autres
     machines ; `distant` : le client est connecté à un serveur d'une autre
     machine. Le serveur, lui, n'annonce que `ferme` ou `ouvert`. */
  var ETAT_RESEAU = { FERME: 'ferme', OUVERT: 'ouvert', DISTANT: 'distant' };

  // motifs de refus (REFUS.motif), liste fermée
  var MOTIFS_REFUS = { POSTE_DEJA_CONNECTE: 'poste_deja_connecte', RESEAU_FERME: 'reseau_ferme', SERVEUR_COMPLET: 'serveur_complet' };

  // ─── bornes ────────────────────────────────────────────────────────────────
  var BORNES = {
    PORT_DEFAUT: 8080,          // SPEC-ARCHI-004
    PORT_REPLI_MAX: 8099,       // repli sur le premier port libre jusqu'à celui-ci
    PORT_MAX: 65535,
    ADRESSES_MAX: 16,           // adresses annoncées par RESEAU_ETAT
    ADRESSE_LONGUEUR_MAX: 64,
    REV_MAX: 2147483647,
    GRACE_ARRET_S: 10,          // SPEC-ARCHI-008 : délai de grâce avant terminaison
    SAUVEGARDE_FERME_MS: 45000, // SPEC-ARCHI-012 : cadence en mode fermé
    SAUVEGARDE_OUVERT_MS: 120000,
    ID_SUCCES_MAX: 64,
    SUCCES_ETAT_MAX: 128,       // entrées maximales de compte / debloques dans SUCCES_ETAT
    HISTOIRE_JSON_MAX: 8000,    // taille JSON maximale de HISTOIRE_ETAT.etat
    JOUEURS_LOCAUX_MAX: 4,
    PARTIE_ID_MAX: 64,
    PARTIES_MAX: 500,
  };
  /* Budgets anti-flood des messages c→s, en messages par seconde et par
     connexion (ou par joueur local pour DORMIR). */
  var BUDGETS_FLOOD = { pause: 10, reseau: 5, arret: 2, dormir: 10 };

  // ─── primitives ────────────────────────────────────────────────────────────
  function estFini(v) { return typeof v === 'number' && isFinite(v); }
  function estEntier(v) { return estFini(v) && Math.floor(v) === v; }
  function entierDans(v, min, max) { return estEntier(v) && v >= min && v <= max; }
  function joueurLocal(j) { return j === undefined ? 0 : (entierDans(j, 0, 3) ? j : -1); }
  function objet(m) { return !!m && typeof m === 'object' && !Array.isArray(m); }

  // ─── validateurs c→s ───────────────────────────────────────────────────────
  function validerPause(m) {
    if (!objet(m) || m.t !== MSG.PAUSE || typeof m.actif !== 'boolean') return null;
    return { t: MSG.PAUSE, actif: m.actif };
  }
  function validerReseau(m) {
    if (!objet(m) || m.t !== MSG.RESEAU || typeof m.ouvert !== 'boolean') return null;
    return { t: MSG.RESEAU, ouvert: m.ouvert };
  }
  function validerArret(m) {
    if (!objet(m) || m.t !== MSG.ARRET) return null;
    return { t: MSG.ARRET };
  }
  function validerDormir(m) {
    if (!objet(m) || m.t !== MSG.DORMIR || typeof m.actif !== 'boolean') return null;
    var j = joueurLocal(m.j);
    if (j < 0) return null;
    return { t: MSG.DORMIR, j: j, actif: m.actif };
  }
  // côté serveur : valide un message reçu d'un client parmi les nouveaux types c→s
  function valider(m) {
    if (!objet(m) || typeof m.t !== 'string') return null;
    switch (m.t) {
      case MSG.PAUSE: return validerPause(m);
      case MSG.RESEAU: return validerReseau(m);
      case MSG.ARRET: return validerArret(m);
      case MSG.DORMIR: return validerDormir(m);
      default: return null;
    }
  }

  // ─── validateurs s→c ───────────────────────────────────────────────────────
  function validerPauseEtat(m) {
    if (!objet(m) || m.t !== MSG.PAUSE_ETAT || typeof m.actif !== 'boolean') return null;
    if (!entierDans(m.rev, 0, BORNES.REV_MAX)) return null;
    return { t: MSG.PAUSE_ETAT, actif: m.actif, rev: m.rev };
  }
  function validerReseauEtat(m) {
    if (!objet(m) || m.t !== MSG.RESEAU_ETAT) return null;
    if (m.etat !== ETAT_RESEAU.FERME && m.etat !== ETAT_RESEAU.OUVERT) return null;
    if (!entierDans(m.port, 0, BORNES.PORT_MAX)) return null;
    if (!Array.isArray(m.adresses) || m.adresses.length > BORNES.ADRESSES_MAX) return null;
    var adr = [];
    for (var i = 0; i < m.adresses.length; i++) {
      var a = m.adresses[i];
      if (typeof a !== 'string' || !a || a.length > BORNES.ADRESSE_LONGUEUR_MAX) return null;
      adr.push(a);
    }
    return { t: MSG.RESEAU_ETAT, etat: m.etat, port: m.port, adresses: adr };
  }
  function validerHistoireEtat(m) {
    if (!objet(m) || m.t !== MSG.HISTOIRE_ETAT || !objet(m.etat)) return null;
    var j = joueurLocal(m.j);
    if (j < 0) return null;
    var txt;
    try { txt = JSON.stringify(m.etat); } catch (e) { return null; }
    if (typeof txt !== 'string' || txt.length > BORNES.HISTOIRE_JSON_MAX) return null;
    return { t: MSG.HISTOIRE_ETAT, j: j, etat: JSON.parse(txt) };
  }
  function validerSuccesDebloque(m) {
    if (!objet(m) || m.t !== MSG.SUCCES_DEBLOQUE) return null;
    var j = joueurLocal(m.j);
    if (j < 0) return null;
    if (typeof m.id !== 'string' || !m.id || m.id.length > BORNES.ID_SUCCES_MAX) return null;
    return { t: MSG.SUCCES_DEBLOQUE, j: j, id: m.id };
  }
  /* SUCCES_ETAT.etat = la sérialisation de MC.Succes ({ compte:{id:n}, debloques:[id] }),
     normalisée : seuls des identifiants courts, des compteurs finis positifs. */
  function validerSuccesEtat(m) {
    if (!objet(m) || m.t !== MSG.SUCCES_ETAT || !objet(m.etat)) return null;
    var j = joueurLocal(m.j);
    if (j < 0) return null;
    var compte = {}, debloques = [], n = 0, id;
    if (m.etat.compte !== undefined) {
      if (!objet(m.etat.compte)) return null;
      for (id in m.etat.compte) {
        if (!Object.prototype.hasOwnProperty.call(m.etat.compte, id)) continue;
        if (!id || id.length > BORNES.ID_SUCCES_MAX || ++n > BORNES.SUCCES_ETAT_MAX) return null;
        var v = m.etat.compte[id];
        if (!estFini(v) || v < 0) return null;
        compte[id] = v;
      }
    }
    if (m.etat.debloques !== undefined) {
      if (!Array.isArray(m.etat.debloques) || m.etat.debloques.length > BORNES.SUCCES_ETAT_MAX) return null;
      for (var i = 0; i < m.etat.debloques.length; i++) {
        var d = m.etat.debloques[i];
        if (typeof d !== 'string' || !d || d.length > BORNES.ID_SUCCES_MAX) return null;
        debloques.push(d);
      }
    }
    return { t: MSG.SUCCES_ETAT, j: j, etat: { compte: compte, debloques: debloques } };
  }
  function validerFoudroye(m) {
    if (!objet(m) || m.t !== MSG.FOUDROYE) return null;
    var j = joueurLocal(m.j);
    if (j < 0) return null;
    return { t: MSG.FOUDROYE, j: j };
  }
  // côté client : valide un message reçu du serveur parmi les nouveaux types s→c
  function validerRecu(m) {
    if (!objet(m)) return null;
    switch (m.t) {
      case MSG.PAUSE_ETAT: return validerPauseEtat(m);
      case MSG.RESEAU_ETAT: return validerReseauEtat(m);
      case MSG.HISTOIRE_ETAT: return validerHistoireEtat(m);
      case MSG.SUCCES_DEBLOQUE: return validerSuccesDebloque(m);
      case MSG.SUCCES_ETAT: return validerSuccesEtat(m);
      case MSG.FOUDROYE: return validerFoudroye(m);
      default: return null;
    }
  }

  // ─── aides pures partagées par le serveur et les tests ─────────────────────
  /* Origines autorisées en mode fermé, figées à trois valeurs (SPEC-ARCHI-003). */
  function originesLocales(port) {
    if (!entierDans(port, 1, BORNES.PORT_MAX)) return [];
    return ['http://localhost:' + port, 'http://127.0.0.1:' + port, 'http://[::1]:' + port];
  }
  /* Une adresse distante est-elle de la boucle locale ? (IPv4, IPv6, IPv4
     projetée en IPv6). */
  function estAdresseLocale(ip) {
    if (typeof ip !== 'string') return false;
    var a = ip.replace(/^::ffff:/i, '');
    return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
  }
  /* Choix du prochain port candidat : `port` demandé (0 = éphémère), repli
     jusqu'à PORT_REPLI_MAX seulement si le port n'est pas imposé. */
  function portsCandidats(port, imposé) {
    if (port === 0) return [0];
    if (imposé) return [port];
    var l = [];
    for (var p = port; p <= BORNES.PORT_REPLI_MAX; p++) l.push(p);
    return l.length ? l : [port];
  }

  MC.ContratsArchi = {
    VERSION: VERSION, MSG: MSG, SENS: SENS, BORNES: BORNES, BUDGETS_FLOOD: BUDGETS_FLOOD,
    ETAT_RESEAU: ETAT_RESEAU, MOTIFS_REFUS: MOTIFS_REFUS,
    valider: valider, validerPause: validerPause, validerReseau: validerReseau,
    validerArret: validerArret, validerDormir: validerDormir,
    validerRecu: validerRecu, validerPauseEtat: validerPauseEtat, validerReseauEtat: validerReseauEtat,
    validerHistoireEtat: validerHistoireEtat, validerSuccesDebloque: validerSuccesDebloque,
    validerSuccesEtat: validerSuccesEtat, validerFoudroye: validerFoudroye,
    originesLocales: originesLocales, estAdresseLocale: estAdresseLocale, portsCandidats: portsCandidats,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
