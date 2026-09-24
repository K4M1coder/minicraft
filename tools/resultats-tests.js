/* tools/resultats-tests.js — écriture du cahier de test (SPEC-BANC-014/015).
   Module Node (CommonJS, PAS un module pur UMD comme tests/*.js) : il touche
   au système de fichiers, exprès — c'est justement ce qui le rend testable
   sous Node SANS lancer de serveur (server.js n'ajoute qu'un branchement,
   voir plus bas), conformément au contrat du lot L42.

   Écrit tests/resultats/<AAAA-MM-JJ_HH-MM-SS>_<préréglage-slugifié>/ :
     resultats.json  — schéma documenté en tête de tests/rapport.js
     rapport.html    — produit par MC_RAPPORT.html (tests/rapport.js)
     captures/       — 0001-<libellé-slugifié>.<ext>, ...

   Sécurité de la route serveur (SPEC-BANC-015) :
   - `estAdresseLocale(adresse)` : n'accepte que 127.0.0.1 / ::1 / ::ffff:127.0.0.1
     (et leur forme « localhost » une fois résolue par le serveur) ;
   - `peutRecevoirResultats(params)` : refuse quand le serveur tourne EN
     SERVEUR DÉDIÉ (`--serveur`) sans l'option `--tests` explicite — un
     serveur dédié en production n'a normalement aucune raison de recevoir des
     cahiers de test, mais on veut pouvoir l'activer pour l'intégration
     continue d'une demande de fusion sans lancer un second processus ;
   - aucun nom de fichier ne vient du client : `traiterEnvoi` fabrique tous les
     noms lui-même (index + libellé passé à la moulinette `slug`), ce qui
     élimine toute traversée de répertoire par construction plutôt que par
     une liste noire de motifs ;
   - la taille du corps JSON (comptant les captures en base64) est bornée par
     `limiteOctets` (64 Mo par défaut). */
'use strict';
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const DOSSIER_RESULTATS = path.join(RACINE, 'tests', 'resultats');
const MAX_DOSSIERS = 20;
const LIMITE_OCTETS_DEFAUT = 64 * 1024 * 1024;

function estAdresseLocale(adresse) {
  if (!adresse) return false;
  const a = String(adresse).replace(/^::ffff:/, '');
  return a === '127.0.0.1' || a === '::1' || a === 'localhost';
}

/* Un serveur lancé --serveur (dédié, sans partie locale) refuse les envois
   de résultats SAUF s'il a été explicitement lancé aussi avec --tests —
   c'est ce qui permet de le réutiliser pour l'intégration continue d'une
   demande de fusion sans changer sa ligne de commande de production. Un
   serveur normal (avec partie locale, poste de développement) accepte
   toujours : c'est le cas d'usage principal, le banc navigateur local. */
function peutRecevoirResultats(params) {
  const p = params || {};
  if (p.serveurSeul && !p.tests) return false;
  return true;
}

function slug(txt) {
  return String(txt === undefined || txt === null ? '' : txt)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'sans-nom';
}

function pad2(n) { return String(n).padStart(2, '0'); }
function horodatage(date) {
  const d = date || new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '_' +
    pad2(d.getHours()) + '-' + pad2(d.getMinutes()) + '-' + pad2(d.getSeconds());
}
function nomDossier(preset, date) {
  return horodatage(date) + '_' + slug(preset || 'sans-preset');
}

const EXT_PAR_TYPE = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/png': 'png' };

const LIMITE_CHAMP = 200;
/* Force en chaîne, tronque et retire les caractères de contrôle — les
   champs de campagne (préréglage, commit, version du jeu, navigateur, GPU,
   résolution) viennent du JSON posté par un client sur /tests/resultats et
   sont potentiellement hostiles (revue adversariale, correction XSS stocké
   1/3) : tests/cahiers.html les affiche ensuite dans un innerHTML échappé,
   mais on assainit aussi à l'écriture pour ne jamais persister n'importe
   quoi dans resultats.json (défense en profondeur, pas la seule barrière). */
function assainirChamp(v) {
  if (v === undefined || v === null) return v;
  // eslint-disable-next-line no-control-regex
  return String(v).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, LIMITE_CHAMP);
}
function assainirCampagne(campagne) {
  if (!campagne || typeof campagne !== 'object') return campagne;
  const c = campagne;
  if (c.preset !== undefined) c.preset = assainirChamp(c.preset);
  if (c.environnement && typeof c.environnement === 'object') {
    const env = c.environnement;
    ['commit', 'versionJeu', 'navigateur', 'gpu', 'resolution'].forEach((champ) => {
      if (env[champ] !== undefined) env[champ] = assainirChamp(env[champ]);
    });
  }
  return c;
}

/* Écrit resultats.json + rapport.html + captures/. `resultats` suit le
   schéma de tests/rapport.js. `captures` (facultatif) : [{ libelle, type,
   base64 }] — le fichier fabriqué pour chacune est reporté dans
   resultats.tests[*].captures[*].fichier en appariant par LIBELLÉ EXACT
   (les libellés d'une même campagne doivent donc être uniques ; c'est ce
   qu'utilise le banc navigateur : "<nom du test> · <libellé de l'étape>").
   `options.racine` (tests) et `options.nom` (tests) permettent de rediriger
   l'écriture — utilisé par tests/spec-banc.js pour ne pas polluer le vrai
   dossier de résultats pendant ses propres tests. */
