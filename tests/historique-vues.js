/* historique-vues.js — modèles et dessins PURS des vues de l'historique global
   (docs/banc/historique-global.md §3.2 et §3.3) : graphiques timeline
   (SPEC-BANC-041 à 045) et diaporamas par image (SPEC-BANC-046 à 051).

   Ni DOM ni réseau ici : des données du serveur (/tests/historique/series,
   /matrice, /images) en MODÈLES (positions, couleurs, textes d'infobulle) et
   en chaînes SVG écrites à la main — aucune dépendance. C'est ce qui permet de
   les prouver sous Node (tests/spec-historique-vues.js) ; tests/historique.js
   ne fait que les brancher sur la page (insertion, survol, clic, curseur).

   Chargé dans le navigateur par tests/index.html (pose `MC_HIST_VUES`) et
   sous Node par `require` (`module.exports`). */
(function (G) {
  'use strict';

  // ── couleurs des états (SPEC-BANC-042) ─────────────────────────────────
  var ETATS = ['reussi', 'echec', 'ignore', 'avertissement'];
  var COULEURS_ETAT = { reussi: '#3fb950', echec: '#f85149', ignore: '#8b949e', avertissement: '#f0883e' };
  var LIBELLES_ETAT = { reussi: 'réussis', echec: 'échecs', ignore: 'ignorés', avertissement: 'avertissements' };

  function echappe(s) {
    return String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function arrondi(n) { return Math.round(n * 10) / 10; }
  function dateCourte(iso) { return iso ? String(iso).replace('T', ' ').replace(/\.\d+Z$/, 'Z').slice(0, 16) : ''; }

  /* Texte d'infobulle d'un point (SPEC-BANC-045) : run, commit (court + sujet),
     date et valeur. `point` est un point de la série du serveur ; `date` vient
     de `debut_run` quand le serveur le donne, sinon de x (axe horodatage). */
  function texteInfobulle(point, valeur, axe) {
    var date = point.debut_run || (axe === 'debut_run' ? point.x : '');
    return 'run ' + point.run + ' · commit ' + (point.commit_court || '—') + (point.sujet_commit ? ' « ' + point.sujet_commit + ' »' : '') +
      (date ? ' · ' + dateCourte(date) : '') + (valeur !== undefined && valeur !== null && valeur !== '' ? ' · ' + valeur : '');
  }
  function etiquetteX(point, axe) {
    if (axe === 'rang_commit') return point.commit_court || ('#' + point.x);
    return point.x ? dateCourte(point.x).slice(5) : '';
  }

  var MARGE = { g: 44, d: 12, h: 12, b: 34 };

  // ══════════════════════════════════════════════════════════════════════
  // Barres empilées par run — plusieurs tests (SPEC-BANC-042)
  // ══════════════════════════════════════════════════════════════════════
  function modeleBarresEtat(serie, o) {
    o = o || {};
    var W = o.largeur || 640, H = o.hauteur || 180, axe = o.axe || 'debut_run';
    var iw = W - MARGE.g - MARGE.d, ih = H - MARGE.h - MARGE.b;
    var max = 1;
    serie.forEach(function (p) {
      var total = 0; ETATS.forEach(function (e) { total += (p.etat && p.etat[e]) || 0; });
      if (total > max) max = total;
    });
    var pas = serie.length ? iw / serie.length : iw;
    var lb = Math.max(2, Math.min(40, pas * 0.7));
    var barres = serie.map(function (p, i) {
      var cx = MARGE.g + pas * (i + 0.5), y = MARGE.h + ih;
      var segments = [];
      ETATS.forEach(function (e) {
        var n = (p.etat && p.etat[e]) || 0;
        if (!n) return;
        var h = ih * n / max;
        y -= h;
        segments.push({ etat: e, n: n, x: cx - lb / 2, y: y, w: lb, h: h, couleur: COULEURS_ETAT[e] });
      });
      var detail = ETATS.filter(function (e) { return p.etat && p.etat[e]; }).map(function (e) { return p.etat[e] + ' ' + LIBELLES_ETAT[e]; }).join(', ');
      return { run: p.run, cx: cx, segments: segments, etiquette: etiquetteX(p, axe), tip: texteInfobulle(p, detail, axe) };
    });
    return { type: 'barres', largeur: W, hauteur: H, max: max, barres: barres };
  }

  // ══════════════════════════════════════════════════════════════════════
  // Bande de pastilles — un seul test : une pastille par run (SPEC-BANC-042)
  // ══════════════════════════════════════════════════════════════════════
  /* Un seul test, donc un seul état par run ; si le test a tourné plusieurs fois dans
     le même run, le pire état l'emporte (un échec ne se cache pas derrière une réussite). */
  var PIRE_D_ABORD = ['echec', 'avertissement', 'ignore', 'reussi'];
  function etatUnique(p) {
    for (var i = 0; i < PIRE_D_ABORD.length; i++) if (p.etat && p.etat[PIRE_D_ABORD[i]]) return PIRE_D_ABORD[i];
    return null;
  }
  function modelePastilles(serie, o) {
    o = o || {};
    var W = o.largeur || 640, axe = o.axe || 'debut_run';
    var iw = W - MARGE.g - MARGE.d;
    var pas = serie.length ? iw / serie.length : iw;
    var r = Math.max(3, Math.min(9, pas / 2 - 1));
    var pastilles = serie.map(function (p, i) {
      var etat = etatUnique(p);
      return { run: p.run, etat: etat, cx: MARGE.g + pas * (i + 0.5), cy: 28, r: r, couleur: COULEURS_ETAT[etat] || '#555', etiquette: etiquetteX(p, axe), tip: texteInfobulle(p, etat || 'sans état', axe) };
    });
    return { type: 'pastilles', largeur: W, hauteur: 64, pastilles: pastilles };
  }

  // ══════════════════════════════════════════════════════════════════════
  // Courbes (SPEC-BANC-043) : médiane + p95 par run (plusieurs tests), valeur
  // brute (un seul), seuil « lent » en pointillés pour la durée.
  // ══════════════════════════════════════════════════════════════════════
  function ticks(max, n) {
    if (!(max > 0)) return [0];
    var brut = max / n, mag = Math.pow(10, Math.floor(Math.log(brut) / Math.LN10));
    var pas = [1, 2, 5, 10].map(function (k) { return k * mag; }).filter(function (p) { return p >= brut; })[0] || 10 * mag;
    var out = [];
    for (var v = 0; v <= max + pas * 0.001; v += pas) out.push(arrondi(v));
    return out;
  }
  /* `prop` : propriété numérique (duree_ms, nb_captures, …) ; `unique` : le
     filtre ne retient qu'un test ; `seuil` : seuil « lent » en ms (durée seulement). */
  function modeleCourbe(serie, prop, o) {
    o = o || {};
    var W = o.largeur || 640, H = o.hauteur || 180, axe = o.axe || 'debut_run', unique = !!o.unique;
    var avecSeuil = prop === 'duree_ms' && typeof o.seuil === 'number' && o.seuil > 0;
    var unite = prop === 'duree_ms' ? ' ms' : '';
    var noms = unique ? ['valeur'] : ['mediane', 'p95'];
    var max = 0;
    var brut = noms.map(function (nom) {
      return serie.map(function (p) {
        var d = p[prop];
        if (!d) return null;
        var v = unique ? (d.valeurs && d.valeurs.length ? d.valeurs[d.valeurs.length - 1] : null) : d[nom];
        if (typeof v !== 'number') return null;
        if (v > max) max = v;
        return v;
      });
    });
    if (avecSeuil && o.seuil > max) max = o.seuil;
    if (!(max > 0)) max = 1;
    var iw = W - MARGE.g - MARGE.d, ih = H - MARGE.h - MARGE.b;
    var pas = serie.length > 1 ? iw / (serie.length - 1) : 0;
    function px(i) { return serie.length > 1 ? MARGE.g + pas * i : MARGE.g + iw / 2; }
    function py(v) { return MARGE.h + ih - ih * v / max; }
    var lignes = noms.map(function (nom, k) {
      var points = [];
      brut[k].forEach(function (v, i) {
        if (v === null) return;
        var p = serie[i];
        points.push({ run: p.run, i: i, x: px(i), y: py(v), valeur: v, tip: texteInfobulle(p, nom + ' ' + arrondi(v) + unite, axe) });
      });
      return { nom: nom, points: points };
    });
    return {
      type: 'courbe', prop: prop, largeur: W, hauteur: H, max: max, unique: unique,
      lignes: lignes,
      seuil: avecSeuil ? { valeur: o.seuil, y: py(o.seuil), x1: MARGE.g, x2: W - MARGE.d } : null,
      ticksY: ticks(max, 4).map(function (v) { return { v: v, y: py(v) }; }),
      etiquettesX: serie.map(function (p, i) { return { x: px(i), texte: etiquetteX(p, axe), run: p.run }; }),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // Vue matrice (SPEC-BANC-044)
  // ══════════════════════════════════════════════════════════════════════
  function modeleMatrice(m, o) {
    o = o || {};
    var W = o.largeur || 640, axe = o.axe || 'debut_run';
    var gauche = 200, haut = 22;
    var cw = Math.max(5, Math.min(18, (W - gauche - MARGE.d) / Math.max(1, m.runs.length)));
    var rh = 11;
    var cellules = [];
    m.tests.forEach(function (t, ri) {
      m.runs.forEach(function (r, ci) {
        var etat = (m.cellules[t.cle] || {})[r.run] || null;
        cellules.push({
          run: r.run, cle: t.cle, etat: etat, x: gauche + ci * cw, y: haut + ri * rh, w: cw - 1, h: rh - 1,
          couleur: etat ? (COULEURS_ETAT[etat] || '#555') : null,
          tip: texteInfobulle(r, t.nom + ' : ' + (etat || 'absent de ce run'), axe),
        });
      });
    });
    return {
      type: 'matrice', largeur: gauche + m.runs.length * cw + MARGE.d, hauteur: haut + m.tests.length * rh + 4,
      lignes: m.tests.length, colonnes: m.runs.length, cellules: cellules,
      libellesTests: m.tests.map(function (t, ri) { return { y: haut + ri * rh + rh - 3, texte: t.nom, cle: t.cle }; }),
      libellesRuns: m.runs.map(function (r, ci) { return { x: gauche + ci * cw + cw / 2, texte: etiquetteX(r, axe), run: r.run }; }),
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // SVG (chaînes) — chaque élément cliquable porte data-run, chaque élément
  // survolable data-tip ; tests/historique.js délègue survol et clic.
  // ══════════════════════════════════════════════════════════════════════
  function enTete(m, extra) {
    return '<svg xmlns="http://www.w3.org/2000/svg" class="hist-svg" role="img" viewBox="0 0 ' + m.largeur + ' ' + m.hauteur + '" width="100%" preserveAspectRatio="xMinYMin meet"' + (extra || '') + '>';
  }
  function axeXTexte(items, y, cle) {
    var pas = Math.max(1, Math.ceil(items.length / 8));
    return items.map(function (it, i) {
      return i % pas ? '' : '<text class="hist-axe-x" x="' + arrondi(it.x !== undefined ? it.x : it.cx) + '" y="' + y + '" text-anchor="middle">' + echappe(it[cle || 'texte'] || it.etiquette) + '</text>';
    }).join('');
  }
  function svgBarres(m) {
    var bas = m.hauteur - MARGE.b;
    var s = enTete(m, ' data-graphe="etat-barres"');
    s += '<line class="hist-axe" x1="' + MARGE.g + '" y1="' + bas + '" x2="' + (m.largeur - MARGE.d) + '" y2="' + bas + '"/>';
    s += '<text class="hist-axe-y" x="' + (MARGE.g - 6) + '" y="' + (MARGE.h + 8) + '" text-anchor="end">' + m.max + '</text><text class="hist-axe-y" x="' + (MARGE.g - 6) + '" y="' + bas + '" text-anchor="end">0</text>';
    m.barres.forEach(function (b) {
      s += '<g class="hist-barre-run" data-run="' + echappe(b.run) + '" data-tip="' + echappe(b.tip) + '">';
      b.segments.forEach(function (g) {
        s += '<rect class="seg etat-' + g.etat + '" data-etat="' + g.etat + '" data-n="' + g.n + '" x="' + arrondi(g.x) + '" y="' + arrondi(g.y) + '" width="' + arrondi(g.w) + '" height="' + arrondi(g.h) + '" fill="' + g.couleur + '"/>';
      });
      s += '</g>';
    });
    s += axeXTexte(m.barres.map(function (b) { return { x: b.cx, texte: b.etiquette }; }), bas + 14);
    return s + '</svg>';
  }
  function svgPastilles(m) {
    var s = enTete(m, ' data-graphe="etat-pastilles"');
    m.pastilles.forEach(function (p) {
      s += '<circle class="pastille etat-' + (p.etat || 'aucun') + '" data-run="' + echappe(p.run) + '" data-etat="' + (p.etat || '') + '" data-tip="' + echappe(p.tip) + '" cx="' + arrondi(p.cx) + '" cy="' + p.cy + '" r="' + arrondi(p.r) + '" fill="' + p.couleur + '"/>';
    });
    s += axeXTexte(m.pastilles.map(function (p) { return { x: p.cx, texte: p.etiquette }; }), 54);
    return s + '</svg>';
  }
  var COULEURS_COURBE = { mediane: '#58a6ff', p95: '#d29922', valeur: '#58a6ff' };
  function svgCourbe(m) {
    var bas = m.hauteur - MARGE.b;
    var s = enTete(m, ' data-graphe="courbe-' + echappe(m.prop) + '"');
    m.ticksY.forEach(function (t) {
      s += '<line class="hist-grille" x1="' + MARGE.g + '" y1="' + arrondi(t.y) + '" x2="' + (m.largeur - MARGE.d) + '" y2="' + arrondi(t.y) + '"/><text class="hist-axe-y" x="' + (MARGE.g - 6) + '" y="' + arrondi(t.y + 3) + '" text-anchor="end">' + t.v + '</text>';
    });
    m.lignes.forEach(function (l) {
      if (!l.points.length) return;
      s += '<polyline class="courbe courbe-' + l.nom + '" fill="none" stroke="' + COULEURS_COURBE[l.nom] + '" stroke-width="1.6" points="' + l.points.map(function (p) { return arrondi(p.x) + ',' + arrondi(p.y); }).join(' ') + '"/>';
      l.points.forEach(function (p) {
        s += '<circle class="point point-' + l.nom + '" data-run="' + echappe(p.run) + '" data-tip="' + echappe(p.tip) + '" cx="' + arrondi(p.x) + '" cy="' + arrondi(p.y) + '" r="3.4" fill="' + COULEURS_COURBE[l.nom] + '"/>';
      });
    });
    if (m.seuil) {
      s += '<line class="seuil-lent" stroke="#f85149" stroke-width="1.2" stroke-dasharray="6 4" x1="' + m.seuil.x1 + '" y1="' + arrondi(m.seuil.y) + '" x2="' + m.seuil.x2 + '" y2="' + arrondi(m.seuil.y) + '" data-valeur="' + m.seuil.valeur + '"/>';
      s += '<text class="hist-axe-y seuil-texte" x="' + (m.largeur - MARGE.d) + '" y="' + arrondi(m.seuil.y - 3) + '" text-anchor="end" fill="#f85149">seuil lent</text>';
    }
    s += '<line class="hist-axe" x1="' + MARGE.g + '" y1="' + bas + '" x2="' + (m.largeur - MARGE.d) + '" y2="' + bas + '"/>';
    s += axeXTexte(m.etiquettesX, bas + 14);
    return s + '</svg>';
  }
  function svgMatrice(m) {
    var s = enTete(m, ' data-graphe="matrice" data-colonnes="' + m.colonnes + '" data-lignes="' + m.lignes + '"');
    m.libellesTests.forEach(function (l) {
      s += '<text class="hist-axe-y" x="196" y="' + l.y + '" text-anchor="end" font-size="9">' + echappe(l.texte.length > 34 ? l.texte.slice(0, 33) + '…' : l.texte) + '</text>';
    });
    var pas = Math.max(1, Math.ceil(m.libellesRuns.length / 8));
    m.libellesRuns.forEach(function (l, i) { if (i % pas === 0) s += '<text class="hist-axe-x" x="' + arrondi(l.x) + '" y="12" text-anchor="middle" font-size="9">' + echappe(l.texte) + '</text>'; });
    m.cellules.forEach(function (c) {
      s += '<rect class="cel etat-' + (c.etat || 'aucun') + '" data-run="' + echappe(c.run) + '" data-etat="' + (c.etat || '') + '" data-tip="' + echappe(c.tip) + '" x="' + c.x + '" y="' + c.y + '" width="' + c.w + '" height="' + c.h + '" fill="' + (c.couleur || 'rgba(255,255,255,.06)') + '"/>';
    });
    return s + '</svg>';
  }

  // ══════════════════════════════════════════════════════════════════════
  // Diaporamas par image (SPEC-BANC-046 à 051)
  // ══════════════════════════════════════════════════════════════════════
  /* Identité d'une image (SPEC-BANC-048) : rôle + libellé. Les mêmes que
     tools/historique.js cleImage (le serveur désigne ses témoins ainsi). */
  function cleImage(c) { return (c && c.role ? c.role : '') + '|' + (c && c.libelle ? c.libelle : ''); }
  var RANG_ROLE = { debut: 0, intermediaire: 1, triplet: 1, fin: 2 };
  /* Ordre du test (SPEC-BANC-046) : première, intermédiaires par t_ms, dernière. */
  function ordonnerCaptures(captures) {
    return (Array.isArray(captures) ? captures : []).map(function (c, i) { return { c: c, i: i }; }).sort(function (a, b) {
      var ra = RANG_ROLE[a.c.role] === undefined ? 1 : RANG_ROLE[a.c.role], rb = RANG_ROLE[b.c.role] === undefined ? 1 : RANG_ROLE[b.c.role];
      if (ra !== rb) return ra - rb;
      var ta = typeof a.c.t_ms === 'number' ? a.c.t_ms : Infinity, tb = typeof b.c.t_ms === 'number' ? b.c.t_ms : Infinity;
      if (ta !== tb) return ta - tb;
      return a.i - b.i;
    }).map(function (x) { return x.c; });
  }
  /* Les positions du diaporama d'UNE image : une par run du test, dans l'ordre
     reçu du serveur (tri et filtres déjà appliqués) ; un run qui n'a pas cette
     image garde sa position, `capture: null` (« pas de capture »), plutôt que
     d'être sauté. */
  function positionsImage(passages, cle) {
    return (Array.isArray(passages) ? passages : []).map(function (pa) {
      var cap = (Array.isArray(pa.captures) ? pa.captures : []).filter(function (c) { return cleImage(c) === cle; })[0] || null;
      return { passage: pa, capture: cap };
    });
  }
  /* Les images distinctes d'un test, dans l'ordre d'apparition du passage le
     plus récent qui les porte, pour que les vignettes d'un run fixent l'ordre
     (SPEC-BANC-046). */
  function imagesDuPassage(passage) {
    return ordonnerCaptures(passage && passage.captures).filter(function (c) { return c && c.libelle !== undefined; });
  }
  /* Légende sous l'image (SPEC-BANC-048) : date, commit court + sujet, état, durée, inscrit ou non. */
  function legendePassage(pa) {
    return [dateCourte(pa.debut_run), (pa.commit_court || '—') + (pa.sujet_commit ? ' « ' + pa.sujet_commit + ' »' : ''),
      pa.etat || '?', typeof pa.duree_ms === 'number' ? Math.round(pa.duree_ms) + ' ms' : '—', pa.inscrit ? 'inscrit' : 'non inscrit'].join(' · ');
  }
  /* Synchroniser (SPEC-BANC-049) : la position du diaporama `positions` qui
     correspond au run donné, ou -1 si ce diaporama ne contient pas ce run. */
  function indexDuRun(positions, run) {
    for (var i = 0; i < positions.length; i++) if (positions[i].passage.run === run) return i;
    return -1;
  }
  function borner(i, n) { return n ? Math.max(0, Math.min(n - 1, i)) : 0; }

  var API = {
    ETATS: ETATS, COULEURS_ETAT: COULEURS_ETAT,
    texteInfobulle: texteInfobulle,
    modeleBarresEtat: modeleBarresEtat, modelePastilles: modelePastilles, modeleCourbe: modeleCourbe, modeleMatrice: modeleMatrice,
    svgBarres: svgBarres, svgPastilles: svgPastilles, svgCourbe: svgCourbe, svgMatrice: svgMatrice,
    cleImage: cleImage, ordonnerCaptures: ordonnerCaptures, positionsImage: positionsImage, imagesDuPassage: imagesDuPassage,
    legendePassage: legendePassage, indexDuRun: indexDuRun, borner: borner, echappe: echappe,
  };
  G.MC_HIST_VUES = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
