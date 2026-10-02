/* integration-archi-sauvegarde.js — chantier ARCHI (L50), lot A0 : terminaison
   propre et sauvegardes du monde du serveur local, sur de vrais processus.

   Couvre SPEC-ARCHI-008 (ARRET local, dernier client parti → sauvegarde puis
   arrêt à 10 s, reconnexion dans le délai, mode ouvert jamais terminé) et
   SPEC-ARCHI-012 (sauvegarde immédiate à la pause / au dernier client / à la
   fermeture réseau, cadence de 45 s en mode fermé, sauvegarde omise quand rien
   n'a changé).

   Usage : node tests/integration-archi-sauvegarde.js */
'use strict';
const path = require('path');
const fs = require('fs');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre, attendreClients, dossierTemp, supprimerDossier } = A;
const R = A.creerRapport('Intégration ARCHI — arrêt et sauvegardes (SPEC-ARCHI-008, 012)');
const { ok, eq } = R;

const serveurs = [];
async function demarrer(args, env) { const s = await lancer(args, env); serveurs.push(s); return s; }

const existe = (f) => fs.existsSync(f);
async function attendreFichier(f, ms) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (existe(f)) return true; await dodo(25); }
  return existe(f);
}
const effacer = (f) => { try { fs.unlinkSync(f); } catch (e) { /* absent */ } };
const mtime = (f) => { try { return fs.statSync(f).mtimeMs; } catch (e) { return 0; } };
// pose un bloc juste au-dessus de la tête du joueur (une mutation persistée du monde)
function poserBloc(client, bienvenue, id, dx) {
  const moi = bienvenue.toi[0];
  client.envoyer({ t: 'bloc', x: Math.floor(moi.x) + (dx || 0), y: Math.floor(moi.y) + 3, z: Math.floor(moi.z), id: id || 9 });
}

// ── 012 (a) sauvegardes immédiates, puis 008 (b) arrêt à 10 s ────────────────
async function scenarioEvenements() {
  const dossier = dossierTemp('mc-archi-s1-');
  const f = path.join(dossier, 'monde.json');
  try {
    const s = await demarrer(['--port', '0', '--monde', f, '--dossier-parties', dossier]);
    const a = await rejoindre(s.port, 'Alice', 1);
    poserBloc(a.client, a.bienvenue, 9);
    await dodo(300);
    ok(!existe(f), 'SPEC-ARCHI-012 : rien n\'est écrit avant un évènement ou une cadence (45 s)');
    a.client.envoyer({ t: 'pause', actif: true });
    ok(await attendreFichier(f, 1000), 'SPEC-ARCHI-012 : l\'entrée en pause écrit le monde dans la seconde');
    const contenu = JSON.parse(fs.readFileSync(f, 'utf8'));
    ok(contenu.overrides.some(o => o[3] === 9), 'SPEC-ARCHI-012 : la sauvegarde contient le bloc posé');
    effacer(f);
    a.client.envoyer({ t: 'pause', actif: false });
    await dodo(500);
    a.client.envoyer({ t: 'pause', actif: true });
    ok(await attendreFichier(f, 1000), 'SPEC-ARCHI-012 : une seconde entrée en pause (retour au menu) écrit de nouveau dans la seconde');
    effacer(f);
    a.client.envoyer({ t: 'pause', actif: false });
    await dodo(500);
    const tFerme = Date.now();
    a.client.socket.destroy();                          // fermeture BRUTALE de l'onglet
    ok(await attendreFichier(f, 5000), "SPEC-ARCHI-008/012 : la fermeture brutale du seul client écrit le monde aussitôt (borne de 5 s : la détection d'une socket détruite dépend de l'OS et de la charge ; la cadence exclue est de 45 s)");
    const code = await Promise.race([s.sortie, dodo(14000).then(() => 'trop long')]);
    const duree = Date.now() - tFerme;
    eq(code, 0, 'SPEC-ARCHI-008 : le processus se termine de lui-même (code 0)');
    ok(duree >= 9000 && duree <= 11500, 'SPEC-ARCHI-008 : terminaison ≈ 10 s après le départ du dernier client (≤ 11 s)', duree + ' ms');
  } finally { supprimerDossier(dossier); }
}

// ── 008 : reconnexion dans le délai de grâce, puis ARRET local ───────────────
async function scenarioReconnexionEtArret() {
  const dossier = dossierTemp('mc-archi-s2-');
  const f = path.join(dossier, 'monde.json');
  try {
    const s = await demarrer(['--port', '0', '--monde', f, '--dossier-parties', dossier]);
    const a = await rejoindre(s.port, 'Alice', 1);
    poserBloc(a.client, a.bienvenue, 9);
    await dodo(200);
    const t0 = Date.now();
    a.client.socket.destroy();
    await dodo(5000 - (Date.now() - t0));
    ok(s.vivant, 'SPEC-ARCHI-008 : 5 s après le départ, le serveur est toujours là');
    const b = await rejoindre(s.port, 'Alice', 1);
    eq(b.bienvenue.pause, false, 'SPEC-ARCHI-008 : la reconnexion à 5 s reprend la partie (pas de pause résiduelle)');
    await dodo(7000);                                      // > 10 s depuis le premier départ
    ok(s.vivant, 'SPEC-ARCHI-008 : reconnecté à 5 s, le serveur ne se termine pas à 10 s');
    // ARRET (boucle locale) : sauvegarde synchrone puis sortie code 0
    effacer(f);
    b.client.envoyer({ t: 'arret' });
    const code = await Promise.race([s.sortie, dodo(5000).then(() => 'trop long')]);
    eq(code, 0, 'SPEC-ARCHI-008 : ARRET local → sortie code 0');
    ok(existe(f), 'SPEC-ARCHI-008 : ARRET sauvegarde le monde avant de terminer');
  } finally { supprimerDossier(dossier); }
}

