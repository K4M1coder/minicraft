/* spec-audio.js — tests des specs SPEC-AUDIO-* : la logique pure de
   MC.Ambiance (décisions) et l'exécution de MC.createAudio sur un FAUX
   AudioContext injecté (Node n'en a pas de vrai) — on vérifie que les nœuds
   sont créés et reliés comme il faut, pas ce qu'on entend : la qualité
   sonore est subjective et ne se teste pas. Le vrai AudioContext du
   navigateur est exercé par les e2e (tests/e2e.js, « SPEC-AUDIO-… »). */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var Amb = MC.Ambiance, C = MC.Core, B = C.B, I = C.I;
  var flatWorld = G.flatWorld;

  // ── faux AudioContext : chaque nœud note ses liaisons et ses démarrages ──
  function FauxContexte() {
    var noeuds = [];
    function param(v) {
      return { value: v, appels: [],
               setValueAtTime: function (x) { this.value = x; this.appels.push('set'); },
               exponentialRampToValueAtTime: function (x) { this.value = x; this.appels.push('exp'); },
               linearRampToValueAtTime: function (x) { this.value = x; this.appels.push('lin'); },
               setTargetAtTime: function (x) { this.value = x; this.appels.push('cible'); },
               cancelScheduledValues: function () {} };
    }
    function noeud(type, extra) {
      var n = { genre: type, sorties: [], demarre: false, arrete: false,
                connect: function (d) { this.sorties.push(d); return d; },
                disconnect: function () { this.sorties = []; this.deconnecte = true; } };
      for (var k in extra) n[k] = extra[k];
      noeuds.push(n);
      return n;
    }
    var ctx = {
      state: 'suspended', currentTime: 0, sampleRate: 8000, noeuds: noeuds,
      destination: { genre: 'destination', sorties: [] },
      resume: function () { this.state = 'running'; return { catch: function () {} }; },
      suspend: function () { this.state = 'suspended'; },
      createGain: function () { return noeud('gain', { gain: param(1) }); },
      createOscillator: function () {
        return noeud('osc', { frequency: param(440), start: function () { this.demarre = true; }, stop: function () { this.arrete = true; } });
      },
      createBufferSource: function () {
        return noeud('source', { buffer: null, loop: false, start: function () { this.demarre = true; }, stop: function () { this.arrete = true; } });
      },
      createBiquadFilter: function () { return noeud('filtre', { frequency: param(350), Q: param(1) }); },
      createStereoPanner: function () { return noeud('pan', { pan: param(0) }); },
      createBuffer: function (c, n) { var d = new Float32Array(n); return { getChannelData: function () { return d; } }; },
    };
    return ctx;
  }
  function audioFaux(opts) {
    var dernier = null;
    function AC() { dernier = FauxContexte(); return dernier; }
    var o = { AudioContext: AC };
    for (var k in opts || {}) o[k] = opts[k];
    var a = MC.createAudio(o);
    a.resume();
    return { a: a, ctx: function () { return a.context; } };
  }
  // la chaîne de sortie d'un nœud aboutit-elle au haut-parleur ?
  function atteint(n, dest, prof) {
    if (n === dest) return true;
    if (!n || (prof || 0) > 12) return false;
    for (var i = 0; i < (n.sorties || []).length; i++) if (atteint(n.sorties[i], dest, (prof || 0) + 1)) return true;
    return false;
  }
  function sourcesDepuis(ctx, n0) { return ctx.noeuds.slice(n0).filter(function (n) { return n.genre === 'osc' || n.genre === 'source'; }); }

  // ── petit monde de blocs pour les sondes (clé "x,y,z" → id) ─────────────
  function mondeBlocs() {
    var m = new Map();
    return {
      poser: function (x, y, z, id) { m.set(x + ',' + y + ',' + z, id); },
      lire: function (x, y, z) { return m.get(x + ',' + y + ',' + z) || 0; },
    };
  }

  describe('Specs — audio procédural', function () {
    it('SPEC-AUDIO-001 : les nappes d\'environnement suivent le lieu et le moment', function () {
      // plaine calme, en plein jour : rien ne bruite au hasard
      var calme = Amb.nappes({ biome: { id: 'plaines' }, nuit: false, pluie: 0, vent: 0 });
      A.equal(calme.pluie, 0, 'pas de pluie sans pluie');
      A.equal(calme.mer, 0, 'pas de mer loin de l\'océan');
      A.equal(calme.grillons, 0, 'pas de grillons en plein jour');
      Amb.NAPPES.forEach(function (k) { A.ok(calme[k] !== undefined, 'nappe « ' + k + ' » décidée'); });

      // forêt la nuit, vent et pluie : feuillage + grillons + vent + pluie
      var foretNuit = Amb.nappes({ biome: { id: 'foret' }, nuit: true, pluie: 0.6, vent: 0.4 });
      A.gt(foretNuit.feuillage, 0, 'le feuillage bruisse en forêt');
      A.gt(foretNuit.grillons, 0, 'les grillons chantent la nuit');
      A.close(foretNuit.pluie, 0.6, 1e-9, 'la pluie suit son intensité');
      A.gt(foretNuit.vent, 0, 'le vent souffle');

      // désert la nuit : pas de grillons (biome trop aride)
      var desertNuit = Amb.nappes({ biome: { id: 'desert' }, nuit: true });
      A.equal(desertNuit.grillons, 0, 'le désert reste silencieux la nuit');

      // au large : la mer gronde, davantage avec le vent
      var mer = Amb.nappes({ biome: { id: 'ocean', marin: true }, vent: 0.5 });
      var merCalme = Amb.nappes({ biome: { id: 'ocean', marin: true }, vent: 0 });
      A.gt(mer.mer, 0, 'la mer se fait entendre au large');
      A.gt(mer.mer, merCalme.mer, 'plus de vent, plus de houle');
      // sur le rivage d'un biome terrestre (sonde) : la mer ET le ressac
      var plage = Amb.nappes({ biome: { id: 'plaines' }, merProche: 0.9, vent: 0.3 });
      A.gt(plage.mer, 0, 'la mer s\'entend depuis le rivage');
      A.gt(plage.ressac, 0, 'les vagues se brisent sur la côte');
      A.equal(mer.ressac, 0, 'pas de ressac au grand large, sans rivage');

      // rivière et cascade à proximité, indépendamment du biome
      var eauVive = Amb.nappes({ biome: { id: 'plaines' }, riviereProche: 0.8, cascadeProche: 0.3 });
      A.close(eauVive.riviere, 0.8, 1e-9, 'la rivière suit sa proximité');
      A.close(eauVive.cascade, 0.3, 1e-9, 'la cascade suit sa proximité');
      // des arbres alentour en plaine : leurs feuilles bruissent
      A.gt(Amb.nappes({ biome: { id: 'plaines' }, feuillageProche: 0.8, vent: 0.5 }).feuillage, 0, 'des arbres proches bruissent hors forêt');

      // ville à proximité, plus discrète la nuit
      var villeJour = Amb.nappes({ biome: { id: 'plaines' }, villeProche: 1 });
      var villeNuit = Amb.nappes({ biome: { id: 'plaines' }, nuit: true, villeProche: 1 });
      A.gt(villeJour.ville, 0, 'la rumeur de la ville se fait entendre');
      A.gt(villeJour.ville, villeNuit.ville, 'la ville est plus discrète la nuit');

      // sous terre : ni vent, ni pluie, ni feuillage — la roche résonne
      var grotte = Amb.nappes({ biome: { id: 'montagnes' }, sousTerre: true, pluie: 1, vent: 1 });
      A.equal(grotte.vent, 0, 'pas de vent sous terre');
      A.equal(grotte.pluie, 0, 'pas de pluie sous terre');
      A.equal(grotte.feuillage, 0, 'pas de feuillage sous terre');
      A.gt(grotte.grotte, 0, 'la roche résonne sous terre');

      // volcan proche : ça gronde, même en surface
      var volcan = Amb.nappes({ biome: { id: 'volcan' }, volcanProche: 1 });
      A.gt(volcan.volcan, 0, 'le volcan gronde');
    });

    it('SPEC-AUDIO-001 : la sonde du lieu trouve rivière, cascade, rivage et feuillage autour de l\'auditeur', function () {
      var T = MC.Eau.TYPES;
      // une rivière (eau de nature « rivière ») à 6 blocs à l'est
      var w = mondeBlocs();
      for (var z = -20; z <= 20; z++) { w.poser(6, 9, z, B.WATER); w.poser(6, 8, z, B.STONE); w.poser(5, 9, z, B.DIRT); w.poser(7, 9, z, B.DIRT); }
      var natRiv = function (x) { return x === 6 ? T.riviere : 0; };
      var s = Amb.sonderEnvironnement(w.lire, 0.5, 10, 0.5, { nature: natRiv });
      A.gt(s.riviere, 0.4, 'la rivière proche est entendue (' + s.riviere + ')');
      A.equal(s.cascade, 0, 'une rivière bordée de ses berges n\'est pas une cascade');
      A.equal(s.mer, 0, 'ni la mer');
      // plus loin, plus faible ; hors du rayon, rien
      var loin = Amb.sonderEnvironnement(w.lire, -8.5, 10, 0.5, { nature: natRiv });
      A.lt(loin.riviere, s.riviere, 'plus loin de la rivière, plus faible');
      A.equal(Amb.sonderEnvironnement(w.lire, -40.5, 10, 0.5, { nature: natRiv }).riviere, 0, 'hors de portée : silence');

      // une cascade : de l'eau courante dont un flanc donne sur le vide
      var wc = mondeBlocs();
      for (var y = 4; y <= 12; y++) { wc.poser(3, y, 0, B.EAU_7); wc.poser(4, y, 0, B.EAU_7); }   // un rideau de deux blocs de large
      wc.poser(3, 3, 0, B.STONE); wc.poser(4, 3, 0, B.STONE);
      var sc = Amb.sonderEnvironnement(wc.lire, 0.5, 10, 0.5, {});
      A.gt(sc.cascade, 0.5, 'la chute d\'eau gronde tout près (' + sc.cascade + ')');

      // le rivage : de l'eau profonde au niveau de la mer
      var wm = mondeBlocs(), N = C.SEA_LEVEL;
      for (var x = 4; x <= 20; x++) for (var zz = -20; zz <= 20; zz++) for (var yy = N - 5; yy <= N; yy++) wm.poser(x, yy, zz, B.WATER);
      var sm = Amb.sonderEnvironnement(wm.lire, 0.5, N + 1, 0.5, {});
      A.gt(sm.mer, 0.5, 'la mer est là, au bord de la plage (' + sm.mer + ')');

      // des arbres : leurs feuilles au-dessus de l'auditeur
      var wf = mondeBlocs();
      for (var fx = -15; fx <= 15; fx++) for (var fz = -15; fz <= 15; fz++) if ((fx * 7 + fz * 3) % 5) wf.poser(fx, 14, fz, B.LEAVES);   // une canopée trouée
      var sf = Amb.sonderEnvironnement(wf.lire, 0.5, 10, 0.5, {});
      A.gt(sf.feuillage, 0.5, 'sous les arbres, le feuillage (' + sf.feuillage + ')');
      A.equal(Amb.sonderEnvironnement(mondeBlocs().lire, 0, 10, 0, {}).feuillage, 0, 'en terrain nu, aucun feuillage');
      // budget : la sonde lit un nombre de blocs borné
      var lus = 0;
      Amb.sonderEnvironnement(function () { lus++; return 0; }, 0, 10, 0, {});
      A.lt(lus, 4000, 'la sonde reste bornée (' + lus + ' blocs lus)');
    });

    it('SPEC-AUDIO-001 : les nappes décidées sont synthétisées (boucles de bruit filtré, reliées à la sortie) et suivent leurs gains', function () {
      var f = audioFaux();
      var a = f.a;
      A.ok(a.majNappes({ biome: { id: 'plaines' }, riviereProche: 0.8, cascadeProche: 0.5, merProche: 0.7, vent: 0.4 }), 'les nappes se règlent, même contexte suspendu');
      var ctx = f.ctx();
      var boucles = ctx.noeuds.filter(function (n) { return n.genre === 'source' && n.loop; });
      A.equal(boucles.length, Amb.NAPPES.length, 'une boucle par nappe (' + boucles.length + ')');
      boucles.forEach(function (b) { A.ok(b.demarre && atteint(b, ctx.destination), 'chaque boucle tourne et atteint le haut-parleur'); });
      A.gt(a.gainsNappes.riviere, 0, 'la rivière monte');
      A.gt(a.gainsNappes.cascade, 0, 'la cascade monte');
      A.gt(a.gainsNappes.ressac, 0, 'le ressac monte');
      A.equal(a.gainsNappes.grotte, 0, 'la grotte reste muette en surface');
      var n0 = ctx.noeuds.length;
      a.majNappes({ biome: { id: 'plaines' } });
      A.equal(ctx.noeuds.length, n0, 'les nappes ne sont créées qu\'une fois : les régler ne crée aucun nœud');
      A.equal(a.gainsNappes.riviere, 0, 'loin de l\'eau, la rivière se tait');
    });

    it('SPEC-AUDIO-002 : la table des sons couvre chaque créature réelle du jeu (espèces de entities.js)', function () {
      var especes = Object.keys(MC.EntitySpecs).filter(Amb.estCreature);
      A.gt(especes.length, 40, 'des dizaines d\'espèces');
      A.ok(!Amb.estCreature('item') && !Amb.estCreature('arrow') && !Amb.estCreature('v_bateau'), 'ni objet au sol, ni flèche, ni véhicule');
      especes.forEach(function (e) {
        A.ok(!!Amb.ESPECES[e], 'l\'espèce « ' + e + ' » a sa voix dans la table');
      });
      Object.keys(Amb.ESPECES).forEach(function (e) {
        A.ok(!!MC.EntitySpecs[e], 'la table ne cite que des espèces du jeu (« ' + e + ' »)');
      });
      ['loup', 'vache', 'poule', 'zombie_fr', 'mouton'].forEach(function (fr) {
        A.ok(!Amb.ESPECES[fr], 'pas de nom inventé (« ' + fr + ' »)');
      });
    });

    it('SPEC-AUDIO-002 : chaque créature a ses sons — cri, pas, blessure, mort, attaque — selon ce qu\'elle est', function () {
      var signatures = {};
      Object.keys(Amb.ESPECES).forEach(function (e) {
        var sp = MC.EntitySpecs[e], v = Amb.voixCreature(e);
        A.ok(!!Amb.sonCreature(e, 'cri'), e + ' crie');
        A.ok(!!Amb.sonCreature(e, 'blesse'), e + ' a un cri de blessure');
        A.ok(!!Amb.sonCreature(e, 'mort'), e + ' a un son de mort');
        // elle attaque ⇔ elle fait des dégâts, tire ou pique
        var attaque = !!(sp.damage > 0 || sp.tir || sp.pique);
        A.equal(!!Amb.sonCreature(e, 'attaque'), attaque, e + ' : son d\'attaque si et seulement si elle attaque');
        // des pas ⇔ elle marche (ni oiseau, ni nageur qui ne touche pas le fond)
        var marche = !sp.volant && (!sp.nageur || !!sp.lest);
        A.equal(!!Amb.sonCreature(e, 'pas'), marche, e + ' : des pas si et seulement si elle marche');
        var cle = v.famille + '/' + v.hauteur;
        A.ok(!signatures[cle], e + ' a sa propre voix (déjà prise par ' + signatures[cle] + ')');
        signatures[cle] = e;
        A.ok(v.cri[0] > 0 && v.cri[1] >= v.cri[0], e + ' : une cadence de cris');
      });
      A.equal(Amb.sonCreature('wolf', 'cri'), 'cri_predateur', 'un loup hurle comme un prédateur');
      A.equal(Amb.sonCreature('zombie', 'cri'), 'cri_monstre', 'un zombie gémit comme un monstre');
      A.equal(Amb.sonCreature('sheep', 'cri'), 'cri_betail', 'un mouton bêle comme du bétail');
      A.equal(Amb.sonCreature('chicken', 'cri'), 'cri_volaille', 'une poule glousse comme une volaille');
      A.equal(Amb.sonCreature('fish', 'cri'), 'cri_aquatique', 'un poisson a un cri aquatique');
      A.equal(Amb.sonCreature('chicken', 'attaque'), null, 'une poule n\'attaque pas');
      A.equal(Amb.sonCreature('fish', 'pas'), null, 'un poisson ne marche pas');
      A.ok(Amb.ACTIONS_CREATURE.length === 5, 'cinq actions : cri, pas, blessure, mort, attaque');
      // une espèce inconnue retombe sur la famille générique plutôt que rien
      A.ok(!!Amb.sonCreature('espece_mystere', 'cri'), 'une espèce inconnue crie quand même (générique)');
    });

    it('SPEC-AUDIO-002 : pas et cris des créatures visibles, bornés en portée et en nombre', function () {
      var suivi = Amb.creerSuiviCreatures();
      var aud = [{ x: 0, y: 10, z: 0 }];
      var mouton = { eid: 1, type: 'sheep', pos: { x: 3, y: 10, z: 0 } };
      var poisson = { eid: 2, type: 'fish', pos: { x: -3, y: 8, z: 0 } };
      var lointain = { eid: 3, type: 'zombie', pos: { x: 80, y: 10, z: 0 } };
      var rand = function () { return 0.5; };
      var sons = [];
      for (var i = 0; i < 300; i++) {
        mouton.pos.x += 0.05; poisson.pos.x -= 0.05;          // 15 blocs chacun en 10 s
        sons = sons.concat(suivi.avancer([mouton, poisson, lointain], aud, 1 / 30, rand));
      }
      var pasMouton = sons.filter(function (s) { return s.eid === 1 && s.action === 'pas'; });
      A.between(pasMouton.length, 8, 16, 'le mouton qui marche fait des pas (' + pasMouton.length + ' pour 15 blocs)');
      A.equal(pasMouton[0].nom, Amb.sonCreature('sheep', 'pas'), 'ses pas sont ceux du mouton');
      A.equal(pasMouton[0].hauteur, Amb.voixCreature('sheep').hauteur, 'à la hauteur de sa voix');
      A.equal(sons.filter(function (s) { return s.eid === 2 && s.action === 'pas'; }).length, 0, 'le poisson nage sans bruit de pas');
      A.gt(sons.filter(function (s) { return s.eid === 1 && s.action === 'cri'; }).length, 0, 'le mouton finit par bêler');
      A.equal(sons.filter(function (s) { return s.eid === 3; }).length, 0, 'une créature hors de portée ne s\'entend pas');
      // budget : cent créatures qui crient en même temps — au plus 3 sons par image
      var foule = [];
      for (var k = 0; k < 100; k++) foule.push({ eid: 100 + k, type: 'zombie', pos: { x: (k % 10) - 5, y: 10, z: Math.floor(k / 10) - 5 } });
      var suivi2 = Amb.creerSuiviCreatures(), max = 0;
      for (var t = 0; t < 900; t++) max = Math.max(max, suivi2.avancer(foule, aud, 1 / 30, Math.random).length);
      A.ok(max <= 3, 'au plus 3 sons de créatures par image (' + max + ')');
      A.equal(suivi2.suivies, 100, 'les créatures proches sont suivies');
      suivi2.avancer([], aud, 1 / 30);
      A.equal(suivi2.suivies, 0, 'les créatures disparues sont oubliées');
    });

    it('SPEC-AUDIO-002 : blessure, mort et attaque relevées par le serveur, puis relayées aux seuls joueurs proches (message SONS)', function () {
      var NP = MC.NetProtocol;
      // le journal des créatures relève l'attaque, comme la blessure et la mort
      var w = flatWorld(10);
      var ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents, MC.Modes.regles('survie', 'facile'));
      pl.state.pos = { x: 0.5, y: 11, z: 0.5 }; pl.state.onGround = true;
      ents.spawn('zombie', 0.5, 11, -1);
      var journal = [];
      for (var i = 0; i < 400 && !journal.some(function (e) { return e.type === 'attaque'; }); i++) {
        ents.update(1 / 30, pl.state);
        journal = journal.concat(ents.evenements());
      }
      var att = journal.filter(function (e) { return e.type === 'attaque'; })[0];
      A.ok(att && att.espece === 'zombie' && att.pos, 'le coup du zombie est relevé avec son espèce et sa position');
      var mouton = ents.spawn('sheep', 3.5, 11, 0.5);
      ents.damage(mouton, 999, null, null);
      var j2 = ents.evenements();
      var sons = NP.sonsDepuisEvenements(journal.concat(j2).concat([{ type: 'naissance', espece: 'sheep' }]));
      A.ok(sons.some(function (s) { return s.k === 'attaque' && s.e === 'zombie'; }), 'attaque → son');
      A.ok(sons.some(function (s) { return s.k === 'blesse' && s.e === 'sheep'; }), 'blessure → son');
      A.ok(sons.some(function (s) { return s.k === 'mort' && s.e === 'sheep'; }), 'mort → son');
      A.ok(sons.every(function (s) { return s.k !== 'naissance'; }), 'une naissance ne fait pas de bruit');
      sons.forEach(function (s) { A.ok(isFinite(s.x) && isFinite(s.y) && isFinite(s.z), 'chaque son a sa position'); });
      // relayés aux joueurs proches seulement, au plus MAX_SONS
      var proche = NP.sonsPour(sons, [{ x: 0, z: 0 }]);
      A.equal(proche.length, sons.length, 'un joueur à côté les entend tous');
      A.equal(NP.sonsPour(sons, [{ x: 500, z: 0 }]).length, 0, 'un joueur lointain n\'en reçoit aucun');
      var beaucoup = [];
      for (var k = 0; k < 100; k++) beaucoup.push({ k: 'blesse', e: 'sheep', x: k * 0.3, y: 11, z: 0 });
      A.equal(NP.sonsPour(beaucoup, [{ x: 0, z: 0 }]).length, NP.MAX_SONS, 'plafonnés à ' + NP.MAX_SONS + ' par envoi');
      // le client ne garde que des évènements bien formés
      A.equal(NP.MSG.SONS, 'sons', 'un message SONS dédié');
      var v = NP.validerSons({ t: 'sons', l: [{ k: 'mort', e: 'wolf', x: 1, y: 2, z: 3 }, { k: 'pirate', e: 'x', x: 0, y: 0, z: 0 }, { k: 'mort', e: 'wolf', x: 'a', y: 0, z: 0 }, null] });
      A.equal(v.length, 1, 'genre inconnu, coordonnée invalide ou entrée vide : écartés');
      A.deep(NP.validerSons({ t: 'sons' }), [], 'un message sans liste ne lève rien');
      A.equal(NP.valider({ t: 'sons', l: [] }), null, 'jamais accepté d\'un client');
    });

    it('SPEC-AUDIO-002 : tous les sons de créature sont synthétisables, chaque espèce à sa hauteur', function () {
      var f = audioFaux({ maxVoix: 100000 });
      Object.keys(Amb.ESPECES).forEach(function (e) {
        Amb.ACTIONS_CREATURE.forEach(function (act) {
          var nom = Amb.sonCreature(e, act);
          if (!nom) return;
          A.ok(f.a.jouer(nom, { categorie: 'creature', hauteur: Amb.voixCreature(e).hauteur }), 'synthèse de « ' + nom + ' » (' + e + ')');
        });
      });
      // la hauteur change vraiment la fréquence jouée
      var ctx = f.ctx(), n0 = ctx.noeuds.length;
      f.a.jouer('cri_volaille', { categorie: 'creature', hauteur: 1 });
      var bas = sourcesDepuis(ctx, n0)[0];
      var n1 = ctx.noeuds.length;
      f.a.jouer('cri_volaille', { categorie: 'creature', hauteur: 2 });
      var haut = sourcesDepuis(ctx, n1)[0];
      A.ok(bas && haut, 'deux cris joués');
      A.gt(haut.frequency.value, bas.frequency.value * 1.5, 'une voix plus aiguë pour une hauteur plus grande');
    });

    it('SPEC-AUDIO-003 : les actions sonnent selon la matière — pas, minage, casse, pose, nage, chute, combat, tir', function () {
      var actions = ['pas', 'miner', 'casser', 'poser', 'nage', 'chute', 'combat', 'tir'];
      A.deep(Amb.ACTIONS_MATIERE, actions, 'les huit gestes de la fiche');
      actions.forEach(function (a) { A.ok(!!Amb.sonAction(a, 'pierre'), 'l\'action "' + a + '" a un son'); });
      A.equal(Amb.sonAction('sauter', 'pierre'), null, 'une action non listée ne renvoie rien');
      // même action, matière différente : noms distincts (des pas d'herbe et
      // de pierre ne se ressemblent pas)
      var matieres = ['herbe', 'pierre', 'sable', 'bois', 'neige', 'eau'];
      var noms = {};
      matieres.forEach(function (m) { noms[Amb.sonAction('pas', m)] = true; });
      A.equal(Object.keys(noms).length, matieres.length, 'chaque matière a son propre pas');
      // matière inconnue : repli sur la pierre plutôt qu'une exception
      A.equal(Amb.sonAction('pas', 'matiere_inconnue'), Amb.sonAction('pas', 'pierre'), 'repli sur la pierre');
    });

    it('SPEC-AUDIO-003 : la matière vient du bloc (et de l\'arme pour un coup)', function () {
      A.equal(Amb.matiereBloc(B.GRASS), 'herbe', 'herbe');
      A.equal(Amb.matiereBloc(B.STONE), 'pierre', 'pierre');
      A.equal(Amb.matiereBloc(B.COBBLE), 'pierre', 'pavé');
      A.equal(Amb.matiereBloc(B.SAND), 'sable', 'sable');
      A.equal(Amb.matiereBloc(B.PLANKS), 'bois', 'planches');
      A.equal(Amb.matiereBloc(B.LOG), 'bois', 'tronc');
      A.equal(Amb.matiereBloc(B.SNOW), 'neige', 'neige');
      A.equal(Amb.matiereBloc(B.WATER), 'eau', 'eau');
      A.equal(Amb.matiereBloc(B.EAU_3), 'eau', 'eau courante');
      A.equal(Amb.matiereBloc(B.DIRT), 'terre', 'terre');
      A.equal(Amb.matiereBloc(B.GRAVEL), 'gravier', 'gravier');
      A.equal(Amb.matiereBloc(B.WOOL), 'laine', 'laine');
      A.equal(Amb.matiereBloc(B.GLASS), 'verre', 'verre');
      A.equal(Amb.matiereBloc(B.LEAVES), 'feuilles', 'feuilles');
      A.equal(Amb.matiereBloc(B.GOLD_BLOCK), 'metal', 'bloc d\'or');
      A.equal(Amb.matiereBloc(0), null, 'l\'air n\'a pas de matière');
      // tous les blocs du jeu ont une matière connue, sans exception
      C.BLOCKS.forEach(function (d, id) {
        if (!d || !id) return;
        A.ok(Amb.MATIERES.indexOf(Amb.matiereBloc(id)) >= 0, 'le bloc ' + d.name + ' a une matière connue');
      });
      A.ok(Amb.MATIERES.indexOf(Amb.matiereBloc(65000)) >= 0, 'un id inconnu de cette version : une matière quand même');
      A.equal(Amb.matiereArme(I.IRON_SWORD), 'metal', 'épée de fer');
      A.equal(Amb.matiereArme(I.WOOD_SWORD), 'bois', 'épée de bois');
      A.equal(Amb.matiereArme(I.STONE_SWORD), 'pierre', 'épée de pierre');
      A.equal(Amb.matiereArme(0), 'laine', 'à mains nues, un coup mat');
    });

    it('SPEC-AUDIO-003 : pas, brasses et chute du joueur — selon le sol, la distance et la vitesse d\'arrivée', function () {
      var s = Amb.creerSuiviPas(), evts = [];
      var e = { x: 0, y: 11, z: 0, auSol: true, nage: false, vole: false, monte: false, vy: 0, matiere: 'herbe' };
      for (var i = 0; i < 100; i++) { e.x += 0.1; evts = evts.concat(s.avancer(e)); }   // 10 blocs à pied
      A.between(evts.length, 4, 7, 'un pas tous les 1,7 bloc environ (' + evts.length + ' pour 10 blocs)');
      A.ok(evts.every(function (x) { return x.action === 'pas' && x.matiere === 'herbe'; }), 'des pas d\'herbe');
      // immobile : rien
      var rien = [];
      for (var k = 0; k < 60; k++) rien = rien.concat(s.avancer(e));
      A.equal(rien.length, 0, 'immobile, aucun pas');
      // dans l'eau : des brasses
      e.nage = true; e.auSol = false; var nage = [];
      for (var n = 0; n < 60; n++) { e.x += 0.1; nage = nage.concat(s.avancer(e)); }
      A.ok(nage.length >= 2 && nage.every(function (x) { return x.action === 'nage'; }), 'des brasses dans l\'eau (' + nage.length + ')');
      // une chute : en l'air puis au sol en arrivant vite
      e.nage = false; e.auSol = false; e.vy = -15; s.avancer(e);
      e.auSol = true; e.vy = 0; e.matiere = 'pierre';
      var chute = s.avancer(e);
      A.ok(chute.length === 1 && chute[0].action === 'chute' && chute[0].matiere === 'pierre', 'la réception d\'une chute sonne sur la pierre');
      // un petit saut : un simple pas à la réception
      e.auSol = false; e.vy = -6; s.avancer(e); e.auSol = true; e.vy = 0;
      var saut = s.avancer(e);
      A.ok(saut.length === 1 && saut[0].action === 'pas', 'un petit saut se reçoit d\'un pas');
      // en vol ou en véhicule : aucun pas
      e.vole = true; var vol = [];
      for (var v = 0; v < 60; v++) { e.x += 0.2; vol = vol.concat(s.avancer(e)); }
      A.equal(vol.length, 0, 'en vol, aucun pas');
      // rythme du minage : un coup aussitôt, puis toutes les 0,25 s
      var r = Amb.creerRythme(0.25), coups = 0;
      for (var t = 0; t < 30; t++) if (r.avancer(1 / 30, true)) coups++;
      A.between(coups, 4, 5, 'quatre ou cinq coups de pioche par seconde (' + coups + ')');
      A.notOk(r.avancer(1 / 30, false), 'on ne mine plus : silence');
      A.ok(r.avancer(1 / 30, true), 'on reprend : le premier coup part aussitôt');
    });

    it('SPEC-AUDIO-003 : chaque geste sur chaque matière est synthétisé (des nœuds réellement créés et reliés)', function () {
      var f = audioFaux({ maxVoix: 100000 });
      Amb.ACTIONS_MATIERE.forEach(function (act) {
        Amb.MATIERES.forEach(function (m) {
          var ctx = f.ctx(), n0 = ctx.noeuds.length;
          A.ok(f.a.jouer(Amb.sonAction(act, m), { categorie: 'action' }), act + ' sur ' + m);
          var src = sourcesDepuis(ctx, n0);
          A.ok(src.length > 0 && src.every(function (s) { return s.demarre && atteint(s, ctx.destination); }), act + '/' + m + ' : des sources qui démarrent et atteignent la sortie');
        });
      });
      A.notOk(f.a.jouer('action_sauter_pierre', {}), 'un geste inconnu ne joue rien');
    });

    it('SPEC-AUDIO-004 : les interactions ont leur son — portes, trappes, coffres, fourneau, établi, échanges, interface', function () {
      var f = audioFaux();
      ['porte', 'trappe', 'coffre', 'fourneau', 'etabli', 'echange', 'interface'].forEach(function (t) {
        A.ok(!!Amb.sonInteraction(t), 'l\'interaction "' + t + '" a un son');
        A.ok(f.a.jouer(Amb.sonInteraction(t), { categorie: 'interaction' }), 'et il est synthétisé (' + t + ')');
      });
      A.equal(Amb.sonInteraction('inconnue'), null, 'une interaction non listée ne renvoie rien');
      A.ok(f.a.play('clic'), 'le clic des menus (ui.js) a un son');
      // une trappe sonne comme une trappe, une porte comme une porte
      A.equal(Amb.interactionBloc(B.TRAPPE_FERMEE), 'trappe', 'trappe fermée');
      A.equal(Amb.interactionBloc(B.TRAPPE_OUVERTE), 'trappe', 'trappe ouverte');
      A.equal(Amb.interactionBloc(B.PORTE_FERMEE_N), 'porte', 'porte fermée');
      A.equal(Amb.interactionBloc(B.PORTE_OUVERTE_E), 'porte', 'porte ouverte');
      A.ok(Amb.sonInteraction('trappe') !== Amb.sonInteraction('porte'), 'deux sons distincts');
    });

    it('SPEC-AUDIO-005 : les événements ont leur son — tonnerre, éruption, cyclone, tornade, succès, chapitres/fins, réveil de gardien', function () {
      var f = audioFaux();
      ['tonnerre', 'eruption', 'cyclone', 'tornade', 'succes', 'chapitre', 'fin', 'gardien'].forEach(function (t) {
        A.ok(!!Amb.sonEvenement(t), 'l\'événement "' + t + '" a un son');
        A.ok(f.a.jouer(Amb.sonEvenement(t), { categorie: 'evenement' }), 'et il est synthétisé (' + t + ')');
      });
      A.equal(Amb.sonEvenement('inconnu'), null, 'un événement non listé ne renvoie rien');
      // le tonnerre lointain arrive en retard (340 blocs/s) et panoramique vers l'éclair
      var ctx = f.ctx(), n0 = ctx.noeuds.length;
      A.close(f.a.tonnerre(680, 1, { x: 680, z: 0 }), 2, 1e-9, 'deux secondes de retard à 680 blocs');
      var pans = ctx.noeuds.slice(n0).filter(function (n) { return n.genre === 'pan'; });
      A.ok(pans.length === 1 && pans[0].pan.value > 0.9, 'un éclair à l\'est gronde à droite');
    });

    it('SPEC-AUDIO-005 : cyclone et tornade s\'annoncent quand ils approchent, puis grondent à intervalles', function () {
      var s = Amb.creerSuiviMeteo(), aud = { x: 0, z: 0 };
      A.equal(s.avancer({ temps: 0, cyclone: 0.05, tornades: [] }, aud).length, 0, 'vent ordinaire : rien');
      var c = s.avancer({ temps: 1, cyclone: 0.5, tornades: [] }, aud);
      A.ok(c.length === 1 && c[0].type === 'cyclone' && c[0].nom === Amb.sonEvenement('cyclone'), 'le cyclone arrive : il s\'annonce');
      A.equal(s.avancer({ temps: 3, cyclone: 0.5, tornades: [] }, aud).length, 0, 'pas à chaque image');
      A.equal(s.avancer({ temps: 11, cyclone: 0.5, tornades: [] }, aud).length, 1, 'il gronde de nouveau quelques secondes plus tard');
      var tn = { id: 'tn1', x: 100, z: 0, force: 0.8 };
      var t1 = s.avancer({ temps: 12, cyclone: 0, tornades: [tn] }, aud);
      A.ok(t1.length === 1 && t1[0].type === 'tornade' && t1[0].x === 100, 'une tornade à 100 blocs gronde là où elle est');
      A.equal(s.avancer({ temps: 13, cyclone: 0, tornades: [tn] }, aud).length, 0, 'sans se répéter à chaque image');
      A.equal(s.avancer({ temps: 17, cyclone: 0, tornades: [tn] }, aud).length, 1, 'elle reprend toutes les quelques secondes');
      A.equal(s.avancer({ temps: 30, cyclone: 0, tornades: [{ id: 'tn2', x: 900, z: 0 }] }, aud).length, 0, 'une tornade lointaine ne s\'entend pas');
    });

    it('SPEC-AUDIO-006 : spatialisation (volume + panoramique selon la position), étouffement sous l\'eau/roche, volumes par catégorie', function () {
      var auditeur = { x: 0, y: 0, z: 0, yaw: 0 };
      // au même endroit : plein volume, pas de panoramique
      var ici = Amb.spatialiser(auditeur, { x: 0, y: 0, z: 0 }, {});
      A.close(ici.gain, 1, 1e-6, 'source confondue avec l\'auditeur : gain plein');
      A.close(ici.pan, 0, 1e-6, 'pas de panoramique à distance nulle');

      // plus loin, moins fort ; hors de portée, silence
      var proche = Amb.spatialiser(auditeur, { x: 5, y: 0, z: 0 }, { portee: 24 });
      var loin = Amb.spatialiser(auditeur, { x: 20, y: 0, z: 0 }, { portee: 24 });
      var horsPortee = Amb.spatialiser(auditeur, { x: 100, y: 0, z: 0 }, { portee: 24 });
      A.gt(proche.gain, loin.gain, 'plus loin, plus faible');
      A.equal(horsPortee.gain, 0, 'hors de portée : silence');

      // une source à droite (yaw=0, +x = droite) panoramique à droite
      var droite = Amb.spatialiser(auditeur, { x: 10, y: 0, z: 0 }, {});
      var gauche = Amb.spatialiser(auditeur, { x: -10, y: 0, z: 0 }, {});
      A.gt(droite.pan, 0, 'une source à droite panoramique à droite');
      A.lt(gauche.pan, 0, 'une source à gauche panoramique à gauche');
      // le joueur se retourne : la même source passe à gauche
      A.lt(Amb.spatialiser({ x: 0, y: 0, z: 0, yaw: Math.PI }, { x: 10, y: 0, z: 0 }, {}).pan, 0, 'retourné, la source passe à gauche');

      // étouffement : sous l'eau et derrière la roche
      var normal = Amb.spatialiser(auditeur, { x: 5, y: 0, z: 0 }, {});
      var sousEau = Amb.spatialiser(auditeur, { x: 5, y: 0, z: 0 }, { sousEau: true });
      var roche = Amb.spatialiser(auditeur, { x: 5, y: 0, z: 0 }, { roche: true });
      var murEpais = Amb.spatialiser(auditeur, { x: 5, y: 0, z: 0 }, { roche: 4 });
      A.lt(sousEau.gain, normal.gain, 'un son est étouffé sous l\'eau');
      A.lt(roche.gain, normal.gain, 'un son est étouffé derrière la roche');
      A.lt(murEpais.gain, roche.gain, 'plus de roche, plus étouffé');
      A.lt(roche.coupure, normal.coupure, 'la roche filtre plus que l\'air libre');
      A.equal(normal.coupure, 20000, 'pas de filtrage sans occlusion');
      A.equal(Amb.spatialiser(auditeur, { x: 5, y: 0, z: 0 }, { roche: 0 }).coupure, 20000, 'zéro bloc de roche : pas de filtre');
      // l'auditeur sous l'eau : tout passe au filtre
      A.lt(Amb.etouffementAuditeur(true).coupure, 2000, 'tête sous l\'eau : passe-bas');
      A.equal(Amb.etouffementAuditeur(false).coupure, 20000, 'à l\'air : rien');

      // volumes par catégorie : un réglage explicite l'emporte sur le défaut
      A.equal(Amb.volumeCategorie('creature', {}), Amb.VOLUMES_DEFAUT.creature, 'sans réglage, le défaut de la catégorie');
      A.equal(Amb.volumeCategorie('creature', { creature: 0.2 }), 0.2, 'le réglage explicite l\'emporte');
      A.between(Amb.volumeCategorie('creature', { creature: 5 }), 0, 1, 'le volume reste borné à [0,1]');
      Amb.CATEGORIES.forEach(function (c) {
        A.ok(Amb.VOLUMES_DEFAUT[c] !== undefined, 'la catégorie "' + c + '" a un volume par défaut');
      });
    });

    it('SPEC-AUDIO-006 : occlusion par échantillonnage — la roche entre la source et l\'auditeur se compte, l\'air et le verre non', function () {
      var w = flatWorld(10, B.STONE);
      var a = { x: 0.5, y: 11.6, z: 0.5 }, b = { x: 8.5, y: 11.6, z: 0.5 };
      A.equal(Amb.occlusion(w.getBlock, a, b).roche, 0, 'à découvert, aucune roche');
      for (var y = 11; y <= 13; y++) w.setBlock(4, y, 0, B.STONE);
      A.equal(Amb.occlusion(w.getBlock, a, b).roche, 1, 'un mur de pierre : un bloc');
      w.setBlock(5, 11, 0, B.STONE);
      A.equal(Amb.occlusion(w.getBlock, a, b).roche, 2, 'deux blocs d\'épaisseur');
      var w2 = flatWorld(10, B.STONE);
      w2.setBlock(4, 11, 0, B.GLASS); w2.setBlock(5, 11, 0, B.LEAVES);
      A.equal(Amb.occlusion(w2.getBlock, a, b).roche, 0, 'le verre et les feuilles ne bloquent pas');
      w2.setBlock(6, 11, 0, B.WATER);
      A.equal(Amb.occlusion(w2.getBlock, a, b).eau, 1, 'l\'eau traversée se compte à part');
      // un son SOUS terre (le minage d'un bloc dans un tunnel) : la source n'est pas comptée
      A.equal(Amb.occlusion(w.getBlock, a, { x: 0.5, y: 10.5, z: 0.5 }).roche, 0, 'le bloc qui sonne lui-même ne s\'occulte pas');
      var lus = 0;
      Amb.occlusion(function () { lus++; return 0; }, { x: 0, y: 0, z: 0 }, { x: 500, y: 0, z: 0 });
      A.ok(lus <= 48, 'échantillonnage borné (' + lus + ')');
      A.ok(Amb.bloqueSon(B.STONE) && !Amb.bloqueSon(0) && !Amb.bloqueSon(B.GLASS) && !Amb.bloqueSon(B.WATER), 'ce qui arrête le son');
    });

    it('SPEC-AUDIO-006 : écran partagé — chaque son se règle sur l\'auditeur le plus proche ; budget de voix borné et priorisé', function () {
      var auds = [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }];
      A.equal(Amb.choisirAuditeur(auds, { x: 90, y: 0, z: 0 }), 1, 'le joueur 2 est le plus proche');
      A.equal(Amb.choisirAuditeur(auds, { x: 10, y: 0, z: 0 }), 0, 'le joueur 1 est le plus proche');
      A.equal(Amb.choisirAuditeur([auds[0]], { x: 90, y: 0, z: 0 }), 0, 'un seul auditeur : lui');
      // budget pur
      var pleines = [{ categorie: 'creature', gain: 0.3 }, { categorie: 'action', gain: 0.8 }];
      A.deep(Amb.admettreVoix([], { categorie: 'creature', gain: 0.1 }, 2), { admis: true, evincer: -1 }, 'de la place : admis');
      A.deep(Amb.admettreVoix(pleines, { categorie: 'evenement', gain: 0.5 }, 2), { admis: true, evincer: 0 }, 'plein : un événement évince la créature');
      A.equal(Amb.admettreVoix(pleines, { categorie: 'creature', gain: 0.1 }, 2).admis, false, 'plein : un faible cri est refusé');
      A.ok(Amb.PRIORITES.evenement > Amb.PRIORITES.creature, 'les événements passent avant les créatures');

      // exécution : jamais plus de maxVoix sons à la fois
      var f = audioFaux({ maxVoix: 6 });
      for (var i = 0; i < 40; i++) f.a.jouer('cri_monstre', { categorie: 'creature' });
      A.equal(f.a.voixActives, 6, 'au plus 6 voix');
      A.gt(f.a.stats.refuses, 0, 'les suivantes sont refusées');
      A.ok(f.a.jouer('succes', { categorie: 'evenement' }), 'un succès passe quand même');
      A.equal(f.a.voixActives, 6, 'en évinçant une voix moins importante');
      A.equal(f.a.stats.evinces, 1, 'une voix évincée');
      var ctx = f.ctx();
      ctx.currentTime = 30;                                     // tout s'est éteint
      A.equal(f.a.voixActives, 0, 'les voix finies libèrent leur place');

      // spatialisation exécutée : panoramique et passe-bas d'occlusion sur le bus
      var g2 = audioFaux(), c2 = g2.ctx();
      g2.a.auditeursVues([{ x: 0, y: 0, z: 0, yaw: 0 }, { x: 100, y: 0, z: 0, yaw: 0 }]);
      var n0 = c2.noeuds.length;
      A.ok(g2.a.jouer('porte', { categorie: 'interaction', x: 106, y: 0, z: 0, roche: 2 }), 'une porte près du joueur 2, derrière la roche');
      var neufs = c2.noeuds.slice(n0);
      var pan = neufs.filter(function (n) { return n.genre === 'pan'; })[0];
      var lp = neufs.filter(function (n) { return n.genre === 'filtre' && n.frequency.value < 2000; });
      A.ok(pan && pan.pan.value > 0.9, 'à droite du joueur 2, pas à 106 blocs du joueur 1');
      A.ok(lp.length >= 1, 'étouffée par un passe-bas');
      A.equal(g2.a.jouer('porte', { categorie: 'interaction', x: 50, y: 0, z: 0 }), false, 'à 50 blocs des deux : inaudible, aucune voix');
      // tête sous l'eau : le filtre de l'auditeur se ferme
      g2.a.setSousEau(true);
      var filtres = c2.noeuds.filter(function (n) { return n.genre === 'filtre' && n.frequency.value === Amb.etouffementAuditeur(true).coupure; });
      A.ok(filtres.length >= 1 && g2.a.sousEau, 'sous l\'eau : tout passe par le passe-bas de l\'auditeur');
    });

    it('SPEC-AUDIO-006 : chaque catégorie a son volume dans les options, appliqué aux sons', function () {
      var O = MC.Options;
      Amb.CATEGORIES.forEach(function (c) {
        var k = Amb.OPTIONS_VOLUME[c], r = O.REGLAGES[k];
        A.ok(!!r, 'un réglage d\'options pour « ' + c + ' » (' + k + ')');
        A.ok(r.min === 0 && r.max === 1, 'de 0 à 1');
        A.close(r.defaut, Amb.VOLUMES_DEFAUT[c], 1e-9, 'par défaut, le mixage d\'origine');
        A.equal(O.defauts()[k], r.defaut, 'présent dans les options par défaut');
      });
      A.equal(O.regler(O.defauts(), 'volumeCreatures', 3).volumeCreatures, 1, 'borné par les options');
      // appliqué : un bus de créature à volume nul ne joue plus
      var f = audioFaux();
      f.a.volumeCategorie('creature', 0);
      A.equal(f.a.jouer('cri_monstre', { categorie: 'creature' }), false, 'créatures à 0 : muettes');
      A.ok(f.a.jouer('succes', { categorie: 'evenement' }), 'les autres catégories jouent');
      f.a.volumeCategorie('creature', 0.5);
      var ctx = f.ctx(), n0 = ctx.noeuds.length;
      f.a.jouer('cri_monstre', { categorie: 'creature' });
      var bus = ctx.noeuds[n0];
      A.close(bus.gain.value, 0.5, 1e-9, 'le bus du son porte le volume de sa catégorie');
      f.a.volumeCategorie('ambiance', 0.25);
      f.a.majNappes({ biome: { id: 'ocean', marin: true }, vent: 0 });
      A.close(f.a.gainsNappes.mer, Amb.nappes({ biome: { id: 'ocean', marin: true }, vent: 0 }).mer * 0.25, 1e-9, 'les nappes suivent le volume d\'ambiance');
    });

    it('SPEC-AUDIO-006 : sans WebAudio, ni exception ni son prétendu ; contexte suspendu toléré', function () {
      var sans = MC.createAudio({ AudioContext: null });
      if (typeof G.AudioContext === 'undefined' && typeof G.webkitAudioContext === 'undefined') {
        A.equal(sans.jouer('succes', { categorie: 'evenement' }), false, 'pas de WebAudio : rien ne joue');
        A.equal(sans.majNappes({}), false, 'ni les nappes');
      }
      var f = audioFaux();
      A.equal(f.ctx().state, 'running', 'resume() réveille un contexte suspendu');
      var g3 = MC.createAudio({ AudioContext: function () { var c = FauxContexte(); c.resume = function () { throw new Error('refus'); }; return c; } });
      A.equal(g3.resume(), false, 'un réveil refusé (pas de geste utilisateur) ne lève rien');
      A.ok(g3.jouer('succes', { categorie: 'evenement' }), 'les nœuds se créent quand même, ils sonneront au réveil');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
