/* serveur-recit.js — le récit (mode histoire) côté serveur
   Branchement de MC.RecitServeur sur les joueurs connectés (SPEC-ARCHI-041).

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
    const {
      NP, CONF, CA, PARAMS_HISTOIRE, regles, monde, entites, histoireMonde, recitsRegistre,
      SPAWN, clients, envoyer, journal,
    } = S;
    const EP = S.EP;   // état partagé modifiable, à forme fixe (créé par server.js)
    Object.assign(S, {
      preparerRecit, demarrerRecit, signalerRecit, sonderRecit,
      traiterHistoireParler, traiterHistoireReponse, snapshotRecits,
    });

    // ── mode histoire (SPEC-ARCHI-041, lot P-HIST) ──────────────────────────────
    /* Le récit de CHAQUE joueur vit ICI : le serveur le crée (lié aux lieux réels
       du monde), le fait avancer à partir de ce qu'il arbitre lui-même (blocs
       posés, créatures tuées, gardiens vaincus, position, inventaire, paroles) et
       n'envoie au client que des annonces (HISTOIRE_NOTIF) et la vue de l'état
       (HISTOIRE_ETAT). Règle : un récit PAR JOUEUR nommé (clé de registre), même
       avec plusieurs joueurs ou un écran partagé ; il survit au fichier de monde. */
    const RS = MC.RecitServeur;
    S.RS = RS;
    const peutHistoire = (cat) => MC.Modes.categoriePermise(regles, cat);
    function ctxInventaire(js) { const inv = js.joueur.state.inv; return { compter: (id) => inv.count(id) }; }
    /* Avant BIENVENUE : reprend le récit enregistré (ou celui d'une partie solo
       importée), sinon en crée un et place le héros sur la place de son village. */
    function preparerRecit(js, j) {
      js.recit = null; js.recitFin = null; js.recitNotifs = [];
      if (!regles.histoire) return;
      let rec = null;
      if (js.cleReg && recitsRegistre.has(js.cleReg)) rec = RS.importer(recitsRegistre.get(js.cleReg), peutHistoire);
      if (!rec && js.recitSolo) {
        rec = RS.importer(js.recitSolo, peutHistoire);
        // le brut n'est lâché qu'une fois le récit rattaché à une clé de registre persistée ; illisible, il est conservé tel quel
        if (rec && js.cleReg) { EP.soloRecit = null; if (EP.extrasSolo) EP.extrasSolo.histoire = null; }
        else if (!rec) journal(`histoire : le récit de la partie importée est illisible, conservé tel quel (${js.cleReg || 'sans clé'})`);
      }
      js.recitSolo = null;
      if (rec) { js.recit = rec.etat; js.recitFin = rec.fin; return; }
      const cr = RS.creer({ monde, graine: CONF.graine, params: PARAMS_HISTOIRE, peut: peutHistoire, liens: histoireMonde.liens, pos: SPAWN });
      if (cr.liens && !histoireMonde.liens) histoireMonde.liens = cr.liens;
      js.recit = cr.etat;
      js.recitNotifs = MC.Recits.commencer(js.recit);
      const dep = RS.pointDepart(js.recit);
      if (dep) {
        const px = Math.floor(dep.x), pz = Math.floor(dep.z) + 3;
        for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) monde.getChunk(Math.floor(px / 16) + cx, Math.floor(pz / 16) + cz, true);
        const st = js.joueur.state;
        st.pos.x = px + 0.5 + j * 1.2; st.pos.z = pz + 0.5; st.pos.y = monde.groundAt(px, pz, true) + 1.2;
        st.vel.x = st.vel.y = st.vel.z = 0;
        js.spawn = { x: st.pos.x, y: st.pos.y, z: st.pos.z };
        /* MC_TEST_PRES_GUIDE : réservé aux e2e (serveur jetable de `--tests`), jamais en exploitation — le héros s'éveille
           à côté du guide du village de départ, sans qu'un test ait à marcher jusqu'à lui. */
        if (process.env.MC_TEST_PRES_GUIDE && js.recit.archetype === 'epopee' && monde.habitats) {
          const guide = MC.Habitats.pnjsManquants(monde.habitats.lieuxProches(dep.x, dep.z, 90), [], new Map(), 0)
            .filter(p => p.role === 'guide' && p.lieu === dep.id)[0];
          if (guide) { st.pos.x = guide.x + 1.5; st.pos.z = guide.z + 0.5; st.pos.y = monde.groundAt(Math.floor(st.pos.x), Math.floor(st.pos.z), true) + 1.2; js.spawn = { x: st.pos.x, y: st.pos.y, z: st.pos.z }; }
        }
      }
    }
    // Après BIENVENUE : l'état du récit, et ses premières répliques.
    function demarrerRecit(c, js, j) {
      if (!js.recit) return;
      const notifs = js.recitNotifs || [];
      js.recitNotifs = [];
      js.recitT = 0; js.lieuRecit = null; js.recitMort = false; js.attenteRecit = null; js.recitSig = null;
      livrerRecit(c, j, js, notifs);
    }
    function envoyerEtatRecit(c, j, js, force) {
      /* Signature légère (objectif, journal, fin, choix) comparée à chaque sonde : la vue complète
         (copie profonde + sérialisation) n'est construite que si elle a changé. */
      const i0 = RS.interne(js.recit);
      const choix = RS.choixPose(js.recit);
      const sig = JSON.stringify([MC.Recits.objectif(js.recit), i0 && i0.journal ? i0.journal.length : 0, i0 && i0.fin, choix && choix.id,
        MC.Recits.quetesActives(js.recit).map(q => q.etat).join()]);
      if (!force && sig === js.recitSig) return;
      js.recitSig = sig;
      const v = RS.vue(js.recit, js.recitFin);
      let txt = JSON.stringify(v);
      if (txt.length > CA.BORNES.HISTOIRE_JSON_MAX) {                 // jamais au-delà de la borne du contrat : le journal d'abord
        const i = RS.interne(v.recit);
        if (i && i.journal) i.journal = [];
        txt = JSON.stringify(v);
        if (txt.length > CA.BORNES.HISTOIRE_JSON_MAX) {
          journal(`! histoire : l'état du récit de ${c.nom} dépasse la borne du contrat (${txt.length} octets), non envoyé`);
          return;
        }
      }
      envoyer(c, { t: NP.MSG.HISTOIRE_ETAT, j, etat: v });
    }
    /* Applique les effets d'un lot d'annonces du moteur de récit (objets repris,
       récompenses, créatures, fin) puis les envoie au joueur. */
    function livrerRecit(c, j, js, notifs, extra) {
      const cl = RS.classer(js.recit, notifs);
      const inv = js.joueur.state.inv;
      let invTouche = false;
      cl.prises.forEach(p => {
        let reste = p.objets[0].n;
        (p.parmi || [p.objets[0].id]).forEach(id => {
          const k = Math.min(reste, inv.count(id));
          if (k > 0) { inv.remove(id, k); reste -= k; }
        });
        invTouche = true;
      });
      cl.recompenses.forEach(o => {
        const reste = js.joueur.pickUp(o.id, o.n);
        if (reste) S.lacherAuxPieds(js, { id: o.id, n: reste });
        invTouche = true;
      });
      if (invTouche) S.envoyerInvMaj(c, j, {});
      cl.apparitions.forEach(a => apparitionsRecit(js, a));
      if (cl.fin) {
        js.recitFin = cl.fin;
        succesHistoire(c, js, cl.fin);
        journal(`* ${c.nom} achève le récit (${cl.fin.id})`);
      }
      const MAX = CA.BORNES.HISTOIRE_NOTIFS_MAX;
      for (let k = 0; k < cl.client.length || (k === 0 && extra); k += MAX) {
        const msg = { t: NP.MSG.HISTOIRE_NOTIF, j, notifs: cl.client.slice(k, k + MAX) };
        if (k + MAX >= cl.client.length && extra) {
          if (extra.proposition) msg.proposition = extra.proposition;
          if (extra.libre) { msg.libre = true; msg.eid = extra.eid; }
          extra = null;
        }
        envoyer(c, msg);
        if (k === 0 && !cl.client.length) break;
      }
      envoyerEtatRecit(c, j, js, true);
    }
    /* Le succès « histoire_achevee » (SPEC-ARCHI-042) : signalé UNE fois, à l'achèvement du récit (qui ne s'achève
       qu'une fois : plus aucun évènement n'est évalué ensuite). */
    function succesHistoire(c, js, fin) {
      S.signalerSucces(js, { type: 'histoire', fin: fin.id });
    }
    // Un évènement de jeu arbitré ici (poser, tuer, boss…) : le récit du joueur concerné l'évalue.
    function signalerRecit(c, j, js, ev) {
      if (!js || !js.recit || RS.fin(js.recit)) return;
      ev.t = EP.heure;
      const notifs = RS.signaler(js.recit, ev, ctxInventaire(js));
      if (notifs.length) livrerRecit(c, j, js, notifs); else envoyerEtatRecit(c, j, js, false);
    }
    function apparitionsRecit(js, a) {
      const st = js.joueur.state;
      const ctr = a.pres && a.pres !== 'joueur' && monde.estCharge(a.pres.x, a.pres.z) ? a.pres : st.pos;
      (a.apparitions || []).forEach((ap, ia) => {
        for (let k = 0; k < ap.n; k++) {
          const ang = (k + ia * 3) * 2.1, d = 8 + (k % 3) * 3;
          const x = Math.floor(ctr.x + Math.cos(ang) * d), z = Math.floor(ctr.z + Math.sin(ang) * d);
          if (!monde.estCharge(x, z)) continue;
          const y = monde.groundAt(x, z, true) + 1;
          if (entites.SPECS[ap.type]) entites.spawn(ap.type, x + 0.5, y, z + 0.5, ap.role ? { role: ap.role, nom: 'le caravanier' } : { histoire: a.id });
        }
      });
    }
    /* Deux fois par seconde de temps de jeu, par joueur : où il est, ce qu'il porte,
       l'heure, le ciel, le lieu où il entre ; et la mort définitive (cauchemar). */
    function sonderRecit(c, j, js, dt) {
      if (!js.recit) return;
      const st = js.joueur.state;
      if (st.dead) {
        if (regles.permadeath && !js.recitMort && !RS.fin(js.recit)) {
          js.recitMort = true;
          livrerRecit(c, j, js, RS.signaler(js.recit, { type: 'mort', t: EP.heure }));
        }
        return;
      }
      js.recitMort = false;
      js.recitT -= dt;
      if (js.recitT > 0 || RS.fin(js.recit)) return;
      js.recitT = 0.5;
      const x = Math.floor(st.pos.x), z = Math.floor(st.pos.z);
      const lieu = monde.habitats ? monde.habitats.lieuA(x, z) : null;
      const lieuId = lieu ? lieu.id : null;
      const entre = lieuId && lieuId !== js.lieuRecit ? lieuId : null;
      js.lieuRecit = lieuId;
      let habitants = null;
      if (js.recit.archetype === 'colonie' && monde.habitats) {
        const ctr = RS.interne(js.recit).centre;
        habitants = 0;
        monde.habitats.lieuxProches(ctr.x, ctr.z, 200).forEach(l => { habitants += (l.pnjs || []).length; });
      }
      const notifs = RS.sonder(js.recit, {
        pos: { x: st.pos.x, z: st.pos.z }, biome: monde.biomeAt(x, z).id, nuit: MC.DayCycle.isNight(EP.heure),
        meteo: monde.meteo ? monde.meteo.etat(EP.heure).type : null, t: EP.heure, lieu: entre, habitants,
      }, ctxInventaire(js));
      if (notifs.length) livrerRecit(c, j, js, notifs); else envoyerEtatRecit(c, j, js, false);
    }
    /* HISTOIRE_PARLER : le joueur parle à un habitant. Portée, étape en cours et
       quêtes sont jugées ICI ; le client reçoit des répliques, ou la main pour le commerce. */
    function traiterHistoireParler(c, m) {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || !js.recit || js.joueur.state.dead) return;
      const ent = entites.list.find(e => e.eid === m.eid && !e.dead && entites.SPECS[e.type] && entites.SPECS[e.type].npc);
      if (!ent) return;
      const st = js.joueur.state;
      const d = Math.hypot(ent.pos.x - st.pos.x, (ent.pos.y || 0) - st.pos.y, ent.pos.z - st.pos.z);
      if (d > MC.ContratsV2.BORNES.PORTEE_TROC) return;
      const r = RS.parler(js.recit, regles, ent, ctxInventaire(js), EP.heure);
      js.attenteRecit = r.proposition ? { id: r.proposition.id, role: ent.role || 'habitant' } : null;
      livrerRecit(c, m.j, js, r.notifs, { proposition: r.proposition, libre: r.libre, eid: m.eid });
    }
    /* HISTOIRE_REPONSE : choix du récit ou quête proposée. Un identifiant périmé ou
       rejoué ne change rien ; le client est alors resynchronisé. */
    function traiterHistoireReponse(c, m) {
      const js = c.joueurs && c.joueurs[m.j];
      if (!js || !js.recit || js.joueur.state.dead) return;
      const attente = js.attenteRecit;
      if (attente && attente.id === m.id) js.attenteRecit = null;     // une proposition ne se répond qu'une fois
      const r = RS.repondre(js.recit, attente, m.id, m.option);
      if (r.ok) livrerRecit(c, m.j, js, r.notifs); else envoyerEtatRecit(c, m.j, js, true);
    }
    /* Ce que le fichier de monde garde du récit : registre des joueurs hors ligne + joueurs connectés. */
    function snapshotRecits() {
      const out = new Map(recitsRegistre);
      clients.forEach(c => {
        if (!c.joueurs) return;
        c.joueurs.forEach(js => { if (js.cleReg && js.recit) out.set(js.cleReg, RS.exporter(js.recit, js.recitFin)); });
      });
      return out;
    }
  }

  MC.ServeurRecit = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
