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

  /* Bornes d'un livre écrit (SPEC-INTERIEUR-003). Un livre voyage dans le
     `data` d'une pile, que les contrats bornent à 2000 caractères JSON
     (MC.ContratsV2.BORNES.DATA_MAX) : au-delà, la pile serait refusée par
     INV_MAJ et le texte perdu. Les bornes par champ (8 pages de 220
     caractères) tiennent dans TAILLE_JSON_MAX ; `borner` rogne en plus la fin
     du texte quand les échappements JSON (guillemets, sauts de ligne) font
     déborder malgré tout. Une note n'a qu'une page. */
  var MAX_PAGES = 8, MAX_LONGUEUR_PAGE = 220, MAX_TITRE = 32, MAX_AUTEUR = 40, TAILLE_JSON_MAX = 1900;

  /* Un livre (ou une note, structurellement identique — juste 1 page et pas
     de titre affiché) vierge : aucune page, pas d'auteur, pas signé. */
  function creerLivre() { return { titre: '', pages: [''], auteur: null, signe: false }; }
  function creerNote() { return { titre: '', pages: [''], auteur: null, signe: false }; }

  function estModifiable(livre) { return !!livre && !livre.signe; }

  /* Caractères de contrôle retirés (mêmes règles que le contrat réseau,
     MC.ContratsArchi.nettoyerTexteLivre, repris ici pour que ce module reste
     autonome) : un titre ou un auteur tient sur une ligne. */
  function nettoyer(v, multiligne) {
    var s = String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
    s = s.replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
    if (!multiligne) s = s.replace(/\n/g, ' ');
    return s;
  }
  /* La forme sûre d'un livre, quelle qu'en soit l'origine (client, fichier
     de sauvegarde, message) : champs nettoyés et bornés, taille JSON sous
     TAILLE_JSON_MAX. `note` : une seule page. */
  function borner(livre, note) {
    var l = livre && typeof livre === 'object' ? livre : {};
    var pages = Array.isArray(l.pages) ? l.pages.slice(0, note ? 1 : MAX_PAGES) : [''];
    pages = pages.map(function (p) { return nettoyer(p, true).slice(0, MAX_LONGUEUR_PAGE); });
    if (!pages.length) pages = [''];
    var out = { titre: nettoyer(l.titre, false).slice(0, MAX_TITRE), pages: pages,
                auteur: l.auteur ? nettoyer(l.auteur, false).slice(0, MAX_AUTEUR) : null, signe: !!l.signe };
    while (JSON.stringify(out).length > TAILLE_JSON_MAX) {
      var dern = out.pages.length - 1;
      if (out.pages[dern].length) out.pages[dern] = out.pages[dern].slice(0, Math.max(0, out.pages[dern].length - 16));
      else if (dern > 0) out.pages.pop();
      else break;
    }
    return out;
  }
  /* SPEC-INTERIEUR-003 : une écriture complète (titre et pages proposés),
     appliquée seulement à un livre encore modifiable — le serveur s'en sert
     sur sa propre pile (MC.Conteneurs, opération « ecrire »), le client pour
     sa prédiction. Renvoie le livre inchangé s'il est signé. */
  function ecrire(livre, contenu, note) {
    var base = livre || (note ? creerNote() : creerLivre());
    if (!estModifiable(base)) return base;
    return borner({ titre: contenu && contenu.titre, pages: contenu && contenu.pages, auteur: null, signe: false }, note);
  }

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
    var nom = nettoyer(auteur || 'Anonyme', false).slice(0, MAX_AUTEUR) || 'Anonyme';
    return Object.assign({}, livre, { auteur: nom, signe: true });
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
    // l'identifiant d'un lieu est un texte (« village:3,4 ») : on en tire un nombre stable
    var brut = lieu && (lieu.id !== undefined ? lieu.id : (lieu.x || 0) * 131 + (lieu.z || 0) * 977);
    var lieuHash = 0;
    if (typeof brut === 'number') lieuHash = brut;
    else if (brut) for (var c = 0; c < String(brut).length; c++) lieuHash = (lieuHash * 31 + String(brut).charCodeAt(c)) % 1000003;
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

  // x vers l'est, z vers le sud (même convention que habitats.js `cap`)
  var CAPS = ['à l\'est', 'au sud-est', 'au sud', 'au sud-ouest', 'à l\'ouest', 'au nord-ouest', 'au nord', 'au nord-est'];
  function cap(dx, dz) { var k = Math.round(Math.atan2(dz, dx) / (Math.PI / 4)); return CAPS[((k % 8) + 8) % 8]; }
  function distanceArrondie(d) { return d < 100 ? Math.max(10, Math.round(d / 10) * 10) : Math.round(d / 50) * 50; }

  /* SPEC-INTERIEUR-003 : les indices des quêtes. Un carnet d'explorateur
     qui situe, depuis le lieu, les donjons des environs (ceux que le mode
     histoire et les récits désignent comme buts) : leur nom, leur distance
     et leur direction, le gardien qui les tient. `indices` : [{ nom, x, z,
     gardien? }], fournis par l'appelant (le serveur, depuis monde.donjons),
     du plus proche au plus lointain — fonction pure, déterministe. */
  var OUVERTURES_INDICES = [
    'Ce que j\'ai vu de mes yeux, ou appris de ceux qui en sont revenus.',
    'Pour qui cherche l\'aventure : les lieux dont on ne parle qu\'à voix basse.',
    'Mes routes, mes frayeurs, et ce qu\'il reste à trouver autour de {nom}.',
  ];
  function livreIndices(seed, lieu, indices) {
    var nom = (lieu && lieu.nom) || 'ce lieu', lx = (lieu && lieu.x) || 0, lz = (lieu && lieu.z) || 0;
    var cle = 0, brut = String(lieu && lieu.id !== undefined ? lieu.id : nom);
    for (var c = 0; c < brut.length; c++) cle = (cle * 31 + brut.charCodeAt(c)) % 1000003;
    var pages = [choisir(OUVERTURES_INDICES, seed, cle, 21).replace('{nom}', nom)];
    (indices || []).slice(0, MAX_PAGES - 1).forEach(function (d) {
      var dist = distanceArrondie(Math.hypot(d.x - lx, d.z - lz));
      pages.push(String(d.nom || 'Un lieu oublié') + ' : à quelque ' + dist + ' blocs ' + cap(d.x - lx, d.z - lz) + ' de ' + nom + '.' +
                 (d.gardien ? ' On y redoute un gardien : ' + d.gardien + ', qui veille sur un trésor.' :' Nul n\'en est revenu pour dire qui le garde.') +
                 (d.vaincu ? ' Son gardien a été vaincu, dit-on.' : ''));
    });
    if (pages.length === 1) pages.push('Je n\'ai trouvé aucun donjon à des lieues à la ronde : le pays est sûr, ou bien il cache mieux ses secrets.');
    return borner({ titre: ('Carnet d\'explorateur — ' + nom).slice(0, MAX_TITRE), pages: pages,
                    auteur: choisir(AUTEURS, seed, cle, 23), signe: true });
  }

  /* SPEC-INTERIEUR-003 : l'histoire du monde vue d'un lieu — sa fondation et
     ses liens avec les lieux voisins (`voisins` : [{ nom, kind, x, z }],
     comme lieuxProches), à partir de la graine du monde. Pure, déterministe. */
  var EPOQUES = ['Au temps des premières moissons', 'Avant la grande nuit', 'Trois générations avant nous',
                 'L\'année où la rivière changea de lit', 'Quand les loups descendaient encore des montagnes'];
  var LIENS = [
    '{voisin} et {nom} commerçaient déjà : le sel montait, la laine descendait.',
    'Une querelle de bornage brouilla longtemps {nom} et {voisin} ; un mariage la régla.',
    'Les fondateurs de {voisin} étaient, dit-on, des cadets de {nom} partis chercher de meilleures terres.',
    'Quand la disette frappa {voisin}, {nom} ouvrit ses greniers ; on s\'en souvient encore là-bas.',
  ];
  function livreChronique(seed, lieu, voisins) {
    var nom = (lieu && lieu.nom) || 'ce lieu', lx = (lieu && lieu.x) || 0, lz = (lieu && lieu.z) || 0;
    var cle = 0, brut = String(lieu && lieu.id !== undefined ? lieu.id : nom);
    for (var c = 0; c < brut.length; c++) cle = (cle * 31 + brut.charCodeAt(c)) % 1000003;
    var pages = [choisir(EPOQUES, seed, cle, 31) + ', des gens vinrent s\'établir ici et nommèrent l\'endroit ' + nom + '.'];
    (voisins || []).filter(function (v) { return v && v.nom && v.nom !== nom; }).slice(0, 3).forEach(function (v, i) {
      pages.push(choisir(LIENS, seed, cle, 40 + i).replace('{voisin}', v.nom).replace('{nom}', nom) +
                 ' (' + v.nom + ' se trouve ' + cap(v.x - lx, v.z - lz) + ', à ' + distanceArrondie(Math.hypot(v.x - lx, v.z - lz)) + ' blocs.)');
    });
    if (pages.length === 1) pages.push('Longtemps isolé, ' + nom + ' n\'a d\'autre histoire que celle de ses saisons.');
    return borner({ titre: ('Histoire de ' + nom).slice(0, MAX_TITRE), pages: pages, auteur: choisir(AUTEURS, seed, cle, 33), signe: true });
  }

  MC.Livres = {
    MAX_PAGES: MAX_PAGES, MAX_LONGUEUR_PAGE: MAX_LONGUEUR_PAGE, MAX_TITRE: MAX_TITRE, MAX_AUTEUR: MAX_AUTEUR,
    TAILLE_JSON_MAX: TAILLE_JSON_MAX,
    creerLivre: creerLivre, creerNote: creerNote, estModifiable: estModifiable,
    definirTitre: definirTitre, definirPage: definirPage, ajouterPage: ajouterPage,
    signer: signer, livreDuMonde: livreDuMonde,
    // SPEC-INTERIEUR-003 : écriture validée (serveur et prédiction), livres des bibliothèques
    nettoyer: nettoyer, borner: borner, ecrire: ecrire, livreIndices: livreIndices, livreChronique: livreChronique,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
