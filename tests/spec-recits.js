/* spec-recits.js — tests des specs SPEC-HISTOIRE-011 à 013 : les récits
   procéduraux (enquête, colonie), et la bascule vers l'épopée existante. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, R = MC.Recits;
  var B = C.B, I = C.I;

  // ─── lieux factices : un village, une ville, chacun avec ses habitants ────
  function lieuxFactices() {
    var village = {
      id: 'village:0,0', kind: 'village', nom: 'Hameau-Clair', x: 0, z: 0, h0: 64,
      batiments: [
        { type: 'banque', nom: 'Banque', lieu: 'village:0,0', x0: -10, z0: -10, x1: -4, z1: -4 },
        { type: 'ferme', nom: 'Ferme', lieu: 'village:0,0', x0: 4, z0: 4, x1: 12, z1: 12 },
      ],
      pnjs: [
        { id: 'village:0,0#0', role: 'habitant', nom: 'Adèle', x: 1, y: 65, z: 1, lieu: 'village:0,0' },
        { id: 'village:0,0#1', role: 'guide', nom: 'Bastien', x: 2, y: 65, z: 1, lieu: 'village:0,0' },
        { id: 'village:0,0#2', role: 'banquier', nom: 'Camille', x: -6, y: 65, z: -6, lieu: 'village:0,0' },
        { id: 'village:0,0#3', role: 'aubergiste', nom: 'Denis', x: 3, y: 65, z: 1, lieu: 'village:0,0' },
        { id: 'village:0,0#4', role: 'fermier', nom: 'Élise', x: 8, y: 65, z: 8, lieu: 'village:0,0' },
        { id: 'village:0,0#5', role: 'marchand', nom: 'Fabien', x: 4, y: 65, z: 1, lieu: 'village:0,0' },
      ],
    };
    var ville = {
      id: 'ville:1,0', kind: 'ville', nom: 'Grandbourg', x: 400, z: 0, h0: 64,
      batiments: [
        { type: 'magasin', nom: 'Magasin', lieu: 'ville:1,0', x0: 396, z0: -4, x1: 404, z1: 2 },
      ],
      pnjs: [
        { id: 'ville:1,0#0', role: 'forgeron', nom: 'Gaëlle', x: 401, y: 65, z: 1, lieu: 'ville:1,0' },
        { id: 'ville:1,0#1', role: 'tisserand', nom: 'Hugo', x: 402, y: 65, z: 1, lieu: 'ville:1,0' },
        { id: 'ville:1,0#2', role: 'menuisier', nom: 'Inès', x: 403, y: 65, z: 1, lieu: 'ville:1,0' },
        { id: 'ville:1,0#3', role: 'animateur', nom: 'Jules', x: 404, y: 65, z: 1, lieu: 'ville:1,0' },
      ],
    };
    return [village, ville];
  }

  // ─── joueur automatique pour l'enquête : révèle des indices choisis par id,
  //     puis accuse un suspect ─────────────────────────────────────────────
  function indiceParId(q, id) { return q.indices.filter(function (ind) { return ind.id === id; })[0]; }
  function revelerIndices(etat, ids) {
    var q = etat.enquete, notifs = [];
    ids.forEach(function (id, k) {
      var ind = indiceParId(q, id);
      if (!ind) return;
      if (ind.type === 'temoignage') {
        notifs = notifs.concat(R.signaler(etat, { type: 'parler', role: 'x', pnj: ind.pnj, lieu: 'ailleurs', t: 1000 + k }));
      } else if (ind.type === 'objet') {
        var oid = ind.objet;
        notifs = notifs.concat(R.signaler(etat, { type: 'inventaire', t: 1000 + k }, { compter: function (id2) { return id2 === oid ? 1 : 0; } }));
      }
    });
    return notifs;
  }
  // témoins et objets, en excluant le second témoin (dépendance de la contradiction)
  // pour garder un compte d'indices maîtrisé, sauf demande explicite du contraire
  function temoinsEtObjets(q, sansSecondTemoin) {
    return q.indices.filter(function (ind) {
      if (ind.type === 'contradiction') return false;
      if (sansSecondTemoin && ind.id === 'temoin1') return false;
      return true;
    }).map(function (ind) { return ind.id; });
  }
  function accuser(etat, suspectId) {
    var q = etat.enquete;
    var ch = R.choixEnAttente(etat);
    A.ok(ch && ch.id === 'accusation', 'un choix d accusation est proposé');
    return R.choisir(etat, ch.id, suspectId);
  }

  describe('Specs — récits procéduraux', function () {
    it('SPEC-HISTOIRE-011 : chaque récit est généré depuis la graine, déterministe et varié', function () {
      var lieux = lieuxFactices();
      var e1 = R.generer('enquete', 424242, lieux, {});
      var e2 = R.generer('enquete', 424242, lieux, {});
      A.equal(e1.enquete.crime, e2.enquete.crime, 'même graine : même crime');
      A.equal(e1.enquete.coupableId, e2.enquete.coupableId, 'même graine : même coupable');
      A.deep(e1.enquete.suspects.map(function (s) { return s.id; }), e2.enquete.suspects.map(function (s) { return s.id; }), 'mêmes suspects');
      A.deep(e1.enquete.indices.map(function (ind) { return ind.id + ':' + (ind.pnj || ind.objet || ''); }),
             e2.enquete.indices.map(function (ind) { return ind.id + ':' + (ind.pnj || ind.objet || ''); }), 'mêmes indices');
      A.equal(e1.enquete.rebondissement, e2.enquete.rebondissement, 'même rebondissement');

      var c1 = R.generer('colonie', 777, lieux, {});
      var c2 = R.generer('colonie', 777, lieux, {});
      A.equal(c1.colonie.rebondissement, c2.colonie.rebondissement, 'colonie : même graine, même rebondissement');
      A.equal(c1.colonie.cibleHabitants, c2.colonie.cibleHabitants, 'colonie : même population cible');

      // des graines différentes donnent des histoires différentes
      var graines = [1, 2, 3, 4, 5, 6, 7, 8];
      var crimes = new Set(), coupables = new Set(), rebonds = new Set(), reboColonies = new Set(), cibles = new Set();
      graines.forEach(function (g) {
        var e = R.generer('enquete', g, lieux, {});
        crimes.add(e.enquete.crime); coupables.add(e.enquete.coupableId); rebonds.add(e.enquete.rebondissement);
        var c = R.generer('colonie', g, lieux, {});
        reboColonies.add(c.colonie.rebondissement); cibles.add(c.colonie.cibleHabitants);
      });
      A.gt(crimes.size, 1, 'des crimes différents selon la graine : ' + Array.from(crimes).join(', '));
      A.gt(coupables.size, 1, 'des coupables différents selon la graine');
      A.gt(rebonds.size, 1, 'des rebondissements d enquête différents selon la graine');
      A.gt(reboColonies.size, 1, 'des rebondissements de colonie différents selon la graine');

      // sérialisation aller-retour en cours de partie
      var etat = R.generer('enquete', 999, lieux, {});
      R.commencer(etat);
      revelerIndices(etat, temoinsEtObjets(etat.enquete, true).slice(0, 1));
      var json = JSON.parse(JSON.stringify(R.serialiser(etat)));
      var recharge = R.charger(json);
      A.equal(recharge.enquete.crime, etat.enquete.crime, 'l enquête rechargée garde son crime');
      A.equal(recharge.enquete.coupableId, etat.enquete.coupableId, 'et son coupable');
      A.deep(R.objectif(recharge), R.objectif(etat), 'même objectif après rechargement');

      var etatC = R.generer('colonie', 999, lieux, { population: 3 });
      R.commencer(etatC);
      R.signaler(etatC, { type: 'poser', bloc: B.TORCH, t: 1 });
      var jsonC = JSON.parse(JSON.stringify(R.serialiser(etatC)));
      var rechargeC = R.charger(jsonC);
      A.deep(R.objectif(rechargeC), R.objectif(etatC), 'colonie : même objectif après rechargement');
    });

    it('SPEC-HISTOIRE-012 : l enquête se joue jusqu à chacune de ses quatre fins', function () {
      var lieux = lieuxFactices();

      function jouer(graine, idsARevelerAvant, accuserLeCoupable) {
        var etat = R.generer('enquete', graine, lieux, {});
        R.commencer(etat);
        var q = etat.enquete;
        A.ok(q.suspects.length >= 4 && q.suspects.length <= 6, 'de quatre à six suspects : ' + q.suspects.length);
        A.ok(q.indices.length >= 5 && q.indices.length <= 8, 'de cinq à huit indices : ' + q.indices.length);
        A.ok(q.suspects.some(function (s) { return s.id === q.coupableId; }), 'le coupable est bien parmi les suspects');
        var n = revelerIndices(etat, idsARevelerAvant);
        var cible = accuserLeCoupable ? q.coupableId
          : q.suspects.filter(function (s) { return s.id !== q.coupableId; })[0].id;
        n = n.concat(accuser(etat, cible));
        var fin = n.filter(function (x) { return x.type === 'fin'; })[0];
        A.ok(fin && fin.titre && fin.texte, 'un épilogue raconté : ' + (fin && fin.titre));
        return etat.enquete.fin;
      }

      // ratios d indices maîtrisés en excluant le second témoin (qui, combiné
      // au premier, ferait naître la contradiction et fausserait le compte)
      function idsPartiels(graine, n) {
        var q = R.generer('enquete', graine, lieux, {}).enquete;
        return temoinsEtObjets(q, true).slice(0, n);
      }

      A.equal(jouer(11, idsPartiels(11, 1), false), 'coupable_echappe', 'trop peu d indices, mauvaise accusation : le coupable s échappe');
      A.equal(jouer(12, idsPartiels(12, 3), false), 'erreur_judiciaire', 'des indices, mais la mauvaise personne accusée : erreur judiciaire');
      A.equal(jouer(13, idsPartiels(13, 4), true), 'coupable_demasque_de_justesse', 'juste assez, la bonne personne : de justesse');
      var qTotal = R.generer('enquete', 14, lieux, {}).enquete;
      A.equal(jouer(14, temoinsEtObjets(qTotal, false), true), 'justice_rendue', 'tous les indices, la bonne personne : justice rendue');

      A.equal(new Set(['justice_rendue', 'coupable_demasque_de_justesse', 'erreur_judiciaire', 'coupable_echappe']).size, 4, 'quatre fins distinctes couvertes');

      // les indices se révèlent bien par témoignage ET par objet trouvé
      var etat = R.generer('enquete', 55, lieux, {});
      R.commencer(etat);
      var q = etat.enquete;
      A.ok(q.indices.some(function (ind) { return ind.type === 'temoignage'; }), 'des témoignages');
      A.ok(q.indices.some(function (ind) { return ind.type === 'objet'; }), 'des objets à retrouver');
      var temoin = q.indices.filter(function (ind) { return ind.type === 'temoignage'; })[0];
      A.notOk(temoin.obtenu, 'pas encore obtenu');
      R.signaler(etat, { type: 'parler', role: 'x', pnj: 'un pnj sans rapport', lieu: 'ailleurs', t: 1 });
      A.notOk(indiceParId(q, temoin.id).obtenu, 'parler à un autre pnj ne révèle rien');
      R.signaler(etat, { type: 'parler', role: 'x', pnj: temoin.pnj, lieu: 'ailleurs', t: 2 });
      A.ok(indiceParId(q, temoin.id).obtenu, 'parler au bon pnj révèle le témoignage');

      // contradiction : se révèle une fois les deux témoignages qu elle recoupe obtenus
      var contradiction = q.indices.filter(function (ind) { return ind.type === 'contradiction'; })[0];
      if (contradiction) {
        var a = indiceParId(q, contradiction.a), b = indiceParId(q, contradiction.b);
        if (a.type === 'temoignage' && !a.obtenu) R.signaler(etat, { type: 'parler', role: 'x', pnj: a.pnj, lieu: 'ailleurs', t: 3 });
        A.equal(indiceParId(q, contradiction.id).obtenu, indiceParId(q, contradiction.a).obtenu && indiceParId(q, contradiction.b).obtenu, 'la contradiction dépend de ses deux témoignages');
      }

      // l objectif décrit la progression pendant l enquête
      var etat2 = R.generer('enquete', 5, lieux, {});
      R.commencer(etat2);
      var o = R.objectif(etat2);
      A.ok(o && o.chapitre && o.texte, 'un objectif décrit');
      A.equal(o.progres, 0, 'aucun indice au départ');
      A.gt(o.n, 0, 'un nombre d indices total');
      var actives = R.quetesActives(etat2);
      A.equal(actives.length, etat2.enquete.indices.length, 'quêtesActives liste les indices');
    });

    it('SPEC-HISTOIRE-012 : l enquête est bien liée aux suspects réels et saute sans lieux', function () {
      var lieux = lieuxFactices();
      var etat = R.generer('enquete', 321, lieux, {});
      var q = etat.enquete;
      var idsPnjs = [];
      lieux.forEach(function (l) { l.pnjs.forEach(function (p) { idsPnjs.push(p.id); }); });
      q.suspects.forEach(function (s) { A.ok(idsPnjs.indexOf(s.id) >= 0, 'chaque suspect est un vrai pnj : ' + s.nom); });
      q.suspects.forEach(function (s) {
        A.ok(s.alibi && s.alibi.heure, 'un alibi avec une heure');
        A.ok(s.mobile, 'un mobile');
      });
      A.ok(['vol_tresor', 'disparition', 'empoisonnement'].indexOf(q.crime) >= 0, 'un crime reconnu : ' + q.crime);

      // sans aucun lieu, l enquête reste jouable (aucun suspect, mais elle ne casse pas)
      var vide = R.generer('enquete', 1, [], {});
      R.commencer(vide);
      A.equal(vide.enquete.suspects.length, 0, 'aucun suspect sans pnjs');
      A.equal(R.objectif(vide).chapitre, "L'enquête", "l enquête démarre quand même");
    });

    it('SPEC-HISTOIRE-013 : la colonie se joue jusqu à chacune de ses cinq fins', function () {
      var lieux = lieuxFactices();

      function fonder(graine, population) {
        var etat = R.generer('colonie', graine, lieux, { population: population });
        R.commencer(etat);
        return etat;
      }
      function batir(etat) {
        var c = etat.colonie, n = [];
        c.batiments.forEach(function (b) {
          for (var k = 0; k < b.n; k++) n = n.concat(R.signaler(etat, { type: 'poser', bloc: b.bloc, t: 1 }));
        });
        return n;
      }
      function peupler(etat, n) { return R.signaler(etat, { type: 'habitants', n: n, t: 1 }); }
      function repousserVague(etat, v) {
        var n = [];
        for (var k = 0; k < v.n; k++) n = n.concat(R.signaler(etat, { type: 'tuer', mob: v.types[0], t: 1 }));
        return n;
      }
      function laisserPasser(etat, delta) {
        var c = etat.colonie;
        var t0 = (c.debutChap === null ? 1000 : c.debutChap) + 1;
        var n = R.signaler(etat, { type: 'temps', t: t0 });
        n = n.concat(R.signaler(etat, { type: 'temps', t: t0 + delta }));
        return n;
      }

      // abandonnée : rien n est bâti, tout expire par manque de temps
      var eAbandon = fonder(101, 3);
      var notifsAbandon = [];
      for (var i = 0; i < 5; i++) notifsAbandon = notifsAbandon.concat(laisserPasser(eAbandon, 500));
      A.equal(eAbandon.colonie.fin, 'colonie_abandonnee', 'trop peu de tout : colonie abandonnée : ' + eAbandon.colonie.fin);
      A.ok(notifsAbandon.some(function (x) { return x.type === 'fin'; }), 'un épilogue raconté');

      // survit : bâtie, mais rien d autre — le reste expire
      var eSurvit = fonder(102, 3);
      batir(eSurvit);
      A.equal(eSurvit.colonie.chap, 1, 'la fondation est achevée');
      for (var j = 0; j < 5; j++) laisserPasser(eSurvit, 500);
      A.equal(eSurvit.colonie.fin, 'colonie_qui_survit', 'bâtie mais peu peuplée : une colonie qui survit : ' + eSurvit.colonie.fin);

      // hameau prospère : bâtie et peuplée jusqu à la cible, le reste expire
      var eHameau = fonder(103, 4);
      batir(eHameau);
      peupler(eHameau, 4);
      A.equal(eHameau.colonie.chap, 2, 'population atteinte : les vagues commencent');
      for (var k = 0; k < 5; k++) laisserPasser(eHameau, 500);
      A.equal(eHameau.colonie.fin, 'hameau_prospere', 'bâtie et peuplée : un hameau prospère : ' + eHameau.colonie.fin);

      // cité florissante : tout est accompli, le revers est surmonté
      var eCite = fonder(104, 5);
      batir(eCite);
      peupler(eCite, 10);
      A.equal(eCite.colonie.chap, 2, 'les vagues commencent');
      eCite.colonie.vagues.forEach(function (v) { repousserVague(eCite, v); });
      A.equal(eCite.colonie.chap, 3, 'place au rebondissement');
      var t0 = 1000;
      R.signaler(eCite, { type: 'temps', t: t0 });
      R.signaler(eCite, { type: 'temps', t: t0 + 100 }); // dans la fenêtre [50, 400) : surmonté
      A.equal(eCite.colonie.fin, 'cite_florissante', 'tout accompli : une cité florissante : ' + eCite.colonie.fin);
      A.ok(eCite.colonie.rebondissementSurmonte, 'le revers a été surmonté');

      // mort : une fin à part, quel que soit l avancement
      var eMort = fonder(105, 4);
      var nMort = R.signaler(eMort, { type: 'mort' });
      A.equal(eMort.colonie.fin, 'colonie_orpheline', 'le fondateur meurt : une colonie orpheline');
      A.ok(nMort.some(function (x) { return x.type === 'fin'; }));

      var fins = new Set([eAbandon.colonie.fin, eSurvit.colonie.fin, eHameau.colonie.fin, eCite.colonie.fin, eMort.colonie.fin]);
      A.equal(fins.size, 5, 'cinq fins distinctes rencontrées : ' + Array.from(fins).join(', '));

      // les vagues font apparaître des ennemis, et l objectif suit chaque étape
      var eVagues = fonder(106, 3);
      batir(eVagues);
      peupler(eVagues, 3);
      var o0 = R.objectif(eVagues);
      A.equal(o0.chapitre, 'Les vagues');
      A.equal(o0.progres, 0);
      var n1 = repousserVague(eVagues, eVagues.colonie.vagues[0]);
      A.ok(n1.some(function (x) { return x.type === 'evenement' && x.apparitions.length > 0; }), 'la seconde vague fait apparaître des ennemis');
      A.ok(n1.some(function (x) { return x.type === 'etape'; }), 'la première vague est notée comme repoussée');

      var actives = R.quetesActives(eVagues);
      A.ok(actives.some(function (x) { return x.etat === 'faite'; }), 'des objectifs déjà accomplis listés');
    });

    it('SPEC-HISTOIRE-013 : la colonie pose bien les blocs requis et compte les habitants', function () {
      var lieux = lieuxFactices();
      var etat = R.generer('colonie', 200, lieux, { population: 3, x: 10, z: 20 });
      R.commencer(etat);
      var o = R.objectif(etat);
      A.equal(o.chapitre, 'Fondation');
      A.equal(o.progres, 0);
      A.equal(o.cible.x, 10); A.equal(o.cible.z, 20);
      // un mauvais bloc ne fait pas avancer l objectif
      R.signaler(etat, { type: 'poser', bloc: B.STONE, t: 1 });
      A.equal(R.objectif(etat).progres, 0, 'un bloc hors sujet ne compte pas');
      R.signaler(etat, { type: 'poser', bloc: B.TORCH, t: 1 });
      A.equal(R.objectif(etat).chapitre, 'Fondation', 'le feu de camp compté, l abri commence');
      A.equal(R.objectif(etat).texte, 'Bâtissez un abri de planches.');
      // attirer des habitants par le dialogue, aussi
      for (var i = 0; i < 8; i++) R.signaler(etat, { type: 'poser', bloc: B.PLANKS, t: 1 });
      R.signaler(etat, { type: 'poser', bloc: B.FARMLAND, t: 1 }); R.signaler(etat, { type: 'poser', bloc: B.FARMLAND, t: 1 });
      R.signaler(etat, { type: 'poser', bloc: B.FARMLAND, t: 1 }); R.signaler(etat, { type: 'poser', bloc: B.FARMLAND, t: 1 });
      R.signaler(etat, { type: 'poser', bloc: B.WATER, t: 1 });
      A.equal(etat.colonie.chap, 1, 'la fondation est achevée : ' + JSON.stringify(etat.colonie.poses));
      R.signaler(etat, { type: 'parler', pnj: 'p1', role: 'habitant', lieu: 'x', t: 1 });
      R.signaler(etat, { type: 'parler', pnj: 'p2', role: 'habitant', lieu: 'x', t: 1 });
      R.signaler(etat, { type: 'parler', pnj: 'p3', role: 'habitant', lieu: 'x', t: 1 });
      A.equal(etat.colonie.chap, 2, 'trois habitants distincts suffisent à atteindre la cible');
    });

    it('SPEC-HISTOIRE-011 : l épopée existante reste accessible comme archétype du même moteur', function () {
      var lieux = lieuxFactices();
      A.ok(R.ARCHETYPES.epopee && R.ARCHETYPES.enquete && R.ARCHETYPES.colonie, 'les trois archétypes sont nommés');
      var etat = R.generer('epopee', 1, lieux, { heros: 'Nael', longueur: 'courte' });
      A.equal(etat.archetype, 'epopee');
      var n = R.commencer(etat);
      A.ok(n.some(function (x) { return x.type === 'chapitre'; }), 'l épopée démarre comme avant');
      A.ok(etat.histoire.liens.depart && etat.histoire.liens.depart.nom === 'Hameau-Clair', 'liée au village fourni');
      // objectif, signaler, choixEnAttente/choisir, quêtesActives, sérialisation : la même interface
      var o = R.objectif(etat);
      A.ok(o && o.texte, 'un objectif');
      R.signaler(etat, { type: 'parler', role: 'guide', lieu: lieux[0].id, t: 1 });
      A.ok(Array.isArray(R.quetesActives(etat)));
      var d = JSON.parse(JSON.stringify(R.serialiser(etat)));
      var recharge = R.charger(d);
      A.equal(recharge.archetype, 'epopee');
      A.equal(recharge.histoire.params.heros, 'Nael', 'la sauvegarde de l épopée passe par le même moteur');
    });

    it('SPEC-HISTOIRE-011 : les récits se génèrent aussi depuis un vrai monde', function () {
      var w = MC.createWorld(20260921);
      var lieux = w.habitats.lieuxProches(0, 0, 2500);
      A.gt(lieux.length, 0, 'des lieux existent bien autour du point de départ');
      var enquete = R.generer('enquete', 20260921, lieux, {});
      A.ok(enquete.enquete.crime, 'un crime généré depuis un monde réel');
      A.ok(enquete.enquete.suspects.length > 0, 'des suspects tirés des habitants réels : ' + enquete.enquete.suspects.length);
      var colonie = R.generer('colonie', 20260921, lieux, {});
      A.equal(colonie.colonie.batiments.length, 4, 'quatre constructions de fondation');
      A.equal(colonie.colonie.vagues.length, 2, 'deux vagues');
      R.commencer(colonie);
      A.ok(R.objectif(colonie).texte, 'un objectif de colonie jouable depuis un monde réel');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
