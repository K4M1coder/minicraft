/* formes.js — L24 : géométrie et état des blocs non cubiques de construction
   fine (SPEC-CONSTR-001 à 004) : escaliers, dalles, clôtures/murets/vitres/
   rambardes. Module pur (aucune dépendance DOM/THREE), au même titre que
   mesher.js et physics.js — c'est lui que ces deux-là appellent pour obtenir
   les boîtes à dessiner et à faire collisionner.

   Principe : un escalier ou une dalle porte tout ce qu'il faut dans son état
   d'un octet (world.getEtat/setEtat, SPEC-SAVE-017) — orientation, inversion,
   forme d'angle — si bien que le mailleur et la physique n'ont JAMAIS besoin
   d'interroger les voisins pour ces deux formes : l'état suffit. Seules les
   clôtures/murets/vitres/rambardes se recalculent en direct depuis les
   voisins (pas d'état stocké), car leur raccord ne dépend que de ce qui est
   plein autour d'elles à l'instant du maillage. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  // ─── orientation commune ────────────────────────────────────────────────────
  // 0=N(-z) 1=E(+x) 2=S(+z) 3=O(-x) — même convention que Core.orientDeRegard
  // et que les portes (core.js `boiteMur`).
  var DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  function opp(o) { return (o + 2) & 3; }
  function ccw(o) { return (o + 3) & 3; }   // « gauche »
  function cw(o) { return (o + 1) & 3; }    // « droite »
  function axeEW(o) { return (o & 1) === 1; }

  function pleine(y0, y1) { return { x0: 0, y0: y0, z0: 0, x1: 1, y1: y1, z1: 1 }; }
  // demi-intervalle du côté vers lequel `dir` pointe (le côté "bas"/vers 0, ou "haut"/vers 1)
  function demi(dir) {
    var neg = dir[0] < 0 || dir[1] < 0;
    var axe = dir[0] ? 'x' : 'z';
    return neg ? { axe: axe, lo: 0, hi: 0.5 } : { axe: axe, lo: 0.5, hi: 1 };
  }
  function demiOppose(dir) {
    var d = demi(dir);
    return d.lo === 0 ? { axe: d.axe, lo: 0.5, hi: 1 } : { axe: d.axe, lo: 0, hi: 0.5 };
  }
  function appliquer(box, d) {
    var b = { x0: box.x0, y0: box.y0, z0: box.z0, x1: box.x1, y1: box.y1, z1: box.z1 };
    if (d.axe === 'x') { b.x0 = d.lo; b.x1 = d.hi; } else { b.z0 = d.lo; b.z1 = d.hi; }
    return b;
  }

  // ─── SPEC-CONSTR-001 : escaliers ────────────────────────────────────────────
  // forme d'angle
  var DROIT = 0, INT_G = 1, INT_D = 2, EXT_G = 3, EXT_D = 4;

  // état (1 octet) : orientation (2 bits) | inversé (1 bit) | forme (3 bits)
  function packEscalier(orientation, inverse, forme) {
    return (orientation & 3) | ((inverse ? 1 : 0) << 2) | ((forme & 7) << 3);
  }
  function unpackEscalier(etat) {
    return { orientation: etat & 3, inverse: !!(etat & 4), forme: (etat >> 3) & 7 };
  }

  /* Orientation à la pose : le côté qui porte le "contremarche" (la face
     pleine hauteur) regarde le joueur, exactement comme le mur d'une porte
     (Core.orientDeRegard) — inversé si le plafond est plein juste au-dessus
     de la case visée. */
  function orientationPose(regard, sousPlafond) {
    return packEscalier(MC.Core.orientDeRegard(regard), !!sousPlafond, DROIT);
  }

  /* Boîtes de collision/maillage d'un escalier : une marche basse pleine
     largeur, une marche haute contre la contremarche. Un angle intérieur
     ajoute un quart de marche côté virage ; un angle extérieur réduit la
     marche haute à ce seul quart. */
  function boitesEscalier(etat) {
    var e = unpackEscalier(etat);
    var riser = DIRS[e.orientation];
    var yBas = e.inverse ? [0.5, 1] : [0, 0.5];
    var yHaut = e.inverse ? [0, 0.5] : [0.5, 1];
    var bas = pleine(yBas[0], yBas[1]);
    var dRiser = demi(riser);
    if (e.forme === DROIT) return [bas, appliquer(pleine(yHaut[0], yHaut[1]), dRiser)];

    var cote = (e.forme === INT_G || e.forme === EXT_G) ? DIRS[ccw(e.orientation)] : DIRS[cw(e.orientation)];
    var dCote = demi(cote);
    if (e.forme === EXT_G || e.forme === EXT_D) {
      var quart = appliquer(appliquer(pleine(yHaut[0], yHaut[1]), dRiser), dCote);
      return [bas, quart];
    }
    var haut = appliquer(pleine(yHaut[0], yHaut[1]), dRiser);
    var extra = appliquer(appliquer(pleine(yHaut[0], yHaut[1]), demiOppose(riser)), dCote);
    return [bas, haut, extra];
  }

  /* Forme d'angle depuis les voisins avant (côté ouvert, où l'on grimpe) et
     arrière (côté contremarche), chacun {orientation, inverse} d'un escalier
     voisin ou null. Un voisin perpendiculaire devant tourne le coin vers
     l'extérieur ; derrière, il le referme vers l'intérieur — l'algorithme
     classique des escaliers de blocs voxel. */
  function formeDepuisVoisins(orientation, inverse, avant, arriere) {
    var facing = opp(orientation);
    function perp(o) { return axeEW(o) !== axeEW(facing); }
    if (avant && avant.inverse === inverse && perp(avant.orientation)) {
      return avant.orientation === ccw(facing) ? EXT_G : EXT_D;
    }
    if (arriere && arriere.inverse === inverse && perp(arriere.orientation)) {
      return arriere.orientation === ccw(facing) ? INT_G : INT_D;
    }
    return DROIT;
  }

  // ─── glue monde : pose/casse (game.js, server.js) ───────────────────────────
  function lireEscalier(world, x, y, z) {
    var id = world.getBlock(x, y, z);
    var d = MC.Core.BLOCKS[id];
    if (!d || d.forme !== 'escalier') return null;
    return unpackEscalier(world.getEtat(x, y, z));
  }
  // recalcule la forme d'UN escalier depuis ses voisins actuels ; renvoie true si elle a changé
  function actualiserEscalier(world, x, y, z) {
    var e = lireEscalier(world, x, y, z);
    if (!e) return false;
    var facing = opp(e.orientation);
    var pa = DIRS[facing], pr = DIRS[e.orientation];
    var avant = lireEscalier(world, x + pa[0], y, z + pa[1]);
    var arriere = lireEscalier(world, x + pr[0], y, z + pr[1]);
    var forme = formeDepuisVoisins(e.orientation, e.inverse, avant, arriere);
    if (forme === e.forme) return false;
    world.setEtat(x, y, z, packEscalier(e.orientation, e.inverse, forme));
    return true;
  }
  /* À appeler après avoir posé ou cassé un escalier en (x,y,z) : lui-même (si
     encore présent) et ses 4 voisins horizontaux peuvent changer de forme. */
  function actualiserZoneEscalier(world, x, y, z) {
    actualiserEscalier(world, x, y, z);
    for (var i = 0; i < 4; i++) actualiserEscalier(world, x + DIRS[i][0], y, z + DIRS[i][1]);
  }

  // ─── SPEC-CONSTR-002 : dalles ───────────────────────────────────────────────
  function packDalle(haut) { return haut ? 1 : 0; }
  function boitesDalle(etat) { return etat ? [pleine(0.5, 1)] : [pleine(0, 0.5)]; }

  /* Décide quoi faire en posant une dalle sur un bloc visé.
     ctx : { memeMateriau (le bloc visé est une dalle du même matériau),
             moitieVisee: 'haut'|'bas' (si le visé est une dalle),
             normaleY: -1|0|1 (composante verticale de la face cliquée),
             fracY: 0..1 (hauteur du point cliqué dans la case visée) }
     Renvoie { action: 'fusion' } (le visé devient le bloc plein) ou
     { action: 'poser', moitie: 'haut'|'bas' } (dans la case adjacente). */
  function decisionDalle(ctx) {
    if (ctx.memeMateriau) {
      // vise-t-on à remplir la moitié HAUTE de la case déjà occupée par
      // cette dalle (face du dessus, ou moitié haute d'une face latérale) ?
      var visantHaut = ctx.normaleY === 1 ? true : (ctx.normaleY === -1 ? false : ctx.fracY > 0.5);
      var libreHaut = ctx.moitieVisee === 'bas';
      if (libreHaut === visantHaut) return { action: 'fusion' };
    }
    var moitie = ctx.normaleY === 1 ? 'bas' : ctx.normaleY === -1 ? 'haut' : (ctx.fracY > 0.5 ? 'haut' : 'bas');
    return { action: 'poser', moitie: moitie };
  }

  // ─── SPEC-CONSTR-004 : clôtures, murets, vitres, rambardes ─────────────────
  var CONNECT_DIMS = {
    cloture:  { poteau: { w: 0.25, y0: 0, y1: 1 }, bras: [{ w: 0.15, y0: 0.375, y1: 0.625 }, { w: 0.15, y0: 0.75, y1: 1 }] },
    muret:    { poteau: { w: 0.5, y0: 0, y1: 1 }, bras: [{ w: 0.5, y0: 0.5, y1: 1 }] },
    vitre:    { poteau: { w: 0.125, y0: 0, y1: 1 }, bras: [{ w: 0.125, y0: 0, y1: 1 }] },
    rambarde: { poteau: { w: 0.15, y0: 0, y1: 0.9 }, bras: [{ w: 0.12, y0: 0.55, y1: 0.75 }] },
  };
  // { n, e, s, o } -> booléen : se raccorde-t-on à ce voisin (plein ou même type) ?
  function connexions(voisins) {
    var c = {};
    ['n', 'e', 's', 'o'].forEach(function (k) {
      var v = voisins[k];
      c[k] = !!(v && (v.plein || v.memeType));
    });
    return c;
  }
  function boiteBras(dir, br) {
    var half = br.w / 2;
    var b = { x0: 0.5 - half, y0: br.y0, z0: 0.5 - half, x1: 0.5 + half, y1: br.y1, z1: 0.5 + half };
    if (dir === 'n') b.z0 = 0;
    else if (dir === 's') b.z1 = 1;
    else if (dir === 'o') b.x0 = 0;
    else if (dir === 'e') b.x1 = 1;
    return b;
  }
  function boitesConnect(type, conn) {
    var d = CONNECT_DIMS[type];
    if (!d) return [];
    var hp = d.poteau.w / 2;
    var boxes = [{ x0: 0.5 - hp, y0: d.poteau.y0, z0: 0.5 - hp, x1: 0.5 + hp, y1: d.poteau.y1, z1: 0.5 + hp }];
    ['n', 'e', 's', 'o'].forEach(function (dir) {
      if (!conn[dir]) return;
      d.bras.forEach(function (br) { boxes.push(boiteBras(dir, br)); });
    });
    return boxes;
  }

  // ─── dispatch générique (appelé par core.boiteDe et par mesher.js) ─────────
  /* Boîtes d'un bloc de forme : `def` = la définition du bloc (BLOCKS[id]),
     `etat` = son octet d'état, `voisinFn(dx, dz)` = accesseur optionnel
     renvoyant {plein, memeType} du voisin en (dx,dz) — seuls les types
     "raccordables" (clôture, muret, vitre, rambarde) s'en servent. */
  function boitesBloc(def, etat, voisinFn) {
    if (!def) return [];
    if (def.forme === 'escalier') return boitesEscalier(etat || 0);
    if (def.forme === 'dalle') return boitesDalle(etat || 0);
    if (!voisinFn) return [];
    var voisins = { n: voisinFn(0, -1), e: voisinFn(1, 0), s: voisinFn(0, 1), o: voisinFn(-1, 0) };
    return boitesConnect(def.forme, connexions(voisins));
  }

  MC.Formes = {
    DROIT: DROIT, INT_G: INT_G, INT_D: INT_D, EXT_G: EXT_G, EXT_D: EXT_D,
    packEscalier: packEscalier, unpackEscalier: unpackEscalier,
    orientationPose: orientationPose, boitesEscalier: boitesEscalier,
    formeDepuisVoisins: formeDepuisVoisins,
    lireEscalier: lireEscalier, actualiserEscalier: actualiserEscalier,
    actualiserZoneEscalier: actualiserZoneEscalier,
    packDalle: packDalle, boitesDalle: boitesDalle, decisionDalle: decisionDalle,
    connexions: connexions, boitesConnect: boitesConnect, boitesBloc: boitesBloc,
    CONNECT_DIMS: CONNECT_DIMS,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
