/* spec-politique.js — SPEC-FACTION-006 à 008 : factions PNJ autonomes. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var P = MC.Politique, Dj = MC.Donjons, Z = MC.Zones, Eco = MC.Economie, Ent = MC.EntitySpecs, C2 = MC.Core;

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

  // ─── L46 : factions, quêtes, donjons interconnectés ────────────────────
  function factionSimple(id, x, z, territoire) {
    return { id: id, type: 'ordre', nom: 'Faction ' + id, caractere: 'pragmatique',
             siege: { x: x, z: z, site: id }, territoire: territoire,
             ressources: { or: 50, nourriture: 50 }, objectif: 'defendre', objectifs: ['defendre'],
             naissance: 0 };
  }
  describe('Specs — L46 (factions, quêtes, donjons interconnectés)', function () {
    it('SPEC-FACTION-014 : le territoire d\'une faction influence la zone, sans écraser une redéfinition admin', function () {
      var e = P.creer(1);
      var fGuerre = factionSimple('f:guerre', 0, 0, 300), fRival = factionSimple('f:rival', 5000, 5000, 300);
      var fPaix = factionSimple('f:paix', 1000, 1000, 300);
      e.factions.set(fGuerre.id, fGuerre); e.factions.set(fRival.id, fRival); e.factions.set(fPaix.id, fPaix);
      var cleG = fGuerre.id < fRival.id ? fGuerre.id + '~' + fRival.id : fRival.id + '~' + fGuerre.id;
      e.relations.set(cleG, 'guerre');
      A.equal(P.influenceZone(e, 0, 0), 'pvp', 'territoire consolidé en guerre : zone dangereuse (pvp)');
      A.equal(P.influenceZone(e, 1000, 1000), 'sure', 'territoire consolidé en paix stable : zone sûre');
      A.equal(P.influenceZone(e, 999999, 999999), null, 'hors de tout territoire : aucune influence');
      A.equal(P.factionCouvrant(e, 0, 0).id, fGuerre.id, 'factionCouvrant désigne la faction dont le territoire couvre le point');
      A.equal(P.factionCouvrant(e, 999999, 999999), null, 'null hors de tout territoire');
      A.equal(P.enGuerreActive(e, fGuerre.id), true, 'enGuerreActive : vrai pour une faction en guerre active');
      A.equal(P.enGuerreActive(e, fPaix.id), false, 'enGuerreActive : faux pour une faction en paix');

      // via zones.js:zoneEn, avec priorité à une redéfinition d'administrateur
      var carte = { classeBase: function () { return 'pvp_pve'; } };
      var etatZ = Z.creerEtat({});
      A.equal(Z.zoneEn(carte, etatZ, 0, 0, e).zone, 'pvp', 'zoneEn applique l\'influence politique');
      Z.definirRegion(etatZ, 0, 0, 'sure', 'admin', 10);
      A.equal(Z.zoneEn(carte, etatZ, 0, 0, e).zone, 'sure', 'une redéfinition admin prime toujours sur l\'influence politique');
      A.ok(Z.zoneEn(carte, etatZ, 0, 0, e).redefinie, 'toujours marquée redéfinie');
    });

    it('SPEC-FACTION-015 : une faction en guerre ferme son commerce à un membre ennemi, rouvert après la paix', function () {
      var e = P.creer(1);
      var fA = factionSimple('f:A', 0, 0, 100), fB = factionSimple('f:B', 10, 10, 100);
      e.factions.set(fA.id, fA); e.factions.set(fB.id, fB);
      var offres = [{ give: [], get: [] }];
      A.deep(P.offresAutorisees(e, fA.id, fB.id, offres), offres, 'en paix/neutre, le commerce reste ouvert');
      e.relations.set(fA.id + '~' + fB.id, 'guerre');
      A.equal(P.commerceFermeAvec(e, fA.id, fB.id), true, 'guerre : le commerce est fermé');
      A.deep(P.offresAutorisees(e, fA.id, fB.id, offres), [], 'aucune offre pour un membre ennemi en guerre');
      e.relations.set(fA.id + '~' + fB.id, 'neutre');
      A.deep(P.offresAutorisees(e, fA.id, fB.id, offres), offres, 'rouvert après un changement de relation vers neutre');
    });

    it('SPEC-FACTION-015 (câblage réel) : MC.Economie.executerTroc refuse RÉELLEMENT le commerce d\'un marchand couvert par une faction en guerre', function () {
      // Reproduit exactement la composition de server.js (case NP.MSG.TROC) :
      // embargo = factionCouvrant(politique, pos) + commerceFermeAvec(...),
      // combinée dans le ctx.embargo réel d'executerTroc — jamais un appel
      // direct isolé à commerceFermeAvec.
      var e = P.creer(4);
      var posPnj = { x: 500, z: 500 };
      var fLieu = factionSimple('f:lieu', posPnj.x, posPnj.z, 200);
      var fJoueur = factionSimple('f:joueur-allie', 9000, 9000, 50);   // faction de joueurs vue côté politique
      e.factions.set(fLieu.id, fLieu); e.factions.set(fJoueur.id, fJoueur);
      var eco = Eco.creerEtat(4);
      var inv = MC.Inventory.create(9);
      function tenter() {
        var factionCouvrante = P.factionCouvrant(e, posPnj.x, posPnj.z);
        var embargo = !!(factionCouvrante && P.commerceFermeAvec(e, factionCouvrante.id, fJoueur.id));
        return Eco.executerTroc(eco, inv, { lieuId: 'v:test', role: 'marchand', pnjId: 'pnj1', indice: 0, fois: 1, nom: 'Joueur', embargo: embargo });
      }
      var cleRel = fLieu.id < fJoueur.id ? fLieu.id + '~' + fJoueur.id : fJoueur.id + '~' + fLieu.id;
      var avantGuerre = tenter();
      A.notEqual(avantGuerre.motif, 'embargo', 'en paix, executerTroc ne refuse pas pour motif embargo');
      e.relations.set(cleRel, 'guerre');
      var pendantGuerre = tenter();
      A.equal(pendantGuerre.ok, false, 'SPEC-FACTION-015 : executerTroc refuse RÉELLEMENT le commerce pendant la guerre');
      A.equal(pendantGuerre.motif, 'embargo', 'motif embargo, comme FACTION-003/SPEC-PVP-006');
      e.relations.set(cleRel, 'neutre');
      var apresPaix = tenter();
      A.notEqual(apresPaix.motif, 'embargo', 'SPEC-FACTION-015 : rouvert après un changement de relation vers neutre');
    });

    it('SPEC-DONJON-018 (câblage réel) : un VRAI gardien vaincu (entites.js, événement boss_vaincu) profite à la faction de son territoire', function () {
      // Reproduit exactement la composition de server.js (entites.evenements()
      // après entites.update()) : un gardien RÉELLEMENT tué (pas un appel
      // direct à victoireGardien) émet l'événement, dont `donjon` désigne le
      // vrai objet donjon à passer à MC.Donjons.victoireGardien.
      var w = G.flatWorld(10, C2.B.STONE);
      var ents = MC.createEntities(w);
      var donjonFictif = { id: '7,7', x: 20, z: -10 };
      var g = ents.spawn('boss_zombie', 0.5, 11, 0.5, { donjon: donjonFictif.id });
      A.ok(ents.damage(g, 999, { x: 0, y: 11, z: 0 }), 'le coup est fatal (vraie mort, pas un appel isolé)');
      var evts = ents.evenements().filter(function (x) { return x.type === 'boss_vaincu'; });
      A.equal(evts.length, 1, 'un véritable événement boss_vaincu est émis par entites.js');
      A.equal(evts[0].donjon, donjonFictif.id, 'il désigne le vrai donjon du gardien');

      var e = P.creer(5);
      var f = factionSimple('f:proprio', donjonFictif.x, donjonFictif.z, 150);
      e.factions.set(f.id, f);
      var terrAvant = f.territoire;
      var r = Dj.victoireGardien(donjonFictif, e);   // exactement l'appel que fait server.js sur cet événement RÉEL
      A.ok(r, 'la victoire réelle profite à la faction du territoire');
      A.equal(f.territoire, terrAvant + 10, 'même gain qu\'un avant-poste, déclenché par un VRAI événement de jeu');
    });

    it('SPEC-DONJON-018 : un donjon dans le territoire d\'une faction lui est rattaché ; sa conquête l\'enrichit ou profite à un revendicant en guerre', function () {
      var e = P.creer(2);
      var fA = factionSimple('f:A', 0, 0, 200);
      e.factions.set(fA.id, fA);
      var donjon = { id: '0,0', x: 20, z: -10 };
      A.equal(Dj.factionDuTerritoire(donjon, e), fA.id, 'le donjon est rattaché à la faction dont le territoire le couvre');
      A.equal(Dj.factionDuTerritoire({ id: 'loin', x: 99999, z: 99999 }, e), null, 'hors de tout territoire : pas de rattachement');

      // appliquerGainAvantPoste, directement : le même calcul que victoireGardien réutilise
      var fTest = factionSimple('f:test-avp', 0, 0, 100);
      P.appliquerGainAvantPoste(fTest);
      A.equal(fTest.territoire, 110, 'appliquerGainAvantPoste ajoute 10, plafonné à TERRITOIRE_MAX');

      // cas normal : le propriétaire encaisse le même gain qu'un avant-poste réussi
      var terrAvant = fA.territoire, orAvant = fA.ressources.or;
      var r = Dj.victoireGardien(donjon, e);
      A.equal(r.faction, fA.id);
      A.notOk(r.revendique);
      A.equal(fA.territoire, Math.min(400, terrAvant + 10), 'même gain de territoire qu\'un avant-poste (FACTION-016)');
      A.gt(fA.ressources.or, orAvant, 'des ressources en plus');

      // cas revendication : une faction en guerre pour ce territoire s'en empare, comme un raid gagné
      var fR = factionSimple('f:rivale', 5000, 5000, 100);
      e.factions.set(fR.id, fR);
      e.relations.set(fA.id + '~' + fR.id, 'guerre');
      var terrAAvant = fA.territoire, terrRAvant = fR.territoire;
      var r2 = Dj.victoireGardien(donjon, e, fR.id);
      A.equal(r2.faction, fR.id, 'le revendicant en guerre récupère la conquête');
      A.ok(r2.revendique);
      A.equal(fR.territoire, terrRAvant + 15, 'même gain qu\'une élimination réussie (appliquerGainElimination)');
      A.equal(fA.territoire, Math.max(20, terrAAvant - 15), 'le propriétaire en perd d\'autant');

      // un revendicant qui n'est PAS en guerre pour ce territoire ne peut rien revendiquer
      var fN = factionSimple('f:neutre', 6000, 6000, 100);
      e.factions.set(fN.id, fN);
      var terrNAvant = fN.territoire;
      var r3 = Dj.victoireGardien(donjon, e, fN.id);
      A.notOk(r3.revendique, 'sans guerre pour ce territoire, pas de revendication');
      A.equal(fN.territoire, terrNAvant, 'la faction neutre ne gagne rien');
    });

    it('SPEC-QUETE-004 : tableau de quêtes actives par joueur, acceptées et remises une seule fois (arbitrage serveur)', function () {
      var tableau = new Map();
      var quete = { id: 'q1', faction: 'f:A', type: 'livrer', ressource: 'or', titre: 'Livraison', recompense: 12 };
      var acc = P.accepterQuete(tableau, 'Alice', quete);
      A.ok(acc.ok, 'la quête est acceptée');
      A.equal(P.quetesActivesDeJoueur(tableau, 'Alice').length, 1, 'apparaît dans le tableau du joueur');
      A.equal(P.quetesActivesDeJoueur(tableau, 'Alice')[0].statut, 'active');
      var accDouble = P.accepterQuete(tableau, 'Alice', quete);
      A.notOk(accDouble.ok, 'une même quête ne s\'accepte pas deux fois');
      A.equal(accDouble.motif, 'deja_acceptee');

      var rem1 = P.remettreQuete(tableau, 'Alice', 'q1', 20);
      A.ok(rem1.ok, 'la remise réussit');
      A.equal(rem1.quete.statut, 'remise');
      A.equal(rem1.quete.recompenseVersee, 20);
      // double remise (deux clients, ou un double clic) : le second échoue toujours
      var rem2 = P.remettreQuete(tableau, 'Alice', 'q1', 20);
      A.notOk(rem2.ok, 'la seconde remise échoue : jamais versée deux fois');
      A.equal(rem2.motif, 'introuvable');

      // persistance : sérialisation/rechargement identiques
      var data = P.serialiserQuetes(tableau);
      var recharge = P.chargerQuetes(data);
      A.deep(P.quetesActivesDeJoueur(recharge, 'Alice'), P.quetesActivesDeJoueur(tableau, 'Alice'), 'le rechargement reproduit le tableau');
    });

    it('SPEC-QUETE-005 : la récompense d\'une quête se calcule sur le coût réel de l\'objectif, jamais la formule arbitraire d\'origine', function () {
      var e = P.creer(3);
      var fCible = factionSimple('f:cible', 0, 0, 200);
      e.factions.set(fCible.id, fCible);
      var queteElim = { id: 'qe', type: 'eliminer', cible: fCible.id, recompense: 999 };
      var reelle = P.recompenseReelle(e, queteElim, {});
      A.equal(reelle, Math.round(fCible.territoire * 0.5), 'élimination : proportionnelle au territoire réel de la cible');
      A.notEqual(reelle, 999, 'jamais l\'estimation arbitraire d\'origine');

      var queteReconstruction = { id: 'qr', type: 'reconstruction', degats: 40, recompense: 999 };
      var reelle2 = P.recompenseReelle(e, queteReconstruction, {});
      A.equal(reelle2, Math.round(40 * 0.5), 'reconstruction : proportionnelle aux dégâts mesurés');

      // reproductible par graine : même donnée, même résultat
      var reelle3 = P.recompenseReelle(e, queteElim, {});
      A.equal(reelle3, reelle, 'reproductible à état égal');

      // repli : type inconnu / rien de mieux à calculer -> estimation d'origine conservée
      var queteInconnue = { id: 'qi', type: 'mystere', recompense: 7 };
      A.equal(P.recompenseReelle(e, queteInconnue, {}), 7);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
