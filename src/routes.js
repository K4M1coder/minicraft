/* routes.js — routes de commerce et de tourisme entre les lieux habités.
   Logique pure, comme donjons.js et habitats.js : un réseau de routes est
   entièrement déterminé par la graine et les lieux (eux-mêmes purs), et
   chaque chunk pose SA part sans connaître les autres, dans n'importe quel
   ordre de génération.

   - graphe (SPEC-ROUTE-001) : chaque ville se relie à ses villes voisines,
     aux villages alentour, et à un ou deux sites remarquables ;
   - tracé (SPEC-ROUTE-002) : une marche gourmande qui ne s'autorise qu'un
     bloc de dénivelé par pas, en essayant plusieurs caps avant de trancher —
     c'est ce qui la fait contourner ce qui est trop raide plutôt que le
     gravir en marches ;
   - ponts (SPEC-ROUTE-003) : quand aucun cap n'évite un dénivelé trop fort
     (un ravin, une rivière encaissée), le tracé saute par-dessus en ligne
     droite, à hauteur constante, porté par des piliers ;
   - tourisme (SPEC-ROUTE-004) : volcans, lacs et sommets proches d'une ville
     reçoivent eux aussi leur route, comme un village ;
   - carrefours et éclairage (SPEC-ROUTE-005) : à la sortie de chaque ville,
     un panneau donne le nom et la distance de la destination ; aux abords,
     des lampadaires jalonnent la route. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var B = C.B, WH = C.WORLD_H;

  // ─── réglages ──────────────────────────────────────────────────────────────
  /* Portées volontairement modestes : chaque route est calculée pas à pas
     (SPEC-ROUTE-002), donc son coût grandit avec sa longueur — les garder
     courtes garde la génération rapide sans changer ce que voit le joueur
     (les routes les plus lointaines ne se posent que quand on s'en approche). */
  var RAYON_RECHERCHE = 3100;      // depuis un chunk, jusqu'où chercher une ville concernée
  var RAYON_RECHERCHE_MEGAPOLE = 9500;  // idem pour une mégapole, bien plus espacée (HABITAT-013)
  var MAX_VILLES = 2;              // voisines les plus proches reliées entre villes
  var MAX_VILLAGES = 3;            // villages alentour reliés à chaque ville
  var MAX_MEGAPOLES = 2;           // mégapoles voisines reliées par un grand axe (ROUTE-007)
  var MAX_MAISONS = 2;             // habitations isolées reliées par un chemin rural (ROUTE-007)
  var DIST_MAX_VILLE = 3000;       // au-delà, deux villes ne commercent plus directement
  var DIST_MAX_VILLAGE = 1600;
  var DIST_MAX_MEGAPOLE = 9000;
  var DIST_MAX_MAISON = 400;
  var RAYON_POI = 1200;            // sites remarquables cherchés autour d'une ville
  var DIST_MAX_SOMMET = 26;        // élévation minimale au-dessus de la ville pour un « sommet »
  var MAX_STEP = 1;                // dénivelé toléré par pas de marche (SPEC-ROUTE-002)
  var PAS = 1;                     // longueur d'un pas de marche, en blocs
  var CANDIDATS = [-0.28, 0, 0.28];   // déviations de cap essayées à chaque pas (radians)
  var PORTEE_PONT = 48;            // longueur maximale d'un pont
  var MARGE_COULOIR = 40;          // corridor autour du segment A→B où un chunk est concerné
  var RAYON_LAMPES = 60;           // abords de ville éclairés
  var PAS_LAMPE = 9;               // tous les combien de blocs un lampadaire

  /* Rôle d'une connexion selon le type du lieu visé (SPEC-ROUTE-007) : grand
     axe entre mégapoles et villes, commerce vers villes et villages, chemin
     rural vers une habitation isolée, tourisme vers un site remarquable.
     `poserNoeud` s'en sert pour la largeur et le matériau (largeur/matériau
     selon le rang) ; `chemin.role` garde le rôle du lien, comme avant. */
  var ROLE_PAR_TYPE = { megapole: 'axe', ville: 'commerce', village: 'commerce', maison: 'rural',
                         volcan: 'tourisme', lac: 'tourisme', sommet: 'tourisme' };
  /* Matériau et demi-largeur (blocs de chaque côté de l'axe central) selon le
     rang de la route (SPEC-ROUTE-007). Les ponts restent en planches/cobble,
     quel que soit le rôle (SPEC-ROUTE-003, déjà testé ainsi). */
  var GABARIT_PAR_ROLE = { axe: { demiLargeur: 1 }, commerce: { demiLargeur: 0 }, rural: { demiLargeur: 0 }, tourisme: { demiLargeur: 0 } };

  function creer(N, hauteur, habitats, Bio, zoneEn) {
    if (!habitats) return { appliquer: function () { return 0; }, connexionsDe: function () { return []; }, cheminEntre: function () { return null; } };

    // ─── graphe ──────────────────────────────────────────────────────────────
    var connexions = new Map();     // ville.id -> [ { x, z, id, nom, type, dist } ]
    var poiCache = new Map();       // ville.id -> [ { x, z, id, nom, type } ]

    /* Les lieux d'UN SEUL genre dans un rayon, en ne parcourant que la maille
       de ce genre — `habitats.lieuxProches` balaie villes, villages ET
       maisons ensemble, ce qui est bien trop coûteux à un rayon de plusieurs
       milliers de blocs (la maille des maisons est fine : des milliers de
       régions à visiter). Les routes n'ont besoin que d'un genre à la fois. */
    var LIEUX = MC.Habitats ? MC.Habitats.LIEUX : null;
    function lieuxDuGenre(kind, x, z, rayon) {
      if (!LIEUX) return [];
      var R = LIEUX[kind].region;
      var rx0 = Math.floor((x - rayon) / R), rx1 = Math.floor((x + rayon) / R);
      var rz0 = Math.floor((z - rayon) / R), rz1 = Math.floor((z + rayon) / R);
      var res = [];
      for (var rx = rx0; rx <= rx1; rx++) for (var rz = rz0; rz <= rz1; rz++) {
        var l = habitats.lieuDeRegion(kind, rx, rz);
        if (l && Math.hypot(l.x - x, l.z - z) <= rayon + l.demi) res.push(l);
      }
      res.sort(function (a, b) { return Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z); });
      return res;
    }

    /* Sites remarquables autour d'une ville (SPEC-ROUTE-004) : les volcans et
       lacs déjà cartographiés par biomes.js (pas de parcours du monde), et un
       sommet trouvé par un sondage grossier du relief alentour. */
    var MAX_POI_PAR_TYPE = 1;       // au plus un volcan et un lac par ville (sinon des dizaines de lacs proches)
    function poisDe(v) {
      if (poiCache.has(v.id)) return poiCache.get(v.id);
      var res = [];
      function plusProches(liste) {
        return liste.sort(function (a, b) { return a.d - b.d; }).slice(0, MAX_POI_PAR_TYPE);
      }
      if (Bio && Bio.volcansDansZone) {
        var vol = Bio.volcansDansZone(v.x - RAYON_POI, v.z - RAYON_POI, v.x + RAYON_POI, v.z + RAYON_POI)
          .map(function (vo) { return { vo: vo, d: Math.hypot(vo.x - v.x, vo.z - v.z) }; });
        plusProches(vol).forEach(function (e) {
          var vo = e.vo;
          res.push({ x: vo.x, z: vo.z, id: 'poi:volcan:' + vo.x + ',' + vo.z,
                     nom: (vo.actif ? 'Volcan' : 'Volcan éteint') + ' ' + (vo.type || ''), type: 'volcan' });
        });
      }
      if (Bio && Bio.lacsDansZone) {
        var lac = Bio.lacsDansZone(v.x - RAYON_POI, v.z - RAYON_POI, v.x + RAYON_POI, v.z + RAYON_POI)
          .map(function (la) { return { la: la, d: Math.hypot(la.x - v.x, la.z - v.z) }; });
        plusProches(lac).forEach(function (e) {
          var la = e.la;
          res.push({ x: la.x, z: la.z, id: 'poi:lac:' + la.x + ',' + la.z, nom: 'Lac', type: 'lac' });
        });
      }
      // sommet : le point le plus haut d'un sondage grossier autour de la ville
      var meilleur = -1, mx = 0, mz = 0, PAS_S = 150, R_S = 900;
      for (var dx = -R_S; dx <= R_S; dx += PAS_S) for (var dz = -R_S; dz <= R_S; dz += PAS_S) {
        var h = hauteur(v.x + dx, v.z + dz);
        if (h > meilleur) { meilleur = h; mx = v.x + dx; mz = v.z + dz; }
      }
      if (meilleur - v.h0 >= DIST_MAX_SOMMET) {
        res.push({ x: mx, z: mz, id: 'poi:sommet:' + mx + ',' + mz, nom: 'Sommet', type: 'sommet' });
      }
      poiCache.set(v.id, res);
      return res;
    }

    /* SPEC-DENSITE-001/002 : la même carte que celle branchée dans
       habitats.js (mêmes fonctions, même graine ⇒ le même classement), pour
       que les routes rarélient les zones vierges (SPEC-ROUTE-007) sans
       dépendre d'un état partagé avec habitats.js. */
    var Dens = MC.Densite && Bio && Bio.biomeAt ? MC.Densite.creer(N, hauteur, Bio.biomeAt, Bio.riviere) : null;

    /* Les connexions d'un pôle — ville OU mégapole (SPEC-ROUTE-001/007),
       calculées une fois et mises en cache par lieu : mégapoles voisines (un
       grand axe), villes voisines (un grand axe si l'un des deux pôles est
       une mégapole, sinon du commerce), villages et habitations isolées
       alentour, et sites remarquables. */
    function connexionsDe(hub) {
      if (connexions.has(hub.id)) return connexions.get(hub.id);
      var res = [], estMegapole = hub.kind === 'megapole';
      function dist(l) { return Math.hypot(l.x - hub.x, l.z - hub.z); }

      if (LIEUX && LIEUX.megapole) {
        lieuxDuGenre('megapole', hub.x, hub.z, DIST_MAX_MEGAPOLE)
          .filter(function (l) { return l.id !== hub.id; }).slice(0, MAX_MEGAPOLES)
          .forEach(function (l) { res.push({ x: l.x, z: l.z, id: l.id, nom: l.nom, type: 'megapole', demi: l.demi,
                                             role: ROLE_PAR_TYPE.megapole, dist: dist(l) }); });
      }
      var voisines = lieuxDuGenre('ville', hub.x, hub.z, DIST_MAX_VILLE)
        .filter(function (l) { return l.id !== hub.id; })
        .slice(0, MAX_VILLES);
      voisines.forEach(function (l) {
        res.push({ x: l.x, z: l.z, id: l.id, nom: l.nom, type: 'ville', demi: l.demi,
                   role: estMegapole ? 'axe' : ROLE_PAR_TYPE.ville, dist: dist(l) });
      });
      var villages = lieuxDuGenre('village', hub.x, hub.z, DIST_MAX_VILLAGE)
        .slice(0, MAX_VILLAGES);
      villages.forEach(function (l) {
        res.push({ x: l.x, z: l.z, id: l.id, nom: l.nom, type: 'village', demi: l.demi,
                   role: ROLE_PAR_TYPE.village, dist: dist(l) });
      });
      // chemins ruraux : quelques habitations isolées, tout près (ROUTE-007)
      if (LIEUX && LIEUX.maison) {
        lieuxDuGenre('maison', hub.x, hub.z, DIST_MAX_MAISON).slice(0, MAX_MAISONS)
          .forEach(function (l) { res.push({ x: l.x, z: l.z, id: l.id, nom: l.nom, type: 'maison', demi: l.demi,
                                             role: ROLE_PAR_TYPE.maison, dist: dist(l) }); });
      }
      poisDe(hub).forEach(function (p) {
        res.push({ x: p.x, z: p.z, id: p.id, nom: p.nom, type: p.type, role: ROLE_PAR_TYPE[p.type] || 'tourisme',
                   dist: dist(p) });
      });
      connexions.set(hub.id, res);
      return res;
    }

    /* SPEC-ROUTE-007 : en zone vierge (MC.Densite), on ne trace presque
       jamais de route « secondaire » (commerce/rural/tourisme) — seuls les
       grands axes (mégapole ↔ ville/mégapole) la traversent systématiquement,
       comme de vraies autoroutes qui relient les pôles sans se soucier de ce
       qu'il y a entre les deux. Test au milieu du segment, déterministe. */
    function routeAutorisee(a, e) {
      if (!Dens || e.role === 'axe') return true;
      var mx = (a.x + e.x) / 2, mz = (a.z + e.z) / 2;
      if (Dens.classeEn(mx, mz).classe !== 'vierge') return true;
      var r = N.hash2(Math.floor(mx) * 131 + 7, Math.floor(mz) * 997 - 3);
      return r < 0.12;
    }

    // ─── tracé ───────────────────────────────────────────────────────────────
    var chemins = new Map();        // clé de paire -> chemin calculé (cache)
    function cleChemin(idA, idB) { return idA < idB ? idA + '|' + idB : idB + '|' + idA; }

    /* Un pas de marche : depuis (x, z) au cap `angle`, en tolérant MAX_STEP de
       dénivelé (SPEC-ROUTE-002). Plusieurs caps voisins sont essayés ; celui
       qui reste sous MAX_STEP et se rapproche le plus de la cible gagne — ce
       qui contourne ce qui est trop raide sans jamais franchir plus d'un
       bloc d'un coup. Si aucun cap ne convient, renvoie null : c'est alors un
       pont qu'il faut poser (voir `ponter`). */
    function essaiPas(x, z, y, capIdeal, bx, bz) {
      var meilleur = null, meilleurScore = Infinity;
      var horsTol = null, horsTolScore = Infinity;      // le moins mauvais cap, même trop raide
      for (var i = 0; i < CANDIDATS.length; i++) {
        var a = capIdeal + CANDIDATS[i];
        var nx = x + Math.cos(a) * PAS, nz = z + Math.sin(a) * PAS;
        var ny = hauteur(nx, nz);
        var restant = Math.hypot(bx - nx, bz - nz);
        var score = restant + Math.abs(CANDIDATS[i]) * 6;
        if (Math.abs(ny - y) <= MAX_STEP) {
          if (score < meilleurScore) { meilleurScore = score; meilleur = { x: nx, z: nz, y: ny, a: a }; }
        } else if (Math.abs(ny - y) < horsTolScore) {
          horsTolScore = Math.abs(ny - y); horsTol = { x: nx, z: nz, y: ny, a: a };
        }
      }
      return { ok: meilleur, horsTol: horsTol };
    }

    /* Un pont : on avance en ligne droite au cap courant, à hauteur constante
       (celle du dernier point sec), jusqu'à retrouver un terrain proche de
       cette hauteur ou jusqu'à la portée maximale (SPEC-ROUTE-003). */
    function ponter(x, z, y, angle, bx, bz) {
      var pts = [];
      for (var d = PAS; d <= PORTEE_PONT; d += PAS) {
        var nx = x + Math.cos(angle) * d, nz = z + Math.sin(angle) * d;
        var ny = hauteur(nx, nz);
        // le terrain remonte au-dessus du tablier : ce n'était pas un creux à
        // enjamber (une rivière, un ravin) mais une pente qui se redresse —
        // on arrête le pont ici, la marche reprendra en escalier (`tracer`)
        if (ny > y + MAX_STEP) break;
        pts.push({ x: Math.round(nx), z: Math.round(nz), y: y, pont: true, hSol: Math.min(y - 1, ny) });
        if (Math.abs(ny - y) <= MAX_STEP && d > PAS * 3) break;
      }
      return pts;
    }

    /* Le tracé complet entre deux points, en coordonnées entières (SPEC-ROUTE-002
       et SPEC-ROUTE-003). Bornée à quelques milliers de blocs et calculée une
       seule fois par paire — un chunk qui la retrouve ensuite ne fait que
       relire les points qui tombent dans ses limites. */
    function tracer(ax, az, bx, bz) {
      var nodes = [];
      var x = ax, z = az, y = hauteur(ax, az);
      nodes.push({ x: Math.round(x), z: Math.round(z), y: y, pont: false });
      var restants = Math.hypot(bx - ax, bz - az);
      var LIMITE = Math.ceil(restants / PAS) + 200;
      for (var i = 0; i < LIMITE; i++) {
        var d = Math.hypot(bx - x, bz - z);
        if (d < PAS * 2) break;
        var capIdeal = Math.atan2(bz - z, bx - x);
        var pas = essaiPas(x, z, y, capIdeal, bx, bz);
        if (pas.ok) {
          x = pas.ok.x; z = pas.ok.z; y = pas.ok.y;
          nodes.push({ x: Math.round(x), z: Math.round(z), y: y, pont: false });
        } else if (pas.horsTol && pas.horsTol.y < y) {
          // le sol se dérobe (rivière, ravin) : on l'enjambe (SPEC-ROUTE-003)
          var pont = ponter(x, z, y, capIdeal, bx, bz);
          if (!pont.length) break;
          pont.forEach(function (p) { nodes.push(p); });
          var dernier = pont[pont.length - 1];
          x = dernier.x; z = dernier.z; y = y;
        } else if (pas.horsTol) {
          // le sol se redresse (une pente trop raide pour un pas) : un
          // escalier, un bloc de dénivelé à la fois — jamais plus (SPEC-ROUTE-002)
          var cible = pas.horsTol, pasV = cible.y > y ? 1 : -1, nMarches = Math.abs(cible.y - y);
          for (var s = 1; s <= nMarches; s++) {
            var t = s / nMarches;
            nodes.push({ x: Math.round(x + (cible.x - x) * t), z: Math.round(z + (cible.z - z) * t), y: y + pasV * s, pont: false });
          }
          x = cible.x; z = cible.z; y = cible.y;
        } else break;
      }
      nodes.push({ x: Math.round(bx), z: Math.round(bz), y: hauteur(bx, bz), pont: false });
      return nodes;
    }

    /* `a`/`b` : { x, z, id, nom, demi, role? }. `role` (commerce/tourisme,
       voir ROLE_PAR_TYPE) se lit sur `b` — la destination porte le rôle de la
       liaison, comme dans `connexionsDe` ; à défaut, une liaison de commerce. */
    function cheminEntre(a, b) {
      var key = cleChemin(a.id, b.id);
      if (chemins.has(key)) return chemins.get(key);
      var nodes = tracer(a.x, a.z, b.x, b.z);
      var chemin = { nodes: nodes, a: a, b: b, role: b.role || a.role || 'commerce' };
      chemins.set(key, chemin);
      return chemin;
    }

    // ─── application aux chunks ────────────────────────────────────────────
    /* Distance d'un point au segment [A,B] : un test bon marché pour savoir,
       avant de calculer tout le tracé détaillé, si ce chunk a une chance
       d'être concerné par cette route. */
    function distSegment(px, pz, ax, az, bx, bz) {
      var dx = bx - ax, dz = bz - az, len2 = dx * dx + dz * dz;
      var t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      var qx = ax + t * dx, qz = az + t * dz;
      return Math.hypot(px - qx, pz - qz);
    }

    /* SPEC-ROUTE-007 : matériau et largeur selon le rang du lien — les
       grands axes (mégapole ↔ ville/mégapole) sont pavés et deux fois plus
       larges ; commerce (ville/village) reste au gravier ; les chemins
       ruraux (habitations isolées) ne sont que de la terre battue. Les
       ponts, eux, gardent toujours planches et piliers de moellons quel que
       soit le rôle (SPEC-ROUTE-003, testé ainsi). */
    var MATERIAU_PAR_ROLE = { axe: B.PAVE, commerce: B.GRAVEL, rural: B.DIRT, tourisme: B.GRAVEL };
    function poserNoeud(pt, put, cote, role) {
      var y = pt.y;
      if (pt.pont) {
        put(pt.x, y, pt.z, B.PLANKS);
        for (var yy = Math.max(1, pt.hSol); yy < y; yy++) put(pt.x, yy, pt.z, B.COBBLE);
      } else {
        var mat = MATERIAU_PAR_ROLE[role] || B.GRAVEL;
        put(pt.x, y, pt.z, mat);
        put(pt.x, y - 1, pt.z, mat);
        var demiL = (GABARIT_PAR_ROLE[role] || GABARIT_PAR_ROLE.commerce).demiLargeur;
        if (demiL && pt.perp) {
          for (var s = 1; s <= demiL; s++) {
            put(pt.x + pt.perp.x * s, y, pt.z + pt.perp.z * s, mat);
            put(pt.x + pt.perp.x * s, y - 1, pt.z + pt.perp.z * s, mat);
            put(pt.x - pt.perp.x * s, y, pt.z - pt.perp.z * s, mat);
            put(pt.x - pt.perp.x * s, y - 1, pt.z - pt.perp.z * s, mat);
          }
        }
      }
      put(pt.x, y + 1, pt.z, 0); put(pt.x, y + 2, pt.z, 0);
      if (pt.lampe && cote) {
        var lx = pt.x + cote.x, lz = pt.z + cote.z;
        put(lx, y, lz, B.COBBLE); put(lx, y + 1, lz, B.COBBLE); put(lx, y + 2, lz, B.LANTERN);
      }
      if (pt.panneau || pt.borneZone) {
        put(pt.x, y + 1, pt.z, B.PANNEAU_INFO);
      }
    }

    /* Marque les nœuds à éclairer (abords de ville) et le panneau de sortie
       de ville (SPEC-ROUTE-005), sans reconstruire le chemin — on annote la
       copie en cache une seule fois. */
    function annoter(chemin) {
      if (chemin.annote) return;
      chemin.annote = true;
      var nodes = chemin.nodes, n = nodes.length;
      var demiA = chemin.a.demi || 0, demiB = chemin.b.demi || 0;
      // SPEC-ROUTE-007 : un grand axe est plus large — il lui faut un côté
      // (perpendiculaire au tracé) à CHAQUE nœud, pas seulement aux lampadaires
      var large = chemin.role === 'axe';
      for (var i = 0; i < n; i++) {
        var p = nodes[i];
        var dA = Math.hypot(p.x - chemin.a.x, p.z - chemin.a.z), dB = Math.hypot(p.x - chemin.b.x, p.z - chemin.b.z);
        var veutLampe = (dA < demiA + RAYON_LAMPES || dB < demiB + RAYON_LAMPES) && i % PAS_LAMPE === 0;
        if (veutLampe) p.lampe = true;
        if (veutLampe || large) {
          var prev = nodes[i - 1] || nodes[i + 1] || p;
          var tx = p.x - prev.x, tz = p.z - prev.z, len = Math.hypot(tx, tz) || 1;
          if (veutLampe) p.cote = { x: Math.round(-tz / len * 3), z: Math.round(tx / len * 3) };
          // perpendiculaire unitaire (pas d'échelle ×3) : la largeur d'un
          // grand axe se pose bloc à bloc, contiguë à l'axe central — une
          // approximation au cardinal le plus proche suffit (cosmétique)
          if (large) p.perp = { x: tz === 0 ? 0 : (tz > 0 ? -1 : 1), z: tx === 0 ? 0 : (tx > 0 ? 1 : -1) };
        }
        // panneau : le premier point qui sort du rayon de la ville d'origine
        if (!chemin.panneauPose && dA >= demiA + 4) {
          p.panneau = true; p.panneauInfo = { nom: chemin.b.nom, distance: Math.round(chemin.longueur || dA + dB) };
          chemin.panneauPose = true;
        }
        /* SPEC-ZONE-003 : une borne (le même panneau d'information, faute
           d'identifiant de bloc libre) marque chaque endroit où la route
           traverse une frontière de zone — sans zoneEn (monde de test), on
           ne pose jamais rien de plus que les panneaux de ville. */
        if (zoneEn && i > 0) {
          var zPrec = zoneEn(nodes[i - 1].x, nodes[i - 1].z).zone;
          var zIci = zoneEn(p.x, p.z).zone;
          if (zIci !== zPrec) p.borneZone = true;
        }
      }
    }

    /* Pose dans un chunk la part des routes qui le concerne (comme
       `donjons.appliquer` / `habitats.appliquer`) : on part des villes
       proches, on ne calcule le tracé détaillé d'une route que si son
       segment approximatif passe près de ce chunk, et on ne pose que les
       nœuds qui tombent réellement dans ses limites. */
    function appliquer(cx, cz, put) {
      var CX = C.CHUNK_X, CZ = C.CHUNK_Z;
      var x0 = cx * CX, z0 = cz * CZ, x1 = x0 + CX - 1, z1 = z0 + CZ - 1;
      var cxr = x0 + CX / 2, czr = z0 + CZ / 2;
      var n = 0;
      // les deux genres de pôles (ville et mégapole, HABITAT-013) portent
      // chacun leurs connexions — la mégapole est cherchée bien plus loin
      // (sa maille est bien plus large qu'entre deux villes)
      var hubs = lieuxDuGenre('ville', cxr, czr, RAYON_RECHERCHE);
      if (LIEUX && LIEUX.megapole) hubs = hubs.concat(lieuxDuGenre('megapole', cxr, czr, RAYON_RECHERCHE_MEGAPOLE));
      hubs.forEach(function (v) {
        var depart = { x: v.x, z: v.z, id: v.id, nom: v.nom, demi: v.demi, kind: v.kind };
        connexionsDe(v).forEach(function (e) {
          if (distSegment(cxr, czr, v.x, v.z, e.x, e.z) > MARGE_COULOIR + 12) return;
          if (!routeAutorisee(depart, e)) return;
          var chemin = cheminEntre(depart, { x: e.x, z: e.z, id: e.id, nom: e.nom, demi: e.demi || 0, role: e.role });
          annoter(chemin);
          chemin.nodes.forEach(function (pt) {
            if (pt.x < x0 || pt.x > x1 || pt.z < z0 || pt.z > z1) return;
            // on ne pose rien sous les lieux eux-mêmes : la route s'arrête à
            // leur bord, sans recouvrir la plateforme ou les bâtiments
            var dA = Math.hypot(pt.x - chemin.a.x, pt.z - chemin.a.z), dB = Math.hypot(pt.x - chemin.b.x, pt.z - chemin.b.z);
            if (dA <= (chemin.a.demi || 0) + 2 || dB <= (chemin.b.demi || 0) + 2) return;
            poserNoeud(pt, put, pt.cote, chemin.role);
            n++;
          });
        });
      });
      return n;
    }

    return { appliquer: appliquer, connexionsDe: connexionsDe, cheminEntre: cheminEntre, routeAutorisee: routeAutorisee };
  }

  MC.Routes = { creer: creer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
