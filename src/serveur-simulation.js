/* serveur-simulation.js — le monde vivant
   Lieux peuplés, politique et guildes, catastrophes, tornades, donjons,
   économie et caravanes, point d'apparition.

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
    const { Buffer, process, setTimeout } = S.hote;
    const {
      NP, C, CA, CONF, PARAMS_HISTOIRE, regles, monde, entites, chat, politique, guildes,
      economie, banques, histoireMonde, sauvegarderMondeAsync, journal,
    } = S;
    const EP = S.EP;   // état partagé modifiable, à forme fixe (créé par server.js)
    Object.assign(S, {
      peuplerLieux, avancerPolitique, diffuserPolitiqueSiChangee, animerPatrouilles, diffuserMembresFaction,
      envoyerPolitiqueComplete, avancerCatastrophes, etapesCatastrophe,
      appliquerTornades, surveillerDonjonsServeur, avancerEconomie,
      avancerCaravanes, offresPour, abriServeur,
    });

    /* Les habitants des villes et villages proches des joueurs : le serveur les
       fait vivre, comme toutes les créatures. Un habitant tué ne renaît pas. */
    const pnjsSuivis = new Map();                 // les morts : monde.pnjsMorts (identifiant → heure)
    function peuplerLieux() {
      if (!monde.habitats) return;
      pnjsSuivis.forEach((e, id) => {
        if (entites.list.indexOf(e) >= 0) return;
        if (e.hp <= 0) monde.pnjsMorts.set(id, EP.heure);
        pnjsSuivis.delete(id);
      });
      const lieux = [];
      S.tousLesJoueurs().forEach(({ js }) => {
        const p = js.joueur.state.pos;
        monde.habitats.lieuxProches(p.x, p.z, 90).forEach(l => { if (lieux.indexOf(l) < 0) lieux.push(l); });
      });
      MC.Habitats.pnjsManquants(lieux, entites.list, monde.pnjsMorts, EP.heure).forEach(p => {
        if (!monde.estCharge(p.x, p.z)) return;
        const e = entites.spawn('villager', p.x, p.y + 0.05, p.z,
                                { pnj: p.id, role: p.role, nom: p.nom, foyer: { x: p.x, z: p.z }, lieu: p.lieu });
        pnjsSuivis.set(p.id, e);
      });
    }
    /* SPEC-FACTION-006/007/008 : les royaumes et guildes marchandes se découvrent
       au fil des villes/mégapoles explorées par les joueurs (comme les habitants,
       habitats.js ne connaît que ce qui a été chargé) ; la simulation avance d'un
       jour de jeu à la fois, rattrapée d'un coup si le serveur est resté longtemps
       sans public — toujours de façon déterministe (graine + jour). Chaque
       naissance et chaque événement notable (raid, alliance, guerre…) s'annonce
       dans le chat, comme un message système. */
    /* `lieux` : contexte de l'entretien — { positions, proches(x, z, rayon) } préparé par
       le cycle des lieux (cycleLieux) ; par défaut, les positions actuelles et
       habitats.lieuxProches direct. */
    function lieuxEntretien(lieux) {
      if (lieux) return lieux;
      return { positions: S.tousLesJoueurs().map(({ js }) => js.joueur.state.pos), proches: (x, z, r) => monde.habitats.lieuxProches(x, z, r) };
    }
    function avancerPolitique(lieux) {
      if (monde.habitats) {
        const sites = [];
        const L = lieuxEntretien(lieux);
        L.positions.forEach(p => {
          L.proches(p.x, p.z, 300).forEach(l => {
            if ((l.kind === 'ville' || l.kind === 'megapole') && !sites.some(s => s.id === l.id)) {
              sites.push({ id: l.id, kind: l.kind, x: l.x, z: l.z, nom: l.nom });
            }
          });
        });
        MC.Politique.decouvrir(politique, sites);
      }
      const jourCourant = Math.floor(EP.heure / MC.DayCycle.DAY_LENGTH);
      if (jourCourant <= politique.jour) return;
      /* Les annonces nées pendant ces jours : la liste est bornée (les plus
         anciennes en sortent), d'où le compteur monotone `nbAnnonces` — compter
         sur la longueur ne voyait plus rien passer une fois la liste pleine. Au
         plus ANNONCES_DIFFUSEES_MAX par rattrapage (les plus récentes) : un monde
         aux centaines de factions en produit trop pour le chat. */
      const avant = politique.nbAnnonces || 0;
      /* Au plus JOURS_POLITIQUE_PAR_TIC jour(s) simulé(s) par appel : un saut
         d'horloge (/admin heure) ou une partie rechargée en retard se rattrapent
         sur plusieurs entretiens au lieu de bloquer la boucle (≈ 20 ms par jour
         pour ≈ 340 factions). Même état final que d'un coup. */
      MC.Politique.rattraper(politique, jourCourant, JOURS_POLITIQUE_PAR_TIC);
      MC.Politique.annoncesDepuis(politique, avant, ANNONCES_DIFFUSEES_MAX).forEach(a => {
        const m = chat.systeme(a.texte);
        if (m) S.diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
      });
    }
    const ANNONCES_DIFFUSEES_MAX = 12, JOURS_POLITIQUE_PAR_TIC = 1;

    /* SPEC-FACTION-007 : les rondes décidées par la simulation (MC.Politique,
       à gros grain, partout) prennent corps près des joueurs : des gardes en
       marche suivent le tracé de la ronde (entities.js, `e.patrouille`). Une fois
       par seconde (cadence d'entretien) : rondes visibles = factions × positions
       des joueurs, plafonnées (PATROUILLES_MAX × 3 gardes) ; un garde tombé ne
       renaît pas avant la ronde suivante ; une ronde finie ou loin de tout
       joueur rend ses gardes. */
    const RAYON_RONDES = 160;
    const gardesRonde = new Map();          // `${faction}#${jour}#${i}` → entité
    const gardesTombes = new Set();         // même clé : tué pendant la ronde
    function animerPatrouilles() {
      const positions = S.tousLesJoueurs().map(({ js }) => js.joueur.state.pos);
      const voulues = new Map();
      MC.Politique.patrouillesVisibles(politique, positions, RAYON_RONDES, politique.jour).forEach(r => {
        for (let i = 0; i < r.gardes; i++) voulues.set(r.faction + '#' + r.jour + '#' + i, { r, i });
      });
      const plan = MC.Politique.planifierGardes(voulues, gardesRonde, gardesTombes,
                                                e => entites.list.indexOf(e) >= 0 && !e.dead);
      plan.retirer.forEach(e => entites.remove(e));
      plan.creer.forEach(({ cle, voulu: { r, i } }) => {
        const n = r.points.length, k = (i * 2) % n, p = r.points[k];
        if (!monde.estCharge(p.x, p.z)) return;
        const e = entites.spawn('garde', p.x + 0.5, monde.groundAt(p.x, p.z, true) + 1.05, p.z + 0.5,
                                { patrouille: { faction: r.faction, jour: r.jour, points: r.points, i: (k + 1) % n } });
        if (e) gardesRonde.set(cle, e);
      });
      MC.Politique.purgerGardesTombes(gardesTombes, politique.jour, 512);
    }
    S.gardesRonde = gardesRonde;

    /* SPEC-FACTION-012 : chaque membre voit sur sa carte les autres membres
       CONNECTÉS de ses factions (principale et secondaires) — et rien d'autre :
       le message ne part qu'à un client dont le joueur est membre, avec les
       seules positions de ces factions-là. Une fois par seconde, seulement si la
       liste a changé (positions arrondies au bloc), et une liste vide une fois
       quand il n'y a plus personne à montrer. Coût : joueurs × membres. */
    function diffuserMembresFaction() {
      const parNom = new Map();
      S.tousLesJoueurs().forEach(({ c, j, js }) => { if (j === 0 && c.nom) parNom.set(c.nom, js.joueur.state.pos); });
      S.clients.forEach(c => {
        if (!c.rejoint || !c.nom) return;
        const fs = MC.Guildes.factionsDe(guildes, c.nom);
        const ids = (fs.principale ? [fs.principale] : []).concat(fs.secondaires);
        const l = [], vus = new Set();
        ids.forEach(fid => MC.Guildes.membresDe(guildes, fid).forEach(nom => {
          if (nom === c.nom || vus.has(nom + '#' + fid) || l.length >= CA.BORNES.FACTION_MEMBRES_MAX) return;
          const p = parNom.get(nom);
          if (!p) return;
          vus.add(nom + '#' + fid);
          l.push([nom, Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10, fid]);
        }));
        const empreinte = l.map(e => e[0] + ',' + Math.round(e[1]) + ',' + Math.round(e[2]) + ',' + e[3]).join(';');
        if (empreinte === (c.membresVus === undefined ? '' : c.membresVus)) return;
        c.membresVus = empreinte;
        S.envoyer(c, { t: CA.MSG.FACTION_MEMBRES, l });
      });
    }
    /* SPEC-SYNC-024 : l'état des relations de faction tel qu'un client le reçoit.
       `pol` : factions PNJ et leurs relations, complet au join puis par
       différences (MC.Politique.instantaneReseau / suivreReseau — taille et coût
       bornés, rien n'est sérialisé quand rien ne change) ; `guildes` : factions de
       joueurs avec membres et relations (sans candidatures ni invitations), petites
       (bornées par les joueurs), renvoyées entières quand une commande /faction a
       réussi. Le client les relit (MC.Politique.appliquerReseau, MC.Guildes.charger). */
    function guildesReseau() {
      const g = MC.Guildes.serialiser(guildes);
      return {
        v: g.v, prochainId: g.prochainId, joueurs: g.joueurs,
        factions: g.factions.map(([id, f]) => [id, { nom: f.nom, couleur: f.couleur, emblem: f.emblem, devise: f.devise,
          creeLe: f.creeLe, membres: f.membres, relations: f.relations }]),
      };
    }
    let suiviPolitique = null;
    EP.guildesSales = false;
    /* À tous les joueurs AYANT REJOINT (jamais une socket qui n'a pas dit qui elle
       est) : une trame encodée une fois. */
    function diffuserAuxJoueurs(msg, saufId) {
      const trame = NP.encoder(JSON.stringify(msg), NP.OP.TEXTE, Buffer.alloc);
      S.clients.forEach(c => {
        if (c.id === saufId || !c.vivant || !c.rejoint) return;
        try { c.socket.write(trame); } catch (e) { S.fermer(c, 'ecriture impossible'); }
      });
    }
    /* Une fois par seconde, après chaque commande /faction et avant chaque envoi
       complet à un nouveau venu : les seuls changements depuis le dernier envoi. */
    function diffuserPolitiqueSiChangee(saufId) {
      if (!suiviPolitique) suiviPolitique = MC.Politique.suivreReseau(politique);
      const d = suiviPolitique.prendre();
      const g = EP.guildesSales;
      EP.guildesSales = false;
      if (!d && !g) return;
      const m = { t: NP.MSG.POLITIQUE };
      if (d) m.pol = d.complet ? MC.Politique.instantaneReseau(politique) : d;
      if (g) m.guildes = guildesReseau();
      diffuserAuxJoueurs(m, saufId);
    }
    /* L'état complet, pour un nouveau venu : les différences en attente partent
       d'abord aux autres (sinon le nouveau venu les recevrait deux fois). `moi` :
       son nom tel que le serveur le connaît (membres des guildes). */
    function envoyerPolitiqueComplete(c) {
      diffuserPolitiqueSiChangee(c.id);
      S.envoyer(c, { t: NP.MSG.POLITIQUE, pol: MC.Politique.instantaneReseau(politique), guildes: guildesReseau(), moi: c.nom });
    }
    // ── catastrophes environnementales (SPEC-ENV-001/002/004, SPEC-QUETE-003) ──
    // clé "lieuId:evenementId" déjà appliquée — un cyclone/une tornade dure
    // plusieurs minutes/heures : sans ce registre, chaque tick le réappliquerait.
    const catastrophesAppliquees = new Set();
    // quêtes de reconstruction/secours proposées par les lieux touchés (à côté
    // de MC.Politique.quetesActives(politique), qui ne connaît que les quêtes de
    // FACTION — celles-ci sont proposées par un LIEU, pas par une faction).
    EP.quetesCatastrophe = [];
    /* Déclenchée par la VRAIE météo/le VRAI volcanisme du monde (monde.meteo,
       monde.bio), jamais par un appel isolé : pour chaque lieu habité proche
       d'un joueur, une tornade/un cyclone actif qui le traverse endommage
       réellement ses bâtiments (ENV-001), fait migrer sa population vers le
       lieu viable le plus proche (ENV-004) et propose une quête de secours
       (QUETE-003) ; cette fonction ne touche PAS aux routes elle-même (ENV-002
       est câblée côté client, dans `src/game.js:convois`, seul vrai système de
       caravane actif du jeu — voir `MC.Routes.trajetsAffectesParEruption`,
       consultée là, pas ici). */
    function avancerCatastrophes(lieuxCtx) {
      if (!monde.habitats || !monde.meteo) return;
      const lieux = [];
      const L = lieuxEntretien(lieuxCtx);
      L.positions.forEach(p => {
        L.proches(p.x, p.z, 1500).forEach(l => { if (lieux.indexOf(l) < 0) lieux.push(l); });
      });
      if (!lieux.length) return;
      const evenements = (monde.meteo.tornades ? monde.meteo.tornades(EP.heure) : [])
        .map(t => Object.assign({ genre: 'tornade' }, t))
        .concat((monde.meteo.cyclones ? monde.meteo.cyclones(EP.heure) : []).map(c => Object.assign({ genre: 'cyclone' }, c)));
      lieux.forEach(l => {
        evenements.forEach(evt => {
          const d = Math.hypot(evt.x - l.x, evt.z - l.z);
          if (d > (l.demi || 0) + (evt.rayon || 0)) return;
          const cle = l.id + ':' + evt.id;
          if (catastrophesAppliquees.has(cle)) return;
          catastrophesAppliquees.add(cle);
          if (catastrophesAppliquees.size > 5000) catastrophesAppliquees.clear();
          // SPEC : appliquée plus tard (voisin cherché par étapes), mais à l'heure de sa DÉTECTION
          catastrophesEnAttente.push({ l, evt, heure: EP.heure });
          if (catastrophesEnAttente.length > S.TS.BUDGETS.ATTENTE_CATASTROPHES_MAX) {
            const oubliee = catastrophesEnAttente.shift();
            journal('catastrophe en attente abandonnée (file pleine) : ' + oubliee.l.id + ' / ' + oubliee.evt.id);
          }
        });
      });
      EP.quetesCatastrophe = EP.quetesCatastrophe.filter(q => MC.Habitats.queteActive(q, EP.heure));
    }
    /* Le voisin le plus proche d'un lieu frappé (celui qui recueille ses habitants)
       se cherche à 3000 blocs : des milliers de régions de lieux, bien plus que les
       caches n'en gardent — plusieurs centaines de millisecondes d'un coup (mesuré).
       La recherche se fait donc une région à la fois, dans le budget des tics
       (prepCatastrophes), dans l'ordre exact de habitats.lieuxProches : même
       voisin retenu (le plus proche ; à égalité, le premier rencontré), puis les
       mêmes effets, appliqués quelques tics plus tard. */
    const RAYON_MIGRATION = 3000;
    const catastrophesEnAttente = [];
    S.catastrophesEnAttente = catastrophesEnAttente;
    function etapesCatastrophe(l, evt, heureDetection) {
      const x0 = l.x - RAYON_MIGRATION, z0 = l.z - RAYON_MIGRATION, x1 = l.x + RAYON_MIGRATION, z1 = l.z + RAYON_MIGRATION;
      let voisin = null, dVoisin = Infinity;
      const etapes = monde.habitats.regionsDansZone(x0, z0, x1, z1).map(r => () => {
        const v = monde.habitats.lieuDeRegion(r[0], r[1], r[2]);
        if (!v || v.x + v.demi < x0 || v.x - v.demi > x1 || v.z + v.demi < z0 || v.z - v.demi > z1) return;
        const d = Math.hypot(v.x - l.x, v.z - l.z);
        if (d > RAYON_MIGRATION || v.id === l.id || !v.pnjs || !v.pnjs.length) return;
        if (d < dVoisin) { dVoisin = d; voisin = v; }
      });
      etapes.push(() => {
        const entry = MC.Habitats.endommagerLieu(l, [{ x: evt.x, z: evt.z, rayon: evt.rayon, force: evt.force }],
                                                  CONF.graine, heureDetection, evt.genre);
        if (!entry || !entry.blocs) return;
        if (voisin) MC.Habitats.migrerPopulation(l, voisin, entry.ampleur, CONF.graine);
        const q = MC.Habitats.queteCatastrophe(l, entry);
        if (q && !EP.quetesCatastrophe.some(x => x.id === q.id)) {
          EP.quetesCatastrophe.push(q);
          if (EP.quetesCatastrophe.length > 40) EP.quetesCatastrophe.shift();
          const m = chat.systeme(l.nom + ' a été frappé par ' + (evt.genre === 'cyclone' ? 'un cyclone' : 'une tornade') +
                                  ' : une quête de secours est proposée (/quete lister).');
          if (m) S.diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
        }
      });
      return etapes;
    }
    /* SPEC-ARCHI-022 : les tornades POUSSENT et ARRACHENT côté serveur — seul le
       serveur modifie vitesse et blocs ; le client ne fait que le rendu. Même
       poussée que l'ancienne simulation cliente (aspiration, rotation, soulèvement
       de `Meteo.pousseeTornade`), appliquée aux joueurs qui ne volent pas et à
       toutes les créatures ; les plantes et feuillages du cœur d'une tornade
       proche d'un joueur sont arrachés (BLOC diffusé). */
    let accArrachage = 0;
    function appliquerTornades(dt, joueurs) {
      const me = monde.meteo;
      if (!me || !me.tornades || !me.pousseeTornade || !joueurs.length) return;
      const ts = me.tornades(EP.heure);
      if (!ts.length) return;
      const pousser = (pos, vel, k) => {
        if (!ts.some(t => Math.hypot(t.x - pos.x, t.z - pos.z) < t.rayon * 2.2)) return;   // hors de portée d'action
        const sol = monde.heightAt(Math.floor(pos.x), Math.floor(pos.z));
        const f = me.pousseeTornade(pos.x, Math.max(0, pos.y - sol), pos.z, EP.heure, ts);
        if (Math.abs(f.x) + Math.abs(f.y) + Math.abs(f.z) < 0.01) return;
        vel.x += f.x * dt * 3 * k; vel.z += f.z * dt * 3 * k;
        vel.y = Math.min(12, vel.y + f.y * dt * 5 * k);
      };
      joueurs.forEach(({ js }) => { const st = js.joueur.state; if (!st.dead && !st.flying) pousser(st.pos, st.vel, 1); });
      entites.list.forEach(e => { if (!e.dead && e.pos && e.vel) pousser(e.pos, e.vel, 1.3); });
      accArrachage += dt;
      if (accArrachage < 0.2) return;
      accArrachage = 0;
      ts.forEach(t => {
        if (!joueurs.some(({ js }) => Math.hypot(t.x - js.joueur.state.pos.x, t.z - js.joueur.state.pos.z) <= 160)) return;
        for (let k = 0; k < 4; k++) {
          const a = Math.random() * 6.2832, r = Math.random() * t.rayon;
          const x = Math.floor(t.x + Math.cos(a) * r), z = Math.floor(t.z + Math.sin(a) * r);
          if (!monde.estCharge(x, z)) continue;
          let y = Math.min(C.WORLD_H - 1, monde.heightAt(x, z) + 12);
          while (y > 1 && !monde.getBlock(x, y, z)) y--;
          const d = C.BLOCKS[monde.getBlock(x, y, z)];
          if (d && (d.plant || d.leaves) && !d.aquatique) {
            monde.setBlock(x, y, z, 0);
            S.diffuser({ t: NP.MSG.BLOC, x, y, z, id: 0 });
          }
        }
      });
    }
    /* SPEC-ARCHI-034 : les gardes et gardiens des donjons s'éveillent côté serveur
       (auparavant réservé au jeu hors ligne : en ligne aucun gardien n'apparaissait).
       Mêmes conditions qu'avant : un donjon vaincu ne se réveille pas ; les gardes
       d'une salle s'éveillent une fois. */
    function surveillerDonjonsServeur() {
      if (!regles.monstres) return;
      S.tousLesJoueurs().forEach(({ js }) => {
        const p = js.joueur.state;
        if (p.dead) return;
        const pc = monde.pieceDonjon && monde.pieceDonjon(p.pos.x, p.pos.y + 0.5, p.pos.z);
        if (pc && !monde.donjonsVaincus.has(pc.donjon.id) && entites.invoquerGardes(pc.donjon, pc.index).length) {
          const m = chat.systeme('Des gardes vous barrent la route !');
          if (m) S.diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
        }
        const d = monde.salleDonjon(p.pos.x, p.pos.y + 0.5, p.pos.z);
        if (!d || monde.donjonsVaincus.has(d.id)) return;
        const b = entites.invoquerGardien(d);
        if (b) {
          // SPEC-AUDIO-005 : le réveil s'entend, là où le gardien se dresse (diffusé par serveur-tic, message SONS)
          (S.sonsEnAttente || (S.sonsEnAttente = [])).push({ k: 'gardien', e: b.type, x: Math.round(b.pos.x * 10) / 10,
                                                            y: Math.round(b.pos.y * 10) / 10, z: Math.round(b.pos.z * 10) / 10 });
          const m = chat.systeme(entites.SPECS[b.type].nom + " s'éveille !");
          if (m) S.diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
        }
      });
    }
    // ── économie (B2, L45) ───────────────────────────────────────────────────────
    /* SPEC-ECO/METIER : avance l'économie d'un jour de jeu à la fois (comme
       avancerPolitique), rattrapée d'un coup si besoin, sur les lieux déjà
       connus de `economie` (ceux que `offresPour`/TROC ont créés — un lieu
       jamais visité n'existe pas encore, § 13 du plan). Applique aussi le frais
       de garde quotidien sur CHAQUE banque connue : la Map `banques` (canon(nom)
       → conteneur banque du joueur) est fournie par B1 (inventaire et
       conteneurs serveur, L43) — tant que B1 n'est pas fusionné, elle n'existe
       pas et ce bloc ne fait simplement rien (attendu, voir docs/vague-2/B2.md). */
    function avancerEconomie() {
      const jourCourant = Math.floor(EP.heure / MC.DayCycle.DAY_LENGTH);
      const saisonJour = MC.DayCycle.saison ? MC.DayCycle.saison(EP.heure).nom : 'ete';
      while (economie.jour < jourCourant) MC.Economie.tickJour(economie, economie.jour + 1, saisonJour);
      if (typeof banques !== 'undefined' && banques && banques.forEach) {
        banques.forEach(b => { if (b && b.slots) MC.Economie.appliquerFraisBanque(b.slots, 1); });
      }
    }
    // ── caravanes marchandes : passage économique réel et risque d'attaque ──────
    /* SPEC-ECO-004 (fusionnée sans jamais être déclenchée en jeu — game.js:convois
       n'en affiche que le rendu visuel, § convois plus haut) et SPEC-TRANSPORT-003 :
       pour chaque route de commerce/axe partant d'une ville que des joueurs
       connectés ont approchée, chaque départ déjà ARRIVÉ à destination
       (MC.Caravanes.arriveesJusqua) déplace réellement sa cargaison
       (MC.Economie.passageCaravane), idempotent par trajet (registre ci-dessous,
       distinct de `economie.departs` qui, lui, protège passageCaravane elle-même
       d'un double appel). Le tronçon est jugé dangereux — attaque possible —
       exactement comme zones.js le fait pour la zone de jeu : `monde.zoneEn`
       incorpore déjà l'influence d'un territoire de faction en guerre
       (SPEC-FACTION-014), donc un seul test ('pvp'/'pvp_pve') couvre les deux
       conditions de la fiche (territoire en guerre OU zone pvp). */
    const arriveesCaravanesTraitees = new Map();   // trajet.id -> dernier index d'arrivée traité
    function avancerCaravanes(lieux) {
      if (!monde.habitats || !monde.routes || !MC.Caravanes || !monde.zoneEn) return;
      const villes = [];
      const L = lieuxEntretien(lieux);
      L.positions.forEach(p => {
        L.proches(p.x, p.z, 900).forEach(l => {
          if ((l.kind === 'ville' || l.kind === 'megapole') && !villes.some(v => v.id === l.id)) villes.push(l);
        });
      });
      villes.forEach(v => {
        MC.Caravanes.trajetsDe(v, monde.routes).forEach(tr => {
          const depuis = arriveesCaravanesTraitees.has(tr.id) ? arriveesCaravanesTraitees.get(tr.id) : null;
          const arrivees = MC.Caravanes.arriveesJusqua(tr, EP.heure, depuis);
          if (!arrivees.length) return;
          arriveesCaravanesTraitees.set(tr.id, arrivees[arrivees.length - 1]);
          if (arriveesCaravanesTraitees.size > 4000) arriveesCaravanesTraitees.clear();
          const cumul = tr.cumul || MC.Caravanes.longueurs(tr.noeuds);
          const mi = MC.Caravanes.pointA(tr.noeuds, cumul, cumul[cumul.length - 1] / 2);
          const zoneMi = monde.zoneEn(mi.x, mi.z).zone;
          const danger = zoneMi === 'pvp' || zoneMi === 'pvp_pve';
          // id de destination : dernier segment de l'id du trajet ('r:<origine>><dest>') —
          // le MÊME identifiant de lieu que MC.Habitats/le troc (ent.lieu, SPEC-SYNC-023),
          // pour que ce passage agisse sur la VRAIE économie du village, pas une copie
          // parallèle jamais vue par les joueurs qui y commercent.
          const destId = tr.id.slice(tr.id.lastIndexOf('>') + 1);
          arrivees.forEach(k => {
            const r = MC.Economie.passageCaravane(economie, tr, k, {
              origine: { id: v.id, biome: v.biome, x: v.x, z: v.z },
              destination: { id: destId, biome: v.biome, x: mi.x, z: mi.z },
              danger,
            });
            if (r.attaque) {
              const m = chat.systeme('Une caravane venue de ' + v.nom + ' a été attaquée en chemin.');
              if (m) S.diffuser({ t: NP.MSG.CHAT, auteur: null, texte: m.texte, type: 'systeme', ts: m.t });
            }
          });
        });
      });
    }
    /* Offres d'un PNJ pour un joueur nommé (SPEC-SYNC-023, action `consulter`) :
       `e` l'entité PNJ (role, lieu, pnj — voir peuplerLieux plus bas), `nom` le
       nom canonique du joueur (remise METIER-004, jamais diffusé aux autres). */
    function offresPour(e, nom) {
      return MC.Economie.offresDe(economie, e.lieu, e.role, e.pnj, nom);
    }
    // sommet de colonne : qui s'abrite échappe à la foudre
    function abriServeur(x, z) {
      for (let y = C.WORLD_H - 1; y > 0; y--) {
        const id = monde.getBlock(x, y, z);
        if (!id) continue;
        const d = C.BLOCKS[id];
        if (d && d.plant && !d.aquatique && !C.isLeaves(id)) continue;
        return y;
      }
      return -1;
    }

    /* MC_TEST_BLOCS=N : fabrique N blocs modifiés (overrides) au démarrage — réservé au
       banc de sauvegarde (tests/bench-sauvegarde.js, SPEC-ARCHI-012), jamais en
       exploitation. Loin de l'origine, ils ne touchent ni le spawn ni un chunk chargé. */
    if (process.env.MC_TEST_BLOCS) {
      const n = parseInt(process.env.MC_TEST_BLOCS, 10) || 0;
      for (let i = 0; i < n; i++) {
        monde.overrides.set((100000 + (i % 1000)) + ',' + (20 + (i % 60)) + ',' + (100000 + Math.floor(i / 1000)), 1 + (i % 40));
      }
    }

    /* Le serveur a besoin d'un « joueur de référence » pour l'IA des mobs
       (poursuite, apparition). On prend le premier client connecté ; sans client,
       la simulation tourne au ralenti autour de l'origine. */
    const spawnCol = monde.findSpawnColumn();
    for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
      monde.getChunk(Math.floor(spawnCol[0] / 16) + cx, Math.floor(spawnCol[1] / 16) + cz, true);
    }
    /* MC_TEST_SPAWN='x,y,z' : réservé aux suites d'intégration (même principe que
       MC_TEST_INV/MC_TEST_PANNE, désactivé par défaut) — impose le point
       d'apparition, par exemple à l'intérieur d'un donjon déjà généré pour la
       graine choisie, sans quoi aucun test ne peut approcher à portée d'un
       coffre de donjon réel (aucune mécanique d'escalade ou de téléportation
       n'existe côté client pour l'atteindre autrement). N'affecte jamais la
       génération elle-même, seulement où le premier joueur apparaît. */
    let SPAWN;
    const MC_TEST_SPAWN = process.env.MC_TEST_SPAWN ? process.env.MC_TEST_SPAWN.split(',').map(Number) : null;
    if (MC_TEST_SPAWN && MC_TEST_SPAWN.length === 3 && MC_TEST_SPAWN.every(Number.isFinite)) {
      SPAWN = { x: MC_TEST_SPAWN[0], y: MC_TEST_SPAWN[1], z: MC_TEST_SPAWN[2] };
      for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
        monde.getChunk(Math.floor(SPAWN.x / 16) + cx, Math.floor(SPAWN.z / 16) + cz, true);
      }
    } else {
      SPAWN = {
        x: spawnCol[0] + 0.5,
        y: monde.groundAt(spawnCol[0], spawnCol[1], true) + 1.2,
        z: spawnCol[1] + 0.5,
      };
    }
    S.SPAWN = SPAWN;
    /* SPEC-ARCHI-041 : la recherche des lieux de l'épopée (village, ville, ermite, trois donjons) génère du
       terrain : on la fait ICI, au démarrage, plutôt qu'au premier joueur (elle bloquerait le serveur). */
    if (regles.histoire && PARAMS_HISTOIRE.archetype === 'epopee' && !histoireMonde.liens) {
      const t0Histoire = Date.now();
      histoireMonde.liens = MC.Histoire.lier(monde, SPAWN.x, SPAWN.z);
      journal(`histoire : lieux liés au monde en ${Date.now() - t0Histoire} ms`);
      // persistés tout de suite : un redémarrage de la même partie ne refait pas ce calcul (l'écran d'attente de ARCHI-017 couvre ce délai la première fois)
      if (CONF.mondeFichier) setTimeout(() => sauvegarderMondeAsync('liens de l\'histoire', true), 3000);
    }
    /* MC_TEST_MOBS='[["sheep",1.5,0]]' : réservé aux suites d'intégration (même
       principe que MC_TEST_SPAWN, désactivé par défaut) — fait apparaître des
       créatures à des décalages [type, dx, dz] du point d'apparition, pour tester
       le combat et le butin sans attendre une apparition aléatoire. */
    if (process.env.MC_TEST_MOBS) {
      journal('ATTENTION : MC_TEST_MOBS actif — des créatures sont posées au point d apparition (réglage de test, jamais en exploitation)');
      try {
        JSON.parse(process.env.MC_TEST_MOBS).forEach(([type, dx, dz, role]) => {
          // 4e élément facultatif : le métier d'un habitant (ex. « forgeron »)
          if (entites.SPECS[type]) entites.spawn(type, SPAWN.x + (+dx || 0), SPAWN.y, SPAWN.z + (+dz || 0), role ? { role: String(role), nom: 'Test' } : undefined);
        });
      } catch (e) { /* réglage de test invalide : ignoré */ }
    }

    /* MC_TEST_MOB='sheep' : réservé aux suites d'intégration (comme MC_TEST_SPAWN, désactivé
       par défaut) — une créature PASSIVE posée à 0,3 bloc du point d'apparition, du côté
       ouest (dégagé pour la graine de test : un talus borde l'est), pour prouver qu'elle
       cède et ne chevauche pas le joueur (SPEC-ARCHI-037, 047). */
    if (process.env.MC_TEST_MOB) {
      const t = process.env.MC_TEST_MOB;
      const m = entites.spawn(t, SPAWN.x - 0.3, SPAWN.y, SPAWN.z);
      if (m) m.wanderCd = 1e9;
    }
    /* MC_TEST_FACTION_RONDE=1 : réservé à tests/integration-factions.js (même
       principe que MC_TEST_QUETE) — une faction PNJ FICTIVE a son siège au point
       d'apparition et y commence une ronde par le VRAI chemin de la simulation
       (MC.Politique.appliquerAction 'patrouille'), pour que la suite voie des
       gardes en marche sans dépendre d'une ville procédurale. Jamais en exploitation. */
    if (process.env.MC_TEST_FACTION_RONDE) {
      journal('ATTENTION : MC_TEST_FACTION_RONDE actif — une faction PNJ FICTIVE en ronde au point d apparition (réglage de test, jamais en exploitation)');
      const idF = 'test:ronde';
      const f = { id: idF, type: 'ordre', nom: 'Garde du Col', caractere: 'pragmatique',
                  siege: { x: Math.floor(SPAWN.x), z: Math.floor(SPAWN.z), site: idF }, territoire: 60,
                  // « explorer » : un objectif qu'aucune règle ne rend à un ordre de ce rang → il change forcément au premier jour simulé
                  ressources: { or: 50, nourriture: 50 }, objectif: 'explorer', objectifs: ['defendre', 'convertir'], naissance: 0 };
      politique.factions.set(idF, f);
      MC.Politique.appliquerAction(politique, f, 'patrouille', politique.jour);
    }
  }

  MC.ServeurSimulation = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
