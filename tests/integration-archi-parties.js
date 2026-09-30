/* integration-archi-parties.js — chantier ARCHI (L50), lot A0 : les parties
   vivent sur le disque, côté serveur (SPEC-ARCHI-013), l'import des parties
   solo existantes (SPEC-ARCHI-015) et la persistance du joueur qui en découle
   (SPEC-ARCHI-014), sur de vrais processus `server.js`.

   Usage : node tests/integration-archi-parties.js */
'use strict';
const path = require('path');
const fs = require('fs');
const A = require('./aide-integration-archi.js');
const { dodo, connecter, requete, lancer, rejoindre, attendreClients, chargerModules, dossierTemp, supprimerDossier } = A;
const R = A.creerRapport('Intégration ARCHI — parties sur disque, import, parité (SPEC-ARCHI-013, 014, 015)');
const { ok, eq } = R;

const serveurs = [];
async function demarrer(args, env) { const s = await lancer(args, env); serveurs.push(s); return s; }
const post = (port, chemin, corps) => requete(port, chemin, { corps });

/* Après POST /charger, le serveur se relance sur la partie : on attend que
   l'API réponde de nouveau avec `actif` === id. Le processus enfant s'arrête
   de lui-même 10 s après le dernier client : il faut donc se connecter vite. */
async function attendreActif(port, id, ms) {
  const fin = Date.now() + (ms || 20000);
  while (Date.now() < fin) {
    const r = await requete(port, '/api/parties');
    if (r.json && r.json.actif === id) return true;
    await dodo(100);
  }
  return false;
}
async function arreterSurPort(port) {
  try {
    const c = await connecter(port);
    c.envoyer({ t: 'arret' });
    await dodo(600);
    c.fermer();
  } catch (e) { /* déjà arrêté */ }
}

