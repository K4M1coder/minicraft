/* integration-livres.js — SPEC-INTERIEUR-003 (L24) sur de vrais processus
   server.js : livres et notes, le SERVEUR fait foi.
   - écrire : LIVRE_ECRIRE validé (taille bornée, caractères de contrôle
     retirés), appliqué à la pile de l'inventaire SERVEUR et renvoyé par
     INV_MAJ ; un message hors bornes est rejeté entier ; une pile qui n'est
     pas un livre est refusée ;
   - signer : l'auteur est le nom que le serveur connaît, jamais un champ du
     message ; un livre signé ne s'écrit plus ;
   - anti-flood : une rafale d'écritures est écrêtée au budget du contrat ;
   - ranger : le livre passe dans un coffre posé (CONTENEUR_TRANSFERT) avec
     son contenu ; jeté (INV_LACHER), l'objet au sol le porte encore ;
   - relance : arrêt puis relance du serveur sur le même fichier de monde —
     le livre de l'inventaire et celui du coffre sont intacts ;
   - lire : une bibliothèque générée d'un lieu tient à sa première ouverture
     la légende du lieu, sa chronique et le carnet d'explorateur qui situe
     les donjons des environs (indices des quêtes).
   Chaque scénario lance ET arrête son serveur (port 0). Usage :
   node tests/integration-livres.js */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre } = A;
const R = A.creerRapport('Intégration INTERIEUR — livres et notes écrits, signés et rangés par le serveur (L24)');
const { ok, eq } = R;

const MC = A.chargerModules();
const C = MC.Core, B = C.B, I = C.I, CA = A.CA;
const GRAINE = 20260921;
const serveurs = [];
async function demarrer(args, env) {
  const s = await lancer(['--port', '0'].concat(args || []), env);
  serveurs.push(s);
  return s;
}
async function jusqua(lire, ms, pas) {
  const fin = Date.now() + (ms || 5000);
  for (;;) {
    const v = lire();
    if (v) return v;
    if (Date.now() > fin) return null;
    await dodo(pas || 40);
  }
}
const pile = (c) => (c && c !== 0) ? { id: c[0], n: c[1], data: c[3] } : null;
const indexDe = (inv, id) => inv.findIndex(c => { const p = pile(c); return p && p.id === id; });
function fichierMonde(dossier) {
  const f = path.join(dossier, 'monde.json');
  fs.writeFileSync(f, JSON.stringify({ v: 2, graine: GRAINE, heure: 60, overrides: [], etats: [], crops: [] }));
  return f;
}
const args = (f, d) => ['--monde', f, '--dossier-parties', d];
async function invMaj(cl, seq, ms) { return cl.attendre('inv_maj', ms || 3000, m => m.ack === seq); }

