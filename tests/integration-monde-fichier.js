/* integration-monde-fichier.js — consolidation L40-bis (lot A) : le fichier
   de monde du serveur, sur de vrais processus server.js.

   - SPEC-SAVE-018 : chaque champ du fichier qu'écrit le vrai serveur (joueur
     nommé, coffre et fourneau posés, récit en mode histoire) est classé dans
     MC.Save.CHAMPS_IDS_MONDE ;
   - SPEC-SAVE-026 : un fichier refusé (version inconnue, JSON illisible,
     reprise qui lève au milieu) est mis de côté octet pour octet sous
     `<fichier>.refuse-<horodatage>`, le journal cite ce nom, et la nouvelle
     carte — qui ne garde rien du fichier refusé — se sauvegarde sous le nom
     d'origine ; un renommage impossible interdit toute écriture (« Sauvegarder »
     → 409 ecriture_interdite) ; une erreur de lecture (dossier) arrête le
     serveur sans rien renommer ;
   - SPEC-SAVE-017 : un monde v1, écrit avant les blocs 16 bits, est repris sans perte
     et réécrit dans le format actuel ;
   - SPEC-SAVE-028 : un override d'id de bloc inconnu (3999) traverse un
     chargement et une sauvegarde du serveur sans être perdu.

   Chaque scénario lance PUIS arrête son serveur (aucun orphelin).
   Usage : node tests/integration-monde-fichier.js */
'use strict';
const path = require('path');
const fs = require('fs');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre, requete, dossierTemp, supprimerDossier, chargerModules } = A;
const R = A.creerRapport('Intégration — fichier de monde du serveur (SPEC-SAVE-017, 018, 026, 028)');
const { ok, eq } = R;
const MC = chargerModules();

const serveurs = [];
async function demarrer(args, env) { const s = await lancer(args, env); serveurs.push(s); return s; }
// sauvegarde forcée : la demande de la boucle locale (SPEC-ARCHI-036), qui répond une fois l'écriture faite
async function sauver(s) {
  for (let k = 0; k < 5; k++) {
    const r = await requete(s.port, '/api/parties/sauver', { corps: {} });
    if (r.code === 429) { await dodo(1100); continue; }
    return r;
  }
  return { code: 0 };
}
const lire = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const refuses = (dossier) => fs.readdirSync(dossier).filter(n => /^monde\.json\.refuse-/.test(n));

// ── SPEC-SAVE-018 : le fichier réellement écrit est entièrement classé ───────
async function scenarioClassement() {
  const dossier = dossierTemp('mc-monde-018-');
  const f = path.join(dossier, 'monde.json');
  try {
    const s = await demarrer(['--port', '0', '--monde', f, '--dossier-parties', dossier], { MC_SAUVEGARDE_MS: '600000' });
    const a = await rejoindre(s.port, 'Alice', 1);
    // un coffre et un fourneau posés (MC_TEST_POSE_LIBRE) puis ouverts : le fichier porte alors des conteneurs
    const moi = a.bienvenue.toi[0];
    const bx = Math.floor(moi.x), by = Math.floor(moi.y) + 1, bz = Math.floor(moi.z);
    for (const [dx, id] of [[2, MC.Core.B.CHEST], [-2, MC.Core.B.FURNACE]]) {
      a.client.envoyer({ t: 'bloc', x: bx + dx, y: by, z: bz, id, j: 0, i: 0 });
      await a.client.attendre('bloc', 3000, m => m.x === bx + dx && m.y === by && m.z === bz).catch(() => null);
      a.client.envoyer({ t: 'cont_ouvrir', x: bx + dx, y: by, z: bz, j: 0 });
      await dodo(250);
    }
    const r = await sauver(s);
    eq(r.code, 200, 'SPEC-SAVE-018 : sauvegarde forcée acceptée');
    const data = lire(f);
    ok(Array.isArray(data.joueurs) && data.joueurs.length >= 1, 'SPEC-SAVE-018 : le fichier porte le joueur nommé', JSON.stringify(data.joueurs).slice(0, 120));
    const types = (data.conteneurs || []).map(c => c.type).sort();
    ok(types.indexOf('chest') >= 0 && types.indexOf('furnace') >= 0, 'SPEC-SAVE-018 : le fichier porte un coffre et un fourneau posés', JSON.stringify(types));
    const manquants = MC.Save.champsMondeNonClasses(data);
    ok(manquants.length === 0, 'SPEC-SAVE-018 : chaque champ du fichier de monde écrit par le serveur est classé (joueur et conteneurs compris)', 'non classés : ' + manquants.join(', '));
    a.client.fermer();
    await s.arreter();
  } finally { supprimerDossier(dossier); }
}

