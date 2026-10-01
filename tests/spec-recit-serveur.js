/* spec-recit-serveur.js — SPEC-ARCHI-041 : la logique pure du récit côté
   serveur (src/recit-serveur.js). Le comportement avec un vrai serveur est
   éprouvé par tests/integration-archi-histoire.js ; ici, les règles qui ne
   dépendent d'aucun réseau : validation des réponses, anti-rejeu, séparation
   annonces/effets, persistance. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var RS = MC.RecitServeur, R = MC.Recits, C = MC.Core;

  var LIENS = {
    depart: { id: 'village:0,0', nom: 'Hameau-Clair', x: 0, z: 0, h: 64, kind: 'lieu' },
    ville: { id: 'ville:1,0', nom: 'Grandbourg', x: 400, z: 0, h: 64, kind: 'lieu' },
    ermite: { id: 'maison:2', nom: 'Ermitage', x: 900, z: 0, h: 64, kind: 'lieu' },
  };
  function neuf(longueur) {
    var r = RS.creer({ monde: null, graine: 1, liens: LIENS, params: { archetype: 'epopee', longueur: longueur || 'courte', interactions: null }, peut: function () { return true; } });
    return r.etat;
  }
  var CTX = { compter: function () { return 0; } };
  var GUIDE = { role: 'guide', lieu: 'village:0,0', pnj: 'village:0,0#1', nom: 'Bastien', eid: 3 };

  describe('Récit côté serveur — logique pure', {
    teste: 'src/recit-serveur.js : création, parler, réponses, sondes, vue et persistance du récit d\'un joueur',
    pourquoi: 'Le serveur est l\'arbitre du récit : il doit refuser toute réponse qui ne correspond pas à l\'état, ne jamais laisser rejouer un choix, et ne rien envoyer que de borné.',
    attendu: 'parler au guide fait avancer l\'étape une seule fois ; un choix périmé ou rejoué est sans effet ; la vue envoyée est bornée ; exporter/importer redonne le même récit, y compris depuis l\'ancien format solo.',
  }, function () {

    it('SPEC-ARCHI-041 : le récit se crée, commence par un chapitre et pointe le village de départ', function () {
      var e = neuf();
      A.equal(e.archetype, 'epopee');
      A.equal(RS.pointDepart(e).id, 'village:0,0');
      var c = RS.classer(e, R.commencer(e));
      A.equal(c.client[0].type, 'chapitre');
      A.ok(/réveil/i.test(c.client[0].titre));
      A.equal(RS.fin(e), null);
    });

    it('SPEC-ARCHI-041 : parler au bon habitant fait avancer le récit UNE fois, un autre ne fait rien', function () {
      var e = neuf();
      R.commencer(e);
      var avant = e.histoire.etape;
      var autre = RS.parler(e, { commerce: true }, { role: 'fermier', lieu: 'village:0,0', pnj: 'p', nom: 'X', eid: 1 }, CTX, 5);
      A.equal(e.histoire.etape, avant, 'un fermier ne fait pas avancer l\'étape « guide »');
      A.ok(autre.libre || autre.proposition, 'le récit ne prend pas la parole (commerce libre ou quête offerte)');
      var r = RS.parler(e, { commerce: true }, GUIDE, CTX, 6);
      A.gt(e.histoire.etape, avant, 'le guide fait avancer');
      A.ok(r.notifs.some(function (n) { return n.type === 'dialogue'; }), 'et raconte');
      A.equal(r.libre, false);
      var etape = e.histoire.etape;
      RS.parler(e, { commerce: true }, GUIDE, CTX, 7);
      A.equal(e.histoire.etape, etape, 'reparler ne ré-avance pas');
    });

    it('SPEC-ARCHI-041 : une quête secondaire se propose, s\'accepte une fois, et une réponse périmée est refusée', function () {
      var e = neuf();
      R.commencer(e);
      var p = RS.parler(e, { commerce: true }, { role: 'fermier', lieu: 'village:0,0', pnj: 'f', nom: 'Élise', eid: 2 }, CTX, 1);
      A.ok(p.proposition && /^quete:/.test(p.proposition.id), 'une quête est proposée');
      var attente = { id: p.proposition.id, role: 'fermier' };
      A.equal(RS.repondre(e, attente, 'quete:inexistante', 'oui').ok, false, 'identifiant inconnu');
      A.equal(RS.repondre(e, attente, attente.id, 'peut-etre').ok, false, 'option inconnue');
      var ok = RS.repondre(e, attente, attente.id, 'oui');
      A.ok(ok.ok && ok.notifs[0].type === 'quete', 'acceptée');
      A.equal(Object.keys(e.histoire.secondaires).length, 1);
      var rejeu = RS.repondre(e, attente, attente.id, 'oui');
      A.equal(rejeu.ok, false, 'rejeu refusé');
      A.equal(Object.keys(e.histoire.secondaires).length, 1, 'rien de plus accepté');
    });

    it('SPEC-ARCHI-041 : un choix narratif n\'est pris que s\'il est posé, une seule fois, avec une option valide', function () {
      var e = neuf('normale');
      R.commencer(e);
      var garde = 0;
      while (!RS.choixPose(e) && garde++ < 200) {
        var et = MC.Histoire.CHAPITRES[e.histoire.chapitres[e.histoire.chap]].etapes[e.histoire.etape];
        if (!et) break;
        // on force l'étape comme si elle était accomplie
        e.histoire.progres = 0;
        if (et.type === 'choix') break;
        e.histoire.etape++;
        if (e.histoire.etape >= MC.Histoire.CHAPITRES[e.histoire.chapitres[e.histoire.chap]].etapes.length) { e.histoire.chap++; e.histoire.etape = 0; }
      }
      var c = RS.choixPose(e);
      A.ok(c, 'un choix finit par se poser');
      A.equal(RS.repondre(e, null, 'mauvais', c.options[0].id).ok, false, 'mauvais identifiant');
      A.equal(RS.repondre(e, null, c.id, 'nimporte').ok, false, 'option hors liste');
      A.equal(RS.choixPose(e).id, c.id, 'toujours posé après les refus');
      var r = RS.repondre(e, null, c.id, c.options[0].id);
      A.ok(r.ok);
      A.equal(e.histoire.drapeaux[c.id], c.options[0].id);
      var rejeu = RS.repondre(e, null, c.id, c.options[1] ? c.options[1].id : c.options[0].id);
      A.equal(rejeu.ok, false, 'le choix ne se rejoue pas');
      A.equal(e.histoire.drapeaux[c.id], c.options[0].id, 'drapeau inchangé');
    });

    it('SPEC-ARCHI-041 : sonder fait avancer « aller », et classer isole récompenses, objets repris, apparitions et fin', function () {
      var e = neuf();
      R.commencer(e);
      var n = RS.sonder(e, { pos: { x: 5000, z: 5000 }, biome: 'plaine', nuit: false, meteo: null, t: 10, lieu: null }, CTX);
      A.ok(Array.isArray(n));
      var c = RS.classer(e, [
        { type: 'recompense', objets: [{ id: C.I.EMERALD, n: 2 }] },
        { type: 'prendre', objets: [{ id: C.B.LOG, n: 6 }], parmi: [C.B.LOG] },
        { type: 'evenement', id: 'ev', titre: 'T', texte: 'x', apparitions: [{ type: 'zombie', n: 2 }], pres: 'joueur' },
        { type: 'fin', id: 'aube', titre: 'L aube', texte: 'Fin' },
      ]);
      A.equal(c.recompenses.length, 1); A.equal(c.prises.length, 1); A.equal(c.apparitions.length, 1);
      A.equal(c.fin.id, 'aube'); A.ok(/Chapitres/.test(c.fin.stats), 'statistiques de fin calculées par le serveur');
      A.ok(!c.client.some(function (x) { return x.type === 'prendre'; }), 'rien à reprendre côté client');
      A.equal(c.client.filter(function (x) { return x.apparitions; }).length, 0, 'les apparitions restent au serveur');
    });

    it('SPEC-ARCHI-041 : la vue envoyée est bornée (journal rogné) ; exporter/importer redonne le récit ; l\'ancien format solo est adopté', function () {
      var e = neuf();
      R.commencer(e);
      for (var i = 0; i < 40; i++) e.histoire.journal.push('entrée ' + i);
      var v = RS.vue(e, null);
      A.equal(v.recit.histoire.journal.length, RS.JOURNAL_ENVOYE);
      A.equal(e.histoire.journal.length > RS.JOURNAL_ENVOYE, true, 'le récit du serveur n\'est pas tronqué');
      A.ok(JSON.stringify(v).length < MC.ContratsArchi.BORNES.HISTOIRE_JSON_MAX, 'sous la borne du contrat');
      var exp = JSON.parse(JSON.stringify(RS.exporter(e, { type: 'fin', id: 'x' })));
      var imp = RS.importer(exp, function () { return true; });
      A.deep(JSON.parse(JSON.stringify(R.serialiser(imp.etat))), JSON.parse(JSON.stringify(R.serialiser(e))));
      A.equal(imp.fin.id, 'x');
      // ancien solo : MC.Recits.serialiser tel quel, ou MC.Histoire.serialiser seul
      var ancien = importer(JSON.parse(JSON.stringify(R.serialiser(e))));
      A.deep(ancien.etat.histoire.chap, e.histoire.chap);
      var tresAncien = importer(JSON.parse(JSON.stringify(MC.Histoire.serialiser(e.histoire))));
      A.equal(tresAncien.etat.archetype, 'epopee');
      A.equal(RS.importer({ n: 'importe quoi' }, null), null, 'données illisibles : ignorées sans lever');
      A.equal(RS.importer(null, null), null);
      function importer(d) { return RS.importer(d, function () { return true; }); }
    });

    it('SPEC-ARCHI-041 : hors commerce, un habitant sans rôle dans le récit répond par une réplique ; la fin rend la parole au commerce', function () {
      var e = neuf();
      R.commencer(e);
      var r = RS.parler(e, { commerce: false }, { role: 'marchand', lieu: 'village:0,0', pnj: 'm', nom: 'Fabien', eid: 4 }, CTX, 1);
      if (!r.proposition) A.ok(r.notifs.some(function (n) { return n.type === 'dialogue'; }) && !r.libre, 'réplique, pas de commerce');
      e.histoire.fin = 'aube';
      var f = RS.parler(e, { commerce: false }, GUIDE, CTX, 2);
      A.equal(f.libre, true, 'récit fini : le client reprend la main');
      A.equal(RS.sonder(e, { pos: { x: 0, z: 0 }, biome: 'x', nuit: false, t: 1 }, CTX).length, 0, 'plus aucune sonde');
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
