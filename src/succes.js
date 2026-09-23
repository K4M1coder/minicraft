/* succes.js — succès du jeu. Logique pure : chaque succès récompense une
   étape (premier bloc, premier outil, premier gardien, première ville…),
   s'annonce une seule fois et se retrouve dans un panneau de progression.

   Le jeu signale des événements au fil de la partie ({type:'casser', bloc},
   {type:'tuer', mob}, …) ; ce module ne connaît rien du rendu ni de
   l'interface, seulement comment transformer ces événements en compteurs
   puis en déblocages. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core;
  var B = C.B, I = C.I;

  // créatures hostiles : celles qui comptent pour le succès des dix vaincues
  var HOSTILES = { zombie: 1, squelette: 1, araignee: 1, creeper: 1, enderman: 1,
                    sorciere: 1, noye: 1, pillard: 1, spectre: 1, gardien: 1 };

  function estBois(bloc) { var d = C.def(bloc); return !!(d && d.log); }
  function estOutil(id) { var d = C.def(id); return !!(d && d.tool); }

  /* Chaque entrée : nom, description, l'événement qui la fait progresser,
     le seuil à atteindre, et un filtre optionnel (l'événement ne compte que
     s'il le vérifie) ; `valeur(ev)` (par défaut 1) donne ce qu'on ajoute au
     compteur — utile pour cumuler une distance plutôt que compter des coups. */
  var LISTE = {
    premier_bloc:      { nom: 'Premier bloc', description: 'Casser un premier bloc.',
                          evenement: 'casser', seuil: 1 },
    premier_bois:      { nom: 'Bûcheron débutant', description: 'Récolter un premier tronc.',
                          evenement: 'casser', seuil: 1, filtre: function (ev) { return estBois(ev.bloc); } },
    premier_outil:     { nom: 'Premier outil', description: 'Fabriquer un premier outil.',
                          evenement: 'fabriquer', seuil: 1, filtre: function (ev) { return estOutil(ev.id); } },
    pioche_diamant:    { nom: 'Éclat de diamant', description: 'Fabriquer une pioche en diamant.',
                          evenement: 'fabriquer', seuil: 1, filtre: function (ev) { return ev.id === I.DIAMOND_PICKAXE; } },
    dix_hostiles:      { nom: 'Chasseur', description: 'Vaincre dix créatures hostiles.',
                          evenement: 'tuer', seuil: 10, filtre: function (ev) { return !!HOSTILES[ev.mob]; } },
    premier_gardien:   { nom: 'Premier gardien', description: 'Vaincre le gardien d\'un donjon.',
                          evenement: 'boss', seuil: 1 },
    trois_gardiens:    { nom: 'Chasseur de donjons', description: 'Vaincre trois gardiens de donjon.',
                          evenement: 'boss', seuil: 3 },
    premiere_ville:    { nom: 'Citadin', description: 'Visiter une première ville.',
                          evenement: 'lieu', seuil: 1, filtre: function (ev) { return ev.kind === 'ville'; } },
    premier_village:   { nom: 'Villageois', description: 'Visiter un premier village.',
                          evenement: 'lieu', seuil: 1, filtre: function (ev) { return ev.kind === 'village'; } },
    nuit_survecue:     { nom: 'Nuit survécue', description: 'Survivre à une nuit entière.',
                          evenement: 'nuit', seuil: 1 },
    haute_altitude:    { nom: 'Prise d\'altitude', description: 'Monter au-dessus de 100 blocs.',
                          evenement: 'altitude', seuil: 1, filtre: function (ev) { return ev.y > 100; } },
    cinq_mille_blocs:  { nom: 'Grand voyageur', description: 'Parcourir 5000 blocs.',
                          evenement: 'distance', seuil: 5000, valeur: function (ev) { return ev.blocs || 0; } },
    premier_vehicule:  { nom: 'Premier véhicule', description: 'Fabriquer ou embarquer un premier véhicule.',
                          evenement: 'vehicule', seuil: 1 },
    banque_ouverte:    { nom: 'Compte en banque', description: 'Ouvrir un compte en banque.',
                          evenement: 'banque', seuil: 1 },
    histoire_achevee:  { nom: 'Conteur', description: 'Achever une histoire.',
                          evenement: 'histoire', seuil: 1, filtre: function (ev) { return !!ev.fin; } },
    premier_echange:   { nom: 'Premier échange', description: 'Réaliser un premier échange.',
                          evenement: 'echange', seuil: 1 },
    foudroye_vivant:   { nom: 'Rescapé', description: 'Être foudroyé et y survivre.',
                          evenement: 'foudre', seuil: 1 },
    vingt_repas:       { nom: 'Bon appétit', description: 'Manger vingt fois.',
                          evenement: 'manger', seuil: 20 },
  };

  var IDS = Object.keys(LISTE);

  /* Le suivi d'une partie : ses compteurs, ce qui est débloqué, dans quel
     ordre. `signaler` est appelé pour chaque événement du jeu ; il rend la
     liste des succès qui viennent tout juste de se débloquer (à annoncer
     une fois, jamais plus). */
  function creer() {
    var compte = {};             // id de succès -> compteur cumulé
    var debloque = {};           // id de succès -> true une fois obtenu
    var ordre = [];              // ids dans l'ordre d'obtention

    function signaler(ev) {
      var nouveaux = [];
      if (!ev || !ev.type) return nouveaux;
      IDS.forEach(function (id) {
        if (debloque[id]) return;                       // déjà annoncé : plus rien à faire
        var def = LISTE[id];
        if (def.evenement !== ev.type) return;           // type d'événement qui ne le concerne pas
        if (def.filtre && !def.filtre(ev)) return;        // ne correspond pas à ce succès précis
        var ajout = def.valeur ? def.valeur(ev) : 1;
        compte[id] = (compte[id] || 0) + ajout;
        if (compte[id] >= def.seuil) {
          debloque[id] = true;
          ordre.push(id);
          nouveaux.push({ id: id, nom: def.nom, description: def.description });
        }
      });
      return nouveaux;
    }

    function estDebloque(id) { return !!debloque[id]; }
    function debloques() { return ordre.slice(); }

    function progression() {
      return IDS.map(function (id) {
        var def = LISTE[id];
        return { id: id, nom: def.nom, description: def.description,
                  compte: Math.min(compte[id] || 0, def.seuil), seuil: def.seuil, fait: !!debloque[id] };
      });
    }

    function serialiser() {
      var c = {};
      IDS.forEach(function (id) { if (compte[id]) c[id] = compte[id]; });
      return { compte: c, debloques: ordre.slice() };
    }

    /* Tolère des données absentes ou partielles : une sauvegarde d'avant ce
       module, un objet vide, un tableau tronqué… on ne perd que ce qui
       manque, jamais on ne plante. */
    function charger(obj) {
      compte = {};
      debloque = {};
      ordre = [];
      if (!obj || typeof obj !== 'object') return;
      if (obj.compte && typeof obj.compte === 'object') {
        IDS.forEach(function (id) {
          var v = obj.compte[id];
          if (typeof v === 'number' && v > 0) compte[id] = v;
        });
      }
      if (Array.isArray(obj.debloques)) {
        obj.debloques.forEach(function (id) {
          if (LISTE[id] && !debloque[id]) { debloque[id] = true; ordre.push(id); }
        });
      }
    }

    return { signaler: signaler, estDebloque: estDebloque, debloques: debloques,
             progression: progression, serialiser: serialiser, charger: charger };
  }

  function total() { return IDS.length; }

  MC.Succes = { LISTE: LISTE, creer: creer, total: total };
})(typeof globalThis !== 'undefined' ? globalThis : this);
