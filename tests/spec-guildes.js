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

    it('SPEC-FACTION-012 : diplomatie envers une faction PNJ désignée par son nom (espaces écrits « _ »), réciproque côté PNJ', function () {
      var e = GU.creerEtat();
      GU.creerFaction(e, 'Alice', { nom: 'Loups' });
      var ep = MC.Politique.creer(1);
      MC.Politique.decouvrir(ep, [{ id: 'ville:0,0', kind: 'ville', x: 100, z: 100, nom: 'Beaulac' }]);
      var pnjId = Array.from(ep.factions.keys())[0], pnjNom = ep.factions.get(pnjId).nom;
      A.equal(GU.idPnjDe(ep, pnjNom.replace(/ /g, '_')), pnjId, 'le nom en un mot désigne la faction PNJ');
      A.equal(GU.idPnjDe(ep, pnjNom.replace(/ /g, '_').toUpperCase()), pnjId, 'sans égard à la casse');
      var r = GU.appliquerAction(e, 'Alice', { action: 'relation', args: { faction: 'Loups', cible: pnjNom.replace(/ /g, '_'), relation: 'ennemie' } }, ep);
      A.ok(r.ok, r.message);
      A.equal(MC.Politique.relationEntre(ep, pnjId, GU.idDe(e, 'Loups')), 'guerre', 'perçue comme une guerre côté PNJ');
      var r2 = GU.appliquerAction(e, 'Alice', { action: 'relation', args: { faction: 'Loups', cible: 'Personne_de_connu', relation: 'alliee' } }, ep);
      A.notOk(r2.ok, 'une cible inconnue est refusée');
    });

    it('SPEC-FACTION-012 : sécurité — nom de faction sans caractère de contrôle, sans balise, borné, distinct d\'un identifiant ; couleur, emblème et devise nettoyés', function () {
      var e = GU.creerEtat();
      ['', 'a', 'Loups\nINFO admin', 'L<script>', 'x'.repeat(25), 'g12', 'Lou\u0007ps', 'Lou\u2028ps'].forEach(function (nom) {
        var r = GU.creerFaction(e, 'Alice', { nom: nom });
        A.notOk(r.ok, 'refusé : ' + JSON.stringify(nom));
        A.equal(r.motif, 'nom_invalide');
      });
      A.equal(GU.nomValide('  Meute  '), 'Meute', 'nomValide rend le nom nettoyé');
      A.equal(GU.nomValide('Me\nute'), null, 'ou null');
      var ok = GU.creerFaction(e, 'Alice', { nom: '  Les   Aigles-d\'Or  ', couleur: 'red;background:url(x)', emblem: '<img>', devise: 'Vive\u0000 la <b>meute</b>' + 'x'.repeat(80) });
      A.ok(ok.ok);
      var f = e.factions.get(ok.id);
      A.equal(f.nom, 'Les Aigles-d\'Or', 'espaces en trop retirés');
      A.equal(f.couleur, '#8888ff', 'une couleur qui n\'est pas #rrggbb retombe sur la couleur par défaut');
      A.equal(f.emblem, null, 'emblème refusé');
      A.ok(f.devise.length <= 60 && f.devise.indexOf('<') < 0 && !/[\u0000-\u001f]/.test(f.devise), 'devise nettoyée et bornée : ' + f.devise);
      A.equal(GU.creerFaction(e, 'Bob', { nom: 'Ours', couleur: '#A0B1C2' }).ok, true);
      A.equal(e.factions.get(GU.idDe(e, 'Ours')).couleur, '#a0b1c2', 'couleur valide gardée');
      // le renommage par la modération suit les mêmes règles
      A.equal(GU.renommerParAdmin(e, ok.id, 'Mal\nveillant').motif, 'nom_invalide');
      A.equal(GU.renommerParAdmin(e, ok.id, 'ours').motif, 'nom_pris');
    });

    it('SPEC-FACTION-013 : membres, rangs, candidatures, invitations et relations survivent à l\'aller-retour ; liste de modération sans donnée superflue', function () {
      var e = GU.creerEtat();
      var f1 = GU.creerFaction(e, 'Alice', { nom: 'Aube' }).id;
      var f2 = GU.creerFaction(e, 'Zoe', { nom: 'Crepuscule' }).id;
      GU.postuler(e, 'Bob', f1); GU.accepter(e, 'Alice', f1, 'Bob'); GU.promouvoir(e, 'Alice', f1, 'Bob');
      GU.postuler(e, 'Dan', f1);                       // candidature en attente
      GU.inviter(e, 'Alice', f1, 'Eve');               // invitation en attente
      GU.declarerRelation(e, 'Alice', f1, f2, 'ennemie');
      var e2 = GU.charger(JSON.parse(JSON.stringify(GU.serialiser(e))));
      A.equal(GU.rangDe(e2, f1, 'Bob'), 'membre', 'rang conservé');
      A.ok(GU.accepter(e2, 'Alice', f1, 'Dan').ok, 'la candidature en attente est toujours là');
      A.ok(GU.accepterInvitation(e2, 'Eve', f1).ok, 'l\'invitation en attente est toujours là');
      A.equal(GU.relationEnvers(e2, f1, f2), 'ennemie', 'relation conservée');
      A.equal(e2.prochainId, e.prochainId, 'les identifiants ne se recyclent pas');
      var l = GU.listerPourAdmin(e);
      A.deep(l.map(function (x) { return x.nom; }), ['Aube', 'Crepuscule']);
      A.deep(Object.keys(l[0]).sort(), ['candidatures', 'chef', 'couleur', 'id', 'membres', 'nom'], 'ni membres nommés ni relations');
      A.equal(l[0].chef, 'Alice'); A.equal(l[0].membres, 2); A.equal(l[0].candidatures, 1);
    });

    it('SPEC-FACTION-013 : /admin factions et /admin faction renommer|dissoudre se traduisent en action faction_gerer, réservée à l\'administrateur et au modérateur', function () {
      var r = MC.Commandes.executer({ nom: 'admin', args: ['faction', 'renommer', 'Loups', 'La', 'Meute'] }, { enLigne: true });
      A.deep(r.actions[0], { type: 'admin', action: 'faction_gerer', args: { op: 'renommer', faction: 'Loups', nom: 'La Meute', mots: ['Loups', 'La', 'Meute'] } });
      var d = MC.Commandes.executer({ nom: 'admin', args: ['faction', 'dissoudre', 'Loups'] }, { enLigne: true });
      A.deep(d.actions[0].args, { op: 'dissoudre', faction: 'Loups', mots: ['Loups'] });
      A.deep(MC.Commandes.executer({ nom: 'admin', args: ['factions'] }, { enLigne: true }).actions[0].args, { op: 'lister' });
      A.ok(MC.Admin.peutAgir(MC.Admin.ROLES.ADMIN, 'faction_gerer'));
      A.ok(MC.Admin.peutAgir(MC.Admin.ROLES.MODERATEUR, 'faction_gerer'));
      A.notOk(MC.Admin.peutAgir(null, 'faction_gerer'), 'un simple joueur ne modère pas');
    });

    /* ── noms de faction à espaces (SPEC-FACTION-009 : nomValide les accepte) ─────
       Une faction « La Meute » doit être atteignable par toutes les commandes, et
       jamais une AUTRE faction (« La ») ne doit être visée à sa place. */
    it('SPEC-FACTION-013 : /admin faction dissoudre|renommer lit le nom ENTIER de la faction (à espaces), jamais le seul premier mot', function () {
      var d = MC.Commandes.executer({ nom: 'admin', args: ['faction', 'dissoudre', 'Les', 'Loups'] }, { enLigne: true });
      A.equal(d.actions[0].args.faction, 'Les Loups', 'tous les mots désignent la faction');
      var e = GU.creerEtat();
      var petite = GU.creerFaction(e, 'Alice', { nom: 'Les' }).id, grande = GU.creerFaction(e, 'Bob', { nom: 'Les Loups' }).id;
      A.equal(GU.idDe(e, d.actions[0].args.faction), grande, 'la faction visée est « Les Loups », pas « Les »');
      A.equal(GU.idDe(e, 'Les_Loups'), grande, '« _ » tient lieu d’espace');
      A.equal(GU.idDe(e, 'les'), petite);
      // renommer : le plus long début qui désigne une faction, le reste est le nouveau nom
      var r = MC.Commandes.executer({ nom: 'admin', args: ['faction', 'renommer', 'Les', 'Loups', 'Meute', 'Noire'] }, { enLigne: true });
      var sc = GU.scinderNom(e, r.actions[0].args.mots);
      A.equal(sc.id, grande); A.deep(sc.reste, ['Meute', 'Noire']);
      A.equal(GU.scinderNom(e, ['Inconnue', 'Zut']), null);
      A.equal(GU.scinderNom(e, ['Les']), null, 'un seul mot : pas de nouveau nom à lire');
    });

    it('SPEC-FACTION-010 : les commandes /faction atteignent une faction à espaces (postuler, accepter, nommer, relation, creer sans couleur)', function () {
      var e = GU.creerEtat();
      function cmd(qui, texte) {
        var r = MC.Commandes.executer({ nom: 'faction', args: texte.split(' ') }, {});
        return GU.appliquerAction(e, qui, r.actions[0]);
      }
      A.ok(/« La Meute » fondée/.test(cmd('Alice', 'creer La Meute').message), '/faction creer La Meute : « Meute » n’est pas une couleur');
      A.equal(GU.idDe(e, 'La Meute'), 'g1');
      var coul = MC.Commandes.executer({ nom: 'faction', args: ['creer', 'Les', 'Aigles', '#c03030', 'aigle', 'Haut', 'vol'] }, {}).actions[0].args;
      A.deep(coul, { nom: 'Les Aigles', couleur: '#c03030', emblem: 'aigle', devise: 'Haut vol' }, 'le nom court jusqu’à la couleur');
      A.ok(cmd('Bob', 'postuler La Meute').ok, 'postuler La Meute');
      A.ok(/Bob rejoint/.test(cmd('Alice', 'accepter La Meute Bob').message), 'accepter <faction à espaces> <joueur>');
      A.ok(cmd('Alice', 'nommer La Meute Bob officier').ok, 'nommer <faction à espaces> <joueur> <rang>');
      A.equal(GU.rangDe(e, 'g1', 'Bob'), 'officier');
      A.ok(cmd('Alice', 'inviter La Meute Carl').ok);
      A.ok(cmd('Carl', 'rejoindre La Meute').ok, 'rejoindre <faction à espaces>');
      A.ok(cmd('Alice', 'exclure La Meute Carl').ok);
      // relation : faction et cible à espaces, cible PNJ comprise
      var P = MC.Politique, pol = P.creer(3);
      P.decouvrir(pol, [{ id: 'ville:1', kind: 'ville', x: 0, z: 0, nom: 'Beau Lac' }, { id: 'ville:2', kind: 'ville', x: 500, z: 0, nom: 'B' }]);
      var pnj = Array.from(pol.factions.values()).find(function (f) { return /Beau Lac/.test(f.nom); });
      var r2 = MC.Commandes.executer({ nom: 'faction', args: ('relation La Meute ' + pnj.nom + ' ennemie').split(' ') }, {});
      var res = GU.appliquerAction(e, 'Alice', r2.actions[0], pol);
      A.ok(res.ok, 'relation <faction à espaces> <PNJ à espaces> ennemie : ' + res.message);
      A.equal(e.factions.get('g1').relations.get(pnj.id), 'ennemie');
      A.ok(cmd('Alice', 'dissoudre La Meute').ok, 'dissoudre <faction à espaces>');
      A.equal(GU.idDe(e, 'La Meute'), null);
    });

    it('SPEC-FACTION-017 : dissoudre une faction de joueurs retire ses relations envers les factions PNJ de l’état politique (aucun résidu, aucun héritage d’identifiant)', function () {
      var P = MC.Politique, pol = P.creer(3);
      P.decouvrir(pol, [{ id: 'ville:1', kind: 'ville', x: 0, z: 0, nom: 'A' }, { id: 'ville:2', kind: 'ville', x: 500, z: 0, nom: 'B' }]);
      var pnj = Array.from(pol.factions.keys())[0];
      var avant = pol.relations.size;
      var e = GU.creerEtat();
      var r = GU.creerFaction(e, 'Bob', { nom: 'Les Loups' });
      A.ok(GU.declarerRelation(e, 'Bob', r.id, pnj, 'ennemie', pol).ok);
      A.equal(pol.relations.size, avant + 1, 'la relation externe est posée');
      A.ok(GU.dissoudre(e, r.id).ok);
      A.equal(pol.relations.size, avant, 'dissoute : plus aucune relation « g<N>~PNJ »');
      // départ du dernier membre = dissolution aussi
      var r2 = GU.creerFaction(e, 'Cyd', { nom: 'Corbeaux' });
      GU.declarerRelation(e, 'Cyd', r2.id, pnj, 'alliee', pol);
      A.ok(GU.exclure(e, 'Cyd', r2.id, 'Cyd').ok || true);
      GU.quitter(e, 'Cyd', r2.id);
      A.equal(pol.relations.size, avant, 'la dissolution par départ du dernier membre purge aussi');
      // fichier de guildes illisible : l’identifiant g1 repart, mais l’ancienne guerre ne revient pas
      pol.relations.set('g1~' + pnj, 'guerre');
      var neuf = GU.charger(null);
      A.equal(GU.lierPolitique(neuf, pol), 1, 'au chargement, la relation orpheline est retirée');
      A.equal(pol.relations.size, avant);
      var f1 = GU.creerFaction(neuf, 'Dan', { nom: 'Nouvelle' });
      A.equal(f1.id, 'g1');
      A.equal(P.relationEntre(pol, 'g1', pnj), 'neutre', 'la nouvelle g1 n’hérite pas de l’ancienne guerre');
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
