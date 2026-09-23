/* factions.js — qui est l'ennemi de qui, et ce que chaque camp pense du joueur.
   Logique pure. Une créature appartient à une faction ; les factions ont
   leurs ennemis ; le joueur a une réputation auprès de chacune, qui change
   avec ses actes et décide qui l'attaque. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  /* `ennemis` : factions que l'on combat à vue (la relation est symétrique).
     Hostilité envers le joueur, selon sa réputation `rep` (-100 … 100) :
       toujoursHostile   quoi qu'il fasse (les morts ne pardonnent pas)
       amicalDes: r      hostile tant que rep < r
       hostileSous: r    pacifique tant que rep > r
     `penalite` : réputation perdue pour un membre tué ; `prime` : gagnée pour
     chaque ennemi de la faction abattu. */
  var FACTIONS = {
    village: {
      id: 'village', nom: 'Village', membres: ['villager', 'garde'],
      ennemis: ['pillards', 'morts'], depart: 0, hostileSous: -30, penalite: 25, prime: 4,
    },
    pillards: {
      id: 'pillards', nom: 'Pillards', membres: ['pillager', 'vindicator'],
      ennemis: ['village'], depart: -60, amicalDes: 30, penalite: 10, prime: 6,
    },
    morts: {
      id: 'morts', nom: 'Morts-vivants',
      membres: ['zombie', 'skeleton', 'mummy', 'drowned', 'boss_zombie', 'boss_squelette',
                'boss_pharaon', 'boss_capitaine'],
      ennemis: ['village'], depart: -100, toujoursHostile: true, penalite: 0, prime: 0,
    },
    betes: {
      id: 'betes', nom: 'Bêtes sauvages', membres: ['wolf', 'polar_bear', 'goat'],
      ennemis: [], depart: 0, hostileSous: -60, penalite: 8, prime: 0,
    },
  };
  var ORDRE = ['village', 'pillards', 'morts', 'betes'];
  var PAR_TYPE = {};
  ORDRE.forEach(function (f) { FACTIONS[f].membres.forEach(function (t) { PAR_TYPE[t] = f; }); });

  function factionDe(type) { return PAR_TYPE[type] ? FACTIONS[PAR_TYPE[type]] : null; }

  // deux factions se combattent-elles ? (symétrique)
  function ennemies(a, b) {
    if (!a || !b || a === b) return false;
    var fa = FACTIONS[a], fb = FACTIONS[b];
    return !!(fa && fb && (fa.ennemis.indexOf(b) >= 0 || fb.ennemis.indexOf(a) >= 0));
  }
  function typesEnnemis(ta, tb) { return ennemies(PAR_TYPE[ta], PAR_TYPE[tb]); }

  // ─── réputation ────────────────────────────────────────────────────────────
  function creerReputations() {
    var val = {};
    function remettre() { ORDRE.forEach(function (f) { val[f] = FACTIONS[f].depart; }); }
    remettre();
    function get(f) { return val[f] === undefined ? 0 : val[f]; }
    function modifier(f, d) {
      if (val[f] === undefined) return 0;
      val[f] = Math.max(-100, Math.min(100, val[f] + d));
      return val[f];
    }
    return {
      valeurs: val, get: get, modifier: modifier, remettre: remettre,
      serialiser: function () { var o = {}; ORDRE.forEach(function (f) { o[f] = val[f]; }); return o; },
      charger: function (o) { remettre(); if (o) ORDRE.forEach(function (f) { if (typeof o[f] === 'number') val[f] = o[f]; }); },
    };
  }

  /* Une créature de ce type attaque-t-elle le joueur ? Sans faction, c'est
     son gabarit qui décide (`hostile`). */
  function hostileEnversJoueur(type, rep, specHostile) {
    var f = factionDe(type);
    if (!f) return !!specHostile;
    var r = rep ? rep.get(f.id) : f.depart;
    if (f.toujoursHostile) return true;
    if (f.amicalDes !== undefined) return r < f.amicalDes;
    if (f.hostileSous !== undefined) return r <= f.hostileSous;
    return !!specHostile;
  }

  /* Le joueur vient de tuer une créature : sa faction lui en veut, ses
     ennemis lui en savent gré. Renvoie les changements de statut (une
     faction qui devient hostile ou amicale), pour prévenir le joueur. */
  function surMort(type, rep) {
    var f = factionDe(type);
    if (!f || !rep) return [];
    var avant = {};
    ORDRE.forEach(function (k) { avant[k] = statut(k, rep); });
    if (f.penalite) rep.modifier(f.id, -f.penalite);
    ORDRE.forEach(function (k) {
      if (k !== f.id && ennemies(k, f.id) && FACTIONS[k].prime) rep.modifier(k, FACTIONS[k].prime);
    });
    var changes = [];
    ORDRE.forEach(function (k) {
      var s = statut(k, rep);
      if (s !== avant[k]) changes.push({ faction: k, nom: FACTIONS[k].nom, statut: s });
    });
    return changes;
  }
  // échanger avec un villageois améliore un peu les relations
  function surEchange(rep) { if (rep) rep.modifier('village', 1); }

  /* Statut lisible d'une faction envers le joueur : 'hostile', 'neutre' ou 'amical'. */
  function statut(f, rep) {
    var F = FACTIONS[f];
    var r = rep ? rep.get(f) : F.depart;
    if (F.toujoursHostile) return 'hostile';
    if (F.amicalDes !== undefined) return r >= F.amicalDes ? 'amical' : 'hostile';
    if (F.hostileSous !== undefined && r <= F.hostileSous) return 'hostile';
    return r >= 40 ? 'amical' : 'neutre';
  }
  // les villageois ne commercent plus avec qui leur est hostile
  function commerceOuvert(rep) { return statut('village', rep) !== 'hostile'; }

  MC.Factions = { FACTIONS: FACTIONS, ORDRE: ORDRE, factionDe: factionDe, ennemies: ennemies,
                  typesEnnemis: typesEnnemis, creerReputations: creerReputations,
                  hostileEnversJoueur: hostileEnversJoueur, surMort: surMort, surEchange: surEchange,
                  statut: statut, commerceOuvert: commerceOuvert };
})(typeof globalThis !== 'undefined' ? globalThis : this);
