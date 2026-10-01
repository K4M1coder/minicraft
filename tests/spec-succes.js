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

    /* SPEC-ARCHI-042 : le suivi par position/heure, désormais appelé par le
       SERVEUR à chaque tic avec la position qui fait foi. */
    function marcher(suiveur, secondes, vitesse, opts) {
      opts = opts || {};
      var evts = [], x = opts.x0 || 0, dt = 0.05;
      for (var i = 0; i < Math.round(secondes / dt); i++) {
        x += vitesse * dt;
        suiveur.tic(dt, { x: x, y: opts.y === undefined ? 64 : opts.y, z: 0 }, opts.vivant !== false, !!opts.nuit)
          .forEach(function (e) { evts.push(e); });
      }
      return evts;
    }
    function somme(evts, type, champ) {
      return evts.filter(function (e) { return e.type === type; }).reduce(function (a, e) { return a + e[champ]; }, 0);
    }

    it('SPEC-ARCHI-042 : distance — l\'intégrale des positions échantillonnée à 1 Hz, à une seconde de marche près', function () {
      var evts = marcher(S.creerSuiveur(), 10, 6);                 // 60 blocs en 10 s
      var d = somme(evts, 'distance', 'blocs');
      A.ok(d <= 60.01 && d >= 60 - 6 - 0.01, 'distance rapportée ' + d.toFixed(2) + ' pour 60 blocs parcourus (≤ 1 s de retard)');
      A.equal(evts.filter(function (e) { return e.type === 'altitude'; }).length, 10, 'un échantillon d\'altitude par seconde de jeu');
      var suivi = S.creer();
      evts.forEach(function (e) { suivi.signaler(e); });
      A.ok(Math.abs(suivi.progression().filter(function (l) { return l.id === 'cinq_mille_blocs'; })[0].compte - 60) <= 6.01,
        'le compteur « Grand voyageur » suit la marche');
    });

    it('SPEC-ARCHI-042 : un bond de 20 blocs ou plus (renaissance, téléportation) n\'est pas du chemin parcouru ; un mort ne parcourt rien', function () {
      var sv = S.creerSuiveur(), evts = [];
      sv.tic(0.05, { x: 0, y: 64, z: 0 }, true, false);
      sv.tic(0.05, { x: 500, y: 64, z: 0 }, true, false);                           // bond
      evts = evts.concat(sv.tic(1.1, { x: 500.5, y: 64, z: 0 }, true, false));
      A.ok(somme(evts, 'distance', 'blocs') <= 0.51, 'seuls les 0,5 bloc suivants comptent');
      var mort = marcher(S.creerSuiveur(), 5, 6, { vivant: false });
      A.equal(somme(mort, 'distance', 'blocs'), 0, 'un joueur mort ne cumule aucune distance');
    });

    /* Fait vivre un suiveur `n` secondes (pas de 1 s) dans l'état donné et rend les types d'événements. */
    function vivre(sv, n, estNuit, opts) {
      opts = opts || {};
      var types = [];
      for (var i = 0; i < n; i++)
        sv.tic(1, { x: 0, y: 64, z: 0 }, opts.vivant !== false, estNuit, !!opts.dort).forEach(function (e) { types.push(e.type); });
      return types;
    }
    it('SPEC-ARCHI-042 : nuit survécue — vue tomber, vécue éveillé assez longtemps, vivant au lever du jour', function () {
      var sv = S.creerSuiveur();
      vivre(sv, 5, false);
      vivre(sv, S.NUIT_MIN_S + 10, true);
      A.ok(vivre(sv, 1, false).indexOf('nuit') >= 0, 'le jour se lève sur un vivant qui a veillé : « nuit survécue »');
      A.ok(vivre(sv, 1, false).indexOf('nuit') < 0, 'une seule fois par nuit');
    });

    it('SPEC-ARCHI-042 : nuit survécue — rejoindre en pleine nuit, dormir, mourir ou une nuit trop courte n\'en rapportent pas', function () {
      var rejoint = S.creerSuiveur();                                  // le suiveur est neuf à chaque connexion
      vivre(rejoint, S.NUIT_MIN_S + 30, true);
      A.ok(vivre(rejoint, 1, false).indexOf('nuit') < 0, 'connecté en pleine nuit : le début n\'a pas été vu');
      var dormeur = S.creerSuiveur();
      vivre(dormeur, 3, false); vivre(dormeur, S.NUIT_MIN_S + 30, true, { dort: true });
      A.ok(vivre(dormeur, 1, false).indexOf('nuit') < 0, 'la nuit passée à dormir ne compte pas');
      var court = S.creerSuiveur();
      vivre(court, 3, false); vivre(court, 5, true);
      A.ok(vivre(court, 1, false).indexOf('nuit') < 0, 'trente secondes avant l\'aube ne suffisent pas');
      var mort = S.creerSuiveur();
      vivre(mort, 3, false); vivre(mort, S.NUIT_MIN_S + 30, true);
      A.ok(vivre(mort, 1, false, { vivant: false }).indexOf('nuit') < 0, 'le jour se lève sur un mort : rien');
      var renaitre = S.creerSuiveur();
      vivre(renaitre, 3, false); vivre(renaitre, S.NUIT_MIN_S + 30, true); vivre(renaitre, 1, true, { vivant: false });
      vivre(renaitre, 5, true);
      A.ok(vivre(renaitre, 1, false).indexOf('nuit') < 0, 'mort puis réapparu dans la nuit : la veille est à refaire');
    });

    it('SPEC-ARCHI-042 : une renaissance même proche (< 20 blocs) n\'est pas du chemin parcouru', function () {
      var sv = S.creerSuiveur(), blocs = 0;
      var tic = function (x, vivant) { sv.tic(0.05, { x: x, y: 64, z: 0 }, vivant, false).forEach(function (e) { if (e.type === 'distance') blocs += e.blocs; }); };
      tic(0, true); tic(0, false);                          // mort sur place
      tic(15, true);                                        // renaissance à 15 blocs de là
      sv.tic(1.1, { x: 15.5, y: 64, z: 0 }, true, false).forEach(function (e) { if (e.type === 'distance') blocs += e.blocs; });
      A.ok(blocs <= 0.51, 'seuls les 0,5 bloc marchés après la renaissance comptent (' + blocs.toFixed(2) + ')');
    });

    it('SPEC-ARCHI-042 : un identifiant venu du dehors n\'est un succès que s\'il est dans la liste (« constructor », « toString »…)', function () {
      var suivi = S.creer();
      suivi.charger({ debloques: ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'premier_bloc'], compte: { constructor: 5 } });
      A.deep(suivi.debloques(), ['premier_bloc'], 'seul le vrai succès est repris');
      A.ok(!S.existe('constructor') && !S.existe('toString') && S.existe('premier_bloc'), 'existe() ne regarde pas la chaîne de prototypes');
      A.equal(suivi.progression().length, S.total(), 'la progression n\'a pas grossi');
    });

    it('SPEC-ARCHI-042 : altitude — l\'échantillon porte la hauteur du serveur et débloque « Prise d\'altitude » au-dessus de 100', function () {
      var suivi = S.creer();
      marcher(S.creerSuiveur(), 3, 0, { y: 90 }).forEach(function (e) { suivi.signaler(e); });
      A.ok(!suivi.estDebloque('haute_altitude'), 'à 90 : rien');
      marcher(S.creerSuiveur(), 3, 0, { y: 101 }).forEach(function (e) { suivi.signaler(e); });
      A.ok(suivi.estDebloque('haute_altitude'), 'à 101 : débloqué');
    });

    it('SPEC-ARCHI-042 : revision() n\'augmente que lorsque les compteurs ou les déblocages changent (le serveur n\'envoie rien sinon)', function () {
      var suivi = S.creer(), r0 = suivi.revision();
      suivi.signaler({ type: 'altitude', y: 10 });                 // filtre non satisfait : rien ne change
      suivi.signaler({ type: 'inconnu' });
      A.equal(suivi.revision(), r0, 'événement sans effet : même révision');
      suivi.signaler({ type: 'casser', bloc: C.B.STONE });
      var r1 = suivi.revision();
      A.gt(r1, r0, 'un déblocage change la révision');
      suivi.signaler({ type: 'casser', bloc: C.B.STONE });
      A.equal(suivi.revision(), r1, 'un succès déjà obtenu ne change plus rien');
      suivi.signaler({ type: 'manger', id: I.BREAD });
      A.gt(suivi.revision(), r1, 'un compteur qui avance change la révision');
      var r2 = suivi.revision();
      suivi.charger(suivi.serialiser());
      A.gt(suivi.revision(), r2, 'un rechargement change la révision');
    });

    it('SPEC-SUCCES-001 : le suivi d\'une partie survit à la sauvegarde (MC.Save)', function () {
      var etat = G.etatMinimal(2026);
      etat.succes = S.creer();
      etat.succes.signaler({ type: 'casser', bloc: C.B.STONE });
      for (var i = 0; i < 4; i++) etat.succes.signaler({ type: 'tuer', mob: 'zombie' });

      var mem = {}, st = { getItem: function (k) { return mem[k] || null; }, setItem: function (k, v) { mem[k] = v; },
                           removeItem: function (k) { delete mem[k]; } };
      A.ok(MC.Save.save(st, etat), 'sauvegardé');

      // une nouvelle partie, avant chargement : suivi vierge
      etat.succes = S.creer();
      A.equal(etat.succes.debloques().length, 0, 'vierge avant chargement');

      A.ok(MC.Save.load(st, etat), 'rechargé');
      A.ok(etat.succes.estDebloque('premier_bloc'), 'premier_bloc revient de la sauvegarde');
      A.equal(etat.succes.progression().filter(function (l) { return l.id === 'dix_hostiles'; })[0].compte, 4,
        'le compteur des hostiles est revenu à 4');

      // une sauvegarde d'avant ce module (pas de champ succes) ne fait pas planter le chargement
      var brut = JSON.parse(mem[MC.Save.KEY]);
      delete brut.succes;
      mem[MC.Save.KEY] = JSON.stringify(brut);
      etat.succes = S.creer();
      A.ok(MC.Save.load(st, etat), 'chargement toléré sans le champ succes');
      A.deep(etat.succes.debloques(), [], 'suivi resté vierge, sans planter');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
