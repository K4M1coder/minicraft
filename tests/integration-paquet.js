/* integration-paquet.js — SPEC-PACK-001 : construit une archive réelle dans un
   dossier temporaire, puis démarre le serveur DEPUIS cette archive et vérifie
   qu'il sert vraiment le jeu. Complète le rôle de tools/paquet.js : ce n'est
   pas un module pur (fs, child_process), donc testé ici comme les autres
   tests d'intégration, en dehors du bac à sable de tests/run.js.

   Usage : node tests/integration-paquet.js [port] */
'use strict';
require('./journal-temp.js');   // journal des serveurs lancés : dossier temporaire (SPEC-BANC-106)
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const RACINE = path.join(__dirname, '..');
const PORT = parseInt(process.argv[2], 10) || 8389;

const C = { r: '\x1b[31m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
let passes = 0, echecs = 0;
const details = [];
function ok(cond, nom, info) {
  if (cond) { passes++; details.push(`  ${C.g}·${C.x} ${C.d}${nom}${C.x}`); }
  else { echecs++; details.push(`  ${C.r}✗ ${nom}${C.x}${info ? '\n    ' + C.r + info + C.x : ''}`); }
}

function requete(port, chemin) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: chemin }, (res) => {
      res.resume();
      resolve({ code: res.statusCode });
    }).on('error', () => resolve({ code: 0 }));
  });
}
const dodo = (ms) => new Promise(r => setTimeout(r, ms));
async function attendrePret(port) {
  for (let i = 0; i < 60; i++) {
    await dodo(100);
    const r = await requete(port, '/index.html');
    if (r.code === 200) return true;
  }
  return false;
}

