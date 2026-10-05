/* serveur-vehicules.js — les véhicules
   Véhicules simulés par le serveur (SPEC-SYNC-022, SPEC-SERVEUR-006).

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
    const {
      NP, C, CA, admin, regles, monde, entites, VEHICULES_JOUEUR_MAX, VEHICULES_MAX,
      vehiculesSoute, envoyer, fermerConteneurPourAbonnes, envoyerInvMaj, signalerSucces,
      PORTEE_BLOC, POSE_LIBRE,
    } = S;
    const EP = S.EP;   // état partagé modifiable, à forme fixe (créé par server.js)
    Object.assign(S, {
      evtVehicule, vehiculeParEid, poserVehiculeServeur, monterVehiculeServeur,
      reparerVehiculeServeur, descendreVehiculeServeur, entretenirMonture,
      souteDeVehicule, liberSoutesDetruites,
    });

    /* ── Véhicules (lot P-VEH — SPEC-ARCHI-021, SPEC-SYNC-022, SPEC-SERVEUR-006) ──
       Un véhicule est une entité du monde (entites.list, type « v_<nom> »), donc
       diffusée aux clients à portée avec les autres entités (ETAT.mobs, plafond
       propre MAX_VEHICULES_DIFFUSES). Le serveur fait seul autorité :
       - poser : validé contre la portée, la place et l'inventaire (comme un bloc) ;
       - monter/descendre : validés contre la portée et l'occupation ;
       - conduire : les touches de ENTREE (avant, arrière, gauche, droite, saut, course)
         sont intégrées par MC.Vehicules.conduire à CHAQUE entrée rejouée, sous le
         budget de temps du joueur (js.budget) — donc vitesse maximale, accélération
         et position ne se « déclarent » jamais, ils se simulent. L'état du véhicule
         conduit revient au conducteur dans ETAT.toi[].veh (réconciliation) ;
       - la soute est un conteneur serveur, clé « v<eid> » (CONTENEUR_OUVRIR { eid }) ;
       - le tout est sauvegardé dans etatMonde().vehicules (SPEC-SERVEUR-006). */
    const V = MC.Vehicules;
    function evtVehicule(c, j, evt, extra) {
      envoyer(c, Object.assign({ t: NP.MSG.VEHICULE_EVT, j, evt }, extra || {}));
    }
    function refusVehicule(c, j, motif) { evtVehicule(c, j, CA.EVT_VEHICULE.REFUS, { motif }); }
    function vehiculeParEid(eid) {
      return entites.list.find(e => e.eid === eid && e.vehicule && !e.dead) || null;
    }
    // distance de l'œil d'un joueur au véhicule (bord de la caisse, pas son centre)
    function distanceVehicule(st, e) {
      const d = V.defDe(e);
      return Math.hypot(e.pos.x - st.pos.x, e.pos.y + (d ? d.h / 2 : 0.5) - (st.pos.y + 1.62), e.pos.z - st.pos.z) - (d ? d.w / 2 : 0.5);
    }
    function poserVehiculeServeur(c, m) {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) return;
      const st = js.joueur.state;
      const def = V.DEFS[m.nom];
      if (st.dead) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.MORT);
      if (!def || Math.abs(m.nx) + Math.abs(m.ny) + Math.abs(m.nz) !== 1) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.INCONNU);
      const portee = Math.hypot(m.x + 0.5 - st.pos.x, m.y + 0.5 - (st.pos.y + 1.62), m.z + 0.5 - st.pos.z);
      if (portee > PORTEE_BLOC) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.PORTEE);
      if (!monde.getBlock(m.x, m.y, m.z)) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.INCONNU);   // rien là (ou chunk absent)
      let x = m.x + m.nx + 0.5, y = m.y + m.ny, z = m.z + m.nz + 0.5;
      // un peu de place : on remonte d'un cran si l'engin serait dans le décor
      for (let k = 0; k < 3 && MC.Physics.collides(monde, x, y, z, def.w, def.h); k++) y++;
      const poseur = c.nom + '#' + m.j;
      const posesLibres = entites.list.filter(e => e.vehicule && e.poseur === poseur && !e.conducteur).length;
      if (MC.Physics.collides(monde, x, y, z, def.w, def.h) || posesLibres >= VEHICULES_JOUEUR_MAX
          || entites.list.filter(e => e.vehicule).length >= VEHICULES_MAX) {
        return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.PLACE);
      }
      // en survie, l'objet est retiré de l'inventaire SERVEUR (case annoncée si elle convient, sinon la première qui convient)
      let paye = false;
      if (!regles.blocsIllimites && !POSE_LIBRE) {
        const inv = st.inv;
        const convient = (s) => s && C.def(s.id) && C.def(s.id).vehicule === m.nom;
        let i = m.i >= 0 && convient(inv.slots[m.i]) ? m.i : inv.slots.findIndex(convient);
        if (i < 0) { envoyerInvMaj(c, m.j, {}); return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.INVENTAIRE); }
        inv.consumeAt(i, 1);
        paye = true;
      }
      const e = V.poser(entites, m.nom, x, y, z, st.yaw);
      if (e) e.poseur = poseur;
      if (e && e.soute) vehiculesSoute.add(e);
      if (paye) envoyerInvMaj(c, m.j, {});
      MC.Admin.journaliser(admin, { auteur: c.nom, action: 'vehicule_pose', cible: `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`, details: m.nom, heure: EP.heure });
      evtVehicule(c, m.j, CA.EVT_VEHICULE.POSE, { nom: m.nom });
    }
    function monterVehiculeServeur(c, m) {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) return;
      const st = js.joueur.state;
      if (st.dead) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.MORT);
      if (st.monture) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.DEJA_A_BORD);
      const e = vehiculeParEid(m.eid);
      if (!e) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.INCONNU);
      if (distanceVehicule(st, e) > CA.BORNES.PORTEE_VEHICULE) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.PORTEE);
      if (e.conducteur && e.conducteur.monture !== e) e.conducteur = null;       // conducteur disparu sans libérer son siège
      if (!V.monter(st, e)) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.OCCUPE);
      js.vehInactif = 0;
      MC.Admin.journaliser(admin, { auteur: c.nom, action: 'vehicule_monte', cible: e.vehicule, details: e.eid, heure: EP.heure });
      evtVehicule(c, m.j, CA.EVT_VEHICULE.MONTE, { nom: e.vehicule });
      signalerSucces(js, { type: 'vehicule', vehicule: e.vehicule });     // « premier_vehicule » : SUCCES_DEBLOQUE au joueur j (écran partagé compris)
    }
    /* SPEC-TRANSPORT-002 / METIER-002 : la réparation d'un véhicule avarié se paie en émeraudes
       sur l'inventaire SERVEUR, chez un forgeron à portée — la même règle (MC.Habitats.servir)
       que l'outil en main, le véhicule conduit passant en premier. */
    function reparerVehiculeServeur(c, m) {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js) return;
      const st = js.joueur.state, mt = st.monture;
      if (st.dead || !mt || !mt.avarie) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.INCONNU);
      const forgeron = entites.list.find(e => e.eid === m.eid && !e.dead && e.role && MC.Habitats.ROLES[e.role] && MC.Habitats.ROLES[e.role].service === 'reparer');
      if (!forgeron) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.INCONNU);
      if (Math.hypot(forgeron.pos.x - st.pos.x, (forgeron.pos.y || 0) - st.pos.y, forgeron.pos.z - st.pos.z) > MC.ContratsV2.BORNES.PORTEE_CONTENEUR + 2) {
        return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.PORTEE);
      }
      const r = MC.Habitats.servir('reparer', { inv: st.inv, etat: st, vehicule: mt, temps: EP.heure });
      envoyerInvMaj(c, m.j, {});
      if (!r.ok) return refusVehicule(c, m.j, CA.MOTIFS_VEHICULE.INVENTAIRE);
      evtVehicule(c, m.j, CA.EVT_VEHICULE.REPARE, { nom: mt.vehicule });
    }
    function descendreVehiculeServeur(c, j, js) {
      const pc = MC.PlayerConst;
      V.descendre(js.joueur.state, monde, pc.PW, pc.PH);
      evtVehicule(c, j, CA.EVT_VEHICULE.DESCEND);
    }
    /* Une fois par tic et par joueur, après ses entrées : engin détruit (on est à
       pied), joueur mort (il descend), client muet (l'engin n'est plus commandé :
       il ralentit et retombe comme un véhicule abandonné, VEHIC-009). */
    function entretenirMonture(js, dt, avance) {
      const st = js.joueur.state, mt = st.monture;
      if (!mt) { js.vehInactif = 0; return; }
      if (mt.dead) { mt.conducteur = null; st.monture = null; return; }
      if (st.dead) { const pc = MC.PlayerConst; V.descendre(st, monde, pc.PW, pc.PH); return; }
      if (avance > 0) { js.vehInactif = 0; return; }
      js.vehInactif = (js.vehInactif || 0) + dt;
      /* Hors terrain généré côté serveur (son conducteur attend son sol), le véhicule est
         GELÉ comme toute entité hors zone chargée : rouler sur son élan au-dessus de
         chunks absents (getBlock = 0) le ferait tomber, passager compris. */
      if (!S.solChargeEn(mt.pos.x, mt.pos.z)) return;
      if (js.vehInactif > 0.5) { V.conduire(mt, dt, monde, null); V.caler(st); }
    }
    /* La soute d'un véhicule (clé « v<eid> ») s'il existe et si `st` en est assez proche. */
    function souteDeVehicule(cle, st) {
      if (typeof cle !== 'string' || !/^v[1-9][0-9]{0,8}$/.test(cle)) return null;
      const e = vehiculeParEid(+cle.slice(1));
      if (!e || !e.soute) return null;
      if (st && distanceVehicule(st, e) > MC.ContratsV2.BORNES.PORTEE_CONTENEUR) return null;
      return e.soute;
    }
    // un véhicule détruit rend sa soute au sol et ferme l'écran de ceux qui l'avaient ouverte
    function liberSoutesDetruites() {
      vehiculesSoute.forEach(e => {
        if (!e.dead) return;
        vehiculesSoute.delete(e);
        fermerConteneurPourAbonnes('v' + e.eid);
        e.soute.slots.forEach((s, i) => {
          if (s) entites.dropStack(e.pos.x, e.pos.y + 0.5, e.pos.z, s);
          e.soute.slots[i] = null;
        });
      });
    }
  }

  MC.ServeurVehicules = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
