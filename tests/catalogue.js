/* catalogue.js — un seul catalogue de tests, classé et sélectionnable, qui
   sert à la fois le banc navigateur, `node tests/run.js`, les crochets git et
   les portes (L42, SPEC-BANC-001 à 005). Module PUR au même sens que
   src/*.js : ni THREE, ni document, ni window — chargeable sous Node (vm)
   comme dans le navigateur, sans DOM (tests/gates.js le vérifie comme le
   reste des modules purs, bien qu'il vive dans tests/ et non src/).

   API :
     MC_TESTS.construire(T, e2eListe, specsIndex) → [entrée, ...]
       Une entrée : { id, nom, type, fichier, groupe, domaines, specs,
                       etiquettes, fiche: { teste, pourquoi, attendu, source } }
       - `T` est l'objet du harnais (tests/harness.js) APRÈS avoir chargé et
         évalué tous les fichiers tests/*.js : T.suites contient describe/it,
         chacun marqué de son `fichier` d'origine (T.fichierCourant, posé par
         le chargeur avant chaque fichier — voir tests/run.js).
       - `e2eListe` : tableau d'entrées e2e déjà préparées par l'appelant,
         de la forme { nom, groupe?, etiquettes? } au minimum. La page du banc
         les construit depuis tests/e2e.js (qu'elle charge et exécute dans le
         navigateur) ; sous Node, tests/run.js les obtient en lisant le TEXTE
         de tests/e2e.js (les tests e2e ne s'exécutent jamais sous Node — league
         SPEC-BANC-005 : « les types e2e ne s'exécutent pas sous Node »). Passer
         un tableau vide est valide : le catalogue est alors seulement Node.
       - `specsIndex` : le résultat de indexSpecs(texte de SPECS.md), pour
         déduire une fiche des tests qui citent une SPEC sans en déclarer.

     MC_TESTS.selection(catalogue, criteres) → [entrée, ...]
       criteres = { tests:[noms|ids], domaines:[...], types:[...], groupes:[...],
                     liste:[noms|ids], echecs:[noms|ids], sauf:{...mêmes clés},
                     etiquettes:[...] — extension documentée, voir plus bas —,
                     tout: bool }
       Les critères NON VIDES se combinent par INTERSECTION (ET logique) :
       demander domaines:['SYNC'] ET types:['spec'] ne garde que les tests spec
       du domaine SYNC. `sauf` est la même forme de critères, appliquée en
       EXCLUSION (un test qui correspond à tous les critères de `sauf` est
       retiré). `tout:true` sélectionne tout le catalogue (moins `sauf`),
       quels que soient les autres critères — c'est ce qu'utilise le
       préréglage `regression`.
       Extension : `etiquettes` n'est pas dans la liste énumérée par le
       contrat (SPEC-BANC-003/004), mais SPEC-BANC-001 déclare que les tests
       PORTENT des étiquettes (`@lent`, `@bug-NNN`…) et SPEC-BANC-004 a besoin
       de les sélectionner (préréglage `bugs`) ou de les exclure (préréglage
       `commit`, qui exclut `@lent`). Le champ est ignoré si absent : aucun
       appelant qui s'en tient aux clés documentées n'est affecté.

     MC_TESTS.preset(nom) → critères (ou null si le préréglage est inconnu)
     MC_TESTS.PRESETS → tableau { nom, description, pour, criteres } —
       chargé depuis tests/presets.js (G.MC_PRESETS), voir ce fichier.

     MC_TESTS.indexSpecs(texteSpecsMd) → { 'SPEC-<DOMAINE>-<NNN>': { spec, verification, etat } }
       Relit SPECS.md : une ligne de tableau `| SPEC-ID | Spec | Vérification | État |`
       donne une entrée. Sert à déduire quoi/pourquoi/attendu pour un test qui
       cite une SPEC sans fiche déclarée (SPEC-BANC-002). */
