/* caravanes.js — caravanes, voyageurs et bateaux (SPEC-ROUTE-006). Logique
   pure et déterministe : la position de chaque convoi est une fonction de
   l'heure du monde le long de son tracé (MC.Routes). Tous les postes voient
   donc les mêmes convois aux mêmes endroits, sans rien échanger sur le réseau.
   - Sur une route de commerce (ou un grand axe), une caravane marchande : un
     marchand et ses bêtes de bât.
   - Sur une route de tourisme, des voyageurs et leur guide.
   - Entre deux ports que relie l'eau, un bateau. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var PERIODE = 480;             // un départ par trajet toutes les 8 minutes, en moyenne
  var VITESSE = { commerce: 1.6, axe: 2.0, tourisme: 1.3, rural: 1.2, bateau: 3.2 };
  var ESPACEMENT = 2.2;          // blocs entre deux membres d'un convoi

  function hache(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* Longueurs cumulées d'un tracé (liste de { x, y, z }). */
  function longueurs(noeuds) {
    var c = [0];
    for (var i = 1; i < noeuds.length; i++) {
      c.push(c[i - 1] + Math.hypot(noeuds[i].x - noeuds[i - 1].x, noeuds[i].z - noeuds[i - 1].z));
    }
    return c;
  }
  /* Point à la distance `d` du début du tracé, et le cap (lacet, avant = −Z). */
  function pointA(noeuds, cumul, d) {
    var total = cumul[cumul.length - 1];
    d = Math.max(0, Math.min(total, d));
    var i = 1;
    while (i < cumul.length - 1 && cumul[i] < d) i++;
    var a = noeuds[i - 1], b = noeuds[i], seg = Math.max(1e-6, cumul[i] - cumul[i - 1]), k = (d - cumul[i - 1]) / seg;
    var x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k, y = a.y + ((b.y || a.y) - a.y) * k;
    return { x: x + 0.5, y: y, z: z + 0.5, yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)) };
  }

  /* Qui compose un convoi, selon son rôle ; même tirage pour tous. */
  function composition(role, id) {
    var r = hache(id + '#c');
    if (role === 'bateau') return [{ type: 'bateau', role: 'batelier' }];
    if (role === 'tourisme') {
      var n = 2 + Math.floor(r * 3), l = [{ type: 'villager', role: 'guide' }];
      for (var i = 0; i < n; i++) l.push({ type: 'villager', role: 'habitant' });
      return l;
    }
    var betes = 1 + Math.floor(r * 3), c = [{ type: 'villager', role: 'marchand_ambulant' }];
    for (var j = 0; j < betes; j++) c.push({ type: hache(id + j) < 0.5 ? 'goat' : 'pig', role: 'bat' });
    if (role === 'axe' && r > 0.5) c.push({ type: 'garde', role: 'garde' });
    return c;
  }

  /* Les convois d'un trajet présents à l'instant t. `trajet` : { id, role,
     noeuds } ; un départ toutes les PERIODE secondes (décalé par trajet), dans
     un sens puis dans l'autre ; chaque membre suit le précédent. */
  function enRoute(trajet, t) {
    var noeuds = trajet.noeuds;
    if (!noeuds || noeuds.length < 2) return [];
    var cumul = trajet.cumul || (trajet.cumul = longueurs(noeuds));
    var total = cumul[cumul.length - 1], v = VITESSE[trajet.role] || VITESSE.commerce;
    var duree = total / v, decalage = hache(trajet.id) * PERIODE;
    var res = [];
    var k1 = Math.floor((t - decalage) / PERIODE), k0 = Math.floor((t - decalage - duree - 30) / PERIODE);
    for (var k = Math.max(k0, -1e9); k <= k1; k++) {
      var depart = decalage + k * PERIODE;
      if (hache(trajet.id + ':' + k) < 0.25) continue;     // certains jours, personne ne part
      var parcouru = (t - depart) * v;
      var membres = composition(trajet.role, trajet.id + ':' + k);
      if (parcouru < 0 || parcouru - membres.length * ESPACEMENT > total) continue;
      var aller = k % 2 === 0;
      membres.forEach(function (m, i) {
        var d = parcouru - i * ESPACEMENT;
        if (d < 0 || d > total) return;
        var p = pointA(noeuds, cumul, aller ? d : total - d);
        if (!aller) p.yaw += Math.PI;
        res.push({ id: trajet.id + ':' + k + ':' + i, type: m.type, role: m.role, x: p.x, y: p.y, z: p.z, yaw: p.yaw,
                   convoi: trajet.id + ':' + k, depart: depart, vers: aller ? trajet.b : trajet.a });
      });
    }
    return res;
  }

  /* Trajets routiers à partir des connexions d'un lieu (MC.Routes). */
  function trajetsDe(lieu, routes) {
    if (!routes || !routes.connexionsDe) return [];
    return routes.connexionsDe(lieu).filter(function (c) { return c.role !== 'rural'; }).map(function (c) {
      var ch = routes.cheminEntre(lieu, c);
      if (!ch || !ch.nodes || ch.nodes.length < 2) return null;
      return { id: 'r:' + lieu.id + '>' + c.id, role: c.role || ch.role || 'commerce', noeuds: ch.nodes, a: lieu.nom, b: c.nom };
    }).filter(Boolean);
  }

  /* Une voie d'eau entre deux ports : le segment doit être en eau (au moins
     90 % des échantillons). `eauEn(x, z)` → vrai si la colonne est de l'eau
     navigable ; `niveau` : la hauteur de la surface. */
  function voieEau(p1, p2, eauEn, niveau) {
    var d = Math.hypot(p2.x - p1.x, p2.z - p1.z), n = Math.max(2, Math.ceil(d / 8)), ok = 0, noeuds = [];
    for (var i = 0; i <= n; i++) {
      var x = Math.round(p1.x + (p2.x - p1.x) * i / n), z = Math.round(p1.z + (p2.z - p1.z) * i / n);
      if (eauEn(x, z)) ok++;
      noeuds.push({ x: x, y: niveau, z: z });
    }
    if (ok / (n + 1) < 0.9) return null;
    return { id: 'b:' + p1.id + '>' + p2.id, role: 'bateau', noeuds: noeuds, a: p1.nom, b: p2.nom };
  }

  /* SPEC-ECO-004 : la cargaison d'un départ de caravane — un objet des clés
     de `stocksOrigine` (le lieu de départ), tiré par hachage de (trajet,
     indice de départ), et une quantité 4..11. Pure et déterministe : le
     même départ rejoué donne toujours la même cargaison (economie.js s'en
     sert pour l'idempotence, via son propre registre de départs traités). */
  function cargaisonDe(trajet, indexDepart, stocksOrigine) {
    var cles = Object.keys(stocksOrigine || {});
    if (!cles.length) return null;
    var idx = Math.floor(hache(trajet.id + '|c1|' + indexDepart) * cles.length) % cles.length;
    var n = 4 + Math.floor(hache(trajet.id + '|c2|' + indexDepart) * 8);
    return { id: +cles[idx], n: n };
  }

  MC.Caravanes = { enRoute: enRoute, trajetsDe: trajetsDe, voieEau: voieEau, composition: composition,
                   longueurs: longueurs, pointA: pointA, cargaisonDe: cargaisonDe,
                   PERIODE: PERIODE, VITESSE: VITESSE, ESPACEMENT: ESPACEMENT };
})(typeof globalThis !== 'undefined' ? globalThis : this);