// ── SPEC-SAVE-018 : idem en mode histoire (récits des joueurs dans le fichier) ─
async function scenarioClassementHistoire() {
  const dossier = dossierTemp('mc-monde-018h-');
  const f = path.join(dossier, 'monde.json');
  try {
    const s = await demarrer(['--port', '0', '--monde', f, '--dossier-parties', dossier], {
      MC_SAUVEGARDE_MS: '600000', MC_MODE: 'histoire',
      MC_HISTOIRE: JSON.stringify({ archetype: 'epopee', heros: 'Alice', longueur: 'courte', interactions: { preset: 'libre' } }),
    });
    const a = await rejoindre(s.port, 'Alice', 1);
    await a.client.attendre('histoire_etat', 15000).catch(() => null);
    eq((await sauver(s)).code, 200, 'SPEC-SAVE-018 (histoire) : sauvegarde forcée acceptée');
    const data = lire(f);
    ok(data.histoire && Array.isArray(data.histoire.recits) && data.histoire.recits.length >= 1,
      'SPEC-SAVE-018 (histoire) : le fichier porte le récit du joueur', JSON.stringify(data.histoire).slice(0, 160));
    const manquants = MC.Save.champsMondeNonClasses(data);
    ok(manquants.length === 0, 'SPEC-SAVE-018 (histoire) : chaque champ du fichier écrit en mode histoire est classé', 'non classés : ' + manquants.join(', '));
    a.client.fermer();
    await s.arreter();
  } finally { supprimerDossier(dossier); }
}

// ── SPEC-SAVE-026 : une reprise qui lève au milieu ne laisse rien du fichier ──
async function scenarioRepriseInterrompue() {
  const dossier = dossierTemp('mc-monde-026r-');
  const f = path.join(dossier, 'monde.json');
  try {
    // heure et overrides sont appliqués, puis `crops: [null]` lève (c[0] sur null)
    fs.writeFileSync(f, JSON.stringify({ v: 2, graine: 1234, heure: 777, overrides: [[3, 100, 3, 1]], crops: [null] }));
    const original = fs.readFileSync(f);
    const s = await demarrer(['--port', '0', '--monde', f, '--dossier-parties', dossier, '--graine', '1234'], { MC_SAUVEGARDE_MS: '600000' });
    ok(!s.logs.some(l => /monde repris/.test(l)), 'SPEC-SAVE-026 (reprise interrompue) : le démarrage ne dit pas « monde repris »');
    const mis = refuses(dossier);
    ok(mis.length === 1 && Buffer.compare(fs.readFileSync(path.join(dossier, mis[0])), original) === 0,
      'SPEC-SAVE-026 (reprise interrompue) : le fichier est mis de côté octet pour octet');
    eq((await sauver(s)).code, 200, 'SPEC-SAVE-026 (reprise interrompue) : sauvegarde forcée acceptée');
    const neuf = lire(f);
    ok(neuf.heure < 700, 'SPEC-SAVE-026 (reprise interrompue) : la nouvelle carte n\'a pas l\'heure du fichier refusé', 'heure = ' + neuf.heure);
    ok(!neuf.overrides.some(o => o[0] === 3 && o[1] === 100 && o[2] === 3), 'SPEC-SAVE-026 (reprise interrompue) : ni son bloc posé');
    ok(Array.isArray(neuf.crops) && neuf.crops.length === 0, 'SPEC-SAVE-026 (reprise interrompue) : ni ses cultures');
    await s.arreter();
    // redémarrage sur le fichier neuf : il est repris, et ne contient toujours rien du fichier refusé
    const s2 = await demarrer(['--port', '0', '--monde', f, '--dossier-parties', dossier, '--graine', '1234'], { MC_SAUVEGARDE_MS: '600000' });
    const a = await rejoindre(s2.port, 'Alice', 1);
    ok(a.bienvenue.heure < 700, 'SPEC-SAVE-026 (reprise interrompue) : au redémarrage, l\'heure n\'est pas celle du fichier refusé', 'heure = ' + a.bienvenue.heure);
    a.client.envoyer({ t: 'overrides_demande', cx: 0, cz: 0 });
    const oc = await a.client.attendre('overrides_chunk', 3000, m => m.cx === 0 && m.cz === 0).catch(() => ({ blocs: [] }));
    ok(!(oc.blocs || []).some(o => o[0] === 3 && o[1] === 100 && o[2] === 3), 'SPEC-SAVE-026 (reprise interrompue) : au redémarrage, aucun bloc hérité du fichier refusé');
    a.client.fermer();
    await s2.arreter();
  } finally { supprimerDossier(dossier); }
}

