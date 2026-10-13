/* serveur-journal.js — le journal du serveur : console et fichier
   Format de la console du serveur (lu par les lanceurs et les tests
   d'intégration : « écoute : », MC_PORT=…) et sortie fichier quotidienne
   bornée (SPEC-BANC-104 à 110).

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
    const { Buffer, process } = S.hote;
    const { fs, path, RACINE, J } = S;
    Object.assign(S, { sortieFichierJournal, journal });

    const SANS_PREFIXE = new Set(['SERVEUR', 'SECRET']);
    function formatConsoleServeur(e) {
      if (e.brut) return e.message;
      const h = new Date(e.t).toTimeString().slice(0, 8);
      const prefixe = (SANS_PREFIXE.has(e.domaine) ? '' : e.domaine + ' ') + (e.niveau === 'info' ? '' : e.niveau.toUpperCase() + ' ');
      const code = e.code && e.message.indexOf(e.code) < 0 ? e.code + ' ' : '';
      return `[${h}] ${prefixe}${code}${J.ligneSure(e.message)}`;
    }
    J.configurer({ mode: 'serveur', console: { methode: 'log', format: formatConsoleServeur } });
    /* Une sortie standard devenue invalide (relance par une bascule de partie
       dont la console a disparu, exécutable lancé sans console, terminal
       fermé) signale sa panne par l'évènement « error » du flux, APRÈS
       l'écriture : sans écouteur, Node en fait une exception non rattrapée à
       chaque ligne du journal. L'écouteur coupe la console du journal pour de
       bon (E-JOURNAL-001) ; le fichier du journal continue. */
    [process.stdout, process.stderr].forEach((flux) => {
      if (flux && typeof flux.on === 'function' && typeof J.consoleEnPanne === 'function') {
        flux.on('error', (e) => { try { J.consoleEnPanne(e, { morte: true }); } catch (err) { /* jamais lever ici */ } });
      }
    });
    const logServeur = J('SERVEUR');
    S.logServeur = logServeur;
    /* Lignes lues par un programme (aide, MC_PORT=) : un domaine à part, jamais
       coupé par SERVEUR:warn — et jamais en dessous de info (voir --journal). */
    const logLanceur = J('LANCEUR');
    S.logLanceur = logLanceur;
    const logReseau = J('RESEAU');
    S.logReseau = logReseau;
    const logClient = J('CLIENT');         // erreurs remontées par les clients (SPEC-BANC-106)
    S.logClient = logClient;
    /* Ce qui ne doit JAMAIS aller sur disque (jeton d'administration généré) :
       affiché à la console comme une ligne SERVEUR, ignoré par la sortie fichier. */
    const logSecret = J('SECRET');
    S.logSecret = logSecret;

    /* Sortie « fichier du serveur » (SPEC-BANC-106) : `logs/serveur-<date>.log`
       (dossier réglable par MC_JOURNAL_DOSSIER), un fichier par jour, les
       JOURNAUX_GARDES plus récents seulement, et au plus PLAFOND_JOURNAL octets
       par jour (MC_JOURNAL_MAX_OCTETS) : au-delà, une seule ligne E-SERV-005
       puis plus rien jusqu'au lendemain — un client ou un flot d'évènements ne
       remplit jamais le disque. Écriture synchrone sur un descripteur ouvert,
       donc bornée par ce plafond : une ligne `fatal` juste avant process.exit()
       n'est jamais perdue. Une panne d'écriture coupe la sortie (un seul
       avertissement E-SERV-004 à la console), jamais le serveur. Le domaine
       SECRET n'y entre pas. */
    const JOURNAUX_GARDES = 14;
    const PLAFOND_JOURNAL = parseInt(process.env.MC_JOURNAL_MAX_OCTETS, 10) > 0 ? parseInt(process.env.MC_JOURNAL_MAX_OCTETS, 10) : 50 * 1024 * 1024;
    function sortieFichierJournal(dossier) {
      let fd = null, jour = null, octets = 0, plein = false, enPanne = false;
      const deux = (n) => String(n).padStart(2, '0');
      const jourDe = (t) => { const d = new Date(t); return d.getFullYear() + '-' + deux(d.getMonth() + 1) + '-' + deux(d.getDate()); };
      function ouvrir(j) {
        if (fd !== null) { try { fs.closeSync(fd); } catch (e) { /* déjà fermé */ } fd = null; }
        fs.mkdirSync(dossier, { recursive: true });
        fd = fs.openSync(path.join(dossier, 'serveur-' + j + '.log'), 'a');
        jour = j;
        octets = fs.fstatSync(fd).size;
        plein = false;
        try {
          fs.readdirSync(dossier).filter(f => /^serveur-\d{4}-\d\d-\d\d\.log$/.test(f)).sort().slice(0, -JOURNAUX_GARDES)
            .forEach(f => { try { fs.unlinkSync(path.join(dossier, f)); } catch (e) { /* tant pis */ } });
        } catch (e) { /* rotation au prochain jour */ }
      }
      return {
        nom: 'fichier', seuil: 'info', suitDomaines: true,      // un domaine relevé (--journal RESEAU:trace) y écrit aussi ses traces (SPEC-BANC-103)
        ecrire(e) {
          if (enPanne || e.domaine === 'SECRET') return;
          try {
            const j = jourDe(e.t);
            if (j !== jour) ouvrir(j);
            if (plein) return;
            let ligne = process.pid + ' ' + J.formater(e) + '\n';
            if (octets + Buffer.byteLength(ligne) > PLAFOND_JOURNAL) {
              plein = true;
              ligne = process.pid + ' ' + new Date(e.t).toISOString() + ' WARN SERVEUR E-SERV-005 journal du jour plein (' + PLAFOND_JOURNAL + ' octets) : écriture suspendue jusqu\'à demain\n';
            }
            octets += fs.writeSync(fd, ligne);
          } catch (err) {
            enPanne = true;
            logServeur.warn(`E-SERV-004 sortie fichier du journal en panne (${dossier}) : ${(err && err.message) || err} — le journal continue à la console seulement`);
          }
        },
      };
    }
    const DOSSIER_JOURNAL = path.resolve(RACINE, process.env.MC_JOURNAL_DOSSIER || 'logs');
    S.DOSSIER_JOURNAL = DOSSIER_JOURNAL;
    /* Le journal historique du serveur : une ligne `[HH:MM:SS] texte` — désormais
       MC.Journal, domaine SERVEUR, niveau info (même sortie, plus le fichier). */
    function journal(txt) { logServeur.info(txt); }
  }

  /* Gardien des pannes du processus (SPEC-SECU-002) : ce que font les
     gestionnaires `uncaughtException` / `unhandledRejection` de server.js.
     Fonction PURE (horloge, journal, sauvegarde et arrêt injectés), testée
     seule (tests/spec-serveur-modules.js).

     Une panne est journalisée (E-SERV-007) et le serveur continue, comme
     avant ; mais le gardien ne doit JAMAIS tourner dans le vide :
       - non ré-entrant : une panne levée pendant qu'il traite la précédente
         est comptée, rien de plus ;
       - il n'appelle rien qui puisse lever sans le rattraper (journal compris :
         c'est un journal qui levait à chaque ligne qui faisait boucler) ;
       - la même panne répétée n'écrit pas N lignes : la première en entier,
         puis une ligne de compte au plus toutes les `regroupementMs` ;
       - des pannes qui VARIENT (identifiant, coordonnée dans le message)
         n'écrivent pas une pile chacune : au plus `lignesMax` lignes par
         `regroupementMs`, le reste est compté et résumé en une ligne
         (« N pannes différentes non écrites ») à la fenêtre suivante ;
       - une horloge qui RECULE (NTP, veille, changement d'heure) remet les
         fenêtres à zéro : un écart négatif n'est jamais pris pour une tempête ;
       - l'échec de la sauvegarde de secours a son propre code (E-SERV-009) ;
       - la sauvegarde de secours (synchrone et atomique) : la première tout de
         suite, puis au plus une toutes les `sauvegardeMs` ;
       - au-delà de `max` pannes en `fenetreMs` (une tempête : le processus ne
         fait plus que ça), une dernière sauvegarde, une ligne E-SERV-008, et
         l'arrêt du processus avec le code `codeArret`. */
  const GARDIEN = { max: 200, fenetreMs: 5000, sauvegardeMs: 30000, regroupementMs: 30000, lignesMax: 20, codeArret: 70 };
  function gardienPannes(o) {
    const reglage = Object.assign({}, GARDIEN, o.reglage || {});
    const etat = { pannes: 0, ignorees: 0, lignes: 0, sauvegardes: 0, arret: false };
    const recentes = [];                         // instants des dernières pannes (au plus max)
    let enCours = false, derniereSauvegarde = null, courante = null, derniere = null;
    const budget = { debut: null, ecrites: 0, tues: 0, resume: '' };   // lignes de la fenêtre de regroupement en cours
    function horloge() { try { const t = o.horloge(); return typeof t === 'number' && isFinite(t) ? t : 0; } catch (e) { return 0; } }
    function ecrire(niveau, texte, code) { etat.lignes++; try { o.journaliser(niveau, texte, code); } catch (e) { /* un journal en panne ne fait pas boucler */ } }
    function texteDe(x) { try { return String((x && x.stack) || x); } catch (e) { return '(panne illisible)'; } }
    function resumeDe(x) {
      const t = texteDe(x).split('\n');
      const site = t.find(l => /^\s+at /.test(l));
      return t[0].slice(0, 300) + (site ? ' ' + site.trim().slice(0, 200) : '');
    }
    function sauvegarder() {
      etat.sauvegardes++;
      try { o.sauvegarder(); } catch (e) { ecrire('error', 'échec de la sauvegarde de secours : ' + texteDe(e && e.message || e).slice(0, 300), 'E-SERV-009'); }
    }
    /* Une ligne E-SERV-007 (pile ou compte) dans la limite de la fenêtre ;
       au-delà, la panne est seulement comptée. */
    function ecrireBorne(texte, pannes, resume) {
      if (budget.ecrites >= reglage.lignesMax) { budget.tues += pannes; budget.resume = resume; return false; }
      budget.ecrites++;
      ecrire('error', texte, 'E-SERV-007');
      return true;
    }
    function solderBudget(t) {
      if (budget.tues > 0) ecrire('error', `${budget.tues} pannes différentes non écrites en ${Math.round((t - budget.debut) / 1000)} s (au plus ${reglage.lignesMax} lignes par ${reglage.regroupementMs / 1000} s) — la dernière : ${budget.resume}`, 'E-SERV-007');
      budget.debut = t; budget.ecrites = 0; budget.tues = 0; budget.resume = '';
    }
    function compte(t) {
      if (!courante || courante.repetitions === 0) return;
      ecrireBorne(`${courante.libelle} : la même panne s'est répétée ${courante.repetitions} fois en ${Math.round((t - courante.debut) / 1000)} s — ${courante.resume}`, courante.repetitions, courante.resume);
      courante.repetitions = 0; courante.debut = t;
    }
    function signaler(libelle, panne, opts) {
      etat.pannes++;
      if (enCours || etat.arret) { etat.ignorees++; return; }
      enCours = true;
      try {
        const t = horloge();
        if (derniere !== null && t < derniere) {
          // l'horloge a reculé : les fenêtres repartent de maintenant
          recentes.length = 0;
          if (courante) courante.debut = t;
          if (derniereSauvegarde !== null) derniereSauvegarde = t - reglage.sauvegardeMs;
          budget.debut = t;
        }
        derniere = t;
        if (budget.debut === null) budget.debut = t;
        else if (t - budget.debut >= reglage.regroupementMs) solderBudget(t);
        recentes.push(t);
        if (recentes.length > reglage.max) recentes.shift();
        if (recentes.length >= reglage.max && t - recentes[0] <= reglage.fenetreMs) {
          etat.arret = true;
          compte(t);
          solderBudget(t);
          ecrire('fatal', `E-SERV-008 tempête de pannes : ${reglage.max} en moins de ${reglage.fenetreMs / 1000} s (dernière : ${resumeDe(panne)}) — dernière sauvegarde puis arrêt du processus (code ${reglage.codeArret})`, 'E-SERV-008');
          sauvegarder();
          try { o.arreter(reglage.codeArret); } catch (e) { /* rien de plus à faire */ }
          return;
        }
        const resume = resumeDe(panne);
        if (courante && courante.libelle === libelle && courante.resume === resume) {
          courante.repetitions++;
          if (t - courante.debut >= reglage.regroupementMs) compte(t);
        } else {
          compte(t);
          courante = { libelle, resume, debut: t, repetitions: 0 };
          ecrireBorne(`${libelle} : ${texteDe(panne)}`, 1, resume);
        }
        if (opts && opts.sauvegarde && (derniereSauvegarde === null || t - derniereSauvegarde >= reglage.sauvegardeMs)) {
          derniereSauvegarde = t;
          sauvegarder();
        }
      } finally { enCours = false; }
    }
    return { signaler, etat: () => Object.assign({}, etat), reglage };
  }

  MC.ServeurJournal = { installer: installer, gardienPannes: gardienPannes, GARDIEN: GARDIEN };
})(typeof globalThis !== 'undefined' ? globalThis : this);
