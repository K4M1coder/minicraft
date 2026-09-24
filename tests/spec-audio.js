/* spec-audio.js — tests des specs SPEC-AUDIO-* : la logique pure de
   MC.Ambiance (décisions), jamais un vrai AudioContext (indisponible sous
   Node — c'est justement pour ça que la décision et la synthèse sont
   séparées : audio.js synthétise, ambiance.js décide et se teste seul). */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var Amb = MC.Ambiance;

  describe('Specs — audio procédural', function () {
    it('SPEC-AUDIO-001 : les nappes d\'environnement suivent le lieu et le moment', function () {
      // plaine calme, en plein jour : rien ne bruite au hasard
      var calme = Amb.nappes({ biome: { id: 'plaines' }, nuit: false, pluie: 0, vent: 0 });
      A.equal(calme.pluie, 0, 'pas de pluie sans pluie');
      A.equal(calme.mer, 0, 'pas de mer loin de l\'océan');
      A.equal(calme.grillons, 0, 'pas de grillons en plein jour');

      // forêt la nuit, vent et pluie : feuillage + grillons + vent + pluie
      var foretNuit = Amb.nappes({ biome: { id: 'foret' }, nuit: true, pluie: 0.6, vent: 0.4 });
      A.gt(foretNuit.feuillage, 0, 'le feuillage bruisse en forêt');
      A.gt(foretNuit.grillons, 0, 'les grillons chantent la nuit');
      A.close(foretNuit.pluie, 0.6, 1e-9, 'la pluie suit son intensité');
      A.gt(foretNuit.vent, 0, 'le vent souffle');

      // désert la nuit : pas de grillons (biome trop aride)
      var desertNuit = Amb.nappes({ biome: { id: 'desert' }, nuit: true });
      A.equal(desertNuit.grillons, 0, 'le désert reste silencieux la nuit');

      // au large : la mer gronde, davantage avec le vent
      var mer = Amb.nappes({ biome: { id: 'ocean', marin: true }, vent: 0.5 });
      var merCalme = Amb.nappes({ biome: { id: 'ocean', marin: true }, vent: 0 });
      A.gt(mer.mer, 0, 'le ressac se fait entendre en mer');
      A.gt(mer.mer, merCalme.mer, 'plus de vent, plus de ressac');

      // rivière et cascade à proximité, indépendamment du biome
      var eauVive = Amb.nappes({ biome: { id: 'plaines' }, riviereProche: 0.8, cascadeProche: 0.3 });
      A.close(eauVive.riviere, 0.8, 1e-9, 'la rivière suit sa proximité');
      A.close(eauVive.cascade, 0.3, 1e-9, 'la cascade suit sa proximité');

      // ville à proximité, plus discrète la nuit
      var villeJour = Amb.nappes({ biome: { id: 'plaines' }, villeProche: 1 });
      var villeNuit = Amb.nappes({ biome: { id: 'plaines' }, nuit: true, villeProche: 1 });
      A.gt(villeJour.ville, 0, 'la rumeur de la ville se fait entendre');
      A.gt(villeJour.ville, villeNuit.ville, 'la ville est plus discrète la nuit');

      // sous terre : ni vent, ni pluie, ni feuillage — la roche résonne
      var grotte = Amb.nappes({ biome: { id: 'montagnes' }, sousTerre: true, pluie: 1, vent: 1 });
      A.equal(grotte.vent, 0, 'pas de vent sous terre');
      A.equal(grotte.pluie, 0, 'pas de pluie sous terre');
      A.equal(grotte.feuillage, 0, 'pas de feuillage sous terre');
      A.gt(grotte.grotte, 0, 'la roche résonne sous terre');

      // volcan proche : ça gronde, même en surface
      var volcan = Amb.nappes({ biome: { id: 'volcan' }, volcanProche: 1 });
      A.gt(volcan.volcan, 0, 'le volcan gronde');
    });

    it('SPEC-AUDIO-002 : chaque créature a ses sons — cri, pas, blessure, mort, attaque', function () {
      A.equal(Amb.sonCreature('loup', 'cri'), 'cri_predateur', 'un loup crie comme un prédateur');
      A.equal(Amb.sonCreature('zombie', 'cri'), 'cri_monstre', 'un zombie crie comme un monstre');
      A.equal(Amb.sonCreature('vache', 'cri'), 'cri_betail', 'une vache meugle comme du bétail');
      A.equal(Amb.sonCreature('poule', 'cri'), 'cri_volaille', 'une poule glousse comme une volaille');
      A.equal(Amb.sonCreature('poisson', 'cri'), 'cri_aquatique', 'un poisson a un cri aquatique');
      A.ok(!!Amb.sonCreature('loup', 'pas'), 'le loup a un bruit de pas');
      A.ok(!!Amb.sonCreature('loup', 'blesse'), 'le loup a un cri de blessure');
      A.ok(!!Amb.sonCreature('loup', 'mort'), 'le loup a un son de mort');
      A.ok(!!Amb.sonCreature('loup', 'attaque'), 'le loup a un son d\'attaque');
      // une poule ne frappe pas : pas de son d'attaque
      A.equal(Amb.sonCreature('poule', 'attaque'), null, 'une poule n\'attaque pas');
      // une espèce inconnue retombe sur la famille générique plutôt que rien
      A.ok(!!Amb.sonCreature('espece_mystere', 'cri'), 'une espèce inconnue crie quand même (générique)');
    });

    it('SPEC-AUDIO-003 : les actions sonnent selon la matière — pas, minage, casse, pose, nage, chute, combat, tir', function () {
      var actions = ['pas', 'miner', 'casser', 'poser', 'nage', 'chute', 'combat', 'tir'];
      actions.forEach(function (a) { A.ok(!!Amb.sonAction(a, 'pierre'), 'l\'action "' + a + '" a un son'); });
      A.equal(Amb.sonAction('sauter', 'pierre'), null, 'une action non listée ne renvoie rien');
      // même action, matière différente : noms distincts (des pas d'herbe et
      // de pierre ne se ressemblent pas)
      var matieres = ['herbe', 'pierre', 'sable', 'bois', 'neige', 'eau'];
      var noms = {};
      matieres.forEach(function (m) { noms[Amb.sonAction('pas', m)] = true; });
      A.equal(Object.keys(noms).length, matieres.length, 'chaque matière a son propre pas');
      // matière inconnue : repli sur la pierre plutôt qu'une exception
      A.equal(Amb.sonAction('pas', 'matiere_inconnue'), Amb.sonAction('pas', 'pierre'), 'repli sur la pierre');
    });

    it('SPEC-AUDIO-004 : les interactions ont leur son — portes/trappes, coffres, fourneau, établi, échanges, interface', function () {
      ['porte', 'trappe', 'coffre', 'fourneau', 'etabli', 'echange', 'interface'].forEach(function (t) {
        A.ok(!!Amb.sonInteraction(t), 'l\'interaction "' + t + '" a un son');
      });
      A.equal(Amb.sonInteraction('inconnue'), null, 'une interaction non listée ne renvoie rien');
    });

    it('SPEC-AUDIO-005 : les événements ont leur son — tonnerre, éruption, cyclone, succès, chapitres/fins, réveil de gardien', function () {
      ['tonnerre', 'eruption', 'cyclone', 'succes', 'chapitre', 'fin', 'gardien'].forEach(function (t) {
        A.ok(!!Amb.sonEvenement(t), 'l\'événement "' + t + '" a un son');
      });
      A.equal(Amb.sonEvenement('inconnu'), null, 'un événement non listé ne renvoie rien');
    });

    it('SPEC-AUDIO-006 : spatialisation (volume + panoramique selon la position), étouffement sous l\'eau/roche, volumes par catégorie', function () {
      var auditeur = { x: 0, y: 0, z: 0, yaw: 0 };
      // au même endroit : plein volume, pas de panoramique
      var ici = Amb.spatialiser(auditeur, { x: 0, y: 0, z: 0 }, {});
      A.close(ici.gain, 1, 1e-6, 'source confondue avec l\'auditeur : gain plein');
      A.close(ici.pan, 0, 1e-6, 'pas de panoramique à distance nulle');

      // plus loin, moins fort ; hors de portée, silence
      var proche = Amb.spatialiser(auditeur, { x: 5, y: 0, z: 0 }, { portee: 24 });
      var loin = Amb.spatialiser(auditeur, { x: 20, y: 0, z: 0 }, { portee: 24 });
      var horsPortee = Amb.spatialiser(auditeur, { x: 100, y: 0, z: 0 }, { portee: 24 });
      A.gt(proche.gain, loin.gain, 'plus loin, plus faible');
      A.equal(horsPortee.gain, 0, 'hors de portée : silence');

      // une source à droite (yaw=0, +x = droite) panoramique à droite
      var droite = Amb.spatialiser(auditeur, { x: 10, y: 0, z: 0 }, {});
      var gauche = Amb.spatialiser(auditeur, { x: -10, y: 0, z: 0 }, {});
      A.gt(droite.pan, 0, 'une source à droite panoramique à droite');
      A.lt(gauche.pan, 0, 'une source à gauche panoramique à gauche');

      // étouffement : sous l'eau et derrière la roche
      var normal = Amb.spatialiser(auditeur, { x: 5, y: 0, z: 0 }, {});
      var sousEau = Amb.spatialiser(auditeur, { x: 5, y: 0, z: 0 }, { sousEau: true });
      var roche = Amb.spatialiser(auditeur, { x: 5, y: 0, z: 0 }, { roche: true });
      A.lt(sousEau.gain, normal.gain, 'un son est étouffé sous l\'eau');
      A.lt(roche.gain, normal.gain, 'un son est étouffé derrière la roche');
      A.lt(roche.coupure, normal.coupure, 'la roche filtre plus que l\'air libre');
      A.equal(normal.coupure, 20000, 'pas de filtrage sans occlusion');

      // volumes par catégorie : un réglage explicite l'emporte sur le défaut
      A.equal(Amb.volumeCategorie('creature', {}), Amb.VOLUMES_DEFAUT.creature, 'sans réglage, le défaut de la catégorie');
      A.equal(Amb.volumeCategorie('creature', { creature: 0.2 }), 0.2, 'le réglage explicite l\'emporte');
      A.between(Amb.volumeCategorie('creature', { creature: 5 }), 0, 1, 'le volume reste borné à [0,1]');
      Amb.CATEGORIES.forEach(function (c) {
        A.ok(Amb.VOLUMES_DEFAUT[c] !== undefined, 'la catégorie "' + c + '" a un volume par défaut');
      });
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
