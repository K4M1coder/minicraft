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

/* Requête HTTP BRUTE (socket TCP) : le client http de Node normalise ou refuse
   certains chemins (espaces, antislashs…) ; un attaquant, lui, envoie les octets
   qu'il veut. `hote` : adresse jointe (défaut 127.0.0.1). Résout { code, entetes,
   corps } (code 0 si la connexion est coupée). */
function brute(port, chemin, entetes, methode, corps, hote) {
  return new Promise((resolve) => {
    const net = require('net');
    const s = net.connect({ host: hote || '127.0.0.1', port });
    let recu = Buffer.alloc(0), fini = false;
    const finir = () => {
      if (fini) return; fini = true; clearTimeout(t);
      const txt = recu.toString('utf8');
      const m = /^HTTP\/1\.[01] (\d{3})/.exec(txt);
      const sep = txt.indexOf('\r\n\r\n');
      resolve({ code: m ? parseInt(m[1], 10) : 0, entetes: sep >= 0 ? txt.slice(0, sep) : txt, corps: sep >= 0 ? txt.slice(sep + 4) : '' });
    };
    const t = setTimeout(() => { s.destroy(); finir(); }, 20000);
    s.on('connect', () => {
      const h = Object.assign({ Host: '127.0.0.1:' + port, Connection: 'close' }, entetes || {});
      const lignes = [(methode || 'GET') + ' ' + chemin + ' HTTP/1.1'];
      Object.keys(h).forEach(k => lignes.push(k + ': ' + h[k]));
      if (corps !== undefined) lignes.push('Content-Type: application/json', 'Content-Length: ' + Buffer.byteLength(corps));
      s.write(lignes.join('\r\n') + '\r\n\r\n' + (corps !== undefined ? corps : ''), 'latin1');
    });
    s.on('data', (d) => { recu = Buffer.concat([recu, d]); });
    s.on('end', finir); s.on('close', finir); s.on('error', finir);
  });
}

/* Racine statique de test (MC_TEST_RACINE_STATIQUE) : une copie minimale du jeu
   et du banc dans un dossier TEMPORAIRE, où l'on pose les leurres (.git, dossier
   caché, journaux, .claude, node_modules, sources du serveur…) — jamais dans le
   dépôt. Les copies laissées par un essai interrompu sont retirées au départ ;
   celle-ci l'est à la sortie, même sur Ctrl+C ou délai dépassé. */
const PREFIXE_RACINE = 'mc-archi-racine-';
function nettoyerRacinesPerimees() {
  const tmp = require('os').tmpdir();
  for (const n of fs.readdirSync(tmp)) {
    if (n.indexOf(PREFIXE_RACINE) !== 0) continue;
    const pid = parseInt(n.slice(PREFIXE_RACINE.length), 10);
    let vivant = false;
    try { process.kill(pid, 0); vivant = pid !== process.pid; } catch (e) { vivant = e.code === 'EPERM'; }
    if (!vivant) supprimerDossier(path.join(tmp, n));
  }
}
function preparerRacine(MARQUE) {
  nettoyerRacinesPerimees();
  const racine = path.join(require('os').tmpdir(), PREFIXE_RACINE + process.pid + '-' + Date.now());
  const retirer = () => supprimerDossier(racine);
  process.on('exit', retirer);
  ['SIGINT', 'SIGTERM'].forEach(sig => process.once(sig, () => { retirer(); process.exit(130); }));
  const poser = (rel, contenu) => { const abs = path.join(racine, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, contenu); };
  const copier = (rel) => poser(rel, fs.readFileSync(path.join(RACINE, rel)));
  ['index.html', 'admin.html', 'SPECS.md', 'server.js', 'README.md', 'PLAN.md', 'CHANGELOG.md', '.gitignore', '.gitattributes',
    '.githooks/pre-commit', 'tools/paquet.js', 'docs/charge.md', 'tests/registre/impact.json', 'tests/donnees/ids.json'].forEach(copier);
  fs.readdirSync(path.join(RACINE, 'src')).forEach(f => copier('src/' + f));
  fs.readdirSync(path.join(RACINE, 'tests')).filter(f => /\.(js|html|css)$/.test(f)).forEach(f => copier('tests/' + f));
  // les leurres : un dépôt git complet, un dossier caché, des journaux, des réglages, des dépendances, des parties
  poser('.git/HEAD', 'ref: refs/heads/' + MARQUE + '\n');
  poser('.git/config', '[core]\n\tsecret = ' + MARQUE + '\n');
  poser('.piege/HEAD', 'ref: refs/heads/' + MARQUE + '\n');
  poser('.piege/config', '[core]\n\tsecret = ' + MARQUE + '\n');
  poser('logs/piege.log', MARQUE);
  poser('.claude/piege.json', JSON.stringify({ secret: MARQUE }));
  poser('node_modules/piege/index.js', '// ' + MARQUE);
  poser('parties/index.json', JSON.stringify({ secret: MARQUE }));
  return { racine, retirer };
}

