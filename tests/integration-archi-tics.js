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
   Usage : node tests/integration-archi-tics.js */
'use strict';
const A = require('./aide-integration-archi.js');
const { mesurer } = require('../tools/mesure-tics.js');
const R = A.creerRapport('Intégration ARCHI — tics du serveur sans blocage (arrivée, course, sauvegarde, pause, retour)');
const { ok } = R;

(async () => {
  try {
    const r = await mesurer({ duree: 20, blocs: 100000, cadenceSauvegarde: 4000 });
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
    ok(sc.reprise.chute !== null && Math.abs(sc.reprise.chute) < 0.5, 'SPEC-SYNC-004 : le joueur revenu ne tombe pas pendant que son terrain se génère (écart d\'altitude ' + sc.reprise.chute + ')');
  } catch (e) {
    ok(false, 'le scénario ne doit pas lever d\'exception', e && e.stack);
  }
  process.exit(R.fin());
})();
