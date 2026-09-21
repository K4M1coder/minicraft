/* net-protocol.js — WebSocket (RFC 6455) et protocole de jeu, sans aucune
   dépendance. Ce module est PUR : il manipule des octets et des objets, jamais
   une socket. C'est ce qui permet de le tester intégralement sous Node avant
   qu'une seule connexion réelle n'existe. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  // ─── poignée de main ───────────────────────────────────────────────────────
  var GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

  /* Sec-WebSocket-Accept = base64(sha1(clé + GUID)).
     `sha1` et `base64` sont injectés : sous Node ils viennent de `crypto`,
     et les tests peuvent vérifier le vecteur officiel de la RFC. */
  function accepteCle(cle, sha1b64) {
    return sha1b64(String(cle) + GUID);
  }

  /* Réponse complète à la requête d'ouverture. */
  function reponseHandshake(cle, sha1b64) {
    return [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Accept: ' + accepteCle(cle, sha1b64),
      '', '',
    ].join('\r\n');
  }

  function estRequeteWebSocket(entetes) {
    if (!entetes) return false;
    var up = entetes.upgrade || entetes.Upgrade || '';
    return String(up).toLowerCase() === 'websocket' &&
           !!(entetes['sec-websocket-key'] || entetes['Sec-WebSocket-Key']);
  }

  // ─── trames ────────────────────────────────────────────────────────────────
  var OP = { CONT: 0x0, TEXTE: 0x1, BINAIRE: 0x2, FERME: 0x8, PING: 0x9, PONG: 0xA };

  /* Encode une trame serveur : jamais masquée (le masquage n'est obligatoire
     que dans le sens client → serveur). `alloue(n)` fabrique le tampon —
     Buffer sous Node, Uint8Array ailleurs. */
  function encoder(charge, opcode, alloue) {
    var op = opcode === undefined ? OP.TEXTE : opcode;
    var octets = typeof charge === 'string' ? utf8Encoder(charge) : (charge || []);
    var n = octets.length;
    var entete = n < 126 ? 2 : (n < 65536 ? 4 : 10);
    var buf = alloue(entete + n);

    buf[0] = 0x80 | op;                         // FIN + opcode
    if (n < 126) {
      buf[1] = n;
    } else if (n < 65536) {
      buf[1] = 126;
      buf[2] = (n >> 8) & 255; buf[3] = n & 255;
    } else {
      buf[1] = 127;
      // 64 bits : les 4 octets de poids fort restent nuls (< 4 Gio)
      buf[2] = 0; buf[3] = 0; buf[4] = 0; buf[5] = 0;
      buf[6] = (n >>> 24) & 255; buf[7] = (n >>> 16) & 255;
      buf[8] = (n >>> 8) & 255; buf[9] = n & 255;
    }
    for (var i = 0; i < n; i++) buf[entete + i] = octets[i];
    return buf;
  }

  /* Décode UNE trame en tête de tampon. Renvoie null si le tampon est
     incomplet : TCP peut livrer une demi-trame, ou trois d'un coup.
     C'est le piège classique — il faut accumuler et redemander. */
  function decoder(buf) {
    if (!buf || buf.length < 2) return null;
    var b0 = buf[0], b1 = buf[1];
    var fin = (b0 & 0x80) !== 0;
    var opcode = b0 & 0x0F;
    var masque = (b1 & 0x80) !== 0;
    var len = b1 & 0x7F;
    var i = 2;

    if (len === 126) {
      if (buf.length < 4) return null;
      len = (buf[2] << 8) | buf[3];
      i = 4;
    } else if (len === 127) {
      if (buf.length < 10) return null;
      // on ignore les 4 octets de poids fort : aucune trame de plus de 4 Gio
      len = (buf[6] * 16777216) + (buf[7] << 16) + (buf[8] << 8) + buf[9];
      i = 10;
    }

    var cle = null;
    if (masque) {
      if (buf.length < i + 4) return null;
      cle = [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
      i += 4;
    }
    if (buf.length < i + len) return null;      // trame incomplète

    var charge = new Array(len);
    for (var k = 0; k < len; k++) {
      charge[k] = masque ? (buf[i + k] ^ cle[k % 4]) : buf[i + k];
    }
    return { fin: fin, opcode: opcode, masque: masque, longueur: len,
             charge: charge, consomme: i + len };
  }

  // ─── UTF-8 minimal (sans TextEncoder, pour rester portable) ────────────────
  function utf8Encoder(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        // paire de substitution : un seul point de code sur 4 octets
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
                 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else {
        out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return out;
  }

  function utf8Decoder(octets) {
    var out = '', i = 0;
    while (i < octets.length) {
      var c = octets[i++];
      if (c < 0x80) out += String.fromCharCode(c);
      else if (c < 0xE0) out += String.fromCharCode(((c & 31) << 6) | (octets[i++] & 63));
      else if (c < 0xF0) {
        out += String.fromCharCode(((c & 15) << 12) | ((octets[i++] & 63) << 6) | (octets[i++] & 63));
      } else {
        var cp = ((c & 7) << 18) | ((octets[i++] & 63) << 12) |
                 ((octets[i++] & 63) << 6) | (octets[i++] & 63);
        cp -= 0x10000;
        out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 1023));
      }
    }
    return out;
  }

  // ─── protocole de jeu ──────────────────────────────────────────────────────
  /* Messages typés par `t`. JSON plutôt que binaire : à 10 envois par seconde
     pour 8 joueurs, le volume reste négligeable en réseau local, et un
     protocole lisible se débogue sans outil. */
  var MSG = {
    REJOINDRE: 'rejoindre', BIENVENUE: 'bienvenue', ETAT: 'etat',
    BLOC: 'bloc', BOUGE: 'bouge', CHAT: 'chat',
    ARRIVE: 'arrive', QUITTE: 'quitte', MOBS: 'mobs', HEURE: 'heure',
  };

  /* Valide un message entrant. Un message sans `t` connu est rejeté : il ne
     doit jamais pouvoir faire planter le serveur. */
  function valider(msg) {
    if (!msg || typeof msg !== 'object') return null;
    if (typeof msg.t !== 'string') return null;
    switch (msg.t) {
      case MSG.REJOINDRE:
        return { t: msg.t, nom: String(msg.nom || 'Joueur').slice(0, 24),
                 locaux: Math.max(1, Math.min(4, (msg.locaux | 0) || 1)) };
      case MSG.BLOC:
        if (!estEntier(msg.x) || !estEntier(msg.y) || !estEntier(msg.z)) return null;
        if (!estEntier(msg.id) || msg.id < 0 || msg.id > 255) return null;
        return { t: msg.t, x: msg.x | 0, y: msg.y | 0, z: msg.z | 0, id: msg.id | 0 };
      case MSG.BOUGE:
        if (!estFini(msg.x) || !estFini(msg.y) || !estFini(msg.z)) return null;
        return { t: msg.t, i: (msg.i | 0), x: +msg.x, y: +msg.y, z: +msg.z,
                 yaw: estFini(msg.yaw) ? +msg.yaw : 0,
                 pitch: estFini(msg.pitch) ? +msg.pitch : 0 };
      case MSG.CHAT:
        var txt = String(msg.texte === undefined ? '' : msg.texte).trim();
        if (!txt) return null;
        return { t: msg.t, texte: txt.slice(0, 160) };
      default:
        return null;                            // message inconnu : ignoré
    }
  }

  function estFini(v) { return typeof v === 'number' && isFinite(v); }
  function estEntier(v) { return estFini(v) && Math.floor(v) === v; }

  MC.NetProtocol = {
    GUID: GUID, OP: OP, MSG: MSG,
    accepteCle: accepteCle, reponseHandshake: reponseHandshake,
    estRequeteWebSocket: estRequeteWebSocket,
    encoder: encoder, decoder: decoder,
    utf8Encoder: utf8Encoder, utf8Decoder: utf8Decoder,
    valider: valider,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
