/* serveur-pose.js — poser, casser, tirer
   Contrôle des blocs posés et cassés, débits d'inventaire prévus
   (SPEC-SYNC-028).

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
    const { C, regles, monde, journal } = S;
    Object.assign(S, {
      cellulesCompagnes, compagnesDeCasse, absorberDebitsPrevus, debiterPose,
      debiterTir, blocAutorise, blocCommandeAutorise,
    });

    const PORTEE_BLOC = 7;
    S.PORTEE_BLOC = PORTEE_BLOC;

    /* ── SPEC-SYNC-028 : poser un bloc et tirer se paient sur l'inventaire SERVEUR ──
       En survie, une pose n'est acceptée que si l'inventaire du serveur porte un
       objet qui pose ce bloc, un tir que s'il porte une munition compatible (ou
       une arme sans munition) ; l'objet est retiré ICI, à l'instant de l'action.
       Le client prédit la même diminution et l'envoie ensuite dans son journal
       INV_CONSOMMER : pour ne jamais la compter deux fois, chaque débit fait par le
       serveur laisse un CRÉDIT (id → 1, valable DELAI_CREDIT_MS) que la
       consommation journalisée correspondante absorbe au lieu de la rejouer. */
    const DELAI_CREDIT_MS = 120000;     // long : un journal en retard (onglet en arrière-plan, latence) ne doit jamais faire payer deux fois
    const CREDITS_MAX = 128;            // borne : un client qui ne journalise jamais ne cumule pas indéfiniment
    /* MC_TEST_POSE_LIBRE=1 : suspend ce contrôle (poser/tirer sans posséder) pour les
       suites d'intégration dont l'objet n'est PAS l'inventaire (réseau, flood,
       sauvegarde…) et qui posent des blocs sans s'en donner ; même principe que
       MC_TEST_PANNE, jamais en exploitation. Les suites d'inventaire ne l'utilisent pas. */
    const POSE_LIBRE = process.env.MC_TEST_POSE_LIBRE === '1';
    S.POSE_LIBRE = POSE_LIBRE;
    if (process.env.MC_HISTOIRE) journal('ATTENTION : MC_HISTOIRE actif — paramètres du récit imposés sans partie (réglage de test, jamais en exploitation)');
    if (process.env.MC_TEST_PRES_GUIDE) journal('ATTENTION : MC_TEST_PRES_GUIDE actif — le héros s\'éveille à côté du guide (réglage de test, jamais en exploitation)');
    if (POSE_LIBRE) journal('ATTENTION : MC_TEST_POSE_LIBRE actif — poser et tirer ne sont PAS contrôlés contre l inventaire (réglage de test, jamais en exploitation)');

    /* Blocs posés d'un seul geste : une porte occupe deux cases (dessus), un lit
       deux cases (la tête, dans la direction de son orientation). Le client annonce
       la case visée ; le serveur pose lui-même la compagne, sans second objet. */
    function cellulesCompagnes(m) {
      const d = C.BLOCKS[m.id];
      if (!d) return [];
      if (d.porte && !d.porte.ouverte) return [{ x: m.x, y: m.y + 1, z: m.z, id: m.id, etat: m.etat || 0 }];
      if (d.meuble === 'lit' && MC.Formes) {
        const e = MC.Formes.unpackMeuble(m.etat || 0);
        if (e.variante) return [];
        const dir = MC.Formes.DIRS[e.orientation];
        return [{ x: m.x + dir[0], y: m.y, z: m.z + dir[1], id: m.id, etat: MC.Formes.packMeuble(e.orientation, true) }];
      }
      return [];
    }
    // la moitié d'une porte cassée, la moitié d'un lit cassé : l'autre case disparaît avec elle
    function compagnesDeCasse(avant, m) {
      const d = C.BLOCKS[avant];
      if (!d) return [];
      const out = [];
      if (d.porte) {
        [1, -1].some(dy => { if (monde.getBlock(m.x, m.y + dy, m.z) === avant) { out.push({ x: m.x, y: m.y + dy, z: m.z }); return true; } return false; });
      } else if (d.meuble === 'lit' && MC.Formes) {
        const e = MC.Formes.unpackMeuble(monde.getEtat(m.x, m.y, m.z));
        const dir = MC.Formes.DIRS[e.orientation];
        const sens = e.variante ? -1 : 1;
        const x = m.x + sens * dir[0], z = m.z + sens * dir[1];
        if (monde.getBlock(x, m.y, z) === avant) out.push({ x, y: m.y, z });
      }
      return out;
    }
    function crediterDebit(js, id) {
      const maintenant = Date.now();
      js.debitsPrevus = (js.debitsPrevus || []).filter(d => maintenant - d.t < DELAI_CREDIT_MS);
      js.debitsPrevus.push({ id, t: maintenant });
      if (js.debitsPrevus.length > CREDITS_MAX) js.debitsPrevus.shift();
    }
    /* Retire des opérations `{ i, id, n }` d'un INV_CONSOMMER ce que le serveur a
       déjà débité (un crédit par exemplaire) ; les autres opérations passent. */
    function absorberDebitsPrevus(js, ops) {
      const maintenant = Date.now();
      js.debitsPrevus = (js.debitsPrevus || []).filter(d => maintenant - d.t < DELAI_CREDIT_MS);
      if (!js.debitsPrevus.length) return ops;
      const out = [];
      ops.forEach(o => {
        if (o.n === undefined || o.usure !== undefined || o.vers !== undefined) { out.push(o); return; }
        let reste = o.n;
        for (let k = 0; k < js.debitsPrevus.length && reste > 0;) {
          if (js.debitsPrevus[k].id === o.id) { js.debitsPrevus.splice(k, 1); reste--; } else k++;
        }
        if (reste > 0) out.push(reste === o.n ? o : Object.assign({}, o, { n: reste }));
      });
      return out;
    }
    // l'objet `idObjet` pose-t-il le bloc `idBloc` ? (bloc lui-même, graine, porte, trappe, dalle fusionnée)
    function objetPoseBloc(idObjet, idBloc) {
      if (idObjet === idBloc) return true;
      const d = C.def(idObjet);
      if (!d) return false;
      if (d.plantable === idBloc) return true;
      if (d.forme === 'dalle' && d.mat === idBloc) return true;
      if (d.porte && C.PORTE_FERMEE_LIST && C.PORTE_FERMEE_LIST.indexOf(idBloc) >= 0) return true;
      if (d.trappe && idBloc === C.B.TRAPPE_FERMEE) return true;
      return false;
    }
    /* Débite une pose : case `preferee` (celle que le client tient) si elle convient,
       sinon la première qui convient. Renvoie false si l'inventaire n'a rien à poser. */
    function debiterPose(js, idBloc, preferee) {
      const inv = js.joueur.state.inv;
      let i = -1;
      if (Number.isInteger(preferee) && inv.slots[preferee] && objetPoseBloc(inv.slots[preferee].id, idBloc)) i = preferee;
      else for (let k = 0; k < inv.slots.length; k++) if (inv.slots[k] && objetPoseBloc(inv.slots[k].id, idBloc)) { i = k; break; }
      if (i < 0) return false;
      const id = inv.slots[i].id;
      inv.consumeAt(i, 1);
      crediterDebit(js, id);
      return true;
    }
    /* Tir : true si le joueur peut tirer ce `genre` ; débite alors la munition.
       Limite documentée (SPEC-SYNC-028) : le serveur ne connaît pas la case
       sélectionnée du client, il exige donc l'arme du genre quelque part dans
       l'inventaire, pas forcément en main. */
    function debiterTir(js, genre) {
      const inv = js.joueur.state.inv;
      const aArme = inv.slots.some(s => { const d = s && C.def(s.id); return !!(d && d.ranged === genre); });
      if (!aArme) return false;
      const sans = inv.slots.some(s => { const d = s && C.def(s.id); return !!(d && d.ranged === genre && d.sansMunition); });
      if (sans) return true;
      for (let i = 0; i < inv.slots.length; i++) {
        const s = inv.slots[i], d = s && C.def(s.id);
        // une munition sans type ne sert que l'arc et l'arbalète (genre « fleche »), jamais la fronde
        if (d && d.ammo && (d.ammoType ? d.ammoType === genre : genre === 'fleche')) {
          inv.consumeAt(i, 1);
          crediterDebit(js, s.id);
          return true;
        }
      }
      return false;
    }
    function blocAutorise(js, m, avant, c) {
      if (!js || js.joueur.state.dead) return false;
      const st = js.joueur.state;
      const d = Math.hypot(m.x + 0.5 - st.pos.x, m.y + 0.5 - st.pos.y - 1.62, m.z + 0.5 - st.pos.z);
      if (d > PORTEE_BLOC) return false;                      // hors de portée
      if (m.id === 0) {
        const def = C.BLOCKS[avant];
        if (!def || def.hardness < 0) return false;            // ni le socle ni l'eau
        if (!MC.Modes.peutCasser(regles, avant)) return false;  // mode histoire : ce bloc ne se casse pas dans cette aventure (ARCHI-041)
        if (def.circuit && def.circuit.adminSeul) return blocCommandeAutorise(c);
        return true;
      }
      // on ne pose que dans une case libre (air, eau, plante) — sauf la fusion de
      // deux dalles du même matériau en bloc plein (SPEC-CONSTR-002), qui écrit
      // par-dessus la dalle visée elle-même, jamais une case vide.
      const defAvant = C.BLOCKS[avant];
      const fusionDalle = !!(defAvant && defAvant.forme === 'dalle' && defAvant.mat === m.id);
      if (!fusionDalle && !C.isReplaceable(avant)) return false;
      const posee = C.BLOCKS[m.id];
      // SPEC-SAVE-022 : seul un bloc DÉFINI se pose — jamais un id d'objet ni un id libre, en créatif
      // et avec MC_TEST_POSE_LIBRE comme en survie (où debiterPose l'exclut déjà, SPEC-SYNC-028)
      if (!posee || m.id >= C.FIRST_ITEM) return false;
      if (posee && posee.circuit && posee.circuit.adminSeul) return blocCommandeAutorise(c);
      if (!MC.Modes.peutPoser(regles, m.id)) return false;      // mode histoire : cet objet n'a pas sa place dans l'aventure (ARCHI-041)
      return true;
    }
    /* SPEC-MECA-007 : poser ou casser un bloc de commande — en ligne, réservé à
       un administrateur (le serveur fait toujours autorité, jamais le mode local
       du client, qui ne veut rien dire une fois connecté). */
    function blocCommandeAutorise(c) {
      /* Même règle pour le solo (serveur fermé) et le réseau (SPEC-ARCHI-033) :
         administrateur, ou hôte local (boucle locale) quand la partie est en
         mode créatif. Le mode est celui du SERVEUR, jamais annoncé par le client. */
      return !!(MC.Circuits && MC.Circuits.commandeAutorisee({
        enLigne: true, role: c && c.role, mode: regles.blocsIllimites ? 'creatif' : 'survie', hote: !!(c && c.local),
      }));
    }
  }

  MC.ServeurPose = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
