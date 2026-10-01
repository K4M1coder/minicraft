/* integration-archi-sync.js — prédiction du mouvement et heure du monde,
   client et serveur d'accord (SPEC-ARCHI-045, 046 et 047), sur un vrai processus
   server.js FERMÉ au réseau (comme le solo).

   Bogue signalé : immobile, le joueur était régulièrement déplacé ; en vol
   statique il descendait ; l'horloge avançait, reculait, sans fin. Le client
   est ici ÉMULÉ avec les modules du jeu (monde, joueur, MC.Synchro : la même
   prédiction, la même réconciliation et la même horloge que src/game.js),
   piloté image par image au rythme réel, contre les vrais relevés ETAT.

   - 045 (survie) : un vol écrit hors des règles (l'ancien double appui sur
     Espace) est annulé par la réconciliation ; sauter puis rester immobile ne
     provoque aucune correction de position ;
   - 045 (créatif) : monter, puis vol statique : aucune correction, altitude
     stable ; bascule du vol en pleine chute : le serveur s'arrête au même
     endroit que le client (pas de recalage vers le bas) ;
   - 046 : l'heure du client ne recule jamais, reste près de celle du serveur,
     et l'ETAT la porte à mieux que le dixième de seconde ;
   - 047 : immobile, serré par des créatures (MC_TEST_MOBS), le joueur n'est ni
     déplacé par le serveur ni recalé.

   Les attentes sont des sondages bornés (le serveur a acquitté l'entrée n),
   jamais des délais fixes. Usage : node tests/integration-archi-sync.js */
'use strict';
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre } = A;
const R = A.creerRapport('Intégration ARCHI — vol, réconciliation et heure du monde');
const { ok } = R;

const MC = A.chargerModules();
const SY = MC.Synchro;
const serveurs = [];
async function demarrer(env) {
  const s = await lancer(['--port', '0'], env);
  serveurs.push(s);
  return s;
}
async function jusqua(lire, ms, pas) {
  const fin = Date.now() + (ms || 5000);
  for (;;) {
    const v = lire();
    if (v) return v;
    if (Date.now() > fin) return null;
    await dodo(pas || 20);
  }
}

/* Un client de jeu émulé : ce que fait src/game.js (simulerJoueur, onToi,
   onEtat, frameTemps), sans rendu. */
function clientEmule(cl, bienvenue) {
  const monde = MC.createWorld(bienvenue.graine);
  const t0 = bienvenue.toi[0];
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) monde.getChunk(Math.floor(t0.x / 16) + dx, Math.floor(t0.z / 16) + dz, true);
  const pl = MC.createPlayer(monde, MC.createEntities(monde), MC.Modes.regles(bienvenue.mode, bienvenue.difficulte));
  const st = pl.state;
  const pred = SY.creerPrediction();
  const horloge = SY.creerHorloge();
  const e = {
    pl, st, touches: SY.decoderTouches(0), corrections: [], reculs: 0, heures: [], acquitte: 0, toi: null,
    temps: horloge.fixer(bienvenue.heure || 0), images: 0, phase: '',
  };
  SY.reconcilier(pl, t0, pred, null);
  cl.surMessage = (m) => {
    if (m.t !== 'etat') return;
    if (typeof m.heure === 'number') { e.heures.push(m.heure); e.temps = horloge.recevoir(m.heure); }
    if (m.toi && m.toi[0]) {
      e.toi = m.toi[0]; e.acquitte = m.toi[0].s;
      SY.appliquerStats(st, m.toi[0]);                     // comme onToi : les statistiques avant le rejeu
      const ecart = SY.reconcilier(pl, m.toi[0], pred, null);
      if (ecart > 0.01) e.corrections.push({ phase: e.phase, ecart: +ecart.toFixed(3) });
    }
  };
  let derniere = Date.now(), avant = e.temps;
  const iv = setInterval(() => {
    const n = Date.now(); const dt = Math.min((n - derniere) / 1000, 0.05); derniere = n;
    if (!(dt > 0)) return;
    e.temps = horloge.avancer(dt, e.temps);
    if (e.temps < avant - 1e-9) e.reculs++;
    avant = e.temps;
    const en = pred.enregistrer(dt, e.touches, st.yaw, st.pitch, st.flying);
    cl.envoyer({ t: 'e', s: en.s, j: 0, dt: en.dt, k: en.k, yaw: en.yaw, pitch: en.pitch, v: en.v });
    SY.rejouer(pl, [en]);
    e.images = en.s;
    if (e.surImage) e.surImage(e);
  }, 16);
  e.arreter = () => clearInterval(iv);
  /* `n` images de plus, puis l'acquittement de la dernière par le serveur. */
  e.images_ = async (n) => {
    const cible = e.images + n;
    if (!(await jusqua(() => e.images >= cible, 20000))) return false;
    return !!(await jusqua(() => e.acquitte >= cible, 20000));
  };
  return e;
}
const touches = (o) => Object.assign(SY.decoderTouches(0), o || {});

