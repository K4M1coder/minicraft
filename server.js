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
const MODULES = ['core', 'formes', 'noise', 'biomes', 'densite', 'zones', 'volcanisme', 'souterrain', 'recifs', 'caravanes', 'donjons', 'habitats', 'routes', 'carte', 'feu', 'meteo', 'lointain', 'world', 'circuits', 'lumiere', 'mesher', 'physics', 'faune', 'factions', 'inventory', 'conteneurs', 'vehicules',
                 'entities', 'player', 'synchro', 'daycycle', 'save', 'saves', 'modes',
                 'chat', 'commandes', 'split', 'contrats-vague2', 'net-protocol', 'parametres', 'admin', 'politique', 'guildes', 'economie', 'metiers', 'livre', 'livres'];

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
const PORT = PARAMS.port;

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

// ── administration (SPEC-ADMIN-001 à 008) ───────────────────────────────────
/* Sans --admin, le serveur tire un jeton et l'affiche UNE fois au démarrage :
   jamais de console laissée sans protection, jamais de secret par défaut
   devinable. */
const ADMIN_SECRET = PARAMS.admin || MC.Admin.nouveauJeton('demarrage-');
const admin = MC.Admin.creerEtat({
  motDePasseAdmin: ADMIN_SECRET,
  listeBlancheActive: PARAMS.listeBlanche,
  emailObligatoire: false,
});
if (!PARAMS.admin) {
  journal(`aucun --admin fourni : jeton d'administration généré → ${ADMIN_SECRET}`);
  journal('conservez-le : il ne sera plus jamais affiché (relancez avec --admin=... pour le fixer)');
}

