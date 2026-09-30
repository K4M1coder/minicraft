/* spec-secu.js — tests Node purs de src/net-protocol.js : bornes de
   coordonnées (SPEC-SECU-008), trame non masquée (SPEC-SECU-004), constantes
   de sécurité (SPEC-SECU-003). Aucune socket ici : voir
   tests/integration-secu.js pour le comportement réel du serveur (try/catch,
   anti-flood, sauvegarde atomique…). */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var N = MC.NetProtocol;

  function alloue(n) { return new Uint8Array(n); }

  describe('Specs — sécurité réseau (net-protocol)', function () {

    // ── SPEC-SECU-003 : constante de tampon exportée ──────────────────────
    it('SPEC-SECU-003 : TAMPON_MAX est une borne raisonnable (> plus gros message légitime)', function () {
      A.ok(N.TAMPON_MAX >= 4096, 'au moins la taille max d\'un message ADMIN (4000)');
      A.ok(N.TAMPON_MAX <= 16 * 1024 * 1024, 'reste borné, pas des dizaines de Mo');
    });

    // ── SPEC-SECU-008 : bornes de coordonnées ──────────────────────────────
    it('SPEC-SECU-008 : COORD_MAX reste très inférieur à 2^31 (où `|0` tronque)', function () {
      A.lt(N.COORD_MAX, Math.pow(2, 31));
      A.ok(N.COORD_MAX >= 1000000, 'assez large pour un monde plausible');
    });

    it('SPEC-SECU-008 : un BLOC à coordonnées plausibles est accepté', function () {
      var m = N.valider({ t: 'bloc', x: 10, y: 40, z: -20, id: 3 });
      A.ok(m, 'validé');
      A.equal(m.x, 10); A.equal(m.y, 40); A.equal(m.z, -20);
    });

    it('SPEC-SECU-008 : un BLOC à x/z hors de ±COORD_MAX est rejeté', function () {
      A.notOk(N.valider({ t: 'bloc', x: N.COORD_MAX + 1, y: 10, z: 0, id: 1 }), 'x trop grand');
      A.notOk(N.valider({ t: 'bloc', x: -(N.COORD_MAX + 1), y: 10, z: 0, id: 1 }), 'x trop négatif');
      A.notOk(N.valider({ t: 'bloc', x: 0, y: 10, z: N.COORD_MAX + 1, id: 1 }), 'z trop grand');
    });

    it('SPEC-SECU-008 : un BLOC à des coordonnées énormes (1e15) est rejeté sans planter', function () {
      A.notOk(N.valider({ t: 'bloc', x: 1e15, y: 10, z: 0, id: 1 }));
      A.notOk(N.valider({ t: 'bloc', x: 0, y: 1e15, z: 0, id: 1 }));
      A.notOk(N.valider({ t: 'bloc', x: Infinity, y: 10, z: 0, id: 1 }));
      A.notOk(N.valider({ t: 'bloc', x: NaN, y: 10, z: 0, id: 1 }));
    });

    it('SPEC-SECU-008 : y est borné à la hauteur réelle du monde ([0, WORLD_H-1])', function () {
      A.ok(N.valider({ t: 'bloc', x: 0, y: 0, z: 0, id: 1 }), 'y=0 accepté (sol)');
      A.ok(N.valider({ t: 'bloc', x: 0, y: N.WORLD_H - 1, z: 0, id: 1 }), 'y=WORLD_H-1 accepté (plafond)');
      A.notOk(N.valider({ t: 'bloc', x: 0, y: -1, z: 0, id: 1 }), 'y négatif rejeté');
      A.notOk(N.valider({ t: 'bloc', x: 0, y: N.WORLD_H, z: 0, id: 1 }), 'y = WORLD_H rejeté (hors du monde)');
      A.notOk(N.valider({ t: 'bloc', x: 0, y: 1000000, z: 0, id: 1 }), 'y démesuré rejeté');
    });

    it('SPEC-SECU-008 : DISTRIB applique les mêmes bornes qu un BLOC', function () {
      A.ok(N.valider({ t: 'distrib', x: 0, y: 5, z: 0, slots: [] }), 'coordonnées plausibles acceptées');
      A.notOk(N.valider({ t: 'distrib', x: 0, y: -5, z: 0, slots: [] }), 'y négatif rejeté');
      A.notOk(N.valider({ t: 'distrib', x: N.COORD_MAX * 10, y: 5, z: 0, slots: [] }), 'x démesuré rejeté');
    });

    it('SPEC-SECU-008 : BOUGE reste borné même si la position n est plus autoritaire', function () {
      A.ok(N.valider({ t: 'bouge', x: 10.5, y: 40.2, z: -3, yaw: 0, pitch: 0 }), 'position plausible acceptée');
      A.notOk(N.valider({ t: 'bouge', x: 1e15, y: 0, z: 0 }), 'x démesuré rejeté');
      A.notOk(N.valider({ t: 'bouge', x: 0, y: Infinity, z: 0 }), 'y infini rejeté');
    });

    // ── SPEC-SECU-004 : trame non masquée ──────────────────────────────────
    it('SPEC-SECU-004 : le décodeur signale explicitement une trame non masquée', function () {
      // une trame serveur (encodée par `encoder`) n est JAMAIS masquée — donc
      // représentative d une trame client fautive une fois « rejouée ».
      var f = N.encoder('salut', N.OP.TEXTE, alloue);
      var d = N.decoder(f);
      A.ok(d, 'décodée malgré tout : le décodeur ne doit jamais planter');
      A.equal(d.masque, false, 'le champ `masque` détecte explicitement l absence de masquage');
      A.equal(N.utf8Decoder(d.charge), 'salut', 'le contenu reste lisible pour que l appelant décide');
    });

    it('SPEC-SECU-004 : une trame client correctement masquée est signalée comme telle', function () {
      var octets = N.utf8Encoder('bonjour');
      var cle = [0x12, 0x34, 0x56, 0x78];
      var masques = octets.map(function (o, i) { return o ^ cle[i % 4]; });
      var buf = [0x81, 0x80 | octets.length].concat(cle, masques);
      var d = N.decoder(new Uint8Array(buf));
      A.ok(d, 'décodée');
      A.equal(d.masque, true, 'le masquage est détecté');
      A.equal(N.utf8Decoder(d.charge), 'bonjour', 'démasquée correctement');
    });

    // ── SPEC-SECU-010 : en-têtes de sécurité des fichiers statiques ────────
    it('SPEC-SECU-010 : entetesSecuriteStatiques() pose nosniff et une CSP compatible three.js/cdnjs', function () {
      var h = N.entetesSecuriteStatiques();
      A.equal(h['X-Content-Type-Options'], 'nosniff');
      var csp = h['Content-Security-Policy'];
      A.ok(csp && csp.indexOf('https://cdnjs.cloudflare.com') >= 0, 'cdnjs autorisé (three.js)');
      A.ok(csp.indexOf("default-src 'self'") >= 0, 'défaut restreint à soi-même');
      A.ok(csp.indexOf("object-src 'none'") >= 0, 'aucun plugin');
      A.notOk('X-Powered-By' in h, 'jamais de X-Powered-By');
    });

    // ── SPEC-SECU-011 : décision d'autorisation d'Origin ───────────────────
    it('SPEC-SECU-011 : sans liste configurée, aucune restriction (choix explicite par défaut)', function () {
      A.ok(N.origineAutorisee('http://evil.example', null), 'pas de liste = pas de restriction');
      A.ok(N.origineAutorisee(undefined, undefined), 'même sans Origin du tout');
      A.ok(N.origineAutorisee('http://localhost:8080', []), 'liste vide = pas de restriction');
    });
    it('SPEC-SECU-011 : avec une liste configurée, seule une origine listée passe', function () {
      var liste = ['http://localhost:8080', 'http://127.0.0.1:8080'];
      A.ok(N.origineAutorisee('http://localhost:8080', liste), 'origine attendue acceptée');
      A.notOk(N.origineAutorisee('http://ailleurs.example', liste), 'origine absente de la liste refusée');
      A.notOk(N.origineAutorisee(undefined, liste), 'Origin absent alors qu une liste est exigée : refusé');
    });

    // ── SPEC-SERVEUR-007 : plafond de ETAT.mobs et cadence adaptative ──────
    it('SPEC-SERVEUR-007 : MAX_MOBS_DIFFUSES est l invariant documenté (80)', function () {
      A.equal(N.MAX_MOBS_DIFFUSES, 80);
    });
    it('SPEC-SERVEUR-007 : selectionnerMobsProches ne dépasse jamais le plafond, trie par distance, filtre la portée', function () {
      var entites = [];
      for (var i = 0; i < 250; i++) entites.push({ pos: { x: i * 4, z: 0 }, id: i });
      var res = N.selectionnerMobsProches(entites, [{ x: 0, z: 0 }], N.PORTEE_MOBS_DIFFUSES, N.MAX_MOBS_DIFFUSES);
      A.ok(res.length <= N.MAX_MOBS_DIFFUSES, 'jamais plus de ' + N.MAX_MOBS_DIFFUSES + ' (obtenu ' + res.length + ')');
      res.forEach(function (e) { A.ok(Math.abs(e.pos.x) < N.PORTEE_MOBS_DIFFUSES, 'hors de portée : ' + e.pos.x); });
      for (var k = 1; k < res.length; k++) A.ok(res[k].pos.x >= res[k - 1].pos.x, 'trié par distance croissante');
      // 250 entités espacées de 4, portée 96 : seules celles à |x|<96 (24 dans
      // ce test unilatéral, x>=0) qualifient — bien en dessous du plafond ici,
      // le plafond est vérifié séparément ci-dessous avec un lot plus dense.
    });
    it('SPEC-SERVEUR-007 : le plafond agit même quand plus de 80 entités sont à portée', function () {
      var entites = [];
      for (var i = 0; i < 200; i++) entites.push({ pos: { x: i * 0.1, z: 0 }, id: i }); // toutes à |x|<20, donc à portée
      var res = N.selectionnerMobsProches(entites, [{ x: 0, z: 0 }], N.PORTEE_MOBS_DIFFUSES, N.MAX_MOBS_DIFFUSES);
      A.equal(res.length, N.MAX_MOBS_DIFFUSES, 'exactement ' + N.MAX_MOBS_DIFFUSES + ' malgré 200 entités à portée');
    });
    it('SPEC-SYNC-026 : les objets au sol ont leur propre plafond, jamais évincés par 80 créatures plus proches', function () {
      A.equal(N.MAX_ITEMS_DIFFUSES, 64);
      var creatures = [], objets = [];
      for (var i = 0; i < 120; i++) creatures.push({ pos: { x: i * 0.1, z: 0 }, type: 'zombie' });
      objets.push({ pos: { x: 30, z: 0 }, type: 'item' });
      var seuls = N.selectionnerMobsProches(creatures.concat(objets), [{ x: 0, z: 0 }], N.PORTEE_MOBS_DIFFUSES, N.MAX_MOBS_DIFFUSES);
      A.notOk(seuls.some(function (e) { return e.type === 'item'; }), 'témoin : sans plafond séparé l objet est évincé');
      var separes = N.selectionnerMobsProches(creatures, [{ x: 0, z: 0 }], N.PORTEE_MOBS_DIFFUSES, N.MAX_MOBS_DIFFUSES)
        .concat(N.selectionnerMobsProches(objets, [{ x: 0, z: 0 }], N.PORTEE_MOBS_DIFFUSES, N.MAX_ITEMS_DIFFUSES));
      A.ok(separes.some(function (e) { return e.type === 'item'; }), 'avec un plafond séparé l objet est diffusé');
    });
    it('SPEC-SYNC-028 : BLOC porte la case d inventaire, TIR accepte le genre galet (fronde)', function () {
      var b = N.valider({ t: N.MSG.BLOC, x: 1, y: 40, z: 2, id: 5, j: 0, i: 3 });
      A.equal(b.i, 3, 'la case d inventaire est conservée');
      A.equal(N.valider({ t: N.MSG.BLOC, x: 1, y: 40, z: 2, id: 5, j: 0 }).i, undefined, 'facultative');
      A.equal(N.valider({ t: N.MSG.TIR, dx: 0, dy: 1, dz: 0, genre: 'galet' }).genre, 'galet');
    });
    it('SPEC-SERVEUR-007 : calculerEtatHz reste à la cadence configurée pour peu de clients', function () {
      A.equal(N.calculerEtatHz(60, { nbClients: 1 }), 60);
      A.equal(N.calculerEtatHz(60, { nbClients: 2 }), 60);
      A.equal(N.calculerEtatHz(60, {}), 60, 'aucune charge fournie : pas de restriction');
    });
    it('SPEC-SERVEUR-007 : calculerEtatHz diminue progressivement (jamais en dessous d un plancher) quand les clients augmentent', function () {
      var precedent = N.calculerEtatHz(60, { nbClients: 1 });
      [5, 15, 30, 45, 70, 100].forEach(function (n) {
        var hz = N.calculerEtatHz(60, { nbClients: n });
        A.ok(hz <= precedent, 'nbClients=' + n + ' : ' + hz + ' devrait être <= précédent ' + precedent);
        A.ok(hz >= N.ETAT_HZ_MIN, 'jamais sous le plancher (' + hz + ' < ' + N.ETAT_HZ_MIN + ')');
        precedent = hz;
      });
      A.lt(N.calculerEtatHz(60, { nbClients: 100 }), N.calculerEtatHz(60, { nbClients: 2 }),
           'avec beaucoup de clients, la cadence est strictement inférieure à celle avec peu de clients');
    });
    it('SPEC-SERVEUR-007 : une file d envoi encombrée réduit encore la cadence, jamais sous le plancher', function () {
      var normal = N.calculerEtatHz(60, { nbClients: 5, fileMax: 0 });
      var encombre = N.calculerEtatHz(60, { nbClients: 5, fileMax: N.SEUIL_FILE_OCTETS + 1 });
      A.lt(encombre, normal, 'la file encombrée réduit la cadence par rapport à une file vide');
      A.ok(encombre >= N.ETAT_HZ_MIN, 'jamais sous le plancher');
    });

    // ── décodeur : robustesse générale (complète SPEC-NET-002/003) ─────────
    it('SPEC-NET-002/003 : un tampon vide ou tronqué ne fait jamais planter le décodeur', function () {
      A.equal(N.decoder(null), null);
      A.equal(N.decoder(new Uint8Array(0)), null);
      A.equal(N.decoder(new Uint8Array([0x81])), null, 'un seul octet : incomplet');
      A.equal(N.decoder(new Uint8Array([0x81, 126])), null, 'longueur étendue annoncée mais absente');
      A.equal(N.decoder(new Uint8Array([0x81, 0xFE, 0, 0])), null, 'longueur 16 bits + masque annoncés, absents');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
