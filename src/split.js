/* split.js — écran partagé : découpage des vues et constitution de l'équipe
   de joueurs locaux. Pur : aucune caméra, aucun DOM. La couche rendu se
   contente de consommer les rectangles produits ici. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var MAX_LOCAUX = 4;

  /* Rectangles de vue, en pixels, dans le repère du conteneur.
     1 joueur : plein cadre · 2 : deux bandes horizontales · 3 et 4 : quadrants.
     Les dimensions impaires sont réparties sans perdre de pixel : la seconde
     moitié reçoit le reste, sinon une colonne de fond reste visible entre les
     vues. */
  function dispositions(n, largeur, hauteur) {
    n = Math.max(1, Math.min(MAX_LOCAUX, n | 0));
    var W = Math.max(1, largeur | 0), H = Math.max(1, hauteur | 0);

    if (n === 1) return [{ x: 0, y: 0, w: W, h: H }];

    if (n === 2) {
      var h1 = Math.floor(H / 2);
      return [
        { x: 0, y: 0, w: W, h: h1 },
        { x: 0, y: h1, w: W, h: H - h1 },
      ];
    }

    // 3 et 4 partagent la grille 2×2 ; à trois, le dernier quadrant reste vide
    var w1 = Math.floor(W / 2), hh1 = Math.floor(H / 2);
    var quad = [
      { x: 0, y: 0, w: w1, h: hh1 },
      { x: w1, y: 0, w: W - w1, h: hh1 },
      { x: 0, y: hh1, w: w1, h: H - hh1 },
      { x: w1, y: hh1, w: W - w1, h: H - hh1 },
    ];
    return quad.slice(0, n);
  }

  /* Positions d'apparition : les joueurs doivent se voir sans se chevaucher.
     On les dispose sur un petit cercle autour du point d'apparition. */
  function positionsDepart(n, centre, rayon) {
    n = Math.max(1, Math.min(MAX_LOCAUX, n | 0));
    var r = rayon === undefined ? 1.6 : rayon;
    if (n === 1) return [{ x: centre.x, y: centre.y, z: centre.z }];
    var out = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      out.push({ x: centre.x + Math.cos(a) * r, y: centre.y, z: centre.z + Math.sin(a) * r });
    }
    return out;
  }

  /* Constitue l'équipe. Le joueur 1 tient le clavier et la souris ; il ne peut
     y en avoir qu'un, faute de pouvoir partager un pointeur. Les suivants
     prennent une manette, dans l'ordre. */
  function creerEquipe(n, world, entities, regles, centre) {
    n = Math.max(1, Math.min(MAX_LOCAUX, n | 0));
    var places = positionsDepart(n, centre);
    var equipe = [];
    for (var i = 0; i < n; i++) {
      var pl = MC.createPlayer(world, entities, regles);
      pl.state.pos.x = places[i].x;
      pl.state.pos.y = places[i].y;
      pl.state.pos.z = places[i].z;
      // chacun regarde vers l'extérieur du cercle : on se voit en se retournant
      pl.state.yaw = n === 1 ? 0 : -((i / n) * Math.PI * 2) + Math.PI / 2;
      equipe.push({
        index: i,
        nom: 'Joueur ' + (i + 1),
        player: pl,
        source: i === 0 ? 'clavier' : 'manette',
        manette: i === 0 ? null : i - 1,
        vue: null,
        mort: false,
      });
    }
    return equipe;
  }

  /* En cauchemar, la mort d'UN SEUL joueur local condamne la partie : c'est ce
     qui donne son poids au mode, et cela évite qu'un joueur se sacrifie pour
     que les autres continuent sur la même carte. */
  function partiePerdue(equipe, regles) {
    if (!regles || !regles.permadeath) return false;
    for (var i = 0; i < equipe.length; i++) {
      if (equipe[i].player.state.dead) return true;
    }
    return false;
  }

  function tousMorts(equipe) {
    for (var i = 0; i < equipe.length; i++) if (!equipe[i].player.state.dead) return false;
    return equipe.length > 0;
  }

  MC.Split = {
    MAX_LOCAUX: MAX_LOCAUX, dispositions: dispositions, positionsDepart: positionsDepart,
    creerEquipe: creerEquipe, partiePerdue: partiePerdue, tousMorts: tousMorts,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
