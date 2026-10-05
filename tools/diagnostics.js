/* tools/diagnostics.js — diagnostics joints au rapport d'un test
   (SPEC-BANC-092 à 103, docs/banc/historique-global.md §3.13).

   Règle d'or (SPEC-BANC-092) : tout diagnostic — enregistreur de vol, instantané
   de l'état du jeu, erreurs cachées, profils CPU et GPU, trace réseau, journal
   du serveur — n'est joint au rapport d'un test QUE s'il échoue ou s'il est
   lent. Les métriques de performance (SPEC-BANC-087) sont toujours là. Ce
   module est le point unique de cette règle (`appliquerPolitique`), appelé à
   l'écriture du cahier (tools/resultats-tests.js) pour tous les chemins :
   tests Node, scripts d'intégration, e2e sans fenêtre et banc navigateur.

   Il porte aussi, côté Node :
     - la lecture des évènements du navigateur que `console` ne montre pas
       (CDP : exceptions, messages du navigateur lui-même, ressources
       introuvables, workers) — `CollecteurCDP` (SPEC-BANC-095 à 099) ;
     - le profil CPU d'un test lent (SPEC-BANC-101) et les couches du profil
       GPU qui viennent du processus ou du système (SPEC-BANC-102) ;
     - la collecte du journal des serveurs lancés par un test d'intégration
       (SPEC-BANC-100) et la trace des messages réseau (SPEC-BANC-103).
   Aucune dépendance npm. Les fonctions de décision sont pures. */
'use strict';
const fs = require('fs');
const path = require('path');

// ══════════════════════════════════════════════════════════════════════════
// 1. Politique : joindre seulement à l'échec ou à la lenteur (SPEC-BANC-092)
// ══════════════════════════════════════════════════════════════════════════
/* Les champs d'un résultat de test qui sont des diagnostics. `metriques`,
   `etapes`, `assertions` et les captures n'en font PAS partie. */
const CLES_DIAGNOSTICS = [
  'journal', 'vol', 'volPerdues', 'instantane', 'erreursCachees',
  'longtasks', 'histogrammeImages', 'profilCPU', 'profilGPU', 'trace', 'reseau', 'serveur',
];
const ETATS_ECHEC = ['echec', 'delai'];

function estEchec(t) { return !!t && ETATS_ECHEC.indexOf(t.etat) >= 0; }
function estLent(t, seuilMs) {
  return !!t && typeof seuilMs === 'number' && seuilMs > 0 && typeof t.duree_ms === 'number' && t.duree_ms > seuilMs;
}
/* Ce qui déclenche les diagnostics d'un test : 'echec', 'lent', 'echec+lent'
   ou null. */
function declencheur(t, seuilMs) {
  const e = estEchec(t), l = estLent(t, seuilMs);
  if (e && l) return 'echec+lent';
  return e ? 'echec' : (l ? 'lent' : null);
}
/* Un bloc `reseau` brut (messages du client + lignes du journal du serveur, tel que le produit la page d'un test)
   devient le rapport final : les N derniers messages des deux côtés, dans l'ordre du temps (SPEC-BANC-103). */
function normaliserReseau(t) {
  const r = t && t.reseau;
  if (!r || typeof r !== 'object' || Array.isArray(r.messages)) return;
  t.reseau = rapportReseau(Array.isArray(r.client) ? r.client : [], Array.isArray(r.journal_serveur) ? r.journal_serveur : [], 50);
}
/* Retire d'un test (sur place) tous ses diagnostics s'il n'est ni en échec ni
   lent ; sinon les garde et note ce qui les a déclenchés (`diagnostic_pour`).
   Rend la liste des clés retirées. */
