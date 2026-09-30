/* integration-archi-budgets.js — les bancs du chantier ARCHI, en version
   rapide, sur de vrais serveurs : sérialisation d'une sauvegarde
   (SPEC-ARCHI-012, tests/bench-sauvegarde.js), démarrage du serveur local
   (SPEC-ARCHI-017, tests/bench-demarrage.js) et latence locale
   (SPEC-ARCHI-018, tests/bench-latence-locale.js).

   Les bancs complets (2 000 échantillons de latence, 10⁶ blocs, 5 démarrages)
   se lancent à la main ou par `node tests/bench-<nom>.js` ; ici, une version
   réduite qui prouve que chaque banc tourne et respecte les seuils de
   tests/budget-perf.json. Chaque banc refait une mesure en cas de dépassement
   (variance machine documentée) avant d'échouer.

   Usage : node tests/integration-archi-budgets.js */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const A = require('./aide-integration-archi.js');
const R = A.creerRapport('Intégration ARCHI — bancs de sauvegarde, de démarrage et de latence (version rapide)');

function banc(nom, args, motifs) {
  const r = spawnSync(process.execPath, [path.join(__dirname, nom)].concat(args), { encoding: 'utf8', timeout: 240000 });
  const sortie = (r.stdout || '') + (r.stderr || '');
  return { code: r.status, sortie, motifs };
}

const bancs = [
  ['bench-sauvegarde.js', ['--rapide'], 'SPEC-ARCHI-012 : la sérialisation d\'une sauvegarde reste sous budget à 10⁴ et 10⁵ blocs modifiés'],
  ['bench-demarrage.js', ['--rapide'], 'SPEC-ARCHI-017 : le serveur local est prêt en moins de 3 s (médiane de 3 lancements)'],
  ['bench-latence-locale.js', ['--rapide'], 'SPEC-ARCHI-018 : ping, puis ENTREE→ETAT, sous budget pour 1 puis 4 joueurs locaux'],
];
for (const [nom, args, libelle] of bancs) {
  const r = banc(nom, args);
  R.ok(r.code === 0, libelle, 'code ' + r.code + '\n' + r.sortie.split('\n').slice(-12).join('\n'));
  if (r.code === 0) {
    const lignes = r.sortie.split('\n').filter(l => /\bms\b/.test(l)).slice(0, 6);
    lignes.forEach(l => R.details.push('      ' + A.C.d + l.trim() + A.C.x));
  }
}
process.exit(R.fin());
