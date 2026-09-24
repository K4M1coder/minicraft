/* guildes.js — factions de joueurs (SPEC-FACTION-009 à 013). Logique pure :
   ni socket ni DOM — server.js (et le jeu solo, pour la sauvegarde hors ligne)
   s'en servent comme branchement, comme pour admin.js.

   Un joueur (identifié par son nom, comme partout ailleurs dans le jeu) peut
   appartenir à plusieurs factions : au plus une PRINCIPALE (celle qui compte
   pour la diplomatie et s'affiche avec son nom), et zéro ou plusieurs
   secondaires. Chaque faction a un chef, des rangs (chef, officier, membre,
   recrue), une diplomatie propre (alliée/neutre/ennemie) envers d'autres
   factions — de joueurs comme PNJ (MC.Politique) — et se dissout dès qu'elle
   n'a plus aucun membre. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var RANGS = ['recrue', 'membre', 'officier', 'chef'];
  function rangIndex(r) { var i = RANGS.indexOf(r); return i < 0 ? 0 : i; }
  function canon(nom) { return String(nom || '').trim().toLowerCase(); }

  // ─── état ────────────────────────────────────────────────────────────────
  function creerEtat() {
    return {
      factions: new Map(),      // id -> faction
      joueurs: new Map(),       // joueurId -> { principale: id|null, secondaires: Set }
      invitations: new Map(),   // factionId -> Set(joueurId)
      prochainId: 1,
    };
  }
  function joueurDe(etat, joueurId) {
    var j = etat.joueurs.get(joueurId);
    if (!j) { j = { principale: null, secondaires: new Set() }; etat.joueurs.set(joueurId, j); }
    return j;
  }
  function nomPris(etat, nom, ignorerId) {
    var c = canon(nom), pris = false;
    etat.factions.forEach(function (f, id) { if (id !== ignorerId && canon(f.nom) === c) pris = true; });
    return pris;
  }

  // ─── création (SPEC-FACTION-009) ───────────────────────────────────────
  function creerFaction(etat, joueurId, opts) {
    opts = opts || {};
    var nom = String(opts.nom || '').trim();
    if (!nom) return { ok: false, motif: 'nom_invalide' };
    if (nomPris(etat, nom)) return { ok: false, motif: 'nom_pris' };
    var id = 'g' + (etat.prochainId++);
    var f = {
      id: id, nom: nom, couleur: opts.couleur || '#8888ff', emblem: opts.emblem || null,
      devise: opts.devise || '', membres: new Map(), candidatures: new Set(),
      relations: new Map(), creeLe: opts.heure || 0,
    };
    f.membres.set(joueurId, 'chef');
    etat.factions.set(id, f);
    var j = joueurDe(etat, joueurId);
    if (!j.principale) j.principale = id; else j.secondaires.add(id);
    return { ok: true, id: id };
  }

  function dissoudre(etat, factionId) {
    var f = etat.factions.get(factionId);
    if (!f) return { ok: false, motif: 'introuvable' };
    f.membres.forEach(function (r, id) {
      var j = etat.joueurs.get(id);
      if (j) { if (j.principale === factionId) j.principale = null; j.secondaires.delete(factionId); }
    });
    etat.factions.delete(factionId);
    etat.invitations.delete(factionId);
    etat.factions.forEach(function (autre) { autre.relations.delete(factionId); });
    return { ok: true };
  }

  // ─── rangs et hiérarchie ────────────────────────────────────────────────
  function rangDeF(f, joueurId) { return f.membres.get(joueurId) || null; }
  /* API publique : par état + identifiant de faction, comme le reste du
     module (jamais un objet faction interne, que l'appelant ne détient pas). */
  function rangDe(etat, factionId, joueurId) {
    var f = etat.factions.get(factionId);
    return f ? rangDeF(f, joueurId) : null;
  }
  function estMembre(etat, joueurId, factionId) {
    var f = etat.factions.get(factionId); return !!(f && f.membres.has(joueurId));
  }
  function peutGerer(f, actorId) { var r = rangDeF(f, actorId); return r === 'chef' || r === 'officier'; }

  /* Le chef nomme n'importe quel rang (sauf « chef » : voir `transmettre`) ;
     un officier ne peut que promouvoir/rétrograder membre ↔ recrue, jamais
     toucher au chef ni à un autre officier. */
  function nommerRang(etat, actorId, factionId, cibleId, rang) {
    var f = etat.factions.get(factionId);
    if (!f) return { ok: false, motif: 'introuvable' };
    if (!f.membres.has(cibleId)) return { ok: false, motif: 'pas_membre' };
    if (rang === 'chef') return { ok: false, motif: 'utiliser_transmettre' };
    if (RANGS.indexOf(rang) < 0) return { ok: false, motif: 'rang_invalide' };
    var rActor = rangDeF(f, actorId);
    if (rActor === 'chef') { f.membres.set(cibleId, rang); return { ok: true }; }
    if (rActor === 'officier' && rangIndex(rang) < rangIndex('officier') && rangDeF(f, cibleId) !== 'chef' && rangDeF(f, cibleId) !== 'officier') {
      f.membres.set(cibleId, rang); return { ok: true };
    }
    return { ok: false, motif: 'refuse' };
  }
  function promouvoir(etat, actorId, factionId, cibleId) {
    var f = etat.factions.get(factionId);
    if (!f || !f.membres.has(cibleId)) return { ok: false, motif: 'introuvable' };
    var cible = RANGS[Math.min(RANGS.length - 2, rangIndex(f.membres.get(cibleId)) + 1)];
    return nommerRang(etat, actorId, factionId, cibleId, cible);
  }
  function retrograder(etat, actorId, factionId, cibleId) {
    var f = etat.factions.get(factionId);
    if (!f || !f.membres.has(cibleId)) return { ok: false, motif: 'introuvable' };
    var cible = RANGS[Math.max(0, rangIndex(f.membres.get(cibleId)) - 1)];
    return nommerRang(etat, actorId, factionId, cibleId, cible);
  }
  function exclure(etat, actorId, factionId, cibleId) {
    var f = etat.factions.get(factionId);
    if (!f) return { ok: false, motif: 'introuvable' };
    if (!peutGerer(f, actorId)) return { ok: false, motif: 'refuse' };
    if (rangDeF(f, cibleId) === 'chef') return { ok: false, motif: 'chef_protege' };
    if (!f.membres.has(cibleId)) return { ok: false, motif: 'pas_membre' };
    return retirer(etat, cibleId, factionId);
  }
  function transmettre(etat, chefId, factionId, nouveauChefId) {
    var f = etat.factions.get(factionId);
    if (!f) return { ok: false, motif: 'introuvable' };
    if (rangDeF(f, chefId) !== 'chef') return { ok: false, motif: 'refuse' };
    if (!f.membres.has(nouveauChefId)) return { ok: false, motif: 'pas_membre' };
    f.membres.set(chefId, 'officier');
    f.membres.set(nouveauChefId, 'chef');
    return { ok: true };
  }

  // ─── candidatures, invitations, départ (SPEC-FACTION-010) ──────────────
  function rejoindre(etat, f, joueurId) {
    f.membres.set(joueurId, 'recrue');
    var j = joueurDe(etat, joueurId);
    if (!j.principale) j.principale = f.id; else j.secondaires.add(f.id);
  }
  function postuler(etat, joueurId, factionId) {
    var f = etat.factions.get(factionId);
    if (!f) return { ok: false, motif: 'introuvable' };
    if (f.membres.has(joueurId)) return { ok: false, motif: 'deja_membre' };
    f.candidatures.add(joueurId);
    return { ok: true };
  }
  function accepter(etat, actorId, factionId, joueurId) {
    var f = etat.factions.get(factionId);
    if (!f) return { ok: false, motif: 'introuvable' };
    if (!peutGerer(f, actorId)) return { ok: false, motif: 'refuse' };
    if (!f.candidatures.has(joueurId)) return { ok: false, motif: 'pas_candidat' };
    f.candidatures.delete(joueurId);
    rejoindre(etat, f, joueurId);
    return { ok: true };
  }
  function refuser(etat, actorId, factionId, joueurId) {
    var f = etat.factions.get(factionId);
    if (!f) return { ok: false, motif: 'introuvable' };
    if (!peutGerer(f, actorId)) return { ok: false, motif: 'refuse' };
    f.candidatures.delete(joueurId);
    return { ok: true };
  }
  function inviter(etat, actorId, factionId, joueurId) {
    var f = etat.factions.get(factionId);
    if (!f) return { ok: false, motif: 'introuvable' };
    if (!peutGerer(f, actorId)) return { ok: false, motif: 'refuse' };
    if (f.membres.has(joueurId)) return { ok: false, motif: 'deja_membre' };
    var s = etat.invitations.get(factionId);
    if (!s) { s = new Set(); etat.invitations.set(factionId, s); }
    s.add(joueurId);
    return { ok: true };
  }
  function accepterInvitation(etat, joueurId, factionId) {
    var f = etat.factions.get(factionId), s = etat.invitations.get(factionId);
    if (!f || !s || !s.has(joueurId)) return { ok: false, motif: 'pas_invite' };
    s.delete(joueurId);
    rejoindre(etat, f, joueurId);
    return { ok: true };
  }
  /* Retire un membre (départ volontaire ou exclusion). Une faction que plus
     personne n'occupe disparaît (SPEC-FACTION-009). Si c'était le chef qui
     partait et qu'il reste du monde, le rang le plus élevé restant hérite du
     commandement plutôt que de laisser la faction sans chef. */
  function retirer(etat, joueurId, factionId) {
    var f = etat.factions.get(factionId);
    if (!f || !f.membres.has(joueurId)) return { ok: false, motif: 'pas_membre' };
    var etaitChef = f.membres.get(joueurId) === 'chef';
    f.membres.delete(joueurId);
    var j = etat.joueurs.get(joueurId);
    if (j) { if (j.principale === factionId) j.principale = null; j.secondaires.delete(factionId); }
    if (f.membres.size === 0) { dissoudre(etat, factionId); return { ok: true, dissoute: true }; }
    if (etaitChef) {
      var succ = null, meilleur = -1;
      f.membres.forEach(function (r, id) { var ri = rangIndex(r); if (ri > meilleur) { meilleur = ri; succ = id; } });
      if (succ) f.membres.set(succ, 'chef');
    }
    return { ok: true };
  }
  function quitter(etat, joueurId, factionId) { return retirer(etat, joueurId, factionId); }

  // ─── principale / secondaires (SPEC-FACTION-011) ───────────────────────
  function factionsDe(etat, joueurId) {
    var j = etat.joueurs.get(joueurId);
    if (!j) return { principale: null, secondaires: [] };
    return { principale: j.principale, secondaires: Array.from(j.secondaires) };
  }
  function definirPrincipale(etat, joueurId, factionId) {
    var j = etat.joueurs.get(joueurId);
    if (!j) return { ok: false, motif: 'pas_membre' };
    if (j.principale === factionId) return { ok: true };
    if (!j.secondaires.has(factionId)) return { ok: false, motif: 'pas_membre' };
    j.secondaires.delete(factionId);
    if (j.principale) j.secondaires.add(j.principale);
    j.principale = factionId;
    return { ok: true };
  }

  // ─── diplomatie et dégâts (SPEC-FACTION-012) ───────────────────────────
  var RELATIONS_VALIDES = ['alliee', 'neutre', 'ennemie'];
  function declarerRelation(etat, actorId, factionId, cibleId, relation) {
    var f = etat.factions.get(factionId);
    if (!f) return { ok: false, motif: 'introuvable' };
    if (!peutGerer(f, actorId)) return { ok: false, motif: 'refuse' };
    if (RELATIONS_VALIDES.indexOf(relation) < 0) return { ok: false, motif: 'relation_invalide' };
    f.relations.set(cibleId, relation);
    return { ok: true };
  }
  function relationEnvers(etat, factionId, cibleId) {
    var f = etat.factions.get(factionId);
    return (f && f.relations.get(cibleId)) || 'neutre';
  }
  function membresDe(etat, factionId) {
    var f = etat.factions.get(factionId);
    return f ? Array.from(f.membres.keys()) : [];
  }
  function memeFaction(etat, a, b) {
    var ja = etat.joueurs.get(a), jb = etat.joueurs.get(b);
    if (!ja || !jb) return false;
    var fa = [ja.principale].concat(Array.from(ja.secondaires)).filter(Boolean);
    var fb = [jb.principale].concat(Array.from(jb.secondaires)).filter(Boolean);
    return fa.some(function (id) { return fb.indexOf(id) >= 0; });
  }
  /* Porte unique pour « pas de dégâts entre membres d'une même faction » :
     server.js (PvP/zones, branché ailleurs) l'appelle avant d'infliger des
     dégâts entre deux joueurs — c'est la SEULE chose que cette fonction
     décide ; elle ne juge pas de la diplomatie (alliée n'empêche pas les
     dégâts, seule l'appartenance commune protège). */
  function peutBlesser(etat, a, b) {
    if (a === b) return false;
    if (memeFaction(etat, a, b)) return false;
    return true;
  }

  // ─── persistance (SPEC-FACTION-013) ────────────────────────────────────
  function serialiser(etat) {
    return {
      v: 1, prochainId: etat.prochainId,
      factions: Array.from(etat.factions.entries()).map(function (e) {
        var f = e[1];
        return [e[0], {
          nom: f.nom, couleur: f.couleur, emblem: f.emblem, devise: f.devise, creeLe: f.creeLe,
          membres: Array.from(f.membres.entries()),
          candidatures: Array.from(f.candidatures),
          relations: Array.from(f.relations.entries()),
        }];
      }),
      joueurs: Array.from(etat.joueurs.entries()).map(function (e) {
        return [e[0], { principale: e[1].principale, secondaires: Array.from(e[1].secondaires) }];
      }),
      invitations: Array.from(etat.invitations.entries()).map(function (e) { return [e[0], Array.from(e[1])]; }),
    };
  }
  function charger(data) {
    var etat = creerEtat();
    if (!data || data.v !== 1) return etat;
    etat.prochainId = data.prochainId || 1;
    (data.factions || []).forEach(function (e) {
      var d = e[1];
      etat.factions.set(e[0], {
        id: e[0], nom: d.nom, couleur: d.couleur, emblem: d.emblem, devise: d.devise, creeLe: d.creeLe,
        membres: new Map(d.membres || []),
        candidatures: new Set(d.candidatures || []),
        relations: new Map(d.relations || []),
      });
    });
    (data.joueurs || []).forEach(function (e) {
      etat.joueurs.set(e[0], { principale: e[1].principale, secondaires: new Set(e[1].secondaires || []) });
    });
    (data.invitations || []).forEach(function (e) { etat.invitations.set(e[0], new Set(e[1] || [])); });
    return etat;
  }

  // ─── modération (SPEC-FACTION-013 / SPEC-ADMIN-008) ────────────────────
  /* Le contrôle du rôle (admin ou modérateur) se fait en amont, via
     MC.Admin.peutAgir — comme pour toute autre action d'administration :
     cette fonction applique, elle ne juge pas les rôles. */
  function renommerParAdmin(etat, factionId, nouveauNom) {
    var f = etat.factions.get(factionId);
    if (!f) return { ok: false, motif: 'introuvable' };
    var nom = String(nouveauNom || '').trim();
    if (!nom) return { ok: false, motif: 'nom_invalide' };
    if (nomPris(etat, nom, factionId)) return { ok: false, motif: 'nom_pris' };
    f.nom = nom;
    return { ok: true };
  }
  function dissoudreParAdmin(etat, factionId) { return dissoudre(etat, factionId); }

  MC.Guildes = {
    RANGS: RANGS,
    creerEtat: creerEtat, creerFaction: creerFaction, dissoudre: dissoudre,
    rangDe: rangDe, estMembre: estMembre,
    nommerRang: nommerRang, promouvoir: promouvoir, retrograder: retrograder,
    exclure: exclure, transmettre: transmettre,
    postuler: postuler, accepter: accepter, refuser: refuser,
    inviter: inviter, accepterInvitation: accepterInvitation, quitter: quitter,
    factionsDe: factionsDe, definirPrincipale: definirPrincipale,
    declarerRelation: declarerRelation, relationEnvers: relationEnvers,
    membresDe: membresDe, peutBlesser: peutBlesser,
    serialiser: serialiser, charger: charger,
    renommerParAdmin: renommerParAdmin, dissoudreParAdmin: dissoudreParAdmin,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
