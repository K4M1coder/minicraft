/* ui.js — HUD et écrans (inventaire, établi, fourneau, pause, mort).
   Tout est en DOM : plus simple à inspecter et à tester qu'un rendu canvas. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core, Inv = MC.Inventory, DC = MC.DayCycle, C_Chat = MC.Chat;

  function createUI(root, atlas, hooks, registre) {
    var Livre = MC.Livre;
    hooks = hooks || {};
    var ICON = 32;
    var Hud = MC.Hud;

    /* Icône d'un objet : on découpe l'atlas en fond CSS plutôt que de créer
       un canvas par case — beaucoup moins d'objets pour 36 cases rafraîchies. */
    function iconStyle(id, size) {
      var s = size || ICON;
      var d = C.def(id);
      if (!d) return '';
      var tile = C.isBlock(id) ? d.tiles[0] : d.tile;
      var tx = tile % atlas.COLS, ty = (tile / atlas.COLS) | 0;
      return 'background-image:url(' + atlas.dataURL + ');' +
             'background-size:' + (atlas.COLS * s) + 'px ' + (atlas.ROWS * s) + 'px;' +
             'background-position:' + (-tx * s) + 'px ' + (-ty * s) + 'px;' +
             'width:' + s + 'px;height:' + s + 'px;image-rendering:pixelated;';
    }

    function el(tag, cls, html) {
      var e = document.createElement(tag);
      if (cls) e.className = cls;
      if (html !== undefined) e.innerHTML = html;
      return e;
    }

    // ══════════════════════════════════════════════════════════════════════
    // HUD — un par joueur local, chacun ancre dans sa propre vue
    // ══════════════════════════════════════════════════════════════════════
    var hud = el('div', 'hud');
    root.appendChild(hud);

    /* Barre de vie du gardien de donjon, en haut de l'écran. Elle n'existe
       que pendant le combat : la cacher ailleurs évite un HUD encombré. */
    var barreBossEl = el('div', 'barre-boss',
      '<div class="barre-boss-nom"></div><div class="barre-boss-jauge"><div></div></div>');
    barreBossEl.style.display = 'none';
    root.appendChild(barreBossEl);
    var barreBossNom = barreBossEl.querySelector('.barre-boss-nom');
    var barreBossRemplie = barreBossEl.querySelector('.barre-boss-jauge > div');
    // ══════════════════════════════════════════════════════════════════════
    // Carte : le monde exploré, vu du ciel, et les points de repère
    // ══════════════════════════════════════════════════════════════════════
    var carteEl = el('div', 'carte-panneau');
    carteEl.style.display = 'none';
    carteEl.innerHTML =
      '<div class="carte-tete"><b>Carte</b><span class="carte-aide">clic : poser un repère · ' +
      'clic droit sur un repère : le retirer · molette : zoom</span></div>' +
      '<div class="carte-corps"><canvas width="480" height="480"></canvas>' +
      '<div class="carte-cote"><div class="carte-zoom"><button data-z="-1">−</button>' +
      '<span class="carte-echelle"></span><button data-z="1">+</button></div>' +
      '<input class="carte-nom" maxlength="24" placeholder="Nom du prochain repère">' +
      '<button class="carte-ici">Repère ici</button><div class="carte-liste"></div></div></div>';
    root.appendChild(carteEl);
    var carteCanvas = carteEl.querySelector('canvas');
    var carteCtx = carteCanvas.getContext('2d');
    var carte = null;                  // { world, joueur, reperes, exploration, echelle }
    var ECHELLES = [0.5, 1, 2, 4, 8];  // blocs par pixel

    function dessinerCarte() {
      if (!carte) return;
      var W = carteCanvas.width, H = carteCanvas.height;
      var j = carte.joueur, ech = carte.echelle;
      var img = carteCtx.createImageData(W, H), px = img.data;
      var cxMonde = j.pos.x, czMonde = j.pos.z;
      var tuiles = {};
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var m = MC.Carte.versMonde(x, y, W, H, cxMonde, czMonde, ech);
        var bx = Math.floor(m.x), bz = Math.floor(m.z);
        var ccx = Math.floor(bx / 16), ccz = Math.floor(bz / 16), k = ccx + ',' + ccz;
        var t = tuiles[k];
        if (t === undefined) t = tuiles[k] = carte.exploration.tuile(carte.world, ccx, ccz);
        var o = (y * W + x) * 4;
        if (!t) {
          // inexploré : du parchemin, légèrement quadrillé
          var q = ((bx >> 4) + (bz >> 4)) & 1 ? 214 : 206;
          px[o] = q; px[o + 1] = q - 16; px[o + 2] = q - 44; px[o + 3] = 255;
          continue;
        }
        var i = (((bz - ccz * 16) * 16) + (bx - ccx * 16)) * 4;
        px[o] = t[i]; px[o + 1] = t[i + 1]; px[o + 2] = t[i + 2]; px[o + 3] = 255;
      }
      carteCtx.putImageData(img, 0, 0);
      // repères
      carteCtx.font = 'bold 12px ui-monospace, Menlo, Consolas, monospace';
      carte.reperes.liste.forEach(function (r) {
        var p = MC.Carte.versCarte(r.x + 0.5, r.z + 0.5, W, H, cxMonde, czMonde, ech);
        if (p.px < -20 || p.py < -20 || p.px > W + 20 || p.py > H + 20) return;
        carteCtx.fillStyle = r.couleur; carteCtx.strokeStyle = '#111';
        carteCtx.beginPath(); carteCtx.arc(p.px, p.py, 6, 0, 7); carteCtx.fill(); carteCtx.stroke();
        if (carte.reperes.suivi === r.id) { carteCtx.beginPath(); carteCtx.arc(p.px, p.py, 10, 0, 7); carteCtx.stroke(); }
        carteCtx.fillStyle = '#111'; carteCtx.fillText(r.nom, p.px + 9, p.py - 7);
      });
      // le joueur : une flèche dans le sens du regard
      carteCtx.save();
      carteCtx.translate(W / 2, H / 2); carteCtx.rotate(-j.yaw);
      carteCtx.fillStyle = '#fff'; carteCtx.strokeStyle = '#111'; carteCtx.lineWidth = 1.5;
      carteCtx.beginPath(); carteCtx.moveTo(0, -9); carteCtx.lineTo(6, 7); carteCtx.lineTo(0, 3); carteCtx.lineTo(-6, 7);
      carteCtx.closePath(); carteCtx.fill(); carteCtx.stroke();
      carteCtx.restore();
      carteEl.querySelector('.carte-echelle').textContent = '1 px = ' + ech + ' bloc' + (ech > 1 ? 's' : '');
      listerReperes();
    }

    function listerReperes() {
      var l = carteEl.querySelector('.carte-liste');
      l.innerHTML = carte.reperes.liste.map(function (r) {
        var d = Math.round(Math.hypot(r.x - carte.joueur.pos.x, r.z - carte.joueur.pos.z));
        return '<div class="carte-rep' + (carte.reperes.suivi === r.id ? ' suivi' : '') + '" data-id="' + r.id + '">' +
          '<i style="background:' + r.couleur + '"></i><span>' + echapper(r.nom) + '</span><small>' + d + ' m</small>' +
          '<button class="suivre" data-id="' + r.id + '" title="Suivre">◎</button>' +
          '<button class="retirer" data-id="' + r.id + '" title="Retirer">✕</button></div>';
      }).join('') || '<p class="carte-vide">Aucun repère.</p>';
      l.querySelectorAll('.suivre').forEach(function (b) {
        b.onclick = function () {
          var id = +b.getAttribute('data-id');
          carte.reperes.suivi = carte.reperes.suivi === id ? null : id;
          dessinerCarte();
        };
      });
      l.querySelectorAll('.retirer').forEach(function (b) {
        b.onclick = function () { retirerRepere(+b.getAttribute('data-id')); };
      });
    }
    function echapper(t) {
      return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
    }
    function ajouterRepere(x, z) {
      var champ = carteEl.querySelector('.carte-nom');
      var r = carte.reperes.ajouter(champ.value.trim() || ('Repère ' + (carte.reperes.liste.length + 1)), x, z);
      champ.value = '';
      if (carte.surChange) carte.surChange('ajout', r);
      dessinerCarte();
      return r;
    }
    function retirerRepere(id) {
      if (carte.reperes.suivi === id) carte.reperes.suivi = null;
      carte.reperes.retirer(id);
      if (carte.surChange) carte.surChange('retrait', id);
      dessinerCarte();
    }
    function repereSous(ev) {
      var rect = carteCanvas.getBoundingClientRect();
      var px = (ev.clientX - rect.left) * carteCanvas.width / rect.width;
      var py = (ev.clientY - rect.top) * carteCanvas.height / rect.height;
      var m = MC.Carte.versMonde(px, py, carteCanvas.width, carteCanvas.height, carte.joueur.pos.x, carte.joueur.pos.z, carte.echelle);
      var r = carte.reperes.proche(m.x, m.z, 9 * carte.echelle);
      return { monde: m, repere: r };
    }
    carteCanvas.addEventListener('mousedown', function (ev) {
      if (!carte) return;
      ev.preventDefault();
      var q = repereSous(ev);
      if (ev.button === 2) { if (q.repere) retirerRepere(q.repere.id); return; }
      if (q.repere) { carte.reperes.suivi = q.repere.id; dessinerCarte(); return; }
      ajouterRepere(q.monde.x, q.monde.z);
    });
    carteCanvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    carteCanvas.addEventListener('wheel', function (ev) { ev.preventDefault(); zoomer(ev.deltaY > 0 ? 1 : -1); });
    function zoomer(sens) {
      var i = ECHELLES.indexOf(carte.echelle);
      i = Math.max(0, Math.min(ECHELLES.length - 1, i + sens));
      carte.echelle = ECHELLES[i];
      dessinerCarte();
    }
    carteEl.querySelectorAll('.carte-zoom button').forEach(function (b) {
      b.onclick = function () { zoomer(-(+b.getAttribute('data-z'))); };
    });
    carteEl.querySelector('.carte-ici').onclick = function () { ajouterRepere(carte.joueur.pos.x, carte.joueur.pos.z); };

    function ouvrirCarte(opts) {
      carte = { world: opts.world, joueur: opts.joueur, reperes: opts.reperes, exploration: opts.exploration,
                echelle: carte ? carte.echelle : 2, surChange: opts.surChange };
      carteEl.style.display = '';
      dessinerCarte();
      return carteEl;
    }
    function fermerCarte() { carteEl.style.display = 'none'; var o = !!carte; carte = null; return o; }
    function carteOuverte() { return !!carte; }

    // ══════════════════════════════════════════════════════════════════════
    // Factions : ce que chaque camp pense du joueur
    // ══════════════════════════════════════════════════════════════════════
    var factionsEl = el('div', 'factions-panneau');
    factionsEl.style.display = 'none';
    root.appendChild(factionsEl);
    var factionsVisibles = false;

    // ══════════════════════════════════════════════════════════════════════
    // Succès (SPEC-SUCCES-001) : progression de chaque succès de la partie
    // ══════════════════════════════════════════════════════════════════════
    var succesEl = el('div', 'factions-panneau succes-panneau');
    succesEl.style.display = 'none';
    root.appendChild(succesEl);
    var succesVisibles = false;
    function panneauSucces(suivi) {
      var lignes = suivi ? suivi.progression() : [];
      var faits = lignes.filter(function (l) { return l.fait; }).length;
      succesEl.innerHTML = '<div class="carte-tete"><b>Succès (' + faits + '/' + lignes.length + ')</b>' +
        '<span class="carte-aide">K pour fermer</span></div>' +
        '<div class="succes-liste">' + lignes.map(function (l) {
          var pct = l.seuil ? Math.min(100, Math.round((l.compte / l.seuil) * 100)) : 100;
          return '<div class="succes' + (l.fait ? ' fait' : '') + '">' +
            '<div class="faction-l"><b>' + ech(l.nom) + '</b>' +
            '<span class="st ' + (l.fait ? 'amical' : 'neutre') + '">' +
            (l.fait ? 'Débloqué' : l.compte + '/' + l.seuil) + '</span></div>' +
            '<div class="faction-jauge"><div style="width:' + pct + '%"></div></div>' +
            '<small>' + ech(l.description) + '</small></div>';
        }).join('') + '</div>';
      succesEl.style.display = '';
      succesVisibles = true;
      return succesEl;
    }
    function fermerSucces() { var o = succesVisibles; succesEl.style.display = 'none'; succesVisibles = false; return o; }
    function succesOuverts() { return succesVisibles; }

    // ─── mode histoire : objectif, dialogue, journal, fin ─────────────────────
    var objectifEl = el('div', 'objectif-histoire');
    objectifEl.style.display = 'none';
    root.appendChild(objectifEl);
    function objectifHistoire(o, pos) {
      if (!o) { objectifEl.style.display = 'none'; return; }
      var dist = '';
      if (o.cible && pos) {
        var d = Math.round(Math.hypot(o.cible.x - pos.x, o.cible.z - pos.z));
        dist = ' · ' + d + ' m';
      }
      var prog = o.n ? ' (' + o.progres + '/' + o.n + ')' : '';
      objectifEl.innerHTML = '<small>Chapitre ' + o.numero + '/' + o.total + ' — ' + ech(o.chapitre) + '</small><br>' +
                             ech(o.texte) + prog + dist;
      objectifEl.style.display = '';
    }
    var dialogueEl = el('div', 'dialogue-histoire');
    dialogueEl.style.display = 'none';
    root.appendChild(dialogueEl);
    /* Une réplique du récit : un titre, un texte, et des choix (ou « Continuer »).
       `surChoix(id)` reçoit l'option retenue, ou null. */
    function dialogueHistoire(d, surChoix) {
      var choix = d.choix && d.choix.length ? d.choix : [{ id: null, texte: 'Continuer' }];
      dialogueEl.innerHTML = '<h3>' + ech(d.titre || '') + '</h3><p>' + ech(d.texte || '') + '</p><div class="row"></div>';
      var row = dialogueEl.querySelector('.row');
      choix.forEach(function (c) {
        var b = el('button', c.id === null ? 'primary' : 'choix-histoire', ech(c.texte));
        b.addEventListener('mousedown', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          dialogueEl.style.display = 'none';
          if (surChoix) surChoix(c.id);
        });
        row.appendChild(b);
      });
      dialogueEl.style.display = '';
    }
    function dialogueOuvert() { return dialogueEl.style.display !== 'none'; }
    var journalEl = el('div', 'journal-histoire');
    journalEl.style.display = 'none';
    root.appendChild(journalEl);
    /* `etat` : l'état MC.Recits (archetype + histoire/enquete/colonie).
       `finNotif` : la notification de fin déjà reçue par le jeu (son titre
       complet), pour ne pas dépendre d'une table de fins propre à l'épopée. */
    function journalHistoire(etat, finNotif) {
      var R = MC.Recits;
      if (!etat || !R) { journalEl.style.display = 'none'; return false; }
      var inner = etat.histoire || etat.enquete || etat.colonie || {};
      var arche = R.ARCHETYPES[etat.archetype];
      var titreRecit = arche ? arche.nom : (MC.Histoire ? MC.Histoire.TITRE : '');
      var o = R.objectif(etat), q = R.quetesActives(etat);
      var titreQuetes = etat.archetype === 'epopee'
        ? 'Quêtes secondaires (' + inner.secondairesFaites + '/' + inner.secondairesPrevues + ')' : 'Quêtes';
      var texteFin = inner.fin
        ? (finNotif && finNotif.titre ? finNotif.titre
           : (etat.archetype === 'epopee' && MC.Histoire ? MC.Histoire.finDe(inner.fin).titre : inner.fin))
        : '';
      journalEl.innerHTML = '<div class="carte-tete"><b>' + ech(titreRecit) + '</b><span class="carte-aide">H pour fermer</span></div>' +
        (o ? '<p><b>Chapitre ' + o.numero + '/' + o.total + ' — ' + ech(o.chapitre) + '</b><br>' + ech(o.texte) + '</p>'
           : '<p><b>' + (inner.fin ? 'Fin : ' + ech(texteFin) : 'Histoire terminée') + '</b></p>') +
        '<h4>' + ech(titreQuetes) + '</h4>' +
        (q.length ? '<ul>' + q.map(function (x) {
          return '<li class="' + x.etat + '">' + ech(x.titre) + ' — ' + ech(x.texte) + (x.etat === 'faite' ? ' ✔' : '') + '</li>';
        }).join('') + '</ul>' : '<p class="aide">Parlez aux habitants : fermiers, forgerons, aubergistes… ont besoin d\'aide.</p>') +
        '<h4>Journal</h4><ul class="journal">' + (inner.journal || []).slice(-12).reverse().map(function (t) { return '<li>' + ech(t) + '</li>'; }).join('') + '</ul>';
      journalEl.style.display = '';
      return true;
    }
    function fermerJournal() { var o = journalEl.style.display !== 'none'; journalEl.style.display = 'none'; return o; }
    function journalOuvert() { return journalEl.style.display !== 'none'; }
    function ecranFin(f, stats, titreRecit) {
      showScreen('<div class="panel large fin-histoire"><p class="sub">' + ech(titreRecit || (MC.Histoire ? MC.Histoire.TITRE : '')) + '</p>' +
        '<h1>' + ech(f.titre) + '</h1><p class="epilogue">' + ech(f.texte) + '</p>' +
        (stats ? '<p class="hint">' + ech(stats) + '</p>' : '') +
        '<div class="row"><button id="btn-continuer" class="primary">Continuer à explorer</button>' +
        '<button id="btn-menu-fin">Menu principal</button></div></div>');
      overlay.querySelector('#btn-continuer').onclick = function () { hooks.onContinuerFin && hooks.onContinuerFin(); };
      overlay.querySelector('#btn-menu-fin').onclick = function () { hooks.onRetourMenu && hooks.onRetourMenu(); };
    }
    var LIBELLES = { hostile: 'Hostile', neutre: 'Neutre', amical: 'Amical' };
    function panneauFactions(rep) {
      var F = MC.Factions;
      factionsEl.innerHTML = '<div class="carte-tete"><b>Factions</b><span class="carte-aide">J pour fermer</span></div>' +
        F.ORDRE.map(function (id) {
          var f = F.FACTIONS[id], v = rep ? rep.get(id) : f.depart, st = F.statut(id, rep);
          var pct = (v + 100) / 2;
          var ennemis = f.ennemis.map(function (e) { return F.FACTIONS[e].nom; }).join(', ') || 'aucun';
          return '<div class="faction"><div class="faction-l"><b>' + f.nom + '</b>' +
            '<span class="st ' + st + '">' + LIBELLES[st] + '</span></div>' +
            '<div class="faction-jauge"><div style="width:' + pct + '%"></div><i style="left:50%"></i></div>' +
            '<small>Réputation ' + (v > 0 ? '+' : '') + v + ' · ennemis : ' + ennemis + '</small></div>';
        }).join('');
      factionsEl.style.display = '';
      factionsVisibles = true;
      return factionsEl;
    }
    function fermerFactions() { factionsEl.style.display = 'none'; var o = factionsVisibles; factionsVisibles = false; return o; }
    function factionsOuvertes() { return factionsVisibles; }

    // boussole : le repère suivi, sa distance et son sens, en haut de l'écran
    var boussoleEl = el('div', 'boussole');
    boussoleEl.style.display = 'none';
    root.appendChild(boussoleEl);
    var FLECHES = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
    function boussole(reperes, joueur) {
      var r = reperes && reperes.suivi && reperes.liste.filter(function (x) { return x.id === reperes.suivi; })[0];
      if (!r) { boussoleEl.style.display = 'none'; return null; }
      var d = reperes.direction(r, joueur.pos.x, joueur.pos.z, joueur.yaw);
      var i = ((Math.round(d.angle / (Math.PI / 4)) % 8) + 8) % 8;
      boussoleEl.style.display = '';
      boussoleEl.innerHTML = '<i style="background:' + r.couleur + '"></i>' + echapper(r.nom) +
        ' · <b>' + Math.round(d.distance) + ' m</b> <span class="fl">' + FLECHES[i] + '</span>';
      return { repere: r, distance: d.distance, fleche: FLECHES[i] };
    }

    function barreBoss(info) {
      if (!info) { barreBossEl.style.display = 'none'; return false; }
      barreBossEl.style.display = '';
      barreBossNom.textContent = info.nom;
      var f = Math.max(0, Math.min(1, info.hp / info.max));
      barreBossRemplie.style.width = (f * 100).toFixed(1) + '%';
      return true;
    }

    /* Calques supplementaires pour les joueurs 2 a 4. Le joueur 1 garde le
       HUD principal : le solo emprunte donc exactement le meme chemin de code
       que l'ecran partage, ce qui evite un mode « special multi » non teste. */
    var huds = [];
    function hudDe(i) {
      if (i === 0) return hud;
      while (huds.length < i) {
        var idx = huds.length + 1;
        var d = el('div', 'hud hud-joueur');
        d.innerHTML =
          '<div class="crosshair"></div>' +
          '<div class="mining-ring"><div class="mining-fill"></div></div>' +
          '<div class="stats"><div class="bar health"></div><div class="bar hunger"></div>' +
          '<div class="bar air"></div></div>' +
          '<div class="hotbar"></div>' +
          '<div class="held-name"></div>' +
          '<div class="etiquette">Joueur ' + (idx + 1) + '</div>';
        root.appendChild(d);
        huds.push(d);
      }
      return huds[i - 1];
    }

    /* Positionne chaque HUD sur le rectangle de sa vue. */
    function placerHuds(vues) {
      etiquette1.style.display = vues.length > 1 ? '' : 'none';
      for (var i = 0; i < Math.max(vues.length, huds.length + 1); i++) {
        var d = i === 0 ? hud : (i <= huds.length ? huds[i - 1] : null);
        if (!d) continue;
        var v = vues[i];
        if (!v) { d.style.display = 'none'; continue; }
        d.style.display = '';
        d.style.left = v.x + 'px'; d.style.top = v.y + 'px';
        d.style.width = v.w + 'px'; d.style.height = v.h + 'px';
        d.style.right = 'auto'; d.style.bottom = 'auto';
        d.classList.toggle('compact', v.h < 420);
      }
      // cree les calques manquants puis repositionne
      if (vues.length > huds.length + 1) {
        for (var j = 1; j < vues.length; j++) hudDe(j);
        placerHuds(vues);
      }
      appliquerHud();
    }

    /* Applique l'état du registre au DOM (SPEC-HUD-001 à 012) : chaque
       composant masqué reçoit `hud-masque` (display:none !important dans
       ui.css) sur TOUS ses sélecteurs, y compris dans les calques d'écran
       partagé créés dynamiquement par hudDe — d'où la recherche à chaque
       appel plutôt qu'une capture d'éléments figée à la construction. */
    function appliquerHud() {
      if (!registre) return;
      Hud.COMPOSANTS.forEach(function (c) {
        var vis = registre.visible(c.id);
        c.selecteurs.forEach(function (sel) {
          var els = root.querySelectorAll(sel);
          for (var i = 0; i < els.length; i++) els[i].classList.toggle('hud-masque', !vis);
        });
      });
    }

    var crosshair = el('div', 'crosshair');
    hud.appendChild(crosshair);

    var miningRing = el('div', 'mining-ring');
    miningRing.innerHTML = '<div class="mining-fill"></div>';
    hud.appendChild(miningRing);
    var miningFill = miningRing.querySelector('.mining-fill');

    var stats = el('div', 'stats');
    var healthBar = el('div', 'bar health');
    var hungerBar = el('div', 'bar hunger');
    var airBar = el('div', 'bar air');
    stats.appendChild(healthBar); stats.appendChild(hungerBar); stats.appendChild(airBar);
    hud.appendChild(stats);

    var hotbar = el('div', 'hotbar');
    hud.appendChild(hotbar);
    var hotbarSlots = [];
    for (var i = 0; i < Inv.HOTBAR_SIZE; i++) {
      var s = el('div', 'slot hb');
      s.innerHTML = '<span class="k">' + (i + 1) + '</span><div class="ico"></div>' +
                    '<span class="n"></span><div class="wear" style="display:none"><div></div></div>';
      (function (idx) {
        s.addEventListener('click', function (ev) { ev.stopPropagation(); hooks.onSelectSlot && hooks.onSelectSlot(idx); });
      })(i);
      hotbar.appendChild(s);
      hotbarSlots.push(s);
    }

    var etiquette1 = el('div', 'etiquette', 'Joueur 1');
    etiquette1.style.display = 'none';
    hud.appendChild(etiquette1);

    var heldName = el('div', 'held-name');
    hud.appendChild(heldName);

    var debug = el('div', 'debug');
    hud.appendChild(debug);

    var toastBox = el('div', 'toasts');
    hud.appendChild(toastBox);

    var damageFlash = el('div', 'damage-flash');
    // givre sur les bords de l'écran quand on gèle, halo brûlant quand on cuit
    var voileClimat = el('div', 'voile-climat');
    root.appendChild(damageFlash);
    root.appendChild(voileClimat);

    // ─── chat ───────────────────────────────────────────────────────────────
    var chatBox = el('div', 'chat');
    var chatLog = el('div', 'chat-log');
    var chatInput = el('div', 'chat-input');
    chatInput.innerHTML = '<span class="prompt">&gt;</span><span class="txt"></span><span class="caret">_</span>';
    chatBox.appendChild(chatLog); chatBox.appendChild(chatInput);
    hud.appendChild(chatBox);

    /* L'historique n'est reconstruit que si son contenu a change : sans ce
       garde-fou, on refait 60 noeuds DOM a chaque image. */
    var dernierChatId = -1, dernierSaisie = null, dernierEnSaisie = null;

    function updateChat(chat) {
      if (!chat) { chatBox.style.display = 'none'; return; }
      var msgs = chat.messages;
      var dernier = msgs.length ? msgs[msgs.length - 1].id : 0;
      var visible = chat.enSaisie || (msgs.length > 0 && chat.nonLus > 0);

      if (dernier !== dernierChatId) {
        dernierChatId = dernier;
        chatLog.innerHTML = chat.recents(8).map(function (m) {
          var corps = C_Chat.echapper(m.texte);
          return m.type === 'systeme'
            ? '<div class="ln sys">' + corps + '</div>'
            : '<div class="ln"><b>' + C_Chat.echapper(m.auteur || '?') + '</b> ' + corps + '</div>';
        }).join('');
        chatLog.scrollTop = chatLog.scrollHeight;
      }
      if (chat.enSaisie !== dernierEnSaisie) {
        dernierEnSaisie = chat.enSaisie;
        chatInput.style.display = chat.enSaisie ? 'flex' : 'none';
        chatBox.classList.toggle('actif', chat.enSaisie);
      }
      if (chat.saisie !== dernierSaisie) {
        dernierSaisie = chat.saisie;
        chatInput.querySelector('.txt').textContent = chat.saisie;
      }
      chatBox.style.display = (visible || chat.enSaisie) ? 'flex' : 'none';
      chatLog.style.opacity = chat.enSaisie ? 1 : 0.82;
    }

    function toast(msg, kind) {
      var t = el('div', 'toast' + (kind ? ' ' + kind : ''), msg);
      toastBox.appendChild(t);
      setTimeout(function () { t.classList.add('out'); }, 2200);
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2700);
    }

    function pips(bar, value, max, cls) {
      // on ne reconstruit le DOM que si le nombre de pastilles change
      if (bar.childElementCount !== max) {
        bar.innerHTML = '';
        for (var i = 0; i < max; i++) bar.appendChild(el('span', 'pip ' + cls));
      }
      for (var j = 0; j < max; j++) {
        var full = value >= (j + 1) * (max === 10 ? 2 : 1);
        var half = !full && value > j * (max === 10 ? 2 : 1);
        bar.children[j].className = 'pip ' + cls + (full ? ' full' : half ? ' half' : '');
      }
    }

    /* Rafraichit le HUD d'UN joueur. `index` choisit le calque ; les elements
       sont retrouves par requete dans ce calque, ce qui evite de dupliquer
       toute la construction pour les joueurs 2 a 4. */
    function updateHUDJoueur(g, joueur, index) {
      var racine = hudDe(index);
      var p = joueur.state;
      var healthBar = racine.querySelector('.bar.health');
      var hungerBar = racine.querySelector('.bar.hunger');
      var airBar = racine.querySelector('.bar.air');
      var miningRing = racine.querySelector('.mining-ring');
      var miningFill = racine.querySelector('.mining-fill');
      var heldName = racine.querySelector('.held-name');
      var barre = racine.querySelector('.hotbar');

      pips(healthBar, p.hp, 10, 'heart');
      pips(hungerBar, p.hunger, 10, 'food');
      if (p.air < MC.PlayerConst.MAX_AIR - 0.01) {
        airBar.style.display = '';
        pips(airBar, Math.ceil(p.air), MC.PlayerConst.MAX_AIR, 'bubble');
      } else airBar.style.display = 'none';

      construireHotbar(barre, index);
      for (var i = 0; i < Inv.HOTBAR_SIZE; i++) {
        var slot = barre.children[i], stack = p.inv.slots[i];
        slot.classList.toggle('on', i === p.selected);
        majCase(slot, stack);
      }

      var h = p.inv.slots[p.selected];
      heldName.textContent = h ? C.nameOf(h.id) : '';
      heldName.style.opacity = h ? 1 : 0;

      if (p.mining && isFinite(p.mining.total) && p.mining.total > 0) {
        miningRing.style.display = 'block';
        miningFill.style.width = Math.min(100, (p.mining.t / p.mining.total) * 100) + '%';
      } else miningRing.style.display = 'none';
      racine.classList.toggle('mort', !!p.dead);
    }

    /* Construit les cases de la barre d'action si elles manquent. */
    function construireHotbar(barre, index) {
      if (barre.childElementCount === Inv.HOTBAR_SIZE) return;
      barre.innerHTML = '';
      for (var i = 0; i < Inv.HOTBAR_SIZE; i++) {
        var sl = el('div', 'slot hb');
        sl.innerHTML = '<span class="k">' + (i + 1) + '</span><div class="ico"></div>' +
                       '<span class="n"></span><div class="wear" style="display:none"><div></div></div>';
        (function (idx2) {
          sl.addEventListener('click', function (ev) {
            ev.stopPropagation();
            if (index === 0 && hooks.onSelectSlot) hooks.onSelectSlot(idx2);
          });
        })(i);
        barre.appendChild(sl);
      }
    }

    function majCase(slot, stack) {
      var ico = slot.querySelector('.ico'), num = slot.querySelector('.n');
      var wear = slot.querySelector('.wear');
      if (stack) {
        ico.setAttribute('style', iconStyle(stack.id, ICON));
        num.textContent = stack.n > 1 ? stack.n : '';
        var max = C.durabilityOf(stack.id);
        if (max && stack.dmg) {
          var reste = 1 - stack.dmg / max;
          wear.style.display = '';
          wear.firstChild.style.width = Math.max(0, reste * 100) + '%';
          wear.firstChild.style.background =
            reste > 0.5 ? '#7ee08a' : reste > 0.22 ? '#e0c33f' : '#e0453f';
        } else wear.style.display = 'none';
      } else {
        ico.setAttribute('style', ''); num.textContent = ''; wear.style.display = 'none';
      }
    }

    /* Ce qui reste GLOBAL a la fenetre : debogage, chat, voile de degats.
       Tout ce qui est propre a un joueur (vie, faim, barre d'action, viseur)
       passe par updateHUDJoueur — sinon les deux s'ecrasent mutuellement. */
    function updateHUD(g) {
      appliquerHud();
      var p = g.player.state;
      damageFlash.style.opacity = Math.max(0, p.hurtFlash) * 0.9;
      var tp = typeof p.temperature === 'number' ? p.temperature : null;
      voileClimat.className = 'voile-climat' + (tp !== null && tp <= -10 ? ' gel' : tp !== null && tp >= 38 ? ' fournaise' : '');
      updateChat(g.chat);

      // graine, versions de génération de carte et du jeu, orientation du regard (SPEC-HUD-002)
      var o = Hud.orientation(p.yaw, p.pitch);
      var graine = g.graine !== undefined && g.graine !== null ? g.graine : g.world.seed;
      debug.innerHTML =
        'FPS <b>' + g.fps + '</b> · chunks <b>' + g.world.chunks.size + '</b>' +
        ' · entités <b>' + g.entities.list.length + '</b>' +
        (g.nbLocaux > 1 ? ' · joueurs <b>' + g.nbLocaux + '</b>' : '') + '<br>' +
        'Graine <b>' + graine + '</b> · carte v<b>' + (g.versionCarte === undefined ? 'inconnue' : g.versionCarte) +
        '</b> · jeu v<b>' + C.VERSION_JEU + '</b><br>' +
        'XYZ <b>' + p.pos.x.toFixed(1) + ' / ' + p.pos.y.toFixed(1) + ' / ' + p.pos.z.toFixed(1) + '</b>' +
        ' · cap <b>' + o.cap + '°</b> ' + o.cardinal + ' · inclinaison <b>' + o.inclinaison + '°</b><br>' +
        DC.clockString(g.time) + ' <b>' + (DC.isNight(g.time) ? 'nuit' : 'jour') + '</b>' +
        ' · ' + (p.flying ? 'vol' : p.swimming ? 'nage' : p.onGround ? "au sol" : "en l" + String.fromCharCode(39) + "air") +
        (g.regles && g.regles.mode ? ' · ' + g.regles.mode.nom : '') +
        // à bord : l'engin, sa vitesse, et comment en descendre
        (p.monture && MC.Vehicules ? '<br>' + MC.Vehicules.DEFS[p.monture.vehicule].nom + ' <b>' +
          MC.Vehicules.vitesseKmh(p.monture) + ' km/h</b> · F pour descendre' : '') +
        (g.world.biomeAt ? '<br>Biome <b>' + g.world.biomeAt(Math.floor(p.pos.x), Math.floor(p.pos.z)).nom + '</b>' : '') +
        (g.meteo ? '<br>' + texteMeteo(g, p) : '');
    }
    /* « Orage · 12 °C (froid) · vent 43 km/h · pluie » */
    var RESSENTIS = { glacial: 'glacial', froid: 'froid', doux: 'doux', chaud: 'chaud', brulant: 'brûlant' };
    function texteMeteo(g, p) {
      var m = g.meteo, t = typeof p.temperature === 'number' ? p.temperature : null;
      var r = t !== null && MC.Meteo ? RESSENTIS[MC.Meteo.ressenti(t)] : '';
      var prec = g.precipitation && g.precipitation.forme;
      return 'Météo <b>' + m.nom + '</b>' +
        (t !== null ? ' · <b>' + Math.round(t) + ' °C</b> (' + r + ')' : '') +
        ' · vent ' + Math.round(m.vent.force * 60) + ' km/h' +
        (prec ? ' · ' + (prec === 'neige' ? 'neige' : 'pluie') : '');
    }

    // ══════════════════════════════════════════════════════════════════════
    // Écrans modaux
    // ══════════════════════════════════════════════════════════════════════
    var overlay = el('div', 'overlay');
    root.appendChild(overlay);

    function showScreen(html) {
      overlay.innerHTML = html;
      overlay.style.display = 'flex';
      return overlay;
    }
    function hideScreen() { overlay.style.display = 'none'; overlay.innerHTML = ''; }

    /* L'aide des commandes suit les touches en vigueur (SPEC-OPTION-003). */
    var touchesAide = MC.Options ? MC.Options.defauts().touches : null;
    function majTouches(t) { touchesAide = t; }
    function commandes() {
      var lignes = (MC.Options ? MC.Options.aide(touchesAide) : []).map(function (l) {
        return '<tr><td>' + ech(l.touches) + '</td><td>' + ech(l.nom) + '</td></tr>';
      }).join('');
      return '<table class="keys">' + lignes +
        '<tr><td>souris</td><td>regarder</td></tr>' +
        '<tr><td>clic gauche</td><td>miner (maintenir) · frapper</td></tr>' +
        '<tr><td>clic droit</td><td>poser · utiliser · interagir</td></tr>' +
        '<tr><td>clic droit sur un véhicule</td><td>monter · Maj + clic : soute du camion</td></tr>' +
        '<tr><td>1 – 9 / molette</td><td>choisir un objet</td></tr>' +
        '<tr><td>échap</td><td>pause</td></tr>' +
        '</table>';
    }

    /* ── Options (SPEC-OPTION-001, 003) : chaque réglage s'applique aussitôt ;
       une touche se remappe en cliquant son bouton puis en pressant la
       nouvelle touche ; un conflit est signalé et rien ne change. */
    function ecranOptions(retour) {
      var o = hooks.options ? hooks.options() : null;
      if (!o) return;
      var R = MC.Options.REGLAGES;
      var reglages = Object.keys(R).map(function (k) {
        var r = R[k];
        if (typeof r.defaut === 'boolean') {
          return '<label class="opt-ligne"><input type="checkbox" data-opt="' + k + '"' + (o[k] ? ' checked' : '') + '> ' + ech(r.nom) + '</label>';
        }
        return '<label class="opt-ligne">' + ech(r.nom) + ' <input type="range" data-opt="' + k + '" min="' + r.min +
               '" max="' + r.max + '" step="' + r.pas + '" value="' + o[k] + '"> <span class="opt-val" data-val="' + k + '">' +
               o[k] + '</span></label>';
      }).join('');
      var touches = MC.Options.aide(o.touches).map(function (l) {
        return '<div class="opt-touche"><span>' + ech(l.nom) + '</span><button class="lier" data-action="' + l.action + '">' +
               ech(l.touches) + '</button></div>';
      }).join('');
      showScreen(
        '<div class="panel large options">' +
        '<h1>Options</h1>' +
        '<div class="opt-liste">' + reglages + '</div>' +
        '<h2>Touches</h2><div class="opt-touches">' + touches + '</div>' +
        '<p class="hint" id="opt-msg"></p>' +
        '<div class="row"><button id="btn-opt-defaut">Valeurs par défaut</button>' +
        '<button id="btn-retour" class="primary">Retour</button></div></div>');
      var msg = overlay.querySelector('#opt-msg');
      Array.prototype.forEach.call(overlay.querySelectorAll('[data-opt]'), function (inp) {
        inp.addEventListener(inp.type === 'checkbox' ? 'change' : 'input', function () {
          var k = inp.getAttribute('data-opt');
          var v = hooks.onOption(k, inp.type === 'checkbox' ? inp.checked : parseFloat(inp.value));
          var s = overlay.querySelector('[data-val="' + k + '"]');
          if (s) s.textContent = v;
        });
      });
      Array.prototype.forEach.call(overlay.querySelectorAll('.lier'), function (b) {
        b.onclick = function () {
          var action = b.getAttribute('data-action');
          b.textContent = '…';
          msg.textContent = 'Pressez la nouvelle touche (Échap annule)';
          function capter(e) {
            e.preventDefault(); e.stopPropagation();
            document.removeEventListener('keydown', capter, true);
            if (e.code === 'Escape') { ecranOptions(retour); return; }
            var conflit = hooks.onLier(action, e.code);
            ecranOptions(retour);
            var m = overlay.querySelector('#opt-msg');
            if (conflit) m.textContent = 'Conflit : ' + MC.Options.nomTouche(e.code) + ' sert déjà à « ' + conflit + ' »';
            else m.textContent = 'Touche enregistrée.';
            if (conflit) m.classList.add('conflit');
          }
          document.addEventListener('keydown', capter, true);
        };
      });
      overlay.querySelector('#btn-opt-defaut').onclick = function () { hooks.onOptionsDefaut && hooks.onOptionsDefaut(); ecranOptions(retour); };
      overlay.querySelector('#btn-retour').onclick = function () { (retour || function () { hooks.onRetourMenu && hooks.onRetourMenu(); })(); };
    }

    /* ── Menus ──────────────────────────────────────────────────────────────
       Tous les ecrans passent par showScreen : un seul calque, un seul
       endroit ou brancher les evenements. */

    function ech(t) { return C_Chat.echapper(t); }

    function lignePartie(m) {
      var mode = MC.Modes.mode(m.mode).nom;
      var diff = MC.Modes.difficulte(m.difficulte).nom;
      var date = new Date(m.majLe || m.creeLe || Date.now());
      var quand = date.toLocaleDateString() + ' ' +
                  String(date.getHours()).padStart(2, '0') + ':' +
                  String(date.getMinutes()).padStart(2, '0');
      return '<div class="partie" data-id="' + m.id + '">' +
        '<div class="pinfo">' +
          '<div class="pnom">' + ech(m.nom) + '</div>' +
          '<div class="pmeta">' + mode + ' · ' + diff +
            ' · graine <code>' + m.graine + '</code> · ' + quand + '</div>' +
        '</div>' +
        '<div class="pact">' +
          '<button class="charger primary" data-id="' + m.id + '">Charger</button>' +
          '<button class="suppr" data-id="' + m.id + '" title="Supprimer">✕</button>' +
        '</div></div>';
    }

    function menuParties(parties) {
      var liste = parties.length
        ? parties.map(lignePartie).join('')
        : '<p class="vide">Aucune partie enregistrée.</p>';
      showScreen(
        '<div class="panel large">' +
        '<h1>MiniCraft</h1>' +
        '<p class="sub">vos parties</p>' +
        '<div class="parties">' + liste + '</div>' +
        '<div class="row">' +
        '<button id="btn-nouvelle" class="primary">Nouvelle partie</button>' +
        '<button id="btn-multi">Multijoueur</button>' +
        '<button id="btn-aide">Commandes</button>' +
        '<button id="btn-options">Options</button>' +
        '</div>' +
        '<p class="hint" id="lock-hint"></p></div>');
      overlay.querySelector('#btn-options').onclick = function () { ecranOptions(); };

      overlay.querySelector('#btn-nouvelle').onclick = function () { hooks.onNouvelle && hooks.onNouvelle(); };
      overlay.querySelector('#btn-multi').onclick = function () { hooks.onMulti && hooks.onMulti(); };
      overlay.querySelector('#btn-aide').onclick = function () { ecranAide(); };
      Array.prototype.forEach.call(overlay.querySelectorAll('.charger'), function (b) {
        b.onclick = function () { hooks.onCharger && hooks.onCharger(b.getAttribute('data-id')); };
      });
      /* Suppression en deux temps : un clic arme, le second confirme. Une
         partie effacee par megarde est irrecuperable. */
      Array.prototype.forEach.call(overlay.querySelectorAll('.suppr'), function (b) {
        b.onclick = function () {
          if (b.dataset.arme === '1') {
            hooks.onSupprimer && hooks.onSupprimer(b.getAttribute('data-id'));
            return;
          }
          b.dataset.arme = '1';
          b.textContent = 'Confirmer ?';
          b.classList.add('danger');
          setTimeout(function () {
            if (!b.parentNode) return;
            b.dataset.arme = ''; b.textContent = '✕'; b.classList.remove('danger');
          }, 3500);
        };
      });
    }

    function boutonsRadio(nom, options, courant) {
      return '<div class="choix" data-nom="' + nom + '">' + options.map(function (o) {
        return '<button class="opt' + (o.id === courant ? ' on' : '') + '" data-val="' + o.id + '"' +
               (o.titre ? ' title="' + ech(o.titre) + '"' : '') + '>' + ech(o.nom) + '</button>';
      }).join('') + '</div>';
    }

    function brancherChoix(racine) {
      Array.prototype.forEach.call(racine.querySelectorAll('.choix'), function (grp) {
        Array.prototype.forEach.call(grp.querySelectorAll('.opt'), function (b) {
          b.onclick = function () {
            Array.prototype.forEach.call(grp.querySelectorAll('.opt'), function (x) {
              x.classList.remove('on');
            });
            b.classList.add('on');
          };
        });
      });
    }
    function valeurChoix(nom) {
      var grp = overlay.querySelector('.choix[data-nom="' + nom + '"] .opt.on');
      return grp ? grp.getAttribute('data-val') : null;
    }

    function menuNouvelle() {
      var modes = Object.keys(MC.Modes.MODES).map(function (k) {
        var m = MC.Modes.MODES[k];
        return { id: m.id, nom: m.nom, titre: m.description };
      });
      var diffs = MC.Modes.ORDRE_DIFFICULTES.map(function (k) {
        var d = MC.Modes.DIFFICULTES[k];
        return { id: d.id, nom: d.nom, titre: d.description };
      });
      showScreen(
        '<div class="panel large">' +
        '<h1>Nouvelle partie</h1>' +
        '<div class="form">' +
        '<label>Nom<input id="f-nom" type="text" maxlength="40" value="Ma partie"></label>' +
        '<label>Mode' + boutonsRadio('mode', modes, 'survie') + '</label>' +
        '<label>Difficulté' + boutonsRadio('diff', diffs, 'facile') + '</label>' +
        '<label>Graine <span class="aide">vide = au hasard · le même mot donne la même carte</span>' +
        '<input id="f-graine" type="text" maxlength="40" placeholder="ex. vallée perdue"></label>' +
        '<label>Joueurs locaux' +
        boutonsRadio('joueurs', [{ id: '1', nom: '1' }, { id: '2', nom: '2' },
                                 { id: '3', nom: '3' }, { id: '4', nom: '4' }], '1') +
        '<span class="aide">joueur 1 au clavier, les suivants à la manette</span></label>' +
        formHistoire() +
        '</div>' +
        '<div class="row">' +
        '<button id="btn-creer" class="primary">Créer et jouer</button>' +
        '<button id="btn-retour">Retour</button>' +
        '</div><p class="hint" id="lock-hint"></p></div>');
      brancherChoix(overlay);
      brancherHistoire();
      overlay.querySelector('#btn-retour').onclick = function () { hooks.onRetourMenu && hooks.onRetourMenu(); };
      overlay.querySelector('#btn-creer').onclick = function () {
        var mode = valeurChoix('mode') || 'survie';
        hooks.onCreer && hooks.onCreer({
          nom: overlay.querySelector('#f-nom').value || 'Ma partie',
          mode: mode,
          difficulte: valeurChoix('diff') || 'facile',
          graineTexte: overlay.querySelector('#f-graine').value,
          joueurs: mode === 'histoire' ? 1 : parseInt(valeurChoix('joueurs') || '1', 10),
          histoire: mode === 'histoire' ? lireHistoire() : null,
        });
      };
    }

    /* ── Mode histoire : paramètres ajustables à la création ──────────────── */
    function formHistoire() {
      var H = MC.Histoire, M = MC.Modes, R = MC.Recits;
      if (!H) return '';
      var archetypes = R ? Object.keys(R.ARCHETYPES).map(function (k) {
        return { id: k, nom: R.ARCHETYPES[k].nom, titre: R.ARCHETYPES[k].description };
      }) : [];
      var longueurs = Object.keys(H.LONGUEURS).map(function (k) { return { id: k, nom: H.LONGUEURS[k].nom }; });
      var presets = Object.keys(M.PRESETS_INTERACTIONS).map(function (k) {
        return { id: k, nom: M.PRESETS_INTERACTIONS[k].nom, titre: M.PRESETS_INTERACTIONS[k].description };
      });
      var cb = M.categoriesBlocs(), co = M.CATEGORIES_OBJETS;
      function cases(cls, table) {
        return Object.keys(table).map(function (k) {
          return '<label class="case"><input type="checkbox" class="' + cls + '" value="' + k + '"> ' + ech(table[k].nom) + '</label>';
        }).join('');
      }
      return '<fieldset id="f-histoire" class="histoire-params" style="display:none">' +
        '<legend>Mode histoire</legend>' +
        (archetypes.length ? '<label>Archétype' + boutonsRadio('archetype', archetypes, 'epopee') + '</label>' : '') +
        '<label>Héros<input id="f-heros" type="text" maxlength="20" value="Aube"></label>' +
        '<label>Longueur de la quête principale' + boutonsRadio('longueur', longueurs, 'normale') + '</label>' +
        '<label>Quêtes secondaires <input id="f-secondaires" type="number" min="0" max="8" value="5"></label>' +
        '<label>Interactions avec le monde' + boutonsRadio('interactions', presets, 'moderee') + '</label>' +
        '<div class="cases"><b>Blocs</b>' + cases('cat-bloc', cb) + '</div>' +
        '<div class="cases"><b>Objets</b>' + cases('cat-objet', co) + '</div>' +
        '<label class="case"><input type="checkbox" id="f-evenements" checked> Événements (nuit de sang, pillards, caravanes…)</label>' +
        '<label class="case"><input type="checkbox" id="f-commerce" checked> Commerce avec les habitants</label>' +
        '<label class="case"><input type="checkbox" id="f-reperes" checked> Repère automatique sur l\'objectif</label>' +
        '</fieldset>';
    }
    function cocherPreset(id) {
      var p = MC.Modes.PRESETS_INTERACTIONS[id];
      if (!p) return;
      Array.prototype.forEach.call(overlay.querySelectorAll('.cat-bloc'), function (c) { c.checked = p.blocs.indexOf(c.value) >= 0; });
      Array.prototype.forEach.call(overlay.querySelectorAll('.cat-objet'), function (c) { c.checked = p.objets.indexOf(c.value) >= 0; });
    }
    function brancherHistoire() {
      var fs2 = overlay.querySelector('#f-histoire');
      if (!fs2) return;
      function maj() { fs2.style.display = valeurChoix('mode') === 'histoire' ? '' : 'none'; }
      Array.prototype.forEach.call(overlay.querySelectorAll('.choix[data-nom="mode"] .opt'), function (b) {
        var avant = b.onclick;
        b.onclick = function () { avant && avant(); maj(); };
      });
      Array.prototype.forEach.call(overlay.querySelectorAll('.choix[data-nom="interactions"] .opt'), function (b) {
        var avant = b.onclick;
        b.onclick = function () { avant && avant(); cocherPreset(b.getAttribute('data-val')); };
      });
      Array.prototype.forEach.call(overlay.querySelectorAll('.choix[data-nom="longueur"] .opt'), function (b) {
        var avant = b.onclick;
        b.onclick = function () {
          avant && avant();
          overlay.querySelector('#f-secondaires').value = MC.Histoire.LONGUEURS[b.getAttribute('data-val')].secondaires;
        };
      });
      cocherPreset('moderee');
      maj();
    }
    function lireHistoire() {
      function coches(cls) {
        return Array.prototype.filter.call(overlay.querySelectorAll('.' + cls), function (c) { return c.checked; })
          .map(function (c) { return c.value; });
      }
      return {
        archetype: valeurChoix('archetype') || 'epopee',
        heros: overlay.querySelector('#f-heros').value || 'Aube',
        longueur: valeurChoix('longueur') || 'normale',
        secondaires: parseInt(overlay.querySelector('#f-secondaires').value, 10) || 0,
        evenements: overlay.querySelector('#f-evenements').checked,
        commerce: overlay.querySelector('#f-commerce').checked,
        reperes: overlay.querySelector('#f-reperes').checked,
        interactions: { preset: valeurChoix('interactions') || 'moderee', blocs: coches('cat-bloc'), objets: coches('cat-objet') },
      };
    }

    function menuMulti(defaut) {
      defaut = defaut || {};
      showScreen(
        '<div class="panel large">' +
        '<h1>Multijoueur</h1>' +
        '<p class="sub">rejoindre un serveur MiniCraft</p>' +
        '<div class="form">' +
        '<label>Adresse <span class="aide">vide = ce serveur</span>' +
        '<input id="f-hote" type="text" placeholder="ws://192.168.1.20:8080" value="' +
        ech(defaut.hote || '') + '"></label>' +
        '<label>Pseudo<input id="f-pseudo" type="text" maxlength="24" value="' +
        ech(defaut.pseudo || 'Joueur') + '"></label>' +
        '<label>E-mail <span class="aide">exigé par certains serveurs</span>' +
        '<input id="f-email" type="email" maxlength="120" value="' + ech(defaut.email || '') + '"></label>' +
        '<label>Jeton d\'invitation <span class="aide">facultatif</span>' +
        '<input id="f-invitation" type="text" maxlength="80" value="' + ech(defaut.invitation || '') + '"></label>' +
        '<label>Joueurs locaux' +
        boutonsRadio('joueurs', [{ id: '1', nom: '1' }, { id: '2', nom: '2' },
                                 { id: '3', nom: '3' }, { id: '4', nom: '4' }], '1') + '</label>' +
        '</div>' +
        '<div class="row">' +
        '<button id="btn-join" class="primary">Rejoindre</button>' +
        '<button id="btn-retour">Retour</button>' +
        '</div>' +
        '<p class="hint">Pour héberger : <code>node server.js 8080</code> puis communiquez ' +
        'votre adresse aux autres joueurs.</p>' +
        '<p class="hint" id="lock-hint"></p></div>');
      brancherChoix(overlay);
      overlay.querySelector('#btn-retour').onclick = function () { hooks.onRetourMenu && hooks.onRetourMenu(); };
      overlay.querySelector('#btn-join').onclick = function () {
        hooks.onRejoindre && hooks.onRejoindre({
          hote: overlay.querySelector('#f-hote').value.trim(),
          pseudo: overlay.querySelector('#f-pseudo').value.trim() || 'Joueur',
          email: overlay.querySelector('#f-email').value.trim() || null,
          invitation: overlay.querySelector('#f-invitation').value.trim() || null,
          joueurs: parseInt(valeurChoix('joueurs') || '1', 10),
        });
      };
    }

    function ecranAide() {
      showScreen('<div class="panel large"><h1>Commandes</h1>' + commandes() +
        '<p class="hint">Dans le chat : /aide donne la liste des commandes.</p>' +
        '<div class="row"><button id="btn-retour" class="primary">Retour</button></div></div>');
      overlay.querySelector('#btn-retour').onclick = function () { hooks.onRetourMenu && hooks.onRetourMenu(); };
    }

    function menuPrincipal(hasSave) {
      showScreen(
        '<div class="panel">' +
        '<h1>MiniCraft</h1>' +
        '<p class="sub">prototype voxel — miner, construire, cultiver, survivre</p>' +
        commandes() +
        '<div class="row">' +
        '<button id="btn-play" class="primary">' + (hasSave ? 'Reprendre la partie' : 'Nouvelle partie') + '</button>' +
        (hasSave ? '<button id="btn-new">Nouvelle partie</button>' : '') +
        '</div>' +
        '<p class="hint" id="lock-hint"></p>' +
        '</div>');
      overlay.querySelector('#btn-play').onclick = function () { hooks.onPlay && hooks.onPlay(false); };
      var bn = overlay.querySelector('#btn-new');
      if (bn) bn.onclick = function () { hooks.onPlay && hooks.onPlay(true); };
    }

    var dernieresInfosPause = {};
    function menuPause(infos) {
      infos = infos || dernieresInfosPause;
      dernieresInfosPause = infos;
      showScreen(
        '<div class="panel">' +
        '<h1>Pause</h1>' +
        '<p class="sub">' +
        (infos.nom ? ech(infos.nom) + ' — ' : '') +
        (infos.mode || '') + (infos.difficulte ? ' · ' + infos.difficulte : '') +
        (infos.graine !== undefined ? ' · graine <code>' + infos.graine + '</code>' : '') +
        (infos.enLigne ? ' · <b>en ligne</b>' : '') + '</p>' +
        commandes() +
        '<div class="row">' +
        '<button id="btn-resume" class="primary">Reprendre</button>' +
        '<button id="btn-save">Sauvegarder</button>' +
        '<button id="btn-affichage">Affichage</button>' +
        '<button id="btn-options">Options</button>' +
        '<button id="btn-succes">Succès</button>' +
        '<button id="btn-quit">Menu principal</button>' +
        '</div>' +
        '<p class="hint" id="lock-hint"></p>' +
        '</div>');
      overlay.querySelector('#btn-resume').onclick = function () { hooks.onResume && hooks.onResume(); };
      overlay.querySelector('#btn-save').onclick = function () { hooks.onSave && hooks.onSave(); };
      overlay.querySelector('#btn-affichage').onclick = function () { ecranAffichage(); };
      overlay.querySelector('#btn-options').onclick = function () { ecranOptions(function () { menuPause(); }); };
      overlay.querySelector('#btn-succes').onclick = function () { hooks.onSucces && hooks.onSucces(); };
      overlay.querySelector('#btn-quit').onclick = function () { hooks.onQuit && hooks.onQuit(); };
    }

    /* Panneau « Affichage » : une case par composant du HUD (SPEC-HUD-001,
       003 à 012), accessible depuis la pause. Sans registre (aucun stockage
       injecté), on affiche un simple avertissement plutôt qu'un panneau vide. */
    function ecranAffichage() {
      if (!registre) {
        showScreen(
          '<div class="panel"><h1>Affichage</h1><p class="sub">Indisponible</p>' +
          '<div class="row"><button id="btn-retour" class="primary">Retour</button></div></div>');
        overlay.querySelector('#btn-retour').onclick = function () { menuPause(); };
        return;
      }
      var lignes = Hud.COMPOSANTS.map(function (c) {
        var coche = registre.visible(c.id) ? ' checked' : '';
        return '<label class="aff-ligne"><input type="checkbox" data-id="' + c.id + '"' + coche + '> ' +
               ech(c.nom) + '</label>';
      }).join('');
      showScreen(
        '<div class="panel">' +
        '<h1>Affichage</h1>' +
        '<div class="aff-liste">' + lignes + '</div>' +
        '<div class="row">' +
        '<button id="btn-aff-tout">Tout afficher</button>' +
        '<button id="btn-aff-rien">Tout masquer</button>' +
        '</div>' +
        '<div class="row"><button id="btn-retour" class="primary">Retour</button></div>' +
        '</div>');
      var cases = overlay.querySelectorAll('input[type=checkbox]');
      for (var i = 0; i < cases.length; i++) {
        (function (cb) {
          cb.addEventListener('change', function () {
            registre.regler(cb.getAttribute('data-id'), cb.checked);
            appliquerHud();
          });
        })(cases[i]);
      }
      overlay.querySelector('#btn-aff-tout').onclick = function () { registre.toutAfficher(); appliquerHud(); ecranAffichage(); };
      overlay.querySelector('#btn-aff-rien').onclick = function () { registre.toutMasquer(); appliquerHud(); ecranAffichage(); };
      overlay.querySelector('#btn-retour').onclick = function () { menuPause(); };
    }

    function ecranMort() {
      showScreen(
        '<div class="panel dead">' +
        '<h1>Vous êtes mort</h1>' +
        '<p class="sub">l\'inventaire est conservé</p>' +
        '<div class="row"><button id="btn-respawn" class="primary">Réapparaître</button></div>' +
        '</div>');
      overlay.querySelector('#btn-respawn').onclick = function () { hooks.onRespawn && hooks.onRespawn(); };
    }

    function setLockHint(msg) {
      var h = overlay.querySelector('#lock-hint');
      if (h) h.textContent = msg || '';
    }

    // ══════════════════════════════════════════════════════════════════════
    // Inventaire / établi / fourneau
    // ══════════════════════════════════════════════════════════════════════
    var invScreen = el('div', 'inv-screen');
    root.appendChild(invScreen);
    var heldGhost = el('div', 'held-ghost');
    root.appendChild(heldGhost);

    var container = null;   // {kind:'inv'|'craft'|'furnace', grid:[], result, furnace, pos}
    var heldStack = null;

    /* Les règles de la partie : le livre change de nature selon le mode.
       En survie il explique ce qu'il faut rassembler ; en créatif il donne
       directement l'objet, ce qui n'aurait aucun sens en survie. */
    var regles = null;
    function setRegles(r) { regles = r; }
    function estCreatif() { return !!(regles && regles.blocsIllimites); }

    function slotEl(cls, stack, onLeft, onRight) {
      var s = el('div', 'slot ' + (cls || ''));
      var ico = el('div', 'ico');
      if (stack) ico.setAttribute('style', iconStyle(stack.id, ICON));
      s.appendChild(ico);
      var n = el('span', 'n', stack && stack.n > 1 ? String(stack.n) : '');
      s.appendChild(n);
      if (stack) {
        s.title = C.nameOf(stack.id) + (stack.n > 1 ? ' ×' + stack.n : '');
        // jauge d'usure : seuls les outils en ont une
        var max = C.durabilityOf(stack.id);
        if (max && stack.dmg) {
          var bar = el('div', 'wear');
          var reste = 1 - stack.dmg / max;
          bar.innerHTML = '<div style="width:' + Math.max(0, reste * 100) + '%;background:' +
            (reste > 0.5 ? '#7ee08a' : reste > 0.22 ? '#e0c33f' : '#e0453f') + '"></div>';
          s.appendChild(bar);
          s.title += ' — ' + (max - stack.dmg) + '/' + max;
        }
      }
      s.addEventListener('mousedown', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        if (ev.button === 0 && onLeft) onLeft();
        else if (ev.button === 2 && onRight) onRight();
        renderContainer();
      });
      s.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
      return s;
    }

    /* Modèle d'interaction « pile en main » : clic gauche prend/pose tout,
       clic droit prend la moitié / pose une unité. Plus fiable qu'un
       glisser-déposer, qui casse dès que la souris sort d'une case. */
    function clickSlot(get, set, button) {
      var cur = get();
      if (button === 'left') {
        if (!heldStack) { if (cur) { heldStack = cur; set(null); } return; }
        if (!cur) { set(heldStack); heldStack = null; return; }
        if (cur.id === heldStack.id) {
          var max = C.maxStack(cur.id);
          var move = Math.min(max - cur.n, heldStack.n);
          cur.n += move; heldStack.n -= move;
          if (heldStack.n <= 0) heldStack = null;
          set(cur);
        } else { set(heldStack); heldStack = cur; }   // échange
      } else {
        if (!heldStack) {
          if (!cur) return;
          var half = Math.ceil(cur.n / 2);
          heldStack = { id: cur.id, n: half };
          cur.n -= half;
          set(cur.n > 0 ? cur : null);
        } else {
          if (!cur) { set({ id: heldStack.id, n: 1 }); heldStack.n--; }
          else if (cur.id === heldStack.id && cur.n < C.maxStack(cur.id)) { cur.n++; heldStack.n--; set(cur); }
          if (heldStack && heldStack.n <= 0) heldStack = null;
        }
      }
    }

    /* La grille de fabrication fait 3x3 partout, inventaire compris : limiter
       l inventaire a 2x2 obligeait a poser un etabli pour fabriquer l etabli
       lui-meme des lors qu on avait perdu le premier, et rendait le coffre
       (recette 3x3) inatteignable en pratique. */
    function craftSize() { return 3; }

    function recomputeResult() {
      if (!container || !container.grid) { return; }
      var n = craftSize();
      var ids = container.grid.map(function (s) { return s ? s.id : 0; });
      container.result = Inv.matchRecipe(ids, n, n);
    }

    function takeResult(inv) {
      if (!container || !container.result) return;
      var r = container.result;
      // on ne peut prendre que si la main est libre ou compatible
      if (heldStack && (heldStack.id !== r.id || heldStack.n + r.n > C.maxStack(r.id))) return;
      for (var i = 0; i < container.grid.length; i++) {
        var s = container.grid[i];
        if (!s) continue;
        s.n--;
        if (s.n <= 0) container.grid[i] = null;
      }
      if (heldStack) heldStack.n += r.n;
      else heldStack = { id: r.id, n: r.n };
      if (hooks.onSound) hooks.onSound('craft');
      if (hooks.onFabrique) hooks.onFabrique(r.id);
      recomputeResult();
    }

    /* Repose le contenu de la grille dans l'inventaire avant d'y placer une
       recette : sans ça, choisir une recette écraserait ce qui s'y trouvait. */
    function viderGrille(inv) {
      for (var i = 0; i < container.grid.length; i++) {
        var s = container.grid[i];
        if (!s) continue;
        var reste = inv.add(s.id, s.n);
        container.grid[i] = reste ? { id: s.id, n: reste } : null;
        if (reste) return false;            // plus de place : on n'écrase rien
      }
      return true;
    }

    function poserRecette(entree, inv) {
      if (!viderGrille(inv)) { toast('Inventaire plein : videz la grille', 'warn'); return; }
      var g = Livre.remplirGrille(entree.recette, inv, craftSize());
      if (!g) { toast('Il manque des ingrédients', 'warn'); return; }
      container.grid = g;
      recomputeResult();
      if (hooks.onSound) hooks.onSound('clic');
      renderContainer();
    }

    /* Le livre. Un seul panneau, deux visages :
       — survie : les recettes, celles qu'on peut faire en tête et en évidence ;
       — créatif : le catalogue complet, un clic suffit à obtenir l'objet. */
    function panneauLivre(inv) {
      var creatif = estCreatif();
      var pan = el('div', 'livre');
      pan.appendChild(el('h3', null, creatif ? 'Livre des objets' : 'Livre des recettes'));

      var rech = el('input', 'livre-rech');
      rech.setAttribute('type', 'text');
      rech.setAttribute('placeholder', creatif ? 'Chercher un bloc, un objet…' : 'Chercher une recette, un ingrédient…');
      rech.value = container.livreFiltre || '';
      pan.appendChild(rech);

      var liste = el('div', 'livre-liste');
      pan.appendChild(liste);
      var info = el('p', 'hint', '');
      pan.appendChild(info);

      function ligneObjet(e) {
        var row = el('div', 'obj');
        row.appendChild(slotEl('mini', { id: e.id, n: 1 }));
        row.appendChild(el('span', 'rec-n', e.nom));
        row.addEventListener('mousedown', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          var don = Livre.donner(inv, e.id, null, regles);
          if (!don) { toast('Indisponible dans ce mode', 'warn'); return; }
          toast(e.nom + ' ×' + don.donne + (don.reste ? ' (inventaire plein)' : ''));
          if (hooks.onSound) hooks.onSound('clic');
          renderContainer();
        });
        return row;
      }

      function ligneRecette(e) {
        var row = el('div', 'rec' + (e.faisable ? ' ok' : ''));
        row.appendChild(slotEl('mini result', { id: e.sortie, n: e.n }));
        var d = el('div', 'rec-d');
        d.appendChild(el('span', 'rec-n', e.nom));
        var ing = el('div', 'rec-i');
        e.besoins.forEach(function (b) {
          var dispo = inv.count(b.id);
          var s = slotEl('mini' + (dispo >= b.n ? '' : ' ko'), { id: b.id, n: b.n });
          s.title = b.nom + ' ×' + b.n + ' — en poche : ' + dispo;
          ing.appendChild(s);
        });
        d.appendChild(ing);
        row.appendChild(d);
        if (e.faisable) {
          row.addEventListener('mousedown', function (ev) {
            ev.preventDefault(); ev.stopPropagation();
            poserRecette(e, inv);
          });
        }
        return row;
      }

      function majListe() {
        liste.innerHTML = '';
        if (creatif) {
          var cat = Livre.catalogueObjets(container.livreFiltre);
          [['Blocs', cat.blocs], ['Objets', cat.objets]].forEach(function (g) {
            if (!g[1].length) return;
            liste.appendChild(el('div', 'livre-cat', g[0]));
            g[1].forEach(function (e) { liste.appendChild(ligneObjet(e)); });
          });
          info.textContent = (cat.blocs.length + cat.objets.length)
            + ' entrées — un clic vous en donne une pile complète.';
          if (!cat.blocs.length && !cat.objets.length) info.textContent = 'Aucun résultat.';
        } else {
          var entrees = Livre.catalogue(inv, container.livreFiltre);
          entrees.forEach(function (e) { liste.appendChild(ligneRecette(e)); });
          var faisables = entrees.filter(function (e) { return e.faisable; }).length;
          info.textContent = entrees.length
            ? faisables + ' recette(s) réalisable(s) sur ' + entrees.length
              + ' — cliquez-en une pour la poser dans la grille.'
            : 'Aucun résultat.';
        }
      }

      rech.addEventListener('input', function () {
        container.livreFiltre = rech.value;
        majListe();                       // on ne redessine que la liste : le champ garde le focus
      });
      /* Le champ de recherche capte les touches : sans cela, taper « e » dans
         la recherche refermerait l'inventaire. Échap reste transmis pour
         pouvoir sortir sans souris. */
      rech.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Escape') ev.stopPropagation();
      });
      majListe();
      setTimeout(function () { try { rech.focus(); } catch (_) {} }, 0);
      return pan;
    }

    function toggleLivre() {
      if (!container || !container.grid) return false;
      container.livre = !container.livre;
      renderContainer();
      return container.livre;
    }

    function renderContainer() {
      if (!container) { invScreen.style.display = 'none'; heldGhost.style.display = 'none'; return; }
      var inv = container.inv;
      invScreen.style.display = 'flex';
      invScreen.innerHTML = '';

      var box = el('div', 'inv-box');
      var titre = container.kind === 'craft' ? 'Établi'
                : container.kind === 'furnace' ? 'Fourneau'
                : container.kind === 'trade' ? ((container.pnj && container.pnj.titre) || 'Villageois')
                : container.kind === 'chest' ? 'Coffre' : 'Inventaire';
      box.appendChild(el('h2', null, titre));

      // le livre n'a de sens que là où il y a une grille de fabrication
      if (container.grid) {
        var bar = el('div', 'inv-bar');
        var bl = el('button', 'btn-livre' + (container.livre ? ' on' : ''),
                    estCreatif() ? 'Livre des objets (L)' : 'Livre des recettes (L)');
        bl.addEventListener('mousedown', function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          toggleLivre();
        });
        bar.appendChild(bl);
        box.appendChild(bar);
      }

      // ── échanges : liste d'offres cliquables
      if (container.kind === 'trade') {
        var pnj = container.pnj;
        if (pnj && pnj.replique) box.appendChild(el('p', 'replique', '« ' + pnj.replique + ' »'));
        if (pnj && pnj.services && pnj.services.length) {
          var sv = el('div', 'services');
          pnj.services.forEach(function (s) {
            var bt = el('button', 'btn-service', s.libelle);
            bt.addEventListener('mousedown', function (ev) {
              ev.preventDefault(); ev.stopPropagation();
              var r = pnj.onService ? pnj.onService(s.id) : null;
              // la banque ouvre son propre écran : on ne redessine pas par-dessus
              if (r && r.ouvrir) return;
              if (r && r.message) pnj.replique = r.message;
              renderContainer();
            });
            sv.appendChild(bt);
          });
          box.appendChild(sv);
        }
        var liste = el('div', 'trades');
        ((pnj && pnj.offres) || Inv.TRADES).forEach(function (tr) {
          var possible = Inv.canTrade(inv, tr);
          var row = el('div', 'trade' + (possible ? '' : ' ko'));
          tr.give.forEach(function (gv) {
            row.appendChild(slotEl('mini', { id: gv.id, n: gv.n }));
          });
          row.appendChild(el('span', 'arrow', '→'));
          row.appendChild(slotEl('mini result', { id: tr.get.id, n: tr.get.n }));
          row.addEventListener('mousedown', function (ev) {
            ev.preventDefault(); ev.stopPropagation();
            if (!Inv.canTrade(inv, tr)) return;
            var reste = Inv.doTrade(inv, tr);
            if (reste === null) toast('Pas de place dans l\'inventaire', 'warn');
            else { toast('Échange conclu : ' + C.nameOf(tr.get.id)); if (hooks.onEchange) hooks.onEchange(); }
            renderContainer();
          });
          liste.appendChild(row);
        });
        box.appendChild(liste);
        box.appendChild(el('p', 'hint',
          'Cliquez une offre pour l\'échanger. Le blé et la laine s\'achètent contre des émeraudes.'));
        invScreen.appendChild(box);
        heldGhost.style.display = 'none';
        return;
      }

      // ── zone haute : coffre, craft ou fourneau
      var top = el('div', 'inv-top');
      if (container.kind === 'chest') {
        var cg = el('div', 'inv-grid');
        var ci = container.chest;
        for (var q = 0; q < ci.size; q++) {
          (function (si) {
            cg.appendChild(slotEl('', ci.slots[si],
              function () { clickSlot(function () { return ci.slots[si]; },
                                      function (v) { ci.setAt(si, v); }, 'left'); },
              function () { clickSlot(function () { return ci.slots[si]; },
                                      function (v) { ci.setAt(si, v); }, 'right'); }));
          })(q);
        }
        top.appendChild(cg);
        top.appendChild(el('p', 'hint',
          'Le contenu reste dans le coffre, et retombe au sol si vous le cassez.'));
      } else if (container.kind === 'furnace') {
        var f = container.furnace;
        var cols = el('div', 'furnace-cols');
        var colIn = el('div', 'fcol');
        colIn.appendChild(el('div', 'lbl', 'À cuire'));
        colIn.appendChild(slotEl('', f.input,
          function () { clickSlot(function () { return f.input; }, function (v) { f.input = v; }, 'left'); },
          function () { clickSlot(function () { return f.input; }, function (v) { f.input = v; }, 'right'); }));
        colIn.appendChild(el('div', 'lbl', 'Combustible'));
        colIn.appendChild(slotEl('', f.fuel,
          function () { clickSlot(function () { return f.fuel; }, function (v) { f.fuel = v; }, 'left'); },
          function () { clickSlot(function () { return f.fuel; }, function (v) { f.fuel = v; }, 'right'); }));
        cols.appendChild(colIn);

        var mid = el('div', 'fcol prog');
        var flame = el('div', 'flame');
        flame.style.opacity = f.burn > 0 ? 1 : 0.2;
        mid.appendChild(flame);
        var pb = el('div', 'progbar');
        pb.innerHTML = '<div style="width:' + Math.min(100, (f.cook / Inv.SMELT_TIME) * 100) + '%"></div>';
        mid.appendChild(pb);
        cols.appendChild(mid);

        var colOut = el('div', 'fcol');
        colOut.appendChild(el('div', 'lbl', 'Résultat'));
        colOut.appendChild(slotEl('result', f.output, function () {
          if (!f.output) return;
          if (!heldStack) { heldStack = f.output; f.output = null; }
          else if (heldStack.id === f.output.id
                   && heldStack.n + f.output.n <= C.maxStack(f.output.id)) {
            heldStack.n += f.output.n; f.output = null;
          }
        }));
        cols.appendChild(colOut);
        top.appendChild(cols);
        top.appendChild(el('p', 'hint',
          'Le charbon brûle le plus longtemps. Minerai de fer → lingot · mouton cru → cuit · sable → verre.'));
      } else {
        var n = craftSize();
        var wrap = el('div', 'craft-wrap');
        var grid = el('div', 'craft-grid');
        grid.style.gridTemplateColumns = 'repeat(' + n + ', 1fr)';
        for (var i = 0; i < n * n; i++) {
          (function (gi) {
            grid.appendChild(slotEl('', container.grid[gi],
              function () {
                clickSlot(function () { return container.grid[gi]; },
                          function (v) { container.grid[gi] = v; }, 'left');
                recomputeResult();
              },
              function () {
                clickSlot(function () { return container.grid[gi]; },
                          function (v) { container.grid[gi] = v; }, 'right');
                recomputeResult();
              }));
          })(i);
        }
        wrap.appendChild(grid);
        wrap.appendChild(el('div', 'arrow', '→'));
        var res = container.result ? { id: container.result.id, n: container.result.n } : null;
        wrap.appendChild(slotEl('result', res, function () { takeResult(inv); }));
        top.appendChild(wrap);
        if (container.kind !== 'craft')
          top.appendChild(el('p', 'hint',
            'Grille 3×3. Toutes les recettes du jeu sont réalisables ici.'));
      }
      box.appendChild(top);

      // ── inventaire principal + hotbar
      var main = el('div', 'inv-grid');
      for (var k = Inv.HOTBAR_SIZE; k < inv.size; k++) {
        (function (si) {
          main.appendChild(slotEl('', inv.slots[si],
            function () { clickSlot(function () { return inv.slots[si]; }, function (v) { inv.setAt(si, v); }, 'left'); },
            function () { clickSlot(function () { return inv.slots[si]; }, function (v) { inv.setAt(si, v); }, 'right'); }));
        })(k);
      }
      box.appendChild(main);

      var hb = el('div', 'inv-grid hb-row');
      for (var j = 0; j < Inv.HOTBAR_SIZE; j++) {
        (function (si) {
          hb.appendChild(slotEl('', inv.slots[si],
            function () { clickSlot(function () { return inv.slots[si]; }, function (v) { inv.setAt(si, v); }, 'left'); },
            function () { clickSlot(function () { return inv.slots[si]; }, function (v) { inv.setAt(si, v); }, 'right'); }));
        })(j);
      }
      box.appendChild(hb);
      box.appendChild(el('p', 'hint',
        'Clic gauche : prendre / poser la pile · clic droit : moitié / une unité · E ou Échap : fermer'));
      invScreen.appendChild(box);
      if (container.livre && container.grid) invScreen.appendChild(panneauLivre(inv));

      // pile portée par le curseur
      if (heldStack) {
        heldGhost.style.display = 'block';
        heldGhost.innerHTML = '<div class="ico" style="' + iconStyle(heldStack.id, ICON) + '"></div>' +
          (heldStack.n > 1 ? '<span class="n">' + heldStack.n + '</span>' : '');
      } else heldGhost.style.display = 'none';
    }

    invScreen.addEventListener('mousemove', function (e) {
      heldGhost.style.left = e.clientX + 'px';
      heldGhost.style.top = e.clientY + 'px';
    });

    function openContainer(kind, inv, extra, pos) {
      var n = 9;
      var sansGrille = kind === 'trade' || kind === 'furnace' || kind === 'chest';
      container = { kind: kind, inv: inv,
                    grid: sansGrille ? null : new Array(n).fill(null),
                    result: null,
                    furnace: kind === 'furnace' ? extra : null,
                    chest: kind === 'chest' ? extra : null,
                pnj: kind === 'trade' ? extra : null,
                    livre: false, livreFiltre: '',
                    pos: pos };
      renderContainer();
    }

    /* À la fermeture, ce qui reste dans la grille de craft et dans la main
       doit retourner à l'inventaire — sinon les objets disparaissent. */
    function closeContainer() {
      var rendus = [];
      if (container) {
        if (container.grid) {
          container.grid.forEach(function (s) {
            if (s) { var reste = container.inv.add(s.id, s.n); if (reste) rendus.push({ id: s.id, n: reste }); }
          });
        }
        if (heldStack) {
          var r = container.inv.add(heldStack.id, heldStack.n);
          if (r) rendus.push({ id: heldStack.id, n: r });
          heldStack = null;
        }
      }
      container = null;
      renderContainer();
      return rendus;      // ce qui n'a pas pu rentrer : à faire tomber au sol
    }

    function isContainerOpen() { return !!container; }
    function refreshFurnace() { if (container && container.kind === 'furnace') renderContainer(); }

    return {
      updateHUD: updateHUD, updateHUDJoueur: updateHUDJoueur, placerHuds: placerHuds,
      hudDe: hudDe, updateChat: updateChat, toast: toast, iconStyle: iconStyle,
      barreBoss: barreBoss, ouvrirCarte: ouvrirCarte, fermerCarte: fermerCarte, carteOuverte: carteOuverte,
      dessinerCarte: dessinerCarte, boussole: boussole,
      panneauFactions: panneauFactions, fermerFactions: fermerFactions, factionsOuvertes: factionsOuvertes,
      panneauSucces: panneauSucces, fermerSucces: fermerSucces, succesOuverts: succesOuverts,
      menuPrincipal: menuPrincipal, menuParties: menuParties, menuNouvelle: menuNouvelle,
      menuMulti: menuMulti, ecranAide: ecranAide, menuPause: menuPause, ecranMort: ecranMort,
      ecranOptions: ecranOptions, majTouches: majTouches,
      ecranAffichage: ecranAffichage, appliquerHud: appliquerHud,
      hideScreen: hideScreen, setLockHint: setLockHint,
      openContainer: openContainer, closeContainer: closeContainer,
      objectifHistoire: objectifHistoire, dialogueHistoire: dialogueHistoire, dialogueOuvert: dialogueOuvert,
      journalHistoire: journalHistoire, fermerJournal: fermerJournal, journalOuvert: journalOuvert, ecranFin: ecranFin,
      isContainerOpen: isContainerOpen, renderContainer: renderContainer,
      refreshFurnace: refreshFurnace,
      setRegles: setRegles, toggleLivre: toggleLivre, estCreatif: estCreatif,
      get heldStack() { return heldStack; },
      get container() { return container; },
    };
  }

  MC.createUI = createUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
