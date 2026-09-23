/* recits.js — les récits procéduraux : d'autres histoires que « La Couronne
   des Saisons », bâties depuis une graine plutôt qu'écrites à la main.
   Logique pure, même contrat que histoire.js : le jeu SIGNALE ce qui se
   passe, le moteur renvoie des notifications à annoncer.

   Trois archétypes :
     - epopee  : l'histoire existante (MC.Histoire), simplement liée aux
                 lieux qu'on lui fournit ;
     - enquete : un crime, des suspects, des indices, une accusation ;
     - colonie : fonder un établissement, attirer des habitants, tenir
                 face aux vagues, surmonter un revers.

   `lieux` : un tableau de lieux au format de habitats.lieuxProches (id,
   kind, nom, x, z, h0, batiments[], pnjs[]). Rien n'est lu du monde lui-même
   — tout part de ce tableau et de la graine, ce qui rend chaque récit
   entièrement déterministe. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core, H = MC.Histoire;
  var B = C.B, I = C.I;

  var ARCHETYPES = {
    epopee: { nom: 'La Couronne des Saisons',
              description: "Une quête classique : des Gemmes volées, un traître, un Roi Sans Visage." },
    enquete: { nom: 'Enquête au village',
               description: "Un crime a été commis : interrogez les suspects, réunissez les indices, désignez le coupable." },
    colonie: { nom: 'Fonder une colonie',
               description: "Bâtissez un établissement, attirez des habitants, tenez face aux vagues et à un revers de fortune." },
  };

  // ─── outils communs ────────────────────────────────────────────────────────
  function premier(lieux, kinds) {
    for (var i = 0; i < lieux.length; i++) if (kinds.indexOf(lieux[i].kind) >= 0) return lieux[i];
    return null;
  }
  // mélange déterministe (Fisher-Yates) piloté par le bruit à graine
  function melange(liste, N, sel) {
    var l = liste.slice();
    for (var i = l.length - 1; i > 0; i--) {
      var j = Math.floor(N.hash2(sel * 131 + i * 7, i * 977 - sel) * (i + 1));
      var t = l[i]; l[i] = l[j]; l[j] = t;
    }
    return l;
  }
  function choisirParmi(liste, N, sel) {
    if (!liste.length) return null;
    return liste[Math.floor(N.hash2(sel * 7 + 3, sel * 11 - 5) * liste.length) % liste.length];
  }
  function noter(e, texte) { e.journal.push(texte); if (e.journal.length > 60) e.journal.shift(); }
  function compte(ctx, ids) {
    var n = 0;
    if (!ctx || !ctx.compter) return 0;
    ids.forEach(function (id) { n += ctx.compter(id); });
    return n;
  }
  function nomRole(role) {
    var r = MC.Habitats && MC.Habitats.ROLES && MC.Habitats.ROLES[role];
    return r ? r.nom : role;
  }

  // ═══════════════════════════════ ÉPOPÉE ═══════════════════════════════════
  /* Relie l'épopée existante (La Couronne des Saisons) aux lieux fournis :
     mêmes règles que MC.Histoire.lier, mais sans dépendre d'un monde vivant —
     seulement du tableau `lieux`. Les donjons ne sont pas connus ici : les
     étapes qui en dépendent sautent simplement, comme le prévoit histoire.js
     quand un lien manque. */
  function lierEpopee(lieux) {
    var liens = {};
    var village = premier(lieux, ['village']) || premier(lieux, ['ville']);
    if (village) liens.depart = { id: village.id, nom: village.nom, x: village.x, z: village.z, h: village.h0, kind: 'lieu' };
    var ville = lieux.filter(function (l) { return l.kind === 'ville' && (!village || l.id !== village.id); })[0];
    if (ville) liens.ville = { id: ville.id, nom: ville.nom, x: ville.x, z: ville.z, h: ville.h0, kind: 'lieu' };
    var ermite = lieux.filter(function (l) { return l.kind === 'maison'; })[0];
    if (ermite) liens.ermite = { id: ermite.id, nom: ermite.nom, x: ermite.x, z: ermite.z, h: ermite.h0, kind: 'lieu' };
    return liens;
  }

  // ═══════════════════════════════ ENQUÊTE ══════════════════════════════════
  var CRIMES = {
    vol_tresor: { nom: 'Le vol du trésor',
      texte: "Le trésor du village a disparu du coffre commun, cette nuit même. La communauté exige des réponses." },
    disparition: { nom: 'La disparition',
      texte: "Un habitant s'est volatilisé sans laisser de trace. On chuchote qu'il ne s'agit pas d'une simple fugue." },
    empoisonnement: { nom: "L'empoisonnement",
      texte: "Un habitant a été retrouvé malade, victime d'un poison versé dans son repas. Quelqu'un lui en voulait." },
  };
  var ORDRE_CRIMES = ['vol_tresor', 'disparition', 'empoisonnement'];
  var MOBILES = ['la jalousie', 'une dette de jeu', 'une vieille rancune', "l'appât du gain",
                 'un secret à cacher', 'la vengeance', "l'ambition déçue", "la peur d'être démasqué"];
  var HEURES = ["à l'aube", 'en matinée', 'à midi', "l'après-midi", 'au crépuscule', 'en pleine nuit'];
  var OBJETS_INDICES = [I.EMERALD, I.GOLD_INGOT, I.BONE, I.DIAMOND, I.CARTE];
  var REBONDISSEMENTS_ENQUETE = {
    second_crime: { titre: 'Un second crime', texte: "Un nouvel incident sème le trouble : le coupable frappe-t-il encore ?" },
    faux_coupable: { titre: 'Un faux coupable', texte: "Des villageois accusent à tort un innocent ; mieux vaut rester rigoureux." },
    fuite: { titre: 'Une fuite', texte: 'Le principal suspect tente de quitter discrètement le village !' },
  };
  var ORDRE_REBONDISSEMENTS_ENQUETE = ['second_crime', 'faux_coupable', 'fuite'];

  function genererEnquete(graine, lieux, params) {
    lieux = lieux || [];
    var N = MC.makeNoise(((graine | 0) ^ 0x51e971e) >>> 0);
    var depart = premier(lieux, ['village', 'ville']) || lieux[0] || null;
    var pnjs = [];
    lieux.forEach(function (l) { (l.pnjs || []).forEach(function (p) { pnjs.push({ id: p.id, nom: p.nom, role: p.role, lieu: l.id }); }); });

    var crime = choisirParmi(ORDRE_CRIMES, N, 1) || ORDRE_CRIMES[0];
    var melanges = melange(pnjs, N, 2);
    var nSuspects = Math.max(1, Math.min(6, Math.min(melanges.length, 4 + Math.floor(N.hash2(3, 5) * 3))));
    var suspects = melanges.slice(0, nSuspects).map(function (p, i) {
      var lieuAlibi = choisirParmi(lieux, N, 17 + i) || depart;
      return {
        id: p.id, nom: p.nom, role: p.role,
        alibi: { lieu: lieuAlibi ? lieuAlibi.id : null, lieuNom: lieuAlibi ? lieuAlibi.nom : 'ailleurs',
                 heure: choisirParmi(HEURES, N, 23 + i) },
        mobile: choisirParmi(MOBILES, N, 41 + i),
      };
    });
    var coupable = suspects.length ? suspects[Math.floor(N.hash2(101, 103) * suspects.length) % suspects.length] : null;

    // indices : témoignages (parler à un pnj précis), objets (à trouver dans l'inventaire)
    var temoins = melange(pnjs, N, 71).slice(0, 4);
    var indices = [], idx = 0;
    temoins.forEach(function (p) {
      indices.push({ id: 'temoin' + (idx++), type: 'temoignage', pnj: p.id, nom: p.nom,
        texte: 'Interrogez ' + p.nom + '.', obtenu: false });
    });
    var nObjets = 2 + Math.floor(N.hash2(83, 89) * 2); // 2 ou 3
    for (var i = 0; i < nObjets; i++) {
      var oid = choisirParmi(OBJETS_INDICES, N, 97 + i);
      indices.push({ id: 'objet' + i, type: 'objet', objet: oid,
        texte: 'Retrouvez ' + C.nameOf(oid).toLowerCase() + ' abandonné sur la scène.', obtenu: false });
    }
    // au moins un pnj de plus pour garantir 5 indices minimum
    while (indices.length < 5 && pnjs.length) {
      var extra = pnjs[indices.length % pnjs.length];
      indices.push({ id: 'temoin' + (idx++), type: 'temoignage', pnj: extra.id, nom: extra.nom,
        texte: 'Interrogez ' + extra.nom + '.', obtenu: false });
    }
    if (indices.length >= 2) {
      indices.push({ id: 'contradiction0', type: 'contradiction', a: indices[0].id, b: indices[1].id,
        texte: 'Recoupez deux témoignages qui se contredisent.', obtenu: false });
    }
    indices = indices.slice(0, 8);

    var rebondissement = choisirParmi(ORDRE_REBONDISSEMENTS_ENQUETE, N, 191) || ORDRE_REBONDISSEMENTS_ENQUETE[0];

    return {
      params: params || {},
      depart: depart ? { id: depart.id, nom: depart.nom, x: depart.x, z: depart.z } : null,
      crime: crime, suspects: suspects, coupableId: coupable ? coupable.id : null,
      indices: indices, rebondissement: rebondissement,
      chapitres: ['crime', 'enquete', 'rebondissement', 'accusation'],
      chap: 0, commence: false, accusation: null, fin: null, journal: [],
    };
  }

  function nombreObtenus(q) { return q.indices.filter(function (ind) { return ind.obtenu; }).length; }
  function indiceParId(q, id) { for (var i = 0; i < q.indices.length; i++) if (q.indices[i].id === id) return q.indices[i]; return null; }
  function suspectParId(q, id) { for (var i = 0; i < q.suspects.length; i++) if (q.suspects[i].id === id) return q.suspects[i]; return null; }

  function commencerEnquete(q) {
    if (q.commence) return [];
    q.commence = true;
    var c = CRIMES[q.crime];
    var n = [{ type: 'chapitre', titre: c.nom, texte: c.texte }];
    noter(q, 'Chapitre : ' + c.nom);
    // le crime n'a pas d'objectif propre : on entre directement dans l'enquête
    q.chap = 1;
    n.push({ type: 'chapitre', titre: "L'enquête", texte: 'Interrogez les suspects, fouillez les lieux, recoupez les témoignages.' });
    noter(q, "Chapitre : L'enquête");
    return n;
  }

  function signalerEnquete(q, ev, ctx) {
    if (q.fin || !q.commence) return [];
    var n = [];
    // les indices se trouvent à tout moment de l'enquête
    q.indices.forEach(function (ind) {
      if (ind.obtenu || ind.type === 'contradiction') return;
      var ok = false;
      if (ind.type === 'temoignage' && ev.type === 'parler' && ev.pnj === ind.pnj) ok = true;
      else if (ind.type === 'objet' && ev.type === 'inventaire' && compte(ctx, [ind.objet]) >= 1) ok = true;
      if (ok) {
        ind.obtenu = true;
        noter(q, 'Indice : ' + ind.texte);
        n.push({ type: 'info', texte: 'Indice découvert : ' + ind.texte });
      }
    });
    // une contradiction se révèle quand les deux témoignages qu'elle recoupe sont obtenus
    q.indices.forEach(function (ind) {
      if (ind.obtenu || ind.type !== 'contradiction') return;
      var a = indiceParId(q, ind.a), b = indiceParId(q, ind.b);
      if (a && a.obtenu && b && b.obtenu) {
        ind.obtenu = true;
        noter(q, 'Indice : ' + ind.texte);
        n.push({ type: 'info', texte: 'Indice découvert : ' + ind.texte });
      }
    });
    if (q.chap === 1) {
      // un seul indice suffit à faire naître un soupçon et pousser l'enquête
      // vers l'accusation : c'est la quantité d'indices RÉUNIS À CE MOMENT-LÀ
      // (pas un seuil de complétion) qui pèsera ensuite sur le verdict.
      if (nombreObtenus(q) >= 1) {
        var reb = REBONDISSEMENTS_ENQUETE[q.rebondissement];
        n.push({ type: 'chapitre', titre: 'Rebondissement', texte: reb.texte });
        n.push({ type: 'evenement', id: 'rebondissement_' + q.rebondissement, titre: reb.titre, texte: reb.texte, apparitions: [], pres: 'joueur' });
        noter(q, 'Rebondissement : ' + reb.titre);
        q.chap = 3;
        n.push({ type: 'chapitre', titre: "L'accusation", texte: 'Le moment est venu de désigner le coupable.' });
        noter(q, "Chapitre : L'accusation");
      }
    }
    return n;
  }

  function choixEnAttenteEnquete(q) {
    if (q.fin || q.chap !== 3) return null;
    return { id: 'accusation', texte: 'Qui accusez-vous ?',
             options: q.suspects.map(function (s) { return { id: s.id, texte: s.nom + ' (' + nomRole(s.role) + ')' }; }) };
  }
  function choisirEnquete(q, id, option) {
    var ch = choixEnAttenteEnquete(q);
    if (!ch || ch.id !== id || !q.suspects.some(function (s) { return s.id === option; })) return [];
    q.accusation = option;
    var total = q.indices.length, ratio = total ? nombreObtenus(q) / total : 0;
    var correct = option === q.coupableId;
    var accuse = suspectParId(q, option), coupable = suspectParId(q, q.coupableId);
    var accuseNom = accuse ? accuse.nom : 'l\'accusé', coupableNom = coupable ? coupable.nom : 'le vrai coupable';
    var finId, f;
    if (correct && ratio >= 0.6) { finId = 'justice_rendue'; f = { titre: 'Justice rendue',
      texte: 'Les indices étaient accablants : ' + accuseNom + ' est bien coupable. Le village retrouve la paix.' }; }
    else if (correct) { finId = 'coupable_demasque_de_justesse'; f = { titre: 'Coupable démasqué de justesse',
      texte: accuseNom + " est confondu, mais l'enquête n'a tenu qu'à un fil de preuves." }; }
    else if (ratio < 0.3) { finId = 'coupable_echappe'; f = { titre: "Le coupable s'échappe",
      texte: "Faute de preuves, personne n'est vraiment inquiété. " + coupableNom + ' disparaît sans laisser de trace.' }; }
    else { finId = 'erreur_judiciaire'; f = { titre: 'Erreur judiciaire',
      texte: accuseNom + ' est condamné à tort ; le vrai coupable, ' + coupableNom + ', reste libre, tapi dans l\'ombre.' }; }
    q.fin = finId;
    noter(q, 'Fin : ' + f.titre);
    return [{ type: 'fin', id: finId, titre: f.titre, texte: f.texte }];
  }

  function objectifEnquete(q) {
    if (q.fin) return null;
    var total = q.chapitres.length;
    if (q.chap === 1) return { chapitre: "L'enquête", numero: 2, total: total, texte: 'Réunissez des indices.',
      progres: nombreObtenus(q), n: q.indices.length,
      cible: q.depart ? { x: q.depart.x, z: q.depart.z, nom: q.depart.nom } : undefined };
    if (q.chap === 3) return { chapitre: "L'accusation", numero: 4, total: total, texte: 'Désignez le coupable.' };
    return { chapitre: 'Le crime', numero: 1, total: total, texte: "L'enquête commence." };
  }
  function quetesActivesEnquete(q) {
    return q.indices.map(function (ind) { return { id: ind.id, titre: ind.texte, texte: ind.texte, etat: ind.obtenu ? 'faite' : 'active' }; });
  }

  // ═══════════════════════════════ COLONIE ══════════════════════════════════
  function choseAPoserListe() {
    return [
      { id: 'feu', bloc: B.TORCH, n: 1, texte: 'Allumez un feu de camp.' },
      { id: 'abri', bloc: B.PLANKS, n: 8, texte: 'Bâtissez un abri de planches.' },
      { id: 'ferme', bloc: B.FARMLAND, n: 4, texte: 'Labourez une ferme.' },
      { id: 'puits', bloc: B.WATER, n: 1, texte: 'Creusez un puits.' },
    ];
  }
  var VAGUES_COLONIE = [
    { id: 'vague1', types: ['pillager', 'vindicator'], n: 5, titre: 'Une première vague',
      texte: 'Des pillards attaquent la colonie naissante !', apparitions: [{ type: 'pillager', n: 3 }, { type: 'vindicator', n: 2 }] },
    { id: 'vague2', types: ['zombie', 'skeleton'], n: 6, titre: "Une nuit d'assaut",
      texte: 'Des morts-vivants encerclent la colonie !', apparitions: [{ type: 'zombie', n: 4 }, { type: 'skeleton', n: 2 }] },
  ];
  var REBONDISSEMENTS_COLONIE = {
    tempete: { titre: 'La tempête', texte: 'Une tempête furieuse s\'abat sur la colonie, menaçant toit et récoltes.' },
    famine: { titre: 'La famine', texte: 'Les réserves s\'amenuisent : la faim guette la colonie.' },
    deserteurs: { titre: 'Les déserteurs', texte: 'Découragés, certains habitants songent à partir.' },
  };
  var ORDRE_REBONDISSEMENTS_COLONIE = ['tempete', 'famine', 'deserteurs'];

  function genererColonie(graine, lieux, params) {
    lieux = lieux || [];
    params = params || {};
    var N = MC.makeNoise(((graine | 0) ^ 0x2c01e) >>> 0);
    var proche = premier(lieux, ['village', 'ville', 'maison']);
    var centre = { x: params.x !== undefined ? params.x : (proche ? proche.x : 0),
                   z: params.z !== undefined ? params.z : (proche ? proche.z : 0) };
    var cible = Math.max(3, Math.min(10, params.population || (4 + Math.floor(N.hash2(2, 3) * 5))));
    var rebondissement = choisirParmi(ORDRE_REBONDISSEMENTS_COLONIE, N, 41) || ORDRE_REBONDISSEMENTS_COLONIE[0];
    return {
      params: params, centre: centre, cibleHabitants: cible,
      batiments: choseAPoserListe(), poses: {}, population: 0, habitantsVus: {},
      vagues: VAGUES_COLONIE, vaguesRepoussees: {},
      rebondissement: rebondissement, rebondissementSurmonte: false,
      chapitres: ['fondation', 'population', 'vagues', 'rebondissement', 'bilan'],
      chap: 0, etapePose: 0, etapeVague: 0, debutChap: null, commence: false, mort: false, fin: null, journal: [],
    };
  }

  /* Chaque étape de la colonie a un délai : au-delà, on avance quand même,
     avec ce qui a été accompli — une colonie qui traîne ne reste pas figée
     éternellement, elle stagne, et la fin s'en ressentira. */
  var DELAI_CHAPITRE_COLONIE = 400;
  var DELAI_SURVIE_COLONIE = 50;
  function forcerAvancerChapitre(c) {
    var n = [];
    if (c.chap === 0) {
      c.chap = 1; c.debutChap = null;
      n.push({ type: 'chapitre', titre: 'Attirer des habitants', texte: 'Le temps presse : il faut déjà penser à attirer des habitants.' });
      noter(c, 'Chapitre : Attirer des habitants (délai dépassé)');
    } else if (c.chap === 1) {
      c.chap = 2; c.etapeVague = 0; c.debutChap = null;
      n.push({ type: 'chapitre', titre: 'Les vagues', texte: 'La prospérité attire aussi les convoitises...' });
      noter(c, 'Chapitre : Les vagues (délai dépassé)');
      n = n.concat(declencherVague(c.vagues[0]));
    } else if (c.chap === 2) {
      c.chap = 3; c.debutChap = null;
      var reb = REBONDISSEMENTS_COLONIE[c.rebondissement];
      n.push({ type: 'chapitre', titre: 'Rebondissement', texte: reb.texte });
      n.push({ type: 'evenement', id: 'colonie_' + c.rebondissement, titre: reb.titre, texte: reb.texte, apparitions: [], pres: 'joueur' });
      noter(c, 'Rebondissement : ' + reb.titre + ' (délai dépassé)');
    } else if (c.chap === 3) {
      c.rebondissementSurmonte = false;
      c.chap = 4;
      n.push({ type: 'chapitre', titre: 'Bilan', texte: "La colonie a traversé bien des épreuves. L'heure est au bilan." });
      n = n.concat(terminerColonie(c));
    }
    return n;
  }

  function declencherVague(v) {
    if (!v) return [];
    return [{ type: 'evenement', id: v.id, titre: v.titre, texte: v.texte, apparitions: v.apparitions, pres: 'joueur' }];
  }

  function commencerColonie(c) {
    if (c.commence) return [];
    c.commence = true;
    var n = [{ type: 'chapitre', titre: 'Fondation', texte: "Il est temps de fonder un établissement." }];
    noter(c, 'Chapitre : Fondation');
    return n;
  }

  function signalerColonie(c, ev, ctx) {
    if (c.fin || !c.commence) return [];
    var n = [];
    if (ev.type === 'mort') { c.mort = true; return n.concat(terminerColonie(c)); }
    if (ev.type === 'habitants') c.population = Math.max(c.population, ev.n || 0);
    if (ev.type === 'parler' && ev.pnj) {
      c.habitantsVus[ev.pnj] = true;
      c.population = Math.max(c.population, Object.keys(c.habitantsVus).length);
    }

    if (ev.type === 'temps') {
      if (c.debutChap === null) c.debutChap = ev.t;
      else if (c.chap < 4 && ev.t - c.debutChap > DELAI_CHAPITRE_COLONIE) {
        return n.concat(forcerAvancerChapitre(c));
      }
    }

    if (c.chap === 0) {
      var b = c.batiments[c.etapePose];
      if (b && ev.type === 'poser' && ev.bloc === b.bloc) {
        c.poses[b.id] = (c.poses[b.id] || 0) + 1;
        if (c.poses[b.id] >= b.n) {
          noter(c, 'Bâti : ' + b.texte);
          n.push({ type: 'etape', texte: 'Objectif accompli : ' + b.texte });
          c.etapePose++;
          if (c.etapePose >= c.batiments.length) {
            c.chap = 1; c.debutChap = null;
            n.push({ type: 'chapitre', titre: 'Attirer des habitants', texte: "La colonie est prête à accueillir ses premiers habitants." });
            noter(c, 'Chapitre : Attirer des habitants');
          }
        }
      }
    } else if (c.chap === 1) {
      if (c.population >= c.cibleHabitants) {
        c.chap = 2; c.etapeVague = 0; c.debutChap = null;
        n.push({ type: 'chapitre', titre: 'Les vagues', texte: 'La prospérité attire aussi les convoitises...' });
        noter(c, 'Chapitre : Les vagues');
        n = n.concat(declencherVague(c.vagues[0]));
      }
    } else if (c.chap === 2) {
      var v = c.vagues[c.etapeVague];
      if (v && ev.type === 'tuer' && v.types.indexOf(ev.mob) >= 0) {
        c.vaguesRepoussees[v.id] = (c.vaguesRepoussees[v.id] || 0) + 1;
        if (c.vaguesRepoussees[v.id] >= v.n) {
          noter(c, 'Vague repoussée : ' + v.titre);
          n.push({ type: 'etape', texte: 'Vague repoussée : ' + v.titre });
          c.etapeVague++;
          if (c.etapeVague >= c.vagues.length) {
            c.chap = 3; c.debutChap = null;
            var reb = REBONDISSEMENTS_COLONIE[c.rebondissement];
            n.push({ type: 'chapitre', titre: 'Rebondissement', texte: reb.texte });
            n.push({ type: 'evenement', id: 'colonie_' + c.rebondissement, titre: reb.titre, texte: reb.texte, apparitions: [], pres: 'joueur' });
            noter(c, 'Rebondissement : ' + reb.titre);
          } else {
            n = n.concat(declencherVague(c.vagues[c.etapeVague]));
          }
        }
      }
    } else if (c.chap === 3) {
      // le revers se surmonte en tenant un minimum de temps ; trop tôt, rien
      // ne se passe encore — trop tard (au-delà du délai général), le revers
      // l'aura emporté, et le passage plus haut aura déjà conclu l'histoire.
      if (ev.type === 'temps' && c.debutChap !== null && ev.t - c.debutChap >= DELAI_SURVIE_COLONIE) {
        c.rebondissementSurmonte = true;
        c.chap = 4;
        n.push({ type: 'chapitre', titre: 'Bilan', texte: "La colonie a traversé bien des épreuves. L'heure est au bilan." });
        n = n.concat(terminerColonie(c));
      }
    }
    return n;
  }

  function terminerColonie(c) {
    if (c.fin) return [];
    if (c.mort) {
      c.fin = 'colonie_orpheline';
      var fm = { titre: 'La colonie orpheline', texte: "Le fondateur n'a pas survécu. La colonie, livrée à elle-même, périclite lentement." };
      noter(c, 'Fin : ' + fm.titre);
      return [{ type: 'fin', id: c.fin, titre: fm.titre, texte: fm.texte }];
    }
    var vaguesOk = c.vagues.filter(function (v) { return (c.vaguesRepoussees[v.id] || 0) >= v.n; }).length;
    var score = c.etapePose * 2 + c.population + vaguesOk * 3 + (c.rebondissementSurmonte ? 2 : 0);
    var finId, f;
    if (score >= 20) { finId = 'cite_florissante'; f = { titre: 'Cité florissante',
      texte: 'La colonie prospère au-delà de toute espérance : marchés animés, remparts solides, une population heureuse.' }; }
    else if (score >= 12) { finId = 'hameau_prospere'; f = { titre: 'Hameau prospère',
      texte: 'Le hameau vit paisiblement, à l\'abri du besoin.' }; }
    else if (score >= 5) { finId = 'colonie_qui_survit'; f = { titre: 'Une colonie qui survit',
      texte: "Modeste mais tenace, la colonie tient bon, un jour après l'autre." }; }
    else { finId = 'colonie_abandonnee'; f = { titre: 'Colonie abandonnée',
      texte: 'Trop peu de bras, trop de dangers : le projet est abandonné, et la nature reprend ses droits.' }; }
    c.fin = finId;
    noter(c, 'Fin : ' + f.titre);
    return [{ type: 'fin', id: finId, titre: f.titre, texte: f.texte }];
  }

  function objectifColonie(c) {
    if (c.fin) return null;
    var total = c.chapitres.length;
    if (c.chap === 0) {
      var b = c.batiments[c.etapePose];
      if (!b) return null;
      return { chapitre: 'Fondation', numero: 1, total: total, texte: b.texte, progres: c.poses[b.id] || 0, n: b.n,
               cible: { x: c.centre.x, z: c.centre.z, nom: 'le campement' } };
    }
    if (c.chap === 1) return { chapitre: 'Attirer des habitants', numero: 2, total: total,
      texte: 'Attirez des habitants dans la colonie.', progres: c.population, n: c.cibleHabitants };
    if (c.chap === 2) {
      var v = c.vagues[c.etapeVague];
      if (!v) return null;
      return { chapitre: 'Les vagues', numero: 3, total: total, texte: v.titre, progres: c.vaguesRepoussees[v.id] || 0, n: v.n };
    }
    if (c.chap === 3) return { chapitre: 'Rebondissement', numero: 4, total: total, texte: 'Tenez bon face à l\'épreuve.' };
    return null;
  }
  function quetesActivesColonie(c) {
    var l = [];
    c.batiments.forEach(function (b) { l.push({ id: b.id, titre: b.texte, texte: b.texte, etat: (c.poses[b.id] || 0) >= b.n ? 'faite' : 'active' }); });
    c.vagues.forEach(function (v) { l.push({ id: v.id, titre: v.titre, texte: v.texte, etat: (c.vaguesRepoussees[v.id] || 0) >= v.n ? 'faite' : 'active' }); });
    return l;
  }

  // ═══════════════════════════ interface commune ════════════════════════════
  function generer(archetype, graine, lieux, params) {
    lieux = lieux || [];
    if (archetype === 'epopee') {
      var liens = lierEpopee(lieux);
      var peut = params && params.peut;
      return { archetype: 'epopee', histoire: H.creer(params, liens, peut) };
    }
    if (archetype === 'enquete') return { archetype: 'enquete', enquete: genererEnquete(graine, lieux, params) };
    if (archetype === 'colonie') return { archetype: 'colonie', colonie: genererColonie(graine, lieux, params) };
    throw new Error('Recits.generer : archétype inconnu : ' + archetype);
  }

  function commencer(etat) {
    if (etat.archetype === 'epopee') return H.commencer(etat.histoire);
    if (etat.archetype === 'enquete') return commencerEnquete(etat.enquete);
    if (etat.archetype === 'colonie') return commencerColonie(etat.colonie);
    return [];
  }
  function signaler(etat, evenement, ctx) {
    if (etat.archetype === 'epopee') return H.signaler(etat.histoire, evenement, ctx);
    if (etat.archetype === 'enquete') return signalerEnquete(etat.enquete, evenement, ctx);
    if (etat.archetype === 'colonie') return signalerColonie(etat.colonie, evenement, ctx);
    return [];
  }
  function choixEnAttente(etat) {
    if (etat.archetype === 'epopee') return H.choixEnAttente(etat.histoire);
    if (etat.archetype === 'enquete') return choixEnAttenteEnquete(etat.enquete);
    return null;
  }
  function choisir(etat, id, option) {
    if (etat.archetype === 'epopee') return H.choisir(etat.histoire, id, option);
    if (etat.archetype === 'enquete') return choisirEnquete(etat.enquete, id, option);
    return [];
  }
  function objectif(etat) {
    if (etat.archetype === 'epopee') return H.objectif(etat.histoire);
    if (etat.archetype === 'enquete') return objectifEnquete(etat.enquete);
    if (etat.archetype === 'colonie') return objectifColonie(etat.colonie);
    return null;
  }
  function quetesActives(etat) {
    if (etat.archetype === 'epopee') return H.quetesActives(etat.histoire);
    if (etat.archetype === 'enquete') return quetesActivesEnquete(etat.enquete);
    if (etat.archetype === 'colonie') return quetesActivesColonie(etat.colonie);
    return [];
  }
  function serialiser(etat) {
    if (etat.archetype === 'epopee') return { archetype: 'epopee', histoire: H.serialiser(etat.histoire) };
    if (etat.archetype === 'enquete') return { archetype: 'enquete', enquete: etat.enquete };
    if (etat.archetype === 'colonie') return { archetype: 'colonie', colonie: etat.colonie };
    return etat;
  }
  function charger(donnees, peut) {
    if (donnees.archetype === 'epopee') return { archetype: 'epopee', histoire: H.charger(donnees.histoire, peut) };
    if (donnees.archetype === 'enquete') return { archetype: 'enquete', enquete: donnees.enquete };
    if (donnees.archetype === 'colonie') return { archetype: 'colonie', colonie: donnees.colonie };
    return donnees;
  }

  MC.Recits = { ARCHETYPES: ARCHETYPES,
                generer: generer, commencer: commencer, signaler: signaler,
                choixEnAttente: choixEnAttente, choisir: choisir, objectif: objectif,
                quetesActives: quetesActives, serialiser: serialiser, charger: charger };
})(typeof globalThis !== 'undefined' ? globalThis : this);
