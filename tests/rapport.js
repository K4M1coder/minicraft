/* rapport.js — générateur du cahier de test (SPEC-BANC-014, SPEC-BANC-022).
   Module PUR : pas de THREE, document ou window ici — il PRODUIT des
   données ou du texte, il ne les pose jamais lui-même dans une page.
   Utilisable sous Node (tests/run.js, tools/resultats-tests.js, tools/cahier.js,
   tools/docx.js) et dans le navigateur.

   Schéma de resultats.json (documenté ici, SPEC-BANC-012/013/014) :
   {
     schema: 1,
     campagne: {
       preset, criteres, debut, fin, duree_ms, interrompue,
       environnement: { source: 'node'|'navigateur', navigateur?, gpu?,
                         resolution?, versionJeu, commit, node? },
       totaux: { total, passes, echecs, ignores, parType:{}, parDomaine:{} },
       lents: [nom, ...],
       fps_moyen?,
     },
     tests: [
       { id, nom, type, groupe, domaines, specs, fiche,
         etat: 'ok'|'echec'|'delai'|'ignore', duree_ms,
         etapes: [{ libelle, t_ms, n?, total? }],
         assertions: { ok, ko },
         message?, pile?, attendu?, obtenu?,
         metriques?: { images, fps_moy, fps_min, fps_p95, ms_image, appels, triangles, memoire },
         captures?: [{ libelle, fichier }],
       },
       ...
     ],
   }

   MODÈLE (SPEC-BANC-022) — MC_RAPPORT.modele(resultats) → { titre, blocs }.
   Un `bloc` est l'un de :
     { type:'titre', niveau:1-4, texte, meta?:{etat} }
     { type:'paragraphe', texte, meta?:{classe} }
     { type:'liste', items:[texte,...] }
     { type:'tableau', entetes:[...], lignes:[{cellules:[...], etat?}] }
     { type:'image', fichier, legende, mime?, donnees?:Buffer, src? }
     { type:'saut_page' }
     { type:'sommaire', entrees:[{texte, niveau}] }
   C'est le MÊME modèle que consomment MC_RAPPORT.html(modele|resultats) et
   tools/docx.js (construireDocx(modele)) — aucun des deux rendus ne peut
   donc avoir un contenu que l'autre n'a pas : ils parcourent la même liste.
   Les blocs `image` n'embarquent PAS les octets par défaut (modele() ne lit
   aucun fichier, il reste pur) ; un appelant Node (tools/cahier.js) qui veut
   un export autonome ou .docx les enrichit lui-même (`donnees`, `src`) après
   coup, en relisant tests/resultats/.../captures/.

   MC_RAPPORT.html(resultatsOuModele, { capturesRel, autonome }) → chaîne
   HTML autonome (CSS en ligne, clair et sombre, échappement strict). Accepte
   directement un `resultats` (rétrocompatibilité, appelle modele() lui-même)
   ou déjà un modèle. */
