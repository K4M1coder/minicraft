/* integration-archi-robustesse.js — corrections de la revue adversariale du lot A0
   (SPEC-ARCHI-005, 008, 010, 012, 013, 015), sur de vrais processus server.js :

   - la pause gèle aussi la cuisson d'un fourneau et refuse tous les messages qui
     modifient l'état de jeu (manger, fabriquer, équiper, lâcher, palette…) ;
   - un échec de la bascule réseau à chaud laisse le serveur EXACTEMENT comme avant
     (mode, pause, connexions) ; si la liaison précédente est aussi perdue, arrêt propre ;
   - supprimer la partie active pendant une sauvegarde en vol ne casse rien ;
   - un processus relancé (changement de partie) démarre en pause et garde le jeton admin ;
   - une WebSocket qui ne rejoint jamais ne retarde pas l'arrêt d'un serveur orphelin ;
   - un import qui échoue ne laisse ni fichier orphelin ni entrée d'index.

   Usage : node tests/integration-archi-robustesse.js [scenario] */
'use strict';
const path = require('path');
const fs = require('fs');
const A = require('./aide-integration-archi.js');
const { dodo, connecter, requete, lancer, rejoindre, attendreClients, chargerModules, dossierTemp, supprimerDossier, RACINE } = A;
const R = A.creerRapport('Intégration ARCHI — robustesse : pause complète, bascule réseau, relance, présence, import');
const { ok, eq } = R;

const serveurs = [];
async function demarrer(args, env) { const s = await lancer(args, env); serveurs.push(s); return s; }
const monde = async (port) => (await requete(port, '/api/parties')).json.monde;
const post = (port, chemin, corps) => requete(port, chemin, { corps });
async function attendreActif(port, id) {
  for (let k = 0; k < 200; k++) {
    const r = await requete(port, '/api/parties');
    if (r.json && r.json.actif === id) return true;
    await dodo(100);
  }
  return false;
}
async function arreterSurPort(port) {
  try { const c = await connecter(port); c.envoyer({ t: 'arret' }); await dodo(700); c.fermer(); } catch (e) { /* déjà arrêté */ }
}

// ── SPEC-ARCHI-010 : fourneau et messages d'inventaire gelés en pause ────────
async function scenarioPauseComplete() {
  const d = dossierTemp('mc-archi-rb1-');
  const f = path.join(d, 'monde.json');
  try {
    // un monde avec un fourneau allumé (sable à cuire, bâtons comme combustible)
    fs.writeFileSync(f, JSON.stringify({
      v: 2, graine: 20260921, heure: 60, overrides: [], etats: [], crops: [],
      conteneurs: [{ cle: '3,40,3', type: 'furnace', slots: [[4, 5], [4096, 5], 0], four: { burn: 60, cook: 0 } }],
    }));
    const s = await demarrer(['--port', '0', '--monde', f, '--dossier-parties', d]);
    const a = await rejoindre(s.port, 'Alice', 1);
    const cl = a.client;
    await dodo(1200);
    const m0 = await monde(s.port);
    ok(m0.fours.length === 1, 'SPEC-ARCHI-010 : le fourneau posé est chargé et visible dans l\'instantané');
    await dodo(600);
    const m1 = await monde(s.port);
    ok(m1.fours[0].burn < m0.fours[0].burn || m1.fours[0].cook > m0.fours[0].cook, 'témoin : le fourneau cuit quand le monde tourne', JSON.stringify([m0.fours, m1.fours]));

    cl.envoyer({ t: 'pause', actif: true });
    await cl.attendre('pause_etat', 3000, m => m.actif === true);
    await dodo(200);
    const avant = await monde(s.port);
    const vus = cl.depuis();
    const msgs = [
      { t: 'craft', j: 0, seq: 11, fois: 1 }, { t: 'equip', j: 0, seq: 12, slot: 'casque', i: 0 },
      { t: 'manger', j: 0, seq: 13, id: 4 }, { t: 'inv_lacher', j: 0, seq: 14, i: 0, n: 1 },
      { t: 'inv_creatif', j: 0, seq: 15, i: 0, id: 4, n: 1 }, { t: 'inv_consommer', j: 0, seq: 16, ops: [] },
      { t: 'cont_ouvrir', j: 0, x: 3, y: 40, z: 3 }, { t: 'renaitre', j: 0 },
    ];
    msgs.forEach(m => cl.envoyer(m));
    await dodo(3000);
    const apres = await monde(s.port);
    eq(JSON.stringify(apres.fours), JSON.stringify(avant.fours), 'SPEC-ARCHI-010 : la progression du fourneau est identique 3 s plus tard');
    ok(Math.abs(apres.heure - avant.heure) < 0.02, 'SPEC-ARCHI-010 : l\'heure aussi');
    eq(vus('inv_maj').length, 0, 'SPEC-ARCHI-010 : craft, equip, manger, lâcher, palette, conteneur : aucun n\'est traité en pause (aucun INV_MAJ)');
    eq(vus('cont_etat').length, 0, 'SPEC-ARCHI-010 : ouvrir un conteneur est ignoré en pause');

    cl.envoyer({ t: 'pause', actif: false });
    await cl.attendre('pause_etat', 3000, m => m.actif === false);
    const apresReprise = cl.depuis();
    cl.envoyer({ t: 'manger', j: 0, seq: 21, id: 4 });
    await dodo(800);
    ok(apresReprise('inv_maj').length >= 1, 'témoin : le même message est traité dès la reprise');
    await dodo(1000);
    const fin = await monde(s.port);
    ok(fin.fours[0].burn < avant.fours[0].burn || fin.fours[0].cook > avant.fours[0].cook, 'SPEC-ARCHI-010 : et le fourneau reprend sa cuisson');
    cl.fermer();
    await s.arreter();
  } finally { supprimerDossier(d); }
}

