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

    // ── décodeur : robustesse générale (complète SPEC-NET-002/003) ─────────
    it('un tampon vide ou tronqué ne fait jamais planter le décodeur', function () {
      A.equal(N.decoder(null), null);
      A.equal(N.decoder(new Uint8Array(0)), null);
      A.equal(N.decoder(new Uint8Array([0x81])), null, 'un seul octet : incomplet');
      A.equal(N.decoder(new Uint8Array([0x81, 126])), null, 'longueur étendue annoncée mais absente');
      A.equal(N.decoder(new Uint8Array([0x81, 0xFE, 0, 0])), null, 'longueur 16 bits + masque annoncés, absents');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
