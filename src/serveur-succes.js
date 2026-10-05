/* serveur-succes.js — les succès
   Succès attribués par le serveur (SPEC-ARCHI-042).

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
    const { NP, monde, clients, envoyer, journal } = S;
    const EP = S.EP;   // état partagé modifiable, à forme fixe (créé par server.js)
    Object.assign(S, {
      envoyerSuccesEtat, signalerSucces, crediterSuccesEvenement,
      tickerSuccesJoueur,
    });

    // ── succès (SPEC-ARCHI-042) ──────────────────────────────────────────────────
    /* Le serveur est le SEUL arbitre des succès : il les décide à partir de ce
       qu'il a lui-même constaté (blocs cassés acceptés, fabrication validée,
       position qui fait foi…), jamais d'un message du client. Chaque joueur
       (solo fermé, écran partagé, réseau) a son suivi `js.succes`, persisté dans
       son enregistrement nommé. Le client reçoit SUCCES_DEBLOQUE (annonce, une
       seule fois) et SUCCES_ETAT (compteurs du panneau, au plus toutes les 2 s).
       Les événements `vehicule` (embarquement, P-VEH) et `histoire` (lot P-HIST) passent par ce même `signalerSucces`. */
    const SUCCES_ETAT_PERIODE_S = 2;
    const RAYON_SUCCES_BOSS = 64;
    function clientDeJoueur(js) { return js && js.cid !== null ? clients.get(js.cid) || null : null; }
    function envoyerSuccesEtat(js) {
      const c = clientDeJoueur(js);
      js.succesRevEnvoyee = js.succes.revision();
      js.succesEnvoiT = SUCCES_ETAT_PERIODE_S;
      if (!c || !c.rejoint) return;
      envoyer(c, { t: NP.MSG.SUCCES_ETAT, j: js.j, etat: js.succes.serialiser() });
    }
    function signalerSucces(js, ev) {
      if (!js || !js.succes) return [];
      const nouveaux = js.succes.signaler(ev);
      const c = clientDeJoueur(js);
      if (nouveaux.length && c && c.rejoint) {
        nouveaux.forEach(n => {
          envoyer(c, { t: NP.MSG.SUCCES_DEBLOQUE, j: js.j, id: n.id });
          journal(`succès : ${c.nom} (joueur ${js.j + 1}) — ${n.nom}`);
        });
        envoyerSuccesEtat(js);
      }
      return nouveaux;
    }
    /* Événements du journal des créatures : tuer crédite l'auteur du coup fatal ;
       un gardien vaincu crédite son vainqueur et les joueurs à moins de 64 blocs. */
    function crediterSuccesEvenement(evt) {
      if (evt.type === 'mort') {
        const x = evt.auteur ? S.joueurParEtat(evt.auteur) : null;
        if (x) signalerSucces(x.js, { type: 'tuer', mob: evt.victime });
      } else if (evt.type === 'boss_vaincu') {
        const credites = new Set();
        const x = evt.auteur ? S.joueurParEtat(evt.auteur) : null;
        if (x) credites.add(x.js);
        S.tousLesJoueurs().forEach(({ js }) => {
          const st = js.joueur.state, p = st.pos;
          if (!st.dead && evt.pos && Math.hypot(p.x - evt.pos.x, p.y - evt.pos.y, p.z - evt.pos.z) <= RAYON_SUCCES_BOSS) credites.add(js);
        });
        credites.forEach(js => signalerSucces(js, { type: 'boss', donjon: evt.donjon }));
      }
    }
    /* Une fois par tic et par joueur : position (distance, altitude, nuit), lieu
       visité, et renvoi des compteurs au client quand ils ont changé. */
    function tickerSuccesJoueur(js, dt) {
      const st = js.joueur.state;
      js.suiveur.tic(dt, st.pos, !st.dead, MC.DayCycle.isNight(EP.heure), S.dormeurs.has(js)).forEach(ev => signalerSucces(js, ev));
      js.lieuT -= dt;
      if (js.lieuT <= 0 && monde.habitats && !st.dead) {
        js.lieuT = 1;
        const l = monde.habitats.lieuA(Math.floor(st.pos.x), Math.floor(st.pos.z));
        if (l !== js.lieuSucces) {
          js.lieuSucces = l;
          if (l) signalerSucces(js, { type: 'lieu', kind: l.kind });
        }
      }
      js.succesEnvoiT -= dt;
      if (js.succesEnvoiT <= 0 && js.succes.revision() !== js.succesRevEnvoyee) envoyerSuccesEtat(js);
    }
  }

  MC.ServeurSucces = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
