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
    // lot P-VEH (SPEC-ARCHI-021, SPEC-SYNC-022) : les véhicules sont simulés par le serveur
    VEHICULE_POSER: 'vehicule_poser',     // c→s : { j, nom, i, x, y, z, nx, ny, nz } — poser un véhicule sur le bloc visé (case `i` de l'inventaire)
    VEHICULE_MONTER: 'vehicule_monter',   // c→s : { j, eid } — monter à bord (la soute s'ouvre par CONTENEUR_OUVRIR { eid })
    VEHICULE_DESCENDRE: 'vehicule_descendre', // c→s : { j } — mettre pied à terre
    VEHICULE_REPARER: 'vehicule_reparer', // c→s : { j, eid } — réparer le véhicule conduit chez le forgeron eid (SPEC-TRANSPORT-002)
    VEHICULE_EVT: 'vehicule_evt',         // s→c : { j, evt, nom?, motif? } — à bord / pied à terre / refus motivé
    // lot P-HIST (amendement) : le dialogue avec un habitant et les répliques du récit passent par le serveur
    HISTOIRE_PARLER: 'histoire_parler',   // c→s : { j, eid } — le joueur parle à un habitant
    HISTOIRE_REPONSE: 'histoire_reponse', // c→s : { j, id, option } — réponse à un choix du récit ou à une quête proposée
    HISTOIRE_NOTIF: 'histoire_notif',     // s→c : { j, notifs, proposition?, libre?, eid? } — ce que le récit annonce
    SUCCES_ETAT: 'succes_etat',           // s→c : { j, etat:{compte,debloques} } — compteurs du panneau (lot P-SUCC)
    FOUDROYE: 'foudroye',                 // s→c : { j } — ce joueur vient d'être foudroyé (lot P-SUCC)
    // amendement L29 (SPEC-MECA-005) : levier ou bouton actionné à la main ; le serveur vérifie la portée et le bloc
    ACTIONNER: 'actionner',               // c→s : { j, x, y, z } — actionner la commande (levier, bouton) de cette case
  };
  var SENS = {
    pause: 'c>s', pause_etat: 's>c', reseau: 'c>s', reseau_etat: 's>c', arret: 'c>s',
    dormir: 'c>s', histoire_etat: 's>c', succes_debloque: 's>c',
    vehicule_poser: 'c>s', vehicule_monter: 'c>s', vehicule_descendre: 'c>s', vehicule_reparer: 'c>s', vehicule_evt: 's>c',
    histoire_parler: 'c>s', histoire_reponse: 'c>s', histoire_notif: 's>c',
    succes_etat: 's>c', foudroye: 's>c',
    actionner: 'c>s',
  };
  // évènements de VEHICULE_EVT et motifs de refus, listes fermées
  var EVT_VEHICULE = { POSE: 'pose', MONTE: 'monte', DESCEND: 'descend', REPARE: 'repare', REFUS: 'refus' };
  var MOTIFS_VEHICULE = { PORTEE: 'portee', OCCUPE: 'occupe', DEJA_A_BORD: 'deja_a_bord', INCONNU: 'inconnu',
                          PLACE: 'place', INVENTAIRE: 'inventaire', MORT: 'mort' };

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
    HISTOIRE_NOTIFS_MAX: 12,    // annonces par HISTOIRE_NOTIF
    HISTOIRE_TEXTE_MAX: 800,
    HISTOIRE_ID_MAX: 64,
    HISTOIRE_OBJETS_MAX: 8,
    JOUEURS_LOCAUX_MAX: 4,
    PARTIE_ID_MAX: 64,
    PARTIES_MAX: 500,
    COORD_MAX: 10000000,        // = NP.COORD_MAX (SPEC-SECU-008), dupliqué : aucune dépendance
    WORLD_H: 128,               // = C.WORLD_H, dupliqué pour la même raison
    VEHICULE_NOM_MAX: 16,       // longueur d'un nom de véhicule (« sous_marin »)
    PORTEE_VEHICULE: 6,         // blocs : monter, poser (œil du joueur → véhicule ou bloc visé)
  };
  /* Budgets anti-flood des messages c→s, en messages par seconde et par
     connexion (ou par joueur local pour DORMIR). */
  var BUDGETS_FLOOD = { pause: 10, reseau: 5, arret: 2, dormir: 10, histoire_parler: 5, histoire_reponse: 10,
                        vehicule_poser: 5, vehicule_monter: 10, vehicule_descendre: 10, vehicule_reparer: 5 };
  BUDGETS_FLOOD.actionner = 10;   // amendement L29 (SPEC-MECA-005) : dix clics par seconde et par joueur local

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
  // ── lot P-VEH : poser, monter, descendre ──
  function coordH(v) { return estEntier(v) && Math.abs(v) <= BORNES.COORD_MAX; }
  function normale(v) { return v === -1 || v === 0 || v === 1; }
  function validerVehiculePoser(m) {
    if (!objet(m) || m.t !== MSG.VEHICULE_POSER) return null;
    if (typeof m.nom !== 'string' || !/^[a-z_]+$/.test(m.nom) || m.nom.length > BORNES.VEHICULE_NOM_MAX) return null;
    if (!coordH(m.x) || !entierDans(m.y, 0, BORNES.WORLD_H - 1) || !coordH(m.z)) return null;
    if (!normale(m.nx) || !normale(m.ny) || !normale(m.nz)) return null;
    var j = joueurLocal(m.j);
    if (j < 0) return null;
    return { t: MSG.VEHICULE_POSER, j: j, nom: m.nom, i: entierDans(m.i, 0, 8) ? m.i : -1,
             x: m.x, y: m.y, z: m.z, nx: m.nx, ny: m.ny, nz: m.nz };
  }
  function validerVehiculeMonter(m) {
    if (!objet(m) || m.t !== MSG.VEHICULE_MONTER || !entierDans(m.eid, 0, BORNES.REV_MAX)) return null;
    var j = joueurLocal(m.j);
    if (j < 0) return null;
    return { t: MSG.VEHICULE_MONTER, j: j, eid: m.eid };
  }
  function validerVehiculeReparer(m) {
    if (!objet(m) || m.t !== MSG.VEHICULE_REPARER || !entierDans(m.eid, 0, BORNES.REV_MAX)) return null;
    var j = joueurLocal(m.j);
    if (j < 0) return null;
    return { t: MSG.VEHICULE_REPARER, j: j, eid: m.eid };
  }
  function validerVehiculeDescendre(m) {
    if (!objet(m) || m.t !== MSG.VEHICULE_DESCENDRE) return null;
    var j = joueurLocal(m.j);
    if (j < 0) return null;
    return { t: MSG.VEHICULE_DESCENDRE, j: j };
  }
  function validerVehiculeEvt(m) {
    if (!objet(m) || m.t !== MSG.VEHICULE_EVT) return null;
    var j = joueurLocal(m.j);
    if (j < 0) return null;
    var evts = Object.keys(EVT_VEHICULE).map(function (k) { return EVT_VEHICULE[k]; });
    if (evts.indexOf(m.evt) < 0) return null;
    var out = { t: MSG.VEHICULE_EVT, j: j, evt: m.evt };
    if (m.nom !== undefined) {
      if (typeof m.nom !== 'string' || !/^[a-z_]+$/.test(m.nom) || m.nom.length > BORNES.VEHICULE_NOM_MAX) return null;
      out.nom = m.nom;
    }
    if (m.motif !== undefined) {
      var motifs = Object.keys(MOTIFS_VEHICULE).map(function (k) { return MOTIFS_VEHICULE[k]; });
      if (motifs.indexOf(m.motif) < 0) return null;
      out.motif = m.motif;
    }
    return out;
  }
  function validerHistoireParler(m) {
    if (!objet(m) || m.t !== MSG.HISTOIRE_PARLER || !entierDans(m.eid, 0, 2147483647)) return null;
    var j = joueurLocal(m.j);
    if (j < 0) return null;
    return { t: MSG.HISTOIRE_PARLER, j: j, eid: m.eid };
  }
  function validerHistoireReponse(m) {
    if (!objet(m) || m.t !== MSG.HISTOIRE_REPONSE) return null;
    var j = joueurLocal(m.j);
    if (j < 0) return null;
    function ident(v) { return typeof v === 'string' && v.length > 0 && v.length <= BORNES.HISTOIRE_ID_MAX; }
    if (!ident(m.id)) return null;
    if (m.option !== null && m.option !== undefined && !ident(m.option)) return null;
    return { t: MSG.HISTOIRE_REPONSE, j: j, id: m.id, option: m.option === undefined ? null : m.option };
  }
  // ── amendement L29 (SPEC-MECA-005) : actionner un levier ou un bouton ──
  // Seule la case voyage : le nouvel état est décidé par le serveur (MC.Circuits.actionner).
  function validerActionner(m) {
    if (!objet(m) || m.t !== MSG.ACTIONNER) return null;
    if (!coordH(m.x) || !entierDans(m.y, 0, BORNES.WORLD_H - 1) || !coordH(m.z)) return null;
    var j = joueurLocal(m.j);
    if (j < 0) return null;
    return { t: MSG.ACTIONNER, j: j, x: m.x, y: m.y, z: m.z };
  }
  // côté serveur : valide un message reçu d'un client parmi les nouveaux types c→s
  function valider(m) {
    if (!objet(m) || typeof m.t !== 'string') return null;
    switch (m.t) {
      case MSG.PAUSE: return validerPause(m);
      case MSG.RESEAU: return validerReseau(m);
      case MSG.ARRET: return validerArret(m);
      case MSG.DORMIR: return validerDormir(m);
      case MSG.VEHICULE_POSER: return validerVehiculePoser(m);
      case MSG.VEHICULE_MONTER: return validerVehiculeMonter(m);
      case MSG.VEHICULE_DESCENDRE: return validerVehiculeDescendre(m);
      case MSG.VEHICULE_REPARER: return validerVehiculeReparer(m);
      case MSG.HISTOIRE_PARLER: return validerHistoireParler(m);
      case MSG.HISTOIRE_REPONSE: return validerHistoireReponse(m);
      case MSG.ACTIONNER: return validerActionner(m);
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
  /* Une annonce du récit (lot P-HIST) : liste fermée de types, champs copiés un à un et bornés. */
  var TYPES_NOTIF = ['chapitre', 'dialogue', 'evenement', 'etape', 'quete', 'info', 'echec', 'recompense', 'fin'];
  function texteBorne(v, max) { return typeof v === 'string' ? v.slice(0, max) : undefined; }
  function validerNotif(n) {
    if (!objet(n) || TYPES_NOTIF.indexOf(n.type) < 0) return null;
    var o = { type: n.type };
    var t = texteBorne(n.titre, 160); if (t !== undefined) o.titre = t;
    t = texteBorne(n.texte, BORNES.HISTOIRE_TEXTE_MAX); if (t !== undefined) o.texte = t;
    t = texteBorne(n.id, BORNES.HISTOIRE_ID_MAX); if (t !== undefined) o.id = t;
    t = texteBorne(n.stats, 200); if (t !== undefined) o.stats = t;
    t = texteBorne(n.recit, 80); if (t !== undefined) o.recit = t;
    if (n.type === 'recompense') {
      if (!Array.isArray(n.objets) || n.objets.length > BORNES.HISTOIRE_OBJETS_MAX) return null;
      o.objets = [];
      for (var i = 0; i < n.objets.length; i++) {
        var ob = n.objets[i];
        if (!objet(ob) || !entierDans(ob.id, 1, 65535) || !entierDans(ob.n, 1, 999)) return null;
        o.objets.push({ id: ob.id, n: ob.n });
      }
    }
    return o;
  }
  function validerHistoireNotif(m) {
    if (!objet(m) || m.t !== MSG.HISTOIRE_NOTIF) return null;
    var j = joueurLocal(m.j);
    if (j < 0) return null;
    if (!Array.isArray(m.notifs) || m.notifs.length > BORNES.HISTOIRE_NOTIFS_MAX) return null;
    var notifs = [];
    for (var i = 0; i < m.notifs.length; i++) {
      var n = validerNotif(m.notifs[i]);
      if (!n) return null;
      notifs.push(n);
    }
    var r = { t: MSG.HISTOIRE_NOTIF, j: j, notifs: notifs };
    if (m.proposition !== undefined && m.proposition !== null) {
      var p = m.proposition;
      if (!objet(p) || typeof p.id !== 'string' || !p.id || p.id.length > BORNES.HISTOIRE_ID_MAX) return null;
      r.proposition = { id: p.id, titre: texteBorne(p.titre, 160) || '', texte: texteBorne(p.texte, BORNES.HISTOIRE_TEXTE_MAX) || '',
                        nom: texteBorne(p.nom, 80) || '' };
    }
    // le récit ne prend pas la parole : le client ouvre le commerce de l'habitant `eid`
    if (m.libre === true) {
      if (!entierDans(m.eid, 0, 2147483647)) return null;
      r.libre = true; r.eid = m.eid;
    }
    return r;
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
      case MSG.HISTOIRE_NOTIF: return validerHistoireNotif(m);
      case MSG.SUCCES_DEBLOQUE: return validerSuccesDebloque(m);
      case MSG.VEHICULE_EVT: return validerVehiculeEvt(m);
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
    validerHistoireParler: validerHistoireParler, validerHistoireReponse: validerHistoireReponse, validerHistoireNotif: validerHistoireNotif,
    validerRecu: validerRecu, validerPauseEtat: validerPauseEtat, validerReseauEtat: validerReseauEtat,
    validerHistoireEtat: validerHistoireEtat, validerSuccesDebloque: validerSuccesDebloque,
    EVT_VEHICULE: EVT_VEHICULE, MOTIFS_VEHICULE: MOTIFS_VEHICULE,
    validerVehiculePoser: validerVehiculePoser, validerVehiculeMonter: validerVehiculeMonter,
    validerVehiculeDescendre: validerVehiculeDescendre, validerVehiculeReparer: validerVehiculeReparer, validerVehiculeEvt: validerVehiculeEvt,
    validerSuccesEtat: validerSuccesEtat, validerFoudroye: validerFoudroye,
    originesLocales: originesLocales, estAdresseLocale: estAdresseLocale, portsCandidats: portsCandidats,
    validerActionner: validerActionner,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
