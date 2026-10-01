/* integration-archi-succes.js — lot P-SUCC du chantier « solo = serveur toujours
   présent » : SPEC-ARCHI-042. Les SUCCÈS sont suivis et attribués par le
   serveur, pour tous les joueurs (solo fermé, écran partagé, réseau), sur de
   vrais processus server.js lancés sur `--port 0`.

   - casser un bloc débloque « Premier bloc » (SUCCES_DEBLOQUE puis SUCCES_ETAT) ;
     le même geste hors de portée n'attribue rien ;
   - un joueur qui parcourt ~200 blocs voit son compteur de distance à 200 ± 10 ;
   - un succès obtenu n'est jamais renvoyé après rechargement du monde (le
     fichier de monde porte les succès de chaque joueur) ;
   - les succès d'une partie solo importée (extras.succes) sont repris par le
     joueur qui l'adopte, puis retirés des extras ;
   - fabriquer, manger, ouvrir la banque et tuer une créature hostile créditent
     le joueur (CRAFT, MANGER, CONTENEUR_OUVRIR, coup fatal), côté serveur ;
   - la foudre : FOUDROYE, puis « Rescapé » ;
   - un client ne peut s'attribuer aucun succès (messages s→c envoyés au
     serveur, BLOC hors de portée), et deux joueurs ont chacun leurs succès.

   Usage : node tests/integration-archi-succes.js [scenario]
   Scénarios : bloc, distance, rechargement, import, foudre, client, deux, actions, tuer */
'use strict';
const path = require('path');
const fs = require('fs');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre, chargerModules, dossierTemp, supprimerDossier } = A;
const R = A.creerRapport('Intégration ARCHI — P-SUCC : succès arbitrés par le serveur');
const { ok, eq } = R;

const MC = chargerModules();
const DL = MC.DayCycle.DAY_LENGTH;
const GRAINE = 20260921;

const serveurs = [];
async function demarrer(args, env) { const s = await lancer(args, env); serveurs.push(s); return s; }
async function arreterTout() { for (const s of serveurs.splice(0)) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } } }

/* Sondage borné d'une condition (jamais un délai fixe). */
async function attendreQue(cond, ms, pas) {
  const fin = Date.now() + (ms || 8000);
  for (;;) {
    let v; try { v = cond(); } catch (e) { v = false; }
    if (v) return v;
    if (Date.now() > fin) return false;
    await dodo(pas || 40);
  }
}
const toi = (cl, j) => { const e = cl.dernier('etat'); return e && e.toi ? e.toi[j || 0] : null; };
const etatSucces = (cl, j) => { for (let i = cl.messages.length - 1; i >= 0; i--) { const m = cl.messages[i]; if (m.t === 'succes_etat' && m.j === (j || 0)) return m.etat; } return null; };
const debloques = (cl, j) => cl.messages.filter(m => m.t === 'succes_debloque' && m.j === (j || 0)).map(m => m.id);
const aDebloque = (etat, id) => !!etat && etat.debloques.indexOf(id) >= 0;

function fichierMonde(dossier, extra) {
  const f = path.join(dossier, 'monde.json');
  fs.writeFileSync(f, JSON.stringify(Object.assign({ v: 2, graine: GRAINE, heure: DL * 0.3, overrides: [], etats: [], crops: [] }, extra || {})));
  return f;
}
const args = (f, d, plus) => ['--port', '0', '--monde', f, '--dossier-parties', d].concat(plus || []);

/* Un point de terre ferme : la colonne d'apparition du monde, le bloc du sol sous les pieds. */
function terreFerme() {
  const w = MC.createWorld(GRAINE);
  const col = w.findSpawnColumn();
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) w.getChunk(Math.floor(col[0] / 16) + cx, Math.floor(col[1] / 16) + cz, true);
  const sol = w.groundAt(col[0], col[1], true);
  return { x: col[0] + 0.5, y: sol + 1.2, z: col[1] + 0.5, bx: col[0], by: sol, bz: col[1], bloc: w.getBlock(col[0], sol, col[1]) };
}
const ENV = (t, plus) => Object.assign({ MC_TEST_SPAWN: t.x + ',' + t.y + ',' + t.z, MC_MODE: 'survie' }, plus || {});

