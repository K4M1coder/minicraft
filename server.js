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

const RACINE = __dirname;

// ── paramètres de lancement (SPEC-PACK-002) ─────────────────────────────────
/* Compatibilité : l'ancien usage `node server.js 8080` (port positionnel,
   utilisé par les tests d'intégration existants) reste accepté — on le
   traduit en `--port 8080` avant l'analyse déclarative. */
const SANS_PARAMETRE = process.argv.slice(2).length === 0;   // SPEC-PACK-001 : ouvre le navigateur
let argvBrut = process.argv.slice(2);
if (argvBrut[0] && /^\d+$/.test(argvBrut[0])) argvBrut = ['--port', argvBrut[0], ...argvBrut.slice(1)];


// ── chargement des modules de logique pure ───────────────────────────────────
const MODULES = ['core', 'formes', 'noise', 'biomes', 'densite', 'zones', 'volcanisme', 'souterrain', 'recifs', 'caravanes', 'donjons', 'habitats', 'routes', 'histoire', 'recits', 'carte', 'feu', 'meteo', 'lointain', 'world', 'circuits', 'lumiere', 'mesher', 'physics', 'faune', 'factions', 'inventory', 'conteneurs', 'vehicules',
                 'entities', 'player', 'synchro', 'daycycle', 'succes', 'save', 'saves', 'parties-fichier', 'modes',
                 'chat', 'commandes', 'split', 'contrats-vague2', 'contrats-archi', 'net-protocol', 'parametres', 'admin', 'politique', 'guildes', 'economie', 'metiers', 'pvp-enjeux', 'livre', 'livres', 'recit-serveur'];

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

/* L'analyse elle-même est pure et testée sous Node (tests/spec-parametres.js) ;
   c'est ICI, et seulement ici, qu'une erreur ou --aide arrête le programme. */
const analyse = MC.Parametres.analyser(argvBrut);
if (!analyse.ok) {
  console.log(analyse.message);
  process.exit(analyse.code === 'aide' ? 0 : 1);
}
const PARAMS = analyse.config;

/* Commit courant (SPEC-BANC-012) : calculé UNE FOIS au démarrage, jamais par
   requête — `git rev-parse` par appel serait un coût inutile pour une valeur
   qui ne change pas tant que le serveur tourne. `null` hors dépôt git (par
   exemple une installation empaquetée sans .git), plutôt qu'une erreur. */
let COMMIT_GIT = null;
try {
  COMMIT_GIT = require('child_process').execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: RACINE, encoding: 'utf8' }).trim();
} catch (e) { COMMIT_GIT = null; }

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
let reseauOuvert = !!(PARAMS.ouvert || PARAMS.serveurSeul);
const RELANCE = process.env.MC_RELANCE === '1';       // lancé par une bascule de partie (relance interne)
const DOSSIER_PARTIES = path.resolve(RACINE, PARAMS.dossierParties);
/* SPEC-ARCHI-013 : MC.Saves (module pur) gère l'index et les fiches de partie ;
   son stockage injecté est ici un adaptateur de FICHIERS — l'index dans
   `index.json`, chaque partie dans `<id>.json` (le format de --monde). */
function fichierStockage(cle) {
  if (cle === MC.Saves.INDEX_KEY) return path.join(DOSSIER_PARTIES, 'index.json');
  if (typeof cle === 'string' && cle.indexOf(MC.Saves.SLOT_PREFIX) === 0) {
    const id = cle.slice(MC.Saves.SLOT_PREFIX.length);
    return MC.PartiesFichier.idValide(id) ? path.join(DOSSIER_PARTIES, id + '.json') : null;
  }
  return null;
}
const stockageParties = {
  getItem(cle) {
    const f = fichierStockage(cle);
    if (!f) return null;
    try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; }
  },
  setItem(cle, valeur) {
    const f = fichierStockage(cle);
    if (!f) throw new Error('clé de stockage refusée');
    fs.mkdirSync(DOSSIER_PARTIES, { recursive: true });
    fs.writeFileSync(f + '.tmp', valeur);
    try { fs.renameSync(f + '.tmp', f); }
    catch (e) { try { fs.unlinkSync(f + '.tmp'); } catch (e2) { /* rien */ } throw e; }
  },
  removeItem(cle) {
    const f = fichierStockage(cle);
    if (!f) return;
    try { fs.unlinkSync(f); } catch (e) { /* déjà absent */ }
  },
};
function fichierMonde(id) { return path.join(DOSSIER_PARTIES, id + '.json'); }
let partieActive = null;                              // fiche d'index de la partie chargée, ou null
if (PARAMS.partie) {
  const meta = MC.PartiesFichier.idValide(PARAMS.partie) ? MC.Saves.trouver(stockageParties, PARAMS.partie) : null;
  if (!meta) {
    console.log(`partie inconnue : ${PARAMS.partie} (dossier ${DOSSIER_PARTIES})`);
    process.exit(1);
  }
  partieActive = meta;
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
  journal(`aucun --admin fourni : jeton d'administration généré → ${ADMIN_SECRET}`);
  journal('conservez-le : il ne sera plus jamais affiché (relancez avec --admin=... pour le fixer)');
}

/* SPEC-ARCHI-041 : en mode histoire, les paramètres du récit (archétype, héros,
   longueur, interactions permises, commerce) sont ceux de la PARTIE chargée ;
   `MC_HISTOIRE` (JSON) est un réglage de test, sans partie (jamais en exploitation). */
let PARAMS_HISTOIRE = null;
if (CONF.mode === 'histoire') {
  let brutHistoire = partieActive && partieActive.histoire;
  if (!brutHistoire && process.env.MC_HISTOIRE) { try { brutHistoire = JSON.parse(process.env.MC_HISTOIRE); } catch (e) { brutHistoire = null; } }
  PARAMS_HISTOIRE = MC.RecitServeur.parametres(brutHistoire);
}
const regles = MC.Modes.regles(CONF.mode, CONF.difficulte, PARAMS_HISTOIRE);
const monde = MC.createWorld(CONF.graine, { zonePolitique: PARAMS.zone });
const entites = MC.createEntities(monde);
/* Index des overrides PAR CHUNK (SPEC-SERVEUR-009) : « cx,cz » → ensemble des clés
   « x,y,z » du chunk. Maintenu à chaque écriture (set/delete/clear de la Map du
   monde, patchés sur l'instance : le monde ne connaît pas l'index), pour qu'une
   OVERRIDES_DEMANDE coûte le nombre d'overrides DU CHUNK et non celui du monde
   entier (à 100 joueurs, des dizaines de demandes par seconde chacun). */
const indexOverrides = new Map();
function cleChunkDe(k) { const p = k.split(','); return Math.floor(+p[0] / 16) + ',' + Math.floor(+p[2] / 16); }
(function () {
  const ov = monde.overrides, set0 = ov.set.bind(ov), del0 = ov.delete.bind(ov), clr0 = ov.clear.bind(ov);
  ov.set = function (k, v) {
    if (!ov.has(k)) { const c = cleChunkDe(k); let e = indexOverrides.get(c); if (!e) indexOverrides.set(c, e = new Set()); e.add(k); }
    return set0(k, v) && ov;
  };
  ov.delete = function (k) {
    if (ov.has(k)) { const c = cleChunkDe(k), e = indexOverrides.get(c); if (e) { e.delete(k); if (!e.size) indexOverrides.delete(c); } }
    return del0(k);
  };
  ov.clear = function () { indexOverrides.clear(); return clr0(); };
  ov.forEach((v, k) => { const c = cleChunkDe(k); let e = indexOverrides.get(c); if (!e) indexOverrides.set(c, e = new Set()); e.add(k); });
})();
const chat = MC.Chat.creer({ max: 120 });
// SPEC-FACTION-006 à 013 : factions PNJ (royaumes, guildes marchandes, ordres,
// bandits, cultes) et factions de joueurs — le serveur fait foi sur les deux.
const politique = MC.Politique.creer(CONF.graine);
// SPEC-FACTION-014 : le monde consulte désormais l'état politique à chaque
// calcul de zone (zoneEn/reglesZoneEn) — jamais recalculé nulle part
// ailleurs. Une référence mutable : `politique` continue d'être modifiée en
// place jour après jour (tourDuMonde), monde.definirFactionsPolitiques ne
// se rappelle donc qu'une fois.
if (monde.definirFactionsPolitiques) monde.definirFactionsPolitiques(politique);
/* MC_TEST_QUETE=1 : injecte une faction politique déterministe (ressources
   sous le seuil bas, objectif 'commercer') au démarrage, SEULEMENT pour que
   tests/integration-quetes.js exerce le VRAI chemin (traiterQuete →
   MC.Politique.questesDe/accepterQuete/remettreQuete → inventaire réel) sans
   dépendre d'une ville explorée procéduralement — le même principe que
   MC_TEST_INV (voir plus bas) pour l'inventaire, jamais en exploitation. */
if (process.env.MC_TEST_QUETE) {
  const idF = 'test:quete-e2e';
  politique.factions.set(idF, {
    id: idF, type: 'ordre', nom: 'Faction de test', caractere: 'pragmatique',
    siege: { x: 0, z: 0, site: idF }, territoire: 100,
    ressources: { or: 5, nourriture: 5 }, objectif: 'commercer', objectifs: ['commercer'],
    naissance: 0,
  });
}
/* MC_TEST_CATASTROPHE=1 : place un lieu habité SYNTHÉTIQUE (mais de forme
   réelle — mêmes champs que MC.Habitats.creer en produit) à une position
   fixe, et fait apparaître une tornade RÉELLE à cet endroit via
   `monde.meteo.tornades` (une vraie fonction du monde, simplement patchée
   pour renvoyer un événement en plus des siens) — SEULEMENT pour que
   tests/integration-quetes.js exerce le VRAI chemin serveur
   (avancerCatastrophes → MC.Habitats.endommagerLieu/migrerPopulation/
   queteCatastrophe → diffusion chat → /quete lister), sans attendre qu'une
   vraie tornade procédurale croise une vraie ville explorée — le même
   principe que MC_TEST_INV/MC_TEST_QUETE, jamais en exploitation. */
let MC_TEST_LIEU_CATASTROPHE = null;
if (process.env.MC_TEST_CATASTROPHE) setImmediate(() => journal('ATTENTION : MC_TEST_CATASTROPHE actif — un lieu et une tornade FICTIFS sont ajoutés (réglage de test, jamais en exploitation)'));
if (process.env.MC_TEST_CATASTROPHE && monde.meteo && monde.habitats) {
  MC_TEST_LIEU_CATASTROPHE = {
    id: 'test:lieu-catastrophe', kind: 'village', nom: 'Bourg de test', x: 0, z: 0, demi: 40,
    blocs: new Map([['0,0', (function () {
      var a = []; for (var i = 0; i < 40; i++) a.push(i, 60, 0, 1, 0); return a;
    })()]]),
    pnjs: [{ id: 'test:lieu-catastrophe#0', role: 'habitant', nom: 'Test', x: 0, y: 60, z: 0, lieu: 'test:lieu-catastrophe' }],
    batiments: [],
  };
  const lieuxProchesOrig = monde.habitats.lieuxProches.bind(monde.habitats);
  monde.habitats.lieuxProches = (x, z, rayon) => lieuxProchesOrig(x, z, rayon).concat([MC_TEST_LIEU_CATASTROPHE]);
  const tornadesOrig = monde.meteo.tornades.bind(monde.meteo);
  monde.meteo.tornades = (t) => tornadesOrig(t).concat([{ id: 'test-tornade', x: 0, z: 0, rayon: 60, force: 1, vie: 10, sens: 1 }]);
}
/* MC_TEST_ECLAIR=1 : un éclair toutes les 2 s de monde, qui tombe SUR le joueur
   (la portée, l'abri et les dégâts restent ceux du serveur, `foudroie` réel) —
   SEULEMENT pour que tests/integration-archi-env.js exerce le vrai chemin de
   la foudre sans attendre un orage de la météo procédurale. Jamais en
   exploitation (même principe que MC_TEST_CATASTROPHE). */
if (process.env.MC_TEST_ECLAIR) setImmediate(() => journal('ATTENTION : MC_TEST_ECLAIR actif — un éclair FICTIF tombe sur chaque joueur toutes les 2 s (réglage de test, jamais en exploitation)'));
if (process.env.MC_TEST_ECLAIR && monde.meteo) {
  monde.meteo.eclairs = (t0, t1) => (Math.floor(t1 / 2) > Math.floor(t0 / 2) ? [{ id: Math.floor(t1 / 2), force: 1, t: t1 }] : []);
  monde.meteo.lieuEclair = (e, px, pz) => ({ x: Math.floor(px), z: Math.floor(pz) });
}
const guildes = MC.Guildes.creerEtat();
// L45 : prix dynamiques, trésors de lieux, métiers (SPEC-ECO/METIER) — même
// module et même état joués à l'identique en solo (game.js) et ici.
const economie = MC.Economie.creerEtat(CONF.graine);
// SPEC-QUETE-004 : tableau des quêtes ACTIVES de chaque joueur (nom -> [...]),
// tenu et arbitré ICI, jamais par un client — accepterQuete/remettreQuete
// (politique.js) sont les seules portes d'entrée qui font foi, empêchant
// une double remise même si deux clients l'envoient en même temps.
let quetesJoueurs = new Map();
// B4 (docs/vague-2/B4.md) : butin, meurtres non consentis, réputation,
// hors-la-loi, duels et victoires PvP. Déclaré ICI (avant `etatMonde`/
// `appliquerEtatMonde`, appelée dès la reprise `--monde` plus bas dans ce
// fichier), même raison que `joueursRegistre`/`banques` juste au-dessus dans
// B1 : une `const` lue avant sa déclaration lexicale planterait au démarrage.
const pvp = MC.PvpEnjeux.creerEtat();
// SPEC-MECA-001 : contenu des distributeurs — le serveur fait foi sur ce qui
// s'éjecte sur signal (voir NP.MSG.DISTRIB et monde.tickCircuits plus bas).
// B1 (étape 7, SPEC-SYNC-012/013) : un distributeur est maintenant un
// conteneur POSÉ comme un autre — il vit dans `conteneursPoses`, plus de Map
// séparée (ce qui le fait aussi persister dans etatMonde, § 8 du plan).
// B1 (SPEC-SYNC-007 à 017) : registre des joueurs nommés et banques — déclarés
// ICI (avant `appliquerEtatMonde`, qui les lit dès la reprise `--monde` au
// démarrage, plus bas dans ce fichier) et non près du reste de la section
// inventaire/conteneurs (server.js § « inventaire et conteneurs ») pour éviter
// une zone morte temporelle (`const` lu avant sa déclaration lexicale).
const joueursRegistre = new Map();   // cleRegistre(nom, j) → enregistrement { v:1, inv, equip, banque }
const banques = new Map();           // cleRegistre(nom, j) → conteneur 'banque' (API figée, § 5 du plan)
// B1 (étape 7, docs/vague-2/B1.md § 7) : registre des conteneurs POSÉS — coffre,
// fourneau, armoire, étagère, bibliothèque, distributeur (PAS la banque, ni la
// grille : par joueur, voir plus haut/plus bas). `js.conteneurOuvert` (sur
// chaque joueur local, voir creerJoueurServeur) tient lieu d'abonnement : un
// seul conteneur posé ouvert à la fois par joueur local, comme à l'écran —
// revérifié (abonnement ET portée) à CHAQUE opération par `resoudreConteneur`.
const conteneursPoses = new Map();   // cle 'x,y,z' → conteneur MC.Conteneurs
// dernier instantané ENVOYÉ d'un fourneau (cadence de message ≤ 2 Hz,
// SPEC-SYNC-015) — la cuisson elle-même tourne à chaque tic (SPEC-SYNC-016).
const derniereEmissionFour = new Map();
function banqueDe(cleReg) {
  let b = banques.get(cleReg);
  if (!b) { b = MC.Conteneurs.creerConteneur('banque'); banques.set(cleReg, b); }
  return b;
}
let heure = 60;
let meteoT = null;
let accEau = 0;
let accCircuits = 0;      // L29 mécanismes (SPEC-MECA-008) : même cadence que l'eau
let accFourMsg = 0;       // B1 (étape 7) : cadence de message des fourneaux posés (≤ 2 Hz, SPEC-SYNC-015)
// SPEC-SERVEUR-005 : purge périodique de admin.sessions/invitations/sanctions
// — cadence et seuils réglables (comme MC_SAUVEGARDE_MS) pour les tests
// d'intégration, sans quoi il faudrait des dizaines de milliers de sessions
// réelles pour observer une purge. `heure` (l'horloge du monde, en secondes
// simulées) est l'unité déjà utilisée par MC.Admin.ouvrirSession/fermerSession
// à l'appel — les seuils d'ancienneté par défaut sont donc exprimés dans
// cette même unité (secondes), pas en millisecondes malgré le nom `*Ms` hérité
// de src/admin.js (générique : il ne fait que comparer deux nombres).
let accPurge = 0;
const PURGE_ADMIN_S = parseInt(process.env.MC_ADMIN_PURGE_S, 10) || 3600;
const PURGE_ADMIN_OPTS = {
  sessionsMax: parseInt(process.env.MC_ADMIN_PURGE_SESSIONS_MAX, 10) || undefined,
  sessionsAgeMs: parseInt(process.env.MC_ADMIN_PURGE_SESSIONS_AGE_S, 10) || 90 * 24 * 3600,
  invitationsMax: parseInt(process.env.MC_ADMIN_PURGE_INVITATIONS_MAX, 10) || undefined,
  invitationsAgeMs: parseInt(process.env.MC_ADMIN_PURGE_INVITATIONS_AGE_S, 10) || 30 * 24 * 3600,
  sanctionsMax: parseInt(process.env.MC_ADMIN_PURGE_SANCTIONS_MAX, 10) || undefined,
  sanctionsAgeMs: parseInt(process.env.MC_ADMIN_PURGE_SANCTIONS_AGE_S, 10) || 90 * 24 * 3600,
};

// ── persistance du monde (SPEC-SERVEUR-001) ─────────────────────────────────
/* `--monde fichier.json` fait vivre le monde sans joueur local : sauvegarde
   régulière ET à l'arrêt (SIGINT/SIGTERM), reprise au lancement suivant. Le
   format est délibérément indépendant de MC.Save (pensé pour UN joueur local) :
   ici il n'y a ni joueur ni inventaire à sauver, seulement le monde partagé
   et l'état d'administration (rôles, listes, invitations, journal). */
function etatMonde() {
  const overrides = [];
  monde.overrides.forEach((id, k) => { const p = k.split(','); overrides.push([+p[0], +p[1], +p[2], id]); });
  // États de bloc (SPEC-SAVE-017) : à part des overrides — poser un état ne
  // pose pas forcément un bloc, le coupler aux overrides en perdrait au chargement.
  const etats = [];
  if (monde.etatsOverrides) {
    monde.etatsOverrides.forEach((etat, k) => { const p = k.split(','); etats.push([+p[0], +p[1], +p[2], etat]); });
  }
  const crops = [];
  monde.crops.forEach(c => crops.push([c.x, c.y, c.z, +c.t.toFixed(2)]));
  return {
    // v2 (SPEC-SAVE-017) : ajoute la liste `etats` ; les blocs eux-mêmes ne
    // bougent pas (aucun objet d'inventaire ici, voir le commentaire plus
    // haut), donc un fichier v1 (sans `etats`) se relit sans conversion d'id.
    v: 2, graine: CONF.graine, heure,
    overrides, etats, crops,
    donjons: monde.donjonsVaincus ? Array.from(monde.donjonsVaincus) : [],
    pilles: monde.coffresPilles ? Array.from(monde.coffresPilles) : [],
    pnjsMorts: monde.pnjsMorts ? Array.from(monde.pnjsMorts.entries()) : [],
    admin: MC.Admin.serialiser(admin),
    zones: monde.zonesEtat ? MC.Zones.serialiser(monde.zonesEtat) : null,
    politique: MC.Politique.serialiser(politique),
    guildes: MC.Guildes.serialiser(guildes),
    economie: MC.Economie.serialiser(economie),
    // B1 (docs/vague-2/B1.md § 7-8) : le registre des joueurs nommés
    // (inventaire, équipement, banque — `MC.Conteneurs.versEnregistrement`
    // inclut déjà la banque) ; un joueur ENCORE connecté à l'instant de la
    // sauvegarde est capturé à jour, pas seulement celui déjà écrit au
    // dernier `fermer()`.
    joueurs: Array.from(snapshotRegistreJoueurs().entries()),
    // B1 (étape 7, SPEC-SYNC-021 partiel — la partie inventaire) : les
    // conteneurs POSÉS (coffres, fourneaux, armoires, étagères,
    // bibliothèques, distributeurs) — un joueur qui en a un ouvert à
    // l'instant de la sauvegarde est capturé à jour (même objet vivant).
    // `normaliserTailleConteneur` : défense en profondeur (revue adversariale)
    // — un conteneur mal formé (jamais censé arriver depuis le correctif
    // d'`indiceValide`, conteneurs.js) n'est plus filtré silencieusement par
    // `validerConteneurPersiste` (qui exige `slots.length === taille`) : il
    // est tronqué à sa vraie taille AVANT sérialisation, l'excédent lâché au
    // sol quand la position est connue — jamais perdu sans trace.
    conteneurs: Array.from(conteneursPoses.entries())
      .map(([cle, cont]) => {
        normaliserTailleConteneur(cle, cont);
        return MC.ContratsV2.validerConteneurPersiste({
          cle, type: cont.type, slots: cont.slots.map(MC.ContratsV2.pileVersCase), four: cont.four,
        });
      })
      .filter(Boolean),
    // B4 (docs/vague-2/B4.md § 6) : meurtres récents, victoires et réputations
    // politiques — en dernier, comme prévu par le plan. Duels et propositions
    // sont éphémères, jamais persistés (MC.PvpEnjeux.serialiser les omet déjà).
    pvp: MC.PvpEnjeux.serialiser(pvp),
    // SPEC-QUETE-004 : le tableau de quêtes actives par joueur, persistant à
    // la sauvegarde/reconnexion (nom -> [{ id, statut, … }]).
    quetes: MC.Politique.serialiserQuetes(quetesJoueurs),
    // SPEC-ARCHI-014 : blocs de commande (texte de chaque bloc), et ce que le
    // fichier d'une partie solo importée porte sans que le serveur l'exploite
    // encore (cartes explorées, histoire, succès, véhicules…) : restitué tel
    // quel à chaque sauvegarde, jamais perdu en route.
    commandes: Array.from(monde.commandesBloc.entries()).map(([k, texte]) => {
      const p = k.split(',');
      return [+p[0], +p[1], +p[2], texte];
    }),
    // SPEC-SERVEUR-006 : les véhicules (position, cap, soute, carburant, avarie),
    // au format de MC.Vehicules.serialiser — le même qu'écrivait la sauvegarde solo
    vehicules: MC.Vehicules.serialiser(entites),
    // SPEC-ARCHI-041 : l'état du récit de chaque joueur (parité ARCHI-014 : l'ancien `histoire` solo y est adopté)
    histoire: regles.histoire ? { v: 1, liens: histoireMonde.liens, recits: Array.from(snapshotRecits().entries()) } : null,
    soloJoueur, extras: extrasSolo,
  };
}
let soloJoueur = null;      // enregistrement du joueur d'une partie solo importée, adopté à la première connexion
let extrasSolo = null;      // champs d'une partie solo importée que le serveur conserve sans encore les jouer (ARCHI-014)
const VEHICULES_JOUEUR_MAX = 12;            // véhicules posés, libres, par joueur (en plus du plafond global)
const VEHICULES_MAX = 256;               // véhicules posés dans le monde (borne contre la pose en rafale, en créatif surtout)
const vehiculesSoute = new Set();        // véhicules à soute vivants (pour libérer leur soute à leur destruction)
/* SPEC-ARCHI-041 : le récit. `histoireMonde.liens` : lieux d'épopée liés au monde (leur recherche
   coûte quelques secondes : faite UNE fois, au démarrage, puis persistée) ; `recitsRegistre` :
   récit de chaque joueur nommé (clé de registre) ; `soloRecit` : récit d'une partie solo importée,
   adopté avec son joueur. */
const histoireMonde = { liens: null };
const recitsRegistre = new Map();
let soloRecit = null;
/* Enregistrement d'un joueur nommé + son état de personnage (SPEC-SYNC-020,
   nécessaire à la parité de sauvegarde SPEC-ARCHI-014) : position, regard,
   vie, faim, air, case sélectionnée, vol. */
function enregistrementJoueur(js) {
  const rec = MC.Conteneurs.versEnregistrement(js.joueur.state, banqueDe(js.cleReg));
  const st = js.joueur.state;
  rec.succes = js.succes.serialiser();           // SPEC-ARCHI-042 : les succès suivent le joueur nommé
  rec.etat = {
    x: +st.pos.x.toFixed(2), y: +st.pos.y.toFixed(2), z: +st.pos.z.toFixed(2),
    yaw: +st.yaw.toFixed(3), pitch: +st.pitch.toFixed(3),
    hp: st.hp, hunger: st.hunger, air: +st.air.toFixed(1),
    selected: st.selected, flying: !!st.flying,
    spawn: js.spawn || null,
  };
  return rec;
}
/* Réapplique l'état de personnage d'un enregistrement. Un joueur mort à la
   sauvegarde revient en vie au point d'apparition, jamais au cadavre. */
function appliquerEtatPersonnage(js, etat) {
  if (!etat || typeof etat !== 'object') return;
  const st = js.joueur.state;
  const fini = (v) => typeof v === 'number' && isFinite(v);
  if (fini(etat.hp) && etat.hp > 0) {
    if (fini(etat.x) && fini(etat.y) && fini(etat.z) && Math.abs(etat.x) < 1e7 && Math.abs(etat.z) < 1e7 && etat.y >= -64 && etat.y < 400) {
      st.pos.x = etat.x; st.pos.y = etat.y; st.pos.z = etat.z;
      for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
        monde.getChunk(Math.floor(etat.x / 16) + cx, Math.floor(etat.z / 16) + cz, true);
      }
    }
    if (fini(etat.yaw)) st.yaw = etat.yaw;
    if (fini(etat.pitch)) st.pitch = Math.max(-1.6, Math.min(1.6, etat.pitch));
    st.hp = Math.min(20, etat.hp);
    if (fini(etat.hunger)) st.hunger = Math.max(0, Math.min(20, etat.hunger));
    if (fini(etat.air)) st.air = Math.max(0, Math.min(10, etat.air));
    if (Number.isInteger(etat.selected) && etat.selected >= 0 && etat.selected < 9) st.selected = etat.selected;
    st.flying = !!etat.flying && !!regles.vole;
  }
  js.spawn = etat.spawn || null;
}
/* Fusionne le registre (déjà à jour pour les joueurs déconnectés) avec
   l'état courant de chaque joueur local ENCORE connecté et nommé — sans
   muter `joueursRegistre` lui-même (une vraie déconnexion, plus tard,
   écrira la version définitive via `fermer`). */
function snapshotRegistreJoueurs() {
  const out = new Map(joueursRegistre);
  clients.forEach(c => {
    if (!c.joueurs) return;
    c.joueurs.forEach(js => {
      if (!js.cleReg) return;
      out.set(js.cleReg, enregistrementJoueur(js));
    });
  });
  return out;
}
function appliquerEtatMonde(data) {
  if (!data || (data.v !== 1 && data.v !== 2)) return false;   // format inconnu : refusé proprement
  if (data.graine !== undefined && data.graine !== CONF.graine) {
    // une graine différente : la carte ne correspondrait plus aux overrides
    journal(`avertissement : la graine du fichier (${data.graine}) diffère de celle lancée (${CONF.graine}) — reprise quand même`);
  }
  heure = data.heure || 60;
  monde.overrides.clear();
  (data.overrides || []).forEach(o => monde.overrides.set(o[0] + ',' + o[1] + ',' + o[2], o[3]));
  if (monde.etatsOverrides) {
    monde.etatsOverrides.clear();
    (data.etats || []).forEach(o => { if (o[3]) monde.etatsOverrides.set(o[0] + ',' + o[1] + ',' + o[2], o[3]); });
  }
  monde.crops.clear();
  (data.crops || []).forEach(c => monde.crops.set(c[0] + ',' + c[1] + ',' + c[2], { x: c[0], y: c[1], z: c[2], t: c[3] }));
  if (monde.donjonsVaincus) { monde.donjonsVaincus.clear(); (data.donjons || []).forEach(id => monde.donjonsVaincus.add(id)); }
  if (monde.coffresPilles) { monde.coffresPilles.clear(); (data.pilles || []).forEach(k => monde.coffresPilles.add(k)); }
  if (monde.pnjsMorts) {
    monde.pnjsMorts.clear();
    (data.pnjsMorts || []).forEach(m => { if (m && typeof m[0] === 'string') monde.pnjsMorts.set(m[0], +m[1] || 0); });
  }
  if (data.admin) MC.Admin.appliquer(admin, data.admin);
  if (data.zones && monde.zonesEtat) MC.Zones.appliquer(monde.zonesEtat, data.zones);
  if (data.politique) {
    const pol = MC.Politique.charger(data.politique);
    politique.seed = pol.seed; politique.jour = pol.jour;
    politique.factions = pol.factions; politique.relations = pol.relations; politique.annonces = pol.annonces;
  }
  if (data.guildes) {
    const gu = MC.Guildes.charger(data.guildes);
    guildes.factions = gu.factions; guildes.joueurs = gu.joueurs;
    guildes.invitations = gu.invitations; guildes.prochainId = gu.prochainId;
  }
  // SPEC-QUETE-004 : reprise du tableau de quêtes actives par joueur.
  quetesJoueurs = MC.Politique.chargerQuetes(data.quetes);
  if (data.economie) {
    const eco = MC.Economie.charger(data.economie);
    economie.jour = eco.jour; economie.lieux = eco.lieux;
    economie.joueurs = eco.joueurs; economie.departs = eco.departs;
  }
  // B4 : absent d'un fichier plus ancien (avant B4) → simplement vide, comme
  // aujourd'hui. Duels et propositions ne sont jamais dans `data.pvp`
  // (jamais sérialisés) : ils restent donc ceux, vides, de `pvp` au démarrage.
  if (data.pvp) {
    const pv = MC.PvpEnjeux.charger(data.pvp);
    pvp.meurtres = pv.meurtres; pvp.victoires = pv.victoires; pvp.reputations = pv.reputations;
  }
  // B1 (docs/vague-2/B1.md § 7-8) : registre des joueurs nommés — absent
  // d'un fichier plus ancien (v1/v2, ou v2 d'avant cette section), donc
  // simplement vide, comme aujourd'hui. La banque d'un joueur repris n'est
  // PAS reconnectée : `versEnregistrement`/`banqueDe` recréent un conteneur
  // vivant tout de suite (B1.md § 5), sans attendre que le joueur revienne.
  joueursRegistre.clear();
  banques.clear();
  (data.joueurs || []).forEach(entree => {
    if (!Array.isArray(entree) || typeof entree[0] !== 'string' || !MC.ContratsV2) return;
    const v = MC.ContratsV2.validerEnregistrementJoueur(entree[1]);
    if (!v) return;
    joueursRegistre.set(entree[0], v);
    banqueDe(entree[0]).slots = v.banque.map(MC.ContratsV2.caseVersPile);
  });
  // SPEC-ARCHI-014 : blocs de commande, joueur solo importé, extras conservés
  monde.commandesBloc.clear();
  (data.commandes || []).forEach(c => {
    if (Array.isArray(c) && c[3]) monde.setCommande(c[0], c[1], c[2], String(c[3]).slice(0, 200));
  });
  soloJoueur = data.soloJoueur && MC.ContratsV2 ? MC.ContratsV2.validerEnregistrementJoueur(data.soloJoueur) : null;
  extrasSolo = data.extras && typeof data.extras === 'object' ? data.extras : null;
  /* SPEC-SERVEUR-006 : les véhicules reviennent dans le monde. Une partie solo
     importée les porte dans `extras.vehicules` (même format) : ils sont repris
     UNE fois puis retirés des extras, sinon la sauvegarde suivante les
     écrirait deux fois. Les véhicules déjà présents (re-chargement) sont retirés. */
  entites.list.filter(e => e.vehicule).forEach(e => entites.remove(e));
  vehiculesSoute.clear();
  let brutsVeh = Array.isArray(data.vehicules) ? data.vehicules : [];
  if (!brutsVeh.length && extrasSolo && Array.isArray(extrasSolo.vehicules)) brutsVeh = extrasSolo.vehicules;
  if (extrasSolo && 'vehicules' in extrasSolo) { extrasSolo = Object.assign({}, extrasSolo); delete extrasSolo.vehicules; }
  MC.Vehicules.restaurer(entites, brutsVeh.slice(0, VEHICULES_MAX).filter(v => Array.isArray(v) && MC.Vehicules.DEFS[v[0]]
    && [v[1], v[2], v[3]].every(Number.isFinite) && Math.abs(v[1]) < 1e7 && Math.abs(v[3]) < 1e7 && v[2] > -64 && v[2] < 400));
  entites.list.forEach(e => { if (e.vehicule && e.soute) vehiculesSoute.add(e); });
  histoireMonde.liens = data.histoire && data.histoire.liens && typeof data.histoire.liens === 'object' ? data.histoire.liens : null;
  recitsRegistre.clear();
  if (data.histoire && Array.isArray(data.histoire.recits)) {
    data.histoire.recits.forEach(e => { if (Array.isArray(e) && typeof e[0] === 'string' && e[1] && typeof e[1] === 'object') recitsRegistre.set(e[0], e[1]); });
  }
  soloRecit = regles.histoire && extrasSolo && extrasSolo.histoire && typeof extrasSolo.histoire === 'object' ? extrasSolo.histoire : null;
  // B1 (étape 7, SPEC-SYNC-021 partiel) : conteneurs POSÉS — absents d'un
  // fichier plus ancien, donc simplement vides, comme aujourd'hui.
  conteneursPoses.clear();
  derniereEmissionFour.clear();
  (data.conteneurs || []).forEach(o => {
    const v = MC.ContratsV2.validerConteneurPersiste(o);
    if (!v) return;
    const cont = MC.Conteneurs.creerConteneur(v.type);
    if (!cont) return;
    cont.slots = v.slots.map(MC.ContratsV2.caseVersPile);
    if (v.four) cont.four = v.four;
    conteneursPoses.set(v.cle, cont);
  });
  return true;
}
/* Sauvegarde atomique (SPEC-SERVEUR-003) : on écrit dans un fichier `.tmp`
   PUIS on renomme vers le chemin final — `rename` est atomique au niveau du
   système de fichiers, donc le fichier final est TOUJOURS soit l'ancienne
   version complète, soit la nouvelle version complète, jamais un mélange
   tronqué. Écrire directement dans le fichier final exposerait une lecture
   (ou un arrêt brutal du processus) au milieu de l'écriture.

   Revue adversariale du commit 2365213 (test-race-save.js) : la sauvegarde
   PÉRIODIQUE (asynchrone) et celle de l'ARRÊT/PANNE (synchrone) écrivaient
   toutes deux dans le MÊME fichier `.tmp` — un SIGTERM pendant que l'écriture
   asynchrone est en vol pouvait laisser un `.tmp` tronqué au sol (l'écriture
   du thread libuv et l'écriture synchrone du thread principal se
   chevauchent, puis `process.exit()` coupe tout avant que l'une des deux
   n'ait fini). Deux corrections : chaque mode écrit dans son PROPRE fichier
   temporaire (jamais le même inode manipulé par deux écritures concurrentes),
   et l'arrêt attend (avec un délai borné) qu'une sauvegarde asynchrone déjà
   en vol se termine avant d'en lancer une synchrone par-dessus. */
const FICHIER_TMP_ASYNC = () => CONF.mondeFichier + '.tmp';
const FICHIER_TMP_SYNC = () => CONF.mondeFichier + '.tmp.' + process.pid;
let sauvegardeEnCours = false;
let sauvegardeEnCoursAttente = null;   // Promise résolue quand la sauvegarde async en vol se termine
let sauvegardeArretee = false;         // plus aucune sauvegarde async après le début de l'arrêt

/* Version asynchrone (SPEC-SERVEUR-004) : utilisée par la sauvegarde
   périodique, elle ne bloque JAMAIS la boucle de jeu — `fs.writeFile`/
   `fs.rename` rendent la main immédiatement, le tic et les messages des
   clients continuent d'être traités pendant l'écriture disque. Une seule
   sauvegarde à la fois : si la précédente n'est pas terminée, celle-ci est
   ignorée plutôt que d'écrire deux fichiers `.tmp` en parallèle. */
/* SPEC-ARCHI-012 : une sauvegarde est OMISE si rien n'a changé depuis la
   précédente. L'empreinte est l'état sérialisé SANS l'heure du monde (qui
   avance à chaque tic hors pause : sans cette exclusion une cadence
   n'omettrait jamais rien) ; une sauvegarde provoquée par un ÉVÈNEMENT (pause,
   retour au menu, fermeture réseau, dernier client, arrêt) n'est omise que si
   l'heure elle-même n'a pas bougé non plus, c'est-à-dire seulement quand le
   monde est réellement resté figé depuis l'écriture précédente. */
