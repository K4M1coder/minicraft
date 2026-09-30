/* run.js — exécute les tests de logique pure sous Node, à partir du catalogue
   unique du lot L42 (tests/catalogue.js, tests/presets.js). Écrit à la fin de
   chaque campagne le cahier de test (SPEC-BANC-014) dans tests/resultats/.

   Sélection (SPEC-BANC-003/005), au choix, combinable (intersection) :
     node tests/run.js [filtre]           filtre positionnel historique (sous-chaîne du nom)
     node tests/run.js --preset commit    préréglage nommé (tests/presets.js)
     node tests/run.js --domaine A,B      un ou plusieurs domaines (SPEC-A-*, SPEC-B-*)
     node tests/run.js --type spec,unitaire
     node tests/run.js --groupe "Core — minage"
     node tests/run.js --test SPEC-MODE-001,"un nom exact"
     node tests/run.js --liste fichier.txt      un nom ou id par ligne
     node tests/run.js --echecs                 les échecs de la dernière campagne Node
     node tests/run.js --sauf etiquettes=lent    exclusion (répétable)
     node tests/run.js --lister                  affiche la sélection et les fiches, n'exécute rien
   Options d'exécution, conservées : --delai N, --silencieux.

   Les tests de type e2e SONT exécutés ici (SPEC-BANC-023/024/025) : dans un
   navigateur Edge/Chrome installé, sans fenêtre, piloté par CDP — voir
   tools/e2e-headless.js. Sans navigateur installé, ils sont ignorés avec un
   avertissement plutôt que de faire échouer la campagne (comportement
   nécessaire au préréglage `e2e-fumee`, ajouté au crochet pre-push).

   Préréglage `en-cours` (voir l'en-tête de tests/presets.js) : ses critères
   de base sont vides ; c'est CE fichier, seul à avoir accès à git et à
   SPECS.md par le disque, qui calcule les domaines à lui ajouter (specs ⏳
   plus domaines des fichiers src/ modifiés depuis la dernière étiquette,
   par correspondance de nom best-effort) avant l'appel à MC_TESTS.selection. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const option = (nom) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : null; };
const optionsToutes = (nom) => { const out = []; for (let i = 0; i < args.length; i++) if (args[i] === nom) out.push(args[i + 1]); return out; };
const drapeau = (nom) => args.includes(nom);
const silencieux = drapeau('--silencieux');
const SEUIL_LENT = 20;
/* Filet de sécurité contre un test qui ne rend JAMAIS la main (deadlock),
   PAS un couperet pour un test simplement lent (SPEC-BANC-010, révisé) : un
   test lent continue jusqu'à son vrai résultat (ok/échec), signalé au passage
   dans la zone des lents (SEUIL_LENT ci-dessus, un simple AVERTISSEMENT). Le
   délai reste coopératif (tests/harness.js T.etape()) : un test qui n'appelle
   jamais etape() ne peut pas être coupé — voir son commentaire. Généreux par
   construction (15 min) : seul un test qui boucle réellement sans fin doit
   jamais l'atteindre. */
const DELAI_TEST_MS_DEFAUT = 15 * 60 * 1000;

// ── --delai N : un processus parent surveille l'enfant qui exécute la suite ──
if (option('--delai') && !process.env.MC_RUN_ENFANT) {
  const { spawn } = require('child_process');
  const os = require('os');
  const etat = path.join(os.tmpdir(), 'mc-run-etat-' + process.pid + '.txt');
  const partiel = path.join(os.tmpdir(), 'mc-run-partiel-' + process.pid + '.json');
  const reste = args.filter((a, i) => a !== '--delai' && args[i - 1] !== '--delai');
  const enfant = spawn(process.execPath, [__filename, ...reste],
    { stdio: 'inherit', env: Object.assign({}, process.env, { MC_RUN_ENFANT: '1', MC_RUN_ETAT: etat, MC_RUN_PARTIEL: partiel }) });
  /* Filet d'INACTIVITÉ, pas de durée totale : la campagne grossit avec le
     dépôt (le préréglage pr dépasse désormais 15 min en tout) mais un test
     qui boucle réellement reste seul à ne plus faire avancer le fichier
     d'état, écrit au début de chaque test. */
  const debutParent = Date.now();
  const limite = setInterval(() => {
    let dernierSigne = debutParent;
    try { dernierSigne = Math.max(dernierSigne, fs.statSync(etat).mtimeMs); } catch (e) { /* pas encore écrit */ }
    if (Date.now() - dernierSigne < parseFloat(option('--delai')) * 1000) return;
    clearInterval(limite);
    let enCours = '(inconnu)';
    try { enCours = fs.readFileSync(etat, 'utf8'); } catch (e) { /* rien */ }
    enfant.kill();
    fs.writeSync(2, '\n✗ aucun progrès depuis ' + option('--delai') + ' s pendant : ' + enCours + '\n');
    // même interrompue, la campagne garde son cahier de test (SPEC-BANC-014) —
    // à partir du dernier instantané que l'enfant a écrit entre deux groupes
    try {
      const snap = JSON.parse(fs.readFileSync(partiel, 'utf8'));
      const RT = require('../tools/resultats-tests.js');
      snap.campagne.interrompue = true;
      snap.campagne.fin = new Date().toISOString();
      snap.campagne.duree_ms = Date.now() - Date.parse(snap.campagne.debut);
      const r = RT.ecrireCahier(snap);
      fs.writeSync(2, '  cahier (interrompu) : ' + r.rapport + '\n');
    } catch (e) { fs.writeSync(2, '  (pas d\'instantané exploitable pour le cahier interrompu : ' + e.message + ')\n'); }
    try { fs.unlinkSync(etat); } catch (e) { /* rien */ }
    try { fs.unlinkSync(partiel); } catch (e) { /* rien */ }
    process.exit(3);
  }, 5000);
  enfant.on('exit', (code) => {
    clearInterval(limite);
    try { fs.unlinkSync(etat); } catch (e) { /* rien */ }
    try { fs.unlinkSync(partiel); } catch (e) { /* rien */ }
    process.exit(code === null ? 3 : code);
  });
  return;
}
const SRC = ['core', 'formes', 'noise', 'biomes', 'densite', 'zones', 'volcanisme', 'souterrain', 'recifs', 'caravanes', 'donjons', 'habitats', 'routes', 'histoire', 'recits', 'carte', 'eau', 'feu', 'meteo', 'lointain', 'world', 'circuits', 'lumiere', 'ombres', 'succes', 'mesher', 'physics', 'file-chunks', 'taches-chunks', 'faune', 'factions', 'inventory', 'conteneurs', 'vehicules', 'metiers', 'economie',
             'entities', 'player', 'synchro', 'daycycle', 'save', 'saves', 'parties-fichier', 'poste', 'modes', 'chat', 'commandes', 'options', 'apparence', 'split', 'hud', 'gamepad', 'contrats-vague2', 'contrats-archi', 'net-protocol', 'parametres', 'admin', 'politique', 'guildes', 'pvp-enjeux', 'livre', 'livres', 'ambiance', 'audio', 'qualite'];
