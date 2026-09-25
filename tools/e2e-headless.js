/* tools/e2e-headless.js — exécute une sélection de tests end-to-end
   (tests/e2e.js) SANS FENÊTRE, en ligne de commande, dans une instance de
   navigateur isolée par campagne (SPEC-BANC-023/024/025).

   Pilote tests/index.html DE L'EXTÉRIEUR par CDP (tools/cdp.js), sans
   jamais le modifier : la seule API utilisée est celle déjà exposée par la
   page (`ensureGame()`, `window.runE2E(jeu, onProgress, filtre)` posée par
   tests/e2e.js). `filtre` ne fait qu'un test-à-la-fois par SOUS-CHAÎNE — on
   l'appelle donc une fois par test sélectionné, avec le NOM EXACT du test
   comme filtre, ce qui revient à l'isoler tant qu'aucun autre nom d'e2e ne
   le contient comme sous-chaîne (voir `executerUnTest` plus bas, qui
   vérifie `total === 1` et échoue proprement sinon plutôt que de rapporter
   un résultat qui ne serait pas celui du test demandé).

   Limite documentée (à charge du lot qui construit tests/banc-ui.js/e2e.js,
   PAS de ce lot qui n'y touche pas) : `runE2E` ne rapporte ni étapes
   nommées (`etape('libellé')`) ni métriques (images/s, triangles, mémoire)
   par test — seulement son nom, son état et son message d'échec. Ce module
   capture ce que CDP peut observer de l'EXTÉRIEUR à la place : une capture
   d'écran au début et à la fin de chaque test, et les messages de console
   du navigateur (console.* et erreurs non interceptées) horodatés, dont la
   tranche correspondant à un test est jointe à son résultat s'il échoue.

   Démarre son PROPRE serveur de test (server.js --port <libre> --serveur
   --tests, comme tests/integration-cahiers.js) et son PROPRE navigateur
   (tools/navigateur.js, port de débogage et profil TEMPORAIRES) : deux
   campagnes lancées en même temps ne se gênent jamais (SPEC-BANC-023).
   Nettoyage GARANTI (process.on('exit'|'SIGINT'|'SIGTERM')), même en cas
   d'échec ou d'interruption.

   Utilisable comme bibliothèque (`executerCampagne`, par
   tests/integration-e2e-headless.js) ou en CLI (appelé par tests/run.js en
   sous-processus, comme les scripts tests/integration-*.js) :

     node tools/e2e-headless.js --entree selection.json --sortie resultat.json
       [--navigateur chemin] [--port-serveur N] [--delai-demarrage ms]
       [--delai-test ms] [--delai-global ms]

   `selection.json` : tableau d'objets { id, nom, type, groupe, domaines,
   specs, fiche } (le sous-ensemble de tests/catalogue.js dont on a besoin).
   `resultat.json` : { ok, motif?, environnement, tests:[...], captures:[...] }
   — `tests[*]` a la forme attendue par tests/run.js pour nourrir le même
   cahier de test que les autres types (SPEC-BANC-014). Code de sortie :
   0 si la campagne s'est déroulée (des tests peuvent individuellement avoir
   échoué : voir le JSON), 2 si l'infrastructure (navigateur ou serveur) n'a
   pas pu démarrer, 3 si le délai global est dépassé. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const CDP = require('./cdp.js');
const NAV = require('./navigateur.js');

const RACINE = path.join(__dirname, '..');
const DELAI_DEMARRAGE_DEFAUT = 20000;
// Filet de sécurité contre un test qui ne rend jamais la main (session CDP
// bloquée), pas un couperet pour un test simplement lent (SPEC-BANC-010,
// révisé) — voir tests/run.js pour le même choix côté appelant CLI.
const DELAI_TEST_DEFAUT = 15 * 60 * 1000;
const DELAI_GLOBAL_DEFAUT = 20 * 60 * 1000;
const MAX_MESSAGES_CONSOLE = 4000; // borne mémoire d'une longue campagne

function dodo(ms) { return new Promise((r) => setTimeout(r, ms)); }

function requeteLocale(port, chemin) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: chemin, timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode || 0);
    });
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
  });
}

async function attendreServeurPret(port, delaiMs) {
  const limite = Date.now() + delaiMs;
  while (Date.now() < limite) {
    const code = await requeteLocale(port, '/tests/index.html');
    if (code === 200) return true;
    await dodo(150);
  }
  return false;
}

/* Démarre le serveur de test (server.js, mode --serveur --tests, comme
   tests/integration-cahiers.js) sur un port LIBRE et DÉDIÉ à cette
   campagne — jamais le port de jeu par défaut, pour ne jamais entrer en
   conflit avec une partie déjà lancée sur ce poste. */