let derniereEmpreinte = null;
let derniereHeureSauvee = null;
let nbEcritures = 0;                   // écritures réussies depuis le démarrage (« /sauver » compare avant/après)
let sauvegardeRedemandee = null;       // raison d'une sauvegarde événementielle demandée pendant une écriture en vol
function empreinteEtat(json) { return json.replace(/"heure":[-0-9.eE+]+/, '"heure":0'); }
function apresSauvegarde(raison, ms, octets) {
  journal('sauvegarde du monde (' + raison + ')' + (ms !== undefined ? ' — sérialisation ' + ms.toFixed(1) + ' ms, ' + Math.round(octets / 1024) + ' Ko' : ''));
  if (partieActive) MC.Saves.majMeta(stockageParties, partieActive.id, { duree: Math.round(dureeJeu) });
}
let dureeJeu = 0;                      // secondes de jeu réellement écoulées (hors pause, avec un joueur), pour l'index des parties
function sauvegarderMondeAsync(raison, evenement) {
  if (!CONF.mondeFichier || sauvegardeArretee) return;
  /* La cible est figée ICI : `/api/parties/supprimer` peut mettre CONF.mondeFichier
     à null pendant l'écriture (rename(…, null) levait, et écrivait « null.tmp »). */
  const cible = CONF.mondeFichier;
  const tmp = cible + '.tmp';
  raison = typeof raison === 'string' ? raison : 'cadence';
  if (sauvegardeEnCours) {                            // pas de sauvegarde concurrente
    if (evenement) sauvegardeRedemandee = raison;
    return;
  }
  let data;
  const t0 = process.hrtime.bigint();
  try { data = JSON.stringify(etatMonde()); }
  catch (e) { journal('échec de la sauvegarde du monde (sérialisation) : ' + e.message); return; }
  const msSerialisation = Number(process.hrtime.bigint() - t0) / 1e6;     // SPEC-ARCHI-012 : banc tests/bench-sauvegarde.js
  const emp = empreinteEtat(data);
  if (derniereEmpreinte !== null && emp === derniereEmpreinte && (!evenement || heure === derniereHeureSauvee)) {
    journal('sauvegarde omise (' + raison + ') : rien n a change depuis la précédente');
    return;
  }
  sauvegardeEnCours = true;
  let finAttente;
  sauvegardeEnCoursAttente = new Promise((resolve) => { finAttente = resolve; });
  const heureEcrite = heure;
  const fin = (ok) => {
    sauvegardeEnCours = false; sauvegardeEnCoursAttente = null; finAttente();
    // la partie a été supprimée pendant l'écriture : ne rien laisser derrière
    if (ok && CONF.mondeFichier !== cible) { try { fs.unlinkSync(cible); } catch (e) { /* déjà absent */ } ok = false; }
    if (ok) { nbEcritures++; derniereEmpreinte = emp; derniereHeureSauvee = heureEcrite; apresSauvegarde(raison, msSerialisation, data.length); }
    if (sauvegardeRedemandee) { const r = sauvegardeRedemandee; sauvegardeRedemandee = null; sauvegarderMondeAsync(r, true); }
  };
  try { fs.mkdirSync(path.dirname(cible), { recursive: true }); } catch (e) { /* remonté par l'écriture */ }
  const ecrire = () => fs.writeFile(tmp, data, (err) => {
    if (err) { journal('échec de la sauvegarde du monde (écriture) : ' + err.message); fin(false); return; }
    fs.rename(tmp, cible, (err2) => {
      if (err2) { journal('échec de la sauvegarde du monde (renommage) : ' + err2.message); try { fs.unlinkSync(tmp); } catch (e) { /* rien */ } fin(false); return; }
      fin(true);
    });
  });
  // MC_TEST_SAUVEGARDE_LENTE_MS : retarde l'écriture disque (tests de course avec /supprimer), jamais en exploitation
  const lente = parseInt(process.env.MC_TEST_SAUVEGARDE_LENTE_MS, 10) || 0;
  if (lente) setTimeout(ecrire, lente); else ecrire();
}

/* Version synchrone (toujours atomique elle aussi, mêmes tmp+rename, mais
   dans SON PROPRE fichier temporaire — voir plus haut) : réservée à l'arrêt
   du processus et aux gestionnaires de panne, où il n'y a plus de prochain
   tour de boucle d'évènements pour attendre une écriture asynchrone. */
function sauvegarderMondeSync() {
  if (!CONF.mondeFichier) return false;
  try {
    fs.mkdirSync(path.dirname(CONF.mondeFichier), { recursive: true });
    fs.writeFileSync(FICHIER_TMP_SYNC(), JSON.stringify(etatMonde()));
    fs.renameSync(FICHIER_TMP_SYNC(), CONF.mondeFichier);
    if (partieActive) MC.Saves.majMeta(stockageParties, partieActive.id, { duree: Math.round(dureeJeu) });
    return true;
  } catch (e) { journal('échec de la sauvegarde du monde : ' + e.message); return false; }
}
const dodo = (ms) => new Promise((r) => setTimeout(r, ms));
if (CONF.mondeFichier) {
  // fichiers temporaires résiduels d'un arrêt brutal précédent (process tué
  // avant la fin d'une écriture) : jamais renommés vers le fichier final,
  // donc jamais lus — mais laissés au sol, ils s'accumuleraient sans fin.
  try {
    const dossier = path.dirname(CONF.mondeFichier);
    const prefixe = path.basename(CONF.mondeFichier) + '.tmp';
    fs.readdirSync(dossier).forEach((f) => {
      if (f.indexOf(prefixe) !== 0) return;
      try { fs.unlinkSync(path.join(dossier, f)); journal(`fichier temporaire résiduel supprimé : ${f}`); }
      catch (e) { /* déjà disparu, ou permission : tant pis, non bloquant */ }
    });
  } catch (e) { /* dossier pas encore créé : rien à nettoyer */ }
  try {
    if (fs.existsSync(CONF.mondeFichier)) {
      const data = JSON.parse(fs.readFileSync(CONF.mondeFichier, 'utf8'));
      if (appliquerEtatMonde(data)) journal(`monde repris depuis ${CONF.mondeFichier} (heure ${heure.toFixed(1)})`);
      else journal(`fichier de monde illisible ou d'une autre version : ${CONF.mondeFichier} — nouvelle carte`);
    } else {
      journal(`aucune sauvegarde à ${CONF.mondeFichier} — nouvelle carte, créée à la première sauvegarde`);
    }
  } catch (e) { journal('échec de la reprise du monde : ' + e.message); }
  // sauvegarde régulière : toutes les deux minutes par défaut, comme un
  // compromis entre sécurité (peu de perte en cas d'arrêt brutal) et coût
  // disque négligeable. Réglable (MC_SAUVEGARDE_MS) : les tests d'intégration
  // en ont besoin d'un intervalle court pour vérifier la sauvegarde périodique
  // sans attendre deux minutes.
  planifierSauvegarde();
}
/* Cadence (SPEC-ARCHI-012) : 45 s en mode fermé (perte maximale d'un crash
   brutal), 120 s en mode ouvert (inchangé) ; MC_SAUVEGARDE_MS la règle pour
   les tests. Recalculée à chaque tour : l'ouverture/fermeture à chaud du
   réseau change la cadence sans redémarrage. */
function cadenceSauvegardeMs() {
  return parseInt(process.env.MC_SAUVEGARDE_MS, 10) || (reseauOuvert ? CA.BORNES.SAUVEGARDE_OUVERT_MS : CA.BORNES.SAUVEGARDE_FERME_MS);
}
function planifierSauvegarde() {
  setTimeout(() => { sauvegarderMondeAsync('cadence', false); planifierSauvegarde(); }, cadenceSauvegardeMs());
}
/* Les habitants des villes et villages proches des joueurs : le serveur les
   fait vivre, comme toutes les créatures. Un habitant tué ne renaît pas. */
const pnjsSuivis = new Map();                 // les morts : monde.pnjsMorts (identifiant → heure)
function peuplerLieux() {
  if (!monde.habitats) return;
  pnjsSuivis.forEach((e, id) => {
    if (entites.list.indexOf(e) >= 0) return;
    if (e.hp <= 0) monde.pnjsMorts.set(id, heure);
    pnjsSuivis.delete(id);
  });
  const lieux = [];
  tousLesJoueurs().forEach(({ js }) => {
    const p = js.joueur.state.pos;
    monde.habitats.lieuxProches(p.x, p.z, 90).forEach(l => { if (lieux.indexOf(l) < 0) lieux.push(l); });
  });
  MC.Habitats.pnjsManquants(lieux, entites.list, monde.pnjsMorts, heure).forEach(p => {
    if (!monde.estCharge(p.x, p.z)) return;
    const e = entites.spawn('villager', p.x, p.y + 0.05, p.z,
                            { pnj: p.id, role: p.role, nom: p.nom, foyer: { x: p.x, z: p.z }, lieu: p.lieu });
    pnjsSuivis.set(p.id, e);
  });
}
/* SPEC-FACTION-006/007/008 : les royaumes et guildes marchandes se découvrent
   au fil des villes/mégapoles explorées par les joueurs (comme les habitants,
   habitats.js ne connaît que ce qui a été chargé) ; la simulation avance d'un
   jour de jeu à la fois, rattrapée d'un coup si le serveur est resté longtemps
   sans public — toujours de façon déterministe (graine + jour). Chaque
   naissance et chaque événement notable (raid, alliance, guerre…) s'annonce
   dans le chat, comme un message système. */
function avancerPolitique() {
  if (monde.habitats) {
    const sites = [];
    tousLesJoueurs().forEach(({ js }) => {
      const p = js.joueur.state.pos;
      monde.habitats.lieuxProches(p.x, p.z, 300).forEach(l => {
        if ((l.kind === 'ville' || l.kind === 'megapole') && !sites.some(s => s.id === l.id)) {
          sites.push({ id: l.id, kind: l.kind, x: l.x, z: l.z, nom: l.nom });
        }
      });
    });
    MC.Politique.decouvrir(politique, sites);
  }
  const jourCourant = Math.floor(heure / MC.DayCycle.DAY_LENGTH);
  if (jourCourant <= politique.jour) return;
  const avant = politique.annonces.length;
  MC.Politique.tourDuMonde(politique, jourCourant);
  politique.annonces.slice(avant).forEach(a => {
    const m = chat.systeme(a.texte);
    if (m) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
  });
}
// ── catastrophes environnementales (SPEC-ENV-001/002/004, SPEC-QUETE-003) ──
// clé "lieuId:evenementId" déjà appliquée — un cyclone/une tornade dure
// plusieurs minutes/heures : sans ce registre, chaque tick le réappliquerait.
const catastrophesAppliquees = new Set();
// quêtes de reconstruction/secours proposées par les lieux touchés (à côté
// de MC.Politique.quetesActives(politique), qui ne connaît que les quêtes de
// FACTION — celles-ci sont proposées par un LIEU, pas par une faction).
let quetesCatastrophe = [];
/* Déclenchée par la VRAIE météo/le VRAI volcanisme du monde (monde.meteo,
   monde.bio), jamais par un appel isolé : pour chaque lieu habité proche
   d'un joueur, une tornade/un cyclone actif qui le traverse endommage
   réellement ses bâtiments (ENV-001), fait migrer sa population vers le
   lieu viable le plus proche (ENV-004) et propose une quête de secours
   (QUETE-003) ; cette fonction ne touche PAS aux routes elle-même (ENV-002
   est câblée côté client, dans `src/game.js:convois`, seul vrai système de
   caravane actif du jeu — voir `MC.Routes.trajetsAffectesParEruption`,
   consultée là, pas ici). */
function avancerCatastrophes() {
  if (!monde.habitats || !monde.meteo) return;
  const lieux = [];
  tousLesJoueurs().forEach(({ js }) => {
    const p = js.joueur.state.pos;
    monde.habitats.lieuxProches(p.x, p.z, 1500).forEach(l => { if (lieux.indexOf(l) < 0) lieux.push(l); });
  });
  if (!lieux.length) return;
  const evenements = (monde.meteo.tornades ? monde.meteo.tornades(heure) : [])
    .map(t => Object.assign({ genre: 'tornade' }, t))
    .concat((monde.meteo.cyclones ? monde.meteo.cyclones(heure) : []).map(c => Object.assign({ genre: 'cyclone' }, c)));
  lieux.forEach(l => {
    evenements.forEach(evt => {
      const d = Math.hypot(evt.x - l.x, evt.z - l.z);
      if (d > (l.demi || 0) + (evt.rayon || 0)) return;
      const cle = l.id + ':' + evt.id;
      if (catastrophesAppliquees.has(cle)) return;
      catastrophesAppliquees.add(cle);
      if (catastrophesAppliquees.size > 5000) catastrophesAppliquees.clear();
      const entry = MC.Habitats.endommagerLieu(l, [{ x: evt.x, z: evt.z, rayon: evt.rayon, force: evt.force }],
                                                CONF.graine, heure, evt.genre);
      if (!entry || !entry.blocs) return;
      const voisins = monde.habitats.lieuxProches(l.x, l.z, 3000).filter(v => v.id !== l.id && v.pnjs && v.pnjs.length);
      if (voisins.length) MC.Habitats.migrerPopulation(l, voisins[0], entry.ampleur, CONF.graine);
      const q = MC.Habitats.queteCatastrophe(l, entry);
      if (q && !quetesCatastrophe.some(x => x.id === q.id)) {
        quetesCatastrophe.push(q);
        if (quetesCatastrophe.length > 40) quetesCatastrophe.shift();
        const m = chat.systeme(l.nom + ' a été frappé par ' + (evt.genre === 'cyclone' ? 'un cyclone' : 'une tornade') +
                                ' : une quête de secours est proposée (/quete lister).');
        if (m) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
      }
    });
  });
  quetesCatastrophe = quetesCatastrophe.filter(q => MC.Habitats.queteActive(q, heure));
}
/* SPEC-ARCHI-022 : les tornades POUSSENT et ARRACHENT côté serveur — seul le
   serveur modifie vitesse et blocs ; le client ne fait que le rendu. Même
   poussée que l'ancienne simulation cliente (aspiration, rotation, soulèvement
   de `Meteo.pousseeTornade`), appliquée aux joueurs qui ne volent pas et à
   toutes les créatures ; les plantes et feuillages du cœur d'une tornade
   proche d'un joueur sont arrachés (BLOC diffusé). */
let accArrachage = 0;
function appliquerTornades(dt, joueurs) {
  const me = monde.meteo;
  if (!me || !me.tornades || !me.pousseeTornade || !joueurs.length) return;
  const ts = me.tornades(heure);
  if (!ts.length) return;
  const pousser = (pos, vel, k) => {
    if (!ts.some(t => Math.hypot(t.x - pos.x, t.z - pos.z) < t.rayon * 2.2)) return;   // hors de portée d'action
    const sol = monde.heightAt(Math.floor(pos.x), Math.floor(pos.z));
    const f = me.pousseeTornade(pos.x, Math.max(0, pos.y - sol), pos.z, heure, ts);
    if (Math.abs(f.x) + Math.abs(f.y) + Math.abs(f.z) < 0.01) return;
    vel.x += f.x * dt * 3 * k; vel.z += f.z * dt * 3 * k;
    vel.y = Math.min(12, vel.y + f.y * dt * 5 * k);
  };
  joueurs.forEach(({ js }) => { const st = js.joueur.state; if (!st.dead && !st.flying) pousser(st.pos, st.vel, 1); });
  entites.list.forEach(e => { if (!e.dead && e.pos && e.vel) pousser(e.pos, e.vel, 1.3); });
  accArrachage += dt;
  if (accArrachage < 0.2) return;
  accArrachage = 0;
  ts.forEach(t => {
    if (!joueurs.some(({ js }) => Math.hypot(t.x - js.joueur.state.pos.x, t.z - js.joueur.state.pos.z) <= 160)) return;
    for (let k = 0; k < 4; k++) {
      const a = Math.random() * 6.2832, r = Math.random() * t.rayon;
      const x = Math.floor(t.x + Math.cos(a) * r), z = Math.floor(t.z + Math.sin(a) * r);
      if (!monde.estCharge(x, z)) continue;
      let y = Math.min(C.WORLD_H - 1, monde.heightAt(x, z) + 12);
      while (y > 1 && !monde.getBlock(x, y, z)) y--;
      const d = C.BLOCKS[monde.getBlock(x, y, z)];
      if (d && (d.plant || d.leaves) && !d.aquatique) {
        monde.setBlock(x, y, z, 0);
        diffuser({ t: NP.MSG.BLOC, x, y, z, id: 0 });
      }
    }
  });
}
/* SPEC-ARCHI-034 : les gardes et gardiens des donjons s'éveillent côté serveur
   (auparavant réservé au jeu hors ligne : en ligne aucun gardien n'apparaissait).
   Mêmes conditions qu'avant : un donjon vaincu ne se réveille pas ; les gardes
   d'une salle s'éveillent une fois. */
function surveillerDonjonsServeur() {
  if (!regles.monstres) return;
  tousLesJoueurs().forEach(({ js }) => {
    const p = js.joueur.state;
    if (p.dead) return;
    const pc = monde.pieceDonjon && monde.pieceDonjon(p.pos.x, p.pos.y + 0.5, p.pos.z);
    if (pc && !monde.donjonsVaincus.has(pc.donjon.id) && entites.invoquerGardes(pc.donjon, pc.index).length) {
      const m = chat.systeme('Des gardes vous barrent la route !');
      if (m) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
    }
    const d = monde.salleDonjon(p.pos.x, p.pos.y + 0.5, p.pos.z);
    if (!d || monde.donjonsVaincus.has(d.id)) return;
    const b = entites.invoquerGardien(d);
    if (b) {
      const m = chat.systeme(entites.SPECS[b.type].nom + " s'éveille !");
      if (m) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
    }
  });
}
// ── économie (B2, L45) ───────────────────────────────────────────────────────
/* SPEC-ECO/METIER : avance l'économie d'un jour de jeu à la fois (comme
   avancerPolitique), rattrapée d'un coup si besoin, sur les lieux déjà
   connus de `economie` (ceux que `offresPour`/TROC ont créés — un lieu
   jamais visité n'existe pas encore, § 13 du plan). Applique aussi le frais
   de garde quotidien sur CHAQUE banque connue : la Map `banques` (canon(nom)
   → conteneur banque du joueur) est fournie par B1 (inventaire et
   conteneurs serveur, L43) — tant que B1 n'est pas fusionné, elle n'existe
   pas et ce bloc ne fait simplement rien (attendu, voir docs/vague-2/B2.md). */
function avancerEconomie() {
  const jourCourant = Math.floor(heure / MC.DayCycle.DAY_LENGTH);
  const saisonJour = MC.DayCycle.saison ? MC.DayCycle.saison(heure).nom : 'ete';
  while (economie.jour < jourCourant) MC.Economie.tickJour(economie, economie.jour + 1, saisonJour);
  if (typeof banques !== 'undefined' && banques && banques.forEach) {
    banques.forEach(b => { if (b && b.slots) MC.Economie.appliquerFraisBanque(b.slots, 1); });
  }
}
// ── caravanes marchandes : passage économique réel et risque d'attaque ──────
/* SPEC-ECO-004 (fusionnée sans jamais être déclenchée en jeu — game.js:convois
   n'en affiche que le rendu visuel, § convois plus haut) et SPEC-TRANSPORT-003 :
   pour chaque route de commerce/axe partant d'une ville que des joueurs
   connectés ont approchée, chaque départ déjà ARRIVÉ à destination
   (MC.Caravanes.arriveesJusqua) déplace réellement sa cargaison
   (MC.Economie.passageCaravane), idempotent par trajet (registre ci-dessous,
   distinct de `economie.departs` qui, lui, protège passageCaravane elle-même
   d'un double appel). Le tronçon est jugé dangereux — attaque possible —
   exactement comme zones.js le fait pour la zone de jeu : `monde.zoneEn`
   incorpore déjà l'influence d'un territoire de faction en guerre
   (SPEC-FACTION-014), donc un seul test ('pvp'/'pvp_pve') couvre les deux
   conditions de la fiche (territoire en guerre OU zone pvp). */
const arriveesCaravanesTraitees = new Map();   // trajet.id -> dernier index d'arrivée traité
function avancerCaravanes() {
  if (!monde.habitats || !monde.routes || !MC.Caravanes || !monde.zoneEn) return;
  const villes = [];
  tousLesJoueurs().forEach(({ js }) => {
    const p = js.joueur.state.pos;
    monde.habitats.lieuxProches(p.x, p.z, 900).forEach(l => {
      if ((l.kind === 'ville' || l.kind === 'megapole') && !villes.some(v => v.id === l.id)) villes.push(l);
    });
  });
  villes.forEach(v => {
    MC.Caravanes.trajetsDe(v, monde.routes).forEach(tr => {
      const depuis = arriveesCaravanesTraitees.has(tr.id) ? arriveesCaravanesTraitees.get(tr.id) : null;
      const arrivees = MC.Caravanes.arriveesJusqua(tr, heure, depuis);
      if (!arrivees.length) return;
      arriveesCaravanesTraitees.set(tr.id, arrivees[arrivees.length - 1]);
      if (arriveesCaravanesTraitees.size > 4000) arriveesCaravanesTraitees.clear();
      const cumul = tr.cumul || MC.Caravanes.longueurs(tr.noeuds);
      const mi = MC.Caravanes.pointA(tr.noeuds, cumul, cumul[cumul.length - 1] / 2);
      const zoneMi = monde.zoneEn(mi.x, mi.z).zone;
      const danger = zoneMi === 'pvp' || zoneMi === 'pvp_pve';
      // id de destination : dernier segment de l'id du trajet ('r:<origine>><dest>') —
      // le MÊME identifiant de lieu que MC.Habitats/le troc (ent.lieu, SPEC-SYNC-023),
      // pour que ce passage agisse sur la VRAIE économie du village, pas une copie
      // parallèle jamais vue par les joueurs qui y commercent.
      const destId = tr.id.slice(tr.id.lastIndexOf('>') + 1);
      arrivees.forEach(k => {
        const r = MC.Economie.passageCaravane(economie, tr, k, {
          origine: { id: v.id, biome: v.biome, x: v.x, z: v.z },
          destination: { id: destId, biome: v.biome, x: mi.x, z: mi.z },
          danger,
        });
        if (r.attaque) {
          const m = chat.systeme('Une caravane venue de ' + v.nom + ' a été attaquée en chemin.');
          if (m) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
        }
      });
    });
  });
}
/* Offres d'un PNJ pour un joueur nommé (SPEC-SYNC-023, action `consulter`) :
   `e` l'entité PNJ (role, lieu, pnj — voir peuplerLieux plus bas), `nom` le
   nom canonique du joueur (remise METIER-004, jamais diffusé aux autres). */
function offresPour(e, nom) {
  return MC.Economie.offresDe(economie, e.lieu, e.role, e.pnj, nom);
}
// sommet de colonne : qui s'abrite échappe à la foudre
function abriServeur(x, z) {
  for (let y = C.WORLD_H - 1; y > 0; y--) {
    const id = monde.getBlock(x, y, z);
    if (!id) continue;
    const d = C.BLOCKS[id];
    if (d && d.plant && !d.aquatique && !C.isLeaves(id)) continue;
    return y;
  }
  return -1;
}

/* MC_TEST_BLOCS=N : fabrique N blocs modifiés (overrides) au démarrage — réservé au
   banc de sauvegarde (tests/bench-sauvegarde.js, SPEC-ARCHI-012), jamais en
   exploitation. Loin de l'origine, ils ne touchent ni le spawn ni un chunk chargé. */
if (process.env.MC_TEST_BLOCS) {
  const n = parseInt(process.env.MC_TEST_BLOCS, 10) || 0;
  for (let i = 0; i < n; i++) {
    monde.overrides.set((100000 + (i % 1000)) + ',' + (20 + (i % 60)) + ',' + (100000 + Math.floor(i / 1000)), 1 + (i % 40));
  }
}

/* Le serveur a besoin d'un « joueur de référence » pour l'IA des mobs
   (poursuite, apparition). On prend le premier client connecté ; sans client,
   la simulation tourne au ralenti autour de l'origine. */
const spawnCol = monde.findSpawnColumn();
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  monde.getChunk(Math.floor(spawnCol[0] / 16) + cx, Math.floor(spawnCol[1] / 16) + cz, true);
}
/* MC_TEST_SPAWN='x,y,z' : réservé aux suites d'intégration (même principe que
   MC_TEST_INV/MC_TEST_PANNE, désactivé par défaut) — impose le point
   d'apparition, par exemple à l'intérieur d'un donjon déjà généré pour la
   graine choisie, sans quoi aucun test ne peut approcher à portée d'un
   coffre de donjon réel (aucune mécanique d'escalade ou de téléportation
   n'existe côté client pour l'atteindre autrement). N'affecte jamais la
   génération elle-même, seulement où le premier joueur apparaît. */
let SPAWN;
const MC_TEST_SPAWN = process.env.MC_TEST_SPAWN ? process.env.MC_TEST_SPAWN.split(',').map(Number) : null;
if (MC_TEST_SPAWN && MC_TEST_SPAWN.length === 3 && MC_TEST_SPAWN.every(Number.isFinite)) {
  SPAWN = { x: MC_TEST_SPAWN[0], y: MC_TEST_SPAWN[1], z: MC_TEST_SPAWN[2] };
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    monde.getChunk(Math.floor(SPAWN.x / 16) + cx, Math.floor(SPAWN.z / 16) + cz, true);
  }
} else {
  SPAWN = {
    x: spawnCol[0] + 0.5,
    y: monde.groundAt(spawnCol[0], spawnCol[1], true) + 1.2,
    z: spawnCol[1] + 0.5,
  };
}
/* SPEC-ARCHI-041 : la recherche des lieux de l'épopée (village, ville, ermite, trois donjons) génère du
   terrain : on la fait ICI, au démarrage, plutôt qu'au premier joueur (elle bloquerait le serveur). */
if (regles.histoire && PARAMS_HISTOIRE.archetype === 'epopee' && !histoireMonde.liens) {
  const t0Histoire = Date.now();
  histoireMonde.liens = MC.Histoire.lier(monde, SPAWN.x, SPAWN.z);
  journal(`histoire : lieux liés au monde en ${Date.now() - t0Histoire} ms`);
  // persistés tout de suite : un redémarrage de la même partie ne refait pas ce calcul (l'écran d'attente de ARCHI-017 couvre ce délai la première fois)
  if (CONF.mondeFichier) setTimeout(() => sauvegarderMondeAsync('liens de l\'histoire', true), 3000);
}
/* MC_TEST_MOBS='[["sheep",1.5,0]]' : réservé aux suites d'intégration (même
   principe que MC_TEST_SPAWN, désactivé par défaut) — fait apparaître des
   créatures à des décalages [type, dx, dz] du point d'apparition, pour tester
   le combat et le butin sans attendre une apparition aléatoire. */
if (process.env.MC_TEST_MOBS) {
  journal('ATTENTION : MC_TEST_MOBS actif — des créatures sont posées au point d apparition (réglage de test, jamais en exploitation)');
  try {
    JSON.parse(process.env.MC_TEST_MOBS).forEach(([type, dx, dz, role]) => {
      // 4e élément facultatif : le métier d'un habitant (ex. « forgeron »)
      if (entites.SPECS[type]) entites.spawn(type, SPAWN.x + (+dx || 0), SPAWN.y, SPAWN.z + (+dz || 0), role ? { role: String(role), nom: 'Test' } : undefined);
    });
  } catch (e) { /* réglage de test invalide : ignoré */ }
}

/* MC_TEST_MOB='sheep' : réservé aux suites d'intégration (comme MC_TEST_SPAWN, désactivé
   par défaut) — une créature PASSIVE posée à 0,3 bloc du point d'apparition, pour
   prouver que les créatures repoussent le joueur (SPEC-ARCHI-037). */
if (process.env.MC_TEST_MOB) {
  const t = process.env.MC_TEST_MOB;
  const m = entites.spawn(t, SPAWN.x + 0.3, SPAWN.y, SPAWN.z);
  if (m) m.wanderCd = 1e9;
}

// ── clients ──────────────────────────────────────────────────────────────────
let prochainId = 1;
const clients = new Map();          // id -> {id, nom, socket, pos, yaw, pitch, locaux, vivant}

// ── pause, terminaison et un seul poste (SPEC-ARCHI-007 à 011) ───────────────
/* La pause concerne le POSTE (une connexion applicative, n joueurs locaux) et
   n'existe qu'en réseau FERMÉ : en mode ouvert d'autres joueurs partagent le
   monde, aucune pause ne peut l'arrêter. Elle gèle TOUT ce qui avance avec le
   temps (la boucle ne fait plus de pas et rebase `dernier` : la reprise ne
   rattrape rien, SPEC-ARCHI-010/011). */
let enPause = false;
let pauseRev = 0;
let pauseParAbsence = false;       // pause posée par le serveur quand le dernier client est parti
let minuteurAbsence = null;
let arretEnCours = false;
const GRACE_ARRET_MS = parseInt(process.env.MC_GRACE_ARRET_MS, 10) || CA.BORNES.GRACE_ARRET_S * 1000;
function messagePause() { return { t: NP.MSG.PAUSE_ETAT, actif: enPause, rev: pauseRev }; }
function definirPause(actif, parAbsence) {
  actif = !!actif;
  if (actif === enPause) return;
  enPause = actif; pauseRev++; pauseParAbsence = actif && !!parAbsence;
  dernier = performance.now();                     // rebasage : le premier dt de la reprise ne contient pas la pause
  if (actif) sauvegarderMondeAsync('pause', true);
  diffuser(messagePause());
  journal(actif ? 'monde en pause' : 'reprise du monde');
}
function armerAbsence(delaiMs) {
  if (minuteurAbsence) return;
  const delai = delaiMs || GRACE_ARRET_MS;
  journal(`plus aucun client — arrêt dans ${delai / 1000} s sans reconnexion`);
  minuteurAbsence = setTimeout(() => {
    minuteurAbsence = null;
    if (clientsActifs() === 0 && !reseauOuvert) arreter('absence de client');
  }, delai);
}
/* Un client se (re)connecte : le délai de grâce est annulé, et une pause posée
   par l'absence (pas par le joueur) est levée — l'actualisation de la page
   reprend la partie. Une pause demandée par le joueur, elle, persiste. */
/* Un client est « actif » s'il a rejoint la partie OU s'il parle au poste (PAUSE,
   RESEAU, ARRET depuis la boucle locale : c'est la liaison de statut du menu). Une
   WebSocket qui s'ouvre sans jamais rien faire ne compte pas : elle ne retarde
   ni n'annule l'arrêt du serveur orphelin. */
function clientsActifs() {
  let n = 0;
  clients.forEach(x => { if (x.poste) n++; });
  return n;
}
function marquerPoste(c) {
  if (c.poste) return;
  c.poste = true;
  clientPresent();
}
function clientPresent() {
  if (minuteurAbsence) { clearTimeout(minuteurAbsence); minuteurAbsence = null; }
  if (pauseParAbsence) definirPause(false);
}

function diffuser(msg, saufId) {
  const trame = NP.encoder(JSON.stringify(msg), NP.OP.TEXTE, Buffer.alloc);
  clients.forEach(c => {
    if (c.id === saufId || !c.vivant) return;
    try { c.socket.write(trame); } catch (e) { fermer(c, 'ecriture impossible'); }
  });
}
/* SPEC-SYNC-018/019 : les changements de blocs que le MONDE décide (croissance
   des cultures, étapes du feu) ne vont qu'aux clients dont un joueur est à
   moins de PORTEE_BLOCS_MONDE blocs, en UNE écriture par client et par tic
   (les trames sont concaténées), plafonnée à BLOCS_MONDE_MAX_PAR_TIC blocs par
   client : au-delà, le surplus est abandonné pour ce client (il retrouve l'état
   exact par les overrides quand il recharge le chunk). */
const PORTEE_BLOCS_MONDE = parseInt(process.env.MC_TEST_PORTEE_BLOCS, 10) || 96, BLOCS_MONDE_MAX_PAR_TIC = 128;
if (process.env.MC_TEST_PORTEE_BLOCS) setImmediate(() => journal('ATTENTION : MC_TEST_PORTEE_BLOCS actif — portée de diffusion des blocs du monde réduite à ' + PORTEE_BLOCS_MONDE + ' blocs (réglage de test, jamais en exploitation)'));
let blocsMondeEnAttente = [];
function noterBlocMonde(x, y, z, id, etat) { blocsMondeEnAttente.push({ x, y, z, id, etat: etat || 0 }); }
function diffuserBlocsMonde() {
  const liste = blocsMondeEnAttente;
  if (!liste.length) return;
  blocsMondeEnAttente = [];
  const trames = liste.map(b => NP.encoder(JSON.stringify({ t: NP.MSG.BLOC, x: b.x, y: b.y, z: b.z, id: b.id, etat: b.etat }), NP.OP.TEXTE, Buffer.alloc));
  clients.forEach(c => {
    if (!c.vivant || !c.rejoint || !c.joueurs) return;
    const pos = c.joueurs.map(x => x.joueur.state.pos);
    const choisies = [];
    for (let i = 0; i < liste.length && choisies.length < BLOCS_MONDE_MAX_PAR_TIC; i++) {
      const b = liste[i];
      if (pos.some(p => Math.hypot(p.x - b.x, p.z - b.z) < PORTEE_BLOCS_MONDE)) choisies.push(trames[i]);
    }
    if (!choisies.length) return;
    try { c.socket.write(Buffer.concat(choisies)); } catch (e) { fermer(c, 'ecriture impossible'); }
  });
}
/* Résumé de la faction principale d'un joueur (SPEC-ARCHI-029) : { id, nom, rang }
   ou null. Court (jamais l'état complet des guildes), donc sans coût de diffusion. */
function guildeResume(nom) {
  const p = MC.Guildes.factionsDe(guildes, nom).principale;
  const f = p && guildes.factions.get(p);
  return f ? { id: f.id, nom: f.nom, rang: MC.Guildes.rangDe(guildes, f.id, nom) } : null;
}
function envoyer(c, msg) {
  if (!c || !c.vivant) return;
  try {
    c.socket.write(NP.encoder(JSON.stringify(msg), NP.OP.TEXTE, Buffer.alloc));
  } catch (e) { fermer(c, 'ecriture impossible'); }
}

function fermer(c, raison) {
  if (!c || !c.vivant) return;
  c.vivant = false;
  clients.delete(c.id);
  // B1 : range l'inventaire/équipement de chaque joueur local dans le
  // registre nommé (la banque, elle, reste un conteneur vivant dans `banques`).
  if (c.joueurs) {
    c.joueurs.forEach(js => {
      // un conducteur qui part met pied à terre : l'engin reste là, libre, et le siège n'est pas gardé
      const stV = js.joueur && js.joueur.state;
      if (stV && stV.monture) MC.Vehicules.descendre(stV, monde, MC.PlayerConst.PW, MC.PlayerConst.PH);
      if (!js.cleReg) return;
      joueursRegistre.set(js.cleReg, enregistrementJoueur(js));
      if (js.recit) recitsRegistre.set(js.cleReg, RS.exporter(js.recit, js.recitFin));
    });
  }
  if (c.sessionId) MC.Admin.fermerSession(admin, c.sessionId, heure);
  try { c.socket.destroy(); } catch (e) {}
  const m = chat.systeme(c.nom + ' a quitté la partie');
  diffuser({ t: NP.MSG.QUITTE, id: c.id, nom: c.nom });
  if (m) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
  journal(`- ${c.nom} (#${c.id}) parti — ${raison || 'deconnexion'} · ${clients.size} en ligne`);
  /* SPEC-ARCHI-008 (b) : en mode FERMÉ, le départ du dernier client (onglet
     fermé brutalement compris) sauvegarde tout de suite, met le monde en
     pause et arme l'arrêt après le délai de grâce. En mode OUVERT, jamais de
     terminaison sur départ du dernier joueur (c). */
  if (reseauOuvert && c.rejoint && !arretEnCours) sauvegarderAuDepart();
  if (c.poste && !reseauOuvert && clientsActifs() === 0 && !arretEnCours) {
    sauvegarderMondeAsync('dernier client', true);
    definirPause(true, true);
    armerAbsence();
  }
}

/* Mode OUVERT : le départ d'un joueur sauvegarde aussi (un crash ne coûte pas jusqu'à
   toute la cadence de 2 minutes), avec un débounce : au plus une sauvegarde de départ
   toutes les 10 s, jamais un travail par départ à 100 joueurs. */
