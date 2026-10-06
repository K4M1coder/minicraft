/* spec-migration-ids.js — consolidation L40-bis, lot A : registre des champs
   porteurs d'ids d'objet (SPEC-SAVE-018), dans la sauvegarde solo
   (MC.Save.serialize) ET dans le fichier de monde du serveur (etatMonde de
   server.js), et ids de bloc inconnus conservés (SPEC-SAVE-028).
   Le refus d'un fichier de monde illisible (SPEC-SAVE-026) se vérifie sur un
   vrai serveur : tests/integration-monde-fichier.js. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var C = MC.Core, B = C.B, I = C.I;

  var OFF_V2 = C.FIRST_ITEM - C.ANCIEN_FIRST_ITEM;          // 128 → 4096
  function enV2(id) { return id - OFF_V2; }                 // id actuel → id d'objet v2 (128..255)
  function copie(x) { return JSON.parse(JSON.stringify(x)); }
  function vide(n) { var s = []; for (var i = 0; i < n; i++) s.push(0); return s; }
  // chemins où la valeur `x` apparaît (valeur OU clé d'objet : les stocks de
  // l'économie sont indexés par id)
  function cheminsDe(o, x, racine) {
    var out = [];
    (function parcourir(v, chemin) {
      if (v === x) { out.push(chemin); return; }
      if (!v || typeof v !== 'object') return;
      Object.keys(v).forEach(function (k) {
        if (String(x) === k) out.push(chemin + '[clé ' + k + ']');
        parcourir(v[k], chemin + '.' + k);
      });
    })(o, racine || 'data');
    return out;
  }
  function porteurs(registre) {
    return Object.keys(registre).filter(function (k) { return typeof registre[k] === 'function'; }).sort();
  }
  function enquete(objet) {
    return { archetype: 'enquete', enquete: {
      params: {}, depart: null, crime: 'vol_tresor', suspects: [], coupableId: null,
      indices: [{ id: 'objet0', type: 'objet', objet: objet, texte: 'Retrouvez l\'objet.', obtenu: false }],
      rebondissement: 'fuite', chapitres: ['crime', 'enquete', 'rebondissement', 'accusation'],
      chap: 1, commence: true, accusation: null, fin: null, journal: [] } };
  }
  function economieAvec(id) {
    var st = {}; st[id] = [3, 3, 0];
    var mi = {}; mi[id] = 2;
    return { v: 1, graine: 4242, jour: 0, joueurs: [], departs: [],
             lieux: [['lieu1', { id: 'lieu1', biome: 'plaines', x: 0, z: 0, tresor: 0, tresorCible: 0, stocks: st, minerai: mi, pnjs: {} }]] };
  }
  /* État de partie « complet » : tous les modules optionnels que lit
     MC.Save.serialize sont présents (coffres, distributeurs, présentoirs,
     économie, guildes, succès, récit). */
  function etatComplet() {
    var e = G.etatMinimal(4242);
    e.expositions = {};
    e.distributeurs = {};
    e.economie = MC.Economie.creerEtat(4242);
    e.guildes = MC.Guildes.creerEtat();
    e.succes = MC.Succes.creer();
    e.histoire = null;
    e.spawnPoint = null;
    return e;
  }

  /* Sauvegarde v2 forgée : l'id 129 (le charbon de la v2) dans CHAQUE champ
     porteur d'ids d'objet — y compris ceux qu'une vraie v2 ne portait pas
     encore (équipement, distributeurs, présentoirs, économie) : si une
     future renumérotation les touche, ils doivent suivre. 129 ne figure
     nulle part ailleurs. */
  var X = 129;
  function v2Forgee() {
    var soute = vide(9); soute[2] = [X, 1];
    return {
      v: 2, seed: 4242, time: 30, overrides: [], crops: [], donjons: [], pilles: [],
      explores: [], reperes: [], suivi: 0, reputation: null, pnjsMorts: [], succes: null,
      banque: [[X, 5]].concat(vide(26)),
      vehicules: [['camion', 5.5, 40, 5.5, 0, soute]],
      histoire: enquete(X),
      economie: economieAvec(X),
      expositions: [['7,40,7', X, 1, null]],
      distributeurs: [['8,40,8', [[X, 2]].concat(vide(8))]],
      player: { x: 3, y: 40, z: 3, yaw: 0, pitch: 0, hp: 20, hunger: 20, air: 10, selected: 0, flying: false,
                inv: [[X, 10]].concat(vide(35)), equip: { casque: [X, 1], plastron: 0, jambieres: 0, bottes: 0, bijou: 0 } },
      chests: [['1,40,1', [[X, 3]].concat(vide(26)), 27]],
      furnaces: [['2,40,2', [X, 1], [X, 4], [X, 2], 0, 0]],
    };
  }

  describe('Specs — SPEC-SAVE-018 : registre des champs porteurs d\'ids d\'objet (sauvegarde solo)', function () {

    it('SPEC-SAVE-018 : chaque clé de serialize(état complet) est classée dans CHAMPS_IDS', function () {
      var e = etatComplet();
      e.world.banque.add(I.COAL, 3);
      e.chests['1,40,1'] = MC.Inventory.create(27);
      e.distributeurs['2,40,2'] = MC.Inventory.create(9);
      e.expositions['3,40,3'] = { id: I.EMERALD, n: 1 };
      e.furnaces['4,40,4'] = { input: { id: B.IRON_ORE, n: 1 }, fuel: { id: I.COAL, n: 1 }, output: null, burn: 0, cook: 0 };
      e.spawnPoint = { x: 1, y: 40, z: 1 };
      var data = MC.Save.serialize(e);
      var classees = Object.keys(MC.Save.CHAMPS_IDS);
      var hors = Object.keys(data).filter(function (k) { return classees.indexOf(k) < 0; });
      A.deep(hors, [], 'clés de serialize ⊆ clés classées');
      A.deep(MC.Save.champsNonClasses(data), [], 'et champsNonClasses le confirme (champs du joueur compris)');
      // chaque entrée est soit une fonction de migration, soit un texte « sans id » motivé
      classees.forEach(function (k) {
        var v = MC.Save.CHAMPS_IDS[k];
        A.ok(typeof v === 'function' || (typeof v === 'string' && v.length > 12), k + ' : migré ou motivé');
      });
      // un champ ajouté à serialize sans classement fait échouer ce test
      data.champNeuf = [[I.COAL, 1]];
      A.deep(MC.Save.champsNonClasses(data), ['champNeuf'], 'un champ neuf non classé est signalé');
    });

    it('SPEC-SAVE-018 : une sauvegarde v2 où chaque champ porteur contient l\'id 129 n\'en contient plus aucun après migration', function () {
      var f = v2Forgee();
      // la sauvegarde forgée couvre bien TOUS les porteurs déclarés (un porteur
      // ajouté à CHAMPS_IDS sans être forgé ici fait échouer ce test)
      var forges = porteurs(MC.Save.CHAMPS_IDS).filter(function (k) { return cheminsDe(f[k], X).length > 0; });
      A.deep(forges, porteurs(MC.Save.CHAMPS_IDS), 'chaque porteur de CHAMPS_IDS contient 129 dans la sauvegarde forgée');
      A.ok(cheminsDe(f.player.inv, X).length && cheminsDe(f.player.equip, X).length, 'inventaire et équipement aussi');
      // migration seule : plus aucun 129, nulle part
      var m = MC.Save.migrerV2(copie(f));
      A.deep(cheminsDe(m, X), [], 'plus aucun 129 dans la sauvegarde migrée');
      A.equal(m.banque[0][0], I.COAL, 'devenu le charbon de l\'espace actuel');
      A.equal(m.expositions[0][1], I.COAL, 'l\'ancien contenu exposé reste migré pour son import par le serveur');
      // chargement réel puis balayage des chemins porteurs de la sauvegarde réécrite
      var e = etatComplet();
      A.ok(MC.Save.apply(copie(f), e), 'la sauvegarde forgée se charge');
      var s = MC.Save.serialize(e);
      var restes = [];
      porteurs(MC.Save.CHAMPS_IDS).forEach(function (k) { restes = restes.concat(cheminsDe(s[k], X, k)); });
      A.deep(restes, [], 'aucun chemin porteur ne contient 129 après MC.Save.apply');
      A.equal(e.world.banque.slots[0].id, I.COAL, 'banque');
      A.equal(e.distributeurs['8,40,8'].slots[0].id, I.COAL, 'distributeur');
      A.deep(e.expositions, {}, 'le miroir des présentoirs attend son état du serveur');
      A.deep(s.expositions, [], 'le miroir client ne remplace jamais le contenu tenu par le serveur');
      A.equal(e.histoire.enquete.indices[0].objet, I.COAL, 'indice d\'enquête');
      A.ok(e.economie.lieux.get('lieu1').stocks[I.COAL], 'stock de l\'économie réindexé sur le charbon actuel');
    });

    it('SPEC-SAVE-018 : migrer deux fois donne le même résultat que migrer une fois', function () {
      var une = MC.Save.migrerV2(copie(v2Forgee()));
      A.deep(MC.Save.migrerV2(copie(une)), une, 'migrerV2 ∘ migrerV2 = migrerV2');
      var v1 = v2Forgee(); v1.v = 1;
      var a = MC.Save.migrerV1(copie(v1));
      A.deep(MC.Save.migrerV1(copie(a)), a, 'migrerV1 ∘ migrerV1 = migrerV1');
      // la conversion elle-même ne décale qu'une fois, même appliquée deux fois
      var conv = function (v) { return v >= C.ANCIEN_FIRST_ITEM && v < 2 * C.ANCIEN_FIRST_ITEM ? v + OFF_V2 : v; };
      var d1 = MC.Save.migrerIdsObjets(copie(v2Forgee()), conv);
      var d2 = MC.Save.migrerIdsObjets(copie(d1), conv);
      A.deep(d2, d1, 'migrerIdsObjets avec la conversion v2 : idempotente');
    });

    it('SPEC-SAVE-018 : apply d\'une sauvegarde déjà migrée la laisse identique', function () {
      var e1 = etatComplet();
      A.ok(MC.Save.apply(copie(v2Forgee()), e1), 'v2 chargée');
      var s1 = copie(MC.Save.serialize(e1));
      A.equal(s1.v, MC.Save.VERSION, 'réécrite au format courant');
      var avant = copie(s1);
      var e2 = etatComplet();
      A.ok(MC.Save.apply(s1, e2), 'la sauvegarde migrée se recharge');
      A.deep(s1, avant, 'apply ne modifie pas la sauvegarde qu\'on lui passe');
      A.deep(copie(MC.Save.serialize(e2)), s1, 'recharger une sauvegarde migrée ne la change pas (aucun second décalage)');
    });
  });

  /* Fichier de monde du serveur (server.js, etatMonde) : même règle. Les
     porteurs y sont l'enregistrement des joueurs (inventaire, équipement,
     banque), les conteneurs posés, l'économie, les soutes, les récits
     (indices d'enquête), le joueur et les extras d'une partie solo importée. */
  function enregistrement(id) {
    return { v: 1, inv: [[id, 1]].concat(vide(35)), equip: { casque: [id, 1], plastron: 0, jambieres: 0, bottes: 0, bijou: 0 },
             banque: [[id, 2]].concat(vide(26)), succes: { debloques: [], compte: {} },
             etat: { x: 1, y: 40, z: 1, yaw: 0, pitch: 0, hp: 20, hunger: 20, air: 10, selected: 0, flying: false, spawn: null } };
  }
  function mondeForge(id) {
    var soute = vide(9); soute[0] = [id, 3];
    return {
      v: 2, graine: 4242, heure: 60,
      overrides: [[0, 40, 0, B.STONE]], etats: [], crops: [], donjons: [], pilles: [], pnjsMorts: [],
      admin: { v: 1, journal: [] }, zones: null, politique: null, guildes: null,
      economie: economieAvec(id),
      joueurs: [['alice#0', enregistrement(id)]],
      conteneurs: [{ cle: '1,40,1', type: 'chest', slots: [[id, 4]].concat(vide(26)) },
                   { cle: '2,40,2', type: 'furnace', slots: [[id, 1], [id, 1], [id, 1]], four: { burn: 0, cook: 0 } }],
      pvp: { v: 1, meurtres: [], victoires: [], reputations: [] },
      quetes: [['alice', [{ id: 'f1:quete:0', faction: 'f1', type: 'livrer', ressource: 'or', statut: 'active' }]]],
      commandes: [],
      vehicules: [['camion', 5.5, 40, 5.5, 0, soute]],
      expositions: [[4, 40, 4, [id, 1]], [5, 40, 4, [id, 1, 0, { titre: 'Mémoires' }]]],
      histoire: { v: 1, liens: null, recits: [['alice#0', { recit: enquete(id), fin: null }]] },
      soloJoueur: enregistrement(id),
      extras: { explores: [], reperes: [], suivi: 0, reputation: null, expositions: [['3,40,3', id, 1, null]],
                histoire: enquete(id), vehicules: [['bateau', 1.5, 40, 1.5, 0, soute.slice()]], succes: null },
      importeDe: { id: 'ancienne', version: 3 },
    };
  }

  describe('Specs — SPEC-SAVE-018 : registre des champs porteurs d\'ids d\'objet (fichier de monde du serveur)', function () {

    it('SPEC-SAVE-018 : chaque champ du fichier de monde est classé, joueurs, conteneurs et extras compris', function () {
      A.ok(MC.Save.CHAMPS_IDS_MONDE, 'registre du fichier de monde exposé');
      var m = mondeForge(I.COAL);
      A.deep(MC.Save.champsMondeNonClasses(m), [], 'tous les champs du monde forgé sont classés');
      // un import réel (MC.PartiesFichier.migrerSauvegarde) aussi
      var e = etatComplet();
      e.world.banque.add(I.COAL, 1);
      var imp = MC.PartiesFichier.migrerSauvegarde({ id: 'x' }, copie(MC.Save.serialize(e)));
      A.deep(MC.Save.champsMondeNonClasses(imp), [], 'le fichier de monde d\'une partie importée est classé');
      // un champ neuf, à chaque niveau, est signalé
      m.nouveau = 1;
      m.joueurs[0][1].nouveauJoueur = 1;
      m.soloJoueur.nouveauSolo = 1;
      m.conteneurs[0].nouveauConteneur = 1;
      m.extras.nouvelExtra = 1;
      A.deep(MC.Save.champsMondeNonClasses(m).sort(),
             ['conteneurs.nouveauConteneur', 'extras.nouvelExtra', 'joueurs.nouveauJoueur', 'nouveau', 'soloJoueur.nouveauSolo'],
             'un champ ni migré ni déclaré neutre fait échouer ce test');
    });

    it('SPEC-SAVE-018 : chaque entrée des registres du fichier de monde est migrée ou motivée', function () {
      var motive = /^sans id d'objet : .{4,}/;
      [['CHAMPS_IDS', MC.Save.CHAMPS_IDS], ['CHAMPS_IDS_MONDE', MC.Save.CHAMPS_IDS_MONDE],
       ['CHAMPS_ENREGISTREMENT', MC.Save.CHAMPS_ENREGISTREMENT], ['CHAMPS_CONTENEUR', MC.Save.CHAMPS_CONTENEUR]].forEach(function (r) {
        A.ok(r[1] && Object.keys(r[1]).length > 0, r[0] + ' exposé');
        Object.keys(r[1] || {}).forEach(function (k) {
          var v = r[1][k];
          A.ok(typeof v === 'function' || (typeof v === 'string' && motive.test(v)), r[0] + '.' + k + ' : fonction de migration, ou « sans id » et pourquoi');
        });
      });
      A.deep(porteurs(MC.Save.CHAMPS_ENREGISTREMENT), ['banque', 'equip', 'inv'], 'un joueur porte des objets dans inv, equip, banque');
      A.deep(porteurs(MC.Save.CHAMPS_CONTENEUR), ['slots'], 'un conteneur posé, dans slots');
    });

    it('SPEC-SAVE-018 : migrerIdsObjetsMonde renumérote chaque porteur du fichier de monde, une seule fois', function () {
      var m = mondeForge(X);
      var forges = porteurs(MC.Save.CHAMPS_IDS_MONDE).filter(function (k) { return cheminsDe(m[k], X).length > 0; });
      A.deep(forges, porteurs(MC.Save.CHAMPS_IDS_MONDE), 'le monde forgé couvre chaque porteur déclaré');
      var conv = function (v) { return v >= C.ANCIEN_FIRST_ITEM && v < 2 * C.ANCIEN_FIRST_ITEM ? v + OFF_V2 : v; };
      var une = MC.Save.migrerIdsObjetsMonde(copie(m), conv);
      A.deep(cheminsDe(une, X), [], 'plus aucun 129 dans le fichier de monde');
      A.deep(une.joueurs[0][1].banque[0], [I.COAL, 2], 'banque d\'un joueur nommé');
      A.deep(une.conteneurs[1].slots[1], [I.COAL, 1], 'combustible d\'un fourneau posé');
      A.equal(une.histoire.recits[0][1].recit.enquete.indices[0].objet, I.COAL, 'indice d\'enquête d\'un joueur');
      A.equal(une.extras.expositions[0][1], I.COAL, 'présentoir d\'une partie importée');
      A.deep(une.expositions[0][3], [I.COAL, 1], 'SPEC-SYNC-027 : objet exposé sur un présentoir du serveur');
      A.deep(une.expositions[1][3], [I.COAL, 1, 0, { titre: 'Mémoires' }], 'SPEC-SYNC-027 : et la donnée de ce livre reste intacte');
      A.deep(MC.Save.migrerIdsObjetsMonde(copie(une), conv), une, 'migrer deux fois = migrer une fois');
    });
  });

  describe('Specs — SPEC-SAVE-028 : un id de bloc inconnu est conservé', function () {
    var INCONNU = 3999;
    var P = [5, 120, 5];                         // en plein ciel : ses six faces se voient

    it('SPEC-SAVE-028 : 3999 n\'est pas défini (bloc d\'une version plus récente)', function () {
      A.notOk(C.BLOCKS[INCONNU], 'aucun bloc 3999 dans cette version');
      A.ok(C.isBlock(INCONNU), 'mais il est dans l\'espace des blocs');
    });

    it('SPEC-SAVE-028 : un override d\'id inconnu se charge, se lit, se dessine en cube neutre et survit à la sauvegarde', function () {
      var data = copie(MC.Save.serialize(etatComplet()));
      data.overrides.push([P[0], P[1], P[2], INCONNU]);
      var e = etatComplet();
      A.ok(MC.Save.apply(data, e), 'chargé sans erreur');
      e.world.getChunk(0, 0, true);
      A.equal(e.world.getBlock(P[0], P[1], P[2]), INCONNU, 'getBlock vaut 3999');
      A.equal(e.world.overrides.get(P.join(',')), INCONNU, 'conservé tel quel dans overrides');
      // le maillage : un cube plein, identique à celui du bloc de substitution posé au même endroit
      var ch = e.world.getChunk(0, 0, true);
      var mi = MC.Mesher.buildChunk(ch, 'opaque', e.world.getBlock);
      var ref = G.etatMinimal(4242);
      ref.world.getChunk(0, 0, true);
      ref.world.setBlock(P[0], P[1], P[2], C.BLOC_INCONNU.substitut);
      var mr = MC.Mesher.buildChunk(ref.world.getChunk(0, 0, true), 'opaque', ref.world.getBlock);
      A.equal(mi.positions.length, mr.positions.length, 'autant de sommets qu\'un cube du bloc de substitution');
      A.deep(mi.uvs, mr.uvs, 'mêmes faces, même texture neutre');
      var vide2 = G.etatMinimal(4242);
      var mv = MC.Mesher.buildChunk(vide2.world.getChunk(0, 0, true), 'opaque', vide2.world.getBlock);
      A.equal(mi.positions.length - mv.positions.length, 6 * 4 * 3, 'le bloc inconnu ajoute exactement six faces');
      // physique : un cube qu'on ne traverse pas, que la visée touche sans erreur
      A.ok(C.isSolid(INCONNU), 'solide comme un cube');
      A.ok(C.defRendu(INCONNU) === C.BLOC_INCONNU, 'rendu par le bloc neutre');
      A.equal(C.defRendu(I.COAL), undefined, 'un objet n\'a pas de rendu de bloc');
      A.equal(C.defRendu(B.STONE), C.BLOCKS[B.STONE], 'un bloc défini garde sa définition');
      // la sauvegarde le réécrit tel quel
      var s = MC.Save.serialize(e);
      A.ok(s.overrides.some(function (o) { return o[0] === P[0] && o[1] === P[1] && o[2] === P[2] && o[3] === INCONNU; }),
           'l\'override 3999 est toujours dans la sauvegarde réécrite');
    });

    it('SPEC-SAVE-028 : la visée d\'un bloc inconnu ne lève pas d\'erreur', function () {
      var e = G.etatMinimal(4242);
      e.world.getChunk(0, 0, true);
      e.world.setBlock(P[0], P[1], P[2], INCONNU);
      var hit = MC.Physics.raycast(e.world, { x: P[0] + 0.5, y: P[1] + 3.5, z: P[2] + 0.5 }, { x: 0, y: -1, z: 0 }, 6);
      A.ok(hit && hit.x === P[0] && hit.y === P[1] && hit.z === P[2], 'le rayon s\'arrête sur le bloc inconnu');
    });

    it('SPEC-SAVE-028 : la visée du joueur (aim) s\'arrête sur le bloc inconnu, sans cibler ce qui est derrière', function () {
      var e = G.etatMinimal(4242);
      e.world.getChunk(0, 0, true);
      e.world.setBlock(P[0], P[1], P[2], INCONNU);
      e.world.setBlock(P[0], P[1] - 1, P[2], B.STONE);           // derrière lui, dans l'axe
      var st = e.player.state;
      st.pos.x = P[0] + 0.5; st.pos.y = P[1] + 1; st.pos.z = P[2] + 0.5;
      st.yaw = 0; st.pitch = -Math.PI / 2 + 1e-4;                // regard vers le bas
      var cible = e.player.aim();
      A.ok(cible, 'un bloc est visé');
      A.equal(cible && cible.y, P[1], 'la visée s\'arrête sur le bloc inconnu');
      A.equal(cible && cible.block, INCONNU, 'et le désigne, pas la pierre derrière');
    });

    it('SPEC-SAVE-028 : le bloc inconnu arrête la lumière comme un cube plein', function () {
      A.ok(MC.Lumiere.opaque(INCONNU), 'opaque pour la propagation de la lumière');
      A.ok(MC.Lumiere.opaque(B.STONE), 'la pierre reste opaque');
      A.notOk(MC.Lumiere.opaque(B.GLASS), 'le verre reste transparent');
      A.equal(MC.Lumiere.emission(INCONNU), 0, 'et n\'émet aucune lumière');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