function appliquerPolitique(t, seuilMs) {
  if (!t || typeof t !== 'object') return [];
  const pourquoi = declencheur(t, seuilMs);
  const retires = [];
  if (pourquoi) {
    normaliserReseau(t);
    if (CLES_DIAGNOSTICS.some(k => t[k] !== undefined && t[k] !== null)) t.diagnostic_pour = pourquoi;
    return retires;
  }
  CLES_DIAGNOSTICS.forEach((k) => { if (k in t) { delete t[k]; retires.push(k); } });
  delete t.diagnostic_pour;
  return retires;
}
function appliquerPolitiqueCampagne(resultats, seuilMs) {
  const seuil = seuilMs !== undefined ? seuilMs : (resultats && resultats.campagne && resultats.campagne.seuilLentMs);
  let n = 0;
  ((resultats && resultats.tests) || []).forEach((t) => { n += appliquerPolitique(t, seuil).length; });
  return n;
}
/* Les fichiers de diagnostic (profils, traces) que référencent les tests à
   conserver : un test dont les diagnostics sont retirés n'en référence plus. */
const SEUIL_LENT_DEFAUT_MS = 20000;

// ══════════════════════════════════════════════════════════════════════════
// 2. Entrées du journal du navigateur (SPEC-BANC-095 à 099)
// ══════════════════════════════════════════════════════════════════════════
const MAX_ENTREES = 4000;
const MAX_TEXTE = 4000;
function tronquer(s, n) { s = String(s === undefined || s === null ? '' : s); return s.length > (n || MAX_TEXTE) ? s.slice(0, n || MAX_TEXTE) + '…' : s; }
/* L'horodatage d'une ligne : ISO, comme les lignes du journal du jeu (MC.Journal), pour que les deux se
   fusionnent en un seul flux trié (un vol de test = journal du jeu + évènements du navigateur). */
function heure(t) { return new Date(t).toISOString(); }
function entree(source, niveau, type, message, extra) {
  return Object.assign({ t: Date.now(), source, niveau, type, message: tronquer(message) }, extra || {});
}
function pileDeDetails(d) {
  if (!d) return null;
  if (d.exception && d.exception.description) return tronquer(d.exception.description);
  const cadres = d.stackTrace && d.stackTrace.callFrames;
  if (cadres && cadres.length) return cadres.map(c => '    at ' + (c.functionName || '(anonyme)') + ' (' + c.url + ':' + (c.lineNumber + 1) + ':' + (c.columnNumber + 1) + ')').join('\n');
  return null;
}
/* Runtime.exceptionThrown : une exception non rattrapée, avec sa pile. */
function depuisExceptionThrown(p, session) {
  const d = (p && p.exceptionDetails) || {};
  const message = (d.exception && (d.exception.description || d.exception.value)) || d.text || 'exception sans détail';
  return entree(session ? 'worker' : 'navigateur', 'error', 'exception', String(message).split('\n')[0], {
    pile: pileDeDetails(d), url: d.url || null, ligne: typeof d.lineNumber === 'number' ? d.lineNumber + 1 : null, worker: session || null,
  });
}
/* Log.entryAdded : les messages du navigateur LUI-MÊME (dépréciations,
   interventions, erreurs de sécurité, ressources) — ils ne passent pas par
   console.* (SPEC-BANC-096). */
function depuisLogEntry(p, session) {
  const e = (p && p.entry) || {};
  const niveau = e.level === 'verbose' ? 'debug' : (e.level === 'warning' ? 'warn' : (e.level === 'error' ? 'error' : 'info'));
  return entree('navigateur', niveau, e.source || 'log', e.text || '', { url: e.url || null, ligne: typeof e.lineNumber === 'number' ? e.lineNumber + 1 : null, worker: session || null });
}
/* Audits.issueAdded : depuis les Chrome récents, les DÉPRÉCIATIONS (et d'autres problèmes que le navigateur
   détecte lui-même) ne sont plus écrites dans la console ni dans Log.entryAdded mais publiées comme
   « problèmes » (le panneau Issues des DevTools). On en retient les utiles — dépréciations, contenu mixte,
   CORS, réponses bloquées, publicités lourdes, mode quirks — pas le bruit d'accessibilité ni de formulaire ;
   la violation de CSP arrive déjà par Log.entryAdded. */
