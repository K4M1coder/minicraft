/* livres.js — SPEC-INTERIEUR-003 : contenu des livres et notes écrits par un
   joueur, et livres « du monde » générés pour les bibliothèques des lieux.
   Logique pure (aucune dépendance DOM/THREE) : le contenu d'un livre est une
   simple donnée portée par la pile d'inventaire qui le tient (`stack.data`,
   voir inventory.js) — ce module ne fait que la façonner et la faire
   respecter (un livre signé devient illisible à l'écriture).

   Nom du module au pluriel (« Livres ») pour ne pas se confondre avec
   MC.Livre (livre.js) : le livre DES RECETTES, un tout autre écran. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var MAX_PAGES = 12, MAX_LONGUEUR_PAGE = 400, MAX_TITRE = 32;

  /* Un livre (ou une note, structurellement identique — juste 1 page et pas
     de titre affiché) vierge : aucune page, pas d'auteur, pas signé. */
  function creerLivre() { return { titre: '', pages: [''], auteur: null, signe: false }; }
  function creerNote() { return { titre: '', pages: [''], auteur: null, signe: false }; }

  function estModifiable(livre) { return !!livre && !livre.signe; }

  /* Chaque « écriture » renvoie un NOUVEL objet (pas de mutation en place) :
     plus facile à tester, et ça évite qu'une référence partagée (le même
     livre posé dans deux inventaires par erreur) ne se modifie des deux
     côtés à la fois. Toutes échouent (renvoient le livre inchangé) une fois
     signé. */
  function definirTitre(livre, titre) {
    if (!estModifiable(livre)) return livre;
    return Object.assign({}, livre, { titre: String(titre || '').slice(0, MAX_TITRE) });
  }
  function definirPage(livre, index, texte) {
    if (!estModifiable(livre)) return livre;
    if (index < 0 || index >= livre.pages.length) return livre;
    var pages = livre.pages.slice();
    pages[index] = String(texte || '').slice(0, MAX_LONGUEUR_PAGE);
    return Object.assign({}, livre, { pages: pages });
  }
  function ajouterPage(livre) {
    if (!estModifiable(livre)) return livre;
    if (livre.pages.length >= MAX_PAGES) return livre;
    return Object.assign({}, livre, { pages: livre.pages.concat(['']) });
  }
  /* Signer : fige le contenu et affiche l'auteur — irréversible (comme un
     vrai livre dédicacé, on n'efface pas une signature). */
  function signer(livre, auteur) {
    if (!estModifiable(livre)) return livre;
    return Object.assign({}, livre, { auteur: String(auteur || 'Anonyme'), signe: true });
  }

  // ─── livres du monde (SPEC-INTERIEUR-003) ──────────────────────────────────
  // hachage déterministe, sans dépendre de MC.Noise : ce module reste
  // autonome (utilisable même si noise.js n'est pas chargé).
  function hash(n) {
    var x = (Math.sin(n) * 43758.5453) % 1;
    return x < 0 ? x + 1 : x;
  }
  function h2(seed, lieu, sel) { return hash(seed * 12.9898 + lieu * 78.233 + sel * 37.719); }
  function choisir(liste, seed, lieu, sel) {
    return liste[Math.floor(h2(seed, lieu, sel) * liste.length) % liste.length];
  }

  var AUTEURS = ["un moine oublié", 'un chroniqueur itinérant', 'une aïeule du lieu',
                 'un scribe anonyme', 'un ancien garde', 'une conteuse locale'];
  var GABARITS = {
    village: [
      "On raconte que {nom} fut bâti par ceux qui fuyaient l'hiver le plus dur qu'on ait connu.",
      "Ici, chaque puits de {nom} porte le nom de la famille qui l'a creusé.",
      "La cloche de {nom} sonne trois fois au crépuscule — personne ne sait plus vraiment pourquoi.",
    ],
    donjon: [
      "Sous {nom}, des marches descendent plus profond que quiconque n'est jamais revenu le dire.",
      "{nom} garde un trésor, dit-on — et bien plus de squelettes que de trésors.",
      "Nul feu ne tient longtemps allumé dans les couloirs de {nom}.",
    ],
    temple: [
      "Les prêtres de {nom} jeûnent trois jours avant chaque pleine lune.",
      "On vient à {nom} pour demander pardon, et on en repart rarement plus léger.",
    ],
    ville: [
      "{nom} n'a jamais connu de siège qu'elle n'ait fini par gagner, à ce qu'on en dit.",
      "Les marchands de {nom} jurent tous par la même pièce, usée jusqu'au métal.",
    ],
    ferme: [
      "La terre autour de {nom} donne deux récoltes là où ailleurs il n'en pousse qu'une.",
      "On dit qu'{nom} n'a jamais manqué de pain, même l'année de la grande sécheresse.",
    ],
    defaut: [
      "Peu de voyageurs s'attardent près de {nom}, et moins encore en parlent au retour.",
      "{nom} a changé de mains plus souvent que quiconque n'a su les compter.",
    ],
  };
  var TITRES = ['Chroniques de {nom}', 'Mémoires de {nom}', 'Ce que l\'on sait de {nom}',
                'Fragments — {nom}', 'Carnet du voyageur : {nom}'];

  /* Fonction pure : un livre « du monde » entièrement déterminé par une
     graine (celle du monde, typiquement) et un lieu ({nom, kind, x, z} —
     le format de habitats.lieuxProches). Même graine, même lieu -> mêmes
     pages, toujours : c'est ce qui permet de le régénérer à la volée pour
     une bibliothèque plutôt que de le stocker. Pas signé (un livre du monde
     n'a pas d'auteur joueur), 2 à 3 pages selon le lieu. */
  function livreDuMonde(seed, lieu) {
    var nom = (lieu && lieu.nom) || 'ce lieu';
    var kind = (lieu && lieu.kind) || 'defaut';
    var lieuHash = (lieu && (lieu.id || (lieu.x || 0) * 131 + (lieu.z || 0) * 977)) || 0;
    var gabarits = GABARITS[kind] || GABARITS.defaut;
    var titre = choisir(TITRES, seed, lieuHash, 1).replace('{nom}', nom);
    var nPages = 2 + Math.floor(h2(seed, lieuHash, 2) * 2);   // 2 ou 3
    var pages = [];
    var dejaChoisis = {};
    for (var i = 0; i < nPages; i++) {
      var texte = choisir(gabarits, seed, lieuHash, 10 + i).replace('{nom}', nom);
      // évite de répéter deux fois le même paragraphe dans un même livre
      var tentative = 0;
      while (dejaChoisis[texte] && tentative < gabarits.length) {
        texte = gabarits[(gabarits.indexOf(texte) + 1) % gabarits.length].replace('{nom}', nom);
        tentative++;
      }
      dejaChoisis[texte] = true;
      pages.push(texte);
    }
    var auteur = choisir(AUTEURS, seed, lieuHash, 3);
    return { titre: titre, pages: pages, auteur: auteur, signe: true };
  }

  MC.Livres = {
    MAX_PAGES: MAX_PAGES, MAX_LONGUEUR_PAGE: MAX_LONGUEUR_PAGE, MAX_TITRE: MAX_TITRE,
    creerLivre: creerLivre, creerNote: creerNote, estModifiable: estModifiable,
    definirTitre: definirTitre, definirPage: definirPage, ajouterPage: ajouterPage,
    signer: signer, livreDuMonde: livreDuMonde,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
