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

  describe('SPEC-MECA-002 : éolienne et vent du monde (tic SANS contexte vent, comme le serveur)', function () {
    it('SPEC-MECA-002 : le tic de circuits sans vent explicite ne lève pas et alimente avec le vent réel de l’altitude', function () {
      var w = MC.createWorld(20261004);
      w.getChunk(0, 0, true);
      var y = 120, t = 3000;
      w.setBlock(4, y, 4, B.EOLIENNE);
      var attendu = K.puissanceEolienne(w.meteo.ventEn(t, y), y, 128);
      A.gt(attendu, 0, 'à cette altitude et à cet instant le vent du climat fait tourner l’éolienne');
      // exactement le contexte du serveur : `temps` seulement
      w.tickCircuits({ temps: t });
      A.equal(w.getEtat(4, y, 4), attendu, 'l’éolienne produit selon le vent du monde à son altitude');
      // repli sûr : sans météo ni vent, jamais d’exception, vent nul
      var api = { getBlock: w.getBlock, getEtat: w.getEtat, setEtat: w.setEtat, setBlock: w.setBlock };
      var saveM = MC.Meteo;
      MC.Meteo = undefined;
      try {
        K.tick([[4, y, 4, B.EOLIENNE]], api, { temps: t });
      } finally { MC.Meteo = saveM; }
      A.equal(w.getEtat(4, y, 4), 0, 'vent indisponible : production nulle, sans exception');
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
      w.setEtat(4, 40, 4, 209);
      // cassée : le niveau (lu avant de vider le bloc) voyage sur la pile —
      // exactement ce que player.js fait dans mineTick (voir dataDrop).
      var niveau = w.getEtat(4, 40, 4) & 255;
      A.equal(niveau, 209, 'tout le niveau, au-delà de l\'ancienne borne 15');
      var inv = Inv.create(9);
      inv.setAt(0, { id: B.BATTERIE, n: 1, data: { niveau: niveau } });
      // la pile porte son niveau, y compris après un aller-retour de sauvegarde
      var serial = inv.serialize();
      var inv2 = Inv.create(9);
      inv2.load(serial);
      A.equal(inv2.stackAt(0).data.niveau, 209, 'le niveau survit à la sauvegarde/chargement (SPEC-SAVE-017)');
      // reposée : le niveau stocké sur la pile redevient l’état du bloc (même
      // logique que player.js useOn, sans dépendre du rendu/joueur ici).
      w.setBlock(5, 40, 5, B.BATTERIE);
      w.setEtat(5, 40, 5, inv2.stackAt(0).data.niveau);
      A.equal(w.getEtat(5, 40, 5), 209, 'reposée, la batterie retrouve son niveau');
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
      w.setBlock(7, 40, 5, B.BATTERIE); w.setEtat(7, 40, 5, 200);   // son énergie (sans elle, la lampe ne s'allume pas)
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

  // ─── L29, suite : générateurs, batteries, détecteurs, appareils, autorité ──
  function monde(graine) {
    var w = MC.createWorld(graine);
    w.getChunk(0, 0, true); w.getChunk(-1, 0, true); w.getChunk(0, -1, true); w.getChunk(-1, -1, true); w.getChunk(1, 0, true);
    var api = { getBlock: w.getBlock, getEtat: w.getEtat, setEtat: w.setEtat, setBlock: w.setBlock };
    // un tic sur TOUT le registre des mécanismes chargés (comme world.tickCircuits)
    function tic(ctx) { var pos = []; w.circuits.forEach(function (p) { pos.push(p); }); return K.tick(pos, api, ctx || {}); }
    return { w: w, api: api, tic: tic };
  }

  describe('SPEC-MECA-002 : générateurs dans un réseau (combustible, transport, pertes)', function () {
    it('SPEC-MECA-002 : le générateur thermique brûle son combustible (rappel ctx.bruler) ou tourne près de la lave', function () {
      var m = monde(9101), w = m.w;
      w.setBlock(2, 40, 2, B.GENERATEUR_THERMIQUE);
      var appels = [], stock = 2;
      var ctx = { bruler: function (x, y, z) { appels.push([x, y, z]); if (stock <= 0) return false; stock--; return true; } };
      m.tic(ctx);
      A.equal(w.getEtat(2, 40, 2), 10, 'du combustible brûle : régime du combustible');
      A.deep(appels[0], [2, 40, 2], 'le rappel désigne le générateur qui brûle');
      m.tic(ctx);
      A.equal(w.getEtat(2, 40, 2), 10, 'tant qu’il en reste');
      m.tic(ctx);
      A.equal(w.getEtat(2, 40, 2), 0, 'plus de combustible : plus de production');
      A.equal(appels.length, 3, 'un appel par tic et par générateur, pas plus');
      m.tic({});
      A.equal(w.getEtat(2, 40, 2), 0, 'sans rappel ni combustible, rien');
      w.setBlock(3, 40, 2, B.LAVA);
      var n0 = appels.length;
      m.tic(ctx);
      A.equal(w.getEtat(2, 40, 2), 15, 'la lave voisine suffit : plein régime');
      A.equal(appels.length, n0, 'près de la lave, aucun combustible n’est brûlé');
    });

    it('SPEC-MECA-002 : la roue hydraulique tourne selon le courant de l’eau qui la touche (nature de l’eau, SPEC-EAU-002)', function () {
      var P = MC.Eau.PARAMS;
      A.ok(K.puissanceCourant(P.lac.courant) < K.puissanceCourant(P.riviere.courant), 'une rivière fait mieux tourner qu’un lac');
      A.ok(K.puissanceCourant(P.riviere.courant) < K.puissanceCourant(P.chute.courant), 'une chute mieux qu’une rivière');
      A.equal(K.puissanceCourant(0), 0); A.equal(K.puissanceCourant(1), 15); A.equal(K.puissanceCourant(7), 15, 'bornée');
      var w = MC.createWorld(9111);
      w.getChunk(0, 0, true);
      w.setBlock(2, 40, 2, B.ROUE_HYDRAULIQUE);
      w.tickCircuits({ temps: 0 });
      A.equal(w.getEtat(2, 40, 2), 0, 'à sec : immobile');
      w.setBlock(3, 40, 2, B.EAU_3);
      w.tickCircuits({ temps: 0 });
      A.equal(w.getEtat(2, 40, 2), K.puissanceCourant(P.ecoulement.courant), 'contre une eau qui s’écoule : le courant d’un écoulement');
      w.setBlock(3, 40, 2, B.WATER);
      w.tickCircuits({ temps: 0 });
      var c = w.getChunk(0, 0), nat = c.eau ? c.eau.nature[2 * C.CHUNK_X + 3] : 0;
      var attendu = K.puissanceCourant((P[MC.Eau.NOMS[nat]] || P.lac).courant);
      A.equal(w.getEtat(2, 40, 2), attendu, 'contre une eau dormante : le courant de la nature de sa colonne (' + (MC.Eau.NOMS[nat] || 'lac, posée') + ')');
      A.ok(attendu < K.puissanceCourant(P.ecoulement.courant), 'moins qu’un écoulement');
    });

    it('SPEC-MECA-002 : un générateur alimente un appareil par câble, et un réseau trop long perd trop', function () {
      var m = monde(9102), w = m.w;
      // roue hydraulique : 2 unités au courant 2 ; un tapis en demande 2
      w.setBlock(0, 40, 0, B.ROUE_HYDRAULIQUE);
      w.setBlock(1, 40, 0, B.TAPIS_ROULANT);
      w.setBlock(1, 41, 0, B.LEVIER_CIRCUIT); w.setEtat(1, 41, 0, 1);
      m.tic({ niveauEau: 2 }); m.tic({ niveauEau: 2 });
      A.equal(w.getEtat(1, 40, 0) & 1, 1, 'générateur collé à l’appareil : il tourne');
      // le même tapis, nourri au bout de 30 câbles : la perte de ligne le prive
      w.setBlock(1, 40, 0, 0);
      for (var x = 1; x <= 30; x++) w.setBlock(x, 40, 0, B.CABLE_ENERGIE);
      w.setBlock(31, 40, 0, B.TAPIS_ROULANT);
      w.setBlock(31, 41, 0, B.LEVIER_CIRCUIT); w.setEtat(31, 41, 0, 1);
      for (var t = 0; t < 4; t++) m.tic({ niveauEau: 2 });
      A.equal(w.getEtat(31, 40, 0) & 1, 0, '30 câbles : 2 unités produites, moins de 2 arrivent — le tapis reste arrêté');
      A.equal(K.transporterEnergie(2, 30, K.PERTE_CABLE), 1, 'la perte de ligne est celle de transporterEnergie');
      for (var t2 = 0; t2 < 4; t2++) m.tic({ niveauEau: 7 });
      A.equal(w.getEtat(31, 40, 0) & 1, 1, 'courant plus fort (7 unités) : assez arrive au bout de la ligne');
    });
  });

  describe('SPEC-MECA-003 : batteries dans un réseau', function () {
    it('SPEC-MECA-003 : la batterie se charge du surplus d’un générateur, à débit borné, jusqu’à sa capacité', function () {
      var m = monde(9103), w = m.w;
      A.equal(C.etatMaxDe(B.BATTERIE), K.CAPACITE_BATTERIE, 'le niveau tient dans l’état du bloc');
      A.equal(K.CAPACITE_BATTERIE, 255);
      w.setBlock(0, 40, 0, B.GENERATEUR_THERMIQUE);
      w.setBlock(1, 40, 0, B.CABLE_ENERGIE);
      w.setBlock(2, 40, 0, B.BATTERIE);
      w.setBlock(-1, 40, 0, B.LAVA);
      var vus = [];
      for (var t = 0; t < 6; t++) { m.tic({}); vus.push(w.getEtat(2, 40, 0)); }
      A.equal(K.DEBIT_BATTERIE, 4, 'débit maximal : 4 unités par tic');
      // le générateur s'allume au premier tic (sa production compte au suivant) ; 15 unités
      // arrivent ensuite à chaque tic, mais la batterie n'en prend que 4
      A.deep(vus, [0, 4, 8, 12, 16, 20], 'charge bornée à 4 par tic malgré un surplus de 15');
      w.setEtat(2, 40, 0, 253);
      m.tic({}); m.tic({});
      A.equal(w.getEtat(2, 40, 0), 255, 'et s’arrête à sa capacité');
    });

    it('SPEC-MECA-003 : sans générateur, la batterie se décharge dans l’appareil qu’elle fait tourner, puis il s’arrête', function () {
      var m = monde(9104), w = m.w;
      w.setBlock(0, 40, 0, B.BATTERIE); w.setEtat(0, 40, 0, 3);
      w.setBlock(1, 40, 0, B.LAMPE_ETEINTE);
      w.setBlock(2, 40, 0, B.LEVIER_CIRCUIT); w.setEtat(2, 40, 0, 1);
      m.tic({});
      A.equal(w.getBlock(1, 40, 0), B.LAMPE_ALLUMEE, 'la batterie allume la lampe commandée');
      A.equal(w.getEtat(0, 40, 0), 3 - K.CONSOMMATION.lampe, 'et paie sa consommation');
      m.tic({}); m.tic({});
      A.equal(w.getEtat(0, 40, 0), 0, 'vidée');
      m.tic({});
      A.equal(w.getBlock(1, 40, 0), B.LAMPE_ETEINTE, 'batterie vide : la lampe s’éteint');
      A.equal(w.getEtat(0, 40, 0), 0, 'jamais en dessous de zéro');
      // décharge bornée : deux ascenseurs (3 + 3 unités) sur une seule batterie, débit 4 —
      // un seul est servi, l'autre s'arrête, et la batterie ne cède que 3 (jamais 6)
      var m2 = monde(9112), w2 = m2.w;
      w2.setBlock(5, 40, 5, B.BATTERIE); w2.setEtat(5, 40, 5, 100);
      w2.setBlock(6, 40, 5, B.ASCENSEUR); w2.setBlock(4, 40, 5, B.ASCENSEUR);
      w2.setBlock(6, 41, 5, B.LEVIER_CIRCUIT); w2.setEtat(6, 41, 5, 1);
      w2.setBlock(4, 41, 5, B.LEVIER_CIRCUIT); w2.setEtat(4, 41, 5, 1);
      m2.tic({});
      A.equal((w2.getEtat(6, 40, 5) & 1) + (w2.getEtat(4, 40, 5) & 1), 1, 'demande 6 > débit 4 : un seul ascenseur tourne');
      A.equal(w2.getEtat(5, 40, 5), 97, 'la batterie ne cède que la consommation servie (3), sous son débit');
      m2.tic({});
      A.equal(w2.getEtat(5, 40, 5), 94, 'et ainsi à chaque tic');
      // le levier relâché : plus de demande, la batterie ne bouge plus
      w.setEtat(0, 40, 0, 50); w.setEtat(2, 40, 0, 0);
      m.tic({}); m.tic({});
      A.equal(w.getEtat(0, 40, 0), 50, 'appareil au repos : rien n’est consommé');
    });

    it('SPEC-MECA-003 : le niveau s’affiche en pour cent et une batterie ne s’empile pas avec une autre', function () {
      A.equal(K.texteNiveau(255), '100 %');
      A.equal(K.texteNiveau(0), '0 %');
      A.equal(K.texteNiveau(128), '50 %');
      A.equal(K.texteNiveau(undefined), '0 %');
      A.equal(C.maxStack(B.BATTERIE), 1, 'chaque batterie garde son propre niveau sur sa pile');
    });
  });

  describe('SPEC-MECA-005 : détecteurs et commandes branchés sur le monde', function () {
    it('SPEC-MECA-005 : un levier bascule, un bouton s’enfonce ; rien d’autre ne s’actionne à la main', function () {
      A.equal(K.actionner(B.LEVIER_CIRCUIT, 0), 1);
      A.equal(K.actionner(B.LEVIER_CIRCUIT, 1), 0);
      A.equal(K.actionner(B.BOUTON_CIRCUIT, 0), 1);
      A.equal(K.actionner(B.BOUTON_CIRCUIT, 1), 1, 'un bouton déjà enfoncé le reste');
      A.equal(K.actionner(B.PLAQUE_PRESSION, 0), null, 'une plaque se presse en marchant dessus, pas à la main');
      A.equal(K.actionner(B.LAMPE_ETEINTE, 0), null);
      A.equal(K.actionner(B.STONE, 0), null);
    });

    it('SPEC-MECA-005 : capteurs() calcule le déclencheur de chaque détecteur, et le tic en fait un signal', function () {
      var m = monde(9105), w = m.w;
      var P = { plaque: [0, 40, 0], presence: [4, 40, 0], lumiere: [8, 40, 0], journuit: [12, 40, 0],
                meteo: [0, 40, 4], horloge: [4, 40, 4], eau: [8, 40, 4], bouton: [12, 40, 4] };
      w.setBlock(0, 40, 0, B.PLAQUE_PRESSION); w.setBlock(4, 40, 0, B.DETECTEUR_PRESENCE);
      w.setBlock(8, 40, 0, B.DETECTEUR_LUMIERE); w.setBlock(12, 40, 0, B.DETECTEUR_JOURNUIT);
      w.setBlock(0, 40, 4, B.DETECTEUR_METEO); w.setBlock(4, 40, 4, B.HORLOGE_CIRCUIT);
      w.setBlock(8, 40, 4, B.DETECTEUR_EAU); w.setBlock(12, 40, 4, B.BOUTON_CIRCUIT);
      var pos = []; w.circuits.forEach(function (p) { pos.push(p); });
      function cle(n) { return P[n].join(','); }
      var src = {
        getBlock: w.getBlock, temps: 0, nuit: true,
        entites: [{ x: 0.5, y: 40, z: 0.5, joueur: true }, { x: 6.5, y: 40, z: 0.5 }],
        lumiereEn: function (x) { return x === 8 ? 12 : 0; },
        pluieEn: function () { return false; }, ventEn: function () { return { x: 0, z: 0 }; },
        appuyes: {},
      };
      src.appuyes[cle('bouton')] = true;
      var d = K.capteurs(pos, src);
      A.equal(d[cle('plaque')].presents, 1, 'un joueur debout sur la plaque');
      A.equal(d[cle('presence')].proches, 1, 'une créature à deux blocs du détecteur de présence');
      A.equal(d[cle('lumiere')].niveau, 12);
      A.equal(d[cle('journuit')].nuit, true);
      A.equal(d[cle('bouton')].appuye, true);
      A.equal(d[cle('eau')].niveauEau, 0, 'pas d’eau à côté');
      m.tic({ detecteurs: d });
      ['plaque', 'presence', 'lumiere', 'journuit', 'horloge', 'bouton'].forEach(function (n) {
        A.equal(w.getEtat(P[n][0], P[n][1], P[n][2]), 1, n + ' : signal haut');
      });
      A.equal(w.getEtat(0, 40, 4), 0, 'ni pluie ni vent : détecteur météo bas');
      A.equal(w.getEtat(8, 40, 4), 0, 'détecteur d’eau bas');
      // tout retombe : personne, nuit finie, beau temps mais grand vent, eau posée, bouton relâché
      w.setBlock(9, 40, 4, B.WATER);
      src.entites = []; src.nuit = false; src.temps = 1.5; src.appuyes = {};
      src.ventEn = function () { return { x: 3, z: 0 }; };
      m.tic({ detecteurs: K.capteurs(pos, src) });
      ['plaque', 'presence', 'journuit', 'horloge', 'bouton'].forEach(function (n) {
        A.equal(w.getEtat(P[n][0], P[n][1], P[n][2]), 0, n + ' : signal retombé');
      });
      A.equal(w.getEtat(0, 40, 4), 1, 'grand vent : détecteur météo haut');
      A.equal(w.getEtat(8, 40, 4), 1, 'eau voisine : détecteur d’eau haut');
      // la plaque ne compte que ce qui est SUR elle
      var d2 = K.capteurs(pos, { entites: [{ x: 0.5, y: 43, z: 0.5 }, { x: 1.5, y: 40, z: 0.5 }] });
      A.equal(d2[cle('plaque')].presents, 0, 'au-dessus ou à côté de la plaque : pas pressée');
    });

    it('SPEC-MECA-005 : world.tickCircuits fournit lui-même jour/nuit, horloge, eau et lumière ; les entités et boutons viennent de l’appelant', function () {
      var m = monde(9106), w = m.w;
      w.setBlock(2, 40, 2, B.DETECTEUR_JOURNUIT);
      w.setBlock(4, 40, 2, B.PLAQUE_PRESSION);
      w.setBlock(6, 40, 2, B.BOUTON_CIRCUIT);
      var NUIT = MC.DayCycle.DAY_LENGTH * 0.75, JOUR = MC.DayCycle.DAY_LENGTH * 0.25;
      A.ok(MC.DayCycle.isNight(NUIT) && !MC.DayCycle.isNight(JOUR), 'préparation : instants de nuit et de jour');
      w.tickCircuits({ temps: NUIT, entites: [{ x: 4.5, y: 40, z: 2.5 }], boutons: { '6,40,2': true } });
      A.equal(w.getEtat(2, 40, 2), 1, 'la nuit, le détecteur jour/nuit émet');
      A.equal(w.getEtat(4, 40, 2), 1, 'quelqu’un sur la plaque');
      A.equal(w.getEtat(6, 40, 2), 1, 'bouton enfoncé');
      w.tickCircuits({ temps: JOUR, entites: [], boutons: {} });
      A.equal(w.getEtat(2, 40, 2), 0, 'le jour, il se tait');
      A.equal(w.getEtat(4, 40, 2), 0, 'plaque libérée');
      A.equal(w.getEtat(6, 40, 2), 0, 'bouton relâché');
    });
  });

  describe('SPEC-MECA-006 : appareils alimentés en énergie', function () {
    it('SPEC-MECA-006 : une lampe commandée mais sans énergie reste éteinte ; alimentée, elle s’allume', function () {
      var m = monde(9107), w = m.w;
      w.setBlock(5, 40, 5, B.LEVIER_CIRCUIT); w.setEtat(5, 40, 5, 1);
      w.setBlock(6, 40, 5, B.LAMPE_ETEINTE);
      m.tic({});
      A.equal(w.getBlock(6, 40, 5), B.LAMPE_ETEINTE, 'signal sans énergie : éteinte');
      w.setBlock(6, 41, 5, B.BATTERIE); w.setEtat(6, 41, 5, 100);
      m.tic({});
      A.equal(w.getBlock(6, 40, 5), B.LAMPE_ALLUMEE, 'énergie et signal : allumée');
      A.ok(w.getEtat(6, 41, 5) < 100, 'l’énergie est consommée');
      w.setBlock(6, 41, 5, 0);
      m.tic({});
      A.equal(w.getBlock(6, 40, 5), B.LAMPE_ETEINTE, 'source retirée : elle s’arrête');
    });

    it('SPEC-MECA-006 : l’énergie seule ne signale rien (un générateur ou une batterie n’allume pas une lampe sans commande)', function () {
      var m = monde(9108), w = m.w;
      w.setBlock(0, 40, 0, B.BATTERIE); w.setEtat(0, 40, 0, 201);   // niveau impair : l’ancien bit 0 faisait signal
      w.setBlock(1, 40, 0, B.LAMPE_ETEINTE);
      m.tic({}); m.tic({});
      A.equal(w.getBlock(1, 40, 0), B.LAMPE_ETEINTE, 'pas de commande, pas de lumière');
      A.equal(K.forceDe(m.api, 0, 40, 0), 0, 'une batterie n’est pas un signal');
      A.equal(w.getEtat(0, 40, 0), 201, 'et rien n’est consommé');
    });

    it('SPEC-MECA-006 : tapis roulant et ascenseur tournent alimentés et commandés, et déplacent le joueur ; l’alarme sonne', function () {
      var m = monde(9109), w = m.w;
      // de l'air au-dessus des appareils (le monde généré est plein à cette hauteur)
      for (var cx = -1; cx <= 9; cx++) for (var cz = -2; cz <= 2; cz++) for (var cy = 41; cy <= 62; cy++) w.setBlock(cx, cy, cz, 0);
      // tapis orienté vers l’est (orientation 1 dans les bits 1-2), alimenté et commandé
      w.setBlock(0, 40, 0, B.TAPIS_ROULANT); w.setEtat(0, 40, 0, 1 << 1);
      w.setBlock(0, 40, 1, B.BATTERIE); w.setEtat(0, 40, 1, 200);
      w.setBlock(0, 40, -1, B.LEVIER_CIRCUIT); w.setEtat(0, 40, -1, 1);
      w.setBlock(4, 40, 0, B.ASCENSEUR);
      w.setBlock(4, 40, 1, B.BATTERIE); w.setEtat(4, 40, 1, 200);
      w.setBlock(4, 40, -1, B.LEVIER_CIRCUIT); w.setEtat(4, 40, -1, 1);
      w.setBlock(8, 40, 0, B.ALARME);
      w.setBlock(8, 40, 1, B.LEVIER_CIRCUIT); w.setEtat(8, 40, 1, 1);
      m.tic({});
      A.equal(w.getEtat(0, 40, 0), 3, 'tapis en marche (bit 0), orientation gardée');
      A.equal(w.getEtat(4, 40, 0), 1, 'ascenseur en marche');
      A.equal(w.getEtat(8, 40, 0), 0, 'alarme commandée mais sans énergie : muette');
      w.setBlock(8, 40, -1, B.BATTERIE); w.setEtat(8, 40, -1, 200);
      m.tic({});
      A.equal(w.getEtat(8, 40, 0), 1, 'alimentée : elle sonne');
      var surTapis = K.effetMecanique(w.getBlock, w.getEtat, { x: 0.5, y: 41, z: 0.5 });
      A.gt(surTapis.x, 0, 'le tapis pousse vers l’est'); A.equal(surTapis.z, 0);
      var dansColonne = K.effetMecanique(w.getBlock, w.getEtat, { x: 4.5, y: 45, z: 0.5 });
      A.gt(dansColonne.y, 0, 'au-dessus d’un ascenseur en marche, on monte');
      A.equal(K.effetMecanique(w.getBlock, w.getEtat, { x: 4.5, y: 60, z: 0.5 }).y, 0, 'trop haut : plus d’effet');
      // le joueur réel est porté par le tapis, sans toucher une touche
      var pl = MC.createPlayer(w, MC.createEntities(w));
      pl.state.pos = { x: 0.5, y: 41, z: 0.5 }; pl.state.onGround = true; pl.state.vel = { x: 0, y: 0, z: 0 };
      for (var i = 0; i < 10; i++) pl.updateMovement(0.05, {});
      A.gt(pl.state.pos.x, 0.7, 'emporté vers l’est : x = ' + pl.state.pos.x.toFixed(3));
      // un objet posé sur le tapis part aussi (joueur de référence loin : pas d'aimantation)
      var ents = MC.createEntities(w), loin = MC.createPlayer(w, ents);
      loin.state.pos = { x: 40, y: 41, z: 40 };
      var obj = ents.dropItem(0.5, 41.05, 0.5, B.COBBLE, 1);
      obj.vel = { x: 0, y: 0, z: 0 };
      for (var q = 0; q < 6; q++) ents.update(0.05, loin.state);
      A.gt(obj.pos.x, 0.7, 'un objet au sol sur le tapis est emporté aussi : x = ' + obj.pos.x.toFixed(3));
      // arrêté (levier relâché), le tapis ne porte plus
      w.setEtat(0, 40, -1, 0); m.tic({});
      A.equal(w.getEtat(0, 40, 0), 2, 'tapis arrêté, orientation gardée');
      A.equal(K.effetMecanique(w.getBlock, w.getEtat, { x: 0.5, y: 41, z: 0.5 }).x, 0, 'tapis arrêté : aucun effet');
      // le joueur au-dessus de l’ascenseur monte
      var p2 = MC.createPlayer(w, MC.createEntities(w));
      p2.state.pos = { x: 4.5, y: 41, z: 0.5 }; p2.state.onGround = true; p2.state.vel = { x: 0, y: 0, z: 0 };
      for (var k = 0; k < 10; k++) p2.updateMovement(0.05, {});
      A.gt(p2.state.pos.y, 41.5, 'l’ascenseur soulève le joueur : y = ' + p2.state.pos.y.toFixed(3));
    });
  });

  describe('SPEC-MECA-008 : registres, rechargement et état de pose décidé par le serveur', function () {
    it('SPEC-MECA-008 : rebuildRegistries (après un chargement) et reset gardent les portes et trappes dans le registre', function () {
      var w = MC.createWorld(9110);
      w.getChunk(0, 0, true);
      // comme un chargement de sauvegarde : overrides remplis sans passer par setBlock
      w.overrides.set('3,40,3', B.PORTE_FERMEE_N);
      w.overrides.set('5,40,3', B.TRAPPE_FERMEE);
      w.overrides.set('7,40,3', B.LEVIER_CIRCUIT);
      w.rebuildRegistries();
      A.ok(w.circuits.has('7,40,3'), 'un mécanisme rechargé est simulé');
      A.ok(w.circuits.has('3,40,3'), 'une porte rechargée aussi (un signal peut l’ouvrir)');
      A.ok(w.circuits.has('5,40,3'), 'une trappe rechargée aussi');
      w.reset();
      A.equal(w.circuits.size, 0, 'remise à zéro du monde : plus aucun mécanisme de l’ancienne partie');
    });

    it('SPEC-MECA-008 : l’état d’un mécanisme qui change à chaque tic ne refait pas le maillage ; celui d’une forme, si', function () {
      var w = MC.createWorld(9113);
      w.getChunk(0, 0, true);
      var c = w.getChunk(0, 0);
      w.setBlock(3, 40, 3, B.BATTERIE); w.setBlock(5, 40, 3, B.ESCALIER_STONE);
      c.dirty = false; var v0 = c.version;
      w.setEtat(3, 40, 3, 120);
      A.equal(w.getEtat(3, 40, 3), 120, 'l’état est bien écrit');
      A.ok(!c.dirty && c.version === v0, 'niveau de batterie : pas de nouveau maillage du chunk');
      w.setEtat(5, 40, 3, 2);
      A.ok(c.dirty && c.version !== v0, 'orientation d’un escalier : le chunk se remaille');
    });

    it('SPEC-MECA-005 : le capteur de lumière suit les sources posées et retirées (cache du registre des lumières)', function () {
      var w = MC.createWorld(9114);
      w.getChunk(0, 0, true);
      for (var y = 41; y < C.WORLD_H; y++) w.setBlock(4, y, 4, B.STONE);   // pas de ciel : seules les sources comptent
      w.setBlock(4, 40, 4, B.DETECTEUR_LUMIERE);
      w.tickCircuits({ temps: 0 });
      A.equal(w.getEtat(4, 40, 4), 0, 'dans le noir : bas');
      w.setBlock(5, 40, 4, B.TORCH);
      w.tickCircuits({ temps: 0 });
      A.equal(w.getEtat(4, 40, 4), 1, 'une torche à côté : haut (le cache suit le registre)');
      w.setBlock(5, 40, 4, 0);
      w.tickCircuits({ temps: 0 });
      A.equal(w.getEtat(4, 40, 4), 0, 'torche retirée : bas de nouveau');
    });

    it('SPEC-MECA-008 : l’état d’un mécanisme posé est décidé par le serveur, jamais repris tel quel du client', function () {
      A.equal(K.etatDePose(B.LEVIER_CIRCUIT, 1), 0, 'un levier se pose relâché');
      A.equal(K.etatDePose(B.LAMPE_ETEINTE, 1), 0);
      A.equal(K.etatDePose(B.EOLIENNE, 15), 0, 'un générateur ne se pose pas déjà lancé');
      A.equal(K.etatDePose(B.COMPTEUR_CIRCUIT, 9), 0);
      A.equal(K.etatDePose(B.PISTON, 3 | 8), 3, 'piston : orientation gardée, jamais déjà sorti');
      A.equal(K.etatDePose(B.PISTON, 7), 0, 'orientation hors des six directions : 0');
      A.equal(K.etatDePose(B.TAPIS_ROULANT, 7), 6, 'tapis : orientation gardée, jamais déjà en marche');
      A.equal(K.etatDePose(B.BATTERIE, 9, 120), 120, 'batterie : le niveau de la PILE du serveur');
      A.equal(K.etatDePose(B.BATTERIE, 9, 999), 255, 'borné à la capacité');
      A.equal(K.etatDePose(B.BATTERIE, 9, 'x'), 0, 'pile sans niveau : vide');
      A.equal(K.etatDePose(B.STONE, 4), null, 'pas un mécanisme : rien à dire');
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
      w2.setBlock(3, 40, 1, B.BATTERIE); w2.setEtat(3, 40, 1, 200);   // l'énergie de la lampe
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