(async function () {
  const paquet = require(path.join(RACINE, 'tools', 'paquet.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-paquet-'));
  const dest = path.join(tmp, 'dist');

  const r = paquet.construire(dest, { sansSEA: true });   // SEA testé à part : lent, non garanti partout
  ok(fs.existsSync(path.join(dest, 'index.html')), 'SPEC-PACK-001 : index.html est dans l\'archive');
  ok(fs.existsSync(path.join(dest, 'admin.html')), 'SPEC-PACK-001 : admin.html est dans l\'archive');
  ok(fs.existsSync(path.join(dest, 'server.js')), 'SPEC-PACK-001 : server.js est dans l\'archive');
  ok(fs.existsSync(path.join(dest, 'src', 'core.js')), 'SPEC-PACK-001 : les modules src/ sont copiés');
  ok(fs.existsSync(path.join(dest, 'start.cmd')), 'SPEC-PACK-001 : le lanceur Windows est produit');
  ok(fs.existsSync(path.join(dest, 'start.sh')), 'SPEC-PACK-001 : le lanceur macOS/Linux est produit');
  ok(fs.readFileSync(path.join(dest, 'start.cmd'), 'utf8').indexOf('node server.js') >= 0,
     'SPEC-PACK-001 : le lanceur Windows démarre bien le serveur');
  ok(fs.readFileSync(path.join(dest, 'start.sh'), 'utf8').indexOf('node server.js') >= 0,
     'SPEC-PACK-001 : le lanceur macOS/Linux démarre bien le serveur');

  // ── SPEC-ARCHI-016 : le lanceur démarre le mode local fermé par défaut, et l'archive embarque ce dont il a besoin
  ['start.cmd', 'start.sh'].forEach(f => {
    const txt = fs.readFileSync(path.join(dest, f), 'utf8');
    const lignes = txt.split(/\r?\n/).filter(l => /node server\.js/.test(l) && !/^\s*(rem|#)/i.test(l));
    ok(lignes.length === 1 && !/--ouvert|--serveur|--port/.test(lignes[0]),
       'SPEC-ARCHI-016 : ' + f + ' lance le mode par défaut (local fermé au réseau), sans --ouvert ni --serveur', lignes.join(' | '));
  });
  ok(fs.existsSync(path.join(dest, 'parties', 'LISEZMOI.txt')), "SPEC-ARCHI-016 : l'archive embarque le dossier des parties");
  ['contrats-archi.js', 'parties-fichier.js', 'poste.js'].forEach(f => {
    ok(fs.existsSync(path.join(dest, 'src', f)), "SPEC-ARCHI-016 : l'archive embarque src/" + f);
  });
  ok(fs.existsSync(path.join(dest, 'README.md')) && !/python -m http\.server/.test(fs.readFileSync(path.join(dest, 'README.md'), 'utf8')),
     'SPEC-ARCHI-016 : le README embarqué ne présente plus python -m http.server comme moyen de jouer');
  const pageAcc = fs.readFileSync(path.join(dest, 'index.html'), 'utf8');
  ok(/node server\.js/.test(pageAcc) && /start\.cmd/.test(pageAcc), "SPEC-ARCHI-016 : la page d'accueil embarquée explique comment lancer le serveur");

  // ── l'archive produite sert vraiment le jeu ──────────────────────────────
  const srv = spawn(process.execPath, [path.join(dest, 'server.js'), '--port', String(PORT)],
    { cwd: dest, stdio: ['ignore', 'pipe', 'pipe'] });
  const logs = [];
  srv.stdout.on('data', d => logs.push(String(d)));
  srv.stderr.on('data', d => logs.push('ERR ' + String(d)));
  try {
    const pret = await attendrePret(PORT);
    ok(pret, 'SPEC-PACK-001 : le serveur démarré DEPUIS l\'archive répond', logs.join(''));
    if (pret) {
      const idx = await requete(PORT, '/index.html');
      ok(idx.code === 200, 'SPEC-PACK-001 : index.html est servi depuis l\'archive');
      const src = await requete(PORT, '/src/core.js');
      ok(src.code === 200, 'SPEC-PACK-001 : les modules sont servis depuis l\'archive');
      const admin = await requete(PORT, '/admin.html');
      ok(admin.code === 200, 'SPEC-PACK-001 : la console d\'administration est servie depuis l\'archive');
      // SPEC-NET-020 : l'archive ne sert que le jeu — ni le serveur, ni les lanceurs, ni les parties
      const servis = [];
      for (const c of ['/server.js', '/README.md', '/start.cmd', '/start.sh', '/parties/LISEZMOI.txt', '/tests/', '/tests/version']) {
        const r = await requete(PORT, c);
        if (r.code === 200 || r.code === 301) servis.push(c + ' → ' + r.code);
      }
      ok(!servis.length, 'SPEC-NET-020 : l\'archive ne sert ni server.js, ni README, ni lanceurs, ni parties, ni banc', servis.join(', '));
    }
    /* SPEC-PACK-001 : hors dépôt git (l'archive n'a pas de .git), le démarrage
       est SILENCIEUX sur la sortie d'erreur — aucun « fatal: not a git
       repository » laissé par la recherche du commit courant. */
    await dodo(300);
    const erreurs = logs.filter(l => l.indexOf('ERR ') === 0).join('');
    ok(!/fatal|not a git repository/i.test(erreurs) && !erreurs.trim(), 'SPEC-PACK-001 : le serveur empaqueté démarre sans rien écrire sur la sortie d\'erreur', erreurs.slice(0, 300));
  } finally {
    try { srv.kill(); } catch (e) {}
  }

  // ── SEA : best-effort, ne doit jamais planter le script même sans succès ─
  try {
    const seaR = paquet.preparerSEA(dest);
    ok(typeof seaR.ok === 'boolean', 'SPEC-PACK-001 : la préparation SEA rend un compte rendu, sans lever',
       JSON.stringify(seaR));
    if (seaR.ok) {
      ok(fs.existsSync(path.join(dest, seaR.executable)), 'SPEC-PACK-001 : un binaire node est copié pour l\'OS courant');
      ok(typeof seaR.commande === 'string' && seaR.commande.indexOf('postject') >= 0,
         'SPEC-PACK-001 : la commande manuelle de finition (postject) est documentée');
    }
  } catch (e) {
    echecs++; details.push(`  ${C.r}✗ preparerSEA a levé : ${e.message}${C.x}`);
  }

  // ── SPEC-PACK-001 : l'exécutable embarque le moteur ET les fichiers du jeu ─
  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-sea-'));
  const cwdAvant = process.cwd(), argvAvant = process.argv;
  try {
    const SEAE = require(path.join(RACINE, 'tools', 'sea-entree.js'));
    // conteneur : aller-retour exact, y compris octets binaires et accents
    const brut = [{ nom: 'a.txt', contenu: Buffer.from('é€') }, { nom: 'src/b.bin', contenu: Buffer.from([0, 255, 1]) }];
    const relu = SEAE.desassembler(SEAE.assembler(brut));
    ok(relu.length === 2 && relu[0].nom === 'a.txt' && relu[0].contenu.toString() === 'é€' && relu[1].contenu.equals(Buffer.from([0, 255, 1])),
       'SPEC-PACK-001 : le conteneur des fichiers du jeu embarqué se relit à l\'identique');
    let refuse = 0;
    ['../x', '/etc/passwd', 'C:\\x', 'a/../../b'].forEach(n => { try { SEAE.nomSur(n); } catch (e) { refuse++; } });
    ok(refuse === 4, 'SPEC-PACK-001 : un nom hors du dossier de dépliage est refusé', String(refuse));
    // dépliage : les parties du joueur ne sont jamais écrasées, rien n'est redéplié si rien n'a changé
    const d = path.join(tmp3, 'jeu');
    const lot = [{ nom: 'server.js', contenu: Buffer.from('1') }, { nom: 'parties/LISEZMOI.txt', contenu: Buffer.from('neuf') }];
    ok(SEAE.deplier(lot, d).deplie === true, 'SPEC-PACK-001 : premier lancement, les fichiers sont dépliés');
    fs.writeFileSync(path.join(d, 'parties', 'LISEZMOI.txt'), 'mien');
    ok(SEAE.deplier(lot, d).deplie === false, 'SPEC-PACK-001 : relancé à l\'identique, rien n\'est redéplié');
    const accessAvant = fs.accessSync;
    let refuseEcriture = false;
    try {
      fs.accessSync = function (cible, mode) {
        if (path.resolve(cible) === path.resolve(d) && mode === fs.constants.W_OK) {
          const erreur = new Error('dossier en lecture seule');
          erreur.code = 'EACCES';
          throw erreur;
        }
        return accessAvant.apply(fs, arguments);
      };
      try { SEAE.deplier(lot, d); } catch (e) { refuseEcriture = e.code === 'EACCES'; }
    } finally {
      fs.accessSync = accessAvant;
    }
    ok(refuseEcriture, 'SPEC-PACK-001 : une empreinte identique ne masque pas un dossier devenu non inscriptible');
    lot[0] = { nom: 'server.js', contenu: Buffer.from('2') };
    SEAE.deplier(lot, d);
    ok(fs.readFileSync(path.join(d, 'server.js'), 'utf8') === '2' && fs.readFileSync(path.join(d, 'parties', 'LISEZMOI.txt'), 'utf8') === 'mien',
       'SPEC-PACK-001 : une nouvelle version remplace le jeu mais n\'écrase jamais les parties');
    // lancement : server.js voit exactement « node server.js [args] », et sans paramètre argv.slice(2) est vide
    const dl = path.join(tmp3, 'exe');
    fs.mkdirSync(dl);
    const faux = { getRawAsset: () => SEAE.assembler([{ nom: 'server.js', contenu: Buffer.from('global.__MC_ARGV = process.argv.slice(); global.__MC_CWD = process.cwd();') }]) };
    const exeFaux = path.join(dl, 'minicraft.exe');
    const r1 = SEAE.lancer(faux, exeFaux, []);
    const serveurAttendu = path.join(dl, 'minicraft-jeu', 'server.js');
    ok(r1.serveur === serveurAttendu && global.__MC_ARGV.length === 2 && global.__MC_ARGV[1] === serveurAttendu,
       'SPEC-PACK-001 : lancé sans paramètre, le serveur reçoit un argv sans argument (il ouvre donc le navigateur)', JSON.stringify(global.__MC_ARGV));
    ok(path.resolve(global.__MC_CWD) === path.resolve(path.dirname(serveurAttendu)), 'SPEC-PACK-001 : le dossier de travail est celui du jeu déplié');
    process.chdir(cwdAvant);
    delete require.cache[serveurAttendu];
    SEAE.lancer(faux, exeFaux, [serveurAttendu, '--partie', 'p1', '--port', '9']);
    ok(global.__MC_ARGV.slice(2).join(' ') === '--partie p1 --port 9',
       'SPEC-PACK-001 : la relance du serveur sur une autre partie ne double pas le chemin de server.js');
    process.chdir(cwdAvant);

    // préparation réelle : le blob existe et contient bien les fichiers du jeu
    const d2 = path.join(tmp3, 'pk');
    const c = paquet.construire(d2, {});
    if (c.sea.ok) {
      const jeu = SEAE.desassembler(fs.readFileSync(path.join(d2, 'sea', 'jeu.bin')));
      ok(['index.html', 'server.js', 'src/core.js', 'parties/LISEZMOI.txt'].every(n => jeu.some(e => e.nom === n)),
         'SPEC-PACK-001 : le blob de l\'exécutable embarque les fichiers du jeu');
      ok(!jeu.some(e => /^(tests|tools)\//.test(e.nom)), 'SPEC-PACK-001 : le blob n\'embarque ni les tests ni les outils');
      ok(fs.statSync(path.join(d2, 'sea', 'prep.blob')).size > fs.statSync(path.join(d2, 'sea', 'jeu.bin')).size,
         'SPEC-PACK-001 : prep.blob contient le point d\'entrée et le jeu');
      if (process.platform === 'win32') {
        // exécutable réel : injection puis lancement, la page est servie par l'exécutable seul
        const f = paquet.finaliserSEA(d2, c.sea);
        ok(f.ok, 'SPEC-PACK-001 : l\'exécutable Windows est terminé (injection du blob)', f.motif);
        if (f.ok) {
          const alone = path.join(tmp3, 'seul');                        // l'exécutable SEUL, sans server.js ni src/ autour
          fs.mkdirSync(alone);
          fs.copyFileSync(path.join(d2, c.sea.executable), path.join(alone, 'minicraft.exe'));
          const ex = spawn(path.join(alone, 'minicraft.exe'), ['--port', '0', '--serveur', '--admin', 'secret-de-test-long'],
            { cwd: alone, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
          let sortie = '';
          ex.stdout.on('data', x => { sortie += String(x); });
          ex.stderr.on('data', x => { sortie += String(x); });
          try {
            let port = 0;
            for (let i = 0; i < 100 && !port; i++) {                    // sondage borné : 10 s
              await dodo(100);
              const m = /MC_PORT=(\d+)/.exec(sortie);
              if (m) port = parseInt(m[1], 10);
            }
            ok(port > 0, 'SPEC-PACK-001 : l\'exécutable seul démarre et annonce son port', sortie.slice(-400));
            if (port) {
              const i1 = await requete(port, '/index.html');
              const i2 = await requete(port, '/src/core.js');
              const i3 = await requete(port, '/admin.html');
              ok(i1.code === 200 && i2.code === 200 && i3.code === 200,
                 'SPEC-PACK-001 : l\'exécutable seul sert la page, les modules et la console d\'administration', [i1.code, i2.code, i3.code].join('/'));
              ok(fs.existsSync(path.join(alone, 'minicraft-jeu', 'server.js')) && fs.existsSync(path.join(alone, 'minicraft-jeu', 'parties')),
                 'SPEC-PACK-001 : le jeu embarqué est déplié à côté de l\'exécutable, avec son dossier de parties');
            }
          } finally {
            try { ex.kill(); } catch (e) {}
            await dodo(300);
          }
        }
      } else {
        details.push(`  ${C.d}- IGNORÉ (${process.platform}) : injection et lancement de l'exécutable réel, vérifiés seulement sous Windows${C.x}`);
      }
    } else {
      details.push(`  ${C.d}- IGNORÉ : préparation SEA impossible ici (${c.sea.motif})${C.x}`);
    }
  } catch (e) {
    echecs++; details.push(`  ${C.r}✗ exécutable embarqué a levé : ${e.message}${C.x}\n${e.stack}`);
  } finally {
    try { process.chdir(cwdAvant); process.argv = argvAvant; } catch (e) {}
    try { fs.rmSync(tmp3, { recursive: true, force: true }); } catch (e) {}
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}

  // ── SPEC-PACK-004 : un paquet .zip nommé par version, à chaque publication ─
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-release-'));
  try {
    const releases = path.join(tmp2, 'releases');
    const r = paquet.construireZipRelease('9.9.9-test', releases);
    ok(fs.existsSync(r.chemin), 'SPEC-PACK-004 : un fichier .zip nommé par version est produit',
       r.chemin);
    ok(path.basename(r.chemin) === 'minicraft-v9.9.9-test.zip',
       'SPEC-PACK-004 : le nom du fichier porte exactement la version publiée', path.basename(r.chemin));
    const ZIP = require(path.join(RACINE, 'tools', 'zip.js'));
    const entrees = ZIP.lireZip(fs.readFileSync(r.chemin));
    ok(entrees.some(e => e.nom === 'index.html'), 'SPEC-PACK-004 : le zip contient index.html');
    ok(entrees.some(e => e.nom === 'server.js'), 'SPEC-PACK-004 : le zip contient server.js');
    ok(entrees.some(e => e.nom === 'src/core.js'), 'SPEC-PACK-004 : le zip contient les modules src/');
    ok(entrees.some(e => e.nom === 'start.cmd') && entrees.some(e => e.nom === 'start.sh'),
       'SPEC-PACK-004 : le zip contient les deux lanceurs');
    ok(!entrees.some(e => e.nom.indexOf('sea/') === 0),
       'SPEC-PACK-004 : le dossier sea/ (binaire node, inachevé sans postject) n\'est jamais dans le zip partagé',
       entrees.filter(e => e.nom.indexOf('sea') >= 0).map(e => e.nom).join(', '));
    ok(!fs.existsSync(path.join(tmp2, '.tmp-release-9.9.9-test')),
       'SPEC-PACK-004 : le dossier de construction temporaire est nettoyé après zippage');
  } catch (e) {
    echecs++; details.push(`  ${C.r}✗ construireZipRelease a levé : ${e.message}${C.x}\n${e.stack}`);
  } finally {
    try { fs.rmSync(tmp2, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(`\n${C.b}Integration paquet${C.x}\n${details.join('\n')}\n`);
  const total = passes + echecs;
  if (echecs) { console.log(`${C.r}${echecs} échec(s)${C.x} sur ${total} tests\n`); process.exit(1); }
  console.log(`${C.g}${passes}/${total} tests d intégration passent${C.x}\n`);
})();
