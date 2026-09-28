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
  /* Gain d'un avant-poste réussi (SPEC-FACTION-016) : factorisé pour être
     rejoué à l'identique par un donjon rattaché vaincu (SPEC-DONJON-018,
     donjons.js:victoireGardien) sans dupliquer le calcul de territoire. */
  function appliquerGainAvantPoste(f) {
    f.territoire = Math.min(TERRITOIRE_MAX, f.territoire + 10);
  }
  function appliquerAction(etat, f, action, jour) {
    if (action === 'caravane') { f.ressources.or += 1; annoncer(etat, f.nom + ' envoie une caravane commerciale.', [f.id]); return; }
    if (action === 'avant_poste') {
      prelever(f, COUT_ACTION_RESSOURCES);
      var hap = h01(etat.seed, f.id, 'avant_poste', jour);
      if (hap < 0.5) {
        appliquerGainAvantPoste(f);
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
      var parts = cle.split('~');
      // même garde que ciblePourRaid : une clé impliquant une faction absente
      // de etat.factions (ex. une faction de joueurs posée par guildes.js via
      // declarerRelation, SPEC-FACTION-017) n'est ni dérivée ni annoncée ici —
      // etat.relations sert aussi de mémoire à ce genre de relation externe.
      if (!etat.factions.has(parts[0]) || !etat.factions.has(parts[1])) return;
      var hd = h01(etat.seed, cle, 'derive', jour);
      if (hd >= 0.04) return;
      var avant = etat.relations.get(cle), apres = hd < 0.02 ? degrader(avant) : ameliorer(avant);
      if (apres === avant) return;
      etat.relations.set(cle, apres);
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
    appliquerGainAvantPoste: appliquerGainAvantPoste, appliquerGainElimination: appliquerGainElimination,
    enGuerreActive: enGuerreActive,
    // SPEC-FACTION-014 : influence du territoire sur la zone de jeu (zones.js)
    influenceZone: influenceZone, factionCouvrant: factionCouvrant, SEUIL_TERRITOIRE_CONSOLIDE: SEUIL_TERRITOIRE_CONSOLIDE,
    // SPEC-FACTION-015 : embargo commercial entre factions en guerre
    commerceFermeAvec: commerceFermeAvec, offresAutorisees: offresAutorisees,
    // SPEC-QUETE-004 : tableau de quêtes actives par joueur
    accepterQuete: accepterQuete, quetesActivesDeJoueur: quetesActivesDeJoueur, remettreQuete: remettreQuete,
    serialiserQuetes: serialiserQuetes, chargerQuetes: chargerQuetes,
    // SPEC-QUETE-005 : récompense au coût réel
    recompenseReelle: recompenseReelle,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
