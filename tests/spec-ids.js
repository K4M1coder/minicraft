/* spec-ids.js — L40-bis B : identifiants figés, plages déclarées et état de
   bloc borné (SPEC-SAVE-019, SPEC-SAVE-020, SPEC-SAVE-021).

   SPEC-SAVE-019 — le registre versionné tests/donnees/ids.json associe chaque
   id de bloc (`B.*`) et d'objet (`I.*`) à son nom de clé. Il a été écrit en
   CARACTÉRISANT les tables de src/core.js telles qu'elles étaient avant ce
   lot (aucune migration : il fige la situation existante). Les formes L24
   (escaliers, dalles, clôture…) gardent leurs ids auto-incrémentés dans
   l'ordre de leurs listes (`idForme`, core.js) : c'est ce test, et lui seul,
   qui rend ce numérotage sûr.
     Mutation notée (vérifiée à la main lors de l'écriture de ce test) :
     permuter deux escaliers dans la liste de src/core.js — par exemple
     ['ESCALIER_PLANKS', …] et ['ESCALIER_SAPIN', …] — échange leurs ids
     (200 et 201) : le test « un nom change d'id » échoue et nomme les deux.
     Le dernier test de ce groupe rejoue cette permutation sur une copie des
     tables pour que la mutation reste prouvée en continu.
   Ajouter un bloc ou un objet = une ligne de plus dans ids.json (le message
   d'échec donne la ligne exacte à ajouter). Retirer un bloc ou un objet = le
   déplacer dans `retires` (son id n'est plus jamais réattribué).

   Chargement du registre : `require` sous Node (tests/run.js l'expose), une
   requête synchrone sur le serveur du banc dans le navigateur
   (tests/index.html est servi depuis /tests/, d'où `donnees/ids.json`). */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core;

  function chargerRegistre() {
    if (typeof require === 'function') return require('./donnees/ids.json');
    var xhr = new G.XMLHttpRequest();
    xhr.open('GET', 'donnees/ids.json?t=' + Date.now(), false);
    xhr.send(null);
    if (xhr.status !== 200) throw new Error('tests/donnees/ids.json illisible (HTTP ' + xhr.status + ')');
    return JSON.parse(xhr.responseText);
  }
  var REGISTRE = null, ERREUR_REGISTRE = null;
  try { REGISTRE = chargerRegistre(); } catch (e) { ERREUR_REGISTRE = e; }
  function registre() {
    if (ERREUR_REGISTRE) throw new Error('registre des ids introuvable : ' + ERREUR_REGISTRE.message);
    return REGISTRE;
  }

  /* Compare une table de noms (`B` ou `I` : nom → id) à sa section du
     registre (id → nom) et à ses retraits (id → ancien nom). Renvoie la liste
     des écarts, chacun lisible tel quel ; vide = identique. Fonction pure :
     le dernier test la rejoue sur une table mutée. */
  function ecarts(table, section, retires, prefixe) {
    var out = [];
    var parId = {};
    Object.keys(table).forEach(function (nom) {
      var id = table[nom];
      if (parId[id] !== undefined) out.push('id ' + id + ' porté par deux noms : ' + prefixe + parId[id] + ' et ' + prefixe + nom);
      parId[id] = nom;
    });
    var nomsRegistre = {};
    Object.keys(section).forEach(function (idTexte) { nomsRegistre[section[idTexte]] = +idTexte; });
    // un nom du code : déclaré au registre, au même id
    Object.keys(table).forEach(function (nom) {
      var id = table[nom];
      if (nomsRegistre[nom] === undefined) {
        if (retires[id] !== undefined) out.push(prefixe + nom + ' réutilise l\'id ' + id + ', retiré (ancien ' + prefixe + retires[id] + ')');
        else if (section[id] !== undefined) out.push('l\'id ' + id + ' a changé de nom : ' + prefixe + section[id] + ' → ' + prefixe + nom);
        else out.push(prefixe + nom + ' (id ' + id + ') n\'est pas déclaré : ajouter la ligne "' + id + '": "' + nom + '" au registre');
      } else if (nomsRegistre[nom] !== id) {
        out.push(prefixe + nom + ' a changé d\'id : ' + nomsRegistre[nom] + ' au registre, ' + id + ' dans le code');
      }
    });
    // un id du registre : toujours présent sous ce nom, ou marqué « retiré »
    Object.keys(section).forEach(function (idTexte) {
      var nom = section[idTexte];
      if (table[nom] === undefined && parId[+idTexte] === undefined) {
        out.push('l\'id ' + idTexte + ' (' + prefixe + nom + ') a disparu sans être marqué « retiré »');
      }
      if (retires[idTexte] !== undefined) out.push('l\'id ' + idTexte + ' est à la fois actif et retiré');
    });
    return out;
  }
  /* Prochain id libre DANS une plage (MC.Core.PLAGES_IDS, SPEC-SAVE-020) :
     ni actif ni retiré au registre ; null si la plage est pleine. C'est le
     seul rôle qui reste à un « auto-incrément » : proposer, jamais attribuer. */
  function prochainLibre(section, retires, plage) {
    for (var id = plage.premier; id <= plage.dernier; id++) {
      if (section[id] === undefined && retires[id] === undefined) return id;
    }
    return null;
  }
  // « nom-de-plage : id » pour chaque plage ouverte d'un genre (les plages réservées n'en proposent pas)
  function suggestions(section, retires, genre) {
    return (C.PLAGES_IDS || []).filter(function (p) { return p.genre === genre && !p.reservee; })
      .map(function (p) { return p.nom + ' → ' + prochainLibre(section, retires, p); }).join(', ');
  }

  describe('Specs — SPEC-SAVE-019 : identifiants figés (tests/donnees/ids.json)', function () {

    it('SPEC-SAVE-019 : le registre se charge et porte une version', function () {
      var R = registre();
      A.ok(R && typeof R.version === 'number', 'champ « version » numérique');
      A.ok(R.blocs && R.objets, 'sections blocs et objets');
      A.ok(R.retires && R.retires.blocs && R.retires.objets, 'sections des retraits');
    });

    it('SPEC-SAVE-019 : chaque id de bloc B.* est celui du registre, et réciproquement', function () {
      var R = registre();
      var e = ecarts(C.B, R.blocs, R.retires.blocs, 'B.');
      A.equal(e.length, 0, e.join(' ; ') + ' — prochain id de bloc libre par plage : ' + suggestions(R.blocs, R.retires.blocs, 'bloc'));
    });

    it('SPEC-SAVE-019 : chaque id d\'objet I.* est celui du registre, et réciproquement', function () {
      var R = registre();
      var e = ecarts(C.I, R.objets, R.retires.objets, 'I.');
      A.equal(e.length, 0, e.join(' ; ') + ' — prochain id d\'objet libre par plage : ' + suggestions(R.objets, R.retires.objets, 'objet'));
    });

    it('SPEC-SAVE-019 : caractérisation — le registre égale strictement les tables du code (mêmes tailles, mêmes paires)', function () {
      var R = registre();
      A.equal(Object.keys(R.blocs).length, Object.keys(C.B).length, 'autant de blocs (air compris) que de noms B.*');
      A.equal(Object.keys(R.objets).length, Object.keys(C.I).length, 'autant d\'objets que de noms I.*');
      Object.keys(R.blocs).forEach(function (id) { A.equal(C.B[R.blocs[id]], +id, 'B.' + R.blocs[id]); });
      Object.keys(R.objets).forEach(function (id) { A.equal(C.I[R.objets[id]], +id, 'I.' + R.objets[id]); });
      // chaque bloc et objet défini a un nom au registre
      C.BLOCKS.forEach(function (d, id) { if (d) A.ok(R.blocs[id] !== undefined, 'bloc défini ' + id + ' (' + d.name + ') au registre'); });
      C.ITEMS.forEach(function (d, id) { if (d) A.ok(R.objets[id] !== undefined, 'objet défini ' + id + ' (' + d.name + ') au registre'); });
    });

    it('SPEC-SAVE-019 : mutation — permuter deux escaliers, renommer, retirer ou réutiliser un id fait échouer la comparaison', function () {
      var R = registre();
      function copie(t) { var o = {}; Object.keys(t).forEach(function (k) { o[k] = t[k]; }); return o; }
      // permutation de deux escaliers dans la liste de core.js : leurs ids s'échangent
      var perm = copie(C.B);
      perm.ESCALIER_PLANKS = C.B.ESCALIER_SAPIN; perm.ESCALIER_SAPIN = C.B.ESCALIER_PLANKS;
      var e1 = ecarts(perm, R.blocs, R.retires.blocs, 'B.');
      A.equal(e1.length, 2, 'les deux escaliers permutés sont signalés : ' + e1.join(' ; '));
      A.ok(/ESCALIER_PLANKS/.test(e1.join(' ')) && /ESCALIER_SAPIN/.test(e1.join(' ')), 'et nommés');
      // un id existant change de nom
      var ren = copie(C.B); delete ren.MARBRE; ren.MARBRE_BLANC = C.B.MARBRE;
      A.ok(ecarts(ren, R.blocs, R.retires.blocs, 'B.').some(function (m) { return /changé de nom/.test(m); }), 'renommage détecté');
      // un id disparaît sans être marqué « retiré »
      var dis = copie(C.I); delete dis.BIJOU;
      A.ok(ecarts(dis, R.objets, R.retires.objets, 'I.').some(function (m) { return /disparu/.test(m); }), 'disparition détectée');
      // … mais marqué « retiré », il est accepté, et son id ne se réutilise plus
      var sectionSans = copie(R.objets); delete sectionSans[C.I.BIJOU];
      var retires = {}; retires[C.I.BIJOU] = 'BIJOU';
      A.equal(ecarts(dis, sectionSans, retires, 'I.').length, 0, 'un retrait déclaré passe');
      var reuse = copie(dis); reuse.NOUVEAU = C.I.BIJOU;
      A.ok(ecarts(reuse, sectionSans, retires, 'I.').some(function (m) { return /retiré/.test(m); }), 'réutilisation d\'un id retiré détectée');
      // un ajout sans ligne au registre est signalé avec la ligne à ajouter
      var ajout = copie(C.B); ajout.NOUVEAU_BLOC = 961;
      var e5 = ecarts(ajout, R.blocs, R.retires.blocs, 'B.');
      A.equal(e5.length, 1, 'un seul écart');
      A.ok(/"961": "NOUVEAU_BLOC"/.test(e5[0]), 'la ligne exacte à ajouter est proposée : ' + e5[0]);
    });

    it('SPEC-SAVE-019 : le prochain id libre se propose dans la plage de la famille, jamais dans une plage réservée', function () {
      var R = registre();
      function plage(nom) { return C.PLAGES_IDS.filter(function (p) { return p.nom === nom; })[0]; }
      A.equal(prochainLibre(R.blocs, R.retires.blocs, plage('formes-l24')), C.B.ESCALIER_POUTRE_JUNGLE + 1, 'formes : juste après le dernier escalier de matériau (SPEC-CONSTR-001)');
      A.equal(prochainLibre(R.blocs, R.retires.blocs, plage('flore-marine-l35')), C.B.CORAIL_BLANC + 1, 'flore marine : après le corail blanc');
      A.equal(prochainLibre(R.blocs, R.retires.blocs, plage('interieur')), C.B.SOCLE + 1, 'intérieur : après le socle');
      A.equal(prochainLibre(R.objets, R.retires.objets, plage('objets-l24')), C.I.BRIQUET + 1, 'objets L24 : après le briquet');
      A.equal(prochainLibre(R.blocs, R.retires.blocs, plage('blocs-origine')), null, 'plage d\'origine pleine (127 ids)');
      // un id retiré n'est jamais reproposé
      var ret = {}; ret[C.B.ESCALIER_POUTRE_JUNGLE + 1] = 'ANCIEN';
      A.equal(prochainLibre(R.blocs, ret, plage('formes-l24')), C.B.ESCALIER_POUTRE_JUNGLE + 2, 'l\'id retiré est sauté');
      var s = suggestions(R.blocs, R.retires.blocs, 'bloc');
      A.ok(new RegExp('formes-l24 → ' + (C.B.ESCALIER_POUTRE_JUNGLE + 1)).test(s) && /interieur → 961/.test(s), 'une suggestion par plage : ' + s);
      A.notOk(/reserve/.test(s), 'aucune suggestion dans la plage réservée aux anciens ids d\'objets');
    });
  });

  // ─── SPEC-SAVE-020 : plages d'identifiants déclarées ───────────────────────
  describe('Specs — SPEC-SAVE-020 : plages d\'identifiants (MC.Core.PLAGES_IDS)', function () {
    function plages() { return C.PLAGES_IDS || []; }
    function plagesDe(id) { return plages().filter(function (p) { return id >= p.premier && id <= p.dernier; }); }

    it('SPEC-SAVE-020 : chaque plage déclare nom, premier et dernier, du bon côté de FIRST_ITEM', function () {
      A.ok(Array.isArray(C.PLAGES_IDS) && C.PLAGES_IDS.length > 0, 'MC.Core.PLAGES_IDS est une liste non vide');
      var noms = {};
      plages().forEach(function (p) {
        A.ok(typeof p.nom === 'string' && p.nom.length > 0, 'nom de plage');
        A.notOk(noms[p.nom], 'nom unique : ' + p.nom);
        noms[p.nom] = true;
        A.ok(Number.isInteger(p.premier) && Number.isInteger(p.dernier), p.nom + ' : bornes entières');
        A.ok(p.premier >= 1 && p.premier <= p.dernier && p.dernier <= 65535, p.nom + ' : 1 ≤ premier ≤ dernier ≤ 65535');
        // une plage est entièrement de blocs (sous FIRST_ITEM) ou entièrement d'objets
        var deBlocs = p.dernier < C.FIRST_ITEM, dObjets = p.premier >= C.FIRST_ITEM;
        A.ok(deBlocs || dObjets, p.nom + ' ne chevauche pas FIRST_ITEM (' + p.premier + '..' + p.dernier + ')');
        A.equal(p.genre, deBlocs ? 'bloc' : 'objet', p.nom + ' : genre conforme à sa position');
      });
    });

    it('SPEC-SAVE-020 : les plages sont deux à deux disjointes', function () {
      var l = plages().slice().sort(function (a, b) { return a.premier - b.premier; });
      for (var i = 1; i < l.length; i++) {
        A.ok(l[i].premier > l[i - 1].dernier, l[i - 1].nom + ' (' + l[i - 1].premier + '..' + l[i - 1].dernier + ') et ' +
             l[i].nom + ' (' + l[i].premier + '..' + l[i].dernier + ') se chevauchent');
      }
    });

    it('SPEC-SAVE-020 : chaque bloc défini est sous FIRST_ITEM et dans exactement une plage de blocs', function () {
      var n = 0;
      C.BLOCKS.forEach(function (d, id) {
        if (!d) return;
        n++;
        A.ok(id >= 1 && id < C.FIRST_ITEM, d.name + ' (' + id + ') sous FIRST_ITEM');
        var p = plagesDe(id);
        A.equal(p.length, 1, d.name + ' (' + id + ') dans exactement une plage (' + p.map(function (x) { return x.nom; }).join(', ') + ')');
        if (p.length === 1) A.equal(p[0].genre, 'bloc', d.name + ' (' + id + ') dans une plage de blocs');
        if (p.length === 1) A.notOk(p[0].reservee, d.name + ' (' + id + ') hors d\'une plage réservée (' + p[0].nom + ')');
      });
      A.ok(n >= 255, 'balayage de tous les blocs (' + n + ')');
    });

    it('SPEC-SAVE-020 : 128-199, anciens ids d\'objets du format 8 bits, est une plage réservée', function () {
      var r = plages().filter(function (p) { return p.reservee; });
      A.equal(r.length, 1, 'une plage réservée');
      A.deep([r[0].premier, r[0].dernier, r[0].genre], [128, 199, 'bloc'], 'bornes 128-199, côté blocs');
      for (var id = 128; id <= 199; id++) A.notOk(C.BLOCKS[id], 'aucun bloc défini en ' + id);
      A.equal(C.ANCIEN_FIRST_ITEM, 128, 'elle commence à l\'ancienne frontière des objets');
    });

    it('SPEC-SAVE-020 : chaque objet défini est entre FIRST_ITEM et 65535, dans exactement une plage d\'objets', function () {
      var n = 0;
      C.ITEMS.forEach(function (d, id) {
        if (!d) return;
        n++;
        A.ok(id >= C.FIRST_ITEM && id <= 65535, d.name + ' (' + id + ') entre FIRST_ITEM et 65535');
        var p = plagesDe(id);
        A.equal(p.length, 1, d.name + ' (' + id + ') dans exactement une plage');
        if (p.length === 1) A.equal(p[0].genre, 'objet', d.name + ' (' + id + ') dans une plage d\'objets');
      });
      A.ok(n >= 177, 'balayage de tous les objets (' + n + ')');
    });
  });

  // ─── SPEC-SAVE-021 : état de bloc sur 8 bits, borné par `etatMax` ──────────
  /* Les producteurs d'état sont balayés sur tout leur domaine d'entrée, et
     chaque état produit est relevé TEL QUEL (aucun Math.min, contrairement à
     world.setEtat qui borne à 255) : un état au-delà de l'`etatMax` de son
     bloc fait échouer le test au lieu d'être tronqué en silence.
     Producteurs balayés : empaqueteurs de MC.Formes, MC.Circuits.tick,
     MC.Feu, génération des lieux (MC.Habitats : chaque bâtiment, chaque
     style, urbain ou non, chaque orientation, chaque variante — et chaque
     genre de lieu dans chaque style), pose d'une batterie (player.js).
     Mutations vérifiées à la main à l'écriture de ce test, toutes rouges :
     toit raide d'escaliers posé avec l'état 64 (habitats.js, `toit`), dalle de
     faîtage avec l'état 2, une pierre posée avec l'état 1 par un bâtisseur. */
  describe('Specs — SPEC-SAVE-021 : état de bloc borné par etatMax', function () {
    var B = C.B;

    function lireSource(rel) {
      if (typeof require === 'function') return require('fs').readFileSync(require('path').join(__dirname, '..', rel), 'utf8');
      var xhr = new G.XMLHttpRequest();
      xhr.open('GET', '../' + rel + '?t=' + Date.now(), false);
      xhr.send(null);
      if (xhr.status !== 200) throw new Error(rel + ' illisible (HTTP ' + xhr.status + ')');
      return xhr.responseText;
    }

    // relevé : id → plus grand état produit ; `depassements` : chaque état > etatMax
    function releve() {
      var r = { max: {}, depassements: [] };
      r.noter = function (id, etat, origine) {
        if (!(id in r.max) || etat > r.max[id]) r.max[id] = etat;
        var lim = C.etatMaxDe(id);
        if (!(Number.isInteger(etat) && etat >= 0 && etat <= lim)) {
          if (r.depassements.length < 20) r.depassements.push(C.nameOf(id) + ' (' + id + ') : état ' + etat + ' > etatMax ' + lim + ' (' + origine + ')');
          else r.depassements.length++;
        }
      };
      return r;
    }
    function idsOu(pred) { var l = []; C.BLOCKS.forEach(function (d, id) { if (d && pred(d)) l.push(id); }); return l; }
    var memo = {};
    function une(nom, f) { return function () { if (!memo[nom]) { var r = releve(); f(r); memo[nom] = r; } return memo[nom]; }; }

    /* Liste EXPLICITE, écrite ici sans rien lire de core.js : le bloc (nom de
       clé B.*) → l'etatMax attendu. Tout bloc absent de cette liste doit avoir
       etatMax 0. Un bloc à état ajouté au jeu sans y être inscrit, ou une
       borne changée sans la changer ici, fait échouer le test. */
    function attendus() {
      var a = {};
      Object.keys(B).forEach(function (nom) {
        if (/^ESCALIER_/.test(nom)) a[nom] = 63;        // orientation 2 bits, inversion 1, angle 3 (tout le domaine de packEscalier)
        else if (/^DALLE_/.test(nom)) a[nom] = 1;       // moitié haute
      });
      ['LIT', 'TABLE', 'CHAISE', 'ARMOIRE', 'ETAGERE', 'BIBLIOTHEQUE', 'TAPIS', 'LAMPE', 'VASE', 'PRESENTOIR', 'SOCLE']
        .forEach(function (n) { a[n] = 7; });           // orientation 2 bits, variante 1
      ['N', 'E', 'S', 'O'].forEach(function (m) { a['PORTE_FERMEE_' + m] = 1; a['PORTE_OUVERTE_' + m] = 1; });
      a.TRAPPE_FERMEE = 1; a.TRAPPE_OUVERTE = 1;        // dernier signal vu (SPEC-MECA-006)
      a.FEU = 29;                                       // âge < MC.Feu.AGE_MAX (30)
      var circuits = {
        FIL_SIGNAL: 14, CABLE_ENERGIE: 14, LEVIER_CIRCUIT: 1, BOUTON_CIRCUIT: 1, PLAQUE_PRESSION: 1,
        REPETEUR_CIRCUIT: 3,                            // 1 | (délai 1 << 1)
        PORTE_NON: 1, PORTE_ET: 1, PORTE_OU: 1, PORTE_XOR: 1, PORTE_NAND: 1, PORTE_NOR: 1, PORTE_XNOR: 1,
        BASCULE_CIRCUIT: 3, COMPTEUR_CIRCUIT: 31, COMPARATEUR_CIRCUIT: 1,
        LAMPE_ETEINTE: 0, LAMPE_ALLUMEE: 0, ASCENSEUR: 1, ALARME: 1,
        TAPIS_ROULANT: 7,                               // en marche 1 bit | orientation 2 bits (SPEC-MECA-006)
        DETECTEUR_PRESENCE: 1, DETECTEUR_LUMIERE: 1, DETECTEUR_JOURNUIT: 1, DETECTEUR_METEO: 1,
        HORLOGE_CIRCUIT: 1, DETECTEUR_EAU: 1,
        EOLIENNE: 15, ROUE_HYDRAULIQUE: 15, GENERATEUR_THERMIQUE: 15,
        BATTERIE: 255,                                  // niveau 0..255 (SPEC-MECA-003)
        DISTRIBUTEUR: 1, PISTON: 15, PISTON_COLLANT: 15, TETE_PISTON: 0, BLOC_COMMANDE: 1,
      };
      Object.keys(circuits).forEach(function (n) { a[n] = circuits[n]; });
      return a;
    }
    // blocs dont l'état est LU mais qu'aucun producteur n'écrit encore — plus aucun depuis
    // SPEC-MECA-005 (levier, bouton et plaque prennent leur état de ctx.detecteurs)
    var LUS_NON_PRODUITS = {};

    // ── producteurs ──────────────────────────────────────────────────────────
    var balayerFormes = une('formes', function (r) {
      var F = MC.Formes;
      idsOu(function (d) { return d.forme === 'escalier'; }).forEach(function (id) {
        for (var o = 0; o < 8; o++) for (var inv = 0; inv < 2; inv++) for (var f = 0; f < 8; f++) {
          r.noter(id, F.packEscalier(o, !!inv, f), 'packEscalier(' + o + ', ' + !!inv + ', ' + f + ')');
        }
        [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }].forEach(function (dir) {
          r.noter(id, F.orientationPose(dir, false), 'orientationPose');
          r.noter(id, F.orientationPose(dir, true), 'orientationPose sous plafond');
        });
      });
      idsOu(function (d) { return d.forme === 'dalle'; }).forEach(function (id) {
        r.noter(id, F.packDalle(false), 'packDalle(bas)'); r.noter(id, F.packDalle(true), 'packDalle(haut)');
      });
      idsOu(function (d) { return d.forme === 'meuble'; }).forEach(function (id) {
        for (var o = 0; o < 8; o++) { r.noter(id, F.packMeuble(o, false), 'packMeuble'); r.noter(id, F.packMeuble(o, true), 'packMeuble variante'); }
      });
    });

    var balayerCircuits = une('circuits', function (r) {
      var Ci = MC.Circuits;
      var cibles = idsOu(function (d) { return !!(d.circuit || d.porte || d.trappe); });
      r.cibles = cibles.length;
      var VOIS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      var X = 0, Y = 64, Z = 0, CLE = X + ',' + Y + ',' + Z;
      var detect = {}; detect[CLE] = { actionne: true, appuye: true, presents: 1, proches: 1, niveau: 15, nuit: true, pluie: true, temps: 0, niveauEau: 3 };
      var rien = function () {};
      var CTX = [{ energieDisponible: false }, { energieDisponible: true }, { vent: { x: 0, z: 0 } }, { vent: { x: 9, z: 9 } },
                 { niveauEau: 0 }, { niveauEau: 7 }, { niveauEau: 99 }, { laveProche: true }, { laveProche: false, combustible: 3 },
                 { demandeBatterie: 3 }, { demandeBatterie: 99 }, { detecteurs: detect }, { onDistribuer: rien, onCommande: rien }];
      // voisinage : chaque voisin allumé (masque) est un levier (force 15), un fil faible (force 1) ou moyen (7),
      // une batterie chargée (énergie, pour les câbles), ou une éolienne lancée (production, qui recharge une batterie)
      var VARIANTES = [[B.LEVIER_CIRCUIT, 1], [B.FIL_SIGNAL, 1], [B.FIL_SIGNAL, 7], [B.BATTERIE, 15], [B.EOLIENNE, 15]];
      r.ticks = 0;
      function jouer(id, etat, masque, variante, ctx) {
        var blocs = new Map(), etats = new Map();
        blocs.set(CLE, id); etats.set(CLE, etat);
        VOIS.forEach(function (v, i) {
          if (!(masque & (1 << i))) return;
          var k = (X + v[0]) + ',' + (Y + v[1]) + ',' + (Z + v[2]);
          blocs.set(k, variante[0]); etats.set(k, variante[1]);
        });
        var api = {
          getBlock: function (x, y, z) { return blocs.get(x + ',' + y + ',' + z) || 0; },
          getEtat: function (x, y, z) { return etats.get(x + ',' + y + ',' + z) || 0; },
          setBlock: function (x, y, z, b) { blocs.set(x + ',' + y + ',' + z, b); etats.set(x + ',' + y + ',' + z, 0); },
          // l'état est relevé brut, pour le bloc présent APRÈS les setBlock du même tic (porte basculée, lampe…)
          setEtat: function (x, y, z, e) { r.noter(api.getBlock(x, y, z), e, C.nameOf(id) + ' état ' + etat + ', voisins ' + masque); etats.set(x + ',' + y + ',' + z, e); },
        };
        /* `vent` toujours fourni : sans lui, tick appelle MC.Meteo.ventEn, qui
           n'existe pas (ventEn est une méthode d'une météo créée, pas du
           module) — défaut hors de cette fiche, signalé à part. */
        var c = { vent: { x: 1, z: 0 } };
        Object.keys(ctx).forEach(function (k) { c[k] = ctx[k]; });
        Ci.tick([[X, Y, Z, id]], api, c);
        r.ticks++;
      }
      var UNITAIRES = [0, 1, 2, 4, 8, 16, 32, 63];
      cibles.forEach(function (id) {
        for (var etat = 0; etat <= C.etatMaxDe(id); etat++) {
          for (var m = 0; m < 64; m++) VARIANTES.forEach(function (v) { jouer(id, etat, m, v, {}); });
          UNITAIRES.forEach(function (m2) { CTX.forEach(function (ctx) { jouer(id, etat, m2, VARIANTES[0], ctx); }); });
        }
      });
    });

    var balayerFeu = une('feu', function (r) {
      var Fe = MC.Feu;
      var VOIS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      // tout âge d'entrée possible sur un octet : le feu n'en produit jamais au-delà de sa borne
      for (var age = 0; age <= 255; age++) {
        [0, B.PLANKS].forEach(function (autour) {
          [0, B.STONE, B.PLANKS].forEach(function (dessous) {
            [false, true].forEach(function (pluie) {
              var lire = function (x, y, z) {
                if (x === 0 && y === 64 && z === 0) return B.FEU;
                if (x === 0 && y === 63 && z === 0) return dessous;
                return VOIS.some(function (v) { return v[0] === x && v[1] === y - 64 && v[2] === z; }) ? autour : 0;
              };
              Fe.etapeFeu(lire, function () { return age; }, 0, 64, 0, function () { return 0; }, pluie).forEach(function (c) {
                r.noter(c[3], c[4], 'etapeFeu âge ' + age);
              });
            });
          });
        });
      }
      Fe.allumerParLave(function (x, y, z) { return (x === 1 && y === 64 && z === 0) ? B.LAVA : B.PLANKS; }, 0, 64, 0, function () { return 0; })
        .forEach(function (c) { r.noter(c[3], c[4], 'allumerParLave'); });
    });

    var TYPES_BATIMENTS = [['maison'], ['point_info'], ['banque'], ['salon'], ['magasin'],
      ['artisan', 'forgeron'], ['artisan', 'menuisier'], ['artisan', 'tisserand'], ['marche'], ['ferme'],
      ['loisirs', 'parc'], ['loisirs', 'fontaine'], ['loisirs', 'theatre'], ['place'], ['tour'], ['immeuble']];
    var balayerLieux = une('lieux', function (r) {
      var w = MC.createWorld(20260921), H = MC.Habitats;
      var styles = Object.keys(H.STYLES);
      r.batiments = 0; r.lieux = 0; r.etats = 0; r.styles = styles.length;
      function scanner(l, origine) {
        l.blocs.forEach(function (a) {
          for (var i = 0; i < a.length; i += 5) { if (a[i + 4]) r.etats++; r.noter(a[i + 3], a[i + 4], origine); }
        });
      }
      // chaque bâtiment, chaque style (campagne et ville), chaque orientation ; quatre
      // parcelles par cas pour couvrir les plans et étages tirés au hasard (carrée, longère, en L…)
      styles.forEach(function (s) {
        [false, true].forEach(function (urbain) {
          TYPES_BATIMENTS.forEach(function (ty) {
            for (var rot = 0; rot < 4; rot++) [0, 37, 71, 113].forEach(function (ox) {
              var L = (ty[0] === 'tour' || ty[0] === 'immeuble') ? 30 : 12;
              scanner(w.habitats.batirBatimentPourEssai(ty[0], s, urbain, rot, ty[1], ox, ox * 3 + 5, L),
                      ty.join('/') + ' ' + s + (urbain ? ' urbain' : '') + ' rot ' + rot);
              r.batiments++;
            });
          });
        });
      });
      // chaque genre de lieu (rues, places, lampadaires, ports) dans chaque style
      ['ville', 'village', 'maison'].forEach(function (k) {
        styles.forEach(function (s) {
          [false, true].forEach(function (urbain) {
            [[0, 0], [1, -1]].forEach(function (rr) { scanner(w.habitats.batirPourEssai(k, s, urbain, rr[0], rr[1]), k + ' ' + s); r.lieux++; });
          });
        });
      });
      scanner(w.habitats.batirPourEssai('megapole', 'plaines', true, 0, 0), 'mégapole'); r.lieux++;
      // et des lieux réellement générés par le monde, puis leur pose dans les chunks
      // (`appliquer` : plateforme nivelée, sous-sol, surface, puis les blocs du lieu)
      var chunks = {};
      [['ville', 2], ['village', 4], ['maison', 6]].forEach(function (k) {
        for (var rx = -k[1]; rx < k[1]; rx++) for (var rz = -k[1]; rz < k[1]; rz++) {
          var l = w.habitats.lieuDeRegion(k[0], rx, rz);
          if (!l) continue;
          scanner(l, l.nom); r.lieux++;
          if (k[0] === 'ville') continue;              // une ville couvre des centaines de chunks : ses blocs sont déjà relevés
          var p = l.plateforme;
          for (var cx = Math.floor(p.x0 / C.CHUNK_X); cx <= Math.floor(p.x1 / C.CHUNK_X); cx++) {
            for (var cz = Math.floor(p.z0 / C.CHUNK_Z); cz <= Math.floor(p.z1 / C.CHUNK_Z); cz++) chunks[cx + ',' + cz] = [cx, cz];
          }
        }
      });
      r.chunks = 0;
      Object.keys(chunks).forEach(function (k) {
        var c = chunks[k];
        w.habitats.appliquer(c[0], c[1], function (x, y, z, id, etat) { r.noter(id, etat === undefined ? 0 : etat, 'appliquer ' + k); });
        r.chunks++;
      });
    });

    var balayerPoseBatterie = une('pose', function (r) {
      [0, 9, 255, 256, 900, -3, 'x', 7.6, undefined].forEach(function (niveau) {
        var w = G.flatWorld(9, B.STONE), ents = MC.createEntities(w), pl = MC.createPlayer(w, ents);
        pl.state.pos = { x: 3.5, y: 20, z: 3.5 }; pl.state.onGround = true;
        pl.state.inv.setAt(0, { id: B.BATTERIE, n: 1, data: niveau === undefined ? undefined : { niveau: niveau } });
        pl.state.selected = 0;
        var res = pl.useOn({ x: 5, y: 9, z: 5, block: B.STONE, nx: 0, ny: 1, nz: 0, t: 1 });
        r.poses = (r.poses || []).concat([[niveau, res, w.getBlock(5, 10, 5), w.getEtat(5, 10, 5)]]);
        r.noter(w.getBlock(5, 10, 5), w.getEtat(5, 10, 5), 'pose d\'une batterie de niveau ' + niveau);
      });
    });

    function toutBalayer() {
      return [balayerFormes(), balayerCircuits(), balayerFeu(), balayerLieux(), balayerPoseBatterie()];
    }

    // ── tests ────────────────────────────────────────────────────────────────
    it('SPEC-SAVE-021 : chaque bloc déclare un etatMax entier entre 0 et 255', function () {
      A.equal(typeof C.etatMaxDe, 'function', 'MC.Core.etatMaxDe');
      // alias documenté (même fonction ; le harnais enveloppe chaque export pour l'observer, d'où une comparaison par valeurs)
      [0, B.STONE, B.ESCALIER_PLANKS, B.BATTERIE, B.FEU, C.FIRST_ITEM].forEach(function (id) {
        A.equal(C.etatMax(id), C.etatMaxDe(id), 'MC.Core.etatMax(' + id + ') = etatMaxDe');
      });
      var n = 0;
      C.BLOCKS.forEach(function (d, id) {
        if (!d) return;
        n++;
        A.ok(Number.isInteger(d.etatMax) && d.etatMax >= 0 && d.etatMax <= 255, d.name + ' (' + id + ') : etatMax ' + d.etatMax);
        A.equal(C.etatMaxDe(id), d.etatMax, d.name + ' : etatMaxDe');
      });
      A.ok(n >= 255, 'tous les blocs (' + n + ')');
      A.equal(C.etatMaxDe(0), 0, 'l\'air n\'a pas d\'état');
      A.equal(C.etatMaxDe(C.FIRST_ITEM + 5), 0, 'un objet n\'a pas d\'état de bloc');
      A.equal(C.etatMaxDe(4000), 0, 'un id indéfini non plus');
    });

    it('SPEC-SAVE-021 : un bloc sans état a etatMax 0 — liste explicite des blocs à état, tout le reste à 0', function () {
      var a = attendus(), n0 = 0;
      Object.keys(a).forEach(function (nom) { A.ok(B[nom] !== undefined && C.BLOCKS[B[nom]], 'bloc à état attendu présent : B.' + nom); });
      C.BLOCKS.forEach(function (d, id) {
        if (!d) return;
        var nom = Object.keys(B).filter(function (k) { return B[k] === id; })[0];
        var attendu = a[nom] === undefined ? 0 : a[nom];
        if (!attendu) n0++;
        A.equal(C.etatMaxDe(id), attendu, 'B.' + nom + ' (' + id + ')' + (a[nom] === undefined ? ' : sans état, absent de la liste' : ''));
      });
      A.gt(n0, 150, 'la plupart des blocs n\'ont pas d\'état (' + n0 + ')');
      A.equal(C.etatMaxDe(B.FEU), MC.Feu.AGE_MAX - 1, 'feu : âge maximal stocké = AGE_MAX − 1');
      // le relevé lui-même refuse un état sur un bloc sans état, et un état au-delà de la borne
      var r = releve();
      r.noter(B.STONE, 1, 'essai');
      r.noter(B.ESCALIER_STONE, 64, 'essai');
      r.noter(B.REPETEUR_CIRCUIT, 4, 'essai');
      A.equal(r.depassements.length, 3, 'trois dépassements signalés, aucun tronqué : ' + r.depassements.join(' ; '));
    });

    it('SPEC-SAVE-021 : chaque bloc à état est réellement atteint par un producteur (borne ni oubliée ni de complaisance)', function () {
      var vus = {};
      toutBalayer().forEach(function (r) {
        A.equal(r.depassements.length, 0, r.depassements.join(' ; '));
        Object.keys(r.max).forEach(function (id) { vus[id] = Math.max(vus[id] || 0, r.max[id]); });
      });
      Object.keys(attendus()).forEach(function (nom) {
        var id = B[nom], lim = C.etatMaxDe(id);
        if (!lim) return;
        if (LUS_NON_PRODUITS[nom]) { A.notOk(vus[id], 'B.' + nom + ' : aucun producteur encore (SPEC-MECA-005)'); return; }
        /* porte ou trappe : le circuit écrit le bit 0 sur l'id OUVERT qu'il vient de
           basculer ; l'id fermé ne le garde que si le joueur referme à la main
           sous signal — on compte donc la paire (même mur) */
        var vu = vus[id] || 0;
        if (C.estPorte(id) || C.estTrappe(id)) vu = Math.max(vu, vus[C.bascule(id)] || 0);
        A.equal(vu, lim, 'B.' + nom + ' : la borne ' + lim + ' est atteinte par un producteur (vu ' + vu + ')');
      });
    });

    it('SPEC-SAVE-021 : empaqueteurs de MC.Formes — balayage exhaustif de leurs entrées', function () {
      var r = balayerFormes();
      A.equal(r.depassements.length, 0, r.depassements.join(' ; '));
      A.equal(r.max[B.ESCALIER_PLANKS], 63, 'un escalier utilise 6 bits (orientation 2, inversion 1, angle 3)');
      A.equal(r.max[B.DALLE_STONE], 1, 'une dalle, 1 bit');
      A.equal(r.max[B.LIT], 7, 'un meuble, 3 bits');
    });

    it('SPEC-SAVE-021 : transitions de MC.Circuits — toutes les sorties pour chaque bloc concerné', function () {
      var r = balayerCircuits();
      A.gt(r.cibles, 40, 'blocs de circuit, portes et trappes (' + r.cibles + ')');
      A.gt(r.ticks, 5000, 'balayage effectif (' + r.ticks + ' tics)');
      A.equal(r.depassements.length, 0, r.depassements.join(' ; '));
      A.equal(r.max[B.COMPTEUR_CIRCUIT], 31, 'compteur : 4 bits de valeur + 1 bit d\'entrée précédente');
      A.equal(r.max[B.BATTERIE], 255, 'batterie : niveau 0..255 (MC.Circuits.CAPACITE_BATTERIE, SPEC-MECA-003)');
      A.equal(r.max[B.PISTON], 15, 'piston : orientation 3 bits (6 et 7 laissées passer par tick) + sorti 1 bit');
      A.equal(r.max[B.REPETEUR_CIRCUIT], 3, 'répéteur : 1 | (délai 1 << 1)');
      A.ok(r.max[B.PORTE_FERMEE_N] === 1 || r.max[B.PORTE_OUVERTE_N] === 1, 'porte : le bit 0 mémorise le dernier signal');
    });

    it('SPEC-SAVE-021 : le feu ne dépasse jamais l\'âge 29 (AGE_MAX − 1)', function () {
      var r = balayerFeu();
      A.equal(r.depassements.length, 0, r.depassements.join(' ; '));
      A.equal(r.max[B.FEU], MC.Feu.AGE_MAX - 1, 'âge maximal produit');
    });

    it('SPEC-SAVE-021 : génération — chaque bâtiment, style, orientation et genre de lieu reste sous etatMax', function () {
      var r = balayerLieux();
      A.gt(r.styles, 10, 'tous les styles (' + r.styles + ')');
      A.gt(r.batiments, 1000, 'bâtiments balayés (' + r.batiments + ')');
      A.gt(r.lieux, 60, 'lieux balayés (' + r.lieux + ')');
      A.gt(r.etats, 1000, 'blocs à état posés (' + r.etats + ')');
      A.gt(r.chunks, 5, 'chunks où les lieux sont appliqués (' + r.chunks + ')');
      A.equal(r.depassements.length, 0, r.depassements.join(' ; '));
      // toits raides et pignons, dalles de faîtage et meubles sont bien passés par le relevé
      A.ok(r.max[B.ESCALIER_SAPIN] > 0 && r.max[B.ESCALIER_ARDOISE] > 0, 'escaliers de toiture (raide : sapin, ardoise)');
      A.equal(r.max[B.DALLE_SAPIN], 1, 'dalle de faîtage haute');
      A.ok(r.max[B.LIT] > 0, 'meubles orientés');
      // garde statique : tout état passé à pose() ou put() par habitats.js vient d'un
      // empaqueteur de MC.Formes (ou n'est que l'état déjà rangé dans l.blocs, relu par appliquer)
      var src = lireSource('src/habitats.js'), suspects = [];
      var re = /\b(?:o\.pose|put)\(/g, m;
      while ((m = re.exec(src))) {
        var i = m.index + m[0].length, prof = 1, args = [''];
        while (i < src.length && prof > 0) {
          var ch = src[i++];
          if (ch === '(' || ch === '[' || ch === '{') prof++;
          else if (ch === ')' || ch === ']' || ch === '}') prof--;
          if (prof === 0) break;
          if (ch === ',' && prof === 1) args.push(''); else args[args.length - 1] += ch;
        }
        if (args.length >= 5) {
          var e = args[4].trim();
          if (!/^(Fo|MC\.Formes)\.pack(Escalier|Dalle|Meuble)\(/.test(e) && e !== 'etat' && e !== 'a[i + 4]') suspects.push('l.' + (src.slice(0, m.index).split('\n').length) + ' : ' + e);
        }
      }
      A.deep(suspects, [], 'habitats.js ne pose aucun état hors des empaqueteurs');
    });

    it('SPEC-SAVE-021 : une batterie posée reprend son niveau, borné à son etatMax', function () {
      var r = balayerPoseBatterie();
      A.equal(r.depassements.length, 0, r.depassements.join(' ; '));
      var parNiveau = {};
      r.poses.forEach(function (p) { A.equal(p[1], 'place', 'posée (niveau ' + p[0] + ')'); A.equal(p[2], B.BATTERIE, 'c\'est une batterie'); parNiveau[String(p[0])] = p[3]; });
      A.equal(parNiveau['9'], 9, 'niveau 9 conservé');
      A.equal(parNiveau['255'], 255, 'niveau plein (capacité, SPEC-MECA-003) conservé');
      A.equal(parNiveau['256'], 255, 'niveau 256 ramené à 255');
      A.equal(parNiveau['900'], 255, 'niveau 900 ramené à 255 (et non tronqué à l\'octet)');
      A.equal(parNiveau['-3'], 0, 'niveau négatif ramené à 0');
      A.equal(parNiveau.x, 0, 'niveau illisible : 0');
      A.equal(parNiveau['7.6'], 7, 'niveau non entier : partie entière');
      A.equal(parNiveau.undefined, 0, 'batterie neuve : 0');
    });

    it('SPEC-SAVE-021 : portes et trappes gardent leurs identifiants distincts par orientation et ouverture', function () {
      var portes = idsOu(function (d) { return !!d.porte; }), trappes = idsOu(function (d) { return !!d.trappe; });
      A.equal(portes.length, 8, 'huit ids de porte (4 murs × fermée/ouverte)');
      A.equal(trappes.length, 2, 'deux ids de trappe (fermée/ouverte)');
      var vus = {};
      portes.forEach(function (id) { var p = C.BLOCKS[id].porte; vus[p.wall + (p.ouverte ? 'o' : 'f')] = id; });
      A.equal(Object.keys(vus).length, 8, 'chaque (mur, ouverture) a son propre id');
      portes.concat(trappes).forEach(function (id) {
        A.notEqual(C.bascule(id), id, C.nameOf(id) + ' : ouvrir/fermer change d\'id');
        A.equal(C.bascule(C.bascule(id)), id, C.nameOf(id) + ' : aller-retour');
        // orientation et ouverture ne sont jamais lues dans l'état : la boîte ne dépend que de l'id
        A.deep(C.boiteDe(id, C.etatMaxDe(id)), C.boiteDe(id, 0), C.nameOf(id) + ' : même boîte quel que soit l\'état');
        // seul le bit 0 (dernier signal vu par les circuits, SPEC-MECA-006) est un état
        A.equal(C.etatMaxDe(id), 1, C.nameOf(id) + ' : etatMax 1');
      });
      A.deep([B.PORTE_FERMEE_N, B.PORTE_OUVERTE_O, B.TRAPPE_FERMEE, B.TRAPPE_OUVERTE], [109, 116, 117, 118], 'ids inchangés');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
