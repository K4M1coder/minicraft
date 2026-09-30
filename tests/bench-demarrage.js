/* bench-demarrage.js — budget de démarrage du serveur local (SPEC-ARCHI-017).

   Mesure le temps entre le lancement du processus (`node server.js`) et un
   serveur PRÊT : modules de logique chargés dans `vm`, monde initial généré,
   port ouvert ET index.html effectivement servi. `essais` lancements
   successifs ; le verdict porte sur la MÉDIANE (un lancement isolé peut
   souffrir d'un antivirus ou d'un disque froid). Seuil dans
   tests/budget-perf.json (clé « demarrage », calibré à la session comme les
   autres budgets) ; une mesure en dépassement est refaite une fois.

   Usage : node tests/bench-demarrage.js [--rapide]   (--rapide : 3 essais) */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./aide-integration-archi.js');
const { lancer, dossierTemp, supprimerDossier } = A;

const budget = JSON.parse(fs.readFileSync(path.join(__dirname, 'budget-perf.json'), 'utf8')).demarrage;
const ESSAIS = process.argv.includes('--rapide') ? 3 : budget.essais;

async function serie() {
  const mesures = [];
  for (let i = 0; i < ESSAIS; i++) {
    const dossier = dossierTemp('mc-bench-demarrage-');
    const srv = await lancer(['--port', '0', '--dossier-parties', dossier]);
    mesures.push(srv.demarreMs);
    await srv.arreter();
    supprimerDossier(dossier);
  }
  const t = mesures.slice().sort((a, b) => a - b);
  return { mesures, mediane: t[Math.floor(t.length / 2)], min: t[0], max: t[t.length - 1] };
}

(async function () {
  console.log(`Banc de démarrage (SPEC-ARCHI-017) — ${ESSAIS} lancements, budget : médiane ≤ ${budget.msMax} ms`);
  let r = await serie();
  if (r.mediane > budget.msMax) { console.log(`  (médiane ${r.mediane} ms > ${budget.msMax} ms — seconde série avant de conclure)`); r = await serie(); }
  console.log(`  mesures : ${r.mesures.join(' · ')} ms — min ${r.min} · médiane ${r.mediane} · max ${r.max}`);
  if (r.mediane > budget.msMax) { console.log('\n✗ démarrage trop lent (tests/budget-perf.json, clé « demarrage »)'); process.exit(1); }
  console.log('\n✓ budget de démarrage respecté');
})().catch((e) => { console.log('✗ ' + (e && e.stack || e)); process.exit(1); });
