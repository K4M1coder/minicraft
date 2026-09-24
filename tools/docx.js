/* tools/docx.js — rendu d'un MODÈLE de cahier de test (tests/rapport.js,
   `MC_RAPPORT.modele()`) en document Word (.docx) réel, SANS dépendance
   npm : une archive ZIP (tools/zip.js) contenant du WordprocessingML écrit
   à la main (SPEC-BANC-021). Minimal mais valide : Word (et n'importe quel
   lecteur .docx) l'ouvre, sa structure (document.xml, styles.xml, médias,
   relations) est celle attendue par le format.

   API : `construireDocx(modele)` → Buffer (l'archive .docx complète).
   Le modèle est la MÊME structure que celle que consomme
   MC_RAPPORT.html(modele) (SPEC-BANC-022) : titre, blocs (titre, paragraphe,
   liste, tableau, image, saut_page, sommaire). Les blocs image portent soit
   `donnees` (Buffer, les octets réels — c'est ce que ce module utilise pour
   les insérer), soit seulement `fichier`/`legende` (alors la légende
   apparaît sans l'image, plutôt que d'échouer). */
'use strict';
const { creerZip } = require('./zip.js');

function echapperXML(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const COULEUR_ETAT = { ok: 'C6EFCE', echec: 'FFC7CE', delai: 'FFEB9C', ignore: 'E0E0E0' };

// ── word/styles.xml : minimal, mais déclare les styles que document.xml cite ─
function stylesXML() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
    ['Heading1', 'Heading2', 'Heading3', 'Heading4'].map((id, i) =>
      '<w:style w:type="paragraph" w:styleId="' + id + '"><w:name w:val="heading ' + (i + 1) + '"/>' +
      '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="' + i + '"/></w:pPr>' +
      '<w:rPr><w:b/><w:sz w:val="' + (32 - i * 4) + '"/></w:rPr></w:style>').join('') +
    '</w:styles>';
}

function paragrapheXML(texte, styleId) {
  const pPr = styleId ? '<w:pPr><w:pStyle w:val="' + styleId + '"/></w:pPr>' : '';
  const rPr = styleId ? '<w:rPr><w:b/></w:rPr>' : '';
  return '<w:p>' + pPr + '<w:r>' + rPr + '<w:t xml:space="preserve">' + echapperXML(texte) + '</w:t></w:r></w:p>';
}

function celluleXML(texte, etat) {
  const shd = etat && COULEUR_ETAT[etat] ? '<w:shd w:val="clear" w:fill="' + COULEUR_ETAT[etat] + '"/>' : '';
  return '<w:tc><w:tcPr>' + shd + '</w:tcPr><w:p><w:r><w:t xml:space="preserve">' + echapperXML(texte) + '</w:t></w:r></w:p></w:tc>';
}

function tableauXML(bloc) {
  const entetes = '<w:tr>' + bloc.entetes.map(h => '<w:tc><w:tcPr><w:shd w:val="clear" w:fill="D9D9D9"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">' + echapperXML(h) + '</w:t></w:r></w:p></w:tc>').join('') + '</w:tr>';
  const lignes = (bloc.lignes || []).map(l => {
    const cellules = Array.isArray(l) ? l : l.cellules;
    const etat = Array.isArray(l) ? null : l.etat;
    return '<w:tr>' + cellules.map(c => celluleXML(c, etat)).join('') + '</w:tr>';
  }).join('');
  return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>' + entetes + lignes + '</w:tbl>';
}

// EMU (English Metric Units) : 914400 par pouce, on affiche à une taille fixe
// raisonnable (les captures réelles varient en résolution, pas en importance)
const LARGEUR_EMU = 3200400;  // ~3,5 pouces
const HAUTEUR_EMU = 2133600;  // ~2,33 pouces (rapport 3:2)

function imageXML(rId, legendeTexte) {
  const drawing = '<w:p><w:r><w:drawing>' +
    '<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
    '<wp:extent cx="' + LARGEUR_EMU + '" cy="' + HAUTEUR_EMU + '"/>' +
    '<wp:docPr id="' + rId + '" name="capture' + rId + '"/>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:nvPicPr><pic:cNvPr id="0" name="capture"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rId' + rId + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>' +
    '<a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + LARGEUR_EMU + '" cy="' + HAUTEUR_EMU + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  return drawing + (legendeTexte ? paragrapheXML(legendeTexte) : '');
}

const EXT_MIME = { 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'webp': 'image/webp' };

function construireDocx(modele) {
  const images = [];       // { ext, donnees }
  const relations = [];    // { id, target }
  let corps = '';
  let prochainRId = 2;      // rId1 réservé aux styles

  (modele.blocs || []).forEach((b) => {
    if (b.type === 'titre') corps += paragrapheXML(b.texte, 'Heading' + Math.min(4, Math.max(1, b.niveau || 1)));
    else if (b.type === 'paragraphe') corps += paragrapheXML(b.texte);
    else if (b.type === 'liste') corps += (b.items || []).map(i => paragrapheXML('• ' + i)).join('');
    else if (b.type === 'tableau') corps += tableauXML(b);
    else if (b.type === 'saut_page') corps += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    else if (b.type === 'sommaire') corps += paragrapheXML('Sommaire', 'Heading2') + (b.entrees || []).map(e => paragrapheXML(e.texte)).join('');
    else if (b.type === 'image') {
      if (b.donnees && b.donnees.length) {
        const ext = (b.mime && EXT_MIME[b.mime]) ? b.mime : (/\.(\w+)$/.exec(b.fichier || '') || [, 'jpg'])[1].toLowerCase();
        const rId = prochainRId++;
        images.push({ rId, ext: EXT_MIME[ext] ? ext : 'jpg', donnees: b.donnees });
        relations.push({ id: rId, target: 'media/image' + rId + '.' + (EXT_MIME[ext] ? ext : 'jpg') });
        corps += imageXML(rId, b.legende);
      } else if (b.legende || b.fichier) {
        corps += paragrapheXML('[capture : ' + (b.legende || b.fichier) + ']');
      }
    }
  });

  const documentXML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:body>' + corps + '<w:sectPr/></w:body></w:document>';

  const contentTypesXML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    Array.from(new Set(images.map(i => i.ext))).map(ext =>
      '<Default Extension="' + ext + '" ContentType="' + (EXT_MIME[ext] || 'image/jpeg') + '"/>').join('') +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '</Types>';

  const rootRelsXML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  const docRelsXML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    relations.map(r => '<Relationship Id="rId' + r.id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + r.target + '"/>').join('') +
    '</Relationships>';

  const entrees = [
    { nom: '[Content_Types].xml', contenu: contentTypesXML },
    { nom: '_rels/.rels', contenu: rootRelsXML },
    { nom: 'word/document.xml', contenu: documentXML },
    { nom: 'word/styles.xml', contenu: stylesXML() },
    { nom: 'word/_rels/document.xml.rels', contenu: docRelsXML },
  ];
  images.forEach(i => entrees.push({ nom: 'word/media/image' + i.rId + '.' + i.ext, contenu: i.donnees }));

  return creerZip(entrees);
}

module.exports = { construireDocx, echapperXML };