// ── 012 : fermeture réseau ; 008 : le mode ouvert n'est jamais terminé ────────
async function scenarioReseauOuvert() {
  const dossier = dossierTemp('mc-archi-s3-');
  const f = path.join(dossier, 'monde.json');
  try {
    const s = await demarrer(['--port', '0', '--ouvert', '--monde', f, '--dossier-parties', dossier], { MC_GRACE_ARRET_MS: '1000' });
    const a = await rejoindre(s.port, 'Alice', 1);
    poserBloc(a.client, a.bienvenue, 9);
    await dodo(300);
    ok(!existe(f), 'SPEC-ARCHI-012 : en mode ouvert non plus, rien n\'est écrit avant la cadence (120 s)');
    a.client.envoyer({ t: 'reseau', ouvert: false });
    await a.client.attendre('reseau_etat', 4000, m => m.etat === 'ferme');
    ok(await attendreFichier(f, 1000), 'SPEC-ARCHI-012 : la fermeture du réseau écrit le monde dans la seconde');
    // redevenu fermé, le départ du dernier client déclenche désormais la terminaison
    a.client.envoyer({ t: 'reseau', ouvert: true });
    await a.client.attendre('reseau_etat', 4000, m => m.etat === 'ouvert');
    a.client.socket.destroy();
    await attendreClients(s.port, 0);
    await dodo(2500);
    ok(s.vivant, 'SPEC-ARCHI-008 : rouvert au réseau, le départ du dernier client ne termine pas le processus');
  } finally { supprimerDossier(dossier); }
}

// ── 012 (b) : cadence de 45 s en mode fermé, sauvegarde omise si rien n'a changé
async function scenarioCadence45() {
  const dossier = dossierTemp('mc-archi-s4-');
  const f = path.join(dossier, 'monde.json');
  try {
    const s = await demarrer(['--port', '0', '--monde', f, '--dossier-parties', dossier]);
    const a = await rejoindre(s.port, 'Alice', 1);
    poserBloc(a.client, a.bienvenue, 9);
    const cadence = () => s.heureLog.filter(([, l]) => /sauvegarde (du monde|omise) \(cadence\)/.test(l));
    const debut = Date.now() + 100000;
    while (cadence().length < 2 && Date.now() < debut) await dodo(500);
    const l = cadence();
    ok(l.length >= 2, 'SPEC-ARCHI-012 : deux cadences observées dans le journal', String(l.length));
    if (l.length >= 2) {
      const premier = l[0][0] - s.t0;
      const ecart = l[1][0] - l[0][0];
      ok(premier > 43000 && premier < 50000, 'SPEC-ARCHI-012 : première sauvegarde périodique ≈ 45 s après le lancement (fermé)', premier + ' ms');
      ok(Math.abs(ecart - 45000) <= 2000, 'SPEC-ARCHI-012 : cadence de 45 s ± 2 s en mode fermé', ecart + ' ms');
      ok(/sauvegarde du monde/.test(l[0][1]) && existe(f), 'SPEC-ARCHI-012 : la première cadence écrit le monde (état modifié)');
      ok(/omise/.test(l[1][1]), 'SPEC-ARCHI-012 : la seconde cadence, sans mutation, n\'écrit rien');
    }
    await s.arreter();
  } finally { supprimerDossier(dossier); }
}

// ── 012 : « sale » — la cadence n'écrit que si quelque chose a changé ────────
async function scenarioOmission() {
  const dossier = dossierTemp('mc-archi-s5-');
  const f = path.join(dossier, 'monde.json');
  try {
    const s = await demarrer(['--port', '0', '--monde', f, '--dossier-parties', dossier], { MC_SAUVEGARDE_MS: '1200' });
    const a = await rejoindre(s.port, 'Alice', 1);
    poserBloc(a.client, a.bienvenue, 9);
    ok(await attendreFichier(f, 4000), 'SPEC-ARCHI-012 : la cadence écrit le monde modifié');
    await dodo(3000);                                       // le joueur finit de tomber au sol : son état se stabilise
    const m1 = mtime(f);
    await dodo(4500);                                       // ≥ 3 cadences sans mutation
    eq(mtime(f), m1, 'SPEC-ARCHI-012 : plusieurs cadences sans mutation n\'écrivent rien (même fichier)');
    const omises = s.logs.filter(l => /sauvegarde omise \(cadence\)/.test(l)).length;
    ok(omises >= 2, 'SPEC-ARCHI-012 : le journal atteste les cadences omises', String(omises));
    poserBloc(a.client, a.bienvenue, 13, 2);
    await dodo(1800);
    ok(mtime(f) > m1, 'SPEC-ARCHI-012 : une nouvelle mutation est de nouveau écrite à la cadence suivante');
    const contenu = JSON.parse(fs.readFileSync(f, 'utf8'));
    ok(contenu.overrides.some(o => o[3] === 13), 'SPEC-ARCHI-012 : et le fichier contient la seconde mutation');
    await s.arreter();
  } finally { supprimerDossier(dossier); }
}

(async function () {
  try {
    const tous = { evenements: scenarioEvenements, reconnexion: scenarioReconnexionEtArret, reseau: scenarioReseauOuvert, cadence: scenarioCadence45, omission: scenarioOmission };
    const choix = process.argv[2] ? [process.argv[2]] : Object.keys(tous);
    await Promise.all(choix.map(k => tous[k]()));
  } catch (e) {
    R.ok(false, 'exception non prévue', (e && e.stack) || String(e));
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
  }
  process.exit(R.fin());
})();