let departSauveT = null, departSauveDernier = 0;
function sauvegarderAuDepart() {
  if (departSauveT) return;
  const delai = Math.max(1500, departSauveDernier + 10000 - Date.now());
  departSauveT = setTimeout(() => {
    departSauveT = null; departSauveDernier = Date.now();
    if (!arretEnCours) sauvegarderMondeAsync('départ d\'un joueur', true);
  }, delai);
}
function journal(txt) {
  const h = new Date().toTimeString().slice(0, 8);
  console.log(`[${h}] ${txt}`);
}

// ── fichiers statiques ───────────────────────────────────────────────────────
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon',
};

/* Piège classique : « ../../etc/passwd ». On résout le chemin ABSOLU puis on
   vérifie qu'il reste sous la racine — comparer les chaînes avant résolution
   ne suffit pas, l'encodage URL permet de contourner. */
function cheminSur(urlPath) {
  let brut;
  try { brut = decodeURIComponent(urlPath.split('?')[0]); }
  catch (e) { return null; }
  if (brut.indexOf('\0') >= 0) return null;                 // octet nul
  if (brut === '/' || brut === '') brut = '/index.html';
  const resolu = path.resolve(RACINE, '.' + brut);
  const racine = path.resolve(RACINE);
  // le séparateur final évite que /racine-bis passe pour /racine
  if (resolu !== racine && !resolu.startsWith(racine + path.sep)) return null;
  // les parties (index et fichiers de monde) et le fichier --monde ne se servent JAMAIS en statique
  const prives = [DOSSIER_PARTIES, path.resolve(RACINE, 'parties')];
  if (CONF.mondeFichier) prives.push(CONF.mondeFichier);
  for (const d of prives) {
    if (resolu === d || resolu.startsWith(d + path.sep) || resolu.startsWith(d + '.')) return null;
  }
  return resolu;
}

// ── console web d'administration : API HTTP (SPEC-ADMIN-001 à 005/007) ─────
/* Le jeton n'est JAMAIS accepté en paramètre d'URL (un lien reste dans
   l'historique, les journaux du proxy, l'onglet ouvert des semaines) :
   uniquement l'en-tête Authorization, comme n'importe quelle API. */
function roleRequete(req) {
  const ent = req.headers.authorization || '';
  const m = /^Bearer\s+(.+)$/.exec(ent);
  if (!m) return null;
  return MC.Admin.authentifier(admin, m[1]);
}
function lireCorpsJSON(req, cb) {
  let brut = '';
  req.on('data', d => { brut += d; if (brut.length > 8192) req.destroy(); });
  req.on('end', () => { try { cb(brut ? JSON.parse(brut) : {}); } catch (e) { cb({}); } });
}
function repondreJSON(res, code, obj) {
  const corps = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(corps) });
  res.end(corps);
}
/* Défense CSRF sur les routes d'écriture du banc de test (SPEC-BANC-015 et
   la bibliothèque des cahiers, SPEC-BANC-018/019) : même si elles sont déjà
   réservées à `estAdresseLocale` (127.0.0.1/::1), un navigateur ouvert
   localement peut être amené par une page tierce à émettre une requête
   `POST`/`DELETE` vers ces routes (l'attaquant ne LIT pas la réponse grâce à
   CORS, mais l'écriture, elle, a bien lieu — c'est le cœur d'une attaque
   CSRF). On refuse donc toute requête dont l'`Origin` est PRÉSENT mais NE
   correspond PAS à l'origine du serveur lui-même, et toute requête que le
   navigateur qualifie lui-même de `cross-site` via `Sec-Fetch-Site` — les
   deux sont posés par le navigateur, jamais falsifiables depuis une page web
   normale. Correction revue adversariale (1/3, CRITIQUE). */
function requeteFiable(req, port) {
  const origine = req.headers['origin'];
  if (origine) {
    const originesAttendues = [
      'http://127.0.0.1:' + port, 'http://localhost:' + port, 'http://[::1]:' + port,
    ];
    if (originesAttendues.indexOf(origine) < 0) {
      return { ok: false, code: 403, motif: 'origine refusée' };
    }
  }
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site') {
    return { ok: false, code: 403, motif: 'requête intersites refusée' };
  }
  return { ok: true };
}

const RE_API = /^\/admin\/api\/([a-z_]+)\/?$/;
function traiterApiAdmin(req, res) {
  const url = req.url.split('?')[0];
  const mm = RE_API.exec(url);
  if (!mm) return false;
  const action = mm[1];
  const r = roleRequete(req);
  if (!r) { repondreJSON(res, 401, { ok: false, motif: 'non_authentifie' }); return true; }
  if (req.method === 'GET') {
    const q = {};
    new URL(req.url, 'http://localhost').searchParams.forEach((v, k) => { q[k] = v; });
    const res2 = executerActionAdmin(r.role, r.nom || 'console', action, q);
    repondreJSON(res, res2.ok ? 200 : 403, res2);
    return true;
  }
  if (req.method === 'POST') {
    lireCorpsJSON(req, (args) => {
      const res2 = executerActionAdmin(r.role, r.nom || 'console', action, args);
      repondreJSON(res, res2.ok ? 200 : 403, res2);
    });
    return true;
  }
  repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' });
  return true;
}

// ── réception du cahier de test (SPEC-BANC-015) ─────────────────────────────
/* La logique (adresse locale, taille, écriture, élagage) vit ENTIÈREMENT dans
   tools/resultats-tests.js, testable sous Node sans lancer de serveur — ici,
   on ne fait que lire la requête et lui transmettre ce qu'elle seule connaît :
   l'adresse distante et la taille reçue. */
function traiterResultatsTest(req, res) {
  if (req.method !== 'POST') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return true; }
  const fiable = requeteFiable(req, portActuel);
  if (!fiable.ok) { repondreJSON(res, fiable.code, { ok: false, motif: fiable.motif }); return true; }
  const typeContenu = String(req.headers['content-type'] || '');
  if (typeContenu.split(';')[0].trim() !== 'application/json') {
    repondreJSON(res, 415, { ok: false, motif: 'Content-Type attendu : application/json' });
    return true;
  }
  const RT = require('./tools/resultats-tests.js');
  const LIMITE = RT.LIMITE_OCTETS_DEFAUT;
  let brut = '';
  let trop = false;
  req.on('data', (d) => {
    if (trop) return;
    brut += d;
    if (Buffer.byteLength(brut) > LIMITE) { trop = true; repondreJSON(res, 413, { ok: false, motif: 'corps trop volumineux' }); req.destroy(); }
  });
  req.on('end', () => {
    if (trop) return;
    let corps;
    try { corps = JSON.parse(brut); } catch (e) { repondreJSON(res, 400, { ok: false, motif: 'JSON invalide' }); return; }
    const r = RT.traiterEnvoi(corps, {
      adresse: req.socket.remoteAddress, params: PARAMS, tailleOctets: Buffer.byteLength(brut), limiteOctets: LIMITE,
    });
    // `dossierAbsolu` est un détail d'implémentation (chemin disque local) :
    // utile aux appelants Node (tests/run.js), jamais renvoyé par le réseau
    repondreJSON(res, r.code, { ok: r.ok, code: r.code, dossier: r.dossier, rapport: r.rapport, motif: r.motif });
  });
  return true;
}

// ── bibliothèque des cahiers de test (SPEC-BANC-018 à 022) ─────────────────
/* Mêmes protections que /tests/resultats (SPEC-BANC-015) : machine locale
   uniquement. Tout `dossier` de l'URL est vérifié contre la liste RÉELLE des
   cahiers (tools/cahier.js, estCahierValide) avant tout accès disque —
   jamais un chemin construit directement depuis l'URL, ce qui élimine la
   traversée de répertoire par construction plutôt que par filtrage. */
const RE_CAHIER_DOSSIER = /^\/tests\/cahiers\/([^\/?]+)(?:\/(export|comparer|conserver))?\/?$/;
function traiterCahiers(req, res) {
  const url = req.url.split('?')[0];
  if (!(url === '/tests/cahiers' || url === '/tests/cahiers/' || url === '/tests/cahiers/api' || RE_CAHIER_DOSSIER.test(url))) return false;
  const RT = require('./tools/resultats-tests.js');
  if (!RT.estAdresseLocale(req.socket.remoteAddress)) { repondreJSON(res, 403, { ok: false, motif: 'adresse non locale' }); return true; }
  const cahier = require('./tools/cahier.js');
  const racine = RT.DOSSIER_RESULTATS;
  const q = {};
  new URL(req.url, 'http://localhost').searchParams.forEach((v, k) => { q[k] = v; });

  if (url === '/tests/cahiers' || url === '/tests/cahiers/') {
    const p = cheminSur('/tests/cahiers.html');
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return true;
  }
  if (url === '/tests/cahiers/api') { repondreJSON(res, 200, { cahiers: cahier.listerCahiers(racine) }); return true; }

  const mm = RE_CAHIER_DOSSIER.exec(url);
  const dossier = mm[1], action = mm[2];
  if (!cahier.estCahierValide(racine, dossier)) { repondreJSON(res, 404, { ok: false, motif: 'cahier introuvable' }); return true; }

  if (action === 'export' && req.method === 'GET') {
    const format = q.format || 'html';
    try {
      if (format === 'html') { const buf = cahier.exporterHTML(racine, dossier); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + dossier + '.html"' }); res.end(buf); return true; }
      if (format === 'docx') { const buf = cahier.exporterDocx(racine, dossier); res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': 'attachment; filename="' + dossier + '.docx"' }); res.end(buf); return true; }
      if (format === 'pdf') {
        const r = cahier.exporterPDF(racine, dossier);
        if (!r.ok) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Cahier-Repli': 'impression-navigateur' }); res.end(r.page); return true; }
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + dossier + '.pdf"' }); res.end(r.pdf); return true;
      }
      repondreJSON(res, 400, { ok: false, motif: 'format inconnu' });
    } catch (e) { repondreJSON(res, 500, { ok: false, motif: e.message }); }
    return true;
  }
  if (action === 'comparer' && req.method === 'GET') { repondreJSON(res, 200, cahier.compareCahiers(racine, dossier, q.avec)); return true; }
  if (action === 'conserver' && req.method === 'POST') {
    const fiable = requeteFiable(req, portActuel);
    if (!fiable.ok) { repondreJSON(res, fiable.code, { ok: false, motif: fiable.motif }); return true; }
    lireCorpsJSON(req, (args) => { repondreJSON(res, 200, cahier.marquerConserve(racine, dossier, args.valeur !== false)); });
    return true;
  }
  if (!action && req.method === 'DELETE') {
    const fiable = requeteFiable(req, portActuel);
    if (!fiable.ok) { repondreJSON(res, fiable.code, { ok: false, motif: fiable.motif }); return true; }
    repondreJSON(res, 200, cahier.supprimerCahier(racine, dossier)); return true;
  }
  repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' });
  return true;
}

// ── /tests/version (SPEC-BANC-012) ──────────────────────────────────────────
/* L'environnement d'un cahier navigateur doit porter le commit (comme le
   fait déjà l'environnement d'un cahier Node, calculé directement sur
   disque par tests/run.js) : le navigateur n'a pas accès à git, donc le
   noyau le lui sert. Même garde que /tests/cahiers (machine locale
   uniquement) ; GET seulement, pas d'écriture donc pas de risque CSRF. */
function traiterVersion(req, res) {
  if (req.url.split('?')[0] !== '/tests/version') return false;
  const RT = require('./tools/resultats-tests.js');
  if (!RT.estAdresseLocale(req.socket.remoteAddress)) { repondreJSON(res, 403, { ok: false, motif: 'adresse non locale' }); return true; }
  if (req.method !== 'GET') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return true; }
  repondreJSON(res, 200, { commit: COMMIT_GIT, versionJeu: C.VERSION_JEU });
  return true;
}

// ── historique global (docs/banc/historique-global.md, SPEC-BANC-033 à 040) ─
/* Toute la logique de tri/filtre/pagination/agrégation vit dans
   tools/historique.js (pur, testable sous Node sans passer par ici — voir
   tests/spec-historique.js) : ce module se contente de lire la requête, de
   passer les paramètres et de répondre en JSON. L'index en mémoire
   (`tools/historique.js` creerIndex()) est créé UNE SEULE fois pour la vie
   du processus serveur et réutilisé d'une requête à l'autre — c'est lui,
   pas cette fonction, qui décide de reconstruire ou non selon la mtime du
   dossier source (§2 : le registre peut grossir, jamais de lecture complète
   du disque à chaque appel). */
// require paresseux (comme RT/registre.js plus bas) : tools/ n'est pas
// embarqué dans un paquet joué (tools/paquet.js), donc server.js ne doit
// PAS exiger tools/historique.js pour démarrer — seulement si une route
// historique est vraiment appelée (adresse locale uniquement, voir plus bas).
let indiceHistorique = null;
function obtenirIndiceHistorique() {
  if (!indiceHistorique) indiceHistorique = require('./tools/historique.js').creerIndex();
  return indiceHistorique;
}
function parametresRequete(req) {
  const q = {};
  new URL(req.url, 'http://localhost').searchParams.forEach((v, k) => { q[k] = v; });
  return q;
}
function traiterHistorique(req, res) {
  const url = req.url.split('?')[0];
  if (url !== '/tests/historique/lignes' && url !== '/tests/historique/series' && url !== '/tests/historique/images') return false;
  const RT = require('./tools/resultats-tests.js');
  const HIST = require('./tools/historique.js');
  if (!RT.estAdresseLocale(req.socket.remoteAddress)) { repondreJSON(res, 403, { ok: false, motif: 'adresse non locale' }); return true; }
  if (req.method !== 'GET') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return true; }
  const q = parametresRequete(req);
  let filtre;
  try { filtre = q.filtre ? JSON.parse(q.filtre) : {}; }
  catch (e) { repondreJSON(res, 400, { ok: false, motif: 'filtre JSON invalide' }); return true; }
  if (q.rapide) filtre = Object.assign({}, HIST.filtreRapide(q.rapide), filtre);

  const toutes = obtenirIndiceHistorique().lignes();

  if (url === '/tests/historique/lignes') {
    const filtrees = HIST.filtrerLignes(toutes, filtre);
    // tri multi-clés (SPEC-BANC-035) : "tri=etat,duree_ms&ordre=asc,desc"
    // (les deux listes s'alignent par position) — un tri simple est le cas
    // à une seule clé, sans rien changer côté client.
    const champs = (q.tri || '').split(',').filter(Boolean);
    const ordres = (q.ordre || '').split(',');
    const tris = champs.map((champ, i) => ({ champ, ordre: ordres[i] === 'desc' ? 'desc' : 'asc' }));
    const triees = HIST.trierLignes(filtrees, tris);
    const page = HIST.paginer(triees, q.page, q.taille);
    repondreJSON(res, 200, {
      lignes: page.lignes, total: page.total, page: page.page, taille: page.taille,
      effectifs: HIST.effectifsToutesEnum(filtrees),
    });
    return true;
  }
  if (url === '/tests/historique/series') {
    const filtrees = HIST.filtrerLignes(toutes, filtre);
    const props = (q.props || '').split(',').filter(Boolean);
    repondreJSON(res, 200, { serie: HIST.serieAgregee(filtrees, { x: q.x, props: props }) });
    return true;
  }
  // /tests/historique/images
  if (!q.test) { repondreJSON(res, 400, { ok: false, motif: 'paramètre test requis' }); return true; }
  repondreJSON(res, 200, { images: HIST.imagesDeTest(toutes, q.test, { filtre: filtre, tri: q.tri }) });
  return true;
}

// GET /tests/registre/images/<sha1>.<ext> (SPEC-BANC-040) : images du
// registre, adressées par contenu (tools/registre.js) — IMMUABLES (un sha1
// donné désigne toujours le même contenu), d'où le cache long. Le chemin est
// vérifié par une expression régulière STRICTE (sha1 + extension connue)
// avant tout accès disque — même politique que /tests/cahiers, aucun chemin
// construit directement depuis l'URL.
const RE_IMAGE_REGISTRE = /^\/tests\/registre\/images\/([0-9a-f]{40})\.(jpg|jpeg|png|webp)$/;
const MIME_IMAGE_REGISTRE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
function traiterImageRegistre(req, res) {
  const url = req.url.split('?')[0];
  const mm = RE_IMAGE_REGISTRE.exec(url);
  if (!mm) return false;
  if (req.method !== 'GET') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return true; }
  const REG = require('./tools/registre.js');
  const chemin = path.join(REG.DOSSIER_IMAGES, mm[1] + '.' + mm[2]);
  fs.stat(chemin, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('404 introuvable'); return; }
    res.writeHead(200, Object.assign({
      'Content-Type': MIME_IMAGE_REGISTRE[mm[2]] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'public, max-age=31536000, immutable',
    }, NP.entetesSecuriteStatiques()));
    fs.createReadStream(chemin).pipe(res);
  });
  return true;
}

// ── API des parties (SPEC-ARCHI-013, 015) ────────────────────────────────────
/* Le menu du jeu (créer, charger, renommer, supprimer, lister, importer) agit
   par cette API HTTP, RÉSERVÉE à la boucle locale et aux origines locales
   (mêmes règles que SPEC-ARCHI-003), quel que soit le mode réseau : un joueur
   distant n'a aucun droit sur les parties de la machine hôte. */
const CORPS_API_MAX = 64 * 1024 * 1024;       // un export de plusieurs parties peut être volumineux
function lireCorpsGros(req, max, cb) {
  const morceaux = [];
  let taille = 0, depasse = false;
  req.on('data', (d) => {
    taille += d.length;
    if (taille > max) { depasse = true; req.destroy(); return; }
    morceaux.push(d);
  });
  req.on('end', () => {
    if (depasse) return;
    try { cb(null, morceaux.length ? JSON.parse(Buffer.concat(morceaux).toString('utf8')) : {}); }
    catch (e) { cb(e); }
  });
}
/* Garde commune des routes réservées à la boucle locale (API des parties, serveur d'histoire de test) :
   adresse locale ET hôte local ET pas de mandataire ET origine/Sec-Fetch-Site sûrs. Renvoie le motif
   du refus, ou null. */
function refusRequeteLocale(req) {
  if (req.headers['x-forwarded-for'] || req.headers['forwarded'] || req.headers['x-real-ip']) return 'mandataire refusé';     // comme connexionLocale
  if (!CA.estAdresseLocale(req.socket.remoteAddress)) return 'adresse non locale';
  const origine = req.headers['origin'];
  if (origine && CA.originesLocales(portActuel).indexOf(origine) < 0) return 'origine refusée';
  if (!hoteLocal(req)) return 'hôte refusé';
  if (req.headers['sec-fetch-site'] === 'cross-site') return 'requête intersites refusée';
  return null;
}
function apiPartiesAutorisee(req, res) {
  const motif = refusRequeteLocale(req);
  if (motif) { repondreJSON(res, 403, { ok: false, motif }); return false; }
  return true;
}
let derniereDemandeSauvegarde = 0;
function entierOuNul(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v ? v : null; }
function traiterApiParties(req, res) {
  if (!apiPartiesAutorisee(req, res)) return;
  const sous = req.url.split('?')[0].replace(/\/+$/, '').slice('/api/parties'.length);
  if (req.method === 'GET' && sous === '') {
    repondreJSON(res, 200, {
      ok: true, actif: partieActive ? partieActive.id : null, parties: MC.Saves.lister(stockageParties),
      reseau: reseauOuvert ? CA.ETAT_RESEAU.OUVERT : CA.ETAT_RESEAU.FERME, port: portActuel, adresses: adressesActives,
      dedie: !!(CONF.mondeFichier && !partieActive),
      // instantané du monde pour les lanceurs et les tests : l'heure, la pause, les créatures
      monde: {
        heure: +heure.toFixed(3), pause: enPause, rev: pauseRev, clients: clients.size, pid: process.pid,
        creatures: entites.list.length,
        fours: Array.from(conteneursPoses.entries()).filter(([, ct]) => ct.four)
          .map(([cle, ct]) => ({ cle, burn: +ct.four.burn.toFixed(3), cook: +ct.four.cook.toFixed(3), sortie: ct.slots[2] ? ct.slots[2].n : 0 })),
        sigCreatures: +entites.list.reduce((a, e) => a + e.pos.x + e.pos.z, 0).toFixed(3),
      },
    });
    return;
  }
  if (req.method !== 'POST') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return; }
  lireCorpsGros(req, sous === '/importer' ? CORPS_API_MAX : 65536, (err, corps) => {
    if (err) { repondreJSON(res, 400, { ok: false, motif: 'json_invalide' }); return; }
    const id = corps && typeof corps.id === 'string' ? corps.id : null;
    const connue = id && MC.PartiesFichier.idValide(id) ? MC.Saves.trouver(stockageParties, id) : null;
    switch (sous) {
      case '': {                                                           // créer
        const graine = entierOuNul(corps.graine);
        const meta = MC.Saves.creer(stockageParties, {
          nom: typeof corps.nom === 'string' ? corps.nom.trim() : '',
          mode: MC.Modes.MODES[corps.mode] ? corps.mode : 'survie',
          difficulte: MC.Modes.DIFFICULTES[corps.difficulte] ? corps.difficulte : 'facile',
          graine: graine === null ? undefined : graine,
          histoire: corps.histoire && typeof corps.histoire === 'object' ? corps.histoire : null,
        });
        if (graine !== null) MC.Saves.majMeta(stockageParties, meta.id, { graine });
        const enreg = MC.Saves.trouver(stockageParties, meta.id);
        if (!enreg) { repondreJSON(res, 500, { ok: false, motif: 'ecriture_impossible' }); return; }
        repondreJSON(res, 201, { ok: true, partie: enreg });
        return;
      }
      case '/charger': {
        if (!connue) { repondreJSON(res, 404, { ok: false, motif: 'partie_inconnue' }); return; }
        if (partieActive && partieActive.id === connue.id) { repondreJSON(res, 200, { ok: true, relance: false, partie: connue }); return; }
        repondreJSON(res, 200, { ok: true, relance: true, partie: connue, port: portActuel });
        res.on('finish', () => relancerSurPartie(connue.id));
        return;
      }
      /* SPEC-ARCHI-036 : « Sauvegarder » du menu pause (ou la touche) est une
         DEMANDE au serveur, qui reste seul à écrire la partie. Réservée à la
         boucle locale par apiPartiesAutorisee (jamais un joueur distant),
         espacée d'une seconde au moins (la sérialisation bloque la boucle) ;
         omise, comme toute sauvegarde événementielle, si le monde n'a pas bougé. */
      case '/sauver': {
        if (!CONF.mondeFichier) { repondreJSON(res, 409, { ok: false, motif: 'pas_de_partie' }); return; }
        const t = Date.now();
        if (t - derniereDemandeSauvegarde < 1000) { repondreJSON(res, 429, { ok: false, motif: 'trop_frequent' }); return; }
        derniereDemandeSauvegarde = t;
        const avant = nbEcritures;
        sauvegarderMondeAsync('demande du joueur', true);
        /* On répond quand PLUS AUCUNE écriture n'est en vol : une écriture périodique déjà
           en cours n'a pas capturé l'état actuel, la sauvegarde redemandée qui la suit oui. */
        const limite = Date.now() + 5000;
        (async () => {
          while (sauvegardeEnCoursAttente && Date.now() < limite) {
            let minuterie;
            await Promise.race([sauvegardeEnCoursAttente, new Promise((r) => { minuterie = setTimeout(r, Math.max(1, limite - Date.now())); })]);
            clearTimeout(minuterie);
          }
          repondreJSON(res, 200, { ok: true, ecrite: nbEcritures > avant, enVol: !!sauvegardeEnCoursAttente });
        })();
        return;
      }
      case '/renommer': {
        if (!connue) { repondreJSON(res, 404, { ok: false, motif: 'partie_inconnue' }); return; }
        const m = MC.Saves.renommer(stockageParties, connue.id, corps.nom);
        if (partieActive && partieActive.id === connue.id && m) partieActive = m;
        repondreJSON(res, 200, { ok: true, partie: m });
        return;
      }
      case '/supprimer': {
        if (!connue) { repondreJSON(res, 404, { ok: false, motif: 'partie_inconnue' }); return; }
        if (partieActive && partieActive.id === connue.id) { CONF.mondeFichier = null; partieActive = null; }   // plus rien à sauvegarder
        MC.Saves.supprimer(stockageParties, connue.id);
        repondreJSON(res, 200, { ok: true });
        return;
      }
      case '/importer': {
        const r = MC.PartiesFichier.analyserExport(corps);
        if (r.erreur) { repondreJSON(res, 400, { ok: false, motif: r.erreur }); return; }
        const importees = [], ignorees = r.ignorees.slice();
        r.parties.forEach((p) => {
          try {
            const nouvelle = MC.Saves.trouver(stockageParties, p.meta.id) ? MC.Saves.nouvelId() : p.meta.id;
            const fichier = MC.PartiesFichier.migrerSauvegarde(p.meta, p.data);
            const m = MC.PartiesFichier.metaImportee(p.meta, p.data);
            /* Le fichier de monde d'abord (une migration ou une écriture qui échoue ne laisse
               alors aucune entrée d'index vide), puis l'index ; si l'index échoue, on retire le
               fichier : jamais de fichier orphelin. */
            stockageParties.setItem(MC.Saves.slotKey(nouvelle), JSON.stringify(fichier));
            try {
              MC.Saves.creer(stockageParties, { id: nouvelle, nom: m.nom, mode: m.mode, difficulte: m.difficulte, graine: m.graine, histoire: m.histoire });
              if (!MC.Saves.trouver(stockageParties, nouvelle)) throw new Error('index illisible ou non inscriptible');
              MC.Saves.majMeta(stockageParties, nouvelle, { graine: m.graine, versionCarte: m.versionCarte, creeLe: m.creeLe, majLe: m.majLe, duree: m.duree, morte: m.morte });
            } catch (e) {
              MC.Saves.supprimer(stockageParties, nouvelle);       // retire l'entrée d'index éventuelle ET le fichier
              throw e;
            }
            importees.push(nouvelle);
          } catch (e) { ignorees.push({ id: p.meta.id, motif: e.message }); }
        });
        repondreJSON(res, 200, { ok: true, importees, ignorees });
        return;
      }
      default: repondreJSON(res, 404, { ok: false, motif: 'route_inconnue' });
    }
  });
}
/* Bascule de partie : le monde (graine, fichier, règles) est construit UNE FOIS
   au lancement du processus ; charger une autre partie sauvegarde la courante
   puis relance le même serveur sur la partie choisie, sur le MÊME port et dans
   le même mode réseau (SPEC-ARCHI-013 : « décharge la précédente en la
   sauvegardant »). Le client, dont la connexion se coupe, attend que l'API
   réponde de nouveau puis se reconnecte. */
function relancerSurPartie(id) {
  if (arretEnCours) return;
  arretEnCours = true;
  journal(`bascule vers la partie ${id}`);
  sauvegardeArretee = true;
  if (minuteurAbsence) { clearTimeout(minuteurAbsence); minuteurAbsence = null; }
  sauvegarderMondeSync();
  const conserves = [];
  for (let k = 0; k < argvBrut.length; k++) {
    const t = argvBrut[k];
    if (/^--(partie|monde|graine|port)(=|$)/.test(t)) { if (t.indexOf('=') < 0) k++; continue; }
    if (t === '--ouvert') continue;
    conserves.push(t);
  }
  const args = [__filename, ...conserves, '--partie', id, '--port', String(portActuel)];
  if (reseauOuvert) args.push('--ouvert');
  clients.forEach(c => { try { c.socket.destroy(); } catch (e) {} });
  fermerEcouteurs().then(() => {
    const enfant = require('child_process').spawn(process.execPath, args, {
      detached: true, stdio: 'inherit', windowsHide: true, cwd: process.cwd(),
      env: Object.assign({}, process.env, { MC_RELANCE: '1', MC_ADMIN_HERITE: ADMIN_SECRET }),
    });
    enfant.unref();
    setTimeout(() => process.exit(0), 100);
  });
}

/* SPEC-ARCHI-041 (banc d'essai) : les e2e du mode histoire jouent sur un VRAI serveur en mode
   histoire. Le serveur de test (--tests) en lance un second, jetable, sur un port libre : mode
   histoire, paramètres du récit donnés par la page ; il s'arrête avec son parent (jamais d'orphelin).
   Réservé au serveur lancé avec --tests, depuis la boucle locale ; sans --tests la route n'existe pas. */
let serveurHistoireTest = null;
function arreterServeurHistoireTest() {
  if (serveurHistoireTest) { try { serveurHistoireTest.kill(); } catch (e) { /* déjà parti */ } serveurHistoireTest = null; }
}
function traiterServeurHistoireTest(req, res) {
  if (!PARAMS.tests) return false;
  if (req.method !== 'POST') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return true; }
  const refus = refusRequeteLocale(req);
  if (refus) { repondreJSON(res, 403, { ok: false, motif: refus }); return true; }
  if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') {
    repondreJSON(res, 415, { ok: false, motif: 'Content-Type attendu : application/json' });
    return true;
  }
  lireCorpsJSON(req, (corps) => {
    arreterServeurHistoireTest();
    const histoire = corps && corps.histoire && typeof corps.histoire === 'object' ? corps.histoire : {};
    const graine = corps && Number.isInteger(corps.graine) ? corps.graine : CONF.graine;
    const enfant = require('child_process').spawn(process.execPath, [__filename, '--port', '0', '--serveur'], {
      cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
      env: Object.assign({}, process.env, {
        MC_MODE: 'histoire', MC_HISTOIRE: JSON.stringify(histoire), MC_GRAINE: String(graine),
        MC_TEST_POSE_LIBRE: '1', MC_TEST_ARRET_SI_MORT: String(process.pid),
        MC_TEST_PRES_GUIDE: corps && corps.presGuide ? '1' : '',
      }),
    });
    serveurHistoireTest = enfant;
    let sortie = '', repondu = false;
    const repondre = (code, obj) => { if (repondu) return; repondu = true; clearTimeout(limite); repondreJSON(res, code, obj); };
    const limite = setTimeout(() => { arreterServeurHistoireTest(); repondre(504, { ok: false, motif: 'demarrage_trop_long' }); }, 90000);
    const ecouteSortie = (d) => {
      sortie += d;
      const m = /MC_PORT=(\d+)/.exec(sortie);
      if (!m) return;
      enfant.stdout.removeListener('data', ecouteSortie);     // plus rien à lire : on vide sans accumuler
      enfant.stdout.on('data', () => {});
      sortie = '';
      repondre(200, { ok: true, port: parseInt(m[1], 10) });
    };
    enfant.stdout.on('data', ecouteSortie);
    enfant.stderr.on('data', () => {});
    enfant.on('exit', () => { if (serveurHistoireTest === enfant) serveurHistoireTest = null; repondre(500, { ok: false, motif: 'serveur_arrete' }); });
  });
  return true;
}
function servir(req, res) {
  // rebond DNS : en mode fermé, toute requête HTTP doit viser un nom local
  if (!reseauOuvert && !hoteLocal(req)) { res.writeHead(403); res.end('403 hôte refusé'); return; }
  if (req.url.split('?')[0].indexOf('/api/parties') === 0) { traiterApiParties(req, res); return; }
  if (req.url.indexOf('/admin/api/') === 0 && traiterApiAdmin(req, res)) return;
  if (req.url.split('?')[0] === '/tests/resultats' && traiterResultatsTest(req, res)) return;
  if (req.url.split('?')[0] === '/tests/version' && traiterVersion(req, res)) return;
  if (req.url.split('?')[0] === '/tests/serveur-histoire' && traiterServeurHistoireTest(req, res)) return;
  if (req.url.indexOf('/tests/cahiers') === 0 && traiterCahiers(req, res)) return;
  if (req.url.indexOf('/tests/historique/') === 0 && traiterHistorique(req, res)) return;
  if (req.url.indexOf('/tests/registre/images/') === 0 && traiterImageRegistre(req, res)) return;
  const chemin = cheminSur(req.url);
  if (!chemin) { res.writeHead(403); res.end('403 chemin refusé'); return; }
  fs.stat(chemin, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('404 introuvable'); return; }
    // SPEC-SECU-010 : en-têtes de sécurité de base sur toute réponse de
    // fichier statique — nosniff, CSP minimale (calcul pur, testé sous Node
    // dans src/net-protocol.js) ; jamais de X-Powered-By (http natif de Node
    // n'en ajoute pas, et on n'en ajoute aucune ici).
    res.writeHead(200, Object.assign({
      'Content-Type': TYPES[path.extname(chemin).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    }, NP.entetesSecuriteStatiques()));
    fs.createReadStream(chemin).pipe(res);
  });
}

// ── serveur HTTP + bascule WebSocket ─────────────────────────────────────────
/* Plusieurs écouteurs possibles (SPEC-ARCHI-002) : en mode FERMÉ, deux
   liaisons explicites 127.0.0.1 ET ::1 (jamais 0.0.0.0 ni ::) ; en mode OUVERT,
   un seul écouteur sur toutes les interfaces. Tous partagent les mêmes
   gestionnaires : c'est le MÊME serveur. */
let ecouteurs = [];
let portActuel = PARAMS.port;
let adressesActives = [];
function creerEcouteur() {
  const srv = http.createServer(servir);
  srv.on('upgrade', surUpgrade);
  return srv;
}

// SPEC-SECU-011 : liste blanche d'Origin, configurable via --origines (voir
// src/parametres.js). Calculée UNE fois au démarrage — jamais par requête.
// null = AUCUNE restriction, le choix par DÉFAUT, explicite et documenté
// (--aide origines) : sans --origines, le jeu servi par ce même serveur
// continue de fonctionner exactement comme avant (aucun Origin exigé).
const ORIGINES_AUTORISEES = PARAMS.origines
  ? PARAMS.origines.split(',').map(s => s.trim()).filter(Boolean)
  : null;

/* SPEC-ARCHI-003 : en mode fermé, l'Origin (s'il est présent) doit être l'une
   des trois origines locales du serveur, et l'en-tête Host un nom local
   (défense contre le rebond DNS) ; sans Origin (client non navigateur en
   boucle locale) la requête passe. En mode ouvert, la liste --origines
   (SPEC-SECU-011) s'applique comme avant. */
