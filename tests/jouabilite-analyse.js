/* jouabilite-analyse.js — analyse PURE des relevés des e2e de jouabilité
   (tests/e2e-jouabilite.js, SPEC-JOUABLE-001 à 008) : elle dit NON SEULEMENT
   qu'une action s'est annulée ou que le joueur a bougé tout seul, mais
   COMMENT (SPEC-JOUABLE-009) — chaque déplacement erroné avec son vecteur, son
   décalage cumulé, l'intervalle depuis le précédent et sa source probable ;
   pour un bloc, un inventaire ou un coffre, l'attendu, l'obtenu, l'instant
   du retour arrière et le message du serveur qui l'a porté.

   Module pur (ni document, ni réseau, ni horloge) : chargé par
   tests/index.html avant tests/e2e-jouabilite.js (G.MC_JOUABILITE), et
   éprouvé sous Node par tests/spec-jouabilite.js sur des séries synthétiques. */
(function (G) {
  'use strict';

  var TOLERANCE = 1e-3;     // bloc : au-delà, le joueur a « bougé »
  var SEUIL_PAS = 1e-4;     // bloc : un pas d'image plus petit est du bruit de calcul

  function f4(v) { return (v >= 0 ? '+' : '') + v.toFixed(4); }
  function vec(d) { return '(' + f4(d.dx) + ', ' + f4(d.dy) + ', ' + f4(d.dz) + ')'; }
  function norme(d) { return Math.hypot(d.dx, d.dy, d.dz); }

  /* Source probable d'un pas d'image, d'après ce qui est arrivé du serveur
     depuis l'image précédente (relevés ETAT de l'espion réseau) :
       - deltaServeur > seuil : le SERVEUR lui-même a déplacé le joueur
         (ETAT.toi a bougé) — simulation serveur, poussée, tornade… ;
       - un ETAT reçu sans que le serveur ait bougé : la réconciliation a
         recalé le client sur le serveur (la prédiction s'était écartée) ;
       - aucun ETAT : le client a bougé seul (prédiction locale, physique). */
  function sourceProbable(e, seuil) {
    if (e.deltaServeur > seuil) return 'serveur : la simulation du serveur déplace le joueur (ETAT.toi a bougé de ' + e.deltaServeur.toFixed(4) + ' bloc)';
    if (e.etats > 0) return 'correction serveur : ETAT/réconciliation a recalé le client (écart de réconciliation ' + (typeof e.ecart === 'number' ? e.ecart.toFixed(4) : '?') + ' bloc, le serveur n\'a pas bougé)';
    return 'client : prédiction locale sans ETAT reçu (physique ou entrée fantôme)';
  }

  /* `ech` : [{ t, x, y, z, etats?, ecart?, deltaServeur? }] (t en ms, depuis
     le début de la mesure). Rend { ok, duree_ms, maxEcart, final, deplacements }
     où `deplacements` liste chaque pas d'image > seuilPas avec son vecteur, le
     décalage cumulé depuis le départ, l'intervalle depuis le pas erroné
     précédent (null pour le premier) et sa source probable. `ok` : le joueur
     n'est jamais sorti de `tolerance` autour de sa position de départ. */
  function analyserPositions(ech, opts) {
    opts = opts || {};
    var tol = opts.tolerance === undefined ? TOLERANCE : opts.tolerance;
    var seuil = opts.seuilPas === undefined ? SEUIL_PAS : opts.seuilPas;
    var out = { ok: true, duree_ms: 0, maxEcart: 0, final: { dx: 0, dy: 0, dz: 0 }, deplacements: [], echantillons: ech ? ech.length : 0 };
    if (!ech || !ech.length) return out;
    var p0 = ech[0], prec = ech[0], dernierT = null;
    for (var i = 1; i < ech.length; i++) {
      var e = ech[i];
      var pas = { dx: e.x - prec.x, dy: e.y - prec.y, dz: e.z - prec.z };
      var cumul = { dx: e.x - p0.x, dy: e.y - p0.y, dz: e.z - p0.z };
      var nc = norme(cumul);
      if (nc > out.maxEcart) out.maxEcart = nc;
      if (nc >= tol) out.ok = false;
      if (norme(pas) > seuil) {
        out.deplacements.push({
          t_ms: Math.round(e.t - p0.t), vecteur: pas, norme: norme(pas), cumul: cumul,
          intervalle_ms: dernierT === null ? null : Math.round(e.t - dernierT),
          source: sourceProbable({ etats: e.etats || 0, ecart: e.ecart, deltaServeur: e.deltaServeur || 0 }, seuil),
        });
        dernierT = e.t;
      }
      prec = e;
    }
    var der = ech[ech.length - 1];
    out.duree_ms = Math.round(der.t - p0.t);
    out.final = { dx: der.x - p0.x, dy: der.y - p0.y, dz: der.z - p0.z };
    /* Une dérive LENTE (chaque pas sous `seuilPas`) n'a aucun « déplacement »
       listé : on date le premier franchissement de la tolérance, on donne
       l'allure (bloc/s) et une série échantillonnée du décalage cumulé. */
    out.franchissement = null;
    for (var k = 1; k < ech.length; k++) {
      var c = { dx: ech[k].x - p0.x, dy: ech[k].y - p0.y, dz: ech[k].z - p0.z };
      if (norme(c) >= tol) { out.franchissement = { t_ms: Math.round(ech[k].t - p0.t), cumul: c }; break; }
    }
    out.allure_bps = out.duree_ms > 0 ? norme(out.final) / (out.duree_ms / 1000) : 0;
    out.serie = [];
    var pas = Math.max(1, Math.floor(ech.length / 8));
    for (var s = 0; s < ech.length; s += pas) out.serie.push({ t_ms: Math.round(ech[s].t - p0.t), cumul: { dx: ech[s].x - p0.x, dy: ech[s].y - p0.y, dz: ech[s].z - p0.z } });
    if (out.serie[out.serie.length - 1].t_ms !== out.duree_ms) out.serie.push({ t_ms: out.duree_ms, cumul: out.final });
    return out;
  }

  /* Message d'échec lisible : résumé, puis la série temporelle (au plus
     `max` lignes) — t, vecteur, décalage cumulé, intervalle, source. */
  function messagePositions(titre, a, max) {
    max = max || 15;
    var srcs = {};
    a.deplacements.forEach(function (d) { var k = d.source.split(' :')[0]; srcs[k] = (srcs[k] || 0) + 1; });
    var lignes = [titre + ' : ' + a.deplacements.length + ' déplacement(s) erroné(s) en ' + (a.duree_ms / 1000).toFixed(1) + ' s (' + a.echantillons + ' relevés), écart maximal ' + a.maxEcart.toFixed(4) + ' bloc, décalage final ' + vec(a.final) +
      (a.deplacements.length ? ' ; sources : ' + Object.keys(srcs).map(function (k) { return k + ' ×' + srcs[k]; }).join(', ') : '')];
    a.deplacements.slice(0, max).forEach(function (d) {
      lignes.push('  t=' + d.t_ms + ' ms  Δ=' + vec(d.vecteur) + '  cumul=' + vec(d.cumul) +
        '  intervalle=' + (d.intervalle_ms === null ? '—' : d.intervalle_ms + ' ms') + '  ← ' + d.source);
    });
    if (a.deplacements.length > max) lignes.push('  … ' + (a.deplacements.length - max) + ' autre(s)');
    if (!a.ok && a.franchissement) {
      lignes.push('  tolérance franchie à t=' + a.franchissement.t_ms + ' ms (cumul ' + vec(a.franchissement.cumul) + '), allure ' +
        a.allure_bps.toFixed(5) + ' bloc/s sur ' + (a.duree_ms / 1000).toFixed(1) + ' s' + (a.deplacements.length ? '' : ' — dérive lente, chaque pas sous ' + SEUIL_PAS + ' bloc'));
      lignes.push('  série échantillonnée (cumul) : ' + (a.serie || []).map(function (p, i, l) {
        return 't=' + p.t_ms + ' ms ' + vec(p.cumul) + (i ? ' (+' + (p.t_ms - l[i - 1].t_ms) + ' ms)' : '');
      }).join(' ; '));
    }
    return lignes.join('\n');
  }

  /* Stabilité d'une valeur (bloc, signature d'inventaire, contenu de coffre)
     échantillonnée à chaque image APRÈS l'action : `ech` = [{ t, v }] (v
     comparé par égalité stricte — sérialiser avant). Rend { ok, changements,
     premierEcart } : chaque changement de valeur { t_ms, de, vers }, et le
     premier relevé différent de `attendu` (l'instant du retour arrière).
     `tAction` (facultatif) : l'instant de l'action — les instants et la durée
     sont alors comptés depuis elle, sinon depuis le premier relevé. */
  function analyserStabilite(ech, attendu, tAction) {
    var out = { ok: true, changements: [], premierEcart: null, echantillons: ech ? ech.length : 0, duree_ms: 0 };
    if (!ech || !ech.length) return out;
    var t0 = typeof tAction === 'number' ? tAction : ech[0].t;
    for (var i = 0; i < ech.length; i++) {
      if (ech[i].v !== attendu && !out.premierEcart) { out.ok = false; out.premierEcart = { t_ms: Math.round(ech[i].t - t0), v: ech[i].v }; }
      if (i > 0 && ech[i].v !== ech[i - 1].v) out.changements.push({ t_ms: Math.round(ech[i].t - t0), de: ech[i - 1].v, vers: ech[i].v });
    }
    out.duree_ms = Math.round(ech[ech.length - 1].t - t0);
    return out;
  }

  /* Messages du serveur à citer dans un échec : `journal` = [{ t, m }]
     (t en ms, même origine que `t0`), filtré par `garder(m)`, résumé en
     une ligne par message (type, champs utiles), au plus `max`. */
  function resumerMessages(journal, garder, t0, max) {
    max = max || 12;
    var l = (journal || []).filter(function (x) { return !garder || garder(x.m); });
    var out = l.slice(-max).map(function (x) {
      var m = x.m, d = { t: m.t };
      ['x', 'y', 'z', 'id', 'rev', 'ack', 'refus', 'cle', 'gain', 'motif', 'raison'].forEach(function (k) { if (m[k] !== undefined) d[k] = m[k]; });
      if (m.conteneurs) d.conteneurs = m.conteneurs.length;
      if (m.inv) d.inv = resumerInventaire(m.inv);
      return '  t=' + Math.round(x.t - (t0 || 0)) + ' ms ' + JSON.stringify(d);
    });
    if (l.length > max) out.unshift('  … ' + (l.length - max) + ' message(s) plus anciens');
    return out.length ? out.join('\n') : '  (aucun message du serveur correspondant)';
  }

  /* Inventaire sérialisé (Inventory.serialize / INV_MAJ.inv : 0 ou [id, n, …])
     en texte court « i:id×n », cases vides omises. */
  function resumerInventaire(cases) {
    var out = [];
    (cases || []).forEach(function (c, i) { if (c) out.push(i + ':' + c[0] + '×' + c[1]); });
    return out.join(' ') || '(vide)';
  }

  /* Différences case à case entre deux inventaires sérialisés. */
  function comparerInventaires(client, serveur) {
    var n = Math.max((client || []).length, (serveur || []).length), diff = [];
    for (var i = 0; i < n; i++) {
      var a = JSON.stringify((client || [])[i] || 0), b = JSON.stringify((serveur || [])[i] || 0);
      if (a !== b) diff.push({ i: i, client: (client || [])[i] || 0, serveur: (serveur || [])[i] || 0 });
    }
    return { ok: diff.length === 0, differences: diff };
  }
  function messageInventaires(titre, cmp) {
    if (cmp.ok) return titre + ' : identiques';
    return titre + ' : ' + cmp.differences.length + ' case(s) différente(s) — ' + cmp.differences.map(function (d) {
      return 'case ' + d.i + ' client ' + JSON.stringify(d.client) + ' / serveur ' + JSON.stringify(d.serveur);
    }).join(' ; ');
  }

  var API = {
    TOLERANCE: TOLERANCE, SEUIL_PAS: SEUIL_PAS,
    analyserPositions: analyserPositions, messagePositions: messagePositions, sourceProbable: sourceProbable,
    analyserStabilite: analyserStabilite, resumerMessages: resumerMessages,
    resumerInventaire: resumerInventaire, comparerInventaires: comparerInventaires, messageInventaires: messageInventaires,
  };
  G.MC_JOUABILITE = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
