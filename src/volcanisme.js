/* volcanisme.js — la vie d'un volcan actif (SPEC-RELIEF-011). Logique pure :
   tout se déduit de la graine, du volcan (MC.Biomes.volcanDe) et de l'heure,
   si bien que tous les postes voient les mêmes panaches, les mêmes éruptions
   et les mêmes coulées. Le jeu (et le serveur) posent les blocs ; le rendu
   dessine fumée et projectiles.
   - Un volcan actif fume toujours, plus ou moins fort.
   - De temps à autre il gronde, puis entre en éruption : il crache des bombes
     incandescentes, et la lave déborde de son cratère le long de la plus
     forte pente.
   - La coulée avance, puis se fige en basalte une fois l'éruption passée. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var FENETRE = 1200;          // une journée : au plus une éruption par volcan et par fenêtre
  var PROBA = 0.35;            // part des fenêtres où le volcan entre en éruption
  var GRONDEMENT = 25;         // secondes de grondement qui précèdent l'éruption
  var REFROIDISSEMENT = 90;    // la lave se fige en basalte ce temps après l'éruption

  function hache(a, b, c) {
    var h = Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function cle(v) { return [Math.round(v.x), Math.round(v.z)]; }

  /* L'éruption de la fenêtre qui contient `t`, ou null. */
  function eruptionDe(v, t, graine) {
    if (!v || !v.actif) return null;
    var k = Math.floor(t / FENETRE), c = cle(v), g = graine | 0;
    if (hache(c[0] + g, c[1], k) >= PROBA) return null;
    var debut = k * FENETRE + GRONDEMENT + hache(c[0], c[1] + g, k * 7 + 1) * (FENETRE - 400);
    var duree = 40 + hache(c[0], c[1], k * 7 + 2 + g) * 50;
    return { id: c[0] + ',' + c[1] + ':' + k, debut: debut, fin: debut + duree, force: 0.5 + hache(c[1], c[0], k + g) * 0.5,
             azimut: hache(c[0] * 3, c[1] * 5, k + g) * Math.PI * 2 };
  }

  /* L'activité du moment : fumée (0..1), grondement, éruption en cours. */
  function activite(v, t, graine) {
    if (!v || !v.actif) return { fumee: 0, grondement: false, eruption: null };
    var e = eruptionDe(v, t, graine);
    var fumee = 0.35 + 0.15 * Math.sin(t / 37 + (v.x % 7)) ;
    var grondement = false, enCours = null;
    if (e) {
      if (t >= e.debut - GRONDEMENT && t < e.debut) { grondement = true; fumee = Math.max(fumee, 0.6); }
      if (t >= e.debut && t < e.fin) { enCours = e; fumee = 1; }
      else if (t >= e.fin && t < e.fin + REFROIDISSEMENT) fumee = Math.max(fumee, 0.7 * (1 - (t - e.fin) / REFROIDISSEMENT));
    }
    return { fumee: Math.max(0, Math.min(1, fumee)), grondement: grondement, eruption: enCours, prochaine: e };
  }

  /* Bombes volcaniques lancées dans ]t0, t1] : quelques-unes par seconde
     d'éruption, depuis le cratère, en gerbe. */
  function projectiles(v, t0, t1, graine) {
    var l = [];
    var e = eruptionDe(v, t1, graine) || eruptionDe(v, t0, graine);
    if (!e) return l;
    var c = cle(v);
    for (var s = Math.floor(Math.max(t0, e.debut)); s <= Math.floor(Math.min(t1, e.fin)); s++) {
      var n = Math.round(1 + 3 * e.force);
      for (var i = 0; i < n; i++) {
        var t = s + hache(c[0] + i, c[1], s) ;
        if (t <= t0 || t > t1 || t < e.debut || t >= e.fin) continue;
        var a = hache(c[0], c[1] + i, s * 3) * Math.PI * 2, h = 0.3 + hache(i, s, c[0]) * 0.5;
        var vit = 14 + hache(s, i, c[1]) * 12 * e.force;
        l.push({ t: t, x: v.x + 0.5, y: v.sommet + 2, z: v.z + 0.5,
                 vx: Math.cos(a) * vit * (1 - h), vy: vit * (0.8 + h), vz: Math.sin(a) * vit * (1 - h) });
      }
    }
    return l;
  }

  /* Tracé de la coulée : du bord du cratère, pas à pas vers le voisin le plus
     bas (la plus forte pente), jusqu'à épuisement de sa longueur ou un creux. */
  function coulee(v, e, hauteur) {
    if (!v || !e) return [];
    var x = Math.round(v.x + Math.cos(e.azimut) * (v.cratere + 1));
    var z = Math.round(v.z + Math.sin(e.azimut) * (v.cratere + 1));
    var longueur = Math.round(20 + 45 * e.force), cellules = [], vus = {};
    var dx = Math.cos(e.azimut), dz = Math.sin(e.azimut);
    for (var i = 0; i < longueur; i++) {
      var h = hauteur(x, z);
      cellules.push({ x: x, y: h + 1, z: z, i: i });
      vus[x + ',' + z] = 1;
      // le voisin le plus bas, en préférant continuer dans le sens de l'écoulement
      var best = null, bh = Infinity;
      [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].forEach(function (d) {
        var nx = x + d[0], nz = z + d[1];
        if (vus[nx + ',' + nz]) return;
        var nh = hauteur(nx, nz) - (d[0] * dx + d[1] * dz) * 0.35;
        if (nh < bh) { bh = nh; best = [nx, nz]; }
      });
      if (!best || hauteur(best[0], best[1]) > h + 1) break;       // un creux : la lave s'y étale et s'arrête
      dx = best[0] - x; dz = best[1] - z;
      x = best[0]; z = best[1];
    }
    return cellules;
  }

  /* Ce que devient une cellule de la coulée à l'instant t : rien (pas encore
     atteinte), 'lave', ou 'basalte' (figée). La lave avance de deux cellules
     par seconde pendant l'éruption. */
  function etatCellule(cellule, e, t) {
    if (!e) return null;
    var atteinte = e.debut + cellule.i * 0.5;
    if (t < atteinte) return null;
    return t < e.fin + REFROIDISSEMENT ? 'lave' : 'basalte';
  }

  MC.Volcanisme = { eruptionDe: eruptionDe, activite: activite, projectiles: projectiles, coulee: coulee,
                    etatCellule: etatCellule, FENETRE: FENETRE, GRONDEMENT: GRONDEMENT, REFROIDISSEMENT: REFROIDISSEMENT };
})(typeof globalThis !== 'undefined' ? globalThis : this);