// ── 013 : créer, charger, poser, changer de partie, revenir, supprimer ───────
async function scenarioParties() {
  const dossier = dossierTemp('mc-archi-pa-');
  let port = null;
  try {
    const s = await demarrer(['--port', '0', '--dossier-parties', dossier]);
    port = s.port;
    const l0 = await requete(port, '/api/parties');
    eq(l0.json.parties.length, 0, 'SPEC-ARCHI-013 : au premier lancement la liste des parties est vide');
    const a = await post(port, '/api/parties', { nom: 'Alpha', mode: 'survie', difficulte: 'facile', graine: 1111 });
    const b = await post(port, '/api/parties', { nom: 'Beta', mode: 'creatif', difficulte: 'facile', graine: 2222 });
    eq(a.code, 201, 'SPEC-ARCHI-013 : créer une partie par l\'API (201)');
    const idA = a.json.partie.id, idB = b.json.partie.id;
    ok(idA !== idB && a.json.partie.graine === 1111 && b.json.partie.mode === 'creatif', 'SPEC-ARCHI-013 : nom, mode, difficulté et graine sont mémorisés dans l\'index');
    ok(fs.existsSync(path.join(dossier, 'index.json')), 'SPEC-ARCHI-013 : un index léger est écrit sur disque (métadonnées seules)');
    const index = JSON.parse(fs.readFileSync(path.join(dossier, 'index.json'), 'utf8'));
    ok(Array.isArray(index) && index.length === 2 && index.every(m => !('overrides' in m)), 'SPEC-ARCHI-013 : l\'index ne contient que des métadonnées');
    eq((await post(port, '/api/parties/renommer', { id: idB, nom: 'Bêta 2' })).json.partie.nom, 'Bêta 2', 'SPEC-ARCHI-013 : renommer une partie');
    eq((await post(port, '/api/parties/charger', { id: 'inexistante' })).code, 404, 'SPEC-ARCHI-013 : charger une partie inconnue → 404');
    eq((await post(port, '/api/parties/charger', { id: '../../x' })).code, 404, 'SPEC-ARCHI-013 : un identifiant en chemin est refusé (404)');

    // charger A (le serveur se relance sur la partie, même port, même mode)
    const chg = await post(port, '/api/parties/charger', { id: idA });
    ok(chg.json.ok && chg.json.relance, 'SPEC-ARCHI-013 : charger la partie A relance le serveur sur A');
    ok(await attendreActif(port, idA), 'SPEC-ARCHI-013 : le serveur revient sur le même port avec A active');
    const ja = await rejoindre(port, 'Alice', 1);
    eq(ja.bienvenue.graine, 1111, 'SPEC-ARCHI-013 : le monde chargé est celui de la partie A (graine)');
    eq(ja.bienvenue.partie && ja.bienvenue.partie.id, idA, 'SPEC-ARCHI-013 : BIENVENUE nomme la partie chargée');
    const moi = ja.bienvenue.toi[0];
    const BX = Math.floor(moi.x), BY = Math.floor(moi.y) + 3, BZ = Math.floor(moi.z);
    ja.client.envoyer({ t: 'bloc', x: BX, y: BY, z: BZ, id: 9 });
    await ja.client.attendre('bloc', 3000);
    // « retour au menu » : la pause écrit le monde tout de suite dans le fichier de A
    ja.client.envoyer({ t: 'pause', actif: true });
    const fichierA = path.join(dossier, idA + '.json');
    for (let k = 0; k < 40 && !fs.existsSync(fichierA); k++) await dodo(50);
    ok(fs.existsSync(fichierA), 'SPEC-ARCHI-013 : un fichier de monde par partie (<id>.json)');
    const contenuA = fs.existsSync(fichierA) ? JSON.parse(fs.readFileSync(fichierA, 'utf8')) : {};
    ok((contenuA.overrides || []).some(o => o[0] === BX && o[1] === BY && o[2] === BZ && o[3] === 9), 'SPEC-ARCHI-013 : le bloc posé est dans le fichier de A');
    ok(!fs.existsSync(path.join(dossier, idB + '.json')), 'SPEC-ARCHI-013 : la partie B (jamais jouée) n\'a pas de fichier de monde');

    // charger B : le bloc n'y est pas
    const chgB = await post(port, '/api/parties/charger', { id: idB });
    ok(chgB.json.relance, 'SPEC-ARCHI-013 : charger B décharge A (sauvegardée) et relance sur B');
    ok(await attendreActif(port, idB), 'SPEC-ARCHI-013 : B est active');
    const jb = await rejoindre(port, 'Alice', 1);
    eq(jb.bienvenue.graine, 2222, 'SPEC-ARCHI-013 : le monde chargé est celui de B (graine)');
    eq(jb.bienvenue.mode, 'creatif', 'SPEC-ARCHI-013 : le mode de B (créatif) est appliqué');
    ok(!jb.bienvenue.blocs.some(o => o[3] === 9 && o[0] === BX && o[1] === BY && o[2] === BZ), 'SPEC-ARCHI-013 : le bloc de A n\'est pas dans le monde de B');
    jb.client.envoyer({ t: 'pause', actif: true });
    await dodo(400);

    // revenir à A : le bloc est là
    await post(port, '/api/parties/charger', { id: idA });
    ok(await attendreActif(port, idA), 'SPEC-ARCHI-013 : retour à A');
    const jc = await rejoindre(port, 'Alice', 1);
    let dansBienvenue = jc.bienvenue.blocs.some(o => o[0] === BX && o[1] === BY && o[2] === BZ && o[3] === 9);
    ok(dansBienvenue, 'SPEC-ARCHI-013 : A → B → A : le bloc posé dans A est retrouvé');

    // supprimer : index ET fichier
    eq((await post(port, '/api/parties/supprimer', { id: idB })).code, 200, 'SPEC-ARCHI-013 : supprimer B');
    const l1 = (await requete(port, '/api/parties')).json;
    ok(l1.parties.length === 1 && l1.parties[0].id === idA, 'SPEC-ARCHI-013 : supprimer retire l\'entrée de l\'index');
    ok(!fs.existsSync(path.join(dossier, idB + '.json')), 'SPEC-ARCHI-013 : et le fichier de monde de la partie');
    ok(fs.existsSync(fichierA), 'SPEC-ARCHI-013 : sans toucher aux autres parties');
    // supprimer la partie active : plus rien ne se sauvegarde
    eq((await post(port, '/api/parties/supprimer', { id: idA })).code, 200, 'SPEC-ARCHI-013 : supprimer la partie active');
    ok(!fs.existsSync(fichierA), 'SPEC-ARCHI-013 : son fichier disparaît aussi');
    jc.client.envoyer({ t: 'pause', actif: true });
    await dodo(600);
    ok(!fs.existsSync(fichierA), 'SPEC-ARCHI-013 : et n\'est pas recréé par une sauvegarde ultérieure');
    jc.client.fermer();
  } finally {
    if (port) await arreterSurPort(port);
    await dodo(300);
    supprimerDossier(dossier);
  }
}