// ── bascule réseau : l'échec ne change rien ──────────────────────────────────
async function scenarioBasculeEchec() {
  const d = dossierTemp('mc-archi-rb2-'), d2 = dossierTemp('mc-archi-rb2b-');
  try {
    const s = await demarrer(['--port', '0', '--dossier-parties', d], { MC_TEST_ECHEC_BASCULE: '1' });
    const a = await rejoindre(s.port, 'Alice', 1);
    a.client.envoyer({ t: 'pause', actif: true });
    await a.client.attendre('pause_etat', 3000, m => m.actif === true);
    const rev0 = (await monde(s.port)).rev;
    a.client.envoyer({ t: 'reseau', ouvert: true });
    const etat = await a.client.attendre('reseau_etat', 5000).catch(() => null);
    eq(etat && etat.etat, 'ferme', 'SPEC-ARCHI-005 : ouverture impossible → RESEAU_ETAT annonce toujours « fermé »');
    const api = (await requete(s.port, '/api/parties')).json;
    eq(api.reseau, 'ferme', 'SPEC-ARCHI-005 : le serveur est resté fermé');
    ok(api.monde.pause === true && api.monde.rev === rev0, 'SPEC-ARCHI-005 : la pause n\'a pas été levée par la tentative ratée');
    ok(!a.client.fermee && s.vivant, 'SPEC-ARCHI-005 : la connexion locale et le processus sont intacts');
    eq((await requete(s.port, '/index.html')).code, 200, 'SPEC-ARCHI-005 : le jeu est toujours servi (liaison restaurée)');
    // l'essai suivant réussit (l'échec simulé est épuisé)
    a.client.envoyer({ t: 'reseau', ouvert: true });
    ok(!!(await a.client.attendre('reseau_etat', 5000, m => m.etat === 'ouvert').catch(() => null)), 'SPEC-ARCHI-005 : l\'ouverture réussit ensuite');
    a.client.fermer();
    await s.arreter();

    // liaison précédente aussi perdue : arrêt propre, monde sauvegardé
    const f = path.join(d2, 'monde.json');
    const s2 = await demarrer(['--port', '0', '--monde', f, '--dossier-parties', d2], { MC_TEST_ECHEC_BASCULE: '2' });
    const b = await rejoindre(s2.port, 'Bob', 1);
    b.client.envoyer({ t: 'reseau', ouvert: true });
    const code = await Promise.race([s2.sortie, dodo(8000).then(() => 'trop long')]);
    eq(code, 0, 'SPEC-ARCHI-005 : si l\'ancienne liaison est aussi perdue, arrêt propre (code 0)');
    ok(fs.existsSync(f), 'SPEC-ARCHI-005 : le monde est sauvegardé avant de s\'arrêter');
  } finally { supprimerDossier(d); supprimerDossier(d2); }
}

