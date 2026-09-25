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

  // ─── annonces (chat) ─────────────────────────────────────────────────────
  var ANNONCES_MAX = 200;
  function annoncer(etat, texte, factions) {
    etat.annonces.push({ jour: etat.jour, texte: texte, factions: factions || [] });
    if (etat.annonces.length > ANNONCES_MAX) etat.annonces.shift();
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
  var ACTIONS_PAR_OBJECTIF = {
    etendre: ['avant_poste', 'patrouille', 'rien'],
    commercer: ['caravane', 'rien'],
    defendre: ['patrouille', 'rien'],
    piller: ['raid', 'rien'],
    convertir: ['caravane', 'rien'],
    explorer: ['patrouille', 'rien'],
  };
  function choisirAction(f, hAction) {
    var opts = ACTIONS_PAR_OBJECTIF[f.objectif] || ['rien'];
    var seuil = f.caractere === 'belliqueux' || f.caractere === 'fanatique' ? 0.6
              : f.caractere === 'pacifique' ? 0.25 : 0.4;
    if (hAction > seuil) return 'rien';
    return opts[Math.floor((hAction / seuil) * opts.length) % opts.length];
  }
  function ciblePourRaid(etat, f, jour) {
    var candidats = [];
    etat.relations.forEach(function (r, cle) {
      if (r !== 'guerre' && r !== 'rivalite') return;
      var parts = cle.split('~');
      var autreId = parts[0] === f.id ? parts[1] : parts[1] === f.id ? parts[0] : null;
      if (autreId && etat.factions.has(autreId)) candidats.push(autreId);
    });
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
  function appliquerAction(etat, f, action, jour) {
    if (action === 'caravane') { f.ressources.or += 1; annoncer(etat, f.nom + ' envoie une caravane commerciale.', [f.id]); return; }
    if (action === 'avant_poste') {
      prelever(f, COUT_ACTION_RESSOURCES);
      var hap = h01(etat.seed, f.id, 'avant_poste', jour);
      if (hap < 0.5) {
        f.territoire = Math.min(TERRITOIRE_MAX, f.territoire + 10);
        annoncer(etat, f.nom + ' fonde un avant-poste et étend son territoire.', [f.id]);
      } else {
        annoncer(etat, f.nom + ' tente de fonder un avant-poste, sans succès.', [f.id]);
      }
      return;
    }
    if (action === 'raid') {
      var cible = ciblePourRaid(etat, f, jour);
      if (!cible) return;
      prelever(f, COUT_ACTION_RESSOURCES);
      var h = h01(etat.seed, f.id, cible.id, 'raid', jour);
      if (h < 0.5) {
        appliquerGainElimination(etat, f, cible);
        annoncer(etat, f.nom + ' mène un raid contre ' + cible.nom + ' et gagne du terrain.', [f.id, cible.id]);
      } else {
        annoncer(etat, f.nom + ' échoue à raider ' + cible.nom + '.', [f.id, cible.id]);
      }
    }
    // 'patrouille' et 'rien' : discrets, pas d'annonce (sans quoi le chat déborderait)
  }
  /* Effet d'une élimination réussie (raid classique ou quête SPEC-QUETE-002) :
     factorisé pour que les deux voies produisent EXACTEMENT le même résultat
     sur le territoire et la relation, à graine égale. */
  function appliquerGainElimination(etat, f, cible) {
    f.territoire = Math.min(TERRITOIRE_MAX, f.territoire + 15);
    cible.territoire = Math.max(TERRITOIRE_MIN, cible.territoire - 15);
    etat.relations.set(cleRelation(f.id, cible.id), 'guerre');
  }

  function tourUnJour(etat) {
    var jour = etat.jour;
    Array.from(etat.factions.keys()).sort().forEach(function (id) {
      var f = etat.factions.get(id);
      appliquerAction(etat, f, choisirAction(f, h01(etat.seed, id, 'action', jour)), jour);
    });
    Array.from(etat.relations.keys()).sort().forEach(function (cle) {
      var hd = h01(etat.seed, cle, 'derive', jour);
      if (hd >= 0.04) return;
      var avant = etat.relations.get(cle), apres = hd < 0.02 ? degrader(avant) : ameliorer(avant);
      if (apres === avant) return;
      etat.relations.set(cle, apres);
      var parts = cle.split('~');
      annoncer(etat, nomDe(etat, parts[0]) + ' et ' + nomDe(etat, parts[1]) + ' ' + (LIBELLES_RELATION[apres] || 'changent de relation') + '.', parts);
    });
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
     ressources d'un raid (l'auteur est un aventurier, pas la faction elle-même). */
  function reussirQueteElimination(etat, factionId, jour) {
    var f = etat.factions.get(factionId);
    if (!f) return null;
    var cible = ciblePourRaid(etat, f, jour === undefined ? etat.jour : jour);
    if (!cible) return null;
    appliquerGainElimination(etat, f, cible);
    annoncer(etat, f.nom + ' voit ' + cible.nom + ' affaibli par un aventurier.', [f.id, cible.id]);
    return cible.id;
  }
  function quetesActives(etat) {
    var out = [];
    Array.from(etat.factions.keys()).sort().forEach(function (id) { out = out.concat(questesDe(etat, id)); });
    return out;
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

  MC.Politique = {
    TYPES: TYPES, CARACTERES: CARACTERES, ECHELLE: ECHELLE,
    creer: creer, decouvrir: decouvrir, tourDuMonde: tourDuMonde,
    relationEntre: relationEntre, questesDe: questesDe, quetesActives: quetesActives,
    livrerQuete: livrerQuete, reussirQueteElimination: reussirQueteElimination,
    creerReputations: creerReputations, serialiser: serialiser, charger: charger,
    // exposés pour les tests unitaires fins (déterminisme du hachage, naissance,
    // effets d'une action isolée sans passer par le tirage aléatoire du jour)
    naitreDe: naitreDe, h01: h01, appliquerAction: appliquerAction,
    ciblePourRaid: ciblePourRaid, SEUIL_RESSOURCE_BAS: SEUIL_RESSOURCE_BAS,
    COUT_ACTION_RESSOURCES: COUT_ACTION_RESSOURCES,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
