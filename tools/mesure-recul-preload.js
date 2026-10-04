/* mesure-recul-preload.js — chargé par `node -r` AVANT server.js par
   tools/mesure-recul.js, sans rien changer au serveur mesuré (ce qui permet de
   mesurer aussi d'anciennes versions : clones jetables d'un tag, bissection).

   Il enveloppe le setInterval de la boucle de simulation (celui dont le corps
   lit `dernier`) pour :
   - relever chaque tic : l'écart réel depuis le précédent (ce que le serveur
     prend pour dt, plafonné à 0,25 s) et la durée du tic lui-même ;
   - injecter, si MESURE_BLOCAGE='periodeMs:dureeMs', un blocage synchrone de
     dureeMs toutes les periodeMs (un tic long : sauvegarde, génération de
     chunks, ramasse-miettes, machine saturée) ;
   et écrit chaque seconde un résumé dans le fichier MESURE_SORTIE (JSON). */
'use strict';
const fs = require('fs');
const { performance } = require('perf_hooks');

const sortie = process.env.MESURE_SORTIE;
const blocage = (process.env.MESURE_BLOCAGE || '').split(':').map(Number);
const periodeBlocage = blocage[0] > 0 ? blocage[0] : 0, dureeBlocage = blocage[1] > 0 ? blocage[1] : 0;

const stats = { enveloppe: false, tics: 0, ecarts: [], perduMs: 0, maxEcartMs: 0, maxTicMs: 0, blocages: 0, ticsLongs: 0 };
const origSetInterval = global.setInterval;
let enveloppe = false;
global.setInterval = function (fn, ms) {
  const args = Array.prototype.slice.call(arguments, 2);
  if (!enveloppe && typeof fn === 'function' && /dernier/.test(String(fn)) && /0\.25/.test(String(fn))) {
    enveloppe = true;
    stats.enveloppe = true;
    let precedent = null, prochainBlocage = performance.now() + (periodeBlocage || 0);
    stats.longs = [];
    return origSetInterval(function () {
      const t1 = performance.now();
      fn.apply(this, args);
      let t2 = performance.now();
      const vrai = t2 - t1 > 0.05;     // un vrai tic, et non un sondage qui rend la main aussitôt
      /* Le blocage est injecté À LA FIN d'un vrai tic, comme un tic qui dure :
         les entrées arrivées pendant ce temps attendent dans la socket et sont
         lues avant le tic suivant, dont le dt couvre tout le blocage. */
      if (vrai && periodeBlocage && t2 >= prochainBlocage) {
        prochainBlocage = t2 + periodeBlocage;
        stats.blocages++;
        const d = performance.now();
        while (performance.now() - d < dureeBlocage) { /* tic long simulé */ }
        t2 = performance.now();
      }
      if (vrai) {
        if (precedent !== null) {
          const ecart = t1 - precedent;
          stats.tics++;
          if (stats.ecarts.length < 20000) stats.ecarts.push(+ecart.toFixed(1));
          if (ecart > 250) { stats.perduMs += ecart - 250; stats.ticsLongs++; if (stats.longs.length < 2000) stats.longs.push([Date.now(), Math.round(ecart)]); }
          if (ecart > stats.maxEcartMs) stats.maxEcartMs = ecart;
        }
        if (t2 - t1 > stats.maxTicMs) stats.maxTicMs = t2 - t1;
        precedent = t1;
      }
    }, ms);
  }
  return origSetInterval.apply(this, arguments);
};

function ecrire() {
  if (!sortie) return;
  try { fs.writeFileSync(sortie, JSON.stringify(stats)); } catch (e) { /* tant pis */ }
}
if (sortie) { const t = origSetInterval(ecrire, 500); if (t.unref) t.unref(); process.on('exit', ecrire); }
