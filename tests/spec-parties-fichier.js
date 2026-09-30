/* spec-parties-fichier.js — SPEC-ARCHI-014 (parité de persistance) et
   SPEC-ARCHI-015 (migration des parties existantes) : export d'un stockage de
   parties solo, relecture stricte, conversion en fichier de monde du serveur.
   Module testé : src/parties-fichier.js (pur, sans disque). Le chemin complet
   (API /api/parties, fichier réellement écrit, rechargé par le serveur) est
   vérifié par tests/integration-archi-parties.js. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, S = MC.Saves, PF = MC.PartiesFichier, V2 = MC.ContratsV2;
  var B = C.B, I = C.I;
  var mockStorage = G.mockStorage, etatMinimal = G.etatMinimal;

  // une partie solo « vécue » : blocs posés, coffre rempli, inventaire, équipement, position
  function partieVecue(st, nom, graine, mode) {
    var meta = S.creer(st, { nom: nom, graine: graine, mode: mode || 'survie', difficulte: 'difficile' });
    var etat = etatMinimal(graine, mode || 'survie', 'difficile');
    etat.world.setBlock(2, 40, 2, B.BRICK);
    etat.world.setBlock(3, 40, 2, B.CHEST);
    var p = etat.player.state;
    p.pos.x = 12.5; p.pos.y = 41.2; p.pos.z = -7.25; p.yaw = 1.25; p.pitch = -0.3;
    p.hp = 14; p.hunger = 9; p.selected = 3;
    p.inv.add(I.STICK, 5);
    p.inv.add(B.DIRT, 30);
    var coffre = MC.Inventory.create(27);
    coffre.add(I.STICK, 7);
    etat.chests['3,40,2'] = coffre;
    etat.spawnPoint = { x: 1, y: 40, z: 1 };
    etat.duree = 321;
    etat.time = 250;
    S.sauvegarder(st, meta.id, etat);
    return { meta: S.trouver(st, meta.id), etat: etat };
  }

  describe('Parties sur disque — export, import et parité de persistance', {
    teste: 'L\'export des parties solo (minicraft-parties.json), sa relecture stricte partie par partie, leur conversion en fichier de monde du serveur et le tableau de parité champ par champ de MC.Save.serialize.',
    pourquoi: 'Le solo passe par un serveur qui écrit des fichiers : sans migration fidèle, les parties existantes seraient perdues ; sans tableau de parité, un champ sauvegardé aujourd\'hui pourrait disparaître sans que personne ne le voie.',
    attendu: 'trois parties dont une corrompue → deux importées, une signalée ; graine, mode, position, inventaire, coffres et succès restitués à l\'identique ; aucun champ de Save.serialize sans destination.',
  }, function () {

    it('SPEC-ARCHI-015 : export puis relecture — 3 parties dont une corrompue → 2 importées, la corrompue signalée', function () {
      var st = mockStorage();
      var a = partieVecue(st, 'Alpha', 111, 'survie');
      var b = partieVecue(st, 'Beta', 222, 'creatif');
      var c = S.creer(st, { nom: 'Cassee', graine: 333 });
      st.setItem(S.slotKey(c.id), '{"slotV": 2, "v": 3, "seed":');          // JSON tronqué
      var exp = PF.exporter(st);
      A.equal(exp.format, 'minicraft-parties');
      A.equal(exp.parties.length, 3, 'l\'export reflète les trois parties');
      var lu = PF.analyserExport(JSON.stringify(exp));                       // le fichier téléchargé, relu comme texte
      A.equal(lu.erreur, undefined);
      A.equal(lu.parties.length, 2, 'deux parties importables');
      A.deep(lu.parties.map(function (p) { return p.meta.id; }).sort(), [a.meta.id, b.meta.id].sort());
      A.equal(lu.ignorees.length, 1, 'la corrompue est signalée');
      A.equal(lu.ignorees[0].id, c.id);
      A.ok(lu.ignorees[0].motif.length > 0, 'avec un motif');
    });

    it('SPEC-ARCHI-015 : un fichier étranger, une version inconnue ou un identifiant dangereux sont refusés sans bloquer les autres', function () {
      A.ok(PF.analyserExport('pas du json').erreur, 'JSON invalide');
      A.ok(PF.analyserExport({ format: 'autre', v: 1, parties: [] }).erreur, 'mauvais format');
      A.ok(PF.analyserExport({ format: 'minicraft-parties', v: 99, parties: [] }).erreur, 'mauvaise version d\'export');
      var st = mockStorage();
      var a = partieVecue(st, 'Alpha', 5);
      var exp = PF.exporter(st);
      var ancienne = JSON.parse(JSON.stringify(exp.parties[0]));
      ancienne.meta.id = 'ancienne'; ancienne.data.v = 99;                    // version de sauvegarde inconnue
      var piegee = JSON.parse(JSON.stringify(exp.parties[0]));
      piegee.meta.id = '../../etc/passwd';                                   // chemin dangereux
      var sansSlot = JSON.parse(JSON.stringify(exp.parties[0]));
      sansSlot.meta.id = 'sansslot'; sansSlot.data.slotV = 1;
      exp.parties.push(ancienne, piegee, sansSlot);
      var r = PF.analyserExport(exp);
      A.equal(r.parties.length, 1, 'seule la partie saine passe');
      A.equal(r.parties[0].meta.id, a.meta.id);
      A.equal(r.ignorees.length, 3, 'les trois autres sont signalées');
    });

    it('SPEC-ARCHI-015 : aller-retour export → import restitue graine, mode, position, inventaire, coffre, blocs', function () {
      var st = mockStorage();
      var a = partieVecue(st, 'Alpha', 4242, 'creatif');
      var lu = PF.analyserExport(JSON.parse(JSON.stringify(PF.exporter(st))));
      var p = lu.parties[0];
      var meta = PF.metaImportee(p.meta, p.data);
      A.equal(meta.id, a.meta.id, 'l\'identifiant est conservé');
      A.equal(meta.nom, 'Alpha');
      A.equal(meta.mode, 'creatif');
      A.equal(meta.difficulte, 'difficile');
      A.equal(meta.graine, 4242);
      A.equal(meta.duree, 321);
      var f = PF.migrerSauvegarde(p.meta, p.data);
      A.equal(f.v, 2, 'format de fichier de monde');
      A.equal(f.graine, 4242);
      A.equal(f.heure, 250, 'l\'heure du monde');
      A.ok(f.overrides.some(function (o) { return o[0] === 2 && o[1] === 40 && o[2] === 2 && o[3] === B.BRICK; }), 'le bloc posé');
      // le joueur solo (position, orientation, vie, faim, inventaire, point de réapparition)
      var solo = V2.validerEnregistrementJoueur(f.soloJoueur);
      A.ok(solo, 'enregistrement du joueur valide');
      A.equal(solo.etat.x, 12.5); A.equal(solo.etat.y, 41.2); A.equal(solo.etat.z, -7.25);
      A.equal(solo.etat.hp, 14); A.equal(solo.etat.hunger, 9); A.equal(solo.etat.selected, 3);
      A.close(solo.etat.yaw, 1.25, 0.001);
      A.deep(solo.etat.spawn, { x: 1, y: 40, z: 1 });
      var inv = MC.Inventory.create(36); inv.load(solo.inv);
      var total = function (id) { return inv.slots.reduce(function (n, s) { return n + (s && s.id === id ? s.n : 0); }, 0); };
      A.equal(total(I.STICK), 5, 'les bâtons de l\'inventaire');
      A.equal(total(B.DIRT), 30, 'la terre de l\'inventaire');
      // le coffre devient un conteneur du serveur, avec son contenu
      var coffre = f.conteneurs.filter(function (c) { return c.cle === '3,40,2'; })[0];
      A.ok(coffre, 'le coffre posé est migré');
      A.equal(coffre.type, 'chest');
      A.equal(coffre.slots.length, 27);
      A.equal(coffre.slots[0][0], I.STICK); A.equal(coffre.slots[0][1], 7);
      // tout le fichier survit à un aller-retour JSON
      A.deep(JSON.parse(JSON.stringify(f)), f);
    });

    it('SPEC-ARCHI-015 : une ancienne sauvegarde (v1, ids d\'objets décalés) est migrée comme dans le client', function () {
      var st = mockStorage();
      var a = partieVecue(st, 'Vieille', 77);
      var brut = JSON.parse(st.getItem(S.slotKey(a.meta.id)));
      A.equal(brut.v, 3);
      var f3 = PF.migrerSauvegarde(a.meta, brut);
      // la migration ne modifie jamais son entrée
      var avant = JSON.stringify(brut);
      PF.migrerSauvegarde(a.meta, brut);
      A.equal(JSON.stringify(brut), avant, 'l\'entrée n\'est pas modifiée');
      A.ok(f3.soloJoueur, 'joueur migré');
    });

    it('SPEC-ARCHI-014 : chaque champ de MC.Save.serialize a une destination dans le fichier de monde', function () {
      var etat = etatMinimal(9, 'survie', 'facile');
      etat.chests = {}; etat.furnaces = {}; etat.expositions = {}; etat.distributeurs = {};
      var data = MC.Save.serialize(etat);
      var manquants = Object.keys(data).filter(function (k) { return !(k in PF.PARITE); });
      A.deep(manquants, [], 'champs de Save.serialize sans destination : ' + manquants.join(', '));
      // et le tableau ne cite aucun champ qui n'existe plus
      var fantomes = Object.keys(PF.PARITE).filter(function (k) { return !(k in data); });
      A.deep(fantomes, [], 'champs du tableau absents de Save.serialize : ' + fantomes.join(', '));
    });

    it('SPEC-ARCHI-014 : les destinations du tableau existent réellement dans le fichier de monde migré', function () {
      var st = mockStorage();
      var a = partieVecue(st, 'Alpha', 31);
      var f = PF.migrerSauvegarde(a.meta, JSON.parse(st.getItem(S.slotKey(a.meta.id))));
      Object.keys(PF.PARITE).forEach(function (champ) {
        var dest = PF.PARITE[champ];
        if (dest.indexOf('aucun') === 0) return;
        var racine = dest.split('.')[0];
        A.ok(racine in f, champ + ' → ' + dest + ' : « ' + racine + ' » absent du fichier de monde');
        if (dest.indexOf('extras.') === 0) A.ok(dest.slice(7) in f.extras, champ + ' → ' + dest + ' absent de extras');
      });
      ['explores', 'reperes', 'suivi', 'reputation', 'expositions', 'histoire', 'vehicules', 'succes'].forEach(function (k) {
        A.ok(k in f.extras, 'extras.' + k);
      });
    });

    it('SPEC-ARCHI-013 : les identifiants de partie sont sûrs pour servir de nom de fichier', function () {
      ['p1abc-3xy', 'partie_1', 'A-b_C'].forEach(function (id) { A.ok(PF.idValide(id), id); });
      ['', '../x', 'a/b', 'a\\b', 'a.json', 'a b', 'x'.repeat(65), null, 12].forEach(function (id) { A.ok(!PF.idValide(id), String(id)); });
      // les identifiants engendrés par MC.Saves sont eux-mêmes valides
      for (var i = 0; i < 20; i++) A.ok(PF.idValide(S.nouvelId()), 'identifiant engendré');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