// ── 015 + 014 : importer des parties solo, les jouer, les sauvegarder ────────
function fabriquerExport() {
  const MC = chargerModules();
  const st = (function () {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
  })();
  const B = MC.Core.B, I = MC.Core.I;
  function partie(nom, graine, mode) {
    const meta = MC.Saves.creer(st, { nom, graine, mode, difficulte: 'difficile' });
    const w = MC.createWorld(graine);
    w.getChunk(0, 0, true);
    const ents = MC.createEntities(w);
    const regles = MC.Modes.regles(mode, 'difficile');
    const pl = MC.createPlayer(w, ents, regles);
    w.setBlock(2, 40, 2, B.BRICK);
    w.setBlock(3, 40, 2, B.CHEST);
    const p = pl.state;
    p.pos.x = 12.5; p.pos.y = 60; p.pos.z = -7.25; p.yaw = 1.25; p.hp = 14; p.hunger = 9;
    p.inv.add(I.STICK, 5);
    const coffre = MC.Inventory.create(27);
    coffre.add(I.STICK, 7);
    const etat = { world: w, player: pl, entities: ents, time: 250, furnaces: {}, chests: { '3,40,2': coffre }, regles, duree: 321,
                   succes: { serialiser: () => ({ debloques: ['premier_pas'], compteurs: { pas: 12 } }) } };
    MC.Saves.sauvegarder(st, meta.id, etat);
    return meta;
  }
  const a = partie('Solo A', 987654, 'survie');
  const b = partie('Solo B', 424242, 'creatif');
  const c = MC.Saves.creer(st, { nom: 'Corrompue', graine: 5 });
  st.setItem(MC.Saves.slotKey(c.id), '{"slotV":2,"v":3,"seed"');
  return { exp: MC.PartiesFichier.exporter(st), a, b, c };
}
async function scenarioImport() {
  const dossier = dossierTemp('mc-archi-im-');
  let port = null;
  try {
    const { exp, a, b, c } = fabriquerExport();
    const s = await demarrer(['--port', '0', '--dossier-parties', dossier]);
    port = s.port;
    const r = await post(port, '/api/parties/importer', exp);
    eq(r.code, 200, 'SPEC-ARCHI-015 : POST /api/parties/importer répond 200');
    eq(r.json.importees.length, 2, 'SPEC-ARCHI-015 : deux parties importées sur trois');
    ok(r.json.ignorees.length === 1 && r.json.ignorees[0].id === c.id, 'SPEC-ARCHI-015 : la partie corrompue est signalée', JSON.stringify(r.json.ignorees));
    const liste = (await requete(port, '/api/parties')).json.parties;
    eq(liste.length, 2, 'SPEC-ARCHI-015 : 2 parties dans l\'index');
    const fichiers = fs.readdirSync(dossier).filter(f => f !== 'index.json' && f.endsWith('.json'));
    eq(fichiers.length, 2, 'SPEC-ARCHI-015 : 2 fichiers de monde');
    const ia = liste.find(m => m.id === a.id);
    ok(ia && ia.graine === 987654 && ia.mode === 'survie' && ia.nom === 'Solo A' && ia.duree === 321, 'SPEC-ARCHI-015 : id, nom, mode, graine et durée conservés dans l\'index', JSON.stringify(ia));
    ok(liste.find(m => m.id === b.id).mode === 'creatif', 'SPEC-ARCHI-015 : le mode créatif de la seconde est conservé');
    eq((await post(port, '/api/parties/importer', { format: 'autre' })).code, 400, 'SPEC-ARCHI-015 : un fichier qui n\'est pas un export est refusé (400)');
    const r2 = await post(port, '/api/parties/importer', exp);
    ok(r2.json.importees.every(id => id !== a.id && id !== b.id), 'SPEC-ARCHI-015 : réimporter ne remplace jamais une partie existante (nouveaux identifiants)');
    eq((await requete(port, '/api/parties')).json.parties.length, 4, 'SPEC-ARCHI-015 : les deux copies coexistent');

    // jouer la partie importée : position, inventaire, graine à l'identique
    const chg = await post(port, '/api/parties/charger', { id: a.id });
    ok(chg.json.relance, 'SPEC-ARCHI-015 : charger la partie importée');
    ok(await attendreActif(port, a.id), 'SPEC-ARCHI-015 : elle devient active');
    const j = await rejoindre(port, 'Alice', 1);
    eq(j.bienvenue.graine, 987654, 'SPEC-ARCHI-015 : la graine est celle de la partie solo');
    const t = j.bienvenue.toi[0];
    ok(Math.abs(t.x - 12.5) < 0.01 && Math.abs(t.z + 7.25) < 0.01, 'SPEC-ARCHI-015 : la position du joueur solo est restituée', t.x + ',' + t.z);
    ok(t.pv === 14 && t.faim === 9, 'SPEC-ARCHI-014 : vie et faim restituées', 'pv ' + t.pv + ' faim ' + t.faim);
    const inv = await j.client.attendre('inv_maj', 3000);
    const piles = (inv.inv || []).filter(Boolean);
    ok(piles.some(p => p[1] === 5), 'SPEC-ARCHI-015 : l\'inventaire du joueur solo est restitué (5 bâtons)', JSON.stringify(inv.inv).slice(0, 200));
    ok(j.bienvenue.blocs.some(o => o[0] === 2 && o[1] === 40 && o[2] === 2), 'SPEC-ARCHI-015 : les blocs posés sont restitués');

    // 014 : sauvegarde du serveur → tout ce qui n'est pas encore joué est conservé tel quel
    j.client.envoyer({ t: 'pause', actif: true });
    const fichier = path.join(dossier, a.id + '.json');
    await dodo(900);
    const f = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    ok(f.extras && f.extras.succes && f.extras.succes.debloques[0] === 'premier_pas', 'SPEC-ARCHI-014 : les succès du solo survivent à la sauvegarde du serveur');
    ok(f.conteneurs.some(c2 => c2.cle === '3,40,2' && c2.type === 'chest' && c2.slots[0] && c2.slots[0][1] === 7), 'SPEC-ARCHI-014 : le coffre et son contenu survivent');
    ok(f.soloJoueur === null || f.soloJoueur === undefined, 'SPEC-ARCHI-014 : le joueur solo a été adopté (il n\'est plus en attente)');
    ok(f.joueurs.some(([, rec]) => rec.etat && Math.abs(rec.etat.x - 12.5) < 1), 'SPEC-ARCHI-014 : sa position est écrite dans son enregistrement (SYNC-020)');
    j.client.fermer();
  } finally {
    if (port) await arreterSurPort(port);
    await dodo(300);
    supprimerDossier(dossier);
  }
}

