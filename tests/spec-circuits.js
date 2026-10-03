/* spec-circuits.js — tests des specs SPEC-MECA-* (L29 mécanismes : circuits
   logiques et énergie). Un test par spec ; les tables de vérité, les délais,
   la mémoire et la stabilité passent par le graphe pur (creerReseau /
   tickReseau) ; pistons et portes motorisées par un petit monde réel
   (MC.createWorld). */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, K = MC.Circuits;
  var B = C.B;

  describe('SPEC-MECA-004 : circuits logiques', function () {
    it('SPEC-MECA-004 : table de vérité de chaque porte', function () {
      A.equal(K.porte('oui', [0]), 0); A.equal(K.porte('oui', [1]), 1);
      A.equal(K.porte('non', [0]), 1); A.equal(K.porte('non', [1]), 0);
      var TT2 = [[0, 0], [0, 1], [1, 0], [1, 1]];
      var attendu = {
        et:   [0, 0, 0, 1], ou:   [0, 1, 1, 1], xor:  [0, 1, 1, 0],
        nand: [1, 1, 1, 0], nor:  [1, 0, 0, 0], xnor: [1, 0, 0, 1],
      };
      Object.keys(attendu).forEach(function (type) {
        TT2.forEach(function (e, i) {
          A.equal(K.porte(type, e), attendu[type][i], type + ' ' + e.join(','));
        });
      });
      // trois entrées : ET et OU se généralisent, XOR compte la parité
      A.equal(K.porte('et', [1, 1, 1]), 1);
      A.equal(K.porte('et', [1, 0, 1]), 0);
      A.equal(K.porte('ou', [0, 0, 0]), 0);
      A.equal(K.porte('xor', [1, 1, 1]), 1, 'parité impaire');
      A.equal(K.porte('xor', [1, 1, 0]), 0, 'parité paire');
    });

    it('SPEC-MECA-004 : les pas élémentaires (répéteur, bascule, compteur) sont corrects isolément', function () {
      var r1 = K.pasRepeteur({ compte: 0 }, true, 2);
      A.equal(r1.sortie, 0, 'premier tic haut : pas encore assez de délai');
      var r2 = K.pasRepeteur({ compte: r1.compte }, true, 2);
      A.equal(r2.sortie, 1, 'deuxième tic : le délai est atteint');
      var r3 = K.pasRepeteur({ compte: r2.compte }, false, 2);
      A.equal(r3.sortie, 0, 'entrée retombée : la sortie retombe aussitôt');

      var b1 = K.pasBascule({ memoire: 0, setPrecedent: 0 }, true, false);
      A.equal(b1.sortie, 1, 'front montant : bascule à 1');
      var b2 = K.pasBascule({ memoire: b1.memoire, setPrecedent: b1.setPrecedent }, true, false);
      A.equal(b2.sortie, 1, 'set toujours haut : pas de nouveau front, inchangé');

      var c1 = K.pasCompteur({ valeur: 0, entreePrecedente: 0 }, true, 4);
      A.equal(c1.sortie, 1);
      var c2 = K.pasCompteur({ valeur: c1.valeur, entreePrecedente: c1.entreePrecedente }, true, 4);
      A.equal(c2.sortie, 1, 'entrée toujours haute : pas de nouveau front');
    });

    it('SPEC-MECA-004 : le répéteur retarde de son délai réglé', function () {
      var reseau = K.creerReseau([
        { id: 'e', type: 'entree', etat: 0 },
        { id: 'r', type: 'repeteur', entrees: ['e'], delai: 3 },
      ]);
      K.fixerEntree(reseau, 'e', 1);
      var vus = [];
      for (var i = 0; i < 5; i++) { K.tickReseau(reseau); vus.push(reseau.index.r.etat); }
      A.deep(vus, [0, 0, 1, 1, 1], 'haut seulement après 3 tics pleins');
      K.fixerEntree(reseau, 'e', 0);
      K.tickReseau(reseau);
      A.equal(reseau.index.r.etat, 0, 'et retombe sans mémoire dès que l’entrée retombe');
    });

    it('SPEC-MECA-004 : la bascule mémorise, le compteur avance, le comparateur compare', function () {
      var reseau = K.creerReseau([
        { id: 'set', type: 'entree' }, { id: 'reset', type: 'entree' },
        { id: 'b', type: 'bascule', entrees: ['set', 'reset'] },
      ]);
      K.fixerEntree(reseau, 'set', 1);
      K.tickReseau(reseau);
      A.equal(reseau.index.b.etat, 1, 'front montant : mémorise 1');
      K.fixerEntree(reseau, 'set', 1);
      K.tickReseau(reseau);
      A.equal(reseau.index.b.etat, 1, 'set toujours haut, pas de nouveau front : inchangé');
      K.fixerEntree(reseau, 'set', 0);
      K.tickReseau(reseau);
      A.equal(reseau.index.b.etat, 1, 'set retombé : la mémoire ne bouge pas toute seule');
      K.fixerEntree(reseau, 'reset', 1);
      K.tickReseau(reseau);
      A.equal(reseau.index.b.etat, 0, 'reset la force à 0');

      var rc = K.creerReseau([{ id: 'e', type: 'entree' }, { id: 'c', type: 'compteur', entrees: ['e'], mod: 4 }]);
      var comptes = [];
      [1, 1, 0, 1, 0, 1, 0, 1].forEach(function (v) { K.fixerEntree(rc, 'e', v); K.tickReseau(rc); comptes.push(rc.index.c.etat); });
      A.deep(comptes, [1, 1, 1, 2, 2, 3, 3, 0], 'avance d’1 par front montant, boucle modulo 4');

      A.equal(K.pasComparateur(7, 3), 1, '7 >= 3');
      A.equal(K.pasComparateur(2, 3), 0, '2 >= 3 est faux');
      A.equal(K.pasComparateur(5, 5, 'egal'), 1);
      A.equal(K.pasComparateur(5, 4, 'egal'), 0);
    });

    it('SPEC-MECA-004 : propagation déterministe et bornée — cycle instable détecté, oscillateur borné accepté', function () {
      // un OU rebouclé sur lui-même sans aucun délai : instable
      var instable = K.creerReseau([
        { id: 'a', type: 'ou', entrees: ['b'] },
        { id: 'b', type: 'non', entrees: ['a'] },
      ]);
      var v1 = K.validerReseau(instable);
      A.notOk(v1.ok, 'cycle purement combinatoire refusé');
      A.ok(v1.cycle.indexOf('a') >= 0 && v1.cycle.indexOf('b') >= 0, 'le cycle signalé contient les deux nœuds');

      // le même bouclage, mais à travers un répéteur : borné (un oscillateur voulu)
      var borne = K.creerReseau([
        { id: 'a', type: 'non', entrees: ['r'] },
        { id: 'r', type: 'repeteur', entrees: ['a'], delai: 2 },
      ]);
      A.ok(K.validerReseau(borne).ok, 'cycle avec répéteur accepté (fréquence bornée par le délai)');
      // et il oscille bel et bien, à une fréquence bornée par le délai
      var suite = [];
      for (var i = 0; i < 10; i++) { K.tickReseau(borne); suite.push(borne.index.a.etat); }
      A.ok(suite.indexOf(0) >= 0 && suite.indexOf(1) >= 0, 'oscille réellement');
      // déterminisme : deux simulations indépendantes, mêmes tics, même suite
      var borne2 = K.creerReseau([
        { id: 'a', type: 'non', entrees: ['r'] },
        { id: 'r', type: 'repeteur', entrees: ['a'], delai: 2 },
      ]);
      var suite2 = [];
      for (var j = 0; j < 10; j++) { K.tickReseau(borne2); suite2.push(borne2.index.a.etat); }
      A.deep(suite, suite2, 'même graphe, mêmes tics : même résultat');
    });
  });

  describe('SPEC-MECA-005 : détecteurs et commandes', function () {
    it('SPEC-MECA-005 : chaque détecteur émet un signal selon son déclencheur', function () {
      A.equal(K.detecteur('bouton', { appuye: true }), 1);
      A.equal(K.detecteur('bouton', { appuye: false }), 0);
      A.equal(K.detecteur('levier', { actionne: true }), 1);
      A.equal(K.detecteur('plaque', { presents: 2 }), 1);
      A.equal(K.detecteur('plaque', { presents: 0 }), 0);
      A.equal(K.detecteur('presence', { proches: 1 }), 1, 'joueur ou créature');
      A.equal(K.detecteur('lumiere', { niveau: 12, seuil: 8 }), 1);
      A.equal(K.detecteur('lumiere', { niveau: 3, seuil: 8 }), 0);
      A.equal(K.detecteur('journuit', { nuit: true }), 1);
      A.equal(K.detecteur('journuit', { nuit: false }), 0);
      A.equal(K.detecteur('pluie-vent', { pluie: true }), 1);
      A.equal(K.detecteur('pluie-vent', { ventVitesse: 3, seuilVent: 1 }), 1);
      A.equal(K.detecteur('pluie-vent', { pluie: false, ventVitesse: 0 }), 0);
      A.equal(K.detecteur('eau', { niveauEau: 5 }), 1);
      A.equal(K.detecteur('eau', { niveauEau: 0 }), 0);
      // horloge : signal carré de période réglable
      var suite = [];
      for (var t = 0; t < 6; t++) suite.push(K.detecteur('horloge', { temps: t, periode: 2 }));
      A.deep(suite, [1, 1, 0, 0, 1, 1]);
    });
  });

  describe('SPEC-MECA-002 : générateurs et transport d’énergie', function () {
    it('SPEC-MECA-002 : chaque générateur produit selon son milieu, le câble perd en route', function () {
      A.gt(K.puissanceEolienne({ x: 1, z: 0 }, 120, 128), K.puissanceEolienne({ x: 1, z: 0 }, 10, 128),
           'plus haut, plus de vent captable');
      A.equal(K.puissanceEolienne(null, 100, 128), 0, 'pas de vent, pas de puissance');
      A.equal(K.puissanceHydraulique(7), 7, 'proportionnelle au courant local');
      A.equal(K.puissanceHydraulique(0), 0);
      A.equal(K.puissanceThermique(true, 0), 15, 'lave à proximité : plein régime');
      A.equal(K.puissanceThermique(false, 40), 10, 'combustible restant : régime fixe');
      A.equal(K.puissanceThermique(false, 0), 0, 'ni lave ni combustible : rien');

      A.equal(K.transporterEnergie(15, 0), 15, 'sans câble, rien ne se perd');
      A.gt(K.transporterEnergie(15, 0), K.transporterEnergie(15, 10), 'un câble plus long perd plus');
      A.equal(K.transporterEnergie(15, 100), 0, 'assez long : plus rien n’arrive');
    });
  });

  describe('SPEC-MECA-003 : batteries', function () {
    it('SPEC-MECA-003 : la batterie charge et décharge à débit borné, et son niveau reste dans les limites', function () {
      var r1 = K.tickBatterie(0, 15, 10, 0, 4);
      A.equal(r1.niveau, 4, 'la charge est bornée par le débit max, pas par l’apport');
      var r2 = K.tickBatterie(14, 15, 10, 0, 4);
      A.equal(r2.niveau, 15, 'et par la capacité');
      var r3 = K.tickBatterie(3, 15, 0, 10, 4);
      A.equal(r3.niveau, 0, 'la décharge est bornée par ce qu’il reste');
      A.equal(r3.fourni, 3, 'on ne fournit jamais plus que ce qui est stocké');
      var r4 = K.tickBatterie(10, 15, 0, 3, 4);
      A.equal(r4.fourni, 3); A.equal(r4.niveau, 7);
    });

    it('SPEC-MECA-003 : une batterie cassée garde son niveau sur sa pile, et le retrouve reposée', function () {
      var Inv = MC.Inventory;
      var w = MC.createWorld(85);
      w.getChunk(0, 0, true);
      w.setBlock(4, 40, 4, B.BATTERIE);
      w.setEtat(4, 40, 4, 9);
      // cassée : le niveau (lu avant de vider le bloc) voyage sur la pile —
      // exactement ce que player.js fait dans mineTick (voir dataDrop).
      var niveau = w.getEtat(4, 40, 4) & 15;
      A.equal(niveau, 9);
      var inv = Inv.create(9);
      inv.setAt(0, { id: B.BATTERIE, n: 1, data: { niveau: niveau } });
      // la pile porte son niveau, y compris après un aller-retour de sauvegarde
      var serial = inv.serialize();
      var inv2 = Inv.create(9);
      inv2.load(serial);
      A.equal(inv2.stackAt(0).data.niveau, 9, 'le niveau survit à la sauvegarde/chargement (SPEC-SAVE-017)');
      // reposée : le niveau stocké sur la pile redevient l’état du bloc (même
      // logique que player.js useOn, sans dépendre du rendu/joueur ici).
      w.setBlock(5, 40, 5, B.BATTERIE);
      w.setEtat(5, 40, 5, inv2.stackAt(0).data.niveau);
      A.equal(w.getEtat(5, 40, 5), 9, 'reposée, la batterie retrouve son niveau');
    });
  });

  describe('SPEC-MECA-006 : appareils', function () {
    it('SPEC-MECA-006 : un appareil s’arrête toujours sans énergie, quel que soit le signal', function () {
      A.notOk(K.appareil(false, true), 'signal actif mais pas d’énergie : arrêté');
      A.notOk(K.appareil(false, false));
      A.notOk(K.appareil(true, false), 'de l’énergie mais aucun signal : arrêté aussi');
      A.ok(K.appareil(true, true), 'énergie et signal : en marche');
    });

    it('SPEC-MECA-006 : une lampe posée sur un monde réel s’allume et s’éteint avec le signal voisin', function () {
      var w = MC.createWorld(77);
      w.getChunk(0, 0, true);
      w.setBlock(5, 40, 5, B.LEVIER_CIRCUIT);
      w.setEtat(5, 40, 5, 0);
      w.setBlock(6, 40, 5, B.LAMPE_ETEINTE);
      var api = { getBlock: w.getBlock, getEtat: w.getEtat, setEtat: w.setEtat, setBlock: w.setBlock };
      var pos = [[5, 40, 5, B.LEVIER_CIRCUIT], [6, 40, 5, B.LAMPE_ETEINTE]];
      K.tick(pos, api, {});
      A.equal(w.getBlock(6, 40, 5), B.LAMPE_ETEINTE, 'levier éteint : la lampe reste éteinte');
      w.setEtat(5, 40, 5, 1);
      pos = [[5, 40, 5, B.LEVIER_CIRCUIT], [6, 40, 5, w.getBlock(6, 40, 5)]];
      K.tick(pos, api, {});
      A.equal(w.getBlock(6, 40, 5), B.LAMPE_ALLUMEE, 'levier actionné : la lampe s’allume');
      A.gt(C.BLOCKS[B.LAMPE_ALLUMEE].light, 0, 'une lampe allumée est une source de lumière');
    });

    it('SPEC-MECA-006 : une porte existante s’ouvre sur signal (C.estPorte / C.bascule)', function () {
      var w = MC.createWorld(78);
      w.getChunk(0, 0, true);
      w.setBlock(2, 40, 2, B.BOUTON_CIRCUIT); w.setEtat(2, 40, 2, 1);
      w.setBlock(3, 40, 2, B.PORTE_FERMEE_N);
      var api = { getBlock: w.getBlock, getEtat: w.getEtat, setEtat: w.setEtat, setBlock: w.setBlock };
      K.tick([[2, 40, 2, B.BOUTON_CIRCUIT], [3, 40, 2, B.PORTE_FERMEE_N]], api, {});
      A.ok(C.estPorte(w.getBlock(3, 40, 2)), 'toujours une porte');
      A.equal(w.getBlock(3, 40, 2), B.PORTE_OUVERTE_N, 'le signal du bouton l’a ouverte');
      w.setEtat(2, 40, 2, 0);
      K.tick([[2, 40, 2, B.BOUTON_CIRCUIT], [3, 40, 2, w.getBlock(3, 40, 2)]], api, {});
      A.equal(w.getBlock(3, 40, 2), B.PORTE_FERMEE_N, 'le signal retombé : elle se referme');
    });

    /* Bogue ancien : une porte (ou une trappe) du registre des mécanismes était
       ramenée à chaque tic à l'état de son signal — sans aucun signal voisin,
       elle était donc REFERMÉE au tic suivant après qu'un joueur (ou un
       habitant) l'avait ouverte à la main. Le signal ne commande la porte
       qu'à ses FRONTS (il monte : elle s'ouvre ; il retombe : elle se ferme) ;
       entre deux fronts, la main du joueur fait foi. */
    it('SPEC-MECA-006 : une porte ou une trappe ouverte à la main, sans signal, reste ouverte aux tics suivants', function () {
      var w = MC.createWorld(81);
      w.getChunk(0, 0, true);
      var api = { getBlock: w.getBlock, getEtat: w.getEtat, setEtat: w.setEtat, setBlock: w.setBlock };
      w.setBlock(3, 40, 2, B.PORTE_FERMEE_N);
      w.setBlock(6, 40, 6, B.TRAPPE_FERMEE);
      w.setBlock(3, 40, 2, C.bascule(w.getBlock(3, 40, 2)));      // ouvertes à la main (clic droit)
      w.setBlock(6, 40, 6, C.bascule(w.getBlock(6, 40, 6)));
      for (var t = 0; t < 5; t++) K.tick([[3, 40, 2, w.getBlock(3, 40, 2)], [6, 40, 6, w.getBlock(6, 40, 6)]], api, {});
      A.equal(w.getBlock(3, 40, 2), B.PORTE_OUVERTE_N, 'la porte ouverte à la main reste ouverte');
      A.equal(w.getBlock(6, 40, 6), B.TRAPPE_OUVERTE, 'la trappe ouverte à la main reste ouverte');
    });

    it('SPEC-MECA-006 : un bloc remplacé perd son état résiduel ; seule la bascule d\'une porte ou d\'une trappe le garde', function () {
      var w = MC.createWorld(83);
      w.getChunk(0, 0, true);
      w.setBlock(4, 40, 4, B.LEVIER_CIRCUIT); w.setEtat(4, 40, 4, 1);
      w.setBlock(4, 40, 4, B.PORTE_FERMEE_N);                       // remplacé sans passer par l'air
      A.equal(w.getEtat(4, 40, 4), 0, 'l\'état du levier ne devient pas celui de la porte');
      w.setEtat(4, 40, 4, 1);                                      // la porte a vu un signal
      w.setBlock(4, 40, 4, C.bascule(w.getBlock(4, 40, 4)));
      A.equal(w.getEtat(4, 40, 4), 1, 'ouverte à la main : la porte garde le signal vu');
      w.setBlock(4, 40, 4, B.STONE);
      A.equal(w.getEtat(4, 40, 4), 0, 'remplacée par de la pierre : plus d\'état');
    });

    it('SPEC-MECA-006 : le signal commande la porte à ses fronts ; entre deux fronts, la main du joueur fait foi', function () {
      var w = MC.createWorld(82);
      w.getChunk(0, 0, true);
      var api = { getBlock: w.getBlock, getEtat: w.getEtat, setEtat: w.setEtat, setBlock: w.setBlock };
      w.setBlock(2, 40, 2, B.LEVIER_CIRCUIT); w.setEtat(2, 40, 2, 0);
      w.setBlock(3, 40, 2, B.PORTE_FERMEE_N);
      function tic() { K.tick([[2, 40, 2, B.LEVIER_CIRCUIT], [3, 40, 2, w.getBlock(3, 40, 2)]], api, {}); }
      tic();
      A.equal(w.getBlock(3, 40, 2), B.PORTE_FERMEE_N, 'sans signal, la porte fermée le reste');
      w.setEtat(2, 40, 2, 1); tic();
      A.equal(w.getBlock(3, 40, 2), B.PORTE_OUVERTE_N, 'front montant : la porte s\'ouvre');
      w.setBlock(3, 40, 2, C.bascule(w.getBlock(3, 40, 2)));     // refermée à la main, levier toujours actionné
      tic(); tic();
      A.equal(w.getBlock(3, 40, 2), B.PORTE_FERMEE_N, 'signal maintenu : la porte refermée à la main le reste');
      w.setBlock(3, 40, 2, C.bascule(w.getBlock(3, 40, 2)));     // rouverte à la main
      w.setEtat(2, 40, 2, 0); tic();
      A.equal(w.getBlock(3, 40, 2), B.PORTE_FERMEE_N, 'front descendant : la porte se referme');
      tic(); tic();
      A.equal(w.getBlock(3, 40, 2), B.PORTE_FERMEE_N, 'et reste fermée sans signal');
      // une porte cassée puis reposée oublie le signal qu'elle avait vu
      w.setEtat(2, 40, 2, 1); tic();
      A.equal(w.getBlock(3, 40, 2), B.PORTE_OUVERTE_N, 'nouveau front montant : ouverte');
      w.setBlock(3, 40, 2, 0); w.setBlock(3, 40, 2, B.PORTE_FERMEE_N); tic();
      A.equal(w.getBlock(3, 40, 2), B.PORTE_OUVERTE_N, 'reposée contre un levier actionné : le signal l\'ouvre (front vu par la nouvelle porte)');
    });
  });

  describe('SPEC-MECA-001 : distributeurs et pistons', function () {
    it('SPEC-MECA-001 : un distributeur choisit le premier objet disponible', function () {
      A.equal(K.distributeurChoix([null, { id: 1, n: 0 }, { id: 2, n: 3 }]), 2);
      A.equal(K.distributeurChoix([null, null]), -1, 'rien à distribuer');
    });

    it('SPEC-MECA-001 : un piston pousse jusqu’à douze blocs sur un petit monde réel, et pas au-delà', function () {
      var w = MC.createWorld(79);
      w.getChunk(0, 0, true); w.getChunk(1, 0, true);
      for (var x = 1; x <= 12; x++) w.setBlock(x, 40, 0, B.STONE);
      // douze pierres : la treizième case (x = 13) est de l'air -> ça passe tout juste
      var r = K.poussee(w.getBlock, 0, 40, 0, { x: 1, y: 0, z: 0 }, false);
      A.ok(r.ok, 'douze blocs, ça passe');
      A.equal(r.positions.length, 12);
      w.setBlock(13, 40, 0, B.STONE);      // treize blocs pleins désormais : ça bloque
      var r2 = K.poussee(w.getBlock, 0, 40, 0, { x: 1, y: 0, z: 0 }, false);
      A.notOk(r2.ok, 'treize blocs : trop long');
      // le socle (indestructible) ne se pousse jamais
      var w2 = MC.createWorld(80);
      w2.getChunk(0, 0, true);
      w2.setBlock(1, 40, 0, B.BEDROCK);
      var r3 = K.poussee(w2.getBlock, 0, 40, 0, { x: 1, y: 0, z: 0 }, false);
      A.notOk(r3.ok, 'le socle bloque le piston');
    });

    it('SPEC-MECA-001 : un piston étend sa tête sur signal, un collant tire le bloc au retrait', function () {
      var w = MC.createWorld(81);
      w.getChunk(0, 0, true); w.getChunk(-1, 0, true);
      w.setBlock(0, 40, 0, B.PISTON_COLLANT); w.setEtat(0, 40, 0, 0);   // orientation 0 = +x
      w.setBlock(-1, 40, 0, B.BOUTON_CIRCUIT); w.setEtat(-1, 40, 0, 1); // source de signal
      w.setBlock(1, 40, 0, B.STONE);
      var api = { getBlock: w.getBlock, getEtat: w.getEtat, setEtat: w.setEtat, setBlock: w.setBlock };
      var pos = [[-1, 40, 0, B.BOUTON_CIRCUIT], [0, 40, 0, B.PISTON_COLLANT]];
      K.tick(pos, api, {});
      A.equal(w.getBlock(1, 40, 0), B.TETE_PISTON, 'la tête s’étend dans la case poussée');
      A.equal(w.getBlock(2, 40, 0), B.STONE, 'la pierre a été poussée d’un cran');
      w.setEtat(-1, 40, 0, 0);                                          // signal retombé : rétraction
      pos = [[-1, 40, 0, B.BOUTON_CIRCUIT], [0, 40, 0, w.getBlock(0, 40, 0)]];
      K.tick(pos, api, {});
      A.equal(w.getBlock(1, 40, 0), B.STONE, 'collant : la pierre est ramenée contre le piston');
      A.equal(w.getBlock(2, 40, 0), 0, 'et sa case d’origine se vide');
    });

    it('SPEC-MECA-001 : la traction (piston collant) ne tire qu’un bloc repoussable', function () {
      var w = MC.createWorld(84);
      w.getChunk(0, 0, true);
      w.setBlock(0, 40, 0, B.STONE);
      var tir = K.traction(w.getBlock, 0, 40, 0, { x: 1, y: 0, z: 0 });
      A.ok(tir, 'une pierre se tire');
      A.deep(tir.vers, [-1, 40, 0]);
      w.setBlock(1, 40, 0, B.BEDROCK);
      A.equal(K.traction(w.getBlock, 1, 40, 0, { x: 1, y: 0, z: 0 }), null, 'le socle ne se tire pas');
    });

    it('SPEC-MECA-001 : un distributeur éjecte sur front montant du signal (une fois par activation)', function () {
      var w = MC.createWorld(86);
      w.getChunk(0, 0, true);
      w.setBlock(0, 40, 0, B.DISTRIBUTEUR);
      w.setBlock(1, 40, 0, B.BOUTON_CIRCUIT); w.setEtat(1, 40, 0, 0);
      var api = { getBlock: w.getBlock, getEtat: w.getEtat, setEtat: w.setEtat, setBlock: w.setBlock };
      var pos = [[0, 40, 0, B.DISTRIBUTEUR], [1, 40, 0, B.BOUTON_CIRCUIT]];
      var appels = [];
      var ctx = { onDistribuer: function (x, y, z) { appels.push([x, y, z]); } };
      K.tick(pos, api, ctx);
      A.equal(appels.length, 0, 'signal encore bas : rien');
      w.setEtat(1, 40, 0, 1);
      K.tick(pos, api, ctx);
      A.equal(appels.length, 1, 'front montant : une éjection');
      A.deep(appels[0], [0, 40, 0]);
      K.tick(pos, api, ctx);
      A.equal(appels.length, 1, 'signal resté haut : pas de deuxième éjection');
      w.setEtat(1, 40, 0, 0);
      K.tick(pos, api, ctx);
      w.setEtat(1, 40, 0, 1);
      K.tick(pos, api, ctx);
      A.equal(appels.length, 2, 'un nouveau front montant en déclenche une autre');
    });
  });

  describe('SPEC-MECA-007 : blocs de commande', function () {
    it('SPEC-MECA-007 : seuls un administrateur en ligne ou le créatif hors ligne posent ou modifient', function () {
      A.ok(K.commandeAutorisee({ enLigne: true, role: 'admin' }));
      A.notOk(K.commandeAutorisee({ enLigne: true, role: 'moderateur' }));
      A.notOk(K.commandeAutorisee({ enLigne: true, role: null }));
      A.ok(K.commandeAutorisee({ enLigne: false, mode: 'creatif' }));
      A.notOk(K.commandeAutorisee({ enLigne: false, mode: 'survie' }));
      // SPEC-ARCHI-033 : une seule règle pour le solo fermé et le réseau — administrateur,
      // ou hôte local en créatif ; jamais un joueur distant, jamais l'hôte en survie
      A.ok(K.commandeAutorisee({ enLigne: true, role: null, mode: 'creatif', hote: true }));
      A.notOk(K.commandeAutorisee({ enLigne: true, role: null, mode: 'creatif', hote: false }));
      A.notOk(K.commandeAutorisee({ enLigne: true, role: null, mode: 'survie', hote: true }));
      A.ok(K.commandeAutorisee({ enLigne: true, role: 'admin', mode: 'survie', hote: false }));
      A.ok(K.commandeDeclenche(1, 0), 'front montant : déclenche');
      A.notOk(K.commandeDeclenche(1, 1), 'signal déjà haut : pas de nouveau déclenchement');
      A.notOk(K.commandeDeclenche(0, 1), 'front descendant : rien');
    });

    it('SPEC-MECA-007 : un bloc de commande exécute sur front montant, une fois par activation', function () {
      var w = MC.createWorld(87);
      w.getChunk(0, 0, true);
      w.setBlock(0, 40, 0, B.BLOC_COMMANDE);
      w.setBlock(1, 40, 0, B.LEVIER_CIRCUIT); w.setEtat(1, 40, 0, 0);
      var api = { getBlock: w.getBlock, getEtat: w.getEtat, setEtat: w.setEtat, setBlock: w.setBlock };
      var pos = [[0, 40, 0, B.BLOC_COMMANDE], [1, 40, 0, B.LEVIER_CIRCUIT]];
      var appels = [];
      var ctx = { onCommande: function (x, y, z) { appels.push([x, y, z]); } };
      K.tick(pos, api, ctx);
      A.equal(appels.length, 0);
      w.setEtat(1, 40, 0, 1);
      K.tick(pos, api, ctx);
      A.equal(appels.length, 1, 'front montant : exécution');
      K.tick(pos, api, ctx);
      A.equal(appels.length, 1, 'signal resté haut : pas de ré-exécution');
    });

    it('SPEC-MECA-007 : la commande d’un bloc se stocke sur le monde et se relit telle quelle (world.getCommande/setCommande)', function () {
      var w = MC.createWorld(88);
      w.getChunk(0, 0, true);
      A.equal(w.getCommande(2, 40, 2), '', 'aucune commande par défaut');
      w.setCommande(2, 40, 2, '/jour');
      A.equal(w.getCommande(2, 40, 2), '/jour');
      w.setCommande(2, 40, 2, '');
      A.equal(w.getCommande(2, 40, 2), '', 'une commande vide efface');
    });
  });

  describe('SPEC-MECA-008 : persistance et autorité du serveur', function () {
    it('SPEC-MECA-008 : l’état d’un mécanisme se sauvegarde (SPEC-SAVE-017) et ne se simule que dans les chunks chargés', function () {
      var w = MC.createWorld(82);
      w.getChunk(0, 0, true);
      w.setBlock(9, 40, 9, B.COMPTEUR_CIRCUIT);
      w.setEtat(9, 40, 9, 5);
      A.equal(w.getEtat(9, 40, 9), 5, 'l’état se relit tel quel');
      A.ok(w.overrides.has('9,40,9'), 'et voyage dans les overrides sauvegardés');
      A.ok(w.etatsOverrides.has('9,40,9'), 'ainsi que son état, séparément (SPEC-SAVE-017)');
      A.ok(K.estCircuit(B.COMPTEUR_CIRCUIT), 'un bloc `circuit` est reconnu comme tel');
      A.notOk(K.estCircuit(B.STONE));
      var api = { getBlock: w.getBlock, getEtat: w.getEtat, setEtat: w.setEtat, setBlock: w.setBlock };
      A.equal(K.forceDe(api, 9, 40, 9), 15, 'compteur à 5 : sortie considérée haute (force pleine)');
      w.setBlock(9, 41, 9, B.CABLE_ENERGIE); w.setEtat(9, 41, 9, 9);
      A.equal(K.forceEnergieDe(api, 9, 41, 9), 9, 'un câble transmet son niveau d’énergie propre');

      // hors ligne, opts.circuits === false désactive la simulation locale :
      // c'est la même convention que l'eau, pour laisser le serveur faire foi
      var w2 = MC.createWorld(83);
      w2.getChunk(0, 0, true);
      w2.setBlock(1, 40, 1, B.BOUTON_CIRCUIT); w2.setEtat(1, 40, 1, 1);
      w2.setBlock(2, 40, 1, B.LAMPE_ETEINTE);
      for (var i = 0; i < 3; i++) w2.tick(0.25, 14, null, { circuits: false });
      A.equal(w2.getBlock(2, 40, 1), B.LAMPE_ETEINTE, 'circuits: false — rien ne bouge localement');
      for (var j = 0; j < 3; j++) w2.tick(0.25, 14, null, {});
      A.equal(w2.getBlock(2, 40, 1), B.LAMPE_ALLUMEE, 'sans cette option, la simulation locale tourne');

      // un mécanisme hors des chunks chargés n'est pas dans le registre exposé
      A.ok(w2.circuits.has('1,40,1'));
      w2.unloadLoin([[50, 50]], 0);
      A.notOk(w2.circuits.has('1,40,1') && w2.estCharge(1, 1), 'déchargé : la simulation l’ignore');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
