/* histoire.js — le mode histoire : une aventure guidée plutôt qu'un bac à sable.
   Logique pure. Le jeu SIGNALE ce qui se passe (on parle à quelqu'un, on
   entre quelque part, on ramasse, on tue, la nuit passe…) ; le moteur fait
   avancer la quête principale, les quêtes secondaires et les événements, et
   renvoie ce qu'il faut annoncer, donner ou faire apparaître. À la fin, les
   objectifs atteints et les choix faits décident de l'épilogue.

   L'histoire se LIE au monde de la partie : le village de départ, la ville,
   l'ermite et les donjons sont des lieux réels, trouvés autour du point de
   départ. Une étape dont le lieu n'existe pas, ou qui demande une interaction
   que les paramètres interdisent, est sautée plutôt que de bloquer le récit. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var B = C.B, I = C.I;

  // familles d'objets utiles aux objectifs
  var BOIS = [B.LOG, B.BIRCH_LOG, B.SPRUCE_LOG, B.JUNGLE_LOG, B.ACACIA_LOG];
  var FLEURS = [B.FLOWER_RED, B.FLOWER_YELLOW];
  var HOSTILES = ['zombie', 'skeleton', 'spider', 'mummy', 'slime', 'pillager', 'vindicator', 'drowned'];
  var FROIDS = ['taiga', 'pics_glaces', 'glacier', 'ocean_gele'];

  var LONGUEURS = {
    courte:  { nom: 'Courte', chapitres: ['reveil', 'route', 'printemps', 'roi'], secondaires: 3 },
    normale: { nom: 'Normale', chapitres: ['reveil', 'route', 'printemps', 'nuit', 'hiver', 'traitre', 'roi'], secondaires: 5 },
    longue:  { nom: 'Longue', chapitres: ['reveil', 'route', 'printemps', 'nuit', 'marche', 'hiver', 'traitre', 'roi'], secondaires: 8 },
  };

  /* ─── La Couronne des Saisons ────────────────────────────────────────────
     Objectifs :
       parler    { role, lieu }          lieu : 'depart' | 'ville' | 'ermite' | null (n'importe où)
       aller     { cible, rayon }        cible : un lien (lieu ou donjon)
       biome     { biomes }
       collecter { ids, n, requiert }    ce qu'on détient (acheté, trouvé ou récolté)
       livrer    { ids, n, role }        on remet les objets à un habitant
       vaincre   { cible }               le gardien d'un donjon lié
       tuer      { types, n }
       survivre  { nuits }
       explorer  { n }                   lieux distincts visités
       choix     { id, options }
     `requiert` : catégorie d'interaction nécessaire ; interdite, l'étape saute. */
  var CHAPITRES = {
    reveil: {
      titre: 'Le réveil du village',
      intro: 'Cette nuit, le ciel a hurlé. Au matin, les saisons se sont mêlées : neige sur les blés, orages sans nuages. ' +
             'Au village, on dit que les quatre Gemmes des Saisons ont été volées dans le sanctuaire.',
      etapes: [
        { type: 'parler', role: 'guide', lieu: 'depart', texte: 'Parlez au guide du village.',
          dialogue: 'Te voilà enfin, {heros} ! Les Gemmes des Saisons ont disparu du sanctuaire. Sans elles, le temps devient fou. ' +
                    'On a vu une silhouette sans visage fuir vers les terres sauvages. Il nous faut quelqu\'un de courageux.' },
        { type: 'collecter', ids: BOIS, n: 6, requiert: 'bois', texte: 'Rassemblez six rondins de bois pour barricader le village.' },
        { type: 'parler', role: 'aubergiste', lieu: 'depart', texte: 'Écoutez les rumeurs au salon du village.',
          dialogue: 'Des voyageurs parlent d\'une grande ville où un banquier garde une carte très ancienne… ' +
                    'Et d\'un gardien qui veille sur une gemme verte dans une ruine non loin d\'ici.' },
      ],
    },
    route: {
      titre: 'La route de la ville',
      intro: 'La ville la plus proche garde peut-être la mémoire des Gemmes.',
      etapes: [
        { type: 'aller', cible: 'ville', rayon: 30, texte: 'Rejoignez {ville}.' },
        { type: 'parler', role: 'banquier', lieu: 'ville', texte: 'Trouvez le banquier de {ville}.',
          dialogue: 'Une carte des sanctuaires ? Elle dort dans mes coffres depuis des générations. Je peux vous la confier… ' +
                    'contre une part de ce que vous trouverez. Ou vous pouvez chercher seul.' },
        { type: 'choix', id: 'banquier', texte: 'Acceptez-vous l\'aide du banquier ?',
          options: [{ id: 'accepter', texte: 'Accepter son marché' }, { id: 'refuser', texte: 'Refuser poliment' }] },
      ],
    },
    printemps: {
      titre: 'La Gemme du Printemps',
      intro: 'Un gardien corrompu veille sur la première gemme, dans {donjon1}.',
      etapes: [
        { type: 'aller', cible: 'donjon1', rayon: 20, texte: 'Trouvez {donjon1}.' },
        { type: 'vaincre', cible: 'donjon1', texte: 'Vainquez le gardien de {donjon1}.' },
        { type: 'parler', role: 'guide', lieu: 'depart', texte: 'Rapportez la Gemme du Printemps au guide du village.',
          dialogue: 'La Gemme du Printemps ! Regarde, les fleurs se redressent déjà. Mais trois gemmes manquent encore…',
          recompense: [{ id: I.EMERALD, n: 4 }] },
      ],
    },
    nuit: {
      titre: 'La Nuit de sang',
      intro: 'La lune a rougi. Cette nuit, les morts sortent en nombre : il faut tenir jusqu\'à l\'aube.',
      evenement: 'nuit_de_sang',
      etapes: [
        { type: 'survivre', nuits: 1, texte: 'Survivez à la Nuit de sang.' },
        { type: 'tuer', types: HOSTILES, n: 8, texte: 'Repoussez huit créatures de la nuit.' },
      ],
    },
    marche: {
      titre: 'Les voix du marché',
      intro: 'Au marché, on murmure le nom de celui qui a vendu les plans du sanctuaire.',
      etapes: [
        { type: 'parler', role: 'marchand_ambulant', lieu: 'ville', texte: 'Interrogez les marchands du marché de {ville}.',
          dialogue: 'Un homme au capuchon a payé en or ancien… des pièces frappées au sceau du sanctuaire. Suivez l\'argent.' },
        { type: 'collecter', ids: [I.EMERALD], n: 5, texte: 'Réunissez cinq émeraudes pour acheter des renseignements.' },
        { type: 'livrer', ids: [I.EMERALD], n: 5, role: 'marchand_ambulant', texte: 'Payez le marchand pour ses renseignements.',
          dialogue: 'Marché conclu. Celui que vous cherchez a été vu près d\'une maison isolée, chez un vieil ermite.' },
      ],
    },
    hiver: {
      titre: 'La Gemme de l\'Hiver',
      intro: 'La deuxième gemme a été emportée là où le froid mord.',
      etapes: [
        { type: 'biome', biomes: FROIDS, texte: 'Gagnez les terres glacées.' },
        { type: 'aller', cible: 'donjon2', rayon: 20, texte: 'Trouvez {donjon2}.' },
        { type: 'vaincre', cible: 'donjon2', texte: 'Vainquez le gardien de {donjon2}.' },
      ],
    },
    traitre: {
      titre: 'Le traître',
      intro: 'Quelqu\'un a ouvert le sanctuaire de l\'intérieur.',
      evenement: 'pillards',
      etapes: [
        { type: 'parler', role: 'ermite', lieu: 'ermite', texte: 'Rendez visite à l\'ermite de {ermite}.',
          dialogue: 'Le traître ? {traitre}. Il a vendu les Gemmes au Roi Sans Visage en échange d\'une place à sa cour. ' +
                    'Et ses pillards marchent en ce moment même sur ton village.' },
        { type: 'choix', id: 'traitre', texte: 'Que ferez-vous du traître ?',
          options: [{ id: 'epargner', texte: 'L\'épargner et le livrer à la justice' }, { id: 'bannir', texte: 'Le bannir à jamais' }] },
        { type: 'tuer', types: ['pillager', 'vindicator'], n: 5, delai: 300, drapeau: 'village_sauve',
          texte: 'Défendez le village : repoussez cinq pillards.' },
      ],
    },
    roi: {
      titre: 'Le Roi Sans Visage',
      intro: 'Toutes les pistes mènent à {donjon3}, où le Roi Sans Visage garde les dernières Gemmes.',
      etapes: [
        { type: 'aller', cible: 'donjon3', rayon: 20, texte: 'Atteignez {donjon3}.' },
        { type: 'vaincre', cible: 'donjon3', texte: 'Affrontez le Roi Sans Visage.' },
        { type: 'choix', id: 'couronne', texte: 'Les Gemmes réunies forment une couronne. Qu\'en faites-vous ?',
          options: [{ id: 'rendre', texte: 'Rendre les Gemmes aux saisons' },
                    { id: 'porter', texte: 'Porter la Couronne des Saisons' },
                    { id: 'briser', texte: 'Briser la Couronne' }] },
      ],
    },
  };

  /* Quêtes secondaires : proposées par un habitant de ce métier, dans
     n'importe quel village ou ville. */
  var SECONDAIRES = {
    recolte:   { role: 'fermier', titre: 'La récolte perdue', ids: [I.WHEAT], n: 12, requiert: 'vegetal',
                 texte: 'Rapportez douze bottes de blé au fermier.', recompense: [{ id: I.EMERALD, n: 3 }] },
    fer:       { role: 'forgeron', titre: 'Le fer du forgeron', ids: [I.IRON_INGOT], n: 5,
                 texte: 'Rapportez cinq lingots de fer au forgeron.', recompense: [{ id: I.IRON_SWORD, n: 1 }] },
    fils:      { role: 'tisserand', titre: 'Fils de couleur', ids: [B.WOOL], n: 8,
                 texte: 'Rapportez huit laines au tisserand.', recompense: [{ id: I.EMERALD, n: 3 }] },
    soupe:     { role: 'aubergiste', titre: 'Un poisson pour la soupe', ids: [I.RAW_FISH], n: 4,
                 texte: 'Rapportez quatre poissons à l\'aubergiste.', recompense: [{ id: I.MUSHROOM_STEW, n: 3 }] },
    bouquet:   { role: 'animateur', titre: 'Le bouquet de la fête', ids: FLEURS, n: 6, requiert: 'vegetal',
                 texte: 'Cueillez six fleurs pour la fête.', recompense: [{ id: I.GOLDEN_APPLE, n: 1 }] },
    carto:     { role: 'guide', titre: 'Le cartographe', explorer: 3,
                 texte: 'Visitez trois lieux habités différents.', recompense: [{ id: I.CARTE, n: 1 }, { id: I.EMERALD, n: 2 }] },
    os:        { role: 'ermite', titre: 'Les os anciens', ids: [I.BONE], n: 8,
                 texte: 'Rapportez huit os à l\'ermite.', recompense: [{ id: I.GOLD_INGOT, n: 3 }] },
    lingot:    { role: 'banquier', titre: 'Le lingot manquant', ids: [I.GOLD_INGOT], n: 3,
                 texte: 'Rapportez trois lingots d\'or au banquier.', recompense: [{ id: I.DIAMOND, n: 2 }] },
  };
  var ORDRE_SECONDAIRES = ['recolte', 'fer', 'soupe', 'fils', 'bouquet', 'carto', 'os', 'lingot'];

  /* Événements : le jeu les exécute (apparitions) et le récit les raconte. */
  var EVENEMENTS = {
    nuit_de_sang: { titre: 'La Nuit de sang', texte: 'La lune rougit. Des créatures surgissent de toutes parts !',
                    apparitions: [{ type: 'zombie', n: 5 }, { type: 'skeleton', n: 3 }], pres: 'joueur', nuit: true },
    pillards:     { titre: 'Les pillards', texte: 'Des pillards marchent sur votre village de départ !',
                    apparitions: [{ type: 'pillager', n: 3 }, { type: 'vindicator', n: 2 }], pres: 'depart' },
    caravane:     { titre: 'Une caravane', texte: 'Une caravane marchande fait halte près de vous.',
                    apparitions: [{ type: 'villager', n: 1, role: 'marchand' }], pres: 'joueur', apresChapitre: 1 },
    orage:        { titre: 'L\'orage prophétique', texte: 'La foudre dessine dans le ciel le sceau du sanctuaire : les Gemmes vous appellent.',
                    siMeteo: ['orage', 'tempete'], apresChapitre: 2 },
    voyageur:     { titre: 'Un voyageur', texte: 'Un vieil homme vous glisse : « Les gardiens craignent la lumière des torches. »',
                    apresChapitre: 3, recompense: [{ id: B.TORCH, n: 16 }] },
  };

  /* Fins : la première dont la condition tient l'emporte. */
  var FINS = [
    { id: 'tragique', titre: 'La légende oubliée',
      texte: '{heros} est tombé avant la fin. Les saisons restent folles, et l\'on chante parfois, au coin du feu, le nom d\'un héros qui a failli.',
      si: function (e) { return e.mort; } },
    { id: 'secrete', titre: 'Le Gardien des Quatre Vents',
      texte: 'Toutes les quêtes accomplies, le traître épargné, les Gemmes rendues : les saisons elles-mêmes choisissent {heros} pour gardien. ' +
             'Le printemps revient, et avec lui une paix que personne n\'avait connue.',
      si: function (e) {
        return e.drapeaux.couronne === 'rendre' && e.drapeaux.traitre === 'epargner' && e.drapeaux.village_sauve !== false &&
               e.secondairesFaites >= e.secondairesPrevues && e.secondairesPrevues >= 5;
      } },
    { id: 'aube', titre: 'L\'Aube des Saisons',
      texte: 'Les Gemmes regagnent le sanctuaire. Le village fête {heros}, les champs reverdissent, et la neige ne tombe plus qu\'en hiver.',
      si: function (e) { return e.drapeaux.couronne === 'rendre' && e.drapeaux.village_sauve !== false && e.secondairesFaites >= Math.min(3, e.secondairesPrevues); } },
    { id: 'cendres', titre: 'Les cendres du village',
      texte: 'Les saisons sont rendues, mais le village de départ n\'est plus que cendres. {heros} a sauvé le monde, pas les siens.',
      si: function (e) { return e.drapeaux.couronne === 'rendre'; } },
    { id: 'souverain', titre: 'Le Souverain des Saisons',
      texte: '{heros} coiffe la Couronne. Les saisons obéissent désormais à une seule volonté… Le peuple se tait, et se demande s\'il a gagné un roi ou perdu un héros.',
      si: function (e) { return e.drapeaux.couronne === 'porter'; } },
    { id: 'brise', titre: 'Le monde brisé',
      texte: 'La Couronne vole en éclats. Plus personne ne régnera sur les saisons — elles resteront libres, et imprévisibles, à jamais.',
      si: function () { return true; } },
  ];

  function remplir(txt, e) {
    return String(txt || '').replace(/\{(\w+)\}/g, function (m, k) {
      if (k === 'heros') return e.params.heros;
      if (k === 'traitre') return e.drapeaux.banquier === 'accepter' ? 'Le banquier qui vous a tendu la main' : 'Le guide de votre propre village';
      var l = e.liens[k];
      return l ? l.nom : 'un lieu oublié';
    });
  }

  /* Lie l'histoire au monde : lieux et donjons réels autour du départ. */
  function lier(monde, x, z) {
    var liens = {};
    var H = monde.habitats;
    if (H) {
      var proches = H.lieuxProches(x, z, 2500);
      var village = proches.filter(function (l) { return l.kind === 'village'; })[0] ||
                    proches.filter(function (l) { return l.kind === 'ville'; })[0];
      if (village) liens.depart = { id: village.id, nom: village.nom, x: village.x, z: village.z, h: village.h0, kind: 'lieu' };
      var ville = proches.filter(function (l) { return l.kind === 'ville' && (!village || l.id !== village.id); })[0];
      if (ville) liens.ville = { id: ville.id, nom: ville.nom, x: ville.x, z: ville.z, h: ville.h0, kind: 'lieu' };
      var ermite = proches.filter(function (l) { return l.kind === 'maison'; })[0];
      if (ermite) liens.ermite = { id: ermite.id, nom: ermite.nom, x: ermite.x, z: ermite.z, h: ermite.h0, kind: 'lieu' };
    }
    if (monde.donjons) {
      var R = 1600;
      var ds = monde.donjons.dansZone(x - R, z - R, x + R, z + R)
        // un donjon sous la mer ne se prête pas à la quête : on les écarte
        .filter(function (d) { return !(MC.Donjons && MC.Donjons.TYPES[d.type] && MC.Donjons.TYPES[d.type].marin); })
        .map(function (d) { return { d: d, dist: Math.hypot(d.x - x, d.z - z) }; })
        .sort(function (a, b) { return a.dist - b.dist; });
      function lienDe(d) { return { id: d.id, nom: d.nom, x: d.x, z: d.z, h: d.surface, kind: 'donjon', type: d.type }; }
      var pris = [];
      if (ds[0]) { liens.donjon1 = lienDe(ds[0].d); pris.push(ds[0].d.id); }
      var froid = ds.filter(function (o) { return o.d.type === 'forteresse_glace' && pris.indexOf(o.d.id) < 0; })[0] ||
                  ds.filter(function (o) { return pris.indexOf(o.d.id) < 0; })[0];
      if (froid) { liens.donjon2 = lienDe(froid.d); pris.push(froid.d.id); }
      var dernier = ds.filter(function (o) { return pris.indexOf(o.d.id) < 0; }).slice(-1)[0];
      if (dernier) liens.donjon3 = lienDe(dernier.d);
    }
    return liens;
  }

  /* Paramètres ajustables de l'histoire. */
  function parametres(p) {
    p = p || {};
    return {
      heros: String(p.heros || 'Aube').slice(0, 20),
      longueur: LONGUEURS[p.longueur] ? p.longueur : 'normale',
      evenements: p.evenements !== false,
      secondaires: p.secondaires === undefined ? LONGUEURS[LONGUEURS[p.longueur] ? p.longueur : 'normale'].secondaires
                                               : Math.max(0, Math.min(8, p.secondaires | 0)),
      commerce: p.commerce !== false,
      reperes: p.reperes !== false,
    };
  }

  /* peut(categorie) : l'interaction est-elle permise ? (voir MC.Modes). */
  function creer(params, liens, peut) {
    var P = parametres(params);
    var e = {
      params: P, liens: liens || {}, chapitres: LONGUEURS[P.longueur].chapitres.slice(),
      chap: 0, etape: 0, progres: 0, debutEtape: null, drapeaux: {}, journal: [],
      secondaires: {}, secondairesPrevues: P.secondaires, secondairesFaites: 0,
      evenements: {}, lieuxVus: [], nuits: 0, nuitEnCours: false, mort: false, fin: null,
      commence: false,
    };
    e.peut = peut || function () { return true; };
    return e;
  }

  function chapitreCourant(e) { return CHAPITRES[e.chapitres[e.chap]] || null; }
  function etapeCourante(e) {
    var ch = chapitreCourant(e);
    return ch ? ch.etapes[e.etape] || null : null;
  }
  // une étape jouable : son lieu existe, son interaction est permise
  function jouable(e, et) {
    if (!et) return false;
    if (et.requiert && !e.peut(et.requiert)) return false;
    if ((et.type === 'aller' || et.type === 'vaincre') && !e.liens[et.cible]) return false;
    if (et.type === 'parler' && et.lieu && !e.liens[et.lieu]) return false;
    return true;
  }

  /* Démarre le récit : l'introduction du premier chapitre. */
  function commencer(e) {
    if (e.commence) return [];
    e.commence = true;
    var n = [{ type: 'chapitre', titre: chapitreCourant(e).titre, texte: remplir(chapitreCourant(e).intro, e) }];
    return n.concat(avancerSiSaute(e));
  }

  function noter(e, texte) { e.journal.push(texte); if (e.journal.length > 60) e.journal.shift(); }

  // passe les étapes injouables, entre dans les chapitres suivants
  function avancerSiSaute(e) {
    var n = [];
    var garde = 0;
    while (!e.fin && garde++ < 64) {
      var ch = chapitreCourant(e);
      if (!ch) { n = n.concat(terminer(e)); break; }
      var et = ch.etapes[e.etape];
      if (!et) {
        // chapitre fini : le suivant
        noter(e, 'Chapitre terminé : ' + ch.titre);
        e.chap++; e.etape = 0; e.progres = 0; e.debutEtape = null;
        var nch = chapitreCourant(e);
        if (!nch) { n = n.concat(terminer(e)); break; }
        n.push({ type: 'chapitre', titre: nch.titre, texte: remplir(nch.intro, e) });
        if (nch.evenement && e.params.evenements) n = n.concat(declencher(e, nch.evenement));
        continue;
      }
      if (!jouable(e, et)) { e.etape++; e.progres = 0; continue; }
      break;
    }
    return n;
  }

  function finirEtape(e) {
    var et = etapeCourante(e), n = [];
    noter(e, remplir(et.texte, e));
    if (et.recompense) n.push({ type: 'recompense', objets: et.recompense });
    if (et.drapeau) e.drapeaux[et.drapeau] = true;
    e.etape++; e.progres = 0; e.debutEtape = null;
    n.push({ type: 'etape', texte: 'Objectif accompli : ' + remplir(et.texte, e) });
    return n.concat(avancerSiSaute(e));
  }

  function declencher(e, id) {
    if (e.evenements[id]) return [];
    var ev = EVENEMENTS[id];
    if (!ev) return [];
    e.evenements[id] = true;
    noter(e, 'Événement : ' + ev.titre);
    var n = [{ type: 'evenement', id: id, titre: ev.titre, texte: remplir(ev.texte, e), apparitions: ev.apparitions || [],
               pres: ev.pres === 'depart' && e.liens.depart ? e.liens.depart : 'joueur' }];
    if (ev.recompense) n.push({ type: 'recompense', objets: ev.recompense });
    return n;
  }

  function terminer(e) {
    if (e.fin) return [];
    var ctx = { drapeaux: e.drapeaux, secondairesFaites: e.secondairesFaites, secondairesPrevues: e.secondairesPrevues, mort: e.mort };
    for (var i = 0; i < FINS.length; i++) {
      if (FINS[i].si(ctx)) { e.fin = FINS[i].id; break; }
    }
    var f = finDe(e.fin);
    noter(e, 'Fin : ' + f.titre);
    return [{ type: 'fin', id: f.id, titre: f.titre, texte: remplir(f.texte, e) }];
  }
  function finDe(id) { for (var i = 0; i < FINS.length; i++) if (FINS[i].id === id) return FINS[i]; return FINS[FINS.length - 1]; }

  function compte(ctx, ids) {
    var n = 0;
    if (!ctx || !ctx.compter) return 0;
    ids.forEach(function (id) { n += ctx.compter(id); });
    return n;
  }

  /* Le jeu signale un événement. ev.type :
       parler { role, lieu }   position { x, z }   biome { id }   lieu { id }
       inventaire { compter(id) }   boss { donjon }   tuer { mob }
       temps { t, nuit }   mort
     Renvoie la liste des notifications. */
  function signaler(e, ev, ctx) {
    if (e.fin || !e.commence) return [];
    var n = [];
    // quêtes secondaires : exploration, et dialogue avec le commanditaire
    if (ev.type === 'lieu' && e.lieuxVus.indexOf(ev.id) < 0) e.lieuxVus.push(ev.id);
    // événements liés au temps qu'il fait et à l'avancée
    if (e.params.evenements && ev.type === 'meteo') {
      Object.keys(EVENEMENTS).forEach(function (id) {
        var d = EVENEMENTS[id];
        if (d.siMeteo && e.chap >= d.apresChapitre && d.siMeteo.indexOf(ev.meteo) >= 0) n = n.concat(declencher(e, id));
      });
    }
    if (e.params.evenements && ev.type === 'temps') {
      Object.keys(EVENEMENTS).forEach(function (id) {
        var d = EVENEMENTS[id];
        if (!d.siMeteo && d.apresChapitre !== undefined && e.chap >= d.apresChapitre && !e.evenements[id]) {
          // un peu de hasard maîtrisé : l'heure du monde fait office de dé
          if (Math.floor(ev.t) % 97 === (id.length * 13) % 97) n = n.concat(declencher(e, id));
        }
      });
    }
    if (ev.type === 'mort') { e.mort = true; return n.concat(terminer(e)); }

    var et = etapeCourante(e);
    if (!et) return n;
    if (e.debutEtape === null && ev.t !== undefined) e.debutEtape = ev.t;
    var fini = false;
    switch (et.type) {
      case 'parler':
        if (ev.type === 'parler' && ev.role === et.role && (!et.lieu || e.liens[et.lieu] && ev.lieu === e.liens[et.lieu].id)) {
          n.push({ type: 'dialogue', titre: ev.nom || ev.role, texte: remplir(et.dialogue, e) });
          fini = true;
        }
        break;
      case 'aller':
        if (ev.type === 'position') {
          var c = e.liens[et.cible];
          if (c && Math.hypot(ev.x - c.x, ev.z - c.z) <= (et.rayon || 24)) fini = true;
        }
        break;
      case 'biome':
        if (ev.type === 'biome' && et.biomes.indexOf(ev.id) >= 0) fini = true;
        break;
      case 'collecter':
        if (ev.type === 'inventaire') { e.progres = Math.min(et.n, compte(ctx, et.ids)); if (e.progres >= et.n) fini = true; }
        break;
      case 'livrer':
        if (ev.type === 'parler' && ev.role === et.role) {
          if (compte(ctx, et.ids) >= et.n) {
            n.push({ type: 'prendre', objets: [{ id: et.ids[0], n: et.n }] });
            n.push({ type: 'dialogue', titre: ev.nom || ev.role, texte: remplir(et.dialogue, e) });
            fini = true;
          } else n.push({ type: 'info', texte: 'Il vous faut encore ' + (et.n - compte(ctx, et.ids)) + ' ' + C.nameOf(et.ids[0]).toLowerCase() + '.' });
        }
        break;
      case 'vaincre':
        if (ev.type === 'boss' && e.liens[et.cible] && ev.donjon === e.liens[et.cible].id) fini = true;
        break;
      case 'tuer':
        if (ev.type === 'tuer' && et.types.indexOf(ev.mob) >= 0) { e.progres++; if (e.progres >= et.n) fini = true; }
        // délai dépassé : l'objectif échoue, et son drapeau le retient
        if (et.delai && ev.type === 'temps' && e.debutEtape !== null && ev.t - e.debutEtape > et.delai) {
          if (et.drapeau) e.drapeaux[et.drapeau] = false;
          noter(e, 'Échec : ' + remplir(et.texte, e));
          e.etape++; e.progres = 0; e.debutEtape = null;
          n.push({ type: 'echec', texte: 'Trop tard : ' + remplir(et.texte, e) });
          return n.concat(avancerSiSaute(e));
        }
        break;
      case 'survivre':
        if (ev.type === 'temps') {
          if (ev.nuit) e.nuitEnCours = true;
          else if (e.nuitEnCours) { e.nuitEnCours = false; e.progres++; if (e.progres >= et.nuits) fini = true; }
        }
        break;
      case 'choix':
        break;                                 // voir choisir()
    }
    if (fini) n = n.concat(finirEtape(e));
    return n;
  }

  /* Le choix en attente, s'il y en a un : le jeu l'affiche avec ses options. */
  function choixEnAttente(e) {
    var et = etapeCourante(e);
    return et && et.type === 'choix' && !e.fin ? { id: et.id, texte: remplir(et.texte, e), options: et.options } : null;
  }
  function choisir(e, id, option) {
    var c = choixEnAttente(e);
    if (!c || c.id !== id || !c.options.some(function (o) { return o.id === option; })) return [];
    e.drapeaux[id] = option;
    noter(e, 'Choix : ' + c.options.filter(function (o) { return o.id === option; })[0].texte);
    return finirEtape(e);
  }

  // ─── quêtes secondaires ──────────────────────────────────────────────────
  function queteProposee(e, role) {
    if (e.fin) return null;
    var prises = Object.keys(e.secondaires).length;
    if (prises >= e.secondairesPrevues) return null;
    for (var i = 0; i < ORDRE_SECONDAIRES.length; i++) {
      var id = ORDRE_SECONDAIRES[i], q = SECONDAIRES[id];
      if (q.role !== role || e.secondaires[id]) continue;
      if (q.requiert && !e.peut(q.requiert)) continue;
      return { id: id, titre: q.titre, texte: q.texte };
    }
    return null;
  }
  function accepter(e, id) {
    if (!SECONDAIRES[id] || e.secondaires[id]) return false;
    e.secondaires[id] = { etat: 'active', depart: e.lieuxVus.length };
    noter(e, 'Quête acceptée : ' + SECONDAIRES[id].titre);
    return true;
  }
  /* En parlant au commanditaire d'une quête active : peut-on la rendre ? */
  function rendreQuete(e, role, ctx) {
    var n = [];
    Object.keys(e.secondaires).forEach(function (id) {
      var s = e.secondaires[id], q = SECONDAIRES[id];
      if (s.etat !== 'active' || q.role !== role) return;
      var ok = q.explorer ? e.lieuxVus.length - s.depart >= q.explorer : compte(ctx, q.ids) >= q.n;
      if (!ok) { n.push({ type: 'info', texte: q.titre + ' : ' + q.texte }); return; }
      s.etat = 'faite';
      e.secondairesFaites++;
      noter(e, 'Quête accomplie : ' + q.titre);
      if (q.ids) n.push({ type: 'prendre', objets: [{ id: q.ids[0], n: q.n }], parmi: q.ids });
      n.push({ type: 'quete', titre: q.titre, texte: 'Quête accomplie : ' + q.titre });
      n.push({ type: 'recompense', objets: q.recompense });
    });
    return n;
  }

  // ─── lecture ─────────────────────────────────────────────────────────────
  /* L'objectif du moment, pour l'affichage et le repère sur la carte. */
  function objectif(e) {
    if (e.fin) return null;
    var ch = chapitreCourant(e), et = etapeCourante(e);
    if (!ch || !et) return null;
    var o = { chapitre: ch.titre, numero: e.chap + 1, total: e.chapitres.length, texte: remplir(et.texte, e), type: et.type };
    if (et.type === 'collecter' || et.type === 'tuer') { o.progres = e.progres; o.n = et.n; }
    if (et.type === 'survivre') { o.progres = e.progres; o.n = et.nuits; }
    var cible = et.cible ? e.liens[et.cible] : (et.lieu ? e.liens[et.lieu] : null);
    if (cible) o.cible = { x: cible.x, z: cible.z, nom: cible.nom };
    return o;
  }
  function quetesActives(e) {
    return Object.keys(e.secondaires).map(function (id) {
      return { id: id, titre: SECONDAIRES[id].titre, texte: SECONDAIRES[id].texte, etat: e.secondaires[id].etat };
    });
  }

  function serialiser(e) {
    return { params: e.params, liens: e.liens, chapitres: e.chapitres, chap: e.chap, etape: e.etape, progres: e.progres,
             debutEtape: e.debutEtape, drapeaux: e.drapeaux, journal: e.journal, secondaires: e.secondaires,
             secondairesPrevues: e.secondairesPrevues, secondairesFaites: e.secondairesFaites, evenements: e.evenements,
             lieuxVus: e.lieuxVus, nuits: e.nuits, nuitEnCours: e.nuitEnCours, mort: e.mort, fin: e.fin, commence: e.commence };
  }
  function charger(d, peut) {
    var e = creer(d.params, d.liens, peut);
    for (var k in d) if (k !== 'params' && k !== 'liens') e[k] = d[k];
    return e;
  }

  MC.Histoire = { CHAPITRES: CHAPITRES, SECONDAIRES: SECONDAIRES, EVENEMENTS: EVENEMENTS, FINS: FINS, LONGUEURS: LONGUEURS,
                  TITRE: 'La Couronne des Saisons',
                  parametres: parametres, lier: lier, creer: creer, commencer: commencer, signaler: signaler,
                  choixEnAttente: choixEnAttente, choisir: choisir, queteProposee: queteProposee, accepter: accepter,
                  rendreQuete: rendreQuete, objectif: objectif, quetesActives: quetesActives, finDe: finDe,
                  serialiser: serialiser, charger: charger };
})(typeof globalThis !== 'undefined' ? globalThis : this);
