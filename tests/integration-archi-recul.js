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

(async () => {
  try {
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
