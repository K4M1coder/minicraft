/* politique.js — factions PNJ autonomes (SPEC-FACTION-006 à 008). Logique pure.
   Prolonge factions.js (camps des créatures) sans le modifier : ici, ce sont
   des factions POLITIQUES — royaumes de villes, guildes marchandes, ordres,
   bandits en zone vierge, cultes près des volcans — avec siège, territoire,
   ressources, caractère et objectifs.

   Le monde ne se génère jamais tout entier d'un coup (villes, villages, lieux
   se révèlent au fil de l'exploration, cf. habitats.js) : les factions
   politiques naissent donc au fil de l'eau, quand l'appelant lui signale un
   « site » (une ville, une mégapole, un volcan, une zone vierge…) via
   `decouvrir`. Chaque site ne peut faire naître qu'un jeu de factions
   entièrement déterminé par (graine, site.id) — jamais par l'ordre de
   découverte — pour que deux joueurs qui explorent dans un ordre différent
   retrouvent malgré tout les mêmes factions aux mêmes endroits.

   La simulation avance par JOUR DE JEU (un entier croissant fourni par
   l'appelant, pas une horloge réelle) : `tourDuMonde(etat, jour)` rattrape
   tous les jours manquants d'un coup, un par un, toujours dans le même ordre
   — rejouer les mêmes jours, dans le même ordre, donne donc TOUJOURS le même
   état, que ce soit en direct ou après un rechargement. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  // ─── hachage déterministe (indépendant de MC.Noise : aucune dépendance) ────
  function h32(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function h01() {
    var s = '';
    for (var i = 0; i < arguments.length; i++) s += (i ? '|' : '') + arguments[i];
    return h32(s) / 4294967296;
  }

  // ─── genres de factions ─────────────────────────────────────────────────
  var TYPES = {
    royaume: { nom: 'Royaume', objectifs: ['etendre', 'defendre', 'commercer'] },
    guilde:  { nom: 'Guilde marchande', objectifs: ['commercer', 'explorer'] },
    ordre:   { nom: 'Ordre', objectifs: ['defendre', 'convertir'] },
    bandits: { nom: 'Bandits', objectifs: ['piller', 'etendre'] },
    culte:   { nom: 'Culte', objectifs: ['convertir', 'piller'] },
  };
  var CARACTERES = ['belliqueux', 'pacifique', 'pragmatique', 'fanatique', 'avare'];
  var PREFIXES = {
    royaume: ['Royaume', 'Duché', 'Marche', 'Domaine', 'Principauté'],
    guilde: ['Guilde', 'Compagnie', 'Comptoir', 'Négoce'],
    ordre: ['Ordre', 'Confrérie', 'Garde'],
    bandits: ['Bande', 'Horde', 'Clan'],
    culte: ['Culte', 'Secte', 'Cercle'],
  };

  function nomFaction(type, site, hNom) {
    var l = PREFIXES[type] || ['Faction'];
    var pfx = l[Math.floor(hNom * l.length) % l.length];
    return pfx + ' de ' + (site.nom || site.id);
  }

  function creerFaction(seed, site, type, hCar, hNom) {
    var car = CARACTERES[Math.floor(hCar * CARACTERES.length) % CARACTERES.length];
    var def = TYPES[type];
    var id = type + ':' + site.id;
    var objectif = def.objectifs[Math.floor(h01(seed, id, 'objectif') * def.objectifs.length) % def.objectifs.length];
    var rayon = type === 'bandits' ? 40 + Math.floor(h01(seed, id, 'rayon') * 60)
              : type === 'royaume' ? 120 + Math.floor(h01(seed, id, 'rayon') * 200)
              : 60 + Math.floor(h01(seed, id, 'rayon') * 100);
    return {
      id: id, type: type, nom: nomFaction(type, site, hNom), caractere: car,
      siege: { x: site.x, z: site.z, site: site.id },
      territoire: rayon,
      ressources: { or: 20 + Math.floor(h01(seed, id, 'or') * 80), nourriture: 20 + Math.floor(h01(seed, id, 'nourriture') * 80) },
      objectif: objectif, objectifs: def.objectifs.slice(),
      naissance: 0,
    };
  }

  /* Quelles factions un site donné fait-il naître ? Une ville/mégapole porte
     toujours un royaume (parfois un ordre à la place) et, une fois sur trois,
     une guilde marchande qui y cohabite ; un volcan attire parfois un culte ;
     une zone vierge, parfois des bandits. Rien n'est garanti : beaucoup de
     sites restent de simples lieux, sans faction. */
  function naitreDe(seed, site) {
    var out = [], kind = site.kind;
    if (kind === 'ville' || kind === 'megapole') {
      var h1 = h01(seed, site.id, 'type'), h2 = h01(seed, site.id, 'car'), h3 = h01(seed, site.id, 'nom');
      var type = kind === 'megapole' || h1 < 0.7 ? 'royaume' : 'ordre';
      out.push(creerFaction(seed, site, type, h2, h3));
      var h4 = h01(seed, site.id, 'guilde-chance');
      if (h4 < 0.35) out.push(creerFaction(seed, site, 'guilde', h01(seed, site.id, 'guilde-car'), h01(seed, site.id, 'guilde-nom')));
    } else if (kind === 'volcan') {
      if (h01(seed, site.id, 'culte-chance') < 0.5) {
        out.push(creerFaction(seed, site, 'culte', h01(seed, site.id, 'culte-car'), h01(seed, site.id, 'culte-nom')));
      }
    } else if (kind === 'vierge') {
      if (h01(seed, site.id, 'bandits-chance') < 0.4) {
        out.push(creerFaction(seed, site, 'bandits', h01(seed, site.id, 'bandits-car'), h01(seed, site.id, 'bandits-nom')));
      }
    }
    return out;
  }

  // ─── relations entre factions ───────────────────────────────────────────
  var ECHELLE = ['guerre', 'rivalite', 'neutre', 'alliance'];
  function indexRelation(r) { var i = ECHELLE.indexOf(r); return i < 0 ? 2 : i; }
  function ameliorer(r) { return ECHELLE[Math.min(ECHELLE.length - 1, indexRelation(r) + 1)]; }
  function degrader(r) { return ECHELLE[Math.max(0, indexRelation(r) - 1)]; }
  function cleRelation(a, b) { return a < b ? a + '~' + b : b + '~' + a; }
  function relationEntre(etat, a, b) { return etat.relations.get(cleRelation(a, b)) || 'neutre'; }

  function relationInitiale(seed, fa, fb) {
    var h = h01(seed, cleRelation(fa.id, fb.id), 'init');
    if (fa.type === 'bandits' || fb.type === 'bandits') return h < 0.7 ? 'guerre' : 'rivalite';
    if ((fa.type === 'royaume' || fa.type === 'ordre') && (fb.type === 'royaume' || fb.type === 'ordre')) {
      return h < 0.15 ? 'rivalite' : h < 0.35 ? 'alliance' : 'neutre';
    }
    if (fa.type === 'culte' || fb.type === 'culte') return h < 0.5 ? 'rivalite' : 'neutre';
    return h < 0.2 ? 'alliance' : 'neutre';
  }

  /* SPEC-FACTION-006 : la dérive des relations est un rappel vers leur état naturel
     (relationInitiale), pas une marche libre : sans cela, la dérive, symétrique,
     répartit les relations à parts égales au fil des années et chaque faction a
     toujours une guerre voisine, donc le même objectif (se défendre). Un pas qui
     éloignerait la relation de son état naturel au-delà d'un cran (ou plus loin
     qu'elle ne l'est déjà) est refusé ; un pas qui s'en rapproche l'est toujours.
     Les guerres nées d'un raid se résorbent ainsi d'elles-mêmes. */
  function deriveAutorisee(etat, ida, idb, avant, apres) {
    var fa = etat.factions.get(ida), fb = etat.factions.get(idb);
    if (!fa || !fb) return true;
    var nat = indexRelation(relationInitiale(etat.seed, fa, fb));
    var dApres = Math.abs(indexRelation(apres) - nat), dAvant = Math.abs(indexRelation(avant) - nat);
    return dApres <= Math.max(1, dAvant);
  }

  // ─── annonces (chat) ─────────────────────────────────────────────────────
  var ANNONCES_MAX = 200;
  function annoncer(etat, texte, factions) {
    etat.annonces.push({ jour: etat.jour, texte: texte, factions: factions || [] });
    if (etat.annonces.length > ANNONCES_MAX) etat.annonces.shift();
    // compteur monotone (non persisté) : l'appelant sait combien d'annonces sont nées,
    // même quand la liste, bornée, n'en garde que les ANNONCES_MAX dernières
    etat.nbAnnonces = (etat.nbAnnonces || 0) + 1;
  }
  var LIBELLES_RELATION = { guerre: 'entrent en guerre', rivalite: 'deviennent rivales',
    neutre: 'renouent des relations neutres', alliance: 'concluent une alliance' };
  function nomDe(etat, id) { var f = etat.factions.get(id); return f ? f.nom : id; }

  // ─── naissance ───────────────────────────────────────────────────────────
  /* `sites` : liste de { id, kind: 'ville'|'megapole'|'volcan'|'vierge', x, z, nom }
     fournie par l'appelant (typiquement via MC.Habitats.lieuxProches et
     MC.Densite/MC.Volcanisme pour repérer volcans et zones vierges). Triée
     avant traitement : le résultat ne dépend donc jamais de l'ordre d'arrivée
     des sites, seulement de leur identifiant et de la graine. */
  function decouvrir(etat, sites) {
    var nouvelles = [];
    (sites || []).slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; })
      .forEach(function (site) {
        naitreDe(etat.seed, site).forEach(function (f) {
          if (etat.factions.has(f.id)) return;
          f.naissance = etat.jour;
          etat.factions.set(f.id, f);
          nouvelles.push(f);
        });
      });
    if (!nouvelles.length) return nouvelles;
    var tousIds = Array.from(etat.factions.keys()).sort();
    nouvelles.forEach(function (f) {
      tousIds.forEach(function (autreId) {
        if (autreId === f.id) return;
        var cle = cleRelation(f.id, autreId);
        if (etat.relations.has(cle)) return;
        etat.relations.set(cle, relationInitiale(etat.seed, etat.factions.get(autreId), f));
      });
    });
    nouvelles.forEach(function (f) { annoncer(etat, TYPES[f.type].nom + ' « ' + f.nom + ' » voit le jour.', [f.id]); });
    return nouvelles;
  }

  // ─── simulation à gros grain, par jour de jeu ──────────────────────────
  /* SPEC-FACTION-007 : chaque objectif a ses actions. « convertir » envoie des
     missions (qui apaisent les rivalités), « commercer » des caravanes (qui
     enrichissent et rapprochent les partenaires), « défendre » et « explorer »
     des patrouilles (vigilance, ennemis repoussés, ronde visible près des
     joueurs), « s'étendre » des avant-postes, « piller » des raids. */
  var ACTIONS_PAR_OBJECTIF = {
    etendre: ['avant_poste', 'patrouille', 'rien'],
    commercer: ['caravane', 'rien'],
    defendre: ['patrouille', 'rien'],
    piller: ['raid', 'rien'],
    convertir: ['mission', 'caravane', 'rien'],
    explorer: ['patrouille', 'caravane', 'rien'],
  };
  function choisirAction(f, hAction) {
    var opts = ACTIONS_PAR_OBJECTIF[f.objectif] || ['rien'];
    var seuil = f.caractere === 'belliqueux' || f.caractere === 'fanatique' ? 0.6
              : f.caractere === 'pacifique' ? 0.25 : 0.4;
    if (hAction > seuil) return 'rien';
    return opts[Math.floor((hAction / seuil) * opts.length) % opts.length];
  }
  /* `voisins` (facultatif) : l'index des relations entre factions PNJ du jour
     simulé (indexer), tenu à jour pendant ce jour — sans lui, une passe sur
     toutes les relations (appelants hors de la simulation). Les deux voies
     donnent exactement les mêmes candidats. */
  function ciblePourRaid(etat, f, jour, voisins) {
    var candidats = [];
    pourVoisins(etat, voisins, f.id, function (autreId, r) { if (r === 'guerre' || r === 'rivalite') candidats.push(autreId); });
    if (!candidats.length) return null;
    candidats.sort();
    var h = h01(etat.seed, f.id, 'ciblage', jour);
    return etat.factions.get(candidats[Math.floor(h * candidats.length) % candidats.length]);
  }
  var TERRITOIRE_MAX = 400, TERRITOIRE_MIN = 20;
  /* SPEC-FACTION-016 : un raid ou un avant-poste a un coût fixe, prélevé sur
     l'auteur qu'il réussisse ou non (jamais sous zéro) ; le territoire, lui,
     n'est gagné qu'en cas de succès (jet déterministe par graine). */
  var COUT_ACTION_RESSOURCES = { or: 6, nourriture: 4 };
  function prelever(f, cout) {
    f.ressources.or = Math.max(0, f.ressources.or - cout.or);
    f.ressources.nourriture = Math.max(0, f.ressources.nourriture - cout.nourriture);
  }
  /* Gain d'un avant-poste réussi (SPEC-FACTION-016) : factorisé pour être
     rejoué à l'identique par un donjon rattaché vaincu (SPEC-DONJON-018,
     donjons.js:victoireGardien) sans dupliquer le calcul de territoire. */
  function appliquerGainAvantPoste(f) {
    f.territoire = Math.min(TERRITOIRE_MAX, f.territoire + 10);
  }
  // ─── index des relations (coût borné d'un jour simulé) ──────────────────
  /* Les relations PNJ↔PNJ croissent comme n² (≈ 58 000 paires pour ≈ 340
     factions) : les rebalayer à chaque raid, mission ou caravane coûtait plus
     que tout le reste du jour. L'index, bâti une fois tant que ni les relations
     ni les factions ne changent de taille (une naissance ajoute toujours ses
     paires), garde chaque clé dans l'ordre de la Map, ses deux factions, un
     hachage de base, la liste des clés de chaque faction et le code de sa
     relation ; chaque jour, une seule passe sur la Map rafraîchit les codes
     (et vérifie que les clés n'ont pas bougé, sinon l'index est rebâti). Les
     actions du jour le tiennent à jour (poserRelation). */
  var CACHES = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function rafraichirIndex(etat, c) {
    var k = 0, ok = true;
    etat.relations.forEach(function (r, cle) {
      if (!ok) return;
      if (cle !== c.cles[k]) { ok = false; return; }
      c.codes[k++] = codeRelation(r);
    });
    return ok && k === c.cles.length;
  }
  /* Ajoute au tableau typé `t` (déjà plein jusqu'à `n`) de quoi loger `plus` entrées. */
  function agrandir(t, n, plus) {
    if (n + plus <= t.length) return t;
    var u = new t.constructor(Math.max(n + plus, Math.ceil(t.length * 1.5)));
    u.set(t.subarray(0, n));
    return u;
  }
  // renseigne l'entrée k de l'index pour la clé cle (identifiants, hachage, distance, drapeau PNJ)
  function remplirEntree(etat, c, k, cle, listes) {
    var t = cle.indexOf('~');
    c.cles[k] = cle;
    c.a[k] = cle.slice(0, t); c.b[k] = cle.slice(t + 1);
    c.base[k] = h32(cle);
    c.indexDe.set(cle, k);
    // une clé impliquant une faction absente de etat.factions (une faction de
    // joueurs posée par guildes.js:declarerRelation, SPEC-FACTION-017) n'est ni
    // dérivée, ni annoncée, ni candidate : etat.relations sert aussi de mémoire
    // à ce genre de relation externe.
    c.pnj[k] = c.a[k] !== c.b[k] && etat.factions.has(c.a[k]) && etat.factions.has(c.b[k]) ? 1 : 0;
    if (!c.pnj[k]) return;
    var fa = etat.factions.get(c.a[k]), fb = etat.factions.get(c.b[k]);
    c.dist[k] = Math.hypot(fa.siege.x - fb.siege.x, fa.siege.z - fb.siege.z);   // les sièges ne bougent jamais
    [c.a[k], c.b[k]].forEach(function (id) { var l = listes.get(id); if (!l) listes.set(id, l = []); l.push(k); });
  }
  /* SPEC-FACTION-007 (coût borné) : une naissance de faction ou une relation
     externe ajoutée entre deux jours ne rebâtit pas les ≈ 58 000 clés : les
     nouvelles clés sont toujours en fin de Map, l'index les ajoute à la suite
     (tableaux agrandis, listes de voisins prolongées). Si une clé a disparu ou
     changé de place, ou si une faction a disparu, l'appelant rebâtit. */
  function etendreIndex(etat, c) {
    var n = c.n;
    if (etat.factions.size < c.nf || etat.relations.size < n) return false;
    var k = 0, ok = true, vus = 0;
    etat.relations.forEach(function (r, cle) {
      if (!ok) return;
      if (k < n) {
        if (cle !== c.cles[k]) { ok = false; return; }
        c.codes[k++] = codeRelation(r);
      } else vus++;
    });
    if (!ok || k !== n) return false;
    if (etat.factions.size !== c.nf) {
      // une clé externe jusque-là ignorée dont les deux factions existent désormais devient PNJ : rebâtir
      for (var q = 0; q < n; q++) {
        if (c.pnj[q]) continue;
        if (c.a[q] !== c.b[q] && etat.factions.has(c.a[q]) && etat.factions.has(c.b[q])) return false;
      }
    }
    if (vus) {
      c.base = agrandir(c.base, n, vus); c.pnj = agrandir(c.pnj, n, vus); c.codes = agrandir(c.codes, n, vus); c.dist = agrandir(c.dist, n, vus);
      var listes = new Map(), i = 0;
      etat.relations.forEach(function (r, cle) {
        if (i++ < n) return;
        var kk = i - 1;
        remplirEntree(etat, c, kk, cle, listes);
        c.codes[kk] = codeRelation(r);
      });
      c.n = n + vus;
      listes.forEach(function (l, id) {
        var ancien = c.adj.get(id) || new Int32Array(0), u = new Int32Array(ancien.length + l.length);
        u.set(ancien); u.set(l, ancien.length);
        c.adj.set(id, u);
      });
    }
    c.taille = etat.relations.size; c.nf = etat.factions.size;
    c.ids = Array.from(etat.factions.keys()).sort();
    return true;
  }
  var reconstructions = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  /* Nombre de fois que l'index des relations de `etat` a été rebâti en entier
     (et non étendu) : un test s'en sert pour prouver qu'une naissance ou une
     relation externe n'impose pas le rebâtissage complet. */
  function indexReconstructions(etat) { return (reconstructions && reconstructions.get(etat.relations)) || 0; }
  function indexer(etat) {
    var c = CACHES && CACHES.get(etat.relations);
    if (c && c.taille === etat.relations.size && c.nf === etat.factions.size && rafraichirIndex(etat, c)) return c;
    if (c && etendreIndex(etat, c)) return c;
    var cles = Array.from(etat.relations.keys()), n = cles.length, listes = new Map();
    c = { taille: n, nf: etat.factions.size, n: n, cles: new Array(n), a: new Array(n), b: new Array(n),
          base: new Uint32Array(n), pnj: new Uint8Array(n), codes: new Uint8Array(n), dist: new Float32Array(n), indexDe: new Map(), adj: new Map(),
          ids: Array.from(etat.factions.keys()).sort() };
    for (var k = 0; k < n; k++) remplirEntree(etat, c, k, cles[k], listes);
    listes.forEach(function (l, id) { c.adj.set(id, Int32Array.from(l)); });
    rafraichirIndex(etat, c);
    if (CACHES) CACHES.set(etat.relations, c);
    if (reconstructions) reconstructions.set(etat.relations, (reconstructions.get(etat.relations) || 0) + 1);
    return c;
  }
  /* fn(autreId, relation) pour chaque relation de `id` avec une autre faction PNJ
     (avec l'index : neutres comprises ; sans : celles que la Map contient). */
  function pourVoisins(etat, ix, id, fn) {
    if (ix) {
      var l = ix.adj.get(id);
      if (!l) return;
      for (var i = 0; i < l.length; i++) { var k = l[i]; fn(ix.a[k] === id ? ix.b[k] : ix.a[k], ECHELLE[ix.codes[k]]); }
      return;
    }
    etat.relations.forEach(function (r, cle) {
      var t = cle.indexOf('~'), a = cle.slice(0, t), b = cle.slice(t + 1);
      var autre = a === id ? b : b === id ? a : null;
      if (autre && autre !== id && etat.factions.has(autre)) fn(autre, r);
    });
  }
  function poserRelation(etat, ix, a, b, r) {
    var cle = cleRelation(a, b);
    etat.relations.set(cle, r);
    if (!ix) return;
    var k = ix.indexDe.get(cle);
    if (k !== undefined) ix.codes[k] = codeRelation(r);
  }
  // mélange d'un hachage de clé et d'un hachage de jour (déterministe, sans chaîne à bâtir)
  function melange01(a, b) {
    var h = Math.imul((a ^ b) >>> 0, 0x85ebca6b) >>> 0;
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0; h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // ─── actions (SPEC-FACTION-007) ────────────────────────────────────────
  var DUREE_PATROUILLE = 3, PATROUILLES_MAX = 6, RAYON_RONDE_MAX = 48, RAYON_RONDE_MIN = 16, POINTS_RONDE = 6;
  var VIGILANCE_JOURS = 2, SUBIS_MAX = 8, AVANT_POSTES_MAX = 6, RESSOURCES_MAX = 500, PORTEE_COMMERCE = 3000;
  /* Le tracé d'une ronde : POINTS_RONDE points sur un cercle autour du siège,
     dans le territoire (assez loin du centre pour ne pas tourner sur place),
     orientés selon le jour. */
  function pointsRonde(seed, f, jour) {
    var rr = Math.max(RAYON_RONDE_MIN, Math.min(f.territoire * 0.6, RAYON_RONDE_MAX));
    var a0 = h01(seed, f.id, 'ronde', jour) * Math.PI * 2, out = [];
    for (var i = 0; i < POINTS_RONDE; i++) {
      var a = a0 + i * Math.PI * 2 / POINTS_RONDE;
      out.push({ x: Math.round(f.siege.x + Math.cos(a) * rr), z: Math.round(f.siege.z + Math.sin(a) * rr) });
    }
    return out;
  }
  // la faction la plus proche avec qui commercer (ni en guerre ni rivale), à portée
  function partenaireCommerce(etat, f, voisins) {
    var hostiles = new Set(), best = null, bd = PORTEE_COMMERCE;
    pourVoisins(etat, voisins, f.id, function (id, r) { if (r === 'guerre' || r === 'rivalite') hostiles.add(id); });
    etat.factions.forEach(function (o, id) {
      if (id === f.id || hostiles.has(id)) return;
      var d = Math.hypot(o.siege.x - f.siege.x, o.siege.z - f.siege.z);
      if (d < bd || (d === bd && best && id < best.id)) { bd = d; best = o; }
    });
    return best;
  }
  function relationDe(etat, ix, a, b) {
    var k = ix ? ix.indexDe.get(cleRelation(a, b)) : undefined;
    if (k !== undefined) return ECHELLE[ix.codes[k]];
    return relationEntre(etat, a, b);
  }
  function appliquerAction(etat, f, action, jour, voisins) {
    if (action === 'caravane') {
      // une caravane rapporte (or, vivres) et, de loin en loin, rapproche les partenaires
      f.ressources.or = Math.min(RESSOURCES_MAX, f.ressources.or + 3);
      f.ressources.nourriture = Math.min(RESSOURCES_MAX, f.ressources.nourriture + 1);
      var part = partenaireCommerce(etat, f, voisins);
      annoncer(etat, f.nom + ' envoie une caravane commerciale' + (part ? ' vers ' + part.nom : '') + '.', part ? [f.id, part.id] : [f.id]);
      if (part && h01(etat.seed, f.id, 'caravane-lien', jour) < 0.08) {
        var rc = relationDe(etat, voisins, f.id, part.id), rc2 = ameliorer(rc);
        if (rc2 !== rc) {
          poserRelation(etat, voisins, f.id, part.id, rc2);
          annoncer(etat, f.nom + ' et ' + part.nom + ' ' + LIBELLES_RELATION[rc2] + ' grâce au commerce.', [f.id, part.id]);
        }
      }
      return;
    }
    if (action === 'mission') {
      // missionnaires : une rivalité s'apaise (à défaut, un voisin neutre se rapproche)
      prelever(f, { or: 2, nourriture: 0 });
      var rivaux = [];
      pourVoisins(etat, voisins, f.id, function (id, r) { if (r === 'rivalite') rivaux.push(id); });
      rivaux.sort();
      var cibleM = rivaux.length ? etat.factions.get(rivaux[Math.floor(h01(etat.seed, f.id, 'mission-cible', jour) * rivaux.length) % rivaux.length])
                                 : partenaireCommerce(etat, f, voisins);
      if (!cibleM) return;
      var seuilM = rivaux.length ? 0.2 : 0.1;
      if (h01(etat.seed, f.id, 'mission', jour) < seuilM) {
        var rm = relationDe(etat, voisins, f.id, cibleM.id), rm2 = ameliorer(rm);
        if (rm2 !== rm) {
          poserRelation(etat, voisins, f.id, cibleM.id, rm2);
          annoncer(etat, 'Les missionnaires de ' + f.nom + ' gagnent ' + cibleM.nom + ' à leur cause : elles ' + LIBELLES_RELATION[rm2] + '.', [f.id, cibleM.id]);
        }
      }
      return;
    }
    if (action === 'patrouille') {
      /* Une ronde : la faction est sur ses gardes (un raid contre elle réussit
         moins souvent), repousse les ennemis en guerre dont le territoire empiète
         sur le sien, sinon consolide le sien ; son tracé fait apparaître des gardes
         en marche près des joueurs (patrouillesVisibles, serveur). */
      f.vigilance = jour + VIGILANCE_JOURS;
      f.patrouille = { jour: jour, points: pointsRonde(etat.seed, f, jour) };
      var repousses = [];
      var ennemis = [];
      pourVoisins(etat, voisins, f.id, function (id, r) { if (r === 'guerre') ennemis.push(id); });
      ennemis.sort().forEach(function (id) {
        var en = etat.factions.get(id);
        if (!en || Math.hypot(en.siege.x - f.siege.x, en.siege.z - f.siege.z) >= f.territoire + en.territoire) return;
        if (en.territoire <= TERRITOIRE_MIN) return;
        en.territoire = Math.max(TERRITOIRE_MIN, en.territoire - 3);
        repousses.push(en);
      });
      if (repousses.length) annoncer(etat, 'Les patrouilles de ' + f.nom + ' repoussent ' + repousses.map(function (x) { return x.nom; }).join(', ') + '.', [f.id].concat(repousses.map(function (x) { return x.id; })));
      else f.territoire = Math.min(TERRITOIRE_MAX, f.territoire + 1);
      return;
    }
    if (action === 'avant_poste') {
      prelever(f, COUT_ACTION_RESSOURCES);
      var hap = h01(etat.seed, f.id, 'avant_poste', jour);
      if (hap < 0.5) {
        appliquerGainAvantPoste(f);
        // un lieu précis, au bord du nouveau territoire
        var ang = h01(etat.seed, f.id, 'ap-angle', jour) * Math.PI * 2, dist = f.territoire * 0.85;
        var ap = { x: Math.round(f.siege.x + Math.cos(ang) * dist), z: Math.round(f.siege.z + Math.sin(ang) * dist), jour: jour };
        if (!f.avantPostes) f.avantPostes = [];
        f.avantPostes.push(ap);
        if (f.avantPostes.length > AVANT_POSTES_MAX) f.avantPostes.shift();
        annoncer(etat, f.nom + ' fonde un avant-poste (' + ap.x + ', ' + ap.z + ') et étend son territoire.', [f.id]);
      } else {
        annoncer(etat, f.nom + ' tente de fonder un avant-poste, sans succès.', [f.id]);
      }
      return;
    }
    if (action === 'raid') {
      var cible = ciblePourRaid(etat, f, jour, voisins);
      if (!cible) return;
      prelever(f, COUT_ACTION_RESSOURCES);
      // la victime s'en souvient (SPEC-FACTION-006 : son objectif en tiendra compte)
      if (!cible.subis) cible.subis = [];
      cible.subis.push(jour);
      if (cible.subis.length > SUBIS_MAX) cible.subis.shift();
      var h = h01(etat.seed, f.id, cible.id, 'raid', jour);
      // une faction sur ses gardes (patrouille récente) résiste mieux
      var seuilRaid = cible.vigilance !== undefined && cible.vigilance >= jour ? 0.3 : 0.5;
      if (h < seuilRaid) {
        appliquerGainElimination(etat, f, cible, voisins);
        annoncer(etat, f.nom + ' mène un raid contre ' + cible.nom + ' et gagne du terrain.', [f.id, cible.id]);
      } else {
        annoncer(etat, f.nom + ' échoue à raider ' + cible.nom + '.', [f.id, cible.id]);
      }
    }
    // 'rien' : discret, pas d'annonce
  }
  /* Effet d'une élimination réussie (raid classique ou quête SPEC-QUETE-002) :
     factorisé pour que les deux voies produisent EXACTEMENT le même résultat
     sur le territoire et la relation, à graine égale. */
  function appliquerGainElimination(etat, f, cible, voisins) {
    f.territoire = Math.min(TERRITOIRE_MAX, f.territoire + 15);
    cible.territoire = Math.max(TERRITOIRE_MIN, cible.territoire - 15);
    poserRelation(etat, voisins, f.id, cible.id, 'guerre');
  }
  /* Ce que le territoire rapporte chaque jour : des vivres, selon son étendue. */
  function produire(f) {
    f.ressources.nourriture = Math.min(RESSOURCES_MAX, f.ressources.nourriture + 1 + Math.floor(f.territoire / 150));
  }

  /* Les rondes du moment qui prennent corps près des joueurs (SPEC-FACTION-007) :
     la simulation reste à gros grain partout ; seules les rondes dont un point de
     passage est à `rayon` d'une position deviennent des gardes en marche (au plus
     PATROUILLES_MAX, les plus proches d'abord). Coût : factions × positions, sans
     balayage des relations ; l'appelant la consulte à sa cadence d'entretien. */
  /* `jour` est celui de la simulation (etat.jour), déjà avancé d'un cran par le
     jour d'action : une ronde décidée le jour d, visible dès le jour d + 1,
     l'est DUREE_PATROUILLE jours (d + 1 à d + DUREE_PATROUILLE). */
  function patrouillesVisibles(etat, positions, rayon, jour) {
    var out = [];
    if (!positions || !positions.length) return out;
    etat.factions.forEach(function (f, id) {
      var p = f.patrouille;
      if (!p || !p.points || jour < p.jour || jour - p.jour > DUREE_PATROUILLE) return;
      var dmin = Infinity;
      for (var i = 0; i < positions.length; i++) {
        var q = positions[i];
        if (Math.hypot(q.x - f.siege.x, q.z - f.siege.z) > rayon + RAYON_RONDE_MAX + 2) continue;
        for (var k = 0; k < p.points.length; k++) {
          var d = Math.hypot(q.x - p.points[k].x, q.z - p.points[k].z);
          if (d < dmin) dmin = d;
        }
      }
      if (dmin > rayon) return;
      out.push({ faction: id, nom: f.nom, jour: p.jour, points: p.points.slice(), gardes: Math.min(3, 1 + Math.floor(f.territoire / 150)), distance: dmin });
    });
    out.sort(function (a, b) { return a.distance - b.distance || (a.faction < b.faction ? -1 : a.faction > b.faction ? 1 : 0); });
    return out.slice(0, PATROUILLES_MAX);
  }

  /* Les gardes tombés pendant leur ronde (clé `faction#jour#i`, cf. le serveur)
     ne renaissent pas avant la ronde suivante : cette mémoire n'oublie donc
     que les rondes TERMINÉES (jour d'action + DUREE_PATROUILLE dépassé) et, au
     pire seulement, les plus anciennes au-delà de `max` — jamais tout d'un
     coup, ce qui rendait la vie à tous les gardes tués d'une ronde en cours. */
  function purgerGardesTombes(tombes, jour, max) {
    tombes.forEach(function (cle) {
      var j = parseInt(String(cle).split('#')[1], 10);
      if (isNaN(j) || jour - j > DUREE_PATROUILLE) tombes.delete(cle);
    });
    var exces = tombes.size - (max || 512);
    if (exces > 0) tombes.forEach(function (cle) { if (exces-- > 0) tombes.delete(cle); });
  }
  /* Le plan d'une cadence d'entretien des gardes en ronde : `voulues` (clé → ce
     qu'il faut faire apparaître) sont les gardes que les rondes visibles réclament ;
     `presents` (clé → entité) ceux qui existent ; `tombes` ceux tués pendant leur
     ronde ; `vivant(entité)` dit si l'entité vit encore. Un garde mort est retiré des
     présents et, si sa ronde court toujours, noté tombé : il ne renaît pas avant la
     ronde suivante (clé d'un autre jour). Un garde dont la ronde n'est plus voulue
     (finie, ou loin de tout joueur) est à retirer. Renvoie { retirer: [entités],
     creer: [{ cle, voulu }] } ; l'appelant retire, crée, puis inscrit les créés
     dans `presents`. */
  function planifierGardes(voulues, presents, tombes, vivant) {
    var retirer = [], creer = [];
    presents.forEach(function (e, cle) {
      if (!vivant(e)) { presents.delete(cle); if (voulues.has(cle)) tombes.add(cle); return; }
      if (!voulues.has(cle)) { retirer.push(e); presents.delete(cle); }
    });
    voulues.forEach(function (voulu, cle) {
      if (presents.has(cle) || tombes.has(cle)) return;
      creer.push({ cle: cle, voulu: voulu });
    });
    return { retirer: retirer, creer: creer };
  }
  /* Les annonces nées depuis que le compteur monotone valait `avant` : au plus
     `max` des plus récentes. La liste, bornée, perd les plus anciennes ; seul
     le compteur dit combien sont nées (la longueur de la liste ne bouge plus
     quand elle est pleine). */
  function annoncesDepuis(etat, avant, max) {
    var n = Math.min((etat.nbAnnonces || 0) - (avant || 0), etat.annonces.length, max);
    return n > 0 ? etat.annonces.slice(-n) : [];
  }

  // ─── objectifs qui évoluent (SPEC-FACTION-006) ─────────────────────────
  var SEUIL_RUINE = 15, SEUIL_FORCE = 40, SEUIL_RICHE_OR = 80, SEUIL_RICHE_NOURRITURE = 60;
  var MEMOIRE_RAID_JOURS = 7, CYCLE_OBJECTIF_JOURS = 21;
  var TYPES_PILLARDS = { bandits: 1, culte: 1 };
  var CARACTERES_AGRESSIFS = { belliqueux: 1, fanatique: 1, avare: 1 };
  var TYPES_PROSELYTES = { ordre: 1, culte: 1 };
  var LIBELLES_OBJECTIF = { etendre: 's\'étendre', commercer: 'commercer', defendre: 'se défendre',
    piller: 'piller', convertir: 'convertir', explorer: 'explorer' };
  /* Ce qui compte pour une faction : ses relations avec les factions assez
     proches pour l'atteindre (territoires distants de moins de PORTEE_CONFLIT) —
     une guerre déclarée à l'autre bout du monde ne change pas son quotidien. */
  var PORTEE_CONFLIT = 3000;
  function situationDe(etat, f, voisins) {
    var s = { guerre: 0, rivalite: 0, alliance: 0 };
    if (voisins) {
      // voie rapide (un jour simulé) : distances des sièges et territoires de l'index
      var l = voisins.adj.get(f.id), tf = f.territoire;
      if (!l) return s;
      for (var i = 0; i < l.length; i++) {
        var k = l[i], c = voisins.codes[k];
        if (c === 2 || voisins.dist[k] > tf + TERRITOIRE_MAX + PORTEE_CONFLIT) continue;
        var autre = voisins.a[k] === f.id ? voisins.b[k] : voisins.a[k], o = etat.factions.get(autre);
        if (!o || voisins.dist[k] > tf + o.territoire + PORTEE_CONFLIT) continue;
        s[ECHELLE[c]]++;
      }
      return s;
    }
    pourVoisins(etat, voisins, f.id, function (id, r) {
      if (s[r] === undefined) return;
      var o = etat.factions.get(id);
      if (!o || Math.hypot(o.siege.x - f.siege.x, o.siege.z - f.siege.z) > f.territoire + o.territoire + PORTEE_CONFLIT) return;
      s[r]++;
    });
    return s;
  }
  /* L'objectif que ce qui arrive à la faction lui dicte, au jour `jour` — par
     ordre de priorité : un raid subi récemment → se défendre ; la ruine → piller
     ses ennemis (bandits, cultes, caractère belliqueux) ou commercer ; la guerre
     → piller si elle est forte et agressive, sinon se défendre ; la paix et la
     richesse → s'étendre (explorer une fois le territoire au maximum) ; un ordre
     ou un culte en paix → convertir. Sinon, un des objectifs de son genre, qui
     change toutes les trois semaines (déterministe par graine). Fonction pure de
     l'état : rejouer les mêmes jours redonne les mêmes objectifs. */
  function objectifSelon(etat, f, jour, voisins) {
    var s = situationDe(etat, f, voisins), r = f.ressources;
    var raidRecent = (f.subis || []).some(function (j) { return jour >= j && jour - j <= MEMOIRE_RAID_JOURS; });
    if (raidRecent) return 'defendre';
    if (r.or < SEUIL_RUINE || r.nourriture < SEUIL_RUINE) {
      return (TYPES_PILLARDS[f.type] || f.caractere === 'belliqueux') && s.guerre + s.rivalite > 0 ? 'piller' : 'commercer';
    }
    if (s.guerre > 0) {
      return CARACTERES_AGRESSIFS[f.caractere] && r.or >= SEUIL_FORCE && r.nourriture >= SEUIL_FORCE ? 'piller' : 'defendre';
    }
    if (r.or >= SEUIL_RICHE_OR && r.nourriture >= SEUIL_RICHE_NOURRITURE) return f.territoire < TERRITOIRE_MAX ? 'etendre' : 'explorer';
    if (TYPES_PROSELYTES[f.type] && s.rivalite === 0) return 'convertir';
    var objs = (TYPES[f.type] && TYPES[f.type].objectifs) || f.objectifs || ['defendre'];
    return objs[Math.floor(h01(etat.seed, f.id, 'objectif', Math.floor(jour / CYCLE_OBJECTIF_JOURS)) * objs.length) % objs.length];
  }
  function evoluerObjectif(etat, f, jour, voisins) {
    var nouveau = objectifSelon(etat, f, jour, voisins);
    if (nouveau === f.objectif) return false;
    f.objectif = nouveau;
    f.objectifDepuis = jour;
    annoncer(etat, f.nom + ' change d\'objectif : ' + (LIBELLES_OBJECTIF[nouveau] || nouveau) + '.', [f.id]);
    return true;
  }

  /* Un jour de jeu, toujours dans le même ordre : les actions de chaque faction
     (ordre des identifiants), ce que rapporte son territoire, la dérive des
     relations, puis l'évolution des objectifs selon ce qui est arrivé. */
  function tourUnJour(etat) {
    var jour = etat.jour;
    var ix = indexer(etat);
    var ids = ix.ids;
    ids.forEach(function (id) {
      var f = etat.factions.get(id);
      appliquerAction(etat, f, choisirAction(f, h01(etat.seed, id, 'action', jour)), jour, ix);
    });
    ids.forEach(function (id) { produire(etat.factions.get(id)); });
    // dérive des relations : chaque paire, indépendamment des autres (l'ordre ne
    // change donc pas l'état) ; les annonces suivent l'ordre des clés
    var hj = h32(etat.seed + '|derive|' + jour), changees = [];
    for (var k = 0; k < ix.cles.length; k++) {
      if (!ix.pnj[k]) continue;
      var hd = melange01(ix.base[k], hj);
      if (hd >= 0.04) continue;
      var avant = ECHELLE[ix.codes[k]], apres = hd < 0.02 ? degrader(avant) : ameliorer(avant);
      if (apres === avant || !deriveAutorisee(etat, ix.a[k], ix.b[k], avant, apres)) continue;
      etat.relations.set(ix.cles[k], apres);
      ix.codes[k] = codeRelation(apres);
      changees.push(k);
    }
    changees.sort(function (x, y) { return ix.cles[x] < ix.cles[y] ? -1 : 1; }).forEach(function (k2) {
      annoncer(etat, nomDe(etat, ix.a[k2]) + ' et ' + nomDe(etat, ix.b[k2]) + ' ' + (LIBELLES_RELATION[ECHELLE[ix.codes[k2]]] || 'changent de relation') + '.', [ix.a[k2], ix.b[k2]]);
    });
    ids.forEach(function (id) { evoluerObjectif(etat, etat.factions.get(id), jour, ix); });
    etat.jour = jour + 1;
  }
  /* Rattrape tous les jours manquants jusqu'à `jourCible` inclus, un par un,
     toujours dans le même ordre : que ce jour ait été simulé en direct ou
     rattrapé d'un coup après une longue absence, le résultat est identique
     (même graine, mêmes jours, même ordre de traitement). Jamais en arrière :
     un jour déjà simulé ne se rejoue pas. */
  function tourDuMonde(etat, jourCible) {
    var cible = Math.floor(jourCible || 0);
    while (etat.jour < cible) tourUnJour(etat);
    return etat;
  }

  /* Rattrapage borné : au plus `maxJours` jours simulés par appel (un jour de
     ≈ 340 factions coûte ≈ 20 ms ; un saut d'horloge de 365 jours bloquerait la
     boucle du serveur plus de 7 s s'il se rattrapait d'un coup). Le reste vient
     aux appels suivants, dans le même ordre : l'état final est identique à celui
     de tourDuMonde. Renvoie le nombre de jours simulés. */
  function rattraper(etat, jourCible, maxJours) {
    var cible = Math.floor(jourCible || 0), avant = etat.jour;
    tourDuMonde(etat, Math.min(cible, avant + Math.max(1, maxJours || 1)));
    return etat.jour - avant;
  }

  // ─── quêtes de faction (branchées sur les objectifs) ───────────────────
  var TYPES_QUETE = { etendre: 'explorer', commercer: 'livrer', defendre: 'eliminer',
    piller: 'eliminer', convertir: 'escorter', explorer: 'explorer' };
  function texteQuete(f, type) {
    switch (type) {
      case 'livrer': return f.nom + ' demande une livraison de vivres.';
      case 'escorter': return f.nom + ' cherche un garde pour une caravane.';
      case 'eliminer': return f.nom + ' veut voir un rival affaibli.';
      default: return f.nom + ' aimerait qu\'on explore les environs.';
    }
  }
  /* SPEC-QUETE-001 : seuil sous lequel une ressource de faction est jugée
     basse — en dessous, une quête de livraison peut se proposer ; au-dessus,
     jamais. */
  var SEUIL_RESSOURCE_BAS = 20;
  function ressourceCiblePourLivraison(f) {
    var basOr = f.ressources.or < SEUIL_RESSOURCE_BAS;
    var basNourriture = f.ressources.nourriture < SEUIL_RESSOURCE_BAS;
    if (!basOr && !basNourriture) return null;
    if (basOr && basNourriture) return f.ressources.or <= f.ressources.nourriture ? 'or' : 'nourriture';
    return basOr ? 'or' : 'nourriture';
  }
  /* SPEC-QUETE-002 : une élimination ne se propose que si la faction est
     réellement en guerre (relation 'guerre' active avec au moins une autre
     faction connue) — une simple rivalité ne suffit pas. */
  function enGuerreActive(etat, factionId) {
    var trouve = false;
    etat.relations.forEach(function (r, cle) {
      if (trouve || r !== 'guerre') return;
      var parts = cle.split('~');
      if (parts[0] === factionId || parts[1] === factionId) trouve = true;
    });
    return trouve;
  }
  function questesDe(etat, factionId) {
    var f = etat.factions.get(factionId);
    if (!f) return [];
    var semaine = Math.floor(etat.jour / 7);
    var h = h01(etat.seed, factionId, 'quete', semaine);
    var type = TYPES_QUETE[f.objectif] || 'explorer';
    if (type === 'livrer') {
      var ressource = ressourceCiblePourLivraison(f);
      if (!ressource) return []; // ressources au-dessus du seuil bas : rien à livrer
      return [{ id: factionId + ':quete:' + semaine, faction: factionId, type: type, ressource: ressource,
                titre: texteQuete(f, type), recompense: 5 + Math.floor(h * 20) }];
    }
    if (type === 'eliminer') {
      if (!enGuerreActive(etat, factionId)) return []; // hors guerre : aucune quête d'élimination
      var cible = ciblePourRaid(etat, f, etat.jour);
      if (!cible) return [];
      return [{ id: factionId + ':quete:' + semaine, faction: factionId, type: type, cible: cible.id,
                titre: texteQuete(f, type), recompense: 5 + Math.floor(h * 20) }];
    }
    return [{ id: factionId + ':quete:' + semaine, faction: factionId, type: type,
              titre: texteQuete(f, type), recompense: 5 + Math.floor(h * 20) }];
  }
  /* Réussite d'une quête de livraison (SPEC-QUETE-001) : relève le niveau de
     la ressource visée exactement du montant fourni, jamais au-delà du manque
     réel (recalculé au moment de la livraison, pas figé à la proposition). */
  function livrerQuete(etat, factionId, ressource, montant) {
    var f = etat.factions.get(factionId);
    if (!f || (ressource !== 'or' && ressource !== 'nourriture') || !(montant > 0)) return 0;
    var manque = Math.max(0, SEUIL_RESSOURCE_BAS - f.ressources[ressource]);
    var applique = Math.min(montant, manque);
    f.ressources[ressource] += applique;
    return applique;
  }
  /* Réussite d'une quête d'élimination (SPEC-QUETE-002) : même effet sur le
     territoire/la relation qu'un raid gagné (FACTION-016), sans le coût en
     ressources d'un raid (l'auteur est un aventurier, pas la faction elle-même).
     `cibleId` DOIT être la cible réellement promise par la quête (le champ
     `cible` renvoyé par questesDe au moment de la proposition) — jamais
     recalculée ici via ciblePourRaid, dont le résultat dépend du jour de
     résolution : rappeler ciblePourRaid avec le jour de résolution (au lieu
     du jour de proposition) peut désigner une AUTRE faction dès que 3
     factions ou plus sont candidates. On revalide seulement que cette cible
     est toujours une faction connue et toujours en guerre ou en rivalité
     avec l'auteur, pour ne pas appliquer un gain sur une relation apaisée
     entretemps. */
  function reussirQueteElimination(etat, factionId, cibleId) {
    var f = etat.factions.get(factionId);
    var cible = cibleId && etat.factions.get(cibleId);
    if (!f || !cible) return null;
    var relation = relationEntre(etat, f.id, cible.id);
    if (relation !== 'guerre' && relation !== 'rivalite') return null;
    appliquerGainElimination(etat, f, cible);
    annoncer(etat, f.nom + ' voit ' + cible.nom + ' affaibli par un aventurier.', [f.id, cible.id]);
    return cible.id;
  }
  function quetesActives(etat) {
    var out = [];
    Array.from(etat.factions.keys()).sort().forEach(function (id) { out = out.concat(questesDe(etat, id)); });
    return out;
  }

  // ─── SPEC-FACTION-014 : influence du territoire sur la zone de jeu ────────
  /* Le territoire consolidé d'une faction politique influence la zone de jeu
     qui le recouvre : une faction en guerre active y rend le terrain plus
     dangereux (pvp/pvp_pve), une faction en paix durable et au territoire
     bien établi y rend le terrain plus sûr (pve/sûre). `zones.js:zoneEn`
     applique ce résultat SEULEMENT quand aucune redéfinition d'administrateur
     n'est posée sur la région (priorité toujours à l'admin, SPEC-ZONE-004). */
  var SEUIL_TERRITOIRE_CONSOLIDE = 250;   // proche de TERRITOIRE_MAX (400) : bien établi
  function relationsPaisibles(etat, factionId) {
    var paisible = true;
    etat.relations.forEach(function (r, cle) {
      if (!paisible || (r !== 'guerre' && r !== 'rivalite')) return;
      var parts = cle.split('~');
      if (parts[0] === factionId || parts[1] === factionId) paisible = false;
    });
    return paisible;
  }
  /* La faction dont le territoire couvre (x, z), au plus proche (le plus
     petit territoire qui couvre encore le point, pour départager deux
     sièges dont les cercles se recoupent) — déterministe par id en cas
     d'égalité stricte. */
  function factionCouvrant(etat, x, z) {
    var meilleure = null;
    etat.factions.forEach(function (f) {
      var d = Math.hypot(f.siege.x - x, f.siege.z - z);
      if (d > f.territoire) return;
      if (!meilleure || f.territoire < meilleure.territoire ||
          (f.territoire === meilleure.territoire && f.id < meilleure.id)) meilleure = f;
    });
    return meilleure;
  }
  /* Zone suggérée par l'influence politique en (x, z), ou null si aucune
     faction n'y a d'influence marquée (repli sur la carte générée). */
  function influenceZone(etat, x, z) {
    var f = factionCouvrant(etat, x, z);
    if (!f) return null;
    if (enGuerreActive(etat, f.id)) {
      return f.territoire >= SEUIL_TERRITOIRE_CONSOLIDE ? 'pvp' : 'pvp_pve';
    }
    if (relationsPaisibles(etat, f.id)) {
      return f.territoire >= SEUIL_TERRITOIRE_CONSOLIDE ? 'sure' : 'pve';
    }
    return null;
  }

  // ─── SPEC-TRANSPORT-005 : péage sur une route de commerce ─────────────────
  /* Une route de type commerce (ROUTE-002) qui traverse le territoire d'une
     faction politique EN PAIX (donc jamais en guerre active — TRANSPORT-003
     prévaut alors : la caravane risque une attaque, pas un péage) prélève un
     péage borné en émeraudes sur le véhicule qui l'emprunte, versé aux
     ressources de cette faction. Le montant croît avec le territoire (une
     faction mieux établie tient mieux sa route), toujours entre PEAGE_MIN et
     PEAGE_MAX — jamais de quoi ruiner un joueur pour un simple passage. */
  var PEAGE_MIN = 1, PEAGE_MAX = 5, PEAGE_PAR_TERRITOIRE = 80;
  function peageDe(f) {
    if (!f) return 0;
    return Math.max(PEAGE_MIN, Math.min(PEAGE_MAX, Math.round(f.territoire / PEAGE_PAR_TERRITOIRE) || PEAGE_MIN));
  }
  /* `role` : le type de route emprunté (seul 'commerce' est taxé, ROUTE-002) ;
     (x, z) : le point du tronçon où le joueur se trouve. Renvoie
     { factionId, montant } si un péage s'applique ici, sinon null — hors de
     tout territoire, ou territoire d'une faction en guerre active (dont la
     caravane/le joueur risque déjà une attaque, TRANSPORT-003). */
  function peageSegment(etat, role, x, z) {
    if (role !== 'commerce') return null;
    var f = factionCouvrant(etat, x, z);
    if (!f || enGuerreActive(etat, f.id)) return null;
    var montant = peageDe(f);
    return montant > 0 ? { factionId: f.id, montant: montant } : null;
  }
  /* Verse le péage aux ressources de la faction (f.ressources.or) — le
     joueur, lui, est débité par l'appelant (server.js/game.js, seuls à
     connaître son inventaire réel). Renvoie le montant réellement versé (0
     si la faction n'existe plus, ou si `montant` n'est pas positif). */
  function appliquerPeage(etat, factionId, montant) {
    var f = etat.factions.get(factionId);
    if (!f || !(montant > 0)) return 0;
    f.ressources.or += montant;
    return montant;
  }

  // ─── SPEC-FACTION-015 : embargo commercial entre factions en guerre ───────
  /* Étend FACTION-003 (un camp de créatures ferme son commerce à un joueur
     hostile) aux factions POLITIQUES et aux factions de joueurs qui leur
     sont alliées (SPEC-FACTION-017 : `factionJoueurId` désigne la faction de
     joueurs par laquelle l'appelant a résolu l'appartenance — jamais
     recalculée ici, cette résolution reste hors de politique.js). Offres
     rouvertes dès que la relation change (guerre → rivalité/neutre/alliance) :
     rien n'est mémorisé, l'état courant seul décide. */
  function commerceFermeAvec(etat, factionId, factionJoueurId) {
    if (!factionJoueurId) return false;
    return relationEntre(etat, factionId, factionJoueurId) === 'guerre';
  }
  function offresAutorisees(etat, factionId, factionJoueurId, offres) {
    if (commerceFermeAvec(etat, factionId, factionJoueurId)) return [];
    return (offres || []).slice();
  }

  // ─── SPEC-QUETE-004 : tableau de quêtes actives par joueur ────────────────
  /* `tableau` : une Map joueurId -> [quête…]. Le serveur (ou la partie solo)
     est seul arbitre : accepterQuete/remettreQuete sont les deux SEULES
     portes d'entrée qui font foi — un client ne décide jamais localement
     qu'une quête est acceptée ou remise, il ne fait que le PROPOSER, ce que
     le serveur confirme ou refuse. */
  function accepterQuete(tableau, joueurId, quete) {
    if (!quete || !quete.id) return { ok: false, motif: 'quete_invalide' };
    var l = tableau.get(joueurId) || [];
    if (l.some(function (q) { return q.id === quete.id; })) return { ok: false, motif: 'deja_acceptee' };
    var q = {}, k;
    for (k in quete) q[k] = quete[k];
    q.statut = 'active';
    l.push(q);
    tableau.set(joueurId, l);
    return { ok: true, quete: q };
  }
  function quetesActivesDeJoueur(tableau, joueurId) { return (tableau.get(joueurId) || []).slice(); }
  /* La remise : un seul appel réussit — un second appel (double clic, deux
     clients du même compte, ou une simple relecture du même message réseau)
     ne retrouve plus de quête 'active' à cet id et échoue proprement, sans
     jamais verser la récompense deux fois. */
  function remettreQuete(tableau, joueurId, queteId, recompenseReelle) {
    var l = tableau.get(joueurId) || [], q = null, i;
    for (i = 0; i < l.length; i++) { if (l[i].id === queteId && l[i].statut === 'active') { q = l[i]; break; } }
    if (!q) return { ok: false, motif: 'introuvable' };
    q.statut = 'remise';
    q.recompenseVersee = recompenseReelle !== undefined ? recompenseReelle : q.recompense;
    return { ok: true, quete: q };
  }
  function serialiserQuetes(tableau) { return Array.from(tableau.entries()); }
  function chargerQuetes(data) { return new Map(data || []); }

  // ─── SPEC-QUETE-005 : récompense au coût réel de l'objectif ───────────────
  /* Remplace la formule arbitraire `5 + hasard*20` de `questesDe` (qui ne
     sert plus qu'à AFFICHER une estimation à la proposition) par le coût réel
     de ce qui est demandé, calculé au moment de la remise :
       - livraison : le prix courant réel (SPEC-ECO-001, `MC.Economie.prixCourant`)
         du lot demandé, via `opts.economie`/`opts.lieuEco`/`opts.offre` —
         fournis par l'appelant (server.js/game.js), qui seul connaît l'état
         économique et sait convertir 'or'/'nourriture' en objet d'inventaire ;
       - élimination : une fraction du territoire de la cible, la vraie
         mesure de ce qu'elle représentait pour l'auteur du raid (FACTION-016
         retire 15 à la cible pour un raid classique — la même échelle sert
         ici de référence) ;
       - reconstruction (ENV-001/004, QUETE-003) : proportionnelle aux dégâts
         mesurés (`quete.degats`, un compte de blocs), portés par l'appelant. */
  function recompenseReelle(etat, quete, opts) {
    opts = opts || {};
    if (quete.type === 'livrer' && opts.economie && opts.objetId != null && MC.Economie) {
      var lieuId = opts.lieuId || quete.faction;
      var prix = MC.Economie.prixCourant(opts.economie, lieuId, { give: [{ id: opts.objetId, n: opts.montant || 8 }], get: null });
      // `prixCourant` attend une offre give/get ; la ressource livrée vaut
      // toujours ce qu'elle rapporterait à la vente — le côté get importe peu.
      return Math.max(1, Math.round(Math.abs(prix)));
    }
    if (quete.type === 'eliminer') {
      var cible = etat.factions.get(quete.cible);
      if (cible) return Math.max(1, Math.round(cible.territoire * 0.5));
    }
    if ((quete.type === 'reconstruction' || quete.type === 'secours') && quete.degats) {
      return Math.max(3, Math.round(quete.degats * (opts.valeurParBloc || 0.5)));
    }
    return quete.recompense;   // repli : rien de mieux à calculer, on garde l'estimation d'origine
  }

  // ─── jugement du joueur (et de ses factions) par réputation ────────────
  /* Même principe que MC.Factions.creerReputations, mais keyé par faction
     politique : un même « suivi » peut représenter la réputation d'un joueur
     seul ou celle de sa faction de joueurs, au choix de l'appelant. */
  function creerReputations(etat) {
    var val = {};
    function get(id) { return val[id] === undefined ? 0 : val[id]; }
    function modifier(id, d) {
      if (!etat.factions.has(id)) return 0;
      val[id] = Math.max(-100, Math.min(100, get(id) + d));
      return val[id];
    }
    function statut(id) { var v = get(id); return v <= -30 ? 'hostile' : v >= 30 ? 'allie' : 'neutre'; }
    return {
      get: get, modifier: modifier, statut: statut,
      serialiser: function () { return Object.assign({}, val); },
      charger: function (o) { val = {}; if (o) Object.keys(o).forEach(function (k) { val[k] = o[k]; }); },
    };
  }

  // ─── état et persistance ────────────────────────────────────────────────
  function creer(seed) { return { seed: seed || 0, jour: 0, factions: new Map(), relations: new Map(), annonces: [] }; }
  function serialiser(etat) {
    return {
      v: 1, seed: etat.seed, jour: etat.jour,
      factions: Array.from(etat.factions.entries()),
      relations: Array.from(etat.relations.entries()),
      annonces: etat.annonces,
    };
  }
  function charger(data) {
    var etat = creer(data && data.seed);
    if (!data || data.v !== 1) return etat;
    etat.jour = data.jour || 0;
    etat.factions = new Map(data.factions || []);
    etat.relations = new Map(data.relations || []);
    etat.annonces = data.annonces || [];
    return etat;
  }

  // ─── état réseau (SPEC-SYNC-024) : complet au join, puis par différences ──
  /* Le message POLITIQUE doit rester borné : les relations PNJ↔PNJ croissent
     comme n² (≈ 41 000 paires pour ≈ 290 factions à 300 lieux). Forme
     COMPLÈTE (au join) : la liste des factions dans leur ordre de naissance
     (jamais supprimées : un indice est stable) et les relations PNJ↔PNJ en une
     chaîne dense, un caractère par paire (i < j, i croissant) — '0' guerre,
     '1' rivalité, '2' neutre, '3' alliance — plus les relations « externes »
     non neutres (faction de joueurs ↔ PNJ). Forme DIFFÉRENTIELLE (ensuite) :
     les seules factions nées et relations changées depuis le dernier envoi, en
     indices. Le client rebâtit un état au format de `creer` (Maps factions et
     relations, clés de `cleRelation`, la neutralité étant l'absence). */
  // SPEC-FACTION-006/007 : l'objectif et le territoire (qui évoluent) voyagent aussi
  function descReseau(f) { return [f.id, f.type, f.nom, f.caractere, f.objectif, f.territoire]; }
  function codeRelation(r) { var i = ECHELLE.indexOf(r); return i < 0 ? 2 : i; }
  function instantaneReseau(etat) {
    var ids = Array.from(etat.factions.keys()), n = ids.length, index = new Map();
    ids.forEach(function (id, i) { index.set(id, i); });
    var codes = new Uint8Array(n * (n - 1) / 2).fill(50);           // '2' : neutre par défaut
    var ext = [];
    function rang(i, j) { return i * n - i * (i + 1) / 2 + (j - i - 1); }
    etat.relations.forEach(function (r, cle) {
      if (r === 'neutre') return;                                       // déjà le défaut de la chaîne
      var t = cle.indexOf('~'), i = index.get(cle.slice(0, t)), j = index.get(cle.slice(t + 1));
      if (i === undefined || j === undefined) { ext.push([cle, r]); return; }
      if (i === j) return;
      codes[rang(Math.min(i, j), Math.max(i, j))] = 48 + codeRelation(r);
    });
    var rel = '';
    for (var k = 0; k < codes.length; k += 8192) rel += String.fromCharCode.apply(null, codes.subarray(k, k + 8192));
    return { complet: 1, jour: etat.jour, f: ids.map(function (id) { return descReseau(etat.factions.get(id)); }), rel: rel, ext: ext };
  }
  /* Suivi des changements, sans rien sérialiser quand rien ne change : les
     écritures dans etat.relations et les naissances dans etat.factions sont
     notées au fil de l'eau (Maps instrumentées). `prendre()` rend null (rien
     de neuf, coût constant), une différence, ou { complet: 1 } si les Maps ont
     été remplacées (rechargement) — l'appelant renvoie alors l'état complet. */
  function suivreReseau(etat) {
    var sales = new Set(), nouvelles = [], index = new Map(), ids = [], rels = null, facs = null, jourEnvoye = etat.jour;
    var vus = [];   // [objectif, territoire] envoyés, par indice (SPEC-FACTION-006/007)
    function vu(f) { return f.objectif + '|' + f.territoire; }
    function installer() {
      rels = etat.relations; facs = etat.factions;
      index.clear(); ids.length = 0; sales.clear(); nouvelles.length = 0; vus.length = 0;
      facs.forEach(function (f, id) { index.set(id, ids.length); ids.push(id); vus.push(vu(f)); });
      rels.set = function (k, v) { if (Map.prototype.get.call(rels, k) !== v) sales.add(k); return Map.prototype.set.call(rels, k, v); };
      rels.delete = function (k) { if (Map.prototype.has.call(rels, k)) sales.add(k); return Map.prototype.delete.call(rels, k); };
      facs.set = function (id, f) { if (!Map.prototype.has.call(facs, id)) nouvelles.push(id); return Map.prototype.set.call(facs, id, f); };
    }
    installer();
    return {
      prendre: function () {
        if (etat.relations !== rels || etat.factions !== facs) { installer(); jourEnvoye = etat.jour; return { complet: 1 }; }
        if (!sales.size && !nouvelles.length && etat.jour === jourEnvoye) return null;
        var d = { jour: etat.jour, f: [], rel: [], ext: [], maj: [] };
        /* objectifs et territoires ne changent qu'au fil des jours simulés : on ne
           les compare (une passe sur les factions) que quand le jour a avancé */
        if (etat.jour !== jourEnvoye) {
          for (var i = 0; i < ids.length; i++) {
            var fi = etat.factions.get(ids[i]);
            if (!fi) continue;
            var v = vu(fi);
            if (v !== vus[i]) { vus[i] = v; d.maj.push([i, fi.objectif, fi.territoire]); }
          }
        }
        nouvelles.forEach(function (id) {
          if (index.has(id)) return;
          index.set(id, ids.length); ids.push(id);
          var fn = etat.factions.get(id);
          vus.push(vu(fn));
          d.f.push(descReseau(fn));
        });
        sales.forEach(function (cle) {
          var p = cle.split('~'), i = index.get(p[0]), j = index.get(p[1]);
          var r = etat.relations.get(cle) || 'neutre';
          if (i === undefined || j === undefined) d.ext.push([cle, r]);
          else if (i !== j) d.rel.push([Math.min(i, j), Math.max(i, j), codeRelation(r)]);
        });
        sales.clear(); nouvelles.length = 0; jourEnvoye = etat.jour;
        return d;
      },
    };
  }
  /* Côté client : applique un message (complet ou différence) à l'état reçu
     jusque-là ; une différence sans état de départ est ignorée (null). */
  function appliquerReseau(etat, m) {
    if (!m || typeof m !== 'object') return etat || null;
    function poser(e, cle, r) { if (r === 'neutre') e.relations.delete(cle); else e.relations.set(cle, r); }
    function naitre(e, d) {
      if (!Array.isArray(d) || typeof d[0] !== 'string' || e.factions.has(d[0])) return;
      e.factions.set(d[0], { id: d[0], type: d[1], nom: d[2], caractere: d[3], objectif: d[4], territoire: typeof d[5] === 'number' ? d[5] : null });
      e.ids.push(d[0]);
    }
    var e = etat;
    if (m.complet) {
      e = creer(0); e.ids = [];
      (m.f || []).forEach(function (d) { naitre(e, d); });
      var n = e.ids.length, rel = typeof m.rel === 'string' ? m.rel : '', k = 0;
      for (var i = 0; i < n; i++) for (var j = i + 1; j < n; j++, k++) {
        var c = rel.charCodeAt(k) - 48;
        if (c >= 0 && c < ECHELLE.length && c !== 2) e.relations.set(cleRelation(e.ids[i], e.ids[j]), ECHELLE[c]);
      }
    } else if (!e) return null;
    else (m.f || []).forEach(function (d) { naitre(e, d); });
    if (typeof m.jour === 'number') e.jour = m.jour;
    if (!m.complet) (m.rel || []).forEach(function (t) {
      var a = e.ids[t[0]], b = e.ids[t[1]];
      if (a && b && ECHELLE[t[2]]) poser(e, cleRelation(a, b), ECHELLE[t[2]]);
    });
    // SPEC-FACTION-006/007 : objectif et territoire mis à jour
    if (!m.complet) (m.maj || []).forEach(function (t) {
      var f = Array.isArray(t) && e.factions.get(e.ids[t[0]]);
      if (!f) return;
      if (typeof t[1] === 'string' && LIBELLES_OBJECTIF[t[1]]) f.objectif = t[1];
      if (typeof t[2] === 'number' && isFinite(t[2])) f.territoire = t[2];
    });
    (m.ext || []).forEach(function (t) { if (Array.isArray(t) && typeof t[0] === 'string' && ECHELLE.indexOf(t[1]) >= 0) poser(e, t[0], t[1]); });
    return e;
  }

  /* Pour l'affichage (panneau des factions) : les relations non neutres de
     chaque faction, en une seule passe sur toutes les paires. */
  function resumeRelations(etat) {
    var out = new Map();
    function de(id) { var r = out.get(id); if (!r) out.set(id, r = { guerre: [], rivalite: [], alliance: [] }); return r; }
    etat.relations.forEach(function (r, cle) {
      if (r !== 'guerre' && r !== 'rivalite' && r !== 'alliance') return;
      var p = cle.split('~');
      de(p[0])[r].push(p[1]); de(p[1])[r].push(p[0]);
    });
    return out;
  }

  MC.Politique = {
    // SPEC-SYNC-024 : état réseau borné (complet au join, différences ensuite)
    instantaneReseau: instantaneReseau, suivreReseau: suivreReseau, appliquerReseau: appliquerReseau,
    resumeRelations: resumeRelations,
    TYPES: TYPES, CARACTERES: CARACTERES, ECHELLE: ECHELLE,
    creer: creer, decouvrir: decouvrir, tourDuMonde: tourDuMonde, rattraper: rattraper,
    relationEntre: relationEntre, questesDe: questesDe, quetesActives: quetesActives,
    livrerQuete: livrerQuete, reussirQueteElimination: reussirQueteElimination,
    creerReputations: creerReputations, serialiser: serialiser, charger: charger,
    // exposés pour les tests unitaires fins (déterminisme du hachage, naissance,
    // effets d'une action isolée sans passer par le tirage aléatoire du jour)
    naitreDe: naitreDe, h01: h01, appliquerAction: appliquerAction,
    ciblePourRaid: ciblePourRaid, SEUIL_RESSOURCE_BAS: SEUIL_RESSOURCE_BAS,
    COUT_ACTION_RESSOURCES: COUT_ACTION_RESSOURCES,
    appliquerGainAvantPoste: appliquerGainAvantPoste, appliquerGainElimination: appliquerGainElimination,
    enGuerreActive: enGuerreActive,
    // SPEC-FACTION-006 : objectifs qui évoluent ; SPEC-FACTION-007 : rondes visibles près des joueurs
    indexReconstructions: indexReconstructions, purgerGardesTombes: purgerGardesTombes, planifierGardes: planifierGardes, annoncesDepuis: annoncesDepuis, objectifSelon: objectifSelon, evoluerObjectif: evoluerObjectif,
    patrouillesVisibles: patrouillesVisibles, PATROUILLES_MAX: PATROUILLES_MAX, DUREE_PATROUILLE: DUREE_PATROUILLE, MEMOIRE_RAID_JOURS: MEMOIRE_RAID_JOURS,
    // SPEC-FACTION-014 : influence du territoire sur la zone de jeu (zones.js)
    influenceZone: influenceZone, factionCouvrant: factionCouvrant, SEUIL_TERRITOIRE_CONSOLIDE: SEUIL_TERRITOIRE_CONSOLIDE,
    // SPEC-FACTION-015 : embargo commercial entre factions en guerre
    commerceFermeAvec: commerceFermeAvec, offresAutorisees: offresAutorisees,
    // SPEC-QUETE-004 : tableau de quêtes actives par joueur
    accepterQuete: accepterQuete, quetesActivesDeJoueur: quetesActivesDeJoueur, remettreQuete: remettreQuete,
    serialiserQuetes: serialiserQuetes, chargerQuetes: chargerQuetes,
    // SPEC-QUETE-005 : récompense au coût réel
    recompenseReelle: recompenseReelle,
    // SPEC-TRANSPORT-005 : péage sur une route de commerce en territoire de faction
    peageDe: peageDe, peageSegment: peageSegment, appliquerPeage: appliquerPeage,
    PEAGE_MIN: PEAGE_MIN, PEAGE_MAX: PEAGE_MAX,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
