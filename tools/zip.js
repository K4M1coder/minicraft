/* tools/zip.js — écriture d'archives ZIP « stored » (sans compression), à la
   main, sans dépendance npm (SPEC-BANC-021). Suffisant et voulu : un .docx
   est une archive ZIP contenant du XML et quelques images ; « stored » évite
   d'écrire un compresseur DEFLATE complet pour un fichier qui reste petit.
   CRC32 est calculé par table, la méthode standard, pas une approximation.

   API : `creerZip(entrees)` — `entrees` : [{ nom, contenu: Buffer|string }]
   → Buffer de l'archive complète (en-têtes locaux + central + fin). Le nom
   utilise toujours `/` (format ZIP), jamais de chemin absolu ni `..`. */
'use strict';

// ── CRC32 (table standard, polynôme 0xEDB88320) ─────────────────────────────
const TABLE_CRC32 = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = TABLE_CRC32[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// date/heure au format DOS (ZIP) — une valeur fixe suffit, le contenu ne dépend pas de la date
const DOS_DATE = 0x21; // 1980-01-01 environ, peu importe : jamais affiché
const DOS_TIME = 0x00;

function nettoyerNom(nom) {
  const n = String(nom).replace(/\\/g, '/').replace(/^\/+/, '');
  if (n.indexOf('..') >= 0) throw new Error('nom d\'entrée ZIP invalide (traversée) : ' + nom);
  return n;
}

function creerZip(entrees) {
  const locaux = [];
  const centraux = [];
  let offset = 0;

  entrees.forEach((e) => {
    const nom = nettoyerNom(e.nom);
    const nomBuf = Buffer.from(nom, 'utf8');
    const data = Buffer.isBuffer(e.contenu) ? e.contenu : Buffer.from(String(e.contenu), 'utf8');
    const crc = crc32(data);

    const enteteLocal = Buffer.alloc(30);
    enteteLocal.writeUInt32LE(0x04034b50, 0);   // signature en-tête local
    enteteLocal.writeUInt16LE(20, 4);           // version nécessaire
    enteteLocal.writeUInt16LE(0, 6);            // drapeaux
    enteteLocal.writeUInt16LE(0, 8);            // méthode : 0 = stored
    enteteLocal.writeUInt16LE(DOS_TIME, 10);
    enteteLocal.writeUInt16LE(DOS_DATE, 12);
    enteteLocal.writeUInt32LE(crc, 14);
    enteteLocal.writeUInt32LE(data.length, 18); // taille compressée = taille réelle (stored)
    enteteLocal.writeUInt32LE(data.length, 22);
    enteteLocal.writeUInt16LE(nomBuf.length, 26);
    enteteLocal.writeUInt16LE(0, 28);           // pas de champ « extra »

    locaux.push(enteteLocal, nomBuf, data);

    const enteteCentral = Buffer.alloc(46);
    enteteCentral.writeUInt32LE(0x02014b50, 0); // signature centrale
    enteteCentral.writeUInt16LE(20, 4);         // version « faite par »
    enteteCentral.writeUInt16LE(20, 6);         // version nécessaire
    enteteCentral.writeUInt16LE(0, 8);
    enteteCentral.writeUInt16LE(0, 10);
    enteteCentral.writeUInt16LE(DOS_TIME, 12);
    enteteCentral.writeUInt16LE(DOS_DATE, 14);
    enteteCentral.writeUInt32LE(crc, 16);
    enteteCentral.writeUInt32LE(data.length, 20);
    enteteCentral.writeUInt32LE(data.length, 24);
    enteteCentral.writeUInt16LE(nomBuf.length, 28);
    enteteCentral.writeUInt16LE(0, 30);         // extra
    enteteCentral.writeUInt16LE(0, 32);         // commentaire
    enteteCentral.writeUInt16LE(0, 34);         // disque de départ
    enteteCentral.writeUInt16LE(0, 36);         // attributs internes
    enteteCentral.writeUInt32LE(0, 38);         // attributs externes
    enteteCentral.writeUInt32LE(offset, 42);    // offset de l'en-tête local

    centraux.push(enteteCentral, nomBuf);

    offset += enteteLocal.length + nomBuf.length + data.length;
  });

  const centralBuf = Buffer.concat(centraux);
  const finCentral = Buffer.alloc(22);
  finCentral.writeUInt32LE(0x06054b50, 0);
  finCentral.writeUInt16LE(0, 4);
  finCentral.writeUInt16LE(0, 6);
  finCentral.writeUInt16LE(entrees.length, 8);
  finCentral.writeUInt16LE(entrees.length, 10);
  finCentral.writeUInt32LE(centralBuf.length, 12);
  finCentral.writeUInt32LE(offset, 16);
  finCentral.writeUInt16LE(0, 20);

  return Buffer.concat([...locaux, centralBuf, finCentral]);
}

/* Relecture minimale (SANS dépendance) : suffisante pour que les tests
   vérifient qu'une archive écrite par creerZip() est valide — pas un lecteur
   ZIP général (il suppose « stored », ce que creerZip() produit toujours). */
function lireZip(buf) {
  const finSig = 0x06054b50;
  let i = buf.length - 22;
  while (i >= 0 && buf.readUInt32LE(i) !== finSig) i--;
  if (i < 0) throw new Error('signature de fin d\'archive centrale introuvable');
  const nbEntrees = buf.readUInt16LE(i + 10);
  const offsetCentral = buf.readUInt32LE(i + 16);
  const entrees = [];
  let p = offsetCentral;
  for (let k = 0; k < nbEntrees; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('en-tête central invalide à ' + p);
    const tailleCompressee = buf.readUInt32LE(p + 20);
    const longueurNom = buf.readUInt16LE(p + 28);
    const longueurExtra = buf.readUInt16LE(p + 30);
    const longueurCommentaire = buf.readUInt16LE(p + 32);
    const offsetLocal = buf.readUInt32LE(p + 42);
    const nom = buf.toString('utf8', p + 46, p + 46 + longueurNom);
    // l'en-tête local a la même forme (30 octets) + nom + extra local avant les données
    const nomLenLocal = buf.readUInt16LE(offsetLocal + 26);
    const extraLenLocal = buf.readUInt16LE(offsetLocal + 28);
    const debutDonnees = offsetLocal + 30 + nomLenLocal + extraLenLocal;
    const contenu = buf.slice(debutDonnees, debutDonnees + tailleCompressee);
    entrees.push({ nom, contenu });
    p += 46 + longueurNom + longueurExtra + longueurCommentaire;
  }
  return entrees;
}

module.exports = { creerZip, lireZip, crc32 };