// ── 014 : la persistance du joueur survit à un arrêt/relance du serveur ───────
async function scenarioJoueur() {
  const dossier = dossierTemp('mc-archi-jo-');
  const f = path.join(dossier, 'monde.json');
  try {
    const args = ['--port', '0', '--ouvert', '--monde', f, '--dossier-parties', dossier];
    const s = await demarrer(args, { MC_TEST_INV: '[[4,12]]' });
    const a = await rejoindre(s.port, 'Zed', 1);
    for (let i = 1; i <= 90; i++) { a.client.envoyer({ t: 'e', s: i, j: 0, dt: 0.016, k: 1, yaw: 0.5, pitch: 0.2, v: 0 }); await dodo(16); }
    await dodo(400);
    const avant = a.client.dernier('etat').toi[0];
    a.client.fermer();
    await attendreClients(s.port, 0);
    // même processus : reconnexion sous le même nom
    const b = await rejoindre(s.port, 'Zed', 1);
    const invB = await b.client.attendre('inv_maj', 3000);
    ok((invB.inv || []).some(p => p && p[0] === 4 && p[1] === 12), 'SPEC-ARCHI-014 : reconnexion — l inventaire est restitué');
    const t = b.bienvenue.toi[0];
    ok(Math.hypot(t.x - avant.x, t.z - avant.z) < 0.05, 'SPEC-ARCHI-014 : reconnexion — la position est celle laissée', `${avant.x},${avant.z} → ${t.x},${t.z}`);
    b.client.fermer();
    await attendreClients(s.port, 0);
    await s.arreter();                                   // arrêt propre : sauvegarde synchrone
    // relance sur le même fichier
    const s2 = await demarrer(args, { MC_TEST_INV: '[[4,12]]' });
    const c = await rejoindre(s2.port, 'Zed', 1);
    const t2 = c.bienvenue.toi[0];
    ok(Math.hypot(t2.x - avant.x, t2.z - avant.z) < 0.05, 'SPEC-ARCHI-014 : après arrêt et relance, la position est restituée', `${avant.x},${avant.z} → ${t2.x},${t2.z}`);
    const invC = await c.client.attendre('inv_maj', 3000);
    ok((invC.inv || []).some(p => p && p[0] === 4 && p[1] === 12), 'SPEC-ARCHI-014 : après arrêt et relance, l inventaire est restitué', JSON.stringify(invC.inv).slice(0, 120));
    c.client.fermer();
    await s2.arreter();
  } finally { supprimerDossier(dossier); }
}

(async function () {
  try {
    const tous = { parties: scenarioParties, import: scenarioImport, joueur: scenarioJoueur };
    const choix = process.argv[2] ? [process.argv[2]] : Object.keys(tous);
    for (const k of choix) await tous[k]();            // en série : chaque bascule de partie relance un processus
  } catch (e) {
    R.ok(false, 'exception non prévue', (e && e.stack) || String(e));
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