// ── SPEC-SAVE-026 : renommage impossible → plus aucune écriture, et on le dit ─
async function scenarioRenommageImpossible() {
  const dossier = dossierTemp('mc-monde-026e-');
  const f = path.join(dossier, 'monde.json');
  try {
    fs.writeFileSync(f, '{ "v": 99 }');
    const original = fs.readFileSync(f);
    const s = await demarrer(['--port', '0', '--monde', f, '--dossier-parties', dossier], { MC_SAUVEGARDE_MS: '600000', MC_TEST_ECHEC_RENOMMAGE: '1' });
    ok(s.logs.some(l => /E-SAVE-007/.test(l)), 'SPEC-SAVE-026 (renommage impossible) : le journal le signale (E-SAVE-007)', s.logs.slice(-6).join(' | '));
    const r = await sauver(s);
    eq(r.code, 409, 'SPEC-SAVE-026 (renommage impossible) : « Sauvegarder » est refusé (409)');
    eq(r.json && r.json.motif, 'ecriture_interdite', 'SPEC-SAVE-026 (renommage impossible) : motif ecriture_interdite');
    await s.arreter();
    ok(Buffer.compare(fs.readFileSync(f), original) === 0, 'SPEC-SAVE-026 (renommage impossible) : le fichier refusé n\'est jamais écrasé, même à l\'arrêt');
    eq(refuses(dossier).length, 0, 'SPEC-SAVE-026 (renommage impossible) : rien n\'est mis de côté');
  } finally { supprimerDossier(dossier); }
}

// ── SPEC-SAVE-026 : une erreur d'entrée/sortie n'est pas un refus de contenu ──
function scenarioDossier() {
  const dossier = dossierTemp('mc-monde-026d-');
  const f = path.join(dossier, 'monde.json');
  fs.mkdirSync(f);                                          // --monde désigne un DOSSIER de l'utilisateur
  fs.writeFileSync(path.join(f, 'a-moi.txt'), 'précieux');
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const p = spawn(process.execPath, [path.join(A.RACINE, 'server.js'), '--port', '0', '--monde', f, '--dossier-parties', dossier],
      { cwd: A.RACINE, stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, { MC_SAUVEGARDE_MS: '600000' }) });
    let sortie = '';
    p.stdout.on('data', d => { sortie += d; }); p.stderr.on('data', d => { sortie += d; });
    const minuterie = setTimeout(() => { try { p.kill(); } catch (e) { /* déjà parti */ } }, 20000);
    p.on('exit', (code) => {
      clearTimeout(minuterie);
      try {
        ok(code !== 0 && code !== null, 'SPEC-SAVE-026 (dossier) : le serveur s\'arrête au lieu de démarrer', 'code ' + code);
        ok(/impossible de lire le fichier de monde .*EISDIR/.test(sortie), 'SPEC-SAVE-026 (dossier) : avec un message clair (code E-SERV-006 au journal)', sortie.slice(-300));
        ok(fs.existsSync(f) && fs.statSync(f).isDirectory() && fs.readFileSync(path.join(f, 'a-moi.txt'), 'utf8') === 'précieux',
          'SPEC-SAVE-026 (dossier) : le dossier de l\'utilisateur n\'est ni déplacé ni modifié');
        eq(refuses(dossier).length, 0, 'SPEC-SAVE-026 (dossier) : rien n\'est renommé');
      } finally { supprimerDossier(dossier); resolve(); }
    });
  });
}

