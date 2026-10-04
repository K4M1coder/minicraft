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
})(typeof globalThis !== 'undefined' ? globalThis : this);
