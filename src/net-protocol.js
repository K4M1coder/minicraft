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

  // ─── Origin à la poignée de main (SPEC-SECU-011) ───────────────────────────
  /* `listeAutorisees` : tableau d'origines exactes (ex. 'http://localhost:8080'),
     ou null/undefined/vide = AUCUNE restriction — un choix par défaut
     explicite (documenté dans l'aide de --origines, src/parametres.js), pas
     un oubli : sans lui, le jeu servi par ce même serveur (qui envoie son
     propre Origin, ou aucun pour un client non-navigateur comme les tests
     d'intégration) doit continuer de fonctionner tel quel.
     Une fois une liste configurée, elle devient stricte : un Origin absent de
     la requête est refusé (un navigateur pose TOUJOURS Origin sur une
     connexion WebSocket cross-context ; son absence quand une liste est
     exigée est déjà suspecte). */
  function origineAutorisee(origin, listeAutorisees) {
    if (!listeAutorisees || !listeAutorisees.length) return true;
    if (!origin) return false;
    return listeAutorisees.indexOf(origin) >= 0;
  }

  // ─── bornes de sécurité (SPEC-SECU-003/008) ────────────────────────────────
  /* TAMPON_MAX : taille maximale du tampon de réception PAR CONNEXION, côté
     serveur (server.js s'en sert dans son handler `data`). Le plus gros
     message légitime client → serveur est ADMIN, borné à 4000 caractères de
     JSON (voir plus bas) ; 1 Mo laisse une marge très large sans permettre à
     un client d'accumuler indéfiniment un tampon jamais complété. */
  var TAMPON_MAX = 1024 * 1024;
  /* COORD_MAX : plage plausible pour une coordonnée reçue d'un client (ex.
     ±10 000 000, comme documenté dans SPEC-SECU-008). Elle reste TRÈS
     inférieure à 2^31 : `valeur | 0` (utilisé partout pour entiériser) tronque
     silencieusement au-delà de 2^31, ce qui rendrait une borne plus large
     inefficace — un audit exploratoire du serveur a mesuré que la
     troncature commence dès 2^31. */
  var COORD_MAX = 10000000;
  /* Hauteur du monde (voir core.js `WORLD_H`) : dupliquée ici plutôt
     qu'importée, pour que ce module reste chargeable seul (comme le font déjà
     tests/spec-net.js ou tests/integration-*.js) sans dépendre de core.js. */
  var WORLD_H = 128;

  // ─── en-têtes de sécurité HTTP (SPEC-SECU-010) ─────────────────────────────
  /* Servies par server.js sur les réponses de FICHIERS STATIQUES uniquement
     (jamais sur les routes JSON de l'API, qui répondent déjà en
     application/json, jamais interprétées comme du HTML/JS par un
     navigateur). `nosniff` empêche un navigateur de deviner un type de
     contenu différent de l'en-tête envoyé ; aucune ligne X-Powered-By n'est
     jamais posée (http natif de Node n'en ajoute pas — ce module ne fait que
     documenter/tester l'absence, server.js ne doit jamais en ajouter une).

     La CSP reste MINIMALE mais doit rester compatible avec le jeu ET le banc
     de test (tests/index.html), servis par le même `servir()` :
       - 'self' + cdnjs.cloudflare.com : three.js r128 est chargé depuis ce CDN
         (index.html et tests/index.html) ;
       - 'unsafe-inline' sur script-src : le bootstrap (index.html) ET le banc
         (tests/index.html) chargent leurs propres scripts via un <script>
         inline qui fabrique des balises <script src> (parfois via
         document.write, voir tests/index.html) — sans 'unsafe-inline' ce
         bootstrap lui-même serait bloqué avant de pouvoir charger quoi que ce
         soit d'autre ;
       - 'unsafe-inline' sur style-src : un message d'erreur de démarrage
         (index.html, fatal()) pose un attribut style="" via innerHTML ;
       - connect-src inclut ws:/wss: pour la connexion de jeu elle-même ;
       - img-src autorise data: (favicon `data:,`) ;
       - object-src/base-uri à 'none' : rien de tout cela n'est utilisé. */
  var CSP_STATIQUE = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');
  function entetesSecuriteStatiques() {
    return { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP_STATIQUE };
  }

  // ─── plafond et cadence de diffusion de ETAT (SPEC-SERVEUR-007) ───────────
  /* MAX_MOBS_DIFFUSES : nombre maximal de créatures/entités renvoyées à un
     client dans ETAT.mobs, quel que soit le nombre réel d'entités du monde —
     un invariant DOCUMENTÉ ici (au lieu d'un 80 littéral perdu dans
     server.js) et vérifié par un test pur (voir tests/spec-secu.js). */
  var MAX_MOBS_DIFFUSES = 80;
  /* MAX_ITEMS_DIFFUSES (SPEC-SYNC-026) : les objets au sol ont leur PROPRE
     plafond, à part de celui des créatures — sinon un objet lâché à côté d'un
     joueur pouvait être écarté d'ETAT par 80 créatures plus proches. */
  var MAX_ITEMS_DIFFUSES = 64;
  /* MAX_VEHICULES_DIFFUSES (SPEC-SYNC-022) : les véhicules ont eux aussi leur plafond
     propre — jamais évincés par les créatures, jamais plus nombreux que ce qu'un
     client peut voir à portée : à 100 joueurs la diffusion reste bornée par client. */
  var MAX_VEHICULES_DIFFUSES = 32;
  // PORTEE_MOBS_DIFFUSES : au-delà, une entité n'est plus envoyée à un client
  // (voir server.js — habitants des villes lointaines).
  var PORTEE_MOBS_DIFFUSES = 96;

  /* Sélectionne, PUREMENT (aucune socket, aucun accès au monde), les entités
     les plus proches d'au moins UNE des positions de référence (les joueurs
     LOCAUX d'un même client), à portée, triées par distance croissante et
     bornées à `max`. `entites` : tableau d'objets `{ pos: {x, z} }` (ou plus,
     ignoré) ; `positionsRef` : tableau de `{x, z}` non vide. */
  function selectionnerMobsProches(entites, positionsRef, portee, max) {
    var portee2 = portee * portee;
    function d2(e) {
      var meilleure = Infinity;
      for (var i = 0; i < positionsRef.length; i++) {
        var p = positionsRef[i];
        var dx = e.pos.x - p.x, dz = e.pos.z - p.z;
        var d = dx * dx + dz * dz;
        if (d < meilleure) meilleure = d;
      }
      return meilleure;
    }
    return entites
      .filter(function (e) { return d2(e) < portee2; })
      .sort(function (a, b) { return d2(a) - d2(b); })
      .slice(0, max);
  }

  /* Comme selectionnerMobsProches, avec HYSTÉRÉSIS : une entité déjà envoyée au relevé précédent
     (`precedents`, un Set d'eid) compte pour 20 % plus proche qu'elle ne l'est, de sorte que deux
     véhicules presque à égale distance de la frontière du plafond ne s'évincent pas à tour de
     rôle d'un relevé à l'autre (apparitions et disparitions chez le client). Renvoie la liste. */
  function selectionnerAvecHysteresis(entites, positionsRef, portee, max, precedents) {
    var portee2 = portee * portee;
    function d2(e) {
      var m = Infinity;
      for (var i = 0; i < positionsRef.length; i++) {
        var dx = e.pos.x - positionsRef[i].x, dz = e.pos.z - positionsRef[i].z;
        var d = dx * dx + dz * dz;
        if (d < m) m = d;
      }
      return m;
    }
    var cand = [];
    entites.forEach(function (e) {
      var d = d2(e);
      if (d >= portee2) return;
      cand.push({ e: e, k: precedents && precedents.has(e.eid) ? d * 0.64 : d });
    });
    cand.sort(function (a, b) { return a.k - b.k; });
    return cand.slice(0, max).map(function (c) { return c.e; });
  }

  /* Cadence de diffusion adaptée à la charge : paliers sur le nombre de
     clients connectés (moins de travail réseau par tic quand beaucoup de
     clients sont là, plutôt que de laisser le tic serveur se dégrader — voir
     docs/charge.md, SPEC-SERVEUR-002), et un facteur additionnel si la file
     d'envoi TCP d'au moins un client (son `writableLength`) montre déjà un
     retard d'écriture — signe qu'émettre encore plus vite n'aiderait
     personne. Toujours borné à [ETAT_HZ_MIN, baseHz] : jamais plus rapide que
     configuré, jamais totalement figé. */
  var ETAT_HZ_MIN = 5;
  var SEUIL_FILE_OCTETS = 64 * 1024;                 // 64 Kio de file d'envoi en retard
  var PALIERS_ETAT_HZ = [
    { clients: 10, facteur: 1 },
    { clients: 25, facteur: 0.6 },
    { clients: 60, facteur: 0.35 },
    { clients: Infinity, facteur: 0.2 },
  ];
  function calculerEtatHz(baseHz, charge) {
    charge = charge || {};
    var nbClients = Math.max(0, charge.nbClients || 0);
    var fileMax = Math.max(0, charge.fileMax || 0);
    var facteur = 1;
    for (var i = 0; i < PALIERS_ETAT_HZ.length; i++) {
      if (nbClients <= PALIERS_ETAT_HZ[i].clients) { facteur = PALIERS_ETAT_HZ[i].facteur; break; }
    }
    if (fileMax > SEUIL_FILE_OCTETS) facteur *= 0.5;
    var hz = Math.round(baseHz * facteur);
    return Math.max(ETAT_HZ_MIN, Math.min(baseHz, hz));
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
    // serveur autoritaire : le client envoie ses entrées et ses intentions,
    // le serveur décide et répond
    ENTREE: 'e', ATTAQUE: 'attaque', MANGER: 'manger', RENAITRE: 'renaitre', DONNE: 'donne', TIR: 'tir',
    // une connexion refusée (liste noire, liste blanche, bannissement, e-mail
    // manquant…) : le serveur le dit avant de fermer, plutôt qu'une coupure
    // muette qui laisse deviner (SPEC-ADMIN-004)
    REFUS: 'refus',
    // panneau admin en jeu (SPEC-ADMIN-006) : une seule paire de messages,
    // l'action porte le détail — le serveur vérifie toujours le rôle qu'IL a
    // attribué à la connexion, jamais un rôle déclaré par le client
    ADMIN: 'admin', ADMIN_REP: 'admin_rep',
    // SPEC-MECA-001 : contenu d'un distributeur (le serveur fait foi sur ce
    // qu'il éjecte sur signal — voir circuits.js/onDistribuer côté serveur).
    DISTRIB: 'distrib',
    // SPEC-SERVEUR-009 : BIENVENUE ne porte plus qu'un voisinage borné des
    // overrides de blocs — le client demande le reste chunk par chunk, au
    // même rythme qu'il charge son terrain (voir game.js streamChunks) ;
    // le serveur répond avec les seuls overrides de CE chunk.
    OVERRIDES_DEMANDE: 'overrides_demande', OVERRIDES_CHUNK: 'overrides_chunk',
    // SPEC-SYNC-024 (s→c) : état complet des relations de faction — factions PNJ
    // et leurs relations (MC.Politique), factions de joueurs et leurs relations
    // (MC.Guildes, sans candidatures ni invitations) ; envoyé juste après
    // BIENVENUE puis à chaque changement. Jamais accepté d'un client.
    POLITIQUE: 'politique',
    // SPEC-BANC-106 (c→s) : erreur error/fatal du journal d'un client, remontée
    // au journal du serveur avec un débit limité (MC.Journal.REMONTEE)
    JOURNAL_CLIENT: 'journal_client',
  };
  // vague 2 (B1, étape 1) : fusion des nouveaux types de MC.ContratsV2.MSG dans NP.MSG
  if (MC.ContratsV2) Object.keys(MC.ContratsV2.MSG).forEach(function (k) { MSG[k] = MC.ContratsV2.MSG[k]; });
  // chantier ARCHI (L50, SPEC-ARCHI-019) : pause, réseau à chaud, arrêt, sommeil, histoire, succès
  if (MC.ContratsArchi) Object.keys(MC.ContratsArchi.MSG).forEach(function (k) { MSG[k] = MC.ContratsArchi.MSG[k]; });

  /* Valide un message entrant. Un message sans `t` connu est rejeté : il ne
     doit jamais pouvoir faire planter le serveur. */
  function valider(msg) {
    if (!msg || typeof msg !== 'object') return null;
    if (typeof msg.t !== 'string') return null;
    switch (msg.t) {
      case MSG.REJOINDRE:
        // e-mail et jeton d'invitation : facultatifs, lus par SPEC-ADMIN-004/005
        // le nom finit dans le journal du serveur : ni saut de ligne ni caractère de contrôle (revue SPEC-BANC-110)
        return { t: msg.t, nom: (String(msg.nom || '').replace(CONTROLES, '').trim() || 'Joueur').slice(0, 24),
                 locaux: Math.max(1, Math.min(4, (msg.locaux | 0) || 1)),
                 email: msg.email ? String(msg.email).trim().slice(0, 120) : null,
                 invitation: msg.invitation ? String(msg.invitation).trim().slice(0, 80) : null };
      case MSG.BLOC:
        // SPEC-SECU-008 : bornes absolues AVANT toute logique de jeu — x/z
        // dans ±COORD_MAX, y dans la hauteur réelle du monde.
        if (!estCoordHorizontale(msg.x) || !estCoordVerticale(msg.y) || !estCoordHorizontale(msg.z)) return null;
        // ids sur 16 bits (SPEC-SAVE-017) : jusqu'à 65535, blocs comme objets.
        if (!estEntier(msg.id) || msg.id < 0 || msg.id > 65535) return null;
        // `outil` : ce que le joueur tient, pour que le serveur calcule le butin
        // `etat` : orientation, niveau… — un octet (SPEC-SAVE-017), 0 par défaut
        var blocValide = { t: msg.t, x: msg.x | 0, y: msg.y | 0, z: msg.z | 0, id: msg.id | 0,
                 j: joueurLocal(msg.j), outil: estEntier(msg.outil) && msg.outil >= 0 ? msg.outil | 0 : 0,
                 etat: estEntier(msg.etat) && msg.etat >= 0 && msg.etat <= 255 ? msg.etat | 0 : 0 };
        // `i` : la case d'inventaire dont vient le bloc posé (SPEC-SYNC-028) — facultatif
        if (estEntier(msg.i) && msg.i >= 0 && msg.i < 64) blocValide.i = msg.i | 0;
        return blocValide;
      case MSG.ENTREE:
        // une image de simulation : numéro, durée, touches, regard
        if (!estEntier(msg.s) || msg.s < 0) return null;
        if (!estFini(msg.dt) || msg.dt <= 0 || msg.dt > 0.1) return null;
        if (!estEntier(msg.k) || msg.k < 0 || msg.k > 63) return null;
        return { t: msg.t, s: msg.s, j: joueurLocal(msg.j), dt: +msg.dt, k: msg.k | 0,
                 yaw: estFini(msg.yaw) ? +msg.yaw : 0,
                 pitch: estFini(msg.pitch) ? Math.max(-1.6, Math.min(1.6, +msg.pitch)) : 0,
                 v: msg.v ? 1 : 0 };
      case MSG.ATTAQUE: {
        // SPEC-COMBAT-002 : soit une créature (eid), soit un autre joueur
        // (joueurCible, la clé "id" ou "id/j" sous laquelle net.js le suit) —
        // jamais aucun des deux, sinon on ne sait pas viser.
        var degats = estFini(msg.degats) ? Math.max(1, Math.min(12, +msg.degats)) : 1;
        if (estEntier(msg.eid)) {
          return caseTenue({ t: msg.t, eid: msg.eid | 0, j: joueurLocal(msg.j), degats: degats }, msg);
        }
        if (typeof msg.joueurCible === 'string' && /^\d+(\/\d+)?$/.test(msg.joueurCible)) {
          return caseTenue({ t: msg.t, joueurCible: msg.joueurCible.slice(0, 16), j: joueurLocal(msg.j), degats: degats }, msg);
        }
        return null;
      }
      case MSG.MANGER: return MC.ContratsV2 ? MC.ContratsV2.validerManger(msg) : (estEntier(msg.id) ? { t: msg.t, id: msg.id | 0, j: joueurLocal(msg.j) } : null);
      case MSG.RENAITRE:
        return { t: msg.t, j: joueurLocal(msg.j) };
      case MSG.TIR: {
        // une direction unitaire, une vitesse et des dégâts bornés
        if (!estFini(msg.dx) || !estFini(msg.dy) || !estFini(msg.dz)) return null;
        var n = Math.hypot(msg.dx, msg.dy, msg.dz);
        if (n < 0.5 || n > 1.5) return null;
        var genres = ['fleche', 'galet', 'sortilege'];
        return caseTenue({ t: msg.t, j: joueurLocal(msg.j), dx: msg.dx / n, dy: msg.dy / n, dz: msg.dz / n,
                 vitesse: estFini(msg.vitesse) ? Math.max(10, Math.min(50, +msg.vitesse)) : 34,
                 degats: estFini(msg.degats) ? Math.max(1, Math.min(12, +msg.degats)) : 5,
                 genre: genres.indexOf(msg.genre) >= 0 ? msg.genre : 'fleche' }, msg);
      }
      case MSG.BOUGE:
        // SPEC-SECU-008 : la position n'est plus autoritaire (SPEC-NET-026)
        // mais reste bornée — un flottant énorme ne doit jamais atteindre la
        // logique de jeu, même pour une valeur qui ne sera pas utilisée.
        if (!estFini(msg.x) || !estFini(msg.y) || !estFini(msg.z)) return null;
        if (Math.abs(msg.x) > COORD_MAX || Math.abs(msg.y) > COORD_MAX || Math.abs(msg.z) > COORD_MAX) return null;
        return { t: msg.t, i: (msg.i | 0), x: +msg.x, y: +msg.y, z: +msg.z,
                 yaw: estFini(msg.yaw) ? +msg.yaw : 0,
                 pitch: estFini(msg.pitch) ? +msg.pitch : 0 };
      case MSG.ADMIN: {
        // les actions valides sont une liste fermée : un nom hors de cette
        // liste est un message qui ne peut rien faire, jamais planter
        var ACTIONS = ['auth', 'joueurs', 'inventaire', 'sessions', 'listes', 'journal',
          'liste_ajouter', 'liste_retirer', 'invitation_creer', 'invitation_revoquer',
          'role_nommer', 'sanction', 'zone_definir', 'zone_retirer', 'bloc_commande', 'heure'];
        if (typeof msg.action !== 'string' || ACTIONS.indexOf(msg.action) < 0) return null;
        // charge bornee : un panneau admin n'a jamais besoin de gros volumes
        var args = msg.args && typeof msg.args === 'object' ? msg.args : {};
        try { if (JSON.stringify(args).length > 4000) return null; } catch (e) { return null; }
        return { t: msg.t, action: msg.action, args: args };
      }

      case MSG.DISTRIB: {
        // SPEC-SECU-008 : même borne qu'un BLOC — un distributeur est un bloc posé.
        if (!estCoordHorizontale(msg.x) || !estCoordVerticale(msg.y) || !estCoordHorizontale(msg.z)) return null;
        if (!Array.isArray(msg.slots)) return null;
        var slots = msg.slots.slice(0, 9).map(function (s) {
          if (!s || !estEntier(s.id) || s.id <= 0 || !estEntier(s.n) || s.n <= 0) return null;
          return { id: s.id | 0, n: Math.max(1, Math.min(999, s.n | 0)) };
        });
        while (slots.length < 9) slots.push(null);
        return { t: msg.t, x: msg.x | 0, y: msg.y | 0, z: msg.z | 0, j: joueurLocal(msg.j), slots: slots };
      }
      case MSG.CHAT:
        var txt = String(msg.texte === undefined ? '' : msg.texte).replace(CONTROLES_SUITE, ' ').trim();
        if (!txt) return null;
        return { t: msg.t, texte: txt.slice(0, 160) };

      // SPEC-SERVEUR-009 : coordonnées de CHUNK (pas de bloc) — bornées plus
      // strictement qu'une coordonnée de bloc (COORD_MAX est déjà large pour
      // un bloc, un chunk 16× plus grand n'a pas besoin de la même plage,
      // mais rester sous la même borne suffit à écarter une valeur aberrante).
      case MSG.OVERRIDES_DEMANDE:
        if (!estEntier(msg.cx) || !estEntier(msg.cz) ||
            Math.abs(msg.cx) > COORD_MAX || Math.abs(msg.cz) > COORD_MAX) return null;
        return { t: msg.t, cx: msg.cx | 0, cz: msg.cz | 0 };

      // SPEC-BANC-106 : niveau, domaine, longueurs bornés par le journal lui-même
      case MSG.JOURNAL_CLIENT:
        return MC.Journal ? MC.Journal.validerRemontee(msg) : null;

      default:
        if (MC.ContratsArchi && MC.ContratsArchi.SENS[msg.t] === 'c>s') return MC.ContratsArchi.valider(msg);
        return MC.ContratsV2 ? MC.ContratsV2.valider(msg) : null;
    }
  }

  /* Caractères de contrôle C0, DEL, C1 et séparateurs de ligne Unicode : un
     nom ou un message de chat qui en porterait écrirait des lignes à lui
     dans le journal du serveur (un faux `MC_PORT=` lu par un lanceur). */
  var CONTROLES = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
  var CONTROLES_SUITE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
  function estFini(v) { return typeof v === 'number' && isFinite(v); }
  // indice du joueur local sur le poste (écran partagé) : 0 à 3
  function joueurLocal(j) { return estEntier(j) && j >= 0 && j < 4 ? j : 0; }
  function estEntier(v) { return estFini(v) && Math.floor(v) === v; }
  /* SPEC-ARCHI-027 : la case d'inventaire tenue (facultative) accompagne un coup
     ou un tir ; le serveur y lit l'arme réelle. */
  function caseTenue(o, msg) {
    if (estEntier(msg.i) && msg.i >= 0 && msg.i < 64) o.i = msg.i | 0;
    return o;
  }
  // SPEC-SECU-008 : x/z dans ±COORD_MAX, y dans la hauteur réelle du monde.
  function estCoordHorizontale(v) { return estEntier(v) && Math.abs(v) <= COORD_MAX; }
  function estCoordVerticale(v) { return estEntier(v) && v >= 0 && v <= WORLD_H - 1; }

  MC.NetProtocol = {
    GUID: GUID, OP: OP, MSG: MSG,
    TAMPON_MAX: TAMPON_MAX, COORD_MAX: COORD_MAX, WORLD_H: WORLD_H,
    accepteCle: accepteCle, reponseHandshake: reponseHandshake,
    estRequeteWebSocket: estRequeteWebSocket,
    origineAutorisee: origineAutorisee,
    CSP_STATIQUE: CSP_STATIQUE, entetesSecuriteStatiques: entetesSecuriteStatiques,
    MAX_MOBS_DIFFUSES: MAX_MOBS_DIFFUSES, MAX_ITEMS_DIFFUSES: MAX_ITEMS_DIFFUSES, MAX_VEHICULES_DIFFUSES: MAX_VEHICULES_DIFFUSES, PORTEE_MOBS_DIFFUSES: PORTEE_MOBS_DIFFUSES,
    selectionnerMobsProches: selectionnerMobsProches, selectionnerAvecHysteresis: selectionnerAvecHysteresis,
    ETAT_HZ_MIN: ETAT_HZ_MIN, SEUIL_FILE_OCTETS: SEUIL_FILE_OCTETS,
    PALIERS_ETAT_HZ: PALIERS_ETAT_HZ, calculerEtatHz: calculerEtatHz,
    encoder: encoder, decoder: decoder,
    utf8Encoder: utf8Encoder, utf8Decoder: utf8Decoder,
    valider: valider,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