function hoteLocal(req) {
  const h = String(req.headers['host'] || '').replace(/:\d+$/, '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}
/* Une connexion est « locale » — donc habilitée à RESEAU, ARRET et PAUSE — si
   TROIS choses concourent : l'adresse distante est de la boucle locale, l'en-tête
   Host est un nom local, et l'Origin est absente (client non navigateur) ou l'une
   des origines locales du serveur. L'adresse seule ne suffit PAS : en mode
   ouvert, une page tierce ouverte dans le navigateur de l'hôte se connecte
   depuis 127.0.0.1 avec `Origin: http://evil.example` ; derrière un
   mandataire inverse local, l'adresse est aussi celle de la boucle locale. */
function connexionLocale(req, socket) {
  if (!CA.estAdresseLocale(socket.remoteAddress)) return false;
  if (req.headers['x-forwarded-for'] || req.headers['forwarded'] || req.headers['x-real-ip']) return false;   // mandataire
  if (!hoteLocal(req)) return false;
  const origine = req.headers['origin'];
  return !origine || CA.originesLocales(portActuel).indexOf(origine) >= 0;
}
function requeteAutorisee(req) {
  if (reseauOuvert) return NP.origineAutorisee(req.headers['origin'], ORIGINES_AUTORISEES);
  if (!hoteLocal(req)) return false;
  const origine = req.headers['origin'];
  return !origine || CA.originesLocales(portActuel).indexOf(origine) >= 0;
}

function surUpgrade(req, socket) {
  if (!NP.estRequeteWebSocket(req.headers)) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  // SPEC-SECU-011 : décision PURE (src/net-protocol.js, testée sous Node) —
  // ici on ne fait que lire l'en-tête et refuser la poignée de main AVANT
  // toute allocation de client, avec un code d'erreur HTTP explicite.
  if (!requeteAutorisee(req)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  const cle = req.headers['sec-websocket-key'];
  socket.write(NP.reponseHandshake(cle, (s) =>
    crypto.createHash('sha1').update(s).digest('base64')));
  socket.setNoDelay(true);

  const c = {
    id: prochainId++, nom: 'Joueur', socket, vivant: true, locaux: 1,
    pos: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z }, yaw: 0, pitch: 0,
    rejoint: false, ip: socket.remoteAddress || '?',
    local: connexionLocale(req, socket),         // seule habilitée à RESEAU, ARRET, PAUSE (SPEC-ARCHI-005/008/009)
    role: null, sessionId: null,             // rôle d'administration (SPEC-ADMIN-006/008)
  };
  clients.set(c.id, c);

  /* TCP ne respecte aucune frontière de message : une lecture peut contenir
     une demi-trame, ou trois. On accumule et on décode tant qu'une trame
     complète sort. Oublier cela donne des coupures aléatoires sous charge —
     précisément quand on en a le moins besoin. */
  let tampon = Buffer.alloc(0);
  socket.on('data', (bloc) => {
    tampon = Buffer.concat([tampon, bloc]);
    // SPEC-SECU-003 : un client qui annonce une trame énorme sans jamais la
    // compléter ferait grossir ce tampon indéfiniment — on borne AVANT de
    // tenter le moindre décodage.
    if (tampon.length > NP.TAMPON_MAX) { fermer(c, 'tampon de reception trop volumineux'); return; }
    for (;;) {
      const d = NP.decoder(tampon);
      if (!d) break;                                 // trame incomplète : on attend
      tampon = tampon.slice(d.consomme);

      // SPEC-SECU-004 (RFC 6455) : le client DOIT toujours masquer ses
      // trames ; en accepter une non masquée reviendrait à décoder du texte
      // en clair comme s'il avait été masqué — jamais silencieusement.
      if (!d.masque) { fermer(c, 'trame non masquee (RFC 6455)'); return; }

      if (d.opcode === NP.OP.FERME) { fermer(c, 'fermeture demandee'); return; }
      if (d.opcode === NP.OP.PING) {
        socket.write(NP.encoder(Buffer.from(d.charge), NP.OP.PONG, Buffer.alloc));
        continue;
      }
      if (d.opcode !== NP.OP.TEXTE) continue;

      let msg;
      try { msg = JSON.parse(NP.utf8Decoder(d.charge)); } catch (e) { continue; }
      // SPEC-SECU-001 : une exception pendant le traitement NE DOIT fermer
      // QUE cette connexion fautive — jamais arrêter le processus ni couper
      // les autres clients déjà connectés.
      try {
        traiter(c, NP.valider(msg));
      } catch (e) {
        journal(`x exception en traitant un message de ${c.nom} (#${c.id}) : ${(e && e.stack) || e}`);
        fermer(c, 'exception de traitement');
        return;
      }
    }
  });

  socket.on('error', () => fermer(c, 'erreur socket'));
  /* http.Server ouvre ses sockets en `allowHalfOpen` : la fermeture propre du
     client (FIN) ne déclenche PAS 'close' tant que le serveur n'a pas fermé
     son côté. Jadis masqué par les écritures d'ETAT à 60 Hz (qui échouaient
     aussitôt), ce silence devient un défaut en pause : sans ETAT diffusé, un
     onglet fermé ne serait jamais constaté (SPEC-ARCHI-008). */
  socket.on('end', () => fermer(c, 'fin de connexion'));
  socket.on('close', () => fermer(c, 'socket fermee'));
}

// ── anti-flood par client (SPEC-SECU-005/006) ────────────────────────────────
/* Revue adversariale du commit 2365213 : un budget UNIQUE par connexion
   (30 msg/s) expulsait à tort un joueur légitime — creuser en créatif avec
   casse instantanée (src/player.js, mineTick) envoie un `BLOC` par image tant
   que le joueur regarde un bloc différent, soit jusqu'à ~60/s à 60 im/s ; et
   jusqu'à 4 joueurs locaux (écran partagé) partagent la MÊME connexion, donc
   le MÊME budget si on ne les distingue pas.

   Les budgets sont donc désormais PAR JOUEUR LOCAL (`m.j`, 0 à 3) ET PAR TYPE
   de message — un joueur local qui construit vite n'entame jamais le budget
   d'un autre, ni celui d'un autre type d'action :
     - BLOC : FLOOD_MAX_BLOC/s, PAR joueur local — ≥ 80/s pour couvrir la
       casse instantanée en créatif (~60/s à 60 im/s) avec une marge de 1,5×
       pour l'instabilité d'images (rattrapage après un ralentissement) ;
     - les autres messages porteurs d'un joueur local (BOUGE, ATTAQUE, TIR,
       MANGER, RENAITRE, DISTRIB) : FLOOD_MAX_GENERAL/s, PAR joueur local —
       l'exemple 30/s de la spec, ces actions n'étant jamais aussi rafraîchies
       que la casse de bloc ;
     - REJOINDRE/ADMIN (pas de joueur local) : FLOOD_MAX_GENERAL/s PAR
       CONNEXION (un panneau admin ne tape jamais aussi vite) ;
     - CHAT (pas de joueur local, un seul humain tape) : FLOOD_CHAT_MAX par
       FLOOD_CHAT_FENETRE_MS, inchangé.

   Un dépassement de budget n'ignore QUE le message en trop (lettre de
   SPEC-SECU-005/006) — plus jamais de fermeture pour un débit simplement
   soutenu. Seul un débit ABERRANT (> FLOOD_ABERRANT_MULT × le budget
   applicable — un ordre de grandeur qu'aucun client honnête ne peut
   atteindre) déclenche d'abord un avertissement (message CHAT système ciblé),
   puis — s'il persiste plusieurs secondes consécutives malgré
   l'avertissement — une expulsion, journalisée via MC.Admin.journaliser. */
const FLOOD_FENETRE_MS = 1000, FLOOD_MAX_GENERAL = 30;      // ex. de la spec : 30/s
const FLOOD_MAX_BLOC = 90;                                  // ≥ 80/s : voir justification ci-dessus
const FLOOD_CHAT_FENETRE_MS = 10000, FLOOD_CHAT_MAX = 5;    // ~1 message toutes les 2 s en rafale
const FLOOD_ABERRANT_MULT = 10;                             // > 10x le budget : impossible pour un client honnête
const FLOOD_SECONDES_APRES_AVERTISSEMENT = 3;               // secondes ABERRANTES consécutives APRÈS l'avertissement
// messages qui portent un joueur local (`m.j`) : leur budget se compte par
// joueur local plutôt que par connexion, pour ne pas pénaliser l'écran partagé
const FLOOD_TYPES_PAR_JOUEUR = new Set([
  NP.MSG.BLOC, NP.MSG.BOUGE, NP.MSG.ATTAQUE, NP.MSG.TIR, NP.MSG.MANGER, NP.MSG.RENAITRE, NP.MSG.DISTRIB,
]);
/* B1 (vague 2, SPEC-SECU-005/006 étendu) : les nouveaux messages c→s portent
   tous un joueur local (`m.j`) — budgets propres à chaque type, donnés par
   MC.ContratsV2.BUDGETS_FLOOD (« troc » y figure déjà, pour B2). */
if (MC.ContratsV2) Object.keys(MC.ContratsV2.BUDGETS_FLOOD).forEach(t => FLOOD_TYPES_PAR_JOUEUR.add(t));
FLOOD_TYPES_PAR_JOUEUR.add(NP.MSG.DORMIR);
[NP.MSG.VEHICULE_POSER, NP.MSG.VEHICULE_MONTER, NP.MSG.VEHICULE_DESCENDRE, NP.MSG.VEHICULE_REPARER].forEach(t => FLOOD_TYPES_PAR_JOUEUR.add(t));
FLOOD_TYPES_PAR_JOUEUR.add(NP.MSG.HISTOIRE_PARLER);
FLOOD_TYPES_PAR_JOUEUR.add(NP.MSG.HISTOIRE_REPONSE);

/* Compte (et enregistre) l'arrivée d'un message dans sa fenêtre glissante —
   TOUJOURS, même au-delà du budget : c'est ce qui permet de distinguer un
   débit simplement soutenu (compte un peu au-dessus du budget) d'un débit
   aberrant (compte à 10x le budget ou plus), sans quoi un compteur qui
   s'arrête de grossir une fois saturé ne verrait plus la différence. */
function floodCompte(c, cle, fenetreMs) {
  const maintenant = Date.now();
  const histo = c[cle] || (c[cle] = []);
  while (histo.length && maintenant - histo[0] >= fenetreMs) histo.shift();
  histo.push(maintenant);
  return histo.length;
}
function signalerAberrant(c, cle, type) {
  const sec = Math.floor(Date.now() / 1000);
  const cleSec = cle + '_sec', cleSuite = cle + '_suite', cleAverti = cle + '_averti';
  if (c[cleSec] === sec) return;                            // déjà traité cette seconde-ci
  const consecutif = c[cleSec] === sec - 1;
  c[cleSuite] = consecutif ? (c[cleSuite] || 0) + 1 : 1;
  c[cleSec] = sec;
  MC.Admin.journaliser(admin, { auteur: c.nom, action: 'flood_aberrant_' + type, cible: c.ip, details: c[cleSuite], heure });
  if (!c[cleAverti]) {
    // premier constat : un avertissement, jamais une fermeture immédiate
    c[cleAverti] = true;
    envoyer(c, { t: NP.MSG.CHAT, auteur: null, type: 'systeme', ts: Date.now(),
      texte: 'Débit de messages anormalement élevé : ralentissez, ou vous serez déconnecté.' });
    journal(`! ${c.nom} (#${c.id}) avertissement anti-flood (${type})`);
    return;
  }
  if (c[cleSuite] >= FLOOD_SECONDES_APRES_AVERTISSEMENT) {
    journal(`x ${c.nom} (#${c.id}) expulsé — débit aberrant persistant malgré l'avertissement (${type})`);
    fermer(c, 'debit aberrant persistant : ' + type);
  }
}
function floodVerifie(c, m, cle, fenetreMs, budget) {
  const n = floodCompte(c, cle, fenetreMs);
  if (n <= budget) return true;                             // sous le budget : rien à signaler
  if (n > budget * FLOOD_ABERRANT_MULT) signalerAberrant(c, cle, m.t);
  return false;                                              // au-dessus du budget : message ignoré (jamais fermé pour ça seul)
}
function antiFloodOk(c, m) {
  if (m.t === NP.MSG.CHAT) return floodVerifie(c, m, '_fl_chat', FLOOD_CHAT_FENETRE_MS, FLOOD_CHAT_MAX);
  const parJoueur = FLOOD_TYPES_PAR_JOUEUR.has(m.t);
  const cle = '_fl_' + m.t + (parJoueur ? '_' + (m.j || 0) : '');
  const budgetV2 = (MC.ContratsV2 && MC.ContratsV2.BUDGETS_FLOOD[m.t]) || CA.BUDGETS_FLOOD[m.t];
  const budget = m.t === NP.MSG.BLOC ? FLOOD_MAX_BLOC : (budgetV2 || FLOOD_MAX_GENERAL);
  return floodVerifie(c, m, cle, FLOOD_FENETRE_MS, budget);
}

// SPEC-SERVEUR-009 : overrides de blocs — un voisinage borné à la connexion
// (BIENVENUE), puis chunk par chunk sur demande du client (OVERRIDES_DEMANDE,
// voir traiter() plus bas). `rayon` en CHUNKS (0 = un seul chunk, pour une
// demande ponctuelle) ; borner par un rayon plutôt que tout renvoyer est ce
// qui garde BIENVENUE de taille bornée quel que soit le nombre d'overrides.
const RAYON_BIENVENUE_CHUNKS = 2;
function overridesEnVue(cx0, cz0, rayon) {
  const blocs = [];
  for (let cx = cx0 - rayon; cx <= cx0 + rayon; cx++) for (let cz = cz0 - rayon; cz <= cz0 + rayon; cz++) {
    const e = indexOverrides.get(cx + ',' + cz);
    if (!e) continue;
    e.forEach((k) => {
      const p = k.split(',');
      const etat = monde.etatsOverrides ? (monde.etatsOverrides.get(k) || 0) : 0;
      blocs.push([+p[0], +p[1], +p[2], monde.overrides.get(k), etat]);
    });
  }
  return blocs;
}

// ── traitement des messages ──────────────────────────────────────────────────
/* Bascules de test réservées aux suites d'intégration (désactivées par
   défaut, jamais en exploitation normale) : elles provoquent volontairement
   une exception dans `traiter()` pour vérifier SPEC-SECU-001, exactement
   comme MC_SAUVEGARDE_MS ou MC_MESURES réduisent un intervalle pour les
   tests plutôt que d'exposer un chemin de code séparé et non testé. */
const MC_TEST_PANNE = process.env.MC_TEST_PANNE === '1';

/* SPEC-ARCHI-010 : en pause, tout message qui modifie l'état de jeu est ignoré —
   mouvement, blocs, combat, tir, inventaire (manger, fabriquer, équiper, consommer,
   lâcher, palette créative), conteneurs, commerce, distributeurs. RENAITRE est
   l'EXCEPTION (SPEC-ARCHI-026) : un joueur mort doit pouvoir renaître même dans
   un monde figé (menu ouvert sur l'écran de mort) — la renaissance ne fait
   avancer aucune horloge. Restent acceptés : ping, CHAT, PAUSE, RESEAU, ARRET,
   ADMIN, CONTENEUR_FERMER (simple libération). */
const MESSAGES_GELES = new Set([
  'ENTREE', 'BLOC', 'ATTAQUE', 'TIR', 'MANGER', 'DISTRIB', 'CRAFT', 'EQUIP',
  'INV_CONSOMMER', 'INV_LACHER', 'INV_CREATIF', 'TROC', 'CONTENEUR_OUVRIR', 'CONTENEUR_TRANSFERT',
  'DORMIR', 'VEHICULE_POSER', 'VEHICULE_MONTER', 'VEHICULE_DESCENDRE', 'VEHICULE_REPARER',
  'DORMIR', 'HISTOIRE_PARLER', 'HISTOIRE_REPONSE',
].map(k => NP.MSG[k]).filter(Boolean));

/* SPEC-ARCHI-026 : le lieu de renaissance est décidé ICI. Le lit dont le joueur
   a fait son point de réapparition (`js.spawn`, persistant) tant qu'il existe
   encore, sinon le point d'apparition du monde. */
function lieuRenaissance(js, j) {
  const sp = js.spawn;
  if (sp && [sp.x, sp.y, sp.z].every(Number.isFinite) && Math.abs(sp.x) < 1e7 && Math.abs(sp.z) < 1e7 && sp.y > -64 && sp.y < 400) {
    monde.getChunk(Math.floor(sp.x / 16), Math.floor(sp.z / 16), true);
    // le lit est sous les pieds (y = lit + 1,05) ou occupé (y = lit + 0,05, anciennes parties solo)
    const bx = Math.floor(sp.x), bz = Math.floor(sp.z);
    const dessous = C.BLOCKS[monde.getBlock(bx, Math.floor(sp.y - 1.0), bz)], dedans = C.BLOCKS[monde.getBlock(bx, Math.floor(sp.y - 0.05), bz)];
    if ((dessous && dessous.dodo) || (dedans && dedans.dodo)) return { x: sp.x, y: sp.y, z: sp.z };
    js.spawn = null;                                   // le lit a disparu
  }
  return { x: SPAWN.x + j * 1.2, y: SPAWN.y, z: SPAWN.z };
}
/* Un joueur qui se couche fixe sa réapparition sur le lit à portée (jamais une
   position dictée par le client). Renvoie true si un lit a été trouvé. */
function fixerReapparitionLit(js) {
  const st = js.joueur.state, px = Math.floor(st.pos.x), py = Math.floor(st.pos.y), pz = Math.floor(st.pos.z);
  let meilleur = null, md = 5 * 5;
  for (let dx = -4; dx <= 4; dx++) for (let dy = -2; dy <= 3; dy++) for (let dz = -4; dz <= 4; dz++) {
    const bd = C.BLOCKS[monde.getBlock(px + dx, py + dy, pz + dz)];
    if (!bd || !bd.dodo) continue;
    const d2 = (px + dx + 0.5 - st.pos.x) ** 2 + (py + dy + 0.5 - st.pos.y) ** 2 + (pz + dz + 0.5 - st.pos.z) ** 2;
    if (d2 < md) { md = d2; meilleur = { x: px + dx + 0.5, y: py + dy + 1.05, z: pz + dz + 0.5 }; }
  }
  if (!meilleur) return false;
  js.spawn = meilleur;
  return true;
}
/* SPEC-ARCHI-027 : l'arme d'un coup de mêlée, d'après l'inventaire SERVEUR.
   Le client désigne la case tenue (`i`) ; le serveur ne croit que ce que cette
   case contient réellement (main nue si elle est vide). Sans `i` (ancien
   client), la meilleure arme possédée. Le plafond est donc « ce que le joueur
   possède et tient », jamais un chiffre annoncé. */
function armeMelee(js, i) {
  const slots = js.joueur.state.inv.slots;
  if (Number.isInteger(i) && i >= 0 && i < slots.length) return (slots[i] && C.def(slots[i].id)) || {};
  let best = {};
  slots.forEach(s => { const df = s && C.def(s.id); if (df && (df.damage || 1) > (best.damage || 1)) best = df; });
  return best;
}
/* Cadence, portée et recul du coup, lus dans la définition de l'arme comme le
   fait player.attack (dague 0,22 s, masse 0,95 s…). Le serveur retient 85 %
   de la cadence (gigue réseau) avec un plancher de 0,15 s. */
function parametresMelee(arme) {
  const cadence = arme.cadence !== undefined ? arme.cadence : 0.45;
  return { degats: arme.damage || 1, cd: Math.max(0.15, cadence * 0.85), recul: arme.recul !== undefined ? arme.recul : 1,
           portee: Math.max(6, (arme.portee || 0) + 0.5) };
}
/* L'arme de tir du genre demandé : la case `i` si elle porte une telle arme,
   sinon la meilleure arme de ce genre possédée ; null si aucune (créatif,
   réglages de test). Dégâts et vitesse ne dépassent jamais ceux de l'arme
   (et de la meilleure munition possédée), comme player.tirer. */
function parametresTir(js, genre, i) {
  const slots = js.joueur.state.inv.slots;
  const bonne = (s) => { const df = s && C.def(s.id); return df && df.ranged === genre ? df : null; };
  let arme = Number.isInteger(i) && i >= 0 && i < slots.length ? bonne(slots[i]) : null;
  if (!arme) slots.forEach(s => { const df = bonne(s); if (df && (!arme || (df.bonusTir || 0) > (arme.bonusTir || 0))) arme = df; });
  if (!arme) return null;
  let degats;
  if (arme.sansMunition) degats = arme.degatsTir || 6;
  else {
    let mun = 5;
    slots.forEach(s => { const df = s && C.def(s.id); if (df && df.ammo && (!df.ammoType || df.ammoType === genre) && (df.damage || 5) > mun) mun = df.damage; });
    degats = mun + (arme.bonusTir || 0);
  }
  return { degats, vitesse: arme.vitesseTir || 34, cd: Math.max(0.3, arme.cadenceTir || 0) };
}
// ── mode histoire (SPEC-ARCHI-041, lot P-HIST) ──────────────────────────────
/* Le récit de CHAQUE joueur vit ICI : le serveur le crée (lié aux lieux réels
   du monde), le fait avancer à partir de ce qu'il arbitre lui-même (blocs
   posés, créatures tuées, gardiens vaincus, position, inventaire, paroles) et
   n'envoie au client que des annonces (HISTOIRE_NOTIF) et la vue de l'état
   (HISTOIRE_ETAT). Règle : un récit PAR JOUEUR nommé (clé de registre), même
   avec plusieurs joueurs ou un écran partagé ; il survit au fichier de monde. */
const RS = MC.RecitServeur;
const peutHistoire = (cat) => MC.Modes.categoriePermise(regles, cat);
function ctxInventaire(js) { const inv = js.joueur.state.inv; return { compter: (id) => inv.count(id) }; }
/* Avant BIENVENUE : reprend le récit enregistré (ou celui d'une partie solo
   importée), sinon en crée un et place le héros sur la place de son village. */
function preparerRecit(js, j) {
  js.recit = null; js.recitFin = null; js.recitNotifs = [];
  if (!regles.histoire) return;
  let rec = null;
  if (js.cleReg && recitsRegistre.has(js.cleReg)) rec = RS.importer(recitsRegistre.get(js.cleReg), peutHistoire);
  if (!rec && js.recitSolo) {
    rec = RS.importer(js.recitSolo, peutHistoire);
    // le brut n'est lâché qu'une fois le récit rattaché à une clé de registre persistée ; illisible, il est conservé tel quel
    if (rec && js.cleReg) { soloRecit = null; if (extrasSolo) extrasSolo.histoire = null; }
    else if (!rec) journal(`histoire : le récit de la partie importée est illisible, conservé tel quel (${js.cleReg || 'sans clé'})`);
  }
  js.recitSolo = null;
  if (rec) { js.recit = rec.etat; js.recitFin = rec.fin; return; }
  const cr = RS.creer({ monde, graine: CONF.graine, params: PARAMS_HISTOIRE, peut: peutHistoire, liens: histoireMonde.liens, pos: SPAWN });
  if (cr.liens && !histoireMonde.liens) histoireMonde.liens = cr.liens;
  js.recit = cr.etat;
  js.recitNotifs = MC.Recits.commencer(js.recit);
  const dep = RS.pointDepart(js.recit);
  if (dep) {
    const px = Math.floor(dep.x), pz = Math.floor(dep.z) + 3;
    for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) monde.getChunk(Math.floor(px / 16) + cx, Math.floor(pz / 16) + cz, true);
    const st = js.joueur.state;
    st.pos.x = px + 0.5 + j * 1.2; st.pos.z = pz + 0.5; st.pos.y = monde.groundAt(px, pz, true) + 1.2;
    st.vel.x = st.vel.y = st.vel.z = 0;
    js.spawn = { x: st.pos.x, y: st.pos.y, z: st.pos.z };
    /* MC_TEST_PRES_GUIDE : réservé aux e2e (serveur jetable de `--tests`), jamais en exploitation — le héros s'éveille
       à côté du guide du village de départ, sans qu'un test ait à marcher jusqu'à lui. */
    if (process.env.MC_TEST_PRES_GUIDE && js.recit.archetype === 'epopee' && monde.habitats) {
      const guide = MC.Habitats.pnjsManquants(monde.habitats.lieuxProches(dep.x, dep.z, 90), [], new Map(), 0)
        .filter(p => p.role === 'guide' && p.lieu === dep.id)[0];
      if (guide) { st.pos.x = guide.x + 1.5; st.pos.z = guide.z + 0.5; st.pos.y = monde.groundAt(Math.floor(st.pos.x), Math.floor(st.pos.z), true) + 1.2; js.spawn = { x: st.pos.x, y: st.pos.y, z: st.pos.z }; }
    }
  }
}
// Après BIENVENUE : l'état du récit, et ses premières répliques.
function demarrerRecit(c, js, j) {
  if (!js.recit) return;
  const notifs = js.recitNotifs || [];
  js.recitNotifs = [];
  js.recitT = 0; js.lieuRecit = null; js.recitMort = false; js.attenteRecit = null; js.recitSig = null;
  livrerRecit(c, j, js, notifs);
}
function envoyerEtatRecit(c, j, js, force) {
  /* Signature légère (objectif, journal, fin, choix) comparée à chaque sonde : la vue complète
     (copie profonde + sérialisation) n'est construite que si elle a changé. */
  const i0 = RS.interne(js.recit);
  const choix = RS.choixPose(js.recit);
  const sig = JSON.stringify([MC.Recits.objectif(js.recit), i0 && i0.journal ? i0.journal.length : 0, i0 && i0.fin, choix && choix.id,
    MC.Recits.quetesActives(js.recit).map(q => q.etat).join()]);
  if (!force && sig === js.recitSig) return;
  js.recitSig = sig;
  const v = RS.vue(js.recit, js.recitFin);
  let txt = JSON.stringify(v);
  if (txt.length > CA.BORNES.HISTOIRE_JSON_MAX) {                 // jamais au-delà de la borne du contrat : le journal d'abord
    const i = RS.interne(v.recit);
    if (i && i.journal) i.journal = [];
    txt = JSON.stringify(v);
    if (txt.length > CA.BORNES.HISTOIRE_JSON_MAX) {
      journal(`! histoire : l'état du récit de ${c.nom} dépasse la borne du contrat (${txt.length} octets), non envoyé`);
      return;
    }
  }
  envoyer(c, { t: NP.MSG.HISTOIRE_ETAT, j, etat: v });
}
/* Applique les effets d'un lot d'annonces du moteur de récit (objets repris,
   récompenses, créatures, fin) puis les envoie au joueur. */
function livrerRecit(c, j, js, notifs, extra) {
  const cl = RS.classer(js.recit, notifs);
  const inv = js.joueur.state.inv;
  let invTouche = false;
  cl.prises.forEach(p => {
    let reste = p.objets[0].n;
    (p.parmi || [p.objets[0].id]).forEach(id => {
      const k = Math.min(reste, inv.count(id));
      if (k > 0) { inv.remove(id, k); reste -= k; }
    });
    invTouche = true;
  });
  cl.recompenses.forEach(o => {
    const reste = js.joueur.pickUp(o.id, o.n);
    if (reste) lacherAuxPieds(js, { id: o.id, n: reste });
    invTouche = true;
  });
  if (invTouche) envoyerInvMaj(c, j, {});
  cl.apparitions.forEach(a => apparitionsRecit(js, a));
  if (cl.fin) {
    js.recitFin = cl.fin;
    succesHistoire(c, js, cl.fin);
    journal(`* ${c.nom} achève le récit (${cl.fin.id})`);
  }
  const MAX = CA.BORNES.HISTOIRE_NOTIFS_MAX;
  for (let k = 0; k < cl.client.length || (k === 0 && extra); k += MAX) {
    const msg = { t: NP.MSG.HISTOIRE_NOTIF, j, notifs: cl.client.slice(k, k + MAX) };
    if (k + MAX >= cl.client.length && extra) {
      if (extra.proposition) msg.proposition = extra.proposition;
      if (extra.libre) { msg.libre = true; msg.eid = extra.eid; }
      extra = null;
    }
    envoyer(c, msg);
    if (k === 0 && !cl.client.length) break;
  }
  envoyerEtatRecit(c, j, js, true);
}
/* Le succès « histoire_achevee » (SPEC-ARCHI-042) : signalé UNE fois, à l'achèvement du récit (qui ne s'achève
   qu'une fois : plus aucun évènement n'est évalué ensuite). */
function succesHistoire(c, js, fin) {
  signalerSucces(js, { type: 'histoire', fin: fin.id });
}
// Un évènement de jeu arbitré ici (poser, tuer, boss…) : le récit du joueur concerné l'évalue.
function signalerRecit(c, j, js, ev) {
  if (!js || !js.recit || RS.fin(js.recit)) return;
  ev.t = heure;
  const notifs = RS.signaler(js.recit, ev, ctxInventaire(js));
  if (notifs.length) livrerRecit(c, j, js, notifs); else envoyerEtatRecit(c, j, js, false);
}
function apparitionsRecit(js, a) {
  const st = js.joueur.state;
  const ctr = a.pres && a.pres !== 'joueur' && monde.estCharge(a.pres.x, a.pres.z) ? a.pres : st.pos;
  (a.apparitions || []).forEach((ap, ia) => {
    for (let k = 0; k < ap.n; k++) {
      const ang = (k + ia * 3) * 2.1, d = 8 + (k % 3) * 3;
      const x = Math.floor(ctr.x + Math.cos(ang) * d), z = Math.floor(ctr.z + Math.sin(ang) * d);
      if (!monde.estCharge(x, z)) continue;
      const y = monde.groundAt(x, z, true) + 1;
      if (entites.SPECS[ap.type]) entites.spawn(ap.type, x + 0.5, y, z + 0.5, ap.role ? { role: ap.role, nom: 'le caravanier' } : { histoire: a.id });
    }
  });
}
/* Deux fois par seconde de temps de jeu, par joueur : où il est, ce qu'il porte,
   l'heure, le ciel, le lieu où il entre ; et la mort définitive (cauchemar). */
function sonderRecit(c, j, js, dt) {
  if (!js.recit) return;
  const st = js.joueur.state;
  if (st.dead) {
    if (regles.permadeath && !js.recitMort && !RS.fin(js.recit)) {
      js.recitMort = true;
      livrerRecit(c, j, js, RS.signaler(js.recit, { type: 'mort', t: heure }));
    }
    return;
  }
  js.recitMort = false;
  js.recitT -= dt;
  if (js.recitT > 0 || RS.fin(js.recit)) return;
  js.recitT = 0.5;
  const x = Math.floor(st.pos.x), z = Math.floor(st.pos.z);
  const lieu = monde.habitats ? monde.habitats.lieuA(x, z) : null;
  const lieuId = lieu ? lieu.id : null;
  const entre = lieuId && lieuId !== js.lieuRecit ? lieuId : null;
  js.lieuRecit = lieuId;
  let habitants = null;
  if (js.recit.archetype === 'colonie' && monde.habitats) {
    const ctr = RS.interne(js.recit).centre;
    habitants = 0;
    monde.habitats.lieuxProches(ctr.x, ctr.z, 200).forEach(l => { habitants += (l.pnjs || []).length; });
  }
  const notifs = RS.sonder(js.recit, {
    pos: { x: st.pos.x, z: st.pos.z }, biome: monde.biomeAt(x, z).id, nuit: MC.DayCycle.isNight(heure),
    meteo: monde.meteo ? monde.meteo.etat(heure).type : null, t: heure, lieu: entre, habitants,
  }, ctxInventaire(js));
  if (notifs.length) livrerRecit(c, j, js, notifs); else envoyerEtatRecit(c, j, js, false);
}
/* HISTOIRE_PARLER : le joueur parle à un habitant. Portée, étape en cours et
   quêtes sont jugées ICI ; le client reçoit des répliques, ou la main pour le commerce. */
function traiterHistoireParler(c, m) {
  const js = c.joueurs && c.joueurs[m.j];
  if (!js || !js.recit || js.joueur.state.dead) return;
  const ent = entites.list.find(e => e.eid === m.eid && !e.dead && entites.SPECS[e.type] && entites.SPECS[e.type].npc);
  if (!ent) return;
  const st = js.joueur.state;
  const d = Math.hypot(ent.pos.x - st.pos.x, (ent.pos.y || 0) - st.pos.y, ent.pos.z - st.pos.z);
  if (d > MC.ContratsV2.BORNES.PORTEE_TROC) return;
  const r = RS.parler(js.recit, regles, ent, ctxInventaire(js), heure);
  js.attenteRecit = r.proposition ? { id: r.proposition.id, role: ent.role || 'habitant' } : null;
  livrerRecit(c, m.j, js, r.notifs, { proposition: r.proposition, libre: r.libre, eid: m.eid });
}
/* HISTOIRE_REPONSE : choix du récit ou quête proposée. Un identifiant périmé ou
   rejoué ne change rien ; le client est alors resynchronisé. */
function traiterHistoireReponse(c, m) {
  const js = c.joueurs && c.joueurs[m.j];
  if (!js || !js.recit || js.joueur.state.dead) return;
  const attente = js.attenteRecit;
  if (attente && attente.id === m.id) js.attenteRecit = null;     // une proposition ne se répond qu'une fois
  const r = RS.repondre(js.recit, attente, m.id, m.option);
  if (r.ok) livrerRecit(c, m.j, js, r.notifs); else envoyerEtatRecit(c, m.j, js, true);
}
/* Ce que le fichier de monde garde du récit : registre des joueurs hors ligne + joueurs connectés. */
function snapshotRecits() {
  const out = new Map(recitsRegistre);
  clients.forEach(c => {
    if (!c.joueurs) return;
    c.joueurs.forEach(js => { if (js.cleReg && js.recit) out.set(js.cleReg, RS.exporter(js.recit, js.recitFin)); });
  });
  return out;
}

function traiter(c, m) {
  if (!m) return;                                   // message invalide : ignoré
  // SPEC-ARCHI-010 : en pause, ces messages n'ont aucun effet (ping, PAUSE, RESEAU, ARRET, CHAT continuent)
  if (enPause && MESSAGES_GELES.has(m.t)) return;
  if (MC_TEST_PANNE && m.t === NP.MSG.CHAT && m.texte === '__panne_test_secu_001__') {
    throw new Error('panne de test SPEC-SECU-001');
  }
  if (m.t !== NP.MSG.ENTREE && !antiFloodOk(c, m)) {          // SPEC-SECU-005/006
    // un BLOC ignoré doit resynchroniser le client : sans ça, sa casse/pose
    // locale déjà appliquée (prédiction) resterait un bloc fantôme jamais
    // corrigé — même mécanisme que le refus de portée, qui rappelle `avant`.
    if (m.t === NP.MSG.BLOC) {
      const avantConnu = monde.getBlock(m.x, m.y, m.z);
      envoyer(c, { t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: avantConnu });
    }
    return;
  }
  switch (m.t) {
    case NP.MSG.REJOINDRE: {
      // liste noire, liste blanche, bannissement, e-mail exigé (SPEC-ADMIN-004)
      const decision = MC.Admin.peutEntrer(admin, { nom: m.nom, email: m.email, invitation: m.invitation }, heure);
      if (!decision.ok) {
        envoyer(c, { t: NP.MSG.REFUS, motif: decision.motif });
        journal(`x ${m.nom} (${c.ip}) refusé — ${decision.motif}`);
        setTimeout(() => fermer(c, 'entree refusee : ' + decision.motif), 50);
        break;
      }
      // SPEC-ARCHI-007 : en mode FERMÉ, un seul poste à la fois
      if (!reseauOuvert && [...clients.values()].some(x => x.rejoint && x.id !== c.id)) {
        envoyer(c, { t: NP.MSG.REFUS, motif: CA.MOTIFS_REFUS.POSTE_DEJA_CONNECTE });
        journal(`x ${m.nom} (${c.ip}) refusé — un poste est déjà connecté (réseau fermé)`);
        setTimeout(() => fermer(c, 'poste deja connecte'), 50);
        break;
      }
      // SPEC-SERVEUR-010 : `maxJoueurs` borne le nombre de JOUEURS présents
      // (écran partagé compris), pas le nombre de connexions — une connexion
      // à 4 joueurs locaux en occupe 4, jamais 1. Toute l'équipe est admise
      // ou refusée d'un bloc : jamais une place partielle (un connecté sans
      // ses coéquipiers serait plus déroutant qu'un refus net).
      if (placesOccupees() + m.locaux > CONF.maxJoueurs) {
        envoyer(c, { t: NP.MSG.REFUS, motif: 'serveur_complet' });
        journal(`x ${m.nom} (${c.ip}) refusé — serveur complet (${CONF.maxJoueurs})`);
        setTimeout(() => fermer(c, 'serveur complet'), 50);
        break;
      }
      c.nom = m.nom;
      c.email = m.email || null;
      c.locaux = m.locaux;
      c.rejoint = true;
      marquerPoste(c);                                  // annule le délai de grâce d'arrêt, lève une pause d'absence
      c.role = MC.Admin.roleDe(admin, c.nom);           // un modérateur nommé retrouve son rôle en revenant
      c.sessionId = MC.Admin.ouvrirSession(admin, { nom: c.nom, ip: c.ip }, heure);
      c.joueurs = [];
      for (let j = 0; j < c.locaux; j++) {
        const js = creerJoueurServeur(j);
        js.cid = c.id; js.j = j;                         // pour retrouver sa connexion (succès, SPEC-ARCHI-042)
        // B1 (registre des joueurs nommés) : une clé tenue par un joueur DÉJÀ
        // connecté (même nom, écran partagé compris) reste éphémère — jamais
        // restaurée, jamais écrasée dans le registre à la fermeture.
        const cleReg = MC.ContratsV2 ? MC.ContratsV2.cleRegistre(c.nom, j) : null;
        js.cleReg = (cleReg && !cleRegDejaConnectee(cleReg)) ? cleReg : null;
        if (js.cleReg) {
          let rec = joueursRegistre.get(js.cleReg);
          // ARCHI-015 : le joueur d'une partie solo importée est adopté par le
          // premier joueur local qui rejoint (son nom n'était pas connu à l'import)
          if (!rec && j === 0 && soloJoueur) {
            rec = soloJoueur; soloJoueur = null;
            if (soloRecit) js.recitSolo = soloRecit;   // ARCHI-041 : son récit l'accompagne (retiré des extras seulement une fois rattaché, voir preparerRecit)
            // SPEC-ARCHI-042 : les succès de la partie solo importée passent au joueur qui l'adopte
            // (l'enregistrement importé peut porter un `succes` VIDE : il ne doit pas
            // masquer ceux, réels, conservés dans extras.succes)
            const vide = (x) => !x || (!(x.debloques && x.debloques.length) && !Object.keys(x.compte || {}).length);
            if (vide(rec.succes) && extrasSolo && extrasSolo.succes && !vide(extrasSolo.succes)) {
              rec.succes = extrasSolo.succes; extrasSolo.succes = null;
            }
          }
          if (rec) {
            MC.Conteneurs.depuisEnregistrement(js.joueur.state, banqueDe(js.cleReg), rec);
            appliquerEtatPersonnage(js, rec.etat);              // SPEC-SYNC-020 : position, vie, faim, air…
            if (rec.succes) js.succes.charger(rec.succes);      // SPEC-ARCHI-042
          }
          else if (MC_TEST_INV) MC_TEST_INV.forEach(p => js.joueur.state.inv.add(p[0], p[1]));
        }
        c.joueurs.push(js);
      }
      c.joueurs.forEach((js, j) => preparerRecit(js, j));     // avant BIENVENUE : le héros peut être déplacé sur sa place de village
      c.pos = c.joueurs[0].joueur.state.pos;
      // SPEC-SERVEUR-009 : seul un voisinage borné des overrides accompagne
      // BIENVENUE — plus loin, le client les demande chunk par chunk au fur
      // et à mesure qu'il charge son terrain (case OVERRIDES_DEMANDE
      // plus bas), donc BIENVENUE reste de taille bornée quel que soit le
      // nombre total de blocs modifiés dans le monde.
      const cx0 = Math.floor(c.pos.x / 16), cz0 = Math.floor(c.pos.z / 16);
      const blocs = overridesEnVue(cx0, cz0, RAYON_BIENVENUE_CHUNKS);
      envoyer(c, {
        t: NP.MSG.BIENVENUE,
        id: c.id, graine: CONF.graine, mode: CONF.mode, difficulte: CONF.difficulte,
        histoire: PARAMS_HISTOIRE ? { interactions: PARAMS_HISTOIRE.interactions || null, commerce: PARAMS_HISTOIRE.commerce } : null,
        zone: monde.zonesEtat ? monde.zonesEtat.politique : 'generee',
        heure, blocs,
        // la position qui fait foi, pour chaque joueur local du poste
        toi: c.joueurs.map(js => SY.etatJoueur(js.joueur, 0)),
        tickHz: CONF.tickHz, etatHz: CONF.etatHz,
        // ARCHI : état du poste — pause (SPEC-ARCHI-011), réseau (SPEC-ARCHI-005), partie chargée
        pause: enPause, pauseRev, reseau: reseauOuvert ? CA.ETAT_RESEAU.OUVERT : CA.ETAT_RESEAU.FERME,
        partie: partieActive ? { id: partieActive.id, nom: partieActive.nom } : null,
        // SPEC-ARCHI-029 / SYNC-025 : l'appartenance de faction qui fait foi est celle du serveur
        guilde: guildeResume(c.nom),
        joueurs: [...clients.values()].filter(x => x.id !== c.id && x.rejoint)
          .map(x => ({ id: x.id, nom: x.nom, x: x.pos.x, y: x.pos.y, z: x.pos.z, yaw: x.yaw })),
        chat: chat.recents(20).map(x => ({ auteur: x.auteur, texte: x.texte, type: x.type, ts: x.t })),
      });
      // B1 (SPEC-SYNC-008) : le nouveau venu apprend son inventaire (restauré,
      // seedé par MC_TEST_INV, ou vide) avant tout autre message d'inventaire.
      c.joueurs.forEach((js, j) => envoyerInvMaj(c, j, {}));
      c.joueurs.forEach((js, j) => demarrerRecit(c, js, j));   // ARCHI-041 : l'état du récit et ses premières répliques
      // SPEC-ARCHI-042 : l'état des succès de chaque joueur local (compteurs du panneau), sans annonce
      c.joueurs.forEach(js => envoyerSuccesEtat(js));
      // SPEC-SYNC-011 : l'équipement déjà visible des joueurs présents (et
      // réciproquement, le sien à eux) — un emplacement vide n'est pas annoncé.
      tousLesJoueurs().forEach(({ c: autreC, j: autreJ, js: autreJs }) => {
        if (autreC.id === c.id) return;
        MC.ContratsV2.EQUIP_SLOTS.forEach(slot => {
          const pile = autreJs.joueur.state.equip[slot];
          if (pile) envoyer(c, { t: NP.MSG.EQUIP_VU, id: autreC.id, j: autreJ, slot, objet: pile.id });
        });
      });
      c.joueurs.forEach((js, j) => {
        MC.ContratsV2.EQUIP_SLOTS.forEach(slot => {
          const pile = js.joueur.state.equip[slot];
          if (pile) diffuser({ t: NP.MSG.EQUIP_VU, id: c.id, j, slot, objet: pile.id }, c.id);
        });
      });
      diffuser({ t: NP.MSG.ARRIVE, id: c.id, nom: c.nom, locaux: c.locaux }, c.id);
      const sm = chat.systeme(c.nom + ' a rejoint la partie' +
                              (c.locaux > 1 ? ' (' + c.locaux + ' joueurs locaux)' : ''));
      if (sm) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: sm.texte, type: 'systeme', ts: sm.t });
      journal(`+ ${c.nom} (#${c.id}) rejoint · ${clients.size} en ligne`);
      break;
    }
    // ── ARCHI : pause du poste, réseau à chaud, arrêt (SPEC-ARCHI-005/008/009) ──
    case NP.MSG.PAUSE:
      if (c.local) marquerPoste(c);
      if (reseauOuvert) { envoyer(c, { t: NP.MSG.PAUSE_ETAT, actif: false, rev: pauseRev }); break; }   // aucune pause en mode ouvert
      if (!c.local) break;
      definirPause(m.actif, false);
      break;
    case NP.MSG.RESEAU:
      if (c.local) marquerPoste(c);
      if (!c.local) { journal(`x RESEAU ignoré : ${c.nom} (#${c.id}, ${c.ip}) n'est pas en boucle locale`); break; }
      // un serveur dédié (--serveur) reste OUVERT : le fermer expulserait ses joueurs puis l'arrêterait tout seul
      if (!m.ouvert && PARAMS.serveurSeul) { journal(`x RESEAU {ouvert:false} ignoré : serveur dédié (--serveur)`); envoyer(c, messageReseau()); break; }
      definirReseau(m.ouvert);
      break;
    case NP.MSG.ARRET:
      if (c.local) marquerPoste(c);
      if (!c.local) { journal(`x ARRET ignoré : ${c.nom} (#${c.id}, ${c.ip}) n'est pas en boucle locale`); break; }
      arreter('ARRET');
      break;
    /* SPEC-ARCHI-025 : le SERVEUR tient l'ensemble des dormeurs sur TOUS les
       joueurs présents (locaux et distants) ; la nuit passe quand une
       majorité stricte dort. Un solo est le cas « tous les joueurs = 1 ». */
    case NP.MSG.DORMIR: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || !c.rejoint) break;
      if (!m.actif) { dormeurs.delete(js); break; }
      if (!MC.DayCycle.isNight(heure)) { messageSystemeA(c, 'On ne dort que la nuit.'); break; }
      coucher(js);
      if (!verifierSommeil()) {
        const { dorment, total } = compterDormeurs();
        messageSystemeA(c, `Réapparition fixée ici — en attente que la majorité dorme (${dorment}/${total}).`);
      }
      break;
    }

    // ── véhicules (P-VEH, SPEC-ARCHI-021 / SPEC-SYNC-022) : le serveur crée, embarque, conduit ──
    case NP.MSG.VEHICULE_POSER: poserVehiculeServeur(c, m); break;
    case NP.MSG.VEHICULE_MONTER: monterVehiculeServeur(c, m); break;
    case NP.MSG.VEHICULE_REPARER: reparerVehiculeServeur(c, m); break;
    case NP.MSG.VEHICULE_DESCENDRE: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || !js.joueur.state.monture) { evtVehicule(c, m.j, 'refus', { motif: CA.MOTIFS_VEHICULE.INCONNU }); break; }
      descendreVehiculeServeur(c, m.j, js);
      break;
    }

    case NP.MSG.BOUGE:
      /* Ancien message : le client imposait sa position. Le serveur fait
         désormais autorité — on n'en retient que le regard. */
      c.yaw = m.yaw; c.pitch = m.pitch;
      break;

    // SPEC-SERVEUR-009 : le client demande les overrides d'UN chunk qu'il
    // vient de décider de charger (voir game.js streamChunks) — réponse
    // bornée à ce seul chunk, jamais le monde entier.
    case NP.MSG.OVERRIDES_DEMANDE:
      envoyer(c, { t: NP.MSG.OVERRIDES_CHUNK, cx: m.cx, cz: m.cz, blocs: overridesEnVue(m.cx, m.cz, 0) });
      break;

    case NP.MSG.ENTREE: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) break;
      js.entrees.push(m);
      // un client qui inonde le serveur perd ses entrées les plus anciennes
      if (js.entrees.length > 240) js.entrees.splice(0, js.entrees.length - 240);
      break;
    }

    case NP.MSG.ATTAQUE: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || js.joueur.state.dead) break;
      const st = js.joueur.state;
      // SPEC-ARCHI-027 : dégâts, cadence, portée et recul viennent de l'arme
      // réellement tenue dans l'inventaire serveur, pas de ce que le client annonce.
      const pm = parametresMelee(armeMelee(js, m.i));
      m.degats = Math.min(m.degats, pm.degats);

      // SPEC-COMBAT-002 : cible un autre JOUEUR plutôt qu'une créature —
      // mêmes portée, cadence et dégâts qu'en PvE, mais soumis au réglage
      // PvP du serveur ET aux règles de zone des deux joueurs.
      if (m.joueurCible) {
        if (js.attaqueCd > 0) break;
        const cible = joueurParCle(m.joueurCible);
        if (!cible || cible.js.joueur.state.dead) break;
        if (cible.c.id === c.id && cible.j === m.j) break;               // pas sur soi-même
        const vst = cible.js.joueur.state;
        const d2 = Math.hypot(vst.pos.x - st.pos.x, vst.pos.y + 0.9 - st.pos.y - 1.6, vst.pos.z - st.pos.z);
        if (d2 > pm.portee) break;
        // B4 (SPEC-PVP-002/005) : un duel consenti autorise le coup MÊME hors
        // zone PvP et MÊME entre membres d'une même faction (le consentement
        // explicite prime) ; sinon, comme avant, zone ET faction.
        const duel = MC.PvpEnjeux.duelActif(pvp, c.nom, cible.c.nom, heure, st.pos, vst.pos);
        if (!duel && !(pvpAutorise(st.pos, vst.pos) && MC.Guildes.peutBlesser(guildes, c.nom, cible.c.nom))) break;
        js.attaqueCd = pm.cd;
        const avant = vst.dead;
        vst.hurtCd = 0;
        cible.js.joueur.hurt(m.degats);
        // recul, comme pour une créature (entities.damage s'en inspire)
        const dx = vst.pos.x - st.pos.x, dz = vst.pos.z - st.pos.z, dd = Math.hypot(dx, dz) || 1;
        vst.vel.x += (dx / dd) * 5 * pm.recul; vst.vel.z += (dz / dd) * 5 * pm.recul; vst.vel.y = 4.5 * pm.recul;
        MC.Admin.journaliser(admin, { auteur: c.nom, action: 'combat_joueur', cible: cible.c.nom, details: m.degats, heure });
        if (!avant && vst.dead) {
          const msg = chat.systeme(c.nom + ' a vaincu ' + cible.c.nom);
          if (msg) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: msg.texte, type: 'systeme', ts: msg.t });
          journal(`⚔ ${c.nom} a vaincu ${cible.c.nom} (PvP)`);
          // B4 (SPEC-PVP-001/003/004) : butin, meurtre, réputation, victoire —
          // jamais de butin ni de meurtre compté pendant un duel consenti.
          issuePvp({ c, j: m.j, js }, cible, duel);
        }
        break;
      }

      const e = entites.list.find(x => x.eid === m.eid);
      if (!e || e.dead || e.type === 'item' || e === st.monture) break;     // jamais l'engin qu'on conduit
      const d = Math.hypot(e.pos.x - st.pos.x, e.pos.y + e.h / 2 - st.pos.y - 1.6, e.pos.z - st.pos.z);
      // portée et cadence vérifiées : on ne frappe ni de loin ni en rafale
      if (d > pm.portee || js.attaqueCd > 0) break;
      js.attaqueCd = pm.cd;
      entites.damage(e, m.degats, st.pos, st, pm.recul);
      // journal des actions (SPEC-ADMIN-002) : les combats aussi
      MC.Admin.journaliser(admin, { auteur: c.nom, action: 'combat', cible: e.type, details: m.degats, heure });
      break;
    }

    case NP.MSG.TIR: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || js.joueur.state.dead || js.tirCd > 0) break;
      // SPEC-SYNC-028 : en survie, pas de munition (ou d'arme) dans l'inventaire serveur, pas de projectile
      if (!regles.blocsIllimites && !POSE_LIBRE && !debiterTir(js, m.genre)) break;
      // SPEC-ARCHI-027 : dégâts, vitesse et cadence de l'arme possédée, jamais ceux annoncés
      const pt = parametresTir(js, m.genre, m.i);
      js.tirCd = pt ? pt.cd : 0.3;
      const st = js.joueur.state;
      const o = { x: st.pos.x + m.dx * 0.4, y: st.pos.y + 1.62 + m.dy * 0.4, z: st.pos.z + m.dz * 0.4 };
      entites.tirer(o, { x: m.dx, y: m.dy, z: m.dz }, pt ? Math.min(m.vitesse, pt.vitesse) : m.vitesse,
                    pt ? Math.min(m.degats, pt.degats) : m.degats, st, m.genre);
      break;
    }

    case NP.MSG.MANGER: {
      // B1 (SPEC-SYNC-009) : validé contre l'inventaire serveur — le client
      // ne peut plus se nourrir d'un objet qu'il ne possède pas réellement.
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) break;
      const r = MC.Conteneurs.appliquer(ctxJoueur(js), { k: 'manger', id: m.id, i: m.i });
      if (r.ok) {
        const st = js.joueur.state;
        if (r.effets.food) st.hunger = Math.min(20, st.hunger + r.effets.food);
        if (r.effets.soin) js.joueur.heal(r.effets.soin);
        if (r.effets.cru) { st.malade = (st.malade || 0) + 20; st.malaiseT = 0; }
        if (r.effets.lache) lacherAuxPieds(js, r.effets.lache);
        signalerSucces(js, { type: 'manger', id: m.id });
        if (m.seq !== undefined && seqNouveau(js, m.seq)) envoyerInvMaj(c, m.j, {});
      } else if (m.seq !== undefined && seqNouveau(js, m.seq)) {
        refuserOp(c, m.j, m.seq, r.motif);
      }
      break;
    }

    case NP.MSG.RENAITRE: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || !js.joueur.state.dead) break;
      js.joueur.respawn(lieuRenaissance(js, m.j));
      js.entrees.length = 0;
      js.attaqueCd = 0; js.tirCd = 0;
      break;
    }

    case NP.MSG.BLOC: {
      /* Le serveur fait autorité : il applique, PUIS diffuse à tous — y
         compris à l'émetteur, dont la prédiction locale est ainsi confirmée
         ou corrigée.

         SPEC-SECU-007 : la portée est vérifiée AVANT toute génération de
         chunk — `monde.getBlock` ne force jamais la génération (il renvoie 0
         si le chunk n'est pas chargé), donc `blocAutorise` peut s'exécuter
         sans jamais appeler `monde.getChunk(…, true)`. Un client hors de
         portée ne peut ainsi jamais forcer le serveur à générer du terrain
         arbitrairement loin — seul un BLOC autorisé, donc proche d'un joueur
         déjà présent, déclenche `getChunk(cx, cz, true)` plus bas. */
      const js = c.joueurs && c.joueurs[m.j];
      const avant = monde.getBlock(m.x, m.y, m.z);
      /* Bascule d'une porte ou d'une trappe (ouvrir/fermer) : un changement d'état
         d'un bloc DÉJÀ posé, sans objet ; on n'accepte que la vraie bascule
         (C.bascule) d'un bloc à portée, jamais un autre remplacement. */
      if (m.id !== 0 && avant !== m.id && C.bascule(avant) === m.id) {
        const st0 = js && js.joueur.state;
        const proche = st0 && !st0.dead &&
          Math.hypot(m.x + 0.5 - st0.pos.x, m.y + 0.5 - st0.pos.y - 1.62, m.z + 0.5 - st0.pos.z) <= PORTEE_BLOC;
        if (!proche) { envoyer(c, { t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: avant, etat: monde.getEtat(m.x, m.y, m.z) }); break; }
        const etatBascule = monde.getEtat(m.x, m.y, m.z);
        monde.setBlock(m.x, m.y, m.z, m.id);
        diffuser({ t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: m.id, etat: etatBascule });
        MC.Admin.journaliser(admin, { auteur: c.nom, action: 'bloc_bascule', cible: `${m.x},${m.y},${m.z}`, details: m.id, heure });
        break;
      }
      if (!blocAutorise(js, m, avant, c)) {
        // refusé : on rappelle au client ce qui s'y trouve vraiment
        envoyer(c, { t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: avant });
        break;
      }
      /* SPEC-SYNC-028 : en survie, poser exige l'objet dans l'inventaire SERVEUR
         (retiré ici). Refus : le bloc autoritaire est rappelé et l'inventaire
         renvoyé, la prédiction du client ayant supposé un objet qu'il n'a pas. */
      if (m.id !== 0 && cellulesCompagnes(m).some(cc => !C.isReplaceable(monde.getBlock(cc.x, cc.y, cc.z)))) {
        envoyer(c, { t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: avant });   // la case voisine est prise : rien ne se pose
        break;
      }
      // un conteneur généré jamais ouvert (coffre de donjon, bibliothèque) : son contenu se tire AVANT que la case ne change
      let contNeuf = null;
      if (m.id === 0 && avant) {
        const dA = C.BLOCKS[avant];
        const tA = dA && dA.interactive && MC.ContratsV2.TYPES_CONTENEUR[dA.interactive];
        const kA = MC.ContratsV2.cleConteneur(m.x, m.y, m.z);
        if (tA && !tA.parJoueur && !conteneursPoses.has(kA)) {
          contNeuf = MC.Conteneurs.creerConteneur(dA.interactive);
          if (contNeuf) remplirConteneurNeuf(contNeuf, dA.interactive, m.x, m.y, m.z, kA);
        }
      }
      if (m.id !== 0 && !regles.blocsIllimites && !POSE_LIBRE && !debiterPose(js, m.id, m.i)) {
        envoyer(c, { t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: avant });
        envoyerInvMaj(c, m.j, {});
        break;
      }
      const cx = Math.floor(m.x / 16), cz = Math.floor(m.z / 16);
      monde.getChunk(cx, cz, true);
      monde.setBlock(m.x, m.y, m.z, m.id);
      // état du bloc posé (orientation, niveau… — SPEC-SAVE-017) : 0 par
      // défaut, comme un bloc cassé ou sans état particulier
      if (monde.setEtat) monde.setEtat(m.x, m.y, m.z, m.etat || 0);
      // une casse lâche son butin côté serveur : c'est lui qui le distribue
      if (m.id === 0 && avant) {
        const cassure = C.breakTime(avant, m.outil);
        // SPEC-OBJET-003 : bijou d'émeraude — chance au butin
        const bijou = js && js.joueur.state.equip && js.joueur.state.equip.bijou;
        const bd = bijou && C.def(bijou.id);
        const bonusChance = (bd && bd.effet && bd.effet.type === 'chance') ? bd.effet.valeur : 0;
        C.dropsOf(avant, cassure.harvests, null, bonusChance).forEach(d =>
          entites.dropItem(m.x + 0.5, m.y + 0.5, m.z + 0.5, d.id, d.n));
      }
      diffuser({ t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: m.id, etat: m.etat || 0 });
      if (m.id !== 0) signalerRecit(c, m.j, js, { type: 'poser', bloc: m.id, x: m.x, y: m.y, z: m.z });   // ARCHI-041
      // la case compagne d'une porte ou d'un lit se pose avec elle ; à la casse, l'autre moitié part aussi
      cellulesCompagnes(m).forEach(cc => {
        monde.getChunk(Math.floor(cc.x / 16), Math.floor(cc.z / 16), true);
        monde.setBlock(cc.x, cc.y, cc.z, cc.id);
        if (monde.setEtat) monde.setEtat(cc.x, cc.y, cc.z, cc.etat);
        diffuser({ t: NP.MSG.BLOC, x: cc.x, y: cc.y, z: cc.z, id: cc.id, etat: cc.etat });
      });
      if (m.id === 0 && avant) compagnesDeCasse(avant, m).forEach(cc => {
        monde.setBlock(cc.x, cc.y, cc.z, 0);
        diffuser({ t: NP.MSG.BLOC, x: cc.x, y: cc.y, z: cc.z, id: 0, etat: 0 });
      });
      /* Escalier (SPEC-CONSTR-001) : le serveur fait autorité sur l'angle,
         recalculé ici (même algorithme que le client) plutôt que confié au
         message reçu — pose ou casse peut aussi changer l'angle des 4
         voisins, diffusé séparément à ceux dont l'état a bougé. */
      const bAffecte = (m.id && C.BLOCKS[m.id] && C.BLOCKS[m.id].forme === 'escalier')
        || (C.BLOCKS[avant] && C.BLOCKS[avant].forme === 'escalier');
      if (bAffecte && MC.Formes) {
        const voisins = [[0, 0, 0], [0, -1, 0], [0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
        const avantE = voisins.map(v => monde.getEtat(m.x + v[0], m.y + v[1], m.z + v[2]));
        MC.Formes.actualiserZoneEscalier(monde, m.x, m.y, m.z);
        voisins.forEach((v, i) => {
          const x2 = m.x + v[0], y2 = m.y + v[1], z2 = m.z + v[2];
          const e2 = monde.getEtat(x2, y2, z2);
          if (e2 !== avantE[i]) diffuser({ t: NP.MSG.BLOC, x: x2, y: y2, z: z2, id: monde.getBlock(x2, y2, z2), etat: e2 });
        });
      }
      // journal des actions (SPEC-ADMIN-002) : de quoi rejouer qui a construit ou détruit quoi
      MC.Admin.journaliser(admin, { auteur: c.nom, action: m.id ? 'bloc_pose' : 'bloc_casse',
                                     cible: `${m.x},${m.y},${m.z}`, details: m.id, heure });
      // SPEC-ARCHI-042 : le succès se décide ici, sur une casse que le serveur a acceptée
      if (m.id === 0 && avant) signalerSucces(js, { type: 'casser', bloc: avant });
      /* B1 (étape 7) : un conteneur posé cassé lâche son contenu au sol —
         UNE SEULE FOIS ici (le serveur fait autorité sur la casse), même si
         deux joueurs l'avaient ouvert en même temps. `fermerConteneurPourAbonnes`
         (revue adversariale, item 3) désabonne CHAQUE joueur qui l'avait
         ouvert AVANT de retirer l'entrée : sans ça, `js.conteneurOuvert`
         resterait pointé sur cette clé, et si un AUTRE bloc conteneur (un
         fourneau, par exemple) est reposé au même endroit, ce joueur se
         retrouverait abonné au nouveau conteneur sans jamais avoir rouvert —
         un coffre (27 cases) qu'il croit toujours voir alors que 3 cases
         existent réellement dessous. */
      if (m.id === 0 && avant) {
        const defAvant = C.BLOCKS[avant];
        const tAvant = defAvant && defAvant.interactive && MC.ContratsV2.TYPES_CONTENEUR[defAvant.interactive];
        if (tAvant && !tAvant.parJoueur) {
          const kc = MC.ContratsV2.cleConteneur(m.x, m.y, m.z);
          const contCasse = conteneursPoses.get(kc) || contNeuf;
          if (contCasse) {
            fermerConteneurPourAbonnes(kc);
            contCasse.slots.forEach(s => { if (s) entites.dropItem(m.x + 0.5, m.y + 0.5, m.z + 0.5, s.id, s.n); });
            conteneursPoses.delete(kc);
            derniereEmissionFour.delete(kc);
          }
        }
      }
      break;
    }

    /* SPEC-SYNC-017 : DISTRIB est une DÉCLARATION, pas un dépôt aveugle —
       `m.slots` (déjà borné et normalisé par net-protocol.js) est ce que le
       joueur VEUT voir dans le distributeur ; `MC.Conteneurs.declarer` ne
       prélève dans son inventaire serveur que ce qu'il possède réellement
       (tronqué), et rend ce qu'un retrait n'a pas pu récupérer (Σ inv +
       distributeur conservée par id). Le distributeur est un conteneur posé
       comme un autre depuis l'étape 7 (`conteneursPoses`) — gardé pour un
       appelant historique (solo via un ancien client, tests) ; le client
       à jour préfère `CONTENEUR_TRANSFERT` (modèle référence, § 6/8). */
    case NP.MSG.DISTRIB: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || monde.getBlock(m.x, m.y, m.z) !== C.B.DISTRIBUTEUR) break;
      const kd = MC.ContratsV2.cleConteneur(m.x, m.y, m.z);
      let cont = conteneursPoses.get(kd);
      if (!cont) { cont = MC.Conteneurs.creerConteneur('distributeur'); conteneursPoses.set(kd, cont); }
      MC.Conteneurs.declarer(js.joueur.state.inv, cont, m.slots);
      envoyerInvMaj(c, m.j, {});
      break;
    }

    case NP.MSG.CHAT: {
      /* B4 (SPEC-PVP-005) : /duel <nom> | /duel accepter | /duel refuser —
         interception AVANT /faction (§ 4 du plan), jamais diffusé au chat
         général : une réponse système au seul intéressé (et à l'adversaire
         quand il y en a un). */
      if (typeof m.texte === 'string' && /^\/duel(\s|$)/.test(m.texte)) {
        traiterDuel(c, m.texte);
        break;
      }
      /* SPEC-QUETE-004 : /quete lister | accepter <id> | remettre <id> —
         le serveur reste SEUL arbitre (MC.Politique.accepterQuete/remettreQuete),
         jamais un client : un « remettre » qui arrive deux fois (deux
         clients, un double clic) ne verse jamais deux fois la récompense
         (remettreQuete ne retrouve plus de quête 'active' au second appel). */
      if (typeof m.texte === 'string' && /^\/quete(\s|$)/.test(m.texte)) {
        traiterQuete(c, m.texte);
        break;
      }
      /* /faction … : le serveur fait foi sur les factions de joueurs
         (SPEC-FACTION-009 à 013) ; la réponse ne va qu'à l'intéressé, et
         « dire » ne va qu'aux membres de sa faction principale. */
      if (typeof m.texte === 'string' && /^\/faction(\s|$)/.test(m.texte)) {
        const r = MC.Commandes.executer({ nom: 'faction', args: m.texte.trim().split(/\s+/).slice(1) }, {});
        const actions = (r.actions || []).filter(a => a.type === 'faction');
        if (!actions.length) (r.messages || []).forEach(t => envoyer(c, { t: NP.MSG.CHAT, auteur: null, texte: t, type: 'systeme' }));
        actions.forEach(a => {
          const res = MC.Guildes.appliquerAction(guildes, c.nom, a);
          if (res.canal) {
            const membres = new Set(res.canal.membres);
            clients.forEach(cl => { if (cl.rejoint && membres.has(cl.nom)) envoyer(cl, { t: NP.MSG.CHAT, auteur: null, texte: res.message, type: 'faction' }); });
          } else envoyer(c, { t: NP.MSG.CHAT, auteur: null, texte: res.message, type: 'systeme' });
          MC.Admin.journaliser(admin, { auteur: c.nom, action: 'faction', cible: a.action, details: res.ok, heure });
        });
        break;
      }
      const msg = chat.envoyer(c.nom, m.texte);
      if (msg) {
        diffuser({ t: NP.MSG.CHAT, auteur: msg.auteur, texte: msg.texte,
                   type: msg.type, ts: msg.t });
        journal(`<${c.nom}> ${msg.texte}`);
        MC.Admin.journaliser(admin, { auteur: c.nom, action: 'chat', cible: msg.texte, heure });
      }
      break;
    }

    case NP.MSG.ADMIN: {
      traiterAdmin(c, m);
      break;
    }

    // ── B1 : inventaire, équipement, grille de fabrication (SPEC-SYNC-007 à
    // 011, 014) — chaque opération passe par MC.Conteneurs.appliquer, la même
    // fonction pure que la prédiction client et le solo (docs/vague-2/B1.md).
    case NP.MSG.CRAFT: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) break;
      const rc = traiterOp(c, m, js, { k: 'craft', fois: m.fois });
      if (rc && rc.ok && rc.effets && rc.effets.ids) rc.effets.ids.forEach(id => signalerSucces(js, { type: 'fabriquer', id }));
      break;
    }
    case NP.MSG.EQUIP: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) break;
      const r = traiterOp(c, m, js, { k: 'equip', slot: m.slot, i: m.i });
      if (r && r.ok) diffuserEquipVu(c, m.j, js, m.slot);
      break;
    }
    /* B1 (étape 7, SPEC-SYNC-012/013) : s'abonner à un conteneur à portée —
       bloc (x,y,z) ou banquier (eid). Un seul conteneur ouvert à la fois par
       joueur local (une nouvelle ouverture remplace la précédente, comme un
       joueur qui ferme un coffre pour en ouvrir un autre). Refus SILENCIEUX
       sauf si le message porte un `seq` (clic explicite côté client, B1.md
       § 4) — sinon un `INV_MAJ` de refus. */
    case NP.MSG.CONTENEUR_OUVRIR: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || js.joueur.state.dead) break;
      // `seq` facultatif (§ 4 du plan) : quand il est fourni, il partage le
      // même compteur strictement croissant que les autres opérations de ce
      // joueur local — sinon l'`ack` d'un refus ne correspondrait jamais au
      // `seq` envoyé, et le client ne saurait jamais le relier à sa demande.
      if (m.seq !== undefined && !seqNouveau(js, m.seq)) break;
      const r = ouvrirConteneurPourJoueur(js, m);
      if (!r) { if (m.seq !== undefined) refuserOp(c, m.j, m.seq, 'portee'); break; }
      if (r.type === 'banque') signalerSucces(js, { type: 'banque' });
      envoyer(c, {
        t: NP.MSG.CONTENEUR_ETAT, j: m.j, cle: r.cle, type: r.type, rev: r.cont.rev || 0,
        slots: r.cont.slots.map(MC.ContratsV2.pileVersCase),
        four: r.cont.four ? { burn: r.cont.four.burn, cook: r.cont.four.cook } : undefined,
      });
      break;
    }
    case NP.MSG.CONTENEUR_TRANSFERT: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) break;
      traiterOp(c, m, js, { k: 'transfert', de: m.de, vers: m.vers, n: m.n });
      break;
    }
    /* Fermer la grille rend son contenu à l'inventaire (SPEC-SYNC-007) ; un
       conteneur posé ou la banque : simple désabonnement (rien à rendre,
       tout y est déjà réellement). */
    case NP.MSG.CONTENEUR_FERMER: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) break;
      if (m.cle === 'grille') { traiterOp(c, m, js, { k: 'rendreGrille' }); break; }
      if (js.conteneurOuvert === m.cle) { js.conteneurOuvert = null; js.banquePos = null; js.banqueEid = null; }
      break;
    }
    case NP.MSG.INV_CONSOMMER: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) break;
      // les diminutions que le serveur a déjà faites lui-même (pose, tir) ne se comptent pas deux fois
      const opsRestantes = absorberDebitsPrevus(js, m.ops);
      if (!opsRestantes.length) {
        if (seqNouveau(js, m.seq)) envoyerInvMaj(c, m.j, {});
        break;
      }
      traiterOp(c, m, js, { k: 'consommer', ops: opsRestantes });
      break;
    }
    case NP.MSG.INV_LACHER: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) break;
      traiterOp(c, m, js, { k: 'lacher', i: m.i, n: m.n });
      break;
    }
    case NP.MSG.INV_CREATIF: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) break;
      traiterOp(c, m, js, { k: 'creatif', i: m.i, id: m.id, n: m.n });
      break;
    }

    /* SPEC-SYNC-023 (B2, L45) : commerce serveur-autoritaire, contre les
       helpers de l'API inter-lots (docs/vague-2/B1.md § 5) : `seqNouveau`,
       `envoyerInvMaj`, `refuserOp`, `etatJoueurServeur`, la Map `banques` —
       tous fournis par B1 (fusionné). */
    case NP.MSG.HISTOIRE_PARLER: traiterHistoireParler(c, m); break;
    case NP.MSG.HISTOIRE_REPONSE: traiterHistoireReponse(c, m); break;
    case NP.MSG.TROC: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || js.joueur.state.dead) break;
      const ent = entites.list.find(e => e.eid === m.eid && e.type === 'villager');
      if (!ent) break;
      const st = js.joueur.state;
      const d = Math.hypot(ent.pos.x - st.pos.x, (ent.pos.y || 0) - st.pos.y, ent.pos.z - st.pos.z);
      if (d > MC.ContratsV2.BORNES.PORTEE_TROC) break;
      // un village hostile ferme le commerce, comme en solo (game.js parlerA) —
      // piège signalé par docs/vague-2/B2.md § 13 : garder ce contrôle AVANT
      // executerTroc, côté serveur comme côté client.
      if (monde.reputation && !MC.Factions.commerceOuvert(monde.reputation)) break;

      if (m.action === 'consulter') {
        envoyer(c, { t: NP.MSG.TROC, action: 'offres', eid: m.eid, offres: offresPour(ent, c.nom) });
        break;
      }
      // action === 'echanger' : idempotence par seq (B1)
      if (!seqNouveau(js, m.seq)) break;
      // B4 (SPEC-PVP-006) : hors-la-loi envers une faction dont le territoire
      // couvre le lieu du PNJ → embargo (motif 'embargo', economie.js § 8).
      // SPEC-FACTION-015 : le même motif s'applique quand la faction politique
      // qui couvre le PNJ est EN GUERRE contre la faction de joueurs (guildes.js)
      // principale du joueur — extension de FACTION-003 aux factions politiques
      // et aux factions de joueurs qui leur sont alliées/ennemies (guildes.js:
      // declarerRelation pose déjà cette relation dans `politique.relations`,
      // la même Map que `MC.Politique.relationEntre` relit).
      const factionLieuTroc = MC.Politique.factionCouvrant(politique, ent.pos.x, ent.pos.z);
      const factionJoueurTroc = MC.Guildes.factionsDe(guildes, c.nom).principale;
      const embargoFaction = !!(factionLieuTroc && factionJoueurTroc &&
        MC.Politique.commerceFermeAvec(politique, factionLieuTroc, factionJoueurTroc));
      const embargo = embargoFaction || MC.PvpEnjeux.embargo(pvp, c.nom, politique, ent.pos.x, ent.pos.z);
      const r = MC.Economie.executerTroc(economie, etatJoueurServeur(js).inv, {
        lieuId: ent.lieu, role: ent.role, pnjId: ent.pnj, indice: m.offre, fois: m.fois || 1,
        nom: c.nom, embargo,
      });
      if (!r.ok) { refuserOp(c, m.j, m.seq, r.motif); break; }
      signalerSucces(js, { type: 'echange' });
      envoyerInvMaj(c, m.j, {});
      MC.Admin.journaliser(admin, { auteur: c.nom, action: 'troc', cible: m.eid, details: r.transaction, heure });
      envoyer(c, { t: NP.MSG.TROC, action: 'offres', eid: m.eid, offres: offresPour(ent, c.nom) });
      break;
    }
  }
}