async function scenarioSurvie() {
  const s = await demarrer({ MC_MODE: 'survie' });
  const { client, bienvenue } = await rejoindre(s.port, 'Pilote');
  const c = clientEmule(client, bienvenue);
  try {
    c.phase = 'pose'; ok(await c.images_(40), 'survie : le serveur acquitte les entrées');
    c.corrections.length = 0;
    /* saut, et au sommet l'ANCIEN double appui sur Espace (l'ancien onToggleFly :
       flying basculé, vitesse verticale à zéro, sans demander aux règles) : le
       client se met à voler, le serveur — qui fait foi — le fait tomber. */
    c.phase = 'saut'; c.touches = touches({ jump: 1 });
    await c.images_(8);
    c.touches = touches();
    c.st.flying = !c.st.flying; c.st.vel.y = 0;
    c.phase = 'bascule'; await c.images_(20);
    ok(c.st.flying === false, 'SPEC-ARCHI-045 : un vol écrit hors des règles est annulé par la réconciliation (ETAT.toi[].vol)');
    ok(c.corrections.length <= 1, 'SPEC-ARCHI-045 : un seul recalage, celui qui annule ce vol (corrections : ' + JSON.stringify(c.corrections.slice(0, 6)) + ')');
    c.corrections.length = 0;
    c.phase = 'immobile'; await c.images_(150);
    ok(c.corrections.length === 0, 'SPEC-ARCHI-045 : sauter puis rester immobile ne déplace pas le joueur (corrections : ' + JSON.stringify(c.corrections.slice(0, 6)) + ')');
    ok(c.toi && Math.abs(c.toi.y - c.st.pos.y) < 0.01 && c.toi.sol === 1, 'SPEC-ARCHI-045 : client et serveur au même endroit, au sol (client ' + c.st.pos.y.toFixed(3) + ', serveur ' + (c.toi && c.toi.y.toFixed(3)) + ')');
    ok(c.reculs === 0, 'SPEC-ARCHI-046 : l\'heure du client n\'a jamais reculé (' + c.reculs + ' recul(s))');
    const fines = c.heures.filter(h => Math.abs(h * 10 - Math.round(h * 10)) > 1e-6).length;
    ok(fines > 0, 'SPEC-ARCHI-046 : l\'ETAT porte l\'heure à mieux que le dixième (' + fines + '/' + c.heures.length + ' relevés)');
    const derniere = c.heures[c.heures.length - 1];
    ok(Math.abs(c.temps - derniere) < 0.3, 'SPEC-ARCHI-046 : l\'heure du client suit celle du serveur (écart ' + Math.abs(c.temps - derniere).toFixed(3) + ' s)');
  } finally { c.arreter(); client.fermer(); }
}

