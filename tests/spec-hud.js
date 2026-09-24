/* spec-hud.js — tests des specs SPEC-HUD-*. Le registre d'affichage est pur :
   il ne connaît ni le DOM ni localStorage (l'objet stockage est injecté),
   ce qui le rend testable sous Node comme chat.js ou saves.js. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;
  var Hud = MC.Hud;

  function trouver(id) {
    return Hud.COMPOSANTS.filter(function (c) { return c.id === id; })[0];
  }

  // stockage de type localStorage, en mémoire, pour vérifier la conservation
  function fauxStockage() {
    var m = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
      setItem: function (k, v) { m[k] = String(v); },
    };
  }

  describe('Specs — HUD', { teste: 'Le HUD et son registre de préférences (affichage, stockage tolérant aux erreurs).', pourquoi: 'Un stockage qui lève (quota dépassé, navigation privée) ne doit jamais faire planter l\'affichage du HUD.', attendu: 'le registre absorbe les erreurs de stockage et reste cohérent (état, sérialisation, rechargement), en plus des specs SPEC-HUD-* couvertes une à une.' }, function () {

    it('SPEC-HUD-001 : une bascule générale masque et rétablit tous les composants, la préférence de chacun est conservée', function () {
      var stockage = fauxStockage();
      var r = Hud.creerRegistre(stockage);
      Hud.COMPOSANTS.forEach(function (c) { A.ok(r.visible(c.id), c.id + ' visible au départ'); });

      // une préférence individuelle, posée AVANT la bascule générale
      r.regler('chat', false);
      A.notOk(r.visible('chat'));

      r.basculerTout();
      Hud.COMPOSANTS.forEach(function (c) { A.notOk(r.visible(c.id), c.id + ' masqué par la bascule générale'); });

      r.basculerTout();
      A.ok(r.visible('infos'), 'rétabli par la seconde bascule');
      A.notOk(r.visible('chat'), 'la préférence individuelle antérieure à la bascule est reprise, pas effacée');

      // conservation d'une partie à l'autre via le même objet de stockage
      var r2 = Hud.creerRegistre(stockage);
      A.notOk(r2.visible('chat'), 'le choix est repris au démarrage suivant');
      A.ok(r2.visible('infos'), 'et les autres restent visibles');
    });

    it('creerRegistre : les erreurs de stockage (quota, mode privé…) sont avalées', function () {
      var stockageCasse = {
        getItem: function () { throw new Error('indisponible'); },
        setItem: function () { throw new Error('indisponible'); },
      };
      var r = Hud.creerRegistre(stockageCasse);
      A.ok(r.visible('infos'), 'démarre quand même avec les valeurs par défaut');
      r.basculer('infos');            // ne doit pas lever malgré setItem en échec
      A.notOk(r.visible('infos'));
    });

    it('creerRegistre : etat(), serialiser() et charger() permettent une conservation explicite', function () {
      var r = Hud.creerRegistre();
      r.regler('gardien', false);
      var e = r.etat();
      A.equal(e.gardien, false, 'état dérivé : composant masqué');
      A.equal(e.infos, true, 'état dérivé : composant resté visible');

      var snap = r.serialiser();
      var r2 = Hud.creerRegistre();
      A.ok(r2.charger(snap), 'chargement accepté');
      A.notOk(r2.visible('gardien'), 'la préférence est reprise par un autre registre');
      A.notOk(r2.charger(null), 'un objet invalide est refusé sans lever');
    });

    it('SPEC-HUD-003 : infos (.debug) se masque et se rétablit seul', function () {
      var c = trouver('infos');
      A.ok(c, 'composant déclaré');
      A.deep(c.selecteurs, ['.debug']);
      var r = Hud.creerRegistre();
      r.basculer('infos');
      A.notOk(r.visible('infos'));
      A.ok(r.visible('barres'), 'les autres composants ne bougent pas');
      r.basculer('infos');
      A.ok(r.visible('infos'), 'rétabli');
    });

    it('SPEC-HUD-004 : viseur et anneau de minage (.crosshair, .mining-ring) se masquent et se rétablissent ensemble', function () {
      var c = trouver('viseur');
      A.ok(c);
      A.deep(c.selecteurs, ['.crosshair', '.mining-ring']);
      var r = Hud.creerRegistre();
      r.basculer('viseur');
      A.notOk(r.visible('viseur'), 'le groupe entier bascule d\'un coup');
      A.ok(r.visible('objets'), 'indépendant des autres composants');
      r.basculer('viseur');
      A.ok(r.visible('viseur'));
    });

    it('SPEC-HUD-005 : barres de vie, de faim et d\'air (.stats) se masquent et se rétablissent ensemble', function () {
      var c = trouver('barres');
      A.ok(c);
      A.deep(c.selecteurs, ['.stats']);
      var r = Hud.creerRegistre();
      r.regler('barres', false);
      A.notOk(r.visible('barres'));
      A.ok(r.visible('infos'));
      r.regler('barres', true);
      A.ok(r.visible('barres'));
    });

    it('SPEC-HUD-006 : barre d\'objets et nom de l\'objet tenu (.hotbar, .held-name) se masquent et se rétablissent ensemble', function () {
      var c = trouver('objets');
      A.ok(c);
      A.deep(c.selecteurs, ['.hotbar', '.held-name']);
      var r = Hud.creerRegistre();
      r.basculer('objets');
      A.notOk(r.visible('objets'));
      A.ok(r.visible('notifications'));
      r.basculer('objets');
      A.ok(r.visible('objets'));
    });

    it('SPEC-HUD-007 : notifications (.toasts) se masquent et se rétablissent seules', function () {
      var c = trouver('notifications');
      A.ok(c);
      A.deep(c.selecteurs, ['.toasts']);
      var r = Hud.creerRegistre();
      r.basculer('notifications');
      A.notOk(r.visible('notifications'));
      A.ok(r.visible('chat'));
      r.basculer('notifications');
      A.ok(r.visible('notifications'));
    });

    /* Le rétablissement forcé de T (« même masqué, T rouvre le chat pour
       saisir ») dépend du clavier et de la boucle de jeu : il est vérifié en
       conditions réelles dans tests/e2e.js. Ici, seule l'indépendance de la
       bascule du composant est testable hors navigateur. */
    it('SPEC-HUD-008 : chat (.chat) se masque et se rétablit seul', function () {
      var c = trouver('chat');
      A.ok(c);
      A.deep(c.selecteurs, ['.chat']);
      var r = Hud.creerRegistre();
      r.basculer('chat');
      A.notOk(r.visible('chat'));
      A.ok(r.visible('boussole'));
      r.basculer('chat');
      A.ok(r.visible('chat'));
    });

    it('SPEC-HUD-009 : boussole des repères (.boussole) se masque et se rétablit seule', function () {
      var c = trouver('boussole');
      A.ok(c);
      A.deep(c.selecteurs, ['.boussole']);
      var r = Hud.creerRegistre();
      r.basculer('boussole');
      A.notOk(r.visible('boussole'));
      A.ok(r.visible('gardien'));
      r.basculer('boussole');
      A.ok(r.visible('boussole'));
    });

    it('SPEC-HUD-010 : barre du gardien (.barre-boss) se masque et se rétablit seule', function () {
      var c = trouver('gardien');
      A.ok(c);
      A.deep(c.selecteurs, ['.barre-boss']);
      var r = Hud.creerRegistre();
      r.basculer('gardien');
      A.notOk(r.visible('gardien'));
      A.ok(r.visible('objectif'));
      r.basculer('gardien');
      A.ok(r.visible('gardien'));
    });

    it('SPEC-HUD-011 : objectif de l\'histoire (.objectif-histoire) se masque et se rétablit seul', function () {
      var c = trouver('objectif');
      A.ok(c);
      A.deep(c.selecteurs, ['.objectif-histoire']);
      var r = Hud.creerRegistre();
      r.basculer('objectif');
      A.notOk(r.visible('objectif'));
      A.ok(r.visible('etiquettes'));
      r.basculer('objectif');
      A.ok(r.visible('objectif'));
    });

    it('SPEC-HUD-012 : étiquettes des joueurs en écran partagé (.etiquette), la bascule vaut pour tous les sélecteurs', function () {
      var c = trouver('etiquettes');
      A.ok(c);
      A.deep(c.selecteurs, ['.etiquette']);
      var r = Hud.creerRegistre();
      r.basculer('etiquettes');
      A.notOk(r.visible('etiquettes'));
      A.ok(r.visible('infos'), 'les étiquettes basculent indépendamment des autres composants');
      r.basculer('etiquettes');
      A.ok(r.visible('etiquettes'));
    });

    it('SPEC-HUD-002 : orientation() donne un cap 0-359°, un point cardinal et une inclinaison', function () {
      // convention du projet : avant = (-sin yaw, 0, -cos yaw) ; nord = -z
      var o = Hud.orientation(0, 0);
      A.equal(o.cap, 0, 'yaw 0 : on regarde vers -z, le nord');
      A.equal(o.cardinal, 'N');
      A.equal(o.inclinaison, 0);

      o = Hud.orientation(-Math.PI / 2, 0);
      A.equal(o.cap, 90, 'avant = (1,0) : l\'est');
      A.equal(o.cardinal, 'E');

      o = Hud.orientation(Math.PI, 0);
      A.equal(o.cap, 180, 'avant = (0,1) : le sud');
      A.equal(o.cardinal, 'S');

      o = Hud.orientation(Math.PI / 2, 0);
      A.equal(o.cap, 270, 'avant = (-1,0) : l\'ouest');
      A.equal(o.cardinal, 'O');

      o = Hud.orientation(0, Math.PI / 4);
      A.equal(o.inclinaison, 45, 'inclinaison positive : on regarde vers le haut');
      o = Hud.orientation(0, -Math.PI / 4);
      A.equal(o.inclinaison, -45, 'inclinaison négative : vers le bas');

      // toujours dans la plage attendue, même avec un yaw hors [-2π, 2π]
      o = Hud.orientation(7 * Math.PI, 0);
      A.ok(o.cap >= 0 && o.cap < 360, 'cap toujours normalisé : ' + o.cap);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
