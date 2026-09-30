/* spec-poste.js — le poste (src/poste.js) : la moitié navigateur de la liaison
   avec le serveur de jeu local (SPEC-ARCHI-009, 013, 015, 016, 017). Tout ce
   qui dépend du navigateur est remplacé par des faux : WebSocket, fetch,
   minuteries. Le comportement réel (vrai serveur, vraie page) est vérifié par
   tests/integration-archi-client.js. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var CA = MC.ContratsArchi;
  var mockStorage = G.mockStorage;

  // ── faux ─────────────────────────────────────────────────────────────────
  function fauxTemps() {
    var t = { now: 1000, file: [], id: 0 };
    t.setTimeout = function (f, ms) { var id = ++t.id; t.file.push({ id: id, f: f, a: t.now + ms }); return id; };
    t.clearTimeout = function (id) { t.file = t.file.filter(function (x) { return x.id !== id; }); };
    t.avancer = function (ms) {
      var fin = t.now + ms;
      for (;;) {
        t.file.sort(function (a, b) { return a.a - b.a; });
        var x = t.file[0];
        if (!x || x.a > fin) break;
        t.file.shift(); t.now = x.a; x.f();
      }
      t.now = fin;
    };
    return t;
  }
  function fauxWS() {
    var liste = [];
    function WS(url) { this.url = url; this.readyState = 0; this.envoyes = []; liste.push(this); }
    WS.prototype.send = function (txt) { this.envoyes.push(JSON.parse(txt)); };
    WS.prototype.close = function () { this.readyState = 3; if (this.onclose) this.onclose(); };
    WS.prototype.ouvrir = function () { this.readyState = 1; if (this.onopen) this.onopen(); };
    WS.prototype.recevoir = function (obj) { if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) }); };
    WS.prototype.couper = function () { this.readyState = 3; if (this.onclose) this.onclose(); };
    WS.liste = liste;
    return WS;
  }
  // Promesse SYNCHRONE : le harness de tests est synchrone, une vraie Promise
  // ferait échouer les assertions en silence (src/poste.js accepte deps.Promise).
  function PS(exec) {
    var self = this; this.etat = 'p'; this.v = undefined; this.cbs = [];
    try { exec(function (v) { self._fin('r', v); }, function (e) { self._fin('e', e); }); } catch (e) { self._fin('e', e); }
  }
  PS.prototype._fin = function (etat, v) {
    if (this.etat !== 'p') return;
    if (etat === 'r' && v && typeof v.then === 'function') { var self = this; v.then(function (x) { self._fin('r', x); }, function (x) { self._fin('e', x); }); return; }
    this.etat = etat; this.v = v;
    var l = this.cbs; this.cbs = []; l.forEach(function (f) { f(); });
  };
  PS.prototype.then = function (ok, ko) {
    var self = this;
    return new PS(function (res, rej) {
      function run() {
        try {
          if (self.etat === 'r') res(ok ? ok(self.v) : self.v);
          else if (ko) res(ko(self.v));
          else rej(self.v);
        } catch (e) { rej(e); }
      }
      if (self.etat === 'p') self.cbs.push(run); else run();
    });
  };
  PS.resolve = function (v) { return new PS(function (r) { r(v); }); };
  PS.reject = function (e) { return new PS(function (r, j) { j(e); }); };
  // résultat d'une promesse synchrone déjà réglée (lève sa raison si elle a échoué)
  function resultat(p) {
    if (p.etat === 'r') return p.v;
    if (p.etat === 'e') throw p.v;
    throw new Error('promesse non réglée');
  }
  function echec(p) {
    if (p.etat === 'e') return p.v;
    throw new Error('la promesse devait échouer (état ' + p.etat + ')');
  }
  // fetch scripté : routes[chemin] = fonction(corps) → { code, json } | Error
  function fauxFetch(routes) {
    var f = function (url, opts) {
      var chemin = url.replace(/^https?:\/\/[^/]+/, '');
      f.appels.push({ chemin: chemin, opts: opts });
      var r = routes[chemin];
      if (!r) return PS.resolve({ status: 404, text: function () { return PS.resolve('404 introuvable'); } });
      var v = typeof r === 'function' ? r(opts && opts.body ? JSON.parse(opts.body) : undefined) : r;
      if (v instanceof Error) return PS.reject(v);
      return PS.resolve({ status: v.code, text: function () { return PS.resolve(typeof v.json === 'string' ? v.json : JSON.stringify(v.json)); } });
    };
    f.appels = [];
    return f;
  }
  function creerPoste(extra) {
    var temps = fauxTemps(), WS = fauxWS();
    var deps = Object.assign({
      WebSocket: WS, location: { protocol: 'http:', host: 'localhost:8080', origin: 'http://localhost:8080' },
      fetch: fauxFetch({}), Promise: PS, setTimeout: temps.setTimeout, clearTimeout: temps.clearTimeout, now: function () { return temps.now; },
    }, extra || {});
    return { poste: MC.Poste.creer(deps), temps: temps, WS: WS, deps: deps };
  }
  var OK_LISTE = { code: 200, json: { ok: true, actif: null, parties: [], reseau: 'ferme', port: 8080, adresses: ['127.0.0.1', '::1'], monde: { pause: false, rev: 0 } } };

  describe('Poste — liaison du navigateur avec le serveur de jeu local', {
    teste: 'src/poste.js : pause émise selon l\'état de session, état du réseau, détection du serveur (fichier, serveur de fichiers, injoignable), reconnexion, API des parties, import des parties du navigateur.',
    pourquoi: 'C\'est la seule moitié navigateur de l\'architecture « toujours un serveur » : une pause mal émise gèlerait ou non le monde à tort, une détection ratée laisserait un écran figé.',
    attendu: 'la pause suit exactement menu/pause vs jeu (jamais l\'inventaire), l\'état du réseau se lit via ETAT_RESEAU, chaque cause d\'échec est distinguée, la liaison de statut rejoue son état après une coupure.',
  }, function () {

    it('SPEC-ARCHI-009 : paused et menu émettent PAUSE {actif:true}, playing PAUSE {actif:false}', function () {
      var c = creerPoste();
      c.poste.connecter();
      var ws = c.WS.liste[0]; ws.ouvrir();
      c.poste.surEtatSession('paused');
      A.deep(ws.envoyes[ws.envoyes.length - 1], { t: 'pause', actif: true });
      c.poste.surEtatSession('playing');
      A.deep(ws.envoyes[ws.envoyes.length - 1], { t: 'pause', actif: false });
      c.poste.surEtatSession('menu');
      A.deep(ws.envoyes[ws.envoyes.length - 1], { t: 'pause', actif: true });
      A.ok(ws.envoyes.every(function (m) { return CA.validerPause(m) !== null; }), 'chaque message respecte le contrat');
    });

    it('SPEC-ARCHI-009 : ouvrir l\'inventaire (ui), mourir (dead) ou toute autre transition n\'émet aucun PAUSE', function () {
      var c = creerPoste();
      c.poste.connecter();
      var ws = c.WS.liste[0]; ws.ouvrir();
      c.poste.surEtatSession('playing');
      var n = ws.envoyes.length;
      ['ui', 'dead', 'fin', 'inconnu', undefined].forEach(function (e) { c.poste.surEtatSession(e); });
      A.equal(ws.envoyes.length, n, 'rien de plus n\'est émis');
      A.equal(MC.Poste.pauseVoulue('ui'), null);
    });

    it('SPEC-ARCHI-009 : un état répété n\'est pas réémis, et l\'état voulu est rejoué à chaque (re)connexion', function () {
      var c = creerPoste();
      c.poste.connecter();
      var ws = c.WS.liste[0]; ws.ouvrir();
      c.poste.surEtatSession('paused'); c.poste.surEtatSession('paused'); c.poste.surEtatSession('menu');
      A.equal(ws.envoyes.length, 1, 'un seul PAUSE pour trois transitions équivalentes');
      // coupure (serveur relancé) puis reconnexion : l\'état voulu est rejoué
      ws.couper();
      c.temps.avancer(300);
      var ws2 = c.WS.liste[1];
      A.ok(ws2, 'la liaison se rétablit d\'elle-même');
      ws2.ouvrir();
      A.deep(ws2.envoyes[0], { t: 'pause', actif: true }, 'PAUSE rejoué à la reconnexion');
    });

    it('SPEC-ARCHI-009 : PAUSE_ETAT et RESEAU_ETAT reçus mettent l\'état à jour (messages invalides ignorés)', function () {
      var c = creerPoste();
      c.poste.connecter();
      var ws = c.WS.liste[0]; ws.ouvrir();
      ws.recevoir({ t: 'pause_etat', actif: true, rev: 4 });
      A.equal(c.poste.etat.pause, true); A.equal(c.poste.etat.pauseRev, 4);
      ws.recevoir({ t: 'reseau_etat', etat: 'ouvert', port: 8081, adresses: ['192.168.1.2'] });
      A.equal(c.poste.etat.reseau, 'ouvert'); A.equal(c.poste.etat.port, 8081);
      ws.recevoir({ t: 'reseau_etat', etat: 'distant', port: 1, adresses: [] });      // hors contrat
      ws.recevoir({ t: 'pause_etat', actif: 'oui', rev: 1 });
      ws.onmessage({ data: 'pas du json' });
      A.equal(c.poste.etat.reseau, 'ouvert', 'un message hors contrat ne change rien');
      A.equal(c.poste.etat.pause, true);
    });

    it('SPEC-ARCHI-039 : l\'état du réseau se lit par ETAT_RESEAU — fermé, ouvert, ou distant si le jeu est connecté à une autre machine', function () {
      var c = creerPoste();
      A.equal(c.poste.etatReseau(false), CA.ETAT_RESEAU.FERME);
      c.poste.connecter(); var ws = c.WS.liste[0]; ws.ouvrir();
      ws.recevoir({ t: 'reseau_etat', etat: 'ouvert', port: 8080, adresses: [] });
      A.equal(c.poste.etatReseau(false), CA.ETAT_RESEAU.OUVERT);
      A.equal(c.poste.etatReseau(true), CA.ETAT_RESEAU.DISTANT, 'un hôte distant prime');
    });

    it('SPEC-ARCHI-005 : définir le réseau émet RESEAU et attend RESEAU_ETAT ; arrêter émet ARRET et coupe la reconnexion', function () {
      var c = creerPoste();
      c.poste.connecter(); var ws = c.WS.liste[0]; ws.ouvrir();
      var p = c.poste.definirReseau(true);
      A.deep(ws.envoyes[ws.envoyes.length - 1], { t: 'reseau', ouvert: true });
      ws.recevoir({ t: 'reseau_etat', etat: 'ouvert', port: 8080, adresses: ['10.0.0.1'] });
      var recu = resultat(p);
      A.ok(recu && recu.etat === 'ouvert', 'la promesse rend le RESEAU_ETAT');
      // sans réponse : null au bout du délai
      var p2 = c.poste.definirReseau(false, 1000);
      c.temps.avancer(1100);
      A.equal(resultat(p2), null, 'délai dépassé → null');
      c.poste.arreter();
      A.deep(ws.envoyes[ws.envoyes.length - 1], { t: 'arret' });
      ws.couper();
      c.temps.avancer(5000);
      A.equal(c.WS.liste.length, 1, 'après ARRET plus aucune reconnexion');
    });

    it('SPEC-ARCHI-016 : page ouverte en file:// → cause « fichier », sans aucune requête réseau', function () {
      var f = fauxFetch({});
      var c = creerPoste({ location: { protocol: 'file:', host: '' }, fetch: f });
      var r = resultat(c.poste.attendreServeur());
      A.equal(r.ok, false); A.equal(r.cause, 'fichier');
      A.equal(f.appels.length, 0, 'aucune requête');
      A.equal(c.poste.actif(), false);
    });

    it('SPEC-ARCHI-016 : un serveur de fichiers quelconque (404 sur /api/parties) → cause « absent », tout de suite', function () {
      var f = fauxFetch({});                                   // tout répond 404
      var c = creerPoste({ fetch: f });
      var r = resultat(c.poste.attendreServeur());
      A.equal(r.ok, false); A.equal(r.cause, 'absent');
      A.equal(f.appels.length, 1, 'inutile de réessayer');
      A.equal(c.poste.etat.serveur, 'absent');
    });

    it('SPEC-ARCHI-016 : une réponse 200 qui n\'est pas celle du serveur de jeu (page HTML) est aussi « absent »', function () {
      var f = fauxFetch({ '/api/parties': { code: 200, json: '<html>index</html>' } });
      var c = creerPoste({ fetch: f });
      A.equal(resultat(c.poste.sonder()).cause, 'absent');
    });

    it('SPEC-ARCHI-017 : serveur injoignable → réessais puis échec « injoignable » au bout de 15 s (jamais un écran figé)', function () {
      var f = fauxFetch({ '/api/parties': new Error('ECONNREFUSED') });
      var c = creerPoste({ fetch: f });
      var p = c.poste.attendreServeur();
      A.equal(p.etat, 'p', 'pas encore réglée : on réessaie');
      c.temps.avancer(14000);
      A.equal(p.etat, 'p', 'toujours en attente avant 15 s');
      c.temps.avancer(2000);
      var r = resultat(p);
      A.ok(r.ok === false && r.cause === 'injoignable', 'échec injoignable');
      A.ok(f.appels.length > 10, 'plusieurs essais avant d\'abandonner : ' + f.appels.length);
      A.equal(c.poste.etat.serveur, 'injoignable');
    });

    it('SPEC-ARCHI-017 : un serveur qui démarre pendant l\'attente est reconnu dès qu\'il répond', function () {
      var n = 0;
      var f = fauxFetch({ '/api/parties': function () { n++; return n < 4 ? new Error('ECONNREFUSED') : OK_LISTE; } });
      var c = creerPoste({ fetch: f });
      var p = c.poste.attendreServeur();
      c.temps.avancer(1500);
      A.ok(resultat(p).ok, 'reconnu');
      A.equal(c.poste.actif(), true);
    });

    it('SPEC-ARCHI-017 : un serveur qui répond (200) est reconnu, avec l\'état du réseau, du port et de la pause', function () {
      var f = fauxFetch({ '/api/parties': { code: 200, json: { ok: true, actif: 'p1', parties: [{ id: 'p1' }], reseau: 'ouvert', port: 8090, adresses: ['1.2.3.4'], monde: { pause: true, rev: 2 } } } });
      var c = creerPoste({ fetch: f });
      A.ok(resultat(c.poste.sonder()).ok);
      A.equal(c.poste.actif(), true);
      A.equal(c.poste.etat.reseau, 'ouvert'); A.equal(c.poste.etat.port, 8090);
      A.equal(c.poste.etat.pause, true); A.equal(c.poste.etat.pauseRev, 2);
      A.equal(c.poste.etat.partieActive, 'p1');
    });

    it('SPEC-ARCHI-013 : l\'API des parties — créer, renommer, supprimer, erreurs remontées avec leur motif', function () {
      var f = fauxFetch({
        '/api/parties': function (corps) { return corps ? { code: 201, json: { ok: true, partie: { id: 'p9', nom: corps.nom, graine: corps.graine } } } : OK_LISTE; },
        '/api/parties/renommer': function (c) { return { code: 200, json: { ok: true, partie: { id: c.id, nom: c.nom } } }; },
        '/api/parties/supprimer': { code: 200, json: { ok: true } },
        '/api/parties/charger': { code: 404, json: { ok: false, motif: 'partie_inconnue' } },
      });
      var c = creerPoste({ fetch: f });
      var p = resultat(c.poste.creerPartie({ nom: 'Alpha', mode: 'survie', difficulte: 'facile', graine: 42 }));
      A.equal(p.id, 'p9'); A.equal(p.graine, 42);
      A.equal(resultat(c.poste.renommerPartie('p9', 'Beta')).nom, 'Beta');
      A.equal(resultat(c.poste.supprimerPartie('p9')), true);
      A.deep(resultat(c.poste.lister()), []);
      var e = echec(c.poste.chargerPartie('nulle'));
      A.equal(e.motif, 'partie_inconnue'); A.equal(e.code, 404);
    });

    it('SPEC-ARCHI-036 : « Sauvegarder » est une DEMANDE au serveur (POST /api/parties/sauver), jamais une écriture locale', function () {
      var f = fauxFetch({ '/api/parties/sauver': { code: 200, json: { ok: true, ecrite: true } } });
      var c = creerPoste({ fetch: f });
      var r = resultat(c.poste.sauvegarder());
      A.deep(r, { ok: true, ecrite: true, motif: null });
      A.equal(f.appels.length, 1); A.equal(f.appels[0].chemin, '/api/parties/sauver'); A.equal(f.appels[0].opts.method, 'POST');
      var f2 = fauxFetch({ '/api/parties/sauver': { code: 409, json: { ok: false, motif: 'pas_de_partie' } } });
      var r2 = resultat(creerPoste({ fetch: f2 }).poste.sauvegarder());
      A.deep(r2, { ok: false, ecrite: false, motif: 'pas_de_partie' });
      var e = echec(creerPoste({ fetch: fauxFetch({ '/api/parties/sauver': new Error('reseau') }) }).poste.sauvegarder());
      A.equal(e.message, 'reseau');
    });

    it('SPEC-ARCHI-013 : charger une partie attend que le serveur relancé réponde avec cette partie active', function () {
      var essais = 0;
      var f = fauxFetch({
        '/api/parties/charger': { code: 200, json: { ok: true, relance: true, partie: { id: 'p2' } } },
        '/api/parties': function () {
          essais++;
          if (essais < 3) return new Error('ECONNREFUSED');                         // le serveur redémarre
          return { code: 200, json: { ok: true, actif: 'p2', parties: [], reseau: 'ferme', port: 8080, adresses: [], monde: { pause: false, rev: 0 } } };
        },
      });
      var c = creerPoste({ fetch: f });
      var p = c.poste.chargerPartie('p2');
      A.equal(p.etat, 'p', 'en attente pendant la relance');
      c.temps.avancer(1200);
      A.equal(resultat(p).id, 'p2', 'résolu une fois la partie active');
      A.ok(essais >= 3, 'plusieurs sondes pendant la relance : ' + essais);
    });

    it('SPEC-ARCHI-013 : charger la partie déjà active ne relance rien', function () {
      var f = fauxFetch({ '/api/parties/charger': { code: 200, json: { ok: true, relance: false, partie: { id: 'p2' } } } });
      var c = creerPoste({ fetch: f });
      A.equal(resultat(c.poste.chargerPartie('p2')).id, 'p2');
      A.equal(f.appels.length, 1, 'aucune sonde d\'attente');
    });

    it('SPEC-ARCHI-015 : les parties du navigateur non encore importées sont proposées, envoyées, puis notées', function () {
      var st = mockStorage();
      var a = MC.Saves.creer(st, { nom: 'A', graine: 1 });
      MC.Saves.creer(st, { nom: 'B', graine: 2 });
      var vues = null;
      var f = fauxFetch({ '/api/parties/importer': function (doc) { vues = doc; return { code: 200, json: { ok: true, importees: doc.parties.map(function (p) { return p.meta.id; }), ignorees: [] } }; } });
      var c = creerPoste({ fetch: f });
      A.equal(c.poste.partiesLocalesAImporter(st).length, 2);
      var r = resultat(c.poste.importerLocales(st));
      A.equal(r.importees.length, 2);
      A.equal(vues.format, 'minicraft-parties');
      A.equal(c.poste.partiesLocalesAImporter(st).length, 0, 'plus rien à proposer');
      var reste = c.poste.exporterLocales(st, [a.id]);
      A.equal(reste.parties.length, 1, 'export filtré par identifiants');
      A.equal(reste.parties[0].meta.id, a.id);
      A.ok(JSON.parse(c.poste.texteExport(st)).parties.length === 2, 'le texte exporté contient tout');
      var r2 = resultat(c.poste.importerLocales(st));
      A.equal(r2.importees.length, 0, 'un second appel n\'envoie rien');
      A.equal(f.appels.filter(function (x) { return x.chemin === '/api/parties/importer'; }).length, 1);
    });

    it('SPEC-ARCHI-015 : une partie que le serveur a ignorée (corrompue) n\'est pas notée comme importée', function () {
      var st = mockStorage();
      var bonne = MC.Saves.creer(st, { nom: 'Bonne', graine: 1 });
      var mauvaise = MC.Saves.creer(st, { nom: 'Mauvaise', graine: 2 });
      var f = fauxFetch({ '/api/parties/importer': { code: 200, json: { ok: true, importees: [bonne.id], ignorees: [{ id: mauvaise.id, motif: 'corrompue' }] } } });
      var c = creerPoste({ fetch: f });
      var r = resultat(c.poste.importerLocales(st));
      A.equal(r.ignorees.length, 1);
      var restantes = c.poste.partiesLocalesAImporter(st).map(function (m) { return m.id; });
      A.deep(restantes, [mauvaise.id], 'la corrompue reste proposée (pour signalement)');
    });

    it('SPEC-ARCHI-015 : le téléchargement d\'export passe par le hook injecté (nom de fichier minicraft-parties.json)', function () {
      var st = mockStorage();
      MC.Saves.creer(st, { nom: 'A', graine: 1 });
      var vu = null;
      var c = creerPoste({ telecharger: function (nom, texte) { vu = { nom: nom, texte: texte }; return true; } });
      A.equal(c.poste.telechargerExport(st), true);
      A.equal(vu.nom, 'minicraft-parties.json');
      A.equal(JSON.parse(vu.texte).parties.length, 1);
      A.equal(creerPoste().poste.telechargerExport(st), false, 'sans navigateur : refus propre');
    });
  });

  describe('Latence locale — prédiction du mouvement', {
    teste: "La position prédite après l'application d'une entrée (MC.Synchro.enregistrer + rejouer, ce que fait game.js dans la même image).",
    pourquoi: "Avec le serveur toujours présent, le mouvement du joueur ne doit JAMAIS attendre un aller-retour réseau : c'est la prédiction qui garde le solo aussi réactif qu'avant.",
    attendu: 'la position change immédiatement, de façon synchrone, avant toute réponse du serveur.',
  }, function () {
    it("SPEC-ARCHI-018 : la position prédite change dans la même image que l'entrée, avant tout aller-retour réseau", function () {
      var w = G.flatWorld(10);
      var ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents, MC.Modes.regles('survie', 'facile'));
      pl.state.pos.x = 8.5; pl.state.pos.y = 11.01; pl.state.pos.z = 8.5;
      var pred = MC.Synchro.creerPrediction();
      var avant = { x: pl.state.pos.x, z: pl.state.pos.z };
      var envoyees = [];                                        // ce qui partirait vers le serveur : rien n'est jamais reçu ici
      var e = pred.enregistrer(0.016, { forward: 1 }, 0, 0, false);
      envoyees.push(e);
      MC.Synchro.rejouer(pl, [e]);
      var apres = Math.hypot(pl.state.pos.x - avant.x, pl.state.pos.z - avant.z);
      A.gt(apres, 0, "la position a bougé sans qu'aucune réponse du serveur ne soit arrivée");
      A.equal(pred.enAttente.length, 1, "l'entrée reste en attente de confirmation (réconciliation)");
      A.equal(envoyees.length, 1);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