async function scenarioCreatif() {
  const s = await demarrer({ MC_MODE: 'creatif' });
  const { client, bienvenue } = await rejoindre(s.port, 'Pilote');
  const c = clientEmule(client, bienvenue);
  try {
    ok(c.st.flying === true, 'créatif : le joueur vole d\'emblée');
    c.phase = 'montee'; c.touches = touches({ jump: 1 });
    ok(await c.images_(40), 'créatif : le serveur acquitte la montée');
    c.touches = touches();
    c.phase = 'arret'; await c.images_(30);                  // la vitesse verticale retombe à zéro
    c.corrections.length = 0;
    const y0 = c.st.pos.y;
    c.phase = 'vol statique'; await c.images_(150);
    ok(c.corrections.length === 0, 'SPEC-ARCHI-045 : vol statique, aucune correction de position (' + JSON.stringify(c.corrections.slice(0, 6)) + ')');
    ok(Math.abs(c.st.pos.y - y0) < 0.01 && c.toi && Math.abs(c.toi.y - y0) < 0.01, 'SPEC-ARCHI-045 : vol statique, l\'altitude ne bouge pas (client ' + (c.st.pos.y - y0).toFixed(4) + ', serveur ' + (c.toi && (c.toi.y - y0).toFixed(4)) + ')');
    // on coupe le vol, on tombe, et on le reprend en pleine chute : arrêt net des DEUX côtés
    ok(SY.basculerVol(c.st) === false, 'créatif : le vol se coupe');
    c.phase = 'chute'; await c.images_(25);
    c.corrections.length = 0;
    ok(SY.basculerVol(c.st) === true && c.st.vel.y === 0, 'créatif : le vol reprend en pleine chute');
    const yReprise = c.st.pos.y;
    c.phase = 'reprise'; await c.images_(90);
    ok(c.corrections.length === 0, 'SPEC-ARCHI-045 : reprise du vol en chute, aucun recalage (' + JSON.stringify(c.corrections.slice(0, 6)) + ')');
    ok(c.toi && Math.abs(c.toi.y - yReprise) < 0.01 && Math.abs(c.st.pos.y - yReprise) < 0.01, 'SPEC-ARCHI-045 : le joueur reste où il a repris le vol (serveur ' + (c.toi && (c.toi.y - yReprise).toFixed(3)) + ', client ' + (c.st.pos.y - yReprise).toFixed(3) + ')');
    ok(c.reculs === 0, 'SPEC-ARCHI-046 : l\'heure du client n\'a jamais reculé, en créatif non plus');
  } finally { c.arreter(); client.fermer(); }
}

/* SPEC-ARCHI-047 : des créatures serrées contre un joueur immobile (ici au pied
   d'un talus, au point d'apparition — zone sûre : elles ne blessent pas). Avant,
   le serveur poussait le joueur hors d'elles à chaque tic, ce que le client ne
   prédit pas : un recalage à presque chaque ETAT. Désormais elles cèdent. */
async function scenarioCreatures() {
  const mobs = [['wolf', 0.2, 0], ['vindicator', 0.3, 0], ['vindicator', -0.3, 0], ['vindicator', 0, 0.3], ['vindicator', 0, -0.3]];
  const s = await demarrer({ MC_MODE: 'survie', MC_DIFFICULTE: 'facile', MC_TEST_MOBS: JSON.stringify(mobs) });
  const { client, bienvenue } = await rejoindre(s.port, 'Pilote');
  const c = clientEmule(client, bienvenue);
  try {
    c.phase = 'pose'; ok(await c.images_(20), 'créatures : le serveur acquitte les entrées');
    const p0 = { x: c.toi.x, z: c.toi.z };
    c.corrections.length = 0;
    c.phase = 'serré'; await c.images_(200);
    const autour = ((client.dernier('etat') || {}).mobs || []).filter(m => m.t === 'vindicator' || m.t === 'wolf');
    ok(autour.length === mobs.length, 'préparation : les ' + mobs.length + ' créatures de test sont diffusées (' + autour.length + ')');
    ok(c.corrections.length === 0, 'SPEC-ARCHI-047 : immobile au milieu de créatures, aucune correction de position (' + c.corrections.length + ' : ' + JSON.stringify(c.corrections.slice(0, 6)) + ')');
    const bouge = Math.hypot(c.toi.x - p0.x, c.toi.z - p0.z);
    ok(bouge < 0.01, 'SPEC-ARCHI-047 : le serveur ne déplace pas le joueur (' + bouge.toFixed(3) + ' bloc)');
    /* qu'elles cèdent est prouvé ailleurs (SPEC-COLL-002, integration-archi-reseau) :
       ici, coincées entre le joueur et le talus, certaines ne le peuvent pas — elles
       restent alors contre lui, le joueur n'est pas poussé pour autant (SPEC-ARCHI-047) */
    const serrees = autour.filter(m => Math.hypot(m.x - c.toi.x, m.z - c.toi.z) < 1.2).length;
    ok(serrees >= 3, 'préparation : les créatures sont restées serrées contre le joueur (' + serrees + ' à moins de 1,2 bloc)');
  } finally { c.arreter(); client.fermer(); }
}

(async () => {
  try {
    await scenarioSurvie();
    await scenarioCreatif();
    await scenarioCreatures();
  } catch (e) {
    ok(false, 'le scénario ne doit pas lever d\'exception', e && e.stack);
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
