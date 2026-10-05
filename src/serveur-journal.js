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
        nom: 'fichier', seuil: 'info',
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

  MC.ServeurJournal = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
