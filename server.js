/* server.js — serveur de jeu MiniCraft. Node pur, AUCUNE dépendance npm :
   WebSocket (RFC 6455) implémenté à la main, fichiers statiques servis par le
   même processus.

   Usage :  node server.js [port]

   Le serveur réutilise les MÊMES modules de logique que le client (world,
   entities, chat…). C'est la raison d'être de la séparation logique/rendu :
   sans elle, il faudrait réécrire la simulation côté serveur et les deux
   divergeraient au premier correctif. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

/* SPEC-SERVEUR-008 : le contexte S que server.js passe à chaque module du
   serveur (src/serveur-*.js, chargés comme les autres dans le contexte vm).
   Chaque module y lit ce dont il dépend et y publie ce dont les autres ont
   besoin ; S.hote porte ce que seul Node fournit — le contexte vm des modules
   n'a ni process, ni minuteries, ni Buffer, ni require.
   S.EP : l'état modifiable que plusieurs modules partagent (heure, pause, réseau…),
   lu et écrit à chaque tic. Toutes ses clés existent dès sa création : sa forme
   ne change jamais, ses accès restent aussi rapides qu'une variable (S, lui,
   reçoit près de 200 noms au fil des installations et passe en dictionnaire). */
const EP = {
  adressesActives: undefined, arretEnCours: undefined, crochetModification: undefined,
  dernier: undefined, dureeJeu: undefined, ecritureMondeInterdite: undefined,
  enPause: undefined, extrasSolo: undefined, guildesSales: undefined, heure: undefined,
  minuteurAbsence: undefined, nbEcritures: undefined, partieActive: undefined,
  pauseParAbsence: undefined, pauseRev: undefined, portActuel: undefined,
  prochainId: undefined, quetesCatastrophe: undefined, quetesJoueurs: undefined,
  reseauOuvert: undefined, sauvegardeArretee: undefined, sauvegardeEnCours: undefined,
  sauvegardeEnCoursAttente: undefined, soloJoueur: undefined, soloRecit: undefined,
};
const S = { hote: { process, Buffer, Promise, SyntaxError, URL, require, setTimeout, clearTimeout, setInterval, setImmediate, __filename, __dirname }, EP };

const RACINE = __dirname;

// ── paramètres de lancement (SPEC-PACK-002) ─────────────────────────────────
/* Compatibilité : l'ancien usage `node server.js 8080` (port positionnel,
   utilisé par les tests d'intégration existants) reste accepté — on le
   traduit en `--port 8080` avant l'analyse déclarative. */
const SANS_PARAMETRE = process.argv.slice(2).length === 0;   // SPEC-PACK-001 : ouvre le navigateur
let argvBrut = process.argv.slice(2);
if (argvBrut[0] && /^\d+$/.test(argvBrut[0])) argvBrut = ['--port', argvBrut[0], ...argvBrut.slice(1)];


// ── chargement des modules de logique pure ───────────────────────────────────
const MODULES = ['journal', 'core', 'formes', 'noise', 'biomes', 'densite', 'zones', 'volcanisme', 'souterrain', 'recifs', 'caravanes', 'donjons', 'habitats', 'routes', 'histoire', 'recits', 'carte', 'feu', 'meteo', 'lointain', 'world', 'circuits', 'lumiere', 'mesher', 'physics', 'faune', 'factions', 'inventory', 'conteneurs', 'vehicules',
                 'entities', 'player', 'synchro', 'travaux-serveur', 'daycycle', 'succes', 'save', 'saves', 'parties-fichier', 'modes',
                 'chat', 'commandes', 'split', 'contrats-vague2', 'contrats-archi', 'net-protocol', 'parametres', 'admin', 'politique', 'guildes', 'economie', 'metiers', 'pvp-enjeux', 'livre', 'livres', 'recit-serveur',
                 // SPEC-SERVEUR-008 : les modules du serveur, installés plus bas dans le contexte S
                 'serveur-journal', 'serveur-parties', 'serveur-etat', 'serveur-monde', 'serveur-sauvegarde',
                 'serveur-simulation', 'serveur-clients', 'serveur-http', 'serveur-banc', 'serveur-reseau', 'serveur-antiflood',
                 'serveur-messages', 'serveur-recit', 'serveur-admin', 'serveur-inventaire', 'serveur-succes', 'serveur-pose',
                 'serveur-vehicules', 'serveur-joueurs', 'serveur-tic'];