// ── panneau admin en jeu (SPEC-ADMIN-006) ────────────────────────────────────
/* Le client déclare une ACTION ; le serveur ne fait jamais confiance à un rôle
   annoncé par le client — seul `c.role`, attribué PAR le serveur à l'authen-
   tification, décide. Refuser silencieusement (erreur générique) évite de
   confirmer à un tiers curieux qu'un jeton particulier existe. */
function reponseAdmin(c, action, ok, data, erreur) {
  envoyer(c, { t: NP.MSG.ADMIN_REP, action, ok, data: data || null, erreur: erreur || null });
}
function joueursEnLigne() {
  return tousLesJoueurs().map(({ c: cl, js }) => ({
    nom: cl.nom, ip: cl.ip, connecteLe: null,
    x: +js.joueur.state.pos.x.toFixed(1), y: +js.joueur.state.pos.y.toFixed(1), z: +js.joueur.state.pos.z.toFixed(1),
  }));
}
/* SPEC-MECA-007 : rejoue la commande d'un bloc de commande avec le MÊME
   analyseur/routeur que le chat (MC.Chat.parseCommande + MC.Commandes.executer,
   SPEC-CMD-001) — seules les actions qui ont un sens sans joueur qui tape
   sont appliquées ici (l'heure du monde) ; les autres (rejoindre un serveur,
   ouvrir le panneau admin…) sont silencieusement ignorées. */
function executerBlocCommandeServeur(x, y, z) {
  const texte = monde.getCommande(x, y, z);
  if (!texte) return;
  const cmd = MC.Chat.parseCommande(texte);
  if (!cmd) return;
  const res = MC.Commandes.executer(cmd, {
    temps: heure, dureeJour: MC.DayCycle ? MC.DayCycle.DAY_LENGTH : 1200,
    graine: CONF.graine, position: { x, y, z }, meteo: null, succes: null, enLigne: true, joueurs: [],
  });
  (res.actions || []).forEach(a => { if (a.type === 'heure') fixerHeureDuJour(a.valeur); });
}
/* Fixe l'heure DANS LE JOUR courant (la date, la saison et les cumulateurs
   par jour ne reculent jamais) : `v` est une heure du jour, en secondes. */
function fixerHeureDuJour(v) {
  const dl = MC.DayCycle.DAY_LENGTH;
  heure = Math.floor(heure / dl) * dl + (v % dl);
  dormeurs.clear();                     // un saut d'heure annule le vote de sommeil en cours
}
/* SPEC-ARCHI-025 : demande d'heure d'un client (ADMIN 'heure'). Réservée à un
   administrateur authentifié OU à l'hôte local d'un monde en mode créatif —
   jamais à « n'importe quel joueur en créatif » d'un serveur ouvert. Débit
   limité (1 par seconde et par connexion) ; ne journalise que si l'heure
   change ; annule le vote de sommeil (fixerHeureDuJour). */
