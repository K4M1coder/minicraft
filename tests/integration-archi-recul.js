/* integration-archi-recul.js — marcher sans être tiré en arrière quand le
   serveur a des tics longs (SPEC-SYNC-004, SPEC-ARCHI-037).

   Bogue signalé : en marchant, le joueur « revient plus ou moins à ses
   positions précédentes jusqu'à un certain point », surtout machine chargée.
   Cause mesurée (tools/mesure-recul.js) : le budget de temps anti-triche était
   crédité du dt PLAFONNÉ du tic (0,25 s) et plafonné à 0,5 s même quand des
   entrées attendaient. Chaque tic de plus de 250 ms faisait perdre sa part de
   temps au joueur ; comme un client honnête envoie exactement le temps réel,
   ce retard ne se rattrapait jamais, s'accumulait, et à 240 entrées en
   attente le serveur jetait les plus anciennes : leur déplacement, prédit par
   le client, n'avait jamais lieu côté serveur, et l'ETAT suivant ramenait le
   joueur en arrière de plusieurs blocs.

   Ici : un vrai server.js dont la boucle est bloquée 900 ms toutes les 1,5 s
   (préchargement tools/mesure-recul-preload.js), un client émulé avec les
   modules du jeu qui marche, court, saute et tourne pendant 25 s. Attendu :
   le retard d'entrées ne s'accumule pas et aucune correction de position.
   Usage : node tests/integration-archi-recul.js */
'use strict';
const A = require('./aide-integration-archi.js');
const { mesurer } = require('../tools/mesure-recul.js');
const R = A.creerRapport('Intégration ARCHI — marcher sans recul malgré des tics serveur longs');
const { ok } = R;

/* Revue adversariale du correctif : pendant que le joueur est mort, un client
   tricheur garde sa file d'entrées pleine ; si le crédit montait jusqu'à la
   durée de la file, la renaissance suivie d'une rafale rejouait des dizaines
   de secondes de course en un tic (134 blocs d'un coup). Attendu : au premier
   relevé qui suit la renaissance, au plus la réserve normale (0,5 s) plus le
   temps écoulé, et sur une seconde, jamais plus que le temps réel + la réserve. */
