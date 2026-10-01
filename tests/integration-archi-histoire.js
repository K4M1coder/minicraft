/* integration-archi-histoire.js — lot P-HIST du chantier « solo = serveur toujours
   présent » : SPEC-ARCHI-041, le mode histoire porté par le serveur, sur de vrais
   processus server.js (serveur FERMÉ au réseau, comme le solo).

   - le mode histoire se crée (plus de refus « en attendant P-HIST ») et le serveur
     annonce le récit : BIENVENUE porte les règles, HISTOIRE_NOTIF la première
     réplique, HISTOIRE_ETAT l'état du récit ; le héros est posé sur la place du
     village de départ ;
   - les restrictions d'interactions du mode sont appliquées PAR LE SERVEUR (casser
     un bloc hors de l'histoire, poser un objet interdit : refusés) ;
   - parler à un habitant : portée jugée par le serveur ; le bon habitant fait
     avancer l'étape UNE fois ; une réponse inconnue ne change rien ;
   - colonie : poser les blocs demandés (arbitré par le serveur, hors de portée
     refusé) fait progresser l'objectif ;
   - sauvegarde puis rechargement conservent l'étape et la progression ;
   - une partie solo importée (extras.histoire) est adoptée par son joueur ;
   - audit statique : plus de refus ni de simulation du récit dans game.js.

   Usage : node tests/integration-archi-histoire.js */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre, attendreClients, dossierTemp, supprimerDossier, requete, RACINE } = A;
const R = A.creerRapport('Intégration ARCHI — P-HIST : le mode histoire porté par le serveur');
const { ok, eq } = R;

const MC = A.chargerModules();
const B = MC.Core.B;
const GRAINE = 20260921;
const serveurs = [];
async function demarrer(args, env) {
  const s = await lancer(['--port', '0'].concat(args || []), env);
  serveurs.push(s);
  return s;
}
async function jusqua(lire, ms, pas) {
  const fin = Date.now() + (ms || 5000);
  for (;;) {
    const v = lire();
    if (v) return v;
    if (Date.now() > fin) return null;
    await dodo(pas || 40);
  }
}
/* Un « rien ne se passe » ne s'attend pas : on l'observe, borné, jusqu'à la première violation. */
async function observer(ms, invariant) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (!invariant()) return false; await dodo(25); }
  return true;
}
const regles = (cl) => MC.Modes.regles('histoire', 'facile', { interactions: cl.bienvenue.histoire && cl.bienvenue.histoire.interactions });
const dernierRecit = (cl) => {
  const m = cl.client.dernier('histoire_etat');
  return m ? MC.Recits.charger(m.etat.recit, () => true) : null;
};
const nbEtats = (cl) => cl.client.messages.filter(m => m.t === 'histoire_etat').length;
const objectif = (cl) => { const r = dernierRecit(cl); return r ? MC.Recits.objectif(r) : null; };
const toi = (cl) => { const e = cl.client.dernier('etat'); return e && e.toi && e.toi[0]; };
async function partir(cl, s) {
  cl.client.fermer();
  await attendreClients(s.port, 0);
}
function fichierMonde(D, id) { return path.join(D, id + '.json'); }
async function attendreFichier(D, id) {
  return jusqua(() => { try { return JSON.parse(fs.readFileSync(fichierMonde(D, id), 'utf8')); } catch (e) { return null; } }, 8000, 100);
}
/* Les blocs d'un monde de test (même graine que le serveur), chunks chargés autour de (x, z). */
function mondeTest() { return MC.createWorld(GRAINE); }
function chargerAutour(w, x, z) {
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) w.getChunk(Math.floor(x / 16) + cx, Math.floor(z / 16) + cz, true);
}
async function bloc(cl, x, y, z, id) {
  const n = cl.client.messages.length;                       // la RÉPONSE à cet envoi, jamais un écho plus ancien
  cl.client.envoyer({ t: 'bloc', x, y, z, id, j: 0, i: 0 });
  return cl.client.attendre('bloc', 3000, m => m.x === x && m.y === y && m.z === z && cl.client.messages.indexOf(m) >= n);
}

