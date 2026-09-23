/* spec-net.js — tests des specs SPEC-NET-001 à 008 : poignée de main,
   trames et validation du protocole. Ces tests tournent sans aucune socket :
   le module ne manipule que des octets et des objets. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var N = MC.NetProtocol;

  // tampon portable : Uint8Array partout
  function alloue(n) { return new Uint8Array(n); }

  /* SHA-1 + base64 minimal, uniquement pour vérifier le vecteur de la RFC
     sans dépendre de `crypto` dans le contexte de test. */
  function sha1b64(str) {
    function rotl(n, s) { return (n << s) | (n >>> (32 - s)); }
    var msg = N.utf8Encoder(str);
    var ml = msg.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    for (var i = 7; i >= 0; i--) msg.push((ml / Math.pow(256, i)) & 255);

    var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
    for (var b = 0; b < msg.length; b += 64) {
      var w = new Array(80);
      for (var j = 0; j < 16; j++) {
        w[j] = (msg[b + j * 4] << 24) | (msg[b + j * 4 + 1] << 16) |
               (msg[b + j * 4 + 2] << 8) | msg[b + j * 4 + 3];
      }
      for (var k = 16; k < 80; k++) w[k] = rotl(w[k - 3] ^ w[k - 8] ^ w[k - 14] ^ w[k - 16], 1);
      var a = h0, bb = h1, c = h2, d = h3, e = h4;
      for (var t = 0; t < 80; t++) {
        var f, kc;
        if (t < 20) { f = (bb & c) | (~bb & d); kc = 0x5A827999; }
        else if (t < 40) { f = bb ^ c ^ d; kc = 0x6ED9EBA1; }
        else if (t < 60) { f = (bb & c) | (bb & d) | (c & d); kc = 0x8F1BBCDC; }
        else { f = bb ^ c ^ d; kc = 0xCA62C1D6; }
        var tmp = (rotl(a, 5) + f + e + kc + w[t]) | 0;
        e = d; d = c; c = rotl(bb, 30); bb = a; a = tmp;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0;
      h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
    }
    var octets = [];
    [h0, h1, h2, h3, h4].forEach(function (h) {
      octets.push((h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255);
    });
    var TAB = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var out = '';
    for (var p = 0; p < octets.length; p += 3) {
      var n1 = octets[p], n2 = octets[p + 1], n3 = octets[p + 2];
      out += TAB[n1 >> 2];
      out += TAB[((n1 & 3) << 4) | ((n2 === undefined ? 0 : n2) >> 4)];
      out += n2 === undefined ? '=' : TAB[((n2 & 15) << 2) | ((n3 === undefined ? 0 : n3) >> 6)];
      out += n3 === undefined ? '=' : TAB[n3 & 63];
    }
    return out;
  }
  G.sha1b64Test = sha1b64;

  describe('Specs — protocole WebSocket', function () {

    /* Vecteur officiel de la RFC 6455, section 1.3. Se tromper ici est
       l erreur la plus frequente : le navigateur ferme sans rien dire. */
    it('SPEC-NET-001 : la cle d acceptation suit le vecteur de la RFC', function () {
      A.equal(N.accepteCle('dGhlIHNhbXBsZSBub25jZQ==', sha1b64),
              's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
    });

    it('SPEC-NET-001 : la reponse contient les en-tetes obligatoires', function () {
      var r = N.reponseHandshake('dGhlIHNhbXBsZSBub25jZQ==', sha1b64);
      A.ok(r.indexOf('HTTP/1.1 101') === 0, 'statut 101');
      A.ok(r.indexOf('Upgrade: websocket') > 0, 'en-tete Upgrade');
      A.ok(r.indexOf('Connection: Upgrade') > 0, 'en-tete Connection');
      A.ok(r.indexOf('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=') > 0, 'cle calculee');
      A.ok(/\r\n\r\n$/.test(r), 'se termine par une ligne vide');
    });

    it('SPEC-NET-001 : une requete ordinaire n est pas prise pour un WebSocket', function () {
      A.notOk(N.estRequeteWebSocket({}), 'sans en-tete');
      A.notOk(N.estRequeteWebSocket({ upgrade: 'websocket' }), 'sans cle');
      A.ok(N.estRequeteWebSocket({ upgrade: 'WebSocket', 'sec-websocket-key': 'abc' }),
        'casse indifferente');
    });

    it('SPEC-NET-002 : une trame texte courte fait l aller-retour', function () {
      ['a', 'bonjour', 'éàü', '{"t":"chat"}'].forEach(function (txt) {
        var f = N.encoder(txt, N.OP.TEXTE, alloue);
        var d = N.decoder(f);
        A.ok(d, 'decodee : ' + txt);
        A.equal(d.opcode, N.OP.TEXTE);
        A.ok(d.fin, 'trame complete');
        A.equal(N.utf8Decoder(d.charge), txt, 'contenu identique : ' + txt);
      });
    });

    it('SPEC-NET-003 : une trame de taille moyenne est geree (126-65535)', function () {
      var txt = new Array(1001).join('x');           // 1000 caracteres
      var f = N.encoder(txt, N.OP.TEXTE, alloue);
      A.equal(f[1] & 0x7F, 126, 'longueur etendue sur 16 bits');
      var d = N.decoder(f);
      A.equal(d.longueur, 1000);
      A.equal(N.utf8Decoder(d.charge), txt);
    });

    it('SPEC-NET-003 : une trame longue est geree (>65535)', function () {
      var txt = new Array(70001).join('y');          // 70000 caracteres
      var f = N.encoder(txt, N.OP.TEXTE, alloue);
      A.equal(f[1] & 0x7F, 127, 'longueur etendue sur 64 bits');
      var d = N.decoder(f);
      A.equal(d.longueur, 70000);
      A.equal(d.charge.length, 70000);
    });

    /* Le client masque TOUJOURS ses trames : oublier de demasquer donne du
       charabia, symptome tres deroutant car la trame est structurellement
       valide. */
    it('SPEC-NET-004 : une trame client masquee est demasquee', function () {
      var texte = 'salut le serveur';
      var oct = N.utf8Encoder(texte);
      var cle = [0x37, 0xFA, 0x21, 0x3D];
      var buf = new Uint8Array(2 + 4 + oct.length);
      buf[0] = 0x81;                                  // FIN + texte
      buf[1] = 0x80 | oct.length;                     // masque + longueur
      for (var i = 0; i < 4; i++) buf[2 + i] = cle[i];
      for (var k = 0; k < oct.length; k++) buf[6 + k] = oct[k] ^ cle[k % 4];

      var d = N.decoder(buf);
      A.ok(d, 'decodee');
      A.ok(d.masque, 'masquage detecte');
      A.equal(N.utf8Decoder(d.charge), texte, 'texte correctement demasque');
    });

    it('SPEC-NET-005 : une trame de fermeture est reconnue', function () {
      var f = N.encoder('', N.OP.FERME, alloue);
      A.equal(N.decoder(f).opcode, N.OP.FERME);
      A.equal(N.OP.FERME, 0x8, 'opcode conforme');
    });

    it('SPEC-NET-006 : ping et pong ont les opcodes attendus', function () {
      A.equal(N.OP.PING, 0x9);
      A.equal(N.OP.PONG, 0xA);
      var p = N.encoder('salut', N.OP.PING, alloue);
      var d = N.decoder(p);
      A.equal(d.opcode, N.OP.PING);
      // le serveur doit repondre par un pong portant la meme charge
      var pong = N.encoder(N.utf8Decoder(d.charge), N.OP.PONG, alloue);
      A.equal(N.decoder(pong).opcode, N.OP.PONG);
      A.equal(N.utf8Decoder(N.decoder(pong).charge), 'salut', 'charge renvoyee');
    });

    /* TCP ne respecte aucune frontiere de message : une lecture peut contenir
       une demi-trame, ou trois. Decoder doit savoir dire « pas encore ». */
    it('SPEC-NET-002 : une trame incomplete renvoie null au lieu de planter', function () {
      var f = N.encoder('un message de test', N.OP.TEXTE, alloue);
      for (var n = 0; n < f.length; n++) {
        A.equal(N.decoder(f.slice(0, n)), null, 'incomplete a ' + n + ' octets');
      }
      A.ok(N.decoder(f), 'complete des le dernier octet');
    });

    it('SPEC-NET-002 : consomme indique ou commence la trame suivante', function () {
      var a = N.encoder('un', N.OP.TEXTE, alloue);
      var b = N.encoder('deux', N.OP.TEXTE, alloue);
      var joint = new Uint8Array(a.length + b.length);
      joint.set(a, 0); joint.set(b, a.length);

      var d1 = N.decoder(joint);
      A.equal(N.utf8Decoder(d1.charge), 'un');
      A.equal(d1.consomme, a.length, 'longueur consommee exacte');
      var d2 = N.decoder(joint.slice(d1.consomme));
      A.equal(N.utf8Decoder(d2.charge), 'deux', 'la seconde trame suit');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — messages du protocole de jeu', function () {

    it('SPEC-NET-007 : un message sans type est rejete', function () {
      A.equal(N.valider(null), null);
      A.equal(N.valider({}), null);
      A.equal(N.valider({ x: 1 }), null);
      A.equal(N.valider('texte'), null);
      A.equal(N.valider({ t: 42 }), null, 'type non textuel');
    });

    it('SPEC-NET-008 : un message de type inconnu est ignore sans planter', function () {
      A.equal(N.valider({ t: 'nawak' }), null);
      A.equal(N.valider({ t: 'bloc_secret', x: 1 }), null);
    });

    it('SPEC-NET-007 : rejoindre borne le nom et le nombre de joueurs locaux', function () {
      var m = N.valider({ t: 'rejoindre', nom: new Array(200).join('a'), locaux: 99 });
      A.ok(m, 'accepte');
      A.equal(m.nom.length, 24, 'nom tronque');
      A.equal(m.locaux, 4, 'locaux plafonnes a 4');
      A.equal(N.valider({ t: 'rejoindre' }).locaux, 1, 'un joueur par defaut');
    });

    it('SPEC-NET-007 : une pose de bloc exige des entiers valides', function () {
      A.ok(N.valider({ t: 'bloc', x: 1, y: 2, z: 3, id: 5 }), 'valide');
      A.equal(N.valider({ t: 'bloc', x: 1.5, y: 2, z: 3, id: 5 }), null, 'x non entier');
      A.equal(N.valider({ t: 'bloc', x: 1, y: 2, z: 3, id: 999 }), null, 'id hors bornes');
      A.equal(N.valider({ t: 'bloc', x: 1, y: 2, z: 3, id: -1 }), null, 'id negatif');
      A.equal(N.valider({ t: 'bloc', x: 'a', y: 2, z: 3, id: 5 }), null, 'x non numerique');
    });

    it('SPEC-NET-007 : un deplacement refuse les valeurs non finies', function () {
      A.ok(N.valider({ t: 'bouge', x: 1.5, y: 2.5, z: 3.5 }), 'flottants acceptes');
      A.equal(N.valider({ t: 'bouge', x: NaN, y: 0, z: 0 }), null, 'NaN rejete');
      A.equal(N.valider({ t: 'bouge', x: Infinity, y: 0, z: 0 }), null, 'Infini rejete');
      var m = N.valider({ t: 'bouge', x: 1, y: 2, z: 3, yaw: NaN });
      A.equal(m.yaw, 0, 'un angle invalide retombe a zero plutot que de contaminer');
    });

    it('SPEC-NET-007 : un message de chat vide est rejete, un long est tronque', function () {
      A.equal(N.valider({ t: 'chat', texte: '   ' }), null, 'vide');
      A.equal(N.valider({ t: 'chat' }), null, 'absent');
      var m = N.valider({ t: 'chat', texte: new Array(400).join('z') });
      A.equal(m.texte.length, 160, 'tronque a la limite du protocole');
    });

    it('SPEC-NET-007 : la validation ne fait jamais confiance a la source', function () {
      // un client malveillant ne doit pas pouvoir injecter de champs
      var m = N.valider({ t: 'bloc', x: 1, y: 2, z: 3, id: 5, admin: true, __proto__: {} });
      // j (joueur local) et outil sont des champs du protocole, bornés par le serveur
      A.deep(Object.keys(m).sort(), ['id', 'j', 'outil', 't', 'x', 'y', 'z'], 'champs recopies un a un');
      A.equal(m.admin, undefined, 'le champ injecte est ignore');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
