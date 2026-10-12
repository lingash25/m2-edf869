/* The map canvas: one map drawn on dotted paper, edited in place.
 *
 * A world div (translate + scale) holds an SVG branch layer and one button
 * per idea, so the browser's own focus and keyboard work. Branch geometry is
 * measured from the rendered idea boxes, so the canvas re-measures after
 * every change. All strings reach the DOM through textContent. */
(function (root) {
  'use strict';
  var M = root.M2Model;
  var doc = null; // set per view, below

  var COLOR_CLASSES = ['c-teal', 'c-amber', 'c-violet', 'c-rose', 'c-sky'];
  var DOT_CLASSES = ['b-teal', 'b-amber', 'b-violet', 'b-rose', 'b-sky'];
  var COLOR_NAMES = ['teal', 'amber', 'violet', 'rose', 'sky'];

  var ICONS = {
    grid: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    fit: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="3"/></svg>',
    check: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    pencil: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    bin: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    plus: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  };

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function icon(name) {
    var span = el('span');
    span.innerHTML = ICONS[name]; // static markup written here, never user text
    return span.firstChild;
  }

  var reducedMotion = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Small stand-ins used only if the native UI kit did not load: the app
  // stays usable, just plainer.
  var un = root.unNative || {
    presentSheet: function (opts) {
      var input = opts.content.querySelector('input');
      var form = opts.content.querySelector('form');
      if (form && input) {
        form.addEventListener('submit', function (e) { e.preventDefault(); opts.onSubmit(input.value); });
      }
      return { dismiss: function () {} };
    },
    toast: function (message, opts) {
      opts = opts || {};
      if (opts.action) setTimeout(opts.action.handler, 100);
      else console.log('toast:', message);
      return { dismiss: function () {} };
    },
    alert: function (opts) {
      var ok = (opts.buttons || []).filter(function (b) { return b.style === 'destructive'; })[0];
      if (ok && window.confirm(opts.title + (opts.message ? ' ' + opts.message : ''))) {
        if (ok.handler) ok.handler();
      }
      return Promise.resolve({ button: null });
    },
  };

  // The loading placeholder and the error state, drawn on the dotted canvas.
  function loadingEl() {
    var c = el('div', 'canvas');
    c.appendChild(el('div', 'load-pill'));
    return c;
  }

  function errorEl(opts) {
    var c = el('div', 'canvas');
    var state = el('div', 'canvas-state');
    var title = el('p', 'text-heading', opts.title);
    var note = el('p', 'text-small text-muted', opts.message);
    state.appendChild(title);
    state.appendChild(note);
    if (opts.retry) {
      var retry = el('button', 'btn-secondary', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', opts.retry);
      state.appendChild(retry);
    }
    if (opts.back) {
      var back = el('button', 'btn-secondary', 'Back to maps');
      back.type = 'button';
      back.addEventListener('click', opts.back);
      state.appendChild(back);
    }
    c.appendChild(state);
    return c;
  }

  // One open map on screen.
  function CanvasView(container, opts) {
    var d = opts.doc;
    var selectedId = null;
    var tx = 0, ty = 0, scale = 1;
    var els = new Map(); // node id -> button

    var rootEl = el('div', 'canvas');
    var world = el('div', 'world');
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'branches');
    world.appendChild(svg);
    rootEl.appendChild(world);

    // Top bar: Maps, the demo pill, save status and Fit.
    var topbar = el('header', 'topbar');
    var mapsBtn = el('button', 'btn-secondary');
    mapsBtn.type = 'button';
    mapsBtn.appendChild(icon('grid'));
    mapsBtn.appendChild(document.createTextNode('Maps'));
    mapsBtn.addEventListener('click', opts.onOpenMaps);
    topbar.appendChild(mapsBtn);
    if (opts.demo) topbar.appendChild(el('span', 'demo-pill', 'Staging demo'));
    var topRight = el('div', 'top-right');
    var statusEl = el('span', 'save-status');
    statusEl.hidden = true;
    topRight.appendChild(statusEl);
    var fitBtn = el('button', 'btn-secondary btn-icon');
    fitBtn.type = 'button';
    fitBtn.setAttribute('aria-label', 'Fit map to screen');
    fitBtn.appendChild(icon('fit'));
    fitBtn.addEventListener('click', function () { fit(true); });
    topRight.appendChild(fitBtn);
    topbar.appendChild(topRight);
    rootEl.appendChild(topbar);

    // Bottom bar: the selection line, then Rename, Delete and Add idea.
    var bar = el('div', 'bottom-bar');
    var selLine = el('div', 'selection');
    bar.appendChild(selLine);
    var actions = el('div', 'actions');
    var renameBtn = el('button', 'btn-secondary');
    renameBtn.type = 'button';
    renameBtn.appendChild(icon('pencil'));
    renameBtn.appendChild(document.createTextNode('Rename'));
    var deleteBtn = el('button', 'btn-secondary');
    deleteBtn.type = 'button';
    var addBtn = el('button', 'btn-primary');
    addBtn.type = 'button';
    addBtn.appendChild(icon('plus'));
    addBtn.appendChild(document.createTextNode('Add idea'));
    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    actions.appendChild(addBtn);
    bar.appendChild(actions);
    rootEl.appendChild(bar);

    function setStatus(kind) {
      statusEl.hidden = kind === 'none';
      statusEl.classList.toggle('is-error', kind === 'error');
      if (kind === 'saving') { statusEl.textContent = 'Saving'; }
      else if (kind === 'saved') { statusEl.textContent = ''; statusEl.appendChild(icon('check')); statusEl.appendChild(document.createTextNode('Saved')); }
      else if (kind === 'error') { statusEl.textContent = 'Not saved'; }
      else if (kind === 'guest') { statusEl.textContent = 'Sign in to save'; }
      else { statusEl.textContent = ''; }
    }
    setStatus(opts.initialStatus || 'none');

    function selNode() { return selectedId ? M.node(d, selectedId) : null; }

    function commit() {
      // The caller saves; the canvas only redraws and reports.
      drawBranches();
      renderBar();
      opts.onChange();
    }

    // ── Rendering ────────────────────────────────────────────────────────
    function ideaLabel(n) {
      if (n.id === 'root') return n.text + ', central idea';
      if (n.parent === 'root') return n.text + ', main idea';
      return n.text + ', idea';
    }

    function render() {
      els.forEach(function (old) { if (old.parentNode) old.parentNode.removeChild(old); });
      els.clear();
      M.nodes(d).forEach(function (n) {
        var b = el('button', 'idea');
        b.type = 'button';
        b.textContent = n.text;
        b.dataset.id = n.id;
        if (n.id === 'root') b.classList.add('idea-central');
        else if (n.parent === 'root') {
          b.classList.add('idea-main');
          b.classList.add(COLOR_CLASSES[n.color || 0]);
        } else {
          b.classList.add('idea-sub');
          var c = M.branchColor(d, n.id);
          b.classList.add(COLOR_CLASSES[c == null ? 0 : c]);
          var p = M.node(d, n.parent);
          if (p && n.x < p.x) b.classList.add('left');
        }
        if (n.id === selectedId) {
          b.classList.add('is-selected');
          b.setAttribute('aria-pressed', 'true');
        }
        b.setAttribute('aria-label', ideaLabel(n));
        b.style.left = n.x + 'px';
        b.style.top = n.y + 'px';
        world.appendChild(b);
        els.set(n.id, b);
      });
      // Branch ends need the measured text widths, so draw after layout.
      requestAnimationFrame(drawBranches);
      drawBranchesSoon();
    }

    var branchFrame = 0;
    function drawBranchesSoon() {
      if (branchFrame) return;
      branchFrame = requestAnimationFrame(function () { branchFrame = 0; drawBranches(); });
    }

    function widthOf(n) {
      var b = els.get(n.id);
      return b ? b.offsetWidth : 80;
    }

    // Where an idea's branch leaves it: the centre of a pill, or the
    // underline end of a text idea, facing the child.
    function edgeStart(n) {
      if (M.isPill(d, n.id)) return [n.x, n.y];
      var gp = M.node(d, n.parent);
      var right = gp ? n.x >= gp.x : true;
      return [right ? n.x + widthOf(n) : n.x - widthOf(n), n.y];
    }

    function drawBranches() {
      var paths = '';
      M.nodes(d).forEach(function (n) {
        if (n.id === 'root' || !n.parent) return;
        var from = M.node(d, n.parent);
        if (!from) return;
        var s = edgeStart(from);
        var depth = M.depth(d, n.id);
        var w = depth === 1 ? 'w1' : depth === 2 ? 'w2' : 'w3';
        var c = M.branchColor(d, n.id);
        var cls = w + ' ' + COLOR_CLASSES[c == null ? 0 : c];
        var mx = (s[0] + n.x) / 2;
        paths += '<path class="' + cls + '" d="M' + s[0] + ' ' + s[1] +
          'C' + mx + ' ' + s[1] + ', ' + mx + ' ' + n.y + ', ' + n.x + ' ' + n.y + '"/>';
      });
      svg.innerHTML = paths; // coordinates and class names only, never user text
    }

    // ── View transforms ──────────────────────────────────────────────────
    function applyTransform() {
      world.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(' + scale + ')';
      rootEl.style.backgroundPosition = tx + 'px ' + ty + 'px';
    }

    function glide(on) {
      world.classList.toggle('glide', !!on && !reducedMotion);
    }

    function screenToWorld(px, py) {
      return [(px - tx) / scale, (py - ty) / scale];
    }

    // The bounding box of every idea, in world coordinates.
    function bounds() {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      var any = false;
      M.nodes(d).forEach(function (n) {
        var b = els.get(n.id);
        if (!b) return;
        any = true;
        var w = b.offsetWidth, hh = b.offsetHeight;
        var x0, y0;
        if (M.isPill(d, n.id)) { x0 = n.x - w / 2; y0 = n.y - hh / 2; }
        else {
          var p = M.node(d, n.parent);
          x0 = p && n.x < p.x ? n.x - w : n.x;
          y0 = n.y - hh / 2;
        }
        minX = Math.min(minX, x0); minY = Math.min(minY, y0);
        maxX = Math.max(maxX, x0 + w); maxY = Math.max(maxY, y0 + hh);
      });
      if (!any) return { x: -100, y: -60, w: 200, h: 120 };
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    // Bring the whole map into the space between the bars.
    function fit(animated) {
      var b = bounds();
      var W = rootEl.clientWidth, H = rootEl.clientHeight;
      var barH = bar.offsetHeight || 100;
      var top = 60 + 24, bottom = H - barH - 24;
      var availW = W - 48, availH = Math.max(bottom - top, 120);
      var s = Math.min(availW / Math.max(b.w, 1), availH / Math.max(b.h, 1), 1);
      scale = Math.max(s, 0.3);
      var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      tx = W / 2 - cx * scale;
      ty = (top + bottom) / 2 - cy * scale;
      glide(animated);
      applyTransform();
    }

    // Pan just enough to show a world point, after an idea is added.
    function reveal(x, y, animated) {
      var sx = x * scale + tx, sy = y * scale + ty;
      var W = rootEl.clientWidth, H = rootEl.clientHeight;
      var barH = bar.offsetHeight || 100;
      var pad = 40, top = 60 + pad, bottom = H - barH - pad;
      var dx = 0, dy = 0;
      if (sx < pad) dx = pad - sx;
      if (sx > W - pad) dx = (W - pad) - sx;
      if (sy < top) dy = top - sy;
      if (sy > bottom) dy = bottom - sy;
      if (dx || dy) {
        glide(animated);
        tx += dx; ty += dy;
        applyTransform();
      }
    }

    // ── Gestures ─────────────────────────────────────────────────────────
    var pointers = new Map();
    var gesture = null; // {kind:'pan'|'drag'|'pinch', ...}
    var lastTap = { id: null, at: 0 };

    rootEl.addEventListener('pointerdown', function (e) {
      if (pointers.size === 2) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        // A second pointer turns any gesture into a pinch.
        var pts = Array.from(pointers.values());
        var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        var cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        gesture = { kind: 'pinch', baseScale: scale, baseDist: dist, baseCx: cx, baseCy: cy };
        return;
      }
      var ideaEl = e.target.closest ? e.target.closest('.idea') : null;
      if (ideaEl) {
        gesture = { kind: 'maybe-drag', id: ideaEl.dataset.id, x: e.clientX, y: e.clientY, moved: false };
      } else {
        gesture = { kind: 'pan', x: e.clientX, y: e.clientY, moved: false };
      }
    });

    rootEl.addEventListener('pointermove', function (e) {
      var p = pointers.get(e.pointerId);
      if (p) { p.x = e.clientX; p.y = e.clientY; }
      if (!gesture) return;
      if (gesture.kind === 'pinch' && pointers.size === 2) {
        var pts = Array.from(pointers.values());
        var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        var cx = (pts[0].x + pts[1].x) / 2, cy = (pts[0].y + pts[1].y) / 2;
        var s = Math.min(2, Math.max(0.3, gesture.baseScale * (dist / gesture.baseDist)));
        // Keep the world point under the starting midpoint still there.
        var wx = (gesture.baseCx - tx) / scale, wy = (gesture.baseCy - ty) / scale;
        scale = s;
        tx = cx - wx * s;
        ty = cy - wy * s;
        applyTransform();
        return;
      }
      var dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
      if (gesture.kind === 'pan') {
        if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
        gesture.moved = true;
        tx += e.clientX - (gesture.lastX == null ? gesture.x : gesture.lastX);
        ty += e.clientY - (gesture.lastY == null ? gesture.y : gesture.lastY);
        gesture.lastX = e.clientX; gesture.lastY = e.clientY;
        applyTransform();
      } else if (gesture.kind === 'maybe-drag') {
        if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
        if (!gesture.moved) {
          gesture.moved = true;
          gesture.kind = 'drag';
        }
        var wdx = (e.clientX - (gesture.lastX == null ? gesture.x : gesture.lastX)) / scale;
        var wdy = (e.clientY - (gesture.lastY == null ? gesture.y : gesture.lastY)) / scale;
        gesture.lastX = e.clientX; gesture.lastY = e.clientY;
        M.moveSubtree(d, gesture.id, wdx, wdy);
        M.subtree(d, gesture.id).forEach(function (n) {
          var b = els.get(n.id);
          if (b) { b.style.left = n.x + 'px'; b.style.top = n.y + 'px'; }
        });
        drawBranchesSoon();
      }
    });

    function endPointer(e) {
      pointers.delete(e.pointerId);
      if (!gesture) return;
      if (gesture.kind === 'pinch') {
        if (pointers.size < 2) gesture = null;
        return;
      }
      if (gesture.kind === 'drag') {
        commit();
      } else if (gesture.kind === 'maybe-drag' && !gesture.moved) {
        var id = gesture.id;
        var now = Date.now();
        if (lastTap.id === id && now - lastTap.at < 300) {
          openRename(id);
          lastTap = { id: null, at: 0 };
        } else {
          lastTap = { id: id, at: now };
          select(id);
        }
      } else if (gesture.kind === 'pan' && !gesture.moved) {
        select(null); // a tap on the dotted paper clears the selection
      }
      gesture = null;
    }
    rootEl.addEventListener('pointerup', endPointer);
    rootEl.addEventListener('pointercancel', endPointer);
    rootEl.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        var rect = rootEl.getBoundingClientRect();
        var px = e.clientX - rect.left, py = e.clientY - rect.top;
        var wx = (px - tx) / scale, wy = (py - ty) / scale;
        scale = Math.min(2, Math.max(0.3, scale * Math.exp(-e.deltaY * 0.002)));
        tx = px - wx * scale;
        ty = py - wy * scale;
      } else {
        tx -= e.deltaX;
        ty -= e.deltaY;
      }
      applyTransform();
    }, { passive: false });

    // ── Selection and the bottom bar ─────────────────────────────────────
    function select(id) {
      if (selectedId && els.get(selectedId)) {
        els.get(selectedId).classList.remove('is-selected');
        els.get(selectedId).removeAttribute('aria-pressed');
      }
      selectedId = id;
      if (id && els.get(id)) {
        els.get(id).classList.add('is-selected');
        els.get(id).setAttribute('aria-pressed', 'true');
      }
      renderBar();
    }

    function countText(n) {
      if (n.id === 'root') {
        var mains = M.childrenOf(d, 'root').length;
        return 'Central idea, ' + mains + ' main ' + (mains === 1 ? 'idea' : 'ideas');
      }
      var under = M.countUnder(d, n.id);
      return under === 1 ? '1 idea under it' : under + ' ideas under it';
    }

    function renderBar() {
      selLine.textContent = '';
      var n = selNode();
      var full = M.ideaCount(d) >= M.MAX_NODES;
      var deepest = !!n && !M.canAddUnder(d, n.id);
      addBtn.disabled = full || deepest;
      if (full) {
        selLine.appendChild(el('span', 'sel-meta', 'This map is full (500 ideas)'));
      } else if (n) {
        var dot = el('span', 'dot');
        if (n.id !== 'root') {
          var c = M.branchColor(d, n.id);
          dot.classList.add(DOT_CLASSES[c == null ? 0 : c]);
        } else {
          dot.classList.add('bg-accent');
        }
        selLine.appendChild(dot);
        selLine.appendChild(el('span', 'sel-name', n.text));
        selLine.appendChild(el('span', 'sel-meta', deepest
          ? 'Ideas go ' + M.MAX_DEPTH + ' levels deep'
          : countText(n)));
      } else {
        selLine.appendChild(el('span', 'sel-meta', 'Tap an idea to select it'));
      }
      var isRoot = n && n.id === 'root';
      renameBtn.hidden = !n;
      deleteBtn.hidden = !n;
      deleteBtn.textContent = '';
      deleteBtn.appendChild(icon('bin'));
      deleteBtn.appendChild(document.createTextNode(isRoot ? 'Delete map' : 'Delete'));
    }

    // ── Sheets ───────────────────────────────────────────────────────────
    function sheetForm(labelText, placeholder, value, buttonLabel, maxlength, onSubmit) {
      var form = el('form');
      form.style.cssText = 'display:flex;flex-direction:column;gap:12px;padding:4px 4px 12px';
      var label = el('label', 'section-label', labelText);
      var input = el('input', 'field');
      input.type = 'text';
      input.maxLength = maxlength;
      input.placeholder = placeholder;
      input.value = value || '';
      label.htmlFor = input.id = 'sheet-field';
      var btn = el('button', 'btn-primary', buttonLabel);
      btn.type = 'submit';
      btn.disabled = !input.value.trim();
      input.addEventListener('input', function () { btn.disabled = !input.value.trim(); });
      form.appendChild(label);
      form.appendChild(input);
      form.appendChild(btn);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var v = input.value.trim();
        if (!v) return;
        handle.dismiss();
        onSubmit(v);
      });
      var handle = un.presentSheet({ contentEl: form });
      setTimeout(function () { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 60);
      return handle;
    }

    function openAdd() {
      if (M.ideaCount(d) >= M.MAX_NODES) return;
      var parent = selNode() || M.node(d, 'root');
      if (!M.canAddUnder(d, parent.id)) return;
      sheetForm('Idea', 'e.g. Book a table', '', 'Add idea', M.MAX_TEXT, function (text) {
        // The parent's measured width, so the new idea clears its text.
        var n = M.addIdea(d, parent.id, text, widthOf(parent));
        if (!n) return;
        render();
        var b = els.get(n.id);
        if (b && !reducedMotion) b.classList.add('idea-in');
        select(parent.id); // the idea you added to stays selected
        reveal(n.x, n.y, true);
        commit();
      });
    }

    function openRename(id) {
      var n = M.node(d, id || selectedId);
      if (!n) return;
      sheetForm('Idea', 'e.g. Book a table', n.text, 'Save', n.id === 'root' ? M.MAX_ROOT_TEXT : M.MAX_TEXT, function (text) {
        M.rename(d, n.id, text);
        var b = els.get(n.id);
        if (b) b.textContent = text;
        commit();
      });
    }

    function openDelete() {
      var n = selNode();
      if (!n) return;
      if (n.id === 'root') {
        var count = M.ideaCount(d) - 1;
        un.alert({
          title: 'Delete ' + d.nodes[0].text.trim() + '?',
          message: 'This deletes the map and its ' + count + ' ideas.',
          buttons: [
            { label: 'Cancel', style: 'cancel' },
            { label: 'Delete', style: 'destructive', handler: function () { opts.onDeleteMap(); } },
          ],
        });
        return;
      }
      var removed = M.removeSubtree(d, n.id);
      var under = removed.length - 1;
      var text = removed[0].text;
      select(null);
      render();
      commit();
      var message = 'Deleted ' + text + (under > 0 ? ' and ' + under + ' idea' + (under === 1 ? '' : 's') + ' under it' : '');
      un.toast(message, {
        priority: true,
        action: {
          label: 'Undo',
          handler: function () {
            M.restore(d, removed);
            render();
            commit();
          },
        },
      });
    }

    renameBtn.addEventListener('click', function () { openRename(); });
    deleteBtn.addEventListener('click', openDelete);
    addBtn.addEventListener('click', openAdd);

    // ── Keyboard ─────────────────────────────────────────────────────────
    rootEl.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      var focused = e.target.closest ? e.target.closest('.idea') : null;
      var focusedId = focused ? focused.dataset.id : null;
      if (e.key === 'Enter') {
        if (focusedId && focusedId !== selectedId) { select(focusedId); e.preventDefault(); }
        else if (selectedId) { openAdd(); e.preventDefault(); }
      } else if (e.key === 'F2') {
        openRename(focusedId || selectedId);
        e.preventDefault();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) { openDelete(); e.preventDefault(); }
      } else if (e.key === 'Escape') {
        select(null);
      } else if (selectedId && e.key.indexOf('Arrow') === 0) {
        var step = e.shiftKey ? 50 : 10;
        var dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        var dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (dx || dy) {
          M.moveSubtree(d, selectedId, dx, dy);
          M.subtree(d, selectedId).forEach(function (n) {
            var b = els.get(n.id);
            if (b) { b.style.left = n.x + 'px'; b.style.top = n.y + 'px'; }
          });
          drawBranchesSoon();
          commit();
          e.preventDefault();
        }
      }
    });

    // ── Boot ─────────────────────────────────────────────────────────────
    container.textContent = '';
    container.appendChild(rootEl);
    render();
    renderBar();
    // Measure once the layout has settled, then fit the whole map.
    requestAnimationFrame(function () { fit(false); });

    return {
      el: rootEl,
      setStatus: setStatus,
      fit: function () { fit(true); },
      destroy: function () {
        container.textContent = '';
      },
    };
  }

  root.M2Canvas = {
    CanvasView: CanvasView,
    loadingEl: loadingEl,
    errorEl: errorEl,
  };
})(typeof self !== 'undefined' ? self : this);
