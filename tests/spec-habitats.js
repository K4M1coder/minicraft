/* spec-habitats.js — tests des specs SPEC-HABITAT-*. Habitations isolées,
   villages et villes, styles par biome, bâtiments qui servent, habitants et
   leurs métiers. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, H = MC.Habitats;
  var B = C.B, I = C.I;

  var mondes = {};
  function monde(g) { g = g || 20260921; if (!mondes[g]) mondes[g] = MC.createWorld(g); return mondes[g]; }
  // tous les lieux d'un genre sur un carré de ±etendue blocs
  function lieux(w, kind, etendue) {
    var R = H.LIEUX[kind].region, n = Math.ceil(etendue / R), l = [];
    for (var rx = -n; rx < n; rx++) for (var rz = -n; rz < n; rz++) {
      var x = w.habitats.lieuDeRegion(kind, rx, rz);
      if (x) l.push(x);
    }
    return l;
  }
  function types(l) { return l.batiments.map(function (b) { return b.type; }); }
  /* Une ville assez grande pour avoir de la place pour tous ses métiers et
     quartiers (SPEC-HABITAT-012 : une petite ville de 3×3 parcelles n'a pas
     forcément de place pour les trois artisans à la fois). */
  function grandeVille(w) { return lieux(w, 'ville', 12000).filter(function (v) { return v.lots >= 5; })[0]; }

  describe('Specs — habitations, villages et villes', function () {
    it('SPEC-HABITAT-001 : maisons isolées, villages et villes jalonnent le monde, sans se chevaucher', function () {
      var w = monde();
      // SPEC-HABITAT-008 : les villes sont maintenant espacées de plusieurs kilomètres
      // (une grande région par ville) — il faut regarder plus loin pour en trouver plusieurs
      var villes = lieux(w, 'ville', 8000), villages = lieux(w, 'village', 3000), maisons = lieux(w, 'maison', 1500);
      A.gt(villes.length, 4, 'des villes : ' + villes.length);
      A.gt(villages.length, 20, 'des villages : ' + villages.length);
      A.gt(maisons.length, 40, 'des habitations isolées : ' + maisons.length);
      // un village ne s'installe pas dans une ville, une maison isolée pas dans un village
      villages.forEach(function (v) {
        villes.forEach(function (c) {
          A.ok(Math.abs(v.x - c.x) > c.demi + v.demi || Math.abs(v.z - c.z) > c.demi + v.demi, v.nom + ' hors de ' + c.nom);
        });
      });
      // déterministe : même graine, mêmes lieux, mêmes noms
      var w2 = MC.createWorld(20260921), v0 = villages[0];
      var rx = Math.floor(v0.x / H.LIEUX.village.region), rz = Math.floor(v0.z / H.LIEUX.village.region);
      var v1 = w2.habitats.lieuDeRegion('village', rx, rz);
      A.ok(v1 && v1.nom === v0.nom && v1.x === v0.x && v1.z === v0.z, 'le même village, au même endroit : ' + v0.nom);
      // au sec et au-dessus de la mer
      villes.concat(villages).forEach(function (l) { A.gt(l.h0, C.SEA_LEVEL + 1, l.nom + ' au sec'); });
    });

    it('SPEC-HABITAT-002 : chaque biome a son style de construction, et les villes leur variante urbaine', function () {
      var w = monde(), vus = {};
      lieux(w, 'village', 4000).forEach(function (v) { vus[v.biome] = v; });
      var biomes = Object.keys(vus);
      A.gt(biomes.length, 5, 'des villages dans ' + biomes.length + ' biomes : ' + biomes.join(', '));
      var styles = {};
      biomes.forEach(function (b) { styles[vus[b].style] = 1; });
      A.gt(Object.keys(styles).length, 5, 'autant de styles : ' + Object.keys(styles).join(', '));
      // des formes bien différentes
      A.equal(H.stylePour('desert').forme, 'plat', 'toits plats du désert');
      A.equal(H.stylePour('taiga').forme, 'raide', 'toits raides de la taïga');
      A.equal(H.stylePour('pics_glaces').forme, 'dome', 'igloos des pics glacés');
      A.equal(H.stylePour('champignons').forme, 'chapeau', 'chapeaux des maisons-champignons');
      A.ok(H.stylePour('jungle').pilotis > 0 && H.stylePour('marais').pilotis > 0, 'pilotis de la jungle et du marais');
      A.notEqual(H.stylePour('plaines').mur, H.stylePour('desert').mur, 'des murs différents');
      // variante urbaine : rues pavées, pas de pilotis
      var u = H.stylePour('plaines', true);
      A.equal(u.route, B.PAVE, 'la ville pave ses rues');
      A.notEqual(u.mur, H.stylePour('plaines').mur, 'et bâtit autrement que le village');
      A.ok(!H.stylePour('jungle', true).pilotis, 'la cité ne monte pas sur pilotis');
      var v = lieux(w, 'ville', 4000)[0];
      A.ok(/^Ville|Médina|Cité|Pueblo/.test(v.style), 'une ville porte un style urbain : ' + v.style);
    });

    it('SPEC-HABITAT-003 : villes et villages ont point info, banque, salons, magasins, artisans, marché, fermes et loisirs', function () {
      var w = monde();
      var v = grandeVille(w), t = types(v);
      ['point_info', 'banque', 'salon', 'magasin', 'artisan', 'marche', 'ferme', 'loisirs', 'maison', 'place'].forEach(function (b) {
        A.ok(t.indexOf(b) >= 0, 'la ville ' + v.nom + ' a son ' + b);
      });
      var metiers = v.batiments.filter(function (b) { return b.type === 'artisan'; }).map(function (b) { return b.metier; }).sort();
      A.deep(metiers, ['forgeron', 'menuisier', 'tisserand'], 'forgeron, menuisier et tisserand');
      var village = lieux(w, 'village', 3000)[0], tv = types(village);
      ['point_info', 'salon', 'magasin', 'artisan', 'marche', 'ferme', 'loisirs'].forEach(function (b) {
        A.ok(tv.indexOf(b) >= 0, 'le village ' + village.nom + ' a son ' + b);
      });
      A.equal(tv.indexOf('banque'), -1, 'la banque est affaire de ville');
      // chaque bâtiment qui sert a son habitant, avec son métier
      var roles = v.pnjs.map(function (p) { return p.role; });
      ['guide', 'banquier', 'aubergiste', 'marchand', 'marchand_ambulant', 'fermier', 'animateur', 'habitant'].forEach(function (r) {
        A.ok(roles.indexOf(r) >= 0, 'un ' + r + ' en ville');
        A.ok(H.ROLES[r] && H.ROLES[r].repliques.length > 0 && H.ROLES[r].offres.length > 0, r + ' a ses répliques et ses offres');
      });
      var ermite = lieux(w, 'maison', 1500)[0];
      A.equal(ermite.pnjs[0].role, 'ermite', 'une maison isolée abrite un ermite');
    });

    it('SPEC-HABITAT-004 : un lieu se pose dans ses chunks : terrain nivelé, rues, bâtiments, lampadaires @lent', function () {
      var w = monde(), v = grandeVille(w);
      var r = v.plateforme.rues;
      // on génère les chunks de la ville
      for (var cx = Math.floor((v.x - v.demi) / 16); cx <= Math.floor((v.x + v.demi) / 16); cx++)
        for (var cz = Math.floor((v.z - v.demi) / 16); cz <= Math.floor((v.z + v.demi) / 16); cz++) w.getChunk(cx, cz, true);
      // la rue est pavée (dans le matériau du biome de la ville), au niveau
      // de la plateforme, et dégagée au-dessus
      var rx = r.x0 + 1, rz = r.z0 + r.pas * 2 + 6;
      A.equal(w.getBlock(rx, v.h0, rz), r.route, 'rue pavée');
      A.equal(w.getBlock(rx, v.h0 + 5, rz), 0, 'dégagée des arbres et des bosses');
      // la plateforme est plate sous toute la ville
      var inegal = 0;
      for (var x = v.x - v.demi + 1; x < v.x + v.demi; x += 5) for (var z = v.z - v.demi + 1; z < v.z + v.demi; z += 5) {
        if (C.isSolid(w.getBlock(x, v.h0 + 1, z))) continue;          // un bâtiment
        if (!C.isSolid(w.getBlock(x, v.h0, z)) && w.getBlock(x, v.h0, z) !== B.WATER && w.getBlock(x, v.h0 - 1, z) !== B.WATER) inegal++;
      }
      A.lt(inegal, 3, 'le sol est plein partout au niveau de la plateforme (' + inegal + ')');
      // la banque est là, avec ses coffres-forts
      var banque = v.batiments.filter(function (b) { return b.type === 'banque'; })[0], forts = 0, lanternes = 0;
      for (var bx = banque.x0; bx <= banque.x1; bx++) for (var bz = banque.z0; bz <= banque.z1; bz++)
        for (var by = banque.y0; by <= banque.y1; by++) if (w.getBlock(bx, by, bz) === B.COFFRE_FORT) forts++;
      A.gt(forts, 2, 'des coffres-forts dans la banque : ' + forts);
      // beaucoup de sources de lumière : lampadaires le long des rues
      for (var lx = v.x - v.demi; lx <= v.x + v.demi; lx++) for (var lz = v.z - v.demi; lz <= v.z + v.demi; lz++)
        for (var ly = v.h0; ly < v.h0 + 8; ly++) if (w.getBlock(lx, ly, lz) === B.LANTERN) lanternes++;
      A.gt(lanternes, 150, 'des lanternes partout : ' + lanternes);
      A.equal(w.habitats.lieuA(v.x, v.z).id, v.id, 'on sait dans quel lieu on se trouve');
      var b2 = w.habitats.batimentA(banque.dedans.x, banque.y0, banque.dedans.z);
      A.ok(b2 && b2.type === 'banque', 'et dans quel bâtiment');
    });

    it('SPEC-HABITAT-005 : les métiers rendent service — indications, compte, repos, réparation, détente', function () {
      var w = monde(), v = lieux(w, 'village', 3000)[0];
      var inv = MC.Inventory.create(36), st = { hp: 5, hunger: 4, selected: 0 };
      var rep = MC.Carte.creerReperes();
      var ctx = { inv: inv, etat: st, temps: 100, dureeJour: 420, estNuit: false, habitats: w.habitats, reperes: rep,
                  x: v.x, z: v.z, lieu: v, pvMax: 20 };
      var info = H.servir('info', ctx);
      A.ok(info.ok && info.lieux.length > 0, 'le guide connaît les environs : ' + info.message);
      A.ok(info.lieux.every(function (l) { return l.id !== v.id; }), 'et ne vous renvoie pas où vous êtes');
      A.equal(rep.liste.length, info.reperesPoses, 'il les marque sur la carte');
      A.equal(H.servir('info', ctx).reperesPoses, 0, 'sans les marquer deux fois');
      A.equal(H.servir('banque', ctx).ouvrir, 'banque', 'le banquier ouvre le compte');
      // repos : payant, rend la vie, fait dormir jusqu'au matin
      A.notOk(H.servir('repos', ctx).ok, 'sans émeraude, pas de chambre');
      inv.add(I.EMERALD, 5);
      ctx.estNuit = true; ctx.temps = 420 * 3 + 300;
      var nuit = H.servir('repos', ctx);
      A.ok(nuit.ok && st.hp === 20, 'reposé : ' + st.hp + ' PV');
      A.equal(nuit.temps, 420 * 4 + 420 * 0.02, 'réveillé au matin');
      A.equal(inv.count(I.EMERALD), 4, 'une émeraude payée');
      // réparation de l'outil en main
      inv.slots[8] = { id: I.IRON_PICKAXE, n: 1, dmg: 40 }; st.selected = 8;
      var rep2 = H.servir('reparer', ctx);
      A.ok(rep2.ok && !inv.slots[8].dmg, 'pioche réparée à neuf : ' + rep2.message);
      A.notOk(H.servir('reparer', ctx).ok, 'un outil neuf n a rien à réparer');
      // détente : +6 PV, pas deux fois de suite
      st.hp = 10;
      A.ok(H.servir('detente', ctx).ok && st.hp === 16, 'un bon moment');
      A.notOk(H.servir('detente', ctx).ok, 'le spectacle suivant attendra');
      // habitants à faire apparaître : ni les présents, ni les morts
      var manquants = H.pnjsManquants([v], [{ pnj: v.pnjs[0].id }], new Set([v.pnjs[1].id]));
      A.equal(manquants.length, v.pnjs.length - 2, 'les absents seulement');
    });

    it('SPEC-HABITAT-006 : le compte en banque, commun à toutes les banques, survit à la sauvegarde', function () {
      var w = MC.createWorld(99);
      A.ok(w.banque && w.banque.slots.length === 27, 'un compte de 27 cases');
      w.banque.add(I.DIAMOND, 7);
      var mem = {}, st = { getItem: function (k) { return mem[k] || null; }, setItem: function (k, v) { mem[k] = v; },
                           removeItem: function (k) { delete mem[k]; } };
      var ents = MC.createEntities(w), pl = MC.createPlayer(w, ents, MC.Modes.regles('survie', 'facile'));
      var etat = { world: w, entities: ents, player: pl, time: 100, furnaces: {}, chests: {}, spawnPoint: { x: 0, y: 40, z: 0 } };
      A.ok(MC.Save.save(st, etat), 'sauvegardé');
      w.banque.load([]);
      A.equal(w.banque.count(I.DIAMOND), 0, 'compte vidé');
      A.ok(MC.Save.load(st, etat), 'rechargé');
      A.equal(w.banque.count(I.DIAMOND), 7, 'les diamants sont revenus au coffre');
      w.reset();
      A.equal(w.banque.count(I.DIAMOND), 0, 'une nouvelle partie ouvre un compte vide');
      // nouveaux blocs : planches d'essences, toits, enduits, mobilier, et leurs recettes
      [B.PLANCHES_SAPIN, B.TUILES, B.ARDOISE, B.CHAUX, B.PAVE, B.COMPTOIR, B.COFFRE_FORT, B.TONNEAU, B.ENCLUME, B.PANNEAU_INFO]
        .forEach(function (id) {
          A.ok(C.BLOCKS[id] && C.BLOCKS[id].name, 'bloc ' + id + ' défini');
          A.ok(MC.Inventory.RECIPES.some(function (r) { return r.out === id; }), C.BLOCKS[id].name + ' se fabrique');
        });
      A.equal(C.BLOCKS[B.COFFRE_FORT].interactive, 'banque', 'le coffre-fort ouvre le compte');
      A.equal(C.BLOCKS[B.PANNEAU_INFO].interactive, 'info', 'le panneau renseigne');
    });

    it('SPEC-HABITAT-008 : les lieux suivent l\'habitabilité — villes espacées de plusieurs kilomètres, campagne dense en plaine, quasi vide en montagne/désert', function () {
      var w = monde();
      var villes = lieux(w, 'ville', 12000);
      A.gt(villes.length, 3, 'plusieurs villes dans un large rayon : ' + villes.length);
      // la distance au plus proche voisin se compte en kilomètres, pas en centaines de blocs
      var distMin = Infinity;
      villes.forEach(function (a) {
        villes.forEach(function (b) {
          if (a === b) return;
          distMin = Math.min(distMin, Math.hypot(a.x - b.x, a.z - b.z));
        });
      });
      A.gt(distMin, 1200, 'deux villes voisines restent à plus de 1200 blocs l\'une de l\'autre : ' + Math.round(distMin));
      // la campagne (villages, maisons) est bien plus dense que les villes
      var villages = lieux(w, 'village', 3000), maisons = lieux(w, 'maison', 1500);
      A.gt(villages.length, villes.length, 'plus de villages que de villes');
      A.gt(maisons.length, villages.length, 'plus de maisons isolées que de villages');
      // montagnes, désert, pics glacés : la campagne s'y raréfie nettement
      var campagne = villages.concat(maisons);
      var parBiome = {};
      campagne.forEach(function (l) { parBiome[l.biome] = (parBiome[l.biome] || 0) + 1; });
      var vides = ['montagnes', 'desert', 'pics_glaces'].filter(function (b) { return parBiome[b]; });
      var pleins = ['plaines', 'foret'].filter(function (b) { return parBiome[b]; });
      if (vides.length && pleins.length) {
        var moyVide = vides.reduce(function (s, b) { return s + parBiome[b]; }, 0) / vides.length;
        var moyPlein = pleins.reduce(function (s, b) { return s + parBiome[b]; }, 0) / pleins.length;
        A.ok(moyVide < moyPlein, 'la campagne de montagne/désert (' + moyVide.toFixed(1) +
             ') est plus rare que celle de plaine/forêt (' + moyPlein.toFixed(1) + ')');
      }
    });

    it('SPEC-HABITAT-009 : les bâtiments s\'adaptent au relief — fondation qui suit le terrain réel, sans trou flottant à profondeur fixe @lent', function () {
      var w = monde();
      var lieuxTous = lieux(w, 'ville', 12000).concat(lieux(w, 'village', 6000));
      // un lieu avec du dénivelé sous sa plateforme : la fondation doit relier
      // le sol réel à la place, quelle que soit la profondeur à combler
      var accidente = lieuxTous.slice().sort(function (a, b) { return b.denivele - a.denivele; })[0];
      A.ok(accidente, 'au moins un lieu avec du dénivelé sous sa plateforme : ' +
           lieuxTous.map(function (l) { return l.denivele; }).join(','));
      for (var cx = Math.floor((accidente.x - accidente.demi) / 16); cx <= Math.floor((accidente.x + accidente.demi) / 16); cx++)
        for (var cz = Math.floor((accidente.z - accidente.demi) / 16); cz <= Math.floor((accidente.z + accidente.demi) / 16); cz++)
          w.getChunk(cx, cz, true);
      // on cherche une colonne du site où le sol réel plonge nettement sous la
      // place, et on vérifie qu'aucun trou d'air ne subsiste entre les deux —
      // l'ancien code, lui, ne comblait qu'une profondeur fixe de 12 blocs,
      // laissant une plateforme flottante au-dessus d'un vide dès que le
      // dénivelé dépassait cette profondeur
      var trouve = false;
      for (var dx = -accidente.demi + 2; dx < accidente.demi - 1 && !trouve; dx += 3) {
        for (var dz = -accidente.demi + 2; dz < accidente.demi - 1 && !trouve; dz += 3) {
          var x = accidente.x + dx, z = accidente.z + dz;
          var hNat = w.heightAt(x, z);
          if (accidente.h0 - hNat < 3) continue;      // pas assez de dénivelé à cet endroit précis
          trouve = true;
          var troue = false;
          for (var y = hNat + 1; y < accidente.h0; y++) if (w.getBlock(x, y, z) === 0) troue = true;
          A.notOk(troue, 'fondation continue du sol réel (' + hNat + ') jusqu\'à la place (' + accidente.h0 + '), sans trou');
        }
      }
      A.ok(trouve, 'une colonne du site avec assez de dénivelé pour mettre la fondation à l\'épreuve');
    });

    it('SPEC-HABITAT-012 : les villes ont des quartiers cohérents et une taille qui varie', function () {
      var w = monde(), villes = lieux(w, 'ville', 16000);
      A.gt(villes.length, 4, 'assez de villes pour voir varier leur taille : ' + villes.length);
      var tailles = {};
      villes.forEach(function (v) { tailles[v.lots] = (tailles[v.lots] || 0) + 1; });
      A.gt(Object.keys(tailles).length, 1, 'plusieurs tailles de ville rencontrées : ' + JSON.stringify(tailles));
      [3, 5, 7].forEach(function (n) { A.ok([3, 5, 7].indexOf(n) >= 0, 'taille ' + n + ' est une des tailles prévues'); });
      // quartiers : centre commerçant proche de la place, faubourgs agricoles en bord de ville
      var grande = villes.filter(function (v) { return v.lots >= 7; })[0] || grandeVille(w);
      var quartiers = {};
      grande.batiments.forEach(function (b) { if (b.quartier) quartiers[b.quartier] = (quartiers[b.quartier] || 0) + 1; });
      A.ok(quartiers.centre > 0, 'un centre commerçant : ' + JSON.stringify(quartiers));
      A.ok(quartiers.faubourgs > 0, 'des faubourgs en périphérie : ' + JSON.stringify(quartiers));
      var fermesFaubourgs = grande.batiments.filter(function (b) { return b.type === 'ferme' && b.quartier === 'faubourgs'; });
      A.gt(fermesFaubourgs.length, 0, 'les fermes se trouvent dans les faubourgs agricoles');
      var centreCommerces = grande.batiments.filter(function (b) {
        return b.quartier === 'centre' && ['banque', 'magasin', 'marche', 'salon'].indexOf(b.type) >= 0;
      });
      A.gt(centreCommerces.length, 0, 'le centre concentre les commerces');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
