/* parametres.js — analyse des paramètres de lancement (SPEC-PACK-002).
   Module PUR : il prend un tableau d'arguments et renvoie soit une
   configuration, soit une erreur claire — jamais d'accès disque ou réseau,
   jamais de process.exit. C'est server.js qui décide d'arrêter le programme
   à partir du résultat, ce qui rend l'analyse elle-même testable sous Node
   sans lancer de vrai serveur. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  /* Chaque paramètre : son nom, s'il attend une valeur, comment la valider,
     et sa place dans la configuration finale. Déclaratif plutôt qu'un long
     if/else : ajouter un paramètre ne touche qu'une ligne ici et l'aide se
     génère toute seule, sans risquer de désynchronisation entre les deux. */
  var DEFS = [
    { nom: 'serveur', cle: 'serveurSeul', valeur: false, aide: 'serveur seul, sans partie locale' },
    { nom: 'port', cle: 'port', attend: 'entier', defaut: 8080, min: 1, max: 65535, aide: 'port d\'écoute (défaut 8080)' },
    { nom: 'graine', cle: 'graine', attend: 'entier', defaut: null, aide: 'graine de génération du monde' },
    { nom: 'monde', cle: 'monde', attend: 'texte', defaut: null, aide: 'fichier de sauvegarde du monde (persistance)' },
    { nom: 'max-joueurs', cle: 'maxJoueurs', attend: 'entier', defaut: 8, min: 1, max: 64, aide: 'nombre maximal de joueurs' },
    { nom: 'pvp', cle: 'pvp', attend: 'bool', defaut: false, aide: 'joueur contre joueur (on/off, défaut off)' },
    { nom: 'liste-blanche', cle: 'listeBlanche', valeur: false, aide: 'seuls les joueurs inscrits entrent' },
    { nom: 'admin', cle: 'admin', attend: 'texte', defaut: null, aide: 'mot de passe ou jeton d\'administration' },
    { nom: 'aide', cle: 'aide', valeur: false, aide: 'affiche cette liste et s\'arrête' },
  ];

  function defaut() {
    var c = {};
    DEFS.forEach(function (d) { c[d.cle] = d.valeur !== undefined ? d.valeur : d.defaut; });
    return c;
  }

  function texteAide() {
    var lignes = ['Paramètres de lancement :'];
    DEFS.forEach(function (d) {
      var forme = '--' + d.nom + (d.valeur === undefined ? ' <valeur>' : '');
      lignes.push('  ' + forme + '  ' + d.aide);
    });
    return lignes.join('\n');
  }

  function estEntier(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

  function analyserBool(txt) {
    var v = String(txt).trim().toLowerCase();
    if (['on', 'oui', 'true', '1', 'vrai'].indexOf(v) >= 0) return true;
    if (['off', 'non', 'false', '0', 'faux'].indexOf(v) >= 0) return false;
    return undefined;
  }

  /* `argv` : les arguments SANS `node script.js`, comme process.argv.slice(2).
     Renvoie toujours { ok, config } ou { ok:false, code, message }.
     `code` vaut 'aide' (demande explicite, pas une erreur) ou 'erreur'. */
  function analyser(argv) {
    var config = defaut();
    var liste = Array.isArray(argv) ? argv.slice() : [];
    for (var i = 0; i < liste.length; i++) {
      var tok = liste[i];
      if (typeof tok !== 'string' || tok.slice(0, 2) !== '--') {
        return { ok: false, code: 'erreur', message: 'argument inattendu : ' + tok };
      }
      var eg = tok.indexOf('=');
      var nom = (eg >= 0 ? tok.slice(2, eg) : tok.slice(2));
      var valeurInline = eg >= 0 ? tok.slice(eg + 1) : null;
      var def = null;
      for (var k = 0; k < DEFS.length; k++) if (DEFS[k].nom === nom) { def = DEFS[k]; break; }
      if (!def) return { ok: false, code: 'erreur', message: 'paramètre inconnu : --' + nom + ' (essayez --aide)' };

      if (def.valeur !== undefined) {                 // drapeau sans valeur
        config[def.cle] = true;
        continue;
      }
      var brut = valeurInline;
      if (brut === null) {
        var suivant = liste[i + 1];
        if (suivant === undefined || (typeof suivant === 'string' && suivant.slice(0, 2) === '--')) {
          return { ok: false, code: 'erreur', message: '--' + nom + ' attend une valeur' };
        }
        brut = suivant;
        i++;
      }
      if (def.attend === 'entier') {
        var n = Number(brut);
        if (!estEntier(n)) return { ok: false, code: 'erreur', message: '--' + nom + ' attend un entier, reçu : ' + brut };
        if (def.min !== undefined && n < def.min) return { ok: false, code: 'erreur', message: '--' + nom + ' doit être ≥ ' + def.min };
        if (def.max !== undefined && n > def.max) return { ok: false, code: 'erreur', message: '--' + nom + ' doit être ≤ ' + def.max };
        config[def.cle] = n;
      } else if (def.attend === 'bool') {
        var b = analyserBool(brut);
        if (b === undefined) return { ok: false, code: 'erreur', message: '--' + nom + ' attend on/off, reçu : ' + brut };
        config[def.cle] = b;
      } else {
        if (!brut) return { ok: false, code: 'erreur', message: '--' + nom + ' attend une valeur non vide' };
        config[def.cle] = brut;
      }
    }
    if (config.aide) return { ok: false, code: 'aide', message: texteAide() };
    return { ok: true, config: config };
  }

  MC.Parametres = { DEFS: DEFS, defaut: defaut, texteAide: texteAide, analyser: analyser };
})(typeof globalThis !== 'undefined' ? globalThis : this);