async function main() {
  const D = dossierTemp('mc-phist-');
  try {
    // ── audit statique : plus de refus ni de simulation locale du récit ─────────
    const jeu = fs.readFileSync(path.join(RACINE, 'src', 'game.js'), 'utf8');
    ok(!/n'est pas encore disponible/.test(jeu) && !/en attendant P-HIST/.test(jeu), 'game.js : le mode histoire n\'est plus refusé à la création');
    ok(!/MC\.Recits\.signaler\(/.test(jeu) && !/MC\.Histoire\.creer\(/.test(jeu) && !/signalerHistoire/.test(jeu), 'game.js : plus aucune simulation du récit côté client');

    // ── trois parties d'histoire créées par l'API du serveur ──────────────────
    const s0 = await demarrer(['--dossier-parties', D]);
    const creer = async (nom, histoire, difficulte) => {
      const r = await requete(s0.port, '/api/parties', { corps: { nom, mode: 'histoire', difficulte: difficulte || 'facile', graine: GRAINE, histoire } });
      return r.json && r.json.partie && r.json.partie.id;
    };
    const idEpopee = await creer('Épopée', { archetype: 'epopee', heros: 'Alice', longueur: 'courte', interactions: { preset: 'restreinte' } });
    const idColonie = await creer('Colonie', { archetype: 'colonie', heros: 'Bob', longueur: 'courte', interactions: { preset: 'libre' } });
    const idSolo = await creer('Ancien solo', { archetype: 'epopee', heros: 'Claire', longueur: 'courte', interactions: { preset: 'libre' } });
    const ids = {};
    for (const [k, diff] of [['aller', 'facile'], ['collecte', 'facile'], ['mort', 'cauchemar'], ['illisible', 'facile']]) {
      ids[k] = await creer('Sonde ' + k, { archetype: 'epopee', heros: 'Eve', longueur: 'courte', interactions: { preset: 'libre' } }, diff);
    }
    ok(!!(idEpopee && idColonie && idSolo && ids.aller && ids.collecte && ids.mort && ids.illisible), 'le serveur accepte de créer des parties en mode histoire');
    await s0.arreter();

    await epopee(D, idEpopee);
    await colonie(D, idColonie);
    await ancienSolo(D, idSolo);
    await sondes(D, ids);
    await routeTest();
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
    supprimerDossier(D);
  }
}

// ── l'épopée : annonce, restrictions, parler, persistance ─────────────────────
async function epopee(D, id) {
  const s = await demarrer(['--dossier-parties', D, '--partie', id]);
  const a = await rejoindre(s.port, 'Alice');
  const cl = { client: a.client, bienvenue: a.bienvenue };
  eq(a.bienvenue.mode, 'histoire', 'BIENVENUE annonce le mode histoire');
  ok(a.bienvenue.histoire && a.bienvenue.histoire.interactions && a.bienvenue.histoire.interactions.preset === 'restreinte' && a.bienvenue.histoire.commerce === true,
     'BIENVENUE porte les règles du récit (interactions, commerce)');
  const notif = await a.client.attendre('histoire_notif', 10000).catch(() => null);
  ok(notif && notif.notifs[0] && notif.notifs[0].type === 'chapitre' && /réveil/i.test(notif.notifs[0].titre), 'le serveur raconte le premier chapitre : ' + (notif && notif.notifs[0] && notif.notifs[0].titre));
  const etat = await a.client.attendre('histoire_etat', 5000).catch(() => null);
  ok(etat && etat.etat.recit.archetype === 'epopee', 'HISTOIRE_ETAT annonce l\'état du récit');
  const o = objectif(cl);
  ok(o && /guide/i.test(o.texte) && o.numero === 1, 'l\'objectif est de parler au guide : ' + (o && o.texte));
  const rec = dernierRecit(cl);
  const dep = rec.histoire.liens.depart;
  const p0 = a.bienvenue.toi[0];
  ok(Math.hypot(p0.x - (dep.x + 0.5), p0.z - (dep.z + 3.5)) < 3, 'le héros s\'éveille sur la place du village de départ');

  // restrictions d'interactions : appliquées par le SERVEUR
  const w = mondeTest();
  chargerAutour(w, p0.x, p0.z);
  const R0 = regles(cl);
  const fx = Math.floor(p0.x), fy = Math.floor(p0.y), fz = Math.floor(p0.z);
  let dur = null;
  for (let y = fy - 1; y >= fy - 4 && !dur; y--) {
    const id0 = w.getBlock(fx, y, fz);
    if (id0 && !MC.Modes.peutCasser(R0, id0)) dur = { y, id: id0 };
  }
  ok(!!dur, 'un bloc hors de l\'histoire sous les pieds (banc)');
  if (dur) {
    const rep = await bloc(cl, fx, dur.y, fz, 0);
    eq(rep.id, dur.id, 'casser un bloc interdit par l\'histoire est refusé par le serveur (rappel du bloc)');
  }
  let libre = null;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]]) {
    if (w.getBlock(fx + dx, fy, fz + dz) === 0 && !libre) libre = { x: fx + dx, z: fz + dz };
  }
  if (libre) {
    const t = await bloc(cl, libre.x, fy, libre.z, B.TORCH);
    eq(t.id, B.TORCH, 'une torche (catégorie permise) se pose');
    const pierre = await bloc(cl, libre.x, fy + 1, libre.z, B.STONE);
    eq(pierre.id, 0, 'poser de la pierre (hors de l\'histoire) est refusé par le serveur');
    const casse = await bloc(cl, libre.x, fy, libre.z, 0);
    eq(casse.id, 0, 'et la torche (permise) se casse');
  } else R.saut('pose d\'une torche', 'aucune case libre autour du héros');

  // parler : portée jugée par le serveur
  const pnjs = MC.Habitats.pnjsManquants(w.habitats.lieuxProches(dep.x, dep.z, 90), [], new Map(), 0);
  const guide = pnjs.filter(p => p.role === 'guide' && p.lieu === dep.id)[0];
  ok(!!guide, 'le village de départ a son guide (banc)');
  const vuGuide = () => { const e = a.client.dernier('etat'); return e && (e.mobs || []).filter(m => m.r === 'guide' && m.n === guide.nom)[0]; };
  const mob = await jusqua(vuGuide, 15000, 100);
  ok(!!mob, 'le serveur fait naître le guide du village de départ');
  if (mob) {
    const dist = Math.hypot(mob.x - toi(cl).x, mob.z - toi(cl).z);
    if (dist > 6) {
      const n0 = nbNotifs(a);
      a.client.envoyer({ t: 'histoire_parler', j: 0, eid: mob.e });
      ok(await observer(700, () => nbNotifs(a) === n0), 'parler à un habitant hors de portée : le serveur ne répond pas (' + dist.toFixed(1) + ' blocs)');
    } else R.saut('parler hors de portée', 'le guide est déjà à portée (' + dist.toFixed(1) + ')');
    ok(/guide/i.test(objectif(cl).texte), 'et l\'étape n\'a pas avancé');
  }
  await partir(cl, s);
  await s.arreter();

  // ── on remet le héros à côté du guide (fichier de monde), le récit est rechargé ──
  const data = await attendreFichier(D, id);
  ok(!!data && data.histoire && Array.isArray(data.histoire.recits) && data.histoire.recits.length === 1, 'le fichier de monde porte le récit du joueur');
  ok(!!(data && data.histoire && data.histoire.liens && data.histoire.liens.depart), 'et les lieux liés au monde');
  const cle = MC.ContratsV2.cleRegistre('Alice', 0);
  const ligne = data.joueurs.filter(e => e[0] === cle)[0];
  ligne[1].etat.x = guide.x + 1; ligne[1].etat.y = guide.y + 1; ligne[1].etat.z = guide.z;
  fs.writeFileSync(fichierMonde(D, id), JSON.stringify(data));
  const s2 = await demarrer(['--dossier-parties', D, '--partie', id]);
  const b = await rejoindre(s2.port, 'Alice');
  const cl2 = { client: b.client, bienvenue: b.bienvenue };
  const etat2 = await b.client.attendre('histoire_etat', 8000).catch(() => null);
  ok(etat2 && etat2.etat.recit.histoire.commence, 'le récit est rechargé depuis le fichier');
  ok(await observer(500, () => !b.client.messages.some(m => m.t === 'histoire_notif' && m.notifs.some(n => n.type === 'chapitre'))), 'et le premier chapitre n\'est pas raconté une seconde fois');
  const mob2 = await jusqua(() => { const e = b.client.dernier('etat'); return e && (e.mobs || []).filter(m => m.r === 'guide' && m.n === guide.nom)[0]; }, 15000, 100);
  ok(!!mob2, 'le guide est là');
  if (mob2) {
    const dist = Math.hypot(mob2.x - toi(cl2).x, mob2.z - toi(cl2).z);
    ok(dist < 6, 'le héros est à portée du guide (' + dist.toFixed(1) + ')');
    const nEtats = nbEtats(cl2);
    b.client.envoyer({ t: 'histoire_parler', j: 0, eid: mob2.e });
    const rep = await b.client.attendre('histoire_notif', 4000, m => m.notifs.some(n => n.type === 'dialogue')).catch(() => null);
    ok(!!rep, 'le guide raconte (dialogue annoncé par le serveur)');
    const avance = await jusqua(() => { const q = objectif(cl2); return q && !/guide/i.test(q.texte) && nbEtats(cl2) > nEtats; }, 4000);
    ok(!!avance, 'et l\'étape avance côté serveur : ' + (objectif(cl2) && objectif(cl2).texte));
    const apres = JSON.stringify(dernierRecit(cl2).histoire.journal) + dernierRecit(cl2).histoire.etape;
    // rejeu : parler encore au guide ne ré-avance pas
    b.client.envoyer({ t: 'histoire_parler', j: 0, eid: mob2.e });
    await b.client.attendre('histoire_notif', 3000, m => m.libre === true || m.notifs.length === 0).catch(() => null);
    eq(JSON.stringify(dernierRecit(cl2).histoire.journal) + dernierRecit(cl2).histoire.etape, apres, 'reparler au guide ne ré-avance pas l\'étape');
    // une réponse qui ne correspond à rien ne change rien et resynchronise
    const n1 = nbEtats(cl2);
    b.client.envoyer({ t: 'histoire_reponse', j: 0, id: 'quete:bidon', option: 'oui' });
    ok(!!(await jusqua(() => nbEtats(cl2) > n1, 3000)), 'une réponse inconnue est refusée et l\'état est renvoyé');
    eq(Object.keys(dernierRecit(cl2).histoire.secondaires).length, 0, 'aucune quête acceptée par une réponse forgée');
    b.client.envoyer({ t: 'histoire_reponse', j: 0, id: 'inexistant', option: 'a' });
    ok(await observer(300, () => true), 'un choix inexistant est sans effet');
  }
  const avantArret = JSON.stringify(dernierRecit(cl2).histoire.journal) + dernierRecit(cl2).histoire.etape;
  await partir(cl2, s2);
  await s2.arreter();
  // sauvegarde puis rechargement conservent l'étape
  const s3 = await demarrer(['--dossier-parties', D, '--partie', id]);
  const c3 = await rejoindre(s3.port, 'Alice');
  await c3.client.attendre('histoire_etat', 8000).catch(() => null);
  const cl3 = { client: c3.client, bienvenue: c3.bienvenue };
  eq(JSON.stringify(dernierRecit(cl3).histoire.journal) + dernierRecit(cl3).histoire.etape, avantArret, 'sauvegarde puis rechargement conservent l\'étape et le journal');
  await partir(cl3, s3);
  await s3.arreter();
}
function nbNotifs(c) { return c.client.messages.filter(m => m.t === 'histoire_notif').length; }

