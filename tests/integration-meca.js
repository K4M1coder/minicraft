/* integration-meca.js — L29 mécanismes et électricité sur de vrais processus
   server.js : en ligne, le SERVEUR fait foi (SPEC-MECA-008).
   - SPEC-MECA-005 : un levier et un bouton s'actionnent par le message
     ACTIONNER, validé par le serveur (portée, bloc actionnable) qui diffuse
     le nouvel état ; un bouton se relâche seul ; une plaque de pression se
     presse sous le joueur ; un détecteur jour/nuit émet la nuit.
   - SPEC-MECA-006 : une lampe commandée ne s'allume qu'alimentée (batterie
     voisine), et l'énergie est consommée (la batterie se vide).
   - SPEC-MECA-002 : un générateur thermique brûle le combustible qu'on a
     rangé dans son conteneur (sur l'inventaire du serveur) et charge une
     batterie ; SPEC-MECA-003 : la batterie cassée garde son niveau sur sa
     pile, et reposée le retrouve — niveau tiré de la pile du SERVEUR, jamais
     de l'état annoncé par le client.
   - SPEC-MECA-008 : l'état d'un mécanisme posé est celui du serveur (un
     levier annoncé « actionné » se pose relâché) ; arrêt puis relance du
     serveur : levier, batterie et générateur retrouvent leur état et la
     simulation reprend.
   Chaque scénario lance ET arrête son serveur (port 0) ; attentes bornées
   par sondage, jamais de délai fixe. Usage : node tests/integration-meca.js [scénario] */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre } = A;
const R = A.creerRapport('Intégration MECA — commandes, énergie et autorité du serveur (L29)');
const { ok, eq } = R;

const MC = A.chargerModules();
const B = MC.Core.B, I = MC.Core.I;
const NUIT = MC.DayCycle.DAY_LENGTH * 0.75;
const GRAINE = 20260921;
const serveurs = [];
async function demarrer(args, env) {
  const s = await lancer(['--port', '0'].concat(args || []), env);
  serveurs.push(s);
  return s;
}

// ── outils ───────────────────────────────────────────────────────────────────
async function jusqua(lire, ms, pas) {
  const fin = Date.now() + (ms || 5000);
  for (;;) {
    const v = lire();
    if (v) return v;
    if (Date.now() > fin) return null;
    await dodo(pas || 40);
  }
}
async function jusquaAsync(lire, ms, pas) {
  const fin = Date.now() + (ms || 5000);
  for (;;) {
    const v = await lire();
    if (v) return v;
    if (Date.now() > fin) return null;
    await dodo(pas || 60);
  }
}
const etatToi = (cl, j) => { const e = cl.dernier('etat'); return e && e.toi && e.toi[j || 0]; };
async function attendreImmobile(cl, ms) {
  return !!(await jusquaAsync(async () => {
    const a = cl.dernier('etat');
    if (!a || !a.toi[0]) return false;
    await dodo(250);
    const b = cl.dernier('etat');
    if (!b || b === a || !b.toi[0]) return false;
    return Math.abs(a.toi[0].x - b.toi[0].x) < 1e-6 && Math.abs(a.toi[0].y - b.toi[0].y) < 1e-6 && Math.abs(a.toi[0].z - b.toi[0].z) < 1e-6;
  }, ms || 15000, 10));
}
function fichierMonde(dossier, extra) {
  const f = path.join(dossier, 'monde.json');
  fs.writeFileSync(f, JSON.stringify(Object.assign({ v: 2, graine: GRAINE, heure: 60, overrides: [], etats: [], crops: [] }, extra || {})));
  return f;
}
const args = (f, d) => ['--monde', f, '--dossier-parties', d];
const ici = (x, y, z) => (m) => m.x === x && m.y === y && m.z === z;
/* Le dernier état diffusé d'une case (BLOC), parmi les messages reçus depuis `vu`. */
function dernierBloc(vu, x, y, z) {
  const l = vu('bloc').filter(ici(x, y, z));
  return l.length ? l[l.length - 1] : null;
}
async function poser(cl, x, y, z, id, etat, i) {
  const m = { t: 'bloc', x, y, z, id, j: 0, etat: etat || 0 };
  if (i !== undefined) m.i = i;
  const vu = cl.depuis();
  cl.envoyer(m);
  return jusqua(() => vu('bloc').find(b => ici(x, y, z)(b) && b.id === id), 3000);
}
async function overrides(cl, x, z) {
  const cx = Math.floor(x / 16), cz = Math.floor(z / 16);
  const vu = cl.depuis();
  cl.envoyer({ t: 'overrides_demande', cx, cz });
  return jusqua(() => vu('overrides_chunk').find(m => m.cx === cx && m.cz === cz), 3000);
}
const enOv = (ov, x, y, z) => ov && ov.blocs.find(b => b[0] === x && b[1] === y && b[2] === z);

