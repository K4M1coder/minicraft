/* tools/navigateur.js — détection et lancement d'un navigateur Edge/Chrome
   installé, en mode SANS INTERFACE (SPEC-BANC-023/024). La détection
   réutilise TEL QUEL tools/cahier.js::trouverNavigateur (déjà utilisée pour
   l'export PDF, SPEC-BANC-020) plutôt que de la dupliquer : mêmes chemins
   Windows/macOS/Linux, même repli sur `where`/`which`, même option
   `--navigateur` pour forcer un chemin.

   `lancer(opts)` démarre le navigateur avec :
   - `--headless=new` (mode sans fenêtre le plus proche du rendu normal) ;
   - un `--user-data-dir` TEMPORAIRE et DÉDIÉ (mkdtemp) : deux campagnes
     lancées en même temps ne se marchent jamais dessus (SPEC-BANC-023,
     vérification « deux campagnes … ne se gênent pas ») ;
   - un port de débogage distant LIBRE (SPEC-BANC-023) ;
   - une fenêtre d'au moins 1280×800 (SPEC-BANC-024, jamais sous 800×600).

   `arreterProprement(handle)` ferme le processus ET, sous Windows, TOUT son
   arbre de processus (un navigateur headless peut se relancer lui-même en
   un processus séparé sous certains réglages) via `taskkill /T /F /PID`, ce
   que `child_process.kill()` seul ne garantit pas sur cette plateforme. */
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const { trouverNavigateur } = require('./cahier.js');

const LARGEUR_MIN = 1280;
const HAUTEUR_MIN = 800;

/* Un port TCP local libre, choisi par l'OS (bind sur le port 0) puis
   relâché aussitôt — la fenêtre entre la libération et la réutilisation par
   le navigateur est minuscule et, en pratique, jamais un problème pour un
   outil de test lancé en série ou en parallèle sur le même poste. */
function portLibre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

/* Lance le navigateur détecté (ou `opts.navigateur` s'il est fourni) en
   mode sans interface. Renvoie { processus, port, dossierProfil, chemin }
   ou lève si aucun navigateur n'est trouvé. L'appelant doit TOUJOURS
   appeler `arreterProprement` sur le handle rendu, même en cas d'échec
   ultérieur — voir tools/e2e-headless.js pour le nettoyage garanti
   (process.on('exit'|'SIGINT'|'SIGTERM')). */
async function lancer(opts) {
  const options = opts || {};
  const chemin = trouverNavigateur(options.navigateur);
  if (!chemin) {
    const e = new Error('aucun navigateur Edge/Chrome installé n\'a été trouvé');
    e.motif = 'navigateur_introuvable';
    throw e;
  }
  const port = options.port || await portLibre();
  const largeur = Math.max(LARGEUR_MIN, options.largeur || LARGEUR_MIN);
  const hauteur = Math.max(HAUTEUR_MIN, options.hauteur || HAUTEUR_MIN);
  const dossierProfil = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-e2e-navigateur-'));

  const args = [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + dossierProfil,
    '--window-size=' + largeur + ',' + hauteur,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-popup-blocking',
    '--disable-sync',
    /* Un test e2e mesure de vraies images/s (SPEC-SPLIT-005, en écran
       partagé) : sans fenêtre visible, Chrome peut plafonner artificiellement
       requestAnimationFrame (vsync simulé, limiteur de fréquence) au lieu de
       rendre aussi vite que la carte le permet — ce que ces deux options
       désactivent. Sans elles, une campagne assez longue et chargée pouvait
       faire chuter la cadence mesurée sous le seuil bien que le rendu
       lui-même n'ait rien de plus lent (revue adversariale). */
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
    /* Une page sans fenêtre au premier plan peut être considérée « en
       arrière-plan » par Chrome et voir son minuteur ralenti — exactement le
       contraire de ce qu'une mesure de cadence doit observer. */
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    'about:blank',
  ];
  const processus = spawn(chemin, args, { stdio: 'ignore', detached: process.platform !== 'win32' });
  processus.unref();

  return { processus, port, dossierProfil, chemin, largeur, hauteur };
}

/* Tue le processus navigateur ET son arbre. Sous Windows, `taskkill /T /F`
   est nécessaire : `child_process.kill()` seul ne referme que le processus
   immédiat et peut laisser des enfants (rendu, GPU) orphelins — exactement
   ce que la vérification de SPEC-BANC-023 (« aucun processus restant »)
   interdit. Toujours suivi de la suppression du profil temporaire. */
function arreterProprement(handle) {
  if (!handle) return;
  try {
    if (process.platform === 'win32' && handle.processus && handle.processus.pid) {
      try { execFileSync('taskkill', ['/T', '/F', '/PID', String(handle.processus.pid)], { stdio: 'ignore' }); }
      catch (e) { /* déjà mort, ou taskkill absent : on tente quand même kill() ci-dessous */ }
    }
    if (handle.processus && !handle.processus.killed) {
      try { handle.processus.kill(process.platform === 'win32' ? undefined : 'SIGKILL'); } catch (e) { /* déjà mort */ }
    }
  } finally {
    if (handle.dossierProfil) {
      try { fs.rmSync(handle.dossierProfil, { recursive: true, force: true }); } catch (e) { /* verrouillé un instant, tant pis */ }
    }
  }
}

module.exports = { trouverNavigateur, lancer, arreterProprement, portLibre, LARGEUR_MIN, HAUTEUR_MIN };
