/* spec-guildes.js — SPEC-FACTION-009 à 013 : factions de joueurs. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var GU = MC.Guildes;

  describe('Specs — guildes (factions de joueurs)', { teste: 'Les guildes (factions de joueurs) : création, rangs, candidatures, diplomatie.', pourquoi: 'Couvre les specs SPEC-FACTION-* de ce fichier.', attendu: 'chaque comportement de guilde suit sa spec, vérifiée test par test.' }, function () {
    it('SPEC-FACTION-009 : création (nom unique, couleur, emblème, devise), chef, rangs, nominations, promotion, rétrogradation, exclusion, transmission, dissolution', function () {
      var e = GU.creerEtat();
      var r1 = GU.creerFaction(e, 'Alice', { nom: 'Les Loups', couleur: '#ff0000', emblem: 'loup', devise: 'Toujours en meute' });
      A.ok(r1.ok);
      var f = r1.id;
      A.equal(GU.rangDe(e, f, 'Alice'), 'chef');
      // nom déjà pris (insensible à la casse)
      var r2 = GU.creerFaction(e, 'Bob', { nom: 'les loups' });
      A.notOk(r2.ok); A.equal(r2.motif, 'nom_pris');

      GU.postuler(e, 'Carla', f);
      A.ok(GU.accepter(e, 'Alice', f, 'Carla').ok);
      A.equal(GU.rangDe(e, f, 'Carla'), 'recrue');
      A.ok(GU.promouvoir(e, 'Alice', f, 'Carla').ok);
      A.equal(GU.rangDe(e, f, 'Carla'), 'membre');
      A.ok(GU.promouvoir(e, 'Alice', f, 'Carla').ok);
      A.equal(GU.rangDe(e, f, 'Carla'), 'officier');
      // un officier ne peut pas gérer un autre officier ni le chef
      GU.postuler(e, 'Dan', f); GU.accepter(e, 'Alice', f, 'Dan');
      A.notOk(GU.nommerRang(e, 'Carla', f, 'Alice', 'membre').ok, 'un officier ne rétrograde pas le chef');
      A.ok(GU.retrograder(e, 'Alice', f, 'Carla').ok);
      A.equal(GU.rangDe(e, f, 'Carla'), 'membre');

      GU.exclure(e, 'Alice', f, 'Dan');
      A.notOk(GU.estMembre(e, 'Dan', f));
      A.ok(GU.transmettre(e, 'Alice', f, 'Carla').ok);
      A.equal(GU.rangDe(e, f, 'Carla'), 'chef');
      A.equal(GU.rangDe(e, f, 'Alice'), 'officier');

      // une faction sans membre disparaît
      GU.quitter(e, 'Alice', f);
      var r3 = GU.quitter(e, 'Carla', f);
      A.ok(r3.dissoute);
      A.notOk(e.factions.has(f));
      A.ok(GU.dissoudre(e, f).ok === false, 'déjà disparue');
    });

    it('SPEC-FACTION-010 : candidature, acceptation/refus, invitation, départ', function () {
      var e = GU.creerEtat();
      var f = GU.creerFaction(e, 'Alice', { nom: 'Aigles' }).id;
      A.ok(GU.postuler(e, 'Bob', f).ok);
      A.ok(GU.refuser(e, 'Alice', f, 'Bob').ok);
      A.notOk(GU.estMembre(e, 'Bob', f));
      // invitation directe
      A.ok(GU.inviter(e, 'Alice', f, 'Eve').ok);
      A.ok(GU.accepterInvitation(e, 'Eve', f).ok);
      A.ok(GU.estMembre(e, 'Eve', f));
      // candidature puis acceptation
      GU.postuler(e, 'Bob', f);
      A.ok(GU.accepter(e, 'Alice', f, 'Bob').ok);
      A.ok(GU.estMembre(e, 'Bob', f));
      // départ volontaire
      A.ok(GU.quitter(e, 'Bob', f).ok);
      A.notOk(GU.estMembre(e, 'Bob', f));
    });

    it('SPEC-FACTION-011 : au plus une faction principale, zéro/une/plusieurs secondaires, changement de principale', function () {
      var e = GU.creerEtat();
      var f1 = GU.creerFaction(e, 'Alice', { nom: 'Nord' }).id;
      var f2 = GU.creerFaction(e, 'Zoe', { nom: 'Sud' }).id;
      GU.inviter(e, 'Zoe', f2, 'Alice'); GU.accepterInvitation(e, 'Alice', f2);
      var fs = GU.factionsDe(e, 'Alice');
      A.equal(fs.principale, f1, 'la première reste principale');
      A.deep(fs.secondaires, [f2]);
      A.ok(GU.definirPrincipale(e, 'Alice', f2).ok);
      var fs2 = GU.factionsDe(e, 'Alice');
      A.equal(fs2.principale, f2);
      A.deep(fs2.secondaires, [f1]);
      A.notOk(GU.definirPrincipale(e, 'Alice', 'ginconnue').ok, 'pas membre de cette faction');
    });

    it('SPEC-FACTION-012 : canal (membres visibles), carte, diplomatie (alliée/neutre/ennemie), pas de dégâts entre membres', function () {
      var e = GU.creerEtat();
      var f1 = GU.creerFaction(e, 'Alice', { nom: 'Nord2' }).id;
      GU.postuler(e, 'Bob', f1); GU.accepter(e, 'Alice', f1, 'Bob');
      var f2 = GU.creerFaction(e, 'Carla', { nom: 'Sud2' }).id;
      A.deep(GU.membresDe(e, f1).sort(), ['Alice', 'Bob']);
      A.equal(GU.relationEnvers(e, f1, f2), 'neutre');
      A.ok(GU.declarerRelation(e, 'Alice', f1, f2, 'ennemie').ok);
      A.equal(GU.relationEnvers(e, f1, f2), 'ennemie');
      A.notOk(GU.declarerRelation(e, 'Bob', f1, f2, 'alliee').ok, 'une recrue ne déclare pas la diplomatie');
      // aussi envers une faction PNJ (MC.Politique) réellement connue (SPEC-FACTION-017)
      var ep = MC.Politique.creer(1);
      MC.Politique.decouvrir(ep, [{ id: 'ville:0,0', kind: 'ville', x: 100, z: 100, nom: 'Beaulac' }]);
      var pnjId = Array.from(ep.factions.keys())[0];
      A.ok(GU.declarerRelation(e, 'Alice', f1, pnjId, 'alliee', ep).ok);
      // pas de dégâts entre membres d'une même faction
      A.notOk(GU.peutBlesser(e, 'Alice', 'Bob'), 'même faction, jamais de dégâts');
      A.ok(GU.peutBlesser(e, 'Alice', 'Carla'), 'factions différentes : les dégâts restent possibles même en cas de diplomatie ennemie');
      A.notOk(GU.peutBlesser(e, 'Alice', 'Alice'), 'jamais se blesser soi-même via cette porte');
    });

    it('SPEC-FACTION-017 : declarerRelation vérifie la faction PNJ cible (politique.js) et applique la relation réciproque côté PNJ', function () {
      var e = GU.creerEtat();
      var f1 = GU.creerFaction(e, 'Alice', { nom: 'Nord3' }).id;
      var ep = MC.Politique.creer(1);
      MC.Politique.decouvrir(ep, [{ id: 'ville:0,0', kind: 'ville', x: 100, z: 100, nom: 'Beaulac' }]);
      var pnjId = Array.from(ep.factions.keys())[0];

      // refusée si la cible ne correspond à aucune faction PNJ connue (ni à une faction de joueurs)
      var refus = GU.declarerRelation(e, 'Alice', f1, 'royaume:inconnu', 'alliee', ep);
      A.notOk(refus.ok, 'aucune faction PNJ ne porte cet identifiant');
      A.equal(refus.motif, 'cible_introuvable');
      A.equal(GU.relationEnvers(e, f1, 'royaume:inconnu'), 'neutre', 'rien n\'a été enregistré');
      // refusée aussi sans état politique fourni, même avec un identifiant PNJ valide par ailleurs
      A.notOk(GU.declarerRelation(e, 'Alice', f1, pnjId, 'alliee').ok, 'sans etatPolitique, la cible PNJ ne peut pas être vérifiée');

      // acceptée envers une faction PNJ réellement connue : mise à jour symétrique
      A.ok(GU.declarerRelation(e, 'Alice', f1, pnjId, 'ennemie', ep).ok);
      A.equal(GU.relationEnvers(e, f1, pnjId), 'ennemie', 'côté faction de joueurs');
      A.equal(MC.Politique.relationEntre(ep, pnjId, f1), 'guerre', 'perçue comme une guerre côté PNJ');

      A.ok(GU.declarerRelation(e, 'Alice', f1, pnjId, 'alliee', ep).ok);
      A.equal(MC.Politique.relationEntre(ep, pnjId, f1), 'alliance', 'la mise à jour réciproque suit un nouveau changement');

      // la relation réciproque posée côté PNJ (clé impliquant f1, un id de faction
      // de joueurs) ne doit pas dériver spontanément au fil des jours simulés, ni
      // apparaître dans les annonces sous forme d'identifiant brut : tourUnJour
      // ne doit balayer/dériver/annoncer que les relations PNJ↔PNJ.
      A.ok(GU.declarerRelation(e, 'Alice', f1, pnjId, 'ennemie', ep).ok);
      var avant = MC.Politique.relationEntre(ep, pnjId, f1);
      MC.Politique.tourDuMonde(ep, ep.jour + 250);
      A.equal(MC.Politique.relationEntre(ep, pnjId, f1), avant,
        'une relation déclarée par un joueur envers une faction PNJ reste stable, sans dérive de politique.js');
      var annoncePolluee = ep.annonces.some(function (a) { return a.texte.indexOf(f1) >= 0; });
      A.notOk(annoncePolluee, 'aucune annonce ne doit référencer l\'id brut d\'une faction de joueurs');
    });

    it('SPEC-FACTION-013 : persistance serveur (aller-retour) et modération admin (renommer/dissoudre)', function () {
      var e = GU.creerEtat();
      var f1 = GU.creerFaction(e, 'Alice', { nom: 'Aube', couleur: '#123456', devise: 'Vers la lumière' }).id;
      GU.postuler(e, 'Bob', f1); GU.accepter(e, 'Alice', f1, 'Bob');
      var fCible = GU.creerFaction(e, 'Zoe', { nom: 'Cible' }).id;
      GU.declarerRelation(e, 'Alice', f1, fCible, 'alliee');
      var data = GU.serialiser(e);
      var e2 = GU.charger(JSON.parse(JSON.stringify(data)));
      A.deep(GU.membresDe(e2, f1).sort(), GU.membresDe(e, f1).sort());
      A.equal(GU.relationEnvers(e2, f1, fCible), 'alliee');
      A.deep(GU.factionsDe(e2, 'Bob'), GU.factionsDe(e, 'Bob'));

      // modération : renommer et dissoudre (le contrôle du rôle est fait en
      // amont par MC.Admin.peutAgir, comme pour toute autre action admin)
      A.ok(MC.Admin.peutAgir(MC.Admin.ROLES.MODERATEUR, 'faction_gerer'));
      A.ok(GU.renommerParAdmin(e2, f1, 'Aube nouvelle').ok);
      A.equal(e2.factions.get(f1).nom, 'Aube nouvelle');
      A.notOk(GU.renommerParAdmin(e2, f1, '').ok);
      A.ok(GU.dissoudreParAdmin(e2, f1).ok);
      A.notOk(e2.factions.has(f1));
    });

    it('SPEC-FACTION-010 : les commandes /faction s appliquent par nom de faction et répondent en clair', function () {
      var G2 = MC.Guildes, e = G2.creerEtat();
      function cmd(qui, texte) {
        var r = MC.Commandes.executer({ nom: 'faction', args: texte.split(' ') }, {});
        A.equal(r.actions[0].brut, texte, 'la commande d origine accompagne l action');
        return G2.appliquerAction(e, qui, r.actions[0]);
      }
      A.ok(/fondée/.test(cmd('Alice', 'creer Loups').message));
      A.ok(/déjà pris/.test(cmd('Carl', 'creer loups').message), 'nom unique, sans égard à la casse');
      A.ok(cmd('Bob', 'postuler Loups').ok);
      A.equal(cmd('Carl', 'accepter Loups Bob').ok, false, 'un non-membre ne décide pas');
      A.ok(/Bob rejoint/.test(cmd('Alice', 'accepter Loups Bob').message));
      var dire = cmd('Bob', 'dire salut');
      A.ok(dire.canal && dire.canal.membres.indexOf('Alice') >= 0 && dire.message.indexOf('[Loups] Bob : salut') === 0);
      A.ok(cmd('Bob', 'info').message.indexOf('Principale : Loups (recrue)') === 0);
      A.ok(/Vous quittez/.test(cmd('Bob', 'quitter Loups').message));
      A.ok(/aucune faction/.test(cmd('Bob', 'info').message));
      A.ok(/introuvable/.test(cmd('Bob', 'postuler Ours').message));
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