// ── écrire, signer, anti-flood, ranger, jeter, relancer ─────────────────────
async function scenarioEcriture() {
  const d = A.dossierTemp('mc-livres-');
  try {
    const f = fichierMonde(d);
    const env = { MC_TEST_INV: JSON.stringify([[I.LIVRE, 1], [I.NOTE, 1], [I.LIVRE, 1], [B.CHEST, 1], [B.STONE, 4]]) };
    let s = await demarrer(args(f, d), env);
    let { client: cl, bienvenue } = await rejoindre(s.port, 'Aldric', 1);
    const inv0 = (await cl.attendre('inv_maj', 4000)).inv;
    const iL = indexDe(inv0, I.LIVRE), iN = indexDe(inv0, I.NOTE), iS = indexDe(inv0, B.STONE);
    ok(iL >= 0 && iN >= 0, 'préparation : le livre et la note sont dans l\'inventaire du serveur');
    let seq = 0;

    // écrire : bornes et nettoyage appliqués par le serveur
    const NUL = String.fromCharCode(0), BEL = String.fromCharCode(7), RLO = String.fromCharCode(0x202e);
    cl.envoyer({ t: 'livre_ecrire', j: 0, seq: ++seq, i: iL, titre: 'Mes mémoires' + BEL, pages: ['Jour 1' + NUL + ' : il pleut' + RLO, 'Jour 2\r\nsoleil'] });
    let m = await invMaj(cl, seq);
    let p = pile(m.inv[iL]);
    ok(p && p.data && p.data.titre === 'Mes mémoires', 'SPEC-INTERIEUR-003 : le titre écrit est sur la pile du SERVEUR, nettoyé (' + JSON.stringify(p && p.data) + ')');
    ok(p && JSON.stringify(p.data.pages) === JSON.stringify(['Jour 1 : il pleut', 'Jour 2\nsoleil']), 'SPEC-INTERIEUR-003 : les pages sont nettoyées des caractères de contrôle (sauts de ligne gardés)');
    ok(p && !p.data.signe, 'SPEC-INTERIEUR-003 : pas encore signé');

    // la note : une seule page, page bornée
    cl.envoyer({ t: 'livre_ecrire', j: 0, seq: ++seq, i: iN, titre: '', pages: ['x'.repeat(400), 'seconde'] });
    m = await invMaj(cl, seq);
    p = pile(m.inv[iN]);
    ok(p && p.data.pages.length === 1 && p.data.pages[0].length === MC.Livres.MAX_LONGUEUR_PAGE, 'SPEC-INTERIEUR-003 : une note garde une seule page, bornée à ' + MC.Livres.MAX_LONGUEUR_PAGE + ' caractères');

    // hors bornes brutes : rejeté entier (aucun INV_MAJ pour ce seq, la pile ne change pas)
    const vuHors = cl.depuis();
    cl.envoyer({ t: 'livre_ecrire', j: 0, seq: ++seq, i: iL, titre: 'Trop', pages: new Array(CA.LIVRE_BRUT.PAGES_MAX + 1).fill('p') });
    cl.envoyer({ t: 'livre_ecrire', j: 0, seq: ++seq, i: iL, titre: 'Trop', pages: ['x'.repeat(CA.LIVRE_BRUT.PAGE_MAX + 1)] });
    await dodo(600);
    ok(!vuHors('inv_maj').some(x => x.ack >= seq - 1), 'SPEC-INTERIEUR-003 : un LIVRE_ECRIRE hors bornes (trop de pages, page trop longue) est rejeté sans effet');
    // une pierre ne s'écrit pas (refus d'opération)
    cl.envoyer({ t: 'livre_ecrire', j: 0, seq: ++seq, i: iS, titre: 'Pierre', pages: ['?'] });
    m = await invMaj(cl, seq);
    ok(m.refus && m.refus.some(r => r.seq === seq && r.motif === 'incompatible'), 'SPEC-INTERIEUR-003 : écrire sur une pile qui n\'est ni livre ni note est refusé (incompatible)');

    // (le budget anti-flood est de 4 écritures par seconde et par joueur local : on laisse passer la fenêtre)
    await dodo(1100);
    // signer : l'auteur est le nom tenu par le serveur, jamais celui du message
    cl.envoyer({ t: 'livre_ecrire', j: 0, seq: ++seq, i: iL, titre: 'Mes mémoires', pages: ['Jour 1 : il pleut', 'Jour 2\nsoleil', 'Fin.'], signer: true, auteur: 'Usurpateur' });
    m = await invMaj(cl, seq);
    p = pile(m.inv[iL]);
    ok(p && p.data.signe === true && p.data.auteur === 'Aldric', 'SPEC-INTERIEUR-003 : signé, au nom que le serveur connaît (« ' + (p && p.data.auteur) + ' »)');
    eq(p && p.data.pages.length, 3, 'SPEC-INTERIEUR-003 : la dernière page écrite avant la signature est gardée');
    const signe = p && p.data;
    await dodo(1100);
    cl.envoyer({ t: 'livre_ecrire', j: 0, seq: ++seq, i: iL, titre: 'Retouche', pages: ['effacé'] });
    m = await invMaj(cl, seq);
    ok(m.refus && m.refus.some(r => r.seq === seq && r.motif === 'interdit') && JSON.stringify(pile(m.inv[iL]).data) === JSON.stringify(signe),
       'SPEC-INTERIEUR-003 : un livre signé ne s\'écrit plus (refus, contenu intact)');

    // anti-flood : 30 écritures d'un coup sur le second livre — au plus le budget (par seconde) passe
    const iL2 = inv0.findIndex((c, k) => k !== iL && pile(c) && pile(c).id === I.LIVRE);
    const vuFlood = cl.depuis(), seq0 = seq;
    for (let k = 0; k < 30; k++) cl.envoyer({ t: 'livre_ecrire', j: 0, seq: ++seq, i: iL2, titre: 'R' + k, pages: ['r'] });
    await dodo(900);
    const acquittes = vuFlood('inv_maj').filter(x => x.ack > seq0).length;
    ok(acquittes > 0 && acquittes <= CA.BUDGETS_FLOOD.livre_ecrire + 1, 'SPEC-INTERIEUR-003 : une rafale de 30 écritures est écrêtée par l\'anti-flood (' + acquittes + ' traitées, budget ' + CA.BUDGETS_FLOOD.livre_ecrire + '/s)');
    await dodo(1100);   // fenêtre anti-flood écoulée

    // ranger : un coffre posé reçoit le livre signé, contenu compris
    const t0 = bienvenue.toi[0];
    const pc = { x: Math.floor(t0.x) + 1, y: Math.floor(t0.y) + 3, z: Math.floor(t0.z) };
    cl.envoyer({ t: 'bloc', x: pc.x, y: pc.y, z: pc.z, id: B.CHEST, j: 0, i: indexDe(m.inv, B.CHEST) });
    await cl.attendre('bloc', 3000, b => b.x === pc.x && b.y === pc.y && b.z === pc.z && b.id === B.CHEST);
    const cle = pc.x + ',' + pc.y + ',' + pc.z;
    cl.envoyer({ t: 'cont_ouvrir', j: 0, x: pc.x, y: pc.y, z: pc.z });
    await cl.attendre('cont_etat', 3000, x => x.cle === cle);
    cl.envoyer({ t: 'cont_transfert', j: 0, seq: ++seq, de: { z: 'inv', i: iL }, vers: { z: 'cont', cle, i: 0 }, n: 1 });
    m = await invMaj(cl, seq);
    const delta = (m.conteneurs || []).find(x => x.cle === cle);
    const rangee = delta && delta.maj && delta.maj.find(e => e[0] === 0);
    ok(!pile(m.inv[iL]) && rangee && JSON.stringify(rangee[1][3]) === JSON.stringify(signe), 'SPEC-INTERIEUR-003 : rangé dans un coffre, le livre garde son contenu et sa signature');
    cl.envoyer({ t: 'cont_fermer', j: 0, cle });

    // jeter la note : l'objet au sol porte son texte
    const noteAvant = pile(m.inv[iN]).data;
    cl.envoyer({ t: 'inv_lacher', j: 0, seq: ++seq, i: iN, n: 1 });
    m = await invMaj(cl, seq);
    ok(!pile(m.inv[iN]), 'préparation : la note est jetée');
    ok(!!noteAvant && noteAvant.pages[0].length > 0, 'SPEC-INTERIEUR-003 : la note jetée portait son texte (relu après relance, ci-dessous)');

    // relance : même fichier de monde
    cl.fermer();
    await dodo(300);
    await s.arreter();
    s = await demarrer(args(f, d), env);
    ({ client: cl } = await rejoindre(s.port, 'Aldric', 1));
    const inv1 = (await cl.attendre('inv_maj', 4000)).inv;
    cl.envoyer({ t: 'cont_ouvrir', j: 0, x: pc.x, y: pc.y, z: pc.z });
    const etat = await cl.attendre('cont_etat', 4000, x => x.cle === cle).catch(() => null);
    const relu = etat && etat.slots && pile(etat.slots[0]);
    ok(relu && relu.id === I.LIVRE && JSON.stringify(relu.data) === JSON.stringify(signe), 'SPEC-INTERIEUR-003 : après relance du serveur, le livre signé est toujours dans le coffre, intact');
    const second = pile(inv1[iL2]);
    ok(second && second.id === I.LIVRE && second.data && /^R\d+$/.test(second.data.titre), 'SPEC-INTERIEUR-003 : après relance, le livre de l\'inventaire garde ce qui y a été écrit (« ' + (second && second.data && second.data.titre) + ' »)');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── écran partagé : signature « (joueur N) » et budget anti-flood par joueur local ──
async function scenarioEcranPartage() {
  const d = A.dossierTemp('mc-livres-ep-');
  try {
    const f = fichierMonde(d);
    const env = { MC_TEST_INV: JSON.stringify([[I.LIVRE, 1], [I.LIVRE, 1]]) };
    const s = await demarrer(args(f, d), env);
    const { client: cl } = await rejoindre(s.port, 'Duo', 2);
    await dodo(500);
    const inv0 = (cl.dernier('inv_maj') && cl.dernier('inv_maj').inv) || null;
    let seq = 0;
    const iL = 0;
    // le joueur local 2 (j=1) signe : « (joueur 2) » ajouté au nom de la connexion
    const seqS = ++seq;
    cl.envoyer({ t: 'livre_ecrire', j: 1, seq: seqS, i: iL, titre: 'Duo', pages: ['a', 'b'], signer: true });
    const m = await cl.attendre('inv_maj', 3000, x => x.ack === seqS && x.j === 1);
    const p = pile(m.inv[iL]);
    ok(p && p.data && p.data.signe && p.data.auteur === 'Duo (joueur 2)', 'SPEC-INTERIEUR-003 : en écran partagé, le joueur local 2 signe « Duo (joueur 2) » (« ' + (p && p.data && p.data.auteur) + ' »)');
    await dodo(1100);
    // budget par joueur local : le joueur 1 épuise le sien, le joueur 2 garde le sien
    const vu = cl.depuis(), seq0 = seq;
    for (let k = 0; k < 20; k++) cl.envoyer({ t: 'livre_ecrire', j: 0, seq: ++seq, i: 1, titre: 'A' + k, pages: ['x'] });
    const seqJ2 = [];
    for (let k = 0; k < CA.BUDGETS_FLOOD.livre_ecrire; k++) { seqJ2.push(++seq); cl.envoyer({ t: 'livre_ecrire', j: 1, seq: seq, i: 1, titre: 'B' + k, pages: ['y'] }); }
    await dodo(900);
    const acks = vu('inv_maj').filter(x => x.ack > seq0);
    const recusJ2 = acks.filter(x => x.j === 1 && seqJ2.indexOf(x.ack) >= 0).length;
    eq(recusJ2, seqJ2.length, 'SPEC-INTERIEUR-003 : le budget anti-flood est par joueur local — le joueur 2 garde tout le sien quand le joueur 1 a épuisé le sien');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── lire : la bibliothèque générée d'un lieu ────────────────────────────────
function trouverBibliotheque() {
  const w = MC.createWorld(GRAINE);
  const lieux = w.habitats.lieuxProches(0, 0, 4000);
  for (const l of lieux) {
    const bat = l.batiments.find(b => b.type === 'point_info');
    if (!bat) continue;
    let trouve = null;
    l.blocs.forEach(a => { for (let i = 0; i < a.length && !trouve; i += 5) if (a[i + 3] === B.BIBLIOTHEQUE) trouve = { x: a[i], y: a[i + 1], z: a[i + 2] }; });
    if (trouve) return { lieu: l, bat, biblio: trouve };
  }
  return null;
}
async function scenarioBibliotheque() {
  const cible = trouverBibliotheque();
  ok(!!cible, 'préparation : une bibliothèque générée dans un point info près de l\'origine');
  if (!cible) return;
  const { bat, biblio, lieu } = cible;
  const spawn = [bat.dedans.x, bat.y0 + 0.05, bat.dedans.z].join(',');
  const s = await demarrer([], { MC_TEST_SPAWN: spawn });
  const { client: cl } = await rejoindre(s.port, 'Lectrice', 1);
  const cle = biblio.x + ',' + biblio.y + ',' + biblio.z;
  let etat = null;
  const t0 = Date.now();
  etat = await jusqua(() => cl.dernier('cont_etat') && cl.dernier('cont_etat').cle === cle ? cl.dernier('cont_etat') : null, 1, 1);
  for (let k = 0; k < 40 && !etat; k++) {
    cl.envoyer({ t: 'cont_ouvrir', j: 0, x: biblio.x, y: biblio.y, z: biblio.z });
    etat = await cl.attendre('cont_etat', 500, x => x.cle === cle).catch(() => null);
  }
  ok(!!etat && etat.type === 'bibliotheque', 'SPEC-INTERIEUR-003 : la bibliothèque générée de ' + lieu.nom + ' s\'ouvre (' + (Date.now() - t0) + ' ms)');
  const livres = etat ? etat.slots.map(pile).filter(Boolean) : [];
  eq(livres.length, 3, 'SPEC-INTERIEUR-003 : elle tient trois livres à lire');
  ok(livres.every(p => p.id === I.LIVRE && p.data && p.data.signe && p.data.pages.length >= 2), 'SPEC-INTERIEUR-003 : des livres écrits, signés, de plusieurs pages');
  const titres = livres.map(p => p.data.titre);
  ok(titres.some(t => /^Histoire de /.test(t)), 'SPEC-INTERIEUR-003 : l\'histoire du lieu et de ses voisins (histoire du monde) : ' + titres.join(' | '));
  const carnet = livres.find(p => /^Carnet d'explorateur/.test(p.data.titre));
  ok(!!carnet, 'SPEC-INTERIEUR-003 : le carnet d\'explorateur (indices des quêtes)');
  const noms = Object.keys(MC.Donjons.TYPES).map(k => MC.Donjons.TYPES[k].nom);
  ok(!!carnet && carnet.data.pages.slice(1).some(pg => noms.some(n => pg.indexOf(n) === 0) && /blocs (à|au)/.test(pg)),
     'SPEC-INTERIEUR-003 : le carnet situe des donjons (nom, distance, direction) : ' + (carnet ? carnet.data.pages[1] : ''));
  cl.fermer();
  await s.arreter();
}

// ── lire : le carnet dit quels donjons sont vaincus ─────────────────────────
async function scenarioCarnetVaincu() {
  const cible = trouverBibliotheque();
  if (!cible) return;
  const { bat, biblio, lieu } = cible;
  const w = MC.createWorld(GRAINE);
  const ids = w.donjons.dansZone(lieu.x - 200, lieu.z - 200, lieu.x + 200, lieu.z + 200).map(x => x.id);
  ok(ids.length > 0, 'préparation : des donjons dans les environs de ' + lieu.nom);
  const d = A.dossierTemp('mc-livres-v-');
  try {
    const f = path.join(d, 'monde.json');
    fs.writeFileSync(f, JSON.stringify({ v: 2, graine: GRAINE, heure: 60, overrides: [], etats: [], crops: [], donjons: ids }));
    const s = await demarrer(args(f, d), { MC_TEST_SPAWN: [bat.dedans.x, bat.y0 + 0.05, bat.dedans.z].join(',') });
    const { client: cl } = await rejoindre(s.port, 'Lectrice', 1);
    const cle = biblio.x + ',' + biblio.y + ',' + biblio.z;
    let etat = null;
    for (let k = 0; k < 40 && !etat; k++) {
      cl.envoyer({ t: 'cont_ouvrir', j: 0, x: biblio.x, y: biblio.y, z: biblio.z });
      etat = await cl.attendre('cont_etat', 500, x => x.cle === cle).catch(() => null);
    }
    const carnet = etat && etat.slots.map(pile).filter(Boolean).find(q => /^Carnet d'explorateur/.test(q.data.titre));
    ok(!!carnet && carnet.data.pages.slice(1).some(pg => pg.indexOf('vaincu') >= 0), 'SPEC-INTERIEUR-003 : le carnet signale les donjons vaincus (vaincu lu côté serveur)');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

(async () => {
  try {
    await scenarioEcriture();
    await scenarioEcranPartage();
    await scenarioBibliotheque();
    await scenarioCarnetVaincu();
  } catch (e) {
    ok(false, 'le scénario ne doit pas lever d\'exception', e && e.stack);
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