async function scenarioMortPuisRafale() {
  const path = require('path'), fs = require('fs');
  const MC = A.chargerModules();
  const d = A.dossierTemp('mc-recul-mort-');
  const f = path.join(d, 'monde.json');
  let s = null, cl = null, rafale = null;
  try {
    // un joueur à 1 PV, affamé, en difficulté normale : la famine le tue vite, sans aucune entrée
    fs.writeFileSync(f, JSON.stringify({ v: 2, graine: 20260921, heure: 60, overrides: [], etats: [], crops: [],
      soloJoueur: { v: 1, inv: new Array(MC.ContratsV2.BORNES.SLOTS_INV).fill(0), equip: {}, etat: { hp: 1, hunger: 0, air: 10 } } }));
    s = await A.lancer(['--port', '0', '--monde', f, '--dossier-parties', d], { MC_DIFFICULTE: 'normal' });
    const r = await A.rejoindre(s.port, 'Tricheur', 1);
    cl = r.client;
    const toi = () => { const e = cl.dernier('etat'); return e && e.toi && e.toi[0]; };
    const jusqua = async (lire, ms) => { const fin = Date.now() + ms; for (;;) { const v = lire(); if (v) return v; if (Date.now() > fin) return null; await A.dodo(20); } };
    ok(!!(await jusqua(() => { const e = toi(); return e && e.mort === 1; }, 30000)), 'préparation : le joueur meurt (famine) sur le serveur');
    // mort : la file est gardée pleine de courses de 0,1 s pendant 4 s
    let seq = 0;
    const entree = () => cl.envoyer({ t: 'e', s: ++seq, j: 0, dt: 0.1, k: 1 | 32, yaw: 0, pitch: 0, v: 0 });
    rafale = setInterval(() => { for (let i = 0; i < 40; i++) entree(); }, 50);
    await A.dodo(4000);
    clearInterval(rafale); rafale = null;
    /* renaissance et, dans la même rafale, 600 entrées (60 s de course réclamées) :
       le serveur les reçoit avant son tic suivant. Le joueur n'a jamais bougé :
       il renaît au point d'apparition, celui de BIENVENUE. */
    const p0 = { x: r.bienvenue.toi[0].x, z: r.bienvenue.toi[0].z }, t0 = Date.now(), sMort = seq;
    cl.envoyer({ t: 'renaitre', j: 0 });
    for (let i = 0; i < 600; i++) entree();
    const vivant = await jusqua(() => { const e = toi(); return e && e.mort === 0 ? e : null; }, 6000);
    ok(!!vivant, 'préparation : le joueur renaît');
    if (!vivant) return;
    const premier = await jusqua(() => { const e = toi(); return e && e.mort === 0 && e.s > sMort ? e : null; }, 5000);
    ok(!!premier, 'le serveur rejoue des entrées après la renaissance');
    if (!premier) return;
    const d1 = Math.hypot(premier.x - p0.x, premier.z - p0.z);
    // course ≈ 5,6 blocs/s : réserve 0,5 s + temps écoulé, avec une marge franche
    const borne1 = (0.5 + (Date.now() - t0) / 1000) * 6 + 1;
    ok(d1 <= borne1, 'SPEC-SYNC-004 : au premier relevé après la renaissance, pas de téléportation (' + d1.toFixed(2) + ' blocs, borne ' + borne1.toFixed(1) + ')');
    await A.dodo(1000);
    const e2 = toi(), d2 = Math.hypot(e2.x - p0.x, e2.z - p0.z), borne2 = (0.5 + (Date.now() - t0) / 1000) * 6 + 1;
    ok(d2 <= borne2, 'SPEC-SYNC-004 : une seconde après, jamais plus que le temps réel + la réserve (' + d2.toFixed(2) + ' blocs, borne ' + borne2.toFixed(1) + ')');
  } finally {
    if (rafale) clearInterval(rafale);
    if (cl) cl.fermer();
    if (s) await s.arreter();
    A.supprimerDossier(d);
  }
}

(async () => {
  try {
    await scenarioMortPuisRafale();
    const r = await mesurer({ duree: 25, blocage: '1500:900' });
    const resume = 'retard final ' + r.retardSFinal + ' s (max ' + r.retardSMax + ' s, ' + r.retardMax + ' entrées), ' +
      r.corrections + ' correction(s), max ' + r.correctionMax + ' bloc, recul cumulé ' + r.reculTotal + ' bloc ; tics longs pendant la mesure : ' +
      JSON.stringify(r.serveur && r.serveur.pendant) + ' ; pires : ' + JSON.stringify(r.pires.slice(0, 3));
    ok(r.serveur && r.serveur.pendant.ticsLongs >= 8, 'préparation : la boucle du serveur a bien eu des tics longs (' + JSON.stringify(r.serveur && r.serveur.pendant) + ')');
    ok(r.deplacement > 20, 'préparation : le joueur a vraiment marché (' + r.deplacement + ' blocs)');
    ok(r.etats > 200, 'préparation : des relevés ETAT ont été reçus (' + r.etats + ')');
    ok(r.retardSFinal < 0.5, 'SPEC-SYNC-004 : après des tics longs, le serveur rattrape les entrées en attente (retard final ' + r.retardSFinal + ' s) — ' + resume);
    ok(r.retardSMax < 1.5, 'SPEC-SYNC-004 : le retard d\'entrées ne s\'accumule pas d\'un tic long à l\'autre (max ' + r.retardSMax + ' s)');
    ok(r.correctionMax < 0.05, 'SPEC-ARCHI-037 : en marchant, aucune correction de position (max ' + r.correctionMax + ' bloc) — ' + resume);
    ok(r.reculTotal < 0.05, 'SPEC-ARCHI-037 : le joueur n\'est jamais tiré en arrière (recul cumulé ' + r.reculTotal + ' bloc)');
  } catch (e) {
    ok(false, 'le scénario ne doit pas lever d\'exception', e && e.stack);
  }
  process.exit(R.fin());
})();
