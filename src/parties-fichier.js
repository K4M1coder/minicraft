/* parties-fichier.js — parties sur disque, export et import (SPEC-ARCHI-013,
   014, 015). Module PUR : aucun accès disque ni réseau. Le stockage est
   injecté (un objet `getItem/setItem/removeItem`, comme MC.Saves) ; côté
   serveur c'est un adaptateur de fichiers, côté navigateur/test un
   `localStorage` ou un objet factice.

   Trois responsabilités :
   - `exporter(storage)` / `analyserExport(texte)` : le fichier
     `minicraft-parties.json` (bouton « Exporter mes parties » du client, lot
     A0-pré) et sa relecture stricte, partie par partie ;
   - `migrerSauvegarde(meta, data)` : convertit une sauvegarde solo
     (`MC.Save.serialize`) en FICHIER DE MONDE du serveur (format de
     `etatMonde()` de server.js) ;
   - `PARITE` : le tableau champ par champ de SPEC-ARCHI-014 — chaque champ de
     `MC.Save.serialize` y a une destination dans le fichier de monde. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var FORMAT_EXPORT = 'minicraft-parties';
  var VERSION_EXPORT = 1;
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

  function idValide(id) { return typeof id === 'string' && ID_RE.test(id); }

  /* ── Parité de persistance (SPEC-ARCHI-014) ──────────────────────────────
     Champ de `MC.Save.serialize` → où il vit dans le fichier de monde.
     `serveur` : le serveur l'utilise déjà pour jouer ; `conserve` : écrit,
     restitué à l'identique par le serveur, consommé par un lot ultérieur
     (B ou P) — jamais perdu en route. */
  var PARITE = {
    v: 'aucun (version du format, remplacée par v du fichier de monde)',
    seed: 'graine',
    time: 'heure',
    overrides: 'overrides',
    etats: 'etats',
    crops: 'crops',
    donjons: 'donjons',
    pilles: 'pilles',
    explores: 'extras.explores',
    reperes: 'extras.reperes',
    suivi: 'extras.suivi',
    reputation: 'extras.reputation',
    politique: 'politique',
    guildes: 'guildes',
    economie: 'economie',
    banque: 'soloJoueur.banque',
    pnjsMorts: 'pnjsMorts',
    zones: 'zones',
    histoire: 'extras.histoire',   // ARCHI-041 : adopté par le joueur du poste à sa première connexion, puis réécrit dans histoire.recits
    vehicules: 'extras.vehicules',
    succes: 'extras.succes',
    player: 'soloJoueur.{inv,equip,etat}',
    chests: 'conteneurs',
    expositions: 'extras.expositions',
    spawnPoint: 'soloJoueur.etat.spawn',
    distributeurs: 'conteneurs',
    commandes: 'commandes',
    furnaces: 'conteneurs',
  };

  // ── export ──────────────────────────────────────────────────────────────────
  /* Lit toutes les parties d'un stockage de type MC.Saves. Une partie dont la
     donnée est illisible est exportée avec `data: null` (le fichier reste un
     reflet fidèle ; c'est l'import qui la signale). */
  function exporter(storage) {
    var parties = MC.Saves.lister(storage).map(function (meta) {
      var data = null;
      try {
        var brut = storage.getItem(MC.Saves.slotKey(meta.id));
        data = brut ? JSON.parse(brut) : null;
      } catch (e) { data = null; }
      return { meta: meta, data: data };
    });
    return { format: FORMAT_EXPORT, v: VERSION_EXPORT, exporteLe: Date.now(), parties: parties };
  }

  /* Relit un export. Renvoie { parties: [{meta, data}], ignorees: [{id, motif}] }
     ou { erreur } si le fichier entier est inutilisable. Une partie corrompue
     ou d'une autre version est signalée et ignorée sans bloquer les autres
     (SPEC-ARCHI-015). */
  function analyserExport(entree) {
    var obj = entree;
    if (typeof entree === 'string') {
      try { obj = JSON.parse(entree); } catch (e) { return { erreur: 'fichier illisible (JSON invalide)' }; }
    }
    if (!obj || typeof obj !== 'object' || obj.format !== FORMAT_EXPORT || obj.v !== VERSION_EXPORT || !Array.isArray(obj.parties)) {
      return { erreur: 'ce fichier n\'est pas un export de parties MiniCraft' };
    }
    var ok = [], ignorees = [];
    obj.parties.forEach(function (p, i) {
      var id = p && p.meta && typeof p.meta.id === 'string' ? p.meta.id : ('#' + i);
      if (!p || !p.meta || !idValide(p.meta.id)) { ignorees.push({ id: id, motif: 'identifiant invalide' }); return; }
      if (!p.data || typeof p.data !== 'object') { ignorees.push({ id: id, motif: 'données absentes ou corrompues' }); return; }
      if (p.data.slotV !== MC.Saves.VERSION) { ignorees.push({ id: id, motif: 'version d\'emplacement inconnue (' + p.data.slotV + ')' }); return; }
      if ([1, 2, 3].indexOf(p.data.v) < 0) { ignorees.push({ id: id, motif: 'version de sauvegarde inconnue (' + p.data.v + ')' }); return; }
      if (typeof p.data.seed !== 'number' || !isFinite(p.data.seed)) { ignorees.push({ id: id, motif: 'graine absente' }); return; }
      ok.push({ meta: p.meta, data: p.data });
    });
    return { parties: ok, ignorees: ignorees };
  }

  // ── migration d'une sauvegarde solo vers un fichier de monde ────────────────
  function tableau(x) { return Array.isArray(x) ? x : []; }
  function copie(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

  /* `data` : sortie de MC.Save.serialize (v1, v2 ou v3, migrée au besoin).
     Ne modifie jamais `data`. Renvoie le fichier de monde, prêt à être écrit. */
  function migrerSauvegarde(meta, data) {
    var d = copie(data);
    if (d.v === 1) d = MC.Save.migrerV1(d);
    if (d.v === 2) d = MC.Save.migrerV2(d);
    var V2 = MC.ContratsV2, C = MC.Core;

    // type de conteneur d'après le bloc posé à la clé (les overrides de la partie)
    var blocA = {};
    tableau(d.overrides).forEach(function (o) { blocA[o[0] + ',' + o[1] + ',' + o[2]] = o[3]; });
    function typeDe(cle, defaut) {
      var def = C && C.BLOCKS ? C.BLOCKS[blocA[cle]] : null;
      var t = def && def.interactive;
      return V2.TYPES_CONTENEUR[t] && !V2.TYPES_CONTENEUR[t].parJoueur ? t : defaut;
    }
    var conteneurs = [];
    function ajouter(cle, type, slots, four) {
      var t = V2.TYPES_CONTENEUR[type];
      if (!t) return;
      var cases = slots.slice(0, t.taille);
      while (cases.length < t.taille) cases.push(0);
      var v = V2.validerConteneurPersiste({ cle: cle, type: type, slots: cases, four: four });
      if (v) conteneurs.push(v);
    }
    tableau(d.chests).forEach(function (c) {
      var taille = c[2] || 27;
      var defaut = taille === 9 ? 'etagere' : taille === 18 ? 'bibliotheque' : 'chest';
      ajouter(c[0], typeDe(c[0], defaut), tableau(c[1]));
    });
    tableau(d.distributeurs).forEach(function (c) { ajouter(c[0], 'distributeur', tableau(c[1])); });
    tableau(d.furnaces).forEach(function (f) {
      function cas(x) { return x ? [x[0], x[1]] : 0; }
      ajouter(f[0], 'furnace', [cas(f[1]), cas(f[2]), cas(f[3])], { burn: +f[4] || 0, cook: +f[5] || 0 });
    });

    var p = d.player || {};
    var etat = {
      x: p.x, y: p.y, z: p.z, yaw: p.yaw || 0, pitch: p.pitch || 0,
      hp: p.hp, hunger: p.hunger, air: p.air, selected: p.selected || 0, flying: !!p.flying,
      spawn: d.spawnPoint || null,
    };
    var banque = tableau(d.banque);
    while (banque.length < 27) banque.push(0);
    var solo = {
      v: 1,
      inv: tableau(p.inv),
      equip: p.equip || {},
      banque: banque.slice(0, 27),
      etat: etat,
    };
    // un enregistrement invalide (pile corrompue) est écarté plutôt que de bloquer la partie
    var soloValide = V2.validerEnregistrementJoueur(solo);

    return {
      v: 2,
      graine: d.seed,
      heure: d.time || 60,
      overrides: tableau(d.overrides), etats: tableau(d.etats), crops: tableau(d.crops),
      donjons: tableau(d.donjons), pilles: tableau(d.pilles), pnjsMorts: tableau(d.pnjsMorts),
      zones: d.zones || null, politique: d.politique || null, guildes: d.guildes || null, economie: d.economie || null,
      conteneurs: conteneurs,
      commandes: tableau(d.commandes),
      joueurs: [],
      soloJoueur: soloValide,
      extras: {
        explores: d.explores || [], reperes: d.reperes || [], suivi: d.suivi || 0,
        reputation: d.reputation || null, expositions: tableau(d.expositions),
        histoire: d.histoire || null, vehicules: tableau(d.vehicules), succes: d.succes || null,
      },
      importeDe: { id: meta && meta.id, version: d.v },
    };
  }

  /* Métadonnées d'index d'une partie importée : conserve id, nom, mode,
     difficulté, graine, dates, durée (SPEC-ARCHI-015). */
  function metaImportee(meta, data) {
    return {
      id: meta.id,
      nom: String(meta.nom || 'Partie').slice(0, 40),
      mode: meta.mode || (data.meta && data.meta.mode) || 'survie',
      difficulte: meta.difficulte || (data.meta && data.meta.difficulte) || 'facile',
      graine: typeof meta.graine === 'number' ? meta.graine : data.seed,
      versionCarte: meta.versionCarte,
      creeLe: meta.creeLe || Date.now(),
      majLe: meta.majLe || Date.now(),
      duree: meta.duree || 0,
      morte: !!meta.morte,
      histoire: meta.histoire || null,
    };
  }

  MC.PartiesFichier = {
    FORMAT_EXPORT: FORMAT_EXPORT, VERSION_EXPORT: VERSION_EXPORT, PARITE: PARITE,
    idValide: idValide, exporter: exporter, analyserExport: analyserExport,
    migrerSauvegarde: migrerSauvegarde, metaImportee: metaImportee,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
