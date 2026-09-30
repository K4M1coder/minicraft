/* spec-contrats-archi.js — contrat figé du chantier ARCHI (src/contrats-archi.js,
   SPEC-ARCHI-019). Il ne valide aucun comportement de jeu : il fige les noms de
   messages, sens, bornes et validateurs contre lesquels les lots A0, B et P
   codent, pour que toute dérive fasse rougir la suite. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var K = MC.ContratsArchi;
  var NP = MC.NetProtocol;

  describe('Contrat ARCHI — messages, états et validateurs', {
    teste: 'Le contrat figé du chantier « solo = serveur » (src/contrats-archi.js) : PAUSE, PAUSE_ETAT, RESEAU, RESEAU_ETAT, ARRET, DORMIR, HISTOIRE_ETAT, SUCCES_DEBLOQUE, ETAT_RESEAU, motifs de refus, bornes.',
    pourquoi: 'Les lots A0, B-* et P-* codent en parallèle contre cette interface : un contrat qui dérive casserait leurs fusions sans qu\'aucun ne le voie.',
    attendu: 'chaque validateur accepte exactement le message bien formé, le normalise en copie, et renvoie null (sans exception) pour tout message sans champ, de mauvais type ou hors borne ; NP.MSG contient les nouveaux types.',
  }, function () {

    it('SPEC-ARCHI-019 : les huit types de message sont distincts, fusionnés dans NP.MSG, avec un sens ; un budget anti-flood pour chaque c→s', function () {
      var attendus = ['PAUSE', 'PAUSE_ETAT', 'RESEAU', 'RESEAU_ETAT', 'ARRET', 'DORMIR', 'HISTOIRE_ETAT', 'SUCCES_DEBLOQUE'];
      A.deep(Object.keys(K.MSG).sort(), attendus.slice().sort(), 'exactement ces huit types');
      var valeurs = attendus.map(function (k) { return K.MSG[k]; });
      A.equal(new Set(valeurs).size, 8, 'aucun doublon interne');
      attendus.forEach(function (k) {
        A.equal(NP.MSG[k], K.MSG[k], 'NP.MSG.' + k + ' fusionné tel quel');
        A.ok(['c>s', 's>c'].indexOf(K.SENS[K.MSG[k]]) >= 0, 'sens défini pour ' + k);
        if (K.SENS[K.MSG[k]] === 'c>s') A.ok(K.BUDGETS_FLOOD[K.MSG[k]] > 0, 'budget anti-flood pour ' + k);
      });
      // aucune collision avec les types historiques ni ceux de la vague 2
      Object.keys(NP.MSG).forEach(function (k) {
        if (K.MSG[k] === undefined) A.equal(valeurs.indexOf(NP.MSG[k]), -1, 'NP.MSG.' + k + ' n\'emprunte aucune valeur ARCHI');
      });
      A.deep(K.ETAT_RESEAU, { FERME: 'ferme', OUVERT: 'ouvert', DISTANT: 'distant' });
      A.deep(K.MOTIFS_REFUS, { POSTE_DEJA_CONNECTE: 'poste_deja_connecte', RESEAU_FERME: 'reseau_ferme', SERVEUR_COMPLET: 'serveur_complet' });
    });

    it('SPEC-ARCHI-019 : PAUSE, RESEAU, ARRET, DORMIR — forme correcte acceptée en copie, le reste rejeté', function () {
      var p = { t: 'pause', actif: true, extra: 1 };
      var v = K.validerPause(p);
      A.deep(v, { t: 'pause', actif: true });
      A.ok(v !== p, 'copie, jamais l\'objet reçu');
      A.equal(K.validerPause({ t: 'pause' }), null, 'champ manquant');
      A.equal(K.validerPause({ t: 'pause', actif: 1 }), null, 'mauvais type');
      A.equal(K.validerPause({ t: 'autre', actif: true }), null, 'mauvais t');
      A.equal(K.validerPause(null), null); A.equal(K.validerPause('x'), null);
      A.deep(K.validerReseau({ t: 'reseau', ouvert: false }), { t: 'reseau', ouvert: false });
      A.equal(K.validerReseau({ t: 'reseau', ouvert: 'oui' }), null);
      A.deep(K.validerArret({ t: 'arret', x: 1 }), { t: 'arret' });
      A.equal(K.validerArret({ t: 'pause' }), null);
      A.deep(K.validerDormir({ t: 'dormir', actif: true }), { t: 'dormir', j: 0, actif: true }, 'j absent = 0');
      A.deep(K.validerDormir({ t: 'dormir', j: 3, actif: false }), { t: 'dormir', j: 3, actif: false });
      A.equal(K.validerDormir({ t: 'dormir', j: 4, actif: true }), null, 'j hors borne');
      A.equal(K.validerDormir({ t: 'dormir', j: 0 }), null, 'actif manquant');
    });

    it('SPEC-ARCHI-019 : le serveur valide via NP.valider ; un type s→c reçu d\'un client est rejeté', function () {
      A.deep(NP.valider({ t: 'pause', actif: true }), { t: 'pause', actif: true });
      A.deep(NP.valider({ t: 'reseau', ouvert: true }), { t: 'reseau', ouvert: true });
      A.deep(NP.valider({ t: 'arret' }), { t: 'arret' });
      A.equal(NP.valider({ t: 'pause_etat', actif: true, rev: 1 }), null, 's→c refusé côté serveur');
      A.equal(NP.valider({ t: 'histoire_etat', j: 0, etat: {} }), null);
      A.equal(NP.valider({ t: 'succes_debloque', j: 0, id: 'a' }), null);
      A.equal(K.valider({ t: 'inconnu' }), null);
    });

    it('SPEC-ARCHI-019 : PAUSE_ETAT et RESEAU_ETAT — bornes et normalisation', function () {
      A.deep(K.validerPauseEtat({ t: 'pause_etat', actif: false, rev: 3 }), { t: 'pause_etat', actif: false, rev: 3 });
      A.equal(K.validerPauseEtat({ t: 'pause_etat', actif: false }), null, 'rev manquant');
      A.equal(K.validerPauseEtat({ t: 'pause_etat', actif: false, rev: -1 }), null);
      A.equal(K.validerPauseEtat({ t: 'pause_etat', actif: false, rev: 1.5 }), null);
      A.equal(K.validerPauseEtat({ t: 'pause_etat', actif: 'x', rev: 1 }), null);
      var ok = { t: 'reseau_etat', etat: 'ouvert', port: 8080, adresses: ['192.168.0.2'] };
      A.deep(K.validerReseauEtat(ok), ok);
      A.ok(K.validerReseauEtat(ok) !== ok);
      A.equal(K.validerReseauEtat({ t: 'reseau_etat', etat: 'distant', port: 1, adresses: [] }), null, 'le serveur n\'annonce jamais distant');
      A.equal(K.validerReseauEtat({ t: 'reseau_etat', etat: 'ferme', port: 70000, adresses: [] }), null, 'port hors borne');
      A.equal(K.validerReseauEtat({ t: 'reseau_etat', etat: 'ferme', port: 1 }), null, 'adresses manquantes');
      A.equal(K.validerReseauEtat({ t: 'reseau_etat', etat: 'ferme', port: 1, adresses: [3] }), null, 'adresse non texte');
      var trop = []; for (var i = 0; i <= K.BORNES.ADRESSES_MAX; i++) trop.push('10.0.0.' + i);
      A.equal(K.validerReseauEtat({ t: 'reseau_etat', etat: 'ouvert', port: 1, adresses: trop }), null, 'trop d\'adresses');
      A.deep(K.validerReseauEtat({ t: 'reseau_etat', etat: 'ferme', port: 0, adresses: [] }).port, 0, 'port 0 toléré (annonce avant liaison)');
    });

    it('SPEC-ARCHI-019 : HISTOIRE_ETAT et SUCCES_DEBLOQUE — bornes', function () {
      var h = K.validerHistoireEtat({ t: 'histoire_etat', j: 1, etat: { acte: 2 } });
      A.deep(h, { t: 'histoire_etat', j: 1, etat: { acte: 2 } });
      A.equal(K.validerHistoireEtat({ t: 'histoire_etat', j: 1 }), null, 'etat manquant');
      A.equal(K.validerHistoireEtat({ t: 'histoire_etat', j: 9, etat: {} }), null, 'j hors borne');
      A.equal(K.validerHistoireEtat({ t: 'histoire_etat', j: 0, etat: { x: new Array(K.BORNES.HISTOIRE_JSON_MAX).join('a') } }), null, 'trop volumineux');
      A.deep(K.validerSuccesDebloque({ t: 'succes_debloque', j: 0, id: 'premier_pas' }), { t: 'succes_debloque', j: 0, id: 'premier_pas' });
      A.equal(K.validerSuccesDebloque({ t: 'succes_debloque', j: 0, id: '' }), null);
      A.equal(K.validerSuccesDebloque({ t: 'succes_debloque', j: 0, id: 5 }), null);
      A.equal(K.validerSuccesDebloque({ t: 'succes_debloque', j: 0, id: new Array(70).join('x') }), null);
    });

    it('SPEC-ARCHI-019 : validerRecu route les quatre types s→c et ne lève jamais', function () {
      A.deep(K.validerRecu({ t: 'pause_etat', actif: true, rev: 0 }), { t: 'pause_etat', actif: true, rev: 0 });
      A.ok(K.validerRecu({ t: 'reseau_etat', etat: 'ferme', port: 8080, adresses: [] }));
      A.equal(K.validerRecu({ t: 'pause', actif: true }), null, 'c→s refusé côté client');
      [undefined, null, 0, 'x', [], {}, { t: 5 }, { t: 'pause_etat' }].forEach(function (m) {
        A.equal(K.validerRecu(m), null);
        A.equal(K.valider(m), null);
      });
    });

    it('SPEC-ARCHI-003 : les origines locales du mode fermé sont exactement trois, figées', function () {
      A.deep(K.originesLocales(8080), ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080']);
      A.deep(K.originesLocales(0), []);
      A.deep(K.originesLocales('x'), []);
    });

    it('SPEC-ARCHI-005 : estAdresseLocale reconnaît la boucle locale IPv4, IPv6 et IPv4 projetée', function () {
      ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1'].forEach(function (a) { A.ok(K.estAdresseLocale(a), a); });
      ['192.168.1.5', '10.0.0.1', '::ffff:192.168.1.5', '2001:db8::1', '', undefined, 12].forEach(function (a) { A.ok(!K.estAdresseLocale(a), String(a)); });
    });

    it('SPEC-ARCHI-004 : portsCandidats — repli de 8080 à 8099, port imposé sans repli, 0 éphémère', function () {
      var l = K.portsCandidats(8080, false);
      A.equal(l[0], 8080); A.equal(l[l.length - 1], 8099); A.equal(l.length, 20);
      A.deep(K.portsCandidats(9000, true), [9000]);
      A.deep(K.portsCandidats(0, false), [0]);
      A.deep(K.portsCandidats(9000, false), [9000], 'hors plage de repli : un seul essai');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
