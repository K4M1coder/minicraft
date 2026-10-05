/* serveur-etat.js — l'état autoritatif du monde
   Monde, entités, overrides indexés par chunk, chat, politique, guildes,
   économie, PvP, registres des joueurs, banques et conteneurs posés, horloge.

   Module du serveur (SPEC-SERVEUR-008) : extrait de server.js sans changement
   de comportement. Il ne touche ni socket ni fichier par lui-même : tout ce
   dont il dépend arrive par le contexte S (état partagé, fonctions des autres
   modules) et S.hote (minuteries, process, Buffer… de Node), que server.js
   construit puis passe à `installer(S)`. Installer publie dans S les
   fonctions et valeurs de ce module dont les autres ont besoin. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  function installer(S) {
    const { process, setImmediate } = S.hote;
    const { PARAMS, CONF, journal } = S;
    const EP = S.EP;   // état partagé modifiable, à forme fixe (créé par server.js)
    Object.assign(S, { banqueDe });

    const monde = MC.createWorld(CONF.graine, { zonePolitique: PARAMS.zone });
    S.monde = monde;
    const entites = MC.createEntities(monde);
    S.entites = entites;
    /* Index des overrides PAR CHUNK (SPEC-SERVEUR-009) : « cx,cz » → ensemble des clés
       « x,y,z » du chunk. Maintenu à chaque écriture (set/delete/clear de la Map du
       monde, patchés sur l'instance : le monde ne connaît pas l'index), pour qu'une
       OVERRIDES_DEMANDE coûte le nombre d'overrides DU CHUNK et non celui du monde
       entier (à 100 joueurs, des dizaines de demandes par seconde chacun). */
    const indexOverrides = new Map();
    S.indexOverrides = indexOverrides;
    /* Même index pour les états de bloc (SPEC-SAVE-017) : la génération d'un chunk n'y
       relit que les siens (monde.definirIndexOverrides plus bas) au lieu de parcourir
       toutes les modifications du monde à chaque chunk. */
    const indexEtatsOverrides = new Map();
    function cleChunkDe(k) { const p = k.split(','); return Math.floor(+p[0] / 16) + ',' + Math.floor(+p[2] / 16); }
    /* Une sauvegarde en cours de sérialisation (par tranches) doit apprendre toute
       modification AVANT qu'elle n'ait lieu, pour écrire l'instantané de son début
       (voir sauvegarderMondeAsync). `nom` : 'overrides' ou 'etats'. */
    EP.crochetModification = null;
    function indexerParChunk(ov, index, nom) {
      const set0 = ov.set.bind(ov), del0 = ov.delete.bind(ov), clr0 = ov.clear.bind(ov);
      ov.set = function (k, v) {
        if (EP.crochetModification) EP.crochetModification(nom, k);
        if (!ov.has(k)) { const c = cleChunkDe(k); let e = index.get(c); if (!e) index.set(c, e = new Set()); e.add(k); }
        return set0(k, v) && ov;
      };
      ov.delete = function (k) {
        if (EP.crochetModification) EP.crochetModification(nom, k);
        if (ov.has(k)) { const c = cleChunkDe(k), e = index.get(c); if (e) { e.delete(k); if (!e.size) index.delete(c); } }
        return del0(k);
      };
      ov.clear = function () { if (EP.crochetModification) EP.crochetModification(nom, null); index.clear(); return clr0(); };
      ov.forEach((v, k) => { const c = cleChunkDe(k); let e = index.get(c); if (!e) index.set(c, e = new Set()); e.add(k); });
    }
    indexerParChunk(monde.overrides, indexOverrides, 'overrides');
    if (monde.etatsOverrides) indexerParChunk(monde.etatsOverrides, indexEtatsOverrides, 'etats');
    monde.definirIndexOverrides((cx, cz, quoi) => (quoi === 'etats' ? indexEtatsOverrides : indexOverrides).get(cx + ',' + cz));
    const chat = MC.Chat.creer({ max: 120 });
    S.chat = chat;
    // SPEC-FACTION-006 à 013 : factions PNJ (royaumes, guildes marchandes, ordres,
    // bandits, cultes) et factions de joueurs — le serveur fait foi sur les deux.
    const politique = MC.Politique.creer(CONF.graine);
    S.politique = politique;
    // SPEC-FACTION-014 : le monde consulte désormais l'état politique à chaque
    // calcul de zone (zoneEn/reglesZoneEn) — jamais recalculé nulle part
    // ailleurs. Une référence mutable : `politique` continue d'être modifiée en
    // place jour après jour (tourDuMonde), monde.definirFactionsPolitiques ne
    // se rappelle donc qu'une fois.
    if (monde.definirFactionsPolitiques) monde.definirFactionsPolitiques(politique);
    /* MC_TEST_QUETE=1 : injecte une faction politique déterministe (ressources
       sous le seuil bas, objectif 'commercer') au démarrage, SEULEMENT pour que
       tests/integration-quetes.js exerce le VRAI chemin (traiterQuete →
       MC.Politique.questesDe/accepterQuete/remettreQuete → inventaire réel) sans
       dépendre d'une ville explorée procéduralement — le même principe que
       MC_TEST_INV (voir plus bas) pour l'inventaire, jamais en exploitation. */
    if (process.env.MC_TEST_QUETE) {
      const idF = 'test:quete-e2e';
      politique.factions.set(idF, {
        id: idF, type: 'ordre', nom: 'Faction de test', caractere: 'pragmatique',
        siege: { x: 0, z: 0, site: idF }, territoire: 100,
        ressources: { or: 5, nourriture: 5 }, objectif: 'commercer', objectifs: ['commercer'],
        naissance: 0,
      });
    }
    /* MC_TEST_CATASTROPHE=1 : place un lieu habité SYNTHÉTIQUE (mais de forme
       réelle — mêmes champs que MC.Habitats.creer en produit) à une position
       fixe, et fait apparaître une tornade RÉELLE à cet endroit via
       `monde.meteo.tornades` (une vraie fonction du monde, simplement patchée
       pour renvoyer un événement en plus des siens) — SEULEMENT pour que
       tests/integration-quetes.js exerce le VRAI chemin serveur
       (avancerCatastrophes → MC.Habitats.endommagerLieu/migrerPopulation/
       queteCatastrophe → diffusion chat → /quete lister), sans attendre qu'une
       vraie tornade procédurale croise une vraie ville explorée — le même
       principe que MC_TEST_INV/MC_TEST_QUETE, jamais en exploitation. */
    let MC_TEST_LIEU_CATASTROPHE = null;
    if (process.env.MC_TEST_CATASTROPHE) setImmediate(() => journal('ATTENTION : MC_TEST_CATASTROPHE actif — un lieu et une tornade FICTIFS sont ajoutés (réglage de test, jamais en exploitation)'));
    if (process.env.MC_TEST_CATASTROPHE && monde.meteo && monde.habitats) {
      MC_TEST_LIEU_CATASTROPHE = {
        id: 'test:lieu-catastrophe', kind: 'village', nom: 'Bourg de test', x: 0, z: 0, demi: 40,
        blocs: new Map([['0,0', (function () {
          var a = []; for (var i = 0; i < 40; i++) a.push(i, 60, 0, 1, 0); return a;
        })()]]),
        pnjs: [{ id: 'test:lieu-catastrophe#0', role: 'habitant', nom: 'Test', x: 0, y: 60, z: 0, lieu: 'test:lieu-catastrophe' }],
        batiments: [],
      };
      const lieuxProchesOrig = monde.habitats.lieuxProches.bind(monde.habitats);
      monde.habitats.lieuxProches = (x, z, rayon, lire) => lieuxProchesOrig(x, z, rayon, lire).concat([MC_TEST_LIEU_CATASTROPHE]);
      const tornadesOrig = monde.meteo.tornades.bind(monde.meteo);
      monde.meteo.tornades = (t) => tornadesOrig(t).concat([{ id: 'test-tornade', x: 0, z: 0, rayon: 60, force: 1, vie: 10, sens: 1 }]);
    }
    /* MC_TEST_ECLAIR=1 : un éclair toutes les 2 s de monde, qui tombe SUR le joueur
       (la portée, l'abri et les dégâts restent ceux du serveur, `foudroie` réel) —
       SEULEMENT pour que tests/integration-archi-env.js exerce le vrai chemin de
       la foudre sans attendre un orage de la météo procédurale. Jamais en
       exploitation (même principe que MC_TEST_CATASTROPHE). */
    if (process.env.MC_TEST_ECLAIR) setImmediate(() => journal('ATTENTION : MC_TEST_ECLAIR actif — un éclair FICTIF tombe sur chaque joueur toutes les 2 s (réglage de test, jamais en exploitation)'));
    if (process.env.MC_TEST_ECLAIR && monde.meteo) {
      monde.meteo.eclairs = (t0, t1) => (Math.floor(t1 / 2) > Math.floor(t0 / 2) ? [{ id: Math.floor(t1 / 2), force: 1, t: t1 }] : []);
      monde.meteo.lieuEclair = (e, px, pz) => ({ x: Math.floor(px), z: Math.floor(pz) });
    }
    const guildes = MC.Guildes.creerEtat();
    S.guildes = guildes;
    MC.Guildes.lierPolitique(guildes, politique);   // SPEC-FACTION-017 : dissoudre une faction de joueurs retire ses relations envers les PNJ
    // L45 : prix dynamiques, trésors de lieux, métiers (SPEC-ECO/METIER) — même
    // module et même état joués à l'identique en solo (game.js) et ici.
    const economie = MC.Economie.creerEtat(CONF.graine);
    S.economie = economie;
    // SPEC-QUETE-004 : tableau des quêtes ACTIVES de chaque joueur (nom -> [...]),
    // tenu et arbitré ICI, jamais par un client — accepterQuete/remettreQuete
    // (politique.js) sont les seules portes d'entrée qui font foi, empêchant
    // une double remise même si deux clients l'envoient en même temps.
    EP.quetesJoueurs = new Map();
    // B4 (docs/vague-2/B4.md) : butin, meurtres non consentis, réputation,
    // hors-la-loi, duels et victoires PvP. Déclaré ICI (avant `etatMonde`/
    // `appliquerEtatMonde`, appelée dès la reprise `--monde` plus bas dans ce
    // fichier), même raison que `joueursRegistre`/`banques` juste au-dessus dans
    // B1 : une `const` lue avant sa déclaration lexicale planterait au démarrage.
    const pvp = MC.PvpEnjeux.creerEtat();
    S.pvp = pvp;
    // SPEC-MECA-001 : contenu des distributeurs — le serveur fait foi sur ce qui
    // s'éjecte sur signal (voir NP.MSG.DISTRIB et monde.tickCircuits plus bas).
    // B1 (étape 7, SPEC-SYNC-012/013) : un distributeur est maintenant un
    // conteneur POSÉ comme un autre — il vit dans `conteneursPoses`, plus de Map
    // séparée (ce qui le fait aussi persister dans etatMonde, § 8 du plan).
    // B1 (SPEC-SYNC-007 à 017) : registre des joueurs nommés et banques — déclarés
    // ICI (avant `appliquerEtatMonde`, qui les lit dès la reprise `--monde` au
    // démarrage, plus bas dans ce fichier) et non près du reste de la section
    // inventaire/conteneurs (server.js § « inventaire et conteneurs ») pour éviter
    // une zone morte temporelle (`const` lu avant sa déclaration lexicale).
    const joueursRegistre = new Map();   // cleRegistre(nom, j) → enregistrement { v:1, inv, equip, banque }
    S.joueursRegistre = joueursRegistre;
    const banques = new Map();           // cleRegistre(nom, j) → conteneur 'banque' (API figée, § 5 du plan)
    S.banques = banques;
    // B1 (étape 7, docs/vague-2/B1.md § 7) : registre des conteneurs POSÉS — coffre,
    // fourneau, armoire, étagère, bibliothèque, distributeur (PAS la banque, ni la
    // grille : par joueur, voir plus haut/plus bas). `js.conteneurOuvert` (sur
    // chaque joueur local, voir creerJoueurServeur) tient lieu d'abonnement : un
    // seul conteneur posé ouvert à la fois par joueur local, comme à l'écran —
    // revérifié (abonnement ET portée) à CHAQUE opération par `resoudreConteneur`.
    const conteneursPoses = new Map();   // cle 'x,y,z' → conteneur MC.Conteneurs
    S.conteneursPoses = conteneursPoses;
    /* SPEC-SYNC-027 : l'objet exposé sur un présentoir ou un socle — pas un conteneur à
       grille mais UN emplacement par case, tenu par le serveur. Déclaré ICI (avant
       `appliquerEtatMonde`, appelée dès la reprise `--monde`), comme `conteneursPoses`. */
    const expositions = new Map();       // cle 'x,y,z' → { id, n: 1, data?, dmg? }
    S.expositions = expositions;
    // dernier instantané ENVOYÉ d'un fourneau (cadence de message ≤ 2 Hz,
    // SPEC-SYNC-015) — la cuisson elle-même tourne à chaque tic (SPEC-SYNC-016).
    const derniereEmissionFour = new Map();
    S.derniereEmissionFour = derniereEmissionFour;
    function banqueDe(cleReg) {
      let b = banques.get(cleReg);
      if (!b) { b = MC.Conteneurs.creerConteneur('banque'); banques.set(cleReg, b); }
      return b;
    }
    EP.heure = 60;
  }

  MC.ServeurEtat = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
