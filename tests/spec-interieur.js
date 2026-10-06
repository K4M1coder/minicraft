/* spec-interieur.js — tests des specs SPEC-INTERIEUR-002 (mobilier) et
   SPEC-INTERIEUR-003 (livres et notes) : recettes, pose orientée, boîtes de
   collision, sommeil, présentoirs/socles, écriture/signature, persistance. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, Inv = MC.Inventory, F = MC.Formes, DC = MC.DayCycle, L = MC.Livres;
  var B = C.B, I = C.I;
  var flatWorld = G.flatWorld, mockStorage = G.mockStorage, etatMinimal = G.etatMinimal;

  function partie() {
    var w = flatWorld(9, B.STONE);
    var ents = MC.createEntities(w);
    var pl = MC.createPlayer(w, ents);
    pl.state.pos = { x: 3.5, y: 10, z: 3.5 };
    pl.state.onGround = true;
    return { w: w, ents: ents, pl: pl, s: pl.state };
  }

  var MEUBLES = ['lit', 'table', 'chaise', 'armoire', 'etagere', 'bibliotheque',
                 'tapis', 'lampe', 'vase', 'presentoir', 'socle'];
  var BLOC_DE = { lit: B.LIT, table: B.TABLE, chaise: B.CHAISE, armoire: B.ARMOIRE,
                  etagere: B.ETAGERE, bibliotheque: B.BIBLIOTHEQUE, tapis: B.TAPIS,
                  lampe: B.LAMPE, vase: B.VASE, presentoir: B.PRESENTOIR, socle: B.SOCLE };

  describe('Specs — SPEC-INTERIEUR-002 : mobilier orienté', function () {

    it('SPEC-INTERIEUR-002 : les onze meubles existent, dans la plage 950-1099, en forme meuble', function () {
      MEUBLES.forEach(function (kind) {
        var id = BLOC_DE[kind];
        A.ok(id >= 950 && id <= 1099, kind + ' dans la plage réservée');
        var d = C.BLOCKS[id];
        A.ok(d, kind + ' est défini');
        A.equal(d.forme, 'meuble', kind + ' utilise la forme meuble');
        A.equal(d.meuble, kind, kind + ' porte le bon nom de géométrie');
      });
    });

    it('SPEC-INTERIEUR-002 : une recette existe pour chaque meuble et pour le livre/la note', function () {
      // lit : 3 laines + 3 planches
      A.ok(Inv.matchRecipe([B.WOOL, B.WOOL, B.WOOL, B.PLANKS, B.PLANKS, B.PLANKS], 3, 2), 'lit');
      [
        [B.TABLE, [B.PLANKS, B.PLANKS, B.PLANKS, B.PLANKS]],
        [B.CHAISE, [B.PLANKS, B.PLANKS, I.STICK]],
        [B.ARMOIRE, [B.PLANKS, B.PLANKS, B.PLANKS, B.PLANKS, I.STICK, I.STICK]],
        [B.ETAGERE, [B.PLANKS, B.PLANKS, B.PLANKS, I.STICK]],
        [B.TAPIS, [B.WOOL, B.WOOL, I.TISSU]],
        [B.LAMPE, [I.STICK, B.GLASS, I.COAL]],
        [B.VASE, [B.CLAY, B.CLAY]],
        [B.PRESENTOIR, [I.STICK, I.STICK, I.STICK, B.PLANKS]],
        [B.SOCLE, [B.STONE, B.STONE, I.STICK]],
        [I.LIVRE, [I.CUIR, I.TISSU, I.TISSU]],
        [I.NOTE, [I.TISSU]],
      ].forEach(function (c) {
        var n = c[1].length;
        var r = Inv.matchRecipe(c[1], n, 1);
        A.ok(r && r.id === c[0], C.nameOf(c[0]) + ' se fabrique');
      });
      // bibliothèque : planches + 3 livres déjà écrits (vierges suffisent)
      var rBib = Inv.matchRecipe([B.PLANKS, B.PLANKS, B.PLANKS, I.LIVRE, I.LIVRE, I.LIVRE], 6, 1);
      A.ok(rBib && rBib.id === B.BIBLIOTHEQUE, 'bibliothèque');
    });

    it('SPEC-INTERIEUR-002 : pose orientée — la table (et les autres meubles) écrivent l\'orientation du regard dans l\'état', function () {
      var vus = {};
      [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2].forEach(function (yaw) {
        var g = partie();
        g.s.inv.add(B.CHAISE, 1); g.s.selected = 0;
        g.s.yaw = yaw;
        var t = { x: 5, y: 9, z: 5, block: B.STONE, nx: 0, ny: 1, nz: 0 };
        A.equal(g.pl.useOn(t), 'place', 'la chaise se pose');
        var etat = g.w.getEtat(5, 10, 5);
        var u = F.unpackMeuble(etat);
        A.equal(u.orientation, C.orientDeRegard(g.pl.lookDir()), 'orientation écrite dans l\'état');
        vus[u.orientation] = 1;
      });
      A.equal(Object.keys(vus).length, 4, 'les quatre orientations sont atteintes selon le regard');
    });

    it('SPEC-INTERIEUR-002 : poser un objet non-meuble ne consomme pas la branche mobilier (régression)', function () {
      var g = partie();
      g.s.inv.add(B.PLANKS, 1); g.s.selected = 0;
      var t = { x: 5, y: 9, z: 5, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), 'place');
      A.equal(g.w.getEtat(5, 10, 5), 0, 'aucune orientation pour un bloc ordinaire');
    });

    it('SPEC-INTERIEUR-002 : le lit occupe deux cases, pied et tête partagent l\'id mais pas la variante', function () {
      var g = partie();
      g.s.inv.add(B.LIT, 1); g.s.selected = 0;
      g.s.yaw = 0;   // regarde vers le nord (-z, DIRS[0])
      var t = { x: 5, y: 9, z: 6, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), 'place', 'le lit se pose');
      var pied = g.w.getBlock(5, 10, 6), tete = g.w.getBlock(5, 10, 5);
      A.equal(pied, B.LIT, 'pied posé');
      A.equal(tete, B.LIT, 'tête posée dans le prolongement du regard');
      A.notOk(F.unpackMeuble(g.w.getEtat(5, 10, 6)).variante, 'le pied n\'est pas la variante tête');
      A.ok(F.unpackMeuble(g.w.getEtat(5, 10, 5)).variante, 'la tête porte la variante');
      A.equal(g.s.inv.count(B.LIT), 0, 'un seul lit consommé pour les deux cases');
    });

    it('SPEC-INTERIEUR-002 : un lit ne se pose pas si la case de la tête n\'est pas libre', function () {
      var g = partie();
      g.w.setBlock(5, 10, 5, B.STONE);   // bloque la case de la tête
      g.s.inv.add(B.LIT, 1); g.s.selected = 0;
      g.s.yaw = 0;
      var t = { x: 5, y: 9, z: 6, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.notOk(g.pl.useOn(t), 'refusé, place manquante pour la tête');
      A.equal(g.s.inv.count(B.LIT), 1, 'rien consommé');
    });

    // ── boîtes de collision/maillage (MC.Formes) ─────────────────────────
    it('SPEC-INTERIEUR-002 : packMeuble/unpackMeuble font l\'aller-retour', function () {
      [[0, false], [1, true], [2, false], [3, true]].forEach(function (c) {
        var e = F.packMeuble(c[0], c[1]);
        var u = F.unpackMeuble(e);
        A.equal(u.orientation, c[0], 'orientation');
        A.equal(u.variante, c[1], 'variante');
      });
    });

    it('SPEC-INTERIEUR-002 : boitesMeuble tourne la géométrie selon l\'orientation', function () {
      var def = { meuble: 'chaise' };
      var n = F.boitesMeuble(def, F.packMeuble(0, false));
      var e = F.boitesMeuble(def, F.packMeuble(1, false));
      A.equal(n.length, 2, 'assise + dossier');
      A.equal(e.length, 2);
      // le dossier (2e boîte) est collé au nord à l'orientation 0…
      A.ok(n[1].z0 < 0.2 && n[1].z1 < 0.2, 'dossier au nord, orientation 0');
      // … et tourné (collé à l'est) après une rotation d'un quart de tour
      A.ok(e[1].x0 > 0.8 && e[1].x1 > 0.8, 'dossier à l\'est, orientation 1');
    });

    it('SPEC-INTERIEUR-002 : rotBox tourne une boîte d\'un quart de tour autour du centre', function () {
      var b = { x0: 0.1, y0: 0, z0: 0.1, x1: 0.3, y1: 1, z1: 0.3 };   // coin nord-ouest
      var r1 = F.rotBox(b, 1);   // -> coin nord-est
      A.close(r1.x0, 0.7, 1e-9); A.close(r1.x1, 0.9, 1e-9);
      A.close(r1.z0, 0.1, 1e-9); A.close(r1.z1, 0.3, 1e-9);
      var r4 = F.rotBox(b, 4);   // un tour complet revient au point de départ
      A.close(r4.x0, b.x0, 1e-9); A.close(r4.z0, b.z0, 1e-9);
    });

    it('SPEC-INTERIEUR-002 : chaque meuble a au moins une boîte de collision non vide', function () {
      MEUBLES.forEach(function (kind) {
        var boxes = F.boitesMeuble({ meuble: kind }, 0);
        A.ok(boxes.length >= 1, kind + ' a une géométrie');
        boxes.forEach(function (b) {
          A.ok(b.x1 > b.x0 && b.y1 > b.y0 && b.z1 > b.z0, kind + ' : boîte non dégénérée');
        });
      });
    });

    it('SPEC-INTERIEUR-002 : aucun meuble n\'est solide au sens isSolid (comme un escalier)', function () {
      MEUBLES.forEach(function (kind) {
        A.notOk(C.isSolid(BLOC_DE[kind]), kind + ' n\'est pas un bloc plein');
      });
    });

    // ── lampe : source de lumière ─────────────────────────────────────────
    it('SPEC-INTERIEUR-002 : la lampe éclaire', function () {
      A.ok(C.lightOf(B.LAMPE) > 0, 'la lampe émet de la lumière');
    });

    // ── armoire/étagère/bibliothèque : conteneurs (comme un coffre) ──────
    it('SPEC-INTERIEUR-002 : armoire, étagère et bibliothèque sont interactives comme un coffre', function () {
      A.equal(C.BLOCKS[B.ARMOIRE].interactive, 'armoire');
      A.equal(C.BLOCKS[B.ETAGERE].interactive, 'etagere');
      A.equal(C.BLOCKS[B.BIBLIOTHEQUE].interactive, 'bibliotheque');
      var g = partie();
      g.w.setBlock(5, 9, 5, B.ARMOIRE);
      var t = { x: 5, y: 9, z: 5, block: B.ARMOIRE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), 'open:armoire', 'interagir avec une armoire ouvre un conteneur');
    });

    // ── lit : dormir ───────────────────────────────────────────────────
    it('SPEC-INTERIEUR-002 : interagir avec un lit renvoie « dormir », quel que soit ce qu\'on tient', function () {
      var g = partie();
      g.w.setBlock(5, 9, 5, B.LIT);
      var t = { x: 5, y: 9, z: 5, block: B.LIT, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), 'dormir');
      g.s.inv.add(B.STONE, 1); g.s.selected = 0;
      A.equal(g.pl.useOn(t), 'dormir', 'même la main pleine, on dort');
    });

    it('SPEC-INTERIEUR-002 : dormir fait passer la nuit (avancerJourApresDormir)', function () {
      var jour = DC.DAY_LENGTH;
      // en pleine nuit du jour 0
      var tNuit = jour * 0.85;
      A.ok(DC.isNight(tNuit), 'c\'est bien la nuit au départ');
      var tApres = DC.avancerJourApresDormir(tNuit);
      A.ok(tApres > tNuit, 'le temps avance');
      A.equal(tApres, jour, 'saute exactement au début du jour suivant');
      A.notOk(DC.isNight(tApres), 'il ne fait plus nuit après avoir dormi');
      // dormir en tout début de journée avance quand même d'un jour plein
      A.equal(DC.avancerJourApresDormir(0), jour);
      A.equal(DC.avancerJourApresDormir(jour * 2 + 5), jour * 3);
    });

    // ── présentoir / socle : exposer un objet ────────────────────────────
    it('SPEC-INTERIEUR-002 : présentoir et socle renvoient exposer/retirer selon ce qu\'on tient', function () {
      A.ok(C.BLOCKS[B.PRESENTOIR].expose, 'présentoir marqué exposable');
      A.ok(C.BLOCKS[B.SOCLE].expose, 'socle marqué exposable');
      var g = partie();
      g.w.setBlock(5, 9, 5, B.PRESENTOIR);
      var t = { x: 5, y: 9, z: 5, block: B.PRESENTOIR, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), 'retirer', 'main vide : on retire (rien à retirer ici, mais l\'intention est claire)');
      g.s.inv.add(I.EMERALD, 1); g.s.selected = 0;
      A.equal(g.pl.useOn(t), 'exposer', 'un objet en main : on l\'expose');
    });
  });

  describe('Specs — SPEC-INTERIEUR-003 : livres et notes', function () {

    it('SPEC-INTERIEUR-003 : le livre et la note existent, écrivables (interagir renvoie « livre »)', function () {
      A.ok(C.ITEMS[I.LIVRE] && C.ITEMS[I.LIVRE].livre, 'le livre est marqué écrivable');
      A.ok(C.ITEMS[I.NOTE] && C.ITEMS[I.NOTE].livre, 'la note est marquée écrivable');
      var g = partie();
      g.s.inv.add(I.LIVRE, 1); g.s.selected = 0;
      var t = { x: 5, y: 9, z: 5, block: B.STONE, nx: 0, ny: 1, nz: 0 };
      A.equal(g.pl.useOn(t), 'livre');
    });

    it('SPEC-INTERIEUR-003 : écriture — titre et pages, plusieurs pages possibles', function () {
      var livre = L.creerLivre();
      A.equal(livre.pages.length, 1, 'une page au départ');
      A.notOk(livre.signe, 'pas signé');
      livre = L.definirTitre(livre, 'Mon journal');
      livre = L.definirPage(livre, 0, 'Première page.');
      livre = L.ajouterPage(livre);
      livre = L.definirPage(livre, 1, 'Deuxième page.');
      A.equal(livre.titre, 'Mon journal');
      A.equal(livre.pages.length, 2);
      A.equal(livre.pages[0], 'Première page.');
      A.equal(livre.pages[1], 'Deuxième page.');
    });

    it('SPEC-INTERIEUR-003 : signer fixe l\'auteur et rend le livre définitif', function () {
      var livre = L.creerLivre();
      livre = L.definirTitre(livre, 'Avant signature');
      A.ok(L.estModifiable(livre), 'modifiable avant signature');
      livre = L.signer(livre, 'Aldric');
      A.notOk(L.estModifiable(livre), 'plus modifiable après signature');
      A.equal(livre.auteur, 'Aldric', 'auteur affiché');
      A.ok(livre.signe);
      // toute tentative d'écriture après signature est refusée sans erreur
      var tentative = L.definirTitre(livre, 'Autre titre');
      A.equal(tentative.titre, 'Avant signature', 'le titre ne change plus une fois signé');
      var tentativePage = L.definirPage(livre, 0, 'Autre texte');
      A.equal(tentativePage.pages[0], '', 'les pages ne changent plus une fois signé');
      var tentativeAjout = L.ajouterPage(livre);
      A.equal(tentativeAjout.pages.length, 1, 'plus de pages ajoutables une fois signé');
    });

    it('SPEC-INTERIEUR-003 : livreDuMonde est une fonction pure — déterministe pour une graine et un lieu', function () {
      var lieu = { nom: 'Valombre', kind: 'village', x: 40, z: -12 };
      var a = L.livreDuMonde(42, lieu);
      var b = L.livreDuMonde(42, lieu);
      A.deep(a, b, 'même graine, même lieu -> même livre');
      A.ok(a.titre.indexOf('Valombre') >= 0, 'le titre cite le lieu');
      A.ok(a.pages.length >= 2, 'au moins deux pages');
      A.ok(a.signe, 'un livre du monde est déjà "signé" (pas d\'auteur joueur à modifier)');
      var c = L.livreDuMonde(1337, lieu);
      A.ok(a.titre !== c.titre || a.pages[0] !== c.pages[0], 'une autre graine change le contenu');
    });

    it('SPEC-INTERIEUR-003 : livreDuMonde varie selon le type de lieu', function () {
      var seed = 7;
      var village = L.livreDuMonde(seed, { nom: 'Aumont', kind: 'village', x: 1, z: 1 });
      var donjon = L.livreDuMonde(seed, { nom: 'Aumont', kind: 'donjon', x: 1, z: 1 });
      A.ok(village.pages[0] !== donjon.pages[0] || village.titre !== donjon.titre,
           'le gabarit dépend du type de lieu');
    });

    // ── persistance : le contenu d'un livre survit à la pile (inventaire, coffre/bibliothèque) ──
    it('SPEC-INTERIEUR-003 : le contenu d\'un livre survit à serialize/load d\'un inventaire (coffre ou bibliothèque)', function () {
      var inv = Inv.create(9);
      var livre = L.signer(L.definirTitre(L.creerLivre(), 'Secrets'), 'Iris');
      inv.setAt(0, { id: I.LIVRE, n: 1, data: livre });
      var serial = inv.serialize();
      A.ok(serial[0][3], 'le 4e champ (data) est bien écrit');

      // « passage dans une bibliothèque » : une autre pile (conteneur) le recharge
      var bibliotheque = Inv.create(18);
      bibliotheque.load(serial);
      var relu = bibliotheque.stackAt(0);
      A.equal(relu.id, I.LIVRE);
      A.deep(relu.data, livre, 'titre, pages, auteur et signature intacts');
    });

    /* ── l'écriture validée (opération « ecrire » de MC.Conteneurs, la même au
       serveur et dans la prédiction du client) ── */
    function joueurAvec(piles) {
      var inv = Inv.create(36);
      piles.forEach(function (p, i) { if (p) inv.setAt(i, p); });
      return { joueur: { inv: inv }, conteneur: function () { return null; } };
    }
    var Ct = MC.Conteneurs;
    it('SPEC-INTERIEUR-003 : écrire passe par une opération validée — bornée, nettoyée, refusée sur autre chose qu\'un livre', function () {
      var ctx = joueurAvec([{ id: I.LIVRE, n: 1 }, { id: B.STONE, n: 3 }, { id: I.NOTE, n: 1 }]);
      var ctl = String.fromCharCode(0), bidi = String.fromCharCode(0x202e);
      var r = Ct.appliquer(ctx, { k: 'ecrire', i: 0, titre: 'Mes\nmémoires' + ctl + ' et bien plus encore, un titre bien trop long', pages: ['Jour 1' + bidi + ' : pluie', 'Jour 2'] });
      A.ok(r.ok, 'écrit');
      var d = ctx.joueur.inv.stackAt(0).data;
      A.equal(d.titre, 'Mes mémoires et bien plus encore'.slice(0, L.MAX_TITRE), 'titre sur une ligne, nettoyé, borné à ' + L.MAX_TITRE);
      A.deep(d.pages, ['Jour 1 : pluie', 'Jour 2'], 'pages nettoyées');
      A.notOk(d.signe, 'pas encore signé');
      A.equal(Ct.appliquer(ctx, { k: 'ecrire', i: 1, titre: 'x', pages: ['y'] }).motif, 'incompatible', 'une pierre ne s\'écrit pas');
      A.equal(Ct.appliquer(ctx, { k: 'ecrire', i: 5, titre: 'x', pages: ['y'] }).motif, 'absent', 'une case vide non plus');
      // une note n'a qu'une page ; une page est bornée
      Ct.appliquer(ctx, { k: 'ecrire', i: 2, titre: '', pages: ['x'.repeat(1000), 'deuxième'] });
      var n = ctx.joueur.inv.stackAt(2).data;
      A.equal(n.pages.length, 1, 'une seule page pour une note');
      A.equal(n.pages[0].length, L.MAX_LONGUEUR_PAGE, 'page bornée');
    });

    it('SPEC-INTERIEUR-003 : la signature est celle que fixe l\'appelant (le serveur), et rien ne s\'écrit plus ensuite', function () {
      var ctx = joueurAvec([{ id: I.LIVRE, n: 1 }]);
      A.ok(Ct.appliquer(ctx, { k: 'ecrire', i: 0, titre: 'Fin', pages: ['Le mot de la fin'], signer: true, auteur: 'Aldric' }).ok);
      var d = ctx.joueur.inv.stackAt(0).data;
      A.ok(d.signe, 'signé'); A.equal(d.auteur, 'Aldric', 'auteur = celui que donne l\'opération (le nom tenu par le serveur)');
      var r = Ct.appliquer(ctx, { k: 'ecrire', i: 0, titre: 'Retouche', pages: ['autre'], signer: true, auteur: 'Usurpateur' });
      A.equal(r.motif, 'interdit', 'un livre signé est refusé');
      A.deep(ctx.joueur.inv.stackAt(0).data, d, 'et reste intact');
    });

    it('SPEC-INTERIEUR-003 : un livre plein tient toujours dans le `data` d\'une pile admis par les contrats (DATA_MAX)', function () {
      var ctx = joueurAvec([{ id: I.LIVRE, n: 1 }]);
      var pages = []; for (var k = 0; k < 8; k++) pages.push(new Array(111).join('"\n'));   // guillemets et sauts de ligne : échappés en JSON
      Ct.appliquer(ctx, { k: 'ecrire', i: 0, titre: 'T'.repeat(64), pages: pages, signer: true, auteur: 'N'.repeat(80) });
      var d = ctx.joueur.inv.stackAt(0).data;
      A.ok(JSON.stringify(d).length <= MC.ContratsV2.BORNES.DATA_MAX, 'JSON ' + JSON.stringify(d).length + ' ≤ ' + MC.ContratsV2.BORNES.DATA_MAX);
      A.ok(MC.ContratsV2.validerPile(ctx.joueur.inv.stackAt(0)), 'la pile passe validerPile (INV_MAJ ne la perdra pas)');
      A.ok(d.auteur.length <= L.MAX_AUTEUR, 'auteur borné');
      // borner : la forme sûre d'un livre venu d'ailleurs (fichier ancien, message), quelle qu'elle soit
      var vieux = L.borner({ titre: 42, pages: ['a', 'b', 'c'], auteur: null, signe: 1 }, true);
      A.deep(vieux, { titre: '42', pages: ['a'], auteur: null, signe: true }, 'borner : champs convertis, une note garde une page');
      A.deep(L.borner(null), { titre: '', pages: [''], auteur: null, signe: false }, 'borner : rien devient un livre vierge');
    });

    it('SPEC-INTERIEUR-003 : un livre signé reste sous la borne même avec un auteur de demi-paires de substitution (6 caractères JSON chacune)', function () {
      var Ct = MC.Conteneurs;
      var ctx = { joueur: { inv: Inv.create(36) }, regles: {} };
      ctx.joueur.inv.setAt(0, { id: I.LIVRE, n: 1 });
      var pages = []; for (var i = 0; i < 8; i++) pages.push('"'.repeat(220));
      var auteur = new Array(25).join(String.fromCharCode(0xd800)) + ' (joueur 2)';
      Ct.appliquer(ctx, { k: 'ecrire', i: 0, titre: 'T', pages: pages, signer: true, auteur: auteur });
      var d = ctx.joueur.inv.stackAt(0).data;
      A.ok(d.signe && d.auteur, 'le livre est signé');
      A.ok(JSON.stringify(d).length <= MC.ContratsV2.BORNES.DATA_MAX, 'JSON ' + JSON.stringify(d).length + ' <= ' + MC.ContratsV2.BORNES.DATA_MAX);
      A.ok(MC.ContratsV2.validerPile(ctx.joueur.inv.stackAt(0)), 'la pile signée passe validerPile (INV_MAJ ne sera pas rejeté)');
    });

    it('SPEC-INTERIEUR-003 : jetée puis ramassée, la pile garde son livre (data conservée)', function () {
      var w = G.flatWorld(9, B.STONE), ents = MC.createEntities(w);
      var livre = L.signer(L.ecrire(null, { titre: 'Voyage', pages: ['Page une'] }), 'Iris');
      ents.dropStack(5.5, 10.2, 5.5, { id: I.LIVRE, n: 1, data: livre });
      var item = ents.list.filter(function (e) { return e.type === 'item'; })[0];
      A.ok(item && item.data, 'l\'objet au sol porte le livre');
      A.deep(item.data, livre, 'contenu intact au sol');
      var inv = Inv.create(36);
      inv.addStack(item.item, item.n, item.data, item.dmg);
      A.deep(inv.stackAt(0).data, livre, 'ramassé : même livre dans l\'inventaire');
    });

    it('SPEC-INTERIEUR-003 : les bibliothèques des lieux tiennent l\'histoire du lieu et de ses voisins, et les indices des quêtes', function () {
      var lieu = { id: 'village:3,4', nom: 'Valombre', kind: 'village', x: 100, z: 100 };
      var voisins = [{ nom: 'Hautbourg', kind: 'ville', x: 500, z: 100 }, { nom: 'Clairval', kind: 'village', x: 100, z: -200 }];
      var indices = [{ nom: 'Temple de la jungle', x: 400, z: -200, gardien: 'Grand serpent' }, { nom: 'Crypte', x: 60, z: 160 }];
      var c1 = L.livreChronique(42, lieu, voisins), c2 = L.livreChronique(42, lieu, voisins);
      A.deep(c1, c2, 'chronique déterministe');
      A.ok(c1.signe && c1.titre.indexOf('Valombre') >= 0, 'chronique signée, au nom du lieu');
      A.ok(c1.pages.join(' ').indexOf('Hautbourg') >= 0 && c1.pages.join(' ').indexOf('à l\'est') >= 0, 'elle situe les voisins (Hautbourg, à l\'est)');
      var q = L.livreIndices(42, lieu, indices);
      A.deep(q, L.livreIndices(42, lieu, indices), 'carnet déterministe');
      var txt = q.pages.join(' ');
      A.ok(txt.indexOf('Temple de la jungle') >= 0 && txt.indexOf('nord-est') >= 0 && txt.indexOf('Grand serpent') >= 0, 'le carnet situe le temple au nord-est et nomme son gardien : ' + txt);
      A.ok(txt.indexOf('Crypte') >= 0, 'et la crypte voisine');
      A.ok(L.livreIndices(42, lieu, []).pages.length >= 2, 'sans donjon proche, le carnet le dit');
      [c1, q].forEach(function (b) { A.ok(JSON.stringify(b).length <= MC.ContratsV2.BORNES.DATA_MAX, 'tient dans une pile'); });
    });

    it('SPEC-INTERIEUR-003 : une pile sans data reste sérialisable comme avant (compatibilité)', function () {
      var inv = Inv.create(9);
      inv.setAt(0, { id: B.STONE, n: 5 });
      var serial = inv.serialize();
      A.deep(serial[0], [B.STONE, 5], 'pas de 3e/4e champ si dmg et data sont absents');
    });

    // ── persistance de partie : chests (tailles), expositions, spawnPoint ──
    it('SPEC-INTERIEUR-002/003 : une partie sauvegardée recharge conteneurs (avec leur taille), expositions et réapparition', function () {
      var st = mockStorage();
      var etat = etatMinimal(55);
      etat.expositions = {};
      etat.spawnPoint = { x: 12.5, y: 21, z: -4.5 };
      // une étagère (9 cases), pas un coffre (27) : la taille doit survivre
      etat.chests['10,20,10'] = Inv.create(9);
      etat.chests['10,20,10'].setAt(0, { id: I.NOTE, n: 1, data: L.signer(L.creerNote(), 'Bram') });
      etat.expositions['1,20,1'] = { id: I.EMERALD, n: 1, data: null };

      var m = MC.Saves.creer(st, { nom: 'IntérieurTest', graine: 55 });
      A.ok(MC.Saves.sauvegarder(st, m.id, etat), 'sauvegarde effectuée');

      var etat2 = etatMinimal(1);   // graine différente : la sauvegarde doit la restaurer
      etat2.expositions = {};
      MC.Saves.charger(st, m.id, etat2);

      A.equal(etat2.chests['10,20,10'].size, 9, 'la taille du conteneur (étagère) est restaurée');
      A.deep(etat2.chests['10,20,10'].stackAt(0).data, etat.chests['10,20,10'].stackAt(0).data,
             'le contenu de la note posée dans l\'étagère survit');
      /* SPEC-SYNC-027 : le miroir client des présentoirs n'est pas une source de vérité (id seul, sans la donnée
         d'un livre signé) : ni écrit dans la sauvegarde locale, ni relu — le serveur l'annonce. */
      A.equal(Object.keys(etat2.expositions).length, 0, 'le miroir des objets exposés n\'est pas restauré depuis la sauvegarde locale');
      A.deep(MC.Save.serialize(etat).expositions, [], 'et il n\'est pas écrit (ce serait un état périmé, sans donnée de livre)');
      A.deep(etat2.spawnPoint, etat.spawnPoint, 'la réapparition fixée par le lit survit à la sauvegarde');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