const regles = MC.Modes.regles(CONF.mode, CONF.difficulte);
const monde = MC.createWorld(CONF.graine, { zonePolitique: PARAMS.zone });
const entites = MC.createEntities(monde);
const chat = MC.Chat.creer({ max: 120 });
// SPEC-FACTION-006 à 013 : factions PNJ (royaumes, guildes marchandes, ordres,
// bandits, cultes) et factions de joueurs — le serveur fait foi sur les deux.
const politique = MC.Politique.creer(CONF.graine);
const guildes = MC.Guildes.creerEtat();
// L45 : prix dynamiques, trésors de lieux, métiers (SPEC-ECO/METIER) — même
// module et même état joués à l'identique en solo (game.js) et ici.
const economie = MC.Economie.creerEtat(CONF.graine);
// SPEC-MECA-001 : contenu des distributeurs — le serveur fait foi sur ce qui
// s'éjecte sur signal (voir NP.MSG.DISTRIB et monde.tickCircuits plus bas).
const distributeurs = new Map();
// B1 (SPEC-SYNC-007 à 017) : registre des joueurs nommés et banques — déclarés
// ICI (avant `appliquerEtatMonde`, qui les lit dès la reprise `--monde` au
// démarrage, plus bas dans ce fichier) et non près du reste de la section
// inventaire/conteneurs (server.js § « inventaire et conteneurs ») pour éviter
// une zone morte temporelle (`const` lu avant sa déclaration lexicale).
const joueursRegistre = new Map();   // cleRegistre(nom, j) → enregistrement { v:1, inv, equip, banque }
const banques = new Map();           // cleRegistre(nom, j) → conteneur 'banque' (API figée, § 5 du plan)
function banqueDe(cleReg) {
  let b = banques.get(cleReg);
  if (!b) { b = MC.Conteneurs.creerConteneur('banque'); banques.set(cleReg, b); }
  return b;
}
let heure = 60;
let meteoT = null;
let accEau = 0;
let accCircuits = 0;      // L29 mécanismes (SPEC-MECA-008) : même cadence que l'eau

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
    // dernier `fermer()`. Le registre des conteneurs POSÉS (coffres,
    // fourneaux…) n'existe pas encore ici (étape 7) : rien à en sauver.
    joueurs: Array.from(snapshotRegistreJoueurs().entries()),
  };
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
      out.set(js.cleReg, MC.Conteneurs.versEnregistrement(js.joueur.state, banqueDe(js.cleReg)));
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
  if (data.economie) {
    const eco = MC.Economie.charger(data.economie);
    economie.jour = eco.jour; economie.lieux = eco.lieux;
    economie.joueurs = eco.joueurs; economie.departs = eco.departs;
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
function sauvegarderMondeAsync() {
  if (!CONF.mondeFichier || sauvegardeArretee) return;
  if (sauvegardeEnCours) return;                      // pas de sauvegarde concurrente
  sauvegardeEnCours = true;
  let finAttente;
  sauvegardeEnCoursAttente = new Promise((resolve) => { finAttente = resolve; });
  const fin = () => { sauvegardeEnCours = false; sauvegardeEnCoursAttente = null; finAttente(); };
  let data;
  try { data = JSON.stringify(etatMonde()); }
  catch (e) { journal('échec de la sauvegarde du monde (sérialisation) : ' + e.message); fin(); return; }
  fs.writeFile(FICHIER_TMP_ASYNC(), data, (err) => {
    if (err) { journal('échec de la sauvegarde du monde (écriture) : ' + err.message); fin(); return; }
    fs.rename(FICHIER_TMP_ASYNC(), CONF.mondeFichier, (err2) => {
      if (err2) journal('échec de la sauvegarde du monde (renommage) : ' + err2.message);
      fin();
    });
  });
}

/* Version synchrone (toujours atomique elle aussi, mêmes tmp+rename, mais
   dans SON PROPRE fichier temporaire — voir plus haut) : réservée à l'arrêt
   du processus et aux gestionnaires de panne, où il n'y a plus de prochain
   tour de boucle d'évènements pour attendre une écriture asynchrone. */
function sauvegarderMondeSync() {
  if (!CONF.mondeFichier) return false;
  try {
    fs.writeFileSync(FICHIER_TMP_SYNC(), JSON.stringify(etatMonde()));
    fs.renameSync(FICHIER_TMP_SYNC(), CONF.mondeFichier);
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
  setInterval(sauvegarderMondeAsync, parseInt(process.env.MC_SAUVEGARDE_MS, 10) || 120000);
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

/* Le serveur a besoin d'un « joueur de référence » pour l'IA des mobs
   (poursuite, apparition). On prend le premier client connecté ; sans client,
   la simulation tourne au ralenti autour de l'origine. */
const spawnCol = monde.findSpawnColumn();
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  monde.getChunk(Math.floor(spawnCol[0] / 16) + cx, Math.floor(spawnCol[1] / 16) + cz, true);
}
const SPAWN = {
  x: spawnCol[0] + 0.5,
  y: monde.groundAt(spawnCol[0], spawnCol[1], true) + 1.2,
  z: spawnCol[1] + 0.5,
};

// ── clients ──────────────────────────────────────────────────────────────────
let prochainId = 1;
const clients = new Map();          // id -> {id, nom, socket, pos, yaw, pitch, locaux, vivant}

function diffuser(msg, saufId) {
  const trame = NP.encoder(JSON.stringify(msg), NP.OP.TEXTE, Buffer.alloc);
  clients.forEach(c => {
    if (c.id === saufId || !c.vivant) return;
    try { c.socket.write(trame); } catch (e) { fermer(c, 'ecriture impossible'); }
  });
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
      if (!js.cleReg) return;
      joueursRegistre.set(js.cleReg, MC.Conteneurs.versEnregistrement(js.joueur.state, banqueDe(js.cleReg)));
    });
  }
  if (c.sessionId) MC.Admin.fermerSession(admin, c.sessionId, heure);
  try { c.socket.destroy(); } catch (e) {}
  const m = chat.systeme(c.nom + ' a quitté la partie');
  diffuser({ t: NP.MSG.QUITTE, id: c.id, nom: c.nom });
  if (m) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
  journal(`- ${c.nom} (#${c.id}) parti — ${raison || 'deconnexion'} · ${clients.size} en ligne`);
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
  const fiable = requeteFiable(req, PORT);
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
    const fiable = requeteFiable(req, PORT);
    if (!fiable.ok) { repondreJSON(res, fiable.code, { ok: false, motif: fiable.motif }); return true; }
    lireCorpsJSON(req, (args) => { repondreJSON(res, 200, cahier.marquerConserve(racine, dossier, args.valeur !== false)); });
    return true;
  }
  if (!action && req.method === 'DELETE') {
    const fiable = requeteFiable(req, PORT);
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

function servir(req, res) {
  if (req.url.indexOf('/admin/api/') === 0 && traiterApiAdmin(req, res)) return;
  if (req.url.split('?')[0] === '/tests/resultats' && traiterResultatsTest(req, res)) return;
  if (req.url.split('?')[0] === '/tests/version' && traiterVersion(req, res)) return;
  if (req.url.indexOf('/tests/cahiers') === 0 && traiterCahiers(req, res)) return;
  const chemin = cheminSur(req.url);
  if (!chemin) { res.writeHead(403); res.end('403 chemin refusé'); return; }
  fs.stat(chemin, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('404 introuvable'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(chemin).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(chemin).pipe(res);
  });
}

// ── serveur HTTP + bascule WebSocket ─────────────────────────────────────────
const serveur = http.createServer(servir);

serveur.on('upgrade', (req, socket) => {
  if (!NP.estRequeteWebSocket(req.headers)) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
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
  socket.on('close', () => fermer(c, 'socket fermee'));
});

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
  const budgetV2 = MC.ContratsV2 && MC.ContratsV2.BUDGETS_FLOOD[m.t];
  const budget = m.t === NP.MSG.BLOC ? FLOOD_MAX_BLOC : (budgetV2 || FLOOD_MAX_GENERAL);
  return floodVerifie(c, m, cle, FLOOD_FENETRE_MS, budget);
}

