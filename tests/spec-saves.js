/* spec-saves.js — tests des specs SPEC-SAVE-* (parties multiples et graine),
   plus la couverture des fonctions publiques que la porte G6 signalait. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, M = MC.Modes, S = MC.Saves, DC = MC.DayCycle, P = MC.Physics;
  var B = C.B, I = C.I;
  var mockStorage = G.mockStorage, etatMinimal = G.etatMinimal, flatWorld = G.flatWorld;

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — parties multiples', { teste: 'La gestion de plusieurs parties sauvegardées : index, identifiants, effacement complet.', pourquoi: 'Couvre les specs SPEC-SAVE-* de ce fichier, ainsi que les fonctions internes (identifiants, effacement) dont dépendent ces specs.', attendu: 'chaque fonction interne se comporte comme documenté, en plus des specs SPEC-SAVE-* couvertes une à une.' }, function () {

    it('SPEC-SAVE-001 : plusieurs parties coexistent', function () {
      var st = mockStorage();
      var a = S.creer(st, { nom: 'Alpha', graine: 1 });
      var b = S.creer(st, { nom: 'Beta', graine: 2 });
      var c = S.creer(st, { nom: 'Gamma', graine: 3 });
      var ids = S.lister(st).map(function (m) { return m.id; }).sort();
      A.deep(ids, [a.id, b.id, c.id].sort(), 'les trois parties sont listees');
      A.notEqual(a.id, b.id, 'identifiants distincts');
      A.notEqual(b.id, c.id);
    });

    it('SPEC-SAVE-002 : la liste est triee par derniere utilisation', function () {
      var st = mockStorage();
      var a = S.creer(st, { nom: 'Vieille', graine: 1 });
      var b = S.creer(st, { nom: 'Recente', graine: 2 });
      // on force des dates distinctes : Date.now() peut renvoyer la meme valeur
      S.majMeta(st, a.id, {}); S.majMeta(st, a.id, { majLe: 1000 });
      S.majMeta(st, b.id, {}); S.majMeta(st, b.id, { majLe: 9000 });
      A.equal(S.lister(st)[0].id, b.id, 'la plus recente en tete');
    });

    it('SPEC-SAVE-003 : nom, mode, difficulte et graine sont memorises', function () {
      var st = mockStorage();
      var m = S.creer(st, { nom: 'Essai', mode: 'creatif', difficulte: 'difficile', graine: 4242 });
      var relu = S.trouver(st, m.id);
      A.equal(relu.nom, 'Essai');
      A.equal(relu.mode, 'creatif');
      A.equal(relu.difficulte, 'difficile');
      A.equal(relu.graine, 4242);
    });

    it('SPEC-SAVE-004 : supprimer retire les metadonnees ET la carte', function () {
      var st = mockStorage();
      var m = S.creer(st, { nom: 'A jeter', graine: 9 });
      var etat = etatMinimal(m.graine);
      etat.world.setBlock(2, 40, 2, B.BRICK);
      S.sauvegarder(st, m.id, etat);
      A.ok(st.getItem(S.slotKey(m.id)), 'carte presente avant');
      A.ok(S.supprimer(st, m.id), 'suppression effectuee');
      A.equal(S.trouver(st, m.id), null, 'metadonnees parties');
      A.equal(st.getItem(S.slotKey(m.id)), null, 'carte partie');
    });

    it('SPEC-SAVE-005 : supprimer une partie n affecte pas les autres', function () {
      var st = mockStorage();
      var a = S.creer(st, { nom: 'Garde', graine: 11 });
      var b = S.creer(st, { nom: 'Jette', graine: 12 });
      var ea = etatMinimal(a.graine);
      ea.world.setBlock(1, 40, 1, B.GLASS);
      S.sauvegarder(st, a.id, ea);
      S.sauvegarder(st, b.id, etatMinimal(b.graine));
      S.supprimer(st, b.id);

      var cible = etatMinimal(a.graine);
      var r = S.charger(st, a.id, cible);
      A.ok(r && !r.vierge, 'la partie gardee se recharge');
      cible.world.getChunk(0, 0, true);
      A.equal(cible.world.getBlock(1, 40, 1), B.GLASS, 'son contenu est intact');
    });

    it('SPEC-SAVE-006 : charger une partie jamais sauvegardee est signale', function () {
      var st = mockStorage();
      var m = S.creer(st, { nom: 'Neuve', graine: 5 });
      var r = S.charger(st, m.id, etatMinimal(m.graine));
      A.ok(r, 'reponse fournie');
      A.ok(r.vierge, 'marquee vierge');
      A.equal(r.meta.id, m.id);
    });

    it('SPEC-SAVE-007 : charger un identifiant inconnu renvoie null', function () {
      var st = mockStorage();
      A.equal(S.charger(st, 'inexistant', etatMinimal(1)), null);
      A.equal(S.trouver(st, 'inexistant'), null);
    });

    it('SPEC-SAVE-008 : une sauvegarde d une autre version est rejetee', function () {
      var st = mockStorage();
      var m = S.creer(st, { nom: 'Vieille version', graine: 6 });
      st.setItem(S.slotKey(m.id), JSON.stringify({ v: 999, overrides: [] }));
      A.equal(S.charger(st, m.id, etatMinimal(m.graine)), null, 'rejetee');
      A.ok(st.getItem(S.slotKey(m.id)), 'le stockage n est pas detruit pour autant');
    });

    it('SPEC-SAVE-015 : renommer ne touche pas a la carte', function () {
      var st = mockStorage();
      var m = S.creer(st, { nom: 'Avant', graine: 7 });
      var etat = etatMinimal(m.graine);
      etat.world.setBlock(4, 41, 4, B.COBBLE);
      S.sauvegarder(st, m.id, etat);
      var avant = st.getItem(S.slotKey(m.id));
      S.renommer(st, m.id, 'Apres');
      A.equal(S.trouver(st, m.id).nom, 'Apres', 'nom change');
      A.equal(st.getItem(S.slotKey(m.id)), avant, 'carte inchangee, octet pour octet');
    });

    it('SPEC-SAVE-016 : l index ne contient aucune donnee de monde', function () {
      var st = mockStorage();
      var m = S.creer(st, { nom: 'Grande', graine: 8 });
      var etat = etatMinimal(m.graine);
      // coordonnees reellement distinctes : (i%16, i%20, (i*7)%16) se repete
      // toutes les 80 iterations et ne produirait que 80 overrides
      for (var i = 0; i < 400; i++) {
        etat.world.setBlock(i % 16, 30 + ((i / 16) | 0), (i * 5 + ((i / 16) | 0)) % 16, B.BRICK);
      }
      S.sauvegarder(st, m.id, etat);
      var index = st.getItem(S.INDEX_KEY);
      A.ok(S.taille(st, m.id) > 2000, 'la carte, elle, est volumineuse');
      A.ok(index.length < 600, 'index leger (' + index.length + ' octets)');
    });

    it('toutEffacer supprime tout, index et cartes', function () {
      var st = mockStorage();
      var a = S.creer(st, { nom: 'A', graine: 1 });
      var b = S.creer(st, { nom: 'B', graine: 2 });
      S.sauvegarder(st, a.id, etatMinimal(1));
      S.sauvegarder(st, b.id, etatMinimal(2));
      A.equal(S.toutEffacer(st), 2, 'deux parties effacees');
      A.equal(S.lister(st).length, 0, 'index vide');
      A.equal(st.getItem(S.slotKey(a.id)), null, 'carte A partie');
      A.equal(st.getItem(S.slotKey(b.id)), null, 'carte B partie');
    });

    it('nouvelId produit des identifiants distincts', function () {
      var vus = {};
      for (var i = 0; i < 200; i++) {
        var id = S.nouvelId();
        A.notOk(vus[id], 'pas de collision sur 200 tirages');
        vus[id] = 1;
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  describe('Specs — graine de génération', { teste: 'La graine de génération : conversion depuis un texte, tirage aléatoire, déterminisme du monde produit.', pourquoi: 'Couvre les specs SPEC-SAVE-* liées à la graine, ainsi que le tirage aléatoire dont elles dépendent quand la graine est vide.', attendu: 'la graine, qu\'elle soit saisie ou tirée, reste dans les bornes attendues et détermine le monde, en plus des specs SPEC-SAVE-* couvertes une à une.' }, function () {

    it('SPEC-SAVE-009 : une graine numerique est conservee telle quelle', function () {
      A.equal(M.graineDepuisTexte('42'), 42);
      A.equal(M.graineDepuisTexte('-7'), -7);
      A.equal(M.graineDepuisTexte(' 1234 '), 1234, 'les espaces sont ignores');
    });

    it('SPEC-SAVE-010 : un meme texte donne toujours la meme graine', function () {
      ['bonjour', 'MiniCraft', 'île déserte', '~!@#'].forEach(function (mot) {
        A.equal(M.graineDepuisTexte(mot), M.graineDepuisTexte(mot), mot);
      });
    });

    it('SPEC-SAVE-011 : deux textes differents donnent des graines differentes', function () {
      var mots = ['a', 'b', 'aa', 'ab', 'ba', 'monde', 'mondee', 'Monde',
                  'terre', 'terrE', 'x1', 'x2', '1x', 'seed', 'sede'];
      var vues = {};
      mots.forEach(function (m2) {
        var g = M.graineDepuisTexte(m2);
        A.notOk(vues[g], 'collision entre "' + vues[g] + '" et "' + m2 + '"');
        vues[g] = m2;
      });
    });

    it('SPEC-SAVE-012 : une graine vide declenche un tirage aleatoire', function () {
      A.equal(M.graineDepuisTexte(''), null);
      A.equal(M.graineDepuisTexte('   '), null);
      A.equal(M.graineDepuisTexte(null), null);
      var st = mockStorage();
      var m = S.creer(st, { nom: 'Hasard', graine: M.graineDepuisTexte('') });
      A.ok(typeof m.graine === 'number' && isFinite(m.graine), 'une graine a ete tiree');
    });

    it('graineAleatoire reste dans les entiers 32 bits et varie', function () {
      var vues = {}, differentes = 0;
      for (var i = 0; i < 50; i++) {
        var g = M.graineAleatoire();
        A.equal(g, g | 0, 'entier 32 bits');
        if (!vues[g]) { vues[g] = 1; differentes++; }
      }
      A.ok(differentes > 45, 'tirages variés (' + differentes + '/50)');
    });

    it('SPEC-SAVE-013 : meme graine, mondes identiques', function () {
      var a = MC.createWorld(123456).getChunk(3, -2, true);
      var b = MC.createWorld(123456).getChunk(3, -2, true);
      var diff = 0;
      for (var i = 0; i < a.blocks.length; i++) if (a.blocks[i] !== b.blocks[i]) diff++;
      A.equal(diff, 0, 'aucun bloc ne differe');
    });

    it('SPEC-SAVE-014 : graines differentes, mondes differents', function () {
      var a = MC.createWorld(1).getChunk(0, 0, true);
      var b = MC.createWorld(2).getChunk(0, 0, true);
      var diff = 0;
      for (var i = 0; i < a.blocks.length; i++) if (a.blocks[i] !== b.blocks[i]) diff++;
      A.ok(diff > 100, 'les mondes divergent nettement (' + diff + ' blocs)');
    });

    /* Le vrai usage visé : deux joueurs tapent le même mot sur deux machines et
       doivent obtenir la même carte. On simule en repartant du texte. */
    it('SPEC-SAVE-010 : deux machines partant du meme mot obtiennent la meme carte', function () {
      var pc1 = MC.createWorld(M.graineDepuisTexte('vallée perdue'));
      var pc2 = MC.createWorld(M.graineDepuisTexte('vallée perdue'));
      A.deep(pc1.findSpawnColumn(), pc2.findSpawnColumn(), 'meme point d apparition');
      var c1 = pc1.getChunk(5, 5, true), c2 = pc2.getChunk(5, 5, true);
      var diff = 0;
      for (var i = 0; i < c1.blocks.length; i++) if (c1.blocks[i] !== c2.blocks[i]) diff++;
      A.equal(diff, 0, 'chunks identiques a distance');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Couverture des fonctions publiques que la porte G6 signalait
  // ══════════════════════════════════════════════════════════════════════════
  describe('Couverture — fonctions publiques restantes', { teste: 'Des fonctions publiques diverses (inventaire, physique, entités, cycle jour/nuit) non couvertes par une spec dédiée.', pourquoi: 'La porte G6 exige que toute fonction exportée d\'un module pur soit citée par un test ; ce groupe rassemble celles qui ne rentrent dans aucune spec existante.', attendu: 'chaque fonction listée ici se comporte selon sa description, indépendamment de toute spec.' }, function () {

    it('maxStack distingue les outils des blocs', function () {
      A.equal(C.maxStack(B.COBBLE), 64, 'un bloc s empile a 64');
      A.equal(C.maxStack(I.IRON_PICKAXE), 1, 'un outil ne s empile pas');
      A.equal(C.maxStack(I.BREAD), 64, 'un aliment s empile');
    });

    it('headInWater teste la hauteur des yeux, pas le torse', function () {
      var w = flatWorld(-1, 0);
      var pos = { x: 0.5, y: 10, z: 0.5 };
      // pieds a y=10, yeux a 11.62 : une seule couche d'eau en y=10 laisse
      // la tete a l'air libre
      w.setBlock(0, 10, 0, B.WATER);
      A.notOk(P.headInWater(w, pos, 1.62), 'tete hors de l eau');
      w.setBlock(0, 11, 0, B.WATER);
      A.ok(P.headInWater(w, pos, 1.62), 'tete immergee des que y=11 est de l eau');
    });

    it('EntitySpecs decrit chaque type d entite', {
      // SPEC-BANC-066 : `MC.EntitySpecs` est une TABLE DE DONNÉES pure, sans
      // accesseur exporté (contrairement à C.def()/C.nameOf() pour
      // blocs/objets) — aucune fonction à observer honnêtement ici ; le
      // domaine FAUNE (gabarits des mobs/entités) est en revanche réel et
      // vérifiable (voir SPEC-FAUNE-* dans SPECS.md).
      domaines: ['FAUNE'],
    }, function () {
      ['item', 'zombie', 'sheep', 'villager'].forEach(function (t) {
        var s = MC.EntitySpecs[t];
        A.ok(s, 'gabarit present : ' + t);
        A.ok(s.w > 0 && s.h > 0, t + ' a des dimensions');
        A.ok(s.hp > 0, t + ' a des points de vie');
      });
      A.ok(MC.EntitySpecs.zombie.hostile, 'le zombie est hostile');
      A.ok(MC.EntitySpecs.villager.npc, 'le villageois est un PNJ');
    });

    it('isDusk, isDawn et isNight decoupent le cycle sans se chevaucher', function () {
      var DL = DC.DAY_LENGTH;
      var chevauchements = 0, phases = { jour: 0, crepuscule: 0, nuit: 0, aube: 0 };
      for (var t = 0; t < DL; t += 1) {
        var n = DC.isNight(t) ? 1 : 0, c = DC.isDusk(t) ? 1 : 0, a = DC.isDawn(t) ? 1 : 0;
        if (n + c + a > 1) chevauchements++;
        if (n) phases.nuit++; else if (c) phases.crepuscule++; else if (a) phases.aube++; else phases.jour++;
      }
      A.equal(chevauchements, 0, 'les phases sont exclusives');
      A.ok(phases.jour > 0 && phases.nuit > 0 && phases.crepuscule > 0 && phases.aube > 0,
        'les quatre phases existent');
    });

    it('sunDir garde le soleil au-dessus de l horizon', function () {
      for (var t = 0; t < DC.DAY_LENGTH; t += 7) {
        var d = DC.sunDir(t);
        A.ok(d.y > 0, 'composante verticale positive a t=' + t);
        A.ok(isFinite(d.x) && isFinite(d.z), 'direction finie');
      }
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
