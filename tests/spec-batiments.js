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
    it('SPEC-HABITAT-010 : chaque type de bâtiment a plusieurs plans reconnaissables, et le gabarit suit la densité @lent', function () {
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

    /* ── SPEC-CONSTR-003 : toitures de chaque style, raccords, couverture ── */
    function profilHaut(etat, dir) {
      var segs = [];
      Fo.boitesEscalier(etat).forEach(function (b) {
        if (b.y0 < 0.5) return;
        if (dir === 0 && b.z0 === 0) segs.push([b.x0, b.x1]);
        if (dir === 2 && b.z1 === 1) segs.push([b.x0, b.x1]);
        if (dir === 1 && b.x1 === 1) segs.push([b.z0, b.z1]);
        if (dir === 3 && b.x0 === 0) segs.push([b.z0, b.z1]);
      });
      segs.sort(function (a, b) { return a[0] - b[0]; });
      var out = [];
      segs.forEach(function (s) { var d = out[out.length - 1]; if (d && s[0] <= d[1]) d[1] = Math.max(d[1], s[1]); else out.push([s[0], s[1]]); });
      return JSON.stringify(out);
    }
    /* Les escaliers de toiture d'un lieu : chaque paire de voisins à la même
       hauteur se raccorde (la partie haute de l'un touche la face commune sur
       le même segment que celle de l'autre), et la règle d'angle du jeu
       (Formes.actualiserEscalier, celle d'une pose à la main) ne changerait
       rien : les angles générés sont ceux qu'on obtient en jeu. */
    function controlerToiture(l) {
      var st = H.stylePour(l.biome, l.kind === 'ville' || l.kind === 'megapole');
      var acc = accesseurLieu(l), cases = [], formes = {}, rates = [], reajustes = 0;
      var copie = { getBlock: acc.getBlock, getEtat: acc.getEtat, setEtat: function () { reajustes++; } };
      l.blocs.forEach(function (a) {
        for (var i = 0; i < a.length; i += 5) {
          var df = C.BLOCKS[a[i + 3]];
          if (df && df.forme === 'escalier' && df.mat === st.toit) cases.push([a[i], a[i + 1], a[i + 2]]);
        }
      });
      cases.forEach(function (c) {
        var e = acc.getEtat(c[0], c[1], c[2]);
        var f = Fo.unpackEscalier(e).forme; formes[f] = (formes[f] || 0) + 1;
        Fo.actualiserEscalier(copie, c[0], c[1], c[2]);
        for (var dir = 0; dir < 4; dir++) {
          var nx = c[0] + Fo.DIRS[dir][0], nz = c[2] + Fo.DIRS[dir][1];
          var dn = C.BLOCKS[acc.getBlock(nx, c[1], nz)];
          if (!dn || dn.forme !== 'escalier') continue;
          var a = profilHaut(e, dir), b = profilHaut(acc.getEtat(nx, c[1], nz), (dir + 2) & 3);
          if (a !== b) rates.push(c.join(',') + ' → ' + nx + ',' + nz + ' ' + a + '/' + b);
        }
      });
      return { st: st, n: cases.length, formes: formes, rates: rates, reajustes: reajustes, acc: acc };
    }
    // les volumes couverts : chaque colonne d'un bâtiment fermé a un toit au-dessus de ses murs
    function colonnesDecouvertes(acc, bat) {
      var haut = bat.type === 'ferme' ? bat.y0 + 3 : bat.y0 + 4 * (bat.etages || 1), trous = [];
      var x0 = bat.type === 'ferme' ? bat.grange.x0 : bat.x0, x1 = bat.type === 'ferme' ? bat.grange.x1 : bat.x1;
      var z0 = bat.type === 'ferme' ? bat.grange.z0 : bat.z0, z1 = bat.type === 'ferme' ? bat.grange.z1 : bat.z1;
      for (var x = x0; x <= x1; x++) for (var z = z0; z <= z1; z++) {
        var couvert = false;
        for (var y = haut; y <= bat.y1 + 2 && !couvert; y++) if (acc.getBlock(x, y, z)) couvert = true;
        if (!couvert) trous.push(x + ',' + z);
      }
      return trous;
    }
    var STYLES_PENTE = ['plaines', 'foret', 'taiga', 'savane', 'jungle', 'marais', 'montagnes'];

    it('SPEC-CONSTR-003 : chaque style en pente couvre ses bâtiments de pans d\'escaliers, faîtages, arêtiers (croupe) et noues (plan en L), tous raccordés', function () {
      var bilan = {};
      STYLES_PENTE.forEach(function (sc) {
        [false, true].forEach(function (urbain) {
          var l = urbain ? monde().habitats.batirPourEssai('ville', sc, true, 3, 2) : monde().habitats.batirPourEssai('village', sc, false, 5, 7);
          l.biome = sc;
          var r = controlerToiture(l);
          var cle = sc + (urbain ? '/ville' : '/village');
          bilan[cle] = r.formes;
          A.gt(r.n, 20, cle + ' : des escaliers de toiture (' + r.n + ')');
          A.deep(r.rates.slice(0, 5), [], cle + ' : pans raccordés sans marche (' + r.rates.length + ' ratés)');
          A.equal(r.reajustes, 0, cle + ' : les angles générés sont ceux de la règle du jeu');
          if (r.st.croupe) A.gt((r.formes[Fo.EXT_G] || 0) + (r.formes[Fo.EXT_D] || 0), 7, cle + ' (croupe) : des arêtiers ' + JSON.stringify(r.formes));
          // faîtage : dalle haute ou bloc plein du matériau, au sommet
          var faite = 0;
          l.blocs.forEach(function (a) { for (var i = 0; i < a.length; i += 5) { var df = C.BLOCKS[a[i + 3]]; if (a[i + 3] === r.st.toit || (df && df.forme === 'dalle' && df.mat === r.st.toit)) faite++; } });
          A.gt(faite, 3, cle + ' : un faîtage (' + faite + ')');
          // chaque bâtiment fermé est couvert
          l.batiments.forEach(function (bat) {
            if (!bat.dedans && bat.type !== 'ferme') return;
            var trous = colonnesDecouvertes(r.acc, bat);
            A.equal(trous.length, 0, cle + ' / ' + bat.type + ' : couvert (' + trous.slice(0, 4).join(' ') + ')');
          });
        });
      });
      // pignon (deux pans) et croupe (quatre) : les deux familles existent selon le style
      A.ok(!H.stylePour('plaines').croupe && H.stylePour('savane').croupe && H.stylePour('plaines', true).croupe,
           'colombages en pignon, cases d\'acacia et ville de brique en croupe');
    });

    it('SPEC-CONSTR-003 : la maison en L joint son aile au corps par une noue, sous un seul toit', function () {
      var vue = 0;
      for (var rx = 0; rx < 40 && vue < 3; rx++) {
        var l = monde().habitats.batirBatimentPourEssai('maison', 'plaines', false, rx % 4, null, 1000 + rx * 7, 2000 + rx * 3, 9);
        var b = l.batiments[0];
        if (b.plan !== 'L') continue;
        vue++;
        l.biome = 'plaines'; l.kind = 'maison';
        var r = controlerToiture(l);
        A.gt((r.formes[Fo.INT_G] || 0) + (r.formes[Fo.INT_D] || 0), 1, 'des noues (coins intérieurs) : ' + JSON.stringify(r.formes));
        A.deep(r.rates, [], 'raccordées sans marche (orientation ' + (rx % 4) + ')');
        A.equal(r.reajustes, 0, 'angles conformes à la règle du jeu');
        // le corps et l'aile restent dans la parcelle, quelle que soit l'orientation
        l.blocs.forEach(function (a) { for (var i = 0; i < a.length; i += 5) {
          A.ok(a[i] >= 1000 + rx * 7 - 1 && a[i] <= 1000 + rx * 7 + 9 && a[i + 2] >= 2000 + rx * 3 - 1 && a[i + 2] <= 2000 + rx * 3 + 9,
               'dans la parcelle (débord du toit compris) : ' + a[i] + ',' + a[i + 2]);
        } });
      }
      A.equal(vue, 3, 'trois maisons en L contrôlées');
    });

    it('SPEC-INTERIEUR-001 : tout bâtiment généré est meublé selon sa fonction, et aucun n est creux', function () {
      var w = monde(), B = C.B, MEUBLES = [B.LIT, B.TABLE, B.CHAISE, B.ARMOIRE, B.ETAGERE, B.BIBLIOTHEQUE, B.TAPIS, B.LAMPE, B.VASE, B.PRESENTOIR, B.SOCLE, B.FOYER];
      // à ciel ouvert, sans intérieur : la place, le marché (étals), les loisirs (parc, fontaine, théâtre), le quai
      var OUVERTS = ['place', 'marche', 'loisirs', 'port'];
      // ce que chaque fonction exige (au moins un de chaque groupe)
      var EXIGE = {
        maison: [[B.LIT], [B.TABLE], [B.CHAISE], [B.ARMOIRE, B.FOYER]],
        point_info: [[B.BIBLIOTHEQUE]], magasin: [[B.ETAGERE]], salon: [[B.LIT], [B.CHAISE]],
        banque: [[B.SOCLE], [B.COFFRE_FORT]], ferme: [[B.ETAGERE], [B.TONNEAU], [B.HAY]],
        forgeron: [[B.ENCLUME], [B.FURNACE]], menuisier: [[B.CRAFTING_TABLE]], tisserand: [[B.WOOL_RED, B.WOOL_BLUE]],
        tour: [[B.LIT], [B.TABLE]], immeuble: [[B.LIT], [B.TABLE]],
      };
      var vus = {}, parType = {}, creux = [], manques = [], controles = 0, typesVus = {};
      function sweep(l) {
        var acc = accesseurLieu(l);
        l.batiments.forEach(function (bat) {
          if (OUVERTS.indexOf(bat.type) >= 0) return;
          controles++; typesVus[bat.type] = 1;
          var zone = bat.grange || bat, sortes = {};
          // étage par étage (une grange, une maison : un seul) : jamais un niveau vide
          var etages = bat.etages || 1;
          for (var e = 0; e < etages; e++) {
            var n = 0, yb = bat.y0 + e * 4;
            for (var x = zone.x0 + 1; x < zone.x1; x++) for (var z = zone.z0 + 1; z < zone.z1; z++) for (var y = yb; y < yb + 2; y++) {
              var id = acc.getBlock(x, y, z);
              if (MEUBLES.indexOf(id) >= 0) n++;
              if (id) sortes[id] = 1;
            }
            if (n < 2) creux.push(l.style + ' / ' + bat.type + (bat.plan ? ':' + bat.plan : '') + ' niveau ' + e + ' : ' + n + ' meuble(s)');
          }
          var exige = EXIGE[bat.type === 'artisan' ? bat.metier : bat.type] || [];
          exige.forEach(function (groupe) {
            if (!groupe.some(function (id) { return sortes[id]; })) manques.push(l.style + ' / ' + bat.type + ' (' + (bat.metier || bat.plan || '') + ') sans ' + groupe.map(C.nameOf).join(' ni '));
          });
          (parType[bat.type] = parType[bat.type] || {});
          Object.keys(sortes).forEach(function (k) { parType[bat.type][k] = 1; if (MEUBLES.indexOf(+k) >= 0) vus[k] = 1; });
        });
      }
      // plusieurs graines, tous les lieux réels proches…
      [20260921, 12345, 777].forEach(function (g) {
        var wg = monde(g);
        lieux(wg, 'ville', 6000).slice(0, 2).concat(lieux(wg, 'village', 3000).slice(0, 8)).concat(lieux(wg, 'maison', 900).slice(0, 6)).forEach(sweep);
      });
      // … et chaque style, rural et urbain, bâti exprès (même ceux qu'aucune graine ne place près de l'origine)
      Object.keys(H.STYLES).forEach(function (sc) {
        sweep(monde().habitats.batirPourEssai('village', sc, false, 2, 3));
        if (H.URBAIN[sc]) sweep(monde().habitats.batirPourEssai('ville', sc, true, 1, 1));
      });
      sweep(monde().habitats.batirPourEssai('megapole', 'plaines', true, 0, 0));
      A.gt(controles, 200, 'assez de bâtiments contrôlés : ' + controles);
      ['maison', 'point_info', 'banque', 'salon', 'magasin', 'artisan', 'ferme', 'tour', 'immeuble'].forEach(function (t) {
        A.ok(typesVus[t], 'le balayage couvre ' + t);
      });
      A.deep(creux.slice(0, 10), [], creux.length + ' intérieur(s) creux');
      A.deep(manques.slice(0, 10), [], manques.length + ' bâtiment(s) sans le mobilier de leur fonction');
      A.gt(Object.keys(vus).length, 8, 'un mobilier varié d un bâtiment à l autre');
      // le style module le mobilier : pas de cheminée sous un climat chaud, une cheminée et des tapis au froid
      function mobilierMaisons(sc) {
        var l = monde().habitats.batirPourEssai('village', sc, false, 2, 3), acc = accesseurLieu(l), ids = {};
        l.batiments.filter(function (b) { return b.type === 'maison'; }).forEach(function (b) {
          for (var x = b.x0; x <= b.x1; x++) for (var z = b.z0; z <= b.z1; z++) for (var y = b.y0; y < b.y0 + 4 * (b.etages || 1); y++) ids[acc.getBlock(x, y, z)] = 1;
        });
        return ids;
      }
      var desert = mobilierMaisons('desert'), taiga = mobilierMaisons('taiga'), plaine = mobilierMaisons('plaines');
      A.ok(!desert[B.FOYER] && desert[B.VASE], 'maison de grès : une jarre, pas de cheminée');
      A.ok(taiga[B.FOYER] && taiga[B.TAPIS] && !taiga[B.VASE], 'isba : cheminée et tapis de fourrure, pas de vase');
      A.ok(plaine[B.FOYER] && plaine[B.VASE], 'colombages : cheminée et vase');
      // un lit de maison occupe deux cases : pied et tête, orientés pareil
      var l0 = lieux(w, 'village', 3000)[0], acc0 = accesseurLieu(l0), lit = null;
      l0.blocs.forEach(function (arr) { for (var i = 0; i < arr.length && !lit; i += 5) if (arr[i + 3] === B.LIT && !MC.Formes.unpackMeuble(arr[i + 4]).variante) lit = [arr[i], arr[i + 1], arr[i + 2]]; });
      A.ok(lit, 'un lit dans un village');
      var o0 = MC.Formes.unpackMeuble(acc0.getEtat(lit[0], lit[1], lit[2])).orientation, tete = 0;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (dd) { var e = acc0.getEtat(lit[0] + dd[0], lit[1], lit[2] + dd[1]); if (acc0.getBlock(lit[0] + dd[0], lit[1], lit[2] + dd[1]) === B.LIT && MC.Formes.unpackMeuble(e).variante && MC.Formes.unpackMeuble(e).orientation === o0) tete++; });
      A.equal(tete, 1, 'sa tête est juste à côté, orientée pareil');
      // les livres du monde garnissent les bibliothèques des lieux
      var livre = MC.Livres.livreDuMonde(w.seed, l0);
      A.ok(livre && livre.titre && livre.pages.length > 0 && livre.signe, 'un livre du monde, signé, avec un titre et des pages');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
