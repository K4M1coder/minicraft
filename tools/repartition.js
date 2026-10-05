/* tools/repartition.js — « Répartition » de la vue filtrée de l'historique
   global (SPEC-BANC-064, docs/banc/historique-global.md §3.5) : pour une
   dimension (catégorie, domaine, spec, fonction, étiquette — et raison, qui
   compte les états `ignore` et `avertissement` par motif, SPEC-BANC-089),
   un tableau {valeur → nombre de tests, réussis, échecs, ignorés,
   avertissements, durée cumulée}.

   Module PUR (aucune lecture disque) : il reçoit les lignes déjà filtrées
   par tools/historique.js (`filtrerLignes`), une ligne étant un test dans un
   run. Une dimension-liste (domaine, spec, fonction, étiquette) compte un
   test dans CHACUNE de ses valeurs, comme les effectifs du filtre
   (SPEC-BANC-063) ; un test sans valeur tombe dans la ligne `valeur: null`
   (« (aucune) »), qu'on ne peut pas filtrer. */
'use strict';

/* dimension → colonne de l'historique. Une propriété héritée
   (« constructor », « __proto__ ») n'est jamais une dimension. */
const DIMENSIONS = {
  categorie: { champ: 'type', liste: false, libelle: 'Catégorie' },
  domaine: { champ: 'domaines', liste: true, libelle: 'Domaine' },
  spec: { champ: 'specs', liste: true, libelle: 'Spec' },
  fonction: { champ: 'fonctions', liste: true, libelle: 'Fonction' },
  etiquette: { champ: 'etiquettes', liste: true, libelle: 'Étiquette' },
  raison: { champ: 'raison', liste: false, libelle: 'Raison' },
};
function estDimension(d) { return typeof d === 'string' && Object.prototype.hasOwnProperty.call(DIMENSIONS, d); }

/* Les quatre états d'un test dans le registre ; tout autre état (`delai`,
   `ok` d'un vieux cahier) est ramené à l'un d'eux. */
function classeEtat(etat) {
  if (etat === 'reussi' || etat === 'ok') return 'reussi';
  if (etat === 'ignore') return 'ignore';
  if (etat === 'avertissement') return 'avertissement';
  return 'echec';
}

function repartition(lignes, dimension) {
  if (!estDimension(dimension)) throw new Error('dimension inconnue : ' + String(dimension));
  const d = DIMENSIONS[dimension];
  const groupes = new Map();
  let total = 0;
  (Array.isArray(lignes) ? lignes : []).forEach((l) => {
    if (!l || typeof l !== 'object') return;
    total++;
    let valeurs = d.liste ? (Array.isArray(l[d.champ]) ? l[d.champ] : []) : [l[d.champ]];
    valeurs = valeurs.filter(v => v !== undefined && v !== '');
    if (!valeurs.length) valeurs = [null];
    const classe = classeEtat(l.etat);
    const duree = typeof l.duree_ms === 'number' && isFinite(l.duree_ms) ? l.duree_ms : 0;
    // une même valeur répétée dans une liste ne compte le test qu'une fois
    Array.from(new Set(valeurs.map(v => (v === null ? null : String(v))))).forEach((v) => {
      let g = groupes.get(v);
      if (!g) { g = { valeur: v, nb: 0, reussi: 0, echec: 0, ignore: 0, avertissement: 0, duree_ms: 0 }; groupes.set(v, g); }
      g.nb++; g[classe]++; g.duree_ms += duree;
    });
  });
  const liste = Array.from(groupes.values()).sort((a, b) => {
    if (a.valeur === null) return 1;      // « (aucune) » toujours en dernier
    if (b.valeur === null) return -1;
    return b.nb - a.nb || String(a.valeur).localeCompare(String(b.valeur));
  });
  return { dimension, champ: d.champ, libelle: d.libelle, groupes: liste, total };
}

module.exports = { DIMENSIONS, estDimension, classeEtat, repartition };