// ── supprimer la partie active pendant une sauvegarde en vol ─────────────────
async function scenarioSupprimerPendantSauvegarde() {
  const d = dossierTemp('mc-archi-rb3-');
  const nul = path.join(RACINE, 'null.tmp');
  let port = null;
  try { fs.unlinkSync(nul); } catch (e) { /* absent */ }
  try {
    const s = await demarrer(['--port', '0', '--dossier-parties', d], { MC_TEST_SAUVEGARDE_LENTE_MS: '1200' });
    port = s.port;
    const id = (await post(port, '/api/parties', { nom: 'A supprimer', graine: 77 })).json.partie.id;
    await post(port, '/api/parties/charger', { id });
    ok(await attendreActif(port, id), 'préparation : la partie est active');
    const j = await rejoindre(port, 'Alice', 1);
    const moi = j.bienvenue.toi[0];
    j.client.envoyer({ t: 'bloc', x: Math.floor(moi.x), y: Math.floor(moi.y) + 3, z: Math.floor(moi.z), id: 9 });
    await dodo(300);
    j.client.envoyer({ t: 'pause', actif: true });                    // sauvegarde immédiate, écriture retardée de 1,2 s
    await dodo(300);
    eq((await post(port, '/api/parties/supprimer', { id })).code, 200, 'SPEC-ARCHI-013 : supprimer la partie active pendant l\'écriture');
    await dodo(2500);
    ok(!fs.existsSync(nul), 'SPEC-ARCHI-013 : aucun « null.tmp » n\'est écrit dans le dépôt');
    ok(!fs.existsSync(path.join(d, id + '.json')), 'SPEC-ARCHI-013 : le fichier de la partie supprimée n\'est pas recréé par la sauvegarde en vol');
    eq(fs.readdirSync(d).filter(x => /\.tmp/.test(x)).length, 0, 'SPEC-ARCHI-013 : aucun fichier temporaire ne traîne');
    eq((await requete(port, '/api/parties')).json.parties.length, 0, 'SPEC-ARCHI-013 : l\'index est vide');
    // le serveur sait toujours sauvegarder ensuite (l'indicateur « en cours » est retombé)
    ok((await requete(port, '/api/parties')).code === 200, 'le serveur répond toujours');
    j.client.fermer();
  } finally { if (port) await arreterSurPort(port); await dodo(300); supprimerDossier(d); try { fs.unlinkSync(nul); } catch (e) { /* absent */ } }
}