// ── SPEC-SAVE-026 : un monde refusé n'est jamais écrasé ──────────────────────
async function scenarioRefus(contenu, libelle) {
  const dossier = dossierTemp('mc-monde-026-');
  const f = path.join(dossier, 'monde.json');
  try {
    fs.writeFileSync(f, contenu);
    const original = fs.readFileSync(f);
    const s = await demarrer(['--port', '0', '--monde', f, '--dossier-parties', dossier], { MC_SAUVEGARDE_MS: '600000' });
    const mis = refuses(dossier);
    eq(mis.length, 1, `SPEC-SAVE-026 (${libelle}) : le fichier refusé est renommé « monde.json.refuse-<horodatage> » au démarrage`);
    const r = await sauver(s);
    eq(r.code, 200, `SPEC-SAVE-026 (${libelle}) : sauvegarde forcée acceptée`);
    const apres = refuses(dossier);
    ok(apres.length === 1 && apres[0] === mis[0], `SPEC-SAVE-026 (${libelle}) : la sauvegarde ne touche pas au fichier mis de côté`);
    if (apres.length) {
      ok(Buffer.compare(fs.readFileSync(path.join(dossier, apres[0])), original) === 0,
        `SPEC-SAVE-026 (${libelle}) : le fichier refusé est conservé octet pour octet`);
      ok(s.logs.some(l => l.indexOf(apres[0]) >= 0), `SPEC-SAVE-026 (${libelle}) : le journal cite son nouveau nom`,
        s.logs.filter(l => /refus|illisible|version/.test(l)).join(' | ').slice(0, 300));
    }
    let nouvelle = null;
    try { nouvelle = lire(f); } catch (e) { /* absent ou illisible */ }
    ok(nouvelle && nouvelle.v === 2 && Array.isArray(nouvelle.overrides),
      `SPEC-SAVE-026 (${libelle}) : le fichier d'origine contient la nouvelle carte`, nouvelle ? 'v = ' + nouvelle.v : 'absent');
    await s.arreter();
    eq(refuses(dossier).length, 1, `SPEC-SAVE-026 (${libelle}) : l'arrêt (sauvegarde finale) ne l'écrase pas non plus`);
  } finally { supprimerDossier(dossier); }
}

// ── SPEC-SAVE-028 : un id de bloc inconnu survit au serveur ──────────────────
async function scenarioIdInconnu() {
  const dossier = dossierTemp('mc-monde-028-');
  const f = path.join(dossier, 'monde.json');
  try {
    fs.writeFileSync(f, JSON.stringify({ v: 2, graine: 1234, heure: 60, overrides: [[5, 120, 5, 3999], [6, 120, 5, MC.Core.B.STONE]], etats: [], crops: [] }));
    const s = await demarrer(['--port', '0', '--monde', f, '--dossier-parties', dossier, '--graine', '1234'], { MC_SAUVEGARDE_MS: '600000' });
    ok(s.logs.some(l => /monde repris/.test(l)), 'SPEC-SAVE-028 : le monde portant un id inconnu est repris, pas refusé', s.logs.slice(-5).join(' | '));
    eq(refuses(dossier).length, 0, 'SPEC-SAVE-028 : rien n\'est mis de côté');
    const a = await rejoindre(s.port, 'Alice', 1);
    a.client.envoyer({ t: 'overrides_demande', cx: 0, cz: 0 });
    const oc = await a.client.attendre('overrides_chunk', 3000, m => m.cx === 0 && m.cz === 0);
    const b = (oc.blocs || []).find(o => o[0] === 5 && o[1] === 120 && o[2] === 5);
    ok(b && b[3] === 3999, 'SPEC-SAVE-028 : le serveur transmet le bloc 3999 tel quel aux clients', JSON.stringify(b));
    // la première sauvegarde n'est jamais omise (aucune empreinte précédente)
    eq((await sauver(s)).code, 200, 'SPEC-SAVE-028 : sauvegarde forcée acceptée');
    const data = lire(f);
    ok(data.overrides.some(o => o[0] === 5 && o[1] === 120 && o[2] === 5 && o[3] === 3999),
      'SPEC-SAVE-028 : après sauvegarde, l\'override 3999 est toujours dans le fichier de monde');
    a.client.fermer();
    await s.arreter();
  } finally { supprimerDossier(dossier); }
}