(function (G) {
  'use strict';
  var MC_TESTS = G.MC_TESTS = G.MC_TESTS || {};

  var RE_SPEC = /\bSPEC-([A-Z0-9]+)-(\d{3,})\b/g;

  function idsDe(texte) {
    var ids = [], vus = {};
    if (!texte) return ids;
    var m;
    RE_SPEC.lastIndex = 0;
    while ((m = RE_SPEC.exec(texte))) {
      var id = m[0];
      if (!vus[id]) { vus[id] = true; ids.push(id); }
    }
    return ids;
  }
  function domainesDe(ids) {
    var dom = [], vus = {};
    ids.forEach(function (id) {
      var d = /^SPEC-([A-Z0-9]+)-/.exec(id)[1];
      if (!vus[d]) { vus[d] = true; dom.push(d); }
    });
    return dom;
  }

  // ── SPEC-BANC-001 : type déduit du fichier ──────────────────────────────
  function typeDeFichier(fichier) {
    var base = String(fichier || '').replace(/^tests\//, '').replace(/\.js$/, '');
    if (base === 'unit') return 'unitaire';
    if (base === 'functional') return 'fonctionnel';
    if (base === 'charge' || /^integration-charge/.test(base)) return 'charge';
    if (/^integration-/.test(base)) return 'integration';
    if (base === 'e2e') return 'e2e';
    if (/^spec-/.test(base)) return 'spec';
    return 'unitaire'; // repli documenté : tout fichier non reconnu compte comme unitaire
  }

  // ── SPEC-BANC-001 : étiquettes @xxx dans le nom ou la fiche ─────────────
  var RE_ETIQUETTE = /@([a-z0-9-]+)/g;
  // fichiers de sondes d'exploration (lot perf) : non bloquants par nature —
  // étiquetés automatiquement, sans dépendre de leur contenu (coordination L42/perf)
  var RE_FICHIER_EXPLORATION = /(^|\/)(limites-sondes|spec-limites|spec-perf)\.js$/;
  /* On ne scanne QUE le nom du test et le tableau `fiche.etiquettes` déclaré
     explicitement — jamais le texte libre `fiche.teste`/`fiche.pourquoi` :
     ce texte, surtout quand il est déduit de SPECS.md, peut légitimement
     PARLER de la convention `@lent` (comme cette spec-ci) sans vouloir
     étiqueter le test qui en parle. Un faux positif y a mordu une fois
     (SPEC-BANC-001/004 exclus de `commit` par leur propre description) —
     la portée volontairement étroite l'évite pour de bon. */
  function etiquettesDe(nom, fiche, fichier) {
    var set = {}, out = [];
    function ajouterDe(texte) {
      if (!texte) return;
      var m; RE_ETIQUETTE.lastIndex = 0;
      while ((m = RE_ETIQUETTE.exec(texte))) { if (!set[m[1]]) { set[m[1]] = true; out.push(m[1]); } }
    }
    ajouterDe(nom);
    if (fiche) (fiche.etiquettes || []).forEach(function (e) { if (!set[e]) { set[e] = true; out.push(e); } });
    if (fichier && RE_FICHIER_EXPLORATION.test(fichier) && !set.exploration) { set.exploration = true; out.push('exploration'); }
    return out;
  }

  // ── SPEC-BANC-002 : fiche déclarée, sinon déduite de la 1re spec citée ──
  function ficheDe(ids, specsIndex, ficheDeclaree, ficheGroupe) {
    if (ficheDeclaree && (ficheDeclaree.teste || ficheDeclaree.attendu)) {
      return { teste: ficheDeclaree.teste, pourquoi: ficheDeclaree.pourquoi, attendu: ficheDeclaree.attendu, source: 'declaree' };
    }
    if (ids.length && specsIndex && specsIndex[ids[0]]) {
      var s = specsIndex[ids[0]];
      return { teste: s.spec, pourquoi: 'couvre ' + ids[0] + ' — ' + s.spec, attendu: s.verification, source: 'spec' };
    }
    if (ficheGroupe && (ficheGroupe.teste || ficheGroupe.attendu)) {
      return { teste: ficheGroupe.teste, pourquoi: ficheGroupe.pourquoi, attendu: ficheGroupe.attendu, source: 'declaree' };
    }
    return null;
  }

  function idUnique(prefixe, nom, index) {
    return prefixe + '-' + index + '-' + String(nom).slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '_');
  }

  function construire(T, e2eListe, specsIndex) {
    var out = [];
    var index = 0;
    (T.suites || []).forEach(function (suite) {
      var type = typeDeFichier(suite.fichier);
      (suite.tests || []).forEach(function (t) {
        index++;
        var ids = idsDe(t.name);
        var fiche = ficheDe(ids, specsIndex, t.fiche, suite.fiche);
        out.push({
          id: idDeSpecOuGenere(ids, 'N', t.name, index),
          nom: t.name,
          type: type,
          fichier: suite.fichier,
          groupe: suite.name,
          domaines: domainesDe(ids),
          specs: ids,
          etiquettes: etiquettesDe(t.name, fiche || t.fiche, suite.fichier),
          fiche: fiche,
        });
      });
    });
    (e2eListe || []).forEach(function (e, i) {
      index++;
      var nom = e.nom || e.name;
      var ids = idsDe(nom);
      var fiche = ficheDe(ids, specsIndex, e.fiche, null);
      out.push({
        id: idDeSpecOuGenere(ids, 'E', nom, index),
        nom: nom,
        // `e.type` : par défaut 'e2e' (banc navigateur) ; run.js s'en sert
        // aussi pour cataloguer les scripts d'intégration/de charge, qui ne
        // passent pas par describe/it (voir l'en-tête de tests/run.js)
        type: e.type || 'e2e',
        fichier: e.fichier || 'tests/e2e.js',
        groupe: e.groupe || 'e2e',
        domaines: domainesDe(ids),
        specs: ids,
        etiquettes: etiquettesDe(nom, fiche || e.fiche, e.fichier || 'tests/e2e.js'),
        fiche: fiche,
      });
    });
    return out;
  }
  function idDeSpecOuGenere(ids, prefixe, nom, index) {
    return ids.length ? ids[0] : idUnique(prefixe, nom, index);
  }

  // ── SPEC-BANC-003 : sélection combinable ────────────────────────────────
  function contient(liste, valeur) { return liste.indexOf(valeur) >= 0; }
  function intersecte(a, b) { for (var i = 0; i < a.length; i++) if (contient(b, a[i])) return true; return false; }

  var CORRESPOND = {
    tests: function (t, v) { return contient(v, t.id) || contient(v, t.nom); },
    liste: function (t, v) { return contient(v, t.id) || contient(v, t.nom); },
    echecs: function (t, v) { return contient(v, t.id) || contient(v, t.nom); },
    domaines: function (t, v) { return intersecte(t.domaines, v); },
    types: function (t, v) { return contient(v, t.type); },
    groupes: function (t, v) { return contient(v, t.groupe); },
    etiquettes: function (t, v) { return intersecte(t.etiquettes, v); },
  };
  var CLES = Object.keys(CORRESPOND);

  function aValeur(v) { return Array.isArray(v) ? v.length > 0 : !!v; }

  function clesActives(criteres) {
    return CLES.filter(function (k) { return aValeur(criteres[k]); });
  }

  function correspondATout(t, criteres, cles) {
    return cles.every(function (k) { return CORRESPOND[k](t, criteres[k]); });
  }

  function selection(catalogue, criteres) {
    var c = criteres || {};
    var actives = clesActives(c);
    var base;
    if (c.tout || !actives.length) base = catalogue.slice();
    else base = catalogue.filter(function (t) { return correspondATout(t, c, actives); });
    if (c.sauf) {
      var exclActives = clesActives(c.sauf);
      if (exclActives.length) base = base.filter(function (t) { return !correspondATout(t, c.sauf, exclActives); });
    }
    return base;
  }

  // ── SPEC-BANC-004 : préréglages, définis dans tests/presets.js ─────────
  function preset(nom) {
    var liste = MC_TESTS.PRESETS || [];
    for (var i = 0; i < liste.length; i++) if (liste[i].nom === nom) return liste[i].criteres;
    return null;
  }

  // ── indexSpecs : lecture de SPECS.md ────────────────────────────────────
  function indexSpecs(texte) {
    var out = {};
    if (!texte) return out;
    texte.split('\n').forEach(function (ligne) {
      var m = /^\s*\|\s*(SPEC-[A-Z0-9]+-\d{3,})\s*\|(.*)\|(.*)\|\s*(⏳|✅)?\s*\|\s*$/.exec(ligne);
      if (!m) return;
      out[m[1]] = { spec: m[2].trim(), verification: m[3].trim(), etat: m[4] || '' };
    });
    return out;
  }

  MC_TESTS.construire = construire;
  MC_TESTS.selection = selection;
  MC_TESTS.preset = preset;
  MC_TESTS.indexSpecs = indexSpecs;
  Object.defineProperty(MC_TESTS, 'PRESETS', {
    get: function () { return (G.MC_PRESETS || []); }, configurable: true,
  });
  // exposés pour réutilisation (tests/rapport.js, tests/gates.js) sans dupliquer la logique
  MC_TESTS._typeDeFichier = typeDeFichier;
  MC_TESTS._idsDe = idsDe;
})(typeof globalThis !== 'undefined' ? globalThis : this);
