/* contrats-vague2.js — contrats FIGÉS de la vague 2 (docs/vague-2/README.md).

   Quatre sous-lots codent en parallèle contre ce fichier : B1 (inventaire et
   conteneurs serveur, L43), B2 (économie et métiers, L45, commerce par TROC),
   B3 (génération et maillage en Web Workers, L47), B4 (PvP enjeux et
   sanctions, L46). Il fixe ce qui traverse une frontière entre deux lots ou
   entre deux processus : les noms des nouveaux messages réseau, la forme de
   leurs champs et leurs bornes, les formes de données partagées (pile,
   case sérialisée, emplacement, conteneur, transaction de troc, message
   worker) et des fonctions `valider*` pures qui les normalisent.

   Règles d'usage (voir docs/vague-2/README.md, « Contrats ») :
   - un validateur renvoie une COPIE normalisée, ou `null` si l'entrée est
     invalide — jamais d'exception, jamais l'objet reçu lui-même ;
   - aucun lot ne modifie ce fichier pendant la vague : un besoin nouveau
     passe par un amendement explicite (commit dédié qui ne touche que ce
     fichier et tests/spec-contrats-vague2.js, annoncé aux autres lots) ;
   - module PUR (porte G5) : ni THREE, ni DOM, ni socket ; aucune dépendance
     de chargement (il se charge AVANT net-protocol.js, qui fusionne `MSG`
     dans `NP.MSG` — voir B1, étape 1).

   Rien ici n'est encore branché : c'est B1 qui raccorde `valider` à
   `NP.valider` (une ligne dans son `default:`), comme décrit dans B1.md. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var VERSION = 1;

  // ─── noms des nouveaux messages réseau ─────────────────────────────────────
  /* Valeurs courtes et distinctes de tous les `NP.MSG` existants (vérifié par
     tests/spec-contrats-vague2.js). */
  var MSG = {
    // B1 — inventaire, équipement, conteneurs (SPEC-SYNC-007 à 017)
    INV_MAJ: 'inv_maj',                   // s→c : état complet inv/equip/grille, ack
    CRAFT: 'craft',                       // c→s : fabrique depuis la grille serveur
    EQUIP: 'equip',                       // c→s : échange inv[i] ↔ equip[slot]
    EQUIP_VU: 'equip_vu',                 // s→c : équipement visible d'un AUTRE joueur
    CONTENEUR_OUVRIR: 'cont_ouvrir',      // c→s : s'abonner à un conteneur à portée
    CONTENEUR_FERMER: 'cont_fermer',      // c→s : se désabonner (grille : rendre son contenu)
    CONTENEUR_ETAT: 'cont_etat',          // s→c : contenu complet d'un conteneur ouvert
    CONTENEUR_TRANSFERT: 'cont_transfert',// c→s : déplacer n objets d'un emplacement à un autre
    CONTENEUR_MAJ: 'cont_maj',            // s→c : delta d'un conteneur, aux AUTRES abonnés
    INV_CONSOMMER: 'inv_consommer',       // c→s : diminutions prédites (pose, usure, munition…)
    INV_LACHER: 'inv_lacher',             // c→s : lâcher n objets d'une case au sol
    INV_CREATIF: 'inv_creatif',           // c→s : prendre dans la palette (créatif seulement)
    // B2 — commerce serveur-autoritaire, seul message d'échange (SPEC-SYNC-023)
    TROC: 'troc',                         // c→s consulter/echanger ; s→c offres
    // B4 — événements PvP destinés à un joueur (SPEC-PVP-001 à 006)
    PVP: 'pvp',                           // s→c
  };
  // sens de circulation de chaque message : 'c>s', 's>c' ou 'deux'
  var SENS = {
    inv_maj: 's>c', craft: 'c>s', equip: 'c>s', equip_vu: 's>c',
    cont_ouvrir: 'c>s', cont_fermer: 'c>s', cont_etat: 's>c', cont_transfert: 'c>s', cont_maj: 's>c',
    inv_consommer: 'c>s', inv_lacher: 'c>s', inv_creatif: 'c>s',
    troc: 'deux', pvp: 's>c',
  };

  // ─── bornes ────────────────────────────────────────────────────────────────
  var BORNES = {
    SLOTS_INV: 36,            // MC.Inventory.TOTAL (9 + 27)
    SLOTS_GRILLE: 9,          // grille de fabrication 3×3, une par joueur local
    ID_MAX: 65535,            // ids sur 16 bits (SPEC-SAVE-017)
    N_MAX: 999,               // quantité maximale d'une pile ou d'un transfert
    DMG_MAX: 100000,          // usure d'une pile
    DATA_MAX: 2000,           // `data` d'une pile, en caractères JSON
    SEQ_MAX: 2147483647,      // numéro de séquence d'une opération (par connexion et joueur local)
    OPS_MAX: 16,              // opérations par INV_CONSOMMER
    FOIS_CRAFT_MAX: 64,
    FOIS_TROC_MAX: 16,
    OFFRE_MAX: 63,            // indice d'offre dans le catalogue d'un PNJ
    REFUS_MAX: 16,
    DELTAS_MAX: 4,            // conteneurs modifiés portés par un INV_MAJ
    USURE_MAX: 64,            // points d'usure déclarés en une opération
    PORTEE_CONTENEUR: 6,      // blocs, entre l'œil du joueur et le centre du conteneur
    PORTEE_TROC: 6,           // blocs, entre le joueur et le PNJ
    RAYON_DIFFUSION: 96,      // même rayon que ETAT.mobs (server.js)
    COORD_MAX: 10000000,      // = NP.COORD_MAX (SPEC-SECU-008), dupliqué : aucune dépendance
    WORLD_H: 128,             // = C.WORLD_H, dupliqué pour la même raison
    CHUNK_X: 16, CHUNK_Z: 16,
    TEXTE_MAX: 160,
  };
  var EQUIP_SLOTS = ['casque', 'plastron', 'jambieres', 'bottes', 'bijou'];

  /* Conteneurs serveur (SPEC-SYNC-012). La clé est l'`interactive` du bloc
     (core.js) : ce que game.js reçoit déjà sous la forme `open:<kind>`.
     `parJoueur` : un contenu par joueur nommé (banque : le compte est commun à
     toutes les banques, mais propre à chaque joueur) ; `transitoire` : jamais
     persisté (la grille se vide dans l'inventaire à la fermeture). */
  var TYPES_CONTENEUR = {
    chest:        { taille: 27 },
    armoire:      { taille: 27 },
    etagere:      { taille: 9 },
    bibliotheque: { taille: 18 },
    distributeur: { taille: 9 },
    furnace:      { taille: 3, four: true },
    banque:       { taille: 27, parJoueur: true },
    grille:       { taille: 9, parJoueur: true, transitoire: true },
  };
  // cases d'un fourneau (conteneur 'furnace') : entrée, combustible, sortie
  var FOUR = { ENTREE: 0, COMBUSTIBLE: 1, SORTIE: 2 };
  var ZONES = ['inv', 'grille', 'cont'];
  // motifs de refus, liste fermée (INV_MAJ.refus[].motif)
  var MOTIFS = ['inconnu', 'absent', 'quantite', 'plein', 'portee', 'incompatible', 'recette',
                'debit', 'mort', 'ferme', 'stock', 'tresor', 'embargo', 'offre', 'creatif', 'interdit'];
  var ACTIONS_TROC = ['consulter', 'echanger'];
  var EVTS_PVP = ['victoire', 'defaite', 'duel_propose', 'duel_debut', 'duel_fin', 'hors_la_loi', 'reputation'];
  /* Budgets anti-flood des nouveaux messages c→s (SPEC-SECU-005), en messages
     par seconde ET PAR JOUEUR LOCAL — B1 les ajoute à FLOOD_TYPES_PAR_JOUEUR
     de server.js. INV_CONSOMMER est envoyé au plus une fois par image. */
  var BUDGETS_FLOOD = {
    craft: 30, equip: 30, cont_ouvrir: 30, cont_fermer: 30, cont_transfert: 30,
    inv_consommer: 90, inv_lacher: 30, inv_creatif: 30, troc: 30,
  };
  // passes de maillage (render.js PASSES) et attributs par sommet d'un maillage worker
  var PASSES_MAILLAGE = ['opaque', 'lumineux', 'cutout', 'blend'];
  var ATTRIBUTS_MAILLAGE = {
    positions: 3, normals: 3, uvs: 2, uvBases: 2, uvReps: 2, colors: 3,
    lums: 1, ciels: 1, ondes: 4, ondes2: 4, immerges: 1, souples: 1, feuillages: 1,
  };
  var TYPES_WORKER = ['init', 'pret', 'genere', 'chunk', 'maille', 'maillage', 'erreur'];

  // ─── primitives ────────────────────────────────────────────────────────────
  function estFini(v) { return typeof v === 'number' && isFinite(v); }
  function estEntier(v) { return estFini(v) && Math.floor(v) === v; }
  function entierDans(v, min, max) { return estEntier(v) && v >= min && v <= max; }
  function joueurLocal(j) { return entierDans(j, 0, 3) ? j : 0; }
  function estCoordH(v) { return estEntier(v) && Math.abs(v) <= BORNES.COORD_MAX; }
  function estCoordV(v) { return entierDans(v, 0, BORNES.WORLD_H - 1); }
  function seqValide(v) { return entierDans(v, 1, BORNES.SEQ_MAX); }
  function nomTypeTableau(v) { return Object.prototype.toString.call(v).slice(8, -1); }
  // indépendant du « realm » (vm, Worker) : jamais instanceof
  function estTableauType(v, nom, longueur) {
    if (nomTypeTableau(v) !== nom) return false;
    return longueur === undefined || v.length === longueur;
  }
  function canon(nom) { return String(nom || '').trim().toLowerCase(); }

  // ─── piles et cases ────────────────────────────────────────────────────────
  /* Pile en mémoire : { id, n, dmg?, data? } — celle de MC.Inventory. */
  function validerPile(p) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
    if (!entierDans(p.id, 1, BORNES.ID_MAX) || !entierDans(p.n, 1, BORNES.N_MAX)) return null;
    var out = { id: p.id, n: p.n };
    if (p.dmg !== undefined && p.dmg !== 0) {
      if (!entierDans(p.dmg, 0, BORNES.DMG_MAX)) return null;
      out.dmg = p.dmg;
    }
    if (p.data !== undefined) {
      var txt;
      try { txt = JSON.stringify(p.data); } catch (e) { return null; }
      if (txt === undefined || txt.length > BORNES.DATA_MAX) return null;
      out.data = JSON.parse(txt);
    }
    return out;
  }
  /* Case sérialisée (format de Inv.serialize) : 0 pour vide, sinon
     [id, n], [id, n, dmg] ou [id, n, dmg, data]. Renvoie la case normalisée,
     0 pour une case vide, ou null si invalide. */
  function validerCase(v) {
    if (v === 0 || v === null) return 0;
    if (!Array.isArray(v) || v.length < 2 || v.length > 4) return null;
    var p = validerPile({ id: v[0], n: v[1], dmg: v.length > 2 ? v[2] : undefined, data: v.length > 3 ? v[3] : undefined });
    return p ? pileVersCase(p) : null;
  }
  function pileVersCase(p) {
    if (!p) return 0;
    if (p.data !== undefined) return [p.id, p.n, p.dmg || 0, p.data];
    return p.dmg ? [p.id, p.n, p.dmg] : [p.id, p.n];
  }
  function caseVersPile(c) {
    if (!c) return null;
    var p = { id: c[0], n: c[1] };
    if (c[2]) p.dmg = c[2];
    if (c[3] !== undefined) p.data = c[3];
    return p;
  }
  function validerCases(liste, taille) {
    if (!Array.isArray(liste) || liste.length !== taille) return null;
    var out = [];
    for (var i = 0; i < liste.length; i++) {
      var c = validerCase(liste[i]);
      if (c === null) return null;
      out.push(c);
    }
    return out;
  }
  // équipement : { casque: case, plastron: case, … } — toutes les clés présentes
  function validerEquip(e) {
    if (!e || typeof e !== 'object') return null;
    var out = {};
    for (var i = 0; i < EQUIP_SLOTS.length; i++) {
      var c = validerCase(e[EQUIP_SLOTS[i]] === undefined ? 0 : e[EQUIP_SLOTS[i]]);
      if (c === null) return null;
      out[EQUIP_SLOTS[i]] = c;
    }
    return out;
  }

  // ─── clés ──────────────────────────────────────────────────────────────────
  /* Clé d'un conteneur posé : « x,y,z » (même convention que game.js
     `chests[k]` et que world.key3) ; 'banque' et 'grille' désignent les
     conteneurs propres au joueur local qui émet le message. */
  function cleConteneur(x, y, z) { return (x | 0) + ',' + (y | 0) + ',' + (z | 0); }
  function lireCle(cle) {
    if (cle === 'banque' || cle === 'grille') return { propre: cle };
    if (typeof cle !== 'string' || cle.length > 40) return null;
    var p = cle.split(',');
    if (p.length !== 3) return null;
    var x = +p[0], y = +p[1], z = +p[2];
    if (!estCoordH(x) || !estCoordV(y) || !estCoordH(z)) return null;
    if (cleConteneur(x, y, z) !== cle) return null;          // pas de « 01,2,3 » ni « 1.0,2,3 »
    return { x: x, y: y, z: z };
  }
  /* Clé du registre des joueurs nommés (B1, préfigure SPEC-SYNC-020) : un
     poste en écran partagé porte jusqu'à 4 joueurs sous UN nom de connexion. */
  function cleRegistre(nom, j) {
    var c = canon(nom);
    if (!c) return null;
    var jj = joueurLocal(j);
    return jj ? c + '#' + jj : c;
  }
  /* Identifiant stable d'une offre de métier (B2, SPEC-ECO-001) :
     « <lieu>|<role>|<indice> » — le lieu vient de `ent.lieu` (habitats.js),
     « campagne » pour un villageois sans lieu (catalogue Inv.TRADES). */
  function offreId(lieu, role, indice) {
    return String(lieu || 'campagne') + '|' + String(role || 'villageois') + '|' + (indice | 0);
  }
  function lireOffreId(id) {
    if (typeof id !== 'string' || id.length > 80) return null;
    var p = id.split('|');
    if (p.length !== 3 || !p[0] || !p[1] || !/^\d+$/.test(p[2])) return null;
    var i = +p[2];
    if (i > BORNES.OFFRE_MAX) return null;
    return { lieu: p[0], role: p[1], indice: i };
  }

  // ─── emplacements ──────────────────────────────────────────────────────────
  /* { z:'inv', i } · { z:'grille', i } · { z:'cont', cle, i } */
  function validerEmplacement(e) {
    if (!e || typeof e !== 'object' || ZONES.indexOf(e.z) < 0) return null;
    if (e.z === 'inv') return entierDans(e.i, 0, BORNES.SLOTS_INV - 1) ? { z: 'inv', i: e.i } : null;
    if (e.z === 'grille') return entierDans(e.i, 0, BORNES.SLOTS_GRILLE - 1) ? { z: 'grille', i: e.i } : null;
    var cle = lireCle(e.cle);
    if (!cle || cle.propre === 'grille') return null;       // la grille est la zone 'grille'
    var max = cle.propre === 'banque' ? TYPES_CONTENEUR.banque.taille : 27;
    // la taille exacte dépend du type de bloc : c'est le serveur qui la vérifie
    return entierDans(e.i, 0, max - 1) ? { z: 'cont', cle: e.cle, i: e.i } : null;
  }
  function memeEmplacement(a, b) { return a.z === b.z && a.i === b.i && (a.z !== 'cont' || a.cle === b.cle); }

  // ─── conteneurs ────────────────────────────────────────────────────────────
  function tailleConteneur(type) { var t = TYPES_CONTENEUR[type]; return t ? t.taille : 0; }
  function validerFour(f) {
    if (!f || typeof f !== 'object' || !estFini(f.burn) || !estFini(f.cook)) return null;
    return { burn: Math.max(0, Math.min(3600, +f.burn)), cook: Math.max(0, Math.min(60, +f.cook)) };
  }
  /* Conteneur tel qu'il est persisté dans etatMonde (B1, SPEC-SERVEUR-006
     partiel) : { cle, type, slots:[cases], four? } — ni la grille (transitoire)
     ni la banque (rangée dans l'enregistrement du joueur). */
  function validerConteneurPersiste(o) {
    if (!o || typeof o !== 'object') return null;
    var t = TYPES_CONTENEUR[o.type];
    if (!t || t.parJoueur) return null;
    var cle = lireCle(o.cle);
    if (!cle || cle.propre) return null;
    var slots = validerCases(o.slots, t.taille);
    if (!slots) return null;
    var out = { cle: o.cle, type: o.type, slots: slots };
    if (t.four) {
      var f = validerFour(o.four || { burn: 0, cook: 0 });
      if (!f) return null;
      out.four = f;
    }
    return out;
  }
  /* Enregistrement d'un joueur nommé (B1) : { v:1, inv:[36], equip, banque:[27] }.
     Les champs inconnus sont CONSERVÉS tels quels (C1 y ajoutera position,
     statistiques, réapparition — SPEC-SYNC-020/021). */
  function validerEnregistrementJoueur(r) {
    if (!r || typeof r !== 'object' || r.v !== 1) return null;
    var inv = validerCases(r.inv, BORNES.SLOTS_INV);
    var equip = validerEquip(r.equip || {});
    var banque = r.banque === undefined ? validerCases(new Array(27).fill(0), 27) : validerCases(r.banque, 27);
    if (!inv || !equip || !banque) return null;
    var out = {};
    Object.keys(r).forEach(function (k) { out[k] = r[k]; });
    out.inv = inv; out.equip = equip; out.banque = banque;
    return out;
  }

  // ─── messages client → serveur ─────────────────────────────────────────────
  function base(msg, avecSeq) {
    var o = { t: msg.t, j: joueurLocal(msg.j) };
    if (avecSeq === 'requis') { if (!seqValide(msg.seq)) return null; o.seq = msg.seq; }
    else if (msg.seq !== undefined) { if (!seqValide(msg.seq)) return null; o.seq = msg.seq; }
    return o;
  }
  function validerCraft(msg) {
    var o = base(msg, 'requis'); if (!o) return null;
    o.fois = msg.fois === undefined ? 1 : msg.fois;
    return entierDans(o.fois, 1, BORNES.FOIS_CRAFT_MAX) ? o : null;
  }
  function validerEquipMsg(msg) {
    var o = base(msg, 'requis'); if (!o) return null;
    if (EQUIP_SLOTS.indexOf(msg.slot) < 0 || !entierDans(msg.i, 0, BORNES.SLOTS_INV - 1)) return null;
    o.slot = msg.slot; o.i = msg.i;
    return o;
  }
  function validerOuvrir(msg) {
    var o = base(msg, 'facultatif'); if (!o) return null;
    var aPos = msg.x !== undefined || msg.y !== undefined || msg.z !== undefined;
    if (aPos === (msg.eid !== undefined)) return null;       // exactement une cible
    if (aPos) {
      if (!estCoordH(msg.x) || !estCoordV(msg.y) || !estCoordH(msg.z)) return null;
      o.x = msg.x; o.y = msg.y; o.z = msg.z;
    } else {
      if (!entierDans(msg.eid, 0, BORNES.SEQ_MAX)) return null;
      o.eid = msg.eid;                                        // un banquier (banque sans coffre-fort)
    }
    return o;
  }
  function validerFermer(msg) {
    var o = base(msg, 'facultatif'); if (!o) return null;
    if (!lireCle(msg.cle)) return null;
    if (msg.cle === 'grille' && o.seq === undefined) return null;  // rendre la grille modifie l'inventaire
    o.cle = msg.cle;
    return o;
  }
  function validerTransfert(msg) {
    var o = base(msg, 'requis'); if (!o) return null;
    var de = validerEmplacement(msg.de), vers = validerEmplacement(msg.vers);
    if (!de || !vers || memeEmplacement(de, vers)) return null;
    if (!entierDans(msg.n, 1, BORNES.N_MAX)) return null;
    o.de = de; o.vers = vers; o.n = msg.n;
    return o;
  }
  /* Une opération de diminution prédite par le client (SPEC-SYNC-007) :
       { i, id, n }        consommer n objets de la case i (pose, munition, engrais…)
       { i, id, usure }    user l'outil de la case i de `usure` points
       { i, id, vers }     transformer la pile de la case i (seau plein → vide…),
                           accepté seulement si la paire figure dans la liste
                           blanche du serveur (B1 : Conteneurs.TRANSFORMATIONS). */
  function validerOpConsommer(op) {
    if (!op || typeof op !== 'object') return null;
    if (!entierDans(op.i, 0, BORNES.SLOTS_INV - 1) || !entierDans(op.id, 1, BORNES.ID_MAX)) return null;
    var formes = (op.n !== undefined ? 1 : 0) + (op.usure !== undefined ? 1 : 0) + (op.vers !== undefined ? 1 : 0);
    if (formes > 1) return null;
    if (op.usure !== undefined) return entierDans(op.usure, 1, BORNES.USURE_MAX) ? { i: op.i, id: op.id, usure: op.usure } : null;
    if (op.vers !== undefined) return entierDans(op.vers, 1, BORNES.ID_MAX) && op.vers !== op.id ? { i: op.i, id: op.id, vers: op.vers } : null;
    var n = op.n === undefined ? 1 : op.n;
    return entierDans(n, 1, BORNES.N_MAX) ? { i: op.i, id: op.id, n: n } : null;
  }
  function validerConsommer(msg) {
    var o = base(msg, 'requis'); if (!o) return null;
    if (!Array.isArray(msg.ops) || !msg.ops.length || msg.ops.length > BORNES.OPS_MAX) return null;
    var ops = [];
    for (var k = 0; k < msg.ops.length; k++) {
      var op = validerOpConsommer(msg.ops[k]);
      if (!op) return null;
      ops.push(op);
    }
    o.ops = ops;
    return o;
  }
  function validerLacher(msg) {
    var o = base(msg, 'requis'); if (!o) return null;
    if (!entierDans(msg.i, 0, BORNES.SLOTS_INV - 1) || !entierDans(msg.n, 1, BORNES.N_MAX)) return null;
    o.i = msg.i; o.n = msg.n;
    return o;
  }
  function validerCreatif(msg) {
    var o = base(msg, 'requis'); if (!o) return null;
    if (!entierDans(msg.i, 0, BORNES.SLOTS_INV - 1) || !entierDans(msg.id, 1, BORNES.ID_MAX) ||
        !entierDans(msg.n, 1, BORNES.N_MAX)) return null;
    o.i = msg.i; o.id = msg.id; o.n = msg.n;
    return o;
  }
  /* TROC client → serveur (SPEC-SYNC-023, B2) :
       { t:'troc', j, action:'consulter', eid }                 → le serveur répond action 'offres'
       { t:'troc', j, seq, action:'echanger', eid, offre, fois } → INV_MAJ (ack/refus) puis 'offres' */
  function validerTroc(msg) {
    if (ACTIONS_TROC.indexOf(msg.action) < 0) return null;
    var o = base(msg, msg.action === 'echanger' ? 'requis' : 'facultatif'); if (!o) return null;
    if (!entierDans(msg.eid, 0, BORNES.SEQ_MAX)) return null;
    o.action = msg.action; o.eid = msg.eid;
    if (msg.action === 'echanger') {
      if (!entierDans(msg.offre, 0, BORNES.OFFRE_MAX)) return null;
      var fois = msg.fois === undefined ? 1 : msg.fois;
      if (!entierDans(fois, 1, BORNES.FOIS_TROC_MAX)) return null;
      o.offre = msg.offre; o.fois = fois;
    }
    return o;
  }
  /* MANGER, version vague 2 (B1 l'appelle depuis le `case MSG.MANGER` de
     NP.valider) : `i` (case consommée) et `seq` deviennent possibles ; sans
     eux, le message reste accepté (compatibilité), le serveur consommant
     alors la première case qui porte `id`. */
  function validerManger(msg) {
    if (!msg || !estEntier(msg.id)) return null;
    var o = { t: msg.t, id: msg.id | 0, j: joueurLocal(msg.j) };
    if (msg.i !== undefined) { if (!entierDans(msg.i, 0, BORNES.SLOTS_INV - 1)) return null; o.i = msg.i; }
    if (msg.seq !== undefined) { if (!seqValide(msg.seq)) return null; o.seq = msg.seq; }
    return o;
  }

  // ─── messages serveur → client ─────────────────────────────────────────────
  function validerRefus(liste) {
    if (liste === undefined) return [];
    if (!Array.isArray(liste) || liste.length > BORNES.REFUS_MAX) return null;
    var out = [];
    for (var k = 0; k < liste.length; k++) {
      var r = liste[k];
      if (!r || !seqValide(r.seq) || MOTIFS.indexOf(r.motif) < 0) return null;
      out.push({ seq: r.seq, motif: r.motif });
    }
    return out;
  }
  function validerMaj(liste, taille) {
    if (!Array.isArray(liste) || liste.length > taille) return null;
    var out = [];
    for (var k = 0; k < liste.length; k++) {
      var e = liste[k];
      if (!Array.isArray(e) || e.length !== 2 || !entierDans(e[0], 0, taille - 1)) return null;
      var c = validerCase(e[1]);
      if (c === null) return null;
      out.push([e[0], c]);
    }
    return out;
  }
  function validerDelta(d) {
    if (!d || typeof d !== 'object' || !lireCle(d.cle) || !entierDans(d.rev, 1, BORNES.SEQ_MAX)) return null;
    var maj = validerMaj(d.maj, 27);
    if (!maj) return null;
    var out = { cle: d.cle, rev: d.rev, maj: maj };
    if (d.four !== undefined) { var f = validerFour(d.four); if (!f) return null; out.four = f; }
    return out;
  }
  /* INV_MAJ (SPEC-SYNC-008) : { t, j, rev, ack, inv:[36], equip, grille:[9],
     refus?, conteneurs?, gain? } — `rev` croît à chaque envoi pour ce joueur
     local (un INV_MAJ de rev ≤ au dernier reçu est ignoré) ; `ack` est le plus
     grand `seq` traité (accepté OU refusé) : le client retire de sa file de
     prédiction toute opération de seq ≤ ack. */
  function validerInvMaj(m) {
    if (!m || m.t !== MSG.INV_MAJ) return null;
    if (!entierDans(m.rev, 1, BORNES.SEQ_MAX) || !entierDans(m.ack, 0, BORNES.SEQ_MAX)) return null;
    var inv = validerCases(m.inv, BORNES.SLOTS_INV), equip = validerEquip(m.equip),
        grille = validerCases(m.grille, BORNES.SLOTS_GRILLE), refus = validerRefus(m.refus);
    if (!inv || !equip || !grille || !refus) return null;
    var out = { t: m.t, j: joueurLocal(m.j), rev: m.rev, ack: m.ack, inv: inv, equip: equip, grille: grille, refus: refus, conteneurs: [] };
    if (m.conteneurs !== undefined) {
      if (!Array.isArray(m.conteneurs) || m.conteneurs.length > BORNES.DELTAS_MAX) return null;
      for (var k = 0; k < m.conteneurs.length; k++) {
        var d = validerDelta(m.conteneurs[k]);
        if (!d) return null;
        out.conteneurs.push(d);
      }
    }
    if (m.gain !== undefined) {
      var g = validerPile(m.gain);
      if (!g) return null;
      out.gain = { id: g.id, n: g.n };
    }
    return out;
  }
  /* Fabrique un INV_MAJ depuis l'état serveur d'un joueur local — partagé par
     B1, B2 (TROC) et B4 (butin PvP), pour qu'aucun lot n'ait besoin d'une
     fonction de server.js définie par un autre. `joueur` : { inv, equip,
     grille } où `inv`/`grille` sont des MC.Inventory (ou { slots }). */
  function messageInvMaj(joueur, opts) {
    opts = opts || {};
    function cases(inv, taille) {
      var slots = inv && inv.slots ? inv.slots : (Array.isArray(inv) ? inv : []);
      var out = [];
      for (var i = 0; i < taille; i++) out.push(pileVersCase(slots[i] || null));
      return out;
    }
    var equip = {};
    EQUIP_SLOTS.forEach(function (s) { equip[s] = pileVersCase((joueur.equip && joueur.equip[s]) || null); });
    var m = { t: MSG.INV_MAJ, j: joueurLocal(opts.j), rev: opts.rev || 1, ack: opts.ack || 0,
              inv: cases(joueur.inv, BORNES.SLOTS_INV), equip: equip, grille: cases(joueur.grille, BORNES.SLOTS_GRILLE) };
    if (opts.refus && opts.refus.length) m.refus = opts.refus.slice(0, BORNES.REFUS_MAX);
    if (opts.conteneurs && opts.conteneurs.length) m.conteneurs = opts.conteneurs.slice(0, BORNES.DELTAS_MAX);
    if (opts.gain) m.gain = { id: opts.gain.id, n: opts.gain.n };
    return m;
  }
  function validerEquipVu(m) {
    if (!m || m.t !== MSG.EQUIP_VU || !entierDans(m.id, 0, BORNES.SEQ_MAX)) return null;
    if (EQUIP_SLOTS.indexOf(m.slot) < 0 || !entierDans(m.objet, 0, BORNES.ID_MAX)) return null;
    return { t: m.t, id: m.id, j: joueurLocal(m.j), slot: m.slot, objet: m.objet };
  }
  function validerConteneurEtat(m) {
    if (!m || m.t !== MSG.CONTENEUR_ETAT) return null;
    var t = TYPES_CONTENEUR[m.type];
    if (!t || !lireCle(m.cle) || !entierDans(m.rev, 0, BORNES.SEQ_MAX)) return null;
    var slots = validerCases(m.slots, t.taille);
    if (!slots) return null;
    var out = { t: m.t, j: joueurLocal(m.j), cle: m.cle, type: m.type, rev: m.rev, slots: slots };
    if (t.four) { var f = validerFour(m.four || { burn: 0, cook: 0 }); if (!f) return null; out.four = f; }
    return out;
  }
  function validerConteneurMaj(m) {
    if (!m || m.t !== MSG.CONTENEUR_MAJ) return null;
    var d = validerDelta(m);
    if (!d) return null;
    d.t = m.t;
    return d;
  }
  /* TROC serveur → client : { t:'troc', action:'offres', eid, offres:[…], cours?, remise? }
     offre : { i, give:[{id,n}], get:{id,n}, prix (émeraudes par lot, réel ≥ 0),
               stock (entier ≥ 0, ou null si illimité), dispo (bool) } */
  function validerLigneOffre(o) {
    if (!o || !entierDans(o.i, 0, BORNES.OFFRE_MAX) || !Array.isArray(o.give) || !o.give.length || o.give.length > 4) return null;
    var give = [];
    for (var k = 0; k < o.give.length; k++) {
      var p = validerPile(o.give[k]); if (!p) return null;
      give.push({ id: p.id, n: p.n });
    }
    var get = validerPile(o.get);
    if (!get || !estFini(o.prix) || o.prix < 0) return null;
    if (o.stock !== null && o.stock !== undefined && !entierDans(o.stock, 0, 1000000)) return null;
    return { i: o.i, give: give, get: { id: get.id, n: get.n }, prix: +o.prix,
             stock: o.stock === undefined ? null : o.stock, dispo: !!o.dispo };
  }
  function validerTrocReponse(m) {
    if (!m || m.t !== MSG.TROC || m.action !== 'offres' || !entierDans(m.eid, 0, BORNES.SEQ_MAX)) return null;
    if (!Array.isArray(m.offres) || m.offres.length > BORNES.OFFRE_MAX + 1) return null;
    var out = { t: m.t, action: 'offres', eid: m.eid, offres: [], cours: [], remise: 0 };
    for (var k = 0; k < m.offres.length; k++) {
      var l = validerLigneOffre(m.offres[k]); if (!l) return null;
      out.offres.push(l);
    }
    if (m.cours !== undefined) {
      if (!Array.isArray(m.cours) || m.cours.length > 32) return null;
      for (var c = 0; c < m.cours.length; c++) {
        var e = m.cours[c];
        if (!e || !entierDans(e.id, 1, BORNES.ID_MAX) || !estFini(e.prix) || e.prix < 0) return null;
        out.cours.push({ id: e.id, prix: +e.prix });
      }
    }
    if (m.remise !== undefined) {
      if (!estFini(m.remise) || m.remise < 0 || m.remise > 0.5) return null;
      out.remise = +m.remise;
    }
    return out;
  }
  /* Transaction de troc journalisée/arbitrée (B2) :
     { offre: offreId, give:[{id,n}], get:{id,n}, prix, fois } — c'est ce que
     rend Economie.executerTroc en cas de succès, et ce que journalise l'admin. */
  function validerTransaction(tr) {
    if (!tr || !lireOffreId(tr.offre) || !entierDans(tr.fois, 1, BORNES.FOIS_TROC_MAX)) return null;
    var l = validerLigneOffre({ i: lireOffreId(tr.offre).indice, give: tr.give, get: tr.get, prix: tr.prix, stock: null, dispo: true });
    if (!l) return null;
    return { offre: tr.offre, give: l.give, get: l.get, prix: l.prix, fois: tr.fois };
  }
  /* PVP serveur → client (B4) : { t:'pvp', evt, de?, contre?, n?, perte?, jusque?, factions? } */
  function validerPvp(m) {
    if (!m || m.t !== MSG.PVP || EVTS_PVP.indexOf(m.evt) < 0) return null;
    var out = { t: m.t, evt: m.evt };
    ['de', 'contre'].forEach(function (k) {
      if (m[k] !== undefined) out[k] = typeof m[k] === 'string' ? m[k].slice(0, 24) : null;
    });
    if (out.de === null || out.contre === null) return null;
    if (m.n !== undefined) { if (!entierDans(m.n, 0, 1000000)) return null; out.n = m.n; }
    if (m.jusque !== undefined) { if (!estFini(m.jusque)) return null; out.jusque = +m.jusque; }
    if (m.perte !== undefined) {
      if (!Array.isArray(m.perte) || m.perte.length > BORNES.SLOTS_INV) return null;
      out.perte = [];
      for (var k = 0; k < m.perte.length; k++) {
        var p = validerPile(m.perte[k]); if (!p) return null;
        out.perte.push({ id: p.id, n: p.n });
      }
    }
    if (m.factions !== undefined) {
      if (!Array.isArray(m.factions) || m.factions.length > 32) return null;
      out.factions = [];
      for (var f = 0; f < m.factions.length; f++) {
        var e = m.factions[f];
        if (!e || typeof e.id !== 'string' || !estFini(e.delta) || !estFini(e.valeur)) return null;
        out.factions.push({ id: e.id.slice(0, 80), delta: +e.delta, valeur: Math.max(-100, Math.min(100, +e.valeur)) });
      }
    }
    return out;
  }

  /* Point d'entrée unique des NOUVEAUX types c→s, appelé depuis le `default:`
     de NP.valider (B1, étape 1). Un type inconnu, ou un message s→c reçu par
     le serveur, renvoie null. */
  function valider(msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return null;
    switch (msg.t) {
      case MSG.CRAFT: return validerCraft(msg);
      case MSG.EQUIP: return validerEquipMsg(msg);
      case MSG.CONTENEUR_OUVRIR: return validerOuvrir(msg);
      case MSG.CONTENEUR_FERMER: return validerFermer(msg);
      case MSG.CONTENEUR_TRANSFERT: return validerTransfert(msg);
      case MSG.INV_CONSOMMER: return validerConsommer(msg);
      case MSG.INV_LACHER: return validerLacher(msg);
      case MSG.INV_CREATIF: return validerCreatif(msg);
      case MSG.TROC: return validerTroc(msg);
      default: return null;
    }
  }
  // côté client : valide un message reçu du serveur parmi les nouveaux types s→c
  function validerRecu(msg) {
    if (!msg || typeof msg !== 'object') return null;
    switch (msg.t) {
      case MSG.INV_MAJ: return validerInvMaj(msg);
      case MSG.EQUIP_VU: return validerEquipVu(msg);
      case MSG.CONTENEUR_ETAT: return validerConteneurEtat(msg);
      case MSG.CONTENEUR_MAJ: return validerConteneurMaj(msg);
      case MSG.TROC: return validerTrocReponse(msg);
      case MSG.PVP: return validerPvp(msg);
      default: return null;
    }
  }

  // ─── messages worker (B3, SPEC-PERF-004 à 010) ─────────────────────────────
  var BLOCS_CHUNK = BORNES.CHUNK_X * BORNES.WORLD_H * BORNES.CHUNK_Z;   // 32768
  var COLONNES = BORNES.CHUNK_X * BORNES.CHUNK_Z;                         // 256
  var LUMIERE_FENETRE = (BORNES.CHUNK_X + 2) * (BORNES.CHUNK_Z + 2) * BORNES.WORLD_H;  // lumiere.js : marge 1
  function validerEau(e) {
    if (e === null || e === undefined) return null;
    if (!e || !estTableauType(e.nature, 'Uint8Array', COLONNES) || !estTableauType(e.flux, 'Int8Array', COLONNES * 2) ||
        !estTableauType(e.prof, 'Uint8Array', COLONNES)) return undefined;
    return { nature: e.nature, flux: e.flux, prof: e.prof };
  }
  function validerDonneesChunk(d, eauRequise) {
    if (!d || !estTableauType(d.blocks, 'Uint16Array', BLOCS_CHUNK)) return null;
    if (d.etats !== null && d.etats !== undefined && !estTableauType(d.etats, 'Uint8Array', BLOCS_CHUNK)) return null;
    var eau = validerEau(d.eau);
    if (eau === undefined || (eauRequise && !eau)) return null;
    return { blocks: d.blocks, etats: d.etats || null, eau: eau };
  }
  function validerPasse(p) {
    if (p === null) return null;
    if (!p || typeof p !== 'object' || !estTableauType(p.positions, 'Float32Array')) return undefined;
    var nv = p.positions.length / 3;
    if (!nv || Math.floor(nv) !== nv) return undefined;
    var out = {};
    var cles = Object.keys(ATTRIBUTS_MAILLAGE);
    for (var k = 0; k < cles.length; k++) {
      if (!estTableauType(p[cles[k]], 'Float32Array', nv * ATTRIBUTS_MAILLAGE[cles[k]])) return undefined;
      out[cles[k]] = p[cles[k]];
    }
    if (!estTableauType(p.indices, 'Uint32Array') || !p.indices.length || p.indices.length % 3) return undefined;
    for (var i = 0; i < p.indices.length; i++) if (p.indices[i] >= nv) return undefined;
    out.indices = p.indices;
    return out;
  }
  /* Messages entre le thread principal et les workers. Tous portent `type` et
     `epoque` (numéro du monde courant : un résultat d'une époque passée — le
     monde a été remplacé, autre graine — est ignoré). Les tableaux typés sont
     TRANSFÉRÉS (SPEC-PERF-008), jamais copiés : voir transferablesDe.
       init     p→w { epoque, graine, options:{ zonePolitique } , v }
       pret     w→p { epoque }
       genere   p→w { epoque, cx, cz }
       chunk    w→p { epoque, cx, cz, blocks:Uint16Array(32768), etats:Uint8Array|null, eau:{…}, ms }
       maille   p→w { epoque, cx, cz, version, simplifie, fusion, voisins:[9] }   (voisins[4] = le chunk)
       maillage w→p { epoque, cx, cz, version, passes:{opaque,lumineux,cutout,blend}, lumiere, ms }
       erreur   w→p { epoque, cx?, cz?, message } */
  function validerMessageWorker(m) {
    if (!m || typeof m !== 'object' || TYPES_WORKER.indexOf(m.type) < 0 || !entierDans(m.epoque, 0, BORNES.SEQ_MAX)) return null;
    var out = { type: m.type, epoque: m.epoque };
    function coords() {
      if (!estCoordH(m.cx) || !estCoordH(m.cz)) return false;
      out.cx = m.cx; out.cz = m.cz;
      return true;
    }
    switch (m.type) {
      case 'init': {
        if (!estEntier(m.graine) || m.v !== VERSION) return null;
        var opts = m.options || {};
        if (opts.zonePolitique !== undefined && opts.zonePolitique !== null && typeof opts.zonePolitique !== 'string') return null;
        out.graine = m.graine; out.v = m.v;
        out.options = { zonePolitique: opts.zonePolitique === undefined ? null : opts.zonePolitique };
        return out;
      }
      case 'pret': return out;
      case 'genere': return coords() ? out : null;
      case 'chunk': {
        if (!coords()) return null;
        var d = validerDonneesChunk(m, true);
        if (!d || !estFini(m.ms) || m.ms < 0) return null;
        out.blocks = d.blocks; out.etats = d.etats; out.eau = d.eau; out.ms = +m.ms;
        return out;
      }
      case 'maille': {
        if (!coords() || !entierDans(m.version, 0, BORNES.SEQ_MAX)) return null;
        if (!Array.isArray(m.voisins) || m.voisins.length !== 9) return null;
        var voisins = [];
        for (var k = 0; k < 9; k++) {
          if (m.voisins[k] === null) { if (k === 4) return null; voisins.push(null); continue; }
          var dv = validerDonneesChunk(m.voisins[k], false);
          if (!dv) return null;
          voisins.push(dv);
        }
        out.version = m.version; out.simplifie = !!m.simplifie; out.fusion = m.fusion !== false; out.voisins = voisins;
        return out;
      }
      case 'maillage': {
        if (!coords() || !entierDans(m.version, 0, BORNES.SEQ_MAX) || !estFini(m.ms) || m.ms < 0) return null;
        if (!m.passes || typeof m.passes !== 'object') return null;
        out.passes = {};
        for (var p = 0; p < PASSES_MAILLAGE.length; p++) {
          var nom = PASSES_MAILLAGE[p];
          var v = validerPasse(m.passes[nom] === undefined ? null : m.passes[nom]);
          if (v === undefined) return null;
          out.passes[nom] = v;
        }
        if (m.lumiere === null || m.lumiere === undefined) out.lumiere = null;
        else {
          var l = m.lumiere;
          if (!estTableauType(l.niveaux, 'Uint8Array', LUMIERE_FENETRE) || !estTableauType(l.ciel, 'Uint8Array', LUMIERE_FENETRE) ||
              !entierDans(l.sources, 0, BLOCS_CHUNK * 9)) return null;
          out.lumiere = { niveaux: l.niveaux, ciel: l.ciel, sources: l.sources };
        }
        out.version = m.version; out.ms = +m.ms;
        return out;
      }
      case 'erreur': {
        if (typeof m.message !== 'string') return null;
        if (m.cx !== undefined || m.cz !== undefined) { if (!coords()) return null; }
        out.message = m.message.slice(0, 500);
        return out;
      }
    }
    return null;
  }
  /* Liste des ArrayBuffer à TRANSFÉRER avec un message worker (second
     argument de postMessage) : chaque tampon une seule fois, dans l'ordre de
     première rencontre. Parcourt les champs connus des messages chunk,
     maille et maillage. */
  function transferablesDe(m) {
    var out = [];
    function ajouter(t) {
      if (t && ArrayBuffer.isView(t) && out.indexOf(t.buffer) < 0) out.push(t.buffer);
    }
    function donnees(d) {
      if (!d) return;
      ajouter(d.blocks); ajouter(d.etats);
      if (d.eau) { ajouter(d.eau.nature); ajouter(d.eau.flux); ajouter(d.eau.prof); }
    }
    if (!m || typeof m !== 'object') return out;
    donnees(m);
    if (Array.isArray(m.voisins)) m.voisins.forEach(donnees);
    if (m.passes) PASSES_MAILLAGE.forEach(function (nom) {
      var p = m.passes[nom];
      if (!p) return;
      Object.keys(ATTRIBUTS_MAILLAGE).forEach(function (k) { ajouter(p[k]); });
      ajouter(p.indices);
    });
    if (m.lumiere) { ajouter(m.lumiere.niveaux); ajouter(m.lumiere.ciel); }
    return out;
  }

  MC.ContratsV2 = {
    VERSION: VERSION, MSG: MSG, SENS: SENS, BORNES: BORNES, EQUIP_SLOTS: EQUIP_SLOTS,
    TYPES_CONTENEUR: TYPES_CONTENEUR, FOUR: FOUR, ZONES: ZONES, MOTIFS: MOTIFS,
    ACTIONS_TROC: ACTIONS_TROC, EVTS_PVP: EVTS_PVP, BUDGETS_FLOOD: BUDGETS_FLOOD,
    PASSES_MAILLAGE: PASSES_MAILLAGE, ATTRIBUTS_MAILLAGE: ATTRIBUTS_MAILLAGE, TYPES_WORKER: TYPES_WORKER,
    // formes partagées
    validerPile: validerPile, validerCase: validerCase, validerCases: validerCases, validerEquip: validerEquip,
    pileVersCase: pileVersCase, caseVersPile: caseVersPile,
    cleConteneur: cleConteneur, lireCle: lireCle, cleRegistre: cleRegistre, offreId: offreId, lireOffreId: lireOffreId,
    validerEmplacement: validerEmplacement, tailleConteneur: tailleConteneur,
    validerConteneurPersiste: validerConteneurPersiste, validerEnregistrementJoueur: validerEnregistrementJoueur,
    // messages client → serveur
    valider: valider, validerManger: validerManger, validerOpConsommer: validerOpConsommer,
    // messages serveur → client
    validerRecu: validerRecu, validerInvMaj: validerInvMaj, messageInvMaj: messageInvMaj,
    validerEquipVu: validerEquipVu, validerConteneurEtat: validerConteneurEtat, validerConteneurMaj: validerConteneurMaj,
    validerTrocReponse: validerTrocReponse, validerTransaction: validerTransaction, validerPvp: validerPvp,
    // workers
    validerMessageWorker: validerMessageWorker, transferablesDe: transferablesDe,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