(function (G) {
  'use strict';
  var MC_RAPPORT = G.MC_RAPPORT = G.MC_RAPPORT || {};

  function echapper(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function e(s) { return echapper(s); }

  function duree(ms) {
    if (ms === undefined || ms === null) return '—';
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(1) + ' s';
  }
  function dateISO(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('fr-FR'); } catch (x) { return iso; }
  }
  function fmt(v) {
    if (v === undefined) return '—';
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (x) { return String(v); } }
    return String(v);
  }
  MC_RAPPORT._fmt = fmt;

  // ── construction du modèle ───────────────────────────────────────────────
  /* SPEC-BANC-059 : chaque test s'affiche dans CET ORDRE — 1) identité (id,
     catégorie, domaines, specs, fonctions, étiquettes), 2) fiche (ce qui est
     testé/pourquoi/attendu/source), 3) résultat (état, durée, erreur, puis
     vignettes). Le titre (h4) porte déjà état+durée ; ce bloc « identité »
     complète ce que le titre ne dit pas, AVANT la fiche — jamais après. */
  function blocIdentite(t) {
    var champs = [];
    if (t.id) champs.push('id : ' + t.id);
    var categorie = t.categorie ? [t.categorie.type, t.categorie.groupe] : [t.type, t.groupe];
    if (categorie.filter(Boolean).length) champs.push('catégorie : ' + categorie.filter(Boolean).join(' / '));
    if (t.domaines && t.domaines.length) champs.push('domaines : ' + t.domaines.join(', '));
    if (t.specs && t.specs.length) champs.push('specs : ' + t.specs.join(', '));
    if (t.fonctions && t.fonctions.length) champs.push('fonctions : ' + t.fonctions.join(', '));
    if (t.etiquettes && t.etiquettes.length) champs.push('étiquettes : ' + t.etiquettes.join(', '));
    // SPEC-BANC-070 : pourquoi le périmètre a retenu ce test (run restreint)
    if (t.raison_selection && t.raison_selection.length && !(t.raison_selection.length === 1 && t.raison_selection[0] === 'complet')) {
      champs.push('raison de sélection : ' + t.raison_selection.join(', '));
    }
    if (t.trou_perimetre) champs.push('⚠ trou de périmètre : échec que le périmètre du commit n\'aurait pas retenu');
    return champs.length ? { type: 'paragraphe', texte: champs.join('\n'), meta: { classe: 'identite' } } : null;
  }

  function blocsTest(t) {
    var out = [];
    var etat = t.etat || (t.ok === false ? 'echec' : 'ok');
    out.push({ type: 'titre', niveau: 4, texte: '[' + etat + '] ' + t.nom + ' — ' + duree(t.duree_ms), meta: { etat: etat } });
    var idBloc = blocIdentite(t);
    if (idBloc) out.push(idBloc);
    if (t.fiche) {
      out.push({ type: 'paragraphe', texte:
        (t.fiche.teste ? 'teste : ' + t.fiche.teste + '\n' : '') +
        (t.fiche.pourquoi ? 'pourquoi : ' + t.fiche.pourquoi + '\n' : '') +
        (t.fiche.attendu ? 'attendu : ' + t.fiche.attendu : ''), meta: { classe: 'fiche' } });
    } else {
      out.push({ type: 'paragraphe', texte: 'aucune fiche (à ajouter)', meta: { classe: 'fiche-absente' } });
    }
    if (t.etapes && t.etapes.length) {
      out.push({ type: 'liste', items: t.etapes.map(function (s) {
        return s.libelle + (s.n ? ' (' + s.n + (s.total ? '/' + s.total : '') + ')' : '') + ' — ' + duree(s.t_ms);
      }) });
    }
    if (t.assertions) out.push({ type: 'paragraphe', texte: 'assertions : ' + (t.assertions.ok || 0) + ' ok / ' + (t.assertions.ko || 0) + ' échouée(s)', meta: { classe: 'dur' } });
    // SPEC-BANC-089 : raison, obligatoire pour ignore/avertissement — affichée
    // qu'elle vienne du vocabulaire 'echec'/'ok' (tests Node/e2e) ou déjà
    // normalisé 'ignore'/'avertissement' (registre) : un test qui a une
    // raison la montre, quel que soit son état exact.
    if (t.raison) out.push({ type: 'paragraphe', texte: 'raison : ' + t.raison, meta: { classe: 'raison' } });
    if (etat !== 'ok') {
      if (t.attendu !== undefined || t.obtenu !== undefined) {
        out.push({ type: 'paragraphe', texte: 'attendu : ' + fmt(t.attendu) + '\nobtenu : ' + fmt(t.obtenu), meta: { classe: 'avobt' } });
      }
      if (t.message) out.push({ type: 'paragraphe', texte: t.message, meta: { classe: 'msg' } });
      if (t.pile) out.push({ type: 'paragraphe', texte: t.pile, meta: { classe: 'pile' } });
    }
    if (t.metriques) {
      var champs = [['images', t.metriques.images], ['fps moy', t.metriques.fps_moy], ['fps min', t.metriques.fps_min],
        ['fps p95', t.metriques.fps_p95], ['ms/image', t.metriques.ms_image], ['appels', t.metriques.appels],
        ['triangles', t.metriques.triangles], ['mémoire', t.metriques.memoire]]
        .filter(function (p) { return p[1] !== undefined && p[1] !== null; });
      if (champs.length) out.push({ type: 'paragraphe', texte: champs.map(function (p) { return p[0] + ' : ' + p[1]; }).join(' · '), meta: { classe: 'dur' } });
    }
    (t.captures || []).forEach(function (c) {
      out.push({ type: 'image', fichier: c.fichier, legende: c.libelle });
    });
    return out;
  }

  function grouper(tests) {
    var parType = {};
    tests.forEach(function (t) {
      parType[t.type] = parType[t.type] || {};
      var parDom = parType[t.type];
      var dom = (t.domaines && t.domaines.length) ? t.domaines[0] : '(sans domaine)';
      parDom[dom] = parDom[dom] || {};
      var parGrp = parDom[dom];
      parGrp[t.groupe] = parGrp[t.groupe] || [];
      parGrp[t.groupe].push(t);
    });
    return parType;
  }

  function modele(resultats) {
    var r = resultats || {};
    var c = r.campagne || {};
    var tests = r.tests || [];
    var totaux = c.totaux || { total: tests.length, passes: 0, echecs: 0, ignores: 0, parType: {}, parDomaine: {} };
    var echecs = tests.filter(function (t) { return t.etat === 'echec' || t.etat === 'delai'; });
    var lents = (c.lents && c.lents.length) ? c.lents : tests
      .slice().sort(function (a, b) { return (b.duree_ms || 0) - (a.duree_ms || 0); }).slice(0, 10).map(function (t) { return t.nom; });

    var blocs = [];
    blocs.push({ type: 'titre', niveau: 1, texte: 'Cahier de test MiniCraft' + (c.preset ? ' — ' + c.preset : '') });
    blocs.push({ type: 'paragraphe', texte:
      dateISO(c.debut) + ' → ' + dateISO(c.fin) + ' · ' + duree(c.duree_ms) + (c.interrompue ? ' · INTERROMPUE' : ''), meta: { classe: 'sub' } });

    blocs.push({ type: 'tableau', entetes: ['mesure', 'valeur'], lignes: [
      { cellules: ['tests', String(totaux.total || 0)] },
      { cellules: ['passés', String(totaux.passes || 0)], etat: 'ok' },
      { cellules: ['échoués', String(totaux.echecs || 0)], etat: totaux.echecs ? 'echec' : null },
      { cellules: ['ignorés', String(totaux.ignores || 0)] },
    ].concat(c.fps_moyen !== undefined ? [{ cellules: ['images/s moyenne', String(Math.round(c.fps_moyen))] }] : []) });

    if (c.environnement) {
      var env = c.environnement;
      var lignesEnv = [['source', env.source], ['navigateur', env.navigateur], ['GPU', env.gpu], ['vendor GPU', env.vendorGpu],
        ['accélération matérielle', env.accelerationMaterielle === undefined ? undefined : (env.accelerationMaterielle ? 'GPU' : 'logiciel')],
        ['résolution', env.resolution], ['OS', env.os], ['avec fenêtre', env.avecFenetre === undefined ? undefined : (env.avecFenetre ? 'oui' : 'non')],
        ['version du jeu', env.versionJeu], ['commit', env.commit], ['node', env.node]]
        .filter(function (p) { return p[1] !== undefined && p[1] !== null && p[1] !== ''; })
        .map(function (p) { return { cellules: [p[0], String(p[1])] }; });
      if (lignesEnv.length) { blocs.push({ type: 'titre', niveau: 2, texte: 'Environnement' }); blocs.push({ type: 'tableau', entetes: ['champ', 'valeur'], lignes: lignesEnv }); }
    }

    /* SPEC-BANC-070 : journal du périmètre d'un run restreint (fichiers et
       fonctions touchés, nombre de tests exclus, motif d'un repli) ;
       SPEC-BANC-076 : trous de périmètre d'un run complet. */
    if (c.perimetreDetail) {
      var p = c.perimetreDetail;
      var lignesP = [['nature du run', c.perimetre || ''],
        ['mode', p.mode === 'depuis' ? 'depuis ' + (p.depuis || '') : 'commit (fichiers indexés)'],
        ['repli sur la sélection complète', p.repli || 'non'],
        ['fichiers touchés', (p.fichiers || []).join(', ') || 'aucun'],
        ['fichiers changés depuis la carte', (p.fichiersImpact || p.fichiers || []).join(', ') || 'aucun'],
        ['fonctions touchées', (p.fonctions || []).join(', ') || 'aucune'],
        ['tests retenus', String(p.retenus === undefined ? '' : p.retenus)],
        ['tests exclus', String(p.exclus === undefined ? '' : p.exclus)],
        ['carte d\'impact', p.carte ? String(p.carte.commit || '').slice(0, 10) + (p.ecart !== null && p.ecart !== undefined ? ' (' + p.ecart + ' commit(s) d\'écart)' : '') : 'absente']]
        .map(function (l) { return { cellules: [l[0], l[1]] }; });
      blocs.push({ type: 'titre', niveau: 2, texte: 'Périmètre d\'exécution' });
      blocs.push({ type: 'tableau', entetes: ['champ', 'valeur'], lignes: lignesP });
      if (p.details && p.details.length) blocs.push({ type: 'liste', items: p.details });
    } else if (c.perimetre) {
      blocs.push({ type: 'paragraphe', texte: 'périmètre : ' + c.perimetre, meta: { classe: 'sub' } });
    }
    if (c.trousPerimetre && c.trousPerimetre.trous && c.trousPerimetre.trous.length) {
      blocs.push({ type: 'titre', niveau: 2, texte: '⚠ Trous de périmètre (' + c.trousPerimetre.trous.length + ')' });
      blocs.push({ type: 'paragraphe', texte: 'Ces échecs n\'auraient PAS été retenus par le périmètre du commit pour les fichiers changés depuis la carte d\'impact ' +
        String(c.trousPerimetre.carte || '').slice(0, 10) + ' : la carte n\'est pas digne de confiance pour eux.', meta: { classe: 'msg' } });
      blocs.push({ type: 'liste', items: c.trousPerimetre.trous.map(function (x) { return x.nom; }) });
    }

    if (totaux.parType || totaux.parDomaine) {
      var lignesMet = [];
      if (totaux.parType) Object.keys(totaux.parType).forEach(function (k) { lignesMet.push({ cellules: ['type : ' + k, String(totaux.parType[k])] }); });
      if (totaux.parDomaine) Object.keys(totaux.parDomaine).forEach(function (k) { lignesMet.push({ cellules: ['domaine : ' + k, String(totaux.parDomaine[k])] }); });
      if (lignesMet.length) { blocs.push({ type: 'titre', niveau: 2, texte: 'Métriques globales' }); blocs.push({ type: 'tableau', entetes: ['mesure', 'valeur'], lignes: lignesMet }); }
    }

    blocs.push({ type: 'saut_page' });
    blocs.push({ type: 'titre', niveau: 2, texte: 'Échecs (' + echecs.length + ')' });
    if (echecs.length) echecs.forEach(function (t) { blocs = blocs.concat(blocsTest(t)); });
    else blocs.push({ type: 'paragraphe', texte: 'aucun' });

    blocs.push({ type: 'titre', niveau: 2, texte: 'Tests lents' });
    blocs.push({ type: 'paragraphe', texte: lents.length ? lents.join(', ') : 'aucun' });

    var parType = grouper(tests);
    var sommaireEntrees = [];
    Object.keys(parType).sort().forEach(function (type) {
      sommaireEntrees.push({ texte: type, niveau: 1 });
      Object.keys(parType[type]).sort().forEach(function (dom) {
        sommaireEntrees.push({ texte: '  ' + dom, niveau: 2 });
      });
    });
    blocs.push({ type: 'saut_page' });
    blocs.push({ type: 'sommaire', entrees: sommaireEntrees });

    blocs.push({ type: 'titre', niveau: 2, texte: 'Tous les tests' });
    Object.keys(parType).sort().forEach(function (type) {
      blocs.push({ type: 'titre', niveau: 3, texte: type });
      var parDom = parType[type];
      Object.keys(parDom).sort().forEach(function (dom) {
        blocs.push({ type: 'paragraphe', texte: dom, meta: { classe: 'sousgroupe' } });
        var parGrp = parDom[dom];
        Object.keys(parGrp).forEach(function (grp) {
          blocs.push({ type: 'paragraphe', texte: grp, meta: { classe: 'sousgroupe2' } });
          parGrp[grp].forEach(function (t) { blocs = blocs.concat(blocsTest(t)); });
        });
      });
    });

    return { titre: 'Cahier de test MiniCraft', blocs: blocs };
  }

  // ── rendu HTML à partir du modèle ────────────────────────────────────────
  function CSS() {
    return '\n:root{--bg:#f6f7f9;--fg:#1a1d23;--muted:#6b7280;--panel:#ffffff;--border:#e2e5ea;' +
      '--ok:#1a7f37;--ko:#c0392b;--warn:#a06a00;--accent:#2563eb;}' +
      '@media (prefers-color-scheme: dark){:root{--bg:#0b0e13;--fg:#e8eaed;--muted:#9aa1ac;' +
      '--panel:#141922;--border:#262d3a;--ok:#7ee08a;--ko:#ff8a86;--warn:#f2c46d;--accent:#7fb2ff;}}' +
      '*{box-sizing:border-box;} body{background:var(--bg);color:var(--fg);' +
      'font:13px/1.55 ui-monospace,Menlo,Consolas,monospace;margin:0;padding:24px;max-width:980px;}' +
      'h1{font-size:20px;margin:0 0 4px;} h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid var(--border);padding-bottom:4px;}' +
      'h3{font-size:13px;margin:14px 0 6px;color:var(--accent);} h4{font-size:12.5px;margin:10px 0 2px;}' +
      '.sub{color:var(--muted);margin-bottom:16px;font-size:12px;}' +
      'table{border-collapse:collapse;width:100%;font-size:12px;margin-bottom:10px;}' +
      'td,th{padding:3px 8px;text-align:left;border-bottom:1px solid var(--border);}' +
      'p{margin:4px 0;white-space:pre-wrap;} p.fiche{background:rgba(127,127,127,.08);border-radius:6px;padding:6px 8px;font-size:12px;}' +
      'p.msg{color:var(--ko);font-size:12px;} p.pile{color:var(--muted);font-size:11px;white-space:pre-wrap;}' +
      'p.avobt{background:rgba(127,127,127,.08);border-radius:6px;padding:6px 8px;}' +
      'p.dur{color:var(--muted);font-size:11px;} p.sousgroupe{font-weight:bold;margin-top:10px;}' +
      'p.sousgroupe2{color:var(--muted);margin-left:10px;}' +
      'h4.ok{color:var(--ok);} h4.echec{color:var(--ko);} h4.delai{color:var(--warn);} h4.ignore{color:var(--muted);}' +
      'ul{margin:4px 0;padding-left:20px;color:var(--muted);font-size:11.5px;}' +
      'figure{margin:6px 0;display:inline-block;} figure img{width:160px;height:auto;border-radius:4px;border:1px solid var(--border);}' +
      'figcaption{font-size:10.5px;color:var(--muted);}' +
      '.saut-page{border-top:1px dashed var(--border);margin:18px 0;}' +
      'nav.sommaire ul{list-style:none;padding-left:0;} nav.sommaire li{padding:1px 0;}' +
      'nav.sommaire li[data-niveau="2"]{padding-left:14px;}';
  }

  function rendreBlocHTML(b, capturesRel) {
    if (b.type === 'titre') return '<h' + b.niveau + (b.meta && b.meta.etat ? ' class="' + e(b.meta.etat) + '"' : '') + '>' + e(b.texte) + '</h' + b.niveau + '>';
    if (b.type === 'paragraphe') return '<p' + (b.meta && b.meta.classe ? ' class="' + e(b.meta.classe) + '"' : '') + '>' + e(b.texte) + '</p>';
    if (b.type === 'liste') return '<ul>' + (b.items || []).map(function (i) { return '<li>' + e(i) + '</li>'; }).join('') + '</ul>';
    if (b.type === 'tableau') {
      var head = '<tr>' + b.entetes.map(function (h) { return '<th>' + e(h) + '</th>'; }).join('') + '</tr>';
      var body = (b.lignes || []).map(function (l) {
        var cellules = Array.isArray(l) ? l : l.cellules;
        var etat = Array.isArray(l) ? null : l.etat;
        return '<tr' + (etat ? ' class="' + e(etat) + '"' : '') + '>' + cellules.map(function (c) { return '<td>' + e(c) + '</td>'; }).join('') + '</tr>';
      }).join('');
      return '<table>' + head + body + '</table>';
    }
    if (b.type === 'image') {
      var src = b.src || ((capturesRel || 'captures/') + b.fichier);
      return '<figure><a href="' + e(src) + '" target="_blank"><img src="' + e(src) + '" alt="' + e(b.legende || '') + '" loading="lazy"></a>' +
        (b.legende ? '<figcaption>' + e(b.legende) + '</figcaption>' : '') + '</figure>';
    }
    if (b.type === 'saut_page') return '<div class="saut-page"></div>';
    if (b.type === 'sommaire') return '<nav class="sommaire"><ul>' + (b.entrees || []).map(function (s) {
      return '<li data-niveau="' + (s.niveau || 1) + '">' + e(s.texte) + '</li>';
    }).join('') + '</ul></nav>';
    return '';
  }

  function html(resultatsOuModele, options) {
    var opts = options || {};
    var capturesRel = opts.capturesRel || 'captures/';
    var m = (resultatsOuModele && resultatsOuModele.blocs) ? resultatsOuModele : modele(resultatsOuModele);
    var out = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">' +
      '<title>' + e(m.titre) + '</title><style>' + CSS() + '</style></head><body>';
    out += (m.blocs || []).map(function (b) { return rendreBlocHTML(b, capturesRel); }).join('');
    out += '</body></html>';
    return out;
  }

  MC_RAPPORT.modele = modele;
  MC_RAPPORT.html = html;
  MC_RAPPORT._echapper = echapper;
})(typeof globalThis !== 'undefined' ? globalThis : this);