// ── la colonie : poser les blocs demandés fait progresser l'objectif ──────────
async function colonie(D, id) {
  const s = await demarrer(['--dossier-parties', D, '--partie', id]);
  const a = await rejoindre(s.port, 'Bob');
  const cl = { client: a.client, bienvenue: a.bienvenue };
  const etat = await a.client.attendre('histoire_etat', 10000).catch(() => null);
  ok(etat && etat.etat.recit.archetype === 'colonie', 'une colonie est annoncée');
  const c0 = dernierRecit(cl).colonie;
  const b0 = c0.batiments[c0.etapePose];
  const o0 = objectif(cl);
  ok(o0 && o0.progres === 0 && o0.n >= 1, 'objectif « poser ' + (o0 && o0.n) + ' » à zéro : ' + (o0 && o0.texte));
  const w = mondeTest();
  const p = a.bienvenue.toi[0];
  chargerAutour(w, p.x, p.z);
  const fx = Math.floor(p.x), fy = Math.floor(p.y), fz = Math.floor(p.z);
  const cases = [];
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
    if ((dx || dz) && w.getBlock(fx + dx, fy, fz + dz) === 0 && w.getBlock(fx + dx, fy + 1, fz + dz) === 0) cases.push({ x: fx + dx, z: fz + dz });
  }
  ok(cases.length >= 2, 'des cases libres autour du héros (banc)');
  // hors de portée : refusé par le serveur, aucune progression
  const nE = nbEtats(cl);
  const loin = await bloc(cl, fx + 40, fy, fz, b0.bloc);
  ok(loin.id !== b0.bloc, 'poser hors de portée est refusé par le serveur (rappel du bloc existant)');
  ok(await observer(500, () => (objectif(cl).progres || 0) === 0), 'et n\'avance pas l\'objectif');
  let poses = 0;
  for (const cse of cases) {
    if (poses >= 2) break;
    const r = await bloc(cl, cse.x, fy, cse.z, b0.bloc);
    if (r.id === b0.bloc) poses++;
  }
  eq(poses, Math.min(2, cases.length), 'le serveur accepte les poses du bloc demandé');
  const progres = await jusqua(() => { const c = dernierRecit(cl).colonie; return c.etapePose > 0 || (c.poses[b0.id] || 0) >= 1 ? c : null; }, 5000);
  ok(!!progres, 'l\'objectif progresse, annoncé par HISTOIRE_ETAT : ' + (objectif(cl) && (objectif(cl).progres + '/' + objectif(cl).n)));
  ok(nbEtats(cl) > nE, 'à chaque changement le serveur renvoie l\'état');
  const avant = JSON.stringify(dernierRecit(cl).colonie.poses) + dernierRecit(cl).colonie.etapePose;
  await partir(cl, s);
  await s.arreter();
  const s2 = await demarrer(['--dossier-parties', D, '--partie', id]);
  const b = await rejoindre(s2.port, 'Bob');
  await b.client.attendre('histoire_etat', 8000).catch(() => null);
  const cl2 = { client: b.client, bienvenue: b.bienvenue };
  eq(JSON.stringify(dernierRecit(cl2).colonie.poses) + dernierRecit(cl2).colonie.etapePose, avant, 'sauvegarde puis rechargement conservent la progression de la colonie');
  await partir(cl2, s2);
  await s2.arreter();
}

