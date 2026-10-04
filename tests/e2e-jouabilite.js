/* e2e-jouabilite.js — lot « tests de jouabilité / synchro client-serveur »
   (SPEC-JOUABLE-001 à 009). Une garantie de qualité avant tout nouveau lot :
   le joueur ne bouge pas tout seul, rien de ce qu'il fait ne s'annule.

   Chaque test joue dans la VRAIE page du jeu (vrai rendu, vraie boucle,
   vraies touches et vrais clics) contre un VRAI serveur de jeu lancé pour lui
   par le serveur du banc (POST /tests/serveur-jeu : survie paisible ou
   créatif, aux vraies règles — poser se paie sur l'inventaire du serveur).
   Rien n'est simulé côté réseau : un ESPION se contente d'écouter la socket
   de la page (horodatage de chaque message reçu) pour expliquer un échec.

   Le serveur est relu INDÉPENDAMMENT de ce qu'affiche la page :
     - blocs : une seconde connexion (« Témoin ») demande les overrides du
       chunk (OVERRIDES_DEMANDE) — c'est aussi « un second client » ;
     - coffre : le Témoin ouvre le même coffre (CONTENEUR_OUVRIR) ;
     - inventaire : l'API d'administration du serveur de jeu, relayée par
       le banc (GET /tests/serveur-jeu/inventaire).

   Toute action est suivie d'une observation à CHAQUE image pendant au moins
   4 s d'horloge réelle (ATTENTE_APRES_ACTION_MS) : un retour arrière, même
   bref, est daté et rapporté. Les attentes de préparation sont des sondages
   bornés, jamais des délais fixes. Un échec dit la nature du problème
   (tests/jouabilite-analyse.js, SPEC-JOUABLE-009). */