const ctx = vm.createContext(Object.assign(Object.create(null), {
  console, Math, JSON, Date, Error, Number, String, Array, Object, Boolean,
  Map, Set, Uint8Array, Float32Array, isNaN, isFinite, parseInt, parseFloat,
}));
ctx.globalThis = ctx;
MODULES.forEach(m => {
  vm.runInContext(fs.readFileSync(path.join(RACINE, 'src', m + '.js'), 'utf8'),
                  ctx, { filename: m + '.js' });
});
const MC = ctx.MC;
const NP = MC.NetProtocol;
const SY = MC.Synchro;
const C = MC.Core;

// ── journal (SPEC-BANC-104 à 110) ────────────────────────────────────────────
/* MC.Journal : le MÊME module que le client, chargé en premier dans le contexte
   vm. Tout message du serveur passe par lui (porte G16 : aucun console.*
   direct ici). Sa console garde EXACTEMENT le format historique — une ligne
   `[HH:MM:SS] texte` sur la sortie standard — que les tests d'intégration et
   les lanceurs lisent (« écoute : », MC_PORT=…) ; les autres domaines et
   niveaux y ajoutent leur nom (`[HH:MM:SS] CLIENT ERROR …`). Les lignes de
   protocole (`brut`) sortent telles quelles ; toute autre entrée passe par
   J.ligneSure : ses sauts de ligne sont indentés et ses caractères de
   contrôle retirés, si bien qu'aucun texte venu d'un joueur (nom, chat,
   remontée) ne peut fabriquer une ligne à lui (un faux `MC_PORT=`). */
const J = MC.Journal;
Object.assign(S, { http, fs, path, crypto, RACINE, argvBrut, NP, SY, C, J });
MC.ServeurJournal.installer(S);
const { logServeur, logLanceur, logSecret, sortieFichierJournal, DOSSIER_JOURNAL, journal } = S;

/* L'analyse elle-même est pure et testée sous Node (tests/spec-parametres.js) ;
   c'est ICI, et seulement ici, qu'une erreur ou --aide arrête le programme.
   La sortie fichier n'est branchée qu'APRÈS : `--aide` ne crée pas logs/ ;
   une erreur de paramètre, elle, y laisse sa trace (E-SERV-003). */
const analyse = MC.Parametres.analyser(argvBrut);
if (!analyse.ok) {
  if (analyse.code === 'aide') logLanceur.info(analyse.message, null, null, { brut: true });
  else {
    J.ajouterSortie(sortieFichierJournal(DOSSIER_JOURNAL));
    logLanceur.error(analyse.message, null, null, { brut: true, code: 'E-SERV-003' });
  }
  process.exit(analyse.code === 'aide' ? 0 : 1);
}
const PARAMS = analyse.config;
J.ajouterSortie(sortieFichierJournal(DOSSIER_JOURNAL));
// SPEC-BANC-109 : --journal SYNC:trace,SERVEUR:debug — niveaux par domaine dès le lancement
if (PARAMS.journal) {
  const r = J.regler(PARAMS.journal);
  if (!r.ok) logServeur.warn(`réglage --journal ignoré en partie : ${r.erreurs.join(', ')}`);
  /* LANCEUR porte MC_PORT= : le relever au-dessus de info rendrait le
     serveur muet pour son lanceur — refusé, il reste au défaut. */
  if (['warn', 'error', 'fatal', 'aucun'].indexOf(J.niveau('LANCEUR')) >= 0) {
    J.niveau('LANCEUR', null);
    logServeur.warn('réglage --journal LANCEUR au-dessus de info ignoré : MC_PORT= doit rester lisible par le lanceur');
  }
}