const TESTS = ['unit', 'functional', 'spec-modes', 'spec-saves', 'spec-audit', 'spec-armes', 'spec-chat', 'spec-split', 'spec-net', 'spec-secu', 'spec-ia-coll', 'spec-livre', 'spec-monde', 'spec-mer', 'spec-vehicules', 'spec-transport', 'spec-horizon', 'spec-climat', 'spec-habitats', 'spec-routes', 'spec-histoire', 'spec-succes', 'spec-ombres', 'spec-population', 'spec-hud', 'spec-couverture', 'spec-recits', 'spec-commandes', 'spec-portes', 'spec-eau', 'spec-vent', 'spec-loin', 'spec-donjons', 'spec-audio', 'spec-options', 'spec-souterrain', 'spec-apparence', 'spec-saisons', 'spec-parametres', 'spec-admin', 'spec-densite', 'spec-volcans', 'spec-caravanes', 'spec-economie', 'spec-metiers', 'spec-zones', 'spec-blocs16', 'spec-politique', 'spec-environnement', 'spec-guildes', 'spec-materiaux', 'spec-circuits', 'spec-objets', 'spec-formes', 'spec-recifs', 'spec-interieur', 'spec-batiments', 'spec-banc', 'spec-banc-headless',
             // exploration (lot perf) : sondes non bloquantes, @exploration — voir tests/catalogue.js
             'spec-perf', 'limites-sondes', 'spec-limites', 'spec-rendu', 'spec-maillage',
             // vague 2 : contrats figés partagés par B1 à B4 (docs/vague-2/)
             'spec-contrats-vague2', 'spec-contrats-archi', 'spec-parties-fichier', 'spec-poste', 'spec-archi-env', 'spec-workers',
             // vague 2 : B1 — inventaire et conteneurs serveur (SPEC-SYNC-007 à 017)
             'spec-conteneurs',
             // vague 2 : B4 — PvP, enjeux et sanctions (SPEC-PVP-001 à 006)
             'spec-pvp',
             // SPEC-BANC-010 (filet anti-blocage unifié) : crochets git, hors spec-banc.js
             'spec-crochets',
             // historique global (SPEC-BANC-033 à 040) : logique pure de tools/historique.js
             'spec-historique'];

/* `require`, `process`, `__dirname` : exposés UNIQUEMENT pour que
   tests/spec-banc.js (Node-only, voir son en-tête) puisse vérifier
   l'outillage lui-même — crochets, cahier de test, route serveur. Les
   modules de logique pure (src/*.js) n'en ont pas besoin et la porte G5 le
   leur interdirait de toute façon si un jour l'un d'eux s'en servait. */
const ctx = vm.createContext(Object.assign(Object.create(null), {
  console, Math, JSON, Date, Error, Number, String, Array, Object, Boolean,
  Map, Set, Uint8Array, Float32Array, isNaN, isFinite, parseInt, parseFloat,
  performance: { now: () => Date.now() },
  require, process, __dirname: path.join(root, 'tests'), Buffer,
}));
ctx.globalThis = ctx;

function loadInto(file) {
  const p = path.join(root, file);
  const code = fs.readFileSync(p, 'utf8');
  try {
    vm.runInContext(code, ctx, { filename: file });
  } catch (e) {
    console.error(`\n  Échec du chargement de ${file}\n  ${e.message}\n`);
    process.exit(2);
  }
}

loadInto('tests/harness.js');
SRC.forEach(f => loadInto(`src/${f}.js`));
loadInto('tests/presets.js');
loadInto('tests/catalogue.js');
loadInto('tests/rapport.js');
// certains fichiers de TESTS appartiennent à des lots en cours d'intégration
// (branches pas encore fusionnées) : on les ignore s'ils n'existent pas
// encore, plutôt que d'arrêter toute la suite pour un fichier qui arrive
TESTS.forEach((f) => {
  if (!fs.existsSync(path.join(root, `tests/${f}.js`))) return;
  ctx.T.fichierCourant = `tests/${f}.js`; loadInto(`tests/${f}.js`);
});
ctx.T.fichierCourant = null;

// ── e2e (texte seulement : jamais évalué sous Node) ─────────────────────────
/* On lit tests/e2e.js comme du TEXTE pour en tirer les noms des tests
   e2e(...) et une approximation de leur groupe — sans jamais évaluer le
   fichier, qui référence `window`/`document` dans ses fonctions. C'est
   délibérément découplé de la forme interne de tests/e2e.js (propriété de
   l'agent qui construit le banc navigateur) : seuls les littéraux passés à
   e2e(nom, fn) comptent.

   Un GROUPE (section) est un bandeau à TROIS lignes : une ligne de bordure
   `// ══…══`, un TITRE, puis une nouvelle bordure — voir les sections de
   tests/e2e.js. N'importe quel autre commentaire `//` NE marque PAS de
   groupe : un simple commentaire d'explication laissé au-dessus d'un
   e2e(...) (fréquent dans ce fichier, souvent une phrase entière se
   terminant par un point ou une virgule) ne doit jamais être pris pour un
   nom de section — sinon le catalogue affiche des groupes absurdes comme
   « et le rapport d'aspect de la caméra doit suivre, sinon l'image est
   étirée », qui est la fin d'un commentaire explicatif, pas un titre. */
/* Un appel `e2e(nom, { ... }, async function (g) {` porte sa fiche en 2e
   argument : un littéral d'OBJET JSON (clés et chaînes entre guillemets
   doubles, sans fonction ni expression) — c'est ce que produit
   JSON.stringify, la forme dans laquelle ces fiches sont écrites à la main.
   On le retrouve par comptage d'accolades (en ignorant celles à l'intérieur
   des chaînes) puis on le fait analyser par JSON.parse : jamais par eval,
   toujours en texte, comme le reste de cette fonction. */