async function casser(cl, x, y, z, j) {
  cl.envoyer({ t: 'bloc', x, y, z, id: 0, j: j || 0 });
  return cl.attendre('bloc', 3000, m => m.x === x && m.y === y && m.z === z).catch(() => null);
}

// ── casser un bloc ; hors de portée, rien ───────────────────────────────────
async function scenarioBloc() {
  const d = dossierTemp('mc-succes-bloc-');
  try {
    const t = terreFerme();
    const s = await demarrer(args(fichierMonde(d), d), ENV(t));
    const a = await rejoindre(s.port, 'Mineur', 1);
    const e0 = await attendreQue(() => etatSucces(a.client), 4000);
    ok(!!e0 && e0.debloques.length === 0, 'SPEC-ARCHI-042 : à la connexion, le serveur envoie l\'état des succès (vierge)', JSON.stringify(e0));

    // témoin négatif : casser très loin de soi (hors de portée) n'attribue rien
    const loin = await casser(a.client, Math.floor(t.x) + 60, Math.floor(t.y), Math.floor(t.z) + 60);
    ok(!!loin, 'préparation : le serveur a répondu à la casse lointaine (refusée, il rappelle le bloc)');
    const rien = !(await attendreQue(() => debloques(a.client).length > 0, 700));
    ok(rien, 'SPEC-ARCHI-042 : une casse refusée (hors de portée) ne débloque aucun succès');

    const rep = await casser(a.client, t.bx, t.by, t.bz);
    ok(!!rep && rep.id === 0, 'préparation : le bloc sous les pieds est cassé', JSON.stringify(rep));
    const m = await a.client.attendre('succes_debloque', 4000, x => x.id === 'premier_bloc').catch(() => null);
    ok(!!m && m.j === 0, 'SPEC-ARCHI-042 : casser un bloc → SUCCES_DEBLOQUE « premier_bloc » envoyé par le serveur', JSON.stringify(debloques(a.client)));
    const e1 = await attendreQue(() => { const e = etatSucces(a.client); return e && aDebloque(e, 'premier_bloc') ? e : null; }, 4000);
    ok(!!e1, 'SPEC-ARCHI-042 : SUCCES_ETAT reflète le déblocage (compteurs du panneau)');
    // jamais annoncé deux fois
    await casser(a.client, t.bx, t.by - 1, t.bz);
    await attendreQue(() => false, 400);
    eq(debloques(a.client).filter(id => id === 'premier_bloc').length, 1, 'SPEC-ARCHI-042 : « premier_bloc » n\'est annoncé qu\'une fois');
    a.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── distance : l'intégrale des positions autoritatives ──────────────────────
async function scenarioDistance() {
  const d = dossierTemp('mc-succes-dist-');
  try {
    // départ à 112 blocs d'altitude, au-dessus de tout relief : le vol en ligne droite n'est jamais arrêté par une montagne
    const t = Object.assign(terreFerme(), { y: 112 });
    const s = await demarrer(args(fichierMonde(d), d), ENV(t, { MC_MODE: 'creatif' }));
    const a = await rejoindre(s.port, 'Voyageur', 1);
    await attendreQue(() => toi(a.client), 4000);
    const p0 = toi(a.client);
    // vol en ligne droite (créatif : 12 blocs/s) jusqu'à ~200 blocs du départ
    let sq = 1, p = p0;
    const fin = Date.now() + 90000, t0 = Date.now();
    while (Date.now() < fin) {
      a.client.envoyer({ t: A.NP.MSG.ENTREE, s: sq++, j: 0, dt: 0.05, k: 1, yaw: 0.7, pitch: 0, v: 1 });
      await dodo(50);
      p = toi(a.client) || p;
      if (Math.hypot(p.x - p0.x, p.y - p0.y, p.z - p0.z) >= 200) break;
    }
    const parcouru = Math.hypot(p.x - p0.x, p.y - p0.y, p.z - p0.z);
    ok(parcouru >= 200, 'préparation : le joueur s\'est éloigné d\'au moins 200 blocs', 'parcouru ' + parcouru.toFixed(1));
    // le compteur rattrape le joueur immobile : dernier échantillon (≤ 1 s) puis envoi des compteurs (≤ 2 s)
    let valeur = 0;
    const proche = await attendreQue(() => { const e = etatSucces(a.client); valeur = e && e.compte.cinq_mille_blocs || 0; return Math.abs(valeur - parcouru) <= 10; }, 10000, 40);
    ok(proche, 'SPEC-ARCHI-042 : le compteur de distance vaut ' + parcouru.toFixed(0) + ' ± 10 blocs (intégrale des positions du serveur)', 'compteur ' + valeur + ', parcouru ' + parcouru.toFixed(1));
    ok(!aDebloque(etatSucces(a.client), 'cinq_mille_blocs'), 'témoin : 200 blocs ne débloquent pas « Grand voyageur » (5000)');
    ok(aDebloque(etatSucces(a.client), 'haute_altitude'), "SPEC-ARCHI-042 : l'altitude (au-dessus de 100) est échantillonnée sur la position du serveur : « Prise d'altitude »");
    a.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── rechargement : un succès n'est jamais renvoyé ────────────────────────────
async function scenarioRechargement() {
  const d = dossierTemp('mc-succes-rel-');
  try {
    const t = terreFerme();
    const f = fichierMonde(d);
    let s = await demarrer(args(f, d), ENV(t));
    let a = await rejoindre(s.port, 'Fidele', 1);
    await attendreQue(() => etatSucces(a.client), 4000);
    await casser(a.client, t.bx, t.by, t.bz);
    ok(!!(await a.client.attendre('succes_debloque', 4000, x => x.id === 'premier_bloc').catch(() => null)), 'préparation : « premier_bloc » obtenu');
    a.client.fermer();
    await s.arreter();
    const fichier = JSON.parse(fs.readFileSync(f, 'utf8'));
    const rec = (fichier.joueurs || []).map(e => e[1]).find(r => r && r.succes);
    ok(!!rec && rec.succes.debloques.indexOf('premier_bloc') >= 0, 'SPEC-ARCHI-042 : le fichier de monde porte les succès du joueur', JSON.stringify(rec && rec.succes));

    // même nom, même fichier : l'état revient, aucune annonce
    s = await demarrer(args(f, d), ENV(t));
    a = await rejoindre(s.port, 'Fidele', 1);
    const e = await attendreQue(() => etatSucces(a.client), 4000);
    ok(aDebloque(e, 'premier_bloc'), 'SPEC-ARCHI-042 : après rechargement, SUCCES_ETAT redonne « premier_bloc »', JSON.stringify(e));
    await casser(a.client, t.bx, t.by - 1, t.bz);
    await attendreQue(() => false, 600);
    eq(debloques(a.client).length, 0, 'SPEC-ARCHI-042 : un succès déjà obtenu n\'est jamais renvoyé après rechargement');
    a.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── import d'une partie solo : extras.succes repris par le joueur ───────────
async function scenarioImport() {
  const d = dossierTemp('mc-succes-imp-');
  try {
    const t = terreFerme();
    const SLOTS = MC.ContratsV2.BORNES.SLOTS_INV;
    const f = fichierMonde(d, {
      soloJoueur: { v: 1, inv: new Array(SLOTS).fill(0), equip: {}, etat: { hp: 20, hunger: 20, air: 10 } },
      extras: { explores: [], succes: { compte: { vingt_repas: 7 }, debloques: ['premiere_ville'] } },
    });
    const s = await demarrer(args(f, d), ENV(t));
    const a = await rejoindre(s.port, 'Ancien', 1);
    const e = await attendreQue(() => etatSucces(a.client), 4000);
    ok(aDebloque(e, 'premiere_ville') && e.compte.vingt_repas === 7, 'SPEC-ARCHI-042 : les succès d\'un solo importé sont repris par le joueur qui l\'adopte', JSON.stringify(e));
    a.client.fermer();
    await s.arreter();
    const fichier = JSON.parse(fs.readFileSync(f, 'utf8'));
    ok(!fichier.extras || !fichier.extras.succes, 'SPEC-ARCHI-014 : extras.succes est retiré une fois adopté (une seule source de vérité)', JSON.stringify(fichier.extras));
    const rec = (fichier.joueurs || []).map(x => x[1]).find(r => r && r.succes);
    ok(!!rec && rec.succes.debloques.indexOf('premiere_ville') >= 0 && rec.succes.compte.vingt_repas === 7, 'SPEC-ARCHI-014 : ils vivent désormais dans l\'enregistrement du joueur', JSON.stringify(rec && rec.succes));
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── foudre : FOUDROYE puis « Rescapé » ───────────────────────────────────────
async function scenarioFoudre() {
  const d = dossierTemp('mc-succes-foudre-');
  try {
    const t = terreFerme();
    const s = await demarrer(args(fichierMonde(d), d), ENV(t, { MC_TEST_ECLAIR: '1' }));
    const a = await rejoindre(s.port, 'Foudroye', 1);
    const f = await a.client.attendre('foudroye', 12000).catch(() => null);
    ok(!!f && f.j === 0, 'SPEC-ARCHI-042 : le serveur annonce FOUDROYE au joueur touché', JSON.stringify(f));
    const m = await a.client.attendre('succes_debloque', 4000, x => x.id === 'foudroye_vivant').catch(() => null);
    ok(!!m, 'SPEC-ARCHI-042 : survivre à la foudre débloque « Rescapé » côté serveur');
    a.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── un client ne peut s'attribuer aucun succès ───────────────────────────────
async function scenarioClient() {
  const d = dossierTemp('mc-succes-cli-');
  try {
    const t = terreFerme();
    const s = await demarrer(args(fichierMonde(d), d), ENV(t));
    const a = await rejoindre(s.port, 'Tricheur', 1);
    await attendreQue(() => etatSucces(a.client), 4000);
    // messages du serveur envoyés par le client, événements inventés : tous ignorés
    ['succes_debloque', 'succes_etat', 'foudroye', 'succes', 'signaler'].forEach(type => {
      a.client.envoyer({ t: type, j: 0, id: 'premier_bloc', type: 'casser', bloc: 1, etat: { compte: {}, debloques: ['premier_bloc', 'cinq_mille_blocs'] } });
    });
    a.client.envoyer({ t: 'bloc', x: Math.floor(t.x) + 90, y: Math.floor(t.y), z: Math.floor(t.z), id: 0, j: 0 });
    a.client.envoyer({ t: 'manger', j: 0, id: 99999, i: 0 });
    const vu = await attendreQue(() => debloques(a.client).length > 0, 1200);
    ok(!vu, 'SPEC-ARCHI-042 : aucun message client ne débloque un succès (le serveur seul arbitre)', JSON.stringify(debloques(a.client)));
    // le serveur est resté vivant et son état est intact : une casse légitime fonctionne ensuite
    await casser(a.client, t.bx, t.by, t.bz);
    ok(!!(await a.client.attendre('succes_debloque', 4000, x => x.id === 'premier_bloc').catch(() => null)), 'témoin : une vraie casse débloque bien « premier_bloc » après ces tentatives');
    ok(!aDebloque(etatSucces(a.client), 'cinq_mille_blocs'), 'SPEC-ARCHI-042 : « Grand voyageur » jamais attribué à la demande d\'un client');
    a.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── deux joueurs locaux : chacun les siens (écran partagé) ───────────────────
async function scenarioDeux() {
  const d = dossierTemp('mc-succes-deux-');
  try {
    const t = terreFerme();
    const s = await demarrer(args(fichierMonde(d), d), ENV(t));
    const a = await rejoindre(s.port, 'Duo', 2);
    await attendreQue(() => etatSucces(a.client, 0) && etatSucces(a.client, 1), 4000);
    ok(!!etatSucces(a.client, 0) && !!etatSucces(a.client, 1), 'SPEC-ARCHI-042 : écran partagé, un SUCCES_ETAT par joueur local');
    await casser(a.client, t.bx, t.by, t.bz, 1);
    const m = await a.client.attendre('succes_debloque', 4000, x => x.id === 'premier_bloc').catch(() => null);
    ok(!!m && m.j === 1, 'SPEC-ARCHI-042 : le succès va au joueur local qui a cassé (j = 1)', JSON.stringify(m));
    await attendreQue(() => false, 400);
    ok(!aDebloque(etatSucces(a.client, 0), 'premier_bloc') && aDebloque(etatSucces(a.client, 1), 'premier_bloc'), 'SPEC-ARCHI-042 : le joueur 0 n\'hérite pas du succès du joueur 1');
    a.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── fabriquer, manger, ouvrir la banque : décidés par le serveur ─────────────
async function scenarioActions() {
  const d = dossierTemp('mc-succes-act-');
  try {
    const B = MC.Core.B, I = MC.Core.I;
    const t = terreFerme();
    const SLOTS = MC.ContratsV2.BORNES.SLOTS_INV;
    const inv = new Array(SLOTS).fill(0);
    inv[0] = [B.PLANKS, 3]; inv[1] = [I.STICK, 2]; inv[2] = [I.BREAD, 4];
    const f = fichierMonde(d, { soloJoueur: { v: 1, inv, equip: {}, etat: { hp: 20, hunger: 8, air: 10 } } });
    const s = await demarrer(args(f, d), ENV(t));
    const a = await rejoindre(s.port, 'Artisan', 1);
    const pile = (c) => (c && c !== 0) ? { id: c[0], n: c[1] } : null;
    await a.client.attendre('inv_maj', 4000);
    let seq = 0;
    async function verser(id, cases) {
      for (const g of cases) {
        const majI = a.client.messages.filter(m => m.t === 'inv_maj').pop();
        const i = majI.inv.findIndex(c => { const p = pile(c); return p && p.id === id; });
        a.client.envoyer({ t: 'cont_transfert', j: 0, seq: ++seq, de: { z: 'inv', i }, vers: { z: 'grille', i: g }, n: 1 });
        await a.client.attendre('inv_maj', 4000, m => m.ack === seq);
      }
    }
    // fabriquer une pioche en bois : « Premier outil »
    await verser(B.PLANKS, [0, 1, 2]);
    await verser(I.STICK, [4, 7]);
    a.client.envoyer({ t: 'craft', j: 0, seq: ++seq, fois: 1 });
    ok(!!(await a.client.attendre('succes_debloque', 4000, x => x.id === 'premier_outil').catch(() => null)), 'SPEC-ARCHI-042 : fabriquer un outil (CRAFT validé) → « premier_outil » décidé par le serveur', JSON.stringify(debloques(a.client)));
    // manger : le compteur « Bon appétit » avance d'un
    a.client.envoyer({ t: 'manger', j: 0, seq: ++seq, id: I.BREAD });
    const e1 = await attendreQue(() => { const e = etatSucces(a.client); return e && e.compte.vingt_repas === 1 ? e : null; }, 5000);
    ok(!!e1, 'SPEC-ARCHI-042 : manger (MANGER accepté) fait avancer « Bon appétit » à 1', JSON.stringify(etatSucces(a.client)));
    // la banque : un coffre-fort posé près du joueur, ouvert par CONTENEUR_OUVRIR
    // (première case libre autour du joueur : le serveur refuse de poser dans un arbre ou une pierre)
    let pose = null;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
      const bx = Math.floor(t.x) + dx, by = Math.floor(t.y), bz = Math.floor(t.z) + dz;
      const n0 = a.client.messages.length;
      a.client.envoyer({ t: 'bloc', x: bx, y: by, z: bz, id: B.COFFRE_FORT, j: 0, i: 0 });
      const rep = await a.client.attendre('bloc', 3000, m => a.client.messages.indexOf(m) >= n0 && m.x === bx && m.y === by && m.z === bz);
      if (rep.id === B.COFFRE_FORT) { pose = { x: bx, y: by, z: bz }; break; }
    }
    ok(!!pose, 'préparation : un coffre-fort est posé près du joueur');
    a.client.envoyer({ t: 'cont_ouvrir', j: 0, x: pose.x, y: pose.y, z: pose.z });
    ok(!!(await a.client.attendre('succes_debloque', 4000, x => x.id === 'banque_ouverte').catch(() => null)), 'SPEC-ARCHI-042 : ouvrir la banque → « banque_ouverte » décidé par le serveur');
    a.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

// ── tuer : le coup fatal crédite son auteur (événement `mort` du serveur) ────
async function scenarioTuer() {
  const d = dossierTemp('mc-succes-tuer-');
  try {
    const I = MC.Core.I;
    const t = terreFerme();
    const SLOTS = MC.ContratsV2.BORNES.SLOTS_INV;
    const inv = new Array(SLOTS).fill(0);
    inv[0] = [I.IRON_SWORD, 1];
    const f = fichierMonde(d, { soloJoueur: { v: 1, inv, equip: {}, etat: { hp: 20, hunger: 20, air: 10 } } });
    const s = await demarrer(args(f, d), ENV(t, { MC_MODE: 'creatif', MC_TEST_MOBS: JSON.stringify([['zombie', 1.5, 0]]) }));
    const a = await rejoindre(s.port, 'Chasseur', 1);
    await a.client.attendre('inv_maj', 4000);
    const zombies = () => { const e = a.client.dernier('etat'); return e ? e.mobs.filter(m => m.t === 'zombie') : []; };
    const proche = await attendreQue(() => zombies()[0], 6000);
    ok(!!proche, 'préparation : un zombie est apparu près du joueur');
    if (proche) {
      let compte = 0;
      for (let essai = 0; essai < 60 && !compte; essai++) {
        const z = zombies()[0], moi = toi(a.client);
        if (z && moi && Math.hypot(z.x - moi.x, z.z - moi.z) < 5) a.client.envoyer({ t: 'attaque', eid: z.e, degats: 12, j: 0, i: 0 });
        compte = await attendreQue(() => { const e = etatSucces(a.client); return e && e.compte.dix_hostiles; }, 450, 40);
      }
      ok(compte === 1, 'SPEC-ARCHI-042 : tuer une créature hostile → « Chasseur » avance d\'un (crédit à l\'auteur du coup fatal)', JSON.stringify(etatSucces(a.client)));
    }
    a.client.fermer();
    await s.arreter();
  } finally { await arreterTout(); supprimerDossier(d); }
}

const SCENARIOS = { bloc: scenarioBloc, distance: scenarioDistance, rechargement: scenarioRechargement,
                    import: scenarioImport, foudre: scenarioFoudre, client: scenarioClient, deux: scenarioDeux,
                    actions: scenarioActions, tuer: scenarioTuer };

(async () => {
  const demande = process.argv[2];
  const liste = demande ? [demande] : Object.keys(SCENARIOS);
  for (const nom of liste) {
    if (!SCENARIOS[nom]) { console.log('scénario inconnu : ' + nom); process.exit(2); }
    try { await SCENARIOS[nom](); }
    catch (e) { R.ok(false, 'scénario « ' + nom + ' » : exception', e && e.stack || String(e)); }
    finally { await arreterTout(); }
  }
  process.exit(R.fin());
})();
