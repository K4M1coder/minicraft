/* world.js — chunks, génération procédurale, lecture/écriture de blocs.
   Logique pure : ni THREE, ni DOM. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var CX = C.CHUNK_X, CZ = C.CHUNK_Z, WH = C.WORLD_H, SEA = C.SEA_LEVEL;
  var B = C.B, I = C.I, idx = C.idx;

  function key(a, b) { return a + ',' + b; }
  function key3(x, y, z) { return x + ',' + y + ',' + z; }

  /* États de bloc (SPEC-SAVE-017) : tant qu'aucun état n'a jamais été posé
     dans un chunk, il partage ce tampon vide (copy-on-write) plutôt que
     d'allouer 32 Kio pour rien — aujourd'hui, aucun contenu ne pose encore
     d'état (voir L24/L29), donc ça évite de doubler encore le poids mémoire
     que le passage des blocs à 16 bits a déjà ajouté. setEtat clone ce
     tampon partagé en un tampon propre au chunk dès la première écriture. */
  var ETATS_VIDE = new Uint8Array(CX * WH * CZ);

  function createWorld(seed, opts) {
    opts = opts || {};
    var N = MC.makeNoise(seed === undefined ? 20260921 : seed);
    var chunks = new Map();
    // toutes les modifications du joueur, pour la sauvegarde et pour que la
    // regénération d'un chunk déchargé ne les efface pas
    var overrides = new Map();
    /* États de bloc modifiés par le joueur (SPEC-SAVE-017) : orientation,
       moitié haute/basse, forme d'angle, connexions, allumé/éteint, niveau
       d'énergie — un entier 0..255 par position, 0 par défaut (aucun état
       particulier). Même principe que `overrides` : rejoué après une
       régénération de chunk ou un chargement de sauvegarde. */
    var etatsOverrides = new Map();
    // cultures en croissance : position -> stade, mises à jour par tick()
    var crops = new Map();
    /* Sources de lumière posées par le joueur. La couche rendu y puise les
       torches les plus proches pour y placer ses lumières ponctuelles ; sans
       registre il faudrait balayer tous les chunks à chaque image. */
    var lights = new Map();
    /* L29 mécanismes (SPEC-MECA-008) : registre des blocs `circuit` posés,
       pour que la simulation (tick) n'ait pas à balayer tous les chunks
       chargés à chaque tic — même idée que `lights` ci-dessus. */
    var circuits = new Map();

    /* Climat, relief et donjons : deux modules purs branchés sur le même bruit,
       donc sur la même graine. heightAt reste la seule source du relief. */
    var Bio = MC.Biomes.creer(N);
    function heightAt(wx, wz) { return Bio.hauteur(wx, wz); }
    function biomeAt(wx, wz) { return Bio.biomeAt(wx, wz); }
    var donjons = MC.Donjons.creer(N, function (x, z) {
      return Math.max(1, Math.min(WH - 14, heightAt(x, z)));
    }, function (x, z) { return biomeAt(x, z); });
    /* Carte de densité humaine (L38, SPEC-DENSITE-001/002) : un seul point
       d'extension, exposé pour les zones de jeu et branché dans habitats.js
       (repartitionOk) pour que les lieux en naissent. */
    var densite = MC.Densite ? MC.Densite.creer(N, function (x, z) {
      return Math.max(1, Math.min(WH - 14, heightAt(x, z)));
    }, function (x, z) { return biomeAt(x, z); }, function (x, z) { return Bio.riviere(x, z); }) : null;
    /* Zones de jeu (SPEC-ZONE-001/004) : la carte déterministe suit la
       densité (branchée juste au-dessus) et la politique choisie par le
       serveur (`opts.zonePolitique` — un réglage de lancement, comme la
       graine). L'état mutable (redéfinitions d'un administrateur) est un
       registre séparé, comme `donjonsVaincus` : il vit avec ce monde, pas
       avec la carte, et se sauvegarde avec lui (SPEC-SERVEUR-001). */
    /* Le point d'apparition sûr (SPEC-ZONE-001) doit être celui où l'on naît
       VRAIMENT, pas l'origine (0,0) : `findSpawnColumn` (plus bas) est une
       fonction pure du relief, sans état — l'appeler ici, avant même que le
       monde ait un chunk chargé, donne exactement la même colonne que
       server.js recalculera pour y placer les joueurs. */
    var zoneSpawnParDefaut = opts.zoneSpawn;
    if (!zoneSpawnParDefaut) {
      var colSpawn = findSpawnColumn();
      zoneSpawnParDefaut = { x: colSpawn[0], z: colSpawn[1] };
    }
    var zones = MC.Zones ? MC.Zones.creer(N, densite, {
      politique: opts.zonePolitique, spawn: zoneSpawnParDefaut,
    }) : null;
    var zonesEtat = MC.Zones ? MC.Zones.creerEtat({ politique: opts.zonePolitique }) : null;
    function zoneEn(x, z) { return MC.Zones ? MC.Zones.zoneEn(zones, zonesEtat, x, z) : { zone: 'pvp_pve', redefinie: false }; }
    function reglesZoneEn(x, z) {
      return MC.Zones ? MC.Zones.reglesEn(zones, zonesEtat, x, z)
                       : { degatsJoueurs: true, degatsMob: true, apparitionHostile: true };
    }
    /* Un client multijoueur ne connaît la politique de zones du serveur (le
       réglage --zone) qu'à la bienvenue — parfois après avoir déjà construit
       ce monde avec la politique par défaut (même graine que le serveur).
       On reconstruit alors juste la carte des zones, sans toucher au reste
       du monde déjà généré (SPEC-ZONE-003 : l'affichage doit rester juste). */
    function accorderPolitiqueZone(politique) {
      if (!MC.Zones || !politique || politique === zonesEtat.politique) return false;
      zones = MC.Zones.creer(N, densite, { politique: politique, spawn: zoneSpawnParDefaut });
      zonesEtat.politique = politique;
      return true;
    }
    // habitations, villages et villes : même principe que les donjons
    var habitats = MC.Habitats ? MC.Habitats.creer(N, function (x, z) {
      return Math.max(1, Math.min(WH - 14, heightAt(x, z)));
    }, function (x, z) { return biomeAt(x, z); }, function (x, z) { return Bio.riviere(x, z); }) : null;
    // routes de commerce et de tourisme entre les lieux (même principe, encore)
    var routes = MC.Routes && habitats ? MC.Routes.creer(N, function (x, z) {
      return Math.max(1, Math.min(WH - 14, heightAt(x, z)));
    }, habitats, Bio, zoneEn) : null;
    // habitants tués : identifiant → heure de la mort (sauvegardé : les morts le restent)
    var pnjsMorts = new Map();
    // le compte en banque du joueur, commun à toutes les banques
    var banque = MC.Inventory ? MC.Inventory.create(27) : null;
    // donjons dont le gardien est tombé : persistés par la sauvegarde
    var donjonsVaincus = new Set();
    // la carte : chunks explorés et points de repère, propres à cette partie
    var exploration = MC.Carte ? MC.Carte.creerExploration() : null;
    var reperes = MC.Carte ? MC.Carte.creerReperes() : null;
    // ce que chaque faction pense du joueur
    var reputation = MC.Factions ? MC.Factions.creerReputations() : null;
    // le ciel de ce monde : même graine, même météo, sur tous les postes
    /* Le ciel connaît le climat du monde : un cyclone naît d'une mer chaude,
       une tornade de la chaleur et de l'humidité du lieu (SPEC-NUAGE-003/004). */
    var meteo = MC.Meteo ? MC.Meteo.creer(seed === undefined ? 20260921 : seed, {
      estMerChaude: function (x, z) {
        return Bio.hauteur(x, z) < SEA - 4 && Bio.climat(x, z).t > 0.6;
      },
      conditionsEn: function (x, z) {
        var c = Bio.climat(x, z);
        return { temperature: -12 + c.t * 46, humidite: c.h };
      },
    }) : null;
    /* Une colonne vue de loin, pour le relief lointain : hauteur, eau, couleur. */
    function echantillonLointain(wx, wz) {
      var e = Bio.echantillon(wx, wz);
      var ar = MC.Lointain ? MC.Lointain.essenceDe(e) : { arbres: 0, essence: 0 };
      return { h: Math.min(WH - 1, e.h), eau: e.eau, arbres: ar.arbres, essence: ar.essence,
               couleur: MC.Lointain ? MC.Lointain.couleurLointaine(e) : [120, 120, 120] };
    }
    // coffres de donjon dont le butin a déjà été tiré (ouverts ou cassés)
    var coffresPilles = new Set();

    /* Grottes : deux champs de bruit 3D dont on garde l'intersection, ce qui
       produit des galeries connectées plutôt que des bulles isolées.
       On ne creuse jamais assez haut pour percer le fond de l'océan : l'eau
       ne s'écoule pas, une brèche laisserait une poche d'air sous la mer. */
    var CAVE_TOP_MARGIN = 5;
    /* Cache de grille pour le bruit 3D des grottes (SPEC-PERF-001/002/003) :
       même technique que src/densite.js `valeurCoin`/`valeurLisse` — un coin
       de grille grossière tous les CAVE_PAS_XZ/CAVE_PAS_Y blocs, mis en cache
       dans une Map bornée, interpolé trilinéairement entre ses 8 voisins,
       au lieu d'appeler fbm3 (8 hash3 par octave, jusqu'à 3 fbm3 par bloc
       creusable) à chaque bloc. Profilé (2026-09-24, node --cpu-prof, 80
       chunks en spirale) : hash3 pesait 66 % du CPU de génération, presque
       entièrement depuis isCave — le point chaud visé par ce cache.
       Les trois champs (tunnels a/b, cavernes) varient sur 26 à 40 blocs de
       corrélation ; un pas de grille de 4 blocs en x/z et 8 en y reste bien
       en-dessous de cette échelle, donc l'écart introduit par l'interpolation
       reste minime — mesuré sur un échantillon de colonnes par
       tests/spec-perf.js (SPEC-PERF-003). Chaque Map est bornée comme dans
       densite.js (purge totale au-delà de 200000 coins) : aucune fuite sur
       une session longue (SPEC-PERF-002). */
    var CAVE_PAS_XZ = 4, CAVE_PAS_Y = 8;
    var caveCoinsA = new Map(), caveCoinsB = new Map(), caveCoinsCav = new Map();
    function borner(m) { if (m.size > 200000) m.clear(); }
    function coinCave(cache, calc, gx, gy, gz) {
      var k = gx + ',' + gy + ',' + gz, v = cache.get(k);
      if (v === undefined) {
        borner(cache);
        v = calc(gx * CAVE_PAS_XZ, gy * CAVE_PAS_Y, gz * CAVE_PAS_XZ);
        cache.set(k, v);
      }
      return v;
    }
    function calcA(wx, wy, wz) { return N.fbm3(wx / 26, wy / 15, wz / 26, 2, 2, 0.5); }
    function calcB(wx, wy, wz) { return N.fbm3((wx + 411) / 34, (wy + 77) / 19, (wz - 233) / 34, 2, 2, 0.5); }
    function calcCav(wx, wy, wz) { return N.fbm3((wx - 911) / 40, (wy + 13) / 12, (wz + 577) / 40, 2, 2, 0.5); }
    function champCaveLisse(cache, calc, wx, wy, wz) {
      var fx = wx / CAVE_PAS_XZ, fy = wy / CAVE_PAS_Y, fz = wz / CAVE_PAS_XZ;
      var gx = Math.floor(fx), gy = Math.floor(fy), gz = Math.floor(fz);
      var ux = fx - gx, uy = fy - gy, uz = fz - gz;
      var c000 = coinCave(cache, calc, gx, gy, gz), c100 = coinCave(cache, calc, gx + 1, gy, gz);
      var c010 = coinCave(cache, calc, gx, gy + 1, gz), c110 = coinCave(cache, calc, gx + 1, gy + 1, gz);
      var c001 = coinCave(cache, calc, gx, gy, gz + 1), c101 = coinCave(cache, calc, gx + 1, gy, gz + 1);
      var c011 = coinCave(cache, calc, gx, gy + 1, gz + 1), c111 = coinCave(cache, calc, gx + 1, gy + 1, gz + 1);
      var c00 = c000 + (c100 - c000) * ux, c10 = c010 + (c110 - c010) * ux;
      var c01 = c001 + (c101 - c001) * ux, c11 = c011 + (c111 - c011) * ux;
      var c0 = c00 + (c10 - c00) * uy, c1 = c01 + (c11 - c01) * uy;
      return c0 + (c1 - c0) * uz;
    }
    function isCave(wx, wy, wz, surface) {
      if (wy < 2) return false;
      var plafond = Math.min(surface - CAVE_TOP_MARGIN, SEA - 3);
      if (wy > plafond) return false;
      var a = champCaveLisse(caveCoinsA, calcA, wx, wy, wz);
      var b = champCaveLisse(caveCoinsB, calcB, wx, wy, wz);
      // les deux seuils doivent tomber ensemble : intersection = tunnels
      if (a > 0.60 && b > 0.56) return true;
      /* Cavernes : de grandes salles, aplaties (le bruit varie plus vite en
         hauteur qu'en largeur), entre 8 et 28 de profondeur. */
      if (wy >= 6 && wy <= 28) {
        var cav = champCaveLisse(caveCoinsCav, calcCav, wx, wy, wz);
        if (cav > 0.66) return true;
      }
      return false;
    }
    /* Sous ce niveau, un vide de grotte se remplit de lave : les lacs de lave
       des profondeurs, qui rendent la descente vers le diamant dangereuse. */
    var NIVEAU_LAVE_PROFONDE = 6;

    /* Ravins : de longues entailles étroites qui ouvrent le sol jusqu'aux
       profondeurs — des falaises intérieures. Une ligne de niveau d'un bruit
       dessine leur tracé, un second bruit décide où il y en a. */
    function ravin(wx, wz, h) {
      if (h < SEA + 3) return 0;
      var zone = N.fbm((wx + 3301) / 300, (wz - 1201) / 300, 2, 2, 0.5);
      if (zone < 0.56) return 0;
      var tr = Math.abs(N.fbm((wx + 913) / 70, (wz - 373) / 70, 3, 2, 0.5) - 0.5);
      if (tr > 0.014) return 0;
      return Math.max(8, h - 26 + Math.floor(tr * 400));        // fond du ravin
    }

    /* Surface d'une colonne selon son biome et son altitude. Les plages
       restent du sable partout : c'est ce qui dessine les côtes. */
    function surfaceDe(bio, h, beach) {
      if (bio.marin) return bio.fond;                        // fond de la mer
      if (beach && bio.berges) return [B.DIRT, B.DIRT];     // fond vaseux
      if (beach) return [B.SAND, B.SAND];
      if (bio.neigeDes && h >= bio.neigeDes) return [B.SNOW, B.STONE];
      if (bio.rocheDes && h >= bio.rocheDes) return [B.STONE, B.STONE];
      return [bio.surface, bio.sousSol];
    }

    /* Strates des badlands : la couleur dépend de l'altitude seule, si bien que
       les falaises des mesas montrent les mêmes bandes d'un bout à l'autre. */
    var STRATES = [B.TERRACOTTA, B.TERRACOTTA_RED, B.TERRACOTTA, B.TERRACOTTA_YELLOW,
                   B.TERRACOTTA_RED, B.TERRACOTTA];
    function strate(y) { return STRATES[((y / 2) | 0) % STRATES.length]; }

    /* Choix d'un élément dans une liste [{p}] à partir d'un tirage r ∈ [0,1[ :
       les probabilités s'empilent, la somme reste la densité totale. */
    function tirer(liste, r) {
      var acc = 0;
      for (var i = 0; i < liste.length; i++) {
        acc += liste[i].p;
        if (r < acc) return liste[i];
      }
      return null;
    }

    /* Filons : le charbon partout sous la surface, le fer en profondeur, l'or
       plus bas encore, le diamant tout au fond — c'est ce qui donne une raison
       de descendre. Les badlands, riches en or, en ont trois fois plus. */
    function filon(wx, y, wz, h, bio) {
      var nc = N.hash3(wx, y, wz);
      if (y < h - 6 && nc > 0.982) return B.COAL_ORE;
      if (y < Math.min(h - 12, 26) && nc < 0.010) return B.IRON_ORE;
      var or = bio.strates ? 0.0075 : 0.0025;
      if (y < 20 && nc >= 0.010 && nc < 0.010 + or) return B.GOLD_ORE;
      if (y < 11 && nc >= 0.02 && nc < 0.0215) return B.DIAMOND_ORE;
      /* Nouveaux minerais (SPEC-MINERAI-001) : cuivre et étain, peu profonds et
         communs ; argent et lapis, un peu plus bas ; gemmes (émeraude, rubis,
         saphir), rares et profondes, plus fréquentes dans les montagnes et
         badlands comme l'or ; quartz partout en profondeur moyenne, soufre
         préféré sous et près des volcans ; sel proche de la surface des
         déserts et des badlands (les « mers asséchées » de la spec). */
      if (y < h - 3 && y > 10 && nc >= 0.03 && nc < 0.05) return B.MINERAI_METAUX;
      if (y < 30 && y > 6 && nc >= 0.06 && nc < 0.072) return B.MINERAI_ARGENT;
      var gemmes = bio.strates || bio.id === 'montagnes' ? 0.014 : 0.006;
      if (y < 18 && nc >= 0.09 && nc < 0.09 + gemmes) return B.MINERAI_GEMMES;
      var estVolcan = bio.id === 'volcan';
      var cristalPlafond = estVolcan ? h - 1 : 34;
      var cristalDensite = estVolcan ? 0.05 : 0.012;
      if (y < cristalPlafond && nc >= 0.12 && nc < 0.12 + cristalDensite) return B.MINERAI_CRISTAL;
      /* Le sel reste proche de la surface, mais desert et badlands couvrent
         leurs premiers blocs de grès ou de strates avant même d'appeler
         filon() (voir generateChunk) : le sel ne peut apparaître qu'une fois
         cette couche traversée, pas à une hauteur absolue fixe. */
      if ((bio.id === 'desert' || bio.id === 'badlands') && y > h - 20 &&
          nc >= 0.2 && nc < 0.208) return B.SEL;
      /* L24 (SPEC-CONSTR-006) : marbre et ardoise, poches rares en sous-sol —
         un peu partout, plus fréquentes dans les biomes à strates (montagnes,
         badlands). Une plage inutilisée par les filons ci-dessus (0.19-0.20). */
      if (y < h - 5 && y > 20 && nc >= 0.19 && nc < (bio.strates ? 0.196 : 0.193)) return B.MARBRE;
      if (y < h - 5 && y > 12 && nc >= 0.196 && nc < (bio.strates ? 0.2 : 0.198)) return B.ARDOISE;
      return B.STONE;
    }

    /* Contenu d'une cavité (SPEC-SOUTERRAIN-001 et SPEC-LUMIERE-007) : de la
       lave dans les profondeurs, de l'eau dans les grottes englouties sous la
       mer, et sinon de l'air — parfois semé d'un décor propre au biome
       souterrain (cristaux, champignons lumineux, lianes…) quand le bloc du
       dessous est déjà posé et solide, c'est-à-dire quand cette case est un
       plancher de cavité. */
    // en dessous de ce niveau seulement : les cavités les plus profondes
    // (l'abîme et le bas des géodes/chambres magmatiques/grottes luxuriantes)
    // reçoivent leur décor propre. Au-dessus, une cavité reste comme avant —
    // c'est là que se creusent la plupart des donjons et l'aire d'apparition,
    // qui ne doivent rien voir de nouveau.
    var PLAFOND_SOUTERRAIN = 16;
    function caveAt(x, y, z, wx, wz, h, bio, blocks) {
      if (y <= NIVEAU_LAVE_PROFONDE) return B.LAVA;
      if (!MC.Souterrain || y > PLAFOND_SOUTERRAIN) return 0;
      var sId = MC.Souterrain.biomeAt(bio.id, y, !!bio.marin);
      var r = N.hash3(wx + 401, y - 213, wz + 733);
      if (sId === 'englouties') {
        var solM = y > 0 ? blocks[idx(x, y - 1, z)] : 0;
        return (C.isSolid(solM) && r > 0.92) ? B.ALGUE_LUMINEUSE : B.WATER;
      }
      var sol = y > 0 ? blocks[idx(x, y - 1, z)] : 0;
      if (sol && C.isSolid(sol) && sol !== B.BEDROCK) {
        var deco = MC.Souterrain.decorSol(sId, r);
        if (deco) return deco;
      }
      return 0;
    }

    /* Génère le chunk BRUT (SPEC-PERF-004) : ni les modifications du joueur
       (`overrides`/`etatsOverrides`), ni l'enregistrement des lumières — ce
       qu'un worker, qui n'a ni l'un ni l'autre, peut calculer seul à partir
       de la seule graine. `genererBrut` (public, transférable) et
       `generateChunk` (thread principal, chunk complet) s'appuient dessus. */
    function genererBrutInterne(cx, cz) {
      // 16 bits par bloc (SPEC-SAVE-017) : la génération elle-même ne pose
      // encore que des ids < 128, mais rien ne plafonne plus la suite.
      var blocks = new Uint16Array(CX * WH * CZ);
      /* Un état par bloc, 0 par défaut ; rejoué ci-dessous depuis
         etatsOverrides. Un octet suffit : aucun bloc ne cumule à la fois
         orientation (3 bits), moitié (1 bit), forme d'angle (2 bits),
         connexions (jusqu'à 6 bits) et niveau d'énergie (4 bits) — un même
         bloc n'utilise qu'un sous-ensemble à la fois (voir L24/L29). Rester
         sur Uint8Array ici évite de doubler encore le poids mémoire d'un
         chunk, déjà alourdi par le passage des blocs à 16 bits. */
      var etats = ETATS_VIDE;
      var trees = [];
      /* L'eau de chaque colonne : sa nature (MC.Eau.TYPES), son sens (courant
         de la rivière, ou direction du rivage pour les vagues, ×127) et sa
         profondeur. Le mailleur en tire les ondulations. */
      var eauNature = new Uint8Array(CX * CZ), eauFlux = new Int8Array(CX * CZ * 2), eauProf = new Uint8Array(CX * CZ);

      for (var x = 0; x < CX; x++) for (var z = 0; z < CZ; z++) {
        var wx = cx * CX + x, wz = cz * CZ + z;
        var ech = Bio.echantillon(wx, wz);
        var h = Math.max(1, Math.min(WH - 14, ech.h));
        var bio = ech.biome;
        /* Transition (SPEC-BIOME-005) : dans la bande de mélange, la surface et
           la végétation piochent parfois dans le biome voisin — un tirage
           dithéré par colonne, indépendant pour chacune, plutôt qu'un biome de
           bord unique : c'est ce qui donne à la frontière son grain, au lieu
           d'un simple second biome en applats. */
        var bioSurf = bio, bioVege = bio;
        var mel = Bio.melange(wx, wz, ech);
        if (mel.voisin) {
          var voisinBio = MC.Biomes.LISTE[mel.voisin];
          if (N.hash2(wx * 131 + 7, wz * 151 - 13) < mel.poids) bioSurf = voisinBio;
          if (N.hash2(wx * 97 - 41, wz * 113 + 23) < mel.poids) bioVege = voisinBio;
        }
        // le marais garde de l'herbe au ras de l'eau : ses berges ne sont pas des plages
        var beach = bio.berges ? h <= SEA : h <= SEA + 1;
        var sf = surfaceDe(bioSurf, h, beach);

        var fondRavin = ech.eau > h || ech.lave ? 0 : ravin(wx, wz, h);
        // crevasses : le glacier se fend par endroits, sur une dizaine de blocs
        if (ech.climat.glacier && Math.abs(N.fbm((wx - 77) / 28, (wz + 45) / 28, 2, 2, 0.5) - 0.5) < 0.02) {
          fondRavin = Math.max(fondRavin, h - 10);
        }
        for (var y = 0; y <= h; y++) {
          var b;
          if (y === 0) b = B.BEDROCK;
          else if (fondRavin && y > fondRavin) b = 0;     // ravin ouvert vers le ciel
          else if (isCave(wx, y, wz, h)) b = caveAt(x, y, z, wx, wz, h, bio, blocks);
          else if (y === h && ech.climat.coulee) b = B.MAGMA;   // coulée sur le flanc du volcan
          else if (y === h) b = sf[0];
          else if (y > h - 4) b = bioSurf.strates && !beach ? strate(y) : sf[1];
          // le désert repose sur une couche de grès, les badlands sur leurs strates
          else if (bioSurf.roche && y > h - 8) b = bioSurf.roche;
          else if (bioSurf.strates && y > h - 14) b = strate(y);
          else b = filon(wx, y, wz, h, bio);
          blocks[idx(x, y, z)] = b;
        }
        // eau : la mer, ou un lac perché ; dans le froid, la surface est prise en glace
        var niveau = ech.eau;
        if (niveau > h && MC.Eau) {
          var col = z * CX + x, nat = MC.Eau.natureColonne(ech);
          eauNature[col] = nat;
          eauProf[col] = Math.min(255, niveau - h);
          if (nat === MC.Eau.TYPES.riviere) {
            var cr = Bio.courantRiviere(wx, wz);
            eauFlux[col * 2] = Math.round(cr.x * 127); eauFlux[col * 2 + 1] = Math.round(cr.z * 127);
          }
        }
        for (var yw = h + 1; yw <= niveau; yw++) {
          blocks[idx(x, yw, z)] = (bio.gel && yw === niveau) ? B.ICE : B.WATER;
        }
        // lave du cratère
        for (var yl = h + 1; yl <= ech.lave; yl++) blocks[idx(x, yl, z)] = B.LAVA;
        if (ech.lave) continue;
        if (fondRavin) continue;

        if (bio.marin || h < niveau) {
          fondMarin(blocks, x, z, wx, wz, h, bio, niveau);
          continue;
        }
        if (beach) continue;
        // arbres : le tronc reste à 3 blocs du bord, la couronne tient dans le chunk
        var arbre = tirer(bioVege.arbres, N.hash2(wx * 7, wz * 13));
        var etroit = arbre && arbre.type === 'cactus';
        var auCentre = x > 2 && x < 13 && z > 2 && z < 13;
        if (arbre && (auCentre || etroit)) {
          if (arbre.type !== 'cactus' || sf[0] === B.SAND || sf[0] === B.RED_SAND) {
            trees.push([x, h + 1, z, arbre.type]);
          }
          continue;
        }
        // buissons et prairies fleuries (SPEC-VENT-004), sur l'herbe seulement
        var cb = sf[0] === B.GRASS && Bio.couvertBas ? Bio.couvertBas(wx, wz, bioVege.id) : null;
        if (cb && cb.buisson && x > 0 && x < 14 && z > 0 && z < 14) {
          var bt = cb.buisson.taille, fe = cb.buisson.feuillage;
          if (blocks[idx(x, h + 1, z)] === 0) blocks[idx(x, h + 1, z)] = fe;
          if (bt >= 2 && blocks[idx(x + 1, h + 1, z)] === 0 && blocks[idx(x + 1, h, z)] !== 0) blocks[idx(x + 1, h + 1, z)] = fe;
          if (bt >= 3 && blocks[idx(x, h + 2, z)] === 0) blocks[idx(x, h + 2, z)] = fe;
          continue;
        }
        if (cb && cb.fleur && blocks[idx(x, h + 1, z)] === 0) { blocks[idx(x, h + 1, z)] = cb.fleur; continue; }
        // végétation basse : un tirage indépendant de celui des arbres
        var plante = tirer(bioVege.plantes, N.hash2(wx * 29 + 3, wz * 23 - 11));
        if (plante && blocks[idx(x, h + 1, z)] === 0 && plantePousseSur(plante.id, sf[0])) {
          blocks[idx(x, h + 1, z)] = plante.id;
        }
      }

      function put(x, y, z, b, overwrite) {
        if (x < 0 || x >= CX || z < 0 || z >= CZ || y < 0 || y >= WH) return;
        var i = idx(x, y, z);
        // un feuillage ne remplace que l'air ou une plante basse
        if (overwrite || blocks[i] === 0 || (C.BLOCKS[blocks[i]] && C.BLOCKS[blocks[i]].plant)) {
          blocks[i] = b;
        }
      }
      for (var t = 0; t < trees.length; t++) {
        poserArbre(put, trees[t][0], trees[t][1], trees[t][2], trees[t][3]);
      }

      /* Vagues de rivage : là où la mer est peu profonde, le sens des vagues est
         celui où le fond remonte (vers la plage), d'après les colonnes voisines. */
      if (MC.Eau) {
        for (var ex = 0; ex < CX; ex++) for (var ez = 0; ez < CZ; ez++) {
          var ec = ez * CX + ex, en = eauNature[ec];
          if ((en !== MC.Eau.TYPES.mer && en !== MC.Eau.TYPES.ocean && en !== MC.Eau.TYPES.lac) || eauProf[ec] > 8) continue;
          function pr(a, b) {
            a = Math.max(0, Math.min(CX - 1, a)); b = Math.max(0, Math.min(CZ - 1, b));
            var k = b * CX + a;
            return eauNature[k] ? eauProf[k] : 0;                // la terre : profondeur nulle
          }
          // pente du fond sur quatre colonnes de part et d'autre : les hauts-fonds plats trouvent aussi leur rivage
          var gx = 0, gz = 0;
          for (var rr = 1; rr <= 4; rr++) { gx += (pr(ex + rr, ez) - pr(ex - rr, ez)) / rr; gz += (pr(ex, ez + rr) - pr(ex, ez - rr)) / rr; }
          var gn = Math.hypot(gx, gz);
          if (gn > 0) { eauFlux[ec * 2] = Math.round(-gx / gn * 127); eauFlux[ec * 2 + 1] = Math.round(-gz / gn * 127); }
        }
      }

      // les donjons écrasent tout : leurs murs referment les grottes qu'ils croisent
      donjons.appliquer(cx, cz, CX, CZ, function (bx, by, bz, id) {
        if (by <= 0 || by >= WH) return;                  // le socle reste intact
        blocks[idx(bx - cx * CX, by, bz - cz * CZ)] = id;
      });
      // villes, villages et maisons : terrain nivelé, rues, bâtiments
      // SPEC-CONSTR-003 : un 5e argument optionnel porte l'état du bloc
      // (orientation d'un escalier de toiture, moitié d'une dalle de
      // faîtage…), posé dans le même tampon que les blocs générés — copié à
      // la volée (aucun autre contenu de génération n'en a besoin encore).
      if (habitats) habitats.appliquer(cx, cz, function (bx, by, bz, id, etat) {
        if (by <= 0 || by >= WH) return;
        blocks[idx(bx - cx * CX, by, bz - cz * CZ)] = id;
        if (etat) {
          if (etats === ETATS_VIDE) etats = new Uint8Array(ETATS_VIDE);
          etats[idx(bx - cx * CX, by, bz - cz * CZ)] = etat;
        }
      });
      // routes de commerce et de tourisme entre les lieux
      if (routes) routes.appliquer(cx, cz, function (bx, by, bz, id) {
        if (by <= 0 || by >= WH) return;
        blocks[idx(bx - cx * CX, by, bz - cz * CZ)] = id;
      });

      return { blocks: blocks, etats: etats, eau: { nature: eauNature, flux: eauFlux, prof: eauProf } };
    }

    /* SPEC-PERF-004 : chunk brut, transférable (etats normalisé à `null` si
       aucun état particulier — jamais le tampon partagé ETATS_VIDE, qu'un
       transfert Worker rendrait inutilisable pour tous les chunks). C'est ce
       qu'exécute un worker de génération (voir taches-chunks.js). */
    function genererBrut(cx, cz) {
      var brut = genererBrutInterne(cx, cz);
      return { blocks: brut.blocks, etats: brut.etats === ETATS_VIDE ? null : brut.etats, eau: brut.eau };
    }

    /* Réapplique sur (blocks, etats) les modifications du joueur enregistrées
       pour le chunk (cx, cz) : factorise les deux boucles qu'un chunk généré
       localement (`generateChunk`) et un chunk reçu d'un worker
       (`integrerChunk`) doivent toutes deux traverser. */
    function appliquerOverridesSur(cx, cz, blocks, etats) {
      overrides.forEach(function (id, k) {
        var p = k.split(',');
        var ox = +p[0], oy = +p[1], oz = +p[2];
        if (Math.floor(ox / CX) === cx && Math.floor(oz / CZ) === cz) {
          blocks[idx(ox - cx * CX, oy, oz - cz * CZ)] = id;
        }
      });
      // et les états qui allaient avec (orientation, niveau…) — on ne clone
      // le tampon partagé que si ce chunk en a effectivement besoin
      etatsOverrides.forEach(function (etat, k) {
        var p = k.split(',');
        var ox = +p[0], oy = +p[1], oz = +p[2];
        if (Math.floor(ox / CX) === cx && Math.floor(oz / CZ) === cz) {
          if (etats === ETATS_VIDE) etats = new Uint8Array(ETATS_VIDE);
          etats[idx(ox - cx * CX, oy, oz - cz * CZ)] = etat;
        }
      });
      return { blocks: blocks, etats: etats };
    }

    function generateChunk(cx, cz) {
      var brut = genererBrutInterne(cx, cz);
      var applied = appliquerOverridesSur(cx, cz, brut.blocks, brut.etats);
      var c = { cx: cx, cz: cz, blocks: applied.blocks, etats: applied.etats, mesh: null, meshT: null, dirty: true,
                eau: brut.eau, version: 1 };
      enregistrerLumieres(c);
      return c;
    }

    /* SPEC-PERF-004 : intègre un chunk brut reçu d'un worker (ou du repli
       synchrone) : réapplique overrides/états, enregistre les lumières —
       exactement ce que `generateChunk` fait pour un chunk généré en place.
       Idempotent : un chunk déjà présent (généré entre-temps par le repli
       synchrone, ou reçu deux fois) n'est jamais recréé ni ré-enregistré. */
    function integrerChunk(cx, cz, donnees) {
      var k = key(cx, cz);
      var existant = chunks.get(k);
      if (existant) return existant;
      var etats = donnees.etats || ETATS_VIDE;
      var applied = appliquerOverridesSur(cx, cz, donnees.blocks, etats);
      var c = { cx: cx, cz: cz, blocks: applied.blocks, etats: applied.etats, mesh: null, meshT: null, dirty: true,
                eau: donnees.eau, version: 1 };
      chunks.set(k, c);
      enregistrerLumieres(c);
      return c;
    }

    /* Une plante ne pousse que sur un sol qui lui convient : pas de
       coquelicot sur le sable, pas de buisson mort sur l'herbe. */
    function plantePousseSur(id, sol) {
      if (id === B.DEAD_BUSH) return sol === B.SAND || sol === B.RED_SAND;
      if (id === B.TALL_GRASS) return sol === B.GRASS || sol === B.SNOW;
      if (id === B.MUSHROOM) return sol === B.GRASS || sol === B.MYCELIUM;
      return sol === B.GRASS;
    }

    /* Fond de la mer : flore posée sur le sol immergé, icebergs dans le froid.
       Tout se décide colonne par colonne : aucune structure ne déborde d'un
       chunk, donc rien ne dépend de l'ordre de génération. */
    var FLORE_LAC = [{ id: B.SEAGRASS, p: 0.12 }, { id: B.KELP, p: 0.015 }];
    /* Proximité d'une côte (0..1), par mailles de 8 blocs mises en cache : la
       terre émergée la plus proche, cherchée sur deux anneaux. */
    var cotes = new Map();
    function coteEn(wx, wz) {
      var mx = wx >> 3, mz = wz >> 3, k = mx + ',' + mz;
      var c = cotes.get(k);
      if (c !== undefined) return c;
      c = 0;
      var cx = mx * 8 + 4, cz = mz * 8 + 4;
      var anneaux = [[12, 1], [30, 0.6], [60, 0.35]];
      for (var a = 0; a < anneaux.length && !c; a++) for (var d = 0; d < 8; d++) {
        var ang = d * Math.PI / 4, r = anneaux[a][0];
        if (Bio.hauteur(Math.round(cx + Math.cos(ang) * r), Math.round(cz + Math.sin(ang) * r)) >= SEA) { c = anneaux[a][1]; break; }
      }
      if (cotes.size > 20000) cotes.clear();
      cotes.set(k, c);
      return c;
    }
    function fondMarin(blocks, x, z, wx, wz, h, bio, niveau) {
      var surf = niveau === undefined ? SEA : niveau;
      var prof = surf - h;
      if (!bio.marin) bio = { plantes: FLORE_LAC };
      // icebergs : des colonnes de glace compacte qui crèvent la surface
      if (bio.icebergs) {
        var ib = N.fbm((wx + 77) / 14, (wz - 31) / 14, 2, 2, 0.5);
        if (ib > 0.66) {
          var haut = SEA + Math.min(8, Math.floor((ib - 0.66) * 60));
          for (var yi = h + 1; yi <= haut && yi < WH; yi++) blocks[idx(x, yi, z)] = B.PACKED_ICE;
          return;
        }
      }
      if (prof < 1 || !bio.plantes) return;
      var y0 = h + 1;
      // récifs (SPEC-MER-011) : frangeants au ras des côtes chaudes, barrières au
      // large, atolls et lagons autour des îles volcaniques éteintes
      if (MC.Recifs && bio.marin) {
        var tC = Bio.climat(wx, wz).t;
        var st = tC >= 0.6 ? MC.Recifs.structureEn(wx, wz, { prof: prof, t: tC, cote: coteEn(wx, wz),
                                   volcan: Bio.volcanProche ? Bio.volcanProche(wx, wz, 1.6) : null,
                                   bruit: N.fbm((wx + 431) / 70, (wz - 173) / 70, 2, 2, 0.5) }) : null;
        if (st && st.type === 'lagon') {
          for (var yl2 = y0; yl2 <= surf - st.sommet - 1 && yl2 < surf; yl2++) blocks[idx(x, yl2, z)] = B.SAND;
          return;
        }
        if (st) {
          var haut2 = surf - 1 - st.sommet, cols = [B.CORAL_RED, B.CORAL_YELLOW, B.CORAL_BLUE];
          for (var yr = y0; yr <= haut2 && yr < surf; yr++) {
            blocks[idx(x, yr, z)] = yr < haut2 - 1 ? B.CORAIL_BLANC : cols[Math.floor(N.hash2(wx * 7 + yr, wz * 3) * 3) % 3];
          }
          var top = Math.max(y0, haut2 + 1);
          if (top < surf) {
            var hh = N.hash2(wx * 13 - 1, wz * 11 + 2);
            if (hh < 0.3) blocks[idx(x, top, z)] = [B.CORAL_FAN_RED, B.CORAL_FAN_YELLOW, B.CORAL_FAN_BLUE, B.ANEMONE_ROSE][Math.floor(hh * 13) % 4];
          }
          return;
        }
        if (prof < 2) return;
        // flore selon la profondeur, la température et la lumière (SPEC-MER-010)
        // la flore propre au biome (varech, herbiers…) passe d'abord ; les espèces nouvelles comblent le reste
        var fl = tirer(bio.plantes, N.hash2(wx * 29 + 3, wz * 23 - 11)) ? null
               : MC.Recifs.floreEn(B, prof, tC, N.hash2(wx * 41 + 9, wz * 37 - 5), N.hash2(wx * 5 - 3, wz * 9 + 1));
        if (fl) {
          if (fl.colonne) for (var yc = y0; yc < y0 + fl.hauteur && yc < surf; yc++) blocks[idx(x, yc, z)] = fl.id;
          else blocks[idx(x, y0, z)] = fl.id;
          return;
        }
      }
      if (prof < 2) return;
      // récif : des massifs de corail, coiffés de gorgones et de cornichons
      if (bio.recif && prof <= 10) {
        var rf = N.fbm((wx - 211) / 7, (wz + 97) / 7, 2, 2, 0.5);
        if (rf > 0.5) {
          var couleurs = [B.CORAL_RED, B.CORAL_YELLOW, B.CORAL_BLUE];
          var eventails = [B.CORAL_FAN_RED, B.CORAL_FAN_YELLOW, B.CORAL_FAN_BLUE];
          var k = Math.floor(N.hash2(wx * 3 + 1, wz * 5 - 2) * 3) % 3;
          var massif = 1 + (rf > 0.58 ? 1 : 0) + (rf > 0.66 ? 1 : 0);
          for (var m = 0; m < massif && y0 + m < SEA - 1; m++) blocks[idx(x, y0 + m, z)] = couleurs[k];
          var sommet = y0 + massif;
          if (sommet < SEA - 1) {
            var tc = N.hash2(wx * 11, wz * 17);
            if (tc < 0.45) blocks[idx(x, sommet, z)] = eventails[(k + 1) % 3];
            else if (tc < 0.5) blocks[idx(x, sommet, z)] = B.SEA_PICKLE;
          }
          return;
        }
      }
      var plante = tirer(bio.plantes, N.hash2(wx * 29 + 3, wz * 23 - 11));
      if (!plante) return;
      if (plante.id === B.KELP) {
        // le varech monte en colonne, sans jamais crever la surface
        var hk = 2 + Math.floor(N.hash2(wx * 13 + 7, wz * 19) * Math.max(1, prof - 2));
        for (var yk = y0; yk < y0 + hk && yk < surf; yk++) blocks[idx(x, yk, z)] = B.KELP;
        return;
      }
      blocks[idx(x, y0, z)] = plante.id;
    }

    /* Arbres par essence. `put(x, y, z, id, overwrite)` travaille en
       coordonnées locales au chunk ; le tronc écrase, le feuillage non. */
    function poserArbre(put, tx, ty, tz, type) {
      var hr = N.hash2(tx * 31 + ty, tz * 17);
      var i, dx, dz, dy;
      if (type === 'cactus') {
        var hc = 1 + ((hr * 3) | 0);
        for (i = 0; i < hc; i++) put(tx, ty + i, tz, B.CACTUS, true);
        return;
      }
      if (type === 'sapin') {
        // cône : des étages alternés, de plus en plus larges vers le bas
        var hs = 6 + ((hr * 3) | 0);
        for (i = 0; i < hs; i++) put(tx, ty + i, tz, B.SPRUCE_LOG, true);
        var top = ty + hs;
        put(tx, top, tz, B.SPRUCE_LEAVES, false);
        for (dy = 0; dy < hs - 2; dy++) {
          var r = dy === 0 ? 1 : (dy % 2 === 1 ? Math.min(2, 1 + (dy >> 2)) : 1);
          for (dx = -r; dx <= r; dx++) for (dz = -r; dz <= r; dz++) {
            if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
            if (r === 1 && dy === 0 && Math.abs(dx) + Math.abs(dz) > 1) continue;
            put(tx + dx, top - 1 - dy, tz + dz, B.SPRUCE_LEAVES, false);
          }
        }
        return;
      }
      if (type === 'tropical') {
        // grand tronc, large couronne, lianes pendantes sur le pourtour
        var ht = 7 + ((hr * 5) | 0);
        for (i = 0; i < ht; i++) put(tx, ty + i, tz, B.JUNGLE_LOG, true);
        var tc = ty + ht - 1;
        for (dy = -2; dy <= 1; dy++) {
          var rj = dy === 1 ? 1 : (dy === 0 ? 2 : 3);
          for (dx = -rj; dx <= rj; dx++) for (dz = -rj; dz <= rj; dz++) {
            if (Math.abs(dx) === rj && Math.abs(dz) === rj) continue;
            put(tx + dx, tc + dy, tz + dz, B.JUNGLE_LEAVES, false);
            // liane : au bord de l'étage le plus bas, une sur trois
            if (dy === -2 && (Math.abs(dx) === rj || Math.abs(dz) === rj) &&
                N.hash2(tx * 7 + dx, tz * 5 + dz) < 0.35) {
              var lg = 1 + ((N.hash2(tx + dx * 3, tz - dz) * 3) | 0);
              for (var v = 1; v <= lg; v++) put(tx + dx, tc - 2 - v, tz + dz, B.VINES, false);
            }
          }
        }
        return;
      }
      if (type === 'acacia') {
        // tronc coudé : trois blocs droits, puis deux en diagonale
        var dirx = hr < 0.5 ? 1 : -1;
        for (i = 0; i < 3; i++) put(tx, ty + i, tz, B.ACACIA_LOG, true);
        put(tx + dirx, ty + 3, tz, B.ACACIA_LOG, true);
        put(tx + dirx * 2, ty + 4, tz, B.ACACIA_LOG, true);
        var ax = tx + dirx * 2, ay = ty + 5;
        for (dx = -2; dx <= 2; dx++) for (dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
          put(ax + dx, ay, tz + dz, B.ACACIA_LEAVES, false);
          if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) put(ax + dx, ay + 1, tz + dz, B.ACACIA_LEAVES, false);
        }
        return;
      }
      if (type === 'champignon_geant') {
        var hm = 4 + ((hr * 3) | 0);
        for (i = 0; i < hm; i++) put(tx, ty + i, tz, B.MUSHROOM_STEM, true);
        var cy = ty + hm;
        for (dx = -2; dx <= 2; dx++) for (dz = -2; dz <= 2; dz++) {
          var coin = Math.abs(dx) === 2 && Math.abs(dz) === 2;
          if (!coin) put(tx + dx, cy, tz + dz, B.MUSHROOM_CAP, false);
          // le rebord du chapeau retombe d'un cran
          if (!coin && (Math.abs(dx) === 2 || Math.abs(dz) === 2)) put(tx + dx, cy - 1, tz + dz, B.MUSHROOM_CAP, false);
        }
        return;
      }
      if (type === 'pic_glace') {
        // aiguille de glace compacte, épaulée de colonnes plus basses
        var hp = 5 + ((hr * 9) | 0);
        for (i = 0; i < hp; i++) put(tx, ty + i, tz, B.PACKED_ICE, true);
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d, j) {
          var hv = Math.floor(hp * (0.3 + 0.1 * j));
          for (var q = 0; q < hv; q++) put(tx + d[0], ty + q, tz + d[1], B.PACKED_ICE, true);
        });
        return;
      }
      var log = type === 'bouleau' ? B.BIRCH_LOG : B.LOG;
      var leaves = type === 'bouleau' ? B.BIRCH_LEAVES : B.LEAVES;
      var th = type === 'bouleau' ? 5 + ((hr * 3) | 0) : 4 + ((hr * 3) | 0);
      for (i = 0; i < th; i++) put(tx, ty + i, tz, log, true);
      // le chêne des marais étale une couronne large et basse
      var large = type === 'chene_marais';
      for (dy = -2; dy <= 1; dy++) {
        var rr = dy >= 0 ? 1 : 2;
        if (large && dy <= 0) rr = 3;
        for (dx = -rr; dx <= rr; dx++) for (dz = -rr; dz <= rr; dz++) {
          if (dy === 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
          if (dy < 0 && Math.abs(dx) === rr && Math.abs(dz) === rr) continue;
          if (large && Math.abs(dx) + Math.abs(dz) > 4) continue;
          put(tx + dx, ty + th - 1 + dy, tz + dz, leaves, false);
        }
      }
    }

    /* Registre des lumières : les torches générées (donjons) ET celles du
       joueur réappliquées depuis les overrides. On balaie le chunk entier
       plutôt que les seuls overrides : c'est ce qui fait éclairer les
       torches d'un donjon qu'aucun joueur n'a encore touché. */
    function enregistrerLumieres(c) {
      var bx = c.cx * CX, bz = c.cz * CZ, bl = c.blocks;
      for (var y = 0; y < WH; y++) for (var z = 0; z < CZ; z++) for (var x = 0; x < CX; x++) {
        var id = bl[idx(x, y, z)];
        if (!id) continue;
        var lv = C.lampeDe(id);
        if (lv > 0) lights.set(key3(bx + x, y, bz + z), { x: bx + x, y: y, z: bz + z, level: lv });
      }
    }
    // à la décharge, ses lumières partent avec lui : le rendu n'éclaire que le chargé
    function oublierLumieres(c) {
      var x0 = c.cx * CX, z0 = c.cz * CZ;
      lights.forEach(function (l, k) {
        if (l.x >= x0 && l.x < x0 + CX && l.z >= z0 && l.z < z0 + CZ) lights.delete(k);
      });
    }

    function getChunk(cx, cz, create) {
      var k = key(cx, cz), c = chunks.get(k);
      if (!c && create) { c = generateChunk(cx, cz); chunks.set(k, c); }
      return c;
    }

    function getBlock(wx, wy, wz) {
      if (wy < 0 || wy >= WH) return 0;
      wx = Math.floor(wx); wy = Math.floor(wy); wz = Math.floor(wz);
      var cx = Math.floor(wx / CX), cz = Math.floor(wz / CZ);
      var c = chunks.get(key(cx, cz));
      if (!c) return 0;
      return c.blocks[idx(wx - cx * CX, wy, wz - cz * CZ)];
    }

    /* État d'un bloc (SPEC-SAVE-017) : 0 si le chunk n'est pas chargé ou si
       aucun état particulier n'a été posé. Ne touche ni à `overrides` ni aux
       registres dérivés (lumières, cultures) : l'id du bloc reste seul
       responsable de ceux-ci. Depuis L24 (SPEC-CONSTR-001/002), les
       escaliers et les dalles y rangent orientation, inversion, forme
       d'angle ou moitié — voir formes.js (MC.Formes). */
    function getEtat(wx, wy, wz) {
      if (wy < 0 || wy >= WH) return 0;
      wx = Math.floor(wx); wy = Math.floor(wy); wz = Math.floor(wz);
      var cx = Math.floor(wx / CX), cz = Math.floor(wz / CZ);
      var c = chunks.get(key(cx, cz));
      if (!c || !c.etats) return 0;
      return c.etats[idx(wx - cx * CX, wy, wz - cz * CZ)];
    }
    function setEtat(wx, wy, wz, etat) {
      wx = Math.floor(wx); wy = Math.floor(wy); wz = Math.floor(wz);
      if (wy < 0 || wy >= WH) return false;
      var cx = Math.floor(wx / CX), cz = Math.floor(wz / CZ);
      var c = chunks.get(key(cx, cz));
      if (!c || !c.etats) return false;
      var e = Math.max(0, Math.min(255, etat | 0));
      // le chunk partage peut-être encore ETATS_VIDE (copy-on-write) : la
      // première écriture lui donne son propre tampon.
      if (c.etats === ETATS_VIDE) c.etats = new Uint8Array(ETATS_VIDE);
      c.etats[idx(wx - cx * CX, wy, wz - cz * CZ)] = e;
      c.dirty = true;
      c.version = (c.version || 1) + 1;
      var k3 = key3(wx, wy, wz);
      if (e) etatsOverrides.set(k3, e); else etatsOverrides.delete(k3);
      return true;
    }

    /* SPEC-MECA-007 : la commande (texte) d'un bloc de commande — un registre
       à part, même principe que `etatsOverrides` (rejoué après régénération
       ou chargement), un octet ne suffisant pas à porter du texte. */
    var commandesBloc = new Map();
    function getCommande(wx, wy, wz) { return commandesBloc.get(key3(Math.floor(wx), Math.floor(wy), Math.floor(wz))) || ''; }
    function setCommande(wx, wy, wz, texte) {
      var k3 = key3(Math.floor(wx), Math.floor(wy), Math.floor(wz));
      var t = String(texte || '').slice(0, 200);
      if (t) commandesBloc.set(k3, t); else commandesBloc.delete(k3);
      return t;
    }

    // `record` à false pour les changements internes (croissance) qu'on veut
    // quand même persister ; à true pour une action du joueur. Dans les deux cas
    // on enregistre : la distinction sert au cas où l'on voudrait les traiter à part.
    function setBlock(wx, wy, wz, id) {
      wx = Math.floor(wx); wy = Math.floor(wy); wz = Math.floor(wz);
      if (wy < 0 || wy >= WH) return false;
      var cx = Math.floor(wx / CX), cz = Math.floor(wz / CZ);
      var c = chunks.get(key(cx, cz));
      if (!c) return false;
      var lx = wx - cx * CX, lz = wz - cz * CZ;
      var avant = c.blocks[idx(lx, wy, lz)];
      c.blocks[idx(lx, wy, lz)] = id;
      c.dirty = true;
      c.version = (c.version || 1) + 1;
      // un bloc qui disparaît perd son état (orientation, moitié, forme d'angle…)
      if (id === 0 && avant !== 0) setEtat(wx, wy, wz, 0);
      /* Lumière : les sources du chunk ont peut-être changé, et les chunks à
         portée d'une source concernée doivent recalculer leur éclairage. */
      c.emetteurs = null;
      if (MC.Lumiere) {
        MC.Lumiere.chunksTouches(function (a, b) { return chunks.get(key(a, b)) || null; },
                                 wx, wy, wz, avant, id).forEach(function (t) { touch(t[0], t[1]); });
      }
      overrides.set(key3(wx, wy, wz), id);
      // un bloc changé redessine la carte de son chunk
      if (exploration) exploration.invalider(wx, wz);

      // registre des cultures
      var k3 = key3(wx, wy, wz);
      if (id === B.WHEAT0 || id === B.WHEAT1 || id === B.WHEAT2) {
        crops.set(k3, { x: wx, y: wy, z: wz, t: 0 });
      } else {
        crops.delete(k3);
      }

      // registre des mécanismes L29 (SPEC-MECA-008) — les portes et trappes
      // existantes y entrent aussi : un signal peut les ouvrir (C.bascule).
      var estMeca = C.BLOCKS[id] && (C.BLOCKS[id].circuit || C.estPorte(id) || C.estTrappe(id));
      if (estMeca) circuits.set(k3, [wx, wy, wz, id]);
      else circuits.delete(k3);

      // registre des sources de lumière
      if (C.lampeDe(id) > 0) lights.set(k3, { x: wx, y: wy, z: wz, level: C.lampeDe(id) });
      else lights.delete(k3);

      // l'eau alentour devra peut-être couler
      if (MC.Eau && (C.isWater(avant) || C.isWater(id) || eauVoisine(wx, wy, wz))) signalerEau(wx, wy, wz);

      /* L24 (SPEC-CONSTR-007) : le feu, sa propagation et son extinction se
         rejouent au prochain passage de coulerFeu — signalé dès qu'un feu
         apparaît/disparaît ici, ou qu'un matériau inflammable ou de la lave
         est posé (pour l'allumage à la lave). */
      if (MC.Feu && (id === B.FEU || avant === B.FEU || id === B.LAVA || avant === B.LAVA || C.isInflammable(id))) {
        signalerFeu(wx, wy, wz);
      }

      // un bloc de bordure change la silhouette du chunk voisin
      if (lx === 0) touch(cx - 1, cz);
      if (lx === CX - 1) touch(cx + 1, cz);
      if (lz === 0) touch(cx, cz - 1);
      if (lz === CZ - 1) touch(cx, cz + 1);
      /* Un bloc de COIN change aussi l'occlusion ambiante du chunk en
         diagonale : l'AO lit un voisinage 3×3. Oublier ce cas laissait des
         ombres de contact périmées aux quatre coins des chunks. */
      var bx2 = lx === 0 ? -1 : (lx === CX - 1 ? 1 : 0);
      var bz2 = lz === 0 ? -1 : (lz === CZ - 1 ? 1 : 0);
      if (bx2 && bz2) touch(cx + bx2, cz + bz2);
      return true;
    }
    function touch(cx, cz) {
      var n = chunks.get(key(cx, cz));
      if (n) { n.dirty = true; n.version = (n.version || 1) + 1; }
    }

    /* ─── écoulement de l'eau ───────────────────────────────────────────────
       Une file des cases à réexaminer : chaque changement près d'une eau y
       ajoute la case et ses six voisines. `coulerEau` en traite un lot et
       renvoie les changements appliqués (le serveur les diffuse). */
    var eauFile = new Map();
    var VOISINS6 = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    function eauVoisine(x, y, z) {
      for (var i = 1; i < 7; i++) if (C.isWater(getBlock(x + VOISINS6[i][0], y + VOISINS6[i][1], z + VOISINS6[i][2]))) return true;
      return false;
    }
    function signalerEau(x, y, z) {
      for (var i = 0; i < 7; i++) {
        var a = x + VOISINS6[i][0], b = y + VOISINS6[i][1], c2 = z + VOISINS6[i][2];
        if (b <= 0 || b >= WH) continue;
        eauFile.set(key3(a, b, c2), [a, b, c2]);
      }
    }
    function coulerEau(max) {
      var faits = [], n = 0;
      var lot = [];
      eauFile.forEach(function (p, k) { if (n++ < (max || 64)) { lot.push(p); eauFile.delete(k); } });
      lot.forEach(function (p) {
        if (!estCharge(p[0], p[2])) return;
        MC.Eau.ecouler(getBlock, p[0], p[1], p[2]).forEach(function (ch) {
          if (getBlock(ch[0], ch[1], ch[2]) === ch[3] || !estCharge(ch[0], ch[2])) return;
          setBlock(ch[0], ch[1], ch[2], ch[3]);
          faits.push(ch);
        });
      });
      return faits;
    }

    /* ─── le feu ─────────────────────────────────────────────────────────────
       Même schéma que l'eau : une file des cases à réexaminer, traitée par
       lots bornés (coulerFeu). `pluieIci` interroge la météo du monde (SEUL
       endroit qui la connaisse ici) : à ciel ouvert, sous une pluie ou une
       neige, un feu s'éteint. */
    var feuFile = new Map();
    function signalerFeu(x, y, z) {
      for (var i = 0; i < 7; i++) {
        var a = x + VOISINS6[i][0], b = y + VOISINS6[i][1], c2 = z + VOISINS6[i][2];
        if (b <= 0 || b >= WH) continue;
        feuFile.set(key3(a, b, c2), [a, b, c2]);
      }
    }
    function cielOuvert(x, y, z) {
      for (var yy = y + 1; yy < WH; yy++) if (getBlock(x, yy, z)) return false;
      return true;
    }
    function pluieIci(x, y, z, temps) {
      if (!meteo || temps === undefined || !cielOuvert(x, y, z)) return false;
      var et = meteo.etat(temps);
      var cl = Bio.climat(x, z);
      var bio = biomeAt ? biomeAt(x, z) : null;
      var tempC = meteo.temperature(cl.t, y, temps, et, bio && bio.id);
      var p = meteo.precipitation(x, z, temps, tempC, bio && bio.id, et);
      return !!p.forme;
    }
    function coulerFeu(max, temps, rand) {
      var faits = [], n = 0, lot = [];
      feuFile.forEach(function (p, k) { if (n++ < (max || 48)) { lot.push(p); feuFile.delete(k); } });
      function appliquer(ch) {
        setBlock(ch[0], ch[1], ch[2], ch[3]);
        setEtat(ch[0], ch[1], ch[2], ch[4] || 0);
        faits.push(ch);
      }
      lot.forEach(function (p) {
        if (!estCharge(p[0], p[2])) return;
        var id = getBlock(p[0], p[1], p[2]);
        if (id === B.FEU) {
          var pluie = pluieIci(p[0], p[1], p[2], temps);
          MC.Feu.etapeFeu(getBlock, getEtat, p[0], p[1], p[2], rand, pluie).forEach(appliquer);
        } else if (MC.Feu.inflammable(id)) {
          MC.Feu.allumerParLave(getBlock, p[0], p[1], p[2], rand).forEach(appliquer);
        }
      });
      return faits;
    }

    // sommet solide d'une colonne ; `natural` ignore troncs et feuillages
    function groundAt(bx, bz, natural) {
      for (var y = WH - 1; y > 0; y--) {
        var b = getBlock(bx, y, bz);
        if (!C.isSolid(b)) continue;
        if (natural && (C.isLog(b) || C.isLeaves(b))) continue;
        return y;
      }
      return 0;
    }

    // Prospecte via heightAt (pure) : on choisit où apparaître AVANT de générer.
    function findSpawnColumn() {
      for (var r = 0; r < 600; r += 4) {
        var steps = Math.max(1, (r / 2) | 0);
        for (var a = 0; a < steps; a++) {
          var ang = (a / steps) * Math.PI * 2;
          var bx = Math.round(Math.cos(ang) * r), bz = Math.round(Math.sin(ang) * r);
          if (heightAt(bx, bz) >= SEA + 3) return [bx, bz];
        }
      }
      return [0, 0];
    }

    /* SPEC-SAISON-006 : la croissance suit la saison — vite l'été (base),
       deux fois plus lentement au printemps et à l'automne, jamais l'hiver.
       Sans `opts.temps` (appelants qui ignorent l'heure, ou tests existants),
       la croissance garde son rythme d'origine. */
    function multCroissance(temps) {
      if (!MC.DayCycle || temps === undefined) return 1;
      var nom = MC.DayCycle.saison(temps).nom;
      if (nom === 'hiver') return null;
      return nom === 'ete' ? 1 : 2;
    }

    /* SPEC-SAISON-003 et SPEC-SAISON-005 : effets de surface de la saison —
       gel des eaux dormantes (les lacs, jamais la mer, l'océan ni l'eau
       courante) dans les régions froides, et couverture neigeuse du sol dans
       les régions tempérées — tous deux réversibles au printemps.
       Progressif et bon marché : à chaque appel on n'examine qu'UN chunk
       chargé (roulement), quel que soit le nombre de chunks en mémoire. On ne
       défait que ce qu'on a nous-même posé : banquise ou neige générées avec
       le monde, comme la glace ou la neige du joueur, restent intactes. */
    var GEL_CLIMAT_SEUIL = 0.38;           // plus froid que ça : les lacs y gèlent en hiver
    var NEIGE_CLIMAT_MIN = 0.26, NEIGE_CLIMAT_MAX = 0.55;   // bande tempérée : la neige s'y dépose
    var gelSaisonnier = new Map();         // key3 -> true (glace posée par la saison)
    var neigeSaisonniere = new Map();      // key3 -> id d'origine (sous la neige posée par la saison)
    var gelCurseur = 0;
    function tickSaisonSurface(hiver) {
      if (!chunks.size) return;
      var cles = Array.from(chunks.keys());
      var c = chunks.get(cles[gelCurseur % cles.length]);
      gelCurseur++;
      if (!c) return;
      for (var col = 0; col < CX * CZ; col++) {
        var lx = col % CX, lz = (col / CX) | 0;
        var wx = c.cx * CX + lx, wz = c.cz * CZ + lz;
        var nat = c.eau && c.eau.nature[col];
        if (MC.Eau && nat === MC.Eau.TYPES.lac) {
          if (Bio.climat(wx, wz).t >= GEL_CLIMAT_SEUIL) continue;
          var y = WH - 1;
          while (y > 0 && getBlock(wx, y, wz) === 0) y--;
          var id = getBlock(wx, y, wz);
          var k3 = key3(wx, y, wz);
          if (hiver) {
            if (id === B.WATER && getBlock(wx, y + 1, wz) === 0) {
              setBlock(wx, y, wz, B.ICE);
              gelSaisonnier.set(k3, true);
            }
          } else if (id === B.ICE && gelSaisonnier.has(k3)) {
            setBlock(wx, y, wz, B.WATER);
            gelSaisonnier.delete(k3);
          }
        } else if (!nat) {
          var cl = Bio.climat(wx, wz).t;
          if (cl < NEIGE_CLIMAT_MIN || cl > NEIGE_CLIMAT_MAX) continue;
          var y2 = WH - 1;
          while (y2 > 0 && getBlock(wx, y2, wz) === 0) y2--;
          var id2 = getBlock(wx, y2, wz);
          var k3n = key3(wx, y2, wz);
          if (hiver) {
            if (id2 === B.GRASS) {
              setBlock(wx, y2, wz, B.SNOW);
              neigeSaisonniere.set(k3n, id2);
            }
          } else if (id2 === B.SNOW && neigeSaisonniere.has(k3n)) {
            setBlock(wx, y2, wz, neigeSaisonniere.get(k3n));
            neigeSaisonniere.delete(k3n);
          }
        }
      }
    }

    /* L29 mécanismes (SPEC-MECA-008) : un tic de circuits toutes les 0.2 s
       (5 Hz — assez pour un répéteur perceptible, peu coûteux), et seulement
       sur les blocs `circuit` des chunks CHARGÉS (le registre en contient
       peut-être d'anciens chunks déchargés depuis). En ligne, c'est le
       serveur qui fait autorité (`opts.circuits === false` côté client, même
       convention que l'eau). */
    function tickCircuits(ctx) {
      var positions = [];
      circuits.forEach(function (p) { if (estCharge(p[0], p[2])) positions.push(p); });
      if (!positions.length) return [];
      var api = { getBlock: getBlock, getEtat: getEtat, setEtat: setEtat, setBlock: setBlock };
      return MC.Circuits.tick(positions, api, ctx || {});
    }

    // croissance du blé : chaque culture avance d'un stade après `stageTime`
    var eauT = 0, gelT = 0, circuitsT = 0, feuT = 0;
    function tick(dt, stageTime, rand, opts) {
      var st = stageTime || 14;
      var r = rand || Math.random;
      var grown = [];
      // l'eau coule quatre fois par seconde (hors ligne : en ligne, c'est le serveur)
      if (MC.Eau && !(opts && opts.eau === false)) {
        eauT += dt;
        if (eauT >= 0.25) { eauT = 0; coulerEau(96); }
      }
      if (MC.Circuits && !(opts && opts.circuits === false)) {
        circuitsT += dt;
        if (circuitsT >= 0.2) { circuitsT = 0; tickCircuits(opts && opts.circuitsCtx); }
      }
      var temps = opts && opts.temps;
      // le feu avance deux fois par seconde (SPEC-CONSTR-007)
      if (MC.Feu && !(opts && opts.feu === false)) {
        feuT += dt;
        if (feuT >= 0.5) { feuT = 0; coulerFeu(48, temps, r); }
      }
      var mult = multCroissance(temps);
      crops.forEach(function (c2) {
        if (mult === null) return;                    // pas l'hiver
        c2.t += dt;
        if (c2.t < st * mult) return;
        c2.t = 0;
        // la culture ne pousse que sur de la terre labourée
        if (getBlock(c2.x, c2.y - 1, c2.z) !== B.FARMLAND) return;
        if (r() > 0.75) return;                       // un peu d'irrégularité
        var cur = getBlock(c2.x, c2.y, c2.z);
        var s = C.BLOCKS[cur] && C.BLOCKS[cur].stage;
        if (s === undefined || s >= 3) return;
        setBlock(c2.x, c2.y, c2.z, C.WHEAT_STAGES[s + 1]);
        grown.push([c2.x, c2.y, c2.z, s + 1]);
      });
      if (MC.DayCycle && temps !== undefined) {
        gelT += dt;
        if (gelT >= 1) { gelT = 0; tickSaisonSurface(MC.DayCycle.saison(temps).nom === 'hiver'); }
      }
      return grown;
    }

    /* Après un chargement, `overrides` est rempli directement sans passer par
       setBlock : les registres dérivés doivent donc être reconstruits, sinon
       les torches posées avant la sauvegarde n'éclairent plus. */
    function rebuildRegistries() {
      lights.clear();
      circuits.clear();
      overrides.forEach(function (id, k) {
        if (C.lampeDe(id) > 0) {
          var p = k.split(',');
          lights.set(k, { x: +p[0], y: +p[1], z: +p[2], level: C.lampeDe(id) });
        }
        if (C.BLOCKS[id] && C.BLOCKS[id].circuit) {
          var p2 = k.split(',');
          circuits.set(k, [+p2[0], +p2[1], +p2[2], id]);
        }
      });
      // les torches générées des chunks déjà en mémoire (donjons)
      chunks.forEach(enregistrerLumieres);
      return lights.size;
    }

    /* Une torche ne tient que sur un bloc plein. Si son support disparaît,
       elle tombe — sinon on obtient des torches flottantes. */
    function dropUnsupported(wx, wy, wz) {
      var tombees = [];
      var voisins = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
      for (var i = 0; i < voisins.length; i++) {
        var v = voisins[i];
        var bx = wx + v[0], by = wy + v[1], bz = wz + v[2];
        var b = getBlock(bx, by, bz);
        var d = C.BLOCKS[b];
        if (!d || !d.needsSupport) continue;
        if (!hasSupport(bx, by, bz, d.needsSupport)) { setBlock(bx, by, bz, 0); tombees.push([bx, by, bz, b]); }
      }
      return tombees;
    }

    /* `mode` 'sol' : une plante ne tient que posée sur un bloc, jamais
       accrochée à un mur comme la torche. */
    function hasSupport(wx, wy, wz, mode) {
      if (C.isSolid(getBlock(wx, wy - 1, wz))) return true;
      if (mode === 'sol') return false;
      var lat = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < lat.length; i++)
        if (C.isSolid(getBlock(wx + lat[i][0], wy, wz + lat[i][1]))) return true;
      return false;
    }

    /* Remise a zero complete du monde. Regroupee ici parce que la disperser
       dans l'orchestrateur avait deja coute un bug : `lights` etait oublie et
       les torches de la partie precedente eclairaient le nouveau terrain.
       Un seul endroit a mettre a jour quand un registre s'ajoute. */
    function reset(onUnload) {
      if (onUnload) chunks.forEach(onUnload);
      chunks.clear();
      overrides.clear();
      etatsOverrides.clear();
      commandesBloc.clear();
      crops.clear();
      lights.clear();
      donjonsVaincus.clear();
      coffresPilles.clear();
      if (exploration) exploration.charger([]);
      if (reperes) { reperes.charger([]); reperes.suivi = null; }
      if (reputation) reputation.remettre();
      if (MC.Inventory) banque = MC.Inventory.create(27);
      pnjsMorts.clear();
      return true;
    }

    function unloadFar(pcx, pcz, radius, onUnload) {
      return unloadLoin([[pcx, pcz]], radius, onUnload);
    }

    /* Décharge les chunks loin de TOUS les centres (un par joueur local).
       Avec un seul centre, le joueur 2 d'un écran partagé qui s'éloignait
       voyait son sol déchargé sous ses pieds : il tombait dans le vide. */
    function unloadLoin(centres, radius, onUnload) {
      var lim = radius * radius;
      var removed = [];
      chunks.forEach(function (c, k) {
        for (var i = 0; i < centres.length; i++) {
          var dx = c.cx - centres[i][0], dz = c.cz - centres[i][1];
          if (dx * dx + dz * dz <= lim) return;
        }
        removed.push([k, c]);
      });
      removed.forEach(function (p) {
        if (onUnload) onUnload(p[1]);
        oublierLumieres(p[1]);
        chunks.delete(p[0]);
      });
      return removed.length;
    }

    /* Chunks à charger autour de plusieurs centres, du plus proche au plus
       lointain (distance au centre le plus proche). Sans doublons. */
    function chunksVoulus(centres, R) {
      var best = new Map();
      centres.forEach(function (ce) {
        for (var dx = -R; dx <= R; dx++) for (var dz = -R; dz <= R; dz++) {
          var d2 = dx * dx + dz * dz;
          if (d2 > R * R) continue;
          var k = key(ce[0] + dx, ce[1] + dz);
          var cur = best.get(k);
          if (!cur || cur[0] > d2) best.set(k, [d2, ce[0] + dx, ce[1] + dz]);
        }
      });
      var out = [];
      best.forEach(function (v) { out.push(v); });
      out.sort(function (a, b) { return a[0] - b[0]; });
      return out;
    }

    /* Les 8 voisins d'un chunk. Le mailleur lit le voisinage 3×3 (faces de
       bordure ET occlusion ambiante des coins) : c'est ce voisinage entier
       qui conditionne le maillage et que la génération doit invalider. */
    var VOISINS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    function voisinsCharges(cx, cz) {
      for (var i = 0; i < 8; i++) {
        if (!chunks.has(key(cx + VOISINS8[i][0], cz + VOISINS8[i][1]))) return false;
      }
      return true;
    }
    function marquerVoisins(cx, cz) {
      for (var i = 0; i < 8; i++) touch(cx + VOISINS8[i][0], cz + VOISINS8[i][1]);
    }
    // le bloc (x, z) appartient-il à un chunk en mémoire ?
    function estCharge(wx, wz) {
      return chunks.has(key(Math.floor(wx / CX), Math.floor(wz / CZ)));
    }

    // ─── donjons ─────────────────────────────────────────────────────────────
    function salleDonjon(x, y, z) { return donjons.salleA(x, y, z); }
    /* La salle d'un donjon moyen ou grand où se tient ce point : { donjon, index }. */
    function pieceDonjon(x, y, z) { return donjons.salleDe(x, y, z); }
    /* Butin d'un coffre de donjon jamais ouvert, ou null pour un coffre ordinaire. */
    function butinCoffre(x, y, z) {
      var c = donjons.coffreA(x, y, z);
      return c ? donjons.butin(c.donjon, c.indice) : null;
    }

    return {
      seed: seed, noise: N, chunks: chunks, overrides: overrides, crops: crops,
      etatsOverrides: etatsOverrides, getEtat: getEtat, setEtat: setEtat,
      commandesBloc: commandesBloc, getCommande: getCommande, setCommande: setCommande,
      lights: lights, circuits: circuits, tickCircuits: tickCircuits,
      rebuildRegistries: rebuildRegistries, reset: reset,
      hasSupport: hasSupport, dropUnsupported: dropUnsupported,
      genererBrut: genererBrut, integrerChunk: integrerChunk,
      heightAt: heightAt, isCave: isCave, getChunk: getChunk, getBlock: getBlock, setBlock: setBlock,
      groundAt: groundAt, findSpawnColumn: findSpawnColumn, tick: tick,
      unloadFar: unloadFar, unloadLoin: unloadLoin, chunksVoulus: chunksVoulus,
      voisinsCharges: voisinsCharges, marquerVoisins: marquerVoisins, estCharge: estCharge,
      chunkDe: function (cx, cz) { return chunks.get(key(cx, cz)) || null; },
      biomeAt: biomeAt, donjons: donjons, donjonsVaincus: donjonsVaincus,
      coffresPilles: coffresPilles, exploration: exploration, reperes: reperes, reputation: reputation,
      salleDonjon: salleDonjon, pieceDonjon: pieceDonjon, butinCoffre: butinCoffre,
      meteo: meteo, bio: Bio, echantillonLointain: echantillonLointain, habitats: habitats, routes: routes,
      densite: densite, pnjsMorts: pnjsMorts,
      get zones() { return zones; }, zonesEtat: zonesEtat, zoneEn: zoneEn, reglesZoneEn: reglesZoneEn,
      accorderPolitiqueZone: accorderPolitiqueZone,
      coulerEau: coulerEau, get eauEnAttente() { return eauFile.size; },
      coulerFeu: coulerFeu, get feuEnAttente() { return feuFile.size; }, pluieIci: pluieIci,
      get banque() { return banque; }, set banque(b) { banque = b; },
      key: key, key3: key3,
      /* Métriques du cache de bruit de grotte (SPEC-PERF-002), pour le banc de
         non-régression et les tests de fuite mémoire — jamais utilisé par la
         génération elle-même. */
      perf: {
        caveCacheSize: function () { return caveCoinsA.size + caveCoinsB.size + caveCoinsCav.size; },
        caveCachePas: { xz: CAVE_PAS_XZ, y: CAVE_PAS_Y },
      },
    };
  }

  MC.createWorld = createWorld;
})(typeof globalThis !== 'undefined' ? globalThis : this);
