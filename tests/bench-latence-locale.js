/* bench-latence-locale.js — budget de latence du serveur local (SPEC-ARCHI-018,
   mode @lent). Sur la boucle locale, contre un VRAI serveur fermé :

   (a) l'aller-retour ping/pong (trame WebSocket de contrôle, répondue par le
       serveur sans passer par la boucle de jeu) — moyenne et p95 ;
   (b) le délai entre l'envoi d'un ENTREE (seq n) et la réception du premier
       ETAT dont l'accusé (toi[j].s) est ≥ n — moyenne et p95, pour 1 joueur
       puis pour 4 joueurs locaux.

   2 000 échantillons après 200 d'échauffement, sans autre charge. Seuils dans
   tests/budget-perf.json (clé « latence »). Variance machine documentée : une
   condition en dépassement est remesurée une fois avant de conclure. Échoue
   (code 1) si un seuil est dépassé deux fois de suite.

   Usage : node tests/bench-latence-locale.js [--rapide]
   (--rapide : 300 échantillons, 50 d'échauffement — pour la porte, pas pour un verdict) */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre, dossierTemp, supprimerDossier } = A;

const budget = JSON.parse(fs.readFileSync(path.join(__dirname, 'budget-perf.json'), 'utf8')).latence;
const rapide = process.argv.includes('--rapide');
const ECHANTILLONS = rapide ? 300 : budget.echantillons;
const ECHAUFFEMENT = rapide ? 50 : budget.echauffement;

const maintenant = () => Number(process.hrtime.bigint()) / 1e6;
/* Pause à la précision de l'horloge haute résolution. `setTimeout` est arrondi
   à ~15,6 ms sous Windows, comme la boucle du serveur : deux horloges
   quantifiées de la même façon restent VERROUILLÉES en phase, et chaque envoi
   tombait pile après un tic (un délai d'un tic entier, artefact de mesure).
   Un navigateur réel envoie à une phase quelconque : on l'imite par une
   attente active. */
async function pause(ms) {
  const fin = maintenant() + ms;
  while (maintenant() < fin) await new Promise((r) => setImmediate(r));
}
function stats(v) {
  const t = v.slice().sort((a, b) => a - b);
  const moy = t.reduce((a, b) => a + b, 0) / t.length;
  return { moy, p95: t[Math.floor(t.length * 0.95)], max: t[t.length - 1] };
}

async function condition(nbLocaux) {
  const dossier = dossierTemp('mc-bench-lat-');
  const srv = await lancer(['--port', '0', '--dossier-parties', dossier]);
  try {
    const { client } = await rejoindre(srv.port, 'Bench', nbLocaux);
    await dodo(500);
    // (a) ping/pong
    const rtt = [];
    for (let i = 0; i < ECHANTILLONS + ECHAUFFEMENT; i++) {
      const t0 = maintenant();
      await new Promise((res) => { client.surPong = res; client.ping(); });
      if (i >= ECHAUFFEMENT) rtt.push(maintenant() - t0);
    }
    client.surPong = null;
    // (b) ENTREE → ETAT accusant
    const delais = [];
    let seq = 0;
    for (let i = 0; i < ECHANTILLONS + ECHAUFFEMENT; i++) {
      seq++;
      const t0 = maintenant();
      let t1 = 0;
      const fin = new Promise((res) => {
        client.surMessage = (m) => {
          if (m.t === 'etat' && m.toi && m.toi[0] && m.toi[0].s >= seq) { t1 = maintenant(); client.surMessage = null; res(); }
        };
      });
      for (let j = 0; j < nbLocaux; j++) client.envoyer({ t: 'e', s: seq, j, dt: 0.016, k: 0, yaw: 0, pitch: 0, v: 0 });
      await fin;
      if (i >= ECHAUFFEMENT) delais.push(t1 - t0);
      client.messages.length = 0;                        // borne la mémoire : 60 ETAT/s pendant des minutes
      await pause(8 + Math.random() * 25);              // répartit les envois uniformément sur la phase du tic (60 Hz)
    }
    client.fermer();
    return { ping: stats(rtt), entree: stats(delais) };
  } finally { await srv.arreter(); supprimerDossier(dossier); }
}

function verdict(nom, r) {
  const b = budget;
  const pb = r.ping.moy <= b.pingMoyMsMax && r.ping.p95 <= b.pingP95MsMax;
  const eb = r.entree.moy <= b.entreeMoyMsMax && r.entree.p95 <= b.entreeP95MsMax;
  console.log(`  ${nom.padEnd(12)} ping    moyenne ${r.ping.moy.toFixed(2).padStart(6)} ms  p95 ${r.ping.p95.toFixed(2).padStart(6)} ms  max ${r.ping.max.toFixed(1).padStart(6)} ms   (≤ ${b.pingMoyMsMax} / ${b.pingP95MsMax} ms) ${pb ? '✓' : '✗'}`);
  console.log(`  ${''.padEnd(12)} ENTREE→ETAT moyenne ${r.entree.moy.toFixed(2).padStart(6)} ms  p95 ${r.entree.p95.toFixed(2).padStart(6)} ms  max ${r.entree.max.toFixed(1).padStart(6)} ms   (≤ ${b.entreeMoyMsMax} / ${b.entreeP95MsMax} ms) ${eb ? '✓' : '✗'}`);
  return pb && eb;
}

(async function () {
  console.log(`Banc de latence locale (SPEC-ARCHI-018) — ${ECHANTILLONS} échantillons après ${ECHAUFFEMENT} d'échauffement`);
  let ok = true;
  for (const [nom, n] of [['1 joueur', 1], ['4 joueurs', 4]]) {
    let r = await condition(n);
    let bon = verdict(nom, r);
    if (!bon) {
      console.log('  (dépassement — seconde mesure avant de conclure)');
      r = await condition(n);
      bon = verdict(nom + ' (bis)', r);
    }
    if (!bon) ok = false;
  }
  if (!ok) { console.log('\n✗ budget de latence locale dépassé (tests/budget-perf.json, clé « latence »)'); process.exit(1); }
  console.log('\n✓ budgets de latence locale respectés');
})().catch((e) => { console.log('✗ ' + (e && e.stack || e)); process.exit(1); });