function ficheLitteraleA(texte, depart) {
  let i = depart;
  while (i < texte.length && /\s/.test(texte[i])) i++;
  if (texte[i] !== '{') return null;
  let depth = 0, j = i, inStr = false, strCh = null, esc = false;
  for (; j < texte.length; j++) {
    const c = texte[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === strCh) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  try { return JSON.parse(texte.slice(i, j)); } catch (e) { return null; }
}

/* SPEC-BANC-066 : domaine DÉCLARÉ par groupe de bandeau e2e (voir
   e2eListeDepuisTexte ci-dessous) — SEULS les groupes qui contiennent au
   moins un test sans SPEC-* dans son nom ni fonction observable (e2e :
   jamais observé, voir docs/banc/historique-global.md §3.5) en ont besoin ;
   un groupe absent d'ici garde son comportement d'avant (domaine déduit du
   nom, ou aucun si le test a sa propre fiche à lui). Domaines honnêtes,
   cohérents avec ceux déjà utilisés par les tests Node du même thème
   (SPECS.md) — « Agriculture, fourneau, cycle » (MECA) est le bandeau le
   plus large : la détection de section de e2eListeDepuisTexte (bandeau à
   trois lignes) ne retrouve pas toujours une nouvelle section pour chaque
   sujet réellement distinct qu'il contient (villageois, torches, coffres,
   usure, chat, cycle jour/nuit…) — un domaine large mais vrai plutôt qu'un
   domaine précis mais faux pour un sous-thème qu'il ne couvre pas tous. */
const DOMAINE_PAR_GROUPE_E2E = {
  'Démarrage et états': ['MENU'],
  'Capture souris et pause  (les défauts signalés)': ['MENU'],
  'Déplacement réel dans la boucle': ['PHYS'],
  'Inventaire et craft par l\'interface': ['INVENTAIRE'],
  'Miner, poser, ramasser — dans la boucle réelle': ['BLOC'],
  'Combat et entités': ['COMBAT'],
  'Agriculture, fourneau, cycle': ['MECA'],
  'Sauvegarde': ['SAVE'],
  'HUD': ['HUD'],
  'Performance': ['PERF'],
};
function e2eListeDepuisTexte() {
  const fichier = path.join(root, 'tests', 'e2e.js');
  if (!fs.existsSync(fichier)) return [];
  const texte = fs.readFileSync(fichier, 'utf8');
  const lignes = texte.split('\n');
  // décalage (en caractères, dans `texte`) du début de chaque ligne — calculé
  // une fois, plutôt que de le tenir à jour au fil d'une boucle qui saute des
  // lignes par endroits (les bandeaux de section).
  const debutsLignes = new Array(lignes.length);
  { let acc = 0; for (let k = 0; k < lignes.length; k++) { debutsLignes[k] = acc; acc += lignes[k].length + 1; } }
  const out = [];
  let dernierGroupe = null;
  const reBordure = /^\s*\/\/\s*[─═]{5,}\s*$/;
  const reTitre = /^\s*\/\/\s*([^─═\s].{0,80}?)\s*$/;
  const reAppel = /^\s*e2e\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;
  for (let i = 0; i < lignes.length; i++) {
    if (reBordure.test(lignes[i]) && i + 2 < lignes.length) {
      const mt = reTitre.exec(lignes[i + 1]);
      if (mt && reBordure.test(lignes[i + 2])) {
        dernierGroupe = mt[1].trim();
        i += 2; // saute le titre et la bordure de fermeture : ni l'un ni l'autre n'est un appel e2e()
        continue;
      }
    }
    const ma = reAppel.exec(lignes[i]);
    if (ma) {
      let p = debutsLignes[i] + ma[0].length;
      while (p < texte.length && /[\s,]/.test(texte[p])) p++;
      const fiche = ficheLitteraleA(texte, p);
      const groupe = dernierGroupe || 'e2e';
      const entree = { nom: ma[2].replace(/\\(.)/g, '$1'), groupe, fichier: 'tests/e2e.js' };
      if (fiche) entree.fiche = fiche;
      // SPEC-BANC-066 : repli DÉCLARÉ par groupe (voir tests/catalogue.js,
      // e.ficheGroupe) — un domaine honnête pour un test qui n'a ni SPEC-*
      // dans son nom ni fonction observable (pas d'observation en e2e).
      if (DOMAINE_PAR_GROUPE_E2E[groupe]) entree.ficheGroupe = { domaines: DOMAINE_PAR_GROUPE_E2E[groupe] };
      out.push(entree);
    }
  }
  return out;
}

/* Les scripts tests/integration-*.js et tests/charge.js ne passent pas par
   describe/it (vrais processus, vraies sockets — voir leur propre en-tête) :
   chacun compte comme UNE entrée du catalogue (type 'integration' ou
   'charge'), exécutable en un lancement. C'est run.js, ici, qui sait les
   lancer (spawnSync) quand ils sont sélectionnés — voir plus bas. */
/* `domaines` (SPEC-BANC-066) : chaque script est UNE SEULE entrée de
   catalogue (pas de describe/it), donc jamais de SPEC-* dans son NOM —
   contrairement aux tests décrits DANS le fichier (qui, eux, en citent).
   Un domaine honnête par script, cohérent avec ce que dit sa fiche
   ci-dessus (network/admin/paquet/pvp/charge/banc/sécurité/sync). */
const FICHE_INTEGRATION = {
  'integration-net.js': { teste: 'Le protocole réseau (WebSocket, autorité serveur) sur de vraies sockets.', pourquoi: 'La logique réseau est testée unitairement ailleurs (src/net-protocol.js) ; ici, un vrai serveur et de vrais clients TCP vérifient qu\'elle fonctionne réellement en bout en bout.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.', domaines: ['RESEAU'] },
  'integration-admin.js': { teste: 'L\'administration et la persistance du serveur, sur un vrai processus server.js.', pourquoi: 'Rôles, jetons et sauvegarde du monde ne peuvent se vérifier qu\'avec un vrai serveur qui démarre, tourne et s\'arrête.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.', domaines: ['ADMIN'] },
  'integration-capacite.js': { teste: 'SPEC-SERVEUR-010 : maxJoueurs compte les JOUEURS réellement admis (écran partagé compris), pas les connexions, sur un vrai serveur.', pourquoi: 'server.js a des effets de bord au chargement (écoute immédiate) : jamais require() directement, comme le reste de la suite — seul un vrai processus lancé via spawn peut vérifier le refus/l\'admission d\'une équipe complète face à la capacité.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.', domaines: ['SERVEUR'] },
  'integration-paquet.js': { teste: 'Le lancement empaqueté du jeu (paramètres, ouverture du navigateur).', pourquoi: 'L\'empaquetage n\'est vérifiable qu\'en lançant réellement le programme avec différents arguments.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.', domaines: ['PAQUET'] },
  'integration-pvp.js': { teste: 'Le PvP, les zones de jeu et les factions, sur un vrai serveur avec plusieurs clients.', pourquoi: 'Les règles de zone et de faction combinent plusieurs joueurs réels ; un test unitaire ne peut pas simuler l\'ensemble.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.', domaines: ['PVP'] },
  'integration-quetes.js': { teste: 'L\'arbitrage réseau du tableau de quêtes par joueur (SPEC-QUETE-004) sur un vrai serveur : chat → traiterQuete → MC.Politique.', pourquoi: 'Le déterminisme des quêtes de faction est déjà couvert, pur, par tests/spec-politique.js ; seul le chemin réseau réel (traiterQuete) prouve que le serveur reste l\'arbitre et répond proprement, même sans quête proposée.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.', domaines: ['QUETE'] },
  'integration-charge.js': { teste: 'Le banc de charge, à petite échelle, pour vérifier qu\'il fonctionne.', pourquoi: 'Un banc de charge cassé donnerait une fausse confiance sur les performances mesurées ailleurs.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.', domaines: ['CHARGE'] },
  'integration-cahiers.js': { teste: 'La bibliothèque des cahiers de test (SPEC-BANC-018 à 022) sur un vrai serveur : enregistrement, liste, comparaison, export HTML/.docx.', pourquoi: 'Les routes /tests/cahiers combinent serveur HTTP, disque et rendu ; seul un vrai processus vérifie qu\'elles fonctionnent ensemble.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.', domaines: ['BANC'] },
  'integration-secu.js': { teste: 'La fiabilité et la sécurité du transport réseau (SPEC-SECU-001 à 007, SPEC-SERVEUR-003/004) sur de vrais processus server.js : pannes non fatales, trames non masquées, anti-flood, sauvegarde atomique sous coupure.', pourquoi: 'Try/catch autour des handlers, anti-flood et écriture atomique ne se vérifient qu\'avec un vrai serveur, de vraies sockets et de vraies interruptions de processus.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.', domaines: ['SECU'] },
  'integration-cdp-fake.js': { teste: 'Le client CDP minimal (SPEC-BANC-023, tools/cdp.js) contre un faux serveur WebSocket local : découverte, requête/réponse par id, événements relayés, délai, erreur CDP.', pourquoi: 'tests/harness.js (describe/it) est délibérément synchrone : une assertion qui échouerait dans un .then() ne serait jamais rapportée comme un échec de test. Le protocole CDP a besoin de vraies requêtes HTTP/WebSocket asynchrones, donc d\'un vrai script Node avec await, comme les autres tests/integration-*.js.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.', domaines: ['BANC'] },
  'integration-e2e-headless.js': { teste: 'Une vraie campagne e2e sans fenêtre (SPEC-BANC-023/024/025) : navigateur Edge/Chrome réel en mode sans interface, deux e2e exécutés, cahier écrit avec captures lisibles, aucun processus restant.', pourquoi: 'CDP, la détection du navigateur et le nettoyage garanti ne se vérifient qu\'avec un vrai navigateur lancé et arrêté pour de vrai — voir tools/cdp.js, tools/navigateur.js, tools/e2e-headless.js.', attendu: 'le script se termine sans échec (code de sortie 0) ; sans aucun Edge/Chrome installé, il s\'ignore avec un avertissement (code de sortie 0 aussi).', domaines: ['BANC'] },
  'charge.js': { teste: 'Le banc de charge complet (1 à 100 joueurs simulés).', pourquoi: 'Mesure la tenue en charge réelle du serveur — voir docs/charge.md.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.', domaines: ['CHARGE'] },
  'integration-inventaire.js': { teste: 'L\'inventaire, l\'équipement et la grille de fabrication serveur (B1, SPEC-SYNC-007 à 011, 014) sur un vrai serveur : MC_TEST_INV, CRAFT, EQUIP/EQUIP_VU, MANGER, INV_CONSOMMER, INV_LACHER, INV_CREATIF, idempotence du seq, reconnexion sous le même nom.', pourquoi: 'Le serveur devient la seule source de vérité pour l\'inventaire en ligne (docs/vague-2/B1.md) ; seul un vrai processus avec de vrais clients prouve que la prédiction/réconciliation et le registre des joueurs nommés fonctionnent ensemble.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.', domaines: ['SYNC'] },
  'integration-troc.js': { teste: 'Le commerce serveur-autoritaire (SPEC-SYNC-023) : consulter/échanger sur un vrai serveur, prix et trésors conservés après --monde arrêt/relance.', pourquoi: 'L\'arbitrage atomique d\'un troc (inventaire + stock + trésor) et sa persistance ne se vérifient qu\'avec un vrai serveur et de vrais clients.', attendu: 'le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par test.', domaines: ['SYNC'] },
  'integration-archi-serveur.js': { teste: "SPEC-ARCHI-001 à 011 : le serveur local fermé au réseau (liaison 127.0.0.1 et ::1, Origin, port stable, un seul poste, réseau ouvert/fermé à chaud, pause exacte et reprise sans rattrapage), sur de vrais processus server.js.", pourquoi: "Liaison réseau, en-têtes de poignée de main, ouverture à chaud et gel de la boucle de simulation ne se vérifient qu'avec un vrai processus et de vraies sockets, y compris depuis l'adresse réseau de la machine.", attendu: "le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par vérification.", domaines: ['ARCHI'] },
  'integration-archi-sauvegarde.js': { teste: "SPEC-ARCHI-008 et 012 : arrêt propre (ARRET local, dernier client parti, délai de grâce, mode ouvert jamais terminé) et sauvegardes du monde (évènements, cadence de 45 s, omission quand rien n'a changé).", pourquoi: "Les délais (10 s, 45 s), l'écriture du fichier et la terminaison du processus n'existent que dans un vrai serveur qui tourne ; un test pur ne peut ni mesurer la cadence ni vérifier qu'aucun processus n'est laissé orphelin.", attendu: "le script se termine sans échec (code de sortie 0) — compter environ 100 s (la cadence de 45 s est mesurée deux fois).", domaines: ['ARCHI'], etiquettes: ['lent'] },
  'integration-archi-parties.js': { teste: "SPEC-ARCHI-013 à 015 : les parties sur disque (créer, charger, changer de partie et revenir, renommer, supprimer par l'API réservée à la boucle locale), l'import de parties solo existantes et la persistance du joueur (position, vie, faim, inventaire) à travers un arrêt/relance, sur de vrais processus server.js.", pourquoi: "Le changement de partie relance le processus serveur sur le même port et les fichiers de monde sont écrits par le vrai serveur : seuls un vrai processus et un vrai disque peuvent le prouver.", attendu: "le script se termine sans échec (code de sortie 0) — voir son propre journal pour le détail par vérification.", domaines: ['ARCHI'] },
  'integration-archi-client.js': { teste: "SPEC-ARCHI-005, 006, 008, 009, 013, 015, 016, 017 et 039 : la page du jeu (index.html) face à son serveur local dans un vrai navigateur — écran d'attente à étapes, erreur au bout de 15 s si le serveur est bloqué, écran d'explication sans serveur de jeu (serveur de fichiers, file://), menu des parties servi par le serveur, import des parties du navigateur, pause qui suit les menus (jamais l'inventaire), réseau ouvert/fermé depuis le menu, « Quitter le jeu ».", pourquoi: "Le câblage DOM ↔ poste ↔ serveur (pause émise sur les changements d'état, écrans d'attente et d'erreur, boutons) ne se vérifie que dans un vrai navigateur face à un vrai serveur ; les fakes de tests/spec-poste.js ne prouvent que la logique.", attendu: "le script se termine sans échec (code 0), ou s'ignore avec un avertissement quand aucun navigateur Edge/Chrome n'est installé.", domaines: ['ARCHI'], etiquettes: ['lent'] },
  'integration-archi-budgets.js': { teste: "SPEC-ARCHI-012, 017 et 018 : les bancs de sérialisation d'une sauvegarde, de démarrage du serveur et de latence locale (ping, ENTREE→ETAT, 1 puis 4 joueurs), en version rapide, contre les seuils de tests/budget-perf.json.", pourquoi: "Ces budgets n'ont de sens que mesurés sur un vrai serveur qui tourne ; les bancs complets (tests/bench-*.js) sont trop longs pour une campagne ordinaire, cette version réduite prouve qu'ils fonctionnent et que les seuils tiennent.", attendu: "le script se termine sans échec (code 0) ; chaque banc refait sa mesure une fois avant de conclure à un dépassement (variance machine).", domaines: ['ARCHI'], etiquettes: ['lent'] },
  'integration-archi-securite.js': { teste: "SPEC-ARCHI-003, 005, 008 et 013 (durcissement après revue) : en mode ouvert une page tierce (Origin ou Host étranger, mandataire) ne peut ni arrêter le serveur ni fermer le réseau ; un serveur dédié reste ouvert ; l'index et les fichiers de parties ne se servent jamais en statique ; le Host local est exigé sur l'API et, en fermé, sur tout le HTTP.", pourquoi: "Ces protections portent sur des en-têtes et des adresses de vraies connexions TCP : seul un vrai serveur ouvert, attaqué par de vraies sockets, le prouve.", attendu: "le script se termine sans échec (code 0).", domaines: ['ARCHI'] },
  'integration-archi-env.js': { teste: "SPEC-ARCHI-022, 024, 025, 034 et 035 (lot B-ENV), SPEC-SYNC-018 et 019 : tornades qui poussent et éclairs qui blessent par le serveur, habitants des lieux reçus comme créatures, sommeil collectif (solo, deux postes, écran partagé, départ du seul éveillé), /jour et /nuit refusés hors créatif sauf administrateur, apparitions et gardiens de donjon décidés par le serveur, cultures qui croissent par BLOC (vues par deux clients) et se figent en pause, feu qui vieillit et s'éteint devant tous les clients, fabrication par CRAFT en solo fermé.", pourquoi: "Le client ne simule plus ces aléas : seule une vraie boucle serveur, avec de vrais clients WebSocket, prouve que le comportement existe encore quelque part et qu'il est identique en solo fermé, en écran partagé et en mode ouvert.", attendu: "le script se termine sans échec (code 0) — compter quelques minutes (apparitions et cultures attendent le monde).", domaines: ['ARCHI'], etiquettes: ['lent'] },
  'integration-archi-robustesse.js': { teste: "SPEC-ARCHI-005, 008, 010, 012, 013 et 015 (corrections après revue) : pause qui gèle aussi le fourneau et refuse manger/fabriquer/équiper/lâcher/palette/conteneurs/renaître, échec de la bascule réseau à chaud sans effet de bord (et arrêt propre si la liaison précédente est perdue), suppression de la partie active pendant une sauvegarde en vol, relance en pause avec jeton admin conservé, socket muette qui ne retarde pas l'arrêt, import qui échoue sans orphelin.", pourquoi: "Ces comportements dépendent de l'ordre réel des évènements d'un vrai processus (écouteurs, écritures disque asynchrones, relance détachée) ; seuls de vrais serveurs, avec des points d'échec simulés par variables d'environnement de test, les exercent.", attendu: "le script se termine sans échec (code 0).", domaines: ['ARCHI'], etiquettes: ['lent'] },
  'integration-archi-inv.js': { teste: "SPEC-ARCHI-030 à 033, SPEC-SYNC-026 et 028 (lot B-INV) : conteneurs posés, fourneau qui cuit fenêtre fermée et banque par CONTENEUR_ETAT, manger/jeter/poser/tirer payés sur l'inventaire du serveur (aucun bloc ni tir gratuit, débit unique malgré le journal du client), commerce par TROC et bloc de commande (hôte local en créatif accepté, survie et client distant refusés), le tout sur un serveur fermé au réseau, plus l'audit statique de src/game.js.", pourquoi: "Ces règles n'existent que dans un vrai serveur qui tourne : le contrôle de possession, l'absorption du journal, la cuisson hors fenêtre et la distinction hôte local / client distant dépendent de vraies sockets et d'un vrai processus ; le mode créatif et le réseau ouvert exigent des serveurs lancés avec des réglages différents.", attendu: "le script se termine sans échec (code de sortie 0) — compter environ 1 minute (la cuisson d'un fourneau dure 6 s de jeu).", domaines: ['ARCHI', 'SYNC'], etiquettes: ['lent'] },
};
function integrationListeDepuisFichiers() {
  return fs.readdirSync(path.join(root, 'tests'))
    .filter(f => /^integration-.*\.js$/.test(f) || f === 'charge.js')
    .map(f => ({ nom: f + ' (intégration)', groupe: f, fichier: 'tests/' + f, type: f === 'charge.js' ? 'charge' : 'integration', fiche: FICHE_INTEGRATION[f] }));
}

const specsTexte = fs.readFileSync(path.join(root, 'SPECS.md'), 'utf8');
const specsIndex = ctx.MC_TESTS.indexSpecs(specsTexte);
const e2eListe = e2eListeDepuisTexte().concat(integrationListeDepuisFichiers());
const catalogue = ctx.MC_TESTS.construire(ctx.T, e2eListe, specsIndex);

// ── construction des critères à partir des options de la ligne de commande ──
function virgule(v) { return v ? v.split(',').map(s => s.trim()).filter(Boolean) : []; }
function ajouter(criteres, cle, valeurs) {
  if (!valeurs || !valeurs.length) return;
  criteres[cle] = (criteres[cle] || []).concat(valeurs);
}
function domainesDeFichiersModifies(fichiers, domainesConnus) {
  const bases = fichiers.map(f => path.basename(f, '.js').toUpperCase().replace(/[^A-Z0-9]/g, ''));
  return domainesConnus.filter(d => bases.some(b => b.indexOf(d) >= 0 || d.indexOf(b) >= 0));
}
function calculerEnCours() {
  const domainesConnus = Array.from(new Set(catalogue.reduce((a, t) => a.concat(t.domaines), [])));
  const domaines = new Set();
  Object.keys(specsIndex).forEach((id) => {
    if (specsIndex[id].etat === '⏳') { const m = /^SPEC-([A-Z0-9]+)-/.exec(id); if (m) domaines.add(m[1]); }
  });
  try {
    const etiquette = execSync('git describe --tags --abbrev=0 --match "v[0-9]*"', { cwd: root, encoding: 'utf8' }).trim();
    const fichiers = execSync('git diff --name-only ' + etiquette + '..HEAD -- src/', { cwd: root, encoding: 'utf8' })
      .split('\n').filter(Boolean);
    domainesDeFichiersModifies(fichiers, domainesConnus).forEach(d => domaines.add(d));
  } catch (e) { /* pas d'étiquette, ou hors dépôt git : on se limite aux specs ⏳ */ }
  return Array.from(domaines);
}

function critereDepuisArgs() {
  const c = {};
  ajouter(c, 'domaines', virgule(option('--domaine')));
  ajouter(c, 'types', virgule(option('--type')));
  ajouter(c, 'groupes', virgule(option('--groupe')));
  ajouter(c, 'tests', virgule(option('--test')));
  const fichierListe = option('--liste');
  if (fichierListe) {
    const contenu = fs.readFileSync(fichierListe, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
    ajouter(c, 'liste', contenu);
  }
  if (drapeau('--echecs')) {
    const dernier = dernierResultatsNode();
    ajouter(c, 'echecs', dernier ? dernier.tests.filter(t => t.etat !== 'ok').map(t => t.nom) : []);
    if (!dernier) console.error('(--echecs : aucun résultat Node précédent trouvé dans tests/resultats/)');
  }
  optionsToutes('--sauf').forEach((val) => {
    if (!val || val.indexOf('=') < 0) return;
    const [cle, v] = [val.slice(0, val.indexOf('=')), val.slice(val.indexOf('=') + 1)];
    c.sauf = c.sauf || {};
    ajouter(c.sauf, cle, virgule(v));
  });
  return c;
}
function dernierResultatsNode() {
  const RT = require('../tools/resultats-tests.js');
  const racine = RT.DOSSIER_RESULTATS;
  if (!fs.existsSync(racine)) return null;
  const dossiers = fs.readdirSync(racine, { withFileTypes: true }).filter(d => d.isDirectory())
    .map(d => ({ nom: d.name, t: fs.statSync(path.join(racine, d.name)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const d of dossiers) {
    const p = path.join(racine, d.nom, 'resultats.json');
    if (fs.existsSync(p)) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { /* corrompu, suivant */ } }
  }
  return null;
}

const nomPreset = option('--preset');
let criteres = critereDepuisArgs();
// étiquette de campagne (sert de nom de dossier, SPEC-BANC-014) : le
// préréglage s'il y en a un, sinon la première option de sélection nommée,
// sinon 'tout'
function etiquetteDepuisCriteres(c) {
  const cles = ['domaines', 'types', 'groupes', 'tests', 'liste', 'echecs'];
  for (const k of cles) if (c[k] && c[k].length) return k + '-' + c[k].join('+');
  return null;
}
/* Sans AUCUN critère de sélection (ni préréglage, ni --domaine/--type/…, ni
   filtre positionnel), le comportement historique reste : unitaire +
   fonctionnel + spec seulement. Sans ce repli, un `selection(catalogue, {})`
   vide sélectionnerait TOUT le catalogue — e2e (inexécutable sous Node) ET
   intégration/charge (de vrais processus, dont charge.js qui peut tourner
   plusieurs minutes) — ce qu'aucun appel nu à `node tests/run.js` n'attend. */
const AUCUN_CRITERE_EXPLICITE = !nomPreset && !Object.keys(criteres).some(k => k !== 'sauf' && criteres[k] && criteres[k].length);
if (AUCUN_CRITERE_EXPLICITE) criteres = { types: ['unitaire', 'fonctionnel', 'spec'] };
let etiquetteCampagne = nomPreset || etiquetteDepuisCriteres(criteres) || 'tout';
if (nomPreset) {
  const presetDef = (ctx.MC_TESTS.PRESETS || []).find(p => p.nom === nomPreset);
  if (!presetDef) {
    console.error('préréglage inconnu : ' + nomPreset + ' — connus : ' + (ctx.MC_TESTS.PRESETS || []).map(p => p.nom).join(', '));
    process.exit(2);
  }
  const base = JSON.parse(JSON.stringify(presetDef.criteres || {}));
  if (presetDef.dynamique === 'en-cours') ajouter(base, 'domaines', calculerEnCours());
  Object.keys(criteres).forEach((k) => {
    if (k === 'sauf') { base.sauf = base.sauf || {}; Object.keys(criteres.sauf).forEach(kk => ajouter(base.sauf, kk, criteres.sauf[kk])); }
    else ajouter(base, k, criteres[k]);
  });
  criteres = base;
}
// filtre positionnel historique : traité comme --test/--groupe par SOUS-CHAÎNE
// (compatibilité) — géré séparément, il ne passe pas par MC_TESTS.selection
const filtrePositionnel = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--')) || null;

let selection = ctx.MC_TESTS.selection(catalogue, criteres);
if (filtrePositionnel) {
  selection = selection.filter(t => t.groupe.indexOf(filtrePositionnel) >= 0 || t.nom.indexOf(filtrePositionnel) >= 0);
  if (!nomPreset) etiquetteCampagne = filtrePositionnel;
}

// ── --lister : affiche la sélection et les fiches, n'exécute rien ──────────
if (drapeau('--lister')) {
  selection.forEach((t) => {
    console.log(`[${t.type}] ${t.groupe} :: ${t.nom}`);
    if (t.fiche) console.log(`    teste: ${t.fiche.teste}\n    pourquoi: ${t.fiche.pourquoi}\n    attendu: ${t.fiche.attendu}`);
    else console.log('    (aucune fiche)');
    // SPEC-BANC-066 (G14 étendue) : domaines et fonctions DÉCLARÉES, sur
    // leur propre ligne reconnaissable — gates.js les relit en texte, comme
    // il le fait déjà pour « (aucune fiche) ». Les fonctions OBSERVÉES ne
    // sont connues qu'à l'exécution (voir plus haut) : --lister n'exécute
    // rien, il ne peut donc voir QUE les fonctions déclarées.
    console.log(`    domaines: ${(t.domaines || []).join(',') || '(aucun)'}`);
    console.log(`    fonctions: ${(t.fonctions || []).join(',') || '(aucune declaree)'}`);
  });
  console.log(`\n${selection.length} test(s) sélectionné(s) sur ${catalogue.length} au catalogue.`);
  process.exit(0);
}

const e2eSelectionnes = selection.filter(t => t.type === 'e2e');
const integrationSelectionnes = selection.filter(t => t.type === 'integration' || t.type === 'charge');
const aExecuter = selection.filter(t => t.type !== 'e2e' && t.type !== 'integration' && t.type !== 'charge');
let ignoresE2E = 0;
let environnementE2E = null;
let capturesGlobalesE2E = [];

// ── exécution ────────────────────────────────────────────────────────────
const ecrire = (t) => { if (!silencieux) fs.writeSync(2, t + '\n'); };
const fichierEtat = process.env.MC_RUN_ETAT || null;
const fichierPartiel = process.env.MC_RUN_PARTIEL || null;
const debutISO = new Date().toISOString();
const debut = Date.now();
const secondes = (ms) => (ms / 1000).toFixed(1) + ' s';
/* Capturé AU DÉBUT de la campagne (docs/banc/historique-global.md §3.4) :
   si le dépôt a des modifications non commitées à cet instant, le commit
   cité par cette campagne (HEAD) ne correspond pas exactement au code
   réellement testé — tools/registre.js le reporte tel quel dans le registre
   (`arbre_modifie`) au moment de l'inscription, jamais recalculé après
   coup (l'arbre peut avoir changé entretemps). */
let arbreModifieAuDebut = false;
try { arbreModifieAuDebut = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }).trim().length > 0; }
catch (e) { /* hors dépôt : tant pis, jamais bloquant */ }

// entrées resultats.json construites au fil de l'eau (SPEC-BANC-014), pour
// pouvoir écrire un instantané entre deux groupes même si la campagne est
// interrompue par --delai
const testsResultats = [];
const infoDe = (id) => catalogue.find(t => t.id === id) || null;
function ecrireInstantane() {
  if (!fichierPartiel) return;
  try {
    fs.writeFileSync(fichierPartiel, JSON.stringify({
      schema: 1,
      campagne: { preset: etiquetteCampagne, criteres, debut: debutISO, arbreModifie: arbreModifieAuDebut, environnement: environnement() },
      tests: testsResultats,
    }));
  } catch (e) { /* au pire, pas d'instantané : le cahier final restera complet si la campagne va au bout */ }
}

function environnement() {
  let commit = null;
  try { commit = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim(); } catch (e) { /* hors dépôt */ }
  let versionJeu = null;
  try { versionJeu = /var VERSION_JEU = '([^']+)'/.exec(fs.readFileSync(path.join(root, 'src', 'core.js'), 'utf8'))[1]; } catch (e) { /* rien */ }
  return { source: 'node', versionJeu, commit, node: process.version };
}

/* SPEC-BANC-062 : observation des fonctions RÉELLEMENT appelées, en
   exécution Node — les fonctions exportées de chaque module `MC.<Module>`
   sont enveloppées UNE FOIS ici (après le chargement de src/*.js, avant la
   première exécution de test) ; l'enveloppe compte un appel, qualifié
   `MC.<Module>.<fonction>`, SEULEMENT pendant la fenêtre `actif.v = true`
   que `debutTest`/`finTest` ouvrent et referment ci-dessous — un appel fait
   PENDANT le chargement (hors de tout test) ne compte jamais. Désactivable
   par `--sans-fonctions` (test qui préfère éviter le coût de l'enveloppe) ;
   le budget de performance (G12, tests/gates.js) tourne dans des PROCESSUS
   SÉPARÉS (bench-generation.js/bench-maillage.js, `require` direct, jamais
   ce contexte vm) — il ne voit donc jamais cette enveloppe, sans rien à
   faire de spécial ici pour l'en protéger. */
function envelopperFonctions(vmCtx) {
  const MCns = vmCtx.MC;
  const compteur = Object.create(null);
  const actif = { v: false };
  // `entrees` : un {obj, cle, orig, enveloppe} par fonction enveloppée — sert
  // à RESTAURER l'original (pas seulement couper le comptage) pour un test
  // `budget-perf` (voir restaurer/reenvelopper ci-dessous). `actif.v = false`
  // seul économise le comptage mais PAS l'indirection d'appel elle-même
  // (une frame de plus + Function.prototype.apply) : mesuré, cette
  // indirection à elle seule ajoute plusieurs ms sur un test qui enchaîne
  // des dizaines de milliers d'appels bon marché (génération de chunk),
  // assez pour faire dépasser un budget de temps serré (SPEC-PERF-001) —
  // d'où la restauration complète, pas un simple drapeau, pour CE cas précis.
  const entrees = [];
  function enveloppeDe(qualifie, orig) {
    return function () {
      if (actif.v) compteur[qualifie] = (compteur[qualifie] || 0) + 1;
      return orig.apply(this, arguments);
    };
  }
  if (MCns) {
    Object.keys(MCns).forEach((cle) => {
      const val = MCns[cle];
      // certains modules exposent une fabrique DIRECTEMENT sur MC (un seul
      // niveau : `MC.makeNoise`, `MC.createWorld`…), pas seulement à travers
      // un espace `MC.<Module>.<fn>` — sans ce cas, aucun appel à ces
      // fabriques n'est jamais observé (constaté : tests du bruit procédural).
      if (typeof val === 'function') {
        const env = enveloppeDe('MC.' + cle, val);
        MCns[cle] = env;
        entrees.push({ obj: MCns, cle, orig: val, enveloppe: env });
        return;
      }
      if (!val || typeof val !== 'object') return;
      Object.keys(val).forEach((fnName) => {
        const orig = val[fnName];
        if (typeof orig !== 'function') return;
        const env = enveloppeDe('MC.' + cle + '.' + fnName, orig);
        val[fnName] = env;
        entrees.push({ obj: val, cle: fnName, orig, enveloppe: env });
      });
    });
  }
  function restaurer() { entrees.forEach(e => { e.obj[e.cle] = e.orig; }); }
  function reenvelopper() { entrees.forEach(e => { e.obj[e.cle] = e.enveloppe; }); }
  return { compteur, actif, restaurer, reenvelopper };
}
/* Surcoût MESURÉ (pas estimé) de l'enveloppe : chronomètre N appels d'une
   fonction de référence pure et bon marché (MC.Core.isSolid) AVANT
   l'enveloppement, puis la MÊME fonction (relue depuis `ctx.MC`, car
   l'enveloppement REMPLACE la propriété) APRÈS — la différence relative
   est le coût réel d'un passage par l'enveloppe pour ce dépôt, sur cette
   machine, affiché à chaque campagne plutôt que documenté à la main (donc
   jamais périmé). */
function chronoAppels(fn, n) {
  if (typeof fn !== 'function') return null;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) fn(0, 0, 0);
  return Number(process.hrtime.bigint() - t0) / 1e6;
}
const sansFonctions = drapeau('--sans-fonctions');
const N_CALIBRATION = 200000;
const avantEnveloppe = chronoAppels(ctx.MC && ctx.MC.Core && ctx.MC.Core.isSolid, N_CALIBRATION);
const observateurFonctions = sansFonctions ? null : envelopperFonctions(ctx);
let surcoutFonctions = null;
if (!sansFonctions && avantEnveloppe !== null) {
  const apresEnveloppe = chronoAppels(ctx.MC.Core.isSolid, N_CALIBRATION);
  const pct = avantEnveloppe > 0 ? ((apresEnveloppe - avantEnveloppe) / avantEnveloppe) * 100 : 0;
  surcoutFonctions = { fonctionReference: 'MC.Core.isSolid', appels: N_CALIBRATION, avant_ms: avantEnveloppe, apres_ms: apresEnveloppe, surcout_pct: pct };
  ecrire('(observation des fonctions active — surcoût mesuré ' + pct.toFixed(1) + ' % sur ' + N_CALIBRATION + ' appels de référence : ' +
    avantEnveloppe.toFixed(1) + ' ms → ' + apresEnveloppe.toFixed(1) + ' ms ; --sans-fonctions pour désactiver)');
} else if (sansFonctions) {
  ecrire('(observation des fonctions désactivée : --sans-fonctions)');
}

