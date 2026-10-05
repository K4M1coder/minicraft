/* serveur-http.js — le service HTTP
   Fichiers statiques, API d'administration (/admin/api/*), API des parties
   (/api/parties…), version, et l'aiguillage `servir`.

   Module du serveur (SPEC-SERVEUR-008) : extrait de server.js sans changement
   de comportement. Il ne touche ni socket ni fichier par lui-même : tout ce
   dont il dépend arrive par le contexte S (état partagé, fonctions des autres
   modules) et S.hote (minuteries, process, Buffer… de Node), que server.js
   construit puis passe à `installer(S)`. Installer publie dans S les
   fonctions et valeurs de ce module dont les autres ont besoin. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};

  function installer(S) {
    const { Buffer, Promise, URL, __filename, clearTimeout, process, require, setTimeout } = S.hote;
    const {
      fs, path, RACINE, argvBrut, NP, C, COMMIT_GIT, CONF, CA, DOSSIER_PARTIES,
      stockageParties, ADMIN_SECRET, admin, entites, conteneursPoses, sauvegarderMondeAsync,
      sauvegarderMondeSync, clients, journal,
    } = S;
    const EP = S.EP;   // état partagé modifiable, à forme fixe (créé par server.js)
    Object.assign(S, { cheminSur, cheminBanc, lireCorpsJSON, repondreJSON, refusRequeteLocale, servir });

    // ── fichiers statiques ───────────────────────────────────────────────────────
    const TYPES = {
      '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
      '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon',
    };

    /* LISTE BLANCHE (SPEC-NET-020, revue de sécurité) : le dossier du serveur
       est un dépôt complet — .git, .claude/, node_modules/, logs/, parties/,
       outils, cahiers, sources du serveur. Filtrer ce qui est interdit ne tient
       pas sous Windows, qui ignore la casse, le point ou l'espace final d'un
       nom, accepte l'antislash comme séparateur, les flux NTFS (« ::$DATA »)
       et les noms courts 8.3 (« GIT~1 ») : on ne sert QUE des chemins décrits
       exactement, une fois l'URL décodée, en minuscules ASCII, chiffres et
       tirets — sans point de tête, sans antislash, sans « : », « ~ », « % »
       (un double encodage reste refusé) ni espace. */
    const RESSOURCES_JEU = [
      /^\/(index|admin)\.html$/,
      /^\/src\/[a-z0-9][a-z0-9-]*\.(js|css)$/,
    ];
    // relue par l'audit « tout fichier de src/ est servi » (tests/spec-serveur-modules.js)
    S.RESSOURCES_JEU = RESSOURCES_JEU;
    /* Le banc (SPEC-BANC-120/122) : servi seulement avec --tests et à une
       requête locale (voir `servir`) ; SPECS.md est relu par sa page. */
    const RESSOURCES_BANC = [
      /^\/SPECS\.md$/,
      /^\/tests\/[a-z0-9][a-z0-9-]*\.(html|js|css)$/,
      /^\/tests\/donnees\/[a-z0-9][a-z0-9-]*\.json$/,
      /^\/tests\/resultats\/[A-Za-z0-9][A-Za-z0-9_-]*\/(rapport\.html|resultats\.json|captures\/[A-Za-z0-9][A-Za-z0-9_-]*\.(png|jpg|jpeg|webp))$/,
    ];
    function decoderChemin(urlPath) {
      try { return decodeURIComponent(String(urlPath).split('?')[0]); }
      catch (e) { return null; }
    }
    /* Ressource du JEU (tous les modes) : chemin absolu sur disque, ou null. */
    function cheminSur(urlPath) {
      let brut = decoderChemin(urlPath);
      if (brut === '/' || brut === '') brut = '/index.html';
      return resoudre(brut, RESSOURCES_JEU);
    }
    /* Ressource du BANC : chemin absolu sur disque, ou null. */
    function cheminBanc(urlPath) {
      let brut = decoderChemin(urlPath);
      if (brut === '/tests/') brut = '/tests/index.html';   // page du banc (SPEC-BANC-120)
      return resoudre(brut, RESSOURCES_BANC);
    }
    /* Piège classique : « ../../etc/passwd ». La liste blanche l'exclut déjà ;
       on résout tout de même le chemin ABSOLU et on vérifie qu'il reste sous la
       racine, hors des parties (défense en profondeur). */
    /* Racine des fichiers servis : celle du serveur, ou MC_TEST_RACINE_STATIQUE (réglage de test
       annoncé au démarrage par server.js, jamais en exploitation) — les tests des chemins piégés
       y posent leurs leurres sans jamais écrire dans le dépôt. */
    const RACINE_STATIQUE = S.RACINE_STATIQUE || RACINE;
    function resoudre(brut, motifs) {
      if (typeof brut !== 'string' || !motifs.some(re => re.test(brut))) return null;
      const resolu = path.resolve(RACINE_STATIQUE, '.' + brut);
      const racine = path.resolve(RACINE_STATIQUE);
      // le séparateur final évite que /racine-bis passe pour /racine
      if (resolu !== racine && !resolu.startsWith(racine + path.sep)) return null;
      // les parties (index et fichiers de monde) et le fichier --monde ne se servent JAMAIS en statique
      const prives = [DOSSIER_PARTIES, path.resolve(RACINE, 'parties'), path.resolve(RACINE_STATIQUE, 'parties')];
      if (CONF.mondeFichier) prives.push(CONF.mondeFichier);
      for (const d of prives) {
        if (resolu === d || resolu.startsWith(d + path.sep) || resolu.startsWith(d + '.')) return null;
      }
      return resolu;
    }

    // ── console web d'administration : API HTTP (SPEC-ADMIN-001 à 005/007) ─────
    /* Le jeton n'est JAMAIS accepté en paramètre d'URL (un lien reste dans
       l'historique, les journaux du proxy, l'onglet ouvert des semaines) :
       uniquement l'en-tête Authorization, comme n'importe quelle API. */
    function roleRequete(req) {
      const ent = req.headers.authorization || '';
      const m = /^Bearer\s+(.+)$/.exec(ent);
      if (!m) return null;
      return MC.Admin.authentifier(admin, m[1]);
    }
    function lireCorpsJSON(req, cb) {
      let brut = '';
      req.on('data', d => { brut += d; if (brut.length > 8192) req.destroy(); });
      req.on('end', () => { try { cb(brut ? JSON.parse(brut) : {}); } catch (e) { cb({}); } });
    }
    function repondreJSON(res, code, obj) {
      const corps = JSON.stringify(obj);
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(corps) });
      res.end(corps);
    }

    const RE_API = /^\/admin\/api\/([a-z_]+)\/?$/;
    function traiterApiAdmin(req, res) {
      const url = req.url.split('?')[0];
      const mm = RE_API.exec(url);
      if (!mm) return false;
      const action = mm[1];
      const r = roleRequete(req);
      if (!r) { repondreJSON(res, 401, { ok: false, motif: 'non_authentifie' }); return true; }
      if (req.method === 'GET') {
        const q = {};
        new URL(req.url, 'http://localhost').searchParams.forEach((v, k) => { q[k] = v; });
        const res2 = S.executerActionAdmin(r.role, r.nom || 'console', action, q);
        repondreJSON(res, res2.ok ? 200 : 403, res2);
        return true;
      }
      if (req.method === 'POST') {
        lireCorpsJSON(req, (args) => {
          const res2 = S.executerActionAdmin(r.role, r.nom || 'console', action, args);
          repondreJSON(res, res2.ok ? 200 : 403, res2);
        });
        return true;
      }
      repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' });
      return true;
    }

    // ── /tests/version (SPEC-BANC-012) ──────────────────────────────────────────
    /* L'environnement d'un cahier navigateur doit porter le commit (comme le
       fait déjà l'environnement d'un cahier Node, calculé directement sur
       disque par tests/run.js) : le navigateur n'a pas accès à git, donc le
       noyau le lui sert. Même garde que /tests/cahiers (machine locale
       uniquement) ; GET seulement, pas d'écriture donc pas de risque CSRF. */
    function traiterVersion(req, res) {
      if (req.url.split('?')[0] !== '/tests/version') return false;
      const RT = require('./tools/resultats-tests.js');
      if (!RT.estAdresseLocale(req.socket.remoteAddress)) { repondreJSON(res, 403, { ok: false, motif: 'adresse non locale' }); return true; }
      if (req.method !== 'GET') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return true; }
      repondreJSON(res, 200, { commit: COMMIT_GIT, versionJeu: C.VERSION_JEU });
      return true;
    }

    // ── API des parties (SPEC-ARCHI-013, 015) ────────────────────────────────────
    /* Le menu du jeu (créer, charger, renommer, supprimer, lister, importer) agit
       par cette API HTTP, RÉSERVÉE à la boucle locale et aux origines locales
       (mêmes règles que SPEC-ARCHI-003), quel que soit le mode réseau : un joueur
       distant n'a aucun droit sur les parties de la machine hôte. */
    const CORPS_API_MAX = 64 * 1024 * 1024;       // un export de plusieurs parties peut être volumineux
    function lireCorpsGros(req, max, cb) {
      const morceaux = [];
      let taille = 0, depasse = false;
      req.on('data', (d) => {
        taille += d.length;
        if (taille > max) { depasse = true; req.destroy(); return; }
        morceaux.push(d);
      });
      req.on('end', () => {
        if (depasse) return;
        try { cb(null, morceaux.length ? JSON.parse(Buffer.concat(morceaux).toString('utf8')) : {}); }
        catch (e) { cb(e); }
      });
    }
    /* Garde commune des routes réservées à la boucle locale (API des parties, serveur d'histoire de test) :
       adresse locale ET hôte local ET pas de mandataire ET origine/Sec-Fetch-Site sûrs. Renvoie le motif
       du refus, ou null. */
    function refusRequeteLocale(req) {
      if (req.headers['x-forwarded-for'] || req.headers['forwarded'] || req.headers['x-real-ip']) return 'mandataire refusé';     // comme connexionLocale
      if (!CA.estAdresseLocale(req.socket.remoteAddress)) return 'adresse non locale';
      const origine = req.headers['origin'];
      if (origine && CA.originesLocales(EP.portActuel).indexOf(origine) < 0) return 'origine refusée';
      if (!S.hoteLocal(req)) return 'hôte refusé';
      if (req.headers['sec-fetch-site'] === 'cross-site') return 'requête intersites refusée';
      return null;
    }
    function apiPartiesAutorisee(req, res) {
      const motif = refusRequeteLocale(req);
      if (motif) { repondreJSON(res, 403, { ok: false, motif }); return false; }
      return true;
    }
    let derniereDemandeSauvegarde = 0;
    function entierOuNul(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v ? v : null; }
    function traiterApiParties(req, res) {
      if (!apiPartiesAutorisee(req, res)) return;
      const sous = req.url.split('?')[0].replace(/\/+$/, '').slice('/api/parties'.length);
      if (req.method === 'GET' && sous === '') {
        repondreJSON(res, 200, {
          ok: true, actif: EP.partieActive ? EP.partieActive.id : null, parties: MC.Saves.lister(stockageParties),
          reseau: EP.reseauOuvert ? CA.ETAT_RESEAU.OUVERT : CA.ETAT_RESEAU.FERME, port: EP.portActuel, adresses: EP.adressesActives,
          dedie: !!(CONF.mondeFichier && !EP.partieActive),
          // instantané du monde pour les lanceurs et les tests : l'heure, la pause, les créatures
          monde: {
            heure: +EP.heure.toFixed(3), pause: EP.enPause, rev: EP.pauseRev, clients: clients.size, pid: process.pid,
            creatures: entites.list.length,
            fours: Array.from(conteneursPoses.entries()).filter(([, ct]) => ct.four)
              .map(([cle, ct]) => ({ cle, burn: +ct.four.burn.toFixed(3), cook: +ct.four.cook.toFixed(3), sortie: ct.slots[2] ? ct.slots[2].n : 0 })),
            sigCreatures: +entites.list.reduce((a, e) => a + e.pos.x + e.pos.z, 0).toFixed(3),
          },
        });
        return;
      }
      if (req.method !== 'POST') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return; }
      lireCorpsGros(req, sous === '/importer' ? CORPS_API_MAX : 65536, (err, corps) => {
        if (err) { repondreJSON(res, 400, { ok: false, motif: 'json_invalide' }); return; }
        const id = corps && typeof corps.id === 'string' ? corps.id : null;
        const connue = id && MC.PartiesFichier.idValide(id) ? MC.Saves.trouver(stockageParties, id) : null;
        switch (sous) {
          case '': {                                                           // créer
            const graine = entierOuNul(corps.graine);
            const meta = MC.Saves.creer(stockageParties, {
              nom: typeof corps.nom === 'string' ? corps.nom.trim() : '',
              mode: MC.Modes.MODES[corps.mode] ? corps.mode : 'survie',
              difficulte: MC.Modes.DIFFICULTES[corps.difficulte] ? corps.difficulte : 'facile',
              graine: graine === null ? undefined : graine,
              histoire: corps.histoire && typeof corps.histoire === 'object' ? corps.histoire : null,
            });
            if (graine !== null) MC.Saves.majMeta(stockageParties, meta.id, { graine });
            const enreg = MC.Saves.trouver(stockageParties, meta.id);
            if (!enreg) { repondreJSON(res, 500, { ok: false, motif: 'ecriture_impossible' }); return; }
            repondreJSON(res, 201, { ok: true, partie: enreg });
            return;
          }
          case '/charger': {
            if (!connue) { repondreJSON(res, 404, { ok: false, motif: 'partie_inconnue' }); return; }
            if (EP.partieActive && EP.partieActive.id === connue.id) { repondreJSON(res, 200, { ok: true, relance: false, partie: connue }); return; }
            repondreJSON(res, 200, { ok: true, relance: true, partie: connue, port: EP.portActuel });
            res.on('finish', () => relancerSurPartie(connue.id));
            return;
          }
          /* SPEC-ARCHI-036 : « Sauvegarder » du menu pause (ou la touche) est une
             DEMANDE au serveur, qui reste seul à écrire la partie. Réservée à la
             boucle locale par apiPartiesAutorisee (jamais un joueur distant),
             espacée d'une seconde au moins (la sérialisation bloque la boucle) ;
             omise, comme toute sauvegarde événementielle, si le monde n'a pas bougé. */
          case '/sauver': {
            if (!CONF.mondeFichier) { repondreJSON(res, 409, { ok: false, motif: 'pas_de_partie' }); return; }
            // SPEC-SAVE-026 : le monde refusé n'a pas pu être mis de côté — rien n'est écrit, et on le dit
            if (EP.ecritureMondeInterdite) { repondreJSON(res, 409, { ok: false, motif: 'ecriture_interdite' }); return; }
            const t = Date.now();
            if (t - derniereDemandeSauvegarde < 1000) { repondreJSON(res, 429, { ok: false, motif: 'trop_frequent' }); return; }
            derniereDemandeSauvegarde = t;
            const avant = EP.nbEcritures;
            sauvegarderMondeAsync('demande du joueur', true);
            /* On répond quand PLUS AUCUNE écriture n'est en vol : une écriture périodique déjà
               en cours n'a pas capturé l'état actuel, la sauvegarde redemandée qui la suit oui. */
            const limite = Date.now() + 5000;
            (async () => {
              while (EP.sauvegardeEnCoursAttente && Date.now() < limite) {
                let minuterie;
                await Promise.race([EP.sauvegardeEnCoursAttente, new Promise((r) => { minuterie = setTimeout(r, Math.max(1, limite - Date.now())); })]);
                clearTimeout(minuterie);
              }
              repondreJSON(res, 200, { ok: true, ecrite: EP.nbEcritures > avant, enVol: !!EP.sauvegardeEnCoursAttente });
            })();
            return;
          }
          case '/renommer': {
            if (!connue) { repondreJSON(res, 404, { ok: false, motif: 'partie_inconnue' }); return; }
            const m = MC.Saves.renommer(stockageParties, connue.id, corps.nom);
            if (EP.partieActive && EP.partieActive.id === connue.id && m) EP.partieActive = m;
            repondreJSON(res, 200, { ok: true, partie: m });
            return;
          }
          case '/supprimer': {
            if (!connue) { repondreJSON(res, 404, { ok: false, motif: 'partie_inconnue' }); return; }
            if (EP.partieActive && EP.partieActive.id === connue.id) { CONF.mondeFichier = null; EP.partieActive = null; }   // plus rien à sauvegarder
            MC.Saves.supprimer(stockageParties, connue.id);
            repondreJSON(res, 200, { ok: true });
            return;
          }
          case '/importer': {
            const r = MC.PartiesFichier.analyserExport(corps);
            if (r.erreur) { repondreJSON(res, 400, { ok: false, motif: r.erreur }); return; }
            const importees = [], ignorees = r.ignorees.slice();
            r.parties.forEach((p) => {
              try {
                const nouvelle = MC.Saves.trouver(stockageParties, p.meta.id) ? MC.Saves.nouvelId() : p.meta.id;
                const fichier = MC.PartiesFichier.migrerSauvegarde(p.meta, p.data);
                const m = MC.PartiesFichier.metaImportee(p.meta, p.data);
                /* Le fichier de monde d'abord (une migration ou une écriture qui échoue ne laisse
                   alors aucune entrée d'index vide), puis l'index ; si l'index échoue, on retire le
                   fichier : jamais de fichier orphelin. */
                stockageParties.setItem(MC.Saves.slotKey(nouvelle), JSON.stringify(fichier));
                try {
                  MC.Saves.creer(stockageParties, { id: nouvelle, nom: m.nom, mode: m.mode, difficulte: m.difficulte, graine: m.graine, histoire: m.histoire });
                  if (!MC.Saves.trouver(stockageParties, nouvelle)) throw new Error('index illisible ou non inscriptible');
                  MC.Saves.majMeta(stockageParties, nouvelle, { graine: m.graine, versionCarte: m.versionCarte, creeLe: m.creeLe, majLe: m.majLe, duree: m.duree, morte: m.morte });
                } catch (e) {
                  MC.Saves.supprimer(stockageParties, nouvelle);       // retire l'entrée d'index éventuelle ET le fichier
                  throw e;
                }
                importees.push(nouvelle);
              } catch (e) { ignorees.push({ id: p.meta.id, motif: e.message }); }
            });
            repondreJSON(res, 200, { ok: true, importees, ignorees });
            return;
          }
          default: repondreJSON(res, 404, { ok: false, motif: 'route_inconnue' });
        }
      });
    }
    /* Bascule de partie : le monde (graine, fichier, règles) est construit UNE FOIS
       au lancement du processus ; charger une autre partie sauvegarde la courante
       puis relance le même serveur sur la partie choisie, sur le MÊME port et dans
       le même mode réseau (SPEC-ARCHI-013 : « décharge la précédente en la
       sauvegardant »). Le client, dont la connexion se coupe, attend que l'API
       réponde de nouveau puis se reconnecte. */
    function relancerSurPartie(id) {
      if (EP.arretEnCours) return;
      EP.arretEnCours = true;
      journal(`bascule vers la partie ${id}`);
      EP.sauvegardeArretee = true;
      if (EP.minuteurAbsence) { clearTimeout(EP.minuteurAbsence); EP.minuteurAbsence = null; }
      sauvegarderMondeSync();
      const conserves = [];
      for (let k = 0; k < argvBrut.length; k++) {
        const t = argvBrut[k];
        if (/^--(partie|monde|graine|port)(=|$)/.test(t)) { if (t.indexOf('=') < 0) k++; continue; }
        if (t === '--ouvert') continue;
        conserves.push(t);
      }
      const args = [__filename, ...conserves, '--partie', id, '--port', String(EP.portActuel)];
      if (EP.reseauOuvert) args.push('--ouvert');
      clients.forEach(c => { try { c.socket.destroy(); } catch (e) {} });
      S.fermerEcouteurs().then(() => {
        const enfant = require('child_process').spawn(process.execPath, args, {
          detached: true, stdio: 'inherit', windowsHide: true, cwd: process.cwd(),
          env: Object.assign({}, process.env, { MC_RELANCE: '1', MC_ADMIN_HERITE: ADMIN_SECRET }),
        });
        enfant.unref();
        setTimeout(() => process.exit(0), 100);
      });
    }
    function servir(req, res) {
      // rebond DNS : en mode fermé, toute requête HTTP doit viser un nom local
      if (!EP.reseauOuvert && !S.hoteLocal(req)) { res.writeHead(403); res.end('403 hôte refusé'); return; }
      if (req.url.split('?')[0].indexOf('/api/parties') === 0) { traiterApiParties(req, res); return; }
      if (req.url.indexOf('/admin/api/') === 0 && traiterApiAdmin(req, res)) return;
      const brut = req.url.split('?')[0];
      if (brut === '/tests' || brut.indexOf('/tests/') === 0 || brut === '/SPECS.md') { servirBanc(req, res, brut); return; }
      servirFichier(res, cheminSur(req.url), req);
    }
    /* Le banc de test (SPEC-BANC-015/122) — pages, cahiers, historique,
       catalogue, périmètre, serveurs de test, images du registre — N'EXISTE
       que sur un serveur lancé avec --tests (404 sinon : rien ne s'y exécute,
       rien ne s'y lit), et n'y répond qu'à une requête locale
       (refusRequeteLocale : ni mandataire, ni Origin ou Host étrangers, ni
       requête intersites). Chaque route garde en plus ses propres contrôles. */
    function servirBanc(req, res, brut) {
      const motif = refusRequeteLocale(req);
      if (!(S.PARAMS && S.PARAMS.tests)) {
        // une requête non locale n'apprend rien : 404 nu, comme un fichier absent
        if (motif) { res.writeHead(404); res.end('404 introuvable'); return; }
        bancDesactive(res, brut);
        return;
      }
      if (motif) { repondreJSON(res, 403, { ok: false, motif }); return; }
      if (brut === '/tests/resultats' && S.traiterResultatsTest(req, res)) return;
      if (brut === '/tests/version' && traiterVersion(req, res)) return;
      if (brut === '/tests/serveur-histoire' && S.traiterServeurHistoireTest(req, res)) return;
      if (brut.indexOf('/tests/serveur-jeu') === 0 && S.traiterServeurJeuTest(req, res)) return;
      if (brut.indexOf('/tests/cahiers') === 0 && S.filetErreurTests(S.traiterCahiers, req, res)) return;
      // /tests et /tests/ : la page du banc (SPEC-BANC-120) — /tests sans barre
      // finale est redirigé, sinon ses chemins relatifs (banc.css, ../src/…)
      // se résoudraient depuis la racine
      if (brut === '/tests') { res.writeHead(301, { Location: '/tests/' }); res.end(); return; }
      if (brut.indexOf('/tests/historique/') === 0 && S.traiterHistorique(req, res)) return;
      if (brut === '/tests/catalogue' && S.filetErreurTests(S.traiterCatalogue, req, res)) return;
      if (brut === '/tests/perimetre' && S.filetErreurTests(S.traiterPerimetre, req, res)) return;
      if (brut.indexOf('/tests/registre/images/') === 0 && S.traiterImageRegistre(req, res)) return;
      servirFichier(res, cheminBanc(req.url), req);
    }
    /* Sans --tests, la machine locale (et elle seule, voir servirBanc) apprend
       pourquoi le banc ne répond pas : une page pour une page, du JSON pour
       une route de données, du texte pour un fichier. */
    const MSG_BANC_DESACTIVE = 'banc de test désactivé : relancez `node server.js --tests`';
    function bancDesactive(res, brut) {
      const page = brut === '/tests' || brut === '/tests/' || brut === '/tests/cahiers' || brut === '/tests/cahiers/' || /\.html$/.test(brut);
      const fichier = /\.(js|css|md|json)$/.test(brut) && brut.indexOf('/tests/cahiers/') !== 0;
      if (page) {
        const corps = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Banc de test désactivé</title></head>' +
          '<body><h1>Banc de test désactivé</h1><p>Ce serveur a été lancé sans <code>--tests</code> : relancez <code>node server.js --tests</code>.</p></body></html>';
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(corps) });
        res.end(corps);
      } else if (fichier) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 ' + MSG_BANC_DESACTIVE);
      } else repondreJSON(res, 404, { ok: false, motif: MSG_BANC_DESACTIVE });
    }
    /* Hors liste blanche : 404, comme un fichier absent — la réponse ne dit
       pas si le chemin existe sur le disque. Lecture seule : GET et HEAD. */
    function servirFichier(res, chemin, req) {
      if (req && req.method !== 'GET' && req.method !== 'HEAD') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return; }
      if (!chemin) { res.writeHead(404); res.end('404 introuvable'); return; }
      fs.stat(chemin, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); res.end('404 introuvable'); return; }
        // SPEC-SECU-010 : en-têtes de sécurité de base sur toute réponse de
        // fichier statique — nosniff, CSP minimale (calcul pur, testé sous Node
        // dans src/net-protocol.js) ; jamais de X-Powered-By (http natif de Node
        // n'en ajoute pas, et on n'en ajoute aucune ici).
        res.writeHead(200, Object.assign({
          'Content-Type': TYPES[path.extname(chemin).toLowerCase()] || 'application/octet-stream',
          'Content-Length': st.size,
          'Cache-Control': 'no-cache',
        }, NP.entetesSecuriteStatiques()));
        fs.createReadStream(chemin).pipe(res);
      });
    }
  }

  MC.ServeurHttp = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