// ── relance : pause d'attente et jeton admin conservé ────────────────────────
async function scenarioRelance() {
  const d = dossierTemp('mc-archi-rb4-');
  let port = null;
  try {
    const s = await demarrer(['--port', '0', '--dossier-parties', d]);
    port = s.port;
    const ligne = s.logs.find(l => /jeton d'administration généré → /.test(l));
    const jeton = ligne && ligne.split('→ ')[1].trim();
    ok(!!jeton, 'préparation : le jeton généré est journalisé au premier lancement');
    const id = (await post(port, '/api/parties', { nom: 'Relance', graine: 5 })).json.partie.id;
    await post(port, '/api/parties/charger', { id });
    ok(await attendreActif(port, id), 'la partie est active après la relance');
    const m = await monde(port);
    eq(m.pause, true, 'le processus relancé démarre EN PAUSE tant qu\'aucun client n\'est là');
    const rep = await requete(port, '/admin/api/joueurs', { entetes: { Authorization: 'Bearer ' + jeton } });
    ok(rep.code === 200, 'le jeton d\'administration du premier lancement reste valable après la relance', 'code ' + rep.code);
    const j = await rejoindre(port, 'Alice', 1);
    eq(j.bienvenue.pause, false, 'la reconnexion du navigateur lève la pause d\'attente');
    j.client.fermer();
  } finally { if (port) await arreterSurPort(port); await dodo(300); supprimerDossier(d); }
}

// ── une WebSocket muette ne compte pas comme client présent ──────────────────
async function scenarioSocketMuette() {
  const d = dossierTemp('mc-archi-rb5-');
  try {
    const s = await demarrer(['--port', '0', '--dossier-parties', d], { MC_GRACE_ARRET_MS: '2500' });
    // une socket muette AVANT tout client ne déclenche ni pause ni arrêt en partant
    const muette0 = await connecter(s.port); muette0.fermer();
    await attendreClients(s.port, 0);
    eq((await monde(s.port)).pause, false, 'une socket muette qui part n\'arme pas l\'arrêt et ne met pas le monde en pause');
    const a = await rejoindre(s.port, 'Alice', 1);
    const t0 = Date.now();
    a.client.fermer();
    let arret = false;
    const boucle = (async () => { while (Date.now() - t0 < 6000 && s.vivant) { try { (await connecter(s.port)).fermer(); } catch (e) { /* le serveur s'arrête */ } await dodo(400); } })();
    const code = await Promise.race([s.sortie, dodo(6500).then(() => 'trop long')]);
    await boucle;
    arret = code === 0;
    ok(arret, 'des connexions muettes répétées pendant le délai de grâce ne retardent pas l\'arrêt du serveur orphelin', 'code ' + code);
    ok(Date.now() - t0 < 5500, 'l\'arrêt intervient dans le délai prévu (≈ 2,5 s)', (Date.now() - t0) + ' ms');
  } finally { supprimerDossier(d); }
}

// ── un import qui échoue ne laisse rien derrière lui ─────────────────────────
function exportDeuxParties() {
  const MC = chargerModules();
  const m = new Map();
  const st = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
  ['Premiere', 'Seconde'].forEach((nom, i) => {
    const meta = MC.Saves.creer(st, { nom, graine: 900 + i });
    const w = MC.createWorld(900 + i); w.getChunk(0, 0, true);
    const ents = MC.createEntities(w);
    const regles = MC.Modes.regles('survie', 'facile');
    MC.Saves.sauvegarder(st, meta.id, { world: w, player: MC.createPlayer(w, ents, regles), entities: ents, time: 10, furnaces: {}, chests: {}, regles, duree: 1 });
  });
  return MC.PartiesFichier.exporter(st);
}
async function scenarioImportEchec() {
  const d = dossierTemp('mc-archi-rb6-');
  try {
    const exp = exportDeuxParties();
    const idMauvais = exp.parties[0].meta.id;
    fs.mkdirSync(path.join(d, idMauvais + '.json'), { recursive: true });        // le fichier de cette partie ne peut pas s'écrire
    const s = await demarrer(['--port', '0', '--dossier-parties', d]);
    const r = await post(s.port, '/api/parties/importer', exp);
    eq(r.code, 200, 'SPEC-ARCHI-015 : l\'import répond malgré l\'échec d\'une partie');
    ok(r.json.ignorees.some(x => x.id === idMauvais), 'SPEC-ARCHI-015 : la partie dont l\'écriture échoue est signalée', JSON.stringify(r.json.ignorees));
    eq(r.json.importees.length, 1, 'SPEC-ARCHI-015 : l\'autre partie est importée');
    const liste = (await requete(s.port, '/api/parties')).json.parties;
    ok(liste.length === 1 && liste[0].id !== idMauvais, 'SPEC-ARCHI-015 : aucune entrée d\'index pour la partie en échec');
    eq(fs.readdirSync(d).filter(x => /\.tmp/.test(x)).length, 0, 'SPEC-ARCHI-015 : aucun fichier temporaire orphelin');
    await s.arreter();
  } finally { supprimerDossier(d); }
}

(async function () {
  try {
    const tous = { pause: scenarioPauseComplete, bascule: scenarioBasculeEchec, supprimer: scenarioSupprimerPendantSauvegarde, relance: scenarioRelance, muette: scenarioSocketMuette, import: scenarioImportEchec };
    const choix = process.argv[2] ? [process.argv[2]] : Object.keys(tous);
    for (const k of choix) await tous[k]();
  } catch (e) { R.ok(false, 'exception non prévue', (e && e.stack) || String(e)); }
  finally { for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } } }
  process.exit(R.fin());
})();
