/* console-directe.js — détection des appels `console.*` directs (porte G16,
   SPEC-BANC-110). Tout message de src/ et de server.js passe par MC.Journal
   (src/journal.js), seul fichier autorisé à toucher la console.

   Un « appel direct » : `console.log(`, `console . warn (`, `console['error'](`…
   Les commentaires sont retirés avant la recherche (un en-tête peut parler de
   console.log) ; passer l'objet `console` sans l'appeler (contexte vm du
   serveur) n'en est pas un.

   Usage : require('./tools/console-directe.js').verifier(racine) → liste de
   fautes « fichier:ligne → extrait », vide quand tout passe par le journal. */
'use strict';
const fs = require('fs');
const path = require('path');

const AUTORISE = 'src/journal.js';
const RE_APPEL = /\bconsole\s*(?:\.\s*[A-Za-z_$][\w$]*|\[\s*['"`][^'"`]+['"`]\s*\])\s*\(/;

/* Retire commentaires de bloc et de ligne en gardant la numérotation. Les
   chaînes ne sont pas analysées : un `//` dans une chaîne coupe la fin de
   la ligne, ce qui ne peut que faire MANQUER un appel situé après, sur la
   même ligne qu'une URL — cas absent du dépôt, et sans faux positif. */
function sansCommentaires(txt) {
  return txt
    .replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' '))
    .split('\n').map(l => l.replace(/(^|[^:'"\\])\/\/.*$/, '$1')).join('\n');
}

/* Appels directs d'un texte source : [{ ligne, extrait }]. */
function appelsConsole(texte) {
  const out = [];
  sansCommentaires(String(texte)).split('\n').forEach((code, i) => {
    if (RE_APPEL.test(code)) out.push({ ligne: i + 1, extrait: code.trim().slice(0, 120) });
  });
  return out;
}

/* Fichiers soumis à la règle : src/*.js (hors src/journal.js) et server.js. */
function fichiersSurveilles(racine) {
  const src = fs.readdirSync(path.join(racine, 'src')).filter(f => f.endsWith('.js')).map(f => 'src/' + f);
  return src.filter(f => f !== AUTORISE).concat(fs.existsSync(path.join(racine, 'server.js')) ? ['server.js'] : []);
}

function verifier(racine) {
  const fautes = [];
  fichiersSurveilles(racine).forEach((f) => {
    appelsConsole(fs.readFileSync(path.join(racine, f), 'utf8'))
      .forEach(a => fautes.push(f + ':' + a.ligne + ' → ' + a.extrait));
  });
  return fautes;
}

module.exports = { AUTORISE, appelsConsole, fichiersSurveilles, verifier };
