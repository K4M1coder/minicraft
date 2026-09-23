/* saves.js — gestion de plusieurs parties.
   Un index léger liste les emplacements ; chaque partie vit dans sa propre clé.
   Le stockage est injecté, donc testable sans navigateur. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var INDEX_KEY = 'minicraft.parties.v2';
  var SLOT_PREFIX = 'minicraft.partie.v2.';
  var VERSION = 2;

  function slotKey(id) { return SLOT_PREFIX + id; }

  function lireJSON(storage, k, defaut) {
    try {
      var raw = storage.getItem(k);
      if (!raw) return defaut;
      var v = JSON.parse(raw);
      return v === null || v === undefined ? defaut : v;
    } catch (e) { return defaut; }
  }
  function ecrireJSON(storage, k, v) {
    try { storage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }

  /* L'index ne contient QUE des métadonnées : le lister ne doit pas nécessiter
     de désérialiser des mondes entiers. */
  function lireIndex(storage) {
    var idx = lireJSON(storage, INDEX_KEY, []);
    return Array.isArray(idx) ? idx : [];
  }
  function ecrireIndex(storage, idx) { return ecrireJSON(storage, INDEX_KEY, idx); }

  /* Horodatage + compteur + hasard : le compteur exclut toute collision dans
     une même session (deux tirages dans la même milliseconde se heurtaient
     une fois sur cent), le hasard les rend improbables d'un onglet à l'autre. */
  var compteurId = 0;
  function nouvelId() {
    compteurId = (compteurId + 1) % 1296;
    return 'p' + Date.now().toString(36) + '-' + compteurId.toString(36) +
           Math.floor(Math.random() * 1679616).toString(36);
  }

  /* Liste les parties, la plus récemment jouée en tête. */
  function lister(storage) {
    return lireIndex(storage).slice().sort(function (a, b) {
      return (b.majLe || 0) - (a.majLe || 0);
    });
  }

  function trouver(storage, id) {
    var l = lireIndex(storage);
    for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
    return null;
  }

  function creer(storage, opts) {
    opts = opts || {};
    var meta = {
      id: opts.id || nouvelId(),
      nom: (opts.nom || 'Partie').slice(0, 40),
      mode: opts.mode || 'survie',
      difficulte: opts.difficulte || 'facile',
      graine: opts.graine === undefined || opts.graine === null
        ? MC.Modes.graineAleatoire() : (opts.graine | 0),
      // version de génération d'origine de la carte, figée à la création
      // (SPEC-HUD-002) : elle ne bouge pas si le générateur change ensuite
      versionCarte: MC.Core.VERSION_GENERATION,
      creeLe: Date.now(),
      majLe: Date.now(),
      duree: 0,
      morte: false,
      // mode histoire : héros, longueur, interactions permises…
      histoire: opts.histoire || null,
    };
    var idx = lireIndex(storage);
    idx.push(meta);
    ecrireIndex(storage, idx);
    return meta;
  }

  function majMeta(storage, id, champs) {
    var idx = lireIndex(storage);
    for (var i = 0; i < idx.length; i++) {
      if (idx[i].id !== id) continue;
      for (var k in champs) idx[i][k] = champs[k];
      // on n'horodate que si l'appelant ne l'a pas fait : sinon impossible de
      // restaurer une date (import d'une partie, test de tri)
      if (!('majLe' in champs)) idx[i].majLe = Date.now();
      ecrireIndex(storage, idx);
      return idx[i];
    }
    return null;
  }

  function renommer(storage, id, nom) {
    return majMeta(storage, id, { nom: String(nom || '').slice(0, 40) || 'Partie' });
  }

  /* Supprime la partie ET son contenu. Utilisé aussi par le mode cauchemar,
     où la mort doit effacer toute trace : si l'on oubliait la donnée de monde,
     recréer une partie du même nom retrouverait l'ancienne carte. */
  function supprimer(storage, id) {
    var idx = lireIndex(storage);
    var reste = idx.filter(function (m) { return m.id !== id; });
    var change = reste.length !== idx.length;
    ecrireIndex(storage, reste);
    try { storage.removeItem(slotKey(id)); } catch (e) {}
    return change;
  }

  function sauvegarder(storage, id, state) {
    var meta = trouver(storage, id);
    if (!meta) return false;
    var data = MC.Save.serialize(state);
    /* `data.v` appartient a Save (format du contenu). L'enveloppe d'emplacement
       a sa PROPRE version : ecraser `v` ici faisait rejeter toute sauvegarde
       par Save.apply, donc plus aucun chargement ne fonctionnait. */
    data.slotV = VERSION;
    data.meta = { mode: meta.mode, difficulte: meta.difficulte, graine: meta.graine };
    if (!ecrireJSON(storage, slotKey(id), data)) return false;
    majMeta(storage, id, { duree: Math.round(state.duree || meta.duree || 0) });
    return true;
  }

  function charger(storage, id, state) {
    var meta = trouver(storage, id);
    if (!meta) return null;
    var data = lireJSON(storage, slotKey(id), null);
    if (!data) return { meta: meta, vierge: true };     // partie créée mais jamais sauvegardée
    if (data.slotV !== VERSION) return null;           // version de l'enveloppe
    if (!MC.Save.apply(data, state)) return null;      // version du contenu
    return { meta: meta, vierge: false };
  }

  function taille(storage, id) {
    try {
      var raw = storage.getItem(slotKey(id));
      return raw ? raw.length : 0;
    } catch (e) { return 0; }
  }

  function toutEffacer(storage) {
    var l = lireIndex(storage);
    l.forEach(function (m) { try { storage.removeItem(slotKey(m.id)); } catch (e) {} });
    ecrireIndex(storage, []);
    return l.length;
  }

  MC.Saves = {
    INDEX_KEY: INDEX_KEY, SLOT_PREFIX: SLOT_PREFIX, VERSION: VERSION,
    slotKey: slotKey, lister: lister, trouver: trouver, creer: creer,
    majMeta: majMeta, renommer: renommer, supprimer: supprimer,
    sauvegarder: sauvegarder, charger: charger, taille: taille,
    toutEffacer: toutEffacer, nouvelId: nouvelId,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