const nomsAExecuter = aExecuter.map(t => t.nom);
const res = ctx.T.run(nomsAExecuter, {
  debutGroupe: (nom, n) => ecrire('▶ ' + nom + ' (' + n + ' test' + (n > 1 ? 's' : '') + ')'),
  debutTest: (groupe, nom) => {
    if (fichierEtat) try { fs.writeFileSync(fichierEtat, groupe + ' › ' + nom); } catch (e) { /* rien */ }
    if (observateurFonctions) {
      Object.keys(observateurFonctions.compteur).forEach(k => delete observateurFonctions.compteur[k]);
      const cat = catalogue.find(c => c.groupe === groupe && c.nom === nom);
      // SPEC-BANC-062 : un test qui mesure un budget de TEMPS (millisecondes)
      // n'a de sens que SANS l'enveloppe (comme G12, tests/gates.js, qui
      // tourne dans un processus séparé pour la même raison) — étiquette
      // `budget-perf` (tests/spec-perf.js, tests/spec-ombres.js) : les
      // fonctions sont RESTAURÉES (pas seulement le comptage coupé) pour ce
      // test précis, car l'indirection d'appel elle-même a un coût mesurable
      // sur un budget serré (voir le commentaire d'envelopperFonctions) ;
      // remises en place par finTest, sans rien changer pour le reste de la
      // campagne.
      const budgetPerf = cat && (cat.etiquettes || []).indexOf('budget-perf') >= 0;
      if (budgetPerf) observateurFonctions.restaurer(); else observateurFonctions.actif.v = true;
    }
  },
  etape: (groupe, nom, libelle, n, total) => ecrire('    ↳ ' + nom + ' — ' + libelle + (n ? ' (' + n + (total ? '/' + total : '') + ')' : '')),
  finTest: (groupe, nom, ok, ms, detail) => {
    if (observateurFonctions) { observateurFonctions.actif.v = false; observateurFonctions.reenvelopper(); }
    if (ms > SEUIL_LENT * 1000) ecrire('  ⚠ lent (' + secondes(ms) + ') : ' + nom);
    const cat = catalogue.find(c => c.groupe === groupe && c.nom === nom);
    // fusion (SPEC-BANC-062) : fonctions DÉCLARÉES (fiche) ∪ OBSERVÉES (cette
    // exécution) — dédupliquées, sans jamais perdre une déclaration que
    // l'observation, elle, n'aurait pas vue passer (chemin non emprunté cette fois).
    const declarees = cat ? (cat.fonctions || []) : [];
    // SPEC-BANC-062 : compteur d'appels par fonction observée (ex. « un test
    // appelant MC.Mesher.tileOrigin fait apparaître … avec un compteur
    // d'appels ≥ 1 ») — hors du schéma `fonctions` du registre (liste de
    // noms, docs/banc/historique-global.md §1), donc un champ à part,
    // propre au cahier Node, plutôt qu'une migration de ce schéma déjà
    // documenté et consommé ailleurs.
    const fonctionsAppels = observateurFonctions ? Object.assign({}, observateurFonctions.compteur) : {};
    const observees = Object.keys(fonctionsAppels);
    const fonctions = Array.from(new Set(declarees.concat(observees)));
    testsResultats.push({
      id: cat ? cat.id : nom, nom, type: cat ? cat.type : 'unitaire', groupe,
      domaines: cat ? cat.domaines : [], specs: cat ? cat.specs : [], fiche: cat ? cat.fiche : null,
      etiquettes: cat ? cat.etiquettes : [], fonctions, fonctionsAppels,
      etat: ok ? 'ok' : (detail && detail.delai ? 'delai' : 'echec'), debut: detail && detail.debut, duree_ms: Math.round(ms),
      etapes: detail ? detail.etapes : [], assertions: detail ? detail.assertions : { ok: 0, ko: 0 },
      message: detail && detail.message, attendu: detail && detail.attendu, obtenu: detail && detail.obtenu, pile: detail && detail.pile,
    });
  },
  finGroupe: (nom, p, f, ms) => { ecrire((f ? '  ✗ ' : '  ✓ ') + p + '/' + (p + f) + ' en ' + secondes(ms) +
                                        ' — total écoulé ' + secondes(Date.now() - debut)); ecrireInstantane(); },
}, { delaiMs: DELAI_TEST_MS_DEFAUT });

