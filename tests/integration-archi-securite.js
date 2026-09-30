/* integration-archi-securite.js — durcissement du serveur local (revue
   adversariale du lot A0) : une connexion n'est « locale » — donc habilitée à
   RESEAU, ARRET et PAUSE — que si son adresse, son Host ET son Origin le sont ;
   les parties ne se servent jamais en statique ; le mode ouvert refuse aussi les
   Host étrangers sur l'API ; un serveur dédié (--serveur) reste ouvert.
   SPEC-ARCHI-003, 005, 008, 013. Usage : node tests/integration-archi-securite.js */
'use strict';
const path = require('path');
const fs = require('fs');
const A = require('./aide-integration-archi.js');
const { dodo, connecter, requete, lancer, rejoindre, dossierTemp, supprimerDossier, RACINE } = A;
const R = A.creerRapport('Intégration ARCHI — durcissement : connexion locale, fichiers privés, serveur dédié');
const { ok, eq } = R;

const serveurs = [];
async function demarrer(args, env) { const s = await lancer(args, env); serveurs.push(s); return s; }
const api = (port, ent) => requete(port, '/api/parties', { entetes: ent || {} });

// Une page tierce ouverte dans le navigateur de l'hôte arrive de 127.0.0.1 : elle ne doit PAS pouvoir arrêter le jeu
async function scenarioPageTierce() {
  const d = dossierTemp('mc-archi-sec1-');
  try {
    const s = await demarrer(['--port', '0', '--ouvert', '--dossier-parties', d]);
    const P = s.port;
    const attaques = [
      ['Origin http://evil.example', { origine: 'http://evil.example' }],
      ['Host evil.example', { hoteHttp: 'evil.example:' + P }],
      ['X-Forwarded-For (mandataire inverse local)', { entetes: { 'X-Forwarded-For': '203.0.113.7' } }],
    ];
    for (const [nom, opts] of attaques) {
      const c = await connecter(P, opts).then(x => x, () => null);
      if (!c) { ok(true, 'SPEC-ARCHI-005 : ' + nom + ' → poignée de main refusée'); continue; }
      c.envoyer({ t: 'reseau', ouvert: false });
      c.envoyer({ t: 'pause', actif: true });
      c.envoyer({ t: 'arret' });
      await dodo(700);
      ok(s.vivant, 'SPEC-ARCHI-008 : ' + nom + ' → ARRET ignoré, le serveur vit');
      eq((await api(P)).json.reseau, 'ouvert', 'SPEC-ARCHI-005 : ' + nom + ' → RESEAU {ouvert:false} ignoré');
      ok(c.messages.every(m => m.t !== 'reseau_etat'), 'SPEC-ARCHI-005 : ' + nom + ' → aucune réponse RESEAU_ETAT');
      c.fermer();
    }
    // témoin : la même commande, d'un client local sans Origin, est bien obéie
    const local = await rejoindre(P, 'Alice', 1);
    local.client.envoyer({ t: 'reseau', ouvert: false });
    const e = await local.client.attendre('reseau_etat', 4000, m => m.etat === 'ferme').catch(() => null);
    ok(!!e, 'témoin : un client local sans Origin ferme bien le réseau');
    // Origin locale autorisée
    local.client.fermer();
    await A.attendreClients(P, 0);
    await s.arreter();
  } finally { supprimerDossier(d); }
}

async function scenarioDedie() {
  const d = dossierTemp('mc-archi-sec2-');
  try {
    const s = await demarrer(['--port', '0', '--serveur', '--dossier-parties', d], { MC_GRACE_ARRET_MS: '700' });
    const a = await rejoindre(s.port, 'Alice', 1);
    a.client.envoyer({ t: 'reseau', ouvert: false });
    await dodo(600);
    eq((await api(s.port)).json.reseau, 'ouvert', 'un serveur dédié (--serveur) ignore RESEAU {ouvert:false}');
    a.client.fermer();
    await A.attendreClients(s.port, 0);
    await dodo(2000);
    ok(s.vivant, 'un serveur dédié ne s\'arrête pas tout seul quand le dernier joueur part');
    await s.arreter();
  } finally { supprimerDossier(d); }
}

async function scenarioFichiersPrives() {
  const dedans = path.join(RACINE, '.parties-test-' + process.pid);
  const d = dossierTemp('mc-archi-sec3-');
  try {
    for (const mode of [[], ['--ouvert']]) {
      for (const dossier of [d, dedans]) {
        const s = await demarrer(['--port', '0', '--dossier-parties', dossier].concat(mode));
        const P = s.port;
        const cree = await requete(P, '/api/parties', { corps: { nom: 'Secret', graine: 5 } });
        const id = cree.json.partie.id;
        const rel = path.relative(RACINE, dossier).replace(/\\/g, '/');
        const chemins = ['/parties/index.json', '/parties/' + id + '.json'];
        if (!rel.startsWith('..')) chemins.push('/' + rel + '/index.json');
        for (const c of chemins) {
          const r = await requete(P, c);
          ok(r.code === 403 || r.code === 404, `SPEC-ARCHI-013 (${mode[0] || 'fermé'}, ${rel.startsWith('..') ? 'dossier externe' : 'dossier dans le dépôt'}) : GET ${c} refusé`, 'code ' + r.code + ' ' + r.corps.slice(0, 60));
        }
        // index.html reste servi
        eq((await requete(P, '/index.html')).code, 200, 'le jeu reste servi');
        // Host étranger : refusé sur l'API dans les deux modes, sur tout le HTTP en fermé
        eq((await api(P, { Host: 'evil.example:' + P })).code, 403, `SPEC-ARCHI-003 (${mode[0] || 'fermé'}) : API avec Host étranger → 403`);
        if (!mode.length) eq((await requete(P, '/index.html', { entetes: { Host: 'evil.example' } })).code, 403, 'SPEC-ARCHI-003 (fermé) : tout le HTTP exige un Host local (rebond DNS)');
        await s.arreter();
      }
    }
  } finally { supprimerDossier(d); supprimerDossier(dedans); }
}

(async function () {
  try {
    await scenarioPageTierce();
    await scenarioDedie();
    await scenarioFichiersPrives();
  } catch (e) { R.ok(false, 'exception non prévue', (e && e.stack) || String(e)); }
  finally { for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } } }
  process.exit(R.fin());
})();