/* SPEC-NET-020 (revue de sécurité) : le serveur ne sert en statique QUE les
   ressources du jeu (index.html, admin.html, src/*.js|css), en lecture seule
   (GET/HEAD) — jamais le dépôt (.git, fichiers cachés, outils, journaux,
   parties, cahiers, sources du serveur), dans AUCUN mode, quel que soit
   l'encodage du chemin (pour-cent, double encodage, antislash Windows, casse,
   flux NTFS « ::$DATA », noms courts 8.3, point ou espace final).
   SPEC-BANC-015/122 : les routes du banc (/tests/*, et SPECS.md qu'il relit)
   n'existent qu'avec --tests ET pour une requête locale (refusRequeteLocale) ;
   sans --tests, la machine locale lit pourquoi, une requête non locale
   n'apprend rien (404 nu). */
async function scenarioCheminsPieges() {
  const MARQUE = 'piege-secret-' + process.pid;
  const { racine, retirer } = preparerRacine(MARQUE);
  const env = { MC_TEST_RACINE_STATIQUE: racine };
  const nomRacine = path.basename(racine);
  const pieges = [
    // le dépôt git (un dossier, comme dans un clone)
    '/.git', '/.git/HEAD', '/.git/config', '/%2egit/HEAD', '/%2Egit/config', '/%2e%2egit/HEAD', '/..%2f.git/config', '/src/../.git/HEAD',
    '/src/%2e%2e/.git/HEAD', '/%252e%252e%252f.git/HEAD', '/%252egit/HEAD', '/src\\..\\.git\\HEAD', '/src%5c..%5c.git%5cHEAD',
    '/.GIT/HEAD', '/.Git/config', '/.git/HEAD::$DATA', '/.git::$INDEX_ALLOCATION/HEAD', '/GIT~1/HEAD', '/.git./HEAD', '/.git%20/HEAD',
    '/.git /HEAD', '/.git%00/HEAD', '/.git/HEAD.', '/.git/HEAD%20',
    '/..%2f' + nomRacine + '/.git/HEAD', '/..%5c' + nomRacine + '%5c.git%5cHEAD',
    // un autre dossier caché
    '/.piege/HEAD', '/%2epiege/HEAD', '/.PIEGE/HEAD', '/.piege./config', '/PIEGE~1/HEAD', '/src\\..\\.piege\\HEAD',
    '/tests/../.git/HEAD', '/tests/%2e%2e/.git/HEAD', '/tests\\..\\.git\\HEAD', '/tests/donnees/../../.git/HEAD',
    // le reste du dossier du serveur : jamais des ressources du jeu
    '/logs/piege.log', '/.claude/piege.json', '/node_modules/piege/index.js', '/parties/index.json',
    '/server.js', '/README.md', '/PLAN.md', '/CHANGELOG.md', '/.gitignore', '/.gitattributes', '/.githooks/pre-commit',
    '/tools/paquet.js', '/docs/charge.md', '/tests/registre/impact.json', '/tests/run.js/', '/src/../server.js', '/src%2f..%2fserver.js',
    '//server.js', '/./server.js', '/tests/index.html::$DATA', '/tests/donnees/../../server.js',
    // casse et suffixes que Windows ignore, sur des ressources pourtant légitimes
    '/SRC/core.js', '/INDEX.HTML', '/index.html::$DATA', '/index.html.', '/index.html%20', '/src/core.js::$DATA', '/src/core.js.',
  ];
  const fuite = (r) => r.corps.indexOf(MARQUE) >= 0 || /gitdir:|ref: refs\/|\[core\]|'use strict'|MiniCraft/.test(r.corps);
  const imageRegistre = fs.readdirSync(path.join(RACINE, 'tests', 'registre', 'images')).find(f => /^[0-9a-f]{40}\.jpg$/.test(f));
  const routesBancGet = ['/tests', '/tests/', '/tests/index.html', '/tests/banc.css', '/tests/harness.js', '/tests/donnees/ids.json', '/SPECS.md',
    '/tests/version', '/tests/cahiers', '/tests/cahiers/api', '/tests/historique/lignes?rapide=tous&taille=1', '/tests/historique/series',
    '/tests/historique/tests', '/tests/historique/images?test=x', '/tests/historique/export?format=csv&colonnes=nom', '/tests/perimetre',
    '/tests/catalogue', '/tests/serveur-jeu/journal'].concat(imageRegistre ? ['/tests/registre/images/' + imageRegistre] : []);
  const routesBancPost = ['/tests/resultats', '/tests/serveur-histoire', '/tests/serveur-jeu', '/tests/serveur-jeu/arreter', '/tests/cahiers/x/conserver'];
  const fichiersJeu = ['/', '/index.html', '/admin.html'].concat(fs.readdirSync(path.join(RACINE, 'src')).filter(f => /\.(js|css)$/.test(f)).map(f => '/src/' + f));
  const fichiersBanc = ['/tests/', '/SPECS.md', '/tests/donnees/ids.json'].concat(fs.readdirSync(path.join(RACINE, 'tests')).filter(f => /\.(js|html|css)$/.test(f)).map(f => '/tests/' + f));
  const lan = A.adresseReseau();
  const DESACTIVE = 'node server.js --tests';
  try {
    const modes = [['fermé', []], ['--ouvert', ['--ouvert']], ['--serveur', ['--serveur']], ['--tests', ['--tests']],
      ['--serveur --tests', ['--serveur', '--tests']], ['--ouvert --tests', ['--ouvert', '--tests']]];
    for (const [nomMode, args] of modes) {
      const avecTests = args.indexOf('--tests') >= 0;
      const ouvert = args.indexOf('--ouvert') >= 0 || args.indexOf('--serveur') >= 0;
      const d = dossierTemp('mc-archi-sec4-');
      const s = await demarrer(['--port', '0', '--dossier-parties', d].concat(args), env);
      const port = s.port;
      try {
        // le jeu légitime reste servi en entier
        const ratesJeu = [];
        for (const f of fichiersJeu) { const r = await brute(port, f); if (r.code !== 200) ratesJeu.push(f + ' → ' + r.code); }
        ok(!ratesJeu.length, `SPEC-NET-019 (${nomMode}) : les ${fichiersJeu.length} ressources du jeu (index, admin, src/*.js|css) sont servies`, ratesJeu.join(', '));
        // … en lecture seule : toute autre méthode que GET/HEAD reçoit 405
        const methodes = [];
        for (const [m, c] of [['POST', '/index.html'], ['PUT', '/src/core.js'], ['DELETE', '/admin.html'], ['PATCH', '/'], ['POST', '/server.js']]) {
          const r = await brute(port, c, {}, m, '{}'); if (r.code !== 405) methodes.push(m + ' ' + c + ' → ' + r.code);
        }
        const tete = await brute(port, '/src/core.js', {}, 'HEAD');
        if (tete.code !== 200) methodes.push('HEAD /src/core.js → ' + tete.code);
        ok(!methodes.length, `SPEC-NET-020 (${nomMode}) : fichiers du jeu en lecture seule (GET/HEAD ; POST, PUT, DELETE, PATCH → 405)`, methodes.join(', '));
        // aucun chemin piégé ne sert quoi que ce soit
        const fuites = [];
        for (const c of pieges) {
          const r = await brute(port, c);
          if (r.code === 200 || r.code === 301 || fuite(r)) fuites.push(c + ' → ' + r.code + ' ' + JSON.stringify(r.corps.slice(0, 50)));
        }
        ok(!fuites.length, `SPEC-NET-020 (${nomMode}) : ${pieges.length} chemins piégés (.git, caché, encodé, antislash, casse, ::$DATA, 8.3, point/espace final) refusés`, fuites.join('\n    '));
        // le serveur n'a pas planté sous ces requêtes
        eq((await brute(port, '/index.html')).code, 200, `(${nomMode}) le serveur répond toujours après les chemins piégés`);
        if (!avecTests) {
          // sans --tests, les routes du banc N'EXISTENT PAS (rien ne s'exécute, rien ne se lit)
          const presentes = [];
          for (const c of routesBancGet) { const r = await brute(port, c); if (r.code !== 404) presentes.push('GET ' + c + ' → ' + r.code); }
          for (const c of routesBancPost) { const r = await brute(port, c, {}, 'POST', '{}'); if (r.code !== 404) presentes.push('POST ' + c + ' → ' + r.code); }
          ok(!presentes.length, `SPEC-BANC-122 (${nomMode}) : sans --tests, les ${routesBancGet.length + routesBancPost.length} routes du banc répondent 404`, presentes.join(', '));
          // la machine locale apprend pourquoi : une page pour une page, du JSON pour une route de données
          const page = await brute(port, '/tests/');
          const api = await brute(port, '/tests/cahiers/api');
          let jApi = null; try { jApi = JSON.parse(api.corps); } catch (e) { /* null */ }
          ok(page.code === 404 && /text\/html/i.test(page.entetes) && page.corps.indexOf(DESACTIVE) >= 0,
            `SPEC-BANC-122 (${nomMode}) : sans --tests, la page du banc demandée en local explique « relancez node server.js --tests » (HTML)`, page.code + ' ' + page.corps.slice(0, 120));
          ok(api.code === 404 && jApi && jApi.ok === false && String(jApi.motif).indexOf(DESACTIVE) >= 0,
            `SPEC-BANC-122 (${nomMode}) : sans --tests, une route de données du banc répond en JSON avec la même explication`, api.code + ' ' + api.corps.slice(0, 120));
          // une requête non locale n'apprend rien : 404 nu
          const nus = [];
          for (const c of ['/tests/', '/tests/cahiers/api', '/SPECS.md']) {
            const r = await brute(port, c, { Origin: 'http://evil.example' });
            if (r.code !== 404 || r.corps.indexOf('--tests') >= 0) nus.push('Origin étrangère ' + c + ' → ' + r.code + ' ' + r.corps.slice(0, 60));
            if (ouvert && lan) {
              const r2 = await brute(port, c, { Host: 'localhost:' + port }, 'GET', undefined, lan);
              if (r2.code !== 404 || r2.corps.indexOf('--tests') >= 0) nus.push(lan + ' ' + c + ' → ' + r2.code + ' ' + r2.corps.slice(0, 60));
            }
          }
          ok(!nus.length, `SPEC-BANC-122 (${nomMode}) : sans --tests, une requête non locale${ouvert && lan ? ' (Origin étrangère, adresse réseau ' + lan + ')' : ' (Origin étrangère)'} reçoit un 404 nu`, nus.join(', '));
        } else {
          // avec --tests : le banc local fonctionne…
          const ratesBanc = [];
          for (const f of fichiersBanc) { const r = await brute(port, f); if (r.code !== 200) ratesBanc.push(f + ' → ' + r.code); }
          for (const f of ['/tests/version', '/tests/cahiers/api', '/tests/historique/series'].concat(imageRegistre ? ['/tests/registre/images/' + imageRegistre] : [])) {
            const r = await brute(port, f); if (r.code !== 200) ratesBanc.push(f + ' → ' + r.code);
          }
          const redir = await brute(port, '/tests');
          if (redir.code !== 301) ratesBanc.push('/tests → ' + redir.code);
          ok(!ratesBanc.length, `SPEC-BANC-122 (${nomMode}) : avec --tests, le banc (${fichiersBanc.length} fichiers, version, cahiers, historique, images) est servi en local`, ratesBanc.join(', '));
          // … mais seulement pour une requête locale : Origin, Host étrangers, mandataire, intersites
          const etrangers = [['Origin étrangère', { Origin: 'http://evil.example' }], ['Host étranger', { Host: 'evil.example:' + port }],
            ['mandataire', { 'X-Forwarded-For': '203.0.113.7' }], ['intersites', { 'Sec-Fetch-Site': 'cross-site' }]];
          const acceptees = [];
          for (const [nom, ent] of etrangers) {
            for (const c of routesBancGet.concat(['/tests/run.js'])) { const r = await brute(port, c, ent); if (r.code !== 403) acceptees.push(nom + ' GET ' + c + ' → ' + r.code); }
            for (const c of routesBancPost) { const r = await brute(port, c, ent, 'POST', '{}'); if (r.code !== 403) acceptees.push(nom + ' POST ' + c + ' → ' + r.code); }
          }
          ok(!acceptees.length, `SPEC-BANC-122 (${nomMode}) : avec --tests, toute route du banc refuse (403) une requête non locale`, acceptees.join(', '));
          /* L'ADRESSE seule : la requête arrive par l'adresse réseau de la machine
             (comme d'un voisin), avec un Host local et sans Origin — seule la
             branche « adresse non locale » de refusRequeteLocale peut la refuser. */
          if (ouvert) {
            if (!lan) ok(true, `(${nomMode}) aucune adresse réseau non locale sur ce poste : refus par adresse non vérifié`);
            else {
              const par = [];
              for (const c of routesBancGet) {
                const r = await brute(port, c, { Host: 'localhost:' + port }, 'GET', undefined, lan);
                let j = null; try { j = JSON.parse(r.corps); } catch (e) { /* null */ }
                if (r.code !== 403 || !j || j.motif !== 'adresse non locale') par.push(c + ' → ' + r.code + ' ' + r.corps.slice(0, 60));
              }
              for (const c of routesBancPost) {
                const r = await brute(port, c, { Host: 'localhost:' + port }, 'POST', '{}', lan);
                if (r.code !== 403) par.push('POST ' + c + ' → ' + r.code);
              }
              const jeu = await brute(port, '/index.html', { Host: lan + ':' + port }, 'GET', undefined, lan);
              ok(!par.length && jeu.code === 200, `SPEC-BANC-122 (${nomMode}) : joint par l'adresse réseau ${lan}, le banc refuse (403 « adresse non locale ») et le jeu reste servi`, par.join(', ') + ' · jeu ' + jeu.code);
            }
          }
        }
      } finally { await s.arreter(); supprimerDossier(d); }
    }
  } finally { retirer(); }
}

(async function () {
  try {
    await scenarioCheminsPieges();
    await scenarioPageTierce();
    await scenarioDedie();
    await scenarioFichiersPrives();
  } catch (e) { R.ok(false, 'exception non prévue', (e && e.stack) || String(e)); }
  finally { for (const s of serveurs) { try { await s.arreter(); } catch (e) { /* déjà arrêté */ } } }
  process.exit(R.fin());
})();