const ISSUES_UTILES = {
  DeprecationIssue: 'deprecation', HeavyAdIssue: 'intervention', MixedContentIssue: 'issue', CorsIssue: 'issue',
  BlockedByResponseIssue: 'issue', QuirksModeIssue: 'issue', SharedArrayBufferIssue: 'issue',
};
function depuisIssue(p) {
  const i = (p && p.issue) || {};
  if (!Object.prototype.hasOwnProperty.call(ISSUES_UTILES, i.code)) return null;
  const det = i.details || {};
  const type = ISSUES_UTILES[i.code];
  const dep = det.deprecationIssueDetails;
  const lieu = (dep && dep.sourceCodeLocation) || {};
  const precis = dep ? dep.type : i.code;
  return entree('navigateur', 'warn', type, (type === 'deprecation' ? 'dépréciation signalée par le navigateur : ' : 'problème signalé par le navigateur : ') + precis,
    { url: lieu.url || null, ligne: typeof lieu.lineNumber === 'number' ? lieu.lineNumber + 1 : null, detail: precis });
}
function texteArg(a) { return a.value !== undefined ? String(a.value) : (a.description || a.type); }
/* Runtime.consoleAPICalled : console.* de la page ou d'un worker. */
function depuisConsole(p, session) {
  const niveau = { error: 'error', warning: 'warn', warn: 'warn', debug: 'debug', info: 'info', log: 'info', trace: 'trace', assert: 'error' }[p.type] || 'info';
  return entree(session ? 'worker' : 'console', niveau, 'console.' + p.type, (p.args || []).map(texteArg).join(' '), { worker: session || null });
}
/* Network.loadingFailed / responseReceived : ressource introuvable ou refusée
   (SPEC-BANC-099). `requetes` : requestId → { url, type }. */
