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
    // borne à 100 (SPEC-SERVEUR-002) : le banc de charge simule jusqu'à 100 clients par palier
    { nom: 'max-joueurs', cle: 'maxJoueurs', attend: 'entier', defaut: 8, min: 1, max: 100, aide: 'nombre maximal de joueurs' },
    { nom: 'pvp', cle: 'pvp', attend: 'bool', defaut: false, aide: 'joueur contre joueur (on/off, défaut off)' },
    { nom: 'zone', cle: 'zone', attend: 'texte', defaut: 'generee', options: ['generee', 'tout_pve', 'tout_sur', 'tout_pvp'],
      aide: 'politique des zones de jeu (SPEC-ZONE-004) : generee, tout_pve, tout_sur ou tout_pvp' },
    { nom: 'liste-blanche', cle: 'listeBlanche', valeur: false, aide: 'seuls les joueurs inscrits entrent' },
    { nom: 'admin', cle: 'admin', attend: 'texte', defaut: null, aide: 'mot de passe ou jeton d\'administration' },
    // SPEC-BANC-015 : un serveur --serveur (dédié) refuse les résultats de test SAUF avec --tests
    { nom: 'tests', cle: 'tests', valeur: false, aide: 'autorise la réception de résultats de test (POST /tests/resultats) même en --serveur dédié' },
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

  /* ── Aide automatique (SPEC-PACK-003) ──────────────────────────────────
     Elle se déclenche à la demande (--aide, --help, -h, -?, /?, et
     --aide <paramètre> pour le détail d'un seul) ou d'elle-même quand un
     paramètre est inconnu (avec la suggestion la plus proche) ou incorrect
     (avec le détail du paramètre fautif). */
  var DEMANDES_AIDE = ['--aide', '--help', '-h', '-?', '/?', '-aide'];
  function defDe(nom) {
    nom = String(nom || '').replace(/^-+/, '');
    for (var k = 0; k < DEFS.length; k++) if (DEFS[k].nom === nom) return DEFS[k];
    return null;
  }
  function aideDe(nom) {
    var d = defDe(nom);
    if (!d) return null;
    var l = ['--' + d.nom + (d.valeur === undefined ? ' <' + (d.attend === 'bool' ? 'on|off' : d.attend) + '>' : '') + '  ' + d.aide];
    if (d.attend === 'entier' && (d.min !== undefined || d.max !== undefined)) l.push('  valeurs : de ' + d.min + ' à ' + d.max);
    if (d.defaut !== undefined && d.defaut !== null) l.push('  défaut : ' + (d.attend === 'bool' ? (d.defaut ? 'on' : 'off') : d.defaut));
    var ex = d.valeur !== undefined ? '--' + d.nom
           : '--' + d.nom + ' ' + (d.attend === 'entier' ? (d.defaut || d.min || 1) : d.attend === 'bool' ? 'on' : d.nom === 'monde' ? 'monde.json' : 'valeur');
    l.push('  exemple : node server.js ' + ex);
    return l.join('\n');
  }
  // distance d'édition, pour suggérer le paramètre voulu
  function distance(a, b) {
    var m = a.length, n = b.length, d = [];
    for (var i = 0; i <= m; i++) { d[i] = [i]; }
    for (var j = 0; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[m][n];
  }
  function suggestion(nom) {
    var best = null, bd = Infinity;
    DEFS.forEach(function (d) {
      var k = distance(nom, d.nom);
      if (d.nom.indexOf(nom) === 0 && nom.length >= 2) k = Math.min(k, 1);
      if (k < bd) { bd = k; best = d.nom; }
    });
    return bd <= Math.max(2, Math.floor(nom.length / 3)) ? best : null;
  }
  function erreurAvecAide(message, def) {
    return { ok: false, code: 'erreur', message: message + '\n\n' + (def ? aideDe(def.nom) : texteAide()) };
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
      if (typeof tok === 'string' && DEMANDES_AIDE.indexOf(tok.toLowerCase()) >= 0) {
        // --aide port : le détail d'un paramètre ; sinon la liste entière
        var sujet = liste[i + 1] && aideDe(liste[i + 1]);
        return { ok: false, code: 'aide', message: sujet || texteAide() };
      }
      if (typeof tok !== 'string' || tok.slice(0, 2) !== '--') {
        return erreurAvecAide('argument inattendu : ' + tok);
      }
      var eg = tok.indexOf('=');
      var nom = (eg >= 0 ? tok.slice(2, eg) : tok.slice(2));
      var valeurInline = eg >= 0 ? tok.slice(eg + 1) : null;
      var def = null;
      for (var k = 0; k < DEFS.length; k++) if (DEFS[k].nom === nom) { def = DEFS[k]; break; }
      if (!def) {
        var s = suggestion(nom);
        return erreurAvecAide('paramètre inconnu : --' + nom + (s ? ' — vouliez-vous dire --' + s + ' ?' : ''), s ? defDe(s) : null);
      }

      if (def.valeur !== undefined) {                 // drapeau sans valeur
        config[def.cle] = true;
        continue;
      }
      var brut = valeurInline;
      if (brut === null) {
        var suivant = liste[i + 1];
        if (suivant === undefined || (typeof suivant === 'string' && suivant.slice(0, 2) === '--')) {
          return erreurAvecAide('--' + nom + ' attend une valeur', def);
        }
        brut = suivant;
        i++;
      }
      if (def.attend === 'entier') {
        var n = Number(brut);
        if (!estEntier(n)) return erreurAvecAide('--' + nom + ' attend un entier, reçu : ' + brut, def);
        if (def.min !== undefined && n < def.min) return erreurAvecAide('--' + nom + ' doit être ≥ ' + def.min, def);
        if (def.max !== undefined && n > def.max) return erreurAvecAide('--' + nom + ' doit être ≤ ' + def.max, def);
        config[def.cle] = n;
      } else if (def.attend === 'bool') {
        var b = analyserBool(brut);
        if (b === undefined) return erreurAvecAide('--' + nom + ' attend on/off, reçu : ' + brut, def);
        config[def.cle] = b;
      } else {
        if (!brut) return erreurAvecAide('--' + nom + ' attend une valeur non vide', def);
        if (def.options && def.options.indexOf(brut) < 0) {
          return erreurAvecAide('--' + nom + ' attend l\'une de ces valeurs : ' + def.options.join(', ') + ', reçu : ' + brut, def);
        }
        config[def.cle] = brut;
      }
    }
    if (config.aide) return { ok: false, code: 'aide', message: texteAide() };
    return { ok: true, config: config };
  }

  MC.Parametres = { DEFS: DEFS, defaut: defaut, texteAide: texteAide, analyser: analyser,
                    aideDe: aideDe, suggestion: suggestion, DEMANDES_AIDE: DEMANDES_AIDE };
})(typeof globalThis !== 'undefined' ? globalThis : this);
