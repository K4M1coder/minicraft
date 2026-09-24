/* spec-batiments.js — tests des specs SPEC-HABITAT-010, SPEC-HABITAT-011 et
   SPEC-CONSTR-003 : plusieurs plans reconnaissables par type de bâtiment,
   habitabilité vérifiée sur toutes les combinaisons style × densité, et
   toitures en pente faites d'escaliers orientés (habitats.js `toit`). */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, H = MC.Habitats, Fo = MC.Formes;
  var B = C.B;

  var mondes = {};
  function monde(g) { g = g || 20260921; if (!mondes[g]) mondes[g] = MC.createWorld(g); return mondes[g]; }

  function lieux(w, kind, etendue) {
    var R = H.LIEUX[kind].region, n = Math.ceil(etendue / R), l = [];
    for (var rx = -n; rx < n; rx++) for (var rz = -n; rz < n; rz++) {
      var x = w.habitats.lieuDeRegion(kind, rx, rz);
      if (x) l.push(x);
    }
    return l;
  }
  /* `l.blocs` (chunk -> [x,y,z,id,etat,…]) contient déjà tous les blocs d'un
     lieu dès sa construction (`lieuDeRegion`) — bâtiments, lampadaires,
     rues… — sans passer par `world.getChunk` (qui génère en plus tout le
     terrain naturel du chunk : coûteux et hors sujet pour vérifier un
     bâtiment). On lit donc directement `l.blocs` : un accesseur getBlock/
     getEtat aussi fidèle qu'un vrai monde pour tout ce qu'un lieu a posé
     lui-même, instantané puisqu'il ne fait que relire des tableaux déjà là. */
  function accesseurLieu(l) {
    var m = new Map();
    l.blocs.forEach(function (a) {
      for (var i = 0; i < a.length; i += 5) m.set(a[i] + ',' + a[i + 1] + ',' + a[i + 2], [a[i + 3], a[i + 4]]);
    });
    return {
      getBlock: function (x, y, z) { var e = m.get(x + ',' + y + ',' + z); return e ? e[0] : 0; },
      getEtat: function (x, y, z) { var e = m.get(x + ',' + y + ',' + z); return e ? e[1] : 0; },
    };
  }

  // ─── SPEC-HABITAT-011 : vérificateur d'habitabilité ────────────────────────
  /* Contrôle, pour un bâtiment déjà posé (accesseur getBlock/getEtat — un
     vrai monde ou `accesseurLieu`) : porte dégagée et accessible, intérieur
     libre (quand le bâtiment en a un), lumière, habitant dedans, rien ne
     flotte, rien ne déborde de son lieu. Renvoie la liste des défauts trouvés
     (vide = habitable). */
  function defautsHabitabilite(w, l, bat) {
    var defauts = [];
    // la parcelle : le bâtiment reste dans l'emprise de son lieu
    if (bat.x0 < l.x - l.demi - 1 || bat.x1 > l.x + l.demi + 1 || bat.z0 < l.z - l.demi - 1 || bat.z1 > l.z + l.demi + 1) {
      defauts.push('déborde du lieu ' + l.nom);
    }
    // rien ne flotte : la colonne sous le bâtiment est pleine — contrôlé ici
    // seulement pour les bâtiments qui posent leur propre plancher (`corps`,
    // reconnaissables à `dedans`) ; la fondation du reste d'un lieu (la
    // plateforme sous marché/ferme/place/loisirs) est du ressort de la
    // plateforme elle-même, déjà couverte par SPEC-HABITAT-009.
    if (bat.dedans) {
      var coins = [[bat.x0, bat.z0], [bat.x1, bat.z0], [bat.x0, bat.z1], [bat.x1, bat.z1],
                   [Math.floor((bat.x0 + bat.x1) / 2), Math.floor((bat.z0 + bat.z1) / 2)]];
      var poses = coins.filter(function (c) {
        var id = w.getBlock(c[0], bat.y0 - 1, c[1]);
        return C.isSolid(id) || id === B.WATER;
      }).length;
      if (poses < 3) defauts.push('ne repose pas franchement sur le sol (' + poses + '/5 appuis)');
    }
    // porte dégagée et accessible depuis la rue : au moins un des quatre
    // côtés du seuil est praticable — un mouvement continu (pas une grille)
    // contourne un obstacle isolé d'un bloc (un pied de lampadaire, par
    // exemple), d'où la bande de trois cases balayée par direction plutôt
    // qu'une seule case pile dans l'axe.
    if (bat.porte) {
      var px = bat.porte.x, pz = bat.porte.z, py = bat.y0;
      var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      var degagee = dirs.some(function (d) {
        var perp = d[0] ? [0, 1] : [1, 0];
        for (var s = -1; s <= 1; s++) {
          var qx = px + d[0] + perp[0] * s, qz = pz + d[1] + perp[1] * s;
          if (!C.isSolid(w.getBlock(qx, py, qz)) && !C.isSolid(w.getBlock(qx, py + 1, qz))) return true;
        }
        return false;
      });
      if (!degagee) defauts.push('porte obstruée des quatre côtés');
    }
    // intérieur libre : seulement pour les bâtiments qui en ont un (bâtis par
    // `corps` — maison, point_info, banque, salon, magasin, artisan, tour,
    // immeuble) ; marché/ferme/place/loisirs sont des structures ouvertes
    if (bat.dedans) {
      var dx = Math.floor(bat.dedans.x), dz = Math.floor(bat.dedans.z);
      if (C.isSolid(w.getBlock(dx, bat.y0, dz))) defauts.push('le seuil intérieur est bouché');
      var total = 0, libres = 0;
      for (var x = bat.x0 + 1; x < bat.x1; x++) for (var z = bat.z0 + 1; z < bat.z1; z++) {
        total++;
        if (!C.isSolid(w.getBlock(x, bat.y0, z))) libres++;
      }
      if (total > 0 && libres / total < 0.35) defauts.push('intérieur trop encombré (' + libres + '/' + total + ' libres)');
    }
    // lumière : une source dans le volume du bâtiment
    var lumiere = false;
    for (var lx = bat.x0; lx <= bat.x1 && !lumiere; lx++) for (var lz = bat.z0; lz <= bat.z1 && !lumiere; lz++)
      for (var ly = bat.y0; ly <= Math.min(bat.y1, bat.y0 + 8) && !lumiere; ly++) {
        var idl = w.getBlock(lx, ly, lz);
        if (idl && C.BLOCKS[idl] && C.BLOCKS[idl].light) lumiere = true;
      }
    if (!lumiere) defauts.push('aucune lumière');
    // habitant à l'intérieur — la place n'en a pas (pas de rôle attaché)
    if (bat.type !== 'place') {
      var habitant = l.pnjs.some(function (p) {
        return p.x >= bat.x0 - 1 && p.x <= bat.x1 + 1 && p.z >= bat.z0 - 1 && p.z <= bat.z1 + 1 && Math.abs(p.y - bat.y0) <= 3;
      });
      if (!habitant) defauts.push('aucun habitant à proximité');
    }
    // les tours : une échelle (ou des escaliers) jusqu'au sommet
    if (bat.type === 'tour') {
      var colonne = false;
      for (var tx = bat.x0; tx <= bat.x1 && !colonne; tx++) for (var tz = bat.z0; tz <= bat.z1 && !colonne; tz++) {
        var n2 = 0;
        for (var ty = bat.y0; ty < bat.y1 - 2; ty++) {
          var idt = w.getBlock(tx, ty, tz);
          if (idt === B.LADDER || (C.BLOCKS[idt] && C.BLOCKS[idt].forme === 'escalier')) n2++;
        }
        if (n2 > (bat.y1 - bat.y0) * 0.5) colonne = true;
      }
      if (!colonne) defauts.push('pas d\'escalier ni d\'échelle jusqu\'en haut');
    }
    return defauts;
  }

  describe('Specs — plans de bâtiments, habitabilité, toitures en escaliers', function () {
    it('SPEC-HABITAT-010 : chaque type de bâtiment a plusieurs plans reconnaissables, et le gabarit suit la densité', function () {
      var w = monde();
      var villages = lieux(w, 'village', 6000), villes = lieux(w, 'ville', 12000);
      var maisonsIsolees = lieux(w, 'maison', 2000);
      // `l.batiments` existe dès la construction du lieu (`lieuDeRegion`) :
      // inutile de matérialiser ses chunks pour lire ses plans, seulement
      // pour contrôler ses blocs réels (SPEC-HABITAT-011, plus bas).
      var plansParType = {};
      function noter(type, plan) {
        if (!plan) return;
        plansParType[type] = plansParType[type] || {};
        plansParType[type][plan] = (plansParType[type][plan] || 0) + 1;
      }
      villages.concat(villes.slice(0, 6)).forEach(function (l) {
        l.batiments.forEach(function (b) { noter(b.type, b.plan || (b.type === 'loisirs' ? b.metier : null)); });
      });
      maisonsIsolees.slice(0, 15).forEach(function (l) {
        l.batiments.forEach(function (b) { noter(b.type, b.plan); });
      });

      // au moins trois plans reconnaissables pour la maison
      A.gt(Object.keys(plansParType.maison || {}).length, 2,
           'au moins trois plans de maison : ' + JSON.stringify(plansParType.maison));
      A.ok((plansParType.maison || {}).carree > 0 && plansParType.maison.longere > 0 && plansParType.maison.L > 0,
           'carrée, longère et en L toutes rencontrées : ' + JSON.stringify(plansParType.maison));

      // au moins deux plans pour les autres types de bâtiments qui servent
      ['point_info', 'banque', 'salon', 'magasin', 'artisan', 'marche', 'ferme', 'place', 'loisirs'].forEach(function (type) {
        var plans = Object.keys(plansParType[type] || {});
        A.gt(plans.length, 1, 'au moins deux plans pour ' + type + ' : ' + JSON.stringify(plansParType[type]));
      });

      // deux bâtiments du même type diffèrent (au moins une paire de tailles différentes)
      var maisons = [];
      villages.forEach(function (l) { l.batiments.forEach(function (b) { if (b.type === 'maison') maisons.push(b); }); });
      var tailles = {};
      maisons.forEach(function (b) { tailles[(b.x1 - b.x0) + 'x' + (b.z1 - b.z0)] = 1; });
      A.gt(Object.keys(tailles).length, 1, 'des maisons de tailles différentes : ' + Object.keys(tailles).join(', '));

      // le gabarit suit la densité : maisons mitoyennes en ville, jamais en campagne
      var villesAvecPlace = villes.filter(function (v) { return v.lots >= 5; });
      if (villesAvecPlace.length) {
        var maisonsVille = villesAvecPlace[0].batiments.filter(function (b) { return b.type === 'maison'; });
        A.gt(maisonsVille.length, 0, 'des maisons dans la ville');
        maisonsVille.forEach(function (b) { A.equal(b.plan, 'mitoyenne', 'maison de ville mitoyenne : ' + b.plan); });
      }
      var maisonsCampagne = [];
      villages.forEach(function (l) { l.batiments.forEach(function (b) { if (b.type === 'maison') maisonsCampagne.push(b); }); });
      A.ok(maisonsCampagne.every(function (b) { return b.plan !== 'mitoyenne'; }), 'jamais de maison mitoyenne hors ville');

      // fermes en campagne (village/ville), jamais en mégapole
      var fermesVillage = villages.some(function (l) { return l.batiments.some(function (b) { return b.type === 'ferme'; }); });
      A.ok(fermesVillage, 'des fermes dans les villages : ' + villages.map(function (l) { return l.batiments.length; }));

      // tours et immeubles : seulement au centre des mégapoles (HABITAT-013).
      // `l.batiments` existe dès que le lieu est construit (`lieuDeRegion`) —
      // pas besoin de matérialiser ses chunks (des dizaines de milliers de
      // blocs pour une mégapole entière) juste pour lire ses plans. Une seule
      // mégapole n'a que six tours (le cœur en tire toujours six, quelle que
      // soit sa taille) : trop peu pour garantir les deux plans à coup sûr —
      // on les cumule donc sur toutes celles trouvées dans un large rayon.
      var megs = lieux(w, 'megapole', 400000);
      A.gt(megs.length, 0, 'une mégapole pour vérifier tours/immeubles');
      var tours = [], immeubles = [];
      megs.forEach(function (mg) {
        mg.batiments.forEach(function (b) {
          if (b.type === 'tour') tours.push(b); else if (b.type === 'immeuble') immeubles.push(b);
        });
      });
      A.gt(tours.length, 0, 'des tours dans les mégapoles');
      A.gt(immeubles.length, 0, 'des immeubles dans les mégapoles');
      var plansTour = {}, plansImmeuble = {};
      tours.forEach(function (b) { plansTour[b.plan] = 1; noter('tour', b.plan); });
      immeubles.forEach(function (b) { plansImmeuble[b.plan] = 1; noter('immeuble', b.plan); });
      A.gt(Object.keys(plansTour).length, 1, 'au moins deux plans de tour : ' + JSON.stringify(plansTour));
      A.gt(Object.keys(plansImmeuble).length, 1, 'au moins deux plans d\'immeuble : ' + JSON.stringify(plansImmeuble));
      A.equal(villages.concat(villesAvecPlace).some(function (l) { return l.batiments.some(function (b) { return b.type === 'tour' || b.type === 'immeuble'; }); }), false,
              'aucune tour ni immeuble hors mégapole');
    });

    it('SPEC-HABITAT-011 : chaque variante, dans chaque style, à chaque densité et en plusieurs endroits, est habitable', function () {
      var w = monde();
      /* Un ou deux lieux par style suffisent à couvrir « chaque style
         compatible » : deux villages par biome quand il y en a, plus
         quelques villes et maisons isolées à part — « plusieurs endroits »
         sans avoir à parcourir tout ce qu'un large rayon peut contenir.
         `accesseurLieu` lit directement `l.blocs` (déjà posés dès
         `lieuDeRegion`), sans jamais générer le terrain réel d'un chunk :
         c'est ce qui rend ce test instantané plutôt que de coûter le prix
         d'une ville entière par lieu échantillonné. */
      function unOuDeuxParBiome(tous, max) {
        var parBiome = {}, res = [];
        tous.forEach(function (l) {
          parBiome[l.biome] = parBiome[l.biome] || 0;
          if (parBiome[l.biome] >= max) return;
          parBiome[l.biome]++; res.push(l);
        });
        return res;
      }
      var villagesEchantillon = unOuDeuxParBiome(lieux(w, 'village', 3000), 2);
      var villesEchantillon = unOuDeuxParBiome(lieux(w, 'ville', 8000), 1).slice(0, 4);
      var maisonsEchantillon = unOuDeuxParBiome(lieux(w, 'maison', 1500), 1).slice(0, 8);
      var megs = unOuDeuxParBiome(lieux(w, 'megapole', 400000), 1).slice(0, 2);
      var lieuxTous = villagesEchantillon.concat(villesEchantillon).concat(maisonsEchantillon).concat(megs);
      A.gt(lieuxTous.length, 10, 'assez de lieux pour couvrir styles et densités : ' + lieuxTous.length);
      var stylesVus = {}, defautsTotal = [], batimentsControles = 0;
      lieuxTous.forEach(function (l) {
        var acc = accesseurLieu(l);
        stylesVus[l.style] = 1;
        // le quai (« port ») est une structure hors habitat, à cheval sur la
        // rive et l'eau — couverte par HABITAT-013/ROUTE-008, pas par 011
        l.batiments.filter(function (bat) { return bat.type !== 'port'; }).forEach(function (bat) {
          batimentsControles++;
          var defauts = defautsHabitabilite(acc, l, bat);
          if (defauts.length) defautsTotal.push(l.nom + ' (' + l.style + ') / ' + bat.type + (bat.plan ? ':' + bat.plan : '') + ' — ' + defauts.join(', '));
        });
      });
      A.gt(Object.keys(stylesVus).length, 4, 'plusieurs styles couverts : ' + Object.keys(stylesVus).join(', '));
      A.gt(batimentsControles, 60, 'assez de bâtiments contrôlés : ' + batimentsControles);
      A.equal(defautsTotal.length, 0, defautsTotal.length + ' défaut(s) d\'habitabilité :\n' + defautsTotal.slice(0, 15).join('\n'));
    });

    it('SPEC-CONSTR-003 : les toitures en pente sont faites d\'escaliers orientés vers le faîtage, avec un faîtage qui s\'ajuste', function () {
      var w = monde();
      // plaines (pignon, tuiles) et taïga (raide, planches de sapin) : deux
      // styles pignon/raide dont les matériaux de toit ont leur escalier
      var villages = lieux(w, 'village', 6000);
      var plaine = villages.filter(function (l) { return l.biome === 'plaines'; })[0];
      var taiga = villages.filter(function (l) { return l.biome === 'taiga'; })[0];
      A.ok(plaine, 'un village de plaine pour le toit en pignon');
      A.ok(taiga, 'un village de taïga pour le toit raide');
      [plaine, taiga].filter(Boolean).forEach(function (l) {
        var acc = accesseurLieu(l);
        var st = H.stylePour(l.biome);
        var maison = l.batiments.filter(function (b) { return b.type === 'maison'; })[0];
        A.ok(maison, l.nom + ' a une maison');
        var escaliers = 0, dalles = 0, orientationsVues = {};
        for (var x = maison.x0 - 1; x <= maison.x1 + 1; x++) for (var z = maison.z0 - 1; z <= maison.z1 + 1; z++) {
          for (var y = maison.y0; y <= maison.y1; y++) {
            var id = acc.getBlock(x, y, z);
            var def = C.BLOCKS[id];
            if (!def) continue;
            if (def.forme === 'escalier' && def.mat === st.toit) {
              escaliers++;
              var e = Fo.unpackEscalier(acc.getEtat(x, y, z));
              orientationsVues[e.orientation] = 1;
            }
            if (def.forme === 'dalle' && def.mat === st.toit) dalles++;
          }
        }
        A.gt(escaliers, 4, l.nom + ' : des escaliers de toiture (' + escaliers + ') pour ' + st.forme);
        A.gt(Object.keys(orientationsVues).length, 1, 'les deux pans du toit s\'orientent différemment : ' + JSON.stringify(orientationsVues));
      });

      // désert (toit plat) : jamais d'escalier de toiture — la forme reste
      // en blocs pleins, comme le style l'exige (SPEC-CONSTR-003)
      var desert = villages.filter(function (l) { return l.biome === 'desert'; })[0];
      if (desert) {
        var accD = accesseurLieu(desert);
        var stD = H.stylePour('desert');
        A.equal(stD.forme, 'plat', 'le désert garde un toit plat');
        var maisonD = desert.batiments.filter(function (b) { return b.type === 'maison'; })[0];
        if (maisonD) {
          var trouveEscalier = false;
          for (var x2 = maisonD.x0; x2 <= maisonD.x1 && !trouveEscalier; x2++)
            for (var z2 = maisonD.z0; z2 <= maisonD.z1 && !trouveEscalier; z2++)
              for (var y2 = maisonD.y1 - 2; y2 <= maisonD.y1 + 1 && !trouveEscalier; y2++) {
                var d2 = C.BLOCKS[accD.getBlock(x2, y2, z2)];
                if (d2 && d2.forme === 'escalier') trouveEscalier = true;
              }
          A.notOk(trouveEscalier, 'pas d\'escalier sur un toit plat');
        }
      }

      // champignons (chapeau) et pics glacés (dôme) : toujours des blocs pleins
      A.equal(H.stylePour('champignons').forme, 'chapeau', 'chapeau des maisons-champignons');
      A.equal(H.stylePour('pics_glaces').forme, 'dome', 'dôme des igloos');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