// ── une partie solo importée : son récit est adopté par son joueur ────────────
async function ancienSolo(D, id) {
  const liens = {
    depart: { id: 'village:0,0', nom: 'Hameau-Clair', x: 0, z: 0, h: 64, kind: 'lieu' },
    ville: { id: 'ville:1,0', nom: 'Grandbourg', x: 400, z: 0, h: 64, kind: 'lieu' },
    ermite: { id: 'maison:2', nom: 'Ermitage', x: 900, z: 0, h: 64, kind: 'lieu' },
  };
  const cr = MC.RecitServeur.creer({ monde: null, graine: GRAINE, liens, params: { archetype: 'epopee', longueur: 'courte', heros: 'Claire' }, peut: () => true });
  MC.Recits.commencer(cr.etat);
  cr.etat.histoire.chap = 1; cr.etat.histoire.etape = 0;
  cr.etat.histoire.journal.push('récit de l\'ancien solo');
  const SLOTS = MC.ContratsV2.BORNES.SLOTS_INV;
  const monde = {
    v: 2, graine: GRAINE, heure: 60, overrides: [], etats: [], crops: [],
    soloJoueur: { v: 1, inv: new Array(SLOTS).fill(0), equip: {}, etat: { hp: 20, hunger: 20, air: 10 } },
    extras: { histoire: JSON.parse(JSON.stringify(MC.Recits.serialiser(cr.etat))), succes: null },
  };
  fs.writeFileSync(fichierMonde(D, id), JSON.stringify(monde));
  const s = await demarrer(['--dossier-parties', D, '--partie', id]);
  const a = await rejoindre(s.port, 'Claire');
  const etat = await a.client.attendre('histoire_etat', 15000).catch(() => null);
  ok(etat && etat.etat.recit.histoire.chap === 1, 'le chapitre de l\'ancien solo est repris (chapitre 2)');
  ok(etat && etat.etat.recit.histoire.journal.indexOf('récit de l\'ancien solo') >= 0, 'avec son journal');
  ok(await observer(500, () => !a.client.messages.some(m => m.t === 'histoire_notif' && m.notifs.some(n => n.type === 'chapitre' && /réveil/i.test(n.titre)))), 'le récit repris n\'est pas recommencé');
  await partir({ client: a.client }, s);
  const data = await jusqua(() => {
    try { const d = JSON.parse(fs.readFileSync(fichierMonde(D, id), 'utf8')); return d.histoire && d.histoire.recits && d.histoire.recits.length ? d : null; } catch (e) { return null; }
  }, 10000, 100);
  ok(!!data, 'le récit adopté est écrit dans le fichier de monde (parité ARCHI-014)');
  ok(data && !(data.extras && data.extras.histoire), 'et n\'est plus conservé en double dans les extras');
  await s.arreter();
}

