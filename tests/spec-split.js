/* spec-split.js — tests des specs SPEC-SPLIT-*. Le découpage des vues et la
   lecture des manettes sont purs : la source de manettes est injectée, donc
   simulable sous Node comme dans le navigateur. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var Split = MC.Split, C = MC.Core, M = MC.Modes;

  /* Fausse source de manettes : on décrit des axes et des boutons, exactement
     ce que renvoie navigator.getGamepads(). */
  function manettes(specs) {
    return function () {
      return specs.map(function (s) {
        if (!s) return null;
        return {
          connected: s.connected !== false,
          index: s.index || 0,
          axes: s.axes || [0, 0, 0, 0],
          buttons: (s.buttons || []).map(function (p) { return { pressed: !!p, value: p ? 1 : 0 }; }),
        };
      });
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — découpage des vues', { teste: 'Le découpage de l\'écran en 1 à 4 vues et la répartition des pixels.', pourquoi: 'Couvre les specs SPEC-SPLIT-* de ce fichier, ainsi que le cas des dimensions impaires que ces specs ne détaillent pas explicitement.', attendu: 'les vues couvrent tout le cadre sans perdre ni dupliquer de pixel, en plus des specs SPEC-SPLIT-* couvertes une à une.' }, function () {

    it('SPEC-SPLIT-001 : de 1 a 4 joueurs sont acceptes', function () {
      [1, 2, 3, 4].forEach(function (n) {
        var v = Split.dispositions(n, 800, 600);
        A.equal(v.length, n, n + ' vue(s)');
      });
    });

    it('SPEC-SPLIT-002 : au-dela de 4, la demande est bornee', function () {
      A.equal(Split.dispositions(5, 800, 600).length, 4, '5 demandes, 4 rendus');
      A.equal(Split.dispositions(99, 800, 600).length, 4);
      A.equal(Split.dispositions(0, 800, 600).length, 1, 'jamais moins d une vue');
      A.equal(Split.dispositions(-3, 800, 600).length, 1);
    });

    it('SPEC-SPLIT-003 : a un joueur, la vue occupe tout le cadre', function () {
      var v = Split.dispositions(1, 800, 600)[0];
      A.deep([v.x, v.y, v.w, v.h], [0, 0, 800, 600]);
    });

    it('SPEC-SPLIT-004 : a deux joueurs, deux bandes horizontales egales', function () {
      var v = Split.dispositions(2, 800, 600);
      A.equal(v[0].w, 800, 'pleine largeur');
      A.equal(v[1].w, 800);
      A.equal(v[0].h, 300, 'moitie de hauteur');
      A.equal(v[1].h, 300);
      A.notEqual(v[0].y, v[1].y, 'empilees verticalement');
    });

    it('SPEC-SPLIT-005 : a trois ou quatre joueurs, des quadrants', function () {
      [3, 4].forEach(function (n) {
        var v = Split.dispositions(n, 800, 600);
        v.forEach(function (r, i) {
          A.equal(r.w, 400, n + ' joueurs, vue ' + i + ' : demi-largeur');
          A.equal(r.h, 300, n + ' joueurs, vue ' + i + ' : demi-hauteur');
        });
      });
      // a trois, le quatrieme quadrant reste vide
      A.equal(Split.dispositions(3, 800, 600).length, 3);
    });

    it('SPEC-SPLIT-006 : les vues ne se chevauchent pas', function () {
      [2, 3, 4].forEach(function (n) {
        var v = Split.dispositions(n, 800, 600);
        for (var i = 0; i < v.length; i++) {
          for (var j = i + 1; j < v.length; j++) {
            var a = v[i], b = v[j];
            var chevauche = a.x < b.x + b.w && b.x < a.x + a.w &&
                            a.y < b.y + b.h && b.y < a.y + a.h;
            A.notOk(chevauche, n + ' joueurs : vues ' + i + ' et ' + j + ' disjointes');
          }
        }
      });
    });

    it('SPEC-SPLIT-006 : a 1, 2 et 4 joueurs les vues couvrent tout le cadre', function () {
      [1, 2, 4].forEach(function (n) {
        var v = Split.dispositions(n, 800, 600);
        var aire = v.reduce(function (s, r) { return s + r.w * r.h; }, 0);
        A.equal(aire, 800 * 600, n + ' joueurs : couverture totale');
      });
    });

    it('les dimensions impaires sont reparties sans perdre de pixel', function () {
      var v = Split.dispositions(2, 801, 603);
      A.equal(v[0].h + v[1].h, 603, 'aucune ligne perdue');
      var q = Split.dispositions(4, 801, 603);
      A.equal(q[0].w + q[1].w, 801, 'aucune colonne perdue');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — joueurs locaux', { teste: 'L\'état des joueurs locaux en écran partagé (vie, équipe, victoire/défaite).', pourquoi: 'Couvre les specs SPEC-SPLIT-* de ce fichier, ainsi que les fonctions d\'état d\'équipe dont elles dépendent.', attendu: 'l\'état de chaque joueur local et de son équipe reste cohérent, en plus des specs SPEC-SPLIT-* couvertes une à une.' }, function () {

    function monde() {
      var w = G.flatWorld(10, C.B.STONE);
      return { w: w, ents: MC.createEntities(w) };
    }

    it('SPEC-SPLIT-007 : chaque joueur a son etat, son inventaire et sa vie', function () {
      var m = monde();
      var eq = Split.creerEquipe(2, m.w, m.ents, M.regles('survie', 'facile'),
                                 { x: 0.5, y: 11, z: 0.5 });
      A.equal(eq.length, 2);
      eq[0].player.state.inv.add(C.B.COBBLE, 10);
      eq[0].player.hurt(5);
      A.equal(eq[1].player.state.inv.count(C.B.COBBLE), 0, 'inventaires independants');
      A.equal(eq[1].player.state.hp, 20, 'vies independantes');
      A.equal(eq[0].player.state.hp, 15);
    });

    it('SPEC-SPLIT-009 : le joueur 1 est au clavier', function () {
      var m = monde();
      var eq = Split.creerEquipe(3, m.w, m.ents, M.regles('survie', 'facile'),
                                 { x: 0.5, y: 11, z: 0.5 });
      A.equal(eq[0].source, 'clavier');
    });

    it('SPEC-SPLIT-010 : les joueurs 2 a 4 sont a la manette, index croissant', function () {
      var m = monde();
      var eq = Split.creerEquipe(4, m.w, m.ents, M.regles('survie', 'facile'),
                                 { x: 0.5, y: 11, z: 0.5 });
      A.equal(eq[1].source, 'manette'); A.equal(eq[1].manette, 0);
      A.equal(eq[2].source, 'manette'); A.equal(eq[2].manette, 1);
      A.equal(eq[3].source, 'manette'); A.equal(eq[3].manette, 2);
    });

    it('SPEC-SPLIT-014 : les joueurs apparaissent proches mais sans se chevaucher', function () {
      var m = monde();
      var eq = Split.creerEquipe(4, m.w, m.ents, M.regles('survie', 'facile'),
                                 { x: 0.5, y: 11, z: 0.5 });
      for (var i = 0; i < eq.length; i++) {
        for (var j = i + 1; j < eq.length; j++) {
          var a = eq[i].player.state.pos, b = eq[j].player.state.pos;
          var d = Math.hypot(a.x - b.x, a.z - b.z);
          A.ok(d > 0.6, 'joueurs ' + i + ' et ' + j + ' separes (' + d.toFixed(2) + ')');
          A.ok(d < 8, 'mais proches (' + d.toFixed(2) + ')');
        }
      }
    });

    it('SPEC-SPLIT-014 : positionsDepart repartit les joueurs autour du centre', function () {
      var centre = { x: 10, y: 20, z: 30 };
      var seul = Split.positionsDepart(1, centre);
      A.equal(seul.length, 1);
      A.deep([seul[0].x, seul[0].y, seul[0].z], [10, 20, 30], 'a un joueur : pile au centre');

      var quatre = Split.positionsDepart(4, centre, 2);
      A.equal(quatre.length, 4);
      quatre.forEach(function (p2, i) {
        A.equal(p2.y, centre.y, 'meme altitude pour le joueur ' + i);
        var d = Math.hypot(p2.x - centre.x, p2.z - centre.z);
        A.close(d, 2, 1e-6, 'joueur ' + i + ' a la distance demandee');
      });
      // et deux a deux distincts
      for (var a = 0; a < 4; a++) for (var b = a + 1; b < 4; b++) {
        var dd = Math.hypot(quatre[a].x - quatre[b].x, quatre[a].z - quatre[b].z);
        A.ok(dd > 0.5, 'joueurs ' + a + ' et ' + b + ' distincts');
      }
    });

    it('tousMorts distingue une equipe decimee d une equipe vivante', function () {
      var m = monde();
      var eq = Split.creerEquipe(3, m.w, m.ents, M.regles('survie', 'facile'),
                                 { x: 0.5, y: 11, z: 0.5 });
      A.notOk(Split.tousMorts(eq), 'tout le monde est vivant');
      eq[0].player.hurt(20);
      A.notOk(Split.tousMorts(eq), 'un seul mort ne suffit pas');
      eq[1].player.hurt(20);
      eq[2].player.hurt(20);
      A.ok(Split.tousMorts(eq), 'toute l equipe est morte');
      A.notOk(Split.tousMorts([]), 'une equipe vide n est pas morte');
    });

    it('SPEC-SPLIT-015 : la mort d un joueur n empeche pas les autres de jouer', function () {
      var m = monde();
      var eq = Split.creerEquipe(2, m.w, m.ents, M.regles('survie', 'facile'),
                                 { x: 0.5, y: 11, z: 0.5 });
      eq[0].player.hurt(20);
      A.ok(eq[0].player.state.dead, 'joueur 1 mort');
      var x0 = eq[1].player.state.pos.x;
      var k = { forward: 1, back: 0, left: 0, right: 0, jump: 0, sprint: 0 };
      for (var i = 0; i < 60; i++) eq[1].player.updateMovement(1 / 60, k);
      A.notEqual(eq[1].player.state.pos.x.toFixed(3), x0.toFixed(3),
        'le joueur 2 se deplace toujours');
    });

    it('SPEC-SPLIT-016 : en cauchemar, la mort d un seul joueur condamne la partie', function () {
      var m = monde();
      var r = M.regles('survie', 'cauchemar');
      var eq = Split.creerEquipe(3, m.w, m.ents, r, { x: 0.5, y: 11, z: 0.5 });
      A.notOk(Split.partiePerdue(eq, r), 'personne n est mort');
      eq[1].player.hurt(20);
      A.ok(Split.partiePerdue(eq, r), 'un seul mort suffit en cauchemar');
    });

    it('SPEC-SPLIT-016 : hors cauchemar, la partie continue apres une mort', function () {
      var m = monde();
      var r = M.regles('survie', 'difficile');
      var eq = Split.creerEquipe(2, m.w, m.ents, r, { x: 0.5, y: 11, z: 0.5 });
      eq[0].player.hurt(20);
      A.notOk(Split.partiePerdue(eq, r), 'la partie continue');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — manettes', { teste: 'La lecture des manettes : sticks, zone morte, boutons, appui unique.', pourquoi: 'Couvre les specs SPEC-SPLIT-* liées aux manettes, ainsi que la conversion des boutons en actions dont elles dépendent.', attendu: 'les entrées de manette produisent les bonnes actions, sans répétition ni bruit, en plus des specs SPEC-SPLIT-* couvertes une à une.' }, function () {

    it('SPEC-SPLIT-011 : le stick gauche deplace', function () {
      var src = manettes([{ axes: [0, -1, 0, 0] }]);       // vers l avant
      var g = MC.creerManette(0, src);
      var a = g.actions();
      A.ok(a.forward, 'avant');
      A.notOk(a.back);
      var src2 = manettes([{ axes: [1, 0, 0, 0] }]);       // vers la droite
      A.ok(MC.creerManette(0, src2).actions().right, 'droite');
    });

    it('SPEC-SPLIT-011 : le stick droit oriente', function () {
      var src = manettes([{ axes: [0, 0, 1, 0] }]);
      var g = MC.creerManette(0, src);
      var r = g.regard(1 / 60);
      A.ok(r.dyaw !== 0, 'rotation horizontale');
      A.equal(r.dpitch, 0, 'aucune rotation verticale');

      var src2 = manettes([{ axes: [0, 0, 0, 1] }]);
      var r2 = MC.creerManette(0, src2).regard(1 / 60);
      A.ok(r2.dpitch !== 0, 'rotation verticale');
      A.equal(r2.dyaw, 0);
    });

    it('SPEC-SPLIT-011 : tourner a droite fait pivoter a droite', function () {
      // convention : dyaw negatif = rotation horaire vue du dessus
      var r = MC.creerManette(0, manettes([{ axes: [0, 0, 1, 0] }])).regard(1 / 60);
      A.ok(r.dyaw < 0, 'stick a droite => yaw decroit, comme la souris');
      var rg = MC.creerManette(0, manettes([{ axes: [0, 0, -1, 0] }])).regard(1 / 60);
      A.ok(rg.dyaw > 0, 'stick a gauche => yaw croit');
    });

    it('SPEC-SPLIT-012 : la zone morte est appliquee', function () {
      var faible = manettes([{ axes: [0.08, 0.08, 0.08, 0.08] }]);
      var g = MC.creerManette(0, faible);
      var a = g.actions();
      A.notOk(a.forward || a.back || a.left || a.right, 'aucune direction');
      var r = g.regard(1 / 60);
      A.equal(r.dyaw, 0, 'aucune rotation');
      A.equal(r.dpitch, 0);
    });

    it('SPEC-SPLIT-013 : une manette debranchee ne produit aucune action', function () {
      var g = MC.creerManette(0, manettes([{ connected: false, axes: [0, -1, 0, 0] }]));
      var a = g.actions();
      A.notOk(a.forward || a.back || a.left || a.right || a.jump || a.sprint);
      A.notOk(g.connectee(), 'signalee deconnectee');

      var absente = MC.creerManette(3, manettes([null]));
      A.notOk(absente.connectee(), 'index inexistant');
      A.notOk(absente.actions().forward);
    });

    it('les boutons produisent saut, course et actions', function () {
      // 0=A saut, 1=B ?, 6=LT casser, 7=RT utiliser, 10=L3 course
      var boutons = [];
      boutons[0] = true; boutons[7] = true; boutons[10] = true;
      var g = MC.creerManette(0, manettes([{ axes: [0, 0, 0, 0], buttons: boutons }]));
      var a = g.actions();
      A.ok(a.jump, 'saut');
      A.ok(a.sprint, 'course');
      A.ok(g.boutons().utiliser, 'utiliser');
      A.notOk(g.boutons().casser, 'casser non presse');
    });

    it('un bouton est signale une seule fois par appui', function () {
      var etat = [];
      etat[3] = false;
      var src = function () {
        return [{ connected: true, axes: [0, 0, 0, 0],
                  buttons: etat.map(function (p) { return { pressed: !!p, value: p ? 1 : 0 }; }) }];
      };
      var g = MC.creerManette(0, src);
      etat[3] = true;
      A.ok(g.vientDAppuyer(3), 'premier appui detecte');
      A.notOk(g.vientDAppuyer(3), 'maintien non redetecte');
      etat[3] = false;
      g.vientDAppuyer(3);
      etat[3] = true;
      A.ok(g.vientDAppuyer(3), 'nouvel appui apres relachement');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
