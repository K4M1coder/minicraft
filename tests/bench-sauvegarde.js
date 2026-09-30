/* bench-sauvegarde.js — banc de la sérialisation du monde par le serveur
   (SPEC-ARCHI-012, docs/archi-solo-serveur/README.md § 6).

   Pour chaque taille (10⁴, 10⁵, 10⁶ blocs modifiés) : lance un VRAI serveur
   fermé dont MC_TEST_BLOCS fabrique N overrides au démarrage, laisse sa
   première sauvegarde périodique s'écrire, et lit dans son journal le temps de
   `JSON.stringify(etatMonde())` — la part SYNCHRONE d'une sauvegarde, celle qui
   bloque la boucle de jeu (l'écriture disque, elle, est asynchrone).

   Les seuils sont dans tests/budget-perf.json (clé « sauvegarde »). Variance
   machine documentée : un dépassement est mesuré une seconde fois avant de
   conclure. Échoue (code 1) si un budget est dépassé deux fois.

   Usage : node tests/bench-sauvegarde.js [--rapide]   (--rapide : sans 10⁶) */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, dossierTemp, supprimerDossier } = A;

const budget = JSON.parse(fs.readFileSync(path.join(__dirname, 'budget-perf.json'), 'utf8')).sauvegarde;
const rapide = process.argv.includes('--rapide');
const tailles = rapide ? budget.blocs.filter(n => n <= 100000) : budget.blocs;

async function mesurer(n) {
  const dossier = dossierTemp('mc-bench-save-');
  const fichier = path.join(dossier, 'monde.json');
  const srv = await lancer(['--port', '0', '--monde', fichier, '--dossier-parties', dossier], { MC_TEST_BLOCS: String(n), MC_SAUVEGARDE_MS: '600' });
  try {
    for (let k = 0; k < 400; k++) {
      const l = srv.logs.find(x => /sauvegarde du monde \(cadence\) — sérialisation/.test(x));
      if (l) {
        const m = /sérialisation ([\d.]+) ms, (\d+) Ko/.exec(l);
        return { ms: parseFloat(m[1]), ko: parseInt(m[2], 10) };
      }
      await dodo(100);
    }
    throw new Error('aucune sauvegarde observée pour ' + n + ' blocs : ' + srv.logs.join(' | ').slice(0, 300));
  } finally { await srv.arreter(); supprimerDossier(dossier); }
}

(async function () {
  let ok = true;
  console.log('Banc de sauvegarde (SPEC-ARCHI-012) — sérialisation synchrone de etatMonde()');
  console.log('  blocs modifiés    taille     sérialisation    budget');
  for (const n of tailles) {
    let r = await mesurer(n);
    const max = budget.msMax[String(n)];
    if (r.ms > max) { console.log(`  (dépassement à ${n} : ${r.ms.toFixed(1)} ms > ${max} ms — seconde mesure)`); r = await mesurer(n); }
    const bon = r.ms <= max;
    if (!bon) ok = false;
    console.log(`  ${String(n).padStart(10)}   ${String(r.ko).padStart(7)} Ko   ${r.ms.toFixed(1).padStart(9)} ms   ≤ ${max} ms  ${bon ? '✓' : '✗'}`);
  }
  if (!ok) { console.log('\n✗ budget de sauvegarde dépassé (tests/budget-perf.json, clé « sauvegarde »)'); process.exit(1); }
  console.log('\n✓ budgets de sauvegarde respectés');
})().catch((e) => { console.log('✗ ' + (e && e.stack || e)); process.exit(1); });
