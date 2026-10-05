/* spec-l40-reseau.js — partie Node du sous-lot L40-bis C « serveur et réseau »
   (SPEC-SAVE-023, 024). Le comportement du serveur lui-même (refus d'un id
   non-bloc, état borné, format d'identifiants à la connexion) est prouvé sur
   un vrai serveur par tests/integration-blocs16.js ; ici :
     - la règle de bornage du serveur (`MC.Core.etatMaxDe`, SPEC-SAVE-021) ;
     - l'application d'un bloc reçu du serveur, état 0 compris
       (`MC.Synchro.appliquerBloc`) ;
     - l'audit de src/game.js : plus aucun chemin qui ignore un état 0.
   Fichier Node-only (comme spec-jouabilite.js) : `require` et `__dirname`
   sont exposés par tests/run.js. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var fs = require('fs'), path = require('path');
  var RACINE = path.join(__dirname, '..');
  var C = MC.Core, B = C.B;

  function mondeCharge(graine) {
    var w = MC.createWorld(graine);
    w.getChunk(0, 0, true);
    return w;
  }

  describe('Specs — L40-bis C : état borné et état 0 appliqué (SPEC-SAVE-023, 024)', function () {

    it('SPEC-SAVE-023 : le serveur borne l\'état reçu par MC.Core.etatMaxDe (SPEC-SAVE-021), seulement à la pose d\'un client', function () {
      var srv = require('./source-serveur.js').sourceServeur(RACINE);   // server.js et ses modules (SPEC-SERVEUR-008)
      var REGLE = 'if (m.etat > C.etatMaxDe(m.id)) m.etat = 0;';
      var iRegle = srv.indexOf(REGLE), iCas = srv.indexOf('case NP.MSG.BLOC: {');
      A.ok(iCas >= 0 && iRegle > iCas, 'la règle de bornage est dans le traitement de BLOC');
      A.ok(iRegle < srv.indexOf('blocAutorise(js, m, avant, c)', iCas), '… avant toute pose');
      A.equal(srv.split('etatMaxDe(').length - 1, 1, 'une seule lecture de la borne côté serveur : aucun filtre des états au chargement du monde');
      ['world.js', 'save.js'].forEach(function (f) {
        A.ok(fs.readFileSync(path.join(RACINE, 'src', f), 'utf8').indexOf('etatMax') < 0,
             f + ' ne borne pas les états qu\'il relit (un id inconnu garde son état, SPEC-SAVE-028)');
      });
      A.ok(fs.readFileSync(path.join(RACINE, 'src', 'core.js'), 'utf8').indexOf('SPEC-SAVE-023 : borne') < 0, 'aucune borne provisoire en double dans core.js');
      // la règle elle-même, sur les bornes déclarées par SPEC-SAVE-021
      function borne(id, etat) { return etat > C.etatMaxDe(id) ? 0 : etat; }
      var maxEsc = C.etatMaxDe(B.ESCALIER_STONE);
      A.equal(borne(B.ESCALIER_STONE, maxEsc), maxEsc, 'escalier : la borne elle-même est conservée');
      A.equal(borne(B.ESCALIER_STONE, maxEsc + 1), 0, 'escalier : au-delà → 0');
      A.equal(borne(B.STONE, 200), 0, 'pierre (sans état) : 200 → 0');
      A.equal(borne(B.BATTERIE, 255), 255, 'batterie : 255 (sa capacité, SPEC-MECA-003) conservé');
      A.equal(borne(B.LEVIER_CIRCUIT, 2), 0, 'levier : 2 → 0');
      A.equal(borne(0, 5), 0, 'casse (air) : état 0');
    });

    it('SPEC-SAVE-024 : appliquerBloc applique l\'état 0 reçu du serveur (batterie vidée)', function () {
      var w = mondeCharge(4040);
      var x = 3, y = C.WORLD_H - 8, z = 4;
      w.setBlock(x, y, z, B.BATTERIE);
      w.setEtat(x, y, z, 9);
      A.equal(w.getEtat(x, y, z), 9, 'précondition : batterie chargée à 9');
      MC.Synchro.appliquerBloc(w, { x: x, y: y, z: z, id: B.BATTERIE, etat: 0 });
      A.equal(w.getBlock(x, y, z), B.BATTERIE, 'même bloc');
      A.equal(w.getEtat(x, y, z), 0, 'l\'état 0 est appliqué');
      MC.Synchro.appliquerBloc(w, { x: x, y: y, z: z, id: B.BATTERIE, etat: 12 });
      A.equal(w.getEtat(x, y, z), 12, 'un état non nul aussi');
      // forme tableau des overrides ([x, y, z, id, etat]) : même application
      MC.Synchro.appliquerBloc(w, [x, y, z, B.BATTERIE, 0]);
      A.equal(w.getEtat(x, y, z), 0, 'override [x,y,z,id,0] appliqué');
      // un bloc reçu sans état (rappel d'un refus) ne touche pas l'état en place
      w.setEtat(x, y, z, 5);
      MC.Synchro.appliquerBloc(w, { x: x, y: y, z: z, id: B.BATTERIE });
      A.equal(w.getEtat(x, y, z), 5, 'aucun état annoncé : l\'état en place reste');
      // chunk absent : généré pour y appliquer le bloc
      MC.Synchro.appliquerBloc(w, { x: 40, y: y, z: 40, id: B.STONE, etat: 0 });
      A.equal(w.getBlock(40, y, 40), B.STONE, 'le chunk absent est généré et reçoit le bloc');
    });

    it('SPEC-SAVE-027 : des overrides d\'état 0 (multijoueur) ne font allouer aucun tampon d\'états — l\'instantané reste sans état', function () {
      var cx = 2, cz = -1, CX = C.CHUNK_X, CZ = C.CHUNK_Z;
      var w = MC.createWorld(555);
      for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) w.getChunk(cx + dx, cz + dz, true);
      function partages() {
        var n = 0;
        for (var dz2 = -1; dz2 <= 1; dz2++) for (var dx2 = -1; dx2 <= 1; dx2++) if (w.etatsPartagesVides(w.chunkDe(cx + dx2, cz + dz2).etats)) n++;
        return n;
      }
      A.equal(partages(), 9, 'précondition : les 9 chunks partagent le tampon vide');
      var y = C.WORLD_H - 6, k = 0;
      for (var dz3 = -1; dz3 <= 1; dz3++) for (var dx3 = -1; dx3 <= 1; dx3++) {
        // un override par chunk, tel que BIENVENUE / OVERRIDES / BLOC les apporte : [x, y, z, id, 0]
        MC.Synchro.appliquerBloc(w, [(cx + dx3) * CX + 3, y, (cz + dz3) * CZ + 4, B.STONE, 0]);
        MC.Synchro.appliquerBloc(w, { x: (cx + dx3) * CX + 5, y: y, z: (cz + dz3) * CZ + 6, id: B.STONE, etat: 0 });
        k++;
      }
      A.equal(partages(), 9, 'après ' + k + ' overrides d\'état 0 : aucun tampon de 32 Kio alloué');
      // world.setEtat(…, 0) lui-même n'alloue pas sur le tampon partagé
      A.ok(w.setEtat(cx * CX + 1, y, cz * CZ + 1, 0), 'setEtat(0) accepté');
      A.ok(w.etatsPartagesVides(w.chunkDe(cx, cz).etats), 'setEtat(0) sur le tampon partagé : rien n\'est alloué');
      A.equal(w.getEtat(cx * CX + 1, y, cz * CZ + 1), 0);
      var v = MC.TachesChunks.instantaneVoisins(w, cx, cz);
      A.ok(v.every(function (x) { return x.etats === null; }), 'instantané : les 9 etats valent null');
      A.equal(v[4].blocks[C.idx(3, y, 4)], B.STONE, 'instantané : les blocs des overrides y sont');
      // un état non nul alloue toujours, et un retour à 0 se lit bien
      w.setEtat(cx * CX + 1, y, cz * CZ + 1, 7);
      A.ok(!w.etatsPartagesVides(w.chunkDe(cx, cz).etats), 'un état non nul alloue le tampon propre');
      A.equal(w.getEtat(cx * CX + 1, y, cz * CZ + 1), 7);
      MC.Synchro.appliquerBloc(w, { x: cx * CX + 1, y: y, z: cz * CZ + 1, id: w.getBlock(cx * CX + 1, y, cz * CZ + 1), etat: 0 });
      A.equal(w.getEtat(cx * CX + 1, y, cz * CZ + 1), 0, 'puis l\'état 0 reçu s\'applique');
    });

    it('SPEC-SAVE-024 : audit — src/game.js n\'ignore plus aucun état 0 et passe par MC.Synchro.appliquerBloc', function () {
      var src = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
      A.ok(src.indexOf('if (etat) world.setEtat') < 0, 'plus de « if (etat) world.setEtat »');
      A.ok(src.indexOf('if (b[4]) world.setEtat') < 0, 'plus de « if (b[4]) world.setEtat »');
      var n = (src.match(/MC\.Synchro\.appliquerBloc\(/g) || []).length;
      A.ok(n >= 3, 'BLOC, BIENVENUE et OVERRIDES passent par appliquerBloc (' + n + ' appels)');
      var net = fs.readFileSync(path.join(RACINE, 'src', 'net.js'), 'utf8');
      A.ok(net.indexOf('m.etat || 0') < 0, 'net.js transmet l\'état tel quel (absent ≠ 0)');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
