/* spec-contrats-vague2.js — contrats figés de la vague 2 (src/contrats-vague2.js,
   docs/vague-2/). Ces tests ne valident AUCUN comportement de jeu : les specs
   citées restent ⏳ tant que les lots B1 à B4 ne les ont pas livrées. Ils
   figent l'interface commune — noms de messages, bornes, formes de données —
   pour que quatre agents parallèles codent contre la même chose, et que tout
   changement de contrat fasse rougir cette suite. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var K = MC.ContratsV2;

  function cases(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }
  function chunkVide() {
    return { blocks: new Uint16Array(16 * 128 * 16), etats: null,
             eau: { nature: new Uint8Array(256), flux: new Int8Array(512), prof: new Uint8Array(256) } };
  }
  function passe(nv) {
    var p = {};
    Object.keys(K.ATTRIBUTS_MAILLAGE).forEach(function (k) { p[k] = new Float32Array(nv * K.ATTRIBUTS_MAILLAGE[k]); });
    p.indices = new Uint32Array([0, 1, 2]);
    return p;
  }

  describe('Contrats vague 2 — messages et formes partagées', {
    teste: 'Les contrats figés de la vague 2 (src/contrats-vague2.js) : noms de messages, bornes, formes de piles, conteneurs, troc, PvP et messages worker.',
    pourquoi: 'Quatre sous-lots (B1 à B4) codent en parallèle contre cette interface ; un contrat qui dérive casserait leurs fusions sans qu\'aucun ne le voie.',
    attendu: 'chaque validateur accepte exactement les formes documentées, les normalise, et renvoie null pour toute entrée invalide sans jamais lever d\'exception.',
  }, function () {

    it('SPEC-SYNC-008 : les nouveaux types de message sont distincts entre eux et des NP.MSG existants, chacun avec un sens et, en c→s, un budget anti-flood', function () {
      var valeurs = Object.keys(K.MSG).map(function (k) { return K.MSG[k]; });
      A.equal(new Set(valeurs).size, valeurs.length, 'aucun doublon interne');
      /* Vrai avant ET après la fusion de K.MSG dans NP.MSG (B1, étape 1) :
         une clé partagée porte la même valeur, une clé propre à NP n'emprunte
         jamais la valeur d'un nouveau type. */
      Object.keys(MC.NetProtocol.MSG).forEach(function (k) {
        var v = MC.NetProtocol.MSG[k];
        if (K.MSG[k] !== undefined) A.equal(v, K.MSG[k], 'NP.MSG.' + k + ' fusionné tel quel');
        else A.equal(valeurs.indexOf(v), -1, 'NP.MSG.' + k + ' (' + v + ') ne collisionne avec aucun nouveau type');
      });
      valeurs.forEach(function (v) {
        A.ok(['c>s', 's>c', 'deux'].indexOf(K.SENS[v]) >= 0, 'sens défini pour ' + v);
        if (K.SENS[v] !== 's>c') A.ok(K.BUDGETS_FLOOD[v] > 0, 'budget anti-flood pour ' + v);
        else A.equal(K.BUDGETS_FLOOD[v], undefined, 'pas de budget pour un message serveur → client : ' + v);
      });
    });

    it('SPEC-SYNC-007 : pile et case sérialisée — même format que MC.Inventory.serialize, bornes, normalisation', function () {
      var inv = MC.Inventory.create(MC.Inventory.TOTAL);
      inv.add(MC.Core.I.STICK, 5);
      inv.addStack(MC.Core.I.LIVRE, 1, { titre: 'x' });
      inv.slots[3] = { id: MC.Core.I.IRON_PICKAXE, n: 1, dmg: 7 };
      var ser = inv.serialize();
      var v = K.validerCases(ser, K.BORNES.SLOTS_INV);
      A.ok(v, 'un inventaire sérialisé est une liste de cases valide');
      A.deep(v[3], [MC.Core.I.IRON_PICKAXE, 1, 7], 'usure conservée');
      A.deep(K.caseVersPile(v[3]), { id: MC.Core.I.IRON_PICKAXE, n: 1, dmg: 7 });
      A.deep(K.pileVersCase({ id: 4, n: 2 }), [4, 2]);
      A.equal(K.pileVersCase(null), 0);
      A.equal(K.validerCase(0), 0, 'case vide');
      A.equal(K.validerCase([0, 1]), null, 'id nul refusé');
      A.equal(K.validerCase([5, 1000]), null, 'quantité > N_MAX refusée');
      A.equal(K.validerCase([5, 1.5]), null, 'quantité non entière refusée');
      A.equal(K.validerCase([70000, 1]), null, 'id > 16 bits refusé');
      A.equal(K.validerCase('x'), null);
      A.deep(K.validerPile({ id: 3, n: 2, dmg: 0 }), { id: 3, n: 2 }, 'dmg nul omis');
      A.equal(K.validerPile({ id: 3, n: 2, data: { t: new Array(3000).join('a') } }), null, 'data trop volumineuse refusée');
      A.equal(K.validerCases(cases(35), 36), null, 'taille exacte exigée');
    });

    it('SPEC-SYNC-011 : équipement (cinq emplacements), EQUIP et EQUIP_VU', function () {
      A.deep(K.EQUIP_SLOTS, ['casque', 'plastron', 'jambieres', 'bottes', 'bijou']);
      var e = K.validerEquip({ casque: [9, 1] });
      A.deep(e, { casque: [9, 1], plastron: 0, jambieres: 0, bottes: 0, bijou: 0 }, 'emplacements absents = vides');
      A.equal(K.validerEquip({ casque: [9, -1] }), null);
      A.deep(K.valider({ t: K.MSG.EQUIP, j: 1, seq: 4, slot: 'bottes', i: 12 }),
             { t: 'equip', j: 1, seq: 4, slot: 'bottes', i: 12 });
      A.equal(K.valider({ t: K.MSG.EQUIP, seq: 4, slot: 'gants', i: 12 }), null, 'emplacement inconnu');
      A.equal(K.valider({ t: K.MSG.EQUIP, slot: 'casque', i: 1 }), null, 'seq requis');
      A.equal(K.valider({ t: K.MSG.EQUIP, seq: 1, slot: 'casque', i: 36 }), null, 'case hors inventaire');
      A.deep(K.validerEquipVu({ t: K.MSG.EQUIP_VU, id: 3, j: 0, slot: 'casque', objet: 0 }),
             { t: 'equip_vu', id: 3, j: 0, slot: 'casque', objet: 0 }, 'objet 0 = emplacement vidé');
      A.equal(K.validerEquipVu({ t: K.MSG.EQUIP_VU, id: 3, slot: 'casque', objet: [1, 1] }), null, 'jamais une pile complète');
    });

    it('SPEC-SYNC-012 : clés et types de conteneurs, conteneur persisté', function () {
      A.equal(K.cleConteneur(1, 64, -3), '1,64,-3');
      A.deep(K.lireCle('1,64,-3'), { x: 1, y: 64, z: -3 });
      A.deep(K.lireCle('banque'), { propre: 'banque' });
      A.equal(K.lireCle('01,64,-3'), null, 'forme canonique exigée');
      A.equal(K.lireCle('1,128,0'), null, 'y hors du monde');
      A.equal(K.lireCle('1,2'), null);
      A.equal(K.tailleConteneur('chest'), 27);
      A.equal(K.tailleConteneur('furnace'), 3);
      A.equal(K.tailleConteneur('grille'), 9);
      A.equal(K.tailleConteneur('presentoir'), 0, 'présentoir hors vague 2 (SPEC-SYNC-027)');
      A.ok(K.TYPES_CONTENEUR.banque.parJoueur && K.TYPES_CONTENEUR.grille.transitoire);
      var f = K.validerConteneurPersiste({ cle: '4,5,6', type: 'furnace', slots: [[1, 2], 0, 0] });
      A.deep(f.four, { burn: 0, cook: 0 }, 'progression du fourneau par défaut');
      A.equal(K.validerConteneurPersiste({ cle: '4,5,6', type: 'chest', slots: cases(9) }), null, 'taille du type exigée');
      A.equal(K.validerConteneurPersiste({ cle: 'banque', type: 'banque', slots: cases(27) }), null, 'la banque vit dans l\'enregistrement du joueur');
      A.equal(K.validerConteneurPersiste({ cle: '4,5,6', type: 'grille', slots: cases(9) }), null, 'la grille n\'est jamais persistée');
    });

    it('SPEC-SYNC-013 : CONTENEUR_OUVRIR vise exactement une cible, CONTENEUR_FERMER une clé valide (seq exigé pour rendre la grille)', function () {
      A.deep(K.valider({ t: K.MSG.CONTENEUR_OUVRIR, x: 1, y: 2, z: 3 }), { t: 'cont_ouvrir', j: 0, x: 1, y: 2, z: 3 });
      A.deep(K.valider({ t: K.MSG.CONTENEUR_OUVRIR, j: 2, eid: 55 }), { t: 'cont_ouvrir', j: 2, eid: 55 });
      A.equal(K.valider({ t: K.MSG.CONTENEUR_OUVRIR, x: 1, y: 2, z: 3, eid: 5 }), null, 'deux cibles');
      A.equal(K.valider({ t: K.MSG.CONTENEUR_OUVRIR }), null, 'aucune cible');
      A.equal(K.valider({ t: K.MSG.CONTENEUR_OUVRIR, x: 1e15, y: 2, z: 3 }), null, 'coordonnée hors plage (SPEC-SECU-008)');
      A.deep(K.valider({ t: K.MSG.CONTENEUR_FERMER, cle: '1,2,3' }), { t: 'cont_fermer', j: 0, cle: '1,2,3' });
      A.equal(K.valider({ t: K.MSG.CONTENEUR_FERMER, cle: 'grille' }), null, 'rendre la grille modifie l\'inventaire : seq exigé');
      A.deep(K.valider({ t: K.MSG.CONTENEUR_FERMER, cle: 'grille', seq: 9 }), { t: 'cont_fermer', j: 0, seq: 9, cle: 'grille' });
    });

    it('SPEC-SYNC-014 : CONTENEUR_TRANSFERT — emplacements valides et distincts, quantité bornée, seq exigé', function () {
      var ok = K.valider({ t: K.MSG.CONTENEUR_TRANSFERT, seq: 3, de: { z: 'inv', i: 0 }, vers: { z: 'cont', cle: '1,2,3', i: 26 }, n: 64 });
      A.deep(ok.vers, { z: 'cont', cle: '1,2,3', i: 26 });
      A.equal(K.valider({ t: K.MSG.CONTENEUR_TRANSFERT, seq: 3, de: { z: 'inv', i: 0 }, vers: { z: 'inv', i: 0 }, n: 1 }), null, 'même emplacement');
      A.equal(K.valider({ t: K.MSG.CONTENEUR_TRANSFERT, seq: 3, de: { z: 'inv', i: 0 }, vers: { z: 'grille', i: 9 }, n: 1 }), null, 'grille 3×3');
      A.equal(K.valider({ t: K.MSG.CONTENEUR_TRANSFERT, seq: 3, de: { z: 'inv', i: 0 }, vers: { z: 'cont', cle: 'grille', i: 0 }, n: 1 }), null, 'la grille est la zone grille');
      A.equal(K.valider({ t: K.MSG.CONTENEUR_TRANSFERT, seq: 3, de: { z: 'inv', i: 0 }, vers: { z: 'inv', i: 1 }, n: 0 }), null, 'n ≥ 1');
      A.equal(K.valider({ t: K.MSG.CONTENEUR_TRANSFERT, de: { z: 'inv', i: 0 }, vers: { z: 'inv', i: 1 }, n: 1 }), null, 'seq requis');
      A.deep(K.validerEmplacement({ z: 'cont', cle: 'banque', i: 26 }), { z: 'cont', cle: 'banque', i: 26 });
      A.equal(K.validerEmplacement({ z: 'equip', i: 0 }), null, 'l\'équipement passe par EQUIP');
    });

    it('SPEC-SYNC-010 : CRAFT porte seq et un nombre de fabrications borné', function () {
      A.deep(K.valider({ t: K.MSG.CRAFT, seq: 1 }), { t: 'craft', j: 0, seq: 1, fois: 1 });
      A.deep(K.valider({ t: K.MSG.CRAFT, j: 3, seq: 8, fois: 64 }), { t: 'craft', j: 3, seq: 8, fois: 64 });
    });

    it('SPEC-SYNC-010 : CRAFT refuse fois hors bornes et seq absent ou invalide', function () {
      A.equal(K.valider({ t: K.MSG.CRAFT, seq: 1, fois: 65 }), null);
      A.equal(K.valider({ t: K.MSG.CRAFT, seq: 0 }), null);
      A.equal(K.valider({ t: K.MSG.CRAFT }), null);
      A.equal(K.valider({ t: K.MSG.CRAFT, seq: 2.5 }), null);
    });

    it('SPEC-SYNC-009 : MANGER vague 2 — i et seq facultatifs (compatibilité), bornés s\'ils sont là', function () {
      A.deep(K.validerManger({ t: 'manger', id: 300, j: 1 }), { t: 'manger', id: 300, j: 1 }, 'ancien format accepté');
      A.deep(K.validerManger({ t: 'manger', id: 300, i: 4, seq: 7 }), { t: 'manger', id: 300, j: 0, i: 4, seq: 7 });
      A.equal(K.validerManger({ t: 'manger', id: 300, i: 40 }), null);
      A.equal(K.validerManger({ t: 'manger', id: 'pain' }), null);
    });

    it('SPEC-SYNC-007 : INV_CONSOMMER (diminutions seulement), INV_LACHER, INV_CREATIF', function () {
      var m = K.valider({ t: K.MSG.INV_CONSOMMER, seq: 5, ops: [{ i: 0, id: 12 }, { i: 1, id: 13, usure: 1 }, { i: 2, id: 201, vers: 200 }] });
      A.deep(m.ops, [{ i: 0, id: 12, n: 1 }, { i: 1, id: 13, usure: 1 }, { i: 2, id: 201, vers: 200 }]);
      A.equal(K.validerOpConsommer({ i: 0, id: 12, n: 2, usure: 1 }), null, 'une seule forme par opération');
      A.equal(K.validerOpConsommer({ i: 0, id: 12, vers: 12 }), null, 'transformation vers soi-même');
      A.equal(K.validerOpConsommer({ i: 0, id: 12, n: -3 }), null, 'jamais une augmentation');
      var trop = []; for (var k = 0; k < 17; k++) trop.push({ i: 0, id: 1 });
      A.equal(K.valider({ t: K.MSG.INV_CONSOMMER, seq: 5, ops: trop }), null, 'au plus OPS_MAX opérations');
      A.equal(K.valider({ t: K.MSG.INV_CONSOMMER, seq: 5, ops: [] }), null);
      A.deep(K.valider({ t: K.MSG.INV_LACHER, seq: 2, i: 8, n: 3 }), { t: 'inv_lacher', j: 0, seq: 2, i: 8, n: 3 });
      A.deep(K.valider({ t: K.MSG.INV_CREATIF, seq: 2, i: 8, id: 3, n: 64 }), { t: 'inv_creatif', j: 0, seq: 2, i: 8, id: 3, n: 64 });
      A.equal(K.valider({ t: K.MSG.INV_CREATIF, seq: 2, i: 8, id: 0, n: 64 }), null);
    });

    it('SPEC-SYNC-008 : messageInvMaj fabrique un INV_MAJ que validerInvMaj accepte ; toute altération est refusée', function () {
      var inv = MC.Inventory.create(MC.Inventory.TOTAL);
      inv.add(MC.Core.I.STICK, 3);
      var grille = MC.Inventory.create(9);
      grille.add(MC.Core.B.PLANKS, 2);
      var equip = { casque: { id: 9, n: 1, dmg: 2 }, plastron: null, jambieres: null, bottes: null, bijou: null };
      var m = K.messageInvMaj({ inv: inv, equip: equip, grille: grille },
        { j: 1, rev: 4, ack: 17, refus: [{ seq: 16, motif: 'absent' }],
          conteneurs: [{ cle: '1,2,3', rev: 8, maj: [[0, [MC.Core.I.STICK, 1]]] }], gain: { id: 5, n: 2 } });
      var v = K.validerInvMaj(JSON.parse(JSON.stringify(m)));
      A.ok(v, 'passe par JSON sans perte');
      A.equal(v.rev, 4); A.equal(v.ack, 17); A.equal(v.j, 1);
      A.deep(v.inv[0], [MC.Core.I.STICK, 3]);
      A.deep(v.grille[0], [MC.Core.B.PLANKS, 2]);
      A.deep(v.equip.casque, [9, 1, 2]);
      A.deep(v.refus, [{ seq: 16, motif: 'absent' }]);
      A.equal(v.conteneurs[0].rev, 8);
      A.deep(v.gain, { id: 5, n: 2 });
      var casse = JSON.parse(JSON.stringify(m)); casse.inv.pop();
      A.equal(K.validerInvMaj(casse), null, 'inventaire incomplet');
      var casse2 = JSON.parse(JSON.stringify(m)); casse2.refus[0].motif = 'parce que';
      A.equal(K.validerInvMaj(casse2), null, 'motif hors de la liste fermée');
      var casse3 = JSON.parse(JSON.stringify(m)); casse3.rev = 0;
      A.equal(K.validerInvMaj(casse3), null, 'rev ≥ 1');
      A.deep(K.validerInvMaj(K.messageInvMaj({ inv: inv, equip: {} }, {})).refus, [], 'refus absent = liste vide');
    });

    it('SPEC-SYNC-015 : CONTENEUR_ETAT (contenu complet) et CONTENEUR_MAJ (delta), fourneau compris ; validerRecu aiguille', function () {
      var etat = { t: K.MSG.CONTENEUR_ETAT, j: 0, cle: '1,2,3', type: 'furnace', rev: 3, slots: [[4, 1], 0, 0], four: { burn: 12, cook: 2 } };
      A.deep(K.validerConteneurEtat(etat).four, { burn: 12, cook: 2 });
      A.equal(K.validerConteneurEtat({ t: K.MSG.CONTENEUR_ETAT, cle: '1,2,3', type: 'chest', rev: 0, slots: cases(26) }), null);
      var maj = { t: K.MSG.CONTENEUR_MAJ, cle: '1,2,3', rev: 4, maj: [[2, [7, 1]]], four: { burn: 11, cook: 3 } };
      A.deep(K.validerConteneurMaj(maj), { cle: '1,2,3', rev: 4, maj: [[2, [7, 1]]], four: { burn: 11, cook: 3 }, t: 'cont_maj' });
      A.equal(K.validerConteneurMaj({ t: K.MSG.CONTENEUR_MAJ, cle: '1,2,3', rev: 4, maj: [[27, 0]] }), null, 'indice hors conteneur');
      A.equal(K.validerRecu(maj).rev, 4);
      A.equal(K.validerRecu({ t: 'bloc' }), null, 'types existants : hors contrat');
    });

    it('SPEC-SYNC-020 : clé du registre des joueurs nommés et enregistrement persisté (champs inconnus conservés)', function () {
      A.equal(K.cleRegistre('  Alice ', 0), 'alice');
      A.equal(K.cleRegistre('Alice', 2), 'alice#2', 'joueur local d\'un écran partagé');
      A.equal(K.cleRegistre('', 0), null);
      var r = K.validerEnregistrementJoueur({ v: 1, inv: cases(36), equip: {}, pos: { x: 1, y: 2, z: 3 } });
      A.ok(r && r.banque.length === 27, 'banque vide par défaut');
      A.deep(r.pos, { x: 1, y: 2, z: 3 }, 'champ futur (C1) conservé');
      A.equal(K.validerEnregistrementJoueur({ v: 2, inv: cases(36) }), null, 'version inconnue');
    });

    it('SPEC-SYNC-023 : TROC client → serveur (consulter, echanger), identifiant d\'offre stable, réponse offres, transaction', function () {
      A.deep(K.valider({ t: K.MSG.TROC, action: 'consulter', eid: 12 }), { t: 'troc', j: 0, action: 'consulter', eid: 12 });
      A.deep(K.valider({ t: K.MSG.TROC, seq: 3, action: 'echanger', eid: 12, offre: 2 }),
             { t: 'troc', j: 0, seq: 3, action: 'echanger', eid: 12, offre: 2, fois: 1 });
      A.equal(K.valider({ t: K.MSG.TROC, action: 'echanger', eid: 12, offre: 2 }), null, 'échanger exige seq');
      A.equal(K.valider({ t: K.MSG.TROC, seq: 3, action: 'echanger', eid: 12, offre: 64 }), null, 'offre bornée');
      A.equal(K.valider({ t: K.MSG.TROC, action: 'offres', eid: 12, offres: [] }), null, 'le serveur n\'accepte pas une réponse');
      A.equal(K.offreId('village-3', 'fermier', 2), 'village-3|fermier|2');
      A.deep(K.lireOffreId('village-3|fermier|2'), { lieu: 'village-3', role: 'fermier', indice: 2 });
      A.equal(K.offreId(null, null, 0), 'campagne|villageois|0');
      A.equal(K.lireOffreId('a|b'), null);
      var rep = K.validerTrocReponse({ t: 'troc', action: 'offres', eid: 12, remise: 0.1,
        offres: [{ i: 0, give: [{ id: 5, n: 8 }], get: { id: 6, n: 1 }, prix: 1.23, stock: 4, dispo: true },
                 { i: 1, give: [{ id: 6, n: 1 }], get: { id: 7, n: 3 }, prix: 1, stock: null, dispo: false }],
        cours: [{ id: 5, prix: 0.9 }] });
      A.equal(rep.offres.length, 2); A.equal(rep.offres[1].stock, null); A.equal(rep.remise, 0.1);
      A.equal(K.validerTrocReponse({ t: 'troc', action: 'offres', eid: 1, offres: [], remise: 0.9 }), null, 'remise ≤ 50 %');
      A.deep(K.validerTransaction({ offre: 'village-3|fermier|0', give: [{ id: 5, n: 8 }], get: { id: 6, n: 1 }, prix: 1.2, fois: 2 }),
             { offre: 'village-3|fermier|0', give: [{ id: 5, n: 8 }], get: { id: 6, n: 1 }, prix: 1.2, fois: 2 });
      A.equal(K.validerTransaction({ offre: 'x', give: [], get: { id: 6, n: 1 }, prix: 1, fois: 1 }), null);
    });

    it('SPEC-PVP-001 : événement PVP serveur → client (perte bornée à des piles valides)', function () {
      var v = K.validerPvp({ t: 'pvp', evt: 'defaite', de: 'Bob', perte: [{ id: 5, n: 3, dmg: 1 }] });
      A.deep(v, { t: 'pvp', evt: 'defaite', de: 'Bob', perte: [{ id: 5, n: 3 }] });
      A.deep(K.validerPvp({ t: 'pvp', evt: 'reputation', factions: [{ id: 'royaume:v1', delta: -10, valeur: -250 }] }).factions,
             [{ id: 'royaume:v1', delta: -10, valeur: -100 }], 'réputation bornée à [-100, 100]');
      A.equal(K.validerPvp({ t: 'pvp', evt: 'triche' }), null);
      A.equal(K.validerPvp({ t: 'pvp', evt: 'victoire', de: 42 }), null);
      A.equal(K.validerRecu({ t: 'pvp', evt: 'victoire', n: 5 }).n, 5);
    });

    it('SPEC-PERF-008 : messages worker (init, genere, chunk, maille, maillage, erreur) et tampons à transférer', function () {
      A.deep(K.validerMessageWorker({ type: 'init', epoque: 0, graine: 42, v: K.VERSION }),
             { type: 'init', epoque: 0, graine: 42, v: 1, options: { zonePolitique: null } });
      A.equal(K.validerMessageWorker({ type: 'init', epoque: 0, graine: 42, v: 99 }), null, 'version de contrat vérifiée');
      A.deep(K.validerMessageWorker({ type: 'genere', epoque: 3, cx: -2, cz: 5 }), { type: 'genere', epoque: 3, cx: -2, cz: 5 });
      var ch = chunkVide(); ch.type = 'chunk'; ch.epoque = 3; ch.cx = 0; ch.cz = 0; ch.ms = 12.5;
      A.ok(K.validerMessageWorker(ch), 'chunk complet');
      var mauvais = chunkVide(); mauvais.blocks = new Uint8Array(32768);
      mauvais.type = 'chunk'; mauvais.epoque = 3; mauvais.cx = 0; mauvais.cz = 0; mauvais.ms = 1;
      A.equal(K.validerMessageWorker(mauvais), null, 'blocs sur 16 bits exigés');
      var voisins = []; for (var k = 0; k < 9; k++) voisins.push(k === 0 ? null : chunkVide());
      var maille = { type: 'maille', epoque: 3, cx: 1, cz: 1, version: 7, voisins: voisins };
      var vm = K.validerMessageWorker(maille);
      A.ok(vm && vm.fusion === true && vm.simplifie === false, 'greedy meshing par défaut (7e paramètre de buildChunk)');
      voisins[4] = null;
      A.equal(K.validerMessageWorker(maille), null, 'le chunk central est obligatoire');
      var res = { type: 'maillage', epoque: 3, cx: 1, cz: 1, version: 7, ms: 3,
                  passes: { opaque: passe(3), cutout: null },
                  lumiere: { niveaux: new Uint8Array(18 * 18 * 128), ciel: new Uint8Array(18 * 18 * 128), sources: 2 } };
      var vr = K.validerMessageWorker(res);
      A.ok(vr && vr.passes.opaque && vr.passes.blend === null, 'passes absentes = aucun maillage');
      var tr = K.transferablesDe(res);
      A.equal(tr.length, Object.keys(K.ATTRIBUTS_MAILLAGE).length + 1 + 2, 'chaque tampon une seule fois');
      A.equal(new Set(tr).size, tr.length);
      var faux = { type: 'maillage', epoque: 3, cx: 1, cz: 1, version: 7, ms: 3, passes: { opaque: passe(3) }, lumiere: null };
      faux.passes.opaque.indices = new Uint32Array([0, 1, 3]);
      A.equal(K.validerMessageWorker(faux), null, 'indice de sommet hors maillage');
      A.deep(K.validerMessageWorker({ type: 'erreur', epoque: 1, message: 'boum' }), { type: 'erreur', epoque: 1, message: 'boum' });
    });

    it('SPEC-PERF-009 : version et époque obligatoires sur les messages de maillage', function () {
      var voisins = []; for (var k = 0; k < 9; k++) voisins.push(chunkVide());
      A.equal(K.validerMessageWorker({ type: 'maille', epoque: 3, cx: 1, cz: 1, voisins: voisins }), null, 'version absente');
      A.equal(K.validerMessageWorker({ type: 'genere', cx: 1, cz: 1 }), null, 'époque absente');
      A.equal(K.validerMessageWorker({ type: 'maillage', epoque: 3, cx: 1, cz: 1, version: -1, ms: 0, passes: {} }), null);
    });

    it('SPEC-SYNC-007 : aucun validateur ne lève d\'exception ni n\'accepte un message inconnu ou mal formé', function () {
      var dechets = [null, undefined, 0, 'x', [], {}, { t: 42 }, { t: 'e', s: 1 }, { t: 'craft', seq: {} },
                     { t: 'cont_transfert', seq: 1, de: null, vers: null, n: 1 }, { t: 'troc', action: 'voler', eid: 1 },
                     { t: 'inv_consommer', seq: 1, ops: [null] }];
      dechets.forEach(function (d) {
        A.equal(K.valider(d), null, 'valider : ' + JSON.stringify(d));
        A.equal(K.validerRecu(d), null, 'validerRecu : ' + JSON.stringify(d));
        A.equal(K.validerMessageWorker(d), null, 'validerMessageWorker : ' + JSON.stringify(d));
      });
      A.deep(K.transferablesDe(null), []);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