// ── traitement des messages ──────────────────────────────────────────────────
/* Bascules de test réservées aux suites d'intégration (désactivées par
   défaut, jamais en exploitation normale) : elles provoquent volontairement
   une exception dans `traiter()` pour vérifier SPEC-SECU-001, exactement
   comme MC_SAUVEGARDE_MS ou MC_MESURES réduisent un intervalle pour les
   tests plutôt que d'exposer un chemin de code séparé et non testé. */
const MC_TEST_PANNE = process.env.MC_TEST_PANNE === '1';

function traiter(c, m) {
  if (!m) return;                                   // message invalide : ignoré
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
      if ([...clients.values()].filter(x => x.rejoint).length >= CONF.maxJoueurs) {
        envoyer(c, { t: NP.MSG.REFUS, motif: 'serveur_complet' });
        journal(`x ${m.nom} (${c.ip}) refusé — serveur complet (${CONF.maxJoueurs})`);
        setTimeout(() => fermer(c, 'serveur complet'), 50);
        break;
      }
      c.nom = m.nom;
      c.email = m.email || null;
      c.locaux = m.locaux;
      c.rejoint = true;
      c.role = MC.Admin.roleDe(admin, c.nom);           // un modérateur nommé retrouve son rôle en revenant
      c.sessionId = MC.Admin.ouvrirSession(admin, { nom: c.nom, ip: c.ip }, heure);
      c.joueurs = [];
      for (let j = 0; j < c.locaux; j++) {
        const js = creerJoueurServeur(j);
        // B1 (registre des joueurs nommés) : une clé tenue par un joueur DÉJÀ
        // connecté (même nom, écran partagé compris) reste éphémère — jamais
        // restaurée, jamais écrasée dans le registre à la fermeture.
        const cleReg = MC.ContratsV2 ? MC.ContratsV2.cleRegistre(c.nom, j) : null;
        js.cleReg = (cleReg && !cleRegDejaConnectee(cleReg)) ? cleReg : null;
        if (js.cleReg) {
          const rec = joueursRegistre.get(js.cleReg);
          if (rec) MC.Conteneurs.depuisEnregistrement(js.joueur.state, banqueDe(js.cleReg), rec);
          else if (MC_TEST_INV) MC_TEST_INV.forEach(p => js.joueur.state.inv.add(p[0], p[1]));
        }
        c.joueurs.push(js);
      }
      c.pos = c.joueurs[0].joueur.state.pos;
      // l'état complet du monde modifié, pour que le nouveau venu voie les
      // constructions faites avant son arrivée
      const blocs = [];
      monde.overrides.forEach((id, k) => {
        const p = k.split(',');
        const etat = monde.etatsOverrides ? (monde.etatsOverrides.get(k) || 0) : 0;
        blocs.push([+p[0], +p[1], +p[2], id, etat]);
      });
      envoyer(c, {
        t: NP.MSG.BIENVENUE,
        id: c.id, graine: CONF.graine, mode: CONF.mode, difficulte: CONF.difficulte,
        zone: monde.zonesEtat ? monde.zonesEtat.politique : 'generee',
        heure, blocs,
        // la position qui fait foi, pour chaque joueur local du poste
        toi: c.joueurs.map(js => SY.etatJoueur(js.joueur, 0)),
        tickHz: CONF.tickHz, etatHz: CONF.etatHz,
        joueurs: [...clients.values()].filter(x => x.id !== c.id && x.rejoint)
          .map(x => ({ id: x.id, nom: x.nom, x: x.pos.x, y: x.pos.y, z: x.pos.z, yaw: x.yaw })),
        chat: chat.recents(20).map(x => ({ auteur: x.auteur, texte: x.texte, type: x.type, ts: x.t })),
      });
      // B1 (SPEC-SYNC-008) : le nouveau venu apprend son inventaire (restauré,
      // seedé par MC_TEST_INV, ou vide) avant tout autre message d'inventaire.
      c.joueurs.forEach((js, j) => envoyerInvMaj(c, j, {}));
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
    case NP.MSG.BOUGE:
      /* Ancien message : le client imposait sa position. Le serveur fait
         désormais autorité — on n'en retient que le regard. */
      c.yaw = m.yaw; c.pitch = m.pitch;
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
        if (d2 > 6) break;
        if (!pvpAutorise(st.pos, vst.pos)) break;
        // deux membres d'une même faction ne se blessent pas (SPEC-FACTION-012)
        if (!MC.Guildes.peutBlesser(guildes, c.nom, cible.c.nom)) break;
        js.attaqueCd = 0.4;
        const avant = vst.dead;
        vst.hurtCd = 0;
        cible.js.joueur.hurt(m.degats);
        // recul, comme pour une créature (entities.damage s'en inspire)
        const dx = vst.pos.x - st.pos.x, dz = vst.pos.z - st.pos.z, dd = Math.hypot(dx, dz) || 1;
        vst.vel.x += (dx / dd) * 5; vst.vel.z += (dz / dd) * 5; vst.vel.y = 4.5;
        MC.Admin.journaliser(admin, { auteur: c.nom, action: 'combat_joueur', cible: cible.c.nom, details: m.degats, heure });
        if (!avant && vst.dead) {
          const msg = chat.systeme(c.nom + ' a vaincu ' + cible.c.nom);
          if (msg) diffuser({ t: NP.MSG.CHAT, auteur: null, texte: msg.texte, type: 'systeme', ts: msg.t });
          journal(`⚔ ${c.nom} a vaincu ${cible.c.nom} (PvP)`);
        }
        break;
      }

      const e = entites.list.find(x => x.eid === m.eid);
      if (!e || e.dead || e.type === 'item') break;
      const d = Math.hypot(e.pos.x - st.pos.x, e.pos.y + e.h / 2 - st.pos.y - 1.6, e.pos.z - st.pos.z);
      // portée et cadence vérifiées : on ne frappe ni de loin ni en rafale
      if (d > 6 || js.attaqueCd > 0) break;
      js.attaqueCd = 0.4;
      entites.damage(e, m.degats, st.pos, st);
      // journal des actions (SPEC-ADMIN-002) : les combats aussi
      MC.Admin.journaliser(admin, { auteur: c.nom, action: 'combat', cible: e.type, details: m.degats, heure });
      break;
    }

    case NP.MSG.TIR: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || js.joueur.state.dead || js.tirCd > 0) break;
      js.tirCd = 0.3;
      const st = js.joueur.state;
      const o = { x: st.pos.x + m.dx * 0.4, y: st.pos.y + 1.62 + m.dy * 0.4, z: st.pos.z + m.dz * 0.4 };
      entites.tirer(o, { x: m.dx, y: m.dy, z: m.dz }, m.vitesse, m.degats, st, m.genre);
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
        if (m.seq !== undefined && seqNouveau(js, m.seq)) envoyerInvMaj(c, m.j, {});
      } else if (m.seq !== undefined && seqNouveau(js, m.seq)) {
        refuserOp(c, m.j, m.seq, r.motif);
      }
      break;
    }

    case NP.MSG.RENAITRE: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || !js.joueur.state.dead) break;
      js.joueur.respawn({ x: SPAWN.x + m.j * 1.2, y: SPAWN.y, z: SPAWN.z });
      js.entrees.length = 0;
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
      if (!blocAutorise(js, m, avant, c)) {
        // refusé : on rappelle au client ce qui s'y trouve vraiment
        envoyer(c, { t: NP.MSG.BLOC, x: m.x, y: m.y, z: m.z, id: avant });
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
      // SPEC-MECA-001 : un distributeur cassé lâche ce qu'il contenait.
      if (m.id === 0 && avant === C.B.DISTRIBUTEUR) {
        const kd = `${m.x},${m.y},${m.z}`;
        const slots = distributeurs.get(kd);
        if (slots) slots.forEach(s => { if (s) entites.dropItem(m.x + 0.5, m.y + 0.5, m.z + 0.5, s.id, s.n); });
        distributeurs.delete(kd);
      }
      break;
    }

    /* SPEC-SYNC-017 (B1, docs/vague-2/B1.md § 9 étape 9) : DISTRIB est une
       DÉCLARATION, pas un dépôt aveugle — `m.slots` (déjà borné et normalisé
       par net-protocol.js) est ce que le joueur VEUT voir dans le
       distributeur ; `MC.Conteneurs.declarer` ne prélève dans son inventaire
       serveur que ce qu'il possède réellement (tronqué), et rend ce qu'un
       retrait n'a pas pu récupérer (Σ inv + distributeur conservée par id).
       Le registre des distributeurs posés (étape 7) n'existe pas encore :
       `distributeurs` reste la Map brute cle → slots, ici enveloppée le
       temps de l'appel pour offrir la forme `{ slots }` que `declarer`
       attend (mutation en place : aucune réécriture séparée nécessaire). */
    case NP.MSG.DISTRIB: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || monde.getBlock(m.x, m.y, m.z) !== C.B.DISTRIBUTEUR) break;
      const kd = `${m.x},${m.y},${m.z}`;
      const TAILLE_DISTRIB = 9;
      const cont = { slots: distributeurs.get(kd) || new Array(TAILLE_DISTRIB).fill(null) };
      MC.Conteneurs.declarer(js.joueur.state.inv, cont, m.slots);
      distributeurs.set(kd, cont.slots);
      envoyerInvMaj(c, m.j, {});
      break;
    }

    case NP.MSG.CHAT: {
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
      traiterOp(c, m, js, { k: 'craft', fois: m.fois });
      break;
    }
    case NP.MSG.EQUIP: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) break;
      const r = traiterOp(c, m, js, { k: 'equip', slot: m.slot, i: m.i });
      if (r && r.ok) diffuserEquipVu(c, m.j, js, m.slot);
      break;
    }
    // le transfert inv↔grille ne dépend d'aucun registre de conteneur posé —
    // un transfert vers/depuis 'cont' échoue proprement (motif 'ferme') tant
    // que le registre des conteneurs (B1, étape 7) n'est pas branché.
    case NP.MSG.CONTENEUR_TRANSFERT: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) break;
      traiterOp(c, m, js, { k: 'transfert', de: m.de, vers: m.vers, n: m.n });
      break;
    }
    // fermer la grille rend son contenu à l'inventaire (SPEC-SYNC-007, B1.md
    // § 6) — un vrai conteneur posé (coffre, fourneau…) n'existe pas encore
    // ici (étape 7) : rien d'autre à faire pour l'instant.
    case NP.MSG.CONTENEUR_FERMER: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) break;
      if (m.cle === 'grille') traiterOp(c, m, js, { k: 'rendreGrille' });
      break;
    }
    case NP.MSG.INV_CONSOMMER: {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) break;
      traiterOp(c, m, js, { k: 'consommer', ops: m.ops });
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
      // action === 'echanger' : idempotence par seq (B1), embargo calculé par
      // B4 après son rebase (SPEC-PVP-006)
      if (!seqNouveau(js, m.seq)) break;
      const embargo = false;
      const r = MC.Economie.executerTroc(economie, etatJoueurServeur(js).inv, {
        lieuId: ent.lieu, role: ent.role, pnjId: ent.pnj, indice: m.offre, fois: m.fois || 1,
        nom: c.nom, embargo,
      });
      if (!r.ok) { refuserOp(c, m.j, m.seq, r.motif); break; }
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
  (res.actions || []).forEach(a => { if (a.type === 'heure') heure = a.valeur; });
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
/* ctx pour MC.Conteneurs.appliquer : la banque est déjà un conteneur
   accessible par sa clé propre ('banque') ; un conteneur posé (coffre,
   fourneau…) n'existe pas encore ici (étape 7) — renvoyer null fait échouer
   proprement l'opération (motif 'ferme'), sans planter. */