function changerHeureDemandee(c, args) {
  if (!c.rejoint) return { ok: false, data: null, motif: 'non_rejoint' };
  if (enPause) return { ok: false, data: null, motif: 'pause' };
  const admin_ = c.role === MC.Admin.ROLES.ADMIN;
  if (!admin_ && !(c.local && regles.blocsIllimites)) return { ok: false, data: null, motif: 'reserve_creatif_ou_admin' };
  const v = args.valeur;
  if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1e6) return { ok: false, data: null, motif: 'valeur_invalide' };
  const maintenant = Date.now();
  if (c.derniereHeureMs && maintenant - c.derniereHeureMs < 1000) return { ok: false, data: null, motif: 'trop_rapide' };
  c.derniereHeureMs = maintenant;
  const avant = heure;
  fixerHeureDuJour(v);
  if (Math.abs(heure - avant) >= 0.5) MC.Admin.journaliser(admin, { auteur: c.nom, action: 'heure', cible: null, details: +heure.toFixed(1), heure });
  return { ok: true, data: { heure: +heure.toFixed(1) }, motif: null };
}
function traiterAdmin(c, m) {
  const Adm = MC.Admin;
  if (m.action === 'auth') {
    const r = Adm.authentifier(admin, m.args && m.args.secret);
    if (!r) { reponseAdmin(c, 'auth', false, null, 'refuse'); return; }
    c.role = r.role;
    if (r.nom) c.nom = c.nom || r.nom;
    if (r.role === Adm.ROLES.ADMIN && c.rejoint) Adm.noterAdminConnu(admin, c.nom);
    reponseAdmin(c, 'auth', true, { role: r.role });
    journal(`+ ${c.nom} (#${c.id}) authentifie en ${r.role}`);
    return;
  }
  /* SPEC-ARCHI-025 : /jour, /nuit — même règle en solo et en réseau : refusé
     hors mode créatif, sauf pour un administrateur authentifié. */
  if (m.action === 'heure') {
    const r = changerHeureDemandee(c, m.args || {});
    reponseAdmin(c, 'heure', r.ok, r.data, r.motif);
    return;
  }
  /* SPEC-ARCHI-033 : modifier la commande d'un bloc de commande n'exige pas un
     jeton admin quand la règle commune (blocCommandeAutorise) l'accorde — hôte
     local en créatif. Le serveur revérifie tout : pas en pause, un vrai bloc de
     commande, à portée d'un des joueurs de ce client. */
  if (m.action === 'bloc_commande' && c.role !== MC.Admin.ROLES.ADMIN) {
    const a = m.args || {};
    const x = a.x | 0, y = a.y | 0, z = a.z | 0;
    const def = C.BLOCKS[monde.getBlock(x, y, z)];
    const proche = (c.joueurs || []).some(js => distanceConteneur(js.joueur.state, x, y, z) <= PORTEE_BLOC);
    if (enPause || !c.rejoint || !blocCommandeAutorise(c) || !def || !def.circuit || def.circuit.type !== 'commande' || !proche) {
      reponseAdmin(c, m.action, false, null, 'refuse');
      return;
    }
    const rc = executerActionAdmin(MC.Admin.ROLES.ADMIN, c.nom, m.action, a);
    reponseAdmin(c, m.action, rc.ok, rc.ok ? rc.data : null, rc.ok ? null : rc.motif);
    return;
  }
  if (!c.role) { reponseAdmin(c, m.action, false, null, 'non_authentifie'); return; }
  const r = executerActionAdmin(c.role, c.nom, m.action, m.args || {});
  reponseAdmin(c, m.action, r.ok, r.ok ? r.data : null, r.ok ? null : r.motif);
}

/* Cœur commun au panneau en jeu (WebSocket) ET à la console web (HTTP) : les
   deux ne doivent JAMAIS diverger sur qui a le droit de faire quoi — d'où un
   seul endroit qui décide, appelé par les deux façades. */
function executerActionAdmin(role, nomActeur, action, args) {
  const Adm = MC.Admin;
  args = args || {};
  const roleCible = args.nom ? Adm.roleDe(admin, args.nom) : null;
  if (!Adm.peutAgir(role, action, roleCible)) return { ok: false, motif: 'refuse' };

  switch (action) {
    case 'mesures': return { ok: true, data: statsMesures() };
    case 'joueurs': return { ok: true, data: Adm.vueJoueurs(admin, joueursEnLigne(), role) };
    case 'sessions': return { ok: true, data: Adm.vueSessions(admin, args.nom, role) };
    case 'listes': return { ok: true, data: Adm.vueListes(admin, role) };
    case 'journal': return { ok: true, data: Adm.vueJournal(admin, role, args.limite) };
    case 'inventaire': {
      const cible = [...clients.values()].find(x => x.nom === args.nom);
      const inv = cible && cible.joueurs && cible.joueurs[0] ? cible.joueurs[0].joueur.state.inv.serialize() : [];
      return { ok: true, data: inv };
    }
    case 'liste_ajouter':
      return { ok: true, data: Adm.ajouterListe(admin, args.liste, args.categorie, args.valeur, nomActeur, heure) };
    case 'liste_retirer':
      return { ok: true, data: Adm.retirerListe(admin, args.liste, args.categorie, args.valeur, nomActeur, heure) };
    case 'invitation_creer':
      return { ok: true, data: Adm.creerInvitation(admin, args, nomActeur, heure) };
    case 'invitation_revoquer':
      return { ok: true, data: Adm.revoquerInvitation(admin, args.token, nomActeur, heure) };
    case 'role_nommer':
      return { ok: true, data: Adm.nommerRole(admin, args.nom, args.role || null, nomActeur, heure) };
    case 'zone_definir': {
      // SPEC-ZONE-004 / SPEC-ADMIN-006 : un administrateur redéfinit la zone
      // de la région où se trouve le point (x, z) donné.
      const r = MC.Zones.definirRegion(monde.zonesEtat, +args.x || 0, +args.z || 0, args.zone, nomActeur, heure);
      if (r.ok) MC.Admin.journaliser(admin, { auteur: nomActeur, action: 'zone_definie', cible: r.region, details: r.zone, heure });
      return { ok: true, data: r };
    }
    case 'zone_retirer': {
      const r = MC.Zones.retirerRegion(monde.zonesEtat, +args.x || 0, +args.z || 0);
      if (r.ok) MC.Admin.journaliser(admin, { auteur: nomActeur, action: 'zone_retiree', cible: null, heure });
      return { ok: true, data: r };
    }
    case 'bloc_commande': {
      const x = args.x | 0, y = args.y | 0, z = args.z | 0;
      const texte = monde.setCommande(x, y, z, args.texte);
      MC.Admin.journaliser(admin, { auteur: nomActeur, action: 'bloc_commande', cible: `${x},${y},${z}`, details: texte, heure });
      return { ok: true, data: { texte } };
    }
    case 'sanction': {
      const res = Adm.sanctionner(admin, { nom: args.nom, type: args.type, dureeMs: args.dureeMs, auteur: nomActeur }, heure);
      if (res.ok && (args.type === 'expulser' || args.type === 'bannir')) {
        const cible = [...clients.values()].find(x => x.nom === args.nom);
        if (cible) fermer(cible, 'sanction : ' + args.type);
      }
      return { ok: true, data: res };
    }
    default: return { ok: false, motif: 'action_inconnue' };
  }
}

// ── inventaire et conteneurs (B1, SPEC-SYNC-007 à 017) ──────────────────────
/* Le serveur devient la seule source de vérité pour l'inventaire, l'équipement
   et la grille de fabrication : le même module pur MC.Conteneurs que le solo
   et la prédiction client (docs/vague-2/B1.md § 3). Cette section ne connaît
   ENCORE PAS le registre des conteneurs posés (coffres, fourneaux… — étape 7) :
   seule la banque, par joueur nommé, existe déjà comme conteneur vivant.
   `joueursRegistre`, `banques` et `banqueDe` sont déclarés plus haut (voir
   commentaire à leur définition). */
/* MC_TEST_INV='[[id,n],…]' : inventaire initial d'un joueur SANS enregistrement
   (jamais rejoint sous ce nom auparavant) — lu une fois au démarrage, comme
   MC_TEST_PANNE ; réservé aux suites d'intégration, jamais en exploitation. */
let MC_TEST_INV = null;
try { MC_TEST_INV = process.env.MC_TEST_INV ? JSON.parse(process.env.MC_TEST_INV) : null; }
catch (e) { MC_TEST_INV = null; }
if (MC_TEST_INV) journal('ATTENTION : MC_TEST_INV actif — les nouveaux joueurs reçoivent un inventaire imposé (réglage de test, jamais en exploitation)');

// une clé de registre déjà tenue par un joueur CONNECTÉ (écran partagé
// compris) : la seconde connexion sous le même nom reste éphémère (jamais
// restaurée, jamais réécrite dans le registre à sa fermeture).
function cleRegDejaConnectee(cleReg) {
  for (const cl of clients.values()) {
    if (!cl.joueurs) continue;
    if (cl.joueurs.some(j2 => j2.cleReg === cleReg)) return true;
  }
  return false;
}
/* ctx pour MC.Conteneurs.appliquer : `conteneur(cle)` est LE point où
   l'accès à un conteneur posé ou à la banque est décidé — abonnement
   (`js.conteneurOuvert`, un seul conteneur ouvert à la fois par joueur
   local, comme l'écran) ET portée (SPEC-SYNC-013, 6 blocs) revérifiés à
   CHAQUE appel, pas seulement à l'ouverture : un joueur qui s'est éloigné,
   ou qui n'a jamais ouvert ce conteneur, ne peut plus agir dessus même s'il
   en connaît la clé (rejeu, faux message forgé…). */
function ctxJoueur(js) {
  return {
    joueur: { inv: js.joueur.state.inv, equip: js.joueur.state.equip, grille: js.grille },
    conteneur: (cle) => resoudreConteneur(js, cle),
    regles,
    stats: { faim: js.joueur.state.hunger, vie: js.joueur.state.hp, vieMax: MC.PlayerConst.MAX_HP },
    eauProche: () => eauProcheDe(js.joueur.state.pos),
  };
}
// distance (œil du joueur → CENTRE du bloc), même calcul que blocAutorise plus bas
function distanceConteneur(st, x, y, z) {
  return Math.hypot(x + 0.5 - st.pos.x, y + 0.5 - (st.pos.y + 1.62), z + 0.5 - st.pos.z);
}
function resoudreConteneur(js, cle) {
  if (js.conteneurOuvert !== cle) return null;      // pas abonné (ou pas CE conteneur) : refusé
  const st = js.joueur.state;
  if (cle[0] === 'v') return souteDeVehicule(cle, st);   // soute d'un véhicule (P-VEH), proximité REvérifiée
  if (cle === 'banque') {
    if (!js.cleReg) return null;
    // SYNC-013 : la banque exige la proximité d'un bloc coffre-fort (ou du
    // banquier par lequel elle a été ouverte) — REvérifiée ici, pas
    // seulement à CONTENEUR_OUVRIR (un joueur qui s'éloigne perd l'accès).
    if (js.banquePos) {
      if (distanceConteneur(st, js.banquePos.x, js.banquePos.y, js.banquePos.z) > MC.ContratsV2.BORNES.PORTEE_CONTENEUR) return null;
    } else if (js.banqueEid !== null && js.banqueEid !== undefined) {
      const ent = entites.list.find(e => e.eid === js.banqueEid && !e.dead);
      if (!ent) return null;
      const d = Math.hypot(ent.pos.x - st.pos.x, (ent.pos.y || 0) - st.pos.y, ent.pos.z - st.pos.z);
      if (d > MC.ContratsV2.BORNES.PORTEE_CONTENEUR) return null;
    } else return null;
    return banqueDe(js.cleReg);
  }
  const cont = conteneursPoses.get(cle);
  if (!cont) return null;                            // détruit entre-temps (cassé)
  const p = cle.split(',');
  if (p.length !== 3 || distanceConteneur(st, +p[0], +p[1], +p[2]) > MC.ContratsV2.BORNES.PORTEE_CONTENEUR) return null;
  return cont;
}
// tous les joueurs locaux (toutes connexions) actuellement abonnés à `cle`
// (SPEC-SYNC-015 : à qui diffuser un CONTENEUR_MAJ)
function abonnesActuels(cle) {
  return tousLesJoueurs().filter(x => x.js.conteneurOuvert === cle);
}
/* Revue adversariale (item 3) : quand un conteneur posé disparaît (cassé,
   avec ou sans bloc reposé ensuite au même endroit), tout joueur qui l'avait
   ouvert est FORCÉMENT désabonné ET prévenu — jamais une resubscription
   fantôme qui réutiliserait la clé pour un conteneur de type différent
   (coffre 27 cases → fourneau 3 cases, par exemple). `CONTENEUR_FERMER`
   (message existant, jusqu'ici seulement c→s) sert aussi de notification
   s→c : net.js ferme l'écran du client dès qu'il la reçoit pour SA clé
   ouverte. */
function fermerConteneurPourAbonnes(cle) {
  abonnesActuels(cle).forEach(({ c: c2, j: j2, js: js2 }) => {
    js2.conteneurOuvert = null;
    js2.banquePos = null;
    js2.banqueEid = null;
    envoyer(c2, { t: NP.MSG.CONTENEUR_FERMER, j: j2, cle: cle });
  });
}
/* Résout et ouvre un conteneur pour CONTENEUR_OUVRIR (bloc posé à x,y,z, ou
   banquier par eid) : vérifie la portée, crée le conteneur au registre à la
   première ouverture (donjon, bibliothèque générée — parité avec le solo,
   game.js coffreDe/l. 1734-1747, 2104-2110), et marque l'abonnement. Renvoie
   { cle, type, cont } ou null (refusé). */
function ouvrirConteneurPourJoueur(js, m) {
  const st = js.joueur.state;
  if (m.eid !== undefined) {
    // la soute d'un véhicule (SPEC-SYNC-022) : conteneur serveur, clé « v<eid> »
    const veh = vehiculeParEid(m.eid);
    if (veh) {
      const cleV = 'v' + veh.eid, soute = souteDeVehicule(cleV, st);
      if (!soute) return null;
      js.conteneurOuvert = cleV; js.banquePos = null; js.banqueEid = null;
      return { cle: cleV, type: soute.type, cont: soute };
    }
    const ent = entites.list.find(e => e.eid === m.eid && e.role === 'banquier' && !e.dead);
    if (!ent || !js.cleReg) return null;
    const d = Math.hypot(ent.pos.x - st.pos.x, (ent.pos.y || 0) - st.pos.y, ent.pos.z - st.pos.z);
    if (d > MC.ContratsV2.BORNES.PORTEE_CONTENEUR) return null;
    js.conteneurOuvert = 'banque'; js.banquePos = null; js.banqueEid = m.eid;
    return { cle: 'banque', type: 'banque', cont: banqueDe(js.cleReg) };
  }
  if (distanceConteneur(st, m.x, m.y, m.z) > MC.ContratsV2.BORNES.PORTEE_CONTENEUR) return null;
  const bd = C.BLOCKS[monde.getBlock(m.x, m.y, m.z)];
  if (!bd || !bd.interactive) return null;
  if (bd.interactive === 'banque') {
    if (!js.cleReg) return null;
    js.conteneurOuvert = 'banque'; js.banquePos = { x: m.x, y: m.y, z: m.z }; js.banqueEid = null;
    return { cle: 'banque', type: 'banque', cont: banqueDe(js.cleReg) };
  }
  const t = MC.ContratsV2.TYPES_CONTENEUR[bd.interactive];
  if (!t || t.parJoueur) return null;                 // 'craft' (établi), 'info'… : pas un conteneur posé
  const cle = MC.ContratsV2.cleConteneur(m.x, m.y, m.z);
  let cont = conteneursPoses.get(cle);
  if (!cont) {
    cont = MC.Conteneurs.creerConteneur(bd.interactive);
    if (!cont) return null;
    remplirConteneurNeuf(cont, bd.interactive, m.x, m.y, m.z, cle);
    conteneursPoses.set(cle, cont);
  }
  js.conteneurOuvert = cle; js.banquePos = null; js.banqueEid = null;
  return { cle, type: bd.interactive, cont };
}
/* Défense en profondeur (revue adversariale) : le correctif d'`indiceValide`
   (conteneurs.js) empêche désormais toute écriture qui agrandirait
   `cont.slots` au-delà de `cont.taille` — mais un conteneur DÉJÀ mal formé
   (ancienne exécution avant ce correctif, ou toute autre voie non prévue) ne
   doit plus être filtré silencieusement par `validerConteneurPersiste`
   (`slots.length === taille` strict), ce qui aurait fait disparaître le
   conteneur ENTIER, y compris ses cases valides, à la prochaine relance
   `--monde`. Tronque à la taille réelle ; l'excédent (toujours à une
   position connue — `cle` encode x,y,z pour un conteneur posé) tombe au
   sol comme une casse ordinaire, jamais perdu sans trace. */
function normaliserTailleConteneur(cle, cont) {
  if (cont.slots.length === cont.taille) return;
  if (cont.slots.length < cont.taille) {
    while (cont.slots.length < cont.taille) cont.slots.push(null);
    return;
  }
  const excedent = cont.slots.slice(cont.taille);
  cont.slots.length = cont.taille;
  const p = cle.split(',');
  let lachees = 0;
  excedent.forEach(s => {
    if (!s) return;
    lachees++;
    if (p.length === 3) entites.dropItem(+p[0] + 0.5, +p[1] + 0.5, +p[2] + 0.5, s.id, s.n);
  });
  journal(`avertissement : conteneur ${cle} (${cont.type}) mal formé — ` +
          `${cont.slots.length + excedent.length} case(s) au lieu de ${cont.taille}, tronqué` +
          (lachees ? `, ${lachees} pile(s) lâchée(s) au sol` : ''));
}
/* Un objet ajouté à la première case libre — assez pour remplir un
   conteneur neuf (donjon, bibliothèque générée), jamais utilisé pour un
   transfert normal (qui passe par MC.Conteneurs.appliquer). */
function ajouterPileConteneur(cont, id, n, data) {
  for (let i = 0; i < cont.slots.length && n > 0; i++) {
    if (!cont.slots[i]) {
      const p = { id, n: Math.min(n, C.maxStack(id)) };
      if (data !== undefined) p.data = data;
      cont.slots[i] = p;
      n -= p.n;
    }
  }
  return n;
}
/* Parité avec le solo (game.js coffreDe, l. 1734-1747 ; ouvrirConteneur,
   l. 2104-2110) : un coffre de donjon se remplit de son butin à la première
   ouverture, une bibliothèque générée (jamais posée par un joueur) tient
   quelques livres du monde. */
function remplirConteneurNeuf(cont, type, x, y, z, cle) {
  if (type === 'chest' && monde.butinCoffre && monde.coffresPilles && !monde.coffresPilles.has(cle)) {
    const butin = monde.butinCoffre(x, y, z);
    if (butin) { monde.coffresPilles.add(cle); butin.forEach(st => ajouterPileConteneur(cont, st.id, st.n)); }
  } else if (type === 'bibliotheque' && !monde.overrides.has(cle) && MC.Livres && monde.habitats) {
    const lieuB = monde.habitats.lieuxProches(x, z, 160)[0];
    if (lieuB) for (let nb = 0; nb < 3; nb++) {
      ajouterPileConteneur(cont, C.I.LIVRE, 1, MC.Livres.livreDuMonde(monde.seed + nb * 7919, lieuB));
    }
  }
}
// approximation volontairement large (pas un rayon lancé) : juste assez pour
// distinguer « près d'une source d'eau » de « nulle part près de l'eau »,
// seule chose que vérifie INV_CONSOMMER { vers } (SEAU → SEAU_EAU).
function eauProcheDe(pos) {
  const cx = Math.floor(pos.x), cy = Math.floor(pos.y), cz = Math.floor(pos.z);
  for (let dx = -3; dx <= 3; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -3; dz <= 3; dz++) {
    if (C.isWater(monde.getBlock(cx + dx, cy + dy, cz + dz))) return true;
  }
  return false;
}
function etatJoueurServeur(js) {
  return { inv: js.joueur.state.inv, equip: js.joueur.state.equip, grille: js.grille };
}
// § 5 du plan (API figée, appelée telle quelle par B2 et B4) : seq strictement
// croissant par connexion et joueur local ; un doublon (seq ≤ dernier connu)
// est ignoré — ni effet, ni réponse (idempotence, SPEC-SYNC-008/014).
function seqNouveau(js, seq) {
  if (!(seq > js.dernierSeq)) return false;
  js.dernierSeq = seq;
  return true;
}
function envoyerInvMaj(c, j, opts) {
  const js = c.joueurs && c.joueurs[j];
  if (!js) return;
  js.revInv = (js.revInv || 0) + 1;
  envoyer(c, MC.ContratsV2.messageInvMaj(etatJoueurServeur(js),
    Object.assign({}, opts, { j, rev: js.revInv, ack: js.dernierSeq })));
}
function refuserOp(c, j, seq, motif) {
  envoyerInvMaj(c, j, { refus: [{ seq, motif }] });
}
function lacherAuxPieds(js, pile) {
  if (!pile || !pile.n) return;
  const p = js.joueur.state.pos;
  entites.dropItem(p.x, p.y + 1, p.z, pile.id, pile.n);
}
// clé(s) de conteneur posé/banque potentiellement concernées par une
// opération AVANT de savoir si elle réussit (pour capturer l'instantané
// « avant » sans dépendre du résultat) — transfert : de/vers ; declarer : cle.
function clesConteneurDe(op) {
  const out = [];
  if (op.de && op.de.z === 'cont') out.push(op.de.cle);
  if (op.vers && op.vers.z === 'cont') out.push(op.vers.cle);
  if (op.cle) out.push(op.cle);
  return out;
}
function conteneurParCle(js, cle) {
  if (cle === 'banque') return js.cleReg ? banqueDe(js.cleReg) : null;
  return cle[0] === 'v' ? souteDeVehicule(cle, null) : conteneursPoses.get(cle);
}
/* Cœur commun à CRAFT, EQUIP, CONTENEUR_TRANSFERT, INV_CONSOMMER, INV_LACHER,
   INV_CREATIF : vérifie l'idempotence du `seq`, applique l'opération pure,
   lâche au sol ce qu'elle a éventuellement fait déborder, puis répond par un
   INV_MAJ (ack ou refus) — TOUJOURS, jamais deux messages non atomiques.

   SPEC-SYNC-015 : quand l'opération touche un conteneur posé ou la banque
   (`r.modifs.conteneurs`), l'AUTEUR reçoit le delta DANS son INV_MAJ
   (`conteneurs:[…]`, jamais un CONTENEUR_MAJ séparé — ça clignoterait) ; les
   AUTRES joueurs qui ont ce même conteneur ouvert reçoivent un CONTENEUR_MAJ. */
function traiterOp(c, m, js, op) {
  if (!seqNouveau(js, m.seq)) return null;
  const avant = new Map();
  clesConteneurDe(op).forEach(cle => {
    const cont = conteneurParCle(js, cle);
    if (cont) avant.set(cle, MC.Conteneurs.instantane(cont));
  });
  const r = MC.Conteneurs.appliquer(ctxJoueur(js), op);
  if (!r.ok) { refuserOp(c, m.j, m.seq, r.motif); return r; }
  if (r.effets && r.effets.lache) lacherAuxPieds(js, r.effets.lache);
  const deltas = [];
  (r.modifs.conteneurs || []).forEach(cle => {
    const cont = conteneurParCle(js, cle);
    if (!cont) return;
    const av = avant.get(cle);
    const maj = av ? MC.Conteneurs.diff(av.slots, cont.slots)
                   : cont.slots.map((s, i) => [i, MC.ContratsV2.pileVersCase(s)]);
    const delta = { cle, rev: cont.rev, maj };
    if (cont.four) delta.four = { burn: cont.four.burn, cook: cont.four.cook };
    deltas.push(delta);
    abonnesActuels(cle).forEach(({ c: c2, j: j2 }) => {
      if (c2.id === c.id && j2 === m.j) return;         // jamais à l'auteur (déjà dans son INV_MAJ)
      envoyer(c2, Object.assign({ t: NP.MSG.CONTENEUR_MAJ }, delta));
    });
  });
  envoyerInvMaj(c, m.j, deltas.length ? { conteneurs: deltas } : {});
  return r;
}
/* SPEC-SYNC-011 : EQUIP_VU n'est diffusé qu'aux AUTRES joueurs à portée de vue
   (même rayon que la diffusion d'état, § 4 du plan — 96 blocs), jamais à
   l'auteur du changement (déjà informé par son propre INV_MAJ). */
function diffuserEquipVu(c, j, js, slot) {
  const pile = js.joueur.state.equip[slot];
  const objet = pile ? pile.id : 0;
  const pos = js.joueur.state.pos;
  clients.forEach(cl => {
    if (cl.id === c.id || !cl.rejoint || !cl.joueurs) return;
    const proche = cl.joueurs.some(x => Math.hypot(x.joueur.state.pos.x - pos.x, x.joueur.state.pos.z - pos.z) < 96);
    if (proche) envoyer(cl, { t: NP.MSG.EQUIP_VU, id: c.id, j, slot, objet });
  });
}

// ── succès (SPEC-ARCHI-042) ──────────────────────────────────────────────────
/* Le serveur est le SEUL arbitre des succès : il les décide à partir de ce
   qu'il a lui-même constaté (blocs cassés acceptés, fabrication validée,
   position qui fait foi…), jamais d'un message du client. Chaque joueur
   (solo fermé, écran partagé, réseau) a son suivi `js.succes`, persisté dans
   son enregistrement nommé. Le client reçoit SUCCES_DEBLOQUE (annonce, une
   seule fois) et SUCCES_ETAT (compteurs du panneau, au plus toutes les 2 s).
   Les événements `vehicule` (embarquement, P-VEH) et `histoire` (lot P-HIST) passent par ce même `signalerSucces`. */
const SUCCES_ETAT_PERIODE_S = 2;
const RAYON_SUCCES_BOSS = 64;
function clientDeJoueur(js) { return js && js.cid !== null ? clients.get(js.cid) || null : null; }
function envoyerSuccesEtat(js) {
  const c = clientDeJoueur(js);
  js.succesRevEnvoyee = js.succes.revision();
  js.succesEnvoiT = SUCCES_ETAT_PERIODE_S;
  if (!c || !c.rejoint) return;
  envoyer(c, { t: NP.MSG.SUCCES_ETAT, j: js.j, etat: js.succes.serialiser() });
}
function signalerSucces(js, ev) {
  if (!js || !js.succes) return [];
  const nouveaux = js.succes.signaler(ev);
  const c = clientDeJoueur(js);
  if (nouveaux.length && c && c.rejoint) {
    nouveaux.forEach(n => {
      envoyer(c, { t: NP.MSG.SUCCES_DEBLOQUE, j: js.j, id: n.id });
      journal(`succès : ${c.nom} (joueur ${js.j + 1}) — ${n.nom}`);
    });
    envoyerSuccesEtat(js);
  }
  return nouveaux;
}
/* Événements du journal des créatures : tuer crédite l'auteur du coup fatal ;
   un gardien vaincu crédite son vainqueur et les joueurs à moins de 64 blocs. */
function crediterSuccesEvenement(evt) {
  if (evt.type === 'mort') {
    const x = evt.auteur ? joueurParEtat(evt.auteur) : null;
    if (x) signalerSucces(x.js, { type: 'tuer', mob: evt.victime });
  } else if (evt.type === 'boss_vaincu') {
    const credites = new Set();
    const x = evt.auteur ? joueurParEtat(evt.auteur) : null;
    if (x) credites.add(x.js);
    tousLesJoueurs().forEach(({ js }) => {
      const st = js.joueur.state, p = st.pos;
      if (!st.dead && evt.pos && Math.hypot(p.x - evt.pos.x, p.y - evt.pos.y, p.z - evt.pos.z) <= RAYON_SUCCES_BOSS) credites.add(js);
    });
    credites.forEach(js => signalerSucces(js, { type: 'boss', donjon: evt.donjon }));
  }
}
/* Une fois par tic et par joueur : position (distance, altitude, nuit), lieu
   visité, et renvoi des compteurs au client quand ils ont changé. */
function tickerSuccesJoueur(js, dt) {
  const st = js.joueur.state;
  js.suiveur.tic(dt, st.pos, !st.dead, MC.DayCycle.isNight(heure), dormeurs.has(js)).forEach(ev => signalerSucces(js, ev));
  js.lieuT -= dt;
  if (js.lieuT <= 0 && monde.habitats && !st.dead) {
    js.lieuT = 1;
    const l = monde.habitats.lieuA(Math.floor(st.pos.x), Math.floor(st.pos.z));
    if (l !== js.lieuSucces) {
      js.lieuSucces = l;
      if (l) signalerSucces(js, { type: 'lieu', kind: l.kind });
    }
  }
  js.succesEnvoiT -= dt;
  if (js.succesEnvoiT <= 0 && js.succes.revision() !== js.succesRevEnvoyee) envoyerSuccesEtat(js);
}

// ── joueurs simulés ──────────────────────────────────────────────────────────
/* Un joueur du serveur : le MÊME code que celui du client (player.js), piloté
   par les entrées reçues. C'est lui qui fait foi sur la position et les
   statistiques (vie, faim, air, mort). */
function creerJoueurServeur(j) {
  const joueur = MC.createPlayer(monde, entites, regles);
  joueur.state.pos.x = SPAWN.x + j * 1.2; joueur.state.pos.y = SPAWN.y; joueur.state.pos.z = SPAWN.z;
  // B1 : grille de fabrication propre à ce joueur local, et idempotence des
  // messages d'inventaire (dernierSeq, revInv — voir seqNouveau/envoyerInvMaj).
  const grille = MC.Inventory.create(MC.ContratsV2 ? MC.ContratsV2.BORNES.SLOTS_GRILLE : 9);
  return { joueur, grille, cleReg: null, dernierSeq: 0, revInv: 0,
           // SPEC-ARCHI-042 : succès du joueur, suivi de position (distance, altitude, nuit),
           // connexion et rang local (renseignés à REJOINDRE), dernier état de succès envoyé
           succes: MC.Succes.creer(), suiveur: MC.Succes.creerSuiveur(), cid: null, j: 0,
           succesRevEnvoyee: -1, succesEnvoiT: 0, lieuSucces: null, lieuT: 0,
           // B1 (étape 7) : conteneur posé (ou 'banque') actuellement ouvert par
           // ce joueur local — un seul à la fois, voir resoudreConteneur/ctxJoueur.
           conteneurOuvert: null, banquePos: null, banqueEid: null,
           entrees: [], dernier: 0, budget: SY.creerBudget(), attaqueCd: 0, tirCd: 0 };
}
const PORTEE_BLOC = 7;

/* ── SPEC-SYNC-028 : poser un bloc et tirer se paient sur l'inventaire SERVEUR ──
   En survie, une pose n'est acceptée que si l'inventaire du serveur porte un
   objet qui pose ce bloc, un tir que s'il porte une munition compatible (ou
   une arme sans munition) ; l'objet est retiré ICI, à l'instant de l'action.
   Le client prédit la même diminution et l'envoie ensuite dans son journal
   INV_CONSOMMER : pour ne jamais la compter deux fois, chaque débit fait par le
   serveur laisse un CRÉDIT (id → 1, valable DELAI_CREDIT_MS) que la
   consommation journalisée correspondante absorbe au lieu de la rejouer. */
const DELAI_CREDIT_MS = 120000;     // long : un journal en retard (onglet en arrière-plan, latence) ne doit jamais faire payer deux fois
const CREDITS_MAX = 128;            // borne : un client qui ne journalise jamais ne cumule pas indéfiniment
/* MC_TEST_POSE_LIBRE=1 : suspend ce contrôle (poser/tirer sans posséder) pour les
   suites d'intégration dont l'objet n'est PAS l'inventaire (réseau, flood,
   sauvegarde…) et qui posent des blocs sans s'en donner ; même principe que
   MC_TEST_PANNE, jamais en exploitation. Les suites d'inventaire ne l'utilisent pas. */
const POSE_LIBRE = process.env.MC_TEST_POSE_LIBRE === '1';
if (process.env.MC_HISTOIRE) journal('ATTENTION : MC_HISTOIRE actif — paramètres du récit imposés sans partie (réglage de test, jamais en exploitation)');
if (process.env.MC_TEST_PRES_GUIDE) journal('ATTENTION : MC_TEST_PRES_GUIDE actif — le héros s\'éveille à côté du guide (réglage de test, jamais en exploitation)');
if (POSE_LIBRE) journal('ATTENTION : MC_TEST_POSE_LIBRE actif — poser et tirer ne sont PAS contrôlés contre l inventaire (réglage de test, jamais en exploitation)');

/* Blocs posés d'un seul geste : une porte occupe deux cases (dessus), un lit
   deux cases (la tête, dans la direction de son orientation). Le client annonce
   la case visée ; le serveur pose lui-même la compagne, sans second objet. */
function cellulesCompagnes(m) {
  const d = C.BLOCKS[m.id];
  if (!d) return [];
  if (d.porte && !d.porte.ouverte) return [{ x: m.x, y: m.y + 1, z: m.z, id: m.id, etat: m.etat || 0 }];
  if (d.meuble === 'lit' && MC.Formes) {
    const e = MC.Formes.unpackMeuble(m.etat || 0);
    if (e.variante) return [];
    const dir = MC.Formes.DIRS[e.orientation];
    return [{ x: m.x + dir[0], y: m.y, z: m.z + dir[1], id: m.id, etat: MC.Formes.packMeuble(e.orientation, true) }];
  }
  return [];
}
// la moitié d'une porte cassée, la moitié d'un lit cassé : l'autre case disparaît avec elle
function compagnesDeCasse(avant, m) {
  const d = C.BLOCKS[avant];
  if (!d) return [];
  const out = [];
  if (d.porte) {
    [1, -1].some(dy => { if (monde.getBlock(m.x, m.y + dy, m.z) === avant) { out.push({ x: m.x, y: m.y + dy, z: m.z }); return true; } return false; });
  } else if (d.meuble === 'lit' && MC.Formes) {
    const e = MC.Formes.unpackMeuble(monde.getEtat(m.x, m.y, m.z));
    const dir = MC.Formes.DIRS[e.orientation];
    const sens = e.variante ? -1 : 1;
    const x = m.x + sens * dir[0], z = m.z + sens * dir[1];
    if (monde.getBlock(x, m.y, z) === avant) out.push({ x, y: m.y, z });
  }
  return out;
}
function crediterDebit(js, id) {
  const maintenant = Date.now();
  js.debitsPrevus = (js.debitsPrevus || []).filter(d => maintenant - d.t < DELAI_CREDIT_MS);
  js.debitsPrevus.push({ id, t: maintenant });
  if (js.debitsPrevus.length > CREDITS_MAX) js.debitsPrevus.shift();
}
/* Retire des opérations `{ i, id, n }` d'un INV_CONSOMMER ce que le serveur a
   déjà débité (un crédit par exemplaire) ; les autres opérations passent. */
function absorberDebitsPrevus(js, ops) {
  const maintenant = Date.now();
  js.debitsPrevus = (js.debitsPrevus || []).filter(d => maintenant - d.t < DELAI_CREDIT_MS);
  if (!js.debitsPrevus.length) return ops;
  const out = [];
  ops.forEach(o => {
    if (o.n === undefined || o.usure !== undefined || o.vers !== undefined) { out.push(o); return; }
    let reste = o.n;
    for (let k = 0; k < js.debitsPrevus.length && reste > 0;) {
      if (js.debitsPrevus[k].id === o.id) { js.debitsPrevus.splice(k, 1); reste--; } else k++;
    }
    if (reste > 0) out.push(reste === o.n ? o : Object.assign({}, o, { n: reste }));
  });
  return out;
}
// l'objet `idObjet` pose-t-il le bloc `idBloc` ? (bloc lui-même, graine, porte, trappe, dalle fusionnée)
function objetPoseBloc(idObjet, idBloc) {
  if (idObjet === idBloc) return true;
  const d = C.def(idObjet);
  if (!d) return false;
  if (d.plantable === idBloc) return true;
  if (d.forme === 'dalle' && d.mat === idBloc) return true;
  if (d.porte && C.PORTE_FERMEE_LIST && C.PORTE_FERMEE_LIST.indexOf(idBloc) >= 0) return true;
  if (d.trappe && idBloc === C.B.TRAPPE_FERMEE) return true;
  return false;
}
/* Débite une pose : case `preferee` (celle que le client tient) si elle convient,
   sinon la première qui convient. Renvoie false si l'inventaire n'a rien à poser. */
