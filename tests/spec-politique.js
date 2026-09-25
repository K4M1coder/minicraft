/* spec-politique.js — SPEC-FACTION-006 à 008 : factions PNJ autonomes. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var P = MC.Politique;

  var SITES = [
    { id: 'ville:0,0', kind: 'ville', x: 100, z: 100, nom: 'Beaulac' },
    { id: 'ville:1,0', kind: 'ville', x: 900, z: 40, nom: 'Valombre' },
    { id: 'megapole:0,0', kind: 'megapole', x: -2000, z: -2000, nom: 'Grandcité' },
    { id: 'volcan:0,0', kind: 'volcan', x: 500, z: 500, nom: 'Mont Braise' },
    { id: 'vierge:0,0', kind: 'vierge', x: -500, z: 700, nom: 'Terres perdues' },
    { id: 'vierge:1,0', kind: 'vierge', x: -900, z: 300, nom: 'Confins' },
  ];

  describe('Specs — politique (factions PNJ)', function () {
    it('SPEC-FACTION-006 : des factions PNJ naissent du monde de façon déterministe, avec siège, territoire, ressources, caractère et objectifs', function () {
      var e1 = P.creer(42);
      var nouvelles1 = P.decouvrir(e1, SITES);
      A.gt(nouvelles1.length, 0, 'au moins une faction naît');
      nouvelles1.forEach(function (f) {
        A.ok(f.siege && typeof f.siege.x === 'number', 'un siège');
        A.gt(f.territoire, 0, 'un territoire');
        A.ok(f.ressources && typeof f.ressources.or === 'number', 'des ressources');
        A.ok(P.CARACTERES.indexOf(f.caractere) >= 0, 'un caractère connu');
        A.ok(f.objectifs.indexOf(f.objectif) >= 0, 'un objectif parmi ceux de son genre');
      });
      // même graine, mêmes sites : mêmes factions, quel que soit l'ordre de découverte
      var e2 = P.creer(42);
      var ordreInverse = SITES.slice().reverse();
      P.decouvrir(e2, ordreInverse);
      var ids1 = Array.from(e1.factions.keys()).sort(), ids2 = Array.from(e2.factions.keys()).sort();
      A.deep(ids1, ids2, 'mêmes factions, ordre de découverte indifférent');
      ids1.forEach(function (id) {
        A.deep(e1.factions.get(id), e2.factions.get(id), 'attributs identiques pour ' + id);
      });
      // une autre graine change la donne (au moins un attribut, sur un ensemble large)
      var e3 = P.creer(99);
      P.decouvrir(e3, SITES);
      var differe = ids1.some(function (id) {
        var f3 = e3.factions.get(id);
        return !f3 || JSON.stringify(f3) !== JSON.stringify(e1.factions.get(id));
      });
      A.ok(differe, 'une autre graine donne un résultat différent');
      // naitreDe est la brique pure derrière decouvrir : mêmes entrées, mêmes sorties
      A.deep(P.naitreDe(42, SITES[0]).map(function (f) { return f.id; }),
             P.naitreDe(42, SITES[0]).map(function (f) { return f.id; }));
      // découvrir un site déjà connu ne duplique rien
      var avant = e1.factions.size;
      P.decouvrir(e1, SITES);
      A.equal(e1.factions.size, avant, 'pas de doublon');
    });

    it('SPEC-FACTION-007 : les factions PNJ agissent d\'elles-mêmes (caravanes, patrouilles, raids, avant-postes), leur territoire change, et la simulation se rattrape de façon déterministe', function () {
      var e1 = P.creer(7);
      P.decouvrir(e1, SITES);
      var e2 = P.charger(JSON.parse(JSON.stringify(P.serialiser(e1))));

      // rattrapage d'un coup vs jour par jour : même état final
      P.tourDuMonde(e1, 40);
      for (var j = 1; j <= 40; j++) P.tourDuMonde(e2, j);
      A.equal(e1.jour, e2.jour);
      A.deep(Array.from(e1.factions.entries()).sort(), Array.from(e2.factions.entries()).sort(),
             'rattrapage d\'un bloc == jour par jour');
      A.deep(Array.from(e1.relations.entries()).sort(), Array.from(e2.relations.entries()).sort());

      // au moins un territoire a bougé (avant-poste ou raid) sur autant de jours
      var e3 = P.creer(7);
      P.decouvrir(e3, SITES);
      var territoiresAvant = {};
      e3.factions.forEach(function (f, id) { territoiresAvant[id] = f.territoire; });
      P.tourDuMonde(e3, 200);
      var bouge = false;
      e3.factions.forEach(function (f, id) { if (f.territoire !== territoiresAvant[id]) bouge = true; });
      A.ok(bouge, 'au moins un territoire évolue avec les raids/avant-postes');

      // rejouer deux fois le même jour ne change rien (idempotent en avant)
      var avantJour = e3.jour;
      P.tourDuMonde(e3, avantJour); // jourCible <= jour courant : no-op
      A.equal(e3.jour, avantJour);
    });

    it('SPEC-FACTION-008 : les relations entre factions PNJ évoluent et s\'annoncent, elles jugent joueurs et factions de joueurs par réputation, et proposent des quêtes selon leurs objectifs', function () {
      var e = P.creer(123);
      P.decouvrir(e, SITES);
      var ids = Array.from(e.factions.keys());
      A.ok(['guerre', 'rivalite', 'neutre', 'alliance'].indexOf(P.relationEntre(e, ids[0], ids[1])) >= 0);
      P.tourDuMonde(e, 200);
      A.gt(e.annonces.length, 0, 'des annonces sont produites (naissances, actions, relations)');
      e.annonces.forEach(function (a) { A.ok(typeof a.texte === 'string' && a.texte.length > 0); });

      // quêtes de faction, selon l'objectif
      var qs = P.quetesActives(e);
      A.gt(qs.length, 0, 'des quêtes existent');
      qs.forEach(function (q) {
        A.ok(['livrer', 'escorter', 'eliminer', 'explorer'].indexOf(q.type) >= 0, 'un type de quête simple');
        A.ok(e.factions.has(q.faction));
      });
      var q1 = P.questesDe(e, ids[0]);
      A.deep(q1, P.questesDe(e, ids[0]), 'stables tant que la semaine ne change pas');

      // jugement du joueur (et de ses factions) par réputation, comme MC.Factions
      var rep = P.creerReputations(e);
      A.equal(rep.statut(ids[0]), 'neutre');
      rep.modifier(ids[0], 50);
      A.equal(rep.statut(ids[0]), 'allie');
      rep.modifier(ids[0], -200);
      A.equal(rep.statut(ids[0]), 'hostile');
      var copie = rep.serialiser();
      var rep2 = P.creerReputations(e);
      rep2.charger(copie);
      A.equal(rep2.get(ids[0]), rep.get(ids[0]), 'aller-retour de la réputation');

      // persistance de l'état politique dans son ensemble
      var data = P.serialiser(e);
      var recharge = P.charger(data);
      A.equal(recharge.jour, e.jour);
      A.deep(Array.from(recharge.factions.keys()).sort(), Array.from(e.factions.keys()).sort());
    });

    it('SPEC-FACTION-016 : un raid ou un avant-poste (`politique.js:tourUnJour`) prélève réellement or et nourriture de son auteur, avec un risque d\'échec qui les prélève sans gain de territoire', function () {
      var seed = 55;
      var e = P.creer(seed);
      P.decouvrir(e, SITES);
      var ids = Array.from(e.factions.keys()).sort();
      A.gt(ids.length, 2, 'deux villes + une mégapole garantissent au moins trois factions');
      var idA = ids[0], idB = ids[1], idC = ids[2];
      // idB a une seule cible de raid possible (idC), quel que soit le hasard des relations initiales
      ids.forEach(function (autre) {
        if (autre === idB) return;
        var cle = idB < autre ? idB + '~' + autre : autre + '~' + idB;
        e.relations.set(cle, autre === idC ? 'guerre' : 'neutre');
      });

      // --- avant-poste : un jour de succès et un jour d'échec, déterministes par graine ---
      var fAP = e.factions.get(idA);
      var jourSuccesAP = null, jourEchecAP = null;
      for (var j = 0; j < 300 && (jourSuccesAP === null || jourEchecAP === null); j++) {
        var hj = P.h01(seed, idA, 'avant_poste', j);
        if (hj < 0.5 && jourSuccesAP === null) jourSuccesAP = j;
        if (hj >= 0.5 && jourEchecAP === null) jourEchecAP = j;
      }
      A.ok(jourSuccesAP !== null && jourEchecAP !== null, 'un jour de succès et un jour d\'échec existent (avant-poste)');

      var orAvant = fAP.ressources.or, nourritureAvant = fAP.ressources.nourriture, territoireAvant = fAP.territoire;
      P.appliquerAction(e, fAP, 'avant_poste', jourEchecAP);
      var coutOr = orAvant - fAP.ressources.or, coutNourriture = nourritureAvant - fAP.ressources.nourriture;
      A.gt(coutOr, 0, 'or prélevé même en cas d\'échec');
      A.gt(coutNourriture, 0, 'nourriture prélevée même en cas d\'échec');
      A.equal(fAP.territoire, territoireAvant, 'aucun gain de territoire en cas d\'échec');

      var orAvant2 = fAP.ressources.or, nourritureAvant2 = fAP.ressources.nourriture, territoireAvant2 = fAP.territoire;
      P.appliquerAction(e, fAP, 'avant_poste', jourSuccesAP);
      A.equal(orAvant2 - fAP.ressources.or, coutOr, 'même montant fixe prélevé, succès ou échec');
      A.equal(nourritureAvant2 - fAP.ressources.nourriture, coutNourriture, 'même montant fixe prélevé, succès ou échec');
      A.gt(fAP.territoire, territoireAvant2, 'territoire gagné en cas de succès');

      // --- raid : idem, avec une cible réelle qui perd du territoire en cas de succès ---
      var fB = e.factions.get(idB), fC = e.factions.get(idC);
      var jourSuccesRaid = null, jourEchecRaid = null;
      for (var j2 = 0; j2 < 300 && (jourSuccesRaid === null || jourEchecRaid === null); j2++) {
        var hr = P.h01(seed, idB, idC, 'raid', j2);
        if (hr < 0.5 && jourSuccesRaid === null) jourSuccesRaid = j2;
        if (hr >= 0.5 && jourEchecRaid === null) jourEchecRaid = j2;
      }
      A.ok(jourSuccesRaid !== null && jourEchecRaid !== null, 'un jour de succès et un jour d\'échec existent (raid)');

      var orB1 = fB.ressources.or, nourritureB1 = fB.ressources.nourriture, terrB1 = fB.territoire, terrC1 = fC.territoire;
      P.appliquerAction(e, fB, 'raid', jourEchecRaid);
      A.gt(orB1 - fB.ressources.or, 0, 'or prélevé même en cas d\'échec du raid');
      A.gt(nourritureB1 - fB.ressources.nourriture, 0, 'nourriture prélevée même en cas d\'échec du raid');
      A.equal(fB.territoire, terrB1, 'pas de gain de territoire pour l\'auteur en cas d\'échec');
      A.equal(fC.territoire, terrC1, 'pas de perte de territoire pour la cible en cas d\'échec');

      var orB2 = fB.ressources.or, nourritureB2 = fB.ressources.nourriture, terrB2 = fB.territoire, terrC2 = fC.territoire;
      P.appliquerAction(e, fB, 'raid', jourSuccesRaid);
      A.equal(orB2 - fB.ressources.or, coutOr, 'même montant fixe prélevé pour un raid réussi');
      A.equal(nourritureB2 - fB.ressources.nourriture, coutNourriture, 'même montant fixe prélevé pour un raid réussi');
      A.gt(fB.territoire, terrB2, 'territoire gagné en cas de succès du raid');
      A.lt(fC.territoire, terrC2, 'territoire perdu par la cible en cas de succès du raid');
    });

    it('SPEC-QUETE-001 : une quête de livraison de faction (`politique.js:questesDe`) ne se propose que si la ressource visée est sous un seuil bas défini ; sa réussite relève ce niveau d\'autant que fourni, plafonné aux besoins réels', function () {
      var e = P.creer(1);
      var f = { id: 'test:livraison', type: 'guilde', nom: 'Comptoir de Test', caractere: 'pragmatique',
                siege: { x: 0, z: 0, site: 'test' }, territoire: 80,
                ressources: { or: 50, nourriture: 50 }, objectif: 'commercer', objectifs: ['commercer', 'explorer'],
                naissance: 0 };
      e.factions.set(f.id, f);

      // au-dessus du seuil bas : aucune quête de livraison générée
      A.deep(P.questesDe(e, f.id), [], 'aucune quête de livraison au-dessus du seuil');

      // sous le seuil bas : une quête de livraison apparaît, ciblant la ressource réellement basse
      f.ressources.or = P.SEUIL_RESSOURCE_BAS - 1;
      var qs = P.questesDe(e, f.id);
      A.equal(qs.length, 1, 'générée en dessous du seuil');
      A.equal(qs[0].type, 'livrer');
      A.equal(qs[0].ressource, 'or', 'cible la ressource réellement sous le seuil');

      // réussite : le montant livré relève le niveau, plafonné exactement au manque réel
      var manque = P.SEUIL_RESSOURCE_BAS - f.ressources.or;
      var applique = P.livrerQuete(e, f.id, 'or', manque + 100); // fourniture largement supérieure au manque
      A.equal(applique, manque, 'plafonné exactement au manque réel, jamais au-delà');
      A.equal(f.ressources.or, P.SEUIL_RESSOURCE_BAS, 'ressource relevée jusqu\'au besoin réel, pas plus');

      // une livraison partielle relève le niveau d'autant que fourni (pas plus, pas moins)
      f.ressources.or = P.SEUIL_RESSOURCE_BAS - 10;
      var applique2 = P.livrerQuete(e, f.id, 'or', 4);
      A.equal(applique2, 4, 'relevé exactement du montant fourni, sous le manque réel');
      A.equal(f.ressources.or, P.SEUIL_RESSOURCE_BAS - 6);

      // plus aucun manque réel au-dessus du seuil : la livraison n'a alors plus aucun effet
      f.ressources.or = P.SEUIL_RESSOURCE_BAS + 5;
      var applique3 = P.livrerQuete(e, f.id, 'or', 10);
      A.equal(applique3, 0, 'aucun manque réel au-dessus du seuil : rien à livrer');
      A.equal(f.ressources.or, P.SEUIL_RESSOURCE_BAS + 5);
    });

    it('SPEC-QUETE-002 : une quête d\'élimination ne se propose qu\'en relation `guerre` active, ciblant le membre réel désigné par `ciblePourRaid` ; sa réussite égale un raid réussi (FACTION-016)', function () {
      var seed = 2;
      function factionTest(id, nom, type, objectif, objectifs, territoire) {
        return { id: id, type: type, nom: nom, caractere: 'pragmatique',
                 siege: { x: 0, z: 0, site: id }, territoire: territoire,
                 ressources: { or: 50, nourriture: 50 }, objectif: objectif, objectifs: objectifs,
                 naissance: 0 };
      }
      var e = P.creer(seed);
      var fA = factionTest('test:eliminateur', 'Ordre de Test', 'ordre', 'defendre', ['defendre', 'convertir'], 100);
      var fB = factionTest('test:rival', 'Royaume Rival', 'royaume', 'etendre', ['etendre', 'defendre', 'commercer'], 100);
      e.factions.set(fA.id, fA); e.factions.set(fB.id, fB);
      var cle = fA.id < fB.id ? fA.id + '~' + fB.id : fB.id + '~' + fA.id;

      // hors guerre active (rivalité, neutre, alliance) : jamais de quête d'élimination
      ['rivalite', 'neutre', 'alliance'].forEach(function (r) {
        e.relations.set(cle, r);
        A.deep(P.questesDe(e, fA.id), [], 'aucune quête d\'élimination sans guerre active (' + r + ')');
      });

      // guerre active : la quête apparaît, ciblant exactement ce que ciblePourRaid retournerait
      e.relations.set(cle, 'guerre');
      var attendu = P.ciblePourRaid(e, fA, e.jour);
      A.ok(attendu, 'une cible existe bien en guerre');
      var qs = P.questesDe(e, fA.id);
      A.equal(qs.length, 1, 'la quête d\'élimination apparaît en guerre active');
      A.equal(qs[0].type, 'eliminer');
      A.equal(qs[0].cible, attendu.id, 'cible le membre réel désigné par ciblePourRaid');

      // un jour où un raid classique gagnerait réellement (déterministe par graine), pour comparer
      // la réussite de la quête au même résultat qu'un raid gagné (FACTION-016)
      var jourRaidGagne = null;
      for (var j = 0; j < 300 && jourRaidGagne === null; j++) {
        if (P.h01(seed, fA.id, fB.id, 'raid', j) < 0.5) jourRaidGagne = j;
      }
      A.ok(jourRaidGagne !== null, 'un jour de raid gagné existe pour cette graine');

      // raid classique simulé sur un état cloné indépendant (même graine, même point de départ)
      var eRaid = P.charger(JSON.parse(JSON.stringify(P.serialiser(e))));
      var fARaid = eRaid.factions.get(fA.id), fBRaid = eRaid.factions.get(fB.id);
      var terrARaidAvant = fARaid.territoire, terrBRaidAvant = fBRaid.territoire;
      P.appliquerAction(eRaid, fARaid, 'raid', jourRaidGagne);
      var deltaARaid = fARaid.territoire - terrARaidAvant, deltaBRaid = fBRaid.territoire - terrBRaidAvant;
      A.gt(deltaARaid, 0, 'le raid simulé gagne bien du territoire (jour choisi pour réussir)');

      // réussite de la quête d'élimination sur l'état d'origine : reussirQueteElimination
      // reçoit la cible réellement promise par la quête (qs[0].cible), jamais recalculée
      var terrAAvant = fA.territoire, terrBAvant = fB.territoire;
      var cibleId = P.reussirQueteElimination(e, fA.id, qs[0].cible);
      A.equal(cibleId, fB.id);
      var deltaAQuete = fA.territoire - terrAAvant, deltaBQuete = fB.territoire - terrBAvant;

      A.equal(deltaAQuete, deltaARaid, 'gain de territoire de l\'auteur identique à un raid gagné');
      A.equal(deltaBQuete, deltaBRaid, 'perte de territoire de la cible identique à un raid gagné');
      A.equal(P.relationEntre(e, fA.id, fB.id), P.relationEntre(eRaid, fA.id, fB.id), 'même relation finale qu\'un raid gagné');
      A.equal(P.relationEntre(e, fA.id, fB.id), 'guerre');
    });

    it('SPEC-QUETE-002 (régression relecture) : reussirQueteElimination vise toujours la cible promise par questesDe, même résolue un autre jour où ciblePourRaid désignerait une autre faction', function () {
      // 3 factions candidates (guerre + rivalité) pour que ciblePourRaid(etat, f, jour)
      // varie selon le jour — condition nécessaire pour exercer la dérive jour->cible.
      var seed = 1;
      function factionTest(id, nom, objectif, objectifs) {
        return { id: id, type: 'ordre', nom: nom, caractere: 'pragmatique',
                 siege: { x: 0, z: 0, site: id }, territoire: 100,
                 ressources: { or: 50, nourriture: 50 }, objectif: objectif, objectifs: objectifs,
                 naissance: 0 };
      }
      var e = P.creer(seed);
      var fA = factionTest('test:A', 'Faction A', 'defendre', ['defendre']);
      var fB = factionTest('test:B', 'Faction B', 'etendre', ['etendre']);
      var fC = factionTest('test:C', 'Faction C', 'etendre', ['etendre']);
      e.factions.set(fA.id, fA); e.factions.set(fB.id, fB); e.factions.set(fC.id, fC);
      e.relations.set(fA.id < fB.id ? fA.id + '~' + fB.id : fB.id + '~' + fA.id, 'guerre');
      e.relations.set(fA.id < fC.id ? fA.id + '~' + fC.id : fC.id + '~' + fA.id, 'rivalite');

      // jour de proposition : cible annoncée au joueur
      e.jour = 8;
      var qs = P.questesDe(e, fA.id);
      A.equal(qs.length, 1, 'une quête d\'élimination se propose (guerre active avec B)');
      var cibleAnnoncee = qs[0].cible;

      // vérifie qu'un jour de résolution différent ferait dériver ciblePourRaid vers une autre
      // faction que celle annoncée (sinon ce test n'exercerait pas le cas régressé)
      var jourResolutionDerive = null;
      for (var j = 0; j < 300 && jourResolutionDerive === null; j++) {
        var c = P.ciblePourRaid(e, fA, j);
        if (c && c.id !== cibleAnnoncee) jourResolutionDerive = j;
      }
      A.ok(jourResolutionDerive !== null, 'un jour où ciblePourRaid dérive vers une autre faction existe (sinon le test ne couvre rien)');

      // résolue à ce jour dérivant, la quête doit quand même viser la faction annoncée
      var terrAvantAnnoncee = e.factions.get(cibleAnnoncee).territoire;
      var autreCandidat = cibleAnnoncee === fB.id ? fC.id : fB.id;
      var terrAvantAutre = e.factions.get(autreCandidat).territoire;
      var res = P.reussirQueteElimination(e, fA.id, cibleAnnoncee);
      A.equal(res, cibleAnnoncee, 'la réussite vise la cible promise à la proposition, pas celle du jour de résolution');
      A.equal(e.factions.get(cibleAnnoncee).territoire, terrAvantAnnoncee - 15, 'la cible promise perd bien du territoire');
      A.equal(e.factions.get(autreCandidat).territoire, terrAvantAutre, 'l\'autre candidate (celle que viserait le jour de résolution) est intacte');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