// ── SPEC-MECA-005/006/008 : levier, bouton, plaque, détecteur ; lampe alimentée ─
async function scenarioCommandes() {
  const d = A.dossierTemp('mc-meca-cmd-');
  try {
    const f = fichierMonde(d, { heure: NUIT });
    let s = await demarrer(args(f, d), { MC_MODE: 'survie' });     // MC_TEST_POSE_LIBRE (aide) : poser sans inventaire
    let { client: cl } = await rejoindre(s.port, 'Mecano', 1);
    ok(await attendreImmobile(cl), 'préparation : le joueur est posé au sol');
    const p = etatToi(cl, 0);
    const bx = Math.floor(p.x) + 1, by = Math.floor(p.y) + 3, bz = Math.floor(p.z);

    // batterie (niveau annoncé 200 : pose libre, pas de pile serveur), lampe, levier annoncé « actionné »
    ok(!!(await poser(cl, bx, by, bz, B.BATTERIE, 200)), 'préparation : batterie posée');
    ok(!!(await poser(cl, bx + 1, by, bz, B.LAMPE_ETEINTE)), 'préparation : lampe posée');
    const vu0 = cl.depuis();
    const levier = await poser(cl, bx + 2, by, bz, B.LEVIER_CIRCUIT, 1);
    eq(levier && levier.etat, 0, 'SPEC-MECA-008 : un levier annoncé actionné par le client se pose relâché (état décidé par le serveur)');
    await dodo(600);   // trois tics de circuits : rien ne doit s'allumer
    ok(!vu0('bloc').some(m => ici(bx + 1, by, bz)(m) && m.id === B.LAMPE_ALLUMEE), 'SPEC-MECA-008 : la lampe reste éteinte, le levier n\'a jamais été actionné');

    // ACTIONNER : le levier bascule, la lampe alimentée s'allume, la batterie paie
    let vu = cl.depuis();
    cl.envoyer({ t: 'actionner', j: 0, x: bx + 2, y: by, z: bz });
    const lev1 = await jusqua(() => vu('bloc').find(m => ici(bx + 2, by, bz)(m) && m.etat === 1), 3000);
    ok(!!lev1, 'SPEC-MECA-005 : ACTIONNER sur un levier — le serveur diffuse le levier actionné (état 1)');
    const allumee = await jusqua(() => vu('bloc').find(m => ici(bx + 1, by, bz)(m) && m.id === B.LAMPE_ALLUMEE), 3000);
    ok(!!allumee, 'SPEC-MECA-005/006 : le signal du levier allume la lampe alimentée par la batterie');
    const conso = await jusqua(() => { const b = dernierBloc(vu, bx, by, bz); return b && b.etat < 200 ? b : null; }, 3000);
    ok(!!conso, 'SPEC-MECA-006 : la lampe allumée consomme — le niveau de la batterie baisse', JSON.stringify(dernierBloc(vu, bx, by, bz)));

    vu = cl.depuis();
    cl.envoyer({ t: 'actionner', j: 0, x: bx + 2, y: by, z: bz });
    ok(!!(await jusqua(() => vu('bloc').find(m => ici(bx + 2, by, bz)(m) && m.etat === 0), 3000)), 'SPEC-MECA-005 : un second ACTIONNER relâche le levier');
    ok(!!(await jusqua(() => vu('bloc').find(m => ici(bx + 1, by, bz)(m) && m.id === B.LAMPE_ETEINTE), 3000)), 'SPEC-MECA-006 : plus de signal, la lampe s\'éteint');

    // sans énergie : la batterie retirée, le levier actionné n'allume plus rien
    ok(!!(await poser(cl, bx, by, bz, 0)), 'préparation : batterie retirée');
    vu = cl.depuis();
    cl.envoyer({ t: 'actionner', j: 0, x: bx + 2, y: by, z: bz });
    ok(!!(await jusqua(() => vu('bloc').find(m => ici(bx + 2, by, bz)(m) && m.etat === 1), 3000)), 'préparation : levier actionné');
    await dodo(600);
    ok(!vu('bloc').some(m => ici(bx + 1, by, bz)(m) && m.id === B.LAMPE_ALLUMEE), 'SPEC-MECA-006 : commandée mais sans énergie, la lampe ne s\'allume pas');

    // refus : trop loin, ou un bloc qui ne s'actionne pas
    const loinX = bx + 40;
    vu = cl.depuis();
    cl.envoyer({ t: 'actionner', j: 0, x: bx + 1, y: by, z: bz });            // la lampe : pas une commande
    cl.envoyer({ t: 'actionner', j: 0, x: loinX, y: by, z: bz });             // hors de portée
    cl.envoyer({ t: 'actionner', j: 0, x: bx + 2, y: by, z: bz, etat: 0 });   // l'état annoncé n'est jamais lu
    const rel = await jusqua(() => vu('bloc').find(m => ici(bx + 2, by, bz)(m) && m.etat === 0), 3000);
    ok(!!rel, 'SPEC-MECA-005 : l\'état annoncé par le client est ignoré, le levier bascule (1 → 0)');
    await dodo(400);
    ok(!vu('bloc').some(m => ici(bx + 1, by, bz)(m) && m.id !== B.LAMPE_ETEINTE), 'SPEC-MECA-005 : actionner une lampe ne fait rien');
    ok(!vu('bloc').some(m => m.x === loinX), 'SPEC-MECA-005 : hors de portée, le serveur refuse sans rien diffuser');

    // bouton : enfoncé par ACTIONNER, il se relâche seul
    ok(!!(await poser(cl, bx + 4, by, bz, B.BOUTON_CIRCUIT)), 'préparation : bouton posé');
    vu = cl.depuis();
    cl.envoyer({ t: 'actionner', j: 0, x: bx + 4, y: by, z: bz });
    const enfonce = await jusqua(() => vu('bloc').find(m => ici(bx + 4, by, bz)(m) && m.etat === 1), 3000);
    ok(!!enfonce, 'SPEC-MECA-005 : ACTIONNER enfonce le bouton (état 1 diffusé)');
    const relache = await jusqua(() => vu('bloc').find(m => ici(bx + 4, by, bz)(m) && m.etat === 0), 5000);
    ok(!!relache, 'SPEC-MECA-005 : le bouton se relâche seul (état 0 diffusé quelques instants plus tard)');

    // détecteur jour/nuit (il fait nuit) et plaque de pression sous les pieds du joueur
    vu = cl.depuis();
    ok(!!(await poser(cl, bx - 2, by, bz, B.DETECTEUR_JOURNUIT)), 'préparation : détecteur jour/nuit posé');
    ok(!!(await jusqua(() => vu('bloc').find(m => ici(bx - 2, by, bz)(m) && m.etat === 1), 3000)), 'SPEC-MECA-005 : la nuit, le détecteur jour/nuit émet (serveur)');
    const pp = etatToi(cl, 0);
    const px = Math.floor(pp.x), py = Math.floor(pp.y + 0.01), pz = Math.floor(pp.z);
    vu = cl.depuis();
    ok(!!(await poser(cl, px, py, pz, B.PLAQUE_PRESSION)), 'préparation : plaque posée sous le joueur');
    ok(!!(await jusqua(() => vu('bloc').find(m => ici(px, py, pz)(m) && m.etat === 1), 3000)), 'SPEC-MECA-005 : le joueur debout sur la plaque la presse');
    vu = cl.depuis();
    ok(!!(await poser(cl, px + 3, py, pz, B.PLAQUE_PRESSION)), 'préparation : plaque posée à côté du joueur');
    await dodo(600);
    ok(!vu('bloc').some(m => ici(px + 3, py, pz)(m) && m.etat === 1), 'SPEC-MECA-005 : une plaque où personne ne se tient reste relâchée');

    // ── une lampe allumée sur batterie : diffusion du niveau, puis arrêt et relance (SPEC-MECA-008) ──
    const ly = by + 1;
    ok(!!(await poser(cl, bx, ly, bz, B.BATTERIE, 200)), 'préparation : seconde batterie (200)');
    ok(!!(await poser(cl, bx + 1, ly, bz, B.LAMPE_ETEINTE)), 'préparation : seconde lampe');
    ok(!!(await poser(cl, bx + 2, ly, bz, B.LEVIER_CIRCUIT)), 'préparation : second levier');
    vu = cl.depuis();
    cl.envoyer({ t: 'actionner', j: 0, x: bx + 2, y: ly, z: bz });
    ok(!!(await jusqua(() => vu('bloc').find(m => ici(bx + 1, ly, bz)(m) && m.id === B.LAMPE_ALLUMEE), 3000)), 'préparation : la lampe s\'allume sur la batterie');
    // le niveau qui baisse d'une unité par tic n'est annoncé qu'à ≥ 5 % d'écart ou une fois par seconde
    const vuN = cl.depuis();
    const tN = Date.now();
    await jusqua(() => false, 2500);
    const annonces = vuN('bloc').filter(ici(bx, ly, bz));
    const secondes = (Date.now() - tN) / 1000;
    ok(annonces.length >= 1 && annonces.length <= Math.ceil(secondes) + 1,
       'SPEC-MECA-008 : une batterie qui se décharge n\'est pas annoncée à chaque tic (' + annonces.length + ' annonce(s) en ' + secondes.toFixed(1) + ' s, au plus une par seconde)', JSON.stringify(annonces.map(m => m.etat)));
    const avantArret = await overrides(cl, bx, bz);
    const nAvant = enOv(avantArret, bx, ly, bz);
    ok(nAvant && nAvant[4] > 0 && nAvant[4] < 200, 'préparation : la batterie s\'est déchargée avant l\'arrêt (' + (nAvant && nAvant[4]) + ')');
    cl.fermer();
    await s.arreter();
    // un levier posé hors de portée du joueur (9 blocs), directement dans le fichier du monde
    const fx = Math.floor(p.x) + 9, fy = Math.floor(p.y) + 1, fz = Math.floor(p.z);
    const fichier = JSON.parse(fs.readFileSync(f, 'utf8'));
    fichier.overrides = (fichier.overrides || []).concat([[fx, fy, fz, B.LEVIER_CIRCUIT]]);
    fs.writeFileSync(f, JSON.stringify(fichier));
    s = await demarrer(args(f, d), { MC_MODE: 'survie' });
    ({ client: cl } = await rejoindre(s.port, 'Mecano', 1));
    ok(await attendreImmobile(cl), 'préparation : de retour, le joueur est posé au sol');
    vu = cl.depuis();
    const apres = await overrides(cl, bx, bz);
    const nRepris = enOv(apres, bx, ly, bz);
    ok(nRepris && nRepris[4] > 0, 'préparation : la batterie est reprise avec son niveau (' + (nRepris && nRepris[4]) + ')');
    const decharge = await jusqua(() => vu('bloc').find(m => ici(bx, ly, bz)(m) && m.etat < nRepris[4]), 5000);
    ok(!!decharge, 'SPEC-MECA-008 : après la relance, les circuits repris se simulent — la batterie continue de se décharger dans la lampe', JSON.stringify(vu('bloc').filter(ici(bx, ly, bz))));
    vu = cl.depuis();
    cl.envoyer({ t: 'actionner', j: 0, x: bx + 2, y: ly, z: bz });
    ok(!!(await jusqua(() => vu('bloc').find(m => ici(bx + 1, ly, bz)(m) && m.id === B.LAMPE_ETEINTE), 3000)),
       'SPEC-MECA-008 : après la relance, relâcher le levier éteint la lampe (un tic de circuits a lieu)');
    // portée d'ACTIONNER : un VRAI levier, mais à 9 blocs
    const oLoin = enOv(await overrides(cl, fx, fz), fx, fy, fz);
    ok(oLoin && oLoin[3] === B.LEVIER_CIRCUIT, 'préparation : le levier lointain existe pour le serveur', JSON.stringify(oLoin));
    vu = cl.depuis();
    cl.envoyer({ t: 'actionner', j: 0, x: fx, y: fy, z: fz });
    await jusqua(() => false, 800);
    ok(!vu('bloc').some(ici(fx, fy, fz)), 'SPEC-MECA-005 : un levier à 9 blocs (portée 7) n\'est pas actionné');
    const oLoin2 = enOv(await overrides(cl, fx, fz), fx, fy, fz);
    ok(oLoin2 && !oLoin2[4], 'SPEC-MECA-005 : pour le serveur, le levier lointain est toujours relâché', JSON.stringify(oLoin2));
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

// ── SPEC-MECA-002/003/008 : générateur thermique, batterie ramassée, relance ─
async function scenarioEnergie() {
  const d = A.dossierTemp('mc-meca-nrj-');
  try {
    const f = fichierMonde(d, {});
    const inv = [[B.GENERATEUR_THERMIQUE, 1], [B.BATTERIE, 1], [I.COAL, 6], [B.LEVIER_CIRCUIT, 1]];
    const env = { MC_MODE: 'survie', MC_TEST_POSE_LIBRE: '', MC_TEST_INV: JSON.stringify(inv) };
    let s = await demarrer(args(f, d), env);
    let { client: cl, bienvenue } = await rejoindre(s.port, 'Electricien', 1);
    ok(await attendreImmobile(cl), 'préparation : le joueur est posé au sol');
    const p = etatToi(cl, 0);
    // la batterie juste au-dessus de la tête du joueur : cassée, elle tombe dans ses mains (ramassage du serveur)
    const gx = Math.floor(p.x) - 1, gy = Math.floor(p.y) + 2, gz = Math.floor(p.z);
    const kG = gx + ',' + gy + ',' + gz;
    ok(!!(await poser(cl, gx, gy, gz, B.GENERATEUR_THERMIQUE, 0, 0)), 'préparation : générateur thermique posé (pris dans l\'inventaire du serveur)');
    const bat = await poser(cl, gx + 1, gy, gz, B.BATTERIE, 200, 1);
    eq(bat && bat.etat, 0, 'SPEC-MECA-008 : une batterie neuve se pose vide, quel que soit le niveau annoncé par le client (200)');
    ok(!!(await poser(cl, gx - 1, gy, gz, B.LEVIER_CIRCUIT, 0, 3)), 'préparation : levier posé contre le générateur');

    // le combustible se range dans le conteneur du générateur, sur l'inventaire du SERVEUR
    let vu = cl.depuis();
    cl.envoyer({ t: 'cont_ouvrir', j: 0, x: gx, y: gy, z: gz });
    const ce = await jusqua(() => vu('cont_etat').find(m => m.cle === kG), 3000);
    ok(!!ce, 'SPEC-MECA-002 : le générateur thermique s\'ouvre comme un conteneur du serveur', ce && JSON.stringify(ce).slice(0, 120));
    ok(!vu('bloc').some(m => ici(gx, gy, gz)(m) && m.etat > 0), 'préparation : à froid il ne produit rien');
    vu = cl.depuis();
    cl.envoyer({ t: 'cont_transfert', j: 0, seq: 1, de: { z: 'inv', i: 2 }, vers: { z: 'cont', cle: kG, i: 0 }, n: 3 });
    const maj = await jusqua(() => vu('inv_maj').find(m => m.ack === 1), 3000);
    ok(maj && !(maj.refus && maj.refus.length), 'préparation : trois charbons rangés dans le générateur', maj && JSON.stringify(maj.refus));
    const lance = await jusqua(() => vu('bloc').find(m => ici(gx, gy, gz)(m) && m.etat === 10), 4000);
    ok(!!lance, 'SPEC-MECA-002 : le combustible brûle — le générateur produit (puissance 10)');
    const brule = await jusqua(() => vu('cont_maj').find(m => m.cle === kG && m.maj.some(c => c[0] === 0 && (!c[1] || c[1][1] < 3))), 4000);
    ok(!!brule, 'SPEC-MECA-002 : un charbon est pris dans le conteneur pour brûler (delta reçu par le joueur qui l\'a ouvert)');
    const charge = await jusqua(() => { const b = dernierBloc(vu, gx + 1, gy, gz); return b && b.etat >= 24 ? b : null; }, 6000);
    ok(!!charge, 'SPEC-MECA-002/003 : le surplus du générateur charge la batterie voisine', JSON.stringify(dernierBloc(vu, gx + 1, gy, gz)));
    const etapes = vu('bloc').filter(ici(gx + 1, gy, gz)).map(m => m.etat);
    ok(etapes.every((e, k) => k === 0 || e - etapes[k - 1] <= 5 * MC.Circuits.DEBIT_BATTERIE), 'SPEC-MECA-003 : la charge avance à débit borné — au plus 4 par tic, une annonce au plus toutes les 5 tics (' + etapes.slice(0, 12).join(',') + ')');

    // la batterie cassée : sa pile porte son niveau ; reposée, elle le retrouve
    const vuC = cl.depuis();
    cl.envoyer({ t: 'bloc', x: gx + 1, y: gy, z: gz, id: 0, outil: 0, j: 0 });
    const casse = await jusqua(() => vuC('bloc').find(m => ici(gx + 1, gy, gz)(m) && m.id === 0), 3000);
    ok(!!casse, 'préparation : batterie cassée');
    const avantCasse = dernierBloc(vu, gx + 1, gy, gz);
    const niveauCasse = (() => { const l = vu('bloc').filter(m => ici(gx + 1, gy, gz)(m) && m.id === B.BATTERIE); return l.length ? l[l.length - 1].etat : null; })();
    const ramasse = await jusqua(() => {
      const m = vuC('inv_maj').concat(vuC('donne')).reverse().find(x => x.inv && x.inv.some(c => c && c[0] === B.BATTERIE));
      return m ? m.inv.find(c => c && c[0] === B.BATTERIE) : null;
    }, 6000);
    ok(!!ramasse, 'préparation : la batterie est ramassée (inventaire du serveur)', avantCasse && JSON.stringify(avantCasse));
    const niv = ramasse && ramasse[3] && ramasse[3].niveau;
    ok(niv > 0, 'SPEC-MECA-003 : la pile ramassée porte le niveau de la batterie (' + niv + ')', JSON.stringify(ramasse));
    ok(niv >= niveauCasse && niv - niveauCasse <= 5 * MC.Circuits.DEBIT_BATTERIE, 'SPEC-MECA-003 : c\'est le niveau qu\'elle avait à la casse (dernier annoncé ' + niveauCasse + ', au plus une seconde de charge en plus)');
    const iBat = ramasse ? (vuC('inv_maj').concat(vuC('donne')).reverse().find(x => x.inv && x.inv.some(c => c && c[0] === B.BATTERIE)).inv.findIndex(c => c && c[0] === B.BATTERIE)) : 1;
    const repose = await poser(cl, gx + 1, gy + 1, gz, B.BATTERIE, 0, iBat);
    ok(niv > 0 && repose && repose.etat === niv, 'SPEC-MECA-003/008 : reposée, la batterie reprend le niveau de la pile du SERVEUR (l\'état 0 annoncé est ignoré)', JSON.stringify(repose));
    vu = cl.depuis();
    cl.envoyer({ t: 'actionner', j: 0, x: gx - 1, y: gy, z: gz });
    ok(!!(await jusqua(() => vu('bloc').find(m => ici(gx - 1, gy, gz)(m) && m.etat === 1), 3000)), 'préparation : levier actionné avant l\'arrêt');

    // arrêt (sauvegarde) puis relance : les états sont rendus et la simulation reprend
    cl.fermer();
    await s.arreter();
    s = await demarrer(args(f, d), env);
    ({ client: cl, bienvenue } = await rejoindre(s.port, 'Electricien', 1));
    const ov = await overrides(cl, gx, gz);
    const oLev = enOv(ov, gx - 1, gy, gz), oBat = enOv(ov, gx + 1, gy + 1, gz), oGen = enOv(ov, gx, gy, gz);
    ok(oLev && oLev[3] === B.LEVIER_CIRCUIT && oLev[4] === 1, 'SPEC-MECA-008 : après relance, le levier est toujours actionné', JSON.stringify(oLev));
    ok(oBat && oBat[3] === B.BATTERIE && oBat[4] >= niv, 'SPEC-MECA-008 : après relance, la batterie a gardé son niveau (' + (oBat && oBat[4]) + ' ≥ ' + niv + ')', JSON.stringify(oBat));
    ok(oGen && oGen[3] === B.GENERATEUR_THERMIQUE, 'SPEC-MECA-008 : le générateur est toujours là', JSON.stringify(oGen));
    vu = cl.depuis();
    cl.envoyer({ t: 'actionner', j: 0, x: gx - 1, y: gy, z: gz });
    ok(!!(await jusqua(() => vu('bloc').find(m => ici(gx - 1, gy, gz)(m) && m.etat === 0), 3000)), 'SPEC-MECA-008 : après relance, le serveur simule et arbitre toujours (levier relâché)');
    cl.fermer();
    await s.arreter();
    void bienvenue;
  } finally { A.supprimerDossier(d); }
}

// ── SPEC-MECA-008 : les états que décident les circuits ne vont qu'aux clients à portée ─
async function scenarioPortee() {
  const d = A.dossierTemp('mc-meca-por-');
  try {
    const f = fichierMonde(d, {});
    // portée de diffusion des blocs du monde réduite à 4 blocs (réglage de test du serveur)
    const s = await demarrer(args(f, d), { MC_MODE: 'survie', MC_TEST_PORTEE_BLOCS: '4' });
    const { client: cl } = await rejoindre(s.port, 'Lointain', 1);
    ok(await attendreImmobile(cl), 'préparation : le joueur est posé au sol');
    const p = etatToi(cl, 0);
    const x0 = Math.floor(p.x), y0 = Math.floor(p.y) + 2, z0 = Math.floor(p.z);
    ok(!!(await poser(cl, x0 + 6, y0, z0, B.BATTERIE, 200)), 'préparation : batterie à 6 blocs (au-delà de la portée de diffusion)');
    ok(!!(await poser(cl, x0 + 6, y0, z0 + 1, B.LAMPE_ETEINTE)), 'préparation : lampe contre elle');
    ok(!!(await poser(cl, x0 + 5, y0, z0 + 1, B.LEVIER_CIRCUIT)), 'préparation : levier contre la lampe');
    const vu = cl.depuis();
    cl.envoyer({ t: 'actionner', j: 0, x: x0 + 5, y: y0, z: z0 + 1 });
    ok(!!(await jusqua(() => vu('bloc').find(m => ici(x0 + 5, y0, z0 + 1)(m) && m.etat === 1), 3000)), 'préparation : levier actionné (réponse directe à l\'action)');
    await jusqua(() => false, 2000);
    const ov = await overrides(cl, x0 + 6, z0);
    const lampe = enOv(ov, x0 + 6, y0, z0 + 1), bat = enOv(ov, x0 + 6, y0, z0);
    ok(lampe && lampe[3] === B.LAMPE_ALLUMEE && bat && bat[4] < 200, 'préparation : pour le serveur, la lampe brille et la batterie se vide', JSON.stringify([lampe, bat]));
    const recus = vu('bloc').filter(m => (ici(x0 + 6, y0, z0)(m) || ici(x0 + 6, y0, z0 + 1)(m)));
    eq(recus.length, 0, 'SPEC-MECA-008 : un client hors de portée ne reçoit aucun des états que les circuits changent (lampe, niveau de batterie)');
    cl.fermer();
    await s.arreter();
  } finally { A.supprimerDossier(d); }
}

(async () => {
  const filtre = process.argv[2];
  const scenarios = { commandes: scenarioCommandes, energie: scenarioEnergie, portee: scenarioPortee };
  try {
    for (const nom of Object.keys(scenarios)) {
      if (filtre && filtre !== nom) continue;
      try { await scenarios[nom](); }
      catch (e) { ok(false, 'scénario ' + nom + ' : exception', e && e.stack); }
    }
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
