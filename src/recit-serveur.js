/* recit-serveur.js — le récit (mode histoire) côté SERVEUR, logique pure
   (chantier ARCHI, lot P-HIST, SPEC-ARCHI-041).

   Le serveur est l'arbitre : il tient, pour CHAQUE joueur, l'état du récit
   (MC.Recits : archétype, chapitre, étape, drapeaux, quêtes), le fait avancer à
   partir des évènements de jeu qu'il arbitre lui-même (poser, tuer, parler,
   position…), et n'envoie au client que des annonces (dialogues, objectifs) et
   une vue de l'état. Ce module ne connaît ni socket ni entité : server.js lui
   passe des observations et applique les effets qu'il renvoie (récompenses,
   objets repris, apparitions). Le client, lui, ne fait qu'afficher et répondre.

   Règle réseau : un récit PAR JOUEUR (clé de registre du joueur nommé) ; chacun
   avance à son rythme dans le même monde, lié aux mêmes lieux. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var JOURNAL_ENVOYE = 12;      // entrées de journal envoyées au client (il n'en affiche pas plus)
  var PORTEE_PARLER = 6;        // blocs : distance maximale pour parler à un habitant

  /* Paramètres d'histoire complets : MC.Histoire.parametres + l'archétype et les
     interactions brutes (que parametres() ne connaît pas). */
  function parametres(o) {
    var p = MC.Histoire.parametres(o);
    p.archetype = (o && MC.Recits.ARCHETYPES[o.archetype]) ? o.archetype : 'epopee';
    p.interactions = o && o.interactions;
    return p;
  }
  function interne(etat) { return etat && (etat.histoire || etat.enquete || etat.colonie); }
  function fin(etat) { var i = interne(etat); return i ? i.fin : null; }
  // le lieu où le héros s'éveille, selon l'archétype
  function pointDepart(etat) {
    if (!etat) return null;
    if (etat.archetype === 'epopee') return etat.histoire.liens.depart || null;
    if (etat.archetype === 'enquete') return etat.enquete.depart || null;
    if (etat.archetype === 'colonie') return etat.colonie.centre || null;
    return null;
  }

  /* Crée le récit d'un joueur. `liens` : les liens d'épopée déjà calculés pour
     le monde (leur recherche est coûteuse), sinon calculés ici. Renvoie
     { etat, liens }. */
  function creer(o) {
    var params = parametres(o.params);
    var pos = o.pos || { x: 0, z: 0 };
    var etat, liens = o.liens || null;
    if (params.archetype === 'epopee') {
      if (!liens) liens = MC.Histoire.lier(o.monde, pos.x, pos.z);
      etat = { archetype: 'epopee', histoire: MC.Histoire.creer(params, liens, o.peut) };
    } else {
      var lieux = o.monde.habitats ? o.monde.habitats.lieuxProches(pos.x, pos.z, 2500) : [];
      etat = MC.Recits.generer(params.archetype, o.graine, lieux, params);
    }
    return { etat: etat, liens: liens };
  }

  function signaler(etat, ev, ctx) {
    if (!etat || fin(etat)) return [];
    return MC.Recits.signaler(etat, ev, ctx);
  }

  function stats(etat) {
    var i = interne(etat);
    if (!i) return '';
    var chap = Math.min(i.chap + 1, i.chapitres.length) + '/' + i.chapitres.length;
    return etat.archetype === 'epopee'
      ? 'Quêtes secondaires : ' + i.secondairesFaites + '/' + i.secondairesPrevues + ' · Chapitres : ' + chap
      : 'Chapitres : ' + chap;
  }

  /* Sépare les notifications du moteur de récit en : annonces pour le client,
     et effets à appliquer par le serveur (il fait foi sur l'inventaire et le
     monde). */
  function classer(etat, notifs) {
    var out = { client: [], recompenses: [], prises: [], apparitions: [], fin: null };
    (notifs || []).forEach(function (n) {
      switch (n.type) {
        case 'chapitre': case 'dialogue':
          out.client.push({ type: n.type, titre: n.titre, texte: n.texte }); break;
        case 'evenement':
          out.client.push({ type: 'evenement', id: n.id, titre: n.titre, texte: n.texte });
          if (n.apparitions && n.apparitions.length) out.apparitions.push({ id: n.id, pres: n.pres, apparitions: n.apparitions });
          break;
        case 'etape': case 'quete': case 'info': case 'echec':
          out.client.push({ type: n.type, texte: n.texte }); break;
        case 'recompense':
          out.recompenses = out.recompenses.concat(n.objets);
          out.client.push({ type: 'recompense', objets: n.objets.map(function (o) { return { id: o.id, n: o.n }; }) });
          break;
        case 'prendre': out.prises.push({ objets: n.objets, parmi: n.parmi || null }); break;
        case 'fin': {
          var arche = MC.Recits.ARCHETYPES[etat.archetype];
          var f = { type: 'fin', id: n.id, titre: n.titre, texte: n.texte, stats: stats(etat), recit: arche ? arche.nom : '' };
          out.client.push(f);
          out.fin = f;
          break;
        }
      }
    });
    return out;
  }

  /* L'état envoyé au client (HISTOIRE_ETAT.etat) : le récit sérialisé, journal
     rogné, et l'annonce de fin si le récit est achevé. */
  function vue(etat, finNotif) {
    var copie = JSON.parse(JSON.stringify(MC.Recits.serialiser(etat)));
    var i = interne(copie);
    if (i && i.journal && i.journal.length > JOURNAL_ENVOYE) i.journal = i.journal.slice(-JOURNAL_ENVOYE);
    return { recit: copie, fin: finNotif || null };
  }
  // forme persistée dans le fichier de monde : le récit COMPLET + l'annonce de fin
  function exporter(etat, finNotif) { return { recit: MC.Recits.serialiser(etat), fin: finNotif || null }; }
  function importer(d, peut) {
    if (!d || typeof d !== 'object') return null;
    // ancien format solo (MC.Recits.serialiser tel quel, ou MC.Histoire.serialiser d'avant les archétypes)
    var brut = d.recit && typeof d.recit === 'object' ? d.recit : d;
    var finNotif = d.recit ? (d.fin || null) : null;
    try {
      if (!brut.archetype) brut = { archetype: 'epopee', histoire: brut };
      if (!MC.Recits.ARCHETYPES[brut.archetype]) return null;
      var inner = brut[brut.archetype === 'epopee' ? 'histoire' : brut.archetype];
      if (!inner || typeof inner !== 'object' || !Array.isArray(inner.chapitres) || !inner.params) return null;
      return { etat: MC.Recits.charger(brut, peut), fin: finNotif };
    } catch (e) { return null; }
  }

  /* Parler à un habitant pendant le récit. Renvoie
     { notifs, proposition|null, libre } : `proposition` = quête secondaire
     offerte (le client répond oui/non), `libre` = le récit ne prend pas la
     parole, le client ouvre le commerce. */
  function parler(etat, regles, ent, ctx, t) {
    var role = ent.role || 'habitant';
    var R0 = MC.Habitats.ROLES[role] || MC.Habitats.ROLES.habitant;
    var nom = R0.nom + (ent.nom ? ' — ' + ent.nom : '');
    var res = { notifs: [], proposition: null, libre: false };
    if (!etat || fin(etat)) { res.libre = true; return res; }
    var n1 = signaler(etat, { type: 'parler', role: role, lieu: ent.lieu, pnj: ent.pnj, nom: nom, t: t }, ctx);
    res.notifs = n1;
    if (n1.some(function (n) { return n.type === 'dialogue' || n.type === 'info' || n.type === 'etape'; })) return res;
    if (etat.archetype === 'epopee') {
      var H = MC.Histoire, he = etat.histoire;
      var n2 = H.rendreQuete(he, role, ctx);
      res.notifs = n1.concat(n2);
      if (n2.some(function (n) { return n.type === 'quete'; })) return res;
      var q = H.queteProposee(he, role);
      if (q) { res.proposition = { id: 'quete:' + q.id, titre: q.titre, texte: q.texte + ' — « ' + q.titre + ' »', nom: nom }; return res; }
      if (n2.length) return res;
    }
    if (regles && regles.commerce === false) {
      res.notifs = res.notifs.concat([{ type: 'dialogue', titre: nom, texte: R0.repliques[(ent.eid || 0) % R0.repliques.length] }]);
      return res;
    }
    res.libre = true;
    return res;
  }

  /* Le choix narratif actuellement posé, ou null. */
  function choixPose(etat) { return etat && !fin(etat) ? MC.Recits.choixEnAttente(etat) : null; }

  /* Réponse du joueur : à une quête proposée (`attente` = { id }) ou au choix
     narratif en attente. Tout est revérifié contre l'état : un identifiant
     périmé ou rejoué ne fait rien. Renvoie { ok, notifs }. */
  function repondre(etat, attente, id, option) {
    if (!etat || fin(etat)) return { ok: false, notifs: [] };
    if (attente && attente.id === id) {
      if (etat.archetype !== 'epopee') return { ok: false, notifs: [] };
      var qid = id.slice('quete:'.length);
      var H = MC.Histoire, q = H.queteProposee(etat.histoire, attente.role);
      if (!q || q.id !== qid) return { ok: false, notifs: [] };
      if (option === 'oui' && H.accepter(etat.histoire, qid)) return { ok: true, notifs: [{ type: 'quete', texte: 'Quête acceptée : ' + q.titre }] };
      return { ok: option === 'non', notifs: [] };
    }
    var c = MC.Recits.choixEnAttente(etat);
    if (!c || c.id !== id || !c.options.some(function (o) { return o.id === option; })) return { ok: false, notifs: [] };
    var n = MC.Recits.choisir(etat, id, option);
    return { ok: true, notifs: n };
  }

  /* Deux fois par seconde : où le joueur est, ce qu'il porte, l'heure, le ciel.
     `obs` = { pos:{x,z}, biome, nuit, meteo, t, lieu (id d'un lieu qu'il vient
     d'entrer, ou null), habitants (colonie) }. `ctx` compte l'inventaire. */
  function sonder(etat, obs, ctx) {
    var n = [];
    function s(ev, c) { ev.t = obs.t; n = n.concat(signaler(etat, ev, c)); }
    if (!etat || fin(etat)) return n;
    if (obs.lieu) s({ type: 'lieu', id: obs.lieu });
    s({ type: 'position', x: obs.pos.x, z: obs.pos.z });
    s({ type: 'biome', id: obs.biome });
    s({ type: 'inventaire' }, ctx);
    s({ type: 'temps', nuit: !!obs.nuit });
    if (obs.meteo) s({ type: 'meteo', meteo: obs.meteo });
    if (etat.archetype === 'colonie' && obs.habitants !== null && obs.habitants !== undefined) s({ type: 'habitants', n: obs.habitants });
    return n;
  }

  MC.RecitServeur = {
    JOURNAL_ENVOYE: JOURNAL_ENVOYE, PORTEE_PARLER: PORTEE_PARLER,
    parametres: parametres, interne: interne, fin: fin, pointDepart: pointDepart,
    creer: creer, signaler: signaler, classer: classer, stats: stats,
    vue: vue, exporter: exporter, importer: importer,
    parler: parler, choixPose: choixPose, repondre: repondre, sonder: sonder,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
