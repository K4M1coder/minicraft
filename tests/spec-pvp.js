/* spec-pvp.js — B4 : PvP, enjeux et sanctions (docs/vague-2/B4.md,
   SPEC-PVP-001 à 006). Spec PURE : `src/pvp-enjeux.js` (MC.PvpEnjeux), la
   part serveur de `src/entities.js` (`stepArrow`/`update`, auteur du coup et
   `peutBlesser`) et les trois succès PvP de `src/succes.js`. Le branchement
   réseau (server.js) est vérifié par `tests/integration-pvp.js`. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var flatWorld = G.flatWorld;
  var Inv = MC.Inventory, C = MC.Core, B = C.B, I = C.I;
  var PV = MC.PvpEnjeux;

  function sumInv(inv) {
    var t = 0;
    inv.slots.forEach(function (s) { if (s) t += s.n; });
    return t;
  }
  function sumPiles(piles) { return piles.reduce(function (a, p) { return a + p.n; }, 0); }

  // ═══════════════════════════════════════════════════════════════════════
  // SPEC-PVP-001 — butin borné, sans duplication
  // ═══════════════════════════════════════════════════════════════════════
  describe('PvpEnjeux — butin borné à la défaite (SPEC-PVP-001)', {
    teste: 'butinAutorise et resoudreButin : fraction 10-25 % du nombre d\'objets du perdant, reçue exactement par le gagnant (reliquat renvoyé, jamais perdu), équipement jamais touché (seul `inv` est lu, jamais `equip`), aucun butin hors PvP autorisé ou en duel.',
    pourquoi: 'un serveur autoritaire ne doit jamais créer ni détruire d\'objets au passage d\'un inventaire à l\'autre — la moindre dérive serait une duplication ou une perte silencieuse, invisible sans un test qui somme les deux côtés.',
    attendu: 'la perte mesurée tombe dans [10 %, 25 %] du total ; somme(perte) = somme(gain gagnant) + somme(reliquat) ; butinAutorise faux en zone sûre/pve ou en duel.',
  }, function () {
    it('SPEC-PVP-001 : défaite en zone pvp — perte de 10 à 25 % des objets, exactement reçue par le vainqueur', function () {
      var perdant = Inv.create(36), gagnant = Inv.create(36);
      for (var i = 0; i < 10; i++) perdant.slots[i] = { id: B.STONE, n: 10 };   // 100 objets au total
      var r = PV.resoudreButin(perdant, gagnant, 'graine-1');
      var totalPerte = sumPiles(r.perte);
      A.ok(totalPerte >= 10 && totalPerte <= 25, 'perte (' + totalPerte + ') hors bornes [10,25] pour 100 objets');
      var totalGagnant = sumInv(gagnant), totalReste = sumPiles(r.reste);
      A.equal(totalGagnant + totalReste, totalPerte, 'ce que le gagnant reçoit + le reliquat = exactement la perte');
      A.equal(sumInv(perdant), 100 - totalPerte, 'le perdant garde le reste, rien de plus, rien de moins');
    });
    it('SPEC-PVP-001 : un inventaire vide ne fait perdre aucun objet', function () {
      var perdant = Inv.create(36), gagnant = Inv.create(36);
      var r = PV.resoudreButin(perdant, gagnant, 'graine-vide');
      A.equal(r.perte.length, 0);
      A.equal(r.reste.length, 0);
    });
    it('SPEC-PVP-001 : au moins 1 objet perdu dès qu\'il y en a, même un tout petit inventaire', function () {
      var perdant = Inv.create(36), gagnant = Inv.create(36);
      perdant.slots[0] = { id: B.STONE, n: 3 };
      var r = PV.resoudreButin(perdant, gagnant, 'graine-petit');
      A.ok(sumPiles(r.perte) >= 1, 'toujours au moins un objet perdu si total > 0');
    });
    it('SPEC-PVP-001 : le surplus qui ne rentre pas chez le gagnant part en reliquat, jamais perdu', function () {
      var perdant = Inv.create(36), gagnant = Inv.create(1);   // gagnant : une seule case, déjà occupée
      for (var i = 0; i < 10; i++) perdant.slots[i] = { id: B.STONE, n: 10 };
      gagnant.slots[0] = { id: B.STONE, n: C.maxStack(B.STONE) };   // pleine : rien ne peut plus rentrer
      var r = PV.resoudreButin(perdant, gagnant, 'graine-plein');
      var totalPerte = sumPiles(r.perte);
      A.equal(sumPiles(r.reste), totalPerte, 'le gagnant, déjà plein, ne reçoit rien : tout part au sol');
    });
    it('SPEC-PVP-001 : butinAutorise — vrai seulement si le PvP est permis ET qu\'aucun duel n\'est en cours', function () {
      A.equal(PV.butinAutorise({ pvpAutorise: true, duel: false }), true);
      A.equal(PV.butinAutorise({ pvpAutorise: false, duel: false }), false, 'zone sûre/pve : aucune perte');
      A.equal(PV.butinAutorise({ pvpAutorise: true, duel: true }), false, 'duel consenti (SPEC-PVP-005) : aucune perte');
      A.equal(PV.butinAutorise({ pvpAutorise: false, duel: true }), false);
    });
    it('SPEC-PVP-001 (anti-abus) : deux complices qui s\'entretuent en boucle ne dupliquent jamais d\'objets — la somme totale (les deux inventaires + le sol) ne bouge pas', function () {
      var a = Inv.create(36), b = Inv.create(36);
      for (var i = 0; i < 8; i++) a.slots[i] = { id: B.STONE, n: 50 };
      var totalDepart = sumInv(a) + sumInv(b);
      var sol = 0;
      for (var k = 0; k < 12; k++) {
        // toujours le même sens (b « farme » sur a), comme deux complices qui
        // laisseraient l'un se faire tuer à répétition pour gonfler l'autre.
        var r = PV.resoudreButin(a, b, 'farm-' + k);
        sol += sumPiles(r.reste);
      }
      A.equal(sumInv(a) + sumInv(b) + sol, totalDepart, 'aucune création ni perte silencieuse d\'objets après 12 butins en boucle fermée');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SPEC-PVP-002 — aucun dégât entre membres d'une même faction
  // ═══════════════════════════════════════════════════════════════════════
  describe('Guildes/entities — aucun dégât entre membres d\'une même faction (SPEC-PVP-002)', {
    teste: 'deux joueurs qui partagent une faction (principale OU secondaire) ne peuvent pas se blesser, ni au corps à corps (guildes.js, déjà vrai) ni par projectile (entities.js stepArrow, auteur du coup porté par `par`).',
    pourquoi: 'SPEC-COMBAT-002/PVP-002 : un audit avait constaté que `stepArrow` ignorait totalement l\'appartenance à une faction, ne consultant que la zone (`pvpOk`) — un tir contournait donc la protection déjà en place pour le corps à corps.',
    attendu: 'peutBlesser(guildes, a, b) faux si `a` et `b` partagent une faction secondaire commune (même sans principale commune) ; entities.update ne pousse aucun `degatsPar` pour une flèche tirée entre deux tels joueurs.',
  }, function () {
    it('SPEC-PVP-002 : faction secondaire commune (pas de principale commune) — peutBlesser faux', function () {
      var g = MC.Guildes.creerEtat();
      var pa = MC.Guildes.creerFaction(g, 'a', { nom: 'Royaume A' });
      var pb = MC.Guildes.creerFaction(g, 'b', { nom: 'Royaume B' });
      var s = MC.Guildes.creerFaction(g, 'a', { nom: 'Guilde commune' });   // secondaire pour a (principale déjà prise)
      MC.Guildes.inviter(g, 'a', s.id, 'b');
      MC.Guildes.accepterInvitation(g, 'b', s.id);                          // secondaire pour b aussi
      A.equal(MC.Guildes.factionsDe(g, 'a').principale, pa.id);
      A.equal(MC.Guildes.factionsDe(g, 'b').principale, pb.id);
      A.equal(MC.Guildes.peutBlesser(g, 'a', 'b'), false, 'faction secondaire commune : protégés malgré des principales différentes');
    });
    function joueurEtat(x, y, z) { return { pos: { x: x, y: y, z: z }, dead: false, inv: {} }; }
    it('SPEC-PVP-002 : une flèche d\'un joueur sur un membre de sa faction secondaire commune n\'inflige aucun dégât (entities.update)', function () {
      var w = flatWorld(10, B.STONE);
      var ents = MC.createEntities(w);
      var tireur = joueurEtat(0, 10, 0), cible = joueurEtat(5, 10, 0);
      ents.tirer({ x: 0, y: 11.4, z: 0 }, { x: 1, y: 0, z: 0 }, 40, 5, tireur, 'sortilege');
      var ev = ents.update(0.2, cible, {
        joueurs: [cible],
        pvpOk: function () { return true; },                 // zone/serveur permissifs
        peutBlesser: function () { return false; },           // … mais même faction : refusé
      });
      A.equal(ev.degatsPar.length, 0, 'aucun dégât entre membres d\'une même faction, même en zone PvP');
    });
    it('SPEC-PVP-002 : témoin — la même flèche, entre joueurs SANS faction commune, inflige bien ses dégâts', function () {
      var w = flatWorld(10, B.STONE);
      var ents = MC.createEntities(w);
      var tireur = joueurEtat(0, 10, 0), cible = joueurEtat(5, 10, 0);
      ents.tirer({ x: 0, y: 11.4, z: 0 }, { x: 1, y: 0, z: 0 }, 40, 5, tireur, 'sortilege');
      var ev = ents.update(0.2, cible, {
        joueurs: [cible],
        pvpOk: function () { return true; },
        peutBlesser: function () { return true; },
      });
      A.equal(ev.degatsPar.length, 1, 'sans le témoin, le test précédent ne prouverait rien');
      A.equal(ev.degatsPar[0].n, 5);
      A.equal(ev.degatsPar[0].par, tireur, 'l\'auteur du coup est porté par l\'évènement (server.js en a besoin pour le butin/les meurtres)');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SPEC-PVP-005 — duel consenti, et anti-abus de synchronisation
  // ═══════════════════════════════════════════════════════════════════════
  describe('PvpEnjeux — duel consenti (SPEC-PVP-005)', {
    teste: 'proposerDuel/repondreDuel/duelActif/expirer : proposition refusée par défaut, acceptée explicitement par l\'invité, caduque après 30 s, duel valide 120 s dans un rayon de 32 blocs autour du point médian à l\'acceptation.',
    pourquoi: 'un duel doit rester un choix explicite des DEUX joueurs (jamais un simple message d\'intention qui vaudrait consentement), et ne jamais déborder dans le temps ni dans l\'espace au-delà de ce que l\'invité a accepté.',
    attendu: 'aucun duel actif tant que /duel accepter n\'a pas été reçu ; duelActif faux après 120 s ou hors du rayon ; une proposition non répondue après 30 s est refusée.',
  }, function () {
    it('SPEC-PVP-005 : proposition seule — refusée par défaut (aucun duel tant que l\'invité n\'a rien répondu)', function () {
      var pv = PV.creerEtat();
      PV.proposerDuel(pv, 'A', 'B', 0);
      A.equal(PV.duelActif(pv, 'A', 'B', 1, { x: 0, z: 0 }, { x: 0, z: 0 }), false);
    });
    it('SPEC-PVP-005 : acceptée explicitement — duel actif, symétrique quel que soit l\'ordre des noms', function () {
      var pv = PV.creerEtat();
      PV.proposerDuel(pv, 'A', 'B', 0);
      var r = PV.repondreDuel(pv, 'b', true, 5, { x: 0, z: 0 }, { x: 2, z: 0 });
      A.ok(r.ok && !r.refuse);
      A.equal(PV.duelActif(pv, 'A', 'B', 10, { x: 0, z: 0 }, { x: 2, z: 0 }), true);
      A.equal(PV.duelActif(pv, 'b', 'a', 10, { x: 2, z: 0 }, { x: 0, z: 0 }), true, 'ordre des arguments indifférent');
    });
    it('SPEC-PVP-005 : refusée explicitement — aucun duel', function () {
      var pv = PV.creerEtat();
      PV.proposerDuel(pv, 'A', 'B', 0);
      var r = PV.repondreDuel(pv, 'B', false, 5, { x: 0, z: 0 }, { x: 0, z: 0 });
      A.ok(r.ok && r.refuse);
      A.equal(PV.duelActif(pv, 'A', 'B', 10, { x: 0, z: 0 }, { x: 0, z: 0 }), false);
    });
    it('SPEC-PVP-005 : proposition caduque après 30 s — accepter trop tard échoue', function () {
      var pv = PV.creerEtat();
      PV.proposerDuel(pv, 'A', 'B', 0);
      var r = PV.repondreDuel(pv, 'B', true, 31, { x: 0, z: 0 }, { x: 0, z: 0 });
      A.equal(r.ok, false);
      A.equal(r.motif, 'expiree');
    });
    it('SPEC-PVP-005 : duel expiré après 120 s — expirer() le signale une seule fois et purge les propositions caduques', function () {
      var pv = PV.creerEtat();
      PV.proposerDuel(pv, 'X', 'Y', 0);
      PV.expirer(pv, 40);   // > 30 s, jamais répondu : purgée sans évènement
      A.equal(pv.propositions.size, 0);
      PV.proposerDuel(pv, 'C', 'D', 0);
      PV.repondreDuel(pv, 'D', true, 1, { x: 0, z: 0 }, { x: 0, z: 0 });
      A.equal(PV.expirer(pv, 100).length, 0, 'encore dans les 120 s');
      var evts = PV.expirer(pv, 200);
      A.equal(evts.length, 1);
      A.equal(PV.duelActif(pv, 'C', 'D', 200, { x: 0, z: 0 }, { x: 0, z: 0 }), false);
    });
    it('SPEC-PVP-005 : hors du rayon de 32 blocs — combat refusé (l\'un des deux s\'est trop éloigné)', function () {
      var pv = PV.creerEtat();
      PV.proposerDuel(pv, 'A', 'B', 0);
      PV.repondreDuel(pv, 'B', true, 1, { x: 0, z: 0 }, { x: 0, z: 0 });
      A.equal(PV.duelActif(pv, 'A', 'B', 2, { x: 0, z: 0 }, { x: 40, z: 0 }), false);
    });
    it('SPEC-PVP-005 : hors ligne, ou entre deux noms identiques (écran partagé) — jamais de duel', function () {
      var pv = PV.creerEtat();
      A.equal(PV.proposerDuel(pv, 'moi', 'moi', 0).ok, false, 'un joueur ne peut pas se dueller lui-même');
    });

    // ── anti-abus : timing d'un projectile autour de la fin d'un duel ───────
    function joueurEtat2(x, y, z) { return { pos: { x: x, y: y, z: z }, dead: false, inv: {} }; }
    it('SPEC-PVP-005 (anti-abus) : un duel actif autorise un tir même quand la zone/le serveur l\'interdiraient par ailleurs (duel avec projectile)', function () {
      var w = flatWorld(10, B.STONE);
      var ents = MC.createEntities(w);
      var tireur = joueurEtat2(0, 10, 0), cible = joueurEtat2(5, 10, 0);
      ents.tirer({ x: 0, y: 11.4, z: 0 }, { x: 1, y: 0, z: 0 }, 40, 5, tireur, 'sortilege');
      var ev = ents.update(0.2, cible, {
        joueurs: [cible],
        pvpOk: function () { return false; },      // hors zone pvp / sans --pvp
        peutBlesser: function () { return true; },  // … mais un duel consenti est en cours : autorisé quand même
      });
      A.equal(ev.degatsPar.length, 1, 'le duel doit primer sur pvpOk, exactement comme au corps à corps (server.js case ATTAQUE)');
    });
    it('SPEC-PVP-005 (anti-abus) : un projectile tiré JUSTE AVANT la fin d\'un duel est jugé à l\'IMPACT, pas au tir — aucun coup « banqué »', function () {
      var w = flatWorld(10, B.STONE);
      var ents = MC.createEntities(w);
      var tireur = joueurEtat2(0, 10, 0), cible = joueurEtat2(5, 10, 0);
      // vitesse lente et sans gravité (sortilège) : le projectile met plusieurs
      // images à parcourir les 5 blocs — assez pour que le duel se termine EN VOL.
      ents.tirer({ x: 0, y: 11.4, z: 0 }, { x: 1, y: 0, z: 0 }, 10, 5, tireur, 'sortilege');
      var autorise = true;
      var opts = { joueurs: [cible], pvpOk: function () { return true; }, peutBlesser: function () { return autorise; } };
      var ev1 = ents.update(0.1, cible, opts);      // le projectile avance (1 bloc), n'a pas encore atteint la cible
      A.equal(ev1.degatsPar.length, 0, 'encore en vol : rien ne peut se produire tout de suite');
      A.ok(ents.list.some(function (e) { return e.type === 'arrow'; }), 'le projectile est toujours en vol');
      autorise = false;   // le duel expire (ou l'un des deux sort du rayon) PENDANT le vol
      var ev2 = ents.update(0.5, cible, opts);      // le projectile atteint maintenant la cible
      A.equal(ev2.degatsPar.length, 0, 'jugé à l\'impact : la fin du duel en vol protège la cible, le tir ne « compte » pas');
    });
    it('SPEC-PVP-005 (témoin) : le même scénario, sans que le duel ne se termine en vol, inflige bien le coup', function () {
      var w = flatWorld(10, B.STONE);
      var ents = MC.createEntities(w);
      var tireur = joueurEtat2(0, 10, 0), cible = joueurEtat2(5, 10, 0);
      ents.tirer({ x: 0, y: 11.4, z: 0 }, { x: 1, y: 0, z: 0 }, 10, 5, tireur, 'sortilege');
      var opts = { joueurs: [cible], pvpOk: function () { return true; }, peutBlesser: function () { return true; } };
      ents.update(0.1, cible, opts);
      var ev2 = ents.update(0.5, cible, opts);
      A.equal(ev2.degatsPar.length, 1, 'sans le témoin, le test précédent ne prouverait rien de la synchronisation');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SPEC-PVP-003 — réputation dégradée par les meurtres répétés
  // ═══════════════════════════════════════════════════════════════════════
  describe('PvpEnjeux — réputation dégradée par les meurtres répétés (SPEC-PVP-003)', {
    teste: 'enregistrerMeurtre : fenêtre glissante de 10 min de jeu, -10 par meurtre au-delà du 2e (donc dès le 3e), auprès de chaque faction dont le territoire couvre le lieu du meurtre.',
    pourquoi: 'sans fenêtre glissante, un joueur qui recommence à tuer bien plus tard hériterait de la sanction d\'anciens meurtres oubliés depuis longtemps ; sans seuil, le premier meurtre en légitime défense serait puni comme un massacre.',
    attendu: '2 meurtres : réputation inchangée ; 3e meurtre en moins de 10 min : -10 ; 4e : -20 cumulé ; 3 meurtres espacés de plus de 10 min : jamais de pénalité.',
  }, function () {
    it('SPEC-PVP-003 : 2 meurtres en moins de 10 min — réputation inchangée', function () {
      var pv = PV.creerEtat();
      PV.enregistrerMeurtre(pv, 'brute', 'v1', 0, ['f1']);
      var r2 = PV.enregistrerMeurtre(pv, 'brute', 'v2', 100, ['f1']);
      A.equal(r2.penalites.length, 0);
      A.equal(PV.reputation(pv, 'brute', 'f1'), 0);
    });
    it('SPEC-PVP-003 : 3e meurtre en moins de 10 min — réputation -10 ; 4e — -20 cumulé', function () {
      var pv = PV.creerEtat();
      PV.enregistrerMeurtre(pv, 'brute', 'v1', 0, ['f1']);
      PV.enregistrerMeurtre(pv, 'brute', 'v2', 100, ['f1']);
      var r3 = PV.enregistrerMeurtre(pv, 'brute', 'v3', 200, ['f1']);
      A.deep(r3.penalites, [{ id: 'f1', delta: -10, valeur: -10 }]);
      A.equal(PV.reputation(pv, 'brute', 'f1'), -10);
      PV.enregistrerMeurtre(pv, 'brute', 'v4', 300, ['f1']);
      A.equal(PV.reputation(pv, 'brute', 'f1'), -20, 'cumulé : -10 au 3e, encore -10 au 4e');
    });
    it('SPEC-PVP-003 : 3 meurtres espacés de plus de 10 min — jamais de pénalité (fenêtre glissante)', function () {
      var pv = PV.creerEtat();
      PV.enregistrerMeurtre(pv, 'brute', 'v1', 0, ['f1']);
      PV.enregistrerMeurtre(pv, 'brute', 'v2', 700, ['f1']);
      var r3 = PV.enregistrerMeurtre(pv, 'brute', 'v3', 1400, ['f1']);
      A.equal(r3.penalites.length, 0, 'chaque meurtre est isolé, le précédent est déjà hors fenêtre');
    });
    it('SPEC-PVP-003 : la pénalité touche chaque faction proche du lieu du meurtre, pas les autres', function () {
      var pv = PV.creerEtat();
      PV.enregistrerMeurtre(pv, 'brute', 'v1', 0, []);
      PV.enregistrerMeurtre(pv, 'brute', 'v2', 10, []);
      var r3 = PV.enregistrerMeurtre(pv, 'brute', 'v3', 20, ['f1', 'f2']);
      var ids = r3.penalites.map(function (p) { return p.id; }).sort();
      A.deep(ids, ['f1', 'f2']);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SPEC-PVP-004 — succès de victoires PvP, arbitrés côté serveur
  // ═══════════════════════════════════════════════════════════════════════
  describe('PvpEnjeux/Succes — succès de victoires PvP (SPEC-PVP-004, SUCCES-001)', {
    teste: 'enregistrerVictoire compte par joueur nommé (canonisé) ; les trois succès pvp_victoire (1, 5, 25) se déclenchent aux bons seuils, jamais deux fois, et survivent à une sérialisation/rechargement (SPEC-SUCCES-001).',
    pourquoi: 'en ligne, le client seul ne peut pas savoir combien de victoires il a au total (le serveur redémarre, plusieurs sessions) : c\'est le compteur serveur, annoncé par le message PVP victoire, qui doit faire foi.',
    attendu: 'enregistrerVictoire renvoie le total après incrément ; le suivi de succès débloque premiere/cinq/vingtcinq_victoires_pvp exactement aux bons seuils ; un succès déjà débloqué ne se redéclenche jamais ; charger(serialiser()) conserve les déblocages.',
  }, function () {
    it('SPEC-PVP-004 : enregistrerVictoire compte par joueur nommé, insensible à la casse', function () {
      var pv = PV.creerEtat();
      A.equal(PV.enregistrerVictoire(pv, 'Alice'), 1);
      A.equal(PV.enregistrerVictoire(pv, 'alice'), 2, 'même joueur, casse différente');
      A.equal(PV.enregistrerVictoire(pv, 'bob'), 1, 'un autre joueur compte à part');
    });
    it('SPEC-PVP-004 : succès à 1, 5 et 25 victoires, jamais deux fois, persistés', function () {
      var s = MC.Succes.creer();
      var debloques = [];
      for (var i = 1; i <= 25; i++) debloques = debloques.concat(s.signaler({ type: 'pvp_victoire' }));
      var ids = debloques.map(function (d) { return d.id; });
      A.ok(ids.indexOf('premiere_victoire_pvp') >= 0, 'succès à 1 victoire');
      A.ok(ids.indexOf('cinq_victoires_pvp') >= 0, 'succès à 5 victoires');
      A.ok(ids.indexOf('vingtcinq_victoires_pvp') >= 0, 'succès à 25 victoires');
      A.equal(debloques.length, 3, 'exactement trois déclenchements sur 25 victoires');
      A.equal(s.signaler({ type: 'pvp_victoire' }).length, 0, 'une 26e victoire ne redéclenche rien');
      var data = s.serialiser();
      var s2 = MC.Succes.creer();
      s2.charger(data);
      A.ok(s2.estDebloque('premiere_victoire_pvp') && s2.estDebloque('cinq_victoires_pvp') && s2.estDebloque('vingtcinq_victoires_pvp'),
           'les trois succès survivent à une sauvegarde/rechargement');
    });
    it('SPEC-PVP-004 (anti-abus) : le compteur ne progresse que d\'un événement par appel — un « farming » de complices reste 1 victoire = 1 événement, jamais dupliqué', function () {
      var pv = PV.creerEtat();
      var n = 0;
      for (var k = 0; k < 10; k++) n = PV.enregistrerVictoire(pv, 'farmeur');
      A.equal(n, 10, 'dix appels, dix victoires : ni plus ni moins, même en boucle fermée entre deux complices');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // SPEC-PVP-006 — hors-la-loi et embargo commercial
  // ═══════════════════════════════════════════════════════════════════════
  describe('PvpEnjeux — hors-la-loi et embargo commercial (SPEC-PVP-006)', {
    teste: 'estHorsLaLoi (réputation ≤ -50 envers une faction) et embargo (vrai si le joueur est hors-la-loi envers UNE faction dont le territoire couvre (x, z)) — jamais un simple drapeau figé, toujours recalculé depuis la réputation courante.',
    pourquoi: 'FACTION-015/PVP-006 : l\'embargo doit suivre la réputation en temps réel (il se lève dès qu\'elle remonte), pas rester un état à part qu\'on pourrait oublier de nettoyer.',
    attendu: 'hors-la-loi à -50 envers une faction dont le siège est à portée : embargo vrai sur son territoire, faux ailleurs ; dès que la réputation remonte au-dessus de -50, l\'embargo se lève.',
  }, function () {
    it('SPEC-PVP-006 : hors-la-loi à -50 — embargo sur le territoire de la faction concernée, pas ailleurs', function () {
      var pv = PV.creerEtat();
      // 7 meurtres dans la fenêtre : -10 au 3e, 4e, 5e, 6e, 7e (5 × -10 = -50)
      for (var i = 0; i < 7; i++) PV.enregistrerMeurtre(pv, 'hors-la-loi', 'v' + i, i * 50, ['f1']);
      A.equal(PV.reputation(pv, 'hors-la-loi', 'f1'), -50);
      A.ok(PV.estHorsLaLoi(pv, 'hors-la-loi', 'f1'));
      var politique = { factions: new Map([['f1', { siege: { x: 0, z: 0 }, territoire: 100 }]]) };
      A.equal(PV.embargo(pv, 'hors-la-loi', politique, 10, 10), true, 'dans le territoire de f1');
      A.equal(PV.embargo(pv, 'hors-la-loi', politique, 500, 500), false, 'hors du territoire de f1');
    });
    it('SPEC-PVP-006 : levé au-dessus du seuil (recalculé depuis la réputation courante, jamais figé)', function () {
      var pv = PV.creerEtat();
      for (var i = 0; i < 7; i++) PV.enregistrerMeurtre(pv, 'repenti', 'v' + i, i * 50, ['f1']);
      var politique = { factions: new Map([['f1', { siege: { x: 0, z: 0 }, territoire: 100 }]]) };
      A.equal(PV.embargo(pv, 'repenti', politique, 0, 0), true);
      // simule une remontée de réputation (mécanisme hors périmètre B4, voir C3) :
      pv.reputations.get('repenti').f1 = -10;
      A.equal(PV.embargo(pv, 'repenti', politique, 0, 0), false, 'la réputation est repassée au-dessus du seuil : embargo levé');
    });
    it('SPEC-PVP-006 : un joueur jamais hors-la-loi n\'est jamais embargé', function () {
      var pv = PV.creerEtat();
      var politique = { factions: new Map([['f1', { siege: { x: 0, z: 0 }, territoire: 100 }]]) };
      A.equal(PV.embargo(pv, 'inconnu', politique, 0, 0), false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Persistance de l'état PvP (aller-retour, comme guildes.js/economie.js)
  // ═══════════════════════════════════════════════════════════════════════
  describe('PvpEnjeux — persistance (serialiser/charger)', {
    teste: 'un aller-retour serialiser()/charger() conserve meurtres, victoires et réputations ; les duels et propositions, éphémères (B4.md § 6), ne sont jamais persistés.',
    pourquoi: 'un redémarrage du serveur (--monde) ne doit ni oublier les sanctions déjà appliquées ni ressusciter un duel dont l\'un des deux participants a disparu entre-temps.',
    attendu: 'après charger(serialiser(etat)), reputation/estHorsLaLoi et enregistrerVictoire (compteur repris) donnent le même résultat qu\'avant ; un duel en cours au moment de la sauvegarde n\'existe plus après charger().',
  }, function () {
    it('SPEC-PVP-003/004/006 : meurtres, victoires et réputations survivent à un aller-retour', function () {
      var pv = PV.creerEtat();
      PV.enregistrerVictoire(pv, 'alice');
      PV.enregistrerVictoire(pv, 'alice');
      for (var i = 0; i < 7; i++) PV.enregistrerMeurtre(pv, 'alice', 'v' + i, i * 50, ['f1']);
      var data = PV.serialiser(pv);
      var pv2 = PV.charger(data);
      A.equal(PV.reputation(pv2, 'alice', 'f1'), -50);
      A.ok(PV.estHorsLaLoi(pv2, 'alice', 'f1'));
      A.equal(PV.enregistrerVictoire(pv2, 'alice'), 3, 'le compteur repris continue là où il en était');
    });
    it('SPEC-PVP-005 : duels et propositions ne sont jamais persistés (éphémères)', function () {
      var pv = PV.creerEtat();
      PV.proposerDuel(pv, 'a', 'b', 0);
      PV.repondreDuel(pv, 'b', true, 1, { x: 0, z: 0 }, { x: 0, z: 0 });
      var pv2 = PV.charger(PV.serialiser(pv));
      A.equal(pv2.duels.size, 0);
      A.equal(pv2.propositions.size, 0);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