function ecrireCahier(resultats, options) {
  const opts = options || {};
  const racine = opts.racine || DOSSIER_RESULTATS;
  const nom = opts.nom || nomDossier(resultats && resultats.campagne && resultats.campagne.preset);
  const dossier = path.join(racine, nom);
  fs.mkdirSync(dossier, { recursive: true });

  const captures = opts.captures || [];
  const fichierParLibelle = new Map();
  if (captures.length) {
    const capturesDir = path.join(dossier, 'captures');
    fs.mkdirSync(capturesDir, { recursive: true });
    captures.forEach((c, i) => {
      const ext = EXT_PAR_TYPE[c.type] || 'jpg';
      const fichier = String(i + 1).padStart(4, '0') + '-' + slug(c.libelle) + '.' + ext;
      fs.writeFileSync(path.join(capturesDir, fichier), Buffer.from(c.base64 || '', 'base64'));
      if (!fichierParLibelle.has(c.libelle)) fichierParLibelle.set(c.libelle, fichier);
    });
  }

  // reporte les noms de fichiers fabriqués dans les entrées de test correspondantes
  const resultatsFinaux = JSON.parse(JSON.stringify(resultats || {}));
  if (resultatsFinaux.campagne) assainirCampagne(resultatsFinaux.campagne);
  (resultatsFinaux.tests || []).forEach((t) => {
    (t.captures || []).forEach((c) => {
      const f = fichierParLibelle.get(c.libelle);
      if (f) c.fichier = f;
    });
  });

  fs.writeFileSync(path.join(dossier, 'resultats.json'), JSON.stringify(resultatsFinaux, null, 2));

  const MC_RAPPORT = opts.MC_RAPPORT || chargerRapport();
  const rapportHTML = MC_RAPPORT.html(resultatsFinaux, { capturesRel: 'captures/' });
  fs.writeFileSync(path.join(dossier, 'rapport.html'), rapportHTML);

  elaguer(racine);

  const rapportChemin = path.join(dossier, 'rapport.html');
  return {
    dossier: '/' + path.relative(RACINE, dossier).split(path.sep).join('/'),
    rapport: '/' + path.relative(RACINE, rapportChemin).split(path.sep).join('/'),
    dossierAbsolu: dossier,
  };
}

/* tests/rapport.js est un module UMD (pas CommonJS) : il s'accroche à
   `globalThis.MC_RAPPORT` plutôt que module.exports. On l'évalue une fois,
   en le mettant en cache, pour ne pas relire le fichier à chaque cahier. */
let _rapportCache = null;
function chargerRapport() {
  if (!_rapportCache) {
    const vm = require('vm');
    const ctx = vm.createContext({ console, Math, JSON, Date, Error, Number, String, Array, Object, Boolean });
    ctx.globalThis = ctx;
    vm.runInContext(fs.readFileSync(path.join(RACINE, 'tests', 'rapport.js'), 'utf8'), ctx, { filename: 'rapport.js' });
    _rapportCache = ctx.MC_RAPPORT;
  }
  return _rapportCache;
}

/* Un cahier marqué « conservé » (campagne.conserve === true, posé par
   tools/cahier.js --conserver ou la bibliothèque des cahiers, SPEC-BANC-018)
   n'est JAMAIS supprimé par la rotation, même au-delà de `max` — il ne
   compte pas non plus dans les N gardés, pour ne pas évincer un dossier
   récent légitime à sa place. */
function estConserve(racine, nom) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(racine, nom, 'resultats.json'), 'utf8'));
    return !!(j.campagne && j.campagne.conserve);
  } catch (e) { return false; }
}
function elaguer(racine, max) {
  if (!fs.existsSync(racine)) return;
  const limite = (max === undefined || max === null) ? MAX_DOSSIERS : max; // piège : `0 || X` vaudrait X, pas 0
  const dossiers = fs.readdirSync(racine, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ nom: d.name, t: fs.statSync(path.join(racine, d.name)).mtimeMs, conserve: estConserve(racine, d.name) }))
    .sort((a, b) => b.t - a.t);
  dossiers.filter((d) => !d.conserve).slice(limite).forEach((d) => fs.rmSync(path.join(racine, d.nom), { recursive: true, force: true }));
}

/* Valide et traite un envoi HTTP (SPEC-BANC-015) : `corps` est déjà du JSON
   parsé (`{ resultats, captures }`), `contexte` = { adresse, params,
   tailleOctets, limiteOctets? }. Ne touche jamais au réseau : c'est
   server.js qui lit la requête et lui passe la taille et l'adresse déjà
   connues, ce qui rend cette fonction testable avec de simples objets. */
function traiterEnvoi(corps, contexte) {
  const ctx = contexte || {};
  if (!estAdresseLocale(ctx.adresse)) return { ok: false, code: 403, motif: 'adresse non locale' };
  if (!peutRecevoirResultats(ctx.params)) return { ok: false, code: 403, motif: 'serveur dédié hors mode test (relancer avec --tests)' };
  const limite = ctx.limiteOctets || LIMITE_OCTETS_DEFAUT;
  if (typeof ctx.tailleOctets === 'number' && ctx.tailleOctets > limite) return { ok: false, code: 413, motif: 'corps trop volumineux' };
  if (!corps || typeof corps !== 'object' || !corps.resultats || typeof corps.resultats !== 'object') {
    return { ok: false, code: 400, motif: 'corps invalide : resultats manquant' };
  }
  const captures = Array.isArray(corps.captures) ? corps.captures.filter((c) => c && typeof c.base64 === 'string') : [];
  const r = ecrireCahier(corps.resultats, { captures });
  return { ok: true, code: 200, dossier: r.dossier, rapport: r.rapport, dossierAbsolu: r.dossierAbsolu };
}

module.exports = {
  estAdresseLocale, peutRecevoirResultats, slug, nomDossier, ecrireCahier, elaguer, traiterEnvoi,
  assainirCampagne, assainirChamp,
  DOSSIER_RESULTATS, MAX_DOSSIERS, LIMITE_OCTETS_DEFAUT, LIMITE_CHAMP,
};
