/* poste.js — le « poste » : la liaison du navigateur avec le serveur de jeu
   local (chantier ARCHI, L50 ; SPEC-ARCHI-006, 009, 013, 015, 016, 017).

   Techniquement le jeu passe TOUJOURS par un serveur, que le joueur soit seul
   (réseau fermé), en écran partagé ou avec d'autres (réseau ouvert). Ce module
   est la moitié navigateur de cette architecture, à côté de la connexion de
   jeu (net.js) :
   - il détecte le serveur qui sert la page (`GET /api/parties`) et distingue
     « pas de serveur de jeu » (fichier local, serveur de fichiers quelconque)
     d'un serveur injoignable ;
   - il tient une connexion « de statut » (WebSocket, sans REJOINDRE) qui
     porte PAUSE, RESEAU et ARRET et dont la seule présence garde le serveur
     en vie tant que la page est ouverte (SPEC-ARCHI-008) ;
   - il enveloppe l'API des parties (créer, charger, renommer, supprimer,
     importer) et l'export/import des parties du navigateur (SPEC-ARCHI-015).

   Module PUR au sens des portes : aucune référence directe au navigateur,
   tout ce qui en dépend (WebSocket, fetch, location, minuteries, Blob) est
   INJECTÉ — ce qui permet de le tester sous Node avec des faux. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var CLE_IMPORTEES = 'minicraft.importees.v1';       // ids déjà envoyés au serveur (clé du stockage du navigateur)
  var DELAI_SERVEUR_MS = 15000;                        // SPEC-ARCHI-017 : serveur injoignable au bout de 15 s
  var ATTENTE_RECONNEXION_MS = [250, 500, 1000, 2000]; // paliers de reconnexion de la liaison de statut

  /* États de session du jeu qui pilotent la pause du serveur (SPEC-ARCHI-009) :
     le menu pause et le menu principal arrêtent le monde, le jeu le relance ;
     l'inventaire (`ui`), la mort, etc. ne changent RIEN (le monde continue). */
  function pauseVoulue(etatSession) {
    if (etatSession === 'paused' || etatSession === 'menu') return true;
    if (etatSession === 'playing') return false;
    return null;
  }

  function creer(deps) {
    deps = deps || {};
    var CA = MC.ContratsArchi;
    var NP = MC.NetProtocol;
    var WS = deps.WebSocket;
    var fetchFn = deps.fetch;
    var loc = deps.location || {};
    var minuterie = deps.setTimeout || function (f, ms) { return setTimeout(f, ms); };
    var annuler = deps.clearTimeout || function (t) { clearTimeout(t); };
    var maintenant = deps.now || function () { return Date.now(); };
    // promesses injectables : les tests (harness synchrone) fournissent une version immédiate
    var P = deps.Promise || Promise;

    var etat = {
      serveur: 'inconnu',          // 'inconnu' | 'ok' | 'absent' | 'injoignable'
      cause: null,                 // cause lisible d'un échec (SPEC-ARCHI-017)
      reseau: CA.ETAT_RESEAU.FERME,
      port: null, adresses: [],
      pause: false, pauseRev: 0,
      partieActive: null,
      connecte: false,             // liaison de statut ouverte
      actif: false,                // vrai une fois le serveur local reconnu
      arrete: false,               // ARRET envoyé : ne plus se reconnecter
    };
    var ws = null;
    var reconnexion = null, essais = 0;
    var pauseDemandee = null;      // dernière pause voulue par le jeu (true/false), rejouée à chaque (re)connexion
    var abonnes = [];

    function notifier() { abonnes.slice().forEach(function (f) { try { f(etat); } catch (e) { /* un abonné défaillant ne bloque pas les autres */ } }); }
    function surChangement(f) { abonnes.push(f); }

    // ── détection du serveur ───────────────────────────────────────────────
    function origine() {
      if (loc.origin && loc.origin !== 'null') return loc.origin;
      return (loc.protocol || 'http:') + '//' + (loc.host || 'localhost');
    }
    function urlWs() {
      var https = loc.protocol === 'https:';
      return (https ? 'wss:' : 'ws:') + '//' + loc.host;
    }
    function avecDelai(promesse, ms) {
      return new P(function (resolve, reject) {
        var t = minuterie(function () { reject(new Error('delai')); }, ms);
        promesse.then(function (v) { annuler(t); resolve(v); }, function (e) { annuler(t); reject(e); });
      });
    }
    function api(chemin, corps, delai) {
      var opts = corps === undefined ? { method: 'GET' } : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps),
      };
      return avecDelai(fetchFn(origine() + chemin, opts), delai || 8000).then(function (r) {
        return r.text().then(function (txt) {
          var json = null;
          try { json = JSON.parse(txt); } catch (e) { json = null; }
          return { code: r.status, json: json };
        });
      });
    }
    function retenir(j) {
      if (!j) return;
      if (j.reseau === CA.ETAT_RESEAU.OUVERT || j.reseau === CA.ETAT_RESEAU.FERME) etat.reseau = j.reseau;
      if (typeof j.port === 'number') etat.port = j.port;
      if (Array.isArray(j.adresses)) etat.adresses = j.adresses;
      if (j.monde) { etat.pause = !!j.monde.pause; if (typeof j.monde.rev === 'number') etat.pauseRev = j.monde.rev; }
      etat.partieActive = j.actif || null;
    }

    /* Une sonde : le serveur de jeu répond-il ? Renvoie { ok, cause } où cause
       vaut 'fichier' (page ouverte en file://), 'absent' (un serveur répond mais
       ce n'est pas un serveur MiniCraft : serveur de fichiers quelconque) ou
       'injoignable' (rien ne répond). */
    function sonder(delai) {
      if (loc.protocol === 'file:') {
        etat.serveur = 'absent'; etat.cause = 'fichier'; notifier();
        return P.resolve({ ok: false, cause: 'fichier' });
      }
      return api('/api/parties', undefined, delai || 3000).then(function (r) {
        if (r.code === 200 && r.json && r.json.ok === true && Array.isArray(r.json.parties)) {
          etat.serveur = 'ok'; etat.cause = null; etat.actif = true;
          retenir(r.json); notifier();
          return { ok: true, donnees: r.json };
        }
        etat.serveur = 'absent'; etat.cause = 'absent'; etat.actif = false; notifier();
        return { ok: false, cause: 'absent', code: r.code };
      }, function () {
        etat.serveur = 'injoignable'; etat.cause = 'injoignable'; etat.actif = false; notifier();
        return { ok: false, cause: 'injoignable' };
      });
    }
    /* Attend le serveur jusqu'à `total` ms (15 s par défaut, SPEC-ARCHI-017).
       Une page ouverte en file:// ou servie par un serveur qui n'est pas celui du
       jeu échoue tout de suite (inutile d'attendre) ; « injoignable » réessaie. */
    function attendreServeur(total, pas) {
      var fin = maintenant() + (total || DELAI_SERVEUR_MS);
      return new P(function (resolve) {
        (function essai() {
          sonder(2500).then(function (r) {
            if (r.ok) { resolve(r); return; }
            if (r.cause === 'fichier' || r.cause === 'absent') { resolve(r); return; }
            if (maintenant() >= fin) { resolve(r); return; }
            minuterie(essai, pas || 250);
          });
        })();
      });
    }

    // ── liaison de statut (PAUSE, RESEAU, ARRET) ───────────────────────────
    function envoyerBrut(msg) {
      if (!ws || ws.readyState !== 1) return false;
      try { ws.send(JSON.stringify(msg)); return true; } catch (e) { return false; }
    }
    function recevoir(texte) {
      var m;
      try { m = JSON.parse(texte); } catch (e) { return; }
      var v = CA.validerRecu(m);
      if (!v) return;
      if (v.t === CA.MSG.PAUSE_ETAT) { etat.pause = v.actif; etat.pauseRev = v.rev; notifier(); }
      else if (v.t === CA.MSG.RESEAU_ETAT) {
        etat.reseau = v.etat; etat.port = v.port; etat.adresses = v.adresses; notifier();
        var att = attentesReseau.slice(); attentesReseau.length = 0;
        att.forEach(function (f) { f(v); });
      }
    }
    var attentesReseau = [];
    function connecter() {
      if (ws || etat.arrete || !WS) return;
      var socket;
      try { socket = ws = new WS(urlWs()); } catch (e) { planifierReconnexion(); return; }
      socket.onopen = function () {
        if (ws !== socket) return;
        essais = 0; etat.connecte = true; notifier();
        // l'état voulu est rejoué à chaque (re)connexion : un serveur relancé ignore tout
        if (pauseDemandee !== null) envoyerBrut({ t: CA.MSG.PAUSE, actif: pauseDemandee });
      };
      socket.onmessage = function (ev) { if (ws === socket) recevoir(ev.data); };
      socket.onclose = function () {
        if (ws !== socket) return;
        ws = null; etat.connecte = false; notifier();
        if (!etat.arrete) planifierReconnexion();
      };
      socket.onerror = function () { /* onclose suit toujours */ };
    }
    function planifierReconnexion() {
      if (reconnexion || etat.arrete) return;
      var d = ATTENTE_RECONNEXION_MS[Math.min(essais, ATTENTE_RECONNEXION_MS.length - 1)];
      essais++;
      reconnexion = minuterie(function () { reconnexion = null; connecter(); }, d);
    }
    function fermerStatut() {
      if (reconnexion) { annuler(reconnexion); reconnexion = null; }
      var s = ws; ws = null; etat.connecte = false;
      if (s) { try { s.close(); } catch (e) { /* déjà fermée */ } }
    }

    /* SPEC-ARCHI-009 : appelé à chaque changement d'état de session du jeu
       (`input.setState`). Émis pour le POSTE, quel que soit le joueur local qui
       ouvre le menu ; ne fait rien pour `ui` (inventaire, conteneur). */
    function surEtatSession(etatSession) {
      var v = pauseVoulue(etatSession);
      if (v === null) return false;
      var change = pauseDemandee !== v;
      pauseDemandee = v;
      if (!change) return false;
      return envoyerBrut({ t: CA.MSG.PAUSE, actif: v });
    }

    /* Ouvre (true) ou ferme (false) le serveur au réseau. Résout avec le
       RESEAU_ETAT reçu, ou null si le serveur ne répond pas dans le délai. */
    function definirReseau(ouvert, delai) {
      return new P(function (resolve) {
        var ok = envoyerBrut({ t: CA.MSG.RESEAU, ouvert: !!ouvert });
        if (!ok) { resolve(null); return; }
        var t = minuterie(function () { var i = attentesReseau.indexOf(fin); if (i >= 0) attentesReseau.splice(i, 1); resolve(null); }, delai || 4000);
        function fin(v) { annuler(t); resolve(v); }
        attentesReseau.push(fin);
      });
    }
    /* « Quitter le jeu » : le serveur sauvegarde puis termine son processus. */
    function arreter() {
      var ok = envoyerBrut({ t: CA.MSG.ARRET });
      etat.arrete = true;
      if (reconnexion) { annuler(reconnexion); reconnexion = null; }
      return ok;
    }

    /* Le client lit l'état du réseau ICI, jamais dans `net.enLigne()` (qui est
       vrai dès qu'une connexion de jeu existe). `hoteDistant` : le jeu est
       connecté à un serveur d'une AUTRE machine (SPEC-ARCHI-039). */
    function etatReseau(hoteDistant) {
      return hoteDistant ? CA.ETAT_RESEAU.DISTANT : etat.reseau;
    }

    // ── API des parties ────────────────────────────────────────────────────
    function reponse(r, defaut) {
      if (r.json && r.json.ok) return r.json;
      var motif = (r.json && r.json.motif) || defaut || ('http_' + r.code);
      var e = new Error(motif); e.code = r.code; e.motif = motif;
      throw e;
    }
    function lister() {
      return api('/api/parties').then(function (r) { retenir(r.json); return reponse(r, 'liste_illisible').parties; });
    }
    function creerPartie(opts) {
      return api('/api/parties', {
        nom: opts.nom, mode: opts.mode, difficulte: opts.difficulte,
        graine: opts.graine === undefined ? null : opts.graine, histoire: opts.histoire || null,
      }).then(function (r) { return reponse(r).partie; });
    }
    /* Charge une partie : le serveur se relance sur elle (même port, même mode).
       Résout quand l'API répond de nouveau avec cette partie active. */
    function chargerPartie(id, delai) {
      return api('/api/parties/charger', { id: id }).then(function (r) {
        var j = reponse(r);
        if (!j.relance) return j.partie;
        return attendreActive(id, delai || 30000).then(function () { return j.partie; });
      });
    }
    function attendreActive(id, total) {
      var fin = maintenant() + total;
      return new P(function (resolve, reject) {
        (function essai() {
          sonder(2000).then(function (r) {
            if (r.ok && r.donnees.actif === id) { resolve(r.donnees); return; }
            if (maintenant() >= fin) { reject(new Error('relance_trop_longue')); return; }
            minuterie(essai, 150);
          });
        })();
      });
    }
    function renommerPartie(id, nom) { return api('/api/parties/renommer', { id: id, nom: nom }).then(function (r) { return reponse(r).partie; }); }
    function supprimerPartie(id) { return api('/api/parties/supprimer', { id: id }).then(function (r) { reponse(r); return true; }); }
    /* SPEC-ARCHI-036 : demande au serveur de sauvegarder la partie active MAINTENANT (« Sauvegarder »). */
    function sauvegarder() { return api('/api/parties/sauver', {}).then(function (r) { var j = r.json || {}; return { ok: !!j.ok, ecrite: !!j.ecrite, motif: j.motif || null }; }); }
    function importerExport(doc) { return api('/api/parties/importer', doc, 60000).then(reponse); }

    // ── parties du navigateur (SPEC-ARCHI-015) ─────────────────────────────
    function lireImportees(stockage) {
      try { var v = JSON.parse(stockage.getItem(CLE_IMPORTEES) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
    }
    function noterImportees(stockage, ids) {
      var deja = lireImportees(stockage);
      ids.forEach(function (i) { if (deja.indexOf(i) < 0) deja.push(i); });
      try { stockage.setItem(CLE_IMPORTEES, JSON.stringify(deja)); } catch (e) { /* stockage plein ou bloqué */ }
    }
    /* Les parties `localStorage` de cette origine, pas encore envoyées au serveur. */
    function partiesLocalesAImporter(stockage) {
      if (!stockage || !MC.Saves) return [];
      var deja = lireImportees(stockage);
      return MC.Saves.lister(stockage).filter(function (m) { return deja.indexOf(m.id) < 0; });
    }
    function exporterLocales(stockage, ids) {
      var doc = MC.PartiesFichier.exporter(stockage);
      if (ids) doc.parties = doc.parties.filter(function (p) { return ids.indexOf(p.meta.id) >= 0; });
      return doc;
    }
    /* Envoie au serveur les parties du navigateur non encore importées. Une
       partie que le serveur a acceptée est notée pour ne plus être proposée ;
       une partie ignorée (corrompue) est rapportée sans bloquer les autres. */
    function importerLocales(stockage) {
      var aFaire = partiesLocalesAImporter(stockage).map(function (m) { return m.id; });
      if (!aFaire.length) return P.resolve({ importees: [], ignorees: [] });
      var doc = exporterLocales(stockage, aFaire);
      return importerExport(doc).then(function (r) {
        // les ids d'origine des parties acceptées : le serveur en donne de nouveaux si l'id existait déjà
        var ignoresIds = (r.ignorees || []).map(function (i) { return i.id; });
        noterImportees(stockage, aFaire.filter(function (i) { return ignoresIds.indexOf(i) < 0; }));
        return r;
      });
    }
    function texteExport(stockage) { return JSON.stringify(exporterLocales(stockage)); }
    /* Fichier `minicraft-parties.json` téléchargé par le navigateur (Blob + lien). */
    function telechargerExport(stockage) {
      var d = deps.telecharger;
      if (!d) return false;
      return d('minicraft-parties.json', texteExport(stockage));
    }

    return {
      etat: etat, surChangement: surChangement,
      sonder: sonder, attendreServeur: attendreServeur,
      connecter: connecter, fermerStatut: fermerStatut,
      surEtatSession: surEtatSession, definirReseau: definirReseau, arreter: arreter, etatReseau: etatReseau,
      actif: function () { return etat.actif; },
      lister: lister, creerPartie: creerPartie, chargerPartie: chargerPartie,
      renommerPartie: renommerPartie, supprimerPartie: supprimerPartie, sauvegarder: sauvegarder, importerExport: importerExport,
      partiesLocalesAImporter: partiesLocalesAImporter, importerLocales: importerLocales,
      exporterLocales: exporterLocales, texteExport: texteExport, telechargerExport: telechargerExport,
    };
  }

  MC.Poste = { creer: creer, pauseVoulue: pauseVoulue, CLE_IMPORTEES: CLE_IMPORTEES, DELAI_SERVEUR_MS: DELAI_SERVEUR_MS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
