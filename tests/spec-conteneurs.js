/* spec-conteneurs.js — B1 : inventaire et conteneurs serveur (docs/vague-2/B1.md,
   SPEC-SYNC-007 à 017). Module pur `src/conteneurs.js` (MC.Conteneurs), partagé
   par le solo, la prédiction client et le serveur. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var K = MC.ContratsV2;
  var I = MC.Core.I, B = MC.Core.B;
  var flatWorld = G.flatWorld;

  describe('Conteneurs — journal client (B1, étape 6, docs/vague-2/B1.md § 6)', {
    teste: 'player.js consommerCase/userCase/transformerCase mutent pl.inv exactement comme avant, ET, si pl.journalInv est un tableau, y poussent l\'opération déclarée (INV_CONSOMMER).',
    pourquoi: 'la prédiction client (game.js, étape 6) ne peut envoyer que ce que player.js a réellement journalisé au moment de l\'action ; en solo (journalInv absent), rien ne doit changer.',
    attendu: 'hors ligne (sans journalInv), le comportement est identique à avant ; en ligne (journalInv = []), poser un bloc, user un outil et vider un seau y ajoutent chacun une entrée correcte.',
  }, function () {
    function partie() {
      var w = flatWorld(10, B.STONE);
      var ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents, MC.Modes.regles('survie', 'facile'));
      pl.state.pos = { x: 0.5, y: 11, z: 0.5 };
      pl.state.onGround = true; pl.state.yaw = 0; pl.state.pitch = 0;
      return { w: w, ents: ents, pl: pl, s: pl.state };
    }

    it('SPEC-SYNC-007 : hors ligne (journalInv absent), poser un bloc consomme comme avant, sans journal', function () {
      var p = partie();
      p.s.inv.slots[0] = { id: B.PLANKS, n: 5 };
      var target = { x: 3, y: 10, z: 3, nx: 0, ny: 1, nz: 0, t: 1 };
      var res = p.pl.useOn(target);
      A.equal(res, 'place');
      A.equal(p.s.inv.slots[0].n, 4, 'une planche consommée');
      A.equal(p.s.journalInv, undefined, 'aucun journal créé si absent au départ');
    });

    it('SPEC-SYNC-007 : en ligne (journalInv = []), poser un bloc journalise { i, id, n }', function () {
      var p = partie();
      p.s.journalInv = [];
      p.s.inv.slots[0] = { id: B.PLANKS, n: 5 };
      var target = { x: 3, y: 10, z: 3, nx: 0, ny: 1, nz: 0, t: 1 };
      p.pl.useOn(target);
      A.equal(p.s.inv.slots[0].n, 4, 'la consommation reste identique en ligne');
      A.equal(p.s.journalInv.length, 1);
      A.deep(p.s.journalInv[0], { i: 0, id: B.PLANKS, n: 1 });
    });

    it('SPEC-SYNC-007 : userCase journalise { i, id, usure } sans changer l\'usure réelle', function () {
      var p = partie();
      p.s.journalInv = [];
      p.s.inv.slots[0] = { id: I.WOOD_PICKAXE, n: 1 };
      p.s.selected = 0;
      var target = { x: 0, y: 10, z: 0, block: B.STONE };
      var bt = MC.Core.breakTime(B.STONE, I.WOOD_PICKAXE);
      // on casse directement via mineTick en avançant le temps requis
      var res = null;
      for (var i = 0; i < 200 && !res; i++) res = p.pl.mineTick(bt.seconds / 199 + 0.001, target, function () { return 0; });
      A.ok(res && res.broken, 'le bloc a cédé');
      A.ok(p.s.journalInv.some(function (o) { return o.usure === 1 && o.id === I.WOOD_PICKAXE; }),
           'l\'usure de l\'outil est journalisée');
    });

    it('SPEC-SYNC-007 : transformerCase (seau) journalise { i, id, vers } — piège documenté (B1.md § 12)', function () {
      var p = partie();
      p.w.setBlock(0, 10, 0, B.WATER);
      p.s.journalInv = [];
      p.s.inv.slots[0] = { id: I.SEAU, n: 1 };
      p.s.selected = 0;
      p.s.pos = { x: 0.5, y: 11, z: 0.5 }; p.s.yaw = 0; p.s.pitch = -Math.PI / 2;
      var r = p.pl.useOn({ x: 3, y: 10, z: 3, nx: 0, ny: 1, nz: 0, t: 1 });
      A.equal(r, 'puise', 'le seau puise bien l\'eau visée');
      A.ok(p.s.journalInv.some(function (o) { return o.n === 1 && o.id === I.SEAU; }),
           'le seau vidé (consommé) est journalisé');
    });
  });

  describe('Conteneurs — raccordement au protocole (B1, étape 1)', {
    teste: 'NP.valider délègue les nouveaux types de message (vague 2) à MC.ContratsV2, et MANGER passe par validerManger.',
    pourquoi: 'B2 (TROC) et B4 (PVP) dépendent de ce raccordement fait par B1 ; sans lui aucun nouveau message n\'atteindrait jamais la logique de jeu.',
    attendu: 'un CRAFT valide est accepté et normalisé ; un CRAFT malformé (fois hors bornes) est refusé ; MANGER accepte toujours la forme historique.',
  }, function () {
    it('SPEC-SYNC-010 : NP.valider accepte un CRAFT valide et refuse un CRAFT malformé', function () {
      var NP = MC.NetProtocol;
      A.equal(NP.MSG.CRAFT, 'craft', 'le type CRAFT est fusionné dans NP.MSG');
      var ok = NP.valider({ t: 'craft', j: 0, seq: 1, fois: 2 });
      A.ok(ok, 'un CRAFT bien formé est accepté');
      A.equal(ok.fois, 2);
      A.equal(NP.valider({ t: 'craft', j: 0, seq: 1, fois: 0 }), null, 'fois hors bornes refusé');
      A.equal(NP.valider({ t: 'craft', j: 0, fois: 1 }), null, 'seq manquant refusé');
    });

    it('SPEC-SYNC-009 : MANGER reste accepté sous sa forme historique et sous sa forme étendue', function () {
      var NP = MC.NetProtocol;
      var m1 = NP.valider({ t: 'manger', id: I.BREAD, j: 0 });
      A.ok(m1, 'forme historique acceptée');
      var m2 = NP.valider({ t: 'manger', id: I.BREAD, j: 0, i: 3, seq: 5 });
      A.ok(m2, 'forme étendue (i, seq) acceptée');
      A.equal(m2.i, 3); A.equal(m2.seq, 5);
      A.equal(NP.valider({ t: 'manger', j: 0 }), null, 'id manquant refusé');
    });
  });

  // ─── module pur MC.Conteneurs (B1.md § 3, étapes 2 à 4) ────────────────────
  var MCo = MC.Conteneurs;

  function joueur() {
    return { inv: MC.Inventory.create(MC.Inventory.TOTAL), grille: MC.Inventory.create(9), equip: {} };
  }
  function ctxSansConteneurs(j, regles) {
    return { joueur: j, conteneur: function () { return null; }, regles: regles || { blocsIllimites: false } };
  }

  describe('Conteneurs — module pur MC.Conteneurs', {
    teste: 'creerConteneur, accepteCase, appliquer (transfert, craft, equip, consommer, manger, lacher, creatif, rendreGrille, declarer), tickFour.',
    pourquoi: 'C\'est le même code qui sert au solo, à la prédiction client en ligne et au serveur (B1.md § 3) : un bug ici se retrouve partout à la fois.',
    attendu: 'chaque opération est atomique (tout vérifier, puis muter), renvoie ok:false sans effet de bord en cas de refus, et conserve la somme des objets.',
  }, function () {

    it('SPEC-SYNC-007 : une opération dont les objets manquent est refusée sans effet de bord', function () {
      var j = joueur();
      j.inv.add(I.STICK, 2);
      var avant = j.inv.serialize();
      var r = MCo.appliquer(ctxSansConteneurs(j), { k: 'transfert', de: { z: 'inv', i: 0 }, vers: { z: 'inv', i: 5 }, n: 5 });
      A.equal(r.ok, false); A.equal(r.motif, 'quantite');
      A.deep(j.inv.serialize(), avant, 'aucun effet de bord');

      var r2 = MCo.appliquer(ctxSansConteneurs(j), { k: 'transfert', de: { z: 'inv', i: 9 }, vers: { z: 'inv', i: 5 }, n: 1 });
      A.equal(r2.ok, false); A.equal(r2.motif, 'absent');
    });

    it('SPEC-SYNC-007 : INV_CONSOMMER ne peut jamais augmenter une quantité ni transformer hors liste blanche', function () {
      var j = joueur();
      j.inv.add(I.STICK, 3);
      var r = MCo.appliquer(ctxSansConteneurs(j), { k: 'consommer', ops: [{ i: 0, id: I.STICK, n: 2 }] });
      A.ok(r.ok); A.equal(j.inv.count(I.STICK), 1, 'seulement une diminution, jamais un gain');

      // transformation hors liste blanche : aucun effet
      j.inv.slots[1] = { id: I.STICK, n: 1 };
      var r2 = MCo.appliquer(ctxSansConteneurs(j), { k: 'consommer', ops: [{ i: 1, id: I.STICK, vers: I.BREAD }] });
      A.equal(r2.ok, false);
      A.equal(j.inv.slots[1].id, I.STICK, 'la case n\'a pas été transformée');

      // transformation blanche-listée : seau vide -> seau d'eau, refusée sans eau à proximité
      j.inv.slots[2] = { id: I.SEAU, n: 1 };
      var ctx = ctxSansConteneurs(j);
      var r3 = MCo.appliquer(ctx, { k: 'consommer', ops: [{ i: 2, id: I.SEAU, vers: I.SEAU_EAU }] });
      A.equal(r3.ok, false, 'sans eau à proximité, la transformation est refusée');
      ctx.eauProche = function () { return true; };
      var r4 = MCo.appliquer(ctx, { k: 'consommer', ops: [{ i: 2, id: I.SEAU, vers: I.SEAU_EAU }] });
      A.ok(r4.ok);
      A.equal(j.inv.slots[2].id, I.SEAU_EAU);
    });

    it('SPEC-SYNC-007 : le même module sert au solo (appliquer direct) et au serveur (même résultat, même état)', function () {
      var jSolo = joueur(), jServeur = joueur();
      jSolo.inv.add(I.STICK, 5); jServeur.inv.add(I.STICK, 5);
      var op = { k: 'transfert', de: { z: 'inv', i: 0 }, vers: { z: 'inv', i: 4 }, n: 2 };
      var rSolo = MCo.appliquer(ctxSansConteneurs(jSolo), op);
      var rServeur = MCo.appliquer(ctxSansConteneurs(jServeur), op);
      A.deep(rSolo, rServeur);
      A.deep(jSolo.inv.serialize(), jServeur.inv.serialize());
    });

    it('SPEC-SYNC-008 : réconciliation — deux opérations en attente, une confirmée : état affiché exact', function () {
      var pred = MCo.creerPrediction();
      var s1 = pred.suivant({ k: 'lacher', i: 0, n: 1 });
      var s2 = pred.suivant({ k: 'lacher', i: 1, n: 1 });
      A.equal(s1, 1); A.equal(s2, 2);
      A.equal(pred.enAttente().length, 2);
      pred.confirmer(s1);
      A.equal(pred.enAttente().length, 1, 'seule la 2e opération reste en attente');
      A.equal(pred.enAttente()[0].seq, s2);
    });

    it('SPEC-SYNC-009 : manger consomme la case i, rend le bol, refuse un objet absent ou non comestible', function () {
      var j = joueur();
      j.inv.slots[0] = { id: I.MUSHROOM_STEW, n: 1 };
      var r = MCo.appliquer(ctxSansConteneurs(j), { k: 'manger', id: I.MUSHROOM_STEW, i: 0 });
      A.ok(r.ok);
      A.equal(r.effets.food, 7);
      A.equal(j.inv.count(I.MUSHROOM_STEW), 0, 'la soupe est consommée');
      A.equal(j.inv.count(I.BOWL), 1, 'le bol est rendu');

      var r2 = MCo.appliquer(ctxSansConteneurs(j), { k: 'manger', id: I.BREAD, i: 3 });
      A.equal(r2.ok, false); A.equal(r2.motif, 'absent');

      j.inv.slots[5] = { id: I.STICK, n: 1 };
      var r3 = MCo.appliquer(ctxSansConteneurs(j), { k: 'manger', id: I.STICK, i: 5 });
      A.equal(r3.ok, false); A.equal(r3.motif, 'incompatible', 'un objet non comestible est refusé');
    });

    it('SPEC-SYNC-010 : craft depuis la grille — recette valide, sans recette, inventaire plein, fois multiples', function () {
      var j = joueur();
      // recette shapeless : 1 tronc -> 4 planches
      j.grille.slots[0] = { id: B.LOG, n: 1 };
      var r = MCo.appliquer(ctxSansConteneurs(j), { k: 'craft', fois: 1 });
      A.ok(r.ok); A.equal(r.effets.fois, 1);
      A.deep(r.effets.ids, [B.PLANKS], 'SPEC-ARCHI-042 : le résultat fabriqué est rendu (le serveur en tire « Premier outil »)');
      A.equal(j.inv.count(B.PLANKS), 4);
      A.equal(j.grille.slots[0], null, 'l\'ingrédient a été consommé');

      var r2 = MCo.appliquer(ctxSansConteneurs(j), { k: 'craft', fois: 1 });
      A.equal(r2.ok, false); A.equal(r2.motif, 'recette', 'grille vide : aucune recette');

      // fois multiples
      j.grille.slots[0] = { id: B.LOG, n: 3 };
      var r3 = MCo.appliquer(ctxSansConteneurs(j), { k: 'craft', fois: 3 });
      A.ok(r3.ok); A.equal(r3.effets.fois, 3);
      A.deep(r3.effets.ids, [B.PLANKS, B.PLANKS, B.PLANKS], 'une entrée par fois');
      A.equal(j.inv.count(B.PLANKS), 4 + 12);

      // inventaire plein : aucune case libre ni pile compatible
      var j2 = joueur();
      j2.grille.slots[0] = { id: B.LOG, n: 1 };
      for (var i = 0; i < j2.inv.slots.length; i++) j2.inv.slots[i] = { id: I.STICK, n: 64 };
      var r4 = MCo.appliquer(ctxSansConteneurs(j2), { k: 'craft', fois: 1 });
      A.equal(r4.ok, false); A.equal(r4.motif, 'plein');
      A.equal(j2.grille.slots[0].n, 1, 'la grille n\'a pas été consommée : refus atomique');
    });

    it('SPEC-SYNC-011 : equip — échange, emplacement incompatible, deux côtés vides', function () {
      var j = joueur();
      var r0 = MCo.appliquer(ctxSansConteneurs(j), { k: 'equip', slot: 'casque', i: 0 });
      A.equal(r0.ok, false); A.equal(r0.motif, 'absent', 'deux côtés vides');

      j.inv.slots[0] = { id: I.FER_CASQUE, n: 1 };
      var r1 = MCo.appliquer(ctxSansConteneurs(j), { k: 'equip', slot: 'casque', i: 0 });
      A.ok(r1.ok);
      A.equal(j.equip.casque.id, I.FER_CASQUE);
      A.equal(j.inv.slots[0], null);

      // ré-échange : remet l'objet en inventaire
      var r2 = MCo.appliquer(ctxSansConteneurs(j), { k: 'equip', slot: 'casque', i: 0 });
      A.ok(r2.ok);
      A.equal(j.inv.slots[0].id, I.FER_CASQUE);
      A.equal(j.equip.casque, null);

      j.inv.slots[1] = { id: I.STICK, n: 1 };
      var r3 = MCo.appliquer(ctxSansConteneurs(j), { k: 'equip', slot: 'casque', i: 1 });
      A.equal(r3.ok, false); A.equal(r3.motif, 'incompatible');
    });

    it('SPEC-SYNC-012 : deux joueurs voient le même conteneur, chacun sa banque', function () {
      var chest = MCo.creerConteneur('chest');
      var banqueA = MCo.creerConteneur('banque'), banqueB = MCo.creerConteneur('banque');
      var jA = joueur(), jB = joueur();
      jA.inv.add(I.STICK, 10); jB.inv.add(I.STICK, 10);
      function ctxDe(j, banque) {
        return { joueur: j, conteneur: function (cle) { return cle === 'banque' ? banque : (cle === '1,2,3' ? chest : null); },
                 regles: { blocsIllimites: false } };
      }
      MCo.appliquer(ctxDe(jA, banqueA), { k: 'transfert', de: { z: 'inv', i: 0 }, vers: { z: 'cont', cle: '1,2,3', i: 0 }, n: 3 });
      MCo.appliquer(ctxDe(jB, banqueB), { k: 'transfert', de: { z: 'inv', i: 0 }, vers: { z: 'cont', cle: 'banque', i: 0 }, n: 4 });
      A.equal(chest.slots[0].n, 3, 'le coffre partagé a reçu les objets de A');
      A.equal(banqueA.slots[0], null, 'la banque de A n\'a rien reçu');
      A.equal(banqueB.slots[0].n, 4, 'seule la banque de B a reçu ses objets');
    });

    it('SPEC-SYNC-014 : transfert — déplacement, fusion, échange complet, refus (quantité, plein, sortie du fourneau), somme conservée', function () {
      var chest = MCo.creerConteneur('chest');
      var j = joueur();
      j.inv.add(I.STICK, 40);
      var ctx = { joueur: j, conteneur: function (cle) { return cle === '0,0,0' ? chest : null; }, regles: { blocsIllimites: false } };

      // déplacement vers une case vide
      var r1 = MCo.appliquer(ctx, { k: 'transfert', de: { z: 'inv', i: 0 }, vers: { z: 'cont', cle: '0,0,0', i: 0 }, n: 20 });
      A.ok(r1.ok);
      A.equal(chest.slots[0].n, 20);

      // fusion : encore 20 bâtons en case 0 de l'inventaire
      var r2 = MCo.appliquer(ctx, { k: 'transfert', de: { z: 'inv', i: 0 }, vers: { z: 'cont', cle: '0,0,0', i: 0 }, n: 20 });
      A.ok(r2.ok);
      A.equal(chest.slots[0].n, 40, 'fusion des deux piles de bâtons');
      A.equal(j.inv.count(I.STICK), 0);

      // échange complet : coffre a 40 bâtons en case 0, inv a des planches en case 1
      j.inv.slots[1] = { id: B.PLANKS, n: 40 };
      var r3 = MCo.appliquer(ctx, { k: 'transfert', de: { z: 'inv', i: 1 }, vers: { z: 'cont', cle: '0,0,0', i: 0 }, n: 40 });
      A.ok(r3.ok);
      A.equal(chest.slots[0].id, B.PLANKS);
      A.equal(j.inv.slots[1].id, I.STICK);

      // somme conservée : les 40 bâtons initiaux se retrouvent intégralement en inv[1]
      var totalStick = j.inv.count(I.STICK) + chest.slots.reduce(function (s, c) { return s + (c && c.id === I.STICK ? c.n : 0); }, 0);
      A.equal(totalStick, 40, 'aucun bâton créé ni perdu au fil des transferts');

      // refus quantité : rien n'a assez
      var r4 = MCo.appliquer(ctx, { k: 'transfert', de: { z: 'inv', i: 1 }, vers: { z: 'cont', cle: '0,0,0', i: 5 }, n: 999 });
      A.equal(r4.ok, false); A.equal(r4.motif, 'quantite');

      // refus plein : fusion qui dépasse le maxStack
      chest.slots[3] = { id: I.STICK, n: 60 };
      j.inv.slots[1].n = 40; // 40 bâtons (issus de l'échange précédent)
      var r5 = MCo.appliquer(ctx, { k: 'transfert', de: { z: 'inv', i: 1 }, vers: { z: 'cont', cle: '0,0,0', i: 3 }, n: 10 });
      A.equal(r5.ok, false); A.equal(r5.motif, 'plein');

      // refus : la case de sortie du fourneau n'accepte jamais un dépôt
      var four = MCo.creerConteneur('furnace');
      var ctxFour = { joueur: j, conteneur: function () { return four; }, regles: { blocsIllimites: false } };
      var r6 = MCo.appliquer(ctxFour, { k: 'transfert', de: { z: 'inv', i: 1 }, vers: { z: 'cont', cle: 'x', i: K.FOUR.SORTIE }, n: 1 });
      A.equal(r6.ok, false); A.equal(r6.motif, 'incompatible');
    });

    it('SPEC-SYNC-014 (revue adversariale) : un indice hors de la taille RÉELLE du conteneur est refusé, sans agrandir slots', function () {
      // le contrat (validerEmplacement, contrats-vague2.js) plafonne
      // génériquement `i` à 27 pour toute zone 'cont' ; un fourneau (3 cases)
      // ou une étagère (9 cases) doivent refuser un indice que le CONTRAT
      // laisserait passer (ex. 20) — sinon `slots[20] = …` agrandit le
      // tableau, et `validerConteneurPersiste` (slots.length === taille)
      // fait disparaître le conteneur ENTIER, silencieusement, à la
      // persistance (--monde).
      var four = MCo.creerConteneur('furnace');
      var etagere = MCo.creerConteneur('etagere');
      var j = joueur();
      j.inv.add(I.STICK, 10);
      var ctx = {
        joueur: j,
        conteneur: function (cle) { return cle === 'four' ? four : (cle === 'etagere' ? etagere : null); },
        regles: { blocsIllimites: false },
      };

      var rFourHaut = MCo.appliquer(ctx, { k: 'transfert', de: { z: 'inv', i: 0 }, vers: { z: 'cont', cle: 'four', i: 20 }, n: 1 });
      A.equal(rFourHaut.ok, false); A.equal(rFourHaut.motif, 'incompatible');
      A.equal(four.slots.length, 3, 'le fourneau garde EXACTEMENT sa taille — jamais agrandi');
      A.equal(j.inv.count(I.STICK), 10, 'rien n\'a quitté l\'inventaire sur un refus');

      var rEtagereHaut = MCo.appliquer(ctx, { k: 'transfert', de: { z: 'inv', i: 0 }, vers: { z: 'cont', cle: 'etagere', i: 20 }, n: 1 });
      A.equal(rEtagereHaut.ok, false); A.equal(rEtagereHaut.motif, 'incompatible');
      A.equal(etagere.slots.length, 9, 'l\'étagère garde EXACTEMENT sa taille');

      // même refus quand c'est la SOURCE (op.de) qui est hors bornes
      etagere.slots[2] = { id: I.STICK, n: 3 };
      var rSourceHaut = MCo.appliquer(ctx, { k: 'transfert', de: { z: 'cont', cle: 'etagere', i: 20 }, vers: { z: 'inv', i: 1 }, n: 1 });
      A.equal(rSourceHaut.ok, false); A.equal(rSourceHaut.motif, 'absent');
      A.equal(etagere.slots.length, 9);
      A.equal(etagere.slots[2].n, 3, 'la case réelle est intacte');

      // un indice DANS les bornes réelles du fourneau reste accepté
      var rFourBon = MCo.appliquer(ctx, { k: 'transfert', de: { z: 'inv', i: 0 }, vers: { z: 'cont', cle: 'four', i: K.FOUR.COMBUSTIBLE }, n: 2 });
      A.ok(rFourBon.ok, 'un indice valide (< taille réelle) reste accepté');
      A.equal(four.slots[K.FOUR.COMBUSTIBLE].n, 2);
    });

    it('SPEC-SYNC-017 : déclaration d\'un distributeur tronquée à la possession, somme conservée par objet', function () {
      var distrib = MCo.creerConteneur('distributeur');
      var j = joueur();
      j.inv.add(I.STICK, 5);
      var ctx = { joueur: j, conteneur: function () { return distrib; }, regles: { blocsIllimites: false } };
      // le joueur déclare vouloir 20 bâtons dans la case 0 : il n'en a que 5, tronqué
      var r = MCo.appliquer(ctx, { k: 'declarer', cle: 'x', slots: [K.pileVersCase({ id: I.STICK, n: 20 })].concat(new Array(8).fill(0)) });
      A.ok(r.ok);
      A.equal(distrib.slots[0].n, 5, 'tronqué à ce que le joueur possède');
      A.equal(j.inv.count(I.STICK), 0);

      // il déclare ensuite vouloir en retirer la moitié : le reste revient dans l'inventaire
      var r2 = MCo.appliquer(ctx, { k: 'declarer', cle: 'x', slots: [K.pileVersCase({ id: I.STICK, n: 2 })].concat(new Array(8).fill(0)) });
      A.ok(r2.ok);
      A.equal(distrib.slots[0].n, 2);
      A.equal(j.inv.count(I.STICK), 3);
      A.equal(distrib.slots[0].n + j.inv.count(I.STICK), 5, 'somme conservée par objet');
    });

    it('inventaire solo — sauvegarde et rechargement de l\'équipement (SPEC-SYNC-011)', function () {
      var j = joueur();
      var banque = MCo.creerConteneur('banque');
      j.inv.add(I.STICK, 3);
      j.equip.casque = { id: I.FER_CASQUE, n: 1, dmg: 5 };
      var rec = MCo.versEnregistrement(j, { slots: banque.slots });
      A.equal(rec.v, 1);

      var j2 = joueur();
      var banque2 = MCo.creerConteneur('banque');
      var ok = MCo.depuisEnregistrement(j2, banque2, rec);
      A.ok(ok);
      A.equal(j2.inv.count(I.STICK), 3);
      A.equal(j2.equip.casque.id, I.FER_CASQUE);
      A.equal(j2.equip.casque.dmg, 5, 'usure de l\'équipement conservée');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