// ── les sondes du serveur : lieu atteint, objet porté, mort en cauchemar ──────
const LIENS_TEST = {
  depart: { id: 'village:0,0', nom: 'Hameau-Clair', x: 0, z: 0, h: 64, kind: 'lieu' },
  ville: { id: 'ville:1,0', nom: 'Grandbourg', x: 400, z: 0, h: 64, kind: 'lieu' },
  ermite: { id: 'maison:2', nom: 'Ermitage', x: 900, z: 0, h: 64, kind: 'lieu' },
};
/* Fichier de monde fabriqué : le récit de `nom` à l'étape voulue, le joueur du poste à `solo`, les lieux déjà liés
   (aucune recherche de 6 s au démarrage). */
function ecrireMonde(D, id, nom, modif, solo, extras) {
  const RS = MC.RecitServeur;
  const cr = RS.creer({ monde: null, graine: GRAINE, liens: LIENS_TEST, params: { archetype: 'epopee', longueur: 'courte', heros: nom }, peut: () => true });
  MC.Recits.commencer(cr.etat);
  if (modif) modif(cr.etat.histoire);
  const SLOTS = MC.ContratsV2.BORNES.SLOTS_INV;
  const data = {
    v: 2, graine: GRAINE, heure: 60, overrides: [], etats: [], crops: [], joueurs: [],
    histoire: { v: 1, liens: LIENS_TEST, recits: modif ? [[MC.ContratsV2.cleRegistre(nom, 0), JSON.parse(JSON.stringify(RS.exporter(cr.etat, null)))]] : [] },
    soloJoueur: solo ? { v: 1, inv: new Array(SLOTS).fill(0), equip: {}, etat: Object.assign({ hp: 20, hunger: 20, air: 10 }, solo) } : null,
    extras: extras || null,
  };
  fs.writeFileSync(fichierMonde(D, id), JSON.stringify(data));
}
async function sondes(D, ids) {
  // (a) le héros est au lieu cible : « Rejoignez la ville » avance, sans que personne ne parle ni ne pose rien
  ecrireMonde(D, ids.aller, 'Eve', h => { h.chap = 1; h.etape = 0; }, { x: 400.5, y: 120, z: 0.5 });
  let s = await demarrer(['--dossier-parties', D, '--partie', ids.aller]);
  let a = await rejoindre(s.port, 'Eve');
  const e0 = await a.client.attendre('histoire_etat', 10000).catch(() => null);
  ok(e0 && e0.etat.recit.histoire.chap === 1 && e0.etat.recit.histoire.etape === 0, 'le récit repris attend « Rejoignez la ville »');
  const arrive = await jusqua(() => { const r = dernierRecit({ client: a.client }); return r && r.histoire.etape > 0 ? r : null; }, 12000, 100);
  ok(!!arrive, 'être arrivé au lieu cible fait avancer l\'étape, évalué par le serveur (position)');
  await partir({ client: a.client }, s); await s.arreter();

  // (b) avoir l'objet requis : six rondins dans l'inventaire serveur font avancer « rassemblez du bois »
  ecrireMonde(D, ids.collecte, 'Dora', h => { h.chap = 0; h.etape = 1; }, null);
  s = await demarrer(['--dossier-parties', D, '--partie', ids.collecte], { MC_TEST_INV: JSON.stringify([[B.LOG, 6]]) });
  a = await rejoindre(s.port, 'Dora');
  const e1 = await a.client.attendre('histoire_etat', 10000).catch(() => null);
  ok(e1 && e1.etat.recit.histoire.chap === 0, 'le récit repris attend le bois');
  const bois = await jusqua(() => { const r = dernierRecit({ client: a.client }); return r && r.histoire.etape > 1 ? r : null; }, 12000, 100);
  ok(!!bois, 'détenir six rondins fait avancer l\'étape, évalué par le serveur (inventaire)');
  await partir({ client: a.client }, s); await s.arreter();
  // sans l'objet, rien ne bouge (le correctif ne fait pas avancer à vide)
  ecrireMonde(D, ids.collecte, 'Dora', h => { h.chap = 0; h.etape = 1; }, null);
  s = await demarrer(['--dossier-parties', D, '--partie', ids.collecte]);
  a = await rejoindre(s.port, 'Dora');
  await a.client.attendre('histoire_etat', 10000).catch(() => null);
  ok(await observer(1500, () => dernierRecit({ client: a.client }).histoire.etape === 1), 'sans les rondins, l\'étape n\'avance pas');
  await partir({ client: a.client }, s); await s.arreter();

  // (c) mort définitive en cauchemar : le serveur la transmet au récit, qui s'achève
  ecrireMonde(D, ids.mort, 'Gus', h => { h.chap = 0; h.etape = 1; }, { x: 0.5, y: 330, z: 0.5 });
  s = await demarrer(['--dossier-parties', D, '--partie', ids.mort]);
  a = await rejoindre(s.port, 'Gus');
  const fin = await a.client.attendre('histoire_notif', 40000, m => m.notifs.some(n => n.type === 'fin')).catch(() => null);
  ok(!!fin, 'la mort en cauchemar achève le récit (annonce de fin du serveur)');
  const etatFin = await jusqua(() => { const r = dernierRecit({ client: a.client }); return r && r.histoire.fin ? r : null; }, 5000);
  ok(!!etatFin && a.client.dernier('histoire_etat').etat.fin, 'et HISTOIRE_ETAT porte la fin');
  const succes = await a.client.attendre('succes_debloque', 8000, m => m.id === 'histoire_achevee').catch(() => null);
  ok(!!succes, 'la fin du récit débloque le succès histoire_achevee, arbitré par le serveur');
  await dodo(300);
  eq(a.client.messages.filter(m => m.t === 'succes_debloque' && m.id === 'histoire_achevee').length, 1, 'une seule fois');
  await a.client.fermer(); await s.arreter();

  // (d) un récit de partie importée illisible n'est pas perdu
  ecrireMonde(D, ids.illisible, 'Hana', null, { x: 0.5, y: 100, z: 0.5 }, { histoire: { n: 'illisible' }, succes: null });
  s = await demarrer(['--dossier-parties', D, '--partie', ids.illisible]);
  a = await rejoindre(s.port, 'Hana');
  await a.client.attendre('histoire_etat', 10000).catch(() => null);
  await partir({ client: a.client }, s);
  const d = await jusqua(() => { try { const x = JSON.parse(fs.readFileSync(fichierMonde(D, ids.illisible), 'utf8')); return x.histoire && x.histoire.recits && x.histoire.recits.length ? x : null; } catch (e) { return null; } }, 10000, 100);
  ok(!!d, 'le joueur a quand même un récit neuf');
  ok(d && d.extras && d.extras.histoire && d.extras.histoire.n === 'illisible', 'et le récit importé illisible reste conservé tel quel dans les extras');
  await s.arreter();
}

