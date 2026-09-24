/* spec-economie.js — SPEC-ECO-001 à 007 et SPEC-SYNC-023 : prix dynamiques,
   trésors de lieux, commerce serveur-autoritaire (src/economie.js). */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var Eco = MC.Economie;
  var C = MC.Core, I = C.I, B = C.B;

  function inv() { return MC.Inventory.create(); }
  function o(give, get) { return { give: give, get: get }; }
  function e(n) { return { id: I.EMERALD, n: n }; }

  describe('Specs — économie', function () {
    it('SPEC-ECO-001 : 20 achats — prix strictement croissant puis plafonné à +60 %', function () {
      var etat = Eco.creerEtat(10);
      var L = Eco.lieuDe(etat, { id: 'l1', biome: 'plaines', x: 0, z: 0 });
      L.stocks[I.IRON_INGOT] = { stock: 64, ref: 64 };
      var offre = o([e(1)], { id: I.IRON_INGOT, n: 1 });
      var base = Eco.prixCourant(etat, 'l1', offre);
      var dernier = -Infinity, plafond = base * 1.6, vuPlafond = false;
      for (var k = 0; k < 20; k++) {
        var p = Eco.prixCourant(etat, 'l1', offre);
        A.ok(p >= dernier - 1e-9, 'le prix ne baisse jamais pendant les achats (' + p + ' après ' + dernier + ')');
        A.ok(p <= plafond + 1e-9, 'jamais au-delà de +60% (' + p + ' > ' + plafond + ')');
        if (Math.abs(p - plafond) < 1e-6) vuPlafond = true;
        dernier = p;
        Eco.acheter(etat, 'l1', I.IRON_INGOT, 4);
      }
      A.ok(vuPlafond, 'le plafond de +60% est bien atteint après assez d\'achats');
    });

    it('SPEC-ECO-001 : 20 ventes — prix décroissant puis plancher à -60 %', function () {
      var etat = Eco.creerEtat(11);
      var L = Eco.lieuDe(etat, { id: 'l2', biome: 'plaines', x: 0, z: 0 });
      L.stocks[I.WHEAT] = { stock: 64, ref: 64 };
      var offre = o([{ id: I.WHEAT, n: 1 }], e(1));
      var base = Eco.prixCourant(etat, 'l2', offre);
      var dernier = Infinity, plancher = base * 0.4, vuPlancher = false;
      for (var k = 0; k < 20; k++) {
        var p = Eco.prixCourant(etat, 'l2', offre);
        A.ok(p <= dernier + 1e-9, 'le prix ne monte jamais pendant les ventes');
        A.ok(p >= plancher - 1e-9, 'jamais sous -60%');
        if (Math.abs(p - plancher) < 1e-6) vuPlancher = true;
        dernier = p;
        Eco.vendre(etat, 'l2', I.WHEAT, 6);
      }
      A.ok(vuPlancher, 'le plancher de -60% est bien atteint après assez de ventes');
    });

    it('SPEC-ECO-001 : le lot conclu suit le prix (arrondi d\'au plus une unité, jamais zéro)', function () {
      var offre = o([{ id: I.WHEAT, n: 8 }], e(1));
      [0.01, 0.4, 0.5, 0.51, 1.2, 5.49, 5.5].forEach(function (prix) {
        var lot = Eco.lotExecute(offre, prix);
        A.ok(lot.get.n >= 1, 'jamais zéro émeraude (prix=' + prix + ')');
        A.ok(Math.abs(lot.get.n - prix) <= 1 + 1e-9, 'arrondi d\'au plus une unité (prix=' + prix + ', lot=' + lot.get.n + ')');
      });
    });

    it('SPEC-ECO-001 : ressourceDe/estAchat identifient le côté non-émeraude d\'une offre', function () {
      var achat = o([e(1)], { id: I.IRON_INGOT, n: 3 });
      var vente = o([{ id: I.WHEAT, n: 8 }], e(1));
      A.ok(Eco.estAchat(achat), 'give = [émeraude] → achat');
      A.ok(!Eco.estAchat(vente), 'give = ressource → vente');
      A.deep(Eco.ressourceDe(achat), { id: I.IRON_INGOT, n: 3 }, 'achat : la ressource est ce qui est reçu');
      A.deep(Eco.ressourceDe(vente), { id: I.WHEAT, n: 8 }, 'vente : la ressource est ce qui est cédé');
    });

    it('SPEC-ECO-002 : catégorieDe classe les objets pour le référentiel de prix', function () {
      A.equal(Eco.categorieDe(I.WHEAT), 'nourriture');
      A.equal(Eco.categorieDe(I.APPLE), 'nourriture');
      A.equal(Eco.categorieDe(B.LOG), 'bois');
      A.equal(Eco.categorieDe(I.IRON_INGOT), 'minerai');
      A.equal(Eco.categorieDe(I.COAL), 'minerai');
      A.equal(Eco.categorieDe(I.DIAMOND), 'gemme');
      A.equal(Eco.categorieDe(I.IRON_SWORD), 'outil');
      A.equal(Eco.categorieDe(I.EMERALD), null, 'sans catégorie connue : le prix de base par défaut s\'applique');
    });

    it('SPEC-ECO-002 : même graine, deux biomes — prix de base distincts et reproductibles', function () {
      var p1a = Eco.prixBaseRegional(I.IRON_INGOT, { biome: 'plaines' });
      var p1b = Eco.prixBaseRegional(I.IRON_INGOT, { biome: 'plaines' });
      A.close(p1a, p1b, 1e-9, 'reproductible');
      var p2 = Eco.prixBaseRegional(I.IRON_INGOT, { biome: 'desert' });
      A.ok(p1a !== p2, 'deux biomes distincts donnent (presque toujours) des prix distincts');
      A.ok(p1a > 0 && p2 > 0, 'toujours positif');
    });

    it('SPEC-ECO-003 : 100 jours simulés — masse à ±20 %, pente des 50 derniers jours bornée', function () {
      var r = Eco.simuler({ graine: 42, jours: 100 });
      A.equal(r.masses.length, 100);
      r.masses.forEach(function (m, i) {
        A.ok(m >= r.initiale * 0.8 && m <= r.initiale * 1.2, 'jour ' + i + ' : masse ' + m + ' hors bornes (initiale ' + r.initiale + ')');
      });
      var pente = Math.abs(r.masses[99] - r.masses[50]) / 50;
      A.ok(pente < r.initiale * 0.02, 'pente des 50 derniers jours bornée : ' + pente);
    });

    it('SPEC-ECO-004 : cargaison cohérente avec les offres d\'origine ; stocks des deux lieux déplacés ; départ rejoué sans effet', function () {
      var etat = Eco.creerEtat(20);
      var Lo = Eco.lieuDe(etat, { id: 'o', biome: 'plaines', x: 0, z: 0 });
      var Ld = Eco.lieuDe(etat, { id: 'd', biome: 'plaines', x: 300, z: 0 });
      Lo.stocks[I.WHEAT] = { stock: 90, ref: 64 };
      Ld.stocks[I.WHEAT] = { stock: 20, ref: 64 };
      var trajet = { id: 'r:o>d' };
      var avantO = Lo.stocks[I.WHEAT].stock, avantD = Ld.stocks[I.WHEAT].stock;
      var r = Eco.passageCaravane(etat, trajet, 3, { origine: Lo, destination: Ld });
      A.gt(r.n, 0, 'du surplus déplacé');
      A.equal(Lo.stocks[I.WHEAT].stock, avantO - r.n, 'origine débitée');
      A.equal(Ld.stocks[I.WHEAT].stock, avantD + r.n, 'destination créditée');
      var rejoue = Eco.passageCaravane(etat, trajet, 3, { origine: Lo, destination: Ld });
      A.equal(rejoue.n || 0, 0, 'même départ rejoué : sans effet (idempotent)');
      A.equal(Lo.stocks[I.WHEAT].stock, avantO - r.n, 'stock inchangé après le rejeu');
    });

    it('SPEC-ECO-005 : frais de garde exact, plafonné, nul sous 32 ; aller-retour de sauvegarde', function () {
      var slots = new Array(27).fill(null);
      slots[0] = { id: I.EMERALD, n: 20 };
      A.equal(Eco.appliquerFraisBanque(slots, 1), 0, 'sous 32 objets au total : rien');
      var s2 = new Array(27).fill(null);
      s2[0] = { id: I.WHEAT, n: 64 };       // 2 tranches de 32
      s2[1] = { id: I.EMERALD, n: 10 };
      var retire = Eco.appliquerFraisBanque(s2, 1);
      A.equal(retire, 2, '2 tranches → 2 émeraudes/jour');
      A.equal(s2[1].n, 8, 'prélevé sur la pile d\'émeraude');
      var s3 = new Array(27).fill(null);
      s3[0] = { id: I.WHEAT, n: 999 };      // 31 tranches, plafonné à 4/jour
      s3[1] = { id: I.EMERALD, n: 100 };
      var r3 = Eco.appliquerFraisBanque(s3, 3);
      A.equal(r3, 12, 'plafonné à 4/jour, 3 jours');

      var etat = Eco.creerEtat(99);
      var L = Eco.lieuDe(etat, { id: 'sav', biome: 'plaines', x: 5, z: 5 });
      L.stocks[I.WHEAT] = { stock: 40, ref: 64 };
      L.tresor = 123;
      var data = Eco.serialiser(etat);
      var recharge = Eco.charger(JSON.parse(JSON.stringify(data)));
      var L2 = Eco.lieuDe(recharge, 'sav', {});
      A.equal(L2.tresor, 123, 'trésor conservé');
      A.equal(L2.stocks[I.WHEAT].stock, 40, 'stock conservé');
    });

    it('SPEC-ECO-006 : cours = moyenne des prix courants du rayon, suit une variation', function () {
      var etat = Eco.creerEtat(30);
      var L1 = Eco.lieuDe(etat, { id: 'c1', biome: 'plaines', x: 0, z: 0 });
      var L2 = Eco.lieuDe(etat, { id: 'c2', biome: 'plaines', x: 10, z: 0 });
      L1.stocks[I.WHEAT] = { stock: 64, ref: 64 };
      L2.stocks[I.WHEAT] = { stock: 64, ref: 64 };
      var cours1 = Eco.coursRegional(etat, 0, 0, 50);
      var ligne = cours1.filter(function (c) { return c.id === I.WHEAT; })[0];
      A.ok(ligne, 'le blé apparaît dans le cours');
      Eco.vendre(etat, 'c1', I.WHEAT, 40);
      var cours2 = Eco.coursRegional(etat, 0, 0, 50);
      var ligne2 = cours2.filter(function (c) { return c.id === I.WHEAT; })[0];
      A.ok(ligne2.prix !== ligne.prix, 'le cours suit la variation du stock');
      var loin = Eco.coursRegional(etat, 100000, 100000, 5);
      A.equal(loin.length, 0, 'rien hors du rayon');
    });

    it('SPEC-ECO-007 : vendre le butin d\'un donjon fait baisser le prix comme une vente ordinaire', function () {
      var etat = Eco.creerEtat(40);
      Eco.lieuDe(etat, { id: 'l7', biome: 'plaines', x: 0, z: 0 });
      var offre = o([{ id: I.DIAMOND, n: 1 }], e(4));
      var avant = Eco.prixCourant(etat, 'l7', offre);
      Eco.vendre(etat, 'l7', I.DIAMOND, 8);      // butin de donjon, vendu comme n'importe quelle ressource
      var apres = Eco.prixCourant(etat, 'l7', offre);
      A.lt(apres, avant, 'le prix baisse après la vente du butin');
    });

    it('SPEC-SYNC-023 : executerTroc — objet manquant, stock nul, trésor vide, inventaire plein : refus sans effet', function () {
      var etat = Eco.creerEtat(50);
      var L = Eco.lieuDe(etat, { id: 's1', biome: 'plaines', x: 0, z: 0 });

      // objet manquant (le joueur n'a pas de blé à vendre)
      var i1 = inv();
      var r1 = Eco.executerTroc(etat, i1, { lieuId: 's1', role: 'fermier', pnjId: 's1#0', indice: 0, fois: 1 });
      A.ok(!r1.ok && r1.motif === 'absent', 'refus absent : ' + JSON.stringify(r1));
      A.equal(i1.count(I.EMERALD), 0, 'aucun effet');

      // stock nul (achat de verre sans stock au village)
      var etatAchat = Eco.creerEtat(51);
      var La = Eco.lieuDe(etatAchat, { id: 'a1', biome: 'plaines', x: 0, z: 0 });
      La.stocks[B.GLASS] = { stock: 0, ref: 64 };
      var iA = inv(); iA.add(I.EMERALD, 10);
      var rA = Eco.executerTroc(etatAchat, iA, { lieuId: 'a1', role: 'marchand', pnjId: 'a1#0', indice: 1, fois: 1 });
      A.ok(!rA.ok && rA.motif === 'stock', 'refus stock : ' + JSON.stringify(rA));
      A.equal(iA.count(I.EMERALD), 10, 'aucun effet sur l\'inventaire');

      // trésor vide (vente au village sans trésor)
      var etatT = Eco.creerEtat(52);
      var Lt = Eco.lieuDe(etatT, { id: 't1', biome: 'plaines', x: 0, z: 0 });
      Lt.tresor = 0;
      var it = inv(); it.add(I.WHEAT, 40);
      var rt = Eco.executerTroc(etatT, it, { lieuId: 't1', role: 'fermier', pnjId: 't1#0', indice: 0, fois: 1 });
      A.ok(!rt.ok && rt.motif === 'tresor', 'refus trésor : ' + JSON.stringify(rt));
      A.equal(it.count(I.WHEAT), 40, 'le blé n\'a pas été prélevé');

      // inventaire plein (achat sans place pour recevoir)
      var etatP = Eco.creerEtat(53);
      Eco.lieuDe(etatP, { id: 'p1', biome: 'plaines', x: 0, z: 0 });
      var ip = inv();
      for (var s = 0; s < ip.slots.length; s++) ip.setAt(s, { id: I.STICK, n: 64 });
      ip.setAt(0, { id: I.EMERALD, n: 10 });
      var rp = Eco.executerTroc(etatP, ip, { lieuId: 'p1', role: 'guide', pnjId: 'p1#0', indice: 0, fois: 1 });
      A.ok(!rp.ok && rp.motif === 'plein', 'refus plein : ' + JSON.stringify(rp));
    });

    it('SPEC-SYNC-023 : executerTroc valide — inventaire, stock et trésor changés d\'un bloc, transaction conforme au contrat', function () {
      var etat = Eco.creerEtat(60);
      var L = Eco.lieuDe(etat, { id: 'v1', biome: 'plaines', x: 0, z: 0 });
      L.stocks[I.WHEAT] = { stock: 64, ref: 64 };
      var tresorAvant = L.tresor;
      var i = inv(); i.add(I.WHEAT, 40);
      var r = Eco.executerTroc(etat, i, { lieuId: 'v1', role: 'fermier', pnjId: 'v1#0', indice: 0, fois: 1, nom: 'Zoé' });
      A.ok(r.ok, 'réussit : ' + JSON.stringify(r));
      A.ok(MC.ContratsV2.validerTransaction(r.transaction) !== null, 'transaction conforme au contrat');
      A.equal(r.transaction.offre, MC.ContratsV2.offreId('v1', 'fermier', 0));
      A.lt(i.count(I.WHEAT), 40, 'le blé a été débité');
      A.gt(i.count(I.EMERALD), 0, 'des émeraudes ont été reçues');
      A.equal(L.tresor, tresorAvant - r.transaction.prix, 'le trésor du village a payé exactement le prix');
      A.equal(L.stocks[I.WHEAT].stock, 64 + 40 - i.count(I.WHEAT), 'le stock du village a reçu le blé vendu');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
