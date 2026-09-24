/* limites-sondes.js — sondes des limites techniques de la carte
   (SPEC-LIMITE-001 à 006). Module pur, sans DOM ni Node : chargé par la suite
   standard (tests/spec-limites.js, mode rapide) et par l'exploration profonde
   (tests/explo-limites.js, toutes les distances, cahier dédié).

   Ce sont des mesures d'exploration, pas des critères de validation : une
   sonde dont l'attendu n'est pas atteint le consigne comme « échec interne »
   dans son tableau, sans faire échouer quoi que ce soit. Seul un tableau
   impossible à construire (sonde qui plante, ligne mal formée) est une vraie
   erreur — c'est ce que la suite standard vérifie.

   Chaque ligne de tableau : { mesure, valeur, statut } avec statut
   'ok' (succès interne : l'attendu est atteint), 'echec' (échec interne :
   limite atteinte ou anomalie relevée) ou 'info' (valeur recherchée). */
(function (G) {
  'use strict';

  var STATUTS = { ok: '✓', echec: '✗', info: '·' };
  var DEUX32 = 4294967296;

  function arrondi(v, n) { var p = Math.pow(10, n === undefined ? 3 : n); return Math.round(v * p) / p; }
  function notation(d) { return d === 0 ? '0' : d < 1e5 ? String(d) : d.toExponential(3).replace('e+', ' × 10^'); }

  /* Écart entre un nombre et le flottant 32 bits suivant : la résolution de
     toute position monde vue par le GPU (shaders d'eau, de vent, de nuages ;
     matrices de three.js, stockées en Float32Array). */
  function pas32(x) {
    var f = Math.fround(Math.abs(x));
    if (f === 0) return Math.pow(2, -149);
    var e = Math.floor(Math.log2(f));
    if (Math.pow(2, e) > f) e--;                       // garde-fou d'arrondi de log2
    return Math.pow(2, Math.max(e - 23, -149));
  }
  function pas64(x) {
    if (x === 0) return Number.MIN_VALUE;
    return Math.pow(2, Math.floor(Math.log2(Math.abs(x))) - 52);
  }

  var DISTANCES_RAPIDES = [1e3, 1e6, 1e7, 2147483648, 1e12];
  var DISTANCES_COMPLETES = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 2147483520, 2147483648, 4294967296, 1e11, 1e12, 1e15, 9007199254740000];

  /* `MC` : l'espace de noms du jeu ; `options` : { rapide, graine, maintenant }.
     Rend { sondes: [{ id, titre, fiche, lignes, conclusion, duree_ms, erreur? }] }. */
  function sonder(MC, options) {
    options = options || {};
    var C = MC.Core, rapide = options.rapide !== false;
    var graine = options.graine || 20260924;
    var maintenant = options.maintenant || function () { return Date.now(); };
    var distances = options.distances || (rapide ? DISTANCES_RAPIDES : DISTANCES_COMPLETES);
    var monde = MC.createWorld(graine);
    var sondes = [];

    function sonde(id, titre, fiche, fn) {
      if (options.seulement && options.seulement.indexOf(id) < 0) return;
      if (options.suivi) options.suivi(id, titre);
      var t0 = maintenant(), s = { id: id, titre: titre, fiche: fiche, lignes: [] };
      function ligne(mesure, valeur, statut) { s.lignes.push({ mesure: mesure, valeur: String(valeur), statut: statut || 'info' }); }
      try { s.conclusion = fn(ligne, s); } catch (e) { s.erreur = (e && e.message) || String(e); }
      s.duree_ms = Math.round(maintenant() - t0);
      sondes.push(s);
    }

    // ── SPEC-LIMITE-001 : hauteur, profondeur, construction ──
    sonde('SPEC-LIMITE-001', 'Hauteur et profondeur de la carte, hauteur de construction',
      { teste: 'les bornes verticales : socle, niveau de la mer, plafond, pose aux extrêmes, bornes du protocole réseau',
        pourquoi: 'savoir jusqu’où l’on creuse et construit, et si monde et protocole sont d’accord',
        attendu: 'socle en y = 0, pose possible jusqu’à WORLD_H − 1, refusée au-delà et sous 0, en local comme en ligne' },
      function (ligne) {
        var WH = C.WORLD_H, B = C.B;
        monde.getChunk(0, 0, true);
        ligne('Hauteur totale (WORLD_H)', WH + ' blocs, de y = 0 à y = ' + (WH - 1));
        ligne('Niveau de la mer (SEA_LEVEL)', 'y = ' + C.SEA_LEVEL);
        var socle = monde.getBlock(3, 0, 3) === B.BEDROCK;
        ligne('Socle incassable en y = 0', socle ? 'oui' : 'non', socle ? 'ok' : 'echec');
        monde.setBlock(3, WH - 1, 3, B.STONE);
        var haut = monde.getBlock(3, WH - 1, 3) === B.STONE;
        ligne('Pose en y = WORLD_H − 1 (' + (WH - 1) + ')', haut ? 'possible' : 'impossible', haut ? 'ok' : 'echec');
        monde.setBlock(3, WH, 3, B.STONE);
        var plafond = monde.getBlock(3, WH, 3);
        ligne('Pose en y = WORLD_H (' + WH + ')', plafond ? 'acceptée' : 'ignorée', plafond ? 'echec' : 'ok');
        monde.setBlock(3, -1, 3, B.STONE);
        var sous = monde.getBlock(3, -1, 3);
        ligne('Pose en y = −1', sous ? 'acceptée' : 'ignorée', sous ? 'echec' : 'ok');
        var NP = MC.NetProtocol, anomalies = !socle || !haut || !!plafond || !!sous;
        if (NP && NP.valider) {
          [WH - 1, WH, -1, 1e9].forEach(function (y) {
            var v = NP.valider({ t: NP.MSG.BLOC, x: 0, y: y, z: 0, id: 1, j: 0 });
            var dansBornes = y >= 0 && y < WH, garde = !!v && v.y === y;
            var ok = dansBornes ? garde : !v;
            if (!ok) anomalies = true;
            ligne('Protocole réseau : bloc en y = ' + y, !v ? 'refusé' : (v.y === y ? 'accepté' : 'accepté, y ramené à ' + v.y),
                  ok ? 'ok' : 'echec');
          });
        }
        return 'construction de y = 1 à y = ' + (WH - 1) + (anomalies ? ' — anomalies relevées' : ', bornes cohérentes');
      });

    // ── SPEC-LIMITE-002 : hauteurs réellement générées ──
    sonde('SPEC-LIMITE-002', 'Hauteurs réellement générées (relief, sommets, fonds marins)',
      { teste: 'le relief sur un large échantillon : plus haut sommet, fond le plus bas, marge sous le plafond, répartition',
        pourquoi: 'un relief qui touche le plafond tronque montagnes et volcans ; sans marge, impossible de bâtir au sommet',
        attendu: 'relief entre 1 et WORLD_H − 1, avec au moins 8 blocs de marge au-dessus des sommets' },
      function (ligne) {
        var WH = C.WORLD_H, R = rapide ? 20000 : 60000, N = rapide ? 1500 : 20000, rng = 12345;
        var max = -1, min = 1e9, ouMax = null, ouMin = null, somme = 0, auPlafond = 0;
        var hist = []; for (var t = 0; t < Math.ceil(WH / 16); t++) hist.push(0);
        function alea() { rng = (Math.imul(rng, 1103515245) + 12345) >>> 0; return rng / 4294967296; }
        for (var i = 0; i < N; i++) {
          var x = Math.floor((alea() * 2 - 1) * R), z = Math.floor((alea() * 2 - 1) * R), h = monde.heightAt(x, z);
          if (h > max) { max = h; ouMax = [x, z]; }
          if (h < min) { min = h; ouMin = [x, z]; }
          if (h >= WH - 2) auPlafond++;
          hist[Math.max(0, Math.min(hist.length - 1, Math.floor(h / 16)))]++;
          somme += h;
        }
        ligne('Échantillon', N + ' points sur ±' + R + ' blocs (graine ' + graine + ')');
        ligne('Sommet le plus haut', 'y = ' + max + ' en (' + ouMax.join(', ') + ')');
        ligne('Marge de construction au-dessus du plus haut sommet', (WH - 1 - max) + ' blocs', WH - 1 - max >= 8 ? 'ok' : 'echec');
        ligne('Fond le plus bas', 'y = ' + min + ' en (' + ouMin.join(', ') + '), ' + (C.SEA_LEVEL - min) + ' blocs sous la mer', min >= 1 ? 'ok' : 'echec');
        ligne('Hauteur moyenne', 'y = ' + arrondi(somme / N, 1));
        ligne('Points à moins de 2 blocs du plafond', auPlafond + ' (' + arrondi(100 * auPlafond / N, 2) + ' %)', auPlafond ? 'echec' : 'ok');
        ligne('Répartition par tranches de 16 blocs', hist.map(function (c, k) {
          return (k * 16) + '–' + (k * 16 + 15) + ' : ' + arrondi(100 * c / N, 1) + ' %';
        }).join(' · '));
        return 'relief de y = ' + min + ' à y = ' + max + ', marge de ' + (WH - 1 - max) + ' blocs sous le plafond';
      });

    // ── SPEC-LIMITE-003 : étendue horizontale ──
    sonde('SPEC-LIMITE-003', 'Étendue horizontale : génération, bruit et coordonnées loin de l’origine',
      { teste: 'à des distances croissantes : chunk généré valide, pose/lecture, relief varié, répétition du monde 2³² blocs plus loin, coordonnée intacte à travers le protocole réseau',
        pourquoi: 'le bruit hache des coordonnées tronquées en entiers 32 bits (x | 0) et le protocole les tronque aussi : au-delà de ±2³¹ le monde se répète et le jeu en ligne place les blocs ailleurs',
        attendu: 'monde valide, varié, non répété et coordonnées intactes en ligne tant que |x| < 2³¹' },
      function (ligne) {
        var premierLocal = null, premierReseau = null, premierRepete = null, NP = MC.NetProtocol;
        distances.forEach(function (d) {
          var cx = Math.floor(d / C.CHUNK_X), cz = 3, x0 = cx * C.CHUNK_X, z0 = cz * C.CHUNK_Z;
          var t0 = maintenant();
          monde.getChunk(cx, cz, true);
          var genMs = maintenant() - t0, types = {}, nTypes = 0;
          for (var i = 0; i < 16; i++) for (var y = 0; y < C.WORLD_H; y += 4) {
            var b = monde.getBlock(x0 + i, y, z0 + (i * 7) % 16);
            if (!types[b]) { types[b] = 1; nTypes++; }
          }
          var hy = monde.heightAt(x0 + 5, z0 + 5), valide = isFinite(hy) && hy >= 1 && hy < C.WORLD_H && nTypes > 2;
          var pose = C.B.GLASS || C.B.STONE;
          monde.setBlock(x0 + 5, C.WORLD_H - 3, z0 + 5, pose);
          var aller = monde.getBlock(x0 + 5, C.WORLD_H - 3, z0 + 5) === pose;
          var hs = [];
          for (var k = 0; k < 24; k++) hs.push(monde.heightAt(d + k * 64, 100 + k * 37));
          var varie = Math.max.apply(null, hs) - Math.min.apply(null, hs) >= 3;
          // les détails bloc par bloc se répètent-ils 2³² blocs plus loin ?
          monde.getChunk(cx + DEUX32 / C.CHUNK_X, cz, true);
          var egaux = 0, tot = 0;
          for (var u = 0; u < 16; u += 2) for (var w = 0; w < 16; w += 3) for (var yy = 1; yy < 60; yy += 3) {
            tot++;
            if (monde.getBlock(x0 + u, yy, z0 + w) === monde.getBlock(x0 + u + DEUX32, yy, z0 + w)) egaux++;
          }
          var repete = egaux / tot > 0.98;
          var reseau = true;
          if (NP && NP.valider) {
            var v = NP.valider({ t: NP.MSG.BLOC, x: x0 + 5, y: 40, z: z0 + 5, id: 1, j: 0 });
            reseau = !!v && v.x === x0 + 5 && v.z === z0 + 5;
          }
          if (!(valide && aller && varie) && premierLocal === null) premierLocal = d;
          if (!reseau && premierReseau === null) premierReseau = d;
          if (repete && premierRepete === null) premierRepete = d;
          var n = notation(d);
          ligne(n + ' — chunk généré', (valide ? 'valide' : 'invalide (hauteur ' + hy + ', ' + nTypes + ' types)') + ', ' + arrondi(genMs, 0) + ' ms, ' + nTypes + ' types de blocs', valide ? 'ok' : 'echec');
          ligne(n + ' — pose puis lecture d’un bloc', aller ? 'identiques' : 'différentes', aller ? 'ok' : 'echec');
          ligne(n + ' — relief sur 1,5 km', varie ? 'varié' : 'figé', varie ? 'ok' : 'echec');
          ligne(n + ' — blocs identiques 2³² blocs plus loin', arrondi(100 * egaux / tot, 1) + ' %' + (repete ? ' (monde périodique)' : ''), repete ? 'echec' : 'ok');
          ligne(n + ' — coordonnée à travers le protocole réseau', reseau ? 'intacte' : 'tronquée en entier 32 bits', reseau ? 'ok' : 'echec');
        });
        return (premierLocal === null ? 'monde local valide sur toute la plage' : 'premier défaut local à ' + notation(premierLocal)) +
               (premierRepete === null ? '' : ' ; détails répétés tous les 2³² blocs dès ' + notation(premierRepete)) +
               (premierReseau === null ? '' : ' ; en ligne, coordonnées tronquées dès ' + notation(premierReseau));
      });

    // ── SPEC-LIMITE-004 : précision GPU (32 bits) et physique (64 bits) ──
    sonde('SPEC-LIMITE-004', 'Précision des positions : GPU (32 bits) et physique (64 bits)',
      { teste: 'la résolution d’une position monde en Float32 (shaders, matrices three.js) et en Float64 (physique, entités), et l’erreur d’un pas de marche',
        pourquoi: 'loin de l’origine, les animations en position monde saccadent et la géométrie tremble bien avant que la logique ne se trompe',
        attendu: 'pas 32 bits sous 1/64 de bloc (invisible) et pas de marche exact à 1 % près dans la zone jouable' },
      function (ligne) {
        var marche = 4.3 / 60, seuils = { visible: null, grossier: null, casse: null, physique: null };
        for (var k = 8; k <= 60; k++) {
          var d = Math.pow(2, k), p = pas32(d), e = Math.abs(((d + marche) - d) - marche) / marche;
          if (seuils.visible === null && p >= 1 / 64) seuils.visible = d;
          if (seuils.grossier === null && p >= 1 / 8) seuils.grossier = d;
          if (seuils.casse === null && p >= 1) seuils.casse = d;
          if (seuils.physique === null && e > 0.01) seuils.physique = d;
        }
        distances.concat([16777216]).sort(function (a, b) { return a - b; }).forEach(function (d) {
          var p = pas32(d), e = Math.abs(((d + marche) - d) - marche) / marche;
          ligne(notation(d) + ' — résolution GPU', p >= 1 ? p + ' bloc(s)' : '1/' + Math.round(1 / p) + ' bloc', p < 1 / 64 ? 'ok' : 'echec');
          ligne(notation(d) + ' — résolution physique, erreur d’un pas de marche', pas64(d).toExponential(1) + ' bloc, ' + arrondi(e * 100, 4) + ' %', e <= 0.01 ? 'ok' : 'echec');
        });
        ligne('Seuil : tremblement visible (≥ 1/64 bloc)', 'dès ' + seuils.visible + ' blocs de l’origine');
        ligne('Seuil : saccades nettes (≥ 1/8 bloc)', 'dès ' + seuils.grossier + ' blocs');
        ligne('Seuil : entiers non représentables en 32 bits (≥ 1 bloc)', 'dès ' + seuils.casse + ' blocs');
        ligne('Seuil : pas de marche faussé de plus de 1 %', seuils.physique === null ? 'jamais jusqu’à 2^60' : 'dès ' + notation(seuils.physique) + ' blocs');
        return 'premiers défauts visibles au GPU vers ' + seuils.visible + ' blocs de l’origine';
      });

    // ── SPEC-LIMITE-005 : coût de génération selon la distance (exploration profonde) ──
    if (!rapide) sonde('SPEC-LIMITE-005', 'Coût de génération selon la distance à l’origine',
      { teste: 'la durée de génération de chunks près et loin de l’origine',
        pourquoi: 'de très grands nombres peuvent ralentir le bruit ou changer la nature du monde',
        attendu: 'durée moyenne à moins de ×2 de celle de l’origine partout où le monde reste valide' },
      function (ligne) {
        var N = 8, ref = null, pire = 1;
        [0, 1e5, 1e7, 2e9].forEach(function (d) {
          var w = MC.createWorld(graine + 1), ts = [];
          for (var i = 0; i < N; i++) {
            var t0 = maintenant();
            w.getChunk(Math.floor(d / 16) + i * 5, 7 + i, true);
            ts.push(maintenant() - t0);
          }
          ts.sort(function (a, b) { return a - b; });
          var moy = ts.reduce(function (a, b) { return a + b; }, 0) / N;
          if (ref === null) ref = Math.max(1, moy);
          pire = Math.max(pire, moy / ref);
          ligne(d === 0 ? 'origine' : notation(d), N + ' chunks, moyenne ' + arrondi(moy, 1) + ' ms, médiane ' + arrondi(ts[N >> 1], 1) + ' ms',
                moy / ref <= 2 ? 'ok' : 'echec');
        });
        return 'écart maximal ×' + arrondi(pire, 2) + ' par rapport à l’origine';
      });

    return { sondes: sondes };
  }

  /* Construit le tableau récapitulatif et le vérifie : c'est la seule chose
     qui peut échouer (sonde plantée, ligne sans mesure ni statut connu). */
  function tableau(resultat) {
    if (!resultat || !resultat.sondes || !resultat.sondes.length) throw new Error('aucune sonde exécutée');
    var lignes = [], total = { ok: 0, echec: 0, info: 0 };
    resultat.sondes.forEach(function (s) {
      if (s.erreur) throw new Error(s.id + ' : la sonde a planté — ' + s.erreur);
      if (!s.lignes.length) throw new Error(s.id + ' : tableau vide');
      s.lignes.forEach(function (l) {
        if (!l.mesure || l.valeur === undefined || !STATUTS[l.statut]) throw new Error(s.id + ' : ligne mal formée ' + JSON.stringify(l));
        total[l.statut]++;
        lignes.push({ sonde: s.id, mesure: l.mesure, valeur: l.valeur, statut: l.statut });
      });
    });
    return { lignes: lignes, total: total };
  }

  /* Rendu texte (console) ou Markdown du tableau. */
  function texte(resultat, format) {
    var t = tableau(resultat), md = format === 'md', out = [];
    resultat.sondes.forEach(function (s) {
      if (md) {
        out.push('', '## ' + s.id + ' — ' + s.titre, '', '- **Ce qu’elle teste** : ' + s.fiche.teste,
                 '- **Pourquoi** : ' + s.fiche.pourquoi, '- **Attendu** : ' + s.fiche.attendu,
                 '- **Observé** : ' + s.conclusion + ' (' + (s.duree_ms / 1000).toFixed(1) + ' s)', '',
                 '| | Mesure | Valeur |', '|---|---|---|');
        s.lignes.forEach(function (l) { out.push('| ' + STATUTS[l.statut] + ' | ' + l.mesure + ' | ' + l.valeur.replace(/\|/g, '/') + ' |'); });
      } else {
        out.push('    ' + s.id + ' — ' + s.conclusion);
        s.lignes.forEach(function (l) { out.push('      ' + STATUTS[l.statut] + ' ' + l.mesure + ' : ' + l.valeur); });
      }
    });
    var bilan = t.total.ok + ' succès internes, ' + t.total.echec + ' échecs internes (limites atteintes), ' + t.total.info + ' valeurs relevées';
    return (md ? '**Bilan** : ' + bilan + '\n' : '    Bilan : ' + bilan + '\n') + out.join('\n');
  }

  G.MC_LIMITES = { sonder: sonder, tableau: tableau, texte: texte, pas32: pas32, pas64: pas64, STATUTS: STATUTS,
                   DISTANCES_RAPIDES: DISTANCES_RAPIDES, DISTANCES_COMPLETES: DISTANCES_COMPLETES };
})(typeof globalThis !== 'undefined' ? globalThis : this);