// ── tests/integration-*.js et tests/charge.js : chacun un vrai processus ───
/* Pas de describe/it ici : un lancement, un code de sortie. Le journal du
   script (stdout/stderr) est repris dans `message` pour que le cahier de
   test garde le détail, même s'il n'est pas décomposé assertion par
   assertion comme les tests Node classiques. */
integrationSelectionnes.forEach((t) => {
  ecrire('▶ ' + t.nom);
  const t0 = Date.now();
  const r = require('child_process').spawnSync(process.execPath, [path.join(root, t.fichier)], { encoding: 'utf8', cwd: root });
  const ms = Date.now() - t0;
  const ok = r.status === 0;
  ecrire((ok ? '  ✓ ' : '  ✗ ') + t.nom + ' en ' + secondes(ms));
  if (ok) res.passed++; else res.failed++;
  testsResultats.push({
    id: t.id, nom: t.nom, type: t.type, groupe: t.groupe, domaines: t.domaines, specs: t.specs, fiche: t.fiche,
    etat: ok ? 'ok' : 'echec', duree_ms: ms, etapes: [], assertions: { ok: ok ? 1 : 0, ko: ok ? 0 : 1 },
    message: ok ? undefined : ((r.stdout || '') + (r.stderr || '')).split('\n').slice(-40).join('\n'),
  });
  ecrireInstantane();
});

