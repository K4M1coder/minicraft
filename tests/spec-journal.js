/* spec-journal.js — MC.Journal (src/journal.js), SPEC-BANC-104 à 109 :
   API, entrées, sorties et seuils, remontée bornée, message joueur unique,
   codes d'erreur, réglage à chaud. Module pur : chargeable dans le banc
   navigateur comme sous Node. Les vérifications qui lisent le disque (porte
   G16, catalogue docs/erreurs.md, ordre de chargement) sont dans
   tests/spec-journal-statique.js. */
(function (G) {
  'use strict';
  var MC = G.MC, T = G.T;
  var describe = T.describe, it = T.it, A = T.assert;

  /* Console factice : retient chaque appel (méthode, arguments). */
  function fausseConsole() {
    var appels = [];
    var c = { appels: appels };
    ['log', 'info', 'warn', 'error', 'debug'].forEach(function (m) {
      c[m] = function () { appels.push({ methode: m, args: Array.prototype.slice.call(arguments) }); };
    });
    return c;
  }
  /* Une instance isolée du journal, console factice branchée. */
  function journalIsole(mode) {
    var c = fausseConsole();
    var J = MC.Journal.creer({ mode: mode || 'jeu' });
    J.configurer({ console: { cible: c } });
    return { J: J, c: c };
  }

  describe('SPEC-BANC-104 à 109 — journal MC.Journal', {
    teste: 'Le journal unique (src/journal.js) : une entrée par appel avec ses sept champs, des sorties à seuils (console, tampon circulaire, remontée au serveur, collecte du rapport de test), le message joueur par une seule voie, les codes d\'erreur et le réglage à chaud par domaine.',
    pourquoi: 'Sans journal commun, chaque module écrivait (ou taisait) ses erreurs à sa façon : rien à relire après un échec, des messages joueur qui divergent, aucun moyen d\'activer la trace d\'un domaine en cours de partie.',
    attendu: 'les entrées portent horodatage, domaine, niveau, message, données, pile et contexte ; un debug en jeu n\'atteint pas la console mais remplit le tampon ; la remontée et le tampon restent bornés ; { joueur } s\'affiche ; ?journal=SYNC:trace produit les trace de SYNC.',
  }, function () {

    it('SPEC-BANC-104 : MC.Journal est chargé, deux instances ont le même comportement observable, un logger par domaine', function () {
      A.equal(typeof MC.Journal, 'function', 'MC.Journal est une fonction');
      var a = journalIsole('jeu'), b = MC.Journal.creer({ mode: 'jeu' });
      b.configurer({ console: { cible: fausseConsole() } });
      a.J('X').warn('w'); b('X').warn('w');
      A.equal(a.J.tampon().length, b.tampon().length, 'deux instances : même comportement observable');
      A.deep(MC.Journal.NIVEAUX, ['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
      A.equal(MC.Journal('RENDU'), MC.Journal('rendu'), 'un logger par domaine, insensible à la casse');
    });

    it('SPEC-BANC-105 : log.error(message, données, erreur) produit une entrée à sept champs, avec la pile et le contexte du test en cours', function () {
      var J = MC.Journal;
      var e = J('RENDU').error('x', { a: 1 }, new Error('y'));
      A.ok(e, 'une entrée est rendue');
      ['horodatage', 'domaine', 'niveau', 'message', 'donnees', 'pile', 'contexte'].forEach(function (k) {
        A.ok(Object.prototype.hasOwnProperty.call(e, k), 'champ ' + k);
      });
      A.ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.horodatage), 'horodatage ISO');
      A.equal(e.domaine, 'RENDU'); A.equal(e.niveau, 'error'); A.equal(e.message, 'x');
      A.deep(e.donnees, { a: 1 });
      A.ok(/y/.test(e.pile) && /Error/.test(e.pile), 'la pile de l\'erreur est gardée : ' + e.pile);
      A.equal(e.contexte.test, 'SPEC-BANC-105', 'le contexte porte le test en cours (posé par le harnais)');
      var dernier = J.tampon({ test: 'SPEC-BANC-105' }).pop();
      A.equal(dernier, e, 'la même entrée est dans le tampon');
    });

    it('SPEC-BANC-105 : le contexte réunit joueur local et mode (fournisseur) sans écraser une valeur posée', function () {
      var o = journalIsole('jeu'), J = o.J;
      J.fournirContexte(function () { return { joueur: 'Alice', mode: 'survie' }; });
      J.contexte({ test: 'T1' });
      var e = J('JEU').warn('m');
      A.deep(e.contexte, { test: 'T1', joueur: 'Alice', mode: 'survie' });
      J.contexte({ test: null });
      A.equal(J('JEU').warn('m').contexte.test, undefined, 'contexte retiré');
      J.fournirContexte(function () { throw new Error('panne'); });
      A.ok(J('JEU').warn('toujours journalisé'), 'un fournisseur en panne n\'empêche rien');
    });

    it('SPEC-BANC-106 : en mode jeu, un debug n\'atteint pas la console mais entre dans le tampon ; warn atteint la console', function () {
      var o = journalIsole('jeu'), J = o.J;
      J('SYNC').debug('détail');
      A.equal(o.c.appels.length, 0, 'rien à la console');
      A.equal(J.tampon().length, 1, 'le debug est dans le tampon');
      A.equal(J.tampon()[0].niveau, 'debug');
      J('SYNC').warn('attention', { n: 2 });
      A.equal(o.c.appels.length, 1, 'warn atteint la console');
      A.equal(o.c.appels[0].methode, 'warn');
      A.equal(o.c.appels[0].args[0], '[SYNC] attention');
      A.deep(o.c.appels[0].args[1], { n: 2 }, 'données passées à la console, inspectables');
      J('SYNC').trace('trop fin');
      A.equal(J.tampon().length, 2, 'trace n\'est pas produit par défaut en jeu');
    });

    it('SPEC-BANC-106 : seuil console info en développement, muet en test ; le tampon circulaire reste borné', function () {
      var o = journalIsole('dev'), J = o.J;
      J('X').info('i'); J('X').debug('d');
      A.equal(o.c.appels.length, 1, 'info à la console en dev, pas debug');
      A.equal(o.c.appels[0].methode, 'info');
      var t = journalIsole('test');
      t.J('X').fatal('f'); t.J('X').trace('t');
      A.equal(t.c.appels.length, 0, 'console muette en test');
      A.equal(t.J.tampon().length, 2, 'trace produit en test (enregistreur de vol)');
      t.J.configurer({ capaciteTampon: 5 });
      for (var i = 0; i < 12; i++) t.J('X').info('n' + i);
      var tb = t.J.tampon();
      A.equal(tb.length, 5, 'tampon borné à sa capacité');
      A.equal(tb[4].message, 'n11', 'les plus récentes sont gardées');
      A.equal(tb[0].message, 'n7');
    });

    it('SPEC-BANC-106 : une sortie ajoutée a son seuil ; une sortie en panne ne bloque pas les autres', function () {
      var o = journalIsole('jeu'), J = o.J;
      var recus = [];
      J.ajouterSortie({ nom: 'fichier', seuil: 'info', ecrire: function (e) { recus.push(MC.Journal.formater(e)); } });
      J.ajouterSortie({ nom: 'panne', seuil: 'trace', ecrire: function () { throw new Error('disque plein'); } });
      J('SERVEUR').debug('pas au fichier'); J('SERVEUR').info('au fichier', null, null, { code: 'E-SAVE-002' });
      A.equal(recus.length, 1);
      A.ok(/ INFO SERVEUR E-SAVE-002 au fichier$/.test(recus[0]), 'ligne formatée : ' + recus[0]);
      A.equal(J.tampon().length, 2, 'le tampon a tout reçu malgré la sortie en panne');
      A.ok(J.retirerSortie('fichier'));
      A.equal(J.retirerSortie('tampon'), false, 'les sorties de base restent');
      A.deep(J.configuration().sorties, ['console', 'tampon', 'panne']);
      A.equal(J.seuilSortie('panne', 'error'), 'error');
    });

    it('SPEC-BANC-106 : la remontée au serveur n\'envoie que error/fatal, au débit limité, dans un message que le serveur valide', function () {
      var o = journalIsole('jeu'), J = o.J;
      var t = 0, envois = [];
      J.ajouterSortie(MC.Journal.sortieRemontee(function (m) { envois.push(m); }, { max: 3, fenetreMs: 1000, horloge: function () { return t; } }));
      J('RENDU').warn('pas remonté');
      for (var i = 0; i < 10; i++) J('RENDU').error('E-SAVE-004 panne ' + i, null, new Error('pile'));
      A.equal(envois.length, 3, 'débit limité à 3 par fenêtre');
      t = 1000;
      J('RENDU').fatal('après la fenêtre');
      A.equal(envois.length, 4, 'la fenêtre glissante se libère');
      var m = envois[0];
      A.equal(m.t, MC.Journal.TYPE_REMONTEE);
      A.equal(m.t, MC.NetProtocol.MSG.JOURNAL_CLIENT, 'même type que le protocole réseau');
      A.equal(m.code, 'E-SAVE-004', 'le code est reconnu en tête du message');
      var v = MC.NetProtocol.valider(m);
      A.ok(v && v.niveau === 'error' && v.domaine === 'RENDU' && /pile/.test(v.pile), 'NP.valider accepte la remontée');
      A.equal(MC.Journal.validerRemontee({ t: 'journal_client', niveau: 'info', domaine: 'X', message: 'm' }), null, 'info refusé');
      A.equal(MC.Journal.validerRemontee({ t: 'journal_client', niveau: 'error', domaine: 'x y', message: 'm' }), null, 'domaine invalide');
      A.equal(MC.Journal.validerRemontee({ t: 'journal_client', niveau: 'error', domaine: 'X', message: '' }), null, 'message vide');
      var long = MC.Journal.validerRemontee({ t: 'journal_client', niveau: 'error', domaine: 'X', message: new Array(2000).join('a'), code: 'pas un code' });
      A.equal(long.message.length, MC.Journal.REMONTEE.messageMax, 'message tronqué');
      A.equal(long.code, undefined, 'code mal formé ignoré');
      A.equal(MC.Journal.validerRemontee({ t: 'journal_client', niveau: 'error', domaine: 'X', message: 'a\nMC_PORT=1\r\nb' }).message, 'a MC_PORT=1 b',
        'une remontée ne peut pas écrire sa propre ligne dans la sortie du serveur');
      var lim = MC.Journal.limiteur(2, 100, function () { return 0; });
      A.deep([lim(), lim(), lim()], [true, true, false]);
    });

    it('SPEC-BANC-106 : la collecte du rapport de test garde les entrées warn et plus, en lignes où le code se retrouve', function () {
      var o = journalIsole('test'), J = o.J;
      var col = MC.Journal.sortieCollecte('rapport', 'warn');
      J.ajouterSortie(col);
      J('SAVE').info('ignoré'); J('SAVE').error('E-SAVE-002 version inconnue', { id: 'p1' });
      A.equal(col.entrees.length, 1);
      A.ok(/E-SAVE-002/.test(col.lignes()[0]), col.lignes()[0]);
    });

    it('SPEC-BANC-107 : { joueur } journalise le détail technique ET affiche le texte lisible, par une seule voie', function () {
      var o = journalIsole('jeu'), J = o.J;
      var vus = [];
      J.configurer({ afficherJoueur: function (texte, e) { vus.push([texte, e.niveau]); } });
      var e = J('SAVE').error('écriture refusée', { motif: 'quota' }, new Error('QuotaExceeded'), { joueur: 'Impossible de sauvegarder la partie' });
      A.deep(vus, [['Impossible de sauvegarder la partie', 'error']]);
      A.equal(e.joueur, 'Impossible de sauvegarder la partie');
      A.ok(/QuotaExceeded/.test(e.pile), 'détail technique complet dans l\'entrée');
      J('SAVE').error('sans message joueur');
      A.equal(vus.length, 1, 'sans { joueur } rien ne s\'affiche');
      J.configurer({ afficherJoueur: function () { J('SAVE').error('boucle', null, null, { joueur: 'encore' }); } });
      J('SAVE').error('x', null, null, { joueur: 'y' });
      A.ok(J.tampon().length < 10, 'un affichage qui journalise ne boucle pas sans fin');
    });

    it('SPEC-BANC-107 : une sauvegarde illisible (version inconnue) affiche « Sauvegarde illisible » au joueur et journalise le détail', function () {
      var J = MC.Journal;
      var vus = [];
      var ancien = J.configurer({ afficherJoueur: function (texte) { vus.push(texte); } });
      try {
        var memoire = {};
        var st = { getItem: function (k) { return memoire[k] === undefined ? null : memoire[k]; },
                   setItem: function (k, v) { memoire[k] = String(v); }, removeItem: function (k) { delete memoire[k]; } };
        var meta = MC.Saves.creer(st, { nom: 'Essai', mode: 'survie', difficulte: 'facile', graine: 7 });
        st.setItem(MC.Saves.SLOT_PREFIX + meta.id, JSON.stringify({ slotV: 999 }));
        A.equal(MC.Saves.charger(st, meta.id, {}), null, 'chargement refusé (comportement inchangé)');
        A.deep(vus, ['Sauvegarde illisible']);
        var e = J.tampon({ domaine: 'SAVE', niveau: 'error' }).pop();
        A.equal(e.code, 'E-SAVE-002');
        A.equal(e.donnees.id, meta.id);
        A.equal(e.donnees.version, 999, 'détail technique : la version trouvée');
      } finally { J.configurer(ancien); }
    });

    it('SPEC-BANC-108 : un code d\'erreur se lit en tête du message ou en option, et figure dans la ligne formatée', function () {
      var o = journalIsole('jeu'), J = o.J;
      A.equal(J('X').error('E-SERV-001 port pris').code, 'E-SERV-001');
      A.equal(J('X').error('sans code').code, null);
      A.equal(J('X').error('m', null, null, { code: 'E-SAVE-005' }).code, 'E-SAVE-005');
      A.ok(/E-SAVE-005/.test(MC.Journal.formater(J.tampon().pop())));
      J('X').error('E-SERV-002 partie');
      A.equal(o.c.appels.pop().args[0], '[X] E-SERV-002 partie', 'code en tête : pas répété');
      J('X').error('partie', null, null, { code: 'E-SERV-002' });
      A.equal(o.c.appels.pop().args[0], '[X] E-SERV-002 partie', 'code en option : rappelé à la console');
    });

    it('SPEC-BANC-109 : ?journal=SYNC:trace fait produire les trace de SYNC sans redémarrage ; niveau() change un domaine en cours de partie', function () {
      var o = journalIsole('jeu'), J = o.J;
      J('SYNC').trace('avant');
      A.equal(J.tampon().length, 0, 'pas de trace par défaut');
      var r = J.regler('SYNC:trace,RENDU:debug');
      A.ok(r.ok); A.deep(r.domaines, { SYNC: 'trace', RENDU: 'debug' });
      J('SYNC').trace('après');
      A.equal(J.tampon().length, 1, 'la trace de SYNC entre dans le tampon');
      A.equal(J.tampon()[0].message, 'après');
      J('RENDU').debug('visible');
      J('AUTRE').debug('invisible');
      var lignes = o.c.appels.map(function (a) { return a.args[0]; });
      A.deep(lignes,['[SYNC] après', '[RENDU] visible'], 'le réglage d\'un domaine vaut aussi pour la console ; AUTRE garde le seuil du mode');
      A.equal(J.niveau('SYNC', 'error'), 'error');
      J('SYNC').warn('coupé');
      A.equal(J.tampon({ domaine: 'SYNC' }).length, 1, 'niveau() relève le seuil à chaud');
      A.equal(J.niveau('SYNC', null), 'debug', 'null rend le défaut du mode');
      A.equal(J.niveau('SYNC', 'bavard'), null, 'niveau inconnu refusé');
      var mauvais = MC.Journal.analyserReglage('SYNC:bavard, :info,RENDU:WARN');
      A.equal(mauvais.ok, false);
      A.deep(mauvais.erreurs, ['SYNC:bavard', ':info']);
      A.deep(mauvais.domaines, { RENDU: 'warn' });
    });

    it('SPEC-BANC-109 : --journal est une option du serveur', function () {
      var r = MC.Parametres.analyser(['--journal', 'SYNC:trace']);
      A.ok(r.ok, r.message);
      A.equal(r.config.journal, 'SYNC:trace');
      A.equal(MC.Parametres.analyser([]).config.journal, null);
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