(function (G) {
  'use strict';
  var API = G.E2E_API, J = G.MC_JOUABILITE;
  if (!API || !J) return;
  var e2e = API.enregistreur('tests/e2e-jouabilite.js');
  var A = API.A, T = API.T, frames = API.frames, key = API.key, fakeLock = API.fakeLock,
      mouseDown = API.mouseDown, mouseUp = API.mouseUp, reset = API.reset, sonder = API.sonderE2E,
      capture = API.capture;

  var ATTENTE_APRES_ACTION_MS = 4000;     // « attendre trois ou quatre secondes après l'action »
  var DUREE_IMMOBILE_MS = 8000;
  var PSEUDO = 'Jouable';

  function maintenant() { return performance.now(); }
  function Cr() { return MC.Core; }

  // ─── espion de la socket de la page (écoute seulement) ────────────────────
  /* Remplace le constructeur WebSocket le temps de la connexion : la socket
     vers le serveur de jeu (et elle seule) reçoit un écouteur de plus, qui
     horodate chaque message reçu (ETAT résumé à toi[0]), et note les envois
     (hors entrées 'e', 60 par seconde). La page reçoit exactement les mêmes
     messages, dans le même ordre. */
  function poserEspion(port) {
    var Orig = G.WebSocket;
    var sp = { recus: [], envoyes: [], etats: [], nEtats: 0, socket: null };
    function Espionne(url, protocoles) {
      var s = protocoles === undefined ? new Orig(url) : new Orig(url, protocoles);
      if (!sp.socket && String(url).indexOf(':' + port) >= 0) {
        sp.socket = s;
        s.addEventListener('message', function (ev) {
          var m;
          try { m = JSON.parse(ev.data); } catch (e) { return; }
          var t = maintenant();
          if (m && m.t === 'etat') {
            var toi = m.toi && m.toi[0];
            if (toi) {
              sp.nEtats++;
              sp.etats.push({ n: sp.nEtats, t: t, x: toi.x, y: toi.y, z: toi.z, s: toi.s, sol: toi.sol, vol: toi.vol, vy: toi.vy });
              if (sp.etats.length > 6000) sp.etats.splice(0, 2000);
            }
            return;
          }
          sp.recus.push({ t: t, m: m });
          if (sp.recus.length > 3000) sp.recus.splice(0, 1000);
        });
        var envoi = s.send;
        s.send = function (d) {
          try { var m = JSON.parse(d); if (m && m.t === 'e') sp.dernierEnvoye = m.s; else if (m) sp.envoyes.push({ t: maintenant(), m: m }); } catch (e) { /* binaire */ }
          return envoi.apply(s, arguments);
        };
      }
      return s;
    }
    Espionne.prototype = Orig.prototype;
    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { Espionne[k] = Orig[k]; });
    G.WebSocket = Espionne;
    sp.retirer = function () { if (G.WebSocket === Espionne) G.WebSocket = Orig; };
    sp.dernierEtat = function () { return sp.etats[sp.etats.length - 1] || null; };
    return sp;
  }

  // ─── partie sur un vrai serveur de jeu ────────────────────────────────────
  /* Graines FIXES, essayées dans l'ordre : le monde de jeu ne dépend jamais de
     l'état laissé par les tests précédents (la graine de la page change au fil
     d'une campagne). Une graine dont le point d'apparition n'est pas sur la
     terre ferme (eau à proximité) est écartée, avec la raison. */
  var GRAINES = [20260921, 20261004, 4242, 777777, 13579];

  /* `preparer` : une attente de PRÉPARATION (sondage borné) qui échoue avec
     un message explicite, jamais en silence. */
  async function preparer(cond, ms, quoi) {
    A.ok(await sonder(cond, ms), 'préparation : ' + quoi + ' (non atteint en ' + (ms / 1000) + ' s)');
  }

  /* `opts.sol` : le test a besoin d'un bloc de sol sec que la visée du jeu
     touche (casser, poser, coffre). Il est cherché ICI, une fois le joueur au
     repos et le terrain autour de lui chargé (sondages bornés, 45 s) ; une
     graine sans candidat est écartée avec son diagnostic, jamais en silence. */
  async function demarrerPartie(g, mode, inv, opts) {
    opts = opts || {};
    var graineAvant = g.world.seed, ecartees = [], t0 = maintenant();
    for (var k = 0; k < GRAINES.length; k++) {
      var p = await connecterServeurJeu(g, mode, inv, GRAINES[k], graineAvant);
      var terrain = await terrainSousJoueur(g, p);
      if (terrain.ok && opts.sol) {
        await attendreRepos(g, p, mode === 'survie');
        p.sol = await solVise(g, 15000);
        if (!p.sol) terrain = { ok: false, motif: 'aucun sol sec visable — ' + solVise.dernierDiag };
      }
      if (terrain.ok) return p;
      ecartees.push(GRAINES[k] + ' : ' + terrain.motif + ' (après ' + Math.round(maintenant() - t0) + ' ms)');
      await quitterPartie(g, p);
    }
    A.ok(false, 'préparation : aucune graine de la liste fixe ne convient — ' + ecartees.join(' ; '));
  }

  // les chunks autour du joueur (rayon 1 : 3×3) sont générés côté page
  function chunksAutour(g) {
    var st = g.player.state, cx0 = Math.floor(st.pos.x / 16), cz0 = Math.floor(st.pos.z / 16), n = 0;
    for (var cx = cx0 - 1; cx <= cx0 + 1; cx++) for (var cz = cz0 - 1; cz <= cz0 + 1; cz++) if (g.world.getChunk(cx, cz)) n++;
    return n;
  }

  /* Le point d'apparition donné par le serveur est sur la terre ferme : sol
     solide sous les pieds (terrain chargé), aucun liquide à 4 blocs autour. */
  async function terrainSousJoueur(g, p) {
    var verdict = null, t0 = maintenant();
    await sonder(function () {
      var st = g.player.state;
      if (!p.sp.dernierEtat() || chunksAutour(g) < 9) return false;   // état du serveur reçu, terrain 3×3 généré côté page
      var fx = Math.floor(st.pos.x), fy = Math.floor(st.pos.y), fz = Math.floor(st.pos.z), sol = false;
      for (var y = fy; y >= fy - 6 && !sol; y--) if (Cr().isSolid(g.world.getBlock(fx, y, fz))) sol = true;
      if (!sol) return false;                                   // terrain pas encore chargé : on attend
      for (var dx = -4; dx <= 4; dx++) for (var dz = -4; dz <= 4; dz++) for (var dy = -3; dy <= 1; dy++) {
        if (liquide(g.world.getBlock(fx + dx, fy + dy, fz + dz))) {
          verdict = { ok: false, motif: 'liquide près du point d\'apparition (' + (fx + dx) + ',' + (fy + dy) + ',' + (fz + dz) + ')' };
          return true;
        }
      }
      verdict = { ok: true };
      return true;
    }, 45000);
    return verdict || { ok: false, motif: 'terrain non prêt en 45 s (chunks 3×3 chargés ' + chunksAutour(g) + '/9, joueur ' + JSON.stringify(g.player.state.pos) + ', ' + Math.round(maintenant() - t0) + ' ms)' };
  }

  async function connecterServeurJeu(g, mode, inv, graine, graineAvant) {
    await reset(g);
    var rep = null;
    try {
      var r = await fetch('/tests/serveur-jeu', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: mode, difficulte: 'paisible', graine: graine, inv: inv || [] }) });
      rep = await r.json();
    } catch (e) { rep = { ok: false, motif: String(e && e.message || e) }; }
    var p = { g: g, mode: mode, graine: graine, graineAvant: graineAvant, port: rep && rep.port, sp: null, temoin: null };
    if (!rep || !rep.ok) {
      A.ok(false, 'serveur de jeu de test indisponible (POST /tests/serveur-jeu, banc lancé avec server.js --tests) : ' + JSON.stringify(rep));
    }
    p.sp = poserEspion(rep.port);
    try {
      g.rejoindreServeur({ pseudo: PSEUDO, joueurs: 1, hote: 'ws://127.0.0.1:' + rep.port });
      fakeLock(g, true);
      await sonder(function () { return g.net.etat === 'en ligne' || g.net.etat === 'erreur'; }, 30000);
    } finally { p.sp.retirer(); }
    try {
      A.equal(g.net.etat, 'en ligne', 'connecté au serveur de jeu (' + mode + ')');
      A.equal(g.regles.mode.id, mode, 'la page a adopté les règles du serveur');
    } catch (e) { await quitterPartie(g, p); throw e; }   // les tests suivants retrouvent la page hors ligne
    return p;
  }

  async function quitterPartie(g, p) {
    if (p && p.sp) p.sp.retirer();
    try { key('KeyW', 'keyup'); key('Space', 'keyup'); mouseUp(0); mouseUp(2); } catch (e) { /* rien */ }
    if (p && p.temoin) { try { p.temoin.deconnecter(); } catch (e) { /* déjà parti */ } }
    if (g.ui.isContainerOpen()) { key('Escape'); await frames(2); }
    g.net.deconnecter();
    await sonder(function () { return g.net.etat !== 'en ligne'; }, 5000);
    try { await fetch('/tests/serveur-jeu/arreter', { method: 'POST' }); } catch (e) { /* banc sans serveur */ }
    g.adopterRegles('survie', 'facile', null);
    // le monde de la page a reçu les blocs du serveur de jeu : on rend aux autres tests un monde neuf
    if (p) g.remplacerMonde(p.graineAvant);
    fakeLock(g, true); g.input.setState('playing');
    await reset(g);
  }

  /* Prêt à mesurer : le serveur a envoyé l'état du joueur, le terrain sous
     lui est chargé, et (au sol / en vol) son corps ne bouge plus côté serveur
     depuis 0,5 s. Sondage borné (45 s) : si le joueur bouge sans fin, on
     mesure quand même — et la mesure le dira, avec le détail. */
  /* Ce que dit le journal du serveur de jeu (boucle bloquée, exceptions,
     refus) : joint aux échecs de préparation pour distinguer un serveur figé
     par la charge de la machine d'un vrai désaccord client-serveur. */
  async function journalServeurJeu() {
    try {
      var o = await (await fetch('/tests/serveur-jeu/journal')).json();
      var l = String(o && o.journal || '').split(/\r?\n/).filter(function (x) { return /bloqu|EXCEPTION|erreur|refus|ATTENTION/i.test(x); });
      return '\n journal du serveur de jeu : ' + (l.length ? l.slice(-8).join(' | ') : '(rien de notable)');
    } catch (e) { return '\n journal du serveur de jeu illisible : ' + (e && e.message); }
  }

  async function attendreRepos(g, p, auSol) {
    var st = g.player.state, sp = p.sp;
    /* Un serveur figé (charge de la machine) n'envoie plus rien : « aucun ETAT
       nouveau » ressemblerait à de l'immobilité. Le repos n'est donc admis que
       si les relevés ARRIVENT (au moins 3 dans la dernière demi-seconde, le
       dernier frais) et que le serveur traite les entrées du client (son
       acquittement progresse d'au moins 10 entrées par demi-seconde). */
    st = null;
    var stable = await sonder(function () {
      st = g.player.state;
      var e = sp.dernierEtat(), t = maintenant();
      if (!e || t - e.t > 250) return false;
      if (auSol && !(e.sol === 1 && st.onGround)) return false;
      if (!auSol && !(e.vol === 1 && st.flying)) return false;
      var depuis = e.t - 500, ref = null, ok = true, n = 0, sMin = e.s;
      for (var i = sp.etats.length - 1; i >= 0 && sp.etats[i].t >= depuis; i--) {
        var x = sp.etats[i];
        n++;
        if (x.s < sMin) sMin = x.s;
        if (!ref) ref = x;
        else if (Math.hypot(x.x - ref.x, x.y - ref.y, x.z - ref.z) > 1e-4) ok = false;
      }
      // le serveur TRAITE les entrées du client (acquittement en progrès), il n'est pas figé
      return ok && n >= 3 && e.s - sMin >= 10 && i >= 0 && Math.hypot(st.pos.x - e.x, st.pos.y - e.y, st.pos.z - e.z) < 1e-3;
    }, 60000);
    if (!stable) {
      var e = sp.dernierEtat();
      attendreRepos.diag = 'dernier ETAT ' + (e ? Math.round(maintenant() - e.t) + ' ms avant, acquitté s=' + e.s + ' pour ' + sp.dernierEnvoye + ' envoyées, sol=' + e.sol + ' vol=' + e.vol +
        ', serveur (' + e.x.toFixed(3) + ',' + e.y.toFixed(3) + ',' + e.z.toFixed(3) + ')' : 'aucun') +
        ', client (' + st.pos.x.toFixed(3) + ',' + st.pos.y.toFixed(3) + ',' + st.pos.z.toFixed(3) + ') sol=' + st.onGround + ' vol=' + st.flying + await journalServeurJeu();
    }
    return stable;
  }

  /* Mesure l'immobilité à chaque image pendant `dureeMs` (horloge réelle) :
     position du client, et position du serveur (ETAT.toi, via l'espion). */
  async function mesurerImmobilite(g, p, dureeMs, verifier) {
    var st = g.player.state, sp = p.sp;
    var t0 = maintenant();
    var dernierN = sp.nEtats, toi = sp.dernierEtat();
    var client = [{ t: 0, x: st.pos.x, y: st.pos.y, z: st.pos.z, etats: 0, deltaServeur: 0 }];
    var serveur = toi ? [{ t: 0, x: toi.x, y: toi.y, z: toi.z }] : [];
    var anomalies = [];
    /* au moins `dureeMs` d'horloge réelle ET au moins 31 relevés du serveur : un serveur affamé par la
       charge de la machine (relevés espacés de plusieurs secondes) prolonge la mesure, jusqu'à 60 s */
    while (maintenant() - t0 < dureeMs || (serveur.length < 31 && maintenant() - t0 < 60000)) {
      await frames(1);
      var nouveaux = sp.etats.filter(function (e) { return e.n > dernierN; });
      if (nouveaux.length) dernierN = nouveaux[nouveaux.length - 1].n;
      var delta = 0;
      nouveaux.forEach(function (e) {
        if (toi) delta = Math.max(delta, Math.hypot(e.x - toi.x, e.y - toi.y, e.z - toi.z));
        toi = e;
        serveur.push({ t: e.t - t0, x: e.x, y: e.y, z: e.z, info: 'ETAT s=' + e.s + ' sol=' + e.sol + ' vy=' + (typeof e.vy === 'number' ? e.vy.toFixed(3) : e.vy) + ' ; client y=' + st.pos.y.toFixed(4) + ' sol=' + (st.onGround ? 1 : 0) + '' + (g.player.state === st ? '' : ' (JOUEUR REMPLACÉ : mesure sur un état périmé)') });
      });
      var t = maintenant() - t0;
      client.push({ t: t, x: st.pos.x, y: st.pos.y, z: st.pos.z, etats: nouveaux.length, ecart: g.ecartReseau, deltaServeur: delta });
      if (verifier) { var a = verifier(toi); if (a && anomalies.length < 10) anomalies.push('t=' + Math.round(t) + ' ms : ' + a); }
    }
    var trou = 0;
    for (var q = 1; q < serveur.length; q++) trou = Math.max(trou, serveur[q].t - serveur[q - 1].t);
    return { client: J.analyserPositions(client), serveur: J.analyserPositions(serveur, { source: 'serveur : ETAT.toi (position tenue par le serveur)' }), anomalies: anomalies, plusGrandTrouEtat: Math.round(trou) };
  }

  // ─── visée et terrain ─────────────────────────────────────────────────────
  function liquide(id) { var d = Cr().BLOCKS[id]; return !!(d && d.liquid); }
  function voisinageSec(g, x, y, z) {
    var w = g.world;
    return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].every(function (d) {
      return !liquide(w.getBlock(x + d[0], y + d[1], z + d[2]));
    });
  }
  /* Un bloc de surface tendre (pelle ou main), à 2 ou 3 blocs du joueur, avec
     de l'air au-dessus sur deux hauteurs et aucun liquide autour : le casser
     ou poser dessus ne dépend d'aucune physique (eau, sable qui tombe). */
  function chercherSol(g, exclus) {
    var C = Cr(), st = g.player.state, w = g.world;
    var fx = Math.floor(st.pos.x), fy = Math.floor(st.pos.y), fz = Math.floor(st.pos.z);
    // toutes les colonnes à 2 à 4 blocs du joueur (hors de son corps, à portée de la visée), les plus proches d'abord
    var dirs = [];
    for (var ax = -4; ax <= 4; ax++) for (var az = -4; az <= 4; az++) {
      var dh = Math.hypot(ax, az);
      if (dh >= 2 && dh <= 4) dirs.push([ax, az, dh]);
    }
    dirs.sort(function (a, b) { return a[2] - b[2]; });
    var terre = [C.B.GRASS, C.B.DIRT, C.B.SAND, C.B.RED_SAND];
    // d'abord de la terre ou du sable (rien qui pousse ni ne tombe), sinon tout bloc plein et tendre
    for (var passe = 0; passe < 2; passe++) {
      for (var k = 0; k < dirs.length; k++) {
        var x = fx + dirs[k][0], z = fz + dirs[k][1];
        for (var y = fy + 1; y >= fy - 3; y--) {
          var id = w.getBlock(x, y, z);
          if (!id) continue;
          var d = C.BLOCKS[id];
          if (!d || d.liquid || !C.isSolid(id) || !(d.hardness > 0 && d.hardness <= 1)) break;
          if (passe === 0 && terre.indexOf(id) < 0) break;
          if (w.getBlock(x, y + 1, z) !== 0 || w.getBlock(x, y + 2, z) !== 0) break;
          if (!voisinageSec(g, x, y, z) || !voisinageSec(g, x, y + 1, z)) break;
          if (exclus && exclus(x, y, z)) break;
          return { x: x, y: y, z: z, id: id };
        }
      }
    }
    return null;
  }
  /* Oriente le regard vers le centre de la face supérieure (ou d'une face
     donnée) du bloc, puis vérifie que la visée du JEU (player.aim) le touche. */
  async function viser(g, b, face) {
    var st = g.player.state;
    var n = face || { x: 0, y: 1, z: 0 };
    var cible = { x: b.x + 0.5 + n.x * 0.5, y: b.y + 0.5 + n.y * 0.5, z: b.z + 0.5 + n.z * 0.5 };
    var oeil = g.player.eyePos();
    var dx = cible.x - oeil.x, dy = cible.y - oeil.y, dz = cible.z - oeil.z;
    st.yaw = Math.atan2(-dx, -dz);
    st.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    await frames(2);
    var t = g.player.aim();
    return !!(t && t.x === b.x && t.y === b.y && t.z === b.z);
  }
  /* Le premier sol candidat que la visée du jeu touche vraiment (un autre
     bloc peut masquer la face visée) — null si aucun. */
  async function solVise(g, delaiMs) {
    /* Le terrain autour du joueur peut être encore en génération (monde neuf,
       workers) : on réessaie par sondage borné tant qu'aucun candidat n'est visé. */
    var t0 = maintenant(), fin = t0 + (delaiMs || 15000), images = 0, rates = {};
    do {
      rates = {};
      for (var k = 0; k < 24; k++) {
        var b = chercherSol(g, function (x, y, z) { return !!rates[x + ',' + y + ',' + z]; });
        if (!b) break;
        if (await viser(g, b)) return b;
        rates[b.x + ',' + b.y + ',' + b.z] = 1;
      }
      await frames(10); images += 10;
    } while (maintenant() < fin);
    solVise.dernierDiag = diagSol(g, rates, maintenant() - t0, images);
    return null;
  }
  /* Ce qui empêche de trouver un sol visable : graine, position, chunks
     chargés autour du joueur, motifs de rejet des colonnes, temps et images. */
  function diagSol(g, rates, ecoule, images) {
    var C = Cr(), st = g.player.state, w = g.world;
    var fx = Math.floor(st.pos.x), fy = Math.floor(st.pos.y), fz = Math.floor(st.pos.z);
    var cx0 = Math.floor(fx / 16), cz0 = Math.floor(fz / 16), charges = 0, total = 0;
    for (var cx = cx0 - 1; cx <= cx0 + 1; cx++) for (var cz = cz0 - 1; cz <= cz0 + 1; cz++) { total++; if (w.getChunk(cx, cz)) charges++; }
    var motifs = {};
    function noter(m) { motifs[m] = (motifs[m] || 0) + 1; }
    for (var ax = -6; ax <= 6; ax++) for (var az = -6; az <= 6; az++) {
      var dh = Math.hypot(ax, az);
      if (dh < 2 || dh > 6) continue;
      var x = fx + ax, z = fz + az, vu = false;
      if (!w.getChunk(Math.floor(x / 16), Math.floor(z / 16))) { noter('chunk absent'); continue; }
      for (var y = fy + 2; y >= fy - 8; y--) {
        var id = w.getBlock(x, y, z);
        if (!id) continue;
        vu = true;
        var d = C.BLOCKS[id];
        if (!d) noter('id inconnu');
        else if (d.liquid) noter('liquide');
        else if (!C.isSolid(id)) noter('plante/non plein (' + d.name + ')');
        else if (!(d.hardness > 0 && d.hardness <= 1)) noter('trop dur (' + d.name + ')');
        else if (w.getBlock(x, y + 1, z) !== 0 || w.getBlock(x, y + 2, z) !== 0) noter('pas d\'air au-dessus');
        else if (!voisinageSec(g, x, y, z) || !voisinageSec(g, x, y + 1, z)) noter('liquide voisin');
        else if (rates[x + ',' + y + ',' + z]) noter('visée ratée');
        else if (y < fy - 3 || y > fy + 1 || dh > 4) noter('hors de la plage cherchée (dy ' + (y - fy) + ', d ' + dh.toFixed(1) + ')');
        else noter('candidat');
        break;
      }
      if (!vu) noter('colonne vide');
    }
    return 'graine ' + w.seed + ', joueur (' + st.pos.x.toFixed(2) + ',' + st.pos.y.toFixed(2) + ',' + st.pos.z.toFixed(2) + ') ' +
      (st.flying ? 'en vol' : st.onGround ? 'au sol' : 'en l\'air') + ', chunks 3×3 chargés ' + charges + '/' + total +
      ', colonnes (rayon 6) : ' + JSON.stringify(motifs) + ', ' + Math.round(ecoule) + ' ms et ' + images + ' images de recherche';
  }

  // ─── observation après une action ─────────────────────────────────────────
  /* Relève `lire()` à chaque image jusqu'à ce que `dureeMs` se soient écoulées
     depuis `depuis` (l'instant de l'action) — jamais moins. */
  async function observer(lire, depuis, dureeMs) {
    var ech = [];
    do { ech.push({ t: maintenant(), v: lire() }); await frames(1); } while (maintenant() - depuis < dureeMs);
    ech.push({ t: maintenant(), v: lire() });
    return ech;
  }
  function messageStabilite(titre, ana, attendu, journal, garder, t0) {
    var l = [titre + ' : attendu ' + attendu + ' pendant ' + (ana.duree_ms / 1000).toFixed(1) + ' s'];
    if (ana.premierEcart) l.push('  retour arrière à t=' + ana.premierEcart.t_ms + ' ms après l\'action : obtenu ' + ana.premierEcart.v);
    ana.changements.slice(0, 10).forEach(function (c) { l.push('  t=' + c.t_ms + ' ms : ' + c.de + ' → ' + c.vers); });
    l.push(' messages du serveur (t depuis l\'action) :');
    l.push(J.resumerMessages(journal, garder, t0));
    return l.join('\n');
  }
  function signatureInv(st) { return JSON.stringify(st.inv.serialize()); }
  /* Relecture bornée (45 s) : un serveur de jeu affamé par la charge de la
     machine peut ne pas répondre à temps au relais du banc (502) — on
     redemande ; à l'échec, les réponses obtenues sont citées. */
  var dernieresReponsesInv = [];
  async function inventaireServeur() {
    var fin = maintenant() + 45000;
    dernieresReponsesInv = [];
    do {
      try {
        var r = await fetch('/tests/serveur-jeu/inventaire?nom=' + encodeURIComponent(PSEUDO));
        var o = await r.json();
        if (o && o.ok) return o.data;
        dernieresReponsesInv.push(r.status + ' ' + JSON.stringify(o).slice(0, 120));
      } catch (e) { dernieresReponsesInv.push(String(e && e.message || e)); }
      await frames(30);
    } while (maintenant() < fin);
    return null;
  }
  /* Inventaire : le serveur (relu par l'administration) égale le client et
     l'attendu, case à case. */
  async function verifierInventaire(g, p, attendu, quand) {
    var st = g.player.state;
    var serv = await inventaireServeur();
    A.ok(serv, (serv ? '' : await journalServeurJeu()) + 'inventaire du serveur relu par l\'administration (' + quand + ') — réponses : ' + dernieresReponsesInv.slice(-3).join(' | '));
    var client = st.inv.serialize();
    var c1 = J.comparerInventaires(client, attendu), c2 = J.comparerInventaires(serv, attendu);
    A.ok(c1.ok && c2.ok, quand + ' : ' + J.messageInventaires('client / attendu', c1) + ' ; ' + J.messageInventaires('serveur / attendu', c2) +
      '\n client : ' + J.resumerInventaire(client) + '\n serveur : ' + J.resumerInventaire(serv) +
      '\n messages INV_MAJ :\n' + J.resumerMessages(p.sp.recus, function (m) { return m.t === 'inv_maj'; }, p.t0Action || 0));
  }
  function invAttendu(cases) {
    var out = [];
    for (var i = 0; i < 36; i++) out.push(0);
    Object.keys(cases).forEach(function (i) { out[+i] = cases[i]; });
    return out;
  }

  // ─── le Témoin : une seconde connexion qui relit le serveur ──────────────
  async function temoin(p) {
    var recu = { bienvenue: null, overrides: {}, conteneurs: [] };
    var cl = MC.createNetClient({
      onBienvenue: function (m) { recu.bienvenue = m; },
      onOverridesChunk: function (cx, cz, blocs) { recu.overrides[cx + ',' + cz] = blocs; },
      onConteneurEtat: function (m) { recu.conteneurs.push(m); },
    });
    p.temoin = cl;
    cl.connecter('ws://127.0.0.1:' + p.port, 'Temoin', 1);
    await sonder(function () { return cl.etat === 'en ligne' || cl.etat === 'erreur'; }, 45000);
    A.equal(cl.etat, 'en ligne', (cl.etat === 'en ligne' ? '' : await journalServeurJeu()) + 'le Témoin (second client) est admis par le serveur de jeu (' + (cl.erreur || 'sans erreur') + ')');
    return { cl: cl, recu: recu };
  }
  /* Ce que le serveur tient à (x, y, z), d'après les overrides du chunk
     demandés par le Témoin : l'id posé/cassé, ou null (bloc généré intact). */
  async function blocServeur(p, x, y, z) {
    var t = await temoin(p);
    try {
      var cx = Math.floor(x / 16), cz = Math.floor(z / 16), cle = cx + ',' + cz;
      t.cl.demanderOverrides(cx, cz);
      await sonder(function () { return !!t.recu.overrides[cle]; }, 30000);
      A.ok(t.recu.overrides[cle], 'le serveur répond aux overrides du chunk ' + cle);
      var b = t.recu.overrides[cle].filter(function (o) { return o[0] === x && o[1] === y && o[2] === z; })[0];
      var bv = ((t.recu.bienvenue && t.recu.bienvenue.blocs) || []).filter(function (o) { return o[0] === x && o[1] === y && o[2] === z; })[0];
      return { id: b ? b[3] : null, bienvenue: bv ? bv[3] : null };
    } finally { t.cl.deconnecter(); p.temoin = null; }
  }

  function messagesBloc(x, y, z) { return function (m) { return (m.t === 'bloc' && m.x === x && m.y === y && m.z === z) || m.t === 'refus' || (m.t === 'inv_maj' && m.refus); }; }

  // ══════════════════════════════════════════════════════════════════════════
  // Jouabilité — synchro client-serveur
  // ══════════════════════════════════════════════════════════════════════════

  e2e('SPEC-JOUABLE-001 : en survie, immobile au sol, la position ne change pas toute seule (8 s)', {
        "teste": "qu'un joueur en survie, au sol, sans toucher à rien, reste exactement à sa place pendant 8 s d'horloge réelle, côté client (chaque image) et côté serveur (chaque ETAT), sur un vrai serveur de jeu",
        "pourquoi": "le joueur immobile était régulièrement recalé (SPEC-ARCHI-045/047) : c'est la première chose qu'un joueur remarque, et la preuve que prédiction et serveur sont d'accord",
        "attendu": "écart à la position de départ < 0,001 bloc à chaque image et à chaque relevé du serveur ; sinon la liste des déplacements erronés (vecteur, décalage cumulé, intervalle, source probable)",
        "delai": 180
  }, async function (g) {
    var p = await demarrerPartie(g, 'survie', []);
    try {
      T.etape('repos');
      var auRepos = await attendreRepos(g, p, true);
      var st = g.player.state;
      A.ok(auRepos, 'préparation : joueur au repos au sol, relevés frais et entrées acquittées — non atteint en 60 s : ' + attendreRepos.diag);
      A.ok(st.onGround, 'le joueur est au sol');
      T.etape('immobile 8 s');
      var m = await mesurerImmobilite(g, p, DUREE_IMMOBILE_MS);
      capture('apres-immobilite');
      A.ok(m.client.ok && m.serveur.ok, 'SPEC-JOUABLE-001 : le joueur immobile a bougé\n' +
        J.messagePositions('client (chaque image)', m.client) + '\n' + J.messagePositions('serveur (ETAT.toi)', m.serveur));
      A.ok(m.client.echantillons > 100, 'mesure à chaque image (' + m.client.echantillons + ' relevés en ' + (m.client.duree_ms / 1000).toFixed(1) + ' s)');
      A.ok(m.serveur.echantillons > 30, (m.serveur.echantillons > 30 ? '' : await journalServeurJeu()) + 'le serveur a envoyé ses relevés pendant la mesure (' + m.serveur.echantillons + ' en ' + (m.serveur.duree_ms / 1000).toFixed(1) + ' s, plus grand intervalle entre deux ETAT ' + m.plusGrandTrouEtat + ' ms)');
    } finally { await quitterPartie(g, p); }
  });

  e2e('SPEC-JOUABLE-002 : en créatif, en vol statique, la position (hauteur comprise) ne change pas (8 s)', {
        "teste": "qu'un joueur en créatif qui monte en vol puis lâche tout reste exactement à sa place, altitude comprise, pendant 8 s, côté client et côté serveur, et vole toujours",
        "pourquoi": "en vol statique le joueur descendait ou était recalé (SPEC-ARCHI-045) : un vol qui dérive rend la construction en créatif impossible",
        "attendu": "écart < 0,001 bloc à chaque image et à chaque relevé du serveur, vol actif des deux côtés ; sinon la série des déplacements erronés avec leur source",
        "delai": 180
  }, async function (g) {
    var p = await demarrerPartie(g, 'creatif', []);
    try {
      var st = g.player.state;
      await preparer(function () { return !!p.sp.dernierEtat(); }, 30000, 'le serveur envoie l\'état du joueur (ETAT)');
      if (!st.flying) MC.Synchro.basculerVol(st);
      T.etape('montée');
      key('Space');
      var t0 = maintenant();
      await sonder(function () { return maintenant() - t0 > 700; }, 2000);
      key('Space', 'keyup');
      T.etape('arrêt');
      var auRepos = await attendreRepos(g, p, false);
      A.ok(auRepos, 'préparation : joueur en vol statique, relevés frais et entrées acquittées — non atteint en 60 s : ' + attendreRepos.diag);
      A.ok(st.flying, 'le joueur vole');
      T.etape('vol statique 8 s');
      var m = await mesurerImmobilite(g, p, DUREE_IMMOBILE_MS, function (toi) {
        if (!st.flying) return 'le client ne vole plus';
        if (toi && toi.vol !== 1) return 'le serveur ne fait plus voler le joueur (ETAT.toi.vol = ' + toi.vol + ')';
        return null;
      });
      capture('apres-vol-statique');
      A.ok(m.client.ok && m.serveur.ok && !m.anomalies.length, 'SPEC-JOUABLE-002 : en vol statique, le joueur a bougé\n' +
        J.messagePositions('client (chaque image)', m.client) + '\n' + J.messagePositions('serveur (ETAT.toi)', m.serveur) +
        (m.anomalies.length ? '\n vol : ' + m.anomalies.join(' ; ') : ''));
      A.ok(m.client.echantillons > 100, 'mesure à chaque image (' + m.client.echantillons + ' relevés)');
    } finally { await quitterPartie(g, p); }
  });

  /* Casser à la souris (clic gauche maintenu, comme un joueur) puis observer
     4 s : le bloc reste de l'air à chaque image, et le serveur le tient cassé. */
  async function scenarioCasser(g, mode) {
    var C = Cr();
    var p = await demarrerPartie(g, mode, mode === 'survie' ? [[C.I.IRON_SHOVEL, 1]] : [], { sol: true });
    try {
      var st = g.player.state;
      A.ok(await attendreRepos(g, p, mode === 'survie'), 'préparation : joueur au repos (au sol en survie, en vol en créatif), corps immobile côté serveur depuis 0,5 s, relevés frais et entrées acquittées — non atteint en 60 s : ' + attendreRepos.diag);
      st.selected = 0;
      var b = p.sol;
      A.ok(await viser(g, b), 'la visée du jeu touche le sol choisi (' + b.x + ',' + b.y + ',' + b.z + ') — ' + diagSol(g, {}, 0, 0));
      T.etape('casser');
      mouseDown(g, 0);
      await sonder(function () { return g.world.getBlock(b.x, b.y, b.z) === 0; }, 30000);
      mouseUp(0);
      var tAction = maintenant();
      p.t0Action = tAction;
      A.equal(g.world.getBlock(b.x, b.y, b.z), 0, 'le bloc a cédé sous la souris');
      T.etape('observation 4 s');
      var ech = await observer(function () { return g.world.getBlock(b.x, b.y, b.z); }, tAction, ATTENTE_APRES_ACTION_MS);
      var ana = J.analyserStabilite(ech, 0, tAction);
      A.ok(ana.ok, 'SPEC-JOUABLE-003 (' + mode + ') : le bloc cassé est revenu côté client\n' +
        messageStabilite('bloc (' + b.x + ',' + b.y + ',' + b.z + ')', ana, 0, p.sp.recus, messagesBloc(b.x, b.y, b.z), tAction));
      A.ok(ana.duree_ms >= ATTENTE_APRES_ACTION_MS, 'observé au moins 4 s après l\'action (' + ana.duree_ms + ' ms)');
      var serv = await blocServeur(p, b.x, b.y, b.z);
      A.ok(serv.id === 0, 'SPEC-JOUABLE-003 (' + mode + ') : 4 s après, le SERVEUR tient le bloc cassé (override ' + serv.id +
        ', attendu 0 ; vu à la connexion du Témoin : ' + serv.bienvenue + ')\n' + J.resumerMessages(p.sp.recus, messagesBloc(b.x, b.y, b.z), tAction));
      capture('apres-casse');
    } finally { await quitterPartie(g, p); }
  }

  e2e('SPEC-JOUABLE-003 : en créatif, un bloc cassé le reste (client et serveur, 4 s après)', {
        "teste": "qu'un bloc cassé à la souris en créatif reste de l'air à chaque image pendant au moins 4 s, et que le serveur, relu par une seconde connexion, le tient cassé",
        "pourquoi": "un bloc qui se reforme quelques instants après avoir été cassé rend le jeu injouable et trahit un désaccord client-serveur",
        "attendu": "id 0 à chaque image après la casse, override 0 côté serveur ; sinon l'instant du retour, la valeur revenue et le message BLOC du serveur",
        "delai": 180
  }, async function (g) { await scenarioCasser(g, 'creatif'); });

  e2e('SPEC-JOUABLE-003 : en survie, un bloc cassé le reste (client et serveur, 4 s après)', {
        "teste": "qu'un bloc cassé à la pelle (clic gauche maintenu) en survie reste de l'air à chaque image pendant au moins 4 s, et que le serveur, relu par une seconde connexion, le tient cassé",
        "pourquoi": "en survie la casse prend du temps et produit un butin : c'est le cas où client et serveur ont le plus d'occasions de diverger",
        "attendu": "id 0 à chaque image après la casse, override 0 côté serveur ; sinon l'instant du retour, la valeur revenue et le message BLOC du serveur",
        "delai": 180
  }, async function (g) { await scenarioCasser(g, 'survie'); });

  function planchesAutour(g, x, y, z) {
    var n = 0, P = Cr().B.PLANKS;
    for (var dx = -2; dx <= 2; dx++) for (var dy = -2; dy <= 2; dy++) for (var dz = -2; dz <= 2; dz++)
      if (g.world.getBlock(x + dx, y + dy, z + dz) === P) n++;
    return n;
  }

  /* Poser au clic droit, puis observer 4 s : le bloc posé est toujours là
     (client), le serveur le tient et un second client le voit. */
  async function scenarioPoser(g, mode) {
    var C = Cr();
    var p = await demarrerPartie(g, mode, [[C.B.PLANKS, 16]], { sol: true });
    try {
      var st = g.player.state;
      A.ok(await attendreRepos(g, p, mode === 'survie'), 'préparation : joueur au repos (au sol en survie, en vol en créatif), corps immobile côté serveur depuis 0,5 s, relevés frais et entrées acquittées — non atteint en 60 s : ' + attendreRepos.diag);
      st.selected = 0;
      await preparer(function () { return st.inv.count(C.B.PLANKS) === 16; }, 30000, 'les 16 planches de départ données par le serveur sont à l\'inventaire');
      var b = p.sol;
      A.ok(await viser(g, b), 'la visée du jeu touche le sol choisi (' + b.x + ',' + b.y + ',' + b.z + ') — ' + diagSol(g, {}, 0, 0));
      var x = b.x, y = b.y + 1, z = b.z;
      T.etape('poser');
      var tClic = maintenant();
      mouseDown(g, 2);
      await frames(1);
      mouseUp(2);
      await sonder(function () { return g.world.getBlock(x, y, z) === C.B.PLANKS; }, 15000);
      var tAction = maintenant();
      p.t0Action = tAction;
      A.ok(g.world.getBlock(x, y, z) === C.B.PLANKS, 'la planche est posée sur la face visée (obtenu ' + g.world.getBlock(x, y, z) +
        ' ; en main ' + JSON.stringify(g.player.held()) + ', visée ' + JSON.stringify(g.player.aim()) + ', état ' + g.input.state + ', vol ' + st.flying + ')\n' +
        J.resumerMessages(p.sp.recus, function (m) { return m.t === 'bloc' || m.t === 'refus' || m.t === 'inv_maj'; }, tClic) +
        '\n envoyés :\n' + J.resumerMessages(p.sp.envoyes, null, tClic));
      T.etape('observation 4 s');
      var ech = await observer(function () { return g.world.getBlock(x, y, z); }, tAction, ATTENTE_APRES_ACTION_MS);
      var ana = J.analyserStabilite(ech, C.B.PLANKS, tAction);
      A.ok(ana.ok, 'SPEC-JOUABLE-004 (' + mode + ') : le bloc posé a disparu côté client\n' +
        messageStabilite('bloc (' + x + ',' + y + ',' + z + ')', ana, C.B.PLANKS, p.sp.recus, messagesBloc(x, y, z), tAction));
      A.ok(ana.duree_ms >= ATTENTE_APRES_ACTION_MS, 'observé au moins 4 s après l\'action (' + ana.duree_ms + ' ms)');
      A.equal(planchesAutour(g, x, y, z), 1, 'un clic droit pose UN bloc, pas deux (planches à moins de 2 blocs de la cible)');
      var serv = await blocServeur(p, x, y, z);
      A.ok(serv.id === C.B.PLANKS, 'SPEC-JOUABLE-004 (' + mode + ') : 4 s après, le serveur et un second client voient le bloc posé (override ' + serv.id +
        ', attendu ' + C.B.PLANKS + ')\n' + J.resumerMessages(p.sp.recus, messagesBloc(x, y, z), tAction));
      // en survie la pose se paie (SPEC-SYNC-028), en créatif non (SPEC-MODE-005) — et le paiement ne s'annule pas non plus
      await verifierInventaire(g, p, invAttendu({ 0: [C.B.PLANKS, mode === 'survie' ? 15 : 16] }), 'inventaire après la pose');
      capture('apres-pose');
    } finally { await quitterPartie(g, p); }
  }

  e2e('SPEC-JOUABLE-004 : en créatif, un bloc posé reste (client, serveur et second client, 4 s après)', {
        "teste": "qu'une planche posée au clic droit en créatif est toujours là à chaque image pendant au moins 4 s, que le serveur la tient et qu'un second client la voit, sans rien coûter",
        "pourquoi": "un bloc posé qui disparaît au bout de quelques secondes est le symptôme le plus visible d'une pose refusée ou annulée par le serveur",
        "attendu": "la planche à chaque image, override PLANKS chez le second client, 16 planches à l'inventaire des deux côtés ; sinon l'instant de la disparition et le message du serveur",
        "delai": 180
  }, async function (g) { await scenarioPoser(g, 'creatif'); });

  e2e('SPEC-JOUABLE-004 : en survie, un bloc posé reste (client, serveur et second client, 4 s après)', {
        "teste": "qu'une planche posée au clic droit en survie, payée sur l'inventaire du serveur, est toujours là à chaque image pendant au moins 4 s, que le serveur la tient et qu'un second client la voit",
        "pourquoi": "en survie la pose dépend de l'inventaire du SERVEUR (SPEC-SYNC-028) : un désaccord d'inventaire se traduit par un bloc qui disparaît",
        "attendu": "la planche à chaque image, override PLANKS chez le second client, 15 planches des deux côtés ; sinon l'instant de la disparition et le message du serveur",
        "delai": 180
  }, async function (g) { await scenarioPoser(g, 'survie'); });

  // ─── inventaire ────────────────────────────────────────────────────────────
  function cliquer(el, bouton) {
    el.dispatchEvent(new MouseEvent('mousedown', { button: bouton || 0, bubbles: true, cancelable: true }));
  }
  function casesBarre() { return document.querySelectorAll('.inv-screen .hb-row .slot'); }
  function casesSac() {
    var grilles = [].slice.call(document.querySelectorAll('.inv-screen .inv-grid')).filter(function (el) {
      return !el.classList.contains('hb-row') && !el.classList.contains('inv-equip') && !el.closest('.inv-top') && !el.closest('.craft-grid') && !el.classList.contains('craft-grid');
    });
    var g27 = grilles.filter(function (el) { return el.querySelectorAll('.slot').length === 27; })[0];
    return g27 ? g27.querySelectorAll('.slot') : [];
  }
  function casesCoffre() { return document.querySelectorAll('.inv-screen .inv-top .inv-grid .slot'); }

  /* Observe l'inventaire 4 s après une action : il ne change plus (plus de
     retour arrière) et vaut l'attendu ; puis le serveur le confirme. */
  async function observerInventaire(g, p, attendu, quoi, tAction) {
    var st = g.player.state, sig = J.resumerInventaire(attendu);
    var ech = await observer(function () { return J.resumerInventaire(st.inv.serialize()); }, tAction, ATTENTE_APRES_ACTION_MS);
    var ana = J.analyserStabilite(ech, sig, tAction);
    A.ok(ana.ok, 'SPEC-JOUABLE-005/006/007 : ' + quoi + ' — l\'inventaire du client n\'est pas resté tel quel\n' +
      messageStabilite('inventaire', ana, sig, p.sp.recus, function (m) { return m.t === 'inv_maj' || m.t === 'refus' || m.t === 'donne'; }, tAction));
    A.ok(ana.duree_ms >= ATTENTE_APRES_ACTION_MS, 'observé au moins 4 s après l\'action (' + ana.duree_ms + ' ms)');
    p.t0Action = tAction;
    await verifierInventaire(g, p, attendu, quoi + ', 4 s après');
  }

  e2e('SPEC-JOUABLE-005 : glisser-déposer et demi-pile dans l\'inventaire ne s\'annulent pas (client = serveur, 4 s après)', {
        "teste": "qu'un déplacement de pile par glisser-déposer (clic gauche) et un dépôt d'une unité depuis une demi-pile (clic droit) faits dans l'écran d'inventaire restent en place pendant 4 s, et que l'inventaire du serveur est le même case à case",
        "pourquoi": "l'inventaire est prédit par le client puis confirmé par le serveur (INV_MAJ) : un désaccord fait revenir les objets à leur ancienne place quelques instants après",
        "attendu": "l'inventaire attendu à chaque image pendant 4 s après chaque action, identique côté serveur ; sinon l'instant du retour arrière, l'état revenu et les INV_MAJ (rev, ack, refus)",
        "delai": 180
  }, async function (g) {
    var C = Cr();
    var p = await demarrerPartie(g, 'survie', [[C.B.COBBLE, 10], [C.B.PLANKS, 8]]);
    try {
      var st = g.player.state;
      A.ok(await attendreRepos(g, p, true), 'préparation : joueur au repos (au sol en survie, en vol en créatif), corps immobile côté serveur depuis 0,5 s, relevés frais et entrées acquittées — non atteint en 60 s : ' + attendreRepos.diag);
      await preparer(function () { return st.inv.count(C.B.PLANKS) === 8 && st.inv.count(C.B.COBBLE) === 10; }, 30000, 'pierre ×10 et planches ×8 de départ à l\'inventaire');
      key('KeyE');
      await frames(2);
      A.equal(g.input.state, 'ui', 'l\'inventaire est ouvert');
      // glisser-déposer : la pierre de la case 0 de la barre vers la case 12 (sac)
      T.etape('glisser-déposer');
      cliquer(casesBarre()[0], 0);
      cliquer(casesSac()[3], 0);
      var t1 = maintenant();
      var attendu1 = invAttendu({ 1: [C.B.PLANKS, 8], 12: [C.B.COBBLE, 10] });
      A.equal(signatureInv(st), JSON.stringify(attendu1), 'la pile est arrivée en case 12 (affichage immédiat)');
      await observerInventaire(g, p, attendu1, 'glisser-déposer', t1);
      // demi-pile : clic droit sur les planches (4 en main), une unité déposée en case 2, puis on repose la main
      T.etape('demi-pile');
      cliquer(casesBarre()[1], 2);
      cliquer(casesBarre()[2], 2);
      cliquer(casesBarre()[1], 0);
      var t2 = maintenant();
      var attendu2 = invAttendu({ 1: [C.B.PLANKS, 7], 2: [C.B.PLANKS, 1], 12: [C.B.COBBLE, 10] });
      A.equal(signatureInv(st), JSON.stringify(attendu2), 'une planche est partie en case 2 (affichage immédiat)');
      await observerInventaire(g, p, attendu2, 'demi-pile', t2);
      key('Escape'); fakeLock(g, true); await frames(2);
      capture('apres-inventaire');
    } finally { await quitterPartie(g, p); }
  });

  /* Une direction dégagée devant le joueur (rien sur 6 blocs, aux pieds et
     à la tête) : l'objet jeté s'y envole sans rebondir contre un mur. */
  function directionDegagee(g) {
    var st = g.player.state, w = g.world;
    for (var a = 0; a < 16; a++) {
      var yaw = a * Math.PI / 8, libre = true;
      for (var d = 1; d <= 6 && libre; d++) {
        var x = Math.floor(st.pos.x - Math.sin(yaw) * d), z = Math.floor(st.pos.z - Math.cos(yaw) * d);
        for (var dy = 0; dy <= 2; dy++) if (w.getBlock(x, Math.floor(st.pos.y) + dy, z) !== 0) libre = false;
      }
      if (libre) return yaw;
    }
    return null;
  }

  e2e('SPEC-JOUABLE-006 : un objet jeté n\'est pas rendu au joueur immobile, puis SPEC-JOUABLE-007 : ramassé, il reste (4 s après chaque action)', {
        "teste": "que jeter un objet (touche G) en le lançant devant soi le sort de l'inventaire pour de bon — le joueur immobile ne le récupère pas dans les 4 s — puis que marcher dessus le ramasse et qu'il reste à l'inventaire 4 s après ; client et serveur identiques après chaque action",
        "pourquoi": "un objet jeté qui revient aussitôt dans l'inventaire (lâché aux pieds puis aimanté) annule l'action du joueur ; un objet ramassé qui ressort annulerait l'inverse",
        "attendu": "7 planches pendant 4 s après le jet (l'objet au sol, répliqué par le serveur), 8 pendant 4 s après le ramassage, inventaire du serveur identique ; sinon l'instant du retour et les INV_MAJ/DONNE du serveur",
        "delai": 180
  }, async function (g) {
    var C = Cr();
    var p = await demarrerPartie(g, 'survie', [[C.B.PLANKS, 8]]);
    try {
      var st = g.player.state;
      A.ok(await attendreRepos(g, p, true), 'préparation : joueur au repos (au sol en survie, en vol en créatif), corps immobile côté serveur depuis 0,5 s, relevés frais et entrées acquittées — non atteint en 60 s : ' + attendreRepos.diag);
      await preparer(function () { return st.inv.count(C.B.PLANKS) === 8; }, 30000, 'planches ×8 de départ à l\'inventaire');
      st.selected = 0;
      var yaw = directionDegagee(g);
      A.ok(yaw !== null, 'une direction dégagée sur 6 blocs');
      st.yaw = yaw; st.pitch = 0;
      await frames(3);
      T.etape('jeter');
      key('KeyG');
      var t1 = maintenant();
      A.equal(st.inv.count(C.B.PLANKS), 7, 'une planche quitte l\'inventaire (affichage immédiat)');
      await observerInventaire(g, p, invAttendu({ 0: [C.B.PLANKS, 7] }), 'jeter (G), joueur immobile', t1);
      var objet = null;
      g.net.mobsDistants.forEach(function (m) { if (m.type === 'item') objet = m; });
      A.ok(objet, 'l\'objet jeté est au sol, répliqué par le serveur');
      var dist = Math.hypot(objet.cible.x - st.pos.x, objet.cible.z - st.pos.z);
      A.ok(dist > 2.2, 'il est retombé devant le joueur, hors de portée de ramassage (' + dist.toFixed(2) + ' bloc)');
      // ramasser : on marche jusqu'à lui
      T.etape('ramasser');
      st.yaw = Math.atan2(-(objet.cible.x - st.pos.x), -(objet.cible.z - st.pos.z));
      key('KeyW');
      await sonder(function () { return st.inv.count(C.B.PLANKS) === 8; }, 20000);
      key('KeyW', 'keyup');
      var t2 = maintenant();
      A.equal(st.inv.count(C.B.PLANKS), 8, 'en marchant dessus, la planche revient à l\'inventaire');
      await observerInventaire(g, p, invAttendu({ 0: [C.B.PLANKS, 8] }), 'ramasser', t2);
      capture('apres-ramassage');
    } finally { await quitterPartie(g, p); }
  });

  e2e('SPEC-JOUABLE-008 : déposer et retirer dans un coffre ne s\'annule pas (client = serveur = réouverture, 4 s après)', {
        "teste": "qu'un coffre posé en survie, ouvert au clic droit, garde ce qu'on y dépose et ce qu'on en retire (clic gauche, demi-pile au clic droit) pendant 4 s, que le serveur (relu par une seconde connexion qui ouvre le même coffre) et l'inventaire du serveur sont identiques, et qu'une nouvelle ouverture montre le même contenu",
        "pourquoi": "le contenu d'un coffre est tenu par le serveur (SPEC-SYNC-012 à 015) et prédit par le client : un objet qui revient ou disparaît du coffre est une perte ou une duplication",
        "attendu": "coffre [pierre ×5, planche ×1] et inventaire [planches ×7 en 2, pierre ×5 en 5] à chaque image pendant 4 s, identiques chez le serveur et à la réouverture ; sinon l'instant du retour arrière et les messages cont_etat/cont_maj/inv_maj",
        "delai": 180
  }, async function (g) {
    var C = Cr(), CV = MC.ContratsV2;
    var p = await demarrerPartie(g, 'survie', [[C.B.CHEST, 1], [C.B.COBBLE, 10], [C.B.PLANKS, 8]], { sol: true });
    try {
      var st = g.player.state;
      A.ok(await attendreRepos(g, p, true), 'préparation : joueur au repos (au sol en survie, en vol en créatif), corps immobile côté serveur depuis 0,5 s, relevés frais et entrées acquittées — non atteint en 60 s : ' + attendreRepos.diag);
      await preparer(function () { return st.inv.count(C.B.CHEST) === 1 && st.inv.count(C.B.PLANKS) === 8; }, 30000, 'coffre, pierre et planches de départ à l\'inventaire');
      st.selected = 0;
      var b = p.sol;
      A.ok(await viser(g, b), 'la visée du jeu touche le sol choisi (' + b.x + ',' + b.y + ',' + b.z + ') — ' + diagSol(g, {}, 0, 0));
      T.etape('poser le coffre');
      mouseDown(g, 2); await frames(1); mouseUp(2);
      var pos = { x: b.x, y: b.y + 1, z: b.z };
      await sonder(function () { return g.world.getBlock(pos.x, pos.y, pos.z) === C.B.CHEST; }, 15000);
      A.equal(g.world.getBlock(pos.x, pos.y, pos.z), C.B.CHEST, 'le coffre est posé');
      await frames(10);
      A.notOk(g.ui.isContainerOpen(), 'le clic qui pose le coffre ne l\'ouvre pas aussi (un clic, une utilisation)');
      async function ouvrir() {
        A.ok(await viser(g, pos), 'la visée touche le coffre');
        var avant = g.ui.container && g.ui.container.cont;
        mouseDown(g, 2); await frames(1); mouseUp(2);
        await sonder(function () { return g.ui.container && g.ui.container.cont && g.ui.container.cont !== avant; }, 30000);
        var ouvert = !!(g.ui.container && g.ui.container.cont && g.ui.container.kind === 'chest');
        A.ok(ouvert, 'le coffre s\'ouvre au clic droit (CONTENEUR_ETAT du serveur)' + (ouvert ? '' : ' — visée ' + JSON.stringify(g.player.aim()) + ', état ' + g.input.state + await journalServeurJeu()));
        await frames(2);
      }
      function contenuCoffre() { return JSON.stringify(g.ui.container && g.ui.container.cont ? g.ui.container.cont.slots.map(CV.pileVersCase) : null); }
      T.etape('ouvrir');
      await ouvrir();
      var cle = g.ui.container.cont.cle;
      T.etape('déposer et retirer');
      cliquer(casesBarre()[1], 0);       // la pierre ×10 en main
      cliquer(casesCoffre()[0], 0);      // déposée dans le coffre
      cliquer(casesBarre()[2], 2);       // 4 planches en main
      cliquer(casesCoffre()[1], 2);      // une planche déposée
      cliquer(casesBarre()[2], 0);       // on repose la main
      cliquer(casesCoffre()[0], 2);      // 5 pierres reprises en main
      cliquer(casesBarre()[5], 0);       // retirées dans la case 5
      var tAction = maintenant();
      p.t0Action = tAction;
      var coffreAttendu = [];
      for (var i = 0; i < g.ui.container.cont.slots.length; i++) coffreAttendu.push(0);
      coffreAttendu[0] = [C.B.COBBLE, 5]; coffreAttendu[1] = [C.B.PLANKS, 1];
      var invAtt = invAttendu({ 2: [C.B.PLANKS, 7], 5: [C.B.COBBLE, 5] });
      A.equal(contenuCoffre(), JSON.stringify(coffreAttendu), 'le coffre montre aussitôt le dépôt et le retrait (cases : coffre ' + casesCoffre().length +
        ', barre ' + casesBarre().length + ', écran ' + (g.ui.container && g.ui.container.kind) + ', état ' + g.input.state + ', inv ' + J.resumerInventaire(st.inv.serialize()) + ')');
      A.equal(signatureInv(st), JSON.stringify(invAtt), 'l\'inventaire montre aussitôt le dépôt et le retrait');
      T.etape('observation 4 s');
      var ech = await observer(function () { return contenuCoffre() + '|' + signatureInv(st); }, tAction, ATTENTE_APRES_ACTION_MS);
      var ana = J.analyserStabilite(ech, JSON.stringify(coffreAttendu) + '|' + JSON.stringify(invAtt), tAction);
      A.ok(ana.ok, 'SPEC-JOUABLE-008 : le coffre ou l\'inventaire n\'est pas resté tel quel après dépôt/retrait\n' +
        messageStabilite('coffre|inventaire', ana, 'coffre ' + J.resumerInventaire(coffreAttendu) + ' | inv ' + J.resumerInventaire(invAtt),
          p.sp.recus, function (m) { return m.t === 'cont_etat' || m.t === 'cont_maj' || m.t === 'inv_maj' || m.t === 'refus'; }, tAction));
      // le serveur : un second client ouvre le même coffre
      var t = await temoin(p);
      try {
        t.cl.envoyer({ t: 'cont_ouvrir', j: 0, x: pos.x, y: pos.y, z: pos.z });
        await sonder(function () { return t.recu.conteneurs.length > 0; }, 30000);
        var ce = t.recu.conteneurs[0];
        A.ok(ce, 'le second client reçoit le contenu du coffre (CONTENEUR_ETAT)');
        A.equal(ce.cle, cle, 'c\'est le même coffre (clé ' + cle + ')');
        var cmp = J.comparerInventaires(ce.slots, coffreAttendu);
        A.ok(cmp.ok, 'SPEC-JOUABLE-008 : 4 s après, le coffre du SERVEUR — ' + J.messageInventaires('serveur / attendu', cmp));
      } finally { t.cl.deconnecter(); p.temoin = null; }
      await verifierInventaire(g, p, invAtt, 'inventaire après dépôt/retrait, 4 s après');
      // nouvelle ouverture : même contenu
      T.etape('rouvrir');
      key('Escape'); fakeLock(g, true); g.input.setState('playing');
      await preparer(function () { return !g.ui.isContainerOpen(); }, 3000, 'Échap referme le coffre');
      await frames(3);
      await ouvrir();
      A.equal(contenuCoffre(), JSON.stringify(coffreAttendu), 'SPEC-JOUABLE-008 : à la réouverture, le coffre montre le même contenu');
      capture('apres-reouverture');
      key('Escape'); fakeLock(g, true); await frames(2);
    } finally { await quitterPartie(g, p); }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