function debiterPose(js, idBloc, preferee) {
  const inv = js.joueur.state.inv;
  let i = -1;
  if (Number.isInteger(preferee) && inv.slots[preferee] && objetPoseBloc(inv.slots[preferee].id, idBloc)) i = preferee;
  else for (let k = 0; k < inv.slots.length; k++) if (inv.slots[k] && objetPoseBloc(inv.slots[k].id, idBloc)) { i = k; break; }
  if (i < 0) return false;
  const id = inv.slots[i].id;
  inv.consumeAt(i, 1);
  crediterDebit(js, id);
  return true;
}
/* Tir : true si le joueur peut tirer ce `genre` ; débite alors la munition.
   Limite documentée (SPEC-SYNC-028) : le serveur ne connaît pas la case
   sélectionnée du client, il exige donc l'arme du genre quelque part dans
   l'inventaire, pas forcément en main. */
function debiterTir(js, genre) {
  const inv = js.joueur.state.inv;
  const aArme = inv.slots.some(s => { const d = s && C.def(s.id); return !!(d && d.ranged === genre); });
  if (!aArme) return false;
  const sans = inv.slots.some(s => { const d = s && C.def(s.id); return !!(d && d.ranged === genre && d.sansMunition); });
  if (sans) return true;
  for (let i = 0; i < inv.slots.length; i++) {
    const s = inv.slots[i], d = s && C.def(s.id);
    // une munition sans type ne sert que l'arc et l'arbalète (genre « fleche »), jamais la fronde
    if (d && d.ammo && (d.ammoType ? d.ammoType === genre : genre === 'fleche')) {
      inv.consumeAt(i, 1);
      crediterDebit(js, s.id);
      return true;
    }
  }
  return false;
}
function blocAutorise(js, m, avant, c) {
  if (!js || js.joueur.state.dead) return false;
  const st = js.joueur.state;
  const d = Math.hypot(m.x + 0.5 - st.pos.x, m.y + 0.5 - st.pos.y - 1.62, m.z + 0.5 - st.pos.z);
  if (d > PORTEE_BLOC) return false;                      // hors de portée
  if (m.id === 0) {
    const def = C.BLOCKS[avant];
    if (!def || def.hardness < 0) return false;            // ni le socle ni l'eau
    if (!MC.Modes.peutCasser(regles, avant)) return false;  // mode histoire : ce bloc ne se casse pas dans cette aventure (ARCHI-041)
    if (def.circuit && def.circuit.adminSeul) return blocCommandeAutorise(c);
    return true;
  }
  // on ne pose que dans une case libre (air, eau, plante) — sauf la fusion de
  // deux dalles du même matériau en bloc plein (SPEC-CONSTR-002), qui écrit
  // par-dessus la dalle visée elle-même, jamais une case vide.
  const defAvant = C.BLOCKS[avant];
  const fusionDalle = !!(defAvant && defAvant.forme === 'dalle' && defAvant.mat === m.id);
  if (!fusionDalle && !C.isReplaceable(avant)) return false;
  const posee = C.BLOCKS[m.id];
  if (posee && posee.circuit && posee.circuit.adminSeul) return blocCommandeAutorise(c);
  if (!MC.Modes.peutPoser(regles, m.id)) return false;      // mode histoire : cet objet n'a pas sa place dans l'aventure (ARCHI-041)
  return true;
}
/* SPEC-MECA-007 : poser ou casser un bloc de commande — en ligne, réservé à
   un administrateur (le serveur fait toujours autorité, jamais le mode local
   du client, qui ne veut rien dire une fois connecté). */
function blocCommandeAutorise(c) {
  /* Même règle pour le solo (serveur fermé) et le réseau (SPEC-ARCHI-033) :
     administrateur, ou hôte local (boucle locale) quand la partie est en
     mode créatif. Le mode est celui du SERVEUR, jamais annoncé par le client. */
  return !!(MC.Circuits && MC.Circuits.commandeAutorisee({
    enLigne: true, role: c && c.role, mode: regles.blocsIllimites ? 'creatif' : 'survie', hote: !!(c && c.local),
  }));
}
/* ── Véhicules (lot P-VEH — SPEC-ARCHI-021, SPEC-SYNC-022, SPEC-SERVEUR-006) ──
   Un véhicule est une entité du monde (entites.list, type « v_<nom> »), donc
   diffusée aux clients à portée avec les autres entités (ETAT.mobs, plafond
   propre MAX_VEHICULES_DIFFUSES). Le serveur fait seul autorité :
   - poser : validé contre la portée, la place et l'inventaire (comme un bloc) ;
   - monter/descendre : validés contre la portée et l'occupation ;
   - conduire : les touches de ENTREE (avant, arrière, gauche, droite, saut, course)
     sont intégrées par MC.Vehicules.conduire à CHAQUE entrée rejouée, sous le
     budget de temps du joueur (js.budget) — donc vitesse maximale, accélération
     et position ne se « déclarent » jamais, ils se simulent. L'état du véhicule
     conduit revient au conducteur dans ETAT.toi[].veh (réconciliation) ;
   - la soute est un conteneur serveur, clé « v<eid> » (CONTENEUR_OUVRIR { eid }) ;
   - le tout est sauvegardé dans etatMonde().vehicules (SPEC-SERVEUR-006). */
const V = MC.Vehicules;
function evtVehicule(c, j, evt, extra) {
  envoyer(c, Object.assign({ t: NP.MSG.VEHICULE_EVT, j, evt }, extra || {}));
}
function refusVehicule(c, j, motif) { evtVehicule(c, j, CA.EVT_VEHICULE.REFUS, { motif }); }
function vehiculeParEid(eid) {
  return entites.list.find(e => e.eid === eid && e.vehicule && !e.dead) || null;
}
// distance de l'œil d'un joueur au véhicule (bord de la caisse, pas son centre)
function distanceVehicule(st, e) {
  const d = V.defDe(e);
  return Math.hypot(e.pos.x - st.pos.x, e.pos.y + (d ? d.h / 2 : 0.5) - (st.pos.y + 1.62), e.pos.z - st.pos.z) - (d ? d.w / 2 : 0.5);
}
function poserVehiculeServeur(c, m) {
  const js = c.joueurs && c.joueurs[m.j];
  if (!js) return;
  const st = js.joueur.state;
  const def = V.DEFS[m.nom];
  if (st.dead) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.MORT);
  if (!def || Math.abs(m.nx) + Math.abs(m.ny) + Math.abs(m.nz) !== 1) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.INCONNU);
  const portee = Math.hypot(m.x + 0.5 - st.pos.x, m.y + 0.5 - (st.pos.y + 1.62), m.z + 0.5 - st.pos.z);
  if (portee > PORTEE_BLOC) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.PORTEE);
  if (!monde.getBlock(m.x, m.y, m.z)) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.INCONNU);   // rien là (ou chunk absent)
  let x = m.x + m.nx + 0.5, y = m.y + m.ny, z = m.z + m.nz + 0.5;
  // un peu de place : on remonte d'un cran si l'engin serait dans le décor
  for (let k = 0; k < 3 && MC.Physics.collides(monde, x, y, z, def.w, def.h); k++) y++;
  const poseur = c.nom + '#' + m.j;
  const posesLibres = entites.list.filter(e => e.vehicule && e.poseur === poseur && !e.conducteur).length;
  if (MC.Physics.collides(monde, x, y, z, def.w, def.h) || posesLibres >= VEHICULES_JOUEUR_MAX
      || entites.list.filter(e => e.vehicule).length >= VEHICULES_MAX) {
    return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.PLACE);
  }
  // en survie, l'objet est retiré de l'inventaire SERVEUR (case annoncée si elle convient, sinon la première qui convient)
  let paye = false;
  if (!regles.blocsIllimites && !POSE_LIBRE) {
    const inv = st.inv;
    const convient = (s) => s && C.def(s.id) && C.def(s.id).vehicule === m.nom;
    let i = m.i >= 0 && convient(inv.slots[m.i]) ? m.i : inv.slots.findIndex(convient);
    if (i < 0) { envoyerInvMaj(c, m.j, {}); return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.INVENTAIRE); }
    inv.consumeAt(i, 1);
    paye = true;
  }
  const e = V.poser(entites, m.nom, x, y, z, st.yaw);
  if (e) e.poseur = poseur;
  if (e && e.soute) vehiculesSoute.add(e);
  if (paye) envoyerInvMaj(c, m.j, {});
  MC.Admin.journaliser(admin, { auteur: c.nom, action: 'vehicule_pose', cible: `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`, details: m.nom, heure });
  evtVehicule(c, m.j, CA.EVT_VEHICULE.POSE, { nom: m.nom });
}
function monterVehiculeServeur(c, m) {
  const js = c.joueurs && c.joueurs[m.j];
  if (!js) return;
  const st = js.joueur.state;
  if (st.dead) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.MORT);
  if (st.monture) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.DEJA_A_BORD);
  const e = vehiculeParEid(m.eid);
  if (!e) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.INCONNU);
  if (distanceVehicule(st, e) > CA.BORNES.PORTEE_VEHICULE) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.PORTEE);
  if (e.conducteur && e.conducteur.monture !== e) e.conducteur = null;       // conducteur disparu sans libérer son siège
  if (!V.monter(st, e)) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.OCCUPE);
  js.vehInactif = 0;
  MC.Admin.journaliser(admin, { auteur: c.nom, action: 'vehicule_monte', cible: e.vehicule, details: e.eid, heure });
  evtVehicule(c, m.j, CA.EVT_VEHICULE.MONTE, { nom: e.vehicule });
  signalerSucces(js, { type: 'vehicule', vehicule: e.vehicule });     // « premier_vehicule » : SUCCES_DEBLOQUE au joueur j (écran partagé compris)
}
/* SPEC-TRANSPORT-002 / METIER-002 : la réparation d'un véhicule avarié se paie en émeraudes
   sur l'inventaire SERVEUR, chez un forgeron à portée — la même règle (MC.Habitats.servir)
   que l'outil en main, le véhicule conduit passant en premier. */
function reparerVehiculeServeur(c, m) {
  const js = c.joueurs && c.joueurs[m.j];
  if (!js) return;
  const st = js.joueur.state, mt = st.monture;
  if (st.dead || !mt || !mt.avarie) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.INCONNU);
  const forgeron = entites.list.find(e => e.eid === m.eid && !e.dead && e.role && MC.Habitats.ROLES[e.role] && MC.Habitats.ROLES[e.role].service === 'reparer');
  if (!forgeron) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.INCONNU);
  if (Math.hypot(forgeron.pos.x - st.pos.x, (forgeron.pos.y || 0) - st.pos.y, forgeron.pos.z - st.pos.z) > MC.ContratsV2.BORNES.PORTEE_CONTENEUR + 2) {
    return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.PORTEE);
  }
  const r = MC.Habitats.servir('reparer', { inv: st.inv, etat: st, vehicule: mt, temps: heure });
  envoyerInvMaj(c, m.j, {});
  if (!r.ok) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.INVENTAIRE);
  evtVehicule(c, m.j, CA.EVT_VEHICULE.REPARE, { nom: mt.vehicule });
}
function descendreVehiculeServeur(c, j, js) {
  const pc = MC.PlayerConst;
  V.descendre(js.joueur.state, monde, pc.PW, pc.PH);
  evtVehicule(c, j, CA.EVT_VEHICULE.DESCEND);
}
/* Une fois par tic et par joueur, après ses entrées : engin détruit (on est à
   pied), joueur mort (il descend), client muet (l'engin n'est plus commandé :
   il ralentit et retombe comme un véhicule abandonné, VEHIC-009). */
function entretenirMonture(js, dt, avance) {
  const st = js.joueur.state, mt = st.monture;
  if (!mt) { js.vehInactif = 0; return; }
  if (mt.dead) { mt.conducteur = null; st.monture = null; return; }
  if (st.dead) { const pc = MC.PlayerConst; V.descendre(st, monde, pc.PW, pc.PH); return; }
  if (avance > 0) { js.vehInactif = 0; return; }
  js.vehInactif = (js.vehInactif || 0) + dt;
  if (js.vehInactif > 0.5) { V.conduire(mt, dt, monde, null); V.caler(st); }
}
/* La soute d'un véhicule (clé « v<eid> ») s'il existe et si `st` en est assez proche. */
function souteDeVehicule(cle, st) {
  if (typeof cle !== 'string' || !/^v[1-9][0-9]{0,8}$/.test(cle)) return null;
  const e = vehiculeParEid(+cle.slice(1));
  if (!e || !e.soute) return null;
  if (st && distanceVehicule(st, e) > MC.ContratsV2.BORNES.PORTEE_CONTENEUR) return null;
  return e.soute;
}
// un véhicule détruit rend sa soute au sol et ferme l'écran de ceux qui l'avaient ouverte
function liberSoutesDetruites() {
  vehiculesSoute.forEach(e => {
    if (!e.dead) return;
    vehiculesSoute.delete(e);
    fermerConteneurPourAbonnes('v' + e.eid);
    e.soute.slots.forEach((s, i) => {
      if (s) entites.dropItem(e.pos.x, e.pos.y + 0.5, e.pos.z, s.id, s.n, null, s.data);
      e.soute.slots[i] = null;
    });
  });
}
function tousLesJoueurs() {
  const l = [];
  clients.forEach(c => { if (c.rejoint && c.joueurs) c.joueurs.forEach((js, j) => l.push({ c, j, js })); });
  return l;
}
/* Message système adressé à UN client (le chat serveur, lui, est diffusé). */
function messageSystemeA(c, texte) {
  envoyer(c, { t: NP.MSG.CHAT, auteur: null, texte, type: 'systeme', ts: Date.now() });
}
/* SPEC-ARCHI-025 : les joueurs couchés (objets `js`, propres à une connexion et
   un joueur local) avec l'endroit et la vie de leur coucher. Le vote de sommeil
   est tenu PAR LE SERVEUR, sans dépendre du client : un dormeur qui bouge, est
   touché, meurt ou se déconnecte sort du compte tout seul. La nuit passe dès
   qu'une MAJORITÉ STRICTE des joueurs présents et vivants dort (au moins un) —
   un seul éveillé ne bloque donc pas cent joueurs. */
const dormeurs = new Map();          // js -> { x, y, z, pv }
const SOMMEIL_DEPLACEMENT_MAX = 1.5; // blocs : au-delà, il s'est levé
function compterDormeurs() {
  let total = 0, dorment = 0;
  const presents = new Set();
  tousLesJoueurs().forEach(({ js }) => {
    presents.add(js);
    const st = js.joueur.state;
    if (st.dead) { dormeurs.delete(js); return; }
    total++;
    const d = dormeurs.get(js);
    if (!d) return;
    if (Math.hypot(st.pos.x - d.x, st.pos.z - d.z) > SOMMEIL_DEPLACEMENT_MAX || Math.abs(st.pos.y - d.y) > SOMMEIL_DEPLACEMENT_MAX || st.hp < d.pv) {
      dormeurs.delete(js);                    // il s'est levé, ou il a été touché
      return;
    }
    dorment++;
  });
  dormeurs.forEach((d, js) => { if (!presents.has(js)) dormeurs.delete(js); });
  return { dorment, total };
}
function coucher(js) {
  const st = js.joueur.state;
  fixerReapparitionLit(js);          // SPEC-ARCHI-026 : se coucher fixe aussi la réapparition, sur le lit à portée
  dormeurs.set(js, { x: st.pos.x, y: st.pos.y, z: st.pos.z, pv: st.hp });
}
/* Fait passer la nuit quand une majorité stricte des joueurs présents dort.
   Renvoie vrai si la nuit vient de passer. Appelée à chaque DORMIR et une fois
   par seconde (un éveillé peut être parti, un dormeur s'être levé). */
function verifierSommeil() {
  if (!dormeurs.size) return false;
  if (!MC.DayCycle.isNight(heure)) { dormeurs.clear(); return false; }
  const { dorment, total } = compterDormeurs();
  if (total === 0 || dorment * 2 <= total) return false;
  dormeurs.clear();
  heure = MC.DayCycle.avancerJourApresDormir(heure);
  const m = chat.systeme('Le jour se lève.');
  if (m) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
  journal(`nuit passée : la majorité des joueurs dormait (heure ${heure.toFixed(1)})`);
  return true;
}
// SPEC-SERVEUR-010 : nombre de JOUEURS déjà admis (écran partagé compris),
// pas de connexions — testé en conditions réelles (tests/integration-
// capacite.js) : `server.js` a des effets de bord au chargement (écoute
// immédiate), donc jamais `require()` directement, comme le reste de la
// suite (toujours un vrai processus lancé via `spawn`, jamais isolé).
function placesOccupees() {
  let n = 0;
  clients.forEach(c => { if (c.rejoint) n += c.locaux || 1; });
  return n;
}

/* SPEC-COMBAT-002 : le PvP n'est permis que si le serveur l'autorise
   (--pvp, désactivé par défaut) ET si la zone des DEUX joueurs le permet
   (SPEC-ZONE-001) — un joueur réfugié en zone sûre reste protégé même si
   son agresseur, lui, se tient en zone PvP. */
function pvpAutorise(posA, posB) {
  return !!CONF.pvp && (!MC.Zones || MC.Zones.pvpAutorise(monde.zones, monde.zonesEtat, posA, posB, politique));
}
// un identifiant stable pour désigner un joueur cible dans un message ATTAQUE
function cleJoueur(id, j) { return id + '/' + (j || 0); }
function joueurParCle(cle) {
  const p = String(cle).split('/');
  const id = +p[0], j = +p[1] || 0;
  return tousLesJoueurs().find(x => x.c.id === id && x.j === j) || null;
}

// ── PvP : enjeux et sanctions (B4, SPEC-PVP-001 à 006) ──────────────────────
/* État `pvp` (MC.PvpEnjeux) déclaré plus haut, avec `politique`/`guildes`
   (même raison : lu par `etatMonde`/`appliquerEtatMonde` dès la reprise
   `--monde`, avant ce point du fichier). Cette section rassemble les
   helpers, tous des déclarations de fonction (hissées), donc utilisables
   depuis `traiter()` bien plus haut dans le fichier — même patron que
   `ctxJoueur`/`resoudreConteneur` pour B1. */

// retrouve le tuple {c, j, js} du joueur local dont le state est EXACTEMENT
// `state` (identité d'objet — comme `joueurs.find` sur `ev.picked`/`degatsPar`
// déjà utilisé plus bas pour le ramassage et les dégâts de créature).
function joueurParEtat(state) {
  return tousLesJoueurs().find(x => x.js.joueur.state === state) || null;
}
// retrouve un joueur CONNECTÉ par son nom de connexion (insensible à la casse
// et aux espaces, comme `canon`) — utilisé par /duel, qui désigne sa cible
// par son nom plutôt que par la clé « id/j » de ATTAQUE (piège B4.md § 13 :
// deux joueurs locaux d'un même poste partagent ce nom, jamais deux « vrais »
// adversaires).
function joueurParNom(nom) {
  const cnom = MC.Admin.canon(nom);
  return tousLesJoueurs().find(x => MC.Admin.canon(x.c.nom) === cnom) || null;
}
/* Fournie à `entites.update` comme `opts.peutBlesser` (SPEC-PVP-002/005) :
   un duel consenti en cours autorise le coup MÊME hors zone PvP/sans --pvp ;
   sinon, PvP autorisé par la zone/le réglage ET aucune faction commune —
   exactement la même règle que `case ATTAQUE` pour le corps à corps. Prend
   des STATES (comme `stepArrow`/`degatsPar` les manipulent), retrouve les
   noms au besoin — jamais l'inverse (`peutBlesser` de guildes.js prend des
   NOMS, piège documenté par B4.md § 13). */
function peutBlesserJoueurs(stA, stB) {
  const a = joueurParEtat(stA), b = joueurParEtat(stB);
  if (!a || !b) return false;
  const duel = MC.PvpEnjeux.duelActif(pvp, a.c.nom, b.c.nom, heure, stA.pos, stB.pos);
  return duel || (pvpAutorise(stA.pos, stB.pos) && MC.Guildes.peutBlesser(guildes, a.c.nom, b.c.nom));
}
function envoyerSysteme(c, texte) {
  envoyer(c, { t: NP.MSG.CHAT, auteur: null, texte, type: 'systeme' });
}
/* Issue commune d'une mort PvP (corps à corps ou flèche) : butin, meurtre,
   réputation, hors-la-loi — jamais en duel (SPEC-PVP-001/003/005) — et, DANS
   TOUS LES CAS, la victoire et son message (SPEC-PVP-004). `vainqueur`/
   `vaincu` : { c, j, js }. */
function issuePvp(vainqueur, vaincu, duel) {
  const nomV = vainqueur.c.nom, nomP = vaincu.c.nom;
  let perte;
  if (!duel) {
    const invPerdant = etatJoueurServeur(vaincu.js).inv, invGagnant = etatJoueurServeur(vainqueur.js).inv;
    const r = MC.PvpEnjeux.resoudreButin(invPerdant, invGagnant, nomV + '|' + nomP + '|' + heure.toFixed(3));
    perte = r.perte;
    // le reliquat que le vainqueur ne peut pas porter tombe À SES PIEDS (il
    // vient de le gagner : c'est lui qui a la priorité dessus, pas le vaincu).
    r.reste.forEach(p => lacherAuxPieds(vainqueur.js, p));
    const posVaincu = vaincu.js.joueur.state.pos;
    const factions = MC.PvpEnjeux.factionsProches(politique, posVaincu.x, posVaincu.z);
    const res = MC.PvpEnjeux.enregistrerMeurtre(pvp, nomV, nomP, heure, factions);
    if (res.penalites.length) envoyer(vainqueur.c, { t: NP.MSG.PVP, evt: 'reputation', factions: res.penalites });
    if (res.horsLaLoi.length) {
      envoyer(vainqueur.c, { t: NP.MSG.PVP, evt: 'hors_la_loi',
        factions: res.penalites.filter(p => res.horsLaLoi.indexOf(p.id) >= 0) });
    }
  }
  const n = MC.PvpEnjeux.enregistrerVictoire(pvp, nomV);
  envoyer(vainqueur.c, { t: NP.MSG.PVP, evt: 'victoire', contre: nomP, n });
  // SPEC-ARCHI-042 : un duel consenti n'a aucun enjeu (ni butin ni meurtre) : il ne rapporte aucun succès,
  // sinon deux comptes se « battraient » en duel pour farmer « Champion »
  if (!duel) signalerSucces(vainqueur.js, { type: 'pvp_victoire', n });
  const msgDefaite = { t: NP.MSG.PVP, evt: 'defaite', de: nomV };
  if (perte) msgDefaite.perte = perte;
  envoyer(vaincu.c, msgDefaite);
  envoyerInvMaj(vainqueur.c, vainqueur.j, {});
  envoyerInvMaj(vaincu.c, vaincu.j, {});
  MC.Admin.journaliser(admin, { auteur: nomV, action: 'pvp_victoire', cible: nomP, details: duel ? 'duel' : 'meurtre', heure });
}
/* /duel <nom> | /duel accepter | /duel refuser (case CHAT, avant /faction).
   Jamais diffusé au chat général : une réponse système au seul intéressé (et
   à l'adversaire, quand il y en a un joignable). */
/* SPEC-QUETE-004 : /quete lister | accepter <id> | remettre <id>. Les
   propositions viennent de MC.Politique.quetesActives(politique) (quêtes de
   faction, y compris de reconstruction/secours ajoutées côté lieu — voir
   habitats.js:queteCatastrophe pour SPEC-QUETE-003, proposées de la même
   façon par leur `id`) ; le tableau PAR JOUEUR (`quetesJoueurs`) est ce que
   le serveur arbitre : accepterQuete/remettreQuete (politique.js) décident
   seuls, jamais un client. */
// SPEC-QUETE-001/QUETE-005 : ressource abstraite de faction -> objet réel
// livré par le joueur (le même vocabulaire que politique.js:ressourceCiblePourLivraison).
// jamais I.EMERALD lui-même pour 'or' : MC.Economie.prixCourant traite une
// offre dont give[0].id === EMERALD comme un ACHAT (estAchat), qui lirait
// alors offre.get (toujours null ici) — le lingot d'or est la vraie
// ressource physique derrière la trésorerie d'une faction (banquier,
// habitats.js), l'émeraude n'étant que sa monnaie d'échange.
const RESSOURCE_ITEM_QUETE = { or: C.I.GOLD_INGOT, nourriture: C.I.WHEAT };
const MONTANT_LIVRAISON_QUETE = 10;
const RAYON_RECONSTRUCTION_QUETE = 48;
function quetesDisponibles() {
  return MC.Politique.quetesActives(politique).concat(quetesCatastrophe.filter(q => MC.Habitats.queteActive(q, heure)));
}
/* SPEC-QUETE-002/003/004/005 : vérifie RÉELLEMENT l'objectif avant de rendre
   la quête remise — jamais une simple formalité. Renvoie { ok, motif?,
   recompense? } ; en cas de succès, applique aussi l'effet réel sur l'état
   du monde (livraison à la faction, élimination de la cible, rien de plus à
   appliquer pour une reconstruction constatée sur place) et calcule la
   récompense réelle (QUETE-005) à partir de CE succès, jamais avant. */
function verifierEtAppliquerObjectif(js, quete) {
  if (quete.type === 'livrer') {
    const objetId = RESSOURCE_ITEM_QUETE[quete.ressource];
    if (objetId == null) return { ok: false, motif: 'objectif_non_verifiable' };
    const inv = js.joueur.state.inv;
    if (!inv || inv.count(objetId) < MONTANT_LIVRAISON_QUETE) {
      return { ok: false, motif: 'ressource_manquante', requis: MONTANT_LIVRAISON_QUETE };
    }
    inv.remove(objetId, MONTANT_LIVRAISON_QUETE);
    MC.Politique.livrerQuete(politique, quete.faction, quete.ressource, MONTANT_LIVRAISON_QUETE);
    const recompense = MC.Politique.recompenseReelle(politique, quete,
      { economie, objetId, montant: MONTANT_LIVRAISON_QUETE, lieuId: quete.faction });
    return { ok: true, recompense };
  }
  if (quete.type === 'eliminer') {
    // reussirQueteElimination revalide elle-même que la cible promise est
    // toujours une faction connue et toujours en guerre/rivalité — un
    // conflit apaisé entre-temps refuse la remise (motif null -> refus ici).
    const cibleId = MC.Politique.reussirQueteElimination(politique, quete.faction, quete.cible);
    if (!cibleId) return { ok: false, motif: 'objectif_non_atteint' };
    const recompense = MC.Politique.recompenseReelle(politique, quete, { economie });
    return { ok: true, recompense };
  }
  // 'reconstruction'/'secours' : vérifiées à part dans traiterQuete (position
  // du joueur par rapport au lieu sinistré, pas un objectif d'inventaire).
  return { ok: false, motif: 'objectif_non_verifiable' };
}
function traiterQuete(c, texte) {
  const args = texte.trim().split(/\s+/).slice(1);
  const sous = (args[0] || '').toLowerCase();
  if (sous === 'lister' || !sous) {
    const dispo = quetesDisponibles();
    const mien = MC.Politique.quetesActivesDeJoueur(quetesJoueurs, c.nom);
    if (!dispo.length && !mien.length) { envoyerSysteme(c, 'Aucune quête pour le moment.'); return; }
    dispo.forEach(q => envoyerSysteme(c, 'Proposée : [' + q.id + '] ' + q.titre + ' (récompense estimée ' + q.recompense + ')'));
    mien.forEach(q => envoyerSysteme(c, 'En cours : [' + q.id + '] ' + q.titre + ' — ' + q.statut));
    return;
  }
  if (sous === 'accepter') {
    const id = args[1];
    const quete = quetesDisponibles().find(q => q.id === id);
    if (!quete) { envoyerSysteme(c, 'Quête introuvable : ' + id); return; }
    const r = MC.Politique.accepterQuete(quetesJoueurs, c.nom, quete);
    envoyerSysteme(c, r.ok ? 'Quête acceptée : ' + quete.titre : 'Quête déjà acceptée.');
    MC.Admin.journaliser(admin, { auteur: c.nom, action: 'quete_accepter', cible: id, details: r.ok, heure });
    return;
  }
  if (sous === 'remettre') {
    const id = args[1];
    const quete = MC.Politique.quetesActivesDeJoueur(quetesJoueurs, c.nom).find(q => q.id === id && q.statut === 'active');
    if (!quete) { envoyerSysteme(c, 'Rien à remettre pour cette quête (déjà remise, ou jamais acceptée).'); return; }
    const moi = joueurParNom(c.nom);
    if (!moi) { envoyerSysteme(c, 'Rien à remettre pour cette quête (déjà remise, ou jamais acceptée).'); return; }
    // SPEC-QUETE-002/003/004 : l'objectif RÉEL est vérifié ici, avant toute
    // remise — une remise prématurée (rien livré, cible pas éliminée, hors
    // de portée du lieu sinistré) est refusée, sans marquer la quête remise
    // (elle reste 'active' : le joueur peut réessayer une fois l'objectif atteint).
    let resultat;
    if (quete.type === 'reconstruction' || quete.type === 'secours') {
      const st = moi.js.joueur.state;
      const d = (quete.x !== undefined && quete.z !== undefined) ? Math.hypot(st.pos.x - quete.x, st.pos.z - quete.z) : Infinity;
      if (d > RAYON_RECONSTRUCTION_QUETE) {
        resultat = { ok: false, motif: 'trop_loin_du_lieu' };
      } else {
        resultat = { ok: true, recompense: MC.Politique.recompenseReelle(politique, quete, {}) };
      }
    } else {
      resultat = verifierEtAppliquerObjectif(moi.js, quete);
    }
    if (!resultat.ok) {
      envoyerSysteme(c, 'Objectif non atteint : ' + quete.titre + ' (' + resultat.motif + ').');
      MC.Admin.journaliser(admin, { auteur: c.nom, action: 'quete_remettre_refusee', cible: id, details: resultat.motif, heure });
      return;
    }
    const r = MC.Politique.remettreQuete(quetesJoueurs, c.nom, id, resultat.recompense);
    if (!r.ok) { envoyerSysteme(c, 'Rien à remettre pour cette quête (déjà remise, ou jamais acceptée).'); return; }
    // SPEC-QUETE-004/005 : la récompense est réellement créditée à
    // l'inventaire serveur du joueur — jamais seulement annoncée en chat.
    if (r.quete.recompenseVersee > 0) {
      moi.js.joueur.state.inv.add(C.I.EMERALD, Math.round(r.quete.recompenseVersee));
      envoyerInvMaj(moi.c, moi.j, {});
    }
    envoyerSysteme(c, 'Quête remise : ' + r.quete.titre + ' — récompense ' + r.quete.recompenseVersee + ' émeraude(s).');
    MC.Admin.journaliser(admin, { auteur: c.nom, action: 'quete_remettre', cible: id, details: r.quete.recompenseVersee, heure });
    return;
  }
  envoyerSysteme(c, 'Usage : /quete lister | accepter <id> | remettre <id>');
}
function traiterDuel(c, texte) {
  const args = texte.trim().split(/\s+/).slice(1);
  const sous = (args[0] || '').toLowerCase();
  if (sous === 'accepter' || sous === 'refuser') {
    const prop = pvp.propositions.get(MC.Admin.canon(c.nom));
    const proposeur = prop ? joueurParNom(prop.de) : null;
    const moi = joueurParNom(c.nom);
    if (!moi) return;
    const posProposeur = proposeur ? proposeur.js.joueur.state.pos : moi.js.joueur.state.pos;
    const r = MC.PvpEnjeux.repondreDuel(pvp, c.nom, sous === 'accepter', heure, posProposeur, moi.js.joueur.state.pos);
    if (!r.ok) { envoyerSysteme(c, 'Duel : aucune proposition à laquelle répondre (ou trop tard).'); return; }
    if (r.refuse) {
      envoyerSysteme(c, 'Duel refusé.');
      if (proposeur) envoyerSysteme(proposeur.c, c.nom + ' refuse le duel.');
      return;
    }
    envoyerSysteme(c, 'Duel commencé avec ' + r.de + ' — ' + MC.PvpEnjeux.DUREE_DUEL + ' s, restez à moins de ' +
                   MC.PvpEnjeux.RAYON_DUEL + ' blocs l\'un de l\'autre.');
    envoyer(c, { t: NP.MSG.PVP, evt: 'duel_debut', contre: r.de });
    if (proposeur) {
      envoyerSysteme(proposeur.c, c.nom + ' accepte le duel !');
      envoyer(proposeur.c, { t: NP.MSG.PVP, evt: 'duel_debut', contre: c.nom });
    }
    return;
  }
  const cibleNom = args[0];
  if (!cibleNom) { envoyerSysteme(c, 'Usage : /duel <nom> | /duel accepter | /duel refuser'); return; }
  // SPEC-ARCHI-028 : seul sur le serveur (solo fermé), il n'y a personne à défier
  if (!tousLesJoueurs().some(x => x.c.id !== c.id)) { envoyerSysteme(c, 'Duel : aucun autre joueur à défier sur ce serveur.'); return; }
  const adversaire = joueurParNom(cibleNom);
  if (!adversaire || adversaire.c.id === c.id) { envoyerSysteme(c, 'Joueur introuvable : ' + cibleNom); return; }
  const r = MC.PvpEnjeux.proposerDuel(pvp, c.nom, cibleNom, heure);
  if (!r.ok) { envoyerSysteme(c, 'Duel : impossible de se dueller soi-même.'); return; }
  envoyerSysteme(c, 'Duel proposé à ' + adversaire.c.nom + ' — ' + MC.PvpEnjeux.DELAI_PROPOSITION + ' s pour répondre.');
  envoyer(adversaire.c, { t: NP.MSG.PVP, evt: 'duel_propose', de: c.nom, jusque: heure + MC.PvpEnjeux.DELAI_PROPOSITION });
}

// ── instrumentation de performance (SPEC-SERVEUR-002) ───────────────────────
/* Coût quasi nul quand désactivée (une lecture d'env au démarrage, un `if`
   par tic) : le banc de charge l'active via MC_MESURES=1, une exploitation
   normale ne le fait jamais. Les échantillons vivent en mémoire seulement —
   10 s d'historique à 60 Hz suffisent pour une moyenne et un 95e centile
   représentatifs sans faire grossir le processus. */
const MESURES_ACTIVES = process.env.MC_MESURES === '1';
const MESURES_MAX_ECH = 600;
const mesuresTicks = [];
function enregistrerTic(ms) {
  mesuresTicks.push(ms);
  if (mesuresTicks.length > MESURES_MAX_ECH) mesuresTicks.shift();
}
function statsMesures() {
  if (!MESURES_ACTIVES) return { actif: false };
  if (!mesuresTicks.length) return { actif: true, echantillons: 0 };
  const tri = mesuresTicks.slice().sort((a, b) => a - b);
  const somme = tri.reduce((a, b) => a + b, 0);
  const idxP95 = Math.min(tri.length - 1, Math.floor(tri.length * 0.95));
  const mem = process.memoryUsage();
  return {
    actif: true,
    echantillons: tri.length,
    tickMoyenMs: +(somme / tri.length).toFixed(3),
    tickP95Ms: +tri[idxP95].toFixed(3),
    memoireRssMo: +(mem.rss / 1048576).toFixed(2),
    memoireHeapMo: +(mem.heapUsed / 1048576).toFixed(2),
    joueurs: [...clients.values()].filter(c => c.rejoint).length,
  };
}

// ── boucle de simulation ─────────────────────────────────────────────────────
const { performance } = require('perf_hooks');
let dernier = performance.now();
let accEtat = 0;
let accSpawn = 0, rotationSpawn = 0, accDonjons = 0;
const SPAWN_JOUEURS_PAR_TIC = 8;
let accChunks = 1;         // premier passage immédiat

// SPEC-DONJON-017 : « pillé depuis » observé à la première détection d'un
// coffre marqué dans monde.coffresPilles (posé par la section conteneurs,
// jamais modifiée ici) — pas l'instant exact du pillage, mais borné à la
// cadence d'entretien du monde (~1 s, voir accChunks ci-dessus), négligeable
// devant le long délai de régénération (plusieurs jours simulés).
const coffresPilleDepuis = new Map();
/* SPEC-DONJON-017 : un coffre de donjon pillé (marqué dans
   monde.coffresPilles par remplirConteneurNeuf, section conteneurs — jamais
   touchée ici) regarnit son contenu après un long délai. Toute la logique
   (dater le pillage à sa première détection, décider du délai, désabonner
   les joueurs qui l'avaient ouvert — même précaution que la casse d'un
   conteneur, revue adversariale item 3, ~l. 1344-1367 — puis l'effacer de
   `conteneursPoses`) vit dans MC.Donjons.regenererCoffres, PURE et testée
   sous Node avec de fausses collections (tests/spec-donjons.js) : ici, on ne
   fait que lui passer les VRAIES. À la prochaine ouverture, le coffre
   effacé de `conteneursPoses` est retrouvé absent par
   `ouvrirConteneurPourJoueur` (section conteneurs), qui en recrée un neuf
   que `remplirConteneurNeuf` regarnit — exactement le chemin qu'un coffre
   jamais ouvert emprunte déjà, sans qu'il faille dupliquer cette logique
   ici. */
