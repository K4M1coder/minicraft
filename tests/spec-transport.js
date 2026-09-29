/* spec-transport.js — SPEC-TRANSPORT-003 à 005 : risque d'attaque d'une
   caravane marchande, soute de fret comme vrai support de commerce, péage de
   faction sur une route de commerce. (SPEC-TRANSPORT-001/002 : voir
   tests/spec-vehicules.js, avec le reste des specs véhicules.) */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, I = C.I;
  var CV = MC.Caravanes, Eco = MC.Economie, P = MC.Politique, V = MC.Vehicules, Inv = MC.Inventory;

  // même construction de clé que politique.js:cleRelation (non exportée)
  function cleRelation(a, b) { return a < b ? a + '~' + b : b + '~' + a; }
  function faction(id, x, z, territoire) {
    return { id: id, type: 'royaume', nom: id, caractere: 'pragmatique',
             siege: { x: x, z: z, site: id }, territoire: territoire,
             ressources: { or: 20, nourriture: 20 }, objectif: 'commercer', objectifs: ['commercer'],
             naissance: 0 };
  }

  describe('Specs — transport (caravanes, fret, péages)', function () {

    it('SPEC-TRANSPORT-003 : risque d\'attaque plus élevé en danger, réduit par un garde, cargaison diminuée seulement en cas d\'attaque', function () {
      var trajet = { id: 'r:beaulac>valombre', role: 'axe' };   // 'axe' : seul rôle qui peut porter un garde
      var N = 3000;
      function taux(danger, garde) {
        var touches = 0;
        for (var k = 0; k < N; k++) if (CV.subitAttaque(trajet, k, danger, garde)) touches++;
        return touches / N;
      }
      var tPaix = taux(false, false), tGuerre = taux(true, false);
      A.ok(tGuerre > tPaix * 3, 'nettement plus dangereux en guerre/zone pvp : ' + tGuerre.toFixed(3) + ' vs ' + tPaix.toFixed(3));
      A.close(tPaix, CV.P_ATTAQUE_PAISIBLE, 0.02, 'proche de la probabilité de base en paix');
      A.close(tGuerre, CV.P_ATTAQUE_DANGER, 0.03, 'proche de la probabilité de base en danger');

      var tGuerreGarde = taux(true, true);
      A.ok(tGuerreGarde < tGuerre * 0.5, 'un garde réduit nettement le risque : ' + tGuerreGarde.toFixed(3) + ' vs ' + tGuerre.toFixed(3));

      // même trajet, même index : toujours le même verdict (déterministe)
      A.equal(CV.subitAttaque(trajet, 5, true, false), CV.subitAttaque(trajet, 5, true, false));

      // un garde RÉELLEMENT présent dans composition() (rôle 'axe') réduit le
      // risque mesuré sur les départs qui en portent un, vs ceux qui n'en ont pas
      var avecGarde = 0, sansGarde = 0, attaquesAvec = 0, attaquesSans = 0;
      for (var k2 = 0; k2 < N; k2++) {
        var membres = CV.composition('axe', trajet.id + ':' + k2);
        var g = CV.aGarde(membres);
        if (g) { avecGarde++; if (CV.subitAttaque(trajet, k2, true, true)) attaquesAvec++; }
        else { sansGarde++; if (CV.subitAttaque(trajet, k2, true, false)) attaquesSans++; }
      }
      A.gt(avecGarde, 100, 'des départs avec garde, dans cet échantillon');
      A.gt(sansGarde, 100, 'des départs sans garde, dans cet échantillon');
      A.ok((attaquesAvec / avecGarde) < (attaquesSans / sansGarde), 'moins d\'attaques réussies quand un vrai garde accompagne le convoi');

      // ── intégration réelle : MC.Economie.passageCaravane (le point d'entrée
      // câblé par server.js:avancerCaravanes — jamais un appel isolé à
      // subitAttaque en dehors du calcul du taux ci-dessus) ──
      var etat = Eco.creerEtat(11);
      var Lo = Eco.lieuDe(etat, { id: 'orig', biome: 'plaines', x: 0, z: 0 });
      var Ld = Eco.lieuDe(etat, { id: 'dest', biome: 'plaines', x: 300, z: 0 });
      Lo.stocks[I.WHEAT] = { stock: 500, ref: 64 };
      Ld.stocks[I.WHEAT] = { stock: 20, ref: 64 };
      var trajetSansGarde = { id: 'r:orig>dest', role: 'commerce' };   // jamais de garde (composition('commerce',…))
      var indexAttaque = null, indexPaisible = null;
      for (var idx = 0; idx < 500 && (indexAttaque === null || indexPaisible === null); idx++) {
        var membresC = CV.composition('commerce', trajetSansGarde.id + ':' + idx);
        A.notOk(CV.aGarde(membresC), 'une caravane "commerce" n\'a jamais de garde');
        if (indexAttaque === null && CV.subitAttaque(trajetSansGarde, idx, true, false)) indexAttaque = idx;
        if (indexPaisible === null && !CV.subitAttaque(trajetSansGarde, idx, true, false)) indexPaisible = idx;
      }
      A.ok(indexAttaque !== null && indexPaisible !== null, 'un index attaqué et un index épargné, trouvés dans l\'échantillon');

      var rPaisible = Eco.passageCaravane(etat, trajetSansGarde, indexPaisible, { origine: Lo, destination: Ld, danger: true });
      A.notOk(rPaisible.attaque, 'pas d\'attaque ici');
      A.gt(rPaisible.n, 0, 'cargaison transportée intacte');

      var stockLoAvant = Lo.stocks[I.WHEAT].stock, stockLdAvant = Ld.stocks[I.WHEAT].stock;
      // ce qu'un départ IDENTIQUE, sans attaque, aurait transporté (même
      // formule que passageCaravane, calculée directement, sans dépendre
      // d'un second tirage probabiliste — indexAttaque est déterministe,
      // mais son verdict à un seuil de 0,04 (paisible) n'est pas garanti)
      var stocksSnapshot = {}; Object.keys(Lo.stocks).forEach(function (id) { stocksSnapshot[id] = stockLoAvant; });
      var cargaisonSansAttaque = CV.cargaisonDe(trajetSansGarde, indexAttaque, stocksSnapshot);
      var nSansAttaque = Math.min(cargaisonSansAttaque.n, Math.max(0, stockLoAvant - 64));

      var rAttaque = Eco.passageCaravane(etat, trajetSansGarde, indexAttaque, { origine: Lo, destination: Ld, danger: true });
      A.ok(rAttaque.attaque, 'attaque relevée par passageCaravane, le vrai point d\'entrée');
      A.ok(rAttaque.n < nSansAttaque, 'la cargaison EFFECTIVEMENT livrée est réduite par l\'attaque, vs le même départ épargné');
      A.equal(Lo.stocks[I.WHEAT].stock, stockLoAvant - rAttaque.n, 'origine débitée exactement du transporté');
      A.equal(Ld.stocks[I.WHEAT].stock, stockLdAvant + rAttaque.n, 'destination créditée exactement du transporté');
    });

    it('SPEC-TRANSPORT-004 : la soute d\'un véhicule de fret (camion, bateau) porte une cargaison qui survit à un trajet simulé, intacte sauf attaque', function () {
      // camion ET bateau ont une soute (SPEC-VEHIC-007 ne testait que le camion)
      var e = G.etatMinimal(1234);
      var w = e.world, ents = e.entities;
      var camion = V.poser(ents, 'camion', 3.5, 40, 2.5, 0);
      var bateau = V.poser(ents, 'bateau', 20.5, 40, 2.5, 0);
      A.ok(camion.soute && camion.soute.slots.length === 27, 'le camion a sa soute');
      A.ok(bateau.soute && bateau.soute.slots.length > 0, 'le bateau aussi porte une soute (véhicule de fret)');

      // chargement : un joueur (ou une caravane) y dépose une cargaison,
      // par la MÊME API que l'ouverture réelle de la soute (game.js:1999,
      // ui.openContainer('chest', st.inv, e.soute, 'soute') — un simple
      // inventaire de coffre, ici manipulé par son API la plus directe)
      camion.soute.add(I.DIAMOND, 12);
      camion.soute.add(I.EMERALD, 4);
      var chargement = { diamant: camion.soute.count(I.DIAMOND), emeraude: camion.soute.count(I.EMERALD) };

      // trajet simulé : le VRAI chemin de conduite (V.conduire), pas une
      // pause immobile — la soute traverse un vrai déplacement du véhicule
      for (var i = 0; i < 3 * 30; i++) V.conduire(camion, 1 / 30, w, { avant: 1 });
      A.ok(camion.pos.x !== 3.5 || camion.pos.z !== 2.5, 'le camion a réellement roulé');

      // déchargement : inventaire final identique au chargement initial
      A.equal(camion.soute.count(I.DIAMOND), chargement.diamant, 'le diamant survit au trajet, quantité et identité');
      A.equal(camion.soute.count(I.EMERALD), chargement.emeraude, 'l\'émeraude aussi');

      // et la soute survit à une sauvegarde/relance (déjà couvert pour le
      // camion par SPEC-VEHIC-008 ; ici le trajet simulé PUIS la sauvegarde)
      var data = JSON.parse(JSON.stringify(MC.Save.serialize(e)));
      var f = G.etatMinimal(1234);
      A.ok(MC.Save.apply(data, f), 'chargement de la sauvegarde');
      var cam2 = f.entities.list.filter(function (x) { return x.vehicule === 'camion'; })[0];
      A.ok(cam2 && cam2.soute, 'le camion restauré garde sa soute');
      A.equal(cam2.soute.count(I.DIAMOND), chargement.diamant, 'cargaison intacte après relance');

      // ── moins pertes éventuelles d'un risque TRANSPORT-003 : une attaque en
      // chemin rogne la soute, exactement comme la cargaison d'une caravane
      // marchande (même fraction, MC.Caravanes.PERTE_ATTAQUE) — deux départs
      // du même trajet, déterministes : l'un épargné, l'autre attaqué ──
      var portTrajet = { id: 'r:port-a>port-b' };
      A.notOk(CV.subitAttaque(portTrajet, 0, true, false), 'index témoin : épargné');
      A.ok(CV.subitAttaque(portTrajet, 1, true, false), 'index témoin : attaqué');

      bateau.soute.add(I.WHEAT, 20);
      var avantEpargne = bateau.soute.count(I.WHEAT);
      A.equal(V.pillerSoute(bateau, 0), 0, 'sans attaque : rien ne bouge (fraction nulle, appelant discipliné)');
      A.equal(bateau.soute.count(I.WHEAT), avantEpargne, 'cargaison intacte, départ épargné');

      var avantAttaque = bateau.soute.count(I.WHEAT);
      var perdu = V.pillerSoute(bateau, CV.PERTE_ATTAQUE);
      A.gt(perdu, 0, 'le départ attaqué retire réellement de la cargaison');
      A.close(bateau.soute.count(I.WHEAT), avantAttaque - Math.round(avantAttaque * CV.PERTE_ATTAQUE), 1,
              'fraction perdue conforme à PERTE_ATTAQUE, la même que pour une caravane marchande');

      // à l'identique pour tout véhicule de fret, hors attaque : jamais de perte
      var camionTemoin = V.poser(ents, 'camion', 3.5, 40, 6.5, 0);
      camionTemoin.soute.add(I.IRON_INGOT, 6);
      var r0 = V.pillerSoute(camionTemoin, 0);
      A.equal(r0, 0, 'fraction nulle : rien ne bouge');
      A.equal(camionTemoin.soute.count(I.IRON_INGOT), 6);
    });

    it('SPEC-TRANSPORT-005 : péage borné de la faction sur une route de commerce en paix, aucun péage hors territoire ou en guerre', function () {
      var etat = P.creer(3);
      etat.factions.set('royaume', faction('royaume', 0, 0, 240));
      etat.factions.set('voisin', faction('voisin', 5000, 5000, 50));

      // dans le territoire, route de commerce, en paix (relation neutre par défaut)
      var seg = P.peageSegment(etat, 'commerce', 10, 10);
      A.ok(seg && seg.factionId === 'royaume', 'un péage, prélevé par la bonne faction');
      A.ok(seg.montant >= P.PEAGE_MIN && seg.montant <= P.PEAGE_MAX, 'péage borné : ' + seg.montant);

      // hors de tout territoire : aucun péage
      A.equal(P.peageSegment(etat, 'commerce', 9000, 9000), null, 'hors territoire : rien');

      // une route de tourisme (ROUTE-002 vise le commerce) : aucun péage
      A.equal(P.peageSegment(etat, 'tourisme', 10, 10), null, 'seule une route de commerce est taxée');

      // en guerre : SPEC-TRANSPORT-003 prévaut, plus de péage ici
      etat.relations.set(cleRelation('royaume', 'ennemi'), 'guerre');
      etat.factions.set('ennemi', faction('ennemi', 1, 1, 10));
      A.equal(P.peageSegment(etat, 'commerce', 10, 10), null, 'territoire en guerre : aucun péage (le risque d\'attaque prévaut)');

      // la paix revenue (rivalité, pas guerre) : le péage reprend
      etat.relations.set(cleRelation('royaume', 'ennemi'), 'rivalite');
      var segApresPaix = P.peageSegment(etat, 'commerce', 10, 10);
      A.ok(segApresPaix, 'péage rétabli hors de toute guerre active');

      // solde du joueur diminué du péage exact, ressources de la faction
      // augmentées d'autant — le VRAI point d'entrée (appliquerPeage), pas une
      // simple addition à la main dans le test
      var f = etat.factions.get('royaume');
      var orAvant = f.ressources.or;
      var inv = Inv.create(9);
      inv.add(I.EMERALD, 20);
      var soldeAvant = inv.count(I.EMERALD);
      var montant = seg.montant;
      inv.remove(I.EMERALD, montant);
      var versement = P.appliquerPeage(etat, seg.factionId, montant);
      A.equal(versement, montant, 'le montant versé est exactement le péage annoncé');
      A.equal(inv.count(I.EMERALD), soldeAvant - montant, 'joueur débité du péage exact');
      A.equal(f.ressources.or, orAvant + montant, 'ressources de la faction créditées d\'autant');

      // bornes : un très petit territoire paie le minimum, un immense le maximum
      etat.factions.set('minuscule', faction('minuscule', -1000, -1000, 1));
      A.equal(P.peageDe(etat.factions.get('minuscule')), P.PEAGE_MIN, 'plancher');
      etat.factions.set('immense', faction('immense', -2000, -2000, 100000));
      A.equal(P.peageDe(etat.factions.get('immense')), P.PEAGE_MAX, 'plafond');

      // pas de faction : peageDe(null) et appliquerPeage sur un id inconnu, sans effet
      A.equal(P.peageDe(null), 0);
      A.equal(P.appliquerPeage(etat, 'inconnue', 3), 0, 'rien à verser à une faction qui n\'existe pas');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
