/* integration-archi-tics.js — la boucle du serveur ne se bloque plus : ni à
   l'arrivée d'un joueur, ni en courant sur du terrain neuf, ni pendant une
   sauvegarde (SPEC-ARCHI-017, SPEC-SERVEUR-004, SPEC-SYNC-004).

   Bogue mesuré (tools/mesure-tics.js, avant correctif) : la première passe
   d'entretien du monde après l'arrivée d'un joueur bloquait la boucle 0,6 à
   0,9 s (lieux jusqu'à 1500 blocs, routes des caravanes, naissances de
   cyclones), REJOINDRE générait 25 chunks d'un coup avant BIENVENUE quand le
   joueur revenait loin du point d'apparition (0,4 à 0,9 s), la course
   produisait des tics de 100 à 600 ms (rayon de chunks généré d'un coup,
   chaque chunk parcourant TOUS les blocs modifiés du monde), et une
   sauvegarde sérialisait tout le monde d'un coup. Le monde avançait par
   à-coups, les entrées attendaient, le joueur était tiré en arrière.

   Ici : un vrai serveur fermé avec le profil des tics (MC_TEST_PROFIL_TICS),
   10⁵ blocs modifiés, une sauvegarde toutes les 4 s, un client qui arrive,
   court en ligne droite, met en pause et reprend, puis revient après une
   relance du serveur (loin du point d'apparition). Attendu : premier ETAT
   < 1 s après REJOINDRE (arrivée et retour), tic p99 < 50 ms et aucun tic
   > 150 ms en courant, aucune tranche de sauvegarde ni aucun message > 50 ms,
   et le joueur revenu ne tombe pas (son sol est là avant ses entrées).

   Revue adversariale du correctif, trois scénarios de plus :
   - sol lent : génération bridée à une colonne par tic (MC_TEST_BUDGET_CHUNKS_MS=0),
     joueur rendu 400 blocs plus loin, entrées à 60 Hz dès l'arrivée — il ne tombe
     pas (sans l'attente du sol, il tombait de plus de 100 blocs : mutation vérifiée) ;
   - véhicule : même génération bridée, une voiture conduite tout droit dépasse son
     terrain — gelée hors zone générée, elle ne tombe jamais sous le sol ;
   - sauvegarde périmée : une exception non rattrapée écrit une sauvegarde
     synchrone pendant qu'une sauvegarde asynchrone plus ANCIENNE est en vol — la
     plus ancienne s'abandonne et n'écrase jamais la plus récente.
   Usage : node tests/integration-archi-tics.js */
'use strict';
const A = require('./aide-integration-archi.js');
const path = require('path');
const fs = require('fs');
const { mesurer } = require('../tools/mesure-tics.js');
const R = A.creerRapport('Intégration ARCHI — tics du serveur sans blocage (arrivée, course, sauvegarde, pause, retour)');
const { ok } = R;

/* Une voiture conduite tout droit pendant que la génération est bridée : elle arrive
   au bord du terrain généré côté serveur ; son conducteur attend son sol et elle doit
   rester gelée (avant : elle roulait sur son élan au-dessus de chunks absents et
   tombait, passager compris). La route : une dalle de pierre suspendue à y = 110,
   7 blocs de large sur 400 de long (vers −z), ciel dégagé — une voiture qui tombe
   passe forcément sous la dalle. */