// ── tests e2e : navigateur sans fenêtre, piloté par CDP (SPEC-BANC-023) ────
/* Délégué à tools/e2e-headless.js, en SOUS-PROCESSUS (comme les scripts
   tests/integration-*.js ci-dessus) : ce module a besoin d'async/await
   (WebSocket CDP) que ce fichier, synchrone de bout en bout, n'a pas.
   Absence de navigateur (SPEC-BANC-025, préréglage e2e-fumee) : les e2e
   sont IGNORÉS avec un avertissement, sans faire échouer la campagne —
   même comportement que l'ancien repli « ils s'exécutent dans le
   navigateur, pas sous Node ». Toute autre panne d'infrastructure (serveur
   de test, navigateur qui plante) est en revanche un échec réel. */
if (e2eSelectionnes.length) {
  const os = require('os');
  ecrire('▶ end-to-end (' + e2eSelectionnes.length + ' test(s), navigateur sans fenêtre)');
  const tmpEntree = path.join(os.tmpdir(), 'mc-e2e-entree-' + process.pid + '.json');
  const tmpSortie = path.join(os.tmpdir(), 'mc-e2e-sortie-' + process.pid + '.json');
  fs.writeFileSync(tmpEntree, JSON.stringify(e2eSelectionnes.map(t => (
    { id: t.id, nom: t.nom, type: t.type, groupe: t.groupe, domaines: t.domaines, specs: t.specs, fiche: t.fiche, etiquettes: t.etiquettes || [] }
  ))));
  // Filet de sécurité, pas un couperet pour un test lent (SPEC-BANC-010,
  // révisé) : un test e2e réel termine typiquement en quelques secondes ;
  // seul un test VRAIMENT bloqué (session CDP figée) doit un jour atteindre
  // ces 15 minutes, coupées par tools/e2e-headless.js (Runtime.terminateExecution)
  // pour que la campagne continue avec le test suivant plutôt que de rester
  // pendue indéfiniment. delaiGlobalE2eMs est un plafond théorique (le pire
  // cas où TOUS les tests sélectionnés bloqueraient chacun à leur tour) : il
  // n'est atteint en pratique que si l'infrastructure elle-même est cassée —
  // borné à 2 h pour rester raisonnable même avec beaucoup de tests.
  const delaiTestE2eMs = 15 * 60 * 1000;
  const delaiGlobalE2eMs = Math.min(2 * 60 * 60 * 1000, Math.max(60000, e2eSelectionnes.length * (delaiTestE2eMs + 3000)));
  const t0e2e = Date.now();
  const rE2E = require('child_process').spawnSync(process.execPath, [
    path.join(root, 'tools', 'e2e-headless.js'),
    '--entree', tmpEntree, '--sortie', tmpSortie,
    '--delai-demarrage', '25000', '--delai-test', String(delaiTestE2eMs), '--delai-global', String(delaiGlobalE2eMs),
  ], { cwd: root, stdio: silencieux ? 'ignore' : ['ignore', 'inherit', 'inherit'] });
  let resultatE2E = null;
  try { resultatE2E = JSON.parse(fs.readFileSync(tmpSortie, 'utf8')); } catch (e) { /* rien : voir la branche d'échec plus bas */ }
  try { fs.unlinkSync(tmpEntree); } catch (e) { /* rien */ }
  try { fs.unlinkSync(tmpSortie); } catch (e) { /* rien */ }

  if (resultatE2E && resultatE2E.ok) {
    resultatE2E.tests.forEach((t) => {
      if (t.etat === 'ok') res.passed++; else res.failed++;
      testsResultats.push(t);
    });
    capturesGlobalesE2E = resultatE2E.captures || [];
    if (resultatE2E.environnement) environnementE2E = resultatE2E.environnement;
    ecrire('  fin end-to-end en ' + secondes(Date.now() - t0e2e));
  } else if (resultatE2E && resultatE2E.motif === 'navigateur_introuvable') {
    if (!silencieux) fs.writeSync(2, '(aucun navigateur Edge/Chrome installé — end-to-end ignoré(s), sans échec : voir tools/navigateur.js)\n');
    ignoresE2E = e2eSelectionnes.length;
  } else {
    const motif = resultatE2E ? resultatE2E.motif : ('code de sortie ' + rE2E.status);
    ecrire('  ✗ end-to-end : infrastructure indisponible (' + motif + ')');
    e2eSelectionnes.forEach((t) => {
      res.failed++;
      testsResultats.push({
        id: t.id, nom: t.nom, type: t.type, groupe: t.groupe, domaines: t.domaines, specs: t.specs, fiche: t.fiche,
        etat: 'echec', duree_ms: 0, etapes: [], assertions: { ok: 0, ko: 1 },
        message: 'campagne e2e sans fenêtre indisponible : ' + motif,
      });
    });
  }
  ecrireInstantane();
}

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', d: '\x1b[2m', x: '\x1b[0m' };
let line = '';
for (const s of res.suites) {
  const mark = s.failed ? `${C.r}✗${C.x}` : `${C.g}✓${C.x}`;
  line += `\n${mark} ${s.name} ${C.d}(${s.passed}/${s.passed + s.failed})${C.x}\n`;
  for (const l of s.lines) {
    if (l.ok) line += `  ${C.g}·${C.x} ${C.d}${l.name}${C.x}\n`;
    else line += `  ${C.r}✗ ${l.name}${C.x}\n    ${C.r}${l.message}${C.x}\n`;
  }
}
console.log(line);
const total = res.passed + res.failed;

// ── SPEC-BANC-014 : cahier de test, même si l'exécution a échoué ───────────
const finISO = new Date().toISOString();
const parType = {}, parDomaine = {};
testsResultats.forEach((t) => {
  parType[t.type] = (parType[t.type] || 0) + 1;
  (t.domaines.length ? t.domaines : ['(sans domaine)']).forEach(d => { parDomaine[d] = (parDomaine[d] || 0) + 1; });
});
const lents = testsResultats.filter(t => t.duree_ms > SEUIL_LENT * 1000).map(t => t.nom);
// environnement() décrit le processus Node qui orchestre la campagne ;
// quand des e2e ont réellement tourné, on y ajoute (sans l'écraser) ce que
// tools/e2e-headless.js a observé du navigateur sans fenêtre (SPEC-BANC-012 :
// « environnement : navigateur, carte graphique, résolution… »)
const environnementFinal = environnement();
if (environnementE2E) {
  environnementFinal.navigateur = environnementE2E.navigateur;
  environnementFinal.gpu = environnementE2E.gpu;
  environnementFinal.vendorGpu = environnementE2E.vendorGpu;
  environnementFinal.resolution = environnementE2E.resolution;
  environnementFinal.accelerationMaterielle = environnementE2E.accelerationMaterielle;
  environnementFinal.os = environnementE2E.os;
  environnementFinal.avecFenetre = environnementE2E.avecFenetre;
}
const resultatsFinaux = {
  schema: 1,
  campagne: {
    preset: etiquetteCampagne, criteres, debut: debutISO, fin: finISO, duree_ms: Date.now() - debut,
    interrompue: false, arbreModifie: arbreModifieAuDebut, environnement: environnementFinal,
    totaux: { total: testsResultats.length, passes: res.passed, echecs: res.failed, ignores: ignoresE2E, parType, parDomaine },
    lents, observationFonctions: surcoutFonctions,
  },
  tests: testsResultats,
};
try {
  const RT = require('../tools/resultats-tests.js');
  // `MC_TEST_RESULTATS_DIR` (tests only) : redirige l'écriture du cahier
  // hors de tests/resultats/ partagé — utile à un test qui lance ce fichier
  // en sous-processus (tests/spec-banc.js) sans se disputer la rotation aux
  // N derniers (elaguer()) avec une VRAIE campagne concurrente sur le même poste.
  const r = RT.ecrireCahier(resultatsFinaux, { captures: capturesGlobalesE2E, racine: process.env.MC_TEST_RESULTATS_DIR || undefined });
  ecrire('cahier de test : ' + r.rapport);
} catch (e) { ecrire('(cahier de test non écrit : ' + e.message + ')'); }

if (res.failed) {
  console.log(`${C.r}${res.failed} échec(s)${C.x} sur ${total} tests\n`);
  process.exit(1);
} else {
  console.log(`${C.g}${res.passed}/${total} tests passent${C.x}\n`);
}
