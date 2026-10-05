/* serveur-inventaire.js — inventaire et conteneurs
   Inventaire autoritaire, conteneurs posés, banques et soutes
   (SPEC-SYNC-007 à 017).

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
    const { process } = S.hote;
    const { NP, C, regles, monde, entites, conteneursPoses, banqueDe, clients, envoyer, journal } = S;
    Object.assign(S, {
      cleRegDejaConnectee, ctxJoueur, distanceConteneur, abonnesActuels,
      fermerConteneurPourAbonnes, ouvrirConteneurPourJoueur,
      normaliserTailleConteneur, remplirConteneurNeuf, etatJoueurServeur,
      seqNouveau, envoyerInvMaj, refuserOp, lacherAuxPieds, traiterOp,
      diffuserEquipVu,
    });

    // ── inventaire et conteneurs (B1, SPEC-SYNC-007 à 017) ──────────────────────
    /* Le serveur devient la seule source de vérité pour l'inventaire, l'équipement
       et la grille de fabrication : le même module pur MC.Conteneurs que le solo
       et la prédiction client (docs/vague-2/B1.md § 3). Cette section ne connaît
       ENCORE PAS le registre des conteneurs posés (coffres, fourneaux… — étape 7) :
       seule la banque, par joueur nommé, existe déjà comme conteneur vivant.
       `joueursRegistre`, `banques` et `banqueDe` sont déclarés plus haut (voir
       commentaire à leur définition). */
    /* MC_TEST_INV='[[id,n],…]' : inventaire initial d'un joueur SANS enregistrement
       (jamais rejoint sous ce nom auparavant) — lu une fois au démarrage, comme
       MC_TEST_PANNE ; réservé aux suites d'intégration, jamais en exploitation. */
    let MC_TEST_INV = null;
    try { MC_TEST_INV = process.env.MC_TEST_INV ? JSON.parse(process.env.MC_TEST_INV) : null; }
    catch (e) { MC_TEST_INV = null; }
    S.MC_TEST_INV = MC_TEST_INV;
    if (MC_TEST_INV) journal('ATTENTION : MC_TEST_INV actif — les nouveaux joueurs reçoivent un inventaire imposé (réglage de test, jamais en exploitation)');

    // une clé de registre déjà tenue par un joueur CONNECTÉ (écran partagé
    // compris) : la seconde connexion sous le même nom reste éphémère (jamais
    // restaurée, jamais réécrite dans le registre à sa fermeture).
    function cleRegDejaConnectee(cleReg) {
      for (const cl of clients.values()) {
        if (!cl.joueurs) continue;
        if (cl.joueurs.some(j2 => j2.cleReg === cleReg)) return true;
      }
      return false;
    }
    /* ctx pour MC.Conteneurs.appliquer : `conteneur(cle)` est LE point où
       l'accès à un conteneur posé ou à la banque est décidé — abonnement
       (`js.conteneurOuvert`, un seul conteneur ouvert à la fois par joueur
       local, comme l'écran) ET portée (SPEC-SYNC-013, 6 blocs) revérifiés à
       CHAQUE appel, pas seulement à l'ouverture : un joueur qui s'est éloigné,
       ou qui n'a jamais ouvert ce conteneur, ne peut plus agir dessus même s'il
       en connaît la clé (rejeu, faux message forgé…). */
    function ctxJoueur(js) {
      return {
        joueur: { inv: js.joueur.state.inv, equip: js.joueur.state.equip, grille: js.grille },
        conteneur: (cle) => resoudreConteneur(js, cle),
        regles,
        stats: { faim: js.joueur.state.hunger, vie: js.joueur.state.hp, vieMax: MC.PlayerConst.MAX_HP },
        eauProche: () => eauProcheDe(js.joueur.state.pos),
      };
    }
    // distance (œil du joueur → CENTRE du bloc), même calcul que blocAutorise plus bas
    function distanceConteneur(st, x, y, z) {
      return Math.hypot(x + 0.5 - st.pos.x, y + 0.5 - (st.pos.y + 1.62), z + 0.5 - st.pos.z);
    }
    function resoudreConteneur(js, cle) {
      if (js.conteneurOuvert !== cle) return null;      // pas abonné (ou pas CE conteneur) : refusé
      const st = js.joueur.state;
      if (cle[0] === 'v') return S.souteDeVehicule(cle, st);   // soute d'un véhicule (P-VEH), proximité REvérifiée
      if (cle === 'banque') {
        if (!js.cleReg) return null;
        // SYNC-013 : la banque exige la proximité d'un bloc coffre-fort (ou du
        // banquier par lequel elle a été ouverte) — REvérifiée ici, pas
        // seulement à CONTENEUR_OUVRIR (un joueur qui s'éloigne perd l'accès).
        if (js.banquePos) {
          if (distanceConteneur(st, js.banquePos.x, js.banquePos.y, js.banquePos.z) > MC.ContratsV2.BORNES.PORTEE_CONTENEUR) return null;
        } else if (js.banqueEid !== null && js.banqueEid !== undefined) {
          const ent = entites.list.find(e => e.eid === js.banqueEid && !e.dead);
          if (!ent) return null;
          const d = Math.hypot(ent.pos.x - st.pos.x, (ent.pos.y || 0) - st.pos.y, ent.pos.z - st.pos.z);
          if (d > MC.ContratsV2.BORNES.PORTEE_CONTENEUR) return null;
        } else return null;
        return banqueDe(js.cleReg);
      }
      const cont = conteneursPoses.get(cle);
      if (!cont) return null;                            // détruit entre-temps (cassé)
      const p = cle.split(',');
      if (p.length !== 3 || distanceConteneur(st, +p[0], +p[1], +p[2]) > MC.ContratsV2.BORNES.PORTEE_CONTENEUR) return null;
      return cont;
    }
    // tous les joueurs locaux (toutes connexions) actuellement abonnés à `cle`
    // (SPEC-SYNC-015 : à qui diffuser un CONTENEUR_MAJ)
    function abonnesActuels(cle) {
      return S.tousLesJoueurs().filter(x => x.js.conteneurOuvert === cle);
    }
    /* Revue adversariale (item 3) : quand un conteneur posé disparaît (cassé,
       avec ou sans bloc reposé ensuite au même endroit), tout joueur qui l'avait
       ouvert est FORCÉMENT désabonné ET prévenu — jamais une resubscription
       fantôme qui réutiliserait la clé pour un conteneur de type différent
       (coffre 27 cases → fourneau 3 cases, par exemple). `CONTENEUR_FERMER`
       (message existant, jusqu'ici seulement c→s) sert aussi de notification
       s→c : net.js ferme l'écran du client dès qu'il la reçoit pour SA clé
       ouverte. */
    function fermerConteneurPourAbonnes(cle) {
      abonnesActuels(cle).forEach(({ c: c2, j: j2, js: js2 }) => {
        js2.conteneurOuvert = null;
        js2.banquePos = null;
        js2.banqueEid = null;
        envoyer(c2, { t: NP.MSG.CONTENEUR_FERMER, j: j2, cle: cle });
      });
    }
    /* Résout et ouvre un conteneur pour CONTENEUR_OUVRIR (bloc posé à x,y,z, ou
       banquier par eid) : vérifie la portée, crée le conteneur au registre à la
       première ouverture (donjon, bibliothèque générée — parité avec le solo,
       game.js coffreDe/l. 1734-1747, 2104-2110), et marque l'abonnement. Renvoie
       { cle, type, cont } ou null (refusé). */
    function ouvrirConteneurPourJoueur(js, m) {
      const st = js.joueur.state;
      if (m.eid !== undefined) {
        // la soute d'un véhicule (SPEC-SYNC-022) : conteneur serveur, clé « v<eid> »
        const veh = S.vehiculeParEid(m.eid);
        if (veh) {
          const cleV = 'v' + veh.eid, soute = S.souteDeVehicule(cleV, st);
          if (!soute) return null;
          js.conteneurOuvert = cleV; js.banquePos = null; js.banqueEid = null;
          return { cle: cleV, type: soute.type, cont: soute };
        }
        const ent = entites.list.find(e => e.eid === m.eid && e.role === 'banquier' && !e.dead);
        if (!ent || !js.cleReg) return null;
        const d = Math.hypot(ent.pos.x - st.pos.x, (ent.pos.y || 0) - st.pos.y, ent.pos.z - st.pos.z);
        if (d > MC.ContratsV2.BORNES.PORTEE_CONTENEUR) return null;
        js.conteneurOuvert = 'banque'; js.banquePos = null; js.banqueEid = m.eid;
        return { cle: 'banque', type: 'banque', cont: banqueDe(js.cleReg) };
      }
      if (distanceConteneur(st, m.x, m.y, m.z) > MC.ContratsV2.BORNES.PORTEE_CONTENEUR) return null;
      const bd = C.BLOCKS[monde.getBlock(m.x, m.y, m.z)];
      if (!bd || !bd.interactive) return null;
      if (bd.interactive === 'banque') {
        if (!js.cleReg) return null;
        js.conteneurOuvert = 'banque'; js.banquePos = { x: m.x, y: m.y, z: m.z }; js.banqueEid = null;
        return { cle: 'banque', type: 'banque', cont: banqueDe(js.cleReg) };
      }
      const t = MC.ContratsV2.TYPES_CONTENEUR[bd.interactive];
      if (!t || t.parJoueur) return null;                 // 'craft' (établi), 'info'… : pas un conteneur posé
      const cle = MC.ContratsV2.cleConteneur(m.x, m.y, m.z);
      let cont = conteneursPoses.get(cle);
      if (!cont) {
        cont = MC.Conteneurs.creerConteneur(bd.interactive);
        if (!cont) return null;
        remplirConteneurNeuf(cont, bd.interactive, m.x, m.y, m.z, cle);
        conteneursPoses.set(cle, cont);
      }
      js.conteneurOuvert = cle; js.banquePos = null; js.banqueEid = null;
      return { cle, type: bd.interactive, cont };
    }
    /* Défense en profondeur (revue adversariale) : le correctif d'`indiceValide`
       (conteneurs.js) empêche désormais toute écriture qui agrandirait
       `cont.slots` au-delà de `cont.taille` — mais un conteneur DÉJÀ mal formé
       (ancienne exécution avant ce correctif, ou toute autre voie non prévue) ne
       doit plus être filtré silencieusement par `validerConteneurPersiste`
       (`slots.length === taille` strict), ce qui aurait fait disparaître le
       conteneur ENTIER, y compris ses cases valides, à la prochaine relance
       `--monde`. Tronque à la taille réelle ; l'excédent (toujours à une
       position connue — `cle` encode x,y,z pour un conteneur posé) tombe au
       sol comme une casse ordinaire, jamais perdu sans trace. */
    function normaliserTailleConteneur(cle, cont) {
      if (cont.slots.length === cont.taille) return;
      if (cont.slots.length < cont.taille) {
        while (cont.slots.length < cont.taille) cont.slots.push(null);
        return;
      }
      const excedent = cont.slots.slice(cont.taille);
      cont.slots.length = cont.taille;
      const p = cle.split(',');
      let lachees = 0;
      excedent.forEach(s => {
        if (!s) return;
        lachees++;
        if (p.length === 3) entites.dropStack(+p[0] + 0.5, +p[1] + 0.5, +p[2] + 0.5, s);
      });
      journal(`avertissement : conteneur ${cle} (${cont.type}) mal formé — ` +
              `${cont.slots.length + excedent.length} case(s) au lieu de ${cont.taille}, tronqué` +
              (lachees ? `, ${lachees} pile(s) lâchée(s) au sol` : ''));
    }
    /* Un objet ajouté à la première case libre — assez pour remplir un
       conteneur neuf (donjon, bibliothèque générée), jamais utilisé pour un
       transfert normal (qui passe par MC.Conteneurs.appliquer). */
    function ajouterPileConteneur(cont, id, n, data) {
      for (let i = 0; i < cont.slots.length && n > 0; i++) {
        if (!cont.slots[i]) {
          const p = { id, n: Math.min(n, C.maxStack(id)) };
          if (data !== undefined) p.data = data;
          cont.slots[i] = p;
          n -= p.n;
        }
      }
      return n;
    }
    /* Parité avec le solo (game.js coffreDe, l. 1734-1747 ; ouvrirConteneur,
       l. 2104-2110) : un coffre de donjon se remplit de son butin à la première
       ouverture, une bibliothèque générée (jamais posée par un joueur) tient
       quelques livres du monde. */
    function remplirConteneurNeuf(cont, type, x, y, z, cle) {
      if (type === 'chest' && monde.butinCoffre && monde.coffresPilles && !monde.coffresPilles.has(cle)) {
        const butin = monde.butinCoffre(x, y, z);
        if (butin) { monde.coffresPilles.add(cle); butin.forEach(st => ajouterPileConteneur(cont, st.id, st.n)); }
      } else if (type === 'bibliotheque' && !monde.overrides.has(cle) && MC.Livres && monde.habitats) {
        /* SPEC-INTERIEUR-003 : de quoi lire — la légende du lieu, sa chronique
           (son histoire et celle de ses voisins) et le carnet d'un explorateur
           qui situe les donjons des environs, buts des quêtes et des récits. */
        const proches = monde.habitats.lieuxProches(x, z, 600);
        const lieuB = proches.filter(l => Math.hypot(l.x - x, l.z - z) <= 160)[0];
        if (lieuB) {
          ajouterPileConteneur(cont, C.I.LIVRE, 1, MC.Livres.livreDuMonde(monde.seed, lieuB));
          ajouterPileConteneur(cont, C.I.LIVRE, 1, MC.Livres.livreChronique(monde.seed, lieuB, proches.filter(l => l !== lieuB)));
          const specs = MC.EntitySpecs || {};
          const donjons = monde.donjons ? monde.donjons.dansZone(lieuB.x - 240, lieuB.z - 240, lieuB.x + 240, lieuB.z + 240) : [];
          const indices = donjons
            .map(d => ({ nom: d.nom, x: d.x, z: d.z, gardien: specs[d.boss] && specs[d.boss].nom,
                         vaincu: !!(monde.donjonsVaincus && monde.donjonsVaincus.has(d.id)), dist: Math.hypot(d.x - lieuB.x, d.z - lieuB.z) }))
            .sort((a, b) => a.dist - b.dist).slice(0, 5);
          ajouterPileConteneur(cont, C.I.LIVRE, 1, MC.Livres.livreIndices(monde.seed, lieuB, indices));
        }
      }
    }
    // approximation volontairement large (pas un rayon lancé) : juste assez pour
    // distinguer « près d'une source d'eau » de « nulle part près de l'eau »,
    // seule chose que vérifie INV_CONSOMMER { vers } (SEAU → SEAU_EAU).
    function eauProcheDe(pos) {
      const cx = Math.floor(pos.x), cy = Math.floor(pos.y), cz = Math.floor(pos.z);
      for (let dx = -3; dx <= 3; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -3; dz <= 3; dz++) {
        if (C.isWater(monde.getBlock(cx + dx, cy + dy, cz + dz))) return true;
      }
      return false;
    }
    function etatJoueurServeur(js) {
      return { inv: js.joueur.state.inv, equip: js.joueur.state.equip, grille: js.grille };
    }
    // § 5 du plan (API figée, appelée telle quelle par B2 et B4) : seq strictement
    // croissant par connexion et joueur local ; un doublon (seq ≤ dernier connu)
    // est ignoré — ni effet, ni réponse (idempotence, SPEC-SYNC-008/014).
    function seqNouveau(js, seq) {
      if (!(seq > js.dernierSeq)) return false;
      js.dernierSeq = seq;
      return true;
    }
    function envoyerInvMaj(c, j, opts) {
      const js = c.joueurs && c.joueurs[j];
      if (!js) return;
      js.revInv = (js.revInv || 0) + 1;
      envoyer(c, MC.ContratsV2.messageInvMaj(etatJoueurServeur(js),
        Object.assign({}, opts, { j, rev: js.revInv, ack: js.dernierSeq })));
    }
    function refuserOp(c, j, seq, motif) {
      envoyerInvMaj(c, j, { refus: [{ seq, motif }] });
    }
    function lacherAuxPieds(js, pile) {
      if (!pile || !pile.n) return;
      const p = js.joueur.state.pos;
      entites.dropStack(p.x, p.y + 1, p.z, pile);
    }
    function lancerDevant(js, pile) {
      if (!pile || !pile.n) return;
      entites.lancerObjet(js.joueur.eyePos(), js.joueur.lookDir(), pile.id, pile.n, pile.data, pile.dmg);
    }
    // clé(s) de conteneur posé/banque potentiellement concernées par une
    // opération AVANT de savoir si elle réussit (pour capturer l'instantané
    // « avant » sans dépendre du résultat) — transfert : de/vers ; declarer : cle.
    function clesConteneurDe(op) {
      const out = [];
      if (op.de && op.de.z === 'cont') out.push(op.de.cle);
      if (op.vers && op.vers.z === 'cont') out.push(op.vers.cle);
      if (op.cle) out.push(op.cle);
      return out;
    }
    function conteneurParCle(js, cle) {
      if (cle === 'banque') return js.cleReg ? banqueDe(js.cleReg) : null;
      return cle[0] === 'v' ? S.souteDeVehicule(cle, null) : conteneursPoses.get(cle);
    }
    /* Cœur commun à CRAFT, EQUIP, CONTENEUR_TRANSFERT, INV_CONSOMMER, INV_LACHER,
       INV_CREATIF : vérifie l'idempotence du `seq`, applique l'opération pure,
       lâche au sol ce qu'elle a éventuellement fait déborder, puis répond par un
       INV_MAJ (ack ou refus) — TOUJOURS, jamais deux messages non atomiques.

       SPEC-SYNC-015 : quand l'opération touche un conteneur posé ou la banque
       (`r.modifs.conteneurs`), l'AUTEUR reçoit le delta DANS son INV_MAJ
       (`conteneurs:[…]`, jamais un CONTENEUR_MAJ séparé — ça clignoterait) ; les
       AUTRES joueurs qui ont ce même conteneur ouvert reçoivent un CONTENEUR_MAJ. */
    function traiterOp(c, m, js, op) {
      if (!seqNouveau(js, m.seq)) return null;
      const avant = new Map();
      clesConteneurDe(op).forEach(cle => {
        const cont = conteneurParCle(js, cle);
        if (cont) avant.set(cle, MC.Conteneurs.instantane(cont));
      });
      const r = MC.Conteneurs.appliquer(ctxJoueur(js), op);
      if (!r.ok) { refuserOp(c, m.j, m.seq, r.motif); return r; }
      // SPEC-JOUABLE-006 : un objet JETÉ part devant le joueur (jamais rendu aussitôt) ; un trop-plein tombe aux pieds
      if (r.effets && r.effets.lache) (op.k === 'lacher' ? lancerDevant : lacherAuxPieds)(js, r.effets.lache);
      // la grille fermée sur un inventaire plein : le reliquat (état compris) tombe aux pieds, jamais perdu
      if (r.effets && r.effets.reste) r.effets.reste.forEach(p => lacherAuxPieds(js, p));
      const deltas = [];
      (r.modifs.conteneurs || []).forEach(cle => {
        const cont = conteneurParCle(js, cle);
        if (!cont) return;
        const av = avant.get(cle);
        const maj = av ? MC.Conteneurs.diff(av.slots, cont.slots)
                       : cont.slots.map((s, i) => [i, MC.ContratsV2.pileVersCase(s)]);
        const delta = { cle, rev: cont.rev, maj };
        if (cont.four) delta.four = { burn: cont.four.burn, cook: cont.four.cook };
        deltas.push(delta);
        abonnesActuels(cle).forEach(({ c: c2, j: j2 }) => {
          if (c2.id === c.id && j2 === m.j) return;         // jamais à l'auteur (déjà dans son INV_MAJ)
          envoyer(c2, Object.assign({ t: NP.MSG.CONTENEUR_MAJ }, delta));
        });
      });
      envoyerInvMaj(c, m.j, deltas.length ? { conteneurs: deltas } : {});
      return r;
    }
    /* SPEC-SYNC-011 : EQUIP_VU n'est diffusé qu'aux AUTRES joueurs à portée de vue
       (même rayon que la diffusion d'état, § 4 du plan — 96 blocs), jamais à
       l'auteur du changement (déjà informé par son propre INV_MAJ). */
    function diffuserEquipVu(c, j, js, slot) {
      const pile = js.joueur.state.equip[slot];
      const objet = pile ? pile.id : 0;
      const pos = js.joueur.state.pos;
      clients.forEach(cl => {
        if (cl.id === c.id || !cl.rejoint || !cl.joueurs) return;
        const proche = cl.joueurs.some(x => Math.hypot(x.joueur.state.pos.x - pos.x, x.joueur.state.pos.z - pos.z) < 96);
        if (proche) envoyer(cl, { t: NP.MSG.EQUIP_VU, id: c.id, j, slot, objet });
      });
    }
  }

  MC.ServeurInventaire = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
