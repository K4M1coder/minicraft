/* hud.js — registre d'affichage du HUD. Pur : ni THREE, ni DOM, ni stockage
   direct (l'objet `stockage` est injecté, comme dans saves.js), ce qui le
   rend testable sous Node et réutilisable pour chaque vue d'écran partagé. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  var CLE_STOCKAGE = 'minicraft.hud';

  /* Un composant ou groupe de composants du HUD : un identifiant stable, un
     nom lisible pour le panneau « Affichage », et les sélecteurs CSS des
     éléments qu'il recouvre (un groupe partage un seul id — SPEC-HUD-004,
     SPEC-HUD-006 — pour que ses éléments basculent toujours ensemble). */
  var COMPOSANTS = [
    { id: 'infos', nom: 'Informations de débogage', selecteurs: ['.debug'] },
    { id: 'viseur', nom: 'Viseur et anneau de minage', selecteurs: ['.crosshair', '.mining-ring'] },
    { id: 'barres', nom: 'Barres de vie, de faim et d\'air', selecteurs: ['.stats'] },
    { id: 'objets', nom: 'Barre d\'objets et objet tenu', selecteurs: ['.hotbar', '.held-name'] },
    { id: 'notifications', nom: 'Notifications', selecteurs: ['.toasts'] },
    { id: 'chat', nom: 'Chat', selecteurs: ['.chat'] },
    { id: 'boussole', nom: 'Boussole des repères', selecteurs: ['.boussole'] },
    { id: 'gardien', nom: 'Barre du gardien', selecteurs: ['.barre-boss'] },
    { id: 'objectif', nom: 'Objectif de l\'histoire', selecteurs: ['.objectif-histoire'] },
    { id: 'etiquettes', nom: 'Étiquettes des joueurs (écran partagé)', selecteurs: ['.etiquette'] },
  ];

  var IDS = COMPOSANTS.map(function (c) { return c.id; });

  function estId(id) { return IDS.indexOf(id) >= 0; }

  /* Registre : l'état de visibilité de chaque composant, plus une bascule
     générale (SPEC-HUD-001). `stockage` est optionnel, de forme localStorage
     (getItem/setItem) ; toute erreur (quota, mode privé…) est avalée. */
  function creerRegistre(stockage) {
    var etat = { composants: {}, masqueGenerale: false, exceptions: {} };
    COMPOSANTS.forEach(function (c) { etat.composants[c.id] = true; });

    function lireStockage() {
      if (!stockage) return null;
      try {
        var brut = stockage.getItem(CLE_STOCKAGE);
        return brut ? JSON.parse(brut) : null;
      } catch (e) { return null; }
    }
    function ecrireStockage() {
      if (!stockage) return;
      try { stockage.setItem(CLE_STOCKAGE, JSON.stringify(serialiser())); } catch (e) {}
    }

    /* Visible : masqué si la bascule générale est active, SAUF pour un
       composant explicitement rouvert depuis le masquage (SPEC-HUD-008 : T
       rouvre le chat même si tout est masqué). */
    function visible(id) {
      if (!estId(id)) return false;
      if (etat.masqueGenerale && !etat.exceptions[id]) return false;
      return etat.composants[id] !== false;
    }

    function regler(id, v) {
      if (!estId(id)) return false;
      v = !!v;
      etat.composants[id] = v;
      if (etat.masqueGenerale) {
        if (v) etat.exceptions[id] = true; else delete etat.exceptions[id];
      }
      ecrireStockage();
      return visible(id);
    }

    function basculer(id) { return regler(id, !visible(id)); }

    function toutMasquer() {
      etat.masqueGenerale = true;
      etat.exceptions = {};
      ecrireStockage();
    }
    function toutAfficher() {
      etat.masqueGenerale = false;
      etat.exceptions = {};
      ecrireStockage();
    }
    function basculerTout() {
      if (etat.masqueGenerale) toutAfficher(); else toutMasquer();
      return !etat.masqueGenerale;
    }

    /* État affiché : la visibilité effective de chaque composant. */
    function etatFn() {
      var o = {};
      COMPOSANTS.forEach(function (c) { o[c.id] = visible(c.id); });
      return o;
    }

    /* Forme persistable — les préférences par composant et la bascule
       générale, séparées de l'état dérivé (`etat()`). */
    function serialiser() {
      var composants = {};
      COMPOSANTS.forEach(function (c) { composants[c.id] = etat.composants[c.id] !== false; });
      return { composants: composants, masqueGenerale: !!etat.masqueGenerale };
    }
    function charger(obj) {
      if (!obj || typeof obj !== 'object') return false;
      if (obj.composants) {
        COMPOSANTS.forEach(function (c) {
          if (typeof obj.composants[c.id] === 'boolean') etat.composants[c.id] = obj.composants[c.id];
        });
      }
      etat.masqueGenerale = !!obj.masqueGenerale;
      etat.exceptions = {};
      return true;
    }

    // reprise de la dernière conservation, s'il y en a une
    charger(lireStockage());

    return {
      visible: visible, basculer: basculer, regler: regler,
      toutMasquer: toutMasquer, toutAfficher: toutAfficher, basculerTout: basculerTout,
      etat: etatFn, serialiser: serialiser, charger: charger,
      get masqueGenerale() { return etat.masqueGenerale; },
    };
  }

  /* Cap (0-359°, nord = -z) et point cardinal du regard, plus l'inclinaison
     en degrés (positive = vers le haut). Convention du projet : l'avant de
     la caméra vaut (-sin yaw, 0, -cos yaw) ; x croît vers l'est, z vers le
     sud. Le cap est donc l'opposé du yaw, ramené dans [0, 360[. */
  var CARDINAUX = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  function orientation(yaw, pitch) {
    yaw = yaw || 0; pitch = pitch || 0;
    var capDeg = (-yaw * 180 / Math.PI) % 360;
    if (capDeg < 0) capDeg += 360;
    var cap = Math.round(capDeg) % 360;
    var idx = Math.round(cap / 45) % 8;
    var inclinaison = Math.round(pitch * 180 / Math.PI);
    return { cap: cap, cardinal: CARDINAUX[idx], inclinaison: inclinaison };
  }

  MC.Hud = {
    COMPOSANTS: COMPOSANTS, creerRegistre: creerRegistre, orientation: orientation,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
