/* App shell: the hash router, the start flow and autosave.
 *
 * Routes: #/maps (Your maps), #/map/<id> (one map). With no hash the start
 * flow decides what to open: guests get the example in memory, a first visit
 * is welcomed with the example map, and anyone else reopens the map they
 * edited most recently. Every change to a map saves on its own. */
(function (root) {
  'use strict';
  var M = root.M2Model;
  var api = root.M2Api.api;
  var isDemo = root.M2Api.isDemo;
  var app = document.getElementById('app');
  var view = null;

  function destroyView() {
    if (view) { view.destroy(); view = null; }
  }

  function render(el) {
    destroyView();
    app.textContent = '';
    app.appendChild(el);
    return el;
  }

  // ── Autosave ─────────────────────────────────────────────────────────
  // Every change marks the doc dirty and starts a 700 ms debounce, with at
  // most one PUT in flight; the latest doc is sent next. On failure: Not
  // saved with Retry, and automatic retries after 2, 5 and 10 s, then every
  // 10 s. The doc is validated here before it is sent.
  var save = null;

  function makeSaver(mapId, setStatus) {
    var state = { dirty: false, timer: 0, inFlight: false, doc: null, failures: 0, dead: false };
    var BACKOFF = [2000, 5000, 10000];

    function schedule(ms) {
      clearTimeout(state.timer);
      state.timer = setTimeout(send, ms == null ? 700 : ms);
    }

    function send() {
      clearTimeout(state.timer);
      state.timer = 0;
      if (!state.dirty || state.inFlight || state.dead) return;
      var why = M.validate(state.doc);
      if (why) { setStatus('error'); return; }
      state.inFlight = true;
      state.dirty = false; // the snapshot below is the whole send
      var snapshot = JSON.parse(JSON.stringify(state.doc));
      api('PUT', '/api/maps/' + mapId, { doc: snapshot }).then(function (r) {
        state.inFlight = false;
        state.failures = 0;
        if (state.dirty) schedule(0);
        else setStatus('saved');
      }).catch(function (err) {
        state.inFlight = false;
        if (err.status === 404) {
          // The map was deleted while a save waited; drop it quietly.
          state.dead = true;
          state.dirty = false;
          return;
        }
        state.failures++;
        setStatus('error');
        var wait = state.failures <= BACKOFF.length ? BACKOFF[state.failures - 1] : 10000;
        schedule(wait);
      });
    }

    return {
      changed: function (doc) {
        state.doc = doc;
        state.dirty = true;
        setStatus('saving');
        schedule();
      },
      flushNow: function () {
        // For pagehide: one last attempt that survives navigation.
        if (!state.dirty || !state.doc || state.dead) return;
        var token = new URLSearchParams(window.location.search).get('token');
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers['x-usernode-token'] = token;
        if (root.usernode && root.usernode.previewNow) {
          headers['x-usernode-now'] = root.usernode.now().toISOString();
        }
        var url = '/api/maps/' + mapId + (isDemo ? '?demo=1' : '');
        fetch(url, {
          method: 'PUT', headers: headers, keepalive: true,
          body: JSON.stringify({ doc: JSON.parse(JSON.stringify(state.doc)) }),
        });
        state.dirty = false;
      },
      hasUnsaved: function () { return state.dirty || state.inFlight; },
    };
  }

  // ── One map ──────────────────────────────────────────────────────────
  var saverRef = null;

  function showMap(map, guest) {
    var saver = guest ? null : makeSaver(map.id, function (kind) { view.setStatus(kind); });
    saverRef = saver;
    var el = render(root.M2Canvas.loadingEl());
    var v = root.M2Canvas.CanvasView(el, {
      doc: map.doc,
      demo: isDemo,
      initialStatus: guest ? 'guest' : 'none',
      onOpenMaps: function () { location.hash = '#/maps'; },
      onDeleteMap: function () {
        api('DELETE', '/api/maps/' + map.id).then(function () {
          location.hash = '#/maps';
        }).catch(function () {
          if (v) v.setStatus('error');
        });
      },
      onChange: function () {
        if (saver) saver.changed(map.doc);
      },
    });
    view = v;
    if (guest) v.setStatus('guest');
    window.addEventListener('pagehide', onPageHide);
  }

  function onPageHide() {
    if (saverRef) saverRef.flushNow();
  }

  function openMapById(id) {
    render(root.M2Canvas.loadingEl());
    api('GET', '/api/maps/' + id).then(function (r) {
      showMap(r.map, false);
    }).catch(function (err) {
      var gone = err.status === 404;
      var el = render(root.M2Canvas.errorEl({
        title: gone ? 'This map isn’t available' : 'Couldn’t open this map.',
        message: gone ? 'It may have been deleted.' : 'Your other maps are safe.',
        retry: gone ? null : function () { openMapById(id); },
        back: function () { location.hash = '#/maps'; },
      }));
      view = { destroy: function () { app.textContent = ''; } };
    });
  }

  // ── Your maps ────────────────────────────────────────────────────────
  function showMaps() {
    var el = render(document.createElement('div'));
    view = root.M2MapsList(el, {
      demo: isDemo,
      onOpen: function (id) { location.hash = '#/map/' + id; },
    });
  }

  // ── Start flow, with no hash ─────────────────────────────────────────
  function startFlow() {
    render(root.M2Canvas.loadingEl());
    api('GET', '/api/maps').then(function (r) {
      if (r.guest) {
        // A visitor plays with the example map, but nothing is kept.
        showMap({ id: 'example', doc: root.M2Example.exampleDoc() }, true);
        return;
      }
      if (!r.welcomed && !r.demo) {
        api('POST', '/api/welcome').then(function (w) {
          if (w.map) showMap(w.map, false);
          else if (r.maps.length) openMapById(r.maps[0].id);
          else location.hash = '#/maps';
        }).catch(function () { startError(); });
        return;
      }
      if (r.maps.length) openMapById(r.maps[0].id);
      else location.hash = '#/maps';
    }).catch(function () { startError(); });
  }

  // The doc of maps[0] is not in the list response, so open it by id.
  function openFirst(id) { openMapById(id); }

  function startError() {
    render(root.M2Canvas.errorEl({
      title: 'Couldn’t load your maps.',
      message: 'Nothing has been lost. Check your connection and try again.',
      retry: startFlow,
      back: function () { location.hash = '#/maps'; },
    }));
    view = { destroy: function () { app.textContent = ''; } };
  }

  // ── Router ───────────────────────────────────────────────────────────
  window.addEventListener('hashchange', function () {
    if (saverRef && saverRef.hasUnsaved()) saverRef.flushNow();
    route();
  });
  window.addEventListener('beforeunload', function (e) {
    if (saverRef && saverRef.hasUnsaved()) {
      saverRef.flushNow();
      e.preventDefault();
      e.returnValue = '';
    }
  });

  function route() {
    saverRef = null;
    var hash = location.hash;
    if (hash === '#/maps') { showMaps(); }
    else if (hash.indexOf('#/map/') === 0) { openMapById(decodeURIComponent(hash.slice(6))); }
    else { startFlow(); }
  }

  route();
})(typeof self !== 'undefined' ? self : this);
