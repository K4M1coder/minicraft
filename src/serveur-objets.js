/* serveur-objets.js — présentoirs, socles et coffres suspects
   Le contenu exposé d'un présentoir ou d'un socle est tenu par le serveur et
   annoncé aux clients proches (SPEC-SYNC-027, SPEC-ARCHI-043) ; les coffres
   piégés et dorés se résolvent ici, piège et butin tirés par le serveur
   (SPEC-ARCHI-044, SPEC-OBJET-005).

   Module du serveur (SPEC-SERVEUR-008) : il ne touche ni socket ni fichier par
   lui-même ; tout ce dont il dépend arrive par le contexte S (état partagé,
   fonctions des autres modules) et S.hote (process…). Installer publie dans S
   les fonctions dont les autres modules ont besoin. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  function installer(S) {
    const { process } = S.hote;
    const { NP, C, CA, regles, monde, entites, expositions, conteneursPoses, clients, envoyer, diffuser, journal } = S;
    Object.assign(S, {
      exposer, retirerExposition, libererExposition, envoyerExpositionsProches, envoyerExpositionsDuChunk,
      entretenirExpositions, ouvrirCoffreSuspect,
    });

    const RAYON_EXPOSITION = 96;      // SPEC-SYNC-027 : même rayon que la diffusion d'état et EQUIP_VU
    const expositionsEnvoyees = new WeakMap();
    const cleDe = (x, y, z) => x + ',' + y + ',' + z;
    const estSupport = (x, y, z) => { const d = C.BLOCKS[monde.getBlock(x, y, z)]; return !!(d && d.expose); };
    const aPortee = (js, x, y, z) => {
      const st = js.joueur.state;
      return Math.hypot(x + 0.5 - st.pos.x, y + 0.5 - st.pos.y - 1.62, z + 0.5 - st.pos.z) <= S.PORTEE_BLOC;
    };

    /* MC_TEST_ALEA=<réel dans [0,1)> : le hasard des pièges et des surprises devient
       cette constante, pour des tests déterministes (réglage de test, jamais en exploitation). */
    let ALEA_TEST = null;
    if (process.env.MC_TEST_ALEA !== undefined && process.env.MC_TEST_ALEA !== '') {
      const v = parseFloat(process.env.MC_TEST_ALEA);
      if (isFinite(v) && v >= 0 && v < 1) ALEA_TEST = v;
    }
    if (ALEA_TEST !== null) journal('ATTENTION : MC_TEST_ALEA actif — pièges et surprises des coffres tirés au hasard IMPOSÉ (réglage de test, jamais en exploitation)');
    const alea = () => (ALEA_TEST !== null ? ALEA_TEST : Math.random());

    // ── présentoirs et socles (SPEC-SYNC-027, SPEC-ARCHI-043) ─────────────────
    const pileDe = (e) => { const p = { id: e.id, n: 1 }; if (e.data !== undefined) p.data = e.data; if (e.dmg) p.dmg = e.dmg; return p; };
    // l'objet repris rejoint l'inventaire SERVEUR ; ce qui ne tient pas tombe aux pieds, jamais perdu
    function rendreAuJoueur(js, e) {
      const reste = js.joueur.state.inv.addStack(e.id, 1, e.data, e.dmg);
      if (reste) S.lacherAuxPieds(js, pileDe(e));
    }
    function entree(x, y, z) { const e = expositions.get(cleDe(x, y, z)); return [x, y, z, e ? e.id : 0]; }
    function proches(x, z) {
      const l = [];
      clients.forEach(cl => {
        if (!cl.rejoint || !cl.joueurs) return;
        if (cl.joueurs.some(j => Math.hypot(j.joueur.state.pos.x - (x + 0.5), j.joueur.state.pos.z - (z + 0.5)) < RAYON_EXPOSITION)) l.push(cl);
      });
      return l;
    }
    function annoncerExposition(c, exposition) {
      envoyer(c, { t: CA.MSG.EXPOSITIONS, l: [exposition] });
      const connues = expositionsEnvoyees.get(c) || new Map();
      const cle = cleDe(exposition[0], exposition[1], exposition[2]);
      if (exposition[3]) connues.set(cle, exposition[3]); else connues.delete(cle);
      expositionsEnvoyees.set(c, connues);
    }
    // un changement part aux seuls clients à moins de 96 blocs ; les autres le recevront à l'arrivée dans le chunk
    function diffuserExposition(x, y, z) {
      const exposition = entree(x, y, z);
      proches(x, z).forEach(cl => annoncerExposition(cl, exposition));
    }
    /* Le support a disparu sans passer par la casse d'un joueur (explosion, feu…) :
       l'objet exposé tombe sur place. Un chunk non chargé n'est pas touché. */
    function aSupportOuLibere(k, e) {
      const p = k.split(',').map(Number);
      if (!monde.chunkDe(Math.floor(p[0] / 16), Math.floor(p[2] / 16))) return true;
      if (estSupport(p[0], p[1], p[2])) return true;
      expositions.delete(k);
      entites.dropStack(p[0] + 0.5, p[1] + 0.5, p[2] + 0.5, pileDe(e));
      diffuserExposition(p[0], p[1], p[2]);
      return false;
    }
    // par paquets bornés ; seul le premier paquet remplace ce que le client savait du chunk
    function envoyerListe(c, l, chunk) {
      const MAX = CA.BORNES.EXPOSITIONS_MAX;
      for (let i = 0; i < l.length || (chunk && i === 0); i += MAX) {
        const message = { t: CA.MSG.EXPOSITIONS, l: l.slice(i, i + MAX) };
        if (chunk && i === 0) { message.cx = chunk.cx; message.cz = chunk.cz; }
        envoyer(c, message);
      }
    }
    // à l'arrivée : tout ce qui est exposé à moins de 96 blocs de l'un des joueurs du poste (SPEC-SYNC-027)
    function envoyerExpositionsProches(c) {
      if (!c.joueurs) return;
      const connues = expositionsEnvoyees.get(c) || new Map(), courantes = new Map(), l = [];
      Array.from(expositions.entries()).forEach(([k, e]) => {
        const p = k.split(',').map(Number);
        if (!c.joueurs.some(j => Math.hypot(j.joueur.state.pos.x - (p[0] + 0.5), j.joueur.state.pos.z - (p[2] + 0.5)) < RAYON_EXPOSITION)) return;
        if (!aSupportOuLibere(k, e)) return;
        courantes.set(k, e.id);
        if (connues.get(k) !== e.id) l.push([p[0], p[1], p[2], e.id]);
      });
      connues.forEach((id, k) => {
        if (!courantes.has(k)) l.push(k.split(',').map(Number).concat([0]));
      });
      if (l.length) envoyerListe(c, l, null);
      expositionsEnvoyees.set(c, courantes);
    }
    function entretenirExpositions() {
      Array.from(expositions.entries()).forEach(([k, e]) => aSupportOuLibere(k, e));
      clients.forEach(c => { if (c.rejoint && c.joueurs) envoyerExpositionsProches(c); });
    }
    // un chunk que le client charge : son état complet, vide compris
    function envoyerExpositionsDuChunk(c, cx, cz) {
      const l = [];
      Array.from(expositions.entries()).forEach(([k, e]) => {
        const p = k.split(',').map(Number);
        if (Math.floor(p[0] / 16) !== cx || Math.floor(p[2] / 16) !== cz) return;
        if (aSupportOuLibere(k, e)) l.push([p[0], p[1], p[2], e.id]);
      });
      envoyerListe(c, l, { cx, cz });
      const connues = expositionsEnvoyees.get(c) || new Map();
      connues.forEach((id, k) => {
        const p = k.split(',').map(Number);
        if (Math.floor(p[0] / 16) === cx && Math.floor(p[2] / 16) === cz) connues.delete(k);
      });
      l.forEach(e => connues.set(cleDe(e[0], e[1], e[2]), e[3]));
      expositionsEnvoyees.set(c, connues);
    }
    // refus : le client reprend l'état qui fait foi, pour cette case et pour son inventaire
    function refuser(c, m) {
      annoncerExposition(c, entree(m.x, m.y, m.z));
      S.envoyerInvMaj(c, m.j, {});
    }
    /* EXPOSER : UN exemplaire de la case `i` de l'inventaire SERVEUR passe sur le
       présentoir ; un objet déjà exposé revient dans l'inventaire (ou tombe aux
       pieds), exactement comme le faisait le solo d'avant le serveur. */
    function exposer(c, m) {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || !c.rejoint || js.joueur.state.dead) return;
      if (!aPortee(js, m.x, m.y, m.z) || !estSupport(m.x, m.y, m.z)) return refuser(c, m);
      const inv = js.joueur.state.inv, pile = inv.slots[m.i];
      if (!pile) return refuser(c, m);
      const e = { id: pile.id, n: 1 };
      if (pile.data !== undefined) e.data = pile.data;
      if (pile.dmg) e.dmg = pile.dmg;
      inv.consumeAt(m.i, 1);
      const k = cleDe(m.x, m.y, m.z), ancien = expositions.get(k);
      expositions.set(k, e);
      if (ancien) rendreAuJoueur(js, ancien);
      diffuserExposition(m.x, m.y, m.z);
      S.envoyerInvMaj(c, m.j, {});
    }
    function retirerExposition(c, m) {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || !c.rejoint || js.joueur.state.dead) return;
      const k = cleDe(m.x, m.y, m.z), e = expositions.get(k);
      if (!e || !aPortee(js, m.x, m.y, m.z)) return refuser(c, m);
      if (!estSupport(m.x, m.y, m.z)) { libererExposition(m.x, m.y, m.z); return refuser(c, m); }
      expositions.delete(k);
      rendreAuJoueur(js, e);
      diffuserExposition(m.x, m.y, m.z);
      S.envoyerInvMaj(c, m.j, {});
    }
    // le présentoir est cassé : son objet tombe sur place (appelé par la casse, serveur-messages)
    function libererExposition(x, y, z) {
      const k = cleDe(x, y, z), e = expositions.get(k);
      if (!e) return;
      expositions.delete(k);
      entites.dropStack(x + 0.5, y + 0.5, z + 0.5, pileDe(e));
      diffuserExposition(x, y, z);
    }
    // ── coffres piégés et surprises (SPEC-ARCHI-044, SPEC-OBJET-005) ──────────
    const BUTIN_RARE = () => { const I = C.I; return [[I.DIAMOND, 1, 3], [I.EMERALD, 2, 5], [I.GOLD_INGOT, 2, 4], [I.BIJOU, 0, 1]]; };
    function changerBloc(x, y, z, id) {
      monde.setBlock(x, y, z, id);
      if (monde.setEtat) monde.setEtat(x, y, z, 0);
      diffuser({ t: NP.MSG.BLOC, x, y, z, id, etat: 0 });
    }
    // le coffre se montre : le joueur en reçoit le contenu comme à toute ouverture (CONTENEUR_ETAT)
    function montrerCoffre(c, m, js) {
      const r = S.ouvrirConteneurPourJoueur(js, { x: m.x, y: m.y, z: m.z });
      if (!r) return;
      envoyer(c, { t: NP.MSG.CONTENEUR_ETAT, j: m.j, cle: r.cle, type: r.type, rev: r.cont.rev || 0, slots: r.cont.slots.map(MC.ContratsV2.pileVersCase) });
    }
    function declencherPiege(c, m, js, genre) {
      const st = js.joueur.state;
      if (genre === 'coffre_surprise') {
        if (MC.Core.tirerSurprise(alea) === 'mimic') {
          changerBloc(m.x, m.y, m.z, 0);
          entites.spawn('mimic', m.x + 0.5, m.y, m.z + 0.5);
          S.messageSystemeA(c, 'Ce n\'était pas un vrai coffre !');
          return;
        }
        // butin rare : le coffre doré devient un coffre ordinaire qui le contient, ouvert devant le joueur
        const cle = MC.ContratsV2.cleConteneur(m.x, m.y, m.z);
        const cont = MC.Conteneurs.creerConteneur('chest');
        BUTIN_RARE().forEach(r => {
          const n = r[1] + Math.floor(alea() * (r[2] - r[1] + 1));
          if (n > 0) cont.slots[cont.slots.findIndex(s => !s)] = { id: r[0], n };
        });
        S.fermerConteneurPourAbonnes(cle);
        conteneursPoses.set(cle, cont);
        if (monde.coffresPilles) monde.coffresPilles.add(cle);
        changerBloc(m.x, m.y, m.z, C.B.CHEST);
        montrerCoffre(c, m, js);
        return;
      }
      const t = MC.Core.tirerPiege(alea);
      if (t === 'fleches') {
        js.joueur.hurt(6);
        S.messageSystemeA(c, 'Un mécanisme vous tire dessus !');
      } else if (t === 'explosion') {
        js.joueur.hurt(10);
        changerBloc(m.x, m.y, m.z, 0);
        S.messageSystemeA(c, 'Ça explose !');
        return;
      } else if (t === 'alarme') {
        entites.spawn('garde', m.x + 0.5, m.y + 1, m.z + 0.5);
        entites.spawn('garde', m.x - 0.5, m.y + 1, m.z - 0.5);
        S.messageSystemeA(c, 'Une alarme retentit, des gardes accourent !');
      } else {
        st.malade = (st.malade || 0) + 15;
        S.messageSystemeA(c, 'Un gaz toxique vous saisit...');
      }
      // le piège se déclenche une fois : le coffre redevient un coffre normal, ouvert
      changerBloc(m.x, m.y, m.z, C.B.CHEST);
      if (!js.joueur.state.dead) montrerCoffre(c, m, js);
    }
    /* COFFRE_SUSPECT : le serveur revérifie tout — joueur vivant, case à portée, bloc
       réellement piégé ou doré — et tire lui-même le désamorçage, le piège et le butin.
       Le kit n'est jamais cru sur parole : c'est la case `i` de l'inventaire SERVEUR
       qui doit en porter un. */
    function ouvrirCoffreSuspect(c, m) {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || !c.rejoint || js.joueur.state.dead) return;
      const id = monde.getBlock(m.x, m.y, m.z);
      if (id !== C.B.COFFRE_PIEGE && id !== C.B.COFFRE_SURPRISE) return;
      if (!aPortee(js, m.x, m.y, m.z)) return;
      const genre = C.BLOCKS[id].interactive;
      const inv = js.joueur.state.inv, pile = m.i !== undefined ? inv.slots[m.i] : null;
      if (pile && pile.id === C.I.KIT_DESAMORCAGE) {
        if (!regles.blocsIllimites) inv.consumeAt(m.i, 1);
        S.envoyerInvMaj(c, m.j, {});
        if (MC.Core.tenterDesamorcage(true, alea)) {
          changerBloc(m.x, m.y, m.z, C.B.CHEST);
          S.messageSystemeA(c, 'Piège désamorcé.');
          return;
        }
        S.messageSystemeA(c, 'Le désamorçage échoue !');
      }
      declencherPiege(c, m, js, genre);
    }
  }

  MC.ServeurObjets = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