async function demarrerServeurTest(port, delaiMs) {
  const processus = spawn(process.execPath, [path.join(RACINE, 'server.js'), '--port', String(port), '--serveur', '--tests'],
    { cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'] });
  let journal = '';
  processus.stdout.on('data', (d) => { journal += d; });
  processus.stderr.on('data', (d) => { journal += d; });
  const pret = await attendreServeurPret(port, delaiMs);
  if (!pret) {
    try { processus.kill(); } catch (e) { /* déjà mort */ }
    const e = new Error('le serveur de test n\'a jamais répondu : ' + journal.slice(-500));
    e.motif = 'serveur_indisponible';
    throw e;
  }
  return processus;
}

function arreterServeurTest(processus) {
  if (!processus || processus.killed) return;
  try { processus.kill(); } catch (e) { /* déjà mort */ }
}

/* Détecte l'accélération matérielle du rendu WebGL (SPEC-BANC-024) : un
   moteur logiciel (SwiftShader, llvmpipe, "Microsoft Basic Render Driver",
   …) apparaît dans la chaîne UNMASKED_RENDERER_WEBGL — un GPU réel n'y
   apparaît jamais avec ces noms. Faute d'extension de debug (contexte trop
   restreint), on ne peut pas savoir : on le signale comme tel plutôt que
   de deviner. */
const EXPRESSION_RENDU = `(function () {
  try {
    var c = document.createElement('canvas');
    var gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return { ok: false, renderer: null, vendor: null, motif: 'pas de contexte WebGL' };
    var dbg = gl.getExtension('WEBGL_debug_renderer_info');
    var renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    var vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
    return { ok: true, renderer: String(renderer), vendor: String(vendor) };
  } catch (e) { return { ok: false, renderer: null, vendor: null, motif: String(e && e.message || e) }; }
})()`;
const RE_LOGICIEL = /swiftshader|llvmpipe|software|basic render|microsoft basic|mesa.*llvmpipe/i;

function accelerationDepuisRenderer(renderer) {
  if (!renderer) return null;
  return !RE_LOGICIEL.test(renderer);
}

/* `tests/e2e.js` (runUnE2EParNom, instrumenté) produit des captures en URL
   de données COMPLÈTE (`canvas.toDataURL()`, préfixe `data:image/...;base64,`
   compris — voir capturer()/dessinerFrame() dans ce fichier) : c'est ce dont
   banc-ui.js a besoin pour les afficher TELLES QUELLES. Ce module-ci, comme
   l'ancien chemin CDP `Page.captureScreenshot` qu'il remplace, expose du
   base64 PUR à ses appelants (tests/integration-e2e-headless.js le vérifie
   explicitement) — le préfixe est donc retiré ICI, une fois, plutôt que de
   propager deux conventions différentes selon la provenance de la capture. */
function base64Pur(donnees) {
  const m = /^data:[^;,]*(?:;base64)?,/.exec(donnees || '');
  return m ? donnees.slice(m[0].length) : donnees;
}

/* Exécute UN test par son nom exact (filtre substring de runE2E, voir
   l'en-tête de ce fichier). Capture avant/après, délai coopératif via
   Runtime.terminateExecution si le test dépasse `delaiTestMs` — la
   campagne continue avec le test suivant (SPEC-BANC-010, comme le volet
   Node de tests/run.js). */
async function executerUnTest(session, portServeur, test, opts) {
  const debut = Date.now();
  const debutISO = new Date(debut).toISOString();

  /* Piloté par `window.runUnE2EParNom` (tests/e2e.js), l'équivalent
     instrumenté (étapes, triplets, métriques — SPEC-BANC-077 à 087) de ce
     que le banc navigateur utilise déjà : ce module gagne donc la même
     richesse que le banc plutôt que de se contenter d'observer de
     l'extérieur (limite historique, désormais levée). `opts.delaiTestMs`
     (ms) devient `delaiDefaut` en SECONDES, ce que `runUnE2E` attend
     (`fiche.delai` reste prioritaire si le test en déclare un). */
  const expression = 'window.runUnE2EParNom(ensureGame(), ' + JSON.stringify(test.nom) +
    ', { delaiDefaut: ' + (opts.delaiTestMs / 1000) + ' })';
  let resultatJS = null;
  let erreur = null;
  let delaiDepasse = false;
  try {
    const r = await session.envoyer('Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      opts.delaiTestMs + 2000);
    if (r.exceptionDetails) {
      erreur = (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || JSON.stringify(r.exceptionDetails);
    } else {
      resultatJS = r.result && r.result.value;
    }
  } catch (e) {
    delaiDepasse = /délai dépassé/.test(e.message);
    erreur = e.message;
    if (delaiDepasse) {
      // on interrompt le script bloqué pour que la SESSION reste utilisable
      // pour le test suivant — sans ça, une seule e2e figée bloquerait
      // toute la fin de la campagne (SPEC-BANC-010)
      try { await session.envoyer('Runtime.terminateExecution', {}, 5000); } catch (e2) { /* au pire, on continue quand même */ }
    }
  }
  const duree_ms = Date.now() - debut;

  if (erreur) {
    // aucune capture possible ici : le script a explosé côté page (exception
    // non rattrapée par runUnE2EParNom lui-même, ou délai global CDP) —
    // runUnE2E(), qui capture systématiquement, n'a alors jamais pu rendre
    // la main.
    return {
      etat: delaiDepasse ? 'delai' : 'echec', debut: debutISO, duree_ms,
      message: delaiDepasse ? 'délai dépassé (' + opts.delaiTestMs + ' ms)' : erreur,
      assertions: { ok: 0, ko: 1 }, etapes: [], captures: [],
    };
  }
  if (!resultatJS) {
    return {
      etat: 'echec', debut: debutISO, duree_ms,
      message: 'runUnE2EParNom n\'a rendu aucun résultat',
      assertions: { ok: 0, ko: 1 }, etapes: [], captures: [],
    };
  }
  // vocabulaire e2e ('reussi'/'echec'/'delai', tests/e2e.js runUnE2E) →
  // vocabulaire de ce module ('ok'/'echec'/'delai', historique de
  // tests/run.js) : etatRegistre() (tools/registre.js) accepte les deux,
  // mais tests/run.js, LUI, ne compte 'ok' comme passé — voir plus bas.
  return {
    etat: resultatJS.etat === 'reussi' ? 'ok' : resultatJS.etat, debut: resultatJS.debut || debutISO, duree_ms: resultatJS.duree_ms || duree_ms,
    message: resultatJS.message, pile: resultatJS.pile, attendu: resultatJS.attendu, obtenu: resultatJS.obtenu,
    assertions: resultatJS.assertions || { ok: 0, ko: 0 }, etapes: resultatJS.etapes || [],
    etapesTriplets: resultatJS.etapesTriplets || [], metriques: resultatJS.metriques || null,
    captures: (resultatJS.captures || []).map((c) => ({ libelle: c.libelle, type: c.type, base64: base64Pur(c.base64), role: c.role,
      etape: c.etape, bord: c.bord, rang: c.rang, t_ms: c.t_ms, numero_image: c.numero_image, duree_image_ms: c.duree_image_ms,
      pose: c.pose, instabilite: c.instabilite })),
  };
}

/* Exécute la campagne complète : démarre serveur + navigateur, pilote
   tests/index.html, exécute `selection` (tableau d'entrées de catalogue de
   type e2e) un test à la fois, puis nettoie TOUJOURS — voir le bloc
   try/finally et les gestionnaires process.on ajoutés par l'appelant CLI
   plus bas pour le cas d'une interruption externe (Ctrl+C). */
async function executerCampagne(selection, options) {
  const opts = Object.assign({
    delaiDemarrageMs: DELAI_DEMARRAGE_DEFAUT,
    delaiTestMs: DELAI_TEST_DEFAUT,
    delaiGlobalMs: DELAI_GLOBAL_DEFAUT,
    ecrire: () => {},
  }, options || {});

  const debutCampagne = Date.now();
  const limiteGlobale = debutCampagne + opts.delaiGlobalMs;

  let navigateurHandle = null;
  let serveurProcessus = null;
  let session = null;

  async function nettoyer() {
    if (session) { session.fermer(); session = null; }
    if (navigateurHandle) { NAV.arreterProprement(navigateurHandle); navigateurHandle = null; }
    if (serveurProcessus) { arreterServeurTest(serveurProcessus); serveurProcessus = null; }
  }

  try {
    const portServeur = opts.portServeur || await NAV.portLibre();
    opts.ecrire('▶ serveur de test sur le port ' + portServeur);
    serveurProcessus = await demarrerServeurTest(portServeur, opts.delaiDemarrageMs);
    if (opts.surHandles) opts.surHandles({ serveurProcessus, navigateurHandle: null });

    opts.ecrire('▶ navigateur sans fenêtre…');
    navigateurHandle = await NAV.lancer({ navigateur: opts.navigateur, largeur: NAV.LARGEUR_MIN, hauteur: NAV.HAUTEUR_MIN });
    if (opts.surHandles) opts.surHandles({ serveurProcessus, navigateurHandle });
    const infoVersion = await CDP.attendrePortPret(navigateurHandle.port, opts.delaiDemarrageMs);

    const cibles = await CDP.listerCibles(navigateurHandle.port);
    let cible = (cibles || []).find((c) => c.type === 'page');
    if (!cible) cible = await CDP.nouvelOnglet(navigateurHandle.port, 'about:blank');
    session = new CDP.SessionCDP(cible.webSocketDebuggerUrl);
    await session.connecter(opts.delaiDemarrageMs);

    const messagesConsole = [];
    session.sur('Runtime.consoleAPICalled', (p) => {
      if (messagesConsole.length >= MAX_MESSAGES_CONSOLE) return;
      const texte = (p.args || []).map((a) => (a.value !== undefined ? String(a.value) : (a.description || a.type))).join(' ');
      messagesConsole.push({ t: Date.now(), niveau: p.type, texte });
    });
    session.sur('Log.entryAdded', (p) => {
      if (messagesConsole.length >= MAX_MESSAGES_CONSOLE) return;
      const e = p.entry || {};
      messagesConsole.push({ t: Date.now(), niveau: e.level || 'log', texte: e.text || '' });
    });

    await session.envoyer('Page.enable', {}, 10000);
    await session.envoyer('Runtime.enable', {}, 10000);
    try { await session.envoyer('Log.enable', {}, 10000); } catch (e) { /* facultatif */ }
    await session.envoyer('Emulation.setDeviceMetricsOverride',
      { width: navigateurHandle.largeur, height: navigateurHandle.hauteur, deviceScaleFactor: 1, mobile: false }, 10000);

    const urlPage = 'http://127.0.0.1:' + portServeur + '/tests/index.html';
    await session.envoyer('Page.navigate', { url: urlPage }, opts.delaiDemarrageMs);

    // attend que la page ait chargé le jeu et exposé l'API pilotée
    const limitePret = Date.now() + opts.delaiDemarrageMs;
    let pret = false;
    while (Date.now() < limitePret) {
      try {
        const r = await session.envoyer('Runtime.evaluate',
          { expression: "typeof window.runE2E === 'function' && typeof MC !== 'undefined' && typeof ensureGame === 'function'", returnByValue: true },
          5000);
        if (r.result && r.result.value === true) { pret = true; break; }
      } catch (e) { /* pas encore prêt */ }
      await dodo(150);
    }
    if (!pret) {
      const e = new Error('tests/index.html n\'a jamais exposé window.runE2E/ensureGame — page non chargée ou API absente');
      e.motif = 'page_non_prete';
      throw e;
    }

    const rGpu = await session.envoyer('Runtime.evaluate', { expression: EXPRESSION_RENDU, returnByValue: true }, 8000)
      .then((r) => r.result && r.result.value).catch(() => null);
    const accelerationMaterielle = rGpu ? accelerationDepuisRenderer(rGpu.renderer) : null;

    const testsResultats = [];
    const capturesGlobales = [];
    for (const test of selection) {
      if (Date.now() > limiteGlobale) {
        testsResultats.push(Object.assign({}, test, {
          etat: 'delai', duree_ms: 0, etapes: [], assertions: { ok: 0, ko: 1 },
          message: 'délai global de la campagne e2e dépassé avant ce test', captures: [],
        }));
        continue;
      }
      opts.ecrire('  ▶ ' + test.nom);
      const debutT = Date.now();
      const r = await executerUnTest(session, portServeur, test, opts);
      opts.ecrire((r.etat === 'ok' ? '    ✓ ' : '    ✗ ') + test.nom + ' (' + r.duree_ms + ' ms)');
      const journalTest = messagesConsole.filter((m) => m.t >= debutT && m.t <= Date.now());
      let message = r.message;
      if (r.etat !== 'ok' && journalTest.length) {
        const extrait = journalTest.slice(-10).map((m) => '[' + m.niveau + '] ' + m.texte).join('\n');
        message = (message || '') + '\n\njournal de console (10 derniers messages) :\n' + extrait;
      }
      // `fichier` porte l'INDEX de la capture dans le tableau global
      // `capturesGlobales` (voir le correctif 2174e8c, master) : deux
      // captures de tests différents partagent souvent le même libellé
      // d'étape (« … · début », « … · fin »), donc apparier par libellé
      // seul donnerait à tous les tests les images du premier. L'index est
      // fixé ICI, à la position d'insertion dans `capturesGlobales`, avant
      // que tools/resultats-tests.js ne le résolve en nom de fichier.
      testsResultats.push({
        id: test.id, nom: test.nom, type: test.type || 'e2e', groupe: test.groupe,
        domaines: test.domaines || [], specs: test.specs || [], fiche: test.fiche || null, etiquettes: test.etiquettes || [],
        // SPEC-BANC-062 : fonctions DÉCLARÉES seulement côté e2e (l'énoncé le
        // permet explicitement — pas d'observation en exécution navigateur
        // dans ce lot, voir docs/banc/historique-global.md §3.5).
        fonctions: test.fonctions || [],
        etat: r.etat, debut: r.debut || null, duree_ms: r.duree_ms,
        etapes: r.etapes || [], etapesTriplets: r.etapesTriplets || [],
        assertions: r.assertions, metriques: r.metriques || undefined,
        message, pile: r.pile, attendu: r.attendu, obtenu: r.obtenu,
        captures: r.captures.map((c, i) => ({
          libelle: c.libelle, type: c.type, role: c.role, etape: c.etape, bord: c.bord, rang: c.rang,
          t_ms: c.t_ms, numero_image: c.numero_image, duree_image_ms: c.duree_image_ms, pose: c.pose, instabilite: c.instabilite,
          fichier: capturesGlobales.length + i,
        })),
      });
      r.captures.forEach((c) => capturesGlobales.push(c));
    }

    return {
      ok: true,
      environnement: {
        source: 'navigateur-headless',
        navigateur: (infoVersion && infoVersion.Browser) || navigateurHandle.chemin,
        gpu: rGpu ? rGpu.renderer : null,
        vendorGpu: rGpu ? rGpu.vendor : null,
        resolution: navigateurHandle.largeur + 'x' + navigateurHandle.hauteur,
        accelerationMaterielle,
        // SPEC-BANC-085 : os et présence d'une fenêtre — ce module lance
        // TOUJOURS le navigateur sans fenêtre (tools/navigateur.js) ; le banc
        // navigateur normal (tests/banc-ui.js), qui s'exécute avec fenêtre,
        // n'écrit pas ces champs par ce chemin — ils resteraient `false`/os
        // par défaut plutôt qu'absents, ce qui serait faux pour ce cas-là.
        os: os.platform() + ' ' + os.release(),
        avecFenetre: false,
      },
      tests: testsResultats,
      captures: capturesGlobales,
      duree_campagne_ms: Date.now() - debutCampagne,
    };
  } catch (e) {
    return {
      ok: false,
      motif: e.motif || e.message,
      environnement: null,
      tests: [],
      captures: [],
      duree_campagne_ms: Date.now() - debutCampagne,
    };
  } finally {
    await nettoyer();
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);
  const option = (nom, defaut) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : defaut; };

  const entree = option('--entree');
  const sortie = option('--sortie');
  if (!entree || !sortie) {
    console.error('Usage : node tools/e2e-headless.js --entree selection.json --sortie resultat.json [--navigateur chemin] [--port-serveur N] [--delai-demarrage ms] [--delai-test ms] [--delai-global ms]');
    process.exit(2);
  }
  const selection = JSON.parse(fs.readFileSync(entree, 'utf8'));
  const opts = {
    navigateur: option('--navigateur') || null,
    portServeur: option('--port-serveur') ? parseInt(option('--port-serveur'), 10) : null,
    delaiDemarrageMs: parseInt(option('--delai-demarrage', String(DELAI_DEMARRAGE_DEFAUT)), 10),
    delaiTestMs: parseInt(option('--delai-test', String(DELAI_TEST_DEFAUT)), 10),
    delaiGlobalMs: parseInt(option('--delai-global', String(DELAI_GLOBAL_DEFAUT)), 10),
    ecrire: (t) => { process.stderr.write(t + '\n'); },
  };

  // nettoyage garanti même sur une interruption externe (Ctrl+C, arrêt du
  // process parent) — `executerCampagne` nettoie déjà dans son propre
  // finally pour le cas normal ; ceci couvre le cas où LE PROCESSUS entier
  // est tué avant que cette promesse ne se résolve
  let handlesActuels = null;
  let nettoye = false;
  function nettoyageUrgence() {
    if (nettoye) return;
    nettoye = true;
    if (handlesActuels && handlesActuels.navigateurHandle) { try { require('./navigateur.js').arreterProprement(handlesActuels.navigateurHandle); } catch (e) { /* dernier recours */ } }
    if (handlesActuels && handlesActuels.serveurProcessus) { try { handlesActuels.serveurProcessus.kill(); } catch (e) { /* dernier recours */ } }
  }
  opts.surHandles = (h) => { handlesActuels = h; };
  process.on('SIGINT', () => { nettoyageUrgence(); process.exit(3); });
  process.on('SIGTERM', () => { nettoyageUrgence(); process.exit(3); });
  process.on('exit', nettoyageUrgence);

  executerCampagne(selection, opts).then((resultat) => {
    fs.writeFileSync(sortie, JSON.stringify(resultat));
    if (!resultat.ok) process.exit(resultat.motif === 'navigateur_introuvable' ? 2 : 2);
    process.exit(0);
  }).catch((e) => {
    try { fs.writeFileSync(sortie, JSON.stringify({ ok: false, motif: e.message, environnement: null, tests: [], captures: [] })); } catch (e2) { /* rien à faire */ }
    process.exit(2);
  });
}

module.exports = { executerCampagne, accelerationDepuisRenderer };