// ── POST /tests/serveur-histoire : réservé à la boucle locale, en JSON, avec --tests ──
async function routeTest() {
  const http = require('http');
  const brut = (port, entetes, hote) => new Promise((resolve) => {
    const req = http.request({ host: hote || '127.0.0.1', port, path: '/tests/serveur-histoire', method: 'POST', headers: entetes }, (res) => {
      let t = ''; res.on('data', d => { t += d; }); res.on('end', () => resolve({ code: res.statusCode, corps: t }));
    });
    req.on('error', () => resolve({ code: 0, corps: '' }));
    req.end('{}');
  });
  const sSans = await demarrer([]);
  const r0 = await brut(sSans.port, { 'Content-Type': 'application/json' });
  ok(r0.code !== 200, 'sans --tests la route n\'existe pas (' + r0.code + ')');
  await sSans.arreter();
  const s = await demarrer(['--serveur', '--tests']);
  const sans = await brut(s.port, {});
  eq(sans.code, 415, 'sans Content-Type JSON : refusé');
  const proxy = await brut(s.port, { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.0.9' });
  eq(proxy.code, 403, 'derrière un mandataire : refusé');
  const ext = A.adresseReseau();
  if (ext) {
    const distant = await brut(s.port, { 'Content-Type': 'application/json' }, ext);
    eq(distant.code, 403, 'depuis une adresse non locale : refusé (serveur ouvert)');
  } else R.saut('route de test depuis une autre adresse', 'aucune adresse réseau non locale');
  const bon = await brut(s.port, { 'Content-Type': 'application/json' });
  let port = null;
  try { port = JSON.parse(bon.corps).port; } catch (e) { /* illisible */ }
  ok(bon.code === 200 && port > 0, 'depuis la boucle locale, en JSON : un serveur d\'histoire jetable démarre');
  await s.arreter();
  if (port) ok(await attendreInjoignable(port), 'et il s\'arrête avec son parent (pas d\'orphelin)');
}
async function attendreInjoignable(port) {
  const fin = Date.now() + 8000;
  while (Date.now() < fin) { if ((await A.sonde(port)) !== 'ok') return true; await dodo(100); }
  return false;
}

main().then(() => { process.exit(R.fin()); }, (e) => { ok(false, 'exception : ' + (e && e.stack || e)); process.exit(R.fin()); });