const Y_DALLE = 110;
function mondeDalle() {
  const overrides = [];
  for (let x = -3; x <= 3; x++) for (let z = -400; z <= 5; z++) {
    overrides.push([x, Y_DALLE, z, 3]);          // pierre (B.STONE)
    for (let y = Y_DALLE + 1; y <= Y_DALLE + 4; y++) overrides.push([x, y, z, 0]);
  }
  return { v: 2, graine: 20260921, heure: 60, overrides, etats: [], crops: [] };
}
async function scenarioVehicule() {
  const d = A.dossierTemp('mc-tics-veh-');
  let s = null, cl = null;
  try {
    const f = path.join(d, 'monde.json');
    fs.writeFileSync(f, JSON.stringify(mondeDalle()));
    s = await A.lancer(['--port', '0', '--monde', f, '--dossier-parties', d], { MC_MODE: 'survie', MC_DIFFICULTE: 'paisible',
      MC_TEST_BUDGET_CHUNKS_MS: '0', MC_TEST_SPAWN: '0.5,' + (Y_DALLE + 1) + ',0.5' });
    const r = await A.rejoindre(s.port, 'Pilote', 1);
    cl = r.client;
    const p0 = r.bienvenue.toi[0];
    const jusqua = async (lire, ms) => { const fin = Date.now() + ms; for (;;) { const v = lire(); if (v) return v; if (Date.now() > fin) return null; await A.dodo(30); } };
    const toi = () => { const e = cl.dernier('etat'); return e && e.toi && e.toi[0]; };
    await jusqua(toi, 3000);
    const pose = cl.attendre('vehicule_evt', 5000, m => m.evt === 'pose' || m.evt === 'refus').catch(() => null);
    cl.envoyer({ t: 'vehicule_poser', j: 0, nom: 'voiture', i: -1, x: Math.floor(p0.x), y: Math.floor(p0.y) - 1, z: Math.floor(p0.z), nx: 0, ny: 1, nz: 0 });
    const rp = await pose;
    ok(!!rp && rp.evt === 'pose', 'préparation : une voiture est posée sous le joueur', JSON.stringify(rp));
    const veh = await jusqua(() => { const e = cl.dernier('etat'); return e && (e.mobs || []).find(m => m.ve === 'voiture'); }, 3000);
    ok(!!veh, 'préparation : la voiture apparaît dans ETAT');
    if (!veh) return;
    const monte = cl.attendre('vehicule_evt', 5000, m => m.evt === 'monte' || m.evt === 'refus').catch(() => null);
    cl.envoyer({ t: 'vehicule_monter', j: 0, eid: veh.e });
    const rm = await monte;
    ok(!!rm && rm.evt === 'monte', 'préparation : le joueur monte à bord');
    const yaw = 0;                         // vers −z, le long de la dalle
    let seq = 0, pire = null, depart = null, dernier = null, arrets = 0, prec = null;
    const fin = Date.now() + 14000;
    while (Date.now() < fin) {
      cl.envoyer({ t: 'e', s: ++seq, j: 0, dt: 0.05, k: 1, yaw, pitch: 0, v: 0 });
      const t = toi();
      if (t && t.veh) {
        if (!depart) depart = t.veh;
        const ecart = t.veh.y - (Y_DALLE + 1);
        if (!pire || ecart < pire.ecart) pire = { ecart: +ecart.toFixed(2), x: +t.veh.x.toFixed(1), y: +t.veh.y.toFixed(1), z: +t.veh.z.toFixed(1) };
        if (prec && Math.hypot(t.veh.x - prec.x, t.veh.z - prec.z) < 0.01) arrets++;
        prec = t.veh; dernier = t.veh;
      }
      await A.dodo(50);
    }
    const dist = depart && dernier ? Math.hypot(dernier.x - depart.x, dernier.z - depart.z) : 0;
    ok(dist > 40, 'préparation : la voiture a roulé au-delà du terrain d\'arrivée (' + dist.toFixed(1) + ' blocs)');
    ok(s.logs.some(l => /sol d un joueur généré d un coup/.test(l)) || arrets > 20, 'préparation : le conducteur a attendu son sol (génération bridée)');
    ok(pire && pire.ecart > -0.5, 'SPEC-SYNC-004 : hors terrain généré, la voiture est gelée — elle ne passe jamais sous la dalle (pire : ' + JSON.stringify(pire) + ')');
  } finally {
    if (cl) cl.fermer();
    if (s) await s.arreter();
    A.supprimerDossier(d);
  }
}

/* Une sauvegarde asynchrone part à 0,5 s, son écriture est retardée de 3 s
   (MC_TEST_SAUVEGARDE_LENTE_MS) ; à 1,5 s une exception non rattrapée écrit une
   sauvegarde SYNCHRONE, plus récente. L'asynchrone, à l'ancien instantané, ne doit
   jamais la remplacer. */
async function scenarioSauvegardePerimee() {
  const d = A.dossierTemp('mc-tics-perimee-');
  const f = path.join(d, 'monde.json');
  let s = null;
  const heureFichier = () => { try { return JSON.parse(fs.readFileSync(f, 'utf8')).heure; } catch (e) { return null; } };
  try {
    s = await A.lancer(['--port', '0', '--monde', f, '--dossier-parties', d], {
      MC_SAUVEGARDE_MS: '500', MC_TEST_SAUVEGARDE_LENTE_MS: '3000', MC_TEST_BLOCS: '20000',
      MC_TEST_PANNE_ASYNC: '1', MC_TEST_PANNE_ASYNC_MS: '1500',
    });
    const attendreLog = async (re, ms) => { const fin = Date.now() + ms; for (;;) { const i = s.logs.findIndex(l => re.test(l)); if (i >= 0) return i; if (Date.now() > fin) return -1; await A.dodo(20); } };
    const iPanne = await attendreLog(/EXCEPTION NON RATTRAPÉE/, 10000);
    ok(iPanne >= 0, 'préparation : l\'exception de test est survenue');
    await A.dodo(100);
    const hSync = heureFichier();
    ok(hSync !== null, 'préparation : la sauvegarde synchrone de secours a écrit le fichier (heure ' + hSync + ')');
    // la première sauvegarde asynchrone (commencée AVANT la panne) se termine : écrite ou abandonnée
    const fin = Date.now() + 10000;
    let issue = null;
    while (Date.now() < fin && !issue) {
      issue = s.logs.slice(iPanne).find(l => /sauvegarde \(cadence\) abandonnée|sauvegarde du monde \(cadence\)/.test(l)) || null;
      if (!issue) await A.dodo(20);
    }
    const hApres = heureFichier();
    ok(!!issue && /abandonnée/.test(issue), 'la sauvegarde asynchrone plus ancienne s\'abandonne au lieu d\'écrire (' + issue + ')');
    ok(hApres !== null && hSync !== null && hApres >= hSync, 'le fichier garde l\'instantané le plus récent (heure ' + hApres + ' ≥ ' + hSync + ')');
  } finally {
    if (s) await s.arreter();
    A.supprimerDossier(d);
  }
}

