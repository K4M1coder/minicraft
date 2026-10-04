/* spec-horizon.js — tests des specs SPEC-NAGE-008, SPEC-TEXTURE-*, SPEC-CIEL-*,
   SPEC-RELIEF-*, SPEC-LAVE-*, SPEC-VEHIC-011, SPEC-CARTE-*, SPEC-FACTION-* et
   SPEC-SYNC-*. Sortie de l'eau, textures, ciel, relief, carte, factions, et
   synchronisation client / serveur autoritaire. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, P = MC.Physics, M = MC.Modes, DC = MC.DayCycle, SY = MC.Synchro, F = MC.Factions;
  var B = C.B, I = C.I, SEA = C.SEA_LEVEL;
  var flatWorld = G.flatWorld, seededRand = G.seededRand;

  var mondes = {};
  function monde(g) { g = g || 20260921; if (!mondes[g]) mondes[g] = MC.createWorld(g); return mondes[g]; }

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — sortir de l eau', function () {
    // mer en z < 0, berge en z >= 0 dont le sommet est à SEA + hb
    function rivage(hb) {
      return {
        getBlock: function (x, y, z) {
          y = Math.floor(y); z = Math.floor(z);
          if (z >= 0) return y <= SEA + hb - 1 ? B.SAND : 0;
          if (y <= 15) return B.SAND;
          return y <= SEA ? B.WATER : 0;
        },
        groundAt: function () { return SEA; },
      };
    }
    it('SPEC-NAGE-008 : on se hisse hors de l eau sur une berge jusqu a deux blocs', function () {
      [0, 1, 2].forEach(function (hb) {
        var w = rivage(hb);
        var pl = MC.createPlayer(w, MC.createEntities(w), M.regles('survie', 'facile'));
        pl.state.pos = { x: 0.5, y: SEA - 1, z: -3.5 };
        pl.state.yaw = Math.PI;                         // face à la terre (+z)
        for (var i = 0; i < 300; i++) pl.updateMovement(1 / 60, { forward: 1, jump: 1 });
        A.ok(pl.state.pos.z > 0.3, 'berge +' + hb + ' : sorti (z = ' + pl.state.pos.z.toFixed(2) + ')');
      });
      var mur = rivage(5);
      A.equal(P.elanPourSortir(mur, { x: 0.5, y: SEA - 1, z: -0.4 }, { x: 0, z: 1 }, 0.6, 1.8), 0,
              'un mur trop haut ne se franchit pas');
      A.ok(P.elanPourSortir(rivage(1), { x: 0.5, y: SEA - 1, z: -0.4 }, { x: 0, z: 1 }, 0.6, 1.8) > 0,
           'une berge basse, si');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — textures', function () {
    it('SPEC-TEXTURE-001 : les tuiles de terrain ont des variantes stables par position', function () {
      var l = C.INDEX_VARIANTES[0];
      A.ok(l && l.length >= 3, 'l herbe a plusieurs variantes');
      A.equal(l[0], 0, 'la première est la tuile de base');
      var toutes = [];
      Object.keys(C.INDEX_VARIANTES).forEach(function (k) { toutes = toutes.concat(C.INDEX_VARIANTES[k].slice(1)); });
      A.equal(toutes.length, new Set(toutes).size, 'aucune variante partagée');
      A.ok(toutes.every(function (t) { return t >= C.PREMIERE_VARIANTE; }), 'rangées après les tuiles de base');
      var vus = {};
      for (var i = 0; i < 200; i++) vus[C.tuileVariante(0, MC.Mesher.hachePos(i, 30, i * 7, 3), true).tile] = 1;
      A.ok(Object.keys(vus).length >= 3, 'un sol mélange ses variantes');
      var h = MC.Mesher.hachePos(5, 6, 7, 3);
      A.deep(C.tuileVariante(0, h, true), C.tuileVariante(0, h, true), 'même bloc, même variante');
      A.equal(C.tuileVariante(1, 0.7, true).rot, 0, 'une tuile de côté ne tourne jamais');
      A.equal(C.tuileVariante(8, 0.7, true).tile, 8, 'une tuile sans variante reste elle-même');
    });

    it('SPEC-TEXTURE-002 : les coordonnees restent dans la tuile, sans deborder sur la voisine', function () {
      var uvs = [];
      [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (p) {
        for (var r = 0; r < 4; r++) MC.Mesher.pushUV(uvs, 17, p[0], p[1], r);
      });
      var cols = MC.Mesher.ATLAS_COLS, rows = MC.Mesher.ATLAS_ROWS;
      var u0 = (17 % cols) / cols, u1 = (17 % cols + 1) / cols;
      for (var i = 0; i < uvs.length; i += 2) {
        A.ok(uvs[i] > u0 && uvs[i] < u1, 'u strictement dans la tuile');
      }
      A.ok(MC.Mesher.MARGE_UV > 0, 'une marge d un demi-texel');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — ciel', function () {
    it('SPEC-CIEL-001 : le soleil est haut le jour, sous l horizon la nuit ; la lune a l oppose', function () {
      var L = DC.DAY_LENGTH;
      var midi = DC.astres(L * ((DC.LEVER + (DC.COUCHER + 1 - DC.LEVER) / 2) % 1));
      A.ok(midi.soleil.y > 0.8, 'au zénith en milieu de journée');
      var nuit = DC.astres(L * 0.72);
      A.ok(nuit.soleil.y < 0, 'la nuit, le soleil est couché');
      A.ok(nuit.lune.y > 0, 'et la lune levée');
      A.ok(Math.abs(nuit.soleil.x + nuit.lune.x) < 1e-9, 'diamétralement opposés');
      A.ok(nuit.etoiles > 0.9 && midi.etoiles === 0, 'étoiles la nuit seulement');
      // lever et coucher tombent sur l'horizon
      A.ok(Math.abs(DC.astres(L * DC.LEVER).soleil.y) < 0.02, 'lever à l horizon');
      A.ok(Math.abs(DC.astres(L * DC.COUCHER).soleil.y) < 0.02, 'coucher aussi');
    });
    it('SPEC-CIEL-002 : la lune passe par huit phases, une par jour', function () {
      var vues = {};
      for (var j = 0; j < 8; j++) vues[DC.astres(DC.DAY_LENGTH * (j + 0.7)).phaseLune] = 1;
      A.equal(Object.keys(vues).length, 8);
      A.equal(DC.astres(DC.DAY_LENGTH * 8.7).phaseLune, DC.astres(DC.DAY_LENGTH * 0.7).phaseLune, 'cycle de huit jours');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — relief', function () {
    var Bi = MC.Biomes.creer(monde().noise);
    /* Balayage en spirale. Les volcans, désormais cantonnés aux montagnes
       (SPEC-RELIEF-007), sont plus clairsemés qu'avant : 32 angles par anneau
       laissaient passer des cratères entiers entre deux rayons. 256 angles
       referment ces trous, sans coût notable (quelques dizaines de ms). */
    function chercher(pred, pas) {
      var angles = 256;
      for (var r = 0; r < 6000; r += pas || 29) for (var a = 0; a < angles; a++) {
        var x = Math.round(Math.cos(a / angles * 6.283) * r), z = Math.round(Math.sin(a / angles * 6.283) * r);
        if (pred(x, z)) return [x, z];
      }
      return null;
    }

    it('SPEC-RELIEF-001 : des volcans de basalte, un cratere plein de lave', function () {
      // le fond du cratère, là où la lave recouvre le sol (pas sur le rebord)
      var p = chercher(function (x, z) { var c = Bi.colonne(x, z); return c.lave > c.h; }, 11);
      A.ok(p, 'un cratère existe');
      var col = Bi.colonne(p[0], p[1]);
      A.ok(col.lave > col.h, 'la lave remplit le cratère');
      var w = monde();
      w.getChunk(Math.floor(p[0] / 16), Math.floor(p[1] / 16), true);
      A.equal(w.getBlock(p[0], col.lave, p[1]), B.LAVA, 'de la lave en surface du cratère');
      var v = Bi.volcanProche(p[0], p[1]);
      A.ok(v && v.sommet > SEA + 25, 'un vrai relief : sommet à ' + v.sommet);
      A.equal(Bi.volcanDe(Math.floor(v.x / 384), Math.floor(v.z / 384)), v, 'volcan stable par région');
      A.equal(Bi.biomeAt(v.x + Math.round(v.R * 0.5), v.z).id, 'volcan', 'ses flancs forment le biome volcan');
    });

    it('SPEC-RELIEF-002 : des lacs au-dessus du niveau de la mer', function () {
      var p = chercher(function (x, z) { var c = Bi.colonne(x, z); return c.climat.lac && c.eau > SEA + 2; });
      A.ok(p, 'un lac perché existe');
      var col = Bi.colonne(p[0], p[1]);
      var l = Bi.lacProche(p[0], p[1]);
      A.equal(col.eau, l.niveau, 'une seule surface pour tout le lac');
      A.equal(Bi.lacDe(Math.floor(l.x / 160), Math.floor(l.z / 160)), l, 'lac stable par région');
      var w = monde();
      w.getChunk(Math.floor(p[0] / 16), Math.floor(p[1] / 16), true);
      var b = w.getBlock(p[0], col.eau, p[1]);
      A.ok(b === B.WATER || b === B.ICE || C.isWater(b), 'de l eau (ou sa glace) au niveau du lac');
      A.notOk(MC.Biomes.LISTE[Bi.classer(col.climat, col.h)].marin, 'un lac garde son biome terrestre');
    });

    it('SPEC-RELIEF-003 : des falaises', function () {
      var pire = 0;
      for (var x = -3000; x <= 3000 && pire < 7; x += 7) for (var z = -3000; z <= 3000 && pire < 7; z += 131) {
        var c = Bi.colonne(x, z);
        if (!(c.climat.falaise > 0.5 || c.climat.escarpement > 0.5)) continue;
        pire = Math.max(pire, Math.abs(Bi.hauteur(x + 1, z) - c.h), Math.abs(Bi.hauteur(x, z + 1) - c.h));
      }
      A.ok(pire >= 7, 'une paroi de sept blocs au moins (' + pire + ')');
    });

    it('SPEC-RELIEF-004 : les hauteurs froides portent des glaciers de glace bleue', function () {
      var p = chercher(function (x, z) { return Bi.biomeAt(x, z).id === 'glacier'; }, 17);
      A.ok(p, 'un glacier existe');
      var w = monde();
      var c = w.getChunk(Math.floor(p[0] / 16), Math.floor(p[1] / 16), true), n = 0;
      for (var i = 0; i < c.blocks.length; i++) if (c.blocks[i] === B.BLUE_ICE) n++;
      A.ok(n > 0, 'de la glace bleue en surface (' + n + ')');
      A.equal(MC.Donjons.typePour(MC.Biomes.LISTE.glacier, 50, 0.5), 'forteresse_glace', 'une forteresse l habite');
      A.equal(MC.Donjons.typePour(MC.Biomes.LISTE.volcan, 50, 0.5), null, 'aucun donjon dans un volcan');
    });

    it('SPEC-RELIEF-005 : grottes, cavernes et lacs de lave profonds', function () {
      var w = monde(), lave = 0, vide = 0;
      for (var cx = 0; cx < 3; cx++) {
        var c = w.getChunk(cx, 5, true);
        for (var x = 0; x < 16; x++) for (var z = 0; z < 16; z++) for (var y = 1; y < 30; y++) {
          var b = c.blocks[C.idx(x, y, z)];
          if (b === B.LAVA && y <= 6) lave++;
          if (b === 0) vide++;
        }
      }
      A.ok(vide > 0, 'des vides souterrains');
      A.ok(w.isCave(0, 1, 0, 40) === false, 'jamais au ras du socle');
      A.ok(lave >= 0, 'la lave ne se trouve que tout au fond');
    });

    /* Régions de volcans balayées directement (volcanDe est pur et bon marché) :
       pas besoin d'une spirale de recherche pour rassembler un échantillon. */
    function volcansRegion(rmin, rmax) {
      var liste = [];
      for (var rx = rmin; rx <= rmax; rx++) for (var rz = rmin; rz <= rmax; rz++) {
        var v = Bi.volcanDe(rx, rz);
        if (v) liste.push(v);
      }
      return liste;
    }

    it('SPEC-RELIEF-007 : un volcan se dresse sur une montagne ou une chaîne, jamais en plaine', function () {
      var vs = volcansRegion(-18, 18);
      A.ok(vs.length >= 10, 'assez de volcans échantillonnés (' + vs.length + ')');
      vs.forEach(function (v) {
        A.ok(Bi.climat(v.x, v.z).montagne >= 0.25,
             'volcan à (' + v.x + ',' + v.z + ') sur relief montagneux (montagne=' + Bi.climat(v.x, v.z).montagne.toFixed(2) + ')');
      });
    });

    it('SPEC-RELIEF-008 : des volcans s alignent parfois en chaîne le long d une crête', function () {
      var vs = volcansRegion(-18, 18);
      var groupes = {};
      vs.forEach(function (v) { if (v.chaine) (groupes[v.chaine] = groupes[v.chaine] || []).push(v); });
      var chaine = Object.keys(groupes).map(function (k) { return groupes[k]; }).filter(function (g) { return g.length >= 2; })[0];
      A.ok(chaine, 'au moins une chaîne de deux volcans ou plus existe');
      // deux membres consécutifs d'une même chaîne restent des voisins de crête, pas à l'autre bout du monde
      var d = Math.hypot(chaine[0].x - chaine[1].x, chaine[0].z - chaine[1].z);
      A.ok(d < 1200, 'les volcans de la chaîne sont proches (' + d.toFixed(0) + ' blocs)');
      chaine.forEach(function (v) { A.ok(Bi.climat(v.x, v.z).montagne >= 0.25, 'la chaîne suit un relief montagneux'); });
    });

    it('SPEC-RELIEF-009 : des volcans sont éteints, sans lave, un lac ou de l herbe au cratère', function () {
      var vs = volcansRegion(-18, 18);
      var eteints = vs.filter(function (v) { return !v.actif; });
      A.ok(eteints.length > 0, 'des volcans éteints existent (' + eteints.length + ')');
      eteints.forEach(function (v) {
        var col = Bi.colonne(v.x, v.z);
        A.equal(col.lave, 0, 'aucune lave dans un cratère éteint');
      });
      // au centre d'un cratère éteint : soit un lac (eau au-dessus du sol), soit de l'herbe (biome ambiant)
      var v = eteints[0];
      var col = Bi.colonne(v.x, v.z);
      A.ok(col.eau > col.h || Bi.biomeAt(v.x, v.z).id !== 'volcan',
           'le cratère éteint redevient un lac ou un paysage ordinaire');
      var w = monde();
      w.getChunk(Math.floor(v.x / 16), Math.floor(v.z / 16), true);
      A.notEqual(w.getBlock(v.x, Math.min(C.WORLD_H - 1, col.h + 1), v.z), B.LAVA, 'pas de lave visible dans un cratère éteint');
    });

    it('SPEC-RELIEF-010 : trois profils de volcans — stratovolcan, bouclier, caldeira', function () {
      var vs = volcansRegion(-18, 18);
      var types = {};
      vs.forEach(function (v) { (types[v.type] = types[v.type] || []).push(v); });
      ['stratovolcan', 'bouclier', 'caldeira'].forEach(function (t) {
        A.ok(types[t] && types[t].length > 0, 'le profil ' + t + ' apparaît');
      });
      function moyR(t) { return types[t].reduce(function (s, v) { return s + v.R; }, 0) / types[t].length; }
      function moyRatioCratere(t) { return types[t].reduce(function (s, v) { return s + v.cratere / v.R; }, 0) / types[t].length; }
      A.ok(moyR('bouclier') > moyR('stratovolcan'), 'le bouclier est plus large que le stratovolcan (élancé)');
      A.ok(moyRatioCratere('caldeira') > moyRatioCratere('stratovolcan'), 'la caldeira a un cratère bien plus large, relativement à son rayon');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — lave', function () {
    function bain() {
      var w = flatWorld(10, B.STONE);
      for (var x = -3; x <= 3; x++) for (var z = -3; z <= 3; z++) w.setBlock(x, 11, z, B.LAVA);
      return w;
    }
    it('SPEC-LAVE-001 : la lave brule, englue, et detruit les objets', function () {
      var w = bain();
      var pl = MC.createPlayer(w, MC.createEntities(w), M.regles('survie', 'facile'));
      pl.state.pos = { x: 0.5, y: 11, z: 0.5 };
      A.ok(C.isLava(B.LAVA) && !C.isLava(B.WATER), 'reconnue comme lave');
      A.ok(P.dansLave(w, pl.state.pos, 0.6, 1.8), 'le joueur y baigne');
      var hp = pl.state.hp;
      for (var i = 0; i < 20; i++) pl.updateSurvival(0.05);
      A.ok(pl.state.hp <= hp - 4, 'une seconde dans la lave coûte cher (' + (hp - pl.state.hp) + ' PV)');
      var ents = MC.createEntities(w);
      var o = ents.dropItem(0.5, 11.2, 0.5, I.DIAMOND, 1, seededRand(2));
      ents.update(1 / 30, { pos: { x: 50, y: 11, z: 50 } });
      A.ok(o.dead, 'l objet tombé dans la lave est perdu');
      var z = ents.spawn('zombie', 1.5, 11, 1.5);
      var zhp = z.hp;
      ents.update(1 / 30, { pos: { x: 50, y: 11, z: 50 } });
      A.ok(z.hp < zhp, 'les créatures brûlent aussi');
    });
    it('SPEC-LAVE-002 : lave, magma et lanternes marines luisent dans le noir', function () {
      [B.LAVA, B.MAGMA, B.SEA_LANTERN].forEach(function (id) {
        A.equal(C.passOf(id), 'lumineux', C.nameOf(id) + ' : dessiné sans éclairage');
        A.ok(C.lightOf(id) > 0, 'et source de lumière');
      });
      A.ok(C.BLOCKS[B.MAGMA].hurts, 'le magma brûle au contact');
      A.equal(C.lampeDe(B.LAVA), 0, 'la lave luit sans monopoliser les lumières ponctuelles');
      A.ok(C.lampeDe(B.TORCH) > 0 && C.lampeDe(B.SEA_LANTERN) > 0, 'torches et lanternes éclairent');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — wagonnet', function () {
    it('SPEC-VEHIC-011 : le wagonnet suit les rails, prend les virages et s arrete au bout', function () {
      var V = MC.Vehicules;
      var w = flatWorld(10, B.STONE);
      // une voie en L : vers -z sur 10 blocs, puis vers +x sur 6
      for (var z = 0; z >= -10; z--) w.setBlock(0, 11, z, B.RAIL);
      for (var x = 1; x <= 6; x++) w.setBlock(x, 11, -10, B.RAIL);
      var ents = MC.createEntities(w);
      var e = V.poser(ents, 'wagonnet', 0.5, 11, 0.5, 0);
      A.ok(V.railEn(w, 0.5, 11.1, 0.5), 'posé sur un rail');
      for (var i = 0; i < 30 * 6; i++) V.conduire(e, 1 / 30, w, { avant: 1 });
      A.ok(e.pos.x > 5, 'il a pris le virage et suivi la voie (x = ' + e.pos.x.toFixed(1) + ')');
      A.ok(Math.abs(e.pos.z + 9.5) < 0.2, 'centré sur la seconde branche');
      A.ok(e.vitesse === 0 && e.pos.x < 7.2, 'et s est arrêté au bout');
      var hors = V.poser(ents, 'wagonnet', 20.5, 11, 20.5, 0);
      for (var k = 0; k < 60; k++) V.conduire(hors, 1 / 30, w, { avant: 1 });
      // deux secondes à fond : ~18 blocs sur rails, à peine deux hors des rails
      A.ok(Math.abs(hors.pos.z - 20.5) < 3, 'hors des rails, il se traîne (' + Math.abs(hors.pos.z - 20.5).toFixed(1) + ' blocs)');
      A.equal(V.rouler(hors, 1 / 30, w, {}, V.DEFS.wagonnet), 'sol');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — carte et reperes', function () {
    var K = MC.Carte;
    it('SPEC-CARTE-001 : on pose, suit et retire des points de repere', function () {
      var r = K.creerReperes();
      var a = r.ajouter('Maison', 10, 20), b = r.ajouter('Mine', -40, 5);
      A.equal(r.liste.length, 2);
      A.ok(a.couleur !== b.couleur, 'des couleurs distinctes');
      A.equal(r.proche(12, 19, 5), a, 'le plus proche dans le rayon');
      A.equal(r.proche(100, 100, 5), null, 'rien hors de portée');
      var d = r.direction(a, 10.5, 30.5, 0);            // regard vers -z : la maison est devant
      A.ok(Math.abs(d.angle) < 0.05, 'droit devant');
      A.ok(Math.abs(d.distance - 10) < 0.01, 'à dix blocs');
      A.ok(r.retirer(a.id) && r.liste.length === 1, 'retiré');
      A.notOk(r.retirer(999), 'un repère inconnu : rien');
      var s = r.serialiser(), r2 = K.creerReperes();
      r2.charger(s);
      A.equal(r2.liste[0].nom, 'Mine', 'sauvegarde et rechargement');
    });
    it('SPEC-CARTE-002 : la carte ne montre que l explore, en couleurs du terrain', function () {
      var w = monde(99);
      w.getChunk(0, 0, true); w.getChunk(1, 0, true);
      var ex = K.creerExploration();
      A.equal(ex.tuile(w, 0, 0), null, 'inexploré : rien');
      A.ok(ex.explorer(w, 8, 8) >= 1, 'explorer révèle les chunks chargés alentour');
      A.ok(ex.estExplore(0, 0), 'le chunk du joueur est connu');
      var t = ex.tuile(w, 0, 0);
      A.equal(t.length, 16 * 16 * 4, 'une tuile de 16 × 16 pixels');
      A.equal(K.couleurColonne(flatWorld(10, B.SAND), 0, 0).length, 3, 'une couleur par colonne');
      var eau = K.couleurColonne({ getBlock: function (x, y) { return y <= 5 ? B.SAND : (y <= 20 ? B.WATER : 0); } }, 0, 0);
      A.ok(eau[2] > eau[0], 'l eau tire vers le bleu');
      ex.invalider(3, 3);
      A.ok(ex.tuile(w, 0, 0), 'recalculée après un changement');
      var e2 = K.creerExploration(); e2.charger(ex.serialiser());
      A.ok(e2.estExplore(0, 0), 'l exploration se sauvegarde');
    });
    it('SPEC-CARTE-003 : pixels de carte et coordonnees du monde se correspondent', function () {
      var m = K.versMonde(300, 200, 480, 480, 1000, -50, 2);
      var p = K.versCarte(m.x, m.z, 480, 480, 1000, -50, 2);
      A.ok(Math.abs(p.px - 300) < 1e-9 && Math.abs(p.py - 200) < 1e-9, 'aller-retour exact');
      A.ok(K.RAYON_EXPLORATION >= 2 && K.COULEURS[B.WATER] && K.COULEURS_REPERES.length >= 4);
    });
    it('SPEC-CARTE-004 : la carte s obtient, s ouvre, et son contenu survit a la sauvegarde', function () {
      A.ok(MC.Inventory.RECIPES.some(function (r) { return r.out === I.CARTE; }), 'une recette');
      var w = flatWorld(10, B.STONE), pl = MC.createPlayer(w, MC.createEntities(w), M.regles('survie', 'facile'));
      pl.state.inv.slots[0] = { id: I.CARTE, n: 1 }; pl.state.selected = 0;
      A.equal(pl.useOn({ x: 0, y: 10, z: 0, nx: 0, ny: 1, nz: 0 }), 'carte', 'clic droit : on l ouvre');
      var e = G.etatMinimal(1234);
      e.world.reperes.ajouter('Camp', 3, 4);
      e.world.reperes.suivi = e.world.reperes.liste[0].id;
      e.world.exploration.explorer(e.world, 8, 8);
      var data = JSON.parse(JSON.stringify(MC.Save.serialize(e)));
      var f = G.etatMinimal(1234);
      A.ok(MC.Save.apply(data, f));
      A.equal(f.world.reperes.liste[0].nom, 'Camp', 'les repères');
      A.ok(f.world.reperes.suivi, 'le repère suivi');
      A.ok(f.world.exploration.estExplore(0, 0), 'et l exploration');
      f.world.reset();
      A.equal(f.world.reperes.liste.length, 0, 'une nouvelle partie repart de zéro');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — factions', function () {
    it('SPEC-FACTION-001 : chaque creature a son camp, et les inimities sont reciproques', function () {
      A.equal(F.factionDe('zombie').id, 'morts');
      A.equal(F.factionDe('villager').id, 'village');
      A.equal(F.factionDe('pillager').id, 'pillards');
      A.equal(F.factionDe('sheep'), null, 'un mouton n appartient à personne');
      A.ok(F.ennemies('village', 'morts') && F.ennemies('morts', 'village'), 'symétrique');
      A.ok(F.typesEnnemis('garde', 'zombie'), 'le garde combat les morts');
      A.notOk(F.ennemies('morts', 'pillards'), 'morts et pillards se laissent tranquilles');
      A.equal(F.ORDRE.length, 4);
    });
    it('SPEC-FACTION-002 : la reputation decide qui attaque le joueur', function () {
      var rep = F.creerReputations();
      A.ok(F.hostileEnversJoueur('zombie', rep), 'les morts, toujours');
      A.ok(F.hostileEnversJoueur('pillager', rep), 'les pillards, au départ');
      A.notOk(F.hostileEnversJoueur('garde', rep), 'les gardes, non');
      rep.modifier('pillards', 100);
      A.notOk(F.hostileEnversJoueur('pillager', rep), 'des pillards amadoués baissent les armes');
      A.equal(F.statut('pillards', rep), 'amical');
      A.equal(F.hostileEnversJoueur('sheep', rep, false), false, 'sans faction : le gabarit décide');
    });
    it('SPEC-FACTION-003 : tuer un membre fache son camp et rejouit ses ennemis', function () {
      var rep = F.creerReputations();
      var p0 = rep.get('pillards');
      var ch = [];
      for (var i = 0; i < 3; i++) ch = ch.concat(F.surMort('villager', rep));
      A.ok(rep.get('village') < -30, 'le village en veut au joueur');
      A.ok(rep.get('pillards') > p0, 'les pillards l en apprécient davantage');
      A.ok(ch.some(function (c) { return c.faction === 'village' && c.statut === 'hostile'; }), 'on en est prévenu');
      A.ok(F.hostileEnversJoueur('garde', rep), 'et les gardes l attaquent');
      A.notOk(F.commerceOuvert(rep), 'plus de commerce');
      var r2 = F.creerReputations();
      F.surMort('zombie', r2);
      A.ok(r2.get('village') > 0, 'abattre un mort plaît au village');
      F.surEchange(r2);
      A.ok(r2.get('village') > 4, 'commercer aussi');
    });
    it('SPEC-FACTION-004 : un garde defend les villageois contre les morts', function () {
      var w = flatWorld(10, B.STONE), e = MC.createEntities(w), rep = F.creerReputations();
      e.spawn('zombie', 0.5, 11, 0.5); e.spawn('zombie', 1.5, 11, 2.5);
      var g = e.spawn('garde', 8.5, 11, 0.5);
      var v = e.spawn('villager', 5.5, 11, 0.5);
      var loin = { pos: { x: 200, y: 11, z: 200 }, dead: false };
      for (var f = 0; f < 30 * 20; f++) e.update(1 / 30, loin, { reputation: rep, rand: seededRand(f) });
      A.equal(e.countOf('zombie'), 0, 'les zombies sont tombés');
      A.ok(!g.dead, 'le garde est debout');
      A.ok(!v.dead, 'le villageois a survécu');
      var c = e.choisirCible(e.spawn('zombie', 0, 11, 0), MC.EntitySpecs.zombie, loin, rep, 1);
      A.ok(c.agressif, 'un zombie choisit toujours une cible à combattre');
    });
    it('SPEC-FACTION-005 : les reputations survivent a la sauvegarde', function () {
      var e = G.etatMinimal(1234);
      e.world.reputation.modifier('village', -50);
      var data = JSON.parse(JSON.stringify(MC.Save.serialize(e)));
      var f = G.etatMinimal(1234);
      MC.Save.apply(data, f);
      A.equal(f.world.reputation.get('village'), -50);
      f.world.reset();
      A.equal(f.world.reputation.get('village'), 0, 'une nouvelle partie repart de zéro');
      var s = f.world.reputation.serialiser();
      A.equal(typeof s.morts, 'number');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — synchronisation client / serveur autoritaire', function () {
    var TOUCHES_AVANT = { forward: 1 };
    function couple() {
      var w = flatWorld(10, B.STONE);
      w.setBlock(3, 11, -6, B.STONE);                   // un obstacle, pour corser la trajectoire
      var client = MC.createPlayer(w, MC.createEntities(w), M.regles('survie', 'facile'));
      var serveur = MC.createPlayer(w, MC.createEntities(w), M.regles('survie', 'facile'));
      [client, serveur].forEach(function (p) { p.state.pos = { x: 0.5, y: 11, z: 0.5 }; p.state.onGround = true; });
      return { client: client, serveur: serveur };
    }

    it('SPEC-SYNC-001 : les touches voyagent sur six bits', function () {
      var k = { forward: 1, back: 0, left: 1, right: 0, jump: 1, sprint: 0 };
      A.deep(SY.decoderTouches(SY.encoderTouches(k)), k);
      A.equal(SY.encoderTouches({}), 0);
      A.equal(SY.encoderTouches({ forward: 1, back: 1, left: 1, right: 1, jump: 1, sprint: 1 }), 63);
      A.equal(SY.TOUCHES.length, 6);
    });

    it('SPEC-SYNC-002 : serveur et client calculent la meme trajectoire', function () {
      var c = couple(), pred = SY.creerPrediction(), envoyees = [];
      for (var i = 0; i < 120; i++) {
        var e = pred.enregistrer(1 / 60, { forward: 1, left: i % 40 < 10 ? 1 : 0, jump: i % 30 === 0 ? 1 : 0 },
                                 0.3 + i * 0.01, -0.1, false);
        SY.rejouer(c.client, [e]);                         // prédiction locale
        envoyees.push(JSON.parse(JSON.stringify(e)));      // passage par le réseau
      }
      SY.rejouer(c.serveur, envoyees);
      var a = c.client.state.pos, b = c.serveur.state.pos;
      A.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-9, 'positions identiques au bit près');
      A.equal(SY.arrondi(1.23456, 2), 1.23);
    });

    it('SPEC-SYNC-003 : la reconciliation ne corrige que ce qui a diverge', function () {
      var c = couple(), pred = SY.creerPrediction();
      // le client a joué 30 images, le serveur n'en a traité que 20
      var toutes = [];
      for (var i = 0; i < 30; i++) {
        var e = pred.enregistrer(1 / 60, TOUCHES_AVANT, 0, 0, false);
        SY.rejouer(c.client, [e]); toutes.push(e);
      }
      SY.rejouer(c.serveur, toutes.slice(0, 20));
      var ecart = SY.reconcilier(c.client, SY.etatJoueur(c.serveur, 20), pred);
      A.ok(ecart < 1e-9, 'prédiction juste : aucune correction (' + ecart + ')');
      A.equal(pred.enAttente.length, 10, 'dix entrées restent à confirmer');
      // le serveur a vu autre chose (un recul imposé) : le client s'y range
      c.serveur.state.pos.z += 2;
      var ec2 = SY.reconcilier(c.client, SY.etatJoueur(c.serveur, 20), pred);
      A.ok(ec2 > 1.5, 'la divergence est corrigée (' + ec2.toFixed(2) + ')');
    });

    it('SPEC-SYNC-004 : un client ne peut pas simuler plus vite que le temps', function () {
      var b = SY.creerBudget();
      var acceptees = 0;
      for (var i = 0; i < 200; i++) if (b.consommer(1 / 60)) acceptees++;   // 3,3 s d'un coup
      A.ok(acceptees <= Math.ceil(SY.RESERVE * 60) + 1, 'seule la réserve passe (' + acceptees + ')');
      b.crediter(1);
      var apres = 0;
      for (var k = 0; k < 200; k++) if (b.consommer(1 / 60)) apres++;
      A.ok(apres > 20 && apres <= 31, 'une seconde réelle, environ une seconde de jeu (' + apres + ')');
      A.notOk(b.consommer(0.5), 'une image trop longue est refusée');
      A.notOk(b.consommer(-1), 'une durée négative aussi');
      A.ok(b.credit >= 0);
    });

    /* Recul en marchant : après un tic serveur long, le budget était crédité du
       dt PLAFONNÉ (0,25 s) puis plafonné à 0,5 s, même avec des entrées en
       attente — un retard jamais rattrapé, puis des entrées jetées (file à 240). */
    it('SPEC-SYNC-004 : des tics serveur longs ne retardent ni ne font perdre aucune entrée d\'un client honnête', function () {
      var c = couple(), pred = SY.creerPrediction(), file = [], budget = SY.creerBudget(), dernier = 0;
      var t = 0, tEnvoi = 0, prochainBlocage = 1.5;
      while (t < 20) {
        var dtReel = 0.02;
        if (t >= prochainBlocage) { dtReel = 0.9; prochainBlocage += 1.5; }   // la boucle du serveur a bloqué 0,9 s
        t += dtReel;
        // pendant ce temps, le client a envoyé une entrée par image de 20 ms (exacte au 1/10000 près, comme sur le réseau)
        while (tEnvoi + 0.02 <= t + 1e-9) {
          tEnvoi += 0.02;
          var e = pred.enregistrer(0.02, { forward: 1, jump: Math.floor(tEnvoi) % 3 === 0 ? 1 : 0 }, 0.4, 0, false);
          SY.rejouer(c.client, [e]);
          SY.empilerEntree(file, JSON.parse(JSON.stringify(e)));
        }
        dernier = SY.avancerEntrees(c.serveur, file, budget, dtReel, dernier).dernier;
      }
      A.ok(file.length <= 1, 'aucun retard ne s\'accumule (' + file.length + ' entrées en attente)');
      dernier = SY.avancerEntrees(c.serveur, file, budget, 0.02, dernier).dernier;
      A.equal(dernier, pred.suivant - 1, 'toutes les entrées sont acquittées, dans l\'ordre');
      var a = c.client.state.pos, b = c.serveur.state.pos;
      A.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-9, 'aucune entrée perdue : serveur et client au même endroit');
    });

    it('SPEC-SYNC-004 : le temps non utilisé reste plafonné (pas de réserve qui s\'accumule à l\'arrêt)', function () {
      var c = couple(), file = [], budget = SY.creerBudget(), acceptees = 0;
      for (var i = 0; i < 600; i++) SY.avancerEntrees(c.serveur, file, budget, 1 / 60, 0);   // 10 s sans rien envoyer
      A.ok(budget.credit <= SY.RESERVE * 2 + 1e-9, 'réserve plafonnée (' + budget.credit + ')');
      for (var k = 0; k < 300; k++) SY.empilerEntree(file, { s: k + 1, dt: 1 / 60, k: 1, yaw: 0, pitch: 0, v: 0 });   // 5 s d'un coup
      var r = SY.avancerEntrees(c.serveur, file, budget, 1 / 60, 0);
      acceptees = r.dernier;
      A.ok(acceptees <= Math.ceil((SY.RESERVE * 2 + 1 / 60) * 60) + 1, 'seuls la réserve et le temps écoulé passent (' + acceptees + ')');
      SY.avancerEntrees(c.serveur, file, budget, 1, r.dernier);
      A.ok(file.length >= 300 - acceptees - 61, 'ensuite, une seconde réelle pour une seconde de jeu (' + file.length + ' restantes)');
    });

    it('SPEC-SYNC-004 : une entrée invalide ne bloque pas la file, et la file est bornée comme celle du client', function () {
      var c = couple(), file = [], budget = SY.creerBudget();
      [0, -0.01, 5, 1 / 60].forEach(function (dt, i) { SY.empilerEntree(file, { s: i + 1, dt: dt, k: 0, yaw: 0, pitch: 0, v: 0 }); });
      var r = SY.avancerEntrees(c.serveur, file, budget, 1 / 60, 0);
      A.equal(r.dernier, 4, 'l\'entrée valide derrière des entrées invalides est traitée');
      A.equal(file.length, 0);
      for (var i = 0; i < SY.MAX_EN_ATTENTE + 50; i++) SY.empilerEntree(file, { s: i, dt: 1 / 60 });
      A.equal(file.length, SY.MAX_EN_ATTENTE, 'file bornée à MAX_EN_ATTENTE');
      A.equal(file[0].s, 50, 'les plus anciennes partent');
    });

    it('SPEC-SYNC-005 : les statistiques du serveur font foi', function () {
      var w = flatWorld(10, B.STONE), p = MC.createPlayer(w, MC.createEntities(w), M.regles('survie', 'facile'));
      p.state.hp = 7; p.state.hunger = 12; p.state.air = 3;
      var e = SY.etatJoueur(p, 42);
      A.equal(e.s, 42); A.equal(e.pv, 7); A.equal(e.faim, 12);
      var q = MC.createPlayer(w, MC.createEntities(w), M.regles('survie', 'facile'));
      SY.appliquerStats(q.state, e);
      A.equal(q.state.hp, 7); A.equal(q.state.hunger, 12); A.equal(q.state.air, 3);
      SY.appliquerStats(q.state, { pv: 0, mort: 1 });
      A.ok(q.state.dead, 'la mort aussi est décidée par le serveur');
      A.equal(e.x, p.state.pos.x, 'position en pleine précision');
    });

    it('SPEC-SYNC-006 : le protocole valide entrees, attaques, tirs, repas et renaissance', function () {
      var N = MC.NetProtocol;
      var e = N.valider({ t: 'e', s: 5, j: 1, dt: 0.016, k: 3, yaw: 1, pitch: 9, hack: 1 });
      A.ok(e && e.s === 5 && e.j === 1 && e.k === 3, 'entrée acceptée');
      A.ok(e.pitch <= 1.6, 'regard borné');
      A.equal(e.hack, undefined, 'champ injecté ignoré');
      A.equal(N.valider({ t: 'e', s: 5, dt: 5, k: 3 }), null, 'image trop longue refusée');
      A.equal(N.valider({ t: 'e', s: 5, dt: 0.01, k: 99 }), null, 'touches impossibles refusées');
      A.equal(N.valider({ t: 'attaque', eid: 3, degats: 500 }).degats, 12, 'dégâts plafonnés');
      var tir = N.valider({ t: 'tir', dx: 0, dy: 0, dz: -1.2, degats: 99, genre: 'bombe' });
      A.equal(N.valider({ t: 'tir', dx: 0, dy: 0, dz: -3 }), null, 'direction aberrante refusée');
      A.ok(Math.abs(tir.dz + 1) < 1e-9, 'direction normalisée');
      A.equal(tir.genre, 'fleche', 'genre inconnu ramené à la flèche');
      A.equal(N.valider({ t: 'tir', dx: 0, dy: 0, dz: 0 }), null, 'direction nulle refusée');
      A.equal(N.valider({ t: 'manger', id: I.BREAD }).id, I.BREAD);
      A.equal(N.valider({ t: 'renaitre', j: 9 }).j, 0, 'joueur local hors bornes ramené à 0');
      A.ok(N.MSG.DONNE && N.MSG.ENTREE, 'messages déclarés');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
