/* spec-succes.js — tests de la spec SPEC-SUCCES-001. Des succès récompensent
   des étapes de la partie : ils s'annoncent une fois, se sauvegardent, se
   listent dans un panneau. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, S = MC.Succes;
  var I = C.I;

  describe('Specs — succès', function () {
    it('SPEC-SUCCES-001 : au moins seize succès variés, tous couverts par la liste', function () {
      A.equal(S.total(), Object.keys(S.LISTE).length, 'total() = nombre d\'entrées de LISTE');
      A.gt(S.total(), 15, 'au moins seize succès : ' + S.total());
      Object.keys(S.LISTE).forEach(function (id) {
        var def = S.LISTE[id];
        A.ok(def.nom && def.description, id + ' a un nom et une description');
        A.ok(def.evenement && def.seuil > 0, id + ' a un événement et un seuil');
      });
    });

    it('SPEC-SUCCES-001 : un premier bloc cassé débloque le tout premier succès', function () {
      var suivi = S.creer();
      A.equal(suivi.debloques().length, 0, 'rien au départ');
      var nouveaux = suivi.signaler({ type: 'casser', bloc: C.B.STONE });
      A.equal(nouveaux.length, 1, 'un succès débloqué');
      A.equal(nouveaux[0].id, 'premier_bloc', nouveaux[0].nom);
      A.ok(suivi.estDebloque('premier_bloc'), 'estDebloque le confirme');
    });

    it('SPEC-SUCCES-001 : un succès ne s\'annonce qu\'une seule fois', function () {
      var suivi = S.creer();
      suivi.signaler({ type: 'casser', bloc: C.B.DIRT });
      A.ok(suivi.estDebloque('premier_bloc'), 'débloqué la première fois');
      var re = suivi.signaler({ type: 'casser', bloc: C.B.STONE });
      A.equal(re.length, 0, 'aucune nouvelle annonce au deuxième événement du même type');
      A.equal(suivi.debloques().length, 1, 'toujours débloqué une seule fois');
    });

    it('SPEC-SUCCES-001 : premier bois — seul un tronc compte, pas la pierre', function () {
      var suivi = S.creer();
      var r1 = suivi.signaler({ type: 'casser', bloc: C.B.STONE });
      A.notOk(r1.some(function (s) { return s.id === 'premier_bois'; }), 'la pierre ne débloque pas le bois');
      var r2 = suivi.signaler({ type: 'casser', bloc: C.B.LOG });
      A.ok(r2.some(function (s) { return s.id === 'premier_bois'; }), 'un tronc débloque « premier bois »');
      var suivi2 = S.creer();
      var r3 = suivi2.signaler({ type: 'casser', bloc: C.B.SPRUCE_LOG });
      A.ok(r3.some(function (s) { return s.id === 'premier_bois'; }), 'un tronc de sapin compte aussi');
    });

    it('SPEC-SUCCES-001 : premier outil, puis la pioche en diamant spécifiquement', function () {
      var suivi = S.creer();
      var r1 = suivi.signaler({ type: 'fabriquer', id: I.WOOD_PICKAXE });
      A.ok(r1.some(function (s) { return s.id === 'premier_outil'; }), 'une pioche en bois : premier outil');
      A.notOk(r1.some(function (s) { return s.id === 'pioche_diamant'; }), 'mais pas la pioche en diamant');
      var r2 = suivi.signaler({ type: 'fabriquer', id: I.DIAMOND_PICKAXE });
      A.ok(r2.some(function (s) { return s.id === 'pioche_diamant'; }), 'la pioche en diamant se débloque à son tour');
      A.notOk(r2.some(function (s) { return s.id === 'premier_outil'; }), 'premier outil déjà acquis : pas réannoncé');
    });

    it('SPEC-SUCCES-001 : un seuil se vérifie — 9 hostiles ne suffisent pas, 10 débloquent', function () {
      var suivi = S.creer();
      for (var i = 0; i < 9; i++) suivi.signaler({ type: 'tuer', mob: 'zombie' });
      A.notOk(suivi.estDebloque('dix_hostiles'), '9 créatures : pas encore');
      var nouveaux = suivi.signaler({ type: 'tuer', mob: 'zombie' });
      A.ok(nouveaux.some(function (s) { return s.id === 'dix_hostiles'; }), 'la dixième débloque le succès');
      // un mob non hostile ne compte pas
      var suivi2 = S.creer();
      for (var j = 0; j < 12; j++) suivi2.signaler({ type: 'tuer', mob: 'vache' });
      A.notOk(suivi2.estDebloque('dix_hostiles'), 'une vache n\'est pas hostile');
    });

    it('SPEC-SUCCES-001 : premier et troisième gardien, ville et village, nuit, altitude, distance', function () {
      var suivi = S.creer();
      var b1 = suivi.signaler({ type: 'boss', donjon: 'crypte' });
      A.ok(b1.some(function (s) { return s.id === 'premier_gardien'; }), 'premier gardien vaincu');
      suivi.signaler({ type: 'boss', donjon: 'mine' });
      var b3 = suivi.signaler({ type: 'boss', donjon: 'temple' });
      A.ok(b3.some(function (s) { return s.id === 'trois_gardiens'; }), 'trois gardiens vaincus');

      var suivi2 = S.creer();
      A.equal(suivi2.signaler({ type: 'lieu', kind: 'maison' }).length, 0, 'une maison isolée ne compte ni ville ni village');
      A.ok(suivi2.signaler({ type: 'lieu', kind: 'ville' }).some(function (s) { return s.id === 'premiere_ville'; }), 'première ville');
      A.ok(suivi2.signaler({ type: 'lieu', kind: 'village' }).some(function (s) { return s.id === 'premier_village'; }), 'premier village');

      var suivi3 = S.creer();
      A.ok(suivi3.signaler({ type: 'nuit' }).some(function (s) { return s.id === 'nuit_survecue'; }), 'nuit survécue');

      var suivi4 = S.creer();
      A.equal(suivi4.signaler({ type: 'altitude', y: 80 }).length, 0, '80 blocs : trop bas');
      A.ok(suivi4.signaler({ type: 'altitude', y: 120 }).some(function (s) { return s.id === 'haute_altitude'; }), 'au-dessus de 100 blocs');

      var suivi5 = S.creer();
      suivi5.signaler({ type: 'distance', blocs: 2000 });
      A.notOk(suivi5.estDebloque('cinq_mille_blocs'), '2000 blocs : pas encore');
      suivi5.signaler({ type: 'distance', blocs: 3200 });
      A.ok(suivi5.estDebloque('cinq_mille_blocs'), '5200 blocs cumulés : débloqué');
    });

    it('SPEC-SUCCES-001 : véhicule, banque, histoire, échange, foudre, repas répétés', function () {
      var suivi = S.creer();
      A.ok(suivi.signaler({ type: 'vehicule', vehicule: 'radeau' }).some(function (s) { return s.id === 'premier_vehicule'; }));
      A.ok(suivi.signaler({ type: 'banque' }).some(function (s) { return s.id === 'banque_ouverte'; }));
      A.equal(suivi.signaler({ type: 'histoire', fin: null }).length, 0, 'une histoire non achevée ne compte pas');
      A.ok(suivi.signaler({ type: 'histoire', fin: 'bonne_fin' }).some(function (s) { return s.id === 'histoire_achevee'; }));
      A.ok(suivi.signaler({ type: 'echange' }).some(function (s) { return s.id === 'premier_echange'; }));
      A.ok(suivi.signaler({ type: 'foudre' }).some(function (s) { return s.id === 'foudroye_vivant'; }));
      for (var i = 0; i < 19; i++) suivi.signaler({ type: 'manger', id: I.APPLE });
      A.notOk(suivi.estDebloque('vingt_repas'), '19 repas : pas encore');
      A.ok(suivi.signaler({ type: 'manger', id: I.APPLE }).some(function (s) { return s.id === 'vingt_repas'; }), 'le vingtième repas débloque');
    });

    it('SPEC-SUCCES-001 : les types d\'événements inconnus sont ignorés proprement', function () {
      var suivi = S.creer();
      A.deep(suivi.signaler({ type: 'danser' }), [], 'un type inconnu ne débloque rien');
      A.deep(suivi.signaler(null), [], 'un événement absent ne fait pas planter');
      A.deep(suivi.signaler({}), [], 'un événement sans type non plus');
      A.equal(suivi.debloques().length, 0, 'toujours rien de débloqué');
    });

    it('SPEC-SUCCES-001 : progression() reflète compteurs et seuils avant et après déblocage', function () {
      var suivi = S.creer();
      var p0 = suivi.progression();
      A.equal(p0.length, S.total(), 'une ligne par succès');
      var ligne0 = p0.filter(function (l) { return l.id === 'dix_hostiles'; })[0];
      A.equal(ligne0.compte, 0, 'rien au départ');
      A.notOk(ligne0.fait, 'pas encore fait');
      for (var i = 0; i < 5; i++) suivi.signaler({ type: 'tuer', mob: 'zombie' });
      var ligne1 = suivi.progression().filter(function (l) { return l.id === 'dix_hostiles'; })[0];
      A.equal(ligne1.compte, 5, 'cinq comptées');
      A.equal(ligne1.seuil, 10, 'seuil inchangé');
      A.notOk(ligne1.fait, 'toujours pas fait');
      for (var j = 0; j < 5; j++) suivi.signaler({ type: 'tuer', mob: 'zombie' });
      var ligne2 = suivi.progression().filter(function (l) { return l.id === 'dix_hostiles'; })[0];
      A.ok(ligne2.fait, 'fait à dix');
      A.equal(ligne2.compte, 10, 'plafonné au seuil');
    });

    it('SPEC-SUCCES-001 : serialiser/charger conservent débloqués et compteurs, y compris via JSON', function () {
      var suivi = S.creer();
      suivi.signaler({ type: 'casser', bloc: C.B.STONE });
      for (var i = 0; i < 4; i++) suivi.signaler({ type: 'tuer', mob: 'zombie' });
      var sauvegarde = suivi.serialiser();
      A.ok(sauvegarde.compte && sauvegarde.debloques, 'un objet JSON avec compte et débloqués');
      A.ok(sauvegarde.debloques.indexOf('premier_bloc') >= 0, 'premier_bloc listé');

      // aller-retour direct
      var repris = S.creer();
      repris.charger(sauvegarde);
      A.ok(repris.estDebloque('premier_bloc'), 'toujours débloqué après charger');
      A.deep(repris.debloques(), suivi.debloques(), 'le même ordre de déblocage');
      A.equal(repris.progression().filter(function (l) { return l.id === 'dix_hostiles'; })[0].compte, 4, 'le compteur des hostiles a repris à 4');
      var suite = repris.signaler({ type: 'tuer', mob: 'zombie' });
      for (var k = 0; k < 5; k++) suite = repris.signaler({ type: 'tuer', mob: 'zombie' });
      A.ok(repris.estDebloque('dix_hostiles'), 'le compteur repris continue bien à progresser');

      // aller-retour via JSON.stringify / JSON.parse, comme une vraie sauvegarde
      var texte = JSON.stringify(suivi.serialiser());
      var repris2 = S.creer();
      repris2.charger(JSON.parse(texte));
      A.ok(repris2.estDebloque('premier_bloc'), 'JSON : premier_bloc conservé');
      A.equal(repris2.debloques().length, suivi.debloques().length, 'JSON : même nombre de succès');

      // charger tolère des données absentes ou partielles
      var vide = S.creer();
      vide.charger(undefined);
      A.deep(vide.debloques(), [], 'charger(undefined) ne plante pas et ne débloque rien');
      vide.charger({});
      A.deep(vide.debloques(), [], 'charger({}) non plus');
      vide.charger({ debloques: ['premier_bloc', 'id_inconnu'] });
      A.deep(vide.debloques(), ['premier_bloc'], 'un id inconnu dans debloques est ignoré');
      vide.charger({ compte: 'pas un objet', debloques: null });
      A.deep(vide.debloques(), [], 'des champs du mauvais type sont ignorés sans planter');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
