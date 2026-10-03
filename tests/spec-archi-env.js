/* spec-archi-env.js — lot B-ENV du chantier « solo = serveur toujours présent »
   (SPEC-ARCHI-022, 023, 024, 025, 034, 035) : ce que le CLIENT ne fait plus.
   Fichier Node-only, comme spec-crochets.js : il lit le texte de src/game.js,
   de README.md et de CHANGELOG.md sur disque (`require` et `__dirname` sont
   exposés par tests/run.js). Le comportement du SERVEUR qui remplace ces
   simulations est prouvé par tests/integration-archi-env.js (vrais processus) ;
   l'espion `world.tick` du client réel est dans tests/e2e.js. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path');
  var RACINE = path.join(__dirname, '..');
  var GAME = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
  /* Le code sans ses commentaires (blocs et lignes entières) : les fiches parlent de ce que le code FAIT. */
  var CODE = GAME.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /* Corps d'une fonction de premier niveau de createGame (indentation à 4
     espaces) : jusqu'à la prochaine ligne qui commence à cette indentation
     par autre chose que « } ». */
  function corps(nom) {
    var i = GAME.indexOf('function ' + nom + '(');
    A.ok(i >= 0, 'la fonction ' + nom + ' existe dans src/game.js');
    var reste = GAME.slice(i + 10);
    var m = /\n    [^\s}]/.exec(reste);
    return GAME.slice(i, i + 10 + (m ? m.index : reste.length));
  }
  function changelogNonPublie() {
    var t = fs.readFileSync(path.join(RACINE, 'CHANGELOG.md'), 'utf8');
    var i = t.indexOf('## [Non publié]');
    var j = t.indexOf('\n## [', i + 5);
    return t.slice(i, j < 0 ? t.length : j);
  }

  describe('Specs — ARCHI B-ENV : le client ne simule plus les aléas du monde', function () {

    it('SPEC-ARCHI-022 : game.js n\'appelle plus hurt/setBlock/damage pour la foudre, et n\'a plus de simulation de tornade', function () {
      A.equal(CODE.indexOf('tornadesAuSol'), -1, 'plus de tornadesAuSol (poussée et arrachage clients)');
      A.equal(CODE.indexOf('pousseeTornade'), -1, 'le client ne calcule plus la poussée d\'une tornade');
      var meteo = corps('majMeteo');
      ['.hurt(', 'setBlock', 'entities.damage', 'allumerParFoudre', '.vel.'].forEach(function (interdit) {
        A.equal(meteo.indexOf(interdit), -1, 'majMeteo (éclairs, tornades) ne contient pas « ' + interdit + ' »');
      });
      A.ok(meteo.indexOf('render.eclair(') >= 0 && meteo.indexOf('audio.tonnerre(') >= 0, 'il reste le rendu de l\'éclair et son tonnerre');
    });

    it('SPEC-ARCHI-022 : la poussée d\'une tornade se calcule sur la liste fournie (le serveur la passe), nulle hors de portée', function () {
      var me = MC.createWorld(20260921).meteo;
      var liste = [{ id: 't', x: 0, z: 0, rayon: 10, force: 1, vie: 5, sens: 1 }];
      var f = me.pousseeTornade(6, 0, 0, 1000, liste);
      A.gt(Math.abs(f.x) + Math.abs(f.z), 1, 'poussée horizontale près de l\'axe');
      A.gt(f.y, 0, 'soulèvement');
      var loin = me.pousseeTornade(5000, 0, 5000, 1000, liste);
      A.equal(loin.x + loin.y + loin.z, 0, 'aucune poussée hors de portée');
      var vide = me.pousseeTornade(6, 0, 0, 1000, []);
      A.equal(vide.x + vide.y + vide.z, 0, 'aucune tornade dans la liste, aucune poussée');
    });

    it('SPEC-ARCHI-023 : game.js ne crée plus ni bombe volcanique ni coulée de lave/basalte (comportement SUPPRIMÉ)', function () {
      ['projectiles(', '\'bombe\'', 'Volcanisme.coulee', 'V.coulee', 'etatCellule', 'C.B.LAVA', 'C.B.BASALT', 'coulees'].forEach(function (interdit) {
        A.equal(CODE.indexOf(interdit), -1, 'game.js ne contient plus « ' + interdit + ' »');
      });
      var volcans = corps('volcans');
      A.equal(volcans.indexOf('entities.'), -1, 'volcans() ne touche à aucune entité');
      A.equal(volcans.indexOf('world.setBlock'), -1, 'volcans() ne modifie pas le monde');
      A.ok(volcans.indexOf('render.majVolcans') >= 0 && volcans.indexOf('audio.jouer') >= 0, 'mais le panache, le grondement et l\'éruption restent visibles et audibles');
      // « Non publié » avant la publication, la section de version après : le journal ENTIER
      var cl = require('fs').readFileSync(require('path').join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
      var supprime = /### Supprimé[\s\S]*?bombes/i.exec(cl);
      A.ok(supprime, 'le CHANGELOG a une ligne « Supprimé » sur les bombes volcaniques');
    });

    it('SPEC-ARCHI-024 : game.js n\'a plus de peuplerLieux : les habitants viennent des créatures du serveur', function () {
      A.equal(CODE.indexOf('peuplerLieux'), -1, 'plus de peuplerLieux client');
      A.equal(CODE.indexOf('pnjsSuivis'), -1, 'plus de suivi client des habitants');
      A.equal(CODE.indexOf('pnjsManquants'), -1, 'le client ne décide plus qui manque à un lieu');
    });

    it('SPEC-ARCHI-025 : game.js n\'écrit plus l\'heure pour dormir, pour un service ni pour /heure ; plus de dormeurs client', function () {
      ['dormir', 'actionCommandeHeure', 'rendreService'].forEach(function (nom) {
        A.equal(corps(nom).replace(/\/\*[\s\S]*?\*\//g, '').indexOf('g.time ='), -1, nom + ' n\'écrit pas g.time');
      });
      A.equal(CODE.indexOf('dormeurs'), -1, 'la liste des dormeurs n\'existe plus côté client');
      A.equal(CODE.indexOf('avancerJourApresDormir'), -1, 'le client ne fait plus passer la nuit');
      A.ok(corps('dormir').indexOf('net.dormir(') >= 0, 'dormir envoie DORMIR au serveur');
      A.ok(corps('actionCommandeHeure').indexOf('net.admin(\'heure\'') >= 0, '/jour et /nuit sont une demande ADMIN « heure »');
      A.ok(corps('rendreService').indexOf('net.dormir(') >= 0, 'la chambre d\'auberge se couche aussi par DORMIR');
    });

    it('SPEC-ARCHI-025 : net.dormir émet un DORMIR valide et /jour émet un ADMIN « heure » accepté par le protocole', function () {
      if (!MC.createNetClient) G.Function(fs.readFileSync(path.join(RACINE, 'src', 'net.js'), 'utf8'))();
      var envoyes = [];
      var avant = G.WebSocket;
      function WS() { this.readyState = 1; }
      WS.prototype.send = function (txt) { envoyes.push(JSON.parse(txt)); };
      WS.prototype.close = function () { this.readyState = 3; };
      G.WebSocket = WS;
      try {
        var net = MC.createNetClient({});
        net.connecter('ws://faux', 'Joueur', 2);
        envoyes.length = 0;
        A.ok(net.dormir(1, true), 'net.dormir rend vrai quand la liaison est ouverte');
        A.deep(envoyes[0], { t: 'dormir', j: 1, actif: true });
        A.ok(MC.ContratsArchi.valider(envoyes[0]), 'le contrat accepte le message');
        net.dormir(0, false);
        A.equal(envoyes[1].actif, false, 'se lever = actif faux');
        var cmd = MC.Chat.parseCommande('/jour');
        var res = MC.Commandes.executer(cmd, { dureeJour: MC.DayCycle.DAY_LENGTH });
        A.equal(res.actions[0].type, 'heure', '/jour renvoie une action heure');
        net.admin('heure', { valeur: res.actions[0].valeur });
        A.equal(envoyes[2].t, 'admin');
        A.equal(envoyes[2].action, 'heure');
        var vu = MC.NetProtocol.valider(envoyes[2]);
        A.ok(vu && vu.action === 'heure' && vu.args.valeur === res.actions[0].valeur, 'le serveur accepte la forme du message');
      } finally { G.WebSocket = avant; }
    });

    it('SPEC-ARCHI-034 : game.js ne fait plus apparaître de créature ni n\'éveille de gardien, et le tic du monde client coupe eau, circuits, cultures et feu', function () {
      ['trySpawn', 'trySpawnSouterrain', 'burnUndead', 'invoquerGardien', 'invoquerGardes', 'spawnT'].forEach(function (interdit) {
        A.equal(CODE.indexOf(interdit), -1, 'game.js ne contient plus « ' + interdit + ' »');
      });
      var opts = corps('optionsTickClient');
      ['eau: false', 'circuits: false', 'feu: false', 'cultures: false'].forEach(function (o) {
        A.ok(opts.indexOf(o) >= 0, 'optionsTickClient() contient « ' + o + ' »');
      });
      var appels = CODE.match(/world\.tick\(/g) || [];
      var viaOptions = CODE.match(/world\.tick\(dt, 14, null, optionsTickClient\(\)\)/g) || [];
      A.equal(appels.length, viaOptions.length, 'tous les world.tick du client passent par optionsTickClient()');
    });

    it('SPEC-ARCHI-034 : world.tick avec cultures:false ne fait rien pousser ; sinon chaque stade est signalé à surBloc (le serveur le diffuse)', function () {
      var C = MC.Core, B = C.B;
      function monde() {
        var w = MC.createWorld(20260921);
        var col = w.findSpawnColumn();
        w.getChunk(Math.floor(col[0] / 16), Math.floor(col[1] / 16), true);
        var x = col[0], z = col[1], y = w.groundAt(x, z, true);
        w.setBlock(x, y, z, B.FARMLAND);
        w.setBlock(x, y + 1, z, B.WHEAT0);
        return { w: w, x: x, y: y + 1, z: z };
      }
      var m = monde();
      var vus = [];
      for (var i = 0; i < 6; i++) m.w.tick(20, 14, function () { return 0; }, { temps: 2 * 1200 + 100, cultures: false, eau: false, circuits: false, feu: false, surBloc: function () { vus.push(1); } });
      A.equal(m.w.getBlock(m.x, m.y, m.z), B.WHEAT0, 'cultures:false — le blé ne pousse pas côté client');
      A.equal(vus.length, 0, 'et rien n\'est signalé');
      var n = monde();
      var stades = [];
      for (var k = 0; k < 6; k++) n.w.tick(20, 14, function () { return 0; }, { temps: 2 * 1200 + 100, eau: false, circuits: false, feu: false,
        surBloc: function (x, y, z, id) { stades.push([x, y, z, id]); } });
      A.equal(n.w.getBlock(n.x, n.y, n.z), B.WHEAT3, 'côté serveur (cultures actives) le blé est mûr');
      A.deep(stades.map(function (s) { return s[3]; }), [B.WHEAT1, B.WHEAT2, B.WHEAT3], 'surBloc reçoit chaque stade, dans l\'ordre');
      A.deep(stades[0].slice(0, 3), [n.x, n.y, n.z], 'à la bonne position');
    });

    /* Audit final du chantier (SPEC-ARCHI-001, second volet ; le premier — le
       point d'entrée par défaut ouvre un serveur qui sert index.html et
       répond BIENVENUE — est prouvé par tests/integration-archi-serveur.js) :
       plus aucune simulation du monde dans game.js, tous lots confondus. */
    it('SPEC-ARCHI-001 : audit statique — game.js ne contient plus aucune simulation du monde (eau, circuits, feu, cultures, créatures, apparitions, politique)', function () {
      [
        'entities.update(', 'entities.damage(', 'entities.tirer(', 'invoquerGardien', 'trySpawn', 'peuplerLieux',
        '.coulerEau(', '.coulerFeu(', 'tickCircuits(', 'Circuits.tick(', 'ejecterDistributeur',
        '.updateSurvival(', '.subirClimat(', 'avancerJourApresDormir', 'Politique.tourDuMonde', 'Politique.decouvrir',
      ].forEach(function (interdit) {
        A.equal(CODE.indexOf(interdit), -1, 'game.js n\'appelle plus « ' + interdit + ' »');
      });
      // le seul tic du monde côté client coupe tout ce que simule le serveur
      var appels = CODE.match(/world\.tick\(/g) || [];
      A.ok(appels.length > 0, 'le client garde un tic du monde (neige et glace saisonnières, déterministes par l\'heure)');
      A.equal((CODE.match(/world\.tick\(dt, 14, null, optionsTickClient\(\)\)/g) || []).length, appels.length,
        'chaque world.tick du client passe par optionsTickClient()');
      var opts = corps('optionsTickClient');
      ['eau: false', 'circuits: false', 'feu: false', 'cultures: false'].forEach(function (o) {
        A.ok(opts.indexOf(o) >= 0, 'optionsTickClient() coupe « ' + o + ' »');
      });
      A.equal(opts.indexOf('surBloc'), -1, 'le client ne diffuse aucun bloc changé par son tic');
      // la boucle d'images, découpée par thème : aucune ne décide sur net.enLigne(), aucune ne modifie le monde
      ['frameJoueurs', 'frameEntites', 'frameTemps', 'frameMonde', 'frameConteneurs', 'frameFinDePartie', 'frameMondeInterface', 'frameReseau'].forEach(function (nom) {
        var c = corps(nom).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        A.equal(c.indexOf('net.enLigne()'), -1, nom + ' ne décide pas sur net.enLigne()');
        ['setBlock', 'setEtat', 'entities.spawn', 'entities.dropItem', '.hurt('].forEach(function (interdit) {
          A.equal(c.indexOf(interdit), -1, nom + ' ne contient pas « ' + interdit + ' »');
        });
      });
      // météo, volcans et caravanes : purement visuels (aucun bloc, aucune entité, aucun dégât)
      ['majMeteo', 'volcans', 'convois'].forEach(function (nom) {
        var c = corps(nom);
        ['setBlock', 'entities.', '.hurt('].forEach(function (interdit) {
          A.equal(c.indexOf(interdit), -1, nom + ' ne contient pas « ' + interdit + ' »');
        });
      });
    });

    it('SPEC-ARCHI-035 : le README ne dit plus que l\'inventaire, la fabrication, les fourneaux et les cultures restent côté client', function () {
      var readme = fs.readFileSync(path.join(RACINE, 'README.md'), 'utf8');
      A.ok(!/restent côté client/.test(readme), 'la phrase obsolète n\'existe plus');
      A.ok(!/gardiens de donjon ne s'éveillent qu'en solo/.test(readme), 'ni celle sur les gardiens de donjon absents en ligne');
    });

  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
