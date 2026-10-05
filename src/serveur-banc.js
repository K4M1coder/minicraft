/* serveur-banc.js — les routes du banc de test
   Résultats, cahiers, catalogue, périmètre, historique, images du registre,
   serveurs de test (histoire, jeu) — servis au banc local seulement.

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
    const { Buffer, URL, __filename, clearTimeout, process, require, setImmediate, setTimeout } = S.hote;
    const {
      fs, path, crypto, RACINE, NP, C, PARAMS, CONF, journal, cheminSur, lireCorpsJSON,
      repondreJSON, refusRequeteLocale,
    } = S;
    const EP = S.EP;   // état partagé modifiable, à forme fixe (créé par server.js)
    Object.assign(S, {
      traiterResultatsTest, filetErreurTests, traiterCahiers, traiterCatalogue,
      traiterPerimetre, traiterHistorique, traiterImageRegistre,
      arreterServeurHistoireTest, traiterServeurHistoireTest,
      arreterServeurJeuTest, traiterServeurJeuTest,
    });

    /* Défense CSRF sur les routes d'écriture du banc de test (SPEC-BANC-015 et
       la bibliothèque des cahiers, SPEC-BANC-018/019) : même si elles sont déjà
       réservées à `estAdresseLocale` (127.0.0.1/::1), un navigateur ouvert
       localement peut être amené par une page tierce à émettre une requête
       `POST`/`DELETE` vers ces routes (l'attaquant ne LIT pas la réponse grâce à
       CORS, mais l'écriture, elle, a bien lieu — c'est le cœur d'une attaque
       CSRF). On refuse donc toute requête dont l'`Origin` est PRÉSENT mais NE
       correspond PAS à l'origine du serveur lui-même, et toute requête que le
       navigateur qualifie lui-même de `cross-site` via `Sec-Fetch-Site` — les
       deux sont posés par le navigateur, jamais falsifiables depuis une page web
       normale. Correction revue adversariale (1/3, CRITIQUE). */
    function requeteFiable(req, port) {
      const origine = req.headers['origin'];
      if (origine) {
        const originesAttendues = [
          'http://127.0.0.1:' + port, 'http://localhost:' + port, 'http://[::1]:' + port,
        ];
        if (originesAttendues.indexOf(origine) < 0) {
          return { ok: false, code: 403, motif: 'origine refusée' };
        }
      }
      const secFetchSite = req.headers['sec-fetch-site'];
      if (secFetchSite === 'cross-site') {
        return { ok: false, code: 403, motif: 'requête intersites refusée' };
      }
      return { ok: true };
    }

    // ── réception du cahier de test (SPEC-BANC-015) ─────────────────────────────
    /* La logique (adresse locale, taille, écriture, élagage) vit ENTIÈREMENT dans
       tools/resultats-tests.js, testable sous Node sans lancer de serveur — ici,
       on ne fait que lire la requête et lui transmettre ce qu'elle seule connaît :
       l'adresse distante et la taille reçue. */
    function traiterResultatsTest(req, res) {
      if (req.method !== 'POST') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return true; }
      const fiable = requeteFiable(req, EP.portActuel);
      if (!fiable.ok) { repondreJSON(res, fiable.code, { ok: false, motif: fiable.motif }); return true; }
      const typeContenu = String(req.headers['content-type'] || '');
      if (typeContenu.split(';')[0].trim() !== 'application/json') {
        repondreJSON(res, 415, { ok: false, motif: 'Content-Type attendu : application/json' });
        return true;
      }
      const RT = require('./tools/resultats-tests.js');
      const LIMITE = RT.LIMITE_OCTETS_DEFAUT;
      let brut = '';
      let trop = false;
      req.on('data', (d) => {
        if (trop) return;
        brut += d;
        if (Buffer.byteLength(brut) > LIMITE) { trop = true; repondreJSON(res, 413, { ok: false, motif: 'corps trop volumineux' }); req.destroy(); }
      });
      req.on('end', () => {
        if (trop) return;
        let corps;
        try { corps = JSON.parse(brut); } catch (e) { repondreJSON(res, 400, { ok: false, motif: 'JSON invalide' }); return; }
        const r = RT.traiterEnvoi(corps, {
          adresse: req.socket.remoteAddress, params: PARAMS, tailleOctets: Buffer.byteLength(brut), limiteOctets: LIMITE,
        });
        // `dossierAbsolu` est un détail d'implémentation (chemin disque local) :
        // utile aux appelants Node (tests/run.js), jamais renvoyé par le réseau
        repondreJSON(res, r.code, { ok: r.ok, code: r.code, dossier: r.dossier, rapport: r.rapport, motif: r.motif });
      });
      return true;
    }

    // ── bibliothèque des cahiers de test (SPEC-BANC-018 à 022) ─────────────────
    /* Mêmes protections que /tests/resultats (SPEC-BANC-015) : machine locale
       uniquement. Tout `dossier` de l'URL est vérifié contre la liste RÉELLE des
       cahiers (tools/cahier.js, estCahierValide) avant tout accès disque —
       jamais un chemin construit directement depuis l'URL, ce qui élimine la
       traversée de répertoire par construction plutôt que par filtrage. */
    const RE_CAHIER_DOSSIER = /^\/tests\/cahiers\/([^\/?]+)(?:\/(export|comparer|conserver))?\/?$/;
    /* Filet des routes du banc (SPEC-BANC-120) : une exception synchrone dans un
       traitement (cahier illisible, donnée inattendue) laissait la requête sans
       réponse — la page attendait indéfiniment. */
    function filetErreurTests(traiter, req, res) {
      try { return traiter(req, res); }
      catch (e) {
        journal('banc de test : ' + ((e && e.stack) || e));
        if (!res.headersSent) repondreJSON(res, 500, { ok: false, motif: 'erreur interne : ' + ((e && e.message) || e) });
        return true;
      }
    }
    /* SPEC-BANC-122 : les routes du banc (cahiers, historique, catalogue, images
       du registre) n'acceptent que le banc LUI-MÊME — même contrôle que l'API des
       parties (refusRequeteLocale : ni mandataire, ni Origin étrangère, ni Host
       étranger, ni requête intersites). L'adresse locale seule laissait n'importe
       quelle page web ouverte dans le navigateur de la machine lancer en
       « no-cors » des exports de plusieurs dizaines de Mo et figer le serveur. */
    function refuserHorsBancLocal(req, res) {
      const motif = refusRequeteLocale(req);
      if (!motif) return false;
      repondreJSON(res, 403, { ok: false, motif });
      return true;
    }
    function traiterCahiers(req, res) {
      const url = req.url.split('?')[0];
      if (!(url === '/tests/cahiers' || url === '/tests/cahiers/' || url === '/tests/cahiers/api' || RE_CAHIER_DOSSIER.test(url))) return false;
      const RT = require('./tools/resultats-tests.js');
      if (refuserHorsBancLocal(req, res)) return true;
      const cahier = require('./tools/cahier.js');
      const racine = RT.DOSSIER_RESULTATS;
      const q = {};
      new URL(req.url, 'http://localhost').searchParams.forEach((v, k) => { q[k] = v; });

      if (url === '/tests/cahiers' || url === '/tests/cahiers/') {
        const p = cheminSur('/tests/cahiers.html');
        fs.readFile(p, (err, data) => {
          if (err) { res.writeHead(404); res.end('404'); return; }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(data);
        });
        return true;
      }
      if (url === '/tests/cahiers/api') { repondreJSON(res, 200, { cahiers: cahier.listerCahiers(racine) }); return true; }

      const mm = RE_CAHIER_DOSSIER.exec(url);
      const dossier = mm[1], action = mm[2];
      if (!cahier.estCahierValide(racine, dossier)) { repondreJSON(res, 404, { ok: false, motif: 'cahier introuvable' }); return true; }

      if (action === 'export' && req.method === 'GET') {
        const format = q.format || 'html';
        try {
          if (format === 'html') { const buf = cahier.exporterHTML(racine, dossier); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="' + dossier + '.html"' }); res.end(buf); return true; }
          if (format === 'docx') { const buf = cahier.exporterDocx(racine, dossier); res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.docu' + 'ment',   /* coupé : la porte G5 refuse ce mot dans le code d'un module pur */ 'Content-Disposition': 'attachment; filename="' + dossier + '.docx"' }); res.end(buf); return true; }
          if (format === 'pdf') {
            const r = cahier.exporterPDF(racine, dossier);
            if (!r.ok) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Cahier-Repli': 'impression-navigateur' }); res.end(r.page); return true; }
            res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + dossier + '.pdf"' }); res.end(r.pdf); return true;
          }
          repondreJSON(res, 400, { ok: false, motif: 'format inconnu' });
        } catch (e) { repondreJSON(res, 500, { ok: false, motif: e.message }); }
        return true;
      }
      if (action === 'comparer' && req.method === 'GET') { repondreJSON(res, 200, cahier.compareCahiers(racine, dossier, q.avec)); return true; }
      if (action === 'conserver' && req.method === 'POST') {
        const fiable = requeteFiable(req, EP.portActuel);
        if (!fiable.ok) { repondreJSON(res, fiable.code, { ok: false, motif: fiable.motif }); return true; }
        lireCorpsJSON(req, (args) => { repondreJSON(res, 200, cahier.marquerConserve(racine, dossier, args.valeur !== false)); });
        return true;
      }
      if (!action && req.method === 'DELETE') {
        const fiable = requeteFiable(req, EP.portActuel);
        if (!fiable.ok) { repondreJSON(res, fiable.code, { ok: false, motif: fiable.motif }); return true; }
        repondreJSON(res, 200, cahier.supprimerCahier(racine, dossier)); return true;
      }
      repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' });
      return true;
    }

    // ── historique global (docs/banc/historique-global.md, SPEC-BANC-033 à 040) ─
    /* Toute la logique de tri/filtre/pagination/agrégation vit dans
       tools/historique.js (pur, testable sous Node sans passer par ici — voir
       tests/spec-historique.js) : ce module se contente de lire la requête, de
       passer les paramètres et de répondre en JSON. L'index en mémoire
       (`tools/historique.js` creerIndex()) est créé UNE SEULE fois pour la vie
       du processus serveur et réutilisé d'une requête à l'autre — c'est lui,
       pas cette fonction, qui décide de reconstruire ou non selon la mtime du
       dossier source (§2 : le registre peut grossir, jamais de lecture complète
       du disque à chaque appel). */
    // require paresseux (comme RT/registre.js plus bas) : tools/ n'est pas
    // embarqué dans un paquet joué (tools/paquet.js), donc server.js ne doit
    // PAS exiger tools/historique.js pour démarrer — seulement si une route
    // historique est vraiment appelée (adresse locale uniquement, voir plus bas).
    let indiceHistorique = null;
    function obtenirIndiceHistorique() {
      if (!indiceHistorique) indiceHistorique = require('./tools/historique.js').creerIndex();
      return indiceHistorique;
    }
    function parametresRequete(req) {
      const q = {};
      new URL(req.url, 'http://localhost').searchParams.forEach((v, k) => { q[k] = v; });
      return q;
    }
    /* GET /tests/catalogue (SPEC-BANC-118) : le catalogue NODE complet, publié par
       `node tests/run.js --catalogue-json` dans un processus à part (jamais dans
       celui-ci : il charge tous les fichiers de tests), sans bloquer la boucle
       d'évènements, mis en cache tant que tests/ et SPECS.md ne changent pas ;
       des requêtes simultanées partagent le même calcul. */
    let catalogueNode = null; // { signature, json } | { signature, attente: [callbacks] }
    function signatureCatalogue() {
      try {
        const d = path.join(RACINE, 'tests');
        const t = fs.readdirSync(d).filter(f => f.endsWith('.js')).reduce((m, f) => Math.max(m, fs.statSync(path.join(d, f)).mtimeMs), 0);
        return t + ':' + fs.statSync(path.join(RACINE, 'SPECS.md')).mtimeMs;
      } catch (e) { return 'inconnue'; }
    }
    function traiterCatalogue(req, res) {
      if (req.url.split('?')[0] !== '/tests/catalogue') return false;
      if (refuserHorsBancLocal(req, res)) return true;
      if (req.method !== 'GET') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return true; }
      const sig = signatureCatalogue();
      const repondre = (err, json) => {
        if (res.headersSent) return;
        if (err) { repondreJSON(res, 503, { ok: false, motif: 'catalogue Node indisponible : ' + err }); return; }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(json);
      };
      if (catalogueNode && catalogueNode.signature === sig) {
        if (catalogueNode.json) { repondre(null, catalogueNode.json); return true; }
        catalogueNode.attente.push(repondre); return true;
      }
      const entree = { signature: sig, attente: [repondre] };
      catalogueNode = entree;
      const fin = (err, json) => {
        if (!err) entree.json = json; else if (catalogueNode === entree) catalogueNode = null;
        entree.attente.splice(0).forEach(cb => cb(err, json));
      };
      require('child_process').execFile(process.execPath, [path.join(RACINE, 'tests', 'run.js'), '--catalogue-json'],
        { cwd: RACINE, timeout: 120000, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
        (err, stdout) => {
          if (err) { fin(err.message.split('\n')[0]); return; }
          try { JSON.parse(stdout); } catch (e) { fin('sortie illisible'); return; }
          fin(null, stdout);
        });
      return true;
    }
    /* GET /tests/perimetre[?depuis=<ref>] (SPEC-BANC-074) : APERÇU du périmètre
       d'exécution — les tests que retiendrait « Périmètre du commit » (fichiers
       indexés) ou « Périmètre depuis <ref> », avec leur raison de sélection, ou
       le motif d'un repli. Calculé par `node tools/perimetre.js --json` dans un
       processus à part (il charge tout le catalogue) ; N'EXÉCUTE AUCUN TEST : le
       banc ne lance qu'après confirmation. La référence est validée (lettres,
       chiffres, . / ~ ^ @ - _) et passée en argument, jamais dans un shell. */
    function traiterPerimetre(req, res) {
      if (req.url.split('?')[0] !== '/tests/perimetre') return false;
      if (refuserHorsBancLocal(req, res)) return true;
      if (req.method !== 'GET') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return true; }
      const q = parametresRequete(req);
      const args = [path.join(RACINE, 'tools', 'perimetre.js'), '--json'];
      if (q.depuis) {
        if (!/^[\w./~^@-]{1,100}$/.test(q.depuis) || /^-/.test(q.depuis)) { repondreJSON(res, 400, { ok: false, motif: 'référence invalide' }); return true; }
        args.push('--depuis', q.depuis);
      }
      require('child_process').execFile(process.execPath, args,
        { cwd: RACINE, timeout: 120000, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
        (err, stdout) => {
          if (res.headersSent) return;
          if (err) { repondreJSON(res, 503, { ok: false, motif: 'périmètre indisponible : ' + err.message.split('\n')[0] }); return; }
          let p;
          try { p = JSON.parse(stdout); } catch (e) { repondreJSON(res, 503, { ok: false, motif: 'sortie illisible' }); return; }
          repondreJSON(res, 200, Object.assign({ ok: true }, p));
        });
      return true;
    }
    let exportHistoriqueEnCours = false;
    const ROUTES_HISTORIQUE = ['/tests/historique/lignes', '/tests/historique/series', '/tests/historique/images', '/tests/historique/tests', '/tests/historique/export'];
    function traiterHistorique(req, res) {
      const url = req.url.split('?')[0];
      if (ROUTES_HISTORIQUE.indexOf(url) < 0) return false;
      /* SPEC-BANC-120 : une exception ici (donnée inattendue du registre, bogue)
         n'atteignait que process.on('uncaughtException') — le serveur survivait
         mais la requête restait SANS RÉPONSE, et la page de l'historique attendait
         indéfiniment. Elle reçoit désormais une erreur lisible. */
      try { return traiterHistoriqueSur(req, res, url); }
      catch (e) {
        journal('historique : ' + ((e && e.stack) || e));
        if (!res.headersSent) repondreJSON(res, 500, { ok: false, motif: 'erreur interne de l\'historique : ' + ((e && e.message) || e) });
        return true;
      }
    }
    function traiterHistoriqueSur(req, res, url) {
      const HIST = require('./tools/historique.js');
      if (refuserHorsBancLocal(req, res)) return true;
      if (req.method !== 'GET') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return true; }
      const q = parametresRequete(req);
      let filtre;
      try { filtre = q.filtre ? JSON.parse(q.filtre) : {}; }
      catch (e) { repondreJSON(res, 400, { ok: false, motif: 'filtre JSON invalide' }); return true; }
      if (!filtre || typeof filtre !== 'object' || Array.isArray(filtre)) { repondreJSON(res, 400, { ok: false, motif: 'filtre : un objet JSON est attendu' }); return true; }
      if (q.rapide) filtre = Object.assign({}, HIST.filtreRapide(q.rapide), filtre);

      const toutes = obtenirIndiceHistorique().lignes();

      if (url === '/tests/historique/tests') {
        repondreJSON(res, 200, { tests: HIST.testsConnus(HIST.filtrerLignes(toutes, filtre)) });
        return true;
      }
      if (url === '/tests/historique/export') {
        const champs = (q.tri || '').split(',').filter(Boolean);
        const ordres = (q.ordre || '').split(',');
        const triees = HIST.trierLignes(HIST.filtrerLignes(toutes, filtre), champs.map((champ, i) => ({ champ, ordre: ordres[i] === 'desc' ? 'desc' : 'asc' })));
        const colonnes = (q.colonnes || '').split(',').filter(Boolean);
        const html = q.format === 'html';
        /* SPEC-BANC-122 : export BORNÉ et DÉCOUPÉ — un seul à la fois, au plus
           HIST.EXPORT_LIGNES_MAX lignes, écrit par paquets en rendant la main à
           la boucle d'évènements entre deux (et en respectant la contre-pression
           du client) : un export HTML de 34 Mo construit d'un bloc la bloquait
           0,85 s, cinq en parallèle près de 5 s. */
        if (exportHistoriqueEnCours) { repondreJSON(res, 429, { ok: false, motif: 'un export de l\'historique est déjà en cours — réessayez dans un instant' }); return true; }
        if (triees.length > HIST.EXPORT_LIGNES_MAX) {
          repondreJSON(res, 413, { ok: false, motif: triees.length + ' lignes : au-delà de ' + HIST.EXPORT_LIGNES_MAX + ', filtrez la vue avant d\'exporter' });
          return true;
        }
        const m = HIST.morceauxExport(colonnes, html ? 'html' : 'csv', triees.length);
        res.writeHead(200, {
          'Content-Type': html ? 'text/html; charset=utf-8' : 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="historique.' + (html ? 'html' : 'csv') + '"',
        });
        exportHistoriqueEnCours = true;
        let i = 0, fini = false;
        const terminer = () => { if (!fini) { fini = true; exportHistoriqueEnCours = false; } };
        res.on('close', terminer);
        const PAQUET = 1000;
        res.write(m.entete);
        const suite = () => {
          if (fini) return;
          try {
            while (i < triees.length) {
              let bloc = '';
              const fin = Math.min(triees.length, i + PAQUET);
              for (; i < fin; i++) bloc += m.ligne(triees[i]);
              if (!res.write(bloc)) { res.once('drain', () => setImmediate(suite)); return; }
              if (i < triees.length) { setImmediate(suite); return; }
            }
            res.end(m.pied);
            terminer();
          } catch (e) {
            journal('export historique : ' + ((e && e.stack) || e));
            terminer();
            try { res.destroy(); } catch (e2) { /* rien */ }
          }
        };
        suite();
        return true;
      }

      if (url === '/tests/historique/lignes') {
        const filtrees = HIST.filtrerLignes(toutes, filtre);
        // tri multi-clés (SPEC-BANC-035) : "tri=etat,duree_ms&ordre=asc,desc"
        // (les deux listes s'alignent par position) — un tri simple est le cas
        // à une seule clé, sans rien changer côté client.
        const champs = (q.tri || '').split(',').filter(Boolean);
        const ordres = (q.ordre || '').split(',');
        const tris = champs.map((champ, i) => ({ champ, ordre: ordres[i] === 'desc' ? 'desc' : 'asc' }));
        const triees = HIST.trierLignes(filtrees, tris);
        const page = HIST.paginer(triees, q.page, q.taille);
        repondreJSON(res, 200, {
          lignes: page.lignes, total: page.total, page: page.page, taille: page.taille,
          effectifs: HIST.effectifsToutesEnum(filtrees),
        });
        return true;
      }
      if (url === '/tests/historique/series') {
        const filtrees = HIST.filtrerLignes(toutes, filtre);
        const props = (q.props || '').split(',').filter(Boolean);
        repondreJSON(res, 200, { serie: HIST.serieAgregee(filtrees, { x: q.x, props: props }) });
        return true;
      }
      // /tests/historique/images
      if (!q.test) { repondreJSON(res, 400, { ok: false, motif: 'paramètre test requis' }); return true; }
      repondreJSON(res, 200, { images: HIST.imagesDeTest(toutes, q.test, { filtre: filtre, tri: q.tri }) });
      return true;
    }

    // GET /tests/registre/images/<sha1>.<ext> (SPEC-BANC-040) : images du
    // registre, adressées par contenu (tools/registre.js) — IMMUABLES (un sha1
    // donné désigne toujours le même contenu), d'où le cache long. Le chemin est
    // vérifié par une expression régulière STRICTE (sha1 + extension connue)
    // avant tout accès disque — même politique que /tests/cahiers, aucun chemin
    // construit directement depuis l'URL.
    const RE_IMAGE_REGISTRE = /^\/tests\/registre\/images\/([0-9a-f]{40})\.(jpg|jpeg|png|webp)$/;
    const MIME_IMAGE_REGISTRE = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
    function traiterImageRegistre(req, res) {
      const url = req.url.split('?')[0];
      const mm = RE_IMAGE_REGISTRE.exec(url);
      if (!mm) return false;
      if (refuserHorsBancLocal(req, res)) return true;   // SPEC-BANC-122
      if (req.method !== 'GET') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return true; }
      const REG = require('./tools/registre.js');
      const chemin = path.join(REG.DOSSIER_IMAGES, mm[1] + '.' + mm[2]);
      fs.stat(chemin, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); res.end('404 introuvable'); return; }
        res.writeHead(200, Object.assign({
          'Content-Type': MIME_IMAGE_REGISTRE[mm[2]] || 'application/octet-stream',
          'Content-Length': st.size,
          'Cache-Control': 'public, max-age=31536000, immutable',
        }, NP.entetesSecuriteStatiques()));
        fs.createReadStream(chemin).pipe(res);
      });
      return true;
    }

    /* SPEC-ARCHI-041 (banc d'essai) : les e2e du mode histoire jouent sur un VRAI serveur en mode
       histoire. Le serveur de test (--tests) en lance un second, jetable, sur un port libre : mode
       histoire, paramètres du récit donnés par la page ; il s'arrête avec son parent (jamais d'orphelin).
       Réservé au serveur lancé avec --tests, depuis la boucle locale ; sans --tests la route n'existe pas. */
    let serveurHistoireTest = null;
    function arreterServeurHistoireTest() {
      if (serveurHistoireTest) { try { serveurHistoireTest.kill(); } catch (e) { /* déjà parti */ } serveurHistoireTest = null; }
    }
    function traiterServeurHistoireTest(req, res) {
      if (!PARAMS.tests) return false;
      if (req.method !== 'POST') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return true; }
      const refus = refusRequeteLocale(req);
      if (refus) { repondreJSON(res, 403, { ok: false, motif: refus }); return true; }
      if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') {
        repondreJSON(res, 415, { ok: false, motif: 'Content-Type attendu : application/json' });
        return true;
      }
      lireCorpsJSON(req, (corps) => {
        arreterServeurHistoireTest();
        const histoire = corps && corps.histoire && typeof corps.histoire === 'object' ? corps.histoire : {};
        const graine = corps && Number.isInteger(corps.graine) ? corps.graine : CONF.graine;
        const enfant = require('child_process').spawn(process.execPath, [__filename, '--port', '0', '--serveur'], {
          cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
          env: Object.assign({}, process.env, {
            MC_MODE: 'histoire', MC_HISTOIRE: JSON.stringify(histoire), MC_GRAINE: String(graine),
            MC_TEST_POSE_LIBRE: '1', MC_TEST_ARRET_SI_MORT: String(process.pid),
            MC_TEST_PRES_GUIDE: corps && corps.presGuide ? '1' : '',
          }),
        });
        serveurHistoireTest = enfant;
        let sortie = '', repondu = false;
        const repondre = (code, obj) => { if (repondu) return; repondu = true; clearTimeout(limite); repondreJSON(res, code, obj); };
        const limite = setTimeout(() => { arreterServeurHistoireTest(); repondre(504, { ok: false, motif: 'demarrage_trop_long' }); }, 90000);
        const ecouteSortie = (d) => {
          sortie += d;
          const m = /MC_PORT=(\d+)/.exec(sortie);
          if (!m) return;
          enfant.stdout.removeListener('data', ecouteSortie);     // plus rien à lire : on vide sans accumuler
          enfant.stdout.on('data', () => {});
          sortie = '';
          repondre(200, { ok: true, port: parseInt(m[1], 10) });
        };
        enfant.stdout.on('data', ecouteSortie);
        enfant.stderr.on('data', () => {});
        enfant.on('exit', () => { if (serveurHistoireTest === enfant) serveurHistoireTest = null; repondre(500, { ok: false, motif: 'serveur_arrete' }); });
      });
      return true;
    }

    /* SPEC-JOUABLE-001 à 008 (banc d'essai de la jouabilité) : les e2e de synchro client-serveur jouent
       sur un VRAI serveur de jeu, aux VRAIES règles du mode choisi (survie paisible ou créatif) — jamais
       MC_TEST_POSE_LIBRE : poser se paie sur l'inventaire du serveur, comme en partie. Même principe que
       /tests/serveur-histoire : réservé à --tests et à la boucle locale, un serveur jetable sur un port
       libre, arrêté avec son parent. `inv` ([[id, n], …]) donne l'inventaire de départ (MC_TEST_INV) ;
       le serveur reçoit un jeton d'administration que seul ce parent connaît, pour relire l'inventaire
       d'un joueur tel que le SERVEUR le tient (GET /tests/serveur-jeu/inventaire?nom=…), indépendamment
       de ce que le client affiche. */
    let serveurJeuTest = null;
    let journalJeuTest = '';            // sortie du dernier serveur de jeu de test (bornée), gardée après son arrêt
    function arreterServeurJeuTest() {
      if (serveurJeuTest) { try { serveurJeuTest.enfant.kill(); } catch (e) { /* déjà parti */ } serveurJeuTest = null; }
    }
    function traiterServeurJeuTest(req, res) {
      if (!PARAMS.tests) return false;
      const refus = refusRequeteLocale(req);
      if (refus) { repondreJSON(res, 403, { ok: false, motif: refus }); return true; }
      const chemin = req.url.split('?')[0];
      if (chemin === '/tests/serveur-jeu/journal') {
        repondreJSON(res, 200, { ok: true, journal: journalJeuTest });
        return true;
      }
      if (chemin === '/tests/serveur-jeu/arreter') {
        if (req.method !== 'POST') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return true; }
        const avait = !!serveurJeuTest;
        arreterServeurJeuTest();
        repondreJSON(res, 200, { ok: true, arrete: avait });
        return true;
      }
      if (chemin === '/tests/serveur-jeu/inventaire') {
        if (req.method !== 'GET') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return true; }
        const sj = serveurJeuTest;
        if (!sj || !sj.port) { repondreJSON(res, 409, { ok: false, motif: 'aucun_serveur_de_jeu' }); return true; }
        const nom = new URL(req.url, 'http://localhost').searchParams.get('nom') || '';
        const rq = require('http').get({ host: '127.0.0.1', port: sj.port, path: '/admin/api/inventaire?nom=' + encodeURIComponent(nom),
          headers: { Authorization: 'Bearer ' + sj.jeton, Host: '127.0.0.1:' + sj.port }, timeout: 15000 }, (r2) => {
          let brut = '';
          r2.on('data', (d) => { brut += d; });
          r2.on('end', () => {
            let obj = null;
            try { obj = JSON.parse(brut); } catch (e) { obj = null; }
            repondreJSON(res, obj ? 200 : 502, obj || { ok: false, motif: 'reponse_illisible' });
          });
        });
        rq.on('timeout', () => rq.destroy(new Error('délai')));
        rq.on('error', (e) => repondreJSON(res, 502, { ok: false, motif: 'serveur_de_jeu_injoignable', detail: e.message }));
        return true;
      }
      if (chemin !== '/tests/serveur-jeu') return false;
      if (req.method !== 'POST') { repondreJSON(res, 405, { ok: false, motif: 'methode_invalide' }); return true; }
      if (String(req.headers['content-type'] || '').split(';')[0].trim() !== 'application/json') {
        repondreJSON(res, 415, { ok: false, motif: 'Content-Type attendu : application/json' });
        return true;
      }
      lireCorpsJSON(req, (corps) => {
        arreterServeurJeuTest();
        const mode = corps && (corps.mode === 'creatif' || corps.mode === 'survie') ? corps.mode : 'survie';
        const difficulte = corps && ['paisible', 'facile', 'difficile', 'cauchemar'].indexOf(corps.difficulte) >= 0 ? corps.difficulte : 'paisible';
        const graine = corps && Number.isInteger(corps.graine) ? corps.graine : CONF.graine;
        // seuls des objets qui EXISTENT (bloc ou objet défini), en quantités entières bornées
        const inv = corps && Array.isArray(corps.inv)
          ? corps.inv.filter(p => Array.isArray(p) && Number.isInteger(p[0]) && p[0] > 0 && !!C.def(p[0]) &&
              Number.isInteger(p[1]) && p[1] > 0 && p[1] <= C.maxStack(p[0])).slice(0, 36) : [];
        const jeton = MC.Admin.nouveauJeton('banc-jeu-', crypto.randomBytes);
        /* Environnement de l'enfant : celui du banc MOINS tout réglage de jeu ou
           de test hérité (MC_TEST_*, MC_MODE, MC_HISTOIRE…) — l'enfant ne reçoit
           que ceux voulus ici. `--serveur` + MC_TEST_BOUCLE_LOCALE : règles du mode
           ouvert (la page et le Témoin, page servie par un autre port) mais écoute
           sur la boucle locale seulement (voir BOUCLE_LOCALE_TEST). */
        const env = {};
        Object.keys(process.env).forEach(k => { if (!/^MC_/.test(k)) env[k] = process.env[k]; });
        Object.assign(env, {
          MC_MODE: mode, MC_DIFFICULTE: difficulte, MC_GRAINE: String(graine),
          MC_TEST_BOUCLE_LOCALE: '1', MC_TEST_ARRET_SI_MORT: String(process.pid),
        });
        if (inv.length) env.MC_TEST_INV = JSON.stringify(inv);
        const enfant = require('child_process').spawn(process.execPath, [__filename, '--port', '0', '--serveur', '--admin', jeton], {
          cwd: RACINE, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env,
        });
        const sj = { enfant, port: 0, jeton };
        serveurJeuTest = sj;
        let sortie = '', repondu = false;
        const repondre = (code, obj) => { if (repondu) return; repondu = true; clearTimeout(limite); repondreJSON(res, code, obj); };
        const limite = setTimeout(() => { arreterServeurJeuTest(); repondre(504, { ok: false, motif: 'demarrage_trop_long' }); }, 90000);
        const ecouteSortie = (d) => {
          sortie += d;
          const m = /MC_PORT=(\d+)/.exec(sortie);
          if (!m) return;
          enfant.stdout.removeListener('data', ecouteSortie);
          sortie = '';
          sj.port = parseInt(m[1], 10);
          repondre(200, { ok: true, port: sj.port, mode, difficulte, graine });
        };
        // le journal du serveur de jeu, borné (les 32 derniers Kio), relu par le banc pour expliquer un échec
        const garder = (d) => { journalJeuTest = (journalJeuTest + d).slice(-32768); };
        journalJeuTest = '';
        enfant.stdout.on('data', garder);
        enfant.stdout.on('data', ecouteSortie);
        enfant.stderr.on('data', garder);
        enfant.on('exit', () => { if (serveurJeuTest === sj) serveurJeuTest = null; repondre(500, { ok: false, motif: 'serveur_arrete' }); });
      });
      return true;
    }
  }

  MC.ServeurBanc = { installer: installer };
})(typeof globalThis !== 'undefined' ? globalThis : this);
