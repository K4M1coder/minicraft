/* spec-histoire.js — tests des specs SPEC-HISTOIRE-*. Le mode histoire :
   paramètres, interactions limitées, lien au monde, quête principale,
   quêtes secondaires, événements et fins alternatives. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, H = MC.Histoire, M = MC.Modes;
  var B = C.B, I = C.I;

  // un monde d'histoire factice : lieux et donjons aux identifiants connus
  var LIENS = {
    depart: { id: 'village:0,0', nom: 'Hameau-Clair', x: 0, z: 0, kind: 'lieu' },
    ville: { id: 'ville:1,0', nom: 'Grandbourg', x: 400, z: 0, kind: 'lieu' },
    ermite: { id: 'maison:3,3', nom: 'Maison de Léon', x: 200, z: 200, kind: 'lieu' },
    donjon1: { id: '1,1', nom: 'Crypte', x: 100, z: 100, kind: 'donjon' },
    donjon2: { id: '2,2', nom: 'Forteresse de glace', x: -300, z: 250, kind: 'donjon' },
    donjon3: { id: '5,5', nom: 'Citadelle des cimes', x: 700, z: -600, kind: 'donjon' },
  };
  function etape(e) { var ch = H.CHAPITRES[e.chapitres[e.chap]]; return ch ? ch.etapes[e.etape] : null; }

  /* Joue le récit jusqu'au bout, en satisfaisant chaque étape ; `choix` donne
     l'option retenue à chaque choix ; `rater` : objectifs à laisser échouer. */
  function jouer(e, choix, rater) {
    var notifs = H.commencer(e), t = 1000, garde = 0;
    function sig(ev, ctx) { ev.t = t; notifs = notifs.concat(H.signaler(e, ev, ctx)); }
    while (!e.fin && garde++ < 500) {
      var et = etape(e);
      if (!et) break;
      var tout = { compter: function () { return 99; } };
      t += 5;
      switch (et.type) {
        case 'parler': sig({ type: 'parler', role: et.role, lieu: et.lieu ? e.liens[et.lieu].id : 'ailleurs' }); break;
        case 'aller': sig({ type: 'position', x: e.liens[et.cible].x, z: e.liens[et.cible].z }); break;
        case 'biome': sig({ type: 'biome', id: et.biomes[0] }); break;
        case 'collecter': sig({ type: 'inventaire' }, tout); break;
        case 'livrer': sig({ type: 'parler', role: et.role, lieu: 'ailleurs' }, tout); break;
        case 'vaincre': sig({ type: 'boss', donjon: e.liens[et.cible].id }); break;
        case 'tuer':
          if (rater && rater.indexOf(e.chapitres[e.chap]) >= 0) { t += (et.delai || 0) + 10; sig({ type: 'temps', nuit: false }); break; }
          for (var k = 0; k < et.n; k++) sig({ type: 'tuer', mob: et.types[0] });
          break;
        case 'survivre': sig({ type: 'temps', nuit: true }); sig({ type: 'temps', nuit: false }); break;
        case 'choix': notifs = notifs.concat(H.choisir(e, et.id, (choix && choix[et.id]) || et.options[0].id)); break;
      }
    }
    return notifs;
  }
  function toutesSecondaires(e) {
    var faites = 0;
    Object.keys(H.SECONDAIRES).forEach(function (id) {
      var q = H.SECONDAIRES[id];
      var p = H.queteProposee(e, q.role);
      if (!p) return;
      H.accepter(e, p.id);
      if (q.explorer) for (var i = 0; i < q.explorer; i++) H.signaler(e, { type: 'lieu', id: 'visite' + id + i, t: 1 });
      var n = H.rendreQuete(e, q.role, { compter: function () { return 99; } });
      if (n.some(function (x) { return x.type === 'quete'; })) faites++;
    });
    return faites;
  }

  describe('Specs — mode histoire', function () {
    it('SPEC-HISTOIRE-001 : un mode histoire aux paramètres ajustables', function () {
      A.ok(M.MODES.histoire && M.MODES.histoire.histoire, 'le mode existe');
      var r = M.regles('histoire', 'facile', { interactions: { preset: 'restreinte' }, commerce: false });
      A.ok(r.histoire && r.interactions && r.commerce === false, 'ses règles portent les interactions et le commerce');
      A.equal(M.regles('survie', 'facile').interactions, null, 'la survie reste un bac à sable');
      var p = H.parametres({ heros: 'Lior', longueur: 'longue', secondaires: 12, evenements: false });
      A.equal(p.heros, 'Lior'); A.equal(p.longueur, 'longue'); A.equal(p.secondaires, 8, 'borné à huit');
      A.equal(p.evenements, false);
      A.equal(H.parametres({ longueur: 'nimporte' }).longueur, 'normale', 'longueur par défaut');
      A.equal(H.LONGUEURS.courte.chapitres.length, 4);
      A.equal(H.LONGUEURS.longue.chapitres.length, 8, 'la quête longue compte huit chapitres');
      var etapes = 0;
      H.LONGUEURS.longue.chapitres.forEach(function (c) { etapes += H.CHAPITRES[c].etapes.length; });
      A.gt(etapes, 20, 'et plus de vingt étapes : ' + etapes);
      var e = H.creer({ heros: 'Lior' }, LIENS);
      H.commencer(e);
      A.ok(/Lior/.test(etape(e).dialogue.replace('{heros}', e.params.heros)), 'le héros est nommé dans le récit');
    });

    it('SPEC-HISTOIRE-002 : on n interagit qu avec les blocs et objets que l histoire permet', function () {
      var r = M.regles('histoire', 'facile', { interactions: { preset: 'restreinte' } });
      A.notOk(M.peutCasser(r, B.STONE), 'la pierre ne se casse pas');
      A.notOk(M.peutCasser(r, B.LOG), 'ni le bois');
      A.ok(M.peutCasser(r, B.FLOWER_RED), 'on cueille une fleur');
      A.ok(M.peutPoser(r, B.TORCH), 'on pose une torche');
      A.notOk(M.peutUtiliser(r, I.IRON_PICKAXE), 'pas de pioche');
      A.ok(M.peutUtiliser(r, I.IRON_SWORD) && M.peutUtiliser(r, I.BREAD) && M.peutUtiliser(r, I.EMERALD), 'épée, pain, émeraude');
      var libre = M.regles('histoire', 'facile', { interactions: { preset: 'libre' } });
      A.ok(M.peutCasser(libre, B.STONE) && M.peutUtiliser(libre, I.IRON_PICKAXE), 'en libre, tout est permis');
      var perso = M.regles('histoire', 'facile', { interactions: { preset: 'restreinte', blocs: ['pierre'], objets: ['outils'] } });
      A.ok(M.peutCasser(perso, B.STONE) && !M.peutCasser(perso, B.FLOWER_RED), 'des catégories choisies une à une');
      A.ok(M.peutUtiliser(perso, I.IRON_PICKAXE) && !M.peutUtiliser(perso, I.IRON_SWORD));
      A.ok(M.peutCasser(M.regles('survie', 'facile'), B.STONE), 'la survie n est pas concernée');
      var cats = M.categoriesBlocs();
      A.ok(cats.bois.ids.indexOf(B.LOG) >= 0 && cats.pierre.ids.indexOf(B.STONE) >= 0, 'des catégories de blocs nommées');
      A.ok(Object.keys(cats).every(function (k) { return cats[k].nom && cats[k].ids.length; }), 'chacune avec son nom et ses blocs');
      // le joueur s'y plie
      var w = G.flatWorld(10, B.STONE);
      var pl = MC.createPlayer(w, MC.createEntities(w), r);
      pl.state.pos = { x: 0.5, y: 11, z: 0.5 };
      var cible = { x: 1, y: 10, z: 0, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      for (var i = 0; i < 40; i++) pl.mineTick(0.1, cible);
      A.equal(w.getBlock(1, 10, 0), B.STONE, 'la pierre résiste');
      A.equal(pl.state.interdit, 'casser', 'et le jeu sait pourquoi');
      pl.state.inv.add(B.STONE, 4); pl.state.selected = 0;
      A.equal(pl.useOn(cible), 'interdit', 'on ne pose pas de pierre');
      pl.state.inv.slots[0] = { id: B.TORCH, n: 4 };
      A.equal(pl.useOn(cible), 'place', 'mais une torche, oui');
    });

    it('SPEC-HISTOIRE-003 : l histoire se lie aux lieux réels du monde @lent', function () {
      var w = MC.createWorld(20260921);
      var l = H.lier(w, 0, 0);
      A.ok(l.depart && /^(village|ville):/.test(l.depart.id), 'un village de départ : ' + (l.depart && l.depart.nom));
      A.ok(l.ville && /^ville:/.test(l.ville.id) && l.ville.id !== l.depart.id, 'une ville : ' + (l.ville && l.ville.nom));
      A.ok(l.ermite && /^maison:/.test(l.ermite.id), 'un ermite : ' + (l.ermite && l.ermite.nom));
      A.ok(l.donjon1 && l.donjon2 && l.donjon3, 'trois donjons');
      A.equal(new Set([l.donjon1.id, l.donjon2.id, l.donjon3.id]).size, 3, 'trois donjons distincts');
      [l.donjon1, l.donjon2, l.donjon3].forEach(function (d) {
        A.ok(['monument', 'epave'].indexOf(d.type) < 0, 'aucun donjon sous la mer : ' + d.nom);
      });
      A.ok(Math.hypot(l.donjon1.x, l.donjon1.z) <= Math.hypot(l.donjon3.x, l.donjon3.z), 'le dernier est le plus lointain');
      var e = H.creer({}, l);
      H.commencer(e);
      var o = H.objectif(e);
      A.ok(o && o.cible && o.cible.nom === l.depart.nom, 'le premier objectif pointe le village : ' + o.texte);
    });

    it('SPEC-HISTOIRE-004 : une quête principale longue se joue du début à la fin, et s adapte à ce qu on permet', function () {
      var e = H.creer({ longueur: 'longue' }, LIENS);
      var n = jouer(e);
      A.ok(e.fin, 'le récit arrive à sa fin : ' + e.fin);
      A.equal(e.chap, 8, 'huit chapitres traversés');
      var chapitres = n.filter(function (x) { return x.type === 'chapitre'; }).map(function (x) { return x.titre; });
      A.equal(chapitres.length, 8, 'huit chapitres racontés : ' + chapitres.join(' · '));
      A.ok(n.some(function (x) { return x.type === 'dialogue'; }), 'des dialogues');
      A.ok(n.some(function (x) { return x.type === 'recompense'; }), 'des récompenses');
      A.gt(e.journal.length, 20, 'un journal tenu : ' + e.journal.length + ' entrées');
      // restreinte : pas de bois à couper — l'étape saute, le récit continue
      var r = M.regles('histoire', 'facile', { interactions: { preset: 'restreinte' } });
      var e2 = H.creer({ longueur: 'courte' }, LIENS, function (c) { return M.categoriePermise(r, c); });
      H.commencer(e2);
      H.signaler(e2, { type: 'parler', role: 'guide', lieu: LIENS.depart.id, t: 1 });
      A.equal(etape(e2).type, 'parler', 'la collecte de bois est sautée');
      // un lieu absent du monde : ses étapes sautent aussi
      var sansVille = {}; for (var k in LIENS) if (k !== 'ville') sansVille[k] = LIENS[k];
      var e3 = H.creer({ longueur: 'courte' }, sansVille);
      jouer(e3);
      A.ok(e3.fin, 'même sans ville, l histoire se termine');
    });

    it('SPEC-HISTOIRE-005 : les habitants confient des quêtes secondaires, récompensées', function () {
      var e = H.creer({ longueur: 'longue', secondaires: 8 }, LIENS);
      H.commencer(e);
      var p = H.queteProposee(e, 'fermier');
      A.ok(p && p.id === 'recolte', 'le fermier propose sa quête');
      A.equal(H.queteProposee(e, 'banquier').id, 'lingot', 'le banquier la sienne');
      A.ok(H.accepter(e, 'recolte'));
      A.notOk(H.accepter(e, 'recolte'), 'pas deux fois');
      var pas = H.rendreQuete(e, 'fermier', { compter: function () { return 3; } });
      A.ok(pas.every(function (x) { return x.type === 'info'; }), 'sans le blé, elle reste en cours');
      var ok = H.rendreQuete(e, 'fermier', { compter: function (id) { return id === I.WHEAT ? 12 : 0; } });
      A.ok(ok.some(function (x) { return x.type === 'quete'; }), 'accomplie');
      A.ok(ok.some(function (x) { return x.type === 'recompense' && x.objets[0].id === I.EMERALD; }), 'et récompensée');
      A.ok(ok.some(function (x) { return x.type === 'prendre' && x.objets[0].n === 12; }), 'le blé est remis');
      A.equal(e.secondairesFaites, 1);
      A.equal(H.queteProposee(e, 'fermier'), null, 'rien de plus à proposer');
      // le cartographe compte les lieux visités depuis qu'on a accepté
      A.ok(H.accepter(e, 'carto'));
      A.notOk(H.rendreQuete(e, 'guide', {}).some(function (x) { return x.type === 'quete'; }), 'pas encore visité');
      ['a', 'b', 'c'].forEach(function (id) { H.signaler(e, { type: 'lieu', id: id, t: 1 }); });
      A.ok(H.rendreQuete(e, 'guide', {}).some(function (x) { return x.type === 'quete'; }), 'trois lieux : quête faite');
      // le nombre de quêtes proposées suit le paramètre
      var e2 = H.creer({ secondaires: 2 }, LIENS);
      H.commencer(e2);
      A.equal(toutesSecondaires(e2), 2, 'deux quêtes au plus');
      var r = M.regles('histoire', 'facile', { interactions: { preset: 'restreinte', blocs: ['lumiere'] } });
      var e3 = H.creer({ secondaires: 8 }, LIENS, function (c) { return M.categoriePermise(r, c); });
      H.commencer(e3);
      A.equal(H.queteProposee(e3, 'fermier'), null, 'sans végétaux permis, pas de moisson à faire');
    });

    it('SPEC-HISTOIRE-006 : des événements ponctuent l aventure', function () {
      var e = H.creer({ longueur: 'normale' }, LIENS);
      var n = jouer(e);
      var evs = n.filter(function (x) { return x.type === 'evenement'; });
      var ids = evs.map(function (x) { return x.id; });
      A.ok(ids.indexOf('nuit_de_sang') >= 0, 'la Nuit de sang');
      A.ok(ids.indexOf('pillards') >= 0, 'les pillards');
      var nuit = evs.filter(function (x) { return x.id === 'nuit_de_sang'; })[0];
      A.gt(nuit.apparitions.length, 0, 'des créatures surgissent');
      var pil = evs.filter(function (x) { return x.id === 'pillards'; })[0];
      A.equal(pil.pres.id, LIENS.depart.id, 'les pillards marchent sur le village de départ');
      // l'orage prophétique suit le vrai temps qu'il fait
      var e2 = H.creer({}, LIENS);
      H.commencer(e2);
      e2.chap = 3;
      A.equal(H.signaler(e2, { type: 'meteo', meteo: 'clair', t: 1 }).length, 0, 'pas par temps clair');
      A.ok(H.signaler(e2, { type: 'meteo', meteo: 'orage', t: 2 }).some(function (x) { return x.id === 'orage'; }), 'mais sous l orage');
      // désactivés : aucun événement
      var e3 = H.creer({ longueur: 'normale', evenements: false }, LIENS);
      A.equal(jouer(e3).filter(function (x) { return x.type === 'evenement'; }).length, 0, 'aucun si désactivés');
      // la défense du village peut échouer : trop tard, il brûle
      var e4 = H.creer({ longueur: 'normale' }, LIENS);
      jouer(e4, null, ['traitre']);
      A.equal(e4.drapeaux.village_sauve, false, 'le village n a pas été sauvé');
    });

    it('SPEC-HISTOIRE-007 : les objectifs atteints et les choix décident de la fin', function () {
      function fin(params, choix, rater, secondaires) {
        var e = H.creer(params || { longueur: 'longue', secondaires: 8 }, LIENS);
        H.commencer(e);
        if (secondaires) toutesSecondaires(e);
        var n = jouer(e, choix, rater);
        var f = n.filter(function (x) { return x.type === 'fin'; })[0];
        A.ok(f && f.titre && f.texte, 'un épilogue raconté');
        return e.fin;
      }
      A.equal(fin(null, { couronne: 'rendre', traitre: 'epargner' }, null, true), 'secrete', 'tout accompli : la fin secrète');
      A.equal(fin(null, { couronne: 'rendre', traitre: 'bannir' }, null, true), 'aube', 'l aube des saisons');
      A.equal(fin({ longueur: 'normale', secondaires: 5 }, { couronne: 'rendre' }, ['traitre'], true), 'cendres', 'village perdu : les cendres');
      A.equal(fin(null, { couronne: 'porter' }), 'souverain', 'porter la couronne');
      A.equal(fin(null, { couronne: 'briser' }), 'brise', 'la briser');
      A.equal(fin(null, { couronne: 'rendre' }, null, false), 'cendres', 'sans quêtes secondaires, une victoire amère');
      var e = H.creer({}, LIENS);
      H.commencer(e);
      var n = H.signaler(e, { type: 'mort' });
      A.equal(e.fin, 'tragique', 'mourir en cauchemar : la légende oubliée');
      A.ok(n.some(function (x) { return x.type === 'fin'; }));
      A.equal(new Set(H.FINS.map(function (f) { return f.id; })).size, 6, 'six fins possibles');
    });

    it('SPEC-HISTOIRE-008 : l avancée du récit survit à la sauvegarde', function () {
      var e = H.creer({ heros: 'Mira', longueur: 'normale' }, LIENS);
      H.commencer(e);
      H.signaler(e, { type: 'parler', role: 'guide', lieu: LIENS.depart.id, t: 1 });
      H.accepter(e, 'fer');
      var d = JSON.parse(JSON.stringify(H.serialiser(e)));
      var e2 = H.charger(d);
      A.equal(e2.params.heros, 'Mira');
      A.equal(e2.chap, e.chap); A.equal(e2.etape, e.etape);
      A.deep(H.objectif(e2), H.objectif(e), 'même objectif après rechargement');
      A.equal(e2.secondaires.fer.etat, 'active', 'les quêtes acceptées aussi');
      // intégré à la sauvegarde de partie
      var w = MC.createWorld(7), ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents, M.regles('histoire', 'facile'));
      var mem = {}, st = { getItem: function (k) { return mem[k] || null; }, setItem: function (k, v) { mem[k] = v; }, removeItem: function (k) { delete mem[k]; } };
      var etat = { world: w, entities: ents, player: pl, time: 100, furnaces: {}, chests: {}, spawnPoint: { x: 0, y: 40, z: 0 },
                   histoire: e, regles: M.regles('histoire', 'facile') };
      A.ok(MC.Save.save(st, etat));
      etat.histoire = null;
      A.ok(MC.Save.load(st, etat));
      // MC.Save passe désormais par MC.Recits, qui connaît l'archétype : une
      // épopée (même assignée directement, sans champ « archetype ») revient
      // enveloppée sous etat.histoire.histoire, comme MC.Recits.generer('epopee', …).
      A.ok(etat.histoire && etat.histoire.archetype === 'epopee', 'le récit revient comme une épopée');
      A.ok(etat.histoire.histoire && etat.histoire.histoire.params.heros === 'Mira', 'le récit revient avec la partie');
      A.equal(etat.histoire.histoire.etape, e.etape);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
