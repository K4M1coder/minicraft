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
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