(async () => {
  try {
    // MC_TICS_SEUL=perimee|vehicule|banc : un seul scénario (mise au point)
    const seul = process.env.MC_TICS_SEUL || '';
    if (!seul || seul === 'perimee') await scenarioSauvegardePerimee();
    if (!seul || seul === 'vehicule') await scenarioVehicule();
    if (seul && seul !== 'banc') { process.exit(R.fin()); }
    const r = await mesurer({ duree: 20, blocs: 100000, cadenceSauvegarde: 4000, solLent: true });
    const sc = r.scenarios;
    const resume = (s) => JSON.stringify({ tics: s.tics, p50: s.ticP50, p99: s.ticP99, max: s.ticMax, sup50: s.ticsSup50, sources: s.sourcesTicsSup50, pires: s.pires.slice(0, 2), taches: s.tachesMax.slice(0, 3) });
    ok(sc.course.tics > 300, 'préparation : la boucle a tourné pendant la course (' + sc.course.tics + ' tics)');
    ok(sc.course.distance > 40, 'préparation : le joueur a vraiment couru sur du terrain neuf (' + sc.course.distance + ' blocs)');
    ok(sc.reprise.loinDuSpawn > 40, 'préparation : le joueur revient loin du point d\'apparition (' + sc.reprise.loinDuSpawn + ' blocs)');
    ok(sc.arrivee.arrivee.premierEtatMs < 1000, 'SPEC-ARCHI-017 : premier ETAT moins d\'une seconde après REJOINDRE (' + sc.arrivee.arrivee.premierEtatMs + ' ms)');
    ok(sc.reprise.arrivee.premierEtatMs < 1000, 'SPEC-ARCHI-017 : au retour loin du point d\'apparition, premier ETAT moins d\'une seconde après REJOINDRE (' + sc.reprise.arrivee.premierEtatMs + ' ms)');
    ok(sc.arrivee.ticMax < 150 && sc.reprise.ticMax < 150, 'SPEC-ARCHI-017 : aucun tic de plus de 150 ms à l\'arrivée ni au retour (' + sc.arrivee.ticMax + ' / ' + sc.reprise.ticMax + ' ms) — ' + resume(sc.reprise));
    ok(sc.course.ticP99 < 50, 'SPEC-SYNC-004 : en courant sur du terrain neuf, tic p99 < 50 ms (' + sc.course.ticP99 + ' ms) — ' + resume(sc.course));
    ok(sc.course.ticMax < 150, 'SPEC-SYNC-004 : en courant, aucun tic de plus de 150 ms (' + sc.course.ticMax + ' ms) — ' + resume(sc.course));
    const taches = [].concat(sc.course.tachesMax, sc.pause.tachesMax, sc.arrivee.tachesMax, sc.reprise.tachesMax);
    const pire = taches.reduce((a, t) => (t.ms > a.ms ? t : a), { ms: 0, nom: '-' });
    ok(sc.course.sauvegardes >= 2, 'préparation : des sauvegardes de 10⁵ blocs ont été écrites pendant la course (' + sc.course.sauvegardes + ')');
    ok(sc.course.sauvegardeMaxMs < 50, 'SPEC-SERVEUR-004 : la part synchrone d\'une sauvegarde de 10⁵ blocs reste sous 50 ms (' + sc.course.sauvegardeMaxMs + ' ms)');
    ok(pire.ms < 50, 'SPEC-SERVEUR-004 : aucune tâche hors tic (sauvegarde de 10⁵ blocs, message) ne bloque la boucle 50 ms (pire : ' + pire.nom + ' ' + pire.ms + ' ms)');
    ok(sc.pause.ticMax < 50, 'SPEC-SERVEUR-004 : pause (sauvegarde immédiate) puis reprise sans tic de plus de 50 ms (' + sc.pause.ticMax + ' ms)');
    ok(sc.reprise.etatsReprise > 50 && sc.reprise.chute !== null && Math.abs(sc.reprise.chute) < 0.5, 'SPEC-SYNC-004 : le joueur revenu, qui envoie ses entrées dès l\'arrivée, ne tombe pas (descente ' + sc.reprise.chute + ', ' + sc.reprise.etatsReprise + ' ETAT)');
    const sl = sc.solLent;
    ok(sl && sl.etats > 50, 'préparation : sol lent — le joueur rendu loin reçoit des ETAT pendant 3 s (' + (sl && sl.etats) + ')');
    ok(sl && sl.chute !== null && Math.abs(sl.chute) < 0.5, 'SPEC-SYNC-004 : sol lent (une colonne par tic) — le joueur attend son sol au lieu de tomber dans le vide (descente ' + (sl && sl.chute) + ' ; ' + JSON.stringify(sl) + ')');
  } catch (e) {
    ok(false, 'le scénario ne doit pas lever d\'exception', e && e.stack);
  }
  process.exit(R.fin());
})();
