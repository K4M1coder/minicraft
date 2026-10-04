/* journal-temp.js — les serveurs lancés par les tests écrivent leur journal
   (SPEC-BANC-106, `serveur-<date>.log`) dans un dossier TEMPORAIRE, jamais
   dans logs/ du dépôt : requis en tête de chaque script qui lance server.js
   (les processus enfants héritent de process.env). Un MC_JOURNAL_DOSSIER déjà
   posé (par tests/run.js ou par le test lui-même) est respecté. Le serveur y
   borne lui-même la place (un fichier par jour, 14 gardés, plafond quotidien). */
'use strict';
const os = require('os');
const path = require('path');
if (!process.env.MC_JOURNAL_DOSSIER) process.env.MC_JOURNAL_DOSSIER = path.join(os.tmpdir(), 'mc-journal-tests');
module.exports = process.env.MC_JOURNAL_DOSSIER;