function ctxJoueur(js) {
  return {
    joueur: { inv: js.joueur.state.inv, equip: js.joueur.state.equip, grille: js.grille },
    conteneur: (cle) => (cle === 'banque' && js.cleReg) ? banqueDe(js.cleReg) : null,
    regles,
    stats: { faim: js.joueur.state.hunger, vie: js.joueur.state.hp, vieMax: MC.PlayerConst.MAX_HP },
    eauProche: () => eauProcheDe(js.joueur.state.pos),
  };
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
/* Cœur commun à CRAFT, EQUIP, CONTENEUR_TRANSFERT, INV_CONSOMMER, INV_LACHER,
   INV_CREATIF : vérifie l'idempotence du `seq`, applique l'opération pure,
   lâche au sol ce qu'elle a éventuellement fait déborder, puis répond par un
   INV_MAJ (ack ou refus) — TOUJOURS, jamais deux messages non atomiques. */
function traiterOp(c, m, js, op) {
  if (!seqNouveau(js, m.seq)) return null;
  const r = MC.Conteneurs.appliquer(ctxJoueur(js), op);
  if (!r.ok) { refuserOp(c, m.j, m.seq, r.motif); return r; }
  if (r.effets && r.effets.lache) lacherAuxPieds(js, r.effets.lache);
  envoyerInvMaj(c, m.j, {});
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
           entrees: [], dernier: 0, budget: SY.creerBudget(), attaqueCd: 0, tirCd: 0 };
}
const PORTEE_BLOC = 7;
function blocAutorise(js, m, avant, c) {
  if (!js || js.joueur.state.dead) return false;
  const st = js.joueur.state;
  const d = Math.hypot(m.x + 0.5 - st.pos.x, m.y + 0.5 - st.pos.y - 1.62, m.z + 0.5 - st.pos.z);
  if (d > PORTEE_BLOC) return false;                      // hors de portée
  if (m.id === 0) {
    const def = C.BLOCKS[avant];
    if (!def || def.hardness < 0) return false;            // ni le socle ni l'eau
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
  return true;
}
/* SPEC-MECA-007 : poser ou casser un bloc de commande — en ligne, réservé à
   un administrateur (le serveur fait toujours autorité, jamais le mode local
   du client, qui ne veut rien dire une fois connecté). */
function blocCommandeAutorise(c) {
  return !!(MC.Circuits && MC.Circuits.commandeAutorisee({ enLigne: true, role: c && c.role }));
}
function tousLesJoueurs() {
  const l = [];
  clients.forEach(c => { if (c.rejoint && c.joueurs) c.joueurs.forEach((js, j) => l.push({ c, j, js })); });
  return l;
}

/* SPEC-COMBAT-002 : le PvP n'est permis que si le serveur l'autorise
   (--pvp, désactivé par défaut) ET si la zone des DEUX joueurs le permet
   (SPEC-ZONE-001) — un joueur réfugié en zone sûre reste protégé même si
   son agresseur, lui, se tient en zone PvP. */
function pvpAutorise(posA, posB) {
  return !!CONF.pvp && (!MC.Zones || MC.Zones.pvpAutorise(monde.zones, monde.zonesEtat, posA, posB));
}
// un identifiant stable pour désigner un joueur cible dans un message ATTAQUE
function cleJoueur(id, j) { return id + '/' + (j || 0); }
function joueurParCle(cle) {
  const p = String(cle).split('/');
  const id = +p[0], j = +p[1] || 0;
  return tousLesJoueurs().find(x => x.c.id === id && x.j === j) || null;
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
let accSpawn = 0;
let accChunks = 1;         // premier passage immédiat

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
  if (now - dernier < PERIODE_TICK * 0.9) return;
  const dt = Math.min((now - dernier) / 1000, 0.25);
  dernier = now;
  const __t0 = MESURES_ACTIVES ? performance.now() : 0;

  heure += dt;
  // circuits : diffusé explicitement plus bas (comme l'eau), donc désactivé ici
  monde.tick(dt, 14, null, { temps: heure, circuits: false });

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
        const kd = `${x},${y},${z}`;
        const slots = distributeurs.get(kd);
        if (!slots) return;
        const i = MC.Circuits.distributeurChoix(slots);
        if (i < 0) return;
        const st = slots[i];
        const idef = C.ITEMS[st.id];
        st.n -= 1;
        if (st.n <= 0) slots[i] = null;
        if (idef && idef.ammo) {
          entites.tirer({ x: x + 0.5, y: y + 1, z: z + 0.5 }, { x: 0, y: 1, z: 0 },
                         14, idef.damage || 5, null, idef.ammoType || 'fleche');
        } else {
          entites.dropItem(x + 0.5, y + 1, z + 0.5, st.id, 1);
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

  /* Chaque joueur avance selon SES entrées, dans la limite du temps écoulé :
     c'est le serveur qui décide de la position et des statistiques. */
  const joueurs = tousLesJoueurs();
  joueurs.forEach(({ js }) => {
    js.budget.crediter(dt);
    js.attaqueCd = Math.max(0, js.attaqueCd - dt);
    js.tirCd = Math.max(0, js.tirCd - dt);
    const st = js.joueur.state;
    while (js.entrees.length && !st.dead && js.budget.consommer(js.entrees[0].dt)) {
      const e = js.entrees.shift();
      SY.rejouer(js.joueur, [e]);
      js.joueur.updateSurvival(e.dt);
      js.dernier = e.s;
    }
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
      joueurs.forEach(({ js }) => {
        const st = js.joueur.state;
        const lieu = monde.meteo.lieuEclair(e, st.pos.x, st.pos.z);
        if (!st.dead && monde.meteo.foudroie(lieu, st.pos, abriServeur)) js.joueur.hurt(monde.meteo.DEGATS_FOUDRE);
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

  const etats = joueurs.map(x => x.js.joueur.state);
  const ref = joueurs.length ? { pos: joueurs[0].js.joueur.state.pos } : joueurReference();
  const ev = entites.update(dt, ref, { joueurs: etats.length ? etats : [ref],
    hiver: MC.DayCycle.saison(heure).nom === 'hiver', pvpOk: pvpAutorise });
  // les coups des créatures, appliqués aux joueurs qu'ils visaient
  ev.degatsPar.forEach(d => {
    const x = joueurs.find(y => y.js.joueur.state === d.joueur);
    if (x) x.js.joueur.hurt(Math.round(d.n * (regles.degatsMob || 1)));
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

  accSpawn += dt;
  if (accSpawn >= 3.5) {
    accSpawn = 0;
    if (clients.size > 0) {
      entites.trySpawn(ref, MC.DayCycle.isNight(heure), null,
                       MC.Modes.plafondsEntites(regles));
      entites.trySpawnSouterrain(ref, null, MC.Modes.plafondsEntites(regles));
      if (!MC.DayCycle.isNight(heure)) entites.burnUndead(false);
    }
  }

  /* Diffusion d'état à cadence réduite : simuler à 20 Hz et n'envoyer qu'à
     10 Hz divise le trafic par deux sans que l'on voie la différence, les
     clients interpolant entre deux relevés. */
  /* On garde le reliquat plutôt que de remettre à zéro : avec une horloge
     qui bat à ~15,6 ms (Windows), une image sur deux tombait juste sous la
     période et sautait son envoi — 30 états par seconde au lieu de 60. La
     petite tolérance absorbe la gigue du minuteur. */
  accEtat += dt;
  const periodeEtat = 1 / CONF.etatHz;
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
        return o;
      };
      const commun = { t: NP.MSG.ETAT, joueurs: [], mobs: [], heure: +heure.toFixed(1) };
      clients.forEach(c => {
        if (!c.rejoint || !c.joueurs) return;
        /* À chacun les créatures les plus proches de SES joueurs : avec les
           habitants des villes, les 80 premières de la liste pouvaient être
           à l'autre bout du monde. */
        const pos = c.joueurs.map(x => x.joueur.state.pos);
        const d2 = e => Math.min.apply(null, pos.map(p => (e.pos.x - p.x) ** 2 + (e.pos.z - p.z) ** 2));
        commun.mobs = entites.list.filter(e => d2(e) < 96 * 96).sort((a, b) => d2(a) - d2(b)).slice(0, 80).map(decrire);
        /* Les AUTRES joueurs, bornés à la même portée que les créatures : sans
           ce filtre, chaque diffusion d'état grandissait en O(joueurs²) — une
           liste complète envoyée à CHAQUE client. Invisible jusqu'à quelques
           dizaines de joueurs, ça sature le réseau bien avant que la
           simulation elle-même ne peine (identifié au banc de charge,
           SPEC-SERVEUR-002 — chiffres avant/après dans docs/charge.md). */
        commun.joueurs = js.filter(j => d2({ pos: { x: j.x, z: j.z } }) < 96 * 96);
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

// ── démarrage ────────────────────────────────────────────────────────────────
serveur.listen(PORT, () => {
  journal(`MiniCraft — serveur sur http://localhost:${PORT}`);
  journal(`graine ${CONF.graine} · mode ${CONF.mode} · difficulté ${CONF.difficulte}`);
  journal(`simulation ${CONF.tickHz} Hz · diffusion d'état ${CONF.etatHz} Hz`);
  if (SANS_PARAMETRE && !CONF.serveurSeul) {
    journal('ouverture du navigateur…');
    ouvrirNavigateur(`http://localhost:${PORT}`);
  }
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
  journal(`arrêt demandé (${signal})`);
  sauvegardeArretee = true;
  if (CONF.mondeFichier) {
    if (sauvegardeEnCours && sauvegardeEnCoursAttente) {
      await Promise.race([sauvegardeEnCoursAttente, dodo(1000)]);
    }
    const ok = sauvegarderMondeSync();
    journal(ok ? `monde sauvegardé dans ${CONF.mondeFichier}` : 'sauvegarde finale échouée');
  }
  clients.forEach(c => { try { c.socket.destroy(); } catch (e) {} });
  serveur.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', () => arreter('SIGINT'));
process.on('SIGTERM', () => arreter('SIGTERM'));

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

module.exports = { serveur, cheminSur, CONF, admin, ADMIN_SECRET, sauvegarderMondeSync, sauvegarderMondeAsync, appliquerEtatMonde, etatMonde };
