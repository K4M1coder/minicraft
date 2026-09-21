/* ui.js — HUD et écrans (inventaire, établi, fourneau, pause, mort).
   Tout est en DOM : plus simple à inspecter et à tester qu'un rendu canvas. */
(function (G) {
  'use strict';
  var MC = G.MC = G.MC || {};
  var C = MC.Core, Inv = MC.Inventory, DC = MC.DayCycle, C_Chat = MC.Chat;

  function createUI(root, atlas, hooks) {
    hooks = hooks || {};
    var ICON = 32;

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
    // HUD
    // ══════════════════════════════════════════════════════════════════════
    var hud = el('div', 'hud');
    root.appendChild(hud);

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

    var heldName = el('div', 'held-name');
    hud.appendChild(heldName);

    var debug = el('div', 'debug');
    hud.appendChild(debug);

    var toastBox = el('div', 'toasts');
    hud.appendChild(toastBox);

    var damageFlash = el('div', 'damage-flash');
    root.appendChild(damageFlash);

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

    function updateHUD(g) {
      var p = g.player.state;
      pips(healthBar, p.hp, 10, 'heart');
      pips(hungerBar, p.hunger, 10, 'food');
      if (p.air < MC.PlayerConst.MAX_AIR - 0.01) {
        airBar.style.display = '';
        pips(airBar, Math.ceil(p.air), MC.PlayerConst.MAX_AIR, 'bubble');
      } else airBar.style.display = 'none';

      for (var i = 0; i < Inv.HOTBAR_SIZE; i++) {
        var slot = hotbarSlots[i], stack = p.inv.slots[i];
        slot.classList.toggle('on', i === p.selected);
        var ico = slot.querySelector('.ico'), num = slot.querySelector('.n');
        var wear = slot.querySelector('.wear');
        if (stack) {
          ico.setAttribute('style', iconStyle(stack.id, ICON));
          num.textContent = stack.n > 1 ? stack.n : '';
          // l'usure doit se voir sans ouvrir l'inventaire, sinon l'outil casse
          // par surprise en pleine action
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

      var h = p.inv.slots[p.selected];
      heldName.textContent = h ? C.nameOf(h.id) : '';
      heldName.style.opacity = h ? 1 : 0;

      if (p.mining && isFinite(p.mining.total) && p.mining.total > 0) {
        miningRing.style.display = 'block';
        miningFill.style.width = Math.min(100, (p.mining.t / p.mining.total) * 100) + '%';
      } else miningRing.style.display = 'none';

      damageFlash.style.opacity = Math.max(0, p.hurtFlash) * 0.9;

      updateChat(g.chat);

      debug.innerHTML =
        'FPS <b>' + g.fps + '</b> · chunks <b>' + g.world.chunks.size + '</b>' +
        ' · entités <b>' + g.entities.list.length + '</b><br>' +
        'XYZ <b>' + p.pos.x.toFixed(1) + ' / ' + p.pos.y.toFixed(1) + ' / ' + p.pos.z.toFixed(1) + '</b><br>' +
        DC.clockString(g.time) + ' <b>' + (DC.isNight(g.time) ? 'nuit' : 'jour') + '</b>' +
        ' · ' + (p.flying ? 'vol' : p.swimming ? 'nage' : p.onGround ? 'au sol' : 'en l\'air');
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

    var COMMANDES =
      '<table class="keys">' +
      '<tr><td>ZQSD / WASD</td><td>se déplacer</td></tr>' +
      '<tr><td>souris</td><td>regarder</td></tr>' +
      '<tr><td>clic gauche</td><td>miner (maintenir) · frapper</td></tr>' +
      '<tr><td>clic droit</td><td>poser · utiliser · interagir</td></tr>' +
      '<tr><td>espace</td><td>sauter · nager · 2× = vol</td></tr>' +
      '<tr><td>maj</td><td>courir · descendre</td></tr>' +
      '<tr><td>E</td><td>inventaire et craft 2×2</td></tr>' +
      '<tr><td>G</td><td>jeter un objet</td></tr>' +
      '<tr><td>M</td><td>couper ou remettre le son</td></tr>' +
      '<tr><td>T</td><td>ouvrir le chat (Entree envoie, Echap annule)</td></tr>' +
      '<tr><td>1 – 9 / molette</td><td>choisir un objet</td></tr>' +
      '<tr><td>F5</td><td>sauvegarder</td></tr>' +
      '<tr><td>échap</td><td>pause</td></tr>' +
      '</table>';

    function menuPrincipal(hasSave) {
      showScreen(
        '<div class="panel">' +
        '<h1>MiniCraft</h1>' +
        '<p class="sub">prototype voxel — miner, construire, cultiver, survivre</p>' +
        COMMANDES +
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

    function menuPause() {
      showScreen(
        '<div class="panel">' +
        '<h1>Pause</h1>' +
        '<p class="sub">la partie est figée</p>' +
        COMMANDES +
        '<div class="row">' +
        '<button id="btn-resume" class="primary">Reprendre</button>' +
        '<button id="btn-save">Sauvegarder</button>' +
        '<button id="btn-quit">Menu principal</button>' +
        '</div>' +
        '<p class="hint" id="lock-hint"></p>' +
        '</div>');
      overlay.querySelector('#btn-resume').onclick = function () { hooks.onResume && hooks.onResume(); };
      overlay.querySelector('#btn-save').onclick = function () { hooks.onSave && hooks.onSave(); };
      overlay.querySelector('#btn-quit').onclick = function () { hooks.onQuit && hooks.onQuit(); };
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

    function craftSize() { return container && container.kind === 'craft' ? 3 : 2; }

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
      recomputeResult();
    }

    function renderContainer() {
      if (!container) { invScreen.style.display = 'none'; heldGhost.style.display = 'none'; return; }
      var inv = container.inv;
      invScreen.style.display = 'flex';
      invScreen.innerHTML = '';

      var box = el('div', 'inv-box');
      var titre = container.kind === 'craft' ? 'Établi'
                : container.kind === 'furnace' ? 'Fourneau'
                : container.kind === 'trade' ? 'Villageois'
                : container.kind === 'chest' ? 'Coffre' : 'Inventaire';
      box.appendChild(el('h2', null, titre));

      // ── échanges : liste d'offres cliquables
      if (container.kind === 'trade') {
        var liste = el('div', 'trades');
        Inv.TRADES.forEach(function (tr) {
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
            else toast('Échange conclu : ' + C.nameOf(tr.get.id));
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
            'Grille 2×2. Fabriquez un établi (4 planches) et posez-le pour accéder au 3×3.'));
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
      var n = kind === 'craft' ? 9 : 4;
      var sansGrille = kind === 'trade' || kind === 'furnace' || kind === 'chest';
      container = { kind: kind, inv: inv,
                    grid: sansGrille ? null : new Array(n).fill(null),
                    result: null,
                    furnace: kind === 'furnace' ? extra : null,
                    chest: kind === 'chest' ? extra : null,
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
      updateHUD: updateHUD, updateChat: updateChat, toast: toast, iconStyle: iconStyle,
      menuPrincipal: menuPrincipal, menuPause: menuPause, ecranMort: ecranMort,
      hideScreen: hideScreen, setLockHint: setLockHint,
      openContainer: openContainer, closeContainer: closeContainer,
      isContainerOpen: isContainerOpen, renderContainer: renderContainer,
      refreshFurnace: refreshFurnace,
      get heldStack() { return heldStack; },
      get container() { return container; },
    };
  }

  MC.createUI = createUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
