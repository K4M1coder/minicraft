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
  function prochainLibre(section, retires, premier) {
    var id = premier;
    while (section[id] !== undefined || retires[id] !== undefined) id++;
    return id;
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
      A.equal(e.length, 0, e.join(' ; ') + ' — prochain id de bloc libre suggéré au-delà de 960 : ' + prochainLibre(R.blocs, R.retires.blocs, 961));
    });

    it('SPEC-SAVE-019 : chaque id d\'objet I.* est celui du registre, et réciproquement', function () {
      var R = registre();
      var e = ecarts(C.I, R.objets, R.retires.objets, 'I.');
      A.equal(e.length, 0, e.join(' ; ') + ' — prochain id d\'objet libre suggéré : ' + prochainLibre(R.objets, R.retires.objets, C.FIRST_ITEM));
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
      });
      A.ok(n >= 255, 'balayage de tous les blocs (' + n + ')');
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
     bloc fait échouer le test au lieu d'être tronqué en silence. */
  describe('Specs — SPEC-SAVE-021 : état de bloc borné par etatMax', function () {
    var B = C.B;
    var FAMILLES_FORME = { escalier: true, dalle: true, meuble: true };

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
    function aUnEtat(d) {
      return !!((d.forme && FAMILLES_FORME[d.forme]) || d.porte || d.trappe || d.circuit || d.id === B.FEU);
    }

    it('SPEC-SAVE-021 : chaque bloc déclare un etatMax entier entre 0 et 255', function () {
      A.equal(typeof C.etatMaxDe, 'function', 'MC.Core.etatMaxDe');
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

    it('SPEC-SAVE-021 : un bloc sans état a etatMax 0', function () {
      var sansEtat = idsOu(function (d) { return !aUnEtat(d); });
      A.gt(sansEtat.length, 150, 'la plupart des blocs n\'ont pas d\'état');
      sansEtat.forEach(function (id) { A.equal(C.etatMaxDe(id), 0, C.nameOf(id) + ' (' + id + ') sans état'); });
      // pierre, herbe, eau courante, clôture, muret, vitre, rambarde : aucun état stocké
      [B.STONE, B.GRASS, B.EAU_3, B.CLOTURE, B.MURET, B.VITRE, B.RAMBARDE, B.LAMPE_ALLUMEE, B.TETE_PISTON].forEach(function (id) {
        A.equal(C.etatMaxDe(id), 0, C.nameOf(id));
      });
      // le relevé lui-même refuse un état sur un bloc sans état, et un état au-delà de la borne
      var r = releve();
      r.noter(B.STONE, 1, 'essai');
      r.noter(B.ESCALIER_STONE, C.etatMaxDe(B.ESCALIER_STONE) + 1, 'essai');
      r.noter(B.REPETEUR_CIRCUIT, 256, 'essai');
      A.equal(r.depassements.length, 3, 'trois dépassements signalés, aucun tronqué : ' + r.depassements.join(' ; '));
    });

    it('SPEC-SAVE-021 : empaqueteurs de MC.Formes — balayage exhaustif de leurs entrées', function () {
      var F = MC.Formes, r = releve();
      var escaliers = idsOu(function (d) { return d.forme === 'escalier'; });
      var dalles = idsOu(function (d) { return d.forme === 'dalle'; });
      var meubles = idsOu(function (d) { return d.forme === 'meuble'; });
      A.ok(escaliers.length >= 16 && dalles.length >= 10 && meubles.length >= 11, 'familles présentes');
      escaliers.forEach(function (id) {
        for (var o = 0; o < 8; o++) for (var inv = 0; inv < 2; inv++) for (var f = 0; f < 8; f++) {
          r.noter(id, F.packEscalier(o, !!inv, f), 'packEscalier(' + o + ', ' + !!inv + ', ' + f + ')');
        }
        [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }].forEach(function (dir) {
          r.noter(id, F.orientationPose(dir, false), 'orientationPose');
          r.noter(id, F.orientationPose(dir, true), 'orientationPose sous plafond');
        });
      });
      dalles.forEach(function (id) { r.noter(id, F.packDalle(false), 'packDalle(bas)'); r.noter(id, F.packDalle(true), 'packDalle(haut)'); });
      meubles.forEach(function (id) {
        for (var o = 0; o < 8; o++) { r.noter(id, F.packMeuble(o, false), 'packMeuble'); r.noter(id, F.packMeuble(o, true), 'packMeuble variante'); }
      });
      A.equal(r.depassements.length, 0, r.depassements.join(' ; '));
      A.equal(r.max[B.ESCALIER_PLANKS], 63, 'un escalier utilise 6 bits (orientation 2, inversion 1, angle 3)');
      A.equal(r.max[B.DALLE_STONE], 1, 'une dalle, 1 bit');
      A.equal(r.max[B.LIT], 7, 'un meuble, 3 bits');
    });

    it('SPEC-SAVE-021 : transitions de MC.Circuits — toutes les sorties pour chaque bloc concerné', function () {
      var Ci = MC.Circuits, r = releve();
      var cibles = idsOu(function (d) { return !!(d.circuit || d.porte || d.trappe); });
      A.gt(cibles.length, 40, 'blocs de circuit, portes et trappes (' + cibles.length + ')');
      var VOIS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      var X = 0, Y = 64, Z = 0, CLE = X + ',' + Y + ',' + Z;
      var detect = {}; detect[CLE] = { actionne: true, appuye: true, presents: 1, proches: 1, niveau: 15, nuit: true, pluie: true, temps: 0, niveauEau: 3 };
      var rien = function () {};
      var CTX = [{ energieDisponible: false }, { energieDisponible: true }, { vent: { x: 0, z: 0 } }, { vent: { x: 9, z: 9 } },
                 { niveauEau: 0 }, { niveauEau: 7 }, { niveauEau: 99 }, { laveProche: true }, { laveProche: false, combustible: 3 },
                 { demandeBatterie: 3 }, { demandeBatterie: 99 }, { detecteurs: detect }, { onDistribuer: rien, onCommande: rien }];
      // voisinage : chaque voisin allumé (masque) est un levier (force 15), un fil faible (force 1) ou moyen (7)
      var VARIANTES = [[B.LEVIER_CIRCUIT, 1], [B.FIL_SIGNAL, 1], [B.FIL_SIGNAL, 7]];
      var ticks = 0;
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
        ticks++;
      }
      var UNITAIRES = [0, 1, 2, 4, 8, 16, 32, 63];
      cibles.forEach(function (id) {
        for (var etat = 0; etat <= C.etatMaxDe(id); etat++) {
          for (var m = 0; m < 64; m++) VARIANTES.forEach(function (v) { jouer(id, etat, m, v, {}); });
          UNITAIRES.forEach(function (m2) { CTX.forEach(function (ctx) { jouer(id, etat, m2, VARIANTES[0], ctx); }); });
        }
      });
      A.equal(r.depassements.length, 0, r.depassements.join(' ; '));
      A.gt(ticks, 10000, 'balayage effectif (' + ticks + ' tics)');
      // le relevé a bien vu les états pleins des familles qui en ont
      A.equal(r.max[B.COMPTEUR_CIRCUIT], 31, 'compteur : 4 bits de valeur + 1 bit d\'entrée précédente');
      A.equal(r.max[B.BATTERIE], 15, 'batterie : niveau 0..15');
      A.equal(r.max[B.PISTON], 15, 'piston : orientation 3 bits + sorti 1 bit');
      A.ok(r.max[B.PORTE_FERMEE_N] === 1 || r.max[B.PORTE_OUVERTE_N] === 1, 'porte : le bit 0 mémorise le dernier signal');
      // le répéteur porte son compte sur 7 bits et sa sortie sur 1 : l'octet entier
      A.equal(C.etatMaxDe(B.REPETEUR_CIRCUIT), 255, 'répéteur : etatMax 255 (octet plein)');
    });

    it('SPEC-SAVE-021 : le feu (âge) et la génération des bâtiments restent sous etatMax', function () {
      var Fe = MC.Feu, r = releve();
      // feu : tout âge possible, nourri ou non, sur appui ou non, sous la pluie ou non
      var VOIS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      for (var age = 0; age <= C.etatMaxDe(B.FEU); age++) {
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
      A.ok(r.max[B.FEU] >= Fe.AGE_MAX - 1, 'le feu a vieilli jusqu\'à son âge limite (' + r.max[B.FEU] + ')');
      // bâtiments générés : chaque [x, y, z, id, état] posé par un lieu
      var w = MC.createWorld(20260921), H = MC.Habitats, nLieux = 0, nEtats = 0;
      [['ville', 2], ['village', 4], ['maison', 6]].forEach(function (k) {
        var R = H.LIEUX[k[0]].region;
        for (var rx = -k[1]; rx < k[1]; rx++) for (var rz = -k[1]; rz < k[1]; rz++) {
          var l = w.habitats.lieuDeRegion(k[0], rx, rz);
          if (!l) continue;
          nLieux++;
          l.blocs.forEach(function (a) {
            for (var i = 0; i < a.length; i += 5) {
              if (a[i + 4]) nEtats++;
              r.noter(a[i + 3], a[i + 4], l.nom + ' (' + R + ')');
            }
          });
        }
      });
      A.gt(nLieux, 3, 'des lieux générés (' + nLieux + ')');
      A.gt(nEtats, 0, 'dont des blocs à état (escaliers de toiture, dalles, meubles : ' + nEtats + ')');
      A.equal(r.depassements.length, 0, r.depassements.join(' ; '));
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