function depuisEchecReseau(p, requetes) {
  const r = (requetes && requetes.get && requetes.get(p.requestId)) || {};
  if (p.canceled && !p.blockedReason) return null;                 // annulée par la page elle-même : pas une panne
  return entree('reseau', 'error', 'ressource', 'ressource non chargée : ' + (r.url || '?') + ' — ' + (p.errorText || p.blockedReason || 'échec'), { url: r.url || null, type_ressource: p.type || r.type || null });
}
function depuisReponse(p) {
  const rep = (p && p.response) || {};
  if (!(rep.status >= 400)) return null;
  return entree('reseau', 'error', 'ressource', 'ressource introuvable : ' + rep.url + ' — HTTP ' + rep.status + (rep.statusText ? ' ' + rep.statusText : ''), { url: rep.url, statut: rep.status, type_ressource: p.type || null });
}
/* Une ligne lisible par entrée (la forme des journaux de tests). */
function formaterEntree(e) {
  const l = heure(e.t) + ' ' + String(e.niveau || 'info').toUpperCase() + ' ' + String(e.source || '').toUpperCase() + (e.type ? ':' + e.type : '') + (e.worker ? ' [worker]' : '') + ' ' + e.message;
  return e.pile ? l + '\n' + String(e.pile).split('\n').map(x => '    ' + x.trim()).join('\n') : l;
}
/* Ce que la console ne montre pas : tout sauf les console.* ordinaires. */
function estErreurCachee(e) {
  if (!e) return false;
  if (e.source === 'console') return false;
  if (e.type && /^console\./.test(e.type)) return false;
  return e.niveau === 'error' || e.niveau === 'warn' || e.type === 'exception' || e.type === 'deprecation' || e.type === 'intervention';
}
/* Doublon d'une même panne vue par deux voies (script de la page ET CDP). */
function cleDoublon(e) {
  // « Uncaught Error: x » (évènement de la page) et « Error: x » (CDP) désignent la même panne
  const b = String(e.message || '').replace(/^Uncaught (\(in promise\) )?/, '').replace(/\s+/g, ' ').slice(0, 120);
  return (e.type === 'exception' || e.type === 'promesse_rejetee' || e.type === 'exception_page' ? 'exception' : (e.type || '')) + '|' + b;
}
function fusionner(listes) {
  const vus = new Set(), out = [];
  [].concat.apply([], listes.filter(Boolean)).sort((a, b) => (a.t || 0) - (b.t || 0)).forEach((e) => {
    const k = cleDoublon(e);
    if (vus.has(k)) return;
    vus.add(k); out.push(e);
  });
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// 3. Collecteur CDP : exceptions, messages du navigateur, réseau, workers
// ══════════════════════════════════════════════════════════════════════════
const TYPES_WORKER = ['worker', 'service_worker', 'shared_worker'];
class CollecteurCDP {
  constructor(session, opts) {
    this.session = session;
    this.opts = opts || {};
    this.max = this.opts.max || MAX_ENTREES;
    this.entrees = [];
    this.total = 0;               // nombre d'entrées vues depuis le début (même celles sorties du tampon)
    this.marque = 0;
    this.requetes = new Map();
    this.workers = new Map();     // sessionId → url
    this.attache = false;
  }
  _ajouter(e) {
    if (!e) return;
    this.entrees.push(e); this.total++;
    if (this.entrees.length > this.max) this.entrees.shift();
  }
  /* Active les domaines CDP, installe `scriptNouveauDocument` AVANT les
     scripts de la page (Page.addScriptToEvaluateOnNewDocument, SPEC-BANC-095)
     et suit les workers (Target.setAutoAttach, SPEC-BANC-097). */
  async attacher(opts) {
    const o = Object.assign({}, this.opts, opts || {});
    const s = this.session;
    s.sur('Runtime.exceptionThrown', (p, sid) => this._ajouter(depuisExceptionThrown(p, sid ? (this.workers.get(sid) || 'worker') : null)));
    s.sur('Runtime.consoleAPICalled', (p, sid) => this._ajouter(depuisConsole(p, sid ? (this.workers.get(sid) || 'worker') : null)));
    s.sur('Log.entryAdded', (p, sid) => this._ajouter(depuisLogEntry(p, sid ? (this.workers.get(sid) || 'worker') : null)));
    s.sur('Audits.issueAdded', (p) => this._ajouter(depuisIssue(p)));
    s.sur('Network.requestWillBeSent', (p) => { if (this.requetes.size > 5000) this.requetes.clear(); this.requetes.set(p.requestId, { url: p.request && p.request.url, type: p.type }); });
    s.sur('Network.loadingFailed', (p) => this._ajouter(depuisEchecReseau(p, this.requetes)));
    s.sur('Network.responseReceived', (p) => this._ajouter(depuisReponse(p)));
    s.sur('Target.attachedToTarget', (p) => {
      const info = p.targetInfo || {};
      if (TYPES_WORKER.indexOf(info.type) < 0) return;
      this.workers.set(p.sessionId, info.url || info.type);
      // le worker démarre en pause tant que `waitForDebuggerOnStart` est vrai : ici il ne l'est pas, on active ses domaines au vol
      ['Runtime.enable', 'Log.enable'].forEach((m) => { s.envoyer(m, {}, 5000, p.sessionId).catch(() => { /* worker déjà terminé */ }); });
    });
    await s.envoyer('Page.enable', {}, 10000);
    await s.envoyer('Runtime.enable', {}, 10000);
    try { await s.envoyer('Log.enable', {}, 10000); } catch (e) { /* facultatif */ }
    try { await s.envoyer('Network.enable', {}, 10000); } catch (e) { /* facultatif */ }
    try { await s.envoyer('Audits.enable', {}, 10000); } catch (e) { /* navigateur sans le domaine : dépréciations non vues */ }
    try { await s.envoyer('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, 10000); } catch (e) { /* workers non suivis */ }
    if (o.scriptNouveauDocument) await s.envoyer('Page.addScriptToEvaluateOnNewDocument', { source: o.scriptNouveauDocument }, 10000);
    this.attache = true;
  }
  /* Début d'un test : tout ce qui vient ensuite lui appartient. */
  debutTest() { this.marque = this.total; this.t0 = Date.now(); }
  /* Les entrées arrivées depuis `debutTest` (celles que le tampon a déjà
     perdues sont comptées dans `perdues`). */
  depuisDebut() {
    const n = this.total - this.marque;
    const dispo = Math.min(n, this.entrees.length);
    return { entrees: this.entrees.slice(this.entrees.length - dispo), perdues: n - dispo };
  }
  /* Fin d'un test : { vol, erreursCachees } — le vol est TOUT ce que le
     navigateur a dit, les erreurs cachées ce que console.* ne montre pas. */
  finTest() {
    const { entrees, perdues } = this.depuisDebut();
    return {
      vol: entrees.map(formaterEntree), volPerdues: perdues,
      erreursCachees: entrees.filter(estErreurCachee),
    };
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 4. Profil CPU d'un test lent (SPEC-BANC-101)
// ══════════════════════════════════════════════════════════════════════════
function slug(t) { return String(t || 'test').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).toLowerCase() || 'test'; }
async function demarrerProfilCPU(session) {
  await session.envoyer('Profiler.enable', {}, 10000);
  try { await session.envoyer('Profiler.setSamplingInterval', { interval: 1000 }, 10000); } catch (e) { /* intervalle par défaut */ }
  await session.envoyer('Profiler.start', {}, 10000);
}
/* Un .cpuprofile que les DevTools de Chrome ouvrent : nœuds, échantillons,
   écarts de temps et bornes temporelles, tous cohérents. */
function validerCpuprofile(p) {
  if (!p || typeof p !== 'object') return false;
  if (!Array.isArray(p.nodes) || !p.nodes.length || !Array.isArray(p.samples) || !Array.isArray(p.timeDeltas)) return false;
  if (typeof p.startTime !== 'number' || typeof p.endTime !== 'number' || p.endTime < p.startTime) return false;
  if (p.samples.length !== p.timeDeltas.length) return false;
  const ids = new Set(p.nodes.map(n => n.id));
  return p.nodes.every(n => n && typeof n.id === 'number' && n.callFrame && typeof n.callFrame.functionName === 'string') && p.samples.every(id => ids.has(id));
}
/* Arrête le profil et l'écrit dans `dossier` (<nom>.cpuprofile). Rend
   { source, octets, noeuds, echantillons, duree_ms } ou null si le profil est
   inutilisable. */
async function arreterProfilCPU(session, dossier, nom) {
  const r = await session.envoyer('Profiler.stop', {}, 60000);
  try { await session.envoyer('Profiler.disable', {}, 10000); } catch (e) { /* rien */ }
  const profil = r && r.profile;
  if (!validerCpuprofile(profil)) return null;
  fs.mkdirSync(dossier, { recursive: true });
  const source = path.join(dossier, slug(nom) + '-' + Date.now().toString(36) + '.cpuprofile');
  const texte = JSON.stringify(profil);
  fs.writeFileSync(source, texte);
  return { source, octets: Buffer.byteLength(texte), noeuds: profil.nodes.length, echantillons: profil.samples.length, duree_ms: Math.round((profil.endTime - profil.startTime) / 1000), top: resumerCpuprofile(profil, 8) };
}
/* Ce qu'un humain veut d'abord voir d'un profil : les fonctions qui ont pris
   le plus de temps propre. */
function resumerCpuprofile(p, n) {
  if (!validerCpuprofile(p)) return [];
  const parId = new Map(p.nodes.map(x => [x.id, x]));
  const temps = new Map();
  for (let i = 0; i < p.samples.length; i++) temps.set(p.samples[i], (temps.get(p.samples[i]) || 0) + (p.timeDeltas[i] || 0));
  const parFn = new Map();
  temps.forEach((us, id) => {
    const cf = parId.get(id).callFrame;
    const k = (cf.functionName || '(anonyme)') + ' ' + (cf.url || '') + ':' + (cf.lineNumber + 1);
    parFn.set(k, (parFn.get(k) || 0) + us);
  });
  return Array.from(parFn.entries()).sort((a, b) => b[1] - a[1]).slice(0, n || 10).map(([fonction, us]) => ({ fonction, ms: Math.round(us / 100) / 10 }));
}

// ══════════════════════════════════════════════════════════════════════════
// 5. Profil GPU, couches côté processus et système (SPEC-BANC-102)
// ══════════════════════════════════════════════════════════════════════════
const NON_DISPONIBLE = (raison) => ({ disponible: false, raison });
/* CDP SystemInfo.getInfo (cible navigateur) : GPU, pilote, fonctionnalités
   accélérées — résumé stable, jamais simulé. */
async function lireInfoGPUProcessus(sessionNavigateur) {
  if (!sessionNavigateur) return NON_DISPONIBLE('session du navigateur non ouverte');
  try {
    const r = await sessionNavigateur.envoyer('SystemInfo.getInfo', {}, 10000);
    const g = (r && r.gpu) || {};
    return {
      disponible: true,
      peripheriques: (g.devices || []).map(d => ({ fabricant: d.vendorString, modele: d.deviceString, pilote: d.driverVendor, version_pilote: d.driverVersion })),
      fonctionnalites: g.featureStatus || null,
      anomalies_pilote: (g.driverBugWorkarounds || []).map(x => x.name),
    };
  } catch (e) { return NON_DISPONIBLE('SystemInfo.getInfo indisponible : ' + e.message); }
}
/* L'id du processus GPU du navigateur (CDP SystemInfo.getProcessInfo). */
async function pidProcessusGPU(sessionNavigateur) {
  try {
    const r = await sessionNavigateur.envoyer('SystemInfo.getProcessInfo', {}, 10000);
    const p = ((r && r.processInfo) || []).find(x => x.type === 'GPU' || x.type === 'gpu');
    return p ? p.id : null;
  } catch (e) { return null; }
}
/* Trace Chrome (catégories gpu et disabled-by-default-gpu.service) d'un test
   lent, ouvrable dans le visualiseur de performances. Les évènements sont
   bornés. */
const CATEGORIES_TRACE_GPU = 'gpu,disabled-by-default-gpu.service';
const MAX_EVENEMENTS_TRACE = 200000;
class TraceGPU {
  constructor(session) { this.session = session; this.evenements = []; this.actif = false; this.tronquee = false; }
  async demarrer() {
    const s = this.session;
    this.evenements = [];
    s.sur('Tracing.dataCollected', (p) => {
      (p.value || []).forEach((ev) => { if (this.evenements.length < MAX_EVENEMENTS_TRACE) this.evenements.push(ev); else this.tronquee = true; });
    });
    await s.envoyer('Tracing.start', { categories: CATEGORIES_TRACE_GPU, transferMode: 'ReportEvents' }, 15000);
    this.actif = true;
  }
  /* Termine la trace et l'écrit (JSON « traceEvents »). Rend { source, evenements, tronquee } ou null. */
  async arreter(dossier, nom) {
    if (!this.actif) return null;
    this.actif = false;
    const fini = new Promise((resolve) => { this.session.sur('Tracing.tracingComplete', () => resolve(true)); setTimeout(() => resolve(false), 30000).unref(); });
    await this.session.envoyer('Tracing.end', {}, 15000);
    await fini;
    if (!this.evenements.length) return null;
    fs.mkdirSync(dossier, { recursive: true });
    const source = path.join(dossier, slug(nom) + '-gpu-' + Date.now().toString(36) + '.trace.json');
    fs.writeFileSync(source, JSON.stringify({ traceEvents: this.evenements }));
    return { source, evenements: this.evenements.length, tronquee: this.tronquee };
  }
}
/* Windows, facultatif : compteurs `typeperf` du processus GPU du navigateur
   (VRAM dédiée et occupation du moteur), uniquement en run fenêtré sur un vrai
   GPU. `executer(cmd, args)` rend la sortie texte (injectable en test). */
const COMPTEURS_WINDOWS = ['\\GPU Process Memory(*)\\Dedicated Usage', '\\GPU Engine(*)\\Utilization Percentage'];
function parserTypeperf(sortie) {
  const lignes = String(sortie || '').split(/\r?\n/).map(l => l.trim()).filter(l => l.startsWith('"'));
  if (lignes.length < 2) return [];
  const decouper = (l) => (l.match(/"([^"]*)"/g) || []).map(x => x.slice(1, -1));
  const noms = decouper(lignes[0]), vals = decouper(lignes[1]);
  const out = [];
  for (let i = 1; i < noms.length; i++) {
    const v = parseFloat(vals[i]);
    if (isFinite(v)) out.push({ compteur: noms[i].replace(/^\\\\[^\\]*/, ''), valeur: v });
  }
  return out;
}
function lireCompteursSysteme(env, pidGpu, executer) {
  if (!env || process.platform !== 'win32' && !executer) return NON_DISPONIBLE('compteurs typeperf : Windows seulement');
  if (!env.avecFenetre) return NON_DISPONIBLE('compteurs typeperf : run sans fenêtre (le processus GPU n\'est pas celui d\'un affichage réel)');
  if (env.accelerationMaterielle !== true) return NON_DISPONIBLE('compteurs typeperf : rendu logiciel, pas de vrai GPU');
  const exec = executer || ((cmd, args) => require('child_process').execFileSync(cmd, args, { encoding: 'utf8', timeout: 15000, windowsHide: true }));
  try {
    const sortie = exec('typeperf', COMPTEURS_WINDOWS.concat(['-sc', '1']));
    let mesures = parserTypeperf(sortie);
    if (pidGpu) mesures = mesures.filter(m => m.compteur.indexOf('pid_' + pidGpu + '_') >= 0);
    return { disponible: true, pid_gpu: pidGpu || null, mesures };
  } catch (e) { return NON_DISPONIBLE('typeperf a échoué : ' + (e.message || e).split('\n')[0]); }
}
/* Assemble le profil GPU d'un test : la couche du jeu (lue dans la page,
   render.profilGPU()) complétée par les couches du processus et du système.
   Chaque couche dit « non disponible » plutôt que de simuler. */
function assemblerProfilGPU(jeu, processus, systeme, trace) {
  const j = jeu || {};
  const couches = {
    memoire: j.memoire || NON_DISPONIBLE('profil GPU du jeu non lu'),
    dessin: j.dessin || NON_DISPONIBLE('profil GPU du jeu non lu'),
    temps_gpu: j.temps_gpu || NON_DISPONIBLE('profil GPU du jeu non lu'),
    processus: processus || NON_DISPONIBLE('session du navigateur non ouverte'),
    systeme: systeme || NON_DISPONIBLE('non demandé'),
  };
  if (trace) couches.processus = Object.assign({}, couches.processus, { trace: trace });
  return { couches };
}
/* Une couche est « renseignée » quand elle est disponible ; jamais de valeur
   inventée pour une couche qui ne l'est pas. */
function couchesRenseignees(profil) {
  return Object.keys((profil && profil.couches) || {}).filter(k => profil.couches[k] && profil.couches[k].disponible === true);
}

// ══════════════════════════════════════════════════════════════════════════
// 6. Journal des serveurs lancés par un test d'intégration (SPEC-BANC-100)
// ══════════════════════════════════════════════════════════════════════════
const RE_PANNE_SERVEUR = /EXCEPTION NON RATTRAPÉE|PROMESSE REJETÉE|\b(ERROR|FATAL)\b/;
/* Lit les fichiers `serveur-*.log` d'un dossier de journal (celui qu'un test
   d'intégration a donné à ses serveurs par MC_JOURNAL_DOSSIER) : toutes les
   lignes (bornées), et les pannes — exceptions non rattrapées et promesses
   rejetées par process.on('uncaughtException'/'unhandledRejection'), avec leur
   pile (les lignes indentées qui suivent). */
function recolterJournalServeur(dossier, opts) {
  const o = opts || {};
  const max = o.maxLignes || 400;
  let fichiers = [];
  try { fichiers = fs.readdirSync(dossier).filter(f => /^serveur-.*\.log$/.test(f)).sort(); } catch (e) { return { lignes: [], pannes: [], fichiers: [] }; }
  let lignes = [];
  fichiers.forEach((f) => {
    let st = null;
    try { st = fs.statSync(path.join(dossier, f)); } catch (e) { return; }
    if (o.depuisMs && st.mtimeMs < o.depuisMs) return;
    let texte = '';
    try { texte = fs.readFileSync(path.join(dossier, f), 'utf8'); } catch (e) { return; }
    lignes = lignes.concat(texte.split(/\r?\n/).filter(Boolean));
  });
  const pannes = [];
  lignes.forEach((l, i) => {
    if (l.startsWith(' ') || !RE_PANNE_SERVEUR.test(l)) return;
    const pile = [];
    for (let k = i + 1; k < lignes.length && /^\s/.test(lignes[k]); k++) pile.push(lignes[k].trim());
    pannes.push({ ligne: l, pile: pile.join('\n') });
  });
  return { lignes: lignes.length > max ? lignes.slice(-max) : lignes, pannes, fichiers };
}

// ══════════════════════════════════════════════════════════════════════════
// 7. Messages réseau échangés (SPEC-BANC-103)
// ══════════════════════════════════════════════════════════════════════════
const RE_TRACE_SERVEUR = /^(?:\d+\s+)?(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+\w+\s+RESEAU\s+(recu|envoi)\s+(\S+)(?:\s+seq=(\S+))?(?:\s+taille=(\d+))?/;
/* Extrait d'un journal de serveur les lignes de trace réseau
   (RESEAU:trace) : { cote:'serveur', sens, type, seq, taille, t }. */
function messagesDuJournalServeur(lignes) {
  const out = [];
  (lignes || []).forEach((l) => {
    const m = RE_TRACE_SERVEUR.exec(l);
    if (!m) return;
    out.push({ cote: 'serveur', sens: m[2], type: m[3], seq: m[4] !== undefined && m[4] !== '-' ? Number(m[4]) : null, taille: m[5] !== undefined ? Number(m[5]) : null, t: Date.parse(m[1]) });
  });
  return out;
}
/* Les N derniers messages des deux côtés, dans l'ordre du temps. */
function fusionnerMessagesReseau(client, serveur, n) {
  const tous = [].concat((client || []).map(m => Object.assign({ cote: 'client' }, m)), (serveur || []).map(m => Object.assign({ cote: 'serveur' }, m)))
    .filter(m => m && typeof m.t === 'number').sort((a, b) => a.t - b.t);
  return tous.slice(Math.max(0, tous.length - (n || 50)));
}
/* Le bloc `reseau` joint au rapport d'un test réseau en échec. */
function rapportReseau(client, serveurJournal, n) {
  const duServeur = messagesDuJournalServeur(serveurJournal);
  return {
    messages: fusionnerMessagesReseau(client, duServeur, n),
    journal_serveur: (serveurJournal || []).slice(-(n || 50)),
  };
}

module.exports = {
  CLES_DIAGNOSTICS, ETATS_ECHEC, normaliserReseau, SEUIL_LENT_DEFAUT_MS, estEchec, estLent, declencheur, appliquerPolitique, appliquerPolitiqueCampagne,
  entree, depuisExceptionThrown, depuisLogEntry, depuisIssue, ISSUES_UTILES, depuisConsole, depuisEchecReseau, depuisReponse, formaterEntree, estErreurCachee, cleDoublon, fusionner,
  CollecteurCDP, TYPES_WORKER,
  slug, demarrerProfilCPU, arreterProfilCPU, validerCpuprofile, resumerCpuprofile,
  NON_DISPONIBLE, lireInfoGPUProcessus, pidProcessusGPU, TraceGPU, CATEGORIES_TRACE_GPU, parserTypeperf, lireCompteursSysteme, COMPTEURS_WINDOWS, assemblerProfilGPU, couchesRenseignees,
  recolterJournalServeur, messagesDuJournalServeur, fusionnerMessagesReseau, rapportReseau,
};
