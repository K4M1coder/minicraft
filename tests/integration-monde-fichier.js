/* integration-monde-fichier.js — consolidation L40-bis (lot A) : le fichier
   de monde du serveur, sur de vrais processus server.js.

   - SPEC-SAVE-018 : chaque champ du fichier qu'écrit le vrai serveur (joueur
     nommé et conteneur posé compris) est classé dans MC.Save.CHAMPS_IDS_MONDE ;
   - SPEC-SAVE-026 : un fichier refusé (version inconnue, JSON illisible) est
     mis de côté octet pour octet sous `<fichier>.refuse-<horodatage>`, le
     journal cite ce nom, et la nouvelle carte se sauvegarde sous le nom
     d'origine — jamais par-dessus le fichier refusé ;
   - SPEC-SAVE-028 : un override d'id de bloc inconnu (3999) traverse un
     chargement et une sauvegarde du serveur sans être perdu.

   Chaque scénario lance PUIS arrête son serveur (aucun orphelin).
   Usage : node tests/integration-monde-fichier.js */
'use strict';
const path = require('path');
const fs = require('fs');
const A = require('./aide-integration-archi.js');
const { dodo, lancer, rejoindre, requete, dossierTemp, supprimerDossier, chargerModules } = A;
const R = A.creerRapport('Intégration — fichier de monde du serveur (SPEC-SAVE-018, 026, 028)');
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
    const r = await sauver(s);
    eq(r.code, 200, 'SPEC-SAVE-018 : sauvegarde forcée acceptée');
    const data = lire(f);
    ok(Array.isArray(data.joueurs) && data.joueurs.length >= 1, 'SPEC-SAVE-018 : le fichier porte le joueur nommé', JSON.stringify(data.joueurs).slice(0, 120));
    const manquants = MC.Save.champsMondeNonClasses(data);
    ok(manquants.length === 0, 'SPEC-SAVE-018 : chaque champ du fichier de monde écrit par le serveur est classé (porteur migré ou sans id)', 'non classés : ' + manquants.join(', '));
    a.client.fermer();
    await s.arreter();
  } finally { supprimerDossier(dossier); }
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

(async () => {
  let code = 1;
  try {
    await scenarioClassement();
    await scenarioRefus('{ "v": 99 }', 'version 99');
    await scenarioRefus('{"v":2,"graine":', 'JSON illisible');
    await scenarioIdInconnu();
  } catch (e) {
    ok(false, 'exception', e && e.stack);
  } finally {
    for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } }
    code = R.fin();
  }
  process.exit(code);
})();
