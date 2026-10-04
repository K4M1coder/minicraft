/* spec-jouabilite.js — partie Node du lot « jouabilité / synchro client-serveur »
   (SPEC-JOUABLE-004, 006, 007, 009). Les comportements eux-mêmes sont prouvés
   de bout en bout par tests/e2e-jouabilite.js (vraie page, vrai serveur) ; ici :
     - l'analyse pure qui explique leurs échecs (tests/jouabilite-analyse.js),
       sur des séries synthétiques dont on connaît la réponse ;
     - le lancer d'un objet jeté (MC.createEntities().lancerObjet) sur sol plat ;
     - l'audit de src/game.js pour les deux bogues révélés par ces e2e (un clic
       droit qui utilisait deux fois, DONNE qui ajoutait un objet fantôme).
   Fichier Node-only (comme spec-archi-env.js) : `require` et `__dirname` sont
   exposés par tests/run.js. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path');
  var J = require('./jouabilite-analyse.js');
  var RACINE = path.join(__dirname, '..');
  var C = MC.Core, B = C.B;
  var flatWorld = G.flatWorld;

  function serie(n, f) { var out = []; for (var i = 0; i < n; i++) out.push(f(i)); return out; }

  describe('Specs — jouabilité : analyse des relevés (SPEC-JOUABLE-009)', function () {

    it('SPEC-JOUABLE-009 : un joueur immobile (bruit < 1e-4) ne produit aucun déplacement erroné', function () {
      var a = J.analyserPositions(serie(480, function (i) { return { t: i * 16.7, x: 10.5, y: 64 + (i % 2) * 5e-5, z: -3.5, etats: 1 }; }));
      A.ok(a.ok, 'immobile');
      A.equal(a.deplacements.length, 0, 'aucun déplacement');
      A.equal(a.echantillons, 480);
      A.ok(a.duree_ms > 7900, 'durée mesurée (' + a.duree_ms + ' ms)');
    });

    it('SPEC-JOUABLE-009 : chaque déplacement erroné porte vecteur, décalage cumulé, intervalle et source probable', function () {
      // trois recalages du client vers le bas, toutes les 30 images ; le 3e vient du serveur qui a bougé
      var y = 64, ech = [];
      for (var i = 0; i <= 100; i++) {
        var e = { t: i * 10, x: 1, y: y, z: 2, etats: 0, deltaServeur: 0 };
        if (i === 30 || i === 60) { y -= 0.02; e.y = y; e.etats = 1; e.ecart = 0.02; }
        if (i === 90) { y -= 0.05; e.y = y; e.etats = 1; e.deltaServeur = 0.05; }
        ech.push(e);
      }
      var a = J.analyserPositions(ech);
      A.notOk(a.ok, 'au-delà de 0,001 bloc : échec');
      A.equal(a.deplacements.length, 3, 'trois déplacements');
      var d0 = a.deplacements[0], d1 = a.deplacements[1], d2 = a.deplacements[2];
      A.equal(d0.t_ms, 300, 'instant du premier');
      A.close(d0.vecteur.dy, -0.02, 1e-9, 'vecteur du premier');
      A.equal(d0.intervalle_ms, null, 'pas d\'intervalle pour le premier');
      A.equal(d1.intervalle_ms, 300, 'intervalle entre deux déplacements erronés');
      A.close(d1.cumul.dy, -0.04, 1e-9, 'décalage cumulé');
      A.ok(/^correction serveur/.test(d0.source), 'recalage sans mouvement du serveur : ' + d0.source);
      A.ok(/^serveur/.test(d2.source), 'le serveur a bougé : ' + d2.source);
      A.close(a.final.dy, -0.09, 1e-9, 'décalage final');
      var msg = J.messagePositions('client', a);
      A.ok(/3 déplacement\(s\) erroné\(s\)/.test(msg) && /t=300 ms/.test(msg) && /intervalle=300 ms/.test(msg) && /cumul=\(\+0\.0000, -0\.0400, \+0\.0000\)/.test(msg),
        'le message cite la série : ' + msg);
      A.ok(/correction serveur ×2/.test(msg) && /serveur ×1/.test(msg), 'et le compte par source');
    });

    it('SPEC-JOUABLE-009 : un pas sans aucun ETAT reçu est attribué au client', function () {
      var a = J.analyserPositions([{ t: 0, x: 0, y: 0, z: 0 }, { t: 16, x: 0.01, y: 0, z: 0, etats: 0 }]);
      A.ok(/^client/.test(a.deplacements[0].source), a.deplacements[0].source);
    });

    it('SPEC-JOUABLE-009 : la stabilité d\'une valeur date le retour arrière et liste les changements', function () {
      var ech = serie(10, function (i) { return { t: 1000 + i * 100, v: i >= 4 && i < 7 ? 3 : 0 }; });
      var s = J.analyserStabilite(ech, 0);
      A.notOk(s.ok);
      A.equal(s.premierEcart.t_ms, 400, 'retour arrière à 400 ms');
      A.equal(s.premierEcart.v, 3, 'valeur revenue');
      A.equal(s.changements.length, 2, 'deux changements (aller, retour)');
      A.equal(s.duree_ms, 900);
      A.ok(J.analyserStabilite(serie(5, function (i) { return { t: i, v: 'x' }; }), 'x').ok, 'stable : ok');
      var depuisAction = J.analyserStabilite(ech, 0, 800);
      A.equal(depuisAction.premierEcart.t_ms, 600, 'compté depuis l\'action quand elle est donnée');
      A.equal(depuisAction.duree_ms, 1100, 'durée depuis l\'action');
    });

    it('SPEC-JOUABLE-009 : inventaires comparés case à case, messages du serveur résumés', function () {
      var c = J.comparerInventaires([[7, 7], 0, [8, 5]], [[7, 8], 0, [8, 5]]);
      A.notOk(c.ok);
      A.equal(c.differences.length, 1);
      A.equal(c.differences[0].i, 0);
      A.ok(/case 0 client \[7,7\] \/ serveur \[7,8\]/.test(J.messageInventaires('x', c)), J.messageInventaires('x', c));
      A.equal(J.resumerInventaire([[7, 7], 0, [8, 5]]), '0:7×7 2:8×5');
      var r = J.resumerMessages([{ t: 1500, m: { t: 'inv_maj', rev: 3, ack: 1, gain: { id: 7, n: 1 }, inv: [[7, 8]] } }, { t: 1600, m: { t: 'chat' } }],
        function (m) { return m.t === 'inv_maj'; }, 1000);
      A.ok(/t=500 ms/.test(r) && /"rev":3/.test(r) && /"ack":1/.test(r) && /0:7×8/.test(r) && !/chat/.test(r), r);
    });
  });

  describe('Specs — jouabilité : jeter et ramasser (SPEC-JOUABLE-006, 007)', function () {

    it('SPEC-JOUABLE-006 : un objet jeté part devant le lanceur, retombe hors de portée et n\'est pas rendu au lanceur immobile', function () {
      var w = flatWorld(10);
      var ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents, MC.Modes.regles('survie', 'facile'));
      pl.state.pos = { x: 0.5, y: 11, z: 0.5 };
      pl.state.onGround = true;
      pl.state.yaw = 0; pl.state.pitch = 0;               // regard vers -z
      var e = ents.lancerObjet(pl.eyePos(), pl.lookDir(), B.COBBLE, 1);
      A.equal(e.type, 'item');
      A.equal(e.n, 1);
      A.ok(e.pickup >= 2, 'personne ne le ramasse avant 2 s (' + e.pickup + ')');
      var pris = 0;
      for (var i = 0; i < 300; i++) {
        var ev = ents.update(1 / 60, pl.state, { joueurs: [pl.state] });
        pris += ev.picked.length;
      }
      A.equal(pris, 0, 'le lanceur immobile ne le ramasse pas en 5 s');
      A.ok(!e.dead, 'il est toujours au sol');
      A.ok(e.pos.z < 0.5 - 2.5, 'retombé devant le lanceur, à plus de 2,5 blocs (' + (0.5 - e.pos.z).toFixed(2) + ')');
      A.close(e.pos.x, 0.5, 0.05, 'dans l\'axe du regard');
      A.between(e.pos.y, 10.9, 11.1, 'posé au sol');
    });

    it('SPEC-JOUABLE-007 : marcher sur un objet jeté le ramasse (une fois le délai passé)', function () {
      var w = flatWorld(10);
      var ents = MC.createEntities(w);
      var pl = MC.createPlayer(w, ents, MC.Modes.regles('survie', 'facile'));
      pl.state.pos = { x: 0.5, y: 11, z: 0.5 };
      pl.state.onGround = true;
      var e = ents.lancerObjet(pl.eyePos(), pl.lookDir(), B.COBBLE, 1);
      for (var i = 0; i < 180; i++) ents.update(1 / 60, pl.state, { joueurs: [pl.state] });
      pl.state.pos = { x: e.pos.x, y: 11, z: e.pos.z + 0.5 };
      var pris = [];
      for (var k = 0; k < 60 && !pris.length; k++) pris = pris.concat(ents.update(1 / 60, pl.state, { joueurs: [pl.state] }).picked);
      A.equal(pris.length, 1, 'ramassé');
      A.equal(pris[0].id, B.COBBLE);
    });

    it('SPEC-JOUABLE-006 : le serveur lance l\'objet d\'un INV_LACHER devant le joueur (lancerDevant), un trop-plein tombe toujours aux pieds', function () {
      var src = fs.readFileSync(path.join(RACINE, 'server.js'), 'utf8');
      A.ok(/op\.k === 'lacher' \? lancerDevant : lacherAuxPieds/.test(src), 'traiterOp choisit lancerDevant pour un lâcher');
      A.ok(/function lancerDevant\(js, pile\)[\s\S]{0,200}entites\.lancerObjet\(js\.joueur\.eyePos\(\), js\.joueur\.lookDir\(\)/.test(src), 'depuis l\'œil, dans le regard du joueur');
    });

    it('SPEC-JOUABLE-007 : DONNE n\'ajoute rien à l\'inventaire du client (le gain arrive par INV_MAJ)', function () {
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      var i = jeu.indexOf('onDonne: function');
      A.ok(i >= 0, 'onDonne existe');
      var j = jeu.indexOf('onStatut:', i);
      A.ok(j > i, 'onStatut suit onDonne');
      var corps = jeu.slice(i, j);
      A.equal(corps.indexOf('pickUp'), -1, 'onDonne ne fait plus pickUp (objet fantôme)');
    });
  });

  describe('Specs — jouabilité : un coffre ouvert en ligne accepte les transferts (SPEC-JOUABLE-008)', function () {
    it('SPEC-JOUABLE-008 : un transfert vers et depuis le miroir client d\'un coffre (forme de CONTENEUR_ETAT) est accepté', function () {
      var Inv = MC.Inventory;
      var joueur = { inv: Inv.create(36), grille: Inv.create(9), equip: {} };
      joueur.inv.add(B.COBBLE, 10);
      // le miroir tel que l'écrivait onConteneurEtat : sans `taille`
      var miroir = { cle: '1,2,3', type: 'chest', rev: 0, slots: new Array(27).fill(null) };
      var ctx = { joueur: joueur, conteneur: function (cle) { return cle === miroir.cle ? miroir : null; }, regles: MC.Modes.regles('survie', 'facile') };
      var r = MC.Conteneurs.appliquer(ctx, { k: 'transfert', de: { z: 'inv', i: 0 }, vers: { z: 'cont', cle: miroir.cle, i: 0 }, n: 10 });
      A.ok(r.ok, 'dépôt accepté (' + r.motif + ')');
      A.equal(miroir.slots[0] && miroir.slots[0].n, 10, 'la pierre est dans le coffre');
      var r2 = MC.Conteneurs.appliquer(ctx, { k: 'transfert', de: { z: 'cont', cle: miroir.cle, i: 0 }, vers: { z: 'inv', i: 5 }, n: 5 });
      A.ok(r2.ok, 'retrait accepté (' + r2.motif + ')');
      A.equal(joueur.inv.slots[5] && joueur.inv.slots[5].n, 5, 'cinq pierres reviennent');
      // la borne de la revue tient toujours : au-delà de la taille du TYPE, refusé
      var r3 = MC.Conteneurs.appliquer(ctx, { k: 'transfert', de: { z: 'inv', i: 5 }, vers: { z: 'cont', cle: miroir.cle, i: 27 }, n: 1 });
      A.notOk(r3.ok, 'indice hors du coffre refusé');
      A.equal(miroir.slots.length, 27, 'le tableau n\'a pas grandi');
    });
    it('SPEC-JOUABLE-008 : un delta du serveur s\'applique à l\'état CONFIRMÉ du coffre, l\'affiché est reconstruit (confirmé + rejeu)', function () {
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      var i = jeu.indexOf('function appliquerDeltaConteneur(');
      var corps = jeu.slice(i, jeu.indexOf('function reconstruirePredit(', i));
      A.ok(/var c = conteneurOuvert\.confirme;/.test(corps) && corps.indexOf('.mirror') < 0, 'le delta ne touche jamais le miroir affiché');
      var k = jeu.indexOf('function reconstruirePredit(');
      var rc = jeu.slice(k, k + 1800);
      A.ok(/m\.slots\[i\] = copiePile\(c\.slots\[i\]\)/.test(rc), 'le miroir repart de l\'état confirmé');
      A.ok(rc.indexOf('st.inv.load(v.inv)') >= 0 && rc.indexOf('j.predInv.rejouer(st, conteneurs') > rc.indexOf('st.inv.load(v.inv)'), 'puis l\'inventaire confirmé, puis le rejeu');
      var o = jeu.indexOf('onInvMaj: function');
      var inv = jeu.slice(o, jeu.indexOf('onConteneurEtat: function', o));
      A.ok(inv.indexOf('forEach(appliquerDeltaConteneur)') < inv.indexOf('reconstruirePredit(j)'), 'onInvMaj : deltas au confirmé AVANT la reconstruction');
    });
    it('SPEC-JOUABLE-008 : le miroir client d\'un conteneur porte sa taille', function () {
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      var i = jeu.indexOf('onConteneurEtat: function');
      A.ok(/var mirror = \{ cle: v\.cle, type: v\.type, rev: v\.rev, taille: v\.slots\.length/.test(jeu.slice(i, i + 800)), 'taille dans le miroir');
    });
  });

  describe('Specs — jouabilité : un clic droit, une utilisation (SPEC-JOUABLE-004)', function () {
    it('SPEC-JOUABLE-004 : l\'appui (onUse) arme le délai de répétition de la boucle', function () {
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      var i = jeu.indexOf('function onUse()');
      A.ok(i >= 0, 'onUse existe');
      var debut = jeu.slice(i, i + 900);
      A.ok(/equipe\[0\]\.useCd = 0\.22/.test(debut), 'onUse pose useCd avant toute utilisation');
      A.ok(/if \(j\.useCd <= 0\) \{ j\.useCd = 0\.22; utiliserPour\(j\); \}/.test(jeu), 'la boucle ne répète qu\'une fois le délai écoulé');
    });
    it('SPEC-JOUABLE-004 : une équipe recomposée en ligne (serveur dans un autre mode) garde sa prédiction d\'inventaire', function () {
      var jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      var i = jeu.indexOf('function composerEquipe(');
      var corps = jeu.slice(i, i + 2500);
      A.ok(/var etaitEnLigne = !!net && \(net\.etat === 'en ligne' \|\| net\.etat === 'connexion'\)/.test(corps), 'composerEquipe sait si l\'équipe jouait en ligne');
      A.ok(/if \(etaitEnLigne\) preparerEnLigne\(j\);/.test(corps), 'et prépare la nouvelle équipe pour le réseau (predInv, revInv, journalInv)');
      var p = jeu.indexOf('function preparerEnLigne(');
      A.ok(/j\.predInv = MC\.Conteneurs\.creerPrediction\(\);/.test(jeu.slice(p, p + 600)), 'preparerEnLigne crée la prédiction d\'inventaire');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
