/* taches-chunks.js — tâche de génération et tâche de maillage (SPEC-PERF-004
   à 010), exécutées à l'IDENTIQUE par un worker (src/worker-monde.js,
   src/worker-maillage.js) et par le repli synchrone du thread principal
   (src/workers.js absent/indisponible). Module PUR : ni THREE, ni DOM,
   aucune dépendance lue au chargement (seulement à l'appel, voir
   docs/vague-2/README.md § 6) — c'est ce qui permet de le charger par
   `importScripts` dans un Worker comme par <script> dans la page. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  /* SPEC-PERF-004 : exécute la génération BRUTE d'un chunk (monde.genererBrut,
     src/world.js) et l'emballe dans le message worker `chunk` (contrat). */
  function executerGeneration(monde, msg) {
    var t0 = Date.now();
    var brut = monde.genererBrut(msg.cx, msg.cz);
    var ms = Date.now() - t0;
    var message = {
      type: 'chunk', epoque: msg.epoque, cx: msg.cx, cz: msg.cz,
      blocks: brut.blocks, etats: brut.etats, eau: brut.eau, ms: ms,
    };
    return { message: message, transferables: MC.ContratsV2.transferablesDe(message) };
  }

  /* SPEC-PERF-008 : convertit le résultat de MC.Mesher.buildChunk (tableaux
     JS) en tableaux typés transférables, en complétant les attributs absents
     ou de la mauvaise taille avec EXACTEMENT les mêmes valeurs par défaut que
     `toGeometry` (src/render.js) : lums/ciels sur un test « non vide »
     (ciels par défaut = 1, pas 0), les autres attributs optionnels sur un
     test de longueur exacte (=== nv * ATTRIBUTS_MAILLAGE[k]). */
  function versTableauxTypes(raw) {
    if (!raw) return null;
    var nv = raw.positions.length / 3;
    var out = {
      positions: new Float32Array(raw.positions),
      normals: new Float32Array(raw.normals),
      uvs: new Float32Array(raw.uvs),
      colors: new Float32Array(raw.colors),
      lums: new Float32Array(raw.lums && raw.lums.length ? raw.lums : new Float32Array(nv)),
      ciels: new Float32Array(raw.ciels && raw.ciels.length ? raw.ciels : new Float32Array(nv).fill(1)),
      ondes: new Float32Array(raw.ondes && raw.ondes.length === nv * 4 ? raw.ondes : new Float32Array(nv * 4)),
      ondes2: new Float32Array(raw.ondes2 && raw.ondes2.length === nv * 4 ? raw.ondes2 : new Float32Array(nv * 4)),
      immerges: new Float32Array(raw.immerges && raw.immerges.length === nv ? raw.immerges : new Float32Array(nv)),
      souples: new Float32Array(raw.souples && raw.souples.length === nv ? raw.souples : new Float32Array(nv)),
      feuillages: new Float32Array(raw.feuillages && raw.feuillages.length === nv ? raw.feuillages : new Float32Array(nv)),
      uvBases: new Float32Array(raw.uvBases && raw.uvBases.length === nv * 2 ? raw.uvBases : new Float32Array(nv * 2)),
      uvReps: new Float32Array(raw.uvReps && raw.uvReps.length === nv * 2 ? raw.uvReps : new Float32Array(nv * 2)),
      indices: new Uint32Array(raw.indices),
    };
    return out;
  }

  /* SPEC-PERF-007 : maille un chunk à partir d'un instantané de ses 9
     voisins (msg.voisins, voir instantaneVoisins) — jamais du monde réel :
     c'est ce qui rend cette fonction exécutable dans un Worker, qui n'a pas
     `world`. Reproduit EXACTEMENT sample/eauDe/chunkDe (world.getBlock,
     render.js `eauDe`, world.chunkDe) mais lus depuis les tableaux reçus. */
  function executerMaillage(msg) {
    var C = MC.Core, CX = C.CHUNK_X, CZ = C.CHUNK_Z, WH = C.WORLD_H, idx = C.idx;
    var cx = msg.cx, cz = msg.cz, voisins = msg.voisins;
    function voisinA(dx, dz) {
      if (dx < -1 || dx > 1 || dz < -1 || dz > 1) return null;
      return voisins[(dz + 1) * 3 + (dx + 1)];
    }
    var centre = voisinA(0, 0);
    var chunk = { cx: cx, cz: cz, blocks: centre.blocks, etats: centre.etats, eau: centre.eau };

    function sample(wx, wy, wz) {
      if (wy < 0 || wy >= WH) return 0;
      wx = Math.floor(wx); wy = Math.floor(wy); wz = Math.floor(wz);
      var a = Math.floor(wx / CX), b = Math.floor(wz / CZ);
      var v = voisinA(a - cx, b - cz);
      if (!v) return 0;
      return v.blocks[idx(wx - a * CX, wy, wz - b * CZ)];
    }
    function eauDe(wx, wz) {
      var a = Math.floor(wx / CX), b = Math.floor(wz / CZ);
      var v = voisinA(a - cx, b - cz);
      if (!v || !v.eau) return null;
      var k = (wz - b * CZ) * CX + (wx - a * CX);
      if (!v.eau.nature[k]) return null;
      return { nature: v.eau.nature[k], flux: { x: v.eau.flux[k * 2] / 127, z: v.eau.flux[k * 2 + 1] / 127 }, prof: v.eau.prof[k] };
    }
    function chunkDe(a, b) {
      var v = voisinA(a - cx, b - cz);
      if (!v) return null;
      return { cx: a, cz: b, blocks: v.blocks, etats: v.etats, eau: v.eau };
    }

    var t0 = Date.now();
    var lumiere = MC.Lumiere.eclairer(chunkDe, cx, cz);
    var passes = {};
    MC.ContratsV2.PASSES_MAILLAGE.forEach(function (pass) {
      var raw = MC.Mesher.buildChunk(chunk, pass, sample, lumiere, eauDe, !!msg.simplifie, msg.fusion !== false);
      passes[pass] = versTableauxTypes(raw);
    });
    var ms = Date.now() - t0;
    var message = {
      type: 'maillage', epoque: msg.epoque, cx: cx, cz: cz, version: msg.version, passes: passes,
      lumiere: { niveaux: lumiere.niveauxPlat, ciel: lumiere.cielPlat, sources: lumiere.sources }, ms: ms,
    };
    return { message: message, transferables: MC.ContratsV2.transferablesDe(message) };
  }

  /* Instantané des 9 voisins d'un chunk (thread principal SEULEMENT :
     `world` n'existe pas dans un Worker) — ce que `maille` transporte dans
     `voisins`. `slice()` copie chaque tampon : un tampon vivant de
     `world.chunks` (ou le partagé ETATS_VIDE) ne doit JAMAIS être transféré
     tel quel, sous peine de rendre le monde réel inutilisable. */
  /* SPEC-SAVE-027 : un chunk sans état particulier voyage avec `etats: null`
     (le maillage lit alors 0 partout, comme le monde réel) au lieu d'une
     copie de 32 Kio de zéros — 9 voisins, 288 Kio par maillage. Le tampon
     partagé ETATS_VIDE se reconnaît sans le lire ; un tampon propre au chunk
     (alloué par une écriture, peut-être revenue à 0 depuis) est parcouru,
     et ne s'arrête qu'au premier état non nul. */
  function sansEtat(world, etats) {
    if (!etats) return true;
    if (world.etatsPartagesVides && world.etatsPartagesVides(etats)) return true;
    for (var i = 0; i < etats.length; i++) if (etats[i]) return false;
    return true;
  }
  function instantaneVoisins(world, cx, cz) {
    var out = [];
    for (var dz = -1; dz <= 1; dz++) for (var dx = -1; dx <= 1; dx++) {
      var c = world.chunkDe(cx + dx, cz + dz);
      if (!c) { out.push(null); continue; }
      out.push({
        blocks: c.blocks.slice(),
        etats: sansEtat(world, c.etats) ? null : c.etats.slice(),
        eau: c.eau ? { nature: c.eau.nature.slice(), flux: c.eau.flux.slice(), prof: c.eau.prof.slice() } : null,
      });
    }
    return out;
  }

  MC.TachesChunks = {
    executerGeneration: executerGeneration, executerMaillage: executerMaillage,
    versTableauxTypes: versTableauxTypes, instantaneVoisins: instantaneVoisins,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