// ── SPEC-SAVE-017 : un monde serveur écrit AVANT les blocs 16 bits (v1) est repris sans perte ──
async function scenarioMonde8Bits() {
  const dossier = dossierTemp('mc-monde-017-');
  const f = path.join(dossier, 'monde.json');
  try {
    // exactement la forme qu'écrivait le serveur d'avant 9f92f99 : v 1, overrides [x, y, z, id] (ids de bloc
    // 8 bits seulement), cultures, aucune clé `etats` ; ni joueur ni inventaire (rien à renuméroter)
    const B = MC.Core.B;
    fs.writeFileSync(f, JSON.stringify({
      v: 1, graine: 1234, heure: 321.5,
      overrides: [[5, 120, 5, B.COBBLE], [6, 120, 5, B.PLANKS], [7, 120, 5, 0]],
      crops: [[8, 120, 5, 4.25]], donjons: ['0,0'], pilles: [], pnjsMorts: [],
    }));
    const s = await demarrer(['--port', '0', '--monde', f, '--dossier-parties', dossier, '--graine', '1234'], { MC_SAUVEGARDE_MS: '600000' });
    ok(s.logs.some(l => /monde repris/.test(l)), 'SPEC-SAVE-017 : le monde v1 (8 bits) est repris, pas refusé', s.logs.slice(-5).join(' | '));
    eq(refuses(dossier).length, 0, 'SPEC-SAVE-017 : rien n\'est mis de côté');
    const a = await rejoindre(s.port, 'Alice', 1);
    ok(a.bienvenue.heure >= 321 && a.bienvenue.heure < 700, 'SPEC-SAVE-017 : l\'heure du monde v1 est reprise', 'heure = ' + a.bienvenue.heure);
    a.client.envoyer({ t: 'overrides_demande', cx: 0, cz: 0 });
    const oc = await a.client.attendre('overrides_chunk', 3000, m => m.cx === 0 && m.cz === 0);
    const bloc = (x) => (oc.blocs || []).find(o => o[0] === x && o[1] === 120 && o[2] === 5);
    ok(bloc(5) && bloc(5)[3] === B.COBBLE && bloc(6) && bloc(6)[3] === B.PLANKS,
      'SPEC-SAVE-017 : les blocs posés avant les 16 bits sont servis aux clients avec leur id d\'origine', JSON.stringify(oc.blocs));
    ok(!bloc(5)[4], 'SPEC-SAVE-017 : sans état particulier (état 0)', JSON.stringify(bloc(5)));
    eq((await sauver(s)).code, 200, 'SPEC-SAVE-017 : sauvegarde forcée acceptée');
    const data = lire(f);
    eq(data.v, 2, 'SPEC-SAVE-017 : le fichier est réécrit dans le format actuel (v 2)');
    ok(data.overrides.some(o => o[0] === 5 && o[1] === 120 && o[2] === 5 && o[3] === B.COBBLE) &&
       data.overrides.some(o => o[0] === 6 && o[1] === 120 && o[2] === 5 && o[3] === B.PLANKS),
      'SPEC-SAVE-017 : les blocs posés sont toujours dans le fichier réécrit', JSON.stringify(data.overrides).slice(0, 200));
    ok((data.crops || []).some(c => c[0] === 8 && c[1] === 120 && c[2] === 5), 'SPEC-SAVE-017 : la culture est toujours dans le fichier réécrit');
    ok((data.donjons || []).indexOf('0,0') >= 0, 'SPEC-SAVE-017 : le donjon déjà vaincu l\'est toujours');
    a.client.fermer();
    await s.arreter();
    // et le fichier réécrit se relit au démarrage suivant
    const s2 = await demarrer(['--port', '0', '--monde', f, '--dossier-parties', dossier, '--graine', '1234'], { MC_SAUVEGARDE_MS: '600000' });
    ok(s2.logs.some(l => /monde repris/.test(l)), 'SPEC-SAVE-017 : le fichier réécrit est repris au démarrage suivant');
    await s2.arreter();
  } finally { supprimerDossier(dossier); }
}

(async () => {
  let code = 1;
  try {
    await scenarioClassement();
    await scenarioClassementHistoire();
    await scenarioRefus('{ "v": 99 }', 'version 99');
    await scenarioRefus('{"v":2,"graine":', 'JSON illisible');
    await scenarioRepriseInterrompue();
    await scenarioRenommageImpossible();
    await scenarioDossier();
    await scenarioIdInconnu();
    await scenarioMonde8Bits();
  } catch (e) {
    ok(false, 'exception', e && e.stack);
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
    code = R.fin();
  }
  process.exit(code);
})();
