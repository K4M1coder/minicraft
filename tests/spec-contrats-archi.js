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
    teste: 'Le contrat figé du chantier « solo = serveur » (src/contrats-archi.js) : PAUSE, PAUSE_ETAT, RESEAU, RESEAU_ETAT, ARRET, DORMIR, HISTOIRE_ETAT, HISTOIRE_PARLER, HISTOIRE_REPONSE, HISTOIRE_NOTIF, SUCCES_DEBLOQUE, SUCCES_ETAT, FOUDROYE, ETAT_RESEAU, motifs de refus, bornes.',
    pourquoi: 'Les lots A0, B-* et P-* codent en parallèle contre cette interface : un contrat qui dérive casserait leurs fusions sans qu\'aucun ne le voie.',
    attendu: 'chaque validateur accepte exactement le message bien formé, le normalise en copie, et renvoie null (sans exception) pour tout message sans champ, de mauvais type ou hors borne ; NP.MSG contient les nouveaux types.',
  }, function () {

    it('SPEC-ARCHI-019 : les types de message sont distincts, fusionnés dans NP.MSG, avec un sens ; un budget anti-flood pour chaque c→s', function () {
      var attendus = ['PAUSE', 'PAUSE_ETAT', 'RESEAU', 'RESEAU_ETAT', 'ARRET', 'DORMIR', 'HISTOIRE_ETAT', 'SUCCES_DEBLOQUE', 'SUCCES_ETAT', 'FOUDROYE',
                      'VEHICULE_POSER', 'VEHICULE_MONTER', 'VEHICULE_DESCENDRE', 'VEHICULE_REPARER', 'VEHICULE_EVT',
                      'HISTOIRE_PARLER', 'HISTOIRE_REPONSE', 'HISTOIRE_NOTIF', 'ACTIONNER',
                      'LIVRE_ECRIRE'];
      A.deep(Object.keys(K.MSG).sort(), attendus.slice().sort(), 'exactement ces types');
      var valeurs = attendus.map(function (k) { return K.MSG[k]; });
      A.equal(new Set(valeurs).size, attendus.length, 'aucun doublon interne');
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

    it('SPEC-ARCHI-041 : HISTOIRE_PARLER, HISTOIRE_REPONSE, HISTOIRE_NOTIF — formes, bornes, copies', function () {
      A.deep(K.validerHistoireParler({ t: 'histoire_parler', eid: 12, x: 1 }), { t: 'histoire_parler', j: 0, eid: 12 });
      A.deep(NP.valider({ t: 'histoire_parler', j: 2, eid: 5 }), { t: 'histoire_parler', j: 2, eid: 5 }, 'le serveur accepte le type c→s');
      A.equal(K.validerHistoireParler({ t: 'histoire_parler', eid: -1 }), null);
      A.equal(K.validerHistoireParler({ t: 'histoire_parler', eid: 1.5 }), null);
      A.equal(K.validerHistoireParler({ t: 'histoire_parler', j: 4, eid: 1 }), null, 'j hors borne');
      A.equal(K.validerHistoireParler({ t: 'histoire_parler' }), null, 'eid manquant');
      A.deep(K.validerHistoireReponse({ t: 'histoire_reponse', id: 'quete:a', option: 'oui' }), { t: 'histoire_reponse', j: 0, id: 'quete:a', option: 'oui' });
      A.deep(K.validerHistoireReponse({ t: 'histoire_reponse', j: 1, id: 'c' }), { t: 'histoire_reponse', j: 1, id: 'c', option: null }, 'option facultative');
      A.equal(K.validerHistoireReponse({ t: 'histoire_reponse', id: '', option: 'a' }), null);
      A.equal(K.validerHistoireReponse({ t: 'histoire_reponse', id: 5, option: 'a' }), null);
      A.equal(K.validerHistoireReponse({ t: 'histoire_reponse', id: 'a', option: 7 }), null);
      A.equal(K.validerHistoireReponse({ t: 'histoire_reponse', id: new Array(80).join('x') }), null, 'identifiant trop long');
      A.equal(NP.valider({ t: 'histoire_notif', j: 0, notifs: [] }), null, 's→c refusé côté serveur');
      A.ok(K.BUDGETS_FLOOD.histoire_parler > 0 && K.BUDGETS_FLOOD.histoire_reponse > 0, 'budgets anti-flood');
      var n = { t: 'histoire_notif', j: 1, notifs: [
        { type: 'chapitre', titre: 'Le réveil', texte: 'Cette nuit…', inconnu: 1 },
        { type: 'recompense', objets: [{ id: 5, n: 2 }] },
        { type: 'fin', id: 'aube', titre: 'L aube', texte: 'Fin', stats: 'Chapitres : 4/4', recit: 'Épopée' }],
        proposition: { id: 'quete:x', titre: 'T', texte: 'Q', nom: 'Fermier' }, libre: false };
      var v = K.validerHistoireNotif(n);
      A.ok(v && v !== n, 'copie');
      A.equal(v.notifs[0].inconnu, undefined, 'champ inconnu écarté');
      A.equal(v.notifs[2].stats, 'Chapitres : 4/4');
      A.deep(v.proposition, { id: 'quete:x', titre: 'T', texte: 'Q', nom: 'Fermier' });
      A.equal(v.libre, undefined, 'libre faux = absent');
      A.deep(K.validerHistoireNotif({ t: 'histoire_notif', j: 0, notifs: [], libre: true, eid: 9 }), { t: 'histoire_notif', j: 0, notifs: [], libre: true, eid: 9 });
      A.equal(K.validerHistoireNotif({ t: 'histoire_notif', j: 0, notifs: [], libre: true }), null, 'libre sans eid');
      A.equal(K.validerHistoireNotif({ t: 'histoire_notif', j: 0, notifs: [{ type: 'pirate' }] }), null, 'type inconnu');
      A.equal(K.validerHistoireNotif({ t: 'histoire_notif', j: 0, notifs: [{ type: 'recompense', objets: [{ id: 0, n: 1 }] }] }), null, 'objet invalide');
      A.equal(K.validerHistoireNotif({ t: 'histoire_notif', j: 0, notifs: new Array(K.BORNES.HISTOIRE_NOTIFS_MAX + 1).fill({ type: 'info', texte: 'x' }) }), null, 'trop d annonces');
      A.equal(K.validerHistoireNotif({ t: 'histoire_notif', j: 0 }), null, 'notifs manquant');
      A.equal(K.validerHistoireNotif({ t: 'histoire_notif', j: 0, notifs: [{ type: 'info', texte: new Array(2000).join('x') }] }).notifs[0].texte.length, K.BORNES.HISTOIRE_TEXTE_MAX, 'texte tronqué à la borne');
      A.ok(K.validerRecu({ t: 'histoire_notif', j: 0, notifs: [] }), 'routé côté client');
    });

    it('SPEC-ARCHI-019 : SUCCES_ETAT et FOUDROYE — bornes et normalisation', function () {
      var ok = { t: 'succes_etat', j: 1, etat: { compte: { premier_bloc: 1, cinq_mille_blocs: 212.5 }, debloques: ['premier_bloc'] } };
      A.deep(K.validerSuccesEtat(ok), ok);
      A.ok(K.validerSuccesEtat(ok) !== ok, 'une copie');
      A.deep(K.validerSuccesEtat({ t: 'succes_etat', j: 0, etat: {} }).etat, { compte: {}, debloques: [] }, 'etat vide toléré');
      A.equal(K.validerSuccesEtat({ t: 'succes_etat', j: 0 }), null, 'etat manquant');
      A.equal(K.validerSuccesEtat({ t: 'succes_etat', j: 7, etat: {} }), null, 'j hors borne');
      A.equal(K.validerSuccesEtat({ t: 'succes_etat', j: 0, etat: { compte: { x: -1 } } }), null, 'compteur négatif');
      A.equal(K.validerSuccesEtat({ t: 'succes_etat', j: 0, etat: { compte: { x: 'a' } } }), null, 'compteur non numérique');
      A.equal(K.validerSuccesEtat({ t: 'succes_etat', j: 0, etat: { debloques: [5] } }), null, 'identifiant non texte');
      A.equal(K.validerSuccesEtat({ t: 'succes_etat', j: 0, etat: { debloques: [new Array(70).join('x')] } }), null, 'identifiant trop long');
      A.equal(K.validerSuccesEtat({ t: 'succes_etat', j: 0, etat: { debloques: new Array(K.BORNES.SUCCES_ETAT_MAX + 1).fill('a') } }), null, 'trop de succès');
      A.deep(K.validerFoudroye({ t: 'foudroye', j: 2 }), { t: 'foudroye', j: 2 });
      A.deep(K.validerFoudroye({ t: 'foudroye' }), { t: 'foudroye', j: 0 }, 'j par défaut : 0');
      A.equal(K.validerFoudroye({ t: 'foudroye', j: 4 }), null);
      A.ok(K.validerRecu(ok) && K.validerRecu({ t: 'foudroye', j: 0 }), 'routés par validerRecu');
      A.equal(K.valider({ t: 'succes_etat', j: 0, etat: {} }), null, 's→c refusé côté serveur');
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

    it('SPEC-ARCHI-021 : VEHICULE_POSER, MONTER, DESCENDRE, REPARER — forme correcte acceptée en copie, le reste rejeté ; routés par NP.valider', function () {
      var p = { t: 'vehicule_poser', j: 1, nom: 'sous_marin', i: 3, x: 10, y: 64, z: -5, nx: 0, ny: 1, nz: 0, extra: 1 };
      var v = K.validerVehiculePoser(p);
      A.deep(v, { t: 'vehicule_poser', j: 1, nom: 'sous_marin', i: 3, x: 10, y: 64, z: -5, nx: 0, ny: 1, nz: 0 });
      A.ok(v !== p, 'copie');
      A.deep(NP.valider(p), v, 'NP.valider route le message vers le contrat');
      A.equal(K.validerVehiculePoser({ t: 'vehicule_poser', nom: 'voiture', x: 0, y: 5, z: 0, nx: 0, ny: 1, nz: 0 }).i, -1, 'case absente = une case quelconque');
      A.equal(K.validerVehiculePoser({ t: 'vehicule_poser', nom: 'Voiture', x: 0, y: 5, z: 0, nx: 0, ny: 1, nz: 0 }), null, 'nom en minuscules seulement');
      A.equal(K.validerVehiculePoser({ t: 'vehicule_poser', nom: 'voiture', x: 0, y: 500, z: 0, nx: 0, ny: 1, nz: 0 }), null, 'y hors du monde');
      A.equal(K.validerVehiculePoser({ t: 'vehicule_poser', nom: 'voiture', x: 1e9, y: 5, z: 0, nx: 0, ny: 1, nz: 0 }), null, 'x hors borne');
      A.equal(K.validerVehiculePoser({ t: 'vehicule_poser', nom: 'voiture', x: 0, y: 5, z: 0, nx: 2, ny: 0, nz: 0 }), null, 'normale hors {-1,0,1}');
      A.equal(K.validerVehiculePoser({ t: 'vehicule_poser', j: 7, nom: 'voiture', x: 0, y: 5, z: 0, nx: 0, ny: 1, nz: 0 }), null, 'j hors borne');
      A.deep(K.validerVehiculeMonter({ t: 'vehicule_monter', eid: 12 }), { t: 'vehicule_monter', j: 0, eid: 12 });
      A.equal(K.validerVehiculeMonter({ t: 'vehicule_monter', eid: -1 }), null);
      A.equal(K.validerVehiculeMonter({ t: 'vehicule_monter', eid: 'x' }), null);
      A.equal(K.validerVehiculeMonter({ t: 'vehicule_monter' }), null);
      A.deep(K.validerVehiculeDescendre({ t: 'vehicule_descendre', j: 2 }), { t: 'vehicule_descendre', j: 2 });
      A.equal(K.validerVehiculeDescendre({ t: 'vehicule_descendre', j: 9 }), null);
      A.deep(K.validerVehiculeReparer({ t: 'vehicule_reparer', eid: 4 }), { t: 'vehicule_reparer', j: 0, eid: 4 });
      A.equal(K.validerVehiculeReparer({ t: 'vehicule_reparer' }), null);
      A.equal(NP.valider({ t: 'vehicule_evt', j: 0, evt: 'monte' }), null, 's→c refusé côté serveur');
    });

    it('SPEC-ARCHI-021 : VEHICULE_EVT — évènements et motifs en liste fermée', function () {
      A.deep(K.validerVehiculeEvt({ t: 'vehicule_evt', j: 0, evt: 'monte', nom: 'camion' }), { t: 'vehicule_evt', j: 0, evt: 'monte', nom: 'camion' });
      A.deep(K.validerVehiculeEvt({ t: 'vehicule_evt', j: 1, evt: 'refus', motif: 'occupe' }), { t: 'vehicule_evt', j: 1, evt: 'refus', motif: 'occupe' });
      A.deep(K.validerRecu({ t: 'vehicule_evt', j: 0, evt: 'descend' }), { t: 'vehicule_evt', j: 0, evt: 'descend' });
      A.equal(K.validerVehiculeEvt({ t: 'vehicule_evt', j: 0, evt: 'explose' }), null, 'évènement inconnu');
      A.equal(K.validerVehiculeEvt({ t: 'vehicule_evt', j: 0, evt: 'refus', motif: 'pasvu' }), null, 'motif inconnu');
      A.equal(K.validerVehiculeEvt({ t: 'vehicule_evt', j: 0, evt: 'monte', nom: 'CAMION!' }), null, 'nom mal formé');
      A.equal(K.validerVehiculeEvt({ t: 'vehicule_evt', j: 9, evt: 'monte' }), null, 'j hors borne');
    });

    it('SPEC-INTERIEUR-003 : LIVRE_ECRIRE (c→s) — contenu borné, caractères de contrôle retirés, jamais d\'auteur venu du client', function () {
      A.equal(K.MSG.LIVRE_ECRIRE, 'livre_ecrire');
      A.equal(K.SENS.livre_ecrire, 'c>s');
      A.ok(K.BUDGETS_FLOOD.livre_ecrire > 0 && K.BUDGETS_FLOOD.livre_ecrire <= 10, 'budget anti-flood serré');
      var ok = K.validerLivreEcrire({ t: 'livre_ecrire', j: 1, seq: 3, i: 4, titre: 'Mon\tjournal\n', pages: ['a\u0000b\r\nc\u202Ed', 'x'], signer: true,
                                       auteur: 'Usurpateur', data: { signe: true } });
      A.deep(ok, { t: 'livre_ecrire', j: 1, seq: 3, i: 4, titre: 'Mon journal ', pages: ['ab\ncd', 'x'], signer: true },
             'tabulation et saut de ligne du titre en espaces, NUL et contrôle bidirectionnel retirés, auteur et data ignorés');
      A.equal(K.validerLivreEcrire({ t: 'livre_ecrire', seq: 1, i: 0, titre: '', pages: ['p'] }).signer, false, 'signer par défaut : non');
      A.equal(K.nettoyerTexteLivre('a\r\nb\u0007c', true), 'a\nbc', 'nettoyerTexteLivre : saut de ligne normalisé, cloche retirée (page)');
      A.equal(K.nettoyerTexteLivre('a\nb', false), 'a b', 'nettoyerTexteLivre : un titre tient sur une ligne');
      A.equal(K.validerLivreEcrire({ t: 'livre_ecrire', seq: 1, i: 0, titre: '', pages: [] }), null, 'au moins une page');
      A.equal(K.validerLivreEcrire({ t: 'livre_ecrire', seq: 1, i: 0, titre: '', pages: new Array(K.LIVRE_BRUT.PAGES_MAX + 1).fill('') }), null, 'trop de pages');
      A.equal(K.validerLivreEcrire({ t: 'livre_ecrire', seq: 1, i: 0, titre: '', pages: ['x'.repeat(K.LIVRE_BRUT.PAGE_MAX + 1)] }), null, 'page trop longue');
      A.equal(K.validerLivreEcrire({ t: 'livre_ecrire', seq: 1, i: 0, titre: 'x'.repeat(K.LIVRE_BRUT.TITRE_MAX + 1), pages: [''] }), null, 'titre trop long');
      A.equal(K.validerLivreEcrire({ t: 'livre_ecrire', seq: 1, i: 36, titre: '', pages: [''] }), null, 'case hors de l\'inventaire');
      A.equal(K.validerLivreEcrire({ t: 'livre_ecrire', seq: 0, i: 0, titre: '', pages: [''] }), null, 'seq invalide');
      A.equal(K.validerLivreEcrire({ t: 'livre_ecrire', seq: 1, i: 0, titre: 3, pages: [''] }), null, 'titre non textuel');
      A.equal(K.validerLivreEcrire({ t: 'livre_ecrire', seq: 1, i: 0, titre: '', pages: [{}] }), null, 'page non textuelle');
      A.equal(K.validerLivreEcrire({ t: 'livre_ecrire', seq: 1, i: 0, titre: '', pages: [''], signer: 'oui' }), null, 'signer booléen');
      A.equal(K.validerLivreEcrire({ t: 'livre_ecrire', j: 7, seq: 1, i: 0, titre: '', pages: [''] }), null, 'j hors borne');
      A.deep(NP.valider({ t: 'livre_ecrire', seq: 2, i: 0, titre: 'T', pages: ['p'] }), { t: 'livre_ecrire', j: 0, seq: 2, i: 0, titre: 'T', pages: ['p'], signer: false },
             'routé par NP.valider côté serveur');
    });

    it('SPEC-MECA-005 : ACTIONNER (c→s) — un joueur local actionne la commande d\'une case du monde, rien d\'autre', function () {
      A.equal(K.MSG.ACTIONNER, 'actionner');
      A.equal(K.SENS.actionner, 'c>s');
      A.ok(K.BUDGETS_FLOOD.actionner > 0, 'budget anti-flood');
      A.deep(K.validerActionner({ t: 'actionner', x: 3, y: 40, z: -7 }), { t: 'actionner', j: 0, x: 3, y: 40, z: -7 });
      A.deep(K.validerActionner({ t: 'actionner', j: 2, x: 0, y: 0, z: 0, etat: 1 }), { t: 'actionner', j: 2, x: 0, y: 0, z: 0 }, 'aucun état annoncé par le client ne passe');
      A.equal(K.validerActionner({ t: 'actionner', x: 0, y: 128, z: 0 }), null, 'y hors du monde');
      A.equal(K.validerActionner({ t: 'actionner', x: 1e9, y: 5, z: 0 }), null, 'x hors borne');
      A.equal(K.validerActionner({ t: 'actionner', x: 0.5, y: 5, z: 0 }), null, 'coordonnée non entière');
      A.equal(K.validerActionner({ t: 'actionner', x: 0, y: 5 }), null, 'z manquant');
      A.equal(K.validerActionner({ t: 'actionner', j: 4, x: 0, y: 5, z: 0 }), null, 'j hors borne');
      A.equal(K.validerActionner(null), null);
      A.deep(K.valider({ t: 'actionner', x: 1, y: 2, z: 3 }), { t: 'actionner', j: 0, x: 1, y: 2, z: 3 }, 'routé par valider');
      A.deep(NP.valider({ t: 'actionner', x: 1, y: 2, z: 3 }), { t: 'actionner', j: 0, x: 1, y: 2, z: 3 }, 'et par NP.valider côté serveur');
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
