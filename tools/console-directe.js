/* console-directe.js — détection des sorties directes vers la console (porte
   G16, SPEC-BANC-110). Tout message de src/ et de server.js passe par
   MC.Journal (src/journal.js), seul fichier autorisé à toucher la console.

   Est une faute, dans le CODE (chaînes, gabarits hors `${…}`, expressions
   régulières et commentaires sont d'abord effacés par un petit analyseur
   lexical, en gardant la numérotation des lignes) :
     - tout accès à un membre de `console` : `console.log(`, `console?.warn`,
       `console['error']`, `console.log.call(…)`, `.apply`, `.bind` ;
     - `console` utilisé comme valeur : `const c = console`, `{ log } = console`,
       `f(console)`, `{ c: console }` — sauf la forme abrégée d'un objet
       littéral `{ console, Math }` (contexte vm du serveur : c'est ainsi que
       le journal du serveur reçoit la console) ;
     - `process.stdout.write` / `process.stderr.write`.
   `x.console`, `maconsole`, `consoleLog` ne sont pas la console globale.

   Usage : require('./tools/console-directe.js').verifier(racine) → liste de
   fautes « fichier:ligne → extrait », vide quand tout passe par le journal. */
'use strict';
const fs = require('fs');
const path = require('path');

const AUTORISE = 'src/journal.js';

/* Un `/` ouvre une expression régulière (et non une division) quand le
   dernier élément significatif du code n'est ni un identifiant, ni un
   nombre, ni `)` `]` `}` — sauf mot-clé qui précède une expression. */
const MOTS_AVANT_EXPRESSION = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

/* Rend le texte où chaînes, gabarits (hors `${…}`), regex et commentaires
   sont remplacés par des espaces (sauts de ligne gardés). */
function codeSeul(txt) {
  const s = String(txt);
  const out = s.split('');
  const blanc = (i) => { if (out[i] !== '\n') out[i] = ' '; };
  let i = 0;
  const pileGabarits = [];          // profondeur d'accolades au moment d'entrer dans chaque `${`
  let accolades = 0;
  let dernier = '';                 // dernier jeton significatif (pour regex / division)
  while (i < s.length) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && d === '/') { while (i < s.length && s[i] !== '\n') blanc(i++); continue; }
    if (c === '/' && d === '*') { blanc(i++); blanc(i++); while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) blanc(i++); if (i < s.length) { blanc(i++); blanc(i++); } continue; }
    if (c === '"' || c === "'") {
      i++;
      while (i < s.length && s[i] !== c && s[i] !== '\n') { if (s[i] === '\\') blanc(i++); blanc(i++); }
      i++; dernier = 'v'; continue;
    }
    if (c === '`' || (c === '}' && pileGabarits.length && pileGabarits[pileGabarits.length - 1] === accolades)) {
      if (c === '}') pileGabarits.pop();
      i++;
      while (i < s.length && s[i] !== '`') {
        if (s[i] === '\\') { blanc(i++); blanc(i++); continue; }
        if (s[i] === '$' && s[i + 1] === '{') { pileGabarits.push(accolades); i += 2; break; }
        blanc(i++);
      }
      if (s[i] === '`') { i++; dernier = 'v'; }
      else dernier = '(';
      continue;
    }
    if (c === '/') {
      const estRegex = !dernier || /[(,=:[!&|?{};+\-*%<>~^]/.test(dernier) || MOTS_AVANT_EXPRESSION.has(dernier);
      if (estRegex) {
        i++;
        let classe = false;
        while (i < s.length && s[i] !== '\n') {
          if (s[i] === '\\') { blanc(i++); blanc(i++); continue; }
          if (s[i] === '[') classe = true; else if (s[i] === ']') classe = false;
          else if (s[i] === '/' && !classe) break;
          blanc(i++);
        }
        i++;
        while (i < s.length && /[a-z]/.test(s[i])) i++;
        dernier = 'v'; continue;
      }
      dernier = '/'; i++; continue;
    }
    if (c === '{') accolades++;
    else if (c === '}') accolades--;
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < s.length && /[\w$]/.test(s[j])) j++;
      dernier = s.slice(i, j); i = j; continue;
    }
    if (/[0-9]/.test(c)) { while (i < s.length && /[\w.]/.test(s[i])) i++; dernier = 'v'; continue; }
    if (!/\s/.test(c)) dernier = c;
    i++;
  }
  return out.join('');
}

const RE_CONSOLE = /(^|[^\w$.])console(?![\w$])/g;
const RE_FLUX = /(^|[^\w$.])process\s*\.\s*(stdout|stderr)\s*\.\s*write\b/g;

/* Index (dans le code effacé, texte ENTIER : un objet littéral peut tenir
   sur plusieurs lignes) de chaque faute. */
function indexFautes(code) {
  const out = [];
  let m;
  RE_FLUX.lastIndex = 0;
  while ((m = RE_FLUX.exec(code))) out.push(m.index + m[1].length);
  RE_CONSOLE.lastIndex = 0;
  while ((m = RE_CONSOLE.exec(code))) {
    const debut = m.index + m[1].length;
    const apres = code.slice(debut + 'console'.length).replace(/^\s+/, '');
    const avant = code.slice(0, debut).replace(/\s+$/, '');
    if (/^(\.|\?\.|\[)/.test(apres)) { out.push(debut); continue; }        // accès à un membre
    const objet = /[{,]$/.test(avant);
    if (objet && /^[,}]/.test(apres)) continue;                            // { console, Math } : forme abrégée
    if (objet && /^:(?!:)/.test(apres)) continue;                          // { console: … } : simple clé
    out.push(debut);                                                       // console comme valeur
  }
  return out;
}

/* Appels directs d'un texte source : [{ ligne, extrait }], une par ligne. */
function appelsConsole(texte) {
  const brut = String(texte).split('\n');
  const code = codeSeul(texte);
  const lignes = new Set(indexFautes(code).map(i => code.slice(0, i).split('\n').length));
  return Array.from(lignes).sort((a, b) => a - b).map(l => ({ ligne: l, extrait: (brut[l - 1] || '').trim().slice(0, 120) }));
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

module.exports = { AUTORISE, codeSeul, appelsConsole, fichiersSurveilles, verifier };
