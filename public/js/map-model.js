/* M2's map model: the doc shape and every change to it, shared by the page
 * and the server so both validate a map the same way. UMD: window.M2Model,
 * or module.exports for server.js. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.M2Model = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_NODES = 500;
  var MAX_TEXT = 120;
  var MAX_ROOT_TEXT = 80;
  var MAX_XY = 20000;

  // Main-idea colours, in the order new main branches get them.
  var COLORS = 5;

  function newId() {
    var s = Math.random().toString(36).slice(2, 10);
    return 'n' + s;
  }

  function nodes(doc) { return doc && doc.nodes ? doc.nodes : []; }

  function node(doc, id) {
    var list = nodes(doc);
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function childrenOf(doc, id) {
    return nodes(doc).filter(function (n) { return n.parent === id; });
  }

  // Depth in the tree: the root is 0, a main idea 1, everything under it 2+.
  function depth(doc, id) {
    var d = 0, n = node(doc, id);
    while (n && n.parent) { d++; n = node(doc, n.parent); }
    return n ? d : -1;
  }

  // The colour of the branch an idea sits on: the main-idea ancestor's own.
  function branchColor(doc, id) {
    var n = node(doc, id);
    while (n && n.parent) {
      if (n.color != null) return n.color;
      n = node(doc, n.parent);
    }
    return null;
  }

  function countUnder(doc, id) {
    var all = nodes(doc), n = 0;
    // Count descendants by walking up each node's ancestors.
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (p.id === id) continue;
      var a = p;
      while (a && a.parent) {
        if (a.parent === id) { n++; break; }
        a = node(doc, a.parent);
      }
    }
    return n;
  }

  function ideaCount(doc) { return nodes(doc).length; }

  // Main ideas only, for thumbnails: where each branch reaches and its colour.
  function outline(doc) {
    return childrenOf(doc, 'root').map(function (n) {
      return { x: n.x, y: n.y, color: n.color || 0 };
    });
  }

  // Pills are the central idea and the main ideas; everything deeper is
  // plain underlined text.
  function isPill(doc, id) { return depth(doc, id) <= 1; }

  function trim(t) { return typeof t === 'string' ? t.trim() : ''; }

  // Add an idea under parentId, placed by the same rules the canvas uses, and
  // return the new node. Under the root the side with fewer main ideas grows
  // the next branch; anywhere else the new idea sits beside its parent.
  function addIdea(doc, parentId, text) {
    var parent = node(doc, parentId);
    if (!parent) return null;
    var t = trim(text);
    if (!t) return null;
    var id = newId(), x, y, color;
    if (parentId === 'root') {
      var mains = childrenOf(doc, 'root');
      var right = mains.filter(function (n) { return n.x >= 0; }).length;
      var side = right <= mains.length - right ? 1 : -1; // right on a tie
      var sameSide = mains.filter(function (n) { return (n.x >= 0 ? 1 : -1) === side; });
      y = 0;
      for (var k = 0; k <= 40; k++) {
        var cand = k === 0 ? 0 : (k % 2 === 1 ? -Math.ceil(k / 2) * 140 : (k / 2) * 140);
        var taken = sameSide.some(function (n) { return Math.abs(n.y - cand) < 60; });
        if (!taken) { y = cand; break; }
        y = cand;
      }
      x = 220 * side;
      color = mains.length % COLORS;
    } else {
      var gp = node(doc, parent.parent);
      var s = gp ? (parent.x >= gp.x ? 1 : -1) : 1;
      var step = isPill(doc, parentId) ? 150 : 110;
      x = parent.x + s * step;
      var kids = childrenOf(doc, parentId);
      y = kids.length ? kids[kids.length - 1].y + 50 : parent.y;
    }
    var n = { id: id, parent: parentId, text: t, x: x, y: y };
    if (parentId === 'root') n.color = color;
    doc.nodes.push(n);
    return n;
  }

  function rename(doc, id, text) {
    var n = node(doc, id);
    var t = trim(text);
    if (!n || !t) return false;
    n.text = t;
    return true;
  }

  function subtree(doc, id) {
    var out = [], stack = [id];
    while (stack.length) {
      var cur = stack.shift();
      var n = node(doc, cur);
      if (!n) continue;
      out.push(n);
      childrenOf(doc, cur).forEach(function (c) { stack.push(c.id); });
    }
    return out;
  }

  // Move an idea and everything under it.
  function moveSubtree(doc, id, dx, dy) {
    subtree(doc, id).forEach(function (n) { n.x += dx; n.y += dy; });
  }

  // Remove an idea and everything under it; returns them in tree order so
  // restore() can put them back exactly as they were.
  function removeSubtree(doc, id) {
    if (id === 'root') return [];
    var removed = subtree(doc, id);
    var ids = {};
    removed.forEach(function (n) { ids[n.id] = true; });
    doc.nodes = nodes(doc).filter(function (n) { return !ids[n.id]; });
    return removed.map(function (n) { return JSON.parse(JSON.stringify(n)); });
  }

  function restore(doc, removed) {
    (removed || []).forEach(function (n) {
      if (!node(doc, n.id)) doc.nodes.push(JSON.parse(JSON.stringify(n)));
    });
  }

  function outlineFit(outline, w, h, pad) {
    pad = pad == null ? 4 : pad;
    if (!outline.length) return null;
    var minX = 0, maxX = 0, minY = 0, maxY = 0;
    outline.forEach(function (p) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    var sx = (w - pad * 2) / Math.max(maxX - minX, 1);
    var sy = (h - pad * 2) / Math.max(maxY - minY, 1);
    var s = Math.min(sx, sy, 1);
    var ox = w / 2 - ((minX + maxX) / 2) * s;
    var oy = h / 2 - ((minY + maxY) / 2) * s;
    return function (x, y) { return [ox + x * s, oy + y * s]; };
  }

  // Reject an invalid doc with a reason, or return null when it is fine.
  function validate(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'not an object';
    if (doc.v !== 1) return 'unsupported version';
    if (!Array.isArray(doc.nodes)) return 'nodes missing';
    if (doc.nodes.length < 1 || doc.nodes.length > MAX_NODES) return 'wrong node count';
    var seen = {}, roots = [], byId = {};
    for (var i = 0; i < doc.nodes.length; i++) {
      var n = doc.nodes[i];
      if (!n || typeof n !== 'object') return 'bad node';
      if (typeof n.id !== 'string' || !n.id || n.id.length > 40) return 'bad id';
      if (seen[n.id]) return 'duplicate id';
      seen[n.id] = true;
      byId[n.id] = n;
      var t = typeof n.text === 'string' ? n.text.trim() : '';
      if (t.length < 1 || t.length > MAX_TEXT) return 'bad text';
      if (n.id === 'root') roots.push(n);
    }
    if (roots.length !== 1) return 'not exactly one root';
    var root = roots[0];
    if (root.parent !== null) return 'root has a parent';
    if (root.text.trim().length > MAX_ROOT_TEXT) return 'root text too long';
    if (root.x !== 0 || root.y !== 0) return 'root off centre';
    for (var j = 0; j < doc.nodes.length; j++) {
      var m = doc.nodes[j];
      if (m.id === 'root') continue;
      if (typeof m.parent !== 'string' || !byId[m.parent]) return 'missing parent';
      var fx = typeof m.x === 'number' && isFinite(m.x);
      var fy = typeof m.y === 'number' && isFinite(m.y);
      if (!fx || !fy || Math.abs(m.x) > MAX_XY || Math.abs(m.y) > MAX_XY) return 'bad position';
      var isMain = m.parent === 'root';
      if (isMain) {
        if (typeof m.color !== 'number' || m.color % 1 !== 0 || m.color < 0 || m.color > COLORS - 1) return 'bad color';
      } else if ('color' in m) {
        return 'color on a non-main idea';
      }
    }
    // A cycle would mean a node is its own ancestor.
    for (var k = 0; k < doc.nodes.length; k++) {
      var c = doc.nodes[k], hops = 0, p = c;
      while (p && p.parent) { p = byId[p.parent]; if (++hops > doc.nodes.length) return 'cycle'; }
    }
    return null;
  }

  return {
    MAX_NODES: MAX_NODES,
    MAX_TEXT: MAX_TEXT,
    MAX_ROOT_TEXT: MAX_ROOT_TEXT,
    COLORS: COLORS,
    newId: newId,
    node: node,
    nodes: nodes,
    childrenOf: childrenOf,
    depth: depth,
    branchColor: branchColor,
    countUnder: countUnder,
    ideaCount: ideaCount,
    outline: outline,
    outlineFit: outlineFit,
    isPill: isPill,
    addIdea: addIdea,
    rename: rename,
    moveSubtree: moveSubtree,
    removeSubtree: removeSubtree,
    restore: restore,
    subtree: subtree,
    validate: validate,
  };
});