/* Commit courant (SPEC-BANC-012) : calculé UNE FOIS au démarrage, jamais par
   requête — `git rev-parse` par appel serait un coût inutile pour une valeur
   qui ne change pas tant que le serveur tourne. `null` hors dépôt git (par
   exemple une installation empaquetée sans .git), plutôt qu'une erreur — et
   en silence : git n'est même pas lancé sans .git (une archive dépaquetée
   sous un autre dépôt n'en prendrait pas le commit), et sa sortie d'erreur
   est ignorée (jamais de « fatal: not a git repository » au démarrage). */
let COMMIT_GIT = null;
if (fs.existsSync(path.join(RACINE, '.git'))) {
  try {
    COMMIT_GIT = require('child_process').execFileSync('git', ['rev-parse', '--short', 'HEAD'],
      { cwd: RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim() || null;
  } catch (e) { COMMIT_GIT = null; }
}

// ── état du monde, autoritatif ───────────────────────────────────────────────
const CONF = {
  graine: PARAMS.graine !== null ? PARAMS.graine : (parseInt(process.env.MC_GRAINE, 10) || 20260921),
  mode: process.env.MC_MODE || 'survie',
  difficulte: process.env.MC_DIFFICULTE || 'facile',
  /* Le serveur fait autorité : il simule les joueurs à partir de leurs
     entrées. On le fait tourner aussi vite que le client affiche, et l'on
     diffuse l'état à la même cadence : c'est ce qui rend la correction
     invisible. Réglables par MC_TICK_HZ et MC_ETAT_HZ. */
  tickHz: parseInt(process.env.MC_TICK_HZ, 10) || 60,
  etatHz: parseInt(process.env.MC_ETAT_HZ, 10) || 60,
  serveurSeul: PARAMS.serveurSeul,
  maxJoueurs: PARAMS.maxJoueurs,
  pvp: PARAMS.pvp,
  mondeFichier: PARAMS.monde ? path.resolve(RACINE, PARAMS.monde) : null,
};

// ── mode réseau et parties sur disque (chantier ARCHI, L50) ─────────────────
/* Techniquement c'est TOUJOURS le même serveur, que le poste joue seul (réseau
   FERMÉ : boucle locale uniquement), à plusieurs en écran partagé, ou avec
   jusqu'à 100 joueurs (réseau OUVERT). Seuls changent l'écoute, la liste
   d'origines, la pause (fermé seulement), la cadence de sauvegarde et la
   règle « un seul poste ». `--serveur` (serveur dédié) est toujours ouvert. */
const CA = MC.ContratsArchi;
EP.reseauOuvert = !!(PARAMS.ouvert || PARAMS.serveurSeul);
const RELANCE = process.env.MC_RELANCE === '1';       // lancé par une bascule de partie (relance interne)
const DOSSIER_PARTIES = path.resolve(RACINE, PARAMS.dossierParties);
/* MC_TEST_RACINE_STATIQUE : réglage de test (tests/integration-archi-securite.js), jamais en
   exploitation — les fichiers statiques se servent depuis ce dossier au lieu de celui du serveur. */
const RACINE_STATIQUE = process.env.MC_TEST_RACINE_STATIQUE ? path.resolve(process.env.MC_TEST_RACINE_STATIQUE) : null;
if (RACINE_STATIQUE) journal('ATTENTION : MC_TEST_RACINE_STATIQUE actif — fichiers statiques servis depuis ' + RACINE_STATIQUE + ' (réglage de test, jamais en exploitation)');
Object.assign(S, { PARAMS, COMMIT_GIT, CONF, CA, RELANCE, DOSSIER_PARTIES, RACINE_STATIQUE });
MC.ServeurParties.installer(S);
const { stockageParties, fichierMonde } = S;
EP.partieActive = null;                              // fiche d'index de la partie chargée, ou null
if (PARAMS.partie) {
  const meta = MC.PartiesFichier.idValide(PARAMS.partie) ? MC.Saves.trouver(stockageParties, PARAMS.partie) : null;
  if (!meta) {
    logLanceur.error(`partie inconnue : ${PARAMS.partie} (dossier ${DOSSIER_PARTIES})`, null, null, { brut: true, code: 'E-SERV-002' });
    process.exit(1);
  }
  EP.partieActive = meta;
  CONF.graine = meta.graine; CONF.mode = meta.mode; CONF.difficulte = meta.difficulte;
  CONF.mondeFichier = fichierMonde(meta.id);
}

// ── administration (SPEC-ADMIN-001 à 008) ───────────────────────────────────
/* Sans --admin, le serveur tire un jeton et l'affiche UNE fois au démarrage :
   jamais de console laissée sans protection, jamais de secret par défaut
   devinable. */
/* Une relance interne (changement de partie) hérite du jeton du processus précédent
   (variable d'environnement de l'enfant, jamais la ligne de commande) : le jeton
   affiché au premier lancement reste valable. */
const ADMIN_HERITE = !PARAMS.admin && RELANCE && process.env.MC_ADMIN_HERITE ? process.env.MC_ADMIN_HERITE : null;
const ADMIN_SECRET = PARAMS.admin || ADMIN_HERITE || MC.Admin.nouveauJeton('demarrage-', crypto.randomBytes);
const admin = MC.Admin.creerEtat({
  motDePasseAdmin: ADMIN_SECRET,
  listeBlancheActive: PARAMS.listeBlanche,
  emailObligatoire: false,
  generateurAleatoire: crypto.randomBytes,  // SPEC-SECU-009 : entropie cryptographique injectée, jamais Math.random
});
if (!PARAMS.admin && !ADMIN_HERITE) {
  // domaine SECRET : même ligne à la console, JAMAIS dans le fichier du journal (revue SPEC-BANC-106)
  logSecret.info(`aucun --admin fourni : jeton d'administration généré → ${ADMIN_SECRET}`);
  journal('conservez-le : il ne sera plus jamais affiché (relancez avec --admin=... pour le fixer)');
}

/* SPEC-ARCHI-041 : en mode histoire, les paramètres du récit (archétype, héros,
   longueur, interactions permises, commerce) sont ceux de la PARTIE chargée ;
   `MC_HISTOIRE` (JSON) est un réglage de test, sans partie (jamais en exploitation). */
let PARAMS_HISTOIRE = null;
if (CONF.mode === 'histoire') {
  let brutHistoire = EP.partieActive && EP.partieActive.histoire;
  if (!brutHistoire && process.env.MC_HISTOIRE) { try { brutHistoire = JSON.parse(process.env.MC_HISTOIRE); } catch (e) { brutHistoire = null; } }
  PARAMS_HISTOIRE = MC.RecitServeur.parametres(brutHistoire);
}
const regles = MC.Modes.regles(CONF.mode, CONF.difficulte, PARAMS_HISTOIRE);
Object.assign(S, { ADMIN_SECRET, admin, PARAMS_HISTOIRE, regles });
MC.ServeurEtat.installer(S);
const { monde } = S;
MC.ServeurMonde.installer(S);
const { etatMonde, appliquerEtatMonde } = S;
MC.ServeurSauvegarde.installer(S);
const { sauvegarderMondeAsync, sauvegarderMondeSync } = S;
MC.ServeurSimulation.installer(S);
MC.ServeurClients.installer(S);
const { clients, GRACE_ARRET_MS, armerAbsence } = S;
MC.ServeurHttp.installer(S);
const { cheminSur } = S;
MC.ServeurBanc.installer(S);
MC.ServeurReseau.installer(S);
const { ouvrirNavigateur, BOUCLE_LOCALE_TEST, demarrerEcoute, arreter } = S;
MC.ServeurAntiflood.installer(S);
MC.ServeurMessages.installer(S);
MC.ServeurRecit.installer(S);
MC.ServeurAdmin.installer(S);
MC.ServeurInventaire.installer(S);
MC.ServeurSucces.installer(S);
MC.ServeurPose.installer(S);
MC.ServeurVehicules.installer(S);
MC.ServeurJoueurs.installer(S);
MC.ServeurTic.installer(S);
setInterval(S.tic, 4);   // boucle de simulation (src/serveur-tic.js)
/* Diagnostic des e2e de jouabilité : une boucle d'évènements bloquée (le
   serveur ne tique plus, n'envoie plus d'ETAT, ne répond plus) est datée et
   chiffrée dans le journal, que le banc relit (GET /tests/serveur-jeu/journal). */
if (BOUCLE_LOCALE_TEST) {
  let attendu = Date.now() + 250;
  setInterval(() => {
    const retard = Date.now() - attendu;
    if (retard > 400) journal(`boucle bloquée ${retard} ms (joueurs ${clients.size}, chunks ${monde.chunks ? monde.chunks.size : '?'})`);
    attendu = Date.now() + 250;
  }, 250);
}

// ── démarrage ────────────────────────────────────────────────────────────────
demarrerEcoute().then(() => {
  journal(`MiniCraft — serveur sur http://localhost:${EP.portActuel}${EP.reseauOuvert ? ' (ouvert au réseau)' : ' (fermé au réseau : boucle locale seulement)'}`);
  journal(`écoute : ${EP.reseauOuvert ? 'toutes les interfaces' : EP.adressesActives.join(' et ')} · port ${EP.portActuel}`);
  journal(`graine ${CONF.graine} · mode ${CONF.mode} · difficulté ${CONF.difficulte}` + (EP.partieActive ? ` · partie « ${EP.partieActive.nom} » (${EP.partieActive.id})` : ''));
  journal(`simulation ${CONF.tickHz} Hz · diffusion d'état ${CONF.etatHz} Hz`);
  logLanceur.info(`MC_PORT=${EP.portActuel}`, null, null, { brut: true });   // lisible par un lanceur (SPEC-ARCHI-004)
  if (SANS_PARAMETRE && !CONF.serveurSeul) {
    journal('ouverture du navigateur…');
    ouvrirNavigateur(`http://localhost:${EP.portActuel}`);
  }
  // lancé par une bascule de partie : le navigateur doit se reconnecter, sinon on ne reste pas orphelin
  if (RELANCE && !EP.reseauOuvert) {
    // tant que le navigateur ne s'est pas reconnecté le monde attend (pause d'absence, levée à la reconnexion)
    EP.enPause = true; EP.pauseRev++; EP.pauseParAbsence = true;
    armerAbsence(Math.max(GRACE_ARRET_MS, 30000));
  }   // relance interne : le navigateur a le temps de se reconnecter
}).catch((e) => {
  const motif = e && e.code === 'EADDRINUSE'
    ? (PARAMS.portFixe ? `le port ${PARAMS.port} est déjà utilisé` : `aucun port libre entre ${PARAMS.port} et ${CA.BORNES.PORT_REPLI_MAX}`)
    : ((e && e.message) || String(e));
  logLanceur.fatal(`impossible de démarrer le serveur : ${motif}. Libérez le port ou lancez avec un autre --port.`, { motif }, e, { brut: true, code: 'E-SERV-001' });
  process.exit(1);
});
process.on('SIGINT', () => arreter('SIGINT'));
process.on('SIGTERM', () => arreter('SIGTERM'));

/* MC_TEST_ARRET_SI_MORT=<pid> : réservé aux suites d'intégration (même principe
   que MC_TEST_INV/MC_TEST_PANNE, désactivé par défaut, jamais en exploitation).
   Le serveur s'arrête de lui-même dès que ce processus (la suite de test qui l'a
   lancé) n'existe plus. La variable est héritée par la relance détachée d'une
   bascule de partie : un test interrompu (délai du crochet, plantage) ou dont le
   nettoyage échoue ne laisse plus de serveur --ouvert orphelin tourner à 60 Hz. */
if (process.env.MC_TEST_ARRET_SI_MORT) {
  const pidProprietaire = parseInt(process.env.MC_TEST_ARRET_SI_MORT, 10);
  if (pidProprietaire > 0) {
    setImmediate(() => journal('ATTENTION : MC_TEST_ARRET_SI_MORT actif — arrêt dès que le processus ' + pidProprietaire + ' disparaît (réglage de test, jamais en exploitation)'));
    setInterval(() => {
      let vivant = true;
      try { process.kill(pidProprietaire, 0); } catch (e) { vivant = e.code === 'EPERM'; }
      if (!vivant) arreter('propriétaire de test disparu');
    }, 2000);
  }
}

// ── résilience du processus (SPEC-SECU-002) ─────────────────────────────────
/* Une exception hors d'un handler de message (minuteur, promesse, callback
   d'E/S…) ne doit ni arrêter le serveur ni laisser une sauvegarde en cours
   à moitié écrite : on journalise, on tente une sauvegarde de secours
   (synchrone et atomique, comme à l'arrêt — l'état du processus n'inspire
   plus confiance, autant écrire vite et proprement plutôt qu'attendre le
   prochain tour de la boucle d'évènements), puis on continue de tourner. */
process.on('uncaughtException', (e) => {
  journal(`EXCEPTION NON RATTRAPÉE (le serveur continue) : ${(e && e.stack) || e}`);
  try { sauvegarderMondeSync(); } catch (e2) { journal('échec de la sauvegarde de secours : ' + e2.message); }
});
process.on('unhandledRejection', (raison) => {
  journal(`PROMESSE REJETÉE SANS GESTIONNAIRE (le serveur continue) : ${(raison && raison.stack) || raison}`);
});

/* Bascules de test réservées aux suites d'intégration (voir MC_TEST_PANNE
   plus haut) : provoquent une exception ASYNCHRONE, hors de tout handler de
   message, pour vérifier que les gestionnaires ci-dessus tiennent le coup. */
if (process.env.MC_TEST_PANNE_ASYNC === '1') {
  // MC_TEST_PANNE_ASYNC_MS : l'instant de la panne (défaut 200 ms), pour la placer pendant une sauvegarde asynchrone
  setTimeout(() => { throw new Error('panne asynchrone de test SPEC-SECU-002'); }, parseInt(process.env.MC_TEST_PANNE_ASYNC_MS, 10) || 200);
}
if (process.env.MC_TEST_PANNE_REJET === '1') {
  setTimeout(() => { Promise.reject(new Error('rejet de test SPEC-SECU-002')); }, 200);
}
/* MC_TEST_ARRET_MS : déclenche un arrêt PROPRE (la même fonction `arreter`
   qu'un vrai SIGINT/SIGTERM) après le délai donné, sans dépendre de l'envoi
   d'un signal — nécessaire pour tester la coordination sauvegarde
   async/sync (SPEC-SERVEUR-003/004) : `child_process.kill('SIGTERM')` sous
   Windows termine le processus SANS jamais invoquer `process.on('SIGTERM')`
   (aucun signal POSIX réel n'existe sous Windows), donc un test qui
   dépendrait de tuer le process depuis l'extérieur ne pourrait jamais
   exercer ce chemin de code sur cette plateforme. */
if (process.env.MC_TEST_ARRET_MS) {
  setTimeout(() => { arreter('test'); }, parseInt(process.env.MC_TEST_ARRET_MS, 10) || 0);
}

module.exports = { cheminSur, CONF, admin, ADMIN_SECRET, sauvegarderMondeSync, sauvegarderMondeAsync, appliquerEtatMonde, etatMonde };
