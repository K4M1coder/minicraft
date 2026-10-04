/* format-ids.js — le format d'identifiants du jeu (`MC.Core.FIRST_ITEM`) pour
   les scripts de test Node qui parlent au serveur sans charger les modules
   du jeu : REJOINDRE doit l'annoncer (SPEC-SAVE-025). Lu dans src/core.js
   lui-même (vm), jamais recopié en dur. Ce fichier n'est PAS un test. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({ Math, Object, Array, String, Number, JSON, Error });
ctx.globalThis = ctx;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'core.js'), 'utf8'), ctx);

module.exports = { FIRST_ITEM: ctx.MC.Core.FIRST_ITEM };
