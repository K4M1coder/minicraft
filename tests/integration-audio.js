/* integration-audio.js — SPEC-AUDIO-002 et 005 sur un vrai processus
   server.js : les sons que seul le serveur connaît lui sont confiés (message
   SONS) — une créature blessée, tuée, qui attaque ; un gardien de donjon qui
   s'éveille. Le relevé de l'ATTAQUE d'une créature dans le journal
   d'entities.js et le filtrage par distance (NP.sonsPour) sont testés purs
   dans tests/spec-audio.js : ils empruntent ensuite exactement le même
   chemin (serveur-tic.js, diffuserSons) que la blessure et la mort vérifiées ici.

   Usage : node tests/integration-audio.js */
'use strict';
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre } = A;
const R = A.creerRapport('Intégration AUDIO — sons décidés par le serveur (SONS)');
const { ok } = R;

const MC = A.chargerModules();
const I = MC.Core.I;
const serveurs = [];
async function demarrer(env) {
  const s = await lancer(['--port', '0'], env);
  serveurs.push(s);
  return s;
}
const SANS_POSE_LIBRE = { MC_TEST_POSE_LIBRE: '' };

async function jusqua(lire, ms, pas) {
  const fin = Date.now() + (ms || 5000);
  for (;;) {
    const v = lire();
    if (v) return v;
    if (Date.now() > fin) return null;
    await dodo(pas || 40);
  }
}
/* Un terrain plat de 9 x 9 blocs près du point d'apparition (même graine que
   le serveur) : la créature posée à côté du joueur ne tombe nulle part. */
function terrainPlat() {
  const w = MC.createWorld(20260921);
  const col = w.findSpawnColumn();
  const solide = (x, y, z) => MC.Core.isSolid(w.getBlock(x, y, z));
  for (let r = 0; r <= 80; r += 4) {
    for (let a = 0; a < (r ? 8 : 1); a++) {
      const cx = Math.round(col[0] + r * Math.cos(a * Math.PI / 4)), cz = Math.round(col[1] + r * Math.sin(a * Math.PI / 4));
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) w.getChunk(Math.floor((cx + dx) / 16), Math.floor((cz + dz) / 16), true);
      const y0 = Math.floor(w.groundAt(cx, cz, true) + 1.2);
      let plat = true;
      for (let dx = -4; dx <= 4 && plat; dx++) for (let dz = -4; dz <= 4 && plat; dz++) {
        const x = cx + dx, z = cz + dz;
        if (!solide(x, y0 - 1, z) || solide(x, y0, z) || solide(x, y0 + 1, z)) plat = false;
      }
      if (plat) return { x: cx + 0.5, y: w.groundAt(cx, cz, true) + 1.2, z: cz + 0.5 };
    }
  }
  return null;
}
const sonsRecus = (cl) => cl.messages.filter(m => m.t === A.NP.MSG.SONS).reduce((l, m) => l.concat(m.l || []), []);

// ── blessure et mort d'une créature ──────────────────────────────────────────
async function scenarioCreatures() {
  const dir = terrainPlat();
  if (!dir) { R.saut('créatures', 'aucun terrain plat près du point de départ'); return; }
  const s = await demarrer(Object.assign({}, SANS_POSE_LIBRE, {
    MC_TEST_INV: JSON.stringify([[I.IRON_SWORD, 1]]),
    MC_TEST_SPAWN: `${dir.x},${dir.y},${dir.z}`,
    MC_TEST_MOBS: JSON.stringify([['sheep', 1.5, 0]]),
  }));
  const { client: cl } = await rejoindre(s.port, 'Sonia', 1);
  await cl.attendre('inv_maj', 4000).catch(() => null);
  const mobs = (t) => { const e = cl.dernier('etat'); return e ? e.mobs.filter(m => m.t === t) : []; };
  const mouton = await jusqua(() => mobs('sheep')[0], 5000);
  ok(!!mouton, 'préparation : un mouton près du joueur');
  if (!mouton) { cl.fermer(); return; }
  const frapper = (m) => cl.envoyer({ t: 'attaque', eid: m.e, degats: 12, j: 0, i: 0 });

  frapper(mouton);
  const blesse = await jusqua(() => sonsRecus(cl).find(x => x.k === 'blesse' && x.e === 'sheep'), 4000);
  ok(!!blesse, 'SPEC-AUDIO-002 : le mouton frappé — le serveur envoie le son de sa blessure (SONS)', JSON.stringify(sonsRecus(cl).slice(0, 4)));
  if (blesse) ok(Math.hypot(blesse.x - mouton.x, blesse.z - mouton.z) < 4, 'SPEC-AUDIO-002 : à la position de la créature');
  let mort = null;
  for (let k = 0; k < 6 && !mort; k++) {
    await dodo(600);                                   // la cadence de l'épée
    frapper(mouton);
    mort = await jusqua(() => sonsRecus(cl).find(x => x.k === 'mort' && x.e === 'sheep'), 900);
  }
  ok(!!mort, 'SPEC-AUDIO-002 : sa mort aussi s\'entend (SONS, k « mort »)');

  cl.fermer();
  await s.arreter();
}

// ── SPEC-AUDIO-005 : le réveil d'un gardien s'entend ─────────────────────────
async function scenarioGardien() {
  const w = MC.createWorld(20260921);
  const d = w.donjons.dansZone(-1500, -1500, 1500, 1500).find(x => x.entree && x.type === 'crypte');
  if (!d) { R.saut('gardien de donjon', 'aucune crypte trouvée pour la graine de test'); return; }
  const s = await demarrer(Object.assign({}, SANS_POSE_LIBRE, { MC_TEST_SPAWN: `${d.spawn.x + 1},${d.spawn.y},${d.spawn.z}` }));
  const { client: cl } = await rejoindre(s.port, 'Dora', 1);
  const son = await jusqua(() => sonsRecus(cl).find(x => x.k === 'gardien'), 8000);
  ok(!!son, 'SPEC-AUDIO-005 : le gardien qui s\'éveille — le serveur envoie le son de son réveil (SONS, k « gardien »)');
  if (son) ok(son.e === d.boss, 'SPEC-AUDIO-005 : avec l\'espèce du gardien (' + d.boss + '), pour sa voix');
  cl.fermer();
  await s.arreter();
}

(async () => {
  try {
    await scenarioCreatures();
    await scenarioGardien();
  } catch (e) {
    ok(false, 'le scénario ne doit pas lever d\'exception', e && e.stack);
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