function regenererCoffresDonjon() {
  if (!monde.donjons || !monde.coffresPilles) return;
  const dureeJour = parseInt(process.env.MC_DONJON_JOUR_S, 10) || (MC.DayCycle ? MC.DayCycle.DAY_LENGTH : 1200);
  monde.donjons.regenererCoffres(monde.coffresPilles, coffresPilleDepuis, conteneursPoses, heure, dureeJour, fermerConteneurPourAbonnes);
}

function joueurReference() {
  for (const c of clients.values()) if (c.rejoint) return { pos: c.pos };
  return { pos: SPAWN };
}

/* Sous Windows, un minuteur de 16,7 ms est souvent arrondi à 31 ms : la
   simulation tombait à 30-40 Hz. On sonde donc plus souvent (au rythme réel
   de l horloge système) et l on ne fait un pas que lorsque sa période est
   écoulée — la cadence visée est tenue, sans boucle active qui brûlerait le CPU. */
const PERIODE_TICK = 1000 / CONF.tickHz;
setInterval(() => {
  const now = performance.now();
  /* SPEC-ARCHI-010/011 : en pause RIEN n'avance (heure, monde, créatures,
     cumulateurs, politique, économie, fourneaux, expirations…) et `dernier`
     est rebasé à chaque passage : à la reprise, le premier dt ne contient pas
     la pause, aucun rattrapage. */
  if (enPause) { dernier = now; return; }
  if (now - dernier < PERIODE_TICK * 0.9) return;
  const dt = Math.min((now - dernier) / 1000, 0.25);
  dernier = now;
  const __t0 = MESURES_ACTIVES ? performance.now() : 0;

  heure += dt;
  if (clients.size > 0) dureeJeu += dt;
  /* Eau et circuits : diffusés explicitement plus bas (leurs changements
     seraient sinon perdus), donc désactivés ici. Cultures et feu, eux,
     avancent dans le tic et chaque bloc changé est diffusé (SPEC-SYNC-018/019,
     SPEC-ARCHI-034) : les clients n'en simulent plus rien. */
  monde.tick(dt, 14, null, { temps: heure, circuits: false, eau: false,
    surBloc: noterBlocMonde });
  diffuserBlocsMonde();

  // SPEC-SERVEUR-005 : purge périodique de admin.sessions/invitations/sanctions
  accPurge += dt;
  if (accPurge >= PURGE_ADMIN_S) {
    accPurge = 0;
    MC.Admin.purger(admin, heure, PURGE_ADMIN_OPTS);
  }

  /* Le serveur simule les créatures autour des joueurs : il lui faut donc le
     terrain autour d'eux. Sans cela, une créature hors des chunks du point
     d'apparition n'avait pas de sol — gelée désormais, elle tombait jadis
     dans le vide — et aucune apparition n'y trouvait de terrain valide. */
  accChunks += dt;
  if (accChunks >= 1) {
    accChunks = 0;
    const centres = [[Math.floor(SPAWN.x / 16), Math.floor(SPAWN.z / 16)]];
    clients.forEach(c => {
      if (c.rejoint) centres.push([Math.floor(c.pos.x / 16), Math.floor(c.pos.z / 16)]);
    });
    monde.chunksVoulus(centres, 3).forEach(v => monde.getChunk(v[1], v[2], true));
    monde.unloadLoin(centres, 5);
    peuplerLieux();
    avancerPolitique();
    avancerEconomie();
    avancerCaravanes();
    avancerCatastrophes();
    verifierSommeil();
    // B4 : propositions de duel caduques (silencieuses) et duels terminés
    // (SPEC-PVP-005) — les deux participants en sont avertis, s'ils sont
    // encore connectés.
    MC.PvpEnjeux.expirer(pvp, heure).forEach(({ a, b }) => {
      const ja = joueurParNom(a), jb = joueurParNom(b);
      if (ja) envoyer(ja.c, { t: NP.MSG.PVP, evt: 'duel_fin', contre: b });
      if (jb) envoyer(jb.c, { t: NP.MSG.PVP, evt: 'duel_fin', contre: a });
    });
    regenererCoffresDonjon();
  }
  // l'eau coule : le serveur, qui fait foi sur les blocs, diffuse chaque changement
  accEau += dt;
  if (accEau >= 0.25) {
    accEau = 0;
    monde.coulerEau(96).forEach(ch => diffuser({ t: NP.MSG.BLOC, x: ch[0], y: ch[1], z: ch[2], id: ch[3] }));
  }
  // L29 mécanismes (SPEC-MECA-008) : le serveur fait foi, et diffuse chaque
  // changement — un bloc dont seul l'état a changé (une lampe, un compteur…)
  // garde son id, le client applique l'état comme pour tout bloc posé.
  accCircuits += dt;
  if (accCircuits >= 0.2) {
    accCircuits = 0;
    monde.tickCircuits({
      temps: heure,
      // SPEC-MECA-001 : éjecte le premier objet du distributeur — munition
      // (ammo) en projectile, sinon un objet au sol ; les entités (item ou
      // arrow) rejoignent tout seules la diffusion d'état périodique (ETAT),
      // pas besoin de message dédié.
      onDistribuer: (x, y, z) => {
        const kd = MC.ContratsV2.cleConteneur(x, y, z);
        const cont = conteneursPoses.get(kd);
        if (!cont) return;
        const i = MC.Circuits.distributeurChoix(cont.slots);
        if (i < 0) return;
        const st = cont.slots[i];
        const idef = C.ITEMS[st.id];
        st.n -= 1;
        if (st.n <= 0) cont.slots[i] = null;
        cont.rev = (cont.rev || 0) + 1;
        if (idef && idef.ammo) {
          entites.tirer({ x: x + 0.5, y: y + 1, z: z + 0.5 }, { x: 0, y: 1, z: 0 },
                         14, idef.damage || 5, null, idef.ammoType || 'fleche');
        } else {
          entites.dropItem(x + 0.5, y + 1, z + 0.5, st.id, 1);
        }
        // SPEC-SYNC-015 : un joueur qui a ce distributeur ouvert voit l'éjection
        const abonnesD = abonnesActuels(kd);
        if (abonnesD.length) {
          const deltaD = { cle: kd, rev: cont.rev, maj: [[i, MC.ContratsV2.pileVersCase(cont.slots[i])]] };
          abonnesD.forEach(({ c: c2, j: j2 }) => envoyer(c2, Object.assign({ t: NP.MSG.CONTENEUR_MAJ }, deltaD)));
        }
      },
      // SPEC-MECA-007 : rejoue la commande stockée avec le même routage que
      // /faction plus haut — messages système, pas de diffusion large.
      onCommande: (x, y, z) => executerBlocCommandeServeur(x, y, z),
    }).forEach(ch => diffuser({
      t: NP.MSG.BLOC, x: ch.x, y: ch.y, z: ch.z,
      id: ch.setBlock !== undefined ? ch.setBlock : monde.getBlock(ch.x, ch.y, ch.z),
      etat: ch.setEtat !== undefined ? ch.setEtat : (monde.getEtat(ch.x, ch.y, ch.z) || 0),
    }));
  }

  /* B1 (étape 7) : les fourneaux posés cuisent à CHAQUE tic (SPEC-SYNC-016 —
     ils n'attendent pas qu'un joueur regarde), mais un CONTENEUR_MAJ n'est
     émis qu'à un rythme limité (≤ 2 Hz) et SEULEMENT s'il existe un abonné
     (SPEC-SYNC-015) — le delta compare l'instantané envoyé la dernière fois
     à l'état courant, donc reste correct même après une longue absence. */
  conteneursPoses.forEach(cont => { if (cont.four) MC.Conteneurs.tickFour(cont, dt); });
  accFourMsg += dt;
  if (accFourMsg >= 0.5) {
    accFourMsg = 0;
    conteneursPoses.forEach((cont, cle) => {
      if (!cont.four) return;
      const av = derniereEmissionFour.get(cle);
      derniereEmissionFour.set(cle, MC.Conteneurs.instantane(cont));
      if (!av) return;
      const abonnesF = abonnesActuels(cle);
      if (!abonnesF.length) return;
      const maj = MC.Conteneurs.diff(av.slots, cont.slots);
      if (!maj.length && av.four.burn === cont.four.burn && av.four.cook === cont.four.cook) return;
      const deltaF = { cle, rev: cont.rev, maj, four: { burn: cont.four.burn, cook: cont.four.cook } };
      abonnesF.forEach(({ c: c2, j: j2 }) => envoyer(c2, Object.assign({ t: NP.MSG.CONTENEUR_MAJ }, deltaF)));
    });
  }

  /* Chaque joueur avance selon SES entrées, dans la limite du temps écoulé :
     c'est le serveur qui décide de la position et des statistiques. */
  const joueurs = tousLesJoueurs();
  joueurs.forEach(({ js }) => {
    js.budget.crediter(dt);
    js.attaqueCd = Math.max(0, js.attaqueCd - dt);
    js.tirCd = Math.max(0, js.tirCd - dt);
    const st = js.joueur.state;
    let avance = 0;
    while (js.entrees.length && !st.dead && js.budget.consommer(js.entrees[0].dt)) {
      const e = js.entrees.shift();
      SY.rejouer(js.joueur, [e]);
      js.dernier = e.s;
      avance += e.dt;
    }
    entretenirMonture(js, dt, avance);                    // P-VEH : engin détruit, mort, client muet
    /* SPEC-ARCHI-026 : le corps vit au temps SERVEUR (dt réel, gelé en pause
       avec toute la boucle), jamais au rythme des entrées reçues : un client
       muet a faim et se soigne comme les autres. Un seul appel par tic. */
    js.joueur.updateSurvival(dt);
    tickerSuccesJoueur(js, dt);
    /* Les créatures repoussent le joueur (elles ne se traversent pas), UNE fois par tic
       et par joueur (coût borné à 100 joueurs) ; côté serveur seulement — la prédiction
       du client ne la connaît pas, la réconciliation absorbe l'écart. */
    if (avance > 0 && !st.dead && !st.monture) entites.separer(st, avance);
    // des entrées trop longues ou trop nombreuses pour le temps écoulé : écartées
    while (js.entrees.length && js.entrees[0].dt > SY.DT_MAX) js.entrees.shift();
    /* Le climat agit sur le corps : c'est au serveur, qui fait foi sur la
       vie et la faim, d'appliquer froid et chaleur. Température réévaluée
       deux fois par seconde, comme chez le client. */
    if (monde.meteo && !st.dead) {
      js.tempT = (js.tempT || 0) - dt;
      if (js.tempT <= 0 || !js.temperature) {
        js.tempT = 0.5;
        js.temperature = monde.meteo.temperatureEn(monde, st.pos, heure);
      }
      js.joueur.subirClimat(dt, js.temperature.temperature);
    }
  });

  /* La foudre : mêmes éclairs, aux mêmes instants et aux mêmes lieux que
     chez les clients (la météo est une fonction de la graine et de l'heure) ;
     le serveur seul en tire les dégâts. */
  if (monde.meteo && joueurs.length) {
    if (meteoT === null || heure < meteoT || heure - meteoT > 5) meteoT = heure;
    const l = monde.meteo.eclairs(meteoT, heure);
    meteoT = heure;
    l.forEach(e => {
      joueurs.forEach(({ c, j, js }) => {
        const st = js.joueur.state;
        const lieu = monde.meteo.lieuEclair(e, st.pos.x, st.pos.z);
        if (!st.dead && monde.meteo.foudroie(lieu, st.pos, abriServeur)) {
          js.joueur.hurt(monde.meteo.DEGATS_FOUDRE);
          // SPEC-ARCHI-042 : le cri et l'annonce sont décidés ici ; « Rescapé » seulement si l'on survit
          envoyer(c, { t: NP.MSG.FOUDROYE, j });
          if (!st.dead) signalerSucces(js, { type: 'foudre' });
        }
        entites.list.forEach(en => {
          if (en.kind !== 'item' && en.pos && monde.meteo.foudroie(lieu, en.pos, abriServeur)) entites.damage(en, 8, null, null);
        });
        // SPEC-CONSTR-007 : la foudre allume ce qu'elle touche, si c'est inflammable.
        if (MC.Feu) {
          const ySol = monde.estCharge(lieu.x, lieu.z) ? monde.groundAt(lieu.x, lieu.z) : monde.heightAt(lieu.x, lieu.z);
          MC.Feu.allumerParFoudre(monde.getBlock, lieu.x, ySol, lieu.z).forEach(a => {
            monde.setBlock(a[0], a[1], a[2], a[3]);
            diffuser({ t: NP.MSG.BLOC, x: a[0], y: a[1], z: a[2], id: a[3], etat: 0 });
          });
        }
      });
    });
  }

  appliquerTornades(dt, joueurs);
  // ARCHI-041 : le récit de chaque joueur évalue où il est et ce qu'il porte (temps de jeu : gelé en pause avec toute la boucle)
  if (regles.histoire) joueurs.forEach(({ c, j, js }) => sonderRecit(c, j, js, dt));

  liberSoutesDetruites();
  const etats = joueurs.map(x => x.js.joueur.state);
  const ref = joueurs.length ? { pos: joueurs[0].js.joueur.state.pos } : joueurReference();
  const ev = entites.update(dt, ref, { joueurs: etats.length ? etats : [ref],
    hiver: MC.DayCycle.saison(heure).nom === 'hiver', pvpOk: pvpAutorise, peutBlesser: peutBlesserJoueurs });
  // SPEC-DONJON-018 : la victoire RÉELLE sur un gardien (événement 'boss_vaincu'
  // du journal d'entites.js, jamais un appel direct isolé) marque le donjon
  // vaincu (pré-existant : jamais fait par le serveur avant ce lot, seulement
  // au chargement d'une sauvegarde) ET profite à la faction dont le
  // territoire couvre ce donjon, s'il y en a une.
  entites.evenements().forEach(evt => {
    // ARCHI-041 : le récit du joueur qui a tué la créature (ou vaincu le gardien) l'apprend
    if (regles.histoire && (evt.type === 'mort' || evt.type === 'boss_vaincu')) {
      if (evt.type === 'mort' && evt.auteurJoueur && evt.auteur) {
        const x = joueurParEtat(evt.auteur);
        if (x) signalerRecit(x.c, x.j, x.js, { type: 'tuer', mob: evt.victime });
      }
      if (evt.type === 'boss_vaincu') {
        tousLesJoueurs().forEach(x => {
          if (!x.js.recit) return;
          const st = x.js.joueur.state;
          if (evt.auteur === st || (evt.pos && Math.hypot(evt.pos.x - st.pos.x, evt.pos.z - st.pos.z) <= 96)) {
            signalerRecit(x.c, x.j, x.js, { type: 'boss', donjon: evt.donjon });
          }
        });
      }
    }
    crediterSuccesEvenement(evt);
    if (evt.type !== 'boss_vaincu') return;
    const msgV = chat.systeme(evt.nom + ' est vaincu !');
    if (msgV) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: msgV.texte, type: 'systeme', ts: msgV.t });
    if (!evt.donjon || !monde.donjonsVaincus || monde.donjonsVaincus.has(evt.donjon)) return;
    monde.donjonsVaincus.add(evt.donjon);
    const parts = evt.donjon.split(',');
    const d = monde.donjons && monde.donjons.deRegion ? monde.donjons.deRegion(+parts[0], +parts[1]) : null;
    if (d && MC.Donjons.victoireGardien) {
      const r = MC.Donjons.victoireGardien(d, politique);
      if (r) {
        const f = politique.factions.get(r.faction);
        const msgF = chat.systeme((f ? f.nom : r.faction) + (r.revendique ? ' revendique le territoire de ' : ' tire profit de ') + d.id + '.');
        if (msgF) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: msgF.texte, type: 'systeme', ts: msgF.t });
      }
    }
  });
  // les coups des créatures, appliqués aux joueurs qu'ils visaient — B4
  // (SPEC-PVP-001 à 003) : un coup de FLÈCHE tiré par un JOUEUR (`d.par`) suit
  // le même chemin qu'un coup de mêlée (butin, meurtre, victoire), sans le
  // multiplicateur `regles.degatsMob` (réservé aux créatures — piège B4.md
  // § 13, bogue corrigé au passage : une flèche de joueur en était
  // auparavant multipliée comme un coup de mob).
  ev.degatsPar.forEach(d => {
    const x = joueurs.find(y => y.js.joueur.state === d.joueur);
    if (!x) return;
    const st = x.js.joueur.state;
    const avant = st.dead;
    if (d.par) {
      x.js.joueur.hurt(Math.round(d.n));
      if (!avant && st.dead) {
        const auteur = joueurParEtat(d.par);
        if (auteur) {
          const duel = MC.PvpEnjeux.duelActif(pvp, auteur.c.nom, x.c.nom, heure, d.par.pos, st.pos);
          journal(`⚔ ${auteur.c.nom} a vaincu ${x.c.nom} (PvP, flèche)`);
          const msg = chat.systeme(auteur.c.nom + ' a vaincu ' + x.c.nom);
          if (msg) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: msg.texte, type: 'systeme', ts: msg.t });
          MC.Admin.journaliser(admin, { auteur: auteur.c.nom, action: 'combat_joueur', cible: x.c.nom, details: d.n, heure });
          issuePvp(auteur, x, duel);
        }
      }
    } else {
      x.js.joueur.hurt(Math.round(d.n * (regles.degatsMob || 1)));
    }
  });
  /* B1 (SPEC-SYNC-007) : le ramassage est désormais rangé dans l'inventaire
     SERVEUR (`js.joueur.pickUp`, le même code que le solo) — le client ne
     l'ajoute plus lui-même, il apprend le gain par l'INV_MAJ qui suit. Un
     inventaire déjà plein rend le reliquat au sol ; DONNE ne sert plus qu'au
     retour visuel/sonore (toast, son de ramassage), jamais à l'ajout. */
  ev.picked.forEach(p => {
    const x = joueurs.find(y => y.js.joueur.state === p.joueur);
    if (!x) return;
    const reste = x.js.joueur.pickUp(p.id, p.n, p.data);
    const pris = p.n - reste;
    if (pris > 0) envoyerInvMaj(x.c, x.j, { gain: { id: p.id, n: pris } });
    if (reste > 0) entites.dropItem(p.joueur.pos.x, p.joueur.pos.y + 1, p.joueur.pos.z, p.id, reste, null, p.data);
    envoyer(x.c, { t: NP.MSG.DONNE, j: x.j, id: p.id, n: pris > 0 ? pris : p.n });
  });
  entites.mergeItems();

  /* SPEC-ARCHI-034 : apparitions autour des joueurs, à tour de rôle (un seul
     joueur par tic d'apparition : la cadence totale ne dépend pas du nombre
     de joueurs ; avec un joueur c'est exactement l'ancien rythme). */
  accSpawn += dt;
  if (accSpawn >= 3.5) {
    accSpawn = 0;
    if (clients.size > 0) {
      /* Au plus SPAWN_JOUEURS_PAR_TIC joueurs par tic, à tour de rôle : jusqu'à
         8 joueurs chacun garde le rythme d'un solo (une tentative par 3,5 s) ;
         au-delà, le coût par tic reste borné et la cadence par joueur baisse
         (100 joueurs : une tentative chacun toutes les ~44 s, 8 par tic). */
      const cibles = joueurs.length ? [] : [ref];
      for (let k = 0; k < Math.min(SPAWN_JOUEURS_PAR_TIC, joueurs.length); k++) cibles.push(joueurs[(rotationSpawn++) % joueurs.length].js.joueur.state);
      cibles.forEach(cible => {
        entites.trySpawn(cible, MC.DayCycle.isNight(heure), null, MC.Modes.plafondsEntites(regles));
        entites.trySpawnSouterrain(cible, null, MC.Modes.plafondsEntites(regles));
      });
      if (!MC.DayCycle.isNight(heure)) entites.burnUndead(false);
    }
  }
  accDonjons += dt;
  if (accDonjons >= 0.25) { accDonjons = 0; surveillerDonjonsServeur(); }

  /* Diffusion d'état à cadence réduite : simuler à 20 Hz et n'envoyer qu'à
     10 Hz divise le trafic par deux sans que l'on voie la différence, les
     clients interpolant entre deux relevés. */
  /* On garde le reliquat plutôt que de remettre à zéro : avec une horloge
     qui bat à ~15,6 ms (Windows), une image sur deux tombait juste sous la
     période et sautait son envoi — 30 états par seconde au lieu de 60. La
     petite tolérance absorbe la gigue du minuteur. */
  accEtat += dt;
  // SPEC-SERVEUR-007 : la cadence de diffusion s'adapte à la charge (nombre
  // de clients connectés, file d'envoi TCP la plus encombrée) plutôt que de
  // rester fixe — calcul PUR, testé sous Node (src/net-protocol.js). Recalculé
  // à chaque tic : toujours cohérent avec la charge actuelle.
  let fileEnvoiMax = 0;
  clients.forEach(c => { const f = (c.socket && c.socket.writableLength) || 0; if (f > fileEnvoiMax) fileEnvoiMax = f; });
  const etatHzEffectif = NP.calculerEtatHz(CONF.etatHz, { nbClients: clients.size, fileMax: fileEnvoiMax });
  const periodeEtat = 1 / etatHzEffectif;
  if (accEtat >= periodeEtat * 0.9) {
    accEtat = Math.min(periodeEtat, Math.max(0, accEtat - periodeEtat));
    if (clients.size > 0) {
      const js = tousLesJoueurs().map(({ c, j, js: x }) => {
        const st = x.joueur.state;
        return { id: c.id, j, nom: c.nom, x: +st.pos.x.toFixed(2), y: +st.pos.y.toFixed(2),
                 z: +st.pos.z.toFixed(2), yaw: +st.yaw.toFixed(2), mort: st.dead ? 1 : 0 };
      });
      // créatures, objets au sol et projectiles : tout ce qui vit dans le monde
      const decrire = e => {
        const o = { e: e.eid, t: e.type, x: +e.pos.x.toFixed(2), y: +e.pos.y.toFixed(2),
                    z: +e.pos.z.toFixed(2), yaw: +(e.yaw || 0).toFixed(2) };
        if (e.type === 'item') o.i = e.item;
        if (e.genre) o.g = e.genre;
        if (e.arme) o.a = e.arme;
        if (e.variante !== undefined) o.v = e.variante;
        if (e.role) { o.r = e.role; o.n = e.nom; }
        /* Véhicule (SPEC-SYNC-022) : nom, vitesse, occupé, carburant, avarie — ce qu'il faut
           pour l'animer et, si le client en prend le volant, le prédire. */
        if (e.vehicule) {
          o.ve = e.vehicule; o.vi = +(e.vitesse || 0).toFixed(2);
          if (e.conducteur) o.co = 1;
          if (e.carburant != null) o.ca = +e.carburant.toFixed(1);
          if (e.avarie) o.av = e.avarieGravite || 1;
        }
        return o;
      };
      /* Une description par entité et par relevé, pas par client : à 100 joueurs elle
         serait recalculée cent fois pour la même créature (regroupement, SPEC-SYNC-022). */
      const decrites = new Map();
      const decrireUne = e => { let o = decrites.get(e); if (!o) { o = decrire(e); decrites.set(e, o); } return o; };
      // SPEC-ARCHI-046 : au millième — arrondie au dixième, l'heure restait figée puis sautait de 0,1 s
      const commun = { t: NP.MSG.ETAT, joueurs: [], mobs: [], heure: +heure.toFixed(3) };
      const vivants = [], objetsAuSol = [], vehicules = [];
      entites.list.forEach(e => { (e.type === 'item' ? objetsAuSol : e.vehicule ? vehicules : vivants).push(e); });
      clients.forEach(c => {
        if (!c.rejoint || !c.joueurs) return;
        /* À chacun les créatures les plus proches de SES joueurs, plafonnées à
           NP.MAX_MOBS_DIFFUSES (invariant documenté et testé, SPEC-SERVEUR-007) :
           avec les habitants des villes, les premières de la liste pouvaient
           être à l'autre bout du monde. */
        const pos = c.joueurs.map(x => x.joueur.state.pos);
        const d2 = e => Math.min.apply(null, pos.map(p => (e.pos.x - p.x) ** 2 + (e.pos.z - p.z) ** 2));
        /* SPEC-SYNC-026 : les objets au sol ont leur propre plafond — jamais évincés par les créatures */
        commun.mobs = NP.selectionnerMobsProches(vivants, pos, NP.PORTEE_MOBS_DIFFUSES, NP.MAX_MOBS_DIFFUSES).map(decrireUne)
          .concat(NP.selectionnerMobsProches(objetsAuSol, pos, NP.PORTEE_MOBS_DIFFUSES, NP.MAX_ITEMS_DIFFUSES).map(decrireUne))
          // les véhicules ont leur propre plafond (SPEC-SYNC-022) : ni évincés par les créatures, ni sans borne
          .concat(((sel) => { c.vehiculesVus = new Set(sel.map(e => e.eid)); return sel.map(decrireUne); })(
            NP.selectionnerAvecHysteresis(vehicules, pos, NP.PORTEE_MOBS_DIFFUSES, NP.MAX_VEHICULES_DIFFUSES, c.vehiculesVus)));
        /* Les AUTRES joueurs, bornés à la même portée que les créatures : sans
           ce filtre, chaque diffusion d'état grandissait en O(joueurs²) — une
           liste complète envoyée à CHAQUE client. Invisible jusqu'à quelques
           dizaines de joueurs, ça sature le réseau bien avant que la
           simulation elle-même ne peine (identifié au banc de charge,
           SPEC-SERVEUR-002 — chiffres avant/après dans docs/charge.md). */
        commun.joueurs = js.filter(j => d2({ pos: { x: j.x, z: j.z } }) < NP.PORTEE_MOBS_DIFFUSES * NP.PORTEE_MOBS_DIFFUSES);
        commun.toi = c.joueurs.map(x => SY.etatJoueur(x.joueur, x.dernier));
        envoyer(c, commun);
      });
    }
  }
  if (MESURES_ACTIVES) enregistrerTic(performance.now() - __t0);
}, 4);

// ── ouverture automatique du navigateur (SPEC-PACK-001) ─────────────────────
/* « Lancé sans paramètre, il ouvre le jeu dans le navigateur » : uniquement
   quand AUCUN paramètre n'a été donné (pas même --port), pour ne jamais
   surprendre un usage scripté ou les tests, qui passent toujours au moins
   --port. Best-effort : sans environnement graphique, on l'ignore. */
function ouvrirNavigateur(url) {
  try {
    const { spawn } = require('child_process');
    let cmd, args;
    if (process.platform === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', url]; }
    else if (process.platform === 'darwin') { cmd = 'open'; args = [url]; }
    else { cmd = 'xdg-open'; args = [url]; }
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch (e) { journal('navigateur non ouvert automatiquement : ' + e.message); }
}

// ── écoute : fermée par défaut, ouvrable à chaud (SPEC-ARCHI-002/004/005) ─────
function ecouterUn(srv, port, hote) {
  return new Promise((resolve, reject) => {
    const surErreur = (e) => reject(e);
    srv.once('error', surErreur);
    const fin = () => {
      srv.removeListener('error', surErreur);
      srv.on('error', (e) => journal(`erreur d'écoute : ${e.message}`));
      resolve(srv.address().port);
    };
    if (hote) srv.listen(port, hote, fin); else srv.listen(port, fin);
  });
}
function adressesReseau() {
  const out = [];
  try {
    const ifs = require('os').networkInterfaces();
    Object.keys(ifs).forEach(nom => (ifs[nom] || []).forEach(a => {
      if (!a.internal && a.family === 'IPv4' && out.length < CA.BORNES.ADRESSES_MAX) out.push(a.address);
    }));
  } catch (e) { /* aucune interface lisible */ }
  return out.length ? out : ['0.0.0.0'];
}
/* Ouvre les écouteurs du mode courant sur `port` (0 = éphémère) et renvoie le
   port réel. Lève l'erreur d'écoute (EADDRINUSE…) sans rien laisser ouvert. */
async function ouvrirEcoute(port) {
  if (reseauOuvert) {
    const srv = creerEcouteur();
    const p = await ecouterUn(srv, port, null);
    ecouteurs = [srv]; adressesActives = adressesReseau();
    return p;
  }
  const s4 = creerEcouteur();
  const p = await ecouterUn(s4, port, '127.0.0.1');
  const liste = [s4], adr = ['127.0.0.1'];
  const s6 = creerEcouteur();
  try { await ecouterUn(s6, p, '::1'); liste.push(s6); adr.push('::1'); }
  catch (e) {
    if (e.code === 'EADDRINUSE') { s4.close(); throw e; }         // port pris sur ::1 : on tente le suivant
    journal(`IPv6 de boucle locale indisponible (${e.code || e.message}) — IPv4 seule`);
  }
  ecouteurs = liste; adressesActives = adr;
  return p;
}
function fermerEcouteurs() {
  const l = ecouteurs; ecouteurs = [];
  return Promise.race([Promise.all(l.map(srv => new Promise(r => { try { srv.close(() => r()); } catch (e) { r(); } }))), dodo(500)]);
}
async function demarrerEcoute() {
  const candidats = CA.portsCandidats(PARAMS.port, PARAMS.portFixe);
  const essais = RELANCE ? 50 : 1;               // relance interne : le processus parent libère son port
  let derniere = null;
  for (let k = 0; k < essais; k++) {
    for (const port of candidats) {
      try { portActuel = await ouvrirEcoute(port); return; }
      catch (e) { derniere = e; if (e.code !== 'EADDRINUSE') throw e; }
    }
    if (k + 1 < essais) await dodo(200);
  }
  throw derniere;
}
function messageReseau() {
  return { t: NP.MSG.RESEAU_ETAT, etat: reseauOuvert ? CA.ETAT_RESEAU.OUVERT : CA.ETAT_RESEAU.FERME, port: portActuel, adresses: adressesActives };
}
/* SPEC-ARCHI-005 : ouvrir/fermer au réseau SANS redémarrer et sans couper les
   connexions locales (une socket déjà établie survit à la fermeture de
   l'écouteur). Fermer sauvegarde, puis expulse les connexions non locales. */
let basculeReseau = Promise.resolve();
function definirReseau(ouvrir) {
  basculeReseau = basculeReseau.then(() => basculerReseau(!!ouvrir)).catch(e => journal('échec de la bascule réseau : ' + ((e && e.message) || e)));
  return basculeReseau;
}
let echecsBasculeSimules = 0;
/* MC_TEST_ECHEC_BASCULE=N : les N premières ouvertures d'écouteur d'une bascule échouent
   (1 : la nouvelle liaison échoue puis l'ancienne est restaurée ; 2 : les deux échouent) —
   tests de l'échec, jamais en exploitation. */
async function ouvrirEcouteBascule(port) {
  if (echecsBasculeSimules < (parseInt(process.env.MC_TEST_ECHEC_BASCULE, 10) || 0)) {
    echecsBasculeSimules++;
    throw Object.assign(new Error('échec simulé'), { code: 'ETEST' });
  }
  return ouvrirEcoute(port);
}
async function basculerReseau(ouvrir) {
  if (arretEnCours) return;
  if (ouvrir === reseauOuvert) { diffuser(messageReseau()); return; }
  const ancien = reseauOuvert, port = portActuel;
  /* Un écouteur « toutes interfaces » et les deux liaisons de boucle locale se
     disputent le même port : on ferme l'ancien puis on ouvre le nouveau (les
     connexions déjà établies survivent). Rien d'autre ne change tant que la
     nouvelle liaison n'est pas ouverte : ni mode, ni pause, ni délai de grâce,
     ni expulsions — un échec laisse donc le serveur exactement comme avant. */
  reseauOuvert = ouvrir;
  await fermerEcouteurs();
  try {
    await ouvrirEcouteBascule(port);
  } catch (e) {
    journal(`échec de la liaison ${ouvrir ? 'ouverte' : 'fermée'} sur le port ${port} : ${e.message} — retour à l'état précédent`);
    reseauOuvert = ancien;
    try { await ouvrirEcouteBascule(port); }
    catch (e2) {
      journal(`liaison précédente irrécupérable (${e2.message}) — arrêt propre du serveur`);
      await arreter('écoute impossible');
      return;
    }
    diffuser(messageReseau());
    return;
  }
  if (ouvrir) {
    if (minuteurAbsence) { clearTimeout(minuteurAbsence); minuteurAbsence = null; }
    if (enPause) definirPause(false);                // aucune pause dans un monde ouvert
  } else {
    sauvegarderMondeAsync('fermeture réseau', true);
    clients.forEach(c => {
      if (c.local) return;
      envoyer(c, { t: NP.MSG.REFUS, motif: CA.MOTIFS_REFUS.RESEAU_FERME });
      setTimeout(() => fermer(c, 'reseau ferme'), 50);
    });
  }
  journal(reseauOuvert ? `réseau OUVERT sur le port ${portActuel} (${adressesActives.join(', ')})` : `réseau FERMÉ — boucle locale seulement (${adressesActives.join(', ')}:${portActuel})`);
  diffuser(messageReseau());
}

// ── démarrage ────────────────────────────────────────────────────────────────
demarrerEcoute().then(() => {
  journal(`MiniCraft — serveur sur http://localhost:${portActuel}${reseauOuvert ? ' (ouvert au réseau)' : ' (fermé au réseau : boucle locale seulement)'}`);
  journal(`écoute : ${reseauOuvert ? 'toutes les interfaces' : adressesActives.join(' et ')} · port ${portActuel}`);
  journal(`graine ${CONF.graine} · mode ${CONF.mode} · difficulté ${CONF.difficulte}` + (partieActive ? ` · partie « ${partieActive.nom} » (${partieActive.id})` : ''));
  journal(`simulation ${CONF.tickHz} Hz · diffusion d'état ${CONF.etatHz} Hz`);
  console.log(`MC_PORT=${portActuel}`);                       // lisible par un lanceur (SPEC-ARCHI-004)
  if (SANS_PARAMETRE && !CONF.serveurSeul) {
    journal('ouverture du navigateur…');
    ouvrirNavigateur(`http://localhost:${portActuel}`);
  }
  // lancé par une bascule de partie : le navigateur doit se reconnecter, sinon on ne reste pas orphelin
  if (RELANCE && !reseauOuvert) {
    // tant que le navigateur ne s'est pas reconnecté le monde attend (pause d'absence, levée à la reconnexion)
    enPause = true; pauseRev++; pauseParAbsence = true;
    armerAbsence(Math.max(GRACE_ARRET_MS, 30000));
  }   // relance interne : le navigateur a le temps de se reconnecter
}).catch((e) => {
  const motif = e && e.code === 'EADDRINUSE'
    ? (PARAMS.portFixe ? `le port ${PARAMS.port} est déjà utilisé` : `aucun port libre entre ${PARAMS.port} et ${CA.BORNES.PORT_REPLI_MAX}`)
    : ((e && e.message) || String(e));
  console.log(`impossible de démarrer le serveur : ${motif}. Libérez le port ou lancez avec un autre --port.`);
  process.exit(1);
});

/* SIGINT (Ctrl+C) ET SIGTERM (arrêt par un gestionnaire de services) doivent
   tous deux sauvegarder : un serveur seul persistant tourne typiquement sous
   un tel gestionnaire, qui n'envoie jamais SIGINT. À l'arrêt, la sauvegarde
   DOIT être synchrone (SPEC-SERVEUR-003/004) : le processus va se terminer
   juste après, une écriture asynchrone en cours serait perdue.

   Revue adversariale (test-race-save.js) : une sauvegarde PÉRIODIQUE peut
   être en vol au moment du signal. `sauvegardeArretee` empêche toute
   NOUVELLE sauvegarde async de démarrer, et on attend (au plus 1 s) que
   celle déjà en vol se termine avant d'écrire la sauvegarde finale — sans
   quoi son écriture, coupée en plein vol par `process.exit()`, laisserait
   un `.tmp` tronqué au sol (elle a désormais son propre fichier temporaire,
   donc ne peut plus corrompre CELUI de la sauvegarde finale, mais resterait
   quand même orpheline sans cette attente). */
async function arreter(signal) {
  if (arretEnCours) return;
  arretEnCours = true;
  journal(`arrêt demandé (${signal})`);
  sauvegardeArretee = true;
  arreterServeurHistoireTest();
  if (minuteurAbsence) { clearTimeout(minuteurAbsence); minuteurAbsence = null; }
  if (CONF.mondeFichier) {
    if (sauvegardeEnCours && sauvegardeEnCoursAttente) {
      await Promise.race([sauvegardeEnCoursAttente, dodo(1000)]);
    }
    const ok = sauvegarderMondeSync();
    journal(ok ? `monde sauvegardé dans ${CONF.mondeFichier}` : 'sauvegarde finale échouée');
  }
  clients.forEach(c => { try { c.socket.destroy(); } catch (e) {} });
  setTimeout(() => process.exit(0), 500);
  await fermerEcouteurs();
  process.exit(0);
}
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
  setTimeout(() => { throw new Error('panne asynchrone de test SPEC-SECU-002'); }, 200);
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
